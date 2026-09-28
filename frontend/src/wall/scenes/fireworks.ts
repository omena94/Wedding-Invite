// 煙火（照 pdoom 的 fuse 與 outro：火花點燃引信、最後炸開）。
// 夜裡的港口：一條細細的地平線、遠方細線畫的城市（摩天輪、懸索橋、塔頂的航空燈踩在小節線上閃），下面是會倒映火花的水面。
//  - 開場：仙女棒的火花從左邊沿著地平線跑過去，把線畫出來，跑到第一發的位置就把它點燃。
//  - 主打留言：排好字（霞鶩文楷）後一行一發：火箭在拍點上離地、升空一兩拍、在拍點上爆開，
//    主殼朝那一行的每個字丟出一顆彗星，彗星到了就在那裡開成那個字（由中間往兩邊「啪啪啪」地開）；
//    字從燒紅冷卻成紙白，停到讀得完；最後一發爆完，一顆星彈出去把署名寫上。
//    停留期間每個小節在遠方低空放一發小的（畫在字後面、比較暗），畫面一直有東西在動但不搶字。
//    窗格最後：一條引信照閱讀順序跑過整則留言（pdoom 的 fuse），字燒紅、化掉，火星像柳樹一樣垂下來。
//    窗格比需要的長很多的話，讀完就先燒掉，後面換歌詞煙火。
//  - 沒有留言：歌詞沿著地平線（水面上那一條）逐字跟唱；一段詞一唱出口，火箭就從那段詞的正上方離地，
//    唱完的下一拍在天上炸成那段詞（天上的字永遠是已經唱過的，不會跑在歌聲前面）。
//  - 沒有留言也沒有歌詞（間奏）：炸出新人的名字、愛心（點綴色，只有這裡）、日期，水面上寫一句邀請大家掃 QR。
// 克制：火藥是細線與火星（pdoom 的 sparkParticles 那種），不是發光的星雲；只有訊號色會發光，字本身是銳利的紙白。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, SCALE, makeRT, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, type TextLayout } from '../engine/type';
import { HEX, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog, pulse } from '../engine/util';
import { fitText, readSeconds } from '../engine/text';
import type { Line, Word } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, beatAfter, barAfter, signature, COUPLE_EN, COUPLE_ZH, DATE_DOTS, type LyricStyle } from './_motifs';
import { HZ, SKY_PASS, drawSkyline, type Light } from './fireworks-sky';
import { type Shell, type SkyGlyph, type Kind, sampleStars, planGlyphs, rocketAt, drawRocket, drawCrown, drawComets, drawStars, drawEmbers, expand, drawGlyphHeart } from './fireworks-shells';

/**
 * 天上排字的範圍：下面留給城市輪廓；右邊（x ≥ 1378）整條空出來給即時留言小卡（右上、右中兩格）和高度尺，
 * 小卡才不會蓋到天上的字。字的區塊因此偏左（瑞士網格的不對稱，右邊是儀器）。
 */
const SKY = { x0: 170, x1: 1350, y0: 176, y1: 664 };
const SKY_CX = (SKY.x0 + SKY.x1) / 2;
/** 歌詞：地平線下面、水面上那條帶子；右邊停在 QR 區（x ≥ 1360）之前。 */
const LYR = { x: 160, y: 884, maxW: 1170 };
const LSTYLE: LyricStyle = { family: F.archivo(100, 800), size: 58, minSize: 48, maxWidth: LYR.maxW };
/** 高度尺：地平線是 0 m，每 2 px 一公尺（冷面的儀器讀數）。 */
const RULER = { x: 1752, top: 200 };
/** 字從燒紅冷卻到紙白要幾秒。 */
const COOL = 0.9;
/** 間奏（沒有留言也沒有歌詞）時水面上的一句邀請。 */
const INVITE = '掃描右下角 QR code，你的祝福也會在這裡綻放。';

interface Phrase { words: Word[]; text: string; start: number; end: number }

/**
 * 引信：結束時一顆火花照閱讀順序跑過天上的字（pdoom 的 fuse：火花經過，字燒紅、化成灰掉下來）。
 * pts：每個字的中心與火花到達的時間。
 */
interface Fuse { pts: { x: number; y: number; t: number }[] }

/** 署名：最後一發爆開後，一顆星彈出去（彗星），落在署名的位置，像仙女棒一樣把它寫出來。 */
interface Sig { lay: TextLayout; x: number; y: number; from: { x: number; y: number }; t0: number; tw: number; t1: number; tg: number }

/**
 * 一行歌詞切成幾段「一發」：大約一小節一段，在空白、標點處斷最好；中文一字算一、英文一個字母算半個。
 */
function groupPhrases(line: Line, barDur: number): Phrase[] {
  const ws = line.words;
  if (!ws.length) return [];
  const n = clamp(Math.round((line.end - line.start) / barDur), 1, Math.min(4, ws.length));
  const wt = ws.map((w) => (/\p{Script=Latin}/u.test(w.w) ? Math.max(1, w.w.replace(/[^\p{L}\p{N}]/gu, '').length * 0.45) : Math.max(0.3, Array.from(w.w.replace(/[\s\p{P}]/gu, '')).length)));
  const total = wt.reduce((a, b) => a + b, 0);
  const cum = [0];
  for (const x of wt) cum.push(cum[cum.length - 1]! + x);
  const cuts: number[] = [0];
  for (let j = 1; j < n; j++) {
    const target = (j * total) / n;
    let best = -1, bestC = Infinity;
    for (let b = cuts[cuts.length - 1]! + 1; b <= ws.length - (n - j); b++) {
      const prev = ws[b - 1]!, gap = line.text.slice(prev.o + prev.w.length, ws[b]!.o);
      const natural = /\s/.test(gap) || /[\p{P}]$/u.test(prev.w);
      const cst = Math.abs(cum[b]! - target) - (natural ? 1.6 : 0);
      if (cst < bestC) { bestC = cst; best = b; }
    }
    if (best > 0) cuts.push(best);
  }
  cuts.push(ws.length);
  const out: Phrase[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = ws[cuts[k]!]!, b = ws[cuts[k + 1]! - 1]!;
    const words = ws.slice(cuts[k]!, cuts[k + 1]!);
    out.push({ words, text: line.text.slice(a.o, b.o + b.w.length).trim(), start: a.start, end: b.end });
  }
  return out;
}

/** '#rrggbb' → [r, g, b]（每一格讀一次色票，主題換了也跟著變）。 */
const rgbOf = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export default class Fireworks extends Scene {
  bg = shared('fireworks.sky', SKY_PASS);
  /** 字（紙白、銳利）與它燒紅時的光（低解析度、加亮疊上去才會發光）。 */
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  /** 遠方的煙火與城市（畫在字後面）、近處的火藥（畫在字前面）。 */
  back = this.track(new LineBatch(6000, { screen2D: true, blend: 'add' }));
  front = this.track(new LineBatch(16000, { screen2D: true, blend: 'add' }));
  /** 火花那一層的半解析度副本：水面取樣它當倒影。 */
  refl = this.track(makeRT(W, H, { pxScale: SCALE * 0.5, depthBuffer: false }));
  msg: Msg | null = this.ctx.params.message ?? null;
  shells: Shell[] = [];
  sig: Sig | null = null;
  beat = 0.5;
  /** 開場的地平線火花：在 tIgn 跑到 ignX（第一發的位置）把它點燃；沒有要點的就一路跑過去。 */
  tIgn = 0; ignX = W;
  header = '';
  /** 整個窗格沒有留言也沒有歌詞：水面上放一句邀請。 */
  invite = false;
  emberFrac = 0.4;
  fuses: Fuse[] = [];
  /** 這一格有沒有東西畫進發光層：沒有就不上傳（停留期間大部分的格都是這樣，省一張貼圖上傳）。 */
  hotUsed = false;
  /** 整個窗格會出現重要文字的範圍（天上的字、署名、水面上的歌詞）：即時小卡挑位置時避開。init() 算好。 */
  avoid: [number, number, number, number][] = [];
  seed = 1;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.seed = ((this.ctx.params.seed ?? 1) * 7919 + Math.round(s * 100)) >>> 0;
    const rnd = mulberry32(this.seed);
    const beat = (this.beat = au.beatPeriod(s + 0.01));
    // 窗格很短（約三小節以內）：少了開場的點火戲，第一拍就發射、升空一拍，留時間給人讀
    const tight = e - s < 6.2;
    // 升空時間：快歌兩拍、慢歌一拍（都在 0.7～1.2 秒之間，看起來像真的火箭），爆開一定落在拍點上
    const riseB = beat < 0.65 && !tight ? 2 : 1;
    const T = clamp(0.4 + beat * 0.35, 0.5, 0.78);
    const dissolve = clamp(beat * 2.6, 1.0, 1.8) * (tight ? 0.75 : 1);
    const bi = Math.ceil(au.beatAt(s + 0.02) - 1e-6);
    // 第一發在第二拍（讓地平線的火花有一拍跑過去點火）；窗格很短就直接第一拍
    const L0 = tight ? bi : bi + 1;
    const c = this.layer.ctx;
    const shell = (kind: Kind, o: Partial<Shell> & Pick<Shell, 'tl' | 'tb' | 'cx' | 'cy' | 'R'>): Shell => {
      const sh: Shell = {
        id: this.shells.length + 1 + (this.seed % 97) * 131, kind, back: false, I: 1, tf0: Infinity, lx: o.cx, T, Tg: clamp(T * 0.62, 0.3, 0.45),
        glyphs: [], stars: null, starBudget: 800, glow: 1, box: { x0: o.cx - o.R, y0: o.cy - o.R, x1: o.cx + o.R, y1: o.cy + o.R }, ...o,
      };
      planGlyphs(sh);
      this.shells.push(sh);
      return sh;
    };
    const launchX = (cx: number) => clamp(cx + (rnd() - 0.5) * 380, 220, 1690);
    // 排版前先把會用到的字都載好（天上的歌詞、署名、介面字），不然 fitText 量到的是備援字的寬度
    const lyricLines = lyrics.linesIn(s, e);
    await loadText(`施放許可共發風向東北能見度良好歌詞煙火高度掃描右下角你的祝福也會在這裡綻放${COUPLE_ZH}${song.title}${signature(this.msg?.name ?? '')}${lyricLines.map((l) => l.text).join('')}`);

    let encoreFrom = Infinity;
    if (this.msg) {
      // ---------------------------------------------------------------- 主打留言：一行一發
      const m = this.msg, fam = F.hand(700);
      const fit = fitText(c, m.text, fam, SKY.x1 - SKY.x0, 400, { min: 56, max: 200, lineHeight: 1.2, maxLines: 4 });
      const sigS = clamp(Math.round(fit.size * 0.42), 44, 60);
      const top = SKY.y0 + (SKY.y1 - SKY.y0 - (fit.height + sigS * 1.7)) / 2;
      const bx = SKY_CX - fit.width / 2, base0 = top + fit.size * 0.9;
      const n = fit.lines.length, need = readSeconds(m.text);
      // 節奏：一小節一發；行數多、或窗格不夠讀完，就改成兩拍、一拍一發（整則留言要在一兩小節內出齊）
      let cad = 1;
      for (const cd of [4, 2, 1]) {
        if (n * cd > 8 && cd > 1) continue;
        cad = cd;
        if (au.timeOfBeat(L0 + (n - 1) * cd + riseB) + T + 1.2 + need <= e - dissolve) break;
      }
      const lines = fit.lines.map((ln, i) => {
        const lay = layout(ln, fam, fit.size);
        const y = base0 + i * fit.lineHeight;
        const glyphs: SkyGlyph[] = lay.glyphs.filter((g) => g.ch.trim()).map((g) => ({ ch: g.ch, x: bx + g.x, y, w: g.w, size: fit.size, fam, heart: g.ch === '♥', tg: Infinity, cx: 0, cy: 0, tb: 0 }));
        const cx = bx + lay.width / 2, cy = y - fit.size * 0.36;
        return shell('text', {
          tl: au.timeOfBeat(L0 + i * cad), tb: au.timeOfBeat(L0 + i * cad + riseB), cx, cy, lx: launchX(cx),
          R: clamp(0.3 * Math.hypot(lay.width / 2, fit.size), 150, 280), glyphs, starBudget: 900,
          box: { x0: bx, y0: y - fit.size * 0.95, x1: bx + lay.width, y1: y + fit.size * 0.2 },
        });
      });
      if (!tight) { this.tIgn = lines[0]!.tl; this.ignX = lines[0]!.lx; }
      this.emberFrac = clamp(800 / (900 * n), 0.1, 0.26);
      // 署名：最後一發爆開、星點停好之後，一顆星彈出去把它寫上（靠右，跟留言的右緣對齊）
      const last = lines[lines.length - 1]!;
      const slay = layout(signature(m.name), F.hand(400), sigS);
      const t0 = last.tb + T * (tight ? 0.4 : 0.75), tw = t0 + (tight ? 0.22 : 0.34);
      this.sig = {
        lay: slay, x: Math.max(bx, bx + fit.width - slay.width), y: base0 + (n - 1) * fit.lineHeight + sigS * 1.7,
        from: { x: last.cx, y: last.cy }, t0, tw, t1: tw + clamp(0.06 * slay.glyphs.length + 0.35, 0.5, tight ? 0.7 : 1.2), tg: Infinity,
      };
      // 停留：讀得完為止；窗格比需要的長很多（超過四小節）就先收掉，後面換歌詞煙火
      const ready = this.sig.t1;
      // 時間夠的話引信慢一點（最多 2.4 秒），看得出火花在字上跑
      const burn = clamp(e - (ready + need), dissolve, Math.max(dissolve, 2.4));
      let tf0 = e - burn;
      // 讀完之後還多出兩小節以上（短留言排到長窗格）：先燒掉，後面換歌詞煙火，不要讓天空一直停著
      if (tf0 - (ready + need + 4 * beat) > 8 * beat) { tf0 = barAfter(au, ready + need + 4 * beat); encoreFrom = tf0 + 2.4; }
      // 燒完：一條引信照閱讀順序跑過整則留言，最後燒到署名（每個字燒掉約 0.35 秒，都要在窗格結束前燒完）
      const fz = this.fuse(lines.flatMap((sh) => sh.glyphs), tf0, Math.max(0.3, Math.min(e, tf0 + burn) - tf0 - 0.55));
      lines.forEach((sh) => { sh.tf0 = sh.glyphs[0]?.tg ?? tf0; });
      this.sig.tg = (fz.pts[fz.pts.length - 1]?.t ?? tf0) - 0.1;
      this.header = `施放許可 No.${String(m.n).padStart(3, '0')}　·　共 ${n} 發　·　風向 東北　·　能見度 良好${m.couple ? '　·　FROM THE COUPLE' : ''}`;
    } else {
      this.header = lyricLines.length ? `施放許可　·　歌詞煙火　·　♪ ${song.title}` : `施放許可　·　${DATE_DOTS}　·　${COUPLE_EN.toUpperCase()}`;
    }

    // ---------------------------------------------------------------- 歌詞煙火：唱出口就點火，唱完的下一拍炸開
    const echoFrom = this.msg ? encoreFrom : s;
    if (echoFrom < e - 1.5) {
      const echo: Shell[] = [];
      // 歌詞的聲音（Archivo／思源黑體），但用 700 不用 900：火花組成的字細一點比較精緻，墨少光也不會糊成一團
      const fam = F.archivo(100, 700);
      for (const line of lyrics.linesIn(echoFrom, e)) {
        const ll = layoutLyric(c, line, LSTYLE);
        for (const [pi, ph] of groupPhrases(line, 4 * beat).entries()) {
          if (!ph.text || ph.end < echoFrom + 0.3 || (this.msg && ph.start < echoFrom)) continue;
          let tl = Math.max(ph.start, echoFrom + 0.1);
          const tb = beatAfter(au, Math.max(ph.end - 0.04, tl + 0.55));
          if (tb - tl > 1.5) tl = tb - 1.5;
          if (tb + T + 0.9 > e - 0.25) continue;
          // 這段詞在地平線上的位置：火箭從它正上方離地
          const pw = ll.words.filter((w) => ph.words.includes(w.word));
          const hx = LYR.x + (pw.length ? (pw[0]!.x + pw[pw.length - 1]!.x + pw[pw.length - 1]!.w) / 2 : 300);
          // 兩排輪流（上一段燒完前下一段已經開了）：一行詞的第一段在上排、第二段在下排，由上往下讀；
          // 字級壓在 150 以內，兩排才不會疊在一起
          const fit = fitText(c, ph.text, fam, 1150, 170, { min: 72, max: 140, lineHeight: 1.08, maxLines: 2 });
          const row = pi % 2;
          const cy = (row === 0 ? 292 : 530) + (rnd() - 0.5) * 30;
          const cx = clamp(hx + (rnd() - 0.5) * 260, SKY.x0 + fit.width / 2 + 10, SKY.x1 - fit.width / 2 - 10);
          const base0 = cy - fit.height / 2 + fit.size * 0.84;
          const glyphs: SkyGlyph[] = [];
          fit.lines.forEach((ln, i) => {
            const lay = layout(ln, fam, fit.size);
            for (const g of lay.glyphs) if (g.ch.trim()) glyphs.push({ ch: g.ch, x: cx - lay.width / 2 + g.x, y: base0 + i * fit.lineHeight, w: g.w, size: fit.size, fam, heart: g.ch === '♥', tg: Infinity, cx: 0, cy: 0, tb: 0 });
          });
          echo.push(shell('text', {
            tl, tb, cx, cy, lx: clamp(hx, 200, 1700), R: clamp(0.3 * Math.hypot(fit.width / 2, fit.size), 150, 280), glyphs, starBudget: 760, glow: 0.55,
            box: { x0: cx - fit.width / 2, y0: cy - fit.height / 2 - 10, x1: cx + fit.width / 2, y1: cy + fit.height / 2 + 10 },
          }));
        }
      }
      // 前一段在下一段停好之後才開始燒完：天上一直有一段讀得到的詞
      echo.forEach((sh, i) => {
        const nx = echo[i + 1];
        const tf0 = nx ? Math.max(sh.tb + T + 1.3, nx.tb + T + 0.25) : sh.tb + T + Math.max(2.4, 8 * beat);
        this.dissolveAt(sh, Math.min(tf0, e - dissolve));
      });
    }

    // ---------------------------------------------------------------- 間奏（沒有留言也沒有歌詞）：新人的名字、愛心、日期
    if (!this.msg && !lyricLines.length) {
      this.invite = true;
      const items: ({ text: string; fam: string; max: number } | Kind)[] = [
        { text: COUPLE_EN, fam: F.serif(600, true), max: 190 }, 'heart', { text: DATE_DOTS, fam: F.serif(600), max: 150 },
        'willow', { text: COUPLE_ZH, fam: F.ming(900), max: 170 }, 'ring', 'peony',
      ];
      let k = 0;
      for (let b = L0; au.timeOfBeat(b + riseB) + T + 1.6 < e; b += 4, k++) {
        const it = items[k % items.length]!;
        const tl = au.timeOfBeat(b), tb = au.timeOfBeat(b + riseB);
        const cx = SKY_CX + (k % 2 ? 180 : -180) + (rnd() - 0.5) * 100, cy = 330 + (rnd() - 0.5) * 80;
        if (typeof it === 'string') {
          const R = it === 'heart' ? 150 : 230 + rnd() * 90, p = this.spot(tb, R, rnd);
          const sh = shell(it, { tl, tb, cx: p.x, cy: p.y, lx: launchX(p.x), R });
          if (it === 'heart') this.dissolveAt(sh, Math.min(e - dissolve, tb + T + 1.6));
          continue;
        }
        const fit = fitText(c, it.text, it.fam, 1100, 220, { min: 90, max: it.max, maxLines: 1 });
        const lay = layout(fit.lines[0]!, it.fam, fit.size);
        const x0 = clamp(cx - lay.width / 2, SKY.x0, SKY.x1 - lay.width), y = cy + fit.size * 0.34;
        const glyphs = lay.glyphs.filter((g) => g.ch.trim()).map((g) => ({ ch: g.ch, x: x0 + g.x, y, w: g.w, size: fit.size, fam: it.fam, heart: false, tg: Infinity, cx: 0, cy: 0, tb: 0 }));
        const sh = shell('text', {
          tl, tb, cx: x0 + lay.width / 2, cy, lx: launchX(x0 + lay.width / 2), R: clamp(0.3 * Math.hypot(lay.width / 2, fit.size), 150, 280), glyphs, starBudget: 760, glow: 0.7,
          box: { x0, y0: y - fit.size, x1: x0 + lay.width, y1: y + fit.size * 0.25 },
        });
        this.dissolveAt(sh, Math.min(e - dissolve, tb + T + Math.max(2.2, 6 * beat)));
      }
    }

    // ---------------------------------------------------------------- 空著的小節：遠方低空放一發小的（或間奏時近處的一發大的）
    const main = this.shells.filter((x) => !x.back);
    let prevX = -1e4;
    for (let k = 0; ; k++) {
      const tl = barAfter(au, s + 0.02, k), tb = au.timeOfBeat(Math.round(au.beatAt(tl)) + riseB);
      if (tb + 1.0 > e) break;
      if (tl < s + beat * 0.5 && this.msg) continue; // 第一小節留給地平線的火花與第一發
      if (main.some((x) => Math.abs(x.tl - tl) < 1.6 * beat || Math.abs(x.tb - tb) < 1.6 * beat)) continue;
      // 天上有字（留言或歌詞）時：遠方、低空、小而暗；天上沒字時才放近處的大煙火
      const busy = main.some((x) => x.glyphs.length && tb > x.tb - 0.3 && tb < x.tf0 + 1.5);
      const kinds: Kind[] = ['peony', 'willow', 'ring', 'peony'];
      const kind = kinds[Math.floor(hash(k, this.seed, 3) * kinds.length)]!;
      if (busy) {
        const cx = this.freeX(tb, prevX, rnd), cy = 560 + rnd() * 90;
        shell(kind, { tl, tb, cx, cy, lx: clamp(cx + (rnd() - 0.5) * 120, 200, 1700), R: 115 + rnd() * 70, back: true, I: 0.9 });
        prevX = cx;
      } else {
        const R = 220 + rnd() * 130, p = this.spot(tb, R, rnd);
        shell(kind, { tl, tb, cx: p.x, cy: p.y, lx: launchX(p.x), R });
      }
    }
    this.avoid = this.popupAvoid(lyricLines);
  }

  /**
   * 即時小卡要避開的範圍：每一發有字的煙火的外框、署名、水面上每一行歌詞（或邀請句）實際排出來的寬度。
   * 右邊 x ≥ 1378 刻意空著，所以右上、右中兩格一定排得進去。
   */
  private popupAvoid(lyricLines: Line[]): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    const box = (x0: number, y0: number, x1: number, y1: number) => out.push([Math.round(x0 - 16), Math.round(y0 - 16), Math.round(x1 - x0 + 32), Math.round(y1 - y0 + 32)]);
    for (const sh of this.shells) if (sh.glyphs.length) box(sh.box.x0, sh.box.y0, sh.box.x1, sh.box.y1);
    const S = this.sig;
    if (S) box(S.x, S.y - S.lay.size, S.x + S.lay.width, S.y + S.lay.size * 0.3);
    const c = this.layer.ctx;
    let w = 0, top = Infinity, bottom = -Infinity;
    for (const line of lyricLines) {
      const lay = layoutLyric(c, line, LSTYLE);
      const y0 = LYR.y - (lay.height - lay.size) / 2;
      w = Math.max(w, ...lay.rows.map((r) => r.width));
      top = Math.min(top, y0 - lay.size); bottom = Math.max(bottom, y0 + lay.height - lay.size + lay.size * 0.3);
    }
    if (this.invite) { c.font = font(F.hand(400), 44); w = c.measureText(INVITE).width; top = LYR.y - 44; bottom = LYR.y + 14; }
    if (w > 0) box(LYR.x, top, LYR.x + w, bottom);
    return out;
  }

  /** 近處大煙火（沒有字的那種）的中心：離 tb 時天上看得到的字越遠越好，也不要跟上一發同一個地方。 */
  private spot(tb: number, R: number, rnd: () => number) {
    const boxes = this.shells.filter((x) => x.glyphs.length && tb > x.tb - 0.3 && tb < x.tf0 + 1.2).map((x) => x.box);
    const prev = this.shells.filter((x) => !x.back && !x.glyphs.length).pop();
    let best = { x: SKY_CX, y: 380 }, bestS = -Infinity;
    for (let x = 330; x <= 1590; x += 140) for (let y = 250; y <= 520; y += 90) {
      if (y - R * 0.8 < 150) continue; // 外圈不要飛進左上角的施放紀錄
      let d = 600;
      for (const b of boxes) d = Math.min(d, Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1)));
      const sc = Math.min(d - R * 0.8, 200) - (prev && Math.hypot(prev.cx - x, prev.cy - y) < 400 ? 250 : 0) + rnd() * 90;
      if (sc > bestS) { bestS = sc; best = { x, y }; }
    }
    return best;
  }

  /** 遠方小煙火的 x：離天上字的外框越遠越好（低空那一條），也不要跟上一發同一個地方。 */
  private freeX(tb: number, prevX: number, rnd: () => number) {
    const boxes = this.shells.filter((x) => x.glyphs.length && tb > x.tb - 0.3 && tb < x.tf0 + 1.5).map((x) => x.box);
    // 署名也要避開（它常常落在低空那一條）
    const S = this.sig;
    if (S && tb > S.t0 - 0.5 && tb < S.tg + 1) boxes.push({ x0: S.x - 20, y0: S.y - S.lay.size, x1: S.x + S.lay.width + 20, y1: S.y + S.lay.size * 0.4 });
    let best = SKY_CX, bestS = -Infinity;
    for (let x = 260; x <= 1640; x += 115) {
      let d = Infinity;
      for (const b of boxes) d = Math.min(d, b.y1 < 520 ? 400 : x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0);
      const sc = Math.min(d, 400) - (Math.abs(x - prevX) < 320 ? 300 : 0) + rnd() * 120;
      if (sc > bestS) { bestS = sc; best = x; }
    }
    return best;
  }

  /** 一發開始燒完：一條引信在 span 秒內由左到右跑過它的字（愛心之類沒有字的，時間到就整朵燒完）。 */
  private dissolveAt(sh: Shell, tf0: number, span = 0.5) {
    sh.tf0 = tf0;
    if (sh.glyphs.length) this.fuse(sh.glyphs, tf0, Math.min(span, 0.06 * sh.glyphs.length + 0.25));
  }

  /** 照閱讀順序排一條引信：第 k 個字在 t0 + span·k/(n-1) 燒起來（火花的路線就是字的中心連起來）。 */
  private fuse(glyphs: SkyGlyph[], t0: number, span: number): Fuse {
    const n = glyphs.length;
    const f: Fuse = { pts: glyphs.map((g, k) => { g.tg = t0 + (n > 1 ? (span * k) / (n - 1) : 0); return { x: g.cx, y: g.cy, t: g.tg }; }) };
    this.fuses.push(f);
    return f;
  }

  /** 引信火花在 t 的位置（還沒點、已經燒完是 null）。 */
  private fuseAt(f: Fuse, t: number): { x: number; y: number } | null {
    const P = f.pts;
    if (!P.length || t < P[0]!.t - 0.12 || t > P[P.length - 1]!.t + 0.05) return null;
    // 點火前一點點：火花從字的左邊飛進來
    if (t < P[0]!.t) { const u = (P[0]!.t - t) / 0.12; return { x: P[0]!.x - 90 * u, y: P[0]!.y - 30 * u }; }
    let k = 0;
    while (k + 1 < P.length && P[k + 1]!.t <= t) k++;
    const a = P[k]!, b = P[k + 1] ?? a, u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
  }

  /** 開場火花在地平線上的 x。 */
  private horizonX(t: number) {
    const s = this.ctx.start;
    if (this.tIgn > s + 0.05) {
      if (t <= this.tIgn) return lerp(-30, this.ignX, prog(t, s, this.tIgn, ease.inOutCubic));
      return lerp(this.ignX, W + 30, prog(t, this.tIgn, this.tIgn + 0.6, ease.inCubic));
    }
    return lerp(-30, W + 30, prog(t, s, s + Math.min(1.1, 2 * this.beat), ease.outCubic));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const kIn = prog(t, s, s + 0.25);
    const hx = this.horizonX(t);

    // ---- 光：最近的爆炸閃光照亮天空的煙與版畫線、城市輪廓；煙在爆開的地方留好幾秒
    const Ls: Light[] = [], Ss: Light[] = [];
    for (const sh of this.shells) {
      const w = sh.back ? 0.45 : 1, tau = t - sh.tb;
      if (tau >= 0 && tau < 9) {
        Ls.push({ x: sh.cx, y: sh.cy, k: w * (0.6 * pulse(t, sh.tb, 0.09) + 0.2 * Math.exp(-tau / 0.9)), r: sh.R * 1.3 + 110 });
        Ss.push({ x: sh.cx + tau * 8, y: sh.cy + tau * 10, k: w * (1 - Math.exp(-tau / 0.35)) * Math.exp(-tau / 6), r: sh.R * 0.95 + 60 });
      }
      if (t >= sh.tl && t < sh.tb) {
        const p = rocketAt(sh, (t - sh.tl) / Math.max(0.05, sh.tb - sh.tl));
        Ls.push({ x: p.x, y: p.y, k: 0.1 * w, r: 150 });
        Ls.push({ x: sh.lx, y: HZ, k: 0.5 * w * pulse(t, sh.tl, 0.1), r: 160 });
      }
    }
    Ls.sort((a, b) => b.k - a.k); Ss.sort((a, b) => b.k - a.k);
    const L4 = Ls.slice(0, 4);
    const lit = (x: number, y: number) => {
      let v = 0;
      for (const l of L4) { const dx = x - l.x, dy = y - l.y; v += l.k * Math.exp(-(dx * dx + dy * dy) / (l.r * l.r)); }
      return v;
    };
    const u = this.bg.u;
    (u.L!.value as THREE.Vector4[]).forEach((v, i) => { const l = L4[i]; v.set(l?.x ?? 0, l?.y ?? 0, l?.k ?? 0, l?.r ?? 1); });
    (u.S!.value as THREE.Vector4[]).forEach((v, i) => { const l = Ss[i]; v.set(l?.x ?? 0, l?.y ?? 0, l?.k ?? 0, l?.r ?? 1); });

    // ---- 線：城市、地平線的火花、每一發
    const B = this.back, Fr = this.front;
    B.clear(); Fr.clear();
    const downbeat = pulse(t, au.timeOfBar(Math.floor(f.bar + 1e-4)), 0.22);
    drawSkyline(B, t, hx, kIn, downbeat, lit);
    if (hx > -30 && hx < W + 30) {
      sparkParticles(Fr, t, (tb) => { const x = this.horizonX(tb); return tb >= s && x > -30 && x < W + 30 ? { x, y: HZ } : null; }, { rate: 110, life: 0.35, speed: 170, seed: 5 });
      sparkHead(Fr, hx, HZ, t, 0.95);
    }
    const L = this.layer, HL = this.hot;
    L.clear();
    if (this.hotUsed) HL.clear();
    this.hotUsed = false;
    const c = L.ctx, hc = HL.ctx;
    const bone = rgbOf(HEX.bone), sig = rgbOf(HEX.signal);
    const mix = (k: number, a: number) => `rgba(${[0, 1, 2].map((i) => Math.round(bone[i]! + (sig[i]! - bone[i]!) * k)).join(',')},${a})`;
    for (const sh of this.shells) {
      // 有字的一發要畫到最後一顆火星落完（引信最長約兩秒、火星最長約 2.4 秒）；花形的三秒內就燒完了
      const until = sh.glyphs.length || sh.kind === 'heart' ? sh.tf0 + 5 : sh.tb + 3.2;
      if (t < sh.tl || t > until) continue;
      if (!sh.stars && (sh.kind === 'text' || sh.kind === 'heart')) sh.stars = sampleStars(sh, sh.id * 31 + 7);
      const lb = sh.back ? B : Fr;
      drawRocket(lb, sh, t);
      drawCrown(lb, sh, t);
      drawComets(lb, sh, t);
      drawStars(lb, sh, t, f.a.hat);
      drawEmbers(lb, sh, t, sh.kind === 'heart' ? 0.9 : this.emberFrac);
      if (sh.glyphs.length) this.drawGlyphs(c, hc, sh, t, mix);
    }
    for (const fz of this.fuses) {
      const p = this.fuseAt(fz, t);
      if (!p) continue;
      sparkParticles(Fr, t, (tt) => this.fuseAt(fz, tt), { rate: 150, life: 0.4, speed: 210, seed: 23 });
      sparkHead(Fr, p.x, p.y, t, 0.9);
    }
    const pen = this.drawSig(c, hc, t, mix);
    if (pen) {
      const at = (tt: number) => this.penAt(tt);
      sparkParticles(Fr, t, at, { rate: 110, life: 0.35, speed: 190, seed: 11 });
      sparkHead(Fr, pen.x, pen.y, t, 0.85);
    }

    // ---- 水面上的歌詞（逐字跟唱），或一句邀請
    c.globalAlpha = kIn;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = layoutLyric(c, ly.line, LSTYLE);
      const y0 = LYR.y - (lay.height - lay.size) / 2;
      c.save(); c.translate(LYR.x, y0);
      const head = drawLyric(c, ly.line, t, LSTYLE, lay, ly.k * kIn);
      c.restore();
      if (head) { sparkHead(Fr, LYR.x + head.x, y0 + head.y, t, 0.5, 0.8); }
    } else if (this.invite) {
      c.save();
      c.globalAlpha = kIn * prog(t, s + this.beat * 2, s + this.beat * 4);
      c.font = font(F.hand(400), 44); c.fillStyle = rgba('bone', 0.85);
      c.fillText(INVITE, LYR.x, LYR.y);
      c.restore();
    }
    this.drawInstruments(c, t, kIn);
    c.globalAlpha = 1;

    // ---- 合成：倒影（先把火花畫到半解析度的副本）→ 天空與水 → 遠方的線 → 字 → 字的光 → 近處的火藥
    clearRT(renderer, this.refl, [0, 0, 0], 1);
    B.render(renderer, this.refl);
    Fr.render(renderer, this.refl);
    u.t!.value = t; u.k!.value = kIn; u.hx!.value = hx; u.refl!.value = this.refl.texture;
    this.bg.render(renderer, out);
    B.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    if (this.hotUsed) comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.3, 1.3, 1.3] });
    Fr.render(renderer, out);

    // 爆開的那一下：極輕的閃光與推鏡（只算近處的大煙火）
    let flash = 0, punch = 0;
    for (const sh of this.shells) if (!sh.back) { flash += pulse(t, sh.tb, 0.05); punch += pulse(t, sh.tb, 0.16); }
    return { bloom: 0.85, vignette: 0.5, halation: 0.3, flash: 0.005 * Math.min(1.5, flash), zoom: 1 + 0.005 * Math.min(1.5, punch), popupAvoid: this.avoid };
  }

  /**
   * 一發的字：每個字跟著自己的星點從字的中心放大，星點快停好時浮出來；燒紅（訊號色，也畫在發光層）→ 冷卻成紙白。
   * 引信經過時一下子燒紅、往下沉一點、化掉（火星由 drawEmbers 畫）。
   */
  private drawGlyphs(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, sh: Shell, t: number, mix: (k: number, a: number) => string) {
    const T = sh.Tg, g0 = sh.glyphs[0]!;
    if (t < sh.tb + T * 0.5) return;
    c.font = hc.font = font(g0.fam, g0.size);
    c.textBaseline = hc.textBaseline = 'alphabetic';
    for (const g of sh.glyphs) {
      const tau = t - g.tb;
      if (tau < T * 0.5) continue;
      // 字在星點快停好（放大到九成）時才浮出來：之前的形狀交給星點；浮出來時跟星點一起從字的中心放大
      const e = expand(tau, T);
      let a = prog(tau, T * 0.5, T * 1.2, ease.outCubic), dy = 0, re = 0;
      const heat = 1 - prog(tau, T * 0.8, T * 0.8 + COOL);
      const zoom = e < 1;
      if (zoom) for (const x of [c, hc]) { x.save(); x.translate(g.cx, g.cy); x.scale(e, e); x.translate(-g.cx, -g.cy); }
      if (t >= g.tg - 0.06) {
        // 引信經過：一下子燒紅，接著化掉（火星由 drawEmbers 往下掉）
        const q = prog(t, g.tg, g.tg + 0.34);
        a *= (1 - q) ** 1.4;
        dy = 8 * q * q;
        re = t < g.tg ? (t - g.tg + 0.06) / 0.06 : 1 - q;
      }
      const h = Math.max(heat, re * 0.85);
      if (a > 0.004 && g.heart) {
        const gg = dy ? { ...g, y: g.y + dy } : g;
        drawGlyphHeart(c, gg, rgba('rose', a * 0.97));
        if (h > 0.03) { drawGlyphHeart(hc, gg, rgba('rose', h * h * a * 0.8 * sh.glow)); this.hotUsed = true; }
      } else if (a > 0.004) {
        c.fillStyle = h > 0.02 ? mix(h * 0.75, a * 0.97) : rgba('bone', a * 0.97);
        c.fillText(g.ch, g.x, g.y + dy);
        if (h > 0.03) { hc.fillStyle = rgba('signal', h * h * h * a * 0.85 * sh.glow); hc.fillText(g.ch, g.x, g.y + dy); this.hotUsed = true; }
      }
      if (zoom) { c.restore(); hc.restore(); }
    }
  }

  /** 署名那顆星的位置：先像彗星一樣從最後一發的中心弧線飛到署名起點，再一個字一個字寫過去。 */
  private penAt(t: number): { x: number; y: number } | null {
    const S = this.sig;
    if (!S || t < S.t0 || t > S.t1) return null;
    const sz = S.lay.size, to = { x: S.x, y: S.y - sz * 0.4 };
    if (t < S.tw) {
      const u = prog(t, S.t0, S.tw, ease.inOutCubic), v = 1 - u;
      const cx = (S.from.x + to.x) / 2 + 80, cy = Math.min(S.from.y, to.y) - 40;
      return { x: v * v * S.from.x + 2 * v * u * cx + u * u * to.x, y: v * v * S.from.y + 2 * v * u * cy + u * u * to.y };
    }
    const r = prog(t, S.tw, S.t1) * S.lay.width;
    return { x: S.x + r, y: to.y + Math.sin(r * 0.09) * sz * 0.18 };
  }

  /** 署名：筆尖掃過的地方出現（燒紅→冷卻成淡紙白），跟最後一行一起燒完。回傳筆尖。 */
  private drawSig(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, mix: (k: number, a: number) => string) {
    const S = this.sig;
    if (!S || t < S.tw) return this.penAt(t);
    const fade = 1 - prog(t, S.tg, S.tg + 0.5);
    if (fade <= 0) return null;
    const r = prog(t, S.tw, S.t1) * S.lay.width, sz = S.lay.size;
    const heat = 1 - prog(t, S.t1, S.t1 + COOL);
    for (const x of [c, hc]) {
      x.save();
      x.beginPath(); x.rect(S.x - 10, S.y - sz * 1.2, r + 10, sz * 1.6); x.clip();
      x.font = font(F.hand(400), sz); x.textBaseline = 'alphabetic';
    }
    c.fillStyle = heat > 0.02 ? mix(heat * 0.8, 0.82 * fade) : rgba('bone', 0.82 * fade);
    c.fillText(S.lay.text, S.x, S.y + 20 * (1 - fade));
    if (heat > 0.03) { hc.fillStyle = rgba('signal', heat * heat * fade); hc.fillText(S.lay.text, S.x, S.y + 20 * (1 - fade)); this.hotUsed = true; }
    c.restore(); hc.restore();
    return this.penAt(t);
  }

  /** 機器的聲音：左上角的施放紀錄、右邊的高度尺（火箭升空時指針跟著走，爆開時停在那個高度）。 */
  private drawInstruments(c: CanvasRenderingContext2D, t: number, kIn: number) {
    c.save();
    c.globalAlpha = kIn;
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.72);
    c.fillText(this.header, 160, 114);
    // 高度尺
    const rx = RULER.x;
    c.fillStyle = rgba('graphite', 0.9);
    c.fillRect(rx, RULER.top, 1, HZ - RULER.top);
    c.letterSpacing = '1px';
    // 指針：最近一發近處的煙火（升空時跟著走，爆開後停在那個高度一下）
    let cur: Shell | null = null;
    for (const sh of this.shells) if (!sh.back && t >= sh.tl && t < sh.tb + 1.8) cur = sh;
    let my = -1e4;
    if (cur) {
      const up = t < cur.tb, p = up ? rocketAt(cur, (t - cur.tl) / Math.max(0.05, cur.tb - cur.tl)) : { x: 0, y: cur.cy };
      const a = up ? 1 : 1 - prog(t, cur.tb + 1.1, cur.tb + 1.8);
      my = clamp(p.y, RULER.top, HZ);
      c.globalAlpha = kIn * a;
      c.fillStyle = rgba('signal');
      c.beginPath(); c.moveTo(rx + 3, my); c.lineTo(rx + 13, my - 5); c.lineTo(rx + 13, my + 5); c.closePath(); c.fill();
      c.font = font(F.mono(500), 14);
      c.fillText(`${Math.round((HZ - my) / 2)} m`, rx + 18, my + 5);
      c.globalAlpha = kIn;
    }
    c.font = font(F.mono(400), 13);
    for (let m = 0; m <= 300; m += 25) {
      const y = HZ - m * 2, major = m % 100 === 0;
      c.fillStyle = rgba('graphite', major ? 1 : 0.8);
      c.fillRect(rx - (major ? 12 : 6), y, major ? 12 : 6, 1);
      if (major && m && Math.abs(y - my) > 16) { c.fillStyle = rgba('ash', 0.55); c.fillText(String(m), rx + 8, y + 4); }
    }
    c.fillStyle = rgba('ash', 0.55);
    c.fillText('ALT m', rx - 12, RULER.top - 16);
    c.letterSpacing = '0px';
    c.restore();
  }
}
