// 第一支舞（暗、dance、婚禮服、慢歌）：宴會廳熄了燈，空蕩的舞池中間一盞聚光燈，宣文與孟庭慢慢地跳。角色是 Codex 畫的雙人紙偶（_puppet.ts）。
//  - 平常是慢舞（fdance_sway：她環著他的脖子、額頭相靠）＋每拍很輕的起伏、每小節左右搖一次；**每個小節線一個動作**，輪流：
//    慢慢轉半圈（紙偶翻面，兩個人換邊）→ 她靠在他胸前（fdance_lean）→ 在他手下轉一圈（waltz_3）→ 他把她舉起來轉（fdance_lift）；
//    窗格夠長時最後一小節下腰收尾（waltz_4）。動作都比 waltz 慢（一個動作兩拍），最快的那一下在小節線上。
//  - **賓客的留言像周圍桌上的小燭光一則一則亮起**：舞池周圍一圈圓桌，仙女棒的火花一拍跳一桌、點亮桌上的蠟燭（從舞池兩邊往外），
//    點亮的桌布被燭光照暖。舞池是亮的木地板，倒映著兩個人。
//  - 歌詞投影在後面的牆上（婚宴常見的燈光投影，一圈淡淡的光），照跟唱規則逐字亮；比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在最前面那桌的桌卡上（象牙白的立卡、細細的燙金邊，旁邊一盞玻璃燭台照著它），深墨手寫字、署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、卡最大 560 × 330、放在畫面左下，寬高跟著留言。沒有留言時寫邀請。
//  - 鏡頭：整個窗格慢慢橫移（遠的桌子移得多、近的桌卡幾乎不動，有景深）、慢慢推近；空中有幾顆失焦的燈（光斑）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, keys, hash, lerp } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, inkPoly, drawNote, arcAt, type Note } from './_couple';
import { loadPuppets, drawPuppet, pick, puppetShadow, puppetIn, puppetLight, breathe, noteV2, tightenNote, FADE, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dance', paper: false, energy: [0, 0.55], bars: [4, 8] };

const CX = 1030, FLOOR = 800;
const SZ = 440;
/** 最前面那桌的桌卡：最大範圍（底邊立在桌面上，高度跟著留言）與寫字的內距。 */
const CARD = { x: 118, bottom: 956, w: 560, h: 330 };
const PAD = { x: 38, top: 58, bottom: 28 };
/** 投影在牆上的歌詞：中心、基線、最寬。 */
const PROJ = { cx: 1030, y: 250, w: 1080 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const LABEL = 'with love,';
/** 最前面那桌成圖的範圍（畫面座標）。 */
const FRONT = { x: 0, y: CARD.bottom - CARD.h - 40, w: 1000, h: H - (CARD.bottom - CARD.h - 40) };
const POSES = ['cp_fdance_sway', 'cp_fdance_lean', 'cp_fdance_lift', 'cp_waltz_3', 'cp_waltz_4'];
/**
 * 每張圖裡宣文的腳離錨點多遠（圖上的 px，錨點是兩個人的中心）：量 public/wall-sprites 的圖（宣文的黑褲子與皮鞋）。
 * 錨點自動取兩個人的中心，換圖（尤其 fdance 換到 waltz 那組）時宣文會往旁邊跳；畫的時候照這個把宣文的腳對齊，
 * 看起來是他站穩了、她在動。翻面（spin）時照樣繞兩個人的中心轉。
 */
const LEGS: Record<string, number> = { cp_fdance_sway: -121, cp_fdance_lean: -116, cp_fdance_lift: -86, cp_waltz_3: -213, cp_waltz_4: -217 };

type Kind = 'turn' | 'lean' | 'twirl' | 'lift' | 'dip';
interface Move { t: number; kind: Kind }
/** 一張圓桌：位置（桌面中心）、大小（遠近）、視差（鏡頭橫移時移多少）、第幾拍點亮。 */
interface Table { x: number; y: number; s: number; par: number; lit: number; from: { x: number; y: number } }

/**
 * 宴會廳：牆比地板亮一點點、聚光燈從上面打下來（光錐＋舞池上的光圈）、牆上投影歌詞的一圈暖光。
 * 用 shader 算（浮點＋一點點抖色），Canvas2D 的淡漸層在大螢幕上會看到一圈一圈的階。
 */
const HALL = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float wall = smoothstep(640.0, 180.0, p.y) * 0.5 + 0.5 * smoothstep(700.0, 560.0, p.y);
    vec3 col = C_INK + C_BONE * 0.008 * wall;
    float y = clamp(p.y / ${FLOOR}.0, 0.0, 1.0);
    float hw = mix(60.0, 380.0, y);
    float d = abs(p.x - ${CX}.0) / hw;
    float cone = (1.0 - smoothstep(0.4, 1.1, d)) * smoothstep(-0.1, 1.0, y) * (1.0 - smoothstep(${FLOOR}.0, ${FLOOR + 50}.0, p.y));
    vec2 q = (p - vec2(${CX}.0, ${FLOOR + 10}.0)) / vec2(520.0, 120.0);
    float pool = exp(-dot(q, q) * 1.7);
    vec2 g = (p - vec2(${PROJ.cx}.0, ${PROJ.y - 20}.0)) / vec2(700.0, 170.0);
    float gobo = exp(-dot(g, g) * 2.2);
    col += C_BONE * (0.02 * cone + 0.055 * pool) + C_EMBER * 0.018 * gobo;
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

export default class FirstDance extends Scene {
  hall = shared('firstdance.hall', HALL);
  /** 後面（每格畫）：舞池的邊、光斑、圓桌、牆上的歌詞。 */
  back = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 前面（每格畫）：兩個人、倒影，再貼上最前面那桌（桌卡），最後寫留言。 */
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 最前面那桌（桌布、桌卡、玻璃燭台）不會動：init 畫一次成圖，每格貼上去（要蓋在圓桌與人的前面）。 */
  front: HTMLCanvasElement | null = null;
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  moves: Move[] = [];
  keys: [number, string][] = [];
  tables: Table[] = [];
  note: Note | null = null;
  card = { x: CARD.x, y: CARD.bottom - CARD.h, w: CARD.w, h: CARD.h };
  lyricSize = 50;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + LABEL);
    this.track(await loadPuppets(POSES));
    const s = this.ctx.start, e = this.ctx.end;
    // 每個小節線一個動作（轉半圈 → 靠著 → 轉圈圈 → 舉起來），窗格有四小節以上時最後一小節下腰
    const order: Kind[] = ['turn', 'lean', 'twirl', 'lift'];
    const bar0 = barAfter(au, s + 0.4);
    const barDur = au.timeOfBar(Math.round(au.barAt(bar0)) + 1) - bar0;
    for (let k = 0, t = bar0; t < e - 0.3 && k < 40; k++) {
      this.moves.push({ t, kind: order[k % order.length]! });
      t = au.timeOfBar(Math.round(au.barAt(t)) + 1);
    }
    const last = this.moves[this.moves.length - 1];
    if (last && this.moves.length >= 4 && e - last.t > barDur * 0.6) last.kind = 'dip';
    // 姿勢時間軸
    this.keys = [[-1e9, 'cp_fdance_sway']];
    for (const m of this.moves) {
      const bp = au.beatPeriod(m.t);
      if (m.kind === 'lean') this.keys.push([m.t, 'cp_fdance_lean'], [m.t + bp * 3.4, 'cp_fdance_sway']);
      else if (m.kind === 'twirl') this.keys.push([m.t - bp * 0.2, 'cp_waltz_3'], [m.t + bp * 2.2, 'cp_fdance_sway']);
      else if (m.kind === 'lift') this.keys.push([m.t - bp * 0.3, 'cp_fdance_lift'], [m.t + bp * 3.2, 'cp_fdance_sway']);
      else if (m.kind === 'dip') this.keys.push([m.t - bp * 0.4, 'cp_waltz_4']);
    }
    // 圓桌：後面一排（遠、小）、右邊兩桌（近一點）；左下是最前面那桌（桌卡），不在這裡
    const far: [number, number][] = [[120, 572], [340, 580], [570, 575], [810, 568], [1250, 568], [1490, 576], [1720, 580], [1900, 572]];
    const mid: [number, number][] = [[1520, 690], [1790, 700]];
    this.tables = [...far.map(([x, y]) => ({ x, y, s: 0.42, par: 1, lit: 0, from: { x, y } })), ...mid.map(([x, y]) => ({ x, y, s: 0.64, par: 0.6, lit: 0, from: { x, y } }))];
    // 點燈的順序：從舞池兩邊往外，左右交替；一拍一桌，窗格短就快一點（在窗格的七成之前全部點完）
    const byDist = [...this.tables].sort((a, b) => Math.abs(a.x - CX) - Math.abs(b.x - CX));
    const t0 = beatAfter(au, s + 0.5);
    const bp0 = au.beatPeriod(t0);
    const step = Math.max(bp0 * 0.5, Math.min(bp0, (s + (e - s) * 0.7 - t0) / byDist.length));
    let prev = { x: CX, y: FLOOR - 6 };
    byDist.forEach((tb, i) => {
      // 點燈落在拍點上（步距是半拍或一拍）
      tb.lit = au.timeOfBeat(Math.round(au.beatAt(t0 + step * i) * 2) / 2);
      tb.from = prev;
      prev = { x: tb.x, y: tb.y - 30 * tb.s };
    });
    // 桌卡上的留言：標準 v2 的字級；卡的寬高跟著留言（左緣、底邊固定）
    const c = this.fg.ctx;
    const w = CARD.w - PAD.x * 2, hmax = CARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const h = Math.min(CARD.h, Math.max(210, PAD.top + this.note.height + PAD.bottom + 12));
    const cw = Math.min(CARD.w, tightenNote(c, this.note, 320) + PAD.x * 2);
    this.card = { x: CARD.x, y: CARD.bottom - h, w: cw, h };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：最前面那桌（桌布、桌卡、玻璃燭台），畫成一張圖（畫面座標，只畫左下角 FRONT 的範圍）。 */
  private drawBackground() {
    const cv = document.createElement('canvas');
    cv.width = FRONT.w; cv.height = FRONT.h;
    const c = cv.getContext('2d')!, ink = inkFor(false);
    c.translate(-FRONT.x, -FRONT.y);
    // 最前面那桌：白桌布的一角（在暗處，只被燭光照到一點）
    const cloth = [{ x: -20, y: 912 }, { x: 860, y: 922 }, { x: 990, y: H + 20 }, { x: -20, y: H + 20 }];
    const g = c.createLinearGradient(700, 930, 200, 1080);
    g.addColorStop(0, mixRgba('ink2', 'bone', 0.16)); g.addColorStop(1, mixRgba('ink', 'bone', 0.04));
    c.fillStyle = g;
    c.beginPath(); cloth.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.fill();
    c.strokeStyle = rgba('bone', 0.14); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-20, 912); c.lineTo(860, 922); c.lineTo(990, H + 20); c.stroke();
    // 桌卡：立在桌上的象牙白卡片（下緣一道影子），細細的燙金邊、左上一行小小的字
    const K = this.card;
    c.fillStyle = rgba('ink', 0.55);
    c.beginPath(); c.moveTo(K.x + 8, K.y + K.h); c.lineTo(K.x + K.w + 30, K.y + K.h + 4); c.lineTo(K.x + K.w + 10, K.y + K.h + 18); c.lineTo(K.x - 6, K.y + K.h + 12); c.closePath(); c.fill();
    const cg = c.createLinearGradient(K.x + K.w, K.y, K.x, K.y + K.h);
    cg.addColorStop(0, mixRgba('bone', 'cream', 0.5)); cg.addColorStop(1, mixRgba('bone', 'ash', 0.42));
    c.fillStyle = cg;
    c.fillRect(K.x, K.y, K.w, K.h);
    inkPoly(c, [{ x: K.x, y: K.y }, { x: K.x + K.w, y: K.y + 1 }, { x: K.x + K.w - 1, y: K.y + K.h }, { x: K.x + 1, y: K.y + K.h - 1 }], { ink, w: 0.6, seed: 5, color: rgba('sepia', 0.6) });
    c.strokeStyle = rgba('signal', 0.55); c.lineWidth = 1.2;
    c.strokeRect(K.x + 12, K.y + 12, K.w - 24, K.h - 24);
    c.font = font(F.serif(400, true), 22);
    c.fillStyle = rgba('sepia', 0.55);
    c.fillText(LABEL, K.x + PAD.x, K.y + 42);
    // 玻璃燭台（燭火每格畫）
    const vx = Math.min(K.x + K.w + 70, 860), vy = 930;
    c.fillStyle = mixRgba('ink2', 'bone', 0.1);
    c.fillRect(vx - 20, vy - 58, 40, 58);
    c.strokeStyle = rgba('bone', 0.3); c.lineWidth = 1.4;
    c.strokeRect(vx - 20, vy - 58, 40, 58);
    c.fillStyle = mixRgba('bone', 'cream', 0.4);
    c.fillRect(vx - 13, vy - 30, 26, 28);
    this.front = cv;
  }

  /** 燭台的位置（桌卡右邊）。 */
  private votive() { return { x: Math.min(this.card.x + this.card.w + 70, 860), y: 930 - 34 }; }

  /** 兩人一起轉的角度（圈數）：turn 慢慢轉半圈、lift 舉起來時也轉半圈；小節線前先往反方向帶一下（預備），小節線上最快。 */
  private spin(t: number) {
    const au = this.ctx.audio;
    let sp = 0;
    for (const m of this.moves) {
      if (m.kind !== 'turn' && m.kind !== 'lift') continue;
      const b = au.beatPeriod(m.t);
      sp += 0.5 * keys(t, [[m.t - b * 0.6, 0], [m.t - b * 0.1, -0.05, ease.inOutCubic], [m.t + b * 2, 1, ease.outCubic]]);
    }
    return sp;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    const rv = prog(t, s, s + 0.8, ease.inOutCubic);
    // 鏡頭慢慢橫移：遠的桌子移得多（視差）
    const pan = lerp(-26, 26, ease.inOutCubic(f.p));
    this.hall.render(renderer, out);
    this.glow.clear();
    // ---- 後面：舞池的邊（亮的木地板到地毯的交界，一條很淡的弧）、光斑、圓桌、牆上的歌詞
    const B = this.back; B.clear();
    const b = B.ctx;
    b.strokeStyle = rgba('bone', 0.08); b.lineWidth = 2;
    b.beginPath(); b.ellipse(CX + pan * 0.3, FLOOR + 30, 700, 150, 0, Math.PI * 1.02, Math.PI * 1.98); b.stroke();
    this.drawBokeh(b, t, pan);
    this.drawTables(b, t, pan);
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: F.archivo(100, this.msg ? 500 : 600), size: this.lyricSize, minSize: 40, maxWidth: PROJ.w, align: 'center' as const, unsung: rgba('bone', 0.2), sung: rgba('bone', this.msg ? 0.72 : 0.88), active: rgba('signal') };
      const lay = layoutLyric(b, ly.line, st);
      b.save();
      b.translate(PROJ.cx + pan * 0.9, PROJ.y - (lay.height - lay.size) / 2);
      drawLyric(b, ly.line, t, st, lay, ly.k * rv);
      b.restore();
    }
    comp.draw(renderer, B.upload(), out);
    const L = this.fg; L.clear();
    const c = L.ctx;

    // ---- 兩個人（這一層最先畫：打光只染紙偶），地板上的倒影
    const sp = this.spin(t);
    const ph = f.beatPhase;
    let lift = 4 * Math.sin(Math.PI * ph), rot = 0.02 * Math.sin(au.barAt(t) * Math.PI * 2), squash = 0.012 * Math.exp(-ph / 0.14) + breathe(t, 0.006, 3.8);
    for (const m of this.moves) {
      if (m.kind === 'twirl') {
        const u = (t - m.t) / (bp * 0.8);
        if (u > 0 && u < 1) lift += 10 * Math.sin(Math.PI * u);
      } else if (m.kind === 'dip') {
        const k = prog(t, m.t - bp * 0.4, m.t + bp * 1.2, ease.inOutCubic);
        lift *= 1 - k; rot *= 1 - k;
      } else if (m.kind === 'lean') {
        // 靠著的那一小節：搖得更慢更小
        const k = prog(t, m.t, m.t + bp, ease.inOutCubic) * (1 - prog(t, m.t + bp * 3, m.t + bp * 3.6, ease.inOutCubic));
        lift *= 1 - 0.6 * k;
      }
    }
    const ent = puppetIn(t, s + 0.05, 0.6);
    if (ent.alpha > 0) {
      const o: PuppetOpts = { h: SZ, spin: sp + ent.spin, rot, pivot: 0.3, squash, alpha: ent.alpha };
      // 倒影：亮的木地板上淡淡的一個，只畫在地板線以下
      c.save();
      c.beginPath(); c.rect(0, FLOOR, W, H - FLOOR); c.clip();
      c.globalAlpha = 0.1;
      c.translate(0, FLOOR * 2);
      c.scale(1, -1);
      this.drawCouple(c, t, FLOOR - lift, o);
      c.restore();
      puppetShadow(c, 'cp', CX, FLOOR, { h: SZ, lift, alpha: 0.7 * ent.alpha, wide: 1.05, color: '0,0,0' });
      this.drawCouple(c, t, FLOOR - lift, o);
      // 聚光燈從正上方：上亮下暗，白紗不要比桌卡上的字還亮
      puppetLight(c, [CX - 460, FLOOR - SZ * 1.45, 920, SZ * 1.45 + 200], rgba('ink', 0.03), rgba('ink', 0.46));
      if (ent.k < 1) {
        sparkHead(this.glow, CX, FLOOR - 6, t, 0.8);
        sparkParticles(this.glow, t, () => ({ x: CX, y: FLOOR - 6 }), { rate: 60, life: 0.3, speed: 150 });
      }
    }

    // ---- 最前面那桌（蓋在圓桌與人的前面）、燭火、桌卡上的留言
    if (this.front) c.drawImage(this.front, FRONT.x, FRONT.y);
    this.drawCandle(c, t);
    this.drawCard(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭慢慢推近兩個人（最多 1.03 倍，字離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.7, vignette: 0.6, zoom: 1 + 0.03 * push, shake: [-(CX - W / 2) * 0.03 * push, 0] };
  }

  /**
   * 照時間軸換姿勢（跟 _puppet 的 drawPick 一樣：新的一張先畫滿、舊的疊在上面淡掉），但每張照 LEGS 對齊宣文的腳，
   * 換圖時他不會往旁邊跳；翻面時對齊量跟著左右翻。
   */
  private drawCouple(c: CanvasRenderingContext2D, t: number, y: number, o: PuppetOpts) {
    const k = SZ / 600, sx = Math.cos((o.spin ?? 0) * Math.PI * 2);
    const at = (name: string) => CX + ((LEGS.cp_fdance_sway ?? 0) - (LEGS[name] ?? 0)) * k * sx;
    const cur = pick(this.keys, t);
    drawPuppet(c, cur, at(cur), y, o);
    let i = 0;
    for (let j = 0; j < this.keys.length; j++) if (t >= this.keys[j]![0]) i = j;
    if (i > 0) {
      const since = t - this.keys[i]![0], prev = this.keys[i - 1]![1];
      if (since < FADE && prev !== cur) drawPuppet(c, prev, at(prev), y, { ...o, alpha: (o.alpha ?? 1) * (1 - since / FADE) });
    }
  }

  /** 空中幾顆失焦的燈（光斑）：很淡、慢慢飄、各自呼吸；跟著鏡頭有一點視差。 */
  private drawBokeh(c: CanvasRenderingContext2D, t: number, pan: number) {
    c.save();
    for (let k = 0; k < 12; k++) {
      const x = 80 + hash(k, 1) * 1760 + pan * (1.4 + hash(k, 2)) + Math.sin(t * 0.2 + k) * 12;
      const y = 70 + hash(k, 3) * 330;
      if (Math.abs(x - PROJ.cx) < 560 && Math.abs(y - PROJ.y) < 90) continue;
      const r = 14 + 26 * hash(k, 4);
      const a = (0.03 + 0.05 * hash(k, 5)) * (0.7 + 0.3 * Math.sin(t * (0.6 + hash(k, 6)) + k));
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba('ember', a)); g.addColorStop(0.75, rgba('ember', a * 0.8)); g.addColorStop(1, rgba('ember', 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /**
   * 舞池周圍的圓桌：暗處的白桌布（桌面一圈橢圓、垂到地上的裙邊有幾道摺痕）、中間一小叢花與一根蠟燭；
   * 仙女棒的火花在點燈前一拍從上一桌跳過來，落在拍點上點亮蠟燭，點亮之後燭火跳動、桌布被照暖。
   */
  private drawTables(c: CanvasRenderingContext2D, t: number, pan: number) {
    const au = this.ctx.audio;
    for (const tb of this.tables) {
      const x = tb.x + pan * tb.par, y = tb.y, s = tb.s;
      const lit = t >= tb.lit;
      const warm = lit ? clamp((t - tb.lit) / 0.4) : 0;
      const rx = 104 * s, ry = 22 * s, drop = 70 * s;
      // 裙邊：往下稍微張開，幾道摺痕
      c.fillStyle = mixRgba(mixRgba('ink2', 'bone', 0.07), 'signal', 0.05 * warm);
      c.beginPath(); c.moveTo(x - rx, y); c.lineTo(x - rx * 1.04, y + drop); c.quadraticCurveTo(x, y + drop + ry * 1.2, x + rx * 1.04, y + drop); c.lineTo(x + rx, y); c.closePath(); c.fill();
      c.strokeStyle = rgba('ink', 0.35); c.lineWidth = 1;
      c.beginPath();
      for (const k of [-0.66, -0.3, 0.1, 0.46, 0.78]) { const fx = x + k * rx; c.moveTo(fx, y + ry * 0.9 * Math.sqrt(1 - k * k)); c.lineTo(fx + k * 4 * s, y + drop + ry * (1 - k * k) * 0.9); }
      c.stroke();
      // 桌面：被燭光照到就亮起來、偏暖
      c.fillStyle = mixRgba(mixRgba('ink2', 'bone', 0.13 + 0.14 * warm), 'cream', 0.3 * warm);
      c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
      // 中間一小叢花（暗的剪影）與蠟燭
      c.fillStyle = mixRgba('ink2', 'rose', 0.25 + 0.2 * warm);
      c.beginPath(); c.ellipse(x - 10 * s, y - 6 * s, 18 * s, 10 * s, 0, 0, Math.PI * 2); c.ellipse(x + 12 * s, y - 5 * s, 16 * s, 9 * s, 0, 0, Math.PI * 2); c.fill();
      const cy = y - 8 * s;
      c.fillStyle = mixRgba('bone', 'cream', 0.5);
      c.globalAlpha = 0.45 + 0.55 * warm;
      c.fillRect(x - 4 * s, cy - 26 * s, 8 * s, 26 * s);
      c.globalAlpha = 1;
      if (lit) {
        const fl = 0.85 + 0.15 * Math.sin(t * 11 + tb.x) * Math.sin(t * 7.3 + tb.y);
        const r = 110 * s * fl * (0.4 + 0.6 * warm);
        const g = c.createRadialGradient(x, cy - 30 * s, 0, x, cy - 30 * s, r);
        g.addColorStop(0, rgba('ember', 0.34 * warm)); g.addColorStop(0.18, rgba('signal', 0.1 * warm)); g.addColorStop(0.55, rgba('signal', 0.03 * warm)); g.addColorStop(1, rgba('signal', 0));
        c.fillStyle = g;
        c.beginPath(); c.arc(x, cy - 30 * s, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = rgba('ember', 0.95);
        c.beginPath(); c.ellipse(x, cy - 32 * s, 4 * s, 10 * s * fl, 0, 0, Math.PI * 2); c.fill();
      }
      // 點燈前：火花從上一桌跳過來（拋物線），落在拍點上點亮
      const bp = au.beatPeriod(tb.lit);
      const hop = Math.min(bp, 0.5);
      const to = { x, y: cy - 30 * s };
      if (t >= tb.lit - hop && t < tb.lit) {
        const u = (t - (tb.lit - hop)) / hop;
        const p = arcAt(tb.from, to, 60, ease.inOutCubic(u));
        sparkHead(this.glow, p.x, p.y, t, 0.55);
        sparkParticles(this.glow, t, (tt) => { const uu = (tt - (tb.lit - hop)) / hop; return uu >= 0 && uu <= 1 ? arcAt(tb.from, to, 60, ease.inOutCubic(uu)) : null; }, { rate: 70, life: 0.25, speed: 60, seed: Math.round(tb.x) });
      }
      if (t >= tb.lit && t < tb.lit + 0.25) sparkParticles(this.glow, t, (tt) => (tt >= tb.lit && tt < tb.lit + 0.06 ? to : null), { rate: 500, life: 0.25, speed: 110, seed: Math.round(tb.y) });
    }
  }

  /** 最前面那桌燭台的火：一直跳動，照暖桌卡的右半邊。 */
  private drawCandle(c: CanvasRenderingContext2D, t: number) {
    const v = this.votive();
    const fl = 0.85 + 0.15 * Math.sin(t * 9.7) * Math.sin(t * 6.1 + 1);
    const g = c.createRadialGradient(v.x, v.y - 14, 0, v.x, v.y - 14, 260 * fl);
    g.addColorStop(0, rgba('ember', 0.2)); g.addColorStop(0.35, rgba('signal', 0.06)); g.addColorStop(1, rgba('signal', 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(v.x, v.y - 14, 260 * fl, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('ember', 0.95);
    c.beginPath(); c.ellipse(v.x + Math.sin(t * 5) * 1.5, v.y - 12, 5, 13 * fl, 0, 0, Math.PI * 2); c.fill();
  }

  /** 桌卡上的留言：第一個小節線前一個字一個字寫上去（深墨手寫字），寫完署名淡入；在卡面上垂直置中。 */
  private drawCard(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const K = this.card;
    const t0 = Math.min(this.moves[0]?.t ?? this.ctx.start + 0.6, this.ctx.start + 1.2);
    const total = msgChars(n.fit);
    const per = clamp(1.8 / Math.max(1, total), 0.03, 0.11);
    const done = t0 + total * per;
    const top = K.y + PAD.top, h = K.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.8);
    drawNote(c, n, K.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.72), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
