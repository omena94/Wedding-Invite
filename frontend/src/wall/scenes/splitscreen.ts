// 照片版面「分割畫面」（暗，兩張）：MV 常見的左右分割——
//  - 左邊是主角（params.photo），右邊是第二張；中間一條微微斜的分割線，在拍點（每兩拍）滑到新的位置（外拋緩動，停住），
//    滑動的那一下分割線閃一道訊號色的光。分割線往左邊投一道軟影，右邊那片像疊在上面（有前後）。
//  - 切進來：左邊從上面滑下來、右邊從下面滑上來，在中間對上。之後兩邊各自很慢地反方向漂（一邊往上、一邊往下）。
//  - 每一片：橫的夠大的照片裁滿那一片（分割線移動時裁切跟著變，焦點不會被裁掉）；直的、手機直拍、小的舊照片完整放在那一片中間，
//    四周是同一張照片放大模糊壓暗。片裡的畫面往焦點推：主角（左邊）推得明顯（臉停在字上面），右邊那張只推一點點。
//  - 字只放主角的：左下角、靠左（思源黑體，上面一行小小的相簿名），寫在左邊那一片裡（分割線怎麼移都碰不到）——
//    主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；沒有主字時歌詞寫在同一個位置。兩個都沒有就只有兩張照片。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { settleK } from './_photo';
import { PhotoPlate, canCover, contain, focusCropAt, photoLod, clip, drawLayer, v4, type Shot } from './_p4';

export const spec: PlateSpecDecl = { photo: true, photos: 2, family: 'photo', series: 'screen', energy: [0.35, 1], bars: [4, 8], weight: 1, prefers: ['portrait'] };

/** 分割線最左、最右（畫面 px）：左邊那片至少這麼寬，字放得下。 */
const SEAM_MIN = 850, SEAM_MAX = 1070;
const TILT = 0.06;

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D photoA; uniform sampler2D photoB;
  uniform vec4 rectA; uniform vec4 cropA; uniform float lodA; uniform float coverA; uniform vec4 bgA;
  uniform vec4 rectB; uniform vec4 cropB; uniform float lodB; uniform float coverB; uniform vec4 bgB;
  uniform float seam; uniform vec2 slide; uniform float flash; uniform float shade; uniform vec4 shadeR; uniform float k;
  vec3 ph(sampler2D s, vec2 uv, float l) { return toLinear(textureLod(s, clamp(uv, 0.0, 1.0), l).rgb) * 0.82; }
  vec3 panel(sampler2D s, vec2 p, vec4 rect, vec4 crop, float l, float cover, vec4 bg) {
    vec3 col;
    if (cover < 0.5) {
      // 底：同一張照片放大模糊壓暗
      vec2 q = p / vec2(${W}.0, ${H}.0);
      vec2 uv = bg.xy + q * (bg.zw - bg.xy);
      vec3 b = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 2.39996, r = 0.025 * sqrt(float(i) + 0.5);
        b += ph(s, uv + vec2(cos(a), sin(a)) * r, 5.0);
      }
      col = mix(C_INK, b / 8.0 * 0.14, 0.9);
      float d = sdBox(p - rect.xy - rect.zw * 0.5 - vec2(0.0, 14.0), rect.zw * 0.5);
      col *= 1.0 - 0.5 * exp(-max(d, 0.0) / 36.0);
    } else col = C_INK;
    float d = sdBox(p - rect.xy - rect.zw * 0.5, rect.zw * 0.5);
    float inside = 1.0 - smoothstep(-0.75, 0.75, d);
    if (inside > 0.0) col = mix(col, ph(s, crop.xy + (p - rect.xy) / rect.zw * (crop.zw - crop.xy), l), inside);
    return col;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 分割線（微微斜）：這一點在線的哪一邊、離線多遠
    float sx = seam + ${TILT} * (p.y - ${H / 2}.0);
    float ds = p.x - sx;
    vec3 col;
    if (ds < 0.0) {
      vec2 pa = p - vec2(0.0, slide.x);
      col = (pa.y < 0.0 || pa.y > ${H}.0) ? C_INK : panel(photoA, pa, rectA, cropA, lodA, coverA, bgA);
      // 右邊那片疊在上面：往左投一道軟影
      col *= 1.0 - 0.45 * exp(ds / 26.0);
      // 字的後面（左下）很淡地壓暗
      vec2 tq = (p - shadeR.xy) / shadeR.zw;
      col *= 1.0 - shade * 0.5 * exp(-dot(tq, tq) * 1.3);
    } else {
      vec2 pb = p - vec2(0.0, slide.y);
      col = (pb.y < 0.0 || pb.y > ${H}.0) ? C_INK : panel(photoB, pb, rectB, cropB, lodB, coverB, bgB);
    }
    // 分割線：細細一條紙白（不發光），滑動那一下閃一道訊號色
    float line = 1.0 - smoothstep(1.0, 2.2, abs(ds));
    col = mix(col, C_BONE * 0.7, line * 0.8);
    col += C_SIGNAL * flash * (2.4 * line + 0.25 * exp(-abs(ds) / 18.0));
    fragColor = vec4(col * k, 1.0);
  }`, {
  photoA: { value: null }, photoB: { value: null },
  rectA: { value: new THREE.Vector4() }, cropA: { value: new THREE.Vector4(0, 0, 1, 1) }, lodA: { value: 0 }, coverA: { value: 1 }, bgA: { value: new THREE.Vector4(0, 0, 1, 1) },
  rectB: { value: new THREE.Vector4() }, cropB: { value: new THREE.Vector4(0, 0, 1, 1) }, lodB: { value: 0 }, coverB: { value: 1 }, bgB: { value: new THREE.Vector4(0, 0, 1, 1) },
  seam: { value: W / 2 }, slide: { value: new THREE.Vector2() }, flash: { value: 0 }, shade: { value: 0 }, shadeR: { value: new THREE.Vector4(420, 860, 560, 230) }, k: { value: 1 },
});

/**
 * 字的欄位（左下）：字層的左上角、寬高；最後一行的基線在 BASE（畫面 y = 900；x 不到 800，碰不到右下角 HUD）。
 * 主字最多 4 行＋署名＋歌詞，整塊最高約 380 px，上面還有一行相簿名。
 */
const COL = { x: 130, y: 420, w: 660, h: 520 };
const BASE = 900 - COL.y;

export default class SplitScreen extends PhotoPlate {
  bg = shared('splitscreen.bg', BG);
  layer = this.track(new Layer2D(COL.w, COL.h, undefined, { fast: true }));
  /** 字整塊的頂（字層座標）；主角的臉最後停在左片的哪裡。 */
  textTop = 0;
  at: [number, number] = [0.5, 0.5];
  /** 分割線在每個拍點要到的位置（時間、x）。 */
  moves: { t: number; x: number }[] = [];
  cover: boolean[] = [];
  /** 完整放的照片的大小。 */
  cw: number[] = []; ch: number[] = [];
  tCap = 0;

  override async init() {
    await this.loadPhotos(2);
    const { start, end, audio } = this.ctx;
    for (const sh of this.shots) {
      // 用最窄的那片判斷：裁滿不用放大太多才裁
      const cov = canCover(sh.img, SEAM_MIN / H, SEAM_MIN);
      this.cover.push(cov);
      const c = contain(sh.img.w, sh.img.h, SEAM_MIN - 2 * 40 - W * TILT * 0.5, H - 90);
      this.cw.push(c.w); this.ch.push(c.h);
    }
    // 分割線：第一個位置在中間，之後每兩拍換一個（種子決定的順序），在拍點滑過去
    const xs = [0.5, 0.62, 0.3, 0.78, 0.45, 0.15, 0.7, 0.38];
    const off = Math.floor(hash(this.seed, 8) * xs.length);
    let k = 0;
    for (let b = beatAfter(audio, start + 1.0); b < end - 0.4; b = beatAfter(audio, b, 2)) {
      this.moves.push({ t: b, x: lerp(SEAM_MIN, SEAM_MAX, xs[(off + k) % xs.length]!) });
      k++;
      if (b === beatAfter(audio, b, 2)) break;
    }
    const text = this.words(this.layer.ctx, {
      family: F.hei(700), w: COL.w - 20, h: 380, min: 40, max: 50, lineHeight: 1.4, maxLines: 4, align: 'left',
      ink: rgba('bone', 0.96), unsung: rgba('bone', 0.38), sigInk: rgba('bone', 0.8), sigSize: 28, shadow: { color: rgba('ink', 0.7), blur: 12 },
    });
    this.textTop = BASE - text.height + text.size * 0.1;
    // 有字：主角的臉推到字上面（左片的上半）
    this.at = text.has ? [0.5, clamp(((COL.y + this.textTop) / H) * 0.55, 0.3, 0.45)] : [0.5, 0.5];
    this.tCap = start + Math.min(0.8, (end - start) * 0.25);
  }

  /** 左下的字：相簿名（訊號色小字，位置固定）＋主字＋歌詞（內容變了才重畫）。 */
  private drawText(t: number) {
    const ph = this.photo;
    const L = this.layer, c = L.ctx;
    const clear = () => {
      L.clear();
      if (!ph.album) return;
      c.font = font(F.mono(500), 20);
      c.letterSpacing = '5px';
      c.fillStyle = rgba('signal', 0.9);
      c.fillText(clip(c, ph.album, COL.w - 20), 0, Math.max(24, this.textTop - 26));
      c.letterSpacing = '0px';
    };
    if (this.text.draw(c, t, 0, this.textTop, { clear })) L.upload();
  }

  /**
   * 一片的照片範圍與裁切（左片 x0..seam、右片 seam..W；drift 是很慢的上下漂）。片裡的畫面往焦點推：push 是推的進度與倍數，
   * 主角的臉停在 at（字的上面）。
   */
  private place(i: number, x0: number, x1: number, drift: number, push: { k: number; zoom: number; at?: [number, number] }): { rect: number[]; crop: number[]; lod: number; bg: number[] } {
    const sh: Shot = this.shots[i]!;
    const { w, h } = sh.img;
    const pw = x1 - x0;
    if (this.cover[i]) {
      const cr = focusCropAt(sh.ref, w, h, pw / H, push, pw);
      return { rect: [x0, 0, pw, H], crop: cr, lod: photoLod((cr[2] - cr[0]) * w, pw), bg: [0, 0, 1, 1] };
    }
    const rw = this.cw[i]!, rh = this.ch[i]!;
    const cx = (x0 + x1) / 2, cy = H / 2 + drift * 14;
    const cr = focusCropAt(sh.ref, w, h, w / h, push, rw);
    const bsc = Math.max(W / w, H / h) * 1.2;
    const fw = W / (w * bsc), fh = H / (h * bsc);
    const bx = clamp(0.5 + drift * 0.02, fw / 2, 1 - fw / 2);
    return { rect: [cx - rw / 2, cy - rh / 2, rw, rh], crop: cr, lod: photoLod((cr[2] - cr[0]) * w, rw), bg: [bx - fw / 2, 0.5 - fh / 2, bx + fw / 2, 0.5 + fh / 2] };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    // 分割線的位置：滑到最近一次的目標（外拋緩動 0.45 秒）
    let seam = lerp(SEAM_MIN, SEAM_MAX, 0.5), flash = 0, prev = seam;
    for (const m of this.moves) {
      if (t < m.t) break;
      seam = lerp(prev, m.x, prog(t, m.t, m.t + 0.45, ease.outExpo));
      flash = Math.exp(-(t - m.t) / 0.12) * 0.6;
      prev = m.x;
    }
    // 切進來：左片從上面滑下來、右片從下面滑上來
    const inK = ease.outExpo(prog(t, s, s + 0.6));
    const slideA = -H * (1 - inK), slideB = H * (1 - ease.outExpo(prog(t, s + 0.08, s + 0.68)));
    const span = Math.max(4, e - s);
    const dr = ease.inOutQuad(clamp(lt / span)) * 2 - 1;
    // 往焦點推：主角推得明顯（1.28 倍），右邊那張只推一點點（不搶主角）
    const k = settleK(lt);
    // 斜的分割線：左片要算到線最右邊的地方、右片從線最左邊的地方算起，照片才蓋得滿
    const tilt = TILT * H / 2;
    const A = this.place(0, 0, seam + tilt, -dr, { k, zoom: 1.28, at: this.at });
    const B = this.place(1, seam - tilt, W, dr, { k, zoom: 1.1 });
    const u = this.bg.u;
    u.photoA!.value = this.shots[0]!.tex; u.photoB!.value = this.shots[1]!.tex;
    v4(u.rectA!, A.rect); v4(u.cropA!, A.crop); u.lodA!.value = A.lod; u.coverA!.value = this.cover[0] ? 1 : 0; v4(u.bgA!, A.bg);
    v4(u.rectB!, B.rect); v4(u.cropB!, B.crop); u.lodB!.value = B.lod; u.coverB!.value = this.cover[1] ? 1 : 0; v4(u.bgB!, B.bg);
    u.seam!.value = seam;
    (u.slide!.value as THREE.Vector2).set(slideA, slideB);
    u.flash!.value = flash;
    const capK = this.hasText ? prog(t, this.tCap, this.tCap + 0.5, ease.outCubic) * (1 - prog(t, e - 0.3, e)) : 0;
    u.shade!.value = capK;
    const th = this.text.height + 60;
    v4(u.shadeR!, [COL.x + COL.w * 0.45, COL.y + this.textTop + th / 2 - 20, COL.w * 0.85, th * 0.7 + 60]);
    u.k!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    this.bg.render(renderer, out);
    if (capK > 0) {
      this.drawText(t);
      drawLayer(comp, renderer, this.layer, out, COL.x, COL.y + 16 * (1 - capK), { opacity: capK });
    }
    return { bloom: 0.3, bloomThreshold: 1.05, halation: 0.12, vignette: 0.4 };
  }
}
