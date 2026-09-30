// 雙語口令（亮、dog、雙語）：公園草地上，宣文和孟庭訓練三隻狗。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - **兩行歌詞是兩個人的對話框**：宣文說中文口令（中文主行），孟庭說原文口令（原文副行），兩個對話框都照自己的逐字時間亮；
//    沒有翻譯的歌只有宣文的對話框，孟庭改成在旁邊點頭拍手（她的對話框收起來，不留空框）。換一句歌詞時對話框「啵」一下彈出來。
//  - 每個小節四拍四個口令：第一拍「坐下」（宣文舉食指）、第二拍「拜託」（兩隻前腳抬起來）、第三拍「趴下」（孟庭手掌往下壓）、
//    第四拍稱讚（兩人拍手、狗站起來搖尾巴，頭上冒一顆小愛心）。**元元最標準，剛好在拍點上動；QQ 也準；芃芃慢半拍**（慢吞吞的博美）。
//    換姿勢時輕輕一跳、落地壓扁回彈。
//  - **焦點是主打留言**：寫在右上的立式大翻頁板「訓練手冊」上（開場時紙從上面翻下來），照「留言尺寸與版面比例標準 v2」：
//    字 40～60、紙最大 600 × 400，高度跟著留言。沒有留言時寫邀請。
//  - 背景：淡淡的遠樹、草地，幾個小三角錐與一個小跨欄；草跟著拍子輕晃。鏡頭慢慢推近。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, lyricSubOf, barAfter, sparkHead, sparkParticles, drawHeart, type LyricStyle } from './_motifs';
import { inkFor, paperBG, inkLine, bubble, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetShadow, puppetIn, breathe, beatKick, landSquash, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { mainOnly, writeTiming, parkTree, INVITE } from './_d4';
import type { Lyrics } from '../engine/lyrics';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'dog', paper: true, energy: [0.3, 1], bars: [4, 8] };

const SZ = 420, DOG_S = 1.3;
const GROUND = 880;
/** 人（面向右，看著狗）。 */
const XW_X = 360, MT_X = 590;
/** 三隻狗（面向左，看著人）：元元最靠近人、QQ、芃芃。三隻用同一個場景尺度。 */
const DOG_X: Record<Who, number> = { yy: 825, qq: 1085, pp: 1255 };
const DOG_Y: Record<Who, number> = { yy: 902, qq: 892, pp: 906 };
/** 對話框：宣文的（中文）在左上，孟庭的（原文）在它右下一點；tail = 對話框尾巴指到的地方（嘴巴附近）。 */
const XB = { cx: 390, bottom: 360, maxW: 600, tail: { x: 390, y: 452 } };
const MB = { cx: 880, bottom: 440, maxW: 560, tail: { x: 640, y: 488 } };
/** 翻頁板（留言）：板子的範圍（標準 v2：≤ 860 × 430）與寫字的內距。 */
const BOARD = { x: 1216, y: 96, w: 600, h: 400 };
const BPAD = { x: 42, top: 70, bottom: 34 };
const EASEL_FOOT = 790;
const SPRITES = ['xw_d4_cmd', 'xw_idle_front', 'xw_fetch_clap', 'mt_d4_cmd', 'mt_idle_front', 'mt_fetch_clap',
  'pp_sit', 'qq_sit', 'yy_sit', 'pp_beg', 'qq_beg', 'yy_beg', 'pp_d4_down', 'qq_d4_down', 'yy_d4_down', 'pp_stand', 'qq_stand', 'yy_stand'];
const LABEL = '訓練手冊 TRAINING NOTES';

type Who = 'yy' | 'qq' | 'pp';
/** 四個口令（一小節一輪）：每隻狗的姿勢。 */
const POSE: Record<Who, string[]> = {
  yy: ['yy_sit', 'yy_beg', 'yy_d4_down', 'yy_stand'],
  qq: ['qq_sit', 'qq_beg', 'qq_d4_down', 'qq_stand'],
  pp: ['pp_sit', 'pp_beg', 'pp_d4_down', 'pp_stand'],
};
/** 每隻狗晚幾拍反應：元元剛好、QQ 剛好、芃芃慢半拍。 */
const LAG: Record<Who, number> = { yy: 0, qq: 0.08, pp: 0.5 };

export default class DogTraining extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  board = { ...BOARD };
  lyricSize = 50;
  /** 第一個口令的拍（開場後的第一個小節線）。 */
  b0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + LABEL);
    this.track(await loadPuppets(SPRITES));
    let t0 = barAfter(au, this.ctx.start + 0.4);
    if (this.ctx.end - t0 < au.beatPeriod(t0) * 3) t0 = au.nextBeat(this.ctx.start + 0.3);
    this.b0 = Math.round(au.beatAt(t0));
    // 翻頁板上的留言：標準 v2 的字級；紙的高度跟著留言
    const c = this.fg.ctx;
    const w = BOARD.w - BPAD.x * 2, hmax = BOARD.h - BPAD.top - BPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.6, { max: 44 });
    tightenNote(c, this.note, w);
    this.board = { ...BOARD, h: Math.min(BOARD.h, Math.max(230, BPAD.top + this.note.height + BPAD.bottom + 8)) };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：地平線、遠處的樹、草地、三角錐、小跨欄、翻頁板的架子。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    const HZ = 640;
    // 遠處一排樹（遠的小、淡），中間留空讓對話框透氣
    for (const [x, k, sd] of [[90, 0.9, 1], [300, 0.62, 2], [1010, 0.7, 3], [1500, 0.85, 4], [1840, 0.66, 5]] as const) parkTree(c, x, HZ + 4, k, sd, 0.8);
    inkLine(c, [{ x: 20, y: HZ }, { x: 1900, y: HZ + 3 }], { ink, w: 0.7, seed: 2 });
    const g = c.createLinearGradient(0, HZ, 0, H);
    g.addColorStop(0, mixRgba('paper', 'gingham', 0.12));
    g.addColorStop(1, mixRgba('paper', 'gingham', 0.3));
    c.fillStyle = g;
    c.fillRect(0, HZ, W, H - HZ);
    // 三角錐、小跨欄（訓練場的道具，很淡）
    for (const [x, y, s] of [[180, 720, 0.8], [1120, 700, 0.7], [760, 730, 0.75]] as const) {
      c.fillStyle = mixRgba('fur', 'paper', 0.35);
      c.beginPath(); c.moveTo(x - 20 * s, y); c.lineTo(x + 20 * s, y); c.lineTo(x + 4 * s, y - 46 * s); c.lineTo(x - 4 * s, y - 46 * s); c.closePath(); c.fill();
      c.fillStyle = rgba('bone', 0.8);
      c.fillRect(x - 12 * s, y - 26 * s, 24 * s, 7 * s);
    }
    c.strokeStyle = mixRgba('leash', 'paper', 0.35);
    c.lineWidth = 5;
    c.beginPath(); c.moveTo(1400, 700); c.lineTo(1400, 640); c.moveTo(1560, 700); c.lineTo(1560, 640); c.moveTo(1392, 652); c.lineTo(1568, 652); c.stroke();
    // 翻頁板的架子：三隻腳（腳底在遠一點的地上，不進右下角）
    const B = this.board;
    c.strokeStyle = mixRgba('fur', 'sepia', 0.45);
    c.lineWidth = 8;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(B.x + 70, B.y + 20); c.lineTo(B.x + 30, EASEL_FOOT);
    c.moveTo(B.x + B.w - 70, B.y + 20); c.lineTo(B.x + B.w - 30, EASEL_FOOT);
    c.moveTo(B.x + B.w / 2, B.y + 20); c.lineTo(B.x + B.w / 2 + 10, EASEL_FOOT - 30);
    c.stroke();
    c.fillStyle = mixRgba('fur', 'sepia', 0.35);
    c.fillRect(B.x - 16, B.y - 18, B.w + 32, 22);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);

    this.drawGrass(c, t);
    this.drawBoard(c, t);
    this.drawPeople(c, t);
    for (const w of ['yy', 'qq', 'pp'] as Who[]) this.drawDog(c, t, w);
    this.drawBubbles(c, t, lyrics, rv);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.04, zoom: 1 + 0.028 * push, shake: [-(820 - W / 2) * 0.028 * push, -(560 - H / 2) * 0.028 * push] };
  }

  /** 第幾個口令（0 坐下、1 拜託、2 趴下、3 稱讚）；還沒開始是 -1。lag = 這隻狗慢幾拍。 */
  private cmdAt(t: number, lag = 0): { k: number; since: number } {
    const b = this.ctx.audio.beatAt(t) - this.b0 - lag;
    if (b < 0) return { k: -1, since: 0 };
    const i = Math.floor(b);
    return { k: ((i % 4) + 4) % 4, since: this.ctx.audio.beatPeriod(t) * (b - i) };
  }

  private drawGrass(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    c.save();
    c.strokeStyle = rgba('sepia', 0.35);
    c.lineWidth = 1.3;
    c.beginPath();
    for (let i = 0; i < 70; i++) {
      const x = 16 + i * 27 + hash(i, 1) * 14, y = 680 + Math.pow(hash(i, 2), 0.7) * 380;
      if (x > 1340 && y > 820) continue;
      const len = 10 + 10 * hash(i, 3), push = 0.2 + 0.3 * beatKick(au, t - x / 4000, 0.4);
      for (const d of [-0.3, 0.15]) {
        const a = -Math.PI / 2 + d + push;
        c.moveTo(x + d * 6, y);
        c.quadraticCurveTo(x + d * 6 + Math.cos(a) * len * 0.3, y - len * 0.6, x + d * 6 + Math.cos(a) * len, y + Math.sin(a) * len);
      }
    }
    c.stroke();
    c.restore();
  }

  /** 人：宣文第一、二拍下口令（舉食指），孟庭第三拍下口令（手掌往下壓），第四拍兩人一起拍手稱讚。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const { k } = this.cmdAt(t);
    const hasSub = !!this.curSub(t);
    const xwName = k === 0 || k === 1 ? 'xw_d4_cmd' : k === 3 ? 'xw_fetch_clap' : 'xw_idle_front';
    // 沒有翻譯的歌孟庭不說話：第三拍也只是在旁邊點頭（手掌往下壓的口令由宣文的食指代替），第四拍一樣拍手
    const mtName = k === 2 && hasSub ? 'mt_d4_cmd' : k === 3 ? 'mt_fetch_clap' : 'mt_idle_front';
    const e1 = puppetIn(t, this.ctx.start + 0.05, 0.45), e2 = puppetIn(t, this.ctx.start + 0.14, 0.45);
    const kick = beatKick(au, t, 0.25);
    if (e1.alpha > 0) {
      puppetShadow(c, 'xw', XW_X, GROUND, { h: SZ, alpha: 0.25 * e1.alpha, color: '60,50,30' });
      drawPuppet(c, xwName, XW_X, GROUND, { h: SZ, spin: e1.spin, alpha: e1.alpha, squash: breathe(t, 0.008, 3) + 0.012 * kick, rot: 0.02 * kick, pivot: 0.1 });
    }
    if (e2.alpha > 0) {
      puppetShadow(c, 'mt', MT_X, GROUND - 6, { h: SZ, alpha: 0.25 * e2.alpha, color: '60,50,30' });
      drawPuppet(c, mtName, MT_X, GROUND - 6, { h: SZ, spin: e2.spin, alpha: e2.alpha, squash: breathe(t, 0.01, 2.8, 0.3) + 0.015 * kick, rot: 0.025 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.1 });
    }
  }

  /** 一隻狗：照口令換姿勢（晚 LAG 拍），換的時候輕輕一跳、落地壓扁回彈；第四拍稱讚時頭上冒一顆小愛心。面向左（看著人）。 */
  private drawDog(c: CanvasRenderingContext2D, t: number, w: Who) {
    const au = this.ctx.audio;
    const x = DOG_X[w], y = DOG_Y[w];
    const en = puppetIn(t, this.ctx.start + (w === 'yy' ? 0.2 : w === 'qq' ? 0.28 : 0.36), 0.42);
    if (en.alpha <= 0) return;
    const { k, since } = this.cmdAt(t, LAG[w]);
    const name = k < 0 ? POSE[w][0]! : POSE[w][k]!;
    // 換姿勢的那一下：往上彈一點（0.16 秒）再落下壓扁
    const hopT = 0.16;
    const lift = k >= 0 && since < hopT ? 16 * Math.sin((Math.PI * since) / hopT) : 0;
    const squash = (k >= 0 ? landSquash(t, t - since + hopT, 0.12, 0.25) : 0) + breathe(t, 0.012, 1.6, w === 'pp' ? 0.4 : 0);
    // 等口令的時候尾巴在搖（整隻輕輕左右晃）；稱讚時晃大一點
    const rot = (k === 3 ? 0.05 : 0.015) * Math.sin(au.beatAt(t) * Math.PI * 2);
    const o: PuppetOpts = { h: SZ, scale: DOG_S, flip: true, spin: en.spin, alpha: en.alpha, squash, rot, pivot: 0.2 };
    puppetShadow(c, w, x, y, { h: SZ * DOG_S, lift, alpha: 0.26 * en.alpha, color: '60,50,30' });
    drawPuppet(c, name, x, y - lift, o);
    // 稱讚：頭上冒一顆小愛心
    if (k === 3) {
      const kk = ease.outBack(clamp(since / 0.3));
      const top = y - SZ * DOG_S * (w === 'yy' ? 0.44 : 0.3) - 20;
      c.save();
      c.globalAlpha = en.alpha * (1 - clamp((since - 0.5) / 0.3));
      drawHeart(c, x, top - 20 * kk, 26 * kk);
      c.restore();
    }
    if (en.k < 1) {
      sparkHead(this.glow, x, y - 4, t, 0.5);
      sparkParticles(this.glow, t, () => ({ x, y: y - 4 }), { rate: 30, life: 0.2, speed: 110, seed: w === 'yy' ? 3 : w === 'qq' ? 4 : 5 });
    }
  }

  private curSub(t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    return ly ? lyricSubOf(ly.line) : null;
  }

  /**
   * 兩個對話框：宣文的寫中文主行、孟庭的寫原文副行（drawLyricSub：比主行小一號、跟著原文自己的逐字時間）。
   * 對話框的大小跟著字；換一句歌詞時「啵」一下彈出來。沒有翻譯只有宣文的對話框。
   */
  private drawBubbles(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics, rv: number) {
    const ly = lyricAt(lyrics, t);
    if (!ly) return;
    const line = ly.line, sub = lyricSubOf(line);
    const ink = inkFor(true);
    const st: LyricStyle = { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, maxWidth: XB.maxW - 60, align: 'center', unsung: rgba('sepia', 0.26), sung: rgba('sepia', 0.92), active: rgba('signal') };
    const main = mainOnly(line);
    const lay = layoutLyric(c, main, st);
    const pop = ease.outBack(clamp((t - (line.start - 0.35)) / 0.3));
    const alpha = ly.k * rv;
    // 宣文的對話框（中文）
    const bw = Math.max(...lay.rows.map((r) => r.width)) + 64, bh = lay.height + 52;
    this.bubbleAt(c, XB.cx, XB.bottom, bw, bh, XB.tail, pop, alpha, ink, (cx, top) => {
      c.save(); c.translate(cx, top + 26 + lay.size * 0.86); drawLyric(c, main, t, st, lay, alpha); c.restore();
    });
    // 孟庭的對話框（原文）：原文至少 32 px（標準），放不下就折成兩排、框往上長；
    // 顏色照副行的規矩：唱到、唱完都用「唱完」的墨色，不用訊號色（不跟中文搶）
    if (sub) {
      const sst: LyricStyle = { ...st, size: Math.max(34, Math.round(lay.size * 0.7)), minSize: 32, maxWidth: MB.maxW - 30, active: st.sung, sung: st.sung };
      const sl = layoutLyric(c, sub, sst);
      const sw = Math.max(...sl.rows.map((r) => r.width)) + 54, sh = sl.height + 44;
      const pop2 = ease.outBack(clamp((t - (line.start - 0.35) - 0.08) / 0.3));
      this.bubbleAt(c, MB.cx, MB.bottom, sw, sh, MB.tail, pop2, alpha, ink, (cx, top) => {
        c.save(); c.translate(cx, top + 22 + sl.size * 0.86); drawLyric(c, sub, t, sst, sl, alpha); c.restore();
      });
    }
  }

  /** 一個對話框：底邊中心在 (cx, bottom)、尾巴指到 tail；k 是彈出的縮放（從尾巴那一點長出來）。draw 在框裡寫字。 */
  private bubbleAt(c: CanvasRenderingContext2D, cx: number, bottom: number, w: number, h: number, tail: Pt, k: number, alpha: number, ink: ReturnType<typeof inkFor>, draw: (cx: number, top: number) => void) {
    if (k <= 0.01 || alpha <= 0.01) return;
    const x = cx - w / 2, y = bottom - h;
    c.save();
    c.globalAlpha *= clamp(alpha * 1.4);
    c.translate(tail.x, tail.y);
    c.scale(k, k);
    c.translate(-tail.x, -tail.y);
    c.fillStyle = rgba('sepia', 0.08);
    c.fillRect(x + 8, y + 10, w, h);
    bubble(c, x, y, w, h, tail, { ink, w: 1.1, seed: Math.round(cx) });
    draw(cx, y);
    c.restore();
  }

  /** 翻頁板：開場時紙從上面翻下來（像翻頁），上面一行小字「訓練手冊」，留言一個字一個字寫上去。 */
  private drawBoard(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.board;
    const flip = ease.outCubic(prog(t, this.ctx.start + 0.1, this.ctx.start + 0.55));
    c.save();
    // 紙：從上緣往下翻開（高度從 0 長到全長），翻完之後每個小節線輕輕被風吹起來一點點
    const au = this.ctx.audio;
    const lift = 4 * beatKick(au, t - 0.05, 0.4);
    const h = B.h * flip;
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(B.x + 8, B.y + 10, B.w, h);
    c.fillStyle = mixRgba('bone', 'paper', 0.25);
    c.beginPath(); c.moveTo(B.x, B.y); c.lineTo(B.x + B.w, B.y); c.lineTo(B.x + B.w + lift * 0.3, B.y + h); c.lineTo(B.x - lift * 0.3, B.y + h - lift); c.closePath(); c.fill();
    c.strokeStyle = rgba('sepia', 0.25); c.lineWidth = 1.2; c.stroke();
    // 裝訂的圈圈
    c.fillStyle = rgba('sepia', 0.5);
    for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(B.x + 40 + i * ((B.w - 80) / 8), B.y + 4, 5, 0, Math.PI * 2); c.fill(); }
    if (flip > 0.98) {
      c.font = font(F.hei(500), 18);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('sepia', 0.5);
      c.fillText(LABEL, B.x + BPAD.x, B.y + 42);
      c.letterSpacing = '0px';
      c.strokeStyle = mixRgba('signal', 'paper', 0.3);
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(B.x + BPAD.x, B.y + 54); c.lineTo(B.x + BPAD.x + 110, B.y + 54); c.stroke();
      const tm = writeTiming(n, this.ctx.start + 0.6, t, !!this.msg);
      const room = B.h - BPAD.top - BPAD.bottom;
      drawNote(c, n, B.x + BPAD.x, B.y + BPAD.top + Math.max(0, (room - n.height) * 0.45), {
        chars: tm.chars, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74), sigK: tm.sigK,
      });
    }
    c.restore();
  }
}
