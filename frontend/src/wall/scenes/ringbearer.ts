// 狗狗戒童（暗、dog、婚禮服）：婚禮的走道側面，宣文（西裝）和孟庭（白紗）站在花拱門下等，QQ 叼著戒枕從左邊走紅毯過來，一拍一步；
// 芃芃跟在後面。元元是「花童」：叼著花籃走在 QQ 前面開路，**每一步（拍點）從籃子撒下幾片花瓣、落在紅毯上鋪成一條花路**；
// 走到一半把花籃放下、坐到旁邊看 QQ 送戒指，戒指閃光那一拍仰頭歡呼。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - QQ 小跑步兩張圖一拍換一張，**每一步落在拍點上**（拍點上往前一跨、一彈），走幾小節由窗格長短決定，**到的那一下在小節線**：
//    坐下（叼著戒枕、抬頭挺胸）→ 下一拍宣文單膝跪下伸手接 → 再下一拍戒指閃一下、兩人頭上冒一顆愛心。芃芃晚一拍到、在旁邊坐好。
//  - 兩人等的時候跟著拍子輕輕晃；拱門上的小燈泡照 hi-hat 閃、花瓣慢慢飄下來。
//  - **焦點是主打留言**：後面一排賓客（剪影）裡兩個人把一張手寫的牌子舉過頭頂，留言寫在牌子上（米白紙、手寫字、署名）；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、牌子最大 660 × 360，放在畫面左上，高度跟著留言。沒有留言時牌子寫邀請、字淡，歌詞變主角。
//  - 歌詞沿著紅毯前緣一排（一行字），照跟唱規則逐字亮。
//  - 暗版面：紙偶打光（上面暖、腳底暗，_c3 的 Lit），白紗才不會比牌子上的字還亮。鏡頭跟著 QQ 慢慢往右搖。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, sparkHead, sparkParticles, msgChars, drawHeart } from './_motifs';
import { drawNote, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetShadow, puppetIn, puppetBox, puppetPoint, breathe, beatKick, landSquash, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { Lit, INVITE } from './_c3';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dog', paper: false, energy: [0.2, 0.85], bars: [4, 8] };

const SZ = 430, DOG_S = 1.3;
/** 走道（紅毯上走的那條線）與紅毯的上下緣。 */
const AISLE = 868, RUG = { top: 842, bottom: 902 };
/** 兩人站的地方（腳底中心，面向左）與花拱門。 */
const COUPLE = { x: 1090 };
/** 拱門的右柱在 x 1360 左邊：右下角 HUD 區（x ≥ 1360、y ≥ 830）保持乾淨。 */
const ARCH = { x: 1075, r: 282, base: AISLE - 6 };
/** QQ 最後坐下的地方、芃芃坐的地方。 */
const QQ_END = 880, PP_END = 715;
/** 元元（花童）走在 QQ 前面多遠、走到哪裡坐下（往後排一點，QQ 和芃芃從牠前面走過去）。三隻用同一個場景尺度。 */
const YY_LEAD = 300, YY_END = 470, YY_BACK = 16;
/** 賓客舉的牌子：最大範圍（標準 v2）、寫字內距。 */
const SIGN = { x: 128, y: 150, w: 640, h: 360 };
const PAD = { x: 40, top: 40, bottom: 30 };
/** 歌詞：紅毯前緣下面一排（中心 x、基線、最寬）。 */
const LYR = { x: 690, y: 972, w: 1080 };
const POSES = ['qq_ringbearer_walk_1', 'qq_ringbearer_walk_2', 'qq_ringbearer_sit', 'cp_ringbearer_wait', 'cp_ringbearer_kneel', 'pp_walk', 'pp_sit',
  'yy_c3_flower_walk_1', 'yy_c3_flower_walk_2', 'yy_sit', 'yy_howl'];
/** 花瓣：什麼時候從哪裡掉（籃子）、落在紅毯的哪裡、轉幾度、什麼顏色（0 白、1 淡粉）。 */
interface Petal { t0: number; x0: number; y0: number; x1: number; y1: number; rot: number; pink: boolean }

/** 會場：很暗的暖色，拱門那裡有一團光（新人站的地方），地板往前越來越暗。 */
const VENUE = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float fl = smoothstep(${AISLE - 60}.0, ${AISLE - 58}.0, p.y);
    vec3 col = mix(C_INK, C_INK2, 0.5 - 0.35 * p.y / ${H}.0);
    col = mix(col, C_INK * 0.9, fl * 0.6);
    vec2 q = (p - vec2(${ARCH.x}.0, ${ARCH.base - 260}.0)) / vec2(520.0, 480.0);
    col += mix(C_EMBER, C_BONE, 0.5) * 0.05 * exp(-dot(q, q) * 1.8);
    vec2 r = (p - vec2(${SIGN.x + SIGN.w / 2}.0, ${SIGN.y + SIGN.h / 2}.0)) / vec2(520.0, 360.0);
    col += C_BONE * 0.012 * exp(-dot(r, r) * 1.5);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

export default class RingBearer extends Scene {
  venue = shared('ringbearer.venue', VENUE);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  lit = new Lit(900, 900);
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  sign = { ...SIGN };
  lyricSize = 52;
  /** QQ 起步、到達（小節線）的拍；每一拍往前跨一步。 */
  b0 = 0;
  bA = 0;
  tA = 0;
  cpKeys: [number, string][] = [];
  /** 拱門上的小燈泡。 */
  bulbs: { x: number; y: number }[] = [];
  /** 元元坐下的時間（走到 YY_END）；撒在紅毯上的花瓣。 */
  tYSit = 0;
  petals: Petal[] = [];

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(POSES));
    // 走幾小節：窗格的一半左右（1～4 小節），到的那一下落在小節線；起步在開場後的第一拍
    this.b0 = Math.ceil(au.beatAt(this.ctx.start + 0.25) - 1e-6);
    const barDur = au.timeOfBar(Math.round(au.barAt(this.ctx.start)) + 1) - au.timeOfBar(Math.round(au.barAt(this.ctx.start)));
    const bars = clamp(Math.floor(((this.ctx.end - this.ctx.start) / Math.max(0.5, barDur)) * 0.5), 1, 4);
    this.tA = barAfter(au, au.timeOfBeat(this.b0) + barDur * (bars - 0.5));
    this.bA = Math.round(au.beatAt(this.tA));
    if (this.bA - this.b0 < 3) this.bA = this.b0 + 3;
    this.tA = au.timeOfBeat(this.bA);
    // 元元：走在 QQ 前面 YY_LEAD，走到 YY_END 坐下（找第一個到的時間：一拍一拍往後找，再在那一拍裡細找）
    this.tYSit = this.tA;
    for (let b = this.b0 - 1; b <= this.bA; b++) {
      if (this.qqX(au.timeOfBeat(b + 1)) + YY_LEAD < YY_END) continue;
      let lo = au.timeOfBeat(b), hi = au.timeOfBeat(b + 1);
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (this.qqX(m) + YY_LEAD >= YY_END) hi = m; else lo = m; }
      this.tYSit = hi;
      break;
    }
    // 花瓣：元元走路時每一拍（腳落地）從籃子撒下三片，飄到紅毯上鋪著（位置用種子挑，確定性）
    for (let b = this.b0 - 1; b <= this.bA; b++) {
      const tb = au.timeOfBeat(b);
      if (tb >= this.tYSit || tb < this.ctx.start) continue;
      const x = this.yyX(tb), name = b % 2 === 0 ? 'yy_c3_flower_walk_1' : 'yy_c3_flower_walk_2';
      const bk = puppetPoint(name, 'basket', x, AISLE - YY_BACK, { h: SZ, scale: DOG_S }) ?? { x: x + 120, y: AISLE - 120 };
      for (let j = 0; j < 3; j++) {
        this.petals.push({
          t0: tb + j * 0.05, x0: bk.x + (hash(b, j, 1) - 0.5) * 30, y0: bk.y,
          x1: bk.x - 40 + hash(b, j, 2) * 110, y1: RUG.top + 6 + hash(b, j, 3) * (RUG.bottom - RUG.top - 12),
          rot: hash(b, j, 4) * Math.PI, pink: hash(b, j, 5) > 0.5,
        });
      }
    }
    // 兩人：等 → QQ 坐下後一拍，宣文單膝跪下接戒枕
    this.cpKeys = [[-1e9, 'cp_ringbearer_wait'], [au.timeOfBeat(this.bA + 1), 'cp_ringbearer_kneel']];
    // 牌子上的留言：標準 v2 的字級；牌子的寬高跟著留言
    const c = this.fg.ctx;
    const w = SIGN.w - PAD.x * 2, hmax = SIGN.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.55, { max: 44 });
    const sw = Math.min(SIGN.w, Math.max(tightenNote(c, this.note, 360) + PAD.x * 2, 420));
    const sh = Math.min(SIGN.h, Math.max(190, PAD.top + this.note.height + PAD.bottom + 8));
    // 牌子的下緣固定在舉牌的手上，往上長
    this.sign = { x: SIGN.x + (SIGN.w - sw) / 2, y: SIGN.y + SIGN.h - sh, w: sw, h: sh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    for (let i = 0; i <= 22; i++) {
      const a = Math.PI + (i / 22) * Math.PI;
      this.bulbs.push({ x: ARCH.x + Math.cos(a) * ARCH.r, y: ARCH.base - 380 + Math.sin(a) * ARCH.r * 0.9 });
    }
    this.drawBackground();
  }

  /** 不會動的：花拱門（兩根柱子、上面的弧、幾叢花）、紅毯、後面一排賓客的剪影、舉牌的兩個人與牌子。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 後面一排賓客（坐著的剪影：頭、肩膀、椅背），燈從右邊的拱門來，剪影右緣一點點亮邊
    const row = AISLE - 70;
    for (let i = 0; i < 14; i++) {
      const x = 80 + i * 70 + (hash(i, 3) - 0.5) * 20;
      if (x > ARCH.x - ARCH.r - 40) break;
      const hh = 0.9 + 0.2 * hash(i, 4);
      this.guest(c, x, row, hh);
    }
    // 舉牌的兩個人：站起來、雙手舉高撐著牌子的兩邊
    const S = this.sign;
    for (const [x, k] of [[S.x + 70, 1], [S.x + S.w - 70, 1.05]] as const) {
      c.fillStyle = rgba('ink', 0.95);
      c.beginPath();
      c.ellipse(x, S.y + S.h + 70 * k, 30 * k, 36 * k, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(x - 60 * k, AISLE - 40); c.quadraticCurveTo(x - 64 * k, S.y + S.h + 118 * k, x - 20 * k, S.y + S.h + 104 * k);
      c.lineTo(x + 20 * k, S.y + S.h + 104 * k); c.quadraticCurveTo(x + 64 * k, S.y + S.h + 118 * k, x + 60 * k, AISLE - 40); c.closePath();
      c.fill();
      // 手臂往上撐牌子
      c.strokeStyle = rgba('ink', 0.95);
      c.lineWidth = 16 * k;
      c.lineCap = 'round';
      for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(x + sx * 34 * k, S.y + S.h + 112 * k); c.lineTo(x + sx * 46 * k, S.y + S.h - 6); c.stroke(); }
    }
    // 牌子：米白紙、薄薄的影子
    c.fillStyle = rgba('ink', 0.6);
    c.fillRect(S.x + 8, S.y + 10, S.w, S.h);
    const g = c.createLinearGradient(S.x, S.y, S.x + S.w, S.y + S.h);
    g.addColorStop(0, mixRgba('bone', 'cream', 0.35));
    g.addColorStop(1, mixRgba('bone', 'ink', 0.18));
    c.fillStyle = g;
    c.fillRect(S.x, S.y, S.w, S.h);
    // 紅毯（很深的酒紅，前緣一條細的亮邊）
    const rg = c.createLinearGradient(0, RUG.top, 0, RUG.bottom);
    rg.addColorStop(0, mixRgba('collar', 'ink', 0.62));
    rg.addColorStop(1, mixRgba('collar', 'ink', 0.45));
    c.fillStyle = rg;
    c.fillRect(-20, RUG.top, ARCH.x + 80, RUG.bottom - RUG.top);
    c.fillStyle = rgba('bone', 0.08);
    c.fillRect(-20, RUG.bottom - 2, ARCH.x + 80, 2);
    // 花拱門：兩根細柱子、上面半圓的弧（淡淡的線），左上與右下各一叢花
    c.strokeStyle = rgba('bone', 0.26);
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(ARCH.x - ARCH.r, ARCH.base); c.lineTo(ARCH.x - ARCH.r, ARCH.base - 380);
    c.ellipse(ARCH.x, ARCH.base - 380, ARCH.r, ARCH.r * 0.9, 0, Math.PI, 0);
    c.lineTo(ARCH.x + ARCH.r, ARCH.base);
    c.stroke();
    // 花：一叢一叢的小花（很多顆小圓、幾片葉子），白花為主、少數玫瑰色；拱門左上一大叢、兩根柱腳各一小叢
    for (const [cx, cy, n, R] of [[ARCH.x - ARCH.r + 70, ARCH.base - 590, 46, 95], [ARCH.x - ARCH.r + 6, ARCH.base - 30, 20, 55], [ARCH.x + ARCH.r - 6, ARCH.base - 210, 24, 60]] as const) {
      c.strokeStyle = mixRgba('gingham', 'ink', 0.55);
      c.lineWidth = 2;
      for (let i = 0; i < n / 3; i++) {
        const a = hash(i, cx, 1) * Math.PI * 2, rr = R * (0.7 + 0.5 * hash(i, cy, 2));
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.7;
        c.fillStyle = mixRgba('gingham', 'ink', 0.6);
        c.beginPath(); c.ellipse(x, y, 16, 6, a, 0, Math.PI * 2); c.fill();
      }
      for (let i = 0; i < n; i++) {
        const a = hash(i, cx) * Math.PI * 2, rr = R * Math.sqrt(hash(i, cy));
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.7, r = 5 + 6 * hash(i, 9);
        c.fillStyle = i % 5 === 0 ? mixRgba('rose', 'ink', 0.35) : mixRgba('bone', 'ink', 0.2 + 0.25 * hash(i, 5));
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = rgba('ink', 0.25);
        c.beginPath(); c.arc(x + r * 0.2, y + r * 0.2, r * 0.35, 0, Math.PI * 2); c.fill();
      }
    }
    L.upload();
  }

  /** 一個坐著的賓客剪影（頭、肩膀、椅背）。 */
  private guest(c: CanvasRenderingContext2D, x: number, y: number, k: number) {
    // 椅背（後面）
    c.fillStyle = rgba('ink', 0.55);
    c.fillRect(x - 32 * k, y - 66 * k, 64 * k, 80 * k);
    // 頭與肩膀：比背景暗一點的剪影，右緣（拱門的燈在右邊）一道很淡的亮邊
    c.fillStyle = rgba('ink', 0.92);
    c.beginPath();
    c.ellipse(x, y - 112 * k, 22 * k, 27 * k, 0, 0, Math.PI * 2);
    c.moveTo(x - 46 * k, y - 16 * k); c.quadraticCurveTo(x - 48 * k, y - 84 * k, x, y - 84 * k); c.quadraticCurveTo(x + 48 * k, y - 84 * k, x + 46 * k, y - 16 * k); c.closePath();
    c.fill();
    c.strokeStyle = rgba('bone', 0.1);
    c.lineWidth = 2;
    c.beginPath(); c.arc(x, y - 112 * k, 22 * k, -1.2, 0.5); c.stroke();
    c.beginPath(); c.moveTo(x + 20 * k, y - 82 * k); c.quadraticCurveTo(x + 46 * k, y - 80 * k, x + 46 * k, y - 30 * k); c.stroke();
  }

  /** QQ 在第幾拍的哪裡：每一拍跨一步（拍點上往前一送，ease-out），到了就停。 */
  private qqX(t: number) {
    const au = this.ctx.audio;
    const x0 = -120;
    const steps = this.bA - this.b0;
    const stride = (QQ_END - x0) / steps;
    const b = au.beatAt(t) - this.b0;
    if (b <= 0) return x0 + stride * 0.35 * clamp(1 + b / 0.5);
    if (b >= steps) return QQ_END;
    const i = Math.floor(b), u = b - i;
    return x0 + stride * (i + ease.outCubic(clamp(u / 0.7)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.venue.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);

    // 拱門的小燈泡：hi-hat 上一顆一顆閃（輪流亮），很淡的暖光
    const hat = f.a.hat, sg = LIN.signal;
    this.bulbs.forEach((p, i) => {
      const tw = 0.35 + 0.65 * (hash(i, Math.floor(au.beatAt(t) * 2)) > 0.5 ? 1 : 0.3) * (0.6 + 0.4 * hat);
      this.glow.polyline([{ x: p.x - 1.5, y: p.y }, { x: p.x + 1.5, y: p.y }], 5, [sg[0] * 2.4, sg[1] * 2.4, sg[2] * 2.4], tw * rv);
    });
    // 花瓣慢慢飄下來（從拱門上方）
    for (let i = 0; i < 12; i++) {
      const life = 5, ph = ((t - s) / life + hash(i, 1)) % 1;
      const x = ARCH.x - ARCH.r + hash(i, 2) * ARCH.r * 2 + Math.sin((t + i) * 1.3) * 26;
      const y = ARCH.base - 620 + ph * 640;
      c.save();
      c.translate(x, y);
      c.rotate(t * (1 + hash(i, 3)) + i);
      c.fillStyle = i % 3 ? mixRgba('bone', 'rose', 0.25, 0.55 * rv) : mixRgba('rose', 'bone', 0.3, 0.5 * rv);
      c.beginPath(); c.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    this.drawSignText(c, t);

    // ---- 兩個人（面向左、在拱門下）
    const en = puppetIn(t, s + 0.05, 0.5);
    if (en.alpha > 0) {
      const o: PuppetOpts = { h: SZ, flip: true, rot: 0.012 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.1, squash: breathe(t, 0.007, 3.3) + 0.01 * beatKick(au, t, 0.3), spin: en.spin, alpha: en.alpha };
      puppetShadow(c, 'cp', COUPLE.x, AISLE, { h: SZ, wide: 1.1, alpha: 0.7 * en.alpha, color: '0,0,0' });
      const box = puppetBox('cp_ringbearer_wait', COUPLE.x, AISLE, { h: SZ, flip: true });
      this.lit.draw(c, [box[0] - 60, box[1] - 30, box[2] + 120, box[3] + 40], rgba('ink', 0.06), rgba('ink', 0.5), (sc) => { drawPick(sc, this.cpKeys, t, COUPLE.x, AISLE, o); });
    }

    // ---- 紅毯上的花瓣（已經落地的鋪在地上，在狗的腳下）
    this.drawPetals(c, t, false);
    // ---- 元元（花童，後排）→ 芃芃（跟在後面，晚一拍到、坐下）
    this.drawYuanyuan(c, t);
    this.drawPetals(c, t, true);
    this.drawPenpen(c, t, bp);
    // ---- QQ
    this.drawQQ(c, t, bp);

    // 戒指閃一下、兩人頭上冒一顆愛心（QQ 坐下後兩拍）
    const tr = au.timeOfBeat(this.bA + 2);
    const dr = t - tr;
    if (dr > 0) {
      const m = puppetPoint('qq_ringbearer_sit', 'ring', QQ_END, AISLE, { h: SZ, scale: DOG_S }) ?? { x: QQ_END + 70, y: AISLE - 100 };
      if (dr < 0.6) {
        const k = 1 - dr / 0.6, r = 10 + 40 * Math.sin(Math.PI * Math.min(1, dr / 0.3));
        this.glow.polyline([{ x: m.x - r, y: m.y }, { x: m.x + r, y: m.y }], 2, [sg[0] * 3, sg[1] * 3, sg[2] * 3], k);
        this.glow.polyline([{ x: m.x, y: m.y - r }, { x: m.x, y: m.y + r }], 2, [sg[0] * 3, sg[1] * 3, sg[2] * 3], k);
        sparkParticles(this.glow, t, () => ({ x: m.x, y: m.y }), { rate: 60, life: 0.35, speed: 160, seed: 9 });
      }
      const k = ease.outBack(clamp(dr / 0.4));
      c.save();
      c.globalAlpha = clamp(dr / 0.2) * (0.85 + 0.15 * beatKick(au, t, 0.3));
      drawHeart(c, COUPLE.x - 20, AISLE - SZ * 1.08 - 30 * k, 44 * k);
      c.restore();
    }

    // 歌詞：紅毯前緣下面一排
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, maxWidth: LYR.w, align: 'center' as const, unsung: rgba('bone', 0.26), sung: rgba('bone', this.msg ? 0.82 : 0.95), active: rgba('signal') };
      c.save();
      c.translate(LYR.x, LYR.y);
      drawLyric(c, ly.line, t, st, layoutLyric(c, ly.line, st), ly.k * rv);
      c.restore();
    }

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：跟著 QQ 往右搖（很少），最後停在兩人與 QQ 之間
    const qx = this.qqX(t);
    return { bloom: 0.6, vignette: 0.55, grain: 0.05, zoom: 1.03, shake: [-(lerp(qx, 1000, 0.5) - W / 2) * 0.03, 0] };
  }

  /** QQ：一拍一步（兩張小跑步的圖一拍換一張），步子落在拍點上一彈；到了坐下（小節線上）。 */
  private drawQQ(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const x = this.qqX(t);
    const arrived = t >= this.tA;
    let lift = 0, squash = 0, name: string;
    if (!arrived) {
      const b = au.beatAt(t), u = b - Math.floor(b);
      // 拍點上腳落地（壓一下）、拍與拍之間彈起來
      lift = 10 * Math.sin(Math.PI * u);
      squash = 0.06 * Math.exp(-u / 0.12) - 0.03 * Math.sin(Math.PI * u);
      name = Math.floor(b) % 2 === 0 ? 'qq_ringbearer_walk_1' : 'qq_ringbearer_walk_2';
    } else {
      squash = landSquash(t, this.tA, 0.16, 0.3) + breathe(t, 0.012, 1.8) + 0.03 * beatKick(au, t, 0.25);
      name = 'qq_ringbearer_sit';
    }
    const o: PuppetOpts = { h: SZ, scale: DOG_S, squash, rot: arrived ? 0 : -0.03 };
    puppetShadow(c, 'qq', x, AISLE, { h: SZ * DOG_S, lift, alpha: 0.6, color: '0,0,0' });
    const box = puppetBox('qq_ringbearer_walk_1', x, AISLE - lift, o);
    this.lit.draw(c, [box[0] - 40, box[1] - 40, box[2] + 80, box[3] + 60], rgba('ink', 0.02), rgba('ink', 0.45), (sc) => { drawPuppet(sc, name, x, AISLE - lift, o); });
    void bp;
  }

  /** 元元的位置：走在 QQ 前面 YY_LEAD（跟 QQ 同一個節奏：拍點上跨一步），到了 YY_END 就停。 */
  private yyX(t: number) {
    return Math.min(this.qqX(t) + YY_LEAD, YY_END);
  }

  /**
   * 元元（花童）：叼著花籃一拍一步（兩張圖一拍換一張、拍點上落地一彈），走到 YY_END 坐下（正面坐），
   * 花籃放在腳邊；戒指閃光那一拍（QQ 坐下後兩拍）仰頭歡呼一拍半，再坐回來。
   */
  private drawYuanyuan(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.02, 0.45);
    if (en.alpha <= 0) return;
    const y0 = AISLE - YY_BACK;
    const x = this.yyX(t);
    const sat = t >= this.tYSit;
    let lift = 0, squash = 0, name: string;
    if (!sat) {
      const b = au.beatAt(t), u = b - Math.floor(b);
      lift = 9 * Math.sin(Math.PI * u);
      squash = 0.05 * Math.exp(-u / 0.12) - 0.025 * Math.sin(Math.PI * u);
      name = Math.floor(b) % 2 === 0 ? 'yy_c3_flower_walk_1' : 'yy_c3_flower_walk_2';
    } else {
      const tH = au.timeOfBeat(this.bA + 2), bp = au.beatPeriod(tH);
      const howl = t >= tH && t < tH + bp * 1.5;
      name = howl ? 'yy_howl' : 'yy_sit';
      squash = landSquash(t, this.tYSit, 0.12, 0.3) + breathe(t, 0.01, 2.2, 0.2) + (howl ? 0 : 0.02 * beatKick(au, t, 0.25));
    }
    const o: PuppetOpts = { h: SZ, scale: DOG_S, squash, rot: sat ? 0 : -0.02, spin: en.spin, alpha: en.alpha };
    puppetShadow(c, 'yy', x, y0, { h: SZ * DOG_S, lift, alpha: 0.6 * en.alpha, color: '0,0,0' });
    const box = puppetBox('yy_c3_flower_walk_1', x, y0 - lift, { ...o, spin: 0 });
    this.lit.draw(c, [box[0] - 160, box[1] - 60, box[2] + 200, box[3] + 80], rgba('ink', 0.03), rgba('ink', 0.46), (sc) => {
      drawPuppet(sc, name, x, y0 - lift, o);
      // 坐下之後花籃放在左邊腳旁（右邊要留給芃芃走過去坐；程式畫的小籐籃，顏色照 Codex 圖上的籃子）
      if (sat) this.basket(sc, x - 100, y0 + 4, prog(t, this.tYSit, this.tYSit + 0.2));
    });
  }

  /** 放在地上的小籐籃：籃身（交叉的淡線）、提把、上面滿滿的花瓣。k：放下的動畫（0..1，從上面落下來）。 */
  private basket(c: CanvasRenderingContext2D, x: number, y: number, k: number) {
    if (k <= 0) return;
    const yy = y - (1 - ease.outCubic(k)) * 60;
    c.save();
    c.translate(x, yy);
    c.fillStyle = mixRgba('fur', 'sepia', 0.35);
    c.beginPath(); c.moveTo(-34, -40); c.lineTo(34, -40); c.lineTo(26, 0); c.lineTo(-26, 0); c.closePath(); c.fill();
    c.strokeStyle = mixRgba('fur', 'sepia', 0.6);
    c.lineWidth = 1.4;
    c.beginPath();
    for (let i = -3; i <= 3; i++) { c.moveTo(i * 10 - 6, -40); c.lineTo(i * 8 + 6, 0); c.moveTo(i * 10 + 6, -40); c.lineTo(i * 8 - 6, 0); }
    c.stroke();
    c.lineWidth = 4;
    c.strokeStyle = mixRgba('fur', 'sepia', 0.45);
    c.beginPath(); c.ellipse(0, -40, 30, 36, 0, Math.PI, Math.PI * 2); c.stroke();
    for (let i = 0; i < 9; i++) {
      c.fillStyle = i % 3 === 0 ? mixRgba('rose', 'bone', 0.45) : mixRgba('bone', 'rose', 0.12);
      c.beginPath(); c.ellipse(-26 + i * 6.5, -42 - (i % 2) * 5, 8, 5, i, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** 花瓣：falling = true 畫還在空中飄的（從籃子掉到紅毯），false 畫已經落地的（鋪在紅毯上）。 */
  private drawPetals(c: CanvasRenderingContext2D, t: number, falling: boolean) {
    const FALL = 0.55;
    for (const p of this.petals) {
      const u = (t - p.t0) / FALL;
      if (u < 0 || (u < 1) !== falling) continue;
      const k = clamp(u);
      const x = lerp(p.x0, p.x1, k) + (falling ? Math.sin(k * 7 + p.rot) * 10 : 0);
      const y = lerp(p.y0, p.y1, ease.inQuad(k));
      c.save();
      c.translate(x, y);
      c.rotate(p.rot + (falling ? k * 4 : 0));
      c.fillStyle = p.pink ? mixRgba('rose', 'bone', 0.4, falling ? 0.9 : 0.75) : mixRgba('bone', 'ink', 0.1, falling ? 0.9 : 0.7);
      c.beginPath(); c.ellipse(0, 0, 7, falling ? 4 : 3, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }

  /** 芃芃：跟在 QQ 後面（一拍一步、慢一拍），QQ 坐下的下一拍在旁邊坐好。 */
  private drawPenpen(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const tS = au.timeOfBeat(this.bA + 1);
    const follow = Math.min(this.qqX(t - bp) - 190, PP_END);
    const x = t >= tS ? PP_END : Math.min(follow, PP_END);
    if (x < -150) return;
    const sit = t >= tS;
    const b = au.beatAt(t), u = b - Math.floor(b);
    const lift = sit ? 0 : 8 * Math.sin(Math.PI * u);
    const squash = sit ? landSquash(t, tS, 0.16, 0.3) + breathe(t, 0.014, 1.6, 0.4) : 0.05 * Math.exp(-u / 0.12);
    const o: PuppetOpts = { h: SZ, scale: DOG_S * 0.95, squash };
    puppetShadow(c, 'pp', x, AISLE + 6, { h: SZ * DOG_S, lift, alpha: 0.55, color: '0,0,0' });
    const box = puppetBox('pp_walk', x, AISLE + 6 - lift, o);
    this.lit.draw(c, [box[0] - 40, box[1] - 60, box[2] + 80, box[3] + 80], rgba('ink', 0.04), rgba('ink', 0.48), (sc) => { drawPuppet(sc, sit ? 'pp_sit' : 'pp_walk', x, AISLE + 6 - lift, o); });
  }

  /** 牌子上的留言：開場後一個字一個字寫上去（手寫字），寫完署名淡入；牌子跟著拍子輕輕晃（舉著的人在晃）。 */
  private drawSignText(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const S = this.sign;
    const t0 = this.ctx.start + 0.5;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.1);
    const done = t0 + total * per;
    const top = S.y + PAD.top, h = S.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    drawNote(c, n, S.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
