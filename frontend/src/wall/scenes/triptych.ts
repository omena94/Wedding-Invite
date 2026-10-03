// 照片版面「三聯屏」（暗底，三張）：一座有鉸鏈的三片式相框立在深色亮漆的桌上——
//  - 中間那片是主角（最大），左右兩片翅膀是另外兩張。胡桃木框、米白卡紙，照片完整放在卡紙裡（不裁）。
//  - 進場時兩片翅膀是合起來的（看到木頭背面），第一拍左翼打開、下一拍右翼打開，主角在中間露出來，燈跟著亮。
//    打開後翅膀斜斜地朝向前方，像真的立在桌上的三聯相框；每個小節一道光從左到右掃過三片玻璃。
//  - 桌面是深色亮漆，映出相框的倒影；鏡頭很慢地繞一點、推近一點，看得出三片的角度；主角卡紙裡的畫面往新人點的焦點慢慢推。
//  - 字在桌前（畫面下方置中，像字幕）：主角的主字（賓客留言＋署名，或新人的註解）＋下面小一號的跟唱歌詞，沒有主字時歌詞放在同一個位置；
//    字塊高的時候相框矮一點、往上移。兩樣都沒有時相框大一點、在正中間。
//  - 照片什麼方向都可以：三片一樣高，寬度照各自的照片；配角那兩張的面積最多是主角的六成。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { Cam, Caption, byDepth, card, cardsPass, contain, drawLayer, hasWords, loadSlots, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, stand, type Card, type Slot } from './_p10';

// prefers（導演先挑適合接下來照片的版面）：三片一樣高的直立相框：直的照片填滿每一片，橫的會留很多卡紙。其他照片也撐得住。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 3, energy: [0, 1], bars: [3, 8], weight: 1, prefers: ['portrait'] };

const FOV = 30;
/** 框寬、卡紙寬。 */
const FW = 15, MAT = 24, BORDER = FW + MAT;
/** 打開後翅膀往前斜的角度。 */
const OPEN = (27 * Math.PI) / 180;

const PRE = /* glsl */ `
  uniform float sweep;
  // 胡桃木框（木紋順著那一條邊）＋米白卡紙（照片邊緣一圈很細的斜切影）
  vec3 wood(vec2 q, vec2 hb) {
    bool horiz = hb.y - abs(q.y) < hb.x - abs(q.x);
    vec2 g = horiz ? vec2(q.x / 90.0, q.y / 2.5) : vec2(q.y / 90.0, q.x / 2.5);
    float grain = snoise(g) * 0.5 + snoise(g * vec2(3.0, 1.7)) * 0.25;
    return C_FUR * 0.085 * (0.85 + 0.35 * grain) + C_INK * 0.4;
  }
  // （只留一個出口：中途 return 會讓 ANGLE／D3D 出 X4000 警告，編出來的結果可能不一樣）
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
    vec3 col;
    if (e < ${FW}.0) {
      col = wood(q, hb);
      // 框的內外緣兩道細細的斜面
      col *= 1.0 + 0.8 * smoothstep(2.5, 0.0, e) + 0.5 * smoothstep(2.5, 0.0, ${FW}.0 - e);
    } else {
      vec2 pq = q - cPh[i].xy;
      float dp = sdBox(pq, cBox[i].zw);
      col = C_BONE * 0.6 * (0.97 + 0.03 * snoise(q / 3.0));
      col *= 1.0 - 0.25 * smoothstep(5.0, 0.0, dp) * step(0.0, dp);
      // 卡紙靠框的地方有框的影子
      col *= 1.0 - 0.3 * smoothstep(8.0, 0.0, e - ${FW}.0);
    }
    return col;
  }
  // 背面：一整片木板（直紋），四周一圈細細的倒角
  vec3 backColor(int i, vec2 q, vec2 hb) {
    float grain = snoise(vec2(q.x / 3.0, q.y / 120.0)) * 0.5 + snoise(vec2(q.x / 9.0, q.y / 300.0)) * 0.3;
    float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
    return (C_FUR * 0.07 * (0.85 + 0.3 * grain) + C_INK * 0.4) * (1.0 + 0.6 * smoothstep(3.0, 0.0, e));
  }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    float lam = max(dot(n, lightDir), 0.0);
    float lit = mix(0.3 + 0.75 * lam, 0.78 + 0.22 * lam, isPh);
    vec3 c = base * lit * (refl ? 1.0 : shadowAt(hp, i));
    // 玻璃上的一道掃光（每個小節一次，從左到右）
    float band = exp(-pow((hp.x + hp.y * 0.35 - sweep) / 70.0, 2.0));
    c += C_BONE * 0.035 * band * (refl ? 0.0 : 1.0) * step(0.0, dot(n, -rd));
    return c;
  }
`;

const POST = /* glsl */ `
  uniform float tableY; uniform vec3 glow;
  vec3 room(vec3 rd) {
    // 遠處的牆：相框後面一團很淡的暖光，往四周暗下去；靠近桌面的地方更暗（牆跟桌面接在一起看不出一條線）
    vec2 d = rd.xy / max(0.2, -rd.z);
    float g = exp(-dot(d - glow.xy, d - glow.xy) / glow.z);
    vec3 c = C_INK * 0.5 + mix(C_INK2, C_EMBER, 0.12) * 0.3 * g;
    return c * mix(0.55, 1.0, smoothstep(-0.02, 0.12, rd.y - glow.y + 0.1));
  }
  // （只留一個出口：中途 return 會讓 ANGLE／D3D 出 X4000 警告）
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    vec3 sky = room(rd);
    vec3 col = sky;
    if (rd.y < -0.001) {
      float t = (tableY - ro.y) / rd.y;
      vec3 hp = ro + rd * t;
      // 桌面：深色亮漆，很淡的木紋
      float n = snoise(vec2(hp.x / 600.0, hp.z / 40.0));
      vec3 top = C_INK * (0.9 + 0.2 * n) + C_FUR * 0.01;
      // 主光在桌上的光圈（相框前面）
      vec2 lq = (hp.xz - vec2(-80.0, 160.0)) / vec2(900.0, 420.0);
      top += mix(C_BONE, C_EMBER, 0.2) * 0.04 * exp(-dot(lq, lq) * 1.6);
      top *= shadowAt(hp, -1);
      // 倒影：菲涅耳，斜看越亮（只是近似：倒影不模糊）
      vec3 rr = vec3(rd.x, -rd.y, rd.z);
      float fres = 0.08 + 0.3 * pow(1.0 - abs(rd.y), 5.0);
      vec3 refl = traceCards(hp, rr, room(rr) * 0.5, true);
      col = top + refl * fres * 1.4;
      // 遠處的桌面慢慢暗下去、跟牆接在一起；最前面（畫面最下方，字的後面）也收暗一點
      col = mix(col, sky, smoothstep(-300.0, -2400.0, hp.z));
      col *= mix(1.0, 0.7, smoothstep(500.0, 1100.0, hp.z));
    }
    return col;
  }
  // 字的後面（畫面下方那一塊）很淡地壓暗：卡紙的倒影很亮，字才清楚。textBox：中心、半寬高（畫面像素）
  uniform vec4 textBox; uniform float textK;
  vec3 finish(vec3 col, vec2 p, vec3 rd) {
    vec2 q = (p - textBox.xy) / max(textBox.zw, vec2(1.0));
    return col * (1.0 - textK * 0.6 * exp(-pow(dot(q, q), 1.6)));
  }
`;

const PASS = () => cardsPass(PRE, POST, {
  sweep: { value: -9999 }, tableY: { value: -300 }, glow: { value: new THREE.Vector3(0, 0.12, 0.09) },
  textBox: { value: new THREE.Vector4(960, 900, 400, 100) }, textK: { value: 0 },
});

export default class Triptych extends Scene {
  pass = shared('triptych.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  cam = new Cam(FOV);
  cards: Card[] = [card(), card(), card()];
  /** 三片的寬（含框）、共同的高、照片半寬高。 */
  cw = 0; lw = 0; rw = 0; hp = 0;
  ph: [number, number][] = [];
  /** 整組的中心（世界座標）。 */
  cy = 0;
  tL = 0; tR = 0;
  capY = 0;
  /** 相框在畫面上往上移多少（字塊高的時候讓出下面）：鏡頭看的點往下移。 */
  lookDy = 0;

  override async init() {
    const { start, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 3);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    const [s0, s1, s2] = this.slots as [Slot, Slot, Slot];
    const hasText = hasWords(this.ctx);
    // 字在桌前（畫面下方置中，像字幕）：主字最多三行＋署名＋一行歌詞，最後一行的底在 958（離下緣 96 px 以上）；
    // 置中、寬 780：右緣不超過 1350，不碰 HUD 區（x ≥ 1360）
    let textTop = 1080;
    if (hasText) {
      this.cap = new Caption(this.ctx, refs[0]!, {
        family: F.ming(500), w: 780, h: 320, min: 40, max: 48, lineHeight: 1.4, maxLines: 3, align: 'center',
        color: rgba('bone', 0.95), active: rgba('signal'), unsung: rgba('bone', 0.32), tracking: 2, sigColor: rgba('bone', 0.75),
        shadow: rgba('ink', 0.85), shadowBlur: 16, album: { family: F.hei(500), size: 20, color: rgba('ash', 0.9), tracking: 8 },
      }, (x) => this.track(x));
      await this.cap.init();
      textTop = 958 - this.cap.blockH;
      this.capY = textTop - this.cap.pad;
    }
    // 相框在字上面：字塊高的時候相框矮一點、整組往上移（相框的底離字 40 px 以上，頂離上緣約 100 px）
    const maxH = hasText ? clamp(textTop - 40 - 100, 380, 600) : 690;
    this.lookDy = hasText ? Math.max(0, 513 - (100 + textTop - 40) / 2) : 0;
    const p0 = contain(s0, 820 - 2 * BORDER, maxH - 2 * BORDER);
    const inner = 2 * p0[1];
    const area0 = 4 * p0[0] * p0[1];
    // 翅膀：一樣高的框裡放得下、面積最多主角的六成
    const wing = (sl: Slot): [number, number] => {
      let [w, h] = contain(sl, 0.95 * (inner + 2 * BORDER), inner);
      const k = Math.min(1, Math.sqrt((0.6 * area0) / (4 * w * h)));
      w *= k; h *= k;
      return [w, h];
    };
    const p1 = wing(s1), p2 = wing(s2);
    this.ph = [p0, p1, p2];
    this.hp = inner + 2 * BORDER;
    this.cw = 2 * p0[0] + 2 * BORDER;
    this.lw = 2 * p1[0] + 2 * BORDER;
    this.rw = 2 * p2[0] + 2 * BORDER;
    // 打開後整組在畫面上不要超過 1600 寬：太寬就整組縮小
    const span = this.cw + (this.lw + this.rw) * Math.cos(OPEN) * 1.06;
    const k = Math.min(1, 1600 / span);
    if (k < 1) {
      this.cw *= k; this.lw *= k; this.rw *= k; this.hp *= k;
      this.ph = this.ph.map(([a, b]) => [a * k, b * k]);
    }
    // 世界座標的高度（鏡頭跟著它，畫面上的位置由 lookDy 決定）
    this.cy = hasText ? 540 - 410 : 540 - 470;
    // 第一拍左翼、下一拍右翼
    this.tL = beatAfter(audio, start + 0.15);
    if (this.tL - start > 0.9) this.tL = start + 0.35;
    this.tR = Math.max(this.tL + 0.3, beatAfter(audio, this.tL, 1));
    if (this.tR - this.tL > 0.9) this.tR = this.tL + 0.45;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const cam = this.cam;
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    // 鏡頭：從一邊很慢地繞到另一邊、推近一點；高度略高於相框中心，往下看一點點
    const z0 = 1 - Math.exp(-lt / 7);
    const yaw = dir * lerp(-0.13, 0.05, ease.inOutQuad(clamp(lt / 14)));
    const dist = cam.D * (1.1 - 0.07 * z0);
    cam.rest(FOV);
    // 字塊高的時候整台鏡頭往下平移（不改俯角）：相框在畫面上往上移、讓出下面給字
    const dy = this.lookDy * (dist / cam.D);
    const look = new THREE.Vector3(0, this.cy - 30 - dy, 60);
    cam.pos.set(look.x + Math.sin(yaw) * dist, this.cy + 120 - 30 * z0 - dy, look.z + Math.cos(yaw) * dist);
    cam.target.copy(look);
    cam.update();

    // 翅膀：合起來（看到背面）→ 打開，稍微超過一點再回來
    const openA = (t0: number) => {
      const x = prog(t, t0, t0 + 0.65);
      return lerp((166 * Math.PI) / 180, OPEN, ease.outBack(x, 1.1));
    };
    const aL = openA(this.tL) + 0.004, aR = openA(this.tR);
    const [c0, c1, c2] = this.cards as [Card, Card, Card];
    const [s0, s1, s2] = this.slots as [Slot, Slot, Slot];
    const y = this.cy;
    stand(c0, new THREE.Vector3(0, y, 0), 0);
    c0.hw = this.cw / 2; c0.hh = this.hp / 2;
    // 主角卡紙裡的畫面往焦點慢慢推（相框：1.18 倍）
    const [p0w, p0h] = this.ph[0]!;
    setPhoto(c0, s0, 0, p0w, p0h, pushCrop(s0, p0w, p0h, settleK(lt, 6), 1.18));
    // 左翼：鉸鏈在中間那片的左緣，往左往前斜
    const gap = 3;
    const hl = new THREE.Vector3(-this.cw / 2 - gap, y, 0);
    stand(c1, hl.clone().add(new THREE.Vector3(-Math.cos(aL), 0, Math.sin(aL)).multiplyScalar(this.lw / 2)), aL);
    c1.hw = this.lw / 2; c1.hh = this.hp / 2;
    setPhoto(c1, s1, 1, this.ph[1]![0], this.ph[1]![1]);
    const hr = new THREE.Vector3(this.cw / 2 + gap, y, 0);
    stand(c2, hr.clone().add(new THREE.Vector3(Math.cos(aR), 0, Math.sin(aR)).multiplyScalar(this.rw / 2)), -aR);
    c2.hw = this.rw / 2; c2.hh = this.hp / 2;
    setPhoto(c2, s2, 2, this.ph[2]![0], this.ph[2]![1]);
    for (const c of this.cards) { c.blur = 0; c.dim = 1; c.alpha = 1; c.cast = 1; }
    // 翅膀還合著的時候，主角在後面暗暗的
    c0.dim = lerp(0.55, 1, ease.outCubic(prog(t, this.tL, this.tR + 0.5)));
    setCards(this.pass, byDepth(this.cards, cam));
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);

    const u = this.pass.u;
    u.tableY!.value = y - this.hp / 2;
    const bar = audio.barAt(t);
    const sw = bar - Math.floor(bar);
    u.sweep!.value = t > this.tR + 0.6 ? lerp(-1500, 1500, ease.inOutCubic(clamp(sw * 1.4))) : -9999;
    u.lightDir!.value.set(-0.42, 0.62, 0.66).normalize();
    u.shadowK!.value = 0.55; u.penumbra!.value = 0.08;
    u.k!.value = lerp(0.45, 1, ease.outCubic(prog(t, s, this.tR + 0.4))) * (1 - 0.12 * prog(t, e - 0.3, e));
    const cap = this.cap?.has ? this.cap : null;
    const op = prog(t, this.tR + 0.2, this.tR + 0.8, ease.outCubic) * (1 - prog(t, e - 0.3, e));
    if (cap) {
      const top = this.capY + cap.pad;
      (u.textBox!.value as THREE.Vector4).set(960, top + cap.blockH / 2, 470, cap.blockH / 2 + 60);
    }
    u.textK!.value = cap ? op : 0;
    this.pass.render(renderer, out);

    if (cap && cap.draw(t)) drawLayer(this.ctx, cap.L, out, 960 - cap.L.w / 2, this.capY, op);
    return { bloom: 0.22, bloomThreshold: 1.05, halation: 0.1, vignette: 0.5 };
  }
}
