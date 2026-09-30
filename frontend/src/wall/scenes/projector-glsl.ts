// 幻燈機（projector.ts）的全螢幕 shader：暗房間的牆、桌面、幻燈機打出去的光束（光裡的灰塵）、牆上投出來的幻燈片。
// 幻燈片是六張「風景插畫」（平塗的色塊一層疊一層，像老的觀光幻燈片），每個小節線「喀」一聲換一張：
// 舊的一張往下掉出片門、牆上閃一下燈泡的白光、新的一張從上面落進來彈一下停住。片子下緣一條黑色的字幕帶（字在 Canvas 上）。
// 座標：p 是邏輯像素、y 向下（跟 Canvas2D 一樣）。
import { H } from '../engine/gl';

/** 牆上的投影（畫面 px）：3:2，右上。 */
export const IMG = { x0: 900, y0: 70, x1: 1780, y1: 657 };
/** 鏡頭的位置（光束從這裡出去）。 */
export const LENS = { x: 930, y: 868 };
/** 桌面從這裡開始。 */
export const TABLE_Y = 968;

export const FRAG_PROJECTOR = /* glsl */ `
uniform float uT;
uniform float uSlide;    // 這一張是第幾種風景（0..5）
uniform float uSeed;     // 這一張的種子（同一種風景每次構圖差一點）
uniform float uDrop;     // 換片：舊的往下掉（0..1）
uniform float uIn;       // 換片：新的落進來（0 = 還在上面、1 = 停住；彈一下會超過 1）
uniform float uWhite;    // 片門空著時牆上的白光（0..1）
uniform float uLamp;     // 燈（進場亮起來、每拍一點點閃）
uniform float uBand;     // 字幕帶的高度（px；0 = 沒有）

const vec4 IMG = vec4(${IMG.x0}.0, ${IMG.y0}.0, ${IMG.x1}.0, ${IMG.y1}.0);
const vec2 LENS = vec2(${LENS.x}.0, ${LENS.y}.0);
const float TY = ${TABLE_Y}.0;

// ---- 六張風景（u：0..1，y 向下；回傳顏色）。顏色都從色票混，跟著每首歌的主題變。
vec3 skyG(float y, vec3 top, vec3 bot) { return mix(top, bot, smoothstep(0.0, 0.7, y)); }
float ridge(float x, float base, float amp, float fq, float sd) { return base - amp * (0.5 + 0.5 * fbm(vec2(x * fq + sd * 13.0, sd * 3.1), 3)); }

vec3 slide(vec2 u, float kind, float sd) {
  vec3 warm = C_SIGNAL, hot = C_EMBER, deep = C_BLOOD, light = mix(C_BONE, C_EMBER, 0.25) * 0.85, dark = C_INK2;
  vec3 col;
  if (kind < 0.5) {
    // 山：黃昏的天、一顆太陽、三層山稜（遠的淡、近的深）
    col = skyG(u.y, mix(deep, warm, 0.3), mix(warm, hot, 0.55));
    vec2 sp = vec2(0.62 + 0.15 * sd, 0.42);
    col = mix(col, mix(light, hot, 0.3), smoothstep(0.075, 0.07, length((u - sp) * vec2(1.5, 1.0))));
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float y = ridge(u.x, 0.62 + fk * 0.1, 0.22 - fk * 0.04, 2.0 + fk * 1.3, sd + fk);
      col = mix(col, mix(mix(deep, dark, 0.2 + fk * 0.35), mix(warm, light, 0.3), 0.35 - fk * 0.14), step(y, u.y));
    }
  } else if (kind < 1.5) {
    // 海：大片的天、半顆太陽在海平線上、一條條橫的波光
    col = skyG(u.y, mix(deep, warm, 0.55), mix(warm, hot, 0.6));
    float hz = 0.58;
    vec2 sp = vec2(0.3 + 0.35 * sd, hz);
    col = mix(col, mix(light, hot, 0.25), smoothstep(0.09, 0.085, length((u - sp) * vec2(1.5, 1.0))) * step(u.y, hz));
    if (u.y > hz) {
      col = mix(mix(deep, warm, 0.45), mix(deep, dark, 0.4), (u.y - hz) / (1.0 - hz));
      float band = step(0.55, fract((u.y - hz) * 36.0 + 0.3 * sin(u.x * 20.0)));
      col = mix(col, mix(light, hot, 0.4), band * exp(-pow((u.x - sp.x) / (0.05 + (u.y - hz) * 0.6), 2.0)) * 0.85);
    }
    // 兩朵扁扁的雲
    for (int k = 0; k < 2; k++) {
      vec2 cq = (u - vec2(0.2 + 0.55 * float(k) + 0.1 * sd, 0.2 + 0.1 * float(k))) * vec2(4.0, 14.0);
      col = mix(col, mix(light, hot, 0.2), smoothstep(1.0, 0.9, length(cq)) * 0.8);
    }
  } else if (kind < 2.5) {
    // 沙丘：大大的淡天，一層層的沙丘（受光面亮、背光面深）
    col = skyG(u.y, mix(warm, light, 0.35), mix(hot, light, 0.3));
    // 四層沙丘：越近越低、越大；稜線的一邊受光、一邊背光（柔的過渡），像一疊剪好的紙
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float ph = u.x * (4.0 + fk * 1.6) + sd * 6.0 + fk * 1.7;
      float y = 0.5 + fk * 0.11 - 0.05 * sin(ph) - 0.025 * sin(ph * 2.3 + 1.0);
      if (u.y > y) {
        float slope = cos(ph) + 0.6 * cos(ph * 2.3 + 1.0);
        float lit = smoothstep(-0.9, 0.9, -slope);
        vec3 sun = mix(warm, hot, 0.35 + 0.12 * fk), shade = mix(deep, warm, 0.25 + 0.1 * fk);
        col = mix(shade, sun, lit) * (1.0 - fk * 0.07);
        col = mix(col, mix(light, hot, 0.4), 0.5 * (1.0 - smoothstep(0.0, 0.006, u.y - y)));
      }
    }
  } else if (kind < 3.5) {
    // 森林：淡的天、遠山、兩排三角形的樹
    col = skyG(u.y, mix(warm, light, 0.4), mix(hot, light, 0.35));
    float y0 = ridge(u.x, 0.6, 0.12, 1.6, sd);
    col = mix(col, mix(warm, light, 0.45), step(y0, u.y));
    for (int k = 0; k < 2; k++) {
      float fk = float(k), n = 14.0 + fk * 8.0;
      float cx = u.x * n + sd * 5.0 + fk * 0.5, id = floor(cx), fx = fract(cx) - 0.5;
      float hh = 0.16 + 0.1 * hash11(id + fk * 17.0) + fk * 0.06;
      float base = 0.74 + fk * 0.14;
      float tri = step(abs(fx), (u.y - (base - hh)) / hh * 0.45) * step(u.y, base);
      col = mix(col, mix(mix(deep, dark, 0.35 + 0.35 * fk), warm, 0.12), tri);
      col = mix(col, mix(deep, dark, 0.35 + 0.35 * fk), step(base, u.y) * step(u.y, base + 0.2));
    }
  } else if (kind < 4.5) {
    // 湖：夜空、月亮、山，湖面的倒影（一條條被波紋切開）
    col = skyG(u.y, mix(dark, deep, 0.3), mix(deep, warm, 0.35));
    vec2 mp = vec2(0.25 + 0.5 * sd, 0.22);
    col = mix(col, light, smoothstep(0.052, 0.048, length((u - mp) * vec2(1.5, 1.0))));
    float hz = 0.62;
    float y = ridge(u.x, hz, 0.2, 2.4, sd);
    vec3 above = u.y < y ? col : mix(deep, dark, 0.5);
    if (u.y > hz) {
      // 倒影：把上半鏡射下來，加一點橫向的波紋
      vec2 r = vec2(u.x + 0.004 * sin(u.y * 180.0), 2.0 * hz - u.y);
      vec3 rc = skyG(r.y, mix(dark, deep, 0.3), mix(deep, warm, 0.35));
      rc = mix(rc, light, smoothstep(0.052, 0.048, length((r - mp) * vec2(1.5, 1.0))));
      rc = mix(rc, mix(deep, dark, 0.5), step(ridge(r.x, hz, 0.2, 2.4, sd), r.y));
      col = mix(rc * 0.7, dark, 0.2) * (0.85 + 0.15 * step(0.5, fract(u.y * 60.0)));
    } else col = above;
  } else {
    // 花田：黃昏的天、起伏的田，一點一點的花（近的大、遠的小）
    col = skyG(u.y, mix(deep, warm, 0.4), mix(hot, light, 0.45));
    float y = ridge(u.x, 0.55, 0.08, 1.2, sd);
    if (u.y > y) {
      float dz = (u.y - y) / (1.0 - y);
      col = mix(mix(warm, deep, 0.3), mix(deep, dark, 0.3), dz);
      float sc = mix(90.0, 22.0, dz);
      vec2 g = vec2(u.x * sc * 1.5, (u.y - y) * sc * 3.0);
      vec2 id = floor(g), f = fract(g) - 0.5;
      vec2 h = hash22(id + sd * 7.0);
      col = mix(col, mix(light, hot, h.x), smoothstep(0.3, 0.2, length(f - (h - 0.5) * 0.5)) * step(0.35, h.y));
    }
  }
  return col;
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  float lamp = uLamp;
  // ---- 牆：暗的灰泥，一點點斑駁；投影旁邊被反光照亮一點
  float pl = fbm(p / 260.0, 3) * 0.5 + snoise(p / 18.0) * 0.12;
  vec3 col = mix(C_INK, C_INK2, 0.55 + 0.25 * pl);
  vec2 ic = (IMG.xy + IMG.zw) * 0.5, ih = (IMG.zw - IMG.xy) * 0.5;
  float dI = sdBox(p - ic, ih);
  col += mix(C_BONE, C_EMBER, 0.3) * 0.05 * exp(-max(dI, 0.0) / 160.0) * lamp;
  // ---- 桌面
  if (p.y > TY) {
    float k = (p.y - TY) / ${H}.0;
    vec3 desk = mix(C_INK2, C_SEPIA, 0.5) * (0.45 - 0.2 * k);
    desk *= 0.9 + 0.1 * sin(p.x / 7.0 + 3.0 * snoise(vec2(p.x / 300.0, p.y / 40.0)));
    col = mix(col, desk, smoothstep(TY, TY + 2.0, p.y));
    col += C_BONE * 0.04 * exp(-abs(p.y - TY) / 1.5);
  }
  // ---- 投影
  if (dI < 0.0) {
    vec2 u = (p - IMG.xy) / (IMG.zw - IMG.xy);
    vec3 img = vec3(0.0);
    // 換片：舊的往下掉（uDrop），新的從上面落進來（uIn，彈一下）；片門空著時是燈泡的白光
    float off = uDrop > 0.0 ? uDrop * 0.35 : (1.0 - uIn) * -0.3;
    vec2 su = vec2(u.x, u.y - off);
    float inside = step(0.0, su.y) * step(su.y, 1.0);
    // 幻燈片的片框：四邊一點點暗角（紙框遮到的地方）
    // 片子整體壓一點（投在牆上的光不會比燈泡的白還亮，字幕帶的白字才是最亮的）
    vec3 pic = slide(su, uSlide, uSeed) * 0.72;
    // 字幕帶：片子下緣一條黑
    pic = mix(pic, C_INK * 0.6, step(1.0 - uBand / (IMG.w - IMG.y), su.y));
    vec2 cq = su - 0.5;
    pic *= 1.0 - 0.7 * pow(dot(cq, cq) * 1.8, 1.5);
    // 老片的顆粒與幾粒灰塵
    pic *= 0.94 + 0.06 * hash12(floor(p / 2.0) + floor(uT * 12.0));
    vec3 bulb = mix(C_BONE, C_EMBER, 0.25) * 0.9;
    img = mix(bulb * 0.85, pic, inside);
    img = mix(img, bulb, uWhite);
    // 投影的四邊是柔的（對焦不到最邊緣）
    float edge = smoothstep(0.0, 6.0, -dI);
    col = mix(col, img * lamp, edge);
  }
  // ---- 光束：從鏡頭打向投影，光裡的煙與灰塵（投影前面那一段最淡）
  vec2 d = p - LENS;
  float dist = length(d);
  vec2 dir = d / max(dist, 1.0);
  // 光束的方向範圍：鏡頭看投影四個角的角度
  float a = atan(dir.y, dir.x);
  float c0 = atan(IMG.y - LENS.y, IMG.x - LENS.x), c1 = atan(IMG.y - LENS.y, IMG.z - LENS.x);
  float c2 = atan(IMG.w - LENS.y, IMG.x - LENS.x), c3 = atan(IMG.w - LENS.y, IMG.z - LENS.x);
  float amin = min(min(c0, c1), min(c2, c3)), amax = max(max(c0, c1), max(c2, c3));
  float inBeam = smoothstep(amin - 0.01, amin + 0.04, a) * (1.0 - smoothstep(amax - 0.04, amax + 0.01, a));
  float haze = 0.5 + 0.5 * fbm(p / 300.0 + vec2(uT * 0.03, -uT * 0.02), 3);
  float beam = inBeam * exp(-dist / 900.0) * smoothstep(20.0, 120.0, dist) * (dI < 0.0 ? 0.25 : 1.0);
  col += mix(C_BONE, C_EMBER, 0.35) * 0.09 * beam * haze * lamp * (0.6 + 0.4 * (1.0 - uWhite) + 0.6 * uWhite);
  // 光裡的灰塵：稀稀的亮點，慢慢飄
  vec2 g = (p + vec2(uT * 6.0, -uT * 9.0)) / 34.0;
  vec2 id = floor(g), f = fract(g) - 0.5;
  vec2 h = hash22(id);
  if (h.x > 0.9) col += C_BONE * 0.35 * smoothstep(0.08, 0.0, length(f - (h - 0.5) * 0.6)) * beam * lamp * (0.5 + 0.5 * sin(uT * 2.0 + h.y * 30.0));
  fragColor = vec4(col, 1.0);
}`;
