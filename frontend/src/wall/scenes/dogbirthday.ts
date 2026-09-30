// 狗狗生日派對（亮、dog、雙語）：元元的生日。客廳裡一張矮桌、一個狗狗蛋糕（奶油、骨頭餅乾、一根蠟燭），
// 三隻狗戴著派對帽圍著蛋糕坐好（元元戴黃色的、坐在蛋糕後面正中間），宣文和孟庭在左邊拉拉炮、唱生日歌。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 第一個小節線兩人一起拉拉炮（紙花、彩帶噴出去再慢慢飄下來），之後每拍拍手唱歌；窗格長的話四小節後再拉一次。
//    三隻狗每拍跟著點頭，元元每個小節線歪一下頭；蠟燭的火在拍點上跳一下。
//  - **兩行歌詞是牆上的兩串三角彩旗**：上面一串一面旗子一個中文字（主行），下面一串小一號的旗子是原文（副行），
//    每個字照自己的逐字時間亮（正在唱訊號色、唱完墨色）。換一句歌詞時旗子一面一面從繩子上翻下來。
//    沒有翻譯的歌只有上面一串（下面那串收起來，不掛空旗子）。
//  - **焦點是主打留言**：寫在右邊立著的生日卡上（打開的卡片，左邊一頁是紙花圖案，右邊一頁寫留言），上面一行小字「Happy Birthday 元元」；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、卡片的寫字頁最大 560 × 360，高度跟著留言。沒有留言時寫邀請。
//  - 鏡頭：慢慢推近蛋糕與狗。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, lyricSubOf, barAfter, sparkHead, sparkParticles } from './_motifs';
import { paperBG, drawNote, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetPoint, puppetShadow, puppetIn, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { layoutChars, charProgress, type CharLayout } from './_c3';
import { mainOnly, writeTiming, INVITE } from './_d4';
import type { Line } from '../engine/lyrics';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'dog', paper: true, energy: [0.3, 1], bars: [4, 8] };

const SZ = 430, DOG_S = 1.3;
const FLOOR = 900, WALL = 690;
/** 人（左邊，面向右）。 */
const MT_X = 300, XW_X = 520;
/** 矮桌與蛋糕（中間）。 */
const TABLE = { cx: 960, top: 818, w: 380 };
const CAKE = { cx: 960, base: 818, r: 92, h: 70 };
/** 三隻狗：元元在蛋糕後面正中間，芃芃在左、QQ 在右（面向蛋糕）。三隻用同一個場景尺度。 */
const DOG: Record<Who, { x: number; y: number; flip: boolean }> = { yy: { x: 960, y: 800, flip: false }, pp: { x: 735, y: 918, flip: false }, qq: { x: 1190, y: 918, flip: true } };
/** 兩串彩旗：繩子兩端的 x、兩端的高度、中間垂下多少。 */
const STRING_A = { x0: 110, x1: 1810, y: 118, sag: 104 };
const STRING_B = { x0: 170, x1: 1750, y: 300, sag: 74 };
/** 生日卡（右邊，立著）：寫字那一頁的最大範圍（標準 v2）與內距；左邊一頁是圖案。 */
const CARD = { x: 1300, y: 420, w: 520, h: 360, flap: 110 };
const CPAD = { x: 36, top: 66, bottom: 30 };
const SPRITES = ['xw_d4_popper', 'mt_d4_popper', 'xw_fetch_clap', 'mt_fetch_clap', 'yy_d4_party', 'pp_d4_party', 'qq_d4_party'];
const LABEL = 'Happy Birthday 元元';

type Who = 'yy' | 'pp' | 'qq';
/** 彩旗（沒寫字的）與紙花的顏色：固定的柔和色（不跟主題換，派對的顏色）。 */
const FLAG_COLS = ['cream', 'shirtblue', 'gingham', 'fur', 'rose'] as const;

export default class DogBirthday extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  card = { ...CARD };
  lyricSize = 50;
  /** 拉拉炮的時間（小節線）。 */
  pops: number[] = [];
  keys: Record<'xw' | 'mt', [number, string][]> = { xw: [], mt: [] };

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + LABEL);
    this.track(await loadPuppets(SPRITES));
    // 拉拉炮：第一個小節線；窗格夠長時四小節後再一次
    let p0 = barAfter(au, this.ctx.start + 0.5);
    if (this.ctx.end - p0 < au.beatPeriod(p0) * 2) p0 = au.nextBeat(this.ctx.start + 0.4);
    this.pops = [p0];
    const p1 = au.timeOfBar(Math.round(au.barAt(p0)) + 4);
    if (p1 < this.ctx.end - au.beatPeriod(p1) * 3) this.pops.push(p1);
    // 兩人：拍手唱歌 → 拉炮的前半拍舉起來、拉開 → 一拍半後回去拍手
    for (const who of ['xw', 'mt'] as const) {
      const ks: [number, string][] = [[-1e9, `${who}_fetch_clap`]];
      for (const p of this.pops) { const bp = au.beatPeriod(p); ks.push([p - bp * 0.5, `${who}_d4_popper`], [p + bp * 1.5, `${who}_fetch_clap`]); }
      this.keys[who] = ks;
    }
    // 生日卡上的留言：標準 v2 的字級；寫字頁的高度跟著留言
    const c = this.fg.ctx;
    const w = CARD.w - CPAD.x * 2, hmax = CARD.h - CPAD.top - CPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.6, { max: 40 });
    tightenNote(c, this.note, w);
    const h = Math.min(CARD.h, Math.max(220, CPAD.top + this.note.height + CPAD.bottom + 8));
    this.card = { ...CARD, y: CARD.y + (CARD.h - h), h };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：牆（淡淡的直條紋）、踢腳板、木地板、矮桌、生日卡（紙、左頁的紙花圖案、小標題）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 牆：淡淡的直條紋壁紙
    c.fillStyle = mixRgba('paper', 'rose', 0.05);
    c.fillRect(0, 0, W, WALL);
    c.fillStyle = mixRgba('paper', 'rose', 0.1);
    for (let x = 0; x < W; x += 80) c.fillRect(x, 0, 36, WALL);
    // 踢腳板、木地板
    c.fillStyle = mixRgba('paper', 'sepia', 0.14);
    c.fillRect(0, WALL - 20, W, 20);
    const g = c.createLinearGradient(0, WALL, 0, H);
    g.addColorStop(0, mixRgba('paper', 'fur', 0.18));
    g.addColorStop(1, mixRgba('paper', 'fur', 0.3));
    c.fillStyle = g;
    c.fillRect(0, WALL, W, H - WALL);
    c.strokeStyle = rgba('sepia', 0.08);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let y = WALL + 30, i = 0; y < H; y += 26 + i * 6, i++) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    // 矮桌：圓桌面（橢圓）、兩隻粗腳
    const T = TABLE;
    c.fillStyle = mixRgba('fur', 'sepia', 0.35);
    c.fillRect(T.cx - T.w * 0.38, T.top + 8, 18, 80);
    c.fillRect(T.cx + T.w * 0.38 - 18, T.top + 8, 18, 80);
    c.fillStyle = mixRgba('paper', 'fur', 0.4);
    c.beginPath(); c.ellipse(T.cx, T.top + 6, T.w / 2, 30, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = mixRgba('fur', 'sepia', 0.25);
    c.fillRect(T.cx - T.w / 2, T.top + 6, T.w, 12);
    c.beginPath(); c.ellipse(T.cx, T.top + 18, T.w / 2, 30, 0, 0, Math.PI); c.fill();
    this.drawCard(c);
    L.upload();
  }

  /** 生日卡：打開的卡片立在右邊的小架子上——左頁往後折一點（紙花點點），右頁寫留言。 */
  private drawCard(c: CanvasRenderingContext2D) {
    const K = this.card;
    // 影子
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(K.x - K.flap + 10, K.y + 12, K.w + K.flap, K.h);
    // 左頁（往後折，窄一點、暗一點）：彩色紙花點點
    c.fillStyle = mixRgba('cream', 'paper', 0.3);
    c.beginPath(); c.moveTo(K.x - K.flap, K.y + 14); c.lineTo(K.x, K.y); c.lineTo(K.x, K.y + K.h); c.lineTo(K.x - K.flap, K.y + K.h - 14); c.closePath(); c.fill();
    for (let i = 0; i < 26; i++) {
      c.fillStyle = mixRgba(FLAG_COLS[i % FLAG_COLS.length]!, 'paper', 0.25, 0.85);
      const x = K.x - K.flap + 12 + hash(i, 1) * (K.flap - 24), y = K.y + 24 + hash(i, 2) * (K.h - 48);
      c.beginPath(); c.arc(x, y, 3 + 4 * hash(i, 3), 0, Math.PI * 2); c.fill();
    }
    // 右頁
    c.fillStyle = rgba('bone');
    c.fillRect(K.x, K.y, K.w, K.h);
    c.strokeStyle = rgba('sepia', 0.2);
    c.lineWidth = 1.2;
    c.strokeRect(K.x + 0.5, K.y + 0.5, K.w - 1, K.h - 1);
    c.beginPath(); c.moveTo(K.x, K.y); c.lineTo(K.x, K.y + K.h); c.stroke();
    c.font = font(F.serif(500, true), 26);
    c.fillStyle = rgba('sepia', 0.62);
    c.fillText(LABEL, K.x + CPAD.x, K.y + 42);
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

    this.drawBunting(c, t, lyricAt(lyrics, t), rv);
    this.drawCardText(c, t);
    // 元元在蛋糕後面（先畫），再畫蛋糕、另外兩隻、人
    this.drawDog(c, t, 'yy');
    this.drawCake(c, t);
    this.drawDog(c, t, 'pp');
    this.drawDog(c, t, 'qq');
    this.drawPeople(c, t);
    this.drawConfetti(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.3, bloomThreshold: 1.5, halation: 0.04, vignette: 0.22, grain: 0.04, zoom: 1 + 0.03 * push, shake: [-(CAKE.cx - W / 2) * 0.03 * push, -(640 - H / 2) * 0.03 * push] };
  }

  /** 一串彩旗的繩子：兩端高、中間垂下（拋物線），拍點上被風吹得輕輕晃。回傳 x 處繩子的 y。 */
  private stringY(S: typeof STRING_A, x: number, t: number) {
    const u = (x - S.x0) / (S.x1 - S.x0);
    const sway = 4 * beatKick(this.ctx.audio, t, 0.5) * Math.sin(u * Math.PI);
    return S.y + S.sag * 4 * u * (1 - u) + sway;
  }

  /**
   * 兩串彩旗：上面一串寫中文主行（一面一個字）、下面一串小一號寫原文副行。沒寫字的地方掛沒寫字的彩色小旗。
   * 換一句歌詞時，有字的旗子一面一面從繩子上翻下來（從繩子往下長）。
   */
  private drawBunting(c: CanvasRenderingContext2D, t: number, ly: { line: Line; k: number } | null, rv: number) {
    const main = ly ? mainOnly(ly.line) : null, sub = ly ? lyricSubOf(ly.line) : null;
    const alpha = ly ? ly.k * rv : 0;
    this.drawString(c, t, STRING_A, main, this.lyricSize, 40, alpha, 0);
    // 下面那串：沒有原文時整串收起來（繩子也不畫）
    if (sub) this.drawString(c, t, STRING_B, sub, Math.max(34, Math.round(this.lyricSize * 0.72)), 32, alpha, 1);
  }

  /**
   * 一句歌詞排成一串旗子：一個字（Word）一面——中文一字一面、英文一個單字一面、韓文一個詞一面；旗子寬跟著字。
   * 太長放不下就縮字（不小於 min），還是放不下就讓旗子擠一點。回傳每面旗子的中心 x 與寬。
   */
  private flagsFor(c: CanvasRenderingContext2D, line: Line, size: number, min: number, span: number) {
    const fam = F.archivo(100, 700);
    const units = (lay: CharLayout) => {
      const out: { chars: CharLayout['chars']; w: number }[] = [];
      for (const ch of lay.chars) {
        if (!ch.ch.trim()) continue;
        const last = out[out.length - 1];
        if (last && last.chars[last.chars.length - 1]!.wi === ch.wi && /[!-~]/.test(ch.ch)) { last.chars.push(ch); last.w += ch.w; }
        else out.push({ chars: [ch], w: ch.w });
      }
      return out;
    };
    const fwOf = (u: { w: number }, s: number) => Math.max(s * 1.2, u.w + s * 0.45);
    let lay = layoutChars(c, line, fam, size, 99999, size);
    let us = units(lay), total = us.reduce((a, u) => a + fwOf(u, size), 0);
    if (total > span) {
      const s2 = Math.max(min, Math.floor((size * span) / total));
      lay = layoutChars(c, line, fam, s2, 99999, s2);
      us = units(lay);
      total = us.reduce((a, u) => a + fwOf(u, s2), 0);
    }
    const s = lay.size, squeeze = total > span ? span / total : 1;
    let x = -total * squeeze / 2;
    return { size: s, total: total * squeeze, flags: us.map((u) => { const w = fwOf(u, s) * squeeze; const f = { u, cx: x + w / 2, w }; x += w; return f; }) };
  }

  private drawString(c: CanvasRenderingContext2D, t: number, S: typeof STRING_A, line: Line | null, size0: number, min: number, alpha: number, row: number) {
    // 繩子
    c.save();
    c.strokeStyle = rgba('sepia', 0.5);
    c.lineWidth = 2;
    c.beginPath();
    for (let x = S.x0; x <= S.x1; x += 20) { const y = this.stringY(S, x, t); if (x === S.x0) c.moveTo(x, y); else c.lineTo(x, y); }
    c.stroke();
    c.restore();
    const mid = (S.x0 + S.x1) / 2, span = (S.x1 - S.x0) * 0.9;
    const F2 = line ? this.flagsFor(c, line, size0, min, span) : null;
    // 有字的旗子排在繩子中間；兩邊補沒寫字的小旗
    const deco = Math.round(size0 * 1.2);
    const x0 = F2 ? mid - F2.total / 2 : mid, x1 = F2 ? mid + F2.total / 2 : mid;
    for (let x = S.x0 + deco * 0.6, i = 0; x < S.x1 - deco * 0.4; x += deco, i++) {
      if (F2 && x > x0 - deco * 0.5 && x < x1 + deco * 0.5) continue;
      this.flag(c, t, S, x, deco * 0.8, deco * 1.05, mixRgba(FLAG_COLS[(i + row) % FLAG_COLS.length]!, 'paper', 0.4), null, 1);
    }
    if (!line || !F2) return;
    const size = F2.size;
    F2.flags.forEach((fl, i) => {
      // 換句時一面一面翻下來：每面晚 0.03 秒
      const drop = ease.outBack(clamp((t - (line.start - 0.35) - i * 0.03) / 0.25));
      const cols = fl.u.chars.map((ch) => { const p = charProgress(line, ch, t); return p <= 0 ? rgba('sepia', 0.3) : p < 1 ? rgba('signal') : rgba('sepia', 0.92); });
      this.flag(c, t, S, mid + fl.cx, fl.w - 4, size * 1.2 + size * 0.6, row ? mixRgba('shirtblue', 'bone', 0.72) : mixRgba('cream', 'bone', 0.5), { chars: fl.u.chars.map((ch) => ({ ch: ch.ch, w: ch.w })), size, cols, alpha }, drop);
    });
  }

  /** 一面三角旗：掛在繩子上 x 處，寬 w、高 h（尖端朝下），拍點上輕輕晃；label 有字就寫在旗子上半部。drop = 從繩子往下翻開的進度。 */
  private flag(c: CanvasRenderingContext2D, t: number, S: typeof STRING_A, x: number, w: number, h: number, fill: string, label: { chars: { ch: string; w: number }[]; size: number; cols: string[]; alpha: number } | null, drop: number) {
    if (drop <= 0.01) return;
    const y = this.stringY(S, x, t);
    const au = this.ctx.audio;
    const sw = 0.05 * Math.sin((au.beatAt(t) + x * 0.004) * Math.PI);
    c.save();
    c.translate(x, y);
    c.rotate(sw);
    c.scale(1, drop);
    c.fillStyle = fill;
    c.strokeStyle = rgba('sepia', 0.3);
    c.lineWidth = 1.2;
    c.beginPath();
    if (label) {
      // 寫字的旗子是「上面方、下面尖」的五角旗：字寫在方的那一塊，不會被斜邊切到
      const sq = label.size * 1.2;
      c.moveTo(-w / 2, 0); c.lineTo(w / 2, 0); c.lineTo(w / 2, sq); c.lineTo(0, h); c.lineTo(-w / 2, sq);
    } else {
      c.moveTo(-w / 2, 0); c.lineTo(w / 2, 0); c.lineTo(0, h);
    }
    c.closePath(); c.fill(); c.stroke();
    if (label && label.alpha > 0.01) {
      c.globalAlpha *= label.alpha;
      c.font = font(F.archivo(100, 700), label.size);
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      // 一面旗子上的字（英文單字、韓文詞是好幾個字）一個一個照自己的進度上色
      let x0 = -label.chars.reduce((a, ch) => a + ch.w, 0) / 2;
      label.chars.forEach((ch, i) => { c.fillStyle = label.cols[i]!; c.fillText(ch.ch, x0, label.size * 0.98); x0 += ch.w; });
    }
    c.restore();
  }

  /** 蛋糕：兩層的狗狗蛋糕（奶油、上面一塊骨頭餅乾、一根蠟燭），燭火在拍點上跳一下、發光。 */
  private drawCake(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, K = CAKE;
    const x = K.cx, y = K.base - 14;
    c.save();
    // 盤子
    c.fillStyle = rgba('bone');
    c.beginPath(); c.ellipse(x, y + 10, K.r * 1.25, 18, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('sepia', 0.25); c.lineWidth = 1.2; c.stroke();
    // 下層、上層（奶油色，側面一圈擠花）
    for (const [r, h, y0] of [[K.r, K.h * 0.6, y], [K.r * 0.66, K.h * 0.45, y - K.h * 0.6]] as const) {
      c.fillStyle = mixRgba('cream', 'bone', 0.4);
      c.fillRect(x - r, y0 - h, r * 2, h);
      c.beginPath(); c.ellipse(x, y0, r, r * 0.2, 0, 0, Math.PI); c.fill();
      c.fillStyle = mixRgba('cream', 'bone', 0.7);
      c.beginPath(); c.ellipse(x, y0 - h, r, r * 0.2, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba('sepia', 0.22);
      c.stroke();
      c.fillStyle = mixRgba('rose', 'bone', 0.6);
      for (let i = 0; i < 9; i++) { const a = Math.PI * (i + 0.5) / 9; c.beginPath(); c.arc(x - Math.cos(a) * r * 0.95, y0 - h + Math.sin(a) * r * 0.19 + 4, 5, 0, Math.PI * 2); c.fill(); }
    }
    // 骨頭餅乾
    const top = y - K.h * 1.05;
    c.fillStyle = mixRgba('fur', 'cream', 0.45);
    c.fillRect(x - 30, top - 8, 60, 14);
    for (const dx of [-30, 30]) for (const dy of [-6, 6]) { c.beginPath(); c.arc(x + dx, top - 1 + dy, 8, 0, Math.PI * 2); c.fill(); }
    // 蠟燭與火
    c.fillStyle = mixRgba('shirtblue', 'bone', 0.3);
    c.fillRect(x + 36, top - 44, 9, 40);
    const k = beatKick(au, t, 0.18);
    const fh = 18 + 9 * k + 2 * Math.sin((t - this.ctx.start) * 23);
    c.fillStyle = mixRgba('ember', 'bone', 0.3);
    c.beginPath(); c.moveTo(x + 40.5, top - 44 - fh); c.quadraticCurveTo(x + 50, top - 50, x + 40.5, top - 44); c.quadraticCurveTo(x + 31, top - 50, x + 40.5, top - 44 - fh); c.fill();
    c.restore();
    const sg = LIN.ember;
    this.glow.polyline([{ x: x + 40.5, y: top - 46 - fh * 0.6 }, { x: x + 40.5, y: top - 46 }], 6, [sg[0] * 2.2, sg[1] * 2.2, sg[2] * 2.2], 0.7 + 0.3 * k);
  }

  /** 一隻狗：戴派對帽坐好，每拍點頭（壓一下）；元元每個小節線歪一下頭。 */
  private drawDog(c: CanvasRenderingContext2D, t: number, w: Who) {
    const au = this.ctx.audio;
    const P = DOG[w];
    const en = puppetIn(t, this.ctx.start + (w === 'yy' ? 0.2 : w === 'pp' ? 0.28 : 0.36), 0.42);
    if (en.alpha <= 0) return;
    const kick = beatKick(au, t - (w === 'qq' ? 0.04 : 0), 0.22);
    let rot = 0.02 * Math.sin(au.beatAt(t) * Math.PI);
    if (w === 'yy') { const bar = au.barAt(t), u = bar - Math.floor(bar); rot += 0.1 * Math.sin(Math.PI * clamp(u / 0.25)) * (Math.floor(bar) % 2 ? 1 : -1); }
    const o: PuppetOpts = { h: SZ, scale: DOG_S, flip: P.flip, spin: en.spin, alpha: en.alpha, squash: 0.04 * kick + breathe(t, 0.012, 1.8, w === 'pp' ? 0.4 : 0), rot, pivot: 0.3 };
    puppetShadow(c, w, P.x, P.y, { h: SZ * DOG_S, alpha: 0.24 * en.alpha, color: '70,45,25' });
    drawPuppet(c, `${w}_d4_party`, P.x, P.y, o);
    if (en.k < 1) {
      sparkHead(this.glow, P.x, P.y - 4, t, 0.5);
      sparkParticles(this.glow, t, () => ({ x: P.x, y: P.y - 4 }), { rate: 30, life: 0.2, speed: 110, seed: w === 'yy' ? 3 : w === 'pp' ? 4 : 5 });
    }
  }

  /** 人：拍手唱歌（每拍一下），拉拉炮的那一下舉高拉開。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    for (const [who, x, d] of [['mt', MT_X, 0.14], ['xw', XW_X, 0.05]] as const) {
      const en = puppetIn(t, this.ctx.start + d, 0.45);
      if (en.alpha <= 0) continue;
      const kick = beatKick(au, t, 0.22);
      const o: PuppetOpts = { h: SZ, spin: en.spin, alpha: en.alpha, squash: breathe(t, 0.009, 3, who === 'mt' ? 0.3 : 0) + 0.02 * kick, rot: 0.02 * Math.sin(au.beatAt(t) * Math.PI + (who === 'mt' ? 1 : 0)), pivot: 0.1 };
      puppetShadow(c, who, x, FLOOR, { h: SZ, alpha: 0.24 * en.alpha, color: '70,45,25' });
      drawPick(c, this.keys[who], t, x, FLOOR, o);
    }
  }

  /**
   * 紙花：每次拉炮，兩支拉炮口各噴出 36 片（往右上方），先衝出去、再慢慢飄下來（左右晃、翻面時變細），落到地上前淡掉。
   * 全部由種子決定（確定性）。
   */
  private drawConfetti(c: CanvasRenderingContext2D, t: number) {
    // 紙花從兩支拉炮的炮口噴出來（圖上量好的 tip 點）
    const mouths = [puppetPoint('mt_d4_popper', 'tip', MT_X, FLOOR, { h: SZ }) ?? { x: MT_X + 150, y: FLOOR - SZ * 0.95 }, puppetPoint('xw_d4_popper', 'tip', XW_X, FLOOR, { h: SZ }) ?? { x: XW_X + 160, y: FLOOR - SZ * 1.02 }];
    c.save();
    this.pops.forEach((p, pi) => {
      const d = t - p;
      if (d < 0 || d > 5) return;
      mouths.forEach((m, mi) => {
        for (let i = 0; i < 36; i++) {
          const sd = pi * 100 + mi * 50 + i;
          const a = -0.95 + (hash(sd, 1) - 0.5) * 0.9, v = 700 + 500 * hash(sd, 2);
          // 衝出去（阻力很大，0.4 秒就慢下來）→ 慢慢往下飄
          const drag = 1 - Math.exp(-d / 0.28);
          const x = m.x + Math.cos(a) * v * 0.28 * drag + Math.sin(d * (2 + hash(sd, 3) * 2) + sd) * 18 * clamp(d / 0.5);
          const y = m.y + Math.sin(a) * v * 0.28 * drag + 60 * Math.max(0, d - 0.3) * (0.8 + hash(sd, 4) * 0.6);
          const fade = 1 - clamp((d - 3.6) / 1.2);
          if (y > FLOOR + 20 || fade <= 0) continue;
          if (x > 1360 && y > 820) continue;
          const spin = d * (5 + 6 * hash(sd, 5)) + sd;
          c.save();
          c.globalAlpha = fade;
          c.translate(x, y);
          c.rotate(spin);
          c.scale(1, Math.abs(Math.cos(spin * 1.3)) * 0.9 + 0.1);
          c.fillStyle = mixRgba(FLAG_COLS[sd % FLAG_COLS.length]!, 'signal', i % 5 === 0 ? 0.5 : 0);
          if (i % 3 === 0) c.fillRect(-9, -2, 18, 4); else c.fillRect(-5, -5, 10, 10);
          c.restore();
        }
      });
      // 拉開的那一下：炮口一圈亮線
      if (d < 0.25) for (const m of mouths) {
        const sg = LIN.signal, r = 10 + 60 * d;
        for (let i = 0; i < 6; i++) {
          const a = -1.2 + i * 0.35;
          this.glow.polyline([{ x: m.x + Math.cos(a) * r, y: m.y + Math.sin(a) * r }, { x: m.x + Math.cos(a) * (r + 18), y: m.y + Math.sin(a) * (r + 18) }], 2, [sg[0] * 2.5, sg[1] * 2.5, sg[2] * 2.5], 1 - d / 0.25);
        }
      }
    });
    c.restore();
  }

  /** 生日卡上的留言：一個字一個字寫上去，寫完署名淡入；在寫字頁上垂直置中。 */
  private drawCardText(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const K = this.card;
    const tm = writeTiming(n, this.ctx.start + 0.6, t, !!this.msg);
    const room = K.h - CPAD.top - CPAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    drawNote(c, n, K.x + CPAD.x, K.y + CPAD.top + Math.max(0, (room - n.height) * 0.45), {
      chars: tm.chars, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74), sigK: tm.sigK,
    });
    c.restore();
  }
}
