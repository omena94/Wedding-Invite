// 電影院（暗、home）：從後排看過去，宣文與孟庭的背影、兩隻狗從椅背上探出頭，前面是一整面大銀幕。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 銀幕上放的就是這個窗格：開場是底片的倒數（3、2、1，一拍一個數字、指針掃一圈），小節線上切到**片頭字卡 = 主打留言**
//    （宋體、銀幕正中、署名在下面），歌詞是銀幕下緣的**字幕**（跟唱，比留言小一級）。沒有留言時字卡寫邀請。
//  - 兩人的動作一小節一個（小節線上換）：看電影 → 孟庭靠到宣文肩上 → 轉頭看對方笑 → 第四小節的大拍被電影嚇一跳（爆米花噴起來、狗也跳），
//    然後重來。爆米花在每小節的第二、四拍（小鼓）從桶子裡跳出來幾顆。
//  - 放映機的光從我們頭上打過去（一道一道很淡的光束、光裡飄著灰塵），銀幕的光把人和椅背照亮一點：紙偶上亮下暗（puppetLight），
//    背影是剪影感，不搶銀幕上的字。
//  - 標準 v2：留言 40～60、字卡的字區 ≤ 820 × 330；字幕 40～52。右下角 HUD 只有椅背的暗面。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, frameIdx } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, DATE_DOTS } from './_motifs';
import { inkFor, inkPoly, drawNote, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetLight, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE } from './_c5';

export const spec: PlateSpecDecl = { group: 'couple', family: 'home', paper: false, energy: [0, 0.8], bars: [4, 8] };

/** 銀幕（畫面座標，y 向下）。 */
const SCR = { x: 300, y: 72, w: 1320, h: 540 };
/** 片頭字卡的字區（標準 v2：≤ 860 × 430）。 */
const CARD = { w: 820, h: 330 };
/** 場景尺度（宣文站直的身高 px）：坐著的背影只露出肩膀以上。 */
const SZ = 700;
/** 兩人紙偶的腳底（臀部）位置：被椅背擋住。 */
const CP_X = 880, SEAT_Y = 1078;
/** 坐著的雙人圖稍微放大一點（背影只露出肩膀以上，太小認不出來）；頭頂仍在銀幕下緣下面。 */
const CP_S = 1.06;
/** 這一排椅背的上緣、每個座位的寬；狗狗坐的兩個位子。 */
const BACK_Y = 892, SEAT_W = 240;
const PP_X = CP_X - 1.5 * SEAT_W + 10, QQ_X = CP_X + 1.5 * SEAT_W, DOG_Y = 1012;
/** 爆米花桶（兩人中間的扶手上）。 */
const TUB = { x: CP_X + SEAT_W + 30, y: BACK_Y - 16 };
const LAYER_Y = 620;
const POSES = ['cp_movie_1', 'cp_movie_2', 'cp_movie_3', 'cp_movie_4', 'pp_movie_back', 'qq_movie_turn'];

type Act = 'watch' | 'lean' | 'look' | 'jump';
interface Beat4 { t: number; act: Act }

/**
 * 戲院：暗的牆、銀幕（亮度 lum，放映時一直微微閃）、銀幕的光溢到四周、放映機的光束從我們頭上往銀幕收過去，光裡有灰塵。
 * 用 shader 算（浮點＋一點點抖色）：Canvas2D 的淡漸層在大螢幕上會一階一階的。
 */
const THEATER = () => new FSPass(/* glsl */ `
  uniform float t;
  uniform float lum;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 c = vec2(${SCR.x + SCR.w / 2}.0, ${SCR.y + SCR.h / 2}.0), hs = vec2(${SCR.w / 2}.0, ${SCR.h / 2}.0);
    vec2 q = (p - c) / hs;
    float inS = step(abs(q.x), 1.0) * step(abs(q.y), 1.0);
    // 銀幕：中間亮一點、四角暗（放映機的光圈）
    float hot = 1.0 - 0.35 * dot(q * vec2(0.75, 1.0), q * vec2(0.75, 1.0));
    vec3 scr = C_INK2 + C_BONE * (0.05 * lum * hot);
    // 銀幕的光溢到牆上、椅背上
    vec2 o = max(abs(p - c) - hs, 0.0);
    float spill = exp(-length(o) / 300.0) * 0.022 + exp(-length(o) / 70.0) * 0.02;
    vec3 col = C_INK + C_BONE * spill * lum;
    // 光束：從銀幕往上、往外散到畫面上緣（放映機在我們頭上後面），一道一道、很淡
    vec2 d = p - vec2(c.x, c.y + 60.0);
    float up = clamp(-d.y / ${SCR.y + SCR.h / 2 + 60}.0, 0.0, 1.0);
    float a = atan(d.x, -d.y);
    float fan = 1.0 - smoothstep(0.62, 0.8, abs(a));
    float rays = 0.55 + 0.45 * snoise(vec2(a * 9.0, t * 0.15));
    float beam = fan * rays * smoothstep(0.0, 0.25, up) * (1.0 - inS);
    // 灰塵：光束裡慢慢飄的小點
    vec2 g = p / 9.0 + vec2(t * 0.8, -t * 1.6);
    vec2 cell = floor(g);
    float h = hash12(cell);
    float mote = step(0.992, h) * (1.0 - smoothstep(0.08, 0.28, length(fract(g) - 0.5)));
    col += C_BONE * (0.016 * beam + 0.18 * mote * beam) * lum;
    col = mix(col, scr, inS);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, lum: { value: 1 } });

export default class Movie extends Scene {
  room = shared('movie.theater', THEATER);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 這一排的椅背：畫一次，每格蓋在人和狗前面。只當圖片來源，不上傳。 */
  seats = this.track(new Layer2D(W, H - LAYER_Y));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 第一個小節線：字卡出現；之前是倒數。 */
  title = 0;
  count: number[] = [];
  acts: Beat4[] = [];
  keys: [number, string][] = [];
  /** 爆米花跳起來的時間（每小節第二、四拍）與被嚇到的時間（一次噴很多）。 */
  pops: { t: number; n: number; seed: number }[] = [];
  note: Note | null = null;
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadText('一位賓客TONIGHT\'S FEATURE · 0123456789' + DATE_DOTS + INVITE);
    this.track(await loadPuppets(POSES));
    // 片頭字卡在第一個小節線；前面有幾拍就倒數幾個（最多 3、2、1）
    this.title = barAfter(au, s + 0.5);
    const bp = au.beatPeriod(this.title);
    for (let k = 3; k >= 1; k--) { const tk = this.title - k * bp; if (tk >= s + 0.1) this.count.push(tk); }
    // 一小節一個動作：看 → 靠肩 → 轉頭對看 → 被嚇一跳（在小節線上），然後重來
    const order: Act[] = ['watch', 'lean', 'look', 'jump'];
    let bar = Math.round(au.barAt(this.title));
    for (let k = 0; k < 40; k++, bar++) {
      const t = au.timeOfBar(bar);
      if (t > this.ctx.end) break;
      this.acts.push({ t, act: order[k % 4]! });
    }
    this.keys = [[-1e9, 'cp_movie_1']];
    for (const a of this.acts) {
      const b = au.beatPeriod(a.t);
      if (a.act === 'lean') this.keys.push([a.t, 'cp_movie_2']);
      else if (a.act === 'look') this.keys.push([a.t, 'cp_movie_3'], [a.t + b * 2, 'cp_movie_2']);
      else if (a.act === 'jump') this.keys.push([a.t, 'cp_movie_4'], [a.t + b * 1.2, 'cp_movie_1']);
      else this.keys.push([a.t, 'cp_movie_1']);
    }
    // 爆米花：每小節的第二、四拍跳出兩三顆；被嚇到那一下噴一把
    let b = Math.ceil(au.beatAt(s + 0.3) - 1e-6);
    for (let k = 0; k < 200; k++, b++) {
      const t = au.timeOfBeat(b);
      if (t > this.ctx.end) break;
      const inBar = ((Math.round(au.barAt(t) * 4) % 4) + 4) % 4;
      if (inBar === 1 || inBar === 3) this.pops.push({ t, n: 2 + (b % 2), seed: b });
    }
    for (const a of this.acts) if (a.act === 'jump') this.pops.push({ t: a.t, n: 14, seed: 900 + Math.round(a.t * 10) });
    // 字卡：標準 v2 的字級（宋體，片頭字卡的感覺）；沒有留言時寫邀請
    const c = this.fg.ctx;
    this.note = this.msg
      ? noteV2(c, this.msg.text, this.msg.name, CARD.w, CARD.h, { family: F.ming(700) })
      : noteV2(c, INVITE, null, CARD.w, CARD.h * 0.5, { family: F.ming(700), max: 44 });
    tightenNote(c, this.note, 200);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
    this.drawSeats();
  }

  /** 銀幕的黑框、前面幾排空椅子的椅背（暗、上緣被銀幕的光打亮一條）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 銀幕四周的黑絨布框
    c.strokeStyle = rgba('ink', 0.9);
    c.lineWidth = 10;
    c.strokeRect(SCR.x - 5, SCR.y - 5, SCR.w + 10, SCR.h + 10);
    // 前面幾排的椅背：越遠越小、越暗；上緣一條被銀幕照亮的細光
    const rows = [{ y: 690, w: 150, h: 60, a: 0.5 }, { y: 772, w: 176, h: 76, a: 0.75 }];
    rows.forEach((r, ri) => {
      for (let x = -40 + ri * 60; x < W + 60; x += r.w + 8) {
        c.fillStyle = mixRgba('ink', 'ink2', r.a);
        c.beginPath();
        c.moveTo(x, r.y + r.h); c.lineTo(x, r.y + 16); c.quadraticCurveTo(x, r.y, x + 18, r.y); c.lineTo(x + r.w - 18, r.y); c.quadraticCurveTo(x + r.w, r.y, x + r.w, r.y + 16); c.lineTo(x + r.w, r.y + r.h);
        c.closePath(); c.fill();
        c.strokeStyle = rgba('bone', 0.07 + 0.04 * ri);
        c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x + 14, r.y + 1); c.lineTo(x + r.w - 14, r.y + 1); c.stroke();
      }
    });
    L.upload();
  }

  /** 這一排（兩人與狗狗坐的）椅背：最前景，蓋住肩膀以下。上緣圓角、一條被銀幕照亮的邊、扶手之間的縫。 */
  private drawSeats() {
    const L = this.seats, c = L.ctx;
    L.clear();
    c.save();
    c.translate(0, -LAYER_Y);
    // 椅背下半部連成一片（座位之間只有上緣分開），坐著的人和狗的身體不會從縫裡露出來
    c.fillStyle = rgba('ink');
    c.fillRect(0, BACK_Y + 46, W, H - BACK_Y);
    for (let i = -5; i <= 5; i++) {
      const cx = CP_X - SEAT_W / 2 + i * SEAT_W, x = cx - SEAT_W / 2 + 6, w = SEAT_W - 12;
      const y = BACK_Y + (i === 0 ? 0 : 2 * Math.abs(i));
      const g = c.createLinearGradient(0, y, 0, H);
      g.addColorStop(0, mixRgba('ink2', 'bone', 0.05));
      g.addColorStop(0.25, rgba('ink2'));
      g.addColorStop(1, rgba('ink'));
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x, H + 10); c.lineTo(x, y + 30); c.quadraticCurveTo(x, y, x + 34, y); c.lineTo(x + w - 34, y); c.quadraticCurveTo(x + w, y, x + w, y + 30); c.lineTo(x + w, H + 10);
      c.closePath(); c.fill();
      c.strokeStyle = rgba('bone', 0.14);
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(x + 26, y + 2); c.lineTo(x + w - 26, y + 2); c.stroke();
      // 椅背上的縫線（很淡）
      c.strokeStyle = rgba('bone', 0.035);
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x + 22, y + 48); c.lineTo(x + w - 22, y + 48); c.stroke();
    }
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    // 銀幕的亮度：放映時微微閃；嚇人的那一下銀幕一亮
    let scare = 0;
    for (const a of this.acts) if (a.act === 'jump' && t >= a.t) scare = Math.max(scare, Math.exp(-(t - a.t) / 0.18));
    const flick = 0.96 + 0.05 * hash(frameIdx(t), 7);
    const on = prog(t, s, s + 0.5);
    const lum = (0.55 + 0.45 * on) * flick + 1.6 * scare;
    this.room.u.t!.value = t;
    this.room.u.lum!.value = lum;
    this.room.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 觀眾（最先畫：打光只染紙偶）
    const box: [number, number, number, number] = [0, LAYER_Y, W, H - LAYER_Y];
    this.drawDog(c, t, 'pp', scare, bp);
    this.drawDog(c, t, 'qq', scare, bp);
    this.drawTub(c, t);
    this.drawCouple(c, t, bp);
    // 銀幕的光從前面來：看得到的是背，整體壓暗、頭頂留一點光
    puppetLight(c, box, rgba('ink', 0.36 - 0.2 * scare), rgba('ink', 0.84));
    c.drawImage(this.seats.canvas, 0, LAYER_Y, W, H - LAYER_Y);
    this.drawPopcorn(c, t);

    // ---- 銀幕上的東西：倒數 → 片頭字卡（留言）；字幕（歌詞）
    this.drawScreen(c, t, lum);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近銀幕（最多 1.035 倍），嚇人的那一下輕輕一震
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.55, vignette: 0.6, grain: 0.06, zoom: 1 + 0.035 * push, shake: [0, (SCR.y + SCR.h / 2 - H / 2) * -0.035 * push + 5 * scare * Math.sin(t * 90)] };
  }

  /** 兩個人：姿勢照時間軸（一小節一個動作）；每拍很輕地點頭、呼吸；被嚇到時整個往上一縮再落回來。 */
  private drawCouple(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    let lift = 0, squash = breathe(t, 0.008, 3.6) + 0.008 * beatKick(au, t, 0.3);
    for (const a of this.acts) {
      if (a.act !== 'jump') continue;
      const d = t - a.t;
      if (d >= -0.06 && d < bp * 1.4) { lift = 26 * Math.sin(Math.PI * clamp(d / (bp * 1.2))); squash -= 0.04 * Math.exp(-Math.max(0, d) / 0.1); }
    }
    const en = prog(t, this.ctx.start, this.ctx.start + 0.4);
    drawPick(c, this.keys, t, CP_X, SEAT_Y - lift, { h: SZ, scale: CP_S, squash, pivot: 0.2, alpha: en });
  }

  /** 狗狗：站在椅子上、前腳搭著前面的椅背。芃芃看銀幕，拍點上耳朵一動（歪一下）；QQ 回頭看我們、吐舌頭。被嚇到時跳一下。 */
  private drawDog(c: CanvasRenderingContext2D, t: number, who: 'pp' | 'qq', scare: number, bp: number) {
    const au = this.ctx.audio;
    const x = who === 'pp' ? PP_X : QQ_X;
    let lift = 0;
    for (const a of this.acts) {
      if (a.act !== 'jump') continue;
      const d = t - a.t - (who === 'pp' ? 0.04 : 0.08);
      if (d >= 0 && d < bp) lift = 40 * Math.sin(Math.PI * d / bp);
    }
    const tilt = (who === 'pp' ? 0.05 : -0.06) * Math.sin(au.beatAt(t) * Math.PI * (who === 'pp' ? 0.5 : 1));
    const o: PuppetOpts = { h: SZ, scale: 1.15, rot: tilt, pivot: 0.7, squash: breathe(t, 0.02, 1.4, who === 'pp' ? 0 : 0.5) - 0.05 * scare, alpha: prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5) };
    drawPuppet(c, who === 'pp' ? 'pp_movie_back' : 'qq_movie_turn', x, DOG_Y - lift, o);
  }

  /** 兩人中間扶手上的爆米花桶：紅白直條紋的紙桶（用訊號色與紙白，不寫字），上面冒出一坨爆米花。 */
  private drawTub(c: CanvasRenderingContext2D, t: number) {
    const ink = inkFor(false, { fill: rgba('ink2') });
    const { x, y } = TUB, w0 = 96, w1 = 76, h = 110;
    c.save();
    c.beginPath(); c.moveTo(x - w0 / 2, y); c.lineTo(x + w0 / 2, y); c.lineTo(x + w1 / 2, y + h); c.lineTo(x - w1 / 2, y + h); c.closePath();
    c.fillStyle = mixRgba('bone', 'cream', 0.3);
    c.fill();
    c.clip();
    c.fillStyle = mixRgba('signal', 'blood', 0.4);
    for (let k = -3; k <= 3; k += 2) { c.beginPath(); c.moveTo(x + k * 12 - 6, y); c.lineTo(x + k * 12 + 6, y); c.lineTo(x + k * 9.5 + 5, y + h); c.lineTo(x + k * 9.5 - 5, y + h); c.fill(); }
    c.restore();
    // 上面一坨爆米花（圓圓的小團）
    for (let i = 0; i < 16; i++) {
      const px = x - 44 + (i % 8) * 12.5 + hash(i, 3) * 6, py = y - 4 - (i < 8 ? 0 : 14) - hash(i, 5) * 10 + 2 * Math.sin(t * 3 + i);
      this.kernel(c, px, py, 9 + hash(i, 9) * 3, i * 1.3, ink);
    }
  }

  /** 一顆爆米花：奶油色的不規則小團＋細墨線。 */
  private kernel(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, ink: ReturnType<typeof inkFor>) {
    const pts = [];
    for (let i = 0; i < 7; i++) {
      const a = rot + (i / 7) * Math.PI * 2;
      const rr = r * (0.72 + 0.34 * hash(Math.round(rot * 10), i));
      pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
    }
    inkPoly(c, pts, { ink, fill: mixRgba('cream', 'bone', 0.4), w: 0.35, lw: 2.4, seed: Math.round(rot * 10) });
  }

  /** 從桶子裡跳出來的爆米花：每一顆一條拋物線（種子決定方向），落回桶子或掉到椅背後面。 */
  private drawPopcorn(c: CanvasRenderingContext2D, t: number) {
    const ink = inkFor(false, { fill: rgba('ink2') });
    for (const p of this.pops) {
      const d = t - p.t;
      if (d < 0 || d > 1.1) continue;
      for (let i = 0; i < p.n; i++) {
        const big = p.n > 5;
        const vx = (hash(p.seed, i, 1) - 0.5) * (big ? 700 : 240);
        const vy = -(big ? 620 : 420) - hash(p.seed, i, 2) * (big ? 420 : 220);
        const x = TUB.x + vx * d, y = TUB.y - 16 + vy * d + 1500 * d * d;
        if (y > BACK_Y + 40) continue;
        this.kernel(c, x, y, 8 + hash(p.seed, i, 3) * 3, d * 9 + i, ink);
      }
    }
  }

  /** 銀幕：倒數（底片的起始帶）→ 片頭字卡（留言）；下緣是字幕（歌詞，跟唱）。 */
  private drawScreen(c: CanvasRenderingContext2D, t: number, lum: number) {
    const cx = SCR.x + SCR.w / 2, cy = SCR.y + SCR.h / 2;
    c.save();
    c.beginPath(); c.rect(SCR.x, SCR.y, SCR.w, SCR.h); c.clip();
    // 底片的刮痕：每格一兩條很淡的直線
    const fi = frameIdx(t);
    c.strokeStyle = rgba('bone', 0.06);
    c.lineWidth = 1;
    c.beginPath();
    for (let k = 0; k < 2; k++) { if (hash(fi, k, 3) < 0.5) continue; const x = SCR.x + hash(fi, k, 4) * SCR.w; c.moveTo(x, SCR.y); c.lineTo(x + 3, SCR.y + SCR.h); }
    c.stroke();
    // 倒數：圓圈、十字、掃過去的扇形、中間的數字（一拍一個）
    const cd = this.count.findIndex((tk, i) => t >= tk && t < (this.count[i + 1] ?? this.title));
    if (cd >= 0 && t < this.title) {
      const tk = this.count[cd]!, next = this.count[cd + 1] ?? this.title;
      const u = clamp((t - tk) / (next - tk));
      const num = this.count.length - cd;
      c.strokeStyle = rgba('bone', 0.35);
      c.lineWidth = 2;
      c.beginPath(); c.arc(cx, cy, 190, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(cx, cy, 150, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(SCR.x, cy); c.lineTo(SCR.x + SCR.w, cy); c.moveTo(cx, SCR.y); c.lineTo(cx, SCR.y + SCR.h); c.stroke();
      c.fillStyle = rgba('bone', 0.12);
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, 260, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2); c.closePath(); c.fill();
      c.font = font(F.archivo(100, 700), 210);
      c.textAlign = 'center';
      c.fillStyle = rgba('bone', 0.82);
      c.fillText(String(num), cx, cy + 76);
      c.textAlign = 'left';
    }
    // 片頭字卡：小節線上淡入（像溶接），留言在銀幕正中，署名在最後一行下面
    const n = this.note;
    if (n && t >= this.title - 0.05) {
      const k = prog(t, this.title - 0.05, this.title + 0.45, ease.outCubic);
      c.globalAlpha = k * clamp(lum / 1.1, 0.8, 1);
      c.font = font(F.mono(500), 17);
      c.letterSpacing = '7px';
      c.textAlign = 'center';
      c.fillStyle = rgba('bone', 0.42);
      c.fillText(`TONIGHT'S FEATURE · ${DATE_DOTS}`, cx, SCR.y + 70);
      c.letterSpacing = '0px';
      c.textAlign = 'left';
      const top = cy - 30 - n.height / 2;
      // 字卡整張一起淡入（不是一個字一個字打）；署名晚半拍
      drawNote(c, n, cx - n.width / 2, top, { color: this.msg ? rgba('bone', 0.96) : rgba('bone', 0.66), sigColor: rgba('bone', 0.7), sigK: prog(t, this.title + 0.35, this.title + 0.8), align: 'center' });
      c.globalAlpha = 1;
    }
    // 字幕：銀幕下緣正中，跟唱（間奏時沒有字幕）
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) {
      const st = { family: F.hei(700), size: this.lyricSize, minSize: 40, maxWidth: SCR.w - 240, align: 'center' as const, unsung: rgba('bone', 0.28), sung: rgba('bone', 0.9), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(cx, SCR.y + SCR.h - 44 - (lay.height - lay.size));
      drawLyric(c, ly.line, t, st, lay, ly.k * prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6));
      c.restore();
    }
    c.restore();
  }
}
