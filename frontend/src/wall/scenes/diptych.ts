// 照片版面「雙聯」（暗底，兩張）：兩張照片裝在細黑框裡，並排掛在深色的牆前，像一組雙聯作品——
//  - 主角在左邊、比較大、在對焦面上；第二張在右邊、往牆那邊退一點（透視小一點、景深軟一點），中間一條細縫。
//  - 縫後面的牆透出一道很淡的暖光（訊號色）；每個小節的第一拍兩片往左右輕推一下，縫裡的光跟著亮一下。
//  - 進場：兩片合在一起、燈是暗的；第一拍燈亮、兩片打開，焦點從第二張拉到主角（拉焦）。
//  - 兩張直的最好看（並排、高度接近）；一橫一直、兩張橫的也排得下：高度照比例算，整組放進畫面，
//    字在主角下面（像美術館的牆上說明）；兩張都窄時改放在右邊一欄，照片可以更大。很小的舊照片最多放大約 1.45 倍。
//    字是主角的主字（賓客留言＋署名，或新人的註解）＋下面小一號的跟唱歌詞（_p10 的 Caption）；兩樣都沒有時兩張在正中間。
//  - 主光從左上打下來，畫框在牆上投下軟影子；鏡頭很慢地推近、往一邊移一點（看得出照片離牆有距離）；
//    主角框裡的畫面往新人點的焦點慢慢推。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { W } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { Cam, Caption, S, card, cardsPass, contain, drawLayer, hasWords, kickAt, loadSlots, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, stand, type CapStyle, type Card, type Slot } from './_p10';
import type { PhotoRef } from '../photos';

// prefers（導演先挑適合接下來照片的版面）：兩張都是直的最像一組雙聯（並排、高度接近）。其他照片也撐得住。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 2, energy: [0, 1], bars: [2, 8], weight: 1, prefers: ['portrait'] };

const FOV = 26;
/** 牆、第二張離主角那一面多遠（世界單位 ≈ 像素）。 */
const WALL_Z = -150, BACK_Z = -40;
/** 畫框寬、兩張之間的縫。 */
const FR = 9, GAP = 26;
/** 第二張的高度是主角的幾倍。 */
const R2 = 0.86;

const PRE = /* glsl */ `
  uniform float sweep;
  // 細黑框：上緣的斜面被主光打到亮一點、下緣暗一點
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
    vec3 fr = C_INK2 * 1.1;
    fr *= 1.0 + 0.9 * smoothstep(3.0, 0.0, e) * (q.y < 0.0 ? 1.0 : -0.5);
    return fr;
  }
  vec3 backColor(int i, vec2 q, vec2 hb) { return C_INK2; }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    // 主光：左上偏亮、往右下慢慢暗
    float lit = 0.84 + 0.16 * smoothstep(900.0, -300.0, hp.x - hp.y);
    // 很淡的一道斜光（像玻璃反光），每個小節從左往右滑過一次
    float band = exp(-pow((hp.x * 0.8 + hp.y * 0.6 - sweep) / 90.0, 2.0));
    return base * lit + C_BONE * 0.028 * band * isPh;
  }
`;

const POST = /* glsl */ `
  uniform vec3 slit; uniform float slitK; uniform vec3 spot;
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    float t = (${WALL_Z.toFixed(1)} - ro.z) / rd.z;
    vec3 hp = ro + rd * t;
    vec2 w = hp.xy;
    float n = fbm(w / 260.0, 3);
    vec3 wall = mix(C_INK, C_INK2, 0.7) * (0.82 + 0.24 * n);
    // 主光在牆上的光圈（軟的橢圓，中心在主角上方偏左）
    vec2 sq = (w - spot.xy) / vec2(spot.z * 1.3, spot.z * 0.95);
    float pool = exp(-pow(dot(sq, sq), 1.3) * 1.1);
    vec3 lightC = mix(C_BONE, C_EMBER, 0.22);
    vec3 col = wall * 0.32 + lightC * 0.075 * pool * (0.88 + 0.24 * n);
    col *= shadowAt(hp, -1);
    // 縫後面的暖光
    float dx = abs(w.x - slit.x);
    float vy = 1.0 - smoothstep(slit.z * 0.75, slit.z * 1.25, abs(w.y - slit.y));
    col += C_SIGNAL * slitK * (0.06 * exp(-dx / 90.0) + 0.22 * exp(-dx / 9.0)) * vy;
    return col;
  }
  vec3 finish(vec3 col, vec2 p, vec3 rd) { return col; }
`;

const PASS = () => cardsPass(PRE, POST, {
  sweep: { value: 0 }, slit: { value: new THREE.Vector3() }, slitK: { value: 0 }, spot: { value: new THREE.Vector3() },
});

interface Layout { h1: number; h2: number; w1: number; w2: number; cx1: number; cx2: number; cy: number; col: { x: number; y: number; w: number; h: number } | null }

export default class Diptych extends Scene {
  pass = shared('diptych.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  cam = new Cam(FOV);
  D = this.cam.D;
  lay!: Layout;
  cards: Card[] = [card(), card()];
  tOpen = 0;
  dir = 1;

  override async init() {
    const { start, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 2);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    this.lay = hasWords(this.ctx) ? await this.layoutText(refs[0]!) : this.layoutBare();
    // 第一拍打開（太早的拍點不算：至少讓觀眾看到合起來的樣子零點三秒）
    this.tOpen = beatAfter(audio, start + 0.3);
    if (this.tOpen - start > 1.2) this.tOpen = start + 0.5;
    this.dir = hash(this.seed, 4) < 0.5 ? -1 : 1;
  }

  /** 兩張放進 bw×bh：主角高 h1、第二張高 R2·h1（加上畫框）；很小的照片最多放大約 1.45 倍。 */
  private fit(bw: number, bh: number) {
    const [s1, s2] = this.slots as [Slot, Slot];
    let h1 = Math.min(bh - 2 * FR, (bw - GAP - 4 * FR) / (s1.aspect + Math.min(R2, Math.sqrt((0.7 * s1.aspect) / s2.aspect)) * s2.aspect));
    h1 = Math.min(h1, contain(s1, 1e5, 1e5)[1] * 2);
    // 主角一定比較大：第二張的面積最多是主角的七成（直的主角配橫的第二張時，第二張要矮一點）
    const h2 = Math.min(h1 * R2, h1 * Math.sqrt((0.7 * s1.aspect) / s2.aspect), contain(s2, 1e5, 1e5)[1] * 2);
    return { h1, h2, w1: h1 * s1.aspect, w2: h2 * s2.aspect };
  }

  /** 兩樣字都沒有：兩張在正中間。 */
  private layoutBare(): Layout {
    const f = this.fit(1560, 760);
    const gw = f.w1 + f.w2 + GAP + 4 * FR;
    const x0 = 930 - gw / 2;
    return { ...f, cx1: x0 + FR + f.w1 / 2, cx2: x0 + 3 * FR + f.w1 + GAP + f.w2 / 2, cy: 500, col: null };
  }

  /**
   * 有字：字放主角下面（像美術館的牆上說明）或右邊一欄，挑主角比較大的那個。
   * 字塊（主字最多三、五行＋署名＋一行字幕歌詞）先排好量出高度，照片再照剩下的地方放。
   */
  private async layoutText(main: PhotoRef): Promise<Layout> {
    const s1 = this.slots[0]!;
    const below0 = this.fit(1600, 540), side0 = this.fit(1060, 800);
    const useSide = side0.h1 * side0.h1 * s1.aspect > below0.h1 * below0.h1 * s1.aspect * 1.12;
    const style = (w: number, h: number, maxLines: number): CapStyle => ({
      family: F.ming(500), w, h, min: 40, max: 50, lineHeight: 1.42, maxLines,
      color: rgba('bone', 0.94), active: rgba('signal'), unsung: rgba('bone', 0.3), tracking: 1, sigColor: rgba('bone', 0.72), sigFamily: F.ming(500),
      rule: { color: rgba('signal', 0.8), w: 40 }, album: { family: F.hei(500), size: 20, color: rgba('ash', 0.85), tracking: 6 },
    });
    if (useSide) {
      // 右邊一欄：字塊跟主角的中心對齊；這一欄會伸到 x ≥ 1360，所以下緣停在 HUD 區（y = 830）上面
      const colW = 520;
      const cap = (this.cap = new Caption(this.ctx, main, style(colW, 640, 5), (x) => this.track(x)));
      await cap.init();
      const f = side0;
      const gw = f.w1 + f.w2 + GAP + 4 * FR;
      const x0 = Math.max(130, (W - (gw + 90 + colW)) / 2);
      const cy = 520;
      return { ...f, cx1: x0 + FR + f.w1 / 2, cx2: x0 + 3 * FR + f.w1 + GAP + f.w2 / 2, cy, col: { x: x0 + gw + 90, y: clamp(cy - cap.blockH / 2, 130, 790 - cap.blockH), w: colW, h: cap.blockH } };
    }
    // 主角下面：字塊的寬照第一次排的位置（右緣不超過 1330，不碰 HUD），量出高度後照片照剩下的高度再排一次
    const gw0 = below0.w1 + below0.w2 + GAP + 4 * FR;
    const colW = Math.min(820, 1330 - Math.max(130, 950 - gw0 / 2));
    const cap = (this.cap = new Caption(this.ctx, main, style(colW, 320, 3), (x) => this.track(x)));
    await cap.init();
    // 照片頂在 110、字塊的底在 950（鏡頭推近約 2%，推完也離下緣 96 px 以上）
    const f = this.fit(1600, Math.min(540, 950 - 110 - 52 - cap.blockH));
    const gw = f.w1 + f.w2 + GAP + 4 * FR;
    const x0 = Math.max(130, 950 - gw / 2);
    const room = 950 - 52 - cap.blockH - 110;
    const top = 110 + Math.max(0, room - f.h1 - 2 * FR) * 0.35;
    const cy = top + f.h1 / 2 + FR;
    const cx = Math.min(x0, 1330 - colW);
    return { ...f, cx1: x0 + FR + f.w1 / 2, cx2: x0 + 3 * FR + f.w1 + GAP + f.w2 / 2, cy, col: { x: cx, y: cy + f.h1 / 2 + FR + 52, w: colW, h: cap.blockH } };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const L = this.lay, D = this.D;
    const cam = this.cam;
    // 鏡頭：從稍遠的地方很慢地推近（一開始快、之後越來越慢），同時往一邊移一點、看著中間（牆與照片的視差）
    const z0 = 1 - Math.exp(-lt / 7);
    const mid = (L.cx1 + L.cx2) / 2 - W / 2;
    cam.rest(FOV);
    cam.pos.set(this.dir * 34 * ease.inOutQuad(clamp(lt / 12)) - this.dir * 10, -6 + 8 * z0, D * (1.035 - 0.055 * z0));
    cam.target.set(mid * 0.12, 0, 0);
    cam.update();

    // 打開：第一拍從合起來（沒有縫）到 GAP；之後每個小節的第一拍往左右輕推一下
    const open = ease.outExpo(prog(t, this.tOpen, this.tOpen + 0.7));
    const kick = t > this.tOpen + 0.5 ? kickAt(audio, t, true, 3.2) : 0;
    const gapNow = lerp(-2 * FR, GAP, open) + 16 * kick;
    const shift = (gapNow - GAP) / 2;
    // 焦點：一開始在第二張，打開時拉到主角
    const focus = lerp(BACK_Z, 0, ease.inOutCubic(prog(t, this.tOpen, this.tOpen + 0.8)));

    const [c1, c2] = this.cards as [Card, Card];
    const [s1, s2] = this.slots as [Slot, Slot];
    stand(c1, S(L.cx1 - shift, L.cy), 0);
    c1.hw = L.w1 / 2 + FR; c1.hh = L.h1 / 2 + FR;
    // 主角框裡的畫面往焦點慢慢推（裱框的作品：1.2 倍）
    setPhoto(c1, s1, 0, L.w1 / 2, L.h1 / 2, pushCrop(s1, L.w1 / 2, L.h1 / 2, settleK(lt, 6), 1.2));
    c1.blur = Math.abs(0 - focus) * 0.045;
    c1.dim = 1;
    // 第二張往後退：放在畫面上同一個位置、同樣大小（透視補回來），只是離牆比較近
    const k2 = (D - BACK_Z) / D;
    const p2 = S(L.cx2 + shift, L.cy, 0);
    stand(c2, new THREE.Vector3(p2.x * k2, p2.y * k2, BACK_Z), 0);
    c2.hw = (L.w2 / 2 + FR) * k2; c2.hh = (L.h2 / 2 + FR) * k2;
    setPhoto(c2, s2, 1, (L.w2 / 2) * k2, (L.h2 / 2) * k2);
    c2.blur = Math.abs(BACK_Z - focus) * 0.03;
    c2.dim = 0.9;
    setCards(this.pass, [c2, c1]);
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);

    const u = this.pass.u;
    const slitX = (L.cx1 + L.w1 / 2 + FR + L.cx2 - L.w2 / 2 - FR) / 2 - W / 2;
    (u.slit!.value as THREE.Vector3).set(slitX * ((D - WALL_Z) / D), (540 - L.cy) * ((D - WALL_Z) / D), (L.h1 / 2) * ((D - WALL_Z) / D));
    u.slitK!.value = open * (0.45 + 0.55 * kick);
    (u.spot!.value as THREE.Vector3).set((L.cx1 - W / 2 - 60) * 1.05, (540 - L.cy + 90) * 1.05, Math.max(L.h1, L.w1 + L.w2) * 0.75 + 200);
    // 斜光：每個小節滑過一次
    const bar = audio.barAt(t);
    u.sweep!.value = lerp(-1400, 1400, ease.inOutCubic(bar - Math.floor(bar)));
    // 燈：切進來是暗的，第一拍前後亮起來；最後零點三秒稍微收暗
    u.k!.value = lerp(0.35, 1, ease.outCubic(prog(t, s, this.tOpen + 0.35))) * (1 - 0.12 * prog(t, e - 0.3, e));
    u.shadowK!.value = 0.62; u.penumbra!.value = 0.13;
    this.pass.render(renderer, out);

    // 說明：寫在主角那一面的牆上，跟著鏡頭一起動
    if (this.cap?.has && L.col) {
      const cap = this.cap;
      if (cap.draw(t)) {
        const pad = cap.pad;
        const a = cam.project(S(L.col.x - pad, L.col.y - pad));
        const b = cam.project(S(L.col.x - pad + 100, L.col.y - pad));
        const op = prog(t, this.tOpen + 0.2, this.tOpen + 0.8, ease.outCubic) * (1 - prog(t, e - 0.3, e));
        drawLayer(this.ctx, cap.L, out, a.x, a.y, op, (b.x - a.x) / 100);
      }
    }
    return { bloom: 0.22, bloomThreshold: 1.05, halation: 0.1, vignette: 0.45 };
  }
}
