// 照片版面「底片條」（暗，三張）：一條 35mm 正片（幻燈片的那種，沒曝光的地方是黑的）橫在一片柔光前面，
// 光從後面透過來：齒孔是亮的、片格裡是照片。片條微微彎（兩端往後退、變小、變糊），像拿在手上。
//  - 片條在拍點上一格一格被拉進來（喀、喀），第三拍停住，主角那格（第一張照片）停在中間；
//    接著鏡頭推近主角那格。主角是直的照片時，鏡頭推近的同時轉九十度（底片上直的照片是橫躺的），轉正來看。
//  - 三張照片在各自的片格裡完整放（不裁，比例不一樣的地方是正片的黑），直的照片在片格裡是橫躺的。
//  - 每個小節線一道很淡的反光沿著片基掃過去。片緣有片號（照片是第幾張）。
//  - 字在主角那格下面（直的照片轉正後在右邊）的暗處，思源宋體：主字（賓客留言＋署名，或新人的註解）推近之後淡入，
//    歌詞小一號在下面跟唱；沒有主字時歌詞自己寫在那裡。字只放主角（第一張）的。兩個都沒有就只有片條（主角那格在正中間）。
//  - 推近之後，主角那格裡的畫面再往焦點推（照片在框裡：focusCrop）。
//  - 很小的照片：主角那格推近的大小以照片原尺寸的 1.5 倍為上限，往焦點推也會少推。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter, barAfter } from './_motifs';
import { focusCrop, loadWords, settleK } from './_photo';
import { P1_GLSL, P1Cap, gainOf, p1Uniforms, blitAt, loadPhotos, photoRefs, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, photos: 3, family: 'photo', series: 'film', prefers: ['landscape'], energy: [0.15, 1], bars: [2, 8], weight: 1 };

/** 片格（世界單位）：高 FH、寬 1.5 倍；格距；片緣。 */
const FH = 300, FWW = 450, GAP = 30, RB = 70, PITCH = FWW + GAP;
/** 鏡頭到片條最前面的距離、片條彎的半徑。 */
const D = 2000, R = 3000;

const BG = () => new FSPass(/* glsl */ `
  ${P1_GLSL}
  uniform sampler2D p0; uniform sampler2D p1; uniform sampler2D p2;
  uniform vec3 asp; uniform vec3 rot; uniform vec3 lods;   // 每張照片的長寬比、要不要橫躺、mip 層
  uniform float scroll; uniform float zoom; uniform float roll; uniform vec2 ctr; uniform float sheen; uniform float k; uniform float focusK;
  uniform vec4 crop;   // 主角那格裡的畫面往焦點推：照片完整放的範圍對應到照片的哪一塊
  uniform sampler2D edge; uniform vec2 edgeSize;

  vec3 photoIn(int i, vec2 f, float l) {
    // f：片格裡的位置（0..1，左上原點）；照片完整放在格子裡（橫躺的照片轉九十度）
    float a = i == 0 ? asp.x : i == 1 ? asp.y : asp.z;
    float r = i == 0 ? rot.x : i == 1 ? rot.y : rot.z;
    vec2 g = r > 0.5 ? vec2(f.y, 1.0 - f.x) : f;
    float fa = r > 0.5 ? ${(FH / FWW).toFixed(4)} : ${(FWW / FH).toFixed(4)};
    vec2 sz = a > fa ? vec2(1.0, fa / a) : vec2(a / fa, 1.0);
    vec2 uv = (g - 0.5) / sz + 0.5;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.012);
    if (i == 0) { uv = crop.xy + uv * (crop.zw - crop.xy); l += log2(max(crop.z - crop.x, 1e-3)); }
    vec3 c = i == 0 ? photoLin(p0, uv, l) : i == 1 ? photoLin(p1, uv, l) : photoLin(p2, uv, l);
    return c;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 背後的柔光：一條橫的亮帶（片條後面的擴散板），上下很快暗下去
    vec2 c = rot2(-roll) * (p - ctr) / zoom;
    float band = exp(-pow(c.y / ${FH + 2 * RB}.0, 2.0) * 1.6);
    vec3 back = vec3(0.86, 0.8, 0.7) * 0.72;
    vec3 col = C_INK * 0.8 + back * 0.05 * band + C_INK2 * 0.4;
    // 射線打到彎的片條（圓柱，軸是直的）：s 是沿著片條的位置、v 是上下
    float dx = c.x / ${D}.0, dy = c.y / ${D}.0;
    float A = dx * dx + 1.0, Bq = ${D + R}.0, Cq = ${(D + R) * (D + R) - R * R}.0;
    float disc = Bq * Bq - A * Cq;
    if (disc > 0.0) {
      float tt = (Bq - sqrt(disc)) / A;
      float X = tt * dx, Y = tt * dy, Z = -${D}.0 + tt;
      float th = atan(X, ${R}.0 - Z);
      float s = ${R}.0 * th + scroll, v = Y;
      float depth = tt / ${D}.0;
      float bl = clamp((depth - 1.0) * 9.0, 0.0, 3.0);
      float aa = depth / zoom * (1.0 + bl * 6.0);
      float dS = abs(v) - (${FH / 2 + RB}.0);
      if (dS < aa) {
        vec3 film = vec3(0.012, 0.011, 0.01);
        float pw = depth / zoom;
        float av = abs(v);
        if (av > ${FH / 2}.0) {
          // 片緣：齒孔透光、片號（下面那條）
          float pitch = ${(FH * 0.198).toFixed(2)};
          float u = mod(s + pitch * 0.5, pitch) - pitch * 0.5;
          float hole = sdRound(vec2(u, av - ${(FH / 2 + RB * 0.6).toFixed(1)}), vec2(pitch * 0.27, ${(RB * 0.17).toFixed(2)}), 3.0);
          film = mix(film, back * 0.9, 1.0 - smoothstep(-aa, aa, hole));
          if (v > 0.0) {
            vec4 tx = layerAt(edge, vec2(mod(s, edgeSize.x), av - ${FH / 2}.0 - ${(RB * 0.25).toFixed(2)} + edgeSize.y * 0.5) / edgeSize);
            film = mix(film, back * 0.55, tx.a);
          }
        } else {
          float fi = floor((s + ${PITCH / 2}.0) / ${PITCH}.0);
          float lx = s - fi * ${PITCH}.0;
          if (abs(lx) < ${FWW / 2}.0) {
            vec2 f = vec2((lx + ${FWW / 2}.0) / ${FWW}.0, (v + ${FH / 2}.0) / ${FH}.0);
            // 片格 0 是主角，-1、1 是另外兩張；更外面是沒曝光的黑格
            int idx = fi == 0.0 ? 0 : fi == -1.0 ? 1 : fi == 1.0 ? 2 : -1;
            if (idx >= 0) {
              // 推近之後焦點只在主角那格：旁邊兩格糊掉
              float l = (idx == 0 ? lods.x : idx == 1 ? lods.y : lods.z) + log2(max(pw, 1e-3)) + bl + (idx == 0 ? 0.0 : 3.0 * focusK);
              vec3 ph = photoIn(idx, f, l);
              float e = min(min(f.x, 1.0 - f.x) * ${FWW}.0, min(f.y, 1.0 - f.y) * ${FH}.0);
              film = mix(film, back * ph * 1.12, smoothstep(0.0, 1.5 * pw, e));
            }
          }
        }
        // 片基的反光：一道很淡的斜光沿著片條掃過去
        film += vec3(0.6, 0.58, 0.55) * 0.05 * sheen * exp(-pow((s * 0.4 + v - (sheen * 3000.0 - 1800.0)) / 140.0, 2.0));
        // 越往後越暗一點（離光遠）；推近之後主角那格以外暗下去
        film *= 1.0 - 0.25 * clamp((depth - 1.0) * 4.0, 0.0, 1.0);
        film *= 1.0 - 0.62 * focusK * smoothstep(${FWW / 2}.0, ${FWW / 2 + 160}.0, abs(s));
        col = mix(col, film, 1.0 - smoothstep(-aa, aa, dS));
      }
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...p1Uniforms(),
  p0: { value: null }, p1: { value: null }, p2: { value: null },
  asp: { value: new THREE.Vector3(1, 1, 1) }, rot: { value: new THREE.Vector3() }, lods: { value: new THREE.Vector3() },
  scroll: { value: 0 }, zoom: { value: 1 }, roll: { value: 0 }, ctr: { value: new THREE.Vector2(W / 2, H / 2) }, sheen: { value: 0 }, k: { value: 1 }, focusK: { value: 0 },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  edge: { value: null }, edgeSize: { value: new THREE.Vector2(1, 1) },
});

/**
 * 字（畫面 px）：橫的照片在主角那格下面（寬、矮），直的照片轉正後在右邊（窄、高）。
 * 高度是整塊（主字＋署名＋歌詞）的上限；圖層四邊各多留 PAD（字的軟影）。
 */
const CAP = { wide: { w: 820, h: 270, lines: 3 }, tall: { w: 640, h: 470, lines: 5 } };
const PAD = 20;
/** 橫的照片：字整塊的底（最後一行基線附近）停在這裡，在 HUD 上面。 */
const WIDE_BOTTOM = 930;

export default class Filmroll extends Scene {
  bg = shared('filmroll.bg', BG);
  txt!: Layer2D;
  edge = this.track(new Layer2D(PITCH * 5, 30, undefined, { fast: true }));
  seed = seedOf(this.ctx);
  phs: P1Photo[] = [];
  cap!: P1Cap;
  vert = false;
  /** 推近後主角那格的縮放、片條中心在畫面上的位置。 */
  zEnd = 1.5; cEnd = new THREE.Vector2(W / 2, H / 2);
  /** 字整塊的左上角（畫面 px）。 */
  capX = 0; capY = 0;
  /** 主角的照片在片格裡完整放時，照片的寬是片格的幾倍（往焦點推時算「畫面上的寬」用）。 */
  fitW = 1;
  pulls: number[] = []; tPush = 0;

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx, 3);
    const n = refs[0]!.n;
    const marks = [0, 1, 2, 3, 4].map((i) => `${n + i}  ▸  ${n + i}A`).join('                ');
    await loadText(`${refs[0]!.caption}${refs[0]!.album}${marks}…`);
    await loadWords(this.ctx);
    this.phs = await loadPhotos(this.ctx, refs, (x) => this.track(x));
    const main = this.phs[0]!;
    this.vert = main.h > main.w * 1.02;
    // 字：橫的在主角那格下面（寬），直的轉正後在右邊（窄）；只放主角的
    const cs = this.vert ? CAP.tall : CAP.wide;
    this.txt = this.track(new Layer2D(cs.w + 2 * PAD, cs.h + 2 * PAD, undefined, { fast: true }));
    this.cap = new P1Cap(this.ctx, this.txt.ctx, {
      family: F.ming(500), min: 40, max: 50, w: cs.w, h: cs.h, lineHeight: 1.38, maxLines: cs.lines,
      ink: rgba('bone', 0.94), unsung: rgba('bone', 0.3), sigInk: rgba('bone', 0.72), sigSize: 28,
      shadow: { color: rgba('ink', 0.85), blur: 12 },
    });
    const has = this.cap.has;
    // 推近後主角那格的大小：有字時小一點（橫的格高 420，直的轉正後格高 600），沒字 600／660；照片最多放大 1.5 倍
    const frameScreenH = this.vert ? (has ? 600 : 660) * (FH / FWW) : (has ? 420 : 600);
    const used = this.vert ? Math.min(main.w, main.h * (FH / FWW)) : Math.min(main.h, main.w * (FH / FWW));
    this.zEnd = Math.min(frameScreenH, used * 1.5) / FH;
    const half = (FH / 2 + RB) * this.zEnd;
    if (this.vert) {
      // 直的：片條轉成直的、在左邊；字在右邊，垂直置中（右邊在 HUD 那一欄，字的底要在 HUD 上面）
      this.cEnd.set(has ? 620 : W / 2, has ? 500 : 520);
      this.capX = this.cEnd.x + half + 70;
      this.capY = clamp(this.cEnd.y - this.cap.height / 2, 120, 800 - this.cap.height);
    } else {
      // 橫的：片條在上面、字在下面；字的底固定（只有歌詞時字在比較下面，推近前也不會疊到片條）
      this.cEnd.set(has ? 820 : W / 2, has ? Math.min(330, WIDE_BOTTOM - this.cap.height - 24 - half) : 520);
      this.capX = this.cEnd.x - (FWW / 2) * this.zEnd;
      this.capY = WIDE_BOTTOM - this.cap.height;
    }
    // 主角的照片完整放在片格裡時，照片寬是片格（未轉正時的長邊）的幾倍：照片的 x 沿著片格的長邊（橫躺的直照片是短邊）
    const fx = this.vert ? FH : FWW, fy = this.vert ? FWW : FH;
    this.fitW = (main.w * Math.min(fx / main.w, fy / main.h)) / FWW;
    // 片號
    const ec = this.edge.ctx;
    ec.font = font(F.mono(500), 18);
    ec.fillStyle = '#fff';
    ec.textBaseline = 'middle';
    ec.fillText(marks, 0, 15);
    this.edge.upload();
    // 拉片：拍點上兩下，第三拍停住；短窗格照比例
    const len = end - start;
    if (len < 4) this.pulls = [start + 0.05, start + 0.35, start + 0.65];
    else { const b = beatAfter(audio, start + 0.05); this.pulls = [b, beatAfter(audio, b, 1), beatAfter(audio, b, 2)]; }
    this.tPush = Math.min(this.pulls[2]! + 0.25, len < 4 ? start + 0.9 : barAfter(audio, this.pulls[2]! + 0.1));
    if (this.tPush > end - 1.5) this.tPush = this.pulls[2]! + 0.25;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.phs[0]!.ref);
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1;
    // 拉片：主角那格從右邊三格外面開始，每一下往左拉一格（outExpo 的急停）
    let sc = 3 * PITCH;
    for (const tp of this.pulls) sc -= PITCH * ease.outExpo(prog(t, tp, tp + 0.22));
    // 片門的一點晃動（停住的時候）
    const fr = Math.floor(t * 24);
    sc += (hash(fr, 7) - 0.5) * 1.2 * (1 - prog(t, this.tPush, this.tPush + 0.6));
    u.scroll!.value = -sc;
    // 推近：縮放、片條中心移到目標、直的照片轉九十度
    const pk = ease.inOutCubic(prog(t, this.tPush, this.tPush + 1.2));
    const drift = 1 + 0.03 * (1 - Math.exp(-Math.max(0, t - this.tPush - 1.2) / 7));
    u.zoom!.value = lerp(1, this.zEnd, pk) * drift;
    u.focusK!.value = pk;
    u.roll!.value = (this.vert ? (Math.PI / 2) * pk : 0) + dir * 0.035 * (1 - pk) + dir * 0.008;
    (u.ctr!.value as THREE.Vector2).set(lerp(W / 2, this.cEnd.x, pk), lerp(H / 2 - 20, this.cEnd.y, pk));
    // 推近之後，主角那格裡的畫面往焦點推（很小的照片少推）
    const main = this.phs[0]!;
    const z = u.zoom!.value as number;
    const fk = settleK(t - this.tPush - 0.6, 6);
    (u.crop!.value as THREE.Vector4).set(...focusCrop(main.ref, main.w, main.h, main.aspect, fk, { zoom: 1.28, screenW: this.fitW * FWW * this.zEnd }));
    // 反光：每個小節線掃一次
    const bar = audio.barAt(t), tb = audio.timeOfBar(Math.floor(bar));
    u.sheen!.value = tb >= s - 0.01 ? prog(t, tb, tb + 1.1) * (t < tb + 1.1 ? 1 : 0) : 0;
    const ph = this.phs;
    u.p0!.value = ph[0]!.tex; u.p1!.value = ph[1]!.tex; u.p2!.value = ph[2]!.tex;
    (u.asp!.value as THREE.Vector3).set(ph[0]!.aspect, ph[1]!.aspect, ph[2]!.aspect);
    const vr = ph.map((p) => (p.h > p.w * 1.02 ? 1 : 0));
    (u.rot!.value as THREE.Vector3).set(vr[0]!, vr[1]!, vr[2]!);
    // mip：片格在畫面上的大小（推近後主角那格大）
    const lodOf = (p: P1Photo) => Math.max(0, Math.log2(Math.max(p.w, p.h) / (Math.max(FWW, FH) * z * SCALE)));
    (u.lods!.value as THREE.Vector3).set(lodOf(ph[0]!), lodOf(ph[1]!), lodOf(ph[2]!));
    u.edge!.value = this.edge.texture;
    (u.edgeSize!.value as THREE.Vector2).set(this.edge.w, this.edge.h);
    u.k!.value = ease.outCubic(prog(t, s, s + 0.2)) * (1 - 0.15 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.cap.has) {
      const L = this.txt;
      // 主字推近之後淡入；歌詞在橫的照片時一開始就唱（字在片條下面，推近前也不會疊到），直的照片轉正之後才出來（推近前片條橫在字的位置）
      const mainK = prog(t, this.tPush + 0.8, this.tPush + 1.4, ease.outCubic);
      const lyrK = this.vert ? prog(t, this.tPush + 0.6, this.tPush + 1.2) : prog(t, s + 0.4, s + 0.9);
      if (this.cap.draw(L.ctx, t, PAD, PAD, { alpha: this.cap.hasMain ? mainK : lyrK, lyricAlpha: lyrK, clear: () => L.clear() })) L.upload();
      blitAt(comp, renderer, L, out, this.capX - PAD, this.capY - PAD, 1 - prog(t, e - 0.3, e));
    }
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.14, vignette: 0.5 };
  }
}
