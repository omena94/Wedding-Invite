// 照片版面「拼圖」（亮）：灰綠色的切割墊上，一幅快拼好的拼圖（就是這張照片），最後幾片在拍點上拼上去——
//  - 拼圖片有凸耳與凹口（相鄰兩片剛好互補），接縫是一道很細的溝（一邊暗、一邊亮）；缺的那幾格露出底下的切割墊，邊緣有一圈陰影。
//  - 缺的幾片散在拼圖旁邊的墊子上（各自歪著）；從第一個拍點起，一拍一片：拿起來（變大一點、影子拉遠）、轉正、飛過去、
//    落進自己的位置（「喀」地小彈一下）。焦點那一格不會缺，照片的主體從頭到尾都在。窗格短時片數少、間隔短，
//    一定在窗格的前一半拼完，後面是完整的照片；拼好的下一個小節線，一道光斜斜掃過拼圖的亮面。
//  - 焦點：拼圖是印好的，不能在片上推；鏡頭一開始快、越來越慢地往焦點推近，焦點往畫面中間移（盒蓋上的字一直在安全區裡）。
//  - 照片完整呈現成一幅拼圖（不裁），很小的照片最多放大 1.5 倍（鏡頭推近也算進去）。
//  - 字印在右上角的拼圖盒蓋上（像這盒拼圖的名字，思源宋體；盒蓋只比字大一點，字多就長高）：主字（賓客留言＋署名，
//    或新人的註解）＋歌詞小一號在下面跟唱；沒有主字時印歌詞跟唱；兩個都沒有就只有拼圖（在畫面正中間、大一點，
//    缺的片從畫面外飛進來）。相簿的第一張在字上面多一行小小的相簿名。
// 畫法：一個全螢幕 shader。拼圖片的形狀是距離場（方塊加減圓形的凸耳；每條邊的凸耳方向用格子座標雜湊，相鄰兩片一致）；
// 一個點屬於哪一片：先看所在的格子，在格子外就看最近那條邊的鄰居。飛行中的片（最多 8 片）各自反算回拼圖座標再畫。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog } from '../engine/util';
import { beatAfter, barAfter } from './_motifs';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, focusAmp, focusCam, loadPhoto, pace, photoLod, setP6Photo, type FocusCamOpts } from './_p6';
import { settleK } from './_photo';
import type { PhotoImage } from '../photos';

// 縮圖拍在還缺幾片、旁邊散著拼圖片的時候
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, prefers: ['landscape'], energy: [0.2, 1], bars: [2, 8], weight: 1, thumbAt: 0.079 };

/** 最多幾片在飛（uniform 陣列大小）。 */
const NK = 8;

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D tl;
  uniform vec3 cam;
  uniform vec4 pz;          // 拼圖左上角 x, y、寬、高
  uniform vec2 grid;        // 幾欄、幾列
  uniform float seed; uniform float lod;
  uniform vec4 miss[${NK}];   // 缺的片：格子 i, j、這一片的狀態（0 = 還沒放好，1 = 放好了）、有沒有用
  uniform vec4 fly[${NK}];    // 飛行中的片：畫面上的中心 x, y、角度、抬起的高度
  uniform float sweep;      // 掃過拼圖的光（0..1 的位置，< 0 沒有）
  uniform vec4 lid; uniform float lidAng; uniform vec4 tlR; uniform float textK; uniform float lidA;
  uniform float k;

  vec2 cs() { return pz.zw / grid; }
  // 直的邊（格子 i 與 i+1 之間）、橫的邊（j 與 j+1 之間）的凸耳方向：+1 = 往 + 的那一片凸出去
  float sv(vec2 c) { return hash12(c + vec2(seed, 3.7)) > 0.5 ? 1.0 : -1.0; }
  float shz(vec2 c) { return hash12(c + vec2(11.3, seed)) > 0.5 ? 1.0 : -1.0; }
  // 凸耳：邊的中點 e、往 dir 凸出去；細脖子＋圓頭（smin 接成圓滑的一塊）
  float knob(vec2 p, vec2 e, vec2 dir, float r) {
    float head = length(p - e - dir * r * 0.95) - r;
    vec2 q = p - e - dir * r * 0.4;
    float neck = sdBox(vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x))), vec2(r * 0.5, r * 0.4));
    return smin(head, neck, r * 0.3);
  }
  // 第 c 片在拼圖座標 p 的距離場（負的在片裡面）
  float piece(vec2 c, vec2 p) {
    vec2 s = cs();
    vec2 ctr = (c + 0.5) * s;
    float d = sdBox(p - ctr, s * 0.5);
    float r = min(s.x, s.y) * 0.165;
    // 右、左、下、上：凸耳往 + 的方向（sg > 0）時，屬於 - 那一片
    if (c.x < grid.x - 1.0) { float sg = sv(c); float kd = knob(p, vec2((c.x + 1.0) * s.x, ctr.y), vec2(sg, 0.0), r); d = sg > 0.0 ? min(d, kd) : max(d, -kd); }
    if (c.x > 0.0) { float sg = sv(c - vec2(1.0, 0.0)); float kd = knob(p, vec2(c.x * s.x, ctr.y), vec2(sg, 0.0), r); d = sg > 0.0 ? max(d, -kd) : min(d, kd); }
    if (c.y < grid.y - 1.0) { float sg = shz(c); float kd = knob(p, vec2(ctr.x, (c.y + 1.0) * s.y), vec2(0.0, sg), r); d = sg > 0.0 ? min(d, kd) : max(d, -kd); }
    if (c.y > 0.0) { float sg = shz(c - vec2(0.0, 1.0)); float kd = knob(p, vec2(ctr.x, c.y * s.y), vec2(0.0, sg), r); d = sg > 0.0 ? max(d, -kd) : min(d, kd); }
    return d;
  }
  // 這一點屬於哪一片、離接縫多遠
  vec3 owner(vec2 p) {
    vec2 s = cs();
    vec2 c = clamp(floor(p / s), vec2(0.0), grid - 1.0);
    float d = piece(c, p);
    if (d > 0.0) {
      vec2 f = p / s - c - 0.5;
      vec2 nc = abs(f.x) > abs(f.y) ? c + vec2(sign(f.x), 0.0) : c + vec2(0.0, sign(f.y));
      if (nc.x >= 0.0 && nc.y >= 0.0 && nc.x < grid.x && nc.y < grid.y) {
        float d2 = piece(nc, p);
        if (d2 < d) { c = nc; d = d2; }
      }
    }
    return vec3(c, d);
  }
  vec3 mat(vec2 wp) {
    // 切割墊：灰綠色，很淡的格線（每 40 一條、每 200 粗一點）
    vec3 m = mix(C_GINGHAM, C_BONE, 0.38) * 0.82;
    m *= 0.97 + 0.03 * fbm(wp / 300.0, 2);
    vec2 g = abs(fract(wp / 40.0 + 0.5) - 0.5) * 40.0;
    vec2 G = abs(fract(wp / 200.0 + 0.5) - 0.5) * 200.0;
    float line = max(1.0 - smoothstep(0.3, 1.0, min(g.x, g.y)), 1.0 - smoothstep(0.6, 1.6, min(G.x, G.y)));
    return m * (1.0 - 0.07 * line);
  }
  vec3 pieceCol(vec2 p, float d, float lift) {
    vec2 uv = clamp(p / pz.zw, 0.0, 1.0);
    vec3 c = p6Photo(photo, uv, lod);
    // 片的邊：一道細溝（左上亮、右下暗的斜角），抬起來的片整片亮一點
    float bev = 1.0 - smoothstep(0.0, 2.2, -d);
    c *= 1.0 - 0.22 * bev;
    c *= 1.0 + 0.05 * lift;
    return c;
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 wp = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    vec3 col = mat(wp);
    // ---- 拼圖盒蓋（右上）：白色紙盒、上緣一條主題色的帶子、印著註解
    if (lid.z > 0.0) {
      vec2 lq = rot2(lidAng) * (wp - lid.xy);
      float ld = sdBox(lq, lid.zw);
      col *= 1.0 - 0.28 * lidA * exp(-max(sdBox(lq - vec2(8.0, 14.0), lid.zw), 0.0) / 14.0);
      float la = aaFill(ld) * lidA;
      vec3 lc = p6Paper(lq * 1.2, C_BONE * 0.9);
      // 盒蓋的側邊（厚度）：外圈一圈比較暗
      lc *= 1.0 - 0.14 * (1.0 - smoothstep(10.0, 13.0, -ld));
      lc *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 1.5, abs(ld + 12.0)));
      float band = 1.0 - smoothstep(-0.8, 0.8, lq.y - (-lid.w + 50.0));
      lc = mix(lc, mix(C_PAPER, C_SIGNAL, 0.5) * 0.8, band * step(12.0, -ld));
      vec4 tx = p6Layer(tl, lq + lid.zw - tlR.xy, tlR.zw) * textK;
      lc = lc * (1.0 - tx.a) + tx.rgb;
      col = mix(col, lc, la);
    }
    // ---- 拼圖
    vec2 pp = wp - pz.xy;
    float inP = aaFill(sdBox(pp - pz.zw * 0.5, pz.zw * 0.5));
    // 拼圖整塊在墊子上的影子
    col *= 1.0 - 0.22 * exp(-max(sdBox(pp - pz.zw * 0.5 - vec2(4.0, 7.0), pz.zw * 0.5), 0.0) / 8.0);
    if (inP > 0.0) {
      vec3 o = owner(pp);
      // 這一片是不是還缺著
      float missing = 0.0;
      for (int i = 0; i < ${NK}; i++) { vec4 m = miss[i]; if (m.w > 0.5 && m.z < 0.5 && m.x == o.x && m.y == o.y) missing = 1.0; }
      vec3 pc = pieceCol(pp, o.z, 0.0);
      // 接縫：細溝（右下側暗、左上側亮一點）
      float seam = 1.0 - smoothstep(0.4, 1.4, abs(o.z));
      pc *= 1.0 - 0.24 * seam;
      // 亮面上掃過的光
      if (sweep >= 0.0) { float sx = (pp.x + pp.y * 0.6) / (pz.z + pz.w * 0.6); pc += C_BONE * 0.07 * exp(-pow((sx - sweep) / 0.05, 2.0)); }
      // 缺的格子：墊子＋一圈往裡的陰影（鄰居的片比較高）
      vec3 hole = mat(wp) * (1.0 - 0.32 * exp(-max(-o.z, 0.0) / 5.0));
      col = mix(col, mix(pc, hole, missing), inP);
    }
    // ---- 飛行中的片：先畫影子、再畫片
    for (int i = 0; i < ${NK}; i++) {
      vec4 m = miss[i]; vec4 f = fly[i];
      if (m.w < 0.5 || m.z > 0.5) continue;
      float sc = 1.0 + 0.06 * f.w;
      vec2 home = (m.xy + 0.5) * cs();
      vec2 so = vec2(6.0, 10.0) * (1.0 + 2.4 * f.w);
      vec2 qs = home + rot2(f.z) * (wp - so - f.xy) / sc;
      float ds = piece(m.xy, qs);
      col *= 1.0 - (0.3 / (1.0 + f.w)) * (1.0 - smoothstep(-3.0, 5.0 + 12.0 * f.w, ds));
      vec2 q = home + rot2(f.z) * (wp - f.xy) / sc;
      float d = piece(m.xy, q);
      float a = 1.0 - smoothstep(-0.8, 0.8, d * sc);
      if (a > 0.0) col = mix(col, pieceCol(q, d, f.w), a);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, tl: { value: null }, cam: { value: new THREE.Vector3(W / 2, H / 2, 1) },
  pz: { value: new THREE.Vector4(0, 0, 1, 1) }, grid: { value: new THREE.Vector2(4, 3) }, seed: { value: 0 }, lod: { value: 0 },
  miss: { value: Array.from({ length: NK }, () => new THREE.Vector4()) }, fly: { value: Array.from({ length: NK }, () => new THREE.Vector4()) },
  sweep: { value: -1 }, lid: { value: new THREE.Vector4() }, lidAng: { value: 0 }, tlR: { value: new THREE.Vector4(0, 0, 1, 1) }, textK: { value: 0 }, lidA: { value: 0 },
  k: { value: 1 },
});

interface Missing { i: number; j: number; x0: number; y0: number; a0: number; tUp: number; tLand: number }

export default class Jigsaw extends Scene {
  bg = shared('jigsaw.bg', BG);
  // 字：盒蓋上寬 460、最多六行（60 字的留言＋署名＋歌詞也放得下），整塊最高 440（盒蓋上下各多 80，從 120 到 HUD 上面放得下）
  cap = this.track(new Caption(460, 440, { family: F.ming(700), align: 'left', lineHeight: 1.42, maxLines: 6, ink: rgba('sepia', 0.9), labelFamily: F.hei(500), label: mixRgba('sepia', 'signal', 0.3, 0.75) }));
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  px = 0; py = 0; pw = 100; ph = 100; nx = 4; ny = 3; csx = 100; csy = 100;
  miss: Missing[] = [];
  lidX = 0; lidY = 0; lidW = 0; lidH = 0; lidAng = 0;
  tDone = 0; tSweep = Infinity; kp = 1;
  span: [number, number] = [Infinity, Infinity];
  /** 鏡頭往焦點推：焦點（世界座標）、推到幾倍、幅度（盒蓋不能被推出安全區）。 */
  foc: [number, number] = [W / 2, H / 2];
  focus: FocusCamOpts = { zoom: 1.08, pull: 0.3 };
  amp = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { start, end, audio } = this.ctx;
    const cap = this.cap;
    cap.setup(this.ctx, ph);
    const { w, h } = img;
    const D = end - start;
    // 拼圖：有字時在左邊（盒蓋在右上），沒有字時在正中間
    const s = fitPhoto(w, h, cap.has ? 960 : 1320, cap.has ? 820 : 840);
    this.pw = w * s; this.ph = h * s;
    const cx = cap.has ? 630 : W / 2, cy = cap.has ? 530 : 528;
    this.px = cx - this.pw / 2; this.py = cy - this.ph / 2;
    // 格子：一片約 130 px（欄數、列數各自取整數，片是差不多正方的長方形；照片不拉伸也不裁）
    const target = clamp(Math.min(this.pw, this.ph) / 3.2, 92, 140);
    this.nx = Math.max(3, Math.round(this.pw / target));
    this.ny = Math.max(2, Math.round(this.ph / target));
    this.csx = this.pw / this.nx; this.csy = this.ph / this.ny;
    const rnd = mulberry32(Math.floor(hash(this.seed, 41) * 1e9));
    // 缺的片：避開焦點那一格與它的鄰居，彼此不相鄰
    const K = D < 5 ? 4 : D < 8 ? 5 : 6;
    const fi = Math.floor(ph.fx * this.nx), fj = Math.floor(ph.fy * this.ny);
    const cells: [number, number][] = [];
    for (let tries = 0; cells.length < K && tries < 400; tries++) {
      const i = Math.floor(rnd() * this.nx), j = Math.floor(rnd() * this.ny);
      if (Math.abs(i - fi) <= 1 && Math.abs(j - fj) <= 1) continue;
      if (cells.some(([a, b]) => Math.abs(a - i) <= 1 && Math.abs(b - j) <= 1)) continue;
      cells.push([i, j]);
    }
    // 一拍一片（拍子太密就兩拍一片）；一定在窗格的前一半拼完
    this.kp = pace(this.ctx);
    const t0 = beatAfter(audio, start + 0.45 * this.kp);
    const per = audio.beatPeriod(t0) < 0.36 ? 2 : 1;
    const lands = cells.map((_, k) => beatAfter(audio, t0, 1 + k * per));
    const latest = start + Math.max(1.4, 0.48 * D);
    const last = lands[lands.length - 1] ?? t0;
    const squeeze = last > latest ? (latest - (start + 0.6 * this.kp)) / Math.max(0.1, last - (start + 0.6 * this.kp)) : 1;
    // 散在墊子上的位置：有字時在拼圖右邊、盒蓋下面；沒有字時從畫面外飛進來
    const right = this.px + this.pw + 70;
    cells.forEach(([i, j], k) => {
      const land = squeeze < 1 ? start + 0.6 * this.kp + (lands[k]! - (start + 0.6 * this.kp)) * squeeze : lands[k]!;
      let x0: number, y0: number;
      if (cap.has && right < 1500) {
        x0 = lerp(right + 40, 1290, rnd()); y0 = lerp(660, 800, rnd());
        if (k % 2) { x0 = lerp(this.px + 40, this.px + this.pw - 40, rnd()); y0 = Math.min(1010, this.py + this.ph + 70 + rnd() * 30); }
      } else {
        const side = k % 2 ? -1 : 1;
        x0 = side > 0 ? W + 160 : -160; y0 = lerp(220, 860, rnd());
      }
      const dur = Math.min(0.75, 0.6 * this.kp + 0.15);
      this.miss.push({ i, j, x0, y0, a0: (rnd() * 2 - 1) * 0.9, tUp: land - dur, tLand: land });
    });
    this.tDone = this.miss.length ? Math.max(...this.miss.map((m) => m.tLand)) : start;
    const sw = barAfter(audio, this.tDone + 0.1);
    this.tSweep = sw < end - 0.8 ? sw : Infinity;
    if (cap.has) {
      this.lidW = Math.max(cap.blockW, 300) / 2 + 46; this.lidH = cap.blockH / 2 + 50 + 30;
      this.lidX = clamp(1490, Math.max(this.px + this.pw + 50, 1150) + this.lidW, 1800 - this.lidW);
      // 盒蓋的下緣在 HUD 上面（字多盒蓋長高時往上）
      this.lidY = Math.max(120 + this.lidH, Math.min(330, 600 - this.lidH * 0.3, 820 - this.lidH));
      this.lidAng = (hash(this.seed, 13) * 2 - 1) * 2.2 * (Math.PI / 180);
    }
    // 焦點：拼圖上焦點的位置；很小的照片推近也不超過原尺寸 1.5 倍（至少推 3%）
    this.foc = [this.px + ph.fx * this.pw, this.py + ph.fy * this.ph];
    this.focus = { zoom: clamp(1.5 * w / this.pw, 1.03, 1.07), pull: 0.25 };
    // 盒蓋稍微斜（最多 2.2°）：四邊多留一點
    const m = 10;
    this.amp = cap.has ? focusAmp(this.foc, this.focus, [[this.lidX - this.lidW - m, this.lidY - this.lidH - m, this.lidX + this.lidW + m, this.lidY + this.lidH + m]]) : 1;
    // 盒蓋上的字是印好的：一開始就在
    cap.writeAt(start - 1, 0.01);
    this.span = cap.span(this.ctx);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    // 拼圖是印好的：片上不推（整張），鏡頭往焦點推
    setP6Photo(u, this.ctx.params.photo);
    const [cx, cy, z] = focusCam(this.foc, settleK(t - s, 6) * this.amp, this.focus);
    (u.cam!.value as THREE.Vector3).set(cx, cy, z);
    (u.pz!.value as THREE.Vector4).set(this.px, this.py, this.pw, this.ph);
    (u.grid!.value as THREE.Vector2).set(this.nx, this.ny);
    u.seed!.value = (this.seed % 97) + 0.5;
    u.photo!.value = this.tex;
    u.lod!.value = photoLod(this.img!.w, this.pw * z);
    const miss = u.miss!.value as THREE.Vector4[], fly = u.fly!.value as THREE.Vector4[];
    for (let k = 0; k < NK; k++) {
      const m = this.miss[k];
      if (!m) { miss[k]!.set(0, 0, 0, 0); continue; }
      const placed = t >= m.tLand ? 1 : 0;
      miss[k]!.set(m.i, m.j, placed, 1);
      // 拿起來 → 飛過去、轉正 → 落下
      const p = prog(t, m.tUp, m.tLand);
      const mv = ease.inOutCubic(prog(p, 0.1, 0.9));
      const hx = this.px + (m.i + 0.5) * this.csx, hy = this.py + (m.j + 0.5) * this.csy;
      const arc = Math.sin(Math.PI * mv) * 60;
      const lift = p <= 0 ? 0 : Math.sin(Math.PI * Math.min(1, p * 1.05)) * 1.0;
      fly[k]!.set(lerp(m.x0, hx, mv), lerp(m.y0, hy, mv) - arc, m.a0 * (1 - mv), lift);
    }
    u.sweep!.value = t >= this.tSweep ? prog(t, this.tSweep, this.tSweep + 1.2) * 1.4 - 0.2 : -1;
    const cap = this.cap;
    if (cap.has) {
      cap.draw(t);
      const [a, b] = this.span;
      const la = ease.outCubic(prog(t, Math.min(a, s + 0.1) - 0.3, Math.min(a, s + 0.1))) * (1 - prog(t, b, b + 0.4));
      u.lidA!.value = la;
      (u.lid!.value as THREE.Vector4).set(this.lidX, this.lidY, la > 0.001 ? this.lidW : 0, this.lidH);
      u.lidAng!.value = this.lidAng;
      u.tl!.value = cap.L.texture;
      (u.tlR!.value as THREE.Vector4).set(this.lidW - cap.blockW / 2 - cap.pad, 80 - cap.pad, cap.L.w, cap.L.h);
      u.textK!.value = cap.hasMain ? 1 : prog(t, a, a + 0.3);
    } else { u.tl!.value = this.tex; (u.lid!.value as THREE.Vector4).set(0, 0, 0, 0); u.textK!.value = 0; u.lidA!.value = 0; }
    u.k!.value = (0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.06 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    // 片落下的那一下，畫面很輕地震一下
    let bump = 0;
    for (const m of this.miss) bump = Math.max(bump, t >= m.tLand ? Math.exp(-(t - m.tLand) / 0.08) : 0);
    return { ...P6_POST, zoom: 1 + 0.004 * bump };
  }
}
