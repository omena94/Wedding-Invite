// 照片版面「立方體」（暗底，四張）：一個深色的方盒浮在攝影棚裡，四個側面嵌著四張照片，在拍點一次轉九十度，最後主角那面轉到正前方——
//  - 盒子是霧黑的，照片完整嵌在每一面的中間（不裁），邊緣有細細的倒角反光；頂面也看得到（鏡頭在斜上方）。
//  - 每一拍轉一面：很快地轉過去、稍微過頭再回來，轉的時候盒子往上跳一點點；配角三面依序轉過，主角最後、停最久。
//  - 背景是攝影棚的無縫背景紙：盒子後面一團淡淡的光（帶一點主題色），地面上有盒子的軟影子，遠處暗下去。
//  - 主角轉到正面後鏡頭慢慢推近，面上的畫面也往新人點的焦點推；
//    字在右邊一欄（盒子往左站）：主角的主字（賓客留言＋署名，或新人的註解）＋下面小一號的跟唱歌詞，
//    沒有主字時歌詞放在同一個位置跟唱；兩樣都沒有時盒子在正中間。
//  - 主角那面的大小照主角的比例做；側面的寬照另外兩張的比例；照片在面上完整放，四周是盒子本身的黑。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { F } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { Cam, Caption, beatTimes, byDepth, card, cardsPass, contain, drawLayer, hasWords, loadSlots, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, toneLin, type Card, type Slot } from './_p10';

// prefers（導演先挑適合接下來照片的版面）：方的、橫的照片讓盒子接近立方體，每一面都填得滿。其他照片也撐得住。
// thumbAt：後台縮圖拍主角剛轉到正面，側面還看得到上一張的那一刻（收尾的畫面只剩主角，看不出是好幾張）。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 4, energy: [0.3, 1], bars: [3, 8], weight: 1, prefers: ['square', 'landscape'], thumbAt: 0.213 };

const FOV = 30;
/** 照片四周盒子本身的邊。 */
const MAT = 26;

const PRE = /* glsl */ `
  uniform vec3 glow; uniform vec3 glowC; uniform float glowK;
  // 攝影棚的無縫背景紙：盒子後面一團淡淡的光（帶一點主題色；知道主角的色調時偏向它），四周暗下去
  vec3 backdrop(vec3 rd) {
    vec2 d = rd.xy / max(0.25, abs(rd.z)) - glow.xy;
    float g = exp(-dot(d, d) / glow.z);
    return C_INK * 0.55 + mix(mix(C_INK2, C_BLOOD, 0.12), glowC, glowK) * 0.42 * g;
  }
  // 霧黑的盒面：四邊一圈倒角（靠光的那邊亮一點）；照片的邊有一道很細的嵌線
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
    vec3 c = C_INK2 * (1.0 + 0.06 * snoise(q / 90.0));
    c += C_BONE * 0.06 * smoothstep(4.0, 0.0, e);
    vec2 pq = q - cPh[i].xy;
    float dp = sdBox(pq, cBox[i].zw);
    c = mix(c, C_INK * 0.7, smoothstep(3.0, 0.0, abs(dp - 1.5)) * step(-0.5, cPh[i].z));
    return c;
  }
  vec3 backColor(int i, vec2 q, vec2 hb) { return C_INK; }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    float lam = max(dot(n, lightDir), 0.0);
    float face = max(dot(n, -rd), 0.0);
    // 照片要看得清楚：正對鏡頭的照片亮度只跟著光稍微變
    float lit = mix(0.35 + 0.9 * lam, 0.5 + 0.5 * mix(lam, 1.0, 0.55), isPh) * mix(0.6, 1.0, face);
    vec3 c = base * lit;
    // 亮漆／玻璃：映出背景紙的光（側面斜看時更明顯），主光的反光在轉動時滑過
    vec3 r = reflect(rd, n);
    float fres = 0.04 + 0.5 * pow(1.0 - face, 4.0);
    c += backdrop(r) * mix(0.9, 0.25, isPh) * fres;
    vec3 h = normalize(lightDir - rd);
    c += C_BONE * 0.07 * pow(max(dot(n, h), 0.0), 60.0);
    return c;
  }
`;

const POST = /* glsl */ `
  uniform float floorY;
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    vec3 col = backdrop(rd);
    if (rd.y < -0.001) {
      float t = (floorY - ro.y) / rd.y;
      vec3 hp = ro + rd * t;
      // 無縫背景紙的地面：顏色跟背景紙接得起來（看不出地平線），只多了盒子的軟影子
      float sh = shadowAt(hp, -1);
      col *= mix(1.0, sh, smoothstep(-2600.0, -300.0, hp.z));
    }
    return col;
  }
  vec3 finish(vec3 col, vec2 p, vec3 rd) { return col; }
`;

const PASS = () => cardsPass(PRE, POST, {
  floorY: { value: -500 }, glow: { value: new THREE.Vector3(0, 0.05, 0.12) }, glowC: { value: new THREE.Vector3() }, glowK: { value: 0 },
});

export default class Cube extends Scene {
  pass = shared('cube.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  cam = new Cam(FOV);
  /** 四個側面＋頂面。 */
  cards: Card[] = Array.from({ length: 5 }, () => card());
  /** 盒子的寬（正面、背面）、深（側面）、高。 */
  a = 600; b = 500; h = 500;
  /** 每一面（0..3）放哪一張、照片半寬高。面 0 是主角，轉的順序是 3 → 2 → 1 → 0。 */
  faces: { slot: number; pw: number; ph: number }[] = [];
  turns: number[] = [];
  turnDur = 0.5;
  cx = 0;
  col: { x: number; y: number } | null = null;

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 4);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    const main = refs[0]!;
    const hasText = hasWords(this.ctx);
    const [s0, s1, s2, s3] = this.slots as [Slot, Slot, Slot, Slot];
    // 盒子的大小：正面照主角的比例（很小的照片最多放大約 1.45 倍）
    const [pw, ph] = contain(s0, hasText ? 720 : 820, hasText ? 560 : 600);
    this.a = 2 * (pw + MAT); this.h = 2 * (ph + MAT);
    const inner = this.h - 2 * MAT;
    this.b = clamp(((s1.aspect + s3.aspect) / 2) * inner + 2 * MAT, 0.62 * this.h, 1.1 * this.a);
    const fit = (sl: Slot, w: number): [number, number] => contain(sl, w - 2 * MAT, inner);
    // 面 3（第一張轉到前面的）放第 2 張、面 2 放第 3 張、面 1 放第 4 張、面 0 是主角
    this.faces = [
      { slot: 0, pw, ph },
      { slot: 3, ...toObj(fit(s3, this.b)) },
      { slot: 2, ...toObj(fit(s2, this.a)) },
      { slot: 1, ...toObj(fit(s1, this.b)) },
    ];
    const dur = end - start;
    const span = clamp(dur * 0.45, 1.1, 4.8);
    this.turns = beatTimes(audio, start + 0.45, 3, span);
    const gap = this.turns.length > 1 ? this.turns[1]! - this.turns[0]! : 0.6;
    this.turnDur = clamp(gap * 0.75, 0.22, 0.55);
    this.cx = hasText ? -330 : 0;
    if (hasText) {
      this.cap = new Caption(this.ctx, main, {
        family: F.ming(500), w: 500, h: 640, min: 40, max: 50, lineHeight: 1.42, maxLines: 6, sigColor: rgba('bone', 0.75),
        color: rgba('bone', 0.95), active: rgba('signal'), unsung: rgba('bone', 0.3), shadow: rgba('ink', 0.75), shadowBlur: 12,
        rule: { color: rgba('signal', 0.85), w: 60 }, album: { family: F.hei(500), size: 20, color: rgba('ash', 0.9), tracking: 8 },
      }, (x) => this.track(x));
      await this.cap.init();
      // 右邊一欄（x 1290～1790）：這一欄在 HUD 區的上面（x ≥ 1360），下緣停在 y = 800
      this.col = { x: 1290, y: clamp(500 - this.cap.blockH / 2, 120, 800 - this.cap.blockH) };
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const cam = this.cam;
    const D = cam.D;
    // 轉：從面 3 在正前方開始，每一拍轉九十度（稍微過頭再回來），最後面 0（主角）在正前方
    // 停著的時候斜一點（看得到正面與左邊那一面＝下一張）；主角轉到正面後慢慢轉正一些
    let yaw = (-3 * Math.PI) / 2 + lerp(0.36, 0.16, ease.inOutQuad(clamp((t - (this.turns[this.turns.length - 1] ?? s)) / 3)));
    let hop = 0;
    for (const t0 of this.turns) {
      const p = prog(t, t0, t0 + this.turnDur);
      yaw += (Math.PI / 2) * ease.outBack(p, 1.4);
      hop += Math.sin(Math.PI * clamp(p * 1.3)) * 18;
    }
    const last = this.turns[this.turns.length - 1]! + this.turnDur;
    const after = 1 - Math.exp(-Math.max(0, t - last) / 6);
    // 盒子：慢慢上下浮、往一邊歪一點點
    const bob = 8 * Math.sin((t - s) * 1.3);
    const rock = 0.035 * Math.sin((t - s) * 0.7 + hash(this.seed, 2) * 6);
    const center = new THREE.Vector3(this.cx, 20 + bob + hop, -this.b / 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, yaw, rock, 'XYZ'));
    // 鏡頭：斜上方，主角轉到正面後慢慢推近
    cam.rest(FOV);
    cam.pos.set(this.cx * 0.25, 240 - 40 * after, D * (0.98 - 0.06 * after));
    cam.target.set(this.cx * 0.1, -10, -this.b / 2);
    cam.update();

    const list: Card[] = [];
    const W2 = [this.a, this.b, this.a, this.b];
    for (let k = 0; k < 4; k++) {
      const cd = this.cards[k]!;
      const fc = this.faces[k]!;
      const ang = (k * Math.PI) / 2;
      const depth = (k % 2 === 0 ? this.b : this.a) / 2;
      const lc = new THREE.Vector3(Math.sin(ang) * depth, 0, Math.cos(ang) * depth);
      cd.c.copy(lc.applyQuaternion(q)).add(center);
      cd.u.set(Math.cos(ang), 0, -Math.sin(ang)).applyQuaternion(q);
      cd.v.set(0, -1, 0).applyQuaternion(q);
      cd.hw = W2[k]! / 2; cd.hh = this.h / 2;
      // 主角那面轉到正前方之後，面上的畫面往焦點慢慢推（1.22 倍）
      const sl = this.slots[fc.slot]!;
      setPhoto(cd, sl, fc.slot, fc.pw, fc.ph, k === 0 ? pushCrop(sl, fc.pw, fc.ph, settleK(t - last, 5), 1.22) : undefined);
      cd.kind = 0; cd.dim = 1; cd.blur = 0; cd.cast = 1; cd.alpha = 1; cd.radius = 2;
      list.push(cd);
    }
    // 頂面（沒有照片）
    const top = this.cards[4]!;
    top.c.set(0, this.h / 2, 0).applyQuaternion(q).add(center);
    top.u.set(1, 0, 0).applyQuaternion(q);
    top.v.set(0, 0, 1).applyQuaternion(q);
    top.hw = this.a / 2; top.hh = this.b / 2; top.slot = -1; top.pw = 0; top.ph = 0; top.kind = 0; top.dim = 1; top.blur = 0; top.cast = 1; top.alpha = 1; top.radius = 2;
    list.push(top);
    // 只畫面向鏡頭的面（盒子是實心的）
    const vis = list.filter((cd) => new THREE.Vector3().crossVectors(cd.v, cd.u).dot(new THREE.Vector3().subVectors(cam.pos, cd.c)) > 0);
    setCards(this.pass, byDepth(vis, cam));
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);
    const u = this.pass.u;
    u.floorY!.value = -this.h / 2 - 260;
    (u.glow!.value as THREE.Vector3).set(this.cx / D * 0.6, 0.06, 0.14);
    // 光的顏色偏向主角照片的色調（亮度不變）；不知道色調時照主題色
    const base = [0, 1, 2].map((i) => LIN.ink2[i]! + (LIN.blood[i]! - LIN.ink2[i]!) * 0.12);
    const tone = toneLin(this.slots[0]!.ref, base);
    if (tone) (u.glowC!.value as THREE.Vector3).set(...tone);
    u.glowK!.value = tone ? 0.5 : 0;
    u.lightDir!.value.set(-0.45, 0.7, 0.55).normalize();
    u.shadowK!.value = 0.55; u.penumbra!.value = 0.35;
    u.k!.value = lerp(0.55, 1, ease.outCubic(prog(t, s, s + 0.45))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.pass.render(renderer, out);

    if (this.cap?.has && this.col) {
      const cap = this.cap;
      if (cap.draw(t)) {
        const op = prog(t, last - 0.1, last + 0.4, ease.outCubic) * (1 - prog(t, e - 0.3, e));
        if (op > 0) drawLayer(this.ctx, cap.L, out, this.col.x - cap.pad, this.col.y - cap.pad, op);
      }
    }
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.1, vignette: 0.5 };
  }
}

const toObj = ([pw, ph]: [number, number]) => ({ pw, ph });
