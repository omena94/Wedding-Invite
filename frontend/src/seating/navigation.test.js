import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksPoint, exploration, navigationGrid, routeToSeat } from './navigation.js';

const entrance = { id: 1, kind: 'entrance', x: 10, y: 150, w: 20, h: 30, seats: 0 };
const table = { id: 2, kind: 'round', x: 300, y: 140, w: 60, h: 60, seats: 4 };
const layout = objects => ({ canvas: { w: 440, h: 340 }, objects: [entrance, table, ...objects] });
test('BFS 繞過障礙，路線的每個採樣點保持通行距離', () => {
  const wall = { id: 3, kind: 'wall', x: 180, y: 80, w: 24, h: 210, rotation: 0 };
  const l = layout([wall]);
  const r = routeToSeat(l, { objectId: 2, clearance: 6 });
  assert.equal(r.status, 'ok');
  assert.ok(r.points.length > 3);
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1], b = r.points[i];
    for (let t = 0; t <= 1; t += .01) for (const o of [table, wall]) assert.equal(blocksPoint(o, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 6), false);
  }
});
test('整面牆阻隔時不回傳穿牆直線', () => {
  assert.equal(routeToSeat(layout([{ id: 3, kind: 'wall', x: 200, y: 0, w: 30, h: 340 }]), { objectId: 2 }).status, 'unreachable');
});
test('缺入口／未安排的狀態明確，入口選擇必須有效', () => {
  assert.equal(routeToSeat({ canvas: { w: 440, h: 340 }, objects: [table] }, { objectId: 2 }).status, 'no-entrance');
  assert.equal(routeToSeat(layout([]), { objectId: 999 }).status, 'unassigned');
  assert.equal(routeToSeat(layout([]), { objectId: 2, entranceId: 999 }).status, 'no-entrance');
});
test('相同輸入產生相同結果；距離就是畫出來那條線的長度', () => {
  const l = layout([]), grid = navigationGrid(l);
  const a = routeToSeat(l, { objectId: 2, seatIndex: 3, grid });
  assert.equal(a.status, 'ok');
  assert.deepEqual(a, routeToSeat(l, { objectId: 2, seatIndex: 3, grid }));
  let len = 0;
  for (let i = 1; i < a.points.length; i++) len += Math.hypot(a.points[i].x - a.points[i - 1].x, a.points[i].y - a.points[i - 1].y);
  assert.ok(Math.abs(a.distance - len) < 1e-6);
  assert.equal(a.meters, Math.max(1, Math.round(len / 50)));
  assert.match(a.message, /約 \d+ 公尺/);
});
test('探索波是四方向 BFS：相鄰格步數只差 1，同一個入口只算一次', () => {
  const l = layout([{ id: 3, kind: 'wall', x: 180, y: 80, w: 24, h: 210 }]), grid = navigationGrid(l, { clearance: 6 });
  const r = routeToSeat(l, { objectId: 2, grid });
  const { hops } = exploration(grid, r.start);
  assert.equal(hops[r.start], 0);
  assert.equal(exploration(grid, r.start).hops, hops);
  for (let id = 0; id < hops.length; id++) {
    if (hops[id] < 0) continue;
    const col = id % grid.cols;
    if (col + 1 < grid.cols && hops[id + 1] >= 0) assert.ok(Math.abs(hops[id] - hops[id + 1]) <= 1);
    if (id + grid.cols < hops.length && hops[id + grid.cols] >= 0) assert.ok(Math.abs(hops[id] - hops[id + grid.cols]) <= 1);
  }
});
// 空曠的廳中間擺一桌擋路：舊的最短路會貼著那桌的椅背擦過去（離桌心約 70），新的要從走道中間繞
const roomy = () => ({ canvas: { w: 900, h: 500, clearance: 12 }, objects: [
  { id: 1, kind: 'entrance', x: 10, y: 230, w: 20, h: 40 },
  { id: 2, kind: 'round', x: 405, y: 205, w: 90, h: 90, seats: 10 },
  { id: 3, kind: 'round', x: 760, y: 205, w: 90, h: 90, seats: 10 },
] });
test('空曠處路線走在走道中間，不貼著別桌的椅背', () => {
  const r = routeToSeat(roomy(), { objectId: 3, seatIndex: 7 });
  assert.equal(r.status, 'ok');
  const near = Math.min(...r.points.map(p => Math.hypot(p.x - 450, p.y - 250)));
  assert.ok(near > 90, `離擋路那桌的桌心只有 ${near.toFixed(0)}`);
});
test('路線是順的曲線，不是一段段折線', () => {
  const r = routeToSeat(roomy(), { objectId: 3, seatIndex: 7 });
  for (let i = 1; i < r.points.length - 1; i++) {
    const a = r.points[i - 1], b = r.points[i], c = r.points[i + 1];
    const turn = Math.abs(Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y))) * 180 / Math.PI;
    assert.ok(turn < 20, `第 ${i} 點急轉 ${turn.toFixed(0)} 度`);
  }
  // 從入口門口畫起、畫進椅子
  assert.deepEqual(r.from, { x: 20, y: 250 });
  assert.ok(r.to && Math.hypot(r.to.x - r.points.at(-1).x, r.to.y - r.points.at(-1).y) < 48);
});
test('白話走法：繞過牆要轉彎，每段有公尺數，最後是抵達', () => {
  const l = layout([{ id: 3, kind: 'wall', x: 180, y: 80, w: 24, h: 210 }]);
  const r = routeToSeat(l, { objectId: 2, clearance: 6 });
  assert.match(r.steps[0], /^從「入口」進來，往前走約 \d+ 公尺$/);
  assert.ok(r.steps.slice(1, -1).some(s => /^向[左右]轉，再走約 \d+ 公尺$/.test(s)));
  assert.match(r.steps.at(-1), /^抵達「/);
});
test('旋轉長桌與椅子被納入障礙，一般文字區域可穿越', () => {
  assert.equal(blocksPoint({ kind: 'rect', x: 100, y: 100, w: 160, h: 30, rotation: 90, seats: 0 }, 180, 175), true);
  assert.equal(blocksPoint({ kind: 'zone', x: 0, y: 0, w: 100, h: 100 }, 50, 50), false);
  assert.equal(blocksPoint({ kind: 'zone', x: 0, y: 0, w: 100, h: 100, meta: { blocked: true } }, 50, 50), true);
});
test('入口被桌面蓋住時不能跳到另一側產生假路線',()=>{
  const wall={id:3,kind:'wall',x:10,y:130,w:28,h:80};
  assert.equal(routeToSeat(layout([wall]),{objectId:2,clearance:4}).status,'blocked-entrance');
});
test('指定座位失效時不改帶到其他椅子',()=>{
  assert.equal(routeToSeat(layout([]),{objectId:2,seatIndex:99,clearance:6}).status,'invalid-seat');
});
test('入口切換與通道淨寬會重新計算可達路線',()=>{
  const l=layout([{id:3,kind:'entrance',x:390,y:240,w:20,h:30}]);
  const a=routeToSeat(l,{objectId:2,entranceId:1,clearance:6});
  const b=routeToSeat(l,{objectId:2,entranceId:3,clearance:6});
  assert.equal(a.status,'ok');assert.equal(b.status,'ok');assert.notDeepEqual(a.points[0],b.points[0]);
});
