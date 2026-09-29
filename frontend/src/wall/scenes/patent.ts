// 專利說明書（亮）：「一種使兩人永遠在一起的裝置」。一張老式的發明專利說明書平放在繪圖桌上，
// 鏡頭微微俯視（上緣往後倒、遠處有一點景深）、一盞桌燈的光；左邊是請求項（主打留言），右邊是一張線稿圖（FIG. 1），
// 由繪圖機的筆（仙女棒的火花當筆尖）在拍點上一部分一部分畫出來：
//  - 切進來：鏡頭從稍遠、稍斜的地方落定在第一拍；中心線（一點鏈線）先淡淡畫出來。
//  - 第一拍起，一拍畫一個零件（窗格短就半拍一個）：齒輪 10（宣文）、齒輪 12（孟庭，兩個輪轂都是心形的軸孔 14）、
//    止回爪 18 與彈簧 20、連桿 22 與心形活塞 24、底座 26、最後是引線與符號。
//  - 畫完以後，兩個齒輪每一拍咬合轉一齒（outBack，停住），止回爪被齒頂起來再「喀」地落下——這個裝置只能前進、不能倒退；
//    齒輪帶著連桿，心形活塞在滑軌裡一拍一拍地上下（大鼓時再鼓一下）。
//  - 請求項：一行小字「【請求項 42】一種使兩人永遠在一起的裝置，其特徵在於：」，後面是主打留言（畫面上最大的字，
//    一個字一個字排上去，剛印好的字是訊號色的暗部、冷卻成墨色），署名「—— 提案人 名字」。請求項的編號就是留言編號。
//  - 最後一個小節線：一枚燙金的「核准」封緘貼紙（鋸齒邊、兩條緞帶）啪地貼在右上角，畫面輕震。
//  - 鏡頭：每個小節慢慢推近一點、在小節線前停住，同時往留言那邊帶一點。
// 歌詞是圖說：左下「圖 1」後面接正在唱的那句（照跟唱規則，字比留言小一號）。純音樂：圖說寫歌名與「本裝置照常運轉」。
// 沒有留言：請求項寫「尚待補充：掃描右下角 QR code…即可列為共同發明人」；新人的留言：欄位改成「發明人的話」。
// 照「MV 融合原則」：焦點是留言；表頭、符號、標籤都是 ≤ 22 px 的低對比小字，只有三小群（表頭、圖上的標註、請求項的小標）。
// 畫法：整張紙先畫進一張共用的離屏 RT（紙用 _t11 的 Paper、印好的字一張只上傳一次的圖層、線稿 LineBatch、會變的字一張 fast 圖層、
// 筆尖的火花），RT 比畫面大 1.25 倍（鏡頭推近時字還是銳利）；最後一個「鏡頭」shader 用單應矩陣把紙貼到畫面上，
// 加上遠處的景深、桌燈、紙邊的影子。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl, type SongInfo } from '../engine/scene';
import type { Lyrics } from '../engine/lyrics';
import { FSPass, Layer2D, makeRT, W, H, SCALE } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, sparkHead, sparkParticles, drawHeart, heartPoints, fillWithHearts, COUPLE_ZH, DATE_DOTS, type LyricStyle } from './_motifs';
import { Paper, homography } from './_t11';
import { paperLyric, stagger, pad3, grid, windowLines, type Grid, type Rect } from './_t2';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.15, 0.85], bars: [4, 8] };

type P = { x: number; y: number };

// ---------------------------------------------------------------- 紙面座標（鏡頭之前）
// 鏡頭最近推到約 1.06 倍、左右帶 ±24 px、下緣因為透視再放大約 3%：字都排在 x 190..1740、y 150..925 之內，
// 圖說的右端不超過 1280（再右邊落進右下角 QR 區）。
const X0 = 190, X1 = 1740;
const HEAD_Y = 172, RULE_Y = 194;
const CLAIM_Y = 372;
// 留言區（v2 標準）：放在畫面左側、寬 540 高 330（連署名約 540×420，面積約畫面 11%），字級 40～60。
// 排版的高度已經扣掉署名：署名一定在最後一行下面（最低到 y ≈ 790，再下面是圖說）
const MSG = { x: 216, y: 402, w: 540, h: 330 };
/** 紙面 → 畫面的平均縮放（鏡頭 0.96～1.06 加上透視）：v2 的字級是畫面上的 px，畫在紙上要除以它。 */
const ZS = 1.03;
const CAP = { x: X0, x1: 1280, one: 900, two: 862 };
const SEAL = { x: 1646, y: 196, r: 62 };
/** 紙的 RT 比畫面大多少（鏡頭推近時字還是銳利）。 */
const RES = 1.25;

// ---------------------------------------------------------------- 線稿的機構（紙面座標）
// v2：留言縮小之後，線稿（會動的機構）是畫面的主視覺，整組放大、往中間靠
const GA: P = { x: 1150, y: 430 };
const R = 119, N = 16, STEP = TAU / N, R_TIP = R + 12, R_ROOT = R - 13;
const GB: P = { x: GA.x + 2 * R, y: GA.y };
/** 小齒輪 16（加速器）：跟齒輪 B 咬合，齒數少、轉得快，讓畫面一直有東西在轉。 */
const NC = 10, STEP_C = TAU / NC, RC = (R * NC) / N, PHI_C = 0.35;
const GC: P = { x: GB.x + Math.cos(PHI_C) * (R + RC), y: GB.y + Math.sin(PHI_C) * (R + RC) };
/** 止回爪卡在齒輪 A 的哪個角度（左上方）、支點、彈簧的固定點。 */
const PAWL_A = -2.6;
const PIVOT: P = { x: GA.x - 151, y: GA.y + 46 };
const SPRING_Z: P = { x: GA.x - 185, y: GA.y - 90 };
/** 曲柄（齒輪 B 上的銷）半徑、連桿長、滑軌半寬與起點。 */
const CRANK = 64, ROD = 220, RAIL = 50, RAIL_Y = GA.y + 165;
const BASE = { x0: GA.x - 187, x1: GB.x + 194, y0: GA.y + 361, y1: GA.y + 381 };
const HEART_W = 77;

const INVITE = '本項請求尚待補充：掃描右下角 QR code，寫下你的祝福，即可列為共同發明人。';
const FIXED = '中心距剛剛好愛情專利局發明專利說明書發明名稱一種使兩人永遠在一起的裝置請求項其特徵在於本裝置之發明人謹此聲明的話提案人徵求中一位賓客圖純音樂照常運轉核准永久有效宣文孟庭止回爪只進不退';

// ---------------------------------------------------------------- 幾何小工具
const circle = (c: P, r: number, n = 40, a0 = 0): P[] => Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + Math.cos(a0 + (i / n) * TAU) * r, y: c.y + Math.sin(a0 + (i / n) * TAU) * r }));
const polar = (c: P, a: number, r: number): P => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });

/** 梯形齒的正齒輪外形（齒根 → 齒腹 → 齒頂 → 齒腹），th = 轉角；n 齒、節圓半徑 r（齒高兩個齒輪一樣，才咬得起來）。 */
function gear(c: P, th: number, n = N, r = R): P[] {
  const o: P[] = [];
  const st = TAU / n, rt = r + (R_TIP - R), rr = r - (R - R_ROOT);
  const seq: [number, number][] = [[-0.5, rr], [-0.27, rr], [-0.13, rt], [0.13, rt], [0.27, rr]];
  for (let i = 0; i < n; i++) for (const [f, rad] of seq) o.push(polar(c, th + (i + f) * st, rad));
  o.push(o[0]!);
  return o;
}

/** 愛心的外框（寬 size、轉 rot）。 */
function heart(c: P, size: number, rot = 0, n = 44): P[] {
  const cs = Math.cos(rot), sn = Math.sin(rot), k = size / 2;
  return heartPoints(n).map((p) => ({ x: c.x + (p.x * cs - p.y * sn) * k, y: c.y + (p.x * sn + p.y * cs) * k }));
}

/** 一點鏈線（中心線）：長劃、空、點、空。 */
function dashDot(a: P, b: P): P[][] {
  const L = Math.hypot(b.x - a.x, b.y - a.y), dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
  const out: P[][] = [];
  const pat = [24, 7, 3, 7];
  let s = 0, k = 0;
  while (s < L) {
    const len = Math.min(pat[k % 4]!, L - s);
    if (k % 2 === 0) out.push([{ x: a.x + dx * s, y: a.y + dy * s }, { x: a.x + dx * (s + len), y: a.y + dy * (s + len) }]);
    s += len; k++;
  }
  return out;
}

/** 剖面的 45° 斜線，裁在矩形裡。 */
function hatchRect(x0: number, y0: number, x1: number, y1: number, gap: number): P[][] {
  const out: P[][] = [];
  const h = y1 - y0;
  for (let x = x0 - h; x < x1; x += gap) {
    let ax = x, ay = y1, bx = x + h, by = y0;
    if (ax < x0) { ay -= x0 - ax; ax = x0; }
    if (bx > x1) { by += bx - x1; bx = x1; }
    if (bx > ax) out.push([{ x: ax, y: ay }, { x: bx, y: by }]);
  }
  return out;
}

/** 彈簧：a → b 的鋸齒線。 */
function spring(a: P, b: P, zigs = 10, amp = 8): P[] {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  const o: P[] = [a];
  const lead = 0.12;
  o.push({ x: a.x + dx * lead, y: a.y + dy * lead });
  for (let i = 0; i < zigs; i++) {
    const u = lead + ((i + 0.5) / zigs) * (1 - 2 * lead), sgn = i % 2 ? -1 : 1;
    o.push({ x: a.x + dx * u + nx * amp * sgn, y: a.y + dy * u + ny * amp * sgn });
  }
  o.push({ x: a.x + dx * (1 - lead), y: a.y + dy * (1 - lead) }, b);
  return o;
}

/** 引線：從零件拉到符號，稍微彎（專利圖的引線都是手繪的弧線）。 */
function leader(s: P, e: P): P[] {
  const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2, dx = e.x - s.x, dy = e.y - s.y;
  const cx = mx - dy * 0.12, cy = my + dx * 0.12;
  return Array.from({ length: 13 }, (_, i) => {
    const u = i / 12, v = 1 - u;
    return { x: v * v * s.x + 2 * v * u * cx + u * u * e.x, y: v * v * s.y + 2 * v * u * cy + u * u * e.y };
  });
}

type Ink = 'ink' | 'thin' | 'cons';
interface Stroke { pts: P[]; w: number; ink: Ink }
const polyLen = (pts: P[]) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y); return s; };

interface Glyph { ch: string; x: number; y: number; t: number }
/** 引線的符號：e 是字的左下角；label 是跟在符號後面（或前面）的小字名稱。 */
interface Lead { num: string; s: P; e: P; label?: string; left?: boolean; below?: boolean }
/** 鏡頭：推近 z、上緣往後倒 tilt（弧度）、轉 rot、畫面平移 px/py。 */
interface Cam { z: number; tilt: number; rot: number; px: number; py: number }

// ---------------------------------------------------------------- 鏡頭 shader（紙 → 畫面）
const FOCAL = 2200;
const LENS = () => new FSPass(/* glsl */ `
  uniform sampler2D sheet; uniform mat3 toSheet; uniform float k; uniform vec2 lamp; uniform float t;
  const vec2 SZ = vec2(${W}.0, ${H}.0);
  vec3 tap(vec2 p) { return texture(sheet, vec2(p.x / SZ.x, 1.0 - p.y / SZ.y)).rgb; }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);      // 畫面座標，y 向下
    vec3 q = toSheet * vec3(sp, 1.0);
    vec2 p = q.xy / q.z;                                 // 紙面座標
    // 景深：遠處（畫面上緣）糊一點；下緣最外面一條也糊一點（前景）。字都在清楚的範圍裡
    float r = 5.5 * smoothstep(210.0, 20.0, sp.y) + 3.0 * smoothstep(1000.0, 1080.0, sp.y);
    vec3 col;
    if (r > 0.35) {
      col = tap(p) * 0.2;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 2.39996 + 0.4, rr = r * sqrt((float(i) + 0.5) / 8.0);
        col += tap(p + vec2(cos(a), sin(a)) * rr) * 0.1;
      }
    } else col = tap(p);
    // 紙外面是繪圖桌（深色的木頭），紙邊投一點影子；紙本身比畫面大一圈，只有鏡頭拉遠時才看得到
    vec2 c = p - SZ * 0.5;
    float d = sdBox(c, SZ * 0.5 + vec2(80.0, 70.0));
    float w = max(fwidth(d), 1e-3);
    vec3 desk = mix(C_SEPIA, C_INK, 0.25) * (0.8 + 0.25 * fbm(vec2(p.x / 700.0, p.y / 45.0), 3));
    desk *= 1.0 - 0.45 * smoothstep(50.0, 0.0, d);
    col = mix(col, desk, smoothstep(-w, w, d));
    // 桌燈：左上方一團暖光，越遠越暗，很慢地呼吸
    vec2 dl = (sp - lamp) / vec2(1300.0, 1000.0);
    col *= 0.9 + (0.12 + 0.015 * sin(t * 0.9)) * exp(-dot(dl, dl) * 1.6);
    fragColor = vec4(col * k, 1.0);
  }`, { sheet: { value: null }, toSheet: { value: new THREE.Matrix3() }, k: { value: 1 }, lamp: { value: new THREE.Vector2(520, 180) }, t: { value: 0 } });

export default class Patent extends Scene {
  paper = shared('t11.paper', () => new Paper());
  lens = shared('patent.lens', LENS);
  /** 整張紙先畫在這裡（比畫面大 1.25 倍），再由鏡頭 shader 貼到畫面上。整晚共用一張。 */
  sheet = shared('patent.sheet', () => makeRT(W, H, { depthBuffer: false, pxScale: SCALE * RES }));
  /** 印好的字（表頭、小標）：畫一次、上傳一次。 */
  stat = this.track(new Layer2D(W, H, SCALE * RES, { fast: true }));
  /** 會變的字：留言、署名、符號、圖說、封緘。 */
  dyn = this.track(new Layer2D(W, H, SCALE * RES, { fast: true }));
  lines = this.track(new LineBatch(4096, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  fit!: FitResult;
  msgFam = F.ming(700);
  glyphs: Glyph[] = [];
  lyricSize = 50;
  sigSize = 30;
  sig = { text: '', x: MSG.x, y: 0, t0: 0, t1: 0 };
  /** 六個零件開始畫的時間與長度。 */
  partT: number[] = [];
  partD: number[] = [];
  /** 線稿畫完、齒輪開始轉的時間；第一個「喀」的拍點編號；封緘的時間（-1 = 窗格太短不貼）。 */
  tRun = 0;
  tickBeat0 = 0;
  tick = 0.15;
  tSeal = -1;
  pawlSign = 1;
  avoid: Rect[] = [];
  private toSheet = new THREE.Matrix3();

  override async init() {
    const { audio: au, lyrics, song, start: s, end: e } = this.ctx;
    const m = this.msg;
    const g = this.g = grid(au, s, e);
    const lines = windowLines(lyrics, s, e);
    await loadText(FIXED + INVITE + COUPLE_ZH + song.title + song.artist + (m ? m.text + m.name : '') + lines.map((l) => l.text).join(''));

    // ---- 線稿的時間：六個零件，一拍一個（窗格短就半拍一個），總長不超過窗格的四成五
    const figDur = clamp((e - g.b0) * 0.45, g.beat * 1.5, g.beat * 6.5);
    this.partT = stagger(au, g.b0, 6, figDur);
    this.partD = this.partT.map((t0, i) => Math.min(g.beat * 0.9, (this.partT[i + 1] ?? t0 + g.beat) - t0) * (i === 5 ? 1.4 : 1));
    this.tRun = this.partT[5]! + this.partD[5]!;

    this.tickBeat0 = Math.ceil(au.beatAt(this.tRun) - 1e-6);
    this.tick = Math.min(0.2, g.beat * 0.42);

    // ---- 請求項（留言）：畫面上最大的字，從第一拍（窗格長就第二拍）起一個字一個字排上去
    const c = this.dyn.ctx;
    const text = m ? m.text : INVITE;
    const onlyHearts = !!m && /^[♥\s]+$/.test(m.text);
    // v2：字級上限依字數（msgMaxFor），照子句斷行；都是畫面上的 px，畫在紙上要除以鏡頭的平均縮放
    const opt = { min: V2.msgMin / ZS, max: (m ? msgMaxFor(text) : 44) / ZS, lineHeight: 1.34, maxLines: 6 };
    this.fit = fitClauses(c, text, this.msgFam, MSG.w, MSG.h, opt) ?? fitText(c, text, this.msgFam, MSG.w, MSG.h, opt);
    const fit = this.fit;
    void onlyHearts;
    // 歌詞比留言小一級（lyricV2）；沒有留言時歌詞是焦點，用上限 52
    this.lyricSize = (m ? lyricV2(fit.size * ZS) : V2.lyrMax) / ZS;
    this.sigSize = sigV2(fit.size * ZS) / ZS;
    const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const t0 = g.b0 + g.beat * (e - g.b0 > g.beat * 6 ? 1 : 0.5);
    const times = stagger(au, t0, n, clamp(0.055 * n + 0.9, 1.1, 3.2));
    let k = 0;
    // 字少時往下放一點，跟線稿的重心對齊（不要全擠在上緣）
    const top = MSG.y + Math.max(0, (MSG.h - fit.height) * 0.5) + fit.size * 0.9;
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, this.msgFam, fit.size);
      for (const gl of lay.glyphs) this.glyphs.push({ ch: gl.ch, x: MSG.x + gl.x, y: top + i * fit.lineHeight, t: times[k++]! });
    });
    const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
    const msgEnd = times[times.length - 1] ?? t0;
    this.sig.text = m ? (m.couple ? `—— 發明人　${m.name || COUPLE_ZH}` : `—— 提案人　${m.name || '一位賓客'}`) : '—— 提案人　徵求中';
    // 署名在最後一行的字底（約 0.22 字級）再往下一行：大字時跟著拉開，永遠不會跟最後一行重疊
    this.sig.y = lastY + fit.size * 0.26 + this.sigSize * 1.3;
    this.sig.t0 = au.timeOfBeat(Math.ceil(au.beatAt(msgEnd + 0.12) * 2 - 1e-6) / 2);
    this.sig.t1 = this.sig.t0 + clamp(0.06 * Array.from(this.sig.text).length + 0.25, 0.5, 1.1);

    // ---- 封緘：最後一個小節線（線稿與署名都完成之後、離結尾至少一拍）；沒有就用拍點；再沒有就不貼
    const ready = Math.max(this.tRun, this.sig.t1) + g.beat * 0.4;
    const bar = [...g.bars].reverse().find((b) => b >= ready && b <= e - g.beat * 0.9);
    if (bar !== undefined) this.tSeal = bar;
    else {
      const b = au.timeOfBeat(Math.ceil(au.beatAt(ready) - 1e-6));
      this.tSeal = b <= e - g.beat * 0.6 ? b : -1;
    }

    // 第 7 部分「尺寸線」：線稿畫完兩拍以後的第一個小節線，而且要比封緘早一小節以上（不要跟封緘擠在同一拍）；
    // 窗格太短就不畫（prog 遇到 Infinity 回 0）
    const dimAt = g.bars.find((b) => b >= this.tRun + g.beat * 2 && b <= e - g.bar * 0.75 && (this.tSeal < 0 || b <= this.tSeal - g.bar * 0.9));
    this.partT.push(dimAt ?? Infinity); this.partD.push(g.beat * 0.9);

    // 止回爪往哪個方向轉是「抬起來」（離齒輪中心遠一點）：試一下兩個方向
    const tip0 = polar(GA, PAWL_A, R_ROOT + 3);
    const rot = (p: P, a: number) => ({ x: PIVOT.x + (p.x - PIVOT.x) * Math.cos(a) - (p.y - PIVOT.y) * Math.sin(a), y: PIVOT.y + (p.x - PIVOT.x) * Math.sin(a) + (p.y - PIVOT.y) * Math.cos(a) });
    const d = (p: P) => Math.hypot(p.x - GA.x, p.y - GA.y);
    this.pawlSign = d(rot(tip0, 0.1)) > d(rot(tip0, -0.1)) ? 1 : -1;

    this.drawStatic();
    this.stat.upload();
    // 小卡已停用，但 popupAvoid 照樣回傳（萬一之後又打開）：留言、圖說
    this.avoid = [[X0 - 10, CLAIM_Y - 30, MSG.w + 60, this.sig.y + 20 - CLAIM_Y + 30], [X0 - 10, 800, CAP.x1 - X0 + 20, 150]];
  }

  // ---------------------------------------------------------------- 印好的字（三小群：表頭、請求項的小標、封緘位置留白）
  private drawStatic() {
    const c = this.stat.ctx, m = this.msg;
    this.stat.clear();
    c.textBaseline = 'alphabetic';
    const ink = (a: number) => rgba('sepia', a);
    // 表頭：一行小字（低對比）＋兩條線
    c.font = font(F.hei(500), 16); c.letterSpacing = '4px'; c.fillStyle = ink(0.5);
    c.fillText('愛情專利局 · 發明專利說明書', X0, HEAD_Y);
    c.letterSpacing = '0px';
    c.font = font(F.ming(700), 22); c.fillStyle = ink(0.72);
    c.fillText('發明名稱　一種使兩人永遠在一起的裝置', 560, HEAD_Y + 1);
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = ink(0.48);
    c.fillText(`AO-0313-${m ? pad3(m.n) : '000'}  ·  ${DATE_DOTS}`, 1102, HEAD_Y);
    c.letterSpacing = '0px';
    c.fillStyle = ink(0.55); c.fillRect(X0, RULE_Y, X1 - X0, 1.5);
    c.fillStyle = ink(0.3); c.fillRect(X0, RULE_Y + 5, X1 - X0, 0.8);

    // 請求項的小標（一行）
    const head = m ? (m.couple ? '【發明人的話】' : `【請求項 ${m.n}】`) : '【請求項 ？】';
    c.font = font(F.hei(700), 21); c.letterSpacing = '2px'; c.fillStyle = ink(0.66);
    c.fillText(head, X0 - 8, CLAIM_Y);
    const hw = c.measureText(head).width;
    c.letterSpacing = '0px';
    c.font = font(F.ming(400), 21); c.fillStyle = ink(0.56);
    c.fillText(m?.couple ? '本裝置之發明人謹此聲明：' : '一種使兩人永遠在一起的裝置，其特徵在於：', X0 + hw + 4, CLAIM_Y);
  }

  // ---------------------------------------------------------------- 鏡頭
  /** 鏡頭：第一拍前從稍遠稍斜的地方落定；之後每個小節推近一點、在小節線前停住，同時往留言那邊帶。 */
  private cam(t: number): Cam {
    const { start: s, end: e } = this.ctx, g = this.g;
    const land = prog(t, s, Math.max(s + 0.3, g.b0), ease.outExpo);
    let push = 0;
    const nb = Math.max(1, g.bars.length);
    for (const b of g.bars) push += prog(t, b, b + g.bar * 0.62, ease.inOutCubic);
    const u = push / nb;
    const hit = this.tSeal > 0 ? pulse(t, this.tSeal + 0.1, 0.09) : 0;
    const out = prog(t, e - 0.3, e, ease.inCubic);
    // 焦點轉移（v2）：開場先看右邊的線稿，留言開始排的前半拍起，鏡頭往左帶到留言
    const g0 = this.glyphs[0]?.t ?? s;
    const focus = prog(t, g0 - g.beat * 0.5, g0 + g.beat * 1.5, ease.inOutCubic);
    return {
      z: lerp(0.955, 1.0, land) + 0.045 * u + 0.012 * hit + 0.01 * out,
      tilt: lerp(0.22, 0.12, land) - 0.02 * u,
      rot: lerp(-0.024, -0.008, land) + 0.01 * u,
      px: lerp(-46, 20, focus) - 6 * u,
      py: lerp(-24, 0, land) + 8 * u,
    };
  }

  /** 紙面 → 畫面（透視：上緣往後倒）。 */
  private project(cm: Cam, x: number, y: number): P {
    const u = x - W / 2, v = y - H / 2;
    const yv = v * Math.cos(cm.tilt), z = -v * Math.sin(cm.tilt);
    const k = (FOCAL / (FOCAL + z)) * cm.z;
    const px = u * k, py = yv * k, cr = Math.cos(cm.rot), sr = Math.sin(cm.rot);
    return { x: W / 2 + cm.px + px * cr - py * sr, y: H / 2 + cm.py + px * sr + py * cr };
  }

  // ---------------------------------------------------------------- 線稿
  /** 齒輪 A 的轉角：線稿畫完後每一拍轉一齒（outBack 停住）；回傳轉角與這一齒的進度（給止回爪用）。 */
  private turn(t: number): { th: number; u: number } {
    if (t < this.tRun) return { th: 0, u: 1 };
    const au = this.ctx.audio;
    const bi = Math.floor(au.beatAt(t) + 1e-6);
    if (bi < this.tickBeat0) return { th: 0, u: 1 };
    const u = clamp((t - au.timeOfBeat(bi)) / this.tick);
    return { th: STEP * (bi - this.tickBeat0 + ease.outBack(u, 2.2)), u };
  }

  /** 六個零件（依畫的順序）與引線。 */
  private parts(t: number, kick: number): { parts: Stroke[][]; leads: Lead[]; heartC: P; heartS: number } {
    const { th, u } = this.turn(t);
    const thA = th, thB = STEP / 2 - th;
    const ink = (pts: P[], w = 2.4): Stroke => ({ pts, w, ink: 'ink' });
    const thin = (pts: P[], w = 1.1): Stroke => ({ pts, w, ink: 'thin' });

    // 1、2. 齒輪（宣文、孟庭）：齒形、輪轂、心形軸孔、減重孔、齒根圓（細線）；孟庭那顆多一個曲柄銷
    const gearParts = (c: P, a: number, crank: boolean): Stroke[] => {
      const out: Stroke[] = [ink(gear(c, a)), ink(circle(c, 31, 36, a), 1.8), ink(heart({ x: c.x, y: c.y + 1 }, 30, a), 1.9)];
      for (let k = 0; k < 4; k++) {
        if (crank && k === 0) continue;
        out.push(ink(circle(polar(c, a + Math.PI / 4 + (k * Math.PI) / 2, R * 0.56), 14, 24), 1.5));
      }
      out.push(thin(circle(c, R_ROOT - 8, 64, a), 0.9));
      return out;
    };
    const gA = gearParts(GA, thA, false);
    const pin = polar(GB, thB - Math.PI / 4, CRANK);
    // 小齒輪 16 跟齒輪 B 在 PHI_C 方向咬合：B 的齒對到那裡時，小齒輪剛好是齒縫（轉得比 B 快 1.6 倍、方向相反）
    const thC = PHI_C + Math.PI - 0.5 * STEP_C - (N / NC) * (thB - PHI_C);
    const gC: Stroke[] = [ink(gear(GC, thC, NC, RC), 2.2), ink(circle(GC, 20, 28, thC), 1.7), ink(heart({ x: GC.x, y: GC.y + 1 }, 18, thC), 1.5), thin(circle(GC, RC - 21, 40, thC), 0.9)];
    const gB = [...gearParts(GB, thB, true), ink(circle(pin, 9, 20), 2), ink(circle(pin, 3, 10), 1.4), ...gC];

    // 3. 止回爪與彈簧：齒轉過去時爪被頂起來（鋸齒形的抬起），這一齒到位時「喀」地落下
    const lift = t < this.tRun ? 0 : u < 0.75 ? u / 0.75 : (1 - u) / 0.25;
    const pa = this.pawlSign * 0.15 * lift;
    const tip0 = polar(GA, PAWL_A, R_ROOT + 3);
    const rot = (p: P) => ({ x: PIVOT.x + (p.x - PIVOT.x) * Math.cos(pa) - (p.y - PIVOT.y) * Math.sin(pa), y: PIVOT.y + (p.x - PIVOT.x) * Math.sin(pa) + (p.y - PIVOT.y) * Math.cos(pa) });
    const tip = rot(tip0);
    const dx = tip.x - PIVOT.x, dy = tip.y - PIVOT.y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    const pawl = [
      { x: PIVOT.x + nx * 11, y: PIVOT.y + ny * 11 }, { x: tip.x + nx * 2.8, y: tip.y + ny * 2.8 }, tip,
      { x: tip.x - nx * 2.8, y: tip.y - ny * 2.8 }, { x: PIVOT.x - nx * 11, y: PIVOT.y - ny * 11 },
    ];
    const att = { x: PIVOT.x + dx * 0.5 + nx * 7, y: PIVOT.y + dy * 0.5 + ny * 7 };
    const pw: Stroke[] = [
      ink(pawl), ink(circle(PIVOT, 13, 28), 2), ink(circle(PIVOT, 4, 12), 1.4),
      ink(spring(SPRING_Z, att), 1.7), ink(circle(SPRING_Z, 4.5, 12), 1.5),
      ink([{ x: PIVOT.x - 7, y: PIVOT.y + 13 }, { x: PIVOT.x - 7, y: BASE.y0 }], 1.9), ink([{ x: PIVOT.x + 7, y: PIVOT.y + 13 }, { x: PIVOT.x + 7, y: BASE.y0 }], 1.9),
      ink([{ x: SPRING_Z.x - 16, y: SPRING_Z.y - 13 }, { x: SPRING_Z.x + 12, y: SPRING_Z.y - 13 }], 1.9),
      ...hatchRect(SPRING_Z.x - 16, SPRING_Z.y - 22, SPRING_Z.x + 12, SPRING_Z.y - 13, 5).map((p) => thin(p, 0.9)),
    ];

    // 4. 連桿與心形活塞：曲柄銷帶著連桿，活塞在兩條滑軌之間上下
    const hy = pin.y + Math.sqrt(Math.max(1, ROD * ROD - (pin.x - GB.x) ** 2));
    const heartS = HEART_W * (1 + 0.1 * kick);
    const heartC = { x: GB.x, y: hy + heartS * 0.36 };
    const rdx = GB.x - pin.x, rdy = hy - pin.y, rl = Math.hypot(rdx, rdy), rnx = (-rdy / rl) * 5, rny = (rdx / rl) * 5;
    const rails: Stroke[] = [];
    for (const sx of [-1, 1]) {
      const x = GB.x + sx * RAIL;
      rails.push(ink([{ x, y: RAIL_Y }, { x, y: BASE.y0 }], 1.9));
      for (let y = RAIL_Y + 8; y < BASE.y0 - 4; y += 14) rails.push(thin([{ x, y }, { x: x + sx * 10, y: y - 10 }], 0.9));
    }
    const pis: Stroke[] = [
      ink([{ x: pin.x + rnx, y: pin.y + rny }, { x: GB.x + rnx, y: hy + rny }], 1.9),
      ink([{ x: pin.x - rnx, y: pin.y - rny }, { x: GB.x - rnx, y: hy - rny }], 1.9),
      ink(circle({ x: GB.x, y: hy }, 7, 16), 1.6),
      ink(heart(heartC, heartS), 2.3),
      ...rails,
    ];

    // 5. 底座（剖面斜線）與齒輪 A 的軸柱（在齒輪後面，從齒輪下緣開始）
    const bs: Stroke[] = [
      ink([{ x: BASE.x0, y: BASE.y0 }, { x: BASE.x1, y: BASE.y0 }, { x: BASE.x1, y: BASE.y1 }, { x: BASE.x0, y: BASE.y1 }, { x: BASE.x0, y: BASE.y0 }], 2.1),
      ...hatchRect(BASE.x0, BASE.y0, BASE.x1, BASE.y1, 10).map((p) => thin(p, 1)),
      ink([{ x: GA.x - 9, y: GA.y + R_TIP + 5 }, { x: GA.x - 9, y: BASE.y0 }], 1.9), ink([{ x: GA.x + 9, y: GA.y + R_TIP + 5 }, { x: GA.x + 9, y: BASE.y0 }], 1.9),
      thin([{ x: GA.x - 30, y: BASE.y0 - 1 }, { x: GA.x - 9, y: BASE.y0 - 21 }], 1.2), thin([{ x: GA.x + 30, y: BASE.y0 - 1 }, { x: GA.x + 9, y: BASE.y0 - 21 }], 1.2),
    ];

    // 6. 引線（連到會動的零件的，跟著零件走）。只有三個有名字：兩個齒輪是誰、止回爪（這個裝置的笑點）
    const mid = (a: P, b: P, k = 0.5) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
    const leads: Lead[] = [
      { num: '10', s: polar(GA, -1.75, R - 8), e: { x: GA.x - 40, y: GA.y - 172 }, label: '宣文', left: true },
      { num: '12', s: polar(GB, -1.4, R - 8), e: { x: GB.x + 96, y: GA.y - 172 }, label: '孟庭' },
      { num: '14', s: { x: GA.x + 9, y: GA.y + 12 }, e: { x: GA.x + 52, y: GA.y + 232 } },
      { num: '16', s: polar(GC, -0.9, RC - 6), e: { x: GC.x + 80, y: GC.y - 124 } },
      { num: '18', s: mid(PIVOT, tip, 0.35), e: { x: PIVOT.x - 57, y: PIVOT.y + 119 }, label: '止回爪（只進不退）', below: true },
      { num: '20', s: mid(SPRING_Z, att, 0.5), e: { x: SPRING_Z.x - 64, y: SPRING_Z.y + 26 } },
      { num: '22', s: mid(pin, { x: GB.x, y: hy }, 0.55), e: { x: GB.x + 146, y: GA.y + 250 } },
      { num: '24', s: { x: heartC.x + heartS * 0.42, y: heartC.y - heartS * 0.05 }, e: { x: GB.x + 146, y: GA.y + 322 } },
      { num: '26', s: { x: BASE.x0 + 36, y: BASE.y0 + 2 }, e: { x: BASE.x0 - 48, y: BASE.y0 - 15 } },
    ];
    const ld = leads.map((l) => thin(leader(l.s, { x: l.e.x + (l.e.x < l.s.x ? 26 : -5), y: l.e.y - 7 }), 1.1));
    // 7. 尺寸線（v2「窗格中段的小事件」）：線稿畫完之後的某個小節線，筆回來補一條兩齒輪的中心距，標「剛剛好」
    const dmy = GA.y - R_TIP - 36, ey0 = GA.y - R_TIP - 8, ey1 = dmy - 10;
    const dim: Stroke[] = [
      thin([{ x: GA.x, y: ey0 }, { x: GA.x, y: ey1 }], 1), thin([{ x: GB.x, y: ey0 }, { x: GB.x, y: ey1 }], 1),
      thin([{ x: GA.x, y: dmy }, { x: GB.x, y: dmy }], 1.1),
      thin([{ x: GA.x + 13, y: dmy - 4 }, { x: GA.x, y: dmy }, { x: GA.x + 13, y: dmy + 4 }], 1.1),
      thin([{ x: GB.x - 13, y: dmy - 4 }, { x: GB.x, y: dmy }, { x: GB.x - 13, y: dmy + 4 }], 1.1),
    ];
    return { parts: [gA, gB, pw, pis, bs, ld, dim], leads, heartC, heartS };
  }

  /** 畫一個零件的前 u（0..1，依總長）；回傳筆尖（畫到一半時）。 */
  private reveal(strokes: Stroke[], u: number): P | null {
    if (u <= 0) return null;
    const lens = strokes.map((s) => polyLen(s.pts));
    const total = lens.reduce((a, b) => a + b, 0);
    let left = total * clamp(u);
    let pen: P | null = null;
    const col = (k: Ink): [number, number, number, number] => k === 'cons' ? [...LIN.ash, 0.7] : k === 'thin' ? [...LIN.sepia, 0.55] : [...LIN.sepia, 0.9];
    for (let i = 0; i < strokes.length && left > 0; i++) {
      const s = strokes[i]!, L = lens[i]!;
      const [r, g, b, a] = col(s.ink);
      if (left >= L) { this.lines.polyline(s.pts, s.w, [r, g, b], a); left -= L; continue; }
      const part: P[] = [s.pts[0]!];
      let acc = 0;
      for (let j = 1; j < s.pts.length; j++) {
        const p = s.pts[j - 1]!, q = s.pts[j]!, sl = Math.hypot(q.x - p.x, q.y - p.y);
        if (acc + sl >= left) { const k = sl > 0 ? (left - acc) / sl : 0; part.push({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k) }); break; }
        part.push(q); acc += sl;
      }
      this.lines.polyline(part, s.w, [r, g, b], a);
      pen = part[part.length - 1]!;
      left = 0;
    }
    return u < 1 ? pen : null;
  }

  /** 中心線：切進來的第一拍內淡淡畫出來。 */
  private construction(u: number) {
    const segs = [
      ...dashDot({ x: GA.x - 150, y: GA.y }, { x: GB.x + 150, y: GB.y }),
      ...dashDot({ x: GA.x, y: GA.y - 150 }, { x: GA.x, y: GA.y + 150 }),
      ...dashDot({ x: GB.x, y: GB.y - 150 }, { x: GB.x, y: BASE.y0 - 6 }),
    ];
    this.reveal(segs.map((pts) => ({ pts, w: 1, ink: 'cons' as Ink })), u);
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, g = this.g;
    const SH = this.sheet;
    // ---- 紙（畫在離屏 RT 上，紙面座標）
    this.paper.render(renderer, SH);
    comp.draw(renderer, this.stat.texture, SH);

    // ---- 線稿
    this.lines.clear(); this.glow.clear();
    this.construction(prog(t, s, g.b0, ease.inOutCubic));
    const kick = t >= this.tRun ? f.a.kick : 0;
    const { parts, leads, heartC, heartS } = this.parts(t, kick);
    let pen: P | null = null;
    parts.forEach((ps, i) => {
      const u = prog(t, this.partT[i]!, this.partT[i]! + this.partD[i]!, ease.inOutQuad);
      pen = this.reveal(ps, u) ?? pen;
    });
    this.lines.render(renderer, SH);

    // ---- 會變的字
    const D = this.dyn; D.clear();
    const c = D.ctx;
    c.textBaseline = 'alphabetic';
    // 心形活塞：畫好以後填上點綴色（愛心是唯一用點綴色的東西）
    const hEnd = this.partT[3]! + this.partD[3]!;
    const heartOn = prog(t, hEnd, hEnd + 0.25);
    if (heartOn > 0) drawHeart(c, heartC.x, heartC.y, heartS * 0.86, rgba('rose', 0.85 * heartOn));
    this.drawLeads(c, t, leads);
    // 尺寸線畫完：標上「中心距　剛剛好」（冷面）
    const dEnd = this.partT[6]! + this.partD[6]!;
    const da = prog(t, dEnd - 0.1, dEnd + 0.12);
    if (da > 0) {
      c.font = font(F.hei(500), 17); c.letterSpacing = '3px'; c.textAlign = 'center';
      c.fillStyle = rgba('sepia', 0.58 * da);
      c.fillText('中心距　剛剛好', (GA.x + GB.x) / 2, GA.y - R_TIP - 46);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    this.drawClaim(c, t);
    this.drawCaption(c, t, lyrics, song);
    if (this.tSeal > 0) this.drawSeal(c, t);
    comp.draw(renderer, D.upload(), SH);

    // ---- 筆尖（仙女棒）
    const drawing = pen as P | null;
    if (drawing) {
      const pp = drawing;
      sparkParticles(this.glow, t, () => pp, { rate: 70, life: 0.28, speed: 150, intensity: 0.8, seed: (this.ctx.params.seed ?? 1) + 7 });
      sparkHead(this.glow, pp.x, pp.y, t, 0.55, 0.9);
    }
    if (this.glow.count) this.glow.render(renderer, SH);

    // ---- 鏡頭：紙貼到畫面上
    const cm = this.cam(t);
    const corners: P[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
    const m = homography(corners.map((p) => this.project(cm, p.x, p.y)), corners);
    this.toSheet.set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!);
    const L = this.lens.u;
    L.sheet!.value = SH.texture;
    (L.toSheet!.value as THREE.Matrix3).copy(this.toSheet);
    L.k!.value = prog(t, s, s + 0.12);
    L.t!.value = t;
    this.lens.render(renderer, out);

    const hit = this.tSeal > 0 ? pulse(t, this.tSeal + 0.1, 0.09) : 0;
    return {
      paper: 1, bloom: 0.22, bloomThreshold: 0.95, halation: 0.06, vignette: 0.3, grain: 0.045,
      shake: [hit * 3, -hit * 5],
      popupAvoid: this.avoid,
    };
  }

  /** 圖上的符號（引線畫到的時候跳出來）與三個名字：小字、低對比，是配角。 */
  private drawLeads(c: CanvasRenderingContext2D, t: number, leads: Lead[]) {
    const tl = this.partT[5]!, dl = this.partD[5]!;
    leads.forEach((l, i) => {
      const at = tl + (dl * (i + 1)) / leads.length;
      const a = prog(t, at - 0.05, at + 0.08);
      if (a <= 0) return;
      c.font = font(F.serif(600), 22);
      c.fillStyle = rgba('sepia', 0.78 * a);
      const nw = c.measureText(l.num).width;
      c.fillText(l.num, l.e.x, l.e.y);
      if (!l.label) return;
      c.font = font(F.hei(500), 17); c.letterSpacing = '2px';
      c.fillStyle = rgba('sepia', 0.55 * a);
      // 名字放在符號旁邊（left：左邊；below：底下靠右對齊，避開旁邊的線）
      if (l.below) { c.textAlign = 'right'; c.fillText(l.label, l.e.x + nw, l.e.y + 27); c.textAlign = 'left'; }
      else if (l.left) { c.textAlign = 'right'; c.fillText(l.label, l.e.x - 8, l.e.y - 1); c.textAlign = 'left'; }
      else c.fillText(l.label, l.e.x + nw + 8, l.e.y - 1);
      c.letterSpacing = '0px';
    });
  }

  /** 請求項：一個字一個字排上去（剛排上的字是訊號色的暗部，冷卻成墨色），署名從左往右寫出來。 */
  private drawClaim(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit;
    // 引文的直線（訊號色的暗部，很淡）：跟著排到的那一行往下長，不要先空著一條
    const first = this.glyphs[0];
    if (first && t >= first.t) {
      let yb = first.y;
      for (const gl of this.glyphs) { if (t < gl.t) break; yb = gl.y; }
      const y0 = first.y - fit.size * 0.92;
      c.fillStyle = rgba('blood', 0.45);
      c.fillRect(X0 + 2, y0, 3, yb + fit.size * 0.2 - y0);
    }
    c.font = font(this.msgFam, fit.size);
    for (const gl of this.glyphs) {
      if (t < gl.t) break;
      const age = t - gl.t;
      const drop = (1 - prog(age, 0, 0.12, ease.outCubic)) * 10;
      c.fillStyle = gl.ch === '♥' ? rgba('rose') : age < 0.5 ? mixRgba('blood', 'sepia', prog(age, 0.1, 0.5), 0.97) : rgba('sepia', 0.96);
      c.globalAlpha = prog(age, 0, 0.06);
      c.fillText(gl.ch, gl.x, gl.y - drop);
    }
    c.globalAlpha = 1;
    const sg = this.sig;
    if (t >= sg.t0) {
      c.font = font(F.ming(400), this.sigSize);
      const w = c.measureText(sg.text).width;
      const u = prog(t, sg.t0, sg.t1, ease.outCubic);
      c.save();
      c.beginPath(); c.rect(sg.x - 4, sg.y - 40, w * u + 8, 56); c.clip();
      c.fillStyle = rgba('sepia', 0.8);
      fillWithHearts(c, sg.text, sg.x, sg.y);
      c.restore();
    }
  }

  /** 圖說：「圖 1」＋正在唱的歌詞（跟唱）。純音樂寫歌名與冷面的註記；兩句之間淡淡地寫歌名。 */
  private drawCaption(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics, song: SongInfo) {
    const lx = CAP.x;
    c.font = font(F.hei(700), 22); c.letterSpacing = '3px';
    const lw = c.measureText('圖 1').width + 24;
    c.letterSpacing = '0px';
    const label = (y: number, a = 1) => {
      c.font = font(F.hei(700), 22); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.55 * a);
      c.fillText('圖 1', lx, y); c.letterSpacing = '0px';
    };
    if (!lyrics.has) {
      label(CAP.one);
      c.font = font(F.ming(700), 46); c.fillStyle = rgba('sepia', 0.88);
      const title = song.title ? `♪ ${song.title}` : '♪';
      c.fillText(title, lx + lw, CAP.one + 2);
      const tw = c.measureText(title).width;
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.55);
      c.fillText('（純音樂，本裝置照常運轉）', lx + lw + tw + 16, CAP.one);
      return;
    }
    const ly = lyricAt(lyrics, t);
    if (!ly) {
      label(CAP.one, 0.7);
      c.font = font(F.ming(400), 30); c.fillStyle = rgba('sepia', 0.36);
      c.fillText(`♪ ${song.title}`, lx + lw, CAP.one);
      return;
    }
    const st: LyricStyle = { family: F.ming(700), size: this.lyricSize, minSize: V2.lyrMin / ZS, maxWidth: CAP.x1 - (lx + lw), align: 'left', lineHeight: 1.12, ...paperLyric() };
    const lay = layoutLyric(c, ly.line, st);
    const y0 = lay.rows.length > 1 ? CAP.two : CAP.one;
    label(y0, ly.k);
    c.save(); c.translate(lx + lw, y0);
    drawLyric(c, ly.line, t, st, lay, ly.k);
    c.restore();
  }

  /** 燙金的「核准」封緘：啪地貼上（從大一點、歪一點落下），光從左上掃過一次。 */
  private drawSeal(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.tSeal;
    if (t < t0 - 0.02) return;
    const u = prog(t, t0 - 0.02, t0 + 0.12, ease.outExpo);
    const sc = lerp(1.45, 1, u), rot = lerp(-0.42, -0.1, u);
    const { x, y, r } = SEAL;
    c.save();
    c.globalAlpha = clamp(u * 2.5);
    c.translate(x, y); c.rotate(rot); c.scale(sc, sc);
    // 影子
    c.fillStyle = rgba('sepia', 0.18 * u);
    c.beginPath(); c.arc(4 + (1 - u) * 20, 6 + (1 - u) * 26, r + 4, 0, TAU); c.fill();
    // 兩條緞帶（V 字剪口）
    for (const sx of [-1, 1]) {
      c.fillStyle = sx < 0 ? rgba('blood', 0.95) : mixRgba('blood', 'signal', 0.35, 0.95);
      c.beginPath();
      c.moveTo(sx * 16, 18); c.lineTo(sx * 52, r + 40); c.lineTo(sx * 40, r + 31); c.lineTo(sx * 33, r + 51); c.lineTo(sx * 2, 27);
      c.closePath(); c.fill();
    }
    // 鋸齒邊的金箔
    const gr = c.createLinearGradient(-r, -r, r, r);
    const sheen = prog(t, t0 + 0.1, t0 + 0.9, ease.inOutCubic);
    gr.addColorStop(0, mixRgba('signal', 'blood', 0.25));
    gr.addColorStop(clamp(sheen * 0.9 + 0.02, 0.02, 0.97), mixRgba('signal', 'ember', 0.7));
    gr.addColorStop(1, mixRgba('signal', 'blood', 0.45));
    c.fillStyle = gr;
    c.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * TAU, rr = r + (i % 2 ? -4 : 3);
      if (i) c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath(); c.fill();
    // 壓紋的圈
    c.strokeStyle = rgba('blood', 0.8); c.lineWidth = 1.6;
    c.beginPath(); c.arc(0, 0, r - 11, 0, TAU); c.stroke();
    c.lineWidth = 0.9;
    c.beginPath(); c.arc(0, 0, r - 28, 0, TAU); c.stroke();
    // 圈上的字
    const ring = Array.from('LOVE PATENT OFFICE ★ GRANTED ★ ');
    c.font = font(F.mono(600), 10); c.fillStyle = rgba('blood', 0.95); c.textAlign = 'center';
    ring.forEach((ch, i) => {
      c.save(); c.rotate(-Math.PI / 2 + (i / ring.length) * TAU + Math.PI / 2); c.translate(0, -(r - 19));
      c.fillText(ch, 0, 4);
      c.restore();
    });
    c.font = font(F.ming(900), 30); c.fillStyle = rgba('blood', 1);
    c.fillText('核准', 0, 7);
    c.font = font(F.hei(700), 10); c.letterSpacing = '3px';
    c.fillText('永久有效', 2, 23);
    c.letterSpacing = '0px'; c.textAlign = 'left';
    c.restore();
  }
}
