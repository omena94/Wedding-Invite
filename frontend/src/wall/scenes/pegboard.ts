// 照片版面「軟木板」（亮）：照片用圖釘釘在軟木板上，旁邊釘著一張索引卡寫註解，一條紅毛線從照片連過去——
//  - 滿版軟木板（淡淡的顆粒、零星的舊釘孔），上緣露一條木頭外框；光從左上來。鏡頭像手持一樣很小地漂、慢慢推近。
//  - 照片是一張有白邊的相片，兩顆圖釘釘在上緣兩角、微微斜，下緣有一點翹起（影子比較遠、比較軟）；照片完整放不裁。
//  - 相片上的畫面往新人點的焦點（臉）慢慢推近，鏡頭也往臉那邊靠（卡片上的字一直在畫面的安全區裡）。
//  - 主字（賓客留言＋署名，或新人的註解）手寫在索引卡上（上面一條紅線、下面淡淡的橫格線，每一行字、署名、歌詞都寫在格線上），
//    歌詞小一號寫在最下面跟唱；卡片用一顆圖釘釘在左上角，照字的多少變大；相簿的第一張把相簿名寫在紅線上面的抬頭。
//    沒有主字就把歌詞寫在卡上跟唱；兩樣都沒有就只有照片（移到正中間，沒有卡片、沒有毛線，鏡頭往臉推得多一點）。
//  - 進場：照片被「釘上去」（從 1.05 倍縮回來、影子收緊），卡片在下一拍滑進來釘上，毛線再下一拍從照片右上角的釘子拉到卡片。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, noise1, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, keepIn, v2, v4, type P2Photo } from './_p2';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'frame', paper: true, energy: [0, 0.85], bars: [2, 8], weight: 1, prefers: ['landscape', 'small'] };

/** 上緣的木頭外框（世界座標 y < FRAME）。 */
const FRAME = 54;
/** 索引卡上最多幾條格線（主字四行＋署名＋歌詞兩排，再多幾條往下排滿）。 */
const MAX_RULES = 10;

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform sampler2D photo; uniform sampler2D cap; uniform vec2 capSize; uniform vec4 crop;
  uniform vec3 cam; uniform float roll;
  // 相片：中心、照片半寬高、白邊、角度、縮放（釘上去之前大一點）、離板子多高（影子）
  uniform vec2 pc; uniform vec2 ph; uniform float pb; uniform float pa; uniform float ps; uniform float lift;
  // 索引卡：中心、半寬高、角度、出現的程度；紅線 y、每一條格線 y（卡片上由上往下的 px，字的每一行底下一條）
  uniform vec2 cc; uniform vec2 chh; uniform float ca; uniform float cardOn; uniform float redY; uniform float rules[${MAX_RULES}]; uniform float nRules;
  // 圖釘：位置、縮放（按下去之前大一點）、出現的程度
  uniform vec4 pin0; uniform vec4 pin1; uniform vec4 pin2;
  // 毛線：兩端、控制點（往下垂）、拉到哪裡（0..1）
  uniform vec2 ya; uniform vec2 yb; uniform vec2 yc; uniform float yarnK;
  uniform float lod; uniform float k;

  vec2 bez(float u) { return mix(mix(ya, yc, u), mix(yc, yb, u), u); }

  vec3 pinOver(vec3 col, vec2 p, vec4 pin) {
    if (pin.w <= 0.0) return col;
    float r = 15.0 * pin.z;
    // 釘頭的影子（往右下，按下去之前比較遠、比較淡）
    vec2 so = p - pin.xy - vec2(5.0, 8.0) * (0.6 + 0.4 * pin.z * pin.z);
    col *= 1.0 - 0.34 * pin.w / pin.z * exp(-max(length(so) - r * 0.75, 0.0) / (4.0 + 6.0 * (pin.z - 1.0)));
    vec2 d = (p - pin.xy) / r;
    float rr = dot(d, d);
    if (rr < 1.2) {
      float a = (1.0 - smoothstep(0.9, 1.04, sqrt(rr))) * pin.w;
      vec3 n = vec3(d, sqrt(max(0.0, 1.0 - rr)));
      vec3 L = normalize(vec3(-0.5, -0.6, 0.75));
      float lam = max(dot(n, L), 0.0);
      vec3 c = C_COLLAR * (0.3 + 0.8 * lam);
      float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
      c += C_BONE * 0.32 * spec;
      col = mix(col, c, a);
    }
    return col;
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + rot2(roll) * (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // ---- 軟木：淺褐，細小的顆粒（幾種尺度、對比很低），零星的舊釘孔
    vec3 cork = mix(C_FUR, C_BONE, 0.2) * 0.5;
    // 軟木是一粒一粒壓起來的：每一粒（約 8 px）顏色深淺不同、粒與粒之間的縫暗一點；再加很淡的大塊明暗
    vec2 cg = p / 8.0, gi = floor(cg), gf = fract(cg);
    float d1 = 9.0, d2 = 9.0; vec2 cid = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 r = o + 0.08 + 0.84 * hash22(gi + o) - gf;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; cid = gi + o; } else if (d < d2) d2 = d;
    }
    float edge = sqrt(d2) - sqrt(d1);
    float hv = hash12(cid);
    float g3 = fbm(p / 200.0, 2), g5 = snoise(p / 30.0 + 1.7);
    vec3 col = cork * (0.94 + 0.13 * (hv - 0.5) + 0.035 * g3 + 0.03 * g5) * (1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.22, edge)));
    // 少數深色的粒（樹皮的斑）
    col *= 1.0 - 0.18 * step(0.93, hv) * smoothstep(0.05, 0.3, edge);
    vec2 hc = floor(p / 130.0);
    vec2 hh = hash22(hc);
    if (hh.x < 0.22) {
      vec2 hp = (hc + 0.2 + 0.6 * hash22(hc + 9.0)) * 130.0;
      col *= 1.0 - 0.45 * (1.0 - smoothstep(1.6, 2.8, length(p - hp)));
    }
    // 光從左上來：左上亮一點、右下暗一點
    col *= 0.9 + 0.13 * (1.0 - smoothstep(0.0, 2400.0, p.x * 0.75 + p.y));
    // ---- 上緣的木頭外框（在板子前面一點，下緣在軟木上留一道影子）
    col *= 1.0 - 0.32 * exp(-max(p.y - ${FRAME}.0, 0.0) / 9.0) * step(${FRAME}.0, p.y);
    if (p.y < ${FRAME}.0) {
      vec3 wood = woodGrain(vec2(p.x, p.y * 1.4), mix(C_FUR, C_SEPIA, 0.32) * 0.55);
      // 斜面：上面亮、靠板子那邊暗
      wood *= 1.05 - 0.25 * smoothstep(${FRAME - 14}.0, ${FRAME}.0, p.y) + 0.12 * (1.0 - smoothstep(0.0, 8.0, abs(p.y - ${FRAME - 22}.0)));
      col = mix(col, wood, 1.0 - smoothstep(${FRAME - 1}.0, ${FRAME}.0, p.y));
    }
    // ---- 相片的影子：釘在上緣，下面翹起來，越下面影子越遠、越軟
    vec2 oh = ph + vec2(pb);
    vec2 q = rot2(pa) * (p - pc) / ps;
    float fy = clamp((q.y + oh.y) / (2.0 * oh.y), 0.0, 1.0);
    vec2 qs = q - vec2(6.0 + 7.0 * fy, 8.0 + 12.0 * fy) * lift;
    float ds = sdBox(qs, oh);
    col *= 1.0 - 0.36 / lift * softShadow(ds, 6.0 + 14.0 * fy * lift);
    // ---- 索引卡的影子
    vec2 kq = rot2(ca) * (p - cc);
    if (cardOn > 0.0) {
      float fk = clamp((kq.y + chh.y) / (2.0 * chh.y), 0.0, 1.0);
      float dk = sdBox(kq - vec2(5.0 + 4.0 * fk, 7.0 + 8.0 * fk), chh);
      col *= 1.0 - 0.3 * cardOn * softShadow(dk, 6.0 + 10.0 * fk);
    }
    // ---- 相片
    float dO = sdBox(q, oh);
    if (dO < 1.0) {
      float a = 1.0 - smoothstep(-0.8, 0.8, dO * ps);
      vec3 pr = C_BONE * (0.84 + 0.02 * snoise(q / 4.0));
      // 下緣兩角翹起來：迎著光亮一點
      vec2 cq = vec2(oh.x - abs(q.x), oh.y - q.y);
      pr *= 1.0 + 0.05 * exp(-length(cq) / 70.0);
      float di = sdBox(q, ph);
      if (di < 1.0) {
        // 相片上的畫面是照片的 crop 那一塊（往焦點推）
        vec2 uv = mix(crop.xy, crop.zw, (q + ph) / (2.0 * ph));
        vec3 im = photoLin(photo, uv, lod);
        im *= 1.0 + 0.04 * exp(-length(cq) / 70.0);
        pr = mix(pr, im, 1.0 - smoothstep(-0.7, 0.7, di * ps));
      }
      col = mix(col, pr, a);
    }
    // ---- 索引卡：紅線、淡淡的橫格線、字（同一張圖層，跟著卡片轉）
    if (cardOn > 0.0) {
      float dk = sdBox(kq, chh);
      if (dk < 1.0) {
        float a = (1.0 - smoothstep(-0.8, 0.8, dk)) * cardOn;
        vec3 paper = mix(C_BONE, C_PAPER, 0.35) * (0.85 + 0.015 * snoise(kq / 3.5));
        float ly = kq.y + chh.y;
        float red = 1.0 - smoothstep(0.5, 1.4, abs(ly - redY));
        float lines = 0.0;
        for (int i = 0; i < ${MAX_RULES}; i++) {
          if (float(i) >= nRules) break;
          lines = max(lines, 1.0 - smoothstep(0.4, 1.2, abs(ly - rules[i])));
        }
        paper = mix(paper, mix(paper, C_ASH * 0.75, 0.55), lines * 0.6);
        paper = mix(paper, C_COLLAR * 0.85, red * 0.7);
        // 下緣翹起一點：靠下面稍微亮
        paper *= 1.0 + 0.035 * smoothstep(chh.y * 0.4, chh.y, kq.y);
        vec4 tx = layerAt(cap, kq + chh, capSize);
        paper = paper * (1.0 - tx.a) + tx.rgb;
        col = mix(col, paper, a);
      }
    }
    // ---- 紅毛線：從照片的圖釘拉到卡片的圖釘，有一點下垂；細細的纖維、影子落在板子上
    if (yarnK > 0.0) {
      vec2 lo = min(min(ya, yb), yc) - 24.0, hi = max(max(ya, yb), yc) + 24.0;
      if (p.x > lo.x && p.y > lo.y && p.x < hi.x && p.y < hi.y) {
        float best = 1e9, bs = 0.0, sb = 1e9;
        vec2 prev = ya;
        for (int i = 1; i <= 28; i++) {
          float u = min(float(i) / 28.0, yarnK);
          vec2 cur = bez(u);
          vec2 ba = cur - prev;
          float bb = max(dot(ba, ba), 1e-4);
          vec2 pa2 = p - prev;
          float h = clamp(dot(pa2, ba) / bb, 0.0, 1.0);
          float d = length(pa2 - ba * h);
          if (d < best) { best = d; bs = float(i - 1) + h; }
          vec2 ps2 = pa2 - vec2(5.0, 8.0);
          float hs = clamp(dot(ps2, ba) / bb, 0.0, 1.0);
          sb = min(sb, length(ps2 - ba * hs));
          prev = cur;
          if (float(i) / 28.0 >= yarnK) break;
        }
        col *= 1.0 - 0.26 * exp(-max(sb - 1.2, 0.0) / 3.5);
        float a = 1.0 - smoothstep(1.5, 2.6, best);
        if (a > 0.0) {
          float seg = length(yb - ya) * 1.08 / 28.0;
          float fib = 0.82 + 0.18 * sin(bs * seg * 1.25 + best * 1.6);
          vec3 yc3 = C_COLLAR * (0.75 + 0.35 * (1.0 - best / 2.6)) * fib;
          col = mix(col, yc3, a);
        }
      }
    }
    col = pinOver(col, p, pin0);
    col = pinOver(col, p, pin2);
    col = pinOver(col, p, pin1);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, cap: { value: null }, capSize: { value: new THREE.Vector2(1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, roll: { value: 0 },
  pc: { value: new THREE.Vector2() }, ph: { value: new THREE.Vector2() }, pb: { value: 20 }, pa: { value: 0 }, ps: { value: 1 }, lift: { value: 1 },
  cc: { value: new THREE.Vector2() }, chh: { value: new THREE.Vector2() }, ca: { value: 0 }, cardOn: { value: 0 },
  redY: { value: 64 }, rules: { value: new Array<number>(MAX_RULES).fill(0) }, nRules: { value: 0 },
  pin0: { value: new THREE.Vector4() }, pin1: { value: new THREE.Vector4() }, pin2: { value: new THREE.Vector4() },
  ya: { value: new THREE.Vector2() }, yb: { value: new THREE.Vector2() }, yc: { value: new THREE.Vector2() }, yarnK: { value: 0 },
  lod: { value: 0 }, k: { value: 1 },
});

/** 索引卡：紅線在卡片上緣往下多少、字的左右留白、下緣留白。 */
const RY = 64, PADX = 44, PADB = 40;
/** 相片跟卡片之間的空隙。 */
const GAP = 92;

/** 把局部座標 (x, y) 轉 a 弧度（跟 shader 的 rot2(a) * (p - c) 是反過來的那一個）。 */
const rot = (x: number, y: number, a: number) => ({ x: Math.cos(a) * x - Math.sin(a) * y, y: Math.sin(a) * x + Math.cos(a) * y });

export default class Pegboard extends Scene {
  bg = shared('pegboard.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  ph: P2Photo | null = null;
  cap: Caption | null = null;
  card: Layer2D | null = null;
  /** 相片中心、照片半寬高、白邊、角度。 */
  px = W / 2; py = H / 2; hw = 0; hh = 0; pb = 20; pa = 0;
  /** 卡片中心、半寬高、角度；格線（卡片上由上往下的 px）。 */
  cx = 0; cy = 0; cw = 0; ch = 0; ca = 0; rules: number[] = [];
  gx = W / 2;
  tCard = 0; tYarn = 0;

  override async init() {
    const ctx = this.ctx;
    await loadText(`${ctx.params.photo?.caption ?? ''}${ctx.params.photo?.album ?? ''}`);
    await loadWords(ctx);
    [this.ph] = await loadPhotos(ctx, (x) => this.track(x), 1);
    const ph = this.ph!;
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    // 寬 600：60 字的長留言在 40 px 排得進四行
    this.cap = new Caption(ctx, meas.ctx, {
      family: F.hand(400), w: 600, h: 400, min: 40, max: 50, lineHeight: 1.42, maxLines: 4,
      ink: rgba('sepia', 0.9), unsung: rgba('sepia', 0.42), active: mixRgba('signal', 'sepia', 0.45), sigInk: rgba('sepia', 0.7), sigSize: 28,
      lyricSize: 46, lyricSubSize: 38,
      label: { family: F.hand(700), size: 22, color: rgba('sepia', 0.6), tracking: 4, gap: 28 },
    });
    const cap = this.cap;
    const hasCard = cap.on;
    const tx = cap.text;
    const cw = hasCard ? Math.max(420, cap.width + 2 * PADX) : 0;
    const ch = hasCard ? RY + 14 + tx.height + PADB + 6 : 0;
    this.cw = cw / 2; this.ch = ch / 2;
    // 格線：字的每一行（主字、署名、歌詞）基線下面一點點一條；下面還有空就照行距往下排滿（索引卡的格線一路到底）
    if (hasCard) {
      const top = RY + 14;
      const ys: number[] = [];
      if (tx.fit) {
        tx.fit.lines.forEach((_, i) => ys.push(top + tx.fit!.size * 0.9 + i * tx.fit!.lineHeight + 8));
        if (tx.sigH) ys.push(top + tx.fit.height + tx.sigH - tx.sigSize * 0.12 + 8);
      }
      if (tx.sung) {
        const l0 = top + tx.lyricTop + tx.lyricSize * 0.9 + 8;
        ys.push(l0);
        if (tx.lyricH > tx.lyricSize * 1.6) ys.push(l0 + tx.lyricSize * (tx.fit ? 1.22 : 1.42));
      }
      const step = cap.lineHeight;
      while (ys.length < MAX_RULES && ys[ys.length - 1]! + step < ch - 14) ys.push(ys[ys.length - 1]! + step);
      this.rules = ys.slice(0, MAX_RULES);
    }
    // 相片：有卡片時寬度讓給卡片；白邊照大小
    const maxOuterW = hasCard ? W - 2 * 175 - GAP - cw : 1250, maxOuterH = hasCard ? 740 : 800;
    const pre = fitIn(ph.w, ph.h, maxOuterW - 50, maxOuterH - 50);
    this.pb = clamp(0.045 * Math.min(pre.w, pre.h), 16, 30);
    const fit = fitIn(ph.w, ph.h, maxOuterW - 2 * this.pb, maxOuterH - 2 * this.pb);
    this.hw = fit.w / 2; this.hh = fit.h / 2;
    const ow = fit.w + 2 * this.pb, oh = fit.h + 2 * this.pb;
    const groupW = hasCard ? ow + GAP + cw : ow;
    const x0 = (W - groupW) / 2;
    this.px = x0 + ow / 2;
    this.py = 560 - (hasCard ? 0 : 10);
    this.gx = x0 + groupW / 2;
    const r = hash(this.seed, 7) * 2 - 1;
    this.pa = (1.2 + 1.6 * Math.abs(r)) * Math.sign(r || 1) * (Math.PI / 180);
    if (hasCard) {
      this.cx = x0 + ow + GAP + cw / 2;
      // 卡片比照片的中線高一點點（毛線從照片右上角的釘子往下垂到卡片），最後一行字在 HUD 區上面
      this.cy = clamp(this.py - 40, 150 + ch / 2, 820 - ch / 2);
      void oh;
      this.ca = -Math.sign(r || 1) * (1.4 + 1.2 * hash(this.seed, 8)) * (Math.PI / 180);
      this.card = this.track(new Layer2D(cw, ch, undefined, { fast: true }));
      const au = ctx.audio;
      this.tCard = Math.min(beatAfter(au, ctx.start + 0.05, 1), ctx.start + 0.9);
      this.tYarn = Math.min(beatAfter(au, this.tCard + 0.05, 1), this.tCard + 0.8);
      cap.writeFrom(this.tCard + 0.35, 2);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const ph = this.ph!;
    const u = this.bg.u;
    const z = settle(lt);
    // 相片上的畫面往焦點推一點（實體相片：1.15 倍；很小的照片少推）
    const kf = settleK(lt);
    const crop = focusCrop(ph.ref, ph.w, ph.h, ph.w / ph.h, kf, { zoom: 1.15, screenW: 2 * this.hw * 1.05 });
    v4(u.crop!, crop[0], crop[1], crop[2], crop[3]);
    // 鏡頭：手持的感覺（很小、很慢地漂、轉一點點），慢慢推近，同時往相片上的臉靠；沒有卡片時直接往臉推近。
    // 卡片上的字一直在畫面的安全區裡
    const hx = 7 * noise1(t * 0.35, 11), hy = 5 * noise1(t * 0.3, 23), hr = 0.0045 * noise1(t * 0.25, 31);
    const [ix, iy] = focusIn(ph.ref, crop);
    const fl = rot((2 * ix - 1) * this.hw, (2 * iy - 1) * this.hh, this.pa);
    const faceX = this.px + fl.x, faceY = this.py + fl.y;
    const pull = this.card ? 0.3 : 0.55;
    let cam = {
      x: this.gx - 30 * (1 - z) + hx + (faceX - this.gx) * pull * kf,
      y: 548 - 26 * (1 - z) + hy + (faceY - 548) * pull * kf,
      z: 1 + 0.05 * z + (this.card ? 0.02 : 0.1) * kf,
    };
    if (this.card) cam = keepIn(cam, [[this.cx - this.cw + 16, this.cy - this.ch + 16, this.cx + this.cw - 16, this.cy + this.ch - 12]]);
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    u.roll!.value = hr;
    // 照片被釘上去：從 1.05 倍縮回來、影子收緊；釘子晚一點點按下去
    const pin = ease.outCubic(prog(t, s, s + 0.32));
    const ps = lerp(1.05, 1, pin);
    v2(u.pc!, this.px, this.py);
    v2(u.ph!, this.hw, this.hh);
    u.pb!.value = this.pb;
    u.pa!.value = this.pa;
    u.ps!.value = ps;
    u.lift!.value = lerp(2.2, 1, pin);
    u.photo!.value = ph.tex;
    u.lod!.value = mipLod(ph.w * (crop[2] - crop[0]), 2 * this.hw * cam.z);
    // 兩顆圖釘釘在上緣兩角（白邊上），右邊那顆晚一點點
    const ow = this.hw + this.pb, oh = this.hh + this.pb, inset = Math.max(this.pb * 0.55, 12) + 6;
    const pL = rot((-ow + inset) * ps, (-oh + inset) * ps, this.pa), p0 = rot((ow - inset) * ps, (-oh + inset) * ps, this.pa);
    const pinA = ease.outBack(prog(t, s + 0.1, s + 0.34)), pinC = ease.outBack(prog(t, s + 0.2, s + 0.44));
    (u.pin0!.value as THREE.Vector4).set(this.px + pL.x, this.py + pL.y, lerp(1.7, 1, pinA), prog(t, s + 0.06, s + 0.14));
    (u.pin2!.value as THREE.Vector4).set(this.px + p0.x, this.py + p0.y, lerp(1.7, 1, pinC), prog(t, s + 0.16, s + 0.24));
    if (this.card && this.cap) {
      // 卡片在下一拍滑進來（從右上一點、斜一點），釘子按下去
      const kc = ease.outCubic(prog(t, this.tCard, this.tCard + 0.38));
      const cx = this.cx + 70 * (1 - kc), cy = this.cy - 24 * (1 - kc), ca = this.ca + 0.09 * (1 - kc);
      v2(u.cc!, cx, cy);
      v2(u.chh!, this.cw, this.ch);
      u.ca!.value = ca;
      u.cardOn!.value = kc;
      u.redY!.value = RY;
      const rl = u.rules!.value as number[];
      for (let i = 0; i < MAX_RULES; i++) rl[i] = this.rules[i] ?? 0;
      u.nRules!.value = this.rules.length;
      const L = this.card;
      if (this.cap.draw(L, PADX, this.cap.label ? RY - 36 : RY + 14, t)) L.upload();
      u.cap!.value = L.texture;
      v2(u.capSize!, L.w, L.h);
      // 卡片的釘子在左上角（相簿名寫在抬頭，從釘子右邊開始）
      const p1l = rot(-this.cw + 24, -this.ch + 22, ca);
      const p1 = { x: cx + p1l.x, y: cy + p1l.y };
      const pinB = ease.outBack(prog(t, this.tCard + 0.3, this.tCard + 0.52));
      (u.pin1!.value as THREE.Vector4).set(p1.x, p1.y, lerp(1.7, 1, pinB), prog(t, this.tCard + 0.26, this.tCard + 0.34));
      // 毛線：從照片的釘子拉到卡片的釘子，有一點下垂（拉好之後很輕地晃）
      const a = { x: this.px + p0.x, y: this.py + p0.y };
      const d = Math.hypot(p1.x - a.x, p1.y - a.y);
      const yk = ease.inOutCubic(prog(t, this.tYarn, this.tYarn + 0.5));
      const sag = (40 + 0.18 * d) * (1 + 0.06 * Math.sin(t * 1.3));
      v2(u.ya!, a.x, a.y);
      v2(u.yb!, p1.x, p1.y);
      v2(u.yc!, (a.x + p1.x) / 2, (a.y + p1.y) / 2 + sag);
      u.yarnK!.value = yk;
    } else {
      // 共用的 pass 可能還指著上一個窗格（已經釋放）的圖層：清掉
      u.cardOn!.value = 0;
      u.cap!.value = null;
      u.yarnK!.value = 0;
      (u.pin1!.value as THREE.Vector4).set(0, 0, 1, 0);
    }
    u.k!.value = (0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.05, vignette: 0.3 };
  }
}
