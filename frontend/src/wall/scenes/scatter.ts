// 照片版面「散落桌面」（亮，四張）：幾張洗好的相片一張一張落在灑著窗光的原木桌上——
//  - 相片有白邊、微微反光；從鏡頭上方掉下來（離桌面越高影子越遠越軟），落地時滑一下、轉回來、停住。
//  - 配角三張先落在四周，主角最後落在最上面（最大、在中間偏左），接著一張索引卡落在主角旁邊，主字（賓客留言＋署名，或新人的註解）
//    用手寫字一個字一個字寫上去（卡片的橫線跟字的行距對齊），下面小一號跟唱這段的歌詞。
//    沒有主字時歌詞寫在卡上跟唱；兩樣都沒有就沒有卡，主角落在正中間。
//  - 桌面是淺色原木，午後的陽光從左上的窗戶照進來，窗格的影子斜斜落在桌上與相片上，很慢地移動。
//  - 鏡頭從斜上方看桌面（一點點透視），最後很慢地推向主角相片上新人點的焦點，相片上的畫面也往焦點推一點。
//  - 照片完整呈現（實體相片不裁），橫的直的都可以；很小的舊照片最多放大約 1.45 倍。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, mulberry32, prog } from '../engine/util';
import { Cam, Caption, GLSL_INK, beatTimes, card, cardsPass, contain, hasWords, lay, loadSlots, mipLayer, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, type Card, type Slot } from './_p10';

// prefers（導演先挑適合接下來照片的版面）：洗出來的實體相片散在桌上：直的、方的、小張的舊照片最像真的相片。其他照片也撐得住。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 4, paper: true, energy: [0, 1], bars: [3, 8], weight: 1, prefers: ['portrait', 'square', 'small'] };

const FOV = 30;
/** 鏡頭往下看的角度（弧度）：一點點透視，桌面看起來是平放的。 */
const PITCH = 0.16;
/** 索引卡的字層多大（卡片就是字層的大小）。 */
const CARD_W = 600, CARD_H = 380, CARD_PAD = 36;

const PRE = /* glsl */ `
  uniform sampler2D txt; uniform float txtLod; uniform vec2 txtSize; uniform vec4 rule; uniform float sun;
  ${GLSL_INK}
  // 窗光：左上的窗戶照進來的一大片斜斜的光，窗格的影子是兩條軟軟的暗線；很慢地移動
  float windowLight(vec2 w) {
    // 窗戶的光斜斜地落在桌上：一個歪的平行四邊形，裡面一直一橫兩條窗框的影子
    vec2 q = rot2(-0.2) * (w - vec2(-200.0 + sun, 170.0));
    q.x += 0.55 * q.y;
    float a = smoothstep(-820.0, -600.0, q.x) * smoothstep(820.0, 600.0, q.x) * smoothstep(-470.0, -300.0, q.y) * smoothstep(470.0, 320.0, q.y);
    float bars = 1.0 - 0.45 * exp(-pow((q.x - 60.0) / 20.0, 2.0)) - 0.45 * exp(-pow((q.y + 20.0) / 16.0, 2.0));
    return a * bars;
  }
  // （只留一個出口：中途 return 會讓 ANGLE／D3D 出 X4000 警告，編出來的結果可能不一樣）
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    float kind = cPh[i].w;
    vec3 col;
    if (kind > 1.5) {
      // 索引卡：米白，最上面一條紅線，下面藍色的橫線（跟字的行距對齊）
      vec3 c = mix(C_BONE, C_PAPER, 0.35) * 0.93;
      float y = q.y + hb.y;
      float red = exp(-pow((y - rule.z) / 1.1, 2.0));
      float ln = 0.0;
      if (y > rule.x - rule.y * 0.3 && y < min(2.0 * hb.y - 12.0, rule.w)) ln = exp(-pow((mod(y - rule.x + 0.5 * rule.y, rule.y) - 0.5 * rule.y) / 0.9, 2.0));
      c = mix(c, C_COLLAR * 0.8, red * 0.55);
      c = mix(c, C_GRAPHITE, ln * 0.3);
      vec4 ink = inkAt(txt, q, hb, txtSize, txtLod + log2(pxw * 1.5 * PX_SCALE));
      col = c * (1.0 - ink.a) + ink.rgb;
    } else {
      // 相片的白邊：相紙的白，不發光（比 bone 再暗一點）
      float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
      col = C_BONE * 0.9 * (1.0 - 0.05 * smoothstep(2.0, 0.0, e));
    }
    return col;
  }
  vec3 backColor(int i, vec2 q, vec2 hb) { return C_BONE * 0.85; }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    float sh = shadowAt(hp, i);
    float wl = windowLight(hp.xy);
    float lit = 0.74 + 0.26 * wl * sh;
    lit *= mix(1.0, 0.82, 1.0 - sh);
    vec3 c = base * lit;
    // 相紙的光澤：窗光的反射（Blinn），只在相片上、只在有光的地方
    vec3 h = normalize(lightDir - rd);
    c += C_BONE * 0.07 * pow(max(dot(n, h), 0.0), 90.0) * wl * isPh * sh;
    return c;
  }
`;

const POST = /* glsl */ `
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    float t = -ro.z / rd.z;
    vec3 hp = ro + rd * t;
    vec2 w = hp.xy;
    // 淺色原木：木板沿著 x，木紋、年輪的細線，木板之間的縫
    float plank = floor((w.y + 2000.0) / 340.0);
    float g = snoise(vec2(w.x / 520.0 + plank * 7.3, w.y / 18.0 + plank)) * 0.5 + snoise(vec2(w.x / 140.0, w.y / 5.0 + plank * 3.1)) * 0.2;
    vec3 oak = mix(C_PAPER, C_FUR, 0.3 + 0.05 * hash11(plank)) * (0.8 + 0.07 * g);
    float seam = abs(mod(w.y + 2000.0, 340.0) - 0.5);
    oak *= 1.0 - 0.28 * exp(-seam * seam / 3.0);
    float sh = shadowAt(hp, -1);
    float wl = windowLight(w);
    vec3 col = oak * (0.72 + 0.28 * wl * sh) * mix(1.0, 0.8, 1.0 - sh);
    return col;
  }
  vec3 finish(vec3 col, vec2 p, vec3 rd) { return col; }
`;

const PASS = () => cardsPass(PRE, POST, {
  txt: { value: null }, txtLod: { value: 0 }, txtSize: { value: new THREE.Vector2(1, 1) }, rule: { value: new THREE.Vector4(60, 60, 0, 1e4) }, sun: { value: 0 },
});

interface Drop { base?: THREE.Vector3; slot: number; x: number; y: number; a: number; hw: number; hh: number; pw: number; ph: number; t: number; from: THREE.Vector2; spin: number }

export default class Scatter extends Scene {
  pass = shared('scatter.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  cam = new Cam(FOV);
  cards: Card[] = Array.from({ length: 5 }, () => card());
  drops: Drop[] = [];
  /** 索引卡（沒有字時 null）。 */
  note: Drop | null = null;
  focus = new THREE.Vector3();

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 4);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    const rnd = mulberry32(this.seed * 13 + 5);
    const main = refs[0]!;
    const hasText = hasWords(this.ctx);
    this.restCam();
    // 時間：配角三張、主角、（索引卡）一拍一個落下，配角在窗格前四成內落完
    const span = Math.min(4.2, Math.max(1.2, (end - start) * 0.45));
    const times = beatTimes(audio, start + 0.35, hasText ? 5 : 4, span);
    // 索引卡（有字時）：先排字，才知道卡片多大。主字（留言＋署名或註解）手寫在橫線上，下面小一號跟唱這段的歌詞
    if (hasText) {
      this.cap = new Caption(this.ctx, main, {
        family: F.hand(400), w: CARD_W, h: CARD_H, min: 40, max: 50, lineHeight: 1.36, maxLines: 4, pad: CARD_PAD, scale: 1.5,
        color: rgba('sepia', 0.92), active: mixRgba('signal', 'sepia', 0.45), unsung: rgba('sepia', 0.3), sigColor: rgba('sepia', 0.72), write: 0.06,
        album: { family: F.hand(700), size: 24, color: rgba('collar', 0.75), tracking: 4 }, headGap: 30,
      }, (x) => this.track(x));
      await this.cap.init();
      mipLayer(this.cap.L);
    }
    // 卡片照字的多寡裁高（至少像一張索引卡的比例；比字層高的地方只有空白的橫線）
    // 卡寬照字的寬（短留言不用一張大卡；字靠左，卡比字層窄時右邊沒有字的地方剛好裁掉）
    const cw = this.cap ? Math.min(this.cap.L.w, Math.max(this.cap.text.width + 2 * CARD_PAD + 12, 460)) : 0;
    const ch = this.cap ? Math.max(this.cap.usedH, 0.5 * cw) : 0;
    // 主角：有字時主角＋卡片當一組置中（主角在左、卡在右），沒有字時主角在中間；白邊依照片大小
    const s0 = this.slots[0]!;
    const [pw, ph] = contain(s0, hasText ? 760 : 900, hasText ? 620 : 680);
    const bd = clamp(0.05 * Math.min(pw, ph) * 2, 16, 34);
    const GAPC = 70;
    const x0 = hasText ? Math.max(110, (1880 - (2 * (pw + bd) + GAPC + cw)) / 2) : 0;
    const mx = hasText ? x0 + pw + bd : 930, my = hasText ? 500 : 510;
    const mainDrop: Drop = { slot: 0, x: mx, y: my, a: (rnd() * 2 - 1) * 0.05, hw: pw + bd, hh: ph + bd, pw, ph, t: times[3]!, from: new THREE.Vector2(-0.4, 1), spin: 0.22 };
    // 配角：主角四周（左上、右上、下面），一部分被主角壓住；面積最多主角的六成
    const zones = hasText
      ? [[mx - pw - 60, 270], [mx + pw + 180, 220], [mx - 80, 870]]
      : [[420, 300], [1460, 320], [1250, 820]];
    for (let i = 1; i < 4; i++) {
      const sl = this.slots[i]!;
      let [w, h] = contain(sl, 470, 380);
      const k = Math.min(1, Math.sqrt((0.6 * pw * ph) / (w * h)));
      w *= k; h *= k;
      const b = clamp(0.05 * Math.min(w, h) * 2, 12, 26);
      const z = zones[i - 1]!;
      this.drops.push({
        slot: i, x: clamp(z[0]! + (rnd() * 2 - 1) * 40, 150, 1500), y: z[1]! + (rnd() * 2 - 1) * 30, a: (rnd() * 2 - 1) * 0.16, hw: w + b, hh: h + b, pw: w, ph: h, t: times[i - 1]!,
        from: new THREE.Vector2(rnd() * 2 - 1, rnd() * 0.6 + 0.4).normalize(), spin: (rnd() < 0.5 ? -1 : 1) * (0.2 + 0.2 * rnd()),
      });
    }
    this.drops.push(mainDrop);
    if (this.cap) {
      this.note = {
        slot: -1, x: mx + pw + bd + GAPC + cw / 2, y: clamp(my + 40, 140 + ch / 2, 800 - ch / 2), a: (rnd() * 2 - 1) * 0.06, hw: cw / 2, hh: ch / 2, pw: 0, ph: 0, t: times[4]!,
        from: new THREE.Vector2(0.6, 0.8).normalize(), spin: -0.18,
      };
      this.cap.writeFrom(this.note.t + 0.25, 2.2);
    }
    // 落點（世界座標）用基準鏡頭算一次：之後鏡頭推近時，相片跟桌面一起動
    for (const d of [...this.drops, ...(this.note ? [this.note] : [])]) d.base = this.cam.unproject(d.x, d.y, 0);
    // 鏡頭最後要靠過去的點：主角相片上的焦點（新人點的臉；相片上的畫面也往它推，所以取相片中心跟焦點的中間）
    const fx = mx + (main.fx - 0.5) * pw, fy = my + (main.fy - 0.5) * ph;
    this.focus.copy(this.cam.unproject(fx, fy, 0));
  }

  private restCam() {
    const cam = this.cam;
    cam.rest(FOV);
    const D = cam.D;
    cam.pos.set(0, -Math.sin(PITCH) * D, Math.cos(PITCH) * D);
    cam.target.set(0, 0, 0);
    cam.update();
  }

  /** 落下中的一張：位置、角度、高度（t 決定）。 */
  private place(cd: Card, d: Drop, t: number, layer: number) {
    const fall = 0.42;
    const p = prog(t, d.t - fall, d.t);
    // 高度：自由落下（越掉越快），落地後彈一下下
    const dt = t - d.t;
    const bounce = dt > 0 ? 7 * Math.exp(-dt * 9) * Math.abs(Math.sin(dt * 22)) : 0;
    const z = 640 * (1 - p * p) + bounce + layer * 0.8;
    // 落地後往前滑一點點再停住
    const slide = dt > 0 ? 1 - ease.outCubic(clamp(dt / 0.4)) : 1;
    const air = 1 - p;
    const base = d.base!;
    const off = d.from.clone().multiplyScalar(900 * air * air + 22 * slide * (dt > 0 ? 1 : 0));
    const c = new THREE.Vector3(base.x + off.x, base.y + off.y, z);
    const a = d.a + d.spin * (air + 0.12 * slide * (dt > 0 ? 1 : 0));
    lay(cd, c, a);
    // 空中稍微傾斜（落地時放平）
    if (air > 0) {
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(d.from.y, -d.from.x, 0).normalize(), 0.35 * air);
      cd.u.applyQuaternion(tilt); cd.v.applyQuaternion(tilt);
    }
    cd.hw = d.hw; cd.hh = d.hh;
    cd.alpha = t > d.t - fall ? 1 : 0;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const cam = this.cam;
    const D = cam.D;
    // 鏡頭：主角落下後很慢地推向它相片上的焦點（一開始快、之後越來越慢）。有索引卡時只往那邊靠一點，卡上的字才一直在畫面裡
    const mainT = this.drops[3]!.t;
    const push = settleK(t - mainT, 5);
    const drift = ease.inOutQuad(clamp((t - s) / 14));
    const tgt = this.focus.clone().multiplyScalar((this.note ? 0.12 : 0.45) * push);
    cam.rest(FOV);
    const dist = D * (1.02 - 0.06 * push - 0.01 * drift);
    cam.pos.set(tgt.x + 20 * drift, tgt.y - Math.sin(PITCH) * dist, Math.cos(PITCH) * dist);
    cam.target.copy(tgt);
    cam.update();

    const list: Card[] = [];
    this.drops.forEach((d, i) => {
      const cd = this.cards[i]!;
      this.place(cd, d, t, i);
      // 主角相片上的畫面也往焦點推一點（實體相片：1.2 倍）
      const sl = this.slots[d.slot]!;
      setPhoto(cd, sl, d.slot, d.pw, d.ph, d.slot === 0 ? pushCrop(sl, d.pw, d.ph, push, 1.2) : undefined);
      cd.kind = 0; cd.blur = 0; cd.dim = 1; cd.cast = 1;
      list.push(cd);
    });
    if (this.note && this.cap) {
      const cd = this.cards[4]!;
      this.place(cd, this.note, t, 5);
      cd.slot = -1; cd.pw = 0; cd.ph = 0; cd.kind = 2; cd.blur = 0; cd.dim = 1; cd.cast = 1;
      list.push(cd);
      this.cap.draw(t);
      const u = this.pass.u;
      u.txt!.value = this.cap.L.texture;
      u.txtLod!.value = 0;
      // 橫線：第一行字的基線、行距（卡上座標，從卡的上緣算）。有主字時橫線只畫在主字那幾行下面
      // （署名、小一號的歌詞跟橫線的行距對不上，寫在橫線下面的空白）；歌詞自己當主字時整張都有橫線
      const cap = this.cap;
      const fit = cap.fit;
      const lh = fit ? fit.lineHeight : 48 * 1.36;
      const size = fit ? fit.size : 48;
      const first = cap.top + size * 0.9;
      const end = fit ? first + size * 0.12 + (fit.lines.length - 1) * lh + 2 : 1e4;
      (u.rule!.value as THREE.Vector4).set(first + size * 0.12, lh, first - size - 8, end);
      (u.txtSize!.value as THREE.Vector2).set(cap.L.w, cap.L.h);
    }
    // shader 是這個版面所有窗格共用的：沒有字的窗格要把上一個窗格（已經釋放）的字層拿掉
    if (!this.cap) this.pass.u.txt!.value = null;
    setCards(this.pass, list);
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);
    const u = this.pass.u;
    u.sun!.value = 30 * Math.sin((t - s) * 0.08);
    u.lightDir!.value.set(-0.5, 0.42, 0.76).normalize();
    u.shadowK!.value = 0.42; u.penumbra!.value = 0.09;
    u.k!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    this.pass.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.28 };
  }
}
