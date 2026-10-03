// 照片版面「拼貼卡」（亮，三張照片）：桌上一張厚卡紙，鏡頭幾乎正上方、很慢地轉與推近——
//  - 卡紙上先有幾片剪下來的紙（撕邊的牛皮紙、條紋紙、一片半透明的描圖紙、一個圓形的紙片）；
//    兩張配角照片照節拍一張一張斜斜地落下來，主角照片最後落在最上面（畫面輕輕一震），兩條紙膠帶貼住主角。
//  - 字手寫在卡紙右邊的空白處（只放主角的）：主字（賓客留言＋署名，或主角的註解）一個字一個字寫出來，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當主字（_photo.ts 的 PhotoText）；兩個都沒有就只有照片（拼貼移到卡紙中間）。
//  - 每一張照片都完整洗成相片，橫的直的、很小的舊照片都一樣；很小的照片最多放大到原尺寸約 1.5 倍。
//    主角相片上的畫面慢慢往焦點（新人點的臉）推，鏡頭也往那邊靠一點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE, type Layer2D } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog } from '../engine/util';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, firstBeat, settle, type Pic, CAM_FOCAL } from './_p3';
import { loadWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';

export const spec: PlateSpecDecl = { photo: true, photos: 3, family: 'photo', series: 'album', paper: true, energy: [0.2, 1], bars: [3, 8], weight: 1 };

/** 卡紙的半寬高。 */
const CW = 760, CH = 480;

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D p0; uniform sampler2D p1; uniform sampler2D p2;
  uniform sampler2D ink; uniform sampler2D scraps;
  uniform vec4 q0; uniform vec4 q1; uniform vec4 q2;     // 三張照片：中心 xy、高度、轉角（q0 = 主角）
  uniform vec4 s0; uniform vec4 s1; uniform vec4 s2;     // 三張照片：半寬高、白邊、texel／單位
  uniform vec4 tA; uniform vec4 tB; uniform vec2 tHS;    // 兩條膠帶
  uniform vec4 inkRect; uniform float inkOn;
  uniform vec4 crop;      // 主角往焦點推：照片 uv 的範圍
  const vec3 LD = normalize(vec3(-0.4, 0.5, 1.0));

  float light(vec2 p) {
    vec2 q = (p - vec2(-380.0, 300.0)) / vec2(1600.0, 1200.0);
    return 0.68 + 0.32 * exp(-dot(q, q) * 1.4);
  }
  // 一張照片（白邊）：回傳 (顏色, 覆蓋率)；q = 照片自己的座標、cr = 用到照片的哪一塊
  vec4 print(sampler2D tex, vec2 q, vec4 sz, vec4 cr, float wpp, float coc) {
    vec2 outer = sz.xy + vec2(sz.z);
    float d = sdBox(q, outer);
    float a = 1.0 - smoothstep(-0.7 - coc * 0.5, 0.7 + coc * 0.5, d);
    if (a <= 0.0) return vec4(0.0);
    vec3 c = mix(C_BONE, C_PAPER, 0.2) * 0.92;
    float di = sdBox(q, sz.xy);
    if (di < 1.0) {
      vec2 uv = vec2(q.x + sz.x, sz.y - q.y) / (2.0 * sz.xy);
      vec3 im = photoAt(tex, cropUv(uv, cr), lodFor(sz.w, wpp, coc));
      im += C_BONE * 0.018 * smoothstep(0.3, 0.0, abs(uv.x * 0.7 - uv.y - 0.15));
      c = mix(c, im, 1.0 - smoothstep(-0.6, 0.6, di));
    }
    return vec4(c, a);
  }
  float shadowOf(vec2 p, vec4 q, vec4 sz, float zBase, float k0) {
    float h = q.z - zBase;
    if (h <= 0.0) return 0.0;
    return (k0 - 0.12 * smoothstep(20.0, 300.0, h)) * liftShadow(p, q.xy, sz.xy + vec2(sz.z), q.w, h, LD);
  }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    float t0 = hitZ(ro, rd, 0.0);
    vec3 P = ro + rd * t0;
    float coc = cocAt(t0 * dot(rd, camF)), wpp = wppAt(t0, rd, vec3(0.0, 0.0, 1.0));
    vec2 p = P.xy;
    // 桌面：灰灰的米色，很細的顆粒
    vec4 n1 = nz(p, 700.0, wpp, coc);
    vec3 col = mix(C_PAPER, C_GRAPHITE, 0.42) * (0.92 + 0.06 * (n1.r - 0.5) + 0.04 * (n1.b - 0.5));
    float card = sdBox(p, vec2(${CW}.0, ${CH}.0) - 6.0) - 6.0;
    col *= 1.0 - 0.38 * (1.0 - smoothstep(-10.0, 40.0, sdBox(p + LD.xy / LD.z * 6.0, vec2(${CW}.0, ${CH}.0))));
    if (card < 1.0) {
      // 厚卡紙：奶油色、粗一點的纖維
      vec4 n2 = nz(p * 1.7 + 9.0, 700.0, wpp, coc);
      vec3 cs = mix(C_BONE, C_PAPER, 0.5) * 0.93 * (0.97 + 0.03 * (n1.g - 0.5) + 0.025 * (n2.a - 0.5));
      // 剪下來的紙片（靜態圖層）：影子＝往右下偏一點再取一次
      vec2 suv = (p + vec2(${CW}.0, ${CH}.0)) / vec2(${2 * CW}.0, ${2 * CH}.0);
      float lodS = lodFor(${SCALE.toFixed(3)}, wpp, coc);
      vec4 sc = inkAt(scraps, suv, lodS);
      float ssh = inkAt(scraps, suv + vec2(-6.0, 7.0) / vec2(${2 * CW}.0, ${2 * CH}.0), lodS + 1.5).a;
      cs *= 1.0 - 0.18 * ssh * (1.0 - sc.a);
      cs = cs * (1.0 - sc.a) + sc.rgb;
      if (inkOn > 0.5) {
        vec2 iuv = vec2((p.x - inkRect.x) / inkRect.z, (p.y - inkRect.y) / inkRect.w);
        vec4 ic = inkAt(ink, iuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
        cs = cs * (1.0 - ic.a) + ic.rgb;
      }
      float sh = max(max(shadowOf(p, q0, s0, 0.0, 0.3), shadowOf(p, q1, s1, 0.0, 0.26)), shadowOf(p, q2, s2, 0.0, 0.26));
      cs *= 1.0 - sh;
      col = mix(col, cs, 1.0 - smoothstep(-0.7, 0.7 + coc, card));
    }
    col *= light(p);
    // 照片：先畫低的，再畫高的（落下來的那張在上面）
    for (int i = 0; i < 3; i++) {
      // 依高度排序：配角 A（q1）、配角 B（q2）、主角（q0），同時落下時高的在上
      vec4 qq = i == 0 ? q1 : i == 1 ? q2 : q0;
      vec4 ss = i == 0 ? s1 : i == 1 ? s2 : s0;
      if (qq.z > 5000.0) continue;
      float tt; vec2 lq = flatAt(ro, rd, qq.xy, qq.z, qq.w, tt);
      if (tt <= 0.0) continue;
      float wq = wppAt(tt, rd, vec3(0.0, 0.0, 1.0)), cq = cocAt(tt * dot(rd, camF));
      vec4 full = vec4(0.0, 0.0, 1.0, 1.0);
      vec4 pr = i == 0 ? print(p1, lq, ss, full, wq, cq) : i == 1 ? print(p2, lq, ss, full, wq, cq) : print(p0, lq, ss, crop, wq, cq);
      if (pr.a <= 0.0) continue;
      vec2 Pq = (ro + rd * tt).xy;
      float sh = 0.0;
      if (i == 0) sh = max(shadowOf(Pq, q2, s2, qq.z, 0.24), shadowOf(Pq, q0, s0, qq.z, 0.28));
      if (i == 1) sh = shadowOf(Pq, q0, s0, qq.z, 0.28);
      col = mix(col, pr.rgb * (1.0 - sh) * light(Pq), pr.a);
    }
    // 紙膠帶（貼在主角上）
    for (int i = 0; i < 2; i++) {
      vec4 tp = i == 0 ? tA : tB;
      if (tp.z > 5000.0) continue;
      float tt; vec2 lq = flatAt(ro, rd, tp.xy, tp.z, tp.w, tt);
      if (tt <= 0.0) continue;
      vec2 c = tape(lq, tHS, float(i) * 5.0 + 2.0);
      if (c.x <= 0.0) continue;
      // 點點花紋的膠帶
      vec2 g = mod(lq, 18.0) - 9.0;
      float dots = 1.0 - smoothstep(3.0, 4.2, length(g));
      vec3 tc = mix(mix(C_SIGNAL, C_PAPER, 0.55), mix(C_PAPER, C_BONE, 0.6), dots * 0.8);
      col = mix(col, tc * light((ro + rd * tt).xy), c.x * 0.8);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  p0: { value: null }, p1: { value: null }, p2: { value: null }, ink: { value: null }, scraps: { value: null },
  q0: { value: new THREE.Vector4(0, 0, 9999, 0) }, q1: { value: new THREE.Vector4(0, 0, 9999, 0) }, q2: { value: new THREE.Vector4(0, 0, 9999, 0) },
  s0: { value: new THREE.Vector4(200, 150, 16, 1) }, s1: { value: new THREE.Vector4(200, 150, 16, 1) }, s2: { value: new THREE.Vector4(200, 150, 16, 1) },
  tA: { value: new THREE.Vector4(0, 0, 9999, 0) }, tB: { value: new THREE.Vector4(0, 0, 9999, 0) }, tHS: { value: new THREE.Vector2(90, 22) },
  inkRect: { value: new THREE.Vector4() }, inkOn: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
});

interface Item { pic: Pic; c: [number, number]; ang: number; hs: [number, number]; border: number; tLand: number }

export default class CollageCard extends Scene {
  bg = shared('collagecard.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  photos: PhotoRef[] = this.ctx.params.photos ?? [this.ctx.params.photo];
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  noise: THREE.Texture | null = null;
  ink: Layer2D | null = null;
  scraps = this.track(inkLayer(2 * CW, 2 * CH));
  col: TextCol | null = null;
  items: Item[] = [];
  ir: [number, number, number, number] = [0, 0, 0, 0];
  tTapes: [number, number] = [0, 0];
  cluster: [number, number] = [0, 0];

  override async init() {
    const { renderer, start, end, audio } = this.ctx;
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    const list = [ph, ...this.photos.filter((p) => p && p !== ph)].slice(0, 3);
    while (list.length < 3) list.push(ph);
    await loadText(`${ph.caption}${ph.album}`);
    await loadWords(this.ctx);
    const pics = await Promise.all(list.map((r) => loadPic(renderer, r)));
    for (const p of pics) this.track(p.tex);
    this.noise = p3Noise(renderer);
    const rs = 0.94;
    const colW = 450, colH = 600, pad = 24;
    this.ink = this.track(inkLayer(colW + 2 * pad, colH + 2 * pad));
    this.col = new TextCol(this.ink, colW, colH, {
      family: F.hand(400), ink: mixRgba('ink', 'sepia', 0.5, 0.92), active: mixRgba('blood', 'ink', 0.2), unsung: mixRgba('ink', 'sepia', 0.5, 0.28),
      sigInk: mixRgba('ink', 'sepia', 0.5, 0.72), rs, lineHeight: 1.42, maxLines: 6,
      label: { family: F.hand(700), size: 24, color: mixRgba('ink', 'sepia', 0.5, 0.6), tracking: 3, gap: 18 },
    }, ph, this.ctx, pad);
    const hasText = this.col.has;
    // 拼貼的範圍：有字時在卡紙左邊，沒字時在中間
    const boxW = hasText ? 900 : 1180, boxH = hasText ? 700 : 760;
    this.cluster = hasText ? [-CW + 40 + boxW / 2, 0] : [0, 0];
    const r = (k: number) => hash(this.seed, k);
    const sideA = r(1) < 0.5 ? -1 : 1;
    const make = (i: number, bw: number, bh: number, dx: number, dy: number, deg: number): Item => {
      const [w, h] = picSize(pics[i]!.img, bw, bh, rs);
      return { pic: pics[i]!, c: [this.cluster[0] + dx, this.cluster[1] + dy], ang: deg * (Math.PI / 180), hs: [w / 2, h / 2], border: clamp(0.04 * Math.min(w, h), 10, 20), tLand: 0 };
    };
    // 主角在中間偏一點、配角在兩個對角露出來
    const hero = make(0, boxW * 0.68, boxH * 0.76, 10 * sideA, -6, (2 + 2 * r(2)) * sideA);
    const a = make(1, boxW * 0.44, boxH * 0.56, -boxW * 0.31 * sideA, boxH * 0.22, -(7 + 5 * r(3)) * sideA);
    const b = make(2, boxW * 0.42, boxH * 0.54, boxW * 0.31 * sideA, -boxH * 0.24, (6 + 5 * r(4)) * sideA);
    // 節拍：配角 A → 配角 B → 主角 → 膠帶（短窗格擠一點）
    const beat = clamp(audio.beatPeriod(start + 0.1), 0.3, 0.6);
    const ta = clamp(firstBeat(audio, start, 0.5), start + 0.3, start + 0.6);
    const budget = Math.max(0.6, Math.min(2.2, end - 0.8 - ta));
    const st = Math.min(beat, budget / 3);
    a.tLand = ta; b.tLand = ta + st; hero.tLand = ta + 2 * st;
    this.tTapes = [hero.tLand + st * 0.7, hero.tLand + st * 1.3];
    this.items = [hero, a, b];
    // 字的欄：卡紙右邊，上下置中（整塊的下緣不低於 y = -280：右下角是 HUD 區）
    const blockH = this.col.contentH;
    const colLeft = CW - 50 - colW, colTop = clamp(blockH / 2 + 10, Math.min(blockH - 280, CH - 70), CH - 70);
    this.ir = [colLeft - pad, colTop - colH - pad, colW + 2 * pad, colH + 2 * pad];
    if (this.col.fit) {
      this.col.writeFrom = hero.tLand + 0.2;
      this.col.writeTo = this.col.writeFrom + Math.min(2.0, 0.07 * this.col.chars + 0.3);
    }
    this.drawScraps(hasText);
  }

  /** 剪下來的紙片（畫一次）：撕邊的牛皮紙、條紋紙、描圖紙、圓形紙片，都在拼貼的後面。 */
  private drawScraps(hasText: boolean) {
    const L = this.scraps, c = L.ctx;
    L.clear();
    const rnd = mulberry32(this.seed * 131 + 7);
    const X = (x: number) => x + CW, Y = (y: number) => CH - y;
    const [cx, cy] = this.cluster;
    // 撕邊的四邊形：每一邊切成小段、亂數往內外抖
    const torn = (x: number, y: number, w: number, h: number, ang: number, fill: string, jag = 5) => {
      c.save();
      c.translate(X(x), Y(y)); c.rotate(-ang);
      c.beginPath();
      const pts: [number, number][] = [];
      const edge = (x0: number, y0: number, x1: number, y1: number) => {
        const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 10));
        for (let i = 0; i < n; i++) { const u = i / n; pts.push([lerp(x0, x1, u) + (rnd() - 0.5) * jag, lerp(y0, y1, u) + (rnd() - 0.5) * jag]); }
      };
      edge(-w / 2, -h / 2, w / 2, -h / 2); edge(w / 2, -h / 2, w / 2, h / 2); edge(w / 2, h / 2, -w / 2, h / 2); edge(-w / 2, h / 2, -w / 2, -h / 2);
      pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
      c.closePath();
      c.fillStyle = fill; c.fill();
      c.restore();
      return pts;
    };
    const sx = hasText ? 1 : 1.25;
    // 牛皮紙（撕邊）在拼貼左上
    torn(cx - 250 * sx, cy + 120 * sx, 360 * sx, 260 * sx, 0.18, mixRgba('fur', 'paper', 0.62, 1), 7);
    // 條紋紙：一長條，斜斜地穿過拼貼下方
    c.save();
    c.translate(X(cx + 60 * sx), Y(cy - 200 * sx)); c.rotate(0.08);
    c.fillStyle = mixRgba('paper', 'signal', 0.22, 1);
    c.fillRect(-330 * sx, -34, 660 * sx, 68);
    c.fillStyle = mixRgba('paper', 'bone', 0.6, 0.9);
    for (let x = -330 * sx; x < 330 * sx; x += 22) c.fillRect(x, -34, 9, 68);
    c.restore();
    // 描圖紙：半透明的方塊，在右上
    torn(cx + 230 * sx, cy + 170 * sx, 300 * sx, 230 * sx, -0.12, rgba('bone', 0.45), 3);
    // 圓形的紙片（灰綠）
    c.beginPath(); c.arc(X(cx + 300 * sx), Y(cy - 130 * sx), 70 * sx, 0, Math.PI * 2);
    c.fillStyle = mixRgba('gingham', 'paper', 0.35, 1); c.fill();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    const hero = this.items[0]!;
    // 主角相片上的畫面往焦點推；主角落下以後鏡頭也往焦點靠一點（有字時少靠，字才一直在畫面裡）
    const crop = picCrop(hero.pic, settleK(lt, 6), { zoom: 1.14, screenW: hero.hs[0] * 2 * 0.94 });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const [fx, fy] = focusAt(hero.pic, crop, hero.c, hero.hs, hero.ang);
    const lean = (this.col!.has ? 0.14 : 0.4) * settle(t - hero.tLand, 5);
    // 鏡頭：幾乎正上方，很慢地轉、推近；主角落下時輕輕一震
    const dir = hash(this.seed, 9) < 0.5 ? 1 : -1;
    const bump = t >= hero.tLand ? 0.007 * Math.exp(-(t - hero.tLand) * 9) : 0;
    const push = (1.07 - 0.07 * ease.outCubic(prog(t, s, s + 1.2))) * (1 - 0.045 * settle(lt, 7)) * (1 - bump);
    this.cam.orbit([lean * (fx - hero.c[0]), lean * (fy - hero.c[1]), 0], (CAM_FOCAL / 0.94) * push, 80, 2 * dir, 30, dir * (-3 + 2 * settle(lt, 6)));
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    // 照片：從上面落下（越來越快），落地時轉回來
    const qs = [u.q0!, u.q1!, u.q2!], ss = [u.s0!, u.s1!, u.s2!], ps = [u.p0!, u.p1!, u.p2!];
    this.items.forEach((it, i) => {
      const t0 = it.tLand - 0.4;
      const d = prog(t, t0, it.tLand, ease.inQuad);
      const z = t < t0 ? 9999 : lerp(320, 1.5 + (i === 0 ? 2 : i === 2 ? 1 : 0), d);
      (qs[i]!.value as THREE.Vector4).set(it.c[0] + 40 * (1 - d), it.c[1] - 50 * (1 - d), z, it.ang + 0.15 * (1 - d) * (i === 1 ? -1 : 1));
      (ss[i]!.value as THREE.Vector4).set(it.hs[0], it.hs[1], it.border, texPerWorld(it.pic.img, it.hs[0] * 2, i === 0 ? crop : undefined));
      ps[i]!.value = it.pic.tex;
    });
    // 膠帶：主角的左上角、右邊
    const c = Math.cos(hero.ang), si = Math.sin(hero.ang);
    const at = (x: number, y: number): [number, number] => [hero.c[0] + x * c - y * si, hero.c[1] + x * si + y * c];
    const ow = hero.hs[0] + hero.border, oh = hero.hs[1] + hero.border;
    const tz = (tt: number) => (t < tt - 0.18 ? 9999 : lerp(70, 5, prog(t, tt - 0.18, tt, ease.inQuad)));
    const [ax, ay] = at(-ow + 18, oh - 18), [bx, by] = at(ow - 4, -oh * 0.2);
    (u.tA!.value as THREE.Vector4).set(ax, ay, tz(this.tTapes[0]), hero.ang + 0.75);
    (u.tB!.value as THREE.Vector4).set(bx, by, tz(this.tTapes[1]), hero.ang + Math.PI / 2 + 0.12);
    (u.tHS!.value as THREE.Vector2).set(clamp(Math.min(ow, oh) * 0.3, 60, 95), 20);
    u.scraps!.value = this.scraps.texture;
    u.inkOn!.value = this.col!.draw(t) ? 1 : 0;
    u.ink!.value = this.ink!.texture;
    (u.inkRect!.value as THREE.Vector4).set(...this.ir);
    u.noiseTex!.value = this.noise;
    u.focusD!.value = this.cam.depth([0, 0, 0]);
    u.aper!.value = 8;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.1, bloomThreshold: 1.15, halation: 0.04, vignette: 0.34 };
  }
}
