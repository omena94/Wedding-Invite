// 搖擺舞（暗、dance、快歌）：1940 年代的舞廳，宣文與孟庭跳 Lindy Hop。角色是 Codex 畫的雙人紙偶（_puppet.ts）。
//  - 兩小節一個樂句，**每一拍都有一個動作**：甩出去（swing_open）→ 拉回來（close）→ 踢腿（kick）→ 拋起來（toss，最高點在拍點上）→
//    拉回來 → 在他手下轉一圈（spin，紙偶翻兩次面）→ 拉回來。每拍身體往下一沉、拍與拍之間彈起來（搖擺舞的彈性），
//    甩出去的時候整個人往旁邊滑一步。
//  - **歌詞是地板上的舞步腳印**（像老式舞蹈教學圖）：一個字（英文一個字詞）一個鞋印，沿著一條彎來彎去的舞步路線左右交錯排；
//    還沒唱的鞋印是淡淡的虛線，唱到的那一刻「踩」下去（縮一下、亮成訊號色），唱完變紙白。比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在右邊牆上的舞會海報（深色的紙、燙金的裝飾藝術框、四角的扇形），紙白的字、署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、海報最大 560 × 400、放在畫面右上，寬高跟著留言。沒有留言時寫邀請。
//  - 舞廳：左後方的樂隊台（一排裝飾藝術風的譜架前板，腳燈照著）、牆上淡淡的放射狀花紋、天花板一串燈泡照拍子輪流閃、
//    亮的木地板往遠處收（地板上不畫倒影：腳印歌詞在那裡）。鏡頭：慢慢推近，踢腿與拋起來的那一拍輕輕一頓。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, keys, lerp } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, beatAfter, sparkHead, sparkParticles, msgChars, lyricSubOf, subSizeFor, subGap, drawLyricSub } from './_motifs';
import { drawNote, type Note } from './_couple';
import { loadPuppets, drawPick, puppetShadow, puppetIn, puppetLight, jumpArc, landSquash, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dance', paper: false, energy: [0.5, 1], bars: [4, 8] };

const CX = 780, FLOOR = 830;
const SZ = 450;
/** 牆上的海報：最大範圍（右緣、上緣固定，寬高跟著留言）與寫字的內距。 */
const POSTER = { right: 1800, top: 128, w: 560, h: 400 };
const PAD = { x: 46, top: 70, bottom: 38 };
/** 舞步路線（地板上）：從左到右、上下彎；鞋印左右交錯。 */
const STEPS = { x0: 170, x1: 1320, y: 950, wave: 7 };
/** 原文副行（韓文歌）的基線：寫在腳印下面的地板上（鏡頭推近 1.033 倍後離下緣還有 96 px 以上）。 */
const SUB_BASE = 960;
/** 天花板那串燈泡。 */
const BULBS = { x0: -20, x1: 1940, y: 64, sag: 70, n: 22 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const LABEL = 'SWING NIGHT · 今晚跳舞';
const POSES = ['cp_swing_close', 'cp_swing_open', 'cp_swing_toss', 'cp_swing_kick', 'cp_swing_spin'];

type Kind = 'open' | 'close' | 'kick' | 'toss' | 'spin';
interface Move { t: number; kind: Kind }

/**
 * 舞廳：牆上暖暖的暗、地板上一圈光（跟著兩個人）、左後方樂隊台的腳燈。
 * 用 shader 算（浮點＋一點點抖色），Canvas2D 的淡漸層在大螢幕上會看到一圈一圈的階。
 */
const HALL = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float wall = smoothstep(${FLOOR - 250}.0, 120.0, p.y);
    vec3 col = C_INK + C_EMBER * 0.01 * wall + C_BONE * 0.006;
    vec2 q = (p - vec2(${CX}.0, ${FLOOR + 10}.0)) / vec2(560.0, 120.0);
    float pool = exp(-dot(q, q) * 1.6);
    vec2 b = (p - vec2(260.0, ${FLOOR - 250}.0)) / vec2(420.0, 160.0);
    float band = exp(-dot(b, b) * 2.0);
    vec2 s = (p - vec2(${POSTER.right - POSTER.w / 2}.0, ${POSTER.top + 60}.0)) / vec2(420.0, 360.0);
    float sconce = exp(-dot(s, s) * 2.2);
    col += C_BONE * 0.05 * pool + C_EMBER * (0.03 * band + 0.02 * sconce);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

export default class Swing extends Scene {
  hall = shared('swing.hall', HALL);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  moves: Move[] = [];
  keys: [number, string][] = [];
  note: Note | null = null;
  poster = { x: 0, y: POSTER.top, w: POSTER.w, h: POSTER.h };
  lyricSize = 50;
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + LABEL);
    this.track(await loadPuppets(POSES));
    const s = this.ctx.start, e = this.ctx.end;
    // 每一拍一個動作：兩小節（八拍）一個樂句，從進場後的第一拍開始
    const phrase: Kind[] = ['open', 'close', 'close', 'kick', 'toss', 'close', 'spin', 'close'];
    let b = Math.ceil(au.beatAt(beatAfter(au, s + 0.55)) - 1e-6);
    for (let k = 0; k < 200; k++) {
      const t = au.timeOfBeat(b);
      if (t > e - 0.1) break;
      this.moves.push({ t, kind: phrase[k % phrase.length]! });
      b++;
    }
    // 姿勢時間軸：拋起來的那一下在拍點前半拍起跳（最高點在拍點上），其他的在拍點上換
    this.keys = [[-1e9, 'cp_swing_close']];
    for (const m of this.moves) {
      const bp = au.beatPeriod(m.t);
      const at = m.kind === 'toss' ? m.t - bp * 0.45 : m.t;
      const name = `cp_swing_${m.kind}`;
      if (this.keys[this.keys.length - 1]![1] !== name) this.keys.push([at, name]);
    }
    // 海報上的留言：標準 v2 的字級；海報的寬高跟著留言（右緣、上緣固定）
    const c = this.fg.ctx;
    const w = POSTER.w - PAD.x * 2, hmax = POSTER.h - PAD.top - PAD.bottom;
    const fam = F.ming(500);
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax, { family: fam }) : noteV2(c, INVITE, null, w, hmax * 0.5, { family: fam, max: 44 });
    const ph = Math.min(POSTER.h, Math.max(240, PAD.top + this.note.height + PAD.bottom + 14));
    const pw = Math.min(POSTER.w, tightenNote(c, this.note, 340) + PAD.x * 2);
    this.poster = { x: POSTER.right - pw, y: POSTER.top, w: pw, h: ph };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.3);
    this.drawBackground();
  }

  /** 不會動的：牆上的放射花紋、樂隊台、地板、海報（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 牆上的放射花紋（裝飾藝術風，從樂隊台後面放出去，很淡）
    c.save();
    c.strokeStyle = rgba('ember', 0.014); c.lineWidth = 1.5;
    for (let k = 0; k < 11; k++) {
      const a = Math.PI * 1.1 + (k / 10) * Math.PI * 0.8;
      c.beginPath(); c.moveTo(260 + Math.cos(a) * 250, FLOOR - 250 + Math.sin(a) * 250); c.lineTo(260 + Math.cos(a) * 520, FLOOR - 250 + Math.sin(a) * 520); c.stroke();
    }
    for (const r of [180, 230]) { c.beginPath(); c.arc(260, FLOOR - 250, r, Math.PI, Math.PI * 2); c.stroke(); }
    c.restore();
    // 牆腳：一條護牆板
    c.fillStyle = rgba('ink2', 0.9);
    c.fillRect(0, FLOOR - 170, W, 30);
    c.fillStyle = rgba('ember', 0.05);
    c.fillRect(0, FLOOR - 170, W, 2);
    // 地板：從牆腳到最前面，亮的木地板（一條條往遠處收的木紋）
    const g = c.createLinearGradient(0, FLOOR - 140, 0, H);
    g.addColorStop(0, mixRgba('ink2', 'fur', 0.12)); g.addColorStop(0.5, mixRgba('ink', 'fur', 0.08)); g.addColorStop(1, rgba('ink', 1));
    c.fillStyle = g;
    c.fillRect(0, FLOOR - 140, W, H - FLOOR + 140);
    c.strokeStyle = rgba('ink', 0.5); c.lineWidth = 1.2;
    c.beginPath();
    for (let k = -14; k <= 14; k++) { const x0 = CX + k * 70, x1 = CX + k * 190; c.moveTo(x0, FLOOR - 140); c.lineTo(x1, H); }
    c.stroke();
    // 樂隊台：一排譜架的前板（上窄下寬的梯形、中間一個扇形），腳燈從下面照
    for (let k = 0; k < 4; k++) {
      const x = 70 + k * 120, y = FLOOR - 330, w = 96, h = 130;
      c.fillStyle = mixRgba('ink2', 'ember', 0.1);
      c.beginPath(); c.moveTo(x + 8, y); c.lineTo(x + w - 8, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
      c.strokeStyle = rgba('signal', 0.35); c.lineWidth = 1.5; c.stroke();
      c.beginPath(); c.arc(x + w / 2, y + h * 0.62, 26, Math.PI, Math.PI * 2); c.stroke();
      for (let i = 0; i < 5; i++) { const a = Math.PI + ((i + 0.5) / 5) * Math.PI; c.beginPath(); c.moveTo(x + w / 2, y + h * 0.62); c.lineTo(x + w / 2 + Math.cos(a) * 26, y + h * 0.62 + Math.sin(a) * 26); c.stroke(); }
    }
    c.fillStyle = rgba('ink2', 1);
    c.fillRect(40, FLOOR - 200, 520, 30);
    this.drawPoster(c);
    L.upload();
  }

  /** 舞會海報：深色的紙、燙金（訊號色）的雙線框、四角的扇形，上面一行小字；下緣一道影子。 */
  private drawPoster(c: CanvasRenderingContext2D) {
    const P = this.poster;
    c.fillStyle = rgba('ink', 0.7);
    c.fillRect(P.x + 10, P.y + 12, P.w, P.h);
    const g = c.createLinearGradient(0, P.y, 0, P.y + P.h);
    g.addColorStop(0, mixRgba('ink2', 'denim', 0.3)); g.addColorStop(1, mixRgba('ink', 'denim', 0.2));
    c.fillStyle = g;
    c.fillRect(P.x, P.y, P.w, P.h);
    c.strokeStyle = rgba('signal', 0.7); c.lineWidth = 2;
    c.strokeRect(P.x + 12, P.y + 12, P.w - 24, P.h - 24);
    c.lineWidth = 1;
    c.strokeRect(P.x + 20, P.y + 20, P.w - 40, P.h - 40);
    // 四角的扇形
    for (const [cx, cy, a0] of [[P.x + 20, P.y + 20, 0], [P.x + P.w - 20, P.y + 20, Math.PI / 2], [P.x + P.w - 20, P.y + P.h - 20, Math.PI], [P.x + 20, P.y + P.h - 20, Math.PI * 1.5]] as const) {
      c.beginPath();
      for (let i = 0; i <= 4; i++) { const a = a0 + (i / 4) * (Math.PI / 2); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22); }
      c.stroke();
      c.beginPath(); c.arc(cx, cy, 22, a0, a0 + Math.PI / 2); c.stroke();
    }
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('signal', 0.7);
    c.fillText(LABEL, P.x + PAD.x, P.y + 50);
    c.letterSpacing = '0px';
  }

  /** 紙偶翻面：spin 那一拍轉一整圈（翻兩次面），拍點前先往反方向帶一下。 */
  private spin(t: number) {
    const au = this.ctx.audio;
    let sp = 0;
    for (const m of this.moves) {
      if (m.kind !== 'spin') continue;
      const bp = au.beatPeriod(m.t);
      sp += keys(t, [[m.t - bp * 0.3, 0], [m.t - bp * 0.05, -0.04, ease.inOutCubic], [m.t + bp * 0.8, 1, ease.outCubic]]);
    }
    return sp;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.hall.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.5, ease.inOutCubic);

    // ---- 兩個人：每拍往下一沉、拍與拍之間彈起來；甩出去時往旁邊滑一步、拋起來時整個人往上送
    const ph = f.beatPhase;
    let lift = 12 * Math.sin(Math.PI * ph), squash = 0.05 * Math.exp(-ph / 0.1) - 0.02 * Math.sin(Math.PI * ph), dx = 0, rot = 0;
    let punch = 0;
    for (const m of this.moves) {
      const d = t - m.t;
      if (m.kind === 'open') dx += 70 * keys(t, [[m.t - bp * 0.15, 0], [m.t + bp * 0.25, 1, ease.outCubic], [m.t + bp * 1.9, 0, ease.inOutCubic]]);
      if (m.kind === 'toss' && d > -bp * 0.6 && d < bp * 0.9) {
        const j = jumpArc(t, m.t - bp * 0.45, m.t + bp * 0.45, 34, { crouch: 0.1, land: 0.16 });
        lift = -j.y; squash = j.squash;
        rot = 0.05 * Math.sin(Math.PI * clamp(j.u));
      }
      if (m.kind === 'kick' || m.kind === 'toss') punch = Math.max(punch, d >= 0 ? Math.exp(-d / 0.12) : 0);
      if (m.kind === 'close' && d >= 0 && d < 0.3) squash += landSquash(t, m.t, 0.05, 0.25);
    }
    const x = CX + dx;
    const ent = puppetIn(t, s + 0.05, 0.4);
    if (ent.alpha > 0) {
      const o: PuppetOpts = { h: SZ, spin: this.spin(t) + ent.spin, rot, pivot: 0.3, squash, alpha: ent.alpha };
      puppetShadow(c, 'cp', x, FLOOR, { h: SZ, lift, alpha: 0.75 * ent.alpha, wide: 1.1, color: '0,0,0' });
      drawPick(c, this.keys, t, x, FLOOR - lift, o);
      puppetLight(c, [x - 520, FLOOR - SZ * 1.5, 1040, SZ * 1.5 + 200], rgba('ink', 0.04), rgba('ink', 0.45));
      if (ent.k < 1) {
        sparkHead(this.glow, CX, FLOOR - 6, t, 0.8);
        sparkParticles(this.glow, t, () => ({ x: CX, y: FLOOR - 6 }), { rate: 60, life: 0.3, speed: 150 });
      }
    }

    this.drawBulbs(c, t);
    const ly = lyricAt(lyrics, t);
    if (ly) this.footprints(c, ly.line, t, ly.k * rv);
    this.drawMessage(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近兩個人；踢腿與拋起來的那一拍輕輕一頓（最多 1.03 倍，字離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.7, vignette: 0.55, zoom: 1 + 0.025 * push + 0.008 * punch, shake: [-(CX - W / 2) * 0.025 * push, 0] };
  }

  /** 天花板那串燈泡：照拍子輪流亮（單數拍亮單數顆），亮的那顆有一圈暖光。 */
  private drawBulbs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const beat = Math.floor(au.beatAt(t) + 1e-6);
    const since = t - au.timeOfBeat(beat);
    const yAt = (x: number) => { const u = (x - BULBS.x0) / (BULBS.x1 - BULBS.x0); return BULBS.y + BULBS.sag * 4 * u * (1 - u); };
    c.save();
    c.strokeStyle = rgba('bone', 0.14); c.lineWidth = 1.2;
    c.beginPath();
    for (let x = BULBS.x0; x <= BULBS.x1; x += 30) (x === BULBS.x0 ? c.moveTo(x, yAt(x)) : c.lineTo(x, yAt(x)));
    c.stroke();
    for (let i = 0; i < BULBS.n; i++) {
      const x = lerp(BULBS.x0 + 40, BULBS.x1 - 40, i / (BULBS.n - 1)), y = yAt(x) + 14;
      const on = (i + beat) % 2 === 0;
      const k = on ? 0.55 + 0.45 * Math.exp(-since / 0.18) : 0.18;
      const g = c.createRadialGradient(x, y, 0, x, y, 30);
      g.addColorStop(0, rgba('ember', 0.28 * k)); g.addColorStop(1, rgba('ember', 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, 30, 0, Math.PI * 2); c.fill();
      c.fillStyle = mixRgba('ink2', 'ember', 0.3 + 0.7 * k);
      c.beginPath(); c.ellipse(x, y, 6, 8, 0, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /**
   * 歌詞的舞步腳印：一個字（英文一個字詞）一個鞋印，沿著舞步路線左右交錯；鞋印是淡淡的鞋底輪廓，字寫在上面。
   * 還沒唱：虛線鞋印、字三成透明；唱到的那一刻踩下去（縮一下、訊號色）；唱完紙白。
   */
  private footprints(c: CanvasRenderingContext2D, line: Line, t: number, alpha: number) {
    if (alpha <= 0.01) return;
    const words = line.words.filter((w) => w.w.trim());
    if (!words.length) return;
    const fam = F.archivo(100, this.msg ? 600 : 700);
    let size = this.lyricSize;
    const avail = STEPS.x1 - STEPS.x0;
    const widths = (sz: number) => { c.font = font(fam, sz); return words.map((w) => Math.max(sz * 1.12, c.measureText(w.w.trim()).width + sz * 0.3)); };
    let ws = widths(size);
    let total = ws.reduce((a, b) => a + b, 0);
    if (total > avail) { size = Math.max(40, Math.floor((size * avail) / total)); ws = widths(size); total = ws.reduce((a, b) => a + b, 0); }
    // 放不下就排兩排（第二排在後面、往上一點）
    let rows: [number, number][] = [[0, words.length]];
    if (total > avail && words.length > 1) {
      let acc = 0, cut = 1;
      for (let i = 0; i < words.length; i++) { acc += ws[i]!; if (acc >= total / 2) { cut = Math.max(1, i + 1); break; } }
      rows = [[0, cut], [cut, words.length]];
    }
    c.save();
    c.font = font(fam, size);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // 原文副行：像舞蹈教學圖腳印下面的說明，一行小字寫在地板上；有原文時腳印整排往上讓出位置（鞋跟不碰到原文）
    const sub = lyricSubOf(line);
    const ss = subSizeFor(size);
    const yLast = sub ? SUB_BASE - subGap(size, ss) - size * 0.35 - 8 : STEPS.y;
    rows.forEach(([a, b], ri) => {
      const rowW = ws.slice(a, b).reduce((p, q) => p + q, 0);
      let x = (STEPS.x0 + STEPS.x1) / 2 - rowW / 2;
      const y0 = yLast - (rows.length - 1 - ri) * size * 1.5;
      for (let i = a; i < b; i++) {
        const w = words[i]!, pw = ws[i]!;
        const cx = x + pw / 2;
        x += pw;
        const side = i % 2 ? 1 : -1;
        const cy = y0 + Math.sin((cx - STEPS.x0) / 170) * STEPS.wave + side * size * 0.07;
        const p = Lyrics.wordProgress(w, t);
        const stamp = p > 0 ? Math.exp(-(t - w.start) / 0.12) : 0;
        const sc = 1 + 0.25 * stamp;
        const ang = side * 0.12;
        c.save();
        c.globalAlpha = alpha;
        c.translate(cx, cy);
        c.rotate(ang);
        c.scale(sc, sc);
        // 鞋底：前掌一個橢圓、鞋跟一個小橢圓
        const L = size * 1.25, Wd = size * 0.55;
        c.beginPath();
        c.ellipse(0, -L * 0.12, Wd * 0.5, L * 0.36, 0, 0, Math.PI * 2);
        c.moveTo(Wd * 0.34, L * 0.4); c.ellipse(0, L * 0.4, Wd * 0.34, L * 0.14, 0, 0, Math.PI * 2);
        if (p <= 0) { c.setLineDash([4, 5]); c.strokeStyle = rgba('bone', 0.18); c.lineWidth = 1.5; c.stroke(); c.setLineDash([]); }
        else { c.fillStyle = p < 1 ? rgba('signal', 0.16 + 0.2 * stamp) : rgba('bone', 0.07); c.fill(); c.strokeStyle = p < 1 ? rgba('signal', 0.6) : rgba('bone', 0.25); c.lineWidth = 1.5; c.stroke(); }
        c.rotate(-ang);
        c.fillStyle = p >= 1 ? rgba('bone', this.msg ? 0.85 : 0.95) : p > 0 ? rgba('signal') : rgba('bone', 0.3);
        c.fillText(w.w.trim(), 0, 0);
        c.restore();
      }
    });
    if (sub) {
      // 比腳印上的中文安靜：唱到、唱完都是紙白再淡兩成（drawLyricSub 的規則），不踩、不發光
      c.globalAlpha = alpha;
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      c.translate((STEPS.x0 + STEPS.x1) / 2, SUB_BASE);
      drawLyricSub(c, sub, t, { family: fam, size, maxWidth: STEPS.x1 - STEPS.x0, align: 'center', sung: rgba('bone', this.msg ? 0.85 : 0.95), unsung: rgba('bone', 0.3) }, size, alpha);
    }
    c.restore();
  }

  /** 海報上的留言：第一拍起一個字一個字印出來（宋體、紙白），印完署名淡入；在海報上垂直置中。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const P = this.poster;
    const total = msgChars(n.fit);
    const per = clamp(1.4 / Math.max(1, total), 0.025, 0.09);
    const done = this.msgT0 + total * per;
    const top = P.y + PAD.top, h = P.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.5);
    drawNote(c, n, P.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('bone', 0.95) : rgba('bone', 0.6), sigColor: rgba('signal', 0.8), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}

