import test from 'node:test';
import assert from 'node:assert/strict';
import { fitHints, ruleIndex } from './ruleHints.js';

// 一排三桌：1 跟 2 是隔壁、2 跟 3 是隔壁、1 跟 3 不是
const layout = {
  guests: [
    { rsvp_id: 1, name: '王小明', circle: '大學同學' },
    { rsvp_id: 2, name: '前任', circle: '' },
    { rsvp_id: 3, name: '女友', circle: '' },
    { rsvp_id: 4, name: '同學乙', circle: '大學同學' },
    { rsvp_id: 5, name: '老同事', circle: '' },
    { rsvp_id: 6, name: '家長', circle: '', seat_need: 'main' },
  ],
  rules: [
    { id: 1, kind: 'apart', members: [{ rsvp_id: 1 }, { rsvp_id: 2 }] },
    { id: 2, kind: 'together', members: [{ rsvp_id: 1 }, { rsvp_id: 3 }] },
    { id: 3, kind: 'far', members: [{ rsvp_id: 1 }, { rsvp_id: 5 }] },
  ],
  objects: [
    { id: 10, kind: 'round', label: 'A1', assignments: [{ rsvp_id: 2 }, { rsvp_id: 4 }] },
    { id: 11, kind: 'round', assignments: [{ rsvp_id: 5 }] },
    { id: 12, kind: 'round', label: '主桌', assignments: [{ rsvp_id: 3 }] },
  ],
  geo: { adj: { 10: [11], 11: [10, 12], 12: [11] }, main: [12] },
  pins: { 5: 12 },
};
const idx = ruleIndex(layout);
const me = layout.guests[0];
const table = (id) => layout.objects.find((o) => o.id === id);

test('不要同桌、一定同桌的人坐別桌、同圈子：壞的排前面', () => {
  const hints = fitHints(me, table(10), idx);
  assert.deepEqual(hints.map((h) => h.tone), ['bad', 'bad', 'bad', 'good']);
  assert.match(hints[0].text, /前任 不要同桌/);
  assert.ok(hints.some((h) => /女友 坐別桌/.test(h.text)));
  assert.ok(hints.some((h) => /要離 老同事 遠一點/.test(h.text)), '隔壁桌也算太近');
  assert.equal(hints[3].text, '同圈子 1 組在這桌');
});

test('一定同桌的人在這桌就是好的；離遠一點的人不在附近就不提', () => {
  const hints = fitHints(me, table(12), idx);
  assert.ok(hints.some((h) => h.tone === 'good' && /跟 女友 一定同桌/.test(h.text)));
  assert.ok(hints.some((h) => h.tone === 'bad' && /老同事/.test(h.text)), '11 號桌是 12 號的隔壁');
  assert.ok(!hints.some((h) => /前任/.test(h.text)));
});

test('標了主桌的人點到主桌會說這是主桌；沒有規則的人沒有提示', () => {
  assert.deepEqual(fitHints(layout.guests[5], table(12), idx), [{ tone: 'good', text: '這是主桌' }]);
  assert.deepEqual(fitHints({ rsvp_id: 99, name: '路人' }, table(10), idx), []);
  assert.deepEqual(fitHints(me, null, idx), []);
});

test('指定桌次：點到指定的那桌是好的，點到別桌就提醒指定坐哪一桌，而且排最前面', () => {
  const pinned = layout.guests[4]; // 老同事指定坐主桌（12）
  assert.equal(fitHints(pinned, table(12), idx)[0].text, '指定坐這桌');
  const hints = fitHints(pinned, table(10), idx);
  assert.deepEqual(hints[0], { tone: 'bad', text: '指定坐「主桌」' });
  assert.equal(idx.pinLabel(5), '主桌');
  assert.equal(idx.pinLabel(1), '');
});
