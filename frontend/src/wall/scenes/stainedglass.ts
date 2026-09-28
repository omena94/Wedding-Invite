// 彩繪玻璃（暗）：幽暗的禮拜堂，一扇大彩繪玻璃窗（圓弧頂、鉛條把玻璃分成一片一片），光從窗外透進來。
//  - 一個焦點：窗的正中間是一大片淡金色的玻璃，主打留言用深色的玻璃彩繪（grisaille）寫在上面，署名在右下。
//    第一拍光由左往右掃過中間那片玻璃（字跟著光一個個亮出來），之後每一拍亮一圈周圍的彩色玻璃（由內往外一圈一圈）。
//  - 歌詞是窗下緣一排小窗格裡的「玻璃字」：還沒唱是暗的玻璃、唱到的那一刻透光成訊號色、唱完是亮的白玻璃。比留言小一級。
//    沒有留言：中間那片改成深色的鉛框，歌詞本身變成大大的玻璃字逐字透光（歌詞是焦點），下緣一行小小的邀請；
//    純音樂又沒有留言：中間透光的是新人的名字。
//  - 空氣裡有光柱與灰塵（光柱往右下斜，灰塵慢慢飄），窗外的光像有雲飄過一樣慢慢變化，大鼓時光柱亮一下。
//  - 鏡頭：從窗的下方仰看、偏右，切進來時往上搖到窗的中間落定，之後很慢地推近；最後半拍光暗下去（雲遮住太陽）。
// 手法：一個全螢幕 shader（PlaneCam：窗與牆是一張平面；Voronoi 切出玻璃與鉛條、每片玻璃的顏色與亮起來的時間由編號決定），
// 彩繪的字與歌詞的玻璃字畫在窗面座標的 Canvas 圖層，shader 取樣時當成「玻璃上的顏料」與「透光的玻璃」；灰塵用 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, lyricSizeFor, COUPLE_ZH, fillWithHearts } from './_motifs';
import { grid, stagger, layoutRows, drawRows, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, msgBlock, INVITE, type MsgBlock, type Rect } from './_t14';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.05, 0.7], bars: [4, 8], weight: 1 };

/** 窗（窗面座標）：左右、圓弧起拱的高度、弧頂、窗台。 */
const WIN = { x0: 160, x1: 1480, spring: 250, apex: 64, sill: 900 };
/** 中間那片淡金色的玻璃（留言寫在這裡）。 */
const PANE = { x0: 250, y0: 280, x1: 1390, y1: 730 };
/** 下緣一排小窗格（歌詞的玻璃字）。 */
const PRED = { x0: 250, y0: 766, x1: 1390, y1: 862 };
const MSG_BOX = { x: 312, y: 328, w: 1016, h: 366 };
const FAM_MSG = F.ming(900);
const FAM_SIG = F.ming(700);
const FAM_LYR = F.archivo(100, 700);
const RINGS = 5;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D paint; uniform sampler2D glyph; uniform float hasPaint;
  uniform vec4 win; uniform vec2 winS; uniform vec4 pane; uniform vec4 pred;
  uniform float ringT[${RINGS}]; uniform float t; uniform float paneT; uniform float sweep;
  uniform float light; uniform float kick; uniform float dark; uniform float mode;

  // 窗的輪廓：兩邊直的、上面一段圓弧（半徑大、拱不高）。回傳帶號距離（窗裡面是負的）
  float winSD(vec2 p) {
    float cx = (win.x + win.y) * 0.5, hw = (win.y - win.x) * 0.5;
    float rise = winS.x - win.z;
    float R = (hw * hw + rise * rise) / (2.0 * rise);
    float dArc = length(p - vec2(cx, win.z + R)) - R;
    float dSide = abs(p.x - cx) - hw;
    float dBot = p.y - win.w;
    float d = max(max(dSide, dBot), p.y < winS.x ? dArc : -1e5);
    return d;
  }
  float boxSD(vec2 p, vec4 r) { vec2 c = (r.xy + r.zw) * 0.5, h = (r.zw - r.xy) * 0.5; vec2 q = abs(p - c) - h; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }

  // 玻璃的顏色（照這首歌的色票：金、暗紅、玫瑰、琥珀、灰藍、深酒紅）
  vec3 glassColor(float h) {
    if (h < 0.2) return C_SIGNAL * 0.78;
    if (h < 0.38) return C_BLOOD * 1.25;
    if (h < 0.52) return C_ROSE * 0.62;
    if (h < 0.68) return mix(C_EMBER, C_SIGNAL, 0.55) * 0.66;
    if (h < 0.84) return mix(mix(C_GRAPHITE, C_ASH, 0.6), C_SIGNAL, 0.12) * 0.6;
    return mix(C_BLOOD, C_ROSE, 0.3) * 0.9;
  }

  // Voronoi：最近的點（id）、到最近兩點中垂線的距離（鉛條用）
  vec3 voro(vec2 p, float cell) {
    vec2 g = floor(p / cell), f = p / cell - g;
    float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0), m1 = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 r = o + 0.15 + 0.7 * hash22(g + o) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = g + o; m1 = r; } else if (d < d2) { d2 = d; }
    }
    // 到中垂線的距離（第二輪，精確版）
    float md = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 r = o + 0.15 + 0.7 * hash22(g + o) - f;
      if (dot(m1 - r, m1 - r) > 1e-5) md = min(md, dot(0.5 * (m1 + r), normalize(r - m1)));
    }
    return vec3(id.x * 7.13 + id.y * 1.91, md * cell, 0.0);
  }

  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    float px = max(max(fwidth(P.x), fwidth(P.y)), 0.3);
    // 牆：暗的石頭（一塊一塊的石磚，很淡），被窗的光照到一點
    vec2 st = vec2(P.x + mod(floor(P.y / 90.0), 2.0) * 70.0, P.y);
    vec2 sq = abs(fract(st / vec2(140.0, 90.0)) - 0.5) * vec2(140.0, 90.0);
    float joint = 1.0 - smoothstep(64.0, 68.0, max(sq.x, sq.y * 1.55));
    float stone = 0.75 + 0.25 * snoise(P / 60.0) + 0.1 * snoise(P / 9.0);
    // 牆離窗越遠越暗（禮拜堂裡只有窗是亮的）
    float nearWin = exp(-length((P - vec2(820.0, 520.0)) / vec2(900.0, 700.0)) * 1.4);
    vec3 col = mix(C_INK, C_INK2, 0.6) * stone * (0.5 + 0.5 * joint) * (0.35 + 0.65 * nearWin);
    float dW = winSD(P);
    // 窗旁邊的牆被透出來的光照到（窗外越亮越明顯）
    col += mix(C_SIGNAL, C_EMBER, 0.4) * 0.035 * light * exp(-max(dW, 0.0) / 110.0) * (1.0 - dark);

    // ---- 窗
    if (dW < 0.0) {
      vec3 g; float lead = 0.0, lit = 0.0, leadW = 3.4;
      float dPane = boxSD(P, pane), dPred = boxSD(P, pred);
      // 光從右上方照進來：玻璃右上亮、左下暗一點；窗外有雲慢慢飄
      float sun = 0.78 + 0.3 * smoothstep(1400.0, 200.0, length(P - vec2(1300.0, 120.0))) + 0.08 * snoise(P / 500.0 + vec2(t * 0.06, 0.0));
      float grain = 0.86 + 0.14 * snoise(P / vec2(34.0, 90.0) + 3.1) + 0.05 * snoise(P / 7.0);
      if (dPane < 0.0) {
        // 中間那片：淡金色的玻璃（有留言）或深色鉛框裡的玻璃字（沒有留言）
        float u = sat((P.x - pane.x) / (pane.z - pane.x));
        float on = sat((t - paneT - u * sweep) / 0.18);
        // 淡金色的手吹玻璃：直的流紋、幾顆小氣泡、中間比邊緣亮一點
        vec3 base = mix(mix(C_BONE, C_EMBER, 0.4), C_SIGNAL, 0.12) * 0.8;
        if (mode > 0.5) base = mix(C_INK2, C_BLOOD, 0.25) * 1.6;
        float streak = 0.93 + 0.07 * snoise(vec2(P.x / 22.0, P.y / 260.0)) + 0.03 * snoise(P / 120.0);
        float bub = 1.0 - 0.25 * smoothstep(0.93, 0.97, snoise(P / 6.0 + 17.0));
        float edgeL = smoothstep(0.0, 60.0, -dPane);
        g = base * streak * bub * sun * (0.9 + 0.1 * edgeL);
        lit = on;
        // 彩繪的字（深色顏料，筆觸有一點濃淡）
        if (hasPaint > 0.5) {
          vec4 pt = fastLayer(texture(paint, pageUV(P)));
          // 顏料有一點濃淡（筆觸）；愛心是一小片玫瑰色的玻璃（透光），其他是深色的顏料
          float a = pt.a * (0.97 + 0.03 * snoise(P / 18.0));
          vec3 pc = pt.rgb / max(pt.a, 1e-3);
          g = mix(g, luma(pc) > 0.05 ? pc * 0.9 : C_SEPIA * 0.14, a);
        }
        lead = 1.0 - smoothstep(leadW * 1.6 - px, leadW * 1.6 + px, abs(dPane));
        // 沿著邊一圈窄窄的邊條玻璃（琥珀色、每 64 px 一段），中間一整片寫字
        float fil = -dPane;
        if (fil < 30.0) {
          vec2 q = P - pane.xy;
          float runner = abs(P.y - pane.y) < 30.0 || abs(P.y - pane.w) < 30.0 ? q.x : q.y;
          float seg = abs(mod(runner, 64.0) - 32.0);
          float hh = fract(sin(floor(runner / 64.0) * 12.9 + (P.y < pane.y + 30.0 ? 1.0 : 0.0) + (P.x < pane.x + 30.0 ? 3.0 : 0.0)) * 43758.5);
          g = mix(C_SIGNAL, C_BLOOD, 0.35 + 0.4 * hh) * 0.75 * grain * sun;
          lead = max(lead, 1.0 - smoothstep(leadW - px, leadW + px, abs(fil - 30.0)));
          lead = max(lead, 1.0 - smoothstep(leadW - px, leadW + px, 32.0 - seg));
        }
      } else if (dPred < 0.0) {
        // 一排小方格的深琥珀玻璃（透一點點光），玻璃字在上面
        vec2 q = P - pred.xy;
        vec2 cell = floor(q / vec2(57.0, 48.0));
        float hh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5);
        g = mix(C_BLOOD, C_INK2, 0.45 + 0.25 * hh) * 1.2 * grain;
        lit = sat((t - ringT[0]) / 0.2);
        lead = 1.0 - smoothstep(leadW - px, leadW + px, abs(dPred));
        vec2 gq = abs(mod(q, vec2(57.0, 48.0)) - vec2(28.5, 24.0));
        lead = max(lead, 0.75 * (1.0 - smoothstep(leadW * 0.6 - px, leadW * 0.6 + px, min(28.5 - gq.x, 24.0 - gq.y))));
      } else {
        // 周圍的彩色玻璃：Voronoi 一片一片，每片在自己那一圈的拍點亮起來
        vec3 v = voro(P, 96.0);
        float h = fract(sin(v.x) * 43758.5453);
        // 每片玻璃有自己的濃淡；靠近鉛條的地方比較厚、比較暗
        float mott = 0.85 + 0.2 * snoise(P / 45.0 + h * 40.0);
        g = glassColor(h) * grain * sun * mott * (0.75 + 0.5 * fract(h * 17.0)) * (0.62 + 0.38 * smoothstep(0.0, 26.0, v.y));
        vec2 c = (pane.xy + pane.zw) * 0.5;
        float ring = clamp(floor(length((P - c) / vec2(1.0, 1.35)) / 170.0 + h * 0.8), 0.0, ${RINGS - 1}.0);
        float tr = ringT[0];
        for (int i = 0; i < ${RINGS}; i++) if (float(i) == ring) tr = ringT[i];
        lit = sat((t - tr - fract(h * 31.0) * 0.12) / 0.16);
        lead = 1.0 - smoothstep(leadW - px, leadW + px, v.y);
        // 貼著中間那片與下緣那排的鉛框
        lead = max(lead, 1.0 - smoothstep(leadW - px, leadW + px, abs(dPane)));
        lead = max(lead, 1.0 - smoothstep(leadW - px, leadW + px, abs(dPred)));
      }
      // 沒亮的玻璃：室內的一點點光（看得到形狀）；亮了：透光。大鼓時窗外亮一點
      vec3 glass = g * mix(0.07, light * (1.0 + 0.1 * kick), lit) * (1.0 - dark * 0.85);
      // 歌詞的玻璃字（透光：自己就是亮的）
      vec4 gl = fastLayer(texture(glyph, pageUV(P)));
      // 玻璃字：跟玻璃一樣有流紋；字的邊緣包一圈細鉛條（取四個方向的覆蓋率，邊界上的差最大）
      float gA = texture(glyph, pageUV(P + vec2(2.5, 0.0))).a, gB = texture(glyph, pageUV(P - vec2(2.5, 0.0))).a;
      float gC = texture(glyph, pageUV(P + vec2(0.0, 2.5))).a, gD = texture(glyph, pageUV(P - vec2(0.0, 2.5))).a;
      float rim = sat((max(max(gA, gB), max(gC, gD)) - min(min(gA, gB), min(gC, gD))) * 1.6) * step(0.02, max(max(gA, gB), max(gC, gD)));
      glass = glass * (1.0 - gl.a) + gl.rgb * grain * (1.0 - dark * 0.7);
      lead = max(lead, rim * 0.85);
      // 鉛條：暗、頂上一條細細的反光
      vec3 leadC = C_INK * 0.9 + C_ASH * 0.05;
      col = mix(glass, leadC, lead);
      // 窗框：石頭的窗框（窗的邊緣一圈）
      float frame = 1.0 - smoothstep(-24.0 - px, -24.0 + px, dW);
      col = mix(col, C_INK2 * stone * 1.3 * (0.8 + 0.2 * light), 1.0 - frame);
    }
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  paint: { value: null }, glyph: { value: null }, hasPaint: { value: 0 },
  win: { value: new THREE.Vector4(WIN.x0, WIN.x1, WIN.apex, WIN.sill) }, winS: { value: new THREE.Vector2(WIN.spring, 0) },
  pane: { value: new THREE.Vector4(PANE.x0, PANE.y0, PANE.x1, PANE.y1) }, pred: { value: new THREE.Vector4(PRED.x0, PRED.y0, PRED.x1, PRED.y1) },
  ringT: { value: new Array(RINGS).fill(1e9) }, t: { value: 0 }, paneT: { value: 1e9 }, sweep: { value: 0.4 },
  light: { value: 1 }, kick: { value: 0 }, dark: { value: 0 }, mode: { value: 0 },
});

/** 光柱（加亮疊上去）：從窗往右下斜的幾道光，裡面有飄的灰塵。 */
const RAYS = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform float t; uniform float k; uniform vec4 win;
  void main() {
    vec2 sp = SP();
    vec2 d = normalize(vec2(0.62, 0.78));
    vec2 n = vec2(-d.y, d.x);
    // 光柱的起點在窗上；往右下走越遠越淡
    vec2 o = vec2(900.0, 300.0);
    float along = dot(sp - o, d), across = dot(sp - o, n);
    float band = 0.5 + 0.5 * snoise(vec2(across / 90.0, t * 0.05));
    band = pow(band, 3.0) + 0.35 * pow(0.5 + 0.5 * snoise(vec2(across / 260.0 + 7.0, t * 0.03)), 2.0);
    float fall = smoothstep(-100.0, 300.0, along) * exp(-max(along, 0.0) / 650.0);
    float inWin = smoothstep(-620.0, -380.0, across) * (1.0 - smoothstep(380.0, 620.0, across));
    vec3 c = mix(C_SIGNAL, C_EMBER, 0.5) * 0.035 * band * fall * inWin * k;
    fragColor = vec4(c, 1.0);
  }`, { ...camUniforms(), t: { value: 0 }, k: { value: 1 }, win: { value: new THREE.Vector4() } }, { blending: THREE.AdditiveBlending, transparent: true });

export default class StainedGlass extends Scene {
  bg = shared('stainedglass.bg', BG);
  rays = shared('stainedglass.rays', RAYS);
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
  paneT = 0; sweep = 0.4; sigT = 0;
  lyrSize = 52;
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
    const names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}${names}${INVITE}${song.title}${song.artist}——一位賓客`);
    // 中間那片在第一拍亮（光由左往右掃過），之後每一拍亮一圈
    this.paneT = gr.b0;
    this.sweep = clamp(gr.beat * 0.9, 0.3, 0.6);
    this.ringT = stagger(au, au.timeOfBeat(au.beatAt(gr.b0) + 1), RINGS, Math.min(gr.bar * 1.25, Math.max(gr.beat, (e - gr.b0) * 0.45)));
    if (m) {
      const b = (this.block = msgBlock(c, m, FAM_MSG, MSG_BOX, { align: 'center', sigFamily: FAM_SIG, sigMin: 42, sigMax: 54, min: 48, max: 132, lineHeight: 1.3, maxLines: 5 }));
      this.lyrSize = lyricSizeFor(b.fit.size);
      this.avoid = [b.box, [PRED.x0, PRED.y0, PRED.x1 - PRED.x0, PRED.y1 - PRED.y0]];
    } else {
      this.avoid = [[PANE.x0, PANE.y0, PANE.x1 - PANE.x0, PANE.y1 - PANE.y0]];
      if (!this.hasLyrics) this.names = fitText(this.glyph.ctx, names, FAM_LYR, PANE.x1 - PANE.x0 - 200, 200, { min: 80, max: 150, maxLines: 1 });
    }
  }

  /** 把留言畫進「顏料」圖層（只畫一次）：深色的彩繪字、署名、一圈細細的描邊裝飾。 */
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
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ink', 0.8);
      c.fillText('FROM THE COUPLE  ·  新人', PANE.x0 + 56, PANE.y0 + 72);
      c.letterSpacing = '0px';
    }
  }

  /** 鏡頭：從窗的下方偏右仰看，切進來時往上搖落定，之後慢慢推近。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const land = prog(t, s, Math.max(s + 0.4, this.paneT - 0.05), ease.outExpo);
    const p = clamp((t - s) / (e - s));
    const side = hash(this.seed, 7) < 0.5 ? 1 : -1;
    const F0 = 1600;
    return {
      tx: 870 + 70 * side * (1 - land) + 20 * side * (p - 0.5),
      ty: 560 + 190 * (1 - land),
      dist: F0 * (1.02 - 0.045 * ease.inOutQuad(p) + 0.05 * (1 - land)),
      pitch: 0.16 + 0.12 * (1 - land),
      yaw: -0.13 * side,
      level: 0.9,
      focal: F0,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    if (!this.paintReady) { this.drawPaint(); this.paint.upload(); this.paintReady = true; }
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    const arr = u.ringT!.value as number[];
    for (let i = 0; i < RINGS; i++) arr[i] = this.ringT[i] ?? 1e9;
    u.t!.value = t;
    u.paneT!.value = this.paneT; u.sweep!.value = this.sweep;
    // 窗外的光：像有雲飄過一樣慢慢變（t 的純函數），最後半拍被雲遮住暗下去
    const dark = prog(t, e - 0.45, e, ease.inCubic);
    u.light!.value = 1.05 + 0.08 * Math.sin(t * 0.37 + this.seed) + 0.05 * Math.sin(t * 0.91);
    u.kick!.value = f.a.kick;
    u.dark!.value = dark;
    u.mode!.value = this.msg ? 0 : 1;
    u.paint!.value = this.paint.texture;
    u.hasPaint!.value = this.block ? 1 : 0;

    // ---- 透光的玻璃字：歌詞（窗下緣一排，或沒有留言時在中間大大的）
    const G = this.glyph; G.clear();
    const c = G.ctx;
    const ink: KaraokeInk = { active: rgba('signal'), sung: rgba('bone', 0.9), unsung: rgba('bone', 0.14) };
    const on = prog(t, this.paneT, this.paneT + 0.3);
    const ly = lyricAt(lyrics, t);
    if (this.msg) {
      if (ly) {
        const st = { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: PRED.x1 - PRED.x0 - 240, maxRows: 1, align: 'center' as const };
        const lay = layoutRows(c, ly.line, st);
        c.save(); c.translate((PRED.x0 + PRED.x1) / 2, (PRED.y0 + PRED.y1) / 2 + lay.size * 0.36);
        drawRows(c, lay, FAM_LYR, t, ink, ly.k * on);
        c.restore();
      }
    } else {
      // 兩句之間（間奏）：中間那片不要空著——下一句先以暗的玻璃字擺著（還沒唱），窗格裡沒有下一句就留著剛唱完的那句
      const nx = lyrics.nextLine(t), ls = lyrics.lastLine(t);
      const line = ly?.line ?? (nx && nx.start < e ? nx : ls && ls.end > s - 4 ? ls : null);
      if (line) {
        const st = { family: FAM_LYR, size: 120, minSize: 64, maxW: PANE.x1 - PANE.x0 - 160, maxRows: 2, align: 'center' as const, lineHeight: 1.15 };
        const lay = layoutRows(c, line, st);
        const cy = (PANE.y0 + PANE.y1) / 2 - lay.height / 2 + lay.size * 0.84;
        c.save(); c.translate((PANE.x0 + PANE.x1) / 2, cy);
        drawRows(c, lay, FAM_LYR, t, ink, (ly ? ly.k : 1) * on);
        c.restore();
      } else if (this.names) {
        c.font = font(FAM_LYR, this.names.size); c.textAlign = 'center';
        c.fillStyle = rgba('bone', 0.9 * on);
        fillWithHearts(c, this.names.lines[0] ?? '', (PANE.x0 + PANE.x1) / 2 - this.names.width / 2, (PANE.y0 + PANE.y1) / 2 + this.names.size * 0.35, rgba('rose', on));
        c.textAlign = 'left';
      }
      c.font = font(F.hei(500), 30); c.letterSpacing = '4px'; c.textAlign = 'center';
      c.fillStyle = rgba('bone', 0.55 * prog(t, this.ringT[0] ?? s, (this.ringT[0] ?? s) + 0.3));
      c.fillText(INVITE, (PRED.x0 + PRED.x1) / 2, (PRED.y0 + PRED.y1) / 2 + 11);
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
      const x = (r1 * 1500 + 700 + 18 * Math.sin(t * (0.2 + r3 * 0.3) + i) + t * 6) % 1900;
      const y = (r2 * 900 + 150 + t * (8 + 10 * r3)) % 1000;
      const across = -(x - 900) * 0.78 + (y - 300) * 0.62;
      const inBeam = clamp(1 - Math.abs(across) / 700) * on * (1 - dark);
      const tw = 0.5 + 0.5 * Math.sin(t * (1.3 + r3) + i * 2.1);
      const a = inBeam * tw * 0.8;
      if (a < 0.02) continue;
      db.seg2(x, y, x + 0.6, y + 0.6, 1.6 + r3 * 1.6, [sig[0] * a, sig[1] * a, sig[2] * a], 1);
    }
    if (db.count) db.render(renderer, out);
    const avoid = this.avoid.map((r) => this.cam.screenRect(r, 10));
    return { bloom: 0.7, bloomThreshold: 0.85, vignette: 0.62, halation: 0.35, popupAvoid: avoid };
  }
}
