// 雷達（機器 B，暗）：暗房間裡一台「心動雷達」的圓形顯示器（PPI），鏡頭從控制台前面稍微往下看著它。
//  - 掃描線一小節轉一圈（正北是小節線，每一拍剛好掃過東、南、西），後面拖著一片磷光的餘暉；大鼓時從圓心打出一圈「回波」。
//    距離環、方位線很淡；圓心附近的地面雜波只在掃描線剛掃過時看得到。
//  - 每一則留言（ctx.params.messages）都是一個光點（排成向日葵螺旋，均勻散開），掃描線掃過時亮起、慢慢暗掉——這是場景，沒有標籤。
//  - 主視覺是左邊的大圓形雷達。每兩小節「偵測到新目標」：一個光點周圍擴出一圈回波（窗格中段的小事件）。
//  - 主打留言是「鎖定的目標」傳來的話。它的方位算好了（東邊、靠近右邊的留言），讓掃描線剛好在頭一小節的某一拍掃到它：
//    那一刻四個角框套住它，一條細線拉到右邊控制台上的留言。留言用磷光寫在控制台右邊一小塊（手寫字，v2 字級），
//    一段一段解碼出來，署名在最後一行下面。鎖定後目標慢慢往圓心靠近。
//  - 歌詞也在右邊、留言下面，比留言小（逐字跟唱）。配角文字只有一小行鎖定讀數。
//  - 沒有留言：右邊放歌詞，上面一行小小的邀請。純音樂：歌名。
//  - 鏡頭：焦點轉移——開場對焦在雷達上，鎖定之後移到留言。
// 手法：螢幕（GLSL）＋掃描線、光點、角框（LineBatch）＋字（Canvas）畫進離屏圖，再用 _t8 的舞台當成控制台上的一台螢幕來拍。
import type * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, hash, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, lyricSubOf, layoutLyric, drawLyric, signature, beatAfter } from './_motifs';
import { blit, label, INVITE, T8_TEXT, Stage, camMove, type StageCam } from './_t8';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'machine', paper: false, energy: [0.25, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（螢幕座標，px）
const C = { x: 700, y: 540 }, R = 440;
/** 留言寫在玻璃上的範圍（圓的上半部）。 */
const MS = { x: 1236, y: 250, w: 600, h: 400 };
/** 歌詞（圓的下半部，弦比較短）。 */
const LY = { x: 1236, y: 666, w: 580, h: 140 };
/**
 * 韓文歌有原文副行時歌詞用的範圍：往上多 SUB_UP（上面的邀請小字在 604 附近，還有空），下緣不動（再下面是右下角 QR 區）。
 * 中文兩排＋原文會比 140 高，原本的圖層會把第一排的字頂切掉。
 */
const SUB_UP = 44;
const LYS = { ...LY, y: LY.y - SUB_UP, h: LY.h + SUB_UP };
const RANGE_KM = 5;
/** 字後面要安靜的範圍（中心、半寬、半高）：留言＋歌詞。 */
const CALM = { x: C.x, y: C.y, w: 1, h: 1 };
/** 基本機位（沒有加鏡頭運動）：init 用它換算字級。 */
const CAM: StageCam = { yaw: 0.04, pitch: -0.1, roll: 0.006, zoom: 0.96, y: 10, dof: 1.2, bezel: 50, radius: 40, glass: 0.8, room: [0, 0, 0], glow: 0.02 };
const TEXT = `${T8_TEXT}心動雷達鎖定目標掃描一圈小節方位距離接近中搜尋中—·♪`;

const SCOPE = () => new FSPass(/* glsl */ `
  uniform float sweep; uniform float on; uniform float ping; uniform float pingA; uniform vec4 calm; uniform float calmK;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    // 控制台面板：暗、有一點點拉絲
    vec3 col = mix(C_INK, C_INK2, 0.55 + 0.1 * snoise(vec2(p.x / 700.0, p.y / 2.0)));
    vec2 q = p - vec2(${C.x}.0, ${C.y}.0);
    float r = length(q);
    float ang = atan(q.x, -q.y);
    if (ang < 0.0) ang += TAU;
    float d = r - ${R}.0;
    // 圓框：一圈暗環、內外細高光、很淡的刻度
    col = mix(col, C_INK * 0.7, step(0.0, d) * (1.0 - smoothstep(26.0, 29.0, d)));
    col += C_BONE * 0.06 * pxLine(abs(d - 28.0), 0.3, 1.1) + C_BONE * 0.1 * pxLine(abs(d), 0.3, 1.1);
    float a10 = abs(mod(ang + PI / 36.0, PI / 18.0) - PI / 36.0) * r;
    col += C_BONE * 0.12 * pxLine(a10, 0.3, 1.1) * step(4.0, d) * step(d, 12.0) * on;
    if (d < 0.0) {
      vec3 g = C_INK * 0.4 + C_SIGNAL * 0.005;
      g *= 0.6 + 0.4 * smoothstep(0.0, -120.0, d);
      float behind = mod(sweep - ang, TAU);
      float glow = exp(-behind / 1.0);
      float fresh = exp(-behind / 0.09);
      // 字的後面安靜一點：雜波與餘暉在留言、歌詞的範圍裡變淡（不加框）
      vec2 bq = (p - calm.xy) / calm.zw;
      float quiet = 1.0 - calmK * exp(-dot(bq, bq) * 1.6);
      float ringD = abs(fract(r / ${(R / 5).toFixed(2)} + 0.5) - 0.5) * ${(R / 5).toFixed(2)};
      float rings = pxLine(ringD, 0.3, 1.1) * step(r, ${R}.0 * on);
      float a30 = abs(mod(ang + PI / 12.0, PI / 6.0) - PI / 12.0) * r;
      float spokes = pxLine(a30, 0.3, 1.0) * step(r, ${R}.0 * on) * step(24.0, r);
      vec3 gc = mix(C_BONE, C_SIGNAL, 0.55);
      g += gc * (rings * 0.05 + spokes * 0.018) * (0.5 + 1.0 * glow) * (0.4 + 0.6 * quiet);
      float n = fbm(q / 26.0 + vec2(3.1, 7.7), 3) * 0.5 + 0.5;
      float clutter = smoothstep(0.6, 0.86, n) * exp(-r / 200.0);
      float speck = smoothstep(0.94, 0.99, hash12(floor(p / 3.0))) * 0.4;
      g += C_SIGNAL * (0.05 * glow + 0.45 * clutter * glow + speck * glow * 0.2) * on * quiet;
      g += C_SIGNAL * 0.1 * fresh * on * (0.5 + 0.5 * quiet);
      g += C_SIGNAL * pingA * (0.3 * pxLine(abs(r - ping), 0.6, 3.5) + 0.03 * exp(-abs(r - ping) / 40.0)) * step(r, ping + 60.0) * quiet;
      col = g;
    }
    fragColor = vec4(col, 1.0);
  }`, { sweep: { value: 0 }, on: { value: 1 }, ping: { value: 0 }, pingA: { value: 0 }, calm: { value: [0, 0, 1, 1] }, calmK: { value: 0 } });

interface Target { m: Msg | null; th: number; r: number; dth: number; dr: number; hero: boolean }
type RGB = [number, number, number];
const sc = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export default class Radar extends Scene {
  scope = shared('radar.scope', SCOPE);
  stage = new Stage();
  msL = this.track(new Layer2D(MS.w, MS.h, undefined, { fast: true }));
  lyL = this.track(new Layer2D(LY.w, LY.h, undefined, { fast: true }));
  /** 有原文副行的窗格才建：比較高的歌詞圖層（LYS）。 */
  lyS: Layer2D | null = null;
  capL = this.track(new Layer2D(900, 60, undefined, { fast: true }));
  L = this.track(new LineBatch(2400, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  targets: Target[] = [];
  hero: Target | null = null;
  tLock = 0;
  beat = 0.5;
  fit: FitResult | null = null;
  charT: number[] = [];
  typedEnd = 0;
  private msKey = '';
  /** 內容上的字級（已經換算過舞台縮放）：署名、歌詞。 */
  sigPx = 30; lyrPx = 50;
  /** 每兩小節「偵測到新目標」的時間與目標。 */
  pings: { t: number; i: number }[] = [];
  private capKey = '';

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start;
    const m = this.msg;
    const all: Msg[] = (this.ctx.params.messages as Msg[] | undefined) ?? [];
    const seed = this.ctx.params.seed ?? 1;
    this.beat = au.beatPeriod(s + 0.1);
    // 鎖定：頭一小節（最多 2.2 秒）裡的某一拍，挑掃描線指向東邊（約 75°，靠近右邊的留言）的那一拍；主打目標就放在那一刻掃描線指的方位上
    const bar = au.timeOfBar(Math.floor(au.barAt(s)) + 1) - au.timeOfBar(Math.floor(au.barAt(s)));
    let best = beatAfter(au, s + 0.12), bestD = Infinity;
    for (let k = 0; k < 6; k++) {
      const tb = beatAfter(au, s + 0.12, k);
      if (tb > s + Math.min(bar, 2.2) + 0.05) break;
      const deg = ((((this.sweepAt(tb) / TAU) % 1) + 1) % 1) * 360;
      const dd = Math.abs(((deg - 75 + 540) % 360) - 180) + k * 4;
      if (dd < bestD) { bestD = dd; best = tb; }
    }
    this.tLock = best;
    // 其他留言：向日葵螺旋均勻散開（只是光點，不標名字）
    const others = all.filter((x) => !m || x.id !== m.id).slice(0, 16);
    const n0 = Math.max(6, others.length), rot = hash(seed, 9) * TAU;
    const place = (x: Msg | null, i: number): Target => ({
      m: x, th: rot + i * 2.39996, r: (0.2 + 0.74 * Math.sqrt((i + 0.5) / n0)) * R,
      dth: (hash(x ? x.id : 1000 + i, 3) - 0.5) * 0.02, dr: (hash(x ? x.id : 1000 + i, 4) - 0.5) * 6, hero: false,
    });
    this.targets = others.map(place);
    for (let i = this.targets.length; i < 6; i++) this.targets.push(place(null, i));
    if (m) {
      this.hero = { m, th: this.sweepAt(this.tLock) % TAU, r: 0.8 * R, dth: 0, dr: 0, hero: true };
      this.targets.push(this.hero);
    }
    if (this.ctx.lyrics.linesIn(s, this.ctx.end).some((l) => lyricSubOf(l))) this.lyS = this.track(new Layer2D(LYS.w, LYS.h, undefined, { fast: true }));
    await loadText(TEXT + (song.title ?? '') + (m ? m.text + m.name : ''));
    // 每兩小節「偵測到新目標」：挑一個非主打的光點，在小節線上擴出一圈回波
    for (let b = Math.ceil(au.barAt(s + 0.3)), k = 0; au.timeOfBar(b) < this.ctx.end - 0.3 && k < 16; b += 2, k++) {
      this.pings.push({ t: au.timeOfBar(b), i: Math.floor(hash(seed, b, 5) * Math.max(1, this.targets.length - (m ? 1 : 0))) });
    }
    const zM = this.stage.scaleAt(CAM, MS.x + MS.w / 2, MS.y + MS.h / 2);
    const zL = this.stage.scaleAt(CAM, LY.x + LY.w / 2, LY.y + LY.h / 2);
    this.lyrPx = lyricV2(null) / zL;
    if (m) {
      const c = this.msL.ctx;
      // 字級依「可用高度扣掉署名那一行」算，署名永遠在最後一行下面
      // v2 字級：標準是螢幕 px，除以舞台在留言那裡的縮放倍數；字級依「框高扣掉署名」算
      const o = { min: V2.msgMin / zM, max: msgMaxFor(m.text) / zM, lineHeight: 1.28, maxLines: 6 };
      this.fit = fitClauses(c, m.text, F.hand(400), MS.w, MS.h - 80, o) ?? fitText(c, m.text, F.hand(400), MS.w, MS.h - 80, o);
      this.sigPx = sigV2(this.fit.size * zM) / zM;
      this.lyrPx = lyricV2(this.fit.size * zM) / zL;
      const n = this.fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const dur = clamp(0.05 * n + 0.3, 0.6, 3), step = this.beat / 2;
      const per = Math.ceil(n / Math.max(1, Math.round(dur / step)));
      this.charT = Array.from({ length: n }, (_, i) => this.tLock + 0.15 + Math.floor(i / per) * step);
      this.typedEnd = this.charT[n - 1] ?? this.tLock;
    }
  }

  /** 掃描線的方位（弧度，0 = 正北、順時針）：一小節一圈，小節線在正北。 */
  private sweepAt(t: number) { return TAU * this.ctx.audio.barAt(t); }
  private pos(tg: Target, t: number) {
    const s = this.ctx.start;
    let r = tg.r + tg.dr * (t - s);
    const th = tg.th + tg.dth * (t - s);
    if (tg.hero) r = tg.r * (1 - 0.1 * prog(t, this.tLock, this.ctx.end, ease.inOutCubic));
    return { x: C.x + Math.sin(th) * r, y: C.y - Math.cos(th) * r, th, r };
  }
  private sinceSwept(tg: Target, t: number) {
    const p = this.pos(tg, t);
    const b = this.ctx.audio.barAt(t);
    const u = (((p.th / TAU) % 1) + 1) % 1;
    let k = Math.floor(b - u) + u;
    if (k > b) k -= 1;
    const tk = this.ctx.audio.timeOfBar(k);
    return tk < this.ctx.start - 0.01 ? Infinity : t - tk;
  }

  private drawScope(t: number) {
    const L = this.L, s = this.ctx.start;
    const on = prog(t, s, s + 0.45, ease.outExpo);
    const sw = this.sweepAt(t);
    const dx = Math.sin(sw), dy = -Math.cos(sw);
    const sg = LIN.signal, em = LIN.ember;
    // 掃描線分段畫：經過字的後面時變暗（跟 shader 的 calm 同一個範圍），才不會每小節劃過留言一次
    const NSEG = 24;
    for (let i = 0; i < NSEG; i++) {
      const a = (i / NSEG) * R * on, b = ((i + 1) / NSEG) * R * on;
      const mx = C.x + dx * (a + b) / 2, my = C.y + dy * (a + b) / 2;
      const qx = (mx - CALM.x) / CALM.w, qy = (my - CALM.y) / CALM.h;
      const k = 1 - 0.8 * Math.exp(-(qx * qx + qy * qy) * 1.6);
      L.seg2(C.x + dx * a, C.y + dy * a, C.x + dx * b, C.y + dy * b, 2, sc(em, 1.8 * k), 1);
      L.seg2(C.x + dx * a, C.y + dy * a, C.x + dx * b, C.y + dy * b, 12, sc(sg, 0.08 * k), 1);
    }
    L.seg2(C.x, C.y, C.x + 0.01, C.y, 8, sc(em, 1.6), 1);
    for (const tg of this.targets) {
      const p = this.pos(tg, t);
      if (p.r > R * on) continue;
      const since = this.sinceSwept(tg, t);
      const locked = tg.hero && t >= this.tLock;
      let k = since === Infinity ? 0 : Math.exp(-since / (this.beat * 2.2));
      if (locked) k = Math.max(k, 0.6);
      if (k < 0.02) continue;
      const hot = since < 0.12 ? 1 - since / 0.12 : 0;
      L.seg2(p.x, p.y, p.x + 0.01, p.y, 6 + 5 * hot, sc([lerp(sg[0], em[0], hot), lerp(sg[1], em[1], hot), lerp(sg[2], em[2], hot)], (0.9 + 1.5 * hot) * k), 1);
      L.seg2(p.x, p.y, p.x + 0.01, p.y, 26, sc(sg, 0.04 * k), 1);
    }
    // 新目標的回波：一圈往外擴的細環（0.9 秒），光點本身也亮一下
    for (const pg of this.pings) {
      const age = t - pg.t;
      if (age < 0 || age > 0.9) continue;
      const tg = this.targets[pg.i];
      if (!tg || tg.hero) continue;
      const p = this.pos(tg, t);
      const rr = 8 + 70 * ease.outCubic(age / 0.9), a = 1 - age / 0.9;
      let px = p.x + rr, py = p.y;
      for (let k = 1; k <= 28; k++) {
        const an = (k / 28) * TAU, x = p.x + Math.cos(an) * rr, y = p.y + Math.sin(an) * rr;
        L.seg2(px, py, x, y, 1.4, sc(sg, 1.1 * a), 1);
        px = x; py = y;
      }
      L.seg2(p.x, p.y, p.x + 0.01, p.y, 9, sc(em, 1.6 * a), 1);
    }
    // 鎖定：四個角框從大縮小套住目標、每一拍輕輕呼吸；一條細線拉到留言的第一行
    const hero = this.hero;
    if (hero && t >= this.tLock) {
      const p = this.pos(hero, t);
      const lk = ease.outExpo(clamp((t - this.tLock) / 0.35));
      const br = lerp(90, 24, lk) * (1 + 0.08 * pulse(t, this.ctx.audio.nextBeat(t) - this.beat, 0.1));
      const arm = 10, col = sc(sg, 1.3);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const x = p.x + sx * br, y = p.y + sy * br;
        L.seg2(x, y, x - sx * arm, y, 1.6, col, lk);
        L.seg2(x, y, x, y - sy * arm, 1.6, col, lk);
      }
      const tx = MS.x - 18, ty = MS.y + 60;
      const k2 = ease.outCubic(clamp((t - this.tLock - 0.08) / 0.35));
      const sx0 = p.x + (tx > p.x ? br : -br), sy0 = p.y;
      L.seg2(sx0, sy0, lerp(sx0, tx, k2), lerp(sy0, ty, k2), 1, sc(sg, 0.6), 1);
    }
  }

  /** 右邊：鎖定目標傳來的留言（沒有留言時是一行小小的邀請）。 */
  private drawMessage(t: number, out: THREE.WebGLRenderTarget) {
    const m = this.msg;
    const L = this.msL, c = L.ctx;
    if (!m) {
      if (this.msKey !== 'invite') {
        this.msKey = 'invite';
        L.clear();
        label(c, INVITE, 0, MS.h - 40, F.hei(500), 24, rgba('ash', 0.6), { tracking: 2 });
        L.upload();
      }
      blit(this.ctx, L.texture, MS.x, MS.y, MS.w, MS.h, out);
      return;
    }
    const typed = this.charT.filter((x) => x <= t).length;
    const locked = t >= this.tLock;
    const sigK = typed >= this.charT.length ? clamp((t - this.typedEnd - this.beat * 0.5) / 0.3) : 0;
    const key = `${locked}|${typed}|${sigK.toFixed(2)}`;
    if (key !== this.msKey || t < this.typedEnd + 0.8) {
      this.msKey = key;
      L.clear();
      const fit = this.fit!;
      c.font = font(F.hand(400), fit.size);
      c.textBaseline = 'alphabetic';
      c.textAlign = 'left';
      // 靠上排（引線拉到第一行），署名在最後一行下面、隔半個留言字高
      const top = 20 + fit.size * 0.92;
      let idx = 0;
      fit.lines.forEach((ln, li) => {
        let x = 0;
        const y = top + li * fit.lineHeight;
        for (const ch of Array.from(ln)) {
          const ta = this.charT[idx++] ?? 0;
          const cw = c.measureText(ch).width;
          if (t >= ta) {
            const heat = Math.exp(-(t - ta) / 0.22);
            const to = ch === '♥' ? 'rose' : 'bone';
            c.fillStyle = heat > 0.02 ? mixRgba(to, 'signal', heat, 1) : rgba(to, 1);
            c.fillText(ch, x, y);
          } else if (locked) {
            // 還沒解碼的字：一個很淡的方塊
            c.fillStyle = rgba('signal', 0.08);
            c.fillRect(x + cw * 0.14, y - fit.size * 0.76, cw * 0.72, fit.size * 0.82);
          }
          x += cw;
        }
      });
      if (sigK > 0) label(c, signature(m.name) + (m.couple ? '（新人）' : ''), 0, top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.5 + this.sigPx, F.hand(400), this.sigPx, rgba('ash', sigK));
      L.upload();
    }
    blit(this.ctx, this.msL.texture, MS.x, MS.y, MS.w, MS.h, out);
  }

  /** 右下：歌詞（v2：比留言小；沒有留言時也不超過 52）。 */
  private drawLyrics(t: number, out: THREE.WebGLRenderTarget) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    // 有原文副行的句子用比較高的圖層（往上長），兩行在「原本的範圍＋往上多出來的一半」裡置中
    const tall = !!(ly && this.lyS && lyricSubOf(ly.line));
    const B = tall ? LYS : LY;
    const L = tall ? this.lyS! : this.lyL, c = L.ctx;
    L.clear();
    if (ly) {
      const st = { family: F.archivo(100, 700), size: this.lyrPx, minSize: this.lyrPx * 0.82, maxWidth: LY.w, lineHeight: 1.06, sung: rgba('bone', this.msg ? 0.75 : 0.92), unsung: rgba('bone', 0.24) };
      const lay = layoutLyric(c, ly.line, st);
      c.save(); c.translate(0, tall ? SUB_UP / 2 + (LY.h + SUB_UP / 2 - lay.height) / 2 + lay.size * 0.8 : (LY.h - lay.height) / 2 + lay.size * 0.8);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else if (!lyrics.has) {
      label(c, `♪ ${song.title || '今晚的歌'}`, 0, LY.h / 2 + this.lyrPx * 0.35, F.archivo(100, 700), this.lyrPx, rgba('bone', 0.6));
    }
    L.upload();
    blit(this.ctx, L.texture, B.x, B.y, B.w, B.h, out);
  }

  /** 兩小行配角：上緣的機器名、鎖定的讀數（沒有留言時是邀請）。 */
  private drawCaptions(t: number, out: THREE.WebGLRenderTarget) {
    const hero = this.hero;
    const locked = hero && t >= this.tLock;
    // 沒有留言時不放機器名（邀請已經在右邊），畫面上配角字只有一小群
    let cap = this.msg ? '心動雷達  ·  掃描一圈 / 小節' : '';
    if (locked) {
      const p = this.pos(hero, t);
      cap = `鎖定目標  ·  方位 ${((((p.th / TAU) % 1) + 1) % 1 * 360).toFixed(0).padStart(3, '0')}°  ·  ${((p.r / R) * RANGE_KM).toFixed(1)} km  ·  接近中`;
    }
    if (cap !== this.capKey) {
      this.capKey = cap;
      const L = this.capL, c = L.ctx;
      L.clear();
      label(c, cap, 0, 40, F.hei(500), 20, rgba(locked ? 'signal' : 'ash', 0.6), { tracking: 3 });
      L.upload();
    }
    // 控制台右邊、留言的上面
    blit(this.ctx, this.capL.texture, MS.x, MS.y - 70, 900, 60, out);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rt = this.stage.rt;
    const u = this.scope.u;
    u.sweep!.value = this.sweepAt(t) % TAU;
    u.on!.value = prog(t, s, s + 0.45, ease.outExpo);
    const kicks = au.events('kick', t - 0.6, t);
    const lastK = kicks[kicks.length - 1];
    const age = lastK ? t - lastK[0] : 9;
    u.ping!.value = R * ease.outCubic(clamp(age / 0.55));
    u.pingA!.value = lastK ? lastK[1] * (1 - clamp(age / 0.6)) : 0;
    // 字後面安靜一點：留言（或沒有留言時的大歌詞）＋下面的歌詞
    u.calm!.value = [CALM.x, CALM.y, CALM.w, CALM.h];
    u.calmK!.value = 0;
    this.scope.render(renderer, rt);
    this.L.clear();
    this.drawScope(t);
    this.L.render(renderer, rt);
    this.drawCaptions(t, rt);
    this.drawMessage(t, rt);
    this.drawLyrics(t, rt);
    // 鏡頭：控制台上的一台螢幕，稍微往下看。焦點轉移：開場對焦在雷達，鎖定之後移到留言
    const mv = camMove(au, s, e, t, { inYaw: 0.1, inZoom: 0.08, push: 0.05, sway: 0.012 });
    const fk = this.msg ? ease.inOutCubic(prog(t, this.tLock, this.tLock + 1.5 * this.beat)) : 0;
    const focus: [number, number] = [lerp(C.x, MS.x + MS.w / 2, fk), lerp(C.y, MS.y + MS.h / 2, fk)];
    this.stage.draw(renderer, out, {
      ...CAM, yaw: CAM.yaw + mv.yaw, zoom: CAM.zoom + mv.zoom, focus,
      room: [LIN.ink[0] * 0.5, LIN.ink[1] * 0.5, LIN.ink[2] * 0.5],
    });
    return { bloom: 0.72, halation: 0.3, vignette: 0.5 };
  }
}
