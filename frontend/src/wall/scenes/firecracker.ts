// 鞭炮（批次 T18・遊戲，暗）：揭牌儀式。牆上掛著一塊木匾，蓋著一塊紅綢；匾的左前方垂著一長串鞭炮。
//  - 第一拍前，仙女棒的火花點著最下面的引信；之後每一拍炸一串（一拍裡劈哩啪啦一小群），火頭一路往上爬，
//    繩子跟著一截一截燒短。每一顆炸開：白熱的一點、放射的火光、一把紅紙屑往外噴再慢慢飄落、一團煙。
//  - 火光是真的光源：照亮牆、紅綢、紙屑與煙（整個畫面只有這些光在閃，焦點很清楚）。
//  - 揭曉（小節線）：最上面的大炮「碰」一聲，紅綢整塊滑落——匾上金字寫的就是主打留言（由上往下露出來，跟閱讀順序一樣），
//    一道反光掃過金字。之後一盞暖燈打在匾上，紙屑還在飄，鏡頭慢慢推近。
//  - 歌詞寫在匾下面的牆上（逐字跟唱，比留言小一級）。沒有留言：匾上寫「虛位以待」＋一行邀請（冷面的玩笑）。
// 畫法：牆、匾、紅綢、煙、火光打光是一個全螢幕 shader（PlaneCam：牆是空間裡的一個平面，鏡頭會推、會晃）；
// 匾上的字畫成一張遮罩（G = 金字、R−G = 愛心），shader 讀它上金色；鞭炮、繩子、紙屑、火光是 LineBatch（在牆前面，有視差）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, TAU } from '../engine/util';
import { lyricAt, drawLyric, layoutLyric, lyricSizeFor, sparkHead, sparkParticles, fillWithHearts, type LyricStyle } from './_motifs';
import { grid, type Grid } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, msgBlock, type MsgBlock } from './_t14';
import { loadWindow, revealAt, beatsBetween } from './_t18';

export const spec: PlateSpecDecl = { group: 'type', family: 'game', paper: false, energy: [0.45, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（牆面座標 = 鏡頭在正前方時的螢幕座標）
/** 木匾。 */
const PLQ = { x: 470, y: 150, w: 1270, h: 620 };
/** 匾上寫字的範圍（留言＋署名）。 */
const TXT = { x: PLQ.x + 110, y: PLQ.y + 78, w: PLQ.w - 220, h: PLQ.h - 150 };
/** 歌詞：匾下面的牆上，左對齊，右端停在 HUD 左邊。 */
const LYR = { x: PLQ.x + 10, y: 880, w: 850 };
/** 鞭炮：從牆前 200 px 的地方垂下來（有視差）。u = 沿繩子往下的長度。 */
const STR = { x: 392, y0: -40, z: -200, len: 940, u0: 170, n: 56, big: 118 };
const FAM_MSG = F.hand(700);
const FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
const EMPTY = '虛位以待';
const INVITE = '掃描右下角 QR code，把你的祝福掛上來';

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D plq; uniform sampler2D lyr;
  uniform float t; uniform float lit; uniform float drop; uniform float glintX; uniform float glintK; uniform float lyrK;
  uniform vec4 fl[6];   // 火光：螢幕 x、y、強度、半徑
  uniform vec4 pf[12];  // 煙：螢幕 x、y、半徑、濃度
  uniform vec4 plaque;  // 匾：x、y、w、h（牆面座標）
  float sdRB(vec2 p, vec2 c, vec2 hs, float r) { vec2 q = abs(p - c) - hs + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    // 火光（暖色，照在牆、匾、紅綢、煙上）
    float fs = 0.0;
    for (int i = 0; i < 6; i++) { vec4 f = fl[i]; if (f.z <= 0.0) continue; vec2 d = (sp - f.xy) / f.w; fs += f.z * exp(-dot(d, d)); }
    vec3 fla = fs * mix(C_SIGNAL, C_EMBER, 0.45);
    // 主燈：打在匾上的一圈暖光（揭曉後才亮起來）
    vec2 kd = (P - vec2(plaque.x + plaque.z * 0.5, plaque.y + plaque.w * 0.45)) / vec2(plaque.z * 0.6, plaque.w * 0.85);
    float key = exp(-dot(kd, kd)) * lit;
    vec3 warm = mix(C_BONE, C_SIGNAL, 0.3);
    vec3 Lt = vec3(0.06) + warm * key * 0.95 + fla;
    // 牆：很暗的紅磚（磚縫只在光裡看得到）
    vec2 bq = P / vec2(128.0, 44.0);
    bq.x += 0.5 * mod(floor(bq.y), 2.0);
    vec2 bi = floor(bq), bf = fract(bq);
    float mortar = 1.0 - min(smoothstep(0.0, 0.035, bf.x) * smoothstep(1.0, 0.965, bf.x), smoothstep(0.0, 0.09, bf.y) * smoothstep(1.0, 0.91, bf.y));
    float n = fbm(P / 240.0, 3);
    vec3 brick = mix(C_INK2, C_BLOOD, 0.08) * (0.7 + 0.3 * hash12(bi) + 0.25 * n) * (1.0 - 0.45 * mortar);
    vec3 col = brick * 1.05 * Lt;
    vec2 pc = plaque.xy + plaque.zw * 0.5, hs = plaque.zw * 0.5;
    // 匾的影子
    float dsh = sdRB(P, pc + vec2(16.0, 26.0), hs, 12.0);
    col *= 1.0 - 0.7 * (1.0 - smoothstep(-16.0, 46.0, dsh));
    float d = sdRB(P, pc, hs, 10.0);
    if (d < 1.0) {
      float ed = -d;
      // 深色漆木：橫向的木紋，漆面把主燈反射成上面一條很寬的淡光
      float grain = fbm(vec2(P.x / 700.0, P.y / 16.0), 3) + 0.3 * snoise(vec2(P.x / 90.0, P.y / 4.0));
      vec3 wood = mix(C_INK2, C_BLOOD, 0.05) * (0.9 + 0.3 * grain);
      // 斜邊：光從左上來
      float bev = 1.0 - smoothstep(0.0, 18.0, ed);
      float dx = hs.x - abs(P.x - pc.x), dy = hs.y - abs(P.y - pc.y);
      float s = dx < dy ? (P.x < pc.x ? 1.2 : -0.5) : (P.y < pc.y ? 1.8 : -0.6);
      wood *= 1.0 + bev * s;
      vec3 woodL = wood * (Lt + vec3(0.05)) * 1.3;
      float gloss = exp(-pow((P.y - plaque.y - 90.0) / 70.0, 2.0)) * (0.5 + 0.5 * sin(P.x / 300.0 + 1.0));
      woodL += warm * 0.012 * gloss * key + mix(C_SIGNAL, C_EMBER, 0.5) * 0.06 * luma(fla) * gloss;
      // 金色的雙框線
      float g1 = pxLine(abs(ed - 34.0), 0.8, 1.8), g2 = pxLine(abs(ed - 45.0), 0.35, 1.2);
      vec3 goldAlb = mix(C_BLOOD, C_SIGNAL, 0.82);
      float fl2 = luma(fla);
      float gl = exp(-pow(((P.x - glintX) + (P.y - pc.y) * 0.55) / 70.0, 2.0)) * glintK;
      vec3 gold = goldAlb * (0.2 + 0.72 * key + 0.9 * fl2) + mix(C_SIGNAL, C_EMBER, 0.6) * (gl * 0.8 + fl2 * 0.25);
      woodL = mix(woodL, gold * 0.85, max(g1, g2 * 0.7));
      // 金字：遮罩 G = 字、R−G = 愛心；字稍微浮起來（右下方有一點影子）
      vec4 tx = fastLayer(texture(plq, pageUV(P)));
      vec4 ts = fastLayer(texture(plq, pageUV(P - vec2(2.5, 3.5))));
      woodL *= 1.0 - 0.55 * ts.a * (1.0 - tx.a);
      float heart = max(tx.r - tx.g, 0.0);
      woodL = mix(woodL, gold * (0.94 + 0.12 * snoise(P / 3.0)), tx.g);
      woodL = mix(woodL, C_ROSE * (0.28 + 0.62 * key + 0.6 * fl2), heart);
      col = mix(woodL, col, smoothstep(-1.0, 1.0, d));
    }
    // 紅綢：蓋著匾，揭曉時整塊滑落（上緣往下掃，字由上往下露出來）
    if (drop < 1400.0) {
      float x0 = plaque.x - 28.0, x1 = plaque.x + plaque.z + 28.0;
      float topY = plaque.y - 34.0 + drop + 24.0 * sin(P.x / 95.0 + 1.3) * min(drop / 140.0, 1.0);
      float hem = plaque.y + plaque.w + 52.0 + drop + 12.0 * sin(P.x / 57.0);
      float a = smoothstep(topY - 1.0, topY + 1.0, P.y) * (1.0 - smoothstep(hem - 1.0, hem + 1.0, P.y))
              * smoothstep(x0 - 1.0, x0 + 1.0, P.x) * (1.0 - smoothstep(x1 - 1.0, x1 + 1.0, P.x));
      // 綢子的影子（在牆上、匾上，右下）
      float shA = smoothstep(topY + 20.0, topY + 60.0, P.y) * (1.0 - smoothstep(hem + 10.0, hem + 40.0, P.y))
              * smoothstep(x0 + 10.0, x0 + 40.0, P.x) * (1.0 - smoothstep(x1 + 8.0, x1 + 44.0, P.x));
      col *= 1.0 - 0.45 * shA * (1.0 - a);
      if (a > 0.0) {
        float cx = pc.x, q = (P.x - cx) / (hs.x + 28.0);
        // 上面一段收攏的垂幔（兩端掛在匾角、中間垂下來），下面是直直垂著的綢子
        float vH = 110.0 + 80.0 * (1.0 - q * q);
        float v = (P.y - topY) / vH;
        float inV = 1.0 - smoothstep(0.97, 1.03, v);
        float fo = P.x / 31.0 + 2.4 * fbm(vec2(P.x / 240.0, (P.y - drop) / 520.0), 2);
        float foldD = 0.5 + 0.5 * sin(fo);
        float foldV = 0.5 + 0.5 * sin(v * 10.0 + 1.4 * fbm(vec2(P.x / 180.0, v * 2.0), 2) - q * q * 2.0);
        float fold = mix(foldD, foldV, inV);
        vec3 silk = mix(C_BLOOD, C_SIGNAL, 0.2);
        float fl3 = luma(fla);
        float sh = 0.22 + 0.78 * fold;
        float spec = pow(fold, 12.0);
        vec3 cc = silk * sh * (0.16 + 0.75 * key + 1.5 * fl3)
                + mix(C_SIGNAL, C_EMBER, 0.4) * spec * (0.03 + 0.12 * key + 0.9 * fl3);
        // 垂幔下緣的影子、下擺的暗邊
        cc *= 1.0 - 0.45 * (1.0 - inV) * exp(-(v - 1.0) * 5.0) * step(1.0, v);
        cc *= 1.0 - 0.35 * smoothstep(hem - 40.0, hem, P.y);
        // 中間的綢花（一朵，花瓣一圈一圈）
        vec2 rp = P - vec2(cx, topY + vH * 0.95);
        float ra = atan(rp.y, rp.x), rr = length(rp);
        float edge = 74.0 + 9.0 * sin(ra * 9.0) + 5.0 * sin(ra * 5.0 + 1.0);
        float inR = 1.0 - smoothstep(edge - 1.5, edge + 1.5, rr);
        if (inR > 0.0) {
          float pet = 0.5 + 0.5 * cos(rr / 7.5 + sin(ra * 9.0) * 1.2);
          vec3 rc = silk * (0.3 + 0.7 * pet) * (0.2 + 0.9 * key + 1.6 * fl3) * (1.0 - 0.4 * smoothstep(edge - 12.0, edge, rr))
                  + mix(C_SIGNAL, C_EMBER, 0.4) * pow(pet, 8.0) * (0.04 + 0.9 * fl3);
          col = mix(col, mix(cc, rc, inR), a);
        } else col = mix(col, cc, a);
      }
    }
    // 牆上的歌詞
    vec4 ly = fastLayer(texture(lyr, pageUV(P)));
    col = col * (1.0 - ly.a * lyrK) + ly.rgb * lyrK;
    // 煙：一團一團，被火光照亮
    float sm = 0.0;
    for (int i = 0; i < 12; i++) { vec4 q = pf[i]; if (q.w <= 0.0) continue; vec2 dd = (sp - q.xy) / q.z; sm += q.w * exp(-dot(dd, dd)); }
    if (sm > 0.002) {
      sm *= 0.5 + 0.5 * fbm(sp / 140.0 + vec2(0.0, -t * 0.15), 3);
      vec3 scol = C_ASH * (0.045 + 0.06 * key) + fla * 0.3;
      col = mix(col, scol, clamp(sm, 0.0, 0.7));
    }
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  plq: { value: null }, lyr: { value: null },
  t: { value: 0 }, lit: { value: 0 }, drop: { value: 0 }, glintX: { value: -9999 }, glintK: { value: 0 }, lyrK: { value: 1 },
  fl: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
  pf: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) },
  plaque: { value: new THREE.Vector4(PLQ.x, PLQ.y, PLQ.w, PLQ.h) },
});

/** 一顆鞭炮：沿繩子的位置、往哪邊伸出去、炸的時間。 */
interface Cracker { u: number; side: number; ang: number; len: number; te: number; big: boolean }

export default class Firecracker extends Scene {
  bg = shared('firecracker.bg', BG);
  /** 匾上的字（遮罩，畫一次）。 */
  plq = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 牆上的歌詞（每格重畫）。 */
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  solid = this.track(new LineBatch(3000, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(3000, { screen2D: true, blend: 'add' }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  block: MsgBlock | null = null;
  lyrSize = 64;
  g!: Grid;
  tr = 0;
  crackers: Cracker[] = [];
  /** 一拍一串：每串的時間與中間那顆的 u（煙從那裡冒出來）。 */
  clusters: { t: number; u: number }[] = [];

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    await loadWindow(this.ctx, EMPTY + INVITE);
    const g = (this.g = grid(au, s, e));
    this.tr = revealAt(au, g.b0, e, { minB: 2, maxB: 6 });
    // ---- 鞭炮的排程：從第一拍到揭曉前，每一拍炸一串（由下往上）
    const B = g.beat;
    const bursts = beatsBetween(au, g.b0, this.tr - B * 0.35);
    if (!bursts.length) bursts.push(g.b0);
    const N = STR.n, per = Math.ceil(N / bursts.length);
    const sp = (STR.len - STR.u0) / (N - 1);
    let prev = -Infinity;
    for (let i = 0; i < N; i++) {
      const k = Math.min(bursts.length - 1, Math.floor(i / per)), j = i % per;
      const tb = bursts[k]!;
      const span = Math.min(0.8 * B, (k + 1 < bursts.length ? bursts[k + 1]! : this.tr) - tb - 0.06);
      let te = tb + (j / per) * span + (hash(i, this.seed, 3) - 0.5) * (0.3 * span) / per;
      te = Math.max(te, prev + 0.004);
      prev = te;
      const side = i % 2 === 0 ? 1 : -1;
      this.crackers.push({
        u: STR.len - i * sp, side,
        ang: side * (1.02 + 0.3 * (hash(i, 5) - 0.5)),
        // 有的朝鏡頭、有的朝後：看起來短一點（編在繩子上的樣子）
        len: 40 * (0.55 + 0.45 * hash(i, 6)), te, big: false,
      });
      if (j === 0) this.clusters.push({ t: tb, u: STR.len - (i + per / 2) * sp });
    }
    // 最上面的大炮：揭曉那一下
    this.crackers.push({ u: STR.big, side: 0, ang: 0, len: 58, te: this.tr, big: true });
    this.clusters.push({ t: this.tr, u: STR.big });

    // ---- 匾上的字（遮罩：白 = 金字、紅 = 愛心）
    const c = this.plq.ctx;
    this.plq.clear();
    c.textBaseline = 'alphabetic';
    if (this.msg) {
      const b = (this.block = msgBlock(c, this.msg, FAM_MSG, TXT, { align: 'center', sigFamily: FAM_SIG, min: 46, max: 132, lineHeight: 1.3, maxLines: 5, sigMin: 40, sigMax: 52 }));
      c.font = font(FAM_MSG, b.fit.size);
      c.fillStyle = '#fff';
      for (const ln of b.lines) fillWithHearts(c, ln.text, ln.x, ln.y, '#f00');
      c.font = font(FAM_SIG, b.sig.size);
      c.fillStyle = 'rgba(255,255,255,0.78)';
      fillWithHearts(c, b.sig.text, b.sig.x, b.sig.y, '#f00');
      this.lyrSize = lyricSizeFor(b.fit.size);
    } else {
      c.textAlign = 'center';
      c.fillStyle = '#fff';
      c.font = font(FAM_MSG, 150);
      c.letterSpacing = '24px';
      c.fillText(EMPTY, PLQ.x + PLQ.w / 2 + 12, PLQ.y + PLQ.h * 0.52);
      c.letterSpacing = '4px';
      c.font = font(F.hei(500), 30);
      c.fillStyle = 'rgba(255,255,255,0.62)';
      c.fillText(INVITE, PLQ.x + PLQ.w / 2, PLQ.y + PLQ.h * 0.52 + 110);
      c.letterSpacing = '0px';
      c.textAlign = 'left';
      this.lyrSize = 64;
    }
    this.plq.upload();
  }

  /** 繩子在時間 t 的擺動角度：慢慢晃，每炸一顆被扯一下。 */
  private swing(t: number): number {
    let a = 0.016 * Math.sin(1.3 * t + 0.7) + 0.008 * Math.sin(2.9 * t);
    for (const k of this.crackers) {
      const age = t - k.te;
      if (age < 0 || age > 1.6) continue;
      a += (k.big ? 0.05 : 0.012) * (k.side || 1) * Math.exp(-age / 0.45) * Math.sin(age * 8.5);
    }
    return a;
  }

  /** 繩子上 u 那一點（牆面座標，z = STR.z）。 */
  private cord(u: number, t: number, sw = this.swing(t)): { x: number; y: number } {
    const k = u / STR.len;
    return { x: STR.x + Math.sin(sw) * u + 7 * Math.sin(u / 150 + t * 0.9) * k, y: STR.y0 + Math.cos(sw) * u };
  }

  /** 火頭：下一顆還沒炸的那顆的位置（全部炸完是 null）。 */
  private front(t: number): { x: number; y: number } | null {
    const next = this.crackers.find((k) => k.te > t);
    if (!next) return null;
    const p = this.cord(next.u + (next.big ? 30 : 4), t);
    const q = this.cam.toScreen(p.x, p.y, STR.z);
    return { x: q.x, y: q.y };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, g = this.g, tr = this.tr;
    const u = this.bg.u;

    // ---- 鏡頭：切進來時從低一點、近一點的地方落定；炸的時候跟著火頭微微抬頭；揭曉後慢慢推近匾
    const land = ease.outExpo(prog(t, s, s + Math.min(0.9, g.beat * 2)));
    const after = ease.inOutCubic(prog(t, tr + 0.3, Math.max(tr + 1.5, e)));
    const burn = prog(t, g.b0, tr, ease.inOutQuad);
    const cam = this.cam;
    cam.set({
      tx: lerp(990, 1000, land) + 70 * after, ty: lerp(600, 560, land) - 26 * burn + 10 * after,
      dist: 1600 * (lerp(0.93, 1.0, land) - 0.07 * after),
      yaw: lerp(-0.09, -0.035, land) + 0.03 * after, pitch: lerp(0.08, 0.035, land) - 0.02 * after, level: 1,
    });
    cam.apply(u);

    // ---- 火光、煙、震動
    const flashes: { x: number; y: number; k: number; r: number }[] = [];
    let shake = 0, shx = 0, shy = 0;
    const sw = this.swing(t);
    for (const [i, k] of this.crackers.entries()) {
      const age = t - k.te;
      if (age < 0 || age > 0.35) continue;
      const p0 = this.cord(k.u, k.te);
      const q = cam.toScreen(p0.x, p0.y, STR.z);
      const I = (k.big ? 3.2 : 1.35) * Math.exp(-age / (k.big ? 0.09 : 0.045));
      flashes.push({ x: q.x, y: q.y, k: I, r: k.big ? 760 : 380 });
      const sk = pulse(t, k.te, k.big ? 0.07 : 0.03) * (k.big ? 12 : 2.6);
      shake += sk;
      shx += sk * (hash(i, 11) - 0.5) * 2; shy += sk * (hash(i, 12) - 0.5) * 2;
    }
    flashes.sort((a, b) => b.k - a.k);
    const FL = u.fl!.value as THREE.Vector4[];
    for (let i = 0; i < 6; i++) { const q = flashes[i]; FL[i]!.set(q ? q.x : 0, q ? q.y : 0, q ? q.k : 0, q ? q.r : 1); }
    const PF = u.pf!.value as THREE.Vector4[];
    const puffs = this.clusters.filter((c) => t >= c.t && t - c.t < 7).slice(-12);
    for (let i = 0; i < 12; i++) {
      const c = puffs[i];
      if (!c) { PF[i]!.set(0, 0, 1, 0); continue; }
      const a = t - c.t, big = c.t === tr;
      const p0 = this.cord(c.u, c.t);
      const q = cam.toScreen(p0.x + 30 * a, p0.y - 28 * a, STR.z);
      PF[i]!.set(q.x, q.y, (big ? 110 : 70) + (big ? 300 : 170) * (1 - Math.exp(-a / 1.3)), (big ? 0.7 : 0.5) * Math.exp(-a / (big ? 1.8 : 2.4)) * clamp(a / 0.08));
    }

    // ---- 揭曉：紅綢滑落、主燈亮起、一道反光掃過金字
    const dt = t - tr - 0.04;
    u.drop!.value = dt > 0 ? 0.5 * 7200 * dt * dt + 40 * dt : 0;
    u.lit!.value = 0.12 + 0.88 * ease.outCubic(prog(t, tr, tr + 0.6)) + 0.05 * f.a.kick * (t > tr ? 1 : 0);
    const gp = prog(t, tr + 0.3, tr + 1.25, ease.inOutCubic);
    u.glintX!.value = lerp(PLQ.x - 380, PLQ.x + PLQ.w + 380, gp);
    u.glintK!.value = gp > 0 && gp < 1 ? 1 : 0;
    u.t!.value = t;
    u.plq!.value = this.plq.texture;

    // ---- 牆上的歌詞
    const L = this.lyr, c = L.ctx;
    L.clear();
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st: LyricStyle = { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxWidth: LYR.w };
      const lay = layoutLyric(c, ly.line, st);
      // 兩行時整塊往上挪，第二行不要掉到畫面外
      const y = LYR.y - (lay.rows.length > 1 ? lay.size * 1.18 * 0.6 : 0);
      c.save(); c.translate(LYR.x, y);
      drawLyric(c, ly.line, t, st, lay, ly.k * prog(t, s, s + 0.4));
      c.restore();
    }
    u.lyr!.value = L.upload();
    this.bg.render(renderer, out);

    // ---- 鞭炮、繩子、紙屑（實心）與火光、火花（發光）
    const S = this.solid, G = this.glow;
    S.clear(); G.clear();
    const red = LIN.blood.map((v, i) => lerp(v, LIN.signal[i]!, 0.2)) as [number, number, number];
    const lightAt = (x: number, y: number) => {
      let l = 0.2;
      for (const q of flashes) { const dx = (x - q.x) / q.r, dy = (y - q.y) / q.r; l += q.k * Math.exp(-(dx * dx + dy * dy)) * 1.4; }
      return l;
    };
    // 繩子：從掛鉤到火頭（燒過的地方沒有了）
    const nextIdx = this.crackers.findIndex((k) => k.te > t);
    const uEnd = nextIdx < 0 ? STR.big - 30 : Math.min(STR.len, this.crackers[nextIdx]!.u + (this.crackers[nextIdx]!.big ? 30 : 6));
    const cordPts: { x: number; y: number }[] = [];
    for (let uu = 0; uu <= uEnd; uu += 24) { const p = this.cord(uu, t, sw); const q = cam.toScreen(p.x, p.y, STR.z); cordPts.push({ x: q.x, y: q.y }); }
    { const p = this.cord(uEnd, t, sw); const q = cam.toScreen(p.x, p.y, STR.z); cordPts.push({ x: q.x, y: q.y }); }
    const cordC = LIN.ash.map((v) => v * 0.35) as [number, number, number];
    S.polyline(cordPts, 2.4, cordC, 0.95);
    // 掛鉤上的紅絲帶（一個小結）
    {
      const p = this.cord(40, t, sw), q = cam.toScreen(p.x, p.y, STR.z), l = lightAt(q.x, q.y);
      const rc = red.map((v) => v * l * 1.6) as [number, number, number];
      S.seg2(q.x, q.y, q.x - 26, q.y + 34, 9, rc); S.seg2(q.x, q.y, q.x + 24, q.y + 38, 9, rc);
      S.seg2(q.x - 6, q.y, q.x + 6, q.y, 14, rc);
    }
    for (const [i, k] of this.crackers.entries()) {
      if (t >= k.te) continue;
      const p = this.cord(k.u, t, sw);
      const a = cam.toScreen(p.x, p.y, STR.z);
      const sc = a.scale;
      const l = lightAt(a.x, a.y);
      if (k.big) {
        // 大炮：直直垂著，粗一點，腰上一圈金紙
        const b = cam.toScreen(p.x + Math.sin(sw) * k.len, p.y + k.len, STR.z);
        S.seg2(a.x, a.y, b.x, b.y, 24 * sc, red.map((v) => v * l * 1.3) as [number, number, number]);
        S.seg2(a.x - 6 * sc, a.y + 4, b.x - 6 * sc, b.y - 4, 4 * sc, red.map((v) => v * l * 2.6) as [number, number, number], 0.8);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        S.seg2(m.x - 12 * sc, m.y, m.x + 12 * sc, m.y, 8 * sc, LIN.signal.map((v) => v * l * 0.7) as [number, number, number]);
        continue;
      }
      const dx = Math.sin(k.ang + sw), dy = Math.cos(k.ang + sw) * 0.55 + 0.25;
      const n = Math.hypot(dx, dy);
      const len = k.len * sc;
      const bx = a.x + (dx / n) * len, by = a.y + (dy / n) * len;
      const sh = 0.75 + 0.35 * hash(i, 9);
      S.seg2(a.x + (dx / n) * 3, a.y + (dy / n) * 3, bx, by, 11 * sc, red.map((v) => v * l * sh) as [number, number, number]);
      // 受光的一條亮邊（上緣）
      S.seg2(a.x + (dx / n) * 5, a.y + (dy / n) * 5 - 3 * sc, bx - (dx / n) * 3, by - 3 * sc, 2.4 * sc, red.map((v) => v * l * sh * 2.4) as [number, number, number], 0.75);
      // 封口的黏土（末端一小截暗色）
      S.seg2(bx - (dx / n) * 3, by - (dy / n) * 3, bx, by, 11 * sc, LIN.sepia.map((v) => v * l * 0.6) as [number, number, number]);
    }

    // 炸開：白熱的一點、放射的火光、紙屑
    for (const [i, k] of this.crackers.entries()) {
      const age = t - k.te;
      if (age < 0) continue;
      const p0 = this.cord(k.u, k.te);
      const o = cam.toScreen(p0.x, p0.y, STR.z);
      const big = k.big ? 1 : 0;
      const fT = big ? 0.16 : 0.09;
      if (age < fT) {
        const q = age / fT;
        const I = (1 - q) * (1 - q);
        G.seg2(o.x, o.y, o.x + 0.01, o.y, (big ? 70 : 34) * (1 - q) + 8, [5 * I, 4.4 * I, 3.6 * I], 1);
        const nR = big ? 22 : 9;
        for (let r = 0; r < nR; r++) {
          const an = hash(i, r, 21) * TAU, L0 = (big ? 70 : 30) + (big ? 260 : 120) * ease.outQuad(q) * (0.5 + 0.5 * hash(i, r, 22));
          const c0 = LIN.signal, c1 = LIN.ember;
          const col: [number, number, number] = [(c0[0] + c1[0]) * 1.6 * I, (c0[1] + c1[1]) * 1.6 * I, (c0[2] + c1[2]) * 1.6 * I];
          G.seg2(o.x + Math.cos(an) * L0 * 0.35, o.y + Math.sin(an) * L0 * 0.35, o.x + Math.cos(an) * L0, o.y + Math.sin(an) * L0, 1.6 + big * 1.4, col, 1);
        }
      }
      // 紙屑：往外噴（有阻力），之後慢慢飄落、翻面
      const nb = big ? 34 : 6;
      for (let j = 0; j < nb; j++) {
        const h1 = hash(i, j, 31), h2 = hash(i, j, 32), h3 = hash(i, j, 33), h4 = hash(i, j, 34);
        const side = k.side || (h4 < 0.5 ? -1 : 1);
        const an = (big ? h1 * TAU : (side > 0 ? 0 : Math.PI) + (h1 - 0.5) * 2.2);
        const v = (big ? 380 : 260) + 620 * h2 * h2;
        const tau = 0.16;
        const dd = v * tau * (1 - Math.exp(-age / tau));
        const vf = 120 + 170 * h3;
        const x = p0.x + Math.cos(an) * dd + 18 * Math.sin(age * (3 + 3 * h4) + h1 * 6) * clamp(age);
        const y = p0.y + Math.sin(an) * dd * 0.8 + vf * age;
        const z = STR.z + (h4 - 0.5) * 220;
        const q = cam.toScreen(x, y, z);
        if (q.y > 1120 || q.x < -40 || q.x > 1960) continue;
        const rot = h1 * TAU + age * (3 + 6 * h2), flip = Math.cos(age * (5 + 7 * h3) + h2 * 5);
        const ln = (6 + 5 * h4) * q.scale, wd = (5 * Math.abs(flip) + 1.4) * q.scale;
        const l = (lightAt(q.x, q.y) - 0.08) * (0.45 + 0.55 * Math.abs(flip)) * 1.2;
        const gold = j % 7 === 3;
        const base = gold ? LIN.signal.map((vv) => vv * 0.7) : red;
        S.seg2(q.x - Math.cos(rot) * ln / 2, q.y - Math.sin(rot) * ln / 2, q.x + Math.cos(rot) * ln / 2, q.y + Math.sin(rot) * ln / 2, wd, base.map((vv) => vv * l) as [number, number, number], 0.96);
      }
    }
    // 引信的火頭：從窗格開始沿繩子一路往上爬
    const fr = this.front(t);
    if (fr && t >= s + 0.05) {
      const seed = this.seed;
      sparkParticles(G, t, (tb) => (tb < s + 0.05 ? null : this.front(tb)), { rate: 70, life: 0.3, speed: 180, seed, intensity: 0.9 });
      sparkHead(G, fr.x, fr.y, t, 0.75, 0.95);
    }
    if (S.count) S.render(renderer, out);
    if (G.count) G.render(renderer, out);
    void comp; void au;

    const avoid: [number, number, number, number] = this.block ? cam.screenRect(this.block.box, 12) : cam.screenRect([PLQ.x, PLQ.y, PLQ.w, PLQ.h]);
    return {
      bloom: 0.8, vignette: 0.5, grain: 0.06,
      shake: [clamp(shx, -14, 14), clamp(shy, -14, 14)],
      flash: 0.1 * pulse(t, tr, 0.06),
      popupAvoid: [avoid],
      zoom: 1 + 0.006 * shake,
    };
  }
}
