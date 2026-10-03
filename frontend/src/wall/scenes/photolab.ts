// 照片版面「沖印店信封」（亮，三張）：桌上一個沖印店的牛皮紙信封（開口朝左），印著表格——
//  - 拍點上封口的紙蓋翻開（往左翻過去，看得到紙蓋內側比較淺的牛皮紙）；下一拍一疊照片從信封口滑出來，稍微散開。
//  - 小節線上最上面那張（主角）被推到前面：從那一疊浮起來、變大、轉一點角度，落在畫面左邊；另外兩張留在信封口，被主角壓住一角。
//  - 信封上印著小小的表格（相片沖印、張數、尺寸），字是用原子筆寫在「備註」那幾條線上的（一個字一個字寫）：
//    主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號寫在下面跟唱；沒有主字時歌詞自己寫在那裡。字只放主角的。
//    兩個都沒有，備註欄空著（信封本來就有），主角照片在畫面中間偏左。
//  - 照片都有白邊、完整不裁（橫的、直的、很小的都一樣），很小的照片最多放大到原尺寸約 1.5 倍。
//  - 鏡頭：微微斜看桌面；主角落下之後一開始快、越來越慢地往主角照片上的焦點推（信封上的字快出框就停），主角照片上的畫面也往焦點小推。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter, barAfter } from './_motifs';
import { focusCrop, loadWords, settleK } from './_photo';
import { CAM_GLSL, P1_GLSL, P1Cap, gainOf, inSafe, p1Uniforms, PlaneCam, camUniforms, containScale, fitLabel, loadPhotos, mipFor, photoRefs, safePush, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, photos: 3, paper: true, family: 'photo', series: 'film', energy: [0, 1], bars: [3, 8], weight: 1 };

/** 信封（世界座標）：中心、半寬高、紙蓋長。高一點：備註欄要放得下主字＋署名＋歌詞，而且字的底要在 HUD 上面。 */
const EC = [600, -117], EW = 280, EH = 390, FLAP = 120;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${P1_GLSL}
  uniform sampler2D p0; uniform sampler2D p1; uniform sampler2D p2;
  // 每張照片：中心 xy、高度 z、角度 w；影像半寬高 xy、白邊 z、縮放 w；mip
  uniform vec4 pos[3]; uniform vec4 dim[3]; uniform vec3 lods; uniform float mainTop;
  uniform float flap; uniform sampler2D txt; uniform vec2 txtSize; uniform float k; uniform float focusZ;
  uniform vec4 crop0;   // 主角照片上的畫面往焦點小推

  vec3 photoOf(int i, vec2 uv, float l) { return i == 0 ? photoLin(p0, uv, l) : i == 1 ? photoLin(p1, uv, l) : photoLin(p2, uv, l); }

  // 一張照片（白邊＋影像）：回傳顏色與覆蓋度
  vec4 printAt(int i, vec2 p, float pxw0) {
    vec4 ps = pos[i], dm = dim[i];
    vec3 h = camHit(p, ps.z);
    vec2 lq = rot2(ps.w) * (h.xy - ps.xy) / dm.w;
    float pw = h.z / camFocal / dm.w;
    vec2 ho = dm.xy + dm.z;
    float d = sdBox(lq, ho);
    if (d > pw) return vec4(0.0);
    vec3 c = C_BONE * 0.92;
    c *= 1.0 - 0.05 * smoothstep(-3.0, 0.0, d);
    float di = sdBox(lq, dm.xy);
    if (di < pw) {
      float l = (i == 0 ? lods.x : i == 1 ? lods.y : lods.z) + log2(max(pw, 1e-3));
      vec2 uv = (lq + dm.xy) / (2.0 * dm.xy);
      if (i == 0) { uv = crop0.xy + uv * (crop0.zw - crop0.xy); l += log2(max(crop0.z - crop0.x, 1e-3)); }
      vec3 ph = photoOf(i, uv, l) * 0.84;
      // 光面相紙的一道淡淡反光
      ph += C_BONE * 0.03 * smoothstep(0.25, 0.0, abs((lq.x + lq.y * 0.7) / (2.0 * ho.x) - 0.15));
      c = mix(c, ph, 1.0 - smoothstep(-pw, pw, di));
    }
    return vec4(c, 1.0 - smoothstep(-pw, pw, d));
  }
  float shadowOf(int i, vec2 q) {
    vec4 ps = pos[i], dm = dim[i];
    vec2 so = vec2(12.0, 18.0) * (1.0 + ps.z / 50.0);
    vec2 lq = rot2(ps.w) * (q - ps.xy - so) / dm.w;
    float d = sdBox(lq, dm.xy + dm.z) * dm.w;
    return (0.28 / (1.0 + ps.z / 150.0)) * (d < 0.0 ? 1.0 : exp(-d / (9.0 + ps.z * 0.3)));
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 hit = camHit(p, 0.0);
    vec2 q = hit.xy;
    float pxw = hit.z / camFocal;
    float aa = pxw;
    // 桌面：淺色的木頭（長長的木紋）
    float grain = snoise(vec2(q.x / 900.0, q.y / 14.0)) * 0.5 + 0.5;
    float rings = sin(q.y / 26.0 + 3.0 * snoise(vec2(q.x / 600.0, q.y / 200.0)));
    vec3 col = mix(C_PAPER, C_FUR, 0.28) * (0.8 + 0.05 * grain + 0.025 * rings);
    col *= 1.0 - 0.12 * smoothstep(500.0, 1300.0, length(q));
    // 下面兩張（在信封口）
    for (int i = 2; i >= 1; i--) {
      col *= 1.0 - shadowOf(i, q);
      vec4 pr = printAt(i, p, pxw);
      col = mix(col, pr.rgb, pr.a);
    }
    // 主角還在信封裡時，畫在信封下面
    if (mainTop < 0.5) { col *= 1.0 - shadowOf(0, q); vec4 pr = printAt(0, p, pxw); col = mix(col, pr.rgb, pr.a); }
    // 信封：牛皮紙、四邊有一點立體，左邊是開口與紙蓋
    vec2 eq = q - vec2(${EC[0]}.0, ${EC[1]}.0);
    float de = sdBox(eq, vec2(${EW}.0, ${EH}.0));
    col *= 1.0 - 0.3 * exp(-max(sdBox(eq - vec2(10.0, 16.0), vec2(${EW}.0, ${EH}.0)), 0.0) / 14.0);
    vec3 kraft = mix(C_FUR, C_PAPER, 0.42) * 0.86;
    if (de < aa) {
      float fib = snoise(vec2(eq.x / 3.0, eq.y / 50.0)) * 0.5 + 0.5;
      vec3 env = kraft * (0.94 + 0.05 * fib + 0.03 * snoise(eq / 90.0));
      env *= 1.0 - 0.06 * smoothstep(-4.0, 0.0, de);
      // 印刷與手寫（同一張圖層，信封的局部座標）
      vec4 ink = layerAt(txt, (eq + vec2(${EW}.0, ${EH}.0)) / txtSize);
      env = env * (1.0 - ink.a) + ink.rgb;
      col = mix(col, env, 1.0 - smoothstep(-aa, aa, de));
    }
    // 紙蓋：鉸鏈在信封左緣；flap = 1 蓋著（往右蓋在信封上）、-1 完全翻開（往左攤在桌上）
    float fx = eq.x + ${EW}.0;           // 離鉸鏈多遠（往右是正）
    float ext = ${FLAP}.0 * flap;
    float fy = abs(eq.y) - (${EH}.0 - 10.0) + (ext > 0.0 ? fx : -fx) * 0.35;
    float inFlap = ext > 0.0 ? step(0.0, fx) * step(fx, ext) : step(ext, fx) * step(fx, 0.0);
    if (inFlap * step(fy, 0.0) > 0.0) {
      vec3 fc = ext > 0.0 ? kraft * 0.9 : kraft * 1.08;
      fc *= 1.0 - 0.1 * (1.0 - abs(flap));
      float edgeL = smoothstep(2.0 * aa, 0.0, abs(fx - ext));
      fc *= 1.0 - 0.15 * edgeL;
      col = mix(col, fc, 1.0 - smoothstep(-aa, aa, fy));
    }
    // 主角推到前面之後在最上面
    if (mainTop > 0.5) { col *= 1.0 - shadowOf(0, q); vec4 pr = printAt(0, p, pxw); col = mix(col, pr.rgb, pr.a); }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...p1Uniforms(),
  p0: { value: null }, p1: { value: null }, p2: { value: null },
  pos: { value: Array.from({ length: 3 }, () => new THREE.Vector4()) }, dim: { value: Array.from({ length: 3 }, () => new THREE.Vector4(1, 1, 0, 1)) },
  lods: { value: new THREE.Vector3() }, mainTop: { value: 0 },
  flap: { value: 1 }, txt: { value: null }, txtSize: { value: new THREE.Vector2(1, 1) }, k: { value: 1 }, focusZ: { value: 1700 },
  crop0: { value: new THREE.Vector4(0, 0, 1, 1) },
  ...camUniforms(),
});

/** 備註欄（信封圖層座標）：字的左緣、寬；「備註」那一行的基線、第一行字的頂；整塊（主字＋署名＋歌詞）的高度上限。 */
const X0 = 34, CAP_W = 2 * EW - 2 * X0, NOTE_Y = 256, TOP = 274, CAP_H = 2 * EH - TOP - 30;

export default class Photolab extends Scene {
  bg = shared('photolab.bg', BG);
  txt = this.track(new Layer2D(2 * EW, 2 * EH, undefined, { fast: true }));
  cam = new PlaneCam();
  seed = seedOf(this.ctx);
  phs: P1Photo[] = [];
  cap!: P1Cap;
  album = '';
  /** 備註欄的橫線（圖層座標的 y）：每一行字的基線下面，寫完的字下面接著畫空白的線到信封底。 */
  rules: number[] = [];
  /** 每張照片的影像半寬高、白邊（最後的大小）。 */
  dims: [number, number, number][] = [];
  mainDest = new THREE.Vector3();
  stackScale = 0.5;
  tFlap = 0; tSlide = 0; tPush = 0; tW0 = 0; tW1 = 0;
  /** 沒有字的時候表格只畫一次。 */
  formDone = false;

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx, 3);
    await loadText(`${refs[0]!.caption}${refs[0]!.album}相片沖印PHOTO FINISHING張數尺寸日期備註034×6…`);
    await loadWords(this.ctx);
    this.phs = await loadPhotos(this.ctx, refs, (x) => this.track(x));
    const c = this.txt.ctx;
    this.cap = new P1Cap(this.ctx, c, {
      family: F.hand(400), min: 40, max: 44, w: CAP_W, h: CAP_H, lineHeight: 1.25, maxLines: 6, gap: 16,
      ink: mixRgba('ink', 'blood', 0.15, 0.9), unsung: rgba('sepia', 0.25), active: mixRgba('signal', 'sepia', 0.4), sigSize: 28, sigInk: rgba('sepia', 0.75),
    });
    if (refs[0]!.chapter && refs[0]!.album) this.album = fitLabel(c, refs[0]!.album, F.hand(700), 26, CAP_W - 90, 2);
    this.rules = this.ruleLines();
    // 主角最後的大小：有字時在左邊（信封在右邊）；很小的照片最多放大 1.5 倍
    this.dims = this.phs.map((p, i) => {
      const s = i === 0 ? containScale(p.w, p.h, 860, 640) : containScale(p.w, p.h, 440, 440);
      const hw = (p.w * s) / 2, hh = (p.h * s) / 2;
      return [hw, hh, clamp(0.045 * Math.min(hw, hh) * 2, 12, 28)];
    });
    const [mw, mh, mb] = this.dims[0]!;
    // 信封左緣在 x = EC.x - EW：主角放在它左邊、置中於剩下的空間
    this.mainDest.set(Math.min(-260, EC[0]! - EW - 50 - mw - mb - 40), -20, (hash(this.seed, 5) - 0.5) * 0.04 - 0.02);
    this.stackScale = 420 / (2 * Math.max(mw, mh));
    const len = end - start;
    if (len < 5) { this.tFlap = start + 0.1; this.tSlide = start + 0.45; this.tPush = start + 0.85; }
    else {
      this.tFlap = beatAfter(audio, start + 0.1);
      this.tSlide = beatAfter(audio, this.tFlap, 1);
      this.tPush = Math.min(barAfter(audio, this.tSlide + 0.3), end - 2.2);
      if (this.tPush < this.tSlide + 0.4) this.tPush = this.tSlide + 0.5;
    }
    this.tW0 = start + Math.min(0.8, len * 0.15);
    this.tW1 = this.tW0 + this.cap.writeDur();
  }

  /** 備註欄每一條橫線的 y：主字每一行、署名、歌詞（預留的行數）的基線下面，之後照主字的行距排到信封底。 */
  private ruleLines(): number[] {
    const cap = this.cap, out: number[] = [];
    const under = (y: number) => out.push(Math.round(y + 12));
    let step = 54;
    if (cap.fit) {
      const f = cap.fit;
      step = f.lineHeight;
      f.lines.forEach((_, i) => under(TOP + f.size * 0.9 + i * f.lineHeight));
      if (cap.sigH) under(TOP + f.height + cap.sigH - cap.sigSize * 0.12);
    }
    if (cap.sung) {
      const ls = cap.lyricSize, lh = ls * 1.22;
      const n = Math.max(1, Math.round((cap.lyricH - ls) / lh) + 1);
      if (!cap.fit) step = lh;
      for (let j = 0; j < Math.min(n, 2); j++) under(TOP + cap.lyricTop + ls * 0.9 + j * lh);
    }
    // 沒有字（或字很少）：備註欄照樣是幾條空白的線
    let y = out.length ? out[out.length - 1]! : TOP + 40;
    if (!out.length) out.push(y);
    while ((y += step) < 2 * EH - 20) out.push(Math.round(y));
    return out;
  }

  /** 信封上的印刷（每次重畫字的時候一起畫）：表格、備註欄的橫線。 */
  private drawForm() {
    const L = this.txt, c = L.ctx;
    L.clear();
    c.fillStyle = mixRgba('collar', 'sepia', 0.15, 0.85);
    c.fillRect(0, 34, L.w, 54);
    c.font = font(F.hei(700), 26);
    c.letterSpacing = '10px';
    c.fillStyle = rgba('paper', 0.95);
    c.fillText('相片沖印', X0, 72);
    c.letterSpacing = '3px';
    c.font = font(F.mono(500), 16);
    c.fillStyle = rgba('sepia', 0.75);
    c.fillText('PHOTO FINISHING', X0, 120);
    c.letterSpacing = '0px';
    c.font = font(F.hei(500), 20);
    c.fillStyle = rgba('sepia', 0.8);
    // 張數、尺寸同一行，日期下一行（表格壓扁一點，備註欄才寫得下）
    const rows: [string, string, number, number][] = [['張數', '03', X0, 166], ['尺寸', '4×6', X0 + 250, 166], ['日期', '', X0, 210]];
    for (const [k2, v, x, y] of rows) {
      c.fillText(k2, x, y);
      c.fillRect(x + 60, y + 6, 160, 1.5);
      if (v) { c.font = font(F.hand(400), 26); c.fillText(v, x + 80, y); c.font = font(F.hei(500), 20); }
    }
    c.fillText('備註', X0, NOTE_Y);
    c.fillStyle = rgba('sepia', 0.35);
    for (const y of this.rules) c.fillRect(X0, y, CAP_W, 1.5);
    if (this.album) { c.font = font(F.hand(700), 26); c.fillStyle = rgba('ink', 0.75); c.fillText(this.album, X0 + 70, NOTE_Y); }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, e = this.ctx.end;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.phs[0]!.ref);
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1;
    const main = this.phs[0]!, [mw, mh] = this.dims[0]!;
    // 焦點（主角落下之後）：主角照片上的畫面往焦點小推，鏡頭往主角照片上焦點那一點推（信封上的字要一直在畫面裡）
    const fk = settleK(t - this.tPush - 0.9, 6);
    const lx = (main.ref.fx - 0.5) * 2 * mw, ly = (main.ref.fy - 0.5) * 2 * mh;
    const ca = Math.cos(this.mainDest.z), sa = Math.sin(this.mainDest.z);
    const fwx = this.mainDest.x + ca * lx - sa * ly, fwy = this.mainDest.y + sa * lx + ca * ly;
    const has = this.cap.has;
    const capRect: [number, number, number, number] = [EC[0]! - EW + X0, EC[1]! - EH + TOP, this.cap.width, this.cap.height];
    safePush(fk, (k) => {
      const a = (has ? 0.35 : 0.75) * k;
      this.cam.look(lerp(60 + dir * 10 * k, fwx, a), lerp(0, fwy, a), 1850 - 150 * k, (14 - 3 * k) * (Math.PI / 180), dir * 1.2 * (Math.PI / 180), 0)
        .zoomBy(1 + (has ? 0.25 : 0.32) * k);
      return !has || inSafe(this.cam.rect(...capRect));
    });
    this.cam.apply(u);
    u.focusZ!.value = this.cam.project(0, 0, 0).z;
    (u.crop0!.value as THREE.Vector4).set(...focusCrop(main.ref, main.w, main.h, main.aspect, fk, { zoom: 1.12, screenW: 2 * mw }));
    // 紙蓋翻開：1（蓋著）→ -1（攤開）
    u.flap!.value = Math.cos(Math.PI * ease.inOutCubic(prog(t, this.tFlap, this.tFlap + 0.45)));
    // 照片：在信封裡（被信封蓋住）→ 滑出來散開 → 主角被推到前面
    const slide = ease.outExpo(prog(t, this.tSlide, this.tSlide + 0.5));
    const pk = prog(t, this.tPush, this.tPush + 0.9);
    const pm = ease.inOutCubic(pk);
    const lift = Math.sin(Math.PI * Math.min(1, pk)) * 120;
    const ss = this.stackScale;
    const posV = u.pos!.value as THREE.Vector4[], dimV = u.dim!.value as THREE.Vector4[];
    const inside = EC[0]! + 40, outX = EC[0]! - EW - 150;
    for (let i = 0; i < 3; i++) {
      const [hw, hh, b] = this.dims[i]!;
      // 疊在一起的位置（主角在最上面）：散開一點、角度不一樣
      const fan = i === 0 ? [0, 0, -0.03] : i === 1 ? [-50, 150, 0.1] : [50, -120, -0.12];
      const sx = lerp(inside, outX + fan[0]!, slide), sy = EC[1]! + 40 + fan[1]! * slide;
      const sc = i === 0 ? ss * (2 * Math.max(mw, mh)) / (2 * Math.max(hw, hh)) : 420 / (2 * Math.max(hw, hh));
      if (i === 0) {
        posV[0]!.set(lerp(sx, this.mainDest.x, pm), lerp(sy, this.mainDest.y, pm), lift + (pk > 0 && pk < 1 ? 4 : 0), lerp(fan[2]!, this.mainDest.z, pm));
        dimV[0]!.set(hw, hh, b, lerp(sc, 1, ease.outCubic(pk)));
      } else {
        posV[i]!.set(sx, sy, 0, fan[2]! * slide + (i === 1 ? 0.04 : -0.05));
        dimV[i]!.set(hw, hh, b, sc);
      }
    }
    u.mainTop!.value = pk > 0.15 ? 1 : 0;
    const ph = this.phs;
    u.p0!.value = ph[0]!.tex; u.p1!.value = ph[1]!.tex; u.p2!.value = ph[2]!.tex;
    const lodOf = (i: number) => mipFor(ph[i]!.w, 2 * this.dims[i]![0] * (dimV[i]!.w));
    (u.lods!.value as THREE.Vector3).set(lodOf(0), lodOf(1), lodOf(2));
    // 信封上的表格與手寫
    const L = this.txt;
    if (has) { if (this.cap.draw(L.ctx, t, X0, TOP, { chars: this.cap.charsAt(t, this.tW0, this.tW1), clear: () => this.drawForm() })) L.upload(); }
    else if (!this.formDone) { this.drawForm(); L.upload(); this.formDone = true; }
    u.txt!.value = L.texture;
    (u.txtSize!.value as THREE.Vector2).set(L.w, L.h);
    u.k!.value = 1 - 0.08 * prog(t, e - 0.3, e);
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.3 };
  }
}
