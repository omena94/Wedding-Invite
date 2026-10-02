// 即時推播（SSE）：大螢幕、手機遙控跟後端 /api/planner/wall/live 保持一條連線，有變化伺服器才推過來，不用每秒問。
// 用 fetch 讀串流、不用 EventSource：EventSource 不能帶登入的 Authorization 標頭（token 放網址會留在伺服器紀錄裡）。
// 推播只是提早通知：onStatus(false) 時呼叫的一方要退回原本的輪詢；收到 ready（連上、重連）時先補抓一次目前的資料。

const QUIET_MS = 45000; // 伺服器每 20 秒至少送一行心跳：45 秒什麼都沒收到就當連線死了（手機換網路常常不會報錯，只會卡住）
const RETRY_MAX_MS = 30000;
const SLOW_RETRY_MS = 60000; // 推播暫時不能用（503）、登入或權限有問題：一分鐘後再試，這段期間靠輪詢（輪詢那邊會顯示原因）
const LONG_ENOUGH_MS = 5000; // 開了這麼久才被請重連（bye）就馬上重連；剛連上就被請走表示伺服器有狀況，照斷線慢慢重試

/** 大螢幕（kind=wall，帶這台的代號才收得到給它的指令）或手機遙控頁（kind=remote）的推播網址。 */
export const wallLiveUrl = (kind, client = "") =>
  `/api/planner/wall/live?kind=${kind}${client ? `&client=${encodeURIComponent(client)}` : ""}`;

/** SSE 解析：一段一段餵進來的文字 → 每一則 data 的 JSON 交給 onEvent；心跳（: ping）跳過。 */
export function createParser(onEvent) {
  let buf = "";
  return (text) => {
    buf += text;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (!data) continue;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      onEvent(event);
    }
  };
}

/**
 * 連上推播並一直保持：斷了自己重連（越斷越久、最多 30 秒，加一點亂數，伺服器重啟後大家不會同一瞬間擠回來）。
 * @param {string} url wallLiveUrl(...)
 * @param {{ token: () => string, onEvent: (e: any) => void, onStatus?: (on: boolean) => void }} opts
 *   onEvent 會收到 ready（剛連上，該補抓了）與伺服器推的每一則；onStatus 告訴呼叫的一方現在推播通不通
 * @returns {{ close: () => void }}
 */
export function connectLive(url, { token, onEvent, onStatus = () => {} }) {
  let stopped = false, ctrl = null, reader = null, quiet = 0, timer = 0, fails = 0, on = false;
  const setOn = (v) => { if (v !== on) { on = v; onStatus(v); } };

  async function run() {
    if (stopped) return;
    const c = (ctrl = new AbortController());
    const opened = Date.now();
    let bye = false, retry = 0;
    const poke = () => { clearTimeout(quiet); quiet = setTimeout(() => c.abort(), QUIET_MS); };
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}`, Accept: "text/event-stream" }, cache: "no-store", signal: c.signal });
      if (!res.ok || !res.body) {
        // 502／504 多半是伺服器正在重啟：照斷線重試；其他（503、登入、權限、方案）都一分鐘後再試
        retry = res.status === 502 || res.status === 504 ? 0 : SLOW_RETRY_MS;
        return;
      }
      poke();
      const parse = createParser((e) => {
        if (e.t === "bye") { bye = true; return; }
        if (e.t === "ready") { fails = 0; setOn(true); }
        onEvent(e);
      });
      reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        poke();
        parse(dec.decode(value, { stream: true }));
      }
    } catch {
      // 斷線、45 秒沒動靜、被 close() 中止
    } finally {
      clearTimeout(quiet);
      reader = null;
      if (!stopped) {
        if (bye && Date.now() - opened > LONG_ENOUGH_MS) {
          // 伺服器請我們重連（開太久、要關機）：推播狀態先不變，馬上接回去，ready 時會補抓
          timer = setTimeout(run, Math.random() * 500);
        } else {
          setOn(false);
          fails++;
          const wait = retry || Math.min(RETRY_MAX_MS, 1000 * 2 ** Math.min(fails - 1, 5));
          timer = setTimeout(run, wait + Math.random() * 1000);
        }
      }
    }
  }

  run();
  return {
    close() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(quiet);
      ctrl?.abort();
      reader?.cancel().catch(() => {}); // 有些環境中止 fetch 不會順便結束串流，自己收掉
      setOn(false);
    },
  };
}
