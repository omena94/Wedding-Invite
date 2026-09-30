// 節拍器（亮）：一張老百科全書的銅版插圖「圖一　節拍器」，只是這一台真的在動。
//  - 主視覺是一台大大的金字塔形木頭節拍器（佔畫面左半），版畫線條（往塔尖收攏的直線、側面交叉線）用 shader 刻出來；
//    擺桿每一拍甩到最遠（偶數拍在右、奇數拍在左），到端點那一下刻度亮、甩出三道「滴答」線，擺桿後面拖著幾道殘影。
//    擺桿上的砝碼印著這首歌的 BPM，位置照真的節拍器：越快越往下。
//    機芯的小窗裡，擒縱輪一拍「喀」地轉一齒；側面的小鈴每小節的第一拍「叮」一下（真的節拍器就是這樣報小節）；發條鑰匙慢慢轉。
//  - 歌詞沿著擺動的弧線排（像刻在量角器外圈），逐字跟唱；句子太長折成內外兩圈。
//  - 主打留言刻在底座的銘牌上。銘牌在圖上很小，所以照技術插圖的慣例畫一個圈、拉兩條引線到右邊的「圖二　放大圖」：
//    放大的銅牌上，第一拍開始一個字一個字刻上去（剛刻的是訊號色的暗部，冷卻成墨色），署名在最後一行下面。
//  - 沒有留言：銅牌寫「此處保留給你的祝福」與邀請。純音樂：弧線上寫歌名。
// 2026-09-29「留言尺寸與版面比例標準 v2」：節拍器放大成主視覺，留言縮到 40～60 px、放在右邊的放大圖裡（≤ 700 × 400）；
// 補上擒縱輪、報小節的鈴、發條鑰匙這些會動的零件。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, lerp, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, beatAfter, signature, fillWithHearts, lyricSubOf, type LyricLayout } from './_motifs';
import { Paper, stagger, mono, tag } from './_t11';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { fillGlyph, type Rect } from './_t9';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: true, energy: [0.05, 0.7], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 幾何（邏輯像素，y 向下）
/** 擺的支點、擺桿長、擺幅（弧度）。 */
const PIV = { x: 640, y: 764 };
const ROD = 500;
const AMP = 0.42;
/** 金字塔正面：底邊 y、頂邊 y、底寬、頂寬；往右後方的深度向量。 */
const PYR = { yb: 834, yt: 236, wb: 640, wt: 116 };
const DEP = { x: 80, y: -34 };
/** 展示台（正面）與上面的小銘牌。 */
const PL = { x0: 250, x1: 1030, yt: 840, yb: 962 };
const SPL = { x: 560, y: 874, w: 160, h: 58 };
/** 右邊的放大圖（銘牌）：寬 700、高依留言（≤ 400），垂直置中在 CY。 */
const DET = { x: 1140, w: 660, cy: 540, maxH: 400, pad: 40 };
/** 歌詞的弧：外圈半徑、左右各多少弧度。 */
const ARC_R = 606;
const SPAN = 0.8;
const FAM_MSG = F.ming(700);
const FAM_LYR = F.archivo(100, 800);
/** 擒縱輪的小窗、報小節的鈴。 */
const GEAR = { x: 520, y: 796, r: 28, teeth: 15 };
const BELL = { x: 1010, y: 610 };

/** 刻度板上的速度刻度。 */
const TEMPI = [40, 60, 76, 108, 120, 132, 168, 208];
const EMPTY = '此處保留給你的祝福';
const INVITE = '掃描右下角 QR code，把祝福刻上銅牌。';

const f2 = (x: number) => x.toFixed(1);
/** 砝碼離支點多遠：越快越往下（跟真的節拍器一樣）。 */
const wDistOf = (bpm: number) => lerp(430, 190, clamp((bpm - 40) / 168));
const V = (x: number, y: number) => `vec2(${f2(x)}, ${f2(y)})`;
// 金字塔正面四角、側面、頂蓋
const FA = [PIV.x - PYR.wb / 2, PYR.yb], FB = [PIV.x + PYR.wb / 2, PYR.yb], FC = [PIV.x + PYR.wt / 2, PYR.yt], FD = [PIV.x - PYR.wt / 2, PYR.yt];
const TOPK = PYR.wt / PYR.wb;
const SB = [FB[0]! + DEP.x, FB[1]! + DEP.y], SC = [FC[0]! + DEP.x * TOPK, FC[1]! + DEP.y * TOPK];
const TD = [FD[0]! + DEP.x * TOPK, FD[1]! + DEP.y * TOPK];
/** 刻度板（正面中間那一條）的上下。 */
const SCALE_Y0 = PYR.yt + 40, SCALE_Y1 = PIV.y + 26;

const BODY = () => new FSPass(/* glsl */ `
  uniform float k;
  // 凸四邊形的（近似）距離：各邊的有號距離取最大（外面為正）
  float esd(vec2 p, vec2 a, vec2 b, vec2 ce) { vec2 e = b - a; vec2 n = normalize(vec2(-e.y, e.x)); if (dot(ce - a, n) > 0.0) n = -n; return dot(p - a, n); }
  float quad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
    vec2 ce = (a + b + c + d) * 0.25;
    return max(max(esd(p, a, b, ce), esd(p, b, c, ce)), max(esd(p, c, d, ce), esd(p, d, a, ce)));
  }
  float edge(float sd) { return pxLine(abs(sd), 0.55, 1.5); }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float ink = 0.0;
    // ---- 展示台
    float dFront = max(max(${f2(PL.x0)} - p.x, p.x - ${f2(PL.x1)}), max(${f2(PL.yt)} - p.y, p.y - ${f2(PL.yb)}));
    float dTop = quad(p, ${V(PL.x0, PL.yt)}, ${V(PL.x1, PL.yt)}, ${V(PL.x1 + DEP.x, PL.yt + DEP.y)}, ${V(PL.x0 + DEP.x, PL.yt + DEP.y)});
    float dSide = quad(p, ${V(PL.x1, PL.yt)}, ${V(PL.x1 + DEP.x, PL.yt + DEP.y)}, ${V(PL.x1 + DEP.x, PL.yb + DEP.y)}, ${V(PL.x1, PL.yb)});
    if (dFront < 0.0) {
      // 木紋：橫向、微微起伏的細線，很淡
      float u = (p.y + 5.0 * sin(p.x * 0.011 + sin(p.y * 0.05) * 2.0) + 3.0 * snoise(p * vec2(0.004, 0.05))) / 6.5;
      ink = max(ink, hatch(u, 0.1 + 0.08 * snoise(p * vec2(0.002, 0.02))) * 0.7);
      // 小銘牌（留白＋雙框）
      vec2 q = p - vec2(${f2(SPL.x + SPL.w / 2)}, ${f2(SPL.y + SPL.h / 2)});
      float dp = sdBox(q, vec2(${f2(SPL.w / 2)}, ${f2(SPL.h / 2)}) - 4.0) + 4.0;
      ink *= smoothstep(-1.0, 1.0, dp);
      ink = max(ink, edge(dp) + edge(dp + 5.0) * 0.6);
    }
    if (dTop < 0.0) ink = max(ink, hatch(dot(p, normalize(vec2(${f2(-DEP.y)}, ${f2(DEP.x)}))) / 5.0, 0.3));
    if (dSide < 0.0) ink = max(ink, max(hatch(p.x / 5.0, 0.36), hatch((p.y - p.x * 0.43) / 7.0, 0.18)));
    ink = max(ink, max(edge(dFront), max(edge(dTop), edge(dSide))));
    // ---- 金字塔：正面（線往塔尖收攏）、右側面（較暗、交叉線）、頂蓋
    float dF = quad(p, ${V(FA[0]!, FA[1]!)}, ${V(FB[0]!, FB[1]!)}, ${V(FC[0]!, FC[1]!)}, ${V(FD[0]!, FD[1]!)});
    float dS = quad(p, ${V(FB[0]!, FB[1]!)}, ${V(SB[0]!, SB[1]!)}, ${V(SC[0]!, SC[1]!)}, ${V(FC[0]!, FC[1]!)});
    float dT = quad(p, ${V(FD[0]!, FD[1]!)}, ${V(FC[0]!, FC[1]!)}, ${V(SC[0]!, SC[1]!)}, ${V(TD[0]!, TD[1]!)});
    if (dF < 0.0 || dS < 0.0 || dT < 0.0) ink *= 0.0;
    if (dF < 0.0) {
      float yy = clamp((${f2(PYR.yb)} - p.y) / ${f2(PYR.yb - PYR.yt)}, 0.0, 1.0);
      float hw = mix(${f2(PYR.wb / 2)}, ${f2(PYR.wt / 2)}, yy);
      float tx = (p.x - ${f2(PIV.x)}) / hw;
      // 光從左上來：左邊亮、右邊暗；刻度板那一條留白
      float plate = step(abs(p.x - ${f2(PIV.x)}), 34.0) * step(${f2(SCALE_Y0)}, p.y) * step(p.y, ${f2(SCALE_Y1)});
      // 線往塔尖收攏，但不要收到比 5 px 還密（會糊成一片）
      float u = (p.x - ${f2(PIV.x)}) / mix(1.0, hw / ${f2(PYR.wb / 2)}, 0.55) / 11.0;
      ink = max(ink, hatch(u, 0.1 + 0.2 * smoothstep(-1.0, 1.0, tx)) * (1.0 - plate));
      vec2 pq = p - vec2(${f2(PIV.x)}, ${f2((SCALE_Y0 + SCALE_Y1) / 2)});
      float dPl = sdBox(pq, vec2(34.0, ${f2((SCALE_Y1 - SCALE_Y0) / 2)}));
      ink = max(ink, edge(dPl) + edge(dPl + 5.0) * 0.5);
    }
    if (dS < 0.0) {
      vec2 ed = normalize(${V(FC[0]! - FB[0]!, FC[1]! - FB[1]!)});
      float u = dot(p, vec2(-ed.y, ed.x));
      ink = max(ink, engrave(p / 10.0, 0.34, 1.0, atan(ed.y, ed.x)) * 0.8);
      ink = max(ink, hatch(u / 6.0, 0.3));
    }
    if (dT < 0.0) ink = max(ink, hatch(p.x / 4.0, 0.3));
    ink = max(ink, max(edge(dF), max(edge(dS), edge(dT))));
    // 腳：展示台上的小圓腳（正面看到兩顆）
    for (int i = 0; i < 2; i++) {
      vec2 fq = p - vec2(i == 0 ? ${f2(FA[0]! + 50)} : ${f2(FB[0]! - 50)}, ${f2(PYR.yb + 3)});
      float df = sdBox(fq, vec2(26.0, 4.0)) - 2.0;
      ink = max(ink, max(edge(df), aaFill(df) * hatch(fq.x / 3.0, 0.5)));
    }
    fragColor = vec4(C_SEPIA, ink * k);
  }`, { k: { value: 1 } }, { blending: THREE.NormalBlending, transparent: true });

interface Glyph { ch: string; x: number; y: number; t: number }

export default class Metronome extends Scene {
  paper = shared('t11.paper', () => new Paper());
  body = shared('metronome.body', BODY);
  /** 不會動的：刻度板、量角器、放大圖的銅牌與引線、標題。 */
  still = this.track(new Layer2D(W, H, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  bpm = 120;
  /** 砝碼離支點多遠。 */
  wDist = 250;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig = ''; sigT = Infinity; sigY = 0; sigSize = 30;
  /** 放大圖的銅牌（依留言的高度）。 */
  plq = { x: DET.x, y: 360, w: DET.w, h: 320 };
  tFirst = 0;
  title = '';
  lyrSize = 52;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    // 速度折到節拍器的刻度範圍（40～208）
    let bpm = au.bpm || 100;
    while (bpm > 208) bpm /= 2;
    while (bpm < 40) bpm *= 2;
    this.bpm = Math.round(bpm);
    this.wDist = wDistOf(this.bpm);
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    this.title = song.title;
    await loadText(`${m?.text ?? ''}${this.sig}${EMPTY}${INVITE}${song.title}節拍器正視圖底座銘牌放大新人致詞敬贈`);
    const c = this.layer.ctx;
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.25, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    // ---- 放大圖的銅牌：留言字級照標準 v2（上限看字數），扣掉署名那一排再找；先照子句斷行
    const text = m ? m.text : EMPTY;
    const max = m ? msgMaxFor(text) : 48;
    const sig0 = sigV2(max);
    const tw = DET.w - 2 * DET.pad;
    const room = DET.maxH - 2 * DET.pad - (m ? sig0 * 2.1 : 40);
    const o = { min: V2.msgMin, max, lineHeight: 1.22, maxLines: 5 };
    const fit = this.fit = fitClauses(c, text, FAM_MSG, tw, room, o) ?? fitText(c, text, FAM_MSG, tw, room, o);
    this.sigSize = sigV2(fit.size);
    const sigGap = m ? this.sigSize * 2 : 44;
    const ph = Math.round(2 * DET.pad + fit.height + sigGap - 4);
    this.plq = { x: DET.x, y: Math.round(DET.cy - ph / 2), w: DET.w, h: ph };
    c.font = font(FAM_MSG, fit.size);
    const top = this.plq.y + DET.pad + fit.size * 0.9;
    const pos: { ch: string; x: number; y: number }[] = [];
    // 銅牌的字置中（刻字的慣例）
    fit.lines.forEach((ln, li) => {
      let x = DET.x + (DET.w - c.measureText(ln).width) / 2;
      for (const ch of Array.from(ln)) { pos.push({ ch, x, y: top + li * fit.lineHeight }); x += c.measureText(ch).width; }
    });
    const times = stagger(au, this.tFirst + beat * 0.5, pos.length, Math.min(2 * bar, 0.4 * (e - s)));
    this.glyphs = pos.map((p, i) => ({ ...p, t: times[i]! }));
    this.sigT = (times[times.length - 1] ?? this.tFirst) + beat;
    this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + sigGap;
    this.lyrSize = lyricV2(m ? fit.size : null);
    this.drawStill();
    const arc: Rect = [Math.round(PIV.x - Math.sin(SPAN) * (ARC_R + 60)), PIV.y - ARC_R - 70, Math.round(2 * Math.sin(SPAN) * (ARC_R + 60)), 260];
    this.avoid = [arc, [this.plq.x, this.plq.y, this.plq.w, this.plq.h]];
  }

  private layLyric(line: Line): LyricLayout {
    return layoutLyric(this.layer.ctx, line, { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin, maxWidth: 2 * SPAN * ARC_R * 0.96, align: 'center', lineHeight: 1.14 });
  }

  /** 刻度板、量角器刻度、放大圖（銅牌、引線）、標題（畫一次）。 */
  private drawStill() {
    const L = this.still, c = L.ctx;
    L.clear();
    const ink = (a: number) => rgba('sepia', a);
    // 標題（很小、很淡）
    mono(c, 'FIG. 1', 112, 132, { size: 15, tracking: 4, color: ink(0.55), weight: 600 });
    tag(c, '節拍器　正視圖', 196, 132, { size: 17, tracking: 6, color: ink(0.6), weight: 500 });
    // 刻度板：速度刻度（數字越大越下面，跟真的節拍器一樣）
    c.textAlign = 'center';
    for (const bpm of TEMPI) {
      const y = PIV.y - wDistOf(bpm);
      if (y < SCALE_Y0 + 6 || y > PIV.y - 16) continue;
      c.fillStyle = ink(0.7); c.fillRect(PIV.x - 26, y, 12, 1.2); c.fillRect(PIV.x + 14, y, 12, 1.2);
      c.font = font(F.mono(500), 12); c.fillStyle = ink(0.7); c.fillText(String(bpm), PIV.x, y + 4);
    }
    c.textAlign = 'left';
    // 量角器：擺桿尖端外面一圈刻度（每 5°）
    c.strokeStyle = ink(0.4); c.lineWidth = 1;
    const R0 = ROD + 10;
    c.beginPath(); c.arc(PIV.x, PIV.y, R0, -Math.PI / 2 - 0.66, -Math.PI / 2 + 0.66); c.stroke();
    for (let d = -35; d <= 35; d += 5) {
      const a = (d * Math.PI) / 180, l = d % 10 === 0 ? 11 : 6;
      c.beginPath(); c.moveTo(PIV.x + Math.sin(a) * R0, PIV.y - Math.cos(a) * R0); c.lineTo(PIV.x + Math.sin(a) * (R0 + l), PIV.y - Math.cos(a) * (R0 + l)); c.stroke();
    }
    // 小銘牌上幾條代表字的細線（太小，讀不到：所以要看放大圖）
    c.strokeStyle = ink(0.45); c.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const y = SPL.y + 16 + i * 13, w = SPL.w - 40 - i * 18; c.beginPath(); c.moveTo(SPL.x + (SPL.w - w) / 2, y); c.lineTo(SPL.x + (SPL.w + w) / 2, y); c.stroke(); }
    // 放大圖：小銘牌外面畫一個圈，兩條引線拉到右邊的放大圖
    const P = this.plq;
    const ex = SPL.x + SPL.w / 2, ey = SPL.y + SPL.h / 2, erx = SPL.w / 2 + 26, ery = SPL.h / 2 + 18;
    c.strokeStyle = ink(0.55); c.lineWidth = 1.3;
    c.beginPath(); c.ellipse(ex, ey, erx, ery, 0, 0, TAU); c.stroke();
    c.setLineDash([6, 5]);
    c.beginPath(); c.moveTo(ex + erx * 0.6, ey - ery * 0.8); c.lineTo(P.x, P.y); c.stroke();
    c.beginPath(); c.moveTo(ex + erx * 0.9, ey + ery * 0.45); c.lineTo(P.x, P.y + P.h); c.stroke();
    c.setLineDash([]);
    tag(c, '圖二　底座銘牌（放大）', P.x, P.y - 18, { size: 16, tracking: 5, color: ink(0.6) });
    // 放大的銅牌：淡淡的黃銅、細細的橫紋、雙框、四顆螺絲
    c.fillStyle = mixRgba('paper', 'signal', 0.14); c.fillRect(P.x, P.y, P.w, P.h);
    c.strokeStyle = ink(0.06); c.lineWidth = 1;
    for (let y = P.y + 4; y < P.y + P.h; y += 5) { c.beginPath(); c.moveTo(P.x, y); c.lineTo(P.x + P.w, y); c.stroke(); }
    c.strokeStyle = ink(0.85); c.lineWidth = 1.6; c.strokeRect(P.x, P.y, P.w, P.h);
    c.strokeStyle = ink(0.45); c.lineWidth = 1; c.strokeRect(P.x + 9, P.y + 9, P.w - 18, P.h - 18);
    for (const [sx, sy] of [[P.x + 20, P.y + 20], [P.x + P.w - 20, P.y + 20], [P.x + 20, P.y + P.h - 20], [P.x + P.w - 20, P.y + P.h - 20]] as const) {
      c.strokeStyle = ink(0.7); c.lineWidth = 1.2; c.beginPath(); c.arc(sx, sy, 5, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(sx - 3.5, sy - 3.5); c.lineTo(sx + 3.5, sy + 3.5); c.stroke();
    }
    if (this.msg?.couple) tag(c, '新人致詞', P.x + 36, P.y + 30, { size: 15, tracking: 5, color: ink(0.55) });
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    this.body.u.k!.value = 1;
    this.body.render(renderer, out);
    comp.draw(renderer, this.still.texture, out);
    const L = this.layer, c = L.ctx;
    L.clear();
    // 每一格從同樣的畫布狀態開始（線頭、對齊、字距…不會被上一格留下來的設定影響）
    c.save();

    // ---- 擺：偶數拍在右端、奇數拍在左端（cos 的兩端正好落在拍點上）
    const bt = au.beatAt(t);
    const ang = (b: number) => AMP * Math.cos(Math.PI * b);
    const th = ang(bt);
    const lastBeat = Math.floor(bt + 1e-4);
    const tick = pulse(t, au.timeOfBeat(lastBeat), 0.12);
    this.gear(c, bt);
    this.bell(c, t);
    this.key(c, t);
    // 殘影：往回幾格的擺桿，越舊越淡
    for (let i = 5; i >= 1; i--) this.rod(c, ang(bt - i * 0.035), 0.1 * (1 - i / 6), false);
    this.rod(c, th, 1, true);
    // 端點的「滴答」：那一端的刻度亮起、甩出三道短線
    const side = Math.cos(Math.PI * lastBeat) > 0 ? 1 : -1;
    if (tick > 0.02) {
      const a0 = side * AMP;
      const R0 = ROD + 10;
      c.strokeStyle = rgba('blood', tick); c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(PIV.x + Math.sin(a0) * R0, PIV.y - Math.cos(a0) * R0); c.lineTo(PIV.x + Math.sin(a0) * (R0 + 18), PIV.y - Math.cos(a0) * (R0 + 18)); c.stroke();
      for (const [da, r] of [[0.08, 34], [0.16, 30], [0.24, 26]] as const) {
        const a = a0 + side * da, r1 = ROD - 10 + (1 - tick) * 14;
        c.strokeStyle = rgba('sepia', 0.8 * tick); c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(PIV.x + Math.sin(a) * r1, PIV.y - Math.cos(a) * r1); c.lineTo(PIV.x + Math.sin(a) * (r1 + r), PIV.y - Math.cos(a) * (r1 + r)); c.stroke();
      }
    }
    this.arcLyric(c, t);
    this.plaque(c, t);
    c.restore();
    comp.draw(renderer, L.upload(), out);
    const push = ease.inOutCubic(clamp((t - s) / Math.max(1, this.ctx.end - s)));
    return { paper: 1, bloom: 0.3, vignette: 0.32, grain: 0.045, zoom: 1 + 0.03 * push + 0.003 * tick, popupAvoid: this.avoid };
  }

  /** 擺桿（從支點往上）與砝碼；main = 目前的那一根（畫砝碼上的 BPM）。 */
  private rod(c: CanvasRenderingContext2D, th: number, alpha: number, main: boolean) {
    c.save();
    c.translate(PIV.x, PIV.y); c.rotate(th);
    c.strokeStyle = rgba('sepia', alpha); c.lineWidth = main ? 5 : 3.5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 30); c.lineTo(0, -ROD); c.stroke();
    if (main) {
      // 砝碼：上窄下寬的梯形，版畫的直線陰影，印著 BPM
      const y = -this.wDist;
      c.fillStyle = rgba('paper');
      c.beginPath(); c.moveTo(-30, y - 30); c.lineTo(30, y - 30); c.lineTo(40, y + 24); c.lineTo(-40, y + 24); c.closePath(); c.fill();
      c.strokeStyle = rgba('sepia'); c.lineWidth = 2; c.stroke();
      c.save(); c.clip();
      c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1;
      for (let x = 10; x < 44; x += 4) { c.beginPath(); c.moveTo(x, y - 34); c.lineTo(x, y + 28); c.stroke(); }
      c.restore();
      c.font = font(F.mono(600), 18); c.fillStyle = rgba('sepia'); c.textAlign = 'center';
      c.fillText(String(this.bpm), -4, y + 6);
      c.textAlign = 'left';
      // 支點的軸
      c.fillStyle = rgba('paper'); c.beginPath(); c.arc(0, 0, 12, 0, TAU); c.fill();
      c.strokeStyle = rgba('sepia'); c.lineWidth = 2; c.stroke();
      c.fillStyle = rgba('sepia'); c.beginPath(); c.arc(0, 0, 3, 0, TAU); c.fill();
    }
    c.restore();
  }

  /** 機芯的小窗：擒縱輪一拍「喀」地轉一齒（很快轉到、停住）。 */
  private gear(c: CanvasRenderingContext2D, bt: number) {
    const G = GEAR;
    const b = Math.floor(bt + 1e-4), fr = bt - b;
    const a = ((b + ease.outExpo(clamp(fr / 0.18))) * TAU) / G.teeth;
    c.save();
    c.fillStyle = rgba('paper'); c.beginPath(); c.arc(G.x, G.y, G.r + 4, 0, TAU); c.fill();
    c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 1.6; c.stroke();
    c.beginPath(); c.arc(G.x, G.y, G.r + 4, 0, TAU); c.clip();
    c.translate(G.x, G.y); c.rotate(a);
    c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 1.2;
    c.beginPath();
    for (let i = 0; i < G.teeth; i++) {
      const a0 = (i * TAU) / G.teeth, a1 = a0 + (TAU / G.teeth) * 0.6;
      const r0 = G.r * 0.72, r1 = G.r * 1.02;
      c.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0); c.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1); c.lineTo(Math.cos(a0 + TAU / G.teeth) * r0, Math.sin(a0 + TAU / G.teeth) * r0);
    }
    c.stroke();
    c.beginPath(); c.arc(0, 0, G.r * 0.3, 0, TAU); c.stroke();
    for (let i = 0; i < 4; i++) { const aa = (i * TAU) / 4; c.beginPath(); c.moveTo(Math.cos(aa) * G.r * 0.3, Math.sin(aa) * G.r * 0.3); c.lineTo(Math.cos(aa) * G.r * 0.7, Math.sin(aa) * G.r * 0.7); c.stroke(); }
    c.restore();
  }

  /** 報小節的鈴：每小節的第一拍小錘敲一下，鈴晃一下、震出三圈聲波。 */
  private bell(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const b = Math.floor(au.barAt(t) + 1e-4), tb = au.timeOfBar(b), age = t - tb;
    const hit = age >= 0 ? pulse(t, tb, 0.18) : 0;
    const sway = age >= 0 ? Math.exp(-age * 5) * Math.sin(age * 22) * 0.18 : 0;
    const { x, y } = BELL;
    c.save();
    // 支架：從側面伸出來
    c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 2;
    c.beginPath(); c.moveTo(x - 36, y + 20); c.lineTo(x, y + 20); c.lineTo(x, y - 2); c.stroke();
    c.translate(x, y); c.rotate(sway);
    // 鈴：半圓的罩子，版畫的弧線陰影
    c.fillStyle = rgba('paper');
    c.beginPath(); c.moveTo(-26, 26); c.bezierCurveTo(-26, -4, -16, -26, 0, -26); c.bezierCurveTo(16, -26, 26, -4, 26, 26); c.closePath(); c.fill();
    c.strokeStyle = rgba('sepia'); c.lineWidth = 1.8; c.stroke();
    c.save(); c.clip();
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1;
    for (let i = 0; i < 7; i++) { c.beginPath(); c.arc(-40 + i * 3, 30, 40 + i * 4, -1.2, -0.4); c.stroke(); }
    c.restore();
    c.fillStyle = rgba('sepia'); c.beginPath(); c.arc(0, -30, 4, 0, TAU); c.fill();
    c.restore();
    // 小錘：平常離開一點，第一拍敲上去
    const hx = x + 44 - 16 * hit, hy = y + 10;
    c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 2;
    c.beginPath(); c.moveTo(x + 70, y + 40); c.lineTo(hx, hy); c.stroke();
    c.fillStyle = rgba('sepia'); c.beginPath(); c.arc(hx, hy, 5, 0, TAU); c.fill();
    // 聲波：三圈往外擴散的弧線（叮）
    if (age >= 0 && age < 0.6) {
      for (let i = 0; i < 3; i++) {
        const r = 36 + i * 14 + age * 90, a = (1 - age / 0.6) * (1 - i * 0.25);
        c.strokeStyle = mixRgba('sepia', 'blood', 0.6, a); c.lineWidth = 1.6;
        c.beginPath(); c.arc(x, y, r, -0.9, 0.5); c.stroke();
      }
    }
  }

  /** 發條鑰匙：在側面，兩小節慢慢轉一圈（扁掉的橢圓看得出在轉）。 */
  private key(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const a = (au.barAt(t) / 2) * TAU;
    const kx = (FB[0]! + SB[0]!) / 2 + 20, ky = PYR.yb - 150;
    const sq = Math.abs(Math.cos(a));
    c.save();
    c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 1.6; c.fillStyle = rgba('paper');
    c.beginPath(); c.moveTo(kx - 26, ky); c.lineTo(kx, ky); c.stroke();
    for (const sd of [-1, 1]) {
      c.beginPath(); c.ellipse(kx + 10, ky + sd * 14 * Math.cos(a), 6 + 5 * sq, 14, 0, 0, TAU); c.fill(); c.stroke();
    }
    c.restore();
  }

  /** 歌詞沿著弧線（外圈；太長折成內外兩圈），逐字跟唱。純音樂：弧線上寫歌名。 */
  private arcLyric(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    const active = mixRgba('blood', 'signal', 0.25), sung = rgba('sepia', 0.95), unsung = rgba('sepia', 0.28);
    c.textBaseline = 'alphabetic';
    if (!ly) {
      if (this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).length) return;
      // 純音樂：歌名
      c.font = font(FAM_LYR, this.lyrSize);
      const w = c.measureText(this.title).width;
      let x = -w / 2;
      for (const ch of Array.from(this.title)) {
        const cw = c.measureText(ch).width;
        this.glyphOnArc(c, ch, x + cw / 2, ARC_R, cw, 1, rgba('sepia', 0.9), '', 1);
        x += cw;
      }
      return;
    }
    const lay = this.layLyric(ly.line);
    c.font = font(FAM_LYR, lay.size);
    const rowY = lay.rows.map((r) => r.y);
    for (const pw of lay.words) {
      const row = rowY.indexOf(pw.y);
      const R = ARC_R - row * lay.size * 1.14;
      const p = Lyrics.wordProgress(pw.word, t);
      const xc = pw.x + pw.w / 2;
      // 進場：提早一點點從內圈浮上來
      const kin = ease.outCubic(ly.k);
      this.glyphOnArc(c, pw.word.w, xc, R - (1 - kin) * 14, pw.w, p, p < 1 ? active : sung, unsung, ly.k);
    }
    // 原文副行（韓文歌）：一樣立在弧上、往內一圈、小一號（layoutLyric 已經排好：lay.sub.dy 是離主行第一圈基線多遠）。
    // 比中文安靜：唱到、唱完都是墨色淡兩成，還沒唱的三成
    const sub = lyricSubOf(ly.line);
    if (sub && lay.sub) {
      const sl = lay.sub.lay, lit = rgba('sepia', 0.95 * 0.8), kin = ease.outCubic(ly.k);
      c.font = font(FAM_LYR, sl.size);
      for (const pw of sl.words) {
        const p = Lyrics.wordProgress(pw.word, t);
        this.glyphOnArc(c, pw.word.w, pw.x + pw.w / 2, ARC_R - lay.sub.dy - pw.y - (1 - kin) * 14, pw.w, p, lit, unsung, ly.k);
      }
    }
  }

  /** 一個字（或英文一個字）立在半徑 R 的弧上，xc 是它的中心沿弧的距離（0 = 正上方）；p = 唱到幾成（左到右擦亮）。 */
  private glyphOnArc(c: CanvasRenderingContext2D, s: string, xc: number, R: number, w: number, p: number, on: string, off: string, alpha: number) {
    const a = xc / R;
    c.save();
    c.globalAlpha = alpha;
    c.translate(PIV.x + Math.sin(a) * R, PIV.y - Math.cos(a) * R);
    c.rotate(a);
    if (p < 1 && off) { c.fillStyle = off; fillWithHearts(c, s, -w / 2, 0); }
    if (p > 0) {
      c.beginPath(); c.rect(-w / 2 - 6, -120, (w + 12) * clamp(p), 160); c.clip();
      c.fillStyle = on; fillWithHearts(c, s, -w / 2, 0);
    }
    c.restore();
  }

  /** 放大圖的銅牌：留言一個字一個字刻上去，署名在最後一行下面。 */
  private plaque(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit!, m = this.msg;
    c.font = font(FAM_MSG, fit.size);
    for (const g of this.glyphs) {
      if (t < g.t) continue;
      const heat = 1 - clamp((t - g.t) / 0.5);
      const base = g.ch === '♥' ? 'rose' : 'sepia';
      // 刻下去的那一下：字從大一點點收回來
      const sc = 1 + 0.12 * (1 - ease.outCubic(clamp((t - g.t) / 0.18)));
      c.save(); c.translate(g.x, g.y); c.scale(sc, sc);
      fillGlyph(c, g.ch, 0, 0, heat > 0 ? mixRgba(base, 'blood', heat) : rgba(base, m ? 1 : 0.5));
      c.restore();
    }
    if (!m && t >= this.sigT - 0.5) {
      c.save(); c.globalAlpha = prog(t, this.sigT - 0.5, this.sigT);
      tag(c, INVITE, DET.x + DET.w / 2, this.sigY, { size: 20, tracking: 3, color: rgba('sepia', 0.75), weight: 500, align: 'center' });
      c.restore();
    }
    if (m && t >= this.sigT) {
      c.save(); c.globalAlpha = prog(t, this.sigT, this.sigT + 0.3);
      c.font = font(F.ming(700), this.sigSize); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'right';
      c.fillText(`${this.sig}　敬贈`, DET.x + DET.w - DET.pad, this.sigY);
      c.restore();
    }
  }
}
