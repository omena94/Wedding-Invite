// 照片版面「素描上色」（亮）：一本攤開的線圈素描本，左頁先用鉛筆把照片「畫」出來，再用色鉛筆一筆一筆上色，最後變回清楚的照片——
//  - 素描：照片的輪廓（init() 用 shader 對照片的亮度算一次 Sobel 邊緣，存成一張圖），線條有一點抖、石墨只卡在紙齒上；
//    暗的地方再加斜的排線（很暗的地方交叉排線）。從焦點附近開始，一片一片長出來（雜訊決定先後）。
//  - 上色：色鉛筆從左上斜斜掃到右下（邊緣參差），剛塗上的地方看得到紙齒的顆粒；塗滿之後顆粒退掉、鉛筆線淡到幾乎看不見，
//    照片完整清楚。短窗格（3 秒）一秒半內畫完塗完，長窗格最多四秒，之後都是完整的照片。
//  - 焦點：素描從焦點開始長出來；畫裡的畫面慢慢往焦點推（推到 1.15 倍，素描線跟著一起），鏡頭也往焦點推近一點（字一直在安全區裡）。
//  - 素描本：紙頁米白、中間偏右是線圈（金屬圈＋紙上的打孔），左邊看得到一疊頁緣；本子比畫面大，右頁只露出一部分。
//  - 字用鉛筆手寫在右頁（石墨只卡在紙齒上）：主字（賓客留言＋署名，或新人的註解）一個字一個字寫出來，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己寫在右頁跟唱；兩個都沒有就只有左頁的畫（線圈往右移，左頁更大）。相簿的第一張在字上面多一行小小的相簿名。
// 畫法：init() 先畫一次邊緣圖（FSPass → render target）；每格一個全螢幕 shader 疊：書桌、紙頁、素描（邊緣＋排線）、顏色、線圈、字。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, focusAmp, focusAt, focusCam, loadPhoto, p6Crop, pace, photoLod, setP6Photo, type FocusCamOpts } from './_p6';
import { focusCrop, settleK } from './_photo';
import type { PhotoImage } from '../photos';

// 縮圖拍在上色到一半（左上是顏色、右下還是鉛筆素描）
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, prefers: ['landscape'], energy: [0, 0.8], bars: [2, 8], weight: 1, thumbAt: 0.19 };

/** 邊緣圖：R = 邊緣強度、G = 模糊過的亮度（排線用）。只在 init() 畫一次。 */
const EDGE = () => new FSPass(/* glsl */ `
  uniform sampler2D photo; uniform float lod; uniform vec2 px;
  float L(vec2 uv) { return luma(toLinear(textureLod(photo, clamp(uv, 0.0, 1.0), lod).rgb)); }
  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    float a = L(uv + px * vec2(-1, -1)), b = L(uv + px * vec2(0, -1)), c = L(uv + px * vec2(1, -1));
    float d = L(uv + px * vec2(-1, 0)), f = L(uv + px * vec2(1, 0));
    float g = L(uv + px * vec2(-1, 1)), h = L(uv + px * vec2(0, 1)), i = L(uv + px * vec2(1, 1));
    float gx = (c + 2.0 * f + i) - (a + 2.0 * d + g);
    float gy = (g + 2.0 * h + i) - (a + 2.0 * b + c);
    // 亮度是線性的：暗部的邊比較弱，開根號拉回來（像眼睛看到的對比）
    float e = sqrt(length(vec2(gx, gy)));
    float lum = luma(toLinear(textureLod(photo, uv, lod + 2.0).rgb));
    fragColor = vec4(e, lum, 0.0, 1.0);
  }`, { photo: { value: null }, lod: { value: 0 }, px: { value: new THREE.Vector2() } });

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D edge; uniform sampler2D tl;
  uniform vec3 cam;
  uniform vec4 rect; uniform vec2 foc; uniform float lod;
  uniform float gut;        // 線圈（中縫）的 x
  uniform float draw; uniform float shade; uniform float color; uniform float clear;
  uniform vec4 tlR; uniform float textK; uniform float k;
  float tooth(vec2 p) { return 0.55 * snoise(p / 2.1) + 0.45 * snoise(p / 5.3 + 7.0); }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    float th = tooth(p);
    // ---- 書桌（淺灰的石面）與素描本
    vec3 desk = mix(C_ASH, C_BONE, 0.45) * (0.9 + 0.05 * fbm(p / 260.0, 3));
    vec2 bLo = vec2(96.0, 40.0), bHi = vec2(${W + 400}.0, ${H - 34}.0);
    float bd = sdBox(p - 0.5 * (bLo + bHi), 0.5 * (bHi - bLo));
    vec3 col = desk * (1.0 - 0.28 * exp(-max(sdBox(p - 0.5 * (bLo + bHi) - vec2(8.0, 14.0), 0.5 * (bHi - bLo)), 0.0) / 16.0));
    // 左邊的頁緣：一疊紙的細線
    float stack = bd + 9.0;
    vec3 edgeC = C_PAPER * 0.86 * (1.0 - 0.18 * smoothstep(0.3, 0.0, abs(fract(stack / 2.2) - 0.5)) * step(0.0, stack));
    vec3 page = p6Paper(p, mix(C_PAPER, C_BONE, 0.45) * 0.97) * (1.0 - 0.02 * th);
    // 紙頁靠線圈的地方稍微暗（頁面彎下去）
    page *= 1.0 - 0.12 * exp(-abs(p.x - gut) / 46.0);
    vec3 book = mix(edgeC, page, step(stack, 0.0));
    col = mix(col, book, aaFill(bd));

    // ---- 素描（照片的範圍）：邊緣＋排線；先後由雜訊決定，焦點附近先畫
    vec2 uv = (p - rect.xy) / (rect.zw - rect.xy);
    float inR = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec2 jit = vec2(snoise(p / 23.0), snoise(p / 23.0 + 5.0)) * 1.4;
    // 邊緣圖是 render target（v = 0 在下面）：照片座標的 y 要翻過來；畫裡的畫面往焦點推（pcrop），邊緣圖跟著照片一起裁
    vec2 ue = p6Crop((p + jit - rect.xy) / (rect.zw - rect.xy));
    vec4 E = textureLod(edge, vec2(ue.x, 1.0 - ue.y), 0.0);
    // 先後：照片上離焦點越近越早畫（pcrop 跟照片同比例，照片座標的長寬比就是框的）
    float order = clamp(length((p6Crop(uv) - foc) / (pcrop.zw - pcrop.xy) * vec2(1.0, (rect.w - rect.y) / (rect.z - rect.x))) * 1.2 + 0.35 * fbm(p / 120.0, 2), 0.0, 1.0);
    float drawn = smoothstep(order - 0.08, order, draw * 1.2 - 0.04);
    float line = smoothstep(0.2, 0.48, E.r) * (0.7 + 0.3 * smoothstep(-0.3, 0.6, th));
    float dark = clamp(1.0 - E.g * 2.4, 0.0, 1.0);
    float h1 = hatch(dot(p, vec2(0.7071, -0.7071)) / 6.0, dark * 0.55) * smoothstep(0.0, 0.06, dark);
    float h2 = hatch(dot(p, vec2(0.7071, 0.7071)) / 6.0, clamp(dark * 1.3 - 0.75, 0.0, 1.0) * 0.6) * smoothstep(0.55, 0.75, dark);
    float hatchI = max(h1, h2) * smoothstep(order - 0.08, order, shade * 1.2 - 0.04) * (0.55 + 0.45 * smoothstep(-0.2, 0.5, th));
    float graph = clamp(max(line * drawn, hatchI * 0.45), 0.0, 1.0) * inR;
    vec3 lead = mix(C_GRAPHITE, C_SEPIA, 0.35) * 0.9;
    // ---- 上色：從左上斜斜掃到右下，邊緣參差；剛塗的地方看得到紙齒
    float diag = (uv.x * (rect.z - rect.x) + uv.y * (rect.w - rect.y) * 0.8) / ((rect.z - rect.x) + (rect.w - rect.y) * 0.8);
    float cf = diag + 0.05 * snoise(p / 40.0) + 0.025 * snoise(vec2(dot(p, vec2(0.7071, 0.7071)) / 70.0, dot(p, vec2(0.7071, -0.7071)) / 5.0));
    float cm = smoothstep(cf - 0.09, cf, color * 1.3 - 0.2) * inR;
    vec3 ph = p6Photo(photo, uv, lod);
    vec3 pencilCol = ph * (0.82 + 0.18 * smoothstep(-0.4, 0.5, th)) + page * 0.06;
    vec3 colored = mix(pencilCol, ph, clear);
    vec3 c2 = mix(col, colored, cm);
    // 鉛筆線：還沒上色的地方是石墨；上了色之後淡淡留著，清楚以後幾乎看不見
    c2 = mix(c2, lead, graph * mix(0.85, 0.22, cm) * (1.0 - 0.9 * clear * cm));
    col = c2;

    // ---- 線圈：金屬圈＋紙上的打孔
    float gy = (fract(p.y / 38.0) - 0.5) * 38.0;
    vec2 hq = vec2(p.x - gut, gy);
    float holeL = length(hq - vec2(-17.0, 0.0)) - 4.6, holeR = length(hq - vec2(17.0, 0.0)) - 4.6;
    float holes = min(holeL, holeR) * step(bLo.y + 30.0, p.y) * step(p.y, bHi.y - 30.0);
    col = mix(col, desk * 0.5, (1.0 - smoothstep(-0.6, 0.6, holes)) * step(holes, 50.0));
    float ring = abs(length(hq * vec2(0.52, 1.0)) - 8.5) - 2.6;
    float inPage = step(bLo.y + 26.0, p.y) * step(p.y, bHi.y - 26.0);
    float ra = (1.0 - smoothstep(-0.7, 0.7, ring)) * inPage;
    vec3 metal = mix(C_GRAPHITE, C_BONE, 0.35 + 0.45 * smoothstep(4.0, -4.0, hq.y) * smoothstep(-12.0, 4.0, hq.x));
    col *= 1.0 - 0.25 * (1.0 - smoothstep(-1.0, 4.0, ring - 2.0)) * (1.0 - ra) * inPage;
    col = mix(col, metal * 0.85, ra);

    // ---- 字：鉛筆寫在右頁（石墨卡在紙齒上）
    vec4 tx = p6Layer(tl, p - tlR.xy, tlR.zw) * textK;
    float ta = tx.a * (0.78 + 0.22 * smoothstep(-0.4, 0.5, th));
    col = mix(col, tx.a > 0.0 ? tx.rgb / tx.a : col, ta);
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, edge: { value: null }, tl: { value: null }, cam: { value: new THREE.Vector3(W / 2, H / 2, 1) },
  rect: { value: new THREE.Vector4(0, 0, 1, 1) }, foc: { value: new THREE.Vector2(0.5, 0.5) }, lod: { value: 0 }, gut: { value: 1240 },
  draw: { value: 0 }, shade: { value: 0 }, color: { value: 0 }, clear: { value: 0 },
  tlR: { value: new THREE.Vector4(0, 0, 1, 1) }, textK: { value: 0 }, k: { value: 1 },
});

/** 畫裡的畫面往焦點推到幾倍；鏡頭再推近 4%、焦點往畫面中間移兩成。 */
const PUSH = 1.15;
const FOCUS: FocusCamOpts = { zoom: 1.04, pull: 0.2 };

export default class Sketch extends Scene {
  bg = shared('sketch.bg', BG);
  edgePass = shared('sketch.edge', EDGE);
  // 字：右頁上寬 470、最多六行（60 字的留言＋署名＋歌詞也放得下），整塊最高 560（最後一行在 HUD 上面）
  cap = this.track(new Caption(470, 560, {
    family: F.hand(400), align: 'left', lineHeight: 1.36, maxLines: 6,
    ink: mixRgba('graphite', 'sepia', 0.45, 0.95), active: mixRgba('signal', 'sepia', 0.4), unsung: rgba('graphite', 0.3),
    label: mixRgba('graphite', 'sepia', 0.3, 0.7),
  }));
  edgeRT: THREE.WebGLRenderTarget | null = null;
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  rect: [number, number, number, number] = [0, 0, 1, 1];
  gut = 1240; tlX = 0; tlY = 0;
  tDraw = 0; tShade = 0; tColor = 0; tClear = 0; kp = 1;
  /** 焦點（畫裡的畫面推到底時在世界座標的位置）與鏡頭往那裡推的幅度（字不能被推出安全區）。 */
  foc: [number, number] = [W / 2, H / 2];
  amp = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { start, end, renderer } = this.ctx;
    const cap = this.cap;
    cap.setup(this.ctx, ph);
    const { w, h } = img;
    const D = end - start;
    // 左頁的畫：有字時線圈在 1240（右頁只露出一部分，字寫在那裡），沒有字時線圈在 1700
    this.gut = cap.has ? 1240 : 1720;
    const pageL = 150, pageR = this.gut - 60;
    const s = fitPhoto(w, h, pageR - pageL, 820);
    const pw = w * s, phh = h * s;
    const cx = (pageL + pageR) / 2, cy = 520;
    this.rect = [cx - pw / 2, cy - phh / 2, cx + pw / 2, cy + phh / 2];
    if (cap.has) { this.tlX = this.gut + 70; this.tlY = clamp(cy - cap.blockH / 2 - 20, 130, 790 - cap.blockH); }
    this.foc = focusAt(ph, focusCrop(ph, w, h, w / h, 1, { zoom: PUSH, screenW: pw }), this.rect);
    this.amp = cap.has ? focusAmp(this.foc, FOCUS, [[this.tlX - 8, this.tlY - 8, this.tlX + cap.blockW + 8, this.tlY + cap.blockH + 16]]) : 1;
    // 邊緣圖：照片在畫面上多大就算多大（pxScale 1），一次畫好
    const ew = Math.max(64, Math.round(pw)), eh = Math.max(64, Math.round(phh));
    this.edgeRT = this.track(makeRT(ew, eh, { pxScale: 1, depthBuffer: false }));
    const eu = this.edgePass.u;
    eu.photo!.value = tex;
    eu.lod!.value = photoLod(w, ew) + 1.1;
    (eu.px!.value as THREE.Vector2).set(1.3 / ew, 1.3 / eh);
    this.edgePass.render(renderer, this.edgeRT);
    renderer.setRenderTarget(null);
    // 時間：素描 → 排線 → 上色 → 清楚（短窗格壓快，長窗格最多四秒畫完）
    this.kp = pace(this.ctx);
    const total = clamp(0.5 * D, 1.4, 4.2);
    this.tDraw = start + 0.15;
    this.tShade = this.tDraw + total * 0.18;
    this.tColor = this.tDraw + total * 0.42;
    this.tClear = this.tDraw + total;
    cap.writeAt(start + 0.4 * this.kp, Math.min(2.4, 0.5 * D));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const [x0, , x1] = this.rect;
    // 畫裡的畫面往焦點推；鏡頭一開始快、越來越慢地往焦點推近
    const crop = p6Crop(this.ctx, this.img!, t, { zoom: PUSH, screenW: x1 - x0 });
    setP6Photo(u, this.ctx.params.photo, crop);
    const [cx, cy, z] = focusCam(this.foc, settleK(t - s, 6) * this.amp, FOCUS);
    (u.cam!.value as THREE.Vector3).set(cx, cy, z);
    (u.rect!.value as THREE.Vector4).set(...this.rect);
    const ph = this.ctx.params.photo;
    (u.foc!.value as THREE.Vector2).set(ph.fx, ph.fy);
    u.gut!.value = this.gut;
    u.draw!.value = ease.inOutQuad(prog(t, this.tDraw, this.tColor));
    u.shade!.value = ease.inOutQuad(prog(t, this.tShade, this.tColor + 0.2));
    u.color!.value = ease.inOutQuad(prog(t, this.tColor, this.tClear - 0.25));
    u.clear!.value = ease.inOutQuad(prog(t, this.tClear - 0.4, this.tClear + 0.3));
    u.photo!.value = this.tex;
    u.edge!.value = this.edgeRT!.texture;
    u.lod!.value = photoLod(this.img!.w * (crop[2] - crop[0]), (x1 - x0) * z);
    const cap = this.cap;
    if (cap.has) {
      cap.draw(t);
      u.tl!.value = cap.L.texture;
      (u.tlR!.value as THREE.Vector4).set(this.tlX - cap.pad, this.tlY - cap.pad, cap.L.w, cap.L.h);
      u.textK!.value = cap.hasMain ? 1 : prog(t, s + 0.3, s + 0.8);
    } else { u.tl!.value = this.tex; u.textK!.value = 0; }
    u.k!.value = (0.94 + 0.06 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.06 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { ...P6_POST };
  }
}
