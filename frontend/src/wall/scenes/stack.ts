// 照片版面「照片疊」（亮，三張）：亞麻桌巾上一小疊洗好的相片，最上面那張在拍點被抽走、露出下一張，主角在最下面——
//  - 相片疊得不太整齊（每張偏一點、轉一點），彼此壓出細細的影子；被抽走的那張先往後縮一下，再抬起來、轉著滑出畫面
//    （抬得越高影子越遠越軟），一張往右上、一張往左下。
//  - 兩張抽完，主角露出來；鏡頭慢慢推近它相片上新人點的焦點、轉一點點，相片上的畫面也往焦點推一點。
//    接著一張半透明的描圖紙條從旁邊滑進來，躺在主角旁邊，主字（賓客留言＋署名，或新人的註解）印在紙條上（思源宋體），
//    下面小一號跟唱這段的歌詞；沒有主字時歌詞寫在紙條上跟唱；兩樣都沒有就沒有紙條，相片疊在正中間。
//  - 桌巾是米白的亞麻，看得到織紋與兩道很淡的摺痕；陰天的柔光從上面來，影子很軟。
//  - 照片完整呈現（實體相片不裁），每張的白邊照自己的大小；很小的舊照片最多放大約 1.45 倍。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, mulberry32, prog } from '../engine/util';
import { Cam, Caption, GLSL_INK, beatAfter, beatTimes, card, cardsPass, contain, hasWords, lay, loadSlots, mipLayer, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, type Card, type Slot } from './_p10';

// prefers（導演先挑適合接下來照片的版面）：一小疊實體相片：直的、方的、小張的舊照片疊起來最自然。其他照片也撐得住。
// thumbAt：後台縮圖拍第一張被抽起來、底下還疊著兩張的那一刻（收尾的畫面只剩主角，看不出是好幾張）。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 3, paper: true, energy: [0, 0.85], bars: [3, 8], weight: 1, prefers: ['portrait', 'square', 'small'], thumbAt: 0.061 };

const FOV = 30;
const PITCH = 0.1;

const PRE = /* glsl */ `
  uniform sampler2D txt; uniform vec2 txtSize;
  ${GLSL_INK}
  // （只留一個出口：中途 return 會讓 ANGLE／D3D 出 X4000 警告，編出來的結果可能不一樣）
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    vec3 col;
    if (cPh[i].w > 1.5) {
      // 描圖紙：米白、有一點透（JS 給它 0.9 的不透明度），很淡的纖維
      vec3 c = mix(C_BONE, C_PAPER, 0.3) * (0.9 + 0.02 * snoise(q / vec2(3.0, 40.0)));
      vec4 ink = inkAt(txt, q, hb, txtSize, log2(pxw * 1.5 * PX_SCALE));
      col = c * (1.0 - ink.a) + ink.rgb;
    } else {
      float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
      col = C_BONE * 0.9 * (1.0 - 0.06 * smoothstep(2.0, 0.0, e));
    }
    return col;
  }
  vec3 backColor(int i, vec2 q, vec2 hb) { return C_BONE * 0.84; }
  // 陰天的柔光：中間亮、四周暗一點
  float soft(vec2 w) { return 0.86 + 0.14 * exp(-dot(w / vec2(1300.0, 800.0), w / vec2(1300.0, 800.0))); }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    float sh = shadowAt(hp, i);
    vec3 c = base * soft(hp.xy) * mix(1.0, 0.8, 1.0 - sh);
    vec3 h = normalize(lightDir - rd);
    c += C_BONE * 0.05 * pow(max(dot(n, h), 0.0), 40.0) * isPh;
    return c;
  }
`;

const POST = /* glsl */ `
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    float t = -ro.z / rd.z;
    vec3 hp = ro + rd * t;
    vec2 w = hp.xy;
    float pxw = t / (focal * PX_SCALE);
    // 亞麻：經緯線（遠的時候淡掉，不會閃）、粗細不勻的竹節
    float fade = 1.0 - smoothstep(0.6, 1.6, pxw);
    float wx = 0.5 + 0.5 * sin(w.x * 1.15 + 0.6 * snoise(vec2(w.y / 40.0, w.x / 300.0)));
    float wy = 0.5 + 0.5 * sin(w.y * 1.15 + 0.6 * snoise(vec2(w.x / 40.0, w.y / 300.0)));
    float weave = mix(0.5, wx * 0.5 + wy * 0.5, fade);
    float slub = snoise(vec2(w.x / 90.0, w.y / 3.0)) * 0.5 + snoise(vec2(w.x / 3.0, w.y / 110.0)) * 0.5;
    vec3 col = mix(C_BONE, C_PAPER, 0.55) * (0.79 + 0.07 * weave + 0.03 * slub);
    // 兩道摺痕（很淡的亮暗）
    float c1 = (w.x * 0.8 + w.y * 0.6 - 420.0), c2 = (w.x * 0.2 - w.y * 0.98 + 260.0);
    col *= 1.0 + 0.03 * c1 / (abs(c1) + 40.0) * exp(-c1 * c1 / 30000.0) + 0.025 * c2 / (abs(c2) + 50.0) * exp(-c2 * c2 / 40000.0);
    col *= soft(w) * mix(1.0, 0.78, 1.0 - shadowAt(hp, -1));
    return col;
  }
  vec3 finish(vec3 col, vec2 p, vec3 rd) { return col; }
`;

const PASS = () => cardsPass(PRE, POST, { txt: { value: null }, txtSize: { value: new THREE.Vector2(1, 1) } });

interface Print { slot: number; base: THREE.Vector3; a: number; hw: number; hh: number; pw: number; ph: number; pull: number; dir: THREE.Vector2; spin: number }

export default class Stack extends Scene {
  pass = shared('stack.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  cam = new Cam(FOV);
  cards: Card[] = Array.from({ length: 4 }, () => card());
  /** 由下往上：主角、第二張、第三張（最上面）。 */
  prints: Print[] = [];
  slip: { base: THREE.Vector3; a: number; hw: number; hh: number; t: number } | null = null;
  focus = new THREE.Vector3();
  tReveal = 0;

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 3);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    const rnd = mulberry32(this.seed * 17 + 11);
    const main = refs[0]!;
    const hasText = hasWords(this.ctx);
    const cam = this.cam;
    cam.rest(FOV);
    cam.pos.set(0, -Math.sin(PITCH) * cam.D, Math.cos(PITCH) * cam.D);
    cam.update();
    if (hasText) {
      // 紙條上：主字（留言＋署名或註解）在上，下面小一號跟唱這段的歌詞；寬 560，60 字的長留言 40 px 排四、五行
      this.cap = new Caption(this.ctx, main, {
        family: F.ming(500), w: 560, h: 440, min: 40, max: 48, lineHeight: 1.42, maxLines: 4, pad: 34, scale: 1.5,
        color: rgba('sepia', 0.9), active: mixRgba('signal', 'sepia', 0.4), unsung: rgba('sepia', 0.3), tracking: 1, sigColor: rgba('sepia', 0.7),
        album: { family: F.hei(500), size: 20, color: rgba('sepia', 0.55), tracking: 8 },
      }, (x) => this.track(x));
      await this.cap.init();
      mipLayer(this.cap.L);
    }
    // 紙條照字的寬、高裁（短留言不用一大張；字靠左，紙條比字層窄時右邊沒有字的地方剛好裁掉）
    const sw = this.cap ? Math.min(this.cap.L.w, Math.max(this.cap.text.width + 2 * this.cap.pad + 12, 420)) : 0;
    const sh = this.cap ? this.cap.usedH : 0;
    // 相片疊：有字時跟紙條一組置中（疊在左、紙條在右）；沒有字時在正中間
    const s0 = this.slots[0]!;
    const [pw, ph] = contain(s0, hasText ? 760 : 960, hasText ? 680 : 720);
    const bd = clamp(0.05 * Math.min(pw, ph) * 2, 16, 32);
    const x0 = hasText ? Math.max(130, (1880 - (2 * (pw + bd) + 80 + sw)) / 2) : 0;
    const mx = hasText ? x0 + pw + bd : 930, my = hasText ? 520 : 510;
    // 抽走的時間：兩拍，在窗格前四成內抽完
    const span = Math.min(3.4, Math.max(0.9, (end - start) * 0.38));
    const pulls = beatTimes(audio, start + 0.55, 2, span);
    this.tReveal = pulls[1]! + 0.45;
    for (let i = 0; i < 3; i++) {
      const sl = this.slots[i]!;
      const [w, h] = i === 0 ? [pw, ph] : contain(sl, 2 * pw * 0.95, 2 * ph * 0.95);
      const b = i === 0 ? bd : clamp(0.05 * Math.min(w, h) * 2, 14, 30);
      const off = i === 0 ? [0, 0] : [(rnd() * 2 - 1) * 26, (rnd() * 2 - 1) * 22];
      this.prints.push({
        slot: i, base: cam.unproject(mx + off[0]!, my + off[1]!, 0), a: (rnd() * 2 - 1) * (i === 0 ? 0.03 : 0.07), hw: w + b, hh: h + b, pw: w, ph: h,
        // 最上面那張（第 2 張）先抽、第 1 張接著抽；主角不抽
        pull: i === 0 ? Infinity : pulls[2 - i]!,
        dir: i === 2 ? new THREE.Vector2(0.8, 0.6) : new THREE.Vector2(-0.75, -0.66), spin: i === 2 ? -0.5 : 0.45,
      });
    }
    if (this.cap) {
      const tIn = Math.max(this.tReveal + 0.15, beatAfter(audio, this.tReveal));
      this.slip = { base: cam.unproject(mx + pw + bd + 80 + sw / 2, clamp(my + 30, 150 + sh / 2, 800 - sh / 2), 0), a: (rnd() * 2 - 1) * 0.04, hw: sw / 2, hh: sh / 2, t: tIn };
    }
    // 鏡頭最後要靠過去的點：主角相片上的焦點（相片上的畫面也往它推，所以取相片中心跟焦點的中間）
    this.focus.copy(cam.unproject(mx + (main.fx - 0.5) * pw, my + (main.fy - 0.5) * ph, 0));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const cam = this.cam;
    const D = cam.D;
    // 鏡頭：主角露出來之後慢慢推近它相片上的焦點、轉一點點（有紙條時只往那邊靠一點，紙條上的字才一直在畫面裡）
    const push = settleK(t - this.tReveal + 0.3, 5);
    const roll = 0.02 * ease.inOutQuad(clamp((t - s) / 12));
    const tgt = this.focus.clone().multiplyScalar((this.slip ? 0.12 : 0.4) * push);
    const dist = D * (1.03 - 0.07 * push);
    cam.rest(FOV);
    cam.pos.set(tgt.x, tgt.y - Math.sin(PITCH) * dist, Math.cos(PITCH) * dist);
    cam.target.copy(tgt);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.update();

    const list: Card[] = [];
    this.prints.forEach((pr, i) => {
      const cd = this.cards[i]!;
      // 抽走：先往後縮一下（預備動作），再抬起來、轉著滑出畫面
      const pre = prog(t, pr.pull - 0.22, pr.pull);
      const go = ease.inCubic(prog(t, pr.pull, pr.pull + 0.6));
      const back = Math.sin(pre * Math.PI) * 10 * (1 - go);
      const lift = 150 * ease.outCubic(prog(t, pr.pull, pr.pull + 0.4));
      const c = pr.base.clone();
      c.x += pr.dir.x * (1500 * go - back);
      c.y += pr.dir.y * (1500 * go - back);
      c.z = 1.2 * i + lift;
      lay(cd, c, pr.a + pr.spin * go);
      if (go > 0) {
        // 抬起來時傾斜一點（手捏著一邊）
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-pr.dir.y, pr.dir.x, 0), 0.3 * ease.outCubic(prog(t, pr.pull, pr.pull + 0.3)));
        cd.u.applyQuaternion(q); cd.v.applyQuaternion(q);
      }
      cd.hw = pr.hw; cd.hh = pr.hh;
      // 主角露出來之後，相片上的畫面往焦點推一點（實體相片：1.2 倍）
      const sl = this.slots[pr.slot]!;
      setPhoto(cd, sl, pr.slot, pr.pw, pr.ph, pr.slot === 0 ? pushCrop(sl, pr.pw, pr.ph, push, 1.2) : undefined);
      cd.kind = 0; cd.dim = 1; cd.blur = 0; cd.cast = 1;
      cd.alpha = go >= 1 ? 0 : 1;
      list.push(cd);
    });
    if (this.slip && this.cap) {
      const sl = this.slip, cd = this.cards[3]!;
      // 紙條從右邊滑進來，停住時稍微過頭再回來
      const k = ease.outBack(prog(t, sl.t, sl.t + 0.6), 0.8);
      const c = sl.base.clone();
      c.x += 1300 * (1 - k);
      c.z = 0.6;
      lay(cd, c, sl.a + 0.25 * (1 - k));
      cd.hw = sl.hw; cd.hh = sl.hh; cd.slot = -1; cd.pw = 0; cd.ph = 0; cd.kind = 2; cd.dim = 1; cd.blur = 0; cd.cast = 1;
      cd.alpha = t > sl.t ? 0.93 : 0;
      list.push(cd);
      this.cap.draw(t);
      this.pass.u.txt!.value = this.cap.L.texture;
      (this.pass.u.txtSize!.value as THREE.Vector2).set(this.cap.L.w, this.cap.L.h);
    }
    // 由下往上畫：主角、第二張、第三張、紙條（紙條平放在桌上，比相片疊低，但不跟相片疊重疊）
    // shader 是這個版面所有窗格共用的：沒有字的窗格要把上一個窗格（已經釋放）的字層拿掉
    if (!this.cap) this.pass.u.txt!.value = null;
    setCards(this.pass, list);
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);
    const u = this.pass.u;
    u.lightDir!.value.set(-0.15, 0.3, 0.94).normalize();
    u.shadowK!.value = 0.45; u.penumbra!.value = 0.16;
    u.k!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    this.pass.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.3 };
  }
}
