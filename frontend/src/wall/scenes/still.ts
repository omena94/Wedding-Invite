// 照片版面「電影劇照」（暗底）：新人自己選的照片像電影的一個鏡頭——
//  - 橫的、夠大的照片：滿版，往焦點 (fx, fy) 慢慢推近（或從臉的特寫拉遠），焦點永遠在畫面裡，不會把臉裁掉。
//  - 直的、手機直拍、方的、很小的舊照片（掃描的成長照）：不硬裁成滿版。同一張照片放大、模糊、壓暗當底，
//    照片本身完整放在中間（有淡淡的陰影），框裡的畫面往焦點慢慢推；很小的照片最多放大到原尺寸約 1.5 倍，不會糊成一片。
//  - 字像電影字幕：思源宋體、置中、在下三分之一（最後一行的基線在 HUD 區上面），照片下半部自動壓暗一點讓字清楚。
//    主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在最下面跟唱；沒有主字時歌詞就是字幕（_photo.ts 的 PhotoText）。
//  - 相簿的第一張（photo.chapter）：開頭兩三秒在左上角小小地印出相簿名，像電影的章節標題。
//  - 照片不能發光：白紗、天空在線性空間壓在 0.84 以下，後製的 bloom 門檻也拉高；顆粒、暗角照全片的片感。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import type { PhotoRef, PhotoImage } from '../photos';
import { focusCrop, loadWords, photoTexture, PhotoText, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'classic', prefers: ['landscape'], energy: [0, 1], bars: [2, 8], weight: 1.2 };

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D photo;
  // 照片在畫面上的範圍（邏輯 px，y 向下）與它對應到照片的哪一塊（0..1，左上原點）
  uniform vec4 rect; uniform vec4 crop;
  // 模糊的底（contain 模式）：整個畫面對應到照片的哪一塊、取樣的 mip 層
  uniform vec4 bgCrop; uniform float bgLod; uniform float contain;
  uniform float lod; uniform float k; uniform float shade; uniform float shadeY; uniform float topShade;
  vec3 photoAt(vec2 uv, float l) { return toLinear(textureLod(photo, uv, l).rgb); }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK;
    if (contain > 0.5) {
      // 底：同一張照片放大、模糊（高 mip 層再加一圈取樣，不會看到方塊）、壓暗、往主題的暗色靠
      vec2 q = p / vec2(${W}.0, ${H}.0);
      vec2 uv = bgCrop.xy + q * (bgCrop.zw - bgCrop.xy);
      vec3 b = vec3(0.0);
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.39996, r = 0.018 * sqrt(float(i) + 0.5);
        b += photoAt(uv + vec2(cos(a), sin(a)) * r * vec2(1.0, 1.6), bgLod);
      }
      b /= 12.0;
      col = mix(C_INK, b * 0.32, 0.85);
      // 照片的影子（右下一點、很軟）
      vec2 c = rect.xy + rect.zw * 0.5;
      float d = sdBox(p - c - vec2(10.0, 18.0), rect.zw * 0.5);
      col *= 1.0 - 0.55 * exp(-max(d, 0.0) / 34.0) * step(0.0, d + 40.0);
    }
    // 照片本身（邊緣抗鋸齒）
    vec2 c = rect.xy + rect.zw * 0.5;
    float d = sdBox(p - c, rect.zw * 0.5);
    float inside = 1.0 - smoothstep(-0.75, 0.75, d);
    if (inside > 0.0) {
      vec2 uv = crop.xy + (p - rect.xy) / rect.zw * (crop.zw - crop.xy);
      vec3 ph = photoAt(clamp(uv, 0.0, 1.0), lod);
      // 不發光：最亮壓在 0.84（白紗、天空還是白，但不會被 bloom 打到）
      ph = ph * 0.84;
      col = mix(col, ph, inside);
    }
    // 字的後面：下半部（字幕）、左上角（章節標題）很淡地壓暗，不是框
    col *= 1.0 - shade * 0.55 * smoothstep(shadeY - 60.0, shadeY + 240.0, p.y);
    vec2 tq = (p - vec2(260.0, 150.0)) / vec2(520.0, 180.0);
    col *= 1.0 - topShade * 0.45 * exp(-dot(tq, tq));
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, rect: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  bgCrop: { value: new THREE.Vector4(0, 0, 1, 1) }, bgLod: { value: 4 }, contain: { value: 0 },
  lod: { value: 0 }, k: { value: 1 }, shade: { value: 0 }, shadeY: { value: 580 }, topShade: { value: 0 },
});

/**
 * 字幕區（下三分之一）：最後一行的基線、寬度、整塊的高度上限（主字＋署名＋歌詞）。
 * HUD_SAFE 從 y = 830 開始，基線放在它上面，置中的寬字也不會碰到 HUD。
 */
const SUB = { cx: W / 2, base: 812, w: 1300, h: 300 };
/** 字幕層（只畫下面那一條，省上傳）。 */
const SUB_LAYER = { y: 470, h: 380 };

export default class Still extends Scene {
  bg = shared('still.bg', BG);
  sub = this.track(new Layer2D(W, SUB_LAYER.h, undefined, { fast: true }));
  top = this.track(new Layer2D(760, 220, undefined, { fast: true }));
  photo: PhotoRef = this.ctx.params.photo;
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  seed = Number(this.ctx.params.seed ?? 1);
  /** 滿版（cover）或完整放在中間（contain）。 */
  contain = false;
  /** 字幕：主字（留言或註解）＋歌詞。 */
  text!: PhotoText;
  /** 字幕整塊的頂（字幕層座標）。 */
  textTop = 0;
  tCap0 = 0;

  override async init() {
    const { start, end } = this.ctx;
    const ph = this.photo;
    // 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就讓引擎跳過這個窗格，不要畫一半
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(`${ph.caption}${ph.album}`);
    await loadWords(this.ctx);
    this.img = await ph.load();
    this.tex = this.track(photoTexture(this.img));
    // 先上傳到顯示卡（不要拖到第一格才傳，切版面時會停一下）
    this.ctx.renderer.initTexture(this.tex);
    const { w, h } = this.img;
    // 橫的、夠大（滿版不用放大超過約 1.6 倍）才滿版；其他完整放在中間
    this.contain = w / h < 1.25 || w < W / 1.6;
    // 字幕：照片上的字直接壓在照片上，字邊一圈很淡的暗影（照片很亮的地方——白紗、天空——字照樣清楚）
    this.text = new PhotoText(this.ctx, this.sub.ctx, {
      family: F.ming(700), w: SUB.w, h: SUB.h, min: 38, max: 50, maxLines: 3, align: 'center', tracking: 3,
      ink: rgba('bone', 0.97), unsung: rgba('bone', 0.42), sigInk: rgba('bone', 0.8), sigSize: 28,
      shadow: { color: rgba('ink', 0.7), blur: 14 },
    });
    // 整塊的最後一行基線在 SUB.base（height 是第一行的頂到最後一行的基線附近）
    this.textTop = SUB.base - SUB_LAYER.y - this.text.height + this.text.size * 0.1;
    if (ph.chapter && ph.album) this.drawChapter();
    this.tCap0 = start + Math.min(0.6, (end - start) * 0.12);
  }

  /** 章節標題：左上角，一條短線＋相簿名（≤ 22 px 的小標籤再大一點點，仍然是配角）。 */
  private drawChapter() {
    const L = this.top, c = L.ctx;
    L.clear();
    const x = 4, y = 130;
    c.fillStyle = rgba('signal', 0.9);
    c.fillRect(x, y - 30, 44, 2);
    c.font = font(F.ming(700), 26);
    c.letterSpacing = '8px';
    c.fillStyle = rgba('bone', 0.92);
    c.shadowColor = rgba('ink', 0.6); c.shadowBlur = 10;
    let s = this.photo.album;
    while (s.length > 1 && c.measureText(s).width > L.w - 20) s = s.slice(0, -1);
    c.fillText(s === this.photo.album ? s : `${s}…`, x, y + 10);
    c.letterSpacing = '0px'; c.shadowBlur = 0;
    L.upload();
  }

  /** 畫面上的照片範圍與裁切（t 決定，慢推慢搖）。 */
  private frame(t: number): { rect: [number, number, number, number]; crop: [number, number, number, number]; lod: number } {
    const { w, h } = this.img!;
    const { start } = this.ctx;
    const lt = t - start;
    const pushIn = hash(this.seed, 3) < 0.65;
    // 往焦點推近（或從臉的特寫拉遠）：一開始快、之後越來越慢（窗格長短都好看）
    const z0 = settleK(lt, 6);
    // 進場：剛切進來時多一點點動作（從 1.02 倍收回來），退場不加
    const kick = 0.02 * (1 - ease.outCubic(prog(t, start, start + 0.9)));
    if (!this.contain) {
      // 滿版：推到 1.22 倍，中心從照片中間慢慢移到焦點（焦點一直在畫面裡）；進場的那一點點多推（繞著框的中心縮）
      const [x0, y0, x1, y1] = focusCrop(this.photo, w, h, W / H, z0, { zoom: 1.22, reverse: !pushIn });
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / (2 * (1 + kick)), hh = (y1 - y0) / (2 * (1 + kick));
      return { rect: [0, 0, W, H], crop: [cx - hw, cy - hh, cx + hw, cy + hh], lod: Math.max(0, Math.log2((2 * hw * w) / (W * SCALE))) };
    }
    // 完整放在中間：最大 1700×920（上下左右留邊），很小的照片最多放大到 1.5 倍
    const maxS = Math.min(1700 / w, 920 / h, 1.5);
    const s = maxS * (1 + 0.015 * z0 + kick);
    const rw = w * s, rh = h * s;
    // 框裡的畫面往焦點推（框本身幾乎不動，像鏡頭在照片上推近）；很小的照片少推，不推糊
    const crop = focusCrop(this.photo, w, h, w / h, z0, { zoom: 1.2, screenW: rw, reverse: !pushIn });
    // 很慢地往一邊漂一點
    const dir = hash(this.seed, 5) < 0.5 ? -1 : 1;
    const dx = dir * 14 * ease.inOutQuad(clamp(lt / 10)), dy = -10 * ease.outCubic(prog(t, start, start + 0.9)) + 10;
    const x = (W - rw) / 2 + dx, y = (H - rh) / 2 - 10 + dy;
    return { rect: [x, y, rw, rh], crop, lod: Math.max(0, Math.log2(((crop[2] - crop[0]) * w) / (rw * SCALE))) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fr = this.frame(t);
    const u = this.bg.u;
    u.photo!.value = this.tex;
    (u.rect!.value as THREE.Vector4).set(...fr.rect);
    (u.crop!.value as THREE.Vector4).set(...fr.crop);
    u.lod!.value = fr.lod;
    u.contain!.value = this.contain ? 1 : 0;
    if (this.contain) {
      // 模糊的底：把照片「cover」到整個畫面，往反方向很慢地漂（視差）
      const { w, h } = this.img!;
      const sc = Math.max(W / w, H / h) * 1.15;
      const fw = W / (w * sc), fh = H / (h * sc);
      const drift = 0.02 * (hash(this.seed, 5) < 0.5 ? 1 : -1) * ease.inOutQuad(clamp((t - s) / 10));
      const cx = clamp(0.5 + drift, fw / 2, 1 - fw / 2), cy = 0.5;
      (u.bgCrop!.value as THREE.Vector4).set(cx - fw / 2, cy - fh / 2, cx + fw / 2, cy + fh / 2);
      u.bgLod!.value = Math.max(0, Math.log2((fw * w) / 64));
    }
    // 切進來時亮起來一點點、最後零點三秒稍微收暗（硬切也不會太突然）
    u.k!.value = (0.82 + 0.18 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.12 * prog(t, e - 0.3, e));

    // ---- 字幕：主字（留言或註解）＋歌詞，內容變了才重畫
    let subK = 0;
    if (this.text.has) {
      const L = this.sub;
      if (this.text.draw(L.ctx, t, SUB.cx, this.textTop, { clear: () => L.clear() })) L.upload();
      subK = (this.text.hasMain ? prog(t, this.tCap0, this.tCap0 + 0.5, ease.outCubic) : 1) * (1 - prog(t, e - 0.35, e));
    }
    const topK = this.photo.chapter && this.photo.album ? prog(t, s + 0.3, s + 0.9, ease.outCubic) * (1 - prog(t, s + 3.2, s + 4.0)) : 0;
    u.shade!.value = this.text.has ? 0.75 : 0;
    u.shadeY!.value = SUB_LAYER.y + this.textTop;
    u.topShade!.value = topK;
    this.bg.render(renderer, out);
    if (subK > 0) {
      const L = this.sub;
      comp.draw(renderer, L.texture, out, { opacity: subK, scale: [1, H / L.h], offset: [0, 0.5 + SUB_LAYER.y / L.h - 0.5 * H / L.h] });
    }
    if (topK > 0) {
      const L = this.top, x = 156, y = 0;
      comp.draw(renderer, L.texture, out, { opacity: topK, scale: [W / L.w, H / L.h], offset: [0.5 * W / L.w - 0.5 - x / L.w, 0.5 + y / L.h - 0.5 * H / L.h] });
    }
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.12, vignette: 0.42 };
  }
}
