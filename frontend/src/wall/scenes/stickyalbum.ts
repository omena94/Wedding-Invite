// 照片版面「自黏相簿」（亮）：老式的自黏相簿內頁——奶油色的底紙上一格一格斜斜的膠線（格紋），照片（圓角白邊的老相片）
// 與手寫的註解壓在一層透明膜底下。透明膜有反光（窗光的倒影、細細的皺紋、幾顆小氣泡），整頁看起來霧霧的。
//  - 第一拍：透明膜從右邊被掀起來、往回捲（立體的曲面，捲起來的地方一道亮亮的反光），底下的照片一下子變清楚；
//    窗格後段的拍點再蓋回去（反光從膜上掃過）。很短的窗格只掀一次、不蓋回。
//  - 字手寫在膜底下：主字（賓客留言＋署名，或新人的註解），歌詞小一號在下面跟唱；沒有主字時歌詞自己當主字（_photo.ts 的 PhotoText）。
//    橫的照片在上面、字寫在照片下面；直的照片在左邊、字在右邊。兩個都沒有就只有照片（在正中間）。
//  - 照片完整洗成一張相片，很小的舊照片最多放大到原尺寸約 1.5 倍；相片上的畫面慢慢往焦點（新人點的臉）推，鏡頭也往那邊靠一點。
//    相簿的第一張在字的上面多一行小小的相簿名。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE, type Layer2D } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, firstBeat, settle, type Pic, CAM_FOCAL } from './_p3';
import { barAfter } from './_motifs';
import { loadWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'album', paper: true, energy: [0, 0.8], bars: [3, 8], weight: 1, prefers: ['small', 'landscape', 'square'], thumbAt: 0.055 };

/** 透明膜離底紙的高度、靠鏡頭那一邊（下緣）的位置。 */
const FZ = 1.5, FY = -520;

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D photo; uniform sampler2D ink;
  uniform vec4 ph;      // 相片中心 xy、轉角、白邊
  uniform vec2 phHS;    // 照片本身的半寬高
  uniform float photoTpw; uniform vec4 crop;
  uniform vec4 inkRect; uniform float inkOn;
  uniform vec3 peel;    // 掀起來的那段從哪裡開始（x）、多長、捲多少
  uniform vec2 glint;   // 反光窗的位置偏移
  const vec3 LD = normalize(vec3(-0.4, 0.55, 1.0));

  float light(vec2 p) {
    vec2 q = (p - vec2(-300.0, 320.0)) / vec2(1500.0, 1100.0);
    return 0.74 + 0.26 * exp(-dot(q, q) * 1.5);
  }
  // 底紙＋膠線＋相片＋字（膜底下的東西）
  vec3 under(vec3 P, float wpp, float coc) {
    vec4 nn = nz(P.xy, 700.0, wpp, coc);
    vec3 col = mix(C_PAPER, C_BONE, 0.3) * 0.94 * (0.97 + 0.03 * (nn.r - 0.5) + 0.02 * (nn.g - 0.5));
    // 格紋膠線：兩組斜線，微微隆起、帶一點黃
    vec2 g = rot2(0.785) * P.xy / 30.0;
    float aa = max(wpp / 30.0, 0.02) + coc / 30.0;
    float glue = max(1.0 - smoothstep(0.0, aa * 1.5 + 0.02, 0.5 - abs(fract(g.x) - 0.5) - 0.02), 1.0 - smoothstep(0.0, aa * 1.5 + 0.02, 0.5 - abs(fract(g.y) - 0.5) - 0.02));
    // 遠一點的地方格線收淡（不要變成一片摩爾紋）
    glue *= 0.34 * smoothstep(2.6, 1.3, wpp + coc * 0.1);
    col = mix(col, col * mix(vec3(1.0), C_FUR, 0.25) * 0.9, glue);
    // 相片的影子（很薄的一張，貼在底紙上）
    vec2 outer = phHS + vec2(ph.w);
    vec2 q = rot2(ph.z) * (P.xy - ph.xy);
    float sd = sdBox(rot2(ph.z) * (P.xy - ph.xy + LD.xy / LD.z * 3.0), outer - 8.0) - 8.0;
    col *= 1.0 - 0.22 * (1.0 - smoothstep(-1.0, 6.0 + coc, sd));
    // 字
    if (inkOn > 0.5) {
      vec2 iuv = vec2((P.x - inkRect.x) / inkRect.z, (P.y - inkRect.y) / inkRect.w);
      vec4 ic = inkAt(ink, iuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
      col = col * (1.0 - ic.a) + ic.rgb;
    }
    // 相片：圓角白邊、絲面相紙
    float d = sdBox(q, outer - 12.0) - 12.0;
    float a = 1.0 - smoothstep(-0.7 - coc * 0.5, 0.7 + coc * 0.5, d);
    if (a > 0.0) {
      vec3 pr = mix(C_BONE, C_PAPER, 0.35) * 0.9;
      float di = sdBox(q, phHS - 3.0) - 3.0;
      if (di < 1.0) {
        vec2 uv = vec2(q.x + phHS.x, phHS.y - q.y) / (2.0 * phHS);
        vec3 im = photoAt(photo, cropUv(uv, crop), lodFor(photoTpw, wpp, coc));
        // 絲面：很細的顆粒
        im *= 0.985 + 0.03 * (textureLod(noiseTex, q / 90.0, 0.0).b - 0.5) * smoothstep(1.0, 0.3, wpp);
        pr = mix(pr, im, 1.0 - smoothstep(-0.6, 0.6, di));
      }
      col = mix(col, pr, a);
    }
    return col * light(P.xy);
  }
  // 窗光的倒影（膜的反光）：反射方向打到天花板上一扇很大、很軟的窗
  float sky(vec3 r) {
    if (r.z <= 0.0) return 0.0;
    vec2 w = r.xy / r.z;
    // 一扇很軟的長窗（柔光箱）＋房間的天花板
    vec2 q = rot2(0.5) * (w - vec2(-0.25, 0.62) - glint) / vec2(0.5, 0.13);
    float win = 1.0 - smoothstep(0.55, 1.25, length(max(abs(q) - vec2(0.5, 0.0), 0.0)) + max(abs(q.y) - 0.0, 0.0) * 0.0);
    return win + 0.1 * exp(-dot(w, w) * 0.5);
  }
  vec3 filmOver(vec3 below, vec3 rd, vec3 n, vec2 p, float wpp, float lifted) {
    // 舊膜微微泛黃、霧霧的；斜看的地方反光多
    float fres = 0.04 + 0.85 * pow(1.0 - abs(dot(rd, n)), 3.0);
    vec3 r = reflect(rd, n);
    vec3 film = below * mix(vec3(0.92), vec3(0.95, 0.92, 0.84), 0.6) * (1.0 - 0.15 * fres) + C_BONE * (0.025 + 0.03 * lifted);
    float sp = sky(r) * (0.08 + fres * 1.2 + 0.2 * lifted) + (0.04 + 0.5 * fres) * lifted;
    return film + mix(C_BONE, C_PAPER, 0.3) * sp * (0.7 + 0.3 * lifted);
  }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    float tp = hitZ(ro, rd, 0.0);
    vec3 P = ro + rd * tp;
    float depth = tp * dot(rd, camF), coc = cocAt(depth);
    float wpp = wppAt(tp, rd, vec3(0.0, 0.0, 1.0));
    vec3 col = under(P, wpp, coc);
    // 透明膜從靠鏡頭的下緣（世界 y = FY）被掀起來、往裡面捲：換到膜自己的座標（x' = -y，從鉸鏈往下緣），套翻頁的曲面
    vec3 ro2 = vec3(-ro.y, ro.x, ro.z), rd2 = vec3(-rd.y, rd.x, rd.z);
    vec3 P2 = vec3(-P.y, P.x, P.z), L2 = vec3(-LD.y, LD.x, LD.z);
    float x0 = peel.x, Lp = peel.y, bend = peel.z;
    float occ = Lp > 1.0 ? curlShadow(P2, L2, vec2(x0, ${FZ.toFixed(1)}), 0.0, bend, Lp, vec2(-5000.0, 5000.0)) : 0.0;
    col *= 1.0 - 0.12 * occ;
    // 平貼的那段膜（下緣以內、掀起來的起點以內）
    if (P2.x < x0 && P2.x < ${(-FY).toFixed(1)}) {
      // 很淡的起伏：倒影微微扭曲（舊膜不是完全平的）
      vec4 w1 = nz(P.xy * vec2(0.5, 1.0), 1400.0, wpp, coc);
      vec3 n = normalize(vec3((w1.a - 0.5) * 0.035, (w1.r - 0.5) * 0.03, 1.0));
      col = filmOver(col, rd, n, P.xy, wpp, 0.0);
      // 膜離開紙的那條摺線：一道細亮線
      if (Lp > 1.0) col += C_BONE * 0.1 * (1.0 - smoothstep(0.0, 2.5 + coc, x0 - P2.x));
    }
    // 掀起來、捲回去的那段膜：透明，曲面上的反光
    if (Lp > 1.0) {
      vec4 ch = curlHit(ro2, rd2, vec2(x0, ${FZ.toFixed(1)}), 0.0, bend, Lp, vec2(-5000.0, 5000.0), 1.0);
      if (ch.x > 0.0 && ch.x < tp) {
        vec3 n2 = vec3(-sin(ch.w), 0.0, cos(ch.w));
        vec3 n = vec3(n2.y, -n2.x, n2.z);
        if (dot(n, rd) > 0.0) n = -n;
        vec3 Q = ro + rd * ch.x;
        col = filmOver(col, rd, n, Q.xy, wpp, 1.0);
        // 膜的邊緣：一條細細的亮線
        float edge = 1.0 - smoothstep(0.0, 3.0 + coc, Lp - ch.y);
        col += C_BONE * 0.3 * edge;
      }
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  photo: { value: null }, ink: { value: null },
  ph: { value: new THREE.Vector4() }, phHS: { value: new THREE.Vector2(300, 200) }, photoTpw: { value: 1 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  inkRect: { value: new THREE.Vector4() }, inkOn: { value: 0 }, peel: { value: new THREE.Vector3(-FY, 0, 0) }, glint: { value: new THREE.Vector2() },
});

export default class StickyAlbum extends Scene {
  bg = shared('stickyalbum.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  pic: Pic | null = null;
  noise: THREE.Texture | null = null;
  ink: Layer2D | null = null;
  col: TextCol | null = null;
  pc: [number, number] = [0, 0];
  hs: [number, number] = [300, 200];
  border = 18;
  ang = 0;
  ir: [number, number, number, number] = [0, 0, 0, 0];
  tUp = 0; tDown = Infinity;
  /** 鏡頭看的中心（照片＋字那一組的中間）。 */
  view: [number, number] = [0, 0];

  override async init() {
    const { renderer, start, end, audio } = this.ctx;
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(`${ph.caption}${ph.album}`);
    await loadWords(this.ctx);
    this.pic = await loadPic(renderer, ph);
    this.track(this.pic.tex);
    this.noise = p3Noise(renderer);
    const { img } = this.pic;
    const wide = img.w >= img.h * 1.15;
    // 橫的：照片在上、字在下（字寬跟照片差不多）；直的：照片在左、字在右
    const colW = wide ? 820 : 580, colH = wide ? 330 : 560, pad = 24;
    this.ink = this.track(inkLayer(colW + 2 * pad, colH + 2 * pad));
    this.col = new TextCol(this.ink, colW, colH, {
      family: F.hand(400), ink: mixRgba('ink', 'blood', 0.12, 0.92), active: mixRgba('blood', 'ink', 0.15), unsung: mixRgba('ink', 'blood', 0.12, 0.28),
      sigInk: mixRgba('ink', 'blood', 0.12, 0.72), rs: 1, lineHeight: 1.36, maxLines: wide ? 3 : 5,
      label: { family: F.hand(700), size: 22, color: mixRgba('ink', 'blood', 0.12, 0.6), tracking: 4, gap: 16 },
    }, ph, this.ctx, pad);
    const hasText = this.col.has;
    const textH = this.col.contentH;
    let w: number, h: number;
    if (wide) {
      [w, h] = picSize(img, hasText ? 1060 : 1240, hasText ? Math.max(380, 760 - textH - 60) : 700, 1);
    } else {
      [w, h] = picSize(img, hasText ? 640 : 900, 760, 1);
    }
    this.border = clamp(0.035 * Math.min(w, h), 12, 24);
    this.hs = [w / 2, h / 2];
    const tw = w + 2 * this.border, th = h + 2 * this.border;
    this.ang = (hash(this.seed, 4) - 0.5) * 2.2 * (Math.PI / 180);
    if (wide && hasText) {
      // 照片＋字一組，上下置中（世界 y 往上）
      const gap = 44, groupH = th + gap + textH;
      const top = groupH / 2 + 10;
      this.pc = [0, top - th / 2];
      const colTop = top - th - gap;
      const colLeft = -tw / 2 + 10;
      this.ir = [colLeft - pad, colTop - colH - pad, colW + 2 * pad, colH + 2 * pad];
    } else if (hasText) {
      const gap = 80, groupW = tw + gap + colW;
      const x0 = -groupW / 2;
      this.pc = [x0 + tw / 2, 10];
      const colTop = clamp(10 + textH / 2, -230 + textH, 320);
      this.ir = [x0 + tw + gap - pad, colTop - colH - pad, colW + 2 * pad, colH + 2 * pad];
    } else this.pc = [-20, 20];
    // 掀起來：第一拍；蓋回去：窗格後段的小節線（窗格太短就不蓋回）
    this.tUp = firstBeat(audio, start, 0.6);
    // 蓋回去：大約一小節後的小節線（窗格太短就提早，至少掀起來 0.9 秒）
    const down = Math.min(barAfter(audio, this.tUp + 1.4), end - 1.0);
    this.tDown = down >= this.tUp + 0.9 ? down : Infinity;
    if (this.col.fit) { this.col.writeFrom = -1; this.col.writeTo = -1; }
  }

  /** 相片上的畫面往焦點推到哪裡（照片 uv 的範圍）。 */
  private crop(t: number) {
    return picCrop(this.pic!, settleK(t - this.ctx.start, 6), { zoom: 1.14, screenW: this.hs[0] * 2 });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    const crop = this.crop(t);
    // 鏡頭往焦點靠一點（有字時少靠，字才一直在畫面裡）
    const [fx, fy] = focusAt(this.pic!, crop, this.pc, this.hs, this.ang);
    const lean = (this.col!.has ? 0.16 : 0.42) * settle(lt, 6);
    // 鏡頭：從右前方斜斜地看，慢慢往左移、推近
    const dir = hash(this.seed, 8) < 0.5 ? 1 : -1;
    const k0 = ease.outCubic(prog(t, s, s + 1.2));
    const push = 1 - 0.05 * settle(lt, 6) + 0.05 * (1 - k0);
    this.cam.orbit([lerp(60, 0, k0) - 16 * settle(lt, 8) + lean * (fx - this.pc[0]), -10 + lean * (fy - this.pc[1]), 0], CAM_FOCAL * push, lerp(54, 60, k0), lerp(9, 6, k0) * dir - 2 * dir * settle(lt, 8), 30, -0.6 * dir);
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    // 透明膜：在拍點被掀起來（捲到快要折回去），之後再蓋回去
    const up = prog(t, this.tUp - 0.05, this.tUp + 0.75, ease.outCubic);
    const down = prog(t, this.tDown, this.tDown + 0.7, ease.inOutCubic);
    const lift = up * (1 - down);
    const Lp = 430 * lift;
    (u.peel!.value as THREE.Vector3).set(-FY - Lp, Lp, 2.2 * lift);
    // 反光跟著鏡頭與膜的動作滑過去
    (u.glint!.value as THREE.Vector2).set(-0.08 * settle(lt, 6) + 0.25 * down, 0.03 * Math.sin(lt * 0.3));
    (u.ph!.value as THREE.Vector4).set(this.pc[0], this.pc[1], this.ang, this.border);
    (u.phHS!.value as THREE.Vector2).set(...this.hs);
    u.photo!.value = this.pic!.tex;
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoTpw!.value = texPerWorld(this.pic!.img, this.hs[0] * 2, crop);
    u.noiseTex!.value = this.noise;
    u.inkOn!.value = this.col!.draw(t) ? 1 : 0;
    u.ink!.value = this.ink!.texture;
    (u.inkRect!.value as THREE.Vector4).set(...this.ir);
    u.focusD!.value = this.cam.depth([this.pc[0] * 0.5, 0, 0]);
    u.aper!.value = 16;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.34 };
  }
}
