import assert from "node:assert/strict";
import { test } from "node:test";
import { connectLive, createParser, wallLiveUrl } from "./live.js";

test("SSE 解析：一則被切成好幾段也拼得回來，心跳跳過", () => {
  const got = [];
  const feed = createParser((e) => got.push(e));
  feed('data: {"t":"ready"}\n\n: ping\n\nda');
  feed('ta: {"t":"cmd","cmd":{"id":3,"args":{"t":12.5}}}\n');
  assert.deepEqual(got, [{ t: "ready" }]);
  feed('\ndata: 不是 JSON\n\ndata: {"t":"feed"}\n\n');
  assert.deepEqual(got, [{ t: "ready" }, { t: "cmd", cmd: { id: 3, args: { t: 12.5 } } }, { t: "feed" }]);
});

test("推播網址：大螢幕帶自己的代號", () => {
  assert.equal(wallLiveUrl("remote"), "/api/planner/wall/live?kind=remote");
  assert.equal(wallLiveUrl("wall", "a b"), "/api/planner/wall/live?kind=wall&client=a%20b");
});

function sse(lines, { keepOpen = false } = {}) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const l of lines) ctrl.enqueue(enc.encode(l));
      if (!keepOpen) ctrl.close();
    },
  });
}

test("連上：帶登入標頭、收到 ready 才算通，事件照順序交出去；關掉就不再重連", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    return new Response(sse(['data: {"t":"ready"}\n\n', 'data: {"t":"feed"}\n\n'], { keepOpen: true }), { status: 200 });
  });
  const events = [], status = [];
  const live = connectLive("/x", { token: () => "tok", onEvent: (e) => events.push(e.t), onStatus: (on) => status.push(on) });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, [{ url: "/x", auth: "Bearer tok" }]);
  assert.deepEqual(events, ["ready", "feed"]);
  assert.deepEqual(status, [true]);
  live.close();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(status, [true, false]);
  assert.equal(calls.length, 1);
});

test("推播不能用（503）：回報不通，交給輪詢，不會馬上一直重試", async (t) => {
  let n = 0;
  t.mock.method(globalThis, "fetch", async () => { n++; return new Response("x", { status: 503 }); });
  const status = [];
  const live = connectLive("/x", { token: () => "", onEvent: () => {}, onStatus: (on) => status.push(on) });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(n, 1);
  assert.deepEqual(status, []); // 本來就沒通，不用再說一次
  live.close();
});
