// 照片版面「8mm 家庭電影」（暗）：老放映機把照片投在一條晾起來的床單上，像小時候在客廳看家庭電影——
//  - 床單用夾子夾在一條繩子上，有幾道直直的皺褶、被風吹得慢慢晃；投影跟著皺褶起伏（亮暗與一點點位移）。
//  - 8mm 的味道（每秒 18 格，用歌曲時間算，畫兩次一樣）：片門晃動（每格偏一兩 px，偶爾整格跳一下）、亮度閃爍、
//    一兩道會移動的直刮痕、每格不一樣的灰塵與毛髮；顏色褪成暖暖的柯達色、黑不夠黑、四角暗、畫面有點軟。
//    片門左邊露出一個亮亮的齒孔（光從孔裡漏出來），跟著片門晃。
//  - 開場是片頭：一兩拍燒白的片頭閃爍，再從過曝退回正常的影像；最後零點三秒片尾又燒白一下。
//  - 片門照照片的比例（最窄 4:3，直的照片放在 4:3 的片門裡、兩邊是暗的片基），照片完整不裁，很小的照片最多放大約 1.5 倍。
//  - 字像老電影字幕：燒在片子上（跟著片門晃、跟著閃爍），思源宋體、置中、在片門下方，字後面很淡地壓暗：
//    主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在最下面跟唱；沒有主字時歌詞自己當字幕；兩個都沒有就只有影像。
//  - 鏡頭：很慢地推近、一點點手持的漂移；片門裡的畫面往焦點推（投影：focusCrop）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { ease, hash, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { focusCrop, loadWords, settleK } from './_photo';
import { P1_GLSL, P1Cap, gainOf, p1Uniforms, containScale, loadPhotos, photoRefs, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'film', prefers: ['landscape', 'small'], energy: [0, 0.75], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P1_GLSL}
  uniform sampler2D photo; uniform float lod;
  uniform vec2 gc; uniform vec2 gh; uniform vec2 ih;           // 片門中心、片門半寬高、影像半寬高（畫面 px，鏡頭推近前）
  uniform vec2 weave; uniform float flick; uniform float burn; uniform float fr; uniform float t;
  uniform float zoom; uniform vec2 zc; uniform vec2 sheetH; uniform float subShade; uniform float subTop; uniform float k;
  uniform vec4 crop;   // 片門裡的畫面往焦點推：影像區對應到照片的哪一塊

  // 床單的皺褶：幾道直的、往下慢慢散開，被風吹得晃（回傳位移，x 是皺褶的「深度」）
  float fold(vec2 p) {
    float y = (p.y - (gc.y - sheetH.y)) / (2.0 * sheetH.y);
    float d = 0.0;
    d += sin(p.x / 140.0 + 0.6 * sin(t * 0.35) + y * 0.8) * 7.0;
    d += sin(p.x / 61.0 + 1.7 + 0.9 * sin(t * 0.27 + 1.0)) * 3.0 * (0.4 + y);
    d += sin(p.x / 23.0 + y * 3.0 + t * 0.2) * 0.8;
    return d;
  }

  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = zc + (p0 - zc) / zoom;
    // 牆：很暗
    vec3 col = C_INK * 1.1 + C_INK2 * 0.2 * (0.5 + 0.5 * snoise(p / 400.0));
    // 床單：比投影大一圈，上緣夾在繩子上（中間微微下垂）
    float sag = 10.0 * (1.0 - pow((p.x - gc.x) / sheetH.x, 2.0));
    vec2 sq = p - gc - vec2(0.0, sag * 0.5);
    float dSheet = sdBox(sq, sheetH);
    float fd = fold(p);
    float shade = clamp(1.0 + (fold(p + vec2(2.0, 0.0)) - fd) * 0.9, 0.7, 1.25);
    if (dSheet < 1.0) {
      // 床單本身只被投影溢出的光照到一點點（越靠近片門越亮），下緣與兩側往外暗下去
      float near = exp(-max(sdBox(p - gc, gh), 0.0) / 220.0);
      vec3 sheet = C_BONE * (0.004 + 0.016 * near) * shade * (0.9 + 0.1 * snoise(p / vec2(4.0, 60.0)));
      // 投影：片門晃動、皺褶讓影像跟著起伏
      vec2 q = p - gc - weave - vec2(fd * 0.9, 0.0);
      float dg = sdRound(q, gh, min(gh.x, gh.y) * 0.08);
      float gate = 1.0 - smoothstep(-6.0, 6.0, dg);
      vec3 img = vec3(0.0);
      if (gate > 0.0) {
        // 片基（影像外的片門裡）：一點點暖色的霧
        img = vec3(0.05, 0.035, 0.022);
        float di = sdBox(q, ih);
        if (di < 1.0) {
          vec2 uv = crop.xy + (q + ih) / (2.0 * ih) * (crop.zw - crop.xy);
          vec3 ph = photoLin(photo, uv, lod + log2(max(crop.z - crop.x, 1e-3)));
          // 褪色的柯達色：飽和度降一點、暖一點、黑浮起來
          float L = luma(ph);
          ph = mix(vec3(L), ph, 0.82) * vec3(1.06, 0.98, 0.84);
          ph = ph * 0.86 + vec3(0.03, 0.022, 0.015);
          img = mix(img, ph, 1.0 - smoothstep(-1.0, 1.0, di));
        }
        // 片門裡的暗角
        vec2 vq = q / gh;
        img *= 1.0 - 0.45 * smoothstep(0.4, 1.25, length(vq * vec2(0.9, 1.0)));
        // 刮痕：一兩道直線（亮的是片基被刮破、暗的是乳劑上的髒）
        for (int i = 0; i < 2; i++) {
          float fi = float(i);
          float sx = (hash11(floor(t * 0.7 + fi * 3.1) + fi * 17.0) - 0.5) * 1.6 * gh.x + sin(t * 1.3 + fi) * 6.0;
          float on = step(0.35, hash11(fr * 0.37 + fi * 5.0));
          float ln = exp(-pow((q.x - sx) / 1.3, 2.0)) * on;
          img += (i == 0 ? vec3(0.22, 0.2, 0.17) : -img * 0.5) * ln;
        }
        // 灰塵與毛髮：每格換一批
        for (int i = 0; i < 5; i++) {
          float fi = float(i);
          vec2 dp = (hash22(vec2(fr, fi * 7.3)) - 0.5) * gh * 1.8;
          float r = 1.5 + 3.5 * hash11(fr + fi * 13.0);
          float ds = length(q - dp) - r;
          float hair = abs(sin((q.x - dp.x) / 40.0 + fi) * 30.0 - (q.y - dp.y)) - 0.8;
          float isHair = step(0.8, hash11(fr * 1.7 + fi));
          float dd = mix(ds, max(hair, abs(q.x - dp.x) - 70.0), isHair);
          img *= 1.0 - 0.75 * (1.0 - smoothstep(0.0, 1.2, dd));
        }
        // 燒白（片頭片尾）：過曝成暖白，帶一點閃
        img = mix(img, vec3(0.86, 0.72, 0.5) * (0.85 + 0.15 * hash11(fr)), burn);
        // 字幕的後面很淡地壓暗（從字整塊的頂往下）
        img *= 1.0 - subShade * 0.62 * smoothstep(subTop - 120.0, subTop + 60.0, q.y);
        img *= flick;
      }
      // 齒孔：片門左邊外面，光從孔裡漏出來（跟著片門晃）
      vec2 hq = q - vec2(-gh.x - gh.y * 0.11, -gh.y * 0.62);
      float hole = sdRound(hq, vec2(gh.y * 0.05, gh.y * 0.065), gh.y * 0.02);
      vec3 holeL = vec3(0.62, 0.55, 0.42) * flick * (1.0 - smoothstep(-3.0, 5.0, hole)) * (1.0 - burn * 0.5);
      // 投影的光很軟地溢出片門（床單上的一圈）
      float spill = exp(-max(dg, 0.0) / 40.0) * (1.0 - gate);
      sheet += vec3(0.6, 0.5, 0.38) * 0.02 * spill * flick;
      sheet += img * gate * shade + holeL * shade;
      col = mix(col, sheet, 1.0 - smoothstep(-1.0, 1.0, dSheet));
    }
    // 繩子與夾子
    float ropeY = gc.y - sheetH.y + sag * 0.5 - 4.0;
    col = mix(col, C_GRAPHITE * 0.12, (1.0 - smoothstep(1.0, 2.5, abs(p.y - ropeY))));
    for (int i = 0; i < 4; i++) {
      float cx = gc.x - sheetH.x * 0.85 + float(i) * sheetH.x * 0.567;
      float cp = sdRound(p - vec2(cx, ropeY + 6.0), vec2(6.0, 20.0), 3.0);
      col = mix(col, C_FUR * 0.05, 1.0 - smoothstep(-1.0, 1.0, cp));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...p1Uniforms(),
  photo: { value: null }, lod: { value: 0 },
  gc: { value: new THREE.Vector2() }, gh: { value: new THREE.Vector2() }, ih: { value: new THREE.Vector2() },
  weave: { value: new THREE.Vector2() }, flick: { value: 1 }, burn: { value: 0 }, fr: { value: 0 }, t: { value: 0 },
  zoom: { value: 1 }, zc: { value: new THREE.Vector2(W / 2, H / 2) }, sheetH: { value: new THREE.Vector2() }, subShade: { value: 0 }, subTop: { value: 0 }, k: { value: 1 },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) },
});

/** 字幕整塊（主字＋署名＋歌詞）的寬、高上限（片門下方，置中）；圖層四邊多留 PAD（字的軟影、片門晃動）。 */
const CAP_W = 1000, CAP_H = 290, PAD = 40;
/** 字幕整塊的底離片門下緣多遠。 */
const SUB_BOTTOM = 46;

export default class Homemovie extends Scene {
  bg = shared('homemovie.bg', BG);
  txt!: Layer2D;
  seed = seedOf(this.ctx);
  ph!: P1Photo;
  cap!: P1Cap;
  gh = new THREE.Vector2(); ih = new THREE.Vector2(); gc = new THREE.Vector2(W / 2, 470);
  /** 字幕整塊的頂（畫面 px，鏡頭推近前）。 */
  capTop = 0;
  tLead = 0;

  override async init() {
    const { start, audio } = this.ctx;
    const [ref] = photoRefs(this.ctx, 1);
    await loadText(`${ref!.caption}${ref!.album}…`);
    await loadWords(this.ctx);
    [this.ph] = await loadPhotos(this.ctx, [ref!], (x) => this.track(x));
    const { w, h, aspect } = this.ph;
    // 片門：照照片的比例，最窄 4:3；高最多 720、寬最多 1400；很小的照片最多放大 1.5 倍
    const ga = Math.max(aspect, 4 / 3);
    let gH = Math.min(720, 1400 / ga);
    const sImg = containScale(w, h, gH * ga, gH);
    // 照片很小：片門跟著縮（影像撐滿片門的高或寬）
    const iw = w * sImg, ihh = h * sImg;
    if (aspect >= 4 / 3) gH = ihh; else gH = Math.max(ihh, iw / ga);
    this.gh.set((gH * ga) / 2, gH / 2);
    this.ih.set(iw / 2, ihh / 2);
    // 字幕：寬不超過片門（兩邊留一點），高不超過片門的四成多（老電影的字幕在下面，不蓋住整個畫面）
    const cw = Math.min(CAP_W, 2 * this.gh.x - 120), ch = Math.min(CAP_H, gH * 0.46);
    this.txt = this.track(new Layer2D(Math.ceil(cw) + 2 * PAD, Math.ceil(ch) + 2 * PAD + 40, undefined, { fast: true }));
    this.cap = new P1Cap(this.ctx, this.txt.ctx, {
      family: F.ming(500), min: 40, max: 46, w: cw, h: ch, lineHeight: 1.35, maxLines: 3, align: 'center', tracking: 2, gap: 20,
      ink: rgba('bone', 0.95), unsung: rgba('bone', 0.38), sigInk: rgba('bone', 0.78), sigSize: 28,
      shadow: { color: rgba('ink', 0.9), blur: 14 },
    });
    this.gc.set(W / 2, this.cap.has ? 455 : 490);
    this.capTop = this.gc.y + this.gh.y - SUB_BOTTOM - this.cap.height;
    this.tLead = Math.min(beatAfter(audio, start + 0.25), start + 0.7);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.ph.ref);
    // 每秒 18 格的片子：格號決定晃動、閃爍、灰塵
    const fr = Math.floor(t * 18);
    const jump = hash(fr >> 5, this.seed) < 0.25 && (fr & 31) < 2 ? (hash(fr, 9) - 0.5) * 18 : 0;
    const wx = (hash(fr, 1) - 0.5) * 3 + Math.sin(t * 1.7) * 1.5;
    const wy = (hash(fr, 2) - 0.5) * 4 + jump;
    const flick = 0.93 + 0.07 * hash(fr, 3) - 0.04 * Math.max(0, Math.sin(t * 9.3));
    // 片頭：燒白閃兩下，第一拍之後從過曝退回影像；片尾燒白
    let burn = 0;
    if (t < this.tLead) burn = 0.65 + 0.35 * hash(fr, 4);
    else burn = 1 - ease.outCubic(prog(t, this.tLead, this.tLead + 0.5));
    burn = Math.max(burn, ease.inCubic(prog(t, e - 0.3, e)));
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1;
    const zoom = 1 + 0.045 * (1 - Math.exp(-lt / 7));
    // 片門裡的畫面往焦點推（片頭燒白退掉之後開始，很小的照片少推）
    const fk = settleK(t - this.tLead, 6);
    const crop = focusCrop(this.ph.ref, this.ph.w, this.ph.h, this.ph.aspect, fk, { zoom: 1.26, screenW: 2 * this.ih.x * zoom });
    u.photo!.value = this.ph.tex;
    (u.crop!.value as THREE.Vector4).set(...crop);
    // 8mm 比較軟：多取半層 mip
    u.lod!.value = Math.max(0, Math.log2(this.ph.w / (2 * this.ih.x * zoom * SCALE))) + 0.6;
    (u.gc!.value as THREE.Vector2).copy(this.gc);
    (u.gh!.value as THREE.Vector2).copy(this.gh);
    (u.ih!.value as THREE.Vector2).copy(this.ih);
    (u.weave!.value as THREE.Vector2).set(wx, wy);
    u.flick!.value = flick;
    u.burn!.value = burn;
    u.fr!.value = fr % 997;
    u.t!.value = t;
    u.zoom!.value = zoom;
    (u.zc!.value as THREE.Vector2).set(this.gc.x + dir * 40 * Math.sin(lt * 0.21), this.gc.y + 10 * Math.sin(lt * 0.17 + 1));
    (u.sheetH!.value as THREE.Vector2).set(this.gh.x + 150, this.gh.y + 110);
    u.subShade!.value = this.cap.has ? 1 : 0;
    u.subTop!.value = this.capTop - this.gc.y;
    u.k!.value = ease.outCubic(prog(t, s, s + 0.12));
    this.bg.render(renderer, out);
    if (this.cap.has) {
      // 字幕燒在片子上：跟著片門晃、跟著閃爍與燒白，跟著鏡頭推近
      const L = this.txt;
      if (this.cap.draw(L.ctx, t, L.w / 2, PAD, { clear: () => L.clear() })) L.upload();
      const zc = u.zc!.value as THREE.Vector2;
      const top = this.capTop - PAD;
      const x = zc.x + (W / 2 - L.w / 2 + wx - zc.x) * zoom, y = zc.y + (top + wy - zc.y) * zoom;
      const op = prog(t, this.tLead + 0.2, this.tLead + 0.6) * flick * (1 - burn);
      comp.draw(renderer, L.texture, out, { opacity: op, scale: [W / L.w / zoom, H / L.h / zoom], offset: [0.5 * W / L.w / zoom - 0.5 - x / L.w / zoom, 0.5 + y / L.h / zoom - 0.5 * H / L.h / zoom] });
    }
    return { bloom: 0.15, bloomThreshold: 1.1, halation: 0.22, vignette: 0.6, grain: 0.075 };
  }
}
