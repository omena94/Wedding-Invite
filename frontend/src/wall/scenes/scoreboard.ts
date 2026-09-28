// 記分板（暗）：球場的大記分板，從看台左邊一點的位置看過去（輕微的透視）。整塊板子是一面 LED：
// 內容先用 Canvas2D 畫在「板面座標」上，shader 再用單應矩陣把它貼到螢幕上、蓋上一顆一顆的燈珠（沒亮的燈珠也看得到），
// 所以字、數字、跑馬燈都有 LED 的顆粒，但字形還是完整的、讀得清楚。
//  - 上排：HOME 宣文（替補：芃芃）｜比賽時間（歌曲時間、第幾首、BPM、歡呼計）｜AWAY 孟庭（替補：QQ）。
//    比分從 13：13 開始（婚禮是 13 號），每兩小節一方在小節線「進球」（GOAL! 閃、數字捲動、鏡頭頓一下），
//    另一方兩拍後在小鼓上扳平——比分永遠平手，中間一行一本正經地寫「平手（預計永遠如此）」。
//  - 中間：本場最佳 MVP＝主打留言。第一拍標題反白閃，接著 LED 一個字一個字打出來（游標是訊號色），打完署名。
//    沒有留言：MVP 虛位以待＋邀請掃 QR。新人的留言標「新人致詞」。
//  - 下排：跑馬燈＝歌詞。新的一句從右邊推進來、停住逐字跟唱；太長的句子跟著唱到的字往左捲。
//    純音樂／句子之間：跑馬燈捲歌名與邀請。
//  - 鏡頭每兩小節在「全景」與「稍近、另一側」之間換一次（緩進小節線）；開場燈珠由上往下一列列亮起、結尾閃一下關掉。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, beatAfter, signature, fillWithHearts, WEDDING_DATE } from './_motifs';
import { stagger, homography, mapRect, bbox, pad3, type P2, type Rect } from './_t11';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.45, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 板面（邏輯像素，y 向下）
const BW = 1680, BH = 720;
/** 燈珠間距（板面 px）：再大中文就糊了，再小看不出是 LED。 */
const PITCH = 4.4;
const P_HOME: Rect = [24, 20, 552, 232];
const P_CLOCK: Rect = [600, 20, 480, 232];
const P_AWAY: Rect = [1104, 20, 552, 232];
const P_MVP: Rect = [24, 276, 1632, 318];
const P_LYR: Rect = [24, 612, 1632, 88];
/** 留言排在這裡（板面座標）。 */
const MSG_BOX = { x: 64, y: 350, w: 1552, h: 196 };
/** 跑馬燈的字：左邊留給「LIVE ♪」。 */
const LYR_X0 = 222, LYR_X1 = 1628, LYR_BASE = 676, LYR_SIZE = 58;
/** 七段數字的大小。 */
const DIG = { w: 86, h: 152, gap: 20, th: 17 };
const CLK = { w: 50, h: 92, gap: 12, th: 11 };

const FAM_MSG = F.ming(700);
const FAM_LYR = F.archivo(87.5, 800);
const FAM_TEAM = F.hei(900);
const [, , WED_DAY] = String(WEDDING_DATE).split('-').map(Number) as [number, number, number];

const TIE = '平手（預計永遠如此）';
const INVITE_BIG = 'MVP 虛位以待';
const INVITE_SMALL = '掃描右下角 QR code，把你的祝福送上記分板。';

/** 鏡頭：四邊形的中心、縮放、透視（k > 0 左邊比較近）。 */
interface Cam { cx: number; cy: number; s: number; k: number }
const WIDE: Cam = { cx: 960, cy: 462, s: 1, k: 1 };
const CLOSE: Cam = { cx: 960, cy: 456, s: 1.05, k: -0.8 };
function quad(c: Cam): P2[] {
  const hw = (BW / 2) * 0.99 * c.s, hh = (BH / 2) * 1.0 * c.s, kl = 1 + c.k * 0.018, kr = 1 - c.k * 0.018;
  return [{ x: c.cx - hw, y: c.cy - hh * kl }, { x: c.cx + hw, y: c.cy - hh * kr }, { x: c.cx + hw, y: c.cy + hh * kr }, { x: c.cx - hw, y: c.cy + hh * kl }];
}
const BOARD: P2[] = [{ x: 0, y: 0 }, { x: BW, y: 0 }, { x: BW, y: BH }, { x: 0, y: BH }];

const LED_FRAG = /* glsl */ `
uniform sampler2D content; uniform sampler2D hot;
uniform mat3 Hs;
uniform float power; uniform float flick; uniform float glowK; uniform float kick;
vec3 dec(vec4 c) { return c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0); }
void main() {
  vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 q = Hs * vec3(sp, 1.0);
  vec2 bp = q.xy / q.z;
  vec2 BS = vec2(${BW}.0, ${BH}.0);
  // 看台上方的夜：上面一點點亮（遠處的照明），往下暗
  vec3 col = C_INK * (0.72 + 0.4 * smoothstep(${H}.0, 0.0, sp.y)) + C_INK2 * 0.25 * fbm(sp / 520.0, 3);
  // 兩根支柱（板面座標往下延伸）
  for (int i = 0; i < 2; i++) {
    float px = i == 0 ? 330.0 : 1350.0;
    float d = abs(bp.x - px);
    if (bp.y > BS.y && d < 34.0) col = mix(C_INK2 * 1.15, C_GRAPHITE * 0.28, pxLine(abs(d - 30.0), 0.4, 1.4)) * (0.9 - 0.25 * smoothstep(BS.y, BS.y + 400.0, bp.y));
  }
  vec2 o = max(-bp, bp - BS);
  float out_ = max(o.x, o.y);
  if (out_ < 30.0) {
    // 外框：暗色金屬，外緣一條亮邊、內緣一條暗縫，每 140 px 一顆螺絲
    col = C_INK2 * 1.25 + C_GRAPHITE * 0.05;
    col += C_GRAPHITE * 0.3 * pxLine(abs(out_ - 28.5), 0.3, 1.2);
    col *= 1.0 - 0.6 * pxLine(abs(out_ - 2.0), 0.6, 2.0);
    vec2 bq = bp + 30.0;
    float along = abs(o.x) > abs(o.y) ? bq.y : bq.x;
    float bolt = length(vec2(mod(along, 140.0) - 70.0, out_ - 15.0));
    col += C_GRAPHITE * 0.35 * (1.0 - smoothstep(3.0, 4.2, bolt));
  }
  if (out_ <= 0.0) {
    vec2 g = bp / ${PITCH.toFixed(2)};
    vec2 f = g - floor(g) - 0.5;
    float r = length(f);
    float aa = max(fwidth(r), 1e-3);
    float dotm = 1.0 - smoothstep(0.34 - aa, 0.34 + aa, r);
    vec2 uv = vec2(bp.x / BS.x, 1.0 - bp.y / BS.y);
    vec3 cc = dec(texture(content, uv));
    vec3 hh = dec(texture(hot, uv));
    // 開機：燈珠由上往下一列一列亮起；關機前閃一下
    float on = step(bp.y, power * (BS.y + 20.0)) * flick;
    vec3 face = C_INK * 0.55 + C_INK2 * 0.2;
    col = face + mix(C_INK2, C_GRAPHITE, 0.2) * dotm * (0.55 + 0.25 * kick);
    col += cc * (0.32 + 0.72 * dotm) * on;
    col += hh * (0.35 + 1.35 * dotm) * glowK * on;
  }
  fragColor = vec4(col, 1.0);
}`;

const BG = () => new FSPass(LED_FRAG, {
  content: { value: null }, hot: { value: null }, Hs: { value: new THREE.Matrix3() },
  power: { value: 1 }, flick: { value: 1 }, glowK: { value: 1 }, kick: { value: 0 },
});

// ---------------------------------------------------------------- 七段數字
/** 每個數字亮哪幾段（a 上、b 右上、c 右下、d 下、e 左下、f 左上、g 中）。 */
const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
/** 畫一個七段數字（左上角 x, y；d = null 只畫沒亮的段）。字稍微往右斜，像計分板的數字。 */
function seg7(c: CanvasRenderingContext2D, x: number, y: number, s: { w: number; h: number; th: number }, d: number | null, on: string, off: string | null) {
  const { w, h, th } = s, g = th * 0.18, sk = 0.09;
  const lit = d === null ? '' : DIGITS[d]!;
  const X = (px: number, py: number) => x + px + (h / 2 - py) * sk;
  const hor = (yc: number, k: string) => {
    const x0 = g + th * 0.2, x1 = w - g - th * 0.2;
    return { k, pts: [[x0, yc], [x0 + th / 2, yc - th / 2], [x1 - th / 2, yc - th / 2], [x1, yc], [x1 - th / 2, yc + th / 2], [x0 + th / 2, yc + th / 2]] as [number, number][] };
  };
  const ver = (xc: number, y0: number, y1: number, k: string) => {
    const a = y0 + g, b = y1 - g;
    return { k, pts: [[xc, a], [xc + th / 2, a + th / 2], [xc + th / 2, b - th / 2], [xc, b], [xc - th / 2, b - th / 2], [xc - th / 2, a + th / 2]] as [number, number][] };
  };
  const segs = [
    hor(th / 2, 'a'), hor(h / 2, 'g'), hor(h - th / 2, 'd'),
    ver(w - th / 2, th / 2, h / 2, 'b'), ver(w - th / 2, h / 2, h - th / 2, 'c'),
    ver(th / 2, th / 2, h / 2, 'f'), ver(th / 2, h / 2, h - th / 2, 'e'),
  ];
  for (const sg of segs) {
    const isOn = lit.includes(sg.k);
    if (!isOn && !off) continue;
    c.fillStyle = isOn ? on : off!;
    c.beginPath();
    sg.pts.forEach(([px, py], i) => (i ? c.lineTo(X(px, py), y + py) : c.moveTo(X(px, py), y + py)));
    c.closePath();
    c.fill();
  }
}

interface Goal { team: 0 | 1; t: number }

export default class Scoreboard extends Scene {
  bg = shared('scoreboard.led', BG);
  /** 板面上的內容（整張，每格重畫）。 */
  board = this.track(new Layer2D(BW, BH, undefined, { fast: true }));
  /** 會發光的東西（比分、游標、正在唱的字），半解析度就夠。 */
  hot = this.track(new Layer2D(BW, BH, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 7) >>> 0;
  fit: FitResult | null = null;
  /** 留言每個字的位置與出現時間。 */
  chars: { ch: string; x: number; y: number; t: number }[] = [];
  sigT = Infinity;
  sig = '';
  head = '';
  tFirst = 0;
  goals: Goal[] = [];
  /** 鏡頭：每兩小節換一次的時間點。 */
  camSwitch: number[] = [];
  marquee = '';
  marqueeW = 0;
  avoid: Rect[] = [];
  hsWide: number[] = [];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.board.ctx;
    this.marquee = `♪ 現正播放　${song.title}${song.artist ? ' — ' + song.artist : ''}　✦　掃描右下角 QR code，把祝福送上記分板　✦　`;
    this.head = m?.couple ? '★ 新人致詞　FROM THE COUPLE' : '★ 本場最佳　MVP';
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${this.head}${this.marquee}${TIE}${INVITE_BIG}${INVITE_SMALL}宣文孟庭主場客場替補芃芃比賽時間第首歡呼領先`);

    // ---- 時間：第一拍標題閃、之後逐字打出留言（兩小節內、也不超過窗格的四成）
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.25, beat * 0.4));
    const text = m ? m.text : INVITE_SMALL;
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    if (m) {
      this.fit = fitText(c, m.text, FAM_MSG, MSG_BOX.w, MSG_BOX.h, { min: 44, max: 140, lineHeight: 1.3, maxLines: 3 });
    } else {
      this.fit = fitText(c, text, FAM_MSG, MSG_BOX.w, 70, { min: 44, max: 58, lineHeight: 1.3, maxLines: 1 });
    }
    const fit = this.fit;
    const n = fit.lines.reduce((k, l) => k + Array.from(l).length, 0);
    const times = stagger(au, this.tFirst + beat * (m ? 1 : 0.5), n, Math.min(2 * bar, 0.4 * (e - s)));
    // 留言在框裡垂直置中（沒有留言：大字「虛位以待」在上、邀請在下）
    const top = m ? MSG_BOX.y + (MSG_BOX.h - fit.height) / 2 + fit.size * 0.88 : MSG_BOX.y + 150;
    c.font = font(FAM_MSG, fit.size);
    let k = 0;
    fit.lines.forEach((ln, li) => {
      let x = MSG_BOX.x;
      for (const ch of Array.from(ln)) {
        this.chars.push({ ch, x, y: top + li * fit.lineHeight, t: times[k++]! });
        x += c.measureText(ch).width;
      }
    });
    this.sigT = (times[n - 1] ?? this.tFirst) + beat * 0.75;

    // ---- 進球：從第二個小節線起每兩小節一次，先進球的一方輪流；另一方兩拍後（小鼓）扳平。一定在窗格結束前扳平。
    let who: 0 | 1 = hash(this.seed, 3) < 0.5 ? 0 : 1;
    for (let b = Math.ceil(au.barAt(this.tFirst + beat * 0.5) - 1e-6) + 1; ; b += 2) {
      const tg = au.timeOfBar(b), te = au.timeOfBeat(au.beatAt(tg) + 2);
      if (te > e - 0.4) break;
      this.goals.push({ team: who, t: tg }, { team: (1 - who) as 0 | 1, t: te });
      who = (1 - who) as 0 | 1;
    }
    for (let b = Math.ceil(au.barAt(s + 0.3) - 1e-6) + 2; au.timeOfBar(b) < e - 0.8; b += 2) this.camSwitch.push(au.timeOfBar(b));

    c.font = font(FAM_LYR, 36);
    this.marqueeW = c.measureText(this.marquee).width;

    // ---- 即時小卡避開：MVP（留言）與跑馬燈（歌詞），兩種鏡頭都算進去
    const hw = homography(BOARD, quad(WIDE)), hc = homography(BOARD, quad(CLOSE));
    this.hsWide = hw;
    const mvp: Rect = [P_MVP[0], P_MVP[1] + 30, P_MVP[2], P_MVP[3] - 30];
    const a = bbox([mapRect(hw, mvp), mapRect(hc, mvp)], 8), l = bbox([mapRect(hw, P_LYR), mapRect(hc, P_LYR)], 8);
    this.avoid = [a, a, l];
    if (lyrics.linesIn(s, e).length) this.avoid.push(l);
  }

  /** 這一格的鏡頭（每兩小節在全景與近景之間換，0.55 秒緩進小節線）。 */
  private cam(t: number): Cam {
    let cur = WIDE, prev = WIDE, t0 = -Infinity;
    this.camSwitch.forEach((ts, i) => { if (t >= ts - 0.55) { prev = cur; cur = i % 2 === 0 ? CLOSE : WIDE; t0 = ts; } });
    if (t0 === -Infinity) return WIDE;
    const k = prog(t, t0 - 0.55, t0, ease.inOutCubic);
    return { cx: lerp(prev.cx, cur.cx, k), cy: lerp(prev.cy, cur.cy, k), s: lerp(prev.s, cur.s, k), k: lerp(prev.k, cur.k, k) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const c = this.board.ctx, hc = this.hot.ctx;
    this.board.clear(); this.hot.clear();

    // ---- 比分
    const score = [WED_DAY, WED_DAY];
    let lastGoal: Goal | null = null;
    for (const g of this.goals) if (t >= g.t) { score[g.team]!++; lastGoal = g; }
    const tied = score[0] === score[1];

    this.panels(c);
    this.team(c, hc, t, 0, score[0]!);
    this.team(c, hc, t, 1, score[1]!);
    this.clock(c, hc, t, f, tied, lastGoal);
    this.mvp(c, hc, t);
    this.ticker(c, hc, t);

    // ---- 投影到螢幕
    const cm = this.cam(t);
    const Hs = homography(quad(cm), BOARD);
    (this.bg.u.Hs!.value as THREE.Matrix3).set(Hs[0]!, Hs[1]!, Hs[2]!, Hs[3]!, Hs[4]!, Hs[5]!, Hs[6]!, Hs[7]!, Hs[8]!);
    this.bg.u.content!.value = this.board.upload();
    this.bg.u.hot!.value = this.hot.upload();
    this.bg.u.power!.value = prog(t, s, s + 0.32, ease.outCubic);
    // 關機：最後 0.3 秒閃兩下再黑掉
    const off = t > e - 0.3 ? (Math.floor((t - (e - 0.3)) / 0.075) % 2 === 0 ? 0.35 : 1) * (1 - prog(t, e - 0.08, e)) : 1;
    this.bg.u.flick!.value = off;
    this.bg.u.glowK!.value = 1.15 + 0.5 * f.a.kick;
    this.bg.u.kick!.value = f.a.kick;
    this.bg.render(renderer, out);

    const goalHit = lastGoal ? pulse(t, lastGoal.t, 0.12) : 0;
    return {
      bloom: 0.7, vignette: 0.45, grain: 0.05, halation: 0.3,
      zoom: 1 + 0.012 * goalHit + 0.004 * f.a.kick, flash: 0.02 * goalHit, popups: 0.95,
      popupAvoid: this.avoid,
    };
  }

  /** 各區的框線與標籤（燈珠拼出來的細框）。 */
  private panels(c: CanvasRenderingContext2D) {
    c.strokeStyle = rgba('graphite', 0.95);
    c.lineWidth = 3;
    for (const [x, y, w, h] of [P_HOME, P_CLOCK, P_AWAY, P_MVP, P_LYR]) c.strokeRect(x, y, w, h);
  }

  /** HOME／AWAY：隊名、替補、比分（進球時 GOAL! 閃一拍、數字往上捲）。 */
  private team(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, side: 0 | 1, sc: number) {
    const au = this.ctx.audio;
    const [px, py, pw] = side === 0 ? P_HOME : P_AWAY;
    const name = side === 0 ? '宣文' : '孟庭', sub = side === 0 ? '替補：芃芃' : '替補：QQ';
    const home = side === 0;
    // 進球：這一隊最近一次進球
    let tg = -Infinity;
    for (const g of this.goals) if (g.team === side && t >= g.t) tg = g.t;
    const beat = au.beatPeriod(t);
    const inGoal = t - tg < beat * 1.5;
    const blink = inGoal && Math.floor((t - tg) / (beat / 2)) % 2 === 0;
    // 標籤列
    const lx = home ? px + 30 : px + pw - 30;
    c.font = font(F.mono(600), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('ash', 0.95);
    c.textAlign = home ? 'left' : 'right';
    c.fillText(home ? 'HOME · 主場' : '客場 · AWAY', lx, py + 44);
    c.letterSpacing = '0px';
    // 隊名（進球時換成 GOAL!）
    if (inGoal) {
      c.font = font(F.archivo(75, 900), 80);
      c.fillStyle = blink ? rgba('signal') : rgba('bone', 0.9);
      c.fillText('GOAL!', lx, py + 158);
      if (blink) { hc.font = c.font; hc.textAlign = c.textAlign; hc.fillStyle = rgba('signal', 0.9); hc.fillText('GOAL!', lx, py + 158); }
    } else {
      c.font = font(FAM_TEAM, 90);
      c.fillStyle = rgba('bone');
      c.fillText(name, lx, py + 160);
    }
    c.font = font(F.hei(500), 24); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.9);
    c.fillText(sub, lx, py + 208);
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    // 比分：兩位數，靠近中間的時鐘
    const dx = home ? px + pw - 26 - (2 * DIG.w + DIG.gap) : px + 26;
    const dy = py + 42;
    const roll = prog(t, tg, tg + 0.16, ease.outCubic);
    const prevSc = t - tg < 0.16 ? sc - 1 : sc;
    const glow = 0.55 + 0.45 * pulse(t, tg, 0.35);
    for (let i = 0; i < 2; i++) {
      const x = dx + i * (DIG.w + DIG.gap);
      const dNow = i === 0 ? Math.floor(sc / 10) % 10 : sc % 10;
      const dOld = i === 0 ? Math.floor(prevSc / 10) % 10 : prevSc % 10;
      seg7(c, x, dy, DIG, null, '', rgba('graphite', 0.55));
      const draw = (cc: CanvasRenderingContext2D, col: string) => {
        if (dNow !== dOld && roll < 1) {
          cc.save(); cc.beginPath(); cc.rect(x - 20, dy - 4, DIG.w + 40, DIG.h + 8); cc.clip();
          seg7(cc, x, dy - DIG.h * roll * 1.1, DIG, dOld, col, null);
          seg7(cc, x, dy + DIG.h * (1 - roll) * 1.1, DIG, dNow, col, null);
          cc.restore();
        } else seg7(cc, x, dy, DIG, dNow, col, null);
      };
      draw(c, rgba('signal'));
      draw(hc, rgba('signal', glow));
    }
  }

  /** 中間：比賽時間（＝歌曲時間）、第幾首、BPM、兩條歡呼計、比分狀態。 */
  private clock(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, f: Frame, tied: boolean, last: Goal | null) {
    const { song } = this.ctx;
    const [px, py, pw] = P_CLOCK, cx = px + pw / 2;
    c.textAlign = 'center';
    c.font = font(F.hei(500), 22); c.letterSpacing = '6px'; c.fillStyle = rgba('ash', 0.95);
    c.fillText(`比賽時間　第 ${song.index} 首`, cx, py + 44);
    c.letterSpacing = '0px';
    // mm:ss
    const sec = Math.max(0, Math.floor(t)), mm = Math.floor(sec / 60) % 100, ss = sec % 60;
    const ds = [Math.floor(mm / 10), mm % 10, Math.floor(ss / 10), ss % 10];
    const total = 4 * CLK.w + 2 * CLK.gap + 34;
    let x = cx - total / 2;
    const y = py + 66;
    ds.forEach((d, i) => {
      seg7(c, x, y, CLK, null, '', rgba('graphite', 0.5));
      seg7(c, x, y, CLK, d, rgba('ember'), null);
      seg7(hc, x, y, CLK, d, rgba('signal', 0.45), null);
      x += CLK.w + CLK.gap;
      if (i === 1) {
        // 冒號：一拍閃一次
        const on = f.beatPhase < 0.5;
        c.fillStyle = on ? rgba('ember') : rgba('graphite', 0.5);
        c.fillRect(x + 1, y + CLK.h * 0.3, 10, 10); c.fillRect(x + 1, y + CLK.h * 0.66, 10, 10);
        x += 34 - CLK.gap;
      }
    });
    // 狀態：平手（預計永遠如此）／某某 領先
    c.font = font(F.hei(700), 26); c.letterSpacing = '2px';
    const lead = !tied && last ? `${last.team === 0 ? '宣文' : '孟庭'} 領先（暫時）` : TIE;
    c.fillStyle = tied ? rgba('bone', 0.92) : rgba('signal');
    c.fillText(lead, cx, py + 212);
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    // 兩條歡呼計（左右各一，十格燈，跟著音量與大鼓跳）
    const lvl = clamp(f.a.rms * 1.15 + f.a.kick * 0.35);
    for (const side of [0, 1]) {
      const mx = side === 0 ? px + 22 : px + pw - 22 - 18;
      const n = Math.round(lvl * 10 * (side === 0 ? 1 : 0.94 + 0.06 * f.a.snare));
      for (let i = 0; i < 10; i++) {
        const yy = py + 206 - i * 16;
        const onI = i < n;
        c.fillStyle = onI ? (i >= 8 ? rgba('signal') : rgba('bone', 0.85)) : rgba('graphite', 0.45);
        c.fillRect(mx, yy, 18, 10);
        if (onI && i >= 8) { hc.fillStyle = rgba('signal', 0.7); hc.fillRect(mx, yy, 18, 10); }
      }
    }
  }

  /** MVP：標題（第一拍反白閃）、留言逐字打出來（訊號色游標）、署名。 */
  private mvp(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, m = this.msg, fit = this.fit!;
    const [px, py, pw] = P_MVP;
    const beat = au.beatPeriod(t);
    // 標題：第一拍起反白（訊號色底、底色字）閃一拍，之後正常
    const blinking = t >= this.tFirst && t < this.tFirst + beat;
    const inv = blinking && Math.floor((t - this.tFirst) / (beat / 4)) % 2 === 0;
    c.font = font(F.hei(900), 30); c.letterSpacing = '4px';
    const hw = c.measureText(this.head).width;
    if (inv) {
      c.fillStyle = rgba('signal'); c.fillRect(px + 30, py + 14, hw + 28, 46);
      hc.fillStyle = rgba('signal', 0.6); hc.fillRect(px + 30, py + 14, hw + 28, 46);
      c.fillStyle = rgba('ink');
    } else c.fillStyle = rgba('signal');
    c.fillText(this.head, px + 44, py + 48);
    c.letterSpacing = '0px';
    if (m) {
      c.font = font(F.mono(600), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('ash', 0.9); c.textAlign = 'right';
      c.fillText(`No.${pad3(m.n)}`, px + pw - 36, py + 46);
      c.textAlign = 'left'; c.letterSpacing = '0px';
    }
    // 留言（或邀請）逐字出現；剛出現的字先是訊號色，0.3 秒內變紙白
    c.font = hc.font = font(FAM_MSG, fit.size);
    let cursor: { x: number; y: number } | null = null;
    for (let i = 0; i < this.chars.length; i++) {
      const g = this.chars[i]!;
      if (t < g.t) { cursor = { x: g.x, y: g.y }; break; }
      const heat = 1 - clamp((t - g.t) / 0.3);
      const base = g.ch === '♥' ? 'rose' : 'bone';
      c.fillStyle = heat > 0 ? mixRgba(base, 'signal', heat) : rgba(base);
      c.fillText(g.ch, g.x, g.y);
    }
    // 游標：打字時一直亮著（LED 的方塊游標）
    if (cursor && t >= this.tFirst) {
      c.fillStyle = rgba('signal'); c.fillRect(cursor.x + 2, cursor.y - fit.size * 0.82, fit.size * 0.5, fit.size * 0.92);
      hc.fillStyle = rgba('signal', 0.8); hc.fillRect(cursor.x + 2, cursor.y - fit.size * 0.82, fit.size * 0.5, fit.size * 0.92);
    }
    if (!m) {
      // 沒有留言：大字「MVP 虛位以待」在上
      const k = prog(t, this.tFirst, this.tFirst + 0.05);
      c.globalAlpha = k;
      c.font = font(F.ming(900), 92); c.fillStyle = rgba('bone');
      c.fillText(INVITE_BIG, MSG_BOX.x, MSG_BOX.y + 78);
      c.globalAlpha = 1;
    }
    // 署名：打完半拍後，靠右
    if (m && t >= this.sigT) {
      c.font = font(F.ming(400), 36); c.fillStyle = rgba('ash'); c.textAlign = 'right';
      fillWithHearts(c, this.sig, px + pw - 40, py + 296);
      c.textAlign = 'left';
    }
  }

  /** 跑馬燈：歌詞（推進來、停住、逐字跟唱；太長就跟著唱到的字捲），沒有歌詞時捲歌名與邀請。 */
  private ticker(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    const [px, py, pw, ph] = P_LYR;
    // LIVE 標籤（紅點一拍閃一次）
    c.font = font(F.mono(600), 20); c.letterSpacing = '4px'; c.fillStyle = rgba('signal');
    c.fillText('LIVE ♪', px + 34, py + 54);
    c.letterSpacing = '0px';
    c.save();
    c.beginPath(); c.rect(LYR_X0 - 12, py + 4, LYR_X1 - LYR_X0 + 24, ph - 8); c.clip();
    hc.save(); hc.beginPath(); hc.rect(LYR_X0 - 12, py + 4, LYR_X1 - LYR_X0 + 24, ph - 8); hc.clip();
    const ly = lyricAt(lyrics, t);
    const mk = ly ? 1 - ly.k : 1;
    if (mk > 0.01) {
      // 捲動的歌名：一秒 150 px，穩定地捲（跑馬燈本來就是這樣）
      c.globalAlpha = mk * 0.8;
      c.font = font(FAM_LYR, 36); c.fillStyle = rgba('ash');
      const step = this.marqueeW;
      const x0 = LYR_X1 - ((t - this.ctx.start) * 150) % step;
      for (let x = x0 - step; x < LYR_X1 + 10; x += step) c.fillText(this.marquee, x, LYR_BASE - 8);
      c.globalAlpha = 1;
    }
    if (ly) {
      const st = { family: FAM_LYR, size: LYR_SIZE, minSize: LYR_SIZE, maxWidth: 1e5 };
      const lay = layoutLyric(c, ly.line, st);
      const width = lay.rows[0]?.width ?? 0;
      const room = LYR_X1 - LYR_X0;
      // 推進來：提早 0.35 秒從右邊推到定位（outExpo）；唱完往左推出去
      const inK = ease.outExpo(prog(t, ly.line.start - 0.4, ly.line.start - 0.02));
      const outK = ease.inCubic(clamp(1 - ly.k)) * (t > ly.line.end ? 1 : 0);
      // 太長：唱到的字保持在畫面左邊六成的地方
      let scroll = 0;
      if (width > room) {
        const cp = Lyrics.lineCharProgress(ly.line, t);
        let hx = 0;
        for (const pw2 of lay.words) if (pw2.word.o <= cp) hx = pw2.x + pw2.w * clamp(cp - pw2.word.o, 0, pw2.word.w.length) / Math.max(1, pw2.word.w.length);
        scroll = clamp(hx - room * 0.6, 0, width - room);
      }
      const ox = LYR_X0 + (1 - inK) * room * 0.9 - outK * room * 0.6 - scroll;
      c.font = hc.font = font(FAM_LYR, lay.size);
      for (const w of lay.words) {
        const p = Lyrics.wordProgress(w.word, t);
        const x = ox + w.x;
        if (x > LYR_X1 + 20 || x + w.w < LYR_X0 - 20) continue;
        c.fillStyle = rgba('bone', 0.3);
        if (p < 1) c.fillText(w.word.w, x, LYR_BASE);
        if (p <= 0) continue;
        c.save(); c.beginPath(); c.rect(x - 4, py, (w.w + 8) * p, ph); c.clip();
        c.fillStyle = p < 1 ? rgba('signal') : rgba('bone');
        c.fillText(w.word.w, x, LYR_BASE);
        c.restore();
        if (p < 1) { hc.fillStyle = rgba('signal', 0.75); hc.fillText(w.word.w, x, LYR_BASE); }
      }
    }
    c.restore(); hc.restore();
  }
}
