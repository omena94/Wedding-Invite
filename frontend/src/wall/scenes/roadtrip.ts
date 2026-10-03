// 照片版面「公路旅行」（亮）：坐在車裡往前看，擋風玻璃外是一條往遠方延伸的公路——
//  - 照片用木頭夾子夾在放下來的遮陽板下緣，跟著車子輕輕晃（鐘擺）；切進來時照片從上面盪下來、晃幾下才停。
//    實體相片（白邊）完整呈現不裁切，很小的舊照片最多放大到原尺寸 1.5 倍；盪好之後相片上的畫面慢慢往新人點的臉推（focusCrop）。
//  - 窗外：路面的中線虛線每一拍迎面過一段（跟著節拍跑），右邊的電線桿每個小節過一根、左邊一排行道樹，兩旁的田一壟一壟往後退；
//    遠山與天邊的暖光不動，路很慢地左彎右彎。車子在路上輕輕上下晃，大鼓時顛一下。後照鏡裡是往後退的路。
//  - 字寫在擋風玻璃右邊的天空上（思源宋體、墨色，字後面一層很淡的亮霧），照片盪好之後淡入：主字（賓客留言＋署名，或新人的註解）在上，
//    歌詞小一號在下面跟唱（長的留言會寫到地平線下面一點，亮霧跟著字塊變大）；沒有主字時歌詞放在同一個位置；
//    兩個都沒有就只有照片（照片移到靠中間）。相簿的第一張在上面多一行相簿名。
// 畫法：車內（遮陽板、A 柱、儀表板、後照鏡）、窗外的公路（透視投影：每個像素算出它在地上的深度與左右位置）、照片都在一個全螢幕 shader；
// 字是一張 Canvas2D 層，跟著車內一起晃。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog, springStep } from '../engine/util';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'journey', prefers: ['portrait', 'square'], energy: [0, 1], bars: [2, 8], weight: 1 };

/** 地平線、消失點、焦距與相機高度（透視投影用）。 */
const HZ = 560, VPX = 1200, FOC = 800, CAMK = 1200;

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform float t; uniform float k; uniform vec2 bob; uniform float roll; uniform float travel; uniform float bend; uniform float seedOff;
  uniform vec4 visor; uniform vec2 pivot; uniform float swing; uniform vec2 hs; uniform float bd; uniform vec4 textRect;

  float rbox(vec2 p, vec2 b, float r) { return sdBox(p, b - vec2(r)) - r; }
  float ridge(float x, float sc, float s) { return snoise(vec2(x / sc, s)) * 0.6 + snoise(vec2(x / (sc * 0.37), s + 4.0)) * 0.25 + snoise(vec2(x / (sc * 0.11), s + 9.0)) * 0.08; }

  // 遠山：很淡，跟著彎道稍微左右移
  vec3 farHills(vec2 q, vec3 sky, vec3 horizonCol) {
    float hz = ${HZ}.0;
    float sx = q.x - bend * 9000.0;
    float m = hz - 26.0 - 70.0 * (0.5 + 0.5 * ridge(sx, 520.0, seedOff + 3.0));
    vec3 col = mix(sky, mix(horizonCol, C_SEPIA, 0.22), smoothstep(m - 1.2, m + 1.2, q.y));
    float m2 = hz - 8.0 - 26.0 * (0.5 + 0.5 * ridge(sx * 1.6, 300.0, seedOff + 7.0));
    return mix(col, mix(horizonCol, C_GINGHAM * 0.7, 0.35), smoothstep(m2 - 1.2, m2 + 1.2, q.y));
  }

  vec3 ground(vec2 q, vec3 horizonCol);
  // 窗外：q 是畫面座標（已經扣掉車子的晃動與傾斜）
  vec3 outside(vec2 q) {
    float hz = ${HZ}.0;
    vec3 horizonCol = mix(C_PAPER, C_SIGNAL, 0.2) * 0.92;
    vec3 sky = mix(mix(C_PAPER, C_BONE, 0.35) * 0.84, horizonCol, smoothstep(0.0, hz, q.y));
    // 天邊右邊一團暖光（太陽在畫面外）
    sky += C_SIGNAL * 0.07 * exp(-length((q - vec2(1650.0, hz - 40.0)) / vec2(520.0, 260.0)));
    float cl = fbm(vec2(q.x / 640.0 + seedOff, q.y / 150.0), 4);
    sky = mix(sky, C_BONE * 0.86, 0.32 * smoothstep(0.15, 0.6, cl) * smoothstep(hz - 60.0, 80.0, q.y));
    vec3 res;
    if (q.y < hz) res = farHills(q, sky, horizonCol);
    else res = ground(q, horizonCol);
    return res;
  }

  vec3 ground(vec2 q, vec3 horizonCol) {
    float hz = ${HZ}.0;
    // 地面：每個像素的深度 z 與左右位置 x（以路中線為 0，路有彎）
    float dy = max(q.y - hz, 0.5);
    float z = ${CAMK}.0 / dy;
    float X = (q.x - ${VPX}.0) * z / ${FOC}.0;
    float rx = X - bend * z * z;
    float fw = max(fwidth(rx), 1e-4);
    float s = z + travel;
    // 田：一壟一壟（跟路平行），大片的顏色交替
    float patchN = snoise(vec2(floor(rx / 14.0) * 1.7, s / 40.0 + seedOff));
    vec3 field = mix(mix(C_PAPER, C_GINGHAM, 0.55) * 0.74, mix(C_PAPER, C_FUR, 0.45) * 0.78, step(0.2, patchN));
    float row = abs(fract(rx / 1.4) - 0.5) * 1.4;
    field *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.25 + fw, row)) * smoothstep(60.0, 8.0, z);
    vec3 col = field;
    // 路肩的草
    float ar = abs(rx);
    col = mix(col, mix(C_PAPER, C_GINGHAM, 0.5) * 0.7, smoothstep(6.5 + fw, 6.5 - fw, ar));
    // 路面：柏油（遠的淡一點），兩邊白線，中間的虛線每一拍過一段
    vec3 asphalt = mix(C_ASH, C_SEPIA, 0.35) * 0.62 * (0.95 + 0.05 * snoise(vec2(rx * 3.0, s * 0.8)));
    float road = smoothstep(4.6 + fw, 4.6 - fw, ar);
    col = mix(col, asphalt, road);
    float edge = 1.0 - smoothstep(0.08, 0.08 + fw * 1.2, abs(ar - 4.25));
    col = mix(col, C_BONE * 0.8, edge * 0.85);
    float dash = step(fract(s / 12.0), 0.42) * (1.0 - smoothstep(0.09, 0.09 + fw * 1.2, ar));
    col = mix(col, mix(C_BONE, C_SIGNAL, 0.25) * 0.82, dash * 0.9);
    // 遠處的霧
    col = mix(col, horizonCol, exp(-dy / 70.0) * 0.85);
    return col;
  }

  // 路邊的東西（電線桿、行道樹）：一根一根算位置，畫成扁扁的長方形／橢圓
  vec3 roadside(vec2 q, vec3 col) {
    float hz = ${HZ}.0;
    vec3 horizonCol = mix(C_PAPER, C_SIGNAL, 0.2) * 0.92;
    float ph = fract(travel / 48.0);
    for (int i = 0; i < 7; i++) {
      float z = 48.0 * (float(i) + 1.0 - ph) - 30.0;
      if (z < 2.5) continue;
      float sc = ${FOC}.0 / z;
      float gy = hz + ${CAMK}.0 / z;
      float haze = exp(-(gy - hz) / 70.0) * 0.85;
      // 右邊：電線桿
      float px = ${VPX}.0 + (8.5 + bend * z * z) * sc;
      float hw = max(0.16 * sc, 0.7);
      float top = gy - 10.0 * sc;
      float aa = 0.8;
      float pole = (1.0 - smoothstep(hw - aa, hw + aa, abs(q.x - px))) * step(top, q.y) * step(q.y, gy);
      float arm = (1.0 - smoothstep(0.1 * sc - aa, 0.1 * sc + aa, abs(q.y - top - 0.8 * sc))) * step(abs(q.x - px), 1.2 * sc);
      col = mix(col, mix(mix(C_SEPIA, C_PAPER, 0.25) * 0.5, horizonCol, haze), max(pole, arm));
      // 左邊：行道樹（樹幹＋圓樹冠），跟電線桿錯開半格
      float zt = z + 24.0;
      float sct = ${FOC}.0 / zt;
      float gyt = hz + ${CAMK}.0 / zt;
      float tx = ${VPX}.0 + (-9.5 + bend * zt * zt) * sct;
      float hazeT = exp(-(gyt - hz) / 70.0) * 0.85;
      vec2 cq = (q - vec2(tx, gyt - 5.2 * sct)) / (vec2(2.2, 2.6) * sct);
      float crown = 1.0 - smoothstep(1.0 - 1.5 / (2.2 * sct), 1.0 + 1.5 / (2.2 * sct), length(cq) + 0.12 * snoise(cq * 2.0 + float(i)));
      float trunk = (1.0 - smoothstep(0.18 * sct - aa, 0.18 * sct + aa, abs(q.x - tx))) * step(gyt - 3.0 * sct, q.y) * step(q.y, gyt);
      vec3 tc = mix(mix(C_GINGHAM, C_SEPIA, 0.45) * (0.48 + 0.1 * cq.y), horizonCol, hazeT);
      col = mix(col, tc, max(crown, trunk));
    }
    return col;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w = p - bob;
    // 窗外：傾斜一點點（車子壓彎）
    vec2 vp = vec2(${VPX}.0, ${HZ}.0);
    vec2 q = vp + rot2(roll) * (p - vp - bob * 0.3);
    vec3 col = outside(q);
    col = roadside(q, col);
    // 擋風玻璃：很淡的斜反光；下緣映著儀表板（一層亮霧）
    col += C_BONE * 0.03 * smoothstep(0.3, 0.0, abs(fract((w.x * 0.8 - w.y) / 1400.0) - 0.5));
    col = mix(col, mix(C_PAPER, C_ASH, 0.3) * 0.86, 0.22 * smoothstep(${H - 330}.0, ${H - 230}.0, w.y));
    // 字後面：很淡的亮霧（天空上的字才清楚；長的留言寫到地平線下面、近的電線桿刷過去時也要清楚）
    vec2 tq = max(abs(w - textRect.xy - textRect.zw * 0.5) - textRect.zw * 0.5, 0.0);
    col = mix(col, mix(C_PAPER, C_BONE, 0.4) * 0.88, 0.66 * exp(-dot(tq, tq) / 7000.0) * step(1.0, textRect.z));

    // ---- 車頂內襯（最上面一條）＋後照鏡
    float roof = 46.0 + 6.0 * sin(w.x / ${W}.0 * 3.1416);
    if (w.y < roof + 2.0) col = mix(col, mix(C_PAPER, C_ASH, 0.4) * 0.8 * (0.94 + 0.04 * snoise(w / 4.0)), smoothstep(roof + 2.0, roof - 2.0, w.y));
    vec2 mc = vec2(1330.0, 108.0);
    float dStem = sdBox(w - vec2(mc.x, 60.0), vec2(9.0, 30.0));
    col = mix(col, C_GRAPHITE * 0.6, 1.0 - smoothstep(-0.8, 0.8, dStem));
    float dM = rbox(w - mc, vec2(150.0, 46.0), 30.0);
    col *= 1.0 - 0.18 * shadowAt(dM - 6.0, 10.0) * step(0.0, dM);
    if (dM < 1.0) {
      vec3 mcol = C_GRAPHITE * 0.55;
      float dG = rbox(w - mc, vec2(140.0, 37.0), 24.0);
      if (dG < 0.0) {
        // 鏡子裡：往後退的路（左右相反、比較暗）
        vec2 mq = (w - mc) / vec2(140.0, 37.0);
        vec3 ms = mix(C_PAPER, C_BONE, 0.3) * 0.7;
        float mz = 0.6 / max(mq.y + 0.15, 0.02);
        if (mq.y > -0.15) {
          float mrx = mq.x * mz;
          ms = mix(mix(C_PAPER, C_GINGHAM, 0.5) * 0.55, mix(C_ASH, C_SEPIA, 0.35) * 0.5, step(abs(mrx), 0.9));
          ms = mix(ms, C_BONE * 0.7, step(abs(mrx), 0.04) * step(0.5, fract(mz * 1.5 - travel * 0.125)));
          ms = mix(ms, mix(C_PAPER, C_BONE, 0.3) * 0.7, exp(-(mq.y + 0.15) * 9.0));
        }
        ms += C_BONE * 0.05 * smoothstep(0.2, 0.0, abs(mq.x + mq.y * 0.5 - 0.2));
        mcol = mix(mcol, ms, 1.0 - smoothstep(-0.02, 0.0, dG / 37.0));
      }
      col = mix(col, mcol, 1.0 - smoothstep(-0.8, 0.8, dM));
    }

    // ---- A 柱（兩邊斜斜的深色，靠鏡頭比較近：邊緣糊一點）
    float lp = w.x - (110.0 + (${H}.0 - w.y) * 0.14);
    float rp = ((${W - 120}.0 - (${H}.0 - w.y) * 0.1) - w.x);
    vec3 pillar = mix(mix(C_GRAPHITE, C_SEPIA, 0.3), C_PAPER, 0.18) * 0.62;
    col = mix(col, pillar * (0.9 + 0.1 * smoothstep(-80.0, 0.0, lp)), 1.0 - smoothstep(-6.0, 6.0, lp));
    col = mix(col, pillar, 1.0 - smoothstep(-6.0, 6.0, rp));

    // ---- 遮陽板：放下來，布面、一圈車縫線、化妝鏡的蓋子
    vec2 vc = visor.xy, vh = visor.zw;
    float dV = rbox(w - vc, vh, 34.0);
    col *= 1.0 - 0.2 * shadowAt(dV - 2.0, 14.0) * step(0.0, dV) * step(w.y, vc.y + vh.y + 40.0);
    if (dV < 1.0) {
      vec3 vcol = mix(C_PAPER, C_ASH, 0.38) * 0.84 * (0.95 + 0.03 * snoise(w / 3.0) + 0.04 * snoise(w / 60.0));
      vcol *= 1.0 + 0.08 * smoothstep(vh.y, -vh.y, w.y - vc.y) - 0.12 * smoothstep(-10.0, 0.0, dV);
      vcol *= 1.0 - 0.12 * (1.0 - smoothstep(0.6, 1.4, abs(dV + 14.0))) * step(0.5, fract((w.x + w.y) / 9.0));
      float dF = rbox(w - vc - vec2(vh.x * 0.25, 4.0), vec2(vh.x * 0.42, vh.y * 0.5), 14.0);
      vcol *= 1.0 - 0.1 * (1.0 - smoothstep(0.5, 1.8, abs(dF)));
      vcol *= 1.0 + 0.04 * step(dF, 0.0);
      col = mix(col, vcol, 1.0 - smoothstep(-0.8, 0.8, dV));
    }
    // 遮陽板的轉軸（左上）
    float dR = sdSegment(w, vec2(vc.x - vh.x - 30.0, vc.y - vh.y + 26.0), vec2(vc.x - vh.x + 60.0, vc.y - vh.y + 26.0)) - 9.0;
    col = mix(col, C_GRAPHITE * 0.7, 1.0 - smoothstep(-0.8, 0.8, dR));

    // ---- 照片：木夾子夾在遮陽板下緣，鐘擺
    vec2 lq = rot2(swing) * (w - pivot);
    vec2 pq = lq - vec2(0.0, hs.y + bd + 14.0);
    float dsP = sdBox(pq - vec2(6.0, 10.0), hs + vec2(bd));
    col *= 1.0 - 0.16 * shadowAt(dsP, 16.0);
    vec4 pr = printAt(pq, hs, bd, C_BONE * 0.9);
    col = mix(col, pr.rgb, pr.a);
    // 木夾子：兩片木頭疊在一起，中間一圈鐵絲
    vec2 cq = lq - vec2(0.0, 10.0);
    float dClip = rbox(cq, vec2(15.0, 40.0), 6.0);
    col *= 1.0 - 0.25 * shadowAt(rbox(cq - vec2(4.0, 6.0), vec2(15.0, 40.0), 6.0), 6.0);
    if (dClip < 1.0) {
      vec3 wood = mix(C_FUR, C_PAPER, 0.25) * 0.78 * (0.92 + 0.08 * sin(cq.y * 0.6 + snoise(cq / 8.0) * 2.0));
      wood *= 1.0 - 0.25 * step(abs(cq.x), 1.2);
      wood = mix(wood, C_GRAPHITE * 0.8, (1.0 - smoothstep(1.5, 3.0, abs(cq.y + 2.0))) * step(abs(cq.x), 17.0));
      col = mix(col, wood, 1.0 - smoothstep(-0.8, 0.8, dClip));
    }

    // ---- 儀表板（最下面，淺色）
    float dash = ${H - 210}.0 + 18.0 * pow((w.x - ${W / 2}.0) / ${W / 2}.0, 2.0);
    if (w.y > dash - 2.0) {
      vec3 dcol = mix(C_PAPER, C_ASH, 0.45) * 0.72 * (0.96 + 0.03 * snoise(w / 5.0));
      dcol *= 1.0 + 0.14 * exp(-(w.y - dash) / 10.0) - 0.1 * smoothstep(dash, ${H}.0, w.y);
      // 除霧口的格柵
      dcol *= 1.0 - 0.1 * step(abs(w.y - dash - 30.0), 7.0) * step(0.5, fract(w.x / 14.0)) * step(abs(w.x - 980.0), 380.0);
      col = mix(col, dcol, smoothstep(dash - 2.0, dash + 2.0, w.y));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, t: { value: 0 }, k: { value: 1 }, bob: { value: new THREE.Vector2() }, roll: { value: 0 },
  travel: { value: 0 }, bend: { value: 0 }, seedOff: { value: 0 },
  visor: { value: new THREE.Vector4() }, pivot: { value: new THREE.Vector2() }, swing: { value: 0 }, hs: { value: new THREE.Vector2() }, bd: { value: 18 },
  textRect: { value: new THREE.Vector4() },
});

/**
 * 天空上的字塊：左緣、寬、高上限（相簿名＋主字＋署名＋歌詞）。右緣 1690 在右邊 A 柱的左邊；
 * 頂在後照鏡下面（y ≥ 190），長的留言最低寫到 y ≈ 700（擋風玻璃下緣映著儀表板的亮霧上面）。
 */
const COL_X = 1090, COL_W = 600, COL_H = 500;

export default class RoadTrip extends JourneyPlate {
  bg = shared('roadtrip.bg', BG);
  text = this.track(new Layer2D(COL_W + 40, COL_H + 60, undefined, { fast: true }));
  vx = 0; vy = 0; vhx = 0; vhy = 0;
  pvx = 0; pvy = 0; hw = 0; hh = 0; bd = 18;
  colX = 0; colY = 0;

  override async init() {
    await this.loadPhoto();
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.ming(700), lineHeight: 1.4, maxLines: 5,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.32), active: mixRgba('signal', 'sepia', 0.4), sigInk: rgba('sepia', 0.72), sigFamily: F.ming(500),
      label: { family: F.hei(500), size: 21, color: rgba('sepia', 0.58), tracking: 6, gap: 24 },
    });
    const { w, h } = this.img!;
    // 照片掛在遮陽板下緣：有說明時靠左（遮陽板右緣在字的左邊），沒有時靠中間一點
    const s = this.fitScale(this.hasText ? 680 : 760, 520);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bd = clamp(0.035 * Math.min(w * s, h * s), 12, 22);
    const cx = this.hasText ? 580 : 820;
    this.vhx = 430; this.vhy = 120;
    this.vx = cx + 30; this.vy = 46 + this.vhy - 6;
    this.pvx = cx; this.pvy = this.vy + this.vhy - 8;
    this.colX = COL_X;
    // 短的字塊在天空正中（地平線上面）；長的往下寫，最後一排不低於 700
    const bh = this.blockH();
    this.colY = clamp(370 - bh / 2, 190, 700 - bh);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    // 車子在路上：輕輕上下、大鼓時顛一下；壓彎時窗外斜一點
    const by = 2.2 * Math.sin(t * 5.3) + 1.2 * Math.sin(t * 2.1 + 0.7) - 4 * f.a.kick;
    const bx = 1.5 * Math.sin(t * 1.3);
    (u.bob!.value as THREE.Vector2).set(bx, by);
    const bend = 0.0016 * Math.sin(t * 0.21 + hash(this.seed, 3) * 6);
    u.bend!.value = bend;
    u.roll!.value = -bend * 140 * (Math.PI / 180);
    // 中線虛線一拍過一段（12 單位）
    u.travel!.value = 12 * audio.beatAt(t);
    u.t!.value = t;
    u.seedOff!.value = hash(this.seed, 5) * 20;
    (u.visor!.value as THREE.Vector4).set(this.vx, this.vy, this.vhx, this.vhy);
    (u.pivot!.value as THREE.Vector2).set(this.pvx, this.pvy);
    // 照片從上面盪下來（彈簧），之後跟著車子晃
    const inK = springStep(Math.max(0, t - s), 1.05, 0.3);
    const sw = (1 - inK) * 10 + 1.0 * Math.sin(t * 1.7) + 0.6 * Math.sin(t * 3.1 + 1) - 1.4 * f.a.kick;
    u.swing!.value = sw * (Math.PI / 180);
    (u.hs!.value as THREE.Vector2).set(this.hw, this.hh);
    u.bd!.value = this.bd;
    // 盪好之後相片上的畫面往焦點推
    this.setPhoto(u, 2 * this.hw, this.focusK(t, s + 0.6), 1.18);
    const bh = this.blockH();
    (u.textRect!.value as THREE.Vector4).set(this.hasText ? this.colX - 10 : 0, this.colY - 10, this.hasText ? this.blockW() + 20 : 0, bh + 30);
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.hasText) {
      this.paintBlock(this.text, t, 20, 20);
      const op = prog(t, s + 0.5, s + 1.1, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      if (op > 0) blit(comp, renderer, this.text, out, this.colX - 20 + bx, this.colY - 20 + by, { opacity: op });
    }
    return { paper: 1, bloom: 0.14, bloomThreshold: 1.1, halation: 0.06, vignette: 0.36 };
  }
}
