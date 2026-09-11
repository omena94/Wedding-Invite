// 四方向、等距網格 BFS；獨立於地圖顯示與 React，方便驗證通道是否可達。
import { center, seatPositions, SEAT_R } from './geometry.js';

export const entrancesOf = (objects = []) => objects.filter(o => o.kind === 'entrance' || (o.kind === 'zone' && /入口|entrance/i.test(o.label || '')));

export function blocksPoint(o, x, y, margin = 0) {
  return obstacleTest(o, margin)(x,y);
}

// 椅子不是牆：人可以貼著坐著的人背後走過，所以椅子只算「畫出來的那一圈」再加一點點，不套整個保留距離。
// 不然像萬福廳那種桌距 260 公分的長桌區，兩排椅背之間只剩 14 單位，任何保留距離都會把走道整個封死（2026-09-10）。
const SEAT_CORE = 7;      // 椅子當障礙物的半徑（畫的是 11）
const SEAT_SOFT = 4;      // 椅子外圍最多再留這麼多
function obstacleTest(o, margin) {
  if (o.kind === 'entrance' || o.kind === 'label' || (o.kind === 'zone' && !o.meta?.blocked)) return () => false;
  const { cx, cy, w, h } = center(o);
  const seats=seatPositions(o), seatRadiusSq=(SEAT_CORE+Math.min(margin,SEAT_SOFT))**2;
  const a=-(o.rotation||0)*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);
  const radiusSq=(w/2+margin)**2;
  return (x,y)=>{
  if (o.kind === 'round') {  // 柱子 2026-09-11 改為方形，走長方形的判斷
    if ((x-cx)**2+(y-cy)**2 <= radiusSq) return true;
  } else {
    const dx = x - cx, dy = y - cy;
    const localX = dx*cos-dy*sin, localY=dx*sin+dy*cos;
    if (Math.max(0,Math.abs(localX)-w/2)**2+Math.max(0,Math.abs(localY)-h/2)**2<=margin**2) return true;
  }
  return seats.some(p => (x-p.x)**2+(y-p.y)**2 <= seatRadiusSq);
  };
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
  const obstacles = objects.filter(o => !['label', 'entrance'].includes(o.kind) && (o.kind !== 'zone' || o.meta?.blocked)).map(o=>obstacleTest(o,clearance+step/2));
  const physical = obstacles;
  const visible = (a,b) => {
    const samples=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/(step/2)));
    for(let i=0;i<=samples;i++) if(physical.some(test=>test(a.x+(b.x-a.x)*i/samples,a.y+(b.y-a.y)*i/samples)))return false;
    return true;
  };
  for (let id = 0; id < blocked.length; id++) {
    const p = point(id);
    if (p.x < clearance || p.y < clearance || p.x > w - clearance || p.y > h - clearance || obstacles.some(test=>test(p.x,p.y))) blocked[id] = 1;
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
  return { w, h, step, clearance, cols, rows, blocked, point, nearest, visible };
}

function simplify(points, visible) {
  // BFS finds the route first; line-of-sight checks remove tiny zigzags around chairs.
  // Tests include the same inflated furniture shapes, so smoothing cannot cut corners.
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
  const targets = seat ? [seat] : seats.length ? seats : [{ x: center(table).cx, y: center(table).cy - center(table).h / 2, ox: 0, oy: -1 }];
  // 目標點：椅子外側一小段（不加保留距離，走道窄的長桌區才找得到落點）
  const goalsFor = (list, limit, checkVisible = true) => {
    const set = new Set();
    for (const p of list) {
      const distance = SEAT_R + g.step * 1.5;
      const id = g.nearest({ x: p.x + p.ox * distance, y: p.y + p.oy * distance }, limit, checkVisible);
      if (id >= 0) set.add(id);
    }
    return set;
  };
  let goals = goalsFor(targets, g.step * 2);
  // 椅子正前方被舞台、牆之類的保留範圍蓋住（例如 C1 面向舞台的那幾張）：放寬範圍再找，還是沒有就帶到同桌任一張椅子旁（2026-09-11）
  if (!goals.size) goals = goalsFor(targets, g.step * 4, false);
  if (!goals.size && seat && seats.length > 1) goals = goalsFor(seats, g.step * 3, false);
  if (!goals.size) return fail('blocked-seat', '座位旁的通道太窄，請找現場招待帶位。');
  const previous = new Int32Array(g.blocked.length).fill(-1);
  const queue = new Int32Array(g.blocked.length);
  previous[start] = start;
  queue[0] = start;
  let read = 0, write = 1, end = -1;
  while (read < write) {
    const id = queue[read++];
    if (goals.has(id)) { end = id; break; }
    const col = id % g.cols, row = Math.floor(id / g.cols);
    const neighbors = [col > 0 ? id - 1 : -1, col + 1 < g.cols ? id + 1 : -1, row > 0 ? id - g.cols : -1, row + 1 < g.rows ? id + g.cols : -1];
    for (const next of neighbors) if (next >= 0 && !g.blocked[next] && previous[next] === -1) {
      previous[next] = id; queue[write++] = next;
    }
  }
  if (end < 0) return fail('unreachable', '目前找不到連通的走道，請找現場招待協助。');
  const raw = [];
  for (let id = end; ; id = previous[id]) { raw.push(g.point(id)); if (id === start) break; }
  raw.reverse();
  const points = simplify(raw,g.visible);
  const steps = points.slice(1).map((p, i) => {
    if (i === 0) return '從入口沿標示路線前進';
    const a = points[i - 1], b = points[i];
    const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
    return cross > 0 ? '向右轉，沿通道前進' : '向左轉，沿通道前進';
  });
  steps.push(`抵達「${table.label || '您的桌子'}」${seat ? ` ${seatIndex + 1} 號座位旁` : '旁邊'}`);
  return { status: 'ok', points, steps, entrance, table, distance: (raw.length - 1) * g.step, cellCount: raw.length, message: `從「${entrance.label || '入口'}」沿路線前往「${table.label || '您的桌子'}」。` };
}
