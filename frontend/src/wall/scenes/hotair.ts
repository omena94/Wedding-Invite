// 照片版面「熱氣球」（亮）：鏡頭跟著一顆熱氣球往上升，照片用兩條繩子掛在吊籃下面，像一面小旗子——
//  - 切進來時氣球帶著照片從下面升上來落定，雲一層一層往下退（遠的慢、近的快、最近的糊糊地從前景飄過）；
//    之後一直慢慢上升，照片跟著輕輕擺。遠處還有兩顆小小的熱氣球。
//  - 每個小節線燃燒器「呼」地噴一下火（真的火用固定的暖色，不跟主題換）：吊籃上方一團暖光、球皮下緣從裡面透出光，整組往上一提。
//  - 球皮是一條紙色、一條淡淡的訊號色（跟著每首歌的配色），太陽在左上，球面有明暗。
//  - 照片是實體相片（白邊），完整呈現不裁切；很小的舊照片最多放大到原尺寸 1.5 倍；升上來落定之後相片上的畫面慢慢往新人點的臉推（focusCrop）。
//  - 字寫在右邊的天空上（思源宋體、墨色，字後面很淡的亮霧）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞放在同一個位置；兩個都沒有就只有氣球與照片（移到中間）。相簿的第一張在上面多一行相簿名。
// 畫法：天空、三層雲、氣球、吊籃、繩子、照片都在一個全螢幕 shader；字是一張 Canvas2D 層。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'journey', prefers: ['landscape', 'square'], energy: [0, 1], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform float t; uniform float k; uniform float rise; uniform float seedOff; uniform float burn;
  uniform vec2 bc; uniform float R; uniform vec2 pivot; uniform float swing; uniform vec2 hs; uniform float bd;
  uniform vec4 far1; uniform vec4 far2; uniform vec4 textRect;

  float sdTrap(vec2 p, float r1, float r2, float he) {
    // 梯形（iq）：y = -he 的半寬 r1、y = +he 的半寬 r2
    vec2 k1 = vec2(r2, he), k2 = vec2(r2 - r1, 2.0 * he);
    p.x = abs(p.x);
    vec2 ca = vec2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
    vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
    float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
    return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
  }
  // 球皮的距離場（倒水滴：圓＋往下收的梯形），c 是球心、r 是半徑；回傳 x：距離、y：喉口的 y
  vec2 envD(vec2 p, vec2 c, float r) {
    float dc = length(p - c) - r;
    float yt = c.y + r * 1.32;
    float he = (yt - (c.y + r * 0.45)) * 0.5;
    float dt = sdTrap(vec2(p.x - c.x, -(p.y - (c.y + r * 0.45 + he))), r * 0.2, r * 0.86, he);
    return vec2(smin(dc, dt, r * 0.12), yt);
  }
  vec3 envCol(vec2 p, vec2 c, float r, float glow) {
    float v = (p.y - c.y) / r;
    float hwS = r * sqrt(max(0.0, 1.0 - v * v));
    float hwC = mix(r * 0.86, r * 0.2, clamp((p.y - (c.y + r * 0.45)) / (r * 0.87), 0.0, 1.0));
    float hwid = max(p.y > c.y + r * 0.45 ? hwC : hwS, 1.0);
    float u = clamp((p.x - c.x) / hwid, -0.999, 0.999);
    float phi = asin(u);
    float gore = mod(floor((phi + 1.5708) / (3.14159 / 9.0)), 2.0);
    vec3 a = mix(C_PAPER, C_BONE, 0.4) * 0.86, b = mix(C_PAPER, C_SIGNAL, 0.6) * 0.8;
    vec3 col = mix(a, b, gore);
    // 球面明暗：太陽在左上
    vec3 n = normalize(vec3(u, v * 0.6, sqrt(max(0.0, 1.0 - u * u))));
    float dif = 0.55 + 0.45 * max(0.0, dot(n, normalize(vec3(-0.55, -0.45, 0.7))));
    col *= dif;
    // 縫線
    float seam = abs(fract((phi + 1.5708) / (3.14159 / 9.0)) - 0.5) * 2.0;
    col *= 1.0 - 0.12 * smoothstep(0.92, 1.0, seam);
    // 燒火時下緣從裡面透光（火的固定暖色，不跟主題換）
    col += fireCol(0.6) * glow * 0.5 * smoothstep(c.y + r * 0.2, c.y + r * 1.3, p.y);
    return col;
  }

  vec4 cloud(vec2 p, float sc, vec2 off, float th) {
    // 大的形狀＋小的蓬鬆邊；往太陽（左上）那邊取樣比較：朝陽的一面亮、底下淡淡的灰
    vec2 q = p / sc + off;
    float d = fbm(q, 3) * 0.75 + 0.25 * fbm(q * 3.1 + 5.0, 2);
    float d2 = fbm(q + vec2(0.05, 0.07), 3) * 0.75 + 0.25 * fbm((q + vec2(0.05, 0.07)) * 3.1 + 5.0, 2);
    float a = smoothstep(th, th + 0.18, d);
    float lit = clamp((d - d2) * 5.0 + 0.55, 0.0, 1.0);
    vec3 col = mix(mix(C_PAPER, C_ASH, 0.3) * 0.84, C_BONE * 0.95, 0.3 + 0.7 * lit);
    return vec4(col, a);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // ---- 天空：上面淡、往下偏暖，左上的太陽一團暖光
    vec3 sky = mix(mix(C_PAPER, C_BONE, 0.45) * 0.86, mix(C_PAPER, C_SIGNAL, 0.18) * 0.88, smoothstep(0.0, ${H}.0, p.y));
    sky += C_SIGNAL * 0.07 * exp(-length((p - vec2(-80.0, -60.0)) / vec2(900.0, 700.0)));
    vec3 col = sky;
    // 遠雲（慢）
    vec4 c1 = cloud(p * vec2(1.0, 2.2), 900.0, vec2(seedOff, -rise * 0.0004), 0.12);
    col = mix(col, mix(c1.rgb, sky, 0.45), c1.a * 0.8);
    // 遠處兩顆小氣球
    for (int i = 0; i < 2; i++) {
      vec4 fb = i == 0 ? far1 : far2;
      vec2 fc = fb.xy + vec2(0.0, rise * 0.25);
      float fr = fb.z;
      vec2 e = envD(p, fc, fr);
      vec3 ec = mix(envCol(p, fc, fr, 0.0), sky, 0.5);
      col = mix(col, ec, 1.0 - smoothstep(-0.8, 0.8, e.x));
      float bk = sdBox(p - vec2(fc.x, e.y + fr * 0.42), vec2(fr * 0.22, fr * 0.16));
      col = mix(col, mix(C_FUR * 0.5, sky, 0.5), 1.0 - smoothstep(-0.8, 0.8, bk));
    }
    // 中景的雲
    vec4 c2 = cloud(p * vec2(1.0, 1.8), 620.0, vec2(seedOff + 3.0, -rise * 0.0011), 0.18);
    col = mix(col, mix(c2.rgb, sky, 0.2), c2.a * 0.85);
    // 字後面一層很淡的亮霧
    vec2 tq = max(abs(p - textRect.xy - textRect.zw * 0.5) - textRect.zw * 0.5, 0.0);
    col = mix(col, mix(C_PAPER, C_BONE, 0.4) * 0.88, 0.5 * exp(-dot(tq, tq) / 7000.0) * step(1.0, textRect.z));

    // ---- 主角的氣球：球皮（上面切出畫面）、喉口、懸吊的繩子、吊籃
    vec2 e = envD(p, bc, R);
    float throatY = e.y;
    vec2 bkC = vec2(bc.x, throatY + 90.0);
    vec2 bkH = vec2(R * 0.3, 46.0);
    // 吊繩：喉口兩側 → 吊籃上緣
    float rope = 1e9;
    for (int sd = -1; sd <= 1; sd += 2) {
      float s = float(sd);
      rope = min(rope, sdSegment(p, vec2(bc.x + s * R * 0.2, throatY - 4.0), vec2(bc.x + s * bkH.x * 0.92, bkC.y - bkH.y)));
      rope = min(rope, sdSegment(p, vec2(bc.x + s * R * 0.08, throatY - 2.0), vec2(bc.x + s * bkH.x * 0.4, bkC.y - bkH.y)));
    }
    col = mix(col, C_SEPIA * 0.55, 1.0 - smoothstep(0.8, 1.8, rope));
    // 燃燒器的火（燒的時候才有）
    vec2 fq = (p - vec2(bc.x, throatY + 34.0)) / vec2(26.0, 46.0);
    float flame = burn * exp(-dot(fq, fq) * 2.0) * (0.8 + 0.2 * snoise(vec2(p.x / 9.0, p.y / 9.0 - t * 8.0)));
    col += fireCol(0.72) * flame * 1.6;
    if (e.x < 1.0) col = mix(col, envCol(p, bc, R, burn), 1.0 - smoothstep(-0.8, 0.8, e.x));
    // 喉口：深色的開口，燒火時裡面亮
    vec2 tq2 = (p - vec2(bc.x, throatY - 4.0)) / vec2(R * 0.2, 9.0);
    float th = length(tq2) - 1.0;
    col = mix(col, mix(C_SEPIA * 0.4, fireCol(0.7) * 1.2, burn), (1.0 - smoothstep(-0.1, 0.1, th)));
    // 吊籃：藤編
    float db = sdBox(p - bkC, bkH) - 6.0;
    if (db < 1.0) {
      vec2 bq = p - bkC;
      vec3 wick = mix(C_FUR, C_SEPIA, 0.3) * 0.62;
      wick *= 0.86 + 0.14 * sin(bq.x * 0.5 + (mod(floor(bq.y / 8.0), 2.0)) * 3.14159) * sin(bq.y * 0.8);
      wick *= 0.8 + 0.3 * smoothstep(bkH.x, -bkH.x, bq.x);
      wick = mix(wick, mix(C_FUR, C_SEPIA, 0.55) * 0.45, step(bq.y, -bkH.y + 12.0));
      col = mix(col, wick, 1.0 - smoothstep(-0.8, 0.8, db));
    }
    // ---- 照片：兩條繩子掛在吊籃下面，繞著吊籃底擺
    vec2 lq = rot2(swing) * (p - pivot);
    vec2 pq = lq - vec2(0.0, 50.0 + hs.y + bd);
    float r2 = 1e9;
    for (int sd = -1; sd <= 1; sd += 2) {
      float s = float(sd);
      r2 = min(r2, sdSegment(lq, vec2(s * bkH.x * 0.7, 0.0), vec2(s * (hs.x + bd - 14.0), 50.0 + 4.0)));
    }
    col = mix(col, C_SEPIA * 0.55, 1.0 - smoothstep(0.8, 1.8, r2));
    vec4 pr = printAt(pq, hs, bd, C_BONE * 0.9);
    col = mix(col, pr.rgb * (0.97 + 0.03 * burn), pr.a);
    // 前景的雲（近、快）：貼著畫面下緣飄過
    vec4 c3 = cloud(p * vec2(1.0, 1.4), 520.0, vec2(seedOff + 7.0, -rise * 0.0024), 0.32);
    float edge = smoothstep(950.0, 1080.0, p.y);
    col = mix(col, c3.rgb, c3.a * 0.7 * edge);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, t: { value: 0 }, k: { value: 1 }, rise: { value: 0 }, seedOff: { value: 0 }, burn: { value: 0 },
  bc: { value: new THREE.Vector2() }, R: { value: 400 }, pivot: { value: new THREE.Vector2() }, swing: { value: 0 }, hs: { value: new THREE.Vector2() }, bd: { value: 18 },
  far1: { value: new THREE.Vector4() }, far2: { value: new THREE.Vector4() }, textRect: { value: new THREE.Vector4() },
});

/** 天空上的字塊：寬、高上限（相簿名＋主字＋署名＋歌詞）。60 字的留言在 40 px 排得進四行。 */
const COL_W = 600, COL_H = 460;
/** 球的半徑、喉口到吊籃底的距離。 */
const RB = 380;

export default class HotAir extends JourneyPlate {
  bg = shared('hotair.bg', BG);
  text = this.track(new Layer2D(COL_W + 40, COL_H + 60, undefined, { fast: true }));
  cx = 0; hw = 0; hh = 0; bd = 18;
  colX = 0; colY = 0;

  override async init() {
    await this.loadPhoto();
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.ming(700), lineHeight: 1.45,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.32), active: mixRgba('signal', 'sepia', 0.4), sigInk: rgba('sepia', 0.72), sigFamily: F.ming(500),
      label: { family: F.hei(500), size: 21, color: rgba('sepia', 0.56), tracking: 6, gap: 24 },
    });
    const { w, h } = this.img!;
    // 照片從 y ≈ 460 往下掛（下緣離畫面底留一點）；有說明時整組在左邊
    const s = this.fitScale(this.hasText ? 660 : 760, 440);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bd = clamp(0.035 * Math.min(w * s, h * s), 12, 22);
    this.cx = this.hasText ? 620 : W / 2;
    this.colX = 1180;
    const bh = this.blockH();
    this.colY = clamp(470 - bh / 2, 150, 785 - bh);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const u = this.bg.u;
    // 每個小節線燒一下火：亮起來、整組往上一提
    const bar = audio.timeOfBar(Math.floor(audio.barAt(t) + 1e-6));
    const sinceBurn = t - bar;
    const burn = bar >= s - 0.01 && sinceBurn < 0.9 ? Math.exp(-sinceBurn * 3.2) * Math.min(1, sinceBurn * 20) : 0;
    // 進場：從下面升上來落定；之後一直慢慢上升（雲往下退），切進來時升得快一點
    const enter = ease.outCubic(prog(t, s, s + 1.1));
    const dy = 190 * (1 - enter) - 6 * burn + 5 * Math.sin(t * 1.1);
    const rise = 60 * lt + 320 * enter + 40 * Math.sin(t * 0.3);
    u.t!.value = t;
    u.rise!.value = rise;
    u.burn!.value = burn;
    u.seedOff!.value = hash(this.seed, 3) * 30;
    const bcy = -RB * 0.62 + dy;
    (u.bc!.value as THREE.Vector2).set(this.cx + 6 * Math.sin(t * 0.7), bcy);
    u.R!.value = RB;
    const throatY = bcy + RB * 1.32;
    (u.pivot!.value as THREE.Vector2).set(this.cx + 6 * Math.sin(t * 0.7), throatY + 90 + 46 + 6);
    u.swing!.value = (2.2 * Math.sin(t * 1.3 + 0.4) + 1.2 * Math.sin(t * 0.55) + 4 * (1 - enter)) * (Math.PI / 180);
    (u.hs!.value as THREE.Vector2).set(this.hw, this.hh);
    u.bd!.value = this.bd;
    // 升上來落定之後相片上的畫面往焦點推
    this.setPhoto(u, 2 * this.hw, this.focusK(t, s + 0.8), 1.18);
    // 遠處的小氣球：有字時一顆在大氣球跟字中間的高空、一顆在左下，不在字後面
    const far = this.hasText ? [[1030, 110, 38], [180, 640, 30]] : [[1600, 220, 46], [300, 700, 30]];
    (u.far1!.value as THREE.Vector4).set(far[0]![0]! + 4 * Math.sin(t * 0.4), far[0]![1]!, far[0]![2]!, 0);
    (u.far2!.value as THREE.Vector4).set(far[1]![0]! + 3 * Math.sin(t * 0.5 + 1), far[1]![1]!, far[1]![2]!, 0);
    const bh = this.blockH();
    (u.textRect!.value as THREE.Vector4).set(this.hasText ? this.colX - 10 : 0, this.colY - 10, this.hasText ? this.blockW() + 20 : 0, bh + 30);
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.hasText) {
      this.paintBlock(this.text, t, 20, 20);
      const op = prog(t, s + 0.6, s + 1.2, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      if (op > 0) blit(comp, renderer, this.text, out, this.colX - 20, this.colY - 20, { opacity: op });
    }
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.05, halation: 0.08, vignette: 0.3 };
  }
}
