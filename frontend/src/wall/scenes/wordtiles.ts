// 拼字盤（亮，雙語）：從正上方看桌上的一局拼字遊戲——方格盤（淺色木頭、細格線、幾格加分格，正中間一格是我們的愛心），
// 前面一條放字母牌的木頭牌架，右邊一張計分表。不仿任何品牌：格子的樣子、加分格的名字（雙倍祝福、三倍甜…）都是自己的。
//  - 每一句歌詞：字母牌從牌架一張一張飛出去、滑進格子（落在拍子附近），上面一排拼中文（一格一個字；英文一格一個字母），
//    下面一排拼原文（韓文一格一個音節、英文一格一個字母，字小一號）。唱到的那格亮起來（訊號色、牌子浮起一點），
//    唱完的變成墨色。一排放不下就接到下一排（像填字一樣往下接）。沒有翻譯的歌只有中文那幾排。
//  - 下一句來之前，整盤的牌被掃開（由左往右一張一張滑走、淡出），牌架上的牌補回來。
//  - 每一句拼完，計分表上的「本局得分」往上跳；每個小節線一道光斜斜掃過盤面；大鼓時牌架上的牌跳一下。
//  - 主打留言寫在計分表上（留言標準 v2：寫留言的那一塊約 460×420、手寫 40～60 px），像記在「最佳單字」那一欄；
//    沒有留言時計分表上是邀請。純音樂時牌子拼新人的名字，每兩小節掃掉再拼一次。
// 畫法：桌面一個 shader；拼字盤、牌架、計分表是 init 畫一次的圖層；牌子每格畫（每種字、每種狀態的牌先畫成小圖，每格只貼圖）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { fitText } from '../engine/text';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { beatAfter, lyricSubOf, drawHeart, COUPLE_EN, COUPLE_ZH } from './_motifs';
import { INVITE_SMALL, paperSignal } from './_t19';
import { barsIn, beatsIn, makeCanvas, freeCanvas } from './_t1';
import { placeBlock, drawBlock, sigOf, fitV2 } from './_t22';
import { lyricV2, V2 } from './_v2';
import { mainOnly, preloadPair, hasSubIn, type Rect } from './_b4';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'lingo', paper: true, energy: [0.2, 0.85], bars: [4, 12], weight: 1 };

/** 格子大小、牌子大小；盤面（左上角、格數）。 */
const CELL = 64, TILE = 58;
const BOARD = { x: 112, y: 100, cols: 17, rows: 13 };
/** 正中間那一格（我們的愛心）。 */
const MIDC = 8, MIDR = 6;
/** 盤面上可以放字的範圍（格）：左右留一格邊。 */
const COL0 = 1, COLS = 15;
/** 牌架（前景，牌從這裡飛出去）。 */
const RACK = { x: 300, y: 968, w: 560, h: 70 };
/** 牌架上一直擺著的牌（冷面彩蛋：拼的是 LOVE 사랑 愛）。 */
const RACK_T = ['L', 'O', 'V', 'E', '사', '랑', '愛'];
/** 加分格（對稱的圖樣，自己排的）：離正中間 (a, b) 格、哪一種。 */
const BONUS_AT: [number, number, number][] = [[3, 3, 1], [7, 5, 2], [5, 1, 3], [1, 5, 4], [7, 0, 2], [0, 4, 3]];
/** 計分表：紙、寫留言的範圍。 */
const PAD = { x: 1340, y: 108, w: 500, h: 690, rot: 0.03 };
const PM = { x: 34, y: 250, w: 432, h: 380 };

const T_PAD = '計分表 · SCORE';
const T_ROUND = '本局得分';
const T_BEST = '最佳單字';
const BONUS = ['雙倍祝福', '三倍甜', '加倍愛', '雙倍笑'];

// ---------------------------------------------------------------- 桌面（整晚共用）
const BG = () => new FSPass(/* glsl */ `
  uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 淺色的亞麻桌布：很細的織紋、一點點皺，左上的窗光
    float wv = sin(p.x * 1.4) * sin(p.y * 1.4);
    float fold = fbm(p / 520.0 + vec2(2.0, 5.0), 3);
    vec3 col = mix(C_PAPER, C_SEPIA, 0.1 + 0.03 * fold) * (0.97 + 0.012 * wv);
    col *= 0.92 + 0.1 * exp(-pow(length((p - vec2(300.0, 60.0)) / vec2(1500.0, 1000.0)), 2.0));
    // 盤子、計分表、牌架的影子（光從左上來：往右下偏、很柔）
    vec2 q = p - vec2(${BOARD.x + 18}.0, ${BOARD.y + 22}.0);
    float sb = max(max(-q.x, q.x - ${BOARD.cols * CELL}.0), max(-q.y, q.y - ${BOARD.rows * CELL}.0));
    col *= 1.0 - 0.22 * (1.0 - smoothstep(-20.0, 40.0, sb));
    vec2 r = p - vec2(${PAD.x + 20}.0, ${PAD.y + 24}.0);
    float sp = max(max(-r.x, r.x - ${PAD.w}.0), max(-r.y, r.y - ${PAD.h}.0));
    col *= 1.0 - 0.14 * (1.0 - smoothstep(-14.0, 26.0, sp));
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 } });

interface Tl { ch: string; word: Word | null; k: number; n: number; sub: boolean; col: number; row: number; pts: number; land: number; off: number }
interface Round { tiles: Tl[]; tIn: number; tOut: number; score: number; still: boolean }

export default class WordTiles extends Scene {
  bg = shared('wordtiles.bg', BG);
  props = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) >>> 0;
  bilingual = false;
  rounds: Round[] = [];
  bars: number[] = [];
  beats: number[] = [];
  mainSize: number = V2.lyrMax;
  subSize = 32;
  ink = { active: 'rgba(0,0,0,1)', sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28) };
  /** 牌子的小圖（依字、大小、狀態快取）。 */
  private sprites = new Map<string, ReturnType<typeof makeCanvas>>();
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, start: s, end: e, lyrics } = this.ctx;
    const m = this.msg;
    await preloadPair(this.ctx, `${m ? m.text + sigOf(m) : ''}${INVITE_SMALL}${T_PAD}${T_ROUND}${T_BEST}${BONUS.join('')}${COUPLE_ZH}${COUPLE_EN}FROM THE COUPLE · 新人0123456789,+分LOVE사랑愛`);
    this.bilingual = hasSubIn(this.ctx);
    this.bars = barsIn(au, s, e);
    this.beats = beatsIn(au, s, e);
    this.ink.active = paperSignal();
    this.drawProps();
    // 中文的字：留言在的時候比留言小一級；中文牌子的字、原文牌子的字（小一號，≥ 30）
    this.subSize = 32;
    // ---- 每一句一局：什麼時候飛進盤子、什麼時候被掃掉
    const lines = lyrics.linesIn(s - 0.2, e + 0.2);
    let prevOut = -Infinity;
    lines.forEach((line, i) => {
      const next = lines[i + 1];
      const tIn = Math.max(line.start - 0.75, prevOut + 0.25, s + 0.05);
      const tOut = next ? clamp(next.start - 1.0, line.end - 0.1, line.end + 1.4) : Math.min(line.end + 1.4, e + 1);
      prevOut = tOut;
      this.rounds.push(this.layout(line, tIn, tOut));
    });
    if (!lyrics.has) {
      const B = au.beatPeriod(s + 0.1);
      const b0 = beatAfter(au, s + Math.min(0.2, B * 0.5));
      const cuts = [b0, ...this.bars.filter((b, k) => b > b0 + B && k % 2 === 1), e + 1];
      for (let k = 0; k + 1 < cuts.length; k++) this.rounds.push(this.layout(null, cuts[k]!, cuts[k + 1]! - 0.5));
    }
    this.avoid = [[BOARD.x, 200, COLS * CELL + 2 * CELL, 560], [PAD.x, PAD.y, PAD.w, PAD.h]];
  }

  /** 拼字盤、牌架、計分表（留言）。 */
  private drawProps() {
    const L = this.props, c = L.ctx, m = this.msg;
    L.clear();
    c.textBaseline = 'alphabetic';
    // ---- 盤子：木頭邊框、淺色盤面、細格線、加分格
    const bx = BOARD.x, by = BOARD.y, bw = BOARD.cols * CELL, bh = BOARD.rows * CELL;
    c.fillStyle = mixRgba('paper', 'sepia', 0.42);
    c.beginPath(); c.roundRect(bx - 16, by - 16, bw + 32, bh + 32, 12); c.fill();
    c.fillStyle = mixRgba('paper', 'bone', 0.35);
    c.fillRect(bx, by, bw, bh);
    for (let r = 0; r < BOARD.rows; r++) for (let q = 0; q < BOARD.cols; q++) {
      // 加分格：左右、上下對稱的圖樣（用格子的位置算，不是照任何現成遊戲的排法）
      const a = Math.abs(q - MIDC), b = Math.abs(r - MIDR);
      const kind = BONUS_AT.find(([x, y]) => x === a && y === b)?.[2] ?? 0;
      if (kind) {
        c.fillStyle = [mixRgba('paper', 'signal', 0.24), mixRgba('paper', 'blood', 0.14), mixRgba('paper', 'sepia', 0.18), mixRgba('paper', 'signal', 0.12)][kind - 1]!;
        c.fillRect(bx + q * CELL + 2, by + r * CELL + 2, CELL - 4, CELL - 4);
        c.font = font(F.hei(500), 11); c.textAlign = 'center'; c.fillStyle = rgba('sepia', 0.45);
        c.fillText(BONUS[kind - 1]!, bx + q * CELL + CELL / 2, by + r * CELL + CELL / 2 + 4);
        c.textAlign = 'left';
      }
    }
    c.strokeStyle = rgba('sepia', 0.11); c.lineWidth = 1;
    for (let q = 0; q <= BOARD.cols; q++) { c.beginPath(); c.moveTo(bx + q * CELL, by); c.lineTo(bx + q * CELL, by + bh); c.stroke(); }
    for (let r = 0; r <= BOARD.rows; r++) { c.beginPath(); c.moveTo(bx, by + r * CELL); c.lineTo(bx + bw, by + r * CELL); c.stroke(); }
    // 正中間：我們的愛心
    c.fillStyle = mixRgba('paper', 'rose', 0.25); c.fillRect(bx + MIDC * CELL + 2, by + MIDR * CELL + 2, CELL - 4, CELL - 4);
    drawHeart(c, bx + MIDC * CELL + CELL / 2, by + MIDR * CELL + CELL / 2 + 2, 16, rgba('rose', 0.85));
    // ---- 牌架：木頭條、斜的前緣，上面放著幾張牌（背面朝外）
    c.fillStyle = rgba('sepia', 0.18); c.fillRect(RACK.x + 10, RACK.y + 16, RACK.w, RACK.h);
    c.fillStyle = mixRgba('paper', 'sepia', 0.5);
    c.beginPath(); c.roundRect(RACK.x, RACK.y, RACK.w, RACK.h, 8); c.fill();
    c.fillStyle = mixRgba('paper', 'sepia', 0.32); c.fillRect(RACK.x + 8, RACK.y + 8, RACK.w - 16, 24);
    // ---- 計分表：一張稍微歪的紙，上面有欄位、兩位新人的分數（無限大）、留言記在「最佳單字」
    c.save();
    c.translate(PAD.x + PAD.w / 2, PAD.y + PAD.h / 2); c.rotate(PAD.rot); c.translate(-PAD.w / 2, -PAD.h / 2);
    c.fillStyle = mixRgba('paper', 'bone', 0.6); c.fillRect(0, 0, PAD.w, PAD.h);
    c.fillStyle = paperSignal(0.8); c.fillRect(0, 0, PAD.w, 8);
    c.font = font(F.hei(700), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('sepia', 0.85);
    c.fillText(T_PAD, 34, 56); c.letterSpacing = '0px';
    // 表格：兩位新人（分數無限大）、本局得分（每一局拼完往上跳，render 時寫）
    c.strokeStyle = rgba('sepia', 0.22); c.lineWidth = 1;
    for (const y of [74, 134, 192]) { c.beginPath(); c.moveTo(24, y); c.lineTo(PAD.w - 24, y); c.stroke(); }
    c.beginPath(); c.moveTo(PAD.w - 150, 74); c.lineTo(PAD.w - 150, 192); c.stroke();
    c.font = font(F.hand(700), 28); c.fillStyle = rgba('sepia', 0.85);
    c.fillText(COUPLE_ZH, 34, 116);
    c.font = font(F.hand(700), 34); c.textAlign = 'center'; c.fillText('∞', PAD.w - 86, 118); c.textAlign = 'left';
    c.font = font(F.hei(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText(T_ROUND, 34, 170);
    c.fillStyle = rgba('sepia', 0.55);
    c.fillText(m?.couple ? 'FROM THE COUPLE · 新人' : T_BEST, 34, 228);
    c.letterSpacing = '0px';
    let msgSize: number | null = null;
    if (m) {
      const fam = F.hand(700), sig = sigOf(m);
      const blk = fitV2(c, m.text, fam, PM.w, PM.h, 1, { lineHeight: 1.28 });
      const top = PM.y + Math.max(0, (PM.h - blk.height) * 0.3);
      const pl = placeBlock(c, blk, fam, sig, PM.x, top);
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.95), sigColor: rgba('sepia', 0.72) });
      msgSize = blk.fit.size;
    } else {
      c.fillStyle = rgba('sepia', 0.8);
      const fit = fitText(c, INVITE_SMALL, F.hand(700), PM.w, 140, { min: 32, max: 40, maxLines: 2 });
      c.font = font(F.hand(700), fit.size);
      fit.lines.forEach((ln, i) => c.fillText(ln, PM.x, PM.y + 80 + i * fit.lineHeight));
    }
    // 鉛筆（斜放在計分表下緣）
    c.save(); c.translate(PAD.w - 60, PAD.h - 40); c.rotate(-0.5);
    c.fillStyle = mixRgba('signal', 'paper', 0.3); c.fillRect(-150, -8, 150, 16);
    c.fillStyle = mixRgba('paper', 'sepia', 0.35); c.beginPath(); c.moveTo(0, -8); c.lineTo(24, 0); c.lineTo(0, 8); c.closePath(); c.fill();
    c.fillStyle = rgba('ink', 0.7); c.beginPath(); c.moveTo(17, -2.5); c.lineTo(24, 0); c.lineTo(17, 2.5); c.closePath(); c.fill();
    c.fillStyle = mixRgba('blood', 'paper', 0.3); c.fillRect(-166, -8, 16, 16);
    c.restore();
    c.restore();
    this.mainSize = Math.min(46, lyricV2(msgSize));
    L.upload();
  }

  /** 一句排成一局：中文幾排、原文幾排，接在盤子上（每排最多 COLS 格，空白空一格）。 */
  private layout(line: Line | null, tIn: number, tOut: number): Round {
    const cells = (ln: Line | null, str: string, sub: boolean) => {
      const out: { ch: string; word: Word | null; k: number; n: number; gap: boolean }[] = [];
      if (ln) {
        for (const w of ln.words) {
          // 牌子上只有字母與數字（標點、愛心符號不做成牌子）
          const letters = Array.from(w.w).filter((ch) => /[\p{L}\p{N}]/u.test(ch));
          const gap = w.o > 0 && ln.text[w.o - 1] === ' ';
          letters.forEach((ch, k) => out.push({ ch: /[a-z]/.test(ch) ? ch.toUpperCase() : ch, word: w, k, n: letters.length, gap: gap && k === 0 }));
        }
      } else {
        const ws = str.split(/\s+/);
        ws.forEach((w, wi) => Array.from(w).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).forEach((ch, k) => out.push({ ch: ch.toUpperCase(), word: null, k, n: 1, gap: wi > 0 && k === 0 })));
      }
      void sub;
      return out;
    };
    const mainC = cells(line ? mainOnly(line) : null, COUPLE_ZH, false);
    const subL = line && this.bilingual ? lyricSubOf(line) : null;
    const subC = subL ? cells(subL, '', true) : !line ? cells(null, COUPLE_EN, true) : [];
    // 折排：每排最多 COLS 格；折在空白的地方（一個字太長就硬折）
    const rowsOf = (cs: typeof mainC) => {
      const rows: (typeof mainC)[] = [];
      let cur: typeof mainC = [];
      let width = 0;
      for (let i = 0; i < cs.length; i++) {
        const it = cs[i]!;
        // 一個詞（到下一個空白之前）有多長：放不下就整個搬到下一排
        let j = i + 1; while (j < cs.length && !cs[j]!.gap) j++;
        const wl = it.gap ? j - i : 1;
        if (cur.length && width + (it.gap ? 1 : 0) + wl > COLS && it.gap) { rows.push(cur); cur = []; width = 0; }
        else if (cur.length && width + 1 > COLS) { rows.push(cur); cur = []; width = 0; }
        if (cur.length && it.gap) width += 1;
        cur.push(it); width += 1;
      }
      if (cur.length) rows.push(cur);
      return rows;
    };
    const mr = rowsOf(mainC), sr = rowsOf(subC);
    const nRows = mr.length + sr.length + (sr.length ? 1 : 0);
    // 整組在盤子上垂直置中在畫面約 y = 470 的地方
    const r0 = Math.max(1, Math.round((BOARD.rows - nRows) / 2 - 0.3));
    const tiles: Tl[] = [];
    const place = (rows: typeof mr, rStart: number, sub: boolean) => {
      rows.forEach((row, ri) => {
        const w = row.reduce((s, it, i) => s + 1 + (i && it.gap ? 1 : 0), 0);
        let col = COL0 + Math.floor((COLS - w) / 2);
        row.forEach((it, i) => {
          if (i && it.gap) col++;
          const pts = 1 + Math.floor(hash(it.ch.codePointAt(0) ?? 0, 3) * 9);
          tiles.push({ ch: it.ch, word: it.word, k: it.k, n: it.n, sub, col, row: rStart + ri, pts, land: 0, off: 0 });
          col++;
        });
      });
    };
    place(mr, r0, false);
    place(sr, r0 + mr.length + 1, true);
    // 飛進來：由左上到右下一張一張（中文先、原文後），整局在 0.6 秒內放完；掃掉：由左往右
    const n = tiles.length;
    const st = Math.min(0.03, 0.42 / Math.max(1, n));
    tiles.forEach((tl, i) => { tl.land = tIn + 0.3 + i * st; tl.off = tOut + (tl.col - COL0) * 0.022 + (tl.row - r0) * 0.01; });
    const score = tiles.reduce((s2, tl) => s2 + tl.pts, 0);
    return { tiles, tIn, tOut, score, still: !line };
  }

  /** 一張牌（小圖，依字、大小、狀態快取）：奶油色的牌、下緣一點厚度、字、右下角的分數。 */
  private sprite(ch: string, sub: boolean, state: 0 | 1 | 2, pts: number) {
    const key = `${ch}|${sub ? 1 : 0}|${state}|${pts}`;
    let s = this.sprites.get(key);
    if (s) return s;
    s = makeCanvas(TILE + 4, TILE + 8, 2);
    const c = s.c;
    c.fillStyle = mixRgba('paper', 'sepia', sub ? 0.36 : 0.3);
    c.beginPath(); c.roundRect(0, 5, TILE, TILE, 7); c.fill();
    c.fillStyle = sub ? mixRgba('paper', 'sepia', 0.1) : mixRgba('paper', 'bone', 0.7);
    c.beginPath(); c.roundRect(0, 0, TILE, TILE, 7); c.fill();
    if (state === 1) { c.strokeStyle = this.ink.active; c.lineWidth = 3; c.beginPath(); c.roundRect(1.5, 1.5, TILE - 3, TILE - 3, 6); c.stroke(); }
    const fs = sub ? this.subSize : this.mainSize;
    const tw = (() => { c.font = font(F.archivo(100, 800), fs); return c.measureText(ch).width; })();
    // 寬的字（W、M）縮一點才放得進牌子
    const f2 = tw > TILE - 10 ? fs * (TILE - 10) / tw : fs;
    c.font = font(F.archivo(100, 800), f2);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    // 原文牌：唱到、唱完都用「唱完」的顏色（副行的規則，不跟中文搶）
    c.fillStyle = state === 0 ? this.ink.unsung : state === 1 && !sub ? this.ink.active : this.ink.sung;
    if (sub && state > 0) c.globalAlpha = 0.85;
    c.fillText(ch, TILE / 2 - (sub ? 0 : 2), TILE / 2 + f2 * 0.36);
    c.globalAlpha = 1;
    c.font = font(F.mono(500), 11); c.fillStyle = rgba('sepia', 0.55); c.textAlign = 'right';
    c.fillText(String(pts), TILE - 5, TILE - 5);
    this.sprites.set(key, s);
    return s;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const D = this.dyn, c = D.ctx;
    D.clear();
    c.textBaseline = 'alphabetic';
    // ---- 小節線：一道光斜斜掃過盤面（在牌子底下）
    for (const b of this.bars) {
      const a = t - b;
      if (a < 0 || a > 0.9) continue;
      const u = ease.inOutQuad(a / 0.9), x = lerp(-300, BOARD.cols * CELL + 300, u) + BOARD.x;
      c.save();
      c.beginPath(); c.rect(BOARD.x, Math.max(0, BOARD.y), BOARD.cols * CELL, BOARD.rows * CELL); c.clip();
      c.translate(x, 540); c.rotate(0.5);
      const g = c.createLinearGradient(-90, 0, 90, 0);
      g.addColorStop(0, rgba('bone', 0)); g.addColorStop(0.5, rgba('bone', 0.28 * Math.sin(Math.PI * u))); g.addColorStop(1, rgba('bone', 0));
      c.fillStyle = g; c.fillRect(-90, -900, 180, 1800);
      c.restore();
    }
    // ---- 牌子：飛進來、亮、被掃掉
    const rackX = RACK.x + 60, rackY = RACK.y + 10;
    let score = 0, lastScoreT = -9;
    for (const rd of this.rounds) {
      if (t > rd.tOut + 0.3 + 0.5 && t > rd.tIn) { score += rd.score; lastScoreT = Math.max(lastScoreT, rd.tOut); }
      if (t < rd.tIn || t > rd.tOut + 1.2) continue;
      rd.tiles.forEach((tl, i) => {
        if (t < tl.land - 0.34) return;
        const tx = BOARD.x + tl.col * CELL + (CELL - TILE) / 2, ty = BOARD.y + tl.row * CELL + (CELL - TILE) / 2;
        let x = tx, y = ty, alpha = 1, lift = 0;
        if (t < tl.land) {
          // 從牌架飛出去：拋物線，最後一下滑進格子
          const u = ease.outCubic((t - (tl.land - 0.34)) / 0.34);
          const sx = rackX + (i % 7) * 66;
          x = lerp(sx, tx, u); y = lerp(rackY, ty, u) - 90 * Math.sin(Math.PI * u);
          lift = 10 * (1 - u);
        } else if (t > tl.off) {
          // 掃掉：往右上滑走、淡出
          const a = t - tl.off;
          x += 160 * a + 260 * a * a; y -= 40 * a;
          alpha = 1 - clamp(a / 0.35);
        }
        if (alpha <= 0.01) return;
        // 跟唱的狀態：英文一個字拆成好幾張牌，照這個字唱到幾成決定亮到第幾張
        let state: 0 | 1 | 2 = 0;
        if (rd.still) state = 2;
        else if (tl.word) {
          const p = Lyrics.wordProgress(tl.word, t);
          const a0 = tl.k / tl.n, a1 = (tl.k + 1) / tl.n;
          state = p >= a1 ? 2 : p > a0 || (p > 0 && tl.k === 0) ? 1 : 0;
          if (p >= 1) state = 2;
        }
        if (state === 1 && !tl.sub) lift = Math.max(lift, 5);
        const sp = this.sprite(tl.ch, tl.sub, state, tl.pts);
        c.globalAlpha = alpha;
        // 影子（浮起來時比較遠、比較淡）
        c.fillStyle = rgba('sepia', 0.16 - lift * 0.006);
        c.fillRect(x + 3 + lift * 0.6, y + 6 + lift, TILE, TILE);
        c.drawImage(sp.cv, x, y - lift, sp.w, sp.h);
        c.globalAlpha = 1;
      });
    }
    // ---- 牌架上的牌（背面）：每一局開始時被拿走、掃掉之後補回來；大鼓時跳一下
    // 牌架上一直擺著七張牌（LOVE 사랑 ♥），大鼓時跳一下
    for (let i = 0; i < 7; i++) {
      const jump = 5 * f.a.kick * (0.5 + 0.5 * hash(i, 2));
      const sp = this.sprite(RACK_T[i]!, false, 2, 1 + Math.floor(hash(i, 4) * 9));
      c.drawImage(sp.cv, RACK.x + 22 + i * 76, RACK.y - 38 - jump, sp.w, sp.h);
    }
    // ---- 計分表上的「本局得分」：每一局拼完往上跳
    const pop = clamp((t - lastScoreT - 0.8) / 0.3);
    c.save();
    c.translate(PAD.x + PAD.w / 2, PAD.y + PAD.h / 2); c.rotate(PAD.rot); c.translate(-PAD.w / 2, -PAD.h / 2);
    c.font = font(F.hand(700), 30 + 6 * Math.sin(Math.PI * pop) * (lastScoreT > 0 ? 1 : 0)); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'center';
    c.fillText(score ? score.toLocaleString('en-US') : '0', PAD.w - 86, 174);
    c.textAlign = 'left';
    c.restore();
    D.upload();

    this.bg.u.t!.value = t;
    this.bg.render(renderer, out);
    comp.draw(renderer, this.props.texture, out);
    comp.draw(renderer, D.texture, out);
    const push = ease.inOutQuad(prog(t, s, e));
    return { paper: 1, bloom: 0.25, bloomThreshold: 1.4, halation: 0.04, vignette: 0.3, grain: 0.045, zoom: 1 + 0.03 * push, popupAvoid: this.avoid };
  }

  override dispose() {
    for (const sp of this.sprites.values()) freeCanvas(sp);
    this.sprites.clear();
    super.dispose();
  }
}
