// 萬花筒（暗）：從萬花筒的目鏡看出去——一整片鏡像對稱的彩色玻璃碎片，跟著節拍「喀、喀」地轉。
//  - 全部在一個全螢幕 shader 裡：像素先折進鏡子的楔形（兩片鏡子夾 180°/N，變化款 0 是 12 面、1 是 8 面），
//    再到「物件盒」裡找玻璃碎片（三角片、菱形片、珠子，兩層疊著、透光）。鏡子接縫留一條極淡的線，像真的鏡片。
//  - 動作落在拍點：每一拍轉筒轉一格（outExpo，轉完停住），每個小節線碎片「翻滾」一次（物件盒整個滑一段），
//    同時筒口的金屬唇上有一道反光繞一圈；大鼓讓背光亮一下、hi-hat 讓碎片的邊閃一下。
//    光從色玻璃透出來，在筒口外的暗處灑一圈彩色的光斑，跟著轉筒一起轉（每拍轉一格），大鼓時亮一下。
//  - 標準 v2：萬花筒（場景）是主視覺、佔畫面左邊大半；主打留言寫在右邊的暗處（筒壁上，不加框），字級 40～60，
//    署名在最後一行下面。有留言時碎片稍微暗一點，焦點靠對比落在留言上。
//  - 歌詞在左下（筒口往下暗掉的地方），比留言小一點。沒有留言：右邊放一句淡淡的邀請、歌詞是焦點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, type LyricStyle } from './_motifs';
import { subRect } from './_t13';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.4, 1], bars: [4, 8], variants: 2 };

/** 萬花筒的中心與筒口半徑：偏左，右邊的暗處留給留言。 */
const O = { x: 690, y: 468 };
const RV = 540;
/** 下緣從這裡開始往下暗（歌詞在暗處，不用框）。 */
const STRIP = 760;
/** 歌詞：左緣、基線、最寬（右端不超過筒口太多）。 */
const LX = 124, LBASE = 952, LW = 1120;
/** 右邊的留言區（標準 v2：寬 ≤ 860、高 ≤ 430）：筒壁上的暗處，不加框。右緣留給慢推（推 3% 時字還在邊界內）。 */
const MSG = { x: 1286, y: 214, w: 500, h: 430 };
const MSG_R = { x: MSG.x - 20, y: MSG.y - 20, w: MSG.w + 40, h: MSG.h + 60 };
const STRIP_R = { x: 96, y: 836, w: 1264, h: 160 };
const FAM_MSG = F.hand(400);
const FAM_LYRIC = F.archivo(87.5, 800);
const INVITE = ['掃描右下角 QR code，', '把你的祝福放進萬花筒。'];
const FOOTNOTE = '＊本萬花筒一拍轉一格，同一個花樣不會出現第二次。';

const FRAG = /* glsl */ `
uniform vec2 uO; uniform float uPhi; uniform vec2 uOff; uniform float uKick; uniform float uHat;
uniform float uN; uniform float uIn; uniform float uStrip; uniform float uT; uniform float uSeed; uniform float uStyle;
uniform float uRV; uniform float uCalm; uniform float uGlint; uniform float uGlintK;

float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r; p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float ndot(vec2 a, vec2 b) { return a.x * b.x - a.y * b.y; }
float sdRhombus(vec2 p, vec2 b) {
  p = abs(p);
  float h = clamp(ndot(b - 2.0 * p, b) / dot(b, b), -1.0, 1.0);
  float d = length(p - 0.5 * b * vec2(1.0 - h, 1.0 + h));
  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}
// 碎片的顏色：訊號色一家子為主，加一點透明玻璃（紙白）與煙灰色；不用點綴色（那是愛心的）
vec3 chipCol(float h) {
  if (h < 0.28) return C_SIGNAL * 0.70;
  if (h < 0.44) return C_BLOOD * 1.05;
  if (h < 0.56) return C_EMBER * 0.62;
  if (h < 0.72) return C_BONE * 0.36;
  if (h < 0.84) return C_ASH * 0.40;
  return C_SIGNAL * 0.36;
}
// 一層碎片：cs = 格子大小（px），每格最多一片，形狀、大小、角度、顏色都由格子的雜湊決定。
// 碎片是透光的色玻璃：疊在別的碎片上時是「濾色」（顏色變深、變飽和），疊在空隙上就是它自己的顏色。
void chips(vec2 p, float cs, float seed, float kind, float dens, inout vec3 col, inout float rim) {
  vec2 cell = floor(p / cs);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    if (hash12(c + seed) > dens) continue;                     // 有些格子是空的：碎片之間要透光
    vec2 o = (c + 0.5 + (hash22(c + seed * 1.7) - 0.5) * 0.7) * cs;
    float ang = hash12(c + seed * 3.1) * TAU;
    vec2 q = rot2(ang) * (p - o) / cs;
    float sz = 0.34 + 0.4 * hash12(c + seed * 5.3);
    float shape = hash12(c + seed * 7.7);
    float d;
    if (kind < 0.5) d = shape < 0.5 ? sdTri(q, sz * 0.66) : sdRhombus(q, vec2(sz * 1.1, sz * 0.46));
    else d = shape < 0.5 ? length(q) - sz * 0.4 : sdRhombus(q, vec2(sz * 1.5, sz * 0.17));   // 珠子、細長的玻璃棒
    d *= cs;                                                   // 回到 px：邊緣的反鋸齒與亮邊寬度用 px 算
    if (d > 2.0) continue;
    float cov = 1.0 - smoothstep(-1.0, 1.0, d);
    vec3 cc = chipCol(hash12(c + seed * 9.1));
    vec3 tint = cc / max(max(cc.r, cc.g), max(cc.b, 1e-3));
    // 中間亮、靠邊暗一點（玻璃的厚度），疊在別片上就濾色
    float inner = smoothstep(0.0, -cs * sz * 0.45, d);
    vec3 glass = cc * (0.6 + 0.6 * inner);
    col = mix(col, glass * 0.8 + col * tint * 0.75, cov * 0.94);
    rim += cov * (1.0 - smoothstep(0.0, 2.0, abs(d + 1.1))) * (0.4 + 0.6 * hash12(c + seed * 2.3));
  }
}
// 筒口外的彩色光斑：光穿過色玻璃灑在筒壁上。在極座標裡一格一塊（角度跟著轉筒轉），越遠越淡、越糊。
vec3 flecks(float r, float a, float phi) {
  float rr = (r - uRV) / 70.0;
  if (rr < 0.0 || rr > 3.5) return vec3(0.0);
  float ring = floor(rr);
  float n = 18.0 + ring * 6.0;
  float aa = (a + phi * (ring < 2.0 ? 1.0 : -0.6)) / TAU * n;
  vec2 cell = vec2(floor(aa), ring);
  float h = hash12(cell + 3.7);
  if (h < 0.55) return vec3(0.0);
  vec2 q = vec2(fract(aa) - 0.5, fract(rr) - 0.5);
  float blur = 0.06 + 0.06 * ring;
  float d = length(q * vec2(1.0, 1.5)) - (0.1 + 0.08 * hash12(cell + 9.1));
  float k = 1.0 - smoothstep(-blur, blur, d);
  vec3 cc = chipCol(hash12(cell + 5.3));
  float fade = 1.0 - rr / 3.5;
  return cc * k * fade * fade;
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec2 d = p - uO;
  float r = length(d);
  float a = atan(d.y, d.x);
  float sec = PI / uN;
  float am = mod(a, 2.0 * sec);
  if (am > sec) am = 2.0 * sec - am;                           // 兩片鏡子的反射
  float seam = min(am, sec - am) * r;                          // 到鏡子接縫的距離（px）
  vec2 q = r * vec2(cos(am), sin(am));
  q = rot2(uPhi) * q + uOff;                                   // 轉筒：物件盒相對鏡子轉動、滑動

  // ---- 筒裡看得到的圓（筒口）：碎片只在這個圓裡；外面是筒壁
  float view = 1.0 - smoothstep(uRV - 1.5, uRV + 1.5, r);
  vec3 col = C_INK2 * 0.8 + C_BLOOD * 0.07 * (0.5 + 0.5 * fbm(q / 240.0 + uSeed, 3));
  col *= 1.0 + 0.6 * (1.0 - r / uRV);                          // 背光：中間亮一點
  float rim = 0.0;
  if (view > 0.0) {
    chips(q, 104.0, uSeed + 11.0, uStyle, 0.86, col, rim);
    chips(q + vec2(37.0, 91.0), 62.0, uSeed + 29.0, 1.0 - uStyle, 0.62, col, rim);
  }
  // 背光跟著大鼓亮一下；切面的亮線 hi-hat 一打就閃（離中心越遠越柔：像前景虛化）
  col *= 0.9 + 0.24 * uKick;
  col += C_EMBER * rim * (0.14 + 0.45 * uHat) * (1.0 - 0.6 * smoothstep(300.0, 560.0, r));
  // 有留言時碎片稍微退一點（焦點靠對比落在右邊的留言上）
  col *= 1.0 - 0.18 * uCalm;
  col += C_BONE * 0.04 * pxLine(seam, 0.3, 1.2);
  // 筒口邊緣：往外暗下去（鏡子的邊），再來一圈金屬唇
  col *= mix(1.0, 0.35, smoothstep(uRV - 150.0, uRV, r));
  vec3 wall = C_INK * (0.55 + 0.25 * fbm(p / 420.0 + 7.0, 3));
  // 筒壁上的同心細紋（像車床車出來的），離筒口越遠越淡
  wall += C_ASH * 0.02 * pxLine(abs(fract((r - uRV) / 23.0 + 0.5) - 0.5) * 23.0, 0.3, 1.0) * step(uRV + 20.0, r) * (1.0 - smoothstep(uRV + 100.0, uRV + 520.0, r));
  // 彩色光斑（跟著轉筒轉，大鼓時亮一下）
  // 留言那一側（右邊）淡很多：字後面要乾淨
  wall += flecks(r, a, uPhi) * (0.3 + 0.4 * uKick) * (1.0 - 0.8 * smoothstep(1180.0, 1300.0, p.x));
  // 右下角 HUD（x ≥ 1360、y ≥ 830）底下的筒壁要乾淨：細紋與浮塵在這一區淡掉
  float hud = 1.0 - smoothstep(0.0, 80.0, length(max(vec2(1360.0, 830.0) - p, 0.0)));
  wall = mix(wall, C_INK * (0.55 + 0.25 * fbm(p / 420.0 + 7.0, 3)), hud);
  col = mix(wall, col, view);
  // 金屬唇：一圈細線；每個小節線一道反光沿著唇繞半圈（outExpo）
  float lip = 0.28 * aaStroke(r - uRV - 5.0, 1.6) + 0.12 * aaStroke(r - uRV - 15.0, 0.9);
  float da = abs(mod(a - uGlint + PI, TAU) - PI);
  float glint = exp(-da * da * 30.0) * uGlintK;
  col += C_ASH * lip + C_EMBER * glint * (1.1 * aaStroke(r - uRV - 5.0, 2.4) + 0.35 * exp(-abs(r - uRV - 6.0) / 14.0));

  // 下緣慢慢暗下去（歌詞在這裡，不用框）
  col *= mix(1.0, 0.12, smoothstep(uStrip, uStrip + 200.0, p.y));
  fragColor = vec4(col * uIn, 1.0);
}`;

const BG = () => new FSPass(FRAG, {
  uO: { value: new THREE.Vector2(O.x, O.y) }, uPhi: { value: 0 }, uOff: { value: new THREE.Vector2() },
  uKick: { value: 0 }, uHat: { value: 0 }, uN: { value: 6 }, uIn: { value: 1 }, uStrip: { value: STRIP }, uT: { value: 0 },
  uSeed: { value: 0 }, uStyle: { value: 0 }, uRV: { value: RV }, uCalm: { value: 0 }, uGlint: { value: 0 }, uGlintK: { value: 0 },
});

interface MsgLay { fit: FitResult; sig: string; sigSize: number; top: number; n: number; t0: number; dur: number }

export default class Kaleidoscope extends Scene {
  bg = shared('kaleidoscope.bg', BG);
  /** 右邊的留言（寫完後就不變：只有 key 變了才重畫、重新上傳）。 */
  win = this.track(new Layer2D(MSG_R.w, MSG_R.h, undefined, { fast: true }));
  /** 左下的歌詞（每格都變，但只有一條，上傳很小）。 */
  strip = this.track(new Layer2D(STRIP_R.w, STRIP_R.h, undefined, { fast: true }));
  /** 左上角的讀數（轉數一拍變一次）。 */
  info = this.track(new Layer2D(420, 100, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  variant = (this.ctx.params.variant ?? 0) % 2;
  seed = (this.ctx.params.seed ?? 7) % 97;
  lay: MsgLay | null = null;
  tOpen = 0;
  winKey = '';
  infoKey = '';
  inviteFit: FitResult | null = null;

  override async init() {
    const { audio: au, start, song } = this.ctx;
    this.tOpen = beatAfter(au, start + 0.05);
    await loadText(`${INVITE.join('')}${FOOTNOTE}萬花筒第轉面鏡${song.title}${song.artist}${this.msg ? signature(this.msg.name) : ''}`);
    const c = this.win.ctx;
    if (this.msg) {
      const text = this.msg.text;
      // 字級上限依字數（標準 v2）；先照子句排，排不下再交給 fitText。高度扣掉署名（署名永遠在最後一行下面）
      const sigEst = sigV2(msgMaxFor(text));
      const h = MSG.h - sigEst * 2.2;
      const o = { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.4, maxLines: 6 };
      const fit = fitClauses(c, text, FAM_MSG, MSG.w, h, o) ?? fitText(c, text, FAM_MSG, MSG.w, h, o);
      const sigSize = sigV2(fit.size);
      const blockH = fit.height + sigSize * 2.2;
      const n = fit.lines.reduce((s, l) => s + Array.from(l).length, 0);
      const dur = clamp(0.06 * n + 0.5, 0.8, 2.6);
      // 整塊在留言區裡上下置中（靠左對齊，像寫在筒壁上的一段字）
      this.lay = { fit, sig: signature(this.msg.name), sigSize, top: MSG.y + (MSG.h - blockH) / 2 + fit.size * 0.9, n, t0: this.tOpen + 0.12, dur };
    } else {
      this.inviteFit = fitText(c, INVITE.join(''), FAM_MSG, MSG.w, 160, { min: 40, max: 44, lineHeight: 1.4, maxLines: 2 });
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    // 轉筒：一拍一格，拍點上 outExpo 轉過去、停住；第一格前多轉一大圈（進場）
    const step = this.variant ? (Math.PI / 4) * 0.21 : (Math.PI / 6) * 0.23;
    const B = f.beat, bi = Math.floor(B), bp = B - bi;
    const turn = bi + ease.outExpo(clamp(bp / 0.32));
    const intro = 1 - ease.outExpo(prog(t, s, this.tOpen + 0.3));
    u.uPhi!.value = step * turn + intro * 1.4 + this.seed * 0.37;
    // 每個小節線：碎片滑一段（翻滾），方向由小節數決定
    const Bar = f.bar, ki = Math.floor(Bar), kp = Bar - ki;
    const slide = (k: number) => ({ x: 170 * Math.cos(k * 2.39996 + this.seed), y: 170 * Math.sin(k * 2.39996 + this.seed) });
    let ox = 0, oy = 0;
    for (let k = ki - 3; k <= ki; k++) {
      const w = k < ki ? 1 : ease.inOutCubic(clamp(kp / 0.22));
      const d = slide(k);
      ox += d.x * w; oy += d.y * w;
    }
    (u.uOff!.value as THREE.Vector2).set(ox + ki * 31, oy + ki * 17);
    u.uKick!.value = f.a.kick;
    u.uHat!.value = f.a.hat;
    u.uN!.value = this.variant ? 4 : 6;
    u.uStyle!.value = this.variant;
    u.uSeed!.value = this.seed;
    u.uT!.value = t;
    u.uIn!.value = prog(t, s, s + 0.2);
    // 小節線上的反光：從右上方沿著筒口唇繞半圈（outExpo），繞完淡掉
    const gp = (t - au.timeOfBar(ki)) / Math.max(0.2, au.timeOfBar(ki + 1) - au.timeOfBar(ki));
    u.uGlint!.value = -0.9 + (ki % 2 ? -1 : 1) * Math.PI * ease.outExpo(clamp(gp / 0.6));
    u.uGlintK!.value = 1 - clamp((gp - 0.35) / 0.4);
    // 有留言時：留言浮出來的同時碎片退一點
    const open = ease.outExpo(prog(t, this.tOpen, this.tOpen + 0.55)) * (1 - ease.inCubic(prog(t, e - 0.32, e)));
    u.uCalm!.value = this.msg ? open : 0;
    this.bg.render(renderer, out);

    // ---- 右邊的留言（或邀請）
    const ly = lyricAt(lyrics, t);
    if (this.msg && this.lay) this.drawMsg(t, open);
    else this.drawInvite(open * 0.75);
    comp.draw(renderer, this.win.texture, out, subRect(MSG_R));
    // ---- 左下：歌詞（或歌名＋註腳）
    this.drawStrip(t, ly, prog(t, s, s + 0.35) * (1 - prog(t, e - 0.25, e)));
    comp.draw(renderer, this.strip.upload(), out, subRect(STRIP_R));
    this.drawInfo(f, prog(t, s, s + 0.4));
    comp.draw(renderer, this.info.texture, out, { ...subRect({ x: MSG.x, y: 110, w: 420, h: 100 }), opacity: 1 - prog(t, e - 0.25, e) });

    return {
      bloom: 0.62, vignette: 0.42, halation: 0.2,
      // 慢推（整個窗格推 3%）＋大鼓時輕輕一推
      zoom: 1 + 0.03 * ease.inOutCubic(f.p) + 0.008 * f.a.kick,
      popupAvoid: [[MSG.x - 20, MSG.y - 20, MSG.w + 40, MSG.h + 40], [LX - 20, STRIP + 60, LW + 40, 150]],
    };
  }

  /** 留言：第一個拍點後一個字一個字從暗處浮出來（先是訊號色、很快冷成紙白），再寫署名。 */
  private drawMsg(t: number, k: number) {
    const L = this.lay!;
    const shown = L.n * prog(t, L.t0, L.t0 + L.dur);
    const sigK = prog(t, L.t0 + L.dur, L.t0 + L.dur + 0.4);
    const key = `${Math.floor(shown * 4)}|${Math.round(sigK * 12)}|${Math.round(k * 24)}`;
    if (key === this.winKey) return;
    this.winKey = key;
    const W2 = this.win, c = W2.ctx;
    W2.clear();
    c.save();
    c.translate(-MSG_R.x, -MSG_R.y);
    c.font = font(FAM_MSG, L.fit.size);
    c.textBaseline = 'alphabetic';
    let idx = 0;
    L.fit.lines.forEach((ln, i) => {
      const y = L.top + i * L.fit.lineHeight;
      let pre = '';
      for (const ch of Array.from(ln)) {
        const a = clamp(shown - idx);
        idx++;
        if (a > 0) {
          const x = MSG.x + c.measureText(pre).width;
          c.globalAlpha = k * a;
          // 還在浮出來的字帶一點訊號色
          c.fillStyle = a < 1 ? rgba('signal') : rgba('bone', 0.96);
          if (ch === '♥') fillWithHearts(c, ch, x, y + (1 - a) * 10);
          else c.fillText(ch, x, y + (1 - a) * 10);
        }
        pre += ch;
      }
    });
    if (sigK > 0) {
      // 署名：最後一行下面，靠右對齊留言的右緣
      c.globalAlpha = k * sigK;
      c.font = font(FAM_MSG, L.sigSize);
      c.fillStyle = rgba('ash');
      const sy = L.top + (L.fit.lines.length - 1) * L.fit.lineHeight + L.sigSize * 1.9;
      const sw = c.measureText(L.sig).width;
      c.fillText(L.sig, MSG.x + Math.max(L.fit.width, sw) - sw, sy);
    }
    c.restore();
    W2.upload();
  }

  /** 沒有留言：右邊一句淡淡的邀請（焦點是歌詞）。 */
  private drawInvite(k: number) {
    const key = `inv|${Math.round(k * 24)}`;
    if (key === this.winKey) return;
    this.winKey = key;
    const W2 = this.win, c = W2.ctx;
    W2.clear();
    c.save();
    c.translate(-MSG_R.x, -MSG_R.y);
    c.globalAlpha = k;
    c.font = font(FAM_MSG, this.inviteFit?.size ?? 42);
    c.fillStyle = rgba('bone', 0.8);
    INVITE.forEach((ln, i) => c.fillText(ln, MSG.x, MSG.y + MSG.h / 2 - 30 + i * 62));
    c.restore();
    W2.upload();
  }

  private drawStrip(t: number, ly: ReturnType<typeof lyricAt>, k: number) {
    const S = this.strip, c = S.ctx;
    S.clear();
    c.save();
    c.translate(-STRIP_R.x, -STRIP_R.y);
    c.globalAlpha = k;
    if (ly) {
      const size = lyricV2(this.lay ? this.lay.fit.size : null);
      const st: LyricStyle = { family: FAM_LYRIC, size, minSize: V2.lyrMin, maxWidth: LW };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      c.translate(LX, LBASE - (lay.height - lay.size) + (1 - inK) * 18);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      const { song } = this.ctx;
      c.font = font(F.mono(500), 16);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('ash', 0.6);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LX, 916);
      c.letterSpacing = '0px';
      // 冷面註腳（下緣空著的時候才放）
      c.font = font(F.hei(500), 20);
      c.fillStyle = rgba('bone', 0.4);
      c.fillText(FOOTNOTE, LX, 952);
    }
    c.restore();
  }

  /** 左上角的讀數：鏡子數、第幾轉（一拍一轉）。 */
  private drawInfo(f: Frame, k: number) {
    const turn = Math.max(0, Math.floor(f.beat - this.ctx.audio.beatAt(this.ctx.start)) + 1);
    const key = `${turn}|${Math.round(k * 10)}`;
    if (key === this.infoKey) return;
    this.infoKey = key;
    const L = this.info, c = L.ctx;
    L.clear();
    c.globalAlpha = k;
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('ash', 0.5);
    const mirrors = this.variant ? 8 : 12;
    // 一行很小的規格（右上角筒壁上的刻字），不搶焦點
    c.fillText(`萬花筒 · ${mirrors} 面鏡 · 第 ${String(turn).padStart(3, '0')} 轉`, 0, 22);
    c.letterSpacing = '0px';
    L.upload();
  }
}
