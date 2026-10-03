// 照片版面「纜車」（亮）：一節紅色的纜車車廂沿著鋼索慢慢往山上爬，車廂的大窗子裡就是照片——
//  - 鏡頭跟著車廂：後面的山一層一層往左下退（遠的慢、近的快，越遠越淡），山谷裡有一條薄霧在飄；鋼索的紋路往後滑。
//  - 切進來時車廂從左下沿著鋼索滑進畫面、晃幾下才停；之後輕輕擺。每四個小節經過一座鐵塔（從右邊滑過來），
//    抓索器過塔頂的那一刻車廂「咚」地晃一下。
//  - 照片在車窗裡（窗子照照片的比例做，玻璃上一道很淡的斜反光），一開始完整呈現；很小的舊照片最多放大到原尺寸 1.5 倍。
//    車廂滑進來之後窗裡的畫面慢慢往新人點的臉推（focusCrop，窗可以推到 1.22 倍，焦點一直在窗裡）。
//  - 字寫在右邊的天空上（思源宋體、墨色，字後面很淡的亮霧）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞放在同一個位置；兩個都沒有就只有車廂（移到中間）。相簿的第一張在上面多一行相簿名。
// 畫法：天空、四層山、霧、鐵塔、鋼索、車廂、照片都在一個全螢幕 shader；字是一張 Canvas2D 層。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog, springStep } from '../engine/util';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'journey', prefers: ['landscape', 'square'], energy: [0, 1], bars: [2, 8], weight: 1 };

/** 鋼索的斜率（往右上）。 */
const SLOPE = -0.25;

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform float t; uniform float k; uniform float travel; uniform float seedOff;
  uniform vec2 grip; uniform float swing; uniform vec2 hs; uniform vec2 cabH; uniform float towerX; uniform vec4 textRect;

  float rbox(vec2 p, vec2 b, float r) { return sdBox(p, b - vec2(r)) - r; }
  float ridge(float x, float sc, float s) { return snoise(vec2(x / sc, s)) * 0.6 + snoise(vec2(x / (sc * 0.37), s + 4.0)) * 0.25 + snoise(vec2(x / (sc * 0.11), s + 9.0)) * 0.1; }
  float cableY(float x) { return grip.y + (x - grip.x) * ${SLOPE.toFixed(3)}; }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // ---- 天空：上面淡、下面暖，右上一團陽光
    vec3 haze = mix(C_PAPER, C_SIGNAL, 0.16) * 0.9;
    vec3 col = mix(mix(C_PAPER, C_BONE, 0.4) * 0.84, haze, smoothstep(0.0, 800.0, p.y));
    col += C_SIGNAL * 0.06 * exp(-length((p - vec2(1700.0, 80.0)) / vec2(700.0, 420.0)));
    // ---- 四層山（往左下退：遠的慢、近的快），越遠越接近天色
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float f = 0.04 + 0.04 * fi * fi;
      vec2 q = p + vec2(travel * f, travel * f * ${SLOPE.toFixed(3)});
      float base = 470.0 + 150.0 * fi;
      float hgt = (150.0 + 70.0 * fi) * (0.5 + 0.5 * ridge(q.x, 900.0 - 140.0 * fi, seedOff + fi * 5.0));
      float m = base - hgt;
      vec3 mc = mix(haze, mix(mix(C_PAPER, C_GINGHAM, 0.55) * 0.62, C_SEPIA * 0.6, 0.15 * fi), 0.25 + 0.22 * fi);
      // 近的兩層：松林的細紋
      mc *= 1.0 - (fi > 1.5 ? 0.12 * smoothstep(0.2, 0.8, snoise(vec2(q.x / 9.0, q.y / 22.0))) : 0.0);
      // 山的明暗：朝右上的坡亮一點
      mc *= 0.95 + 0.08 * ridge(q.x + 30.0, 400.0, seedOff + fi);
      col = mix(col, mc, smoothstep(m - 1.0, m + 1.0, p.y));
      // 每層山腳一條薄霧
      if (i < 3) {
        float mist = exp(-pow((p.y - (base + 40.0)) / 50.0, 2.0)) * (0.5 + 0.5 * fbm(vec2(q.x / 500.0 + t * 0.02, fi + seedOff), 3));
        col = mix(col, mix(haze, C_BONE * 0.88, 0.5), 0.55 * mist);
      }
    }
    // ---- 鐵塔（從右邊滑過來）：兩根腳往上收、交叉的斜撐、頂上的橫臂
    if (abs(p.x - towerX) < 170.0) {
      float topY = cableY(towerX) + 26.0;
      float v = clamp((p.y - topY) / (${H}.0 - topY), 0.0, 1.0);
      float hw = mix(26.0, 120.0, v);
      float legs = min(abs(p.x - towerX - hw), abs(p.x - towerX + hw)) - 4.0;
      float seg = (${H}.0 - topY) / 6.0;
      float lv = fract((p.y - topY) / seg);
      float xb = abs(abs(p.x - towerX) - hw * (lv < 0.5 ? 1.0 - 2.0 * lv : 2.0 * lv - 1.0)) - 2.0;
      float inT = step(topY, p.y) * step(abs(p.x - towerX), hw + 4.0);
      float arm = sdBox(p - vec2(towerX, topY - 6.0), vec2(90.0, 6.0));
      float dT = min(min(legs, xb * inT + (1.0 - inT) * 1e3), arm);
      col = mix(col, mix(C_GRAPHITE, haze, 0.45) * 0.6, (1.0 - smoothstep(-0.8, 0.8, dT)) * max(inT, step(arm, 1.0)));
    }
    // 字後面一層很淡的亮霧（鐵塔經過時也淡掉，字才清楚）
    vec2 tq = max(abs(p - textRect.xy - textRect.zw * 0.5) - textRect.zw * 0.5, 0.0);
    col = mix(col, mix(C_PAPER, C_BONE, 0.4) * 0.88, 0.62 * exp(-dot(tq, tq) / 7000.0) * step(1.0, textRect.z));
    // ---- 鋼索：兩條平行，表面一節一節的紋路往後滑
    vec2 cd = normalize(vec2(1.0, ${SLOPE.toFixed(3)}));
    for (int i = 0; i < 2; i++) {
      float off = float(i) * 16.0;
      float d = abs(p.y - cableY(p.x) - off) * cd.x;
      float along = dot(p, cd) + travel;
      vec3 cc = mix(C_GRAPHITE, C_INK2, 0.5) * (0.8 + 0.25 * step(0.5, fract(along / 9.0)));
      col = mix(col, cc, 1.0 - smoothstep(2.2 - float(i) * 0.6, 3.4 - float(i) * 0.6, d));
    }
    // ---- 抓索器＋吊臂（跟著車廂擺）
    vec2 lq = rot2(swing) * (p - grip);
    float dg = rbox(lq - vec2(0.0, 6.0), vec2(30.0, 13.0), 5.0);
    float arm2 = sdSegment(lq, vec2(0.0, 10.0), vec2(0.0, 92.0)) - 5.0;
    vec3 metal = mix(C_GRAPHITE, C_INK2, 0.4) * 0.9;
    col = mix(col, metal, 1.0 - smoothstep(-0.8, 0.8, min(dg, arm2)));
    // ---- 車廂：紅色烤漆、圓角，車頂一塊深色，窗子是照片
    vec2 cq = lq - vec2(0.0, 100.0 + cabH.y);
    float dC = rbox(cq, cabH, 46.0);
    col *= 1.0 - 0.15 * shadowAt(rbox(cq - vec2(-18.0, 14.0), cabH, 46.0), 30.0) * step(0.0, dC);
    if (dC < 1.0) {
      vec3 paint = mix(C_COLLAR, C_PAPER, 0.12) * 0.8;
      // 圓柱的明暗（光從右上）、上亮下暗；下緣一條奶油色的腰帶；上面的車頂
      float nx = cq.x / cabH.x;
      paint *= (0.74 + 0.26 * (1.0 - nx * nx) + 0.08 * nx) * (1.04 - 0.1 * (cq.y + cabH.y) / (2.0 * cabH.y));
      paint += C_BONE * 0.08 * exp(-pow((nx + 0.82) / 0.05, 2.0));
      float stripe = smoothstep(cabH.y - 75.0, cabH.y - 73.0, cq.y) * smoothstep(cabH.y - 49.0, cabH.y - 51.0, cq.y);
      paint = mix(paint, C_BONE * 0.84 * (0.86 + 0.14 * (1.0 - nx * nx)), stripe);
      float roof = smoothstep(-cabH.y + 45.0, -cabH.y + 43.0, cq.y);
      vec3 roofC = mix(C_GRAPHITE, C_PAPER, 0.3) * 0.62 * (0.8 + 0.2 * (1.0 - nx * nx));
      roofC += C_BONE * 0.06 * exp(-pow((cq.y + cabH.y - 8.0) / 4.0, 2.0));
      paint = mix(paint, roofC, roof);
      // 窗：深色的橡膠框、裡面是照片，玻璃上一道很淡的斜反光
      vec2 wq = cq - vec2(0.0, -12.0);
      float dW = rbox(wq, hs + vec2(12.0), 20.0);
      paint *= 1.0 - 0.18 * exp(-max(dW, 0.0) / 6.0);
      paint = mix(paint, mix(C_GRAPHITE, C_INK2, 0.5) * (0.9 + 0.3 * smoothstep(-12.0, 0.0, dW)), 1.0 - smoothstep(-0.8, 0.8, dW));
      float dP = sdBox(wq, hs);
      if (dP < 1.0) {
        vec3 ph = photoAt((wq + hs) / (2.0 * hs));
        ph *= 1.0 - 0.18 * smoothstep(-26.0, 0.0, dP);
        float band = (wq.x + wq.y * 0.9) / (2.0 * hs.x) + 0.3 * sin(t * 0.4) - 0.1;
        ph += C_BONE * 0.06 * exp(-band * band * 30.0);
        paint = mix(paint, ph, 1.0 - smoothstep(-0.7, 0.7, dP));
      }
      // 門縫、鉚釘
      paint *= 1.0 - 0.25 * (1.0 - smoothstep(0.5, 1.5, abs(abs(cq.x) - (cabH.x - 30.0)))) * step(-cabH.y + 50.0, cq.y);
      col = mix(col, paint, 1.0 - smoothstep(-0.8, 0.8, dC));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, t: { value: 0 }, k: { value: 1 }, travel: { value: 0 }, seedOff: { value: 0 },
  grip: { value: new THREE.Vector2() }, swing: { value: 0 }, hs: { value: new THREE.Vector2() }, cabH: { value: new THREE.Vector2() },
  towerX: { value: -9999 }, textRect: { value: new THREE.Vector4() },
});

/** 天空上的字塊：寬、高上限（相簿名＋主字＋署名＋歌詞）。60 字的留言在 40 px 排得進四行。 */
const COL_W = 600, COL_H = 460;

export default class CableCar extends JourneyPlate {
  bg = shared('cablecar.bg', BG);
  text = this.track(new Layer2D(COL_W + 40, COL_H + 60, undefined, { fast: true }));
  gx = 0; gy = 0; hw = 0; hh = 0; chx = 0; chy = 0;
  colX = 0; colY = 0;

  override async init() {
    await this.loadPhoto();
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.ming(700), lineHeight: 1.45,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.32), active: mixRgba('signal', 'sepia', 0.4), sigInk: rgba('sepia', 0.72), sigFamily: F.ming(500),
      label: { family: F.hei(500), size: 21, color: rgba('sepia', 0.56), tracking: 6, gap: 24 },
    });
    const { w, h } = this.img!;
    const s = this.fitScale(this.hasText ? 600 : 680, 440);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    // 車廂：窗子四周留邊（車頂、腰帶在下面）
    this.chx = Math.max(this.hw + 64, 200); this.chy = this.hh + 88;
    this.gx = this.hasText ? Math.max(150 + this.chx, 560) : W / 2;
    this.gy = 170;
    // 字在車廂右邊的天空（鋼索往右上走，到 x ≈ 1180 已經出了畫面上緣，不會劃過字）
    this.colX = Math.min(W - 96 - COL_W, Math.max(1160, this.gx + this.chx + 110));
    const bh = this.blockH();
    this.colY = clamp(480 - bh / 2, 150, 785 - bh);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const u = this.bg.u;
    // 鐵塔：每四個小節經過一座（小節 4k 時剛好在抓索器那裡）
    const bars = audio.barAt(t);
    const ph = bars / 4 - Math.round(bars / 4);
    const span = 4200;
    u.towerX!.value = this.gx - ph * span;
    // 車廂沿著鋼索前進（山往後退）；進場時從左下滑進來
    const enter = ease.outCubic(prog(t, s, s + 1.3));
    const slide = -420 * (1 - enter);
    u.travel!.value = (span / 4) * bars;
    (u.grip!.value as THREE.Vector2).set(this.gx + slide, this.gy - slide * SLOPE * -1);
    // 擺：進場晃幾下、平常輕輕擺、過塔「咚」一下
    const tPass = audio.timeOfBar(Math.round(bars / 4) * 4);
    let sw = (1 - springStep(Math.max(0, lt), 0.8, 0.25)) * 6 + 0.9 * Math.sin(t * 0.95) + 0.4 * Math.sin(t * 2.1 + 1);
    if (t >= tPass && tPass > s) sw += 3.2 * Math.exp(-(t - tPass) * 1.4) * Math.sin((t - tPass) * 5.5);
    u.swing!.value = sw * (Math.PI / 180);
    (u.hs!.value as THREE.Vector2).set(this.hw, this.hh);
    (u.cabH!.value as THREE.Vector2).set(this.chx, this.chy);
    u.t!.value = t;
    u.seedOff!.value = hash(this.seed, 3) * 30;
    // 車廂滑進來之後窗裡的畫面往焦點推（窗：推到 1.22 倍）
    this.setPhoto(u, 2 * this.hw, this.focusK(t, s + 0.6), 1.22);
    const bh = this.blockH();
    (u.textRect!.value as THREE.Vector4).set(this.hasText ? this.colX - 10 : 0, this.colY - 10, this.hasText ? this.blockW() + 20 : 0, bh + 30);
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.hasText) {
      this.paintBlock(this.text, t, 20, 20);
      const op = prog(t, s + 0.6, s + 1.2, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      if (op > 0) blit(comp, renderer, this.text, out, this.colX - 20, this.colY - 20, { opacity: op });
    }
    return { paper: 1, bloom: 0.14, bloomThreshold: 1.1, halation: 0.06, vignette: 0.32 };
  }
}
