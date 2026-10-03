// 捷運路線圖（亮）：月台牆上的一張路線圖海報（鋁框、白磁磚牆），鏡頭斜斜地沿著牆慢慢移過去，有一點景深。
//  - 兩條線，各用一位新人的名字命名：「承恩線」（訊號色的暗部）從左上、「以晴線」（墨色）從左下開過來，列車一拍前進一站（落在拍點、回彈一下），
//    在小節線上同時開進中間的「轉乘站」——兩條線從這裡合成一條並排的雙色線，一路開往右邊的終點站「永遠」。
//  - 畫面的焦點＝主打留言：兩班車在轉乘站會合的那一刻，海報上方的空白處一行一行「印」出留言（思源宋體），
//    一條細細的引線從轉乘站拉上去，像路線圖上的車站說明；署名在最後一行下面。
//  - 歌詞（比留言小一級）是合併線上的站名：一句歌詞排在線的上方，每個詞組底下一個車站圓點，
//    合併後的列車跟著歌聲一站一站往前開（唱到哪、車開到哪，經過的站點塗滿），字照跟唱規則亮。
//  - 沒有主打留言：歌詞放大印在上方當主角，下面一行小字邀請；純音樂：線上是小小的歌名，列車一拍一站往前開。
//  - 小字只有三小群：線名（兩位新人的名字＋「線」）、轉乘站名、終點站名。
// 手法：不會變的路線圖（紙、線、站、留言）在 init() 畫一次成一張 Canvas；會變的（列車、歌詞、印字的遮蓋、站點）每格畫在
// 另一張；兩張合成進一張離屏圖，再用單應矩陣把它當成牆上的一張海報拍（透視、景深、鋁框、磁磚牆、玻璃反光）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT, clearRT } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, pulse, polylineLengths, pointAtLength, TAU, type V2 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, beatAfter, drawHeart, COUPLE_ZH, NAME_A, NAME_B, DATE_DOT, joinBits, fitPx, lyricSubOf, subSizeFor, subStyleFor, subGap, type LyricStyle, type LyricLayout } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 as STD } from './_v2';
import { T16_INVITE, T16_TEXT, sigOf, winBeats, winBars } from './_t16';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'city', paper: true, energy: [0.1, 0.85], bars: [4, 8] };

/** 兩條線的線名（新人的名字＋「線」）與海報標題帶右邊的小字（還沒定日期就只寫 ROUTE MAP）。 */
const LINE_NAME_A = `${NAME_A}線`, LINE_NAME_B = `${NAME_B}線`;
const ROUTE_TAG = joinBits(' · ', 'ROUTE MAP', DATE_DOT);

// ---------------------------------------------------------------- 海報上的配置（海報座標 = 1920 × 1080）
/** 轉乘站、兩條線（各有幾個站）、合併線、終點。 */
const T = { x: 560, y: 760 };
const LINE_A: V2[] = [{ x: 60, y: 300 }, { x: 330, y: 300 }, { x: 560, y: 530 }, T];
const LINE_B: V2[] = [{ x: 60, y: 990 }, { x: 360, y: 990 }, { x: 560, y: 790 }, T];
/** 兩條線上的車站（沿線的弧長比例，最後一站是轉乘站）。 */
const STOPS = [0.2, 0.45, 0.72, 1];
const MERGE = { x0: T.x, x1: 1770, y: T.y };
/** 留言（上方的空白）、歌詞（合併線上方）、沒有留言時的大歌詞。 */
/**
 * 留言標準 v2：海報（道具）照樣佔滿畫面，印留言的那一塊只有 860 × 400（海報上的右上方），字 40～60 px
 * （海報在畫面上大約是原尺寸，所以海報上的字級 ≈ 螢幕字級）。路線圖本身（兩條線、列車、站）是主視覺。
 */
const MSG = { x: 720, y: 160, w: 860, h: 400 };
const LYR = { x: 650, y: 716, w: 1080 };
const LYR_BIG = { x: 700, y: 520, w: 1000 };
const FAM_MSG = F.ming(700);
const FAM_LYR = F.hei(700);

/** 把海報拍成牆上的一張海報：單應矩陣反算海報座標、景深、鋁框、磁磚牆、玻璃反光。 */
const STAGE = () => new FSPass(/* glsl */ `
  uniform sampler2D tex; uniform mat3 Hinv; uniform vec3 zc; uniform float zf, dof, kin;
  uniform vec2 refl; // 背後開過去的列車映在海報玻璃上：車窗的位移（海報寬的倍數）、亮度
  const vec2 CS = vec2(${W}.0, ${H}.0);
  vec3 samp(vec2 st, float r) {
    vec2 uv = vec2(st.x, 1.0 - st.y);
    vec3 c = textureLod(tex, uv, 0.0).rgb;
    if (r < 0.35) return c;
    vec2 k = r / CS;
    vec3 acc = c;
    for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398 + 0.39; acc += textureLod(tex, uv + vec2(cos(a), sin(a)) * k, 0.0).rgb; }
    return acc / 9.0;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 q = Hinv * vec3(p, 1.0);
    vec2 st = q.xy / q.z;
    vec2 c = st * CS;
    float z = dot(zc, vec3(st, 1.0));
    float blur = dof * abs(z - zf) / 100.0;
    // 海報在 0..CS；鋁框 22 px；再外面是牆
    vec2 dd = max(-c, c - CS);
    float out_ = max(dd.x, dd.y);
    vec3 col;
    if (out_ < 0.0) {
      col = samp(clamp(st, 0.0, 1.0), blur);
      // 紙的纖維（很淡）＋玻璃：一道斜的寬反光、上緣亮一點
      col *= 0.97 + 0.03 * snoise(c / 3.0) + 0.02 * snoise(c / 40.0);
      col *= 1.0 - 0.06 * smoothstep(0.38, 0.72, length((st - 0.5) * vec2(1.0, 0.8)));
      float sheen = exp(-pow((st.x * 0.8 - st.y * 0.5 - 0.18) / 0.08, 2.0));
      col += C_BONE * 0.035 * sheen;
      // 列車進站：一排亮著的車窗倒影從玻璃上滑過去（很淡，在海報的下半）
      if (refl.y > 0.0) {
        float wx = fract(st.x * 7.0 - refl.x * 7.0), wy = st.y;
        float win = smoothstep(0.08, 0.12, wx) * (1.0 - smoothstep(0.7, 0.74, wx)) * smoothstep(0.5, 0.53, wy) * (1.0 - smoothstep(0.66, 0.69, wy));
        float band = step(refl.x - 1.1, st.x - 0.0) * step(st.x, refl.x);
        col += (C_BONE * 0.035 + C_EMBER * 0.015) * win * band * refl.y;
      }
    } else if (out_ < 22.0) {
      // 鋁框：上、左亮，下、右暗，內緣一條細陰影
      float k = out_ / 22.0;
      vec3 al = mix(C_BONE * 0.72, C_ASH * 0.7, k);
      al *= (dd.y > dd.x ? (c.y < 0.0 ? 1.08 : 0.8) : (c.x < 0.0 ? 1.0 : 0.86));
      al *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 3.0, out_));
      col = al;
    } else {
      // 白磁磚牆（15 × 15 cm，海報座標裡約 150 px 一塊）：磚縫、每塊亮度差一點、海報框下緣的影子
      vec2 tc = (c + vec2(37.0, 11.0)) / 150.0;
      vec2 f = abs(fract(tc) - 0.5);
      float aa = fwidth(tc.x) * 1.5 + blur / 150.0;
      float grout = 1.0 - smoothstep(0.485 - aa, 0.485 + aa, max(f.x, f.y));
      float tint = 0.94 + 0.05 * hash12(floor(tc));
      vec3 tile = mix(C_BONE, C_PAPER, 0.55) * 0.8 * tint;
      tile = mix(tile, mix(C_ASH, C_SEPIA, 0.3) * 0.55, (1.0 - grout) * 0.7);
      // 磁磚的釉面：一道很淡的反光
      tile += C_BONE * 0.03 * exp(-pow((st.x * 0.7 + st.y * 0.4 - 0.9) / 0.15, 2.0));
      // 海報框投在牆上的影子（光從左上來，影子在右下）
      vec2 sd = max(-(c - vec2(18.0, 24.0)), (c - vec2(18.0, 24.0)) - CS);
      float so = max(sd.x, sd.y);
      tile *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 60.0, so));
      col = tile;
    }
    // 燈：上方的月台燈照在牆上，往下暗一點
    col *= 0.92 + 0.1 * (1.0 - clamp(p.y / ${H}.0, 0.0, 1.0));
    fragColor = vec4(col * kin, 1.0);
  }`, { tex: { value: null }, Hinv: { value: new THREE.Matrix3() }, zc: { value: new THREE.Vector3() }, zf: { value: 0 }, dof: { value: 0 }, kin: { value: 1 }, refl: { value: new THREE.Vector2(0, 0) } });

/** 單位正方形 (s,t) → 四邊形（畫面 px）的單應矩陣（Heckbert 的公式），row-major 9 個數。 */
function squareToQuad(p: V2[]): number[] {
  const [a, b, c, d] = p as [V2, V2, V2, V2];
  const sx = a.x - b.x + c.x - d.x, sy = a.y - b.y + c.y - d.y;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return [b.x - a.x, d.x - a.x, a.x, b.y - a.y, d.y - a.y, a.y, 0, 0, 1];
  const dx1 = b.x - c.x, dx2 = d.x - c.x, dy1 = b.y - c.y, dy2 = d.y - c.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [b.x - a.x + g * b.x, d.x - a.x + h * d.x, a.x, b.y - a.y + g * b.y, d.y - a.y + h * d.y, a.y, g, h, 1];
}

interface Cam { yaw: number; pitch: number; zoom: number; x: number; y: number }

export default class Metro extends Scene {
  stage = shared('metro.stage', STAGE);
  rt = shared('metro.rt', () => makeRT(W, H));
  /** 不會變的路線圖（init 畫一次）。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 會變的：列車、歌詞、印字的遮蓋、站點。 */
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 251 + (this.msg?.id ?? 0) * 7919) >>> 0;
  fit: FitResult | null = null;
  /** 留言每一排的範圍（印字的遮蓋用）。 */
  rows: { x: number; y: number; w: number; h: number; t: number }[] = [];
  sig = { x: 0, y: 0, w: 0, t: 0 };
  tMeet = 0; tFirst = 0; nMoves = 3;
  hasLyrics = false;
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 52, minSize: 48, maxWidth: LYR.w };
  lyrPos = LYR;
  beats: number[] = [];
  bars: number[] = [];
  pathA = { pts: LINE_A, L: polylineLengths(LINE_A) };
  pathB = { pts: LINE_B, L: polylineLengths(LINE_B) };
  private M = new THREE.Matrix3();

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T16_TEXT}${m?.text ?? ''}${sig}${song.title}${song.artist}${lyrics.linesIn(s - 1, e).map((l) => l.text).join('')}${COUPLE_ZH}${LINE_NAME_A}${LINE_NAME_B}轉乘站祝福終點站永遠開往本站可轉乘幸福捷運路線圖${ROUTE_TAG}`);
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    this.beats = winBeats(au, s - 2, e);
    this.bars = winBars(au, s, e);
    // 列車一拍一站：短窗格走兩站、長的走三站；會合落在第幾拍
    this.nMoves = e - s < 5.5 ? 2 : 3;
    this.tMeet = au.timeOfBeat(Math.round(au.beatAt(this.tFirst)) + this.nMoves);

    const c = this.base.ctx;
    this.drawMap(c);
    // ---- 留言（或沒有留言時的大字：純音樂時是新人的名字）
    const text = m ? m.text : this.hasLyrics ? '' : COUPLE_ZH;
    if (text) {
      const sigH = m ? 52 : 60;
      // 字級上限依字數（v2），照標點斷行；扣掉署名那一排
      const o = { min: STD.msgMin, max: msgMaxFor(text), lineHeight: 1.3, maxLines: 6 };
      const fit = fitClauses(c, text, FAM_MSG, MSG.w, MSG.h - sigH, o) ?? fitText(c, text, FAM_MSG, MSG.w, MSG.h - sigH, o);
      this.fit = fit;
      const blockH = fit.size + (fit.lines.length - 1) * fit.lineHeight + sigH;
      const top = MSG.y + Math.max(0, (MSG.h - blockH) / 2) + fit.size * 0.9;
      c.font = font(FAM_MSG, fit.size); c.fillStyle = rgba('sepia', 0.96); c.textBaseline = 'alphabetic';
      // 一行一行印出來：會合之後一行約 0.22 秒（最多一小節印完）
      const bar = au.timeOfBar(au.barAt(this.tMeet) + 1) - this.tMeet;
      const per = Math.min(0.22, (bar * 0.8) / fit.lines.length);
      fit.lines.forEach((ln, i) => {
        const y = top + i * fit.lineHeight;
        fillHearts(c, ln, MSG.x, y, fit.size);
        this.rows.push({ x: MSG.x - 8, y: y - fit.size * 1.0, w: c.measureText(ln).width + 16, h: fit.size * 1.28, t: this.tMeet + 0.08 + i * per });
      });
      const ss = sigV2(fit.size);
      const sy = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + ss * 1.3;
      if (m) {
        c.font = font(F.ming(400), ss); c.fillStyle = rgba('sepia', 0.78); c.textAlign = 'right';
        const sw = c.measureText(sig).width, sx = MSG.x + Math.max(fit.width, sw + 40);
        c.fillText(sig, sx, sy);
        c.textAlign = 'left';
        this.sig = { x: sx - sw - 8, y: sy - ss * 1.1, w: sw + 16, t: this.tMeet + 0.08 + fit.lines.length * per + 0.1 };
      } else {
        c.font = font(F.hei(500), 22); c.fillStyle = rgba('sepia', 0.66); c.letterSpacing = '2px';
        c.fillText(T16_INVITE, MSG.x, sy + 10);
        c.letterSpacing = '0px';
      }
      // 引線：從轉乘站拉上去，接到留言的左邊
      c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(T.x + 26, T.y - 30); c.lineTo(MSG.x - 30, MSG.y + MSG.h * 0.55); c.lineTo(MSG.x - 30, top - fit.size * 0.8); c.stroke();
    } else {
      // 沒有留言、有歌詞：歌詞放大印在上方，邀請一行小字
      c.font = font(F.hei(500), 22); c.fillStyle = rgba('sepia', 0.66); c.letterSpacing = '2px';
      c.fillText(T16_INVITE, LYR_BIG.x, LYR_BIG.y + 90);
      c.letterSpacing = '0px';
    }
    this.base.upload();

    if (m) this.lyrStyle = { family: FAM_LYR, size: lyricV2(this.fit?.size ?? null), minSize: STD.lyrMin, maxWidth: LYR.w };
    else if (this.hasLyrics) { this.lyrStyle = { family: FAM_LYR, size: lyricV2(null), minSize: STD.lyrMin, maxWidth: LYR_BIG.w, lineHeight: 1.18 }; this.lyrPos = LYR_BIG; }
  }

  /** 不會變的路線圖：紙、兩條線與車站、合併線、轉乘站、終點、線名與站名。 */
  private drawMap(c: CanvasRenderingContext2D) {
    // 紙是一個平的顏色（印字的遮蓋才蓋得乾淨）；紙邊的舊、纖維在拍的 shader 裡加
    c.fillStyle = rgba('paper'); c.fillRect(0, 0, W, H);
    c.lineCap = 'round'; c.lineJoin = 'round';
    const colA = rgba('blood'), colB = mixRgba('sepia', 'ash', 0.3);
    const stroke = (pts: V2[], col: string, w: number, off = 0) => {
      c.strokeStyle = col; c.lineWidth = w;
      c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y + off) : c.moveTo(p.x, p.y + off))); c.stroke();
    };
    stroke(LINE_A, colA, 14);
    stroke(LINE_B, colB, 14);
    // 合併線：兩色並排
    stroke([{ x: MERGE.x0, y: MERGE.y }, { x: MERGE.x1, y: MERGE.y }], colA, 9, -5.5);
    stroke([{ x: MERGE.x0, y: MERGE.y }, { x: MERGE.x1, y: MERGE.y }], colB, 9, 5.5);
    // 海報上緣一條細細的標題帶（真的路線圖海報都有），字很小
    c.fillStyle = mixRgba('sepia', 'ink', 0.2); c.fillRect(0, 0, W, 64);
    c.fillStyle = rgba('blood'); c.fillRect(0, 64, W, 5);
    c.font = font(F.hei(700), 22); c.letterSpacing = '6px'; c.fillStyle = rgba('paper', 0.92); c.textBaseline = 'alphabetic';
    c.fillText('幸福捷運　路線圖', 60, 42);
    c.font = font(F.mono(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('paper', 0.6); c.textAlign = 'right';
    c.fillText(ROUTE_TAG, W - 60, 40);
    c.letterSpacing = '0px'; c.textAlign = 'left';
    // 其他幾條線（淡淡的灰）：路線圖才像真的，也讓空的地方有東西；不標站名
    const other = rgba('ash', 0.35);
    stroke([{ x: 60, y: 640 }, { x: 300, y: 640 }, { x: 420, y: 520 }, { x: 640, y: 520 }], other, 8);
    stroke([{ x: 640, y: 1080 }, { x: 700, y: 1000 }, { x: 1150, y: 1000 }, { x: 1250, y: 900 }], other, 8);
    for (const q of [{ x: 180, y: 640 }, { x: 420, y: 520 }, { x: 900, y: 1000 }, { x: 1150, y: 1000 }]) {
      c.fillStyle = rgba('paper'); c.strokeStyle = other; c.lineWidth = 4; c.beginPath(); c.arc(q.x, q.y, 8, 0, TAU); c.fill(); c.stroke();
    }
    // 兩條線上的車站（白點、線色的邊）
    const stop = (p: V2, col: string, r = 11) => { c.fillStyle = rgba('paper'); c.strokeStyle = col; c.lineWidth = 5; c.beginPath(); c.arc(p.x, p.y, r, 0, TAU); c.fill(); c.stroke(); };
    for (const [path, col] of [[this.pathA, colA], [this.pathB, colB]] as const) {
      for (const f of STOPS.slice(0, -1)) { const p = pointAtLength(path.pts, path.L, f * path.L[path.L.length - 1]!); stop(p, col); }
    }
    // 終點站：雙圈
    c.fillStyle = rgba('paper'); c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 6;
    c.beginPath(); c.arc(MERGE.x1, MERGE.y, 20, 0, TAU); c.fill(); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.arc(MERGE.x1, MERGE.y, 10, 0, TAU); c.stroke();
    // 轉乘站：一顆長圓（兩條線都經過）
    c.fillStyle = rgba('paper'); c.strokeStyle = rgba('sepia', 0.95); c.lineWidth = 6;
    roundRect(c, T.x - 26, T.y - 40, 52, 80, 26); c.fill(); c.stroke();
    // 小字：線名（線頭）、轉乘站名、終點站名
    c.textBaseline = 'alphabetic';
    // 線名是新人的名字，長短不一定：超過 maxW 就縮字（字距跟著縮），不會伸到線的轉彎處
    const label = (txt: string, x: number, y: number, col: string, size = 22, align: CanvasTextAlign = 'left', maxW = 600) => {
      const px = fitPx(txt, F.hei(700), size, maxW, 3);
      c.font = font(F.hei(700), px); c.letterSpacing = `${(3 * px) / size}px`; c.fillStyle = col; c.textAlign = align; c.fillText(txt, x, y); c.letterSpacing = '0px'; c.textAlign = 'left';
    };
    label(LINE_NAME_A, 110, 272, colA, 22, 'left', 380);
    label(LINE_NAME_B, 110, 962, colB, 22, 'left', 380);
    label('轉乘站　祝福', T.x - 40, T.y + 84, rgba('sepia', 0.72), 20);
    label('終點站　永遠', MERGE.x1 + 12, MERGE.y + 58, rgba('sepia', 0.72), 20, 'right');
  }

  /** 第幾站（0 = 第一站、nMoves = 轉乘站）在 t 的位置：一拍一站，落在拍點上、稍微回彈。 */
  private stopAt(t: number) {
    const au = this.ctx.audio;
    const b0 = Math.round(au.beatAt(this.tFirst)), bi = au.beatAt(t) - b0;
    const k = Math.floor(bi), u = bi - k;
    // 開車：每一拍的前半拍停著、後半拍開到下一站（到站那一下落在下一個拍點）
    const move = u < 0.45 ? 0 : ease.outBack((u - 0.45) / 0.55, 1.2);
    const i = clamp(k + move, -1, this.nMoves);
    return i;
  }

  /** 兩條線上的列車（沿線的弧長）。 */
  private trainOn(path: { pts: V2[]; L: Float32Array }, i: number) {
    const n = this.nMoves;
    const f0 = STOPS[STOPS.length - 1 - n]!;
    const fi = i < 0 ? f0 * (1 + i * 0.5) : (() => { const a = Math.floor(i), u = i - a; const fa = STOPS[STOPS.length - 1 - n + a] ?? 1, fb = STOPS[STOPS.length - 1 - n + a + 1] ?? 1; return fa + (fb - fa) * u; })();
    const total = path.L[path.L.length - 1]!;
    return pointAtLength(path.pts, path.L, clamp(fi, 0, 1) * total);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const D = this.dyn; D.clear();
    const c = D.ctx;
    c.textBaseline = 'alphabetic';

    // ---- 留言還沒印到的地方蓋上紙色（一行一行印出來）
    for (const r of this.rows) {
      const k = ease.outCubic(prog(t, r.t, r.t + 0.2));
      if (k >= 1) continue;
      c.fillStyle = rgba('paper');
      c.fillRect(r.x + r.w * k, r.y, r.w * (1 - k) + 2, r.h);
    }
    if (this.msg && this.sig.w) {
      const k = ease.outCubic(prog(t, this.sig.t, this.sig.t + 0.2));
      if (k < 1) { c.fillStyle = rgba('paper'); c.fillRect(this.sig.x + this.sig.w * k, this.sig.y, this.sig.w * (1 - k) + 2, 56); }
    }

    // ---- 兩班車開往轉乘站（會合後消失，換合併的那一班）
    const si = this.stopAt(t);
    const trainCol = [rgba('blood'), mixRgba('sepia', 'ash', 0.3)];
    if (t < this.tMeet + 0.05) {
      [this.pathA, this.pathB].forEach((path, j) => {
        const p = this.trainOn(path, si);
        this.train(c, p.x, p.y, p.angle, trainCol[j]!);
      });
    }
    // 會合：轉乘站亮一下、一圈往外擴
    const meet = pulse(t, this.tMeet, 0.3);
    if (t >= this.tMeet && t < this.tMeet + 0.8) {
      const u = (t - this.tMeet) / 0.8;
      c.strokeStyle = rgba('blood', 0.7 * (1 - u)); c.lineWidth = 4;
      roundRect(c, T.x - 26 - 50 * u, T.y - 40 - 50 * u, 52 + 100 * u, 80 + 100 * u, 26 + 50 * u); c.stroke();
    }
    if (meet > 0.02) { c.fillStyle = rgba('blood', 0.5 * meet); roundRect(c, T.x - 20, T.y - 34, 40, 68, 20); c.fill(); }
    // 會合之後，轉乘站是「您在這裡」：每一拍一圈細細的波紋往外擴（像路線圖上會閃的現在位置）
    if (t > this.tMeet + 0.8) {
      const bi = Math.floor(au.beatAt(t) + 1e-4), tb = au.timeOfBeat(bi), k2 = clamp((t - tb) / 0.6);
      c.strokeStyle = rgba('blood', 0.55 * (1 - k2)); c.lineWidth = 3;
      roundRect(c, T.x - 30 - 26 * k2, T.y - 44 - 26 * k2, 60 + 52 * k2, 88 + 52 * k2, 30 + 26 * k2); c.stroke();
    }

    // ---- 合併線上的歌詞（站名）與列車
    let trainX = T.x;
    if (this.hasLyrics) {
      const ly = lyricAt(lyrics, t, 1.2, 0.45);
      if (ly) {
        const st = { ...this.lyrStyle, ...paperInk() };
        const lay = posterSub(c, ly.line, st, layoutLyric(c, ly.line, st));
        const big = this.lyrPos === LYR_BIG;
        let y0 = big ? this.lyrPos.y - (lay.rows.length - 1) * lay.size * 1.14 * 0.5 : this.lyrPos.y - (lay.rows.length - 1) * lay.size * (st.lineHeight ?? 1.18);
        // 韓文原文副行在中文下面：下面那行邀請是畫好的（LYR_BIG.y + 90），原文最後一排的基線最低到它上面 44 px（原文放大到 38 之後要多留一點），放不下整組往上移
        if (big && lay.sub) y0 = Math.min(y0, LYR_BIG.y + 46 - (lay.height - lay.size));
        // 雙語：有留言時歌詞排在合併線上方，原文接在中文下面會壓到線與站點：整組往上，原文最後一排的基線放在原本中文的位置
        if (!big && lay.sub) y0 = LYR.y - (lay.height - lay.size);
        c.save(); c.translate(this.lyrPos.x, y0);
        drawLyric(c, ly.line, t, st, lay, ly.k);
        c.restore();
        trainX = this.stations(c, ly.line, lay, t, ly.k, big);
      } else trainX = this.lastTrainX(t);
    } else {
      // 純音樂：線上小小的歌名，列車一拍一站往前開
      c.font = font(F.serif(400, true), 28); c.fillStyle = rgba('sepia', 0.6);
      c.fillText(`♪  ${song.title}${song.artist ? '  —  ' + song.artist : ''}`, LYR.x, LYR.y);
      const nb = Math.max(0, au.beatAt(t) - au.beatAt(this.tMeet));
      const k = Math.floor(nb), u = nb - k;
      const step = (MERGE.x1 - MERGE.x0 - 60) / 8;
      const pos = (k % 8) + (u < 0.45 ? 0 : ease.outBack((u - 0.45) / 0.55, 1.2));
      trainX = t < this.tMeet ? T.x : MERGE.x0 + 30 + step * pos;
      for (let i = 1; i < 8; i++) this.dot(c, MERGE.x0 + 30 + step * i, MERGE.y, pos >= i ? 1 : 0);
    }
    if (t >= this.tMeet - 0.02) this.train(c, trainX, MERGE.y, 0, rgba('blood'), true);
    D.upload();

    // ---- 合成到離屏圖，再拍成牆上的海報
    clearRT(renderer, this.rt, LIN.paper);
    comp.draw(renderer, this.base.texture, this.rt);
    comp.draw(renderer, D.texture, this.rt);
    const cam = this.cam(t);
    this.shoot(cam);
    this.stage.u.kin!.value = prog(t, s, s + 0.15);
    // 每兩小節一班列車開進月台（在鏡頭後面）：車窗的倒影在一小節內從左到右滑過海報的玻璃
    const rf = this.stage.u.refl!.value as THREE.Vector2;
    rf.set(0, 0);
    for (let i = 1; i < this.bars.length; i += 2) {
      const b0 = this.bars[i]!, dur = (this.bars[i + 1] ?? b0 + 2) - b0;
      if (t < b0 || t > b0 + dur) continue;
      const k = (t - b0) / dur;
      rf.set(-0.1 + 2.2 * ease.inOutQuad(k), Math.sin(Math.PI * k));
    }
    this.stage.render(renderer, out);
    return { paper: 1, bloom: 0.35, vignette: 0.3, halation: 0.08, grain: 0.045 };
  }

  /** 鏡頭：切進來時從比較斜的角度在第一拍落定，之後沿著牆慢慢移、慢慢推近。 */
  private cam(t: number): Cam {
    const s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tFirst + 0.1)));
    const p = ease.inOutQuad(clamp((t - s) / (e - s)));
    return { yaw: -0.2 * (1 - land) - 0.13 + 0.07 * p, pitch: 0.035, zoom: 0.84 + 0.05 * p + 0.03 * land, x: 10 - 20 * p, y: 6 };
  }

  /** 把海報的四個角投到畫面、算單應矩陣（跟 _t8 的舞台同一套）與深度（景深用）。 */
  private shoot(cam: Cam) {
    const fl = 1500, Dd = fl / cam.zoom;
    const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(cam.pitch, cam.yaw, 0, 'YXZ'));
    const v = new THREE.Vector3();
    const proj = (u: number, w: number) => {
      v.set(u - W / 2, H / 2 - w, 0).applyMatrix4(R);
      const sc = fl / (Dd - v.z);
      return { x: W / 2 + v.x * sc + cam.x, y: H / 2 - v.y * sc + cam.y, z: v.z };
    };
    const P = [proj(0, 0), proj(W, 0), proj(W, H), proj(0, H)];
    const m = squareToQuad(P);
    this.M.set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!);
    const u = this.stage.u;
    (u.Hinv!.value as THREE.Matrix3).copy(this.M.invert());
    (u.zc!.value as THREE.Vector3).set(P[1]!.z - P[0]!.z, P[3]!.z - P[0]!.z, P[0]!.z);
    // 對焦在留言（沒有留言：大歌詞）
    u.zf!.value = proj(MSG.x + MSG.w * 0.4, MSG.y + MSG.h * 0.5).z;
    u.dof!.value = 1.1;
    u.tex!.value = this.rt.texture;
  }

  /** 一班列車：圓角的小車廂（線色、紙色的邊），合併的那一班是兩節（兩色）。 */
  private train(c: CanvasRenderingContext2D, x: number, y: number, ang: number, col: string, merged = false) {
    c.save();
    c.translate(x, y); c.rotate(ang);
    c.lineWidth = 4; c.strokeStyle = rgba('paper');
    if (merged) {
      c.fillStyle = rgba('blood'); roundRect(c, -30, -15, 30, 30, 8); c.fill(); c.stroke();
      c.fillStyle = mixRgba('sepia', 'ash', 0.3); roundRect(c, 2, -15, 30, 30, 8); c.fill(); c.stroke();
    } else {
      c.fillStyle = col; roundRect(c, -20, -13, 40, 26, 9); c.fill(); c.stroke();
    }
    c.restore();
  }

  /** 合併線上的一個站點：沒經過是白點，經過了塗滿線色。 */
  private dot(c: CanvasRenderingContext2D, x: number, y: number, k: number, a = 1) {
    c.globalAlpha = a;
    c.fillStyle = k > 0.5 ? rgba('blood') : rgba('paper'); c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 4;
    c.beginPath(); c.arc(x, y, 12, 0, TAU); c.fill(); c.stroke();
    c.globalAlpha = 1;
  }

  /**
   * 歌詞的站點：每個詞組（空白後的第一個字、英文每個字）底下一個站。回傳列車的 x：唱到哪、車開到哪。
   * 大歌詞（沒有留言）時，字在上方，站點照比例排在合併線上。
   */
  private stations(c: CanvasRenderingContext2D, line: Line, lay: LyricLayout, t: number, a: number, big: boolean): number {
    const x0 = this.lyrPos.x;
    const map = (x: number) => (big ? MERGE.x0 + 40 + ((x - x0) / Math.max(1, this.lyrPos.w)) * (MERGE.x1 - MERGE.x0 - 80) : x);
    let head = map(x0 + lay.words[0]!.x);
    for (let i = 0; i < lay.words.length; i++) {
      const pw = lay.words[i]!;
      const pr = Lyrics.wordProgress(pw.word, t);
      const first = i === 0 || /\s$/.test(line.text.slice(0, pw.word.o)) || /[A-Za-z]/.test(pw.word.w);
      if (first) this.dot(c, map(x0 + pw.x + pw.w * 0.5), MERGE.y, pr > 0 ? 1 : 0, a);
      if (pr > 0) head = map(x0 + pw.x + pw.w * clamp(pr));
    }
    // 句子要開始之前：列車從上一句的終點倒回這一句的起點（0.45 秒）
    const lead = clamp((t - (line.start - 0.45)) / 0.45);
    if (t < line.start) return this.lastTrainX(line.start - 0.46) + (map(x0 + lay.words[0]!.x) - this.lastTrainX(line.start - 0.46)) * ease.inOutCubic(lead);
    return head;
  }

  /** 兩句之間：列車停在上一句唱到的地方。 */
  private lastTrainX(t: number): number {
    const { lyrics } = this.ctx;
    const last = lyrics.lastLine(t);
    if (!last || t < this.tMeet) return T.x;
    const st = { ...this.lyrStyle, ...paperInk() };
    const lay = posterSub(this.dyn.ctx, last, st, layoutLyric(this.dyn.ctx, last, st));
    const big = this.lyrPos === LYR_BIG;
    const x0 = this.lyrPos.x;
    const lw = lay.words[lay.words.length - 1]!;
    const x = x0 + lw.x + lw.w;
    return big ? MERGE.x0 + 40 + ((x - x0) / Math.max(1, this.lyrPos.w)) * (MERGE.x1 - MERGE.x0 - 80) : x;
  }
}

/**
 * 原文副行（雙語）：海報斜斜地貼在牆上、鏡頭又離得有點遠，照海報 px 排的 32 px 原文在畫面上只剩 26。
 * 原文至少排 SUB_MIN 海報 px、不再縮（太長就折行）；中文不動。
 */
const SUB_MIN = 38;
function posterSub(c: CanvasRenderingContext2D, line: Line, st: LyricStyle, lay: LyricLayout): LyricLayout {
  const sub = lyricSubOf(line);
  if (!sub || !lay.sub) return lay;
  const size = Math.max(SUB_MIN, subSizeFor(lay.size));
  const sl = layoutLyric(c, sub, { ...subStyleFor(st, lay.size), size, minSize: size });
  const dy = lay.sub.dy - subGap(lay.size, lay.sub.lay.size) + subGap(lay.size, sl.size);
  return { ...lay, sub: { lay: sl, dy }, height: dy + (sl.height - sl.size) + lay.size };
}

/** 亮版面的跟唱顏色：正在唱用訊號色的暗部（香檳、鼠尾草的訊號色在紙上太淡）、唱完墨色、還沒唱三成墨色。 */
const paperInk = () => ({ active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28) });

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** 印在紙上的字：♥ 換成我們自己畫的愛心（點綴色）。 */
function fillHearts(c: CanvasRenderingContext2D, ln: string, x: number, y: number, size: number) {
  let cx = x;
  const base = c.fillStyle;
  for (const part of ln.split(/(♥)/)) {
    if (!part) continue;
    const w = c.measureText(part).width;
    if (part === '♥') drawHeart(c, cx + w / 2, y - size * 0.36, Math.min(w, size) * 0.86, rgba('rose'));
    else { c.fillStyle = base; c.fillText(part, cx, y); }
    cx += w;
  }
}

