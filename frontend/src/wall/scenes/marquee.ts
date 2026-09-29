// LED 跑馬燈（暗）：下雨的夜裡，對街一棟老公寓的一樓店面——小口磁磚牆、鐵窗、冷氣機，騎樓下是拉下一半的鐵捲門。
//  - 主視覺是這條街景本身，一直在動：斜斜的雨絲（hi-hat 大的時候雨比較密）、冷氣機的風扇在轉、
//    冷氣機一拍滴一滴水、店門口的理髮廳旋轉燈跟著拍子轉、樓上的窗戶燈每兩小節有人開關一次、
//    每兩小節一輛車開過去（車燈從左到右掃過整面牆）。鏡頭整個窗格慢慢推近。
//  - 招牌是兩塊 LED 點陣（一格一顆燈，燈珠看得到、沒亮的也看得到）：
//    · 上面細長的那條＝歌詞：句子從下面「上移」進來，唱到哪一欄燈就從暗變亮；太長就跟著歌聲往左「跑」；空檔跑歌名。
//    · 左邊那塊＝主打留言：第一拍整段從右邊衝進來（燒成訊號色）、停住冷卻成白燈；外框一圈跑燈，一個八分音符走一步。
//      招牌的高度看留言有幾行；署名印在招牌下緣的小牌子上（LED 太小的字讀不到，署名用印的）。沒有留言：兩行邀請，第二行跟著拍子閃。
// 手法：每一格把招牌內容畫在「一顆燈一個像素」的小畫布上（R = 白燈、G = 訊號色燈、B = 愛心的燈），
// 全螢幕 shader 把它放大成一顆一顆圓燈（旁邊的燈會互相照亮一點點），順便算燈光、車燈打在牆上的光與雨絲。
// 2026-09-29「留言尺寸與版面比例標準 v2」：燈距縮到 3 px、留言 42～60 px、招牌 ≤ 840 × 380 放在左邊；
// 空出來的畫面補成會動的街景（雨、冷氣、旋轉燈、窗戶、過路的車燈）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, TAU } from '../engine/util';
import { wrap, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { layoutLyric, beatAfter, signature } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { DotCanvas, windowLines, fillGlyph, type Rect } from './_t9';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.35, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 兩塊點陣（燈距 3 px）
const PITCH = 3;
/** 歌詞：上面一條長的。 */
const LS = { x0: 210, y: 150, cols: 500, rows: 20 };
/** 留言：左邊一塊（高度看留言），最多 126 列（378 px）。 */
const MS = { x0: 150, y: 318, cols: 280, maxRows: 126 };
const COLS_ALL = Math.max(LS.cols, MS.cols);
/** 外殼比點陣大一圈。 */
const PAD = 12;
const LY_BASE = 16;
/** 歌詞可以用的寬度（左右各留 3 格）。 */
const LY_W = LS.cols - 6;
/** 留言：外框一圈跑燈＋一格留白之後的寬度。 */
const MS_W = MS.cols - 10;
const SHIFT = 0.2; // 上移換頁要幾秒
const HOLD = 1.4; // 唱完的句子留多久
const IDLE_SPEED = 60; // 空檔跑歌名：每秒幾格
const FAM = F.hei(500);

// ---------------------------------------------------------------- 街景
/** 騎樓的樑、左邊店面的鐵捲門（下面開著一條縫）、右邊的柱子。 */
const BEAM = { y0: 722, y1: 748 };
const SHOP = { x0: 110, x1: 1190, box: 772, open: 1000 };
/** 樓上兩扇鐵窗、冷氣機、理髮廳旋轉燈。 */
const WINS: Rect[] = [[1176, 300, 262, 236], [1500, 300, 262, 236]];
const AC = { x: 1222, y: 580, w: 176, h: 96 };
const POLE = { x: 1248, y0: 780, y1: 952, w: 40 };

const INVITE = ['掃描右下角 QR code', '把你的祝福送上跑馬燈'];

const f1 = (x: number) => x.toFixed(1);
const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D content;
  uniform float power; uniform float flick; uniform float kick; uniform float spill; uniform float t;
  uniform float msRows; uniform float sweep; uniform float rain; uniform float tube;
  vec3 lit(vec3 v) { return C_BONE * v.r + C_SIGNAL * 1.75 * v.g + C_ROSE * 1.25 * v.b; }
  vec3 cellAt(int x, int y, int off, int cols, int rows) {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return vec3(0.0);
    return texelFetch(content, ivec2(x, y + off), 0).rgb;
  }
  // 一塊點陣（x0, y0：左上 px；off：內容畫布的起始列）
  void strip(vec2 p, float x0, float y0, int cols, int rows, int off, inout vec3 col) {
    const float pitch = ${f1(PITCH)};
    vec2 hs = vec2(float(cols), float(rows)) * pitch + ${2 * PAD}.0;
    vec2 hq = p - vec2(x0 - ${PAD}.0, y0 - ${PAD}.0);
    // 外殼：圓角的鋁框（上緣一條亮邊、下緣暗）、四角的螺絲
    float d = sdBox(hq - hs * 0.5, hs * 0.5 - 6.0) - 6.0;
    if (d > 3.0) return;
    float edge = aaFill(d);
    vec3 shell = mix(C_INK2 * 1.5, C_GRAPHITE * 0.3, smoothstep(0.0, hs.y, hs.y - hq.y) * 0.5);
    shell += C_BONE * 0.05 * pxLine(abs(hq.y - 1.5), 0.4, 1.4);
    shell *= 1.0 - 0.45 * pxLine(abs(d + 4.0), 0.5, 1.6);
    vec2 sc = vec2(min(hq.x, hs.x - hq.x), min(hq.y, hs.y - hq.y));
    shell += C_ASH * 0.2 * (1.0 - smoothstep(2.0, 3.0, length(sc - 6.5)));
    col = mix(col, shell, edge);
    vec2 q = (p - vec2(x0, y0)) / pitch;
    float fc = float(cols), fr = float(rows);
    if (q.x < -0.5 || q.y < -0.5 || q.x > fc + 0.5 || q.y > fr + 0.5) return;
    col = mix(col, C_INK * 0.45, edge);
    if (q.x < 0.0 || q.y < 0.0 || q.x >= fc || q.y >= fr) return;
    ivec2 cell = ivec2(floor(q));
    vec2 f = fract(q) - 0.5;
    float r = length(f);
    float aa = max(fwidth(r), 1e-3);
    float lens = 1.0 - smoothstep(0.38 - aa, 0.38 + aa, r);
    float on = step(float(cell.x), power * fc) * flick;
    vec3 L = lit(cellAt(cell.x, cell.y, off, cols, rows) * on) * (1.0 + 0.1 * kick);
    vec3 dark = (C_INK2 * 1.9 + C_GRAPHITE * 0.07) * (0.8 + 0.4 * smoothstep(0.3, -0.3, f.y));
    col = mix(col, dark, lens * 0.9);
    col += L * lens * (0.9 + 0.35 * smoothstep(0.38, 0.0, r));
    // 上下左右四顆的光溢出來一點（招牌看起來是「一片亮」，不是一堆孤立的點）
    vec3 n = lit(cellAt(cell.x + 1, cell.y, off, cols, rows) * on) + lit(cellAt(cell.x - 1, cell.y, off, cols, rows) * on)
           + lit(cellAt(cell.x, cell.y + 1, off, cols, rows) * on) + lit(cellAt(cell.x, cell.y - 1, off, cols, rows) * on);
    col += n * 0.035 + L * 0.12;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 招牌的光打在牆上：離兩塊點陣越遠越暗
    vec2 msC = vec2(${f1(MS.x0 + (MS.cols * PITCH) / 2)}, ${f1(MS.y)} + msRows * ${f1(PITCH / 2)});
    vec2 msH = vec2(${f1((MS.cols * PITCH) / 2 + PAD)}, msRows * ${f1(PITCH / 2)} + ${PAD}.0);
    vec2 lsC = vec2(${f1(LS.x0 + (LS.cols * PITCH) / 2)}, ${f1(LS.y + (LS.rows * PITCH) / 2)});
    vec2 lsH = vec2(${f1((LS.cols * PITCH) / 2 + PAD)}, ${f1((LS.rows * PITCH) / 2 + PAD)});
    float light = exp(-max(sdBox(p - msC, msH), 0.0) / 200.0) + 0.6 * exp(-max(sdBox(p - lsC, lsH), 0.0) / 160.0);
    light *= spill * power * flick;
    vec3 lamp = mix(C_SIGNAL, C_BONE, 0.45);
    // 過路的車燈：一道暖暖的光從左到右掃過整面牆
    float car = exp(-pow((p.x - sweep) / 220.0, 2.0)) * smoothstep(1080.0, 700.0, p.y) * 0.55;
    vec3 col;
    if (p.y < ${f1(BEAM.y0)}) {
      // 小口磁磚：22 px 一片、2 px 的溝，每片的顏色有一點不一樣
      vec2 g = p / 22.0, id = floor(g), fq = fract(g);
      float h = hash12(id);
      float grout = max(pxLine(min(fq.x, 1.0 - fq.x) * 22.0, 0.7, 1.9), pxLine(min(fq.y, 1.0 - fq.y) * 22.0, 0.7, 1.9));
      vec3 alb = mix(C_GRAPHITE * 0.55, C_ASH * 0.62, h * h) * (0.9 + 0.1 * snoise(p / 90.0));
      alb = mix(alb, C_INK2, grout * 0.85);
      alb *= 0.92 + 0.12 * smoothstep(0.6, 0.0, fq.y) * (1.0 - grout);
      // 雨水沿著牆流下來的水痕（很淡）
      alb *= 0.9 + 0.1 * smoothstep(0.4, 0.9, snoise(vec2(p.x / 30.0, p.y / 400.0)));
      col = alb * (0.026 + lamp * (1.0 - exp(-light * light)) * 0.07 + C_EMBER * car * 0.08);
    } else if (p.y < ${f1(BEAM.y1)}) {
      // 騎樓的樑：水泥、下緣一條暗縫
      col = mix(C_GRAPHITE * 0.2, C_INK2, smoothstep(${f1(BEAM.y0)}, ${f1(BEAM.y1)}, p.y)) * (1.0 + 2.0 * car) + C_BONE * 0.03 * pxLine(abs(p.y - ${f1(BEAM.y0 + 1)}), 0.4, 1.2);
    } else {
      // 騎樓底下：樑下一支日光燈照著鐵捲門（越往下越暗）；左邊是鐵捲門，下面開著一條縫，裡面的燈透出來
      col = C_INK * 0.7;
      float fl = tube * exp(-max(0.0, p.y - ${f1(BEAM.y1)}) / 150.0) * exp(-pow((p.x - 620.0) / 520.0, 2.0));
      if (p.x > ${f1(SHOP.x0)} && p.x < ${f1(SHOP.x1)}) {
        vec3 alb;
        if (p.y < ${f1(SHOP.box)}) alb = C_GRAPHITE * 0.45 * (0.75 + 0.5 * smoothstep(${f1(SHOP.box)}, ${f1(BEAM.y1)}, p.y));
        else {
          float r = fract((p.y - ${f1(SHOP.box)}) / 17.0);
          float prof = sin(r * PI);
          alb = C_GRAPHITE * (0.26 + 0.3 * prof * prof);
          alb *= 1.0 - 0.6 * pxLine(min(r, 1.0 - r) * 17.0, 0.4, 1.4);
        }
        col = alb * (0.02 + lamp * light * 0.05 + C_EMBER * car * 0.12 + C_BONE * fl * 0.5);
        if (p.y > ${f1(SHOP.open)}) {
          // 門縫裡的店：暖黃的燈、地上一片反光
          float g = smoothstep(${f1(SHOP.open)}, 1080.0, p.y);
          col = mix(C_FUR, C_BONE, 0.4) * (0.02 + 0.035 * g) * (0.8 + 0.2 * snoise(vec2(p.x / 60.0, 1.0)));
        }
      } else if (p.x >= ${f1(SHOP.x1)} && p.x < ${f1(SHOP.x1 + 110)}) {
        col = C_INK2 * 0.9 * (1.0 + car) + C_BONE * fl * 0.08;
      }
    }
    // 日光燈管本身
    float dT = sdBox(p - vec2(620.0, ${f1(BEAM.y1 + 7)}), vec2(300.0, 4.0));
    col = mix(col, C_BONE * (0.25 + 0.9 * tube), aaFill(dT));
    col += C_BONE * tube * 0.08 * exp(-max(dT, 0.0) / 30.0);
    strip(p, ${f1(LS.x0)}, ${f1(LS.y)}, ${LS.cols}, ${LS.rows}, 0, col);
    strip(p, ${f1(MS.x0)}, ${f1(MS.y)}, ${MS.cols}, int(msRows), ${LS.rows}, col);
    // 雨：斜斜的細線，一條一條以不同速度往下掉；被招牌和車燈照到的地方亮一點
    float u = p.x + p.y * 0.16;
    float cx = floor(u / 8.0);
    float h1 = hash11(cx * 1.37 + 3.0);
    float yy = p.y + t * (1100.0 + 500.0 * h1) + h1 * 3000.0;
    float per = 190.0 + 160.0 * hash11(cx * 0.71);
    float seg = fract(yy / per);
    float streak = smoothstep(0.0, 0.05, seg) * smoothstep(0.32, 0.05, seg);
    float line = pxLine(abs(fract(u / 8.0) - 0.5) * 8.0, 0.25, 0.9);
    float dens = step(1.0 - 0.45 * rain, hash11(cx * 2.31 + floor(yy / per) * 0.13));
    col += (C_BONE * 0.018 + lamp * light * 0.09 + C_EMBER * car * 0.25) * line * streak * dens;
    fragColor = vec4(col, 1.0);
  }`, {
  content: { value: null }, power: { value: 1 }, flick: { value: 1 }, kick: { value: 0 }, spill: { value: 1 }, t: { value: 0 },
  msRows: { value: 60 }, sweep: { value: -9999 }, rain: { value: 1 }, tube: { value: 1 },
});

/** R = 白燈、G = 訊號色燈、B = 愛心燈的亮度（0..1）→ 畫布的填色。 */
const led = (r: number, g = 0, b = 0) => `rgb(${Math.round(255 * clamp(r))},${Math.round(255 * clamp(g))},${Math.round(255 * clamp(b))})`;

/** 歌詞條的內容：一句歌詞，或空檔時跑歌名。t0 = 從這個時間開始（上移進來）。 */
interface Seg { kind: 'line' | 'idle'; line?: Line; t0: number }

export default class Marquee extends Scene {
  bg = shared('marquee.bg', BG);
  dots!: DotCanvas;
  /** 不會動的東西（招牌的支架、電線、鐵窗、冷氣機的殼）：畫一次就好。 */
  still = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 會動的小東西（旋轉燈、風扇、水滴、窗戶的燈、署名）。 */
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 83 + (this.msg?.id ?? 0)) >>> 0;
  segs: Seg[] = [];
  idleText = '';
  idleW = 0;
  /** 留言：字級（點）、行距、排好的行、招牌有幾列。 */
  size = 16; lh = 18; rows = 60; base0 = 20;
  lyrDots = 16;
  mLines: string[] = [];
  sig = ''; sigSize = 30;
  tFirst = 0; tStop = 0;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.idleText = `♪ ${song.title}${song.artist ? ' — ' + song.artist : ''}　　`;
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${this.idleText}${INVITE.join('')}本店祝福一律免費保固一輩子`);
    const mc = document.createElement('canvas').getContext('2d')!;

    // ---- 留言：字級（點數）照標準 v2 換算（燈距 3 px），先照子句斷行
    let fit: FitResult | null = null;
    if (m) {
      const maxDots = Math.max(14, Math.floor(msgMaxFor(m.text) / PITCH));
      const o = { min: 14, max: maxDots, lineHeight: 1.14, maxLines: 6 };
      fit = fitClauses(mc, m.text, FAM, MS_W, MS.maxRows - 12, o);
      if (!fit) { mc.font = font(FAM, 14); fit = { size: 14, lines: wrap(mc, m.text, MS_W), lineHeight: 16, width: MS_W, height: 0 }; }
      this.size = fit.size; this.lh = Math.round(fit.lineHeight); this.mLines = fit.lines;
      this.sigSize = sigV2(fit.size * PITCH);
      this.lyrDots = Math.floor(lyricV2(fit.size * PITCH) / PITCH);
    } else {
      this.size = 16; this.lh = 19; this.mLines = INVITE;
      this.lyrDots = Math.floor(lyricV2(null) / PITCH);
    }
    this.base0 = 5 + Math.round(this.size * 0.88);
    this.rows = Math.min(MS.maxRows, this.base0 + (this.mLines.length - 1) * this.lh + Math.round(this.size * 0.3) + 5);
    this.dots = this.track(new DotCanvas(COLS_ALL, LS.rows + this.rows));
    const c = this.dots.ctx;
    c.font = font(FAM, this.lyrDots);
    this.idleW = c.measureText(this.idleText).width;

    // ---- 歌詞條的時間表：每一句提早 0.25 秒上移進來；唱完留 HOLD 秒，下一句還很久才來就換成跑歌名
    const lines = windowLines(lyrics, s, e);
    this.segs = [{ kind: 'idle', t0: -Infinity }];
    for (const [i, ln] of lines.entries()) {
      const prev = lines[i - 1];
      const tIn = ln.start - 0.25;
      if (prev && tIn - (prev.end + HOLD) > 0.8) this.segs.push({ kind: 'idle', t0: prev.end + HOLD });
      this.segs.push({ kind: 'line', line: ln, t0: tIn });
    }
    const last = lines[lines.length - 1];
    if (last) this.segs.push({ kind: 'idle', t0: last.end + HOLD });

    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.25, beat * 0.4));
    this.tStop = this.tFirst + clamp(beat * 1.25, 0.45, 0.9);
    this.drawStill();
    const mh = this.rows * PITCH;
    this.avoid = [[LS.x0 - PAD, LS.y - PAD, LS.cols * PITCH + 2 * PAD, LS.rows * PITCH + 2 * PAD], [MS.x0 - PAD, MS.y - PAD, MS.cols * PITCH + 2 * PAD, mh + 2 * PAD + 60]];
  }

  /** 招牌的支架、電線、銘牌、鐵窗、冷氣機的殼（畫一次）。 */
  private drawStill() {
    const L = this.still, c = L.ctx;
    L.clear();
    const mw = MS.cols * PITCH, mh = this.rows * PITCH;
    // 兩塊招牌的支架（從牆上伸出來）
    for (const [x0, y0, w] of [[LS.x0, LS.y, LS.cols * PITCH], [MS.x0, MS.y, mw]] as const) {
      for (const bx of [x0 + 120, x0 + w - 120]) {
        c.fillStyle = rgba('graphite', 0.5); c.fillRect(bx - 4, y0 - PAD - 20, 8, 20);
        c.fillStyle = rgba('graphite', 0.65); c.fillRect(bx - 12, y0 - PAD - 24, 24, 6);
      }
    }
    // 電源線：從留言那塊右下垂到騎樓的樑
    c.strokeStyle = rgba('ink', 0.95); c.lineWidth = 4;
    const cx0 = MS.x0 + mw - 30, cy0 = MS.y + mh + PAD;
    c.beginPath(); c.moveTo(cx0, cy0); c.bezierCurveTo(cx0 + 10, cy0 + 60, cx0 + 40, BEAM.y0 - 40, cx0 + 30, BEAM.y0); c.stroke();
    // 招牌下緣的小牌子（署名印在上面，冷面的規格印在左邊）
    c.font = font(F.mono(500), 11); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.38);
    c.fillText(`LED ${MS.cols}×${this.rows} · 保固：一輩子`, MS.x0 - PAD + 4, MS.y + mh + PAD + 22);
    c.letterSpacing = '0px';
    // 樓上的窗戶：暗暗的玻璃（燈與鐵窗在 dyn 層，燈才會在鐵窗後面）
    for (const [x, y, w, h] of WINS) { c.fillStyle = rgba('ink', 0.85); c.fillRect(x, y, w, h); }
    // 冷氣機的殼（風扇在 dyn 層轉）
    c.fillStyle = mixRgba('ink2', 'graphite', 0.35); c.fillRect(AC.x, AC.y, AC.w, AC.h);
    c.strokeStyle = rgba('ash', 0.3); c.lineWidth = 1.5; c.strokeRect(AC.x, AC.y, AC.w, AC.h);
    c.strokeStyle = rgba('graphite', 0.6); c.lineWidth = 3;
    c.beginPath(); c.moveTo(AC.x + 10, AC.y + AC.h); c.lineTo(AC.x - 6, AC.y + AC.h + 26); c.moveTo(AC.x + AC.w - 10, AC.y + AC.h); c.lineTo(AC.x + AC.w + 6, AC.y + AC.h + 26); c.stroke();
    // 旋轉燈的上下蓋
    c.fillStyle = rgba('graphite', 0.8);
    c.fillRect(POLE.x - 6, POLE.y0 - 14, POLE.w + 12, 14); c.fillRect(POLE.x - 6, POLE.y1, POLE.w + 12, 14);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const D = this.dots, c = D.ctx;
    D.clear();
    // 每一格從同樣的畫布狀態開始（對齊、字型…不會被上一格留下來的設定影響）
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.textBaseline = 'alphabetic';
    this.lyricStrip(c, t);
    this.msgStrip(c, t, f);
    c.restore();

    const B = this.bg.u;
    B.content!.value = D.upload();
    B.power!.value = prog(t, s, s + 0.32);
    // 關機：最後 0.3 秒閃兩下再熄
    B.flick!.value = t > e - 0.3 ? (Math.floor((t - (e - 0.3)) / 0.075) % 2 === 0 ? 0.3 : 1) * (1 - prog(t, e - 0.06, e)) : 1;
    B.kick!.value = f.a.kick;
    B.spill!.value = 0.8 + 0.25 * f.a.rms;
    B.t!.value = t;
    B.msRows!.value = this.rows;
    B.rain!.value = 0.75 + 0.6 * f.a.hat;
    const bar = au.barAt(t);
    // 騎樓的日光燈：老燈管，每兩小節有一半的機會在第三拍「滋」地閃兩下
    const b2f = Math.floor(bar / 2 + 1e-4) * 2, tf = au.timeOfBar(b2f) + au.beatPeriod(t) * 2;
    const flickNow = hash(b2f, this.seed + 9) < 0.5 && t >= tf && t < tf + 0.16;
    B.tube!.value = flickNow ? (Math.floor((t - tf) / 0.04) % 2 === 0 ? 0.15 : 0.8) : 1;
    // 過路的車：每兩小節的第一拍，車燈從左到右掃過去（一拍半）
    const b2 = Math.floor(bar / 2 + 1e-4) * 2, tc = au.timeOfBar(b2);
    const sw = prog(t, tc, tc + au.beatPeriod(t) * 1.5, ease.inOutCubic);
    B.sweep!.value = sw > 0 && sw < 1 ? -400 + sw * 2700 : -9999;
    this.bg.render(renderer, out);
    comp.draw(renderer, this.still.texture, out);
    this.street(t);
    comp.draw(renderer, this.dyn.upload(), out);
    const hit = pulse(t, au.timeOfBar(Math.floor(bar + 1e-4)), 0.18);
    // 鏡頭：整個窗格慢慢推近（強烈緩動的慢推），小節線上輕輕頂一下
    const push = ease.inOutCubic(clamp((t - s) / Math.max(1, e - s)));
    return { bloom: 0.85, bloomRadius: 0.6, vignette: 0.6, halation: 0.35, grain: 0.05, ca: 0.6, zoom: 1 + 0.04 * push + 0.004 * hit, popupAvoid: this.avoid };
  }

  /** 街景裡會動的小東西：窗戶的燈、冷氣機的風扇與水滴、理髮廳旋轉燈、署名的小牌子。 */
  private street(t: number) {
    const au = this.ctx.audio, L = this.dyn, c = L.ctx;
    L.clear();
    c.save();
    const bt = au.beatAt(t), bar = au.barAt(t);
    // 樓上的窗戶：每兩小節有一扇的燈被打開或關掉（窗簾透出暖光）
    WINS.forEach(([x, y, w, h], i) => {
      const onNow = hash(Math.floor(bar / 2 + 1e-4), i, this.seed) < (i === 0 ? 0.7 : 0.45);
      if (!onNow) return;
      // 室內燈（暖白，不跟主題的訊號色走：別人家的燈不會是綠的）透過窗簾
      const g = c.createRadialGradient(x + w * 0.5, y + h * 0.35, 10, x + w * 0.5, y + h * 0.5, w * 0.75);
      g.addColorStop(0, mixRgba('bone', 'fur', 0.35, 0.22)); g.addColorStop(1, mixRgba('bone', 'fur', 0.5, 0.08));
      c.fillStyle = g; c.fillRect(x, y, w, h);
      // 窗簾：左右兩片的褶（很淡）
      c.fillStyle = rgba('ink', 0.14);
      for (let k = 0; k < 4; k++) { c.fillRect(x + 10 + k * 18, y, 7, h); c.fillRect(x + w - 17 - k * 18, y, 7, h); }
    });
    // 鐵窗：窗框、直條與兩道橫條、窗台（畫在燈的前面）
    for (const [x, y, w, h] of WINS) {
      c.strokeStyle = rgba('graphite', 0.55); c.lineWidth = 3; c.strokeRect(x, y, w, h);
      c.strokeStyle = rgba('graphite', 0.5); c.lineWidth = 2;
      c.strokeRect(x - 16, y - 14, w + 32, h + 28);
      c.beginPath();
      for (let bx = x - 8; bx <= x + w + 8; bx += 16) { c.moveTo(bx, y - 14); c.lineTo(bx, y + h + 14); }
      for (const by of [y + h * 0.33, y + h * 0.66]) { c.moveTo(x - 16, by); c.lineTo(x + w + 16, by); }
      c.stroke();
      c.fillStyle = rgba('graphite', 0.35); c.fillRect(x - 24, y + h + 14, w + 48, 8);
    }
    // 冷氣機的風扇：一直轉（格柵後面看得到葉片的影子）
    const fx = AC.x + AC.w - 50, fy = AC.y + AC.h / 2, fr = 36;
    c.strokeStyle = rgba('ash', 0.35); c.lineWidth = 1.2;
    c.beginPath(); c.arc(fx, fy, fr, 0, TAU); c.stroke();
    const fa = t * 9;
    c.fillStyle = rgba('graphite', 0.9);
    for (let k = 0; k < 3; k++) {
      const a = fa + (k * TAU) / 3;
      c.beginPath(); c.moveTo(fx, fy); c.arc(fx, fy, fr - 4, a, a + 0.8); c.closePath(); c.fill();
    }
    c.strokeStyle = rgba('ash', 0.22); c.lineWidth = 1;
    for (let gy = fy - fr + 6; gy < fy + fr; gy += 6) { const hw = Math.sqrt(Math.max(0, fr * fr - (gy - fy) ** 2)); c.beginPath(); c.moveTo(fx - hw, gy); c.lineTo(fx + hw, gy); c.stroke(); }
    // 冷氣水：一拍滴一滴，掉到騎樓的地上濺開
    const dx = AC.x + 40, dy0 = AC.y + AC.h + 4, dy1 = 1040;
    const b = Math.floor(bt + 1e-4);
    for (const k of [b, b - 1]) {
      const age = t - au.timeOfBeat(k);
      if (age < 0) continue;
      const y = dy0 + 0.5 * 3200 * age * age;
      if (y < dy1) {
        c.fillStyle = rgba('bone', 0.55);
        c.beginPath(); c.ellipse(dx, y, 2.2, 4 + Math.min(8, age * 30), 0, 0, TAU); c.fill();
      } else {
        const ta = age - Math.sqrt((2 * (dy1 - dy0)) / 3200);
        if (ta < 0.3) { c.strokeStyle = rgba('bone', 0.4 * (1 - ta / 0.3)); c.lineWidth = 1.2; c.beginPath(); c.ellipse(dx, dy1, 6 + ta * 80, 2 + ta * 12, 0, 0, TAU); c.stroke(); }
      }
    }
    // 理髮廳旋轉燈：玻璃管裡斜斜的紅白條紋，一拍往上轉一圈的四分之一
    c.save();
    c.beginPath(); c.roundRect(POLE.x, POLE.y0, POLE.w, POLE.y1 - POLE.y0, 16); c.clip();
    c.fillStyle = rgba('bone', 0.7); c.fillRect(POLE.x, POLE.y0, POLE.w, POLE.y1 - POLE.y0);
    const off = (bt * 0.25 * 60) % 60;
    for (let k = -4; k < 8; k++) {
      const y = POLE.y1 - k * 30 - off;
      c.fillStyle = k % 2 === 0 ? rgba('blood', 0.95) : rgba('signal', 0.85);
      c.beginPath(); c.moveTo(POLE.x - 2, y); c.lineTo(POLE.x + POLE.w + 2, y - 26); c.lineTo(POLE.x + POLE.w + 2, y - 38); c.lineTo(POLE.x - 2, y - 12); c.closePath(); c.fill();
    }
    // 玻璃的反光與左右兩邊的暗
    const g = c.createLinearGradient(POLE.x, 0, POLE.x + POLE.w, 0);
    g.addColorStop(0, rgba('ink', 0.5)); g.addColorStop(0.3, rgba('bone', 0.15)); g.addColorStop(0.45, rgba('ink', 0)); g.addColorStop(1, rgba('ink', 0.55));
    c.fillStyle = g; c.fillRect(POLE.x, POLE.y0, POLE.w, POLE.y1 - POLE.y0);
    c.restore();
    // 署名：印在招牌下緣的小牌子上，留言衝進來停住之後才亮
    if (this.msg && t >= this.tStop) {
      const mw = MS.cols * PITCH, mh = this.rows * PITCH;
      c.globalAlpha = prog(t, this.tStop, this.tStop + 0.3);
      c.font = font(F.hand(700), this.sigSize); c.fillStyle = rgba('bone', 0.92); c.textAlign = 'right';
      c.fillText(this.sig, MS.x0 + mw, MS.y + mh + PAD + this.sigSize + 12);
      c.textAlign = 'left'; c.globalAlpha = 1;
    }
    c.restore();
  }

  // ------------------------------------------------------------ 歌詞條
  private lyricStrip(c: CanvasRenderingContext2D, t: number) {
    let k = 0;
    for (let i = 0; i < this.segs.length; i++) if (this.segs[i]!.t0 <= t) k = i;
    const cur = this.segs[k]!, prev = this.segs[k - 1];
    const u = prev ? clamp((t - cur.t0) / SHIFT) : 1;
    const dy = Math.round(ease.inOutCubic(u) * LS.rows);
    c.save();
    c.beginPath(); c.rect(0, 0, LS.cols, LS.rows); c.clip();
    c.font = font(FAM, this.lyrDots);
    if (prev && dy < LS.rows) this.drawSeg(c, prev, t, -dy);
    this.drawSeg(c, cur, t, LS.rows - dy);
    c.restore();
  }

  private drawSeg(c: CanvasRenderingContext2D, sg: Seg, t: number, top: number) {
    const base = top + LY_BASE;
    if (sg.kind === 'idle') {
      // 跑歌名：從右邊跑進來，一秒 IDLE_SPEED 格
      const t0 = Number.isFinite(sg.t0) ? sg.t0 : this.ctx.start;
      const x = LS.cols - Math.floor((t - t0) * IDLE_SPEED);
      const P = Math.ceil(this.idleW);
      const k0 = Math.max(0, Math.floor(-x / P));
      c.fillStyle = led(0.6);
      for (let kx = k0; x + kx * P < LS.cols; kx++) c.fillText(this.idleText, x + kx * P, base);
      return;
    }
    const line = sg.line!;
    const lay = layoutLyric(c, line, { family: FAM, size: this.lyrDots, maxWidth: 1e5 });
    const width = lay.rows[0]?.width ?? 0;
    // 太長：跟著唱到的地方往左跑，唱到的字停在六成的位置；放得下就置中
    let head = 0;
    for (const pw of lay.words) { const p = Lyrics.wordProgress(pw.word, t); if (p > 0) head = pw.x + pw.w * p; }
    const xo = width > LY_W ? Math.round(clamp(head - LY_W * 0.62, 0, width - LY_W)) : Math.round((width - LY_W) / 2);
    const x0 = 3 - xo;
    for (const pw of lay.words) {
      const x = Math.round(x0 + pw.x);
      if (x > LS.cols || x + pw.w < -2) continue;
      const p = Lyrics.wordProgress(pw.word, t);
      // 逐欄點亮：唱到的欄亮，其他的欄三成亮
      const cut = Math.round(x + (pw.w + 1) * p);
      if (p < 1) {
        c.save(); c.beginPath(); c.rect(cut, top, LS.cols, LS.rows); c.clip();
        c.fillStyle = led(0.3); c.fillText(pw.word.w, x, base);
        c.restore();
      }
      if (p > 0) {
        c.save(); c.beginPath(); c.rect(x - 2, top, cut - x + 2, LS.rows); c.clip();
        c.fillStyle = p < 1 ? led(0, 1) : led(1);
        c.fillText(pw.word.w, x, base);
        c.restore();
      }
    }
  }

  // ------------------------------------------------------------ 留言條
  private msgStrip(c: CanvasRenderingContext2D, t: number, f: Frame) {
    const au = this.ctx.audio;
    const top = LS.rows, R = this.rows, C = MS.cols;
    // 外框跑燈：一圈，三顆亮一顆，一個八分音符走一步（第一拍之前停著）
    const beat = au.beatPeriod(t);
    const step = t < this.tFirst ? 0 : Math.floor((t - this.tFirst) / (beat / 2) + 1e-4);
    const per = 2 * (C + R) - 4;
    for (let i = 0; i < per; i++) {
      const [x, y] = i < C ? [i, 0] : i < C + R - 1 ? [C - 1, i - C + 1] : i < 2 * C + R - 2 ? [C - 1 - (i - (C + R - 2)), R - 1] : [0, R - 1 - (i - (2 * C + R - 3))];
      const onI = (i + step) % 3 === 0;
      c.fillStyle = onI ? led(0, 0.8) : led(0.08);
      c.fillRect(x, top + y, 1, 1);
    }
    // 衝進來：第一拍從右邊整段衝進來（整格整格地移），停住後從訊號色冷卻成白燈
    const run = ease.outCubic(prog(t, this.tFirst, this.tStop));
    const xo = t < this.tFirst ? C : Math.round((1 - run) * (C - 2));
    const heat = t < this.tStop ? 1 : 1 - clamp((t - this.tStop) / 0.6);
    c.save();
    c.beginPath(); c.rect(2, top + 2, C - 4, R - 4); c.clip();
    c.font = font(FAM, this.size);
    // 沒有留言：第二行（邀請）跟著拍子閃
    const blink = !this.msg && t >= this.tStop && f.beatPhase > 0.72 ? 0.25 : 1;
    this.mLines.forEach((ln, i) => {
      const y = top + this.base0 + i * this.lh;
      const b = !this.msg && i === 1 ? blink : 1;
      const fill = led(b * (1 - heat), heat * b);
      let cx = 5 + xo;
      for (const ch of Array.from(ln)) {
        fillGlyph(c, ch, cx, y, fill, led(0, 0, 1));
        cx += c.measureText(ch).width;
      }
    });
    c.restore();
    void V2;
  }
}
