import test from 'node:test';
import assert from 'node:assert/strict';
import { homeAction, readVisit, rememberVisit, VISIT_KEY, weddingClock } from './journey.js';

test('倒數固定台灣中午，跨時區與婚宴結束後不出現負數', () => {
  assert.deepEqual(weddingClock(Date.parse('2027-03-12T04:00:00Z')), { period: 'before', days: 1, hours: 0, minutes: 0, seconds: 0 });
  assert.deepEqual(weddingClock(Date.parse('2027-03-13T03:59:59.500Z')), { period: 'before', days: 0, hours: 0, minutes: 0, seconds: 1 });
  assert.equal(weddingClock(Date.parse('2027-03-13T04:00:00Z')).period, 'today');
  assert.equal(weddingClock(Date.parse('2027-03-13T15:59:59Z')).period, 'today');
  assert.deepEqual(weddingClock(Date.parse('2027-03-13T16:00:00Z')), { period: 'after', days: 0, hours: 0, minutes: 0, seconds: 0 });
});

test('回訪主行動只導向已開放功能，admin 預覽不改變賓客階段', () => {
  assert.equal(homeAction({ preview: true }).href, '/rsvp');
  assert.equal(homeAction({ phase2_open: true }).href, '/details');
  assert.equal(homeAction({ phase2_open: true, seat_open: true }).href, '/seat');
  assert.equal(homeAction({ seat_open: true, photos_open: false, preview: true }, 'after').href, '/info');
  assert.equal(homeAction({ photos_open: true }, 'after').href, '/info'); // 婚紗照不給賓客看，開關開著也不導向相簿
});

test('無效、未來與無法存取的回訪紀錄不會使首頁失效', () => {
  for (const value of [null, '{}', 'bad json', 'null', '{"openedAt":-1}', '{"openedAt":999999999999999}']) {
    assert.equal(readVisit({ getItem: () => value }), null);
  }
  const blocked = { getItem() { throw new Error('storage disabled'); }, setItem() { throw new Error('quota'); } };
  assert.equal(readVisit(blocked), null);
  assert.doesNotThrow(() => rememberVisit(blocked, 'rsvp'));
});

test('回訪儲存僅含開場時間與階段，不帶賓客或登入資料', () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  rememberVisit(storage, 'seat');
  assert.deepEqual(Object.keys(JSON.parse(saved.get(VISIT_KEY))).sort(), ['chapter', 'openedAt']);
  assert.equal(readVisit(storage).chapter, 'seat');
  assert.deepEqual(readVisit({ getItem: () => '{"openedAt":123,"chapter":false,"phone":"0912345678"}' }), { openedAt: 123, chapter: '' });
});
