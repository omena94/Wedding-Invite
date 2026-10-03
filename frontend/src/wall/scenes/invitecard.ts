// 照片版面「喜帖」（亮，P8 印刷品）：照片印在一張喜帖卡上，放在亞麻桌布上，後面斜斜壓著打開的信封——
//  - 卡片：厚的米白卡紙、燙金的雙線框（四個角有小小的轉角花）、照片外一圈細金線；左邊一條緞帶繞過卡片（緞面的光澤會流動）。
//    橫的照片在上、字在下；直的照片在左、字在右。字（_photo.ts 的 PhotoText，思源宋體、置中）：主字（賓客留言＋署名，
//    或新人的註解），歌詞小一號接在下面跟唱；沒有主字時歌詞自己當主字。字多時照片縮小（直的：右欄加寬）。
//    最下面一行新人的名字與日期（小字，沒有日期就只有名字）。兩個都沒有就只有照片與名字。
//  - 信封：在卡片後面、斜一點、封口打開，裡面是訊號色淡淡的內襯；在焦外。
//  - 進場：鏡頭從緞帶與燙金框的特寫（焦外）拉開到整張卡片，焦點跟著拉過來；之後很慢地推近。
//    每個小節線，窗光在燙金框上掃過一次（金箔的反光，照片不發光）。
//  - 照片完整印出，印出來的畫面慢慢往新人點的焦點推（1.15 倍）；很小的舊照片最多放大到原尺寸約 1.5 倍。右下角（HUD）是桌布。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { ease, hash, lerp, prog } from '../engine/util';
import { COUPLE_ZH, DATE_ZH, joinBits, fitPx, barAfter } from './_motifs';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, planePoint, homographyPx, textFits, PAPER_INK, type Plane, type PressTextStyle } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', paper: true, energy: [0, 0.8], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D type; uniform sampler2D cap;
  uniform mat3 mCard; uniform mat3 mEnv; uniform vec2 card; uniform vec2 env; uniform vec4 pr; uniform vec4 crop; uniform float photoPx;
  uniform vec4 capRect; uniform float txtA; uniform float sheen; uniform float rib; uniform float blurAll; uniform float focusY; uniform float k; uniform float t;
  // 燙金：底色偏暗才壓得住亮紙，高光往 ember 走（最亮 0.85，不發光）
  vec3 foil(vec2 q, float sh) {
    float n = snoise(q / 6.0) * 0.5 + snoise(q / 1.7) * 0.5;
    vec3 base = mix(C_BLOOD, C_SIGNAL, 0.55) * 0.55;
    return base * (0.85 + 0.15 * n) + mix(C_SIGNAL, C_EMBER, 0.5) * 0.35 * sh;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = homo(mCard, p);
    float s = homoScale(mCard, p);
    float blur = blurAll + 1.1 * smoothstep(300.0, 760.0, abs(p.y - focusY));
    // 桌布：亞麻（細細的經緯線、一點點不均）
    vec2 qe = homo(mEnv, p);
    float se = homoScale(mEnv, p);
    vec2 wq = qe;
    float weave = 0.5 + 0.25 * sin(wq.x * 1.9) * (1.0 - min(blur, 1.0)) + 0.25 * sin(wq.y * 2.1) * (1.0 - min(blur, 1.0));
    float slub = snoise(vec2(wq.x / 4.0, wq.y / 160.0)) * 0.5 + snoise(vec2(wq.x / 170.0, wq.y / 4.0)) * 0.5;
    vec3 col = mix(C_BONE, C_PAPER, 0.65) * (0.86 + 0.03 * weave + 0.025 * slub);
    // 窗光：一大片從左上來，慢慢移
    float lit = dot(p + vec2(t * 6.0, 0.0), normalize(vec2(0.7, 0.72)));
    col *= 0.88 + 0.14 * smoothstep(2000.0, 500.0, lit);
    // 信封（後面、焦外）：本體＋打開的封口（三角形，裡面是內襯）
    float sh = exp(-outsideDist(homo(mEnv, p - vec2(8.0, 12.0)), env) / (se * 22.0));
    col *= 1.0 - 0.18 * sh;
    float aE = edgeA(qe, env, se * (1.0 + 3.0 * blur));
    vec3 envC = mix(C_BONE, C_PAPER, 0.5) * 0.9;
    // 封口：信封上緣往上翻開的三角形（內襯露出來）
    vec2 fq = vec2(qe.x - env.x * 0.5, -qe.y);
    float flapD = max(abs(fq.x) / (env.x * 0.5) + fq.y / (env.y * 0.55) - 1.0, -fq.y);
    float aF = clamp(0.5 - flapD * env.y * 0.5 / max(se * (1.0 + 3.0 * blur), 0.3), 0.0, 1.0);
    vec2 dq = fract(qe / 18.0) - 0.5;
    vec3 liner = mix(C_PAPER, C_SIGNAL, 0.3) * (0.86 - 0.06 * (1.0 - smoothstep(0.12, 0.2, length(dq))) * (1.0 - min(blur, 1.0)));
    col = mix(col, liner * 0.92, aF);
    if (aE > 0.0) {
      vec3 ec = envC * (0.96 + 0.03 * fbm(qe / 50.0, 2));
      // 信封背面的折線（兩條斜線交在中間）
      vec2 eu = qe / env;
      float fold = min(abs(eu.y - 0.62 + abs(eu.x - 0.5) * 0.7), 1.0);
      ec *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 0.01 + 0.02 * blur, fold)) - 0.04 * step(eu.y, 0.62 - abs(eu.x - 0.5) * 0.7);
      col = mix(col, ec, aE);
    }
    // 卡片的影子（厚卡紙，影子比較明顯）
    vec2 qs = homo(mCard, p - vec2(12.0, 18.0));
    float d = outsideDist(qs, card) / s;
    col *= 1.0 - 0.3 * (d <= 0.0 ? 1.0 : exp(-d / 20.0));
    float a = edgeA(q, card, s * (1.0 + blur * 2.0));
    if (a > 0.0) {
      vec3 paper = mix(C_BONE, C_PAPER, 0.3) * (0.95 + 0.025 * paperFiber(q * 1.3));
      vec3 pc = paper;
      float bandSh = exp(-pow((q.x * 0.6 + q.y * 0.4 - sheen) / 70.0, 2.0));
      // 燙金框：外框兩條線、四個角的轉角花（短的 L 形）
      vec2 c = q - card * 0.5;
      float b1 = abs(sdBox(c, card * 0.5 - 18.0)) - 1.3;
      float b2 = abs(sdBox(c, card * 0.5 - 26.0)) - 0.6;
      vec2 cq = card * 0.5 - 26.0 - abs(c);
      float fd = min(min(b1, b2), (cq.x >= 0.0 && cq.y >= 0.0) ? max(abs(min(cq.x, cq.y) - 10.0) - 0.9, max(cq.x, cq.y) - 34.0) : 1e3);
      // 照片外一圈細金線
      vec2 pc0 = q - pr.xy - pr.zw * 0.5;
      fd = min(fd, abs(sdBox(pc0, pr.zw * 0.5 + 7.0)) - 0.9);
      float fa = 1.0 - smoothstep(-0.6 * s, 0.6 * s + blur * 2.0, fd);
      pc = mix(pc, foil(q, bandSh), fa);
      // 照片
      vec2 uv = (q - pr.xy) / pr.zw;
      float inPh = edgeA(q - pr.xy, pr.zw, s);
      if (inPh > 0.0) {
        float lod = log2(max(s * photoPx / pr.z, 1e-4) / PX_SCALE) + blur * 2.0;
        pc = mix(pc, photoLin(photo, cropUv(crop, uv), lod), inPh);
      }
      vec2 br = vec2(blur * 2.5 * s);
      vec4 tc = layerBlur(type, q / card, br / card) * txtA;
      pc = pc * (1.0 - tc.a) + tc.rgb;
      vec4 cc = layerBlur(cap, (q - capRect.xy) / capRect.zw, br / capRect.zw) * txtA;
      pc = pc * (1.0 - cc.a) + cc.rgb;
      // 緞帶：卡片左邊一條，邊緣有一點立體，緞面的光沿著帶子流動
      float rx = q.x - rib;
      float ra = (1.0 - smoothstep(22.0 - s, 22.0 + s, abs(rx)));
      if (ra > 0.0) {
        float across = rx / 22.0;
        // 緞面：中間一道柔光順著帶子慢慢流、兩側各一條細的亮線（織邊）、繞過卡片上下緣的地方暗下去
        float flow = exp(-pow((q.y - mod(t * 140.0, card.y + 700.0) + 350.0) / 220.0, 2.0));
        float gloss = (0.35 + 0.65 * flow) * exp(-pow(across * 1.8 - 0.35, 2.0));
        float selv = exp(-pow((abs(across) - 0.86) / 0.05, 2.0));
        vec3 rc = mix(C_BLOOD, C_SIGNAL, 0.3) * (0.5 + 0.16 * cos(across * 1.6)) + C_BONE * (0.3 * gloss + 0.1 * selv);
        rc *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 26.0, min(q.y, card.y - q.y)));
        pc *= 1.0 - 0.3 * exp(-pow((abs(rx) - 24.0) / 4.0, 2.0));
        pc = mix(pc, rc, ra);
      }
      // 卡片的厚度：下緣與右緣一條很細的亮邊
      col = mix(col, C_BONE * 0.7, edgeA(homo(mCard, p - vec2(2.0, 3.0)), card, s) * (1.0 - a));
      col = mix(col, pc, a);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, type: { value: null }, cap: { value: null },
  mCard: { value: new THREE.Matrix3() }, mEnv: { value: new THREE.Matrix3() }, card: { value: new THREE.Vector2() }, env: { value: new THREE.Vector2() },
  pr: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, photoPx: { value: 1 }, capRect: { value: new THREE.Vector4() }, txtA: { value: 1 },
  sheen: { value: -1000 }, rib: { value: 50 }, blurAll: { value: 0 }, focusY: { value: H / 2 }, k: { value: 1 }, t: { value: 0 },
});

type R = [number, number, number, number];
/** 卡片左邊緞帶的中心、照片離緞帶的距離、四周留白。 */
const RIB = 58, LEFT = 112, M = 50;

export default class Invitecard extends PressPlate {
  bg = shared('invitecard.bg', BG);
  type!: Layer2D;
  cap!: Layer2D;
  cw = 0; ch = 0;
  pr: R = [0, 0, 0, 0];
  capR: R = [0, 0, 0, 0];
  /** 名字與日期那一行的位置（卡片座標，中心）。 */
  nameX = 0; nameY = 0; nameW = 0;
  /** 卡片中心在畫面上的位置（寬的卡片往左挪，右下角留給 HUD）。 */
  cx = W / 2 - 110;
  side = false;
  names = '';
  dir = 1;

  override async init() {
    this.names = joinBits('　', COUPLE_ZH, DATE_ZH);
    await this.loadPhoto(`${this.names}敬邀`);
    const a = this.aspect, tx = this.hasText;
    const sc = (w: number) => Math.min(1, (this.img.w * 1.5) / w);
    const st = (w: number, h: number, maxLines = 4): PressTextStyle => ({ family: F.ming(400), w, h, min: 40, max: 48, lineHeight: 1.4, maxLines, align: 'center', ...PAPER_INK() });
    /** 排字：先照四行排，60 字的留言放不下就多折幾行；回傳放不放得下。 */
    const layText = (w: number, h: number, more: number) => {
      if (!textFits(this.makeText(st(w, h)), h)) this.makeText(st(w, h, more));
      return textFits(this.text, h);
    };
    this.side = a < 1;
    if (!this.side) {
      // 橫的：照片在上，字在下。先排字（有字時卡片至少 760 寬，一行寫得下十幾個字），照片用剩下的高度（整張卡片最高 860）
      let w = Math.min(680, 560 * a);
      w *= sc(w);
      this.cw = Math.round(Math.max(LEFT + w + M, tx ? 760 : 640));
      const capW = this.cw - LEFT - M;
      layText(capW, 300, 6);
      const capH = tx ? Math.round(this.text.height + this.text.size * 0.35 + 8) : 0;
      let h = w / a;
      const rest = M + 40 + (tx ? capH + 14 : 0) + 74 + M;
      if (h + rest > 860) { h = 860 - rest; w = h * a; }
      const px = LEFT + (this.cw - LEFT - M - w) / 2;
      this.pr = [px, M + 4, w, h];
      this.capR = [LEFT, M + h + 40, capW, capH];
      this.ch = Math.round(h + rest);
      this.nameX = LEFT + (this.cw - LEFT - M) / 2; this.nameY = this.ch - M - 30; this.nameW = this.cw - LEFT - M - 40;
    } else {
      // 直的：照片在左，字在右；右欄放不下（60 字的留言＋署名＋兩排歌詞）就加寬，最多 540
      let h = 620;
      h *= Math.min(1, (this.img.h * 1.5) / h);
      const w = h * a;
      let colW = tx ? 440 : 300;
      while (!layText(colW, h - 200, 8) && colW < 540) colW += 50;
      this.cw = Math.round(LEFT + w + 56 + colW + M);
      this.ch = Math.round(M + h + M + 8);
      this.pr = [LEFT, M + 4, w, h];
      this.capR = [LEFT + w + 56, M + 60, colW, tx ? h - 200 : 0];
      this.nameX = LEFT + w + 56 + colW / 2; this.nameY = this.ch - M - 46; this.nameW = colW - 20;
    }
    this.cx = Math.min(W / 2 - 110, 1400 - this.cw / 2);
    this.type = this.track(new Layer2D(this.cw, this.ch, SCALE, { fast: true }));
    this.cap = this.track(new Layer2D(Math.max(40, this.capR[2]) + 10, Math.max(40, this.capR[3]) + 20, SCALE, { fast: true }));
    this.drawType();
    this.cap.upload();
    this.dir = hash(this.seed, 4) < 0.5 ? -1 : 1;
  }

  /** 新人的名字與日期（小字，燙金色的墨）。 */
  private drawType() {
    const L = this.type, c = L.ctx;
    L.clear();
    const fam = F.ming(700);
    const size = fitPx(this.names, fam, 26, this.nameW, 4);
    c.font = font(fam, size);
    c.letterSpacing = '4px';
    c.textAlign = 'center';
    c.fillStyle = rgba('sepia', 0.82);
    c.fillText(this.names, this.nameX, this.nameY);
    c.fillStyle = rgba('blood', 0.55);
    c.fillRect(this.nameX - 30, this.nameY - size - 22, 60, 1.5);
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const cx = this.cx, cy = H / 2 - 4;
    const card: Plane = { x: cx, y: cy, w: this.cw, h: this.ch, rx: 9 * (Math.PI / 180), rz: this.dir * -1.6 * (Math.PI / 180) };
    const env: Plane = { x: cx + this.cw * 0.42, y: cy - this.ch * 0.18, z: 20, w: this.cw * 0.9, h: this.ch * 0.72, rx: 9 * (Math.PI / 180), rz: this.dir * 7 * (Math.PI / 180) };
    // 進場：從緞帶上端的特寫拉開（1 秒），焦點跟著拉過來；字等鏡頭拉開才浮出來（特寫時卡片的右下角會經過 HUD）
    const pull = ease.inOutCubic(prog(t, s, s + 1.0));
    const [rx0, ry0] = planePoint(card, RIB / this.cw, 0.18);
    const zoom = lerp(1.45, 0.98, pull) + 0.04 * z0;
    const cam = { f: 1700, zoom, cx: lerp(rx0, cx, pull), cy: lerp(ry0, cy, pull), dx: lerp(W / 2 - rx0, 0, pull), dy: lerp(H / 2 - ry0, 0, pull) };
    const u = this.bg.u;
    homographyPx(planeQuad(card, cam), this.cw, this.ch, u.mCard!.value as THREE.Matrix3);
    homographyPx(planeQuad(env, cam), env.w, env.h, u.mEnv!.value as THREE.Matrix3);
    (u.card!.value as THREE.Vector2).set(this.cw, this.ch);
    (u.env!.value as THREE.Vector2).set(env.w, env.h);
    (u.pr!.value as THREE.Vector4).set(...this.pr);
    // 印出來的照片往焦點推（印在卡片上，1.15 倍）
    const crop = this.pushCrop(lt, this.pr[2] / this.pr[3], 1.15, this.pr[2]);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    u.type!.value = this.type.texture;
    // 字整塊在字區裡垂直置中
    if (this.hasText) this.paintText(this.cap, t, this.capR[2] / 2, Math.max(0, (this.capR[3] - this.text.height - this.text.size * 0.35) / 2));
    u.cap!.value = this.cap.texture;
    (u.capRect!.value as THREE.Vector4).set(this.capR[0], this.capR[1], this.cap.w, this.cap.h);
    u.rib!.value = RIB;
    // 燙金的反光：每個小節線掃過一次（卡片座標，從左上到右下）
    const bar = barAfter(audio, t - 1.6, 0);
    u.sheen!.value = t >= bar ? lerp(-300, this.cw * 0.6 + this.ch * 0.4 + 300, ease.inOutQuad(prog(t, bar, bar + 1.6))) : -1000;
    u.blurAll!.value = 1.6 * (1 - ease.outCubic(prog(t, s + 0.15, s + 1.0)));
    u.txtA!.value = ease.outCubic(prog(t, s + 0.65, s + 1.05));
    u.focusY!.value = planePoint(card, 0.5, 0.5, cam)[1];
    u.t!.value = lt;
    u.k!.value = (0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.6))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return PHOTO_POST(true);
  }
}
