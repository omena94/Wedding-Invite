// 等高線地圖（亮）：一張登山用的等高線地形圖攤在桌上，鏡頭從斜上方看著它。
//  - 地圖：一圈一圈的等高線（每五條一條加粗的計曲線）、很淡的山影、方格網、摺過的痕；山頂在右上方，旁邊印著小小的山名與標高。
//  - 路線：一條虛線（訊號色的暗部）從右下角的登山口出發，「一拍走一段」地往山頂延伸（每一拍猛地畫出一段、停住），
//    線頭是一個小圓點，每一拍脈動一下；窗格最後一小節前走到山頂，山頂的小旗子「啪」地立起來、晃兩下。
//  - 主打留言是有人用筆寫在地圖左邊的註記（畫面的焦點）：第一拍起一個字一個字寫出來，署名在最後一行下面，
//    一道手畫的箭頭從註記指到山頂的旗子。註記後面的等高線淡掉，字才讀得清楚。
//    留言標準 v2：註記的字 40～60（字級上限照字數），淡掉的那一塊 ≤ 760×360，整張地圖（等高線、路線、山頂）是主視覺。
//  - 每一拍線頭往上走一段時，線頭所在高度的那一條等高線從線頭往兩邊「描」一圈（訊號色的暗部，慢慢退掉），
//    線頭旁邊的小字海拔跟著跳；窗格裡一直有東西照拍子在動。
//  - 歌詞是沿途的地名：左下方的地名標籤（字距拉開的無襯線字，照跟唱規則逐字變色），一條點線拉到路線的線頭。
//  - 沒有留言：歌詞放大成地圖上的大地名（焦點），左下角一行小字邀請。純音樂：地名是歌名。
// 手法：地圖（等高線、山影、方格、摺痕）在一個 shader 裡算（PlaneCam：地圖是空間裡的平面，鏡頭會推、會搖）；
// 註記的字是 init() 畫好的資料貼圖（_t25 glyphMask，依序寫出）；路線、旗子、地名是每格重畫的一張 Canvas（地圖座標），
// 小字與箭頭是 init 畫一次的另一張。兩張都在 shader 裡照鏡頭取樣，跟著透視走。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, pulse, polylineLengths, pointAtLength, type V2 } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, drawHeart, DATE, type LyricStyle } from './_motifs';
import { V2 as SZ, lyricV2 } from './_v2';
import { PlaneCam, camUniforms, CAM_GLSL } from './_t14';
import {
  T25_TEXT, T25_INVITE, sigOf, winBars, winBeats, stagger, layMsgV2, msgGlyphs, glyphMask, paperLyric, MASK_GLSL,
  type GlyphMask, type MsgLay, type Rect,
} from './_t25';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'journey', paper: true, energy: [0.1, 0.8], bars: [4, 8] };

/**
 * 山頂、註記（留言）的範圍、地名（歌詞）的位置。
 * 留言標準 v2：註記寫在地圖左邊（字的範圍 700×300，淡掉的那一塊再大 30 px 一圈），右半邊是山與路線。
 */
const SUMMIT = { x: 1500, y: 300 };
const NOTE = { x: 176, y: 236, w: 700, h: 300 };
const LYR = { x: 176, y: 820, w: 1000 };
const LYR_SOLO = { x: 176, y: 420, w: 1100 };
/** 路線（地圖座標）：從右下角的登山口繞上山頂。 */
const ROUTE: V2[] = [
  { x: 1150, y: 1010 }, { x: 1240, y: 930 }, { x: 1150, y: 862 }, { x: 1250, y: 790 }, { x: 1400, y: 760 },
  { x: 1520, y: 700 }, { x: 1440, y: 628 }, { x: 1560, y: 560 }, { x: 1620, y: 470 }, { x: 1530, y: 410 }, { x: 1500, y: 322 },
];
const FAM_MSG = F.hand(700);
const FAM_LYR = F.archivo(100, 800);
/**
 * 山頂的標高：婚禮那一年（冷面的彩蛋，走到山頂就是結婚那年）；還沒定日期就用 1314 m（一生一世）。
 * 登山口的海拔：線頭旁的小字從這裡一拍一拍往上跳到山頂。
 */
const ALT0 = 380, ALT1 = DATE?.y ?? 1314;
const PEAK = `幸福山　▲ ${ALT1} m`;
const LEGEND = '等高距 20 m　·　計曲線 100 m　·　比例尺 1 : 25,000';

const BG = () => new FSPass(/* glsl */ `
  uniform float t;
  uniform sampler2D ov; uniform sampler2D st; uniform sampler2D mm; uniform vec4 mmR; uniform float shown; uniform float hasMsg;
  uniform vec4 clean;
  uniform vec2 head; uniform float trace; uniform float traceK; // 線頭（地圖座標）、描等高線走到多遠、亮度
  ${CAM_GLSL}
  ${MASK_GLSL}
  // 地形：山頂一座、左邊一座矮一點的山、一條往左下延伸的稜線、fbm 起伏
  float height(vec2 P) {
    vec2 s = P - vec2(${SUMMIT.x}.0, ${SUMMIT.y}.0);
    float h = 1700.0 * exp(-dot(s, s) / (2.0 * 460.0 * 460.0));
    vec2 s2 = P - vec2(420.0, 330.0);
    h += 700.0 * exp(-dot(s2, s2) / (2.0 * 330.0 * 330.0));
    vec2 r = P - vec2(900.0, 760.0);
    h += 420.0 * exp(-pow(dot(r, normalize(vec2(1.0, 0.55))), 2.0) / (2.0 * 900.0 * 900.0) - pow(dot(r, normalize(vec2(-0.55, 1.0))), 2.0) / (2.0 * 150.0 * 150.0));
    h += 150.0 * fbm(P / 560.0 + 4.0, 4) + 40.0 * fbm(P / 160.0 + 9.0, 2);
    return h;
  }
  void main() {
    vec2 sp = SP();
    vec3 hit = pcHit(sp, 0.0);
    vec2 P = hit.xy;
    // ---- 紙
    vec3 paper = C_PAPER * (0.96 + 0.04 * fbm(P / 180.0, 3)) ;
    // ---- 等高線（每 20 m 一條、每 100 m 一條粗的）
    float h = height(P);
    float ci = 20.0;
    float v = h / ci;
    float fw = fwidth(v);
    float d = abs(fract(v + 0.5) - 0.5) / max(fw, 1e-4);
    float line = 1.0 - smoothstep(0.4, 1.3, d);
    float vi = h / (ci * 5.0);
    float di = abs(fract(vi + 0.5) - 0.5) / max(fwidth(vi), 1e-4);
    float idx = 1.0 - smoothstep(0.9, 2.1, di);
    // 註記與地名後面的地圖淡掉（字要讀得清楚）
    float dq = sdBox(P - clean.xy, clean.zw * 0.5);
    float quiet = 1.0 - 0.72 * (1.0 - smoothstep(-30.0, 90.0, dq));
    float cl = max(line * 0.15, idx * 0.32) * quiet;
    // 線頭所在高度的那一條等高線：從線頭往外描（trace＝描到的半徑），描過的地方亮一下再慢慢退回一般的線
    float hq = floor(height(head) / ci + 0.5);
    float dc = abs(v - hq) / max(fw, 1e-4);
    float cur = (1.0 - smoothstep(0.6, 1.8, dc)) * traceK * quiet;
    float rr = length(P - head);
    cur *= smoothstep(trace + 30.0, trace - 30.0, rr) * (0.45 + 0.55 * exp(-max(0.0, trace - rr) / 260.0));
    // 山影：西北來的光（很淡）
    vec2 gr = vec2(dFdx(h), dFdy(h)) / max(length(vec2(dFdx(P.x), dFdy(P.x))), 1e-3);
    float shade = clamp(dot(normalize(vec3(-gr * 0.9, 1.0)), normalize(vec3(-0.6, -0.6, 0.7))), 0.0, 1.0);
    vec3 col = paper * (0.93 + 0.1 * shade * quiet);
    col = mix(col, C_SEPIA, cl * 0.75);
    col = mix(col, C_BLOOD, cur * 0.85);
    // 方格網（每 240 px 一條，很淡）
    vec2 gq = abs(fract(P / 240.0 + 0.5) - 0.5) * 240.0;
    float grid = 1.0 - smoothstep(0.3, 1.2, min(gq.x, gq.y) / max(fwidth(P.x), 1e-3));
    col = mix(col, C_SEPIA, grid * 0.07 * quiet);
    // 摺痕：地圖對摺兩次（一條直的、一條橫的），摺線一邊亮一邊暗
    float fx = P.x - 980.0, fy = P.y - 560.0;
    col *= 1.0 + 0.035 * sign(fx) * exp(-abs(fx) / 10.0) - 0.03 * exp(-abs(fx) / 3.0);
    col *= 1.0 + 0.03 * sign(fy) * exp(-abs(fy) / 10.0) - 0.025 * exp(-abs(fy) / 3.0);
    // ---- 固定的小字與箭頭（init 畫好）、每格的路線與地名
    vec2 uv = pageUV(P);
    vec4 sc = fastLayer(texture(st, uv));
    col = col * (1.0 - sc.a) + sc.rgb;
    // ---- 註記（手寫的留言，依序寫出來；剛寫的墨帶一點訊號色的暗部）
    if (hasMsg > 0.5) {
      vec4 mk = maskAt(mm, mmR, P);
      float gi = floor(mk.g * 255.0 + 0.5);
      float rv = clamp((shown - gi - mk.b) * 5.0, 0.0, 1.0);
      float wet = clamp(1.0 - (shown - gi) / 8.0, 0.0, 1.0);
      vec3 ink = mix(C_SEPIA, C_BLOOD, 0.25 + 0.45 * wet);
      if (mk.r > 0.9) ink = C_ROSE * 0.9;
      col = mix(col, ink, mk.a * rv * 0.96);
    }
    vec4 oc = fastLayer(texture(ov, uv));
    col = col * (1.0 - oc.a) + oc.rgb;
    // 紙以外（鏡頭斜的時候看得到一點桌面）
    float out0 = max(max(-P.x - 60.0, P.x - 1980.0), max(-P.y - 60.0, P.y - 1140.0));
    col = mix(col, C_SEPIA * 0.35, smoothstep(0.0, 2.0, out0));
    // 紙面的明暗：左上亮、右下暗一點（桌燈）
    col *= 0.9 + 0.12 * (1.0 - smoothstep(0.0, 1700.0, length(sp - vec2(500.0, 300.0))));
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, ov: { value: null }, st: { value: null }, mm: { value: null }, mmR: { value: new THREE.Vector4(0, 0, 1, 1) },
  shown: { value: 0 }, hasMsg: { value: 0 }, clean: { value: new THREE.Vector4(-9999, -9999, 1, 1) },
  head: { value: new THREE.Vector2() }, trace: { value: 0 }, traceK: { value: 0 },
  ...camUniforms(),
});

export default class Topo extends Scene {
  bg = shared('topo.bg', BG);
  /** 每格重畫：路線、線頭、旗子、地名（地圖座標）。 */
  ov = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** init 畫一次：山名、圖例、箭頭。 */
  st = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 7919) >>> 0;
  mm: GlyphMask | null = null;
  lay: MsgLay | null = null;
  times: number[] = [];
  beats: number[] = [];
  tArrive = 0;
  tFirst = 0;
  tSettle = 0;
  lens = polylineLengths(ROUTE);
  mmRect: Rect = [0, 0, 1, 1];
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 56, minSize: 48, maxWidth: LYR.w, tracking: 6, ...paperLyric() };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 0.5, e + 0.5);
    await loadText(`${T25_TEXT}${PEAK}${LEGEND}${m?.text ?? ''}${m ? sigOf(m) : ''}${lines.map((l) => l.text).join('')}${song.title}`);
    const bar = au.timeOfBar(au.barAt(s) + 1) - au.timeOfBar(au.barAt(s));
    this.beats = winBeats(au, s + 0.1, e);
    this.tFirst = this.beats[0] ?? s + 0.2;
    // 走到山頂：最後一小節的開頭（窗格短就倒數第二拍）
    const bars = winBars(au, s, e);
    const lastBar = bars.filter((b) => b <= e - bar * 0.9).pop();
    this.tArrive = lastBar !== undefined && lastBar > this.tFirst + bar ? lastBar : (this.beats[this.beats.length - 2] ?? e - 0.5);
    this.tSettle = bars.find((b) => b >= this.tFirst + 0.01) ?? this.tFirst + bar;

    // ---- 註記（留言）
    const c = document.createElement('canvas').getContext('2d')!;
    if (m) {
      // 地圖在畫面上約 1:1（鏡頭落定後只推近 3%），字級直接照螢幕 px
      const lay = layMsgV2(c, m.text, sigOf(m), FAM_MSG, NOTE, { lineHeight: 1.3, maxLines: 5, align: 'left' });
      this.lay = lay;
      // 手寫：每一行稍微往右下斜一點
      const items = msgGlyphs(this.lay).map((g) => ({ ...g, y: g.y + (g.x - NOTE.x) * 0.012, rot: 0.012 }));
      const rect: Rect = [NOTE.x - 40, NOTE.y - 40, NOTE.w + 80, NOTE.h + 120];
      this.mm = this.track(glyphMask(items, rect, 1, 2));
      this.mmRect = rect;
      const maxDur = Math.max(0.8, Math.min(1.7 * bar, 0.45 * (e - this.tFirst)));
      this.times = stagger(au, this.tFirst, items.length, maxDur);
      this.lyrStyle = { ...this.lyrStyle, size: lyricV2(lay.screen), minSize: SZ.lyrMin, maxWidth: LYR.w };
    } else {
      this.lyrStyle = { ...this.lyrStyle, size: lyricV2(null), minSize: SZ.lyrMin, maxWidth: LYR_SOLO.w, tracking: 8 };
    }

    // ---- 固定的小字：山名與標高、圖例、（有留言）註記指到旗子的箭頭、（沒有留言）邀請
    const g = this.st.ctx;
    this.st.clear();
    g.font = font(F.hei(500), 20); g.letterSpacing = '3px'; g.fillStyle = rgba('sepia', 0.62);
    g.fillText(PEAK, SUMMIT.x + 34, SUMMIT.y + 40);
    g.font = font(F.mono(500), 17); g.letterSpacing = '2px'; g.fillStyle = rgba('sepia', 0.62);
    g.fillText(LEGEND, LYR.x, 958);
    // 比例尺
    g.fillStyle = rgba('sepia', 0.55);
    for (let i = 0; i < 4; i++) { if (i % 2 === 0) g.fillRect(LYR.x + i * 60, 920, 60, 6); }
    g.strokeStyle = rgba('sepia', 0.55); g.lineWidth = 1; g.strokeRect(LYR.x + 0.5, 920.5, 240, 6);
    g.letterSpacing = '0px';
    if (m && this.lay) {
      // 手畫的箭頭：從註記的右上方彎彎地指到旗子
      const [bx, by, bw] = this.lay.box;
      const a = { x: Math.min(bx + bw + 30, NOTE.x + NOTE.w + 40), y: by + 30 }, b = { x: SUMMIT.x - 40, y: SUMMIT.y - 44 };
      g.strokeStyle = rgba('blood', 0.7); g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(a.x, a.y);
      g.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 90, b.x, b.y);
      g.stroke();
      const ang = Math.atan2(b.y - (Math.min(a.y, b.y) - 90), b.x - (a.x + b.x) / 2);
      g.beginPath();
      g.moveTo(b.x - 18 * Math.cos(ang - 0.45), b.y - 18 * Math.sin(ang - 0.45)); g.lineTo(b.x, b.y);
      g.lineTo(b.x - 18 * Math.cos(ang + 0.45), b.y - 18 * Math.sin(ang + 0.45));
      g.stroke();
    } else {
      g.font = font(F.hei(500), 22); g.letterSpacing = '3px'; g.fillStyle = rgba('sepia', 0.6);
      g.fillText(T25_INVITE, LYR.x, 880);
      g.letterSpacing = '0px';
    }
    this.st.upload();
  }

  /** 路線在 t 走到哪（長度）：一拍一段，每段在拍點上猛地畫出來、停住。 */
  private routeAt(t: number) {
    const L = this.lens[this.lens.length - 1]!;
    const bs = this.beats.filter((b) => b >= this.tFirst - 1e-3 && b <= this.tArrive + 1e-3);
    const n = Math.max(1, bs.length - 1);
    let sl = 0;
    for (let i = 0; i < bs.length; i++) {
      if (t < bs[i]!) break;
      const k = ease.outExpo(clamp((t - bs[i]!) / 0.22));
      sl = L * ((i - 1 + k) / n);
    }
    return clamp(sl, 0, L);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    u.t!.value = t;
    // ---- 鏡頭：切進來斜斜的，第一個小節線前落定；之後很慢地推近、往山頂那邊轉一點
    const kin = ease.inOutCubic(prog(t, s, Math.max(s + 0.4, this.tSettle)));
    const drift = ease.inOutQuad(prog(t, this.tSettle, e));
    this.cam.set({
      // 切進來時離遠一點、斜一點（整張地圖都在畫面裡，字不會被切到），落定後很慢地推近
      tx: lerp(1000, 960, kin) + 20 * drift, ty: lerp(600, 540, kin) - 10 * drift,
      dist: 1600 * (lerp(1.14, 1, kin) - 0.03 * drift),
      pitch: lerp(0.26, 0.05, kin), yaw: lerp(-0.1, -0.03, kin) - 0.02 * drift, roll: lerp(0.03, 0.004, kin), level: 0.6,
    });
    this.cam.apply(u);

    // ---- 每格重畫：路線、線頭、旗子、地名
    const L = this.ov; L.clear();
    const c = L.ctx;
    const sl = this.routeAt(t);
    const full = this.lens[this.lens.length - 1]!;
    // 路線：虛線，已經走過的；前面還沒走的用很淡的點線
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.setLineDash([2, 12]); c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 3;
    c.beginPath(); ROUTE.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    const head = pointAtLength(ROUTE, this.lens, sl);
    if (sl > 0) {
      c.setLineDash([18, 10]); c.strokeStyle = rgba('blood', 0.92); c.lineWidth = 7;
      c.beginPath();
      c.moveTo(ROUTE[0]!.x, ROUTE[0]!.y);
      for (let i = 1; i < ROUTE.length && this.lens[i]! < sl; i++) c.lineTo(ROUTE[i]!.x, ROUTE[i]!.y);
      c.lineTo(head.x, head.y);
      c.stroke();
    }
    c.setLineDash([]);
    // 線頭：一個小圓點，每一拍脈動一圈
    const lb = this.beats.filter((b) => b <= t).pop() ?? -9;
    const pr = pulse(t, lb, 0.18);
    c.fillStyle = rgba('blood'); c.beginPath(); c.arc(head.x, head.y, 9 + 3 * pr, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('blood', 0.5 * pr); c.lineWidth = 2;
    c.beginPath(); c.arc(head.x, head.y, 14 + 26 * (1 - pr), 0, Math.PI * 2); c.stroke();
    // 線頭旁邊的海拔（冷面的讀數：一拍跳一次，走到山頂正好是山頂的標高）
    if (t >= this.tFirst && sl < full - 1) {
      const alt = Math.round((ALT0 + (ALT1 - ALT0) * (sl / full)) / 10) * 10;
      c.font = font(F.mono(500), 18); c.fillStyle = rgba('sepia', 0.62);
      c.fillText(`${alt} m`, head.x + 22, head.y + 6);
    }
    // 山頂的旗子：一直在（目的地），走到的那一刻「啪」地立起來、晃兩下
    const arr = t - this.tArrive;
    const pop = arr < 0 ? 0.72 : 0.72 + 0.28 * Math.min(1.15, 1 - Math.exp(-arr * 9) * Math.cos(arr * 22));
    const fx = SUMMIT.x, fy = SUMMIT.y;
    const poleH = 86 * pop;
    c.strokeStyle = rgba('sepia'); c.lineWidth = 4;
    c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx, fy - poleH); c.stroke();
    const wave = (x: number) => Math.sin(x * 0.12 - t * 7) * (3 + x * 0.06);
    c.fillStyle = rgba(arr >= 0 ? 'blood' : 'sepia', arr >= 0 ? 0.95 : 0.55);
    c.beginPath();
    c.moveTo(fx, fy - poleH);
    const fw = 70 * pop, fh = 40 * pop;
    for (let x = 0; x <= fw; x += 7) c.lineTo(fx + x, fy - poleH + (x / fw) * fh * 0.5 + wave(x));
    for (let x = fw; x >= 0; x -= 7) c.lineTo(fx + x, fy - poleH + fh - (x / fw) * fh * 0.5 + wave(x));
    c.closePath(); c.fill();
    if (arr >= 0) drawHeart(c, fx + fw * 0.4, fy - poleH + fh * 0.5 + wave(fw * 0.4), fh * 0.45, rgba('paper'));
    // 山頂的三角點
    c.fillStyle = rgba('sepia'); c.beginPath(); c.moveTo(fx - 9, fy + 7); c.lineTo(fx + 9, fy + 7); c.lineTo(fx, fy - 8); c.closePath(); c.fill();
    // 走到山頂：一圈擴散的圓
    if (arr >= 0 && arr < 1.2) {
      c.strokeStyle = rgba('blood', 0.6 * (1 - arr / 1.2)); c.lineWidth = 3;
      c.beginPath(); c.arc(fx, fy, 20 + 160 * ease.outCubic(arr / 1.2), 0, Math.PI * 2); c.stroke();
    }

    // 地名（歌詞）：左下的地名標籤；沒有留言時放大在左上（焦點）
    const pos = this.msg ? LYR : LYR_SOLO;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = layoutLyric(c, ly.line, this.lyrStyle);
      c.save(); c.translate(pos.x, pos.y - (lay.height - lay.size));
      drawLyric(c, ly.line, t, this.lyrStyle, lay, ly.k);
      c.restore();
      // 一條點線從地名拉到線頭
      if (this.msg) {
        const w = Math.max(...lay.rows.map((r) => r.width));
        c.setLineDash([1, 9]); c.strokeStyle = rgba('sepia', 0.32 * ly.k); c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(pos.x + w + 24, pos.y - lay.size * 0.35); c.lineTo(head.x - 16, head.y); c.stroke();
        c.setLineDash([]);
      }
    } else if (!lyrics.linesIn(s, e).length) {
      c.font = font(FAM_LYR, this.lyrStyle.size); c.letterSpacing = `${this.msg ? 6 : 8}px`; c.fillStyle = rgba('sepia', 0.85 * prog(t, s, s + 0.5));
      c.fillText(song.title, pos.x, pos.y);
      c.letterSpacing = '0px';
    }
    u.ov!.value = L.upload();
    u.st!.value = this.st.texture;

    // ---- 註記
    u.hasMsg!.value = this.mm ? 1 : 0;
    u.mm!.value = this.mm?.tex ?? this.st.texture;
    (u.mmR!.value as THREE.Vector4).set(...this.mmRect);
    let shown = 0;
    for (let i = 0; i < this.times.length; i++) {
      const k = clamp((t - this.times[i]!) / 0.12);
      if (k <= 0) break;
      shown = i + k;
    }
    u.shown!.value = shown;
    // ---- 描等高線：路線每走一段（拍點），線頭那個高度的等高線從線頭往外描一圈
    (u.head!.value as THREE.Vector2).set(head.x, head.y);
    const rb = this.beats.filter((b) => b >= this.tFirst - 1e-3 && b <= this.tArrive + 1e-3 && b <= t).pop();
    if (rb === undefined) { u.trace!.value = 0; u.traceK!.value = 0; }
    else {
      const age = t - rb;
      u.trace!.value = 1900 * ease.outCubic(clamp(age / (au.beatPeriod(t) * 1.8)));
      u.traceK!.value = 0.55 + 0.45 * Math.exp(-age * 2.2);
    }
    const box = this.lay?.box;
    const cv = u.clean!.value as THREE.Vector4;
    if (box) cv.set(box[0] + box[2] / 2, box[1] + box[3] / 2, box[2] + 60, box[3] + 60);
    else cv.set(LYR_SOLO.x + 520, LYR_SOLO.y - 20, 1160, 150);
    this.bg.render(renderer, out);

    return {
      paper: 1, bloom: 0.35, vignette: 0.4, grain: 0.05,
      popupAvoid: box ? [this.cam.screenRect(box, 10)] : [],
    };
  }
}
