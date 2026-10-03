// 照片版面「剪貼簿」（亮）：牛皮紙的剪貼簿內頁，鏡頭幾乎正上方往下看（手持的輕微晃動、很慢地推近）——
//  - 照片洗成有波浪毛邊的白邊相片，一開始從上面落到紙上（影子跟著收緊），兩條紙膠帶在拍點上「啪」地貼住對角。
//  - 白色牛奶筆的小塗鴉一筆一筆畫出來：從字拉到照片的彎彎箭頭、照片角落的小星星、主字（署名）底下的波浪線（只用我們自己的那顆愛心，點綴色）。
//  - 字用深色的筆手寫在牛皮紙上：主字（賓客留言＋署名，或新人的註解）一個字一個字寫出來，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當主字（_photo.ts 的 PhotoText）；兩個都沒有就只有照片（移到正中間，只留星星）。
//  - 相簿的第一張：字的上面一行小小的相簿名。
//  - 直的、手機直拍、很小的舊照片都完整洗成一張相片；很小的照片最多放大到原尺寸約 1.5 倍。
//    相片上的畫面慢慢往焦點（新人點的臉）推，鏡頭也往那邊靠一點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE, type Layer2D } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, fbm1, hash, lerp, mulberry32, prog } from '../engine/util';
import { drawHeart } from './_motifs';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, firstBeat, settle, type Pic, CAM_FOCAL } from './_p3';
import { loadWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'album', paper: true, energy: [0.2, 1], bars: [2, 8], weight: 1, prefers: ['portrait', 'square', 'small'] };

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D photo; uniform sampler2D ink; uniform sampler2D doodle;
  uniform vec4 ph;        // 相片中心 xy、離紙高度、轉角
  uniform vec2 phHS;      // 照片本身的半寬高
  uniform float border;   // 白邊
  uniform float photoTpw; uniform vec4 crop;
  uniform vec4 tA; uniform vec4 tB;   // 兩條膠帶：中心 xy、高度、轉角
  uniform vec2 tHS;
  uniform vec4 inkRect; uniform float inkOn; uniform vec4 dRect;
  const vec3 LD = normalize(vec3(-0.45, 0.5, 1.0));

  float light(vec2 p) {
    // 左上方來的柔光，畫面右下暗一點
    vec2 q = (p - vec2(-420.0, 260.0)) / vec2(1500.0, 1100.0);
    return 0.72 + 0.3 * exp(-dot(q, q) * 1.4);
  }
  vec3 tapeCol(float pat, float which) {
    vec3 base = which < 0.5 ? mix(C_SIGNAL, C_PAPER, 0.5) : mix(C_ROSE, C_PAPER, 0.55);
    return mix(base, mix(C_PAPER, C_BONE, 0.6), pat * 0.75);
  }
  vec3 overTape(vec3 below, vec3 ro, vec3 rd, vec4 tp, float which) {
    float tt;
    vec2 q = flatAt(ro, rd, tp.xy, tp.z, tp.w, tt);
    if (tt <= 0.0) return below;
    vec2 c = tape(q, tHS, which * 7.0 + 1.0);
    if (c.x <= 0.0) return below;
    vec3 P = ro + rd * tt;
    // 半透明：底下的東西透一點出來，膠帶的纖維很淡
    float fib = textureLod(noiseTex, q / 300.0, 1.0).g;
    vec3 tc = tapeCol(c.y, which) * light(P.xy) * (0.95 + 0.06 * (fib - 0.5));
    return mix(below, tc, c.x * 0.8);
  }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    // ---- 紙：牛皮紙（固定色 fur 帶紙色），纖維、斑駁、小黑點
    float tp = hitZ(ro, rd, 0.0);
    vec3 P = ro + rd * tp;
    float depth = tp * dot(rd, camF), coc = cocAt(depth);
    float wpp = wppAt(tp, rd, vec3(0.0, 0.0, 1.0));
    vec4 n1 = nz(P.xy, 800.0, wpp, coc);
    vec4 n2 = nz(P.xy * 2.3 + 11.0, 800.0, wpp, coc);
    vec3 kraft = mix(C_FUR, C_BONE, 0.38) * 0.56;
    vec3 col = kraft * (0.94 + 0.08 * (n1.r - 0.5) + 0.07 * (n1.g - 0.5) + 0.03 * (n2.a - 0.5));
    col *= 1.0 - 0.35 * smoothstep(0.965, 0.995, n2.b) * smoothstep(1.2, 0.2, wpp);
    // 白筆塗鴉、手寫的字
    vec2 duv = vec2((P.x - dRect.x) / dRect.z, (P.y - dRect.y) / dRect.w);
    vec4 dc = inkAt(doodle, duv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
    col = col * (1.0 - dc.a) + dc.rgb;
    if (inkOn > 0.5) {
      vec2 iuv = vec2((P.x - inkRect.x) / inkRect.z, (P.y - inkRect.y) / inkRect.w);
      vec4 ic = inkAt(ink, iuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
      col = col * (1.0 - ic.a) + ic.rgb;
    }
    // 相片與膠帶的影子
    vec2 outer = phHS + vec2(border);
    float sh = liftShadow(P.xy, ph.xy, outer, ph.w, ph.z, LD) * (0.32 - 0.12 * smoothstep(20.0, 300.0, ph.z));
    sh = max(sh, 0.1 * liftShadow(P.xy, tA.xy, tHS, tA.w, tA.z, LD));
    sh = max(sh, 0.1 * liftShadow(P.xy, tB.xy, tHS, tB.w, tB.z, LD));
    col *= (1.0 - sh) * light(P.xy);
    // ---- 相片（波浪毛邊的白邊）
    float tph;
    vec2 q = flatAt(ro, rd, ph.xy, ph.z, ph.w, tph);
    float wph = wppAt(tph, rd, vec3(0.0, 0.0, 1.0)), cph = cocAt(tph * dot(rd, camF));
    float d = deckleBox(q, outer, 13.0, 1.8);
    float a = 1.0 - smoothstep(-0.7 - cph * 0.5, 0.7 + cph * 0.5, d);
    if (a > 0.0) {
      vec2 Pp = (ro + rd * tph).xy;
      vec3 pr = mix(C_BONE, C_PAPER, 0.25) * 0.9 * (0.97 + 0.04 * (textureLod(noiseTex, q / 500.0, 2.0).r - 0.5));
      float di = sdBox(q, phHS);
      if (di < 1.0) {
        vec2 uv = vec2(q.x + phHS.x, phHS.y - q.y) / (2.0 * phHS);
        vec3 im = photoAt(photo, cropUv(uv, crop), lodFor(photoTpw, wph, cph));
        im += C_BONE * 0.018 * smoothstep(0.3, 0.0, abs(uv.x * 0.8 - uv.y - 0.1));
        pr = mix(pr, im, 1.0 - smoothstep(-0.6, 0.6, di));
      }
      col = mix(col, pr * light(Pp), a);
    }
    // ---- 紙膠帶（在相片上面）
    col = overTape(col, ro, rd, tA, 0.0);
    col = overTape(col, ro, rd, tB, 1.0);
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  photo: { value: null }, ink: { value: null }, doodle: { value: null },
  ph: { value: new THREE.Vector4() }, phHS: { value: new THREE.Vector2(300, 200) }, border: { value: 20 }, photoTpw: { value: 1 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  tA: { value: new THREE.Vector4(0, 0, 9999, 0) }, tB: { value: new THREE.Vector4(0, 0, 9999, 0) }, tHS: { value: new THREE.Vector2(95, 24) },
  inkRect: { value: new THREE.Vector4() }, inkOn: { value: 0 }, dRect: { value: new THREE.Vector4(-960, -540, 1920, 1080) },
});

type Pt = [number, number];
interface Stroke { pts: Pt[]; w: number; t0: number; t1: number; heart?: [number, number, number] }

/** 量一條折線，回傳每一點的累積長度。 */
function lengths(pts: Pt[]) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return L;
}

export default class Scrapbook extends Scene {
  bg = shared('scrapbook.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  pic: Pic | null = null;
  noise: THREE.Texture | null = null;
  ink: Layer2D | null = null;
  doodle = this.track(inkLayer(1920, 1080));
  col: TextCol | null = null;
  /** 相片最後的中心（世界座標）、半寬高、白邊、轉角。 */
  pc: [number, number] = [0, 0];
  hs: [number, number] = [300, 200];
  border = 20;
  ang = 0;
  ir: [number, number, number, number] = [0, 0, 0, 0];
  strokes: Stroke[] = [];
  tLand = 0; tTapeA = 0; tTapeB = 0;
  dSig = '';
  tapeHS: [number, number] = [95, 24];

  override async init() {
    const { renderer, start, end, audio } = this.ctx;
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(`${ph.caption}${ph.album}`);
    await loadWords(this.ctx);
    this.pic = await loadPic(renderer, ph);
    this.track(this.pic.tex);
    this.noise = p3Noise(renderer);
    const rnd = mulberry32(this.seed * 977 + 13);
    const { img } = this.pic;
    const colW = 580, colH = 540, pad = 26;
    this.ink = this.track(inkLayer(colW + 2 * pad, colH + 2 * pad));
    this.col = new TextCol(this.ink, colW, colH, {
      family: F.hand(400), ink: mixRgba('ink', 'sepia', 0.45, 0.94), active: mixRgba('blood', 'ink', 0.2), unsung: mixRgba('ink', 'sepia', 0.45, 0.3),
      sigInk: mixRgba('ink', 'sepia', 0.45, 0.75), rs: 1, lineHeight: 1.4, maxLines: 5,
      // 主字（署名）跟歌詞之間畫白筆的波浪線與愛心
      gap: 62,
      label: { family: F.hand(700), size: 24, color: rgba('bone', 0.85), tracking: 4, gap: 22 },
    }, ph, this.ctx, pad);
    const hasText = this.col.has;
    // 相片大小：有字時在左邊，沒字時在正中間
    const boxW = hasText ? 900 : 1180, boxH = hasText ? 740 : 760;
    const [w, h] = picSize(img, boxW - 60, boxH - 60, 1);
    this.border = clamp(0.05 * Math.min(w, h), 14, 30);
    this.hs = [w / 2, h / 2];
    const tw = w + 2 * this.border;
    const gap = 90;
    const groupW = hasText ? tw + gap + colW : tw;
    const x0 = -groupW / 2 - (hasText ? 0 : 20);
    this.pc = [x0 + tw / 2, hasText ? 14 : 24];
    this.ang = (hash(this.seed, 5) < 0.5 ? -1 : 1) * (2 + 2.5 * hash(this.seed, 6)) * (Math.PI / 180);
    // 字的欄：照片右邊，跟照片的中心對齊（世界 y 往上）
    const blockH = this.col.contentH;
    const colLeft = x0 + tw + gap;
    // 下緣不低於 y = -230（畫面上 HUD 區的上面），上緣不高於 330（離畫面頂 ≥ 96 px）
    const colTop = clamp(this.pc[1] + blockH / 2, -230 + blockH, 330);
    this.ir = [colLeft - pad, colTop - colH - pad, colW + 2 * pad, colH + 2 * pad];
    // 節拍：相片落在第一拍，兩條膠帶在接下來兩拍
    const beat = audio.beatPeriod(start + 0.1);
    this.tLand = clamp(firstBeat(audio, start, 0.55), start + 0.35, start + 0.7);
    this.tTapeA = Math.min(this.tLand + Math.max(0.3, beat), end - 1.2);
    this.tTapeB = Math.min(this.tTapeA + Math.max(0.3, beat), end - 0.9);
    // 膠帶貼在左上、右下兩個對角（斜 35～50 度）
    this.tapeHS = [clamp(Math.min(w, h) * 0.2, 70, 105), 22];
    // 註解在相片落下後開始寫
    this.col.writeFrom = this.tLand + 0.25;
    this.col.writeTo = this.col.writeFrom + Math.min(2.0, 0.07 * this.col.chars + 0.3);
    // ---- 塗鴉（世界座標，世界 y 往上）
    const S: Stroke[] = [];
    const t0 = this.tTapeA + 0.15;
    const cx = this.pc[0], cy = this.pc[1], ow = this.hs[0] + this.border, oh = this.hs[1] + this.border;
    // 相片右上角外面的三顆小星星
    const star = (x: number, y: number, r: number, ts: number): Stroke[] => [
      { pts: [[x, y + r], [x + r * 0.12, y + r * 0.12], [x + r, y], [x + r * 0.12, y - r * 0.12], [x, y - r], [x - r * 0.12, y - r * 0.12], [x - r, y], [x - r * 0.12, y + r * 0.12], [x, y + r]], w: 3, t0: ts, t1: ts + 0.3 },
    ];
    const sx = cx + ow * Math.cos(this.ang) - oh * Math.sin(this.ang), sy = cy + oh * Math.cos(this.ang) + ow * Math.sin(this.ang);
    S.push(...star(sx - 18, sy + 62, 22, t0));
    S.push(...star(sx + 26, sy + 30, 13, t0 + 0.18));
    S.push(...star(sx - 64, sy + 96, 11, t0 + 0.32));
    if (hasText) {
      // 從字的上方彎過來指向相片的箭頭（往上拱的一道弧，筆畫有一點抖）
      const ax = colLeft + 20, ay = colTop + 46;
      const bx = cx + ow * Math.cos(this.ang) + 30, by = cy + oh * 0.4;
      const dx = bx - ax, dy = by - ay, dl = Math.hypot(dx, dy) || 1;
      let nx = -dy / dl, ny = dx / dl;
      if (ny < 0) { nx = -nx; ny = -ny; }
      const bulge = clamp(dl * 0.32, 50, 120);
      const pts: Pt[] = [];
      for (let i = 0; i <= 40; i++) {
        const v = i / 40, j = 2.2 * Math.sin(v * 23 + rnd() * 0.5);
        pts.push([ax + dx * v + nx * (bulge * Math.sin(Math.PI * v) + j), ay + dy * v + ny * (bulge * Math.sin(Math.PI * v) + j)]);
      }
      const [ex, ey] = pts[pts.length - 1]!, [px2, py2] = pts[pts.length - 4]!;
      const a = Math.atan2(ey - py2, ex - px2);
      S.push({ pts, w: 3.2, t0: t0 + 0.3, t1: t0 + 0.95 });
      S.push({ pts: [[ex + 20 * Math.cos(a + 2.6), ey + 20 * Math.sin(a + 2.6)], [ex, ey], [ex + 20 * Math.cos(a - 2.6), ey + 20 * Math.sin(a - 2.6)]], w: 3.2, t0: t0 + 0.95, t1: t0 + 1.1 });
      if (this.col.fit) {
        // 主字（有署名就是署名）底下的波浪線＋一顆小愛心：畫在主字跟歌詞之間的空裡
        const fit = this.col.fit;
        const lastW = Math.min(colW, fit.width);
        const uy = colTop - this.col.labelH - this.col.text.mainH - 24;
        const wv: Pt[] = [];
        for (let i = 0; i <= 30; i++) wv.push([colLeft + (lastW * 0.75 * i) / 30, uy + 5 * Math.sin(i * 0.9 + rnd())]);
        const tu = Math.max(this.col.writeTo + 0.1, t0 + 1.1);
        S.push({ pts: wv, w: 3, t0: tu, t1: tu + 0.45 });
        S.push({ pts: [], w: 0, t0: tu + 0.45, t1: tu + 0.6, heart: [colLeft + lastW * 0.75 + 34, uy + 6, 30] });
      }
    } else {
      // 沒有字：相片左下角外一圈點點虛線
      const pts: Pt[] = [];
      const bx = cx - ow * Math.cos(this.ang) + oh * Math.sin(this.ang), by = cy - oh * Math.cos(this.ang) - ow * Math.sin(this.ang);
      for (let i = 0; i <= 24; i++) { const a = Math.PI * (0.55 + 0.9 * (i / 24)); pts.push([bx + 70 * Math.cos(a), by + 70 * Math.sin(a)]); }
      S.push({ pts, w: 3, t0: t0 + 0.3, t1: t0 + 0.9 });
    }
    // 很短的窗格：塗鴉一定在結束前畫完
    const late = Math.max(...S.map((s) => s.t1));
    if (late > end - 0.4) { const k = (end - 0.4 - t0) / Math.max(0.1, late - t0); for (const s of S) { s.t0 = t0 + (s.t0 - t0) * k; s.t1 = t0 + (s.t1 - t0) * k; } }
    this.strokes = S;
  }

  /** 白筆塗鴉（只在畫的過程中重畫）。 */
  private drawDoodles(t: number) {
    const done = this.strokes.map((s) => clamp((t - s.t0) / Math.max(0.01, s.t1 - s.t0)));
    const sig = done.map((d) => d.toFixed(3)).join(',');
    if (sig === this.dSig) return;
    this.dSig = sig;
    const L = this.doodle, c = L.ctx;
    L.clear();
    // 世界 → 畫布：圖層蓋住 x -960..960、y -540..540
    const X = (x: number) => x + 960, Y = (y: number) => 540 - y;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = rgba('bone', 0.9);
    this.strokes.forEach((s, i) => {
      const f = done[i]!;
      if (f <= 0) return;
      if (s.heart) {
        const [hx, hy, hz] = s.heart;
        drawHeart(c, X(hx), Y(hy), hz * ease.outBack(f), rgba('rose', 0.95));
        return;
      }
      const Ls = lengths(s.pts), tot = Ls[Ls.length - 1]! * f;
      c.lineWidth = s.w;
      c.beginPath();
      c.moveTo(X(s.pts[0]![0]), Y(s.pts[0]![1]));
      for (let k = 1; k < s.pts.length; k++) {
        if (Ls[k]! <= tot) { c.lineTo(X(s.pts[k]![0]), Y(s.pts[k]![1])); continue; }
        const a = s.pts[k - 1]!, b = s.pts[k]!, u = (tot - Ls[k - 1]!) / Math.max(1e-6, Ls[k]! - Ls[k - 1]!);
        c.lineTo(X(lerp(a[0], b[0], u)), Y(lerp(a[1], b[1], u)));
        break;
      }
      c.stroke();
    });
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    // 相片上的畫面往焦點推；鏡頭也往焦點靠一點（有字時少靠，字才一直在畫面裡）
    const crop = picCrop(this.pic!, settleK(lt, 6), { zoom: 1.14, screenW: this.hs[0] * 2 });
    const [fx, fy] = focusAt(this.pic!, crop, this.pc, this.hs, this.ang);
    const lean = (this.col!.has ? 0.16 : 0.42) * settle(lt, 6);
    // 鏡頭：幾乎正上方，手持的輕微晃動，很慢地推近
    const wob = (k: number) => 1.3 * fbm1(t * 0.35 + k * 17.3, 2, this.seed);
    const push = 1 - 0.05 * settle(lt, 6) + 0.04 * (1 - ease.outCubic(prog(t, s, s + 0.9)));
    const dist = CAM_FOCAL * push;
    this.cam.orbit([6 * wob(1) + lean * (fx - this.pc[0]), 10 + 6 * wob(2) + lean * (fy - this.pc[1]), 0], dist, 80 + 0.6 * wob(3), 1.2 * wob(4), 30, -1.2 + 0.5 * wob(5));
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    // 相片：從上面落下來（越來越快），落地的時候轉回去
    const pd = prog(t, s, this.tLand, ease.inQuad);
    const bounce = 6 * Math.sin(Math.max(0, t - this.tLand) * 22) * Math.exp(-Math.max(0, t - this.tLand) * 9);
    const z = lerp(320, 2, pd) + Math.max(0, bounce);
    (u.ph!.value as THREE.Vector4).set(this.pc[0] - 40 * (1 - pd), this.pc[1] + 60 * (1 - pd), z, this.ang + 0.12 * (1 - pd));
    (u.phHS!.value as THREE.Vector2).set(...this.hs);
    u.border!.value = this.border;
    u.photo!.value = this.pic!.tex;
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoTpw!.value = texPerWorld(this.pic!.img, this.hs[0] * 2, crop);
    // 膠帶：從上面一點點壓下來（很快），斜貼在對角
    const ow = this.hs[0] + this.border, oh = this.hs[1] + this.border;
    const corner = (sx: number, sy: number): [number, number] => {
      const x = sx * (ow - 12), y = sy * (oh - 12);
      const c = Math.cos(this.ang), si = Math.sin(this.ang);
      return [this.pc[0] + x * c - y * si, this.pc[1] + x * si + y * c];
    };
    const tz = (t0: number) => (t < t0 - 0.2 ? 9999 : lerp(70, 3, prog(t, t0 - 0.2, t0, ease.inQuad)));
    const [ax, ay] = corner(-1, 1), [bx, by] = corner(1, -1);
    (u.tA!.value as THREE.Vector4).set(ax, ay, tz(this.tTapeA), this.ang + (Math.PI / 180) * 44);
    (u.tB!.value as THREE.Vector4).set(bx, by, tz(this.tTapeB), this.ang + (Math.PI / 180) * 39);
    (u.tHS!.value as THREE.Vector2).set(...this.tapeHS);
    u.noiseTex!.value = this.noise;
    this.drawDoodles(t);
    u.doodle!.value = this.doodle.texture;
    u.inkOn!.value = this.col!.draw(t) ? 1 : 0;
    u.ink!.value = this.ink!.texture;
    (u.inkRect!.value as THREE.Vector4).set(...this.ir);
    u.focusD!.value = this.cam.depth([0, 0, 0]);
    u.aper!.value = 8;
    u.k!.value = (0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.1, bloomThreshold: 1.15, halation: 0.04, vignette: 0.34 };
  }
}
