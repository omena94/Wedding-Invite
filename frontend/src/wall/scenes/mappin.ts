// 照片版面「地圖圖釘」（亮）：一張泛黃的老地圖（虛構的海岸線與等高線，沒有任何真的地名），
// 紅色虛線的路線從遠方畫過來，鏡頭跟著筆尖沿路線走：經過的小鎮一個一個點亮、跨過一段海峽，最後停在用圖釘釘在地圖上的照片。
//  - 進場：鏡頭在路線的起點（放大、遠處有一點景深），筆尖往前畫，鏡頭一路跟著；抵達時圖釘「按」下去（影子收緊）。
//    窗格短（3 秒）時路線畫得快，長窗格之後每個小節從圖釘泛出一圈很淡的紅色波紋（「你在這裡」），鏡頭很慢地推近。
//  - 照片是實體相片（白邊、微斜），完整呈現，不裁切；很小的舊照片最多放大到 1.5 倍。
//  - 字像在地圖上用筆寫的旅行筆記（霞鶩文楷、墨色）：主字（賓客留言＋署名，或新人的註解）抵達後一個字一個字寫出來，
//    歌詞在下面小一號跟唱；沒有主字時歌詞寫在同一個位置；兩個都沒有就只有照片（移到中間）。相簿的第一張在上面多一行相簿名。
//    字後面的地圖紋路會淡掉，字才清楚。
//  - 焦點：抵達後相片上的畫面慢慢往新人點的臉推（focusCrop）。
// 畫法：地圖、路線、相片、圖釘是一個全螢幕 shader（路線是 48 點的折線，在 shader 裡量距離畫虛線）；字是一張 Canvas2D 層，跟著鏡頭縮放。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog, smoothstep } from '../engine/util';
import { barAfter } from './_motifs';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'journey', prefers: ['landscape', 'small'], energy: [0, 1], bars: [2, 8], weight: 1 };

const N = 48;
const TOWNS = 5;

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform vec2 cam; uniform float zoom; uniform float blurK; uniform float seedOff; uniform float k;
  uniform vec2 pc; uniform vec2 hs; uniform float bd; uniform float ang;
  uniform vec2 pin; uniform float pinLift;
  uniform vec2 route[${N}]; uniform float rlen[${N}]; uniform float revealLen; uniform vec4 rbox;
  uniform vec3 towns[${TOWNS}];
  uniform vec4 textRect; uniform vec2 ping;
  uniform vec2 compass;

  // 地圖的高度場：> 0 是陸地
  float elev(vec2 w) { return fbm(w / 1100.0 + vec2(seedOff, 3.1), 4) + 0.08; }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w = (p - vec2(${W / 2}.0, ${H / 2}.0)) / zoom + cam;
    // 景深：離畫面中心越遠越糊；鏡頭在走的時候整張再糊一點（像跟拍）
    float blur = clamp(0.14 * smoothstep(420.0, 1150.0, length(p - vec2(${W / 2}.0, ${H / 2}.0))) + blurK, 0.0, 1.0);
    // 紙：泛黃（不管哪個主題，老地圖都是黃的）、斑駁、水漬、很淡的纖維，四周更舊一點
    float st = fbm(w / 420.0 + 7.3, 3);
    float fib = snoise(vec2(w.x / 3.0, w.y / 80.0)) * 0.5 + snoise(vec2(w.x / 70.0, w.y / 3.0)) * 0.5;
    vec3 paper = mix(C_PAPER, C_FUR, 0.13) * (0.955 + 0.03 * st + 0.01 * fib * (1.0 - blur));
    paper = mix(paper, C_FUR * 0.75, 0.10 * smoothstep(0.1, 0.6, fbm(w / 900.0 - 4.0, 3)));
    // 字後面：地圖的紋路淡掉
    vec2 tq = max(abs(w - textRect.xy - textRect.zw * 0.5) - textRect.zw * 0.5, 0.0);
    float calm = 1.0 - 0.8 * exp(-dot(tq, tq) / 2400.0) * step(1.0, textRect.z);
    float e = elev(w);
    float aw = fwidth(e) * (1.2 + 10.0 * blur);
    float land = smoothstep(-aw, aw, e);
    // 海：淡灰；陸地：一層很淡的水彩，沿著海岸線內側再一圈手工上色的色帶（老地圖的畫法）
    vec3 sea = mix(paper, C_ASH, 0.2 + 0.12 * smoothstep(-0.02, -0.2, e));
    vec3 ground = mix(paper, C_GINGHAM, 0.07) * 1.015;
    ground = mix(ground, mix(paper, C_FUR, 0.6), 0.16 * calm * (1.0 - smoothstep(0.0, 0.03, e)));
    vec3 col = mix(sea, ground, land);
    float inkA = 0.0;
    // 海岸線（粗一點）＋海上一圈一圈的水線，越外越淡
    inkA = max(inkA, 0.6 * (1.0 - smoothstep(aw * 0.2, aw * 1.1, abs(e))));
    for (int i = 1; i <= 3; i++) {
      float lv = -0.024 * float(i);
      inkA = max(inkA, (0.28 - 0.07 * float(i)) * (1.0 - smoothstep(0.0, aw * 0.9, abs(e - lv))));
    }
    // 高的地方才有兩三條很淡的等高線
    float cf = fract(e * 7.0);
    float cl = min(cf, 1.0 - cf) / max(fwidth(e * 7.0), 1e-4);
    inkA = max(inkA, 0.13 * land * smoothstep(0.16, 0.3, e) * (1.0 - smoothstep(0.6, 1.6 + 9.0 * blur, cl)));
    // 羅盤：從中心放射的方位線（16 個方向）、八個尖（主方位長、斜的短；一半深一半淺）、一圈細線
    vec2 cq = w - compass;
    float cr = length(cq), th = atan(cq.y, cq.x);
    float a16 = 6.2831853 / 16.0;
    float rl = cr * abs(sin(th - floor(th / a16 + 0.5) * a16));
    inkA = max(inkA, 0.11 * (1.0 - smoothstep(0.4, 1.3 + 6.0 * blur, rl)) * smoothstep(60.0, 90.0, cr) * (1.0 - smoothstep(900.0, 1600.0, cr)));
    if (cr < 110.0) {
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        vec2 lq = rot2(a) * cq;
        float L = (i % 2 == 0) ? 92.0 : 56.0, hw = (i % 2 == 0) ? 15.0 : 11.0;
        float inK = step(0.0, lq.x) * step(abs(lq.y), hw * (1.0 - lq.x / L));
        inkA = max(inkA, inK * (lq.y > 0.0 ? 0.55 : 0.16));
        inkA = max(inkA, 0.5 * step(0.0, lq.x) * step(lq.x, L) * (1.0 - smoothstep(0.4, 1.4, abs(abs(lq.y) - hw * (1.0 - lq.x / L)))));
      }
      inkA = max(inkA, 0.4 * (1.0 - smoothstep(0.5, 1.5 + 6.0 * blur, abs(cr - 40.0))));
    }
    inkA *= calm * (1.0 - 0.45 * blur);
    col = mix(col, C_SEPIA, inkA);

    // ---- 路線：紅色虛線，畫到 revealLen 為止
    if (w.x > rbox.x - 30.0 && w.x < rbox.z + 30.0 && w.y > rbox.y - 30.0 && w.y < rbox.w + 30.0) {
      float best = 1e9, sAt = 0.0;
      for (int i = 0; i < ${N - 1}; i++) {
        vec2 a = route[i], b = route[i + 1];
        vec2 pa = w - a, ba = b - a;
        float h = sat(dot(pa, ba) / max(dot(ba, ba), 1e-3));
        float d = length(pa - ba * h);
        if (d < best) { best = d; sAt = rlen[i] + h * length(ba); }
      }
      float on = step(fract(sAt / 30.0), 0.56) * step(sAt, revealLen);
      float raa = 0.9 + 5.0 * blur;
      float ra = (1.0 - smoothstep(2.4 - raa, 2.4 + raa, best)) * on;
      col = mix(col, C_COLLAR * 0.78, ra * 0.92);
    }
    // 小鎮：圓圈＋點，路線經過時彈出來
    for (int i = 0; i < ${TOWNS}; i++) {
      vec3 tw = towns[i];
      if (tw.z <= 0.0) continue;
      float r = length(w - tw.xy);
      float ring = 1.0 - smoothstep(0.6, 1.6 + 5.0 * blur, abs(r - 12.0 * tw.z));
      float dot_ = 1.0 - smoothstep(4.0 * tw.z - 1.0, 4.0 * tw.z + 1.0 + 5.0 * blur, r);
      col = mix(col, C_SEPIA * 0.9, 0.85 * max(ring, dot_) * sat(tw.z * 2.0));
    }

    // ---- 相片（釘在地圖上：很貼的影子）
    vec2 outer = hs + vec2(bd);
    vec2 so = vec2(5.0, 9.0);
    float ds = sdBox(rot2(ang) * (w - pc - so), outer);
    col *= 1.0 - 0.26 * shadowAt(ds, 13.0);
    vec4 pr = printAt(rot2(ang) * (w - pc), hs, bd, C_BONE * 0.9);
    col = mix(col, pr.rgb, pr.a);

    // ---- 「你在這裡」的波紋
    if (ping.x > 0.0) {
      float rr = length(w - pin);
      col = mix(col, C_COLLAR * 0.8, ping.x * (1.0 - smoothstep(0.8, 2.2, abs(rr - ping.y))));
    }
    // ---- 圖釘：紅色的圓頭（左上打光），影子往右下；按下去之前浮在上面（影子遠、淡）
    vec2 so2 = vec2(9.0, 13.0) * (1.0 + 2.2 * pinLift);
    float dsh = length((w - pin - so2) * vec2(1.0, 1.25)) - 13.0;
    col *= 1.0 - (0.4 / (1.0 + 1.5 * pinLift)) * exp(-max(dsh, 0.0) / (6.0 + 10.0 * pinLift));
    float pr0 = 16.0 * (1.0 + 0.25 * pinLift);
    vec2 pq = (w - pin) / pr0;
    float pd = length(pq);
    float pa = 1.0 - smoothstep(1.0 - 1.5 / pr0, 1.0 + 1.5 / pr0, pd);
    if (pa > 0.0) {
      vec3 n = normalize(vec3(pq, sqrt(max(1.0 - dot(pq, pq), 0.0))));
      float dif = sat(dot(n, normalize(vec3(-0.5, -0.6, 0.65))));
      vec3 head = C_COLLAR * (0.3 + 0.75 * dif);
      head += vec3(0.75) * pow(sat(dot(reflect(vec3(0.0, 0.0, -1.0), n), normalize(vec3(-0.45, -0.55, 0.7)))), 24.0);
      col = mix(col, head, pa);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, cam: { value: new THREE.Vector2() }, zoom: { value: 1 }, blurK: { value: 0 }, seedOff: { value: 0 }, k: { value: 1 },
  pc: { value: new THREE.Vector2() }, hs: { value: new THREE.Vector2() }, bd: { value: 20 }, ang: { value: 0 },
  pin: { value: new THREE.Vector2() }, pinLift: { value: 0 },
  route: { value: Array.from({ length: N }, () => new THREE.Vector2()) }, rlen: { value: new Array(N).fill(0) }, revealLen: { value: 0 }, rbox: { value: new THREE.Vector4() },
  towns: { value: Array.from({ length: TOWNS }, () => new THREE.Vector3()) },
  textRect: { value: new THREE.Vector4() }, ping: { value: new THREE.Vector2() }, compass: { value: new THREE.Vector2() },
});

/** 字塊的寬、高上限（相簿名＋主字＋署名＋歌詞）：60 字的留言在 40 px 排得進四行。 */
const COL_W = 620, COL_H = 440, GAP = 90;
/** 字層：比字塊多留一點邊（寫字的筆畫、小標）。 */
const TL = { w: COL_W + 60, h: COL_H + 60 };

export default class MapPin extends JourneyPlate {
  bg = shared('mappin.bg', BG);
  text = this.track(new Layer2D(TL.w, TL.h, undefined, { fast: true }));
  pcx = 0; pcy = 0; hw = 0; hh = 0; bd = 20; ang = 0;
  pinX = 0; pinY = 0;
  colX = 0; colY = 0;
  pts: THREE.Vector2[] = [];
  lens: number[] = [];
  total = 1;
  townAt: { x: number; y: number; s: number }[] = [];
  /** 路線開始、畫完（抵達）的時間。 */
  t0 = 0; tR = 0;

  override async init() {
    await this.loadPhoto();
    const { start, end } = this.ctx;
    const ink = 'sepia';
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.hand(400), lineHeight: 1.4,
      ink: rgba(ink, 0.9), unsung: rgba(ink, 0.3), active: mixRgba('signal', 'sepia', 0.45), sigInk: rgba(ink, 0.72),
      label: { family: F.hei(500), size: 22, color: rgba(ink, 0.6), tracking: 6, gap: 22 },
    });
    const { w, h } = this.img!;
    const s = this.hasText ? this.fitScale(800, 620) : this.fitScale(1040, 690);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bd = clamp(0.04 * Math.min(w * s, h * s), 14, 26);
    const tw = 2 * (this.hw + this.bd);
    const groupW = this.hasText ? tw + GAP + COL_W : tw;
    const x0 = Math.max(130, (W - groupW) / 2 - (this.hasText ? 0 : 30));
    this.pcx = x0 + tw / 2;
    this.pcy = H / 2 - (this.hasText ? 30 : 50);
    this.colX = x0 + tw + GAP;
    // 字塊跟相片的中線對齊；最後一排的基線不低於 790（鏡頭推近之後也在 HUD 上面）
    const bh = this.blockH();
    this.colY = clamp(this.pcy - bh / 2 - 10, 140, 790 - bh);
    const rnd = mulberry32(this.seed * 7 + 3);
    this.ang = (rnd() * 2 - 1) * 2.4 * (Math.PI / 180);
    // 圖釘：相片上緣中間往下一點（相片座標 → 地圖座標，跟 shader 的 rot2 同一個方向）
    const c = Math.cos(this.ang), sn = Math.sin(this.ang);
    const qx = 0, qy = -(this.hh + this.bd) + 26;
    this.pinX = this.pcx + c * qx - sn * qy;
    this.pinY = this.pcy + sn * qx + c * qy;
    this.buildRoute(rnd);
    // 路線畫多久：窗格短就快一點，抵達之後還要留時間寫字
    const D = clamp(0.32 * (end - start), 1.0, 2.8);
    this.t0 = start + 0.05;
    this.tR = this.t0 + D;
  }

  /** 從畫面左邊很遠的地方蜿蜒過來，最後一段沿著相片下面進來、鑽到相片底下（終點在相片左下角裡面一點）。 */
  private buildRoute(rnd: () => number) {
    const bottom = this.pcy + this.hh + this.bd;
    const ex = this.pcx - this.hw * 0.45, ey = bottom - 50;
    const sx = this.pcx - 1900, sy = H * 0.45 + (rnd() - 0.5) * 220;
    const ctrl: [number, number][] = [[sx, sy]];
    const K = 5, mx = this.pcx - this.hw - this.bd - 420, my = bottom + 100;
    for (let i = 1; i < K; i++) {
      const u = i / K;
      const side = i % 2 === 0 ? 1 : -1;
      ctrl.push([lerp(sx, mx, u) + (rnd() - 0.5) * 80, lerp(sy, my, u) + side * (110 + rnd() * 100)]);
    }
    ctrl.push([mx, my]);
    ctrl.push([ex - 230, bottom + 95 + (rnd() - 0.5) * 30]);
    ctrl.push([ex, ey]);
    // Catmull-Rom 取 N 個點
    const at = (i: number) => ctrl[clamp(i, 0, ctrl.length - 1)]!;
    const seg = ctrl.length - 1;
    this.pts = [];
    for (let k = 0; k < N; k++) {
      const f = (k / (N - 1)) * seg, i = Math.min(seg - 1, Math.floor(f)), u = f - i;
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const cr = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u * u + (-a + 3 * b - 3 * cc + d) * u * u * u);
      this.pts.push(new THREE.Vector2(cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])));
    }
    this.lens = [0];
    for (let k = 1; k < N; k++) this.lens.push(this.lens[k - 1]! + this.pts[k]!.distanceTo(this.pts[k - 1]!));
    this.total = this.lens[N - 1]!;
    // 小鎮：路線上的幾個轉折點（相片底下的不放）
    this.townAt = [];
    for (let i = 1; i <= K && this.townAt.length < TOWNS; i++) {
      const [x, y] = ctrl[i]!;
      if (x > this.pcx - this.hw - this.bd - 40) continue;
      // 沿著路線找最接近的點，換成「路線畫到這裡的長度」
      let best = 0, bd = Infinity;
      for (let k = 0; k < N; k++) { const d = Math.hypot(this.pts[k]!.x - x, this.pts[k]!.y - y); if (d < bd) { bd = d; best = k; } }
      this.townAt.push({ x: this.pts[best]!.x, y: this.pts[best]!.y, s: this.lens[best]! });
    }
  }

  /** 路線上長度 s 的位置。 */
  private along(s: number): [number, number] {
    const L = this.lens;
    let i = 0;
    while (i < N - 2 && L[i + 1]! < s) i++;
    const u = clamp((s - L[i]!) / Math.max(1e-3, L[i + 1]! - L[i]!));
    const a = this.pts[i]!, b = this.pts[i + 1]!;
    return [lerp(a.x, b.x, u), lerp(a.y, b.y, u)];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = prog(t, this.t0, this.tR, ease.inOutCubic);
    const rev = u * this.total;
    const [hx, hy] = this.along(rev);
    // 鏡頭：跟著筆尖走，快到的時候轉向最後的構圖；抵達後很慢地推近
    const settle = smoothstep(0.45, 1.0, u);
    const fx = this.hasText ? (this.pcx + this.colX + COL_W / 2) / 2 : this.pcx;
    const fcx = lerp(W / 2, fx, 0.12), fcy = H / 2;
    const camX = lerp(hx + 300, fcx, settle), camY = lerp(hy - 10, fcy, settle);
    const after = Math.max(0, t - this.tR);
    const zoom = lerp(1.3, 1.0, smoothstep(0.2, 1.0, u)) * (1 + 0.035 * (1 - Math.exp(-after / 6)));
    // 鏡頭在走的時候糊一點（速度越快越糊）
    const speed = Math.abs(prog(t + 0.05, this.t0, this.tR, ease.inOutCubic) - u) * 20;
    const blurK = clamp(speed * 0.35, 0, 0.3);
    const bu = this.bg.u;
    // 相片上的畫面：快抵達時開始往焦點推（路線還在畫的時候先看整張）
    this.setPhoto(bu, 2 * this.hw * zoom, this.focusK(t, this.tR - 0.3), 1.18);
    (bu.cam!.value as THREE.Vector2).set(camX, camY);
    bu.zoom!.value = zoom;
    bu.blurK!.value = blurK;
    bu.seedOff!.value = hash(this.seed, 11) * 40;
    (bu.pc!.value as THREE.Vector2).set(this.pcx, this.pcy);
    (bu.hs!.value as THREE.Vector2).set(this.hw, this.hh);
    bu.bd!.value = this.bd;
    bu.ang!.value = this.ang;
    // 圖釘在抵達的那一刻按下去
    const pinK = prog(t, this.tR - 0.15, this.tR + 0.2, ease.outCubic);
    (bu.pin!.value as THREE.Vector2).set(this.pinX, this.pinY - 10 * (1 - pinK));
    bu.pinLift!.value = 1 - pinK;
    const rt = bu.route!.value as THREE.Vector2[];
    for (let k = 0; k < N; k++) rt[k]!.copy(this.pts[k]!);
    const rl = bu.rlen!.value as number[];
    for (let k = 0; k < N; k++) rl[k] = this.lens[k]!;
    bu.revealLen!.value = rev;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    (bu.rbox!.value as THREE.Vector4).set(x0, y0, x1, y1);
    const tws = bu.towns!.value as THREE.Vector3[];
    for (let i = 0; i < TOWNS; i++) {
      const tw = this.townAt[i];
      if (!tw) { tws[i]!.set(0, 0, 0); continue; }
      // 筆尖經過時彈出來（稍微超過再收回）
      const k = rev >= tw.s ? ease.outBack(clamp((t - this.timeAtLen(tw.s)) / 0.35)) : 0;
      tws[i]!.set(tw.x, tw.y, k);
    }
    (bu.compass!.value as THREE.Vector2).set(this.pcx - 1150, H * 0.5 - 330);
    const bh = this.blockH();
    (bu.textRect!.value as THREE.Vector4).set(this.hasText ? this.colX - 20 : 0, this.colY - 10, this.hasText ? this.blockW() + 40 : 0, bh + 40);
    // 每個小節從圖釘泛出一圈很淡的波紋
    let pg = 0, pr = 0;
    const tb = audio.timeOfBar(Math.floor(audio.barAt(t) + 1e-6));
    if (tb >= barAfter(audio, this.tR + 0.3) - 1e-3 && t >= tb) {
      const a = clamp((t - tb) / 1.6);
      pg = 0.4 * (1 - a);
      pr = 20 + 110 * ease.outCubic(a);
    }
    (bu.ping!.value as THREE.Vector2).set(pg, pr);
    bu.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);

    if (this.hasText) {
      const chars = this.charsAt(t, this.t0 + (this.tR - this.t0) * 0.7, 2);
      this.paintBlock(this.text, t, 30, 20, { chars });
      const op = prog(t, this.t0 + (this.tR - this.t0) * 0.6, this.tR, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      const lx = this.colX - 30, ly = this.colY - 20;
      const sx = W / 2 + (lx - camX) * zoom, sy = H / 2 + (ly - camY) * zoom;
      if (op > 0) blit(comp, renderer, this.text, out, sx, sy, { opacity: op, s: zoom });
    }
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.1, halation: 0.05, vignette: 0.32 };
  }

  /** 路線畫到長度 L 的時間（反解進度的緩動，二分法）。 */
  private timeAtLen(L: number) {
    const target = L / this.total;
    let lo = this.t0, hi = this.tR;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (prog(m, this.t0, this.tR, ease.inOutCubic) < target) lo = m; else hi = m; }
    return hi;
  }
}
