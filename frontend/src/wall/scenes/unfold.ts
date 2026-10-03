// 照片版面「摺紙攤開」（亮）：照片印在一張紙上（下面留白處手寫著註解），紙摺成四分之一放在淺灰的石桌上，
// 拍點上一摺一摺攤開——
//  - 一開始只看得到右下那四分之一（上半、左半都往後摺在背面），鏡頭貼近這一小疊紙；第一個拍點上半片從背後翻出來
//    （繞著橫的摺線翻、翻到一半時紙的尖端離鏡頭比較近、變大一點，影子落在桌上），下一個拍點左半片翻出來，
//    鏡頭同時拉開到整張紙。攤平之後兩道摺痕還在（很淡的一亮一暗），照片完整清楚。
//  - 焦點：攤開以後鏡頭一開始快、越來越慢地往照片的焦點推近（焦點往畫面中間移，字一直在安全區裡），
//    印在紙上的畫面本身也往焦點小推一點。
//  - 窗格短（3 秒）時兩摺都壓在一秒內，後面是完整的紙。很小的照片最多放大 1.5 倍。
//  - 字手寫在照片下面的留白（跟著紙一起摺、一起攤開）：主字（賓客留言＋署名，或新人的註解）＋歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己寫在同一個位置跟唱；兩個都沒有就沒有下面的留白（紙只比照片大一圈）。
//    直的、方的照片寫在照片右邊的留白（紙變成橫的，長留言也不會把照片擠小）。相簿的第一張在字上面多一行小小的相簿名。
// 畫法：一個全螢幕 shader。翻起來的那一片用針孔相機的透視算回紙上的座標（解一個一次式），在摺線外面的才畫；
// 翻到背面那一半（角度 > 90°）時在固定的那一片後面，先畫；翻過來以後畫在前面。紙上的字層在 shader 裡取樣。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, focusAmp, focusAt, focusCam, loadPhoto, p6Crop, pace, photoLod, setP6Photo, type Cam, type FocusCamOpts } from './_p6';
import { focusCrop, settleK } from './_photo';
import { HUD_SAFE } from '../engine/hud';
import type { PhotoImage } from '../photos';

// 縮圖拍在左半片正翻過來（看得到紙的透視）
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, energy: [0.1, 1], bars: [2, 8], weight: 1, thumbAt: 0.092 };

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D tl;
  uniform vec3 cam;
  uniform vec4 sheet;        // 紙 x0, y0, x1, y1（攤平的位置）
  uniform vec4 prc;          // 照片在紙上的 x0, y0, x1, y1
  uniform float lod; uniform vec4 tlR; uniform float textK;
  uniform float f1; uniform float f2;   // 上半片、左半片的角度（π = 摺在背後，0 = 攤平）
  uniform float lift; uniform float k;
  const float HC = 2600.0;   // 相機離桌面多高（px）：決定翻起來的紙尖放大多少
  // 紙面（攤平的座標）上的顏色
  vec3 face(vec2 q) {
    vec3 c = p6Paper(q * 1.2, C_BONE * 0.93);
    vec2 uv = (q - prc.xy) / (prc.zw - prc.xy);
    float pa = aaFill(sdBox(q - 0.5 * (prc.xy + prc.zw), 0.5 * (prc.zw - prc.xy)));
    c = mix(c, p6Photo(photo, uv, lod), pa);
    vec4 tx = p6Layer(tl, q - tlR.xy, tlR.zw) * textK;
    c = c * (1.0 - tx.a) + tx.rgb;
    // 攤開以後的摺痕：一亮一暗（照片上也有，很淡）
    vec2 m = 0.5 * (sheet.xy + sheet.zw);
    c *= 1.0 + 0.035 * (exp(-pow((q.x - m.x + 2.0) / 2.5, 2.0)) - exp(-pow((q.x - m.x - 3.0) / 3.5, 2.0))) * (1.0 - f2 / 3.1416);
    c *= 1.0 + 0.035 * (exp(-pow((q.y - m.y + 2.0) / 2.5, 2.0)) - exp(-pow((q.y - m.y - 3.0) / 3.5, 2.0))) * (1.0 - f1 / 3.1416);
    return c;
  }
  // 翻起來的那一片：摺線在 a = fold（往外是 dir 的方向），平行座標 b 在 [b0, b1]，長 len；回傳 (紙上座標, 覆蓋, 亮度)
  // a、b 是畫面座標沿著「垂直摺線」與「平行摺線」的分量，ca、cb 是相機中心
  vec4 flap(float as, float bs, float fold, float dir, float len, float b0, float b1, float phi, float ca, float cb) {
    float s = sin(phi), c = cos(phi);
    float ra = (as - fold) * dir, rc = (as - ca) * dir;
    float den = HC * c + rc * s;
    if (den <= 1e-3) return vec4(0.0);
    float v = HC * ra / den;
    float kk = HC / (HC - v * s);
    float bw = cb + (bs - cb) / kk;
    float d = max(max(-v, v - len), max(b0 - bw, bw - b1));
    float cov = 1.0 - smoothstep(-0.8, 0.8, d * kk);
    // 照光：翻起來的時候朝光的那面比較亮（光從左上）
    float lit = 0.88 + 0.12 * cos(phi - 0.5 * dir);
    return vec4(fold + v * dir, bw, cov, lit);
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // ---- 桌面：淺灰的石面，很淡的斑駁與小孔
    vec3 col = mix(C_ASH, C_BONE, 0.55) * (0.92 + 0.05 * fbm(p / 320.0, 3) + 0.02 * fbm(p / 40.0, 2));
    col *= 1.0 - 0.06 * smoothstep(0.6, 0.9, snoise(p / 3.0)) * smoothstep(0.3, 0.7, snoise(p / 90.0));
    vec2 m = 0.5 * (sheet.xy + sheet.zw);
    vec2 C0 = cam.xy;
    // 現在攤平在桌上的範圍：右下一定在；上半片攤平後加上右上；左半片攤平後整張
    float x0 = f2 < 0.001 ? sheet.x : m.x, y0 = f1 < 0.001 ? sheet.y : m.y;
    // 紙在桌上的影子（落下時遠一點）；翻起來的那片在桌上的影子
    vec2 so = vec2(5.0, 9.0) * (1.0 + 2.0 * lift);
    float sh = exp(-max(sdBox(p - so - 0.5 * (vec2(x0, y0) + sheet.zw), 0.5 * (sheet.zw - vec2(x0, y0))), 0.0) / (7.0 + 10.0 * lift));
    // 上半片（在攤平前）：往上翻，平行座標是 x，範圍 [m.x, sheet.z]（左半還摺在背後）
    float s1 = sin(f1), s2 = sin(f2);
    if (f1 > 0.001) {
      float L1 = m.y - sheet.y;
      float reach = L1 * max(cos(f1), 0.0) + L1 * 0.4 * s1;
      sh = max(sh, 0.8 * s1 * exp(-max(sdBox(p - vec2(0.5 * (m.x + sheet.z), m.y - reach * 0.5) - vec2(10.0, 0.0) * s1, vec2(0.5 * (sheet.z - m.x), reach * 0.5)), 0.0) / (14.0 + 20.0 * s1)));
    }
    if (f2 > 0.001) {
      float L2 = m.x - sheet.x;
      float reach = L2 * max(cos(f2), 0.0) + L2 * 0.4 * s2;
      sh = max(sh, 0.8 * s2 * exp(-max(sdBox(p - vec2(m.x - reach * 0.5, m.y) - vec2(0.0, 12.0) * s2, vec2(reach * 0.5, 0.5 * (sheet.w - sheet.y))), 0.0) / (14.0 + 20.0 * s2)));
    }
    col *= 1.0 - 0.24 * sh;
    // 翻起來的兩片
    vec4 A = f1 > 0.001 ? flap(p.y, p.x, m.y, -1.0, m.y - sheet.y, m.x, sheet.z, f1, C0.y, C0.x) : vec4(0.0);
    vec4 B = f2 > 0.001 ? flap(p.x, p.y, m.x, -1.0, m.x - sheet.x, sheet.y, sheet.w, f2, C0.x, C0.y) : vec4(0.0);
    vec3 cA = face(vec2(A.y, A.x)) * A.w, cB = face(B.xy) * B.w;
    // 在背後（> 90°）的先畫，被攤平的那部分蓋住
    if (f1 > 1.5708) col = mix(col, cA, A.z);
    if (f2 > 1.5708) col = mix(col, cB, B.z);
    // 攤平的部分
    float fa = aaFill(sdBox(p - 0.5 * (vec2(x0, y0) + sheet.zw), 0.5 * (sheet.zw - vec2(x0, y0))));
    vec3 fc = face(p);
    // 摺著的時候，摺線那一邊是厚的（好幾層）：邊緣暗一點
    fc *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 3.0, min(p.x - x0, p.y - y0))) * step(0.001, f1 + f2);
    col = mix(col, fc, fa);
    if (f1 <= 1.5708) col = mix(col, cA, A.z);
    if (f2 <= 1.5708) col = mix(col, cB, B.z);
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, tl: { value: null }, cam: { value: new THREE.Vector3(W / 2, H / 2, 1) },
  sheet: { value: new THREE.Vector4(0, 0, 1, 1) }, prc: { value: new THREE.Vector4(0, 0, 1, 1) }, lod: { value: 0 },
  tlR: { value: new THREE.Vector4(0, 0, 1, 1) }, textK: { value: 0 }, f1: { value: Math.PI }, f2: { value: Math.PI }, lift: { value: 0 }, k: { value: 1 },
});

/** 紙的邊（照片的上、左、右）、照片到字的距離（字在下面、字在右邊）。 */
const M = 44, GAP = 26, GAP_SIDE = 56;
/** 印在紙上的畫面往焦點推到幾倍；攤開以後鏡頭再推近 4%、焦點往畫面中間移兩成半。 */
const PUSH = 1.12;
const FOCUS: FocusCamOpts = { zoom: 1.04, pull: 0.25 };

export default class Unfold extends Scene {
  bg = shared('unfold.bg', BG);
  cap!: Caption;
  /** 字寫在照片右邊（直的、方的照片），不是下面。 */
  side = false;
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  sheet: [number, number, number, number] = [0, 0, 1, 1];
  prc: [number, number, number, number] = [0, 0, 1, 1];
  tlX = 0; tlY = 0;
  t1 = 0; t2 = 0; kp = 1;
  /** 照片的放大倍數（原尺寸 → 畫面）。 */
  scale = 1;
  /** 焦點（印在紙上的畫面推到底時在世界座標的位置）與鏡頭往那裡推的幅度（字不能被推出安全區）。 */
  foc: [number, number] = [W / 2, H / 2];
  amp = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { start, audio } = this.ctx;
    const { w, h } = img;
    // 字：橫的照片寫在下面的留白（寬 900、最多三行，60 字的留言也放得下，整塊最高 300）；
    // 直的、方的寫在右邊的留白（寬 500、最多六行）
    const side = w / h < 1.1;
    const cap = (this.cap = this.track(new Caption(side ? 500 : 900, side ? 600 : 300, {
      family: F.hand(400), align: 'left', lineHeight: 1.34, maxLines: side ? 6 : 3, ink: rgba('sepia', 0.9), label: rgba('sepia', 0.58),
    })));
    cap.setup(this.ctx, ph);
    this.side = side && cap.has;
    const textH = cap.has ? cap.blockH : 0;
    let s: number, pw: number, phh: number;
    if (this.side) {
      // 紙：照片＋右邊寫字的地方，四邊留白；字的欄寬照實際的字（短的註解紙不會太寬）
      const colW = Math.max(cap.blockW, 300);
      s = fitPhoto(w, h, 1480 - 2 * M - GAP_SIDE - colW, 920 - 2 * M);
      pw = w * s; phh = h * s;
      const sw = M + pw + GAP_SIDE + colW + M, sh = Math.max(phh, textH) + 2 * M;
      const x0 = W / 2 - sw / 2, y0 = clamp(535 - sh / 2, 60, 1010 - sh);
      this.sheet = [x0, y0, x0 + sw, y0 + sh];
      this.prc = [x0 + M, y0 + M, x0 + M + pw, y0 + M + phh];
      this.tlX = x0 + M + pw + GAP_SIDE;
      // 字跟照片的中間對齊；字伸到 HUD 的範圍時，最後一行在 HUD 上面
      const maxB = this.tlX + colW > HUD_SAFE.x ? HUD_SAFE.y - 30 : 966;
      this.tlY = clamp(y0 + M + (phh - textH) / 2, Math.max(y0 + M, 120), maxB - textH);
    } else {
      // 紙：照片＋三邊的留白＋下面寫字的地方；整張紙放進 1480×930（有字時往上一點，字不要進 HUD）
      const bottom = cap.has ? GAP + textH + M : M;
      s = fitPhoto(w, h, 1480 - 2 * M, 920 - M - bottom);
      pw = w * s; phh = h * s;
      const sw = Math.max(pw, cap.has ? Math.min(cap.blockW, 900) : 0) + 2 * M, sh = phh + M + bottom;
      const cx = cap.has ? 900 : W / 2, cy = cap.has ? 520 : 535;
      // 紙的下緣不超過 1010：字的最後一行在 966 以上
      const x0 = cx - sw / 2, y0 = clamp(cy - sh / 2, 60, 1010 - sh);
      this.sheet = [x0, y0, x0 + sw, y0 + sh];
      const px0 = cx - pw / 2;
      this.prc = [px0, y0 + M, px0 + pw, y0 + M + phh];
      // 字：照片下面靠左（跟照片的左緣對齊；紙比照片寬的時候跟紙的留白對齊）
      this.tlX = Math.min(px0, x0 + M);
      this.tlY = y0 + M + phh + GAP;
    }
    this.scale = s;
    this.foc = focusAt(ph, focusCrop(ph, w, h, w / h, 1, { zoom: PUSH, screenW: pw }), this.prc);
    this.amp = cap.has ? focusAmp(this.foc, FOCUS, [[this.tlX - 8, this.tlY - 8, this.tlX + cap.blockW + 8, this.tlY + textH + 16]]) : 1;
    this.kp = pace(this.ctx);
    this.t1 = Math.min(beatAfter(audio, start + 0.3 * this.kp), start + 0.7 * this.kp);
    this.t2 = Math.min(beatAfter(audio, this.t1 + 0.4 * this.kp), this.t1 + 0.6 * this.kp);
    // 註解是寫好的（跟著紙一起攤開）
    cap.writeAt(start - 1, 0.01);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, kp = this.kp;
    const u = this.bg.u;
    // 印在紙上的畫面往焦點小推（攤開就開始）
    const tOpen = this.t2 + 0.55 * kp;
    const crop = p6Crop(this.ctx, this.img!, t, { zoom: PUSH, screenW: this.prc[2] - this.prc[0], t0: this.t1 });
    setP6Photo(u, this.ctx.params.photo, crop);
    const [x0, y0, x1, y1] = this.sheet;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const f1 = Math.PI * (1 - ease.inOutCubic(prog(t, this.t1, this.t1 + 0.55 * kp)));
    const f2 = Math.PI * (1 - ease.inOutCubic(prog(t, this.t2, this.t2 + 0.55 * kp)));
    u.f1!.value = f1; u.f2!.value = f2;
    // 鏡頭：一開始貼近摺好的那一小疊（右下四分之一），攤開時拉開到整張
    const open = ease.inOutCubic(prog(t, this.t1, this.t2 + 0.55 * kp));
    const qx = (mx + x1) / 2, qy = (my + y1) / 2;
    // 很小的照片放大後已經接近 1.5 倍：貼近的鏡頭就不要再放大（會糊）
    const z0 = clamp(Math.min(1500 / (x1 - mx), 860 / (y1 - my)) * 0.7, 1, Math.max(1, Math.min(1.7, 1.6 / this.scale)));
    // 攤平之後：往焦點推近
    const base: Cam = [lerp(qx, W / 2, open), lerp(qy, H / 2, open), lerp(z0, 1, open)];
    const [cx, cy, z] = focusCam(this.foc, settleK(t - tOpen, 6) * this.amp, { ...FOCUS, base });
    (u.cam!.value as THREE.Vector3).set(cx, cy, z);
    (u.sheet!.value as THREE.Vector4).set(...this.sheet);
    (u.prc!.value as THREE.Vector4).set(...this.prc);
    u.photo!.value = this.tex;
    u.lod!.value = photoLod(this.img!.w * (crop[2] - crop[0]), (this.prc[2] - this.prc[0]) * z);
    u.lift!.value = 1 - ease.outCubic(prog(t, s, s + 0.4 * kp));
    const cap = this.cap;
    if (cap.has) {
      cap.draw(t);
      u.tl!.value = cap.L.texture;
      (u.tlR!.value as THREE.Vector4).set(this.tlX - cap.pad, this.tlY - cap.pad, cap.L.w, cap.L.h);
      u.textK!.value = 1;
    } else { u.tl!.value = this.tex; u.textK!.value = 0; }
    u.k!.value = (0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.06 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { ...P6_POST };
  }
}
