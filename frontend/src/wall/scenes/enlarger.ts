// 照片版面「放大機」（暗）：暗房的放大機底板上，一個相紙夾（有兩片可以滑動的遮光尺）——
//  - 一開始只有紅色的安全燈，底板、相紙夾、旁邊的計時器與一張索引卡都暗暗的。
//  - 拍點上放大機的燈打開：照片從上面投到相紙上（中間亮、邊緣暗、空氣裡有一點光霧），一開始是糊的；
//    接著三拍一拍一拍地轉對焦鈕，影像一段一段對清楚。同時兩片 L 形的遮光尺滑進來，把照片框出白邊。
//  - 小節線上曝光：燈再亮一點，計時器的數字往下數，一支加光遮光棒（細鐵絲上的小圓片）在影像上繞小圈，影子跟著晃。
//  - 曝光結束燈熄掉，房間的燈慢慢亮起：相紙上留下印好的照片（白邊、紙的質感、顏色是對的）。
//  - 字用鉛筆寫在相紙夾右邊的一張索引卡上（橫線、最上面一條紅線），一個字一個字寫：主字（賓客留言＋署名，或新人的註解）在上，
//    歌詞小一號寫在下面跟唱；沒有主字時歌詞自己寫在卡片上。卡片跟著字變高，橫線畫在每一行字的下面。
//    相簿的第一張在卡片最上面寫相簿名。兩個都沒有就沒有卡片，相紙夾在正中間。計時器在卡片上方的底板上。
//  - 照片完整投在相紙上（不裁），很小的照片最多放大到原尺寸約 1.5 倍。投影的畫面往焦點推（像把放大機頭再升高一點），
//    鏡頭也往相紙上的焦點推（有卡片時推到卡片快出框就停）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { HUD_SAFE } from '../engine/hud';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter, barAfter } from './_motifs';
import { focusCrop, loadWords, settleK } from './_photo';
import { CAM_GLSL, P1_GLSL, P1Cap, gainOf, inSafe, p1Uniforms, PlaneCam, camUniforms, containScale, fitLabel, loadPhotos, mipFor, photoRefs, safePush, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'film', energy: [0, 0.85], bars: [3, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${P1_GLSL}
  uniform sampler2D photo; uniform float lod; uniform vec4 crop;
  uniform vec2 imgHalf; uniform vec2 paperHalf; uniform float blade;    // 影像、相紙半寬高；遮光尺滑進來的程度
  uniform float lamp; uniform float blur; uniform float printed; uniform float room; uniform vec3 wand;
  uniform vec2 cardC; uniform vec2 cardHalf; uniform float cardAng; uniform float cardOn;
  uniform sampler2D txt; uniform vec2 txtSize; uniform sampler2D tmr; uniform vec2 tmrC; uniform vec2 tmrSize;
  uniform float k; uniform float focusZ;

  vec3 projAt(vec2 q, float l) {
    // 投影的畫面往焦點推：影像區對應到照片的 crop 那一塊
    vec2 uv = crop.xy + (q + imgHalf) / (2.0 * imgHalf) * (crop.zw - crop.xy);
    return photoLin(photo, uv, l + log2(max(crop.z - crop.x, 1e-3)));
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 hit = camHit(p, 0.0);
    vec2 q = hit.xy;
    float pxw = hit.z / camFocal;
    float bl = abs(hit.z - focusZ) / focusZ;
    float aa = pxw * (1.0 + 16.0 * bl);
    // 放大機旁邊用的是琥珀色的安全燈（跟顯影盤那邊的深紅不一樣）
    vec3 amber = mix(C_COLLAR, C_FUR, 0.6);
    amber /= max(amber.r, 0.01);
    // 環境光：安全燈 → 房間的燈（暖白）
    vec3 amb = mix(amber * 0.1, vec3(1.0, 0.92, 0.8) * 0.5, room);
    // 底板：深灰的美耐板，很淡的紋理
    vec3 base = mix(C_INK2, C_GRAPHITE, 0.12) * (0.9 + 0.1 * fbm(q / 300.0, 2));
    vec3 col = base * amb * 2.2;
    // 相紙夾：金屬底座（比相紙大一圈）
    vec2 eh = paperHalf + vec2(70.0, 70.0);
    float de = sdRound(q, eh, 12.0);
    col *= 1.0 - 0.5 * exp(-max(sdRound(q - vec2(-14.0, 22.0), eh, 12.0), 0.0) / 24.0);
    vec3 surf = col;
    float onE = 1.0 - smoothstep(-aa, aa, de);
    // 投影的範圍：影像加一點點片框外的光（片夾的邊）
    vec2 projH = imgHalf + 26.0;
    float dProj = sdBox(q, projH);
    float inProj = 1.0 - smoothstep(-3.0 - blur * 30.0, 3.0 + blur * 30.0, dProj);
    vec2 pq = q / projH;
    float hot = 1.0 - 0.28 * dot(pq, pq);
    // 加光遮光棒的影子（棒子在半空中，影子很軟）
    float wsh = 1.0 - 0.75 * wand.z * (1.0 - smoothstep(30.0, 110.0, length(q - wand.xy)));
    wsh *= 1.0 - 0.6 * wand.z * (1.0 - smoothstep(2.0, 10.0, abs(dot(q - wand.xy, vec2(0.6, -0.8))))) * step(0.0, dot(q - wand.xy, vec2(0.8, 0.6)));
    vec3 lampC = vec3(1.0, 0.86, 0.66);
    if (onE > 0.0) {
      vec3 easel = mix(C_GRAPHITE, C_ASH, 0.25) * 0.5;
      easel *= 0.85 + 0.15 * smoothstep(-eh.y, eh.y, -q.y);
      vec3 e = easel * amb * 2.0;
      // 相紙
      float dp = sdBox(q, paperHalf);
      vec3 paperC = C_BONE * 0.86 * (0.97 + 0.03 * snoise(q / 5.0));
      if (dp < aa) e = mix(e, paperC * amb * 2.0, 1.0 - smoothstep(-aa, aa, dp));
      // 投影（燈開著）：照片 × 燈光 × 熱點，焦點沒對好時糊
      float l = lod + log2(max(pxw, 1e-3)) + blur * 4.0;
      vec3 pr = projAt(q, l);
      if (blur > 0.03) {
        float r = blur * 22.0;
        pr = pr * 0.4 + 0.15 * (projAt(q + vec2(r, 0.0), l) + projAt(q - vec2(r, 0.0), l) + projAt(q + vec2(0.0, r), l) + projAt(q - vec2(0.0, r), l));
      }
      float inImg = 1.0 - smoothstep(-1.0 - blur * 20.0, 1.0 + blur * 20.0, sdBox(q, imgHalf));
      // 片框外漏的光（影像外、投影範圍裡）
      vec3 light = mix(lampC * 0.75, pr * 0.82 * lampC * 1.15, inImg) * hot * inProj * lamp * wsh;
      // 遮光尺：兩片 L 形，從外面滑到影像的邊（左上那片、右下那片）
      float bw = 64.0;
      vec2 off = vec2(1.0 - blade) * 120.0;
      vec2 a0 = -imgHalf - off, a1 = imgHalf + off;
      // 左上的 L：在影像左邊與上面
      float dL1 = min(sdBox(q - vec2(a0.x - bw * 0.5, 0.0), vec2(bw * 0.5, paperHalf.y + 30.0)), sdBox(q - vec2(0.0, a0.y - bw * 0.5), vec2(paperHalf.x + 30.0, bw * 0.5)));
      float dL2 = min(sdBox(q - vec2(a1.x + bw * 0.5, 0.0), vec2(bw * 0.5, paperHalf.y + 30.0)), sdBox(q - vec2(0.0, a1.y + bw * 0.5), vec2(paperHalf.x + 30.0, bw * 0.5)));
      float dB = min(dL1, dL2);
      // 印好的照片（燈熄之後）：影像在相紙上、白邊是遮光尺擋住的地方
      vec3 printC = mix(paperC, projAt(q, lod + log2(max(pxw, 1e-3))) * 0.82, inImg) * mix(amb * 2.0, vec3(1.0, 0.95, 0.88) * 0.95, room);
      if (dp < aa) e = mix(e, mix(e, printC, printed), 1.0 - smoothstep(-aa, aa, dp));
      e += light * (1.0 - printed) * step(dp, 0.0);
      if (dB < aa) {
        // 遮光尺：黑色的金屬，上面有白色的刻度；被燈照到的地方亮一點
        vec3 bc = C_INK2 * 1.3 * amb * 3.0 + vec3(0.05) * light;
        // 刻度：左邊那片沿著 y、上面那片沿著 x，貼著內緣
        float tick = max(step(0.86, fract(q.y / 18.0)) * step(abs(q.x - a0.x + 9.0), 7.0) * step(q.y, a1.y),
                         step(0.86, fract(q.x / 18.0)) * step(abs(q.y - a0.y + 9.0), 7.0) * step(q.x, a1.x));
        bc += C_BONE * 0.12 * tick * (amb.r * 2.0 + lamp * 0.5);
        e = mix(e, bc, (1.0 - smoothstep(-aa, aa, dB)) * blade);
      }
      surf = mix(col, e, onE);
    }
    col = surf;
    // 燈開著時，底板上也有一圈溢出的光
    col += lampC * 0.015 * lamp * exp(-max(dProj, 0.0) / 200.0) * (1.0 - printed);
    // 索引卡（右邊）：白卡、最上面一條紅線；橫線跟鉛筆字畫在同一張圖層（線要在每一行字下面）
    if (cardOn > 0.0) {
      vec2 cq = rot2(cardAng) * (q - cardC);
      float dc = sdBox(cq, cardHalf);
      col *= 1.0 - 0.4 * cardOn * exp(-max(sdBox(cq - vec2(-8.0, 12.0), cardHalf), 0.0) / 12.0);
      if (dc < aa) {
        vec3 card = C_BONE * 0.84 * (0.97 + 0.03 * snoise(cq / 4.0));
        float ly = cq.y + cardHalf.y;
        card = mix(card, C_COLLAR * 0.8, (1.0 - smoothstep(0.8, 1.6, abs(ly - 84.0))) * 0.6);
        vec4 ink = layerAt(txt, (cq + cardHalf) / txtSize);
        card = card * (1.0 - ink.a) + ink.rgb;
        card *= mix(amb * 2.0 + lampC * 0.05 * lamp, vec3(1.0, 0.95, 0.88) * 0.95, room);
        col = mix(col, card, (1.0 - smoothstep(-aa, aa, dc)) * cardOn);
      }
    }
    // 計時器：底板左上角的小盒子，數字是訊號色的 LED
    vec2 tq = q - tmrC;
    float dt = sdRound(tq, tmrSize * 0.5 + 16.0, 8.0);
    col *= 1.0 - 0.4 * exp(-max(sdRound(tq - vec2(-8.0, 14.0), tmrSize * 0.5 + 16.0, 8.0), 0.0) / 14.0);
    if (dt < aa) {
      vec3 box = C_INK2 * 0.9 * (1.0 + room);
      vec4 led = layerAt(tmr, (tq + tmrSize * 0.5) / tmrSize);
      box = box * (1.0 - led.a) + led.rgb * 1.1;
      col = mix(col, box, 1.0 - smoothstep(-aa, aa, dt));
    }
    // 放大機的燈在空氣裡的一點光霧
    col += lampC * 0.02 * lamp * (1.0 - printed) * exp(-length((p - vec2(${960}.0, 300.0)) / vec2(700.0, 500.0)));
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...p1Uniforms(),
  photo: { value: null }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  imgHalf: { value: new THREE.Vector2() }, paperHalf: { value: new THREE.Vector2() }, blade: { value: 0 },
  lamp: { value: 0 }, blur: { value: 1 }, printed: { value: 0 }, room: { value: 0 }, wand: { value: new THREE.Vector3() },
  cardC: { value: new THREE.Vector2() }, cardHalf: { value: new THREE.Vector2() }, cardAng: { value: 0 }, cardOn: { value: 0 },
  txt: { value: null }, txtSize: { value: new THREE.Vector2(1, 1) }, tmr: { value: null }, tmrC: { value: new THREE.Vector2() }, tmrSize: { value: new THREE.Vector2(1, 1) },
  k: { value: 1 }, focusZ: { value: 1700 },
  ...camUniforms(),
});

/** 卡片上的字：寬、整塊（主字＋署名＋歌詞）的高度上限；字從紅線下面（HEAD）開始寫。 */
const CAP_W = 500, CAP_H = 400, HEAD = 116, PADX = 30;

export default class Enlarger extends Scene {
  bg = shared('enlarger.bg', BG);
  txt = this.track(new Layer2D(CAP_W + 2 * PADX, HEAD + CAP_H + 50, undefined, { fast: true }));
  tmr = this.track(new Layer2D(150, 44, undefined, { fast: true }));
  cam = new PlaneCam();
  seed = seedOf(this.ctx);
  ph!: P1Photo;
  cap!: P1Cap;
  album = '';
  hw = 0; hh = 0; pw = 0; phh = 0;
  aimX = 0;
  cardC = new THREE.Vector2(); cardHalf = new THREE.Vector2(); cardAng = 0;
  tmrC = new THREE.Vector2();
  /** 卡片上橫線的位置（圖層座標的 y）：每一行字的基線下面一點，寫完的字下面接著畫空白的線到卡片底。 */
  rules: number[] = [];
  tLamp = 0; tExp = 0; tOff = 0; tW0 = 0; tW1 = 0;
  expSec = 8;
  tmrSig = '';

  override async init() {
    const { start, end, audio } = this.ctx;
    const [ref] = photoRefs(this.ctx, 1);
    await loadText(`${ref!.caption}${ref!.album}0123456789.…`);
    await loadWords(this.ctx);
    [this.ph] = await loadPhotos(this.ctx, [ref!], (x) => this.track(x));
    const c = this.txt.ctx;
    this.cap = new P1Cap(this.ctx, c, {
      family: F.hand(400), min: 40, max: 46, w: CAP_W, h: CAP_H, lineHeight: 1.22, maxLines: 5, gap: 18,
      ink: rgba('ink', 0.85), unsung: rgba('ink', 0.25), active: rgba('blood', 0.95), sigSize: 28, sigInk: rgba('ink', 0.65),
    });
    if (ref!.chapter && ref!.album) this.album = fitLabel(c, ref!.album, F.hand(700), 26, CAP_W, 3);
    const has = this.cap.has;
    const { w, h } = this.ph;
    const s = containScale(w, h, has ? 760 : 1000, has ? 580 : 640);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    const m = clamp(0.07 * Math.min(this.hw, this.hh) * 2, 28, 54);
    this.pw = this.hw + m; this.phh = this.hh + m;
    // 卡片（世界座標）：相紙夾右邊；高度照字
    const cardH = HEAD + Math.max(this.cap.height, 100) + 40;
    this.cardHalf.set(CAP_W / 2 + PADX, cardH / 2);
    this.cardAng = ((hash(this.seed, 5) - 0.5) * 4 + 2) * (Math.PI / 180);
    this.rules = this.ruleLines(cardH);
    // 有卡片：鏡頭往右看一點，相紙夾在左邊
    const cx = this.pw + 70 + 90 + this.cardHalf.x;
    this.aimX = has ? (cx + this.cardHalf.x - (this.pw + 70)) / 2 - 10 : 0;
    // 卡片＋上面的計時器當一欄：鏡頭落定、還沒推的時候整欄要在字的安全範圍裡（右邊不能壓到 HUD），不夠就往上挪
    let cy = 40;
    for (let i = 0; i < 3; i++) {
      this.cardC.set(cx, cy);
      this.tmrC.set(cx - this.cardHalf.x + 110, cy - this.cardHalf.y - 50);
      if (!has) break;
      this.placeCam(0);
      const r = this.colRect();
      const over = Math.max(0, r[1] + r[3] - (HUD_SAFE.y - 14)), under = Math.max(0, 100 - r[1]);
      if (!over && !under) break;
      cy += (under - over) * 0.95;
    }
    if (!has) this.tmrC.set(this.pw + 70 + 130, -this.phh + 30);
    const len = end - start;
    this.tLamp = len < 5 ? start + 0.15 : Math.min(beatAfter(audio, start + 0.15), start + 0.8);
    this.tExp = len < 5 ? start + len * 0.42 : Math.min(barAfter(audio, this.tLamp + 1.6), end - 3);
    this.tOff = Math.min(this.tExp + clamp(len * 0.18, 0.8, 2.2), end - 0.9);
    this.expSec = Math.round(4 + hash(this.seed, 8) * 8);
    this.tW0 = start + Math.min(0.7, len * 0.15);
    this.tW1 = this.tW0 + this.cap.writeDur();
  }

  /** 卡片上每一條橫線的 y（圖層座標）：主字每一行、署名、歌詞（預留的行數）的基線下面，之後照主字的行距排到卡片底。 */
  private ruleLines(cardH: number): number[] {
    const cap = this.cap, out: number[] = [];
    const under = (y: number) => out.push(Math.round(y + 8));
    let step = 56;
    if (cap.fit) {
      const f = cap.fit;
      step = f.lineHeight;
      f.lines.forEach((_, i) => under(HEAD + f.size * 0.9 + i * f.lineHeight));
      if (cap.sigH) under(HEAD + f.height + cap.sigH - cap.sigSize * 0.12);
    }
    if (cap.sung) {
      // 歌詞：預留的高度裡放得下幾行就畫幾條（字幕是 1.22 倍行距；歌詞自己當主字時照樣式的行距，這裡也是 1.22）
      const ls = cap.lyricSize, lh = ls * 1.22;
      const n = Math.max(1, Math.round((cap.lyricH - ls) / lh) + 1);
      if (!cap.fit) step = lh;
      for (let j = 0; j < Math.min(n, 2); j++) under(HEAD + cap.lyricTop + ls * 0.9 + j * lh);
    }
    let y = out.length ? out[out.length - 1]! : HEAD;
    while ((y += step) < cardH - 18) out.push(Math.round(y));
    return out;
  }

  /** 卡片（＋上面的計時器）在畫面上的外框。 */
  private colRect(): [number, number, number, number] {
    const a = this.cardAng, hx = this.cardHalf.x, hy = this.cardHalf.y;
    const ex = Math.abs(Math.cos(a)) * hx + Math.abs(Math.sin(a)) * hy, ey = Math.abs(Math.sin(a)) * hx + Math.abs(Math.cos(a)) * hy;
    const top = Math.min(this.cardC.y - ey, this.tmrC.y - 40);
    return this.cam.rect(this.cardC.x - ex, top, 2 * ex, this.cardC.y + ey - top);
  }

  /** 鏡頭：從前上方看底板；k 是往相紙上的焦點推到哪裡（目標移向焦點、放大），有卡片時目標移得少一點。 */
  private placeCam(k: number) {
    const has = this.cap.has;
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1;
    const fx = (this.ph.ref.fx - 0.5) * 2 * this.hw, fy = (this.ph.ref.fy - 0.5) * 2 * this.hh;
    const a = (has ? 0.35 : 0.8) * k;
    this.cam.look(lerp(this.aimX + dir * 10 * k, fx, a), lerp(30, fy, a), 1900 - 160 * k, (24 - 4 * k) * (Math.PI / 180), dir * 1.5 * (Math.PI / 180), 0)
      .zoomBy(1 + (has ? 0.28 : 0.34) * k);
  }

  private drawTimer(v: number, lit: boolean) {
    const sig = `${v.toFixed(1)}|${lit}`;
    if (sig === this.tmrSig) return;
    this.tmrSig = sig;
    const L = this.tmr, c = L.ctx;
    L.clear();
    c.font = font(F.mono(600), 32);
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.fillStyle = rgba('signal', lit ? 0.95 : 0.55);
    c.fillText(v.toFixed(1).padStart(4, '0'), L.w / 2, L.h / 2 + 1);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.ph.ref);
    // 鏡頭：從前上方看底板，一開始快、越來越慢地往相紙上的焦點推（卡片要一直在畫面裡）
    const fk = settleK(lt, 7);
    const has = this.cap.has;
    const k = safePush(fk, (kk) => { this.placeCam(kk); return !has || inSafe(this.colRect()); });
    this.cam.apply(u);
    u.focusZ!.value = this.cam.project(0, 0, 0).z;
    u.photo!.value = this.ph.tex;
    u.lod!.value = mipFor(this.ph.w, 2 * this.hw * (1 + 0.34 * k));
    (u.crop!.value as THREE.Vector4).set(...focusCrop(this.ph.ref, this.ph.w, this.ph.h, this.ph.aspect, fk, { zoom: 1.15, screenW: 2 * this.hw }));
    (u.imgHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    (u.paperHalf!.value as THREE.Vector2).set(this.pw, this.phh);
    // 燈：開燈（很快）→ 曝光時再亮一點 → 熄掉
    const on = t >= this.tLamp && t < this.tOff ? 1 : 0;
    const lamp = on * (0.9 + 0.2 * prog(t, this.tExp, this.tExp + 0.15)) * (0.6 + 0.4 * ease.outCubic(prog(t, this.tLamp, this.tLamp + 0.12)));
    u.lamp!.value = lamp;
    // 對焦：開燈後三拍一段一段對清楚（短窗格照比例）
    const b0 = this.tLamp;
    const steps = [1, 2, 3].map((i) => (e - s < 5 ? b0 + i * 0.25 : beatAfter(audio, b0 + 0.05, i - 1)));
    let blur = 1;
    steps.forEach((ts, i) => { blur = lerp(blur, [0.55, 0.2, 0][i]!, ease.outCubic(prog(t, ts, ts + 0.18))); });
    u.blur!.value = blur;
    u.blade!.value = ease.inOutCubic(prog(t, this.tLamp + 0.1, this.tLamp + 0.8));
    // 燈熄之後：印好的照片、房間的燈亮起來
    u.printed!.value = ease.inOutQuad(prog(t, this.tOff, this.tOff + 0.5));
    u.room!.value = ease.inOutCubic(prog(t, this.tOff + 0.2, this.tOff + 1.4));
    // 加光遮光棒：曝光時在影像上繞小圈
    const wk = prog(t, this.tExp, this.tExp + 0.25) * (1 - prog(t, this.tOff - 0.25, this.tOff));
    const wa = (t - this.tExp) * 5.5;
    const fx = (this.ph.ref.fx - 0.5) * 2 * this.hw, fy = (this.ph.ref.fy - 0.5) * 2 * this.hh;
    (u.wand!.value as THREE.Vector3).set(lerp(fx, 0, 0.5) + Math.cos(wa) * 70 - this.hw * 0.35, lerp(fy, 0, 0.5) + Math.sin(wa) * 50 + this.hh * 0.25, wk);
    // 計時器：曝光時往下數
    const left = t < this.tExp ? this.expSec : Math.max(0, this.expSec * (1 - prog(t, this.tExp, this.tOff)));
    this.drawTimer(left, t >= this.tExp && t < this.tOff);
    u.tmr!.value = this.tmr.texture;
    (u.tmrC!.value as THREE.Vector2).copy(this.tmrC);
    (u.tmrSize!.value as THREE.Vector2).set(this.tmr.w, this.tmr.h);
    // 卡片：橫線、相簿名，字逐字寫上去
    const L = this.txt;
    if (has) {
      if (this.cap.draw(L.ctx, t, PADX, HEAD, {
        chars: this.cap.charsAt(t, this.tW0, this.tW1),
        clear: () => {
          L.clear();
          const c = L.ctx;
          c.fillStyle = 'rgba(92, 126, 168, 0.3)';
          for (const y of this.rules) c.fillRect(0, y, L.w, 1.5);
          if (this.album) {
            c.font = font(F.hand(700), 26); c.letterSpacing = '4px'; c.fillStyle = rgba('ink', 0.7);
            c.fillText(this.album, PADX, 70); c.letterSpacing = '0px';
          }
        },
      })) L.upload();
    }
    u.txt!.value = L.texture;
    (u.txtSize!.value as THREE.Vector2).set(L.w, L.h);
    (u.cardC!.value as THREE.Vector2).copy(this.cardC);
    (u.cardHalf!.value as THREE.Vector2).copy(this.cardHalf);
    u.cardAng!.value = this.cardAng;
    u.cardOn!.value = has ? 1 : 0;
    u.k!.value = ease.outCubic(prog(t, s, s + 0.3)) * (1 - 0.15 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { bloom: 0.15, bloomThreshold: 1.1, halation: 0.14, vignette: 0.5 };
  }
}
