// 照片版面「翻頁相簿」（亮）：桌上一本攤開的相簿，窗格一開始右頁就被掀起來、立體地翻過去（紙有弧度、影子掃過頁面），
// 翻過去的那一頁背面貼著照片，在拍點上落在左頁；底下露出來的右頁是手寫的字：主字（賓客留言＋署名，或新人的註解），
// 下面小一號跟唱歌詞（沒有主字時歌詞自己當主字，_photo.ts 的 PhotoText）。
//  - 照片貼在頁上，周圍一圈壓凹的框線；直的照片換成直式的相簿，很小的照片最多放大到原尺寸約 1.5 倍。
//    頁上的畫面慢慢往焦點（新人點的臉）推，鏡頭也往那邊靠一點。
//  - 鏡頭：一開始低一點、偏右，跟著翻過去的頁面往左搖，頁面落下時停在讀的位置，之後很慢地推近；遠處的桌面在焦外。
//  - 兩個都沒有字時：鏡頭停在左頁（照片在畫面中間），右頁只是空白的頁面。
//  - 相簿的第一張：右頁上面一行小小的相簿名。
//  - 光：左上方的窗光（很軟的窗框影子）照在桌上與相簿上，暖暖的。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, beatNear, settle, type Pic, type V3, CAM_FOCAL } from './_p3';
import { loadWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';
import type { Layer2D } from '../engine/gl';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'album', paper: true, energy: [0, 1], bars: [2, 8], weight: 1, prefers: ['landscape', 'square', 'small'], thumbAt: 0.043 };

/** 頁塊頂面、封面板厚、封面多出來的邊、翻動那頁的鉸鏈高度。 */
const T = 14, CT = 6, CM = 18, HZ = T + 0.8;

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D photo; uniform sampler2D ink;
  uniform vec2 page;
  uniform vec4 photoRect; uniform float photoTpw; uniform vec4 crop;
  uniform vec4 inkRect; uniform float inkOn;
  uniform vec2 flip;
  uniform vec2 gobo; uniform vec3 pool;
  const vec3 LD = normalize(vec3(-0.5, 0.42, 1.0));

  // 窗光：一大片暖光、窗框的十字影子很軟（光從左上斜斜進來）
  float sun(vec2 p) {
    vec2 g = rot2(0.32) * (p - gobo);
    float inside = 1.0 - smoothstep(-120.0, 220.0, sdBox(g, vec2(900.0, 560.0)));
    float bar = max(1.0 - smoothstep(12.0, 70.0, abs(g.x - 60.0)), 1.0 - smoothstep(12.0, 70.0, abs(g.y + 40.0)));
    return inside * (1.0 - 0.5 * bar);
  }
  vec3 lit(vec3 alb, vec3 P, vec3 n, float ao, float occ) {
    // 光圈：相簿在亮處，遠處的桌面暗下去（主角一眼就看到）
    vec2 pq = (P.xy - pool.xy) / vec2(pool.z, pool.z * 0.72);
    float pl = exp(-dot(pq, pq));
    float key = sun(P.xy) * clamp(dot(n, LD) / LD.z, 0.0, 1.3) * (1.0 - 0.9 * occ) * (0.35 + 0.65 * pl);
    vec3 warm = vec3(1.0, 0.92, 0.8);
    return alb * (ao * (0.82 + 0.18 * n.z) * (1.0 - 0.2 * occ) * (0.3 + 0.36 * pl) + 0.34 * key * warm);
  }
  // 頁紙：奶油色、很淡的纖維
  vec3 paperAlb(vec2 p, float wpp, float coc) {
    vec4 nn = nz(p, 900.0, wpp, coc);
    return mix(C_PAPER, C_BONE, 0.2) * (0.965 + 0.03 * (nn.r - 0.5) + 0.03 * (nn.g - 0.5) + 0.012 * (nn.b - 0.5));
  }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    float hw = page.x, hh = page.y * 0.5;
    int what = 0; float tb = 1e9;
    vec4 ch = curlHit(ro, rd, vec2(0.0, ${HZ.toFixed(1)}), flip.x, flip.y, hw, vec2(-hh, hh), 1.0);
    if (ch.x > 0.0) { tb = ch.x; what = 3; }
    vec3 bA = vec3(-hw, -hh, ${CT.toFixed(1)}), bB = vec3(hw, hh, ${T.toFixed(1)});
    vec2 hb = boxHit(ro, rd, bA, bB);
    if (hb.x < hb.y && hb.x > 0.0 && hb.x < tb) { tb = hb.x; what = 2; }
    vec3 cA = vec3(-hw - ${CM}.0, -hh - ${CM}.0, 0.0), cB = vec3(hw + ${CM}.0, hh + ${CM}.0, ${CT.toFixed(1)});
    vec2 hc = boxHit(ro, rd, cA, cB);
    if (hc.x < hc.y && hc.x > 0.0 && hc.x < tb) { tb = hc.x; what = 1; }
    if (what == 0) tb = hitZ(ro, rd, 0.0);
    vec3 P = ro + rd * tb;
    float depth = tb * dot(rd, camF);
    float coc = cocAt(depth);
    vec3 col;
    if (what == 0) {
      // 桌面：原木（固定色 fur），木紋沿 x，一條一條的木板縫
      vec3 n = vec3(0.0, 0.0, 1.0);
      float wpp = wppAt(tb, rd, n);
      float plank = mod(P.y + 2000.0, 300.0), pid = floor((P.y + 2000.0) / 300.0);
      vec4 a = nz(vec2(P.x * 0.05 + pid * 97.0, P.y * 0.8), 520.0, wpp, coc);
      vec4 b = nz(vec2(P.x * 0.015 + pid * 41.0, P.y * 0.3) + 3.7, 900.0, wpp, coc);
      float ring = smoothstep(0.2, 0.8, 0.5 + 0.5 * tri((P.y + 160.0 * b.a + 40.0 * a.r) * 0.0143 + pid * 0.33));
      float seam = 1.0 - smoothstep(0.0, 2.5 + coc, min(plank, 300.0 - plank));
      vec3 alb = C_FUR * (0.27 + 0.05 * ring + 0.1 * (a.g - 0.5) + 0.04 * hash11(pid)) * (1.0 - 0.45 * seam);
      // 相簿的影子（很軟，往右下）
      vec2 sq = P.xy - LD.xy / LD.z * ${(T * 0.8).toFixed(1)};
      float sd = sdBox(sq, vec2(hw + ${CM}.0, hh + ${CM}.0));
      float occ = 0.75 * (1.0 - smoothstep(-20.0, 46.0, sd));
      col = lit(alb, P, n, 1.0 - 0.35 * exp(-max(sd, 0.0) / 30.0), occ);
    } else if (what == 1) {
      // 封面：深色布面（訊號色的暗部帶一點），布紋
      vec3 n = boxNormal(P, cA, cB);
      float wpp = wppAt(tb, rd, n);
      vec4 a = nz(P.xy * vec2(1.0, 1.0) + P.z, 260.0, wpp, coc);
      vec3 alb = mix(C_INK2, C_BLOOD, 0.42) * (0.9 + 0.12 * (a.b - 0.5) + 0.1 * (a.g - 0.5));
      float edge = n.z > 0.5 ? 1.0 : 0.7;
      col = lit(alb * edge, P, n, 1.0, 0.0);
    } else if (what == 2) {
      vec3 n = boxNormal(P, bA, bB);
      float wpp = wppAt(tb, rd, n);
      vec3 alb = paperAlb(P.xy, wpp, coc);
      float ao = 1.0, occ = 0.0;
      if (n.z > 0.5) {
        // 書溝：靠書背暗一點
        ao = 1.0 - 0.32 * exp(-abs(P.x) / 26.0) - 0.12 * exp(-abs(P.x) / 140.0);
        occ = curlShadow(P, LD, vec2(0.0, ${HZ.toFixed(1)}), flip.x, flip.y, hw, vec2(-hh, hh));
        if (P.x > 0.0 && inkOn > 0.5) {
          vec2 uv = vec2((P.x - inkRect.x) / inkRect.z, 1.0 - ((hh - P.y) - inkRect.y) / inkRect.w);
          vec4 c = inkAt(ink, uv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
          alb = alb * (1.0 - c.a) + c.rgb;
        }
      } else {
        // 頁邊：一層一層的紙
        alb *= 0.86 + 0.06 * sin(P.z * 5.0);
      }
      col = lit(alb, P, n, ao, occ);
    } else {
      // 翻動的那一頁：正面（原本朝上）空白，背面貼著照片
      float s = ch.y, phi = ch.w;
      vec3 n = vec3(-sin(phi), 0.0, cos(phi));
      bool front = dot(n, rd) < 0.0;
      if (!front) n = -n;
      float wpp = wppAt(tb, rd, n);
      vec3 alb = paperAlb(vec2(front ? s : -s, P.y) + 37.0, wpp, coc);
      if (!front) {
        vec2 q = vec2(hw - s, hh - P.y);
        vec2 c0 = photoRect.xy + photoRect.zw * 0.5, hs = photoRect.zw * 0.5;
        vec2 dq = q - c0;
        float d = sdBox(dq, hs);
        // 壓凹的框線（照片外 22 單位）：一道暗、一道亮
        float df = sdBox(dq, hs + 22.0);
        alb *= 1.0 - 0.07 * exp(-pow((df + 0.8) / 1.1, 2.0)) + 0.04 * exp(-pow((df - 1.2) / 1.1, 2.0));
        // 照片的厚度：貼在紙上的一圈很細的影子
        alb *= 1.0 - 0.22 * exp(-max(d - 1.5, 0.0) / 3.5) * step(0.0, d);
        float cov = 1.0 - smoothstep(-0.7 - coc * 0.5, 0.7 + coc * 0.5, d);
        if (cov > 0.0) {
          vec2 uv = (q - photoRect.xy) / photoRect.zw;
          vec3 ph = photoAt(photo, cropUv(uv, crop), lodFor(photoTpw, wpp, coc));
          // 相紙的光澤：很淡的一道斜光
          ph += C_BONE * 0.02 * smoothstep(0.25, 0.0, abs(uv.x - uv.y * 0.7 - 0.2));
          alb = mix(alb, ph, cov);
        }
      }
      float ao = 1.0 - 0.32 * exp(-s / 26.0) - 0.12 * exp(-s / 140.0);
      col = lit(alb, P, n, ao, 0.0);
      // 立起來的紙：背光那面透一點光
      col += mix(C_PAPER, C_EMBER, 0.2) * 0.05 * max(-dot(n, LD), 0.0);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  photo: { value: null }, ink: { value: null }, page: { value: new THREE.Vector2(800, 600) },
  photoRect: { value: new THREE.Vector4() }, photoTpw: { value: 1 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, inkRect: { value: new THREE.Vector4() }, inkOn: { value: 0 },
  flip: { value: new THREE.Vector2() }, gobo: { value: new THREE.Vector2(-700, 300) }, pool: { value: new THREE.Vector3(0, 0, 1200) },
});

export default class FlipAlbum extends Scene {
  bg = shared('flipalbum.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  pic: Pic | null = null;
  noise: THREE.Texture | null = null;
  ink: Layer2D | null = null;
  col: TextCol | null = null;
  pw = 800; ph = 600;
  /** 照片在左頁的範圍（頁面座標：u 從左頁外緣往書背、v 從上往下）。 */
  pr: [number, number, number, number] = [0, 0, 0, 0];
  /** 字在右頁的範圍（u 從書背往外）。 */
  ir: [number, number, number, number] = [0, 0, 0, 0];
  yTop = 0;
  readScale = 1.06;
  tLand = 0;

  override async init() {
    const { renderer, start, audio } = this.ctx;
    const ph = this.photo;
    // 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就讓引擎跳過這個窗格，不要畫一半
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(`${ph.caption}${ph.album}`);
    await loadWords(this.ctx);
    this.pic = await loadPic(renderer, ph);
    this.track(this.pic.tex);
    this.noise = p3Noise(renderer);
    const { img } = this.pic;
    // 直的照片用直式的相簿（照片才不會小小一張）
    const tall = img.h > img.w * 1.05;
    this.pw = tall ? 600 : 800; this.ph = tall ? 800 : 600;
    // 橫式相簿比較寬：拉遠一點，左頁的照片才不會貼到畫面邊
    this.readScale = tall ? 1.06 : 0.95;
    const rs = this.readScale;
    const m = 56;
    const [w, h] = picSize(img, this.pw - 2 * m, this.ph - 2 * m, rs);
    this.pr = [(this.pw - w) / 2, (this.ph - h) / 2, w, h];
    // 右頁的字：手寫在頁面中間（整塊：主字＋署名＋歌詞，下緣不進右下角 HUD 區）
    const colW = this.pw - 130, colH = this.ph - 150;
    const pad = 26;
    this.ink = this.track(inkLayer(colW + 2 * pad, colH + 2 * pad));
    this.col = new TextCol(this.ink, colW, colH, {
      family: F.hand(400), ink: rgba('sepia', 0.9), active: mixRgba('blood', 'sepia', 0.25), unsung: rgba('sepia', 0.28),
      sigInk: rgba('sepia', 0.72), rs, lineHeight: 1.4, maxLines: tall ? 6 : 4,
      label: { family: F.hei(500), size: 20, color: rgba('sepia', 0.55), tracking: 6, gap: 26 },
    }, ph, this.ctx, pad);
    const blockH = this.col.contentH;
    // 欄的上緣：整塊跟照片的中心對齊（右頁跟左頁一樣高）；長的往上長，下緣離頁底至少 80
    const top = clamp(this.ph / 2 - blockH / 2 - 10, 56, this.ph - 80 - blockH);
    this.ir = [74 - pad, top - pad, colW + 2 * pad, colH + 2 * pad];
    // 頁面在拍點落下：最快 0.75 秒、最慢 1.5 秒
    this.tLand = beatNear(audio, start + 0.95, start + 0.75, start + 1.5);
    this.pose(start);
  }

  /** 頁上的照片往焦點推到哪裡（照片 uv 的範圍）。 */
  private crop(t: number) {
    return picCrop(this.pic!, settleK(t - this.ctx.start, 6), { zoom: 1.2, screenW: this.pr[2] * this.readScale });
  }

  /** 鏡頭：一開始低一點、偏右（看著被掀起來的右頁），頁面落下時停在讀的位置，之後很慢地推近（往照片上的焦點靠一點）。 */
  private pose(t: number) {
    const s = this.ctx.start, lt = t - s;
    const hasText = this.col!.has;
    // 焦點在左頁上的位置（翻過來以後：頁面座標 u 從左頁外緣往書背）
    const [fx, fy] = focusAt(this.pic!, this.crop(t), [this.pr[0] + this.pr[2] / 2 - this.pw, this.ph / 2 - this.pr[1] - this.pr[3] / 2], [this.pr[2] / 2, this.pr[3] / 2]);
    const lean = settle(lt, 6);
    const tx = hasText ? 0.18 * lean * (fx + this.pw / 2) : -this.pw / 2 + 0.5 * lean * (fx + this.pw / 2);
    const ty = hasText ? 6 + 0.18 * lean * fy : 0.5 * lean * fy;
    const m = ease.inOutCubic(prog(t, s, this.tLand + 0.5));
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const push = 1 - 0.045 * settle(lt - (this.tLand - s), 6);
    const dist = (CAM_FOCAL / this.readScale) * lerp(1.12, 1, m) * push;
    const target: V3 = [lerp(this.pw * 0.32, tx, m), lerp(-40, ty, m), T];
    this.cam.orbit(target, dist, lerp(47, 63, m), lerp(-6 * dir, 0.8 * dir, m) + 0.6 * dir * settle(lt, 9), 30, lerp(-1.6, -0.3, m) * dir);
    return target;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const target = this.pose(t);
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    // 翻頁：起點切線角走 0 → PI；前半段紙的外緣領先（被掀起來），後半段落後（往下飄），落下後輕輕彈一下
    const p = prog(t, s + 0.04, this.tLand);
    const mid = Math.PI * ease.inOutCubic(p);
    const bend = 0.95 * Math.sin(2 * Math.PI * p) * (p < 1 ? 1 : 0) - 0.05 * Math.sin(Math.max(0, t - this.tLand) * 11) * Math.exp(-Math.max(0, t - this.tLand) * 5);
    const a = clamp(mid - bend * 0.5, 0, Math.PI);
    const tip = clamp(mid + bend * 0.5, 0, Math.PI);
    (u.flip!.value as THREE.Vector2).set(a, tip - a);
    (u.page!.value as THREE.Vector2).set(this.pw, this.ph);
    u.photo!.value = this.pic!.tex;
    (u.photoRect!.value as THREE.Vector4).set(...this.pr);
    const crop = this.crop(t);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoTpw!.value = texPerWorld(this.pic!.img, this.pr[2], crop);
    u.noiseTex!.value = this.noise;
    const col = this.col!;
    u.inkOn!.value = col.draw(t, this.yTop) ? 1 : 0;
    u.ink!.value = this.ink!.texture;
    (u.inkRect!.value as THREE.Vector4).set(...this.ir);
    // 對焦：讀的地方；一開始焦點在前面一點，跟著頁面拉回來
    const m = prog(t, s, this.tLand + 0.4, ease.outCubic);
    u.focusD!.value = this.cam.depth(target) * lerp(0.92, 1, m);
    u.aper!.value = lerp(30, 20, m);
    (u.gobo!.value as THREE.Vector2).set(-760 + 40 * settle(t - s, 10), 320);
    (u.pool!.value as THREE.Vector3).set(this.col!.has ? -60 : -this.pw / 2, 30, this.pw * 1.45);
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.32 };
  }
}
