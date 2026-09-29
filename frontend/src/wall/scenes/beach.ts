// 海邊散步（亮、date、日常服二）：黃昏的沙灘側面，海在後面、沙灘在前面。宣文與孟庭牽著手在浪花邊跑，芃芃和 QQ 追浪。
// 角色是 Codex 畫的紙偶（cp2_beach_run_1／2、pp_beach_shake、qq_beach_shake，狗跑步用 base 的 pp／qq_run），海、浪、沙、字是程式畫的。
//  - 浪一個小節一道：小節線上浪從海那邊沖上沙灘，第 2 拍沖到最遠（兩人剛好在拍點上跳起來躲浪、腳邊濺起水花），之後慢慢退回去，
//    沖過的地方留下一片濕沙、慢慢乾掉。兩人一拍換一步（兩張跑步圖）、一步一彈，整個窗格從左往右慢慢跑過去。
//  - 狗：浪來的時候往右逃，第 2 拍被浪追上、原地甩水（正面甩水那張，水珠在拍點上噴出去），浪退的時候再往左追回去。
//  - **主打留言寫在前景的沙上**（畫面左下）：第一道浪特別大，沖過整片前景的沙，退下去之後沙上一個字一個字浮出留言
//    （沙上刻的字：深一點的凹痕＋下緣一條亮邊），寫完署名。之後的浪都比較小、碰不到字。照標準 v2：字 40～60、署名 26～32，
//    寫字的範圍 ≤ 860 × 192（離下緣 96 px），在畫面左下。沒有留言時沙上寫邀請（字小、淡）。
//  - 歌詞：立在遠方的海平線上逐字亮（比留言小一級）。天上幾隻海鷗慢慢飄、太陽貼在海平線上、海面上的反光照拍子閃。
//  - 鏡頭：整個窗格慢慢推近、往沙上的字那邊帶一點。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { lyricAt, barAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { paperBG, lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawCycle, puppetShadow, puppetIn, jumpArc, breathe, hop, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'date', paper: true, energy: [0.2, 0.9], bars: [4, 8] };

/** 海平線、平常的水邊（浪沒上來時）、兩人跑的地面。 */
const HORIZON = 300, SHORE = 560, GROUND = 748;
const SZ = 400;
/** 兩人從哪裡跑到哪裡（整個窗格）。 */
const RUN_X0 = 880, RUN_X1 = 1150;
/** 狗：芃芃、QQ 追浪的來回範圍（x）。 */
const DOGS = [{ d: 'pp', x0: 1420, y: 758 }, { d: 'qq', x0: 1590, y: 772 }] as const;
const DOG_S = 1.25;
/** 前景沙上寫留言的範圍（左下；標準 v2）。 */
const SAND = { x: 110, y: 792, w: 860, h: 192 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['cp2_beach_run_1', 'cp2_beach_run_2', 'pp_beach_shake', 'qq_beach_shake', 'pp_run_1', 'pp_run_2', 'qq_run_1', 'qq_run_2'];

interface Wave { t: number; B: number; big: boolean }

export default class Beach extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  noteAt: Pt = { x: SAND.x, y: SAND.y };
  waves: Wave[] = [];
  /** 留言開始浮出來、寫完的時間。 */
  tw0 = Infinity; twd = Infinity; per = 0.05;
  lyricSize = 48;
  horizonPath: Pt[] = [];

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    // 浪：第一個小節線起每小節一道；第一道是大浪（沖過前景的沙）
    let t = barAfter(au, s + 0.25);
    for (let k = 0; k < 40 && t < e + 1; k++) {
      const next = au.timeOfBar(Math.round(au.barAt(t)) + 1);
      this.waves.push({ t, B: next - t, big: k === 0 });
      t = next;
    }
    // 沙上的留言：手寫字、標準 v2；寬度跟著字縮，靠左
    const c = this.fg.ctx;
    const fam = F.hand(500);
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, SAND.w, SAND.h, { family: fam }) : noteV2(c, INVITE, null, SAND.w * 0.7, 120, { max: 40, family: fam });
    tightenNote(c, this.note, 260);
    this.noteAt = { x: SAND.x + 10, y: SAND.y + Math.max(0, (SAND.h - this.note.height) * 0.4) };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    // 大浪退到一半開始浮字（最多 1.6 秒寫完）
    const w0 = this.waves[0];
    const total = this.msg ? msgChars(this.note.fit) : 0;
    this.per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    this.tw0 = w0 ? w0.t + w0.B * 0.62 : s + 0.5;
    this.twd = this.tw0 + total * this.per;
    // 歌詞：立在海平線上（左半邊，太陽在右邊）
    for (let i = 0; i <= 30; i++) this.horizonPath.push({ x: lerp(150, 1230, i / 30), y: HORIZON - 8 });
    this.drawBackground();
  }

  /** 這道浪在 x 能沖到多遠（從平常的水邊往下多少 px）：左邊的沙比較平、沖得比較遠；大浪沖過整片前景。 */
  private reachAt(x: number, big: boolean) {
    // 兩人跑的那一段（x ≈ 1050）沖到腳邊、右邊沖到狗、左邊（沙上的字）碰不到
    const base = 125 + 65 * Math.exp(-(((x - 1050) / 420) ** 2)) + 70 * clamp((x - 1250) / 400) + 8 * Math.sin(x * 0.013 + 2);
    if (!big) return base;
    return base + 420 * clamp(1 - (x - 1000) / 500);
  }

  /** 浪在這一格沖到哪裡（0..1）：小節線上沖上來、第 2 拍最遠、之後慢慢退。 */
  private swash(w: Wave, t: number) {
    const u = (t - w.t) / w.B;
    if (u < 0 || u > 1.15) return 0;
    if (u < 0.25) return ease.outCubic(u / 0.25);
    return 1 - ease.inOutCubic(clamp((u - 0.25) / 0.75));
  }

  /** 不會動的：天空的暖光、太陽、海（遠深近淺）、沙灘（乾沙的顆粒）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 天空：往海平線越暖
    const sky = c.createLinearGradient(0, 0, 0, HORIZON);
    sky.addColorStop(0, rgba('paper', 0));
    sky.addColorStop(1, mixRgba('paper', 'signal', 0.22, 0.9));
    c.fillStyle = sky;
    c.fillRect(0, 0, W, HORIZON);
    // 太陽：貼在海平線上的半顆
    c.fillStyle = mixRgba('paper', 'signal', 0.5, 0.9);
    c.beginPath(); c.arc(1500, HORIZON, 74, Math.PI, 0); c.fill();
    // 海：遠處深、近處淺（淺藍的海水是固定色，跟著主題的只有反光）
    const sea = c.createLinearGradient(0, HORIZON, 0, SHORE);
    sea.addColorStop(0, mixRgba('shirtblue', 'sepia', 0.28));
    sea.addColorStop(1, mixRgba('shirtblue', 'paper', 0.35));
    c.fillStyle = sea;
    c.fillRect(0, HORIZON, W, SHORE - HORIZON + 4);
    c.strokeStyle = rgba('sepia', 0.35);
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(0, HORIZON); c.lineTo(W, HORIZON); c.stroke();
    // 沙灘：乾沙，往前景越亮；顆粒
    const sand = c.createLinearGradient(0, SHORE, 0, H);
    sand.addColorStop(0, mixRgba('paper', 'fur', 0.22));
    sand.addColorStop(1, mixRgba('paper', 'fur', 0.12));
    c.fillStyle = sand;
    c.fillRect(0, SHORE, W, H - SHORE);
    for (let i = 0; i < 1400; i++) {
      const x = W * hash(i, 1), y = SHORE + (H - SHORE) * Math.pow(hash(i, 2), 0.8);
      c.fillStyle = hash(i, 3) < 0.5 ? rgba('sepia', 0.08 + 0.1 * hash(i, 4)) : rgba('paper', 0.5);
      c.fillRect(x, y, 1.5 + 1.5 * hash(i, 5), 1.5);
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    this.glow.clear();
    const L = this.fg; L.clear();
    const c = L.ctx;

    this.drawSea(c, t);
    this.drawGulls(c, t);
    // 歌詞立在海平線上
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const r = lyricOnPath(c, ly.line, t, this.horizonPath, { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: 6, alpha: ly.k * prog(t, s, s + 0.6), unsung: rgba('sepia', 0.26), sung: rgba('sepia', this.msg ? 0.78 : 0.92), active: rgba('signal') });
      if (r.head) sparkHead(this.glow, r.head.x, r.head.y - 4, t, 0.45, 0.8);
    }
    // 浪（在沙上）→ 沙上的字 → 人和狗（在最前面）
    this.drawSwash(c, t);
    this.drawSandNote(c, t);
    this.drawCouple(c, t);
    for (const D of DOGS) this.drawDog(c, t, D.d, D.x0, D.y);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const fx = SAND.x + SAND.w / 2, fy = SAND.y + SAND.h / 2;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, zoom: 1 + 0.03 * push, shake: [-(fx - W / 2) * 0.03 * push, -(fy - H / 2) * 0.03 * push] };
  }

  /** 海面：往岸邊推的湧浪線（遠的密、近的疏，慢慢往下移）、太陽下面的一條反光（照拍子閃）。 */
  private drawSea(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const u = ((k / 9 + t * 0.045) % 1 + 1) % 1;
      const y = HORIZON + (SHORE - HORIZON) * u * u;
      c.strokeStyle = rgba('paper', 0.12 + 0.35 * u);
      c.lineWidth = 0.8 + 2 * u;
      c.beginPath();
      for (let x = 0; x <= W; x += 40) {
        const yy = y + Math.sin(x * 0.01 + k * 1.7 + t * 0.6) * 3 * u;
        if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
      }
      c.stroke();
    }
    // 太陽的反光：一段一段短短的橫線，拍點上亮一下
    const kick = beatKick(this.ctx.audio, t, 0.3);
    for (let i = 0; i < 26; i++) {
      const y = HORIZON + 6 + (SHORE - HORIZON - 30) * Math.pow(hash(i, 11), 1.3);
      const spread = 30 + (y - HORIZON) * 0.5;
      const x = 1500 + (hash(i, 12) - 0.5) * spread * 2;
      const on = 0.5 + 0.5 * Math.sin(t * (2 + 3 * hash(i, 13)) + i);
      const len = 10 + 26 * hash(i, 14);
      c.strokeStyle = mixRgba('paper', 'signal', 0.6, (0.25 + 0.5 * on) * (0.7 + 0.3 * kick));
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(x - len / 2, y); c.lineTo(x + len / 2, y); c.stroke();
    }
    c.restore();
  }

  /** 海鷗：三隻，很淡的 V 字，慢慢飄、翅膀照拍子拍。 */
  private drawGulls(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    c.save();
    c.strokeStyle = rgba('sepia', 0.45);
    c.lineWidth = 1.8;
    c.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const x = ((200 + 520 * i + t * (18 + 6 * i)) % (W + 200)) - 100;
      const y = 110 + 60 * i + 10 * Math.sin(t * 0.5 + i);
      const flap = Math.sin((au.beatAt(t) + i * 0.3) * Math.PI);
      const w = 14 - 2 * i, dy = 5 + 5 * flap;
      c.beginPath();
      c.moveTo(x - w, y - dy); c.quadraticCurveTo(x - w * 0.4, y - dy * 0.2, x, y);
      c.quadraticCurveTo(x + w * 0.4, y - dy * 0.2, x + w, y - dy);
      c.stroke();
    }
    c.restore();
  }

  /**
   * 沖上沙灘的浪：一片半透明的淺藍水（邊緣最薄）＋白色的浪花邊（一條粗細不一的蕾絲＋小泡泡）；
   * 沖過的地方留一片濕沙（深一點），浪退了以後慢慢乾掉。
   */
  private drawSwash(c: CanvasRenderingContext2D, t: number) {
    for (const w of this.waves) {
      const u = (t - w.t) / w.B;
      if (u < -0.02 || u > 2) continue;
      const k = this.swash(w, t);
      const edge = (x: number, amt: number) => SHORE + this.reachAt(x, w.big) * amt + 5 * Math.sin(x * 0.02 + w.t * 3) * amt;
      // 濕沙：這道浪沖到最遠的地方，退了以後一個小節內慢慢乾
      const dry = clamp((u - 0.25) / 1.6);
      if (u > 0.25 && dry < 1) {
        c.fillStyle = mixRgba('fur', 'sepia', 0.3, 0.16 * (1 - dry));
        c.beginPath(); c.moveTo(0, SHORE);
        for (let x = 0; x <= W; x += 24) c.lineTo(x, edge(x, 1));
        c.lineTo(W, SHORE); c.closePath(); c.fill();
      }
      if (k <= 0.002) continue;
      // 水：從平常的水邊到浪的前緣
      const g = c.createLinearGradient(0, SHORE, 0, SHORE + this.reachAt(600, w.big) * k);
      g.addColorStop(0, mixRgba('shirtblue', 'paper', 0.35, 0.95));
      g.addColorStop(1, mixRgba('shirtblue', 'paper', 0.6, 0.45));
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, SHORE - 4);
      for (let x = 0; x <= W; x += 16) c.lineTo(x, edge(x, k));
      c.lineTo(W, SHORE - 4); c.closePath(); c.fill();
      // 浪花邊：粗細不一的白線＋一串小泡泡（沖上來的時候最白、退的時候變細）
      const foam = u < 0.25 ? 1 : 0.55;
      c.strokeStyle = rgba('bone', 0.95 * foam);
      c.lineCap = 'round';
      for (let x = 0; x < W; x += 16) {
        const wdt = 2 + 5 * foam * (0.5 + 0.5 * Math.sin(x * 0.05 + w.t));
        c.lineWidth = wdt;
        c.beginPath(); c.moveTo(x, edge(x, k)); c.lineTo(x + 16, edge(x + 16, k)); c.stroke();
      }
      c.fillStyle = rgba('bone', 0.9 * foam);
      for (let i = 0; i < 90; i++) {
        const x = W * hash(i, 21, w.t);
        const y = edge(x, k) - 4 - 18 * hash(i, 22) * k;
        c.beginPath(); c.arc(x, y, 1 + 2.2 * hash(i, 23), 0, Math.PI * 2); c.fill();
      }
      c.strokeStyle = rgba('sepia', 0.22);
      c.lineWidth = 1;
      c.beginPath();
      for (let x = 0; x <= W; x += 16) (x ? c.lineTo(x, edge(x, k) + 3) : c.moveTo(x, edge(x, k) + 3));
      c.stroke();
    }
  }

  /** 沙上的留言：刻在沙上的字（深一點的凹痕、下緣一條亮邊），大浪退了以後一個字一個字浮出來；寫完署名。 */
  private drawSandNote(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const chars = this.msg ? Math.max(0, (t - this.tw0) / this.per) : Infinity;
    if (chars <= 0) return;
    const sigK = this.msg ? prog(t, this.twd + 0.1, this.twd + 0.5) : 0;
    const a = this.msg ? 1 : prog(t, this.tw0, this.tw0 + 0.6);
    c.save();
    c.globalAlpha = a;
    // 亮邊（字的下緣被太陽照到）
    drawNote(c, n, this.noteAt.x + 1.5, this.noteAt.y + 2.5, { chars, color: rgba('bone', 0.95), sigColor: rgba('bone', 0.9), sigK });
    // 凹痕（深墨，字才清楚）
    drawNote(c, n, this.noteAt.x, this.noteAt.y, { chars, color: rgba('sepia', this.msg ? 0.92 : 0.55), sigColor: rgba('sepia', 0.72), sigK });
    c.restore();
  }

  /** 兩個人：一拍一步往右跑、一步一彈；每道浪在第 2 拍（浪最遠）跳起來，腳邊濺起水花。 */
  private drawCouple(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start, e = this.ctx.end;
    const en = puppetIn(t, s + 0.05, 0.45);
    if (en.alpha <= 0) return;
    const x = lerp(RUN_X0, RUN_X1, ease.inOutQuad(clamp((t - s) / (e - s))));
    let lift = hop(au.beatAt(t), 1) * 8, squash = breathe(t, 0.006, 2.6);
    for (const w of this.waves) {
      const peak = w.t + w.B * 0.25, bp = w.B / 4;
      const j = jumpArc(t, peak - bp * 0.45, peak + bp * 0.45, 38, { crouch: 0.07, land: 0.1 });
      if (j.air) { lift = -j.y; squash = j.squash; }
      else if (t > peak && t < peak + bp) squash += j.squash;
      // 水花：浪沖到腳邊的那一下
      const d = t - (peak - bp * 0.3);
      if (d > 0 && d < 0.5) this.splash(c, x - 60, GROUND, d, w.t, 1);
    }
    puppetShadow(c, 'cp2_beach_run_1', x, GROUND, { h: SZ, lift, wide: 1.1, alpha: 0.28 * en.alpha, color: '70,45,25' });
    drawCycle(c, au, t, ['cp2_beach_run_1', 'cp2_beach_run_2'], 1, x, GROUND - lift, { h: SZ, squash, spin: en.spin, alpha: en.alpha, rot: 0.015 * Math.sin(au.beatAt(t) * Math.PI) });
    if (en.k < 1) {
      sparkHead(this.glow, x, GROUND - 6, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x, y: GROUND - 6 }), { rate: 50, life: 0.25, speed: 140, seed: 2 });
    }
  }

  /** 水花：從腳邊往上噴的小水珠（白色、細墨邊），d 秒後落下。 */
  private splash(c: CanvasRenderingContext2D, x: number, y: number, d: number, seed: number, k: number) {
    c.save();
    for (let i = 0; i < 16; i++) {
      const vx = (hash(i, seed, 31) - 0.5) * 380 * k, vy = -(160 + 220 * hash(i, seed, 32)) * k;
      const px = x + vx * d + (hash(i, seed, 33) - 0.5) * 60, py = y + vy * d + 900 * d * d;
      if (py > y + 4) continue;
      const r = 2 + 3 * hash(i, seed, 34);
      c.fillStyle = rgba('bone', 0.95 * (1 - d / 0.5));
      c.strokeStyle = rgba('sepia', 0.3 * (1 - d / 0.5));
      c.lineWidth = 0.8;
      c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    c.restore();
  }

  /**
   * 一隻狗追浪（每小節一輪）：第 0～1 拍浪來了往右逃（跑步兩張、半拍一張）→ 第 1～2 拍被浪追上、原地甩水（正面那張，
   * 拍點上水珠噴出去、身體左右扭）→ 第 2～4 拍浪退了，轉身往左追回去。
   */
  private drawDog(c: CanvasRenderingContext2D, t: number, d: 'pp' | 'qq', x0: number, y: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const en = puppetIn(t, s + (d === 'qq' ? 0.3 : 0.22), 0.4);
    if (en.alpha <= 0) return;
    let w: Wave | null = null;
    for (const wv of this.waves) if (t >= wv.t) w = wv;
    const base = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    const shadow = (x: number, lift = 0) => puppetShadow(c, d, x, y, { h: SZ * DOG_S, lift, alpha: 0.26 * en.alpha, color: '70,45,25' });
    const lag = d === 'qq' ? 0.06 : 0;
    if (!w) {
      shadow(x0);
      drawPuppet(c, `${d}_run_1`, x0, y, { ...base, flip: true, squash: 0.04 * beatKick(au, t, 0.25) + breathe(t, 0.015, 1.3) });
      return;
    }
    const u = (t - w.t - lag) / w.B;
    const runs = [`${d}_run_1`, `${d}_run_2`];
    const far = x0 + 150;
    if (u < 0.25) {
      // 逃：往右
      const x = lerp(x0, far, ease.outCubic(clamp(u / 0.25)));
      const b = hop(au.beatAt(t), 2) * 8;
      shadow(x, b);
      drawCycle(c, au, t, runs, 2, x, y - b, { ...base, rot: 0.05 });
    } else if (u < 0.5) {
      // 甩水：正面，身體左右扭、拍點上壓一下；水珠往兩邊噴
      const k = (u - 0.25) / 0.25;
      shadow(far);
      drawPuppet(c, `${d}_beach_shake`, far, y, { ...base, scale: DOG_S * 0.82, rot: 0.12 * Math.sin(k * Math.PI * 6) * (1 - k), pivot: 0.5, squash: 0.08 * Math.exp(-k * 4) });
      this.splash(c, far, y - SZ * 0.14, clamp(k * 0.5, 0, 0.49), w.t + (d === 'qq' ? 7 : 3), 0.8);
    } else {
      // 追回去：往左
      const x = lerp(far, x0, ease.inOutCubic(clamp((u - 0.5) / 0.5)));
      const b = hop(au.beatAt(t), 2) * 8;
      shadow(x, b);
      drawCycle(c, au, t, runs, 2, x, y - b, { ...base, flip: true, rot: -0.05 });
    }
  }
}
