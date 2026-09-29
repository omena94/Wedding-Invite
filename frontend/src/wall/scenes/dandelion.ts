// 蒲公英（暗）：夜裡的草地，左邊一朵被月光從後面照亮的蒲公英。第一拍一陣風把它吹散——
// 每一顆種子的冠毛（細細的白色絨毛傘）底下吊著留言的一個字（英文一個字吊一個單字），
// 沿著風的弧線一顆一顆飄過畫面，落到天空右邊排成留言；落定的那一下，冠毛鬆開、自己往上飄走，只留下字。
// 之後每個小節線再來一陣風：蒲公英再掉幾顆空的種子飄走、字跟著風輕輕起伏（一道波從左傳到右）。
// 沒有留言：每一句歌詞由種子送來（句子要開始前飛到），唱到的字亮起；下一句來的時候上一句被吹走。
// 有留言時歌詞是畫面下緣、草地上的一行字幕。
// 手法：天空與月暈是 shader；蒲公英、飛行的冠毛、草是 LineBatch（冠毛用加亮，逆光的絨毛會發一點光）；字是每格重畫的 Canvas。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { Lyrics, type Word } from '../engine/lyrics';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, lyricSizeFor, beatAfter, COUPLE_ZH } from './_motifs';
import { layoutRows, drawRows, darkInk } from './_t4';
import { winBars } from './_t8';
import { msgBlock, loadAll, type Rect } from './_t15';
import { tokens } from '../engine/text';

export const spec: PlateSpecDecl = { group: 'type', family: 'nature', paper: false, energy: [0.1, 0.8], bars: [4, 8], weight: 1 };

/** 蒲公英的頭（畫面 px）與半徑、莖的根。 */
const HEAD = { x: 330, y: 540, r: 118 };
const STEM0 = { x: 250, y: 1090 };
/** 留言落在天空右邊這一塊；歌詞字幕在下緣。 */
const MSG = { x: 700, y: 150, w: 1080, h: 590 };
const SUB = { x: 560, base: 978, maxW: 760 };
const HORIZON = 850;
const NSEED = 170;

interface Unit { text: string; x: number; y: number; w: number; size: number; family: string; seed: number; tl: number; dur: number; tOff: number; words: Word[]; color: string }

const SKY = () => new FSPass(/* glsl */ `
  uniform float t; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 夜空：地平線附近帶一點訊號色的暗部，往上變深
    float hz = smoothstep(${HORIZON + 60}.0, 200.0, p.y);
    vec3 col = mix(C_INK2 * 1.05 + C_BLOOD * 0.035, C_INK * 0.55, hz);
    // 月暈（左上，畫面外）：蒲公英的逆光從這裡來
    vec2 m = p - vec2(90.0, 40.0);
    col += mix(C_BONE, C_SIGNAL, 0.3) * (0.075 * exp(-length(m) / 380.0) + 0.018 * exp(-length(m) / 1000.0));
    // 很稀的星
    vec2 g = floor(p / 5.0);
    float st = step(0.9982, hash12(g)) * (1.0 - smoothstep(200.0, 760.0, p.y));
    col += C_BONE * st * 0.35 * (0.6 + 0.4 * sin(t * 1.3 + hash12(g + 3.0) * 30.0));
    // 遠方的草地：一條起伏的暗帶（比天空暗）
    float hill = ${HORIZON}.0 - 30.0 * fbm(vec2(p.x / 420.0, 1.3), 3) - 14.0 * sin(p.x / 300.0);
    col = mix(col, C_INK * 0.7 + C_INK2 * 0.25, smoothstep(hill - 2.0, hill + 2.0, p.y));
    // 前景失焦的光點（遠處別的蒲公英）
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 c = vec2(hash11(fi * 4.1) * ${W}.0, ${HORIZON}.0 + 40.0 + hash11(fi * 2.3) * 200.0);
      float r = 30.0 + 50.0 * hash11(fi * 9.7);
      col += C_BONE * 0.025 * (1.0 - smoothstep(r * 0.75, r, length(p - c)));
    }
    fragColor = vec4(col * k, 1.0);
  }`, { t: { value: 0 }, k: { value: 1 } });

export default class Dandelion extends Scene {
  sky = shared('dandelion.sky', SKY);
  fluff = this.track(new LineBatch(9000, { screen2D: true, blend: 'add' }));
  grass = this.track(new LineBatch(1400, { screen2D: true, blend: 'normal' }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 409 + (this.msg?.id ?? 0) * 53) >>> 0;
  units: Unit[] = [];
  /** 頭上的種子：方向、長度（投影）、前後、被吹走的時間（Infinity = 還在）。 */
  heads: { a: number; r: number; z: number; tl: number }[] = [];
  /** 空的種子（小節線上的風吹走的）。 */
  empties: { i: number; t: number; dur: number }[] = [];
  bars: number[] = [];
  tG = 0; beat = 0.5;
  sig: { text: string; x: number; y: number; size: number; t: number } | null = null;
  lyrSize = 54;
  mode: 'msg' | 'lyric' | 'title' = 'msg';

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const lines = lyrics.linesIn(s - 1.5, e);
    await loadAll(this.msg, lines.map((l) => l.text).join(''), COUPLE_ZH);
    this.beat = au.beatPeriod(s);
    this.tG = beatAfter(au, s + 0.1);
    this.bars = winBars(au, s, e).filter((b) => b > this.tG + 0.3);
    for (let i = 0; i < NSEED; i++) {
      // 球面上均勻撒點（黃金角），投影到畫面：長度 = cos(仰角)、前後 = sin
      const y = 1 - (2 * (i + 0.5)) / NSEED, rr = Math.sqrt(1 - y * y), th = i * 2.39996;
      const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
      this.heads.push({ a: Math.atan2(y, x), r: Math.hypot(x, y), z, tl: Infinity });
    }
    this.mode = this.msg ? 'msg' : lines.length ? 'lyric' : 'title';
    const c = this.layer.ctx;
    if (this.mode === 'msg') {
      const b = msgBlock(c, this.msg!, F.ming(700), MSG.w, MSG.h, { min: 48, max: 118, lineHeight: 1.34, sigK: 0.42 });
      this.lyrSize = lyricSizeFor(b.fit.size);
      const n0 = this.units.length;
      b.fit.lines.forEach((ln, li) => this.placeRow(c, ln, b.fit.size, b.family, MSG.x, MSG.y + b.top + li * b.fit.lineHeight, [], 'left'));
      this.schedule(n0, this.tG, Math.min(2.6, Math.max(1.6, (e - this.tG) * 0.4)));
      const last = this.units[this.units.length - 1];
      this.sig = { text: b.sig, x: MSG.x + Math.max(b.fit.width, 300), y: MSG.y + b.sigY, size: b.sigSize, t: (last ? last.tl + last.dur : this.tG) + 0.2 };
    } else if (this.mode === 'lyric') {
      lines.forEach((l, li) => {
        const next = lines[li + 1];
        const lay = layoutRows(c, l, { family: F.archivo(100, 800), size: 96, minSize: 64, maxW: 1100, maxRows: 2, align: 'left', lineHeight: 1.18 });
        const n0 = this.units.length;
        // 一句在上、一句在下輪流：新的一句飛來的時候，上一句還在被吹走，不要疊在同一個地方
        const top = (li % 2 ? 600 : 300) - (lay.rows.length - 1) * lay.lineHeight * 0.5;
        const x0 = Math.min(1780 - lay.width, 1220 - lay.width / 2 + (li % 2 ? 60 : -40));
        lay.words.forEach((pw) => {
          const txt = pw.word.w.trim();
          if (!txt) return;
          this.units.push({ text: txt, x: x0 + pw.x, y: top + pw.y, w: pw.w, size: lay.size, family: F.archivo(100, 800), seed: 0, tl: 0, dur: 1, tOff: next ? next.start - 0.9 : Infinity, words: [pw.word], color: '' });
        });
        const launch = Math.max(s - 3, l.start - 1.9);
        this.schedule(n0, launch, 1.3);
      });
    } else {
      this.placeRow(c, COUPLE_ZH.replace(/\s*&\s*/, ' ♥ '), 120, F.ming(900), MSG.x + 120, 420, [], 'left');
      this.schedule(0, this.tG, 1.8);
    }
    // 小節線：每陣風吹走幾顆空的種子
    let k = 0;
    this.bars.forEach((b) => { for (let j = 0; j < 7; j++) this.empties.push({ i: k++, t: b + j * 0.04, dur: 2.6 + hash(this.seed, k, 4) }); });
    // 頭上的種子：送字的、吹走的依序從頭上拿走（離風來的那一邊近的先走）
    const order = this.heads.map((h, i) => ({ i, k: Math.cos(h.a) * h.r + 0.3 * h.z })).sort((a, b) => b.k - a.k).map((o) => o.i);
    let oi = 0;
    for (const u of this.units) { const hi = order[oi++ % NSEED]!; u.seed = hi; this.heads[hi]!.tl = Math.min(this.heads[hi]!.tl, u.tl); }
    for (const em of this.empties) { const hi = order[oi++ % NSEED]!; em.i = hi; this.heads[hi]!.tl = Math.min(this.heads[hi]!.tl, em.t); }
  }

  /** 一行字拆成幾顆種子（中文一字一顆、英文一個字一顆、♥ 一顆）。 */
  private placeRow(c: CanvasRenderingContext2D, text: string, size: number, family: string, x0: number, y: number, words: Word[], _align: 'left') {
    c.font = font(family, size);
    let at = 0;
    for (const tk of tokens(text)) {
      const t = tk.trimEnd();
      const x = x0 + c.measureText(text.slice(0, at)).width;
      at += tk.length;
      if (!t) continue;
      this.units.push({ text: t, x, y, w: c.measureText(t).width, size, family, seed: 0, tl: 0, dur: 1, tOff: Infinity, words, color: '' });
    }
  }

  /** 從 t0 開始一顆一顆起飛，maxDur 秒內全部飛出去；每顆飛 1.2～1.7 秒。 */
  private schedule(from: number, t0: number, spread: number) {
    const n = this.units.length - from;
    for (let i = 0; i < n; i++) {
      const u = this.units[from + i]!;
      u.tl = t0 + (n > 1 ? (i / (n - 1)) * spread * 0.8 : 0);
      u.dur = 1.15 + 0.5 * hash(this.seed, from + i, 1);
    }
  }

  /** 種子在頭上的位置（畫面 px）。 */
  private headPt(i: number, sway: number) {
    const h = this.heads[i]!;
    const R = HEAD.r * h.r;
    return { x: HEAD.x + sway + Math.cos(h.a) * R, y: HEAD.y + Math.sin(h.a) * R, z: h.z };
  }

  /** 一顆冠毛（絨毛傘）：中心 (x, y)，朝上張開；k = 亮度，s = 大小。 */
  private pappus(x: number, y: number, s: number, k: number, tilt: number) {
    const lb = this.fluff, b = LIN.bone;
    const col: [number, number, number] = [b[0] * 0.55 * k, b[1] * 0.55 * k, b[2] * 0.5 * k];
    for (let j = 0; j < 11; j++) {
      const a = -Math.PI / 2 + tilt + (j / 10 - 0.5) * 2.3;
      const L = s * (0.85 + 0.3 * Math.sin(j * 2.7));
      lb.seg2(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, 0.9, col, 0.9);
    }
    lb.seg2(x, y, x, y + s * 0.3, 1.4, [col[0] * 1.3, col[1] * 1.3, col[2] * 1.3], 1);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    // 風：小節線上一陣（第一陣在 tG）
    let gust = 0;
    for (const b of [this.tG, ...this.bars]) if (t >= b) { const a = t - b; gust += Math.sin(a * 5) * Math.exp(-a * 2); }
    const sway = gust * 10;
    this.sky.u.t!.value = t;
    this.sky.u.k!.value = clamp((t - s) / 0.3);
    this.sky.render(renderer, out);

    // ---- 草（前景，暗的剪影，邊緣一點月光），跟著風晃
    const gl = this.grass; gl.clear();
    const dark: [number, number, number] = [LIN.ink[0] * 0.6, LIN.ink[1] * 0.6, LIN.ink[2] * 0.6];
    for (let i = 0; i < 220; i++) {
      const x = (hash(this.seed, i, 1) * 1.1 - 0.05) * W, h = 60 + 150 * hash(this.seed, i, 2) ** 2;
      const bend = (hash(this.seed, i, 3) - 0.5) * 50 + gust * 18 * (h / 200);
      let px = x, py = H + 10;
      for (let k = 1; k <= 5; k++) {
        const u = k / 5, nx = x + bend * u * u, ny = H + 10 - h * u;
        gl.seg2(px, py, nx, ny, 5 * (1 - u) + 1, dark, 1);
        px = nx; py = ny;
      }
    }
    // 蒲公英的莖（細、微彎，頭跟著風晃）
    const lb = this.fluff; lb.clear();
    const hx = HEAD.x + sway;
    let sx = STEM0.x, sy = STEM0.y;
    for (let k = 1; k <= 16; k++) {
      const u = k / 16, iu = 1 - u;
      const cx = 200 + sway * 0.3, cy = 800;
      const nx = iu * iu * STEM0.x + 2 * iu * u * cx + u * u * hx, ny = iu * iu * STEM0.y + 2 * iu * u * cy + u * u * (HEAD.y + 20);
      gl.seg2(sx, sy, nx, ny, 5, [LIN.ink2[0] * 1.6, LIN.ink2[1] * 1.6, LIN.ink2[2] * 1.6], 1);
      lb.seg2(sx - 2, sy, nx - 2, ny, 1, [LIN.bone[0] * 0.12, LIN.bone[1] * 0.12, LIN.bone[2] * 0.1], 1);
      sx = nx; sy = ny;
    }
    gl.render(renderer, out);

    // ---- 頭上的種子：花托到冠毛的細柄＋冠毛（後面的暗一點；左上逆光那一邊亮）
    for (let i = 0; i < NSEED; i++) {
      const h = this.heads[i]!;
      if (t >= h.tl) continue;
      const p = this.headPt(i, sway);
      const k = (0.55 + 0.45 * (h.z * 0.5 + 0.5)) * (0.7 + 0.5 * Math.max(0, -Math.cos(h.a + 0.8)));
      lb.seg2(hx, HEAD.y, p.x, p.y, 0.8, [LIN.bone[0] * 0.28 * k, LIN.bone[1] * 0.28 * k, LIN.bone[2] * 0.26 * k], 1);
      this.pappus(p.x, p.y, 20 + 6 * h.z, k, h.a + Math.PI / 2);
    }
    // 花托（小小一顆）
    lb.seg2(hx - 1, HEAD.y, hx + 1, HEAD.y, 14, [LIN.bone[0] * 0.12, LIN.bone[1] * 0.1, LIN.bone[2] * 0.08], 1);

    // ---- 空的種子：小節線上被吹走（往右上飄出畫面）
    for (const em of this.empties) {
      const a = t - em.t;
      if (a < 0 || a > em.dur) continue;
      const u = a / em.dur, p0 = this.headPt(em.i, sway);
      const x = p0.x + u * (900 + 500 * hash(em.i, 2)) + 40 * Math.sin(a * 3 + em.i);
      const y = p0.y - u * (380 + 300 * hash(em.i, 3)) + 30 * Math.sin(a * 2.2);
      this.pappus(x, y, 22, 0.9 * (1 - u * u), 0.3 * Math.sin(a * 4));
    }

    // ---- 送字的種子
    const L = this.layer, c = L.ctx;
    L.clear();
    c.textBaseline = 'alphabetic';
    const avoid: Rect[] = [];
    for (const un of this.units) {
      const a = t - un.tl;
      if (a < 0) continue;
      const off = t - un.tOff;
      const p0 = this.headPt(un.seed, sway);
      const tx = un.x + un.w / 2, ty = un.y - un.size * 0.95;
      const u = clamp(a / un.dur);
      const q = ease.outCubic(u);
      // 風的弧線：先往右上甩出去，再從上面慢慢落到位置（三次貝茲＋一點左右晃）
      const hs = hash(this.seed, un.seed, 7);
      const c1 = { x: p0.x + 180 + 0.3 * (tx - p0.x) + 120 * hs, y: p0.y - 200 - 0.4 * (p0.y - ty) - 140 * hs }, c2 = { x: tx - 90 - 80 * hs, y: ty - 140 - 110 * hs };
      const iq = 1 - q;
      let x = iq * iq * iq * p0.x + 3 * iq * iq * q * c1.x + 3 * iq * q * q * c2.x + q * q * q * tx;
      let y = iq * iq * iq * p0.y + 3 * iq * iq * q * c1.y + 3 * iq * q * q * c2.y + q * q * q * ty;
      x += Math.sin(a * 3.1 + hs * 9) * 22 * (1 - q);
      // 落定之後：小節線的風讓字一起一伏（一道波從左傳到右）
      let bob = 0;
      for (const b of this.bars) if (t >= b) { const d = t - b - (un.x - MSG.x) / 1600; if (d > 0) bob += Math.sin(d * 7) * Math.exp(-d * 3) * 7; }
      y += u >= 1 ? bob : 0;
      // 被吹走（沒有留言、下一句來了）：往右上飄走、淡掉
      let fade = 1;
      if (off > 0) { const ww = ease.inCubic(clamp(off / 1.1)); x += ww * (500 + 300 * hs); y -= ww * (260 + 200 * hs); fade = 1 - ww; }
      if (fade <= 0.01) continue;
      // 冠毛：飛行時在字的上面；落定後鬆開、往上飄走淡掉
      const land = Math.max(0, a - un.dur);
      const pk = u < 1 ? 1 : Math.max(0, 1 - land / 0.9);
      if (pk > 0) {
        const px = x + land * 20, py = y - un.size * 0.28 - land * land * 90 - land * 40;
        if (u < 1) lb.seg2(x, y - un.size * 0.28, x, y + 4, 1, [LIN.bone[0] * 0.3, LIN.bone[1] * 0.3, LIN.bone[2] * 0.28], 1);
        this.pappus(px, py, Math.min(34, 16 + un.size * 0.22), 1.1 * pk * fade, Math.sin(a * 2.3 + hs * 6) * 0.3);
      }
      // 字：吊在冠毛下面（起飛時小、落定時是原本大小）
      const sc = lerp(0.45, 1, ease.outCubic(u));
      c.save();
      c.globalAlpha = clamp(a / 0.25) * fade;
      c.translate(x, y + un.size * 0.95 * sc);
      c.scale(sc, sc);
      c.font = font(un.family, un.size);
      if (un.words.length) {
        // 歌詞：還沒唱淡、正在唱訊號色、唱完紙白
        const w = un.words[0]!, pr = Lyrics.wordProgress(w, t);
        c.textAlign = 'center';
        c.fillStyle = rgba('bone', 0.35); if (pr < 1) c.fillText(un.text, 0, 0);
        if (pr > 0) {
          c.save(); c.beginPath(); c.rect(-un.w / 2 - 6, -un.size * 1.2, (un.w + 12) * pr, un.size * 1.6); c.clip();
          c.fillStyle = pr < 1 ? rgba('signal') : rgba('bone', 0.96); c.fillText(un.text, 0, 0); c.restore();
        }
      } else {
        c.fillStyle = rgba('bone', 0.96);
        fillWithHearts(c, un.text, -un.w / 2, 0);
      }
      c.restore();
      if (u >= 1) avoid.push([Math.round(un.x), Math.round(un.y - un.size), Math.round(un.w), Math.round(un.size * 1.3)]);
    }
    // 署名：最後一顆落定後淡入
    if (this.sig && t > this.sig.t) {
      c.save();
      c.globalAlpha = clamp((t - this.sig.t) / 0.5);
      c.font = font(F.ming(700), this.sig.size); c.fillStyle = rgba('bone', 0.66); c.textAlign = 'right';
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
      c.restore();
    }
    // 有留言：歌詞是草地上的一行字幕
    if (this.mode === 'msg') {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: F.archivo(100, 800), size: this.lyrSize, minSize: 48, maxW: SUB.maxW, maxRows: 2, lineHeight: 1.12 });
        c.save();
        c.translate(SUB.x, SUB.base - (lay.rows.length - 1) * lay.lineHeight);
        drawRows(c, lay, F.archivo(100, 800), t, darkInk(), ly.k);
        c.restore();
      }
    }
    lb.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    return { bloom: 0.7, vignette: 0.6, zoom: 1 + 0.035 * ease.inOutCubic(f.p), popupAvoid: avoid.length ? [bbox(avoid)] : [] };
  }
}

function bbox(rs: Rect[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w, h] of rs) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
  return [x0, y0, x1 - x0, y1 - y0];
}
