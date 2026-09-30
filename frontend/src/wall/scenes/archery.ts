// 射箭（暗、sport）：夜裡的射箭場，側面看孟庭拉弓射箭，宣文在後面遞箭，芃芃、QQ、元元三隻狗坐成一排看。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 一輪兩小節：前一小節預備（搭箭 → 第三拍半開始拉弓、滿弓停住微微發抖），**小節線上放箭**（換成放箭後的姿勢），
//    箭飛一拍，**下一拍正中靶心**：金色的靶心變成一顆愛心（點綴色）、靶環閃一圈、火花炸開，兩隻博美跳起來、宣文歡呼；
//    之後宣文遞下一支箭。箭一支一支留在靶上（射中的那一刻箭尾還在抖）。
//  - 元元（白色柴犬，比博美大、穩重愛笑）坐在宣文旁邊：孟庭拉弓時歪頭盯著看，射中的那一拍**仰頭叫一聲**
//    （博美在跳、牠挺起身子叫，一拍半），再坐回去，跟著拍子點頭。三隻狗用同一個場景尺度，大小照 dogs3-lineup.png。
//  - 箭的接力：滿弓那張圖上畫好的箭，放箭的那一刻交給程式（起點就是圖上的箭，manifest 的道具點 tip／nock），
//    程式沿著很平的拋物線飛過畫面正中，後面拖一道訊號色的細線（會發光）。
//  - 歌詞是掛在射箭場上方的一串三角旗：一個字（英文一個字詞）一面旗，唱到哪面亮到哪面（跟唱規則），旗子被風吹、拍點上一晃。
//  - **焦點是主打留言**：寫在最前面草地上立著的 A 字形小黑板（計分板），粉筆字、署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、板子最大 600 × 350、放在畫面下三分之一（箭從它上面飛過去），寬高跟著留言長短。
//    沒有留言時寫邀請。
//  - 景深：人站的地面最近、靶架遠一點（腳底比較高），計分板在最前面；遠處一排樹的剪影、地平線一點暖光。
//  - 鏡頭：整個窗格慢慢推近；箭飛的那一拍鏡頭跟著往右帶一點，射中時輕輕一頓。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, barAfter, beatAfter, sparkHead, sparkParticles, msgChars, drawHeart } from './_motifs';
import { inkFor, inkLine, inkPoly, inkEllipse, arcAt, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetPoint, puppetShadow, puppetIn, puppetLight, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'sport', paper: false, energy: [0.3, 1], bars: [4, 8] };

/** 人站的地面、靶架站的地面（遠一點，所以比較高）。 */
const GROUND = 872, FAR = 792;
const SZ = 400;
/** 由左到右：QQ、芃芃、元元（三隻坐成一排）、宣文、孟庭。孟庭滿弓時箭頭在 OM_X + 158 左右，要在小黑板的左上方。 */
const OM_X = 562, AL_X = 424, YY_X = 312, PP_X = 204, QQ_X = 104;
/**
 * 靶：中心、半徑。側面看靶面只是一條線，所以靶架轉向鏡頭（sx = 靶面水平方向的扁度），看得到一圈一圈的環。
 * 靶心的高度跟滿弓時箭的高度差不多，箭才是平平地飛過去。
 */
const TGT = { x: 1560, y: 572, r: 128, sx: 0.6 };
/** 計分板（A 字形的小黑板，立在最前面的草地上）：中心 x、底邊固定，寬高跟著留言（標準 v2：最大 600 × 350）。寫字的內距。 */
const BOARD = { cx: 1036, bottom: 972, w: 600, h: 350 };
const PAD = { x: 38, top: 56, bottom: 26 };
/** 三角旗那串繩子：兩端與下垂量。 */
const FLAG = { x0: 150, y0: 126, x1: 1590, y1: 146, sag: 64 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const LABEL = 'LANE 03 · 計分';
const SPRITES = [
  'mt_archery_ready', 'mt_archery_draw', 'mt_archery_release', 'xw_archery_quiver', 'xw_idle_front', 'xw_cheer',
  'pp_sit', 'pp_jump', 'qq_sit', 'qq_jump', 'yy_sit', 'yy_tilt', 'yy_howl',
];

interface Shot { rel: number; hit: number; next: number; to: Pt; last: boolean }

/**
 * 夜空與燈：天空上深下淺、地平線一點暖光、射擊線上方一盞探照燈打下來的光圈、靶上方一盞小燈。
 * 用 shader 算（浮點＋一點點抖色），Canvas2D 的淡漸層在大螢幕上會看到一圈一圈的階。
 */
const SKY = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float hz = exp(-pow((p.y - 760.0) / 150.0, 2.0));
    vec3 col = C_INK + C_EMBER * 0.012 * hz * (0.7 + 0.3 * smoothstep(1400.0, 300.0, p.x));
    // 射擊線的探照燈：從左上斜下來的一道很淡的光，地上一個光圈
    vec2 a = vec2(130.0, -40.0), b = vec2(${OM_X}.0, ${GROUND}.0);
    vec2 ab = b - a; float u = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    float d = length(p - (a + ab * u)) / mix(40.0, 330.0, u);
    float cone = (1.0 - smoothstep(0.3, 1.0, d)) * u * (1.0 - smoothstep(${GROUND}.0, ${GROUND + 70}.0, p.y));
    vec2 q = (p - vec2(${OM_X - 60}.0, ${GROUND}.0)) / vec2(520.0, 90.0);
    float pool = exp(-dot(q, q) * 1.6);
    // 靶上方的小燈
    vec2 e = (p - vec2(${TGT.x}.0, ${TGT.y + 60}.0)) / vec2(360.0, 420.0);
    float lamp = exp(-dot(e, e) * 2.0);
    col += C_BONE * (0.012 * cone + 0.04 * pool + 0.016 * lamp);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

export default class Archery extends Scene {
  sky = shared('archery.sky', SKY);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  shots: Shot[] = [];
  omKeys: [number, string][] = [];
  alKeys: [number, string][] = [];
  /** 滿弓那張圖上的箭：箭頭、箭尾（畫面座標）。 */
  tip: Pt = { x: 0, y: 0 };
  nock: Pt = { x: 0, y: 0 };
  arrowLen = 180;
  note: Note | null = null;
  board = { x: 0, y: 0, w: BOARD.w, h: BOARD.h };
  lyricSize = 52;
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + LABEL);
    this.track(await loadPuppets(SPRITES));
    // 箭：圖上的箭頭與箭尾（沒有量道具點時照手的位置估）
    const o: PuppetOpts = { h: SZ };
    this.tip = puppetPoint('mt_archery_draw', 'tip', OM_X, GROUND, o) ?? { x: OM_X + 150, y: GROUND - SZ * 0.72 };
    this.nock = puppetPoint('mt_archery_draw', 'nock', OM_X, GROUND, o) ?? { x: OM_X - 20, y: GROUND - SZ * 0.72 };
    this.arrowLen = Math.hypot(this.tip.x - this.nock.x, this.tip.y - this.nock.y);
    // 一輪兩小節：小節線放箭、下一拍射中；窗格太短就在下一拍放箭
    const s = this.ctx.start, e = this.ctx.end, bp0 = au.beatPeriod(s);
    let rel = barAfter(au, s + bp0 * 2.2);
    if (rel + bp0 * 1.4 > e) rel = beatAfter(au, s + bp0 * 1.6);
    for (let k = 0; k < 24; k++) {
      const hit = au.timeOfBeat(Math.round(au.beatAt(rel)) + 1);
      const next = au.timeOfBar(Math.round(au.barAt(rel)) + 2);
      // 第一支正中靶心，之後的箭落在愛心裡一點點不同的地方
      const to = k === 0 ? { x: TGT.x, y: TGT.y } : { x: TGT.x + (hash(k, 3) - 0.5) * 30 * TGT.sx, y: TGT.y + (hash(k, 4) - 0.5) * 30 };
      const last = next + au.beatPeriod(next) * 1.4 > e;
      this.shots.push({ rel, hit, next, to, last });
      if (last) break;
      rel = next;
    }
    // 孟庭：搭箭（ready）→ 放箭前一拍半拉滿（draw）→ 小節線放箭（release，跟隨動作停兩拍多）→ 放下弓
    const om: [number, string][] = [[-1e9, 'mt_archery_ready']];
    const al: [number, string][] = [[-1e9, 'xw_idle_front']];
    for (const sh of this.shots) {
      const bp = au.beatPeriod(sh.rel);
      om.push([sh.rel - bp * 1.5, 'mt_archery_draw'], [sh.rel, 'mt_archery_release'], [sh.rel + bp * 3, 'mt_archery_ready']);
      // 宣文：射中歡呼 → 遞下一支箭 → 她開始拉弓時站好
      al.push([sh.hit, 'xw_cheer']);
      if (!sh.last) al.push([sh.hit + bp * 1.6, 'xw_archery_quiver'], [sh.next - bp * 1.7, 'xw_idle_front']);
      else al.push([sh.hit + bp * 1.8, 'xw_idle_front']);
    }
    this.omKeys = om;
    this.alKeys = al;
    // 小黑板上的留言：標準 v2 的字級；板子的寬高跟著留言（置中、底邊固定）
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, hmax = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const bh = Math.min(BOARD.h, Math.max(210, PAD.top + this.note.height + PAD.bottom + 14));
    const bw = Math.min(BOARD.w, tightenNote(c, this.note, 330) + PAD.x * 2);
    this.board = { x: BOARD.cx - bw / 2, y: BOARD.bottom - bh, w: bw, h: bh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.4);
    this.drawBackground();
  }

  /** 不會動的：遠處的樹、地面、射擊線、靶架與靶面、計分板（畫一次，線不抖）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(false);
    L.clear();
    // 星星：很少、很淡
    c.fillStyle = rgba('bone', 1);
    for (let k = 0; k < 40; k++) {
      const x = hash(k, 11) * W, y = 40 + hash(k, 12) * 520;
      if (x > 1340 && y > 700) continue;
      c.globalAlpha = 0.05 + 0.12 * hash(k, 13) ** 2;
      c.beginPath(); c.arc(x, y, 0.8 + hash(k, 14) * 1.1, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    // 遠處一排樹的剪影（比天空暗一點點，頂上一條很淡的亮邊）
    const tree: Pt[] = [{ x: 0, y: FAR - 10 }];
    for (let x = 0; x <= W; x += 24) tree.push({ x, y: FAR - 60 - 34 * hash(Math.floor(x / 24), 21) - 26 * Math.sin(x / 210) });
    tree.push({ x: W, y: FAR - 10 });
    c.fillStyle = rgba('ink', 0.92);
    c.beginPath(); tree.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fill();
    c.strokeStyle = rgba('bone', 0.07); c.lineWidth = 1.2;
    c.beginPath(); tree.slice(1, -1).forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    // 草地：從遠到近慢慢浮起來一點（讓人和靶站得住）
    const g = c.createLinearGradient(0, FAR - 20, 0, H);
    g.addColorStop(0, rgba('ink2', 0)); g.addColorStop(0.3, rgba('ink2', 0.9)); g.addColorStop(1, rgba('ink2', 0.5));
    c.fillStyle = g; c.fillRect(0, FAR - 20, W, H - FAR + 20);
    // 遠處別的靶道（小小的靶，很淡）
    for (const [x, s] of [[1180, 0.3], [1330, 0.26]] as const) {
      c.save(); c.globalAlpha = 0.3;
      this.target(c, ink, x, FAR - 150 * s - 18, 130 * s, 0.55);
      c.restore();
    }
    // 射擊線：人腳前面一條白線（透視：往右稍微往上）
    c.strokeStyle = rgba('bone', 0.12); c.lineWidth = 3;
    c.beginPath(); c.moveTo(60, GROUND + 14); c.lineTo(760, GROUND + 6); c.stroke();
    // 草：幾撮很淡的
    c.strokeStyle = rgba('bone', 0.1); c.lineWidth = 1.2;
    c.beginPath();
    for (let k = 0; k < 90; k++) {
      const x = hash(k, 31) * W, y = FAR + 10 + hash(k, 32) * (H - FAR - 30);
      if (x > 1340 && y > 800) continue;
      const hh = 6 + 10 * hash(k, 33) * (y - FAR) / (H - FAR);
      c.moveTo(x, y); c.lineTo(x + 2, y - hh); c.moveTo(x + 4, y); c.lineTo(x + 7, y - hh * 0.8);
    }
    c.stroke();
    // 靶架：兩隻前腳、一隻後腳（木頭），靶面轉向鏡頭
    const wood = mixRgba('ink2', 'fur', 0.22);
    const T = TGT;
    inkLine(c, [{ x: T.x + 20, y: T.y - 40 }, { x: T.x + 150, y: FAR - 6 }], { ink, w: 0.7, seed: 41, color: rgba('bone', 0.35) });
    for (const [x0, x1, sd] of [[T.x - 40, T.x - 110, 42], [T.x + 30, T.x + 70, 43]] as const) {
      inkPoly(c, [{ x: x0 - 7, y: T.y + 40 }, { x: x0 + 7, y: T.y + 40 }, { x: x1 + 8, y: FAR + 4 }, { x: x1 - 8, y: FAR + 4 }], { ink, fill: wood, w: 0.7, seed: sd });
    }
    this.target(c, ink, T.x, T.y, T.r, T.sx, true);
    this.drawBoard(c, ink, wood);
    L.upload();
  }

  /**
   * 一面靶：草編的靶墊（一圈圈的草紋）＋靶紙（白、黑、藍、紅、金五環，暗版面裡壓暗、只有金色的靶心用訊號色）。
   * sx = 轉向鏡頭的扁度；main = 主角的靶（多畫草墊的厚度與陰影）。
   */
  private target(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>, x: number, y: number, r: number, sx: number, main = false) {
    const straw = mixRgba('ink2', 'fur', 0.28), rim = r * 1.16;
    if (main) {
      // 草墊的厚度（往右後方露出一條）
      c.fillStyle = mixRgba('ink', 'fur', 0.12);
      c.beginPath(); c.ellipse(x + r * 0.2, y + 4, rim * sx, rim, 0, 0, Math.PI * 2); c.fill();
    }
    inkEllipse(c, x, y, rim * sx, rim, 0, { ink, fill: straw, w: main ? 0.9 : 0.5, seed: 51, color: rgba('bone', 0.5) });
    if (main) {
      c.strokeStyle = rgba('ink', 0.35); c.lineWidth = 1.4;
      for (let k = 0; k < 7; k++) { const rr = rim * (0.92 - k * 0.05); c.beginPath(); c.ellipse(x, y, rr * sx, rr, 0, 0, Math.PI * 2); c.stroke(); }
    }
    // 靶紙：外環到內環，顏色往靶心越來越暖（壓暗，不要比計分板上的字還亮）
    const rings: [number, string][] = [
      [1, mixRgba('ink2', 'bone', 0.5)], [0.8, mixRgba('ink2', 'bone', 0.08)], [0.6, mixRgba('ink2', 'denim', 0.42)],
      [0.4, mixRgba('ink2', 'collar', 0.5)], [0.2, rgba('signal', 0.9)],
    ];
    for (const [k, col] of rings) {
      c.fillStyle = col;
      c.beginPath(); c.ellipse(x, y, r * k * sx, r * k, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba('ink', 0.4); c.lineWidth = 1;
      c.stroke();
    }
    if (main) inkEllipse(c, x, y, r * sx, r, 0, { ink, w: 0.8, seed: 52, color: rgba('bone', 0.35) });
  }

  /**
   * 計分板：A 字形的小黑板立在最前面的草地上（木框、兩隻前腳、後面露出一點後腳），石板上面被燈照到淡一點；
   * 上緣一行小小的靶道編號。留言用粉筆（紙白）寫在上面，暗版面裡不會像一張發亮的卡片。
   */
  private drawBoard(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>, wood: string) {
    const B = this.board, fr = 13, foot = B.y + B.h + 64;
    // 後腳（在板子後面，只露出一點）
    for (const px of [B.x + 30, B.x + B.w - 30]) inkLine(c, [{ x: px, y: B.y + 20 }, { x: px + (px < B.x + B.w / 2 ? -10 : 10), y: foot - 18 }], { ink, w: 0.6, seed: px, color: rgba('bone', 0.2) });
    // 前腳：從框的兩側往下、稍微張開
    for (const [px, dx] of [[B.x - fr * 0.5, -16], [B.x + B.w + fr * 0.5, 16]] as const) {
      inkPoly(c, [{ x: px - 7, y: B.y - fr }, { x: px + 7, y: B.y - fr }, { x: px + 8 + dx, y: foot }, { x: px - 8 + dx, y: foot }], { ink, fill: wood, w: 0.7, seed: px });
    }
    inkPoly(c, [{ x: B.x - fr, y: B.y - fr }, { x: B.x + B.w + fr, y: B.y - fr + 1 }, { x: B.x + B.w + fr - 1, y: B.y + B.h + fr }, { x: B.x - fr + 1, y: B.y + B.h + fr - 1 }], { ink, fill: wood, w: 0.9, seed: 61 });
    // 石板：比底色浮起一點點，上面被燈照到淡一點
    const g = c.createLinearGradient(0, B.y, 0, B.y + B.h);
    g.addColorStop(0, mixRgba('ink2', 'graphite', 0.3)); g.addColorStop(1, mixRgba('ink', 'graphite', 0.12));
    c.fillStyle = g;
    c.fillRect(B.x, B.y, B.w, B.h);
    c.strokeStyle = rgba('ink', 0.5); c.lineWidth = 2;
    c.strokeRect(B.x + 1, B.y + 1, B.w - 2, B.h - 2);
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('bone', 0.4);
    c.fillText(LABEL, B.x + PAD.x, B.y + 38);
    c.letterSpacing = '0px';
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.sky.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);

    // ---- 人與狗（這一層最先畫：打光只染紙偶）。探照燈從左上打下來：頭頂亮、往腳底暗
    this.drawDog(c, t, 'qq', QQ_X, 0.3);
    this.drawDog(c, t, 'pp', PP_X, 0.2);
    this.drawAlan(c, t);
    this.drawYuanyuan(c, t);
    this.drawOmena(c, t);
    puppetLight(c, [0, GROUND - SZ * 1.3, 820, SZ * 1.3 + 40], rgba('ink', 0.06), rgba('ink', 0.46));

    // ---- 靶上的東西：靶心變成的愛心、插在靶上的箭、射中時的一圈閃光
    this.drawHits(c, t);
    // ---- 飛行中的箭
    this.drawFlight(c, t);
    // ---- 歌詞：三角旗
    const ly = lyricAt(lyrics, t);
    if (ly) this.pennants(c, ly.line, t, ly.k * rv);
    else this.bunting(c, t, rv);
    this.drawMessage(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);

    // 鏡頭：慢慢推近；箭飛的那一拍往右帶一點、射中時輕輕一頓（最多 1.03 倍，字離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p);
    let follow = 0, kick = 0;
    for (const sh of this.shots) {
      follow = Math.max(follow, prog(t, sh.rel, sh.hit, ease.inOutCubic) * (1 - prog(t, sh.hit + 0.1, sh.next - au.beatPeriod(t), ease.inOutCubic)));
      if (t >= sh.hit) kick = Math.max(kick, Math.exp(-(t - sh.hit) / 0.12));
    }
    return { bloom: 0.62, vignette: 0.5, zoom: 1 + 0.025 * push + 0.006 * kick, shake: [-22 * push - 16 * follow, 6 * push] };
  }

  /** 孟庭：照時間軸換姿勢；滿弓時微微發抖（用力）、放箭那一下往後一震；每拍跟著呼吸。 */
  private drawOmena(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const en = this.enter(t, 0.05, OM_X, 1);
    if (!en) return;
    let dx = 0, squash = breathe(t, 0.008, 3.2), rot = 0;
    for (const sh of this.shots) {
      const bp = au.beatPeriod(sh.rel);
      if (t >= sh.rel - bp * 1.5 && t < sh.rel) {
        // 拉弓：身體往後坐一點，滿弓後用力得微微發抖
        const k = prog(t, sh.rel - bp * 1.5, sh.rel - bp * 0.9, ease.outCubic);
        rot -= 0.015 * k;
        dx += Math.sin(t * 57) * 0.8 * k;
      }
      if (t >= sh.rel && t < sh.rel + bp * 2) {
        const d = t - sh.rel;
        dx -= 7 * Math.exp(-d / 0.09) * Math.sin(Math.min(1, d / 0.03) * Math.PI * 0.5);
        squash += 0.02 * Math.exp(-d / 0.12);
      }
    }
    puppetShadow(c, 'mt', OM_X, GROUND, { h: SZ, alpha: 0.8 * en.alpha, wide: 1.3, color: '0,0,0' });
    drawPick(c, this.omKeys, t, OM_X + dx, GROUND, { h: SZ, rot, pivot: 0.3, squash, spin: en.spin, alpha: en.alpha });
  }

  /** 宣文：站在後面；射中時跳起來歡呼、之後遞下一支箭；每拍輕輕點頭。 */
  private drawAlan(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const en = this.enter(t, 0.16, AL_X, 2);
    if (!en) return;
    let lift = 0, squash = breathe(t, 0.008, 3.4, 0.4) + 0.012 * beatKick(au, t, 0.3);
    for (const sh of this.shots) {
      const bp = au.beatPeriod(sh.hit);
      if (t > sh.hit - 0.1 && t < sh.hit + bp * 1.4) {
        const j = jumpArc(t, sh.hit - 0.02, sh.hit + Math.min(0.5, bp * 0.9), 26, { crouch: 0.06, land: 0.1 });
        lift = -j.y; squash = j.squash;
      }
    }
    puppetShadow(c, 'xw', AL_X, GROUND, { h: SZ, lift, alpha: 0.8 * en.alpha, wide: 1.3, color: '0,0,0' });
    drawPick(c, this.alKeys, t, AL_X, GROUND - lift, { h: SZ, pivot: 0.2, squash, spin: en.spin, alpha: en.alpha });
  }

  /** 狗：坐著看（拍點上興奮地壓一下）；射中的那一刻跳起來（圖上嘴前的網球蓋掉）。 */
  private drawDog(c: CanvasRenderingContext2D, t: number, who: 'pp' | 'qq', x: number, delay: number) {
    const au = this.ctx.audio;
    const en = this.enter(t, delay, x, who === 'qq' ? 3 : 4);
    if (!en) return;
    const base: PuppetOpts = { h: SZ, scale: 1.1, spin: en.spin, alpha: en.alpha };
    for (const sh of this.shots) {
      const bp = au.beatPeriod(sh.hit);
      const t0 = sh.hit + (who === 'qq' ? 0 : 0.06), t1 = t0 + Math.min(0.46, bp * 0.9);
      if (t > t0 - 0.12 && t < t1 + 0.2) {
        const j = jumpArc(t, t0, t1, who === 'qq' ? 60 : 40, { crouch: 0.1, land: 0.18 });
        puppetShadow(c, who, x, GROUND, { h: SZ * 1.1, lift: -j.y, alpha: 0.8 * en.alpha, color: '0,0,0' });
        if (j.air) drawPuppet(c, `${who}_jump`, x, GROUND + j.y, { ...base, hide: ['ball'], rot: -0.15 + 0.3 * j.u, pivot: 0.5, squash: j.squash });
        else drawPuppet(c, `${who}_sit`, x, GROUND, { ...base, squash: j.squash });
        return;
      }
    }
    puppetShadow(c, who, x, GROUND, { h: SZ * 1.1, alpha: 0.8 * en.alpha, color: '0,0,0' });
    drawPuppet(c, `${who}_sit`, x, GROUND, { ...base, squash: 0.04 * beatKick(au, t, 0.25) + breathe(t, 0.012, 1.4, who === 'qq' ? 0 : 0.5) });
  }

  /**
   * 元元：坐著看（跟著拍子輕輕點頭）；孟庭開始拉弓就歪頭盯著靶（tilt）；射中的那一拍仰頭叫一聲（howl，一拍半）：
   * 那一下身體往上一挺（拉長）、之後每拍再挺一下，叫完坐回去。博美在跳、牠在叫，兩種開心不一樣。
   */
  private drawYuanyuan(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const en = this.enter(t, 0.24, YY_X, 5);
    if (!en) return;
    let name = 'yy_sit', squash = 0.03 * beatKick(au, t, 0.3) + breathe(t, 0.01, 2.2, 0.3);
    for (const sh of this.shots) {
      const bp = au.beatPeriod(sh.rel);
      if (t >= sh.rel - bp * 1.5 && t < sh.hit) name = 'yy_tilt';
      if (t >= sh.hit && t < sh.hit + bp * 1.5) {
        name = 'yy_howl';
        squash = -0.07 * Math.exp(-(t - sh.hit) / 0.16) - 0.03 * beatKick(au, t, 0.25);
      }
    }
    puppetShadow(c, 'yy', YY_X, GROUND, { h: SZ * 1.1, alpha: 0.8 * en.alpha, color: '0,0,0' });
    drawPuppet(c, name, YY_X, GROUND, { h: SZ, scale: 1.1, spin: en.spin, alpha: en.alpha, squash });
  }

  /** 進場：從側面翻正（仙女棒的火花在腳邊）。還沒輪到回傳 null。 */
  private enter(t: number, delay: number, x: number, seed: number) {
    const e = puppetIn(t, this.ctx.start + delay, 0.42);
    if (e.alpha <= 0) return null;
    if (e.k < 1) {
      sparkHead(this.glow, x, GROUND - 6, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x, y: GROUND - 6 }), { rate: 50, life: 0.25, speed: 140, seed });
    }
    return e;
  }

  /** 箭在飛：從滿弓時圖上的箭，沿著很平的拋物線飛到靶上（一拍），後面拖一道訊號色的細線。 */
  private drawFlight(c: CanvasRenderingContext2D, t: number) {
    const sg = LIN.signal;
    for (const sh of this.shots) {
      if (t < sh.rel || t >= sh.hit) continue;
      const mid = { x: (this.tip.x + this.nock.x) / 2, y: (this.tip.y + this.nock.y) / 2 };
      const to = { x: sh.to.x - this.arrowLen * 0.3, y: sh.to.y };
      // 前段快、後段慢一點點（慢動作的那一拍）
      const u = ease.outCubic(clamp((t - sh.rel) / (sh.hit - sh.rel)));
      const hgt = 36;
      let prev: Pt | null = null;
      for (let k = 0; k <= 24; k++) {
        const q = arcAt(mid, to, hgt, (k / 24) * u);
        if (prev) { const w = k / 24; this.glow.seg2(prev.x, prev.y, q.x, q.y, 1 + 1.6 * w, [sg[0] * 2.4, sg[1] * 2.4, sg[2] * 2.4], 0.1 + 0.75 * w * w); }
        prev = q;
      }
      const q = arcAt(mid, to, hgt, u);
      this.arrow(c, q.x, q.y, q.ang, this.arrowLen, 1);
    }
  }

  /** 一支箭：(x, y) 是箭的中心、ang 方向；木桿、白羽毛、金屬箭頭。k = 露出來的長度比例（插在靶上時短一點）。 */
  private arrow(c: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, k: number) {
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    const half = len / 2;
    const back = -half, front = back + len * k;
    c.lineCap = 'round';
    c.strokeStyle = mixRgba('fur', 'bone', 0.3);
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(back, 0); c.lineTo(front, 0); c.stroke();
    if (k >= 0.999) {
      c.fillStyle = rgba('ash');
      c.beginPath(); c.moveTo(front + 12, 0); c.lineTo(front - 2, -5); c.lineTo(front - 2, 5); c.closePath(); c.fill();
    }
    c.fillStyle = rgba('bone', 0.92);
    for (const sgn of [-1, 1]) {
      c.beginPath(); c.moveTo(back + 2, 0); c.lineTo(back + 8, sgn * 9); c.lineTo(back + 30, sgn * 7); c.lineTo(back + 28, 0); c.closePath(); c.fill();
    }
    c.restore();
  }

  /** 射中之後：靶心變成愛心（第一支箭射中時長出來，之後每一支射中就跳一下）、靶環閃一圈、箭插在靶上抖、火花炸開。 */
  private drawHits(c: CanvasRenderingContext2D, t: number) {
    const T = TGT;
    const first = this.shots[0];
    if (!first || t < first.hit) return;
    let pulse = 0;
    for (const sh of this.shots) if (t >= sh.hit) pulse = Math.max(pulse, Math.exp(-(t - sh.hit) / 0.18));
    // 愛心：從金色的靶心長出來（橫向跟著靶面一起扁）
    const grow = ease.outBack(clamp((t - first.hit) / 0.35));
    c.save();
    c.translate(T.x, T.y);
    c.scale(T.sx, 1);
    c.fillStyle = rgba('signal', 0.95);
    c.beginPath(); c.arc(0, 0, T.r * 0.2 * (1 + 0.25 * grow), 0, Math.PI * 2); c.fill();
    drawHeart(c, 0, 0, T.r * 0.52 * grow * (1 + 0.16 * pulse));
    c.restore();
    // 閃一圈：射中的那一刻靶環一圈一圈往外亮
    const sg = LIN.signal;
    for (const sh of this.shots) {
      const d = t - sh.hit;
      if (d < 0 || d > 0.5) continue;
      const k = d / 0.5;
      const rr = T.r * (0.25 + 0.95 * ease.outCubic(k));
      const pts: Pt[] = [];
      for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push({ x: T.x + Math.cos(a) * rr * T.sx, y: T.y + Math.sin(a) * rr }); }
      this.glow.polyline(pts, 2.2, [sg[0] * 2.5, sg[1] * 2.5, sg[2] * 2.5], 0.8 * (1 - k));
      if (d < 0.3) {
        sparkParticles(this.glow, t, () => (t - sh.hit < 0.08 ? { x: sh.to.x, y: sh.to.y } : null), { rate: 400, life: 0.3, speed: 260, seed: 7 + this.shots.indexOf(sh) });
      }
    }
    // 插在靶上的箭：箭尾朝它飛來的方向（左邊）露出一大截，剛射中時抖一下
    const mid = { x: (this.tip.x + this.nock.x) / 2, y: (this.tip.y + this.nock.y) / 2 };
    for (const sh of this.shots) {
      if (t < sh.hit) continue;
      const to = { x: sh.to.x - this.arrowLen * 0.3, y: sh.to.y };
      const ang = arcAt(mid, to, 36, 1).ang;
      const d = t - sh.hit;
      const wob = 0.09 * Math.exp(-d / 0.3) * Math.sin(d * 46);
      const vis = 0.62 * this.arrowLen;
      const a = ang + wob;
      // 箭頭埋在靶裡：箭的中心往回退半個露出來的長度
      this.arrow(c, sh.to.x - Math.cos(a) * vis * 0.5, sh.to.y - Math.sin(a) * vis * 0.5, a, vis, 0.999);
    }
  }

  /**
   * 歌詞的三角旗：一條繩子橫過射箭場上方，一個字（英文一個字詞）掛一面旗；唱到的那面亮成訊號色、唱完紙白、還沒唱三成透明。
   * 旗子被風吹著慢慢晃，每拍一晃；太長就縮字（不小於 40），再不行就掛兩串。
   */
  private pennants(c: CanvasRenderingContext2D, line: Line, t: number, alpha: number) {
    if (alpha <= 0.01) return;
    const au = this.ctx.audio;
    const words = line.words.filter((w) => w.w.trim());
    if (!words.length) return;
    const avail = (FLAG.x1 - FLAG.x0) * 0.94;
    let size = this.lyricSize;
    const fam = F.archivo(100, this.msg ? 600 : 700);
    const measure = (sz: number) => {
      c.font = font(fam, sz);
      return words.map((w) => Math.max(sz * 1.05, c.measureText(w.w.trim()).width + sz * 0.42));
    };
    let ws = measure(size);
    const gap = () => size * 0.14;
    let total = ws.reduce((a, b) => a + b, 0) + gap() * (ws.length - 1);
    if (total > avail) { size = Math.max(40, Math.floor((size * avail) / total)); ws = measure(size); total = ws.reduce((a, b) => a + b, 0) + gap() * (ws.length - 1); }
    // 一串放不下：從最接近一半的地方分成兩串
    let rows: [number, number][] = [[0, words.length]];
    if (total > avail && words.length > 1) {
      let acc = 0, cut = 1;
      for (let i = 0; i < words.length; i++) { acc += ws[i]! + gap(); if (acc >= total / 2) { cut = Math.max(1, i + 1); break; } }
      rows = [[0, cut], [cut, words.length]];
    }
    const kick = beatKick(au, t, 0.3);
    c.save();
    c.globalAlpha = alpha;
    c.font = font(fam, size);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    rows.forEach(([a, b], ri) => {
      const dy = ri * size * 2.1;
      const yAt = (x: number) => { const u = (x - FLAG.x0) / (FLAG.x1 - FLAG.x0); return lerp(FLAG.y0, FLAG.y1, u) + FLAG.sag * 4 * u * (1 - u) + dy; };
      // 繩子
      c.strokeStyle = rgba('bone', 0.22); c.lineWidth = 1.5;
      c.beginPath();
      for (let x = FLAG.x0; x <= FLAG.x1; x += 20) (x === FLAG.x0 ? c.moveTo(x, yAt(x)) : c.lineTo(x, yAt(x)));
      c.stroke();
      const rowW = ws.slice(a, b).reduce((p, q) => p + q, 0) + gap() * (b - a - 1);
      let x = (FLAG.x0 + FLAG.x1) / 2 - rowW / 2;
      for (let i = a; i < b; i++) {
        const w = words[i]!, pw = ws[i]!;
        const cx = x + pw / 2;
        x += pw + gap();
        const y0 = yAt(cx), slope = Math.atan2(yAt(cx + 10) - yAt(cx - 10), 20);
        const p = Lyrics.wordProgress(w, t);
        // 風：每面旗自己的節奏，拍點上一晃；正在唱的那面甩得大一點
        const sway = 0.05 * Math.sin(t * 1.6 + i * 0.9) + 0.07 * kick * (i % 2 ? 1 : -1) + (p > 0 && p < 1 ? 0.06 * Math.sin(t * 9) : 0);
        c.save();
        c.translate(cx, y0);
        c.rotate(slope + sway);
        const hw = pw / 2 - 2, ph = size * 1.5;
        c.beginPath(); c.moveTo(-hw, 0); c.lineTo(hw, 0); c.lineTo(0, ph); c.closePath();
        c.fillStyle = p >= 1 ? mixRgba('ink2', 'bone', 0.14) : p > 0 ? mixRgba('ink2', 'signal', 0.18) : rgba('ink2', 0.85);
        c.fill();
        c.strokeStyle = rgba('bone', p > 0 ? 0.4 : 0.18); c.lineWidth = 1.2;
        c.stroke();
        c.fillStyle = p >= 1 ? rgba('bone', this.msg ? 0.86 : 0.96) : p > 0 ? rgba('signal') : rgba('bone', 0.3);
        c.fillText(w.w.trim(), 0, size * 0.52);
        c.restore();
      }
    });
    c.restore();
  }

  /** 沒有歌詞的時候（間奏、純音樂）：繩子上掛著一排空白的小旗，被風吹著晃。 */
  private bunting(c: CanvasRenderingContext2D, t: number, alpha: number) {
    const kick = beatKick(this.ctx.audio, t, 0.3);
    const yAt = (x: number) => { const u = (x - FLAG.x0) / (FLAG.x1 - FLAG.x0); return lerp(FLAG.y0, FLAG.y1, u) + FLAG.sag * 4 * u * (1 - u); };
    c.save();
    c.globalAlpha = alpha;
    c.strokeStyle = rgba('bone', 0.22); c.lineWidth = 1.5;
    c.beginPath();
    for (let x = FLAG.x0; x <= FLAG.x1; x += 20) (x === FLAG.x0 ? c.moveTo(x, yAt(x)) : c.lineTo(x, yAt(x)));
    c.stroke();
    for (let i = 0; i < 16; i++) {
      const x = lerp(FLAG.x0 + 60, FLAG.x1 - 60, i / 15);
      c.save();
      c.translate(x, yAt(x));
      c.rotate(0.05 * Math.sin(t * 1.6 + i * 0.9) + 0.07 * kick * (i % 2 ? 1 : -1));
      c.beginPath(); c.moveTo(-22, 0); c.lineTo(22, 0); c.lineTo(0, 52); c.closePath();
      c.fillStyle = i % 3 === 0 ? mixRgba('ink2', 'signal', 0.16) : rgba('ink2', 0.85);
      c.fill();
      c.strokeStyle = rgba('bone', 0.18); c.lineWidth = 1.2; c.stroke();
      c.restore();
    }
    c.restore();
  }

  /** 小黑板上的留言：第一拍起一個字一個字用粉筆寫上去，寫完署名淡入；在板面上垂直置中。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.board;
    const total = msgChars(n.fit);
    const per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    const done = this.msgT0 + total * per;
    const top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    drawNote(c, n, B.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('bone', 0.93) : rgba('bone', 0.55), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
