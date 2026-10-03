// 照片版面「海邊」（亮）：蹲在沙灘上往海看，照片插在沙裡立著——
//  - 每個小節一道浪「刷」上沙灘（白色的浪花邊往前推、薄薄一層水），剛好漫到照片腳邊，再退回去，留下一片慢慢乾掉的濕沙；
//    濕沙上看得到照片的倒影。海面上一道一道的浪往岸邊推，天邊很淡的雲。切進來時鏡頭從海面往下搖到沙灘、第一道浪同時湧上來。
//  - 照片是實體相片（白邊），下緣插進沙裡、腳邊堆了一點沙，完整呈現（只埋掉白邊）；很小的舊照片最多放大到原尺寸 1.5 倍。
//    相片上的畫面慢慢往新人點的臉推（focusCrop）。
//  - 主字（賓客留言＋署名，或新人的註解）是用手指寫在沙上的字（霞鶩文楷，寫成沙上的凹痕：字裡比較深、上緣有陰影、下緣有一道亮邊），
//    在右邊浪打不到的乾沙上，一個字一個字寫出來；相簿的第一張在上面多一行相簿名。
//    沙上的位置只放得下主字＋署名：有主字時歌詞（lyricsApart）像字幕一樣印在同一欄上面的天空，位置固定；
//    沒有主字時歌詞自己寫在沙上跟唱（唱到的字帶一點訊號色）；兩個都沒有就只有照片（移到中間）。
// 畫法：天空、海、浪、沙、照片、倒影都在一個全螢幕 shader；沙上的字是一張 Canvas2D 層，shader 取樣三次做出凹痕；
// 天空的歌詞是另一張層，直接貼到畫面上。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'journey', prefers: ['landscape', 'square'], energy: [0, 1], bars: [2, 8], weight: 1 };

const HZ = 230;

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform sampler2D textTex; uniform vec2 textSize; uniform vec4 textRect;
  uniform float t; uniform float k; uniform float seedOff; uniform vec2 zc; uniform float zoom; uniform float pan;
  uniform vec2 pc; uniform vec2 hs; uniform float bd; uniform float ang; uniform float base;
  uniform float reach; uniform float wetMax; uniform float wetK;

  float shore(float x) { return 450.0 + 140.0 * smoothstep(1500.0, 300.0, x); }
  float reachLen(float x) { return 70.0 + 140.0 * smoothstep(1250.0, 450.0, x); }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w = zc + (p - zc) / zoom + vec2(0.0, pan);
    float hz = ${HZ}.0;
    // ---- 天空
    vec3 horizonCol = mix(C_PAPER, C_SIGNAL, 0.14) * 0.9;
    vec3 col = mix(mix(C_PAPER, C_BONE, 0.35) * 0.84, horizonCol, smoothstep(-200.0, hz, w.y));
    col += C_SIGNAL * 0.05 * exp(-length((w - vec2(1600.0, hz - 120.0)) / vec2(500.0, 220.0)));
    float cl = fbm(vec2((w.x + t * 8.0) / 800.0 + seedOff, w.y / 120.0), 4);
    col = mix(col, C_BONE * 0.86, 0.28 * smoothstep(0.15, 0.6, cl) * smoothstep(hz, -100.0, w.y));
    float ys = shore(w.x);
    if (w.y > hz) {
      // ---- 海：遠的淡、往岸邊一道一道的浪（越近越寬），岸邊一條白色的碎浪
      float u = clamp((w.y - hz) / (ys - hz), 0.0, 1.0);
      vec3 sea = mix(horizonCol, mix(C_PAPER, C_GINGHAM, 0.45) * 0.68, smoothstep(0.0, 0.5, u));
      float ph = pow(u, 0.6) * 9.0 - t * 0.45 + 0.4 * snoise(vec2(w.x / 260.0, u * 3.0 + seedOff));
      float crest = smoothstep(0.86, 1.0, sin(ph * 6.2831853));
      sea = mix(sea, C_BONE * 0.86, crest * 0.5 * smoothstep(0.1, 0.6, u));
      sea = mix(sea, C_BONE * 0.88, exp(-pow((u - 0.93) / 0.05, 2.0)) * (0.65 + 0.35 * snoise(vec2(w.x / 120.0, t * 0.5))));
      sea += C_BONE * 0.05 * smoothstep(0.95, 1.0, hash12(floor(w / vec2(6.0, 3.0)) + floor(t * 5.0))) * exp(-abs(w.x - 1600.0) / 300.0) * (1.0 - u);
      col = sea;
      if (w.y > ys) {
        // ---- 沙：乾沙（細砂、很淡的風紋），浪漫過的地方是濕的（深一點、映著天空）
        float g = snoise(w / 2.2) * 0.5 + snoise(w / 7.0) * 0.5;
        vec3 sand = mix(C_PAPER, C_FUR, 0.3) * (0.86 + 0.025 * g);
        // 風紋（越近越寬）、離鏡頭越近越暗一點；岸邊一直濕著的一條
        float rp = sin(w.x * 0.012 + w.y * (0.05 + 0.04 * (w.y - ys) / 500.0) + 3.0 * snoise(w / 260.0));
        sand *= (1.0 + 0.035 * rp) * (1.0 - 0.08 * smoothstep(ys, ${H}.0, w.y));
        sand = mix(sand, mix(sand, C_SEPIA, 0.12) * 0.82, 1.0 - smoothstep(ys, ys + 46.0, w.y));
        float rl = reachLen(w.x);
        // 字那一欄的浪少打上來一點（最多少四成，浪花線照樣是順的弧線，不會折出一道斜邊），浪頭停在字塊上緣附近
        if (textRect.z > 0.0) rl = mix(rl, min(rl, max(rl * 0.6, textRect.y - 14.0 - ys)), smoothstep(textRect.x - 460.0, textRect.x - 20.0, w.x));
        float yWet = ys + rl * wetMax;
        float wet = wetK * (1.0 - smoothstep(yWet - 30.0, yWet + 10.0, w.y));
        vec3 wetSand = mix(sand, C_SEPIA, 0.12) * 0.8 + horizonCol * 0.06;
        col = mix(sand, wetSand, wet);
        // 浪：薄薄一層水推上來，最前面一條白色的泡沫
        float yF = ys + rl * reach * (1.0 + 0.06 * sin(w.x / 170.0 + t * 1.3));
        if (w.y < yF + 14.0) {
          float sheet = 1.0 - smoothstep(yF - 4.0, yF + 2.0, w.y);
          vec3 water = mix(wetSand, horizonCol * 0.95, 0.45);
          col = mix(col, water, sheet * 0.75);
          float foam = exp(-pow((w.y - yF + 6.0) / 11.0, 2.0)) * (0.55 + 0.45 * snoise(vec2(w.x / 70.0, t * 0.7)));
          foam += 0.18 * smoothstep(0.3, 0.9, snoise(w / vec2(60.0, 14.0) + t * 0.3)) * sheet * smoothstep(ys, yF, w.y);
          col = mix(col, C_BONE * 0.88, clamp(foam, 0.0, 1.0) * step(0.02, reach));
        }
        // ---- 照片的倒影（濕沙或水上，往下翻、糊、淡）
        float refl = max(wet, (1.0 - smoothstep(yF - 4.0, yF + 2.0, w.y)) * step(0.02, reach));
        if (refl > 0.0 && w.y > base) {
          vec2 m = vec2(w.x, 2.0 * base - w.y + 10.0);
          vec4 rp = printAt(rot2(ang) * (m - pc), hs, bd, C_BONE * 0.9);
          col = mix(col, rp.rgb * 0.8, rp.a * refl * 0.28 * smoothstep(base + 200.0, base, w.y));
        }
        // ---- 沙上的字：取樣三次做出凹痕（上緣陰影、下緣亮邊）
        if (textRect.z > 0.0 && w.x > textRect.x - 10.0 && w.x < textRect.x + textRect.z + 10.0 && w.y > textRect.y - 10.0 && w.y < textRect.y + textRect.w + 10.0) {
          // 沙面有一點透視：上面窄一點
          float vy = (w.y - textRect.y) / textRect.w;
          float sx = 0.94 + 0.06 * vy;
          vec2 lq = vec2(textRect.x + (w.x - textRect.x - textRect.z * 0.5) / sx + textRect.z * 0.5, w.y);
          vec2 luv = (lq - textRect.xy) / textSize;
          vec2 dv = vec2(0.0, 2.2) / textSize;
          vec4 a0 = layerAt(textTex, luv);
          float aU = layerAt(textTex, luv - dv).a, aD = layerAt(textTex, luv + dv).a;
          vec3 ink = a0.a > 0.001 ? a0.rgb / a0.a : vec3(0.0);
          vec3 groove = mix(mix(col, C_SEPIA, 0.58) * 0.66, ink, 0.35);
          col = mix(col, groove, a0.a * 0.82);
          col *= 1.0 - 0.3 * clamp(a0.a - aU, 0.0, 1.0);
          col += C_BONE * 0.12 * clamp(aD - a0.a, 0.0, 1.0);
        }
      }
    }
    // ---- 照片：插在沙裡（下緣埋住），腳邊一小堆沙
    vec2 q = rot2(ang) * (w - pc);
    float mound = base - 8.0 + 10.0 * (1.0 - smoothstep(0.0, hs.x * 0.9 + 60.0, abs(w.x - pc.x))) - 3.0 * snoise(vec2(w.x / 90.0, 1.0));
    vec4 pr = printAt(q, hs, bd, C_BONE * 0.9);
    float vis = 1.0 - smoothstep(mound - 1.0, mound + 1.0, w.y);
    col = mix(col, pr.rgb, pr.a * vis);
    // 照片插進沙裡的那一道：沙面一條很淡的接觸影
    float md = w.y - mound;
    col *= 1.0 - 0.2 * exp(-max(md, 0.0) / 5.0) * step(-0.5, md) * (1.0 - smoothstep(hs.x + bd - 10.0, hs.x + bd + 20.0, abs(q.x)));
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, textTex: { value: null }, textSize: { value: new THREE.Vector2(1, 1) }, textRect: { value: new THREE.Vector4() },
  t: { value: 0 }, k: { value: 1 }, seedOff: { value: 0 }, zc: { value: new THREE.Vector2() }, zoom: { value: 1 }, pan: { value: 0 },
  pc: { value: new THREE.Vector2() }, hs: { value: new THREE.Vector2() }, bd: { value: 18 }, ang: { value: 0 }, base: { value: 790 },
  reach: { value: 0 }, wetMax: { value: 0 }, wetK: { value: 0 },
});

/**
 * 沙上的字塊：寬、高上限（相簿名＋主字＋署名；歌詞在天空另外放）。60 字的留言在 40 px 排得進四行。
 * 右邊的乾沙從 y ≈ 540 開始（浪最遠打到這裡），最後一排最低到 815（HUD 區 y ≥ 830 的上面）。
 */
const COL_W = 680, COL_H = 300;
/**
 * 字層的左緣（畫面座標）、字塊頂最高與最低（短的字從乾沙的上緣寫起，長的往上挪）、最後一排基線最低到哪裡。
 * 鏡頭推近 3.5% 之後右緣在 1810 以內、最後一排在 822 以內。
 */
const TX = 1090, TOP_MIN = 505, TOP_MAX = 545, BASE_MAX = 810;
/** 天空的歌詞（有主字時）：第一排的頂（地平線 HZ 在 230，兩排的歌詞也在海面上面）。 */
const LYR_Y = 110;

export default class Seaside extends JourneyPlate {
  bg = shared('seaside.bg', BG);
  text = this.track(new Layer2D(COL_W + 20, COL_H + 40, undefined, { fast: true }));
  /** 天空的歌詞（有主字時）。 */
  lyr = this.track(new Layer2D(COL_W + 40, 150, undefined, { fast: true }));
  pcx = 0; pcy = 0; hw = 0; hh = 0; bd = 18; ang = 0; base = 790;
  /** 沙上字塊的頂（畫面座標）。 */
  ty = TOP_MAX;

  override async init() {
    await this.loadPhoto();
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.hand(700), lineHeight: 1.35, lyricsApart: true,
      ink: rgba('sepia', 0.95), unsung: rgba('sepia', 0.32), active: mixRgba('signal', 'sepia', 0.35), sigInk: rgba('sepia', 0.8),
      label: { family: F.hand(700), size: 26, color: rgba('sepia', 0.7), tracking: 4, gap: 22 },
    });
    this.ty = clamp(BASE_MAX - this.blockH(), TOP_MIN, TOP_MAX);
    const { w, h } = this.img!;
    const s = this.fitScale(this.hasText ? 660 : 760, 560);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bd = clamp(0.035 * Math.min(w * s, h * s), 12, 22);
    this.base = 800;
    this.pcx = this.hasText ? Math.max(140 + this.hw + this.bd, 560) : 900;
    // 下緣往沙裡埋 26 px（只埋白邊）
    this.pcy = this.base + 26 - this.hh - this.bd;
    this.ang = (hash(this.seed, 3) * 2 - 1) * 2.5 * (Math.PI / 180);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const u = this.bg.u;
    // 浪：每個小節一道（上半小節推上來、後半退回去），濕沙慢慢乾
    const bi = Math.floor(audio.barAt(t) + 1e-6);
    const tb = audio.timeOfBar(bi), bd = Math.max(0.8, audio.timeOfBar(bi + 1) - tb);
    const tau = (t - tb) / bd;
    const rise = ease.outCubic(clamp(tau / 0.42));
    const recede = 1 - ease.inOutQuad(clamp((tau - 0.45) / 0.5));
    u.reach!.value = Math.min(rise, recede);
    u.wetMax!.value = tau < 0.42 ? rise : 1;
    u.wetK!.value = 1 - 0.55 * clamp((tau - 0.45) / 0.55);
    u.t!.value = t;
    u.seedOff!.value = hash(this.seed, 5) * 30;
    // 鏡頭：切進來時從海面往下搖到沙灘，之後很慢地推近
    const tilt = ease.inOutCubic(prog(t, s, s + 1.2));
    u.pan!.value = -90 * (1 - tilt);
    const zoom = 1 + 0.035 * (1 - Math.exp(-lt / 7));
    u.zoom!.value = zoom;
    (u.zc!.value as THREE.Vector2).set(this.hasText ? (this.pcx + TX + COL_W / 2) / 2 : this.pcx, 600);
    // 相片上的畫面往焦點推（鏡頭搖到沙灘、第一道浪湧上來的時候開始）
    this.setPhoto(u, 2 * this.hw * zoom, this.focusK(t, s + 0.6), 1.18);
    (u.pc!.value as THREE.Vector2).set(this.pcx, this.pcy);
    (u.hs!.value as THREE.Vector2).set(this.hw, this.hh);
    u.bd!.value = this.bd;
    u.ang!.value = this.ang + 0.3 * Math.sin(t * 0.9) * (Math.PI / 180);
    u.base!.value = this.base;
    if (this.hasText) {
      // 手指在沙上寫字：一個字一個字（沒有主字時是跟唱的歌詞）
      const o = { chars: this.charsAt(t, s + 0.9, 2.2), alpha: 1 - prog(t, e - 0.3, e) };
      if (this.apart) this.paintMain(this.text, 10, 10, o);
      else this.paintBlock(this.text, t, 10, 10, o);
      (u.textSize!.value as THREE.Vector2).set(this.text.w, this.text.h);
      (u.textRect!.value as THREE.Vector4).set(TX - 10, this.ty - 10, this.text.w, this.text.h);
    } else (u.textRect!.value as THREE.Vector4).set(0, 0, 0, 0);
    // 共用的 shader 一定要換成自己的層（不然留著上一個窗格已經釋放的貼圖）
    u.textTex!.value = this.text.texture;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.apart) {
      // 天空的歌詞：跟沙上的字同一欄（左緣對齊），鏡頭搖到沙灘之後才出現
      this.paintLyrics(this.lyr, t, 20, 20);
      const op = prog(t, s + 0.9, s + 1.4, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      if (op > 0) blit(comp, renderer, this.lyr, out, TX - 20, LYR_Y - 20, { opacity: op });
    }
    return { paper: 1, bloom: 0.14, bloomThreshold: 1.1, halation: 0.06, vignette: 0.32 };
  }
}
