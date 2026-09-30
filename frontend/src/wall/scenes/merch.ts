// 排隊買周邊（亮、live）：演唱會開場前的周邊攤位，長長的隊伍一格一格往前，終於輪到宣文和孟庭，買到一樣的應援毛巾，兩人一起把毛巾展開。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 live）；攤位、排隊的人（剪影）、紅龍柱、三角旗、毛巾是程式畫的（_c9.ts 與這裡）。紙底（亮版面）、線是墨色。
//  - 排隊（開場一兩小節）：兩人側面牽著手站在隊伍裡（cp_live_stand，孟庭踮腳往前看），**每兩拍整條隊伍往前一格**：
//    拍點上一起跨一步（走路的兩張圖、一拍走完一格），最前面買好的人往右走掉。走兩格就輪到兩個人。
//  - 輪到了（最後一步之後的下一拍）：兩個紙偶翻面（側面變一條線）轉成正面，分開站在攤位前，一人抓毛巾的一角（xw／mt_live_towel），
//    毛巾從上緣往下一口氣展開（outBack），**主打留言印在毛巾上**，接著一個字一個字寫上去、署名淡入。之後每個小節線兩人一起小跳、毛巾甩一下。
//  - 毛巾照「留言尺寸與版面比例標準 v2」：字 40～60、毛巾最大 760 × 400，寬高跟著留言（兩個人站的距離跟著毛巾的寬）。沒有留言時毛巾上是邀請。
//    毛巾是黑色的（跟兩人的 T 恤同一套）、四角小星星、下緣流蘇、上面一行很小的「A&O LIVE · 2027.03.13」（新人自己的「巡迴」，不是任何真的歌手）。
//  - 歌詞沿著上方那串三角旗的繩子（lyricOnPath）逐字跟唱，比留言小一級。
//  - 窗格太短（不到三小節）就不排隊，一開場就輪到兩人。鏡頭：整個窗格慢慢推近毛巾。右下角 HUD：人和攤位都不進去。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, barAfter, beatAfter, msgChars, lyricSubOf, subSizeFor, subGap } from './_motifs';
import type { Line } from '../engine/lyrics';
import { inkFor, inkLine, inkPoly, paperBG, lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, hasPuppet, drawPick, drawPuppet, puppetPoint, puppetShadow, breathe, beatKick, jumpArc, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { drawWalker, cloth, star } from './_c9';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'live', paper: true, energy: [0.3, 1], bars: [4, 8] };

const GROUND = 1000;
const SZ = 540;
/** 攤位（右邊，比隊伍遠一點：底在 BOOTH.base）。 */
const BOOTH = { x: 1180, w: 560, top: 330, base: 800 };
/** 隊伍：一格多寬、最前面（在攤位前買東西的那格）的 x。兩人一起佔一格半；兩人走到最前面時腳不能進右下角 HUD。 */
const SLOT = 220, FRONT = 1150;
/** 毛巾：最大寬高（標準 v2）、寫字的內距；毛巾的中心 x 最多到這裡（孟庭的腳不能進右下角 HUD）。 */
const TOWEL = { wMax: 760, hMax: 400, wMin: 460, hMin: 230, cxMax: 860, rightMax: 1110 };
const PAD = { x: 46, top: 58, bottom: 40 };
/** 三角旗的繩子（歌詞沿著它）。 */
const BUNTING = { x0: 110, x1: 1160, y: 150, sag: 46 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const TAG = 'A&O LIVE · 2027.03.13';
const POSES = ['cp_live_stand', 'cp_live_walk_1', 'cp_live_walk_2', 'xw_live_towel', 'mt_live_towel'];

interface Q { t: number }

export default class Merch extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  steps: Q[] = [];
  keys: [number, string][] = [];
  tTurn = 0;
  tUnf = 0;
  msgT0 = 0;
  hops: number[] = [];
  towel = { cx: 0, w: 0, h: 0 };
  xA = 0; xO = 0;
  rope: Pt[] = [];
  /**
   * 原文副行（韓文歌）：lyricOnPath 會把原文排在繩子下面，正好穿過一排三角旗。有原文的句子改成
   * 「原文站在繩子上、中文在它上面」：中文多抬高 subLift（副行的距離），繩子整條往下放同樣的量，中文在畫面上的位置不變。
   */
  subLift = new Map<Line, number>();
  lyricSize = 52;
  ok = false;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + TAG + '周邊 MERCH');
    this.ok = POSES.every(hasPuppet);
    this.track(await loadPuppets(POSES.filter(hasPuppet)));
    const bp = au.beatPeriod(s);
    const bars = (e - s) / (bp * 4);
    // 排隊：每兩拍往前一格；窗格短就少走（不到三小節直接輪到）
    const n = bars >= 4 ? 2 : bars >= 3 ? 1 : 0;
    let T = beatAfter(au, s + 0.35);
    for (let k = 0; k < n; k++) { this.steps.push({ t: T }); T = beatAfter(au, T + 0.05, 1); }
    // 輪到了：最後一步走完之後的下一拍（留言要在開場一兩小節內出現，不等小節線）
    this.tTurn = n ? beatAfter(au, this.steps[n - 1]!.t + bp * 1.05) : s + 0.35;
    this.tUnf = this.tTurn + 0.28;
    this.msgT0 = this.tUnf + 0.45;
    for (let B = barAfter(au, this.tTurn + bp * 2); B < e - 0.3; B = au.timeOfBar(Math.round(au.barAt(B)) + 1)) this.hops.push(B);
    // 兩個人（側面）的起點：走 n 格之後剛好在最前面那格的後面
    this.keys = [[-1e9, 'cp_live_stand']];
    for (const q of this.steps) {
      const b = au.beatPeriod(q.t);
      this.keys.push([q.t, 'cp_live_walk_1'], [q.t + b * 0.5, 'cp_live_walk_2'], [q.t + b, 'cp_live_stand']);
    }
    // 毛巾：標準 v2 的字級；寬高跟著留言
    const c = this.fg.ctx;
    const tw = TOWEL.wMax - PAD.x * 2, th = TOWEL.hMax - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th) : noteV2(c, INVITE, null, tw, th * 0.5, { max: 44 });
    const w = Math.min(TOWEL.wMax, Math.max(TOWEL.wMin, tightenNote(c, this.note, 300) + PAD.x * 2));
    const h = Math.min(TOWEL.hMax, Math.max(TOWEL.hMin, PAD.top + this.note.height + PAD.bottom + 6));
    const cx = Math.min(TOWEL.cxMax, TOWEL.rightMax - w / 2);
    this.towel = { cx, w, h };
    // 兩個人站的位置：抓毛巾的拳頭剛好在毛巾上緣的兩角
    const fa = puppetPoint('xw_live_towel', 'towel', 0, GROUND, { h: SZ }) ?? { x: SZ * 0.26, y: GROUND - SZ * 0.93 };
    const fo = puppetPoint('mt_live_towel', 'towel', 0, GROUND, { h: SZ }) ?? { x: -SZ * 0.27, y: GROUND - SZ * 0.93 };
    this.xA = cx - w / 2 - fa.x;
    this.xO = cx + w / 2 - fo.x;
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    // 三角旗的繩子：一條往下垂的弧
    for (let i = 0; i <= 40; i++) { const u = i / 40; this.rope.push({ x: lerp(BUNTING.x0, BUNTING.x1, u), y: BUNTING.y + Math.sin(Math.PI * u) * BUNTING.sag }); }
    // 原文副行：照 lyricOnPath 的縮字、折行（一個字一個字量、字級取到 0.5 px、跟平移過的曲線比）估每一句原文要抬多高；
    // 繩子照最高的那句往下放（整個窗格一次，繩子不跳）
    const fam = F.archivo(100, 700), c0 = this.fg.ctx;
    const pathLen = (d: number) => {
      const n = this.rope.length, q: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const a = this.rope[Math.max(0, i - 1)]!, b = this.rope[Math.min(n - 1, i + 1)]!, ang = Math.atan2(b.y - a.y, b.x - a.x);
        q.push({ x: this.rope[i]!.x + Math.sin(ang) * d, y: this.rope[i]!.y - Math.cos(ang) * d });
      }
      let L = 0;
      for (let i = 1; i < n; i++) L += Math.hypot(q[i]!.x - q[i - 1]!.x, q[i]!.y - q[i - 1]!.y);
      return L;
    };
    const sumAt = (text: string, sz: number) => { c0.font = font(fam, sz); let w = 0; for (const ch of Array.from(text)) w += c0.measureText(ch).width; return w; };
    for (const l of this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1)) {
      if (!lyricSubOf(l)) continue;
      const lift1 = subGap(this.lyricSize, subSizeFor(this.lyricSize));
      const avail = pathLen(14 + lift1) * 0.94;
      let sz = this.lyricSize, w = sumAt(l.text, sz);
      if (w > avail) { sz = Math.round(Math.max(40, (sz * avail) / w) * 2) / 2; w = sumAt(l.text, sz); }
      const rows = w > avail && l.words.length > 1 ? 2 : 1;
      this.subLift.set(l, subGap(sz, subSizeFor(sz)) + (rows - 1) * sz * 1.2);
    }
    const drop = Math.max(0, ...this.subLift.values());
    if (drop > 0) this.rope = this.rope.map((p) => ({ x: p.x, y: p.y + drop }));
    this.drawBackground();
  }

  /** 不會動的：地面、攤位（帳篷、櫃台、掛著的毛巾樣品、小招牌）、紅龍柱、三角旗。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 地面：一條地平線、往下淡淡的陰影
    const g = c.createLinearGradient(0, BOOTH.base - 20, 0, H);
    g.addColorStop(0, rgba('sepia', 0));
    g.addColorStop(1, rgba('sepia', 0.08));
    c.fillStyle = g;
    c.fillRect(0, BOOTH.base - 20, W, H - BOOTH.base + 20);
    inkLine(c, [{ x: 60, y: BOOTH.base }, { x: W - 60, y: BOOTH.base }], { ink, w: 0.5, t: 0, seed: 2, alpha: 0.5 });
    // 攤位：兩根柱子、帳篷頂（一排扇形的垂邊）、櫃台
    const B = BOOTH;
    const pole = (x: number) => inkLine(c, [{ x, y: B.top + 40 }, { x, y: B.base }], { ink, w: 0.9, t: 0, seed: x });
    pole(B.x + 20); pole(B.x + B.w - 20);
    inkPoly(c, [{ x: B.x - 20, y: B.top + 40 }, { x: B.x + B.w / 2, y: B.top - 30 }, { x: B.x + B.w + 20, y: B.top + 40 }], { ink, fill: mixRgba('paper', 'signal', 0.18), w: 0.9, seed: 5 });
    c.fillStyle = mixRgba('paper', 'signal', 0.3);
    c.beginPath();
    c.moveTo(B.x - 20, B.top + 40);
    const n = 9, sw = (B.w + 40) / n;
    for (let i = 0; i < n; i++) c.arc(B.x - 20 + sw * (i + 0.5), B.top + 40, sw / 2, Math.PI, 0, true);
    c.closePath(); c.fill();
    inkLine(c, [{ x: B.x - 20, y: B.top + 40 }, { x: B.x + B.w + 20, y: B.top + 40 }], { ink, w: 0.7, t: 0, seed: 6 });
    // 小招牌（很小、低對比）
    c.font = font(F.mono(500), 18);
    c.fillStyle = rgba('sepia', 0.55);
    c.textAlign = 'center';
    c.letterSpacing = '4px';
    c.fillText('周邊 MERCH', B.x + B.w / 2, B.top + 14);
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    // 掛著的毛巾樣品（一條繩子、四條黑毛巾，四角小星星）
    inkLine(c, [{ x: B.x + 40, y: B.top + 110 }, { x: B.x + B.w - 40, y: B.top + 110 }], { ink, w: 0.4, t: 0, seed: 8 });
    for (let i = 0; i < 4; i++) {
      const x = B.x + 60 + i * 120, y = B.top + 110;
      c.fillStyle = mixRgba('ink2', 'graphite', 0.25);
      c.fillRect(x, y, 90, 120);
      c.fillStyle = rgba('signal', 0.8);
      star(c, x + 45, y + 55, 16, 0.2); c.fill();
      c.fillRect(x, y + 108, 90, 3);
    }
    // 櫃台
    inkPoly(c, [{ x: B.x, y: B.base - 150 }, { x: B.x + B.w, y: B.base - 150 }, { x: B.x + B.w, y: B.base }, { x: B.x, y: B.base }], { ink, fill: mixRgba('paper', 'sepia', 0.1), w: 0.9, seed: 9 });
    inkLine(c, [{ x: B.x - 10, y: B.base - 150 }, { x: B.x + B.w + 10, y: B.base - 150 }], { ink, w: 1.1, t: 0, seed: 10 });
    // 三角旗：繩子上一排小三角（歌詞在繩子上面）
    inkLine(c, this.rope, { ink, w: 0.4, t: 0, seed: 12, alpha: 0.6 });
    for (let i = 1; i < this.rope.length - 1; i += 2) {
      const p = this.rope[i]!;
      c.fillStyle = i % 4 === 1 ? mixRgba('paper', 'signal', 0.45) : mixRgba('paper', 'sepia', 0.22);
      c.beginPath(); c.moveTo(p.x - 13, p.y + 1); c.lineTo(p.x + 13, p.y + 1); c.lineTo(p.x, p.y + 30); c.closePath(); c.fill();
    }
    L.upload();
  }

  /** 隊伍往前走了幾格（每一步在一拍裡走完，有緩動）與這一格的走路相位。 */
  private progress(t: number): { p: number; ph: number } {
    const au = this.ctx.audio;
    let p = 0, ph = 0;
    for (const q of this.steps) {
      const u = clamp((t - q.t) / au.beatPeriod(q.t));
      p += ease.inOutQuad(u);
      if (u > 0 && u < 1) ph = u * Math.PI * 2;
    }
    return { p, ph };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    const kick = beatKick(au, t, 0.25);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    const turn = t >= this.tTurn;
    const after = prog(t, this.tTurn, this.tTurn + 0.5);

    // ---- 歌詞：三角旗的繩子上
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) lyricOnPath(c, ly.line, t, this.rope, { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, offset: 14 + (this.subLift.get(ly.line) ?? 0), alpha: ly.k * prog(t, s, s + 0.5), unsung: rgba('sepia', 0.3), sung: rgba('sepia', 0.92) });

    // ---- 攤位裡的店員（剪影，半身在櫃台後面）
    const fill = mixRgba('paper', 'sepia', 0.32);
    c.save();
    c.fillStyle = fill;
    const sx = BOOTH.x + BOOTH.w * 0.62, sy = BOOTH.base - 150;
    c.beginPath(); c.arc(sx, sy - 118 + 3 * kick, 26, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(sx, sy - 20, 58, 70, 0, Math.PI, 0); c.fill();
    c.restore();

    // ---- 排隊的人（剪影）：兩人前面有 n 個（一步走掉一個）、後面四個。格子 m（0 = 櫃台前）的 x = FRONT - m × SLOT；
    //      走到 m < 0 的人買好了，往右走掉、淡出。輪到兩人之後隊伍淡掉一點（焦點在毛巾）
    const { p, ph } = this.progress(t);
    const n = this.steps.length;
    const slots = [...Array.from({ length: n }, (_, i) => i), ...[0, 1, 2, 3].map((j) => n + 1.5 + j)];
    c.save();
    slots.forEach((m0, i) => {
      const m = m0 - p;
      let x = FRONT - m * SLOT, a = 1 - 0.55 * after;
      if (m < 0) { x = FRONT - m * 300; a *= clamp(1 + m); }
      if (a <= 0.01 || x < -80 || x > 1330) return;
      const hh = SZ * (0.88 + 0.14 * hash(i, 7));
      c.globalAlpha = a;
      drawWalker(c, x, GROUND - 6, hh, ph, { fill: mixRgba('paper', 'sepia', 0.16 + 0.1 * hash(i, 5)), bag: hash(i, 9) < 0.5 });
    });
    c.restore();

    // ---- 紅龍柱：隊伍前面一排（很淡），帶子往下垂
    this.drawStanchions(c);

    // ---- 兩個人
    if (this.ok) {
      if (!turn) this.drawQueueCouple(c, t);
      else this.drawTowelPair(c, t, kick);
    }
    const push = ease.inOutCubic(f.p);
    const T = this.towel;
    comp.draw(renderer, L.upload(), out);
    return {
      paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5,
      zoom: 1 + 0.03 * push, shake: [-(T.cx - W / 2) * 0.03 * push, -(GROUND - 505 + T.h / 2 - H / 2) * 0.03 * push],
    };
  }

  /** 排隊中的兩個人（側面）：每一步往前一格；輪到的時候翻面（轉到側面變一條線）。 */
  private drawQueueCouple(c: CanvasRenderingContext2D, t: number) {
    const x = this.coupleX(t);
    const spin = 0.25 * ease.inCubic(prog(t, this.tTurn - 0.14, this.tTurn));
    const o: PuppetOpts = { h: SZ, squash: breathe(t, 0.008, 3.2), spin };
    puppetShadow(c, 'cp', x, GROUND, { h: SZ, alpha: 0.35, wide: 1.2, color: '70,45,25' });
    drawPick(c, this.keys, t, x, GROUND, o);
  }

  /** 排隊中的兩個人（腳底 x）：佔一格半，右邊留給前面那個人。 */
  private coupleX(t: number) { return FRONT - SLOT * 0.3 - (this.steps.length - this.progress(t).p) * SLOT; }

  /**
   * 輪到了：兩個紙偶從一條線翻成正面、分開站，毛巾從兩個拳頭之間往下展開，留言寫上去。
   * 之後每個小節線兩人一起小跳，毛巾跟著甩。
   */
  private drawTowelPair(c: CanvasRenderingContext2D, t: number, kick: number) {
    const k = prog(t, this.tTurn, this.tTurn + 0.32);
    const spin = 0.25 * (1 - ease.outBack(k));
    let lift = 0, squash = breathe(t, 0.008, 3.3) + 0.015 * kick;
    for (const B of this.hops) {
      const j = jumpArc(t, B - 0.16, B + 0.16, 22, { crouch: 0.06, land: 0.1 });
      if (j.air || (t > B - 0.3 && t < B + 0.5)) { lift = -j.y; squash = j.squash; break; }
    }
    const oA: PuppetOpts = { h: SZ, spin, squash, rot: Math.sin(t * 1.3) * 0.008, pivot: 0.1 };
    const oO: PuppetOpts = { h: SZ, spin, squash, rot: Math.sin(t * 1.3 + 1) * 0.008, pivot: 0.1 };
    const y = GROUND - lift;
    // 翻面的同時從兩人排隊的位置往兩邊分開（像是退開一步把毛巾拉開）
    const cx0 = this.coupleX(t), sep = ease.outCubic(prog(t, this.tTurn, this.tTurn + 0.38));
    const xA = lerp(cx0 - 60, this.xA, sep), xO = lerp(cx0 + 90, this.xO, sep);
    puppetShadow(c, 'xw', xA, GROUND, { h: SZ, lift, alpha: 0.35, color: '70,45,25' });
    puppetShadow(c, 'mt', xO, GROUND, { h: SZ, lift, alpha: 0.35, color: '70,45,25' });
    drawPuppet(c, 'xw_live_towel', xA, y, oA);
    drawPuppet(c, 'mt_live_towel', xO, y, oO);
    const fa = puppetPoint('xw_live_towel', 'towel', xA, y, oA);
    const fo = puppetPoint('mt_live_towel', 'towel', xO, y, oO);
    if (!fa || !fo) return;
    // 毛巾：上緣在兩個拳頭之間（拳頭蓋在毛巾上面：挖掉拳頭的地方）
    const T = this.towel, n = this.note;
    const unf = ease.outBack(prog(t, this.tUnf, this.tUnf + 0.45));
    if (unf <= 0.01) return;
    const top = (fa.y + fo.y) / 2 + 8, x = T.cx - T.w / 2;
    // 小跳落地時毛巾甩一下
    let flap = 3;
    for (const B of this.hops) if (t > B && t < B + 0.8) flap = 3 + 14 * Math.exp(-(t - B) / 0.25);
    c.save();
    c.beginPath();
    c.rect(0, 0, W, H);
    for (const p of [fa, fo]) { c.moveTo(p.x + SZ * 0.04, p.y); c.arc(p.x, p.y, SZ * 0.04, 0, Math.PI * 2); }
    c.clip('evenodd');
    // 毛巾的影子（紙上往右下一點）
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(x + 12, top + 14, T.w, T.h * Math.min(1, unf));
    cloth(c, x, top, T.w, T.h, {
      fill: mixRgba('ink2', 'graphite', 0.2), shade: rgba('ink', 0.35), edge: rgba('signal', 0.8), motif: rgba('signal', 0.85),
      unfurl: Math.min(1, unf), wave: flap, t, seed: 5, fringe: true,
    });
    c.restore();
    if (unf < 0.9) return;
    // 上面一行很小的「巡迴」字
    c.save();
    c.font = font(F.mono(500), 17);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('signal', 0.7);
    c.textAlign = 'center';
    c.fillText(TAG, T.cx, top + 34);
    c.restore();
    if (!n) return;
    const total = msgChars(n.fit);
    const per = clamp(1.4 / Math.max(1, total), 0.025, 0.09);
    const done = this.msgT0 + total * per;
    const hh = T.h - PAD.top - PAD.bottom;
    drawNote(c, n, T.cx - n.width / 2, top + PAD.top + Math.max(0, (hh - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('bone', 0.97) : rgba('ash', 0.9), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5),
    });
  }

  /** 紅龍柱：隊伍前面一排柱子（很淡），帶子往下垂；右邊停在攤位前（不進 HUD）。 */
  private drawStanchions(c: CanvasRenderingContext2D) {
    const ink = inkFor(true);
    const y = GROUND + 30, hgt = 120;
    const xs: number[] = [];
    for (let x = 80; x < 1300; x += 300) xs.push(x);
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]!;
      inkLine(c, [{ x, y }, { x, y: y - hgt }], { ink, w: 0.9, t: 0, seed: 40 + i, alpha: 0.7 });
      c.fillStyle = rgba('sepia', 0.5);
      c.beginPath(); c.ellipse(x, y, 20, 5, 0, 0, Math.PI * 2); c.fill();
      if (i + 1 < xs.length) {
        const x2 = xs[i + 1]!;
        c.strokeStyle = mixRgba('paper', 'signal', 0.6, 0.8);
        c.lineWidth = 5;
        c.beginPath(); c.moveTo(x, y - hgt + 8); c.quadraticCurveTo((x + x2) / 2, y - hgt + 40, x2, y - hgt + 8); c.stroke();
      }
    }
  }
}
