// 奉茶（亮）：從上面俯拍的茶席——淺色木桌上一只白瓷杯、一把紫砂壺（線條畫的），右邊一張手抄紙的大杯墊，左下一張茶籤。
//  - 小節線上奉茶：茶壺滑過來、壺身一傾，一道茶倒進杯裡（漣漪從落點一圈圈散開），杯底的乾茶葉被沖得轉起來，
//    轉慢之後一片片沉到杯底，排成一顆愛心；杯墊角落一行冷面的小字「茶葉占卜：大吉」。
//  - 主打留言用毛筆寫在杯墊上：從第一拍起一個字一個字寫出來（筆順方向斜斜掃過、墨還濕的時候邊緣暈一點），署名在最後一行下面。
//  - 歌詞印在茶籤上（逐字跟唱，比留言小一級）。
//  - 沒有留言：杯墊上是正在唱的歌詞（焦點），茶籤上是邀請；純音樂又沒有留言：杯墊上寫邀請。
// 手法：一個全螢幕 shader（_t14 的 PlaneCam：桌面是一張平面，鏡頭有一點俯角、會推會搖；木紋、手抄紙的毛邊、瓷杯、茶湯、
// 漣漪、茶葉〔uniform 陣列〕、熱氣都在這裡算），留言是 _t14 的「依序出現」字模；茶壺與茶籤上的字是兩張 Canvas 圖層（變了才重畫）。
// 鏡頭：切進來貼近杯子，第一拍拉開，之後慢慢推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { fitText } from '../engine/text';
import { heartPoints } from './_motifs';
import { grid, stagger, layoutRows, drawRows, paperInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, orderMask, lineItems, msgBlock, INVITE, type OrderMask, type MsgBlock, type MaskItem } from './_t14';
import { shownLyric, type Rect } from './_t24';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: true, energy: [0.15, 0.7], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 茶席（頁面座標，y 向下）
const CUP = { x: 470, y: 560, r: 205, liq: 176 };
/** 杯墊（手抄紙）：中心、半寬半高、轉角；留言寫在裡面的框。 */
const MAT = { x: 1236, y: 520, hw: 505, hh: 368, rot: 0.018 };
const BOX = { x: 812, y: 214, w: 850, h: 590 };
/** 茶籤：左下角一條長紙，歌詞（或邀請）印在上面。 */
const TAG = { x: 120, y: 866, w: 1060, h: 96, rot: -0.012 };
/** 茶壺：休息的位置、倒茶時落點（杯子裡）。 */
/** 休息時壺嘴朝右（不在杯子上面），倒茶時轉向杯子。 */
const POT0 = { x: 240, y: 175, rot: 0.2 };
const IMPACT = { x: 420, y: 470 };
const NL = 24, MAXC = 80;
const FAM = F.hand(700), FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
const FORTUNE = '＊茶葉占卜：大吉';
const MS = 0.5;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform float t;
  uniform sampler2D mask; uniform vec4 mR; uniform float hasMask; uniform vec2 cI[${MAXC}];
  uniform sampler2D page; uniform sampler2D pot;
  uniform vec4 leaves[${NL}];  // x、y、角度、深度（0 = 浮在上面、1 = 沉在杯底）
  uniform float fill;          // 茶湯的量 0..1
  uniform vec4 pour;           // 落點 x、y、倒下去之後幾秒、正在倒（0..1）
  const vec2 CUPC = vec2(${CUP.x}.0, ${CUP.y}.0);
  vec3 teaCol() { return C_SIGNAL * 0.42 + C_BLOOD * 0.55; }
  // 毛筆字：寫了多少（依序出現的字模）
  vec2 written(vec2 q) {
    vec2 mu = (q - mR.xy) / mR.zw;
    if (hasMask < 0.5 || mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) return vec2(0.0);
    vec4 m = texture(mask, mu);
    if (m.a < 0.01) return vec2(0.0);
    int i = min(int(floor(m.g * 255.0 + 0.5)), ${MAXC - 1});
    vec2 ci = cI[i];
    float k = sat((t - ci.x - m.b * ci.y) / 0.05);
    return vec2(m.a * k, step(0.5, m.r));
  }
  // 手抄紙的毛邊：矩形的距離場加一點雜訊
  float paperSD(vec2 P, vec2 c, vec2 hs, float rot, float seed) {
    vec2 q = rot2(-rot) * (P - c);
    float d = sdBox(q, hs);
    return d + 3.0 * snoise(q / 9.0 + seed) + 1.5 * snoise(q / 2.5 + seed);
  }
  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    // ---- 木桌：淺色，木紋橫向，窗光從左上來
    float g = fbm(vec2(P.x / 1500.0, P.y / 90.0), 3);
    float ring = sin((P.y + 140.0 * g) / 9.0);
    vec3 col = mix(C_PAPER, C_SEPIA, 0.3 + 0.035 * ring * (0.5 + 0.5 * g) + 0.05 * g + 0.012 * snoise(vec2(P.x / 50.0, P.y / 3.0))) + C_BLOOD * 0.02;
    // 木板的接縫
    float seam = 180.0 - abs(mod(P.y + 60.0, 360.0) - 180.0);
    col *= 1.0 - 0.12 * (1.0 - smoothstep(0.5, 2.0, seam));
    float light = 0.9 + 0.12 * exp(-length((P - vec2(300.0, 100.0)) / vec2(1400.0, 1000.0)));
    col *= light;
    // ---- 杯墊（手抄紙）：影子、紙、毛筆字
    float md = paperSD(P, vec2(${MAT.x}.0, ${MAT.y}.0), vec2(${MAT.hw}.0, ${MAT.hh}.0), ${MAT.rot}, 1.0);
    float msh = paperSD(P - vec2(14.0, 18.0), vec2(${MAT.x}.0, ${MAT.y}.0), vec2(${MAT.hw}.0, ${MAT.hh}.0), ${MAT.rot}, 1.0);
    col *= 1.0 - 0.22 * (1.0 - smoothstep(-6.0, 26.0, msh));
    if (md < 0.0) {
      vec3 pc = C_PAPER * (0.98 + 0.03 * snoise(P / 60.0) + 0.02 * snoise(vec2(P.x / 3.0, P.y / 14.0)));
      // 纖維：細細的短線
      pc *= 1.0 - 0.03 * smoothstep(0.55, 0.9, snoise(vec2(P.x / 1.5, P.y / 30.0) + 7.0));
      pc *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 10.0, -md));
      vec2 w = written(P);
      // 墨：濕的時候邊緣暈一點（看旁邊幾點的覆蓋率）
      float halo = 0.25 * (written(P + vec2(2.5, 1.0)).x + written(P - vec2(2.5, 1.0)).x + written(P + vec2(-1.0, 2.5)).x + written(P - vec2(-1.0, 2.5)).x);
      vec3 ink = mix(C_SEPIA * 0.85, C_ROSE * 0.9, w.y);
      pc = mix(pc, mix(pc, ink, 0.25), halo * 0.6);
      pc = mix(pc, ink, w.x);
      vec4 L = fastLayer(texture(page, pageUV(P)));
      pc = pc * (1.0 - L.a) + L.rgb;
      col = mix(col, pc, 1.0 - smoothstep(-1.0, 1.0, md));
    }
    // ---- 茶籤
    float td = paperSD(P, vec2(${TAG.x + TAG.w / 2}.0, ${TAG.y + TAG.h / 2}.0), vec2(${TAG.w / 2}.0, ${TAG.h / 2}.0), ${TAG.rot}, 5.0);
    float tsh = paperSD(P - vec2(8.0, 12.0), vec2(${TAG.x + TAG.w / 2}.0, ${TAG.y + TAG.h / 2}.0), vec2(${TAG.w / 2}.0, ${TAG.h / 2}.0), ${TAG.rot}, 5.0);
    col *= 1.0 - 0.18 * (1.0 - smoothstep(-4.0, 16.0, tsh));
    if (td < 0.0) {
      vec3 tc = mix(C_PAPER, C_BLOOD, 0.08) * (0.97 + 0.03 * snoise(P / 40.0));
      // 左邊一個穿繩的小孔
      float hole = length(P - vec2(${TAG.x + 34}.0, ${TAG.y + TAG.h / 2}.0));
      tc = mix(tc, col * 0.7, 1.0 - smoothstep(8.0, 9.5, hole));
      tc = mix(tc, C_BLOOD * 0.8, (1.0 - smoothstep(0.5, 2.0, abs(hole - 12.0))) * 0.6);
      vec4 L = fastLayer(texture(page, pageUV(P)));
      tc = tc * (1.0 - L.a) + L.rgb;
      col = mix(col, tc, 1.0 - smoothstep(-1.0, 1.0, td));
    }
    // ---- 杯子的影子（往右下）、白瓷杯
    vec2 cq = P - CUPC;
    float cr = length(cq);
    col *= 1.0 - 0.28 * (1.0 - smoothstep(${CUP.r - 20}.0, ${CUP.r + 40}.0, length(cq - vec2(26.0, 32.0))));
    if (cr < ${CUP.r}.0) {
      float u = cr / ${CUP.r}.0;
      // 杯緣（一圈亮的瓷）、內壁（往下漸暗，左上受光）
      vec3 por = mix(C_BONE, C_PAPER, 0.3);
      vec3 c;
      if (cr > ${CUP.liq}.0) {
        float rim = sat((cr - ${CUP.liq}.0) / ${CUP.r - CUP.liq}.0);
        c = por * (0.82 + 0.18 * sin(rim * PI)) * (0.94 + 0.08 * dot(normalize(cq), normalize(vec2(-0.6, -0.8))) * (1.0 - rim));
      } else {
        // 杯底的瓷：中間一圈淡淡的底足
        float uu = cr / ${CUP.liq}.0;
        c = por * (0.86 + 0.08 * uu) * (1.0 - 0.05 * (1.0 - smoothstep(0.0, 3.0, abs(cr - 70.0))));
        // 茶葉（乾的時候淺、泡開之後深，沉得越深被茶湯蓋得越多）
        float leaf = 0.0; float ld = 0.0;
        for (int i = 0; i < ${NL}; i++) {
          vec4 lf = leaves[i];
          vec2 q = rot2(-lf.z) * (P - lf.xy);
          float e = length(q / vec2(24.0, 8.5));
          float cov = 1.0 - smoothstep(0.85, 1.05, e);
          // 葉脈：中間一條
          cov *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 1.2, abs(q.y))) * step(abs(q.x), 18.0);
          if (cov > leaf) { leaf = cov; ld = lf.w; }
        }
        vec3 dry = mix(C_SEPIA, C_BLOOD, 0.35) * 0.9 + C_GRAPHITE * 0.1;
        vec3 wet = mix(C_SEPIA, C_BLOOD, 0.25) * 0.55;
        vec3 lc = mix(dry, wet, fill);
        c = mix(c, lc, leaf);
        // 茶湯：越中間越深；沉下去的葉子被蓋得多一點
        // （茶湯是透過白瓷看的：乘上去，中間厚一點顏色深一點）
        float depth = 0.8 + 0.2 * (1.0 - uu * uu);
        c = mix(c, c * teaCol() * (1.25 - 0.2 * uu) + teaCol() * 0.15, fill * depth * (0.9 + 0.1 * ld * leaf));
        // 漣漪：從落點一圈圈散開，擾動液面的反光
        float pd = length(P - pour.xy);
        float wave = sin(pd * 0.22 - pour.z * 14.0) * exp(-pd / 140.0) * exp(-pour.z * 1.4) * step(0.0, pour.z) * step(pd, pour.z * 260.0 + 20.0);
        // 窗的倒影（液面左上一塊柔柔的亮），被漣漪弄皺
        vec2 wq = (P - CUPC - vec2(-60.0, -70.0) + wave * 6.0) / vec2(70.0, 44.0);
        float refl = exp(-pow(length(wq), 4.0)) * fill;
        c += C_BONE * (0.22 * refl + 0.06 * wave * fill);
        // 倒茶的那一柱：落點一團亮的水花
        c += C_EMBER * 0.25 * pour.w * exp(-pd * pd / 300.0);
      }
      // 杯緣的輪廓線（很細的墨色）
      c *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 2.0, abs(cr - ${CUP.r - 1}.0))) - 0.15 * (1.0 - smoothstep(0.0, 1.5, abs(cr - ${CUP.liq}.0)));
      col = mix(col, c, 1.0 - smoothstep(${CUP.r - 1.5}, ${CUP.r + 0.5}, cr));
      // 熱氣：倒完茶之後杯子上方一縷縷很淡的白
      float st = fill * sat(1.0 - u) * smoothstep(0.1, 0.8, snoise(vec2(P.x / 70.0, P.y / 40.0 + t * 0.5)) * 0.5 + 0.5 * snoise(vec2(P.x / 25.0 - t * 0.2, P.y / 90.0 + t * 0.3)));
      col = mix(col, C_BONE, 0.14 * st);
    }
    // ---- 茶壺（Canvas 圖層：線條＋平塗，影子也畫在裡面）
    // 頁面外面不取樣（貼圖會被夾到邊緣，拖出一條條的顏色）
    float inPage = step(0.0, P.x) * step(P.x, 1920.0) * step(0.0, P.y) * step(P.y, 1080.0);
    vec4 PT = fastLayer(texture(pot, pageUV(P))) * inPage;
    col = col * (1.0 - PT.a) + PT.rgb;
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(), t: { value: 0 },
  mask: { value: null }, mR: { value: new THREE.Vector4(0, 0, 1, 1) }, hasMask: { value: 0 },
  cI: { value: Array.from({ length: MAXC }, () => new THREE.Vector2(1e9, 0.2)) },
  page: { value: null }, pot: { value: null },
  leaves: { value: Array.from({ length: NL }, () => new THREE.Vector4(-999, -999, 0, 0)) },
  fill: { value: 0 }, pour: { value: new THREE.Vector4(0, 0, -1, 0) },
});

/** 茶葉：乾的時候堆在杯底中間，最後排成的愛心上的位置（整晚固定）。 */
const LEAF0 = Array.from({ length: NL }, (_, i) => {
  const a = hash(i, 1) * TAU, r = 20 + 60 * Math.sqrt(hash(i, 2));
  return { x: CUP.x + Math.cos(a) * r, y: CUP.y + Math.sin(a) * r, ang: hash(i, 3) * TAU };
});
const HEART = heartPoints(NL).slice(0, NL).map((p) => ({ x: CUP.x + p.x * 92, y: CUP.y - 8 + p.y * 92 }));

export default class Tea extends Scene {
  bg = shared('tea.bg', BG);
  page = this.track(new Layer2D(W, H, undefined, { fast: true }));
  pot = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  mask: OrderMask | null = null;
  block: MsgBlock | null = null;
  items: MaskItem[] = [];
  times: { s: number; d: number }[] = [];
  tPour = 0; b0 = 0; beat = 0.5;
  pageSig = ''; potSig = '';
  lyrSize = 54;
  hasLyrics = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    this.b0 = gr.b0; this.beat = gr.beat;
    // 奉茶：第一個小節線（太近就下一拍）；短窗格第一拍
    let tp = gr.nBars < 3 ? gr.b0 : gr.bar0;
    if (tp - s < 0.45) tp += gr.beat;
    this.tPour = tp;
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}——一位賓客${INVITE}${FORTUNE}${song.title}FROM THE COUPLE · 新人`);
    const c = this.page.ctx;
    let items: MaskItem[] = [];
    if (m) {
      const b = (this.block = msgBlock(c, m, FAM, BOX, { align: 'left', sigFamily: FAM_SIG, sigMin: 42, sigMax: 58, min: 50, max: 140, lineHeight: 1.3, maxLines: 5 }));
      items = lineItems(b.lines, FAM, b.fit.size);
      items.push(...lineItems([{ text: b.sig.text, x: b.sig.x, y: b.sig.y }], FAM_SIG, b.sig.size, items.length).map((it) => ({ ...it, thick: 0 })));
      this.lyrSize = Math.max(48, Math.min(58, Math.round(b.fit.size * 0.66)));
      this.avoid = [b.box, [TAG.x, TAG.y, TAG.w, TAG.h]];
    } else if (!this.hasLyrics) {
      const ft = fitText(c, INVITE, FAM, BOX.w, BOX.h * 0.7, { min: 60, max: 110, lineHeight: 1.35, maxLines: 3 });
      const top = BOX.y + (BOX.h - ft.height) / 2 + ft.size * 0.9;
      items = lineItems(ft.lines.map((ln, i) => ({ text: ln, x: BOX.x, y: top + i * ft.lineHeight })), FAM, ft.size);
      this.avoid = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    } else this.avoid = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    this.items = items;
    if (items.length) {
      const n = items.length;
      const ts = stagger(au, gr.b0, n, Math.min(gr.bar * 1.75, Math.max(gr.beat * 2, (e - gr.b0) * 0.5)));
      this.times = ts.map((t0, i) => ({ s: t0, d: clamp(((ts[i + 1] ?? t0 + gr.beat) - t0) * 0.9, 0.08, 0.35) }));
      const x0 = Math.min(...items.map((g) => g.x)) - 20, x1 = Math.max(...items.map((g) => g.x + g.w)) + 20;
      const y0 = Math.min(...items.map((g) => g.y - g.size)) - 20, y1 = Math.max(...items.map((g) => g.y + g.size * 0.35)) + 20;
      this.mask = this.track(orderMask(items, [x0, y0, x1 - x0, y1 - y0], MS, 'diag', 3, 0));
    }
  }

  /** 茶壺在 t 時的位置、轉角、傾斜（倒茶時壺身往壺嘴那邊壓扁一點）與正在倒的程度。 */
  private potPose(t: number) {
    const dir = Math.atan2(IMPACT.y - POT0.y, IMPACT.x - POT0.x);
    const pour1 = { x: IMPACT.x - Math.cos(dir) * 235, y: IMPACT.y - Math.sin(dir) * 235 };
    const tp = this.tPour, b = this.beat;
    const come = ease.outCubic(prog(t, tp - 0.4, tp - 0.05));
    const go = ease.inOutCubic(prog(t, tp + b * 1.6, tp + b * 1.6 + 0.6));
    const k = come * (1 - go);
    const tilt = ease.outBack(prog(t, tp - 0.1, tp + 0.12)) * (1 - ease.inOutCubic(prog(t, tp + b * 1.3, tp + b * 1.6)));
    const pouring = t >= tp && t < tp + b * 1.4 ? 1 : 0;
    return { x: lerp(POT0.x, pour1.x, k), y: lerp(POT0.y, pour1.y, k), rot: lerp(POT0.rot, dir, k), tilt, pouring };
  }

  /** 茶葉：乾 → 被沖起來轉（轉速慢慢變慢）→ 沉下去排成愛心。 */
  private leafPose(i: number, t: number, kick: number) {
    const L = LEAF0[i]!, Hh = HEART[i]!;
    const dt = t - this.tPour - 0.05;
    if (dt <= 0) return { x: L.x, y: L.y, a: L.ang, d: 1 };
    const tau = 1.1, w0 = 6.5 * (0.8 + 0.4 * hash(i, 5));
    const th = w0 * tau * (1 - Math.exp(-dt / tau));
    const r0 = Math.hypot(L.x - CUP.x, L.y - CUP.y), a0 = Math.atan2(L.y - CUP.y, L.x - CUP.x);
    const rs = lerp(r0, 70 + 70 * hash(i, 6), ease.outCubic(clamp(dt / 0.5)));
    const sx = CUP.x + Math.cos(a0 + th) * rs, sy = CUP.y + Math.sin(a0 + th) * rs;
    const settle = ease.inOutCubic(clamp((dt - 0.9) / 2.4));
    const j = 3 * kick * (1 - settle);
    return {
      x: lerp(sx, Hh.x, settle) + j * Math.sin(i * 1.7), y: lerp(sy, Hh.y, settle) + j * Math.cos(i * 2.3),
      a: lerp(a0 + th + Math.PI / 2, L.ang, settle), d: lerp(0.25, 1, clamp(dt / 1.2) * 0.4 + settle * 0.6),
    };
  }

  /** 鏡頭：切進來貼近杯子，第一拍拉開，之後慢慢推近（有一點俯角，桌面往遠處縮）。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const open = ease.inOutCubic(prog(t, s, Math.max(s + 0.6, this.b0 + 0.3)));
    const pe = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const F0 = 1600;
    return { tx: lerp(560, 968, open) + 10 * pe, ty: lerp(400, 520, open), dist: F0 * (lerp(0.72, 1.07, open) - 0.04 * pe), pitch: 0.2, yaw: -0.05, level: 1, focal: F0 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    u.t!.value = t;
    u.mask!.value = this.mask?.tex ?? null;
    u.hasMask!.value = this.mask ? 1 : 0;
    if (this.mask) (u.mR!.value as THREE.Vector4).set(...this.mask.rect);
    const arr = u.cI!.value as THREE.Vector2[];
    for (let i = 0; i < MAXC; i++) { const x = this.times[i]; if (x) arr[i]!.set(x.s, x.d); else arr[i]!.set(1e9, 0.2); }
    // 茶湯：倒茶的那一拍半慢慢滿上來
    u.fill!.value = ease.outCubic(prog(t, this.tPour + 0.02, this.tPour + this.beat * 1.5));
    const pp = this.potPose(t);
    (u.pour!.value as THREE.Vector4).set(IMPACT.x, IMPACT.y, t - this.tPour, pp.pouring);
    const lv = u.leaves!.value as THREE.Vector4[];
    for (let i = 0; i < NL; i++) { const l = this.leafPose(i, t, f.a.kick); lv[i]!.set(l.x, l.y, l.a, l.d); }
    this.drawPage(t);
    this.drawPot(pp, t);
    u.page!.value = this.page.texture;
    u.pot!.value = this.pot.texture;
    this.bg.render(renderer, out);
    // 退場：最後一下輕輕推近（硬切在小節線上）
    const exit = prog(t, this.ctx.end - 0.35, this.ctx.end, ease.inCubic);
    return { paper: 1, bloom: 0.25, vignette: 0.4, zoom: 1 + 0.02 * exit, popupAvoid: this.avoid.map((r) => this.cam.screenRect(r, 10)) };
  }

  /** 頁面圖層：茶籤上的字（歌詞或邀請）、沒有留言時杯墊上的歌詞、茶葉占卜的小字。 */
  private drawPage(t: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const ly = shownLyric(lyrics, t, s, e);
    const live = ly && t >= ly.line.start - 0.05 && t <= ly.line.end + 0.05;
    const fortune = t > this.tPour + 3.2;
    // 鏡頭還貼著杯子的時候，茶籤在畫面邊上：字等鏡頭拉開才淡入（不要在畫面邊緣被切一半）
    const open = clamp((t - this.ctx.start) / Math.max(0.3, this.b0 + 0.3 - this.ctx.start));
    const sig = `${open.toFixed(2)}:${ly ? ly.line.start : -1}:${live ? t.toFixed(3) : ly ? (t < ly.line.start ? 'pre' : 'post') : ''}:${ly?.k.toFixed(2)}:${fortune ? clamp((t - this.tPour - 3.2) / 0.5).toFixed(2) : 0}`;
    if (sig === this.pageSig) return;
    this.pageSig = sig;
    const L = this.page, c = L.ctx;
    L.clear();
    c.textBaseline = 'alphabetic';
    const ink = paperInk();
    // 茶籤
    c.save(); c.globalAlpha = open * open; c.translate(TAG.x + TAG.w / 2, TAG.y + TAG.h / 2); c.rotate(TAG.rot); c.translate(-(TAG.x + TAG.w / 2), -(TAG.y + TAG.h / 2));
    if (this.msg) {
      if (ly) {
        const st = { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: TAG.w - 110, maxRows: 1, align: 'left' as const };
        const lay = layoutRows(c, ly.line, st);
        c.save(); c.translate(TAG.x + 72, TAG.y + TAG.h / 2 + lay.size * 0.36);
        drawRows(c, lay, FAM_LYR, t, ink, ly.k);
        c.restore();
      } else {
        c.font = font(F.mono(500), 22); c.letterSpacing = '5px'; c.fillStyle = rgba('sepia', 0.7);
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), TAG.x + 72, TAG.y + TAG.h / 2 + 8);
        c.letterSpacing = '0px';
      }
    } else {
      c.font = font(F.hei(700), 30); c.fillStyle = rgba('sepia', 0.85);
      c.fillText(INVITE, TAG.x + 72, TAG.y + TAG.h / 2 + 11);
    }
    c.restore();
    // 沒有留言：歌詞寫在杯墊上（焦點）
    if (!this.msg && this.hasLyrics && ly) {
      // 焦點：寧可折兩行也要大（一行排得下但字太小就折）
      const st = { family: FAM, size: 132, minSize: 100, maxW: BOX.w, maxRows: 3, align: 'left' as const, lineHeight: 1.25 };
      const lay = layoutRows(c, ly.line, st);
      c.save(); c.translate(BOX.x, BOX.y + (BOX.h - lay.height) / 2 + lay.size * 0.85);
      drawRows(c, lay, FAM, t, ink, ly.k);
      c.restore();
    }
    // 茶葉沉好之後：杯墊左下角一行冷面的小字
    if (fortune) {
      c.globalAlpha = clamp((t - this.tPour - 3.2) / 0.5);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.5);
      c.fillText(FORTUNE, BOX.x, MAT.y + MAT.hh - 30);
      c.globalAlpha = 1;
    }
    L.upload();
  }

  /** 茶壺（從上面看的紫砂壺：壺身、壺蓋、壺鈕、壺嘴、把手；線條＋平塗）、影子、倒出來的那一柱茶。 */
  private drawPot(pp: { x: number; y: number; rot: number; tilt: number; pouring: number }, t: number) {
    const sig = `${pp.x.toFixed(1)}:${pp.y.toFixed(1)}:${pp.tilt.toFixed(3)}:${pp.pouring ? (t * 30 | 0) : 0}`;
    if (sig === this.potSig) return;
    this.potSig = sig;
    const L = this.pot, c = L.ctx;
    L.clear();
    const clay = rgba('blood'), line = rgba('sepia');
    // 影子（右下，壺越低越實）
    c.save(); c.translate(pp.x + 34, pp.y + 44);
    const sg = c.createRadialGradient(0, 0, 60, 0, 0, 230);
    sg.addColorStop(0, rgba('sepia', 0.28)); sg.addColorStop(1, rgba('sepia', 0));
    c.fillStyle = sg; c.beginPath(); c.arc(0, 0, 230, 0, TAU); c.fill();
    c.restore();
    // 倒出來的那一柱：從壺嘴到落點（俯角看得到一小段），琥珀色＋一條亮邊
    if (pp.pouring) {
      const tip = { x: pp.x + Math.cos(pp.rot) * 262, y: pp.y + Math.sin(pp.rot) * 262 };
      c.strokeStyle = rgba('blood', 0.85); c.lineCap = 'round'; c.lineWidth = 11;
      c.beginPath(); c.moveTo(tip.x, tip.y); c.quadraticCurveTo(tip.x + 14, tip.y + 40, IMPACT.x, IMPACT.y); c.stroke();
      c.strokeStyle = rgba('ember', 0.8); c.lineWidth = 3;
      c.beginPath(); c.moveTo(tip.x - 2, tip.y); c.quadraticCurveTo(tip.x + 10, tip.y + 38, IMPACT.x - 2, IMPACT.y); c.stroke();
    }
    c.save(); c.translate(pp.x, pp.y); c.rotate(pp.rot);
    // 倒茶時壺身往前傾：沿壺嘴方向壓扁一點
    c.scale(1 - 0.1 * pp.tilt, 1);
    c.lineWidth = 3; c.strokeStyle = line; c.lineJoin = 'round'; c.lineCap = 'round';
    // 把手（後面）
    c.beginPath(); c.arc(-150, 0, 70, Math.PI * 0.55, Math.PI * 1.45); c.lineWidth = 26; c.strokeStyle = clay; c.stroke();
    c.lineWidth = 3; c.strokeStyle = line;
    c.beginPath(); c.arc(-150, 0, 83, Math.PI * 0.6, Math.PI * 1.4); c.stroke();
    c.beginPath(); c.arc(-150, 0, 57, Math.PI * 0.62, Math.PI * 1.38); c.stroke();
    // 壺嘴（前面，往前變細）
    c.beginPath();
    c.moveTo(140, -30); c.quadraticCurveTo(210, -22, 262, -12); c.lineTo(262, 12); c.quadraticCurveTo(210, 22, 140, 30); c.closePath();
    c.fillStyle = clay; c.fill(); c.stroke();
    c.beginPath(); c.ellipse(262, 0, 5, 12, 0, 0, TAU); c.fillStyle = rgba('ink', 0.8); c.fill();
    // 壺身：受光在左上
    const bg = c.createRadialGradient(-50, -60, 20, 0, 0, 170);
    bg.addColorStop(0, rgba('signal', 0.9)); bg.addColorStop(0.35, clay); bg.addColorStop(1, rgba('sepia'));
    c.fillStyle = bg; c.beginPath(); c.arc(0, 0, 160, 0, TAU); c.fill(); c.stroke();
    // 陰影那一側的排線（版畫感）
    c.save(); c.beginPath(); c.arc(0, 0, 158, 0, TAU); c.clip();
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.4;
    for (let k = 0; k < 9; k++) { const r = 100 + k * 7; c.beginPath(); c.arc(0, 0, r, -0.2, 1.4); c.stroke(); }
    c.restore();
    // 壺蓋、壺鈕
    c.beginPath(); c.arc(0, 0, 96, 0, TAU); c.strokeStyle = line; c.stroke();
    c.beginPath(); c.arc(0, 0, 84, 0, TAU); c.fillStyle = rgba('blood', 0.9); c.fill(); c.stroke();
    const kg = c.createRadialGradient(-8, -8, 2, 0, 0, 24);
    kg.addColorStop(0, rgba('signal')); kg.addColorStop(1, clay);
    c.fillStyle = kg; c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.fill(); c.stroke();
    c.restore();
    L.upload();
  }
}
