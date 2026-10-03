// 宴會廳帶路。獨立於地圖顯示與 React，方便驗證通道是否可達。
//   1. 網格：桌椅、牆、柱子、禁止區加上保留距離之後標成「不能走」。
//   2. 探索：從入口做四方向 BFS（地圖上那圈從入口擴散、碰到桌椅就繞開的點陣波就是這一步的步數）。
//   3. 路線：同一張網格上找「走在走道中間」的最短路（八方向 Dijkstra，離桌椅越近每一步越貴），
//      不然最短路會一路貼著別人的椅背切過去，畫出來像一條直線斜斜穿過會場，長輩看了也不敢照著走。
//   4. 平滑：把格子路線當成一條有彈性的線，一邊往鄰點收、一邊被桌椅推開，放鬆成順著走道轉彎的曲線；
//      平滑後的每一段都重新檢查不會切進桌椅，萬一檢查沒過就退回拉直＋修圓角的版本。
import { center, seatPositions, SEAT_GAP, SEAT_R } from './geometry.js';

// 畫布 50 單位約 1 公尺（後台「廳設定」的說明與內建範本都照這個比例），「約幾公尺」用它換算
export const UNITS_PER_METER = 50;

export const entrancesOf = (objects = []) => objects.filter(o => o.kind === 'entrance' || (o.kind === 'zone' && /入口|entrance/i.test(o.label || '')));

export function blocksPoint(o, x, y, margin = 0) {
  return obstacleTest(o, margin)(x,y);
}

const isObstacle = o => !['label', 'entrance'].includes(o.kind) && (o.kind !== 'zone' || o.meta?.blocked);

// 椅子不是牆：人可以貼著坐著的人背後走過，所以椅子只算「畫出來的那一圈」再加一點點，不套整個保留距離。
// 不然像桌距 260 公分的長桌區，兩排椅背之間只剩 14 單位，任何保留距離都會把走道整個封死。
const SEAT_CORE = 7;      // 椅子當障礙物的半徑（畫的是 11）
const SEAT_SOFT = 4;      // 椅子外圍最多再留這麼多
function obstacleTest(o, margin) {
  if (o.kind === 'entrance' || o.kind === 'label' || (o.kind === 'zone' && !o.meta?.blocked)) return () => false;
  const { cx, cy, w, h } = center(o);
  const seats=seatPositions(o), seatRadiusSq=(SEAT_CORE+Math.min(margin,SEAT_SOFT))**2;
  const a=-(o.rotation||0)*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);
  const radiusSq=(w/2+margin)**2;
  return (x,y)=>{
  if (o.kind === 'round') {  // 柱子畫成方形，走長方形的判斷
    if ((x-cx)**2+(y-cy)**2 <= radiusSq) return true;
  } else {
    const dx = x - cx, dy = y - cy;
    const localX = dx*cos-dy*sin, localY=dx*sin+dy*cos;
    if (Math.max(0,Math.abs(localX)-w/2)**2+Math.max(0,Math.abs(localY)-h/2)**2<=margin**2) return true;
  }
  return seats.some(p => (x-p.x)**2+(y-p.y)**2 <= seatRadiusSq);
  };
}

// 物件連同椅子、保留距離的外接圓：平滑時每一步都要檢查上百次，先用外接圓把遠的物件跳過
function obstacleBound(o, margin) {
  const { cx, cy, w, h } = center(o);
  return { cx, cy, r: Math.hypot(w, h) / 2 + margin + (o.seats ? SEAT_GAP + SEAT_R + SEAT_SOFT : 0) };
}

export function navigationGrid(layout, options = {}) {
  const w = layout?.canvas?.w || 1600, h = layout?.canvas?.h || 1000;
  // 限制網格上限；每格中心加半格緩衝，確保連線不切過旋轉物件邊角。
  const step = Math.max(options.step || 8, Math.ceil(Math.max(w, h) / 400));
  const clearance = options.clearance ?? layout?.canvas?.clearance ?? 20;
  const cols = Math.floor(w / step), rows = Math.floor(h / step);
  const blocked = new Uint8Array(cols * rows);
  const objects = layout?.objects || [];
  const point = id => ({ x: (id % cols + .5) * step, y: (Math.floor(id / cols) + .5) * step });
  const margin = clearance + step / 2;
  const shapes = objects.filter(isObstacle).map(o => ({ test: obstacleTest(o, margin), ...obstacleBound(o, margin) }));
  const hit = (x, y) => {
    for (const s of shapes) if ((x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r && s.test(x, y)) return true;
    return false;
  };
  const visible = (a,b) => {
    const samples=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/(step/2)));
    for(let i=0;i<=samples;i++) if(hit(a.x+(b.x-a.x)*i/samples,a.y+(b.y-a.y)*i/samples))return false;
    return true;
  };
  const inside = (x, y) => x >= clearance && y >= clearance && x <= w - clearance && y <= h - clearance;
  for (let id = 0; id < blocked.length; id++) {
    const p = point(id);
    if (!inside(p.x, p.y) || hit(p.x, p.y)) blocked[id] = 1;
  }
  // checkVisible=false：p 本身可能已在障礙物的保留範圍內（例如椅子緊貼舞台），這時只找最近的可通行格，不檢查連線
  const nearest = (p, limit = step * 3, checkVisible = true) => {
    let found = -1, best = limit * limit;
    const x0 = Math.max(0, Math.floor((p.x - limit) / step)), x1 = Math.min(cols - 1, Math.ceil((p.x + limit) / step));
    const y0 = Math.max(0, Math.floor((p.y - limit) / step)), y1 = Math.min(rows - 1, Math.ceil((p.y + limit) / step));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const id = y * cols + x;
      if (blocked[id]) continue;
      const q = point(id), d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d < best && (!checkVisible || visible(p,q))) { best = d; found = id; }
    }
    return found;
  };
  const clear = clearanceField(blocked, cols, rows);
  // 某一點離最近的「不能走」格子幾格（雙線性內插，平滑時用它的梯度把線推離桌椅）
  const clearAt = (x, y) => {
    const gx = Math.min(cols - 1, Math.max(0, x / step - .5)), gy = Math.min(rows - 1, Math.max(0, y / step - .5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0;
    const top = clear[y0 * cols + x0] * (1 - fx) + clear[y0 * cols + x1] * fx;
    const bottom = clear[y1 * cols + x0] * (1 - fx) + clear[y1 * cols + x1] * fx;
    return top * (1 - fy) + bottom * fy;
  };
  const free = (x, y) => inside(x, y) && !hit(x, y);
  return { w, h, step, clearance, cols, rows, blocked, clear, point, nearest, visible, free, clearAt };
}

// 每一格離最近的「不能走」格子有多遠（格數）：兩趟 3-4 倒角距離轉換，O(格數)
function clearanceField(blocked, cols, rows) {
  const n = cols * rows, D = Math.SQRT2, BIG = 1e6;
  const f = new Float32Array(n);
  for (let id = 0; id < n; id++) f[id] = blocked[id] ? 0 : BIG;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const id = y * cols + x;
    let v = f[id];
    if (!v) continue;
    if (x > 0) v = Math.min(v, f[id - 1] + 1);
    if (y > 0) {
      v = Math.min(v, f[id - cols] + 1);
      if (x > 0) v = Math.min(v, f[id - cols - 1] + D);
      if (x < cols - 1) v = Math.min(v, f[id - cols + 1] + D);
    }
    f[id] = v;
  }
  for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
    const id = y * cols + x;
    let v = f[id];
    if (!v) continue;
    if (x < cols - 1) v = Math.min(v, f[id + 1] + 1);
    if (y < rows - 1) {
      v = Math.min(v, f[id + cols] + 1);
      if (x < cols - 1) v = Math.min(v, f[id + cols + 1] + D);
      if (x > 0) v = Math.min(v, f[id + cols - 1] + D);
    }
    f[id] = v;
  }
  return f;
}

// 走道中線的偏好：離「不能走」的格子不到 COMFORT 單位（約 1 公尺）就開始加價，越貼近越貴。
// 加價很輕（最多多六成）：空曠處會走到中間，但桌子排得密的會場照樣從桌間穿過去，
// 不會為了寬敞沿著牆繞一大圈（實測 30 桌範本平均只比最短路長 2.5%）。
const COMFORT = 50;
const HUG_COST = 0.6;

class MinHeap {
  constructor(capacity) { this.ids = new Int32Array(capacity); this.keys = new Float64Array(capacity); this.size = 0; }
  push(id, key) {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2), keys = new Float64Array(this.size * 2);
      ids.set(this.ids); keys.set(this.keys); this.ids = ids; this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p;
    }
    this.ids[i] = id; this.keys[i] = key;
  }
  pop() {
    const top = this.ids[0], key = this.keys[0];
    const lastId = this.ids[--this.size], lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastKey) break;
      this.ids[i] = this.ids[c]; this.keys[i] = this.keys[c]; i = c;
    }
    this.ids[i] = lastId; this.keys[i] = lastKey;
    this.top = key;
    return top;
  }
}

// 同一張網格、同一個入口只算一次：後台檢查全場每一桌能不能走到、賓客點來點去看別桌，都共用這份結果
const explored = new WeakMap();

/**
 * 從入口那一格出發把整個會場走過一遍：
 *   hops  四方向 BFS 的步數（-1 = 走不到），地圖上的探索波照這個時間亮起來
 *   cost  走道中線路線的累積成本（Infinity = 走不到）；prev 倒著走回入口就是路線
 */
export function exploration(grid, start) {
  let byStart = explored.get(grid);
  if (!byStart) explored.set(grid, byStart = new Map());
  if (byStart.has(start)) return byStart.get(start);
  const { cols, rows, blocked, clear, step } = grid;
  const n = cols * rows;
  const hops = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let read = 0, write = 0, maxHops = 0;
  hops[start] = 0; queue[write++] = start;
  while (read < write) {
    const id = queue[read++], col = id % cols, row = (id - col) / cols, next = hops[id] + 1;
    const nb = [col > 0 ? id - 1 : -1, col + 1 < cols ? id + 1 : -1, row > 0 ? id - cols : -1, row + 1 < rows ? id + cols : -1];
    for (const v of nb) if (v >= 0 && !blocked[v] && hops[v] < 0) { hops[v] = next; maxHops = next; queue[write++] = v; }
  }
  const comfort = COMFORT / step;
  const weight = id => { const c = clear[id]; return c >= comfort ? 1 : 1 + HUG_COST * (1 - c / comfort) ** 2; };
  const cost = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap(n);
  cost[start] = 0; prev[start] = start; heap.push(start, 0);
  const D = Math.SQRT2;
  while (heap.size) {
    const id = heap.pop();
    if (heap.top > cost[id]) continue;
    const col = id % cols, row = (id - col) / cols, base = cost[id];
    const l = col > 0 && !blocked[id - 1], r = col + 1 < cols && !blocked[id + 1];
    const u = row > 0 && !blocked[id - cols], d = row + 1 < rows && !blocked[id + cols];
    const relax = (v, len) => {
      const c = base + len * weight(v);
      if (c < cost[v]) { cost[v] = c; prev[v] = id; heap.push(v, c); }
    };
    if (l) relax(id - 1, 1);
    if (r) relax(id + 1, 1);
    if (u) relax(id - cols, 1);
    if (d) relax(id + cols, 1);
    // 斜走只在兩側都能走時才可以，不然會從桌角斜切過去
    if (u && l && !blocked[id - cols - 1]) relax(id - cols - 1, D);
    if (u && r && !blocked[id - cols + 1]) relax(id - cols + 1, D);
    if (d && l && !blocked[id + cols - 1]) relax(id + cols - 1, D);
    if (d && r && !blocked[id + cols + 1]) relax(id + cols + 1, D);
  }
  const out = { hops, maxHops, cost, prev };
  byStart.set(start, out);
  return out;
}

const pathLength = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return s; };

// 沿著折線每隔 spacing 取一點（頭尾保留）
function resample(pts, spacing) {
  const total = pathLength(pts);
  const n = Math.max(1, Math.round(total / spacing));
  const out = [pts[0]];
  let seg = 1, segStart = 0;
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n;
    while (seg < pts.length - 1 && segStart + Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y) < target) {
      segStart += Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y); seg++;
    }
    const a = pts[seg - 1], b = pts[seg], len = Math.hypot(b.x - a.x, b.y - a.y) || 1, t = Math.min(1, (target - segStart) / len);
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 彈性帶：每一輪每個點往前後兩點的中點收一半（線會變順、轉角變圓），離桌椅太近時再沿著
// 「離障礙物多遠」的梯度被推開（留在走道中間）。新位置撞到東西就只走一半，再不行就不動。
function relax(raw, g) {
  if (raw.length < 3) return raw;
  let pts = resample(raw, g.step);
  if (pts.length < 3) return pts;
  const comfort = COMFORT / g.step, eps = g.step / 2;
  for (let round = 0; round < 4; round++) {
    for (let it = 0; it < 15; it++) {
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i], a = pts[i - 1], b = pts[i + 1];
        let mx = ((a.x + b.x) / 2 - p.x) * .5, my = ((a.y + b.y) / 2 - p.y) * .5;
        const c = g.clearAt(p.x, p.y);
        if (c < comfort) {
          const gx = g.clearAt(p.x + eps, p.y) - g.clearAt(p.x - eps, p.y), gy = g.clearAt(p.x, p.y + eps) - g.clearAt(p.x, p.y - eps);
          const len = Math.hypot(gx, gy);
          if (len > 1e-6) { const k = .18 * g.step * (1 - c / comfort) / len; mx += gx * k; my += gy * k; }
        }
        if (g.free(p.x + mx, p.y + my)) pts[i] = { x: p.x + mx, y: p.y + my };
        else if (g.free(p.x + mx / 2, p.y + my / 2)) pts[i] = { x: p.x + mx / 2, y: p.y + my / 2 };
      }
    }
    pts = resample(pts, g.step);  // 收緊之後點會擠在轉角，重新等距再繼續
  }
  return resample(pts, g.step / 2);
}

// 拉直：從每個轉角往後找最遠「看得到」的轉角，連成直線段（平滑沒過檢查時的備案）
function simplify(points, visible) {
  const corners=points.filter((p, i) => i === 0 || i === points.length - 1 || (p.x - points[i - 1].x) * (points[i + 1].y - p.y) !== (p.y - points[i - 1].y) * (points[i + 1].x - p.x));
  if(corners.length<3)return corners;
  const out=[corners[0]];
  for(let i=0;i<corners.length-1;) {
    let next=i+1;
    for(let j=corners.length-1;j>next;j--)if(visible(corners[i],corners[j])){next=j;break;}
    out.push(corners[next]);i=next;
  }
  return out;
}

// 直線段的轉角修圓（二次曲線，半徑不超過兩邊各一半）
function fillet(pts, r0) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const la = Math.hypot(a.x - b.x, a.y - b.y), lc = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(r0, la / 2, lc / 2);
    const p1 = { x: b.x + (a.x - b.x) / la * r, y: b.y + (a.y - b.y) / la * r };
    const p2 = { x: b.x + (c.x - b.x) / lc * r, y: b.y + (c.y - b.y) / lc * r };
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      out.push({ x: u * u * p1.x + 2 * u * t * b.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * b.y + t * t * p2.y });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const allVisible = (pts, g) => pts.every((p, i) => i === 0 || g.visible(pts[i - 1], p));

// Ramer–Douglas–Peucker：把曲線化成幾段直路，用來寫「走幾公尺、往哪轉」
function corners(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = pts[i], b = pts[j], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let best = -1, far = eps;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((b.x - a.x) * (a.y - pts[k].y) - (a.x - pts[k].x) * (b.y - a.y)) / len;
      if (d > far) { far = d; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const meters = units => Math.max(1, Math.round(units / UNITS_PER_METER));

// 白話的走法：「從入口進來往前走約 6 公尺 → 向右轉，再走約 4 公尺 → 抵達」，小於 40 度的彎不算轉彎
function directions(points, step, entranceLabel) {
  const key = corners(points, step * 3);
  const out = [];
  let run = 0, turn = null;
  for (let i = 1; i < key.length; i++) {
    const a = key[i - 1], b = key[i];
    run += Math.hypot(b.x - a.x, b.y - a.y);
    const c = key[i + 1];
    if (!c) break;
    const angle = Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) * 180 / Math.PI;
    if (Math.abs(angle) < 40) continue;
    out.push(turn ? `${turn}，再走約 ${meters(run)} 公尺` : `從「${entranceLabel}」進來，往前走約 ${meters(run)} 公尺`);
    turn = angle > 0 ? '向右轉' : '向左轉';  // 畫面座標 y 朝下：外積為正是順時針，也就是往右
    run = 0;
  }
  out.push(turn ? `${turn}，再走約 ${meters(run)} 公尺` : `從「${entranceLabel}」進來，往前走約 ${meters(run)} 公尺`);
  return out;
}

export function routeToSeat(layout, { objectId, seatIndex, entranceId, grid, ...options } = {}) {
  const objects = layout?.objects || [];
  const table = objects.find(o => o.id === objectId);
  const entrances = entrancesOf(objects);
  const entrance = entranceId == null ? entrances[0] : entrances.find(o => String(o.id) === String(entranceId));
  const fail = (status, message) => ({ status, message, points: [], steps: [], entrance, table });
  if (!table) return fail('unassigned', '座位還在安排中，請找現場招待協助。');
  if (!entrance) return fail('no-entrance', '尚未設定入口，請依桌牌入座或找招待協助。');
  const g = grid || navigationGrid(layout, options);
  const e = center(entrance);
  const start = g.nearest({ x: e.cx, y: e.cy }, Math.max(e.w, e.h) / 2 + g.step * 2);
  if (start < 0) return fail('blocked-entrance', '入口附近沒有可通行路線，請找招待協助。');
  const seats = seatPositions(table);
  if(seatIndex!==undefined&&(!Number.isInteger(seatIndex)||!seats[seatIndex]))return fail('invalid-seat','這個座位已變更，請重新查詢桌次。');
  const seat = Number.isInteger(seatIndex) ? seats[seatIndex] : null;
  const tc = center(table);
  const targets = seat ? [seat] : seats.length ? seats : [{ x: tc.cx, y: tc.cy - tc.h / 2, ox: 0, oy: -1 }];
  // 目標點：椅子外側一小段（不加保留距離，走道窄的長桌區才找得到落點）
  const goalsFor = (list, limit, checkVisible = true) => {
    const found = new Map();
    for (const p of list) {
      const distance = SEAT_R + g.step * 1.5;
      const id = g.nearest({ x: p.x + p.ox * distance, y: p.y + p.oy * distance }, limit, checkVisible);
      if (id >= 0 && !found.has(id)) found.set(id, p);
    }
    return found;
  };
  let goals = goalsFor(targets, g.step * 2);
  // 椅子正前方被舞台、牆之類的保留範圍蓋住（例如 C1 面向舞台的那幾張）：放寬範圍再找，還是沒有就帶到同桌任一張椅子旁
  if (!goals.size) goals = goalsFor(targets, g.step * 4, false);
  if (!goals.size && seat && seats.length > 1) goals = goalsFor(seats, g.step * 3, false);
  if (!goals.size) return fail('blocked-seat', '座位旁的通道太窄，請找現場招待帶位。');
  const field = exploration(g, start);
  let end = -1, best = Infinity;
  for (const id of goals.keys()) if (field.cost[id] < best) { best = field.cost[id]; end = id; }
  if (end < 0) return fail('unreachable', '目前找不到連通的走道，請找現場招待協助。');
  const raw = [];
  for (let id = end; ; id = field.prev[id]) { raw.push(g.point(id)); if (id === start) break; }
  raw.reverse();
  let points = relax(raw, g);
  if (!allVisible(points, g)) {
    const straight = simplify(raw, g.visible);
    const rounded = fillet(straight, g.step * 4);
    points = allVisible(rounded, g) ? rounded : straight;
  }
  const distance = pathLength(points);
  const goalSeat = goals.get(end);
  const where = `「${table.label || '您的桌子'}」${seat ? ` ${seatIndex + 1} 號座位` : ''}`;
  const steps = directions(points, g.step, entrance.label || '入口');
  steps.push(`抵達${where}${seat ? '旁' : '旁邊'}`);
  return {
    status: 'ok', points, steps, entrance, table, start, distance, cellCount: raw.length,
    // 地圖從入口的門口畫起、畫進椅子裡（這兩小段穿過門框與椅子本身，不算在保留距離的檢查裡）
    from: { x: e.cx, y: e.cy }, to: goalSeat ? { x: goalSeat.x, y: goalSeat.y } : null,
    meters: meters(distance),
    message: `從「${entrance.label || '入口'}」沿紅線走約 ${meters(distance)} 公尺，就到${where}。`,
  };
}
