// 填字遊戲（亮）：鏡頭貼著桌上一份《愛的日報》週末益智版，一支訊號色的鉛筆正在作答。
//  - 格子是真的填字遊戲的樣子：白格、黑格（詞與詞之間）、格子左上角的小編號。上半部是「1 橫」——主打留言（畫面的焦點）：
//    從第一拍起一格一個字、落在拍點上寫進去（一拍一、二、四或八格，長留言兩小節內也寫得完），鉛筆跟著一格一格跳。
//    英文照填字遊戲的規矩寫成大寫、單字不拆、空白是黑格。留言的字最大（手寫）。
//  - 下面隔一排黑格是「♪ 橫」——正在唱的那句歌詞（字小一號）：句子一出現就先淡淡地打好鉛筆稿（三成），唱到的字那一刻描實，
//    正在唱的是訊號色的暗部，唱完是鉛筆的墨色；下一句來之前先被擦掉。一句太長、三排放不下，就像翻頁一樣換到下一段。
//  - 留言寫完的下一拍：螢光筆（訊號色）一排一排劃過去。
//  - 鏡頭：紙微微往後倒（透視）、淺景深（格子清楚、報頭與提示欄是虛的）；第一拍紙被「拍平」、鏡頭推近，
//    寫留言時鏡頭對著留言，寫完慢慢搖到整個格子，整個窗格一直很慢地推。
//  - 冷面的小字（小、淡、在焦外）：報頭、期號、提示欄（「本婚姻的保固期限（2）」）、倒過來印的解答。
//  - 沒有留言：「1 橫」是鉛筆淡淡寫的邀請；純音樂：「♪ 橫」一拍一格寫曲名。
// 畫法：紙與桌面、透視、景深是 _t3 的文件攝影機（shader）；不會變的版面（報頭、格線、提示）開場畫在一張離屏畫布，
// 每格把它貼進文件圖層、再畫會變的（填進去的字、螢光筆、鉛筆、歌詞那幾排的黑格），整張上傳一次。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { wrap } from '../engine/text';
import { signature, drawHeart } from './_motifs';
import { grid, stagger, windowLines, mono, tag, pad3, DocCam, withMips, drawPencil, HUD, EDGE, type Grid, type Pose } from './_t3';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 文件（報紙）座標，y 向下
const DW = 1700, DH = 1240;
const TS = SCALE * 1.3; // 文件圖層每個文件 px 幾個像素（鏡頭會推近）
const PAGE: [number, number, number, number] = [50, 20, 1640, 1380];
const GX = 170, GY = 196; // 格子左上角
const GRID_H = 760;
/** 鏡頭的平均縮放（文件 px → 螢幕 px）：v2 的字級、留言區都是螢幕上的大小，排版時用它換算。 */
const K = 1.03;
/** 直的提示（2～5）的答案：平面圖畫完之後，每個小節線鉛筆去解一題（劃掉提示、寫上答案）。 */
const ANSWERS = ['網球', '永久', '一家', '平手'];
const MSG_FAM = F.hand(700);
const LYR_FAM = F.archivo(100, 800);
const FIXED = '愛的日報週末益智版年月日星期六第期填字遊戲主題一起提示此刻正在唱的一句芃芃最愛的圓形物體本婚姻的保固期限兩人加兩隻狗搶棉被冠軍解答網球永久一家平手想對新人說的話格掃描右下角的寫下你的祝福本曲曲名純音樂新人';
const INVITE = '掃描右下角的ＱＲ寫下你的祝福';

const PAPER_GLSL = /* glsl */ `
vec3 paperCol(vec2 d, vec4 fb) {
  // 新聞紙：比一般的紙灰一點、纖維明顯；下面一道對摺的摺痕；焦點附近被檯燈照亮一點
  vec3 p = mix(C_PAPER, C_ASH, 0.12) * (0.91 + 0.14 * (fb.r - 0.5) + 0.07 * (fb.g - 0.5));
  float fy = d.y - 1150.0;
  p *= 1.0 - 0.045 * exp(-abs(fy) * 0.08) * sign(fy) - 0.03 * exp(-abs(fy) * 0.4);
  p *= 0.93 + 0.08 * exp(-dot((d - focus) / vec2(900.0, 700.0), (d - focus) / vec2(900.0, 700.0)));
  // 窗外樹葉的影子慢慢在紙上漂（桌面也是同一道光）：畫面一直有空氣在動
  return p * (0.94 + 0.07 * dapple(SCR, t));
}
vec3 deskCol(vec2 s, vec4 fb) {
  // 桌面不要太暗：右下角的 QR 與「已收到 N 則祝福」是深色字，要讀得到
  float grain = fbm(vec2(s.x / 900.0, s.y / 26.0), 3);
  return mix(C_PAPER, C_SEPIA, 0.22 + 0.05 * grain) * (0.9 + 0.1 * fb.r) * (0.88 + 0.13 * dapple(s, t));
}`;

// ---------------------------------------------------------------- 排格子
/** 一格：第幾排第幾欄、寫什麼。wi / ki / kn：第幾個字、字裡的第幾個字母、共幾個字母。黑格 = 沒列出來的。 */
interface Cell { r: number; c: number; ch: string; wi: number; ki: number; kn: number }
const isLatin = (ch: string) => /[A-Za-z0-9'’&\-]/.test(ch);

/**
 * 把一串「字」（中文一字、英文一個單字）照填字遊戲的規矩排進 nc 欄：英文字不拆（除非比一整排還長）、
 * 字與字之間原本有空白的放一個黑格、排尾剩下的都是黑格。回傳白格與用了幾排。
 */
function flow(words: { w: string; space: boolean }[], nc: number): { cells: Cell[]; rows: number } {
  const cells: Cell[] = [];
  let r = 0, c = 0;
  words.forEach((wd, wi) => {
    const chars = Array.from(wd.w.toUpperCase()).filter((ch) => ch !== ' ');
    if (!chars.length) return;
    const n = chars.length;
    // 一個詞組（到下一個空白為止，中文歌詞常用空白分詞組）排得進一整排、但這一排剩下的放不下：整組換到下一排
    if (c > 0 && (wi === 0 || words[wi - 1]!.space)) {
      let pl = 0;
      for (let k = wi; k < words.length; k++) { pl += Array.from(words[k]!.w).filter((ch) => ch !== ' ').length; if (words[k]!.space) break; }
      if (c + pl > nc && pl <= nc) { r++; c = 0; }
    }
    if (c > 0 && c + n > nc && n <= nc) { r++; c = 0; }
    chars.forEach((ch, ki) => {
      if (c >= nc) { r++; c = 0; }
      cells.push({ r, c, ch, wi, ki, kn: n });
      c++;
    });
    if (wd.space && c > 0) { c++; if (c >= nc) { r++; c = 0; } }
  });
  return { cells, rows: c === 0 ? r : r + 1 };
}

/** 留言 → 字串列：中文一字、英文一個單字一組、空白記在前一組後面。 */
function msgWords(text: string): { w: string; space: boolean }[] {
  const out: { w: string; space: boolean }[] = [];
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === ' ') { if (out.length) out[out.length - 1]!.space = true; continue; }
    if (isLatin(ch)) {
      let w = ch;
      while (i + 1 < chars.length && isLatin(chars[i + 1]!)) w += chars[++i];
      out.push({ w, space: false });
    } else out.push({ w: ch, space: false });
  }
  return out;
}

/** 歌詞一行 → 字串列（Word 本身就是一組；Word 後面原本有空白就記下來）。 */
function lineWords(line: Line): { w: string; space: boolean }[] {
  return line.words.map((w, i) => {
    const nx = line.words[i + 1];
    const end = w.o + w.w.length;
    return { w: w.w, space: nx ? nx.o > end || line.text[end] === ' ' : false };
  });
}

interface LyrLay { line: Line; cells: Cell[]; rows: number; tIn: number; tOut: number }

export default class Crossword extends Scene {
  cam = shared('crossword.cam', () => new DocCam(PAPER_GLSL));
  base = this.track(new Layer2D(DW, DH, TS));
  doc = this.track(withMips(new Layer2D(DW, DH, TS, { fast: true })));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  nc = 12; cs = 80; msgRows = 2; lyrRows = 2;
  msgCells: Cell[] = [];
  msgTimes: number[] = [];
  msgDone = 0;
  lyr: LyrLay[] = [];
  titleCells: Cell[] = [];
  titleTimes: number[] = [];
  instr = false;
  clueX = 0;
  /** 留言的字級（文件 px）與它在螢幕上的大小、歌詞與署名的字級（文件 px）。 */
  msgSize = 50; msgScreen: number | null = null; lyrSize = 48; sigSize = 30;
  /** 提示在紙上的位置（劃掉用）與解題的時間。 */
  clues: { n: string; x: number; y: number; w: number }[] = [];
  solves: { i: number; t: number }[] = [];
  /** 鏡頭的安全位移（格子投影後不能碰到邊、不能進右下角 HUD），init 算一次。 */
  shift = { x: 0, y: 0 };
  private baseDrawn = false;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const m = this.msg;
    const wl = windowLines(lyrics, s, e);
    this.instr = wl.length === 0;
    await loadText(`${FIXED}${INVITE}${song.title}${m ? m.text + signature(m.name) : ''}${wl.map((l) => l.text).join('')}`);
    const mw = msgWords(m ? m.text : INVITE);
    // 欄數：8～15 欄。v2：留言的字（格子 × 0.74）在螢幕上 40～60（依字數，msgMaxFor），留言那幾排 ≤ 820 × 400（螢幕 px）；
    // 挑格子最大的，一樣大挑欄數少的（格子區窄一點、場景露多一點）；一句歌詞要翻頁（超過三排）比較難讀，扣分
    const mMax = msgMaxFor(m ? m.text : INVITE);
    let best = { nc: 12, cs: 0, mr: 1, lr: 1, score: -1e9 };
    for (let nc = 8; nc <= 15; nc++) {
      const mr = flow(mw, nc).rows;
      // 純音樂：♪ 那幾排寫曲名（最多兩排）
      const raw = this.instr ? clamp(flow(msgWords(song.title || '純音樂'), nc).rows, 1, 2) : Math.max(1, ...wl.map((l) => flow(lineWords(l), nc).rows));
      const lr = clamp(raw, 1, 3);
      const cs = Math.floor(Math.min(mMax / (0.74 * K), 820 / (nc * K), 400 / (mr * K), GRID_H / (mr + 1 + lr)));
      const score = cs - (raw > 3 ? 10 : 0) - (cs * 0.74 * K < V2.msgMin ? 100 : 0);
      if (score > best.score + 0.5) best = { nc, cs, mr, lr, score };
    }
    this.nc = best.nc; this.cs = best.cs; this.msgRows = best.mr; this.lyrRows = best.lr;
    this.msgSize = this.cs * 0.74;
    this.msgScreen = m ? this.msgSize * K : null;
    // 歌詞比留言小一點（lyricV2），也不超過格子；署名 26～32
    this.lyrSize = Math.max(V2.lyrMin / K, Math.min(this.cs * 0.64, lyricV2(this.msgScreen) / K));
    this.sigSize = sigV2(this.msgSize * K) / K;
    this.clueX = GX + this.nc * this.cs + 80;
    this.msgCells = flow(mw, this.nc).cells;
    const maxDur = clamp((e - g.b0) * 0.45, g.beat * 2, g.bar * 1.6);
    this.msgTimes = stagger(au, g.b0, this.msgCells.length, maxDur);
    this.msgDone = this.msgTimes[this.msgTimes.length - 1] ?? g.b0;
    this.lyr = wl.map((l) => { const f = flow(lineWords(l), this.nc); return { line: l, cells: f.cells, rows: f.rows, tIn: l.start - 0.35, tOut: Infinity }; });
    this.lyr.forEach((x, i) => { const nx = this.lyr[i + 1]; x.tOut = nx ? nx.tIn : Math.max(x.line.end + 3, e + 1); });
    if (this.instr) {
      this.titleCells = flow(msgWords(song.title || '純音樂'), this.nc).cells.filter((c) => c.r < this.lyrRows);
      this.titleTimes = stagger(au, g.bar0, this.titleCells.length, Math.max(g.beat * 2, (e - g.bar0) * 0.6));
    }
    // 鏡頭推到最近（窗格結束）時格子投影的範圍：碰到邊或 HUD 就把整個畫面往左上挪
    const gw = this.nc * this.cs, gh = (this.msgRows + 1 + this.lyrRows) * this.cs;
    for (let it = 0; it < 3; it++) {
      let left = 0, up = 0, right = 0;
      for (const tt of [e, this.msgDone + g.bar]) {
        this.cam.pose(this.pose(tt), DW, DH);
        // 格子四角＋署名那一行
        const pts = [this.cam.project(GX, GY), this.cam.project(GX + gw, GY), this.cam.project(GX, GY + gh), this.cam.project(GX + gw, GY + gh), this.cam.project(GX + gw, GY + gh + this.sigSize * 1.6)];
        for (const p of pts) {
          if (p.y > HUD.y - 10 && p.x > HUD.x - 20) left = Math.max(left, p.x - (HUD.x - 20));
          if (p.y > 1080 - EDGE) up = Math.max(up, p.y - (1080 - EDGE));
          if (p.x < EDGE + 10) right = Math.max(right, EDGE + 10 - p.x);
        }
      }
      this.shift.x += right - left; this.shift.y -= up;
    }
    // 解題：留言寫完、螢光筆劃過之後的每個小節線解一題（直的 2～5）
    let k = 0;
    for (const b of g.bars) {
      if (k >= ANSWERS.length) break;
      if (b < this.msgDone + g.beat * 2.2 || b > e - g.beat * 1.2) continue;
      this.solves.push({ i: k++, t: b });
    }
  }

  /** 鏡頭：第一拍前比較遠、比較歪，第一拍「拍平」推近；寫留言時看留言，寫完搖到整個格子；整個窗格一直慢慢推。 */
  private pose(t: number): Pose {
    const g = this.g, cs = this.cs;
    const gw = this.nc * cs;
    const msgC = GY + (this.msgRows * cs) / 2, allC = GY + ((this.msgRows + 1 + this.lyrRows) * cs) / 2;
    const settle = ease.outBack(prog(t, g.b0 - 0.02, g.b0 + 0.36), 1.3);
    const toAll = ease.inOutCubic(prog(t, this.msgDone + g.beat, this.msgDone + g.beat + g.bar));
    const slow = ease.inOutCubic(prog(t, this.ctx.start, this.ctx.end));
    return {
      // 格子放在畫面左邊（中心約在螢幕 x ≈ 500～700），右邊留給提示欄、鉛筆解題與光影
      x: GX + 700 - gw * 0.1, y: lerp(lerp(msgC, allC, 0.45), allC, toAll),
      z: lerp(0.94, 1.02, settle) + 0.05 * slow,
      roll: lerp(-0.07, -0.035, settle) + 0.01 * slow, tilt: 0.34 - 0.04 * slow, pan: -0.06 + 0.05 * slow,
      sx: 900 + this.shift.x, sy: 548 + this.shift.y,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    if (!this.baseDrawn) { this.drawBase(); this.baseDrawn = true; }
    const D = this.doc; D.clear();
    const c = D.ctx;
    c.drawImage(this.base.canvas, 0, 0, DW, DH);
    this.drawMsg(c, t);
    const head = this.drawLyrics(c, t);
    const solve = this.drawSolves(c, t);
    this.drawPencil(c, t, head, solve);
    D.upload();
    const cs = this.cs, gw = this.nc * cs, gh = (this.msgRows + 1 + this.lyrRows) * cs;
    this.cam.pose(this.pose(t), DW, DH);
    // 解題的時候焦點往提示欄移一點（拉焦），解完回到格子
    let fs = 0;
    for (const sv of this.solves) fs = Math.max(fs, prog(t, sv.t - 0.25, sv.t + 0.1, ease.inOutCubic) * (1 - prog(t, sv.t + this.g.beat * 1.2, sv.t + this.g.beat * 2.2, ease.inOutCubic)));
    this.cam.render(renderer, out, {
      tex: D.texture, docW: DW, docH: DH, texScale: TS, rect: PAGE, t,
      focus: { x: GX + gw / 2 + fs * 260, y: GY + gh / 2 }, focusR: [gw * 0.54 + 60 + fs * 120, gh * 0.56 + 60], blur: 7, shadow: [16, 26],
    });
    return { paper: 1, bloom: 0.25, vignette: 0.34, grain: 0.05, halation: 0.08, zoom: 1 + 0.003 * pulse(t, this.g.b0 + 0.05, 0.1) };
  }

  // ------------------------------------------------------------ 不會變的版面（報頭、格線、提示）
  private drawBase() {
    const c = this.base.ctx;
    this.base.clear();
    c.textBaseline = 'alphabetic';
    const ink = (a: number) => rgba('sepia', a);
    // 報頭（小、淡）
    c.font = font(F.ming(900), 24); c.fillStyle = ink(0.8);
    c.fillText('愛的日報', GX, 100);
    mono(c, '週末益智版 · 2027.03.13 · 第 0313 期', GX + 1380, 98, { size: 15, color: ink(0.55), align: 'right', tracking: 2 });
    c.fillStyle = ink(0.75); c.fillRect(GX, 114, 1380, 2.5);
    c.fillStyle = ink(0.45); c.fillRect(GX, 120, 1380, 1);
    tag(c, '填字遊戲　·　主題：一起', GX, 160, { size: 21, color: ink(0.7), tracking: 3, weight: 700 });
    // 格子
    const { nc, cs } = this;
    const nr = this.msgRows + 1 + this.lyrRows;
    const white = new Set(this.msgCells.map((x) => `${x.r},${x.c}`));
    c.fillStyle = mixRgba('paper', 'bone', 0.4);
    c.fillRect(GX, GY, nc * cs, nr * cs);
    c.fillStyle = ink(0.92);
    for (let r = 0; r <= this.msgRows; r++) for (let cc = 0; cc < nc; cc++) {
      if (r < this.msgRows && white.has(`${r},${cc}`)) continue;
      c.fillRect(GX + cc * cs, GY + r * cs, cs, cs);
    }
    c.fillStyle = ink(0.5);
    for (let r = 1; r < nr; r++) c.fillRect(GX, GY + r * cs - 0.7, nc * cs, 1.4);
    for (let cc = 1; cc < nc; cc++) c.fillRect(GX + cc * cs - 0.7, GY, 1.4, nr * cs);
    c.strokeStyle = ink(0.92); c.lineWidth = 4;
    c.strokeRect(GX, GY, nc * cs, nr * cs);
    // 編號：每個「橫」或「直」的開頭（跟真的填字遊戲一樣自動編號）
    let num = 1;
    c.font = font(F.mono(500), Math.round(cs * 0.19)); c.fillStyle = ink(0.6);
    for (let r = 0; r < this.msgRows; r++) for (let cc = 0; cc < nc; cc++) {
      if (!white.has(`${r},${cc}`)) continue;
      const across = !white.has(`${r},${cc - 1}`) && white.has(`${r},${cc + 1}`);
      const down = !white.has(`${r - 1},${cc}`) && white.has(`${r + 1},${cc}`);
      if (across || down) { c.fillText(String(num), GX + cc * cs + 5, GY + r * cs + cs * 0.23); num++; }
    }
    c.fillText('♪', GX + 5, GY + (this.msgRows + 1) * cs + cs * 0.24);
    // 提示欄（在焦外：小字、淡）
    const x = this.clueX, cw = 330;
    let y = GY + 20;
    const head = (s: string, en: string) => {
      tag(c, s, x, y, { size: 22, color: ink(0.8), tracking: 2, weight: 900 });
      mono(c, en, x + 40, y - 2, { size: 13, color: ink(0.5), tracking: 3 });
      c.fillStyle = ink(0.5); c.fillRect(x, y + 12, cw, 1.2);
      y += 48;
    };
    const clue = (n: string, s: string) => {
      c.font = font(F.mono(600), 18); c.fillStyle = ink(0.7); c.fillText(n, x, y);
      c.font = font(F.hei(500), 20); c.fillStyle = ink(0.66);
      const ls = wrap(c, s, cw - 36);
      ls.forEach((ln, i) => c.fillText(ln, x + 32, y + i * 27));
      if (/^[2-5]$/.test(n)) this.clues.push({ n, x: x + 32, y: y + (ls.length - 1) * 27, w: c.measureText(ls[ls.length - 1]!).width });
      y += (ls.length - 1) * 27 + 38;
    };
    const m = this.msg;
    head('橫', 'ACROSS');
    clue('1', m ? `${m.couple ? '新人' : m.name || '一位賓客'}想對新人說的話（${this.msgCells.length} 格）` : '你想對新人說的話（掃描右下角 QR code 作答）');
    clue('♪', this.instr ? '本曲曲名（純音樂）' : '此刻正在唱的一句');
    y += 8;
    head('直', 'DOWN');
    clue('2', '芃芃最愛的圓形物體（2）');
    clue('3', '本婚姻的保固期限（2）');
    clue('4', '兩人加兩隻狗（2）');
    clue('5', '搶棉被冠軍（2）');
    c.save();
    c.translate(x + cw, y + 30); c.rotate(Math.PI);
    c.font = font(F.hei(500), 16); c.fillStyle = ink(0.45);
    c.fillText('解答：2 網球　3 永久　4 一家　5 平手', 0, 0);
    c.restore();
  }

  private cellXY(r: number, cc: number) { return { x: GX + cc * this.cs, y: GY + r * this.cs }; }

  // ------------------------------------------------------------ 1 橫：留言（焦點）
  private drawMsg(c: CanvasRenderingContext2D, t: number) {
    const cs = this.cs, m = this.msg;
    const size = this.msgSize;
    // 寫完的下一拍：螢光筆一排一排劃過去（畫在字底下）
    const tHi = this.msgDone + this.g.beat;
    for (let r = 0; r < this.msgRows; r++) {
      const row = this.msgCells.filter((x) => x.r === r);
      if (!row.length) continue;
      const t0 = tHi + r * Math.min(0.14, this.g.beat / 2);
      const u = prog(t, t0, t0 + 0.2, ease.outCubic);
      if (u <= 0) continue;
      const c0 = row[0]!.c, c1 = row[row.length - 1]!.c + 1;
      const p = this.cellXY(r, c0);
      c.fillStyle = rgba('signal', 0.4);
      c.beginPath();
      const w = (c1 - c0) * cs * u;
      c.moveTo(p.x + 4, p.y + cs * 0.2); c.lineTo(p.x + w, p.y + cs * 0.16); c.lineTo(p.x + w - 6, p.y + cs * 0.86); c.lineTo(p.x + 2, p.y + cs * 0.9);
      c.closePath(); c.fill();
    }
    c.font = font(MSG_FAM, size);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    this.msgCells.forEach((cell, i) => {
      const ti = this.msgTimes[i]!;
      if (t < ti) return;
      const u = prog(t, ti, ti + 0.12, ease.outBack);
      const p = this.cellXY(cell.r, cell.c);
      // 手寫：每一格一點點歪、一點點偏
      const jr = (hash(i, 3) - 0.5) * 0.12, jx = (hash(i, 5) - 0.5) * cs * 0.06, jy = (hash(i, 7) - 0.5) * cs * 0.05;
      c.save();
      c.translate(p.x + cs / 2 + jx, p.y + cs * 0.54 + jy);
      c.rotate(jr);
      c.scale(lerp(1.35, 1, u), lerp(1.35, 1, u));
      if (cell.ch === '♥') drawHeart(c, 0, 0, size * 0.72);
      else { c.fillStyle = m ? rgba('sepia', 0.94) : rgba('sepia', 0.45); c.fillText(cell.ch, 0, size * 0.36); }
      c.restore();
    });
    c.textAlign = 'left';
    // 署名：格子右下角外面（鉛筆字）
    if (m) {
      const a = prog(t, this.msgDone + 0.2, this.msgDone + 0.5);
      if (a > 0) {
        c.save(); c.globalAlpha *= a;
        // 署名永遠在整個格子下面（v2：26～32 px），不會跟留言重疊
        c.font = font(F.hand(400), this.sigSize); c.fillStyle = rgba('sepia', 0.82); c.textAlign = 'right';
        c.fillText(signature(m.name), GX + this.nc * cs, GY + (this.msgRows + 1 + this.lyrRows) * cs + this.sigSize * 1.3);
        c.textAlign = 'left';
        c.restore();
      }
    }
  }

  // ------------------------------------------------------------ ♪ 橫：歌詞
  /** 回傳鉛筆該在的位置（正在唱的那一格）。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number): { x: number; y: number; t0: number } | null {
    const cs = this.cs, R0 = this.msgRows + 1, nr = this.lyrRows;
    const size = this.lyrSize;
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    if (this.instr) {
      c.font = font(LYR_FAM, size);
      this.blackRows(c, R0, nr, new Set(this.titleCells.map((x) => `${x.r},${x.c}`)));
      this.titleCells.forEach((cell, i) => {
        const ti = this.titleTimes[i]!;
        if (t < ti) return;
        const u = prog(t, ti, ti + 0.14, ease.outBack);
        const p = this.cellXY(R0 + cell.r, cell.c);
        c.save(); c.translate(p.x + cs / 2, p.y + cs * 0.54); c.scale(lerp(1.3, 1, u), lerp(1.3, 1, u));
        c.fillStyle = rgba('sepia', 0.9); c.fillText(cell.ch, 0, size * 0.36);
        c.restore();
      });
      c.textAlign = 'left';
      return null;
    }
    const cur = this.lyr.find((x) => t >= x.tIn - 0.3 && t < x.tOut) ?? null;
    if (!cur) { this.blackRows(c, R0, nr, new Set()); c.textAlign = 'left'; return null; }
    const ln = cur.line;
    // 一句超過 nr 排：照唱到的位置翻頁
    let active = -1;
    cur.cells.forEach((cell, i) => { if (t >= ln.words[cell.wi]!.start) active = i; });
    // 頁數平均分（四排分成二＋二，不要三＋一）
    const per = Math.ceil(cur.rows / Math.ceil(cur.rows / nr));
    const page = Math.floor((cur.cells[Math.max(0, active)]?.r ?? 0) / per);
    const shown = cur.cells.filter((x) => Math.floor(x.r / per) === page);
    const erase = 1 - prog(t, cur.tOut - 0.25, cur.tOut);
    const inK = prog(t, cur.tIn - 0.3, cur.tIn);
    this.blackRows(c, R0, nr, new Set(shown.map((x) => `${x.r - page * per},${x.c}`)));
    c.font = font(LYR_FAM, size);
    let head: { x: number; y: number; t0: number } | null = null;
    for (const cell of shown) {
      const wd = ln.words[cell.wi]!;
      const pr = Lyrics.wordProgress(wd, t);
      // 這個字母在字裡的位置：唱到它的那一刻描實
      const on = pr * cell.kn > cell.ki + 0.02 || pr >= 1;
      const singing = pr > 0 && pr < 1;
      const p = this.cellXY(R0 + cell.r - page * per, cell.c);
      const cx = p.x + cs / 2, cy = p.y + cs * 0.54;
      c.save();
      c.globalAlpha *= erase;
      if (!on) { c.fillStyle = rgba('sepia', 0.24 * inK); c.fillText(cell.ch, cx, cy + size * 0.36); }
      else {
        const tOn = wd.start + ((cell.ki + 0.02) / cell.kn) * (wd.end - wd.start);
        const u = prog(t, tOn, tOn + 0.1, ease.outBack);
        c.translate(cx, cy); c.scale(lerp(1.25, 1, u), lerp(1.25, 1, u));
        c.fillStyle = singing ? rgba('blood') : rgba('sepia', 0.9);
        c.fillText(cell.ch, 0, size * 0.36);
        if (singing) head = { x: cx, y: cy, t0: tOn };
      }
      c.restore();
    }
    // 擦掉：一層淡淡的橡皮擦痕
    if (erase < 1) {
      c.fillStyle = mixRgba('paper', 'ash', 0.25, (1 - erase) * 0.35);
      const p = this.cellXY(R0, 0);
      c.fillRect(p.x + 2, p.y + 2, this.nc * cs - 4, nr * cs - 4);
    }
    c.textAlign = 'left';
    return head;
  }

  /**
   * 歌詞那幾排沒用到的格子：不塗黑，塗淺淺的網點灰（整片黑太重，畫面要能呼吸；真的報紙也有這種灰格）。
   * 不透明：文件層在線性空間疊，透一點紙色上來就跟底圖對不上。
   */
  private blackRows(c: CanvasRenderingContext2D, R0: number, nr: number, white: Set<string>) {
    const cs = this.cs;
    c.fillStyle = mixRgba('paper', 'sepia', 0.2);
    for (let r = 0; r < nr; r++) for (let cc = 0; cc < this.nc; cc++) {
      if (white.has(`${r},${cc}`)) continue;
      const p = this.cellXY(R0 + r, cc);
      c.fillRect(p.x + 0.7, p.y + 0.7, cs - 1.4, cs - 1.4);
    }
  }

  // ------------------------------------------------------------ 解題（小節線上的小事件）
  /** 劃掉提示、寫上答案；回傳鉛筆正在劃的位置（沒在解題回傳 null）。 */
  private drawSolves(c: CanvasRenderingContext2D, t: number): { x: number; y: number; t0: number } | null {
    let head: { x: number; y: number; t0: number } | null = null;
    const beat = this.g.beat;
    for (const sv of this.solves) {
      const cl = this.clues[sv.i];
      if (!cl || t < sv.t) continue;
      // 劃線（半拍）→ 寫答案（半拍）
      const u = prog(t, sv.t, sv.t + beat * 0.5, ease.inOutCubic);
      c.strokeStyle = rgba('sepia', 0.75); c.lineWidth = 2.4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cl.x - 4, cl.y - 7); c.lineTo(cl.x - 4 + (cl.w + 8) * u, cl.y - 8 + 2 * u); c.stroke();
      const ax = cl.x + cl.w + 16;
      const v = prog(t, sv.t + beat * 0.5, sv.t + beat, ease.outCubic);
      if (v > 0) {
        const ans = ANSWERS[sv.i]!;
        c.save();
        c.font = font(F.hand(700), 22); c.fillStyle = rgba('sepia', 0.9);
        const aw = c.measureText(ans).width;
        c.beginPath(); c.rect(ax - 2, cl.y - 26, aw * v + 4, 34); c.clip();
        c.fillText(ans, ax, cl.y);
        c.restore();
      }
      if (u < 1) head = { x: cl.x - 4 + (cl.w + 8) * u, y: cl.y - 7, t0: sv.t };
      else if (v < 1) head = { x: ax + 30 * v, y: cl.y - 6, t0: sv.t };
    }
    return head;
  }

  // ------------------------------------------------------------ 鉛筆
  /** 訊號色的鉛筆：筆尖停在剛寫的那一格（每寫一格就跳過去）、解題時跟著劃線，沒在寫時抬起來。 */
  private drawPencil(c: CanvasRenderingContext2D, t: number, lyrHead: { x: number; y: number; t0: number } | null, solve: { x: number; y: number; t0: number } | null) {
    const cs = this.cs;
    let tx: number, ty: number, t0: number, px: number, py: number, writing = false;
    // 筆身的方向：寫留言時往右上（留言在最上面幾排）；寫歌詞、休息時往右下，筆身才不會橫過留言
    let ang = -1.05;
    const i = this.msgTimes.findIndex((x) => x > t) - 1;
    const idx = i < -1 ? this.msgTimes.length - 1 : i;
    if (idx >= 0 && t < this.msgDone + 0.25) {
      const cell = this.msgCells[idx]!, prev = this.msgCells[Math.max(0, idx - 1)]!;
      const a = this.cellXY(cell.r, cell.c), b = this.cellXY(prev.r, prev.c);
      tx = a.x + cs * 0.72; ty = a.y + cs * 0.7; px = b.x + cs * 0.72; py = b.y + cs * 0.7; t0 = this.msgTimes[idx]!;
      writing = true;
    } else if (solve) {
      // 解題：筆從格子那邊飛過去（第一下用 outExpo，之後跟著劃線）
      tx = solve.x; ty = solve.y; px = GX + this.nc * cs + 26; py = GY + (this.msgRows + 0.5) * cs; t0 = solve.t0 - 0.12; writing = true;
      if (t > solve.t0) { px = tx; py = ty; }
    } else if (lyrHead) {
      tx = lyrHead.x + cs * 0.22; ty = lyrHead.y + cs * 0.2; px = tx - cs; py = ty; t0 = lyrHead.t0; writing = true; ang = 1.1;
    } else {
      // 休息：擱在格子右下角外面
      tx = GX + this.nc * cs + 30; ty = GY + (this.msgRows + 1 + this.lyrRows) * cs - 30; px = tx; py = ty; t0 = -1e9; ang = 0.55;
    }
    const u = prog(t, t0, t0 + 0.09, ease.outExpo);
    let x = lerp(px, tx, u), y = lerp(py, ty, u);
    if (writing) { x += Math.sin(t * 53) * 1.5; y += Math.sin(t * 37 + 1) * 2; }
    drawPencil(c, x, y, writing ? 0 : 16, { color: 'signal', ang });
    void pad3;
  }
}
