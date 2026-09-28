// 水晶吊燈（暗）：由下往上仰看一盞水晶吊燈，整盞燈是幾千條 3D 細線（LineBatch + 透視鏡頭），像工程圖／版畫的線稿，不是 mesh。
//  - 背景是天花板（全螢幕 shader 做射線與天花板平面求交）：藻井方格往遠處退、燈附近被照暖，
//    每個拍點水晶把燈光折射到天花板上，變成一小撮細長的光斑（位置用拍序號 hash，確定性），慢慢淡掉。
//  - 吊燈很慢地左右擺轉；每個拍點有一批水晶串被「撞」一下（阻尼擺盪，由最近幾拍的衝量加總，純時間函數），
//    撞到的墜子當下閃出四芒星的光（大鼓一批、小鼓另一批），hi-hat 讓零星幾顆微閃。
//  - 最下層大水晶環的前半圈：每一串墜著一個字，整行歌詞沿著這個弧線一字排開（逐字跟唱，唱到的那串閃一下）。
//    字的橫向位置先照一般排版排好，再反解每串該掛在環上的哪個角度，所以字距整齊、不會擠在弧線兩端。
//  - 主打留言在吊燈下方，一個字一個字像水晶墜一樣從上面「滴」下來就位（落地閃一下），署名靠右。
//  - 進場：線稿由上往下描出來、燈泡依序亮；退場最後一拍所有墜子一起閃一下、整盞燈稍微暗下。
//  - 一格只有一個焦點（MV 融合原則）：鏡頭往下看一點、吊燈的上半截出畫（像仰拍），把下半部整片留給留言；
//    留言是最大的字、歌詞墜子小一級；線稿與天花板的藻井都調淡，只留左上一小群低對比的標籤。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { lyricAt, beatAfter, signature, COUPLE_EN } from './_motifs';
import { glyphStates, glyphColor, no3, INVITE_SMALL, preloadText, fitFew, type GlyphState } from './_t19';
import { buildModel, CEIL, HOOP, LYRIC_ARC, type Model, type StrandDef } from './chandelier-model';

export const spec: PlateSpecDecl = { group: 'type', family: 'light', paper: false, energy: [0.35, 1], bars: [4, 8] };

/** 鏡頭：在吊燈前下方往上看；view offset 把吊燈中軸放在畫面 x = CX、整盞往上推（上半截出畫，下面留給留言）。 */
const CAM = { y: -0.5, z: 7.8, lookY: 0.7, fov: 36, dy: 205 };
const CX = 780;
/** 歌詞：墜子下的字（字級、最寬、左右界線）。 */
const LYR = { size: 50, min: 48, maxW: 1060, x0: 150, x1: 1320 };
/** 留言的框（吊燈下方，最下面一行留給署名）：整個畫面最大的字。 */
const MSG = { x: 150, y: 604, w: 1180, h: 356 };
const MSG_FAM = F.ming(700);
const SIG_MAX = 958;
const LYR_FAM = F.archivo(100, 700);
const NAME_FAM = F.serif(600);
const LABEL = '亮度：足以照亮每一句祝福';
const EMPTY = '今晚的每一道光，都缺你一句祝福。';

// ---------------------------------------------------------------- 天花板
const BG = () => new FSPass(/* glsl */ `
  uniform mat4 uInvProj; uniform mat4 uCamW; uniform vec3 uCamPos;
  uniform float uIn;      // 進場（天花板的線與花飾）
  uniform float uGlow;    // 燈照亮天花板的強度
  uniform vec3 uBeatId;   // 最近三拍的拍序號
  uniform vec3 uBeatAge;  // 距離那三拍幾秒
  uniform vec3 uBeatAmp;  // 那三拍的強度
  const float CEIL = ${CEIL.toFixed(2)};

  // 折射到天花板上的小光斑：天花板切成格子，每格在某一拍有一定機率出現一個細長的光斑，
  // 順著長軸從訊號色過渡到 ember、紙白（稜鏡分光的暗示，但只用色票）
  vec3 spots(vec2 q) {
    vec3 acc = vec3(0.0);
    float r = length(q);
    if (r > 4.6) return acc;
    vec2 cs = vec2(0.5);
    vec2 cell = floor(q / cs);
    for (int j = 0; j < 3; j++) {
      float amp = uBeatAmp[j] * exp(-uBeatAge[j] / 0.55);
      if (amp < 0.01) continue;
      float h = hash13(vec3(cell, uBeatId[j]));
      if (h > 0.2) continue;
      vec2 jit = hash22(cell * 1.31 + uBeatId[j] * 7.7);
      vec2 c = (cell + 0.22 + 0.56 * jit) * cs;
      float ang = hash12(cell * 1.7 + uBeatId[j] * 3.1) * PI;
      vec2 l = rot2(ang) * (q - c);
      float e = length(l / vec2(0.085, 0.018));
      float m = exp(-e * e * 1.4);
      float u = clamp(l.x / 0.085 * 0.5 + 0.5, 0.0, 1.0);
      vec3 tint = mix(C_BLOOD, C_SIGNAL, smoothstep(0.0, 0.4, u));
      tint = mix(tint, C_EMBER, smoothstep(0.4, 0.75, u));
      tint = mix(tint, C_BONE, smoothstep(0.75, 1.0, u));
      acc += tint * m * amp * (1.0 - smoothstep(2.6, 4.6, r));
    }
    return acc;
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
    vec3 dir = normalize((uCamW * vec4(v.xyz / v.w, 0.0)).xyz);
    vec3 col = C_INK;
    // 吊燈周圍空氣裡很淡的暖光（有空氣感，不是一片死黑）：視線跟「看向吊燈中心」的夾角越小越亮
    vec3 toC = normalize(vec3(0.0, 1.1, 0.0) - uCamPos);
    float ang = acos(clamp(dot(dir, toC), -1.0, 1.0));
    col += (C_BLOOD * 0.05 + C_SIGNAL * 0.018) * exp(-ang * ang / 0.09) * uGlow;
    if (dir.y > 0.0) {
      float tt = (CEIL - uCamPos.y) / dir.y;
      vec2 q = (uCamPos + dir * tt).xz;
      float fade = exp(-max(tt - 5.0, 0.0) * 0.2);   // 越遠越沒入黑暗
      float r = length(q);
      float lit = exp(-r * r / 5.0);                  // 燈照亮的範圍
      col = mix(col, C_INK2, 0.7 * fade);
      col += (C_BLOOD * 0.08 + C_SIGNAL * 0.035 + C_EMBER * 0.01) * lit * uGlow;
      // 灰泥上的版畫細線（跟著透視）
      float hl = hatch(q.x * 6.0 + 0.3 * sin(q.y * 0.7), 0.12 + 0.12 * lit);
      col += C_BONE * hl * 0.011 * (0.2 + lit) * fade * uIn;
      // 藻井：方格的邊框與內框兩道線
      vec2 g = abs(fract(q / 1.9 + 0.5) - 0.5) * 1.9;
      float d = min(g.x, g.y);
      float grid = aaStroke(d, 0.02) + 0.55 * aaStroke(d - 0.12, 0.012);
      col += C_BONE * grid * 0.028 * fade * (0.3 + 0.9 * lit) * uIn;
      // 天花板正中的圓形花飾（吊燈掛在這裡）
      float th = atan(q.y, q.x);
      float ros = aaStroke(r - 0.34, 0.014) + aaStroke(r - 0.48, 0.014) + aaStroke(r - (0.66 + 0.04 * cos(th * 16.0)), 0.014) + 0.6 * aaStroke(r - 0.22, 0.01)
        + 0.5 * aaStroke(r - (0.84 + 0.05 * cos(th * 24.0)), 0.012);
      col += C_BONE * ros * 0.08 * uIn * fade;
      col += spots(q) * fade;
    }
    fragColor = vec4(col, 1.0);
  }`, {
  uInvProj: { value: new THREE.Matrix4() }, uCamW: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
  uIn: { value: 1 }, uGlow: { value: 1 },
  uBeatId: { value: new THREE.Vector3() }, uBeatAge: { value: new THREE.Vector3(9, 9, 9) }, uBeatAmp: { value: new THREE.Vector3() },
});

// ---------------------------------------------------------------- 歌詞墜子的排版
interface Tok { ci0: number; ci1: number; w: number; cx: number; adv: number[]; words: number[] }
interface TokLay { toks: Tok[]; size: number; family: string; chars: string[] }
interface Glyph { ch: string; x: number; y: number; w: number; t0: number }
interface Glint { x: number; y: number; z: number; I: number }

export default class Chandelier extends Scene {
  bg = shared('chandelier.bg', BG);
  lines = this.track(new LineBatch(9000, { screen2D: false, blend: 'add' }));
  glow = this.track(new LineBatch(3000, { screen2D: true, blend: 'add' }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new THREE.PerspectiveCamera(CAM.fov, W / H, 0.1, 80);
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 17 + (this.msg?.id ?? 0) * 131) >>> 0;
  model: Model = buildModel(this.seed % 997);
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig = { text: '', x: 0, y: 0, t0: 0, size: 36 };
  coupleTag = false;
  inviteY = 0;
  tokCache = new Map<Line | string, TokLay>();
  beatInfo = new Map<number, { s: number; kick: boolean }>();
  glints: Glint[] = [];
  avoid: [number, number, number, number][] = [[130, 575, 1210, 125], [130, 705, 1230, 280]];
  private v = new THREE.Vector3();
  label = '';
  label2 = '';
  tRev = 0.6;
  /** 歌詞墜子的字級：有留言時小一級（留言是焦點），沒有留言時歌詞就是焦點、大一點。 */
  lyrSize = this.msg ? LYR.size : 60;

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, m = this.msg;
    const beat = au.beatPeriod(s + 0.01);
    this.tRev = clamp(beat * 1.0, 0.35, 0.9);
    this.label = `水晶吊燈  CHANDELIER${m ? '  ·  ' + no3(m.n) : ''}`;
    this.label2 = `水晶 ${this.model.crystals} 顆  ·  ${LABEL}`;
    const text = m ? m.text : EMPTY;
    await preloadText(this.ctx, `${text}${signature(m?.name ?? '')}${this.label}${this.label2}${INVITE_SMALL}${song.title}${COUPLE_EN}FROM THE COUPLE`);
    const c = this.layer.ctx;
    // 有留言時框的下面留一行給署名（署名的基線不能低於 SIG_MAX，離下緣要 96 px 以上）
    const boxH = MSG.h - 58;
    // 沒有留言時邀請是配角（比歌詞小一點）
    this.fit = fitFew(c, text, MSG_FAM, MSG.w, boxH, { min: 48, max: m ? 116 : 56, lineHeight: 1.28, maxLines: 4 });
    const fit = this.fit;
    // 留言塊在吊燈正下方置中（塊內靠左），寬的時候貼齊左右界線
    const bx = clamp(CX - fit.width / 2, MSG.x, MSG.x + MSG.w - fit.width);
    const y0 = MSG.y + (boxH - fit.height) / 2 + fit.size * 0.9;
    const lastY = y0 + (fit.lines.length - 1) * fit.lineHeight;
    // 一個字一個字滴下來：第二拍開始，一小節內全部就位
    const bar = beat * 4;
    const tm0 = beatAfter(au, s + 0.02, 1);
    const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const stag = clamp((bar * 0.85 - 0.34) / Math.max(1, n), 0.012, 0.08);
    let i = 0;
    fit.lines.forEach((ln, li) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      for (const g of lay.glyphs) this.glyphs.push({ ch: g.ch, x: bx + g.x, y: y0 + li * fit.lineHeight, w: g.w, t0: tm0 + (i++) * stag });
    });
    const tEnd = tm0 + (n - 1) * stag + 0.34;
    if (m) {
      const ss = clamp(Math.round(fit.size * 0.45), 40, 48);
      const sw = (c.font = font(F.hand(400), ss), c.measureText(signature(m.name)).width);
      this.sig = { text: signature(m.name), x: Math.max(MSG.x, bx + fit.width - sw), y: Math.min(SIG_MAX, lastY + fit.size * 0.3 + ss * 1.25), t0: tEnd + 0.15, size: ss };
      this.coupleTag = m.couple;
    } else {
      this.inviteY = y0 + (fit.lines.length - 1) * fit.lineHeight + 58;
    }
  }

  // ---------------------------------------------------------------- 工具
  private proj(x: number, y: number, z: number): [number, number] {
    this.v.set(x, y, z).project(this.cam);
    return [(this.v.x + 1) * W * 0.5, (1 - this.v.y) * H * 0.5];
  }

  /** 第 k 拍的強度與類型（大鼓／小鼓），第一次問的時候從 onset 算、之後快取。 */
  private beatAt(k: number) {
    let b = this.beatInfo.get(k);
    if (!b) {
      const au = this.ctx.audio, tb = au.timeOfBeat(k);
      let km = 0, sm = 0;
      for (const [, v] of au.events('kick', tb - 0.07, tb + 0.09)) km = Math.max(km, v);
      for (const [, v] of au.events('snare', tb - 0.07, tb + 0.09)) sm = Math.max(sm, v);
      b = { s: clamp(0.4 + 0.6 * Math.max(km, sm), 0.4, 1), kick: km + sm > 0.01 ? km >= sm : k % 2 === 0 };
      this.beatInfo.set(k, b);
    }
    return b;
  }

  /** 吊燈整體的擺轉角（弧度）：很慢的左右擺，不轉圈。 */
  private rotAt(t: number) {
    return 0.09 * Math.sin((TAU * this.ctx.audio.barAt(t)) / 8 + hash(this.seed, 3) * TAU);
  }

  /** 一串水晶在 t 的擺盪（x、z 兩個方向的角度）與這一刻的閃光強度。 */
  private swing(st: StrandDef, t: number, kNow: number): { ax: number; az: number; I: number } {
    const au = this.ctx.audio;
    let ax = 0.014 * Math.sin(t * 1.3 + st.id * 1.7), az = 0.014 * Math.cos(t * 1.1 + st.id * 2.3), I = 0;
    for (let k = kNow; k >= kNow - 3; k--) {
      const tb = au.timeOfBeat(k);
      if (tb > t || tb < this.ctx.start - 0.05) continue;
      const b = this.beatAt(k);
      // 大鼓撞一大批、小鼓撞另一批（只挑奇數號的串）
      const p = b.kick ? 0.24 : 0.17;
      if (!b.kick && st.id % 2 === 0) continue;
      if (hash(k, st.id, 11) > p) continue;
      const dt = t - tb, a = 0.17 * b.s * Math.exp(-dt / 0.6) * Math.sin(dt * 9.5);
      const d = hash(k, st.id, 13) * TAU;
      ax += a * Math.cos(d); az += a * Math.sin(d);
      I = Math.max(I, b.s * pulse(t, tb, 0.09));
    }
    return { ax, az, I };
  }

  /**
   * 畫一串水晶：從掛點 (hx,hy,hz) 往下，珠子、細鍊、最下面一顆雙錐形的墜子。回傳墜子中心與尖端（世界座標）。
   * k = 亮度（進場、退場、深度），lenK = 珠串長度係數（歌詞墜子出現時從 0 長出來）。
   */
  private strand(hx: number, hy: number, hz: number, st: { len: number; beads: number; ph: number; pr: number; spin: number }, ax: number, az: number, k: number, t: number, lenK = 1) {
    const L = this.lines, bo = LIN.bone;
    const dx = Math.sin(ax), dz = Math.sin(az), dy = -Math.sqrt(Math.max(0.2, 1 - dx * dx - dz * dz));
    const len = st.len * lenK;
    let px = hx, py = hy, pz = hz;
    const n = st.beads;
    for (let i = 1; i <= n; i++) {
      const s = (len * i) / n;
      const x = hx + dx * s, y = hy + dy * s, z = hz + dz * s;
      L.seg(px, py, pz, x, y, z, 0.6, bo[0] * 0.22 * k, bo[1] * 0.22 * k, bo[2] * 0.22 * k, 1);
      L.seg(x, y, z, x + 1e-4, y, z, 2.8, bo[0] * 0.6 * k, bo[1] * 0.6 * k, bo[2] * 0.6 * k, 1);
      px = x; py = y; pz = z;
    }
    // 墜子：雙錐（上下兩個尖、赤道六角），順著串的方向；每個面的邊依轉角有一條會「反光」
    const cx = px + dx * st.ph, cy = py + dy * st.ph, cz = pz + dz * st.ph;
    const top: [number, number, number] = [px, py, pz], bot: [number, number, number] = [cx + dx * st.ph, cy + dy * st.ph, cz + dz * st.ph];
    const spin = st.spin + t * 0.45;
    let prev: [number, number, number] | null = null, first: [number, number, number] | null = null;
    for (let j = 0; j < 6; j++) {
      const a = spin + (j * TAU) / 6;
      const e: [number, number, number] = [cx + Math.cos(a) * st.pr, cy, cz + Math.sin(a) * st.pr];
      const hi = 0.5 + 1.3 * Math.max(0, Math.cos(a - 1.2)) ** 10;
      const kk = k * hi;
      L.seg(top[0], top[1], top[2], e[0], e[1], e[2], 0.9, bo[0] * 0.55 * kk, bo[1] * 0.55 * kk, bo[2] * 0.55 * kk, 1);
      L.seg(bot[0], bot[1], bot[2], e[0], e[1], e[2], 0.9, bo[0] * 0.45 * kk, bo[1] * 0.45 * kk, bo[2] * 0.45 * kk, 1);
      if (prev) L.seg(prev[0], prev[1], prev[2], e[0], e[1], e[2], 0.8, bo[0] * 0.35 * k, bo[1] * 0.35 * k, bo[2] * 0.35 * k, 1);
      else first = e;
      prev = e;
    }
    if (prev && first) L.seg(prev[0], prev[1], prev[2], first[0], first[1], first[2], 0.8, bo[0] * 0.35 * k, bo[1] * 0.35 * k, bo[2] * 0.35 * k, 1);
    return { c: [cx, cy, cz] as [number, number, number], tip: bot };
  }

  /** 螢幕上的四芒星閃光（加法、會發光）。 */
  private star(x: number, y: number, I: number, size = 1) {
    if (I < 0.03) return;
    const G = this.glow, e = LIN.ember, s = LIN.signal;
    const Lr = (10 + 30 * I) * size;
    const col: [number, number, number] = [e[0] * 3.2 * I, e[1] * 3.2 * I, e[2] * 3.2 * I];
    G.seg2(x - Lr, y, x + Lr, y, 1.1, col, 0.9);
    G.seg2(x, y - Lr * 1.15, x, y + Lr * 1.15, 1.1, col, 0.9);
    G.seg2(x - Lr * 0.35, y, x + Lr * 0.35, y, 2.2, col, 0.8);
    G.seg2(x, y - Lr * 0.4, x, y + Lr * 0.4, 2.2, col, 0.8);
    const d = Lr * 0.3;
    G.seg2(x - d, y - d, x + d, y + d, 0.9, [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6], 0.7);
    G.seg2(x - d, y + d, x + d, y - d, 0.9, [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6], 0.7);
    G.seg2(x, y, x + 0.01, y, 16 * size, [s[0] * 0.8 * I, s[1] * 0.8 * I, s[2] * 0.8 * I], 0.35);
    G.seg2(x, y, x + 0.01, y, 5 * size, [4.5 * I, 4 * I, 3.4 * I], 1);
  }

  /** 一行歌詞排成墜子：一個 Word 一串（太多就兩個一串），先照一般排版排出每串的橫向位置。 */
  private tokLay(line: Line | null, c: CanvasRenderingContext2D): TokLay {
    const key: Line | string = line ?? '__name__';
    const hit = this.tokCache.get(key);
    if (hit) return hit;
    let family = LYR_FAM, size = this.lyrSize;
    const chars: string[] = [];
    // 每個 code point 的 UTF-16 起點（Word.o 是 UTF-16 位置）
    const cpAt: number[] = [];
    const text = line ? line.text : COUPLE_EN.toUpperCase();
    let u = 0;
    for (const ch of text) { chars.push(ch); cpAt.push(u); u += ch.length; }
    const cpOf = (o: number) => { let i = 0; while (i < cpAt.length && cpAt[i]! < o) i++; return i; };
    // 分組：每組 [第一個 word, 最後一個 word]；純音樂時每個字母一串
    const groups: { ci0: number; ci1: number; words: number[] }[] = [];
    if (line) {
      const ws = line.words;
      const per = ws.length > 16 ? 2 : 1;
      for (let i = 0; i < ws.length; i += per) {
        const a = ws[i]!, b = ws[Math.min(ws.length, i + per) - 1]!;
        groups.push({ ci0: cpOf(a.o), ci1: cpOf(b.o + b.w.length), words: Array.from({ length: Math.min(per, ws.length - i) }, (_, k) => i + k) });
      }
    } else {
      // 純音樂：墜子掛新人名字的字母，是配角（小、淡），焦點留給留言
      family = NAME_FAM; size = 42;
      chars.forEach((ch, i) => { if (ch.trim()) groups.push({ ci0: i, ci1: i + 1, words: [] }); });
    }
    const measureAt = (sz: number) => {
      c.font = font(family, sz);
      return groups.map((g) => chars.slice(g.ci0, g.ci1).map((ch) => c.measureText(ch).width));
    };
    const isCJK = /[　-鿿가-힯]/.test(text);
    let adv = measureAt(size), gapK = isCJK ? 0.42 : 0.5;
    const total = (a: number[][], sz: number, gk: number) => a.reduce((s2, x) => s2 + x.reduce((p, q) => p + q, 0), 0) + (a.length - 1) * sz * gk;
    while (total(adv, size, gapK) > LYR.maxW && gapK > 0.2) gapK -= 0.04;
    while (total(adv, size, gapK) > LYR.maxW && size > LYR.min) { size = Math.max(LYR.min, size - 2); adv = measureAt(size); }
    const tw = total(adv, size, gapK);
    const left = clamp(CX - tw / 2, LYR.x0, LYR.x1 - tw);
    let x = left;
    const toks: Tok[] = groups.map((g, i) => {
      const w = adv[i]!.reduce((p, q) => p + q, 0);
      const tk = { ci0: g.ci0, ci1: g.ci1, w, cx: x + w / 2, adv: adv[i]!, words: g.words };
      x += w + size * gapK;
      return tk;
    });
    const out = { toks, size, family, chars };
    this.tokCache.set(key, out);
    return out;
  }

  /** 螢幕 x = xs 的墜子要掛在水晶環的哪個角度（前半圈上二分搜尋；投影的 x 對角度是單調的）。 */
  private angleFor(xs: number, y: number) {
    let lo = -LYRIC_ARC, hi = LYRIC_ARC;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const [px] = this.proj(Math.sin(mid) * HOOP.r, y, Math.cos(mid) * HOOP.r);
      if (px < xs) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const beat = au.beatPeriod(t);
    const tEx = Math.max(s + beat * 2, e - beat);
    const exitK = 1 - 0.28 * prog(t, tEx, e, ease.outCubic);
    const fadeIn = prog(t, s, s + 0.25);
    const kNow = Math.floor(au.beatAt(t) + 1e-6);

    // 鏡頭：很慢地推近
    const cam = this.cam;
    cam.position.set(0, CAM.y, CAM.z - 0.28 * prog(t, s, e, ease.inOutQuad));
    cam.lookAt(0, CAM.lookY, 0);
    cam.setViewOffset(W, H, W / 2 - CX, CAM.dy, W, H);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();

    // ---- 天花板
    const u = this.bg.u;
    (u.uInvProj!.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (u.uCamW!.value as THREE.Matrix4).copy(cam.matrixWorld);
    (u.uCamPos!.value as THREE.Vector3).copy(cam.position);
    u.uIn!.value = fadeIn * exitK;
    const bulbOn = prog(t, s + this.tRev * 0.3, s + this.tRev * 1.1, ease.outCubic);
    u.uGlow!.value = bulbOn * (0.85 + 0.3 * f.a.kick) * exitK;
    const ids = u.uBeatId!.value as THREE.Vector3, ages = u.uBeatAge!.value as THREE.Vector3, amps = u.uBeatAmp!.value as THREE.Vector3;
    for (let j = 0; j < 3; j++) {
      const k = kNow - j, tb = au.timeOfBeat(k);
      const ok = tb <= t && tb >= s - 0.05;
      ids.setComponent(j, k);
      ages.setComponent(j, Math.max(0, t - tb));
      amps.setComponent(j, ok ? this.beatAt(k).s * 0.8 * bulbOn : 0);
    }
    this.bg.render(renderer, out);

    // ---- 線稿骨架（進場由上往下描出來）
    const L = this.lines, G = this.glow;
    L.clear(); G.clear();
    this.glints.length = 0;
    const rot = this.rotAt(t);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const revU = prog(t, s, s + this.tRev, ease.outCubic);
    const yR = CEIL + 0.1 - (CEIL + 0.7) * revU;
    const revealing = revU < 1;
    const depth = (z: number) => 0.5 + 0.5 * clamp((z + HOOP.r) / (2 * HOOP.r));
    const bo = LIN.bone, sg = LIN.signal;
    const M = this.model, D = M.segs;
    const glob = fadeIn * exitK;
    // 線稿是配角：整體壓暗一點，留言才是畫面上最亮的字
    const lineK = 0.78;
    for (let i = 0; i < M.n; i++) {
      const o = i * 8;
      let ax = D[o]!, ay = D[o + 1]!, az = D[o + 2]!, bx = D[o + 3]!, by = D[o + 4]!, bz = D[o + 5]!;
      if (revealing) {
        if (ay < yR && by < yR) continue;
        // 描到一半的線段：剪到描線的高度
        if (ay < yR) { const k = (yR - by) / (ay - by); ax = bx + (ax - bx) * k; az = bz + (az - bz) * k; ay = yR; }
        else if (by < yR) { const k = (yR - ay) / (by - ay); bx = ax + (bx - ax) * k; bz = az + (bz - az) * k; by = yR; }
      }
      const rax = ax * cr + az * sr, raz = -ax * sr + az * cr, rbx = bx * cr + bz * sr, rbz = -bx * sr + bz * cr;
      let k = D[o + 7]! * depth((raz + rbz) / 2) * glob * lineK;
      // 描線的前緣亮一點（像仙女棒描過去）
      let hot = 0;
      if (revealing) hot = Math.exp(-(((Math.min(ay, by) - yR) / 0.12) ** 2)) * 1.6;
      L.seg(rax, ay, raz, rbx, by, rbz, D[o + 6]!, bo[0] * k + sg[0] * hot, bo[1] * k + sg[1] * hot, bo[2] * k + sg[2] * hot, 1);
    }

    // ---- 一般的水晶串
    const exitFlash = t >= tEx ? pulse(t, tEx, 0.14) : 0;
    const hats = au.events('hat', t - 0.3, t + 1e-4);
    for (const st of M.strands) {
      if (revealing && st.y < yR) continue;
      const a = st.a + rot;
      const hx = Math.sin(a) * st.r, hz = Math.cos(a) * st.r;
      const sw = this.swing(st, t, kNow);
      const k = (st.tier === 2 ? 0.8 : 1) * depth(hz) * glob * lineK * (revealing ? clamp((st.y - yR) / 0.3 + 0.2) : 1);
      const r = this.strand(hx, st.y, hz, st, sw.ax, sw.az, k, t);
      let I = sw.I;
      for (const [te, str] of hats) {
        const pick = Math.floor(hash(Math.round(te * 1000), 7) * M.strands.length);
        if (Math.abs(pick - st.id) <= 1 && (pick + st.id) % 3 !== 1) I = Math.max(I, 0.45 * str * pulse(t, te, 0.06));
      }
      if (exitFlash > 0 && hash(st.id, 21) < 0.6) I = Math.max(I, 0.7 * exitFlash);
      if (I > 0.03) this.glints.push({ x: r.c[0], y: r.c[1], z: r.c[2], I: I * depth(hz) });
    }

    // ---- 燈泡（燈絲的亮點：螢幕上的光點，依序點亮）
    M.bulbs.forEach((b, i) => {
      const on = prog(t, s + this.tRev * (b.tier ? 0.55 : 0.3) + i * 0.012, s + this.tRev * (b.tier ? 0.9 : 0.65) + i * 0.012 + 0.15, ease.outCubic);
      if (on <= 0) return;
      const a = b.a + rot;
      const [x, y] = this.proj(Math.sin(a) * b.r, b.y, Math.cos(a) * b.r);
      const fl = 0.92 + 0.08 * Math.sin(t * 21.7 + i * 1.9) * Math.sin(t * 13.1 + i * 0.7);
      const I = on * fl * (0.85 + 0.25 * f.a.kick) * exitK * (0.7 + 0.3 * depth(Math.cos(a) * b.r));
      const e = LIN.ember;
      // 光暈用幾層越來越淡的圓點疊出柔邊（單一大圓點看起來像一片平平的圓片）
      for (const [w, a] of [[40, 0.05], [28, 0.08], [18, 0.14]] as const) G.seg2(x, y, x + 0.01, y, w, [sg[0] * I, sg[1] * I, sg[2] * I], a);
      G.seg2(x, y, x + 0.01, y, 9, [e[0] * 1.8 * I, e[1] * 1.8 * I, e[2] * 1.8 * I], 0.7);
      G.seg2(x, y + 2, x + 0.01, y - 3, 3.5, [3.2 * I, 2.9 * I, 2.4 * I], 1);
    });

    // ---- 歌詞墜子（前半圈）＋留言、標籤：Canvas2D
    const Ly = this.layer, c = Ly.ctx;
    Ly.clear();
    c.globalAlpha = 1;
    this.drawLabels(c, t, rot, glob);
    const cur = lyrics.has ? lyricAt(lyrics, t) : null;
    // 進場時歌詞墜子等水晶環描出來才長出來（不然字會浮在半空中）
    const pk = revealing ? clamp((HOOP.y + 0.35 - yR) / 0.45) : 1;
    if (!lyrics.has) this.drawPendants(c, null, null, 0.45 * glob * pk, t, ease.outBack(pk), true);
    else {
      if (cur) {
        const kin = clamp((t - (cur.line.start - 0.35)) / 0.35);
        // 換行：上一行先收回去、淡掉，新的一行才長出來（同時畫兩行，字會疊在一起）
        let kNew = kin;
        if (kin < 1) {
          const pl = lyrics.shownLine(cur.line.start - 0.36);
          if (pl && pl !== cur.line) {
            const ko = clamp(kin / 0.4);
            this.drawPendants(c, pl, glyphStates(pl, t), (1 - ko) * glob * pk, t, (1 - ease.inCubic(ko)) * pk, false);
            kNew = clamp((kin - 0.4) / 0.6);
          }
        }
        const alpha = kin < 1 ? kNew : cur.k;
        this.drawPendants(c, cur.line, glyphStates(cur.line, t), alpha * glob * pk, t, ease.outBack(Math.min(kNew, pk)), false);
      }
    }
    this.drawMessage(c, t, glob);

    L.render(renderer, out, cam);
    comp.draw(renderer, Ly.upload(), out);
    for (const g of this.glints) {
      const [x, y] = this.proj(g.x, g.y, g.z);
      this.star(x, y, Math.min(1, g.I));
    }
    if (G.count) G.render(renderer, out);
    return { bloom: 0.9, vignette: 0.45, popupAvoid: this.avoid };
  }

  /** 左上角的 mono 小標：兩行、低對比（配角）。 */
  private drawLabels(c: CanvasRenderingContext2D, t: number, _rot: number, glob: number) {
    const s = this.ctx.start;
    c.save();
    c.globalAlpha = prog(t, s + 0.1, s + 0.7) * glob;
    // 放在右上角：吊燈往上推之後，左上角會碰到燈臂，右上角是一整片空的暗處
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.5);
    c.textAlign = 'right';
    c.fillText(this.label, W - 150, 116);
    c.fillStyle = rgba('ash', 0.38);
    c.fillText(this.label2, W - 150, 142);
    c.restore();
  }

  /**
   * 前半圈的歌詞墜子：每串的橫向位置先排好，再反解掛點角度；珠串與墜子畫進 3D 線稿、字畫在墜子正下方。
   * `grow` 0..1 珠串長出來的長度（換行時新的長出來、舊的收回去）。
   */
  private drawPendants(c: CanvasRenderingContext2D, line: Line | null, gs: GlyphState[] | null, alpha: number, t: number, grow: number, still: boolean) {
    if (alpha <= 0.01) return;
    const lay = this.tokLay(line, c);
    const len = 0.3, yTipRef = HOOP.y - 0.02 - len - 0.15;
    const kNow = Math.floor(this.ctx.audio.beatAt(t) + 1e-6);
    c.save();
    c.font = font(lay.family, lay.size);
    c.textBaseline = 'alphabetic';
    lay.toks.forEach((tk, ti) => {
      const a = this.angleFor(tk.cx, yTipRef);
      const hx = Math.sin(a) * HOOP.r, hz = Math.cos(a) * HOOP.r;
      const id = 500 + ti;
      const sw = this.swing({ id, a, r: HOOP.r, y: HOOP.y, len, beads: 3, ph: 0.07, pr: 0.034, spin: ti * 1.3, tier: 2 }, t, kNow);
      // 這串的字正在唱：唱到的那一刻閃一下、盪一下
      let I = 0, ax = sw.ax, az = sw.az;
      if (line && gs) for (const wi of tk.words) {
        const w = line.words[wi]!;
        if (t >= w.start) {
          const dt = t - w.start;
          I = Math.max(I, pulse(t, w.start, 0.13));
          ax += 0.1 * Math.exp(-dt / 0.5) * Math.sin(dt * 10);
        }
      }
      const g = Math.max(0.02, grow);
      const r = this.strand(hx, HOOP.y - 0.02, hz, { len, beads: 3, ph: 0.07, pr: 0.034, spin: ti * 1.3 }, ax, az, 0.95 * alpha, t, g);
      if (I > 0.03 && alpha > 0.3) this.glints.push({ x: r.c[0], y: r.c[1], z: r.c[2], I: I * 0.9 * alpha });
      const [tx, ty] = this.proj(r.tip[0], r.tip[1], r.tip[2]);
      // 小勾子＋字（字不轉，只跟著墜子擺）
      c.globalAlpha = alpha;
      c.strokeStyle = rgba('bone', 0.35); c.lineWidth = 1;
      c.beginPath(); c.moveTo(tx, ty + 2); c.lineTo(tx, ty + 10); c.stroke();
      const base = ty + 14 + lay.size * 0.8;
      let x = tx - tk.w / 2;
      for (let ci = tk.ci0; ci < tk.ci1; ci++) {
        const ch = lay.chars[ci]!;
        const w = tk.adv[ci - tk.ci0]!;
        if (ch.trim()) {
          c.fillStyle = still || !gs ? rgba('bone', 1) : glyphColor(gs[ci]?.p ?? 0);
          c.fillText(ch, x, base);
        }
        x += w;
      }
    });
    c.restore();
  }

  /** 主打留言（或沒有留言時的邀請）：一個字一個字從上面滴下來就位，落地閃一下。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number, glob: number) {
    const fit = this.fit;
    if (!fit) return;
    c.save();
    c.font = font(MSG_FAM, fit.size);
    c.textBaseline = 'alphabetic';
    for (const g of this.glyphs) {
      if (t < g.t0) break;
      const u = clamp((t - g.t0) / 0.34);
      const dy = -46 * (1 - ease.outBack(u, 2.2));
      c.globalAlpha = clamp(u * 3) * glob;
      c.fillStyle = g.ch === '♥' ? rgba('rose') : rgba('bone', 0.96);
      c.fillText(g.ch, g.x, g.y + dy);
      // 落地的那一刻閃一下
      const tl = g.t0 + 0.2;
      if (t >= tl && t < tl + 0.4) this.glowAt(g.x + g.w / 2, g.y - fit.size * 0.78, 0.4 * pulse(t, tl, 0.07));
    }
    c.globalAlpha = glob;
    if (this.msg) {
      const k = prog(t, this.sig.t0, this.sig.t0 + 0.5, ease.outCubic);
      if (k > 0) {
        c.globalAlpha = k * glob;
        c.font = font(F.hand(400), this.sig.size); c.fillStyle = rgba('ash', 0.95);
        c.fillText(this.sig.text, this.sig.x + 16 * (1 - k), this.sig.y);
        if (this.coupleTag) {
          c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('signal', 0.85);
          c.fillText('FROM THE COUPLE', MSG.x, this.sig.y - 4);
          c.letterSpacing = '0px';
        }
      }
    } else {
      const last = this.glyphs[this.glyphs.length - 1];
      const k = last ? prog(t, last.t0 + 0.3, last.t0 + 0.8) : 1;
      c.globalAlpha = k * glob;
      c.font = font(F.hei(500), 26); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.9);
      const w = c.measureText(INVITE_SMALL).width;
      c.fillText(INVITE_SMALL, clamp(CX - w / 2, MSG.x, MSG.x + MSG.w - w), this.inviteY);
      c.letterSpacing = '0px';
    }
    c.restore();
  }

  /** 螢幕座標上的一個小閃光（留言落地用）：畫到 glints 以外的 2D 光點。 */
  private glowAt(x: number, y: number, I: number) {
    this.star(x, y, I, 0.7);
  }

  override dispose() { super.dispose(); }
}
