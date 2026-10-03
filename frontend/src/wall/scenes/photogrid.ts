// 照片版面「照片格」（暗底，六張）：3×2 的燈箱格子浮在暗處，一格一格在拍點亮起，最後主角那格浮出來放大——
//  - 格子是 4:3 的燈箱：比例接近的照片填滿（繞著焦點裁），直的、很小的照片完整放在格子中間，旁邊用同一張照片模糊壓暗當底（不硬裁）。
//  - 進場時鏡頭斜斜地看著整面格子（有透視），格子全暗；配角五格依序在拍點「啪」地亮起（亮一下再收回），
//    亮起來的格子在後面的牆上染出一點它自己的顏色；主角那格最後亮。
//  - 主角那格往鏡頭浮出來，同時從格子的比例長成照片原本的比例（完整、不裁），其他格子退到後面、暗下去、失焦；鏡頭轉正。
//    浮出來之後主角的畫面往新人點的焦點慢慢推。
//  - 字：主角浮出來之後寫在它右邊一欄（主字＝賓客留言＋署名或新人的註解，一個字一個字寫出來；下面小一號的跟唱歌詞），
//    沒有主字時歌詞放在同一個位置跟唱；兩樣都沒有時主角浮到正中間。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, mulberry32, prog } from '../engine/util';
import { Cam, Caption, beatTimes, card, cardsPass, contain, coverCrop, drawLayer, hasWords, loadSlots, nearAspect, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, stand, type Card, type Slot } from './_p10';

// prefers（導演先挑適合接下來照片的版面）：4:3 的燈箱格子：橫的照片、4:3 的舊照片填滿格子，直的要用模糊的底補。其他照片也撐得住。
// thumbAt：後台縮圖拍六格都亮了、主角還沒浮出來的那一刻（收尾的畫面只剩主角，看不出是好幾張）。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 6, energy: [0.25, 1], bars: [4, 8], weight: 1, prefers: ['landscape', 'small'], thumbAt: 0.187 };

const FOV = 30;
/** 格子：4:3、間隔。 */
const CW = 470, CH = 352, GAP = 20;
/** 主角浮出來多高。 */
const LIFT = 240;
const BG_Z = -60;

const PRE = /* glsl */ `
  // kind 1：照片比例跟格子差很多 → 同一張照片模糊壓暗當底（cFx2.w 是照片的寬高比）
  // （只留一個出口：中途 return 會讓 ANGLE／D3D 出 X4000 警告，編出來的結果可能不一樣）
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    vec3 col = C_INK;
    if (cPh[i].w >= 0.5) {
      float A = cFx2[i].w, Ac = hb.x / hb.y;
      vec2 uv = 0.5 + q / (2.0 * hb) * vec2(min(1.0, Ac / A), min(1.0, A / Ac)) * 0.92;
      col = photoBlur(int(cPh[i].z + 0.5), uv, 4.0, vec2(0.04)) * 0.22;
    }
    return col;
  }
  vec3 backColor(int i, vec2 q, vec2 hb) { return C_INK; }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    // 燈箱：亮度就是 dim（配角亮起、主角浮出都在 JS 算）；邊緣一圈很細的亮框
    vec2 hb = cBox[i].xy;
    float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
    vec3 c = base + C_BONE * 0.05 * smoothstep(2.5, 0.0, e) * step(0.6, cFx[i].z);
    return c;
  }
`;

const POST = /* glsl */ `
  uniform float wallK;
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    float t = (${BG_Z.toFixed(1)} - ro.z) / rd.z;
    vec3 col = C_INK * 0.6;
    if (t > 0.0) {
      vec3 hp = ro + rd * t;
      float n = fbm(hp.xy / 300.0, 2);
      col = mix(C_INK, C_INK2, 0.45) * (0.5 + 0.12 * n);
      // 亮著的格子在牆上染出它自己的顏色（照片最小的 mip 層＝平均色）
      for (int i = 0; i < NC; i++) {
        if (i >= nCards) break;
        float lit = clamp((cFx[i].z - 0.2) / 0.8, 0.0, 1.0) * cFx[i].w;
        if (lit <= 0.0 || cPh[i].z < -0.5) continue;
        float d = max(sdBox(cardQ(i, hp), cBox[i].xy), 0.0);
        vec3 avg = photoAt(int(cPh[i].z + 0.5), vec2(0.5), 11.0);
        col += avg * lit * 0.05 * exp(-d / 60.0) * wallK;
      }
    }
    return col;
  }
  vec3 finish(vec3 col, vec2 p, vec3 rd) { return col; }
`;

const PASS = () => cardsPass(PRE, POST, { wallK: { value: 1 } });

export default class Photogrid extends Scene {
  pass = shared('photogrid.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  cam = new Cam(FOV);
  cards: Card[] = Array.from({ length: 6 }, () => card());
  /** 每張在格子裡的位置（0..5）、亮起的時間。 */
  cell: number[] = [];
  tOn: number[] = [];
  /** 每張在格子裡的照片大小與裁切。 */
  fits: { pw: number; ph: number; crop: [number, number, number, number]; fill: boolean }[] = [];
  tLift = 0;
  /** 主角放大後在畫面上的位置與大小（基準鏡頭、z = LIFT 那一面）。 */
  big = { x: 960, y: 520, hw: 400, hh: 300 };
  col: { x: number; y: number } | null = null;
  dir = 1;

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 6);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    const rnd = mulberry32(this.seed * 7 + 3);
    this.dir = rnd() < 0.5 ? -1 : 1;
    // 主角放在上排中間或下排中間（放大時離畫面中心近）；配角隨機填其他格
    const mainCell = rnd() < 0.5 ? 1 : 4;
    const others = [0, 1, 2, 3, 4, 5].filter((c) => c !== mainCell);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [others[i], others[j]] = [others[j]!, others[i]!]; }
    this.cell = [mainCell, ...others];
    this.fits = this.slots.map((sl) => {
      if (nearAspect(sl.aspect, CW / CH, 0.22)) return { pw: CW / 2, ph: CH / 2, crop: coverCrop(sl, CW / CH), fill: false };
      const [pw, ph] = contain(sl, CW, CH);
      return { pw, ph, crop: [0, 0, 1, 1] as [number, number, number, number], fill: true };
    });
    // 亮起的順序：配角照順序（打散的格子），主角最後
    const span = Math.min(4.6, (end - start) * 0.42);
    const times = beatTimes(audio, start + 0.25, 6, span);
    this.tOn = [times[5]!, ...times.slice(0, 5)];
    this.tLift = this.tOn[0]! + Math.min(0.5, Math.max(0.25, (end - start) * 0.06));

    const main = refs[0]!;
    const hasText = hasWords(this.ctx);
    const s0 = this.slots[0]!;
    // 主角放大後：有字時在左邊（字在右邊一欄），沒有字時在中間；很小的照片最多放大約 1.45 倍
    if (hasText) {
      // 一欄寬 540：60 字的長留言 40 px 排五行；主角最寬 1080，整組右緣不超過 1824（離邊 96 px）
      const [hw, hh] = contain(s0, 1080, 820);
      const colW = 540;
      const gx = Math.max(120, (1920 - (2 * hw + 80 + colW)) / 2);
      this.big = { x: gx + hw, y: 520, hw, hh };
      this.col = { x: gx + 2 * hw + 80, y: 0 };
      this.cap = new Caption(this.ctx, main, {
        family: F.hand(400), w: colW, h: 600, min: 40, max: 52, lineHeight: 1.4, maxLines: 5,
        color: rgba('bone', 0.95), active: rgba('signal'), unsung: rgba('bone', 0.3), shadow: rgba('ink', 0.7), shadowBlur: 10,
        sigColor: rgba('bone', 0.75), album: { family: F.hei(500), size: 20, color: rgba('signal', 0.85), tracking: 8 }, write: 0.05,
      }, (x) => this.track(x));
      await this.cap.init();
      // 字塊跟主角的中心對齊；這一欄會伸到 x ≥ 1360，所以下緣停在 HUD 區（y = 830）上面
      this.col.y = clamp(520 - this.cap.blockH / 2, 120, 800 - this.cap.blockH);
      this.cap.writeFrom(this.tLift + 0.7, 1.8);
    } else {
      const [hw, hh] = contain(s0, 1440, 820);
      this.big = { x: 930, y: 510, hw, hh };
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const cam = this.cam;
    const D = cam.D;
    // 0 → 1：主角浮出、放大；鏡頭從斜看轉正
    const L = ease.inOutCubic(prog(t, this.tLift, this.tLift + 1.0));
    const settle = ease.inOutQuad(prog(t, s, this.tLift + 1.0));
    const yaw = this.dir * lerp(0.3, 0.0, settle) + this.dir * 0.02 * (1 - Math.exp(-Math.max(0, t - this.tLift - 1) / 6));
    const pitch = lerp(0.11, 0, settle);
    const dist = D * (lerp(1.08, 1.0, settle) - 0.025 * (1 - Math.exp(-Math.max(0, t - this.tLift) / 6)));
    cam.rest(FOV);
    const look = new THREE.Vector3(lerp(this.dir * -120, 0, settle), lerp(-40, 0, settle), 0);
    cam.pos.set(look.x + Math.sin(yaw) * Math.cos(pitch) * dist, look.y + Math.sin(pitch) * dist, look.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.target.copy(look);
    cam.update();

    const gridW = 3 * CW + 2 * GAP, gridH = 2 * CH + GAP;
    // 主角在放大後，其他格往後退一點、失焦
    const recede = L;
    const order: Card[] = [];
    this.slots.forEach((sl, i) => {
      const cd = this.cards[i]!;
      const c = this.cell[i]!;
      const gx = -gridW / 2 + CW / 2 + (c % 3) * (CW + GAP), gy = gridH / 2 - CH / 2 - Math.floor(c / 3) * (CH + GAP);
      const fit = this.fits[i]!;
      // 亮起：暗 → 一下子比較亮 → 回到正常
      const on = this.tOn[i]!;
      const dim = lerp(0.1, 1.12, prog(t, on, on + 0.1)) - 0.12 * prog(t, on + 0.1, on + 0.5, ease.outCubic);
      if (i === 0) {
        // 主角：從格子浮出來，長成照片本來的比例
        const b = this.big;
        const zp = LIFT * L;
        const k = (D - zp) / D;
        const tw = b.hw * k, th = b.hh * k;
        const tx = (b.x - 960) * k, ty = (540 - b.y) * k;
        const hw = lerp(CW / 2, tw, L), hh = lerp(CH / 2, th, L);
        stand(cd, new THREE.Vector3(lerp(gx, tx, L), lerp(gy, ty, L), zp), 0);
        cd.hw = hw; cd.hh = hh;
        // 浮出來就開始往焦點推（燈箱像螢幕：推到 1.24 倍）
        const push = settleK(t - this.tLift, 5);
        // 從格子的樣子（cover 或 contain＋模糊底）漸漸變成完整的照片
        if (fit.fill) {
          const pw = lerp(fit.pw, tw, L), ph = lerp(fit.ph, th, L);
          setPhoto(cd, sl, 0, pw, ph, pushCrop(sl, pw, ph, push, 1.24, 2 * tw));
        } else {
          // 裁切跟著框的比例慢慢放開成整張（照片不會被拉扁），一直繞著焦點
          setPhoto(cd, sl, 0, hw, hh, pushCrop(sl, hw, hh, push, 1.24, 2 * tw));
        }
        cd.kind = fit.fill && L < 0.999 ? 1 : 0;
        cd.dim = dim;
        cd.blur = 0;
      } else {
        stand(cd, new THREE.Vector3(gx * (1 + 0.22 * recede), gy * (1 + 0.22 * recede), -380 * recede), 0);
        cd.hw = CW / 2; cd.hh = CH / 2;
        setPhoto(cd, sl, i, fit.pw, fit.ph, fit.crop);
        cd.kind = fit.fill ? 1 : 0;
        cd.dim = dim * lerp(1, 0.09, recede);
        cd.blur = 8 * recede;
      }
      cd.extra = sl.aspect;
      cd.cast = 0;
      cd.alpha = 1;
      order.push(cd);
    });
    // 主角最後畫（浮在最前面）
    const main = order.shift()!;
    order.push(main);
    setCards(this.pass, order);
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);
    const u = this.pass.u;
    u.wallK!.value = lerp(1, 0.25, recede);
    u.k!.value = lerp(0.8, 1, ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.pass.render(renderer, out);

    if (this.cap?.has && this.col) {
      const cap = this.cap;
      if (cap.draw(t)) {
        const op = prog(t, this.tLift + 0.6, this.tLift + 1.1, ease.outCubic) * (1 - prog(t, e - 0.3, e));
        if (op > 0) drawLayer(this.ctx, cap.L, out, this.col.x - cap.pad, this.col.y - cap.pad, op);
      }
    }
    return { bloom: 0.2, bloomThreshold: 1.08, halation: 0.1, vignette: 0.5 };
  }
}
