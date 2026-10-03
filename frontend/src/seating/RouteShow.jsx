// 賓客地圖上的帶路動畫（跟介紹影片「地圖帶路」那一段同一套語言）：
//   入口脈動 → BFS 探索波從入口沿走道擴散、碰到桌椅就繞開 → 紅線帶著發光的線頭與火花沿走道畫過去，
//   經過的桌子描一圈虛線（看得出是「繞過去」的）→ 線頭落進椅子時金色爆光 → 之後光點一直沿紅線流向座位。
// 長輩只要記得「跟著紅線走」：紅線本身一直留著，流動的光點告訴他往哪個方向。
//
// 用法：<RouteShow route grid objects upp>{桌椅}</RouteShow>，紅線、探索波畫在桌椅底下（像畫在地毯上），
// 線頭、火花、爆光畫在桌椅上面。畫面縮放每一格都會重畫 React，所以會動的屬性（透明度、虛線位移、位置）
// 由自己的 requestAnimationFrame 直接改 DOM，React 只管形狀；動畫跑完迴圈就停，之後只剩 SMIL／CSS 的流動光點。
import { useId, useLayoutEffect, useMemo, useRef } from "react";
import { exploration } from "./navigation.js";
import { center, SEAT_GAP, SEAT_R } from "./geometry.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// 線的粗細用「螢幕像素」想：縮到整個會場時不能細到看不見，放大時也不要粗成一條馬路
const zoomScale = (upp) => clamp(upp ** -0.35, 0.62, 1.5);

const HEAD_AT = 0.35;      // 探索波出發後多久線頭出發（秒）
const SPARKS = 18;

function routeGeometry(route) {
  if (route?.status !== "ok" || route.points.length < 2) return null;
  const pts = [...route.points];
  const near = (a, b, limit) => a && Math.hypot(a.x - b.x, a.y - b.y) < limit;
  // 從門口畫起、畫進椅子裡；這兩小段很短（入口半寬、椅子外一格半），太遠代表是放寬條件找到的落點，就不硬接
  if (near(route.from, pts[0], 120)) pts.unshift(route.from);
  if (near(route.to, pts[pts.length - 1], 48)) pts.push(route.to);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const d = "M" + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L");
  return { pts, cum, L: cum[cum.length - 1], d };
}

// 路線上距離 s 的點與前進方向
function along(geo, s) {
  const { pts, cum, L } = geo;
  const d = clamp(s, 0, L);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], len = cum[hi] - cum[lo] || 1, k = (d - cum[lo]) / len;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, tx: (b.x - a.x) / len, ty: (b.y - a.y) / len };
}

// 探索波：每隔約 24 單位取一個點（以入口那一格為原點對齊，點陣從門口長出來），依 BFS 步數分成幾十圈，
// 一圈是一條 path（零長度線段＋圓頭 = 一顆點），動畫時只改每一圈的透明度與粗細，上千顆點也不卡
function waveBands(grid, start) {
  const { hops, maxHops } = exploration(grid, start);
  const { cols, step } = grid;
  const stride = Math.max(2, Math.round(24 / step));
  const sc = start % cols, sr = (start - sc) / cols;
  const per = Math.max(2, Math.ceil(maxHops / 72));
  const bands = [];
  for (let id = 0; id < hops.length; id++) {
    if (hops[id] < 0) continue;
    const col = id % cols, row = (id - col) / cols;
    if ((((col - sc) % stride) + stride) % stride || (((row - sr) % stride) + stride) % stride) continue;
    const b = Math.floor(hops[id] / per);
    bands[b] = (bands[b] || "") + `M${((col + 0.5) * step).toFixed(0)} ${((row + 0.5) * step).toFixed(0)}h.01`;
  }
  return { bands: Array.from(bands, (d, i) => ({ d: d || "", dist: i * per * step })), maxDist: maxHops * step };
}

// 路線沿途「繞過」的東西（最近的三個，不含目的地那桌），線頭經過時描一圈虛線
function passedObstacles(objects, geo, route) {
  const out = [];
  const { L } = geo;
  for (const o of objects) {
    if (!["round", "rect", "column", "wall"].includes(o.kind) || o.id === route.table?.id) continue;
    if (o.kind === "zone" && !o.meta?.blocked) continue;
    const { cx, cy, w, h } = center(o);
    const pad = o.seats ? SEAT_GAP + SEAT_R + 7 : 9;
    const a = (-(o.rotation || 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    const hw = w / 2 + pad, hh = h / 2 + pad;
    const sdf = o.kind === "round"
      ? (x, y) => Math.hypot(x - cx, y - cy) - hw
      : (x, y) => {
        const dx = x - cx, dy = y - cy, lx = Math.abs(dx * cos - dy * sin) - hw, ly = Math.abs(dx * sin + dy * cos) - hh;
        return Math.hypot(Math.max(lx, 0), Math.max(ly, 0)) + Math.min(Math.max(lx, ly), 0);
      };
    let best = Infinity, at = 0;
    for (let i = 0; i < geo.pts.length; i += 2) { const v = sdf(geo.pts[i].x, geo.pts[i].y); if (v < best) { best = v; at = geo.cum[i]; } }
    if (best < 48 && at > 30 && at < L - 30) out.push({ o, cx, cy, hw, hh, rot: o.rotation || 0, round: o.kind === "round", s: at, d: best });
  }
  // 由近到遠挑，但沿路分散開（同一排桌子一路擦身而過時，不要三個圈擠在一起）
  const picked = [];
  for (const r of out.sort((p, q) => p.d - q.d)) {
    if (picked.length < 3 && picked.every((x) => Math.abs(x.s - r.s) > 140)) picked.push(r);
  }
  return picked.sort((p, q) => p.s - q.s);
}

const setAttrs = (el, attrs) => { if (el) for (const k in attrs) el.setAttribute(k, attrs[k]); };

export default function RouteShow({ route, grid, objects, upp = 1, delay = 0, replay = 0, mine = false, onArrive, children }) {
  const uid = useId().replace(/:/g, "");
  const geo = useMemo(() => routeGeometry(route), [route]);
  const start = route?.status === "ok" && Number.isInteger(route.start) ? route.start : null;
  const wave = useMemo(() => (grid && start !== null ? waveBands(grid, start) : null), [grid, start]);
  const rings = useMemo(() => (geo ? passedObstacles(objects || [], geo, route) : []), [geo, objects, route]);
  const uppRef = useRef(upp);
  uppRef.current = upp;
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;
  const delayRef = useRef(delay);
  delayRef.current = delay;
  const el = useRef({ bands: [], lines: [], trails: [], sparks: [], rings: [], burst: [] }).current;

  // ---------- 動畫：每次換路線（點了別的椅子）或按「查看路線」都從頭畫一次 ----------
  useLayoutEffect(() => {
    if (!geo) return undefined;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const { L } = geo;
    const headDur = clamp(0.8 + L / 1000, 1.1, 2.4);
    const arrive = HEAD_AT + headDur;
    const waveSpeed = Math.max(600, (wave?.maxDist || 0) / 1.6);
    const endAt = arrive + 1.4;
    const t0 = performance.now() + delayRef.current * 1000;
    const sparks = Array.from({ length: SPARKS }, () => ({ life: 0, age: 1, x: 0, y: 0, vx: 0, vy: 0, r: 1 }));
    let spawnAcc = 0, last = t0, arrived = false, raf = 0, burstDone = false;
    const ringAt = rings.map(() => null);
    const px = (v) => v * uppRef.current * zoomScale(uppRef.current);
    const spark = (x, y, vx, vy, life, r) => {
      const s = sparks.find((p) => p.age >= p.life) || sparks[0];
      Object.assign(s, { x, y, vx, vy, life, age: 0, r });
    };
    const hide = (node) => node && node.setAttribute("visibility", "hidden");
    const show = (node) => node && node.setAttribute("visibility", "visible");

    const finish = () => {
      for (const p of el.lines) setAttrs(p, { "stroke-dasharray": "none", "stroke-dashoffset": 0 });
      for (const b of el.bands) setAttrs(b, { opacity: 0 });  // setAttrs 會跳過已卸載（null）的節點
      for (const tr of el.trails) hide(tr);
      for (const sp of el.sparks) setAttrs(sp, { opacity: 0 });
      for (const r of el.rings) setAttrs(r, { opacity: 0 });
      for (const b of el.burst) setAttrs(b, { opacity: 0 });
      hide(el.head); show(el.ent); show(el.flowWrap);
      setAttrs(el.flowWrap, { opacity: 1 });
      if (!arrived) { arrived = true; arriveRef.current?.(); }
    };

    const frame = (now) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const k = zoomScale(uppRef.current), u = uppRef.current;
      // 線頭：開頭慢、中間快、最後收進椅子（一部分等速，起步不會像卡住）
      const ht = clamp((t - HEAD_AT) / headDur);
      const s = L * (0.72 * easeInOut(ht) + 0.28 * ht);
      const moving = ht > 0 && ht < 1;
      // 紅線：畫到線頭為止
      for (const p of el.lines) setAttrs(p, { "stroke-dasharray": `${L + 1} ${L + 1}`, "stroke-dashoffset": t < HEAD_AT ? L + 1 : L + 1 - s });
      // 探索波：波前亮一下、留一點餘光，看得出哪裡是走道；線頭到了之後整片淡掉
      if (wave) {
        const rest = 0.2 * (1 - clamp((t - (arrive + 0.1)) / 0.9));
        wave.bands.forEach((band, i) => {
          const b = el.bands[i];
          if (!b) return;
          const age = t - band.dist / waveSpeed;
          if (age < 0 || t < 0) { b.setAttribute("opacity", 0); return; }
          const front = Math.exp(-age / 0.24);
          setAttrs(b, { opacity: clamp(front * 0.95 + rest * clamp(age / 0.12)).toFixed(3), "stroke-width": (u * k * (2.6 + 3.4 * front)).toFixed(2) });
        });
      }
      // 入口：線頭出發前開始脈動
      if (t >= -0.05) show(el.ent); else hide(el.ent);
      // 線頭與彗星尾巴
      if (t >= HEAD_AT - 0.2 && t < arrive + 0.4) {
        const h = along(geo, s);
        const waitPulse = t < HEAD_AT ? 0.75 + 0.25 * Math.sin(t * 18) : 1;
        const land = clamp((t - arrive) / 0.4);
        const sc = waitPulse * (1 - easeOut(land) * 0.85) * clamp((t - HEAD_AT + 0.2) / 0.2);
        show(el.head);
        setAttrs(el.head, { transform: `translate(${h.x.toFixed(1)} ${h.y.toFixed(1)}) scale(${(px(1) * sc).toFixed(3)})`, opacity: (1 - land).toFixed(3) });
        const tailFade = moving ? 1 : 1 - clamp((t - arrive) / 0.25);
        [92, 52, 22].forEach((len, i) => {
          const tr = el.trails[i];
          if (!tr) return;
          const tl = px(len);
          if (tailFade <= 0 || t < HEAD_AT) { hide(tr); return; }
          show(tr);
          setAttrs(tr, { "stroke-dasharray": `${tl.toFixed(1)} ${(L + tl * 2).toFixed(1)}`, "stroke-dashoffset": (tl - s).toFixed(1), "stroke-width": px([10, 6.5, 3.6][i]).toFixed(2), opacity: tailFade });
        });
        // 火花：從線頭往後、往兩側噴
        if (moving) {
          spawnAcc += dt * 46;
          while (spawnAcc >= 1) {
            spawnAcc -= 1;
            const side = Math.random() * 2 - 1, back = 0.5 + Math.random() * 0.9;
            spark(h.x, h.y, (-h.tx * back * 110 - h.ty * side * 90) * u * k, (-h.ty * back * 110 + h.tx * side * 90) * u * k, 0.3 + Math.random() * 0.3, 1 + Math.random() * 1.4);
          }
        }
      } else { hide(el.head); for (const tr of el.trails) hide(tr); }
      // 抵達：爆光、一圈火花、通知外面（橫幅換成「找到了」）
      if (t >= arrive && !burstDone) {
        burstDone = true;
        const end = geo.pts[geo.pts.length - 1];
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3, v = (120 + Math.random() * 80) * u * k;
          spark(end.x, end.y, Math.cos(a) * v, Math.sin(a) * v, 0.45 + Math.random() * 0.3, 1.2 + Math.random() * 1.3);
        }
      }
      if (t >= arrive && !arrived) { arrived = true; arriveRef.current?.(); }
      const bk = (t - arrive) / 0.85;
      el.burst.forEach((b, i) => {
        if (!b) return;
        if (bk < 0 || bk > 1.3) { b.setAttribute("opacity", 0); return; }
        if (i < 2) {
          const kk = clamp(bk - i * 0.16);
          setAttrs(b, { r: px(6 + 50 * easeOut(kk)).toFixed(2), opacity: ((1 - kk) * (kk > 0 ? 0.95 : 0)).toFixed(3), "stroke-width": px(0.6 + 3.2 * (1 - kk)).toFixed(2) });
        } else {
          const kk = clamp(bk), a = ((i - 2) / 8) * Math.PI * 2;
          const r1 = px(12 + 26 * easeOut(kk)), r2 = px(18 + 44 * easeOut(kk));
          setAttrs(b, { x1: (Math.cos(a) * r1).toFixed(2), y1: (Math.sin(a) * r1).toFixed(2), x2: (Math.cos(a) * r2).toFixed(2), y2: (Math.sin(a) * r2).toFixed(2), opacity: (1 - kk).toFixed(3), "stroke-width": px(2.2 * (1 - kk) + 0.4).toFixed(2) });
        }
      });
      sparks.forEach((p, i) => {
        const node = el.sparks[i];
        if (!node) return;
        if (p.age >= p.life) { node.setAttribute("opacity", 0); return; }
        p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
        const kk = clamp(p.age / p.life);
        setAttrs(node, { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: (px(p.r) * (1 - kk * 0.6)).toFixed(2), opacity: (1 - kk).toFixed(3) });
      });
      // 經過的桌子：線頭快到時描出虛線框，抵達後淡掉
      rings.forEach((r, i) => {
        const node = el.rings[i];
        if (!node) return;
        if (ringAt[i] === null && s >= r.s - 70 && t >= HEAD_AT) ringAt[i] = t;
        const kin = ringAt[i] === null ? 0 : clamp((t - ringAt[i]) / 0.4);
        const kout = clamp((t - (arrive + 0.45)) / 0.5);
        const kk = easeOut(kin) * (1 - kout);
        setAttrs(node, { opacity: (kk * 0.85).toFixed(3), "stroke-width": px(1.6).toFixed(2), "stroke-dasharray": `${px(6).toFixed(1)} ${px(5).toFixed(1)}` });
        node.style.transform = `scale(${(1.12 - 0.12 * easeOut(kin)).toFixed(3)})`;
      });
      // 抵達後：紅線上的光點開始流動
      const fk = clamp((t - arrive - 0.1) / 0.5);
      if (fk > 0) { show(el.flowWrap); setAttrs(el.flowWrap, { opacity: fk.toFixed(3) }); } else hide(el.flowWrap);
      if (t < endAt) raf = requestAnimationFrame(frame);
      else finish();
    };

    if (reduced) { finish(); return undefined; }
    frame(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [geo, wave, rings, replay, el]);

  const k = zoomScale(upp);
  const w = (v) => v * upp * k;
  // 流動光點的間距跟著縮放分幾段，換段時重新掛 <animate>，速度才會跟間距一致
  const gapBucket = Math.round(Math.log(w(26)) / Math.log(1.3));
  const gap = 1.3 ** gapBucket;
  // 外層結構固定（底層 g、桌椅、上層 g），有沒有路線都一樣，切換時桌椅才不會整批重新掛載
  return (
    <>
      <g className="route-floor" pointerEvents="none">{geo && renderFloor()}</g>
      {children}
      <g className="route-top" pointerEvents="none">{geo && renderTop()}</g>
    </>
  );

  function renderFloor() {
    return (
      <>
        {wave && (
          <g className="route-wave">
            {wave.bands.map((b, i) => <path key={i} d={b.d} ref={(n) => { el.bands[i] = n; }} opacity="0" />)}
          </g>
        )}
        {rings.map((r, i) => (
          r.round
            ? <circle key={r.o.id} ref={(n) => { el.rings[i] = n; }} className="route-pass" cx={r.cx} cy={r.cy} r={r.hw} opacity="0" />
            : (
              // 旋轉放在外層 g：內層的縮放是 CSS transform，會蓋掉自己身上的 transform 屬性
              <g key={r.o.id} transform={r.rot ? `rotate(${r.rot} ${r.cx} ${r.cy})` : undefined}>
                <rect ref={(n) => { el.rings[i] = n; }} className="route-pass" x={r.cx - r.hw} y={r.cy - r.hh} width={r.hw * 2} height={r.hh * 2} rx={Math.min(r.hw, r.hh, 18)} opacity="0" />
              </g>
            )
        ))}
        <path ref={(n) => { el.lines[0] = n; }} d={geo.d} className="route-halo" strokeWidth={w(15)} />
        <path ref={(n) => { el.lines[1] = n; }} d={geo.d} className="route-core" strokeWidth={w(4.6)} />
        <path ref={(n) => { el.lines[2] = n; }} d={geo.d} className="route-shine" strokeWidth={w(1.3)} />
        <g ref={(n) => { el.flowWrap = n; }} visibility="hidden" opacity="0">
          <path d={geo.d} className="route-flow" strokeWidth={w(3.4)} strokeDasharray={`0 ${gap.toFixed(2)}`}>
            <animate key={gapBucket} attributeName="stroke-dashoffset" from="0" to={(-gap).toFixed(2)} dur="0.9s" repeatCount="indefinite" />
          </path>
        </g>
      </>
    );
  }

  function renderTop() {
    const first = geo.pts[0], end = geo.pts[geo.pts.length - 1];
    return (
      <>
        <defs>
          <radialGradient id={`${uid}-glow`}>
            <stop offset="0" stopColor="#fff6e8" stopOpacity="1" />
            <stop offset=".35" stopColor="#ff8a4c" stopOpacity=".55" />
            <stop offset="1" stopColor="#e2483a" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* 入口的脈動圈畫在上面：入口本身有門和字，畫在底下會被蓋住 */}
        <g className="route-ent" ref={(n) => { el.ent = n; }} transform={`translate(${first.x} ${first.y})`} visibility="hidden">
          <circle className="route-ent-ring" r={w(10)} strokeWidth={w(2.2)} />
          <circle className="route-ent-ring late" r={w(10)} strokeWidth={w(2.2)} />
        </g>
        {[0, 1, 2].map((i) => <path key={i} ref={(n) => { el.trails[i] = n; }} d={geo.d} className={`route-trail t${i}`} visibility="hidden" />)}
        {Array.from({ length: SPARKS }, (_, i) => <circle key={i} ref={(n) => { el.sparks[i] = n; }} className={`route-spark${i % 3 ? "" : " hot"}`} r="0" opacity="0" />)}
        <g ref={(n) => { el.head = n; }} visibility="hidden">
          <circle r="26" fill={`url(#${uid}-glow)`} />
          <circle r="5.2" className="route-head-core" strokeWidth="2.2" />
        </g>
        <g transform={`translate(${end.x} ${end.y})`} className={`route-burst${mine ? " mine" : ""}`}>
          {[0, 1].map((i) => <circle key={i} ref={(n) => { el.burst[i] = n; }} r="0" opacity="0" />)}
          {Array.from({ length: 8 }, (_, i) => <line key={i} ref={(n) => { el.burst[i + 2] = n; }} opacity="0" />)}
        </g>
      </>
    );
  }
}
