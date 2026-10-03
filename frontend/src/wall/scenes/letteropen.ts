// 照片版面「拆信」（亮）：桌上一個牛皮紙信封（背面朝上），拍點上封口掀開，照片從信封裡抽出來——
//  - 切進來：信封從上面一點點落到亞麻桌布上（影子收緊），鏡頭先把整個信封框在畫面裡。
//  - 第一個拍點：封口繞著摺線翻過去（掀到一半時尖端離鏡頭比較近、稍微變寬），翻到背面是印著訊號色細斜紋的內襯，攤在信封上方。
//  - 接著照片（白邊相紙）從開口抽出來，鏡頭同時往上移：照片完整停在畫面上方，信封剩上半截在下面，照片最下緣的白邊還塞在信封口裡。
//    開口有拇指缺口、口袋背面有黏合的菱形摺邊。
//  - 焦點：照片抽出來以後鏡頭慢慢往相片上的焦點推近（焦點往畫面中間移，字一直在安全區裡），相紙上的畫面本身也往焦點小推一點。
//  - 字手寫在信封背面（開口下面）：主字（賓客留言＋署名，或新人的註解）照片停好以後一個字一個字寫出來，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己寫在同一個位置跟唱；兩個都沒有就只有照片（信封往下退，照片在畫面正中間）。
//    字多（60 字的留言＋歌詞）時口袋往上長、照片小一點，字都寫在信封上。相簿的第一張在字上面多一行小小的相簿名。
//  - 窗光從左上斜照，兩道很軟的窗格影子慢慢移過桌面、信封與照片。
//  - 窗格短（3 秒）時整套動作壓快：照片一秒多就完整出現。
// 畫法：一個全螢幕 shader（世界座標 → 信封座標 → 照片座標，一層一層疊：桌布、內襯、掀開的封口、照片、口袋、還沒掀的封口），
// 字層貼在口袋上（shader 裡取樣，跟著信封一起斜、一起被推近）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, focusAmp, focusAt, focusCam, loadPhoto, p6Crop, pace, photoLod, setP6Photo } from './_p6';
import { focusCrop, settleK } from './_photo';
import type { PhotoImage } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, prefers: ['landscape', 'small'], energy: [0, 0.9], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D tl;
  uniform vec3 cam;
  uniform vec2 envC; uniform vec2 envHS; uniform float envAng; uniform float envLift; uniform float gap; uniform float notchR;
  uniform float flapD; uniform float phi;
  uniform vec2 phC; uniform vec2 phHS; uniform float bw; uniform float phAng; uniform float phLift; uniform float lod;
  uniform vec2 tlPos; uniform vec2 tlSize; uniform float textK;
  uniform float t; uniform float k;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 wp = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // 桌布：暖灰的亞麻，很淡的織紋與粗紗
    vec3 col = mix(C_PAPER, C_ASH, 0.3);
    // 織紋：座標上千，直接 sin() 在顯示卡上精度不穩（同一格畫兩次會差一階），先取 fract 再換回角度，樣子一樣
    float wv = (0.5 + 0.5 * sin(fract(wp.x * 1.05 / 6.28318) * 6.28318)) * (0.5 + 0.5 * sin(fract(wp.y * 1.05 / 6.28318) * 6.28318));
    float slub = snoise(vec2(wp.x / 3.0, wp.y / 80.0)) + snoise(vec2(wp.x / 90.0, wp.y / 3.0));
    col *= 0.965 + 0.025 * wv + 0.012 * slub + 0.03 * fbm(wp / 420.0, 2);

    // ---- 信封（座標：中心原點、y 向下；落下時稍微大一點）
    vec2 el = rot2(envAng) * (wp - envC) / (1.0 + 0.035 * (envLift - 1.0));
    vec2 hs = envHS;
    // 信封的影子（落下的瞬間比較遠、比較淡）
    float so = 5.0 + 22.0 * (envLift - 1.0);
    float dS = sdBox(el - vec2(so * 0.55, so), hs);
    col *= 1.0 - (0.26 / envLift) * exp(-max(dS, 0.0) / (12.0 + 30.0 * (envLift - 1.0)));
    // 內襯：訊號色的細斜紋（封口背面、開口裡面看得到的那一條）
    vec2 lq = rot2(0.785) * el;
    float stripe = smoothstep(0.35, 0.5, abs(fract(lq.x / 14.0) - 0.5));
    vec3 lining = mix(mix(C_PAPER, C_SIGNAL, 0.22), mix(C_PAPER, C_SIGNAL, 0.42), stripe) * 0.95;
    float ea = aaFill(sdBox(el, hs));
    // 開口裡面（口袋的上緣下面是暗的）
    col = mix(col, lining * (0.72 + 0.2 * smoothstep(-hs.y + gap + 40.0, -hs.y, el.y)), ea);

    // ---- 封口：繞著上緣（y = -hs.y）的摺線翻；cos > 0 蓋在口袋上（外面，牛皮紙），cos < 0 攤在信封上方（裡面，內襯）
    float cph = cos(phi), sph = sin(phi);
    float cs = cph >= 0.0 ? max(cph, 0.03) : min(cph, -0.03);
    float v = (el.y + hs.y) / cs;
    float pers = 1.0 + 0.1 * sph * clamp(v / flapD, 0.0, 1.0);
    float u = el.x / pers;
    float su = sqrt(u * u + 3600.0) - 60.0;
    float fsd = (v - flapD * (1.0 - su / hs.x)) / sqrt(1.0 + flapD * flapD / (hs.x * hs.x));
    fsd = max(max(fsd, -v), abs(u) - hs.x);
    // 掀開的那一半在畫面上被壓扁：距離換回畫面上的大小再抗鋸齒
    float fa = aaFill(fsd * abs(cs));
    vec3 kraft = mix(C_FUR, C_BONE, 0.36) * 0.8;
    // 攤開的封口（內襯）：在照片後面
    vec3 flapIn = mix(lining, lining * 0.82, smoothstep(0.0, 1.0, -cph)) * (0.86 + 0.1 * (-cph));
    float openF = step(cph, 0.0);
    // 封口攤在桌上的影子（照片抽出來以前看得到）
    col = mix(col, flapIn, fa * openF);

    // ---- 照片（白邊相紙）：在封口與口袋之間
    vec2 pl = rot2(phAng) * (el - phC);
    vec2 po = phHS + vec2(bw);
    float pso = 4.0 + 16.0 * phLift;
    float dps = sdBox(pl - vec2(pso * 0.5, pso), po);
    col *= 1.0 - 0.24 * exp(-max(dps, 0.0) / (5.0 + 14.0 * phLift));
    float pa = aaFill(sdBox(pl, po));
    vec3 pr = C_BONE * 0.9;
    float di = sdBox(pl, phHS);
    vec2 uv = (pl + phHS) / (2.0 * phHS);
    vec3 ph = p6Photo(photo, uv, lod);
    // 相紙的光澤：很淡的一道斜光
    ph += C_BONE * 0.02 * smoothstep(0.3, 0.0, abs(uv.x - uv.y * 0.6 - 0.25));
    pr = mix(pr, ph, aaFill(di));
    col = mix(col, pr, pa);

    // ---- 口袋（信封背面）：上緣在 -hs.y + gap，中間有拇指缺口；蓋住還在信封裡的照片
    float top = -hs.y + gap;
    float psd = max(sdBox(el, hs), top - el.y);
    psd = max(psd, notchR - length(el - vec2(0.0, top)));
    float ka = aaFill(psd);
    vec3 kr = p6Paper(el + envC, kraft);
    // 牛皮紙的纖維斑點
    kr *= 1.0 - 0.05 * smoothstep(0.55, 0.9, snoise(el / 7.0)) * smoothstep(0.2, 0.6, snoise(el / 140.0 + 3.0));
    // 黏合的摺邊：左右兩片從上角往中間斜下，底片蓋在上面（一道細影＋一道亮邊）
    vec2 m = vec2(0.0, hs.y * 0.18);
    float ds1 = sdSegment(el, vec2(-hs.x, top), m), ds2 = sdSegment(el, vec2(hs.x, top), m);
    float dsm = min(ds1, ds2);
    float below = step(m.y - (m.y - top) * abs(el.x) / hs.x, el.y);
    kr *= 1.0 - 0.16 * exp(-dsm / 1.6) * (1.0 - below) + 0.05 * exp(-dsm / 1.2) * below;
    // 口袋上緣：紙邊的亮線，下面一點點暗（照片從這裡出來）
    float edge = abs(psd);
    kr *= 1.0 + 0.08 * exp(-edge / 1.3) * step(el.y, top + 3.0) - 0.1 * exp(-edge / 1.6) * step(top + 3.0, el.y);
    // 字（寫在口袋上）
    vec4 tx = p6Layer(tl, el - tlPos, tlSize) * textK;
    kr = kr * (1.0 - tx.a) + tx.rgb;
    col = mix(col, kr, ka);

    // ---- 還沒掀的封口（外面，牛皮紙＋一顆小封緘）：蓋在口袋上，影子落在口袋上
    float fsdS = max(max(((el.y - 6.0 + hs.y) / cs - flapD * (1.0 - su / hs.x)) / sqrt(1.0 + flapD * flapD / (hs.x * hs.x)), -v), abs(u) - hs.x);
    col *= 1.0 - 0.18 * (1.0 - openF) * ka * (1.0 - smoothstep(-2.0, 10.0, fsdS * abs(cs))) * (1.0 - fa);
    vec3 fo = p6Paper(vec2(u, v) + envC, kraft) * (0.92 + 0.1 * cph);
    float seal = length(vec2(u, v - flapD + 46.0)) - 26.0;
    vec3 sealC = mix(C_SIGNAL, C_BLOOD, 0.35) * 0.8;
    sealC *= 1.0 - 0.18 * smoothstep(-8.0, 0.0, seal) + 0.1 * smoothstep(-26.0, -14.0, -abs(seal + 13.0));
    fo = mix(fo, sealC, aaFill(seal * abs(cs)));
    col = mix(col, fo, fa * (1.0 - openF));

    // 窗光：左上亮、右下暗；兩道很軟的窗格影子慢慢移過去（照在桌上、信封、照片上）
    float lg = 1.0 - 0.13 * smoothstep(-200.0, 2200.0, dot(wp, vec2(0.72, 0.69)));
    vec2 bq = rot2(0.55) * (wp - vec2(t * 7.0, 0.0));
    float bar = smoothstep(0.08, 0.0, abs(fract(bq.x / 760.0) - 0.5) - 0.06);
    col *= lg * (1.0 - 0.07 * bar);
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, tl: { value: null }, cam: { value: new THREE.Vector3(W / 2, H / 2, 1) },
  envC: { value: new THREE.Vector2() }, envHS: { value: new THREE.Vector2() }, envAng: { value: 0 }, envLift: { value: 1 }, gap: { value: 12 }, notchR: { value: 34 },
  flapD: { value: 200 }, phi: { value: 0 },
  phC: { value: new THREE.Vector2() }, phHS: { value: new THREE.Vector2() }, bw: { value: 20 }, phAng: { value: 0 }, phLift: { value: 0 }, lod: { value: 0 },
  tlPos: { value: new THREE.Vector2() }, tlSize: { value: new THREE.Vector2(1, 1) }, textK: { value: 0 },
  t: { value: 0 }, k: { value: 1 },
});

/** 開口（口袋上緣）比摺線低多少、拇指缺口的半徑。 */
const GAP = 12, NOTCH = 34;
/** 照片停好以後鏡頭往焦點推：再放大 5%，焦點往畫面中間移三成。 */
const FOCUS = { zoom: 1.05, pull: 0.3 };

export default class LetterOpen extends Scene {
  bg = shared('letteropen.bg', BG);
  // 字：信封背面寬 900、最多三行（60 字的留言也放得下），整塊（主字＋署名＋歌詞）最高 320
  cap = this.track(new Caption(900, 320, { family: F.hand(400), align: 'center', lineHeight: 1.34, maxLines: 3, ink: rgba('sepia', 0.9) }));
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  /** 照片（不含白邊）的半寬高、白邊。 */
  hw = 300; hh = 200; bw = 20;
  /** 信封的中心（世界座標＝最後的畫面座標）與半寬高、封口深度。 */
  ex = W / 2; ey = H / 2; ehw = 400; ehh = 300; flapD = 200; ang = 0;
  /** 照片在信封座標裡的起點、終點（中心的 y）。 */
  py0 = 0; py1 = 0;
  /** 一開始鏡頭看著哪裡、放多大。 */
  cx0 = W / 2; cy0 = H / 2; z0 = 1;
  /** 焦點（照片停好、推到底時在世界座標的位置）與鏡頭往那裡推的幅度（字不能被推出安全區）。 */
  foc: [number, number] = [W / 2, H / 2];
  amp = 1;
  tOpen = 0; tSlide = 0; tDone = 0; kp = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { start, audio } = this.ctx;
    const cap = this.cap;
    cap.setup(this.ctx, ph);
    const { w, h } = img;
    const textH = cap.has ? cap.blockH : 0;
    // 口袋上緣（照片的下緣）：有字時讓字的最後一行停在 975 上面；沒有字時信封往下退，照片在正中間
    const pocketTop = cap.has ? Math.min(800, 975 - 46 - textH) : 1000;
    const availH = cap.has ? pocketTop - 72 : 900;
    const availW = cap.has ? 1320 : 1560;
    let bw = 22;
    let s = fitPhoto(w, h, availW - 2 * bw, availH - 2 * bw);
    bw = clamp(0.032 * Math.min(w * s, h * s), 12, 26);
    s = fitPhoto(w, h, availW - 2 * bw, availH - 2 * bw);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2; this.bw = bw;
    const POW = w * s + 2 * bw, POH = h * s + 2 * bw;
    // 信封比照片大一圈（裝得下），也要寬到放得下字、高到開口下面寫得下整塊字
    this.ehw = Math.max(POW + 90, cap.has ? cap.blockW + 170 : 0, 620) / 2;
    this.ehh = Math.max(POH + 70, this.ehw * 1.0, cap.has ? GAP + NOTCH + 12 + textH + 70 : 0) / 2;
    this.ex = cap.has ? 850 : W / 2;
    const hingeY = pocketTop - GAP;
    this.ey = hingeY + this.ehh;
    this.flapD = Math.min(this.ehh * 0.82, this.ehw * 0.62);
    this.ang = (hash(this.seed, 7) * 2 - 1) * 1.4 * (Math.PI / 180);
    // 照片：一開始整張在信封裡（口袋蓋住），最後完整在開口上面、白邊的下緣塞在口袋裡
    this.py0 = this.ehh - POH / 2 - 8;
    this.py1 = -this.ehh + GAP - 2 - this.hh;
    // 一開始的鏡頭：整個信封（封口蓋著）在畫面裡
    this.z0 = Math.min(0.94, 900 / (2 * this.ehh), 1500 / (2 * this.ehw));
    this.cx0 = this.ex; this.cy0 = this.ey - 10;
    // 焦點：照片停好（中心 (ex, ey + py1)）、相紙上的畫面推到底時，焦點在哪裡
    const zoom = 1.1, rect = [this.ex - this.hw, this.ey + this.py1 - this.hh, this.ex + this.hw, this.ey + this.py1 + this.hh];
    this.foc = focusAt(ph, focusCrop(ph, w, h, w / h, 1, { zoom, screenW: 2 * this.hw }), rect);
    // 字（信封稍微斜，左右多留一點）推完也要在安全區裡
    const tTop = pocketTop + NOTCH + 12;
    this.amp = cap.has ? focusAmp(this.foc, FOCUS, [[this.ex - cap.blockW / 2 - 14, tTop - 14, this.ex + cap.blockW / 2 + 14, tTop + textH + 18]]) : 1;
    // 動作的時間：窗格短就壓快
    const kp = pace(this.ctx);
    this.kp = kp;
    this.tOpen = Math.min(beatAfter(audio, start + 0.15), start + 0.75 * kp);
    this.tSlide = this.tOpen + 0.32 * kp;
    this.tDone = this.tSlide + 1.25 * kp;
    cap.writeAt(this.tDone - 0.15 * kp, 2.0);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, kp = this.kp;
    const u = this.bg.u;
    // 相紙上的畫面：照片開始抽出來就往焦點小推（推到 1.1 倍）
    const crop = p6Crop(this.ctx, this.img!, t, { zoom: 1.1, screenW: 2 * this.hw, t0: this.tSlide });
    setP6Photo(u, this.ctx.params.photo, crop);
    // 落下：從上面一點點落到桌上
    const drop = ease.outCubic(prog(t, s, s + 0.45 * kp));
    const phi = Math.PI * ease.outCubic(prog(t, this.tOpen, this.tOpen + 0.5 * kp));
    const slide = ease.inOutCubic(prog(t, this.tSlide, this.tSlide + 1.15 * kp));
    const camK = ease.inOutCubic(prog(t, this.tSlide + 0.1 * kp, this.tDone));
    // 抽出來的瞬間稍微抬起（影子遠一點），停好後落回去
    const lift = Math.sin(Math.PI * slide) * 0.8 + 0.25 * (1 - prog(t, this.tDone, this.tDone + 0.4));
    // 鏡頭：從整個信封移到照片；停好後一開始快、越來越慢地往相片上的焦點推近（焦點往畫面中間移）
    const base: [number, number, number] = [lerp(this.cx0, W / 2, camK), lerp(this.cy0, H / 2, camK), lerp(this.z0, 1, camK)];
    const [cx, cy, z] = focusCam(this.foc, settleK(t - this.tDone, 6) * this.amp, { ...FOCUS, base });
    (u.cam!.value as THREE.Vector3).set(cx, cy - 26 * (1 - drop), z);
    (u.envC!.value as THREE.Vector2).set(this.ex, this.ey);
    (u.envHS!.value as THREE.Vector2).set(this.ehw, this.ehh);
    u.envAng!.value = this.ang;
    u.envLift!.value = lerp(1.7, 1, drop);
    u.gap!.value = GAP; u.notchR!.value = NOTCH;
    u.flapD!.value = this.flapD; u.phi!.value = phi;
    const py = lerp(this.py0, this.py1, slide);
    (u.phC!.value as THREE.Vector2).set(3 * Math.sin(Math.PI * slide), py);
    (u.phHS!.value as THREE.Vector2).set(this.hw, this.hh);
    u.bw!.value = this.bw;
    u.phAng!.value = (hash(this.seed, 11) * 2 - 1) * 1.2 * (Math.PI / 180) * slide;
    u.phLift!.value = lift;
    u.photo!.value = this.tex;
    u.lod!.value = photoLod(this.img!.w * (crop[2] - crop[0]), 2 * this.hw * z);
    const cap = this.cap;
    if (cap.has) {
      cap.draw(t);
      (u.tlPos!.value as THREE.Vector2).set(-cap.L.w / 2, -this.ehh + GAP + NOTCH + 12 - cap.pad);
      (u.tlSize!.value as THREE.Vector2).set(cap.L.w, cap.L.h);
      u.tl!.value = cap.L.texture;
      // 只有歌詞：照片停好時一起淡入（主字是一個字一個字寫出來，下面的歌詞跟著一起出現）
      u.textK!.value = cap.hasMain ? 1 : prog(t, this.tDone - 0.3 * kp, this.tDone + 0.2);
    } else { u.textK!.value = 0; u.tl!.value = this.tex; }
    u.t!.value = t;
    u.k!.value = (0.93 + 0.07 * drop) * (1 - 0.06 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { ...P6_POST };
  }
}
