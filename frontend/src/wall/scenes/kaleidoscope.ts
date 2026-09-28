// 萬花筒（暗）：從萬花筒的目鏡看出去——一整片鏡像對稱的彩色玻璃碎片，跟著節拍「喀、喀」地轉。
//  - 全部在一個全螢幕 shader 裡：像素先折進鏡子的楔形（兩片鏡子夾 180°/N，變化款 0 是 12 面、1 是 8 面），
//    再到「物件盒」裡找玻璃碎片（三角片、菱形片、珠子，兩層疊著、透光）。鏡子接縫留一條極淡的線，像真的鏡片。
//  - 動作落在拍點：每一拍轉筒轉一格（outExpo，轉完停住），每個小節線碎片「翻滾」一次（物件盒整個滑一段）；
//    大鼓讓背光亮一下、hi-hat 讓碎片的邊閃一下。
//  - 正中央是一塊「透明處」（煙燻玻璃的圓窗，細線刻度環）：第一個拍點打開，主打留言在裡面一個字一個字浮出來、署名、編號。
//  - 歌詞在下緣的「外框」（筒身的銘牌帶，碎片在這裡暗成一成）：逐字跟唱。
//  - 沒有留言：歌詞放大到中央的圓窗裡，外框寫歌名與邀請；純音樂又沒留言：圓窗裡是邀請。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, type LyricStyle } from './_motifs';
import { subRect, fitMsg } from './_t13';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.4, 1], bars: [4, 8], variants: 2 };

/** 萬花筒的中心（圓窗的圓心）與下緣外框的上緣。 */
const O = { x: 960, y: 455 };
const STRIP = 836;
/** 外框裡的歌詞：左緣、基線、最寬（右端停在 HUD 左邊）。 */
const LX = 124, LBASE = 952, LW = 1210;
/** 圓窗與它的文字圖層範圍（圓窗最大半徑 340，加上刻度環與署名）。 */
const RL_MAX = 330;
const MSG_R = { x: O.x - 420, y: O.y - 400, w: 840, h: 800 };
const STRIP_R = { x: 96, y: STRIP, w: 1264, h: 160 };
const FAM_MSG = F.hand(400);
const FAM_LYRIC = F.archivo(87.5, 800);
const INVITE = ['掃描右下角 QR code，', '把你的祝福放進萬花筒。'];
const FOOTNOTE = '＊本萬花筒一拍轉一格，同一個花樣不會出現第二次。';

const FRAG = /* glsl */ `
uniform vec2 uO; uniform float uPhi; uniform vec2 uOff; uniform float uRL; uniform float uKick; uniform float uHat;
uniform float uN; uniform float uIn; uniform float uStrip; uniform float uT; uniform float uSeed; uniform float uStyle;
uniform float uRing; uniform float uRV;

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

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec2 d = p - uO;
  float r = length(d);
  float a = atan(d.y, d.x);
  float sec = PI / uN;
  a = mod(a, 2.0 * sec);
  if (a > sec) a = 2.0 * sec - a;                              // 兩片鏡子的反射
  float seam = min(a, sec - a) * r;                            // 到鏡子接縫的距離（px）
  vec2 q = r * vec2(cos(a), sin(a));
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
  // 背光跟著大鼓亮一下；切面的亮線 hi-hat 一打就閃
  col *= 0.9 + 0.24 * uKick;
  col += C_EMBER * rim * (0.14 + 0.45 * uHat);
  col += C_BONE * 0.04 * pxLine(seam, 0.3, 1.2) * step(uRL + 20.0, r);
  // 筒口邊緣：往外暗下去（鏡子的邊），再來一圈金屬唇
  col *= mix(1.0, 0.35, smoothstep(uRV - 150.0, uRV, r));
  vec3 wall = C_INK * (0.55 + 0.25 * fbm(p / 420.0 + 7.0, 3));
  // 筒壁上的同心細紋（像車床車出來的）
  wall += C_ASH * 0.022 * pxLine(abs(fract((r - uRV) / 23.0 + 0.5) - 0.5) * 23.0, 0.3, 1.0) * step(uRV + 20.0, r);
  col = mix(wall, col, view);
  col += C_ASH * (0.28 * aaStroke(r - uRV - 5.0, 1.6) + 0.12 * aaStroke(r - uRV - 15.0, 0.9));

  // 下緣的外框只剩一成
  float strip = step(uStrip, p.y);
  col *= mix(1.0, 0.085, strip);
  col += C_ASH * 0.10 * pxLine(abs(p.y - uStrip), 0.3, 1.2);
  col += C_ASH * 0.05 * pxLine(abs(p.y - uStrip - 7.0), 0.3, 1.2);

  // 中央的透明處：煙燻玻璃圓窗（還看得到一點點後面的碎片），細線環與刻度
  if (uRL > 1.0) {
    float inside = 1.0 - smoothstep(uRL - 1.0, uRL + 1.0, r);
    col = mix(col, col * 0.07 + C_INK * 0.85, inside);
    float ring = aaStroke(r - uRL, 1.3) * 0.55 + aaStroke(r - uRL - 11.0, 0.9) * 0.22;
    float aa = atan(d.y, d.x) + uRing;
    float tk = abs(fract(aa / TAU * 72.0 + 0.5) - 0.5) * (TAU / 72.0) * r;
    float major = step(abs(fract(aa / TAU * 12.0 + 0.5) - 0.5), 0.02);
    float band = step(uRL + 13.0, r) * step(r, uRL + (major > 0.5 ? 30.0 : 21.0));
    col += C_BONE * (ring + 0.32 * pxLine(tk, 0.3, 1.1) * band);
  }
  fragColor = vec4(col * uIn, 1.0);
}`;

const BG = () => new FSPass(FRAG, {
  uO: { value: new THREE.Vector2(O.x, O.y) }, uPhi: { value: 0 }, uOff: { value: new THREE.Vector2() }, uRL: { value: 0 },
  uKick: { value: 0 }, uHat: { value: 0 }, uN: { value: 6 }, uIn: { value: 1 }, uStrip: { value: STRIP }, uT: { value: 0 },
  uSeed: { value: 0 }, uStyle: { value: 0 }, uRing: { value: 0 }, uRV: { value: 560 },
});

interface MsgLay { fit: FitResult; sig: string; sigSize: number; top: number; n: number; t0: number; dur: number }

export default class Kaleidoscope extends Scene {
  bg = shared('kaleidoscope.bg', BG);
  /** 圓窗裡的字（留言寫完後就不變：只有 key 變了才重畫、重新上傳）。 */
  win = this.track(new Layer2D(MSG_R.w, MSG_R.h, undefined, { fast: true }));
  /** 外框裡的歌詞（每格都變，但只有一條，上傳很小）。 */
  strip = this.track(new Layer2D(STRIP_R.w, STRIP_R.h, undefined, { fast: true }));
  /** 左上角的讀數（轉數一拍變一次）。 */
  info = this.track(new Layer2D(420, 100, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  variant = (this.ctx.params.variant ?? 0) % 2;
  seed = (this.ctx.params.seed ?? 7) % 97;
  lay: MsgLay | null = null;
  /** 圓窗的半徑（依內容決定：短留言小一點，碎片多露一點）。 */
  rl = 280;
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
      // 圓窗裡內接的框：寬 1.68R、高 1.1R（署名另外算）
      const R = RL_MAX;
      // 十個字以內的短句排成一行（「新婚快／樂！！！」這種從詞中間折斷的，字再大也不好看）
      const short = Array.from(this.msg.text).length <= 10;
      const fit = fitMsg(c, this.msg.text, FAM_MSG, R * 1.62, R * 1.02, { min: 44, max: 112, lineHeight: 1.36, maxLines: short ? 1 : 7 });
      const sigSize = Math.round(clamp(fit.size * 0.48, 40, 52));
      const blockH = fit.height + sigSize * 1.9;
      // 圓窗半徑：框的對角線再留一點邊（短留言的窗小一點，外面的碎片比較多）
      this.rl = clamp(Math.hypot(Math.max(fit.width, 300) / 2, blockH / 2) + 46, 230, R);
      const n = fit.lines.reduce((s, l) => s + Array.from(l).length, 0);
      const dur = clamp(0.06 * n + 0.5, 0.8, 2.6);
      this.lay = { fit, sig: signature(this.msg.name), sigSize, top: O.y - blockH / 2 + fit.size * 0.9, n, t0: this.tOpen + 0.12, dur };
    } else {
      this.rl = 300;
      this.inviteFit = fitText(c, INVITE.join(''), FAM_MSG, 440, 200, { min: 44, max: 60, lineHeight: 1.4, maxLines: 2 });
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
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
    // 圓窗：第一個拍點打開（outExpo），最後 0.3 秒收起來
    const open = ease.outExpo(prog(t, this.tOpen, this.tOpen + 0.55)) * (1 - ease.inCubic(prog(t, e - 0.32, e)));
    const rl = this.rl * open;
    u.uRL!.value = rl;
    u.uRing!.value = -u.uPhi!.value * 0.25;
    u.uIn!.value = prog(t, s, s + 0.2);
    this.bg.render(renderer, out);

    const textK = open;
    // ---- 圓窗裡的字
    const ly = lyricAt(lyrics, t);
    if (this.msg && this.lay) this.drawMsg(t, textK);
    else this.drawWinLyric(t, ly, textK);
    comp.draw(renderer, this.win.texture, out, subRect(MSG_R));
    // ---- 外框：歌詞（有留言時）或歌名＋邀請
    this.drawStrip(t, this.msg ? ly : null, prog(t, s, s + 0.35) * (1 - prog(t, e - 0.25, e)));
    comp.draw(renderer, this.strip.upload(), out, subRect(STRIP_R));
    this.drawInfo(f, prog(t, s, s + 0.4));
    comp.draw(renderer, this.info.texture, out, { ...subRect({ x: 124, y: 100, w: 420, h: 100 }), opacity: 1 - prog(t, e - 0.25, e) });

    const r = this.rl + 36;
    return {
      bloom: 0.62, vignette: 0.42, halation: 0.2,
      zoom: 1 + 0.012 * f.a.kick + 0.02 * f.p,
      popupAvoid: [[O.x - r, O.y - r, 2 * r, 2 * r], [LX - 20, STRIP - 10, LW + 40, 150]],
    };
  }

  /** 留言：第一個拍點後一個字一個字從煙燻玻璃裡浮出來（先是訊號色、很快冷成紙白），再寫署名與編號。 */
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
    c.globalAlpha = k;
    c.font = font(FAM_MSG, L.fit.size);
    c.textBaseline = 'alphabetic';
    let idx = 0;
    L.fit.lines.forEach((ln, i) => {
      const y = L.top + i * L.fit.lineHeight;
      const wFull = c.measureText(ln).width;
      const x0 = O.x - wFull / 2;
      const chars = Array.from(ln);
      let pre = '';
      for (const ch of chars) {
        const a = clamp(shown - idx);
        idx++;
        if (a > 0) {
          const x = x0 + c.measureText(pre).width;
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
      c.globalAlpha = k * sigK;
      c.font = font(FAM_MSG, L.sigSize);
      c.fillStyle = rgba('ash');
      const sy = L.top + (L.fit.lines.length - 1) * L.fit.lineHeight + L.sigSize * 1.75;
      const sw = c.measureText(L.sig).width;
      c.fillText(L.sig, O.x + Math.min(L.fit.width / 2, 260) - sw, sy);
    }
    c.restore();
    W2.upload();
  }

  /** 沒有留言：歌詞放大在圓窗裡（置中、逐字跟唱）；沒有歌詞時是邀請。 */
  private drawWinLyric(t: number, ly: ReturnType<typeof lyricAt>, k: number) {
    const W2 = this.win, c = W2.ctx;
    W2.clear();
    c.save();
    c.translate(-MSG_R.x, -MSG_R.y);
    c.globalAlpha = k;
    if (ly) {
      const st: LyricStyle = { family: FAM_LYRIC, size: 96, minSize: 50, maxWidth: this.rl * 1.62, align: 'center', lineHeight: 1.16 };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.25));
      c.translate(O.x, O.y + lay.size * 0.36 - (lay.height - lay.size) / 2 + (1 - inK) * 24);
      drawLyric(c, ly.line, t, st, lay, ly.k * k);
    } else if (this.inviteFit) {
      const fit = this.inviteFit;
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = rgba('bone', 0.92);
      const lines = fit.lines.length === 2 ? fit.lines : INVITE;
      lines.forEach((ln, i) => c.fillText(ln, O.x - c.measureText(ln).width / 2, O.y - 10 + (i - 0.5) * fit.lineHeight + fit.size * 0.35));
    }
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
      const st: LyricStyle = { family: FAM_LYRIC, size: 64, minSize: 48, maxWidth: LW };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      c.translate(LX, LBASE - (lay.height - lay.size) + (1 - inK) * 18);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      const { song } = this.ctx;
      c.font = font(F.mono(500), 18);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('ash', 0.85);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LX, 904);
      c.letterSpacing = '0px';
      // 冷面註腳（外框空著的時候才有位置放）
      c.font = font(F.hei(500), 26);
      c.fillStyle = rgba('bone', 0.55);
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
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('ash', 0.8);
    const mirrors = this.variant ? 8 : 12;
    const m = this.msg;
    // 三行疊在左上角（筒壁上，不壓到碎片）：像鏡筒上刻的規格
    c.fillText('KALEIDOSCOPE', 0, 22);
    c.fillText(`${mirrors} 面鏡 · 第 ${String(turn).padStart(3, '0')} 轉`, 0, 52);
    if (m) c.fillText(`NO.${String(m.n).padStart(3, '0')}${m.couple ? ' · 新人' : ''}`, 0, 82);
    c.letterSpacing = '0px';
    L.upload();
  }
}
