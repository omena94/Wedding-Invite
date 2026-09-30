// 機房（暗、work）：左邊三座伺服器機櫃，燈號在黑暗裡一閃一閃。宣文（連帽外套）把一條藍色網路線插進機櫃的交換器，孟庭（護理服）拿紅筆在右邊牆上的
// 「上線檢查表」一項一項打勾。角色是 Codex 畫的紙偶（_puppet.ts，work 組）；機櫃、燈號、網路線、檢查表用程式畫。**不畫任何公司的名稱或標誌。**
//  - 照拍子：機櫃的燈號一拍一道波浪掃過去（插好之前很暗、很慢，插好之後從網孔往外擴散、又亮又快）；孟庭兩拍打一個勾（每一勾往前點一下）。
//  - **小節線上插好網路線**：插之前往後帶、小節線上往前一推（喀）、那個網孔的燈亮起來、一圈火花。
//    最後一個小節線：檢查表全部打勾，兩人轉過來比讚、頭上冒愛心。窗格短時事件往前擠。
//  - **焦點是主打留言**：寫在檢查表最後一欄「備註」（牆上貼的一張紙，被機櫃的光照著），深墨手寫字、署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、整張檢查表最大 640 × 420（含上面四個小小的檢查項目），放在畫面右上，高度跟著留言長短。
//    沒有留言時備註欄寫邀請、字淡，歌詞變主角。
//  - 歌詞在機櫃上方一條 LED 字幕（訊號色的燈字），比留言小一級（標準 v2：40～52）。
//  - 光：機櫃的燈是房間唯一的光；紙偶上亮下暗、左邊（機櫃那一側）亮。鏡頭：慢慢推近插頭與檢查表之間。右下角（HUD）只有地板。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, sparkParticles, lyricSubOf, type LyricStyle } from './_motifs';
import { inkFor, inkPath, inkRect, heartPop, type Pt, type Note } from './_couple';
import { loadPuppets, drawPick, puppetPoint, puppetShadow, puppetLight, breathe, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enter, writeNote, sideLight, barsIn, at } from './_c7';

export const spec: PlateSpecDecl = { group: 'couple', family: 'work', paper: false, energy: [0.45, 1], bars: [4, 8] };

const FLOOR = 900;
const SZ = 480;
/** 機櫃：左邊三座並排（面向鏡頭），第三座的右邊是宣文插線的交換器。 */
const RACK = { x: 130, w: 184, gap: 18, top: 250, n: 3 };
const RACK_END = RACK.x + RACK.n * RACK.w + (RACK.n - 1) * RACK.gap;
/** 右上牆上的檢查表：最大的範圍（上緣固定、高度跟著留言）、寫留言的內距（上面留給標題與四個檢查項目）。 */
const SHEET = { x: 1180, y: 104, w: 640, h: 420 };
const PAD = { x: 36, top: 150, bottom: 22 };
const ITEMS = ['電源', '網路', '備援', '監控'];
/** 機櫃上方的 LED 字幕（歌詞）。 */
const LED = { x: 130, y: 110, w: 940, h: 96 };
/** 宣文（翻過來面向左邊的機櫃）、孟庭（面向右後方的檢查表）。 */
const AL_X = 850, OM_X = 1085;
const POSES = ['xw_work_plug', 'xw_work_thumb', 'mt_work_tick', 'mt_work_thumb'];

/** 機房的底：機櫃前一大團很淡的冷光（燈號照出來的）、地板比牆亮一點點、高架地板的格子。 */
const ROOM = () => new FSPass(/* glsl */ `
  uniform float live;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK;
    vec2 q = (p - vec2(${(RACK.x + RACK_END) / 2}.0, 560.0)) / vec2(760.0, 520.0);
    col += mix(C_BONE, C_SIGNAL, 0.35) * (0.02 + 0.035 * live) * exp(-dot(q, q) * 1.8);
    vec2 s = (p - vec2(${SHEET.x + SHEET.w / 2}.0, 320.0)) / vec2(520.0, 360.0);
    col += C_BONE * 0.02 * exp(-dot(s, s) * 1.6);
    float fl = smoothstep(${FLOOR - 2}.0, ${FLOOR + 2}.0, p.y);
    col += C_BONE * 0.012 * fl * (1.0 - 0.6 * smoothstep(${FLOOR}.0, ${H}.0, p.y));
    vec2 g = abs(fract((p - vec2(0.0, ${FLOOR}.0)) / vec2(120.0, 40.0)) - 0.5);
    col += C_BONE * 0.006 * fl * step(0.47, max(g.x, g.y)) * (1.0 - smoothstep(${FLOOR}.0, ${H}.0, p.y));
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { live: { value: 0 } });

/** 第 r 座機櫃裡一格一格的機器：[y, 高度]（確定性：只看編號）。 */
function units(r: number): [number, number][] {
  const out: [number, number][] = [];
  let y = RACK.top + 18, k = 0;
  while (y < FLOOR - 44) {
    const h = (1 + Math.floor(hash(r, k) * 2.2)) * 24;
    out.push([y, h]);
    y += h; k++;
  }
  return out;
}

export default class Servers extends Scene {
  room = shared('servers.room', ROOM);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  sheet = { ...SHEET };
  lyricSize = 52;
  /**
   * LED 字幕板：有原文副行（韓文歌）的窗格，板子往右加寬到檢查表前面（中文盡量一排）、往下長高（最多到機櫃上面），
   * 中文＋原文整塊放在板子正中間；沒有原文的窗格照原本的大小。
   */
  led = { ...LED };
  subWin = false;
  /** 插頭（圖上手裡的水晶頭）與交換器上的網孔。 */
  plug: Pt = { x: 0, y: 0 };
  port: Pt = { x: 0, y: 0 };
  /** 事件：插好、全部打勾（-1 = 沒有）、每一個勾、之後的每個小節線。 */
  tPlug = 0;
  tDone = -1;
  ticks: number[] = [];
  after: number[] = [];
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('上線檢查表 GO-LIVE備註一位賓客（部署中）' + ITEMS.join('') + INVITE);
    this.track(await loadPuppets(POSES));
    const s = this.ctx.start;
    const bars = barsIn(au, s, this.ctx.end, 0.5);
    const n = bars.length;
    this.tPlug = at(bars, n >= 4 ? 1 : 0);
    // 全部打勾：最多第五個小節線（不要拖到最後才發生），之後每個小節線冒愛心
    this.tDone = n >= 3 ? at(bars, Math.min(n - 1, 4)) : -1;
    this.after = this.tDone > 0 ? bars.filter((b) => b > this.tDone + 0.05) : [];
    // 四個勾：第一拍起兩拍一個（窗格短就一拍一個），最後一個在全部完成之前
    const b0 = Math.ceil(au.beatAt(s + 0.8) - 1e-6);
    const last = this.tDone > 0 ? Math.round(au.beatAt(this.tDone)) - 1 : Math.floor(au.beatAt(this.ctx.end - 0.3));
    const step = Math.max(1, Math.min(2, Math.floor((last - b0) / ITEMS.length)));
    this.ticks = ITEMS.map((_, i) => au.timeOfBeat(b0 + i * step));
    // 插頭的位置（圖上手裡的水晶頭，宣文翻過來面向左）；交換器的網孔就在插頭前面一點點（往前推就插進去）
    this.plug = puppetPoint('xw_work_plug', 'plug', AL_X, FLOOR, { h: SZ, flip: true }) ?? { x: AL_X - SZ * 0.3, y: FLOOR - SZ * 0.72 };
    this.port = { x: Math.min(RACK_END - 26, this.plug.x - 16), y: this.plug.y };
    // 檢查表的留言：標準 v2 的字級；紙的寬高跟著留言（靠右）
    const c = this.fg.ctx;
    const w = SHEET.w - PAD.x * 2, hmax = SHEET.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.6, { max: 44 });
    const sw = Math.min(SHEET.w, Math.max(460, tightenNote(c, this.note, 300) + PAD.x * 2));
    const sh = Math.min(SHEET.h, Math.max(300, PAD.top + this.note.height + PAD.bottom + 10));
    this.sheet = { ...SHEET, x: SHEET.x + SHEET.w - sw, w: sw, h: sh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = Math.min(s + 0.9, bars[0]!);
    const subLines = this.ctx.lyrics.linesIn(s - 1, this.ctx.end + 1).filter((l) => !!lyricSubOf(l));
    if (subLines.length) {
      this.subWin = true;
      this.led.w = Math.min(1140, this.sheet.x - 40 - LED.x);
      const need = Math.max(...subLines.map((l) => this.blockH(layoutLyric(c, l, this.lyrStyle()))));
      this.led.h = clamp(Math.ceil(need + 22), LED.h, RACK.top - 16 - LED.y);
    }
    this.drawBackground();
  }

  /** 不會動的：機櫃的外框與一格一格的機器、交換器、this.led 字幕板、檢查表（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ink = inkFor(false, { fill: rgba('ink2') });
    const line = (a: number) => rgba('bone', a);
    c.strokeStyle = line(0.1); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(60, FLOOR); c.lineTo(1860, FLOOR); c.stroke();
    // 三座機櫃：外框、一格一格的機器、機器面板上的細線（通風孔）
    for (let r = 0; r < RACK.n; r++) {
      const x = RACK.x + r * (RACK.w + RACK.gap);
      c.fillStyle = rgba('ink2');
      c.fillRect(x, RACK.top, RACK.w, FLOOR - RACK.top);
      inkRect(c, x, RACK.top, RACK.w, FLOOR - RACK.top, { ink, w: 0.8, t: 0, seed: 10 + r, color: line(0.35) });
      for (const [y, h] of units(r)) {
        c.fillStyle = mixRgba('ink2', 'bone', 0.05 + 0.03 * hash(r, y));
        c.fillRect(x + 12, y, RACK.w - 24, h - 3);
        c.strokeStyle = line(0.1); c.strokeRect(x + 12, y, RACK.w - 24, h - 3);
        c.fillStyle = line(0.05);
        for (let vx = x + 20; vx < x + RACK.w - 70; vx += 6) c.fillRect(vx, y + 5, 2, h - 13);
      }
    }
    // 交換器（第三座機櫃、網孔那一格）：一排網孔
    const P = this.port, x3 = RACK.x + 2 * (RACK.w + RACK.gap);
    c.fillStyle = mixRgba('ink2', 'bone', 0.12);
    c.fillRect(x3 + 12, P.y - 14, RACK.w - 24, 28);
    c.fillStyle = rgba('ink');
    for (let i = 0; i < 7; i++) c.fillRect(x3 + 22 + i * 21, P.y - 6, 14, 12);
    // this.led 字幕板
    c.fillStyle = rgba('ink2');
    c.fillRect(this.led.x, this.led.y, this.led.w, this.led.h);
    c.strokeStyle = line(0.18); c.lineWidth = 1.5; c.strokeRect(this.led.x, this.led.y, this.led.w, this.led.h);
    c.fillStyle = line(0.03);
    for (let y = this.led.y + 8; y < this.led.y + this.led.h - 4; y += 8) for (let x = this.led.x + 8; x < this.led.x + this.led.w - 4; x += 8) c.fillRect(x, y, 2.5, 2.5);
    this.drawSheet(c);
    L.upload();
  }

  /** 檢查表：牆上貼的一張紙（上緣兩條膠帶），標題、四個檢查項目（兩欄）、最後一欄「備註」（留言寫這裡）。 */
  private drawSheet(c: CanvasRenderingContext2D) {
    const S = this.sheet;
    c.fillStyle = rgba('ink', 0.6);
    c.fillRect(S.x + 10, S.y + 12, S.w, S.h);
    const g = c.createLinearGradient(S.x, 0, S.x + S.w, 0);
    g.addColorStop(0, mixRgba('ink2', 'bone', 0.78));
    g.addColorStop(1, mixRgba('ink2', 'bone', 0.66));
    c.fillStyle = g;
    c.fillRect(S.x, S.y, S.w, S.h);
    for (const x of [S.x + 40, S.x + S.w - 110]) { c.fillStyle = mixRgba('ink2', 'bone', 0.45); c.fillRect(x, S.y - 12, 70, 24); }
    c.font = font(F.hei(600), 20);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('ink', 0.7);
    c.fillText('上線檢查表 GO-LIVE', S.x + PAD.x, S.y + 44);
    c.letterSpacing = '0px';
    c.font = font(F.hei(500), 19);
    ITEMS.forEach((it, i) => {
      const B = this.box(i);
      c.strokeStyle = rgba('ink', 0.6); c.lineWidth = 1.5;
      c.strokeRect(B.x, B.y, 18, 18);
      c.fillStyle = rgba('ink', 0.62);
      c.fillText(it, B.x + 30, B.y + 15);
    });
    c.strokeStyle = rgba('ink', 0.25); c.lineWidth = 1;
    c.beginPath(); c.moveTo(S.x + PAD.x, S.y + 128); c.lineTo(S.x + S.w - PAD.x, S.y + 128); c.stroke();
    c.font = font(F.hei(500), 16);
    c.fillStyle = rgba('ink', 0.45);
    c.fillText('備註', S.x + PAD.x, S.y + 148);
  }

  /** 第 i 個檢查項目的勾勾框（左上角）。 */
  private box(i: number): Pt { const S = this.sheet; return { x: S.x + PAD.x + (i % 2) * 200, y: S.y + 65 + Math.floor(i / 2) * 32 }; }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    const live = t >= this.tPlug ? 1 : 0;
    this.room.u.live!.value = live * (0.7 + 0.3 * Math.exp(-(t - au.timeOfBeat(Math.floor(au.beatAt(t)))) / 0.3));
    this.room.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 人（這一層最先畫：打光只染紙偶）：上亮下暗、左邊（機櫃的燈）亮
    this.drawPeople(c, t);
    const box = [AL_X - SZ * 0.6, FLOOR - SZ * 1.2, OM_X - AL_X + SZ * 1.2, SZ * 1.2 + 30] as const;
    puppetLight(c, box, rgba('ink', 0.08), rgba('ink', 0.55));
    sideLight(c, box, mixRgba('bone', 'signal', 0.4, 0.08 + 0.06 * live), rgba('ink', 0.35), false);

    this.drawCable(c, t);
    this.drawLeds(c, t);
    this.drawTicks(c, t);
    this.drawLyric(c, t);
    this.drawMessage(c, t);

    // 插好的那一刻：網孔一圈火花
    if (t >= this.tPlug && t < this.tPlug + 0.5) sparkParticles(this.glow, t, (tb) => (tb >= this.tPlug && tb < this.tPlug + 0.1 ? this.port : null), { rate: 180, life: 0.35, speed: 240, seed: 5 });
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const cx = (this.port.x + this.sheet.x) / 2, cy = 460;
    return { bloom: 0.7, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(cx - W / 2) * 0.03 * push, -(cy - H / 2) * 0.03 * push] };
  }

  /** 插線前一拍往後帶、小節線上往前推（插頭剛好碰到網孔）。回傳往前推了多少（往左是正）。 */
  private shove(t: number) {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    const pre = prog(t, this.tPlug - bp, this.tPlug - 0.04, ease.inOutCubic) * (t < this.tPlug ? 1 : 0);
    return t >= this.tPlug ? 16 * (1 - Math.exp(-(t - this.tPlug) / 0.05)) : -10 * pre;
  }

  /** 最近的一個小節線（比讚時跟著彈一下）。 */
  private lastBar(t: number) { let b = this.tDone; for (const x of this.after) if (t >= x) b = x; return b; }

  /** 宣文（翻過來面向機櫃）：拿著插頭，小節線上往前一推插進去，最後轉過來比讚。孟庭（面向右後方的檢查表）兩拍打一個勾，最後比讚。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const s = this.ctx.start;
    const done = this.tDone > 0 && t >= this.tDone;
    const pop = done ? 0.04 * Math.exp(-(t - this.lastBar(t)) / 0.15) : 0;
    const ea = enter(this.glow, t, s + 0.05, AL_X, FLOOR - 6, 1);
    if (ea) {
      const o: PuppetOpts = { h: SZ, spin: ea.spin, alpha: ea.alpha, pivot: 0.3, squash: breathe(t, 0.008, 3.1) + (t >= this.tPlug ? 0.03 * Math.exp(-(t - this.tPlug) / 0.1) : 0) - pop };
      puppetShadow(c, 'xw', AL_X, FLOOR, { h: SZ, alpha: 0.75 * ea.alpha, color: '0,0,0' });
      if (done) drawPick(c, [[-1e9, 'xw_work_thumb']], t, AL_X, FLOOR, o);
      else drawPick(c, [[-1e9, 'xw_work_plug']], t, AL_X - this.shove(t), FLOOR, { ...o, flip: true });
    }
    const eo = enter(this.glow, t, s + 0.16, OM_X, FLOOR - 6, 2);
    if (eo) {
      let tick = 0;
      for (const tk of this.ticks) { const d = t - tk; if (d > -0.1 && d < 0.3) tick = Math.max(tick, 1 - Math.abs(d - 0.05) / 0.25); }
      puppetShadow(c, 'mt', OM_X, FLOOR, { h: SZ, alpha: 0.75 * eo.alpha, color: '0,0,0' });
      drawPick(c, [[-1e9, 'mt_work_tick'], [done ? this.tDone : 1e9, 'mt_work_thumb']], t, OM_X, FLOOR, { h: SZ, spin: eo.spin, alpha: eo.alpha, pivot: 0.3, rot: 0.03 * tick, squash: breathe(t, 0.008, 3.3, 0.4) - pop });
    }
    for (const t0 of this.tDone > 0 ? [this.tDone, ...this.after] : []) for (let i = 0; i < 2; i++) heartPop(c, (AL_X + OM_X) / 2 - 50 + i * 100, FLOOR - SZ * 1.08, 34, (t - t0 - i * 0.15) / 1.3);
  }

  /** 藍色網路線：從插頭往下垂到地板、沿著地板往右拉到孟庭腳後（插頭跟著宣文的手；插好之後停在網孔上）。 */
  private drawCable(c: CanvasRenderingContext2D, t: number) {
    const done = this.tDone > 0 && t >= this.tDone;
    const head = done || t >= this.tPlug + 0.06 ? this.port : { x: this.plug.x - this.shove(t), y: this.plug.y };
    const ink = inkFor(false);
    const pts: Pt[] = [head, { x: head.x + 20, y: head.y + 40 }, { x: head.x + 50, y: FLOOR - 30 }, { x: head.x + 150, y: FLOOR - 4 }, { x: 1300, y: FLOOR - 2 }];
    inkPath(c, pts, { ink, w: 1.4, seed: 60, color: mixRgba('leash', 'ink', 0.25) });
    // 插好之後露在網孔外的一小截水晶頭
    if (done || t >= this.tPlug + 0.06) { c.fillStyle = mixRgba('bone', 'leash', 0.3, 0.8); c.fillRect(head.x, head.y - 5, 14, 10); }
  }

  /**
   * 機櫃的燈號：每一格機器四顆小燈。每一拍一道亮的波浪掃過去：插好之前從右往左、很暗很慢；插好之後從網孔往外擴散、又亮又快。
   * 網孔的燈：插好之後一直亮（拍點上閃一下）。
   */
  private drawLeds(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const live = t >= this.tPlug;
    const b = au.beatAt(t), ph = b - Math.floor(b);
    const sg = LIN.signal;
    for (let r = 0; r < RACK.n; r++) {
      const x0 = RACK.x + r * (RACK.w + RACK.gap);
      units(r).forEach(([y], k) => {
        for (let j = 0; j < 4; j++) {
          const lx = x0 + RACK.w - 26 - j * 12, ly = y + 9;
          const d = live ? Math.hypot(lx - this.port.x, (ly - this.port.y) * 0.8) / 620 : (RACK_END - lx) / 620;
          const wave = Math.exp(-Math.pow((ph * (live ? 1.4 : 0.9) - d) * (live ? 6 : 4), 2));
          const blink = Math.floor(t * 4 + hash(r, k, j) * 9) % 4 === 0 ? 1 : 0;
          // 插好之前：暗、只有零星閃；插好之後：每顆都亮著、隨機閃，波浪經過時整排亮起來（發光）
          const a = clamp((live ? 0.4 + 0.3 * blink : 0.12 + 0.2 * blink) + wave * (live ? 1 : 0.35));
          c.fillStyle = j < 2 ? mixRgba('ink2', 'signal', a) : mixRgba('ink2', 'bone', a * 0.85);
          c.fillRect(lx - 4, ly - 2.5, 8, 5);
          if (a > 0.55 && j < 2) this.glow.seg2(lx, ly, lx + 0.01, ly, 14, [sg[0] * 2.2 * a, sg[1] * 2.2 * a, sg[2] * 2.2 * a], 0.5);
        }
      });
    }
    if (live) {
      const k = 0.6 + 0.4 * Math.exp(-(t - au.timeOfBeat(Math.floor(b))) / 0.2);
      this.glow.seg2(this.port.x - 4, this.port.y - 12, this.port.x + 4, this.port.y - 12, 5, [sg[0] * 3 * k, sg[1] * 3 * k, sg[2] * 3 * k], 0.9);
    }
  }

  /** 檢查表上的紅勾：照時間一個一個打上去（筆畫描出來）。 */
  private drawTicks(c: CanvasRenderingContext2D, t: number) {
    const ink = inkFor(false);
    this.ticks.forEach((tk, i) => {
      const k = prog(t, tk, tk + 0.18);
      if (k <= 0) return;
      const B = this.box(i);
      const a = { x: B.x + 2, y: B.y + 8 }, m = { x: B.x + 8, y: B.y + 16 }, e = { x: B.x + 24, y: B.y - 6 };
      const pts: Pt[] = k < 0.35 ? [a, { x: a.x + (m.x - a.x) * (k / 0.35), y: a.y + (m.y - a.y) * (k / 0.35) }] : [a, m, { x: m.x + (e.x - m.x) * ((k - 0.35) / 0.65), y: m.y + (e.y - m.y) * ((k - 0.35) / 0.65) }];
      inkPath(c, pts, { ink, w: 1.3, seed: 90 + i, color: rgba('collar', 0.95) });
    });
  }

  private lyrStyle(): LyricStyle {
    const big = !this.msg;
    return { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: this.led.w - 60, unsung: rgba('bone', 0.2), sung: rgba('bone', big ? 0.9 : 0.8), active: rgba('signal') };
  }

  /** 一句歌詞（含原文副行）從字頂到最後一排字底的高度。 */
  private blockH(lay: ReturnType<typeof layoutLyric>) {
    return lay.height - lay.size * 0.2 + (lay.sub ? lay.sub.lay.size * 0.22 : lay.size * 0.2);
  }

  /** LED 字幕：歌詞（訊號色的燈字、照跟唱規則），間奏時一行淡淡的「（部署中）」。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    const R = this.led;
    if (ly) {
      const st = this.lyrStyle();
      const lay = layoutLyric(c, ly.line, st);
      c.translate(R.x + 30, this.subWin ? R.y + (R.h - this.blockH(lay)) / 2 + lay.size * 0.8 : R.y + (R.h - lay.height) / 2 + lay.size * 0.86);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      c.font = font(F.hei(500), 34);
      c.fillStyle = rgba('bone', 0.3);
      c.fillText('（部署中）', R.x + 30, R.y + R.h / 2 + 12);
    }
    c.restore();
  }

  /** 備註欄的留言：一個字一個字寫上去，寫完署名淡入。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const S = this.sheet;
    const top = S.y + PAD.top, h = S.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    writeNote(c, n, S.x + PAD.x, top + Math.max(0, (h - n.height) * 0.4), t, this.msgT0, { msg: !!this.msg, color: rgba('ink', 0.92), faint: rgba('ink', 0.55), sig: rgba('ink', 0.7) });
    c.restore();
  }
}
