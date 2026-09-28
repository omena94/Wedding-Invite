// 熱氣球（亮）：一張版畫風的紙，一群熱氣球在升空。鏡頭跟著主角那顆一起往上升，雲與遠方的氣球往下退（視差）。
//  - 畫面的焦點＝主打留言：寫在主角那顆大氣球的球皮上，跨過一條條直的球皮（像在地球儀上寫字：中間正、兩邊跟著球面收），
//    第一拍起一個字一個字寫上去（剛寫的是訊號色的暗部，半秒後乾成墨色），署名在最後一行下面。
//  - 每個小節線（與大鼓），燃燒器「呼」地噴一下火：吊籃上方一團暖光，球皮下半從裡面透出光，整顆氣球往上一提。
//  - 歌詞（比留言小一級）寫在右邊那顆小氣球吊著的布條上，布條跟著風微微起伏，逐字跟唱。
//    沒有留言：歌詞寫在大氣球上（主角），布條上是新人的名字與日期、下面一行小小的邀請。純音樂：布條上是小小的歌名。
//  - 鏡頭：切進來時大氣球從下面升上來、第一拍落定；之後雲一直往下退，大氣球輕輕晃。
// 手法：整張是一個全螢幕 shader：紙、版畫線（沿著球皮的經線排的排線，暗面密、亮面疏）、雲（橫的排線）、
// 球皮的配色（一條紙色、一條淡淡的訊號色，像手工上色的版畫）；留言與歌詞各是一張 Canvas 圖層，shader 把它們包到球面、布條上。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, frameIdx } from '../engine/util';
import { lyricAt, beatAfter, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { layoutRows, drawRows, paperInk } from './_t4';
import { T23_INVITE, T23_TEXT, sigOf, layMsg, stagger, winBars, lastBefore, type MsgLay, type Rect } from './_t23';

export const spec: PlateSpecDecl = { group: 'type', family: 'instrument', paper: true, energy: [0.1, 0.75], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（畫面座標，y 向下）
/** 主角氣球：球心、半徑；球皮在球的下半收成倒錐到吊籃。 */
const B = { x: 745, y: 452, r: 392 };
/** 留言展開圖（弧長 px）：寬、高，中心在緯度 LAT0（負的是赤道上面）。 */
const MW = 900, MH = 560, LAT0 = -0.1;
/** 右邊的小氣球與它吊的布條。 */
const B2 = { x: 1530, y: 250, r: 132 };
const BAN = { x: 1170, y: 560, w: 650, h: 150 };
const FAM_MSG = F.hand(700);
const FAM_LYR = F.archivo(100, 500);
const GORES = 16;

const SKY = () => new FSPass(/* glsl */ `
  uniform sampler2D uMsg; uniform sampler2D uLyr;
  uniform vec2 uOff;   // 主角氣球的位移（升上來、晃、被火一提）
  uniform float uScroll; uniform float uFire; uniform float uT; uniform float uBan;

  vec4 lay(sampler2D s, vec2 uv) { return fastLayer(texture(s, vec2(uv.x, 1.0 - uv.y))); }
  // 版畫的排線：沿著 u 排的線，暗的地方線粗
  // （darkness 是 0 的時候 hatch 還會留一條細線：亮的地方直接不要線）
  float ink(float u, float dark) { return hatch(u, clamp(dark, 0.0, 1.0)) * smoothstep(0.0, 0.06, dark); }

  // 雲：一排扁扁的圓疊起來（積雲），下緣平；回傳 SDF
  float cloud(vec2 p, vec2 c, float w) {
    float d = 1e9;
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float x = (fi / 7.0 - 0.5) * w;
      float rr = w * (0.09 + 0.07 * sin(fi * 2.1 + c.x * 0.01) * sin(fi * 2.1 + c.x * 0.01) + 0.05 * (1.0 - abs(fi / 7.0 - 0.5) * 2.0));
      vec2 o = vec2(x, -rr * 0.55);
      d = smin(d, length((p - c - o) * vec2(0.8, 1.0)) - rr, w * 0.05);
    }
    return max(d, p.y - c.y - 2.0);
  }

  // 氣球的外形（單位 = 半徑）：上面是球，y > YJ 之後用一條三次曲線收到開口（y = YM、半寬 WM），沒有折角
  const float YJ = 0.3, YM = 1.45, WM = 0.17;
  float halfW(float y) {
    if (y <= YJ) return sqrt(max(0.0, 1.0 - y * y));
    float w0 = sqrt(1.0 - YJ * YJ), s0 = -YJ / w0, s1 = -0.12;
    float L = YM - YJ, u = clamp((y - YJ) / L, 0.0, 1.0);
    float h00 = 2.0 * u * u * u - 3.0 * u * u + 1.0, h10 = u * u * u - 2.0 * u * u + u;
    float h01 = -2.0 * u * u * u + 3.0 * u * u, h11 = u * u * u - u * u;
    return h00 * w0 + h10 * L * s0 + h01 * WM + h11 * L * s1;
  }

  // 一顆氣球：c 球心、r 半徑、spin 自轉（球皮條紋往旁邊滑）、fade 遠近（遠的淡）、glow 裡面的火光；
  // 回傳 (顏色, 覆蓋率)；經緯度放在 ll（給字用）
  vec4 balloon(vec2 p, vec2 c, float r, float spin, float fade, float glow, out vec2 ll, out float inside) {
    vec2 q = (p - c) / r;
    inside = 0.0; ll = vec2(0.0);
    if (q.y < -1.02 || q.y > YM + 0.02) return vec4(0.0);
    float hw = max(halfW(q.y), 1e-3);
    // 距離：上半用球的距離（圓滑的頂），下半用左右的邊
    float d = q.y <= YJ ? length(q) - 1.0 : (abs(q.x) - hw) * 0.95;
    d = max(d, q.y - YM);
    float aa = 1.2 / r;
    float cov = 1.0 - smoothstep(-aa, aa, d);
    if (cov <= 0.0) return vec4(0.0);
    inside = cov;
    float nx = clamp(q.x / hw, -0.999, 0.999);
    float lon = asin(nx);
    float lat = asin(clamp(q.y, -1.0, 1.0));
    ll = vec2(lon, lat);
    float nz = sqrt(max(0.0, 1.0 - nx * nx));
    // 燈光從左上：亮面、暗面（下半收進去的地方朝下，暗一點）
    vec3 N = normalize(vec3(nx, q.y <= YJ ? q.y : YJ + (q.y - YJ) * 0.5, nz));
    float lit = clamp(dot(N, normalize(vec3(-0.55, -0.5, 0.65))), 0.0, 1.0);
    // 球皮：一條紙色、一條淡淡的訊號色（手工上色）
    float g = (lon + spin) / TAU * ${GORES}.0;
    float gi = mod(floor(g), 2.0);
    vec3 wash = mix(C_PAPER, mix(C_SIGNAL, C_BLOOD, 0.25), 0.36);
    vec3 col = mix(C_PAPER * 1.02, wash, gi);
    // 版畫排線：沿著經線，只在暗面（亮面乾乾淨淨），很暗的地方加一層橫的
    float dark = pow(1.0 - lit, 1.6) * 0.85 - 0.12;
    float h1 = ink(g * 5.0, dark * 0.6);
    float h2 = ink((q.y * r) / 6.0, dark * dark - 0.3);
    float lines = max(h1, h2);
    // 接縫（每條球皮的邊）與上下兩道加強環
    float seam = pxLine(abs(fract(g + 0.5) - 0.5) * r * TAU / ${GORES}.0 * nz, 0.35, 1.3);
    float band = pxLine(abs(q.y - 0.62) * r, 0.5, 1.6) + pxLine(abs(lat + 0.86) * r, 0.5, 1.5);
    vec3 inkc = C_SEPIA;
    col = mix(col, inkc, clamp(lines * 0.5 + seam * 0.6 + band * 0.55, 0.0, 1.0));
    col = mix(col, inkc, (1.0 - smoothstep(0.0, 2.0, abs(d * r))) * 0.85);
    // 燃燒器的火光：球皮下半從裡面透出來
    col += mix(C_SIGNAL, C_EMBER, 0.4) * glow * 0.3 * smoothstep(-0.1, 1.2, q.y) * (0.4 + 0.6 * nz);
    // 遠的氣球：往紙色退（空氣透視）
    col = mix(C_PAPER, col, fade);
    return vec4(col, cov);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // ---- 紙：纖維、上面一點點亮（天空）
    vec3 col = C_PAPER * (0.965 + 0.025 * snoise(p / 5.0) + 0.02 * fbm(p / 400.0, 3)) * (1.0 + 0.03 * (1.0 - p.y / 1080.0));
    // ---- 遠方的雲（往下退，視差）：版畫的橫排線，只有下半（背光）有線
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float par = 0.35 + 0.22 * fi;
      float yy = mod(300.0 + fi * 360.0 + uScroll * par, 1600.0) - 220.0;
      vec2 cc = vec2(mod(260.0 + fi * 690.0, 2200.0) - 140.0, yy);
      float w = 420.0 + 110.0 * fi;
      float d = cloud(p, cc, w);
      if (d < 2.0) {
        float fade = 0.5 + 0.12 * fi;
        float below = smoothstep(cc.y - w * 0.12, cc.y, p.y);
        float hl = ink(p.y / 5.0, (0.08 + 0.4 * below) * fade);
        vec3 cl = mix(C_PAPER * 1.01, C_SEPIA, hl * 0.4);
        cl = mix(cl, C_SEPIA, (1.0 - smoothstep(0.0, 1.5, abs(d))) * 0.55 * fade);
        col = mix(col, cl, 1.0 - smoothstep(-1.0, 1.0, d));
      }
    }
    vec2 ll; float ins;
    // ---- 遠的小氣球（左上、中上），慢慢往下退、自己轉
    vec4 b3 = balloon(p, vec2(250.0, mod(210.0 + uScroll * 0.5, 1400.0) - 150.0), 70.0, uT * 0.25, 0.45, 0.0, ll, ins);
    col = mix(col, b3.rgb, b3.a);
    vec4 b4 = balloon(p, vec2(1250.0, mod(90.0 + uScroll * 0.32, 1400.0) - 150.0), 46.0, uT * 0.3 + 1.0, 0.35, 0.0, ll, ins);
    col = mix(col, b4.rgb, b4.a);
    // ---- 右邊的小氣球（吊著歌詞的布條）：跟著我們一起升，只輕輕晃
    vec2 c2 = vec2(${B2.x}.0, ${B2.y}.0 + 6.0 * sin(uT * 0.9 + 1.0));
    vec4 b2 = balloon(p, c2, ${B2.r}.0, uT * 0.2 + 2.0, 0.8, 0.0, ll, ins);
    // 吊籃與繩子
    vec2 bk2 = c2 + vec2(0.0, ${B2.r}.0 * 1.72);
    float r2 = min(sdSegment(p, c2 + vec2(-18.0, ${B2.r}.0 * 1.42), bk2 + vec2(-13.0, -12.0)), sdSegment(p, c2 + vec2(18.0, ${B2.r}.0 * 1.42), bk2 + vec2(13.0, -12.0)));
    col = mix(col, C_SEPIA, pxLine(r2, 0.4, 1.4) * 0.8);
    float bkd = sdBox(p - bk2, vec2(15.0, 12.0));
    col = mix(col, mix(C_PAPER, C_SEPIA, 0.55 + 0.3 * ink(p.x / 4.0, 0.5)), 1.0 - smoothstep(-0.8, 0.8, bkd));
    col = mix(col, b2.rgb, b2.a);
    // 布條：從吊籃拉下來的兩條繩、一條隨風起伏的布
    float wav = 10.0 * sin((p.x - ${BAN.x}.0) * 0.012 - uBan) * smoothstep(${BAN.x + BAN.w}.0, ${BAN.x}.0, p.x);
    vec2 bp = vec2(p.x, p.y - wav);
    float ropeA = sdSegment(p, bk2 + vec2(-8.0, 10.0), vec2(${BAN.x + BAN.w - 30}.0, ${BAN.y}.0 + 10.0 * sin(-uBan + ${(BAN.w - 30) * 0.012})));
    col = mix(col, C_SEPIA, pxLine(ropeA, 0.4, 1.4) * 0.7);
    float bd = sdBox(bp - vec2(${BAN.x + BAN.w / 2}.0, ${BAN.y + BAN.h / 2}.0), vec2(${BAN.w / 2}.0, ${BAN.h / 2}.0));
    // 燕尾：左端剪一個 V
    bd = max(bd, -((bp.x - ${BAN.x}.0) - 46.0 * (1.0 - abs(bp.y - ${BAN.y + BAN.h / 2}.0) / ${BAN.h / 2}.0)));
    if (bd < 2.0) {
      float shade = 0.94 + 0.06 * cos((p.x - ${BAN.x}.0) * 0.012 - uBan);
      vec3 cloth = mix(C_PAPER, C_BONE, 0.35) * shade;
      cloth = mix(cloth, C_SEPIA, ink(bp.y / 5.0, (1.0 - shade) * 5.0) * 0.3);
      vec2 uv = (bp - vec2(${BAN.x}.0, ${BAN.y}.0)) / vec2(${BAN.w}.0, ${BAN.h}.0);
      vec4 L = lay(uLyr, uv);
      cloth = cloth * (1.0 - L.a) + L.rgb;
      cloth = mix(cloth, C_SEPIA, (1.0 - smoothstep(0.0, 1.8, abs(bd))) * 0.8);
      col = mix(col, cloth, 1.0 - smoothstep(-0.8, 0.8, bd));
    }
    // ---- 主角氣球：吊籃、繩子、火、球皮與上面的字
    vec2 c1 = vec2(${B.x}.0, ${B.y}.0) + uOff;
    vec2 bk = c1 + vec2(0.0, ${B.r}.0 * 1.62);
    for (int k = 0; k < 4; k++) {
      float sx = float(k) - 1.5;
      float rp = sdSegment(p, c1 + vec2(sx * 36.0, ${B.r}.0 * 1.41), bk + vec2(sx * 30.0, -30.0));
      col = mix(col, C_SEPIA, pxLine(rp, 0.5, 1.6) * 0.85);
    }
    // 燃燒器的火：開口下面一團暖光（會發光）
    float fl = length((p - (c1 + vec2(0.0, ${B.r}.0 * 1.47))) / vec2(26.0, 46.0));
    col += mix(C_SIGNAL, C_EMBER, 0.6) * uFire * 2.2 * exp(-fl * fl * 2.0);
    // 吊籃：編織的排線
    float bkb = sdBox(p - bk, vec2(46.0, 34.0)) - 4.0;
    vec3 wk = mix(C_PAPER, C_SEPIA, 0.35 + 0.35 * max(ink((p.x + p.y) / 6.0, 0.5), ink((p.x - p.y) / 6.0, 0.5)));
    col = mix(col, wk, 1.0 - smoothstep(-0.8, 0.8, bkb));
    col = mix(col, C_SEPIA, pxLine(abs(bkb), 0.6, 1.8));
    // 自轉半條球皮：正中間是一條球皮的中線（不是接縫），字不會被一條線劈開
    vec4 b1 = balloon(p, c1, ${B.r}.0, PI / ${GORES}.0, 1.0, uFire, ll, ins);
    if (b1.a > 0.0) {
      vec3 bc = b1.rgb;
      // 字：經度 → 展開圖的 x（弧長）、緯度 → y
      vec2 uv = vec2((ll.x * ${B.r}.0 + ${MW / 2}.0) / ${MW}.0, ((ll.y - ${LAT0}) * ${B.r}.0 + ${MH / 2}.0) / ${MH}.0);
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        vec4 L = lay(uMsg, uv);
        // 字底下先把排線擦淡一點（寫字的地方是乾淨的球皮），字才清楚
        float clean = smoothstep(0.0, 0.25, lay(uMsg, uv + vec2(0.004, 0.0)).a + lay(uMsg, uv - vec2(0.004, 0.0)).a + L.a);
        bc = mix(bc, mix(C_PAPER, bc, 0.5), clean * 0.35);
        bc = bc * (1.0 - L.a) + L.rgb;
      }
      col = mix(col, bc, b1.a);
    }
    fragColor = vec4(col, 1.0);
  }`, {
  uMsg: { value: null }, uLyr: { value: null }, uOff: { value: new THREE.Vector2() },
  uScroll: { value: 0 }, uFire: { value: 0 }, uT: { value: 0 }, uBan: { value: 0 },
});

export default class Balloon extends Scene {
  sky = shared('balloon.sky', SKY);
  /** 大氣球上的字（展開圖）。 */
  mtx = this.track(new Layer2D(MW, MH, undefined, { fast: true }));
  /** 布條上的字。 */
  ltx = this.track(new Layer2D(BAN.w, BAN.h, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  lay: MsgLay | null = null;
  gT: number[] = [];
  sigT = Infinity;
  tOn = 0;
  fires: number[] = [];
  hasLyr = false;
  lyrSize = 52;
  mKey = '';
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    this.hasLyr = lines.length > 0;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T23_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}${DATE_DOTS}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    const bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    // 燃燒器：每個小節線噴一下（切進來的第一拍也噴）
    this.fires = [...winBars(au, s - 3, e), this.tOn].sort((a, b) => a - b);
    if (m) {
      this.lay = layMsg(this.mtx.ctx, m.text, sig, FAM_MSG, { x: 90, y: 40, w: MW - 180, h: MH - 80 }, { min: 50, max: 150, lineHeight: 1.2, maxLines: 5, sigFamily: F.hand(700), sigSize: [40, 48], align: 'center' });
      // 署名放在中間（球面兩邊會被壓扁，靠右的署名讀不清楚）
      this.lay.sig.x = MW / 2 - this.lay.sig.w / 2;
      this.lyrSize = Math.max(48, Math.min(56, Math.round(this.lay.fit.size * 0.72)));
      const n = this.lay.glyphs.filter((g) => g.row >= 0).length;
      this.gT = stagger(au, this.tOn, n, Math.min(1.5 * bar, Math.max(0.6, 0.4 * (e - this.tOn))));
      this.sigT = (this.gT[this.gT.length - 1] ?? this.tOn) + beat * 0.5;
    }
    this.avoid = [[B.x - 330, B.y - 260, 660, 480], [BAN.x, BAN.y, BAN.w, BAN.h]];
  }

  /** 大氣球上的字：有留言時寫留言（寫字的時候每格重畫、寫完就不動）；沒有留言時是跟唱的歌詞（每格重畫）。 */
  private drawMsg(t: number) {
    const L = this.mtx, c = L.ctx, m = this.msg;
    if (m && this.lay) {
      const key = t < this.sigT + 0.6 ? `w${frameIdx(t)}` : 'done';
      if (key === this.mKey) return;
      this.mKey = key;
      L.clear();
      c.textBaseline = 'alphabetic';
      let i = 0;
      for (const g of this.lay.glyphs) {
        if (g.row < 0) continue;
        const tg = this.gT[i++]!;
        if (t < tg) break;
        const wet = 1 - clamp((t - tg) / 0.5);
        c.globalAlpha = ease.outCubic(clamp((t - tg) / 0.08));
        if (g.ch === '♥') { drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92); continue; }
        c.font = font(FAM_MSG, g.size);
        c.fillStyle = wet > 0 ? mixRgba('sepia', 'blood', wet) : rgba('sepia', 0.96);
        c.fillText(g.ch, g.x, g.y);
      }
      c.globalAlpha = 1;
      if (t >= this.sigT) {
        c.globalAlpha = prog(t, this.sigT, this.sigT + 0.3);
        c.font = font(this.lay.sig.family, this.lay.sig.size); c.fillStyle = rgba('sepia', 0.85);
        c.fillText(this.lay.sig.text, this.lay.sig.x, this.lay.sig.y);
        c.globalAlpha = 1;
      }
      L.upload();
      return;
    }
    // 沒有留言：大氣球上是跟唱的歌詞（主角）；句子之間的空檔是新人的名字
    L.clear();
    const { lyrics } = this.ctx;
    const ly = this.hasLyr ? lyricAt(lyrics, t) : null;
    if (ly) {
      const lay = layoutRows(c, ly.line, { family: F.archivo(100, 800), size: 120, minSize: 84, maxW: MW - 160, maxRows: 3, align: 'center', lineHeight: 1.08 });
      c.save(); c.translate(MW / 2, MH / 2 - lay.height / 2 + lay.size * 0.8);
      drawRows(c, lay, F.archivo(100, 800), t, paperInk(), ly.k);
      c.restore();
    } else {
      c.font = font(F.hand(700), 110); c.fillStyle = rgba('sepia', 0.9); c.textAlign = 'center';
      c.fillText(COUPLE_ZH, MW / 2, MH / 2 + 30); c.textAlign = 'left';
    }
    L.upload();
  }

  /** 布條：歌詞（有留言）或新人的名字與邀請（沒有留言）。 */
  private drawBanner(t: number) {
    const L = this.ltx, c = L.ctx, { lyrics, song } = this.ctx;
    L.clear();
    if (this.msg) {
      const ly = this.hasLyr ? lyricAt(lyrics, t) : null;
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: BAN.w - 60, maxRows: 2, align: 'center', lineHeight: 1.1 });
        c.save(); c.translate(BAN.w / 2, BAN.h / 2 - lay.height / 2 + lay.size * 0.8);
        drawRows(c, lay, FAM_LYR, t, paperInk(), ly.k);
        c.restore();
      } else if (!this.hasLyr) {
        c.font = font(F.serif(400, true), 40); c.fillStyle = rgba('sepia', 0.7); c.textAlign = 'center';
        c.fillText(`♪ ${song.title}`, BAN.w / 2, BAN.h / 2 + 14); c.textAlign = 'left';
      }
    } else {
      c.textAlign = 'center';
      c.font = font(F.ming(700), 50); c.fillStyle = rgba('sepia', 0.9); c.letterSpacing = '6px';
      c.fillText(COUPLE_ZH, BAN.w / 2, 70);
      c.font = font(F.hei(500), 21); c.fillStyle = rgba('sepia', 0.6); c.letterSpacing = '2px';
      c.fillText(`${DATE_DOTS}　·　${T23_INVITE}`, BAN.w / 2, 118);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const u = this.sky.u;
    // 燃燒器：最近一次噴火；噴火那一下整顆往上一提
    const lf = lastBefore(this.fires, t);
    const fire = t >= lf ? Math.exp(-(t - lf) / 0.35) : 0;
    const lift = t >= lf ? -14 * ease.outCubic(clamp((t - lf) / 0.4)) * Math.exp(-Math.max(0, t - lf - 0.4) / 0.8) : 0;
    // 升上來：從下面 260 px 升到定位（第一拍落定）
    const rise = ease.outExpo(prog(t, s, Math.max(s + 0.35, this.tOn + 0.1)));
    const bob = 5 * Math.sin((t - s) * 0.8);
    (u.uOff!.value as THREE.Vector2).set(3 * Math.sin((t - s) * 0.5), 260 * (1 - rise) + bob + lift);
    u.uScroll!.value = 16 * (t - s) + 180 * (1 - rise);
    u.uFire!.value = Math.min(1, fire * (0.8 + 0.3 * f.a.kick));
    u.uT!.value = t;
    u.uBan!.value = t * 1.6;
    this.drawMsg(t);
    this.drawBanner(t);
    u.uMsg!.value = this.mtx.texture;
    u.uLyr!.value = this.ltx.texture;
    this.sky.render(renderer, out);
    return { paper: 1, bloom: 0.5, vignette: 0.25, grain: 0.045, halation: 0.15, popupAvoid: this.avoid };
  }
}
