// 節拍器（亮）：一張老百科全書的銅版插圖「圖一　節拍器」，只是這一台真的在動。
//  - 金字塔形的木頭節拍器站在一座展示台上，版畫線條（往塔尖收攏的直線、側面交叉線）用 shader 刻出來；
//    擺桿每一拍甩到最遠（偶數拍在右、奇數拍在左），到端點那一下刻度亮、甩出三道「滴答」線，擺桿後面拖著幾道殘影。
//    擺桿上的砝碼印著這首歌的 BPM，位置照真的節拍器：越快越往下。
//  - 歌詞沿著擺動的弧線排（像刻在量角器外圈），逐字跟唱；句子太長折成內外兩圈。
//  - 主打留言刻在展示台正面的銅牌上：第一拍開始一個字一個字刻上去（剛刻的是訊號色的暗部，冷卻成墨色），署名在右下。
//  - 沒有留言：銅牌寫「此處保留給你的祝福」與邀請。純音樂：弧線上寫歌名。
// 2026-09-29 依「MV 融合原則」：銅牌放大成畫面的焦點（留言最大、署名在最後一行下面），歌詞小一級；
// 拿掉速度對照表與大部分引線（只留標題與「發條：已上緊」兩小群），鏡頭整個窗格慢慢推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, lerp, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, lyricSizeFor, beatAfter, signature, fillWithHearts, type LyricLayout } from './_motifs';
import { Paper, stagger, pad3, mono, tag } from './_t11';
import { fillGlyph, type Rect } from './_t9';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: true, energy: [0.05, 0.7], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 幾何（邏輯像素，y 向下）
/** 擺的支點、擺桿長、擺幅（弧度）。 */
const PIV = { x: 760, y: 540 };
const ROD = 262;
const AMP = 0.46;
/** 金字塔正面：底邊 y、頂邊 y、底寬、頂寬；往右後方的深度向量。 */
const PYR = { yb: 604, yt: 262, wb: 420, wt: 84 };
const DEP = { x: 56, y: -24 };
/** 展示台正面、銅牌、留言框。 */
const PL = { x0: 150, x1: 1370, yt: 610, yb: 996 };
const PLQ = { x: 206, y: 632, w: 1108, h: 344 };
/** 留言框（銅牌裡面，扣掉下面署名那一排）。 */
const MSG_BOX = { x: 256, y: 660, w: 1008, h: 232 };
const SIG_H = 58;
/** 歌詞的弧：外圈半徑、左右各 60°。 */
const ARC_R = 372;
const SPAN = 1.2;
const LYR_MIN = 48;
const FAM_MSG = F.ming(700);
const FAM_LYR = F.archivo(100, 800);

/** 刻度板上的速度刻度。 */
const TEMPI = [40, 60, 76, 108, 120, 132, 168, 208];
const EMPTY = '此處保留給你的祝福';
const INVITE = '掃描右下角 QR code，把祝福刻上銅牌。';

const f2 = (x: number) => x.toFixed(1);
/** 砝碼離支點多遠：越快越往下（跟真的節拍器一樣）。 */
const wDistOf = (bpm: number) => lerp(236, 96, clamp((bpm - 40) / 168));
const V = (x: number, y: number) => `vec2(${f2(x)}, ${f2(y)})`;
// 金字塔正面四角、側面、頂蓋；展示台的頂面、側面
const FA = [PIV.x - PYR.wb / 2, PYR.yb], FB = [PIV.x + PYR.wb / 2, PYR.yb], FC = [PIV.x + PYR.wt / 2, PYR.yt], FD = [PIV.x - PYR.wt / 2, PYR.yt];
const TOPK = PYR.wt / PYR.wb;
const SB = [FB[0]! + DEP.x, FB[1]! + DEP.y], SC = [FC[0]! + DEP.x * TOPK, FC[1]! + DEP.y * TOPK];
const TD = [FD[0]! + DEP.x * TOPK, FD[1]! + DEP.y * TOPK];

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
    float ink = 0.0, plq = 0.0;
    // ---- 展示台
    float dFront = max(max(${f2(PL.x0)} - p.x, p.x - ${f2(PL.x1)}), max(${f2(PL.yt)} - p.y, p.y - ${f2(PL.yb)}));
    float dTop = quad(p, ${V(PL.x0, PL.yt)}, ${V(PL.x1, PL.yt)}, ${V(PL.x1 + DEP.x, PL.yt + DEP.y)}, ${V(PL.x0 + DEP.x, PL.yt + DEP.y)});
    float dSide = quad(p, ${V(PL.x1, PL.yt)}, ${V(PL.x1 + DEP.x, PL.yt + DEP.y)}, ${V(PL.x1 + DEP.x, PL.yb + DEP.y)}, ${V(PL.x1, PL.yb)});
    if (dFront < 0.0) {
      // 木紋：橫向、微微起伏的細線，很淡
      float u = (p.y + 5.0 * sin(p.x * 0.011 + sin(p.y * 0.05) * 2.0) + 3.0 * snoise(p * vec2(0.004, 0.05))) / 6.5;
      ink = max(ink, hatch(u, 0.1 + 0.08 * snoise(p * vec2(0.002, 0.02))) * 0.7);
      // 銅牌
      vec2 q = p - vec2(${f2(PLQ.x + PLQ.w / 2)}, ${f2(PLQ.y + PLQ.h / 2)});
      float dp = sdBox(q, vec2(${f2(PLQ.w / 2)}, ${f2(PLQ.h / 2)}) - 6.0) + 6.0;
      plq = aaFill(dp);
      ink *= 1.0 - plq;
      ink = max(ink, edge(dp) + edge(dp + 9.0) * 0.6);
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
      float plate = step(abs(p.x - ${f2(PIV.x)}), 30.0) * step(${f2(PYR.yt + 34)}, p.y) * step(p.y, ${f2(PIV.y + 26)});
      // 線往塔尖收攏，但不要收到比 5 px 還密（會糊成一片）
      float u = (p.x - ${f2(PIV.x)}) / mix(1.0, hw / ${f2(PYR.wb / 2)}, 0.55) / 10.0;
      ink = max(ink, hatch(u, 0.12 + 0.2 * smoothstep(-1.0, 1.0, tx)) * (1.0 - plate));
      vec2 pq = p - vec2(${f2(PIV.x)}, ${f2((PYR.yt + 34 + PIV.y + 26) / 2)});
      float dPl = sdBox(pq, vec2(30.0, ${f2((PIV.y + 26 - PYR.yt - 34) / 2)}));
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
    // 腳：展示台上的四顆小圓腳（正面看到兩顆）
    for (int i = 0; i < 2; i++) {
      vec2 fq = p - vec2(i == 0 ? ${f2(FA[0]! + 40)} : ${f2(FB[0]! - 40)}, ${f2(PYR.yb + 4)});
      float df = sdBox(fq, vec2(22.0, 5.0)) - 2.0;
      ink = max(ink, max(edge(df), aaFill(df) * hatch(fq.x / 3.0, 0.5)));
    }
    vec3 brass = mix(C_PAPER, mix(C_SIGNAL, C_BLOOD, 0.3), 0.2) * (0.93 + 0.05 * snoise(p * vec2(0.003, 0.03)));
    float a = max(plq, ink) * k;
    vec3 col = mix(brass, C_SEPIA, plq > 0.0 ? ink : 1.0);
    fragColor = vec4(col, a);
  }`, { k: { value: 1 } }, { blending: THREE.NormalBlending, transparent: true });

interface Glyph { ch: string; x: number; y: number; t: number }

export default class Metronome extends Scene {
  paper = shared('t11.paper', () => new Paper());
  body = shared('metronome.body', BODY);
  /** 不會動的：刻度板、對照表、引線、標題。 */
  still = this.track(new Layer2D(W, H, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  bpm = 120;
  /** 砝碼離支點多遠。 */
  wDist = 250;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig = ''; sigT = Infinity; sigY = 0;
  tFirst = 0;
  title = '';
  lyrSize = 64;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    // 速度折到節拍器的刻度範圍（40～208）
    let bpm = au.bpm || 100;
    while (bpm > 208) bpm /= 2;
    while (bpm < 40) bpm *= 2;
    this.bpm = Math.round(bpm);
    this.wDist = wDistOf(this.bpm);
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    this.title = song.title;
    await loadText(`${m?.text ?? ''}${this.sig}${EMPTY}${INVITE}${song.title}節拍器正視圖發條已上緊保固一輩子新人致詞敬贈`);
    const c = this.layer.ctx;
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.25, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    // ---- 銘牌：留言一個字一個字刻上去
    const text = m ? m.text : EMPTY;
    const fit = this.fit = fitText(c, text, FAM_MSG, MSG_BOX.w, MSG_BOX.h + (m ? 0 : -60), { min: 48, max: 118, lineHeight: 1.16, maxLines: 4 });
    c.font = font(FAM_MSG, fit.size);
    // 留言＋署名整塊在銅牌裡垂直置中
    const top = MSG_BOX.y + fit.size * 0.88 + Math.max(0, (MSG_BOX.h + SIG_H - fit.height - SIG_H) / 2);
    const pos: { ch: string; x: number; y: number }[] = [];
    // 銅牌的字置中（刻字的慣例）
    fit.lines.forEach((ln, li) => {
      let x = MSG_BOX.x + (MSG_BOX.w - c.measureText(ln).width) / 2;
      for (const ch of Array.from(ln)) { pos.push({ ch, x, y: top + li * fit.lineHeight }); x += c.measureText(ch).width; }
    });
    const times = stagger(au, this.tFirst + beat * 0.5, pos.length, Math.min(2 * bar, 0.4 * (e - s)));
    this.glyphs = pos.map((p, i) => ({ ...p, t: times[i]! }));
    this.sigT = (times[times.length - 1] ?? this.tFirst) + beat;
    this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + SIG_H;
    this.lyrSize = m ? lyricSizeFor(fit.size) : 64;
    this.drawStill();
    // ---- 即時小卡避開：弧線上的歌詞（兩圈的範圍）、銅牌
    const arc: Rect = [Math.round(PIV.x - Math.sin(SPAN) * (ARC_R + 60)), PIV.y - ARC_R - 70, Math.round(2 * Math.sin(SPAN) * (ARC_R + 60)), Math.round(ARC_R + 70)];
    this.avoid = [arc, [PLQ.x, PLQ.y, PLQ.w, PLQ.h]];
    void lyrics;
  }

  private layLyric(line: Line): LyricLayout {
    return layoutLyric(this.layer.ctx, line, { family: FAM_LYR, size: this.lyrSize, minSize: LYR_MIN, maxWidth: 2 * SPAN * ARC_R * 0.94, align: 'center', lineHeight: 1.14 });
  }

  /** 刻度板、量角器刻度、對照表、引線、標題（畫一次）。 */
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
      if (y < PYR.yt + 34 || y > PIV.y - 16) continue;
      c.fillStyle = ink(0.7); c.fillRect(PIV.x - 22, y, 10, 1.2); c.fillRect(PIV.x + 12, y, 10, 1.2);
      c.font = font(F.mono(500), 11); c.fillStyle = ink(0.7); c.fillText(String(bpm), PIV.x, y + 4);
    }
    c.textAlign = 'left';
    // 量角器：擺桿尖端外面一圈刻度（每 5°）
    c.strokeStyle = ink(0.4); c.lineWidth = 1;
    const R0 = ROD + 10;
    c.beginPath(); c.arc(PIV.x, PIV.y, R0, -Math.PI / 2 - 0.72, -Math.PI / 2 + 0.72); c.stroke();
    for (let d = -40; d <= 40; d += 5) {
      const a = (d * Math.PI) / 180, l = d % 10 === 0 ? 10 : 6;
      c.beginPath(); c.moveTo(PIV.x + Math.sin(a) * R0, PIV.y - Math.cos(a) * R0); c.lineTo(PIV.x + Math.sin(a) * (R0 + l), PIV.y - Math.cos(a) * (R0 + l)); c.stroke();
    }
    // 發條鑰匙（側面）與它的引線：畫面上唯一的冷面註記
    const kx = (FB[0]! + SB[0]!) / 2 + 24, ky = PYR.yb - 110;
    c.strokeStyle = ink(0.85); c.lineWidth = 1.5; c.fillStyle = rgba('paper');
    c.beginPath(); c.moveTo(kx - 24, ky); c.lineTo(kx, ky); c.stroke();
    c.beginPath(); c.ellipse(kx + 12, ky - 12, 9, 14, 0.3, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(kx + 12, ky + 12, 9, 14, -0.3, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = ink(0.45); c.lineWidth = 1;
    c.beginPath(); c.moveTo(kx + 26, ky); c.lineTo(kx + 80, ky - 54); c.lineTo(kx + 250, ky - 54); c.stroke();
    tag(c, '發條：已上緊', kx + 86, ky - 64, { size: 17, tracking: 3, color: ink(0.6) });
    mono(c, '（保固一輩子）', kx + 86, ky - 38, { size: 13, tracking: 2, color: ink(0.45) });
    // 新人的留言：銅牌左上一行小字
    if (this.msg?.couple) tag(c, '新人致詞', PLQ.x + 34, PLQ.y + 34, { size: 16, tracking: 5, color: ink(0.6) });
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
    // 殘影：往回幾格的擺桿，越舊越淡
    for (let i = 5; i >= 1; i--) this.rod(c, ang(bt - i * 0.035), 0.1 * (1 - i / 6), false);
    this.rod(c, th, 1, true);
    // 端點的「滴答」：那一端的刻度亮起、甩出三道短線
    const side = Math.cos(Math.PI * lastBeat) > 0 ? 1 : -1;
    if (tick > 0.02) {
      const a0 = side * AMP;
      const R0 = ROD + 10;
      c.strokeStyle = rgba('blood', tick); c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(PIV.x + Math.sin(a0) * R0, PIV.y - Math.cos(a0) * R0); c.lineTo(PIV.x + Math.sin(a0) * (R0 + 16), PIV.y - Math.cos(a0) * (R0 + 16)); c.stroke();
      for (const [da, r] of [[0.1, 30], [0.2, 26], [0.3, 22]] as const) {
        const a = a0 + side * da, r1 = ROD - 8 + (1 - tick) * 12;
        c.strokeStyle = rgba('sepia', 0.8 * tick); c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(PIV.x + Math.sin(a) * r1, PIV.y - Math.cos(a) * r1); c.lineTo(PIV.x + Math.sin(a) * (r1 + r), PIV.y - Math.cos(a) * (r1 + r)); c.stroke();
      }
    }
    this.arcLyric(c, t);
    this.plaque(c, t);
    c.restore();
    comp.draw(renderer, L.upload(), out);
    const push = ease.inOutCubic(clamp((t - s) / Math.max(1, this.ctx.end - s)));
    return { paper: 1, bloom: 0.3, vignette: 0.32, grain: 0.045, zoom: 1 + 0.035 * push + 0.003 * tick, popupAvoid: this.avoid };
  }

  /** 擺桿（從支點往上）與砝碼；main = 目前的那一根（畫砝碼上的 BPM）。 */
  private rod(c: CanvasRenderingContext2D, th: number, alpha: number, main: boolean) {
    c.save();
    c.translate(PIV.x, PIV.y); c.rotate(th);
    c.strokeStyle = rgba('sepia', alpha); c.lineWidth = main ? 4 : 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 24); c.lineTo(0, -ROD); c.stroke();
    if (main) {
      // 砝碼：上窄下寬的梯形，版畫的橫線陰影，印著 BPM
      const y = -this.wDist;
      c.fillStyle = rgba('paper');
      c.beginPath(); c.moveTo(-22, y - 22); c.lineTo(22, y - 22); c.lineTo(30, y + 18); c.lineTo(-30, y + 18); c.closePath(); c.fill();
      c.strokeStyle = rgba('sepia'); c.lineWidth = 1.8; c.stroke();
      c.save(); c.clip();
      c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1;
      for (let x = 8; x < 34; x += 4) { c.beginPath(); c.moveTo(x, y - 26); c.lineTo(x, y + 22); c.stroke(); }
      c.restore();
      c.font = font(F.mono(600), 14); c.fillStyle = rgba('sepia'); c.textAlign = 'center';
      c.fillText(String(this.bpm), -3, y + 5);
      c.textAlign = 'left';
      // 支點的軸
      c.fillStyle = rgba('paper'); c.beginPath(); c.arc(0, 0, 9, 0, TAU); c.fill();
      c.strokeStyle = rgba('sepia'); c.lineWidth = 1.8; c.stroke();
      c.fillStyle = rgba('sepia'); c.beginPath(); c.arc(0, 0, 2.5, 0, TAU); c.fill();
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
      c.font = font(FAM_LYR, 56);
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

  /** 銅牌：留言一個字一個字刻上去，署名。 */
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
      fillGlyph(c, g.ch, 0, 0, heat > 0 ? mixRgba(base, 'blood', heat) : rgba(base, m ? 1 : 0.55));
      c.restore();
    }
    if (!m && t >= this.sigT - 0.5) {
      c.save(); c.globalAlpha = prog(t, this.sigT - 0.5, this.sigT);
      tag(c, INVITE, MSG_BOX.x + MSG_BOX.w / 2, PLQ.y + PLQ.h - 34, { size: 24, tracking: 3, color: rgba('sepia', 0.8), weight: 500, align: 'center' });
      c.restore();
    }
    if (m && t >= this.sigT) {
      c.save(); c.globalAlpha = prog(t, this.sigT, this.sigT + 0.3);
      c.font = font(F.ming(700), 40); c.fillStyle = rgba('sepia', 0.9); c.textAlign = 'right';
      c.fillText(`${this.sig}　敬贈`, MSG_BOX.x + MSG_BOX.w, this.sigY);
      c.restore();
    }
  }
}
