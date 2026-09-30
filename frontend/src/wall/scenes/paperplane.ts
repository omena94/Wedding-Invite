// 紙飛機（暗、home）：晚上的頂樓，遠處一排城市的燈。宣文摺一架紙飛機、射出去，紙飛機飛到天上、變成一架大大的紙飛機在風裡滑翔，
// **機翼上寫著主打留言**。角色是 Codex 畫的紙偶（_puppet.ts），紙飛機、城市、星星用程式畫。
//  - 摺紙在拍點上：開場的兩三拍，每拍摺一下（一張紙 → 摺角 → 再摺 → 對折），接著舉起來瞄準，**小節線上射出去**（窗格很短就一拍後射）。
//  - 飛：沿著一條弧線飛上天（三拍），邊飛邊變大、轉成從後上方看的角度，到了定點「啪」一下攤平，留言一個字一個字寫上機翼。
//    之後在風裡滑翔：每拍輕輕一沉、慢慢左右傾。飛過的弧線留下一條虛線，**歌詞沿著這條軌跡排**（跟唱，比留言小一級）。
//  - 孟庭在旁邊：宣文射出去之後指著天空；之後每兩小節她也射一架小紙飛機（沒有字）飛過畫面，QQ 在下一拍跳起來追。
//  - 元元（白柴，三隻裡跳得最高、最穩重）負責撿小紙飛機：孟庭每兩小節射一架小的，元元在右邊等著，兩拍後小飛機滑下來，
//    牠在拍點上跳起來一口咬住，叼著跑回孟庭面前站好等，孟庭下一次瞄準（那一拍）就從牠嘴裡接過去、再射一次——一直循環。
//    大紙飛機飛上天的時候，牠仰頭看著叫。QQ 在兩人中間，每次有飛機射出去就跳起來；芃芃在左邊坐著看。
//  - 標準 v2：留言 40～60，機翼上的字區 ≤ 600 × 270，整架飛機寬 ≤ 860。暗版面：紙偶上亮下暗（月光）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, barAfter, beatAfter, sparkHead, sparkParticles, msgChars, lyricSubOf, layoutLyric, drawLyric, subSizeFor, subStyleFor, subGap, type LyricStyle, type LyricLayout } from './_motifs';
import type { Line } from '../engine/lyrics';
import { inkFor, inkPoly, arcAt, lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, drawCycle, puppetPoint, puppetShadow, puppetLight, jumpArc, landSquash, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet } from './_c5';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'home', paper: false, energy: [0.15, 0.85], bars: [4, 8] };

const GROUND = 930;
const SZ = 520;
const AL_X = 360, OM_X = 690, PP_X = 150, QQ_X = 528, DOG_S = 1.15;
/** 元元等小飛機（也是跳起來接的地方）、叼回來交給孟庭的地方；跳多高。 */
const YY_X = 1150, GIVE_X = 890, YJUMP = 18;
/** 大紙飛機滑翔的位置（機身中心）與大小。 */
const GLIDE = { x: 1372, y: 392, s: 1 };
/** 機翼上寫字的範圍（紙飛機的座標，機頭朝上；標準 v2：≤ 600 × 270）。上緣剛好在往後掠的機翼前緣裡面。 */
const TEXT = { x: -300, y: -62, w: 600, h: 232 };
/** 有原文的句子：天空上那一塊（左緣、中文字頂、最寬；右邊是大紙飛機的機翼；鏡頭最後推近 3.5%，所以離邊多留一點）。 */
const SKY_LYR = { x: 150, top: 116, w: 1040 };
/** 紙飛機的外形（機頭朝上、從後上方看）：尖尖的機頭、往後掠的機翼前緣、翼尖往後折的小翼、尾巴中間的缺口。 */
const PLANE: readonly Pt[] = [
  { x: 0, y: -310 }, { x: -440, y: 40 }, { x: -432, y: 118 }, { x: -372, y: 192 }, { x: -44, y: 178 }, { x: 0, y: 152 },
  { x: 44, y: 178 }, { x: 372, y: 192 }, { x: 432, y: 118 }, { x: 440, y: 40 },
];
/** 紙飛機的圖（機身＋摺線，字另外一張）：圖上的原點在畫布的哪裡。 */
const PW = 900, PH = 500, PO = { x: 450, y: 300 };
const POSES = ['xw_plane_fold', 'xw_plane_aim', 'xw_plane_throw', 'xw_plane_watch', 'mt_idle_front', 'mt_plane_aim', 'mt_plane_throw', 'mt_plane_point', 'pp_beg', 'qq_stand', 'qq_jump',
  'yy_stand', 'yy_run_1', 'yy_run_2', 'yy_jump', 'yy_howl'];

/**
 * 夜空與城市：上面深、地平線附近亮一點（城市的光）、淡淡的星星（很慢地閃）。用 shader 算，漸層才不會一階一階的。
 */
const SKY = () => new FSPass(/* glsl */ `
  uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float y = p.y / ${H}.0;
    vec3 col = mix(C_INK, C_INK2, smoothstep(0.0, 0.72, y));
    col += C_SIGNAL * 0.03 * smoothstep(0.45, 0.72, y) * (1.0 - smoothstep(0.72, 0.8, y));
    vec2 g = p / 5.0;
    vec2 cell = floor(g);
    float h = hash12(cell);
    float tw = 0.6 + 0.4 * sin(t * (0.6 + h * 1.4) + h * 40.0);
    float star = step(0.9965, h) * (1.0 - smoothstep(0.05, 0.3, length(fract(g) - 0.5))) * (1.0 - smoothstep(0.35, 0.6, y));
    col += C_BONE * star * 0.55 * tw;
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 } });

interface Throw { who: 'xw' | 'mt'; t: number; land: number; from: Pt; to: Pt; hgt: number; seed: number }
/** 元元撿一架小飛機的時間軸：接住（land）→ 跑回來（back0～back1）→ 站著等 → 孟庭拿走（give）→ 跑回去等（～ret）。 */
interface Fetch { back0: number; back1: number; give: number; ret: number }

export default class Paperplane extends Scene {
  sky = shared('paperplane.sky', SKY);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 大紙飛機（紙＋摺線）與機翼上的字：畫一次，每格帶著位置、傾斜貼上去。只當圖片來源，不上傳。 */
  planeImg = this.track(new Layer2D(PW, PH));
  textImg = this.track(new Layer2D(PW, PH));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 宣文射出去的時間（小節線）與飛到定點的時間。 */
  T = 0;
  arrive = 0;
  release: Pt = { x: 0, y: 0 };
  hgt = 200;
  trail: Pt[] = [];
  folds: number[] = [];
  alanKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  /** 孟庭之後射的小紙飛機。 */
  smalls: Throw[] = [];
  fetches: Fetch[] = [];
  note: Note | null = null;
  noteT0 = 0;
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(POSES));
    const bp0 = au.beatPeriod(s + 1);
    // 摺幾拍、在小節線射出去、飛三拍到定點：留言要在一兩小節內出現，所以摺紙最多三拍。
    // 窗格很短（不到三小節）就不等小節線：開場已經摺得差不多，一拍後射出去、飛兩拍。
    const short = (this.ctx.end - s) / bp0 < 12;
    this.T = short ? beatAfter(au, s + 0.35 + bp0) : barAfter(au, s + 0.35 + bp0 * 2.2);
    const bT = Math.round(au.beatAt(this.T));
    for (let k = 4; k >= 1; k--) { const tk = au.timeOfBeat(bT - k); if (tk > s + 0.1) this.folds.push(tk); }
    this.arrive = au.timeOfBeat(bT + (short ? 2 : 3));
    const bp = au.beatPeriod(this.T);
    this.alanKeys = [[-1e9, 'xw_plane_fold'], [this.T - bp, 'xw_plane_aim'], [this.T, 'xw_plane_throw'], [this.T + bp * 1.5, 'xw_plane_watch']];
    this.release = puppetPoint('xw_plane_throw', 'hand', AL_X, GROUND, { h: SZ }) ?? { x: AL_X + 150, y: GROUND - 470 };
    // 軌跡：從宣文的手往右上飛到大紙飛機的尾巴（頂點在兩者之間再高一點）
    const end = { x: GLIDE.x - 120, y: GLIDE.y + 150 };
    this.hgt = Math.max(60, Math.min(this.release.y, end.y) - 200);
    for (let i = 0; i <= 48; i++) this.trail.push(arcAt(this.release, end, this.hgt, i / 48));
    // 孟庭：宣文摺紙的時候站在旁邊看；射出去之後指著天空；之後每兩小節自己也射一架小的
    this.omKeys = [[-1e9, 'mt_idle_front'], [this.T + bp * 0.3, 'mt_plane_point']];
    const mFrom = puppetPoint('mt_plane_throw', 'hand', OM_X, GROUND, { h: SZ }) ?? { x: OM_X + 140, y: GROUND - 440 };
    // 小飛機滑到元元跳起來最高時的嘴邊（兩拍後、拍點上）
    const catchAt = puppetPoint('yy_jump', 'mouth', YY_X, GROUND - YJUMP, { h: SZ, scale: DOG_S, flip: true }) ?? { x: YY_X - 150, y: GROUND - 250 };
    for (let k = 1; k < 20; k++) {
      const t = au.timeOfBar(Math.round(au.barAt(this.T)) + 2 * k);
      if (t > this.ctx.end - 0.3) break;
      const b = au.beatPeriod(t), bt = Math.round(au.beatAt(t));
      this.omKeys.push([t - b, 'mt_plane_aim'], [t, 'mt_plane_throw'], [t + b * 1.5, 'mt_plane_point']);
      const land = au.timeOfBeat(bt + 2);
      this.smalls.push({ who: 'mt', t, land, from: mFrom, to: catchAt, hgt: 130, seed: k });
      const air = Math.min(0.5, b * 1.1);
      this.fetches.push({ back0: land + air / 2 + 0.12, back1: au.timeOfBeat(bt + 4), give: au.timeOfBeat(bt + 7), ret: au.timeOfBeat(bt + 8.6) });
    }
    // 機翼上的留言：標準 v2 的字級；紙飛機的圖與字各畫一次
    const c = this.textImg.ctx;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, TEXT.w, TEXT.h) : noteV2(c, INVITE, null, TEXT.w, TEXT.h * 0.55, { max: 44 });
    tightenNote(c, this.note, 200);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = this.arrive + 0.1;
    this.drawPlaneImages();
    this.drawBackground();
  }

  /** 大紙飛機：月光下的紙（不要比字亮）、中間的摺線、機頭的兩條斜摺線、機翼上翹的一點點陰影。字另外畫在 textImg。 */
  private drawPlaneImages() {
    const L = this.planeImg, c = L.ctx;
    L.clear();
    const ink = inkFor(false, { line: rgba('ink2', 0.9) });
    c.save();
    c.translate(PO.x, PO.y);
    // 月光下的紙：從機頭（左上的光）往機尾慢慢暗下去，整張比留言卡暗一點，才不會是畫面上最刺眼的一塊
    const paper = c.createLinearGradient(-200, -300, 200, 200);
    paper.addColorStop(0, mixRgba('bone', 'ash', 0.2));
    paper.addColorStop(1, mixRgba('bone', 'ash', 0.42));
    c.fillStyle = paper;
    c.beginPath(); PLANE.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); c.fill();
    inkPoly(c, PLANE, { ink, w: 0.8, seed: 3, color: mixRgba('bone', 'ink', 0.55) });
    // 右半邊翅膀稍微背光；翼尖往下折的小翼再暗一點
    c.fillStyle = rgba('ink', 0.08);
    c.beginPath(); c.moveTo(0, -310); c.lineTo(440, 40); c.lineTo(432, 118); c.lineTo(372, 192); c.lineTo(44, 178); c.lineTo(0, 152); c.closePath(); c.fill();
    c.fillStyle = rgba('ink', 0.14);
    for (const k of [-1, 1]) { c.beginPath(); c.moveTo(k * 440, 40); c.lineTo(k * 432, 118); c.lineTo(k * 372, 192); c.lineTo(k * 392, 90); c.closePath(); c.fill(); }
    // 摺線：中線（機身）、機頭往兩邊折的兩條、翼尖小翼的摺線
    c.strokeStyle = rgba('ink', 0.24);
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(0, -310); c.lineTo(0, 152);
    c.moveTo(0, -310); c.lineTo(-46, 178); c.moveTo(0, -310); c.lineTo(46, 178);
    c.moveTo(-440, 40); c.lineTo(-392, 90); c.lineTo(-372, 192); c.moveTo(440, 40); c.lineTo(392, 90); c.lineTo(372, 192);
    c.stroke();
    c.restore();
    // 字（這張只有字，貼的時候照寫到哪裡剪）
    const T = this.textImg, tc = T.ctx;
    T.clear();
    const n = this.note!;
    tc.save();
    tc.translate(PO.x, PO.y);
    drawNote(tc, n, -n.width / 2, TEXT.y + Math.max(0, (TEXT.h - n.height) * 0.4), { color: this.msg ? rgba('ink', 0.92) : rgba('ink', 0.62), sigColor: rgba('ink', 0.7), align: 'center' });
    tc.restore();
  }

  /** 遠處的城市（剪影、窗戶一格一格）、頂樓的女兒牆與地板。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const hz = 700;
    // 城市剪影：高高低低的大樓，比天空再暗一點
    c.fillStyle = mixRgba('ink', 'ink2', 0.35);
    c.beginPath();
    c.moveTo(0, hz + 40);
    let x = 0;
    for (let k = 0; x < W; k++) {
      const w = 50 + hash(k, 1) * 110, h = 50 + hash(k, 2) * (k % 5 === 2 ? 220 : 120);
      c.lineTo(x, hz - h); c.lineTo(x + w, hz - h);
      x += w;
    }
    c.lineTo(W, hz + 40); c.closePath(); c.fill();
    // 女兒牆（近）與地板
    c.fillStyle = rgba('ink2');
    c.fillRect(0, 760, W, 70);
    c.strokeStyle = rgba('bone', 0.12);
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, 760); c.lineTo(W, 760); c.stroke();
    c.fillStyle = mixRgba('ink', 'ink2', 0.6);
    c.fillRect(0, 830, W, H - 830);
    c.strokeStyle = rgba('bone', 0.04);
    c.beginPath();
    for (let i = -10; i <= 10; i++) { c.moveTo(W / 2 + i * 90, 830); c.lineTo(W / 2 + i * 260, H); }
    c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.sky.u.t!.value = t;
    this.sky.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    this.drawWindows(c, t);

    // ---- 人與狗（最先畫：打光只染紙偶）
    this.drawPeople(c, t, bp);
    this.drawYuanyuan(c, t, bp);
    puppetLight(c, [0, GROUND - SZ * 1.3, 1400, SZ * 1.3 + 40], rgba('ink', 0.12), rgba('ink', 0.6));

    // ---- 摺紙（宣文手上）
    this.drawFold(c, t, bp);

    // ---- 軌跡（虛線）＋歌詞
    const rv = prog(t, s + 0.1, s + 0.7);
    const ly = lyricAt(lyrics, t);
    // 雙語（2026-09-30）：中文＋原文沿著弧線會各折兩排、擠成一團，軌跡的虛線還穿過原文。有原文的句子改成平平地寫在天空上
    // （大紙飛機左邊那一塊）：中文一排、原文接在下面；虛線經過字的那一段不畫（字底下留 14 px）
    const st: LyricStyle = { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, maxWidth: SKY_LYR.w, align: 'left', unsung: rgba('bone', 0.26), sung: rgba('bone', 0.88), active: rgba('signal') };
    const sky = ly && lyricSubOf(ly.line) ? skySub(c, ly.line, st, layoutLyric(c, ly.line, st)) : null;
    const skyBottom = sky ? SKY_LYR.top + 0.9 * sky.size + sky.height - sky.size + 0.3 * (sky.sub?.lay.size ?? 0) + 14 : 0;
    this.drawTrail(c, t, rv, skyBottom);
    if (ly && sky) {
      const lay = sky;
      c.save(); c.translate(SKY_LYR.x, SKY_LYR.top + 0.9 * lay.size);
      drawLyric(c, ly.line, t, st, lay, ly.k * rv);
      c.restore();
    } else if (ly) lyricOnPath(c, ly.line, t, this.trail.slice(6, 38), { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, offset: 26, alpha: ly.k * rv, unsung: rgba('bone', 0.26), sung: rgba('bone', 0.88) });

    // ---- 小紙飛機（孟庭的）
    for (const sm of this.smalls) this.drawSmall(c, t, sm);
    // ---- 大紙飛機：飛上去 → 攤平 → 滑翔（機翼上的字）
    this.drawPlane(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：射出去之後慢慢往上、往紙飛機那邊搖一點（最多 1.035 倍）
    const k = ease.inOutCubic(prog(t, this.T, this.arrive + bp * 2));
    return { bloom: 0.6, vignette: 0.5, zoom: 1 + 0.035 * k, shake: [-(GLIDE.x - W / 2) * 0.035 * k, -(GLIDE.y - H / 2) * 0.035 * k] };
  }

  /** 遠處大樓的窗戶：一格一格的小亮點，每拍有幾格換亮暗。 */
  private drawWindows(c: CanvasRenderingContext2D, t: number) {
    const b = Math.floor(this.ctx.audio.beatAt(t));
    c.save();
    for (let i = 0; i < 90; i++) {
      const x = 20 + hash(i, 11) * (W - 40), y = 560 + hash(i, 12) * 130;
      const on = hash(i, b % 7, 13) > 0.3;
      if (!on) continue;
      c.fillStyle = hash(i, 14) > 0.8 ? rgba('signal', 0.35) : rgba('bone', 0.14);
      c.fillRect(x, y, 5, 7);
    }
    c.restore();
  }

  /** 宣文、孟庭、芃芃、QQ：影子、姿勢時間軸、每拍輕輕點頭；QQ 在小紙飛機出手後的下一拍跳起來。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const nod = beatKick(au, t, 0.26);
    const shadow = (who: string, x: number, lift = 0, a = 1) => puppetShadow(c, who, x, GROUND, { h: SZ * (who === 'pp' || who === 'qq' ? DOG_S : 1), lift, alpha: 0.6 * a, color: '0,0,0' });
    const enP = enterPuppet(this.glow, t, this.ctx.start + 0.3, PP_X, GROUND - 6, 3);
    if (enP) { shadow('pp', PP_X, 0, enP.alpha); drawPuppet(c, 'pp_beg', PP_X, GROUND, { h: SZ, scale: DOG_S, squash: 0.03 * nod, spin: enP.spin, alpha: enP.alpha }); }
    const enA = enterPuppet(this.glow, t, this.ctx.start + 0.05, AL_X, GROUND - 6, 1);
    if (enA) {
      // 瞄準時往後帶、出手那一下往前送
      const rot = -0.05 * prog(t, this.T - bp, this.T, ease.inOutCubic) * (t < this.T ? 1 : 0) + (t >= this.T ? 0.06 * Math.exp(-(t - this.T) / (bp * 0.5)) : 0);
      shadow('xw', AL_X, 0, enA.alpha);
      drawPick(c, this.alanKeys, t, AL_X, GROUND, { h: SZ, rot, pivot: 0.3, squash: 0.012 * nod + breathe(t, 0.008, 3.3), spin: enA.spin, alpha: enA.alpha });
    }
    const enO = enterPuppet(this.glow, t, this.ctx.start + 0.15, OM_X, GROUND - 6, 2);
    if (enO) {
      shadow('mt', OM_X, 0, enO.alpha);
      drawPick(c, this.omKeys, t, OM_X, GROUND, { h: SZ, pivot: 0.3, squash: 0.012 * nod + breathe(t, 0.008, 3.0, 0.4), spin: enO.spin, alpha: enO.alpha });
    }
    // QQ：平常站著看天空；有紙飛機飛出去的下一拍跳起來（最高點在拍點）
    const enQ = enterPuppet(this.glow, t, this.ctx.start + 0.36, QQ_X, GROUND - 6, 4);
    if (!enQ) return;
    const jumps = [this.T, ...this.smalls.map((m) => m.t)];
    for (const j0 of jumps) {
      const top = j0 + bp;
      const j = jumpArc(t, top - bp * 0.45, top + bp * 0.45, 70, { crouch: 0.1, land: 0.18 });
      if (t > top - bp * 0.6 && t < top + bp * 0.9) {
        shadow('qq', QQ_X, -j.y, enQ.alpha);
        drawPuppet(c, j.air ? 'qq_jump' : 'qq_stand', QQ_X, GROUND + j.y, { h: SZ, scale: DOG_S, hide: ['ball'], rot: j.air ? -0.25 + 0.3 * j.u : 0, pivot: 0.5, squash: j.squash, spin: enQ.spin, alpha: enQ.alpha });
        return;
      }
    }
    shadow('qq', QQ_X, 0, enQ.alpha);
    drawPuppet(c, 'qq_stand', QQ_X, GROUND, { h: SZ, scale: DOG_S, squash: 0.04 * nod, spin: enQ.spin, alpha: enQ.alpha });
  }

  /**
   * 元元：在右邊等（面向孟庭）→ 小飛機滑過來時在拍點跳起來咬住 → 叼著跑回孟庭面前 → 站著等她拿（孟庭瞄準的那一拍）→ 跑回去等下一架。
   * 大紙飛機飛上天的時候仰頭看著叫。
   */
  private drawYuanyuan(c: CanvasRenderingContext2D, t: number, bp: number) {
    const en = enterPuppet(this.glow, t, this.ctx.start + 0.42, YY_X, GROUND - 6, 5);
    if (!en) return;
    const au = this.ctx.audio;
    const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    const shadow = (x: number, lift = 0) => puppetShadow(c, 'yy', x, GROUND, { h: SZ * DOG_S, lift, alpha: 0.6 * en.alpha, color: '0,0,0' });
    const hold = (name: string, x: number, y: number, o: PuppetOpts) => {
      const m = puppetPoint(name, 'mouth', x, y, o);
      if (m) this.heldPlane(c, m.x, m.y + 4, !!o.flip, t);
    };
    const air = Math.min(0.5, bp * 1.1);
    for (let i = 0; i < this.smalls.length; i++) {
      const sm = this.smalls[i]!, fe = this.fetches[i]!;
      if (t < sm.land - air / 2 - 0.12 || t >= fe.ret) continue;
      // 跳起來接（最高點在拍點上）
      if (t < fe.back0) {
        const j = jumpArc(t, sm.land - air / 2, sm.land + air / 2, YJUMP, { crouch: 0.1, land: 0.18 });
        shadow(YY_X, -j.y);
        const o: PuppetOpts = { ...base, flip: true, hide: ['ball'], rot: j.air ? 0.12 - 0.24 * j.u : 0, pivot: 0.5, squash: j.squash };
        const name = j.air ? 'yy_jump' : 'yy_stand';
        drawPuppet(c, name, YY_X, GROUND + (j.air ? j.y : 0), o);
        if (t >= sm.land) hold(name, YY_X, GROUND + (j.air ? j.y : 0), o);
        return;
      }
      // 叼著跑回孟庭面前
      if (t < fe.back1) {
        const u = clamp((t - fe.back0) / (fe.back1 - fe.back0));
        const x = lerp(YY_X, GIVE_X, 0.5 - 0.5 * Math.cos(Math.PI * u));
        const b = hop(au.beatAt(t), 2) * 8;
        shadow(x, b);
        const o: PuppetOpts = { ...base, flip: true, rot: -0.03 };
        const name = drawCycle(c, au, t, ['yy_run_1', 'yy_run_2'], 2, x, GROUND - b, o);
        hold(name, x, GROUND - b, o);
        return;
      }
      // 站著等孟庭拿（每拍搖一下）；孟庭瞄準那一拍拿走
      if (t < fe.give) {
        shadow(GIVE_X);
        const o: PuppetOpts = { ...base, flip: true, squash: 0.03 * beatKick(au, t, 0.25) + landSquash(t, fe.back1, 0.12), pivot: 0.2 };
        drawPuppet(c, 'yy_stand', GIVE_X, GROUND, o);
        hold('yy_stand', GIVE_X, GROUND, o);
        return;
      }
      // 跑回去等下一架
      const u = clamp((t - fe.give - 0.1) / (fe.ret - fe.give - 0.1));
      const x = lerp(GIVE_X, YY_X, 0.5 - 0.5 * Math.cos(Math.PI * u));
      const b = hop(au.beatAt(t), 2) * 8;
      shadow(x, b);
      drawCycle(c, au, t, ['yy_run_1', 'yy_run_2'], 2, x, GROUND - b, { ...base, rot: 0.03 });
      return;
    }
    // 等：大紙飛機在天上飛的時候仰頭叫，其他時候面向孟庭站著、跟著拍子點頭
    shadow(YY_X);
    if (t >= this.T && t < this.arrive + bp) drawPuppet(c, 'yy_howl', YY_X, GROUND, { ...base, rot: -0.03, pivot: 0.3 });
    else drawPuppet(c, 'yy_stand', YY_X, GROUND, { ...base, flip: true, squash: 0.02 * beatKick(au, t, 0.28) + breathe(t, 0.01, 2.8), pivot: 0.2 });
  }

  /** 叼在嘴上的小紙飛機（側面，機頭朝前）。 */
  private heldPlane(c: CanvasRenderingContext2D, x: number, y: number, left: boolean, t: number) {
    const ink = inkFor(false, { line: rgba('ink2', 0.8) });
    c.save();
    c.translate(x, y);
    c.scale(left ? -1.1 : 1.1, 1.1);
    c.rotate(-0.12);
    inkPoly(c, [{ x: 30, y: 0 }, { x: -22, y: -14 }, { x: -16, y: 1 }, { x: -24, y: 9 }], { ink, fill: mixRgba('bone', 'ash', 0.1), w: 0.6, lw: 2.2, t, seed: 91 });
    c.restore();
  }

  /** 摺紙：宣文胸前的一張紙，每拍摺一步（彈一下），射出去前變成一架小紙飛機（之後換成圖上手裡的那架）。 */
  private drawFold(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    if (t >= this.T - bp) return;
    const hand = puppetPoint('xw_plane_fold', 'hands', AL_X, GROUND, { h: SZ }) ?? { x: AL_X + 60, y: GROUND - 330 };
    let step = 0, since = 1;
    this.folds.forEach((tk, i) => { if (t >= tk) { step = i + 1; since = t - tk; } });
    step += 4 - this.folds.length;
    const pop = 0.62 * (1 + 0.18 * Math.exp(-since / 0.08));
    const ink = inkFor(false, { line: rgba('ink2', 0.8) });
    const paper = mixRgba('bone', 'ash', 0.1);
    c.save();
    c.translate(hand.x, hand.y);
    c.scale(pop, pop);
    c.rotate(-0.1 + 0.05 * Math.sin(au.beatAt(t) * Math.PI));
    // 每一步的外形（紙飛機的座標，機頭朝右）
    const shapes: Pt[][] = [
      [{ x: -34, y: -44 }, { x: 34, y: -44 }, { x: 34, y: 44 }, { x: -34, y: 44 }],
      [{ x: 0, y: -44 }, { x: 34, y: -10 }, { x: 34, y: 44 }, { x: -34, y: 44 }, { x: -34, y: -10 }],
      [{ x: 0, y: -44 }, { x: 20, y: 10 }, { x: 20, y: 44 }, { x: -20, y: 44 }, { x: -20, y: 10 }],
      [{ x: 44, y: 0 }, { x: -30, y: -12 }, { x: -34, y: 10 }],
      [{ x: 50, y: 0 }, { x: -34, y: -22 }, { x: -24, y: 2 }, { x: -36, y: 14 }],
    ];
    inkPoly(c, shapes[clamp(step, 0, 4)]!, { ink, fill: paper, w: 0.6, lw: 2.4, t, seed: step });
    c.restore();
  }

  /** 飛過的弧線：一開始就有一條很淡的虛線（歌詞排在上面），紙飛機飛過的那一段變成訊號色、慢慢淡回去。 */
  private drawTrail(c: CanvasRenderingContext2D, t: number, rv: number, skipAbove = 0) {
    const u = clamp((t - this.T) / (this.arrive - this.T));
    c.save();
    c.setLineDash([6, 14]);
    c.lineWidth = 2;
    c.strokeStyle = rgba('bone', 0.12 * rv);
    // skipAbove：天空上有雙語歌詞時，這條線以上（字那一帶）的虛線不畫
    if (skipAbove) { c.beginPath(); c.rect(0, skipAbove, W, H); c.clip(); }
    c.beginPath(); this.trail.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.stroke();
    c.restore();
    if (t < this.T) return;
    // 飛到了就收掉（軌跡的尾巴在大紙飛機底下，發光的線會疊在機翼的字上）
    const fade = 1 - prog(t, this.arrive - 0.25, this.arrive + 0.2);
    if (fade <= 0) return;
    const n = Math.floor(u * (this.trail.length - 1));
    const sg = LIN.signal;
    for (let i = 1; i <= n; i++) {
      const a = this.trail[i - 1]!, b = this.trail[i]!;
      if (i % 2) continue;
      this.glow.seg2(a.x, a.y, b.x, b.y, 2, [sg[0] * 1.6, sg[1] * 1.6, sg[2] * 1.6], 0.5 * fade * (0.3 + 0.7 * (i / n)));
    }
  }

  /** 孟庭射出去的小紙飛機：側面的小飛機沿弧線飛出畫面右邊，機頭跟著方向。 */
  private drawSmall(c: CanvasRenderingContext2D, t: number, sm: Throw) {
    if (t < sm.t || t > sm.land) return;
    const u = (t - sm.t) / (sm.land - sm.t);
    const q = arcAt(sm.from, sm.to, sm.hgt, u);
    const ink = inkFor(false, { line: rgba('ink2', 0.8) });
    c.save();
    c.translate(q.x, q.y);
    c.rotate(q.ang + 0.1 * Math.sin(t * 5 + sm.seed));
    inkPoly(c, [{ x: 30, y: 0 }, { x: -22, y: -14 }, { x: -16, y: 1 }, { x: -24, y: 9 }], { ink, fill: mixRgba('bone', 'ash', 0.1), w: 0.6, lw: 2.2, t, seed: sm.seed });
    c.restore();
  }

  /** 大紙飛機：出手後沿著軌跡飛上去、越飛越大、機頭轉向上；到了定點攤平（outBack），字一行一行寫上去；之後滑翔（每拍輕輕一沉）。 */
  private drawPlane(c: CanvasRenderingContext2D, t: number) {
    if (t < this.T) return;
    const au = this.ctx.audio;
    const u = clamp((t - this.T) / (this.arrive - this.T));
    let x: number, y: number, sc: number, rot: number;
    if (u < 1) {
      const q = arcAt(this.trail[0]!, this.trail[this.trail.length - 1]!, this.hgt, ease.inOutCubic(u));
      const g = ease.inCubic(u);
      x = lerp(q.x, GLIDE.x, g * 0.6); y = lerp(q.y, GLIDE.y, g * 0.6);
      sc = lerp(0.07, 0.8, ease.inCubic(u));
      rot = lerp(q.ang + Math.PI / 2, 0, ease.inOutCubic(u));
      // 出手的那一下：手邊一點火花
      if (t - this.T < 0.25) { sparkHead(this.glow, this.release.x, this.release.y, t, 0.6); sparkParticles(this.glow, t, () => this.release, { rate: 40, life: 0.2, speed: 120, seed: 7 }); }
    } else {
      const d = t - this.arrive;
      const settle = 0.8 + 0.2 * ease.outBack(clamp(d / 0.45));
      const dip = 10 * beatKick(au, t, 0.35);
      x = GLIDE.x + 16 * Math.sin(t * 0.7); y = GLIDE.y + 12 * Math.sin(t * 1.1) + dip;
      sc = GLIDE.s * settle;
      rot = 0.03 * Math.sin(t * 0.55) + 0.012 * Math.sin(au.beatAt(t) * Math.PI);
    }
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.scale(sc, sc);
    // 影子（飛機底下淡淡一塊，讓它浮起來）
    c.save();
    c.translate(16, 24);
    c.fillStyle = rgba('ink', 0.35);
    c.beginPath(); PLANE.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.fill();
    c.restore();
    c.drawImage(this.planeImg.canvas, -PO.x, -PO.y, PW, PH);
    // 字：到了之後一行一行寫上去（每行由左往右掃開）；寫完署名一起出現
    if (t > this.noteT0 && this.note) {
      const n = this.note, fit = n.fit;
      const total = msgChars(fit);
      const per = clamp(1.2 / Math.max(1, total), 0.03, 0.08);
      let left = this.msg ? (t - this.noteT0) / per : Infinity;
      const top = TEXT.y + Math.max(0, (TEXT.h - n.height) * 0.4);
      c.save();
      c.beginPath();
      fit.lines.forEach((ln, i) => {
        const len = Array.from(ln).length;
        const k = clamp(left / len);
        left -= len;
        if (k <= 0) return;
        c.rect(-TEXT.w / 2 - 20, top + i * fit.lineHeight - 4, (TEXT.w + 40) * k, fit.lineHeight + 4);
      });
      if (left > 0) c.rect(-TEXT.w / 2 - 20, top + fit.lines.length * fit.lineHeight - 4, TEXT.w + 40, n.sigRow + 20);
      c.clip();
      c.drawImage(this.textImg.canvas, -PO.x, -PO.y, PW, PH);
      c.restore();
    }
    c.restore();
  }
}

/** 原文副行換成至少 34 px、不再縮（太長就折行）；中文不動。 */
function skySub(c: CanvasRenderingContext2D, line: Line, st: LyricStyle, lay: LyricLayout): LyricLayout {
  const sub = lyricSubOf(line);
  if (!sub || !lay.sub) return lay;
  const size = Math.max(34, subSizeFor(lay.size));
  const sl = layoutLyric(c, sub, { ...subStyleFor(st, lay.size), size, minSize: size });
  const dy = lay.sub.dy - subGap(lay.size, lay.sub.lay.size) + subGap(lay.size, sl.size);
  return { ...lay, sub: { lay: sl, dy }, height: dy + (sl.height - sl.size) + lay.size };
}
