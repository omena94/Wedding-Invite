// 照片版面「拍立得顯影」（亮）：一張拍立得從相機吐出來、落在桌上，畫面從灰綠的藥膜慢慢顯影成新人的照片——
//  - 吐片：相機在畫面上方（看不到，只有它在桌上的影子），拍點上馬達「嗡、嗡、嗡」三下，相片一段一段往下吐；
//    下一拍相片落到桌上（從離鏡頭近的高度落下、轉一點角度、影子收緊），相機的影子跟著離開。
//  - 顯影：一開始是灰綠色、不透明的藥膜，最暗的地方先浮出來（偏冷），中間調接著，最後顏色回暖、飽和。
//  - 主字（賓客留言＋署名，或新人的註解）用馬克筆手寫在下方的白邊上（一個字一個字寫，筆尖跟著字走），寫完筆放到相片旁邊；
//    同時有歌詞時白邊放不下，歌詞寫在相片右邊的桌布上跟唱（相片往左挪，位置固定，在 HUD 上面）；
//    沒有主字時歌詞就寫在白邊上跟唱；兩個都沒有白邊就是空的（拍立得本來就這樣），相片在正中間。
//  - 相片的影像區照照片的比例（橫的寬片、直的窄片），照片完整不裁，很小的照片最多放大到原尺寸約 1.5 倍；
//    主字很長、相片又窄的時候，白邊加寬（字至少 40 px）。
//  - 鏡頭：微微斜看桌面；相片落下之後一開始快、越來越慢地往相片上的焦點推（字快出框就停），相片上的畫面也往焦點小推。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { HUD_SAFE } from '../engine/hud';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { fitText } from '../engine/text';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { focusCrop, loadWords, photoWords, settleK } from './_photo';
import { CAM_GLSL, P1_GLSL, P1Cap, gainOf, inSafe, p1Uniforms, PlaneCam, camUniforms, containScale, loadPhotos, mipFor, photoRefs, safePush, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'film', prefers: ['square', 'portrait', 'small'], energy: [0, 1], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${P1_GLSL}
  uniform sampler2D photo; uniform float lod; uniform vec4 crop;
  uniform sampler2D lyr; uniform vec4 lyrRect; uniform float lyrOn;   // 桌布上的歌詞：圖層、範圍（桌面座標 x, y, w, h）、淡入
  uniform vec3 pc; uniform float pang; uniform vec2 imgHalf; uniform vec4 bord; // 相片中心 (x, y, 高度)、角度；影像半寬高；白邊 上、左右、下
  uniform float dev; uniform float k; uniform float camSh;
  uniform sampler2D txt; uniform vec2 txtSize; uniform vec2 txtOrg;
  uniform vec4 pen; uniform float penOn; uniform float focusZ;

  // 相片的局部座標（原點在影像中心，y 向下）→ 顏色與不透明度
  vec4 printAt(vec2 lq, float l, float aa) {
    vec2 o0 = vec2(-imgHalf.x - bord.y, -imgHalf.y - bord.x), o1 = vec2(imgHalf.x + bord.y, imgHalf.y + bord.z);
    vec2 oc = (o0 + o1) * 0.5, oh = (o1 - o0) * 0.5;
    float d = sdRound(lq - oc, oh, 4.0);
    float a = 1.0 - smoothstep(-aa, aa, d);
    if (a <= 0.0) return vec4(0.0);
    // 白邊：微微的霧面紋理，邊緣一圈很細的灰
    float n = snoise(lq / 6.0) * 0.5 + 0.5;
    vec3 col = C_BONE * (0.9 + 0.02 * n);
    col *= 1.0 - 0.05 * smoothstep(-3.0, 0.0, d);
    float di = sdBox(lq, imgHalf);
    if (di < aa) {
      // 相片上的畫面往焦點小推：影像區對應到照片的 crop 那一塊
      vec2 uv = crop.xy + (lq + imgHalf) / (2.0 * imgHalf) * (crop.zw - crop.xy);
      vec3 ph = photoLin(photo, uv, l + log2(max(crop.z - crop.x, 1e-3))) * 0.84;
      // 顯影：灰綠的藥膜 → 暗部先出來（偏冷）→ 中間調 → 顏色回暖
      float lum = luma(ph);
      vec3 film = mix(C_GINGHAM, C_ASH, 0.45) * 0.55;
      float app = clamp((dev * 1.5 - pow(lum, 0.5) * 0.85) / 0.5, 0.0, 1.0);
      vec3 cold = mix(vec3(lum), ph, 0.35) * vec3(0.86, 0.95, 1.08);
      vec3 shown = mix(cold, ph, smoothstep(0.55, 1.0, dev));
      vec3 im = mix(film, shown, app);
      // 影像區的邊緣有一點藥劑的不均勻
      im *= 1.0 - 0.12 * smoothstep(-14.0, 0.0, di) * (0.6 + 0.4 * snoise(lq / 18.0));
      col = mix(col, im, 1.0 - smoothstep(-aa, aa, di));
    }
    // 馬克筆的字（白邊上）
    vec4 ink = layerAt(txt, (lq - txtOrg) / txtSize);
    col = col * (1.0 - ink.a) + ink.rgb;
    return vec4(col, a);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 hit = camHit(p, 0.0);
    vec2 q = hit.xy;
    float pxw = hit.z / camFocal;
    float blur = abs(hit.z - focusZ) / focusZ;
    float aa = pxw * (1.0 + 18.0 * blur);
    // 桌面：亞麻布（很細的經緯紋），中間亮、四周暗一點
    float weave = 0.5 + 0.25 * sin(q.x * 1.3) * sin(q.y * 1.3 + 0.5 * sin(q.x * 0.07));
    float n = fbm(q / 380.0, 3);
    vec3 col = C_PAPER * (0.83 + 0.04 * n + 0.025 * weave * (1.0 - blur * 4.0));
    col *= 1.0 - 0.14 * smoothstep(500.0, 1300.0, length(q * vec2(0.8, 1.0)));
    // 桌布上的歌詞（墨水吃進布裡：跟著桌面的透視）
    if (lyrOn > 0.0) {
      vec4 ink = layerAt(lyr, (q - lyrRect.xy) / lyrRect.zw);
      col = col * (1.0 - ink.a * lyrOn) + ink.rgb * lyrOn;
    }
    // 相機的影子（在畫面上方，吐片時在、相片落下後離開）
    vec2 cq = (q - vec2(pc.x, -620.0 - 500.0 * (1.0 - camSh))) / vec2(520.0, 260.0);
    col *= 1.0 - 0.32 * camSh * exp(-pow(dot(cq, cq), 1.4) * 1.2);
    // 相片：在高度 pc.z 的平面上（還在空中時比較大、影子比較遠比較淡）
    vec3 ph3 = camHit(p, pc.z);
    vec2 lq = rot2(pang) * (ph3.xy - pc.xy);
    // 影子：往右下，離桌面越高越遠越糊
    vec2 so = vec2(14.0, 20.0) * (1.0 + pc.z / 60.0);
    vec2 sq = rot2(pang) * (q - pc.xy - so);
    vec2 o0 = vec2(-imgHalf.x - bord.y, -imgHalf.y - bord.x), o1 = vec2(imgHalf.x + bord.y, imgHalf.y + bord.z);
    float ds = sdBox(sq - (o0 + o1) * 0.5, (o1 - o0) * 0.5);
    float sb = 14.0 + pc.z * 0.35;
    col *= 1.0 - (0.32 / (1.0 + pc.z / 160.0)) * (ds < 0.0 ? 1.0 : exp(-ds / sb));
    float paw = ph3.z / camFocal;
    vec4 pr = printAt(lq, lod + log2(max(paw, 1e-3)), paw * (1.0 + 18.0 * abs(ph3.z - focusZ) / focusZ));
    col = mix(col, pr.rgb, pr.a);
    // 馬克筆：筆尖在 pen.xy（桌面座標），筆身往右上斜；有一點高度（影子往右下）
    if (penOn > 0.0) {
      vec2 dir = vec2(cos(pen.z), sin(pen.z));
      vec3 h2 = camHit(p, 26.0 + pen.w);
      vec2 a = h2.xy - pen.xy;
      float along = dot(a, dir), side = dot(a, vec2(-dir.y, dir.x));
      vec2 sa = q - pen.xy - vec2(18.0, 26.0) * (1.0 + pen.w / 40.0);
      float salong = dot(sa, dir), sside = dot(sa, vec2(-dir.y, dir.x));
      float shd = max(abs(sside) - 15.0, max(-salong, salong - 330.0));
      col *= 1.0 - 0.28 * penOn * exp(-max(shd, 0.0) / (10.0 + pen.w * 0.3));
      // 筆身：圓柱（中間亮、兩側暗）、筆尖是錐形、尾端是訊號色的筆蓋
      float r = mix(4.0, 15.0, smoothstep(0.0, 34.0, along));
      float body = max(abs(side) - r, max(-along, along - 330.0));
      float ba = (1.0 - smoothstep(-pxw, pxw, body)) * penOn;
      float cyl = 1.0 - pow(abs(side) / max(r, 1.0), 2.0);
      vec3 pc2 = mix(C_INK2 * 1.6, C_GRAPHITE * 0.9, smoothstep(30.0, 40.0, along));
      pc2 = mix(pc2, C_SIGNAL * 0.55, smoothstep(250.0, 256.0, along));
      pc2 *= 0.55 + 0.6 * cyl;
      col = mix(col, pc2, ba);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...p1Uniforms(),
  photo: { value: null }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  lyr: { value: null }, lyrRect: { value: new THREE.Vector4(0, 0, 1, 1) }, lyrOn: { value: 0 },
  pc: { value: new THREE.Vector3() }, pang: { value: 0 }, imgHalf: { value: new THREE.Vector2() }, bord: { value: new THREE.Vector4() },
  dev: { value: 0 }, k: { value: 1 }, camSh: { value: 1 },
  txt: { value: null }, txtSize: { value: new THREE.Vector2(1, 1) }, txtOrg: { value: new THREE.Vector2() },
  pen: { value: new THREE.Vector4() }, penOn: { value: 0 }, focusZ: { value: 1700 },
  ...camUniforms(),
});

const PAD = 26;
/** 桌布上的歌詞那一欄（有主字又有歌詞時）：寬、跟相片之間的空。 */
const LYR_W = 480, LYR_GAP = 60;
/** 整張相片（含白邊）最高多少：上下留一點空，鏡頭才推得動。 */
const MAX_H = 780;
/** 字的右緣最多到哪裡（畫面 px）：白邊上的字很寬，會伸進右下角的 HUD 那一欄。 */
const TXT_RIGHT = 1340;

export default class Instant extends Scene {
  bg = shared('instant.bg', BG);
  txt!: Layer2D;
  lyr!: Layer2D;
  cam = new PlaneCam();
  seed = seedOf(this.ctx);
  ph!: P1Photo;
  /** 白邊上的字（主字；沒有主字時是歌詞）。 */
  cap!: P1Cap;
  /** 桌布上的歌詞（同一套規則，只是欄寬照桌布那一欄）。 */
  lyrText!: P1Cap;
  /** 主字寫在白邊、歌詞寫在桌布上。 */
  apart = false;
  hw = 0; hh = 0;
  /** 白邊：上、左右、下。 */
  bT = 30; bS = 30; bB = 100;
  ang = 0;
  /** 相片落定的中心 x（有桌布上的歌詞時往左挪）；歌詞圖層在桌面上的範圍 (x, y, w, h)。 */
  polX = 0;
  lyrRect = new THREE.Vector4();
  /** 吐片的三段、落下的時間；寫字。 */
  steps: number[] = []; tLand = 0; tW0 = 0; tW1 = 0;
  tDev = 0; devDur = 3;
  lastHead = { x: 0, y: 0 };

  override async init() {
    const { start, end, audio } = this.ctx;
    const [ref] = photoRefs(this.ctx, 1);
    await loadText(`${ref!.caption}${ref!.album}…`);
    await loadWords(this.ctx);
    [this.ph] = await loadPhotos(this.ctx, [ref!], (x) => this.track(x));
    const { w, h } = this.ph;
    const words = photoWords(this.ctx);
    const hasMain = words.kind !== 'none', hasText = hasMain || words.lyrics;
    // 影像區：照照片的比例；拍立得白邊（上、左右約影像短邊的 7%，下面寬）
    let s = containScale(w, h, hasText ? 840 : 940, hasText ? 540 : 660);
    this.bS = this.bT = clamp(0.075 * Math.min(w * s, h * s), 22, 40);
    let bodyW = w * s + 2 * this.bS;
    // 主字：先照相片的寬試，太長（超過三行）就把白邊加寬；只有歌詞時白邊至少放得下一句
    const probe = document.createElement('canvas').getContext('2d')!;
    let capW = bodyW - 2 * PAD;
    if (hasMain) {
      const r = fitText(probe, words.text, F.hand(400), capW, 240, { min: 40, max: 50, lineHeight: 1.3, maxLines: 4 });
      if (r.lines.length > 3 || r.height > 200 || r.width > capW + 1) { capW = Math.max(capW, 640); bodyW = capW + 2 * PAD; }
    } else if (hasText) { capW = Math.max(capW, 560); bodyW = Math.max(bodyW, capW + 2 * PAD); }
    this.txt = this.track(new Layer2D(Math.ceil(capW + 2 * PAD), 340, undefined, { fast: true }));
    const style = {
      family: F.hand(400), min: 40, max: 50, h: 290, lineHeight: 1.3, maxLines: 4, lyricsApart: true, lyricSubSize: 42,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.25), active: mixRgba('signal', 'sepia', 0.4), sigSize: 28, sigInk: rgba('sepia', 0.7),
    };
    this.cap = new P1Cap(this.ctx, this.txt.ctx, { ...style, w: capW });
    this.apart = this.cap.hasMain && this.cap.sung;
    this.lyrText = new P1Cap(this.ctx, this.txt.ctx, { ...style, w: LYR_W });
    this.lyr = this.track(new Layer2D(LYR_W + 2 * PAD, Math.ceil(this.apart ? this.lyrText.lyricH : 0) + 2 * PAD, undefined, { fast: true }));
    // 下面的白邊：拍立得的比例，或放得下字
    this.bB = Math.max(this.bS * 3.1, this.cap.has ? this.cap.height + PAD * 2 + 6 : 0);
    // 太高就把影像縮小
    const tot = h * s + this.bT + this.bB;
    if (tot > MAX_H) { s *= (MAX_H - this.bT - this.bB) / (h * s); }
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bS = Math.max(this.bS, (bodyW - 2 * this.hw) / 2);
    this.ang = ((hash(this.seed, 4) - 0.5) * 5 + 1.5) * (Math.PI / 180);
    // 桌布上的歌詞：相片右邊一欄，底對齊影像的下緣（眼睛從主字往右上就看到歌詞），整組置中。
    // 只有一塊字時相片往左挪到白邊上的字不會伸進 HUD 那一欄
    const polW = 2 * (this.hw + this.bS);
    let lyrY = this.hh - this.lyrText.lyricH - PAD;
    if (this.apart) this.polX = -(LYR_GAP + LYR_W) / 2;
    else if (this.cap.has) this.polX = Math.min(0, TXT_RIGHT - W / 2 - this.cap.width / 2);
    // 鏡頭落定、還沒推的時候：白邊上的字、桌布上的歌詞都要在字的安全範圍裡（透視會讓下面的字變寬），不夠就再挪
    for (let i = 0; i < 4 && this.cap.has; i++) {
      this.lyrRect.set(this.polX + polW / 2 + LYR_GAP - PAD, lyrY, this.lyr.w, this.lyr.h);
      this.placeCam(0, 0);
      const org = this.txtOrg(), tb = this.cam.rect(...this.worldBox([this.polX, 0], org.x + PAD, org.y + PAD, this.cap.width, this.cap.height));
      const lb = this.cam.rect(this.lyrRect.x + PAD, this.lyrRect.y + PAD, LYR_W, this.lyrText.lyricH);
      let ok = true;
      if (!this.apart && tb[0] + tb[2] > TXT_RIGHT + 2) { this.polX -= tb[0] + tb[2] - TXT_RIGHT; ok = false; }
      if (this.apart && lb[1] + lb[3] > HUD_SAFE.y - 50) { lyrY -= lb[1] + lb[3] - (HUD_SAFE.y - 50); ok = false; }
      if (ok) break;
    }
    // 吐片：拍點上三段，再下一拍落下（窗格很短就照比例壓縮）
    const len = end - start;
    if (len >= 5) {
      const b0 = beatAfter(audio, start + 0.12);
      this.steps = [0, 1, 2].map((i) => beatAfter(audio, b0, i));
      this.tLand = beatAfter(audio, b0, 3);
    } else {
      this.steps = [0.1, 0.28, 0.46].map((x) => start + x * Math.min(1, len / 3));
      this.tLand = start + 0.66 * Math.min(1, len / 3);
    }
    this.tDev = start + 0.2;
    this.devDur = clamp(len * 0.5, 1.6, 5.5);
    this.tW0 = this.tLand + 0.35;
    this.tW1 = this.tW0 + this.cap.writeDur();
  }

  /** 鏡頭：微微斜看桌面，k 是往相片上的焦點推到哪裡（目標從整組的中間移向焦點、放大）。 */
  private placeCam(lt: number, k: number) {
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1, has = this.cap.has;
    const [fx, fy] = this.focusWorld(lt, dir);
    const a = (has ? 0.45 : 0.85) * k;
    this.cam.look(lerp(dir * 8 * k, fx, a), lerp((this.bB - this.bT) / 2 + 14, fy, a), 1800 - 130 * k, (13 - 3 * k) * (Math.PI / 180), dir * 1.2 * (Math.PI / 180), 0)
      .zoomBy(1 + (has ? 0.3 : 0.38) * k);
  }

  /** 相片上的焦點在桌上的位置（相片落定之後）。 */
  private focusWorld(lt: number, dir: number): [number, number] {
    const [rx, ry] = this.restAt(lt, dir);
    const lx = (this.ph.ref.fx - 0.5) * 2 * this.hw, ly = (this.ph.ref.fy - 0.5) * 2 * this.hh;
    return [rx + Math.cos(this.ang) * lx - Math.sin(this.ang) * ly, ry + Math.sin(this.ang) * lx + Math.cos(this.ang) * ly];
  }

  /** 白邊上的字的圖層在相片局部座標的左上角（影像中心是原點）。 */
  private txtOrg() {
    return { x: -this.hw - this.bS + (2 * this.bS + 2 * this.hw - this.txt.w) / 2, y: this.hh + PAD * 0.4 };
  }

  /** 相片落定之後的中心（往一邊很慢地漂）。 */
  private restAt(lt: number, dir: number): [number, number] {
    return [this.polX + dir * 6 * ease.inOutQuad(clamp(lt / 10)), 0];
  }

  /** 相片局部座標的矩形 → 桌面上的外框（相片轉了 ang、中心在 c）。 */
  private worldBox(c: [number, number], x: number, y: number, w: number, h: number): [number, number, number, number] {
    const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
    const xs: number[] = [], ys: number[] = [];
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) { xs.push(c[0] + ca * px - sa * py); ys.push(c[1] + sa * px + ca * py); }
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.ph.ref);
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1;
    // 相片（含白邊）在局部座標的中心：影像中心往下偏（下面白邊比較寬）
    const offY = (this.bB - this.bT) / 2;
    const fullH = 2 * this.hh + this.bT + this.bB + 40;
    // 鏡頭：相片落下之後往相片上的焦點推（目標從整組的中間移向焦點、放大）；白邊上的字、桌布上的歌詞要一直在畫面裡
    const fk = settleK(t - this.tLand - 0.4, 6);
    const rest = this.restAt(lt, dir);
    const has = this.cap.has, org = this.txtOrg();
    const txtBox = this.worldBox(rest, org.x + PAD, org.y + PAD, this.cap.width, this.cap.height);
    const lyrBox: [number, number, number, number] = [this.lyrRect.x + PAD, this.lyrRect.y + PAD, LYR_W, this.lyrText.lyricH];
    safePush(fk, (k) => {
      this.placeCam(lt, k);
      return !has || (inSafe(this.cam.rect(...txtBox)) && (!this.apart || inSafe(this.cam.rect(...lyrBox))));
    });
    this.cam.apply(u);
    u.focusZ!.value = this.cam.project(this.polX, offY, 0).z;
    // 吐片：每一段往下吐三分之一（馬達的急停）；之後落到桌上
    let emerged = 0;
    for (const ts of this.steps) emerged += ease.outCubic(prog(t, ts, ts + 0.16)) / 3;
    const land = prog(t, this.tLand, this.tLand + 0.42);
    const fall = ease.inQuad(clamp(land / 0.7));
    const settle = land > 0.7 ? Math.sin(((land - 0.7) / 0.3) * Math.PI) * 4 * (1 - land) : 0;
    // 吐片時相片掛在畫面上方（出片口在畫面外）：露出的部分是 emerged
    // 出片口在畫面上緣外面一點：找出高度 160 的平面上、剛好在畫面上緣的 y
    let lo = -2500, hi = 0;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (this.cam.project(this.polX, m, 160).y < -20) lo = m; else hi = m; }
    const hangY = lo + emerged * fullH - this.hh - this.bB;
    const z = lerp(160, 0, fall) + settle;
    const cy = lerp(hangY, 0, fall);
    const ang = lerp(-dir * 0.02, this.ang, ease.outCubic(land));
    const pcx = lerp(this.polX + dir * 30, this.polX, fall) + (rest[0] - this.polX);
    (u.pc!.value as THREE.Vector3).set(pcx, cy, z);
    u.pang!.value = ang;
    (u.imgHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    (u.bord!.value as THREE.Vector4).set(this.bT, this.bS, this.bB, 0);
    u.camSh!.value = 1 - ease.inOutCubic(prog(t, this.tLand - 0.1, this.tLand + 0.6));
    u.photo!.value = this.ph.tex;
    // 相片上的畫面往焦點小推（很小的照片少推）
    (u.crop!.value as THREE.Vector4).set(...focusCrop(this.ph.ref, this.ph.w, this.ph.h, this.ph.aspect, fk, { zoom: 1.12, screenW: 2 * this.hw }));
    u.lod!.value = mipFor(this.ph.w, 2 * this.hw);
    u.dev!.value = prog(t, this.tDev, this.tDev + this.devDur, ease.inOutQuad);
    u.k!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    // 字：白邊上（局部座標：影像下緣往下）
    const L = this.txt;
    if (has) {
      const go = this.cap.hasMain ? t >= this.tW0 : t >= this.tLand;
      if (go && this.cap.draw(L.ctx, t, PAD, PAD, { chars: this.cap.charsAt(t, this.tW0, this.tW1), clear: () => L.clear() })) L.upload();
    }
    u.txt!.value = L.texture;
    (u.txtSize!.value as THREE.Vector2).set(L.w, L.h);
    (u.txtOrg!.value as THREE.Vector2).set(org.x, org.y);
    // 桌布上的歌詞：一開始就在（位置固定），淡淡地浮出來
    u.lyrOn!.value = this.apart ? prog(t, s + 0.3, s + 0.8) : 0;
    if (this.apart) {
      const M = this.lyr;
      if (this.lyrText.drawLyrics(M.ctx, t, PAD, PAD, { clear: () => M.clear() })) M.upload();
    }
    u.lyr!.value = this.lyr.texture;
    (u.lyrRect!.value as THREE.Vector4).copy(this.lyrRect);
    // 筆：跟著筆尖（局部座標 → 桌面座標）；寫完放到相片右邊
    // 筆只寫主字；唱歌詞時筆一直擱在相片旁邊（歌詞的字本來就淡淡地在，筆會擋到還沒唱的字）
    const writing = !!this.cap.fit && !!this.cap.head && t < this.tW1 + 0.1;
    if (this.cap.head && this.cap.fit) this.lastHead = this.cap.head;
    const hx = org.x + this.lastHead.x, hy = org.y + this.lastHead.y;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    // 局部 → 世界：rot2(ang) 是把世界轉到局部，反過來轉
    const wx = ca * hx - sa * hy + pcx, wy = sa * hx + ca * hy + cy;
    // 筆擱著的地方：相片右邊；右邊寫著歌詞時擱在歌詞上面（不擋字）
    const restP = this.apart ? { x: this.lyrRect.x + PAD + LYR_W * 0.35, y: Math.min(this.lyrRect.y - 60, this.hh * 0.2 - 240) } : { x: this.polX + this.hw + this.bS + 120, y: this.hh * 0.2 };
    const tEnd = this.cap.fit ? this.tW1 : this.tW0 - 1;
    const toRest = ease.inOutCubic(prog(t, tEnd + 0.1, tEnd + 0.7));
    const penIn = has ? ease.outCubic(prog(t, this.tW0 - 0.35, this.tW0)) : 0;
    const px = lerp(lerp(wx + 260, wx, penIn), restP.x, toRest), py = lerp(lerp(wy - 200, wy, penIn), restP.y, toRest);
    (u.pen!.value as THREE.Vector4).set(px, py, lerp(-0.75, -1.1, toRest), writing ? 0 : 10 * (1 - toRest));
    u.penOn!.value = has ? prog(t, this.tW0 - 0.4, this.tW0 - 0.2) * (1 - prog(t, e - 0.2, e)) : 0;
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.3 };
  }
}
