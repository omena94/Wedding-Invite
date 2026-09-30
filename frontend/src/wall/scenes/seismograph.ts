// 地震儀（機器 B，亮）：一台「心動地震儀」的記錄紙特寫。紙由下往上捲（從機器的蓋板底下出來、往上經過滾筒捲走），
// 筆針從畫面下方的長臂伸上來，在紙上畫出震波。
//  - 震波是這首歌真的鼓：每個大鼓是一小串衰減的震盪、小鼓小一點，平常有細細的「微震」。筆臂是繞著畫面外的支點擺的，
//    擺得越遠筆尖越往下沉，所以大的震波會彎成弧形（真的地震儀就是這樣）。剛畫的墨還是濕的（訊號色的暗部），一會兒乾成墨色。
//  - 窗格中段的一個小節線是「主震」：先來一小段 P 波的細碎抖動，接著筆臂整個甩到底、撞到擋塊（波形被削平），
//    畫面震一下；留言紙條上蓋下一個圓章「心動震度 7」。
//  - 歌詞是寫在紙上的標註：一句歌詞從筆的位置出現、跟著紙往上捲，一條細引線拉到它開始唱的那一刻的波形上（標一個小圓圈，
//    像地震學家標「初動」），照跟唱規則逐字亮（亮版面：正在唱的是訊號色的暗部）。紙速依歌詞排好：唱的時候一定還在報告下方讀得到。
//  - 紙的右緣還有一支「計時筆」：每個小節線往外打一下，在紙上留一個小刻痕（窗格裡每小節的小事件）。
//  - 主打留言是觀測員夾在記錄紙右上角的一張小手寫紙條（真的紙：有陰影、迴紋針、稍微歪；v2 字級、紙條只比字大一點），一段一段寫上去，署名；
//    主震那一拍蓋上圓章。紙條上沒有表格、標題或編號——只有留言。沒有留言：不放紙條，歌詞放大成焦點，蓋板上一小行邀請。
//  - 純音樂：標註改成每四小節印一次歌名。
//  - 鏡頭：整台機器（紙、筆臂、蓋板）是桌上的一個平面，鏡頭稍微從上往下斜斜地看、慢慢推近；
//    焦點轉移：開場對焦在筆與震波上，留言開始寫的時候移到紙條。
// 手法：紙、格線、打孔、蓋板是一個 GLSL pass（只改捲動量）；震波與筆臂是 LineBatch（一般混色的墨線）；
// 紙上的標註一張 Canvas 層（每格重畫，因為整張紙在動）；紙條一張小 Canvas 層（內容變了才重畫）；全部畫進離屏圖再用 _t8 的舞台拍。
import type * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, noise1, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { layoutLyric, type LyricLayout, type LyricStyle, drawHeart, signature, beatAfter, COUPLE_ZH, lyricSubOf, drawLyricSub } from './_motifs';
import { blit, winBars, label, INVITE, T8_TEXT, Stage, camMove, type StageCam } from './_t8';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'machine', paper: true, energy: [0.25, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素，y 向下）
/** 記錄紙（左右邊界）。 */
const PX0 = 110, PX1 = 1340;
/** 震波的中線、最大擺幅（撞到擋塊）。 */
const CX = 350, AMAX = 220;
/** 筆尖（靜止時）的高度、筆臂長度（支點在畫面外下方）。 */
const PEN_Y = 826, ARM = 440;
/** 蓋板的上緣。 */
const COVER_Y = 900;
/** 標註（歌詞）的左緣與寬度。 */
const LX = 560, LW = 770;
/** 地震報告卡（畫面上的範圍；卡片本身在裡面稍微歪一點）。 */
const CARD = { x: 700, y: 84, w: 700, h: 520 };
const CW = 620; // 紙條的寬（v2：留言區 ≤ 860×430）
/** 紙條裡：留言第一行的頂端。 */
const MSG_TOP = 34;
/** 基本機位（沒有加鏡頭運動）：init 用它換算字級。 */
const CAM: StageCam = { yaw: -0.04, pitch: 0.1, roll: -0.01, zoom: 1.06, x: 0, y: 6, dof: 0.9, room: [0, 0, 0], paper: true };
/** 紙右緣的計時筆（每小節打一個刻痕）。 */
const TICK_X = 1296;
/** 紙上標註層的範圍。 */
const PAP = { x: PX0, y: 40, w: PX1 - PX0, h: COVER_Y - 40 };
/** 震波取樣率（預先算好）。 */
const HZ = 120;
const TEXT = `${T8_TEXT}心動震度地震儀（）＊，。·　♪`;

const BG = () => new FSPass(/* glsl */ `
  uniform float scroll; uniform float u0; uniform float beatPx; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    // 桌面：比紙暗一點的紙色，有纖維
    vec3 desk = mix(C_PAPER, C_SEPIA, 0.12) * (0.97 + 0.03 * fbm(p / 260.0, 3));
    vec3 col = desk;
    // 紙的影子（紙比桌面高一點點）
    float ed = min(p.x - ${PX0}.0, ${PX1}.0 - p.x);
    col *= 1.0 - 0.12 * exp(-max(0.0, -ed) / 6.0) * step(ed, 0.0);
    if (ed > 0.0) {
      float u = p.y - ${PEN_Y}.0 + scroll; // 紙上的座標（往下是之後的時間）
      vec3 pap = mix(C_PAPER, vec3(1.0), 0.08) * (0.985 + 0.015 * fbm(vec2(p.x, u) / vec2(60.0, 9.0), 2));
      // 印好的格線（主題色的暗部）：每一拍一條橫線、每小節粗一點，震波那一欄有直的振幅格
      float kb = (u - u0) / beatPx;
      float dB = abs(fract(kb + 0.5) - 0.5) * beatPx;
      float isBar = step(abs(mod(floor(kb + 0.5), 4.0)), 0.5);
      float g = pxLine(dB, 0.3, 1.1) * (0.2 + 0.28 * isBar);
      float dxc = abs(p.x - ${CX}.0);
      float dv = abs(fract(dxc / 40.0 + 0.5) - 0.5) * 40.0;
      g += pxLine(dv, 0.3, 1.0) * 0.12 * step(dxc, ${AMAX + 12}.0);
      g += pxLine(dxc, 0.4, 1.3) * 0.22;
      // 擋塊的位置（兩條虛線）
      float dash = step(0.5, fract(u / 14.0));
      g += pxLine(abs(dxc - ${AMAX}.0), 0.3, 1.1) * 0.3 * dash;
      vec3 gc = mix(C_BLOOD, C_SIGNAL, 0.25);
      pap = mix(pap, gc, g * 0.34);
      // 兩邊的打孔（露出桌面）
      float hx = min(abs(p.x - ${PX0 + 20}.0), abs(p.x - ${PX1 - 20}.0));
      float hd = length(vec2(hx, (fract(u / 38.0) - 0.5) * 38.0)) - 5.5;
      pap = mix(pap, desk * 0.8, 1.0 - smoothstep(-0.8, 0.8, hd));
      // 頂端：紙往後彎過滾筒，暗下去
      pap *= 0.62 + 0.38 * smoothstep(0.0, 110.0, p.y);
      col = pap;
    }
    // 蓋板：刻線陰影（版畫的橫線），上緣一道斜面
    if (p.y > ${COVER_Y}.0 && p.x > 60.0 && p.x < 1390.0) {
      vec3 plate = mix(C_PAPER, C_SEPIA, 0.07);
      float dark = 0.1 + 0.25 * smoothstep(${COVER_Y}.0, 1080.0, p.y);
      float hl = hatch((p.y + p.x * 0.02) / 5.0, dark);
      plate = mix(plate, C_SEPIA, hl * 0.45);
      col = plate;
    }
    float top = abs(p.y - ${COVER_Y}.0);
    col = mix(col, C_SEPIA, pxLine(top, 0.6, 1.6) * 0.8 * step(60.0, p.x) * step(p.x, 1390.0));
    col = mix(col, vec3(1.0), pxLine(abs(p.y - ${COVER_Y + 4}.0), 0.3, 1.0) * 0.5 * step(60.0, p.x) * step(p.x, 1390.0));
    col = mix(desk, col, k);
    fragColor = vec4(col, 1.0);
  }`, { scroll: { value: 0 }, u0: { value: 0 }, beatPx: { value: 30 }, k: { value: 1 } });

/** 一則標註（u 沒用到，留著給純音樂的歌名標註對齊用）。 */
interface Note { line: Line | null; text: string; u: number; lay: LyricLayout | null; st: LyricStyle | null; t0: number; t1: number }
/** 標註之間的空隙、換行跳一下要多久。 */
const GAP = 24, FEED = 0.28;

export default class Seismograph extends Scene {
  bg = shared('seismograph.bg', BG);
  stage = new Stage();
  /** 紙上的標註（整張紙在動，每格重畫）。 */
  pap = this.track(new Layer2D(PAP.w, PAP.h, undefined, { fast: true }));
  /** 地震報告卡。 */
  card = this.track(new Layer2D(CARD.w, CARD.h, undefined, { fast: true }));
  /** 蓋板上的字（畫一次）。 */
  plate = this.track(new Layer2D(1340, H - COVER_Y, undefined, { fast: true }));
  /** 震波、筆臂（一般混色：墨）。 */
  ink = this.track(new LineBatch(3200, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 預先算好的震波（HZ 取樣）。 */
  amp = new Float32Array(1);
  tau0 = 0;
  v = 40;
  tQ = 0;
  /** 內容上的字級（已經換算過舞台縮放）：署名、歌詞。 */
  sigPx = 30; lyrPx = 50;
  beat = 0.5;
  notes: Note[] = [];
  fit: FitResult | null = null;
  charT: number[] = [];
  typedEnd = 0;
  cardH = 400;
  bars: number[] = [];
  private cardKey = '';
  private plateUp = false;
  private avoid: [number, number, number, number][] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const m = this.msg;
    await loadText(TEXT + (song.title ?? '') + (song.artist ?? '') + (m ? m.text + m.name : ''));
    const beat = this.beat = au.beatPeriod(s + 0.1);
    this.bars = winBars(au, s, e);
    // 主震：窗格四成左右的那個小節線（前面至少一拍、後面至少一拍半）
    const cands = this.bars.filter((b) => b >= s + 0.8 * beat && e - b >= 1.5 * beat);
    const target = s + 0.42 * (e - s);
    this.tQ = cands.length ? cands.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)) : beatAfter(au, s + 0.3);

    // 紙條：先排留言，才知道紙條多高、下面剩多少空間給歌詞。沒有留言就沒有紙條（歌詞往上用整個右半邊）
    const cc = this.card.ctx;
    const text = m ? m.text : INVITE;
    // v2 字級：標準是螢幕 px，除以舞台在紙條那裡的縮放倍數；字級依「紙條最大高度扣掉署名」算
    const zM = this.stage.scaleAt(CAM, CARD.x + CARD.w / 2, CARD.y + 200);
    const zL = this.stage.scaleAt(CAM, LX + LW / 2, 700);
    const o = { min: V2.msgMin / zM, max: msgMaxFor(text) / zM, lineHeight: 1.24, maxLines: 5 };
    const bh = V2.boxH / zM - MSG_TOP - 100;
    this.fit = fitClauses(cc, text, F.hand(400), CW - 64, bh, o) ?? fitText(cc, text, F.hand(400), CW - 64, bh, o);
    const f0 = this.fit;
    this.sigPx = sigV2(f0.size * zM) / zM;
    this.lyrPx = lyricV2(m ? f0.size * zM : null) / zL;
    // 紙條高 = 最後一行的基線＋署名＋下緣一點點（容器只比字大一點）
    this.cardH = m ? Math.ceil(MSG_TOP + f0.size * 0.92 + (f0.lines.length - 1) * f0.lineHeight + f0.size * 0.5 + this.sigPx + 34) : -60;
    const n = this.fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const t0 = beatAfter(au, s + 0.12);
    const dur = clamp(0.055 * n + 0.3, 0.6, 3.2), step = beat / 2;
    const per = Math.ceil(n / Math.max(1, Math.round(dur / step)));
    this.charT = Array.from({ length: n }, (_, i) => t0 + Math.floor(i / per) * step);
    this.typedEnd = this.charT[n - 1] ?? t0;

    // 標註：這個窗格看得到的歌詞（純音樂：每四小節印一次歌名）
    const c = this.pap.ctx;
    const zoneTop = CARD.y + this.cardH + 34, zoneBot = PEN_Y - 14;
    // 有留言時歌詞小一級（留言是焦點）；沒有留言時歌詞是焦點
    const st: LyricStyle = { family: F.archivo(100, 800), size: this.lyrPx, minSize: V2.lyrMin / zL, maxWidth: LW, lineHeight: 1.1, active: rgba('blood'), sung: rgba('sepia', m ? 0.85 : 0.95), unsung: rgba('sepia', 0.26) };
    const span = (zoneBot + 60) / 64 + 2; // 紙上看得到多久以前
    if (lyrics.has) {
      for (const l of lyrics.linesIn(s - span, e + 1)) {
        const lay = layoutLyric(c, l, st);
        this.notes.push({ line: l, text: l.text, u: 0, lay, st, t0: l.start, t1: l.end });
      }
    } else {
      const title = `♪  ${song.title || '今晚的歌'}`;
      for (let b = Math.floor(au.barAt(s - span) / 4) * 4; au.timeOfBar(b) < e; b += 4) {
        const tb = au.timeOfBar(b);
        this.notes.push({ line: null, text: title, u: 0, lay: null, st: null, t0: tb, t1: tb + 4 * beat });
      }
    }
    // 紙速固定（震波要看得出形狀）。標註不是一出現就跟著紙走：唱的時候停在筆旁邊的「標註位」，
    // 下一句出現時像換行一樣往上一跳讓出位置（outExpo），唱完再停一下才貼到紙上、跟著紙往上捲。
    this.v = 64;
    // 震波：從紙上最早看得到的時間算到窗格結束
    this.tau0 = s - (PEN_Y + 80) / this.v - 1;
    this.amp = this.buildTrace(this.tau0, e + 0.5);
    this.drawPlate();
    this.avoid = [
      [CARD.x, CARD.y, CARD.w, this.cardH + 30],
      [LX - 20, zoneTop - 10, LW + 40, zoneBot - zoneTop + 30],
      [PX0, 60, CX + AMAX + 40 - PX0, COVER_Y - 60],
    ];
  }

  // ---------------------------------------------------------------- 震波
  /** 預先算好整段震波：微震＋每個大鼓／小鼓的衰減震盪＋主震（P 波、S 波、兩次餘震）；最後撞到擋塊的地方削平。 */
  private buildTrace(t0: number, t1: number) {
    const au = this.ctx.audio;
    const n = Math.ceil((t1 - t0) * HZ) + 2;
    const a = new Float32Array(n);
    const seed = this.ctx.params.seed ?? 1;
    for (let i = 0; i < n; i++) {
      const tau = t0 + i / HZ;
      a[i] = 3.5 * noise1(tau * 5, seed) + 1.8 * noise1(tau * 15, seed + 1);
    }
    const add = (tk: number, len: number, f: (dt: number) => number) => {
      const i0 = Math.max(0, Math.ceil((tk - t0) * HZ)), i1 = Math.min(n - 1, Math.floor((tk + len - t0) * HZ));
      for (let i = i0; i <= i1; i++) a[i] += f(t0 + i / HZ - tk);
    };
    for (const [tk, str] of au.events('kick', t0, t1)) {
      const A = 12 + 34 * str, sgn = hash(tk, 3) < 0.5 ? -1 : 1;
      add(tk, 0.9, (d) => sgn * A * Math.exp(-d / 0.14) * Math.sin(2 * Math.PI * 3.6 * d) * clamp(d / 0.02));
    }
    for (const [tk, str] of au.events('snare', t0, t1)) {
      const A = 6 + 14 * str;
      add(tk, 0.6, (d) => A * Math.exp(-d / 0.09) * Math.sin(2 * Math.PI * 6.5 * d) * clamp(d / 0.015));
    }
    // 主震：0.35 秒前的 P 波（細碎、越來越大），接著 S 波整個甩到底
    const q = this.tQ;
    add(q - 0.35, 0.9, (d) => 26 * Math.sin(2 * Math.PI * 10 * d) * (d < 0.35 ? d / 0.35 : Math.exp(-(d - 0.35) / 0.15)));
    add(q, 5, (d) => 520 * Math.exp(-d / 1.1) * Math.sin(2 * Math.PI * 1.3 * d) * clamp(d / 0.04));
    // 餘震：之後兩個小節線
    const after = this.bars.filter((b) => b > q + 0.1).slice(0, 2);
    after.forEach((b, k) => add(b, 2, (d) => (120 - k * 40) * Math.exp(-d / 0.4) * Math.sin(2 * Math.PI * 3 * d) * clamp(d / 0.03)));
    // 擋塊：筆臂最多擺到 ±AMAX（軟削平）
    for (let i = 0; i < n; i++) a[i] = AMAX * Math.tanh(a[i]! / AMAX);
    return a;
  }
  private ampAt(tau: number) {
    const x = (tau - this.tau0) * HZ;
    const i = Math.floor(x);
    if (i < 0) return 0;
    if (i >= this.amp.length - 1) return this.amp[this.amp.length - 1]!;
    return lerp(this.amp[i]!, this.amp[i + 1]!, x - i);
  }
  /** 筆尖在 tau 時的位置（紙還沒動的座標）：擺得越遠越往下沉（支點在下方很遠）。 */
  private tip(tau: number) {
    const dx = this.ampAt(tau);
    return { x: CX + dx, dy: ARM - Math.sqrt(ARM * ARM - dx * dx) };
  }
  /** 紙上 tau 時畫下的點，在 t 時的畫面座標。 */
  private traceXY(tau: number, t: number) {
    const tp = this.tip(tau);
    return { x: tp.x, y: PEN_Y + tp.dy - this.v * (t - tau) };
  }

  private drawTrace(t: number) {
    const ink = this.ink, se = LIN.sepia, bl = LIN.blood;
    const dTau = 1.4 / this.v; // 每段約 1.4 px
    const tMin = t - (PEN_Y + 40) / this.v;
    let prev = this.traceXY(t, t);
    for (let tau = t - dTau; tau > tMin; tau -= dTau) {
      const p = this.traceXY(tau, t);
      // 剛畫的墨是濕的（訊號色的暗部），一秒內乾成墨色
      const wet = Math.exp(-(t - tau) / 0.5);
      ink.seg2(prev.x, prev.y, p.x, p.y, 1.6 + 0.8 * wet, [lerp(se[0], bl[0], wet), lerp(se[1], bl[1], wet), lerp(se[2], bl[2], wet)], 0.92);
      prev = p;
    }
  }

  /** 計時筆：紙右緣一條細線，每個小節線往左打一下（留下一個小刻痕，跟著紙往上捲）。 */
  private drawTicks(t: number) {
    const ink = this.ink, se = LIN.sepia;
    const au = this.ctx.audio;
    const tMin = t - (PEN_Y + 40) / this.v;
    ink.seg2(TICK_X, 60, TICK_X, PEN_Y, 1.2, se, 0.35);
    for (let b = Math.ceil(au.barAt(tMin)); ; b++) {
      const tb = au.timeOfBar(b);
      if (tb > t) break;
      const y = PEN_Y - this.v * (t - tb);
      // 剛打下去的刻痕是濕的、比較長，一下子縮成固定長度
      const wet = Math.exp(-(t - tb) / 0.4);
      const len = 26 + 30 * Math.exp(-(t - tb) / 0.12);
      ink.seg2(TICK_X, y, TICK_X - len, y, 2 + wet, [lerp(se[0], LIN.blood[0], wet), lerp(se[1], LIN.blood[1], wet), lerp(se[2], LIN.blood[2], wet)], 0.85);
    }
    // 筆尖（一個小點）：打刻痕的那一下往左跳
    const lb = au.timeOfBar(Math.floor(au.barAt(t)));
    const k = Math.exp(-Math.max(0, t - lb) / 0.1);
    ink.seg2(TICK_X - 50 * k, PEN_Y, TICK_X - 50 * k + 0.01, PEN_Y, 7, LIN.blood, 1);
  }

  /** 筆臂：從畫面外的支點伸上來，一根細長的桿子＋筆尖的小墨水匣。 */
  private drawArm(t: number) {
    const ink = this.ink, se = LIN.sepia;
    const tp = this.tip(t);
    const px = CX, py = PEN_Y + ARM;
    const tx = tp.x, ty = PEN_Y + tp.dy;
    const dx = tx - px, dy = ty - py, len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    // 桿子：一根深色的細桿，側邊一條受光的細線
    ink.seg2(px, py, tx - dx / len * 22, ty - dy / len * 22, 5, se, 0.92);
    ink.seg2(px + nx * 1.2, py + ny * 1.2, tx - dx / len * 22 + nx * 1.2, ty - dy / len * 22 + ny * 1.2, 1.2, LIN.paper, 0.55);
    // 墨水匣（一小段粗線）與筆尖
    ink.seg2(tx - dx / len * 34, ty - dy / len * 34, tx - dx / len * 12, ty - dy / len * 12, 9, se, 0.95);
    ink.seg2(tx - dx / len * 12, ty - dy / len * 12, tx, ty, 2.2, se, 1);
    ink.seg2(tx, ty, tx + 0.01, ty, 6, LIN.blood, 1);
    void t;
  }

  // ---------------------------------------------------------------- 紙上的標註
  private drawNotes(t: number, out: THREE.WebGLRenderTarget) {
    const P = this.pap, c = P.ctx;
    P.clear();
    c.save();
    c.translate(-PAP.x, -PAP.y);
    const s = this.ctx.start;
    const cardBot = CARD.y + this.cardH + 10;
    // 排版在這裡再拿一次（有快取）：韓文原文副行的開關是引擎在畫這一格之前設的，init 等字型時可能被別的窗格改掉
    const layOf = (nt: Note) => (nt.line && nt.st ? layoutLyric(c, nt.line, nt.st) : null);
    this.notes.forEach((nt, i) => {
      // 後面每出現一句就往上跳一格；唱完停 0.6 秒後跟著紙走
      let yb = PEN_Y - 16 - this.v * Math.max(0, t - (nt.t1 + 0.6));
      for (let j = i + 1; j < this.notes.length; j++) {
        const nj = this.notes[j]!, aj = nj.t0 - 0.35;
        if (t <= aj) break;
        const lj = layOf(nj);
        yb -= ((lj ? lj.height : 52) + GAP) * ease.outExpo(clamp((t - aj) / FEED));
      }
      // yb 是這一句最下面那排的基線（有原文時是原文最後一排）
      const lay = layOf(nt);
      const yTop = yb - (lay ? lay.height : 52);
      if (yb < 40) return;
      // 一句從它開始唱的前一點點淡入；還沒唱到的句子不出現。捲到報告卡底下之前淡掉（卡片是歪的，邊緣會露出來）
      const a = clamp((t - (nt.t0 - 0.35)) / 0.35) * clamp((yTop - cardBot) / 50);
      if (a <= 0.003) return;
      c.globalAlpha = a;
      // 引線：從標註左緣拉到開始唱的那一刻的波形上
      const tq = this.traceXY(nt.t0, t);
      const firstRowY = yb - (lay ? (lay.sub ? lay.sub.dy + lay.sub.lay.rows[lay.sub.lay.rows.length - 1]!.y : lay.rows[lay.rows.length - 1]!.y) : 0);
      const ly = firstRowY - (lay ? lay.size : 50) * 0.36;
      c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 1;
      c.beginPath(); c.moveTo(LX - 14, ly); c.lineTo(LX - 40, ly); c.lineTo(tq.x + 9, tq.y); c.stroke();
      c.beginPath(); c.arc(tq.x, tq.y, 7, 0, Math.PI * 2); c.stroke();
      if (nt.line && lay && nt.st) this.lyric(c, nt.line, t, nt.st, lay, LX, firstRowY);
      else label(c, nt.text, LX, yb, F.archivo(100, 700), 52, rgba('sepia', 0.9));
      c.globalAlpha = 1;
    });
    void s;
    c.restore();
    P.upload();
    blit(this.ctx, P.texture, PAP.x, PAP.y, PAP.w, PAP.h, out);
  }

  /** 跟唱（亮版面）：正在唱的字是訊號色的暗部，底下一道淡淡的訊號色螢光筆；唱完的是墨色。 */
  private lyric(c: CanvasRenderingContext2D, line: Line, t: number, st: LyricStyle, lay: LyricLayout, x: number, y: number) {
    c.save();
    c.translate(x, y);
    c.font = font(st.family, lay.size);
    c.textBaseline = 'alphabetic';
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      if (p > 0 && p < 1) {
        c.fillStyle = rgba('signal', 0.32);
        c.fillRect(pw.x - 4, pw.y - lay.size * 0.32, (pw.w + 8) * p, lay.size * 0.36);
      }
      if (p < 1) { c.fillStyle = st.unsung!; c.fillText(pw.word.w, pw.x, pw.y); }
      if (p <= 0) continue;
      c.save();
      c.beginPath(); c.rect(pw.x - lay.size * 0.1, pw.y - lay.size * 1.1, (pw.w + lay.size * 0.2) * p, lay.size * 1.5); c.clip();
      c.fillStyle = p < 1 ? st.active! : st.sung!;
      c.fillText(pw.word.w, pw.x, pw.y);
      c.restore();
    }
    c.restore();
    // 韓文原文副行：同一支筆、小一號，寫在中文正下方（不畫螢光筆：唱到、唱完都是墨色淡兩成，不跟中文搶）
    const sub = lyricSubOf(line);
    if (sub && lay.sub) {
      c.save();
      c.translate(x, y + lay.sub.dy);
      drawLyricSub(c, sub, t, st, lay.size);
      c.restore();
    }
  }

  // ---------------------------------------------------------------- 留言紙條
  private drawCard(t: number, out: THREE.WebGLRenderTarget) {
    const m = this.msg;
    if (!m) return;
    const typed = this.charT.filter((x) => x <= t).length;
    const stampK = prog(t, this.tQ, this.tQ + 0.16, ease.outCubic);
    const sigK = typed >= this.charT.length ? clamp((t - this.typedEnd - this.beat * 0.5) / 0.3) : 0;
    const key = `${typed}|${stampK.toFixed(2)}|${sigK.toFixed(2)}`;
    if (key !== this.cardKey || t < this.typedEnd + 0.5) {
      this.cardKey = key;
      const L = this.card, c = L.ctx;
      L.clear();
      c.save();
      // 紙條稍微歪一點、用迴紋針夾在記錄紙上
      c.translate(CARD.w / 2, 30 + this.cardH / 2);
      c.rotate(-0.014);
      c.translate(-CW / 2, -this.cardH / 2);
      c.shadowColor = rgba('sepia', 0.3); c.shadowBlur = 22; c.shadowOffsetY = 8;
      c.fillStyle = mixRgba('paper', 'bone', 0.35);
      c.fillRect(0, 0, CW, this.cardH);
      c.shadowColor = 'transparent';
      c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 2;
      c.beginPath(); c.roundRect(64, -24, 26, 72, 13); c.stroke();
      c.beginPath(); c.roundRect(70, -14, 14, 52, 7); c.stroke();
      // 留言：一段一段寫上去（剛寫的墨是濕的）
      const fit = this.fit!;
      c.font = font(F.hand(400), fit.size);
      c.textBaseline = 'alphabetic';
      let idx = 0;
      const top = MSG_TOP + fit.size * 0.92;
      fit.lines.forEach((ln, li) => {
        let x = 32;
        const y = top + li * fit.lineHeight;
        for (const ch of Array.from(ln)) {
          const ta = this.charT[idx++] ?? 0;
          const cw = c.measureText(ch).width;
          if (t >= ta) {
            const wet = Math.exp(-(t - ta) / 0.3);
            c.fillStyle = ch === '♥' ? rgba('rose') : wet > 0.03 ? mixRgba('sepia', 'blood', wet) : rgba('sepia');
            c.fillText(ch, x, y);
          }
          x += cw;
        }
      });
      const sy = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.5 + this.sigPx;
      if (sigK > 0) label(c, signature(m.name) + (m.couple ? '（新人）' : ''), 32, sy, F.hand(400), this.sigPx, rgba('sepia', 0.7 * sigK));
      // 圓章：主震那一拍蓋下去（從大變小、有點歪、印泥不均）
      if (stampK > 0) {
        c.save();
        // 蓋在紙條右下角（壓過紙邊，不蓋到留言）
        c.translate(CW - 70, this.cardH - 16);
        c.scale(0.78, 0.78);
        c.rotate(-0.21);
        const sc = lerp(1.8, 1, stampK);
        c.scale(sc, sc);
        c.globalAlpha = stampK * 0.8;
        c.strokeStyle = rgba('blood'); c.lineWidth = 3.5;
        c.beginPath(); c.arc(0, 0, 52, 0, Math.PI * 2); c.stroke();
        c.lineWidth = 1.3;
        c.beginPath(); c.arc(0, 0, 45, 0, Math.PI * 2); c.stroke();
        label(c, '心動震度', 0, -14, F.hei(700), 15, rgba('blood'), { tracking: 3, align: 'center' });
        label(c, '7', 0, 34, F.archivo(100, 900), 46, rgba('blood'), { align: 'center' });
        c.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 26; i++) {
          c.fillStyle = `rgba(0,0,0,${0.3 + 0.5 * hash(i, 7)})`;
          c.beginPath(); c.arc((hash(i, 1) - 0.5) * 104, (hash(i, 2) - 0.5) * 104, 1 + 2.5 * hash(i, 3), 0, Math.PI * 2); c.fill();
        }
        c.restore();
      }
      c.restore();
      L.upload();
    }
    blit(this.ctx, this.card.texture, CARD.x, CARD.y - 30, CARD.w, CARD.h, out);
  }

  /** 蓋板上的銘牌（畫一次）。 */
  private drawPlate() {
    const c = this.plate.ctx;
    this.plate.clear();
    // 字都放在筆臂擺動範圍的右邊；整片蓋板只有一小行銘牌（沒有留言時換成邀請）
    if (this.msg) label(c, '心動地震儀　LOVE SEISMOGRAPH', 572, 58, F.hei(500), 20, rgba('sepia', 0.6), { tracking: 5 });
    else label(c, INVITE, 572, 58, F.hei(500), 22, rgba('sepia', 0.7), { tracking: 3 });
    // 兩顆螺絲
    for (const x of [84, 1364]) {
      c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 1.4;
      c.beginPath(); c.arc(x, 36, 9, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(x - 6, 32); c.lineTo(x + 6, 40); c.stroke();
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rt = this.stage.rt;
    this.bg.u.scroll!.value = this.v * t;
    const tb0 = au.timeOfBar(Math.floor(au.barAt(s)));
    this.bg.u.u0!.value = this.v * tb0;
    this.bg.u.beatPx!.value = this.v * this.beat;
    this.bg.u.k!.value = prog(t, s, s + 0.2);
    this.bg.render(renderer, rt);
    this.ink.clear();
    this.drawNotes(t, rt);
    this.drawTrace(t);
    this.drawTicks(t);
    this.ink.render(renderer, rt);
    this.drawCard(t, rt);
    if (!this.plateUp) { this.plate.upload(); this.plateUp = true; }
    blit(this.ctx, this.plate.texture, 0, COVER_Y, 1340, H - COVER_Y, rt);
    this.ink.clear();
    this.drawArm(t);
    this.ink.render(renderer, rt);
    // 鏡頭：桌上的機器，從上往下斜斜地看、慢慢推近；對焦在紙條（沒有紙條就是歌詞）
    const mv = camMove(au, s, e, t, { inYaw: 0.06, inZoom: 0.05, push: 0.04, sway: 0.008 });
    // 焦點轉移：開場對焦在筆與震波，留言開始寫時花一拍半移到紙條（沒有紙條就移到歌詞）
    const t0 = this.charT[0] ?? s + 0.5;
    const fk = ease.inOutCubic(prog(t, t0, t0 + 1.5 * this.beat));
    const tgt: [number, number] = this.msg ? [CARD.x + CW / 2, CARD.y + this.cardH / 2] : [LX + 300, 700];
    const focus: [number, number] = [lerp(CX, tgt[0], fk), lerp(PEN_Y - 200, tgt[1], fk)];
    const desk: [number, number, number] = [lerp(LIN.paper[0], LIN.sepia[0], 0.12) * 0.97, lerp(LIN.paper[1], LIN.sepia[1], 0.12) * 0.97, lerp(LIN.paper[2], LIN.sepia[2], 0.12) * 0.97];
    this.stage.draw(renderer, out, {
      ...CAM, yaw: CAM.yaw + mv.yaw, zoom: CAM.zoom + mv.zoom, focus, room: desk,
    });
    // 主震：畫面震一下
    const q = pulse(t, this.tQ, 0.18);
    const sh = q > 0.01 ? 14 * q : 0;
    return {
      paper: 1, bloom: 0.25, vignette: 0.32, grain: 0.05,
      shake: [sh * Math.sin(t * 91), sh * Math.cos(t * 77)], zoom: 1 + 0.02 * q,
    };
  }
}
