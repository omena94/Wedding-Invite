// 照片版面「錄影帶」（暗）：家用錄放影機放出來的一段 VHS——
//  - 4:3 的畫面（左右是黑的）：每一條掃描線輕輕左右抖、顏色比亮度糊而且往右偏一點（色偏）、邊緣有一圈亮暈、細細的雜訊與偶爾一條白色的掉訊，
//    最下面幾條線是磁頭切換的雜訊；照片本身比較軟（錄影帶的解析度）。
//  - 切進來：先是一片雪花，畫面出來時一條追蹤不良的雜訊帶往上捲走；之後每四小節的第一拍再捲一次（很輕）。
//  - 左上角「▶ PLAY」出現兩秒半就消失（錄放影機的螢幕顯示，乾淨、不跟著抖）；左下角是婚禮日期的時間戳（沒定日期就不印）。
//  - 照片：橫的夠大的裁滿 4:3，直的、小的完整放，兩邊是錄影帶的黑。家用攝影機慢慢往焦點變焦（臉越來越大，停在字幕上面的空處）。
//  - 字像攝影機的字幕機打上去的字：思源黑體、置中在下面、硬的陰影，錄在帶子裡（跟著線一起抖、有一點色偏）——
//    主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在最下面跟唱；沒有主字時歌詞就是字幕。兩個都沒有就只有畫面。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { frameIdx, prog } from '../engine/util';
import { DATE, barAfter } from './_motifs';
import { settleK } from './_photo';
import { PhotoPlate, P4_GLSL, aboveText, fitInScreen, photoLod, subtitleStyle, drawLayer, v4 } from './_p4';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'screen', energy: [0.2, 1], bars: [2, 8], weight: 1, prefers: ['landscape', 'square', 'small'] };

/** 4:3 的畫面（畫面 px）。 */
const IMG = { x: (W - H * 4 / 3) / 2, w: H * 4 / 3 };
/**
 * 字幕層：畫面下面這一段（4:3 畫面裡的 y 從 TXT.y0 起，高 TXT.h）：主字最多 4 行＋署名＋歌詞，整塊最高約 380 px。
 * 最後一行的基線在 BASE（畫面 y）：置中的寬字會伸到 x ≥ 1360，基線要在右下角 HUD（y ≥ 830）上面。
 */
const TXT = { y0: 380, h: 460 };
const BASE = 805;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const BG = () => new FSPass(/* glsl */ `
  ${P4_GLSL}
  uniform sampler2D photo; uniform sampler2D txt;
  uniform vec4 prect; uniform vec4 crop; uniform float lod; uniform float txtK; uniform float shadeY;
  uniform float frame; uniform float snow; uniform float band; uniform float bandAmp; uniform float k;
  float lineNoise(float ln, float f) { return hash12(vec2(ln, f)) - 0.5; }
  vec3 tape(vec2 q, float l) {
    vec4 ph = P4screenPhoto(photo, q, prect, crop, l);
    vec3 c = ph.rgb * ph.a;
    // 字幕後面很淡地壓暗（亮的畫面上字也清楚）
    c *= 1.0 - txtK * 0.45 * smoothstep(shadeY - 0.08, shadeY + 0.14, q.y);
    vec2 tq = vec2(q.x, (q.y * ${H}.0 - ${TXT.y0}.0) / ${TXT.h}.0);
    if (txtK > 0.0 && tq.y >= 0.0 && tq.y <= 1.0) {
      vec4 tx = P4layer(txt, tq) * txtK;
      c = c * (1.0 - tx.a) + tx.rgb * 0.92;
    }
    return c;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = vec2((p.x - ${IMG.x.toFixed(2)}) / ${IMG.w.toFixed(2)}, p.y / ${H}.0);
    vec3 col = vec3(0.0);
    if (q.x > -0.02 && q.x < 1.02) {
      // 掃描線（240 條）：每條輕輕左右抖；追蹤不良的雜訊帶經過的地方大幅錯開
      float ln = floor(q.y * 240.0);
      float dx = lineNoise(ln, frame) * 0.0016 + lineNoise(floor(ln / 8.0), floor(frame / 3.0)) * 0.0012;
      float bd = q.y - band;
      float inBand = exp(-bd * bd / 0.0012) * bandAmp;
      dx += inBand * (0.02 + 0.03 * lineNoise(ln, frame * 1.7));
      // 磁頭切換：最下面幾條線往右扯
      float hs = smoothstep(0.965, 0.985, q.y);
      dx += hs * (0.012 + 0.01 * lineNoise(ln, frame));
      vec2 uq = vec2(q.x + dx, q.y);
      // 亮度（比較軟）＋顏色（更糊、往右偏）
      vec3 sharp = tape(uq, lod + 0.6);
      vec3 soft = tape(uq + vec2(0.0035, 0.0), lod + 2.4);
      vec3 near = 0.5 * (tape(uq - vec2(0.0018, 0.0), lod + 1.2) + tape(uq + vec2(0.0018, 0.0), lod + 1.2));
      float Y = luma(sharp);
      // 邊緣的亮暈（錄影帶的銳利化）
      Y += (Y - luma(near)) * 0.9;
      vec3 chroma = soft - luma(soft);
      vec3 c = vec3(Y) + chroma * 0.85;
      // 黑色浮起來一點、對比低一點
      c = c * 0.93 + 0.012;
      // 雜訊、掉訊（白色短線）、雜訊帶裡的白點
      float n = hash12(vec2(p.x * 0.5, ln + frame * 13.0)) - 0.5;
      // 雜訊在亮的地方明顯、黑的地方淡（黑邊不要一片沙）
      c += n * (0.012 + 0.035 * clamp(Y, 0.0, 1.0));
      float drop = step(0.9985, hash12(vec2(ln, frame))) * step(abs(q.x - hash12(vec2(ln, frame + 3.0))), 0.03);
      c += C_BONE * 0.45 * drop;
      c += C_BONE * 0.5 * inBand * step(0.8, hash12(vec2(floor(p.x / 3.0), ln + frame)));
      c = mix(c, vec3(0.35 + 0.4 * (hash12(vec2(floor(p.x / 2.0), ln + frame * 7.0)))) * C_BONE, hs * 0.35);
      // 雪花（進場）
      float sn = hash12(vec2(floor(p.x / 2.0), floor(p.y / 2.0)) + frame * 1.37);
      c = mix(c, C_BONE * 0.55 * sn, snow);
      // 交錯掃描的細線、四邊的過掃描暗邊
      c *= 0.93 + 0.07 * step(0.5, fract(p.y / 2.25));
      float edge = smoothstep(0.0, 0.012, q.x) * smoothstep(1.0, 0.988, q.x);
      col = c * edge;
    }
    fragColor = vec4(max(col, 0.0) * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, prect: { value: new THREE.Vector4(0, 0, 1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  lod: { value: 0 }, txtK: { value: 0 }, shadeY: { value: 0.7 }, frame: { value: 0 }, snow: { value: 0 }, band: { value: -1 }, bandAmp: { value: 0 }, k: { value: 1 },
});

export default class Vhs extends PhotoPlate {
  bg = shared('vhs.bg', BG);
  sub = this.track(new Layer2D(IMG.w, TXT.h, undefined, { fast: true }));
  osd = this.track(new Layer2D(IMG.w, H, undefined, { fast: true }));
  /** 字幕整塊的頂（字幕層座標）、在畫面的哪裡（0..1）；臉最後停在畫面的哪裡。 */
  textTop = 0;
  textV = 1;
  at: [number, number] = [0.5, 0.5];
  stamp = '';
  osdSig = '';
  tCap = 0;
  /** 雜訊帶往上捲的時間（進場一次，之後每四小節一次）。 */
  bands: number[] = [];

  override async init() {
    this.stamp = DATE ? `${MONTHS[DATE.m - 1]}. ${DATE.d} ${DATE.y}` : '';
    await this.loadPhotos(1, `▶PLAY SP ${this.stamp}`);
    await loadText(`▶ PLAY${this.stamp}`);
    const { start, end, audio } = this.ctx;
    const L = this.sub;
    // 字幕機的字：粗一點、字距寬一點、硬的陰影往右下（不糊、不描邊）。陰影位移留在這張圖層的畫筆上，PhotoText 每次畫都用到
    const text = this.words(L.ctx, subtitleStyle(1100, 380, { family: F.hei(700), max: 50, tracking: 3, shadow: { color: rgba('ink', 0.85), blur: 0 } }));
    L.ctx.shadowOffsetX = 3; L.ctx.shadowOffsetY = 3;
    this.textTop = BASE - TXT.y0 - text.height + text.size * 0.1;
    this.textV = (TXT.y0 + this.textTop) / H;
    this.at = aboveText(this.textV, text.has);
    this.tCap = start + Math.min(1.0, (end - start) * 0.28);
    this.bands = [start + 0.3];
    for (let b = barAfter(audio, start + 1.5); b < end - 1; b = barAfter(audio, b + 0.01)) {
      if (Math.round(audio.barAt(b)) % 4 === 0) this.bands.push(b);
    }
  }

  /** 錄放影機的螢幕顯示（▶ PLAY、時間戳）：只在變的時候重畫。 */
  private drawOsd(t: number) {
    const s = this.ctx.start;
    const play = t >= s + 0.15 && t < s + 2.7;
    const blink = play && t < s + 0.9 ? Math.floor((t - s) * 4) % 2 === 0 : play;
    const stamp = !!this.stamp && t >= s + 0.5;
    const sig = `${blink}|${stamp}`;
    if (sig === this.osdSig) return;
    this.osdSig = sig;
    const L = this.osd, c = L.ctx;
    L.clear();
    c.font = font(F.mono(600), 26);
    c.letterSpacing = '3px';
    c.shadowColor = rgba('ink', 0.8); c.shadowOffsetX = 3; c.shadowOffsetY = 3;
    c.fillStyle = rgba('bone', 0.92);
    if (blink) c.fillText('▶ PLAY', 110, 140);
    if (stamp) c.fillText(this.stamp, 110, 960);
    c.letterSpacing = '0px'; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const u = this.bg.u;
    // 攝影機往焦點變焦（1.25 倍），臉最後停在字幕上面
    const fit = fitInScreen(this.img, this.photo, 4 / 3, IMG.w, { k: settleK(lt), zoom: 1.25, at: this.at });
    v4(u.prect!, fit.rect);
    v4(u.crop!, fit.crop);
    u.lod!.value = photoLod(this.img.w * (fit.crop[2] - fit.crop[0]), IMG.w * (fit.rect[2] - fit.rect[0]));
    u.photo!.value = this.tex;
    // 錄影帶一秒 30 格：雜訊照 30 格換一次
    u.frame!.value = Math.floor(frameIdx(t) / 2);
    u.snow!.value = lt < 0.22 ? 1 : 1 - prog(t, s + 0.22, s + 0.4);
    // 雜訊帶：從下往上捲（0.7 秒）
    let band = -1, amp = 0;
    for (const b of this.bands) {
      if (t >= b && t < b + 0.7) { band = 1.1 - 1.3 * (t - b) / 0.7; amp = b === this.bands[0] ? 1 : 0.45; }
    }
    u.band!.value = band;
    u.bandAmp!.value = amp;
    let txtK = 0;
    if (this.hasText) {
      const L = this.sub;
      if (this.text.draw(L.ctx, t, L.w / 2, this.textTop, { clear: () => L.clear() })) L.upload();
      txtK = prog(t, this.tCap, this.tCap + 0.15) * (1 - prog(t, e - 0.25, e));
    }
    u.txt!.value = this.sub.texture;
    u.txtK!.value = txtK;
    u.shadeY!.value = this.textV;
    u.k!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    this.bg.render(renderer, out);
    this.drawOsd(t);
    drawLayer(comp, renderer, this.osd, out, IMG.x, 0, { opacity: 1 - prog(t, e - 0.25, e) });
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.2, vignette: 0.35, ca: 1.6 };
  }
}
