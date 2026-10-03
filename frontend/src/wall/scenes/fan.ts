// 照片版面「扇形展開」（亮，五張）：喜宴的白色緹花桌巾上，一疊相片卡像撲克牌一樣攤成扇形，主角那張被抽出來——
//  - 相片卡一樣大（直的、像撲克牌），照片完整印在卡上、多出來的地方是卡紙的白；一切進來是一疊，第一拍「刷」地攤成扇形（一張接一張）。
//  - 接著主角從扇子中間被抽出來：先順著自己的方向往上滑出，再轉正、抬起來、放大，卡也長成照片本來的比例（照片完整、不裁）；
//    其他張往下沉、暗一點、失焦；主角放大之後相片上的畫面往新人點的焦點慢慢推。
//  - 抽出來之後旁邊滑進一張燙金邊的桌卡（喜宴的座位卡），主字（賓客留言＋署名，或新人的註解）印在上面（思源宋體），
//    下面小一號跟唱這段的歌詞；沒有主字時歌詞寫在桌卡上跟唱；兩樣都沒有就沒有桌卡，主角在正中間。
//  - 桌巾是米白的緹花布：同色的花紋只在光澤上看得出來；上方一盞柔光。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, mulberry32, prog } from '../engine/util';
import { Cam, Caption, GLSL_INK, S, beatAfter, card, cardsPass, contain, hasWords, lay, loadSlots, mipLayer, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, type Card, type Slot } from './_p10';

// prefers（導演先挑適合接下來照片的版面）：直的相片卡（像撲克牌）：直的照片填滿整張卡。其他照片也撐得住。
// thumbAt：後台縮圖拍五張攤成扇形的那一刻（收尾的畫面只剩主角，看不出是好幾張）。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 5, paper: true, energy: [0.15, 1], bars: [3, 8], weight: 1, prefers: ['portrait'], thumbAt: 0.122 };

const FOV = 30;
/** 相片卡（直的）與扇子：轉軸在卡片中心下面多遠、每張差幾度。 */
const CW = 330, CH = 480, PIVOT = 700, SPREAD = 0.27;

const PRE = /* glsl */ `
  uniform sampler2D txt; uniform vec2 txtSize;
  ${GLSL_INK}
  // （只留一個出口：中途 return 會讓 ANGLE／D3D 出 X4000 警告，編出來的結果可能不一樣）
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    float kind = cPh[i].w;
    float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
    vec3 col;
    if (kind > 1.5) {
      // 桌卡：厚的米白卡紙，四周兩道燙金細線
      vec3 c = mix(C_BONE, C_PAPER, 0.25) * (0.9 + 0.012 * snoise(q / 4.0));
      float gold = (1.0 - smoothstep(0.8, 1.6, abs(e - 16.0))) + 0.7 * (1.0 - smoothstep(0.5, 1.2, abs(e - 22.0)));
      c = mix(c, mix(C_SIGNAL, C_BLOOD, 0.35) * 0.9, clamp(gold, 0.0, 1.0));
      // 卡比字層高（短的字）時字放在卡的正中間
      vec4 ink = inkAt(txt, q - vec2(0.0, max(0.0, hb.y - 0.5 * txtSize.y)), hb, txtSize, log2(pxw * 1.5 * PX_SCALE));
      col = c * (1.0 - ink.a) + ink.rgb;
    } else {
      // 相片卡：卡紙的白，邊緣一圈很細的暗
      col = C_BONE * 0.9 * (1.0 - 0.06 * smoothstep(2.0, 0.0, e));
    }
    return col;
  }
  // 背面：米白卡紙上淡淡的細格紋（像撲克牌背）
  vec3 backColor(int i, vec2 q, vec2 hb) {
    float g = step(0.5, fract((q.x + q.y) / 16.0)) * step(0.5, fract((q.x - q.y) / 16.0));
    return mix(C_BONE * 0.86, mix(C_BONE, C_SIGNAL, 0.25) * 0.8, g * 0.4);
  }
  float topLight(vec2 w) { return 0.84 + 0.16 * exp(-dot(w / vec2(1400.0, 900.0), w / vec2(1400.0, 900.0))); }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    float sh = shadowAt(hp, i);
    vec3 c = base * topLight(hp.xy - vec2(-200.0, 300.0)) * mix(1.0, 0.8, 1.0 - sh);
    vec3 h = normalize(lightDir - rd);
    c += C_BONE * 0.06 * pow(max(dot(n, h), 0.0), 70.0) * isPh;
    return c;
  }
`;

const POST = /* glsl */ `
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    float t = -ro.z / rd.z;
    vec3 hp = ro + rd * t;
    vec2 w = hp.xy;
    // 緹花：同色的花紋，只有光澤不一樣（緞面亮一點）；細細的織紋
    vec2 cell = w / 230.0;
    vec2 f = fract(cell + vec2(0.5 * step(0.5, fract(floor(cell.y) * 0.5)), 0.0)) - 0.5;
    float r = length(f), a = atan(f.y, f.x);
    float petal = smoothstep(0.02, 0.0, r - (0.2 + 0.09 * cos(a * 6.0)));
    float ring = 1.0 - smoothstep(0.0, 0.015, abs(r - 0.36 - 0.02 * cos(a * 12.0)));
    float dam = max(petal, ring * 0.7);
    float weave = snoise(vec2(w.x / 1.6, w.y / 30.0)) * 0.5 + snoise(vec2(w.x / 30.0, w.y / 1.6)) * 0.5;
    vec3 col = mix(C_BONE, C_PAPER, 0.4) * (0.82 + 0.035 * dam + 0.012 * weave);
    // 桌巾的大波紋（垂下來的布的起伏），很淡
    col *= 1.0 + 0.025 * snoise(vec2(w.x / 700.0, w.y / 1600.0));
    col *= topLight(w - vec2(-200.0, 300.0)) * mix(1.0, 0.78, 1.0 - shadowAt(hp, -1));
    return col;
  }
  vec3 finish(vec3 col, vec2 p, vec3 rd) { return col; }
`;

const PASS = () => cardsPass(PRE, POST, { txt: { value: null }, txtSize: { value: new THREE.Vector2(1, 1) } });

export default class Fan extends Scene {
  pass = shared('fan.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  cam = new Cam(FOV);
  cards: Card[] = Array.from({ length: 6 }, () => card());
  /** 扇子裡的順序（左到右）：主角在中間。 */
  order: number[] = [];
  /** 每張卡上照片的半寬高（卡是一樣大的直卡）。 */
  inCard: [number, number][] = [];
  tSpread = 0; tDraw = 0;
  /** 主角抽出來之後的位置與大小（畫面像素、照片半寬高）。 */
  big = { x: 930, y: 430, pw: 300, ph: 200, bd: 20 };
  place: { x: number; y: number; hw: number; hh: number; t: number; a: number } | null = null;
  fanC = { x: 960, y: 560 };

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 5);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    const rnd = mulberry32(this.seed * 41 + 9);
    const main = refs[0]!;
    const hasText = hasWords(this.ctx);
    // 主角在中間，其他張在兩邊（照順序）
    this.order = [1, 2, 0, 3, 4];
    const bd = 18;
    this.inCard = this.slots.map((sl) => contain(sl, CW - 2 * bd, CH - 2 * bd - 60));
    const dur = end - start;
    this.tSpread = beatAfter(audio, start + 0.2);
    if (this.tSpread - start > 0.8) this.tSpread = start + 0.35;
    this.tDraw = Math.max(this.tSpread + 0.9, beatAfter(audio, start + clamp(dur * 0.3, 1.0, 3.2)));
    if (this.tDraw > end - 1.2) this.tDraw = Math.max(this.tSpread + 0.6, end - 1.2);
    if (hasText) {
      this.cap = new Caption(this.ctx, main, {
        family: F.ming(500), w: 540, h: 440, min: 40, max: 48, lineHeight: 1.42, maxLines: 4, pad: 44, sigColor: rgba('sepia', 0.7), scale: 1.5, align: 'center',
        color: rgba('sepia', 0.9), active: mixRgba('signal', 'sepia', 0.35), unsung: rgba('sepia', 0.3), tracking: 1,
        album: { family: F.hei(500), size: 20, color: mixRgba('signal', 'sepia', 0.5), tracking: 8 },
      }, (x) => this.track(x));
      await this.cap.init();
      mipLayer(this.cap.L);
    }
    const s0 = this.slots[0]!;
    // 桌卡照字的多寡裁高（至少像一張桌卡的比例；比字層高的地方是空白的卡紙）。字置中，卡寬就是字層的寬
    const cw = this.cap ? this.cap.L.w : 0, ch = this.cap ? Math.max(this.cap.usedH, 0.5 * cw) : 0;
    const [pw, ph] = contain(s0, hasText ? 820 : 1000, hasText ? 600 : 620);
    const gx = hasText ? Math.max(120, (1880 - (2 * (pw + bd) + 90 + cw)) / 2) : 0;
    this.big = { x: hasText ? gx + pw + bd : 930, y: 400, pw, ph, bd };
    if (this.cap) {
      this.place = { x: gx + 2 * (pw + bd) + 90 + cw / 2, y: clamp(420, 140 + ch / 2, 800 - ch / 2), hw: cw / 2, hh: ch / 2, t: this.tDraw + 0.75, a: (rnd() * 2 - 1) * 0.03 };
    }
    this.fanC = { x: 960, y: 560 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const cam = this.cam;
    const D = cam.D;
    const draw = prog(t, this.tDraw, this.tDraw + 1.1);
    const after = 1 - Math.exp(-Math.max(0, t - this.tDraw - 1.1) / 6);
    // 鏡頭：從上方偏前看（一點點透視），很慢地推近；抽牌時往上跟一點
    cam.rest(FOV);
    const drift = ease.inOutQuad(clamp((t - s) / 12));
    const dist = D * (1.04 - 0.03 * drift - 0.03 * after);
    const ty = lerp(-20, 30, ease.inOutCubic(draw));
    cam.pos.set(10 * drift, ty - Math.sin(0.12) * dist, Math.cos(0.12) * dist);
    cam.target.set(10 * drift, ty, 0);
    cam.update();

    // 扇子：轉軸在扇子中心下面；抽牌之後整把往下沉
    const sink = ease.inOutCubic(prog(t, this.tDraw + 0.3, this.tDraw + 1.2));
    const pivot = S(this.fanC.x, this.fanC.y + PIVOT + 360 * sink);
    const list: Card[] = [];
    this.order.forEach((slot, k) => {
      const cd = this.cards[k]!;
      const off = k - 2;
      // 一張接一張攤開（中間那張不動），稍微過頭再回來
      const sp = ease.outBack(prog(t, this.tSpread + Math.abs(off) * 0.05, this.tSpread + 0.45 + Math.abs(off) * 0.05), 1.3);
      const ang = off * SPREAD * sp + (1 - sp) * off * 0.012;
      const sl = this.slots[slot]!;
      let [pw, ph] = this.inCard[slot]!;
      let hw = CW / 2, hh = CH / 2;
      let c = new THREE.Vector3(pivot.x + Math.sin(ang) * PIVOT, pivot.y + Math.cos(ang) * PIVOT, 1 + k * 1.2);
      let a = ang;
      let dim = lerp(1, 0.78, sink), blur = 2.5 * sink;
      if (slot === 0) {
        // 主角：先沿著自己的方向往上滑出扇子，再轉正、抬起來、放大，卡長成照片的比例
        const slide = ease.inOutCubic(prog(t, this.tDraw, this.tDraw + 0.4));
        const go = ease.inOutCubic(prog(t, this.tDraw + 0.3, this.tDraw + 1.1));
        const up = new THREE.Vector3(Math.sin(ang), Math.cos(ang), 0).multiplyScalar(260 * slide);
        const b = this.big;
        const z = 160 * go;
        const kz = (D - z) / D;
        const tgt = S(b.x, b.y);
        c = new THREE.Vector3(lerp(c.x + up.x, tgt.x * kz, go), lerp(c.y + up.y, tgt.y * kz, go), lerp(c.z + 4, z, go) + 30 * Math.sin(Math.PI * go));
        a = lerp(ang, -0.015, go);
        pw = lerp(pw, b.pw * kz, go); ph = lerp(ph, b.ph * kz, go);
        hw = lerp(hw, (b.pw + b.bd) * kz, go); hh = lerp(hh, (b.ph + b.bd) * kz, go);
        dim = 1; blur = 0;
      }
      lay(cd, c, a);
      // 卡上的照片在上半部（下面留白，像相片卡），抽出來後置中
      cd.oy = slot === 0 ? lerp(-30, 0, ease.inOutCubic(prog(t, this.tDraw + 0.3, this.tDraw + 1.1))) : -30;
      cd.hw = hw; cd.hh = hh;
      // 主角抽出來、放大之後，相片上的畫面往焦點慢慢推（實體相片：1.2 倍）
      setPhoto(cd, sl, slot, pw, ph, slot === 0 ? pushCrop(sl, pw, ph, settleK(t - this.tDraw - 0.8, 5), 1.2) : undefined);
      cd.kind = 0; cd.dim = dim; cd.blur = blur; cd.cast = 1; cd.alpha = 1;
      list.push(cd);
    });
    // 主角最後畫（抽出來的時候在最上面）
    const mi = list.findIndex((c) => c.slot === 0);
    if (draw > 0) { const [m] = list.splice(mi, 1); list.push(m!); }
    if (this.place && this.cap) {
      const pl = this.place, cd = this.cards[5]!;
      const k = ease.outCubic(prog(t, pl.t, pl.t + 0.55));
      lay(cd, S(pl.x + 900 * (1 - k), pl.y - 60 * (1 - k), 1.5 + 40 * (1 - k)), pl.a - 0.2 * (1 - k));
      cd.hw = pl.hw; cd.hh = pl.hh; cd.slot = -1; cd.pw = 0; cd.ph = 0; cd.kind = 2; cd.dim = 1; cd.blur = 0; cd.cast = 1;
      cd.alpha = t > pl.t ? 1 : 0;
      list.splice(list.length - 1, 0, cd);
      this.cap.draw(t);
      this.pass.u.txt!.value = this.cap.L.texture;
      (this.pass.u.txtSize!.value as THREE.Vector2).set(this.cap.L.w, this.cap.L.h);
    }
    // shader 是這個版面所有窗格共用的：沒有字的窗格要把上一個窗格（已經釋放）的字層拿掉
    if (!this.cap) this.pass.u.txt!.value = null;
    setCards(this.pass, list);
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);
    const u = this.pass.u;
    u.lightDir!.value.set(-0.25, 0.45, 0.86).normalize();
    u.shadowK!.value = 0.42; u.penumbra!.value = 0.1;
    u.k!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    this.pass.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.3 };
  }
}
