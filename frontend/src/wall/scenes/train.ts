// 火車窗景（暗）：夜車，從車廂裡看著一扇大車窗，窗外的夜景往後流。
//  - 進場：車子還在隧道裡（窗外一片黑，隧道燈一盞一盞刷過去），第一拍衝出隧道——窗外亮開：遠山、地平線上的小城、
//    田野裡的樹與人家，一路往後流（越近越快）。
//  - 電線桿「在拍點經過」：每一拍正好有一根電線桿刷過窗子中間（很快、糊掉的一道影子），桿子之間的電線一上一下地起伏；
//    大鼓一打，窗外的景晃一下（鐵軌的接縫）。
//  - 窗子左下角起了一片霧（車廂裡暖、外面冷；留言標準 v2：只比字大一圈），主打留言是有人用手指在霧上寫的字（畫面的焦點）：
//    第一拍起一個字一個字擦開，擦開的地方看得到外面流過的夜景，署名寫在最後一行下面。
//  - 歌詞是遠方小城一棟樓頂上的霓虹招牌：句子快要唱的時候招牌「閃兩下」亮起來，還沒唱的字是暗的燈管，
//    唱到的那一刻亮成訊號色，唱完變成白光；唱完一句招牌熄掉，下一句換一塊。招牌跟著遠景很慢地往後移。
//  - 沒有留言：招牌是主角（字大一級、在窗子中間），霧只有窗角一小片，上面畫了一顆愛心；窗框上一行小字邀請。
//    純音樂：招牌是歌名。窗格夠長時，最後一拍又鑽進下一個隧道。
//  - 窗格中段的小事件：每兩個小節開過一個平交道（兩盞燈照拍子輪流閃）；田裡一畦一畦照透視的速度往後流。
// 手法：窗外（天空、遠山、城市剪影、田野、電線桿與電線、道碴的流線、隧道）、霧、車窗框與玻璃的反光在一個 shader；
// 霧上的指痕在 init() 畫成資料貼圖（_t25 glyphMask，覆蓋率模糊加粗過），shader 依每個字擦到哪決定透出多少；
// 招牌（Canvas2D，每格重畫在它現在的位置）在 shader 裡取樣，才會被電線桿擋到；正在唱的字另外畫一張發光層加亮疊上去。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse } from '../engine/util';
import { type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, COUPLE_ZH, type LyricStyle } from './_motifs';
import { V2, lyricV2 } from './_v2';
import {
  T25_TEXT, T25_INVITE, sigOf, winBars, winBeats, stagger, layMsgV2, msgGlyphs, glyphMask, MASK_GLSL,
  type GlyphMask, type MsgLay, type Rect, type MaskGlyph,
} from './_t25';

export const spec: PlateSpecDecl = { group: 'type', family: 'journey', paper: false, energy: [0.2, 1], bars: [4, 8] };

/** 車窗（玻璃）範圍與圓角。 */
const WIN = { x0: 118, y0: 80, x1: 1802, y1: 806, r: 64 };
/** 霧上寫字的範圍（下半部，扣掉署名）；霧比它大一圈。 */
// 留言標準 v2：寫字的那片霧在窗子左下（字 ≤ 760×300、霧 ≤ 860×430），右邊與上面整片是窗外流過的夜景（主視覺）；
// 窗子下緣收在 y = 806，右下角 QR 那一塊是車廂的牆板（乾淨、不動）。
const MSG_BOX = { x: 200, y: 470, w: 760, h: 300 };
const FM_RECT: Rect = [150, 420, 880, 420];
/** 招牌（歌詞）：有留言時在上面、比留言小一級；沒有留言時在窗子中間、字大。 */
const SIGN_Y = 262, SIGN_Y_SOLO = 420;
const SIGN_W = 1340;
/** 地平線、遠景的速度（px/秒）、電線桿間距（一拍一根）。 */
const HORIZON = 470;
const V = { far1: 5, far2: 12, city: 20, mid: 240, bal: 5200 };
const POLE_GAP = 1500;
const FAM_MSG = F.hand(700);
const FAM_SIGN = F.archivo(75, 900);
const PLATE = '本列車開往：幸福　·　下一站：永遠';

const BG = () => new FSPass(/* glsl */ `
  uniform float t, lt;
  uniform float xFar1, xFar2, xCity, xMid, xBal, tunX;
  uniform vec4 poles; uniform float bob; uniform float tun;
  uniform vec4 xing; // 平交道：x（畫面）、左燈、右燈、有沒有
  uniform sampler2D sign; uniform vec4 bld; uniform float signOn;
  uniform sampler2D fm; uniform float shown; uniform float fogK; uniform vec4 fog; uniform float heartOn;
  ${MASK_GLSL}
  const vec4 FR = vec4(${FM_RECT.join('.0, ')}.0);

  float ridge(float x, float base, float amp, float sc, float seed) {
    return base - amp * (0.55 + 0.45 * fbm(vec2(x / sc, seed), 4));
  }
  // 窗外（沒有霧、沒有玻璃的樣子）
  vec3 view(vec2 p) {
    vec2 q = p + vec2(0.0, bob);
    // 天空：上面深，地平線有一點小城的暖光
    vec3 col = mix(C_INK * 0.55, C_INK2 * 1.05 + C_SIGNAL * 0.03, smoothstep(60.0, ${HORIZON}.0, q.y));
    // 月亮與被月光照到的雲（很慢，幾乎不動）
    vec2 mp = q - vec2(1580.0 - xFar1 * 0.3, 176.0);
    float md = length(mp);
    col += C_BONE * 0.42 * (1.0 - smoothstep(31.0, 33.0, md)) + (C_BONE * 0.025 + C_SIGNAL * 0.006) * exp(-max(0.0, md - 32.0) / 160.0);
    float cl = fbm(vec2((q.x + xFar1 * 2.0) / 520.0, q.y / 150.0), 4);
    col += (C_ASH * 0.035 + C_SIGNAL * 0.004) * smoothstep(0.1, 0.7, cl) * (1.0 - smoothstep(330.0, 440.0, q.y)) * (0.5 + 0.8 * exp(-md / 500.0));
    vec2 sg = floor(q / 6.0);
    col += C_BONE * 0.28 * step(0.9975, hash12(sg + floor(xFar1 / 6.0) * vec2(1.0, 0.0))) * (1.0 - smoothstep(200.0, 420.0, q.y));
    // 遠山兩層（很慢）
    float r1 = ridge(q.x + xFar1, 430.0, 150.0, 520.0, 1.3);
    if (q.y > r1) col = C_INK2 * 0.62 + C_GRAPHITE * 0.03 + C_ASH * 0.03 * (1.0 - smoothstep(0.0, 18.0, q.y - r1));
    // 小城的剪影（一棟一棟不同高度的樓），窗戶的小燈
    float cx = q.x + xCity;
    float cw = 46.0, id = floor(cx / cw);
    float bh = 18.0 + 70.0 * pow(hash11(id * 1.7 + 0.3), 2.0) * step(0.25, hash11(id + 9.0));
    if (q.y > ${HORIZON}.0 - bh) {
      col = C_INK * 0.9 + C_INK2 * 0.2;
      vec2 wc = floor(vec2(cx, q.y) / vec2(7.0, 9.0));
      float lit = step(0.84, hash12(wc + 3.3)) * step(3.0, mod(cx, cw)) * step(mod(cx, cw), cw - 5.0);
      vec2 wf = fract(vec2(cx, q.y) / vec2(7.0, 9.0));
      lit *= step(0.25, wf.x) * step(wf.x, 0.75) * step(0.3, wf.y) * step(wf.y, 0.7);
      col += mix(C_SIGNAL * 0.55, C_BONE * 0.4, hash12(wc)) * lit;
    }
    // 掛招牌的那一棟（比別的高），招牌下面的鐵架
    if (signOn > 0.0) {
      float rail = (1.0 - smoothstep(1.0, 2.2, abs(q.y - bld.w - 6.0))) * step(bld.x - 20.0, q.x) * step(q.x, bld.z + 20.0);
      float posts = (1.0 - smoothstep(1.0, 2.0, abs(mod(q.x - bld.x, 90.0) - 45.0))) * step(bld.w - 4.0, q.y) * step(q.y, bld.w + 24.0) * step(bld.x - 10.0, q.x) * step(q.x, bld.z + 10.0);
      col += C_GRAPHITE * 0.07 * max(rail, posts) * (0.4 + 0.6 * signOn);
      // 招牌照亮它下面的鐵架與樓頂（一點點訊號色）
      col += C_SIGNAL * 0.02 * signOn * exp(-max(0.0, q.y - bld.w) / 12.0) * step(bld.x, q.x) * step(q.x, bld.z) * step(bld.w, q.y) * step(q.y, bld.w + 26.0);
      vec4 sc = fastLayer(texture(sign, vec2(q.x / ${W}.0, 1.0 - q.y / ${H}.0)));
      col = col * (1.0 - sc.a) + sc.rgb;
    }
    // 近一點的山稜（地平線上）
    float r2 = ridge(q.x + xFar2, ${HORIZON + 22}.0, 34.0, 300.0, 7.7);
    if (q.y > r2) col = C_INK * 0.7;
    // 田野：地平線以下，越近越亮一點；樹與人家（中景，流得比較快）
    if (q.y > ${HORIZON + 18}.0) {
      col = mix(C_INK * 0.6, C_INK2 * 0.7, smoothstep(${HORIZON}.0, 820.0, q.y));
      // 田：跟鐵軌平行的一畦一畦（透視：越近間距越大），每一畦的作物深淺不一、照透視的速度往後流
      // （離地平線越遠流得越慢）；間距比一個 px 還密的遠處淡掉，不然會出現摩爾紋
      float dy = max(q.y - ${HORIZON}.0, 1.0);
      float row = 2600.0 / dy;
      float rowL = 1.0 - smoothstep(0.0, 0.14, abs(fract(row) - 0.5) - 0.36);
      float px = (q.x + xMid * dy / 170.0) * 170.0 / dy;
      float crop = fbm(vec2(px / 260.0, floor(row) * 1.7), 3);
      float nearK = smoothstep(${HORIZON + 30}.0, 600.0, q.y) * (1.0 - smoothstep(700.0, 790.0, q.y));
      col += (C_ASH * 0.035 * smoothstep(0.35, 0.75, crop) + C_ASH * 0.012 * rowL) * nearK;
      float mx = q.x + xMid;
      float mw = 230.0, mid = floor(mx / mw), mf = mx - mid * mw;
      float kind = hash11(mid * 3.1 + 1.0);
      float base = 640.0 + 40.0 * hash11(mid + 4.0);
      if (kind < 0.45) {
        // 樹：圓圓的樹冠＋細樹幹
        float r = 30.0 + 40.0 * hash11(mid + 7.0);
        float d = length(vec2(mf - mw * 0.5, q.y - (base - r * 1.4)) / vec2(1.0, 1.15)) - r;
        float trunk = step(abs(mf - mw * 0.5), 4.0) * step(base - r, q.y) * step(q.y, base);
        if (d < 0.0 || trunk > 0.5) col = C_INK * 0.35;
      } else if (kind < 0.7) {
        // 人家：方塊＋斜屋頂、一扇亮的窗
        float hw = 44.0 + 30.0 * hash11(mid + 2.0), hh = 50.0 + 20.0 * hash11(mid + 5.0);
        float lx = mf - mw * 0.5;
        float roof = base - hh - (hw * 0.6 - abs(lx) * 0.6);
        if (abs(lx) < hw && q.y > roof && q.y < base) {
          col = C_INK * 0.38;
          vec2 wd = vec2(lx - hw * 0.3, q.y - (base - hh * 0.55));
          if (abs(wd.x) < 5.0 && abs(wd.y) < 6.5) col = (C_SIGNAL * 0.45 + C_EMBER * 0.06) * (step(1.0, abs(wd.x)) * step(1.0, abs(wd.y)) * 0.6 + 0.4);
        }
      }
      // 近處的地面與道碴：很快的橫流線
      float gy = smoothstep(730.0, 900.0, q.y);
      float streak = fbm(vec2((q.x + xBal) / 2600.0, q.y / 3.0), 2);
      col = mix(col, C_INK2 * (0.5 + 0.9 * streak) + C_GRAPHITE * 0.03, gy * 0.9);
      // 車窗的燈投在路邊：一塊一塊暖光往後刷（一節車廂好幾扇窗）
      float wl = smoothstep(0.35, 0.0, abs(fract((q.x + xBal * 0.9) / 520.0) - 0.5) - 0.15);
      col += C_SIGNAL * 0.03 * wl * smoothstep(760.0, 880.0, q.y);
    }
    // 平交道（每兩個小節經過一個）：一根柱子、交叉的號誌牌、兩盞一拍一拍輪流閃的燈，燈光灑在地上
    if (xing.w > 0.0) {
      float dx = q.x - xing.x;
      float post = step(abs(dx), 4.0) * step(452.0, q.y) * step(q.y, 700.0);
      vec2 xb = vec2(dx, q.y - 452.0);
      float cross = max(step(abs(xb.x - xb.y), 5.0), step(abs(xb.x + xb.y), 5.0)) * step(abs(xb.x), 30.0);
      if (post > 0.5 || cross > 0.5) col = C_INK * 0.4 + C_ASH * 0.06;
      for (int k = 0; k < 2; k++) {
        vec2 lc = vec2(xing.x + (k == 0 ? -24.0 : 24.0), 506.0);
        float on = k == 0 ? xing.y : xing.z;
        float d = length(q - lc);
        col = mix(col, C_INK * 0.3, 1.0 - smoothstep(12.0, 13.5, d));
        col += (C_SIGNAL * 1.8 + C_EMBER * 0.4) * on * (1.0 - smoothstep(7.0, 9.0, d)) + C_SIGNAL * 0.12 * on * exp(-d / 40.0);
        col += C_SIGNAL * 0.05 * on * exp(-length((q - vec2(lc.x, 690.0)) / vec2(90.0, 14.0)));
      }
    }
    // 電線：兩根桿子之間一條下垂的弧（桿子經過時電線跟著「上下」）
    vec4 ps = poles;
    for (int k = 0; k < 3; k++) {
      float a = k == 0 ? ps.x : k == 1 ? ps.y : ps.z;
      float b = k == 0 ? ps.y : k == 1 ? ps.z : ps.w;
      if (q.x >= a && q.x < b) {
        float u = (q.x - a) / (b - a);
        for (int i = 0; i < 3; i++) {
          float yw = 132.0 + float(i) * 20.0 + 70.0 * 4.0 * u * (1.0 - u);
          col = mix(col, C_ASH * 0.1, (1.0 - smoothstep(0.6, 1.6, abs(q.y - yw))) * 0.9);
        }
      }
    }
    // 電線桿：很快、糊成一道（盒狀模糊的覆蓋率）
    for (int k = 0; k < 4; k++) {
      float x = k == 0 ? ps.x : k == 1 ? ps.y : k == 2 ? ps.z : ps.w;
      float dx = q.x - x;
      float hw = 15.0, hb = 30.0;
      float cov = clamp((min(dx + hb, hw) - max(dx - hb, -hw)) / (2.0 * hb), 0.0, 1.0);
      float arm = step(abs(dx), 70.0 + hb) * step(118.0, q.y) * step(q.y, 128.0) * 0.35;
      // 桿子是很暗的剪影（天空被月光與小城照得比它亮），一點點被車窗的燈照到
      vec3 pc = C_INK * 0.1 + C_SIGNAL * 0.012 * smoothstep(100.0, 700.0, q.y);
      col = mix(col, pc, max(cov * step(100.0, q.y), arm));
    }
    // 隧道：一片黑、隧道燈一盞一盞刷過去（訊號色的橫線）
    if (tun > 0.0) {
      vec3 tc = C_INK * 0.25 + C_INK2 * 0.2 * smoothstep(900.0, 200.0, abs(q.y - 520.0) * 2.0);
      float lx = mod(q.x + tunX, 820.0);
      float lamp = exp(-pow((q.y - 214.0) / 7.0, 2.0)) * smoothstep(520.0, 0.0, lx) * smoothstep(0.0, 30.0, lx);
      tc += C_SIGNAL * 1.4 * lamp + C_SIGNAL * 0.05 * exp(-abs(q.y - 214.0) / 90.0);
      col = mix(col, tc, tun);
    }
    return col;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // ---- 車窗（圓角矩形）
    vec2 wc = vec2(${(WIN.x0 + WIN.x1) / 2}.0, ${(WIN.y0 + WIN.y1) / 2}.0), wh = vec2(${(WIN.x1 - WIN.x0) / 2}.0, ${(WIN.y1 - WIN.y0) / 2}.0);
    float wd = sdBox(p - wc, wh - ${WIN.r}.0) - ${WIN.r}.0;
    vec3 col;
    if (wd < 0.0) {
      vec3 v = view(p);
      // ---- 霧：窗子下半部一片，邊緣不規則；車廂的燈把霧照成暖暖的乳灰
      // 邊緣的起伏收小一點（霧只比字大一圈，字的附近要是整片濃霧，擦開的字才清楚）
      float fd = sdBox(p - fog.xy, fog.zw) + 42.0 * fbm(p / 170.0 + 3.0, 3);
      float fa = (1.0 - smoothstep(-40.0, 80.0, fd)) * fogK * (0.86 + 0.14 * smoothstep(fog.y - fog.w, fog.y + fog.w, p.y));
      float grain = 0.85 + 0.15 * fbm(p / 18.0, 2);
      vec3 fc = (C_ASH * 0.13 + C_SIGNAL * 0.018 + C_BONE * 0.01) * grain;
      // 隔著霧：外面的光只剩一點點（地平線那邊暖一點）
      fc += C_SIGNAL * 0.015 * smoothstep(560.0, 380.0, p.y);
      // 手指擦開的字（每個字依序擦開，擦開的地方看得到外面）
      vec4 m = maskAt(fm, FR, p);
      float gi = floor(m.g * 255.0 + 0.5);
      float rv = clamp((shown - gi - m.b) * 5.0, 0.0, 1.0);
      float clearK = smoothstep(0.28, 0.62, m.a) * rv;
      // 被手指推開的水氣：字的邊緣一圈亮一點
      float rim = smoothstep(0.08, 0.3, m.a) * (1.0 - smoothstep(0.3, 0.55, m.a)) * rv;
      fc += C_BONE * 0.05 * rim;
      // 擦開的字看得到外面，但外面亮的東西（平交道的燈、小城的窗）不能讓字比霧亮，字才一直讀得清楚
      vec3 through = min(v, fc * 0.22);
      // 愛心擦開的地方透一點點綴色
      if (m.r > 0.9) through = mix(v, C_ROSE * 0.35, 0.6);
      // 霧上零星的小水珠
      vec2 gc = floor(p / 19.0), gf = p - (gc + 0.5) * 19.0 - (hash22(gc + 7.0) - 0.5) * 9.0;
      float gr = 1.0 + 2.2 * hash12(gc + 2.0);
      float bead = step(hash12(gc + 5.0), 0.25) * (1.0 - smoothstep(gr - 0.7, gr + 0.5, length(gf)));
      fc = mix(fc, fc * 0.7 + C_BONE * 0.08 * smoothstep(-gr, gr, -gf.y), bead);
      // 霧是半透明的：外面的光隔著霧還透得過來一點
      fc += min(v, vec3(0.05)) * 0.5;
      col = mix(v, fc, fa * 0.94 * (1.0 - clearK));
      col = mix(col, through, fa * clearK);
      // ---- 玻璃：車廂天花板的燈映在玻璃上（上緣兩排很淡的暖光）、框邊暗一點
      float refl = exp(-pow((p.y - 150.0) / 26.0, 2.0)) * (0.5 + 0.5 * sin(p.x * 0.012));
      col += (C_SIGNAL * 0.012 + C_BONE * 0.006) * refl * (1.0 - fa);
      col *= 1.0 - 0.5 * exp(wd / 18.0);
    } else {
      // ---- 車廂的牆板：暖暖的燈從上面打下來，窗框一圈橡膠條（暗）與一道細高光
      float lit = 0.8 + 0.5 * smoothstep(0.0, 1080.0, p.y);
      col = (C_INK2 * 1.15 + C_SIGNAL * 0.018) * lit * (0.92 + 0.08 * fbm(p / 200.0, 2));
      col = mix(C_INK * 0.35, col, smoothstep(0.0, 14.0, wd));
      col += C_BONE * 0.05 * (1.0 - smoothstep(0.0, 2.5, abs(wd - 15.0)));
      // 窗台（下緣的小桌子）：亮一點的一條
      if (p.y > ${WIN.y1 + 38}.0) {
        float k = (p.y - ${WIN.y1 + 38}.0);
        col = (C_INK2 * 1.6 + C_SIGNAL * 0.03) * (1.0 - 0.3 * smoothstep(0.0, 160.0, k));
        col += C_BONE * 0.06 * (1.0 - smoothstep(0.0, 3.0, k));
      }
    }
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, lt: { value: 0 },
  xFar1: { value: 0 }, xFar2: { value: 0 }, xCity: { value: 0 }, xMid: { value: 0 }, xBal: { value: 0 }, tunX: { value: 0 },
  poles: { value: new THREE.Vector4() }, bob: { value: 0 }, tun: { value: 0 }, xing: { value: new THREE.Vector4() },
  sign: { value: null }, bld: { value: new THREE.Vector4() }, signOn: { value: 0 },
  fm: { value: null }, shown: { value: 0 }, fogK: { value: 1 }, fog: { value: new THREE.Vector4() }, heartOn: { value: 0 },
});

export default class Train extends Scene {
  bg = shared('train.bg', BG);
  /** 招牌（在窗外，shader 取樣）。 */
  sign = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 正在唱的字的霓虹光（低解析度，加亮疊上去）。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  /** 窗框上的小字（init 畫一次）。 */
  plate = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 7919) >>> 0;
  fm: GlyphMask | null = null;
  lay: MsgLay | null = null;
  times: number[] = [];
  tExit = 0;
  tIn = Infinity;
  tunnel = false;
  signStyle: LyricStyle = { family: FAM_SIGN, size: 56, minSize: 48, maxWidth: SIGN_W, align: 'center' };
  /** 每一句招牌掛在哪（世界座標：跟著小城一起往後移）。 */
  anchors = new Map<Line, number>();
  xings: number[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 0.5, e + 0.5);
    await loadText(`${T25_TEXT}${PLATE}${m?.text ?? ''}${m ? sigOf(m) : ''}${lines.map((l) => l.text).join('')}${song.title}${song.artist}`);
    const bar = au.timeOfBar(au.barAt(s) + 1) - au.timeOfBar(au.barAt(s));
    const beats = winBeats(au, s + 0.15, e);
    // 窗格夠長（≥ 3 小節）才從隧道開始：第一拍衝出隧道；≥ 5 小節時最後一拍鑽進下一個
    this.tunnel = e - s >= bar * 2.6;
    // 隧道裡至少待將近一拍（太短看不出是隧道）
    const beat = au.beatPeriod(s);
    this.tExit = this.tunnel ? (beats.find((b) => b >= s + beat * 0.9) ?? s + 0.3) : s - 1;
    if (e - s >= bar * 4.6) this.tIn = beats[beats.length - 1] ?? Infinity;

    // ---- 霧上的字
    const c = document.createElement('canvas').getContext('2d')!;
    let items: MaskGlyph[] = [];
    if (m) {
      const lay = layMsgV2(c, m.text, sigOf(m), FAM_MSG, MSG_BOX, { lineHeight: 1.26, maxLines: 5, align: 'left' });
      this.lay = lay;
      // 手寫：每一行的左端不會完全對齊
      items = msgGlyphs(this.lay).map((g, i) => ({ ...g }));
      const rowOff = this.lay.lines.map((_, r) => (hash(this.seed, r, 5) - 0.5) * 30 + r * 8);
      let k = 0;
      for (const g of this.lay.glyphs) { if (g.row >= 0) items[k]!.x += rowOff[g.row]!; k++; }
      const n = items.length;
      const maxDur = Math.max(0.8, Math.min(1.7 * bar, 0.45 * (e - this.tExit)));
      const t0 = Math.max(s + 0.1, this.tExit) + (this.tunnel ? au.beatPeriod(s) * 0.5 : 0);
      this.times = stagger(au, t0, n, maxDur);
      // 字變小了（40～60）：字模用 1 倍解析度、模糊少一點，手指擦開的筆畫才不會糊成一團
      this.fm = this.track(glyphMask(items, FM_RECT, 1, 2, { blur: 0.7 }));
      this.signStyle = { family: FAM_SIGN, size: lyricV2(lay.screen), minSize: V2.lyrMin, maxWidth: SIGN_W, align: 'center' };
    } else {
      // 沒有留言：窗角一小片霧，手指畫了一顆愛心
      items = [{ ch: '♥', x: 250, y: 740, w: 150, size: 170, family: FAM_MSG, idx: 0 }];
      this.times = [Math.max(s + 0.1, this.tExit) + au.beatPeriod(s)];
      this.fm = this.track(glyphMask(items, FM_RECT, 0.5, 2, { blur: 3 }));
      this.signStyle = { family: FAM_SIGN, size: lyricV2(null), minSize: V2.lyrMin, maxWidth: SIGN_W, align: 'center' };
    }

    // ---- 平交道：出隧道之後，每兩個小節經過一個（從畫面右邊進來、約 2.8 秒開過去）
    this.xings = winBars(au, Math.max(s, this.tExit) + 0.1, e).filter((_, i) => i % 2 === 0);

    // ---- 每一句的招牌：在唱這句的中間正好在窗子中間（跟著小城往後移，一句移不到一百 px）
    for (const ln of lines) {
      const mid = (Math.max(ln.start, s) + Math.min(ln.end, e)) / 2;
      this.anchors.set(ln, 960 + V.city * (mid - s) + (hash(this.seed, ln.i, 2) - 0.5) * 120);
    }

    // ---- 窗框上的小字
    const pc = this.plate.ctx;
    this.plate.clear();
    pc.font = font(F.hei(500), 20); pc.letterSpacing = '4px'; pc.fillStyle = rgba('ash', 0.55);
    pc.fillText(m ? PLATE : T25_INVITE, WIN.x0 + 40, WIN.y1 + 30 + 34);
    pc.letterSpacing = '0px';
    this.plate.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const lt = t - s;
    u.t!.value = t; u.lt!.value = lt;
    // 捲動：用窗格內的時間（數字小，shader 的浮點數才準）；衝出隧道那一下速度一樣，景一下子出現
    u.xFar1!.value = V.far1 * lt; u.xFar2!.value = V.far2 * lt; u.xCity!.value = V.city * lt;
    u.xMid!.value = V.mid * lt + (this.seed % 997); u.xBal!.value = V.bal * lt;
    u.tunX!.value = 3400 * lt;
    // 電線桿：第 b 拍正好在畫面中間
    const bf = au.beatAt(t);
    const b0 = Math.floor(bf);
    const pv = u.poles!.value as THREE.Vector4;
    pv.set(960 + POLE_GAP * (b0 - 1 - bf), 960 + POLE_GAP * (b0 - bf), 960 + POLE_GAP * (b0 + 1 - bf), 960 + POLE_GAP * (b0 + 2 - bf));
    // 鐵軌的接縫：大鼓一打景晃一下
    u.bob!.value = f.a.kick * 4 - pulse(t, au.timeOfBeat(b0), 0.06) * 2;
    // 平交道：兩盞燈一拍一拍輪流閃
    const xv = u.xing!.value as THREE.Vector4;
    xv.set(0, 0, 0, 0);
    for (const xb of this.xings) {
      const age = t - xb;
      if (age < 0 || age > 3.2) continue;
      const odd = Math.floor(bf) % 2;
      xv.set(2040 - 760 * age, odd ? 1 : 0.08, odd ? 0.08 : 1, 1);
    }
    // 隧道：出隧道那一下很快亮開；最後一拍鑽進去
    const tun = t < this.tExit ? 1 - ease.inQuad(prog(t, this.tExit - 0.08, this.tExit)) : ease.outCubic(prog(t, this.tIn, this.tIn + 0.12));
    u.tun!.value = tun;

    // ---- 霧與指痕
    const m = this.msg;
    const fv = u.fog!.value as THREE.Vector4;
    if (m && this.lay) {
      // 霧：只蓋住寫字的那一片（字的外框再大一點），一直連到窗子下緣（水氣從下面起）
      const [bx, by, bw] = this.lay.box;
      const top = by - 76;
      fv.set(bx + bw / 2, (top + WIN.y1 + 40) / 2, bw / 2 + 76, (WIN.y1 + 40 - top) / 2);
    } else fv.set(330, 700, 170, 110);
    u.fogK!.value = 1 - 0.25 * ease.inCubic(prog(t, e - 0.4, e));
    u.fm!.value = this.fm!.tex;
    let shown = 0;
    for (let i = 0; i < this.times.length; i++) {
      const k = clamp((t - this.times[i]!) / 0.12);
      if (k <= 0) break;
      shown = i + k;
    }
    u.shown!.value = shown;

    // ---- 招牌：正在唱（或快要唱）的那一句
    const S = this.sign, HT = this.hot;
    S.clear(); HT.clear();
    const c = S.ctx, hc = HT.ctx;
    let signOn = 0;
    const bv = u.bld!.value as THREE.Vector4;
    const sy = m ? SIGN_Y : SIGN_Y_SOLO;
    const ly = lyricAt(lyrics, t, 1.0, 0.6);
    if (ly && this.anchors.has(ly.line) && tun < 0.5) {
      const cx = this.anchors.get(ly.line)! - V.city * lt;
      const st = this.signStyle;
      const lay = layoutLyric(c, ly.line, st);
      // 招牌亮起：閃兩下（燈管）；熄掉：閃一下就暗
      const a0 = ly.line.start - 0.6;
      const tIn = t - a0;
      const on = tIn < 0.08 ? 0.8 : tIn < 0.16 ? 0.15 : tIn < 0.22 ? 0.9 : tIn < 0.27 ? 0.3 : 1;
      signOn = on * ly.k;
      const base = sy - (lay.height - lay.size) / 2;
      c.save(); c.translate(cx, base);
      drawLyric(c, ly.line, t, { ...st, active: rgba('signal'), sung: rgba('bone', 0.88), unsung: rgba('bone', 0.2) }, lay, signOn);
      c.restore();
      // 發光層：只放正在唱的那個詞（加亮疊上去才有霓虹的光）
      hc.save(); hc.translate(cx, base);
      drawLyric(hc, ly.line, t, { ...st, active: rgba('signal'), sung: rgba('bone', 0.12), unsung: 'rgba(0,0,0,0)' }, lay, signOn);
      hc.restore();
      const w = Math.max(...lay.rows.map((r) => r.width));
      bv.set(cx - w / 2 - 30, base - lay.size * 1.05, cx + w / 2 + 30, base + (lay.height - lay.size) + lay.size * 0.3);
    } else if (!lyrics.linesIn(s, e).length && tun < 0.5) {
      // 純音樂：招牌是歌名（整塊亮著）
      const text = `♪ ${song.title}`;
      const ps = this.signStyle.size;
      c.font = font(FAM_SIGN, ps); c.textAlign = 'center';
      const cx = 960 + 60 - V.city * lt * 0.5;
      const on = prog(t, Math.max(s, this.tExit) + 0.1, Math.max(s, this.tExit) + 0.3);
      signOn = on;
      c.fillStyle = rgba('bone', 0.85 * on);
      c.fillText(text, cx, sy);
      const w = c.measureText(text).width;
      c.textAlign = 'left';
      bv.set(cx - w / 2 - 30, sy - ps * 1.05, cx + w / 2 + 30, sy + 18);
    }
    u.signOn!.value = signOn;
    u.sign!.value = S.upload();
    u.heartOn!.value = m ? 0 : 1;
    this.bg.render(renderer, out);
    if (signOn > 0) comp.draw(renderer, HT.upload(), out, { mode: 'add', tint: [1.8, 1.8, 1.8] });
    comp.draw(renderer, this.plate.texture, out, { opacity: prog(t, s, s + 0.4) });

    const box = this.lay?.box;
    return {
      bloom: 0.75, vignette: 0.5, halation: 0.25,
      flash: pulse(t, this.tExit, 0.06) * 0.05 * (this.tunnel ? 1 : 0),
      zoom: 1 + 0.03 * ease.inOutQuad(f.p),
      popupAvoid: [[WIN.x0 + 100, (m ? SIGN_Y : SIGN_Y_SOLO) - 90, WIN.x1 - WIN.x0 - 200, 130], ...(box ? [box as Rect] : [])],
    };
  }
}
