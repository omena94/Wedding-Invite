// 切蛋糕（亮、wedding、婚禮服）：喜宴廳裡一座三層的婚禮蛋糕，宣文和孟庭握著同一把刀，在小節線上一起切下去。
// 角色是 Codex 畫的雙人紙偶（cp_cake_*，_puppet.ts）。
//  - 兩個人站在長桌後面（桌巾擋住腰部以下，跟真的切蛋糕照片一樣），蛋糕在前面：刀尖藏在最下層蛋糕的右邊裡面，看起來就是切進去了。
//    蛋糕的位置照圖上刀尖的位置擺（sprites.json 的 knife 點）。
//  - 三小節一輪：握著刀（ready，拍點上跟著點一下、小節線前往上提、往後帶一下預備）→ **小節線上切下去**（cut：整張往下一沉、
//    碎屑往外噴、刀面一道反光、最下層多一道切痕）→ 下一個小節線宣文餵孟庭一口（feed，冒一顆小愛心）→ 再下一個小節線回到 ready。
//  - **焦點是主打留言**：像用奶油擠在蛋糕側面的字，從上往下讀——短的只寫在最下層，長一點的往上用到中層、頂層
//    （每層的寬度不一樣，照子句一層一層斷行）；署名寫在蛋糕檯的桌巾上（最後一行下面）。照「留言尺寸與版面比例標準 v2」：
//    字 40～60，整座蛋糕的字加起來 ≤ 640 × 430，放在畫面左半。第一拍起一個字一個字擠上去。沒有留言時蛋糕上寫邀請、字淡，歌詞變主角。
//  - 歌詞在長桌前面的地板上（下三分之一，比留言小一級 40～52），照跟唱規則逐字亮。
//  - 次要動作：QQ 在桌子左邊站起來討（每拍搖一下，切下去那一刻開心地跳一下）；幾片花瓣慢慢飄；右邊大窗戶斜斜的光。
//  - 鏡頭：整個窗格慢慢推近蛋糕；切下去那一下輕輕一頓。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { tokens, wrapGreedy } from '../engine/text';
import { drawHeart } from '../engine/motifs';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, drawMessage, signature } from './_motifs';
import { inkFor, inkLine, inkPath, inkShape, inkPoly, inkEllipse, heartPop, lyricOnPath, paperBG, type Pt, type Ink } from './_couple';
import { loadPuppets, drawPick, pick, drawPuppet, puppetPoint, puppetBox, puppetShadow, puppetIn, jumpArc, breathe, beatKick } from './_puppet';
import { msgMaxFor, sigV2, lyricV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'wedding', paper: true, energy: [0.25, 1], bars: [4, 8] };

const FLOOR = 900;
const SZ = 700;
/** 兩個人（翻過來面向左、刀伸向左邊的蛋糕）：中景，腰部以下在長桌後面。 */
const CP_X = 1080;
/** 餵蛋糕那張兩個人站得比較開：往左挪一點，宣文才不會露出長桌右邊（右下角 QR 那一區也要空著）。 */
const FEED_DX = -40;
const QQ_X = 160;
const DOG_S = 1.15;
/** 三層蛋糕（上 → 下）的寬、每層最多寫幾行；最下層右邊留給刀切（字不寫到那裡）。 */
const TIERS = [{ w: 360, rows: 1 }, { w: 480, rows: 2 }, { w: 620, rows: 3 }] as const;
const KNIFE_ROOM = 96;
/** 蛋糕檯的厚度；刀尖在最下層底邊上面多高（長桌的桌面照這個算，剛好擋住兩個人腰部以下）。 */
const STAND = 16;
const TIP_UP = 42;
/** 歌詞：長桌前面的地板上（左邊對齊），最後一排的基線。 */
const LYR = { x: 150, base: 972, w: 1120 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = { ready: 'cp_cake_ready', cut: 'cp_cake_cut', feed: 'cp_cake_feed', qqBeg: 'qq_beg', qqJump: 'qq_jump' } as const;
const CLAUSE_END = /[、。，．,.!?！？：；:;）)」』】〕〉》…～~♥]\s*$/;

interface Tier { x: number; y: number; w: number; h: number; rows: string[] }

/**
 * 把留言照子句一行一行寫到各層：rowW = 每一行可以寫的寬（照層從上到下）。整個子句放得下就整句放，
 * 放不下才在子句裡面斷（照 tokens，中文禁則、英文不拆字）；一行裡的字超過一半寬時，斷在最後一個標點後面。
 * 放不完回傳 null。
 */
function fillRows(c: CanvasRenderingContext2D, text: string, rowW: readonly number[]): string[] | null {
  const toks = tokens(text), n = toks.length;
  const wOf = (x: string) => c.measureText(x.trimEnd()).width;
  /** 從 j 開始的子句到哪一個 token 結束（含）。 */
  const clauseEnd = (j: number) => { let k = j; while (k < n - 1 && !CLAUSE_END.test(toks[k]!)) k++; return k; };
  const rows: string[] = [];
  let i = 0;
  for (let r = 0; r < rowW.length; r++) {
    const w = rowW[r]!;
    if (i >= n) break;
    let cur = '', j = i;
    // 1) 整個子句放得下就整句放
    while (j < n) {
      const ce = clauseEnd(j), cand = cur + toks.slice(j, ce + 1).join('');
      if (wOf(cand) > w) break;
      cur = cand; j = ce + 1;
    }
    if (cur) {
      // 這一行還空一大半：接著放下一個子句的前面幾個字
      if (wOf(cur) < w * 0.5) while (j < n && wOf(cur + toks[j]) <= w) cur += toks[j++];
    } else {
      // 2) 第一個子句就放不下：把這個子句平均分成 k 段、放進接下來的 k 行（每一層寬度不一樣，照各自的寬檢查），
      //    斷在最接近平均的地方，不要斷出「寶貝不管怎／樣你開心」這種頭重腳輕的樣子
      const ce = clauseEnd(i), part = toks.slice(i, ce + 1), total = wOf(part.join(''));
      let cut = 0;
      for (let k = 2; k <= 4 && !cut && r + k - 1 < rowW.length; k++) {
        const target = total / k;
        let acc = '', best = 0, bestD = Infinity;
        const bounds = wordBounds(part.join(''));
        for (let q = 0; q < part.length - 1; q++) {
          acc += part[q];
          // 斷在詞的中間（「怎／樣」「見／證」）多算一段距離：寧可兩段長短差一點
          const d = Math.abs(wOf(acc) - target) + (bounds.has(acc.length) ? 0 : target * 0.8);
          if (wOf(acc) <= w && d < bestD) { bestD = d; best = q + 1; }
        }
        // 剩下的要放得進後面 k - 1 行（粗估：總寬）
        const rest = total - wOf(part.slice(0, best).join(''));
        const room = rowW.slice(r + 1, r + k).reduce((a2, b2) => a2 + b2, 0);
        if (best > 0 && rest <= room * 0.98) cut = best;
      }
      if (!cut) cut = Math.max(1, Math.min(part.length, (wrapGreedy(c, part.join(''), w)[0] ?? '').length ? tokens(wrapGreedy(c, part.join(''), w)[0]!).length : 1));
      cur = part.slice(0, cut).join('');
      j = i + cut;
    }
    rows.push(cur.trim());
    i = j;
  }
  return i >= n ? rows : null;
}

let seg: Intl.Segmenter | null = null;
/** 一段中文的詞與詞之間的位置（字串的 offset）：瀏覽器內建的中文斷詞。 */
function wordBounds(text: string): Set<number> {
  seg ??= new Intl.Segmenter('zh-Hant', { granularity: 'word' });
  const out = new Set<number>();
  for (const x of seg.segment(text)) out.add(x.index);
  return out;
}

/** 斷行的好壞：斷在子句中間（行尾不是標點）扣分；給挑字級與用幾層時比較。 */
const midBreaks = (rows: string[][]) => rows.flat().slice(0, -1).filter((r) => !CLAUSE_END.test(r)).length;

export default class Cake extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 兩個人（在長桌後面）→ 長桌與蛋糕（畫一次，蓋在人前面）→ 蛋糕上的字、QQ、碎屑、歌詞。 */
  mid = this.track(new Layer2D(W, H, undefined, { fast: true }));
  front = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  tiers: Tier[] = [];
  size = 48;
  sig = 28;
  family = F.hand(400);
  /** 每一行開始擠字的時間（每個字 per 秒）。 */
  rowT: number[] = [];
  per = 0.06;
  sigT = 0;
  table = { x0: 300, x1: 1300, top: 640 };
  /** 切下去的時間、每輪的姿勢時間軸。 */
  cuts: number[] = [];
  feeds: number[] = [];
  keys: [number, string][] = [];
  knife: Pt = { x: 0, y: 0 };
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(Object.values(P)));
    // ---- 姿勢時間軸：三小節一輪（ready → 小節線 cut → 小節線 feed → 小節線 ready）
    let b = Math.round(au.barAt(barAfter(au, s + 0.7)));
    this.keys = [[-1e9, P.ready]];
    for (let k = 0; k < 40; k++, b++) {
      const tb = au.timeOfBar(b);
      if (tb > e + 0.1) break;
      const ph = k % 3;
      if (ph === 0) { this.cuts.push(tb); this.keys.push([tb, P.cut]); }
      else if (ph === 1) { this.feeds.push(tb); this.keys.push([tb, P.feed]); }
      else this.keys.push([tb, P.ready]);
    }
    // ---- 蛋糕上的字：從大字往小找，先試只寫最下層、再加中層、再加頂層
    const c = this.fg.ctx;
    const text = this.msg?.text ?? INVITE;
    const max = this.msg ? msgMaxFor(text) : 44;
    let got: { size: number; rows: string[][] } | null = null;
    let bestScore = -Infinity;
    for (let size = max; size >= V2.msgMin; size--) {
      c.font = font(this.family, size);
      for (const from of [2, 1, 0]) {
        const use = TIERS.slice(from);
        const rowW = use.flatMap((t, i) => Array(t.rows).fill(t.w * 0.86 - (from + i === 2 ? KNIFE_ROOM : 0)) as number[]);
        const rows = fillRows(c, text, rowW);
        if (!rows) continue;
        const per: string[][] = [[], [], []];
        let r = 0;
        use.forEach((t, i) => { per[from + i] = rows.slice(r, r + t.rows); r += t.rows; });
        // 字大一點好，但斷在子句中間一次抵掉 5 px；用的層少一點（蛋糕上面留白）也加一點分
        const score = size - 5 * midBreaks(per) - (2 - from) * 1.5;
        if (score > bestScore) { bestScore = score; got = { size, rows: per }; }
      }
    }
    // 還是放不下（很長的英文單字）：最小字、最下層多一行
    if (!got) {
      c.font = font(this.family, V2.msgMin);
      const rows = fillRows(c, text, [TIERS[0].w * 0.86, TIERS[1].w * 0.86, TIERS[1].w * 0.86, 520, 520, 520, 520, 520]) ?? [text];
      got = { size: V2.msgMin, rows: [rows.slice(0, 1), rows.slice(1, 3), rows.slice(3)] };
    }
    this.size = got.size;
    this.sig = sigV2(got.size);
    this.lyricSize = lyricV2(this.msg ? got.size : null);
    // ---- 蛋糕的位置：照 cut 那張圖的刀尖（刀尖藏在最下層右邊裡面）
    const lh = this.size * 1.28;
    const tierH = got.rows.map((r, i) => Math.max(r.length ? r.length * lh + 26 : 0, [92, 112, 132][i]!));
    const tip = this.pointOr(P.cut, 'knife', 0.12, 0.42);
    this.knife = tip;
    const right = tip.x + KNIFE_ROOM * 0.7;
    const cx = right - TIERS[2].w / 2;
    const top = tip.y + TIP_UP + STAND;
    this.table = { x0: cx - TIERS[2].w / 2 - 90, x1: 1340, top };
    let y = top - STAND;
    for (let i = 2; i >= 0; i--) {
      const h = tierH[i]!;
      y -= h;
      this.tiers[i] = { x: cx - TIERS[i]!.w / 2, y, w: TIERS[i]!.w, h, rows: got.rows[i]! };
      y -= 10;
    }
    // ---- 擠字的時間：第一拍起一個字一個字、一行接一行（從上往下）
    const n = got.rows.flat().reduce((a, r) => a + Array.from(r).length, 0);
    this.per = clamp(1.8 / Math.max(1, n), 0.03, 0.1);
    let tt = beatAfter(au, s + 0.35);
    for (const r of got.rows.flat()) { this.rowT.push(tt); tt += Array.from(r).length * this.per; }
    this.sigT = tt + 0.15;
    this.drawBackground();
  }

  /** 圖上的道具點（sprites.json 量的）；沒有就用外框的比例估一個。 */
  private pointOr(name: string, key: string, fx: number, fy: number): Pt {
    const o = { h: SZ, flip: true };
    const p = puppetPoint(name, key, CP_X, FLOOR, o);
    if (p) return p;
    const [bx, by, bw, bh] = puppetBox(name, CP_X, FLOOR, o);
    return { x: bx + bw * fx, y: by + bh * fy };
  }

  /** 不會動的背景：牆與大窗、地板（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 牆：一條腰線、右邊一扇大窗（斜斜的光從窗戶照進來，很淡）
    c.fillStyle = rgba('sepia', 0.05);
    c.fillRect(0, 610, W, FLOOR - 610);
    inkLine(c, [{ x: 40, y: 610 }, { x: 1880, y: 612 }], { ink, w: 0.5, seed: 2, color: rgba('sepia', 0.4) });
    const win = { x: 1290, y: 250, w: 420, h: 520 };
    c.fillStyle = rgba('bone', 0.55);
    c.beginPath(); c.moveTo(win.x, win.y + win.h); c.lineTo(win.x, win.y + win.w / 2); c.arc(win.x + win.w / 2, win.y + win.w / 2, win.w / 2, Math.PI, 0); c.lineTo(win.x + win.w, win.y + win.h); c.closePath(); c.fill();
    const arch: Pt[] = [{ x: win.x, y: win.y + win.h }, { x: win.x, y: win.y + win.w / 2 }];
    for (let i = 0; i <= 24; i++) { const a = Math.PI + (i / 24) * Math.PI; arch.push({ x: win.x + win.w / 2 + Math.cos(a) * win.w / 2, y: win.y + win.w / 2 + Math.sin(a) * win.w / 2 }); }
    arch.push({ x: win.x + win.w, y: win.y + win.h });
    inkLine(c, arch, { ink, w: 0.8, seed: 3 });
    inkLine(c, [{ x: win.x + win.w / 2, y: win.y }, { x: win.x + win.w / 2, y: win.y + win.h }], { ink, w: 0.5, seed: 4 });
    for (const yy of [win.y + win.w / 2, win.y + win.w / 2 + 140]) inkLine(c, [{ x: win.x, y: yy }, { x: win.x + win.w, y: yy }], { ink, w: 0.5, seed: yy });
    c.fillStyle = rgba('bone', 0.3);
    c.beginPath(); c.moveTo(win.x, win.y + win.h); c.lineTo(win.x + win.w, win.y + win.h); c.lineTo(win.x + win.w - 330, FLOOR + 120); c.lineTo(win.x - 420, FLOOR + 120); c.closePath(); c.fill();
    // 地板
    inkLine(c, [{ x: 30, y: FLOOR }, { x: 1890, y: FLOOR }], { ink, w: 0.8, seed: 6 });
    c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 1; c.beginPath();
    for (const [y0, k] of [[FLOOR + 38, 0], [FLOOR + 92, 1]] as const) { c.moveTo(0, y0); c.lineTo(W, y0 + k); }
    c.stroke();
    L.upload();
    this.drawFront();
  }

  /** 蓋在兩個人前面的：長桌（桌巾垂到地上、下擺一道垂墜的緞帶）、蛋糕檯、三層蛋糕（畫一次）。 */
  private drawFront() {
    const L = this.front, c = L.ctx, ink = inkFor(true);
    L.clear();
    const T = this.table;
    inkPoly(c, [{ x: T.x0, y: T.top }, { x: T.x1, y: T.top }, { x: T.x1 + 6, y: FLOOR + 4 }, { x: T.x0 - 6, y: FLOOR + 4 }], { ink, fill: mixRgba('bone', 'paper', 0.45), w: 0.9, seed: 8 });
    for (let x = T.x0 + 60; x < T.x1 - 30; x += 74) inkLine(c, [{ x, y: T.top + 22 }, { x: x + 3, y: FLOOR - 4 }], { ink, w: 0.3, seed: 20 + x, color: rgba('sepia', 0.28) });
    inkPoly(c, [{ x: T.x0 - 8, y: T.top - 6 }, { x: T.x1 + 8, y: T.top - 6 }, { x: T.x1 + 8, y: T.top + 8 }, { x: T.x0 - 8, y: T.top + 8 }], { ink, fill: rgba('bone'), w: 0.8, seed: 9 });
    const swag: Pt[] = [];
    const n = Math.round((T.x1 - T.x0) / 150);
    for (let k = 0; k <= n * 12; k++) { const u = k / (n * 12); swag.push({ x: T.x0 + (T.x1 - T.x0) * u, y: T.top + 74 + 34 * Math.abs(Math.sin(u * n * Math.PI)) }); }
    inkPath(c, swag, { ink, w: 0.5, seed: 10, color: rgba('signal', 0.7) });
    // 下擺一圈蕾絲（小半圓）
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1;
    c.beginPath();
    for (let x = T.x0; x < T.x1 - 8; x += 18) { c.moveTo(x, FLOOR - 12); c.arc(x + 9, FLOOR - 12, 9, Math.PI, 0, true); }
    c.stroke();
    // 蛋糕檯：一片圓盤、短短的腳
    const B = this.tiers[2]!, cx = B.x + B.w / 2;
    inkPoly(c, [{ x: cx - 60, y: T.top - 4 }, { x: cx + 60, y: T.top - 4 }, { x: cx + 38, y: T.top - STAND + 4 }, { x: cx - 38, y: T.top - STAND + 4 }], { ink, fill: rgba('bone'), w: 0.7, seed: 11 });
    inkEllipse(c, cx, B.y + B.h + 2, B.w / 2 + 34, 14, 0, { ink, fill: rgba('bone'), w: 0.8, seed: 12 });
    // 三層蛋糕：圓柱（上面一圈橢圓、側面、底下一圈珍珠擠花）、側面上緣一條垂墜的擠花
    for (let i = 2; i >= 0; i--) this.tier(c, ink, this.tiers[i]!, i);
    // 頂上：兩朵糖花、一顆小愛心插牌
    const top = this.tiers[0]!, tx = top.x + top.w / 2;
    for (const [dx, r, sd] of [[-46, 20, 41], [40, 16, 42]] as const) {
      const pts: Pt[] = [];
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, rr = r * (k % 2 ? 0.7 : 1); pts.push({ x: tx + dx + Math.cos(a) * rr, y: top.y - 4 + Math.sin(a) * rr * 0.7 }); }
      inkShape(c, pts, { ink, fill: rgba('cream'), w: 0.6, seed: sd });
    }
    inkLine(c, [{ x: tx, y: top.y - 6 }, { x: tx + 2, y: top.y - 66 }], { ink, w: 0.6, seed: 43 });
    drawHeart(c, tx + 2, top.y - 80, 34);
    L.upload();
  }

  /** 一層蛋糕：象牙白的圓柱、底下一圈珍珠、上緣垂墜的擠花。 */
  private tier(c: CanvasRenderingContext2D, ink: Ink, T: Tier, i: number) {
    const ry = 12 + i * 2;
    const body: Pt[] = [{ x: T.x, y: T.y }, { x: T.x, y: T.y + T.h }];
    for (let k = 0; k <= 16; k++) { const a = Math.PI - (k / 16) * Math.PI; body.push({ x: T.x + T.w / 2 + Math.cos(a) * T.w / 2, y: T.y + T.h + Math.sin(a) * ry }); }
    body.push({ x: T.x + T.w, y: T.y });
    // 圓柱的明暗：左邊迎光、右邊暗一點
    const sh = c.createLinearGradient(T.x, 0, T.x + T.w, 0);
    sh.addColorStop(0, rgba('bone')); sh.addColorStop(0.45, mixRgba('bone', 'cream', 0.3)); sh.addColorStop(1, mixRgba('cream', 'sepia', 0.1));
    inkPoly(c, body, { ink, fill: sh as unknown as string, w: 0.9, seed: 30 + i });
    inkEllipse(c, T.x + T.w / 2, T.y, T.w / 2, ry, 0, { ink, fill: rgba('bone'), w: 0.8, seed: 33 + i });
    // 上緣垂墜的擠花
    const sw: Pt[] = [];
    const nsw = Math.round(T.w / 70);
    for (let k = 0; k <= nsw * 8; k++) { const u = k / (nsw * 8); sw.push({ x: T.x + 6 + (T.w - 12) * u, y: T.y + ry + 6 + 10 * Math.abs(Math.sin(u * nsw * Math.PI)) }); }
    inkPath(c, sw, { ink, w: 0.45, seed: 36 + i, color: rgba('sepia', 0.45) });
    // 底下一圈珍珠
    c.fillStyle = rgba('bone');
    c.strokeStyle = rgba('sepia', 0.4);
    c.lineWidth = 0.8;
    for (let x = T.x + 8; x < T.x + T.w - 4; x += 13) {
      const u = (x - T.x) / T.w, yy = T.y + T.h + Math.sin(Math.PI * u) * ry - 2;
      c.beginPath(); c.arc(x, yy, 4.2, 0, Math.PI * 2); c.fill(); c.stroke();
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    this.glow.clear();
    const ink = inkFor(true);
    // ---- 兩個人（在長桌後面）→ 長桌與蛋糕蓋在前面
    const M = this.mid; M.clear();
    this.drawCouple(M.ctx, t, bp);
    comp.draw(renderer, M.upload(), out);
    comp.draw(renderer, this.front.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;

    // ---- 花瓣慢慢飄（很淡，不進蛋糕上的字）
    this.petals(c, ink, t);
    // ---- 蛋糕上的字（擠花）、切痕、署名
    this.drawIcing(c, t);
    this.drawCuts(c, ink, t);
    // ---- QQ（在桌子前面的地上）
    this.drawQQ(c, t);
    // ---- 切下去那一刻：碎屑、刀面的反光；餵蛋糕：一顆小愛心
    this.crumbs(c, ink, t);
    for (const tf of this.feeds) {
      const k = (t - tf - bp * 0.5) / 1.1;
      const [bx, by, bw] = puppetBox(P.feed, CP_X + FEED_DX, FLOOR, { h: SZ, flip: true });
      heartPop(c, bx + bw * 0.5, by + 20, 30, k);
    }
    // ---- 歌詞：長桌前面的地板上（跟唱）；折成兩排時往上長
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: LYR.w, unsung: rgba('sepia', 0.26), sung: rgba('sepia', big ? 0.92 : 0.8), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(LYR.x, LYR.base - (lay.height - lay.size));
      drawLyric(c, ly.line, t, st, lay, ly.k * prog(t, s + 0.1, s + 0.5));
      c.restore();
    }

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近蛋糕；切下去那一下輕輕一頓
    const push = ease.inOutCubic(f.p);
    let kick = 0;
    for (const tc of this.cuts) if (t >= tc) kick = Math.max(kick, Math.exp(-(t - tc) / 0.2));
    const z = 0.03 * push + 0.008 * kick;
    const B = this.tiers[2]!, fx = B.x + B.w / 2 + 120, fy = this.tiers[1]!.y + 40;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.5, zoom: 1 + z, shake: [-(fx - W / 2) * z, -(fy - H / 2) * z + 3 * kick] };
  }

  /** 蛋糕側面的字：一行一行擠上去（深咖啡的奶油字），署名在桌巾上。 */
  private drawIcing(c: CanvasRenderingContext2D, t: number) {
    const col = this.msg ? rgba('sepia', 0.92) : rgba('sepia', 0.55);
    const lh = this.size * 1.28;
    let r = 0;
    for (let i = 0; i < 3; i++) {
      const T = this.tiers[i]!;
      if (!T.rows.length) continue;
      const aw = T.w - (i === 2 ? KNIFE_ROOM : 0);
      const blockH = this.size + (T.rows.length - 1) * lh;
      const y0 = T.y + 14 + (T.h - 14 - blockH) / 2 + this.size * 0.86;
      T.rows.forEach((row, k) => {
        const chars = this.msg ? (t - this.rowT[r]!) / this.per : Infinity;
        r++;
        if (chars <= 0) return;
        const fit = { size: this.size, lines: [row], lineHeight: lh, width: 0, height: this.size };
        drawMessage(c, fit, this.family, T.x + aw / 2, y0 + k * lh, { align: 'center', color: col, chars });
      });
    }
    if (this.msg && t > this.sigT) {
      c.save();
      c.globalAlpha = prog(t, this.sigT, this.sigT + 0.4);
      c.font = font(this.family, this.sig);
      c.textAlign = 'right';
      c.fillStyle = rgba('sepia', 0.78);
      const B = this.tiers[2]!;
      c.fillText(signature(this.msg.name), B.x + B.w - KNIFE_ROOM + 20, this.table.top + 28 + this.sig * 0.9);
      c.restore();
    }
  }

  /** 切過的地方：最下層右邊（刀切進去的地方）一道切痕（切一次多一道，往左一點）。 */
  private drawCuts(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const B = this.tiers[2]!;
    this.cuts.forEach((tc, i) => {
      if (t < tc) return;
      const x = B.x + B.w - 34 - i * 14, k = prog(t, tc, tc + 0.12);
      inkLine(c, [{ x, y: B.y + 10 }, { x: x - 2, y: B.y + 10 + (B.h - 20) * k }], { ink, w: 0.6, seed: 70 + i, color: rgba('sepia', 0.55) });
    });
  }

  /** 兩個人（腰部以下在桌子後面，不畫影子）：ready 時跟著拍子點一下，小節線前往上提、往後帶一下（預備）；切下去一下子沉下去再彈回來。 */
  private drawCouple(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.05, 0.5);
    if (en.alpha <= 0) return;
    let squash = breathe(t, 0.008, 3.2) + 0.012 * beatKick(au, t, 0.25), rot = 0, lift = 0;
    for (const tc of this.cuts) {
      if (t < tc) {
        const pre = prog(t, tc - bp * 0.9, tc - 0.02, ease.inOutCubic);
        rot += 0.03 * pre; lift += 18 * pre;
      } else {
        const d = t - tc;
        lift += 18 * clamp(1 - d / 0.07);
        squash += 0.06 * Math.exp(-d / 0.09) * Math.cos(d * 26);
        rot -= 0.025 * Math.exp(-d / 0.18);
      }
    }
    const x = CP_X + (pick(this.keys, t) === P.feed ? FEED_DX : 0);
    drawPick(c, this.keys, t, x, FLOOR - lift, { h: SZ, flip: true, spin: en.spin, alpha: en.alpha, squash, rot, pivot: 0.3 });
  }

  /** QQ：在桌子左邊站起來討（每拍搖一下）；切下去那一刻開心地跳一下。 */
  private drawQQ(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.25, 0.45);
    if (en.alpha <= 0) return;
    const o = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    for (const tc of this.cuts) {
      const t0 = tc + 0.04, t1 = tc + Math.min(0.46, au.beatPeriod(tc) * 0.95);
      if (t > t0 - 0.12 && t < t1 + 0.3) {
        const j = jumpArc(t, t0, t1, 46, { crouch: 0.1, land: 0.18 });
        puppetShadow(c, 'qq', QQ_X, FLOOR, { h: SZ * DOG_S, lift: -j.y, alpha: 0.32 * en.alpha, color: '70,45,25' });
        if (j.air) drawPuppet(c, P.qqJump, QQ_X, FLOOR + j.y, { ...o, hide: ['ball'], rot: -0.1 + 0.2 * j.u, pivot: 0.5, squash: j.squash });
        else drawPuppet(c, P.qqBeg, QQ_X, FLOOR, { ...o, squash: j.squash });
        return;
      }
    }
    puppetShadow(c, 'qq', QQ_X, FLOOR, { h: SZ * DOG_S, alpha: 0.32 * en.alpha, color: '70,45,25' });
    drawPuppet(c, P.qqBeg, QQ_X, FLOOR, { ...o, rot: 0.04 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.1, squash: 0.04 * beatKick(au, t, 0.25) });
  }

  /** 切下去那一刻：刀切進去的地方噴出幾粒奶油碎屑（往外、往下掉），刀面一道訊號色的反光。 */
  private crumbs(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const B = this.tiers[2]!, K = { x: B.x + B.w - 40, y: B.y + 16 }, sg = LIN.signal;
    for (const tc of this.cuts) {
      const d = t - tc;
      if (d < 0 || d > 0.9) continue;
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI * (0.15 + 0.7 * hash(i, 1)), v = 140 + 160 * hash(i, 2);
        const x = K.x + Math.cos(a) * v * d, y = K.y - 10 + Math.sin(a) * v * d + 600 * d * d;
        c.globalAlpha = 1 - d / 0.9;
        inkEllipse(c, x, y, 3 + 2 * hash(i, 3), 2.5, i, { ink, fill: rgba('bone'), w: 0.4, seed: 80 + i });
      }
      c.globalAlpha = 1;
      if (d < 0.35) {
        // 刀面的反光：沿著露在蛋糕外面的那一段刀身，從刀尖往手的方向跑過去
        const k = d / 0.35, x = B.x + B.w + 10 + 90 * k, y = this.knife.y - 8 - 20 * k;
        this.glow.seg2(x - 14, y + 3, x + 14, y - 3, 2.2, [sg[0] * 2, sg[1] * 2, sg[2] * 2], 1 - k);
      }
    }
  }

  /** 幾片花瓣：從上面慢慢飄下來、邊飄邊轉（決定性：位置只看 t 與編號），蛋糕的字那一塊不飄。 */
  private petals(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const top = this.tiers[0]!.y - 90, B = this.tiers[2]!;
    for (let i = 0; i < 9; i++) {
      const sp = 36 + 20 * hash(i, 1), u = ((t * sp) / 1100 + hash(i, 2)) % 1;
      const y = -40 + u * 1100, x = 180 + 1600 * hash(i, 3) + 50 * Math.sin(t * 0.8 + i);
      if (x > B.x - 30 && x < B.x + B.w + 30 && y > top && y < B.y + B.h + 20) continue;
      const a = t * (0.8 + hash(i, 4)) + i;
      c.globalAlpha = 0.75 * Math.sin(Math.PI * u);
      inkEllipse(c, x, y, 7, 3.5 + 2.5 * Math.abs(Math.sin(a)), a, { ink, fill: rgba('bone'), w: 0.35, seed: 90 + i });
    }
    c.globalAlpha = 1;
  }
}
