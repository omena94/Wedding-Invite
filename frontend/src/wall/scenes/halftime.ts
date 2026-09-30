// 中場投籃挑戰（暗、hoops）：中場休息，場館的燈打在罰球線上——宣文穿著 A&O 球衣上場挑戰「一拍投一球」，
// 孟庭在場邊揮著兩支充氣加油棒。角色是 Codex 畫的紙偶（xw_hoops_shoot_1／2、mt_hoops_wave_1／2…，_puppet.ts、素材組 hoops）。
//  - 投籃一定落在拍點：拍點前半拍拿球往下沉（shoot_1，身體往後帶）→ 拍點上出手（shoot_2，往前送）→ 球沿著拋物線飛、下一拍左右到籃框。
//    大部分空心進（網子往下甩），每三球有一球打到籃框彈出去；窗格最後一個小節線是最後一球：一定空心進，
//    宣文轉過來握拳大叫（cheer）、孟庭跳起來、觀眾剪影站起來、彩帶飄下來，支票上「碰」一聲蓋上「PAID ♥」的章。
//  - 旁邊的球架：一開始放滿，投一球少一顆。
//  - **焦點是主打留言**：寫在左上方架子上那張大支票（獎品看板，紙的顏色、細框、「PAY TO THE ORDER OF 宣文 & 孟庭」）的附言欄，
//    署名簽在右下的簽名線上；照「留言尺寸與版面比例標準 v2」：字 40～60、支票最大 800 × 370，寬高跟著留言。沒有留言時寫邀請。
//  - 歌詞跑在場邊記錄台前面的 LED 板上（lyricOnPath，逐字跟唱），比留言小一級。
//  - 光：中場秀的追光打在宣文身上，支票被一盞暖燈照著；其他地方很暗。鏡頭整個窗格慢慢推近，最後一球進的時候輕輕一震。
//  - 右下角 HUD：只有地板；籃框的柱子、彈出去的球都不進那一塊。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, pulse } from '../engine/util';
import { lyricAt, lyricSubOf, subSizeFor, subGap, beatAfter, msgChars, DATE_DOTS } from './_motifs';
import { lyricOnPath, drawNote, arcAt, type Note } from './_couple';
import { loadPuppets, drawPick, drawCycle, puppetPoint, puppetShadow, puppetIn, puppetLight, jumpArc, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { makeCrowd, CrowdLayer, crowdShade, lyricRows, basketball, drawHoop, streamers, ledBand, type Hoop, type Pt } from './_c8';

export const spec: PlateSpecDecl = { group: 'couple', family: 'hoops', paper: false, energy: [0.45, 1], bars: [4, 8] };

/** 球場：宣文的腳底、籃框（籃板在籃框右邊）。 */
const FLOOR = 830;
const HOOP: Hoop = { x: 1640, y: 470, d: 56, side: 1, floor: FLOOR - 8 };
/** 宣文（罰球線上，側面朝右）、孟庭（左下角場邊，正面）：腳底與場景尺度。 */
const XW = { x: 1060, sz: 400 };
const MT = { x: 330, g: 1010, sz: 380 };
/** 球架：宣文左後方。 */
const RACK = { x: 905, w: 118 };
/** 大支票：左上角架子上，最大寬高（標準 v2）；上面兩行是支票的格式，留言寫在下面的附言欄。 */
const CHECK = { x: 110, y: 96, w: 800, h: 370 };
const PAD = { x: 44, top: 132, bottom: 30 };
/** 場邊記錄台的 LED 板（歌詞）。 */
const TABLE = { x: 560, y: 866, w: 780, h: 118, base: 936 };
/**
 * 韓文歌時 LED 板往上長多少：桌面剛好升到地板線（宣文的腳底），不會蓋到人；中文兩排＋原文才放得進板子，
 * 原文最後一排離下緣還有 96 px（鏡頭推到最近時）。
 */
const KO_UP = 20;
/** 原文最後一排基線最低到這裡（鏡頭最後推到 1.03 倍，放大後還離下緣 96 px）。 */
const KO_LOW = 971;
const BALL_R = 12;
/** 投籃的弧線比出手點高多少（px）。 */
const ARC = 150;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const POSES = ['xw_hoops_shoot_1', 'xw_hoops_shoot_2', 'xw_hoops_cheer', 'mt_hoops_wave_1', 'mt_hoops_wave_2'];

type Result = 'in' | 'miss' | 'swish';
interface Shot { t: number; arrive: number; result: Result; last: boolean }

/**
 * 中場秀的場館：很暗；一道追光從天花板打在罰球線上（地板上一圈光）、支票那裡一盞暖燈、看台很暗。
 * 用 shader 算（浮點＋抖色），淡漸層才不會一圈一圈的。
 */
const ARENA = () => new FSPass(/* glsl */ `
  uniform float flash;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float floorK = smoothstep(${FLOOR - 40}.0, ${FLOOR}.0, p.y);
    // 追光：從 (1100, -40) 往下張開的光錐，地板上一圈
    float y = clamp(p.y / ${FLOOR}.0, 0.0, 1.0);
    float cone = (1.0 - smoothstep(0.5, 1.1, abs(p.x - ${XW.x + 20}.0) / mix(60.0, 300.0, y))) * y * (1.0 - floorK);
    vec2 q = (p - vec2(${XW.x + 20}.0, ${FLOOR + 10}.0)) / vec2(360.0, 70.0);
    float pool = exp(-dot(q, q) * 1.6);
    // 支票的暖燈
    vec2 k = (p - vec2(${CHECK.x + CHECK.w / 2}.0, ${CHECK.y + CHECK.h / 2}.0)) / vec2(620.0, 360.0);
    float warm = exp(-dot(k, k) * 1.4);
    vec3 col = mix(C_INK, C_INK2 + C_BLOOD * 0.04, floorK) + C_BONE * (0.014 * cone + 0.05 * pool) + C_SIGNAL * 0.02 * warm + C_SIGNAL * 0.015 * flash;
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { flash: { value: 0 } });

export default class Halftime extends Scene {
  arena = shared('halftime.arena', ARENA);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 支票、記錄台、籃板（init 畫好，每格貼到 fg：觀眾在它們後面）。 */
  mid = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 「PAID ♥」的章（斜的字先畫好，每格只貼圖）。 */
  stamp = document.createElement('canvas');
  msg: Msg | null = this.ctx.params.message ?? null;
  shots: Shot[] = [];
  keys: [number, string][] = [];
  crowd: CrowdLayer | null = null;
  note: Note | null = null;
  check = { ...CHECK };
  lyricSize = 52;
  /** 記錄台的 LED 板（韓文歌時長高）。 */
  face: typeof TABLE = TABLE;
  msgT0 = 0;
  /** 出手點（shoot_2 的手）與籃框中心：每一球都從這裡飛到那裡。 */
  release: Pt = { x: 0, y: 0 };
  rack = 10;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客新人留言PAY TO THE ORDER OF宣文 & 孟庭HALFTIME CHALLENGE中場投籃挑戰附言PAID ♥∞ 13 · 03' + INVITE + DATE_DOTS);
    this.track(await loadPuppets(POSES));
    // 投籃表：第一拍起一拍一球（快歌兩拍一球）；最後一球放在窗格最後一個小節線（離結尾至少 1.3 秒）
    const step = au.beatPeriod(s) < 0.38 ? 2 : 1;
    const first = beatAfter(au, s + 0.9);
    let last = au.timeOfBar(Math.floor(au.barAt(e - 1.3)));
    if (last < first + au.beatPeriod(first) * 2) last = au.timeOfBeat(Math.floor(au.beatAt(e - 1.0)));
    const b0 = Math.round(au.beatAt(first)), b1 = Math.round(au.beatAt(Math.max(first, last)));
    for (let b = b0, k = 0; b <= b1 && k < 40; b += step, k++) {
      const t = au.timeOfBeat(b);
      const fin = b + step > b1;
      const fly = clamp(au.beatPeriod(t) * step * 0.9, 0.45, 0.8);
      this.shots.push({ t, arrive: t + fly, result: fin ? 'swish' : k % 3 === 1 ? 'miss' : 'in', last: fin });
    }
    // 宣文的姿勢時間軸：拍點前半拍拿球往下沉 → 拍點出手 → 最後一球進了轉過來大叫
    const ks: [number, string][] = [[-1e9, 'xw_hoops_shoot_1']];
    for (const sh of this.shots) {
      const bp = au.beatPeriod(sh.t);
      ks.push([sh.t - bp * step * 0.45, 'xw_hoops_shoot_1'], [sh.t, 'xw_hoops_shoot_2']);
    }
    const fin = this.shots[this.shots.length - 1];
    if (fin) ks.push([fin.arrive, 'xw_hoops_cheer']);
    this.keys = ks.filter((k, i) => i === 0 || k[1] !== ks[i - 1]![1]);
    this.rack = clamp(this.shots.length, 6, 12);
    this.release = puppetPoint('xw_hoops_shoot_2', 'hand', XW.x, FLOOR, { h: XW.sz }) ?? { x: XW.x + XW.sz * 0.22, y: FLOOR - XW.sz * 1.08 };
    // 支票上的留言：標準 v2；支票的寬高跟著留言
    const c = this.fg.ctx;
    const w = CHECK.w - PAD.x * 2, hmax = CHECK.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.6, { max: 44 });
    const ch = Math.min(CHECK.h, Math.max(PAD.top + 90, PAD.top + this.note.height + PAD.bottom + 8));
    // 支票最窄也要放得下最上面那一行（標題＋日期），不然日期會疊到標題上
    const cw = Math.min(CHECK.w, Math.max(760, tightenNote(c, this.note, 520) + PAD.x * 2));
    this.check = { x: CHECK.x, y: CHECK.y, w: cw, h: ch };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    if (!this.msg && this.ctx.lyrics.linesIn(s - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l))) this.face = { ...TABLE, y: TABLE.y - KO_UP, h: TABLE.h + KO_UP };
    this.msgT0 = beatAfter(au, s + 0.3);
    this.crowd = new CrowdLayer(makeCrowd(-20, W + 20, 500, 8, { r: 10, gap: 44, rowH: 40, shrink: 0.94, seed: 31 }), (cc) => crowdShade(cc, 200, 530), rgba('bone', 0.04), SCALE);
    this.makeStamp();
    this.drawBackground();
    this.drawMid();
  }

  /** 「PAID ♥」的章：訊號色的圓角框＋字，斜斜的；先畫在一張小畫布上（斜的字每格重新光柵化很貴）。 */
  private makeStamp() {
    const S = this.stamp, k = 2;
    S.width = 260 * k; S.height = 120 * k;
    const c = S.getContext('2d')!;
    c.scale(k, k);
    c.translate(130, 60);
    c.rotate(-0.18);
    c.strokeStyle = rgba('signal', 0.95);
    c.lineWidth = 5;
    c.beginPath(); c.roundRect(-100, -34, 200, 68, 10); c.stroke();
    c.lineWidth = 1.5;
    c.beginPath(); c.roundRect(-92, -26, 184, 52, 6); c.stroke();
    c.font = font(F.archivo(120, 900), 38);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = rgba('signal', 0.95);
    c.letterSpacing = '6px';
    c.fillText('PAID ♥', 4, 2);
  }

  /** 不會動的：地板的場線（很淡）、罰球線。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    c.strokeStyle = rgba('bone', 0.09);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(560, FLOOR - 8); c.lineTo(1880, FLOOR - 8);
    c.moveTo(1440, FLOOR - 8); c.lineTo(1420, 900);
    c.stroke();
    // 罰球線：宣文腳下一條亮一點的短線
    c.strokeStyle = rgba('bone', 0.3);
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(XW.x + 40, FLOOR - 6); c.lineTo(XW.x + 30, FLOOR + 30); c.stroke();
    L.upload();
  }

  /** 支票（架子、紙、格式）、記錄台的 LED 板、籃板與柱子。 */
  private drawMid() {
    const L = this.mid, c = L.ctx;
    L.clear();
    drawHoop(c, HOOP, 'back', { line: rgba('bone', 0.5), glass: rgba('bone', 0.07), pole: mixRgba('ink2', 'bone', 0.05) });
    // 記錄台：一張長桌的正面是 LED 板
    c.fillStyle = mixRgba('ink', 'ink2', 0.6);
    const T = this.face;
    c.fillRect(T.x - 16, T.y - 16, T.w + 32, 16);
    ledBand(c, { x: T.x, y: T.y, w: T.w, h: T.h });
    // 支票的架子：兩隻腳往下到地板
    const K = this.check;
    c.strokeStyle = mixRgba('ink2', 'bone', 0.12);
    c.lineWidth = 8;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(K.x + 90, K.y + K.h - 6); c.lineTo(K.x + 60, FLOOR + 40);
    c.moveTo(K.x + K.w - 90, K.y + K.h - 6); c.lineTo(K.x + K.w - 60, FLOOR + 40);
    c.stroke();
    // 紙：往右下一點點的影子、紙的顏色、兩圈細框（支票的防偽邊）
    c.fillStyle = rgba('ink', 0.55);
    c.fillRect(K.x + 12, K.y + 14, K.w, K.h);
    // 紙：暖燈從上面打下來，上亮下暗；整張壓暗一點（暗版面裡不要比螢幕上其他東西刺眼太多）
    const pg = c.createLinearGradient(0, K.y, 0, K.y + K.h);
    pg.addColorStop(0, mixRgba('paper', 'ash', 0.18));
    pg.addColorStop(1, mixRgba('paper', 'ash', 0.42));
    c.fillStyle = pg;
    c.fillRect(K.x, K.y, K.w, K.h);
    c.strokeStyle = rgba('sepia', 0.35);
    c.lineWidth = 2;
    c.strokeRect(K.x + 12, K.y + 12, K.w - 24, K.h - 24);
    c.strokeStyle = rgba('sepia', 0.14);
    c.lineWidth = 1;
    c.setLineDash([2, 4]);
    c.strokeRect(K.x + 20, K.y + 20, K.w - 40, K.h - 40);
    c.setLineDash([]);
    // 格式：標題、日期、受款人、金額
    c.fillStyle = rgba('sepia', 0.62);
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillText('HALFTIME CHALLENGE · 中場投籃挑戰', K.x + PAD.x, K.y + 52);
    c.textAlign = 'right';
    c.fillText(DATE_DOTS, K.x + K.w - PAD.x, K.y + 52);
    c.textAlign = 'left';
    c.font = font(F.mono(500), 13);
    c.fillText('PAY TO THE ORDER OF', K.x + PAD.x, K.y + 92);
    // 受款人寫在標籤後面（量過標籤的寬，字距不同的字型也不會疊在一起）
    const nx = K.x + PAD.x + c.measureText('PAY TO THE ORDER OF').width + 16;
    c.letterSpacing = '0px';
    c.font = font(F.hand(400), 22);
    c.fillStyle = rgba('sepia', 0.85);
    c.fillText('宣文 & 孟庭', nx + 6, K.y + 92);
    c.strokeStyle = rgba('sepia', 0.3);
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(nx, K.y + 100); c.lineTo(K.x + K.w - 170, K.y + 100); c.stroke();
    // 金額欄：「∞」
    c.strokeRect(K.x + K.w - 150, K.y + 70, 106, 38);
    c.font = font(F.serif(600), 22);
    c.textAlign = 'center';
    c.fillText('∞', K.x + K.w - 97, K.y + 97);
    c.textAlign = 'left';
    // 簽名線（署名簽在上面）
    c.beginPath(); c.moveTo(K.x + K.w - 330, K.y + K.h - 26); c.lineTo(K.x + K.w - PAD.x + 6, K.y + K.h - 26); c.stroke();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    const fin = this.shots[this.shots.length - 1];
    const win = fin ? pulse(t, fin.arrive, 0.3) : 0;
    this.arena.u.flash!.value = win;
    this.arena.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;

    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    this.drawXuanwen(c, t);
    this.drawMengting(c, t);
    puppetLight(c, [XW.x - 260, FLOOR - XW.sz * 1.35, 520, XW.sz * 1.35 + 30], rgba('ink', 0.02), rgba('ink', 0.42));
    puppetLight(c, [MT.x - 260, MT.g - MT.sz * 1.6, 520, MT.sz * 1.6 + 30], rgba('ink', 0.14), rgba('ink', 0.55));

    // ---- 支票、記錄台、籃板
    c.drawImage(this.mid.canvas, 0, 0, W, H);
    this.drawRack(c, t);
    this.drawCheck(c, t);
    this.drawLyric(c, t);
    this.drawBalls(c, t);

    if (fin && t >= fin.arrive) streamers(c, fin.arrive + 0.05, t, { n: 50, x0: 500, x1: 1880, colors: [rgba('signal', 0.9), rgba('bone', 0.8), rgba('ember', 0.8)], floor: FLOOR + 30 });

    // ---- 看台的觀眾：畫在這一層所有東西後面（destination-over）；進球小小歡呼、最後一球整片站起來
    let cheer = 0;
    for (const sh of this.shots) if (sh.result !== 'miss') cheer = Math.max(cheer, (sh.last ? 1 : 0.35) * prog(t, sh.arrive, sh.arrive + 0.12) * (1 - prog(t, sh.arrive + bp * (sh.last ? 5 : 0.8), sh.arrive + bp * (sh.last ? 8 : 1.6))));
    c.save();
    c.globalCompositeOperation = 'destination-over';
    this.crowd?.draw(c, { bounce: beatKick(au, t, 0.3), cheer, t });
    c.restore();

    comp.draw(renderer, L.upload(), out);
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.65, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [(W / 2 - 900) * 0.03 * push, 5 * win], };
  }

  /** 宣文：姿勢照時間軸；出手前往後帶、出手往前送；最後一球進了原地一跳。 */
  private drawXuanwen(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    let rot = 0, lift = 0, squash = breathe(t, 0.008, 3.1);
    for (const sh of this.shots) {
      const d = t - sh.t;
      if (d > -bp && d < 0) { rot -= 0.05 * prog(t, sh.t - bp * 0.45, sh.t, ease.inOutCubic); squash += 0.04 * prog(t, sh.t - bp * 0.45, sh.t - bp * 0.1); }
      if (d >= 0 && d < bp) { rot += 0.05 * Math.exp(-d / (bp * 0.35)); lift = Math.max(lift, 10 * Math.sin(Math.PI * clamp(d / (bp * 0.5)))); }
      if (sh.last && t >= sh.arrive) { const j = jumpArc(t, sh.arrive, sh.arrive + Math.min(0.5, bp), 46, { crouch: 0.08, land: 0.12 }); if (j.air || t > sh.arrive) { lift = -j.y; squash = j.squash; } }
    }
    const ent = puppetIn(t, this.ctx.start + 0.05, 0.45);
    if (ent.alpha <= 0) return;
    puppetShadow(c, 'xw', XW.x, FLOOR, { h: XW.sz, lift, alpha: 0.8 * ent.alpha, wide: 1.3, color: '0,0,0' });
    drawPick(c, this.keys, t, XW.x, FLOOR - lift, { h: XW.sz, rot, pivot: 0.45, squash, spin: ent.spin, alpha: ent.alpha });
  }

  /** 孟庭：一拍換一邊揮加油棒（wave_1／2）、每拍輕輕一跳；最後一球進了跳高一點，之後揮得更快。 */
  private drawMengting(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    const fin = this.shots[this.shots.length - 1];
    const after = fin && t >= fin.arrive;
    let lift = hop(au.beatAt(t), 1) * 8, squash = 0.03 * beatKick(au, t, 0.2);
    if (fin && after) { const j = jumpArc(t, fin.arrive, fin.arrive + Math.min(0.55, bp * 1.1), 60, { crouch: 0.08, land: 0.14 }); if (j.air || t < fin.arrive + 1) { lift = Math.max(lift, -j.y); squash = j.squash; } }
    const ent = puppetIn(t, this.ctx.start + 0.15, 0.45);
    if (ent.alpha <= 0) return;
    const o: PuppetOpts = { h: MT.sz, squash, spin: ent.spin, alpha: ent.alpha, pivot: 0.3 };
    puppetShadow(c, 'mt', MT.x, MT.g, { h: MT.sz, lift, alpha: 0.75 * ent.alpha, wide: 1.3, color: '0,0,0' });
    drawCycle(c, au, t, ['mt_hoops_wave_1', 'mt_hoops_wave_2'], after ? 2 : 1, MT.x, MT.g - lift, o);
  }

  /** 球架：兩三層，一開始放滿，投一球少一顆（從上層拿）。 */
  private drawRack(c: CanvasRenderingContext2D, t: number) {
    const R = RACK;
    let used = 0;
    for (const sh of this.shots) if (t >= sh.t - this.ctx.audio.beatPeriod(sh.t) * 0.45) used++;
    const left = Math.max(0, this.rack - used);
    const per = 4, rows = Math.ceil(this.rack / per);
    c.save();
    c.strokeStyle = mixRgba('ink2', 'bone', 0.25);
    c.lineWidth = 3;
    c.beginPath();
    for (let r = 0; r < rows; r++) { const y = FLOOR - 30 - r * 34; c.moveTo(R.x - 6, y); c.lineTo(R.x + R.w + 6, y); }
    c.moveTo(R.x, FLOOR); c.lineTo(R.x, FLOOR - 30 - (rows - 1) * 34 - 10);
    c.moveTo(R.x + R.w, FLOOR); c.lineTo(R.x + R.w, FLOOR - 30 - (rows - 1) * 34 - 10);
    c.stroke();
    c.restore();
    for (let i = 0; i < left; i++) {
      const r = Math.floor(i / per), k = i % per;
      basketball(c, R.x + 16 + k * 29, FLOOR - 30 - r * 34 - BALL_R, BALL_R, 0.1 * i, { dark: true });
    }
  }

  /** 每一球：出手（拍點）→ 拋物線 → 到籃框：進（穿過網、掉下來彈一下滾走）或打框彈出去；地上的球慢慢淡掉。 */
  private drawBalls(c: CanvasRenderingContext2D, t: number) {
    let swish = 0;
    for (const sh of this.shots) {
      if (t < sh.t) continue;
      const u = (t - sh.t) / (sh.arrive - sh.t);
      const miss = sh.result === 'miss';
      const target = miss ? { x: HOOP.x - HOOP.d * 0.5, y: HOOP.y - 4 } : { x: HOOP.x, y: HOOP.y };
      let p: Pt, a = 1, rot = (t - sh.t) * 2.2;
      if (u < 1) {
        p = arcAt(this.release, target, ARC, u);
        // 飛的時候拖一小段訊號色的線
        c.save();
        c.lineCap = 'round';
        for (let k = 1; k <= 8; k++) {
          const q0 = arcAt(this.release, target, ARC, Math.max(0, u - (k / 8) * 0.18)), q1 = arcAt(this.release, target, ARC, Math.max(0, u - ((k - 1) / 8) * 0.18));
          c.strokeStyle = rgba('signal', 0.5 * (1 - k / 8));
          c.lineWidth = 2.5;
          c.beginPath(); c.moveTo(q0.x, q0.y); c.lineTo(q1.x, q1.y); c.stroke();
        }
        c.restore();
      } else {
        const d = t - sh.arrive;
        if (!miss) {
          // 穿過網、掉到地上彈一下、往右滾（不進右下角 HUD：地面在 HUD 上緣之上）
          swish = Math.max(swish, Math.exp(-d / 0.35));
          const g = 1800, fall = Math.sqrt((2 * (FLOOR - 10 - BALL_R - HOOP.y)) / g);
          if (d < fall) p = { x: HOOP.x, y: HOOP.y + 0.5 * g * d * d };
          else { const d2 = d - fall, v0 = g * fall * 0.4, by = Math.max(0, v0 * d2 - 0.5 * g * d2 * d2); p = { x: HOOP.x - d2 * 70, y: FLOOR - 10 - BALL_R - by }; }
        } else {
          // 打框：往左上彈出去、落地
          const bx = lerp(target.x, target.x - 190, clamp(d / 0.7)), by = target.y - 180 * Math.sin(Math.PI * clamp(d / 0.7) * 0.5) + 1400 * Math.pow(Math.max(0, d - 0.35), 2);
          p = { x: bx, y: Math.min(by, FLOOR - 10 - BALL_R) };
        }
        a = 1 - prog(t, sh.arrive + 1.1, sh.arrive + 1.6);
        rot = sh.arrive * 2 + d * 3;
        if (a <= 0) continue;
      }
      basketball(c, p.x, p.y, BALL_R, rot, { dark: true, alpha: a });
    }
    drawHoop(c, HOOP, 'front', { line: rgba('bone', 0.5), glass: '', pole: '', swish, t });
  }

  /** 支票上的附言：主打留言一個字一個字寫上去（墨色手寫字），寫完署名簽在簽名線上；最後一球進的時候蓋章。 */
  private drawCheck(c: CanvasRenderingContext2D, t: number) {
    const n = this.note, K = this.check;
    if (n) {
      const total = msgChars(n.fit);
      const per = clamp(1.5 / Math.max(1, total), 0.03, 0.1);
      const done = this.msgT0 + total * per;
      const top = K.y + PAD.top, hh = K.h - PAD.top - PAD.bottom;
      drawNote(c, n, K.x + PAD.x, top + Math.max(0, (hh - n.height) * 0.4), {
        chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.8), sigK: prog(t, done + 0.1, done + 0.5),
      });
    }
    const fin = this.shots[this.shots.length - 1];
    if (fin && t >= fin.arrive) {
      const k = clamp((t - fin.arrive) / 0.18);
      const sc = lerp(1.5, 1, ease.outCubic(k));
      c.save();
      c.globalAlpha = k;
      // 蓋在金額欄「∞」上（付清了），不要蓋到上面那一行日期
      c.translate(K.x + K.w - 97, K.y + 90);
      c.scale(sc, sc);
      c.drawImage(this.stamp, -78, -36, 156, 72);
      c.restore();
    }
  }

  /** 記錄台 LED 板上的歌詞（逐字跟唱）。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    const rv = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.6, ease.inOutCubic);
    // 沒有歌詞（間奏、純音樂）：LED 板慢慢捲一排很淡的中場秀字樣，板子不會黑著
    const idle = 1 - (ly ? ly.k : 0);
    const T = this.face, tall = T.y < TABLE.y;
    if (idle > 0.02) {
      c.save();
      c.beginPath(); c.rect(T.x, T.y, T.w, T.h); c.clip();
      c.font = font(F.mono(600), 26);
      c.letterSpacing = '10px';
      c.fillStyle = rgba('signal', 0.28 * idle * rv);
      const unit = 'HALFTIME · A&O ♥ 13 · 03   ';
      const uw = c.measureText(unit).width;
      for (let x = TABLE.x - ((t * 70) % uw); x < TABLE.x + TABLE.w; x += uw) c.fillText(unit, x, tall ? T.y + T.h / 2 + 9 : TABLE.base - 8);
      c.letterSpacing = '0px';
      c.restore();
    }
    if (!ly) return;
    // 太長、最小字級也放不下一排的句子會折成兩排（第二排往下）：這時整段往上挪，兩排都在板子裡
    const family = F.archivo(100, 700), len = TABLE.w - 60;
    const two = lyricRows(c, ly.line.text, family, this.lyricSize, 40, len) === 2;
    let y = two ? TABLE.base - 26 : TABLE.base;
    if (tall) {
      // 長高的板子：中文（一或兩排）＋原文（lyricOnPath 自動畫在下面）整塊垂直置中，原文最後一排不低於 KO_LOW
      const sub = lyricSubOf(ly.line), ms = two ? 40 : this.lyricSize, ss = subSizeFor(ms);
      let span = two ? ms * 1.05 : 0, bottom = ms * 0.16;
      if (sub) {
        span += subGap(ms, ss) + (lyricRows(c, sub.text, family, ss, Math.min(ss, 26), len) - 1) * ss * 1.05;
        bottom = ss * 0.2;
      }
      y = Math.min(T.y + T.h / 2 - (ms * 0.88 + span + bottom) / 2 + ms * 0.88, KO_LOW - span);
    }
    lyricOnPath(c, ly.line, t, [{ x: TABLE.x + 30, y }, { x: TABLE.x + TABLE.w - 30, y }], {
      family, size: this.lyricSize, minSize: 40, alpha: ly.k * rv, unsung: rgba('bone', 0.24), sung: rgba('bone', 0.9), rowGap: 1.05,
    });
  }
}
