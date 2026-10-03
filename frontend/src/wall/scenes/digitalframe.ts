// 照片版面「電子相框」（暗）：夜裡暗暗的房間，一台沒有品牌的數位相框立在深色木桌上——
//  - 相框微微側轉（透視），鏡頭很慢地推近、繞一點；遠處牆邊兩顆很糊的暖色燈光斑（景深），桌面越近越糊。
//  - 螢幕 16:10：橫的照片滿版，直的、方的、很小的舊照片完整放，兩側用同一張照片模糊壓暗補滿（數位相框真的這樣）；
//    螢幕上的畫面往新人點的焦點（臉）推近（Ken Burns），螢幕下面有字時臉放在偏上一點，不被字蓋住。
//    螢幕上有很淡的像素格（鏡頭推近時稍微明顯）、一道斜斜的玻璃反光、邊緣一點背光不均。照片仍然不發光（最亮約 0.82）。
//  - 螢幕的光（照片的平均色）灑在桌面與相框周圍，亮面的桌子上有一片糊糊的倒影。
//  - 進場：螢幕開機（背光從黑變暗灰、電源燈亮）→ 照片淡入。
//  - 字是相框自己顯示的說明：螢幕下方、思源黑體、下面一層很淡的暗漸層，跟著螢幕一起透視。
//    主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在最下面跟唱；沒有主字就把歌詞顯示在同一個位置跟唱；兩樣都沒有就只有照片。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, v2, v4, type P2Photo } from './_p2';
import { focusCrop, loadWords, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'frame', energy: [0, 0.8], bars: [2, 8], weight: 1, prefers: ['landscape'] };

/** 螢幕大小（16:10）、邊框、下巴；相框站在桌上的那條線、桌子後緣。 */
const SW = 1000, SH = 625, BZ = 34, CHIN = 46, BASE = 872, EDGE = 770;

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform sampler2D photo; uniform sampler2D cap; uniform vec2 capSize; uniform vec2 capPos; uniform float capOn; uniform float capTop;
  uniform vec3 cam; uniform vec2 dc; uniform float yaw;
  // 照片在螢幕上的範圍（螢幕座標，原點在螢幕中心）：中心、半寬高；對應到照片的哪一塊（uv）；模糊補底那一塊
  uniform vec4 prc; uniform vec4 crop; uniform vec4 fcrop; uniform float fillOn;
  uniform float lod; uniform float flod; uniform float power; uniform float show; uniform float grid; uniform float t; uniform float k;
  const vec2 SHALF = vec2(${(SW / 2).toFixed(1)}, ${(SH / 2).toFixed(1)});
  const float BZ = ${BZ}.0, CHIN = ${CHIN}.0, BASE = ${BASE}.0, EDGE = ${EDGE}.0;

  // 螢幕的內容（照片、補底、說明字），sq 是螢幕座標
  vec3 screenAt(vec2 sq) {
    vec2 suv = (sq + SHALF) / (2.0 * SHALF);
    vec3 c = vec3(0.0);
    if (fillOn > 0.5) c = photoLin(photo, mix(fcrop.xy, fcrop.zw, suv), flod) * 0.2;
    vec2 pq = (sq - prc.xy) / prc.zw;
    float pd = max(abs(pq.x) - 1.0, abs(pq.y) - 1.0) * min(prc.z, prc.w);
    if (pd < 1.0) {
      vec3 ph = photoLin(photo, mix(crop.xy, crop.zw, pq * 0.5 + 0.5), lod);
      c = mix(c, ph, 1.0 - smoothstep(-0.7, 0.7, pd));
    }
    c *= show;
    // 說明字：下面一層很淡的暗漸層（不是框），字是 bone
    if (capOn > 0.0) {
      float g = smoothstep(capTop - 90.0, capTop + 30.0, sq.y);
      c *= 1.0 - 0.6 * g * capOn;
      vec4 tx = layerAt(cap, sq - capPos, capSize);
      c = c * (1.0 - tx.a * capOn) + tx.rgb * 0.92 * capOn;
    }
    return c;
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // 螢幕的平均色（最高的 mip 層）：拿來染桌面、牆上的光
    vec3 avg = toLinear(textureLod(photo, vec2(0.5), 12.0).rgb) * 0.82;
    vec3 glowC = mix(vec3(luma(avg)), avg, 0.7) * show * power + vec3(0.004) * power;
    vec3 warm = mix(C_FUR, C_BONE, 0.42);
    // 相框（側轉）的座標：原點在螢幕中心
    vec2 q = yawInv(p - dc, yaw, 1600.0);
    vec2 oc = vec2(0.0, (CHIN - BZ) * 0.5), oh = SHALF + vec2(BZ, (BZ + CHIN) * 0.5);
    float dDev = sdBox(q - oc, oh - vec2(18.0)) - 18.0;
    vec3 col;
    if (p.y < EDGE) {
      // ---- 牆：暗暗的灰泥；遠處兩顆很糊的暖色燈光斑；相框周圍一圈螢幕的光
      float n = fbm(p / 420.0, 2);
      col = mix(C_INK, C_INK2, 0.8) * (0.85 + 0.25 * n);
      vec2 l1 = (p - vec2(250.0, 290.0)), l2 = (p - vec2(1690.0, 210.0));
      float b1 = 1.0 - smoothstep(64.0, 92.0, length(l1)), b2 = 1.0 - smoothstep(40.0, 62.0, length(l2));
      // 光斑邊緣亮一點點（鏡頭焦外的光斑）
      col += warm * (0.15 * b1 * (0.82 + 0.25 * smoothstep(52.0, 84.0, length(l1))) + 0.1 * b2 * (0.82 + 0.25 * smoothstep(30.0, 56.0, length(l2))));
      col += warm * 0.025 * (exp(-length(l1) / 260.0) + 0.6 * exp(-length(l2) / 200.0));
      col += glowC * 0.09 * exp(-max(dDev, 0.0) / 220.0);
      col *= 1.0 - 0.3 * smoothstep(EDGE - 80.0, EDGE, p.y);
    } else {
      // ---- 桌面：深色木頭（透視、越近越糊），亮面上有相框的糊倒影，螢幕的光灑在前面
      float dz = p.y - 330.0;
      float tv = 280000.0 / dz;
      vec2 tp = vec2((p.x - ${W / 2}.0) * (${EDGE - 330}.0 / dz), tv * 1.3);
      float near = smoothstep(EDGE + 60.0, 1080.0, p.y);
      vec3 base = mix(C_FUR, C_INK, 0.86);
      float g = fbm(vec2(tp.x / 600.0, tp.y / 30.0), 3);
      col = base * (0.8 + (0.3 * g) * (1.0 - 0.8 * near));
      // 倒影：相框對著桌面翻下來（壓扁、很糊）
      vec2 rq = yawInv(vec2(p.x, BASE - (p.y - BASE) * 1.7) - dc, yaw, 1600.0);
      float rd = sdBox(rq, SHALF);
      float fade = exp(-max(p.y - BASE, 0.0) / 110.0) * step(BASE, p.y);
      col += glowC * 0.22 * (1.0 - smoothstep(-50.0, 70.0, rd)) * fade;
      // 螢幕的光灑在相框前面的桌上
      float sx = abs(q.x) / (SHALF.x + 120.0);
      col += glowC * 0.13 * exp(-max(p.y - BASE, 0.0) / 150.0) * (1.0 - smoothstep(0.5, 1.2, sx));
      // 相框底下的接觸陰影
      vec2 cq = (p - vec2(dc.x, BASE + 6.0)) / vec2(oh.x * 1.05, 10.0);
      col *= 1.0 - 0.6 * exp(-dot(cq, cq));
      col *= 1.0 - 0.25 * near;
    }
    // ---- 相框：黑色亮面塑膠邊框（圓角）、螢幕、電源燈
    if (dDev < 1.0) {
      float a = 1.0 - smoothstep(-0.8, 0.8, dDev);
      vec3 bz = C_INK * 1.3 + vec3(0.006);
      // 邊框外緣一道很細的亮邊（上緣接到房間的燈）、表面很淡的漸層反光
      float rim = 1.0 - smoothstep(0.0, 2.6, -dDev);
      bz += warm * 0.05 * rim * (0.5 + 0.5 * smoothstep(oh.y, -oh.y, q.y));
      bz += C_BONE * 0.012 * smoothstep(oh.y, -oh.y, q.y + q.x * 0.3);
      // 電源燈
      float led = 1.0 - smoothstep(2.0, 3.4, length(q - vec2(SHALF.x - 34.0, SHALF.y + CHIN * 0.5)));
      bz = mix(bz, mix(C_GRAPHITE * 0.2, C_EMBER * 0.7, power), led);
      float dS = sdBox(q, SHALF);
      if (dS < 1.0) {
        vec2 suv = (q + SHALF) / (2.0 * SHALF);
        vec3 sc = screenAt(q);
        // 背光：開機後是很暗的灰；邊緣一點背光不均
        float edgeGlow = smoothstep(0.55, 1.0, max(abs(suv.x - 0.5), abs(suv.y - 0.5)) * 2.0);
        sc += vec3(0.006 + 0.01 * edgeGlow) * power;
        // 像素格：很淡的正弦（不會有摩爾紋），鏡頭推近時明顯一點
        float px = (0.5 - 0.5 * cos(q.x * 1.2566)) * 0.6 + (0.5 - 0.5 * cos(q.y * 1.2566)) * 0.4;
        sc *= 1.0 - grid * px;
        // 玻璃：一道斜斜的反光（跟著側轉的角度移）、房間燈的倒影；關機時就是一片黑玻璃
        float band = exp(-pow((q.x * 0.55 + q.y + 900.0 * yaw - 140.0) / 130.0, 2.0));
        sc += C_BONE * (0.022 * band + 0.004);
        sc += warm * 0.03 * exp(-dot((q - vec2(-SHALF.x * 0.62, -SHALF.y * 0.7)) / 90.0, (q - vec2(-SHALF.x * 0.62, -SHALF.y * 0.7)) / 90.0));
        // 螢幕跟邊框之間一道很細的黑縫
        bz = mix(bz * 0.6, sc, 1.0 - smoothstep(-1.2, 0.2, dS));
      }
      col = mix(col, bz, a);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, cap: { value: null }, capSize: { value: new THREE.Vector2(1, 1) }, capPos: { value: new THREE.Vector2() }, capOn: { value: 0 }, capTop: { value: 0 },
  cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, dc: { value: new THREE.Vector2() }, yaw: { value: 0 },
  prc: { value: new THREE.Vector4(0, 0, SW / 2, SH / 2) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, fcrop: { value: new THREE.Vector4(0, 0, 1, 1) }, fillOn: { value: 0 },
  lod: { value: 0 }, flod: { value: 5 }, power: { value: 0 }, show: { value: 0 }, grid: { value: 0.02 }, t: { value: 0 }, k: { value: 1 },
});

/** 說明字離螢幕左邊、下緣。 */
const CAP_X = 52, CAP_BOTTOM = 46;

export default class DigitalFrame extends Scene {
  bg = shared('digitalframe.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  ph: P2Photo | null = null;
  cap: Caption | null = null;
  capL: Layer2D | null = null;
  /** 滿版（橫的照片）或完整放＋模糊補底。 */
  cover = false;
  /** 照片在螢幕上的半寬高（完整放時）。 */
  phw = SW / 2; phh = SH / 2;
  /** 說明字的圖層在螢幕座標的左上角、說明字的上緣。 */
  capX = 0; capY = 0; capTop = 0;
  /** 相框（螢幕中心）的位置。 */
  dx = 900; dy = BASE - SH / 2 - CHIN;

  override async init() {
    const ctx = this.ctx;
    await loadText(`${ctx.params.photo?.caption ?? ''}${ctx.params.photo?.album ?? ''}`);
    await loadWords(ctx);
    [this.ph] = await loadPhotos(ctx, (x) => this.track(x), 1);
    const ph = this.ph!;
    const a = ph.w / ph.h;
    this.cover = a >= 1.4 && a <= 1.9 && ph.w >= SW / 1.5;
    if (!this.cover) {
      const f = fitIn(ph.w, ph.h, SW, SH);
      this.phw = f.w / 2; this.phh = f.h / 2;
    }
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    // 寬 856：60 字的長留言在 40 px 三行；整塊壓矮一點（行距、署名、歌詞都收緊），螢幕上的照片才不會被字蓋掉一半
    this.cap = new Caption(ctx, meas.ctx, {
      family: F.hei(500), w: SW - 2 * CAP_X - 40, h: 230, min: 40, max: 46, lineHeight: 1.32, maxLines: 3,
      ink: rgba('bone', 0.96), unsung: rgba('bone', 0.4), sigInk: rgba('bone', 0.78), sigSize: 26,
      lyricSize: 46, lyricSubSize: 36, gap: 18,
      label: { family: F.hei(500), size: 22, color: rgba('ash', 0.95), tracking: 5, gap: 14 },
      shadow: { color: rgba('ink', 0.6), blur: 10 },
    });
    const cap = this.cap;
    if (cap.on) {
      const lw = SW - 2 * CAP_X + 20, lh = cap.height + 40;
      this.capL = this.track(new Layer2D(lw, lh, undefined, { fast: true }));
      // 圖層的左上角（螢幕座標，原點在螢幕中心）：最後一行的基線離螢幕下緣 CAP_BOTTOM
      this.capX = -SW / 2 + CAP_X - 10;
      this.capY = SH / 2 - CAP_BOTTOM - cap.height - 20;
      this.capTop = this.capY + 20;
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const ph = this.ph!;
    const u = this.bg.u;
    const z = settle(lt);
    // 鏡頭：慢慢推近、繞過來一點（側轉的角度變小）
    const dir = hash(this.seed, 6) < 0.5 ? 1 : -1;
    u.yaw!.value = dir * lerp(0.2, 0.08, ease.inOutQuad(clamp(lt / 9)));
    const cam = { x: this.dx + dir * 30 * (1 - z), y: this.dy + 46 - 14 * z, z: 1 + 0.06 * z };
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    v2(u.dc!, this.dx, this.dy);
    u.photo!.value = ph.tex;
    // 開機：背光從黑變暗灰 → 照片淡入
    u.power!.value = ease.outCubic(prog(t, s + 0.08, s + 0.35));
    u.show!.value = ease.inOutQuad(prog(t, s + 0.3, s + 1.0)) * (1 - 0.15 * prog(t, e - 0.3, e));
    u.grid!.value = 0.025 + 0.03 * z;
    u.t!.value = t;
    u.k!.value = 1;
    const { w, h, ref } = ph;
    const kf = settleK(lt);
    // 螢幕下面有字時，臉放在畫面偏上一點（框往照片下面挪一點），不被字和暗漸層蓋住；
    // 臉本來就靠照片上緣時少挪，臉離框的上緣至少留框高的 15%（焦點永遠不能被裁出去）
    const lift = (c: [number, number, number, number]) => {
      if (!this.capL) return c;
      const ch = c[3] - c[1];
      const d = Math.max(0, Math.min(0.16 * ch, 1 - c[3], ref.fy - c[1] - 0.15 * ch));
      return [c[0], c[1] + d, c[2], c[3] + d] as [number, number, number, number];
    };
    if (this.cover) {
      // 滿版：往焦點推近（螢幕：1.25 倍），焦點不會被裁掉
      const crop = lift(focusCrop(ref, w, h, SW / SH, kf, { zoom: 1.25 }));
      v4(u.prc!, 0, 0, SW / 2, SH / 2);
      v4(u.crop!, crop[0], crop[1], crop[2], crop[3]);
      u.fillOn!.value = 0;
      u.lod!.value = mipLod((crop[2] - crop[0]) * w, SW * cam.z);
    } else {
      // 完整放：照片的範圍很慢地放大一點點，框裡的畫面往焦點推（很小的照片少推），兩側用同一張照片模糊補滿
      const g = 1 + 0.025 * z;
      v4(u.prc!, 0, 0, this.phw * g, this.phh * g);
      const crop = lift(focusCrop(ref, w, h, w / h, kf, { zoom: 1.2, screenW: 2 * this.phw * g * cam.z }));
      v4(u.crop!, crop[0], crop[1], crop[2], crop[3]);
      const sc = Math.max(SW / w, SH / h);
      const fw = SW / (w * sc), fh = SH / (h * sc);
      v4(u.fcrop!, 0.5 - fw / 2, 0.5 - fh / 2, 0.5 + fw / 2, 0.5 + fh / 2);
      u.fillOn!.value = 1;
      u.flod!.value = Math.max(0, Math.log2((fw * w) / 24));
      u.lod!.value = mipLod((crop[2] - crop[0]) * w, 2 * this.phw * g * cam.z);
    }
    if (this.capL && this.cap) {
      const L = this.capL;
      if (this.cap.draw(L, 10, 20, t)) L.upload();
      u.cap!.value = L.texture;
      v2(u.capSize!, L.w, L.h);
      v2(u.capPos!, this.capX, this.capY);
      u.capTop!.value = this.capTop;
      u.capOn!.value = prog(t, s + 0.85, s + 1.35, ease.outCubic) * (1 - prog(t, e - 0.3, e));
    } else {
      // 共用的 pass 可能還指著上一個窗格（已經釋放）的圖層：清掉
      u.cap!.value = null;
      u.capOn!.value = 0;
    }
    this.bg.render(renderer, out);
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.14, vignette: 0.5 };
  }
}
