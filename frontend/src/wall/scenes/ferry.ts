// 照片版面「渡輪甲板」（亮）：站在渡輪的欄杆邊往外看海——
//  - 照片用長尾夾夾在木頭扶手上，立著，被海風吹得輕輕晃；切進來時一陣風把照片吹斜、再彈回來，同時太陽從雲後面出來（畫面亮起來）。
//    每個小節再來一陣小風。實體相片（白邊）完整呈現不裁切，很小的舊照片最多放大到原尺寸 1.5 倍；相片上的畫面慢慢往新人點的臉推（focusCrop）。
//  - 船身慢慢搖（海平線跟著斜、上下起伏），海面的波紋往後流，太陽底下一條閃閃的光路（不發光，只是亮）；遠方幾座小島；
//    幾隻海鷗在天上滑翔（往右飛，不會飛進字裡），翅膀在拍點往下拍。
//  - 字手寫在畫面左邊的天空上（霞鶩文楷、墨色，字後面很淡的亮霧）：主字（賓客留言＋署名，或新人的註解）一個字一個字寫出來，
//    歌詞小一號在下面跟唱；沒有主字時歌詞寫在同一個位置；兩個都沒有就只有照片（移到中間）。相簿的第一張在上面多一行相簿名。
// 畫法：天空、海（透視的海面）、島、海鷗、欄杆、照片都在一個全螢幕 shader；字是一張 Canvas2D 層。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog, springStep } from '../engine/util';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'journey', prefers: ['portrait', 'square'], energy: [0, 1], bars: [2, 8], weight: 1 };

/** 扶手頂（照片夾在這裡）。 */
const RAIL = 818;
const GULLS = 4;

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform float t; uniform float k; uniform float roll; uniform float heave; uniform float sunK; uniform float seedOff;
  uniform vec2 pivot; uniform float sway; uniform float flex; uniform vec2 hs; uniform float bd;
  uniform vec4 gulls[${GULLS}]; uniform float flap; uniform vec4 textRect; uniform float zoom; uniform vec2 zc;

  float ridge(float x, float sc, float s) { return snoise(vec2(x / sc, s)) * 0.6 + snoise(vec2(x / (sc * 0.37), s + 4.0)) * 0.25 + snoise(vec2(x / (sc * 0.11), s + 9.0)) * 0.08; }

  vec3 skyAt(vec2 q, float hz, vec3 horizonCol) {
    vec3 sky = mix(mix(C_PAPER, C_BONE, 0.3) * 0.82, horizonCol, smoothstep(0.0, hz, q.y));
    sky += C_SIGNAL * 0.06 * exp(-length((q - vec2(760.0, hz - 120.0)) / vec2(620.0, 260.0)));
    float cl = fbm(vec2((q.x + t * 9.0) / 700.0 + seedOff, q.y / 170.0), 4);
    sky = mix(sky, C_BONE * 0.85, 0.3 * smoothstep(0.12, 0.6, cl) * smoothstep(hz - 40.0, 60.0, q.y));
    // 遠方的島與燈塔
    float isl = hz - 6.0 - 46.0 * max(0.0, ridge(q.x, 260.0, seedOff + 2.0) + 0.1) * (smoothstep(780.0, 380.0, q.x) + smoothstep(1500.0, 1640.0, q.x) * smoothstep(1860.0, 1720.0, q.x));
    vec3 ic = mix(horizonCol, mix(C_SEPIA, C_GINGHAM, 0.4), 0.3);
    sky = mix(sky, ic, smoothstep(isl - 1.0, isl + 1.0, q.y));
    return sky;
  }

  vec3 seaAt(vec2 q, float hz, vec3 horizonCol) {
    float dy = max(q.y - hz, 0.5);
    float z = 900.0 / dy;
    float X = (q.x - ${W / 2}.0) * z / 900.0;
    vec2 sp = vec2(X, z);
    // 波紋：往鏡頭這邊流（z 隨時間變小），近的大、遠的密
    float n = fbm(vec3(sp.x * 0.22, sp.y * 0.55 - t * 0.35, t * 0.18), 3);
    float n2 = snoise(vec3(sp.x * 0.9, sp.y * 2.2 - t * 1.1, t * 0.4));
    vec3 sea = mix(C_PAPER, C_GINGHAM, 0.4) * (0.55 + 0.07 * n + 0.03 * n2);
    // 一道一道的浪（橫的），遠處太密的就淡掉（不要疊紋）
    float ph = sp.y * 1.7 + n * 4.0 + sp.x * 0.12 - t * 1.8;
    float crest = sin(ph);
    sea *= 1.0 + 0.07 * crest * (1.0 - smoothstep(0.4, 1.4, fwidth(ph)));
    sea = mix(sea, mix(C_PAPER, C_ASH, 0.5) * 0.5, smoothstep(0.0, 260.0, dy) * 0.4);
    // 太陽底下的光路：一顆一顆的亮點，跟著波紋閃
    float path = exp(-pow((q.x - 760.0) / (60.0 + dy * 0.9), 2.0));
    vec2 gq = vec2(q.x / 9.0, q.y / 3.5);
    vec2 cell = floor(gq), fq = fract(gq) - 0.5 - (hash22(cell) - 0.5) * 0.5;
    float sp1 = hash12(cell + floor(t * 6.0) * 0.37);
    float gl = step(0.84, sp1) * exp(-dot(fq * vec2(1.0, 1.4), fq * vec2(1.0, 1.4)) * 22.0) * smoothstep(0.1, 0.6, n2 * 0.5 + 0.5);
    sea += mix(C_BONE, C_SIGNAL, 0.25) * (0.2 * path + 0.36 * gl * path) * sunK;
    // 遠處接近天色（霧）
    return mix(sea, horizonCol, exp(-dy / 26.0) * 0.8);
  }

  // 海鷗：兩段折線的翅膀（M 字），g = (x, y, 翼展, 拍翅相位)
  float gull(vec2 q, vec4 g) {
    float s = g.z;
    float fk = 0.5 + 0.5 * cos(6.2831853 * (flap + g.w));
    vec2 c = g.xy;
    float d = 1e9;
    for (int sd = -1; sd <= 1; sd += 2) {
      float sx = float(sd);
      vec2 elbow = c + vec2(sx * 0.48 * s, -0.22 * s + 0.36 * s * (fk - 0.5));
      vec2 tip = c + vec2(sx * s, 0.08 * s + 0.62 * s * (fk - 0.5));
      d = min(d, sdSegment(q, c, elbow) - 1.4);
      d = min(d, sdSegment(q, elbow, tip) - 0.8);
    }
    return d;
  }

  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = zc + (p0 - zc) / zoom;
    // 船身搖：海平線斜、上下起伏（欄杆跟照片在船上，不動）
    vec2 cc = vec2(${W / 2}.0, 600.0);
    vec2 q = cc + rot2(roll) * (p - cc) - vec2(0.0, heave);
    float hz = 600.0;
    vec3 horizonCol = mix(C_PAPER, C_SIGNAL, 0.16) * 0.9;
    vec3 col = q.y < hz ? skyAt(q, hz, horizonCol) : seaAt(q, hz, horizonCol);
    col = mix(col, col * (0.86 + 0.14 * sunK), 1.0);
    for (int i = 0; i < ${GULLS}; i++) {
      float d = gull(q, gulls[i]);
      col = mix(col, mix(C_SEPIA, horizonCol, 0.25) * 0.6, 0.85 * (1.0 - smoothstep(-0.5, 1.0, d)));
    }
    // 字後面一層很淡的亮霧
    vec2 tq = max(abs(p - textRect.xy - textRect.zw * 0.5) - textRect.zw * 0.5, 0.0);
    col = mix(col, mix(C_PAPER, C_BONE, 0.4) * 0.86, 0.45 * exp(-dot(tq, tq) / 6000.0) * step(1.0, textRect.z));

    // ---- 欄杆：木頭扶手（圓管）、白色的直柱與兩條橫桿
    float ry = (p.y - (${RAIL}.0 + 16.0)) / 17.0;
    for (int i = 0; i < 7; i++) {
      float sx = 150.0 + float(i) * 330.0;
      float d = abs(p.x - sx) - 8.0;
      if (d < 1.0 && p.y > ${RAIL}.0 + 20.0) {
        float n = clamp((p.x - sx) / 8.0, -1.0, 1.0);
        vec3 post = C_BONE * 0.8 * (0.7 + 0.3 * sqrt(1.0 - n * n) - 0.1 * n);
        col = mix(col, post, 1.0 - smoothstep(-0.8, 0.8, d));
      }
    }
    for (int j = 0; j < 2; j++) {
      float yy = ${RAIL}.0 + 120.0 + float(j) * 100.0;
      float n = (p.y - yy) / 6.0;
      if (abs(n) < 1.2) col = mix(col, C_BONE * 0.78 * (0.75 + 0.25 * sqrt(max(0.0, 1.0 - n * n)) - 0.1 * n), 1.0 - smoothstep(0.85, 1.15, abs(n)));
    }
    if (abs(ry) < 1.15) {
      float n = clamp(ry, -1.0, 1.0);
      vec3 teak = mix(C_FUR, C_SEPIA, 0.4) * 0.66 * (0.9 + 0.08 * sin(p.x * 0.03 + snoise(vec2(p.x / 90.0, p.y / 4.0)) * 2.5));
      teak *= 0.62 + 0.45 * sqrt(1.0 - n * n) - 0.18 * n;
      teak += C_BONE * 0.06 * exp(-pow((ry + 0.55) / 0.12, 2.0));
      col = mix(col, teak, 1.0 - smoothstep(0.92, 1.12, abs(ry)));
    }
    // 扶手下面的影子
    col *= 1.0 - 0.18 * exp(-max(0.0, p.y - ${RAIL}.0 - 34.0) / 14.0) * step(${RAIL}.0 + 33.0, p.y);

    // ---- 照片：長尾夾夾在扶手上，被風吹著晃（底部固定）
    vec2 lq = rot2(sway) * (p - pivot);
    vec2 pq = lq - vec2(0.0, -(hs.y + bd) + 14.0);
    float dsP = sdBox(pq - vec2(8.0, 6.0), hs + vec2(bd));
    col *= 1.0 - 0.12 * shadowAt(dsP, 18.0);
    vec4 pr = printAt(pq, hs, bd, C_BONE * 0.9);
    // 被風吹得微微彎：亮度跟著彎曲起伏
    float ripple = 1.0 + flex * 0.05 * sin((pq.x / hs.x) * 3.2 + t * 4.0) * (0.5 - 0.5 * pq.y / hs.y);
    col = mix(col, pr.rgb * ripple * (0.88 + 0.12 * sunK), pr.a);
    // 長尾夾：黑色夾身＋兩根銀色的把手
    vec2 cq = lq - vec2(0.0, 12.0);
    float dClip = sdBox(cq, vec2(34.0, 15.0)) - 3.0;
    col *= 1.0 - 0.25 * shadowAt(sdBox(cq - vec2(5.0, 7.0), vec2(34.0, 15.0)), 6.0);
    vec3 clipC = C_INK2 * 1.6 * (1.0 + 0.6 * smoothstep(4.0, -14.0, cq.y));
    col = mix(col, clipC, 1.0 - smoothstep(-0.8, 0.8, dClip));
    for (int sd = -1; sd <= 1; sd += 2) {
      float dw = sdSegment(cq, vec2(float(sd) * 22.0, -12.0), vec2(float(sd) * 14.0, -40.0)) - 2.0;
      col = mix(col, mix(C_BONE, C_ASH, 0.4) * 0.85, 1.0 - smoothstep(-0.7, 0.7, dw));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, t: { value: 0 }, k: { value: 1 }, roll: { value: 0 }, heave: { value: 0 }, sunK: { value: 1 }, seedOff: { value: 0 },
  pivot: { value: new THREE.Vector2() }, sway: { value: 0 }, flex: { value: 0 }, hs: { value: new THREE.Vector2() }, bd: { value: 18 },
  gulls: { value: Array.from({ length: GULLS }, () => new THREE.Vector4()) }, flap: { value: 0 }, textRect: { value: new THREE.Vector4() },
  zoom: { value: 1 }, zc: { value: new THREE.Vector2() },
});

/** 天空上的字塊：寬、高上限（相簿名＋主字＋署名＋歌詞）。60 字的留言在 40 px 排得進四行；長的寫到海平線下面一點（最低 660）。 */
const COL_W = 600, COL_H = 460;

export default class Ferry extends JourneyPlate {
  bg = shared('ferry.bg', BG);
  text = this.track(new Layer2D(COL_W + 40, COL_H + 60, undefined, { fast: true }));
  pcx = 0; hw = 0; hh = 0; bd = 18;
  colX = 0; colY = 0;
  gullBase: [number, number, number, number][] = [];

  override async init() {
    await this.loadPhoto();
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.hand(400), lineHeight: 1.4,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.32), active: mixRgba('signal', 'sepia', 0.4), sigInk: rgba('sepia', 0.72),
      label: { family: F.hand(700), size: 24, color: rgba('sepia', 0.6), tracking: 4, gap: 24 },
    });
    const { w, h } = this.img!;
    // 照片在右邊（夾在扶手上、往上立），字在左邊的天空；沒有說明時照片在中間
    const s = this.fitScale(this.hasText ? 700 : 900, 600);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bd = clamp(0.035 * Math.min(w * s, h * s), 12, 22);
    this.pcx = this.hasText ? Math.min(1230, W - 150 - this.hw - this.bd) : W / 2;
    this.colX = 170;
    const bh = this.blockH();
    this.colY = clamp(370 - bh / 2, 130, 660 - bh);
    // 海鷗：避開照片與字，遠的小、近的大；有字時左邊那隻在字跟照片中間的天上
    const r = (i: number) => hash(this.seed, 20 + i);
    for (let i = 0; i < GULLS; i++) {
      const left = this.hasText ? i === 0 : i % 2 === 0;
      const x = left ? (this.hasText ? 820 + r(i) * 120 : 640 + r(i) * 300) : this.pcx + this.hw + 80 + r(i) * 120;
      this.gullBase.push([x, 120 + r(i + 7) * (this.hasText ? 150 : 230), 18 + r(i + 3) * 18, r(i + 11)]);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const u = this.bg.u;
    u.t!.value = t;
    u.roll!.value = (1.1 * Math.sin(t * 0.83) + 0.4 * Math.sin(t * 1.9 + 1)) * (Math.PI / 180);
    u.heave!.value = 9 * Math.sin(t * 0.61 + 0.5);
    // 太陽從雲後面出來
    u.sunK!.value = 0.55 + 0.45 * ease.inOutQuad(prog(t, s + 0.1, s + 1.0));
    u.seedOff!.value = hash(this.seed, 4) * 20;
    // 照片：切進來一陣風（往一邊吹斜、彈回來），每個小節再一陣小風
    const dir = hash(this.seed, 6) < 0.5 ? -1 : 1;
    let sw = dir * 9 * (1 - springStep(Math.max(0, lt), 1.2, 0.28));
    const bar = audio.timeOfBar(Math.floor(audio.barAt(t) + 1e-6));
    if (bar > s + 0.6 && t >= bar) sw += dir * 2.2 * Math.exp(-(t - bar) * 2.2) * Math.sin((t - bar) * 7.5);
    sw += 0.7 * Math.sin(t * 2.3) + 0.4 * Math.sin(t * 4.1 + 2);
    u.sway!.value = sw * (Math.PI / 180);
    u.flex!.value = clamp(Math.abs(sw) / 4, 0.3, 1);
    (u.pivot!.value as THREE.Vector2).set(this.pcx, RAIL + 2);
    (u.hs!.value as THREE.Vector2).set(this.hw, this.hh);
    u.bd!.value = this.bd;
    // 鏡頭很慢地推近（繞著照片與字中間）
    const zoom = 1 + 0.035 * (1 - Math.exp(-lt / 7));
    const zx = this.hasText ? (this.pcx + this.colX + COL_W / 2) / 2 : this.pcx, zy = 520;
    u.zoom!.value = zoom;
    (u.zc!.value as THREE.Vector2).set(zx, zy);
    // 相片上的畫面往焦點推（風把照片吹斜、彈回來的那一下先看整張）
    this.setPhoto(u, 2 * this.hw * zoom, this.focusK(t, s + 0.4), 1.18);
    // 海鷗：慢慢往右滑翔（不會飛進左邊的字），翅膀在拍點往下拍
    u.flap!.value = audio.beatAt(t) * 0.5;
    const gs = u.gulls!.value as THREE.Vector4[];
    for (let i = 0; i < GULLS; i++) {
      const [x, y, sz, ph] = this.gullBase[i]!;
      gs[i]!.set(x + 18 * Math.sin(t * 0.3 + ph * 6) + lt * (6 + 10 * ph), y + 10 * Math.sin(t * 0.5 + ph * 9), sz, ph);
    }
    const bh = this.blockH();
    (u.textRect!.value as THREE.Vector4).set(this.hasText ? this.colX - 10 : 0, this.colY - 10, this.hasText ? this.blockW() + 20 : 0, bh + 30);
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.hasText) {
      this.paintBlock(this.text, t, 20, 20, { chars: this.charsAt(t, s + 0.6, 2) });
      const op = prog(t, s + 0.4, s + 0.9, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      const lx = this.colX - 20, ly = this.colY - 20;
      if (op > 0) blit(comp, renderer, this.text, out, zx + (lx - zx) * zoom, zy + (ly - zy) * zoom, { opacity: op, s: zoom });
    }
    return { paper: 1, bloom: 0.14, bloomThreshold: 1.1, halation: 0.06, vignette: 0.34 };
  }
}
