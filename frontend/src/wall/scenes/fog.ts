// 照片版面「霧中浮現」（暗）：一片流動的霧，霧後面有一盞很遠的光；霧從照片的焦點那裡開始散開，照片慢慢清楚。
//  - 橫的、夠大的照片滿版（往焦點慢慢推近，焦點不會被裁掉）；直的、方的、很小的舊照片完整放在中間，框裡的畫面一樣往焦點推，
//    底下是同一張照片放大、模糊、壓暗（很小的照片最多放大 1.5 倍）。照片取樣壓在 0.84 以下，霧再亮照片也不發光。
//  - 霧有三層，各自往不同方向飄，近的那層飄得快、而且鏡頭往前推時它放大得比照片快（像穿過霧往前走）；
//    霧後面的光透出一道道很淡的光束。散開之後只剩邊上、下緣淡淡的霧在流，焦點附近一直是清楚的。
//  - 每個小節線起一陣風：霧一下流快、再慢下來。
//  - 字像電影字幕放在下三分之一（思源宋體、置中）：主字（賓客留言＋署名，或新人的註解）霧散到一半時一個字一個字浮出來，
//    歌詞小一號在最下面跟唱；沒有主字時歌詞自己當字幕；都沒有就只有照片。相簿的第一張在字幕上面多一行小小的相簿名。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { focusCrop, focusIn, settleK } from './_photo';
import { PhotoScene, TextBlock, DARK_TEXT, containSize, coverable, pastBeats, P5_GLSL } from './_p5';

export const spec: PlateSpecDecl = { photo: true, prefers: ['landscape'], family: 'photo', series: 'light', energy: [0, 0.7], bars: [3, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo;
  uniform vec4 rect; uniform vec4 crop; uniform float lod;
  uniform vec4 bgCrop; uniform float bgLod; uniform float contain;
  uniform float t; uniform float k; uniform vec2 focus; uniform float clearR; uniform vec3 drift; uniform float push;
  uniform vec2 lightP; uniform float shade; uniform vec4 shadeR;
  float layer(vec2 p, float sc, vec2 off, float a, float b) {
    vec2 q = (p - focus) / (sc * push) + focus / sc + off;
    q += 0.22 * vec2(snoise(q * 0.6 + 3.1), snoise(q * 0.6 + 9.7));
    return smoothstep(a, b, fbm(q, 3));
  }
  void main() {
    vec2 p = p5Px();
    // ---- 照片
    vec3 col = C_INK;
    // 霧後面的東西糊掉的樣子（霧會把後面的光散開：亮的地方霧也亮）
    vec3 under = C_INK;
    if (contain > 0.5) {
      vec2 q = p / vec2(${W}.0, ${H}.0);
      vec3 b = p5Blur(photo, bgCrop.xy + q * (bgCrop.zw - bgCrop.xy), bgLod, vec2(0.03, 0.05));
      col = mix(C_INK, b * 0.36, 0.85);
      under = col;
      vec2 c = rect.xy + rect.zw * 0.5;
      float d = sdBox(p - c - vec2(10.0, 18.0), rect.zw * 0.5);
      col *= 1.0 - 0.5 * exp(-max(d, 0.0) / 34.0);
    }
    vec2 c = rect.xy + rect.zw * 0.5;
    float d = sdBox(p - c, rect.zw * 0.5);
    float inside = 1.0 - smoothstep(-0.75, 0.75, d);
    if (inside > 0.0) {
      vec2 uv = crop.xy + (p - rect.xy) / rect.zw * (crop.zw - crop.xy);
      col = mix(col, p5Photo(photo, uv, lod), inside);
      under = mix(under, p5Photo(photo, uv, lod + 4.5), inside);
    }
    // 字幕後面（從字幕的頂往下）很淡地壓暗
    col *= 1.0 - shade * 0.35 * smoothstep(shadeR.y - 80.0, shadeR.y + 260.0, p.y);
    // ---- 霧：三層、各自飄，近的那層放大得快
    float d1 = layer(p, 520.0, vec2(drift.x, 0.13 * drift.x), -0.25, 0.55);
    float d2 = layer(p * 1.0, 340.0, vec2(-0.7 * drift.y, 0.05 * drift.y + 4.0), -0.2, 0.6);
    float d3 = layer(p / (0.82 + 0.18 * push), 760.0, vec2(drift.z + 9.0, -0.1 * drift.z), -0.1, 0.5);
    float dens = clamp(d1 * 0.5 + d2 * 0.35 + d3 * 0.45, 0.0, 1.0);
    // 散開：從焦點往外一圈一圈散；散了之後只剩邊上、下緣淡淡的霧，焦點附近沒有
    float fd = length((p - focus) * vec2(1.0, 1.25));
    float cleared = smoothstep(clearR - 120.0, clearR + 260.0, fd);
    vec2 eq = (p - vec2(${W / 2}.0, ${H / 2}.0)) / vec2(${W / 2}.0, ${H / 2}.0);
    // 散開之後：邊上、上緣、下緣留著霧在流（焦點附近沒有）
    float edge = clamp(0.12 + 0.55 * smoothstep(0.4, 1.15, length(eq)) + 0.2 * smoothstep(0.6, 1.0, p.y / ${H}.0) + 0.3 * smoothstep(0.38, 0.0, p.y / ${H}.0), 0.0, 1.0);
    edge *= smoothstep(140.0, 480.0, length(p - focus));
    // 散開之後留下來的霧要一縷一縷的（看得出在流），不是一整片灰
    float wisp = smoothstep(0.15, 0.85, dens);
    float amt = mix(wisp * edge, dens, cleared) * mix(0.9, 1.0, cleared);
    // 霧的顏色：灰，靠近後面那盞光的地方亮、暖；光束一道一道
    vec2 lq = p - lightP;
    float ang = atan(lq.y, lq.x);
    float rays = 0.65 + 0.35 * fbm(vec2(ang * 7.0, t * 0.05), 2);
    float glow = exp(-length(lq) / 700.0);
    // 霧是一層會散光的紗：不是黑煙，比底下的暗處亮、比照片的亮處暗
    vec3 fogC = mix(mix(C_GRAPHITE, C_ASH, 0.55) * 0.42, vec3(luma(under)) * 1.1 + 0.045, 0.55) * (0.7 + 0.4 * dens) + mix(C_ASH, C_EMBER, 0.45) * 0.24 * glow * rays;
    col = mix(col, fogC, amt * 0.92);
    // 字幕後面：照片或霧很亮時壓暗（霧蓋上去之後再壓，字才不會被霧洗白）
    col = p5Shade(col, p, shadeR, shade * 0.55);
    // 霧裡透出來的光（加在最上面，很淡）
    col += mix(C_ASH, C_EMBER, 0.45) * 0.035 * glow * rays * (0.4 + 0.6 * cleared);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, rect: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, lod: { value: 0 },
  bgCrop: { value: new THREE.Vector4(0, 0, 1, 1) }, bgLod: { value: 4 }, contain: { value: 0 },
  t: { value: 0 }, k: { value: 1 }, focus: { value: new THREE.Vector2() }, clearR: { value: 0 }, drift: { value: new THREE.Vector3() }, push: { value: 1 },
  lightP: { value: new THREE.Vector2() }, shade: { value: 0 }, shadeR: { value: new THREE.Vector4() },
});

/** 字幕：最後一行的基線在 HUD 區上面，置中；高度放得下相簿名＋兩行主字＋署名＋一句歌詞。 */
const SUB = { x: W / 2 - 660, y: 472, w: 1320, h: 340 };

export default class Fog extends PhotoScene {
  bg = shared('fog.bg', BG);
  text: TextBlock | null = null;
  contain = false;
  /** 霧散開要多久。 */
  D = 2;

  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    const { start, end } = this.ctx;
    this.contain = !coverable(w, h);
    this.D = clamp((end - start) * 0.45, 1.2, 4.0);
    if (this.hasText) {
      this.text = this.track(new TextBlock(this.ctx, { ...SUB }, DARK_TEXT(F.ming(600), {
        align: 'center', max: 50, maxLines: 3, lineHeight: 1.36, tracking: 3,
        label: { family: F.ming(600), size: 24, color: rgba('bone', 0.85), tracking: 6, rule: rgba('signal', 0.8) },
      }), 'bottom'));
    }
  }

  /** 每個小節線起一陣風：霧一下流快、再慢下來（累積的位移，只看 t）。 */
  private gust(t: number) {
    let g = 0;
    for (const tb of pastBeats(this.ctx.audio, t, 3, true)) {
      const dt = t - tb;
      if (dt < 0) continue;
      g += 0.35 * (1 - Math.exp(-dt / 0.7));
    }
    return g;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const { w, h } = this.img;
    const z0 = settleK(lt);
    const kick = 0.02 * (1 - ease.outCubic(prog(t, s, s + 0.9)));
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    let fx: number, fy: number;
    if (!this.contain) {
      // 滿版：往焦點推到 1.25 倍（一開始快、越來越慢），焦點越來越靠近畫面中間、永遠在畫面裡
      const cr = focusCrop(this.photo, w, h, W / H, z0, { zoom: 1.25 + kick });
      (u.rect!.value as THREE.Vector4).set(0, 0, W, H);
      (u.crop!.value as THREE.Vector4).set(...cr);
      u.lod!.value = this.cropLod(cr, W);
      const [fu, fv] = focusIn(this.photo, cr);
      fx = fu * W; fy = fv * H;
    } else {
      const sz = containSize(w, h, 1640, 900);
      const sc = 1 + 0.015 * z0 + kick;
      const rw = sz.w * sc, rh = sz.h * sc;
      const x = (W - rw) / 2, y = (H - rh) / 2 - 16;
      // 框裡的畫面往焦點推（框本身幾乎不動）；很小的照片少推
      const cr = this.crop(z0, rw, 1.2);
      (u.rect!.value as THREE.Vector4).set(x, y, rw, rh);
      (u.crop!.value as THREE.Vector4).set(...cr);
      u.lod!.value = this.cropLod(cr, rw);
      const bs = Math.max(W / w, H / h) * 1.2;
      const bw = W / (w * bs), bh = H / (h * bs);
      const dr = 0.02 * ease.inOutQuad(clamp(lt / 10)) * (hash(this.seed, 5) < 0.5 ? 1 : -1);
      (u.bgCrop!.value as THREE.Vector4).set(0.5 + dr - bw / 2, 0.5 - bh / 2, 0.5 + dr + bw / 2, 0.5 + bh / 2);
      u.bgLod!.value = Math.max(0, Math.log2((bw * w) / 64));
      const [fu, fv] = focusIn(this.photo, cr);
      fx = x + fu * rw; fy = y + fv * rh;
    }
    u.contain!.value = this.contain ? 1 : 0;
    (u.focus!.value as THREE.Vector2).set(fx, fy);
    // 霧從焦點往外散開
    u.clearR!.value = 1900 * ease.inOutQuad(prog(t, s + 0.15, s + 0.15 + this.D)) - 200;
    const g = this.gust(t);
    (u.drift!.value as THREE.Vector3).set(0.05 * lt + g, 0.035 * lt + 0.6 * g, 0.08 * lt + 1.3 * g);
    u.push!.value = 1 + 0.12 * z0;
    (u.lightP!.value as THREE.Vector2).set(W * (hash(this.seed, 8) < 0.5 ? 0.3 : 0.7), -120);
    u.t!.value = t;
    let shown = false;
    const tc = s + 0.15 + this.D * 0.45;
    if (this.text) shown = this.text.draw(t, prog(t, tc, tc + Math.min(1.8, Math.max(0.5, e - tc - 1.0))));
    u.shade!.value = this.hasText ? 0.85 * prog(t, s, s + 0.6) : 0;
    if (this.text) (u.shadeR!.value as THREE.Vector4).set(...this.text.area());
    u.k!.value = (0.8 + 0.2 * ease.outCubic(prog(t, s, s + 0.6))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.text && shown) {
      // 主字等霧散到一半才一個字一個字浮出來（chars 從 0 開始），歌詞一開始就要跟唱：整層早一點亮起來
      const op = prog(t, s + 0.2, s + 0.7, ease.outCubic) * (1 - prog(t, e - 0.35, e));
      this.text.blit(comp, renderer, out, op);
    }
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.12, vignette: 0.5 };
  }
}
