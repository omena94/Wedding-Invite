// 記分板（暗）：夜裡球場的大記分板，從看台左下方仰望（真的 3D 透視），鏡頭整個窗格慢慢往前推。
// 整塊板子是一面 LED：內容先用 Canvas2D 畫在「板面座標」上，shader 再用單應矩陣把它貼到螢幕上、蓋上一顆一顆的燈珠
// （沒亮的燈珠也看得到），所以字有 LED 的顆粒，但字形完整、讀得清楚。板子外面是夜空、遠處照明燈的散景、前景看台的剪影。
// MV 版（一個畫面只有一個焦點）：板子上只有三樣東西——
//  - 中間最大：主打留言（本場最佳）。第一拍起 LED 一個字一個字打出來（訊號色游標），打完署名。新人的留言標「新人致詞」。
//    沒有留言：中間改成歌詞（大字逐字跟唱），下排慢慢捲一行邀請。韓文歌有中文翻譯時：中文下面小一號打原文
//    （原文自己的逐字時間，唱到、唱完都是白色、淡一點、不發光），兩行一起在主畫面裡置中。
//  - 上排小小的比分：{新郎} 20：20 {新娘}（從婚禮那天是幾號開始算；還沒定日期就從 0：0 開始）。
//    每兩小節一方在小節線進球（名字變 GOAL! 閃一拍、數字往上捲），
//    另一方兩拍後在小鼓上扳平——比分永遠平手，底下一行小字「平手（預計永遠如此）」。
//  - 下排：歌詞跑馬燈（比留言小一級）。新的一句從右邊推進來、停住逐字跟唱；太長的句子跟著唱到的字捲。
//  開場燈珠由上往下一列列亮起、結尾閃兩下關掉。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, beatAfter, signature, fillWithHearts, DATE, NAME_A, NAME_B, fitPx, lyricSubOf, drawLyricSub, subStyleFor, subGap, type LyricLayout, type LyricStyle } from './_motifs';
import { stagger, homography, type P2 } from './_t11';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.45, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 板面（邏輯像素，y 向下）
const BW = 1680, BH = 760;
/** 燈珠間距（板面 px）：再大中文就糊了，再小看不出是 LED。 */
const PITCH = 4.4;
/** 主畫面（留言；沒有留言時是歌詞）。 */
const MAIN = { x: 90, y: 190, w: 1500, h: 414, cx: 840 };
/** 下排跑馬燈（歌詞）。 */
/** 字級 56：板子投影到螢幕上約縮成九成，看到的還是 ≥ 48 px。 */
const STRIP = { x0: 70, x1: 1610, base: 712, y0: 614, y1: 748 };
/**
 * v2：鏡頭拉遠，板子在畫面左邊（螢幕上約 900 × 410，≈ 畫面 18%），右邊是照明塔、光束、看台——場景是主角。
 * 板子中心、鏡頭距離（窗格開始 → 結束，慢慢推近）。
 */
const CAM = { cx: 680, cy: 396, z0: 2980, z1: 2780 };
/** 比分的七段數字。 */
const DIG = { w: 48, h: 82, th: 10 };
const FAM_MSG = F.ming(700);
const FAM_LYR = F.archivo(87.5, 800);
/** 比分從婚禮那天是幾號開始（還沒定日期就從 0 開始）。 */
const WED_DAY = DATE?.d ?? 0;
/** 比分兩邊的名字（左新郎、右新娘）。 */
const SIDES = [NAME_A, NAME_B] as const;
const TIE = '平手（預計永遠如此）';
const INVITE = '掃描右下角 QR code，把你的祝福送上記分板';

/** 鏡頭：板子在 3D 裡（Z 距離、左右轉 yaw、仰角 pitch），投影出四個角。 */
const FOCAL = 1400;
function quad(Z: number, yaw: number, pitch: number, cx: number, cy: number): P2[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx! * BW) / 2, y = (sy! * BH) / 2;
    // 右邊比較遠（觀眾在左邊）、下緣比較近（仰望）
    const z = Z + x * Math.sin(yaw) - y * Math.sin(pitch);
    return { x: cx + (FOCAL * x * Math.cos(yaw)) / z, y: cy + (FOCAL * y * Math.cos(pitch)) / z };
  });
}
const BOARD: P2[] = [{ x: 0, y: 0 }, { x: BW, y: 0 }, { x: BW, y: BH }, { x: 0, y: BH }];

const LED_FRAG = /* glsl */ `
uniform sampler2D content; uniform sampler2D hot;
uniform mat3 Hs;
uniform float power; uniform float flick; uniform float glowK; uniform float kick; uniform float k;
uniform vec3 beams; uniform float beatPh; uniform float hat; uniform float t;
vec3 dec(vec4 c) { return c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0); }
// 遠處照明燈的散景：幾顆很淡、很軟的圓
vec3 bokeh(vec2 sp) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 c = i < 5 ? vec2(150.0 + 70.0 * fi + 30.0 * hash11(fi), 60.0 + 40.0 * hash11(fi + 3.0))
                   : vec2(1500.0 + 80.0 * (fi - 5.0) + 30.0 * hash11(fi), 40.0 + 50.0 * hash11(fi + 7.0));
    float r = 22.0 + 26.0 * hash11(fi + 11.0);
    float d = length(sp - c);
    acc += mix(C_BONE, C_SIGNAL, 0.5 + 0.3 * hash11(fi + 5.0)) * (1.0 - smoothstep(r * 0.55, r, d)) * (0.01 + 0.014 * hash11(fi + 13.0));
  }
  return acc;
}
void main() {
  vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 q = Hs * vec3(sp, 1.0);
  vec2 bp = q.xy / q.z;
  vec2 BS = vec2(${BW}.0, ${BH}.0);
  // 夜空：上面被球場照明打亮一點點（霧），往下暗；遠處幾顆燈的散景
  float yy = sp.y / ${H}.0;
  vec3 col = mix(C_INK2 * 1.25 + C_SIGNAL * 0.004, C_INK * 0.85, smoothstep(0.0, 0.8, yy)) + bokeh(sp) * k;
  // 右下角 HUD（QR、留言數）那一塊的背景要乾淨：光束、霧都不進去
  float hud = smoothstep(0.0, 160.0, max(1320.0 - sp.x, 790.0 - sp.y));
  // 照明塔（右邊）：細桅杆、上面一排排燈；三道光束從燈組斜斜打下來、穿過飄動的霧，每個小節線換一次角度
  vec2 L0 = vec2(1590.0, 128.0);
  float haze = 0.55 + 0.45 * fbm(sp / 260.0 + vec2(t * 0.05, -t * 0.02), 3);
  for (int i = 0; i < 3; i++) {
    float a = i == 0 ? beams.x : i == 1 ? beams.y : beams.z;
    vec2 dir = vec2(cos(a), sin(a)), rel = sp - L0;
    float along = dot(rel, dir), across = abs(dot(rel, vec2(-dir.y, dir.x)));
    float wdt = 18.0 + along * 0.16;
    float cone = exp(-pow(across / wdt, 2.0)) * smoothstep(0.0, 80.0, along) * exp(-along / 1100.0);
    col += mix(C_BONE, C_EMBER, 0.35) * cone * haze * (0.05 + 0.05 * kick) * hud * k;
  }
  float mast = pxLine(abs(sp.x - 1590.0), 2.0, 3.2) * step(170.0, sp.y) * step(sp.y, 780.0);
  col = mix(col, C_INK2 * 1.3, mast * k);
  vec2 lq = (sp - vec2(1488.0, 92.0)) / vec2(20.0, 18.0);
  if (lq.x >= 0.0 && lq.x < 10.0 && lq.y >= 0.0 && lq.y < 4.0) {
    float dd = length(fract(lq) - 0.5);
    col += mix(C_EMBER, vec3(1.0), 0.5) * (1.0 - smoothstep(0.22, 0.4, dd)) * (1.3 + 0.9 * kick) * k;
  }
  col += C_EMBER * 0.10 * exp(-length((sp - vec2(1590.0, 128.0)) / vec2(170.0, 90.0))) * (1.0 + kick) * k;
  // 兩根支柱（板面座標往下延伸）
  for (int i = 0; i < 2; i++) {
    float px = i == 0 ? 330.0 : 1350.0;
    float d = abs(bp.x - px);
    if (bp.y > BS.y && d < 34.0) col = mix(C_INK2 * 1.1, C_GRAPHITE * 0.22, pxLine(abs(d - 30.0), 0.4, 1.4));
  }
  vec2 o = max(-bp, bp - BS);
  float out_ = max(o.x, o.y);
  if (out_ < 30.0) {
    // 外框：暗色金屬，外緣一條亮邊（打到一點照明）、內緣一條暗縫
    col = C_INK2 * 1.2;
    col += C_GRAPHITE * 0.22 * pxLine(abs(out_ - 28.5), 0.3, 1.2) * (0.6 + 0.4 * (1.0 - yy));
    col *= 1.0 - 0.6 * pxLine(abs(out_ - 2.0), 0.6, 2.0);
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
    col = C_INK * 0.5 + mix(C_INK2, C_GRAPHITE, 0.14) * dotm * (0.4 + 0.2 * kick);
    col += cc * (0.32 + 0.72 * dotm) * on;
    col += hh * (0.3 + 1.1 * dotm) * glowK * on;
  }
  // 前景：看台上的觀眾剪影（一排頭，拍點上跳一下），手機的小燈跟著拍子左右晃；右下角 HUD 底下不放
  float left = 1.0 - smoothstep(1180.0, 1320.0, sp.x);
  float cell = floor(sp.x / 38.0), hop = step(0.5, hash11(cell + 3.0)) * kick * 10.0;
  float head = ${H}.0 - 120.0 - 16.0 * hash11(cell) - hop + 12.0 * pow(abs(fract(sp.x / 38.0) - 0.5) * 2.0, 2.0);
  float crowd = smoothstep(head - 2.0, head + 2.0, sp.y);
  col = mix(col, C_INK * 0.3, crowd * left * 0.96 * k);
  vec2 pc = floor(sp / vec2(38.0, 60.0));
  float sway = 7.0 * sin(TAU * beatPh + hash12(pc) * 6.0);
  vec2 pp = vec2(pc.x * 38.0 + 19.0 + sway, ${H}.0 - 150.0 - 18.0 * hash12(pc + 2.0));
  float ph_ = (1.0 - smoothstep(1.5, 3.2, length(sp - pp))) * step(0.72, hash12(pc + 5.0)) * step(${H}.0 - 190.0, sp.y) * step(sp.y, ${H}.0 - 120.0);
  col += mix(C_BONE, C_EMBER, 0.3) * ph_ * (0.8 + 0.8 * hat) * left * k;
  fragColor = vec4(col, 1.0);
}`;

const BG = () => new FSPass(LED_FRAG, {
  content: { value: null }, hot: { value: null }, Hs: { value: new THREE.Matrix3() },
  power: { value: 1 }, flick: { value: 1 }, glowK: { value: 1 }, kick: { value: 0 }, k: { value: 1 },
  beams: { value: new THREE.Vector3() }, beatPh: { value: 0 }, hat: { value: 0 }, t: { value: 0 },
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
  sigT = Infinity; sigY = 0;
  sig = '';
  head = '';
  tFirst = 0;
  goals: Goal[] = [];
  marquee = '';
  marqueeW = 0;
  lyricsInWindow = false;
  /** 板子在螢幕上的縮放（板面 px → 螢幕 px），v2 的字級要除以它。 */
  sB = 0.54;
  sigBoard = 56;
  lyrBoard = 84;
  /** 進球的彩帶（LineBatch）。 */
  paperBits = this.track(new LineBatch(512, { screen2D: true, blend: 'normal' }));

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.board.ctx;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    // 下排捲動的小字：有留言沒歌詞時捲歌名；沒有留言時捲邀請
    this.marquee = m ? `♪ ${song.title}${song.artist ? ' — ' + song.artist : ''}　　　` : `${INVITE}　　　`;
    this.head = m?.couple ? '新人致詞' : '本場最佳';
    this.sig = m ? (m.couple ? '—— 新人' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${this.head}${this.marquee}${TIE}${INVITE}${song.title}領先暫時`);

    // ---- 時間：第一拍起逐字打出留言（兩小節內、也不超過窗格的四成）
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.25, beat * 0.4));
    // 板子在螢幕上的縮放（用窗格中間的鏡頭算，上下兩條邊平均）
    const q0 = quad((CAM.z0 + CAM.z1) / 2, 0.145, 0.085, CAM.cx, CAM.cy);
    this.sB = (Math.hypot(q0[1]!.x - q0[0]!.x, q0[1]!.y - q0[0]!.y) + Math.hypot(q0[2]!.x - q0[3]!.x, q0[2]!.y - q0[3]!.y)) / (2 * BW);
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    if (m) {
      // v2：字級是「螢幕上的 px」，板面上的字要除以板子在螢幕上的縮放（sB）。
      // 可用高度扣掉上面的「本場最佳」一行與下面的署名：三樣東西永遠不重疊
      const sB = this.sB, sig = sigV2(msgMaxFor(m.text)) / sB;
      const o = { min: V2.msgMin / sB, max: msgMaxFor(m.text) / sB, lineHeight: 1.26, maxLines: 4 };
      const hAvail = MAIN.h - 40 - sig * 1.6;
      const fit = this.fit = fitClauses(c, m.text, FAM_MSG, MAIN.w, hAvail, o) ?? fitText(c, m.text, FAM_MSG, MAIN.w, hAvail, o);
      this.sigBoard = sigV2(fit.size * sB) / sB;
      const n = fit.lines.reduce((k, l) => k + Array.from(l).length, 0);
      const times = stagger(au, this.tFirst + beat * 0.5, n, Math.min(2 * bar, 0.4 * (e - s)));
      const top = MAIN.y + 40 + (hAvail - fit.height) / 2 + fit.size * 0.88;
      c.font = font(FAM_MSG, fit.size);
      let k = 0;
      fit.lines.forEach((ln, li) => {
        let x = MAIN.cx - c.measureText(ln).width / 2;
        for (const ch of Array.from(ln)) {
          this.chars.push({ ch, x, y: top + li * fit.lineHeight, t: times[k++]! });
          x += c.measureText(ch).width;
        }
      });
      this.sigT = (times[n - 1] ?? this.tFirst) + beat * 0.75;
      this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.28 + this.sigBoard + 8;
      this.lyrBoard = lyricV2(fit.size * sB) / sB;
    }

    // ---- 進球：從第二個小節線起每兩小節一次，先進球的一方輪流；另一方兩拍後（小鼓）扳平。一定在窗格結束前扳平。
    let who: 0 | 1 = hash(this.seed, 3) < 0.5 ? 0 : 1;
    for (let b = Math.ceil(au.barAt(this.tFirst + beat * 0.5) - 1e-6) + 1; ; b += 2) {
      const tg = au.timeOfBar(b), te = au.timeOfBeat(au.beatAt(tg) + 2);
      if (te > e - 0.4) break;
      this.goals.push({ team: who, t: tg }, { team: (1 - who) as 0 | 1, t: te });
      who = (1 - who) as 0 | 1;
    }
    c.font = font(FAM_LYR, 34);
    this.marqueeW = c.measureText(this.marquee).width;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const c = this.board.ctx, hc = this.hot.ctx;
    this.board.clear(); this.hot.clear();

    // ---- 比分
    const score = [WED_DAY, WED_DAY];
    let lastGoal: Goal | null = null;
    for (const g of this.goals) if (t >= g.t) { score[g.team]!++; lastGoal = g; }
    this.scoreRow(c, hc, t, score, lastGoal);
    if (this.msg) this.message(c, hc, t);
    else this.bigLyric(c, hc, t);
    this.strip(c, hc, t);

    // ---- 鏡頭：整個窗格慢慢往前推、轉正一點（inOutSine），板子的四個角投影到螢幕上
    const u = (1 - Math.cos(Math.PI * clamp((t - s) / Math.max(1, e - s)))) / 2;
    const qd = quad(lerp(CAM.z0, CAM.z1, u), lerp(0.17, 0.12, u), 0.085, CAM.cx, CAM.cy);
    const Hs = homography(qd, BOARD);
    // 照明塔的光束：每個小節線換一個角度（0.6 秒 inOutCubic），拍子之間慢慢掃
    const bf = au.barAt(t), bi = Math.floor(bf + 1e-4), bu = ease.inOutCubic(clamp((t - au.timeOfBar(bi)) / 0.6));
    const ang = (b: number, i: number) => 2.05 + 0.5 * i + 0.28 * (hash(this.seed, b, i) - 0.5);
    (this.bg.u.beams!.value as THREE.Vector3).set(...([0, 1, 2].map((i) => lerp(ang(bi - 1, i), ang(bi, i), bu) + 0.04 * Math.sin(t * 0.7 + i))) as [number, number, number]);
    this.bg.u.beatPh!.value = au.beatAt(t) % 1; this.bg.u.hat!.value = f.a.hat; this.bg.u.t!.value = t;
    (this.bg.u.Hs!.value as THREE.Matrix3).set(Hs[0]!, Hs[1]!, Hs[2]!, Hs[3]!, Hs[4]!, Hs[5]!, Hs[6]!, Hs[7]!, Hs[8]!);
    this.bg.u.content!.value = this.board.upload();
    this.bg.u.hot!.value = this.hot.upload();
    this.bg.u.power!.value = prog(t, s, s + 0.32, ease.outCubic);
    // 關機：最後 0.3 秒閃兩下再黑掉
    const off = t > e - 0.3 ? (Math.floor((t - (e - 0.3)) / 0.075) % 2 === 0 ? 0.35 : 1) * (1 - prog(t, e - 0.08, e)) : 1;
    this.bg.u.flick!.value = off;
    this.bg.u.glowK!.value = 1 + 0.35 * f.a.kick;
    this.bg.u.kick!.value = f.a.kick;
    this.bg.u.k!.value = prog(t, s, s + 0.4);
    this.bg.render(renderer, out);
    this.confetti(t, qd, out);

    const goalHit = lastGoal ? pulse(t, lastGoal.t, 0.12) : 0;
    return { bloom: 0.6, vignette: 0.5, grain: 0.05, halation: 0.25, zoom: 1 + 0.006 * goalHit + 0.002 * f.a.kick, flash: 0.012 * goalHit };
  }

  /**
   * 進球的彩帶：每一次進球從板子上緣（進球那一隊那一半）噴出一把細紙條（訊號色、紙白），翻著轉著飄下來（2.4 秒）。
   * q 是板子四個角在螢幕上的位置；種子決定每一片的路線。
   */
  private confetti(t: number, q: P2[], out: THREE.WebGLRenderTarget) {
    const lb = this.paperBits; lb.clear();
    const top = (u: number) => ({ x: lerp(q[0]!.x, q[1]!.x, u), y: lerp(q[0]!.y, q[1]!.y, u) });
    // 落到板子前面的那一段不畫（當作飄到板子後面）：彩帶只在板子上方與兩側，不會蓋到留言
    const x0 = Math.min(q[0]!.x, q[3]!.x) - 6, x1 = Math.max(q[1]!.x, q[2]!.x) + 6, y0 = Math.min(q[0]!.y, q[1]!.y) + 4, y1 = Math.max(q[2]!.y, q[3]!.y);
    for (const g of this.goals) {
      const age = t - g.t;
      if (age < 0 || age > 2.4) continue;
      for (let i = 0; i < 70; i++) {
        const h1 = hash(this.seed, g.t, i), h2 = hash(i, g.t, 7), h3 = hash(g.t, i, 11);
        const o = top(g.team === 0 ? 0.15 + 0.35 * h1 : 0.5 + 0.35 * h1);
        const vx = (h2 - 0.5) * 420, vy = -260 - 260 * h3;
        const x = o.x + vx * age + 30 * Math.sin(age * 5 + i), y = o.y + vy * age + 380 * age * age;
        const rot = age * (6 + 8 * h2) + i, len = 7 + 5 * h3, fl = Math.abs(Math.cos(age * 9 + i));
        if (x > x0 && x < x1 && y > y0 && y < y1) continue;
        const col = i % 3 === 0 ? LIN.bone : LIN.signal, a = (1 - clamp((age - 1.6) / 0.8)) * 0.9;
        lb.seg2(x - Math.cos(rot) * len, y - Math.sin(rot) * len * fl, x + Math.cos(rot) * len, y + Math.sin(rot) * len * fl, 3, [col[0] * 1.1, col[1] * 1.1, col[2] * 1.1], a);
      }
    }
    if (lb.count) lb.render(this.ctx.renderer, out);
  }

  /** 上排小小的比分：{新郎} 20：20 {新娘}；進球的一方名字變 GOAL! 閃一拍、數字往上捲。底下一行小字。 */
  private scoreRow(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, score: number[], last: Goal | null) {
    const au = this.ctx.audio, beat = au.beatPeriod(t);
    const cx = MAIN.cx, y = 26;
    const pairW = 2 * DIG.w + 12;
    // 兩組數字夾著冒號，名字在外側
    const xs = [cx - 44 - pairW, cx + 44];
    for (const side of [0, 1] as const) {
      let tg = -Infinity;
      for (const g of this.goals) if (g.team === side && t >= g.t) tg = g.t;
      const sc = score[side]!, roll = prog(t, tg, tg + 0.16, ease.outCubic), prev = t - tg < 0.16 ? sc - 1 : sc;
      for (let i = 0; i < 2; i++) {
        const x = xs[side]! + i * (DIG.w + 12);
        const dNow = i === 0 ? Math.floor(sc / 10) % 10 : sc % 10, dOld = i === 0 ? Math.floor(prev / 10) % 10 : prev % 10;
        seg7(c, x, y, DIG, null, '', rgba('graphite', 0.4));
        const draw = (cc: CanvasRenderingContext2D, col: string) => {
          if (dNow !== dOld && roll < 1) {
            cc.save(); cc.beginPath(); cc.rect(x - 14, y - 3, DIG.w + 28, DIG.h + 6); cc.clip();
            seg7(cc, x, y - DIG.h * roll * 1.1, DIG, dOld, col, null);
            seg7(cc, x, y + DIG.h * (1 - roll) * 1.1, DIG, dNow, col, null);
            cc.restore();
          } else seg7(cc, x, y, DIG, dNow, col, null);
        };
        draw(c, rgba('signal', 0.9));
        draw(hc, rgba('signal', 0.25 + 0.5 * pulse(t, tg, 0.3)));
      }
      // 名字（進球的那一拍換成 GOAL! 閃）
      const inGoal = t - tg < beat * 1.25, blink = inGoal && Math.floor((t - tg) / (beat / 2)) % 2 === 0;
      c.textAlign = side === 0 ? 'right' : 'left';
      const nx = side === 0 ? xs[0]! - 30 : xs[1]! + pairW + 30;
      if (inGoal) {
        c.font = font(F.archivo(75, 900), 56); c.fillStyle = blink ? rgba('signal') : rgba('bone', 0.75);
        c.fillText('GOAL!', nx, y + 70);
      } else {
        // 名字長短不一：照數字外側到板子邊的寬度縮字
        c.font = font(F.hei(900), fitPx(SIDES[side], F.hei(900), 56, 540)); c.fillStyle = rgba('bone', 0.78);
        c.fillText(SIDES[side], nx, y + 68);
      }
    }
    // 冒號（一拍閃一次）
    c.fillStyle = this.ctx.audio.beatAt(t) % 1 < 0.5 ? rgba('signal', 0.85) : rgba('graphite', 0.5);
    c.fillRect(cx - 6, y + 22, 12, 12); c.fillRect(cx - 6, y + 52, 12, 12);
    // 底下一行小字：比分狀態
    const tied = score[0] === score[1];
    c.textAlign = 'center';
    c.font = font(F.hei(500), 32); c.letterSpacing = '4px';
    c.fillStyle = tied ? rgba('ash', 0.75) : rgba('signal', 0.8);
    c.fillText(tied ? TIE : `${SIDES[last && last.team === 0 ? 0 : 1]} 領先（暫時）`, cx, y + 124);
    c.letterSpacing = '0px'; c.textAlign = 'left';
  }

  /** 主畫面：留言逐字打出來（訊號色游標，剛打的字先是訊號色、0.3 秒變紙白），打完署名。 */
  private message(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const fit = this.fit!;
    // 左上角一行小字：本場最佳（新人自己的留言標「新人致詞」）
    c.font = font(F.hei(700), 32); c.letterSpacing = '6px'; c.fillStyle = rgba('signal', 0.8 * prog(t, this.tFirst, this.tFirst + 0.2));
    c.textAlign = 'center';
    c.fillText(`★ ${this.head} ★`, MAIN.cx, MAIN.y + 4);
    c.letterSpacing = '0px'; c.textAlign = 'left';
    c.font = hc.font = font(FAM_MSG, fit.size);
    let cursor: { x: number; y: number } | null = null;
    for (const g of this.chars) {
      if (t < g.t) { cursor = { x: g.x, y: g.y }; break; }
      const heat = 1 - clamp((t - g.t) / 0.3);
      const base = g.ch === '♥' ? 'rose' : 'bone';
      c.fillStyle = heat > 0 ? mixRgba(base, 'signal', heat) : rgba(base);
      c.fillText(g.ch, g.x, g.y);
    }
    if (cursor && t >= this.tFirst) {
      c.fillStyle = rgba('signal'); c.fillRect(cursor.x + 2, cursor.y - fit.size * 0.82, fit.size * 0.5, fit.size * 0.92);
      hc.fillStyle = rgba('signal', 0.7); hc.fillRect(cursor.x + 2, cursor.y - fit.size * 0.82, fit.size * 0.5, fit.size * 0.92);
    }
    if (t >= this.sigT) {
      c.save(); c.globalAlpha = prog(t, this.sigT, this.sigT + 0.1);
      c.font = font(F.ming(400), this.sigBoard); c.fillStyle = rgba('ash'); c.textAlign = 'center';
      fillWithHearts(c, this.sig, MAIN.cx, this.sigY);
      c.restore();
    }
  }

  /** 沒有留言：歌詞放到主畫面當焦點（大字、逐字跟唱）；純音樂寫歌名。 */
  private bigLyric(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t, 1.6);
    if (!ly) {
      if (!this.lyricsInWindow) {
        c.textAlign = 'center';
        c.font = font(F.archivo(87.5, 800), lyricV2(null) / this.sB); c.fillStyle = rgba('bone', 0.9);
        c.fillText(`♪ ${song.title}`, MAIN.cx, MAIN.y + 190);
        c.textAlign = 'left';
      }
      return;
    }
    const st = { family: FAM_LYR, size: lyricV2(null) / this.sB, minSize: V2.lyrMin / this.sB, maxWidth: MAIN.w, align: 'center' as const, lineHeight: 1.12 };
    const lay = layoutLyric(c, ly.line, st);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    const sub = lyricSubOf(ly.line);
    if (!sub) {
      const oy = MAIN.y + (MAIN.h - lay.height) / 2 + lay.size * 0.86 + (1 - inK) * 24;
      this.karaoke(c, hc, ly.line, lay, MAIN.cx, oy, t, ly.k);
      return;
    }
    // 原文副行：字級與間距照螢幕 px 的規則（板面 px × sB = 螢幕 px），在板面上縮成螢幕 px 畫；主行＋原文整塊在主畫面置中
    const sB = this.sB, main = lay.size * sB;
    const sst: LyricStyle = { family: FAM_LYR, size: main, maxWidth: MAIN.w * sB, align: 'center', sung: rgba('bone'), unsung: rgba('bone', 0.3) };
    const sl = layoutLyric(c, sub, subStyleFor(sst, main));
    const last = lay.rows[lay.rows.length - 1]!.y, gap = subGap(main) / sB;
    const h = lay.size + last + gap + sl.rows[sl.rows.length - 1]!.y / sB;
    const oy = MAIN.y + (MAIN.h - h) / 2 + lay.size * 0.86 + (1 - inK) * 24;
    this.karaoke(c, hc, ly.line, lay, MAIN.cx, oy, t, ly.k);
    c.save();
    c.translate(MAIN.cx, oy + last + gap); c.scale(1 / sB, 1 / sB);
    drawLyricSub(c, sub, t, sst, main, ly.k);
    c.restore();
  }

  /** 逐字跟唱（還沒唱 3 成、正在唱訊號色＋發光、唱完紙白）。 */
  private karaoke(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, line: Line, lay: LyricLayout, ox: number, oy: number, t: number, k: number, clipX?: [number, number]) {
    c.save(); hc.save();
    c.globalAlpha = hc.globalAlpha = k;
    c.font = hc.font = font(FAM_LYR, lay.size);
    for (const w of lay.words) {
      const p = Lyrics.wordProgress(w.word, t);
      const x = ox + w.x, y = oy + w.y;
      if (clipX && (x > clipX[1] + 20 || x + w.w < clipX[0] - 20)) continue;
      c.fillStyle = rgba('bone', 0.3);
      if (p < 1) c.fillText(w.word.w, x, y);
      if (p <= 0) continue;
      c.save(); c.beginPath(); c.rect(x - 4, y - lay.size * 1.1, (w.w + 8) * p, lay.size * 1.5); c.clip();
      c.fillStyle = p < 1 ? rgba('signal') : rgba('bone');
      c.fillText(w.word.w, x, y);
      c.restore();
      if (p < 1) { hc.fillStyle = rgba('signal', 0.6); hc.fillText(w.word.w, x, y); }
    }
    c.restore(); hc.restore();
  }

  /** 下排：有留言時是歌詞跑馬燈（推進來、停住跟唱，太長就跟著唱到的字捲）；沒有歌詞或沒有留言時慢慢捲一行小字。 */
  private strip(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    const room = STRIP.x1 - STRIP.x0;
    c.save(); hc.save();
    c.beginPath(); c.rect(STRIP.x0, STRIP.y0, room, STRIP.y1 - STRIP.y0); c.clip();
    hc.beginPath(); hc.rect(STRIP.x0, STRIP.y0, room, STRIP.y1 - STRIP.y0); hc.clip();
    const ly = this.msg ? lyricAt(lyrics, t) : null;
    const mk = ly ? 1 - ly.k : 1;
    if (mk > 0.01 && (!this.msg || !this.lyricsInWindow || !ly)) {
      // 捲動的小字（跑馬燈本來就是穩定地捲）
      c.globalAlpha = mk * (this.msg ? 0.32 : 0.45);
      c.font = font(FAM_LYR, 34); c.fillStyle = rgba('ash');
      // 一次只看得到一份（間隔拉開到比跑馬燈還寬）
      const step = Math.max(this.marqueeW, room + 240), x0 = STRIP.x1 - ((t - this.ctx.start) * 120) % step;
      for (let x = x0 - step; x < STRIP.x1 + 10; x += step) c.fillText(this.marquee, x, STRIP.base - 6);
      c.globalAlpha = 1;
    }
    if (ly) {
      const st = { family: FAM_LYR, size: this.lyrBoard, minSize: this.lyrBoard, maxWidth: 1e5 };
      const lay = layoutLyric(c, ly.line, st);
      const width = lay.rows[0]?.width ?? 0;
      const inK = ease.outExpo(prog(t, ly.line.start - 0.4, ly.line.start - 0.02));
      const outK = ease.inCubic(clamp(1 - ly.k)) * (t > ly.line.end ? 1 : 0);
      let scroll = 0;
      if (width > room - 40) {
        const cp = Lyrics.lineCharProgress(ly.line, t);
        let hx = 0;
        for (const w of lay.words) if (w.word.o <= cp) hx = w.x + (w.w * clamp(cp - w.word.o, 0, w.word.w.length)) / Math.max(1, w.word.w.length);
        scroll = clamp(hx - room * 0.6, 0, width - room + 40);
      }
      const home = width > room - 40 ? STRIP.x0 + 20 : MAIN.cx - width / 2;
      const ox = home + (1 - inK) * room * 0.8 - outK * room * 0.5 - scroll;
      this.karaoke(c, hc, ly.line, lay, ox, STRIP.base, t, 1, [STRIP.x0, STRIP.x1]);
    }
    c.restore(); hc.restore();
  }
}
