// 網球（亮、sport）：午後的硬地球場，鏡頭在場邊斜斜往下看（看得到透視的場地線），宣文與孟庭隔網對打，三隻狗都在場邊。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 一分兩小節（快歌四小節）：小節線上宣文發球（拋球 → 最高點落下 → 拍點上擊球），之後一拍一球（快歌兩拍一球）來回，
//    每一球都在對方那半場彈地一次（彈地也落在半拍附近，地上留一圈訊號色的小波紋）。第六球孟庭打出界，從宣文身邊飛過去。
//  - 三隻狗（2026-09-30 新人加了元元：有狗的版面三隻都要在）：芃芃、QQ 是坐在網柱邊球籃旁的球僮，元元（白色柴犬，最大隻、穩重愛笑）
//    是坐在左邊底線外的「線審」，正面坐著笑，每個小節線歪一次頭。出界球三隻輪流處理：
//    芃芃、QQ 那一輪，球在拍點落地、滾到宣文腳邊，球僮下一拍衝過去叼起來（咬到在拍點），跑回網柱邊、把球丟進球籃坐好；
//    元元那一輪，牠先站起來，出界球還沒落地就在拍點上跳起來空中接住（兩隻博美跳不到那麼高），落地、下一拍把球一甩丟進球籃，再坐回去。
//    有狗接到球的那一刻，坐著的另外兩隻跟著彈一下。
//  - 擊球一定落在拍點：引拍（back）→ 拍點上換成擊球瞬間（hit，球就在拍面上）→ 收拍（follow）→ 回到準備（ready）。
//    發球：拋球時換成 serve（球拍在腦後），球落到頭頂的那一刻（拍點）擊出、換成收拍。
//  - 球是 ball 色（固定的黃綠色），飛的時候後面拖一小段訊號色的線；地上有它的影子（離地越高越小越淡），斜俯視才看得出球有多高。
//  - 歌詞印在後面鐵網的擋風布上（像球場邊印的字），照跟唱規則逐字亮；比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在右上掛在鐵網上的計分牌（深色木板、淺色手寫字，這個亮版面裡最深、最清楚的一塊）；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、牌子最大 650 × 420，高度跟著留言長短。牌子上只有一行小小的比分：
//    每丟一分就翻一次「15 · LOVE」「30 · LOVE」「40 · LOVE」「GAME」（網球的 0 分叫 love）。沒有留言時牌子寫邀請。
//  - 光線：左上角的太陽，影子往右下拖；樹梢在拍點上被風推一下、雲慢慢飄。鏡頭整個窗格慢慢推近計分牌。
//  - 右下角 HUD：場地在那裡淡掉，球、狗都不會跑進去。三隻狗都坐在畫面下緣的場外區，不擋留言、歌詞。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, inkLine, inkPath, inkPoly, inkEllipse, tennisBall, drawNote, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPuppet, drawPick, drawCycle, puppetPoint, puppetShadow, puppetIn, breathe, beatKick, hop, landSquash, jumpArc, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'sport', paper: true, energy: [0.35, 1], bars: [4, 8] };

// ---- 場地（斜俯視）：v = 深度（0 = 遠的邊線、1 = 近的邊線），u = 沿著球場長邊（0 = 左底線、1 = 右底線）
const Y0 = 575, Y1 = 1010;
const GROUND = 860;
const VP = (GROUND - Y0) / (Y1 - Y0);
const L0 = 1000, L1 = 1320, CX = 770, SKEW = 240;
const lenAt = (v: number) => L0 + (L1 - L0) * v;
const courtY = (v: number) => Y0 + (Y1 - Y0) * v;
const courtX = (u: number, v: number) => CX + SKEW * (v - VP) + (u - 0.5) * lenAt(v);
/** 透視的縮放：跟站在 GROUND 那條深度上的人比。 */
const depthK = (v: number) => lenAt(v) / lenAt(VP);

const SZ = 330;
const XW = 300, MT = 1235;
/** 三隻狗坐的地方（場外區，腳底都在 DOG_Y）、球籃、出界球（博美那兩輪）彈地與最後停的地方（宣文腳邊、元元的右邊）。 */
const DOG_Y = 992, BASKET = { x: 548, y: 1000 };
type Dog = 'pp' | 'qq' | 'yy';
const HOME: Record<Dog, number> = { pp: 640, qq: 745, yy: 120 };
/** 出界球輪流：芃芃、元元、QQ。 */
const FETCH: Dog[] = ['pp', 'yy', 'qq'];
const OUT_B1 = { x: 262, g: 948 }, OUT_B2 = { x: 238, g: 978 }, OUT_REST = { x: 226, g: 996 };
/** 狗在這個版面放大一點（1.25 倍，三隻用同一個倍數，大小比例不變）。元元在空中接球：跳多高、最高點在哪裡。 */
const DOG_S = 1.25, YJUMP = 58, YCATCH_X = 172;
/** 計分牌：掛在鐵網右邊（最大 650 × 420，標準 v2；實際高度跟著留言），寫字的內距。 */
const BOARD = { x: 1150, y: 96, w: 650, h: 420 };
const PAD = { x: 40, top: 70, bottom: 32 };
/** 鐵網與擋風布（歌詞印在上面）。 */
const FENCE_TOP = 176, WIND = { y0: 306, y1: 426 };
const LYRIC = { x: 132, y: 384, w: 960 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SCORES = ['LOVE · ALL', '15 · LOVE', '30 · LOVE', '40 · LOVE', 'GAME'];
const BALL_R = 8;

const WHO = [
  { p: 'xw', x: XW, flip: false, dir: 1 },
  { p: 'mt', x: MT, flip: true, dir: -1 },
] as const;
const POSES = [
  ...WHO.flatMap(({ p }) => [`${p}_tennis_ready`, `${p}_tennis_back`, `${p}_tennis_hit`, `${p}_tennis_follow`]),
  'xw_tennis_serve', 'pp_sit', 'pp_run_1', 'pp_run_2', 'pp_ball', 'qq_sit', 'qq_run_1', 'qq_run_2', 'qq_ball',
  'yy_sit', 'yy_tilt', 'yy_stand', 'yy_jump', 'yy_ball', 'yy_walk',
];

type Kind = 'serve' | 'hit' | 'out';
interface Hit { t: number; who: 0 | 1; kind: Kind; point: number }
/** 球在 3D 裡的一段路：x（畫面橫向）、g（地面在畫面上的 y，= 深度）、h（離地高度 px）；高度照拋物線，peak = 比直線多出來的高度。 */
interface Leg { t0: number; t1: number; a: B3; b: B3; peak: number; bounce?: boolean }
interface B3 { x: number; g: number; h: number }
/**
 * 一分結束（出界球）：bounce 落地（元元那一輪是空中接住）、rest 滾停、pick 咬到（元元：甩球）、home 回到位子、drop 球進籃、dog 輪到誰。
 */
interface Rally { serve: number; bounce: number; rest: number; pick: number; home: number; drop: number; point: number; dog: Dog }

/**
 * 球場的底（一次畫在 shader 裡，浮點＋抖色，淡漸層才不會一圈一圈）：紙、左上角的太陽光、場地的底色（比紙深一點點），
 * 場地往右下角（HUD）淡掉。
 */
const COURT = () => new FSPass(/* glsl */ `
  float cx(float u, float v) { return ${CX}.0 + ${SKEW}.0 * (v - ${VP.toFixed(4)}) + (u - 0.5) * (${L0}.0 + ${L1 - L0}.0 * v); }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float n = fbm(p / 300.0, 4);
    float fib = snoise(vec2(p.x / 2.5, p.y / 70.0)) * 0.5 + 0.5;
    vec3 col = C_PAPER * (0.965 + 0.035 * n + 0.012 * fib);
    // 太陽（左上）：暖一點、亮一點
    vec2 q = (p - vec2(180.0, 60.0)) / vec2(1100.0, 760.0);
    float sun = exp(-dot(q, q) * 1.5);
    col = mix(col, C_SIGNAL, 0.045 * sun) * (1.0 + 0.03 * sun);
    // 場地（含場外一圈緩衝區）：v 是深度、u 是長邊
    float v = (p.y - ${Y0}.0) / ${Y1 - Y0}.0;
    float len = ${L0}.0 + ${L1 - L0}.0 * v;
    float u = (p.x - (${CX}.0 + ${SKEW}.0 * (v - ${VP.toFixed(4)}))) / len + 0.5;
    float apron = smoothstep(-0.12, -0.1, v) * smoothstep(-0.14, -0.1, u) * smoothstep(1.14, 1.1, u);
    float inside = step(0.0, v) * step(v, 1.0) * step(0.0, u) * step(u, 1.0);
    vec2 hq = (p - vec2(1760.0, 1040.0)) / vec2(560.0, 330.0);
    float hud = smoothstep(0.55, 1.0, length(hq));
    col = mix(col, col * (0.93 + 0.02 * n), apron * hud);
    col = mix(col, col * 0.9 + C_SEPIA * 0.015, inside * hud);
    vec2 d = vUv - 0.5;
    col *= 1.0 - 0.14 * dot(d, d);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

export default class Tennis extends Scene {
  court = shared('tennis.court', COURT);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  hits: Hit[] = [];
  legs: Leg[] = [];
  rallies: Rally[] = [];
  keys: [number, string][][] = [[], []];
  /** 擊球點（擊球瞬間那張圖上的拍面）與發球點（頭頂前上方）。 */
  contact: [Pt, Pt] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  servePt: Pt = { x: 0, y: 0 };
  /** 元元跳到最高點時嘴前那顆球的位置（出界球在這裡被接住）。 */
  yyCatch: Pt = { x: 0, y: 0 };
  note: Note | null = null;
  board = { ...BOARD };
  lyricSize = 52;
  step = 1;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + SCORES.join('') + 'SET 1 · GAME 3');
    this.track(await loadPuppets(POSES));
    WHO.forEach((w, i) => {
      const o: PuppetOpts = { h: SZ, flip: w.flip };
      this.contact[i] = puppetPoint(`${w.p}_tennis_hit`, 'racket', w.x, GROUND, o) ?? { x: w.x + w.dir * SZ * 0.36, y: GROUND - SZ * 0.5 };
    });
    this.servePt = { x: XW + SZ * 0.16, y: GROUND - SZ * 1.2 };
    this.yyCatch = puppetPoint('yy_jump', 'ball', YCATCH_X, DOG_Y - YJUMP, { h: SZ, scale: DOG_S }) ?? { x: YCATCH_X + 100, y: DOG_Y - 260 };
    this.schedule();
    // 計分牌上的留言：標準 v2 的字級；牌子的寬高跟著留言，靠右掛
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, hmax = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    this.board.h = Math.min(BOARD.h, Math.max(240, PAD.top + this.note.height + PAD.bottom + 16));
    this.board.w = Math.min(BOARD.w, tightenNote(c, this.note, 330) + PAD.x * 2);
    this.board.x = BOARD.x + BOARD.w - this.board.w;
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /**
   * 排一整個窗格的球：每一分 = 發球＋五拍來回（第五球出界）＋落地、咬球、送回來，共八步（一步 = 一拍，快歌兩拍）。
   * 第一球在進場後的第一個小節線發（窗格太短就下一拍）。
   */
  private schedule() {
    const au = this.ctx.audio;
    this.step = au.beatPeriod(this.ctx.start) < 0.38 ? 2 : 1;
    let t0 = barAfter(au, this.ctx.start + 0.9);
    if (this.ctx.end - t0 < au.beatPeriod(t0) * 3) t0 = beatAfter(au, this.ctx.start + 0.9);
    let point = 0;
    for (let k = 0; k < 12 && t0 < this.ctx.end + 0.5; k++) {
      const b0 = Math.round(au.beatAt(t0));
      const at = (s: number) => au.timeOfBeat(b0 + s * this.step);
      this.hits.push({ t: at(0), who: 0, kind: 'serve', point });
      for (let s = 1; s <= 5; s++) this.hits.push({ t: at(s), who: (s % 2) as 0 | 1, kind: s === 5 ? 'out' : 'hit', point });
      const sp = at(1) - at(0);
      this.rallies.push({ serve: at(0), bounce: at(6), rest: at(6) + sp * 0.8, pick: at(7), home: at(7) + sp * 1.45, drop: at(7) + sp * 1.7, point: point + 1, dog: FETCH[point % 3]! });
      point++;
      t0 = at(8);
    }
    // 球的路：拋球 → 發球 → 每一球在對方半場彈一次 → 出界球落地、再彈一下、滾到角落
    for (let i = 0; i < this.hits.length; i++) {
      const h = this.hits[i]!, n = this.hits[i + 1];
      const from = h.kind === 'serve' ? this.servePt : this.contact[h.who];
      const A: B3 = { x: from.x, g: GROUND, h: GROUND - from.y };
      const sp = au.timeOfBeat(Math.round(au.beatAt(h.t)) + this.step) - h.t;
      if (h.kind === 'serve') {
        // 拋球：出手（拍點前 0.8 步）→ 最高點 → 落到擊球點（拍點）
        const hand: B3 = { x: XW + SZ * 0.1, g: GROUND, h: SZ * 0.62 };
        this.legs.push({ t0: h.t - sp * 0.8, t1: h.t, a: hand, b: A, peak: SZ * 0.42 });
      }
      if (h.kind === 'out') {
        const rally = this.rallies[h.point]!;
        if (rally.dog === 'yy') {
          // 元元那一輪：球飛到元元跳到最高點時嘴前的那顆球（yy_jump 圖上的球）就停了——空中接住
          const cp = this.yyCatch;
          this.legs.push({ t0: h.t, t1: rally.bounce, a: A, b: { x: cp.x, g: DOG_Y, h: DOG_Y - cp.y }, peak: SZ * 0.3 });
          continue;
        }
        const b1: B3 = { x: OUT_B1.x, g: OUT_B1.g, h: 0 }, b2: B3 = { x: OUT_B2.x, g: OUT_B2.g, h: 0 }, R: B3 = { x: OUT_REST.x, g: OUT_REST.g, h: 0 };
        this.legs.push({ t0: h.t, t1: rally.bounce, a: A, b: b1, peak: SZ * 0.34 });
        this.legs.push({ t0: rally.bounce, t1: rally.bounce + sp * 0.42, a: b1, b: b2, peak: SZ * 0.09, bounce: true });
        this.legs.push({ t0: rally.bounce + sp * 0.42, t1: rally.rest, a: b2, b: R, peak: 0, bounce: true });
        continue;
      }
      if (!n || n.point !== h.point) continue;
      const to = this.contact[n.who];
      const B: B3 = { x: to.x, g: GROUND, h: GROUND - to.y };
      // 彈地點：對方那半場、離網子三分之二的地方；時間在六成（球出去快、彈起來慢一點）
      const bx = lerp(from.x, to.x, 0.72);
      const tb = lerp(h.t, n.t, 0.62);
      this.legs.push({ t0: h.t, t1: tb, a: A, b: { x: bx, g: GROUND, h: 0 }, peak: SZ * (h.kind === 'serve' ? 0.2 : 0.5) });
      this.legs.push({ t0: tb, t1: n.t, a: { x: bx, g: GROUND, h: 0 }, b: B, peak: SZ * 0.16, bounce: true });
    }
    // 姿勢時間軸
    WHO.forEach((w, i) => {
      const ks: [number, string][] = [[-1e9, `${w.p}_tennis_ready`]];
      for (const h of this.hits) {
        if (h.who !== i) continue;
        const sp = au.timeOfBeat(Math.round(au.beatAt(h.t)) + this.step) - h.t;
        if (h.kind === 'serve') ks.push([h.t - sp * 0.85, 'xw_tennis_serve'], [h.t + 0.02, `${w.p}_tennis_follow`], [h.t + sp * 0.7, `${w.p}_tennis_ready`]);
        else ks.push([h.t - Math.min(0.5, sp * 0.55), `${w.p}_tennis_back`], [h.t, `${w.p}_tennis_hit`], [h.t + 0.08, `${w.p}_tennis_follow`], [h.t + sp * 0.62, `${w.p}_tennis_ready`]);
      }
      ks.sort((a, b) => a[0] - b[0]);
      this.keys[i] = ks;
    });
  }

  /** 不會動的（畫一次）：鐵網、擋風布、場地線、網子、計分牌。樹和雲每格畫（會動）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 鐵網：幾根柱子＋很淡的菱形網（上面一段）
    c.save();
    c.strokeStyle = rgba('sepia', 0.07);
    c.lineWidth = 1;
    c.beginPath();
    for (let x = -300; x < W + 300; x += 26) {
      c.moveTo(x, FENCE_TOP); c.lineTo(x + (WIND.y0 - FENCE_TOP), WIND.y0);
      c.moveTo(x, FENCE_TOP); c.lineTo(x - (WIND.y0 - FENCE_TOP), WIND.y0);
    }
    c.stroke();
    c.restore();
    inkLine(c, [{ x: 40, y: FENCE_TOP }, { x: 1880, y: FENCE_TOP }], { ink, w: 0.5, seed: 3, color: rgba('sepia', 0.5) });
    for (let x = 90; x < 1880; x += 300) inkLine(c, [{ x, y: FENCE_TOP - 8 }, { x, y: Y0 - 18 }], { ink, w: 0.6, seed: x, color: rgba('sepia', 0.55) });
    // 擋風布：一條比紙深一點的布，上下緣縫線
    c.fillStyle = rgba('sepia', 0.075);
    c.fillRect(40, WIND.y0, 1840, WIND.y1 - WIND.y0);
    c.strokeStyle = rgba('sepia', 0.18);
    c.setLineDash([6, 5]);
    c.beginPath(); c.moveTo(40, WIND.y0 + 7); c.lineTo(1880, WIND.y0 + 7); c.moveTo(40, WIND.y1 - 7); c.lineTo(1880, WIND.y1 - 7); c.stroke();
    c.setLineDash([]);
    inkLine(c, [{ x: 40, y: WIND.y1 }, { x: 1880, y: WIND.y1 }], { ink, w: 0.5, seed: 4, color: rgba('sepia', 0.4) });
    // 場地線（白線、透視）：雙打邊線、單打邊線、底線、發球線、中線。場地比紙深一點，白線才看得出來
    const line = (pts: Pt[], w = 3) => {
      c.save();
      c.strokeStyle = rgba('bone', 0.95); c.lineWidth = w; c.lineCap = 'round';
      c.beginPath(); c.moveTo(pts[0]!.x, pts[0]!.y); c.lineTo(pts[1]!.x, pts[1]!.y); c.stroke();
      c.strokeStyle = rgba('sepia', 0.1); c.lineWidth = 1;
      c.beginPath(); c.moveTo(pts[0]!.x, pts[0]!.y + w * 0.6); c.lineTo(pts[1]!.x, pts[1]!.y + w * 0.6); c.stroke();
      c.restore();
    };
    const seg = (u0: number, v0: number, u1: number, v1: number, w?: number) => line([{ x: courtX(u0, v0), y: courtY(v0) }, { x: courtX(u1, v1), y: courtY(v1) }], w);
    for (const v of [0, 0.125, 0.875, 1]) seg(0, v, 1, v, v === 0 || v === 1 ? 3.2 : 2.4);
    for (const u of [0, 1]) seg(u, 0, u, 1, 3.4);
    for (const u of [0.231, 0.769]) seg(u, 0.125, u, 0.875, 2.4);
    seg(0.231, 0.5, 0.769, 0.5, 2.4);
    seg(0, 0.5, 0.015, 0.5, 2.4); seg(0.985, 0.5, 1, 0.5, 2.4);
    // 網子：兩根柱子、網面（細格、透視）、上緣白帶
    const nv0 = -0.08, nv1 = 1.08;
    const post = (v: number) => ({ x: courtX(0.5, v), y: courtY(v) });
    const top = (v: number) => ({ x: courtX(0.5, v), y: courtY(v) - SZ * 0.5 * depthK(v) });
    const netTop = (v: number) => ({ x: courtX(0.5, v), y: courtY(v) - SZ * (0.47 - 0.05 * Math.sin(Math.PI * clamp(v))) * depthK(v) });
    c.save();
    c.strokeStyle = rgba('sepia', 0.12);
    c.lineWidth = 1;
    c.beginPath();
    for (let k = 0; k <= 30; k++) {
      const v = lerp(nv0, nv1, k / 30), a = netTop(v), b = post(v);
      c.moveTo(a.x, a.y); c.lineTo(b.x, b.y - 2);
    }
    for (let k = 1; k < 9; k++) {
      c.moveTo(netTop(nv0).x, lerp(netTop(nv0).y, post(nv0).y, k / 9));
      for (let j = 1; j <= 12; j++) { const v = lerp(nv0, nv1, j / 12), a = netTop(v), b = post(v); c.lineTo(a.x, lerp(a.y, b.y, k / 9)); }
    }
    c.stroke();
    c.restore();
    const tape: Pt[] = []; for (let k = 0; k <= 12; k++) tape.push(netTop(lerp(nv0, nv1, k / 12)));
    inkPath(c, tape, { ink, w: 1.3, seed: 8 });
    inkLine(c, [post(nv0), top(nv0)], { ink, w: 0.9, seed: 9 });
    inkLine(c, [post(nv1), top(nv1)], { ink, w: 1.3, seed: 10 });
    // 球籃（芃芃把球丟進去）：鐵絲籃，裡面幾顆球
    const K = BASKET;
    for (let k = 0; k < 5; k++) tennisBall(c, K.x - 18 + k * 9 + (k % 2) * 3, K.y - 40 - (k % 3) * 5, 8, { ink, t: 0 });
    inkPoly(c, [{ x: K.x - 34, y: K.y - 44 }, { x: K.x + 34, y: K.y - 44 }, { x: K.x + 28, y: K.y }, { x: K.x - 28, y: K.y }], { ink, w: 0.7, seed: 12 });
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1;
    c.beginPath(); for (let x = -24; x <= 24; x += 12) { c.moveTo(K.x + x, K.y - 44); c.lineTo(K.x + x * 0.82, K.y); } c.stroke();
    // 右下角（HUD）：場地線在那裡淡掉
    c.save();
    c.globalCompositeOperation = 'destination-out';
    const g = c.createRadialGradient(1760, 1040, 60, 1760, 1040, 520);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(1100, 700, 820, 380);
    c.restore();
    this.drawBoard(c, ink);
    L.upload();
  }

  /** 計分牌：兩條鐵絲掛在鐵網頂上、深色木板（這個亮版面裡最深的一塊，字才最清楚）、下緣看得到厚度。 */
  private drawBoard(c: CanvasRenderingContext2D, ink: Ink) {
    const B = this.board;
    for (const x of [B.x + 60, B.x + B.w - 60]) inkLine(c, [{ x, y: FENCE_TOP - 4 }, { x, y: B.y + 6 }], { ink, w: 0.5, seed: x, color: rgba('sepia', 0.55) });
    // 影子（太陽在左上：往右下）
    c.fillStyle = rgba('sepia', 0.14);
    c.fillRect(B.x + 12, B.y + 14, B.w, B.h);
    // 厚度
    c.fillStyle = mixRgba('sepia', 'ink', 0.4);
    c.beginPath(); c.moveTo(B.x + 3, B.y + B.h); c.lineTo(B.x + B.w - 3, B.y + B.h); c.lineTo(B.x + B.w - 12, B.y + B.h + 11); c.lineTo(B.x + 12, B.y + B.h + 11); c.closePath(); c.fill();
    // 板面：上面被太陽照到亮一點
    const face = c.createLinearGradient(B.x, B.y, B.x + B.w * 0.4, B.y + B.h);
    face.addColorStop(0, mixRgba('sepia', 'paper', 0.14));
    face.addColorStop(1, mixRgba('sepia', 'ink', 0.18));
    c.fillStyle = face;
    c.fillRect(B.x, B.y, B.w, B.h);
    // 內框
    c.strokeStyle = rgba('paper', 0.16);
    c.lineWidth = 1.2;
    c.strokeRect(B.x + 12, B.y + 12, B.w - 24, B.h - 24);
    inkPoly(c, [{ x: B.x, y: B.y }, { x: B.x + B.w, y: B.y }, { x: B.x + B.w, y: B.y + B.h }, { x: B.x, y: B.y + B.h }], { ink, w: 0.8, seed: 21 });
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('paper', 0.42);
    c.textAlign = 'right';
    c.fillText('SET 1 · GAME 3', B.x + B.w - PAD.x, B.y + 44);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
  }

  /** 球在 t 的位置（3D：x、地面 g、高度 h）；沒有球在飛回傳 null。 */
  private ballAt(t: number): (B3 & { leg: Leg; u: number }) | null {
    for (const L of this.legs) {
      if (t < L.t0 || t >= L.t1) continue;
      const u = (t - L.t0) / Math.max(1e-4, L.t1 - L.t0);
      return { x: lerp(L.a.x, L.b.x, u), g: lerp(L.a.g, L.b.g, u), h: lerp(L.a.h, L.b.h, u) + 4 * L.peak * u * (1 - u), leg: L, u };
    }
    return null;
  }

  /** 樹（鐵網後面，很淡）：樹冠幾團，拍點上被風推一下。先描每一團的邊，再挖掉聯集的裡面（只留外輪廓），最後整團一層淡淡的墨。 */
  private trees(c: CanvasRenderingContext2D, t: number, ink: Ink) {
    const gust = beatKick(this.ctx.audio, t, 0.5);
    const blobs: [number, number, number, number, number][] = [];
    for (const [x, k, sd] of [[250, 1, 1], [640, 0.8, 2], [1020, 0.9, 3]] as const) {
      const base = FENCE_TOP + 10, top = base - 150 * k;
      inkLine(c, [{ x: x - 6 * k, y: base }, { x: x - 3 * k, y: top + 70 * k }], { ink, w: 0.6, seed: sd, color: rgba('sepia', 0.22) });
      for (const [dx, dy, r] of [[0, 20, 76], [-62, 56, 56], [64, 50, 60], [0, 80, 60]] as const) {
        const s = gust * (1 - dy / 120) * 6 + Math.sin(t * 0.9 + sd + dx) * 1.5;
        blobs.push([x + (dx + s) * k, top + dy * k, r * k, r * 0.72 * k, sd * 10 + dx]);
      }
    }
    for (const [x, y, rx, ry, sd] of blobs) inkEllipse(c, x, y, rx, ry, 0, { ink, w: 0.45, seed: sd, color: rgba('sepia', 0.17), t });
    const union = (d: number) => { c.beginPath(); for (const [x, y, rx, ry] of blobs) { c.moveTo(x + rx - d, y); c.ellipse(x, y, rx - d, ry - d, 0, 0, Math.PI * 2); } };
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    union(2.5); c.fill();
    c.restore();
    union(0); c.fillStyle = rgba('sepia', 0.04); c.fill();
    // 雲：兩三筆很淡的線，慢慢往右飄
    for (let k = 0; k < 3; k++) {
      const x = ((180 + k * 520 + t * (9 + k * 3)) % 1500) - 100, y = 58 + k * 26;
      if (x > BOARD.x - 260) continue;
      inkPath(c, [{ x, y }, { x: x + 60, y: y - 16 }, { x: x + 130, y: y - 8 }, { x: x + 190, y: y - 20 }, { x: x + 250, y }], { ink, w: 0.45, seed: 40 + k, color: rgba('sepia', 0.2), t });
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.court.render(renderer, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);

    this.trees(c, t, ink);
    comp.draw(renderer, this.bg.texture, out);

    // 歌詞：印在擋風布上
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, maxWidth: LYRIC.w, tracking: 0.5, lineHeight: 1.08, active: rgba('signal'), sung: rgba('sepia', 0.86), unsung: rgba('sepia', 0.22) };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(LYRIC.x, LYRIC.y - (lay.height - lay.size) / 2 + 2);
      drawLyric(c, ly.line, t, st, lay, ly.k * rv);
      c.restore();
    }

    // 人（影子往右下拖：太陽在左上）
    this.drawPlayer(c, 0, t);
    this.drawPlayer(c, 1, t);
    this.drawDogs(c, t);
    this.drawBall(c, t);
    this.drawBoardText(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近計分牌（最多 1.03 倍，字離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p);
    const B = this.board;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.4, zoom: 1 + 0.028 * push, shake: [-(B.x + B.w / 2 - W / 2) * 0.028 * push, -(B.y + B.h / 2 - H / 2) * 0.028 * push] };
  }

  /** 一個人：姿勢時間軸＋引拍時往後帶、擊球後往前送＋對手擊球時的小跳（split step）＋呼吸與拍子。 */
  private drawPlayer(c: CanvasRenderingContext2D, i: 0 | 1, t: number) {
    const au = this.ctx.audio, w = WHO[i];
    const bp = au.beatPeriod(t) * this.step;
    let lift = 0, rot = 0, squash = breathe(t, 0.008, 3.1, i * 0.4) + 0.012 * beatKick(au, t, 0.3);
    for (const h of this.hits) {
      const d = t - h.t;
      if (d < -bp * 1.2 || d > bp * 1.2) continue;
      if (h.who === i) {
        // 擊球前身體往後帶、擊球的那一下往前送、慢慢收回
        if (d < 0) rot -= w.dir * 0.05 * prog(t, h.t - bp * 0.5, h.t, ease.inOutCubic);
        else rot += w.dir * 0.07 * Math.exp(-d / (bp * 0.3));
        if (d >= 0 && d < 0.18) squash += 0.05 * (1 - d / 0.18);
        if (h.kind === 'serve' && d < 0) lift = Math.max(lift, 10 * prog(t, h.t - bp * 0.35, h.t, ease.outCubic));
      } else {
        // 對方擊球的那一刻：原地小跳
        const u = (t - h.t + 0.04) / 0.24;
        if (u > 0 && u < 1) lift = Math.max(lift, 11 * Math.sin(Math.PI * u));
      }
    }
    // 出界球：宣文看著球從身邊飛過去，落地的那一下開心地跳一下（這一分是他的）
    for (const r of this.rallies) {
      if (i === 0) { const j = (t - r.bounce) / 0.3; if (j > 0 && j < 1) lift = Math.max(lift, 20 * Math.sin(Math.PI * j)); }
    }
    const ent = puppetIn(t, this.ctx.start + 0.05 + i * 0.12, 0.45);
    if (ent.alpha <= 0) return;
    const o: PuppetOpts = { h: SZ, flip: w.flip, rot, pivot: 0.45, squash, spin: ent.spin, alpha: ent.alpha };
    puppetShadow(c, w.p, w.x + SZ * 0.14, GROUND + 4, { h: SZ, lift, alpha: 0.26 * ent.alpha, wide: 1.7, color: '70,45,25' });
    drawPick(c, this.keys[i]!, t, w.x, GROUND - lift, o);
    if (ent.k < 1) {
      sparkHead(this.glow, w.x, GROUND - 6, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x: w.x, y: GROUND - 6 }), { rate: 50, life: 0.25, speed: 140, seed: i + 1 });
    }
  }

  /** 球、球的影子、拖在後面的一小段訊號色的線、擊球與彈地的小波紋。 */
  private drawBall(c: CanvasRenderingContext2D, t: number) {
    const ink = inkFor(true);
    // 出界球停在宣文腳邊（球僮咬起來之前；元元那一輪球在牠嘴裡，不停在地上）
    let b = this.ballAt(t);
    if (!b) {
      const r = this.rallies.find((r) => r.dog !== 'yy' && t >= r.rest && t < r.pick);
      if (r) b = { x: OUT_REST.x, g: OUT_REST.g, h: 0, leg: this.legs[0]!, u: 1 };
    }
    // 擊球的瞬間：拍面炸一圈短線（訊號色）
    for (const h of this.hits) {
      const k = 1 - clamp((t - h.t) / 0.18);
      if (k <= 0 || t < h.t) continue;
      const p = h.kind === 'serve' ? this.servePt : this.contact[h.who];
      this.burst(c, p.x, p.y, k, 18);
    }
    // 彈地：地上一圈扁扁的波紋
    for (const L of this.legs) {
      if (!L.bounce) continue;
      const k = 1 - clamp((t - L.t0) / 0.35);
      if (k <= 0 || t < L.t0) continue;
      c.save();
      c.strokeStyle = rgba('signal', 0.8 * k);
      c.lineWidth = 2;
      c.beginPath(); c.ellipse(L.a.x, L.a.g, 10 + (1 - k) * 30, (10 + (1 - k) * 30) * 0.28, 0, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
    if (!b) return;
    const v = (b.g - Y0) / (Y1 - Y0), k = depthK(v);
    // 影子：離地越高越小越淡
    const up = clamp(b.h / (SZ * 1.2));
    c.save();
    c.fillStyle = rgba('sepia', 0.22 * (1 - up * 0.7));
    c.beginPath(); c.ellipse(b.x + b.h * 0.12, b.g + 1, BALL_R * k * (1.2 - up * 0.5), BALL_R * k * 0.34, 0, 0, Math.PI * 2); c.fill();
    c.restore();
    // 拖在後面的線：往回取 0.16 秒的位置
    const trail: Pt[] = [];
    for (let j = 10; j >= 0; j--) {
      const q = this.ballAt(t - j * 0.016);
      if (q) trail.push({ x: q.x, y: q.g - q.h });
    }
    if (trail.length > 2) {
      c.save();
      c.lineCap = 'round';
      for (let j = 1; j < trail.length; j++) {
        const a = j / trail.length;
        c.strokeStyle = rgba('signal', 0.7 * a * a);
        c.lineWidth = 1 + 4 * a;
        c.beginPath(); c.moveTo(trail[j - 1]!.x, trail[j - 1]!.y); c.lineTo(trail[j]!.x, trail[j]!.y); c.stroke();
      }
      c.restore();
    }
    tennisBall(c, b.x, b.g - b.h - BALL_R * k * 0.2, BALL_R * k, { ink, t });
  }

  /** 一圈往外炸的短線（訊號色）：擊球、咬到球。 */
  private burst(c: CanvasRenderingContext2D, x: number, y: number, k: number, r0: number) {
    c.save();
    c.strokeStyle = rgba('signal', k);
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, ra = r0 + (1 - k) * 26, rb = ra + 13 * k;
      c.moveTo(x + Math.cos(a) * ra, y + Math.sin(a) * ra); c.lineTo(x + Math.cos(a) * rb, y + Math.sin(a) * rb);
    }
    c.stroke();
    c.restore();
  }

  /** 元元那一輪的跳躍：起跳、落地（最高點在出界球的拍點上）。 */
  private yyLeap(r: Rally) {
    const air = Math.min(0.56, (r.pick - r.bounce) * 1.15);
    return { t0: r.bounce - air / 2, t1: r.bounce + air / 2 };
  }

  /** 三隻狗：先畫後面的元元（線審），再畫網柱邊的兩個球僮。 */
  private drawDogs(c: CanvasRenderingContext2D, t: number) {
    // 有狗接到球的那一刻（博美咬到、元元空中接住），坐著的另外兩隻跟著彈一下
    let cheer = 0;
    for (const r of this.rallies) {
      const tc = r.dog === 'yy' ? r.bounce : r.pick;
      const u = (t - tc) / 0.32;
      if (u > 0 && u < 1) cheer = Math.max(cheer, Math.sin(Math.PI * u));
    }
    this.drawYuan(c, t, cheer);
    for (const d of ['pp', 'qq'] as const) this.drawBallkid(c, t, d, cheer);
  }

  /**
   * 球僮（芃芃、QQ）：坐在網柱邊跟著拍子點頭 → 輪到自己時，出界球落地就起跑（朝左）→ 下一拍咬到（拍點）→ 叼著球跑回來 → 把球丟進球籃、坐好。
   */
  private drawBallkid(c: CanvasRenderingContext2D, t: number, d: 'pp' | 'qq', cheer: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + (d === 'pp' ? 0.3 : 0.38), 0.42);
    if (en.alpha <= 0) return;
    const X = HOME[d];
    const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    const shadow = (x: number, lift = 0) => puppetShadow(c, d, x + 10, DOG_Y + 2, { h: SZ * DOG_S, lift, alpha: 0.28 * en.alpha, color: '70,45,25' });
    const r = this.rallies.find((r) => r.dog === d && t >= r.bounce - 0.25 && t < r.drop + 0.6);
    const sit = (x: number) => {
      const lift = 12 * cheer;
      shadow(x, lift);
      drawPuppet(c, `${d}_sit`, x, DOG_Y - lift, { ...base, squash: 0.05 * beatKick(au, t, 0.25) + breathe(t, 0.014, 1.3, d === 'pp' ? 0 : 0.5) });
    };
    if (!r) { sit(X); return; }
    // 咬球的地方：<狗>_ball 的嘴（圖上的球）剛好在停住的球上方
    const probe = puppetPoint(`${d}_ball`, 'ball', 0, DOG_Y, { ...base, flip: true });
    const pickX = OUT_REST.x - (probe ? probe.x : -40);
    const go = r.bounce - 0.12;
    if (t < go) { sit(X); return; }
    const runs = [`${d}_run_1`, `${d}_run_2`];
    if (t < r.pick) {
      // 衝過去：越跑越快、快到的時候放慢，剛好在拍點咬到
      const u = clamp((t - go) / (r.pick - go));
      const x = lerp(X, pickX, 0.5 - 0.5 * Math.cos(Math.PI * u));
      const b = hop(au.beatAt(t), 2) * 8;
      shadow(x, b);
      drawCycle(c, au, t, runs, 2, x, DOG_Y - b, { ...base, flip: true, rot: -0.04 });
      return;
    }
    const k = 1 - clamp((t - r.pick) / 0.22);
    if (t < r.pick + (r.home - r.pick) * 0.22) {
      // 咬到：叼著球（圖上的球）停一下
      shadow(pickX);
      drawPuppet(c, `${d}_ball`, pickX, DOG_Y, { ...base, flip: true, squash: landSquash(t, r.pick, 0.12) });
      if (probe && k > 0) this.burst(c, OUT_REST.x, probe.y, k, 14);
      return;
    }
    if (t < r.home) {
      // 跑回來（朝右），球在嘴裡
      const t0 = r.pick + (r.home - r.pick) * 0.22;
      const u = clamp((t - t0) / (r.home - t0));
      const x = lerp(pickX, X, 0.5 - 0.5 * Math.cos(Math.PI * u));
      const b = hop(au.beatAt(t), 2) * 8;
      shadow(x, b);
      const o: PuppetOpts = { ...base, rot: 0.03 };
      const name = drawCycle(c, au, t, runs, 2, x, DOG_Y - b, o);
      const m = puppetPoint(name, 'mouth', x, DOG_Y - b, o);
      if (m) tennisBall(c, m.x, m.y + 2, BALL_R, { ink: inkFor(true), t });
      return;
    }
    // 到了：把球丟進球籃（小小的拋物線），坐好
    sit(X);
    if (t < r.drop) {
      const u = clamp((t - r.home) / (r.drop - r.home));
      const m = { x: X + 40, y: DOG_Y - SZ * DOG_S * 0.16 };
      tennisBall(c, lerp(m.x, BASKET.x, u), lerp(m.y, BASKET.y - 48, u) - 60 * u * (1 - u), BALL_R, { ink: inkFor(true), t });
    }
  }

  /**
   * 元元（線審）：正面坐著笑，每個小節線歪一次頭（sit ↔ tilt）→ 輪到牠時，孟庭出手那一拍站起來（面向來球）→
   * 最高點在出界球的拍點上跳起來接住（飛行中蓋掉圖上的球，接到那一刻打開）→ 落地叼著 → 下一拍把球一甩丟進球籃 → 走回位子坐下。
   */
  private drawYuan(c: CanvasRenderingContext2D, t: number, cheer: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.22, 0.42);
    if (en.alpha <= 0) return;
    const X = HOME.yy;
    const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    const shadow = (x: number, lift = 0) => puppetShadow(c, 'yy', x + 10, DOG_Y + 2, { h: SZ * DOG_S, lift, alpha: 0.26 * en.alpha, color: '70,45,25' });
    const sit = () => {
      const lift = 10 * cheer;
      shadow(X, lift);
      const tilt = Math.floor(au.barAt(t)) % 2 === 1;
      drawPuppet(c, tilt ? 'yy_tilt' : 'yy_sit', X, DOG_Y - lift, { ...base, squash: 0.03 * beatKick(au, t, 0.25) + breathe(t, 0.012, 1.8, 0.2) });
    };
    const r = this.rallies.find((r) => r.dog === 'yy' && t >= r.bounce - (r.pick - r.bounce) * 1.3 && t < r.home + 0.1);
    if (!r) { sit(); return; }
    const sp = r.pick - r.bounce;
    const L = this.yyLeap(r);
    const standAt = r.bounce - sp * 1.2;
    if (t < L.t0) {
      // 站起來、面向來球，起跳前蹲一下（jumpArc 的預備）
      const j = jumpArc(t, L.t0, L.t1, YJUMP);
      const x = lerp(X, YCATCH_X - 50, prog(t, standAt, L.t0, ease.inOutCubic));
      shadow(x);
      drawPuppet(c, 'yy_stand', x, DOG_Y, { ...base, squash: j.squash + landSquash(t, standAt, 0.06) });
      return;
    }
    if (t < L.t1 + 0.1) {
      // 跳：最高點（拍點）剛好在 YCATCH_X、身體水平；接到之前蓋掉圖上的球
      const j = jumpArc(t, L.t0, L.t1, YJUMP, { crouch: 0, land: 0.18 });
      const x = lerp(YCATCH_X - 50, YCATCH_X + 50, clamp((t - L.t0) / (L.t1 - L.t0)));
      shadow(x, -j.y);
      if (j.air) {
        drawPuppet(c, 'yy_jump', x, DOG_Y + j.y, { ...base, rot: -0.18 + 0.36 * j.u, pivot: 0.5, squash: j.squash, hide: t < r.bounce ? ['ball'] : undefined });
        const k = 1 - clamp((t - r.bounce) / 0.22);
        if (k > 0 && t >= r.bounce) this.burst(c, this.yyCatch.x, this.yyCatch.y, k, 16);
      } else drawPuppet(c, 'yy_ball', YCATCH_X + 50, DOG_Y, { ...base, squash: j.squash });
      return;
    }
    const x1 = YCATCH_X + 50;
    if (t < r.pick) {
      // 落地叼著球（圖上的球），跟著拍子點頭
      shadow(x1);
      drawPuppet(c, 'yy_ball', x1, DOG_Y, { ...base, squash: 0.03 * beatKick(au, t, 0.2) });
      return;
    }
    // 甩球：拍點上頭往前一甩（往前傾一下），球沿拋物線飛進球籃；然後走回位子（朝左）坐下
    const toss = puppetPoint('yy_ball', 'ball', x1, DOG_Y, base) ?? { x: x1 + 90, y: DOG_Y - 150 };
    const u = clamp((t - r.pick) / (r.drop - r.pick));
    if (u < 1) tennisBall(c, lerp(toss.x, BASKET.x, u), lerp(toss.y, BASKET.y - 48, u) - 120 * u * (1 - u), BALL_R, { ink: inkFor(true), t });
    const back = prog(t, r.pick + sp * 0.35, r.home, ease.inOutCubic);
    if (back <= 0) {
      shadow(x1);
      drawPuppet(c, 'yy_stand', x1, DOG_Y, { ...base, rot: -0.08 * Math.exp(-(t - r.pick) / 0.12), pivot: 0.3 });
      return;
    }
    const x = lerp(x1, X, back);
    shadow(x, hop(au.beatAt(t), 2) * 4);
    drawPuppet(c, 'yy_walk', x, DOG_Y - hop(au.beatAt(t), 2) * 4, { ...base, flip: true });
  }

  /** 計分牌上的比分（每丟一分翻一次）與主打留言（第一球起逐字寫上去，寫完署名淡入）。 */
  private drawBoardText(c: CanvasRenderingContext2D, t: number) {
    const B = this.board;
    // 比分：落地（這一分結束）的那一下像翻牌一樣翻過去：前半舊的壓扁、後半新的展開
    let pts = 0;
    for (const r of this.rallies) if (t >= r.bounce) pts = r.point;
    const fl = this.rallies.find((r) => t >= r.bounce && t < r.bounce + 0.25);
    const u = fl ? (t - fl.bounce) / 0.25 : 1;
    const shown = fl && u < 0.5 ? pts - 1 : pts;
    c.save();
    c.font = font(F.mono(600), 18);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('paper', 0.55);
    c.translate(B.x + PAD.x, B.y + 44 - 6);
    c.scale(1, Math.max(0.02, Math.abs(Math.cos(Math.PI * u))));
    c.fillText(SCORES[Math.min(Math.max(0, shown), SCORES.length - 1)]!, 0, 6);
    c.restore();
    const n = this.note;
    if (!n) return;
    const top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    const t0 = Math.min(this.hits[0]?.t ?? this.ctx.start + 0.45, this.ctx.start + 0.45);
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.025, 0.09);
    const done = t0 + total * per;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    drawNote(c, n, B.x + PAD.x, top + Math.max(0, (h - n.height) * 0.42), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('paper', 0.97) : rgba('paper', 0.7), sigColor: rgba('paper', 0.78), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
