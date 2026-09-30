// 日出（亮）：剪紙風格的清晨海面。這一批（光）唯一的亮版面，跟其他暗的版面錯開整晚的節奏。
//  - 太陽從左下的海平線冒出來（第一個拍點用強烈緩動升起一段，之後整個窗格很慢地再升一點），
//    光芒是一條條楔形的紙片，一拍射出一條，射滿之後每拍有一道光沿著其中一條往外跑；小鼓時光芒亮一下，大鼓時太陽脹一下。
//  - 歌詞騎在「最新射出的那條光芒」上：一行一條淺色的光芒紙條，從日輪後面伸出來，字沿著它往右上排（角度控制在 8～12°，
//    斜的但讀得到）。換行時新的一條射出來、舊的一條縮回太陽後面。
//  - 主打留言寫在天空的雲上：雲的形狀照留言排好的外框長出來，第一個拍點從右邊滑進來停住，字在一小節內一個個「印」上去
//    （剛印上的字帶一點訊號色，像還沒乾的印泥）。
//  - 冷面註記：「日出時刻 06:13」「本日天氣：晴，喜氣指數 100%」「日出時間以新人起床為準」。
//  - 畫法：整張風景（含每層紙的影子）在 sunrise-glsl.ts 的一個 shader 裡畫；字用一張 Canvas2D 疊上去。
// v2（2026-09-29「留言尺寸與版面比例標準 v2」）：寫留言的那朵雲縮到 ≤ 820×370、移到右上（太陽在左下，對角線構圖），
// 雲邊只比字多一點；留言照 v2 字級（40～60 px，依字數、照標點斷行），署名 26～32，光芒上的歌詞 40～52（不比留言大）。
// 空出來的天空讓給光芒；多補的動畫是這片海自己的：一艘小小的剪紙帆船在第一層浪後面往右開（船底被浪擋住、
// 跟著每拍推一下的浪起伏點頭），太陽在海上的倒影紙條每拍左右錯動一下（波光）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, layout, measure, type TextLayout } from '../engine/type';
import { rgba, LIN } from '../engine/palette';
import { clamp, ease, prog, lerp, mulberry32 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, beatAfter, signature, type LyricStyle, type LyricLayout } from './_motifs';
import { paperSignal, no3, INVITE_SMALL, preloadText, fitWithSig, type MsgBlock } from './_t19';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { FRAG_SUNRISE, N_RAYS, N_CIRC, WAVE_A } from './sunrise-glsl';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'light', paper: true, energy: [0.25, 0.9], bars: [4, 8] };

const DEG = Math.PI / 180;
/** 太陽：x、半徑、升起前後的圓心高度（海平線在 y = 800）。 */
const SUN = { x: 285, r: 172, y0: 912, y1: 760, drift: 24 };
/** 光芒的角度（往右上是負的）與半張角：深淺交錯、寬窄交錯。 */
const RAY_ANG = Array.from({ length: N_RAYS }, (_, k) => (-3 - k * 6.6) * DEG);
const RAY_HALF = Array.from({ length: N_RAYS }, (_, k) => (k % 2 ? 1.25 : 1.9) * DEG);
const RAY_LEN = 2600;
/** 歌詞光芒的角度（一行一條，輪流用）：斜到 12° 以內才讀得舒服，也不會撞到上面的雲。 */
const STRIP_ANG = [-8.5, -11.5, -9.5, -12].map((a) => a * DEG);
/** 歌詞從離圓心多遠開始寫、寫到哪裡為止：左端讓開左邊兩格即時小卡（x ≤ 554），右端停在右邊的格子之前。 */
const D0 = SUN.r + 112, LYR_RIGHT = 1335;
const LYR_STYLE: LyricStyle = { family: F.archivo(100, 700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: 800, lineHeight: 1.14 };
/**
 * 雲上的留言：中心與可用的框（含署名）。v2：放右上（太陽在左下），字框 640 寬、雲邊再多 40 px，
 * 整朵雲（連上緣的圓凸、兩側的圓）約 ≤ 820×370；雲的下緣停在歌詞光芒的上面。
 */
const CLOUD = { cx: 1310, cy: 292, w: 640, h: 250 };
/** 兩朵沒有字的小雲（中心、大小）：一朵在左上、一朵在主雲右下，讓天空有前後。 */
const SMALL: [number, number, number][] = [[560, 176, 0.85], [1700, 600, 0.9]];
/** 紙船：一個窗格最多開多遠（右端停在 HUD 的左邊）、多快（px／秒）。 */
const BOAT = { x0: -110, xMax: 1240, speed: 95, scale: 1 };
const MSG_FAM = F.hand(700);
const NO_MSG = '今天的太陽，為你們升起。';
const FOOT = '＊本日天氣：晴，喜氣指數 100%。日出時間以新人起床為準。';

type Rect = [number, number, number, number];
interface Glyph { ch: string; x: number; y: number; t: number }
interface LyrLay { lay: LyricLayout; st: LyricStyle; ang: number; top: number; bot: number }
interface Strip { ang: number; len: number; hw: number; line: Line | null; tShoot: number; alpha: number }

const BG = () => new FSPass(FRAG_SUNRISE, {
  uSun: { value: new THREE.Vector2(SUN.x, SUN.y1) }, uR: { value: SUN.r },
  uRay: { value: Array.from({ length: N_RAYS }, () => new THREE.Vector4()) },
  uRot: { value: 0 }, uFlash: { value: 0 },
  uStrip: { value: [new THREE.Vector4(), new THREE.Vector4()] },
  uStrip2: { value: [new THREE.Vector2(), new THREE.Vector2()] },
  uCirc: { value: Array.from({ length: N_CIRC }, () => new THREE.Vector4()) },
  uBody: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  uBodyR: { value: new THREE.Vector3() },
  uGOff: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
  uCloudBox: { value: new THREE.Vector4() },
  uWave: { value: new THREE.Vector3() },
  uInkK: { value: 0.28 },
  uBoat: { value: new THREE.Vector4() },
  uGlint: { value: 0 },
});

/** 第一層浪在 x 的高度與坡度（跟 sunrise-glsl.ts 的 waveY(x, WAVE_A, uWave.x, 1.0) 同一個公式）：紙船貼著它起伏。 */
function waveA(x: number, ph: number): [number, number] {
  const xx = x + ph;
  const y = WAVE_A + 7 * Math.sin(xx / 92 + 0.8) + 3.5 * Math.sin(xx / 39 + 2.3);
  const dy = (7 / 92) * Math.cos(xx / 92 + 0.8) + (3.5 / 39) * Math.cos(xx / 39 + 2.3);
  return [y, dy];
}

/** 兩個 rgba() 字串之間混色（剛印上的字從訊號色冷卻成墨色）。 */
function mixCss(a: string, b: string, k: number): string {
  const pa = a.match(/[\d.]+/g)!.map(Number), pb = b.match(/[\d.]+/g)!.map(Number);
  const ch = [0, 1, 2].map((i) => Math.round(lerp(pa[i]!, pb[i]!, k)));
  return `rgba(${ch.join(',')},${lerp(pa[3] ?? 1, pb[3] ?? 1, k)})`;
}

export default class Sunrise extends Scene {
  bg = shared('sunrise.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 97 + (this.msg?.id ?? 0) * 13) >>> 0;
  b0 = 0;
  beat = 0.5;
  /** 每條光芒射出的時間。 */
  shoot: number[] = [];
  fit: FitResult | null = null;
  fam = MSG_FAM;
  glyphs: Glyph[] = [];
  sig: { text: string; x: number; y: number; size: number; t: number } | null = null;
  tag: { text: string; x: number; y: number } | null = null;
  invite: { x: number; y: number } | null = null;
  circ: [number, number, number, number][] = [];
  bodies: [number, number, number, number][] = [];
  bodyR: [number, number, number] = [0, 0, 0];
  cloudBox: [number, number, number, number] = [0, 0, 0, 0];
  lyr = new Map<number, LyrLay>();
  /** 雲上留言的字級（算歌詞字級用）；沒有留言是 null。 */
  msgSize: number | null = null;
  title = '';
  avoid: Rect[] = [];
  head = '';

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s - 0.03);
    this.beat = au.beatPeriod(this.b0);
    const bar = Math.max(this.beat * 2, au.timeOfBar(au.barAt(this.b0) + 1) - this.b0);
    this.title = `♪  ${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
    this.head = `日出 SUNRISE  ·  ${m ? no3(m.n) + '  ·  ' : ''}日出時刻 06:13`;
    const text = m ? m.text : NO_MSG;
    await preloadText(this.ctx, `${text}${signature(m?.name ?? '')}${NO_MSG}${INVITE_SMALL}${FOOT}${this.head}${this.title}FROM THE COUPLE · 新人`);

    // ---- 光芒：窗格夠長一拍一條；短窗格（< 4 小節）半拍一條，才射得滿
    const i0 = Math.round(au.beatAt(this.b0));
    const step = e - s >= bar * 3.5 ? 1 : 0.5;
    this.shoot = RAY_ANG.map((_, k) => au.timeOfBeat(i0 + 1 + k * step));

    // ---- 雲上的留言
    const c = this.layer.ctx;
    const tagH = m?.couple ? 34 : 0;
    let blockW = 0, blockH = 0;
    let blk: MsgBlock | null = null;
    if (m) {
      // 字級依「框高扣掉署名那一列」找（fitWithSig）：署名一定在最後一行下面、不重疊。v2：上限照字數（msgMaxFor）
      const o = { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.28, maxLines: 5 };
      const h = CLOUD.h - tagH;
      blk = fitWithSig(c, text, MSG_FAM, CLOUD.w, h, o, { ratio: 0.6, min: V2.sigMin, max: V2.sigMax });
      // 照標點斷行（「…到現／在，終於…」很難讀）：字級只小一點點就用它
      const cl = fitClauses(c, text, MSG_FAM, CLOUD.w, h - V2.sigMax * 1.6, o);
      if (cl && cl.size >= blk.fit.size * 0.88) {
        const ss = sigV2(cl.size), sd = cl.size * 0.34 + ss * 1.02;
        blk = { fit: cl, sigSize: ss, sigDy: sd, height: cl.height + sd + ss * 0.26 };
      }
      this.fit = blk.fit;
      this.msgSize = blk.fit.size;
    } else {
      // 沒有留言：雲上的標語是配角（焦點是光芒上的歌詞），字小一級
      this.fit = fitText(c, text, MSG_FAM, CLOUD.w, 120, { min: V2.msgMin, max: 48, lineHeight: 1.28, maxLines: 2 });
    }
    const fit = this.fit;
    const sigSize = blk ? blk.sigSize : V2.sigMax;
    const sigText = m ? signature(m.name) : '';
    const sigW = m ? measure(sigText, MSG_FAM, sigSize) : 0;
    const inviteH = m ? 0 : 46;
    // 沒有留言時邀請那一行比標語寬，雲也要包得住它
    const invW = m ? 0 : measure(INVITE_SMALL, F.hei(500), 24, 2);
    blockW = Math.max(fit.width, sigW, invW);
    blockH = tagH + (blk ? blk.height : fit.height + inviteH);
    const top = CLOUD.cy - blockH / 2;
    const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    // 字在雲停下來之後一小節內一個個印上去
    const tm0 = this.b0 + 0.38;
    const dur = clamp(0.055 * n + 0.3, 0.45, Math.min(bar, 0.35 * (e - s)));
    let k = 0;
    fit.lines.forEach((ln, i) => {
      const lay: TextLayout = layout(ln, MSG_FAM, fit.size);
      const x0 = CLOUD.cx - lay.width / 2, y = top + tagH + fit.size + i * fit.lineHeight;
      for (const g of lay.glyphs) this.glyphs.push({ ch: g.ch, x: x0 + g.x, y, t: tm0 + (dur * k++) / Math.max(1, n) });
    });
    const textR = CLOUD.cx + fit.width / 2;
    if (m) {
      this.sig = { text: sigText, x: Math.max(textR, CLOUD.cx + sigW / 2) - sigW, y: top + tagH + fit.height + (blk?.sigDy ?? 0), size: sigSize, t: tm0 + dur + 0.2 };
      if (m.couple) this.tag = { text: 'FROM THE COUPLE · 新人', x: CLOUD.cx - blockW / 2, y: top + 16 };
    } else {
      this.invite = { x: CLOUD.cx, y: top + fit.height + 40 };
    }

    // ---- 雲的形狀：身體是圓角矩形，上緣一排大小不一的圓（中間高）、兩側各一個圓。
    // v2：雲只比字多一點（身體左右各 40、上下各 26 px 的邊），圓凸也收小，整朵 ≤ 約 820×370
    const rnd = mulberry32(this.seed);
    const bx = CLOUD.cx, by = top + blockH / 2;
    const hw = Math.max(blockW, 240) / 2 + 40, hh = Math.max(blockH / 2 + 26, 80);
    const [s1, s2] = SMALL as [[number, number, number], [number, number, number]];
    this.bodies = [[bx, by, hw, hh], [s1[0], s1[1], 92 * s1[2], 24 * s1[2]], [s2[0], s2[1], 92 * s2[2], 24 * s2[2]]];
    this.bodyR = [Math.min(hh, 56), 24 * s1[2], 24 * s2[2]];
    const circ: [number, number, number, number][] = [];
    const nb = clamp(Math.round((hw * 2) / 150), 2, 6);
    for (let i = 0; i < nb; i++) {
      const fx = (i + 0.5) / nb;
      // 圓凸出去不要頂到畫面上緣（上緣至少留 50 px）
      const r = Math.min((40 + 44 * Math.sin(Math.PI * fx)) * (0.85 + 0.3 * rnd()) * clamp(hh / 110, 0.85, 1.1), (by - hh - 50) / 0.55);
      circ.push([bx - hw + 30 + fx * (hw * 2 - 60) + (rnd() - 0.5) * 22, by - hh + r * 0.45, r, 0]);
    }
    circ.push([bx - hw + hh * 0.35, by + hh * 0.1, hh * 0.62, 0], [bx + hw - hh * 0.35, by + hh * 0.06, hh * 0.58, 0]);
    // 兩朵沒有字的小雲，讓天空有前後
    for (const [g, [cx, cy, sc]] of [[1, s1], [2, s2]] as const) {
      circ.push([cx - 48 * sc, cy - 14 * sc, 34 * sc, g], [cx + 6 * sc, cy - 28 * sc, 46 * sc, g], [cx + 56 * sc, cy - 10 * sc, 30 * sc, g]);
    }
    this.circ = circ.slice(0, N_CIRC);
    const allX = this.circ.flatMap((q) => [q[0] - q[2], q[0] + q[2]]), allY = this.circ.flatMap((q) => [q[1] - q[2], q[1] + q[2]]);
    // 外框：主雲滑進來時從右邊來，外框要包到畫面右緣
    this.cloudBox = [Math.min(...allX, bx - hw) - 40, Math.min(...allY) - 30, W + 40, Math.max(...allY, by + hh) + 30];

    // ---- 歌詞：先排好這個窗格會唱到的每一行（依角度決定可用寬度）
    for (const line of lyrics.linesIn(s - 3, e + 1)) this.lyrLayout(line);

    // ---- 即時小卡避開：雲上的字、歌詞會出現的斜帶
    const msgRect: Rect = [CLOUD.cx - blockW / 2 - 50, top - 20, blockW + 90, blockH + 40];
    // 斜帶的外框很鬆：每條斜帶切三段各算一個外框，才不會把整片天空都劃成禁區
    const lyrRects: Rect[] = [];
    for (const a of STRIP_ANG) {
      const u1 = (LYR_RIGHT - SUN.x) / Math.cos(a);
      for (let k = 0; k < 3; k++) {
        const ua = lerp(D0 - 10, u1, k / 3), ub = lerp(D0 - 10, u1, (k + 1) / 3);
        const pts: [number, number][] = [];
        for (const sy of [SUN.y1 - SUN.drift, SUN.y1]) for (const uu of [ua, ub]) for (const w of [-72, 72])
          pts.push([SUN.x + Math.cos(a) * uu - Math.sin(a) * w, sy + Math.sin(a) * uu + Math.cos(a) * w]);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        lyrRects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]);
      }
    }
    this.avoid = [msgRect, ...lyrRects];
  }

  /** 一行歌詞的排版：角度照行號輪流，寬度照角度算（右端停在 LYR_RIGHT）。 */
  private lyrLayout(line: Line): LyrLay {
    let L = this.lyr.get(line.i);
    if (L) return L;
    const ang = STRIP_ANG[line.i % STRIP_ANG.length]!;
    const st: LyricStyle = {
      // 有留言時歌詞比留言小一級；沒有留言時歌詞就是焦點（一樣不超過 52，v2）
      ...LYR_STYLE, size: lyricV2(this.msgSize), maxWidth: (LYR_RIGHT - SUN.x) / Math.cos(ang) - D0,
      active: paperSignal(), sung: rgba('sepia', 0.94), unsung: rgba('sepia', 0.3),
    };
    const lay = layoutLyric(this.layer.ctx, line, st);
    const lh = lay.size * (st.lineHeight ?? 1.18);
    // 紙條的寬（下緣）：韓文歌的原文副行（drawLyric 畫在中文下面）也要在紙條上，所以算到原文最後一排的基線
    const top = -lay.size * 0.86, bot = lay.sub ? lay.height - lay.size + lay.sub.lay.size * 0.2 : (lay.rows.length - 1) * lh + lay.size * 0.2;
    L = { lay, st, ang, top, bot };
    this.lyr.set(line.i, L);
    return L;
  }

  private sunY(t: number) {
    return lerp(SUN.y0, SUN.y1, prog(t, this.b0, this.b0 + 0.9, ease.outExpo)) - SUN.drift * prog(t, this.b0 + 0.9, this.ctx.end);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, b0 = this.b0;
    const u = this.bg.u;
    const sy = this.sunY(t);
    (u.uSun!.value as THREE.Vector2).set(SUN.x, sy);
    u.uR!.value = SUN.r * (1 + 0.018 * f.a.kick);
    u.uFlash!.value = f.a.snare;
    // 訊號色跟紙色太接近（香檳、燭光金）時，太陽與光芒多混一點暗部，在紙上才有份量
    const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    u.uInkK!.value = clamp(0.28 + (0.3 - (lum(LIN.paper) - lum(LIN.signal))) * 1.6, 0.2, 0.55);

    // ---- 光芒：射出（outExpo），射滿之後每拍一道光沿著其中一條往外跑；每小節整組轉一點
    const rays = u.uRay!.value as THREE.Vector4[];
    const lastShoot = this.shoot[this.shoot.length - 1]!;
    const bi = au.beatAt(t), bLast = au.beatAt(lastShoot);
    let pulseSlot = -1, pulseR = -1;
    if (bi >= bLast + 1) {
      const j = Math.floor(bi), ph = bi - j;
      pulseSlot = j % N_RAYS;
      pulseR = SUN.r + 60 + 2000 * ease.outCubic(ph);
    }
    for (let k = 0; k < N_RAYS; k++) {
      const len = RAY_LEN * prog(t, this.shoot[k]!, this.shoot[k]! + 0.5, ease.outExpo);
      rays[k]!.set(RAY_ANG[k]!, len, RAY_HALF[k]!, k === pulseSlot ? pulseR : -1);
    }
    const bars = Math.max(0, au.barAt(t) - au.barAt(b0));
    u.uRot!.value = -0.5 * DEG * (Math.floor(bars) + ease.inOutCubic(clamp((bars % 1) / 0.35)));

    // 浪：每拍推一下（像紙劇場的布景被拉動），三層方向不同
    const beats = Math.max(0, bi - au.beatAt(b0));
    const tick = Math.floor(beats) + ease.outCubic(clamp((beats % 1) / 0.4));
    (u.uWave!.value as THREE.Vector3).set(9 * tick, -12 * tick, 7 * tick);
    // 波光：倒影紙條跟著同一個拍子左右錯動
    u.uGlint!.value = 1.9 * tick;
    // 紙船：從左邊畫外駛進來，整個窗格等速往右開（窗格結束時剛好到 xMax，不進 HUD）；
    // 船身貼著第一層浪的高度與坡度，浪每拍推一下，船就跟著起伏、點一下頭
    const vB = Math.min(BOAT.speed, (BOAT.xMax - BOAT.x0) / Math.max(1, e - s));
    const xB = BOAT.x0 + vB * Math.max(0, t - s);
    const [yW, slope] = waveA(xB, 9 * tick);
    (u.uBoat!.value as THREE.Vector4).set(xB, yW - 5, 0.8 * Math.atan(slope), BOAT.scale);

    // ---- 雲
    const slide = (1 - prog(t, b0, b0 + 0.6, ease.outExpo)) * 1150;
    const pw = prog(t, s, e);
    const goff = u.uGOff!.value as THREE.Vector2[];
    goff[0]!.set(slide - 30 * pw, 0);
    goff[1]!.set(-44 * pw, 0);
    goff[2]!.set(-20 * pw, 0);
    const circ = u.uCirc!.value as THREE.Vector4[];
    for (let i = 0; i < N_CIRC; i++) { const q = this.circ[i]; if (q) circ[i]!.set(q[0], q[1], q[2], q[3]); else circ[i]!.set(0, 0, 0, 0); }
    const bodies = u.uBody!.value as THREE.Vector4[];
    this.bodies.forEach((b, i) => bodies[i]!.set(b[0], b[1], b[2], b[3]));
    (u.uBodyR!.value as THREE.Vector3).set(...this.bodyR);
    (u.uCloudBox!.value as THREE.Vector4).set(...this.cloudBox);

    // ---- 歌詞的光芒紙條（最多兩條：縮回去的舊的、射出來的新的）
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    const strips = this.strips(t);
    const su = u.uStrip!.value as THREE.Vector4[], su2 = u.uStrip2!.value as THREE.Vector2[];
    for (let i = 0; i < 2; i++) {
      const st = strips[i];
      if (!st) { su[i]!.set(0, 0, 0, 0); continue; }
      su[i]!.set(st.ang, st.len, st.hw, 1);
      su2[i]!.set(SUN.r * 0.5, 0.022);
    }
    this.bg.render(renderer, out);

    // ---- 字
    for (const st of strips) this.drawStripText(c, st, t, sy);
    this.drawMessage(c, t, slide - 30 * pw);
    this.drawNotes(c, t);
    comp.draw(renderer, L.upload(), out);
    // 鏡頭：整個窗格很慢地推近（inOutSine）
    const push = 1 + 0.03 * (0.5 - 0.5 * Math.cos(Math.PI * f.p));
    return { paper: 1, popupAvoid: this.avoid, bloom: 0.12, bloomThreshold: 1.8, halation: 0.02, vignette: 0.18, grain: 0.04, ca: 0.4, zoom: push };
  }

  /**
   * 一行歌詞的紙條什麼時候收走：唱完停 1.2 秒；下一行要來時提早收，但不會在這一行還沒唱完之前收
   * （反白要走完）。下一行的紙條等這一行收了才射出來，兩行的字才不會疊在一起。
   */
  private gone(line: Line): number {
    const next = this.ctx.lyrics.lines[line.i + 1];
    let tg = line.end + 1.2;
    if (next) tg = Math.min(tg, Math.max(next.start - 0.45, line.end));
    return tg;
  }
  private shootAt(line: Line): number {
    const prev = this.ctx.lyrics.lines[line.i - 1];
    return Math.max(line.start - 0.45, prev ? this.gone(prev) : -Infinity, this.b0 + 0.15);
  }

  /** 這一格要畫的歌詞紙條（依射出的先後排：舊的先畫、新的壓在上面）。 */
  private strips(t: number) {
    const { lyrics } = this.ctx;
    const out: Strip[] = [];
    const tMin = this.b0 + 0.15;
    if (!lyrics.has) {
      // 純音樂：一條靜止的紙條寫歌名
      const kin = prog(t, tMin, tMin + 0.5, ease.outExpo);
      if (kin > 0) out.push({ ang: -10 * DEG, len: SUN.r * 0.5 + RAY_LEN * kin, hw: 50, line: null, tShoot: tMin, alpha: 1 });
      return out;
    }
    for (const line of lyrics.linesIn(t - 3, t + 0.8)) {
      const tShoot = this.shootAt(line), tGone = this.gone(line);
      const kin = prog(t, tShoot, tShoot + 0.45, ease.outExpo);
      const kout = prog(t, tGone, tGone + 0.32, ease.inCubic);
      if (kin <= 0 || kout >= 1) continue;
      const Ly = this.lyrLayout(line);
      const hw = (Ly.bot - Ly.top) / 2 + Ly.lay.size * 0.34;
      // 縮回太陽後面：字先很快淡掉（新的一行馬上要射出來），紙條再從尾巴收
      const full = D0 + [...Ly.lay.rows, ...(Ly.lay.sub?.lay.rows ?? [])].reduce((a, r) => Math.max(a, r.width), 0) + 90;
      const len = kout > 0 ? lerp(Math.max(full, 1400), SUN.r * 0.5, kout) : SUN.r * 0.5 + RAY_LEN * kin;
      out.push({ ang: Ly.ang, len, hw, line, tShoot, alpha: 1 - prog(t, tGone, tGone + 0.12) });
    }
    out.sort((a, b) => a.tShoot - b.tShoot);
    return out.slice(-2);
  }

  private drawStripText(c: CanvasRenderingContext2D, st: Strip, t: number, sy: number) {
    if (st.alpha <= 0) return;
    c.save();
    c.globalAlpha = st.alpha;
    c.translate(SUN.x + Math.cos(st.ang) * D0, sy + Math.sin(st.ang) * D0);
    c.rotate(st.ang);
    // 字只畫在紙條已經伸到的地方
    c.beginPath();
    c.rect(-40, -300, Math.max(0, st.len - D0 + 30), 600);
    c.clip();
    if (!st.line) {
      // 純音樂：光芒上的歌名是配角（小、淡），焦點是雲上的留言
      c.font = font(LYR_STYLE.family, 38);
      c.fillStyle = rgba('sepia', 0.45);
      c.textBaseline = 'alphabetic';
      c.fillText(this.title, 0, 38 * 0.36);
    } else {
      const Ly = this.lyrLayout(st.line);
      c.translate(0, -(Ly.top + Ly.bot) / 2);
      drawLyric(c, st.line, t, Ly.st, Ly.lay, st.alpha);
    }
    c.restore();
  }

  private drawMessage(c: CanvasRenderingContext2D, t: number, dx: number) {
    const fit = this.fit;
    if (!fit) return;
    c.save();
    c.translate(dx, 0);
    c.textBaseline = 'alphabetic';
    const ink = rgba('sepia', 0.94), hot = paperSignal();
    c.font = font(MSG_FAM, fit.size);
    for (const g of this.glyphs) {
      if (t < g.t) continue;
      const a = prog(t, g.t, g.t + 0.1);
      const sc = 1 + 0.22 * (1 - prog(t, g.t, g.t + 0.2, ease.outCubic));
      const heat = 1 - prog(t, g.t + 0.1, g.t + 0.7);
      const base = g.ch === '♥' ? rgba('rose') : ink;
      c.globalAlpha = a;
      c.fillStyle = heat > 0 && g.ch !== '♥' ? mixCss(base, hot, heat * 0.85) : base;
      if (sc !== 1) {
        const w = c.measureText(g.ch).width;
        c.save();
        c.translate(g.x + w / 2, g.y - fit.size * 0.35);
        c.scale(sc, sc);
        c.fillText(g.ch, -w / 2, fit.size * 0.35);
        c.restore();
      } else c.fillText(g.ch, g.x, g.y);
    }
    c.globalAlpha = 1;
    if (this.sig && t >= this.sig.t) {
      c.globalAlpha = prog(t, this.sig.t, this.sig.t + 0.35);
      c.font = font(MSG_FAM, this.sig.size);
      c.fillStyle = rgba('sepia', 0.7);
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
      c.globalAlpha = 1;
    }
    if (this.tag) {
      c.globalAlpha = prog(t, this.b0 + 0.3, this.b0 + 0.6);
      c.font = font(F.mono(500), 16);
      c.letterSpacing = '3px';
      c.fillStyle = paperSignal(0.9);
      c.fillText(this.tag.text, this.tag.x, this.tag.y);
      c.letterSpacing = '0px';
      c.globalAlpha = 1;
    }
    if (this.invite) {
      const last = this.glyphs[this.glyphs.length - 1];
      c.globalAlpha = prog(t, (last?.t ?? this.b0) + 0.3, (last?.t ?? this.b0) + 0.7);
      c.font = font(F.hei(500), 24);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('sepia', 0.72);
      c.textAlign = 'center';
      c.fillText(INVITE_SMALL, this.invite.x, this.invite.y);
      c.textAlign = 'left';
      c.letterSpacing = '0px';
      c.globalAlpha = 1;
    }
    c.restore();
  }

  /** 左下角海面上的 mono 註記。 */
  private drawNotes(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.6);
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText(this.head, 150, 936);
    c.fillStyle = rgba('sepia', 0.4);
    c.fillText(FOOT, 150, 966);
    c.restore();
  }
}
