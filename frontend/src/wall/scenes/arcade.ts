// 街機高分榜（機器 B，暗）：暗暗的遊樂場裡一台街機的 LED 點陣板，鏡頭斜斜地拍著它（有外框、透視、景深）。
//  - 所有東西先畫在三分之一解析度的 Canvas（640×360），再由 shader 把每一個像素畫成一顆圓形的 LED
//    （沒亮的 LED 暗暗的一格一格，點距 3 px；輸出縮小時點的對比自動降低，不會出現疊紋）。
//  - 像待機畫面一樣換「頁」，一頁只有一個焦點：
//    A. HIGH SCORES：四名。第一名永遠是「宣文 & 孟庭」9,999,999（永遠第一）；主打留言的署名在最後一列，
//       分數一拍一拍往上跳，超過別人的那一拍兩列交換位置（outExpo）。
//    B. 小節線上 LED 一欄一欄掃過去換頁：NEW RECORD——主打留言變成整面板的大字（焦點），一段一段亮起來，
//       下面一小行署名與分數 1,314,520（一生一世我愛你）。
//    歌詞兩頁都在面板下緣，比留言小一級（逐字跟唱：唱到的字整個字變訊號色、唱完紙白、還沒唱三成亮）。
//    沒有留言：B 頁的焦點是放大的歌詞，上面一小行「INSERT COIN」閃著、邀請大家掃 QR。
//  - 大鼓讓整面板亮一下；開場 LED 由左往右一欄一欄亮起。
// 手法：很小的 Canvas（每格重畫、上傳也便宜）＋ LED 點陣 shader 畫進離屏圖，再用 _t8 的舞台當成空間裡的一面板子來拍。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, type LyricStyle, barAfter, COUPLE_ZH } from './_motifs';
import { DEC_GLSL, winBeats, INVITE, T8_TEXT, Stage, camMove } from './_t8';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.4, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素；位置對齊點距）
const P = 3; // 點距（3 px：中文字約 20 顆點高，筆畫才不會糊在一起）
const DW = W / P, DH = H / P;
const X0 = 180, XR = 1740;
const TITLE_Y = 250;
const ROW_Y = 372, ROW_H = 88; // 四列高分榜
const MSG_TOP = 170, MSG_BOT = 740; // B 頁：留言
const LY_BASE = 930; // 歌詞最後一列的基線
const LY_W = 1140; // 歌詞最寬（右邊不進右下角 QR 那一區）
const SCORE_COUPLE = 9999999, SCORE_HERO = 1314520;
const RANKS = ['1ST', '2ND', '3RD', '4TH'];
const TEXT = `${T8_TEXT}${COUPLE_ZH}永遠第一（）♪·—…`;
const snap = (v: number) => Math.round(v / P) * P;
/** LED 用門檻判斷亮不亮：半透明的字會整個消失，所以「暗一點」要用不透明的暗色（跟底色混），不要用透明度。 */
const dim = (key: string, k: number) => mixRgba('ink', key, clamp(k), 1);

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

interface Row { name: string; base: number; hero: boolean; couple: boolean }

export default class Arcade extends Scene {
  led = shared('arcade.led', LED);
  stage = new Stage();
  scr = this.track(new Layer2D(W, H, 1 / P, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  beat = 0.5;
  rows: Row[] = [];
  beats: number[] = [];
  steps: number[] = [];
  /** 換頁（A → B）的時間。 */
  tSwitch = 0;
  fit: FitResult | null = null;
  charT: number[] = [];
  typedEnd = 0;
  st: LyricStyle = { family: F.archivo(100, 800), size: 66, minSize: 54, maxWidth: LY_W, lineHeight: 1.1 };

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const m = this.msg;
    const seed = this.ctx.params.seed ?? 1;
    this.scr.texture.magFilter = THREE.NearestFilter;
    this.scr.texture.minFilter = THREE.NearestFilter;
    const beat = this.beat = au.beatPeriod(s + 0.1);
    // 換頁：開場後至少 1.5 秒的第一個小節線（窗格很短就在一半）
    this.tSwitch = Math.min(barAfter(au, s + 1.5), s + (e - s) * 0.5);
    // 兩位賓客：其他留言的名字（沒有就用街機的預設名字 AAA）
    const all: Msg[] = (this.ctx.params.messages as Msg[] | undefined) ?? [];
    const others = all.filter((x) => (!m || x.id !== m.id) && x.name && !x.couple);
    const pick = (k: number) => others.length ? others[Math.floor(hash(seed, k) * others.length)]!.name : ['AAA', 'ZZZ', 'ACE'][k]!;
    let g1 = pick(1), g2 = pick(2);
    if (g2 === g1 && others.length > 1) g2 = others.find((x) => x.name !== g1)!.name;
    const cut = (n: string) => (Array.from(n).length > 7 ? Array.from(n).slice(0, 6).join('') + '…' : n);
    this.rows = [
      { name: COUPLE_ZH, base: SCORE_COUPLE, hero: false, couple: true },
      { name: cut(g1), base: 1100000 + Math.floor(hash(seed, 3) * 150000), hero: false, couple: false },
      { name: cut(g2), base: 760000 + Math.floor(hash(seed, 4) * 200000), hero: false, couple: false },
    ];
    if (m && !m.couple) this.rows.push({ name: cut(m.name || '一位賓客'), base: SCORE_HERO, hero: true, couple: false });
    else {
      const g3 = others.find((x) => x.name !== g1 && x.name !== g2)?.name;
      this.rows.push({ name: g3 ? cut(g3) : '???', base: g3 ? 520000 + Math.floor(hash(seed, 6) * 200000) : 0, hero: false, couple: false });
    }
    await loadText(TEXT + (song.title ?? '') + this.rows.map((r) => r.name).join('') + (m ? m.text + m.name : '') + this.ctx.lyrics.linesIn(s, e).map((l) => l.text).join(''));
    // 主打的分數：第一拍起一拍一跳，換頁前剛好跳到 1,314,520
    const bs = winBeats(au, s, this.tSwitch + 0.01).filter((b) => b >= s + 0.05);
    this.beats = bs.length ? bs : [s + 0.2];
    const start = 380000 + Math.floor(hash(seed, 5) * 60000);
    this.steps = this.beats.map((_, i) => {
      if (i === this.beats.length - 1) return SCORE_HERO;
      const k = ((i + 1) / this.beats.length) ** 1.35;
      return Math.round(lerp(start, SCORE_HERO, k) / 10) * 10 + ((i * 37) % 10) * 10;
    });
    this.steps.unshift(start);
    this.beats.unshift(s - 1);
    // B 頁的留言：換頁的同時一段一段亮起來（十六分音符一組，最多 2.4 秒）
    if (m) {
      const c = this.scr.ctx;
      this.fit = fitText(c, m.text, F.hei(500), XR - X0, MSG_BOT - MSG_TOP - 80, { min: 60, max: 150, lineHeight: 1.18, maxLines: 5 });
      const n = this.fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const dur = clamp(0.045 * n + 0.2, 0.5, 2.4), step = beat / 4;
      const per = Math.ceil(n / Math.max(1, Math.round(dur / step)));
      this.charT = Array.from({ length: n }, (_, i) => this.tSwitch + 0.12 + Math.floor(i / per) * step);
      this.typedEnd = this.charT[n - 1] ?? this.tSwitch;
    } else {
      this.st = { family: F.archivo(100, 800), size: 128, minSize: 72, maxWidth: XR - X0, lineHeight: 1.08 };
    }
  }

  private heroScore(t: number) {
    let i = 0;
    for (let k = 0; k < this.beats.length; k++) if (this.beats[k]! <= t) i = k;
    const a = this.steps[Math.max(0, i - 1)]!, b = this.steps[i]!;
    const k = i === 0 ? 1 : ease.outExpo(clamp((t - this.beats[i]!) / 0.22));
    return Math.round(lerp(a, b, k));
  }
  private score(r: Row, t: number) {
    if (r.hero) return this.heroScore(t);
    if (r.couple) return r.base;
    return r.base + Math.floor(Math.max(0, this.ctx.audio.beatAt(t) - this.ctx.audio.beatAt(this.ctx.start))) * 30;
  }
  private rankAt(i: number, t: number) {
    const sc = this.rows.map((r) => this.score(r, t));
    return this.rows.map((_, k) => k).sort((a, b) => sc[b]! - sc[a]!).indexOf(i);
  }
  private lastSwap(i: number, t: number): number | null {
    for (let k = this.beats.length - 1; k >= 1; k--) {
      const tb = this.beats[k]!;
      if (tb > t) continue;
      if (this.rankAt(i, tb + 0.3) !== this.rankAt(i, tb - 0.001)) return tb;
      if (t - tb > 2) break;
    }
    return null;
  }

  // ---------------------------------------------------------------- 兩頁
  /** A 頁：HIGH SCORES。 */
  private pageScores(c: CanvasRenderingContext2D, t: number, blink: boolean) {
    const au = this.ctx.audio;
    const g = c.createLinearGradient(0, TITLE_Y - 64, 0, TITLE_Y);
    g.addColorStop(0, rgba('ember')); g.addColorStop(1, rgba('signal'));
    c.font = font(F.archivo(125, 900), 72);
    c.letterSpacing = '12px';
    c.fillStyle = g;
    // 每個小節線，字母由左往右一個一個跳一下（待機畫面的波浪）
    const db = au.timeOfBar(Math.floor(au.barAt(t)));
    const title = 'HIGH SCORES';
    let tx = X0;
    for (let i = 0; i < title.length; i++) {
      const ch = title[i]!;
      const k = clamp((t - db - i * 0.035) / 0.22);
      const bump = k > 0 && k < 1 ? Math.sin(Math.PI * k) : 0;
      c.fillText(ch, snap(tx), snap(TITLE_Y - 18 * bump));
      tx += c.measureText(ch).width;
    }
    c.letterSpacing = '0px';
    const m = this.msg;
    const scores = this.rows.map((r) => this.score(r, t));
    const order = this.rows.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
    this.rows.forEach((r, i) => {
      const rank = order.indexOf(i);
      let y = ROW_Y + rank * ROW_H;
      const tc = this.lastSwap(i, t);
      if (tc !== null) y = lerp(ROW_Y + this.rankAt(i, tc - 0.001) * ROW_H, y, ease.outExpo(clamp((t - tc) / 0.3)));
      y = snap(y);
      const justUp = r.hero && tc !== null && t - tc < 0.6;
      const col = r.couple ? (m?.couple && blink ? rgba('bone') : rgba('ember')) : r.hero ? (justUp && blink ? rgba('bone') : rgba('signal')) : dim('bone', 0.8);
      c.font = font(F.archivo(100, 800), 60);
      c.fillStyle = col;
      c.fillText(RANKS[rank]!, X0, y);
      c.textAlign = 'right';
      c.fillText(scores[i]!.toLocaleString('en-US'), snap(X0 + 690), y);
      c.textAlign = 'left';
      c.font = font(F.hei(500), 60);
      c.fillText(r.name, snap(X0 + 760), y);
      if (r.couple) {
        const nw = c.measureText(r.name).width;
        c.font = font(F.hei(500), 44);
        c.fillStyle = dim('ember', 0.6);
        c.fillText('永遠第一', snap(X0 + 760 + nw + 30), y - 2);
      }
    });
  }

  /** B 頁：NEW RECORD（焦點是留言）；沒有留言：放大的歌詞＋INSERT COIN。 */
  private pageRecord(c: CanvasRenderingContext2D, t: number, blink: boolean) {
    const m = this.msg;
    if (!m) {
      // 沒有人在唱的空檔：INSERT COIN 放大成焦點；有歌詞時縮成上面一小行（焦點交給歌詞）
      const quiet = !lyricAt(this.ctx.lyrics, t) && this.ctx.lyrics.has;
      c.font = font(F.archivo(125, 900), quiet ? 110 : 48);
      c.letterSpacing = quiet ? '14px' : '8px';
      c.fillStyle = blink ? dim('ember', 0.85) : dim('ember', 0.35);
      c.fillText('INSERT COIN', X0, quiet ? 470 : MSG_TOP + 50);
      c.letterSpacing = '0px';
      c.font = font(F.hei(500), quiet ? 48 : 40);
      c.fillStyle = dim('bone', 0.55);
      c.fillText(INVITE, X0, quiet ? 560 : MSG_TOP + 112);
      return;
    }
    const fit = this.fit!;
    c.font = font(F.hei(500), fit.size);
    const top = MSG_TOP + (MSG_BOT - MSG_TOP - 80 - fit.height) / 2 + fit.size * 0.9;
    let idx = 0;
    fit.lines.forEach((ln, li) => {
      let x = X0;
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
    // 署名與分數：一小行、比留言暗
    const sy = snap(top + (fit.lines.length - 1) * fit.lineHeight + 84);
    const sk = clamp((t - this.typedEnd - this.beat * 0.5) / 0.25);
    if (sk > 0) {
      c.font = font(F.hei(500), 44);
      c.fillStyle = dim('bone', 0.6 * sk);
      c.fillText(`—— ${m.name || '一位賓客'}${m.couple ? '（新人）' : ''}`, X0, sy);
      const nw = c.measureText(`—— ${m.name || '一位賓客'}${m.couple ? '（新人）' : ''}`).width;
      c.font = font(F.archivo(100, 800), 44);
      c.fillStyle = blink ? dim('signal', 0.75 * sk) : dim('ember', 0.55 * sk);
      c.fillText(m.couple ? 'FROM THE COUPLE' : `NEW RECORD  ${SCORE_HERO.toLocaleString('en-US')}`, snap(X0 + nw + 48), sy);
    }
  }

  private draw(t: number) {
    const L = this.scr, c = L.ctx;
    L.clear();
    const au = this.ctx.audio;
    const blink = ((au.beatAt(t) % 1) + 1) % 1 < 0.5;
    c.textBaseline = 'alphabetic';
    // 換頁：LED 一欄一欄從左往右掃過去（掃描線是一條亮的訊號色）
    const w = ease.inOutCubic(clamp((t - this.tSwitch) / 0.32));
    const wx = snap(w * (W + 60));
    if (w < 1) {
      c.save();
      c.beginPath(); c.rect(wx, 0, W, H); c.clip();
      this.pageScores(c, t, blink);
      c.restore();
    }
    if (w > 0) {
      c.save();
      c.beginPath(); c.rect(0, 0, wx, H); c.clip();
      this.pageRecord(c, t, blink);
      c.restore();
      if (w < 1) { c.fillStyle = rgba('signal', 0.9); c.fillRect(wx - 2 * P, 0, 2 * P, H); }
    }
    this.drawLyric(c, t);
    L.upload();
  }

  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    // 沒有留言時，B 頁的歌詞是焦點：放大、移到中間
    const big = !this.msg && t >= this.tSwitch;
    const st = big ? this.st : { family: F.archivo(100, 800), size: 66, minSize: 54, maxWidth: LY_W, lineHeight: 1.1 };
    if (ly) {
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.font = font(st.family, lay.size);
      const y0 = big ? MSG_TOP + 200 + (MSG_BOT - MSG_TOP - 200 - lay.height) / 2 + lay.size * 0.85 : LY_BASE - lay.rows[lay.rows.length - 1]!.y;
      for (const pw of lay.words) {
        const p = Lyrics.wordProgress(pw.word, t);
        const x = snap(X0 + pw.x), y = snap(y0 + pw.y);
        // 點陣字不做半個字的漸層：唱到的字整個字變訊號色（跟唱的時間照規則），唱完紙白
        // 淡入淡出也用暗色（見 dim）
        c.fillStyle = p <= 0 ? dim('bone', 0.32 * ly.k) : p < 1 ? dim('signal', ly.k) : dim('bone', (this.msg ? 0.78 : 0.96) * ly.k);
        c.fillText(pw.word.w, x, y);
      }
      c.restore();
    } else if (!lyrics.has) {
      c.font = font(F.archivo(100, 800), big ? 96 : 60);
      c.fillStyle = rgba('bone', 0.8);
      c.fillText(`♪ ${song.title || '今晚的歌'}`, X0, big ? 520 : LY_BASE);
    }
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
    // 鏡頭：街機的面板在暗暗的遊樂場裡，稍微側一點、往上看一點；換頁那一拍推近一點
    const mv = camMove(au, s, e, t, { inYaw: -0.12, inZoom: 0.07, push: 0.03, sway: 0.012 });
    const punch = 0.025 * ease.outExpo(clamp((t - this.tSwitch) / 0.5));
    this.stage.draw(renderer, out, {
      yaw: -0.07 + mv.yaw, pitch: 0.05, roll: 0.003, zoom: 0.87 + mv.zoom + punch, x: -10, y: -6,
      dof: 1.3, focus: [W / 2, (MSG_TOP + MSG_BOT) / 2], bezel: 70, radius: 28, glass: 0.7,
      room: [LIN.ink[0] * 0.5, LIN.ink[1] * 0.5, LIN.ink[2] * 0.5], glow: 0.03,
    });
    // 色差關掉：點陣會被色差拆成紅綠藍的彩邊
    return { bloom: 0.85, halation: 0.25, vignette: 0.5, ca: 0 };
  }
}
