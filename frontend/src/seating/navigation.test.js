import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksPoint, navigationGrid, routeToSeat } from './navigation.js';

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
test('BFS 的相鄰網格等距；相同輸入產生相同結果', () => {
  const l = layout([]), grid = navigationGrid(l);
  const a = routeToSeat(l, { objectId: 2, seatIndex: 3, grid });
  assert.equal(a.status, 'ok');
  assert.deepEqual(a, routeToSeat(l, { objectId: 2, seatIndex: 3, grid }));
  assert.equal(a.distance, (a.cellCount - 1) * grid.step);
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
