// 花開（亮）：窗台上一只長長的木頭花箱，每一句歌詞是一排花——句子要來之前莖從土裡竄出來（花苞），
// 唱到哪個字，那一朵就在那一刻綻開（花瓣彈開），字就寫在花心；下一句來的時候這排花縮回土裡、新的一排冒出來。
// 拍點上開好的花點一下頭，小節線上一陣風。主打留言寫在花箱正面貼的牛皮紙標籤上。
// 手法：花是一個全螢幕 shader（SDF 花瓣兩層、花心的點刻，版畫的兩色套印：紙、墨、一個特別色＝主題的訊號色），
// 莖與葉是 LineBatch，花箱與標籤是一張只畫一次的 Canvas，花心的字是每格重畫的小 Canvas 層。
// 沒有留言時標籤寫新人的名字（小一點），花（歌詞）當主角、字大一級；純音樂時花在拍點上一朵一朵開（沒有字）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { fillWithHearts } from '../engine/motifs';
import { lyricSizeFor, beatAfter, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { winBeats, winBars, no3, blit } from './_t8';
import { Paper } from './_t11';
import { msgBlock, loadAll, INVITE, type MsgBlock, type Rect } from './_t15';

export const spec: PlateSpecDecl = { group: 'type', family: 'nature', paper: true, energy: [0.2, 1], bars: [4, 8], weight: 1 };

const MAXF = 40;
/** 花箱：正面的上緣（土）、左右、下緣；標籤。 */
const BOX = { x0: 96, x1: 1824, top: 606, bot: 1016 };
const LABEL = { x: 170, y: 640, w: 1160, h: 346 };
/** 花排在這一帶（一排或兩排）。 */
const ROW1 = 318, ROW2A = 226, ROW2B = 420;
const FAM = F.archivo(100, 800);

interface Fl { text: string; words: { start: number; end: number; w: string; syl?: [number, number][] }[]; x: number; y: number; disc: number; out: number; n: number; rot: number; bx: number; t0: number; line: number }
interface Row { flowers: Fl[]; tIn: number; tOut: number; size: number }

const SHADER = () => new FSPass(/* glsl */ `
  uniform vec4 fa[${MAXF}];   // x, y（px，y 向下）、花心半徑、花瓣外徑
  uniform vec4 fb[${MAXF}];   // 開的程度、縮放、旋轉、花瓣數
  uniform int nf;
  // 一朵花在 q（相對花心）：回傳預乘的顏色（有 alpha）
  vec4 flower(vec2 q, vec4 A, vec4 B, float fi) {
    float sc = B.y;
    q /= sc;
    float disc = A.z, outR = A.w, open = B.x, N = B.w;
    float rho = length(q);
    float ang = atan(q.y, q.x) + B.z + (1.0 - open) * 0.7;
    vec4 res = vec4(0.0);
    float px = 1.0 / sc;             // 一個畫面像素在花的座標裡多長
    // 花瓣：後面一層（深一點、錯開半瓣）、前面一層
    for (int j = 0; j < 2; j++) {
      float fj = float(j);
      float seg = TAU / N;
      float a = ang + fj * seg * 0.5;
      float da = mod(a + seg * 0.5, seg) - seg * 0.5;
      float u = rho * cos(da), v = rho * sin(da);
      float lk = mix(0.18, 1.0, open) * (fj < 0.5 ? 1.06 : 0.94);
      float rin = disc * 0.8, rout = disc + (outR - disc) * lk;
      float c = (rin + rout) * 0.5, L = (rout - rin) * 0.5 + 5.0;
      float wv = min(c * sin(seg * 0.5) * 1.18, L * 0.72);
      // 花瓣的尖端稍微收一點（像真的花瓣，不是橢圓）
      float uu = (u - c) / L;
      float taper = 1.0 - 0.28 * smoothstep(0.1, 1.0, uu);
      float sd = (length(vec2(uu, v / (wv * taper))) - 1.0) * min(L, wv);
      float inside = 1.0 - smoothstep(-0.7 * px, 0.7 * px, sd);
      if (inside <= 0.0) continue;
      // 特別色（訊號色套在紙上）＋順著花瓣的排線（靠根部、靠邊緣越密）＋墨線外框
      vec3 spot = mix(C_PAPER, mix(C_SIGNAL, C_BLOOD, 0.25 + 0.25 * (1.0 - fj)), 0.6 - 0.12 * fj);
      float dark = 0.12 + 0.55 * smoothstep(0.35, 1.0, abs(v) / wv) + 0.4 * (1.0 - smoothstep(-1.0, 0.2, uu)) + 0.25 * (1.0 - fj);
      float hv = abs(fract(v / 6.5) - 0.5) * 6.5;
      float hl = 1.0 - smoothstep(0.35 + dark * 1.2 - 0.6 * px, 0.35 + dark * 1.2 + 0.6 * px, hv);
      hl *= smoothstep(0.05, 0.3, dark) * step(-0.95, uu);
      vec3 col = mix(spot, C_SEPIA, hl * 0.8);
      col = mix(col, C_SEPIA, 1.0 - smoothstep(1.1 * px, 2.3 * px, abs(sd)));
      res = vec4(col, 1.0) * inside + res * (1.0 - inside);
    }
    // 花心：紙色的圓盤，邊緣一圈點刻、一條墨線
    float dd = rho - disc;
    float din = 1.0 - smoothstep(-0.7 * px, 0.7 * px, dd);
    if (din > 0.0) {
      vec3 col = C_PAPER * 1.02;
      vec2 g = floor(q / 7.0);
      vec2 gc = (g + 0.5 + (hash22(g + fi * 13.0) - 0.5) * 0.6) * 7.0;
      float ring = smoothstep(0.62, 0.8, length(gc) / disc) * (1.0 - smoothstep(0.93, 0.99, length(gc) / disc));
      float dot_ = (1.0 - smoothstep(1.0, 2.0, length(q - gc))) * ring * step(0.35, hash12(g + fi));
      col = mix(col, C_SEPIA, dot_ * 0.7);
      col = mix(col, C_SEPIA, 1.0 - smoothstep(1.0 * px, 2.2 * px, abs(dd)));
      res = vec4(col, 1.0) * din + res * (1.0 - din);
    }
    return res;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec4 acc = vec4(0.0);
    for (int i = 0; i < ${MAXF}; i++) {
      if (i >= nf) break;
      vec4 A = fa[i], B = fb[i];
      if (B.y <= 0.01) continue;
      vec2 q = p - A.xy;
      float rr = A.w * B.y + 4.0;
      if (dot(q, q) > rr * rr) continue;
      vec4 f = flower(q, A, B, float(i));
      acc = f + acc * (1.0 - f.a);
    }
    fragColor = acc;
  }`, {
  fa: { value: Array.from({ length: MAXF }, () => new THREE.Vector4()) },
  fb: { value: Array.from({ length: MAXF }, () => new THREE.Vector4()) },
  nf: { value: 0 },
}, { over: true });

export default class Flowers extends Scene {
  paper = shared('t15.paper', () => new Paper());
  pass = shared('flowers.pass', SHADER);
  box = this.track(new Layer2D(W, H, undefined, { fast: true }));
  chars = this.track(new Layer2D(W, 620, undefined, { fast: true }));
  stems = this.track(new LineBatch(6000, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 613 + (this.msg?.id ?? 0) * 71) >>> 0;
  rows: Row[] = [];
  block: MsgBlock | null = null;
  bars: number[] = [];
  beats: number[] = [];
  size = 54;
  noLyrics = false;

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const lines = lyrics.linesIn(s - 0.6, e);
    await loadAll(this.msg, lines.map((l) => l.text).join(''), `${COUPLE_ZH}${DATE_DOTS}${no3(this.msg?.n ?? 0)}`);
    this.beats = winBeats(au, s, e);
    this.bars = winBars(au, s, e).filter((b) => b > s + 0.1);
    this.drawBox();
    this.size = this.msg ? lyricSizeFor(this.block!.fit.size) : 68;
    this.noLyrics = !lyrics.has || lines.length === 0;
    if (!this.noLyrics) {
      lines.forEach((l, i) => {
        const next = lines[i + 1];
        const tIn = l.start - 0.5;
        const tOut = next ? next.start - 0.5 : Math.max(e + 1, l.end + 6);
        this.rows.push(this.layoutLine(l, tIn, tOut, i));
      });
    } else {
      // 純音樂：七朵沒有字的花，一拍開一朵
      const b0 = beatAfter(au, s + 0.1);
      const beats = this.beats.filter((b) => b >= b0);
      const fl: Fl[] = [];
      for (let i = 0; i < 7; i++) {
        const tb = beats[i + 1] ?? b0 + i * au.beatPeriod(s);
        const x = 300 + i * 220 + (hash(this.seed, i) - 0.5) * 40;
        const disc = 34 + 10 * hash(this.seed, i, 2);
        fl.push({ text: '', words: [{ start: tb, end: tb + 0.3, w: '' }], x, y: ROW1 + (hash(this.seed, i, 3) - 0.5) * 90, disc, out: disc + 52 + 20 * hash(this.seed, i, 4), n: 9 + Math.floor(hash(this.seed, i, 5) * 5), rot: hash(this.seed, i, 6) * TAU, bx: x + (hash(this.seed, i, 7) - 0.5) * 60, t0: b0, line: 0 });
      }
      this.rows.push({ flowers: fl, tIn: s + 0.05, tOut: e + 10, size: 0 });
    }
  }

  /** 一句歌詞排成一排（或兩排）花：中文一字一朵、英文一字一朵，花心的大小照字寬。 */
  private layoutLine(l: Line, tIn: number, tOut: number, li: number): Row {
    const c = this.chars.ctx;
    const size = this.size;
    c.font = font(FAM, size);
    // 標點黏在前一朵（不要單獨一朵花開一個逗號）
    const groups: { text: string; words: Line['words'] }[] = [];
    for (const w of l.words) {
      const txt = w.w.trim();
      if (!txt) continue;
      const last = groups[groups.length - 1];
      if (last && /^[\p{P}\s]+$/u.test(txt)) { last.text += txt; last.words.push(w); continue; }
      groups.push({ text: txt, words: [w] });
    }
    const pitchOf = (t: string) => Math.max(size * 1.55, c.measureText(t).width + size * 0.7);
    const widths = groups.map((g) => pitchOf(g.text));
    const total = widths.reduce((a, b) => a + b, 0);
    // 太長就排兩排（從中間附近的空白或字與字之間斷開）
    let cut = groups.length;
    if (total > 1560 && groups.length > 1) {
      let acc = 0, best = 1, bestD = Infinity;
      for (let k = 1; k < groups.length; k++) { acc += widths[k - 1]!; const d = Math.abs(acc - total / 2); if (d < bestD) { bestD = d; best = k; } }
      cut = best;
    }
    const rowsIdx = cut < groups.length ? [[0, cut], [cut, groups.length]] : [[0, groups.length]];
    const flowers: Fl[] = [];
    rowsIdx.forEach(([a, b], ri) => {
      const ws = widths.slice(a, b);
      let tw = ws.reduce((x, y) => x + y, 0);
      // 字距縮到放得下（花會重疊，看起來像一叢）
      const k = Math.min(1, 1600 / tw);
      tw *= k;
      let x = W / 2 - tw / 2 - 30;
      const yBase = rowsIdx.length > 1 ? (ri === 0 ? ROW2A : ROW2B) : ROW1;
      for (let i = a; i < b; i++) {
        const g = groups[i]!, pw = widths[i]! * k;
        const cx = x + pw / 2;
        x += pw;
        const tw1 = c.measureText(g.text).width;
        const disc = Math.max(size * 0.74, tw1 / 2 + size * 0.36);
        const hsh = (q: number) => hash(this.seed, li * 97 + i, q);
        flowers.push({
          text: g.text, words: g.words, x: cx, y: yBase + (hsh(1) - 0.5) * 50,
          disc, out: disc + size * (0.95 + 0.35 * hsh(2)), n: Math.max(8, Math.round((disc * 2 * Math.PI) / (size * 0.62))),
          rot: hsh(3) * TAU, bx: cx + (hsh(4) - 0.5) * 70, t0: tIn + (i - a) * 0.025, line: li,
        });
      }
    });
    return { flowers, tIn, tOut, size };
  }

  /** 花箱（木板、木紋、土）與牛皮紙標籤（留言），只畫一次。 */
  private drawBox() {
    const L = this.box, c = L.ctx;
    L.clear();
    const { x0, x1, top, bot } = BOX;
    // 花箱在窗台上的影子
    const sg = c.createLinearGradient(0, bot, 0, bot + 50);
    sg.addColorStop(0, rgba('sepia', 0.22)); sg.addColorStop(1, rgba('sepia', 0));
    c.fillStyle = sg; c.fillRect(x0 + 20, bot, x1 - x0, 50);
    // 土：一條暗的點刻帶
    c.fillStyle = rgba('sepia', 0.85);
    c.fillRect(x0 + 14, top - 12, x1 - x0 - 28, 16);
    for (let i = 0; i < 400; i++) {
      const x = x0 + 14 + hash(this.seed, i, 1) * (x1 - x0 - 28), y = top - 14 - hash(this.seed, i, 2) * 8;
      c.beginPath(); c.arc(x, y, 1.2 + hash(i, 3) * 1.6, 0, TAU); c.fill();
    }
    // 正面：兩塊木板（紙色＋木紋排線＋板縫），上緣一條受光的邊
    c.fillStyle = rgba('paper', 1);
    c.fillRect(x0, top, x1 - x0, bot - top);
    c.fillStyle = rgba('blood', 0.1); c.fillRect(x0, top, x1 - x0, bot - top);
    c.lineCap = 'round';
    const mid = (top + bot) / 2;
    for (let i = 0; i < 46; i++) {
      const y0 = top + 8 + i * ((bot - top - 16) / 46);
      c.strokeStyle = rgba('sepia', 0.1 + 0.12 * hash(this.seed, i, 9)); c.lineWidth = 1.1;
      c.beginPath();
      for (let x = x0 + 6; x <= x1 - 6; x += 24) {
        const y = y0 + 3 * Math.sin(x / 170 + i * 0.7) + 5 * Math.exp(-((x - 700 - i * 7) ** 2) / 9000) * Math.sin(i);
        if (x === x0 + 6) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 2.4;
    c.strokeRect(x0, top, x1 - x0, bot - top);
    c.beginPath(); c.moveTo(x0, mid); c.lineTo(x1, mid); c.stroke();
    c.strokeStyle = rgba('sepia', 0.45); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(x0, top + 6); c.lineTo(x1, top + 6); c.stroke();
    // 標籤：牛皮紙、稍微歪、四角各一顆小釘子
    const m = this.msg;
    c.save();
    c.translate(LABEL.x + LABEL.w / 2, LABEL.y + LABEL.h / 2);
    c.rotate(-0.008);
    c.translate(-LABEL.w / 2, -LABEL.h / 2);
    c.save();
    c.shadowColor = rgba('sepia', 0.35); c.shadowBlur = 10; c.shadowOffsetX = 4; c.shadowOffsetY = 6;
    c.fillStyle = rgba('paper', 1); c.fillRect(0, 0, LABEL.w, LABEL.h);
    c.restore();
    c.fillStyle = rgba('sepia', 0.1); c.fillRect(0, 0, LABEL.w, LABEL.h);
    c.fillStyle = rgba('signal', 0.12); c.fillRect(0, 0, LABEL.w, LABEL.h);
    c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 1.5; c.strokeRect(10, 10, LABEL.w - 20, LABEL.h - 20);
    for (const [x, y] of [[22, 22], [LABEL.w - 22, 22], [22, LABEL.h - 22], [LABEL.w - 22, LABEL.h - 22]] as const) {
      c.fillStyle = rgba('sepia', 0.6); c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill();
      c.fillStyle = rgba('paper', 0.7); c.beginPath(); c.arc(x - 1.5, y - 1.5, 1.6, 0, TAU); c.fill();
    }
    c.textBaseline = 'alphabetic';
    if (m) {
      const b = msgBlock(c, m, F.hand(700), LABEL.w - 130, LABEL.h - 40, { min: 50, max: 118, lineHeight: 1.24, sigK: 0.42 });
      this.block = b;
      c.font = font(b.family, b.fit.size); c.fillStyle = rgba('sepia', 0.96);
      b.fit.lines.forEach((ln, i) => fillWithHearts(c, ln, 64, 20 + b.top + i * b.fit.lineHeight));
      c.font = font(b.family, b.sigSize); c.fillStyle = rgba('sepia', 0.7); c.textAlign = 'right';
      c.fillText(b.sig, LABEL.w - 64, 20 + b.sigY);
      if (m.couple) { c.font = font(F.hei(500), 18); c.letterSpacing = '6px'; c.fillStyle = rgba('blood', 0.8); c.fillText('新人', LABEL.w - 40, 44); c.letterSpacing = '0px'; }
    } else {
      c.textAlign = 'left';
      c.font = font(F.ming(900), 70); c.fillStyle = rgba('sepia', 0.95);
      c.fillText(COUPLE_ZH, 64, 150);
      c.font = font(F.mono(500), 24); c.letterSpacing = '6px'; c.fillStyle = rgba('blood', 0.85);
      c.fillText(DATE_DOTS, 68, 204);
      c.letterSpacing = '0px';
      c.font = font(F.hei(500), 22); c.fillStyle = rgba('sepia', 0.6);
      c.fillText(INVITE, 68, 262);
    }
    c.restore();
    // 花箱右邊的小字（編號）
    c.font = font(F.mono(500), 17); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.45); c.textAlign = 'left';
    c.fillText(`${m ? no3(m.n) : 'No.000'} · ${DATE_DOTS}`, LABEL.x + LABEL.w + 36, top + 44);
    c.letterSpacing = '0px';
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out, {});
    // 風（小節線上一陣）與點頭（每一拍）
    let wind = 0;
    for (const b of this.bars) if (t >= b) { const a = t - b; wind += Math.sin(a * 6.5) * Math.exp(-a * 2.4); }
    let nod = 0;
    for (const b of this.beats) if (t >= b && t - b < 0.6) nod = Math.max(nod, Math.exp(-(t - b) * 7));
    const lb = this.stems; lb.clear();
    const C = this.chars, cc = C.ctx; C.clear();
    const fa = this.pass.u.fa!.value as THREE.Vector4[], fbv = this.pass.u.fb!.value as THREE.Vector4[];
    let n = 0;
    const sep = LIN.sepia;
    const avoid: Rect[] = [];
    for (const row of this.rows) {
      if (t < row.tIn - 0.05 || t > row.tOut + 0.4) continue;
      const out = ease.inCubic(prog(t, row.tOut, row.tOut + 0.32));
      for (const fl of row.flowers) {
        if (n >= MAXF) break;
        const grow = ease.outExpo(prog(t, fl.t0, fl.t0 + 0.34)) * (1 - out);
        if (grow <= 0.001) continue;
        // 開花：那個字唱到的那一刻（彈開）
        const w0 = fl.words[0]!;
        const open = ease.outBack(prog(t, w0.start - 0.04, w0.start + 0.36), 2.0) * (1 - out * 0.6);
        const opened = t >= w0.start;
        const sway = wind * 16 * (fl.y < 400 ? 1.2 : 1) * (0.7 + 0.6 * hash(fl.x, 1));
        const hx = fl.x + sway, hy = fl.y + (BOX.top - fl.y) * (1 - grow) + (opened ? nod * 5 : 0);
        const sc = lerp(0.35, 1, grow) * (1 + 0.04 * nod * (opened ? 1 : 0));
        // 莖（二次曲線，從土裡長到花心下面）與一兩片葉子
        const bx = fl.bx, by = BOX.top - 4;
        const mx = (bx + hx) / 2 + (hash(fl.x, 2) - 0.5) * 60 + sway * 0.4, my = (by + hy) / 2;
        let px = bx, py = by;
        for (let k = 1; k <= 12; k++) {
          const u = k / 12, iu = 1 - u;
          const x = iu * iu * bx + 2 * iu * u * mx + u * u * hx, y = iu * iu * by + 2 * iu * u * my + u * u * hy;
          lb.seg2(px, py, x, y, 3.2 - u * 0.8, sep, 0.92);
          if (k === 5 || k === 8) {
            const side = (k === 5 ? 1 : -1) * (hash(fl.x, 3) < 0.5 ? 1 : -1);
            const a = Math.atan2(y - py, x - px) + side * 1.1;
            const L = 44 * grow, ca = Math.cos(a), sa = Math.sin(a);
            let qa = { x, y }, qb = { x, y };
            for (let j = 1; j <= 6; j++) {
              const uu = j / 6, v = Math.sin(uu * Math.PI) * 11 * grow;
              const na = { x: x + ca * L * uu - sa * v, y: y + sa * L * uu + ca * v }, nb = { x: x + ca * L * uu + sa * v, y: y + sa * L * uu - ca * v };
              lb.seg2(qa.x, qa.y, na.x, na.y, 1.6, sep, 0.9); lb.seg2(qb.x, qb.y, nb.x, nb.y, 1.6, sep, 0.9);
              lb.seg2(x + ca * L * (uu - 1 / 6), y + sa * L * (uu - 1 / 6), x + ca * L * uu, y + sa * L * uu, 0.9, sep, 0.6);
              qa = na; qb = nb;
            }
          }
          px = x; py = y;
        }
        fa[n]!.set(hx, hy, fl.disc, fl.out);
        fbv[n]!.set(clamp(open), sc, fl.rot + wind * 0.08, fl.n);
        n++;
        // 花心的字：還沒唱淡淡的、正在唱訊號色的暗部、唱完墨色
        if (fl.text) {
          const p = fl.words.reduce((acc, w) => acc + Lyrics.wordProgress(w as Word, t), 0) / fl.words.length;
          cc.save();
          cc.translate(hx, hy + row.size * 0.36 * sc);
          cc.scale(sc, sc);
          cc.font = font(FAM, row.size); cc.textAlign = 'center'; cc.textBaseline = 'alphabetic';
          const tw = cc.measureText(fl.text).width;
          cc.globalAlpha = clamp(grow * 1.5);
          if (p < 1) { cc.fillStyle = rgba('sepia', 0.3); cc.fillText(fl.text, 0, 0); }
          if (p > 0) {
            cc.save(); cc.beginPath(); cc.rect(-tw / 2 - 6, -row.size * 1.2, (tw + 12) * p, row.size * 1.6); cc.clip();
            cc.fillStyle = p < 1 ? rgba('blood') : rgba('sepia', 0.96);
            cc.fillText(fl.text, 0, 0);
            cc.restore();
          }
          cc.restore();
          avoid.push([Math.round(hx - fl.disc), Math.round(hy - fl.disc), Math.round(fl.disc * 2), Math.round(fl.disc * 2)]);
        }
      }
    }
    this.pass.u.nf!.value = n;
    // 土上的一叢矮葉子（跟著風晃）
    for (let i = 0; i < 34; i++) {
      const x = BOX.x0 + 40 + i * ((BOX.x1 - BOX.x0 - 80) / 33) + (hash(this.seed, i, 21) - 0.5) * 30;
      const k = clamp((t - s - 0.1 - i * 0.008) / 0.3);
      if (k <= 0) continue;
      const a = -Math.PI / 2 + (hash(this.seed, i, 22) - 0.5) * 1.6 + wind * 0.12;
      const L = (38 + 34 * hash(this.seed, i, 23)) * ease.outBack(k), ca = Math.cos(a), sa = Math.sin(a);
      const x0 = x, y0 = BOX.top - 6;
      let qa = { x: x0, y: y0 }, qb = qa;
      for (let j = 1; j <= 6; j++) {
        const u = j / 6, v = Math.sin(u * Math.PI) * L * 0.2;
        const na = { x: x0 + ca * L * u - sa * v, y: y0 + sa * L * u + ca * v }, nb = { x: x0 + ca * L * u + sa * v, y: y0 + sa * L * u - ca * v };
        lb.seg2(qa.x, qa.y, na.x, na.y, 1.6, sep, 0.85); lb.seg2(qb.x, qb.y, nb.x, nb.y, 1.6, sep, 0.85);
        qa = na; qb = nb;
      }
      lb.seg2(x0, y0, x0 + ca * L * 0.9, y0 + sa * L * 0.9, 1, sep, 0.55);
    }
    lb.render(renderer, out);
    this.pass.render(renderer, out);
    comp.draw(renderer, this.box.texture, out, { opacity: clamp((t - s) / 0.2) });
    blit(this.ctx, C.upload(), 0, 0, W, 620, out);
    avoid.push([LABEL.x - 10, LABEL.y - 10, LABEL.w + 20, LABEL.h + 20]);
    return { paper: 1, bloom: 0.25, vignette: 0.35, zoom: 1 + 0.03 * ease.inOutCubic(f.p), popupAvoid: avoid };
  }
}
