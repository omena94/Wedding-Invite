// 照片版面「立體框」（暗）：深木頭的盒子框掛在暗暗的牆上，從斜一點的角度看得出盒子的深度——
//  - 真的照 3D 算（光線打進盒子）：前面的木框、外側的盒邊、裡面四面亞麻內壁與背板；一盞從上面打下來的暖光，
//    上緣的木框在背板上落下一道影子（離前面越遠越糊），內壁的角落比較暗。前面有一層玻璃的淡淡反光。
//  - 盒子裡：照片（白邊相片，稍微墊高、有影子）、一束乾燥花用緞帶綁著；有字時多一張牛皮紙吊牌，用細線綁在緞帶上，
//    主字（賓客留言＋署名，或新人的註解）手寫在吊牌上、歌詞小一號寫在下面跟唱（跟著盒子的透視；沒有主字就把歌詞寫在吊牌上），
//    吊牌照字的多少變大。兩樣都沒有就只有照片和花。
//  - 相片上的畫面往新人點的焦點（臉）慢慢推近，鏡頭也往臉那邊靠一點（吊牌上的字一直在畫面的安全區裡）。
//  - 進場：盒子從暗處被光照亮，鏡頭從比較側的角度繞過來（裡面的東西跟木框有視差）。之後很慢地繼續繞、推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, keepIn, v2, v4, type P2Photo } from './_p2';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';
import { drawBouquet } from './shadowbox-props';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'frame', energy: [0, 0.7], bars: [2, 8], weight: 1, prefers: ['small', 'square'] };

/** 焦距（px）、盒子內部深度、盒子外側到牆的深度、木框寬。 */
const FOC = 1700, DEPTH = 110, DOUT = 132, FW = 54;

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform vec3 cam; uniform vec2 bc; uniform vec2 IH; uniform float yaw;
  uniform vec3 Lv; uniform float lightK;
  uniform sampler2D photo; uniform vec2 pc; uniform vec2 phh; uniform float pb; uniform vec4 crop;
  uniform sampler2D props; uniform vec2 propsSize;
  uniform sampler2D cap; uniform vec2 capSize; uniform vec2 tc; uniform vec2 th; uniform float tang; uniform float tagOn;
  uniform float lod; uniform float t; uniform float k;
  const float FOC = ${FOC}.0, D = ${DEPTH}.0, DOUT = ${DOUT}.0, FW = ${FW}.0;

  vec3 linen(vec2 q) {
    float w = 0.93 + 0.04 * sin(q.x * 1.9) * sin(q.y * 1.9) + 0.03 * snoise(q / vec2(40.0, 3.0));
    return mix(C_BONE, C_FUR, 0.3) * 0.34 * w;
  }
  vec3 walnut() { return mix(C_FUR, C_INK, 0.83); }
  // 燈在盒子裡的光圈：上面中間最亮，往下、往兩邊暗
  float spotIn(vec2 b) { vec2 q = (b - vec2(0.0, -IH.y * 0.3)) / (IH * vec2(1.05, 1.35)); return 0.14 + 0.86 * exp(-1.4 * dot(q, q)); }
  // 盒子裡的一點：往光走到前面（z = 0），從開口出去才照得到；離前面越遠影子越糊
  float cavityLight(vec3 P, vec3 L) {
    float s = -P.z / L.z;
    vec2 Q = P.xy + L.xy * s;
    float pen = 2.0 + 0.2 * s;
    return 1.0 - smoothstep(-pen, pen, sdBox(Q, IH));
  }
  vec3 rotIn(vec3 v, float c, float s) { return vec3(c * v.x - s * v.z, v.y, s * v.x + c * v.z); }
  float safe(float x) { return abs(x) < 1e-5 ? 1e-5 : x; }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    vec2 s2 = p - bc;
    float c = cos(yaw), sn = sin(yaw);
    vec3 ro = rotIn(vec3(0.0, 0.0, -FOC), c, sn);
    vec3 rd = rotIn(normalize(vec3(s2, FOC)), c, sn);
    rd = vec3(safe(rd.x), safe(rd.y), safe(rd.z));
    vec3 L = rotIn(Lv, c, sn);
    vec3 V = -rd;
    vec2 OH = IH + vec2(FW);
    // 前面（z = 0）那一面上的點：拿來分「盒子外面／木框／開口裡」並做邊緣抗鋸齒
    vec3 Pf = ro + rd * (-ro.z / rd.z);
    float dOut = sdBox(Pf.xy, OH), dOpen = sdBox(Pf.xy, IH);
    // 光：一盞從上面打下來的暖燈，光圈在盒子附近
    vec3 warm = mix(C_BONE, C_FUR, 0.28);
    vec3 col = vec3(0.0);
    // ---- 盒子外面：盒子的外側面，或後面的牆（有盒子的影子）
    if (dOut > -1.0) {
      vec3 oc;
      vec3 bmin = vec3(-OH, 0.0), bmax = vec3(OH, DOUT);
      vec3 t1 = (bmin - ro) / rd, t2 = (bmax - ro) / rd;
      vec3 tmn = min(t1, t2), tmx = max(t1, t2);
      float tn = max(max(tmn.x, tmn.y), tmn.z), tf = min(min(tmx.x, tmx.y), tmx.z);
      if (tn < tf && tf > 0.0 && tn != tmn.z) {
        vec3 P = ro + rd * tn;
        vec3 n = tn == tmn.x ? vec3(sign(P.x), 0.0, 0.0) : vec3(0.0, sign(P.y), 0.0);
        vec2 gp = tn == tmn.x ? vec2(P.z * 3.0, P.y) : vec2(P.z * 3.0, P.x);
        float pool = exp(-dot(P.xy / (OH * 1.5), P.xy / (OH * 1.5)));
        oc = woodGrain(gp.yx, walnut()) * (0.05 + 0.75 * max(dot(n, L), 0.0) * pool) * lightK;
        oc *= 0.75 + 0.25 * smoothstep(0.0, 18.0, DOUT - P.z);
      } else {
        float tw = (DOUT - ro.z) / rd.z;
        vec3 P = ro + rd * tw;
        float n = fbm(P.xy / 300.0, 3);
        vec3 plaster = mix(C_INK2, C_GRAPHITE, 0.16) * (0.85 + 0.25 * n);
        vec2 lq = (P.xy - vec2(0.0, -OH.y * 0.45)) / (OH * vec2(1.25, 1.45));
        float pool = exp(-pow(dot(lq, lq), 1.3));
        // 盒子在牆上的影子：從牆往光走到盒子前面，路上穿過盒子就是影子
        float sm = DOUT / -L.z;
        float sh = 0.0;
        for (int i = 0; i < 3; i++) {
          float f = 0.2 + 0.3 * float(i);
          vec2 Q = P.xy + L.xy * sm * f;
          float pen = 3.0 + 0.12 * sm * f;
          sh = max(sh, 1.0 - smoothstep(-pen, pen, sdBox(Q, OH)));
        }
        oc = plaster * (0.16 + 1.1 * pool * (1.0 - 0.85 * sh)) * lightK;
        oc += warm * 0.04 * pool * (1.0 - sh) * lightK;
      }
      col = oc;
    }
    // ---- 木框（前面那一面）：深胡桃木，45 度接角，外緣圓角、內緣斜面，漆面有一點光澤
    if (dOpen > -1.0 && dOut < 1.0) {
      vec2 q = Pf.xy;
      vec2 e = OH - abs(q);
      bool vert = e.x < e.y;
      float dd = min(e.x, e.y);
      vec2 gp = vert ? vec2(q.y, q.x + 400.0) : q;
      vec3 wood = woodGrain(gp * vec2(1.0, 1.4), walnut());
      wood *= 0.9 + 0.2 * smoothstep(-0.3, 0.6, snoise(vec2(gp.x / 160.0, gp.y / 9.0)));
      vec2 nOut = vert ? vec2(sign(q.x), 0.0) : vec2(0.0, sign(q.y));
      float edgeO = 1.0 - smoothstep(0.0, 7.0, dd), edgeI = smoothstep(FW - 9.0, FW - 1.0, dd);
      vec3 n = normalize(vec3(nOut * (0.8 * edgeO - 0.8 * edgeI), -1.0));
      float pool = exp(-dot(q / (OH * 1.4), q / (OH * 1.4)));
      float dif = max(dot(n, L), 0.0);
      float spec = pow(max(dot(n, normalize(L + V)), 0.0), 36.0);
      vec3 fr = wood * (0.06 + 0.85 * dif * pool) + warm * 0.3 * spec * pool;
      fr *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 1.3, abs(e.x - e.y))) * step(dd, FW);
      col = mix(col, fr * lightK, 1.0 - smoothstep(-0.8, 0.8, dOut));
    }
    // ---- 盒子裡：從開口看進去，打到背板或四面內壁
    if (dOpen < 1.0) {
      vec3 imin = vec3(-IH, 0.0), imax = vec3(IH, D);
      vec3 t1 = (imin - ro) / rd, t2 = (imax - ro) / rd;
      vec3 tmx = max(t1, t2);
      float te = min(min(tmx.x, tmx.y), tmx.z);
      vec3 P = ro + rd * te;
      vec3 ic;
      if (te == tmx.z) {
        // 背板
        vec2 b = P.xy;
        float lit = cavityLight(P, L);
        float dif = -L.z;
        float amb = 0.1;
        float ao = 1.0 - 0.38 * exp(sdBox(b, IH) / 34.0);
        float sI = spotIn(b);
        lit *= sI;
        float light = (amb + 1.15 * lit * dif) * ao;
        ic = linen(b) * light;
        vec2 shOff = -L.xy / -L.z;
        vec2 qb = b + propsSize * 0.5;
        // 小東西落在背板上的影子（花墊得比較高、照片墊一點、吊牌貼著）
        float pa = layerAt(props, qb - shOff * 16.0, propsSize).a;
        ic *= 1.0 - 0.5 * pa * (0.3 + 0.7 * lit);
        vec2 pq = b - pc;
        float dps = sdBox(pq - shOff * 9.0, phh + vec2(pb));
        ic *= 1.0 - 0.55 * softShadow(dps, 9.0) * (0.35 + 0.65 * lit);
        vec2 tq = rot2(tang) * (b - tc);
        if (tagOn > 0.5) {
          float dts = sdBox(rot2(tang) * (b - tc - shOff * 4.0), th);
          ic *= 1.0 - 0.45 * softShadow(dts, 5.0) * (0.35 + 0.65 * lit);
        }
        // 照片：白邊相片；照片本身不要被影子壓太暗
        float dp = sdBox(pq, phh + vec2(pb));
        if (dp < 1.0) {
          vec3 pr = C_BONE * 0.62 * (0.3 + 0.75 * lit);
          float di = sdBox(pq, phh);
          if (di < 1.0) {
            // 相片上的畫面是照片的 crop 那一塊（往焦點推）
            vec2 uv = mix(crop.xy, crop.zw, (pq + phh) / (2.0 * phh));
            vec3 ph = photoLin(photo, uv, lod) * mix(0.68, 1.0, lit) * (0.55 + 0.45 * lightK);
            pr = mix(pr, ph, 1.0 - smoothstep(-0.7, 0.7, di));
          }
          ic = mix(ic, pr, 1.0 - smoothstep(-0.7, 0.7, dp));
        }
        // 牛皮紙吊牌：左端剪掉兩個角、一個有補強圈的孔；字是同一張圖層
        if (tagOn > 0.5) {
          float dt = sdBox(tq, th);
          float cut = 30.0;
          dt = max(dt, (cut - ((tq.x + th.x) + (th.y - abs(tq.y)))) * 0.7071);
          if (dt < 1.0) {
            float fib = 0.95 + 0.05 * snoise(tq / vec2(30.0, 2.0)) + 0.03 * snoise(tq / 7.0);
            vec3 kraft = mix(C_FUR, C_BONE, 0.48) * 0.6 * fib * (0.3 + 0.8 * lit);
            vec2 hq = tq - vec2(-th.x + 30.0, 0.0);
            float hr = length(hq);
            kraft = mix(kraft, kraft * 1.18, 1.0 - smoothstep(10.0, 11.5, hr));
            kraft = mix(kraft, ic * 0.6, 1.0 - smoothstep(4.5, 5.6, hr));
            vec4 tx = layerAt(cap, tq + th, capSize);
            kraft = kraft * (1.0 - tx.a) + tx.rgb * (0.45 + 0.6 * lit);
            ic = mix(ic, kraft, 1.0 - smoothstep(-0.7, 0.7, dt));
          }
        }
        // 乾燥花、緞帶、細線（最上面）
        vec4 pr = layerAt(props, qb, propsSize);
        ic = ic * (1.0 - pr.a) + pr.rgb * (amb * 0.8 + 1.0 * lit * dif) * 0.95;
      } else {
        // 內壁：亞麻；朝光的那面亮、朝下的上壁暗；靠背板的角落暗
        vec3 n = te == tmx.x ? vec3(-sign(P.x), 0.0, 0.0) : vec3(0.0, -sign(P.y), 0.0);
        float lit = cavityLight(P, L);
        float dif = max(dot(n, L), 0.0);
        float ao = 1.0 - 0.4 * exp(-(D - P.z) / 26.0);
        vec2 wq = te == tmx.x ? vec2(P.z, P.y) : vec2(P.x, P.z);
        ic = linen(wq) * (0.08 + 1.0 * lit * dif * spotIn(P.xy)) * ao;
      }
      ic *= lightK;
      // 玻璃：裡面稍微暗一點，一道很淡的斜反光（跟著角度移）、上面燈的倒影
      vec2 g = Pf.xy;
      float band = exp(-pow((g.x * 0.62 + g.y - 260.0 * yaw * 4.0 + 120.0) / 150.0, 2.0));
      ic = ic * 0.94 + C_BONE * (0.03 * band + 0.012) * lightK;
      col = mix(col, ic, 1.0 - smoothstep(-0.8, 0.8, dOpen));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, bc: { value: new THREE.Vector2() }, IH: { value: new THREE.Vector2(300, 200) }, yaw: { value: 0 },
  Lv: { value: new THREE.Vector3(0, -1, -1).normalize() }, lightK: { value: 1 },
  photo: { value: null }, pc: { value: new THREE.Vector2() }, phh: { value: new THREE.Vector2() }, pb: { value: 12 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  props: { value: null }, propsSize: { value: new THREE.Vector2(1, 1) },
  cap: { value: null }, capSize: { value: new THREE.Vector2(1, 1) }, tc: { value: new THREE.Vector2() }, th: { value: new THREE.Vector2() }, tang: { value: 0 }, tagOn: { value: 0 },
  lod: { value: 0 }, t: { value: 0 }, k: { value: 1 },
});

/** 吊牌上字的留白（左邊多留給孔）。 */
const TPADL = 66, TPADR = 34, TPADY = 30;
/** 背板四邊的留白、照片跟吊牌之間。 */
const PAD = 64, GAP = 84;

export default class ShadowBox extends Scene {
  bg = shared('shadowbox.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  ph: P2Photo | null = null;
  cap: Caption | null = null;
  tag: Layer2D | null = null;
  props: Layer2D | null = null;
  /** 背板（盒子內部）的半寬高；照片在背板上的中心、半寬高、白邊；吊牌中心、半寬高、角度。都是背板座標（原點在中心）。 */
  ihx = 300; ihy = 200;
  pcx = 0; pcy = 0; phw = 0; phh = 0; pb = 12;
  tcx = 0; tcy = 0; thw = 0; thh = 0; tang = 0;
  /** 盒子（前面）中心在畫面上的位置。 */
  bx = W / 2 - 20; by = H / 2 - 16;

  override async init() {
    const ctx = this.ctx;
    await loadText(`${ctx.params.photo?.caption ?? ''}${ctx.params.photo?.album ?? ''}`);
    await loadWords(ctx);
    [this.ph] = await loadPhotos(ctx, (x) => this.track(x), 1);
    const ph = this.ph!;
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    // 背板在盒子深處，畫面上看起來小約 6%：字排大一點，畫面上仍 ≥ 40 px。
    // 吊牌不要太寬（照片會被擠小）：寬 560、最多五行，60 字的長留言在 43 px 排得下
    this.cap = new Caption(ctx, meas.ctx, {
      family: F.hand(400), w: 560, h: 430, min: 43, max: 52, lineHeight: 1.4, maxLines: 5,
      ink: rgba('sepia', 0.94), unsung: rgba('sepia', 0.42), active: mixRgba('signal', 'sepia', 0.5), sigInk: rgba('sepia', 0.72), sigSize: 29,
      lyricSize: 48, lyricSubSize: 40,
      label: { family: F.hand(700), size: 24, color: rgba('sepia', 0.65), tracking: 4, gap: 18 },
    });
    const cap = this.cap;
    const hasTag = cap.on;
    const tw = hasTag ? Math.max(260, cap.width + TPADL + TPADR) : 0, tH = hasTag ? cap.height + 2 * TPADY + 6 : 0;
    // 背板最大約 1500×800（加上木框 1610×910，畫面放得下）
    const maxPW = 1500, maxPH = 800;
    const flowersW = hasTag ? 0 : 300;
    const room = maxPW - 2 * PAD - (hasTag ? GAP + tw : flowersW);
    const f = fitIn(ph.w, ph.h, room - 30, maxPH - 2 * PAD - 30);
    this.pb = clamp(0.03 * Math.min(f.w, f.h), 9, 16);
    const pow = f.w + 2 * this.pb, poh = f.h + 2 * this.pb;
    const PW = 2 * PAD + pow + (hasTag ? GAP + tw : flowersW);
    // 吊牌下面留給花束；字多、吊牌很高時花束的位置縮小（背板最高 800）
    const PH = Math.min(maxPH, Math.max(poh + 2 * PAD, hasTag ? tH + 2 * PAD + 300 : 0, 440));
    this.ihx = PW / 2; this.ihy = PH / 2;
    this.phw = f.w / 2; this.phh = f.h / 2;
    this.pcx = -PW / 2 + PAD + pow / 2; this.pcy = -12;
    let bq: { x: number; y: number; dir: number; len: number; tie: { x: number; y: number } | null };
    const r = mulberry(this.seed);
    if (hasTag) {
      this.thw = tw / 2; this.thh = tH / 2;
      this.tcx = PW / 2 - PAD - tw / 2; this.tcy = -PH / 2 + PAD + tH / 2;
      this.tang = (r() - 0.5) * 0.05;
      // 花束在吊牌下面，花朝左上（碰到照片的右下角）；細線從緞帶結綁到吊牌的孔
      const holeX = this.tcx - this.thw + 30, holeY = this.tcy;
      // 綁花的地方在吊牌右下方，花朝左下（伸向照片），不會蓋到吊牌上的字
      // 下面的空不夠時綁得高一點、花短一點，花頭不會跑出背板
      const below = PH / 2 - (this.tcy + this.thh);
      const len = clamp(below + 60, 200, 300);
      const bx = Math.min(this.tcx + this.thw * 0.55, PW / 2 - 110), by = Math.min(this.tcy + this.thh + 190, PH / 2 - 40 - 0.45 * len);
      bq = { x: bx + PW / 2, y: by + PH / 2, dir: Math.PI * 0.86, len, tie: { x: holeX + PW / 2, y: holeY + PH / 2 } };
    } else {
      bq = { x: PW - PAD - 70, y: PH / 2 + 150, dir: Math.PI * 1.18, len: 260, tie: null };
    }
    this.props = this.track(new Layer2D(PW, PH, undefined, { fast: true }));
    drawBouquet(this.props.ctx, bq, this.seed);
    this.props.upload();
    if (hasTag) {
      this.tag = this.track(new Layer2D(tw, tH, undefined, { fast: true }));
      cap.writeFrom(ctx.start + 0.9, 2);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const ph = this.ph!;
    const u = this.bg.u;
    const z = settle(lt);
    // 鏡頭從比較側的角度繞過來（照片那一邊比較近），之後很慢地繼續繞、推近
    const yaw = -(0.12 + 0.22 * Math.exp(-lt / 1.5) - 0.035 * settle(lt, 10));
    u.yaw!.value = yaw;
    // 相片上的畫面往焦點推一點（盒子裡的相片：1.15 倍；很小的照片少推）
    const kf = settleK(lt);
    const crop = focusCrop(ph.ref, ph.w, ph.h, ph.w / ph.h, kf, { zoom: 1.15, screenW: 2 * this.phw * 0.98 });
    v4(u.crop!, crop[0], crop[1], crop[2], crop[3]);
    // 鏡頭往相片上的臉靠（沒有吊牌時推得多一點）；吊牌上的字一直在畫面的安全區裡（照 shader 的透視算字在畫面上的位置）
    const [ix, iy] = focusIn(ph.ref, crop);
    const face = project(this.pcx + (2 * ix - 1) * this.phw, this.pcy + (2 * iy - 1) * this.phh, DEPTH, yaw);
    const pull = this.tag ? 0.25 : 0.5;
    const cx0 = W / 2 - 14 * z, cy0 = H / 2 + 10 * (1 - z);
    let cam = {
      x: cx0 + (this.bx + face.x - cx0) * pull * kf,
      y: cy0 + (this.by + face.y - cy0) * pull * kf,
      z: 1 + 0.04 * z + (this.tag ? 0.02 : 0.1) * kf,
    };
    if (this.tag && this.cap) {
      const x0 = this.tcx - this.thw + TPADL, y0 = this.tcy - this.thh + TPADY;
      const a = project(x0, y0, DEPTH, yaw), b = project(x0 + this.cap.width, y0 + this.cap.height + 0.25 * this.cap.size, DEPTH, yaw);
      cam = keepIn(cam, [[this.bx + a.x, this.by + a.y, this.bx + b.x, this.by + b.y]]);
    }
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    v2(u.bc!, this.bx, this.by);
    v2(u.IH!, this.ihx, this.ihy);
    // 燈從上面（稍微偏右、在盒子前面）打下來；進場時從暗處亮起來
    (u.Lv!.value as THREE.Vector3).set(0.22, -1, -0.85).normalize();
    u.lightK!.value = lerp(0.12, 1, ease.outCubic(prog(t, s, s + 0.9))) * (1 - 0.12 * prog(t, e - 0.3, e));
    u.photo!.value = ph.tex;
    v2(u.pc!, this.pcx, this.pcy);
    v2(u.phh!, this.phw, this.phh);
    u.pb!.value = this.pb;
    u.lod!.value = mipLod(ph.w * (crop[2] - crop[0]), 2 * this.phw * cam.z * 0.94);
    u.props!.value = this.props!.texture;
    v2(u.propsSize!, this.props!.w, this.props!.h);
    u.t!.value = t;
    u.k!.value = 1;
    if (this.tag && this.cap) {
      const L = this.tag;
      if (this.cap.draw(L, TPADL, TPADY, t)) L.upload();
      u.cap!.value = L.texture;
      v2(u.capSize!, L.w, L.h);
      v2(u.tc!, this.tcx, this.tcy);
      v2(u.th!, this.thw, this.thh);
      u.tang!.value = this.tang;
      u.tagOn!.value = 1;
    } else {
      // 共用的 pass 可能還指著上一個窗格（已經釋放）的圖層：清掉
      u.cap!.value = null;
      u.tagOn!.value = 0;
    }
    this.bg.render(renderer, out);
    return { bloom: 0.18, bloomThreshold: 1.05, halation: 0.12, vignette: 0.5 };
  }
}

function mulberry(seed: number) { let n = 0; return () => hash(seed, 31 + n++); }

/**
 * 盒子裡的一點（背板座標 x, y、離前面的深度 zd）在畫面上離盒子中心多遠：跟 shader 的光線同一套
 * （鏡頭在 z = −FOC、繞著盒子轉 yaw）。鏡頭要往臉靠、字要留在安全區裡，都照這個算。
 */
function project(x: number, y: number, zd: number, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // shader 用 rotIn 把光線轉 yaw；反過來轉回鏡頭座標，再照焦距投影
  const qx = c * x + s * zd, qz = -s * x + c * zd + FOC;
  return { x: (FOC * qx) / qz, y: (FOC * y) / qz };
}
