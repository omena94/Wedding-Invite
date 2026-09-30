// 街機（機器 B，暗）：暗暗的遊樂場裡一台街機的 LED 點陣板，鏡頭斜斜地拍著它（有外框、透視、景深）。
//  - 所有東西先畫在三分之一解析度的 Canvas（640×360），再由 shader 把每一個像素畫成一顆圓形的 LED
//    （沒亮的 LED 暗暗的一格一格，點距 3 px；輸出縮小時點的對比自動降低，不會出現疊紋）。
//  - 主視覺（左邊）：待機畫面的小遊戲——方塊一拍掉一塊（落在拍點上，像俄羅斯方塊），在井裡一格一格拼出一顆像素愛心；
//    正在掉的那塊是熱的訊號色，落地閃一下；拼完的那一拍整顆愛心亮成點綴色，之後每一拍跳一下。窗格短的時候愛心已經拼了一部分。
//  - 右上：HIGH SCORES 只剩三列小字。第一名永遠是「宣文 & 孟庭」9,999,999；主打留言的署名那列，分數跟著方塊一塊一塊加，
//    愛心拼完的那一拍剛好是 1,314,520（一生一世我愛你）。
//  - 右邊：主打留言（NEW RECORD，v2 字級），一段一段亮起來，署名在最後一行下面。沒有留言：INSERT COIN 閃著＋一行邀請。
//  - 下方三分之一：歌詞（逐字跟唱：唱到的字整個字變訊號色、唱完紙白、還沒唱三成亮；比留言小）。
//  - 鏡頭：焦點轉移——開場對焦在愛心上，留言亮起來時移到留言；大鼓讓整面板亮一下；開場 LED 由左往右一欄一欄亮起。
// 手法：很小的 Canvas（每格重畫、上傳也便宜）＋ LED 點陣 shader 畫進離屏圖，再用 _t8 的舞台當成空間裡的一面板子來拍。
// 字級照 v2 標準（螢幕 px，除以舞台的縮放）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, type LyricStyle, beatAfter, COUPLE_ZH, lyricSubOf, subStyleFor, subSizeFor, subGap } from './_motifs';
import { DEC_GLSL, winBeats, INVITE, T8_TEXT, Stage, camMove, type StageCam } from './_t8';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.4, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素；位置對齊點距）
const P = 3; // 點距（3 px：中文字約 16～20 顆點高，筆畫才不會糊在一起）
const DW = W / P, DH = H / P;
/** 左邊的井：格子數、一格多大（邏輯 px，點距的倍數）。 */
const WELL = { x: 210, y: 114, cols: 17, rows: 21, cell: 36 };
/** 右邊：高分榜、留言。 */
const RX = 930, RW = 820;
const TITLE_Y = 190, ROW_Y = 256, ROW_H = 58;
const MSG_TOP = 470, MSG_BOT = 830;
/** 下方三分之一：歌詞。 */
const LY_BASE = 968, LY_W = 1100;
const SCORE_COUPLE = 9999999, SCORE_HERO = 1314520;
const TEXT = `${T8_TEXT}${COUPLE_ZH}永遠第一（）♪·—…`;
const snap = (v: number) => Math.round(v / P) * P;
/** LED 用門檻判斷亮不亮：半透明的字會整個消失，所以「暗一點」要用不透明的暗色（跟底色混），不要用透明度。 */
const dim = (key: string, k: number) => mixRgba('ink', key, clamp(k), 1);
/** 基本機位（沒有加鏡頭運動）：init 用它換算字級。 */
const CAM: StageCam = { yaw: -0.07, pitch: 0.05, roll: 0.003, zoom: 0.87, x: -10, y: -6, dof: 1.2, bezel: 70, radius: 28, glass: 0.7, room: [0, 0, 0], glow: 0.03 };

/**
 * 像素愛心：井底 15×13 格的範圍裡，用心形的隱函數 (x²+y²−1)³ − x²y³ ≤ 0 判斷哪些格子是愛心，
 * 再照「由下往上、由左往右」排成填的順序，每一列切成幾塊（最多 4 格）。
 */
const HEART_PIECES: { c: number; r: number }[][] = (() => {
  const cells: { c: number; r: number }[] = [];
  const W0 = 15, H0 = 13, c0 = 1, r0 = WELL.rows - H0;
  for (let j = H0 - 1; j >= 0; j--) {
    for (let i = 0; i < W0; i++) {
      const x = (i + 0.5 - W0 / 2) / 6.4, y = (H0 / 2 - (j + 0.5)) / 5.7 + 0.14;
      if ((x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0) cells.push({ c: c0 + i, r: r0 + j });
    }
  }
  // 每塊只在同一列裡（跨列的一塊落下來會像兩塊分開的碎片），一列切成幾塊差不多長的（最多 4 格）
  const pieces: { c: number; r: number }[][] = [];
  const rowsOf = new Map<number, { c: number; r: number }[]>();
  for (const q of cells) { if (!rowsOf.has(q.r)) rowsOf.set(q.r, []); rowsOf.get(q.r)!.push(q); }
  for (const row of rowsOf.values()) {
    const n = Math.ceil(row.length / 4), per = Math.ceil(row.length / n);
    for (let k = 0; k < row.length; k += per) pieces.push(row.slice(k, k + per));
  }
  return pieces;
})();

const LED = () => new FSPass(/* glsl */ `
  uniform sampler2D tex; uniform float on; uniform float kick;
  ${DEC_GLSL}
  void main() {
    vec2 cp = FRAG_PX / ${P}.0;
    vec2 cell = floor(cp), f = fract(cp) - 0.5;
    vec2 uv = (cell + 0.5) / vec2(${DW}.0, ${DH}.0);
    vec4 c = decLayer(texture(tex, uv));
    float lit = smoothstep(0.28, 0.55, c.a);
    vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
    float col01 = cell.x / ${DW}.0;
    lit *= step(col01, on * 1.05);
    float r = length(f);
    float aa = max(fwidth(r), 0.02);
    float dotM = 1.0 - smoothstep(0.36 - aa, 0.36 + aa, r);
    float fine = smoothstep(2.2, 3.2, ${P}.0 * PX_SCALE);
    dotM = mix(0.75, dotM, fine);
    float core = (1.0 - smoothstep(0.0, 0.3, r)) * fine;
    vec2 uvs = FRAG_PX / vec2(${W}.0, ${H}.0) - 0.5;
    float vig = 1.0 - 0.4 * smoothstep(0.35, 0.75, length(uvs * vec2(1.3, 1.0)));
    vec3 col = C_INK * 0.6 + C_INK2 * 0.7 * dotM * step(col01, on * 1.05 + 0.02);
    col += rgb * lit * (dotM * (1.0 + 0.1 * kick) + core * 0.22);
    col += rgb * lit * 0.28 * (1.0 - dotM);
    fragColor = vec4(col * vig, 1.0);
  }`, { tex: { value: null }, on: { value: 1 }, kick: { value: 0 } });

export default class Arcade extends Scene {
  led = shared('arcade.led', LED);
  stage = new Stage();
  scr = this.track(new Layer2D(W, H, 1 / P, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  beat = 0.5;
  /** 每一塊方塊落地的時間（前面 pre 塊在窗格開始時已經在井裡）。 */
  land: number[] = [];
  tDone = 0;
  guests: string[] = [];
  heroName = '';
  fit: FitResult | null = null;
  charT: number[] = [];
  typedEnd = 0;
  tMsg = 0;
  sigPx = 30;
  st: LyricStyle = { family: F.archivo(100, 800), size: 52, minSize: 46, maxWidth: LY_W, lineHeight: 1.1 };
  /** 歌詞那裡舞台的縮放倍數（原文副行的字級規則是螢幕 px，要換算）。 */
  zL = 1;

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const m = this.msg;
    const seed = this.ctx.params.seed ?? 1;
    this.scr.texture.magFilter = THREE.NearestFilter;
    this.scr.texture.minFilter = THREE.NearestFilter;
    const beat = this.beat = au.beatPeriod(s + 0.1);
    // 方塊：一拍一塊，最後一塊落在窗格結束前 2 拍以上；塊數比拍數多的話，前面的已經在井裡
    const bs = winBeats(au, s + 0.05, e - 1.9 * beat);
    const N = HEART_PIECES.length;
    const k0 = Math.max(0, N - bs.length);
    this.land = HEART_PIECES.map((_, i) => (i < k0 ? s - 10 : bs[i - k0] ?? s - 10));
    this.tDone = this.land[N - 1]!;
    // 名字：其他留言的署名（沒有就用街機的預設名字）
    const all: Msg[] = (this.ctx.params.messages as Msg[] | undefined) ?? [];
    const others = all.filter((x) => (!m || x.id !== m.id) && x.name && !x.couple);
    const cut = (n: string) => (Array.from(n).length > 7 ? Array.from(n).slice(0, 6).join('') + '…' : n);
    const pick = (k: number) => (others.length ? cut(others[Math.floor(hash(seed, k) * others.length)]!.name) : ['AAA', 'ACE'][k % 2]!);
    this.guests = [pick(1), pick(2)];
    if (this.guests[1] === this.guests[0] && others.length > 1) this.guests[1] = cut(others.find((x) => cut(x.name) !== this.guests[0])!.name);
    this.heroName = m && !m.couple ? cut(m.name || '一位賓客') : '';
    await loadText(TEXT + (song.title ?? '') + this.guests.join('') + this.heroName + (m ? m.text + m.name : ''));
    // v2 字級：標準是螢幕 px，除以舞台在那裡的縮放倍數
    const zM = this.stage.scaleAt(CAM, RX + RW / 2, (MSG_TOP + MSG_BOT) / 2);
    const zL = this.zL = this.stage.scaleAt(CAM, WELL.x + LY_W / 2, LY_BASE - 20);
    if (m) {
      const c = this.scr.ctx;
      const o = { min: V2.msgMin / zM, max: msgMaxFor(m.text) / zM, lineHeight: 1.22, maxLines: 5 };
      // 字級依「框高扣掉 NEW RECORD 那行與署名」算，署名永遠在最後一行下面
      const bh = MSG_BOT - MSG_TOP - 60 - 60;
      this.fit = fitClauses(c, m.text, F.hei(500), RW, bh, o) ?? fitText(c, m.text, F.hei(500), RW, bh, o);
      this.sigPx = sigV2(this.fit.size * zM) / zM;
      const ls = lyricV2(this.fit.size * zM) / zL;
      this.st = { family: F.archivo(100, 800), size: ls, minSize: V2.lyrMin / zL, maxWidth: LY_W, lineHeight: 1.1 };
      const n = this.fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const t0 = beatAfter(au, s + 0.1, 1);
      this.tMsg = t0;
      const dur = clamp(0.045 * n + 0.2, 0.5, 2.4), step = beat / 4;
      const per = Math.ceil(n / Math.max(1, Math.round(dur / step)));
      this.charT = Array.from({ length: n }, (_, i) => t0 + Math.floor(i / per) * step);
      this.typedEnd = this.charT[n - 1] ?? t0;
    } else {
      const ls = lyricV2(null) / zL;
      this.st = { family: F.archivo(100, 800), size: ls, minSize: V2.lyrMin / zL, maxWidth: LY_W, lineHeight: 1.1 };
    }
  }

  /** 已經落地的塊數（主打那列的分數跟著它走）。 */
  private landed(t: number) { let n = 0; for (const x of this.land) if (x <= t) n++; return n; }

  // ---------------------------------------------------------------- 左邊：井與愛心
  private drawWell(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const { x: wx, y: wy, cols, rows, cell } = WELL;
    // 井的框：左、右、下三邊（點陣的細框）
    c.fillStyle = dim('bone', 0.35);
    c.fillRect(wx - P * 2, wy, P, rows * cell);
    c.fillRect(wx + cols * cell + P, wy, P, rows * cell);
    c.fillRect(wx - P * 2, wy + rows * cell + P, cols * cell + P * 4, P);
    const done = t >= this.tDone;
    // 拼完之後：每一拍整顆愛心跳一下（亮），拼完那一拍閃白
    const lastB = au.timeOfBeat(Math.floor(au.beatAt(t)));
    const beatK = done ? Math.exp(-Math.max(0, t - lastB) / 0.14) : 0;
    const flash = done ? Math.exp(-Math.max(0, t - this.tDone) / 0.25) : 0;
    const cellRect = (cc: number, rr: number, col: string) => {
      c.fillStyle = col;
      c.fillRect(snap(wx + cc * cell) + P, snap(wy + rr * cell) + P, cell - 2 * P, cell - 2 * P);
    };
    HEART_PIECES.forEach((piece, i) => {
      const tl = this.land[i]!;
      const fallT = this.beat * 0.85;
      if (t < tl - fallT) return;
      if (t < tl) {
        // 正在掉：從井口加速落下（重力），落地剛好在拍點上
        const k = ease.inQuad(clamp((t - (tl - fallT)) / fallT));
        const top = Math.min(...piece.map((q) => q.r));
        const dy = lerp(-top - 2, 0, k);
        for (const q of piece) {
          const rr = q.r + dy;
          if (rr < -0.5) continue;
          cellRect(q.c, Math.round(rr * 4) / 4, dim('ember', 1));
        }
        return;
      }
      // 已經落地：剛落地閃一下；拼完之後是點綴色、跟著拍子跳
      const hot = Math.exp(-Math.max(0, t - tl) / 0.15);
      let col: string;
      // mixRgba 只收色票的名字，所以「變亮」與「變暗」分開做：閃的時候往 bone 混，平常用 dim 壓暗
      if (done) col = flash > 0.03 ? mixRgba('rose', 'bone', flash * 0.8) : dim('rose', 0.72 + 0.28 * beatK);
      else col = hot > 0.05 ? mixRgba('signal', 'bone', hot * 0.6) : dim('signal', 0.62);
      for (const q of piece) cellRect(q.c, q.r, col);
    });
    // 井口上方的小字：LOVE × ∞（配角）
    c.font = font(F.archivo(100, 800), 30);
    c.fillStyle = dim('ash', 0.6);
    c.fillText(done ? 'LOVE  ×  ∞' : `LOVE  ${String(this.landed(t)).padStart(2, '0')} / ${HEART_PIECES.length}`, wx, wy - 22);
  }

  // ---------------------------------------------------------------- 右邊：高分榜與留言
  private drawRight(c: CanvasRenderingContext2D, t: number, blink: boolean) {
    const m = this.msg;
    c.font = font(F.archivo(125, 900), 44);
    c.letterSpacing = '8px';
    c.fillStyle = dim('signal', 0.85);
    c.fillText('HIGH SCORES', RX, TITLE_Y);
    c.letterSpacing = '0px';
    // 三列：新人（永遠第一）、主打留言的署名（分數跟著方塊加）或一位賓客、另一位賓客
    const heroScore = Math.round((SCORE_HERO * this.landed(t)) / HEART_PIECES.length);
    const rows: [string, number, string][] = [[COUPLE_ZH, SCORE_COUPLE, dim('ember', 0.9)]];
    if (this.heroName) rows.push([this.heroName, heroScore, t >= this.tDone && blink ? rgba('bone') : rgba('signal')]);
    else rows.push([this.guests[1] ?? 'ACE', 873520, dim('bone', 0.75)]);
    rows.push([this.guests[0] ?? 'AAA', 520000 + Math.floor(hash(this.ctx.params.seed ?? 1, 6) * 90000), dim('bone', 0.6)]);
    rows.sort((a, b) => b[1] - a[1]);
    rows.forEach(([name, sc, col], i) => {
      const y = snap(ROW_Y + i * ROW_H);
      c.font = font(F.archivo(100, 800), 40);
      c.fillStyle = col;
      c.fillText(`${i + 1}`, RX, y);
      c.textAlign = 'right';
      c.fillText(sc.toLocaleString('en-US'), snap(RX + 330), y);
      c.textAlign = 'left';
      c.font = font(F.hei(500), 40);
      c.fillText(name, snap(RX + 380), y);
    });
    if (!m) {
      c.font = font(F.archivo(125, 900), 48);
      c.letterSpacing = '8px';
      c.fillStyle = blink ? dim('ember', 0.85) : dim('ember', 0.35);
      c.fillText('INSERT COIN', RX, MSG_TOP + 60);
      c.letterSpacing = '0px';
      c.font = font(F.hei(500), 34);
      c.fillStyle = dim('bone', 0.6);
      c.fillText(INVITE, RX, MSG_TOP + 124);
      return;
    }
    const fit = this.fit!;
    c.font = font(F.archivo(100, 800), 32);
    c.fillStyle = blink ? dim('signal', 0.85) : dim('ember', 0.6);
    c.fillText(m.couple ? 'FROM THE COUPLE' : 'NEW RECORD!', RX, MSG_TOP + 30);
    c.font = font(F.hei(500), fit.size);
    const top = MSG_TOP + 60 + fit.size * 0.9;
    let idx = 0;
    fit.lines.forEach((ln, li) => {
      let x = RX;
      const y = snap(top + li * fit.lineHeight);
      for (const ch of Array.from(ln)) {
        const ta = this.charT[idx++] ?? 0;
        const cw = c.measureText(ch).width;
        if (t >= ta) {
          const heat = Math.exp(-(t - ta) / 0.2);
          const to = ch === '♥' ? 'rose' : 'bone';
          c.fillStyle = heat > 0.02 ? mixRgba(to, 'signal', heat) : rgba(to, 1);
          c.fillText(ch, x, y);
        }
        x += cw;
      }
    });
    // 署名：最後一行下面（隔半個留言字高）
    const sk = clamp((t - this.typedEnd - this.beat * 0.5) / 0.25);
    if (sk > 0) {
      c.font = font(F.hei(500), this.sigPx);
      c.fillStyle = dim('bone', 0.6 * sk);
      c.fillText(`—— ${m.name || '一位賓客'}${m.couple ? '（新人）' : ''}`, RX, snap(top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.5 + this.sigPx));
    }
  }

  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = layoutLyric(c, ly.line, this.st);
      // 原文副行（韓文歌）：自己排（字級照螢幕 px 換算），放在中文下面；整組往下多用一點螢幕下緣的空間（鏡頭拉遠，
      // 畫到畫面上還離下緣 96 px 以上），中文折兩行時第一行才不會壓到上面井的底線
      const sub = lyricSubOf(ly.line), z = this.zL;
      const sl = sub ? layoutLyric(c, sub, { ...subStyleFor(this.st, lay.size), size: subSizeFor(lay.size * z) / z }) : null;
      const gap = sl ? subGap(lay.size * z, sl.size * z) / z : 0;
      c.save();
      c.font = font(this.st.family, lay.size);
      const y0 = sl ? LY_BASE + 72 - (lay.rows[lay.rows.length - 1]!.y + gap + sl.rows[sl.rows.length - 1]!.y) : LY_BASE - lay.rows[lay.rows.length - 1]!.y;
      for (const pw of lay.words) {
        const p = Lyrics.wordProgress(pw.word, t);
        const x = snap(WELL.x + pw.x), y = snap(y0 + pw.y);
        // 點陣字不做半個字的漸層：唱到的字整個字變訊號色（跟唱的時間照規則），唱完紙白；淡入淡出也用暗色（見 dim）
        c.fillStyle = p <= 0 ? dim('bone', 0.32 * ly.k) : p < 1 ? dim('signal', ly.k) : dim('bone', (this.msg ? 0.8 : 0.96) * ly.k);
        c.fillText(pw.word.w, x, y);
      }
      if (sl) {
        // 比中文安靜：唱到、唱完都是紙白再暗兩成（不用訊號色），還沒唱的跟中文一樣
        c.font = font(this.st.family, sl.size);
        const ys = y0 + lay.rows[lay.rows.length - 1]!.y + gap;
        for (const pw of sl.words) {
          const p = Lyrics.wordProgress(pw.word, t);
          c.fillStyle = p <= 0 ? dim('bone', 0.32 * ly.k) : dim('bone', 0.96 * 0.8 * ly.k);
          c.fillText(pw.word.w, snap(WELL.x + pw.x), snap(ys + pw.y));
        }
      }
      c.restore();
    } else if (!lyrics.has) {
      c.font = font(F.archivo(100, 800), this.st.size);
      c.fillStyle = dim('bone', 0.8);
      c.fillText(`♪ ${song.title || '今晚的歌'}`, WELL.x, LY_BASE);
    }
  }

  private draw(t: number) {
    const L = this.scr, c = L.ctx;
    L.clear();
    const au = this.ctx.audio;
    const blink = ((au.beatAt(t) % 1) + 1) % 1 < 0.5;
    c.textBaseline = 'alphabetic';
    this.drawWell(c, t);
    this.drawRight(c, t, blink);
    this.drawLyric(c, t);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    this.draw(t);
    const u = this.led.u;
    u.tex!.value = this.scr.texture;
    u.on!.value = ease.outCubic(prog(t, s, s + 0.35));
    u.kick!.value = f.a.kick;
    this.led.render(renderer, this.stage.rt);
    // 鏡頭：街機的面板在暗暗的遊樂場裡，稍微側一點、往上看一點。焦點轉移：開場對焦在愛心，留言亮起來時移到留言
    const mv = camMove(au, s, e, t, { inYaw: -0.12, inZoom: 0.07, push: 0.03, sway: 0.012 });
    const fk = this.msg ? ease.inOutCubic(prog(t, this.tMsg, this.tMsg + 1.5 * this.beat)) : 0;
    const wc: [number, number] = [WELL.x + (WELL.cols * WELL.cell) / 2, WELL.y + (WELL.rows * WELL.cell) * 0.6];
    const focus: [number, number] = [lerp(wc[0], RX + RW / 2, fk), lerp(wc[1], (MSG_TOP + MSG_BOT) / 2, fk)];
    this.stage.draw(renderer, out, {
      ...CAM, yaw: CAM.yaw + mv.yaw, zoom: CAM.zoom + mv.zoom, focus,
      room: [LIN.ink[0] * 0.5, LIN.ink[1] * 0.5, LIN.ink[2] * 0.5],
    });
    // 色差關掉：點陣會被色差拆成紅綠藍的彩邊
    return { bloom: 0.85, halation: 0.25, vignette: 0.5, ca: 0 };
  }
}
