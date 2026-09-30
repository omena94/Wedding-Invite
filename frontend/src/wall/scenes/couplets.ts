// 雙語對聯（暗，雙語版面）：夜裡一扇老木門，門框兩邊貼著紅紙對聯、門楣上貼橫批，兩盞紅燈籠在屋簷下照著。
//  - 右邊的上聯寫中文歌詞、左邊的下聯寫原文（直排：中文、韓文一字一格；英文像直式招牌，一個單字一行、字是正的、由上往下疊），
//    字先是淡淡的金色描線，唱到的那一刻寫實（中文由上往下、英文由左往右擦亮，正在寫是訊號色、寫好是金色）；
//    一支毛筆在字的外側跟著正在寫的字上下走（筆尖在整組字旁邊、竹管往外上方伸，不壓到任何一個字）。
//    句子太長就排成兩行（由右往左）；英文單字太寬時對聯整副加寬一點（最寬 210）。沒翻譯的歌：上聯、下聯輪流寫中文，一句寫在右邊、下一句寫在左邊，像一副對聯一問一答。
//  - 主打留言是橫批（門楣上的紅紙，橫寫、燙金），第一個拍點一個字一個字寫上去；署名在最後一行下面。
//    沒有主打留言：橫批是「百年好合」，下面一行小字邀請。純音樂：上下聯是一副固定的喜聯，一拍寫一個字。
//  - 燈籠在拍點輕輕晃、每個小節線被風吹得晃大一點，燈光在牆上跟著晃；門縫透出屋裡的暖光，跟著低音一明一暗；
//    門環在大鼓時晃一下。右邊的窗格貼著一張小小的紅色剪紙。
// 畫法：牆、門、窗、紅紙都不會動，畫一次在一張 Canvas2D（牆的質感是 shader，存起來）；字、毛筆、燈籠、光每格畫在另一張。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash, mulberry32, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricSubOf, type Line } from '../engine/lyrics';
import { beatAfter, drawHeart, COUPLE_ZH } from './_motifs';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';
import { fitMsgB2, sigOf, windowLines, linesText, charProgress, INVITE, B2_SYMBOLS, no3, type Rect } from './_b2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'print', paper: false, energy: [0.25, 0.9], bars: [4, 8] };

/** 門（兩扇）、門框、兩條對聯（左：下聯、右：上聯）、橫批的中心與最大寬高。 */
const DOOR = { x0: 450, x1: 1110, y0: 404, y1: 1080 };
const FRAME = { x0: 424, x1: 1136, y0: 380 };
/** 對聯的上下緣；寬度依內容（英文一個單字一行時要寬一點），左聯的右緣、右聯的左緣固定貼著門框。 */
const STRIP = { y0: 404, y1: 1026, minW: 150, maxW: 210 };
const LEFT_R = 412, RIGHT_X = 1148;
const BAN = { cx: 780, y0: 64, maxW: 860, maxH: 300 };
/** 燈籠掛點（屋簷下）。 */
const LANTERNS = [{ x: 150, y: 70 }, { x: 1560, y: 60 }];
/** 右邊的窗（窗格＋剪紙）。 */
const WIN = { x: 1400, y: 470, w: 380, h: 300 };
const ZH_FAM = F.ming(900);
const SUB_FAM = F.ming(700);
const MSG_FAM = F.ming(700);
const SIG_FAM = F.hand(700);
const NO_MSG_BANNER = '百年好合';
/** 純音樂：固定的一副喜聯。 */
const INST = ['佳偶天成情似海', '良緣永結愛如山'];

const WALL = /* glsl */ `
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 老牆：灰泥＋底下露出一點磚（很暗，燈籠的光另外畫）
  float g = fbm(p / 160.0, 4), fine = fbm(p / 9.0, 2);
  vec2 b = vec2(p.x / 96.0 + 0.5 * floor(p.y / 40.0), p.y / 40.0);
  vec2 bf = abs(fract(b) - 0.5);
  float mortar = 1.0 - smoothstep(0.42, 0.48, max(bf.x * 96.0 / 40.0 / 2.4, bf.y));
  float peel = smoothstep(0.58, 0.72, fbm(p / 300.0 + 5.0, 3));
  vec3 plaster = mix(C_INK2, C_GRAPHITE, 0.18 + 0.1 * g) * (0.9 + 0.12 * fine);
  vec3 brick = mix(C_INK2, mix(C_BLOOD, C_SEPIA, 0.5), 0.35) * (0.85 + 0.15 * fine) * (1.0 - 0.4 * mortar);
  vec3 col = mix(plaster, brick, peel);
  // 屋簷的影子（上緣暗）、地面（下緣一條石階）
  col *= 0.55 + 0.45 * smoothstep(0.0, 160.0, p.y);
  col *= 1.0 - 0.3 * smoothstep(1040.0, 1080.0, p.y);
  // 右下角 HUD 那一塊壓暗一點
  float hud = smoothstep(1300.0, 1420.0, p.x) * smoothstep(780.0, 870.0, p.y);
  col *= 1.0 - 0.3 * hud;
  fragColor = vec4(col, 1.0);
}`;
const BG = () => new FSPass(WALL);

/**
 * 對聯上的一個字塊：一個直立的中文／韓文字，或一個「正立」的英文單字（連同後面的半形標點）。u0..u1 是在整行文字裡的位置。
 * 2026-09-30 主導者：英文整個轉 90° 躺著讀不下去（跟 neonalley 同一條規則），改成直式招牌上的英文排法——一個單字一行、字是正的、
 * 由上往下疊；中文、韓文照舊一字一格直排。
 */
interface VTok { s: string; u0: number; u1: number; latin: boolean; w: number; adv: number }
interface VCol { toks: { tok: VTok; y: number }[]; len: number; w: number }
interface VLay { size: number; cols: VCol[]; gap: number; width: number }

const isLatin = (ch: string) => /[A-Za-z0-9'’&\-.,!?]/.test(ch);
const isPunct = (ch: string) => /[，。、！？：；]/.test(ch);
/** 英文字比中文字看起來大：同一個字級時英文縮一點，兩種字才一樣重。 */
const LAT = 0.9;

/**
 * 排一條對聯上的字：由上往下疊，一欄放不下就往左加一欄（由右往左）；每欄寬 = 欄裡最寬的字塊。
 * 高 ≤ L、總寬 ≤ innerW 才算放得下。先試一欄（字小一點點也好，最多縮到八成五），再試多欄；都放不下回傳 null（交給呼叫的人加寬對聯或再縮字）。
 */
function vlayout(text: string, fam: string, L: number, innerW: number, max: number, min: number, maxCols: number): VLay | null {
  const toks: { s: string; u0: number; u1: number; latin: boolean }[] = [];
  const cps = Array.from(text);
  let u = 0;
  for (let i = 0; i < cps.length;) {
    const ch = cps[i]!;
    if (ch === ' ') {
      // 空白只留在兩個中文／韓文之間（一小段間隔）；英文單字本來就一個一行
      const prev = toks[toks.length - 1], next = cps[i + 1];
      if (prev && !prev.latin && prev.s !== ' ' && next && !isLatin(next)) toks.push({ s: ' ', u0: u, u1: u + 1, latin: false });
      u += 1; i++; continue;
    }
    if (isLatin(ch)) {
      let w = '', u0 = u;
      while (i < cps.length && isLatin(cps[i]!)) { w += cps[i]!; u += cps[i]!.length; i++; }
      toks.push({ s: w, u0, u1: u, latin: true });
      continue;
    }
    toks.push({ s: ch, u0: u, u1: u + ch.length, latin: false });
    u += ch.length; i++;
  }
  const build = (size: number, cap: number, balance: boolean): VLay | null => {
    const mk = (tk: typeof toks[number]): VTok => ({
      ...tk,
      w: tk.s === ' ' ? 0 : tk.latin ? measure(tk.s, fam, size * LAT) : size,
      adv: tk.s === ' ' ? size * 0.3 : tk.latin ? size * 1.02 : size * 1.04,
    });
    const vt = toks.map(mk);
    const total = vt.reduce((a, tk) => a + tk.adv, 0);
    const fill = (LL: number) => {
      const cols: VCol[] = [];
      let col: VCol = { toks: [], len: 0, w: 0 };
      for (const tk of vt) {
        if (tk.s === ' ' && col.toks.length === 0) continue;
        if (col.len + tk.adv > LL && col.toks.length) { cols.push(col); col = { toks: [], len: 0, w: 0 }; if (tk.s === ' ') continue; }
        col.toks.push({ tok: tk, y: col.len });
        col.len += tk.adv;
        col.w = Math.max(col.w, tk.w);
      }
      if (col.toks.length) cols.push(col);
      // 欄尾的空白不算長度
      for (const c of cols) while (c.toks.length && c.toks[c.toks.length - 1]!.tok.s === ' ') c.len -= c.toks.pop()!.tok.adv;
      return cols;
    };
    let cols = fill(L);
    // 兩欄以上時把每欄排得差不多長（不要第二欄只剩一個字）
    if (balance && cols.length > 1) {
      const n = cols.length;
      for (let LL = total / n; LL <= L; LL += size * 0.25) { const cc = fill(LL); if (cc.length <= n) { cols = cc; break; } }
    }
    const gap = size * 0.22;
    const width = cols.reduce((a, c) => a + c.w, 0) + gap * Math.max(0, cols.length - 1);
    if (cols.length > cap || cols.some((c) => c.len > L + 0.5) || width > innerW) return null;
    return { size, cols, gap, width };
  };
  for (let s = Math.floor(max); s >= Math.max(min, max * 0.85); s--) { const r = build(s, 1, false); if (r) return r; }
  for (let s = Math.floor(max); s >= min; s--) { const r = build(s, maxCols, true); if (r) return r; }
  return null;
}

interface Glyph { ch: string; x: number; y: number; t: number }
/** 毛筆：筆尖位置、竹管的方向。 */
interface Brush { x: number; y: number; ang: number }

export default class Couplets extends Scene {
  bg = shared('couplets.bg', BG);
  bgRT = this.track(makeRT(W, H, { depthBuffer: false }));
  bgReady = false;
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 67 + (this.msg?.id ?? 0) * 23) >>> 0;
  b0 = 0;
  beat = 0.5;
  fit: FitResult | null = null;
  ban = { x: 0, y: 0, w: 0, h: 0 };
  banGlyphs: Glyph[] = [];
  sig: { text: string; x: number; y: number; size: number; t: number } | null = null;
  invite: { x: number; y: number } | null = null;
  lyrSize = 52;
  subSize = 34;
  bi = false;
  mainLays = new Map<number, VLay>();
  subLays = new Map<number, VLay>();
  instLays: VLay[] = [];
  /** 對聯的寬度、左聯的 x（整個窗格固定）。 */
  sw = STRIP.minW;
  lx = LEFT_R - STRIP.minW;
  instT0 = 0;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    this.beat = clamp(au.beatPeriod(this.b0), 0.25, 1.2);
    const lines = windowLines(lyrics, s - 4, e + 2);
    const text = m ? m.text : NO_MSG_BANNER;
    const sigText = m ? sigOf(m) : '';
    await loadText(text + sigText + NO_MSG_BANNER + INVITE + INST.join('') + song.title + linesText(lines) + COUPLE_ZH + '囍福上聯下聯橫批' + B2_SYMBOLS);

    // ---- 橫批：留言（沒有留言是「百年好合」四個大字）
    const c = this.live.ctx;
    const padX = 44, padT = 30, padB = 26;
    const reserve = m ? sigV2(msgMaxFor(text)) + 18 : 30;
    this.fit = fitMsgB2(c, text, MSG_FAM, BAN.maxW - padX * 2, BAN.maxH - padT - padB - reserve, { lineHeight: 1.3, maxLines: 4, max: m ? undefined : 60 });
    const fit = this.fit;
    this.lyrSize = lyricV2(m ? fit.size : null);
    this.subSize = Math.max(32, Math.round(this.lyrSize * 0.68));
    const ss = sigV2(fit.size);
    const sigW = m ? measure(sigText, SIG_FAM, ss) : 0;
    const w = Math.min(BAN.maxW, Math.max(fit.width, sigW + 40, m ? 0 : measure(INVITE, F.hei(500), 20)) + padX * 2);
    const h = padT + fit.height + fit.size * 0.25 + (m ? ss * 1.25 : 34) + padB;
    // 橫批貼在門楣上面（下緣貼著門楣）
    this.ban = { x: BAN.cx - w / 2, y: Math.max(BAN.y0, FRAME.y0 - 30 - h), w, h };
    const top = this.ban.y + padT + fit.size * 0.88;
    const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const t0 = this.b0 + 0.1;
    const dur = clamp(0.05 * n + 0.3, 0.5, Math.min(this.beat * 6, 0.3 * (e - s)));
    let k = 0;
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      const x0 = BAN.cx - lay.width / 2;
      for (const g of lay.glyphs) this.banGlyphs.push({ ch: g.ch, x: x0 + g.x, y: top + i * fit.lineHeight, t: t0 + (dur * k++) / Math.max(1, n) });
    });
    const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
    if (m) this.sig = { text: sigText, x: Math.min(this.ban.x + w - padX - sigW, BAN.cx + fit.width / 2 - sigW), y: lastY + fit.size * 0.25 + ss * 1.1, size: ss, t: t0 + dur + 0.15 };
    else this.invite = { x: BAN.cx, y: lastY + fit.size * 0.25 + 26 };

    // ---- 對聯：每一句先排好直排
    this.bi = lines.some((l) => !!lyricSubOf(l));
    // 放不下就先把對聯加寬（每次 10 px，最寬 210），還是放不下才讓中文縮到 30 px；最後的保底是 30 px、不限欄數
    const L = STRIP.y1 - STRIP.y0 - 44;
    const texts = lines.flatMap((l) => [{ i: l.i, main: true, text: l.text }, ...(lyricSubOf(l) ? [{ i: l.i, main: false, text: lyricSubOf(l)!.text }] : [])]);
    const tryAll = (sw: number, mainMin: number) => {
      const main = new Map<number, VLay>(), sub = new Map<number, VLay>();
      for (const x of texts) {
        const r = x.main ? vlayout(x.text, ZH_FAM, L, sw - 26, this.lyrSize, mainMin, 3) : vlayout(x.text, SUB_FAM, L, sw - 26, this.subSize, 30, 3);
        if (!r) return null;
        (x.main ? main : sub).set(x.i, r);
      }
      return { main, sub };
    };
    let got: ReturnType<typeof tryAll> = null;
    for (let sw = STRIP.minW; sw <= STRIP.maxW && !got; sw += 10) { got = tryAll(sw, V2.lyrMin); if (got) this.sw = sw; }
    if (!got) { this.sw = STRIP.maxW; got = tryAll(STRIP.maxW, 30) ?? tryAll(9999, 30); }
    if (got) { this.mainLays = got.main; this.subLays = got.sub; }
    this.lx = LEFT_R - this.sw;
    if (!lyrics.has) {
      this.instLays = INST.map((x) => vlayout(x, ZH_FAM, L, this.sw - 26, 52, 40, 1)!);
      this.instT0 = this.b0;
    }
    this.drawBase();
    this.avoid = [[this.ban.x - 10, this.ban.y - 10, this.ban.w + 20, this.ban.h + 20], [this.lx, STRIP.y0, this.sw, STRIP.y1 - STRIP.y0], [RIGHT_X, STRIP.y0, this.sw, STRIP.y1 - STRIP.y0]];
  }

  /** 紅紙：這首歌的暗紅（固定的紅混一點這首歌的暗部），灑金的小點、邊緣一點點不齊、上緣的膠帶痕。 */
  private redPaper(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
    const rnd = mulberry32(seed);
    c.save();
    c.fillStyle = rgba('ink', 0.45);
    c.fillRect(x + 5, y + 7, w, h);
    c.fillStyle = mixRgba(mixRgba('collar', 'blood', 0.25), 'ink', 0.22, 1);
    c.beginPath();
    c.moveTo(x, y);
    for (let i = 1; i <= 8; i++) c.lineTo(x + (w * i) / 8, y + (rnd() - 0.5) * 2.5);
    for (let i = 1; i <= 16; i++) c.lineTo(x + w + (rnd() - 0.5) * 2.5, y + (h * i) / 16);
    for (let i = 7; i >= 0; i--) c.lineTo(x + (w * i) / 8, y + h + (rnd() - 0.5) * 2.5);
    for (let i = 15; i >= 0; i--) c.lineTo(x + (rnd() - 0.5) * 2.5, y + (h * i) / 16);
    c.closePath();
    c.fill();
    // 灑金：細小的金點
    for (let i = 0; i < (w * h) / 900; i++) {
      c.fillStyle = mixRgba('ember', 'signal', rnd(), 0.18 + 0.3 * rnd());
      c.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 2.2, 1 + rnd() * 2.2);
    }
    // 紙的皺褶：幾條淡淡的橫向亮暗
    for (let i = 0; i < 5; i++) {
      const yy = y + rnd() * h;
      const g = c.createLinearGradient(0, yy - 12, 0, yy + 12);
      g.addColorStop(0, rgba('ink', 0)); g.addColorStop(0.5, rgba('bone', 0.035)); g.addColorStop(1, rgba('ink', 0));
      c.fillStyle = g; c.fillRect(x, yy - 12, w, 24);
    }
    c.restore();
  }

  /** 不動的：門框、兩扇門（木紋、門釘、門縫）、窗與剪紙、兩條對聯與橫批的紅紙。 */
  private drawBase() {
    const c = this.base.ctx;
    const rnd = mulberry32(this.seed ^ 0x77);
    c.save();
    // 門框（深色木頭）與石門檻
    c.fillStyle = mixRgba('ink', 'sepia', 0.35, 1);
    c.fillRect(FRAME.x0, FRAME.y0, FRAME.x1 - FRAME.x0, H - FRAME.y0);
    // 兩扇門：木板直紋（很暗）、左右兩扇之間一條門縫
    const mid = (DOOR.x0 + DOOR.x1) / 2;
    for (const [x0, x1] of [[DOOR.x0, mid - 2], [mid + 2, DOOR.x1]] as const) {
      c.fillStyle = mixRgba('ink2', 'blood', 0.16, 1);
      c.fillRect(x0, DOOR.y0, x1 - x0, DOOR.y1 - DOOR.y0);
      c.strokeStyle = rgba('ink', 0.45); c.lineWidth = 1.2;
      for (let x = x0 + 28; x < x1; x += 55) { c.beginPath(); c.moveTo(x, DOOR.y0); c.lineTo(x, DOOR.y1); c.stroke(); }
      c.strokeStyle = rgba('bone', 0.035); c.lineWidth = 1;
      for (let i = 0; i < 40; i++) { const x = x0 + rnd() * (x1 - x0); c.beginPath(); c.moveTo(x, DOOR.y0 + rnd() * 200); c.lineTo(x + (rnd() - 0.5) * 6, DOOR.y1 - rnd() * 200); c.stroke(); }
      // 門釘：五排、每排四顆（燈光從上面來，每顆上緣亮一點）
      for (let r = 0; r < 5; r++) for (let q = 0; q < 4; q++) {
        const cx = lerp(x0 + 50, x1 - 50, q / 3), cy = DOOR.y0 + 80 + r * 110;
        c.fillStyle = mixRgba('ember', 'sepia', 0.7, 0.9);
        c.beginPath(); c.arc(cx, cy, 8.5, 0, TAU); c.fill();
        c.fillStyle = mixRgba('ember', 'bone', 0.3, 0.35);
        c.beginPath(); c.arc(cx - 2, cy - 3, 3, 0, TAU); c.fill();
      }
    }
    // 門楣（門上的橫樑）
    c.fillStyle = mixRgba('ink', 'sepia', 0.45, 1);
    c.fillRect(FRAME.x0 - 30, FRAME.y0 - 26, FRAME.x1 - FRAME.x0 + 60, 30);
    // 窗：木格（冰裂紋的簡化：直橫格＋對角）、窗紙透一點屋裡的光、中間一張紅剪紙（囍）
    const wx = WIN.x, wy = WIN.y;
    c.fillStyle = mixRgba('ember', 'ink2', 0.82, 1);
    c.fillRect(wx, wy, WIN.w, WIN.h);
    c.strokeStyle = mixRgba('ink', 'sepia', 0.35, 1); c.lineWidth = 6;
    c.strokeRect(wx, wy, WIN.w, WIN.h);
    c.lineWidth = 3;
    c.beginPath();
    for (let i = 1; i < 5; i++) { c.moveTo(wx + (WIN.w * i) / 5, wy); c.lineTo(wx + (WIN.w * i) / 5, wy + WIN.h); }
    for (let i = 1; i < 4; i++) { c.moveTo(wx, wy + (WIN.h * i) / 4); c.lineTo(wx + WIN.w, wy + (WIN.h * i) / 4); }
    c.stroke();
    c.font = font(F.ming(900), 96); c.textAlign = 'center';
    c.fillStyle = mixRgba('collar', 'ink', 0.3, 0.85);
    c.fillText('囍', wx + WIN.w / 2, wy + WIN.h / 2 + 34);
    c.textAlign = 'left';
    // 紅紙
    this.redPaper(c, this.lx, STRIP.y0, this.sw, STRIP.y1 - STRIP.y0, this.seed + 1);
    this.redPaper(c, RIGHT_X, STRIP.y0, this.sw, STRIP.y1 - STRIP.y0, this.seed + 2);
    this.redPaper(c, this.ban.x, this.ban.y, this.ban.w, this.ban.h, this.seed + 3);
    // 對聯上下兩端的金色細框
    c.strokeStyle = mixRgba('ember', 'signal', 0.5, 0.4); c.lineWidth = 1.5;
    for (const x of [this.lx, RIGHT_X]) c.strokeRect(x + 10, STRIP.y0 + 10, this.sw - 20, STRIP.y1 - STRIP.y0 - 20);
    c.strokeRect(this.ban.x + 10, this.ban.y + 10, this.ban.w - 20, this.ban.h - 20);
    if (this.msg) {
      c.font = font(F.mono(500), 12); c.letterSpacing = '3px'; c.fillStyle = mixRgba('ember', 'signal', 0.5, 0.55);
      c.fillText(no3(this.msg.n), this.ban.x + 20, this.ban.y + this.ban.h - 18);
      c.letterSpacing = '0px';
    }
    c.restore();
    this.base.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    if (!this.bgReady) { this.bg.render(renderer, this.bgRT); this.bgReady = true; }
    comp.draw(renderer, this.bgRT.texture, out, { mode: 'replace' });
    comp.draw(renderer, this.base.texture, out, { opacity: prog(t, s, s + 0.3) });

    const L = this.live;
    L.clear();
    const c = L.ctx;
    this.drawLight(c, t, f);
    this.drawKnockers(c, t, f);
    this.drawBanner(c, t);
    if (lyrics.has) this.drawCouplets(c, t);
    else this.drawInst(c, t);
    this.drawLanterns(c, t);
    comp.draw(renderer, L.upload(), out);

    // 鏡頭：從門口慢慢推近（往門的中心），進場時從暗處亮起來
    const zoom = 1.01 + 0.04 * ease.inOutCubic(f.p);
    const roomX = (W - W / zoom) / 2;
    return { popupAvoid: this.avoid, bloom: 0.6, vignette: 0.5, zoom, shake: [-0.55 * roomX, 0], fade: 1 - prog(t, s, s + 0.35) };
  }

  /** 燈籠在牆上的光（跟著燈籠晃）、門縫透出來的屋裡的暖光（跟著低音一明一暗）。 */
  private drawLight(c: CanvasRenderingContext2D, t: number, f: Frame) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    LANTERNS.forEach((ln, i) => {
      const a = this.swing(t, i);
      const px = ln.x + Math.sin(a) * 190, py = ln.y + Math.cos(a) * 190;
      const g = c.createRadialGradient(px, py, 20, px, py, 620);
      g.addColorStop(0, mixRgba('ember', 'collar', 0.5, 0.2)); g.addColorStop(0.4, mixRgba('signal', 'collar', 0.5, 0.06)); g.addColorStop(1, rgba('ink', 0));
      c.fillStyle = g; c.fillRect(px - 620, py - 620, 1240, 1240);
    });
    const mid = (DOOR.x0 + DOOR.x1) / 2;
    const k = 0.55 + 0.45 * clamp(f.a.bass * 1.3);
    const g = c.createLinearGradient(mid - 18, 0, mid + 18, 0);
    g.addColorStop(0, rgba('ember', 0)); g.addColorStop(0.5, mixRgba('ember', 'signal', 0.4, 0.32 * k)); g.addColorStop(1, rgba('ember', 0));
    c.fillStyle = g; c.fillRect(mid - 18, DOOR.y0, 36, DOOR.y1 - DOOR.y0);
    c.fillStyle = mixRgba('ember', 'bone', 0.3, 0.5 * k);
    c.fillRect(mid - 1, DOOR.y0, 2, DOOR.y1 - DOOR.y0);
    // 門檻前地上的一小片光
    const g2 = c.createRadialGradient(mid, H, 10, mid, H, 220);
    g2.addColorStop(0, mixRgba('ember', 'signal', 0.4, 0.08 * k)); g2.addColorStop(1, rgba('ember', 0));
    c.fillStyle = g2; c.fillRect(mid - 220, H - 220, 440, 220);
    c.restore();
  }

  /** 燈籠的擺角：每拍輕輕一晃，每個小節線被風吹大一點（彈簧），兩盞相位錯開。 */
  private swing(t: number, i: number) {
    const au = this.ctx.audio;
    const bi = Math.floor(au.barAt(t) + 1e-4), tb = au.timeOfBar(bi), age = t - tb;
    const gust = tb >= this.b0 - 0.01 ? Math.exp(-age * 1.6) * Math.sin(age * 5.2 + i * 0.6) * 0.16 : 0;
    const bp = au.beatAt(t) % 1;
    return 0.035 * Math.sin((au.beatAt(t) + i * 0.5) * Math.PI) + gust + 0.02 * Math.sin(t * 0.9 + i) + 0.01 * (1 - bp);
  }

  /** 兩盞燈籠：扁圓的紅燈籠、上下金色的蓋、裡面的燭光（閃一閃）、下面的穗子（晚一點跟著晃）。 */
  private drawLanterns(c: CanvasRenderingContext2D, t: number) {
    LANTERNS.forEach((ln, i) => {
      const a = this.swing(t, i);
      c.save();
      c.translate(ln.x, ln.y);
      c.rotate(-a);
      c.strokeStyle = mixRgba('ink', 'sepia', 0.4, 1); c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, -80); c.lineTo(0, 110); c.stroke();
      c.translate(0, 190);
      const flick = 0.85 + 0.15 * Math.sin(t * 13 + i * 3) * Math.sin(t * 7.3 + i);
      // 燈身：紅色的扁圓，中間亮（燭光透出來）、邊緣暗，直的骨架線
      const g = c.createRadialGradient(0, 0, 10, 0, 0, 96);
      g.addColorStop(0, mixRgba('ember', 'collar', 0.35, 1)); g.addColorStop(0.55, mixRgba('collar', 'blood', 0.2, 1)); g.addColorStop(1, mixRgba('collar', 'ink', 0.55, 1));
      c.globalAlpha = 1;
      c.fillStyle = g;
      c.beginPath(); c.ellipse(0, 0, 96, 78, 0, 0, TAU); c.fill();
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = mixRgba('ember', 'signal', 0.4, 0.22 * flick);
      c.beginPath(); c.ellipse(0, 4, 60, 50, 0, 0, TAU); c.fill();
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = mixRgba('collar', 'ink', 0.5, 0.6); c.lineWidth = 1.4;
      for (const k of [-0.66, -0.33, 0, 0.33, 0.66]) { c.beginPath(); c.ellipse(0, 0, 96 * Math.abs(k) + 0.01, 78, 0, -Math.PI / 2, Math.PI / 2, k < 0); c.stroke(); }
      c.fillStyle = mixRgba('ember', 'sepia', 0.55, 1);
      c.fillRect(-34, -86, 68, 14); c.fillRect(-34, 72, 68, 14);
      // 穗子：跟著燈晃，再晚一點點（多轉一點）
      c.save();
      c.translate(0, 86);
      c.rotate(a * 0.8);
      c.strokeStyle = mixRgba('collar', 'blood', 0.3, 0.9); c.lineWidth = 2;
      for (let k = -4; k <= 4; k++) { c.beginPath(); c.moveTo(k * 2, 0); c.lineTo(k * 3, 70 + 4 * hash(k, i)); c.stroke(); }
      c.fillStyle = mixRgba('ember', 'sepia', 0.55, 1); c.fillRect(-7, 0, 14, 10);
      c.restore();
      c.restore();
    });
  }

  /** 門環：大鼓時晃一下（銅環、上面的獸面座簡化成圓座）。 */
  private drawKnockers(c: CanvasRenderingContext2D, t: number, f: Frame) {
    const mid = (DOOR.x0 + DOOR.x1) / 2;
    const k = f.a.kick;
    c.save();
    for (const [x, ph] of [[mid - 70, 0], [mid + 70, 1.3]] as const) {
      const a = 0.18 * k * Math.sin(t * 16 + ph);
      c.save();
      c.translate(x, 700);
      c.fillStyle = mixRgba('ember', 'sepia', 0.6, 1);
      c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.fill();
      c.fillStyle = mixRgba('ember', 'bone', 0.3, 0.3);
      c.beginPath(); c.arc(-5, -6, 7, 0, TAU); c.fill();
      c.rotate(a);
      c.strokeStyle = mixRgba('ember', 'sepia', 0.5, 1); c.lineWidth = 7;
      c.beginPath(); c.arc(0, 50, 34, 0, TAU); c.stroke();
      c.strokeStyle = mixRgba('ember', 'bone', 0.3, 0.35); c.lineWidth = 2;
      c.beginPath(); c.arc(0, 50, 34, Math.PI * 1.1, Math.PI * 1.5); c.stroke();
      c.restore();
    }
    c.restore();
  }

  /** 橫批：留言一個字一個字寫上去（燙金），寫完署名；沒有留言是「百年好合」＋一行小字邀請。 */
  private drawBanner(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit;
    if (!fit) return;
    c.save();
    c.font = font(MSG_FAM, fit.size);
    c.textBaseline = 'alphabetic';
    for (const g of this.banGlyphs) {
      const q = prog(t, g.t - 0.02, g.t + 0.18);
      if (q <= 0) { c.fillStyle = mixRgba('ember', 'signal', 0.5, 0.14); c.fillText(g.ch, g.x, g.y); continue; }
      if (g.ch === '♥') { drawHeart(c, g.x + fit.size * 0.45, g.y - fit.size * 0.33, fit.size * 0.72 * (0.6 + 0.4 * q)); continue; }
      c.fillStyle = t < g.t + 0.4 ? rgba('signal', 0.98) : this.gold(0.96);
      // 由上往下擦亮（毛筆寫下去）
      c.save();
      c.beginPath(); c.rect(g.x - 4, g.y - fit.size, fit.size * 1.3, fit.size * 1.25 * q); c.clip();
      c.fillText(g.ch, g.x, g.y);
      c.restore();
    }
    if (this.sig && t >= this.sig.t) {
      c.globalAlpha = prog(t, this.sig.t, this.sig.t + 0.4);
      c.font = font(SIG_FAM, this.sig.size); c.fillStyle = this.gold(0.85);
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
    }
    if (this.msg?.couple) {
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.3);
      c.font = font(F.mono(500), 12); c.letterSpacing = '4px'; c.fillStyle = this.gold(0.7);
      c.fillText('FROM THE COUPLE · 新人', this.ban.x + this.ban.w - 230, this.ban.y + this.ban.h - 18);
      c.letterSpacing = '0px';
    }
    if (this.invite) {
      c.globalAlpha = prog(t, this.b0 + 0.6, this.b0 + 1);
      c.font = font(F.hei(500), 20); c.letterSpacing = '2px'; c.fillStyle = this.gold(0.7); c.textAlign = 'center';
      c.fillText(INVITE, this.invite.x, this.invite.y);
      c.letterSpacing = '0px';
    }
    c.restore();
  }

  /** 燙金的顏色（這首歌的亮部混一點紙白）。 */
  private gold(a: number) { return mixRgba(mixRgba('ember', 'signal', 0.35), 'bone', 0.2, a); }

  /**
   * 兩條對聯。有翻譯：右邊上聯是這一句中文、左邊下聯是它的原文，一起換句；
   * 沒翻譯：一句寫右邊、下一句寫左邊，輪流（每條留著自己最近的那一句）。
   */
  private drawCouplets(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    const ls = lyrics.lines;
    // 某一條對聯現在顯示哪一句：條件內最近一句（提早 0.4 秒換上淡淡的描線）
    const latest = (ok: (l: Line) => boolean) => { let r: Line | null = null; for (const l of ls) if (ok(l) && l.start - 0.4 <= t) r = l; return r; };
    const inK = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.5);
    let brush: Brush | null = null;
    if (this.bi) {
      const line = latest(() => true);
      if (!line) return;
      const lay = this.mainLays.get(line.i);
      const sub = lyricSubOf(line), sl = this.subLays.get(line.i);
      const a = inK * this.swap(t, line, ls);
      if (lay) brush = this.drawStrip(c, lay, line, t, RIGHT_X, a, ZH_FAM);
      if (sub && sl) this.drawStrip(c, sl, sub, t, this.lx, a, SUB_FAM);
    } else {
      for (const [x, par] of [[RIGHT_X, 0], [this.lx, 1]] as const) {
        const line = latest((l) => l.i % 2 === par);
        if (!line) continue;
        const lay = this.mainLays.get(line.i);
        if (!lay) continue;
        const h = this.drawStrip(c, lay, line, t, x, inK * this.swap(t, line, ls.filter((l) => l.i % 2 === par)), ZH_FAM);
        if (h) brush = h;
      }
    }
    this.drawBrush(c, t, brush);
  }

  /** 換句：這一句要被下一句換掉之前 0.25 秒淡出。 */
  private swap(t: number, line: Line, pool: Line[]) {
    const nx = pool.find((l) => l.start > line.start);
    return nx ? 1 - prog(t, nx.start - 0.62, nx.start - 0.42) : 1;
  }

  /**
   * 一條對聯上的字：先是淡淡的金色描線，唱到的字寫實（正在寫是訊號色、寫好是金色）——中文、韓文由上往下，英文單字由左往右。
   * 兩欄以上由右往左排、整組在紅紙上置中。回傳毛筆的位置：筆尖在整組字的外側（右聯在右邊、左聯在左邊）、跟正在寫的字同高，
   * 筆身往外上方伸出去，不壓到任何一個字。
   */
  private drawStrip(c: CanvasRenderingContext2D, lay: VLay, line: Line, t: number, x0: number, a: number, fam: string, pOverride?: number[]): Brush | null {
    if (a <= 0) return null;
    const p = pOverride ?? charProgress(line, t);
    const L = STRIP.y1 - STRIP.y0;
    const right = x0 + this.sw / 2 + lay.width / 2, left = right - lay.width;
    let head: number | null = null;
    c.save();
    c.globalAlpha = a;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let xr = right;
    for (const col of lay.cols) {
      const cx = xr - col.w / 2;
      xr -= col.w + lay.gap;
      const y0 = STRIP.y0 + (L - col.len) / 2;
      for (const { tok, y } of col.toks) {
        if (tok.s === ' ') continue;
        let q = 0;
        for (let u = tok.u0; u < tok.u1; u++) q += p[u] ?? 0;
        q /= Math.max(1, tok.u1 - tok.u0);
        const cy = y0 + y + tok.adv / 2;
        if (tok.latin) {
          c.font = font(fam, lay.size * LAT);
          this.inkGlyph(c, tok.s, cx, cy, tok.w, lay.size, q, true);
        } else {
          c.font = font(fam, lay.size);
          // 全形標點在直排裡放在格子的右上角
          const pu = isPunct(tok.s) ? [lay.size * 0.55, -lay.size * 0.55] : [0, 0];
          this.inkGlyph(c, tok.s, cx + pu[0]!, cy + pu[1]!, lay.size, lay.size, q, false);
        }
        if (q > 0 && q < 1) head = cy;
      }
    }
    c.restore();
    if (head === null) return null;
    const isRight = x0 === RIGHT_X;
    return { x: isRight ? right + 10 : left - 10, y: head, ang: isRight ? -1.0 : Math.PI + 1.0 };
  }

  /** 一個字塊：淡淡的描線，寫到的部分寫實（中文由上往下、英文由左往右）。w 是字塊的寬（中文就是字級）。 */
  private inkGlyph(c: CanvasRenderingContext2D, s: string, x: number, y: number, w: number, size: number, q: number, lr: boolean) {
    if (q < 1) { c.fillStyle = mixRgba('ember', 'signal', 0.5, 0.3); c.fillText(s, x, y); }
    if (q <= 0) return;
    c.save();
    c.beginPath();
    if (lr) c.rect(x - w / 2 - 3, y - size, (w + 6) * q, size * 2);
    else c.rect(x - w, y - size * 0.62, w * 2, size * 1.24 * q);
    c.clip();
    c.fillStyle = q < 1 ? rgba('signal', 0.98) : this.gold(0.97);
    c.fillText(s, x, y);
    c.restore();
  }

  /** 毛筆：筆尖在 (x, y)（整組字的外側），竹管沿 ang 往外上方伸；沒在寫的時候不出現。 */
  private drawBrush(c: CanvasRenderingContext2D, t: number, b: Brush | null) {
    if (!b) return;
    c.save();
    c.translate(b.x, b.y);
    c.rotate(b.ang + 0.05 * Math.sin(t * 9));
    c.fillStyle = rgba('ink', 0.3);
    c.beginPath(); c.roundRect(10, 6, 240, 12, 6); c.fill();
    // 筆毛（墨黑、尖）、筆頭的束口、竹管
    c.fillStyle = rgba('ink', 0.95);
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(18, -9, 44, -8); c.lineTo(44, 8); c.quadraticCurveTo(18, 9, 0, 0); c.fill();
    c.fillStyle = mixRgba('ember', 'sepia', 0.55, 1);
    c.fillRect(44, -8, 12, 16);
    c.fillStyle = mixRgba('ash', 'sepia', 0.35, 1);
    c.beginPath(); c.roundRect(56, -6, 196, 12, 5); c.fill();
    c.fillStyle = rgba('bone', 0.2); c.fillRect(60, -4, 188, 2.5);
    c.strokeStyle = mixRgba('ash', 'ink', 0.5, 0.6); c.lineWidth = 1;
    for (const k of [120, 190]) { c.beginPath(); c.moveTo(k, -6); c.lineTo(k, 6); c.stroke(); }
    c.restore();
  }

  /** 純音樂：一副固定的喜聯，從第一拍起一拍寫一個字（先上聯、再下聯）。 */
  private drawInst(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const k = au.beatAt(t) - au.beatAt(this.instT0);
    const inK = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.5);
    let head: Brush | null = null;
    INST.forEach((txt, si) => {
      const lay = this.instLays[si];
      if (!lay) return;
      const n = Array.from(txt).length;
      const p = Array.from(txt).map((_, i) => clamp(k - si * n - i));
      const fake = { text: txt, words: [], start: 0, end: 0, i: 0 } as unknown as Line;
      const h = this.drawStrip(c, lay, fake, t, si === 0 ? RIGHT_X : this.lx, inK, ZH_FAM, p);
      if (h) head = h;
    });
    this.drawBrush(c, t, head);
  }
}
