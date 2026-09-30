// 狗狗游泳（亮、dog、雙語）：陽光下的狗狗泳池。宣文在池邊丟網球，元元游最快去咬、QQ 在後面追，芃芃套著游泳圈在旁邊悠哉地轉圈；
// 孟庭在池邊拍手加油。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 一輪兩小節：小節線上宣文出手（throw_1 往後拉 → throw_2 丟出去），球飛一拍落水（水花、漣漪），**第二拍元元咬到球**（落在拍點），
//    QQ 慢半拍追到撲空；元元叼著球游回池邊，第六拍半把球交給蹲下來的宣文，下一個小節線再丟。孟庭每拍拍手，元元咬到球的那一下歡呼。
//    芃芃套著游泳圈在右邊漂，每個小節線慢慢轉身一次、拍點上划一下水。
//  - 狗在水裡：紙偶先畫在暫存畫布上，水面以下用 destination-out 淡掉（看得到一點點水裡的身體），水面一條亮線、拍點上一圈漣漪。
//  - **兩行歌詞寫在牆上的泳池告示牌**（右上）：中文大字、原文小一號在正下方（drawLyric 自動畫）；沒有翻譯時只有中文、在牌子裡置中。
//  - **焦點是主打留言**：寫在漂在水上的充氣浮板上（左下，粉白條紋的邊），拍點上輕輕起伏；照「留言尺寸與版面比例標準 v2」：
//    字 40～60、浮板最大 700 × 330，高度跟著留言。字先畫在暫存畫布上，浮板晃的時候整張貼上去。沒有留言時浮板上寫邀請。
//  - 水用 shader 畫（淡漸層、會動的水光），大鼓時水光亮一點。鏡頭慢慢推近狗。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, sparkHead, sparkParticles } from './_motifs';
import { tennisBall, arcAt, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetShadow, puppetIn, puppetPoint, puppetBox, breathe, beatKick, landSquash, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { NoteSheet, writeTiming, INVITE } from './_d4';
import type { Lyrics } from '../engine/lyrics';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'dog', paper: true, energy: [0.35, 1], bars: [4, 8] };

/** 狗是主角：放大一點（三隻用同一個倍數，元元比博美大是 PUPPET_H 換算出來的）。 */
const SZ = 440, DOG_S = 1.5;
/** 池邊（人站的地方）與水面開始的地方。 */
const DECK = 648, WATER = 662;
/** 牆上的告示牌（歌詞）與牌子裡寫字的範圍。 */
const SIGN = { x: 1010, y: 84, w: 800, h: 320 };
const SIGN_TOP = 72, SIGN_BOTTOM = 26;
/** 浮板（留言）：中心、最大寬高（標準 v2）與寫字的內距（邊是充氣的厚圈）。 */
const FLOAT = { cx: 440, cy: 860, w: 700, h: 330 };
const FPAD = { x: 66, top: 54, bottom: 50 };
/** 人：宣文在池邊丟球（靠近水），孟庭在後面拍手。 */
const XW_X = 600, MT_X = 270;
/** 球落水的地方、元元把球交回來的地方（池邊宣文腳前的水裡）。 */
const TOY = { x: 1250, y: 700 };
const DROP = { x: 700, y: 700 };
/** 三隻狗平常在哪（水面的 y）；三隻用同一個場景尺度。 */
const REST: Record<Who, Pt> = { yy: { x: 930, y: 738 }, qq: { x: 880, y: 866 }, pp: { x: 1190, y: 872 } };
/** 泡在水裡的部分佔身高的比例：水面在背上（太深的話博美只剩一顆頭，遠處認不出來）。 */
const DEPTH = 0.42;
const SWIM: Record<Who, string> = { yy: 'yy_d4_swim', qq: 'qq_d4_swim', pp: 'pp_d4_swim' };
const SPRITES = ['xw_throw_1', 'xw_throw_2', 'xw_fetch_take', 'xw_idle_front', 'mt_fetch_clap', 'mt_cheer', ...Object.values(SWIM)];

type Who = 'yy' | 'qq' | 'pp';
interface Round { rel: number; land: number; grab: number; home: number; give: number; next: number }

/** 泳池的水：上淺下深的藍、會慢慢流動的水光（大鼓時亮一點）。牆與池邊由 Canvas 圖層蓋在上面。 */
const POOL = () => new FSPass(/* glsl */ `
  uniform float t;
  uniform float kick;
  uniform vec3 wA;
  uniform vec3 wB;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float d = clamp((p.y - ${WATER}.0) / 418.0, 0.0, 1.0);
    vec3 col = mix(wA, wB, pow(d, 0.8));
    vec2 q = p / vec2(96.0, 34.0 + 30.0 * d);
    float n = snoise(q + vec2(t * 0.22, t * 0.07)) + 0.55 * snoise(q * 2.1 - vec2(t * 0.18, -t * 0.05));
    float caus = pow(clamp(1.0 - abs(n) * 0.85, 0.0, 1.0), 9.0);
    col += C_BONE * caus * (0.09 + 0.06 * kick) * (1.0 - 0.45 * d);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, kick: { value: 0 }, wA: { value: new THREE.Vector3() }, wB: { value: new THREE.Vector3() } });

export default class DogSwim extends Scene {
  pool = shared('dogswim.pool', POOL);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  sheet: NoteSheet = new NoteSheet(FLOAT.w, FLOAT.h);
  rounds: Round[] = [];
  xwKeys: [number, string][] = [];
  release: Pt = { x: 0, y: 0 };
  lyricSize = 52;
  /** 元元的嘴在身體（水面上的 x、水面 y）前面多遠：咬球、交球時讓嘴對到球，不是身體中心。 */
  yyMouth: Pt = { x: 150, y: -60 };
  /** 這一格元元的嘴在畫面上的哪裡（drawDog 畫元元時記下來，叼著的球畫在這裡）。 */
  mouthNow: Pt = { x: 0, y: 0 };
  /** 暫存畫布：狗先畫在這裡，水面以下淡掉再貼回去。 */
  dip = new OffscreenCanvas(700, 560);

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + 'POOL RULES 泳池公告');
    this.track(await loadPuppets(SPRITES));
    this.release = puppetPoint('xw_throw_2', 'ball', XW_X, DECK, { h: SZ }) ?? { x: XW_X + 120, y: DECK - 380 };
    {
      const box = puppetBox(SWIM.yy, 0, 0, { h: SZ, scale: DOG_S });
      const m = puppetPoint(SWIM.yy, 'mouth', 0, box[3] * DEPTH, { h: SZ, scale: DOG_S });
      if (m) this.yyMouth = { x: m.x, y: m.y };
    }
    // 一輪兩小節：小節線出手、一拍後落水、第二拍元元咬到、第五拍游回池邊、第六拍半交球、第八拍下一輪
    let rel = barAfter(au, this.ctx.start + 0.7);
    if (this.ctx.end - rel < au.beatPeriod(rel) * 3) rel = au.nextBeat(this.ctx.start + 0.5);
    for (let k = 0; k < 20 && rel < this.ctx.end + 0.5; k++) {
      const b = au.beatAt(rel);
      const T = (x: number) => au.timeOfBeat(b + x);
      this.rounds.push({ rel, land: T(1), grab: T(2), home: T(5), give: T(6.5), next: T(8) });
      rel = T(8);
    }
    // 宣文：拿著球等 → 出手前一拍往後拉 → 出手 → 看（站著）→ 交球時蹲下接 → 往後拉……
    const ks: [number, string][] = [[-1e9, 'xw_throw_1']];
    for (const r of this.rounds) {
      const bp = au.beatPeriod(r.rel);
      ks.push([r.rel, 'xw_throw_2'], [r.rel + bp * 1.2, 'xw_idle_front'], [r.give - bp * 0.3, 'xw_fetch_take'], [r.next - bp, 'xw_throw_1']);
    }
    this.xwKeys = ks;
    // 浮板上的留言：標準 v2 的字級；浮板的寬高跟著留言
    const c = this.fg.ctx;
    const w = FLOAT.w - FPAD.x * 2, hmax = FLOAT.h - FPAD.top - FPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.6, { max: 44 });
    const fw = Math.min(FLOAT.w, Math.max(tightenNote(c, this.note, 360) + FPAD.x * 2, 460));
    const fh = Math.min(FLOAT.h, Math.max(220, FPAD.top + this.note.height + FPAD.bottom + 6));
    this.sheet = new NoteSheet(fw, fh, 26);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：牆（上面一條條遮陽棚的影子）、牆腳的磁磚、池邊、池壁、左邊的扶梯、牆上的救生圈、告示牌的牌子。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 牆：紙色，上面亮
    const g = c.createLinearGradient(0, 0, 0, DECK);
    g.addColorStop(0, mixRgba('paper', 'bone', 0.5));
    g.addColorStop(1, mixRgba('paper', 'sepia', 0.06));
    c.fillStyle = g;
    c.fillRect(0, 0, W, DECK);
    // 牆腳一排藍白磁磚
    const tileY = 520, ts = 32;
    for (let x = 0, i = 0; x < W; x += ts, i++) {
      for (let r = 0; r < 3; r++) {
        c.fillStyle = (i + r) % 2 ? mixRgba('shirtblue', 'paper', 0.25) : mixRgba('bone', 'paper', 0.3);
        c.fillRect(x, tileY + r * ts * 1.0 - 8, ts - 2, ts - 2);
      }
    }
    // 池邊：淺色的地磚（往前越來越寬的縫）與圓圓的池緣
    c.fillStyle = mixRgba('bone', 'paper', 0.2);
    c.fillRect(0, tileY + 88, W, DECK - tileY - 88 + 4);
    c.strokeStyle = rgba('sepia', 0.1);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let x = -200; x < W + 200; x += 110) { c.moveTo(x + 40, tileY + 90); c.lineTo(x, DECK); }
    c.stroke();
    const rim = c.createLinearGradient(0, DECK - 4, 0, WATER + 4);
    rim.addColorStop(0, rgba('bone'));
    rim.addColorStop(1, mixRgba('bone', 'sepia', 0.18));
    c.fillStyle = rim;
    c.fillRect(0, DECK - 4, W, WATER - DECK + 8);
    c.fillStyle = rgba('sepia', 0.14);
    c.fillRect(0, WATER + 4, W, 3);
    // 左邊的扶梯（兩根彎把手伸進水裡）
    c.strokeStyle = mixRgba('bone', 'sepia', 0.25);
    c.lineWidth = 7;
    c.lineCap = 'round';
    for (const x of [118, 176]) { c.beginPath(); c.moveTo(x - 30, DECK - 10); c.quadraticCurveTo(x - 30, DECK - 70, x, DECK - 70); c.quadraticCurveTo(x + 18, DECK - 70, x + 18, DECK + 10); c.lineTo(x + 18, DECK + 110); c.stroke(); }
    // 牆上的救生圈（紅白四段）
    const lx = 860, ly = 300, R = 62, r = 34;
    for (let k = 0; k < 8; k++) {
      c.fillStyle = k % 2 ? rgba('bone') : mixRgba('collar', 'paper', 0.15);
      c.beginPath(); c.arc(lx, ly, R, (k / 8) * Math.PI * 2, ((k + 1) / 8) * Math.PI * 2); c.arc(lx, ly, r, ((k + 1) / 8) * Math.PI * 2, (k / 8) * Math.PI * 2, true); c.closePath(); c.fill();
    }
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.2;
    c.beginPath(); c.arc(lx, ly, R, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(lx, ly, r, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = rgba('sepia', 0.45); c.lineWidth = 2;
    c.beginPath(); c.moveTo(lx, ly - R - 30); c.lineTo(lx, ly - R); c.stroke();
    // 池邊右邊一支條紋陽傘（傘面在告示牌下面）
    const px = 1640, pt = 452;
    c.strokeStyle = mixRgba('bone', 'sepia', 0.3); c.lineWidth = 6;
    c.beginPath(); c.moveTo(px, pt); c.lineTo(px, DECK - 6); c.stroke();
    // 傘面：頂點到前緣（一道往下彎的弧）分成八片，藍白相間
    const edge = (u: number) => ({ x: px - 200 + 400 * u, y: pt + 58 + 22 * Math.sin(Math.PI * u) });
    for (let k = 0; k < 8; k++) {
      const a0 = edge(k / 8), a1 = edge((k + 1) / 8);
      c.fillStyle = k % 2 ? rgba('bone') : mixRgba('leash', 'paper', 0.3);
      c.beginPath(); c.moveTo(px, pt); c.lineTo(a0.x, a0.y); c.lineTo(a1.x, a1.y); c.closePath(); c.fill();
    }
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1.2;
    c.beginPath(); for (let k = 0; k <= 16; k++) { const q = edge(k / 16); if (k) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); } c.stroke();
    // 告示牌：白底、藍邊、上面一條小標題（小字、淡）
    const S = SIGN;
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(S.x + 8, S.y + 10, S.w, S.h);
    c.fillStyle = rgba('bone');
    c.fillRect(S.x, S.y, S.w, S.h);
    c.strokeStyle = rgba('leash');
    c.lineWidth = 6;
    c.strokeRect(S.x + 10, S.y + 10, S.w - 20, S.h - 20);
    c.fillStyle = rgba('leash');
    c.fillRect(S.x + 10, S.y + 10, S.w - 20, 40);
    c.font = font(F.mono(600), 18);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('bone', 0.95);
    c.fillText('POOL RULES', S.x + 34, S.y + 37);
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '4px';
    c.textAlign = 'right';
    c.fillText('泳池公告', S.x + S.w - 34, S.y + 37);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
    for (const [x, y] of [[S.x + 22, S.y + S.h - 22], [S.x + S.w - 22, S.y + S.h - 22]]) { c.fillStyle = rgba('sepia', 0.35); c.beginPath(); c.arc(x!, y!, 4, 0, Math.PI * 2); c.fill(); }
    L.upload();
  }

  /** 浮板的底：粉白條紋的充氣厚邊、奶油色的板面、左上一道亮光。 */
  private paintFloat = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const R = 34, B = 26;
    const rr = (x0: number, y0: number, w0: number, h0: number, r: number) => { c.beginPath(); c.roundRect(x0, y0, w0, h0, r); };
    // 充氣的邊：一段粉、一段白
    c.save();
    rr(x, y, w, h, R); c.clip();
    const seg = 54;
    for (let s = -h; s < w + h; s += seg) {
      c.fillStyle = Math.round(s / seg) % 2 ? mixRgba('rose', 'bone', 0.35) : rgba('bone');
      c.beginPath(); c.moveTo(x + s, y); c.lineTo(x + s + seg, y); c.lineTo(x + s + seg - h * 0.35, y + h); c.lineTo(x + s - h * 0.35, y + h); c.closePath(); c.fill();
    }
    c.restore();
    // 板面
    rr(x + B, y + B, w - B * 2, h - B * 2, R * 0.6);
    c.fillStyle = mixRgba('cream', 'bone', 0.55);
    c.fill();
    c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1.5; c.stroke();
    rr(x, y, w, h, R);
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 2; c.stroke();
    // 塑膠的亮光
    c.strokeStyle = rgba('bone', 0.9); c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + 40, y + 12); c.lineTo(x + Math.min(200, w * 0.35), y + 12); c.stroke();
  };

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    const sb = LIN.shirtblue, pa = LIN.paper, le = LIN.leash;
    this.pool.u.t!.value = t - s;
    this.pool.u.kick!.value = f.a.kick;
    (this.pool.u.wA!.value as THREE.Vector3).set(lerp(sb[0], pa[0], 0.3), lerp(sb[1], pa[1], 0.3), lerp(sb[2], pa[2], 0.3));
    (this.pool.u.wB!.value as THREE.Vector3).set(lerp(sb[0], le[0], 0.55) * 0.9, lerp(sb[1], le[1], 0.55) * 0.9, lerp(sb[2], le[2], 0.55) * 0.95);
    this.pool.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);
    const r = this.roundAt(t);

    // 告示牌上的兩行歌詞
    this.drawSign(c, t, lyrics, rv);
    // 人（池邊）
    this.drawPeople(c, t, r, bp);
    // 浮板（左下，留言）
    this.drawFloat(c, t);
    // 狗（遠的先畫）
    const dogs = (['yy', 'qq', 'pp'] as Who[]).map((w) => ({ w, p: this.dogPos(w, t, r) })).sort((a, b) => a.p.y - b.p.y);
    for (const d of dogs) this.drawDog(c, t, d.w, d.p, r, bp);
    // 球：飛行中、漂在水上、叼在元元嘴裡、交回宣文手上
    this.drawBall(c, t, r, bp);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.25, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.04, zoom: 1 + 0.03 * push, shake: [-(1000 - W / 2) * 0.03 * push, -(640 - H / 2) * 0.03 * push] };
  }

  /** 這一格屬於哪一輪（上一輪交球之後才換下一輪）。 */
  private roundAt(t: number): Round | null {
    let cur: Round | null = null;
    for (const r of this.rounds) if (t >= r.rel - 0.6) cur = r;
    return cur;
  }

  /** 告示牌裡的歌詞：中文大字置中，有原文時原文在正下方（drawLyric 自動畫），整組在牌子裡垂直置中。 */
  private drawSign(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics, rv: number) {
    const ly = lyricAt(lyrics, t);
    const S = SIGN;
    // 沒有歌詞的時候（間奏、句子之間、純音樂）牌子上是三個淡淡的泳池規則圖示，不留一塊空白的牌子
    const icons = 1 - (ly ? ly.k : 0);
    if (icons > 0.01) this.drawRules(c, icons);
    if (!ly) return;
    const st = { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, maxWidth: S.w - 110, align: 'center' as const, unsung: rgba('sepia', 0.26), sung: rgba('sepia', 0.92), active: rgba('signal') };
    const lay = layoutLyric(c, ly.line, st);
    const top = S.y + SIGN_TOP, h = S.h - SIGN_TOP - SIGN_BOTTOM;
    const y0 = top + Math.max(0, (h - lay.height) / 2) + lay.size * 0.86;
    c.save();
    c.translate(S.x + S.w / 2, y0);
    drawLyric(c, ly.line, t, st, lay, ly.k * rv);
    c.restore();
  }

  /** 告示牌上的三個規則圖示（圓圈裡：水波、腳印、網球），很淡；沒有歌詞時才出現。 */
  private drawRules(c: CanvasRenderingContext2D, a: number) {
    const S = SIGN, cy = S.y + SIGN_TOP + (S.h - SIGN_TOP - SIGN_BOTTOM) / 2, R = 58;
    c.save();
    c.globalAlpha *= a;
    c.strokeStyle = rgba('leash', 0.55);
    c.lineWidth = 5;
    [-1, 0, 1].forEach((k) => {
      const cx = S.x + S.w / 2 + k * 190;
      c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
      if (k === -1) {
        c.lineWidth = 4;
        for (const dy of [-14, 6]) { c.beginPath(); for (let x = -34; x <= 34; x += 4) { const y = cy + dy + Math.sin(x * 0.2) * 6; if (x === -34) c.moveTo(cx + x, y); else c.lineTo(cx + x, y); } c.stroke(); }
        c.lineWidth = 5;
      } else if (k === 0) {
        c.fillStyle = rgba('leash', 0.55);
        c.beginPath(); c.ellipse(cx, cy + 10, 16, 13, 0, 0, Math.PI * 2); c.fill();
        for (const [dx, dy] of [[-18, -10], [-6, -22], [6, -22], [18, -10]]) { c.beginPath(); c.arc(cx + dx!, cy + dy!, 6, 0, Math.PI * 2); c.fill(); }
      } else {
        c.fillStyle = mixRgba('ball', 'paper', 0.3);
        c.beginPath(); c.arc(cx, cy, 24, 0, Math.PI * 2); c.fill();
        c.strokeStyle = rgba('bone'); c.lineWidth = 3;
        c.beginPath(); c.arc(cx - 26, cy, 22, -0.8, 0.8); c.stroke(); c.beginPath(); c.arc(cx + 26, cy, 22, Math.PI - 0.8, Math.PI + 0.8); c.stroke();
        c.strokeStyle = rgba('leash', 0.55); c.lineWidth = 5;
      }
    });
    c.restore();
  }

  /** 宣文丟球（姿勢時間軸），孟庭每拍拍手、元元咬到球時歡呼。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number, r: Round | null, bp: number) {
    const au = this.ctx.audio;
    const e1 = puppetIn(t, this.ctx.start + 0.05, 0.45), e2 = puppetIn(t, this.ctx.start + 0.14, 0.45);
    if (e2.alpha > 0) {
      const cheer = !!r && t >= r.grab - 0.03 && t < r.grab + bp * 1.5;
      const o: PuppetOpts = { h: SZ, spin: e2.spin, alpha: e2.alpha, squash: breathe(t, 0.01, 2.9, 0.3) + 0.03 * beatKick(au, t, 0.22), rot: cheer ? 0 : 0.02 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.1 };
      puppetShadow(c, 'mt', MT_X, DECK, { h: SZ, alpha: 0.24 * e2.alpha, color: '60,70,90' });
      drawPuppet(c, cheer ? 'mt_cheer' : 'mt_fetch_clap', MT_X, DECK, o);
    }
    if (e1.alpha > 0) {
      let rot = 0;
      for (const k of this.rounds) {
        if (t < k.rel) rot -= 0.06 * prog(t, k.rel - bp, k.rel, ease.inOutCubic);
        else if (t < k.rel + bp * 2) rot += 0.07 * Math.exp(-(t - k.rel) / (bp * 0.4));
      }
      const o: PuppetOpts = { h: SZ, rot, pivot: 0.4, spin: e1.spin, alpha: e1.alpha, squash: breathe(t, 0.008, 3.2) + 0.01 * beatKick(au, t, 0.3), hide: ['xw_throw_2:ball'] };
      puppetShadow(c, 'xw', XW_X, DECK, { h: SZ, alpha: 0.26 * e1.alpha, color: '60,70,90' });
      drawPick(c, this.xwKeys, t, XW_X, DECK, o);
    }
  }

  /** 狗在水面上的位置（水面 y）與朝向：元元去咬球再游回來、QQ 慢半拍追、芃芃在右邊漂著轉圈。 */
  private dogPos(w: Who, t: number, r: Round | null): { x: number; y: number; flip: boolean; spin: number; speed: number } {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    const R0 = REST[w];
    const sw = (a: Pt, b: Pt, t0: number, t1: number) => { const k = ease.inOutCubic(clamp((t - t0) / Math.max(1e-3, t1 - t0))); return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), k }; };
    if (w === 'pp') {
      // 悠哉地漂：每個小節線慢慢轉身（紙偶翻面半圈），拍點上往前划一小段
      const bar = au.barAt(t);
      const turns = Math.floor(bar) + ease.inOutCubic(clamp((bar - Math.floor(bar)) / 0.35));
      const x = R0.x + 26 * Math.sin(turns * Math.PI);
      return { x, y: R0.y + 3 * Math.sin(au.beatAt(t) * Math.PI), flip: false, spin: turns * 0.5, speed: 0.3 };
    }
    if (!r || t < r.rel) return { x: R0.x, y: R0.y, flip: w === 'yy', spin: 0, speed: 0 };
    // QQ 追在元元的前下方（離鏡頭近一點），兩隻才不會疊在一起
    const M = this.yyMouth;
    // 元元游到「嘴巴剛好在球那裡」的位置；QQ 追在元元的前下方（離鏡頭近一點），兩隻才不會疊在一起
    const target: Pt = w === 'yy' ? { x: TOY.x - M.x, y: TOY.y - M.y - 6 } : { x: TOY.x - 330, y: TOY.y + 100 };
    const go = w === 'yy' ? r.rel : r.rel + bp * 0.5, arrive = w === 'yy' ? r.grab : r.grab + bp * 0.5;
    if (t < arrive) { const p = sw(R0, target, go, arrive); return { x: p.x, y: p.y, flip: false, spin: 0, speed: Math.sin(Math.PI * p.k) }; }
    if (w === 'qq') {
      // 撲空：慢慢游回原位
      const p = sw(target, R0, arrive + bp, r.next - bp);
      return { x: p.x, y: p.y, flip: t > arrive + bp * 0.8 && p.k < 1, spin: 0, speed: Math.sin(Math.PI * p.k) * 0.7 };
    }
    // 元元：叼著球游回池邊（交球）→ 再游回原位等下一球
    // 往回游時朝左（翻面），嘴在身體左邊：交球的地方也用嘴對齊
    const home: Pt = { x: DROP.x + M.x, y: DROP.y - M.y - 6 };
    if (t < r.home) { const p = sw(target, home, arrive + bp * 0.2, r.home); return { x: p.x, y: p.y, flip: true, spin: 0, speed: Math.sin(Math.PI * p.k) }; }
    if (t < r.give + bp * 0.2) return { x: home.x, y: home.y, flip: true, spin: 0, speed: 0 };
    const p = sw(home, R0, r.give + bp * 0.2, r.next - bp * 0.2);
    return { x: p.x, y: p.y, flip: false, spin: 0, speed: Math.sin(Math.PI * p.k) * 0.6 };
  }

  /**
   * 一隻在水裡的狗：先畫在暫存畫布，水面以下淡掉（看得到一點點水裡的身體）再貼回來；水面一條亮線、拍點上一圈漣漪、游快的時候前面有水花。
   * 游泳的圖（*_d4_swim）水面大約在肩膀：腳底放在水面下「身高的一半」。
   */
  private drawDog(c: CanvasRenderingContext2D, t: number, w: Who, p: { x: number; y: number; flip: boolean; spin: number; speed: number }, r: Round | null, bp: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + (w === 'yy' ? 0.2 : w === 'qq' ? 0.28 : 0.36), 0.42);
    if (en.alpha <= 0) return;
    const name = SWIM[w];
    const bob = 4 * Math.sin((au.beatAt(t) + (w === 'qq' ? 0.3 : w === 'pp' ? 0.6 : 0)) * Math.PI * 2);
    const box0 = puppetBox(name, 0, 0, { h: SZ, scale: DOG_S });
    const depth = box0[3] * DEPTH;
    const grabSquash = w === 'yy' && r ? landSquash(t, r.grab, 0.08, 0.25) : 0;
    const o: PuppetOpts = { h: SZ, scale: DOG_S, flip: p.flip, spin: p.spin + en.spin, alpha: en.alpha, rot: (p.flip ? 1 : -1) * 0.05 * p.speed + 0.02 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.5, squash: grabSquash };
    const wy = p.y + bob * 0.3, fy = wy + depth + bob;
    // 暫存畫布：以 (p.x, wy) 為中心
    const D = this.dip, dc = D.getContext('2d')! as unknown as CanvasRenderingContext2D;
    const ox = D.width / 2, oy = D.height * 0.55;
    dc.setTransform(1, 0, 0, 1, 0, 0);
    dc.globalCompositeOperation = 'source-over';
    dc.globalAlpha = 1;
    dc.clearRect(0, 0, D.width, D.height);
    dc.setTransform(1, 0, 0, 1, ox - p.x, oy - wy);
    drawPuppet(dc, name, p.x, fy, { ...o, alpha: 1 });
    if (w === 'yy') this.mouthNow = puppetPoint(name, 'mouth', p.x, fy, o) ?? { x: p.x + (p.flip ? -1 : 1) * box0[2] * 0.4, y: wy - depth * 0.4 };
    dc.setTransform(1, 0, 0, 1, 0, 0);
    // 水面以下淡掉：水面是一條小波浪，往下越淡
    dc.globalCompositeOperation = 'destination-out';
    const g = dc.createLinearGradient(0, oy, 0, oy + depth);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.35, 'rgba(0,0,0,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,0.97)');
    dc.fillStyle = g;
    dc.beginPath();
    dc.moveTo(0, D.height);
    for (let x = 0; x <= D.width; x += 10) dc.lineTo(x, oy + 2.5 * Math.sin(x * 0.045 + (t - this.ctx.start) * 5 + (w === 'qq' ? 1 : 0)));
    dc.lineTo(D.width, D.height);
    dc.closePath();
    dc.fill();
    // 水裡的部分染一點水色
    dc.globalCompositeOperation = 'source-atop';
    dc.fillStyle = mixRgba('shirtblue', 'leash', 0.4, 0.45);
    dc.fillRect(0, oy + 2, D.width, D.height);
    dc.globalCompositeOperation = 'source-over';
    c.save();
    c.globalAlpha *= en.alpha;
    c.drawImage(D as unknown as CanvasImageSource, p.x - ox, wy - oy);
    c.restore();
    // 水面：亮線（身體前後）、拍點上一圈漣漪、游快的時候前面有水花
    const half = box0[2] * 0.42;
    c.save();
    c.globalAlpha *= en.alpha;
    c.strokeStyle = rgba('bone', 0.85);
    c.lineWidth = 2.2;
    c.beginPath();
    for (let x = -half; x <= half; x += 6) { const yy = wy + 2 + 2.5 * Math.sin((p.x + x) * 0.045 + (t - this.ctx.start) * 5); if (x === -half) c.moveTo(p.x + x, yy); else c.lineTo(p.x + x, yy); }
    c.stroke();
    const k = (au.beatAt(t) + (w === 'pp' ? 0.5 : 0)) % 1;
    c.strokeStyle = rgba('bone', 0.5 * (1 - k));
    c.lineWidth = 1.6;
    c.beginPath(); c.ellipse(p.x, wy + 4, half * (1 + k * 0.6), (half * (1 + k * 0.6)) * 0.16, 0, 0, Math.PI * 2); c.stroke();
    if (p.speed > 0.3) {
      const dir = p.flip ? -1 : 1, fx = p.x + dir * half * 0.95;
      c.fillStyle = rgba('bone', 0.7 * p.speed);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + dir * (0.4 + i * 0.25), ph = ((t - this.ctx.start) * 4 + i * 0.37) % 1;
        c.beginPath(); c.arc(fx + Math.cos(a) * 26 * ph, wy - 4 + Math.sin(a) * 26 * ph + 30 * ph * ph, 4 * (1 - ph) + 1, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
    // 進場：從水裡冒出來（火花在水面）
    if (en.k < 1) {
      sparkHead(this.glow, p.x, wy, t, 0.5);
      sparkParticles(this.glow, t, () => ({ x: p.x, y: wy }), { rate: 30, life: 0.2, speed: 110, seed: w === 'yy' ? 3 : w === 'qq' ? 4 : 5 });
    }
    void bp;
  }

  /** 球：出手後沿拋物線飛、落水（水花、漣漪）、漂著；元元咬到後在嘴裡；交球時跳回宣文手上。 */
  private drawBall(c: CanvasRenderingContext2D, t: number, r: Round | null, bp: number) {
    if (!r || t < r.rel) return;
    const rad = 10;
    if (t < r.land) {
      const u = (t - r.rel) / (r.land - r.rel);
      // 拋物線壓低（頂點不超過出手點太多）：球不要飛過右上的告示牌、擋到歌詞
      const p = arcAt(this.release, TOY, 50, u);
      tennisBall(c, p.x, p.y, rad, { t });
      return;
    }
    // 落水：水花（白色的點往上噴再落下）與一圈圈的漣漪
    const sp = t - r.land;
    if (sp < 0.6) {
      c.save();
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (hash(i, 1) - 0.5) * 2.2, v = 180 + 140 * hash(i, 2);
        const x = TOY.x + Math.cos(a) * v * sp, y = TOY.y + Math.sin(a) * v * sp + 600 * sp * sp;
        if (y > TOY.y + 4) continue;
        c.fillStyle = rgba('bone', 0.9 * (1 - sp / 0.6));
        c.beginPath(); c.arc(x, y, 4 + 3 * hash(i, 3), 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
    for (const d of [0, 0.25]) {
      const k = (sp - d) / 1.2;
      if (k < 0 || k > 1) continue;
      c.strokeStyle = rgba('bone', 0.6 * (1 - k));
      c.lineWidth = 2;
      c.beginPath(); c.ellipse(TOY.x, TOY.y + 4, 20 + 90 * k, (20 + 90 * k) * 0.18, 0, 0, Math.PI * 2); c.stroke();
    }
    if (t < r.grab) { tennisBall(c, TOY.x, TOY.y + 2 + 3 * Math.sin(sp * 6), rad, { t: 0 }); return; }
    // 叼在元元嘴裡（嘴的道具點；游泳的圖沒有量到就用身體前緣估）
    if (t < r.give) {
      // 嘴的位置是這一格畫元元的時候算好的（跟著起伏、傾斜）
      const m = this.mouthNow;
      tennisBall(c, m.x, m.y, rad, { t: 0 });
      return;
    }
    // 交球：從嘴裡跳到宣文蹲下來的手上（之後宣文手上的球是圖上畫的）
    const u = (t - r.give) / (bp * 0.4);
    if (u < 1) {
      const hand = puppetPoint('xw_fetch_take', 'hand', XW_X, DECK, { h: SZ }) ?? { x: XW_X + 80, y: DECK - 150 };
      const p = arcAt({ x: DROP.x + 40, y: DROP.y - 40 }, hand, 60, u);
      tennisBall(c, p.x, p.y, rad, { t });
    }
  }

  /** 浮板：漂在左下的水上，拍點上輕輕往下一沉再浮起來、慢慢左右晃；留言在板面上一個字一個字寫上去。 */
  private drawFloat(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const au = this.ctx.audio;
    const S = this.sheet;
    const tm = writeTiming(n, this.ctx.start + 0.6, t, !!this.msg);
    S.paint(n, { chars: tm.chars, sigK: tm.sigK, padX: FPAD.x, padTop: FPAD.top, padBottom: FPAD.bottom, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74) }, this.paintFloat);
    const dip = 5 * beatKick(au, t, 0.35);
    const cx = FLOAT.cx, cy = FLOAT.cy + 4 * Math.sin((t - this.ctx.start) * 1.3) + dip;
    const rot = 0.018 * Math.sin((t - this.ctx.start) * 0.9);
    const k = prog(t, this.ctx.start, this.ctx.start + 0.5, ease.outCubic);
    // 水上的影子（淡、往下偏）與浮板四周的一圈水紋
    c.save();
    c.globalAlpha *= k;
    c.fillStyle = mixRgba('leash', 'sepia', 0.3, 0.22);
    c.beginPath(); c.ellipse(cx + 14, cy + S.h / 2 - 4, S.w * 0.5, 22, rot, 0, Math.PI * 2); c.fill();
    const ph = ((t - this.ctx.start) * 0.7) % 1;
    c.strokeStyle = rgba('bone', 0.45 * (1 - ph));
    c.lineWidth = 1.8;
    c.beginPath(); c.ellipse(cx, cy + S.h / 2 - 10, S.w * (0.52 + ph * 0.12), 26 + ph * 14, 0, 0, Math.PI * 2); c.stroke();
    c.restore();
    S.blit(c, cx, cy + (1 - k) * 40, { rot, alpha: k });
  }
}
