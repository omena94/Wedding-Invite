// 彩繪玻璃（暗）：幽暗的禮拜堂，一扇圓拱的大彩繪玻璃窗，光從窗外透進來。
// 依「留言尺寸與版面比例標準 v2」重做構圖：
//  - 場景是主視覺：窗的上半部是一個「玫瑰窗」（中心圓、八瓣花、十六格外圈、一圈石頭窗櫺），拍點上由內往外一圈一圈亮起來；
//    亮完之後每一拍外圈有一格被陽光照亮（繞著圈走），每一小節一道陽光從窗上斜斜掃過；周圍的彩色碎玻璃也一圈圈亮起。
//    空氣裡有光柱與灰塵，窗外的光像有雲飄過一樣慢慢變，大鼓時光柱亮一下。
//  - 留言寫在玫瑰窗下面的一片「題字玻璃」上（下三分之一）：淡金色的手吹玻璃，深色的彩繪字（思源宋體，40～60 px，照 _v2），
//    署名在最後一行下面（26～32 px），愛心是一小片玫瑰色的玻璃。這片玻璃只比字大一點（依字數決定寬高，最寬 860）。
//    第一拍光由左往右掃過這片玻璃，字跟著光一個個亮出來。
//  - 歌詞是窗最下緣一排小方格玻璃裡的「玻璃字」（40～52 px，比留言小）：還沒唱是暗的、唱到的那一刻透光成訊號色、唱完是亮的白玻璃。
//    沒有留言：題字玻璃改成深色，歌詞在上面當焦點（52 px、最多兩行）、下緣一行小小的邀請；純音樂又沒有留言：透光的是新人的名字。
//  - 窗整個往左放，右下角 HUD 底下是暗的石牆。鏡頭從窗的下方偏一邊仰看，切進來時往上搖落定，之後慢慢推近；最後半拍雲遮住太陽。
// 手法：一個全螢幕 shader（PlaneCam：窗與牆是一張平面；玫瑰窗用極座標切格子、周圍用 Voronoi 切玻璃，每片的顏色與亮起來的時間由編號決定），
// 彩繪的字與歌詞的玻璃字畫在窗面座標的 Canvas 圖層，shader 取樣時當成「玻璃上的顏料」與「透光的玻璃」；灰塵用 LineBatch。
// 玻璃的顏色只用訊號色一家子、灰與骨白；玫瑰色只給愛心（TREATMENT：點綴色只給愛心）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, lyricSubOf, subSizeFor, subGap, NAME_A, NAME_B, fillWithHearts } from './_motifs';
import { grid, stagger, layoutRows, drawRows, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, msgBlockV2, INVITE, type MsgBlock, type Rect } from './_t14';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.05, 0.7], bars: [4, 8], weight: 1 };

/** 窗（窗面座標）：左右、圓弧起拱的高度、弧頂、窗台。右緣停在 HUD（x ≥ 1360）左邊。 */
const WIN = { x0: 150, x1: 1290, spring: 300, apex: 60, sill: 956 };
const CX = (WIN.x0 + WIN.x1) / 2;
/** 玫瑰窗：圓心、半徑（外圈石頭窗櫺另外加 22）。 */
const ROSE = { x: CX, y: 300, r: 200 };
/** 題字玻璃的下緣（上緣與左右依留言大小決定）；歌詞那一排小方格。 */
const PANE_Y1 = 830;
const PRED = { x0: CX - 410, y0: 846, x1: CX + 410, y1: 928 };
const PAD = { x: 46, y: 30 };
const FAM_MSG = F.ming(900);
const FAM_SIG = F.ming(700);
const FAM_LYR = F.archivo(100, 700);
/** 亮起來的順序：0 玫瑰窗中心、1 八瓣、2 十六格、3～5 周圍的碎玻璃由近到遠。 */
const RINGS = 6;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D paint; uniform sampler2D glyph; uniform float hasPaint;
  uniform vec4 win; uniform vec2 winS; uniform vec4 pane; uniform vec4 pred; uniform vec3 rose;
  uniform float ringT[${RINGS}]; uniform float t; uniform float paneT; uniform float sweep;
  uniform float light; uniform float kick; uniform float dark; uniform float mode;
  uniform vec2 chase;   // 外圈被照亮的那一格（編號、強度）
  uniform vec2 beam;    // 每小節掃過的陽光（對角線座標、強度）

  // 窗的輪廓：兩邊直的、上面一段圓弧（半徑大、拱不高）。回傳帶號距離（窗裡面是負的）
  float winSD(vec2 p) {
    float cx = (win.x + win.y) * 0.5, hw = (win.y - win.x) * 0.5;
    float rise = winS.x - win.z;
    float R = (hw * hw + rise * rise) / (2.0 * rise);
    float dArc = length(p - vec2(cx, win.z + R)) - R;
    float dSide = abs(p.x - cx) - hw;
    float dBot = p.y - win.w;
    return max(max(dSide, dBot), p.y < winS.x ? dArc : -1e5);
  }
  float boxSD(vec2 p, vec4 r) { vec2 c = (r.xy + r.zw) * 0.5, h = (r.zw - r.xy) * 0.5; vec2 q = abs(p - c) - h; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }

  // 玻璃的顏色（照這首歌的色票：金、暗紅、琥珀、灰藍、深酒紅、骨白；不用玫瑰色）
  vec3 glassColor(float h) {
    if (h < 0.2) return C_SIGNAL * 0.78;
    if (h < 0.38) return C_BLOOD * 1.25;
    if (h < 0.52) return mix(C_BLOOD, C_SIGNAL, 0.35) * 0.95;
    if (h < 0.68) return mix(C_EMBER, C_SIGNAL, 0.55) * 0.66;
    if (h < 0.84) return mix(mix(C_GRAPHITE, C_ASH, 0.6), C_SIGNAL, 0.12) * 0.6;
    return mix(C_BLOOD, C_INK2, 0.3) * 1.1;
  }

  // Voronoi：最近的點（id）、到最近兩點中垂線的距離（鉛條用）
  vec3 voro(vec2 p, float cell) {
    vec2 g = floor(p / cell), f = p / cell - g;
    float d1 = 8.0; vec2 id = vec2(0.0), m1 = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 r = o + 0.15 + 0.7 * hash22(g + o) - f;
      float d = dot(r, r);
      if (d < d1) { d1 = d; id = g + o; m1 = r; }
    }
    float md = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 r = o + 0.15 + 0.7 * hash22(g + o) - f;
      if (dot(m1 - r, m1 - r) > 1e-5) md = min(md, dot(0.5 * (m1 + r), normalize(r - m1)));
    }
    return vec3(id.x * 7.13 + id.y * 1.91, md * cell, 0.0);
  }
  float litAt(int i, float jitter) {
    float tr = ringT[0];
    for (int k = 0; k < ${RINGS}; k++) if (k == i) tr = ringT[k];
    return sat((t - tr - jitter) / 0.16);
  }

  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    float px = max(max(fwidth(P.x), fwidth(P.y)), 0.3);
    // 牆：暗的石頭（一塊一塊的石磚，很淡），離窗越遠越暗（禮拜堂裡只有窗是亮的）
    vec2 st = vec2(P.x + mod(floor(P.y / 90.0), 2.0) * 70.0, P.y);
    vec2 sq = abs(fract(st / vec2(140.0, 90.0)) - 0.5) * vec2(140.0, 90.0);
    float joint = 1.0 - smoothstep(64.0, 68.0, max(sq.x, sq.y * 1.55));
    float stone = 0.75 + 0.25 * snoise(P / 60.0) + 0.1 * snoise(P / 9.0);
    float nearWin = exp(-length((P - vec2(win.x + win.y, win.z + win.w) * 0.5) / vec2(900.0, 700.0)) * 1.4);
    vec3 col = mix(C_INK, C_INK2, 0.6) * stone * (0.5 + 0.5 * joint) * (0.35 + 0.65 * nearWin);
    float dW = winSD(P);
    col += mix(C_SIGNAL, C_EMBER, 0.4) * 0.035 * light * exp(-max(dW, 0.0) / 110.0) * (1.0 - dark);

    if (dW < 0.0) {
      vec3 g; float lead = 0.0, lit = 0.0, leadW = 3.4;
      float dPane = boxSD(P, pane), dPred = boxSD(P, pred);
      vec2 rp = P - rose.xy; float rr = length(rp);
      // 光從右上方照進來；窗外有雲慢慢飄
      float sun = 0.78 + 0.3 * smoothstep(1400.0, 200.0, length(P - vec2(1200.0, 120.0))) + 0.08 * snoise(P / 500.0 + vec2(t * 0.06, 0.0));
      float grain = 0.86 + 0.14 * snoise(P / vec2(34.0, 90.0) + 3.1) + 0.05 * snoise(P / 7.0);
      if (rr < rose.z + 22.0) {
        // ---- 玫瑰窗
        float an = atan(rp.y, rp.x);
        if (rr > rose.z) {
          // 石頭窗櫺：一圈圓柱形的石頭
          float n = (rr - rose.z) / 22.0 * 2.0 - 1.0;
          g = C_INK2 * stone * (0.9 + 0.5 * sqrt(max(0.0, 1.0 - n * n))) * (0.7 + 0.3 * light);
          lit = 1.0; lead = 0.0;
          col = g;
        } else {
          float seg16 = floor((an + PI) / (TAU / 16.0));
          if (rr < 52.0) {
            // 中心：一塊金色的圓玻璃
            g = mix(C_EMBER, C_SIGNAL, 0.5) * 0.85 * grain * sun;
            lit = litAt(0, 0.0);
            lead = 0.0;
          } else if (rr < 122.0) {
            // 八瓣：每一格一片花瓣（圓），花瓣外是深色的底玻璃
            float s8 = floor((an + PI) / (TAU / 8.0));
            float ac = (s8 + 0.5) * (TAU / 8.0) - PI;
            vec2 pc = vec2(cos(ac), sin(ac)) * 88.0;
            float dp = length(rp - pc) - 30.0;
            g = dp < 0.0 ? (mod(s8, 2.0) < 0.5 ? C_BLOOD * 1.3 : mix(C_BLOOD, C_SIGNAL, 0.4) * 1.05) : mix(C_INK2, C_BLOOD, 0.4) * 1.4;
            g *= grain * sun;
            lit = litAt(1, 0.0);
            lead = 1.0 - smoothstep(leadW - px, leadW + px, abs(dp));
            float ad = abs(mod(an + PI, TAU / 8.0) - TAU / 16.0);
            lead = max(lead, (1.0 - smoothstep(leadW * 0.8 - px, leadW * 0.8 + px, (TAU / 16.0 - ad) * rr)) * step(0.0, dp));
          } else {
            // 十六格：交錯的金與灰藍，每一格中間一顆小圓
            float alt = mod(seg16, 2.0);
            float ac = (seg16 + 0.5) * (TAU / 16.0) - PI;
            float dd = length(rp - vec2(cos(ac), sin(ac)) * 162.0) - 15.0;
            g = alt < 0.5 ? C_SIGNAL * 0.72 : mix(mix(C_GRAPHITE, C_ASH, 0.6), C_SIGNAL, 0.15) * 0.62;
            if (dd < 0.0) g = alt < 0.5 ? C_BLOOD * 1.2 : mix(C_EMBER, C_SIGNAL, 0.5) * 0.8;
            g *= grain * sun;
            lit = litAt(2, 0.0);
            // 被陽光照到的那一格（繞著圈走）
            g *= 1.0 + 0.7 * chase.y * step(abs(seg16 - chase.x), 0.5);
            float ad = abs(mod(an + PI, TAU / 16.0) - TAU / 32.0);
            lead = 1.0 - smoothstep(leadW - px, leadW + px, (TAU / 32.0 - ad) * rr);
            lead = max(lead, 1.0 - smoothstep(leadW - px, leadW + px, abs(dd)));
          }
          lead = max(lead, 1.0 - smoothstep(leadW - px, leadW + px, abs(rr - 52.0)));
          lead = max(lead, 1.0 - smoothstep(leadW - px, leadW + px, abs(rr - 122.0)));
        }
      } else if (dPane < 0.0) {
        // ---- 題字玻璃：淡金色的手吹玻璃（直的流紋、小氣泡），光由左往右掃過
        float u = sat((P.x - pane.x) / (pane.z - pane.x));
        lit = sat((t - paneT - u * sweep) / 0.18);
        vec3 base = mix(mix(C_BONE, C_EMBER, 0.4), C_SIGNAL, 0.12) * 0.8;
        if (mode > 0.5) base = mix(C_INK2, C_BLOOD, 0.25) * 1.6;
        float streak = 0.93 + 0.07 * snoise(vec2(P.x / 22.0, P.y / 260.0)) + 0.03 * snoise(P / 120.0);
        float bub = 1.0 - 0.25 * smoothstep(0.93, 0.97, snoise(P / 6.0 + 17.0));
        g = base * streak * bub * sun * (0.9 + 0.1 * smoothstep(0.0, 40.0, -dPane));
        if (hasPaint > 0.5) {
          vec4 pt = fastLayer(texture(paint, pageUV(P)));
          float a = pt.a * (0.97 + 0.03 * snoise(P / 18.0));
          vec3 pc = pt.rgb / max(pt.a, 1e-3);
          // 愛心是一小片玫瑰色的玻璃（透光），其他是深色的顏料
          g = mix(g, luma(pc) > 0.05 ? pc * 0.9 : C_SEPIA * 0.14, a);
        }
        lead = 1.0 - smoothstep(leadW * 1.5 - px, leadW * 1.5 + px, abs(dPane));
      } else if (dPred < 0.0) {
        // ---- 歌詞那一排：一格一格的深琥珀玻璃（透一點點光），玻璃字在上面
        vec2 q = P - pred.xy;
        vec2 cell = floor(q / vec2(57.0, 35.0));
        float hh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5);
        g = mix(C_BLOOD, C_INK2, 0.45 + 0.25 * hh) * 1.2 * grain;
        lit = litAt(2, 0.0);
        lead = 1.0 - smoothstep(leadW - px, leadW + px, abs(dPred));
        vec2 gq = abs(mod(q, vec2(57.0, 35.0)) - vec2(28.5, 17.5));
        lead = max(lead, 0.75 * (1.0 - smoothstep(leadW * 0.6 - px, leadW * 0.6 + px, min(28.5 - gq.x, 17.5 - gq.y))));
      } else {
        // ---- 周圍的彩色碎玻璃：Voronoi 一片一片，由近（玫瑰窗）到遠一圈圈亮起來
        vec3 v = voro(P, 92.0);
        float h = fract(sin(v.x) * 43758.5453);
        float mott = 0.85 + 0.2 * snoise(P / 45.0 + h * 40.0);
        g = glassColor(h) * grain * sun * mott * (0.7 + 0.45 * fract(h * 17.0)) * (0.62 + 0.38 * smoothstep(0.0, 26.0, v.y)) * 0.85;
        float ring = clamp(floor(rr / 280.0 + h * 0.8), 0.0, 2.0);
        lit = litAt(3 + int(ring), fract(h * 31.0) * 0.12);
        lead = 1.0 - smoothstep(leadW - px, leadW + px, v.y);
        lead = max(lead, 1.0 - smoothstep(leadW - px, leadW + px, abs(dPane)));
        lead = max(lead, 1.0 - smoothstep(leadW - px, leadW + px, abs(dPred)));
        lead = max(lead, 1.0 - smoothstep(leadW * 1.5 - px, leadW * 1.5 + px, abs(rr - rose.z - 22.0)));
      }
      if (rr <= rose.z || rr >= rose.z + 22.0) {
        // 每小節一道陽光斜斜掃過（對角線上一條柔和的亮帶）；大鼓時窗外亮一點
        float bd = (P.x + P.y * 0.6) - beam.x;
        float bm = 1.0 + 0.55 * beam.y * exp(-bd * bd / (2.0 * 110.0 * 110.0));
        vec3 glass = g * mix(0.07, light * (1.0 + 0.1 * kick) * bm, lit) * (1.0 - dark * 0.85);
        // 歌詞的玻璃字（透光：自己就是亮的）；字的邊緣包一圈細鉛條
        vec4 gl = fastLayer(texture(glyph, pageUV(P)));
        float gA = texture(glyph, pageUV(P + vec2(2.5, 0.0))).a, gB = texture(glyph, pageUV(P - vec2(2.5, 0.0))).a;
        float gC = texture(glyph, pageUV(P + vec2(0.0, 2.5))).a, gD = texture(glyph, pageUV(P - vec2(0.0, 2.5))).a;
        float rim = sat((max(max(gA, gB), max(gC, gD)) - min(min(gA, gB), min(gC, gD))) * 1.6) * step(0.02, max(max(gA, gB), max(gC, gD)));
        glass = glass * (1.0 - gl.a) + gl.rgb * grain * (1.0 - dark * 0.7);
        lead = max(lead, rim * 0.85);
        col = mix(glass, C_INK * 0.9 + C_ASH * 0.05, lead);
      }
      // 石頭窗框（窗的邊緣一圈）
      float frame = 1.0 - smoothstep(-24.0 - px, -24.0 + px, dW);
      col = mix(col, C_INK2 * stone * 1.3 * (0.8 + 0.2 * light), 1.0 - frame);
    }
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  paint: { value: null }, glyph: { value: null }, hasPaint: { value: 0 },
  win: { value: new THREE.Vector4(WIN.x0, WIN.x1, WIN.apex, WIN.sill) }, winS: { value: new THREE.Vector2(WIN.spring, 0) },
  pane: { value: new THREE.Vector4(400, 600, 1080, PANE_Y1) }, pred: { value: new THREE.Vector4(PRED.x0, PRED.y0, PRED.x1, PRED.y1) },
  rose: { value: new THREE.Vector3(ROSE.x, ROSE.y, ROSE.r) },
  ringT: { value: new Array(RINGS).fill(1e9) }, t: { value: 0 }, paneT: { value: 1e9 }, sweep: { value: 0.4 },
  light: { value: 1 }, kick: { value: 0 }, dark: { value: 0 }, mode: { value: 0 },
  chase: { value: new THREE.Vector2(0, 0) }, beam: { value: new THREE.Vector2(-1e4, 0) },
});

/** 光柱（加亮疊上去）：從窗往右下斜的幾道光，裡面有飄的灰塵。 */
const RAYS = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform float t; uniform float k;
  void main() {
    vec2 sp = SP();
    vec2 d = normalize(vec2(0.62, 0.78));
    vec2 n = vec2(-d.y, d.x);
    vec2 o = vec2(760.0, 300.0);
    float along = dot(sp - o, d), across = dot(sp - o, n);
    float band = 0.5 + 0.5 * snoise(vec2(across / 90.0, t * 0.05));
    band = pow(band, 3.0) + 0.35 * pow(0.5 + 0.5 * snoise(vec2(across / 260.0 + 7.0, t * 0.03)), 2.0);
    float fall = smoothstep(-100.0, 300.0, along) * exp(-max(along, 0.0) / 650.0);
    float inWin = smoothstep(-620.0, -380.0, across) * (1.0 - smoothstep(380.0, 620.0, across));
    vec3 c = mix(C_SIGNAL, C_EMBER, 0.5) * 0.035 * band * fall * inWin * k;
    fragColor = vec4(c, 1.0);
  }`, { ...camUniforms(), t: { value: 0 }, k: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });

export default class StainedGlass extends Scene {
  bg = shared('stainedglass.bg2', BG);
  rays = shared('stainedglass.rays2', RAYS);
  /** 彩繪的字（留言、署名）：窗面座標，只畫一次。 */
  paint = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 透光的玻璃字（歌詞）：窗面座標，每格重畫。 */
  glyph = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dust = this.track(new LineBatch(160, { screen2D: true, blend: 'add' }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 53 + (this.msg?.id ?? 0) * 29) >>> 0;
  block: MsgBlock | null = null;
  paintReady = false;
  ringT: number[] = [];
  paneT = 0; sweep = 0.4;
  /** 題字玻璃（依留言大小）。 */
  pane: Rect = [400, 600, 680, PANE_Y1 - 600];
  lyrSize = 52;
  /** 鏡頭在題字玻璃那一塊的縮放。 */
  k = 1;
  hasLyrics = false;
  /** 沒有留言、也沒有歌詞：中間透光的新人名字。 */
  names: FitResult | null = null;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.paint.ctx;
    const gr = grid(au, s, e);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const names = `${NAME_A} ♥ ${NAME_B}`;
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新人' : m.name) : ''}${names}${INVITE}${song.title}${song.artist}——一位賓客`);
    // 題字玻璃在第一拍亮（光由左往右掃過）；玫瑰窗同時從中心開始，之後一拍亮一圈
    this.paneT = gr.b0;
    this.sweep = clamp(gr.beat * 0.9, 0.3, 0.6);
    this.ringT = stagger(au, gr.b0, RINGS, Math.min(gr.bar * 1.5, Math.max(gr.beat * 2, (e - gr.b0) * 0.45)));
    this.cam.set(this.pose(e - 0.5));
    const k = (this.k = this.cam.toScreen(CX, 700).scale);
    if (m) {
      // 留言：先在一個框裡排好（v2 字級），再把整塊放到題字玻璃裡，玻璃只比字大一點、下緣對齊
      const bw = Math.min(860 / k, WIN.x1 - WIN.x0 - 120) - PAD.x * 2, bh = Math.min(430 / k, PANE_Y1 - (ROSE.y + ROSE.r + 40)) - PAD.y * 2;
      const b = (this.block = msgBlockV2(c, m, FAM_MSG, { x: CX - bw / 2, y: 0, w: bw, h: bh }, { align: 'center', valign: 'top', sigFamily: FAM_SIG, scale: k, lineHeight: 1.32 }));
      const dy = PANE_Y1 - PAD.y - (b.box[1] + b.box[3]);
      b.lines.forEach((l) => (l.y += dy));
      b.sig.y += dy;
      b.box[1] += dy;
      const x0 = Math.min(...b.lines.map((l) => l.x), b.sig.x), x1 = Math.max(...b.lines.map((l) => l.x + l.w), b.sig.x + b.sig.w);
      const hw = Math.max((x1 - x0) / 2 + PAD.x, 260);
      this.pane = [CX - hw, b.box[1] - PAD.y, hw * 2, PANE_Y1 - (b.box[1] - PAD.y)];
      this.lyrSize = lyricV2(b.fit.size * k) / k;
      this.avoid = [this.cam.screenRect(this.pane, 10)];
    } else {
      this.lyrSize = lyricV2(null) / k;
      this.pane = [CX - 400, 560, 800, PANE_Y1 - 560];
      this.avoid = [this.cam.screenRect(this.pane, 10)];
      // 名字只畫一行（題字玻璃那一塊）：名字長就縮到 20 px 為止，不要折行（第二行不會畫出來）
      if (!this.hasLyrics) this.names = fitText(this.glyph.ctx, names, FAM_LYR, 700, 120, { min: 20, max: 60 / k, maxLines: 1 });
    }
  }

  /** 把留言畫進「顏料」圖層（只畫一次）：深色的彩繪字、署名。 */
  private drawPaint() {
    const L = this.paint; L.clear();
    const c = L.ctx, b = this.block;
    if (!b) return;
    c.fillStyle = rgba('ink');
    c.textBaseline = 'alphabetic';
    c.font = font(FAM_MSG, b.fit.size);
    for (const ln of b.lines) fillWithHearts(c, ln.text, ln.x, ln.y, rgba('rose'));
    c.font = font(FAM_SIG, b.sig.size);
    c.fillText(b.sig.text, b.sig.x, b.sig.y);
    if (this.msg?.couple) {
      c.font = font(F.mono(500), 18 / this.k); c.letterSpacing = '4px'; c.fillStyle = rgba('ink', 0.8);
      c.fillText('FROM THE COUPLE  ·  新人', this.pane[0] + PAD.x, this.pane[1] + PAD.y * 0.9);
      c.letterSpacing = '0px';
    }
  }

  /** 鏡頭：從窗的下方偏一邊仰看，切進來時往上搖落定，之後慢慢推近。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const land = prog(t, s, Math.max(s + 0.4, this.paneT - 0.05), ease.outExpo);
    const p = clamp((t - s) / (e - s));
    const side = hash(this.seed, 7) < 0.5 ? 1 : -1;
    const F0 = 1600;
    return {
      tx: CX + 170 + 60 * side * (1 - land) + 16 * side * (p - 0.5),
      ty: 540 + 180 * (1 - land),
      dist: F0 * (1.04 - 0.04 * ease.inOutQuad(p) + 0.05 * (1 - land)),
      pitch: 0.16 + 0.12 * (1 - land),
      yaw: -0.1 * side,
      level: 0.9,
      focal: F0,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    if (!this.paintReady) { this.drawPaint(); this.paint.upload(); this.paintReady = true; }
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    const arr = u.ringT!.value as number[];
    for (let i = 0; i < RINGS; i++) arr[i] = this.ringT[i] ?? 1e9;
    u.t!.value = t;
    u.paneT!.value = this.paneT; u.sweep!.value = this.sweep;
    const pr = this.pane;
    (u.pane!.value as THREE.Vector4).set(pr[0], pr[1], pr[0] + pr[2], pr[1] + pr[3]);
    // 窗外的光：像有雲飄過一樣慢慢變（t 的純函數），最後半拍被雲遮住暗下去
    const dark = prog(t, e - 0.45, e, ease.inCubic);
    u.light!.value = 1.05 + 0.08 * Math.sin(t * 0.37 + this.seed) + 0.05 * Math.sin(t * 0.91);
    u.kick!.value = f.a.kick;
    u.dark!.value = dark;
    u.mode!.value = this.msg ? 0 : 1;
    u.paint!.value = this.paint.texture;
    u.hasPaint!.value = this.block ? 1 : 0;
    // 玫瑰窗都亮了之後：每一拍外圈有一格被陽光照亮（繞著圈走）；每一小節一道陽光從左上掃到右下
    const allLit = (this.ringT[2] ?? 1e9) + 0.3;
    const bt = au.beatAt(t), bi = Math.floor(bt);
    (u.chase!.value as THREE.Vector2).set(((bi % 16) + 16) % 16, t > allLit ? Math.pow(0.5, (t - au.timeOfBeat(bi)) / 0.25) : 0);
    const br = au.barAt(t), bf = br - Math.floor(br);
    (u.beam!.value as THREE.Vector2).set(-300 + ease.inOutCubic(bf) * 2600, t > allLit ? Math.sin(Math.PI * bf) : 0);

    // ---- 透光的玻璃字：歌詞（窗下緣一排，或沒有留言時在題字玻璃上）
    const G = this.glyph; G.clear();
    const c = G.ctx;
    const ink: KaraokeInk = { active: rgba('signal'), sung: rgba('bone', 0.9), unsung: rgba('bone', 0.14) };
    const on = prog(t, this.paneT, this.paneT + 0.3);
    const ly = lyricAt(lyrics, t);
    if (this.msg) {
      if (ly) {
        const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40 / this.k, maxW: PRED.x1 - PRED.x0 - 80, maxRows: 1, align: 'center' as const };
        const lay = layoutRows(c, ly.line, st);
        c.save(); c.translate((PRED.x0 + PRED.x1) / 2, (PRED.y0 + PRED.y1) / 2 + lay.size * 0.36);
        drawRows(c, lay, FAM_LYR, t, ink, ly.k * on);
        c.restore();
      }
    } else {
      // 兩句之間（間奏）：題字玻璃不要空著——下一句先以暗的玻璃字擺著（還沒唱），窗格裡沒有下一句就留著剛唱完的那句
      const nx = lyrics.nextLine(t), ls = lyrics.lastLine(t);
      const line = ly?.line ?? (nx && nx.start < e ? nx : ls && ls.end > s - 4 ? ls : null);
      const pcx = pr[0] + pr[2] / 2, pcy = pr[1] + pr[3] / 2;
      if (line) {
        const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40 / this.k, maxW: pr[2] - 120, maxRows: 2, align: 'center' as const, lineHeight: 1.18 };
        const lay = layoutRows(c, line, st);
        const sub = lyricSubOf(line);
        if (sub) {
          // 韓文歌：原文小一號畫在中文正下方（同一片題字玻璃、一樣置中），兩段一起在玻璃上垂直置中；
          // 原文比中文安靜：透光時是淡兩成的白玻璃（不透訊號色），還沒唱的一樣暗
          const ss = subSizeFor(lay.size * this.k) / this.k;
          const sl = layoutRows(c, sub, { ...st, size: ss, minSize: Math.min(ss, 26 / this.k) });
          const gap = (lay.rows.length - 1) * lay.lineHeight + subGap(lay.size, sl.size);
          const total = lay.size * 0.84 + gap + (sl.rows.length - 1) * sl.lineHeight + sl.size * 0.25;
          const sung = rgba('bone', 0.9 * 0.8);
          c.save(); c.translate(pcx, pcy - total / 2 + lay.size * 0.84);
          drawRows(c, lay, FAM_LYR, t, ink, (ly ? ly.k : 1) * on);
          c.translate(0, gap);
          drawRows(c, sl, FAM_LYR, t, { ...ink, active: sung, sung }, (ly ? ly.k : 1) * on);
          c.restore();
        } else {
          c.save(); c.translate(pcx, pcy - lay.height / 2 + lay.size * 0.84);
          drawRows(c, lay, FAM_LYR, t, ink, (ly ? ly.k : 1) * on);
          c.restore();
        }
      } else if (this.names) {
        c.font = font(FAM_LYR, this.names.size);
        c.fillStyle = rgba('bone', 0.9 * on);
        fillWithHearts(c, this.names.lines[0] ?? '', pcx - this.names.width / 2, pcy + this.names.size * 0.35, rgba('rose', on));
      }
      c.font = font(F.hei(500), 24 / this.k); c.letterSpacing = '4px'; c.textAlign = 'center';
      c.fillStyle = rgba('bone', 0.55 * prog(t, this.ringT[2] ?? s, (this.ringT[2] ?? s) + 0.3));
      c.fillText(INVITE, (PRED.x0 + PRED.x1) / 2, (PRED.y0 + PRED.y1) / 2 + 9);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    u.glyph!.value = G.upload();
    this.bg.render(renderer, out);

    // ---- 光柱與灰塵
    this.cam.apply(this.rays.u);
    this.rays.u.t!.value = t;
    this.rays.u.k!.value = on * (1 - dark) * (1 + 0.5 * f.a.kick);
    this.rays.render(renderer, out);
    const db = this.dust; db.clear();
    const sig = LIN.ember;
    for (let i = 0; i < 70; i++) {
      // 每顆灰塵有自己的慢速漂流（種子亂數＋時間，確定性）；只在光柱裡看得到
      const r1 = hash(this.seed, i, 1), r2 = hash(this.seed, i, 2), r3 = hash(this.seed, i, 3);
      const x = (r1 * 1500 + 600 + 18 * Math.sin(t * (0.2 + r3 * 0.3) + i) + t * 6) % 1800;
      const y = (r2 * 900 + 150 + t * (8 + 10 * r3)) % 1000;
      const across = -(x - 760) * 0.78 + (y - 300) * 0.62;
      const inBeam = clamp(1 - Math.abs(across) / 620) * on * (1 - dark);
      const tw = 0.5 + 0.5 * Math.sin(t * (1.3 + r3) + i * 2.1);
      const a = inBeam * tw * 0.8;
      if (a < 0.02 || (x >= 1360 && y >= 830)) continue;
      db.seg2(x, y, x + 0.6, y + 0.6, 1.6 + r3 * 1.6, [sig[0] * a, sig[1] * a, sig[2] * a], 1);
    }
    if (db.count) db.render(renderer, out);
    return { bloom: 0.7, bloomThreshold: 0.85, vignette: 0.62, halation: 0.35, popupAvoid: this.avoid };
  }
}
