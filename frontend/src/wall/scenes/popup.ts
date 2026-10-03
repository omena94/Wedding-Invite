// 照片版面「立體卡片」（亮）：木桌上一張合起來的卡片，拍點上打開，照片從摺線裡「立」起來——
//  - 真的 3D：底頁、背頁、照片那一片、頂上連著背頁的紙條，四片紙照平行摺的機構動（照片那片永遠跟背頁平行，
//    卡片打開到九十幾度時照片直直站在背頁前面），每一片照光的方向打亮暗，照片在背頁與底頁上投下軟影，摺線附近比較暗。
//  - 切進來：卡片合著平放在桌上（封面是主題色的卡紙，壓了一圈細框），鏡頭從比較高的地方往下看；第一個拍點卡片彈開
//    （稍微過頭再回來），照片立起來，鏡頭同時降到斜前方；之後很慢地繞著卡片轉一點、往相片上的焦點推近，看得出照片站在空間裡。
//  - 焦點：鏡頭的目標從卡片中間慢慢移向相片上的焦點（字一直在安全區裡），相片上的畫面本身也往焦點小推一點。
//  - 字手寫在背頁上、照片的右邊（像卡片裡寫的話）：主字（賓客留言＋署名，或新人的註解）卡片打開以後一個字一個字寫出來，
//    歌詞小一號在下面跟唱；沒有主字時歌詞自己寫在同一個位置跟唱；兩個都沒有就只有照片（卡片窄一點，照片在正中間）。
//    相簿的第一張在字上面多一行小小的相簿名。
//  - 照片完整（貼在卡紙上、有一圈白邊），很小的照片最多放大到原尺寸約 1.5 倍（以畫面上的大小算）。
// 畫法：一個全螢幕 shader 自己打光線：桌面、底頁、背頁、照片片、頂條各是一個平面，算交點與在平面上的座標，
// 依前後順序疊（照片片與背頁誰在前面看鏡頭在背頁的哪一側，JS 算好）；抗鋸齒用平面座標的螢幕導數；影子是從交點往光的方向打一條光線看擋到誰。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, loadPhoto, p6Crop, pace, photoLod, setP6Photo } from './_p6';
import { focusCrop, focusIn, photoWords, settleK } from './_photo';
import { HUD_SAFE } from '../engine/hud';
import type { PhotoImage } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, prefers: ['landscape', 'square'], energy: [0.15, 1], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D tl;
  uniform vec3 camPos; uniform vec3 camR; uniform vec3 camU; uniform vec3 camF; uniform float foc;
  uniform float th;
  uniform vec3 card;      // 卡片左緣 x、寬、深（底頁與背頁一樣大）
  uniform vec4 pnl;       // 照片片左緣 x、寬、離摺線多遠 d、高 h
  uniform float bw; uniform float lod;
  uniform vec4 txt;       // 字層在背頁上：左緣 x、上緣（離摺線多遠）、寬、高
  uniform float textK; uniform float k;
  const vec3 LD = normalize(vec3(-0.5, 1.0, 0.8));

  // 從 P 往光的方向，被一片長方形（org + ex*a + ey*b，0 <= a <= size.x, 0 <= b <= size.y）擋住多少（軟邊：離得越遠越糊）
  float occ(vec3 P, vec3 org, vec3 ex, vec3 ey, vec2 size) {
    vec3 n = cross(ex, ey);
    float dn = dot(LD, n);
    if (abs(dn) < 1e-4) return 0.0;
    float u = dot(org - P, n) / dn;
    if (u <= 0.5) return 0.0;
    vec3 Q = P + LD * u - org;
    vec2 q = vec2(dot(Q, ex), dot(Q, ey));
    float d = sdBox(q - size * 0.5, size * 0.5);
    float w = 2.0 + u * 0.05;
    return 1.0 - smoothstep(-w, w, d);
  }
  float lam(vec3 n) { return 0.64 + 0.36 * max(dot(n, LD), 0.0); }
  // a = 0 時不要碰 c（很遠的交點算出來可能是 inf，乘 0 會變 NaN）
  vec4 over(vec4 dst, vec3 c, float a) { return a > 0.0 ? vec4(mix(dst.rgb, c, a), 1.0) : dst; }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 ro = camPos;
    vec3 rd = normalize(camR * (sp.x - ${W / 2}.0) + camU * (${H / 2}.0 - sp.y) + camF * foc);
    vec3 b = vec3(0.0, sin(th), cos(th));
    vec3 nb = vec3(0.0, cos(th), -sin(th));
    vec3 X = vec3(1.0, 0.0, 0.0);
    float cx0 = card.x, CW = card.y, CD = card.z;
    vec3 A = vec3(0.0, 0.0, pnl.z);
    vec3 Bp = b * pnl.w;
    vec3 pOrg = vec3(pnl.x, 0.0, pnl.z);

    // ---- 桌面（y = -3）：淺色原木
    float tT = rd.y < -1e-3 ? (-3.0 - ro.y) / rd.y : 1e5;
    vec3 Pt = ro + rd * min(tT, 2e4);
    vec2 wq = Pt.xz;
    // 遠處的木紋淡掉（又小又密會閃，也是景深）
    float near = 1.0 - smoothstep(1800.0, 6000.0, tT);
    float warp = fbm(vec2(wq.x / 900.0, wq.y / 140.0), 3);
    float ring = pow(max(0.5 + 0.5 * sin(fract(wq.y / 34.0 / 50.0 + warp * 0.1) * 314.159), 0.0), 3.0);
    vec3 wood = mix(C_FUR, C_BONE, 0.5) * 0.84 * (0.88 + 0.06 * warp) * (1.0 - near * (0.07 * ring + 0.03 * snoise(vec2(wq.x / 260.0, wq.y / 2.2))));
    float plank = abs(fract(wq.y / 420.0 + 0.37) - 0.5) * 420.0;
    wood *= 1.0 - 0.25 * (1.0 - smoothstep(0.5, 2.5, plank));
    // 卡片在桌上的影子
    float shT = max(max(occ(Pt, vec3(cx0, 0.0, 0.0), X, vec3(0.0, 0.0, 1.0), vec2(CW, CD)), occ(Pt, vec3(cx0, 0.0, 0.0), X, b, vec2(CW, CD))),
                    occ(Pt, pOrg, X, b, vec2(pnl.y, pnl.w)));
    wood *= 1.0 - 0.32 * shT;
    // 遠的地方淡一點、糊一點（景深）
    wood = mix(wood, mix(C_FUR, C_BONE, 0.62) * 0.8, 1.0 - near);
    vec4 col = vec4(wood, 1.0);

    // ---- 底頁（y = 0）
    float tB = -ro.y / rd.y;
    vec3 Pb = ro + rd * tB;
    vec2 lb = vec2(Pb.x - cx0, Pb.z);
    float aB = aaFill(sdBox(lb - vec2(CW, CD) * 0.5, vec2(CW, CD) * 0.5)) * step(0.0, tB);
    vec3 inner = C_PAPER * 1.02;
    vec3 cb = p6Paper(lb * 1.4, inner) * lam(vec3(0.0, 1.0, 0.0));
    float sb = max(occ(Pb, pOrg, X, b, vec2(pnl.y, pnl.w)), occ(Pb, vec3(cx0, 0.0, 0.0), X, b, vec2(CW, CD)) * step(th, 1.55));
    sb = max(sb, occ(Pb, vec3(pnl.x, Bp.y, Bp.z), X, vec3(0.0, 0.0, 1.0), vec2(pnl.y, pnl.z)));
    cb *= (1.0 - 0.3 * sb) * (1.0 - 0.22 * exp(-max(lb.y, 0.0) / 50.0));
    // 卡紙的邊（一圈很細的暗線）
    cb *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 2.5, -sdBox(lb - vec2(CW, CD) * 0.5, vec2(CW, CD) * 0.5)));
    col = over(col, cb, aB);

    // ---- 背頁、照片片、頂條
    float dnb = dot(rd, nb);
    float tK = -dot(ro, nb) / dnb;
    vec3 Pk = ro + rd * tK;
    vec2 lk = vec2(Pk.x - cx0, dot(Pk, b));
    float aK = aaFill(sdBox(lk - vec2(CW, CD) * 0.5, vec2(CW, CD) * 0.5)) * step(0.0, tK);
    bool innerSide = dot(ro, nb) < 0.0;
    vec3 ck;
    if (innerSide) {
      ck = p6Paper(lk * 1.4 + 300.0, inner) * lam(-nb);
      float sk = max(occ(Pk, pOrg, X, b, vec2(pnl.y, pnl.w)), occ(Pk, vec3(pnl.x, Bp.y, Bp.z), X, vec3(0.0, 0.0, 1.0), vec2(pnl.y, pnl.z)));
      ck *= (1.0 - 0.3 * sk) * (1.0 - 0.22 * exp(-max(lk.y, 0.0) / 50.0));
      // 字：寫在背頁上（字層的 y 向下 = 離摺線越來越近）
      vec4 tx = p6Layer(tl, vec2(Pk.x - txt.x, txt.y - lk.y), txt.zw) * textK;
      ck = ck * (1.0 - tx.a) + tx.rgb;
    } else {
      // 封面：主題色的卡紙，壓了一圈細框
      vec3 cov = mix(C_PAPER, C_SIGNAL, 0.38) * 0.86;
      ck = p6Paper(lk * 1.2, cov) * lam(nb);
      float fr = abs(sdBox(lk - vec2(CW, CD) * 0.5, vec2(CW, CD) * 0.5 - 46.0));
      ck *= 1.0 - 0.1 * (1.0 - smoothstep(0.6, 2.2, fr)) + 0.05 * (1.0 - smoothstep(2.2, 4.0, abs(fr - 3.0)));
    }
    ck *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 2.5, -sdBox(lk - vec2(CW, CD) * 0.5, vec2(CW, CD) * 0.5)));

    float tP = dot(A - ro, nb) / dnb;
    vec3 Pp = ro + rd * tP;
    vec2 lp = vec2(Pp.x - pnl.x, dot(Pp - A, b));
    vec2 ps = vec2(pnl.y, pnl.w);
    float aP = aaFill(sdBox(lp - ps * 0.5, ps * 0.5)) * step(0.0, tP);
    vec3 cp = C_BONE * 0.93 * lam(-nb);
    vec2 inS = ps - 2.0 * bw;
    float di = sdBox(lp - ps * 0.5, inS * 0.5);
    vec2 uv = vec2((lp.x - bw) / inS.x, 1.0 - (lp.y - bw) / inS.y);
    vec3 ph = p6Photo(photo, uv, lod) * (0.88 + 0.12 * lam(-nb));
    ph += C_BONE * 0.02 * smoothstep(0.3, 0.0, abs(uv.x - uv.y * 0.6 - 0.25));
    cp = mix(cp, ph, aaFill(di));
    // 照片片的下緣貼著底頁（很細的接觸影）
    cp *= 1.0 - 0.15 * exp(-max(lp.y, 0.0) / 6.0);

    float tS = (Bp.y - ro.y) / rd.y;
    vec3 Ps = ro + rd * tS;
    vec2 ls = vec2(Ps.x - pnl.x, Ps.z - Bp.z);
    vec2 ss = vec2(pnl.y, pnl.z);
    float aS = aaFill(sdBox(ls - ss * 0.5, ss * 0.5)) * step(0.0, tS) * step(0.05, th);
    vec3 cS = p6Paper(ls * 1.4 + 700.0, inner) * lam(vec3(0.0, 1.0, 0.0)) * 0.97;

    if (innerSide) {
      col = over(col, ck, aK);
      col = over(col, cS, aS);
      col = over(col, cp, aP);
    } else {
      col = over(col, cp, aP);
      col = over(col, cS, aS);
      col = over(col, ck, aK);
    }
    fragColor = vec4(col.rgb * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, tl: { value: null },
  camPos: { value: new THREE.Vector3() }, camR: { value: new THREE.Vector3(1, 0, 0) }, camU: { value: new THREE.Vector3(0, 1, 0) }, camF: { value: new THREE.Vector3(0, 0, -1) }, foc: { value: 1800 },
  th: { value: 0 }, card: { value: new THREE.Vector3(0, 1, 1) }, pnl: { value: new THREE.Vector4() }, bw: { value: 14 }, lod: { value: 0 },
  txt: { value: new THREE.Vector4(0, 0, 1, 1) }, textK: { value: 0 }, k: { value: 1 },
});

/** 照片片離摺線的距離（越遠越立體，但卡片要更深）。 */
const STAND = 120;
const DEG = Math.PI / 180;
/** 相片上的畫面往焦點推到幾倍（實體相片：小推）。 */
const PUSH = 1.1;

export default class Popup extends Scene {
  bg = shared('popup.bg', BG);
  cap: Caption | null = null;
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  /** 卡片（世界座標的 px）：左緣、寬、深；照片片：左緣、寬、高、白邊。 */
  cx0 = 0; CW = 1000; CD = 700; px0 = 0; PW = 400; PH = 500; bw = 14;
  /** 字在背頁上的左緣、上緣（離摺線）。 */
  tx = 0; ty = 0;
  /** 畫面上一單位多大（決定鏡頭距離）。 */
  kpx = 1;
  tOpen = 0; kp = 1;
  dir = 1;
  /** 焦點在相片片上的位置（世界座標，卡片打開、相片推到底時）與鏡頭往那裡移的幅度（字不能被推出安全區）。 */
  foc = new THREE.Vector3();
  amp = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { start, end, lyrics, audio } = this.ctx;
    const has = photoWords(this.ctx).kind !== 'none' || lyrics.linesIn(start, end).length > 0;
    const { w, h } = img;
    const capW = 560;
    // 照片片的大小（世界座標）；卡片的寬、深跟著照片與字
    const bw = 14;
    const boxW = has ? 760 : 1060, boxH = 640;
    // 很小的照片：畫面上最多 1.5 倍（世界座標換到畫面是乘 kpx，kpx 最大 1.25）
    const s = fitPhoto(w, h, boxW - 2 * bw, boxH - 2 * bw, 1.5 / 1.25);
    this.PW = w * s + 2 * bw; this.PH = h * s + 2 * bw; this.bw = bw;
    this.CD = this.PH + STAND + 60;
    const left = 80, gap = 90, right = 80;
    this.CW = has ? left + this.PW + gap + capW + right : this.PW + 260;
    this.cx0 = -this.CW / 2;
    this.px0 = has ? this.cx0 + left : -this.PW / 2;
    // 畫面上一單位多大：卡片的寬塞進 1560、背頁的高塞進約 860
    this.kpx = Math.min(1560 / this.CW, 860 / this.CD, 1.25);
    if (has) {
      const k = this.kpx;
      // 字的大小以畫面上的 px 算：世界座標的字級要除以 kpx。整塊（主字＋署名＋歌詞）可以用到背頁幾乎整個高度
      const cap = new Caption(capW, this.CD - 120, {
        family: F.hand(400), align: 'left', min: Math.round(40 / k), max: Math.round(50 / k), lineHeight: 1.4, maxLines: 6,
        sigSize: Math.round(28 / k), lyricSize: Math.round(48 / k), lyricSubSize: Math.round(38 / k), gap: Math.round(24 / k),
        labelSize: Math.round(22 / k), ink: rgba('sepia', 0.9),
      });
      this.track(cap);
      cap.setup(this.ctx, ph);
      this.cap = cap;
      this.tx = this.px0 + this.PW + gap;
      // 字塊的中心對齊照片片的中間偏上
      this.ty = clamp(this.PH * 0.62 + STAND * 0.3 + cap.blockH / 2, cap.blockH + 50, this.CD - 50);
    }
    this.kp = pace(this.ctx);
    this.tOpen = Math.min(beatAfter(audio, start + 0.25 * this.kp), start + 0.7 * this.kp);
    this.cap?.writeAt(this.tOpen + 0.75 * this.kp, 2.0);
    this.dir = hash(this.seed, 3) < 0.5 ? 1 : -1;
    // 焦點：卡片打開（照片片幾乎直立）、相片上的畫面推到底時，焦點在世界座標的哪裡
    const ib = this.PW - 2 * bw, ih = this.PH - 2 * bw;
    const [fu, fv] = focusIn(ph, focusCrop(ph, w, h, w / h, 1, { zoom: PUSH, screenW: ib * this.kpx }));
    const lpy = bw + (1 - fv) * ih, th = 97 * DEG;
    this.foc.set(this.px0 + bw + fu * ib, Math.sin(th) * lpy, STAND + Math.cos(th) * lpy);
    // 鏡頭往焦點移到底（窗格最後）時，字的四個角都要在安全區裡；不行就整段少移一點
    const cap = this.cap;
    if (cap) {
      const x0 = this.tx - 10, x1 = this.tx + cap.blockW + 10, y0 = this.ty + 10, y1 = this.ty - cap.blockH - 20;
      const ok = (a: number) => {
        const c = this.camAt(end, a);
        return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].every(([x, y]) => {
          const P = new THREE.Vector3(x!, Math.sin(th) * y!, Math.cos(th) * y!).sub(c.pos);
          const d = P.dot(c.F), sx = W / 2 + (c.foc * P.dot(c.R)) / d, sy = H / 2 - (c.foc * P.dot(c.U)) / d;
          return sx >= 96 && sx <= W - 96 && sy >= 96 && sy <= H - 96 && !(sx > HUD_SAFE.x && sy > HUD_SAFE.y);
        });
      };
      if (!ok(1)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
        this.amp = lo;
      }
    }
  }

  /**
   * t 時的鏡頭：從高處往下看合著的卡片 → 降到斜前方；之後很慢地繞一點，目標往相片上的焦點移、推近一點。
   * amp：往焦點移的幅度（0..1，字不能被推出安全區）。
   */
  private camAt(t: number, amp: number) {
    const kp = this.kp;
    const camK = ease.inOutCubic(prog(t, this.tOpen - 0.15 * kp, this.tOpen + 1.0 * kp));
    const settle = settleK(t - this.tOpen - 0.8 * kp, 6);
    const fk = settle * amp;
    const el = lerp(62, 21, camK) * DEG;
    const az = (lerp(-3, -11, camK) + 5 * settle) * this.dir * DEG;
    const foc = 2600;
    const dist = (foc / this.kpx) * lerp(1.12, 1.0, camK) * (1 - 0.07 * fk);
    const tgt = new THREE.Vector3(this.cx0 + this.CW / 2, lerp(0, this.CD * 0.44, camK), lerp(this.CD * 0.5, this.CD * 0.2, camK));
    tgt.lerp(this.foc, 0.32 * fk);
    const pos = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(tgt);
    const F3 = tgt.clone().sub(pos).normalize();
    const R3 = F3.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const U3 = R3.clone().cross(F3);
    return { pos, R: R3, U: U3, F: F3, foc };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, kp = this.kp;
    const u = this.bg.u;
    // 相片上的畫面：卡片打開就往焦點小推（推到 1.1 倍）
    const ib = this.PW - 2 * this.bw;
    const crop = p6Crop(this.ctx, this.img!, t, { zoom: PUSH, screenW: ib * this.kpx, t0: this.tOpen });
    setP6Photo(u, this.ctx.params.photo, crop);
    // 打開：8° → 98°，彈一下（稍微過頭再回來）
    const op = prog(t, this.tOpen, this.tOpen + 0.85 * kp);
    const th = lerp(7, 97, ease.outBack(op, 1.3)) * DEG;
    const cam = this.camAt(t, this.amp);
    (u.camPos!.value as THREE.Vector3).copy(cam.pos);
    (u.camR!.value as THREE.Vector3).copy(cam.R);
    (u.camU!.value as THREE.Vector3).copy(cam.U);
    (u.camF!.value as THREE.Vector3).copy(cam.F);
    u.foc!.value = cam.foc;
    u.th!.value = th;
    (u.card!.value as THREE.Vector3).set(this.cx0, this.CW, this.CD);
    (u.pnl!.value as THREE.Vector4).set(this.px0, this.PW, STAND, this.PH);
    u.bw!.value = this.bw;
    u.photo!.value = this.tex;
    u.lod!.value = photoLod(this.img!.w * (crop[2] - crop[0]), ib * this.kpx);
    const cap = this.cap;
    if (cap) {
      cap.draw(t);
      u.tl!.value = cap.L.texture;
      (u.txt!.value as THREE.Vector4).set(this.tx - cap.pad, this.ty + cap.pad, cap.L.w, cap.L.h);
      u.textK!.value = cap.hasMain ? 1 : prog(t, this.tOpen + 0.6 * kp, this.tOpen + 1.0 * kp);
    } else { u.tl!.value = this.tex; u.textK!.value = 0; }
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.06 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { ...P6_POST, vignette: 0.3 };
  }
}
