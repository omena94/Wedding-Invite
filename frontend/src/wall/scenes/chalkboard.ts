// 黑板（暗）：放學後的教室，一面黑板，粉筆字。
//  - 一個焦點：主打留言用粉筆大大地寫在黑板正中間，拍點上一個字一個字寫出來（寫的地方掉一點粉筆灰），
//    粉筆字有顆粒、會斷斷續續（黑板表面粗糙的地方才沾得到粉）；署名寫在最後一行下面。
//  - 歌詞是黑板最上面一行（像今天的課名），逐字寫：還沒唱的是淡淡的、唱到的字用彩色粉筆（訊號色）、唱完是白粉筆。
//    換句時板擦在小節線從左到右擦過去，留下一道擦過的白霧，新的一句再寫上去。比留言小一級。
//  - 右邊是台灣教室黑板一定有的那一欄：「3月13日 星期六」「值日生」——今天的值日生是新郎新娘（宣文、孟庭）。
//  - 沒有留言：歌詞放大寫在中間（歌詞是焦點）；純音樂又沒有留言：中間寫邀請。
//  - 最後半拍板擦斜斜地把整面黑板擦掉（下一堂課）。鏡頭像坐在第一排往上看，切進來時從左邊搖過來落定、慢慢推近。
// 手法：一個全螢幕 shader（PlaneCam：黑板是一張平面；石板的顆粒、以前擦過的白霧、粉筆的斷續都在這裡算），
// 留言是 _t14 的「依序出現」字模（每個字寫的時間在 uniform 陣列），歌詞與右邊那一欄是黑板座標的 Canvas 圖層；粉筆灰用 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, lyricSizeFor, WEDDING_DATE, COUPLE_ZH } from './_motifs';
import { grid, stagger, layoutRows, drawRows, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, orderMask, lineItems, msgBlock, INVITE, type OrderMask, type MsgBlock, type MaskItem, type Rect, type P2 } from './_t14';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

const BOARD = { x0: 80, y0: 70, x1: 1840, y1: 872 };
const MSG_BOX = { x: 200, y: 262, w: 1300, h: 540 };
const LYR_S = { x: 200, y: 196, w: 1290 };
const BIG = { x: 200, y: 300, w: 1300, h: 420 };
const DUTY_X = 1600;
const FAM = F.hand(700);
const MAXC = 80;
const MS = 0.5;

// 婚禮那天是星期幾（右邊那一欄）：用 UTC 算，每台電腦都一樣
const [Y, M, D] = String(WEDDING_DATE).split('-').map(Number) as [number, number, number];
const WEEK = '日一二三四五六'[new Date(Date.UTC(Y, M - 1, D)).getUTCDay()]!;
const DATE_TXT = `${M}月${D}日（${WEEK}）`;
const NAMES = COUPLE_ZH.split(/\s*&\s*/);

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D mask; uniform vec4 mR; uniform float hasMask;
  uniform vec2 cI[${MAXC}]; uniform float t;
  uniform sampler2D lyr; uniform vec4 board;
  uniform vec4 band;      // 歌詞帶：上緣 y、下緣 y、板擦前緣 x（沒在擦 = -1e4）、擦過的白霧（0..1）
  uniform vec3 eraser;    // 板擦中心 x、y、在不在（0/1）
  uniform float exitD;    // 最後一擦的前緣（對角線座標）

  // 寫了多少（x）與是不是愛心（y：愛心用玫瑰色的粉筆）
  vec2 written2(vec2 q) {
    vec2 mu = (q - mR.xy) / mR.zw;
    if (hasMask < 0.5 || mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) return vec2(0.0);
    vec4 m = texture(mask, mu);
    if (m.a < 0.01) return vec2(0.0);
    int i = min(int(floor(m.g * 255.0 + 0.5)), ${MAXC - 1});
    vec2 ci = cI[i];
    return vec2(m.a * sat((t - ci.x - m.b * ci.y) / 0.04), step(0.5, m.r));
  }
  float written(vec2 q) { return written2(q).x; }
  // 粉筆：黑板表面粗糙，凸起的地方才沾得到粉——覆蓋率越高、顆粒越少斷
  float chalk(float cov, vec2 P) {
    // 顆粒（黑板表面的凹凸）＋粉筆側面拖出來的斜紋；覆蓋率低的邊緣斷得比較多
    float g = 0.5 * snoise(P / 1.1) + 0.3 * snoise(P / 2.7) + 0.35 * snoise(vec2((P.x + P.y) / 24.0, (P.x - P.y) / 1.7));
    return sat(cov * 1.35 - 0.4 + g * 0.55) * sat(cov * 3.0) * (0.82 + 0.18 * snoise(P / 9.0));
  }

  void main() {
    vec2 sp = SP();
    vec3 h0 = pcHit(sp, 0.0);
    vec2 P = h0.xy;
    float px = max(max(fwidth(P.x), fwidth(P.y)), 0.3);
    // 牆（黑板外面）：暗暗的，窗外的光從左上來
    float win = exp(-length((P - vec2(-200.0, -200.0)) / vec2(1900.0, 1500.0)) * 1.2);
    // 教室的牆：比黑板亮一點的暗灰，上面有黑板投下的影子
    vec3 col = mix(C_INK2, C_ASH, 0.13) * (0.45 + 0.75 * win) * (0.95 + 0.05 * snoise(P / 90.0));
    vec2 bq = abs(P - (board.xy + board.zw) * 0.5) - (board.zw - board.xy) * 0.5;
    float bd = max(bq.x, bq.y);
    vec2 bq2 = abs(P - (board.xy + board.zw) * 0.5 - vec2(18.0, 22.0)) - (board.zw - board.xy) * 0.5;
    col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 40.0, max(bq2.x, bq2.y)));
    if (bd < 0.0) {
      // 石板：深灰、細顆粒、以前擦過留下的一大片一大片白霧（弧形的擦痕）
      vec3 slate = mix(C_INK2, C_GRAPHITE, 0.26) * (0.92 + 0.05 * snoise(P / 3.0) + 0.04 * snoise(P / 40.0));
      float swirl = 0.5 + 0.5 * sin(length(P - vec2(700.0, 1300.0)) / 26.0 + 3.0 * snoise(P / 300.0));
      float haze = sat(0.5 + 0.6 * snoise(P / vec2(520.0, 260.0))) * (0.35 + 0.65 * swirl);
      slate += C_BONE * 0.022 * haze;
      slate *= 0.8 + 0.35 * win;
      col = slate;
      // 粉筆字（留言）
      vec2 cw2 = written2(P);
      float cw = cw2.x;
      // 粉筆灰：字的周圍一層很淡的白霧
      float halo = 0.25 * (written(P + vec2(7.0, 3.0)) + written(P - vec2(7.0, 3.0)) + written(P + vec2(-3.0, 7.0)) + written(P - vec2(-3.0, 7.0)));
      // 歌詞與右邊那一欄（Canvas 圖層）
      vec4 L = fastLayer(texture(lyr, pageUV(P)));
      vec3 lc = L.a > 0.01 ? L.rgb / L.a : vec3(0.0);
      // 最後一擦：對角線前緣之前的地方粉筆被擦掉，留下白霧
      float dg = P.x + P.y * 0.7;
      float wiped = step(dg, exitD);
      // 歌詞帶正在被擦：前緣之前（左邊）的舊字已經擦掉，換成一道橫的白霧
      float inBand = step(band.x, P.y) * step(P.y, band.y);
      float smear = inBand * (step(P.x, band.z) * 0.6 + band.w) * (0.5 + 0.5 * snoise(vec2(P.x / 200.0, P.y / 6.0)));
      col += C_BONE * 0.05 * smear + C_BONE * 0.035 * halo;
      col += C_BONE * 0.06 * wiped * (0.5 + 0.5 * snoise(vec2(dg / 200.0, (P.y - P.x * 0.7) / 7.0)));
      float k1 = chalk(cw, P) * (1.0 - wiped);
      float k2 = chalk(L.a, P + 31.0) * (1.0 - wiped);
      col = mix(col, mix(C_BONE * 0.86, C_ROSE * 0.85, cw2.y), k1);
      col = mix(col, lc * 0.9, k2);
      // 黑板邊框的內側一圈暗（邊框的影子）
      col *= 1.0 - 0.25 * smoothstep(-22.0, 0.0, bd);
    }
    // 鋁框：一圈細細的亮邊
    float frame = (1.0 - smoothstep(0.0, 1.5 + px, abs(bd - 7.0))) * step(-2.0, bd) * step(bd, 16.0);
    float fr = step(-1.0, bd) * step(bd, 14.0);
    col = mix(col, mix(C_ASH, C_BONE, 0.2) * (0.35 + 0.35 * win), fr * 0.9);
    col += C_BONE * 0.12 * frame * win;
    // 粉筆槽（黑板下面一條，離鏡頭近一點）：鋁槽＋兩支粉筆
    vec2 T = pcHit(sp, -26.0).xy;
    float tray = step(board.w + 14.0, T.y) * step(T.y, board.w + 52.0) * step(board.x - 20.0, T.x) * step(T.x, board.z + 20.0);
    if (tray > 0.5) {
      float n = (T.y - board.w - 33.0) / 19.0;
      col = mix(C_ASH, C_INK2, 0.55) * (0.45 + 0.5 * sqrt(max(0.0, 1.0 - n * n))) * (0.6 + 0.5 * win);
      vec2 c1 = T - vec2(420.0, board.w + 30.0), c2 = T - vec2(520.0, board.w + 31.0);
      float s1 = 1.0 - smoothstep(0.0, 1.5, sdBox(rot2(0.05) * c1, vec2(46.0, 6.0)) - 3.0);
      float s2 = 1.0 - smoothstep(0.0, 1.5, sdBox(rot2(-0.08) * c2, vec2(32.0, 6.0)) - 3.0);
      col = mix(col, C_BONE * 0.8, s1);
      col = mix(col, C_SIGNAL * 0.75, s2);
    }
    // 板擦（貼著黑板，z = -10）：木頭背、底下一條毛氈
    if (eraser.z > 0.5) {
      vec2 E = pcHit(sp, -10.0).xy - eraser.xy;
      float sd = sdBox(E, vec2(92.0, 30.0)) - 8.0;
      float cov = 1.0 - smoothstep(-px, px, sd);
      vec3 ec = mix(C_SEPIA, C_BLOOD, 0.3) * (0.7 + 0.3 * sat(-E.y / 30.0)) * (0.7 + 0.4 * win);
      ec = mix(ec, mix(C_GRAPHITE, C_BONE, 0.25) * 0.7, step(22.0, E.y));
      // 板擦的影子
      float sh = 1.0 - smoothstep(0.0, 26.0, sdBox(E - vec2(10.0, 14.0), vec2(92.0, 30.0)) - 8.0);
      col *= 1.0 - 0.45 * sh * (1.0 - cov);
      col = mix(col, ec, cov);
    }
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  mask: { value: null }, mR: { value: new THREE.Vector4(0, 0, 1, 1) }, hasMask: { value: 0 },
  cI: { value: Array.from({ length: MAXC }, () => new THREE.Vector2(1e9, 0.2)) }, t: { value: 0 },
  lyr: { value: null }, board: { value: new THREE.Vector4(BOARD.x0, BOARD.y0, BOARD.x1, BOARD.y1) },
  band: { value: new THREE.Vector4(0, 0, -1e4, 0) }, eraser: { value: new THREE.Vector3(0, 0, 0) }, exitD: { value: -1e4 },
});

export default class Chalkboard extends Scene {
  bg = shared('chalkboard.bg', BG);
  /** 歌詞、右邊那一欄（黑板座標）。 */
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dust = this.track(new LineBatch(400, { screen2D: true, blend: 'add' }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 83 + (this.msg?.id ?? 0) * 19) >>> 0;
  mask: OrderMask | null = null;
  block: MsgBlock | null = null;
  items: MaskItem[] = [];
  times: { s: number; d: number }[] = [];
  lyr0 = { ...LYR_S, size: 52, rows: 1 };
  hasLyrics = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.lyr.ctx;
    const gr = grid(au, s, e);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}${INVITE}${DATE_TXT}值日生${NAMES.join('')}${song.title}${song.artist}——一位賓客`);
    let items: MaskItem[] = [];
    if (m) {
      const b = (this.block = msgBlock(c, m, FAM, MSG_BOX, { align: 'left', sigFamily: FAM, sigMin: 50, sigMax: 62, min: 50, max: 140, lineHeight: 1.3, maxLines: 5 }));
      items = lineItems(b.lines, FAM, b.fit.size);
      items.push(...lineItems([{ text: b.sig.text, x: b.sig.x, y: b.sig.y }], FAM, b.sig.size, items.length).map((it) => ({ ...it, thick: 0.4 })));
      this.lyr0 = { ...LYR_S, size: lyricSizeFor(b.fit.size), rows: 1 };
      this.avoid = [b.box, [LYR_S.x, LYR_S.y - 60, LYR_S.w, 80]];
    } else if (!this.hasLyrics) {
      // 純音樂又沒有留言：中間寫邀請（兩行）
      const ft = fitText(c, INVITE, FAM, BIG.w, BIG.h, { min: 70, max: 110, lineHeight: 1.35, maxLines: 2 });
      const top = BIG.y + (BIG.h - ft.height) / 2 + ft.size * 0.9;
      items = lineItems(ft.lines.map((ln, i) => ({ text: ln, x: BIG.x, y: top + i * ft.lineHeight })), FAM, ft.size);
      this.avoid = [[BIG.x, BIG.y, BIG.w, BIG.h]];
    } else {
      // 沒有留言：歌詞放大寫在中間
      this.lyr0 = { x: BIG.x, y: BIG.y + 190, w: BIG.w, size: 112, rows: 2 };
      this.avoid = [[BIG.x, BIG.y, BIG.w, BIG.h]];
    }
    this.items = items;
    if (items.length) {
      const n = items.length;
      const ts = stagger(au, gr.b0, n, Math.min(gr.bar * 1.75, Math.max(gr.beat * 2, (e - gr.b0) * 0.5)));
      this.times = ts.map((t0, i) => ({ s: t0, d: clamp(((ts[i + 1] ?? t0 + gr.beat) - t0) * 0.85, 0.08, 0.4) }));
      const x0 = Math.min(...items.map((g) => g.x)) - 30, x1 = Math.max(...items.map((g) => g.x + g.w)) + 30;
      const y0 = Math.min(...items.map((g) => g.y - g.size)) - 30, y1 = Math.max(...items.map((g) => g.y + g.size * 0.35)) + 30;
      this.mask = this.track(orderMask(items, [x0, y0, x1 - x0, y1 - y0], MS, 'x', 3, clamp(items[0]!.size * 0.012, 0.5, 1.6)));
    }
  }

  /** 換句時板擦擦過歌詞帶：回傳擦的進度（0..1，沒在擦 = -1）。換句的時間用二分找（t 的純函數）。 */
  private eraseAt(t: number): number {
    const WIN = 0.34;
    const lyrics = this.ctx.lyrics;
    const cur = lyricAt(lyrics, t)?.line ?? null;
    const later = lyricAt(lyrics, t + WIN)?.line ?? null;
    if (!cur || later === cur) return -1;
    let lo = t, hi = t + WIN;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if ((lyricAt(lyrics, mid)?.line ?? null) === cur) lo = mid; else hi = mid; }
    return clamp(1 - (hi - t) / WIN);
  }

  /** 粉筆頭在 tt 時的位置（黑板座標）：正在寫的那個字，照它的掃描方向往右走、上下點一點。 */
  private headAt(tt: number): P2 | null {
    for (let i = 0; i < this.items.length; i++) {
      const tm = this.times[i]!;
      if (tt < tm.s) return null;
      if (tt < tm.s + tm.d) {
        const it = this.items[i]!, k = (tt - tm.s) / tm.d;
        return { x: it.x + it.w * k, y: it.y - it.size * (0.45 + 0.3 * Math.sin(k * 17 + i)) };
      }
    }
    return null;
  }

  /** 鏡頭：像坐在第一排、稍微往上看；切進來時從左邊搖過來落定，之後慢慢推近；最後一擦時跟著往右搖一點。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const land = prog(t, s, s + 0.7, ease.outExpo);
    const p = clamp((t - s) / (e - s));
    const exit = prog(t, e - 0.5, e, ease.inCubic);
    const F0 = 1600;
    return {
      tx: 930 - 220 * (1 - land) + 60 * exit + 16 * (p - 0.5), ty: 520,
      dist: F0 * (1.05 - 0.05 * ease.inOutQuad(p) + 0.03 * (1 - land)),
      pitch: 0.07, yaw: 0.14 + 0.1 * (1 - land) + 0.04 * exit, level: 0.9, focal: F0,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    u.t!.value = t;
    u.mask!.value = this.mask?.tex ?? null;
    u.hasMask!.value = this.mask ? 1 : 0;
    if (this.mask) (u.mR!.value as THREE.Vector4).set(...this.mask.rect);
    const arr = u.cI!.value as THREE.Vector2[];
    for (let i = 0; i < MAXC; i++) { const x = this.times[i]; if (x) arr[i]!.set(x.s, x.d); else arr[i]!.set(1e9, 0.2); }
    // 最後一擦：窗格最後半拍（短窗格更短），對角線前緣從左上擦到右下
    const exD = Math.min(0.5, 0.12 * (e - s));
    const ex = prog(t, e - exD, e - 0.03, ease.inOutCubic);
    const exitD = ex > 0 ? -200 + ex * 2900 : -1e4;
    u.exitD!.value = exitD;

    // ---- Canvas 圖層：右邊那一欄（一開始就寫好的）、歌詞
    const L = this.lyr; L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    // 日期（橫的）與「值日生」、兩個名字（直的）
    // 配角：小、淡（MV 融合原則）
    c.fillStyle = rgba('bone', 0.6);
    c.font = font(FAM, 26);
    c.fillText(DATE_TXT, DUTY_X - 10, 170);
    const vert = (text: string, x: number, y: number, size: number, color: string) => {
      c.font = font(FAM, size); c.fillStyle = color;
      Array.from(text).forEach((ch, i) => { const w = c.measureText(ch).width; c.fillText(ch, x - w / 2, y + i * size * 1.08); });
    };
    vert('值日生', DUTY_X + 140, 236, 26, rgba('bone', 0.55));
    NAMES.forEach((nm, i) => vert(nm, DUTY_X + 86 - i * 54, 244, 38, rgba('bone', 0.7)));
    // 值日生那一欄左邊一條直線（粉筆畫的分隔線）
    c.strokeStyle = rgba('bone', 0.5); c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(DUTY_X - 34, 196); c.lineTo(DUTY_X - 30, 800); c.stroke();

    // 歌詞：還沒唱淡淡的、正在唱彩色粉筆、唱完白粉筆；換句時被板擦擦掉
    const ink: KaraokeInk = { active: rgba('signal'), sung: rgba('bone'), unsung: rgba('bone', 0.32) };
    const ly = lyricAt(lyrics, t);
    const lz = this.lyr0;
    const nx = lyrics.nextLine(t), lsl = lyrics.lastLine(t);
    // 沒有留言時中間不要空著：兩句之間先寫著下一句（淡淡的），窗格裡沒有下一句就留著剛唱完的
    const line = ly?.line ?? (this.msg ? null : nx && nx.start < e ? nx : lsl && lsl.end > s - 4 ? lsl : null);
    const bandV = u.band!.value as THREE.Vector4;
    let eraser: P2 | null = null;
    if (line) {
      const st = { family: FAM, size: lz.size, minSize: 48, maxW: lz.w, maxRows: lz.rows, align: 'left' as const };
      const lay = layoutRows(c, line, st);
      const y = lz.rows > 1 ? lz.y - ((lay.rows.length - 1) * lay.lineHeight) / 2 : lz.y;
      const w = this.eraseAt(t);
      const fx = lz.x - 80 + (lay.width + 200) * Math.max(0, w);
      c.save();
      if (w >= 0) { c.beginPath(); c.rect(fx, 0, W, H); c.clip(); }
      c.translate(lz.x, y);
      drawRows(c, lay, FAM, t, ink, ly ? ly.k : 1);
      c.restore();
      const top = y - lay.size * 1.05, bot = y + lay.size * 0.35 + (lay.rows.length - 1) * lay.lineHeight;
      bandV.set(top, bot, w >= 0 ? fx : -1e4, 0);
      if (w >= 0) eraser = { x: fx, y: (top + bot) / 2 };
    } else bandV.set(0, 0, -1e4, 0);
    if (!this.hasLyrics && this.msg) {
      const song = this.ctx.song;
      c.font = font(F.mono(500), 20); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.45);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LYR_S.x, LYR_S.y - 16);
      c.letterSpacing = '0px';
    }
    if (!this.msg && this.hasLyrics) {
      c.font = font(FAM, 34); c.fillStyle = rgba('bone', 0.55);
      c.fillText(INVITE, BIG.x, 790);
    }
    if (this.msg?.couple) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.7);
      c.fillText('FROM THE COUPLE  ·  新人', MSG_BOX.x, MSG_BOX.y - 14);
      c.letterSpacing = '0px';
    }
    // 最後一擦的板擦（沿著對角線前緣往右下走）
    if (ex > 0 && ex < 1) { const ey = lerp(160, 820, ex); eraser = { x: exitD - 0.7 * ey + 30, y: ey }; }
    (u.eraser!.value as THREE.Vector3).set(eraser?.x ?? 0, eraser?.y ?? 0, eraser ? 1 : 0);
    u.lyr!.value = L.upload();
    this.bg.render(renderer, out);

    // ---- 粉筆灰：寫字的地方掉下來的細粉（每 0.03 秒生一顆，位置只由時間決定）
    const db = this.dust; db.clear();
    const bone = LIN.bone;
    for (let k = 0; k < 40; k++) {
      const tb = Math.floor(t / 0.03) * 0.03 - k * 0.03;
      const hp = this.headAt(tb);
      if (!hp) continue;
      const age = t - tb;
      if (age > 1.1 || age < 0) continue;
      const r1 = hash(this.seed, Math.round(tb * 1000), 1), r2 = hash(this.seed, Math.round(tb * 1000), 2);
      const x = hp.x + (r1 - 0.5) * 30 + (r1 - 0.5) * 40 * age, y = hp.y + 10 + 60 * age + 120 * age * age * r2;
      const sp = this.cam.toScreen(x, y, -2);
      const a = (1 - age / 1.1) * 0.35 * (0.5 + r2);
      db.seg2(sp.x, sp.y, sp.x + 0.5, sp.y + 0.5, 1.4 + r2 * 1.4, [bone[0] * a, bone[1] * a, bone[2] * a], 1);
    }
    if (db.count) db.render(renderer, out);
    return { bloom: 0.45, vignette: 0.55, halation: 0.2, popupAvoid: this.avoid.map((r) => this.cam.screenRect(r, 10)) };
  }
}
