// 聊天室（暗）：一個不像任何 App 的群組聊天視窗，佔畫面左邊到 x≈1350（右邊一條是成員列表，留給即時小卡蓋）。
//  - 兩方對話：左邊是賓客（大頭貼是名字的第一個字），右邊是「今晚的歌」（大頭貼是音符）。
//  - 主打留言：第一拍出現「○○ 正在輸入…」（三個點跟著八分音符跳），下一拍泡泡彈出來、火花沿著泡泡描一圈；
//    再下一個小節線，這則被「置頂」：置頂列從標題列下面拉下來，泡泡飛上去，整個窗格都讀得到——
//    對話串再怎麼往上捲都不會把它推走（長留言要十幾秒才讀得完，一般的聊天串兩句就把它推出畫面了）。
//  - 歌詞：每一句是歌那一邊的回覆泡泡。句子開始前一拍先出現打字中的三個點，前 0.35 秒泡泡彈出來，
//    字照跟唱規則亮（還沒唱三成、正在唱訊號色、唱完紙白）；新的泡泡把舊的往上推（彈簧，稍微過頭再回來）。
//  - 純音樂：歌傳來一則「語音訊息」，波形是這一段真的音量，播放頭走過的地方亮起來。
//  - 沒有留言：置頂列放邀請；賓客那邊一直「正在輸入…」（冷面：有人打了很久）。
// 畫法：視窗的底、置頂列的底、輸入框是全螢幕 shader（圓角 SDF，對話串的底紋跟著捲動視差）；字與泡泡是一張 Canvas2D；
// 火花一個 LineBatch。每格要重畫的只有會動的東西，一張全螢幕 Canvas 上傳（fast）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse } from '../engine/util';
import { fitText, wrap, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, sparkHead, sparkParticles, drawHeart, fillWithHearts, COUPLE_ZH, type LyricLayout, type LyricStyle } from './_motifs';
import { grid, windowLines, rrect, rrectPts, tracePolyline, pad, initial, settle, pop, type Grid } from './_t5';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0.15, 0.85], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（邏輯像素）
const P = { x: 120, y: 96, w: 1230, h: 888 }; // 聊天視窗 x 120..1350、y 96..984
const HEAD = 92; // 標題列
const IN_H = 86; // 輸入列
const S_TOP = P.y + HEAD + 6; // 對話串的上緣（置頂列拉下來時往下推）
const S_BOT = P.y + P.h - IN_H - 20; // 最新一則的底
const AV = 60; // 大頭貼直徑
const LAV = P.x + 28; // 左邊大頭貼的左緣
const BXL = LAV + AV + 18; // 左邊泡泡的左緣
const RAV = P.x + P.w - 28 - AV; // 右邊大頭貼的左緣
const BXR = RAV - 18; // 右邊泡泡的右緣
const PADX = 30, PADY = 20;
const NAME_H = 34; // 泡泡上面的名字列
const GAP = 20;
const SIDE = { x: 1400, y: 120, w: 400 }; // 右邊的成員列表（裝飾，小卡可以蓋）

const LYRIC: LyricStyle = { family: F.archivo(100, 700), size: 58, minSize: 48, maxWidth: BXR - BXL - 2 * PADX - 90, align: 'left', lineHeight: 1.2 };

// ---------------------------------------------------------------- 底：視窗、置頂列、輸入框（shader，圓角 SDF）
const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float k; uniform float scroll; uniform float pinH; uniform float pinK;
  float box(vec2 p, vec4 r, float rad) { vec2 c = r.xy + r.zw * 0.5; return sdBox(p - c, r.zw * 0.5 - rad) - rad; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下，跟 Canvas2D 一樣
    vec3 col = C_INK + (C_INK2 - C_INK) * 0.35 * (0.5 + 0.5 * fbm(p / 600.0 + vec2(t * 0.01, 0.0), 3));
    // 視窗
    float dP = box(p, vec4(${P.x}.0, ${P.y}.0, ${P.w}.0, ${P.h}.0), 26.0);
    float inP = aaFill(dP) * k;
    vec3 panel = C_INK2;
    // 對話串的底紋：很淡的點陣，跟著捲動慢慢往上（視差 0.35）
    vec2 q = vec2(p.x, p.y + scroll * 0.35);
    vec2 g = fract(q / 44.0) - 0.5;
    float dots = 1.0 - smoothstep(1.2, 2.2, length(g * 44.0));
    panel += C_BONE * dots * 0.018;
    // 標題列與輸入列比對話串再浮起來一點
    float head = step(p.y, ${P.y + HEAD}.0);
    float foot = step(${P.y + P.h - IN_H}.0, p.y);
    panel = mix(panel, mix(C_INK2, C_GRAPHITE, 0.10), max(head, foot));
    // 置頂列（從標題列下面拉下來）
    float inX = step(${P.x}.0, p.x) * step(p.x, ${P.x + P.w}.0);
    float inPin = step(${S_TOP}.0, p.y) * step(p.y, ${S_TOP}.0 + pinH) * inX;
    panel = mix(panel, mix(C_INK2, C_GRAPHITE, 0.16), inPin * pinK);
    col = mix(col, panel, inP);
    // 細線：視窗外框、標題列與輸入列的分隔線、置頂列的下緣（訊號色）
    col += C_BONE * aaStroke(dP, 1.2) * 0.16 * k;
    float hl = pxLine(abs(p.y - ${P.y + HEAD}.0), 0.3, 1.1) + pxLine(abs(p.y - ${P.y + P.h - IN_H}.0), 0.3, 1.1);
    col += C_BONE * hl * 0.09 * inP;
    col += C_SIGNAL * pxLine(abs(p.y - (${S_TOP}.0 + pinH)), 0.3, 1.1) * 0.35 * pinK * step(1.0, pinH) * inX;
    // 輸入框
    float dI = box(p, vec4(${LAV}.0, ${P.y + P.h - IN_H + 16}.0, ${BXR - LAV - 40}.0, ${IN_H - 32}.0), 27.0);
    col = mix(col, C_INK, aaFill(dI) * 0.8 * k);
    col += C_BONE * aaStroke(dI, 1.0) * 0.12 * k;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, k: { value: 1 }, scroll: { value: 0 }, pinH: { value: 0 }, pinK: { value: 0 } });

// ---------------------------------------------------------------- 對話串
type Kind = 'sys' | 'guest' | 'song' | 'voice';
interface Item {
  kind: Kind;
  /** 開始「正在輸入…」與泡泡彈出的時間（沒有打字中就一樣）；已經在歷史裡的是 -Infinity。 */
  tT: number;
  tA: number;
  /** 打字中與泡泡的高度（含下面的間距）。 */
  hT: number;
  hA: number;
  /** 泡泡寬、高（不含名字列）。 */
  bw: number;
  bh: number;
  text?: string;
  line?: Line;
  lay?: LyricLayout;
  msg?: Msg;
  fit?: FitResult;
  family?: string;
  name?: string;
  hero?: boolean;
}
interface Placed { it: Item; y: number; h: number }

const TYPING_W = 132, TYPING_H = 64;

export default class Chat extends Scene {
  bg = shared('chat.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  items: Item[] = [];
  hero: Item | null = null;
  /** 置頂的時間與置頂列的高度。 */
  tPin = Infinity;
  pinH = 0;
  pinned: { lay: FitResult; family: string; text: string; label: string } | null = null;
  clock = '20:13';
  voice: number[] = [];
  members: string[] = [];

  override async init() {
    const { audio: au, lyrics, song, params, live } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.g = grid(au, s, e);
    const g = this.g, c = this.layer.ctx;
    const others: Msg[] = ((params.messages ?? []) as Msg[]).filter((m) => m.id !== this.msg?.id);
    // 冷面的時鐘：第幾首歌推算的「現在幾點」（晚宴大概六點半開始、一首歌四分鐘）
    const mins = 18 * 60 + 30 + (Math.max(1, song.index) - 1) * 4 + Math.floor(s / 60);
    this.clock = `${pad(Math.floor(mins / 60) % 24, 2)}:${pad(mins % 60, 2)}`;
    const lines = windowLines(lyrics, s, e);
    this.members = [...new Set(others.map((m) => m.name).filter(Boolean))].slice(0, 9);
    await loadText(`今晚的賓客群組位成員正在播放輸入祝福掃右下角就能加入置頂新人一位賓客有人正在輸入建立了群組芃芃加入語音訊息已讀今天線上${COUPLE_ZH}${song.title}${song.artist}${this.msg ? this.msg.text + this.msg.name : ''}${others.slice(0, 6).map((m) => m.text + m.name).join('')}${lines.map((l) => l.text).join('')}${this.members.join('')}`);

    const hist: Item[] = [];
    const sys = (text: string, tA = -Infinity): Item => ({ kind: 'sys', tT: tA, tA, hT: 58, hA: 58, bw: 0, bh: 40, text });
    hist.push(sys(`今天 ${this.clock}`));
    // 歷史：之前的兩則短留言（有的話），沒有就是狗狗加入群組
    const olds = others.filter((m) => Array.from(m.text).length <= 26).slice(0, 2);
    if (olds.length) for (const m of olds) hist.push(this.guestItem(c, m, -Infinity, -Infinity, false));
    else { hist.push(sys(`${COUPLE_ZH} 建立了群組`)); hist.push(sys('芃芃、QQ 加入了群組')); }

    // 歌那一邊：每一句歌詞一個泡泡。前一拍打字中，前 0.35 秒彈出；窗格開始前就開始的句子直接在歷史裡
    const songItems: Item[] = [];
    for (const l of lines) {
      const tA = l.start - 0.35;
      const tT = Math.max(s + 0.1, tA - g.beat);
      const lay = layoutLyric(c, l, LYRIC);
      const rowW = Math.max(...lay.rows.map((r) => r.width));
      const bw = rowW + 2 * PADX, bh = lay.height + 2 * PADY + lay.size * 0.28;
      const past = tA < s + 0.05;
      songItems.push({ kind: 'song', tT: past ? -Infinity : tT < tA - 0.12 ? tT : tA, tA: past ? -Infinity : tA, hT: TYPING_H + GAP, hA: bh + GAP, bw, bh, line: l, lay });
    }

    // 主打留言：第一拍打字中、下一拍彈出、再下一個小節線置頂
    const items: Item[] = [...hist, ...songItems];
    if (this.msg) {
      const tT = g.b0, tA = g.b0 + g.beat;
      const hero = this.guestItem(c, this.msg, tT, tA, true);
      this.hero = hero;
      items.push(hero);
      // 置頂：彈出後至少一拍半，挑下一個小節線（窗格太短就用下一拍）
      let tp = g.bars.find((b) => b >= tA + g.beat * 1.4) ?? tA + g.beat * 2;
      if (tp > e - g.beat) tp = Math.max(tA + g.beat, e - g.beat);
      this.tPin = tp;
      this.pinH = NAME_H + hero.bh + 34;
    } else {
      // 沒有留言：置頂列放邀請，第一拍拉下來；賓客那邊有人一直在打字
      const text = '掃描右下角 QR code，你的祝福也會出現在這裡';
      const fit = fitText(c, text, F.hei(500), BXR - BXL - 2 * PADX, 130, { min: 44, max: 52, lineHeight: 1.3, maxLines: 2 });
      this.pinned = { lay: fit, family: F.hei(500), text, label: '置頂 · 新人' };
      this.tPin = g.b0;
      this.pinH = NAME_H + fit.height + 2 * PADY + fit.size * 0.3 + 34;
      items.push({ kind: 'guest', tT: g.bar0 + g.beat, tA: Infinity, hT: TYPING_H + NAME_H + GAP, hA: 0, bw: 0, bh: 0, name: '一位賓客' });
    }
    // 純音樂（這個窗格沒有歌詞）：歌傳一則語音訊息
    if (!lines.length) {
      const tA = this.msg ? Math.min(this.tPin + g.beat, e - g.beat) : g.b0 + g.beat * 2;
      items.push({ kind: 'voice', tT: tA - g.beat, tA, hT: TYPING_H + GAP, hA: 112 + GAP, bw: 720, bh: 112 });
      const N = 46;
      for (let k = 0; k < N; k++) this.voice.push(au.env('rms', lerp(tA, e, k / (N - 1))));
    }
    // 依出現時間排（打字中的三個點會一直在最下面，跟真的聊天室一樣）
    this.items = items.sort((a, b) => a.tA - b.tA);
  }

  /** 賓客的泡泡：名字列＋手寫字的泡泡。主打的字大一點、寬一點（之後要整則搬到置頂列，不重排）。 */
  private guestItem(c: CanvasRenderingContext2D, m: Msg, tT: number, tA: number, hero: boolean): Item {
    const family = F.hand(400);
    const maxW = BXR - BXL - 2 * PADX - (hero ? 0 : 280);
    const fit = fitText(c, m.text, family, maxW, hero ? 230 : 110, hero ? { min: 44, max: 66, lineHeight: 1.3, maxLines: 3 } : { min: 44, max: 44, lineHeight: 1.3, maxLines: 2 });
    const bw = fit.width + 2 * PADX, bh = fit.height + 2 * PADY + fit.size * 0.3;
    return { kind: 'guest', tT: tT < tA - 0.12 ? tT : tA, tA, hT: TYPING_H + NAME_H + GAP, hA: NAME_H + bh + GAP, bw, bh, msg: m, fit, family, name: m.name || '一位賓客', hero };
  }

  /** 一則在 t 時佔的高度（彈簧）。 */
  private height(it: Item, t: number): number {
    if (t < it.tT) return 0;
    if (it.tT === -Infinity && it.tA === -Infinity) return it.hA;
    let h: number;
    if (t < it.tA) h = it.hT * settle(t, it.tT);
    else h = it.tT < it.tA ? lerp(it.hT, it.hA, settle(t, it.tA)) : it.hA * settle(t, it.tA);
    // 置頂之後，原來的位置縮成一行「已置頂」
    if (it.hero && t > this.tPin) h = lerp(h, 58, settle(t, this.tPin));
    return Math.max(0, h);
  }

  private stack(t: number): Placed[] {
    const out: Placed[] = [];
    let y = S_BOT;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      const h = this.height(it, t);
      if (h <= 0.5) continue;
      out.push({ it, y, h });
      y -= h;
    }
    return out;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, song, live } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, g = this.g;
    const k = prog(t, s, s + 0.25, ease.outCubic);
    const pinK = prog(t, this.tPin, this.tPin + 0.38, ease.outExpo);
    const pinH = this.pinH * pinK;
    const placed = this.stack(t);
    const scroll = placed.reduce((a, p) => a + p.h, 0);
    this.bg.u.t!.value = t; this.bg.u.k!.value = k; this.bg.u.scroll!.value = scroll;
    this.bg.u.pinH!.value = pinH; this.bg.u.pinK!.value = pinK;
    this.bg.render(renderer, out);

    const L = this.layer; L.clear();
    const c = L.ctx;
    this.glow.clear();
    c.globalAlpha = k;
    this.header(c, t);
    this.footer(c, t);
    this.side(c, t);

    // 對話串：裁在置頂列下面到輸入列上面
    const top = S_TOP + pinH;
    c.save();
    c.beginPath(); c.rect(P.x, top, P.w, S_BOT + 14 - top); c.clip();
    for (const p of placed) this.item(c, p, t);
    c.restore();
    // 上緣漸層：捲上去的泡泡淡淡地消失在置頂列（或標題列）下面
    const grd = c.createLinearGradient(0, top, 0, top + 70);
    grd.addColorStop(0, rgba('ink2', 1)); grd.addColorStop(1, rgba('ink2', 0));
    c.fillStyle = grd; c.fillRect(P.x + 2, top, P.w - 4, 70);

    // 置頂列
    let spark: { x: number; y: number } | null = null;
    if (pinK > 0) this.pinnedRow(c, t, pinK, placed);
    // 主打泡泡剛彈出：火花沿著泡泡描一圈
    if (this.hero && t >= this.hero.tA && t < this.hero.tA + 0.75 && t < this.tPin) {
      const hp = placed.find((p) => p.it === this.hero);
      if (hp) spark = this.traceSpark(c, BXL, hp.y - GAP - this.hero.bh, this.hero.bw, this.hero.bh, prog(t, this.hero.tA + 0.05, this.hero.tA + 0.7, ease.inOutCubic));
    }
    comp.draw(renderer, L.upload(), out);
    if (spark) {
      const sp = spark;
      sparkParticles(this.glow, t, () => sp, { rate: 90, life: 0.32, speed: 200, seed: 11 });
      sparkHead(this.glow, sp.x, sp.y, t, 0.85);
    }
    if (this.glow.count) this.glow.render(renderer, out);

    // 新泡泡彈出、置頂落下：畫面輕輕頂一下
    let lastPop = -Infinity;
    for (const it of this.items) if (it.tA <= t && it.tA > lastPop) lastPop = it.tA;
    const bump = pulse(t, lastPop, 0.1) * 0.005 + pulse(t, this.tPin, 0.12) * 0.008;
    // 鏡頭：每個小節線往前推一小步（推到 4% 為止），緩進小節線、停住，不是一直飄
    let push = 0;
    for (const b of g.bars) if (b > s + 0.1) push += 0.009 * prog(t, b - 0.12, b + 0.35, ease.outExpo);
    void au; void song; void live; void e;
    const avoid: [number, number, number, number][] = [[P.x, S_TOP, P.w, S_BOT - S_TOP + 10]];
    return { bloom: 0.5, vignette: 0.42, zoom: 1 + Math.min(0.04, push) + bump, popupAvoid: avoid };
  }

  // ---------------------------------------------------------------- 一則
  private item(c: CanvasRenderingContext2D, p: Placed, t: number) {
    const it = p.it;
    const bottom = p.y - GAP;
    if (it.kind === 'sys') {
      // 系統訊息：置中的小膠囊
      c.font = font(F.hei(500), 22);
      const w = c.measureText(it.text!).width + 40;
      const cx = (P.x + P.x + P.w) / 2;
      c.fillStyle = rgba('graphite', 0.35);
      rrect(c, cx - w / 2, bottom - 40, w, 40, 20); c.fill();
      c.fillStyle = rgba('ash', 0.9); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(it.text!, cx, bottom - 19);
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      return;
    }
    const left = it.kind === 'guest';
    const typing = t < it.tA;
    // 置頂之後，主打留言原本的位置換成一行「已置頂」
    if (it.hero && t > this.tPin + 0.05) {
      const a = prog(t, this.tPin + 0.1, this.tPin + 0.4);
      c.save(); c.globalAlpha *= a;
      c.font = font(F.mono(500), 18); c.letterSpacing = '3px'; c.textAlign = 'center'; c.fillStyle = rgba('ash', 0.8);
      c.fillText(`— 已置頂 No.${pad(it.msg!.n)} —`, (P.x * 2 + P.w) / 2, bottom - 14);
      c.letterSpacing = '0px'; c.textAlign = 'left';
      c.restore();
      return;
    }
    // 大頭貼（打字中就出現，對齊泡泡的下緣、尾巴那一側）；名字列在泡泡上面
    const ay = bottom - (typing ? TYPING_H : it.bh);
    const aK = pop(t, it.tT === -Infinity ? -1e9 : it.tT, 0.3);
    if (aK > 0) this.avatar(c, left ? LAV : RAV, bottom - AV + 4, left ? initial(it.name ?? '') : '♪', left, aK, t);
    if (left) {
      // 名字列
      c.save();
      c.globalAlpha *= clamp(aK * 1.5);
      c.font = font(F.hei(500), 24); c.fillStyle = rgba('ash', 0.9);
      const label = it.msg ? `${it.name}` : it.name ?? '';
      c.fillText(typing ? `${label} 正在輸入…` : label, BXL + 4, ay - 10);
      if (!typing && it.msg) {
        const w = c.measureText(label).width;
        c.font = font(F.mono(500), 17); c.fillStyle = rgba(it.msg.couple ? 'signal' : 'graphite', 0.95); c.letterSpacing = '2px';
        c.fillText(it.msg.couple ? `FROM THE COUPLE · No.${pad(it.msg.n)}` : `No.${pad(it.msg.n)}`, BXL + 4 + w + 16, ay - 11);
        c.letterSpacing = '0px';
      }
      c.restore();
    }
    if (typing) { this.typingDots(c, left ? BXL : BXR - TYPING_W, bottom - TYPING_H, left, t, it.tT); return; }
    const k = pop(t, it.tA === -Infinity ? -1e9 : it.tA, 0.34);
    if (k <= 0) return;
    const x = left ? BXL : BXR - it.bw, y = bottom - it.bh;
    c.save();
    // 從靠大頭貼的下角彈出來
    const ox = left ? x : x + it.bw, oy = y + it.bh;
    c.translate(ox, oy); c.scale(k, k); c.translate(-ox, -oy);
    c.globalAlpha *= clamp(k * 2);
    this.bubble(c, x, y, it.bw, it.bh, left, it.kind === 'song' || it.kind === 'voice' ? mixRgba('ink2', 'blood', 0.5) : it.hero ? mixRgba('ink2', 'graphite', 0.62) : mixRgba('ink2', 'graphite', 0.45));
    if (it.kind === 'song') this.lyricIn(c, it, x, y, t);
    else if (it.kind === 'voice') this.voiceIn(c, it, x, y, t);
    else if (it.fit) {
      c.font = font(it.family!, it.fit.size); c.fillStyle = rgba('bone', 0.96);
      it.fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x + PADX, y + PADY + it.fit!.size * 0.92 + i * it.fit!.lineHeight));
    }
    c.restore();
    // 已讀：最新一則歌的泡泡下面，數字一拍一拍往上跳到總留言數（冷面）
    if (!left && it === this.lastSong(t)) {
      const n = Math.min(Math.max(1, this.ctx.live.count), Math.floor(Math.max(0, t - it.tA) / this.g.beat * 7) + 1);
      c.font = font(F.mono(500), 17); c.letterSpacing = '2px'; c.fillStyle = rgba('graphite', 0.95); c.textAlign = 'right';
      c.fillText(`已讀 ${n}`, x - 14, bottom - 6);
      c.textAlign = 'left'; c.letterSpacing = '0px';
    }
  }

  private lastSong(t: number): Item | null {
    let r: Item | null = null;
    for (const it of this.items) if ((it.kind === 'song' || it.kind === 'voice') && it.tA <= t) r = it;
    return r;
  }

  private lyricIn(c: CanvasRenderingContext2D, it: Item, x: number, y: number, t: number) {
    const lay = it.lay!;
    c.save();
    c.translate(x + PADX, y + PADY + lay.size * 0.9);
    drawLyric(c, it.line!, t, { ...LYRIC, active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3) }, lay, 1);
    c.restore();
  }

  /** 語音訊息：播放鍵、真的音量做成的波形、播放頭走過的地方亮起來。 */
  private voiceIn(c: CanvasRenderingContext2D, it: Item, x: number, y: number, t: number) {
    const p = prog(t, it.tA, this.ctx.end);
    const cy = y + it.bh / 2;
    // 播放鍵（跟著大鼓亮一下）
    c.fillStyle = rgba('bone', 0.9);
    c.beginPath(); c.arc(x + 58, cy, 28, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('ink', 1);
    c.beginPath(); c.moveTo(x + 50, cy - 13); c.lineTo(x + 50, cy + 13); c.lineTo(x + 71, cy); c.closePath(); c.fill();
    const N = this.voice.length, x0 = x + 110, x1 = x + it.bw - 110, step = (x1 - x0) / N;
    for (let i = 0; i < N; i++) {
      const v = this.voice[i]!, bx = x0 + i * step;
      const hh = 8 + 58 * Math.pow(v, 0.8);
      const on = i / N < p;
      c.fillStyle = on ? rgba('ember', 0.95) : rgba('bone', 0.3);
      rrect(c, bx, cy - hh / 2, Math.max(3, step * 0.52), hh, 3); c.fill();
    }
    c.font = font(F.mono(500), 22); c.fillStyle = rgba('bone', 0.8);
    const left = Math.max(0, this.ctx.end - t);
    c.fillText(`0:${pad(left, 2)}`, x1 + 22, cy + 8);
  }

  private bubble(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, left: boolean, fill: string) {
    c.fillStyle = fill;
    rrect(c, x, y, w, h, 30); c.fill();
    // 小尾巴（靠大頭貼的下角）
    c.beginPath();
    if (left) { c.moveTo(x + 2, y + h - 30); c.quadraticCurveTo(x - 4, y + h, x - 14, y + h + 2); c.quadraticCurveTo(x + 14, y + h + 2, x + 30, y + h - 2); }
    else { c.moveTo(x + w - 2, y + h - 30); c.quadraticCurveTo(x + w + 4, y + h, x + w + 14, y + h + 2); c.quadraticCurveTo(x + w - 14, y + h + 2, x + w - 30, y + h - 2); }
    c.closePath(); c.fill();
  }

  private avatar(c: CanvasRenderingContext2D, x: number, y: number, ch: string, guest: boolean, k: number, t: number) {
    const cx = x + AV / 2, cy = y + AV / 2, r = (AV / 2) * k;
    c.save();
    c.fillStyle = guest ? mixRgba('graphite', 'ink2', 0.2) : rgba('signal', 0.95);
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.globalAlpha *= clamp(k);
    if (ch === '♥') drawHeart(c, cx, cy + 1, 30 * k);
    else {
      c.font = font(guest ? F.hei(700) : F.hei(900), 30 * k); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = guest ? rgba('bone', 0.95) : rgba('ink', 1);
      c.fillText(ch, cx, cy + 1);
    }
    // 上線的小綠點（用訊號色）：大鼓一打就亮
    if (guest) {
      const kk = this.ctx.audio.hit('kick', t, 0.14);
      c.fillStyle = rgba('signal', 0.6 + 0.4 * kk);
      c.beginPath(); c.arc(cx + r * 0.72, cy + r * 0.72, 7 * k, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** 打字中的三個點：每個八分音符輪到下一個點跳起來。 */
  private typingDots(c: CanvasRenderingContext2D, x: number, y: number, left: boolean, t: number, t0: number) {
    const k = pop(t, t0, 0.3);
    if (k <= 0) return;
    c.save();
    const ox = left ? x : x + TYPING_W, oy = y + TYPING_H;
    c.translate(ox, oy); c.scale(k, k); c.translate(-ox, -oy);
    this.bubble(c, x, y, TYPING_W, TYPING_H, left, left ? mixRgba('ink2', 'graphite', 0.45) : mixRgba('ink2', 'blood', 0.5));
    const half = this.g.beat / 2;
    const ph = (t - t0) / half;
    for (let i = 0; i < 3; i++) {
      const on = Math.floor(ph) % 3 === i;
      const u = ph - Math.floor(ph);
      const lift = on ? Math.sin(Math.PI * clamp(u * 1.4)) * 12 : 0;
      c.fillStyle = rgba('bone', on ? 0.95 : 0.4);
      c.beginPath(); c.arc(x + 38 + i * 28, y + TYPING_H / 2 + 2 - lift, 8, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** 置頂列：主打留言從對話串飛上來（或邀請），左邊一個圖釘、一行「置頂」。 */
  private pinnedRow(c: CanvasRenderingContext2D, t: number, pinK: number, placed: Placed[]) {
    const top = S_TOP, h = this.pinH * pinK;
    c.save();
    c.beginPath(); c.rect(P.x, top, P.w, h); c.clip();
    // 右上：圖釘（細線畫的）與標籤
    const m = this.msg;
    c.font = font(F.mono(500), 17); c.letterSpacing = '3px'; c.fillStyle = rgba('signal', 0.95); c.textAlign = 'right';
    const label = m ? `置頂 · No.${pad(m.n)}${m.couple ? ' · FROM THE COUPLE' : ''}` : this.pinned!.label;
    const lx = P.x + P.w - 34, ly = top + 30;
    c.fillText(label, lx, ly + 8);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    const px = lx - c.measureText(label).width - 44 - label.length * 3;
    c.strokeStyle = rgba('signal', 0.95); c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(px, ly + 12); c.lineTo(px + 9, ly + 3); c.stroke();
    c.beginPath(); c.moveTo(px + 9, ly - 9); c.lineTo(px + 21, ly + 3); c.lineTo(px + 16, ly + 8); c.lineTo(px + 4, ly - 4); c.closePath(); c.stroke();
    if (m && this.hero) {
      const hero = this.hero;
      // 從對話串裡的位置飛上來：起點用置頂那一刻的位置
      const from = this.stack(this.tPin).find((p) => p.it === hero);
      const fy = from ? from.y - GAP - hero.bh : S_BOT - hero.bh;
      const ty = top + NAME_H + 14;
      const u = prog(t, this.tPin, this.tPin + 0.45, ease.outExpo);
      const y = lerp(fy, ty, u);
      c.restore(); c.save();
      c.beginPath(); c.rect(P.x, top, P.w, Math.max(h, 0) + (1 - u) * (S_BOT - top)); c.clip();
      this.avatar(c, LAV, y + hero.bh - AV, initial(hero.name ?? ''), true, 1, t);
      // 署名在名字列（跟對話串裡一樣的位置）
      c.font = font(F.hei(500), 26); c.fillStyle = rgba('ash', 0.95);
      c.fillText(signatureName(hero.name ?? ''), BXL + 4, y - 12);
      this.bubble(c, BXL, y, hero.bw, hero.bh, true, mixRgba('ink2', 'graphite', 0.62));
      c.font = font(hero.family!, hero.fit!.size); c.fillStyle = rgba('bone', 0.97);
      hero.fit!.lines.forEach((ln, i) => fillWithHearts(c, ln, BXL + PADX, y + PADY + hero.fit!.size * 0.92 + i * hero.fit!.lineHeight));
    } else if (this.pinned) {
      const pn = this.pinned, y = top + NAME_H + 14;
      c.font = font(pn.family, pn.lay.size); c.fillStyle = rgba('bone', 0.95);
      pn.lay.lines.forEach((ln, i) => c.fillText(ln, BXL, y + PADY + pn.lay.size * 0.92 + i * pn.lay.lineHeight));
    }
    c.restore();
    void placed;
  }

  /** 火花沿著泡泡的圓角框跑（0..1），回傳火花的位置；跑過的地方留下一條細線。 */
  private traceSpark(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number) {
    if (u <= 0 || u >= 1) return null;
    c.save();
    c.strokeStyle = rgba('signal', 0.75); c.lineWidth = 1.6;
    const head = tracePolyline(c, rrectPts(x - 5, y - 5, w + 10, h + 10, 34), u);
    c.restore();
    return head;
  }

  // ---------------------------------------------------------------- 視窗的其他部分
  private header(c: CanvasRenderingContext2D, t: number) {
    const { song, live, audio: au } = this.ctx;
    const y = P.y + HEAD / 2;
    c.strokeStyle = rgba('bone', 0.7); c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(P.x + 44, y - 14); c.lineTo(P.x + 32, y); c.lineTo(P.x + 44, y + 14); c.stroke();
    // 群組的大頭貼：一顆愛心
    c.fillStyle = mixRgba('graphite', 'ink2', 0.3);
    c.beginPath(); c.arc(P.x + 96, y, 30, 0, Math.PI * 2); c.fill();
    drawHeart(c, P.x + 96, y + 1, 30);
    c.font = font(F.hei(700), 32); c.fillStyle = rgba('bone', 0.95);
    c.fillText('今晚的賓客群組', P.x + 144, y - 2);
    c.font = font(F.mono(400), 17); c.fillStyle = rgba('ash', 0.85); c.letterSpacing = '1px';
    const sub = `${Math.max(live.count, 2)} 位成員 · 正在播放 ${song.title || '今晚的歌'}`;
    c.fillText(sub.length > 44 ? sub.slice(0, 43) + '…' : sub, P.x + 144, y + 26);
    c.letterSpacing = '0px';
    // 右上角的小等化器（真的低、中、高頻）
    const ex = P.x + P.w - 120;
    const v = [au.env('low', t), au.env('mid', t), au.env('high', t), au.env('rms', t)];
    v.forEach((a, i) => { const hh = 6 + 34 * a; c.fillStyle = rgba('signal', 0.9); c.fillRect(ex + i * 12, y + 17 - hh, 7, hh); });
    c.fillStyle = rgba('bone', 0.6);
    for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(ex + 78, y - 12 + i * 12, 3, 0, Math.PI * 2); c.fill(); }
  }

  private footer(c: CanvasRenderingContext2D, t: number) {
    const y = P.y + P.h - IN_H / 2;
    c.font = font(F.hei(400), 26); c.fillStyle = rgba('graphite', 1);
    c.fillText('輸入祝福…（掃右下角 QR code 就能加入）', LAV + 30, y + 9);
    // 送出鍵：一拍亮一下
    const bx = BXR + 10, kk = this.ctx.audio.hit('kick', t, 0.16);
    c.fillStyle = rgba('signal', 0.75 + 0.25 * kk);
    c.beginPath(); c.arc(bx + 30, y, 30, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('ink', 1); c.lineWidth = 3.5; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(bx + 30, y + 13); c.lineTo(bx + 30, y - 12); c.moveTo(bx + 19, y - 1); c.lineTo(bx + 30, y - 12); c.lineTo(bx + 41, y - 1); c.stroke();
  }

  /** 右邊的成員列表（裝飾：即時小卡會蓋在這裡）。 */
  private side(c: CanvasRenderingContext2D, t: number) {
    const names = this.members.length >= 3 ? this.members : ['芃芃', 'QQ', ...this.members, '一位賓客'];
    c.save();
    c.globalAlpha *= 0.55;
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.9);
    c.fillText(`線上 · ${pad(Math.max(names.length, this.ctx.live.count), 3)}`, SIDE.x, SIDE.y + 20);
    c.letterSpacing = '0px';
    const kk = this.ctx.audio.hit('kick', t, 0.18);
    names.slice(0, 8).forEach((n, i) => {
      const y = SIDE.y + 70 + i * 70;
      c.fillStyle = mixRgba('graphite', 'ink2', 0.3);
      c.beginPath(); c.arc(SIDE.x + 22, y, 22, 0, Math.PI * 2); c.fill();
      c.font = font(F.hei(700), 20); c.fillStyle = rgba('bone', 0.9); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(initial(n), SIDE.x + 22, y + 1);
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      c.font = font(F.hei(500), 24); c.fillStyle = rgba('bone', 0.8);
      c.fillText(n.length > 10 ? n.slice(0, 9) + '…' : n, SIDE.x + 60, y + 8);
      c.fillStyle = rgba('signal', 0.5 + 0.5 * kk * ((i % 3) === (Math.floor(t / this.g.beat) % 3) ? 1 : 0.3));
      c.beginPath(); c.arc(SIDE.x + 38, y + 16, 5, 0, Math.PI * 2); c.fill();
    });
    c.restore();
  }
}

const signatureName = (n: string) => `—— ${n || '一位賓客'}`;
