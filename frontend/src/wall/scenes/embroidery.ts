// 照片版面「刺繡框」（亮）：照片印在亞麻布上、繃在一個竹製的刺繡框裡，照片外圍一圈藤蔓花環一針一針繡出來——
//  - 繡框是橢圓的（照片直的就是直的橢圓，太長的照片框也只到 0.72～1.38 的比例），竹圈有圓柱的亮暗、頂上一顆黃銅螺絲；
//    框裡的布繃得緊（織紋細、內圈壓出一道小隆起），框外的布鬆鬆的、有很軟的皺褶。照片印在布上：顏色吃進織紋裡、黑色微微發白。
//  - 切進來：繡框從上面一點點落到布上（影子收緊）。之後兩枝藤蔓從底部中間分左右往上繡（回針繡），沿路長出葉子（緞面繡）、
//    小花（雛菊繡的花瓣＋法國結的花心），一根針跟著正在繡的地方走；繡到頂端兩枝不相連（螺絲在那裡）。窗格長就繡得慢、短就繡得快，
//    長窗格最後三成時間花環已經繡好、停著讓人看。鏡頭很慢地往繡框推近。
//  - 照片是印上去的，從頭到尾都完整；花環只在照片外面（照片的四個角落在離繡框還有一段距離的地方）。很小的照片最多放大 1.5 倍。
//  - 焦點：布上印的畫面慢慢往焦點推（推到 1.18 倍），鏡頭也繞著焦點推近、焦點往畫面中間移一點（字一直在安全區裡）。
//  - 字用緞面繡繡在左邊的布上（線有斜紋與凸起的影子）：主字（賓客留言＋署名，或新人的註解）一個字一個字繡出來，
//    歌詞小一號在下面跟唱（還沒唱的是布上淡淡的轉印線）；沒有主字時歌詞自己繡在同一個位置跟唱；
//    兩個都沒有就只有繡框（移到畫面正中間、大一點）。相簿的第一張在字上面多一行小小的相簿名。
// 畫法：一個全螢幕 shader（布、繡框、照片、針）；花環的每一針在 init() 排好，畫在一張繡框大小的 Canvas 圖層上（只補畫新的那幾針，
// 時間倒回去才整張重畫），shader 取樣它並加上線的影子；字層一樣在 shader 裡取樣，加上緞面的斜紋。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog } from '../engine/util';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, focusAmp, focusAt, focusCam, loadPhoto, p6Crop, pace, photoLod, setP6Photo, type FocusCamOpts } from './_p6';
import { focusCrop, settleK } from './_photo';
import type { PhotoImage } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, prefers: ['square', 'portrait', 'small'], energy: [0, 0.8], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D st; uniform sampler2D tl;
  uniform vec3 cam;
  uniform vec2 hc; uniform vec2 hr; uniform float hw;
  uniform vec2 phHS; uniform float lod;
  uniform vec4 stR; uniform vec4 tlR; uniform float textK;
  uniform vec4 ndl;    // 針尖 x, y、角度、看不看得到
  uniform float lift; uniform float k;
  // 橢圓的近似距離（a = 半徑）：負的在裡面
  float ellD(vec2 p, vec2 a) { float r = length(p / a); return (r - 1.0) * r / max(length(p / (a * a)), 1e-5); }
  float weave(vec2 p, float per) {
    vec2 q = p / per;
    float wx = 0.5 + 0.5 * sin(q.x * 6.2832), wy = 0.5 + 0.5 * sin(q.y * 6.2832);
    float over = step(0.5, fract((floor(q.x) + floor(q.y)) * 0.5));
    return mix(wx, wy, over);
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 wp = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    vec2 hp = wp - hc;
    vec3 linen = mix(C_BONE, C_FUR, 0.1) * 0.9;
    // 框外的布：鬆的，很軟的皺褶＋粗一點的織紋與粗紗
    float slub = snoise(vec2(wp.x / 4.0, wp.y / 120.0)) * 0.5 + snoise(vec2(wp.x / 120.0, wp.y / 4.0)) * 0.5;
    float folds = sin(dot(wp, vec2(0.0042, 0.0031)) * 6.2832 + 2.2 * fbm(wp / 800.0, 2)) * 0.5 + 0.5;
    vec3 loose = linen * (0.94 + 0.04 * weave(wp, 4.6) + 0.015 * slub) * (0.93 + 0.08 * folds);
    float dIn = ellD(hp, hr), dOut = ellD(hp, hr + hw);
    // 繡框在鬆布上的影子（落下的瞬間比較遠）
    float dSh = ellD(hp - vec2(7.0, 12.0) * lift, hr + hw);
    vec3 col = loose * (1.0 - (0.3 / lift) * exp(-max(dSh, 0.0) / (8.0 + 10.0 * lift)) * step(0.0, dOut));
    // ---- 字：緞面繡（斜紋＋凸起的影子），繡在框外左邊的布上
    vec4 tx = p6Layer(tl, wp - tlR.xy, tlR.zw) * textK;
    float txs = p6Layer(tl, wp - tlR.xy - vec2(1.2, 1.6), tlR.zw).a * textK;
    col *= 1.0 - 0.22 * txs * (1.0 - tx.a);
    vec3 thr = tx.a > 0.0 ? tx.rgb / tx.a : vec3(0.0);
    thr *= 0.84 + 0.2 * (0.5 + 0.5 * sin((wp.x - wp.y) * 1.7));
    col = mix(col, thr, tx.a);

    // ---- 框裡的布：繃緊、織紋細，照片印在上面
    float inA = 1.0 - smoothstep(-0.8, 0.8, dIn);
    vec3 taut = linen * 1.03 * (0.95 + 0.04 * weave(wp, 3.4) + 0.01 * slub);
    // 內圈壓出來的隆起（框的內緣一圈亮、再進去一點點暗）
    taut *= 1.0 + 0.06 * exp(-pow((dIn + 7.0) / 4.0, 2.0)) - 0.05 * exp(-pow((dIn + 15.0) / 6.0, 2.0));
    vec2 uv = (hp + phHS) / (2.0 * phHS);
    float pa = aaFill(sdBox(hp, phHS));
    vec3 ph = p6Photo(photo, uv, lod + 0.25);
    // 印在布上：顏色吃進織紋、最暗的地方微微發白
    ph = mix(ph, linen * 0.92, 0.05) * (0.93 + 0.08 * weave(wp, 3.4));
    taut = mix(taut, ph, pa * 0.97);
    // 花環（一針一針）：線＋線在布上的影子
    vec4 s = p6Layer(st, wp - stR.xy, stR.zw);
    float ss = p6Layer(st, wp - stR.xy - vec2(1.4, 2.0), stR.zw).a;
    taut *= 1.0 - 0.3 * ss * (1.0 - s.a);
    taut = taut * (1.0 - s.a) + s.rgb;
    col = mix(col, taut, inA);

    // ---- 竹圈（外圈蓋在布上）：圓柱的亮暗、竹節
    float ringA = (1.0 - smoothstep(-0.8, 0.8, dOut)) * smoothstep(-0.8, 0.8, dIn);
    float across = clamp(dIn / hw, 0.0, 1.0);
    float ang = atan(hp.y * hr.x, hp.x * hr.y);
    vec3 bamboo = mix(C_FUR, C_BONE, 0.42) * 0.86;
    float cyl = sin(across * 3.14159);
    vec3 rc = bamboo * (0.62 + 0.38 * cyl);
    // 上緣（朝光）亮一點、下緣暗
    rc *= 1.0 + 0.12 * (-sin(ang)) * cyl;
    rc += C_BONE * 0.06 * pow(cyl, 8.0) * smoothstep(0.0, 0.6, -sin(ang + 0.6));
    rc *= 1.0 - 0.04 * snoise(vec2(ang * 40.0, across * 3.0));
    // 外圈與內圈的接縫（兩個圈疊在一起）
    rc *= 1.0 - 0.22 * exp(-pow((across - 0.5) * hw / 1.2, 2.0));
    col = mix(col, rc, ringA);
    // ---- 頂上的黃銅螺絲夾
    vec2 sq = hp - vec2(0.0, -(hr.y + hw * 0.5));
    float clamp1 = sdBox(sq - vec2(0.0, -hw * 0.9), vec2(hw * 0.75, hw * 0.75));
    float screw = sdBox(rot2(0.0) * (sq - vec2(0.0, -hw * 2.2)), vec2(hw * 0.32, hw * 0.75));
    vec3 brass = mix(C_FUR, C_BONE, 0.25) * 0.9;
    float cb = 1.0 - smoothstep(-0.8, 0.8, clamp1);
    col *= 1.0 - 0.25 * exp(-max(sdBox(sq - vec2(5.0, -hw * 0.9 + 9.0), vec2(hw * 0.75)), 0.0) / 6.0) * (1.0 - cb);
    col = mix(col, bamboo * (0.8 + 0.2 * smoothstep(hw * 0.75, -hw * 0.75, sq.y + hw * 0.9)), cb);
    float sw = 1.0 - smoothstep(-0.8, 0.8, screw);
    float sx = (sq.x) / (hw * 0.32);
    vec3 bc = brass * (0.6 + 0.5 * (1.0 - sx * sx)) * (0.9 + 0.1 * sin(sq.y * 1.4));
    col = mix(col, bc, sw);

    // ---- 針：細細的銀色，針尖在正在繡的地方
    vec2 nq = rot2(ndl.z) * (wp - ndl.xy);
    float nd = sdSegment(nq, vec2(0.0), vec2(0.0, -86.0)) - mix(0.6, 2.4, clamp(-nq.y / 30.0, 0.0, 1.0));
    float eye = abs(sdSegment(nq, vec2(0.0, -74.0), vec2(0.0, -82.0)) - 1.0);
    float na = (1.0 - smoothstep(-0.7, 0.7, nd)) * ndl.w;
    float nsh = (1.0 - smoothstep(-2.0, 3.0, sdSegment(rot2(ndl.z) * (wp - ndl.xy - vec2(5.0, 8.0)), vec2(0.0), vec2(0.0, -86.0)) - 2.0)) * ndl.w;
    col *= 1.0 - 0.25 * nsh * (1.0 - na);
    vec3 steel = mix(C_ASH, C_BONE, 0.5 + 0.4 * sin(nq.x * 1.3 + 0.5));
    steel *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.8, eye));
    col = mix(col, steel, na);

    // 光：左上亮一點
    col *= 1.0 - 0.1 * smoothstep(0.0, 2400.0, dot(wp, vec2(0.7, 0.72)));
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, st: { value: null }, tl: { value: null }, cam: { value: new THREE.Vector3(W / 2, H / 2, 1) },
  hc: { value: new THREE.Vector2() }, hr: { value: new THREE.Vector2(300, 300) }, hw: { value: 24 },
  phHS: { value: new THREE.Vector2() }, lod: { value: 0 },
  stR: { value: new THREE.Vector4(0, 0, 1, 1) }, tlR: { value: new THREE.Vector4(0, 0, 1, 1) }, textK: { value: 0 },
  ndl: { value: new THREE.Vector4() }, lift: { value: 1 }, k: { value: 1 },
});

/** 一針：線段（或一個點：法國結、或一個小橢圓：雛菊繡的花瓣）。座標是繡框圖層的 px。 */
interface Stitch { x1: number; y1: number; x2: number; y2: number; color: string; w: number; kind: 'line' | 'knot' | 'petal' }

/** 照片的四個角落在繡框內圈的多少（越小，照片離框越遠、花環越寬）。 */
const CORNER = 0.8;
/** 竹圈的寬。 */
const HOOP_W = 24;
/** 布上印的畫面往焦點推到幾倍；鏡頭再推近 4%、焦點往畫面中間移兩成。 */
const PUSH = 1.18;
const FOCUS: FocusCamOpts = { zoom: 1.04, pull: 0.2 };

export default class Embroidery extends Scene {
  bg = shared('embroidery.bg', BG);
  // 字：左邊的布上寬 500、最多六行（60 字的留言＋署名＋歌詞也放得下），整塊最高 760
  cap = this.track(new Caption(500, 760, { family: F.hand(700), align: 'left', lineHeight: 1.36, maxLines: 6, ink: mixRgba('sepia', 'blood', 0.25), labelFamily: F.hand(700), label: mixRgba('sepia', 'blood', 0.2, 0.7) }));
  st: Layer2D | null = null;
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  hcx = W / 2; hcy = H / 2; ax = 300; ay = 300; phw = 100; phh = 100;
  stX = 0; stY = 0;
  tlX = 0; tlY = 0;
  stitches: Stitch[] = [];
  drawn = 0;
  t0 = 0; dur = 1; kp = 1;
  /** 焦點（布上的畫面推到底時在世界座標的位置）與鏡頭往那裡推的幅度（字不能被推出安全區）。 */
  foc: [number, number] = [W / 2, H / 2];
  amp = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { start, end } = this.ctx;
    const cap = this.cap;
    cap.setup(this.ctx, ph);
    const { w, h } = img;
    // 繡框：有字時在右邊（字在左邊的布上），沒有字時在正中間、大一點
    this.hcx = cap.has ? 1240 : W / 2;
    this.hcy = cap.has ? 520 : 528;
    const maxAy = cap.has ? 392 : 418, maxAx = cap.has ? 530 : 700;
    // 照片放進橢圓：角落在 CORNER 的地方；橢圓的長寬比夾在 0.72～1.38
    const r0 = clamp(w / h, 0.72, 1.38);
    // 照片半寬高 = s·(w/2, h/2)；ay = sqrt((hw/r)² + hh²)/CORNER，ax = r·ay（都跟 s 成正比）
    const ay1 = Math.sqrt((w / 2 / r0) ** 2 + (h / 2) ** 2) / CORNER;
    const s = fitPhoto(ay1 * r0, ay1, maxAx, maxAy);
    this.phw = (w * s) / 2; this.phh = (h * s) / 2;
    this.ay = ay1 * s; this.ax = this.ay * r0;
    if (cap.has) {
      // 字在左邊（x < 640，不會碰到右下角 HUD）：跟繡框的中間對齊，最後一行最低到 950
      this.tlX = 132;
      this.tlY = clamp(this.hcy - cap.blockH / 2, 130, 950 - cap.blockH);
    }
    const rect = [this.hcx - this.phw, this.hcy - this.phh, this.hcx + this.phw, this.hcy + this.phh];
    this.foc = focusAt(ph, focusCrop(ph, w, h, w / h, 1, { zoom: PUSH, screenW: 2 * this.phw }), rect);
    this.amp = cap.has ? focusAmp(this.foc, FOCUS, [[this.tlX - 8, this.tlY - 8, this.tlX + cap.blockW + 8, this.tlY + cap.blockH + 16]]) : 1;
    // 花環的圖層：繡框內圈的外接矩形
    const lw = Math.ceil(2 * this.ax + 8), lh = Math.ceil(2 * this.ay + 8);
    this.st = this.track(new Layer2D(lw, lh, undefined, { fast: true }));
    this.stX = this.hcx - lw / 2; this.stY = this.hcy - lh / 2;
    this.plan(lw / 2, lh / 2);
    this.kp = pace(this.ctx);
    const D = end - start;
    this.t0 = start + 0.45 * this.kp;
    // 長窗格：最後三成時間已經繡好；短窗格繡得很快
    this.dur = clamp(0.68 * D - 0.45, 1.6, 10);
    cap.writeAt(start + 0.5 * this.kp, Math.min(2.4, 0.45 * D));
  }

  /** 排好每一針（照順序）：兩枝藤蔓從底部中間往上，沿路長葉子、開小花。 */
  private plan(ox: number, oy: number) {
    const rnd = mulberry32(Math.floor(hash(this.seed, 77) * 1e9));
    const rw = (CORNER + 1) / 2 + 0.01;
    const ax = this.ax * rw, ay = this.ay * rw;
    const vine = mixRgba('gingham', 'sepia', 0.35), leafA = mixRgba('gingham', 'sepia', 0.12), leafB = mixRgba('gingham', 'bone', 0.18);
    const petal = [mixRgba('signal', 'sepia', 0.18), mixRgba('signal', 'bone', 0.3)];
    const knot = mixRgba('fur', 'sepia', 0.25);
    // 沿著橢圓、從底部（θ = π/2，y 向下）往兩邊走到頂端前面停
    const branches: Stitch[][] = [[], []];
    for (const [bi, dir] of [[0, 1], [1, -1]] as const) {
      const list = branches[bi]!;
      const span = Math.PI - 0.42;
      const N = 900;
      let acc = 0, lastS = 0, nextLeaf = 30 + rnd() * 20, side = 1, leafN = 0;
      let px = 0, py = 0;
      const at = (th: number) => {
        const wob = 1 + 0.012 * Math.sin(th * 9 + bi);
        return [ox + Math.cos(th) * ax * wob, oy + Math.sin(th) * ay * wob] as const;
      };
      [px, py] = at(Math.PI / 2);
      let sx = px, sy = py;
      for (let i = 1; i <= N; i++) {
        const th = Math.PI / 2 + dir * span * (i / N);
        const [x, y] = at(th);
        acc += Math.hypot(x - px, y - py);
        px = x; py = y;
        // 回針繡：每 13 px 一針
        if (acc - lastS >= 13) {
          list.push({ x1: sx, y1: sy, x2: x, y2: y, color: vine, w: 4, kind: 'line' });
          sx = x; sy = y; lastS = acc;
        }
        if (acc >= nextLeaf && i < N - 20) {
          const [x2, y2] = at(th + dir * 0.004);
          const tx = (x2 - x), ty = (y2 - y), tl = Math.hypot(tx, ty) || 1;
          const ux = tx / tl, uy = ty / tl;
          leafN++;
          if (leafN % 4 === 0) {
            // 小花：五片雛菊繡的花瓣＋法國結的花心
            const cx = x + -uy * 6 * side, cy = y + ux * 6 * side;
            const c = petal[leafN % 8 === 0 ? 1 : 0]!;
            const r = 17 + rnd() * 4, a0 = rnd() * Math.PI;
            for (let k = 0; k < 5; k++) {
              const a = a0 + (k * Math.PI * 2) / 5;
              list.push({ x1: cx + Math.cos(a) * 3, y1: cy + Math.sin(a) * 3, x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r, color: c, w: 3.6, kind: 'petal' });
            }
            for (let k = 0; k < 3; k++) {
              const a = rnd() * Math.PI * 2;
              list.push({ x1: cx + Math.cos(a) * 2.2, y1: cy + Math.sin(a) * 2.2, x2: 0, y2: 0, color: knot, w: 3.2, kind: 'knot' });
            }
          } else {
            // 葉子：緞面繡，從藤蔓斜斜長出去（裡外交替；往裡的短一點，不碰到照片）
            const inward = side < 0;
            const len = (inward ? 30 : 46) + rnd() * 10, wd = 14 + rnd() * 4;
            const ang = Math.atan2(uy, ux) + side * dir * 0.7;
            const dx = Math.cos(ang), dy = Math.sin(ang);
            const nx = -dy, ny = dx;
            const n = 9;
            const c = rnd() < 0.5 ? leafA : leafB;
            for (let k = 1; k <= n; k++) {
              const u = k / (n + 1), half = Math.sin(Math.PI * Math.pow(u, 0.8)) * wd / 2;
              const bx = x + dx * len * u, by = y + dy * len * u;
              list.push({ x1: bx - nx * half - dx * 3, y1: by - ny * half - dy * 3, x2: bx + nx * half + dx * 3, y2: by + ny * half + dy * 3, color: c, w: 2.9, kind: 'line' });
            }
          }
          side = -side;
          nextLeaf = acc + 50 + rnd() * 24;
        }
      }
    }
    // 兩枝一起往上：交錯排在一起
    const a = branches[0]!, b = branches[1]!;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i < a.length) this.stitches.push(a[i]!);
      if (i < b.length) this.stitches.push(b[i]!);
    }
  }

  private drawStitch(c: CanvasRenderingContext2D, s: Stitch) {
    const hi = mixRgba(s.color, 'bone', 0.4, 0.85);
    if (s.kind === 'knot') {
      c.fillStyle = s.color;
      c.beginPath(); c.arc(s.x1, s.y1, s.w * 0.75, 0, Math.PI * 2); c.fill();
      c.fillStyle = hi;
      c.beginPath(); c.arc(s.x1 - 0.7, s.y1 - 0.8, s.w * 0.3, 0, Math.PI * 2); c.fill();
      return;
    }
    if (s.kind === 'petal') {
      const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2, len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      c.save();
      c.translate(mx, my); c.rotate(Math.atan2(s.y2 - s.y1, s.x2 - s.x1));
      c.strokeStyle = s.color; c.lineWidth = s.w;
      c.beginPath(); c.ellipse(0, 0, len / 2, len * 0.2, 0, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = hi; c.lineWidth = s.w * 0.35;
      c.beginPath(); c.ellipse(-0.5, -0.8, len / 2, len * 0.2, 0, Math.PI * 1.05, Math.PI * 1.9); c.stroke();
      c.restore();
      return;
    }
    c.strokeStyle = s.color; c.lineWidth = s.w;
    c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
    // 線的光澤：一條細的亮線偏左上
    c.strokeStyle = hi; c.lineWidth = s.w * 0.32;
    const o = s.w * 0.2;
    c.beginPath(); c.moveTo(s.x1 - o, s.y1 - o); c.lineTo(s.x2 - o, s.y2 - o); c.stroke();
  }

  /** 繡到第 n 針：只補畫新的；時間倒回去才整張重畫。 */
  private sew(n: number) {
    const L = this.st!, c = L.ctx;
    if (n === this.drawn) return;
    if (n < this.drawn) { L.clear(); this.drawn = 0; }
    c.lineCap = 'round';
    for (let i = this.drawn; i < n; i++) this.drawStitch(c, this.stitches[i]!);
    this.drawn = n;
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, kp = this.kp;
    const u = this.bg.u;
    // 布上印的畫面往焦點推
    const crop = p6Crop(this.ctx, this.img!, t, { zoom: PUSH, screenW: 2 * this.phw });
    setP6Photo(u, this.ctx.params.photo, crop);
    const N = this.stitches.length;
    const p = clamp((t - this.t0) / this.dur);
    const n = Math.floor(N * p);
    this.sew(n);
    const drop = ease.outCubic(prog(t, s, s + 0.5 * kp));
    // 鏡頭：一開始快、之後越來越慢地往焦點推近（焦點往畫面中間移一點）；落下時鏡頭稍微高一點
    const [cx, cy, z] = focusCam(this.foc, settleK(t - s, 6) * this.amp, FOCUS);
    (u.cam!.value as THREE.Vector3).set(cx, cy - 14 * (1 - drop), z);
    (u.hc!.value as THREE.Vector2).set(this.hcx, this.hcy);
    (u.hr!.value as THREE.Vector2).set(this.ax, this.ay);
    u.hw!.value = HOOP_W;
    (u.phHS!.value as THREE.Vector2).set(this.phw, this.phh);
    u.photo!.value = this.tex;
    u.lod!.value = photoLod(this.img!.w * (crop[2] - crop[0]), 2 * this.phw * z);
    u.st!.value = this.st!.texture;
    (u.stR!.value as THREE.Vector4).set(this.stX, this.stY, this.st!.w, this.st!.h);
    u.lift!.value = lerp(1.8, 1, drop);
    // 針：跟著最新的一針（針尖在那一針的終點），一針一下地點動；繡完插在最後的地方
    const cur = this.stitches[Math.max(0, Math.min(N - 1, n - 1))];
    if (cur) {
      const frac = N * p - n;
      const bob = p < 1 ? Math.sin(frac * Math.PI) * 6 : 0;
      const nx = cur.kind === 'knot' ? cur.x1 : cur.x2, ny = cur.kind === 'knot' ? cur.y1 : cur.y2;
      const ang = (cur.x2 > this.st!.w / 2 ? -0.5 : 0.5) + 0.12 * Math.sin(t * 2.1);
      (u.ndl!.value as THREE.Vector4).set(this.stX + nx + bob * 0.4, this.stY + ny - bob, ang, prog(t, this.t0 - 0.2, this.t0 + 0.1));
    } else (u.ndl!.value as THREE.Vector4).set(0, 0, 0, 0);
    const cap = this.cap;
    if (cap.has) {
      cap.draw(t);
      u.tl!.value = cap.L.texture;
      (u.tlR!.value as THREE.Vector4).set(this.tlX - cap.pad, this.tlY - cap.pad, cap.L.w, cap.L.h);
      u.textK!.value = cap.hasMain ? 1 : prog(t, s + 0.3 * kp, s + 0.8 * kp);
    } else { u.tl!.value = this.st!.texture; u.textK!.value = 0; }
    u.k!.value = (0.92 + 0.08 * drop) * (1 - 0.06 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { ...P6_POST };
  }
}
