// 照片版面「照片牆」（亮，5 張）：樓梯旁的牆上掛著大小不一的相框——
//  - 牆上一條沿著樓梯斜斜往上的木扶手，下面是樓梯的側面（一階一階的鋸齒輪廓），扶手與相框都有往左下落的軟影（光從右上的窗來）。
//  - 五個相框沿著樓梯一路往上排（白框加卡紙、黑色細框、原木框、細金框、黑框），主角（第一張）最大、在最上面。
//  - 鏡頭從樓梯下面（左下）沿著扶手往上搖到主角那張，停下來後很慢地推近；樓梯比牆靠近鏡頭，搖的時候動得比牆多（視差）。
//  - 主角框裡的照片往新人點的焦點（臉）慢慢推近；鏡頭停下來後也往臉那邊推（字一直在畫面的安全區裡）。
//  - 主字（賓客留言＋署名，或主角的註解）寫在主角左邊、樓梯上方空著的那片牆上（思源宋體，像牆上的字），歌詞小一號寫在下面跟唱，
//    鏡頭快到的時候淡入；沒有主字就把歌詞寫在同一個位置跟唱；兩樣都沒有就沒有字，鏡頭停在主角正前方、往臉推近。
//  - 每一張都完整放（橫的、直的、手機直拍、很小的舊照片都不裁），很小的照片最多放大 1.5 倍。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, keepIn, drawLayer, v4, type P2Photo } from './_p2';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, photos: 5, family: 'photo', series: 'frame', paper: true, energy: [0.2, 1], bars: [2, 8], weight: 1, prefers: ['landscape'] };

/** 扶手（世界座標）：y = RAIL0 − SLOPE·x；樓梯的踏板線在扶手下面 STEP_DY。 */
const RAIL0 = 1080, SLOPE = 0.2, STEP_DY = 250;
/** 每一階的寬、高（斜率跟扶手一樣）。 */
const RUN = 248, RISE = RUN * SLOPE;

/**
 * 五個相框的位置（世界座標，鏡頭停下來時就是畫面座標）：中心、最大外框（含框與卡紙）、框的樣式。
 * 主角在右上；左上那片空牆留給註解；其他沿著樓梯往左下排（鏡頭一開始在那裡）。
 */
const SLOTS: { x: number; y: number; w: number; h: number; style: number; frame: number; mat: number }[] = [
  { x: 1330, y: 470, w: 600, h: 450, style: 0, frame: 22, mat: 0.1 },
  { x: 860, y: 680, w: 280, h: 240, style: 1, frame: 10, mat: 0.12 },
  { x: 420, y: 800, w: 250, h: 230, style: 2, frame: 20, mat: 0 },
  { x: -140, y: 920, w: 280, h: 230, style: 3, frame: 12, mat: 0.12 },
  { x: 1800, y: 300, w: 230, h: 280, style: 4, frame: 14, mat: 0 },
];

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform sampler2D p0; uniform sampler2D p1; uniform sampler2D p2; uniform sampler2D p3; uniform sampler2D p4;
  // 每個相框：A = 中心 x、y、照片半寬、半高；B = 框寬、卡紙寬、樣式、mip 層
  uniform vec4 fA[5]; uniform vec4 fB[5];
  // 主角框裡的畫面是照片的哪一塊（往焦點推）；其他張是整張
  uniform vec4 crop0;
  uniform vec3 cam; uniform vec2 par; uniform float t; uniform float k;

  float railY(float x) { return ${RAIL0}.0 - ${SLOPE} * x; }

  vec3 frameBase(int st) {
    if (st == 0) return mix(C_BONE, C_PAPER, 0.3) * 0.74;
    if (st == 1 || st == 4) return C_INK2 * 1.3 + C_GRAPHITE * 0.08;
    if (st == 2) return mix(C_FUR, C_SEPIA, 0.32) * 0.62;
    return mix(C_FUR, C_BONE, 0.3) * 0.72;
  }

  void drawFrame(inout vec3 col, vec2 p, sampler2D tex, vec4 A, vec4 B, vec4 cr) {
    vec2 q = p - A.xy;
    vec2 ph = A.zw;
    float fw = B.x, mat = B.y;
    vec2 oh = ph + vec2(fw + mat);
    float d = sdBox(q, oh);
    if (d > 1.0) return;
    float a = 1.0 - smoothstep(-0.8, 0.8, d);
    int st = int(B.z + 0.5);
    vec2 e = oh - abs(q);
    float dd = min(e.x, e.y);
    vec2 nOut = e.x < e.y ? vec2(sign(q.x), 0.0) : vec2(0.0, sign(q.y));
    // 框的斜面：朝右上（窗）的那面亮
    float lit = 1.0 + 0.28 * dot(nOut, vec2(0.7071, -0.7071)) * (1.0 - smoothstep(0.0, fw * 0.8, dd));
    vec3 base = frameBase(st);
    vec3 c = (st == 2 ? woodGrain(e.x < e.y ? vec2(q.y, q.x + 300.0) : q, base) : base) * lit;
    // 金框：一道細細的亮線
    if (st == 3) c += C_BONE * 0.08 * (1.0 - smoothstep(0.0, 1.5, abs(dd - fw * 0.45)));
    float dm = sdBox(q, ph + vec2(mat));
    if (dm < 0.8) {
      vec3 m = mix(C_BONE, C_PAPER, 0.45) * 0.8;
      // 框在卡紙（沒有卡紙就在照片）上留一道影子：光從右上 → 影子在左邊、上面
      float sl = q.x + ph.x + mat, stp = q.y + ph.y + mat;
      float inner = clamp(exp(-sl / 7.0) + exp(-stp / 7.0), 0.0, 1.0);
      float di = sdBox(q, ph);
      // 卡紙的斜切口：一圈很細的亮邊
      m *= 1.0 + 0.1 * (1.0 - smoothstep(0.0, 3.0, di)) * step(0.0, di);
      if (di < 0.8) {
        vec2 uv = mix(cr.xy, cr.zw, (q + ph) / (2.0 * ph));
        vec3 pc = photoLin(tex, uv, B.w);
        pc *= 1.0 - 0.12 * clamp(exp(-(q.x + ph.x) / 4.0) + exp(-(q.y + ph.y) / 4.0), 0.0, 1.0) * step(0.5, mat);
        m = mix(m, pc, 1.0 - smoothstep(-0.7, 0.7, di));
      }
      m *= 1.0 - 0.3 * inner;
      c = mix(c, m, 1.0 - smoothstep(-0.7, 0.7, dm));
      // 玻璃：一道很淡的斜反光
      c += C_BONE * 0.025 * exp(-pow((q.x * 0.6 - q.y - 0.2 * oh.x) / (0.22 * oh.x + 30.0), 2.0)) * (1.0 - smoothstep(-0.7, 0.7, dm));
    }
    col = mix(col, c, a);
  }

  float frameShadow(vec2 p, vec4 A, vec4 B) {
    vec2 oh = A.zw + vec2(B.x + B.y);
    float d = sdBox(p - A.xy - vec2(-14.0, 18.0), oh);
    return softShadow(d, 18.0);
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // 牆：刷過的漆（很細的滾筒紋），右上角窗戶的光
    vec3 wall = mix(C_PAPER, C_BONE, 0.35) * 0.62;
    wall *= 1.0 + 0.012 * snoise(p / vec2(3.0, 9.0)) + 0.02 * fbm(p / 600.0, 2);
    vec2 wq = (p - vec2(2100.0, -200.0)) / vec2(1500.0, 1100.0);
    vec3 warm = mix(C_BONE, C_FUR, 0.14);
    // 窗戶照進來一大塊斜斜的光（很軟），整個窗格很慢地往左下移；越往下越暗一點
    float sx = p.x - 0.55 * p.y + 6.0 * t;
    float sunA = smoothstep(380.0, 760.0, sx) * (1.0 - smoothstep(1500.0, 1900.0, sx)) * (1.0 - smoothstep(500.0, 1100.0, p.y));
    vec3 col = wall * (1.0 - 0.1 * smoothstep(300.0, 1300.0, p.y)) + warm * (0.1 * exp(-dot(wq, wq) * 1.2) + 0.2 * sunA);
    // 扶手下面的牆（樓梯那一側）暗一點
    float ry = railY(p.x);
    col *= 1.0 - 0.07 * smoothstep(ry, ry + 60.0, p.y);
    // 相框的影子
    float sh = 0.0;
    for (int i = 0; i < 5; i++) sh = max(sh, frameShadow(p, fA[i], fB[i]));
    col *= 1.0 - 0.3 * sh;
    // ---- 扶手：木頭圓棒（上面亮）、牆上的影子、每隔一段一個托架
    float pd = (p.y - ry) * 0.9701;
    col *= 1.0 - 0.28 * exp(-pow(max(pd - 14.0, 0.0) / 12.0, 1.0)) * step(-8.0, pd);
    float bx = mod(p.x - 160.0, 560.0) - 280.0;
    float br = (1.0 - smoothstep(5.0, 7.0, abs(bx))) * step(ry, p.y) * (1.0 - smoothstep(ry + 30.0, ry + 32.0, p.y));
    col = mix(col, C_GRAPHITE * 0.5, br * 0.85);
    float rw = 1.0 - smoothstep(9.0, 10.5, abs(pd));
    if (rw > 0.0) {
      vec3 wood = woodGrain(vec2(p.x * 1.03, pd * 4.0), mix(C_FUR, C_SEPIA, 0.35) * 0.55);
      wood *= 0.75 + 0.5 * smoothstep(8.0, -6.0, pd) - 0.2 * smoothstep(-2.0, 9.0, pd);
      wood += C_BONE * 0.1 * exp(-pow((pd + 5.0) / 2.0, 2.0));
      col = mix(col, wood, rw);
    }
    // ---- 踢腳板：沿著樓梯貼在牆上的一條白色斜板（上緣一道亮線、下面接樓梯）
    float sk = p.y - (${RAIL0 + STEP_DY - 70}.0 - ${SLOPE} * p.x);
    if (sk > -2.0) {
      vec3 board = mix(C_PAPER, C_BONE, 0.4) * 0.7 * (1.0 + 0.1 * exp(-max(sk, 0.0) / 2.5));
      // exp 的指數夾在 0 以下：踢腳板下面很遠的地方 exp 會溢位成 Inf，乘 0 變 NaN（鏡頭往右下推時看得到一塊黑）
      col = mix(col * (1.0 - 0.18 * exp(min(sk, 0.0) / 6.0)), board, smoothstep(-1.0, 0.5, sk));
    } else col *= 1.0 - 0.14 * exp(sk / 8.0);
    // ---- 相框
    const vec4 FULL = vec4(0.0, 0.0, 1.0, 1.0);
    drawFrame(col, p, p3, fA[3], fB[3], FULL);
    drawFrame(col, p, p2, fA[2], fB[2], FULL);
    drawFrame(col, p, p1, fA[1], fB[1], FULL);
    drawFrame(col, p, p4, fA[4], fB[4], FULL);
    drawFrame(col, p, p0, fA[0], fB[0], crop0);
    // ---- 樓梯（比牆靠近鏡頭：鏡頭搖的時候動得比較多）：一階一階的鋸齒輪廓，踏板的端面是木頭，側板刷白漆
    vec2 s = p + par;
    float kx = floor(s.x / ${RUN.toFixed(1)});
    float ty = ${RAIL0 + STEP_DY}.0 + ${RISE.toFixed(2)} - ${RISE.toFixed(2)} * kx;
    float lx = s.x - kx * ${RUN.toFixed(1)};
    // 踢板下緣的接觸陰影（每一階的左邊、靠上一階的那一面）
    col *= 1.0 - 0.18 * smoothstep(ty - 40.0, ty, s.y) * step(s.y, ty);
    if (s.y > ty) {
      float dy = s.y - ty;
      // 樓梯的側面（比牆近、在扶手的影子裡，暗一點）：踏板的端面是木頭，每一階的踢板邊是一條亮一點的白漆
      vec3 side = mix(C_PAPER, C_BONE, 0.3) * 0.47 * (1.0 + 0.012 * snoise(s / vec2(4.0, 10.0)));
      side *= 1.0 - 0.12 * smoothstep(0.0, 500.0, dy);
      float riser = (1.0 - smoothstep(7.0, 8.5, lx)) * step(20.0, dy) * (1.0 - smoothstep(${RISE.toFixed(1)} + 18.0, ${RISE.toFixed(1)} + 22.0, dy));
      side = mix(side, mix(C_PAPER, C_BONE, 0.4) * 0.66, riser);
      vec3 tread = woodGrain(vec2(s.x * 1.1, dy * 3.0 + kx * 40.0), mix(C_FUR, C_SEPIA, 0.38) * 0.58) * (1.08 - 0.25 * smoothstep(0.0, 20.0, dy));
      float te = 1.0 - smoothstep(20.0, 21.5, dy);
      // 踏板比側板突出一點：下面一道影子
      side *= 1.0 - 0.25 * exp(-max(dy - 21.0, 0.0) / 9.0) * (1.0 - te);
      col = mix(side, tread, te);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  p0: { value: null }, p1: { value: null }, p2: { value: null }, p3: { value: null }, p4: { value: null },
  fA: { value: Array.from({ length: 5 }, () => new THREE.Vector4()) }, fB: { value: Array.from({ length: 5 }, () => new THREE.Vector4()) },
  crop0: { value: new THREE.Vector4(0, 0, 1, 1) },
  cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, par: { value: new THREE.Vector2() }, t: { value: 0 }, k: { value: 1 },
});

/** 字那一塊（世界座標）：主角左邊、樓梯上面的空牆。寬 600：60 字的長留言在 40 px 排得進四行。 */
const COL = { x: 150, w: 600, h: 400 };

interface Placed { x: number; y: number; hw: number; hh: number; fw: number; mat: number; style: number; ph: P2Photo }

export default class StairWall extends Scene {
  bg = shared('stairwall.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  photos: P2Photo[] = [];
  placed: Placed[] = [];
  cap: Caption | null = null;
  text: Layer2D | null = null;
  colY = 0;
  /** 鏡頭停下來的位置。 */
  end = { x: W / 2, y: H / 2, z: 1 };
  panD = 2;

  override async init() {
    const ctx = this.ctx;
    await loadText(`${ctx.params.photo?.caption ?? ''}${ctx.params.photo?.album ?? ''}`);
    await loadWords(ctx);
    this.photos = await loadPhotos(ctx, (x) => this.track(x), 5);
    // 每一個位置放一張：照片完整放進「最大外框 − 框 − 卡紙」
    this.placed = this.photos.map((ph, i) => {
      const sl = SLOTS[i]!;
      const pre = fitIn(ph.w, ph.h, sl.w - 2 * sl.frame, sl.h - 2 * sl.frame);
      const mat = sl.mat ? Math.round(sl.mat * Math.min(pre.w, pre.h)) : 0;
      const fit = fitIn(ph.w, ph.h, sl.w - 2 * (sl.frame + mat), sl.h - 2 * (sl.frame + mat));
      return { x: sl.x, y: sl.y, hw: fit.w / 2, hh: fit.h / 2, fw: sl.frame, mat, style: sl.style, ph };
    });
    // 主角的框貼著扶手上面一點：照片矮的時候往下靠，不要懸在半空
    const m = this.placed[0]!;
    const ohw = m.hw + m.fw + m.mat, ohh = m.hh + m.fw + m.mat;
    const railAt = RAIL0 - SLOPE * (m.x + ohw);
    m.y = Math.min(m.y + (SLOTS[0]!.h / 2 - ohh) * 0.6, railAt - 40 - ohh);
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    this.cap = new Caption(ctx, meas.ctx, {
      family: F.ming(400), w: COL.w, h: COL.h, min: 40, max: 50, lineHeight: 1.46, maxLines: 4,
      ink: rgba('sepia', 0.9), unsung: rgba('sepia', 0.42), active: mixRgba('signal', 'sepia', 0.45), sigInk: rgba('sepia', 0.7), sigSize: 28,
      lyricSize: 46, lyricSubSize: 38,
      label: { family: F.hei(500), size: 20, color: rgba('sepia', 0.55), tracking: 6, gap: 22 },
    });
    const cap = this.cap;
    const dur = ctx.end - ctx.start;
    // 搖到主角要多久：窗格短就快一點（3 秒的窗格也要看得到停下來的樣子）
    this.panD = clamp(0.42 * dur, 1.2, 2.6);
    if (cap.on) {
      const blockH = cap.height + 40;
      // 跟主角的中心對齊，但不要低到碰到左下的相框（第二張的上緣在 y ≈ 560，字的下緣留在那上面）
      this.colY = Math.max(130, Math.min(m.y - blockH / 2 - 40, 600 - blockH));
      this.text = this.track(new Layer2D(COL.w + 40, Math.ceil(blockH + 40), undefined, { fast: true }));
      this.end = { x: W / 2 + 6, y: H / 2 - 10, z: 1 };
    } else {
      // 沒有字：鏡頭停在主角正前方
      this.end = { x: m.x - 150, y: m.y + 110, z: 1.06 };
    }
  }

  /** 主角框裡的畫面（往焦點推）與臉在牆上的位置。 */
  private focusAt(t: number) {
    const m = this.placed[0]!;
    // 鏡頭停下來之前就開始推（框裡的畫面不跟鏡頭搶，從進場就慢慢推）
    const kf = settleK(t - this.ctx.start);
    const crop = focusCrop(m.ph.ref, m.ph.w, m.ph.h, m.ph.w / m.ph.h, kf, { zoom: 1.2, screenW: 2 * m.hw });
    const [ix, iy] = focusIn(m.ph.ref, crop);
    return { crop, face: { x: m.x + (2 * ix - 1) * m.hw, y: m.y + (2 * iy - 1) * m.hh } };
  }

  private camAt(t: number) {
    const s = this.ctx.start;
    const lt = t - s;
    // 從樓梯下面（左下、近一點）沿著扶手往上搖：x、y 照扶手的斜率走
    const dir = hash(this.seed, 4) < 0.5 ? 0 : 1;
    const start = { x: lerp(280, 380, dir), y: lerp(880, 850, dir), z: this.end.z * 1.16 };
    const pe = ease.inOutCubic(prog(t, s, s + this.panD));
    let x = lerp(start.x, this.end.x, pe), y = lerp(start.y, this.end.y, pe);
    // 中途鏡頭稍微拉遠一點（像搖鏡時往後退），到了再慢慢推近
    let z = lerp(start.z, this.end.z, pe) - 0.05 * Math.sin(Math.PI * pe);
    const push = settle(lt - this.panD, 6);
    const { face } = this.focusAt(t);
    const cap = this.text ? this.cap : null;
    const zz = z * (1 + (cap ? 0.05 : 0.14) * push);
    // 推近時繞著一個點（它在畫面上的位置不動）：沒有字繞著主角的臉；有字繞著字與臉的中間
    const pc = cap ? { x: (COL.x + cap.width / 2 + face.x) / 2, y: (this.colY + cap.height / 2 + face.y) / 2 } : face;
    x += (pc.x - x) * (1 - z / zz);
    y += (pc.y - y) * (1 - z / zz);
    z = zz;
    // 再往臉那邊移一點，看得出鏡頭在找那張臉
    x += (face.x - x) * (cap ? 0.12 : 0.3) * push;
    y += (face.y - y) * (cap ? 0.12 : 0.3) * push;
    if (cap) {
      // 字一直在畫面的安全區裡（搖過來的途中字還沒出來，跟著搖的進度漸進，鏡頭不會跳）
      const k = keepIn({ x, y, z }, [[COL.x, this.colY, COL.x + cap.width, this.colY + cap.height + 0.25 * cap.size]]);
      x = lerp(x, k.x, pe); y = lerp(y, k.y, pe);
    }
    return { x, y, z };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const cam = this.camAt(t);
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    // 樓梯比牆近：鏡頭離停下來的位置越遠，樓梯多移一點
    (u.par!.value as THREE.Vector2).set((cam.x - this.end.x) * 0.22, (cam.y - this.end.y) * 0.22);
    const A = u.fA!.value as THREE.Vector4[], B = u.fB!.value as THREE.Vector4[];
    const { crop } = this.focusAt(t);
    v4(u.crop0!, crop[0], crop[1], crop[2], crop[3]);
    this.placed.forEach((pl, i) => {
      A[i]!.set(pl.x, pl.y, pl.hw, pl.hh);
      B[i]!.set(pl.fw, pl.mat, pl.style, mipLod(pl.ph.w * (i === 0 ? crop[2] - crop[0] : 1), 2 * pl.hw * cam.z));
      u[`p${i}`]!.value = pl.ph.tex;
    });
    u.t!.value = t - s;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.6))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.cap && this.text) {
      const L = this.text;
      if (this.cap.draw(L, 20, 20, t)) L.upload();
      // 鏡頭快到主角時淡入（字是寫在牆上的，跟著鏡頭動）
      const op = prog(t, s + this.panD * 0.65, s + this.panD * 0.65 + 0.6, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      if (op > 0) drawLayer(comp, renderer, L, out, COL.x - 20, this.colY - 20, cam, op);
    }
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.05, vignette: 0.3 };
  }
}
