// 照片版面「旋轉環」（暗底，五張）：五張相片立成一圈，在暗處的聚光燈下轉——
//  - 一切進來就在轉（一開始快、越轉越慢），最後在拍點停下，主角剛好轉到正前方，停的時候稍微晃一下才定住。
//  - 主角比其他張大；停下後主角往前站出來一點，其他張退到暗處、失焦，鏡頭慢慢推近。
//  - 上方一盞聚光燈：相片轉到側面就變暗、轉到背面看到相紙的背；地面是霧面的深色，看得到聚光燈的光圈與相片的軟影子；
//    空氣裡有很淡的光柱與慢慢飄的灰塵，越遠的東西越沒入暗處。
//  - 字在左邊一欄（環往右邊站），像電影海報的文案：主角的主字（賓客留言＋署名，或新人的註解，一個字一個字寫出來）＋下面小一號的跟唱歌詞；
//    沒有主字時歌詞放在同一個位置跟唱；兩樣都沒有時環在正中間。主角停下後相片上的畫面往新人點的焦點慢慢推。
//  - 照片完整呈現（不裁），配角的面積最多是主角的一半。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { F } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { Cam, Caption, byDepth, card, cardsPass, contain, drawLayer, hasWords, loadSlots, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, stand, toneLin, type Card, type Slot } from './_p10';

// prefers（導演先挑適合接下來照片的版面）：立成一圈的相片：直的像旋轉木馬，橫的太寬、轉到側面的鄰居會變成細條。其他照片也撐得住。
// thumbAt：後台縮圖拍環還在轉，看得到兩、三張的那一刻（收尾的畫面只剩主角，看不出是好幾張）。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 5, energy: [0.2, 1], bars: [3, 8], weight: 1, prefers: ['portrait'], thumbAt: 0.122 };

const FOV = 30;
/** 環的半徑、相片白邊。 */
const R = 500, BORDER = 12;

const PRE = /* glsl */ `
  uniform float fogFrom;
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
    return C_BONE * 0.86 * (1.0 - 0.06 * smoothstep(2.0, 0.0, e));
  }
  // 背面：裱在黑色的卡板上，轉到背面就沒入暗處（只剩邊緣一點點反光）
  vec3 backColor(int i, vec2 q, vec2 hb) {
    float e = min(hb.x - abs(q.x), hb.y - abs(q.y));
    return C_INK2 * (0.75 + 0.6 * smoothstep(3.0, 0.0, e));
  }
  vec3 fogged(vec3 c, float d) { return mix(c, C_INK * 0.6, 1.0 - exp(-max(0.0, d - fogFrom) / 1400.0)); }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    float lam = max(dot(n, lightDir), 0.0);
    float face = max(dot(n, -rd), 0.0);
    // 照片要看得清楚：正面的照片亮度只跟著光稍微變；側面、背面暗下去
    float lit = mix(0.2 + 0.8 * lam, 0.45 + 0.55 * mix(lam, 1.0, 0.5), isPh) * mix(0.55, 1.0, face);
    vec3 c = base * lit;
    // 相紙的光澤：聚光燈的反光，轉動時從相片上滑過
    vec3 h = normalize(lightDir - rd);
    c += C_BONE * 0.06 * pow(max(dot(n, h), 0.0), 50.0) * step(0.5, isPh + 0.5);
    return fogged(c, length(hp - camPos));
  }
`;

const POST = /* glsl */ `
  uniform float floorY; uniform vec3 pool; uniform float beamC; uniform vec3 lampC; uniform float lampK;
  // 聚光燈的顏色：暖白，知道主角的色調時偏向它一點
  vec3 lamp() { return mix(mix(C_BONE, C_EMBER, 0.25), lampC, lampK); }
  float beamX(float y) { return beamC + (y - 540.0) * 0.12; }
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    vec3 col = C_INK * 0.55 + C_INK2 * 0.15 * smoothstep(-0.2, 0.3, rd.y);
    if (rd.y < -0.001) {
      float t = (floorY - ro.y) / rd.y;
      vec3 hp = ro + rd * t;
      float n = fbm(hp.xz / 500.0, 2);
      vec3 fl = mix(C_INK, C_INK2, 0.5) * (0.6 + 0.15 * n);
      // 聚光燈的光圈（地上）
      vec2 d = (hp.xz - pool.xy) / pool.z;
      fl += lamp() * 0.07 * exp(-pow(dot(d, d), 1.5) * 1.4);
      fl *= shadowAt(hp, -1);
      col = fogged(fl, t);
    }
    return col;
  }
  vec3 finish(vec3 col, vec2 p, vec3 rd) {
    // 光柱：從上方斜斜打下來，很淡；裡面有慢慢飄的灰塵
    float beam = exp(-pow((p.x - beamX(p.y)) / 330.0, 2.0)) * smoothstep(1100.0, 0.0, p.y);
    col += lamp() * 0.022 * beam;
    float dust = 0.0;
    for (int l = 0; l < 2; l++) {
      vec2 g = p / (l == 0 ? 46.0 : 71.0) + vec2(0.0, -time * (l == 0 ? 0.35 : 0.22)) + float(l) * 17.0;
      vec2 c = floor(g), f = fract(g);
      vec2 r = hash22(c + float(l) * 31.0);
      float d = length(f - r);
      dust += smoothstep(0.06, 0.0, d) * step(0.82, hash12(c * 1.7 + float(l)));
    }
    col += lamp() * 0.05 * dust * beam;
    return col;
  }
`;

const PASS = () => cardsPass(PRE, POST, {
  fogFrom: { value: 2000 }, floorY: { value: -400 }, pool: { value: new THREE.Vector3(0, 0, 600) }, beamC: { value: 960 },
  lampC: { value: new THREE.Vector3() }, lampK: { value: 0 },
});

export default class Photoring extends Scene {
  pass = shared('photoring.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  cam = new Cam(FOV);
  cards: Card[] = Array.from({ length: 5 }, () => card());
  size: [number, number][] = [];
  /** 環的中心（x）；有字時往右站。 */
  rx = 0;
  tStop = 0;
  turns = 0.8;
  col: { x: number; y: number } | null = null;

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 5);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    const main = refs[0]!;
    const hasText = hasWords(this.ctx);
    const s0 = this.slots[0]!;
    const p0 = contain(s0, 680, 560);
    this.size = this.slots.map((sl, i) => {
      if (i === 0) return p0;
      let [w, h] = contain(sl, 460, 400);
      const k = Math.min(1, Math.sqrt((0.5 * p0[0] * p0[1]) / (w * h)));
      w *= k; h *= k;
      return [w, h];
    });
    this.rx = hasText ? 450 : 0;
    // 停下來的時間：窗格前四成左右的拍點
    const dur = end - start;
    this.tStop = beatAfter(audio, start + clamp(dur * 0.4, 1.3, 4.4));
    if (this.tStop > end - 0.8) this.tStop = Math.max(start + 0.8, end - 0.8);
    this.turns = 0.6 + 0.4 * hash(this.seed, 21);
    if (hasText) {
      // 左邊一欄寬 470（右緣停在環左邊那張的外面）：60 字的長留言 40 px 排五、六行；這一欄在 HUD 區左邊，下緣可以到 950
      this.cap = new Caption(this.ctx, main, {
        family: F.ming(500), w: 470, h: 640, min: 40, max: 50, lineHeight: 1.42, maxLines: 6,
        color: rgba('bone', 0.95), active: rgba('signal'), unsung: rgba('bone', 0.3), shadow: rgba('ink', 0.8), shadowBlur: 12,
        sigColor: rgba('bone', 0.75), album: { family: F.hei(500), size: 20, color: rgba('signal', 0.85), tracking: 8 }, write: 0.05,
      }, (x) => this.track(x));
      await this.cap.init();
      this.col = { x: 110, y: clamp(500 - this.cap.blockH / 2, 120, 950 - this.cap.blockH) };
      this.cap.writeFrom(this.tStop + 0.3, 1.8);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const cam = this.cam;
    const D = cam.D;
    // 轉：一開始快、越來越慢，停在拍點（主角在正前方），停的時候稍微晃一下
    const p = prog(t, s - 0.25, this.tStop);
    let th = -this.turns * Math.PI * 2 * (1 - ease.outCubic(p));
    const dt = t - this.tStop;
    if (dt > 0) th += 0.05 * Math.exp(-dt * 4.5) * Math.sin(dt * 11);
    const after = dt > 0 ? 1 - Math.exp(-dt / 6) : 0;
    const step = ease.inOutCubic(prog(t, this.tStop, this.tStop + 0.8));
    // 鏡頭：轉的時候從斜上方看（看得出是一圈），停下後降下來、轉正、慢慢推近主角
    cam.rest(FOV);
    const low = ease.inOutCubic(prog(t, this.tStop - 0.6, this.tStop + 0.9));
    const look = new THREE.Vector3(this.rx * lerp(0.9, 0.82, low), lerp(-120, -10, low), lerp(-R * 0.7, -40, low));
    cam.pos.set(this.rx * 0.55, lerp(620, 170, low) - 30 * after, D * (lerp(1.12, 1.04, low) - 0.06 * after));
    cam.target.copy(look);
    cam.update();

    const list: Card[] = [];
    const maxH = Math.max(...this.size.map((x) => x[1])) + BORDER;
    const focus = new THREE.Vector3(this.rx, 0, 0).sub(cam.pos).dot(cam.f);
    this.slots.forEach((sl, i) => {
      const cd = this.cards[i]!;
      const phi = th + (i * Math.PI * 2) / 5;
      // 停下後主角往前站出來；其他張往環的中心收（躲到主角後面的暗處），左邊一欄的字旁邊才乾淨
      const r = R + (i === 0 ? 80 * step : -170 * step);
      const [w, h] = this.size[i]!;
      const c = new THREE.Vector3(this.rx + r * Math.sin(phi), (h + BORDER) - maxH + (i === 0 ? 30 * step : 0), -R + r * Math.cos(phi));
      stand(cd, c, phi, lerp(0.14, 0.03, low));
      cd.hw = w + BORDER; cd.hh = h + BORDER; cd.radius = 3;
      // 主角停在正前方之後，相片上的畫面往焦點慢慢推（實體相片：1.2 倍）
      setPhoto(cd, sl, i, w, h, i === 0 ? pushCrop(sl, w, h, settleK(dt, 5), 1.2) : undefined);
      cd.kind = 0; cd.cast = 1; cd.alpha = 1;
      const dd = Math.abs(new THREE.Vector3().copy(c).sub(cam.pos).dot(cam.f) - focus);
      cd.blur = Math.min(5, dd * 0.004 * (0.5 + step));
      cd.dim = i === 0 ? 1 : lerp(1, 0.6, step);
      list.push(cd);
    });
    setCards(this.pass, byDepth(list, cam));
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);
    const u = this.pass.u;
    u.fogFrom!.value = D * 0.95;
    u.floorY!.value = -maxH - 46;
    (u.pool!.value as THREE.Vector3).set(this.rx, -R, R * 1.25);
    u.beamC!.value = cam.project(new THREE.Vector3(this.rx, 0, -R)).x + 60;
    const base = [0, 1, 2].map((i) => LIN.bone[i]! + (LIN.ember[i]! - LIN.bone[i]!) * 0.25);
    const tone = toneLin(this.slots[0]!.ref, base);
    if (tone) (u.lampC!.value as THREE.Vector3).set(...tone);
    u.lampK!.value = tone ? 0.35 : 0;
    u.lightDir!.value.set(-0.25, 0.85, 0.46).normalize();
    u.shadowK!.value = 0.6; u.penumbra!.value = 0.12;
    u.time!.value = t;
    u.k!.value = lerp(0.6, 1, ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.pass.render(renderer, out);

    if (this.cap?.has && this.col) {
      const cap = this.cap;
      if (cap.draw(t)) {
        const op = prog(t, this.tStop + 0.1, this.tStop + 0.6, ease.outCubic) * (1 - prog(t, e - 0.3, e));
        if (op > 0) drawLayer(this.ctx, cap.L, out, this.col.x - cap.pad, this.col.y - cap.pad, op);
      }
    }
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.1, vignette: 0.5 };
  }
}
