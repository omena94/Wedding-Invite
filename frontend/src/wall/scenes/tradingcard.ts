// 照片版面「閃卡」（暗，P8 印刷品）：照片做成一張收藏閃卡，立在黑色的亮面檯子上，像商品攝影——
//  - 卡片：圓角、雷射全像的外框（顏色跟著卡片的角度與位置流動，細細的繞射紋）、上面一條名牌（相簿名、編號 No.003／120）、
//    中間是照片、下面淺色的說明框，最下面一行小字是系列編號（新人縮寫＋婚禮月日，沒有日期用 520）與稀有度星星。
//    橫的照片：照片在上、說明框在下；直的照片：卡片橫放，照片在左、說明框在右。
//  - 字（_photo.ts 的 PhotoText，思源黑體）：說明框印主字（賓客留言＋署名，或新人的註解）；這時歌詞不擠進卡片，
//    而是像字幕放在畫面下方的黑檯面上（lyricsApart，位置固定，卡片往上讓）。沒有主字時歌詞自己印在說明框裡跟唱；
//    兩個都沒有就沒有說明框（卡片只有名牌與照片）。卡片上的照片慢慢往新人點的焦點推（1.18 倍）。
//  - 進場：卡片從背面轉過來（翻一圈落在第一拍）；之後很慢地左右轉一點（全像的顏色跟著變），鏡頭慢慢推近。
//    每個小節線一道雷射閃光從卡片上斜斜掃過（外框亮、照片上只有很淡的一層，照片不發光）。
//  - 檯面是黑的亮面：看得到卡片淡淡的倒影；後面一盞很軟的頂光。照片完整呈現（不裁），很小的舊照片最多放大約 1.5 倍。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { ease, hash, lerp, prog } from '../engine/util';
import { INITIALS, DATE_MMDD, barAfter, beatAfter } from './_motifs';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, planePoint, homographyPx, clip, textFits, DARK_LYRIC, type Plane, type PressTextStyle } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', energy: [0.35, 1], bars: [2, 8], weight: 1, prefers: ['landscape', 'square'], thumbAt: 0.583 };

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D type; uniform sampler2D cap;
  uniform mat3 mCard; uniform vec2 card; uniform vec4 pr; uniform vec4 crop; uniform vec4 box; uniform float photoPx;
  uniform vec4 capRect; uniform float zs; uniform float show; uniform float back; uniform float hue; uniform float glint; uniform float glAng; uniform float floorY; uniform float k; uniform float t;
  float rbox(vec2 q, vec2 c, vec2 hs, float r) { return sdBox(q - c, hs - r) - r; }
  // 全像：顏色跟著角度（hue）與位置流動，細細的斜紋（繞射）
  vec3 holo(vec2 q, float amt) {
    float n = fbm(q / 160.0, 2);
    float ph = hue + (q.x + q.y * 0.6) / 520.0 + n * 0.35;
    vec3 rb = 0.5 + 0.5 * cos(6.2832 * (ph + vec3(0.0, 0.33, 0.67)));
    float lines = 0.5 + 0.5 * sin((q.x - q.y) * 0.9 + n * 6.0);
    // 銀底，彩虹只佔三成多（精緻，不要整片螢光）
    vec3 base = mix(C_ASH, C_BONE, 0.35) * 0.45;
    return mix(base, mix(base, rb * 0.6, 0.36), amt) * (0.9 + 0.14 * lines);
  }
  // 卡片在畫面 p 的顏色與覆蓋率；lodAdd 給倒影用（比較糊）
  vec4 cardAt(vec2 p, float lodAdd, bool refl) {
    if (show < 0.5) return vec4(0.0);
    // 卡片轉到快側面時，平面的消失線會進到畫面裡：線另一邊的點是「鏡頭後面」，不是卡片
    if ((mCard * vec3(p, 1.0)).z * zs <= 0.0) return vec4(0.0);
    vec2 q = homo(mCard, p);
    float s = homoScale(mCard, p);
    float d = rbox(q, card * 0.5, card * 0.5, 22.0);
    float a = clamp(0.5 - d / max(s * (1.0 + lodAdd), 0.3), 0.0, 1.0);
    if (a <= 0.0) return vec4(0.0);
    // 雷射閃光：一條斜的亮帶，邊緣帶一點彩虹
    vec2 gd = vec2(cos(glAng), sin(glAng));
    float gx = dot(q - card * 0.5, gd) / length(card) - glint;
    float gl = exp(-gx * gx / 0.0016);
    vec3 col;
    // 照片那一塊（閃光經過照片時壓淡，照片不發光）
    float phMask = 0.0;
    if (back > 0.5) {
      // 背面：深色的底、很細的全像菱格紋，中間兩道細圈（像收藏卡背面的徽記）
      vec2 c = q - card * 0.5;
      float r = length(c);
      vec2 dg = abs(fract(vec2(q.x + q.y, q.x - q.y) / 30.0) - 0.5) * 30.0;
      float lat = 1.0 - smoothstep(0.4, 1.4, min(dg.x, dg.y));
      col = C_INK2 * 1.5 + holo(q, 1.0) * (0.06 + 0.16 * lat);
      float rings = max(1.0 - smoothstep(0.8, 2.0, abs(r - 112.0)), 1.0 - smoothstep(0.5, 1.4, abs(r - 124.0)));
      col = mix(col, holo(q * 1.3, 1.0) * 1.1, rings * 0.85);
    } else {
      col = holo(q, 1.0);
      // 照片（窗口邊一圈細細的暗線）
      vec2 uv = (q - pr.xy) / pr.zw;
      float inPh = edgeA(q - pr.xy, pr.zw, s);
      phMask = inPh;
      col = mix(col, C_INK * 0.5, edgeA(q - pr.xy + 3.0, pr.zw + 6.0, s) * (1.0 - inPh));
      if (inPh > 0.0) {
        float lod = log2(max(s * photoPx / pr.z, 1e-4) / PX_SCALE) + lodAdd;
        vec3 ph = photoLin(photo, cropUv(crop, uv), lod) * 0.96;
        // 照片上只有很淡的全像（閃光經過時多一點）
        ph = mix(ph, ph + holo(q, 1.0) * 0.08, 0.3 + 0.7 * gl);
        col = mix(col, ph, inPh);
      }
      // 說明框：淺色、細邊
      if (box.z > 0.0) {
        float bd = rbox(q, box.xy + box.zw * 0.5, box.zw * 0.5, 8.0);
        float ba = clamp(0.5 - bd / max(s, 0.3), 0.0, 1.0);
        vec3 bc = mix(C_BONE, C_PAPER, 0.4) * 0.72 + holo(q, 1.0) * 0.05;
        col = mix(col, C_INK * 0.4, clamp(0.5 - (bd - 2.0) / max(s, 0.3), 0.0, 1.0) * (1.0 - ba));
        col = mix(col, bc, ba);
      }
      // 倒影不畫字（倒過來的字會被讀到、搶焦點）
      if (!refl) {
        vec4 tc = layerAt(type, q / card);
        col = col * (1.0 - tc.a) + tc.rgb;
        vec4 cc = layerAt(cap, (q - capRect.xy) / capRect.zw);
        col = col * (1.0 - cc.a) + cc.rgb;
      }
    }
    col += ((0.5 + 0.5 * cos(6.2832 * (gx * 6.0 + vec3(0.0, 0.33, 0.67)))) * 0.28 * gl + C_BONE * 0.12 * gl) * (1.0 - 0.75 * phMask);
    // 卡片的邊：一圈很細的亮線（厚度）
    col = mix(col, C_BONE * 0.55, clamp(0.5 - abs(d + 1.0) / max(s, 0.3), 0.0, 1.0) * 0.6);
    return vec4(col, a);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 背景：很暗，卡片後面一盞很軟的頂光；檯面（floorY 以下）是黑的亮面，有一圈光
    vec2 lq = (p - vec2(${W / 2 - 80}.0, floorY - 420.0)) / vec2(900.0, 640.0);
    vec3 col = C_INK * 0.9 + mix(C_INK2, C_GRAPHITE, 0.25) * 0.55 * exp(-dot(lq, lq) * 1.2);
    float fl = smoothstep(floorY - 2.0, floorY + 2.0, p.y);
    vec2 fq = (p - vec2(${W / 2 - 80}.0, floorY + 40.0)) / vec2(760.0, 120.0);
    vec3 floorC = C_INK * 0.7 + mix(C_INK2, C_ASH, 0.1) * 0.35 * exp(-dot(fq, fq));
    col = mix(col, floorC, fl);
    // 卡片的倒影（往下對稱、越遠越淡、比較糊）
    if (p.y > floorY) {
      vec2 mp = vec2(p.x, 2.0 * floorY - p.y);
      vec4 rc = cardAt(mp, 3.5, true);
      float fade = 0.12 * exp(-(p.y - floorY) / 110.0);
      col = mix(col, rc.rgb, rc.a * fade);
    }
    vec4 c = cardAt(p, 0.0, false);
    // 卡片在檯面上的影子（底下一條很軟的暗）
    col *= 1.0 - 0.5 * exp(-pow((p.y - floorY) / 10.0, 2.0)) * smoothstep(0.0, 1.0, 1.0 - abs(p.x - ${W / 2 - 80}.0) / 520.0);
    col = mix(col, c.rgb, c.a);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, type: { value: null }, cap: { value: null },
  mCard: { value: new THREE.Matrix3() }, card: { value: new THREE.Vector2() }, pr: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, box: { value: new THREE.Vector4() },
  photoPx: { value: 1 }, capRect: { value: new THREE.Vector4() }, show: { value: 1 }, zs: { value: 1 }, back: { value: 0 }, hue: { value: 0 }, glint: { value: -5 }, glAng: { value: 0.6 },
  floorY: { value: 900 }, k: { value: 1 }, t: { value: 0 },
});

type R = [number, number, number, number];
/** 外框寬、名牌高、底下系列編號那一行的高。 */
const B = 24, NAME = 58, FOOT = 40;

export default class Tradingcard extends PressPlate {
  bg = shared('tradingcard.bg', BG);
  type!: Layer2D;
  cap!: Layer2D;
  cw = 0; ch = 0;
  pr: R = [0, 0, 0, 0];
  box: R = [0, 0, 0, 0];
  /** 檯面的高度（卡片立在這裡）：下面有歌詞字幕時往上讓。 */
  floorY = 900;
  side = false;
  code = '';
  tSpin = 0;
  dir = 1;

  override async init() {
    const { start, audio } = this.ctx;
    this.code = `${INITIALS}-${DATE_MMDD || '520'}`;
    await this.loadPhoto(`${this.code}No.0123456789/★`);
    const a = this.aspect, tx = this.hasText;
    // 說明框裡的字：主字（留言或註解）；有主字又有歌詞時，歌詞是畫面下方的字幕（卡片的說明框寫不下兩組大字）
    const st = (w: number, h: number, maxLines = 4): PressTextStyle => ({
      family: F.hei(700), w, h, min: 40, max: 48, lineHeight: 1.32, maxLines,
      ink: rgba('ink', 0.9), unsung: rgba('ink', 0.3), active: rgba('blood'), sigInk: rgba('ink', 0.62),
      lyricsApart: true, lyricW: 1000, apartAlign: 'center', apartInk: DARK_LYRIC(),
    });
    /** 排字：先照四行排，60 字的留言放不下就多折幾行；回傳放不放得下。 */
    const layText = (w: number, h: number, more: number) => {
      if (!textFits(this.makeText(st(w, h)), h)) this.makeText(st(w, h, more));
      return textFits(this.text, h);
    };
    this.side = tx && a < 1;
    // 字幕（最後一排基線在 y = 968，HUD 區上面）；卡片立在字幕上面
    const barCx = W / 2 - 80;
    if (!this.side) {
      // 照片在上、說明框在下：說明框的高度照字排出來的高度（最高 280，長的字縮小一點，照片才不會被擠得很小），照片用剩下的高度
      const boxW = 560 - 12;
      layText(boxW - 44, 280, 7);
      const barTop = this.lyricBar(barCx, 968);
      this.floorY = barTop === null ? 900 : barTop - 44;
      const boxH = tx ? Math.round(Math.max(140, this.text.height + this.text.size * 0.35 + 40)) : 0;
      let w = Math.min(560, (this.floorY - 120 - (B + NAME + (tx ? 14 + boxH : 0) + FOOT + B / 2)) * a);
      w = Math.min(w, this.img.w * 1.5);
      const h = w / a;
      this.cw = 560 + 2 * B;
      this.pr = [(this.cw - w) / 2, B + NAME, w, h];
      this.box = tx ? [B + 6, B + NAME + h + 14, boxW, boxH] : [0, 0, 0, 0];
      this.ch = Math.round(B + NAME + h + (tx ? 14 + boxH : 0) + FOOT + B / 2);
    } else {
      // 直的照片：卡片橫放，照片在左、說明框在右；說明框放不下（60 字的留言＋署名）就加寬，最多 520
      let bw = 400, h = Math.min(520, this.img.h * 1.5);
      while (!layText(bw - 44, h - 36, 8) && bw < 520) bw += 40;
      const barTop = this.lyricBar(barCx, 968);
      this.floorY = barTop === null ? 900 : barTop - 44;
      h = Math.min(h, this.floorY - 120 - (B + NAME + FOOT + B / 2));
      const w = h * a;
      this.cw = Math.round(B + w + 16 + bw + B);
      this.pr = [B, B + NAME, w, h];
      this.box = [B + w + 16, B + NAME, bw, h];
      this.ch = Math.round(B + NAME + h + FOOT + B / 2);
    }
    this.type = this.track(new Layer2D(this.cw, this.ch, SCALE, { fast: true }));
    const [, , bw, bh] = this.box;
    this.cap = this.track(new Layer2D(Math.max(40, bw - 40) + 10, Math.max(40, bh - 30) + 10, SCALE, { fast: true }));
    this.drawType();
    this.cap.upload();
    this.tSpin = beatAfter(audio, start + 0.7);
    this.dir = hash(this.seed, 6) < 0.5 ? -1 : 1;
  }

  /** 名牌（相簿名、編號）與最下面的系列編號、星星。 */
  private drawType() {
    const L = this.type, c = L.ctx;
    L.clear();
    const ph = this.photo;
    c.textBaseline = 'alphabetic';
    c.shadowColor = rgba('ink', 0.5); c.shadowBlur = 4;
    c.fillStyle = rgba('bone', 0.92);
    const no = `No.${String(ph.n).padStart(3, '0')}/${String(ph.total).padStart(3, '0')}`;
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '2px';
    c.textAlign = 'right';
    c.fillText(no, this.cw - B - 10, B + 36);
    const noW = c.measureText(no).width;
    c.textAlign = 'left';
    c.letterSpacing = '3px';
    c.font = font(F.hei(700), 22);
    if (ph.album) c.fillText(clip(c, ph.album, this.cw - 2 * B - noW - 40), B + 10, B + 37);
    c.letterSpacing = '2px';
    c.font = font(F.mono(500), 14);
    c.fillStyle = rgba('bone', 0.75);
    c.fillText(this.code, B + 10, this.ch - B / 2 - 14);
    c.textAlign = 'right';
    c.fillStyle = rgba('signal', 0.9);
    c.fillText('★★★', this.cw - B - 10, this.ch - B / 2 - 14);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
    c.shadowBlur = 0;
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    // 翻一圈落在第一拍（從背面轉過來），之後很慢地左右轉一點
    const spin = ease.outCubic(prog(t, s, this.tSpin));
    const sway = Math.sin(lt * 0.55 + this.seed) * 7 * (Math.PI / 180);
    const ry = this.dir * (1 - spin) * Math.PI + sway * spin + this.dir * 8 * (Math.PI / 180);
    const cy = this.floorY - this.ch / 2 - 6;
    const card: Plane = { x: W / 2 - 80, y: cy, w: this.cw, h: this.ch, ry, rx: -3 * (Math.PI / 180) };
    const [fx, fy] = planePoint(card, 0.5, 0.45);
    const cam = { f: 1600, zoom: 0.97 + 0.05 * z0, cx: fx, cy: fy };
    const u = this.bg.u;
    const m = homographyPx(planeQuad(card, cam), this.cw, this.ch, u.mCard!.value as THREE.Matrix3);
    // 卡片中心那一點的齊次座標 z 的正負號（shader 用來分辨鏡頭前後）
    const [ccx, ccy] = planePoint(card, 0.5, 0.5, cam);
    const me = m.elements;
    u.zs!.value = Math.sign(me[2]! * ccx + me[5]! * ccy + me[8]!) || 1;
    (u.card!.value as THREE.Vector2).set(this.cw, this.ch);
    (u.pr!.value as THREE.Vector4).set(...this.pr);
    (u.box!.value as THREE.Vector4).set(...this.box);
    // 卡片上的照片往焦點推（1.18 倍）
    const crop = this.pushCrop(lt, this.pr[2] / this.pr[3], 1.18, this.pr[2]);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    u.type!.value = this.type.texture;
    // 說明框裡的字在框裡垂直置中
    if (this.hasText) this.paintText(this.cap, t, 0, Math.max(0, (this.box[3] - 36 - this.text.height - this.text.size * 0.35) / 2));
    u.cap!.value = this.cap.texture;
    (u.capRect!.value as THREE.Vector4).set(this.box[0] + 22, this.box[1] + 18, this.cap.w, this.cap.h);
    u.back!.value = Math.cos(ry) < 0 ? 1 : 0;
    // 側面對著鏡頭的那一瞬間（卡片薄到看不見）不畫，矩陣在那裡會退化
    u.show!.value = Math.abs(Math.cos(ry)) > 0.02 ? 1 : 0;
    u.hue!.value = ry * 0.5 + lt * 0.03;
    // 雷射閃光：翻完那一拍一次，之後每個小節線一次（0.55 秒掃過）
    const bar = Math.max(barAfter(audio, t - 0.55, 0), this.tSpin);
    const g = t >= bar ? prog(t, bar, bar + 0.55) : t >= this.tSpin ? prog(t, this.tSpin, this.tSpin + 0.55) : 0;
    u.glint!.value = g > 0 && g < 1 ? lerp(-0.8, 0.8, ease.inOutQuad(g)) : -5;
    u.glAng!.value = 0.5 + 0.4 * hash(Math.round(bar * 10), 2);
    u.floorY!.value = planePoint(card, 0.5, 1, cam)[1];
    u.t!.value = lt;
    u.k!.value = (0.85 + 0.15 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    // 歌詞字幕（有主字時）：卡片翻過來之後淡入
    this.renderBar(t, out, ease.outCubic(prog(t, s + 0.3, s + 0.8)) * (1 - prog(t, e - 0.3, e)));
    return PHOTO_POST(false, { vignette: 0.5, bloom: 0.25 });
  }
}
