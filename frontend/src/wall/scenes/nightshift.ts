// 夜班護理站（暗、work）：半夜的護理站，天花板一條日光燈、檯面上一盞小檯燈。孟庭（護理服）推著工作車過來、在檯子前寫紀錄；
// 宣文穿連帽外套、提著宵夜（便當、珍珠奶茶）走進來探班。角色是 Codex 畫的紙偶（_puppet.ts，work 組）；場景、工作車、燈、鐘用程式畫。
// **不畫醫院名稱、血、針、病人**：牆上只有呼叫燈（沒有房號以外的字）、時鐘、交班白板。
//  - 照拍子：牆上的時鐘秒針一拍走一格；呼叫燈一拍亮一顆、排成往右跑的波浪；推車一拍一步。
//  - 小節線上的事（窗格短時往前擠、先砍掉推車那一段）：孟庭把車推到檯子邊 → 停下來寫紀錄 → 宣文提著宵夜走進來（一拍一步）→
//    **小節線上他把珍奶遞出去、孟庭轉過來驚喜地笑** → 下一個小節線孟庭捧著珍奶喝一口，兩人頭上冒愛心；
//    之後每個小節線宣文輪流比讚、站著（彈一下），頭上冒一顆愛心。
//  - **焦點是主打留言**：寫在右邊牆上的交班白板（白板筆的手寫字、署名；照「留言尺寸與版面比例標準 v2」：字 40～60、白板最大 620 × 420，
//    高度跟著留言長短）。白板上只有一行小小的「交班 · HANDOVER」。沒有留言時白板寫邀請、字淡，歌詞變主角。
//  - 歌詞在左上的跑馬燈字幕板上（訊號色的燈字，會發光），比留言小一級（標準 v2：40～52）。
//  - 光：天花板的日光燈照在護理站（冷白），檯燈一小團暖光；紙偶上亮下暗。鏡頭：慢慢推近白板與兩個人。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric } from './_motifs';
import { inkFor, inkLine, inkPoly, inkRect, inkEllipse, heartPop, type Note } from './_couple';
import { loadPuppets, drawCycle, drawPick, pick, puppetPoint, puppetShadow, puppetLight, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enter, writeNote, barsIn, at } from './_c7';

export const spec: PlateSpecDecl = { group: 'couple', family: 'work', paper: false, energy: [0.2, 0.8], bars: [4, 8] };

const FLOOR = 910;
const SZ = 560;
/** 護理站的檯子（右邊、白板底下）。 */
const DESK = { x: 1030, x1: 1350, top: FLOOR - 320 };
/** 交班白板：最大的範圍（上緣固定、高度跟著留言）與寫字的內距。 */
const BOARD = { x: 1170, y: 118, w: 620, h: 420 };
const PAD = { x: 40, top: 70, bottom: 30 };
/** 左上的跑馬燈字幕板（歌詞）與下面的一排呼叫燈、時鐘。 */
const LED = { x: 120, y: 132, w: 800, h: 150 };
const CLOCK = { x: 1010, y: 230, r: 58 };
/** 孟庭寫紀錄的位置、推車起點；宣文停下來的位置。 */
const OM_X = 900, PUSH_X0 = 470, AL_X = 560;
const POSES = ['mt_work_push_1', 'mt_work_push_2', 'mt_work_write', 'mt_work_happy', 'mt_work_sip',
  'xw_work_snack_1', 'xw_work_snack_2', 'xw_work_give', 'xw_work_idle_front', 'xw_work_thumb'];

/** 天花板的日光燈照在護理站的一團冷光、檯燈的一小團暖光；地板比牆亮一點點。 */
const ROOM = () => new FSPass(/* glsl */ `
  uniform float lamp;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK;
    vec2 q = (p - vec2(1060.0, 380.0)) / vec2(820.0, 560.0);
    col += C_BONE * 0.045 * exp(-dot(q, q) * 1.6);
    vec2 r = (p - vec2(${DESK.x + 90}.0, ${DESK.top - 60}.0)) / vec2(260.0, 200.0);
    col += mix(C_EMBER, C_BONE, 0.3) * 0.05 * lamp * exp(-dot(r, r) * 2.0);
    float fl = smoothstep(${FLOOR - 2}.0, ${FLOOR + 2}.0, p.y);
    col += C_BONE * 0.014 * fl * (1.0 - 0.6 * smoothstep(${FLOOR}.0, ${H}.0, p.y));
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { lamp: { value: 1 } });

export default class Nightshift extends Scene {
  room = shared('nightshift.room', ROOM);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  board = { ...BOARD };
  lyricSize = 52;
  /** 事件：推車（-1 = 沒有這一段）、開始寫、宣文開始走、遞珍奶、喝。 */
  tPush = -1;
  tWrite = 0;
  tWalk = 0;
  tGive = 0;
  tSip = -1;
  omKeys: [number, string][] = [];
  /** 喝了之後每個小節線：宣文輪流比讚、站著，頭上冒一顆愛心（窗格長時後半段也一直有事）。 */
  after: number[] = [];
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('交班 · HANDOVER一位賓客（值班中）' + INVITE);
    this.track(await loadPuppets(POSES));
    const s = this.ctx.start;
    const bars = barsIn(au, s, this.ctx.end, 0.5);
    const n = bars.length;
    // 夠長：推車一小節 → 寫 → 宣文走一小節 → 遞 → 喝；短的先砍推車、宣文一開始就在走
    const i0 = n >= 6 ? 2 : n >= 3 ? 1 : 0;
    this.tPush = n >= 6 ? s + 0.4 : -1;
    this.tWrite = n >= 6 ? at(bars, 0) : s;
    this.tGive = at(bars, i0 + (n >= 6 ? 1 : 0));
    this.tSip = n >= 2 ? at(bars, Math.min(n - 1, i0 + (n >= 6 ? 2 : 1))) : -1;
    if (this.tSip >= 0 && this.tSip <= this.tGive) this.tSip = -1;
    const bp = au.beatPeriod(this.tGive);
    this.tWalk = this.tGive - bp * 4;
    this.omKeys = [[-1e9, this.tPush > 0 ? 'mt_work_push_1' : 'mt_work_write'], [this.tWrite, 'mt_work_write'], [this.tGive, 'mt_work_happy']];
    if (this.tSip > 0) this.omKeys.push([this.tSip, 'mt_work_sip']);
    this.after = this.tSip > 0 ? bars.filter((b) => b > this.tSip + 0.05) : [];
    // 白板上的留言：標準 v2 的字級；白板的寬高跟著留言（靠右）
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, hmax = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const bw = Math.min(BOARD.w, Math.max(440, tightenNote(c, this.note, 300) + PAD.x * 2));
    const bh = Math.min(BOARD.h, Math.max(260, PAD.top + this.note.height + PAD.bottom + 14));
    this.board = { x: BOARD.x + BOARD.w - bw, y: BOARD.y, w: bw, h: bh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = Math.min(s + 0.9, at(bars, 0));
    this.drawBackground();
  }

  /** 不會動的：地板、檯子、檯燈、白板、跑馬燈板與呼叫燈的外框、時鐘的鐘面（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ink = inkFor(false, { fill: rgba('ink2') });
    const line = (a: number) => rgba('bone', a);
    c.strokeStyle = line(0.1); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(60, FLOOR); c.lineTo(1860, FLOOR); c.stroke();
    // 天花板的日光燈（一條細長的燈管，發光在 render 裡）
    c.fillStyle = mixRgba('ink2', 'bone', 0.25);
    c.fillRect(760, 64, 640, 10);
    // 檯子：檯面、前面板、上面一層高一點的擋板
    const D = DESK;
    c.fillStyle = mixRgba('ink2', 'bone', 0.06);
    c.fillRect(D.x, D.top, D.x1 - D.x, FLOOR - D.top);
    inkRect(c, D.x, D.top, D.x1 - D.x, FLOOR - D.top, { ink, w: 0.8, t: 0, seed: 3, color: line(0.35) });
    inkRect(c, D.x - 14, D.top - 16, D.x1 - D.x + 28, 16, { ink, w: 0.9, t: 0, seed: 4, color: line(0.45), fill: mixRgba('ink2', 'bone', 0.1) });
    for (let k = 1; k < 3; k++) inkLine(c, [{ x: D.x + ((D.x1 - D.x) * k) / 3, y: D.top + 20 }, { x: D.x + ((D.x1 - D.x) * k) / 3, y: FLOOR - 16 }], { ink, w: 0.4, t: 0, seed: 5 + k, color: line(0.15) });
    // 檯燈（左邊，右邊上面是白板）與筆筒
    const lx = D.x + 70;
    inkLine(c, [{ x: lx, y: D.top - 16 }, { x: lx - 20, y: D.top - 90 }, { x: lx + 30, y: D.top - 130 }], { ink, w: 1.1, t: 0, seed: 9, color: line(0.4) });
    inkPoly(c, [{ x: lx + 10, y: D.top - 150 }, { x: lx + 60, y: D.top - 130 }, { x: lx + 44, y: D.top - 104 }], { ink, w: 0.8, t: 0, seed: 10, fill: rgba('ink2'), color: line(0.45) });
    inkRect(c, D.x1 - 70, D.top - 58, 34, 42, { ink, w: 0.7, t: 0, seed: 11, fill: rgba('ink2'), color: line(0.35) });
    for (const dx of [6, 14, 24]) inkLine(c, [{ x: D.x1 - 70 + dx, y: D.top - 58 }, { x: D.x1 - 72 + dx, y: D.top - 86 }], { ink, w: 0.6, t: 0, seed: 12 + dx, color: line(0.35) });
    // 白板：金屬框、板面（被日光燈照著、比牆亮）、下緣的筆槽；上面一行小小的標題
    const B = this.board;
    c.fillStyle = rgba('ink', 0.6);
    c.fillRect(B.x + 10, B.y + 12, B.w, B.h);
    const g = c.createLinearGradient(0, B.y, 0, B.y + B.h);
    g.addColorStop(0, mixRgba('ink2', 'bone', 0.8));
    g.addColorStop(1, mixRgba('ink2', 'bone', 0.68));
    c.fillStyle = g;
    c.fillRect(B.x, B.y, B.w, B.h);
    c.strokeStyle = mixRgba('ink2', 'bone', 0.45); c.lineWidth = 6;
    c.strokeRect(B.x - 3, B.y - 3, B.w + 6, B.h + 6);
    c.fillStyle = mixRgba('ink2', 'bone', 0.4);
    c.fillRect(B.x + 30, B.y + B.h + 4, B.w - 60, 10);
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('ink', 0.5);
    c.fillText('交班 · HANDOVER', B.x + PAD.x, B.y + 44);
    c.letterSpacing = '0px';
    // 跑馬燈板：深色的板子、很淡的點陣
    const E = LED;
    c.fillStyle = rgba('ink2');
    c.fillRect(E.x, E.y, E.w, E.h);
    c.strokeStyle = line(0.2); c.lineWidth = 1.5;
    c.strokeRect(E.x, E.y, E.w, E.h);
    c.fillStyle = line(0.035);
    for (let y = E.y + 10; y < E.y + E.h - 4; y += 9) for (let x = E.x + 10; x < E.x + E.w - 4; x += 9) c.fillRect(x, y, 3, 3);
    // 呼叫燈：一排八顆（燈罩），亮的部分在 render 裡
    for (let i = 0; i < 8; i++) inkEllipse(c, E.x + 50 + i * 100, E.y + E.h + 44, 16, 16, 0, { ink, w: 0.7, t: 0, seed: 20 + i, color: line(0.3), fill: rgba('ink2') });
    // 時鐘：鐘面、刻度（指針在 render 裡）
    const K = CLOCK;
    inkEllipse(c, K.x, K.y, K.r, K.r, 0, { ink, w: 1, t: 0, seed: 30, color: line(0.5), fill: mixRgba('ink2', 'bone', 0.12) });
    c.strokeStyle = line(0.4); c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.moveTo(K.x + Math.cos(a) * K.r * 0.8, K.y + Math.sin(a) * K.r * 0.8); c.lineTo(K.x + Math.cos(a) * K.r * 0.9, K.y + Math.sin(a) * K.r * 0.9); }
    c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    const bp = au.beatPeriod(t);
    this.room.u.lamp!.value = 0.9 + 0.1 * Math.sin(t * 1.3);
    this.room.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 人（這一層最先畫：打光只染紙偶）＋工作車
    this.drawPeople(c, t, bp);
    puppetLight(c, [300, FLOOR - SZ * 1.2, 900, SZ * 1.2 + 30], rgba('ink', 0.05), rgba('ink', 0.5));
    this.drawCart(c, t, bp);

    this.drawWall(c, t);
    this.drawLyric(c, t);
    this.drawMessage(c, t);

    // 日光燈：一條很淡的發光
    const sg = LIN.bone;
    this.glow.seg2(770, 69, 1390, 69, 4, [sg[0] * 1.6, sg[1] * 1.6, sg[2] * 1.6], 0.6);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const cx = 1100, cy = 420;
    return { bloom: 0.6, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(cx - W / 2) * 0.03 * push, -(cy - H / 2) * 0.03 * push] };
  }

  /** 孟庭：推車（一拍一步）→ 寫紀錄（每拍筆動一下）→ 轉過來驚喜 → 喝珍奶。宣文：提著宵夜走進來 → 遞 → 站著看她喝。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const kick = beatKick(au, t, 0.22);
    // 孟庭
    const pushing = this.tPush > 0 && t < this.tWrite;
    const ox = pushing ? lerp(PUSH_X0, OM_X, ease.inOutQuad(clamp((t - this.tPush) / (this.tWrite - this.tPush)))) : OM_X;
    const eo = enter(this.glow, t, s + 0.05, ox, FLOOR - 6, 1);
    if (eo) {
      const name = pick(this.omKeys, t);
      const surprise = t >= this.tGive ? 0.05 * Math.exp(-(t - this.tGive) / 0.14) : 0;
      const o: PuppetOpts = { h: SZ, spin: eo.spin, alpha: eo.alpha, pivot: 0.2, squash: breathe(t, 0.008, 3.1) - surprise };
      if (pushing) {
        const b = hop(au.beatAt(t), 1) * 6;
        puppetShadow(c, 'mt', ox, FLOOR, { h: SZ, lift: b, alpha: 0.7 * eo.alpha, color: '0,0,0' });
        drawCycle(c, au, t, ['mt_work_push_1', 'mt_work_push_2'], 1, ox, FLOOR - b, o);
      } else {
        puppetShadow(c, 'mt', ox, FLOOR, { h: SZ, alpha: 0.7 * eo.alpha, color: '0,0,0' });
        // 寫紀錄：每拍筆動一下（身體跟著點一下）；喝的時候跟著拍子輕輕晃
        if (name === 'mt_work_write') o.rot = 0.012 * kick;
        if (name === 'mt_work_sip') o.rot = 0.02 * Math.sin(au.beatAt(t) * Math.PI);
        drawPick(c, this.omKeys, t, ox, FLOOR, o);
      }
    }
    // 宣文：走進來（一拍一步）→ 停下來遞珍奶（小節線）→ 站著（每拍點頭）
    if (t >= this.tWalk) {
      const walking = t < this.tGive;
      const x = walking ? lerp(-120, AL_X, clamp((t - this.tWalk) / (this.tGive - this.tWalk))) : AL_X;
      const b = walking ? hop(au.beatAt(t), 1) * 7 : 0;
      puppetShadow(c, 'xw', x, FLOOR, { h: SZ, lift: b, alpha: 0.7, color: '0,0,0' });
      if (walking) drawCycle(c, au, t, ['xw_work_snack_1', 'xw_work_snack_2'], 1, x, FLOOR - b, { h: SZ, squash: breathe(t, 0.008, 2.9) });
      else {
        const keys: [number, string][] = [[-1e9, 'xw_work_give']];
        if (this.tSip > 0) keys.push([this.tSip, 'xw_work_idle_front']);
        this.after.forEach((b, i) => keys.push([b, i % 2 ? 'xw_work_idle_front' : 'xw_work_thumb']));
        const reach = Math.exp(-(t - this.tGive) / 0.2);
        let pop = 0;
        for (const b of this.after) if (t >= b) pop = 0.04 * Math.exp(-(t - b) / 0.15);
        drawPick(c, keys, t, x + 10 * reach, FLOOR, { h: SZ, pivot: 0.2, rot: 0.03 * reach - 0.015 * kick, squash: 0.012 * kick + breathe(t, 0.008, 3.2, 0.5) - pop });
      }
    }
    // 遞珍奶與喝的那一刻：兩人頭上冒愛心
    for (const [tt, x] of [[this.tGive, (AL_X + OM_X) / 2], [this.tSip, OM_X - 20], ...this.after.map((b, i) => [b, i % 2 ? OM_X - 20 : AL_X + 20] as const)]) {
      if (tt < 0) continue;
      heartPop(c, x, FLOOR - SZ * 1.08, 34, (t - tt) / 1.2);
    }
  }

  /** 工作車：推車的時候跟著孟庭的手（把手在圖上的 handle 點），停好之後停在檯子邊。 */
  private drawCart(c: CanvasRenderingContext2D, t: number, _bp: number) {
    const pushing = this.tPush > 0 && t < this.tWrite;
    const ox = pushing ? lerp(PUSH_X0, OM_X, ease.inOutQuad(clamp((t - this.tPush) / (this.tWrite - this.tPush)))) : OM_X;
    // 把手：圖上兩個拳頭（近的 handle、遠的 handle2）握著的一根橫桿，側面看是斜斜的一小段
    const hand = puppetPoint('mt_work_push_1', 'handle', ox, FLOOR, { h: SZ }) ?? { x: ox + SZ * 0.22, y: FLOOR - SZ * 0.5 };
    const hand2 = puppetPoint('mt_work_push_1', 'handle2', ox, FLOOR, { h: SZ }) ?? { x: hand.x - 30, y: hand.y + 10 };
    const x0 = hand.x + 6, w = 190, top = hand.y + 8;
    const ink = inkFor(false, { fill: rgba('ink2') });
    const line = (a: number) => rgba('bone', a);
    const a = this.tPush > 0 ? 1 : prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    c.save();
    c.globalAlpha = a;
    c.fillStyle = mixRgba('ink2', 'bone', 0.12);
    c.fillRect(x0, top, w, FLOOR - 30 - top);
    inkRect(c, x0, top, w, FLOOR - 30 - top, { ink, w: 0.8, t: 0, seed: 40, color: line(0.45) });
    for (let k = 1; k < 4; k++) {
      const y = top + ((FLOOR - 30 - top) * k) / 4;
      inkLine(c, [{ x: x0, y }, { x: x0 + w, y }], { ink, w: 0.5, t: 0, seed: 41 + k, color: line(0.25) });
      c.fillStyle = line(0.4); c.fillRect(x0 + w / 2 - 14, y - ((FLOOR - 30 - top) / 8) - 2, 28, 4);
    }
    // 把手（接在孟庭的手上）、上面放一盒面紙、一疊紀錄
    inkLine(c, [{ x: hand2.x - 6, y: hand2.y + 2 }, { x: hand.x + 4, y: hand.y - 1 }], { ink, w: 1.3, t: 0, seed: 44, color: line(0.6) });
    inkLine(c, [{ x: hand.x + 2, y: hand.y }, { x: x0 + 10, y: hand.y + 4 }, { x: x0 + 10, y: top + 10 }], { ink, w: 1.1, t: 0, seed: 45, color: line(0.55) });
    inkRect(c, x0 + 20, top - 34, 70, 34, { ink, w: 0.6, t: 0, seed: 46, fill: mixRgba('ink2', 'bone', 0.3), color: line(0.4) });
    inkRect(c, x0 + 110, top - 14, 60, 14, { ink, w: 0.6, t: 0, seed: 47, fill: mixRgba('ink2', 'bone', 0.5), color: line(0.4) });
    // 輪子：推的時候轉
    for (const wx of [x0 + 18, x0 + w - 18]) {
      inkEllipse(c, wx, FLOOR - 14, 13, 13, 0, { ink, w: 0.8, t: 0, seed: wx, color: line(0.5), fill: rgba('ink') });
      const ang = (ox / 13) % (Math.PI * 2);
      c.strokeStyle = line(0.35); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(wx, FLOOR - 14); c.lineTo(wx + Math.cos(ang) * 10, FLOOR - 14 + Math.sin(ang) * 10); c.stroke();
    }
    c.restore();
  }

  /** 牆上會動的：呼叫燈一拍亮一顆往右跑、時鐘的秒針一拍走一格（02:13）、跑馬燈板的邊框燈。 */
  private drawWall(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, E = LED, K = CLOCK;
    const b = au.beatAt(t), bi = Math.floor(b), kick = beatKick(au, t, 0.3);
    const sg = LIN.signal;
    for (let i = 0; i < 8; i++) {
      const on = ((bi % 8) + 8) % 8 === i ? kick : 0;
      const tail = Math.max(0, 1 - ((((bi - i) % 8) + 8) % 8) / 3) * 0.3;
      const k = Math.max(on, tail * (1 - on));
      const x = E.x + 50 + i * 100, y = E.y + E.h + 44;
      c.fillStyle = mixRgba('ink2', 'signal', 0.25 + 0.75 * k);
      c.beginPath(); c.arc(x, y, 13, 0, Math.PI * 2); c.fill();
      if (k > 0.2) this.glow.seg2(x, y, x + 0.01, y, 22, [sg[0] * 1.8 * k, sg[1] * 1.8 * k, sg[2] * 1.8 * k], 0.5 * k);
    }
    // 時鐘：時針、分針停在 2:13，秒針一拍走一格（拍點上一頓）
    const hand = (a: number, len: number, w: number, col: string) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(K.x, K.y); c.lineTo(K.x + Math.sin(a) * len, K.y - Math.cos(a) * len); c.stroke(); };
    hand(((2 + 13 / 60) / 12) * Math.PI * 2, K.r * 0.5, 4, rgba('bone', 0.7));
    hand((13 / 60) * Math.PI * 2, K.r * 0.72, 3, rgba('bone', 0.7));
    const sec = bi + ease.outBack(clamp((t - au.timeOfBeat(bi)) / 0.12));
    hand((sec / 60) * Math.PI * 2, K.r * 0.78, 1.5, rgba('signal', 0.9));
  }

  /** 跑馬燈板上的歌詞：訊號色的燈字（照跟唱規則），間奏時一行淡淡的「（值班中）」。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    const E = LED;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: E.w - 60, unsung: rgba('bone', 0.2), sung: rgba('bone', big ? 0.9 : 0.8), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.translate(E.x + 30, E.y + (E.h - lay.height) / 2 + lay.size * 0.86);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      c.font = font(F.hei(500), 34);
      c.fillStyle = rgba('bone', 0.3);
      c.fillText('（值班中）', E.x + 30, E.y + E.h / 2 + 12);
    }
    c.restore();
  }

  /** 白板上的留言（白板筆的手寫字，深色）：一個字一個字寫上去，寫完署名淡入；在標題下面垂直置中。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.board;
    const top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    writeNote(c, n, B.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), t, this.msgT0, { msg: !!this.msg, color: rgba('ink', 0.92), faint: rgba('ink', 0.55), sig: rgba('ink', 0.7) });
    c.restore();
  }
}

