// 照片版面「時間軸」（亮，四張）：牆上一大張牛皮紙，一條墨水線從左往右畫過去，相片用紙膠帶貼在線的上下——
//  - 筆尖往右走、把線畫出來，走到哪一張，那張相片就在拍點「啪」地貼上去（從一點點高的地方落下、影子收緊），線上多一個點、一小段短線連到相片。
//  - 鏡頭沿著線一站一站移過去（在拍點前移動、拍點停住，像跟拍），斜斜地看著紙（往前的方向遠一點、有透視），最後停在主角：
//    主角最大，線上那個點是訊號色的圈；鏡頭轉正、慢慢退一點；主角相片上的畫面往新人點的焦點慢慢推。
//  - 主字（賓客留言＋署名，或新人的註解）用手寫字寫在主角旁邊、線的上面（寫在紙上，跟著紙一起透視、一起動），一個字一個字寫出來，
//    下面小一號跟唱這段的歌詞；沒有主字時歌詞寫在同一個位置跟唱；兩樣都沒有就只有相片（主角在正中間）。
//  - 照片完整呈現（實體相片不裁）；配角的面積最多是主角的六成。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, mulberry32, prog } from '../engine/util';
import { Cam, Caption, GLSL_INK, S, beatTimes, card, cardsPass, contain, hasWords, lay, loadSlots, mipLayer, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, type Card, type Slot } from './_p10';

// prefers（導演先挑適合接下來照片的版面）：貼在牛皮紙上的時間軸：成長照、舊照片最有味道；橫的主角跨在線上最好看。其他照片也撐得住。
// thumbAt：後台縮圖拍墨水線上已經貼了兩張的那一刻（收尾的畫面只剩主角，看不出是好幾張）。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 4, paper: true, energy: [0, 1], bars: [3, 8], weight: 1, prefers: ['small', 'landscape'], thumbAt: 0.175 };

const FOV = 30;
/** 線在畫面上的高度（基準鏡頭）。 */
const LINE_Y = 560;
/** 相片之間的距離。 */
const STEP = 560;

const PRE = /* glsl */ `
  // （只留一個出口：中途 return 會讓 ANGLE／D3D 出 X4000 警告，編出來的結果可能不一樣）
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    vec3 col;
    if (cPh[i].w > 2.5) {
      // 紙膠帶：半透明的米白和紙，有纖維
      float f = snoise(vec2(q.x / 4.0, q.y / 30.0)) * 0.5 + 0.5;
      col = mix(C_BONE, C_PAPER, 0.5) * (0.86 + 0.06 * f);
    } else {
      float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
      col = C_BONE * 0.9 * (1.0 - 0.05 * smoothstep(2.0, 0.0, e));
    }
    return col;
  }
  vec3 backColor(int i, vec2 q, vec2 hb) { return C_BONE * 0.85; }
  // 上方偏左的柔光：紙的中間亮、四周暗一點
  float topLight(vec2 w) { return 0.84 + 0.16 * exp(-dot(w / vec2(1500.0, 800.0), w / vec2(1500.0, 800.0))); }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    float sh = shadowAt(hp, i);
    vec3 c = base * topLight(hp.xy - camPos.xy) * mix(1.0, 0.86, 1.0 - sh);
    // 相紙的光澤：很淡
    vec3 h = normalize(lightDir - rd);
    c += C_BONE * 0.04 * pow(max(dot(n, h), 0.0), 60.0) * isPh;
    return c;
  }
`;

const POST = /* glsl */ `
  uniform sampler2D txt; uniform vec4 txtRect; uniform float lineY; uniform vec2 pen; uniform vec4 dots; uniform vec4 dotY; uniform float mainX;
  ${GLSL_INK}
  float wob(float x) { return 2.2 * sin(x / 170.0) + 1.2 * sin(x / 61.0 + 1.3); }
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    float t = -ro.z / rd.z;
    vec3 hp = ro + rd * t;
    vec2 w = hp.xy;
    float pxw = t / (focal * PX_SCALE) * inversesqrt(max(abs(rd.z), 0.04));
    // 牛皮紙：暖棕，纖維是很細的短線
    float fib = snoise(vec2(w.x / 2.0, w.y / 22.0)) * 0.5 + snoise(vec2(w.x / 26.0, w.y / 3.0)) * 0.3;
    float blot = fbm(w / 400.0, 3);
    vec3 col = mix(C_PAPER, C_FUR, 0.42) * (0.82 + 0.05 * fib + 0.05 * blot);
    col *= topLight(w - camPos.xy);
    col *= mix(1.0, 0.8, 1.0 - shadowAt(hp, -1));
    // 墨水線（畫到筆尖為止）、刻度、每張相片的點與短線
    vec3 ink = C_SEPIA * 0.9;
    float aa = max(pxw, 0.5);
    float ly = lineY + wob(w.x);
    float a = 1.0 - smoothstep(1.4 - aa, 1.4 + aa, abs(w.y - ly));
    a *= 1.0 - smoothstep(pen.x - 2.0, pen.x, w.x);
    float tick = step(abs(mod(w.x, 90.0) - 45.0), 0.9 + 0.5 * aa) * step(abs(w.y - ly - 7.0), 6.0) * step(w.x, pen.x - 20.0);
    a = max(a, tick * 0.5);
    for (int k = 0; k < 4; k++) {
      float dx = dots[k], dy = dotY[k];
      if (dx > pen.x) continue;
      float dl = lineY + wob(dx);
      float r = k == 3 ? 10.0 : 6.5;
      float d = length(w - vec2(dx, dl));
      float dotA = k == 3 ? 1.0 - smoothstep(2.4 - aa, 2.4 + aa, abs(d - r)) : 1.0 - smoothstep(r - aa, r + aa, d);
      // 點到相片的短線
      float stem = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, abs(w.x - dx))) * step(min(dl, dy), w.y) * step(w.y, max(dl, dy)) * step(r, abs(w.y - dl));
      if (k == 3) col = mix(col, C_SIGNAL * 0.75, dotA);
      a = max(a, max(k == 3 ? 0.0 : dotA, stem * 0.85));
    }
    // 筆尖：一顆小小的墨點
    a = max(a, (1.0 - smoothstep(3.0 - aa, 3.0 + aa, length(w - vec2(pen.x, lineY + wob(pen.x))))) * pen.y);
    col = mix(col, ink, a);
    // 註解寫在紙上（字層的左上角在 txtRect.xy，大小 txtRect.zw；y 向下）
    vec2 tq = vec2(w.x - txtRect.x, txtRect.y - w.y);
    if (tq.x > 0.0 && tq.y > 0.0 && tq.x < txtRect.z && tq.y < txtRect.w) {
      vec4 tx = inkAt(txt, tq - txtRect.zw * 0.5, txtRect.zw * 0.5, txtRect.zw, log2(pxw * 1.5 * PX_SCALE));
      col = col * (1.0 - tx.a) + tx.rgb;
    }
    return col;
  }
  vec3 finish(vec3 col, vec2 p, vec3 rd) { return col; }
`;

const PASS = () => cardsPass(PRE, POST, {
  txt: { value: null }, txtRect: { value: new THREE.Vector4(0, 0, 0, 0) }, lineY: { value: 0 }, pen: { value: new THREE.Vector2() },
  dots: { value: new THREE.Vector4() }, dotY: { value: new THREE.Vector4() }, mainX: { value: 0 },
});

interface Pin { slot: number; x: number; y: number; a: number; hw: number; hh: number; pw: number; ph: number; t: number; side: number }

export default class Timeline extends Scene {
  pass = shared('timeline.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  cam = new Cam(FOV);
  cards: Card[] = Array.from({ length: 8 }, () => card());
  /** 世界座標（z = 0 的紙上，y 向上）：配角三張由左到右，主角最後。 */
  pins: Pin[] = [];
  lineY = 0;
  /** 註解寫在紙上的位置（世界座標的左上角）。 */
  capAt = new THREE.Vector2();
  tArrive = 0;

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 4);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    const rnd = mulberry32(this.seed * 31 + 7);
    const main = refs[0]!;
    const hasText = hasWords(this.ctx);
    // 最後停下來的畫面（基準鏡頭）：主角跨在線上，註解在它右邊、線的下面；沒有字時主角在正中間
    const s0 = this.slots[0]!;
    const [pw, ph] = contain(s0, hasText ? 820 : 1000, hasText ? 740 : 760);
    const bd = clamp(0.045 * Math.min(pw, ph) * 2, 14, 30);
    const mx = hasText ? 150 + pw + bd : 930, my = hasText ? 520 : 520;
    this.lineY = S(0, LINE_Y).y;
    // 時間：筆尖走到每一張的時間在拍點上，配角在窗格的前四成內走完
    const span = Math.min(5.2, Math.max(1.4, (end - start) * 0.42));
    // 第一張一切進來就貼上（不要一開始是空的紙），其他三張落在拍點
    const times = [start + 0.12, ...beatTimes(audio, start + 0.45, 3, span)];
    this.tArrive = times[3]!;
    const m = S(mx, my);
    // 配角：往左一張一張排，上下交錯
    let x = m.x - (pw + bd) - 300;
    for (let i = 3; i >= 1; i--) {
      const sl = this.slots[i]!;
      let [w, h] = contain(sl, 440, 330);
      const k = Math.min(1, Math.sqrt((0.6 * pw * ph) / (w * h)));
      w *= k; h *= k;
      const b = clamp(0.045 * Math.min(w, h) * 2, 10, 22);
      const side = i % 2 === 1 ? -1 : 1;
      const cx = x - (w + b);
      this.pins.unshift({ slot: i, x: cx, y: this.lineY + side * (h + b + 70), a: (rnd() * 2 - 1) * 0.05, hw: w + b, hh: h + b, pw: w, ph: h, t: times[i - 1]!, side });
      x = cx - (w + b) - Math.max(40, STEP - 2 * (w + b));
    }
    this.pins.push({ slot: 0, x: m.x, y: m.y, a: (rnd() * 2 - 1) * 0.025, hw: pw + bd, hh: ph + bd, pw, ph, t: times[3]!, side: 0 });
    if (hasText) {
      // 字（主字＋署名＋小一號的歌詞）寫在主角右邊、線的上面（最後一行貼著線）：線下面靠近右下角的 HUD，長的字會碰到
      const cx = mx + pw + bd + 70;
      const w = Math.min(700, 1790 - cx);
      this.cap = new Caption(this.ctx, main, {
        family: F.hand(400), w, h: 410, min: 40, max: 48, lineHeight: 1.36, maxLines: 4, pad: 20, scale: 1.5, sigColor: rgba('sepia', 0.7),
        color: rgba('sepia', 0.92), active: mixRgba('signal', 'sepia', 0.4), unsung: rgba('sepia', 0.32), write: 0.06,
        album: { family: F.hand(700), size: 26, color: rgba('sepia', 0.6), tracking: 4 }, headGap: 18,
      }, (x) => this.track(x));
      await this.cap.init();
      mipLayer(this.cap.L);
      // 字塊的底在線上面 40 px；很長的時候頂停在 108（離上緣 96 px 以上，鏡頭最後還會退一點），寧可稍微碰到線
      const top = S(cx - this.cap.pad, Math.max(108, LINE_Y - 40 - this.cap.blockH) - this.cap.pad);
      this.capAt.set(top.x, top.y);
      this.cap.writeFrom(this.tArrive + 0.4, 2.2);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, e = this.ctx.end;
    const cam = this.cam;
    const D = cam.D;
    // 鏡頭：一站一站移過去（每張在它的拍點前 0.45 秒開始移、拍點停住），停在主角之後轉正、慢慢退一點
    const P = this.pins;
    const at = (i: number) => (i < 3 ? new THREE.Vector2(P[i]!.x + 150, (this.lineY + P[i]!.y) / 2) : new THREE.Vector2(0, 0));
    let tx = at(0).x - 260, ty = at(0).y;
    for (let i = 0; i < 4; i++) {
      const d = Math.min(0.4, Math.max(0.2, i === 0 ? 0.5 : P[i]!.t - P[i - 1]!.t - 0.05));
      const k = ease.inOutCubic(prog(t, P[i]!.t - d, P[i]!.t));
      const p = at(i);
      tx = lerp(tx, p.x, k); ty = lerp(ty, p.y, k);
    }
    const arrive = ease.inOutCubic(prog(t, this.tArrive - 0.5, this.tArrive + 0.4));
    const after = 1 - Math.exp(-Math.max(0, t - this.tArrive) / 6);
    const yaw = lerp(0.2, 0, arrive);
    const dist = D * (lerp(0.8, 0.97, arrive) + 0.04 * after);
    cam.rest(FOV);
    cam.pos.set(tx - Math.sin(yaw) * dist, ty - 30 * (1 - arrive), Math.cos(yaw) * dist);
    cam.target.set(tx + 40 * (1 - arrive), ty, 0);
    cam.update();
    const focusD = new THREE.Vector3(cam.target.x, cam.target.y, 0).sub(cam.pos).dot(cam.f);

    // 筆尖：在每一張的拍點剛好走到那一張（線先畫到、相片接著貼上）；到主角之後繼續往右畫到畫面外
    let penX = P[0]!.x - 900;
    for (let i = 0; i < 4; i++) {
      const t0 = i === 0 ? this.ctx.start : P[i - 1]!.t, x0 = i === 0 ? P[0]!.x - 900 : P[i - 1]!.x;
      if (t >= t0) penX = lerp(x0, P[i]!.x, ease.inOutQuad(prog(t, t0, P[i]!.t)));
    }
    if (t > this.tArrive) penX = lerp(P[3]!.x, 2600, ease.outCubic(prog(t, this.tArrive, this.tArrive + 2.5)));
    const list: Card[] = [];
    const u = this.pass.u;
    const dots = u.dots!.value as THREE.Vector4, dotY = u.dotY!.value as THREE.Vector4;
    P.forEach((pn, i) => {
      const cd = this.cards[i]!;
      // 貼上去：拍點時從一點點高的地方落下、影子收緊
      const pop = ease.outCubic(prog(t, pn.t - 0.06, pn.t + 0.3));
      const z = 1 + 70 * (1 - pop);
      lay(cd, new THREE.Vector3(pn.x, pn.y, z), pn.a + 0.06 * (1 - pop) * (i % 2 ? 1 : -1));
      cd.hw = pn.hw * lerp(1.05, 1, pop); cd.hh = pn.hh * lerp(1.05, 1, pop);
      // 主角貼上之後，相片上的畫面往焦點慢慢推（實體相片：1.2 倍）；鏡頭停在主角，看得出臉越來越大
      const sl = this.slots[pn.slot]!, ppw = pn.pw * lerp(1.05, 1, pop), pph = pn.ph * lerp(1.05, 1, pop);
      setPhoto(cd, sl, pn.slot, ppw, pph, pn.slot === 0 ? pushCrop(sl, ppw, pph, settleK(t - this.tArrive, 5), 1.2) : undefined);
      cd.kind = 0; cd.dim = 1; cd.cast = 1;
      // 實體相片不會半透明：拍點一到就整張出現（從高一點的地方落下來）
      cd.alpha = t >= pn.t - 0.06 ? 1 : 0;
      // 景深：離對焦面遠的（斜看時往右的）軟一點
      const dd = new THREE.Vector3(pn.x, pn.y, 0).sub(cam.pos).dot(cam.f) - focusD;
      cd.blur = Math.min(3, Math.abs(dd) * 0.006);
      list.push(cd);
      // 紙膠帶：相片上緣中間一段
      const tp = this.cards[4 + i]!;
      const top = new THREE.Vector3().copy(cd.c).addScaledVector(cd.v, -cd.hh + 6);
      lay(tp, top.setZ(z + 1.5), pn.a + (i % 2 ? -0.08 : 0.07));
      tp.hw = Math.min(70, cd.hw * 0.35); tp.hh = 17; tp.slot = -1; tp.pw = 0; tp.ph = 0; tp.kind = 3; tp.dim = 1; tp.cast = 0;
      tp.alpha = cd.alpha * 0.78; tp.blur = cd.blur;
      list.push(tp);
      // 線上的點：配角在相片正下（上）方、連一小段短線；主角跨在線上，訊號色的圈畫在它右邊線穿出來的地方
      dots.setComponent(i, t < pn.t - 0.06 ? 1e6 : pn.side === 0 ? pn.x + pn.hw + 34 : pn.x);
      dotY.setComponent(i, pn.side === 0 ? this.lineY : pn.y - pn.side * pn.hh);
    });
    setCards(this.pass, list);
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);
    u.lineY!.value = this.lineY;
    (u.pen!.value as THREE.Vector2).set(penX, 1 - prog(t, this.tArrive + 2.0, this.tArrive + 2.5));
    u.mainX!.value = P[3]!.x;
    if (this.cap?.has) {
      this.cap.draw(t);
      u.txt!.value = this.cap.L.texture;
      (u.txtRect!.value as THREE.Vector4).set(this.capAt.x, this.capAt.y, this.cap.L.w, this.cap.L.h);
    } else {
      // shader 是這個版面所有窗格共用的：沒有字的時候把上一個窗格（已經釋放）的字層拿掉
      (u.txtRect!.value as THREE.Vector4).set(0, 0, 0, 0);
      u.txt!.value = null;
    }
    u.lightDir!.value.set(-0.3, 0.55, 0.78).normalize();
    u.shadowK!.value = 0.4; u.penumbra!.value = 0.12;
    u.k!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    this.pass.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.3 };
  }
}
