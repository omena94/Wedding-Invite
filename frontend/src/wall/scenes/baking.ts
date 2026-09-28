// 烤蛋糕（亮）：兩個鏡頭。
//  1. 烤箱：奶油色琺瑯烤箱的正面特寫，玻璃窗裡上下兩排電熱管燒得通紅，烤盤上的蛋糕一拍一拍慢慢膨起來；
//     上面的計時器照拍子倒數（每一拍跳一格），數到 0 在小節線「叮！」——白光一閃，切到下一個鏡頭。
//  2. 出爐：從上面俯拍桌上一大塊方形的奶油蛋糕（邊緣擠了一圈貝殼花邊、角落放莓果），擠花袋在蛋糕上用巧克力
//     一個字一個字擠出主打留言（巧克力有厚度、有光澤），署名擠在最後一行下面。
//  - 歌詞寫在一張食譜卡上：第一個鏡頭貼在烤箱門的左下角，第二個鏡頭放在蛋糕旁邊（逐字跟唱，比留言小一級）。
//  - 沒有留言：蛋糕上擠的是正在唱的歌詞（唱到哪擠到哪，還沒唱的字是淡淡的鉛筆草稿），食譜卡上是邀請；
//    純音樂又沒有留言：蛋糕上擠邀請。窗格太短（兩小節）就直接從出爐開始。
// 手法：烤箱是一個全螢幕 shader（琺瑯、磁磚、玻璃窗裡的火光與膨起來的蛋糕）＋ Canvas（計時器的數字、食譜卡）；
// 蛋糕是另一個全螢幕 shader（_t14 的 PlaneCam 俯拍）：巧克力是 _t14 的「依序出現」字模，取樣周圍幾點算出厚度與法線，
// 打光出巧克力的光澤；擠花袋與食譜卡是頁面座標的 Canvas 圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp } from '../engine/util';
import { beatAfter } from './_motifs';
import { fitText } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { grid, stagger, layoutRows, drawRows, paperInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, orderMask, lineItems, msgBlock, INVITE, type OrderMask, type MsgBlock, type MaskItem } from './_t14';
import { shownLyric, type Rect, type P2 } from './_t24';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: true, energy: [0.3, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 第一個鏡頭：烤箱（螢幕座標）
const OVEN = { x0: 250, y0: 70, x1: 1670, y1: 1040 };
const WIN = { x0: 420, y0: 360, x1: 1500, y1: 820 };
const TIMER = { x: 1170, y: 118, w: 320, h: 96 };
/** 食譜卡（貼在烤箱門左下角）：中心、半寬半高、轉角。 */
const CARD1 = { x: 610, y: 915, hw: 330, hh: 58, rot: -0.025 };
// ---------------------------------------------------------------- 第二個鏡頭：蛋糕（頁面座標）
const CAKE = { x0: 330, y0: 150, x1: 1590, y1: 800 };
const BOX = { x: 480, y: 236, w: 960, h: 492 };
const CARD2 = { x: 520, y: 912, hw: 390, hh: 56, rot: 0.02 };
const MAXC = 80, MS = 0.5;
const FAM = F.hand(700), FAM_SIG = F.hand(700);
const FAM_LYR = F.archivo(100, 800);

const OVEN_FS = () => new FSPass(/* glsl */ `
  uniform float t; uniform float rise; uniform float fire; uniform float zoom; uniform vec2 zc; uniform float puff;
  float rbox(vec2 p, vec2 a, vec2 b, float r) { vec2 c = (a + b) * 0.5, h = (b - a) * 0.5; return sdBox(p - c, h - r) - r; }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = (sp - zc) / zoom + zc;
    // 牆：白色的地鐵磚（紙色、細細的磚縫）
    vec2 tq = vec2(p.x + (mod(floor(p.y / 70.0), 2.0) * 70.0), p.y);
    float grout = min(abs(mod(tq.x, 140.0) - 70.0) - 68.0, abs(mod(tq.y, 70.0) - 35.0) - 33.0);
    vec3 col = C_PAPER * (0.84 + 0.04 * snoise(p / 300.0)) * (1.0 - 0.18 * (1.0 - smoothstep(-0.5, 1.5, -grout)));
    // 烤箱在牆上投的影子
    float od = rbox(p, vec2(${OVEN.x0}.0, ${OVEN.y0}.0), vec2(${OVEN.x1}.0, ${OVEN.y1}.0), 36.0);
    col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 70.0, rbox(p - vec2(20.0, 28.0), vec2(${OVEN.x0}.0, ${OVEN.y0}.0), vec2(${OVEN.x1}.0, ${OVEN.y1}.0), 36.0)));
    if (od < 0.0) {
      // 琺瑯：奶油色、上亮下暗、邊緣一圈圓角的反光
      vec3 en = mix(C_PAPER, C_BONE, 0.5) * (0.97 - 0.12 * (p.y - ${OVEN.y0}.0) / ${OVEN.y1 - OVEN.y0}.0);
      en *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 26.0, -od));
      en += C_BONE * 0.12 * (1.0 - smoothstep(0.0, 4.0, abs(od + 10.0)));
      // 控制面板（上面一條，顏色深一點）與門的分界
      float panel = step(p.y, 262.0);
      en = mix(en, en * 0.9, panel);
      en *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 2.0, abs(p.y - 262.0)));
      // 兩顆旋鈕
      for (int k = 0; k < 2; k++) {
        vec2 kc = vec2(420.0 + float(k) * 170.0, 166.0);
        float kd = length(p - kc);
        vec3 kn = mix(C_ASH, C_BONE, 0.5) * (0.75 + 0.3 * dot(normalize(p - kc + 1e-3), vec2(-0.6, -0.8)) * smoothstep(0.0, 46.0, kd));
        // 旋鈕上的指針
        vec2 kq = rot2(-0.8 + float(k) * 1.9) * (p - kc);
        kn = mix(kn, C_SEPIA * 0.8, (1.0 - smoothstep(3.0, 4.5, abs(kq.x))) * step(0.0, kq.y) * step(kq.y, 36.0));
        en = mix(en, kn, 1.0 - smoothstep(46.0, 48.0, kd));
        en *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 3.0, abs(kd - 48.0)));
      }
      // 門把：一條金屬橫桿
      float hd = rbox(p, vec2(560.0, 290.0), vec2(1360.0, 318.0), 14.0);
      vec3 hc = mix(C_ASH, C_BONE, 0.4) * (0.7 + 0.5 * (1.0 - sat((p.y - 290.0) / 28.0)));
      en *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 14.0, rbox(p - vec2(0.0, 10.0), vec2(560.0, 290.0), vec2(1360.0, 318.0), 14.0)));
      en = mix(en, hc, 1.0 - smoothstep(-1.0, 1.0, hd));
      // 計時器的黑色面板
      float td = rbox(p, vec2(${TIMER.x}.0, ${TIMER.y}.0), vec2(${TIMER.x + TIMER.w}.0, ${TIMER.y + TIMER.h}.0), 10.0);
      en = mix(en, C_INK2 * 1.2, 1.0 - smoothstep(-1.0, 1.0, td));
      // 玻璃窗：外框一圈黑邊、裡面是烤箱
      float wd = rbox(p, vec2(${WIN.x0}.0, ${WIN.y0}.0), vec2(${WIN.x1}.0, ${WIN.y1}.0), 34.0);
      if (wd < 14.0) en = mix(en, C_INK2, 1.0 - smoothstep(12.0, 14.0, wd));
      if (wd < 0.0) {
        vec2 q = p;
        // 烤箱裡：暗、被電熱管照成暖色（火力跟著大鼓呼吸）
        float yy = (q.y - ${WIN.y0}.0) / ${WIN.y1 - WIN.y0}.0;
        vec3 inside = C_INK * 0.8 + mix(C_BLOOD, C_SIGNAL, 0.4) * (0.18 + 0.14 * fire) * (0.6 + 0.4 * (exp(-yy * 5.0) + exp(-(1.0 - yy) * 6.0)));
        // 後壁的烤箱孔（一排排小點）
        vec2 hq = mod(q - vec2(440.0, 380.0), 36.0) - 18.0;
        inside *= 1.0 - 0.25 * (1.0 - smoothstep(3.0, 4.5, length(hq))) * step(0.1, yy) * step(yy, 0.9);
        // 電熱管：上下各一條鋸齒，燒紅（會發光）
        for (int k = 0; k < 2; k++) {
          float ey = k == 0 ? ${WIN.y0 + 38}.0 : ${WIN.y1 - 30}.0;
          float zz = ey + 14.0 * abs(fract(q.x / 90.0) * 2.0 - 1.0) - 7.0;
          float el = 1.0 - smoothstep(3.0, 6.0, abs(q.y - zz));
          inside = mix(inside, mix(C_BLOOD, C_EMBER, 0.55 + 0.45 * fire) * (1.3 + 1.2 * fire), el * step(${WIN.x0 + 40}.0, q.x) * step(q.x, ${WIN.x1 - 40}.0));
          inside += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.25 * fire * exp(-abs(q.y - ey) / 30.0);
        }
        // 烤架（兩條橫的鐵線）
        inside += C_ASH * 0.18 * (1.0 - smoothstep(1.0, 2.5, abs(q.y - 712.0)));
        // 烤模（圓的，側面看是梯形）與蛋糕：蛋糕從烤模裡膨出一個圓頂，頂上烤得比較金黃
        float cx = 960.0, py = 705.0;
        float mold = step(abs(q.x - cx), 250.0 - (py - q.y) * 0.1) * step(py - 70.0, q.y) * step(q.y, py);
        vec3 mc = mix(C_ASH, C_GRAPHITE, 0.5) * (0.5 + 0.35 * fire) * (0.8 + 0.2 * sin((q.x - cx) / 250.0 * 1.5 + 1.2));
        float domeH = 20.0 + 120.0 * rise + 10.0 * puff;
        float dx = (q.x - cx) / 236.0;
        float domeTop = py - 70.0 - domeH * sqrt(max(0.0, 1.0 - dx * dx));
        float cake = step(abs(dx), 1.0) * step(domeTop, q.y) * step(q.y, py - 66.0);
        float ck = sat((q.y - domeTop) / max(domeH, 1.0));
        vec3 cc = mix(mix(C_SIGNAL, C_BLOOD, 0.35), mix(C_PAPER, C_SIGNAL, 0.35), smoothstep(0.0, 0.5, ck)) * (0.55 + 0.5 * fire) * (0.85 + 0.15 * snoise(q / 14.0));
        inside = mix(inside, cc, cake);
        inside = mix(inside, mc, mold);
        // 玻璃：斜斜的反光、四角暗一點
        float gl = exp(-pow((q.x * 0.6 + q.y - 900.0) / 90.0, 2.0)) + 0.5 * exp(-pow((q.x * 0.6 + q.y - 1130.0) / 40.0, 2.0));
        inside += C_BONE * 0.07 * gl;
        inside *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 40.0, -wd));
        en = mix(en, inside, 1.0 - smoothstep(-1.0, 1.0, wd));
      }
      col = mix(col, en, 1.0 - smoothstep(-1.0, 1.0, od));
    }
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, rise: { value: 0 }, fire: { value: 0 }, zoom: { value: 1 }, zc: { value: new THREE.Vector2(960, 590) }, puff: { value: 0 } });

const CAKE_FS = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform float t;
  uniform sampler2D mask; uniform vec4 mR; uniform float hasMask; uniform vec2 cI[${MAXC}]; uniform float ghost;
  uniform sampler2D page;
  float rbox(vec2 p, vec2 a, vec2 b, float r) { vec2 c = (a + b) * 0.5, h = (b - a) * 0.5; return sdBox(p - c, h - r) - r; }
  // 擠了多少巧克力（x）、是不是愛心（y）、還沒擠的字的草稿（z）
  vec3 piped(vec2 q) {
    vec2 mu = (q - mR.xy) / mR.zw;
    if (hasMask < 0.5 || mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) return vec3(0.0);
    vec4 m = texture(mask, mu);
    if (m.a < 0.01) return vec3(0.0);
    int i = min(int(floor(m.g * 255.0 + 0.5)), ${MAXC - 1});
    vec2 ci = cI[i];
    float k = sat((t - ci.x - m.b * ci.y) / 0.035);
    return vec3(m.a * k, step(0.5, m.r), m.a * (1.0 - k));
  }
  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    // 桌：淺色木頭
    float g = fbm(vec2(P.x / 1400.0, P.y / 80.0), 3);
    vec3 col = mix(C_PAPER, C_SEPIA, 0.28 + 0.03 * sin((P.y + 120.0 * g) / 8.0) + 0.05 * g);
    col *= 0.9 + 0.12 * exp(-length((P - vec2(400.0, 100.0)) / vec2(1500.0, 1100.0)));
    // 蛋糕底板（白色的紙板，比蛋糕大一圈）與影子
    vec2 A = vec2(${CAKE.x0}.0, ${CAKE.y0}.0), B = vec2(${CAKE.x1}.0, ${CAKE.y1}.0);
    float bd = rbox(P, A - 40.0, B + 40.0, 24.0);
    col *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 40.0, rbox(P - vec2(18.0, 24.0), A - 40.0, B + 40.0, 24.0)));
    col = mix(col, mix(C_BONE, C_PAPER, 0.4) * 0.96, 1.0 - smoothstep(-1.0, 1.0, bd));
    // 蛋糕的影子落在底板上
    float cd = rbox(P, A, B, 30.0);
    col *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 26.0, rbox(P - vec2(10.0, 14.0), A, B, 30.0)));
    if (cd < 0.0) {
      // 奶油：抹刀抹過的弧形紋路（很淡），窗光從左上
      float sw = snoise(vec2(P.x / 220.0, P.y / 90.0)) + 0.5 * snoise(P / 60.0);
      vec3 cream = mix(C_BONE, C_PAPER, 0.45) * (0.95 + 0.012 * sw + 0.014 * sin((length(P - vec2(900.0, 1400.0)) + 40.0 * sw) / 22.0));
      // 貝殼花邊：沿著邊緣一圈一顆顆的小丘
      float edge = -cd;
      float along = abs(P.y - ${CAKE.y0}.0) < 70.0 || abs(P.y - ${CAKE.y1}.0) < 70.0 ? P.x : P.y;
      float bump = 0.5 + 0.5 * cos(along / 26.0 * TAU * 0.5);
      float band = smoothstep(4.0, 12.0, edge) * (1.0 - smoothstep(34.0, 46.0, edge));
      float shell = band * (0.55 + 0.45 * bump);
      cream *= 1.0 - 0.1 * band * (1.0 - bump) - 0.08 * (1.0 - smoothstep(0.0, 6.0, edge));
      cream += C_BONE * 0.06 * shell * (1.0 - sat(abs(edge - 20.0) / 14.0));
      // 四個角的莓果（blood 色的小球，有反光）
      for (int k = 0; k < 4; k++) {
        vec2 bc = vec2(k == 0 || k == 2 ? A.x + 76.0 : B.x - 76.0, k < 2 ? A.y + 72.0 : B.y - 72.0);
        for (int j = 0; j < 3; j++) {
          vec2 c = bc + vec2(float(j) * 30.0 - 30.0, float(j - 1) * float(j - 1) * 20.0 - 10.0) * (k == 1 || k == 2 ? -1.0 : 1.0);
          float d = length(P - c);
          float cov = 1.0 - smoothstep(15.0, 17.0, d);
          vec3 bcol = C_BLOOD * (0.6 + 0.4 * sat(1.0 - d / 16.0)) + C_BONE * 0.5 * (1.0 - smoothstep(0.0, 4.0, length(P - c + vec2(5.0, 5.0))));
          cream *= 1.0 - 0.2 * (1.0 - smoothstep(14.0, 24.0, length(P - c - vec2(5.0, 6.0))));
          cream = mix(cream, bcol, cov);
        }
      }
      // 巧克力：用周圍四點的覆蓋率當厚度算法線 → 打光（左上的窗光）＋一點鏡面反光
      vec3 m0 = piped(P);
      float hx = piped(P + vec2(2.0, 0.0)).x - piped(P - vec2(2.0, 0.0)).x;
      float hy = piped(P + vec2(0.0, 2.0)).x - piped(P - vec2(0.0, 2.0)).x;
      vec3 n = normalize(vec3(-hx * 1.4, -hy * 1.4, 1.0));
      vec3 L = normalize(vec3(-0.5, -0.6, 0.65));
      vec3 choc = mix(C_SEPIA * 0.9, C_ROSE * 0.85, m0.y);
      vec3 cc = choc * (0.55 + 0.6 * max(dot(n, L), 0.0)) + C_BONE * 0.45 * pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
      // 巧克力的影子（往右下）
      float shd = piped(P - vec2(4.0, 5.0)).x;
      cream *= 1.0 - 0.18 * shd * (1.0 - m0.x);
      // 還沒擠的字：淡淡的鉛筆草稿（沒有留言、跟唱歌詞時）
      cream = mix(cream, C_SEPIA, 0.12 * ghost * m0.z);
      cream = mix(cream, cc, m0.x);
      col = mix(col, cream, 1.0 - smoothstep(-1.0, 1.0, cd));
    }
    // 頁面圖層（食譜卡、擠花袋）
    float inPage = step(0.0, P.x) * step(P.x, 1920.0) * step(0.0, P.y) * step(P.y, 1080.0);
    vec4 Lp = fastLayer(texture(page, pageUV(P))) * inPage;
    col = col * (1.0 - Lp.a) + Lp.rgb;
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(), t: { value: 0 },
  mask: { value: null }, mR: { value: new THREE.Vector4(0, 0, 1, 1) }, hasMask: { value: 0 }, ghost: { value: 0 },
  cI: { value: Array.from({ length: MAXC }, () => new THREE.Vector2(1e9, 0.2)) },
  page: { value: null },
});

/** 一組要擠的字：字模、每個字的時間。 */
interface PipeSet { mask: OrderMask; items: MaskItem[]; times: { s: number; d: number }[] }

export default class Baking extends Scene {
  oven = shared('baking.oven', OVEN_FS);
  cake = shared('baking.cake', CAKE_FS);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  block: MsgBlock | null = null;
  pipe: PipeSet | null = null;
  linePipes = new Map<Line, PipeSet>();
  tDing = 0; b0 = 0; beat = 0.5; nBeats = 4;
  lyrSize = 52;
  avoid1: Rect[] = []; avoid2: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    this.b0 = gr.b0; this.beat = gr.beat;
    // 叮：第一個小節線（至少一秒後；太近就再下一個小節線）；兩小節的窗格直接出爐
    let td = gr.bar0;
    if (td - s < 1.0) td += gr.bar;
    if (gr.nBars < 3) td = s;
    this.tDing = Math.min(td, s + gr.bar * 1.6);
    this.nBeats = Math.max(1, Math.round(au.beatAt(this.tDing) - au.beatAt(s)));
    const lines = m ? [] : lyrics.linesIn(s - 4, e).filter((l) => l.end > s - 1.5);
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}——一位賓客${INVITE}${lines.map((l) => l.text).join('')}${song.title}叮！0123456789:BAKE·°C食譜FROM THE COUPLE · 新人`);
    const c = this.layer.ctx;
    const t0 = beatAfter(au, this.tDing + 0.05);
    const dur = Math.min(gr.bar * 1.4, Math.max(gr.beat * 2, (e - t0) * 0.45));
    if (m) {
      const b = (this.block = msgBlock(c, m, FAM, BOX, { align: 'center', sigFamily: FAM_SIG, sigMin: 44, sigMax: 58, min: 52, max: 150, lineHeight: 1.28, maxLines: 5 }));
      const items = lineItems(b.lines, FAM, b.fit.size);
      items.push(...lineItems([{ text: b.sig.text, x: b.sig.x, y: b.sig.y }], FAM_SIG, b.sig.size, items.length));
      this.pipe = this.makePipe(items, stagger(au, t0, items.length, dur), b.fit.size);
      this.lyrSize = Math.max(48, Math.min(56, Math.round(b.fit.size * 0.62)));
      this.avoid2 = [b.box];
    } else if (!lines.length) {
      const ft = fitText(c, INVITE, FAM, BOX.w, BOX.h * 0.75, { min: 64, max: 120, lineHeight: 1.3, maxLines: 3 });
      const top = BOX.y + (BOX.h - ft.height) / 2 + ft.size * 0.9;
      c.font = font(FAM, ft.size);
      const items = lineItems(ft.lines.map((ln, i) => ({ text: ln, x: BOX.x + (BOX.w - c.measureText(ln).width) / 2, y: top + i * ft.lineHeight })), FAM, ft.size);
      this.pipe = this.makePipe(items, stagger(au, t0, items.length, dur), ft.size);
      this.avoid2 = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    } else {
      // 沒有留言：每一句歌詞一組字模，每個字在它開始唱的時候擠出來
      for (const l of lines) {
        const ft = fitText(c, l.text, FAM, BOX.w, BOX.h * 0.8, { min: 72, max: 140, lineHeight: 1.26, maxLines: 3 });
        const top = BOX.y + (BOX.h - ft.height) / 2 + ft.size * 0.9;
        c.font = font(FAM, ft.size);
        const rows = ft.lines.map((ln, i) => ({ text: ln, x: BOX.x + (BOX.w - c.measureText(ln).width) / 2, y: top + i * ft.lineHeight }));
        const items = lineItems(rows, FAM, ft.size);
        // 每個字對到歌詞的 Word：照順序在原文裡找
        let cur = 0;
        const times = items.map((it) => {
          const at = l.text.indexOf(it.ch, cur);
          if (at >= 0) cur = at + it.ch.length;
          const w = l.words.find((wd) => at >= wd.o && at < wd.o + wd.w.length) ?? l.words[0]!;
          const k = w.w.length > 1 ? (at - w.o) / w.w.length : 0;
          const span = Math.max(0.08, (w.end - w.start) / Math.max(1, w.w.length));
          return { s: w.start + k * (w.end - w.start), d: Math.min(0.3, span) };
        });
        this.linePipes.set(l, this.makePipeT(items, times, ft.size));
      }
      this.avoid2 = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    }
    this.avoid1 = [[CARD1.x - CARD1.hw, CARD1.y - CARD1.hh, CARD1.hw * 2, CARD1.hh * 2]];
  }

  private makePipe(items: MaskItem[], ts: number[], size: number): PipeSet {
    return this.makePipeT(items, ts.map((t0, i) => ({ s: t0, d: clamp(((ts[i + 1] ?? t0 + this.beat) - t0) * 0.9, 0.08, 0.32) })), size);
  }
  private makePipeT(items: MaskItem[], times: { s: number; d: number }[], size: number): PipeSet {
    const x0 = Math.min(...items.map((g) => g.x)) - 20, x1 = Math.max(...items.map((g) => g.x + g.w)) + 20;
    const y0 = Math.min(...items.map((g) => g.y - g.size)) - 20, y1 = Math.max(...items.map((g) => g.y + g.size * 0.35)) + 20;
    // 擠花：筆畫比字型粗、轉角圓（描一圈邊）
    const mask = this.track(orderMask(items, [x0, y0, x1 - x0, y1 - y0], MS, 'x', 3, clamp(size * 0.016, 0.8, 2)));
    return { mask, items, times };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    if (t < this.tDing) return this.renderOven(f, out);
    return this.renderCake(f, out);
  }

  // ---------------------------------------------------------------- 第一個鏡頭
  private renderOven(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const u = this.oven.u;
    const k = clamp((t - s) / Math.max(0.3, this.tDing - s));
    // 蛋糕照拍子一下一下膨起來；鏡頭慢慢推近玻璃窗
    const bi = au.beatAt(t) - au.beatAt(s);
    u.rise!.value = clamp((Math.floor(bi) + ease.outBack(clamp((bi % 1) / 0.35), 2)) / Math.max(1, this.nBeats));
    u.puff!.value = f.a.kick;
    u.fire!.value = 0.75 + 0.25 * f.a.kick;
    u.zoom!.value = 1 + 0.08 * ease.inOutQuad(k);
    u.t!.value = t;
    this.oven.render(renderer, out);
    // 計時器、食譜卡
    const L = this.layer; L.clear();
    const c = L.ctx;
    const z = u.zoom!.value as number, zc = u.zc!.value as THREE.Vector2;
    c.setTransform(z, 0, 0, z, zc.x * (1 - z), zc.y * (1 - z));
    const left = Math.max(0, Math.ceil(au.beatAt(this.tDing) - au.beatAt(t) - 1e-3));
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(600), 60); c.letterSpacing = '6px';
    const blink = 0.75 + 0.25 * (1 - (au.beatAt(t) % 1));
    c.fillStyle = rgba('signal', blink);
    c.fillText(`0:${String(left).padStart(2, '0')}`, TIMER.x + 58, TIMER.y + 70);
    c.letterSpacing = '0px';
    c.font = font(F.mono(500), 16); c.fillStyle = rgba('sepia', 0.6); c.letterSpacing = '4px';
    c.fillText('BAKE · 180°C', TIMER.x - 190, TIMER.y + 56);
    c.letterSpacing = '0px';
    this.drawCard(c, CARD1, t);
    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, L.upload(), out);
    // 叮之前半拍：光越來越亮
    return { paper: 1, bloom: 0.55, vignette: 0.45, flash: 0.35 * prog(t, this.tDing - 0.12, this.tDing, ease.inQuad), popupAvoid: this.avoid1 };
  }

  // ---------------------------------------------------------------- 第二個鏡頭
  private renderCake(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    // 鏡頭：切過來時貼近、有一點歪，很快落定、拉開；之後慢慢推近
    const land = ease.outExpo(prog(t, this.tDing, this.tDing + 0.8));
    const pe = ease.inOutQuad(clamp((t - this.tDing) / Math.max(1, e - this.tDing)));
    const F0 = 1600;
    this.cam.set({ tx: lerp(1000, 962, land), ty: lerp(480, 525, land), dist: F0 * (lerp(0.8, 1.02, land) - 0.035 * pe), pitch: 0.16, yaw: -0.04, roll: 0.05 * (1 - land), level: 1, focal: F0 });
    const u = this.cake.u;
    this.cam.apply(u);
    u.t!.value = t;
    // 這一格擠的是哪一組字（有留言：留言；沒有留言：正在唱的那一句）
    let pipe = this.pipe;
    let line: Line | null = null;
    if (!pipe && this.linePipes.size) {
      const sl = shownLyric(lyrics, t, s, e);
      line = sl?.line ?? null;
      pipe = line ? this.linePipes.get(line) ?? null : null;
    }
    u.mask!.value = pipe?.mask.tex ?? null;
    u.hasMask!.value = pipe ? 1 : 0;
    u.ghost!.value = line ? 1 : 0;
    if (pipe) (u.mR!.value as THREE.Vector4).set(...pipe.mask.rect);
    const arr = u.cI!.value as THREE.Vector2[];
    for (let i = 0; i < MAXC; i++) { const x = pipe?.times[i]; if (x) arr[i]!.set(x.s, x.d); else arr[i]!.set(1e9, 0.2); }
    // 頁面圖層：食譜卡、擠花袋
    const L = this.layer; L.clear();
    const c = L.ctx;
    this.drawCard(c, CARD2, t);
    const head = pipe ? this.headAt(pipe, t) : null;
    if (head) this.drawBag(c, head, t);
    u.page!.value = L.upload();
    this.cake.render(renderer, out);
    const exit = prog(t, e - 0.35, e, ease.inCubic);
    return { paper: 1, bloom: 0.25, vignette: 0.4, zoom: 1 + 0.02 * exit, flash: this.tDing > s + 0.01 ? 0.5 * (1 - clamp((t - this.tDing) / 0.18)) : 0, popupAvoid: this.avoid2.map((r) => this.cam.screenRect(r, 10)) };
  }

  /** 擠花嘴在 t 時的位置（正在擠的那個字，照掃描方向往右走、上下動一點）；沒在擠是 null（停在最後一個字旁邊一下下）。 */
  private headAt(p: PipeSet, t: number): P2 | null {
    let last: P2 | null = null;
    for (let i = 0; i < p.items.length; i++) {
      const tm = p.times[i]!, it = p.items[i]!;
      if (t < tm.s) return last && t - (p.times[i - 1]!.s + p.times[i - 1]!.d) < 0.35 ? last : null;
      if (t < tm.s + tm.d) {
        const k = (t - tm.s) / tm.d;
        return { x: it.x + it.w * k, y: it.y - it.size * (0.4 + 0.25 * Math.sin(k * 11 + i)) };
      }
      last = { x: it.x + it.w, y: it.y - it.size * 0.4 };
    }
    const lt = p.times[p.times.length - 1];
    return lt && last && t - (lt.s + lt.d) < 0.35 ? last : null;
  }

  /** 擠花袋（從上面看：一個圓錐，嘴在 head，袋子往右上方），線條＋平塗，下面一點影子。 */
  private drawBag(c: CanvasRenderingContext2D, h: P2, t: number) {
    // 袋子往右上斜（蓋住的是還沒擠的地方，不是剛擠好的字）；小一點、半透明
    const ang = -0.32 + 0.05 * Math.sin(t * 7);
    c.save();
    c.translate(h.x + 18, h.y + 26); c.rotate(ang);
    const sg = c.createRadialGradient(150, 0, 20, 150, 0, 200);
    sg.addColorStop(0, rgba('sepia', 0.18)); sg.addColorStop(1, rgba('sepia', 0));
    c.fillStyle = sg; c.fillRect(-20, -200, 400, 400);
    c.restore();
    c.save();
    c.globalAlpha = 0.92;
    c.translate(h.x, h.y); c.rotate(ang); c.scale(0.78, 0.78);
    c.lineWidth = 2.5; c.strokeStyle = rgba('sepia'); c.lineJoin = 'round';
    // 袋子（半透明的白，裡面透出巧克力）
    c.beginPath(); c.moveTo(34, -14); c.quadraticCurveTo(170, -96, 320, -86); c.quadraticCurveTo(356, 0, 320, 86); c.quadraticCurveTo(170, 96, 34, 14); c.closePath();
    const bg = c.createLinearGradient(0, -60, 0, 60);
    bg.addColorStop(0, mixRgba('bone', 'sepia', 0.1)); bg.addColorStop(0.5, mixRgba('bone', 'sepia', 0.35)); bg.addColorStop(1, mixRgba('bone', 'sepia', 0.15));
    c.fillStyle = bg; c.fill(); c.stroke();
    // 袋子被捏出來的摺痕、袋口扭起來的地方
    c.lineWidth = 1.2; c.strokeStyle = rgba('sepia', 0.4);
    for (const k of [-0.45, 0, 0.4]) { c.beginPath(); c.moveTo(60, k * 12); c.quadraticCurveTo(190, k * 80, 318, k * 70); c.stroke(); }
    c.lineWidth = 2.5; c.strokeStyle = rgba('sepia');
    c.beginPath(); c.moveTo(326, -46); c.lineTo(384, -20); c.lineTo(384, 20); c.lineTo(326, 46); c.stroke();
    // 花嘴（金屬）
    c.beginPath(); c.moveTo(0, 0); c.lineTo(40, -16); c.lineTo(40, 16); c.closePath();
    c.fillStyle = mixRgba('ash', 'bone', 0.5); c.fill(); c.stroke();
    c.restore();
  }

  /** 食譜卡：一張白卡、兩段膠帶；上面印歌詞（有留言）或邀請（沒有留言）。 */
  private drawCard(c: CanvasRenderingContext2D, K: { x: number; y: number; hw: number; hh: number; rot: number }, t: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    c.save();
    c.translate(K.x, K.y); c.rotate(K.rot);
    c.fillStyle = rgba('sepia', 0.16); c.fillRect(-K.hw + 8, -K.hh + 10, K.hw * 2, K.hh * 2);
    c.fillStyle = mixRgba('bone', 'paper', 0.3); c.fillRect(-K.hw, -K.hh, K.hw * 2, K.hh * 2);
    c.fillStyle = rgba('blood', 0.45); c.fillRect(-K.hw, -K.hh + 12, K.hw * 2, 2);
    // 膠帶
    for (const sx of [-1, 1]) {
      c.save(); c.translate(sx * (K.hw - 20), -K.hh); c.rotate(sx * 0.5);
      c.fillStyle = rgba('paper', 0.75); c.fillRect(-34, -12, 68, 24); c.restore();
    }
    c.textBaseline = 'alphabetic';
    const x0 = -K.hw + 26;
    if (this.msg) {
      const ly = shownLyric(lyrics, t, s, e);
      if (ly) {
        const st = { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: K.hw * 2 - 50, maxRows: 1, align: 'left' as const };
        const lay = layoutRows(c, ly.line, st);
        c.save(); c.translate(x0, 8 + lay.size * 0.36);
        drawRows(c, lay, FAM_LYR, t, paperInk(), ly.k);
        c.restore();
      } else {
        c.font = font(F.mono(500), 20); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.7);
        c.fillText(`♪  ${song.title}`.toUpperCase().slice(0, 36), x0, 14);
        c.letterSpacing = '0px';
      }
    } else {
      const ft = fitText(c, INVITE, F.hei(700), K.hw * 2 - 50, K.hh * 2 - 20, { min: 22, max: 30, lineHeight: 1.3, maxLines: 2 });
      c.font = font(F.hei(700), ft.size); c.fillStyle = rgba('sepia', 0.85);
      ft.lines.forEach((ln, i) => c.fillText(ln, x0, 8 - ft.height / 2 + ft.size * 0.85 + i * ft.lineHeight));
    }
    c.restore();
  }
}

