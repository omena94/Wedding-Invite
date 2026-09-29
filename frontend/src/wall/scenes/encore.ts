// 散場（暗、live）：演唱會散場後的場館外面，夜裡的廣場與人行道，宣文和孟庭牽著手往捷運站走，兩個人的發光手環一閃一閃。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 live：cp_live_walk_1／2 兩人側面牽手走）；場館、路燈、散場的人潮是程式畫的（_c9.ts）。
//  - 鏡頭跟著兩個人往右走：人留在畫面中間偏右，地上的磚縫、路燈、散場的人潮往左捲（近的快、遠的慢），場館在最遠處幾乎不動。
//    腳步跟著拍子（快歌兩拍一步、慢歌一拍一步），每一步身體一彈；地面捲的距離照步數算，腳不會在地上滑。路燈一小節經過一盞，經過頭頂時兩人被照亮。
//  - 手環：兩個人的手環輪流亮（一拍一個），牽著的手那裡最亮。散場的人手上也還有幾支沒關的手燈。
//  - **主打留言寫在場館外牆上的「票根燈箱」**：一張放大的票根（右邊是撕線與存根，存根上是很小的日期與座位），第一拍燈管閃兩下亮起來，
//    留言一個字一個字寫上去、署名淡入。照「留言尺寸與版面比例標準 v2」：字 40～60、燈箱最大 760 × 360，寬高跟著留言。沒有留言時寫邀請。
//    （原本的點子是寫在兩人手上的票根，但真的票根太小、字放不下，所以改成場館外牆上的票根造型燈箱：兩人剛剛從它下面走出來。）
//  - 歌詞沿著場館圓頂邊緣的那一圈 LED 帶（lyricOnPath），逐字跟唱，比留言小一級。
//  - 鏡頭：整個窗格慢慢推近兩個人。右下角 HUD：只有暗暗的人行道。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, beatAfter, msgChars } from './_motifs';
import { drawNote, lyricOnPath, type Note } from './_couple';
import { loadPuppets, hasPuppet, drawCycle, puppetPoint, puppetShadow, puppetLight, puppetIn, breathe, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { glow, drawWalker, roundRect, type Pt } from './_c9';

export const spec: PlateSpecDecl = { group: 'couple', family: 'live', paper: false, energy: [0.2, 0.8], bars: [4, 8] };

const GROUND = 968;
const SZ = 500;
/** 兩個人的腳底 x（鏡頭跟著走，人留在這裡）。 */
const CX = 1070;
const FRAMES = ['cp_live_walk_1', 'cp_live_walk_2'];
/** 一步走多遠（px）：兩張走路圖兩腳之間的距離（在這個尺度下）。地面照步數捲，腳才不會滑。 */
const STEP = 246 * (SZ / 600);
/** 路燈：一小節（四步）一盞；站在兩個人後面一點（腳底比兩人高），燈頭比燈箱的下緣低，不會擋到字。 */
const LAMP_BASE = GROUND - 46, LAMP_H = 430;
/** 票根燈箱：左上，最大寬高（標準 v2）、存根的寬、寫字的內距。 */
const BOX = { x: 110, y: 104, wMax: 760, hMax: 360, stub: 120 };
const PAD = { x: 44, top: 40, bottom: 30 };
/** 場館的圓頂：橢圓的中心與半徑（圓頂的邊緣那一圈 LED 帶放歌詞）。 */
const DOME = { cx: 640, cy: 1000, rx: 1320, ry: 900 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const STUB = ['ADMIT TWO', '2027.03.13', 'SEAT 03-13'];

/**
 * 夜空與遠景：很暗的天空（往下有一點城市的暖光）、場館的圓頂（比天空暗一點的剪影、細細的直向肋條、邊緣一圈暖光）、
 * 廣場的地面（遠處亮一點、近處暗）。用 shader 算（浮點＋一點點抖色），大螢幕上不會有一圈一圈的階。
 */
const NIGHT = () => new FSPass(/* glsl */ `
  uniform float uT;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = mix(C_INK, C_INK2 + C_BLOOD * 0.05, smoothstep(0.0, 700.0, p.y));
    // 圓頂
    vec2 q = (p - vec2(${DOME.cx}.0, ${DOME.cy}.0)) / vec2(${DOME.rx}.0, ${DOME.ry}.0);
    float r = length(q);
    float dome = 1.0 - smoothstep(0.995, 1.0, r);
    float ribs = smoothstep(0.92, 1.0, abs(sin(atan(q.y, q.x) * 38.0))) * 0.5;
    vec3 domeCol = C_INK * 0.9 + C_INK2 * (0.45 + 0.35 * ribs) + C_BLOOD * 0.03;
    col = mix(col, domeCol, dome);
    // 邊緣那一圈 LED 帶的光（歌詞在上面）
    col += C_SIGNAL * 0.06 * exp(-pow((r - 0.965) / 0.012, 2.0));
    // 場館的入口：圓頂下緣一排亮著的玻璃門（散場的人從這裡走出來），暖暖的一團光
    vec2 e = (p - vec2(420.0, ${GROUND - 300}.0)) / vec2(520.0, 90.0);
    col += (C_EMBER * 0.05 + C_BLOOD * 0.05) * exp(-dot(e, e) * 1.5);
    // 廣場的地面：遠處被場館的入口照亮一點
    float gnd = smoothstep(${GROUND - 250}.0, ${GROUND - 200}.0, p.y);
    vec3 g = C_INK2 * 0.6 + C_BLOOD * 0.03 * exp(-pow((p.x - 500.0) / 700.0, 2.0)) * (1.0 - smoothstep(${GROUND - 200}.0, ${H}.0, p.y));
    col = mix(col, g, gnd);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { uT: { value: 0 } });

export default class Encore extends Scene {
  night = shared('encore.night', NIGHT);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  gl = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  box = { x: BOX.x, y: BOX.y, w: BOX.wMax, h: BOX.hMax };
  walkers: { x: number; k: number; s: number; bag: boolean; stick: boolean }[] = [];
  arc: Pt[] = [];
  perBeat = 1;
  beat0 = 0;
  tOn = 0;
  msgT0 = 0;
  lyricSize = 52;
  ok = false;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadText('一位賓客' + INVITE + STUB.join('') + '捷運站 →');
    this.ok = FRAMES.every(hasPuppet);
    this.track(await loadPuppets(FRAMES.filter(hasPuppet)));
    // 快歌兩拍一步（不然走得像在跑），慢歌一拍一步
    this.perBeat = au.beatPeriod(s) < 0.5 ? 0.5 : 1;
    this.beat0 = au.beatAt(s);
    // 燈箱在第一拍亮；留言接著寫上去
    this.tOn = beatAfter(au, s + 0.1);
    this.msgT0 = this.tOn + 0.35;
    // 燈箱：標準 v2；寬高跟著留言（寫字的範圍在存根的左邊）
    const c = this.fg.ctx;
    const tw = BOX.wMax - BOX.stub - PAD.x * 2, th = BOX.hMax - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th) : noteV2(c, INVITE, null, tw, th * 0.5, { max: 44 });
    const w = Math.min(BOX.wMax, Math.max(420, tightenNote(c, this.note, 260) + PAD.x * 2 + BOX.stub));
    const h = Math.min(BOX.hMax, Math.max(210, PAD.top + this.note.height + PAD.bottom + 8));
    this.box = { x: BOX.x, y: BOX.y, w, h };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    // 圓頂邊緣的 LED 帶：從燈箱右邊一路往右下（字是正的）
    for (let i = 0; i <= 60; i++) {
      const a = lerp(-1.36, -0.72, i / 60);
      this.arc.push({ x: DOME.cx + Math.cos(a) * DOME.rx * 0.965, y: DOME.cy + Math.sin(a) * DOME.ry * 0.965 });
    }
    // 散場的人潮：遠近都有，人頭在地平線附近（鏡頭在眼睛的高度）；還有一些人手燈沒關
    // 遠近 k（1 = 跟兩個人一樣近），遠的多；少數人手燈還沒關
    for (let i = 0; i < 34; i++) {
      const k = lerp(0.62, 0.24, Math.pow(hash(i, 31, 1), 0.6));
      this.walkers.push({ x: hash(i, 31, 2) * W * 1.6, k, s: hash(i, 31, 3), bag: hash(i, 31, 4) < 0.35, stick: hash(i, 31, 5) < 0.18 });
    }
    this.walkers.sort((a, b) => b.k - a.k);
    this.drawBackground();
  }

  /** 不會動的：燈箱的外框（燈管的內容每格畫）、捷運站的指示牌。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const B = this.box;
    // 燈箱的鐵架：兩支斜撐往上鎖在圓頂上
    c.strokeStyle = mixRgba('ink2', 'graphite', 0.35);
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(B.x + 60, B.y); c.lineTo(B.x + 90, B.y - 60);
    c.moveTo(B.x + B.w - 60, B.y); c.lineTo(B.x + B.w - 90, B.y - 60);
    c.stroke();
    // 捷運站的指示牌（遠處右邊，很小）
    const sx = 1640, sy = GROUND - 520;
    c.fillStyle = mixRgba('ink2', 'graphite', 0.3);
    c.fillRect(sx - 3, sy, 6, 360);  // 柱子停在右下角 HUD 的上面
    c.fillStyle = mixRgba('ink2', 'signal', 0.12);
    roundRect(c, sx - 70, sy - 34, 140, 40, 6); c.fill();
    c.font = font(F.hei(500), 20);
    c.fillStyle = rgba('bone', 0.7);
    c.textAlign = 'center';
    c.fillText('捷運站 →', sx, sy - 7);
    c.textAlign = 'left';
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const beat = au.beatAt(t);
    const steps = (beat - this.beat0) * this.perBeat;
    const scroll = steps * STEP;
    this.night.u.uT!.value = t;
    this.night.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);

    const L = this.fg; L.clear();
    const c = L.ctx;
    const G = this.gl; G.clear();
    const g = G.ctx;

    // ---- 路燈：一小節一盞（lamp 是第幾盞），離兩個人多近（經過頭頂時兩人亮一點）
    const lampGap = STEP * 4;
    const lamps: number[] = [];
    let near = 0;
    for (let k = Math.floor((scroll - 200) / lampGap); k < (scroll + W + 400) / lampGap; k++) {
      const x = k * lampGap - scroll + 360;
      if (x < -120 || x > W + 120) continue;
      lamps.push(x);
      near = Math.max(near, Math.exp(-Math.pow((x - CX) / 260, 2)));
    }

    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    let fr = FRAMES[0]!;
    const ent = puppetIn(t, s + 0.05, 0.5);
    if (this.ok && ent.alpha > 0) {
      const bob = hop(beat, this.perBeat) * 8;
      const o: PuppetOpts = { h: SZ, squash: breathe(t, 0.006, 3.1), rot: 0.012, pivot: 0.2, spin: ent.spin, alpha: ent.alpha };
      puppetShadow(c, 'cp', CX, GROUND, { h: SZ, alpha: (0.7 + 0.2 * near) * ent.alpha, wide: 1.3, color: '0,0,0' });
      fr = drawCycle(c, au, t, FRAMES, this.perBeat, CX, GROUND - bob, o);
      // 路燈從上面打下來：經過頭頂時亮一點，平常暗暗的（夜裡）
      puppetLight(c, [CX - 400, GROUND - SZ * 1.2, 800, SZ * 1.2 + 30], rgba('ink', 0.28 - 0.22 * near), rgba('ink', 0.62 - 0.12 * near));
      // 手環：輪流亮（一拍一個），牽著的手那裡最亮
      const b = Math.floor(beat + 1e-6);
      const kick = Math.exp(-3 * (beat - b) / 0.5);
      const col = mixRgba('bone', 'signal', 0.35);
      const p1 = puppetPoint(fr, 'band', CX, GROUND - bob, o), p2 = puppetPoint(fr, 'band2', CX, GROUND - bob, o);
      if (p1) glow(g, col, p1.x, p1.y, 30, (b % 2 === 0 ? 0.25 + 0.6 * kick : 0.2));
      if (p2) glow(g, col, p2.x, p2.y, 40, (b % 2 === 1 ? 0.3 + 0.65 * kick : 0.25));
    }

    // ---- 燈箱（票根）與留言
    this.drawTicket(c, t);

    // ---- 歌詞：圓頂邊緣的 LED 帶
    const ly = lyricAt(this.ctx.lyrics, t);
    const rv = prog(t, s, s + 0.5);
    if (ly) lyricOnPath(c, ly.line, t, this.arc, { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, offset: -14, alpha: ly.k * rv, unsung: rgba('bone', 0.26) });

    // ---- 在兩個人後面的東西（destination-over：從近畫到遠）：路燈、散場的人潮、人行道的磚縫
    c.save();
    c.globalCompositeOperation = 'destination-over';
    for (const x of lamps) this.drawLamp(c, g, x);
    // 散場的人也往右走，只是比兩個人慢一點：相對鏡頭往左漂（遠的漂得慢），各走各的步子
    const span = W * 1.6, horizon = GROUND - SZ * 0.95;
    for (const wk of this.walkers) {
      const x = ((((wk.x - scroll * 0.35 * wk.k) % span) + span) % span) - W * 0.25;
      if (x < -80 || x > W + 80) continue;
      const hh = SZ * wk.k, feet = horizon + hh * 0.95;
      const tip = drawWalker(c, x, feet, hh, (beat * this.perBeat + wk.s * 2) * Math.PI, {
        fill: mixRgba('ink', 'ink2', 0.9 * (0.62 - wk.k) / 0.38), rim: rgba('ember', 0.16), bag: wk.bag, stick: wk.stick, under: true,
      });
      if (tip) glow(g, rgba('signal'), tip.x, tip.y, hh * 0.06, 0.7);
    }
    this.drawPavement(c, scroll);
    c.restore();

    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, G.upload(), out, { mode: 'add', tint: [1.5, 1.5, 1.5] });
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.7, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(CX - W / 2) * 0.03 * push, -(GROUND - SZ * 0.6 - H / 2) * 0.03 * push] };
  }

  /** 一盞路燈：細柱子、頂上彎出去的燈頭、地上一圈光（燈頭的光暈在加亮層）。 */
  private drawLamp(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, x: number) {
    const top = LAMP_BASE - LAMP_H;
    // 右下角 HUD 前面不要有路燈：從右邊淡進來
    const a = clamp((1380 - x) / 140);
    if (a <= 0) return;
    c.save();
    c.globalAlpha *= a;
    // 柱子與燈頭（先畫：destination-over 會在後面的東西上面）
    c.strokeStyle = mixRgba('ink2', 'graphite', 0.3);
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, LAMP_BASE); c.lineTo(x, top + 18); c.quadraticCurveTo(x, top, x + 26, top); c.lineTo(x + 44, top); c.stroke();
    c.fillStyle = mixRgba('ember', 'bone', 0.5, 0.9);
    c.fillRect(x + 32, top + 2, 26, 6);
    // 地上的光圈
    c.fillStyle = mixRgba('ink2', 'ember', 0.12, 0.6);
    c.beginPath(); c.ellipse(x + 40, LAMP_BASE + 6, 150, 18, 0, 0, Math.PI * 2); c.fill();
    c.restore();
    glow(g, rgba('ember'), x + 45, top + 8, 44, 0.3 * a);
    glow(g, rgba('bone'), x + 45, top + 6, 14, 0.6 * a);
  }

  /** 人行道：一排排磚縫往左捲（近的快、遠的慢，透視）。 */
  private drawPavement(c: CanvasRenderingContext2D, scroll: number) {
    c.strokeStyle = rgba('bone', 0.05);
    c.lineWidth = 1.5;
    c.beginPath();
    for (const y of [GROUND + 10, GROUND + 44, GROUND + 90]) { c.moveTo(0, y); c.lineTo(W, y); }
    const gap = 120;
    for (let x = -((scroll % gap) + gap) % gap; x < W + gap; x += gap) {
      // 往遠處收的直縫
      c.moveTo(x, GROUND + 10); c.lineTo(x + (x - W / 2) * 0.3, H);
    }
    c.stroke();
    c.fillStyle = rgba('ink', 0.35);
    c.fillRect(0, GROUND + 10, W, H - GROUND - 10);
  }

  /**
   * 票根燈箱：票根的形狀（左邊主票、右邊是撕線與存根，撕線上下各一個半圓缺口），燈管從後面照亮（上亮下暗一點）。
   * 第一拍燈管閃兩下亮起來；留言一個字一個字寫上去（墨色手寫字），署名淡入；存根上是很小的日期與座位（冷面的小細節）。
   */
  private drawTicket(c: CanvasRenderingContext2D, t: number) {
    const B = this.box, n = this.note;
    const u = t - this.tOn;
    // 燈管：閃兩下再亮穩
    const on = u < 0 ? 0.05 : u < 0.06 ? 0.8 : u < 0.12 ? 0.15 : u < 0.2 ? 0.9 : u < 0.26 ? 0.4 : clamp(0.9 + (u - 0.26) * 0.5);
    const sx = B.x + B.w - BOX.stub;
    c.save();
    // 形狀：圓角矩形，撕線的上下各挖一個半圓
    const shape = () => {
      c.beginPath();
      c.moveTo(B.x + 14, B.y);
      c.lineTo(sx - 16, B.y); c.arc(sx, B.y, 16, Math.PI, 0, true);
      c.lineTo(B.x + B.w - 14, B.y); c.quadraticCurveTo(B.x + B.w, B.y, B.x + B.w, B.y + 14);
      c.lineTo(B.x + B.w, B.y + B.h - 14); c.quadraticCurveTo(B.x + B.w, B.y + B.h, B.x + B.w - 14, B.y + B.h);
      c.lineTo(sx + 16, B.y + B.h); c.arc(sx, B.y + B.h, 16, 0, Math.PI, true);
      c.lineTo(B.x + 14, B.y + B.h); c.quadraticCurveTo(B.x, B.y + B.h, B.x, B.y + B.h - 14);
      c.lineTo(B.x, B.y + 14); c.quadraticCurveTo(B.x, B.y, B.x + 14, B.y);
      c.closePath();
    };
    shape();
    const face = c.createLinearGradient(0, B.y, 0, B.y + B.h);
    face.addColorStop(0, mixRgba('ink2', 'paper', 0.08 + 0.76 * on));
    face.addColorStop(1, mixRgba('ink2', 'paper', 0.06 + 0.6 * on));
    c.fillStyle = face;
    c.fill();
    c.strokeStyle = rgba('bone', 0.25);
    c.lineWidth = 1.5;
    c.stroke();
    // 撕線
    c.setLineDash([6, 7]);
    c.strokeStyle = rgba('sepia', 0.35 * on + 0.05);
    c.beginPath(); c.moveTo(sx, B.y + 20); c.lineTo(sx, B.y + B.h - 20); c.stroke();
    c.setLineDash([]);
    // 存根上的小字（直的三行，mono，很淡）
    c.font = font(F.mono(500), 14);
    c.fillStyle = rgba('sepia', 0.55 * on);
    c.textAlign = 'center';
    STUB.forEach((line, i) => c.fillText(line, sx + BOX.stub / 2, B.y + B.h / 2 - 22 + i * 26));
    c.textAlign = 'left';
    c.restore();
    if (!n || on < 0.5) return;
    const total = msgChars(n.fit);
    const per = clamp(1.4 / Math.max(1, total), 0.025, 0.09);
    const done = this.msgT0 + total * per;
    const tw = B.w - BOX.stub;
    const top = B.y + PAD.top, hh = B.h - PAD.top - PAD.bottom;
    drawNote(c, n, B.x + (tw - n.width) / 2, top + Math.max(0, (hh - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.7), sigK: prog(t, done + 0.1, done + 0.5),
    });
  }
}
