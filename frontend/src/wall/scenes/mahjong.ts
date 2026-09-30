// 麻將（亮）：正上方往下拍的麻將桌（淺色的毛氈、四邊木頭的桌框），鏡頭像轉盤一樣很慢地轉、慢慢推近。
//  - 主打留言是一副一副的牌：每個字一張（象牙白的牌面、訊號色一家子的牌背，看得到牌的厚度），一開始全部蓋著；
//    在拍點照閱讀順序一張張翻開（翻的時候會浮起來、影子拉開，落下輕輕一彈）。「福、喜、愛、心」這種吉祥字刻紅色。
//  - 全部翻完的下一拍「推倒」：整副牌一起喀一聲，右上角一顆木頭的「胡了」牌子落下來（比留言小，是配角的笑點）。
//  - 歌詞在計分的籌碼上：桌子下方一排籌碼，一個字（英文一個單字）一枚，唱到的那枚跳起來、字變成訊號色，唱完是墨色。
//  - 沒有留言：牌是「宣文♥孟庭」，籌碼放大（歌詞是主角），底下一行邀請。純音樂：籌碼排歌名。
// v2（留言尺寸標準）：留言那副牌移到左邊、整副 ≤ 860×430，牌上的字 40～60 px；右邊是牌桌的主視覺——
// 一圈兩層的牌牆（牌背朝上）、中間兩顆骰子：第一拍擲骰，之後每兩個小節擲一次（翻滾、落在拍點、點數變）；
// 沒擲骰的那個小節，牌牆被推出一墩（「開門」）；每兩拍有人打出一張牌，滑進牌牆中間排成「河」（筒子、條子的圖案，
// 不用字，才不會跟留言搶），一局一直在進行。
// 手法：毛氈與桌框是全螢幕 shader（跟鏡頭一起轉），牌、籌碼、牌子是開場畫好的小圖（Canvas），每格用 drawImage 擺上去
// （翻牌是垂直方向的縮放，cos 從 −1 到 1，負的時候畫牌背）；轉動只轉畫布座標，不用每格重新光柵化斜的字。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, frameIdx } from '../engine/util';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { beatAfter, drawHeart, lyricSubOf, subSizeFor } from './_motifs';
import { msgMaxFor, lyricV2, sigV2 } from './_v2';
import { sigInk, makeCanvas, freeCanvas, shadowSprite } from './_t1';
import { bestCellRows, onGrid, sigOf, T17_INVITE, T17_TEXT } from './_t17';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'game', paper: true, energy: [0.3, 1], bars: [4, 8], weight: 1 };

const FAM_TILE = F.ming(900);
const FAM_CHIP = F.hei(700);
const FAM_SIG = F.hand(700);
const NO_MSG_TEXT = '宣文♥孟庭';
/** 刻紅字的吉祥字。 */
const RED = new Set(Array.from('福喜囍愛心幸永樂福壽合好美甜'));
/** 留言那副牌的區域（鏡頭落定時的螢幕座標，v2：≤ 860×430）、籌碼那一排、牌牆（中心、半邊長）。 */
const AREA = { x0: 150, x1: 1010, y0: 200, y1: 760 };
const CHIPS = { x: 150, y: 890, w: 1150 };
const WALL = { x: 1450, y: 400, r: 300, n: 16, tw: 36, td: 46 };

const FELT = () => new FSPass(/* glsl */ `
  uniform mat3 camInv;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = (camInv * vec3(sp, 1.0)).xy;
    // 毛氈：淺色、細細的纖維雜訊，中間被燈照亮、往外暗下去
    float fib = hash12(floor(q * 1.3)) - 0.5;
    float cloud = fbm(q / 420.0, 3);
    vec3 col = mix(C_PAPER, C_BONE, 0.3) * (0.965 + 0.05 * cloud + 0.025 * fib);
    col = mix(col, mix(C_PAPER, C_SEPIA, 0.12), 0.25);
    // 桌框：畫面外圍一圈木頭（轉動時會露出來），內緣一道陰影
    vec2 e = min(q - vec2(-40.0, -40.0), vec2(${W + 40}.0, ${H + 40}.0) - q);
    float m = min(e.x, e.y);
    float g = fbm(vec2(q.x / 700.0, q.y / 60.0) + (e.x < e.y ? 3.0 : 0.0), 3);
    vec3 wood = mix(C_SEPIA, C_PAPER, 0.35 + 0.12 * g) * (0.9 + 0.08 * sin(q.x / 5.0 + 20.0 * g));
    col *= 1.0 - 0.25 * exp(-max(m, 0.0) / 26.0);
    col = mix(wood, col, smoothstep(-1.0, 1.0, m));
    float r = length((sp - vec2(900.0, 470.0)) * vec2(0.85, 1.2)) / 1150.0;
    col *= 0.8 + 0.26 * exp(-r * r * 1.4);
    fragColor = vec4(col, 1.0);
  }`, { camInv: { value: new THREE.Matrix3() } });

interface Tile { ch: string; x: number; y: number; tf: number; sprite: number }
interface Chip { word: Word; x: number; y: number; w: number; sprite: number }
type Sprite = ReturnType<typeof makeCanvas>;
/** 原文的一枚籌碼：原文裡空白隔開的一個詞（韓文一個音節一個時間，一個音節一枚的話詞跟詞分不出來）；每個音節在籌碼上的位置與寬。 */
interface SubChip { words: Word[]; x: number; y: number; w: number; tx: number; offs: [number, number][] }
interface ChipLine { chips: Chip[]; ink: Sprite[]; hot: Sprite[]; faded: Sprite[]; sub?: { chips: SubChip[]; lit: Sprite[]; faded: Sprite[] } }

/** 一行籌碼的排法：先縮到一排放得下（最小 min），還是放不下就平均分成幾排（不要最後一排只剩一枚）。 */
function chipRows(texts: string[], size0: number, min: number) {
  let size = size0;
  const mc = document.createElement('canvas').getContext('2d')!;
  const widthOf = (sz: number) => texts.map((w) => { mc.font = font(FAM_CHIP, sz); return Math.max(sz * 1.5, mc.measureText(w).width + sz * 0.9); });
  let ws = widthOf(size);
  const gap = () => size * 0.14;
  const total = () => ws.reduce((a, b) => a + b, 0) + gap() * (ws.length - 1);
  while (total() > CHIPS.w && size > min) { size -= 2; ws = widthOf(size); }
  const nRows = Math.ceil(total() / CHIPS.w);
  const target = total() / nRows;
  const rows: number[][] = [[]];
  let acc = 0;
  ws.forEach((w, i) => {
    if (rows[rows.length - 1]!.length && rows.length < nRows && (acc + w / 2 > target || acc + w > CHIPS.w)) { rows.push([]); acc = 0; }
    rows[rows.length - 1]!.push(i); acc += w + gap();
  });
  return { size, ws, gap: gap(), rows };
}

export default class Mahjong extends Scene {
  felt = shared('mahjong.felt', FELT);
  L = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  sig = '';
  tiles: Tile[] = [];
  faces: ReturnType<typeof makeCanvas>[] = [];
  back: ReturnType<typeof makeCanvas> | null = null;
  shadow: ReturnType<typeof shadowSprite> | null = null;
  marker: ReturnType<typeof makeCanvas> | null = null;
  sigCv: ReturnType<typeof makeCanvas> | null = null;
  tw = 80; th = 106; thick = 14;
  t1 = 0; tDone = 0; tHu = 0; B = 0.5;
  /** 每一行歌詞的籌碼（開場排好）。 */
  chipLines = new Map<Line, ChipLine>();
  chipSize = 50;
  blockR = { x0: 0, y0: 0, x1: 0, y1: 0 };
  sigPos = { x: 0, y: 0 };
  /** 牌牆（不會動的部分畫一次）、會被推出來的那幾墩（邊、第幾墩、時間）、骰子（擲的時間、點數）。 */
  wall: ReturnType<typeof makeCanvas> | null = null;
  pushes: { side: number; i: number; t: number }[] = [];
  rolls: { t: number; a: number; b: number }[] = [];
  /** 打出去的牌（河）：圖案、落點（相對牌牆中心）、從哪一邊滑進來、時間、轉角；圖案的小圖。 */
  discards: { f: number; x: number; y: number; side: number; t: number; rot: number }[] = [];
  dFaces: ReturnType<typeof makeCanvas>[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : NO_MSG_TEXT;
    this.sig = sigOf(m);
    const lines = lyrics.linesIn(s - 2, e + 1);
    // 原文副行在 await 之前先拿：引擎只在呼叫 init 前設好這一格的開關
    const subOf = new Map(lines.map((l) => [l, lyricSubOf(l)] as const));
    await loadText(`${text}${this.sig}${T17_TEXT}${T17_INVITE}${song.title}${song.artist}胡了♪${lines.map((l) => l.text + (subOf.get(l)?.text ?? '')).join('')}`);
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 排牌：每行幾張，挑牌最大的排法
    // v2：牌上的字（牌寬的 0.74）上限依字數；整副牌 ≤ 860×430（署名另外在下面）
    const aw = AREA.x1 - AREA.x0, ah = 430;
    const cap = m ? msgMaxFor(text) : 44;
    const chOf = (cols: number, nr: number) => Math.min(cap, (aw / (cols * 1.06)) * 0.74, (ah / (nr * 1.72)) * 0.74);
    const pick = bestCellRows(text, m ? [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] : [12], (cols, rows) => chOf(cols, rows.length));
    const rows = pick.rows.slice(0, 6);
    const cols = Math.max(...rows.map((r) => r.length));
    const tw = (this.tw = Math.floor(chOf(cols, rows.length) / 0.74));
    const th = (this.th = Math.round(tw * 1.33));
    const thick = (this.thick = Math.round(tw * 0.17));
    const gapX = Math.round(tw * 0.06), rowH = th + thick + Math.round(tw * 0.22);
    const blockW = cols * (tw + gapX) - gapX, blockH = rows.length * rowH - (rowH - th - thick);
    // 靠左；垂直方向在區域裡置中（留署名的位置）
    const bx = AREA.x0, by = Math.round(AREA.y0 + (AREA.y1 - AREA.y0 - 50 - blockH) / 2);
    this.blockR = { x0: bx, y0: by, x1: bx + blockW, y1: by + blockH };

    // ---- 牌的小圖：牌面（每個字一張）、牌背；都含牌的厚度（下緣看得到兩層：象牙與牌背的顏色）
    const RES = 1.5;
    const pad = 3;
    const body = (c: CanvasRenderingContext2D, face: boolean) => {
      const r = tw * 0.12;
      // 厚度：下面那一截（牌背的顏色，上面一條象牙色的層）
      c.fillStyle = mixRgba('signal', 'blood', 0.35);
      c.beginPath(); c.roundRect(pad, pad + thick, tw, th, r); c.fill();
      c.fillStyle = mixRgba('bone', 'paper', 0.5);
      c.beginPath(); c.roundRect(pad, pad + thick * 0.45, tw, th, r); c.fill();
      // 上面那一面
      const g = c.createLinearGradient(0, pad, 0, pad + th);
      if (face) { g.addColorStop(0, mixRgba('bone', 'paper', 0.1)); g.addColorStop(1, mixRgba('bone', 'paper', 0.45)); }
      else { g.addColorStop(0, mixRgba('signal', 'paper', 0.5)); g.addColorStop(1, mixRgba('signal', 'paper', 0.28)); }
      c.fillStyle = g;
      c.beginPath(); c.roundRect(pad, pad, tw, th, r); c.fill();
      // 斜邊的高光（左上）與暗邊
      c.strokeStyle = rgba('bone', face ? 0.9 : 0.45); c.lineWidth = 1.5;
      c.beginPath(); c.roundRect(pad + 1.5, pad + 1.5, tw - 3, th - 3, r * 0.9); c.stroke();
      c.strokeStyle = rgba('sepia', 0.18); c.lineWidth = 1;
      c.beginPath(); c.roundRect(pad + 0.5, pad + 0.5, tw - 1, th - 1, r); c.stroke();
    };
    const uniq = [...new Set(rows.flat())];
    const faceIdx = new Map<string, number>();
    for (const ch of uniq) {
      const cv = makeCanvas(tw + pad * 2, th + thick + pad * 2, RES);
      body(cv.c, true);
      if (ch.trim()) {
        const c = cv.c;
        const size = tw * 0.74;
        if (ch === '♥') drawHeart(c, pad + tw / 2, pad + th / 2, size * 0.8, rgba('rose'));
        else {
          c.font = font(FAM_TILE, size);
          c.textAlign = 'center';
          // 刻出來的字：先畫一點點亮邊（凹下去的下緣受光），再畫字
          const col = RED.has(ch) ? sigInk(1, 3.2) : rgba('sepia', 0.95);
          c.fillStyle = rgba('bone', 0.9);
          c.fillText(ch, pad + tw / 2, pad + th / 2 + size * 0.36 + 1.2);
          c.fillStyle = col;
          c.fillText(ch, pad + tw / 2, pad + th / 2 + size * 0.36);
        }
      }
      faceIdx.set(ch, this.faces.length);
      this.faces.push(cv);
    }
    this.back = makeCanvas(tw + pad * 2, th + thick + pad * 2, RES);
    body(this.back.c, false);
    this.shadow = shadowSprite(tw, th + thick, Math.max(6, tw * 0.1), tw * 0.12);

    // ---- 時間：翻牌排在拍子的格子上（閱讀順序）；翻完的下一拍「推倒」＋「胡了」
    this.t1 = beatAfter(au, s + Math.min(0.3, B * 0.6));
    const n = rows.reduce((a, r) => a + r.length, 0);
    const budget = clamp(0.5 * (e - this.t1), 2 * B, 8 * B);
    const grid = onGrid(au, this.t1, n, budget);
    let k = 0;
    rows.forEach((row, j) => {
      const rw = row.length * (tw + gapX) - gapX;
      const x0 = bx + (m ? 0 : (blockW - rw) / 2);
      row.forEach((ch, i) => { this.tiles.push({ ch, x: x0 + i * (tw + gapX), y: by + j * rowH, tf: grid.times[k++]!, sprite: faceIdx.get(ch)! }); });
    });
    this.tDone = grid.times[n - 1]! + 0.25;
    this.tHu = au.timeOfBeat(Math.ceil(au.beatAt(this.tDone) - 1e-6) + 1);

    // ---- 署名：最後一行右下，手寫
    if (this.sig) {
      const sz = sigV2(tw * 0.74);
      const cv = (this.sigCv = makeCanvas(900, sz * 1.6, 1.5));
      cv.c.font = font(FAM_SIG, sz);
      cv.c.fillStyle = rgba('sepia', 0.85);
      cv.c.textAlign = 'right';
      cv.c.fillText(this.sig, 890, sz * 1.1);
      this.sigPos = { x: this.blockR.x1 - 900, y: this.blockR.y1 + 8 };
    }
    // ---- 「胡了」的牌子：木頭圓牌、紅字
    const md = Math.round(clamp(tw * 1.25, 80, 110));
    const mk = (this.marker = makeCanvas(md + 20, md + 26, 1.5));
    {
      const c = mk.c, r = md / 2, cx = r + 10, cy = r + 8;
      c.fillStyle = mixRgba('sepia', 'paper', 0.25);
      c.beginPath(); c.arc(cx, cy + 7, r, 0, Math.PI * 2); c.fill();
      const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      g.addColorStop(0, mixRgba('paper', 'bone', 0.6)); g.addColorStop(1, mixRgba('paper', 'sepia', 0.22));
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = sigInk(0.9, 3.2); c.lineWidth = 3;
      c.beginPath(); c.arc(cx, cy, r * 0.82, 0, Math.PI * 2); c.stroke();
      c.fillStyle = sigInk(1, 3.2);
      c.font = font(FAM_TILE, r * 0.62);
      c.textAlign = 'center';
      c.fillText('胡了', cx, cy + r * 0.22);
    }

    // ---- 籌碼：每一行歌詞排好（中文一字一枚、英文一個單字一枚），畫好三種狀態的小圖
    this.chipSize = lyricV2(m ? tw * 0.74 : null);
    for (const ln of lines.length ? lines : []) this.layoutChips(ln, subOf.get(ln) ?? null);

    // ---- 牌牆與骰子：第一拍擲骰；之後每兩個小節擲一次，另外那個小節推出一墩牌
    const bars: number[] = [];
    for (let k = Math.ceil(au.barAt(this.t1 + B) - 1e-6); bars.length < 24; k++) { const tb = au.timeOfBar(k); if (tb > e - B) break; bars.push(tb); }
    const rnd = (a: number, b: number) => hash(this.seed, a, b);
    this.rolls.push({ t: this.t1, a: 1 + Math.floor(rnd(1, 1) * 6), b: 1 + Math.floor(rnd(1, 2) * 6) });
    bars.forEach((tb, i) => {
      if (i % 2 === 1) this.rolls.push({ t: tb, a: 1 + Math.floor(rnd(i, 3) * 6), b: 1 + Math.floor(rnd(i, 4) * 6) });
      else this.pushes.push({ side: Math.floor(rnd(i, 5) * 4), i: 2 + Math.floor(rnd(i, 6) * (WALL.n - 4)), t: tb });
    });
    // 河：每兩拍打出一張（從第三拍開始），排在骰子上下兩排、一排六張
    const slots: [number, number][] = [];
    for (const yy of [-170, -100, 120, 190]) for (let i = 0; i < 6; i++) slots.push([-165 + i * 66, yy]);
    for (let k = 0, tt = au.timeOfBeat(au.beatAt(this.t1) + 2); tt < e - B && k < slots.length; k++, tt = au.timeOfBeat(au.beatAt(this.t1) + 2 + 2 * k)) {
      const sl = slots[k]!;
      this.discards.push({ f: Math.floor(rnd(k, 7) * 6), x: sl[0], y: sl[1], side: Math.floor(rnd(k, 8) * 4), t: tt, rot: (rnd(k, 9) - 0.5) * 0.16 });
    }
    for (let f = 0; f < 6; f++) this.dFaces.push(this.discardFace(f));
    this.wall = makeCanvas(WALL.r * 2 + 120, WALL.r * 2 + 120, 1.25);
    this.drawWall(this.wall.c, WALL.r + 60, WALL.r + 60, (side, i) => !this.pushes.some((p) => p.side === side && p.i === i));
  }

  /** 牌牆的一墩（兩層牌，牌背朝上）：以 (x, y) 為中心，沿著牆的方向寬 tw、深 td。 */
  private drawStack(c: CanvasRenderingContext2D, x: number, y: number) {
    const w = WALL.tw - 3, d = WALL.td;
    for (const [dy, a] of [[0, 1], [-7, 1]] as const) {
      c.fillStyle = rgba('sepia', 0.18);
      c.beginPath(); c.roundRect(x - w / 2 + 3, y - d / 2 + dy + 5, w, d, 4); c.fill();
      c.fillStyle = mixRgba('bone', 'paper', 0.5);
      c.beginPath(); c.roundRect(x - w / 2, y - d / 2 + dy + 3, w, d, 4); c.fill();
      c.fillStyle = mixRgba('signal', 'paper', 0.42);
      c.globalAlpha = a;
      c.beginPath(); c.roundRect(x - w / 2, y - d / 2 + dy, w, d - 3, 4); c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = rgba('bone', 0.5); c.lineWidth = 1;
      c.beginPath(); c.roundRect(x - w / 2 + 1, y - d / 2 + dy + 1, w - 2, d - 5, 3); c.stroke();
    }
  }

  /** 一圈四邊的牌牆（keep 回傳 false 的那一墩不畫：它會被推出來，每格另外畫）。 */
  private drawWall(c: CanvasRenderingContext2D, cx: number, cy: number, keep: (side: number, i: number) => boolean) {
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < WALL.n; i++) {
        if (!keep(side, i)) continue;
        const p = this.stackPos(side, i, 0);
        c.save();
        c.translate(cx + p.x, cy + p.y);
        c.rotate(p.rot);
        this.drawStack(c, 0, 0);
        c.restore();
      }
    }
  }

  /** 第 side 邊第 i 墩的位置（相對牌牆中心）與轉角；push = 往中間推出來多少。 */
  private stackPos(side: number, i: number, push: number) {
    // 風車形：每一邊從上一邊的角落之後開始排，四個角不會重疊
    const along = -WALL.r + WALL.td + (i + 0.5) * ((2 * WALL.r - WALL.td) / WALL.n);
    const out = WALL.r - WALL.td / 2 - push;
    const rot = (side * Math.PI) / 2;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    // 邊 0 在上面（y = −out），其他邊轉 90° 的倍數
    const x0 = along, y0 = -out;
    return { x: x0 * cs - y0 * sn, y: x0 * sn + y0 * cs, rot };
  }

  /** 河裡的牌（小張、牌面朝上）：f 0～2 是一到三筒（圓圈），3～5 是一到三條（竹子），都是圖案。 */
  private discardFace(f: number) {
    const w = 52, h = 68, th = 9;
    const cv = makeCanvas(w + 8, h + th + 8, 1.5);
    const c = cv.c;
    c.fillStyle = rgba('sepia', 0.16); c.beginPath(); c.roundRect(6, 7, w, h + th, 6); c.fill();
    c.fillStyle = mixRgba('signal', 'blood', 0.35); c.beginPath(); c.roundRect(4, 4 + th, w, h, 6); c.fill();
    c.fillStyle = mixRgba('bone', 'paper', 0.5); c.beginPath(); c.roundRect(4, 4 + th * 0.45, w, h, 6); c.fill();
    c.fillStyle = mixRgba('bone', 'paper', 0.12); c.beginPath(); c.roundRect(4, 4, w, h, 6); c.fill();
    const cx = 4 + w / 2, cy = 4 + h / 2;
    const n = (f % 3) + 1;
    if (f < 3) {
      // 筒：同心圓
      const pos: [number, number][] = n === 1 ? [[0, 0]] : n === 2 ? [[0, -15], [0, 15]] : [[-12, -18], [0, 0], [12, 18]];
      for (const [dx, dy] of pos) {
        const r = n === 1 ? 17 : 10;
        c.strokeStyle = sigInk(0.95, 3); c.lineWidth = 2.2; c.beginPath(); c.arc(cx + dx, cy + dy, r, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 1.2; c.beginPath(); c.arc(cx + dx, cy + dy, r * 0.5, 0, Math.PI * 2); c.stroke();
        c.fillStyle = sigInk(1, 3); c.beginPath(); c.arc(cx + dx, cy + dy, r * 0.18, 0, Math.PI * 2); c.fill();
      }
    } else {
      // 條：竹節
      const xs = n === 1 ? [0] : n === 2 ? [-9, 9] : [-14, 0, 14];
      for (const dx of xs) {
        c.strokeStyle = mixRgba('sepia', 'signal', 0.35); c.lineWidth = 5; c.lineCap = 'round';
        c.beginPath(); c.moveTo(cx + dx, cy - 22); c.lineTo(cx + dx, cy + 22); c.stroke();
        c.strokeStyle = mixRgba('bone', 'paper', 0.1); c.lineWidth = 1.5;
        for (const yy of [-8, 8]) { c.beginPath(); c.moveTo(cx + dx - 3, cy + yy); c.lineTo(cx + dx + 3, cy + yy); c.stroke(); }
      }
    }
    return cv;
  }

  /** 一顆骰子：象牙白的圓角方塊、點（一點與四點是紅的，照麻將骰子的習慣）。 */
  private drawDie(c: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number, n: number, lift: number) {
    c.save();
    c.fillStyle = rgba('sepia', 0.22 - lift * 0.1);
    c.beginPath(); c.roundRect(x - size / 2 + 5 + lift * 30, y - size / 2 + 7 + lift * 40, size, size, size * 0.2); c.fill();
    c.translate(x, y - lift * 26); c.rotate(rot); c.scale(1 + lift * 0.25, 1 + lift * 0.25);
    const g = c.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    g.addColorStop(0, mixRgba('bone', 'paper', 0.05)); g.addColorStop(1, mixRgba('bone', 'paper', 0.6));
    c.fillStyle = g;
    c.beginPath(); c.roundRect(-size / 2, -size / 2, size, size, size * 0.2); c.fill();
    c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1; c.stroke();
    const P: Record<number, [number, number][]> = {
      1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    };
    c.fillStyle = n === 1 || n === 4 ? sigInk(1, 3.2) : rgba('sepia', 0.9);
    for (const [px, py] of P[n] ?? []) { c.beginPath(); c.arc(px * size * 0.26, py * size * 0.26, n === 1 ? size * 0.14 : size * 0.085, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }

  /** 一行歌詞的籌碼：放不下一排就縮小，還放不下折兩排。 */
  private layoutChips(ln: Line, sub: Line | null) {
    const words = ln.words.filter((w) => w.w.trim());
    const { size, ws, gap, rows } = chipRows(words.map((w) => w.w.trim()), this.chipSize, 40);
    // 韓文原文副行：一排小一號的籌碼放在中文那排的正下方（原本最下面那排的位置），中文整排往上讓。
    // 原文一個詞一枚（同一個詞的音節黏在一起）
    const groups: Word[][] = [];
    if (sub) {
      let prev: Word | null = null;
      for (const w of sub.words) {
        if (!w.w.trim()) continue;
        if (!prev || /\s/.test(sub.text.slice(prev.o + prev.w.length, w.o))) groups.push([w]); else groups[groups.length - 1]!.push(w);
        prev = w;
      }
    }
    const gtext = (g: Word[]) => sub!.text.slice(g[0]!.o, g[g.length - 1]!.o + g[g.length - 1]!.w.length).trim();
    const S = groups.length ? chipRows(groups.map(gtext), subSizeFor(size), 26) : null;
    const lift = S ? (S.rows.length - 1) * S.size * 1.62 + (size + S.size) * 0.75 + size * 0.2 : 0;
    const chips: Chip[] = [];
    const ink: ReturnType<typeof makeCanvas>[] = [], hot: ReturnType<typeof makeCanvas>[] = [], faded: ReturnType<typeof makeCanvas>[] = [];
    const rowH = size * 1.62;
    rows.forEach((row, r) => {
      let x = CHIPS.x;
      const y = CHIPS.y - lift - (rows.length - 1 - r) * rowH;
      for (const i of row) {
        const w = ws[i]!;
        chips.push({ word: words[i]!, x, y, w, sprite: chips.length });
        for (const [arr, state] of [[ink, 0], [hot, 1], [faded, 2]] as const) arr.push(this.chipSprite(words[i]!.w.trim(), w, size, state));
        x += w + gap;
      }
    });
    let subSet: ChipLine['sub'];
    if (S) {
      // 原文的籌碼只有兩種：唱到、唱完都是「唱完」那一種（不用訊號色）、還沒唱是淡的
      subSet = { chips: [], lit: [], faded: [] };
      const mc = document.createElement('canvas').getContext('2d')!;
      mc.font = font(FAM_CHIP, S.size);
      S.rows.forEach((row, r) => {
        let x = CHIPS.x;
        const y = CHIPS.y - (S.rows.length - 1 - r) * S.size * 1.62;
        for (const i of row) {
          const w = S.ws[i]!, g = groups[i]!, text = gtext(g);
          // 籌碼上的字置中（chipSprite 畫在 4 + w/2）：每個音節從哪裡開始、多寬（逐字亮用）
          const tx = 4 + w / 2 - mc.measureText(text).width / 2;
          const offs = g.map((sy) => [mc.measureText(sub!.text.slice(g[0]!.o, sy.o)).width, mc.measureText(sy.w).width] as [number, number]);
          subSet!.chips.push({ words: g, x, y, w, tx, offs });
          subSet!.lit.push(this.chipSprite(text, w, S.size, 0));
          subSet!.faded.push(this.chipSprite(text, w, S.size, 2));
          x += w + S.gap;
        }
      });
    }
    this.chipLines.set(ln, { chips, ink, hot, faded, sub: subSet });
  }

  /** 籌碼的圖：圓角（英文單字是長圓形）、外圈一圈點點的邊、中間的字。state 0 = 唱完（墨）、1 = 正在唱（訊號色）、2 = 還沒唱（淡）。 */
  private chipSprite(word: string, w: number, size: number, state: number) {
    const h = size * 1.5;
    const cv = makeCanvas(w + 8, h + 12, 1.5);
    const c = cv.c;
    const r = h / 2;
    c.fillStyle = rgba('sepia', state === 2 ? 0.1 : 0.2);
    c.beginPath(); c.roundRect(4, 8, w, h, r); c.fill();
    c.fillStyle = state === 1 ? mixRgba('paper', 'signal', 0.35) : mixRgba('bone', 'paper', state === 2 ? 0.55 : 0.2);
    c.beginPath(); c.roundRect(4, 4, w, h, r); c.fill();
    c.strokeStyle = state === 1 ? sigInk(0.9, 3) : rgba('sepia', state === 2 ? 0.22 : 0.45);
    c.setLineDash([3, 5]); c.lineWidth = 2.5;
    c.beginPath(); c.roundRect(4 + h * 0.08, 4 + h * 0.08, w - h * 0.16, h * 0.84, r * 0.84); c.stroke();
    c.setLineDash([]);
    c.fillStyle = state === 1 ? rgba('blood') : rgba('sepia', state === 2 ? 0.32 : 0.92);
    c.font = font(FAM_CHIP, size);
    c.textAlign = 'center';
    c.fillText(word, 4 + w / 2, 4 + h / 2 + size * 0.36);
    return cv;
  }

  override dispose() {
    for (const f of this.faces) freeCanvas(f);
    for (const x of [this.back, this.shadow, this.marker, this.sigCv, this.wall, ...this.dFaces]) freeCanvas(x);
    for (const v of this.chipLines.values()) for (const a of [v.ink, v.hot, v.faded, v.sub?.lit ?? [], v.sub?.faded ?? []]) a.forEach(freeCanvas);
    super.dispose();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const B = this.B;
    // ---- 鏡頭：切進來時轉一點、拉遠一點 → 第一拍落定 → 轉盤似地很慢轉、推近
    const land = ease.outExpo(prog(t, s, this.t1 + B * 0.5));
    const drift = ease.inOutQuad(prog(t, this.t1, e));
    const rot = (1 - land) * -0.09 + 0.035 * (drift - 0.5);
    const sc = (0.9 + 0.1 * land) * (1 + 0.02 * drift) * (1 - 0.006 * pulse(t, this.tHu, 0.12));
    const cx = W * 0.5, cy = H * 0.48;
    const cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
    // 畫布：p' = c + R(rot)·sc·(p − c)；shader 要反過來（螢幕 → 桌面）
    const ics = Math.cos(-rot) / sc, isn = Math.sin(-rot) / sc;
    (this.felt.u.camInv!.value as THREE.Matrix3).set(ics, -isn, cx - ics * cx + isn * cy, isn, ics, cy - isn * cx - ics * cy, 0, 0, 1);
    this.felt.render(renderer, out);

    const L = this.L;
    L.clear();
    const c = L.ctx;
    c.setTransform(cs, sn, -sn, cs, cx - cs * cx + sn * cy, cy - sn * cx - cs * cy);

    // ---- 牌牆（不會動的部分一次貼上）、被推出來的墩、骰子
    const wl = this.wall!;
    c.drawImage(wl.cv, WALL.x - wl.w / 2, WALL.y - wl.h / 2, wl.w, wl.h);
    for (const p of this.pushes) {
      const k = ease.outBack(clamp((t - p.t) / (B * 0.5)), 2);
      const pos = this.stackPos(p.side, p.i, 20 * k);
      c.save();
      c.translate(WALL.x + pos.x, WALL.y + pos.y); c.rotate(pos.rot);
      this.drawStack(c, 0, 0);
      c.restore();
    }
    // 河：打出來的牌從牌牆的一邊滑進來，轉一下停在位置上
    for (const d of this.discards) {
      if (t < d.t) continue;
      const k = ease.outCubic(clamp((t - d.t) / 0.28));
      const a = (d.side * Math.PI) / 2;
      const ox = -Math.sin(a) * 260 * (1 - k), oy = Math.cos(a) * 260 * (1 - k);
      const img = this.dFaces[d.f]!;
      c.save();
      c.translate(WALL.x + d.x + ox, WALL.y + d.y + oy);
      c.rotate(d.rot + (1 - k) * 0.9);
      c.drawImage(img.cv, -img.w / 2, -img.h / 2, img.w, img.h);
      c.restore();
    }
    {
      // 最近一次擲骰：翻滾 0.8 拍（點數亂跳），落在拍點上停住
      let r = this.rolls[0]!;
      for (const x of this.rolls) if (t >= x.t) r = x;
      const u = clamp((t - r.t) / (B * 0.8));
      const tumbling = t >= r.t && u < 1;
      const lift = tumbling ? Math.abs(Math.sin(u * Math.PI * 2.5)) * (1 - u) : 0;
      const fi = frameIdx(t);
      for (const [j, n0] of [[0, r.a], [1, r.b]] as const) {
        const sp = (1 - ease.outCubic(u)) * (tumbling ? 1 : 0);
        const x = WALL.x - 44 + j * 88 + sp * (hash(r.t, j, 1) - 0.5) * 160;
        const y = WALL.y + 10 + (j ? -18 : 18) + sp * (hash(r.t, j, 2) - 0.5) * 120;
        const rot = (hash(r.t, j, 3) - 0.5) * 0.8 + sp * 9 * (j ? -1 : 1);
        const n = tumbling && u < 0.85 ? 1 + Math.floor(hash(fi >> 2, j, r.t) * 6) : n0;
        this.drawDie(c, x, y, 54, rot, n, lift);
      }
    }

    // ---- 牌
    const tw = this.tw, th = this.th, thick = this.thick;
    const huK = pulse(t, this.tHu, 0.07);
    for (const tl of this.tiles) {
      const u = clamp((t - tl.tf) / 0.26);
      const ang = Math.PI * ease.inOutCubic(u);
      const cosA = -Math.cos(ang); // −1 = 牌背朝上、1 = 牌面朝上
      const lift = Math.sin(ang) * 0.12 + 0.02 * pulse(t, tl.tf + 0.26, 0.06) - 0.015 * huK;
      const sx = 1 + lift, sy = Math.max(0.02, Math.abs(cosA)) * (1 + lift);
      const x = tl.x + tw / 2, y = tl.y + (th + thick) / 2;
      // 影子：浮起來時往右下拉開、變淡
      const sh = this.shadow!;
      c.save();
      c.globalAlpha = 0.22 - lift * 0.5;
      c.drawImage(sh.cv, x - tw / 2 - sh.pad + 4 + lift * 60, y - (th + thick) / 2 - sh.pad + 6 + lift * 80, sh.w, sh.h);
      c.restore();
      const img = cosA >= 0 ? this.faces[tl.sprite]! : this.back!;
      c.save();
      c.translate(x, y - lift * 40);
      c.scale(sx, sy);
      c.drawImage(img.cv, -img.w / 2, -img.h / 2, img.w, img.h);
      // 翻到側面時比較暗
      if (Math.abs(cosA) < 0.999) { c.globalAlpha = 0.3 * (1 - Math.abs(cosA)); c.fillStyle = rgba('sepia'); c.fillRect(-tw / 2, -img.h / 2, tw, img.h - 6); }
      c.restore();
    }
    // 署名
    if (this.sigCv) {
      const a = ease.outCubic(prog(t, this.tDone, this.tDone + 0.3));
      if (a > 0) { c.globalAlpha = a; c.drawImage(this.sigCv.cv, this.sigPos.x, this.sigPos.y, this.sigCv.w, this.sigCv.h); c.globalAlpha = 1; }
    }
    // 「胡了」牌子：從上面掉下來、彈一下
    if (t >= this.tHu - 0.18 && this.marker) {
      const u = clamp((t - (this.tHu - 0.18)) / 0.18);
      const k = u < 1 ? u * u : 1;
      const bounce = t > this.tHu ? Math.abs(Math.sin((t - this.tHu) * 16)) * Math.exp(-(t - this.tHu) * 7) * 0.08 : 0;
      const s2 = 1 + (1 - k) * 0.7 + bounce;
      const mk = this.marker;
      // 放在署名的左邊（最後一行下面、桌上），不要蓋到字
      const mx = this.blockR.x0 + mk.w * 0.5, my = this.blockR.y1 + mk.h * 0.55 + 6;
      c.save();
      c.translate(mx, my); c.rotate(-0.12); c.scale(s2, s2);
      c.globalAlpha = Math.min(1, u * 3);
      c.drawImage(mk.cv, -mk.w / 2, -mk.h / 2, mk.w, mk.h);
      c.restore();
    }
    // ---- 籌碼（歌詞）
    this.drawChips(c, t);
    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, L.upload(), out);

    let amp = 0;
    for (const tl of this.tiles) amp += 0.6 * pulse(t, tl.tf + 0.26, 0.04);
    amp = Math.min(amp, 2.5) + 6 * huK;
    for (const r of this.rolls) amp += 2 * pulse(t, r.t + B * 0.8, 0.05);
    for (const d of this.discards) amp += 0.8 * pulse(t, d.t + 0.28, 0.04);
    const ph = frameIdx(t);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.04, vignette: 0.3, grain: 0.05, shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2] };
  }

  /** 籌碼：這一格要顯示的歌詞行（提早 0.35 秒出現、唱完停 1.2 秒），唱到的那枚跳起來。 */
  private drawChips(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    if (!this.msg) {
      c.fillStyle = rgba('sepia', 0.55);
      c.font = font(F.hei(500), 20);
      c.letterSpacing = '3px';
      c.fillText(T17_INVITE, CHIPS.x, CHIPS.y + this.chipSize * 1.5 + 44);
      c.letterSpacing = '0px';
    }
    if (!lyrics.has) {
      c.fillStyle = rgba('sepia', 0.7);
      c.font = font(F.mono(500), 22);
      c.letterSpacing = '5px';
      c.fillText(`♪ ${song.title}`, CHIPS.x, CHIPS.y + 40);
      c.letterSpacing = '0px';
      return;
    }
    const ln = lyrics.shownLine(t, 1.2, 0.35);
    if (!ln) return;
    const set = this.chipLines.get(ln);
    if (!set) return;
    const kin = clamp((t - (ln.start - 0.35)) / 0.35), kout = 1 - clamp((t - ln.end - 0.6) / 0.6);
    const k = Math.min(kin, kout);
    set.chips.forEach((ch, i) => {
      const p = Lyrics.wordProgress(ch.word, t);
      const img = p <= 0 ? set.faded[i]! : p < 1 ? set.hot[i]! : set.ink[i]!;
      // 一枚一枚放上桌（進場時從上面落下來一點點）、唱到的那一下跳起來
      const drop = (1 - ease.outCubic(clamp((t - (ln.start - 0.35) - i * 0.02) / 0.25))) * 18;
      const hop = p > 0 && p < 1 ? 7 * Math.sin(Math.PI * clamp((t - ch.word.start) / 0.22)) : 0;
      c.globalAlpha = k;
      c.drawImage(img.cv, ch.x - 4, ch.y - img.h / 2 - drop - hop, img.w, img.h);
    });
    // 原文那排：一樣一枚一枚放上桌；一枚是一個詞，唱到哪個音節就亮到哪（淡的籌碼上蓋一層亮的、切到唱到的位置），
    // 唱到的那一下跳一點點；唱到、唱完都淡兩成（不用訊號色）；逐字時間是原文自己的
    set.sub?.chips.forEach((ch, i) => {
      const drop = (1 - ease.outCubic(clamp((t - (ln.start - 0.35) - 0.1 - i * 0.02) / 0.25))) * 12;
      let lit = 0, hop = 0;
      ch.words.forEach((w, j) => {
        const p = Lyrics.wordProgress(w, t);
        if (p <= 0) return;
        const [o, ww] = ch.offs[j]!;
        lit = j === ch.words.length - 1 && p >= 1 ? Infinity : ch.tx + o + ww * p;
        if (p < 1) hop = 4 * Math.sin(Math.PI * clamp((t - w.start) / 0.22));
      });
      const fd = set.sub!.faded[i]!, lt = set.sub!.lit[i]!;
      const x0 = ch.x - 4, y0 = ch.y - fd.h / 2 - drop - hop;
      c.globalAlpha = k;
      if (lit < Infinity) c.drawImage(fd.cv, x0, y0, fd.w, fd.h);
      if (lit > 0) {
        c.save();
        if (lit < Infinity) { c.beginPath(); c.rect(x0, y0 - 4, lit, fd.h + 8); c.clip(); }
        c.globalAlpha = k * 0.8;
        c.drawImage(lt.cv, x0, y0, lt.w, lt.h);
        c.restore();
      }
    });
    c.globalAlpha = 1;
  }
}
