// 織布機（暗）：夜裡的工作室，一台織布機的經線從畫面上方的布一路垂到鏡頭前，梭子在拍點上「咻」地穿過去、
// 筘（打緯的那根橫木）在拍點「啪」地往上一打，布就多織了一段——主打留言是用金線（這首歌的訊號色）織進深色布裡的字。
//  - 一個焦點：留言是布上的織紋字，一梭一梭由上往下長出來（每一梭織半行字），織完是一整塊金線織錦，停在畫面中間讀。
//    署名也織在布上（最後幾梭）。新織的那一段先鬆鬆地躺在織口下面、比較暗，筘一打就縮上去、亮一下。
//  - 歌詞是畫面前景下緣的一行字（經線在前景是虛的），逐字跟唱，比留言小一級。沒有留言時歌詞放大當主角，
//    布上改織新人的名字（灰白線、小一點），下面一行小小的邀請；純音樂：歌名一行小字。
//  - 鏡頭：從下往上仰看（前景的經線比較近、布往上退遠），跟著織口慢慢往下移，最後停在整塊布；切進來時從上方搖下來落定。
//    經線在織口下面分成兩層（開口），梭子從兩層中間穿過（前面那層蓋在梭子上）。
// 手法：一個全螢幕 shader（PlaneCam 把每個像素打回布面座標：經線、緯線的圓柱明暗、金線的高光、筘、梭子都在這裡算），
// 字是 _t14 的字模貼圖（只用覆蓋率：每一格緯線看一次）；歌詞是螢幕座標的 Canvas 圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, lyricSizeFor, COUPLE_ZH } from './_motifs';
import { grid, stagger, layoutRows, drawRows, darkInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, orderMask, lineItems, msgBlock, INVITE, type OrderMask, type MsgBlock, type Rect } from './_t14';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.3, 1], bars: [4, 8], weight: 1 };

/** 有留言：留言＋署名織在這一塊。 */
const MSG_BOX = { x: 290, y: 150, w: 1340, h: 560 };
/** 沒有留言：新人的名字織在這一塊。 */
const NAME_BOX = { x: 290, y: 190, w: 1340, h: 200 };
/** 歌詞（螢幕座標，前景）：有留言時一行小的，沒有留言時大的。 */
const LYR_S = { x: 170, y: 952, w: 1140 };
const LYR_B = { x: 170, y: 900, w: 1160 };
const FAM_W = F.hei(700);
const FAM_LYR = F.archivo(100, 700);
const FAM_SIG = F.hei(700); // 署名也是織的：粗一點的黑體，縮成格子才讀得到
const MS = 0.5;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D mask; uniform vec4 mR; uniform float hasMask;
  uniform float ws; uniform float ph; uniform float y0;
  uniform float fell; uniform float band; uniform float shX; uniform float shDir; uniform float crossing;
  uniform float reedY; uniform float slam; uniform float snap; uniform float t;
  uniform float focus; uniform float aperture;

  // 字模：這一格（經線 ci、緯線 ri）是不是字（2 = 愛心）
  float cellInk(float ci, float ri) {
    if (hasMask < 0.5) return 0.0;
    vec2 c = vec2((ci + 0.5) * ws, y0 + (ri + 0.5) * ph);
    vec2 mu = (c - mR.xy) / mR.zw;
    if (mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) return 0.0;
    vec4 m = texture(mask, mu);
    return m.a > 0.5 ? (m.r > 0.75 ? 2.0 : (m.r > 0.25 ? 3.0 : 1.0)) : 0.0;
  }

  // 經線（直的圓柱）：覆蓋率與明暗；離焦（blur 大）時條紋糊成平均的灰
  vec2 warpAt(float x, float fwx, float blur) {
    float f = fract(x / ws);
    float d = abs(f - 0.5) * ws;
    float hw = ws * 0.22;
    float cov = 1.0 - smoothstep(hw - fwx, hw + fwx, d);
    float sh = sqrt(max(0.0, 1.0 - (d / hw) * (d / hw)));
    float b = sat(blur / ws);
    return vec2(mix(cov, 0.4, b), mix(sh, 0.6, b));
  }

  void main() {
    vec2 sp = SP();
    vec3 h0 = pcHit(sp, 0.0);
    vec2 P = h0.xy;
    float blur = aperture * abs(h0.z - focus) / max(h0.z, 1.0);
    vec2 fwP = fwidth(P);
    float px = max(fwP.x, fwP.y);
    float detail = sat(1.5 - (px * (1.0 + blur * 0.4)) / ph * 2.2);
    // 房間很暗，左上方一盞燈（布上的光也照這個）；布本身有一點起伏
    vec2 lampP = vec2(620.0, 260.0);
    float lamp = exp(-dot((P - lampP) / 1150.0, (P - lampP) / 1150.0) * 1.5);
    float wav = 0.93 + 0.07 * snoise(P / vec2(900.0, 260.0));
    vec3 col = C_INK * (0.5 + 0.4 * lamp);
    vec3 warpC = mix(C_GRAPHITE, C_ASH, 0.2) * 0.42;

    // ---- 織好的布（織口以上）；最新的一段在打緯的那一下從下面縮上來、亮起來
    if (P.y < fell && P.y > y0 - 390.0) {
      float lastBand = step(fell - band, P.y);
      float yy = P.y + lastBand * (1.0 - snap) * 16.0;
      float ri = floor((yy - y0) / ph), fy = (yy - y0) / ph - ri;
      float ci = floor(P.x / ws), fx = P.x / ws - ci;
      float ink = cellInk(ci, ri);
      // 布頭：兩條細細的深色訊號線（布邊的裝飾，還沒到字）
      float stripe = step(abs(yy - (y0 - 44.0)), ph * 0.9) + step(abs(yy - (y0 - 28.0)), ph * 0.9);
      // 再上面一排菱形花紋（之前織好的布頭）
      float rr = (yy - (y0 - 130.0)) / ph;
      if (rr > 0.0 && rr < 11.0) { float dx = abs(mod(ci, 12.0) - 6.0), dy = abs(floor(rr) - 5.0); if (abs(dx + dy - 4.5) < 0.75) stripe = 1.0; }
      vec3 ground = mix(C_INK2, C_GRAPHITE, 0.16) * (0.85 + 0.3 * hash12(vec2(ci * 0.37, ri)));
      vec3 wc = ink > 2.5 ? C_BONE * 0.62 : (ink > 1.5 ? C_ROSE * 0.7 : (ink > 0.5 ? C_SIGNAL * 0.7 : (stripe > 0.5 ? C_BLOOD * 0.8 : ground)));
      // 緯線：橫的圓柱，平紋一上一下（在上面的地方鼓起來；在下面的地方露出一小截經線）
      float over = mod(ci + ri, 2.0);
      float bump = sqrt(max(0.0, 1.0 - (2.0 * fy - 1.0) * (2.0 * fy - 1.0)));
      float along = 0.7 + 0.3 * sin(PI * fx) * (over > 0.5 ? 1.0 : 0.55);
      // 纖維：沿著緯線方向的細絲（讓字像線織的，不是一格一格的燈）
      float fib = 0.9 + 0.1 * sin(fy * 23.0 + snoise(vec2(P.x / 9.0, ri)) * 3.0);
      vec3 c = wc * (0.45 + 0.6 * bump * along) * mix(1.0, fib, detail);
      // 金線的高光：燈打在凸起的地方，隨時間微微流動
      float spec = pow(bump * along, 9.0) * (0.3 + 0.9 * lamp);
      if (ink > 0.5 && ink < 2.5) c += mix(C_SIGNAL, C_EMBER, 0.5) * spec * (0.45 + 0.25 * sin(t * 1.1 + ci * 0.17 - ri * 0.05));
      else if (ink > 2.5) c += C_BONE * spec * 0.2;
      else c += C_ASH * spec * 0.05;
      float wd = abs(fx - 0.5);
      float wv = (over < 0.5 ? 1.0 : 0.0) * (1.0 - smoothstep(0.1, 0.2, wd)) * (1.0 - smoothstep(0.25, 0.5, abs(fy - 0.5)));
      c = mix(c, warpC * 0.5, wv * 0.5 * (ink > 0.5 ? 0.3 : 1.0));
      // 太小（遠、離焦）的時候紋理平均掉，留下顏色
      c = mix(wc * 0.62, c, detail);
      c *= (0.5 + 0.75 * lamp) * wav;
      c *= mix(1.0, 0.55 + 0.45 * snap, lastBand);
      c += C_SIGNAL * 0.4 * slam * exp(-abs(P.y - fell) / (ph * 2.0));
      col = c;
    }

    // ---- 織口下面：經線（分兩層開口）、正在鋪的那一條緯線、梭子、筘
    if (P.y >= fell) {
      float open = sat((P.y - fell) / 180.0);
      vec3 hF = pcHit(sp, -14.0 * open);
      float fwx = max(fwidth(P.x), 0.3);
      float blurF = aperture * abs(hF.z - focus) / max(hF.z, 1.0);
      vec2 wb = warpAt(P.x, fwx, blur), wf = warpAt(hF.x, fwx, blurF);
      float evenB = 1.0 - mod(floor(P.x / ws), 2.0);
      float oddF = mod(floor(hF.x / ws), 2.0);
      float lampB = (0.3 + 0.7 * lamp) * (1.0 - 0.8 * sat((P.y - fell) / 420.0));
      col = mix(col, warpC * (0.35 + 0.65 * wb.y) * lampB, wb.x * mix(evenB, 0.5, sat(blur / ws)));
      // 梭子拖著的那一條緯線（從布邊到梭子）
      if (crossing > 0.0) {
        float passed = shDir > 0.0 ? step(P.x, shX - 90.0) : step(shX + 90.0, P.x);
        float ly = fell + 10.0 + 5.0 * sin(PI * sat(P.x / 1920.0));
        float d = abs(P.y - ly);
        float cov = 1.0 - smoothstep(1.2, 1.2 + max(fwidth(P.y), 0.4) * 1.5, d);
        col = mix(col, C_SIGNAL * 0.8 * (0.6 + 0.5 * lamp), cov * passed);
      }
      // 梭子（在兩層經線中間，z = -7）：木頭的小船形、兩頭包金屬、中間放紗管的槽
      vec2 S = pcHit(sp, -7.0).xy - vec2(shX, fell + 30.0);
      if (crossing > 0.0 && abs(S.x) < 130.0 && abs(S.y) < 30.0) {
        float L = 118.0, R = 16.0;
        float u = S.x / L;
        float hh = R * sqrt(max(0.0, 1.0 - u * u)) * (0.55 + 0.45 * (1.0 - abs(u)));
        float d = abs(S.y) - hh;
        float fw = max(fwidth(S.y), 0.5);
        float cov = (1.0 - smoothstep(-fw, fw, d)) * step(abs(u), 1.0);
        vec3 wood = mix(C_BLOOD, C_SEPIA, 0.5) * 1.2;
        float rn = sqrt(max(0.0, 1.0 - (S.y / max(hh, 1.0)) * (S.y / max(hh, 1.0))));
        vec3 sc = wood * (0.35 + 0.8 * rn - 0.25 * S.y / max(hh, 1.0)) * (0.6 + 0.6 * lamp);
        sc = mix(sc, C_ASH * (0.45 + 0.9 * rn), smoothstep(0.74, 0.8, abs(u)));
        float slot = (1.0 - smoothstep(0.33, 0.36, abs(u))) * (1.0 - smoothstep(hh * 0.3, hh * 0.42, abs(S.y)));
        sc = mix(sc, C_SIGNAL * 0.55 * (0.5 + 0.5 * rn), slot);
        col = mix(col, sc, cov);
      }
      // 前一層經線蓋在梭子上面
      col = mix(col, warpC * (0.4 + 0.7 * wf.y) * lampB * 1.1, wf.x * mix(oddF, 0.5, sat(blurF / ws)));
      // 筘：一根橫的木條（z = -24，比布近），打緯時跟著拍子「啪」一下；上緣一條細細的亮邊
      vec2 Rd = pcHit(sp, -24.0).xy;
      float rd = Rd.y - reedY;
      float fwr = max(fwidth(rd), 0.5);
      float cov = smoothstep(-fwr, fwr, rd) * (1.0 - smoothstep(26.0 - fwr, 26.0 + fwr, rd));
      float n = sat(rd / 26.0) * 2.0 - 1.0;
      vec3 rc = mix(C_SEPIA, C_INK2, 0.3) * (0.4 + 0.6 * sqrt(max(0.0, 1.0 - n * n))) * (0.5 + 0.7 * lamp);
      rc += mix(C_SIGNAL, C_BONE, 0.4) * 0.22 * (1.0 - smoothstep(0.0, 3.0, rd)) * (0.5 + lamp);
      rc += C_SIGNAL * 0.3 * slam * (1.0 - smoothstep(0.0, 8.0, rd));
      col = mix(col, rc, cov);
    }
    // 上面捲布的橫梁
    float bn = (P.y - (y0 - 420.0)) / 28.0;
    float beam = 1.0 - smoothstep(0.93, 1.07, abs(bn));
    col = mix(col, mix(C_INK2, C_SEPIA, 0.45) * (0.35 + 0.6 * lamp) * (0.6 + 0.4 * sqrt(max(0.0, 1.0 - bn * bn))), beam);
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  mask: { value: null }, mR: { value: new THREE.Vector4(0, 0, 1, 1) }, hasMask: { value: 0 },
  ws: { value: 6 }, ph: { value: 4 }, y0: { value: 150 },
  fell: { value: 400 }, band: { value: 30 }, shX: { value: -999 }, shDir: { value: 1 }, crossing: { value: 0 },
  reedY: { value: 470 }, slam: { value: 0 }, snap: { value: 1 }, t: { value: 0 },
  focus: { value: 1600 }, aperture: { value: 10 },
});

export default class Loom extends Scene {
  bg = shared('loom.bg', BG);
  /** 歌詞與小字（螢幕座標，前景）。 */
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 71 + (this.msg?.id ?? 0) * 13) >>> 0;
  mask: OrderMask | null = null;
  block: MsgBlock | null = null;
  ws = 6; ph = 4;
  /** 織的範圍（布面 y）：從 top 織到 bottom，一梭 band 高。 */
  top = 150; bottom = 700; band = 40;
  passes: number[] = [];
  cross = 0.25;
  lyr = { ...LYR_S, size: 52 };
  hasLyrics = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.layer.ctx;
    const gr = grid(au, s, e);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}${names}${INVITE}${song.title}${song.artist}——一位賓客`);

    let items;
    if (m) {
      const b = (this.block = msgBlock(c, m, FAM_W, MSG_BOX, { align: 'center', sigFamily: FAM_SIG, sigMin: 62, sigMax: 72, min: 52, max: 140, lineHeight: 1.24, maxLines: 5 }));
      this.ph = clamp(b.fit.size / 20, 3, 7);
      items = lineItems(b.lines, FAM_W, b.fit.size);
      const sg = b.sig;
      // 署名用灰白線織（R = 128），跟金線的留言分開
      items.push(...lineItems([{ text: sg.text, x: sg.x, y: sg.y }], FAM_SIG, sg.size, items.length).map((it) => ({ ...it, tag: 128 })));
      this.top = b.box[1] - 16;
      this.bottom = b.box[1] + b.box[3] + 22;
      this.lyr = { ...LYR_S, size: lyricSizeFor(b.fit.size) };
      this.avoid = [b.box];
    } else {
      // 沒有留言：織新人的名字（小一點、灰白線），歌詞在前景當主角
      const ft = fitText(c, names, FAM_W, NAME_BOX.w, NAME_BOX.h, { min: 60, max: 104, maxLines: 1 });
      c.font = font(FAM_W, ft.size);
      const w = c.measureText(names).width;
      const y = NAME_BOX.y + (NAME_BOX.h + ft.size * 0.8) / 2;
      items = lineItems([{ text: names, x: NAME_BOX.x + (NAME_BOX.w - w) / 2, y }], FAM_W, ft.size);
      this.ph = clamp(ft.size / 20, 3, 6);
      this.top = NAME_BOX.y;
      this.bottom = NAME_BOX.y + NAME_BOX.h;
      this.lyr = { ...LYR_B, size: 76 };
      this.avoid = [[NAME_BOX.x, NAME_BOX.y, NAME_BOX.w, NAME_BOX.h]];
    }
    this.ws = this.ph * 1.3;
    const [x0, y0, x1, y1] = items.reduce((r, it) => [Math.min(r[0]!, it.x), Math.min(r[1]!, it.y - it.size), Math.max(r[2]!, it.x + it.w), Math.max(r[3]!, it.y + it.size * 0.3)], [1e9, 1e9, -1e9, -1e9]);
    this.mask = this.track(orderMask(items, [x0! - 20, y0! - 20, x1! - x0! + 40, y1! - y0! + 40], MS, 'x'));

    // ---- 一梭一梭：一梭織半行字左右（至少 4 梭、最多 24 梭），從第一拍開始、在一小節半內（或窗格的一半）織完
    const H0 = this.bottom - this.top;
    const lh = m && this.block ? this.block.fit.lineHeight : H0;
    let n = clamp(Math.round(H0 / (lh * 0.5)), 4, 24);
    const maxDur = Math.min(gr.bar * 1.75, Math.max(gr.beat * 2, (e - gr.b0) * 0.55));
    let first = gr.b0;
    if (first - s < 0.22) first = au.timeOfBeat(au.beatAt(first) + 1);
    this.passes = stagger(au, first, n, maxDur);
    n = this.passes.length;
    this.band = H0 / n;
    const gap = n > 1 ? this.passes[1]! - this.passes[0]! : gr.beat;
    this.cross = clamp(gap * 0.62, 0.12, 0.3);
  }

  /** 到 t 為止打緊了幾梭。 */
  private done(t: number) { let k = 0; for (const p of this.passes) if (p <= t) k++; return k; }

  /** 鏡頭：從上方搖下來落定，跟著織口往下（每一梭推一點、緩進緩出），織完慢慢拉開看整塊布；最後半拍往下甩開。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const n = this.passes.length;
    const land = prog(t, s, s + 0.7, ease.outExpo);
    // 織口在布上的位置（每一梭在拍點跳一段，中間用緩動接起來）
    const k = this.done(t);
    const prev = k > 0 ? this.passes[k - 1]! : s;
    const frac = k < n ? ease.inOutCubic(clamp((t - prev) / Math.max(0.1, this.passes[k]! - prev))) : 0;
    const woven = clamp((k + frac) / n);
    const tEnd = this.passes[n - 1] ?? s;
    const settle = prog(t, tEnd, tEnd + 2.2, ease.inOutCubic);
    const exit = prog(t, e - 0.4, e, ease.inCubic);
    const side = hash(this.seed, 5) < 0.5 ? -1 : 1;
    const F0 = 1500;
    const focusY = lerp(this.top + 80, this.bottom - 40, woven);
    return {
      tx: 960 + side * 20 * (clamp((t - s) / (e - s)) - 0.5),
      ty: lerp(focusY - 120, (this.top + this.bottom) / 2 + 90, settle) + 70 * (1 - land) + 120 * exit,
      dist: F0 * (1.0 + 0.08 * settle - 0.04 * (1 - land)),
      pitch: 0.24 - 0.06 * settle + 0.08 * (1 - land),
      yaw: side * (0.2 - 0.07 * settle + 0.05 * (1 - land)),
      roll: side * 0.012 * (1 - land),
      level: 0.85,
      focal: F0,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    const n = this.passes.length, k = this.done(t);
    const fell = this.top + this.band * k;
    // 下一梭正在穿：拍點前 cross 秒內
    const next = k < n ? this.passes[k]! : Infinity;
    const cu = (t - (next - this.cross)) / this.cross;
    const crossing = cu >= 0 && cu < 1;
    const dir = k % 2 === 0 ? 1 : -1;
    const xa = -260, xb = W + 260;
    const shX = crossing ? (dir > 0 ? lerp(xa, xb, ease.inOutQuad(cu)) : lerp(xb, xa, ease.inOutQuad(cu))) : -9999;
    // 筘：平常停在織口下面 90；打緯時在拍點前一點點往上衝、打到織口，之後彈回來
    const last = k > 0 ? this.passes[k - 1]! : -Infinity;
    const back = prog(t, last, last + 0.32, ease.outCubic);
    const fwd = crossing ? prog(t, next - 0.07, next, ease.inQuad) : 0;
    const reedOff = 90 * (1 - fwd) * (k > 0 && t < last + 0.32 ? back : 1);
    u.mask!.value = this.mask?.tex ?? null;
    if (this.mask) (u.mR!.value as THREE.Vector4).set(...this.mask.rect);
    u.hasMask!.value = this.mask ? 1 : 0;
    u.ws!.value = this.ws; u.ph!.value = this.ph;
    // 緯線的格子從織的起點算（字模跟格子對齊）
    u.y0!.value = this.top;
    u.fell!.value = fell;
    u.band!.value = this.band;
    u.shX!.value = shX; u.shDir!.value = dir; u.crossing!.value = crossing ? 1 : 0;
    u.reedY!.value = fell + 8 + reedOff;
    u.slam!.value = k > 0 ? Math.exp(-(t - last) / 0.18) : 0;
    u.snap!.value = k > 0 ? prog(t, last, last + 0.12, ease.outCubic) : 1;
    u.t!.value = t;
    u.focus!.value = this.cam.toScreen(960, fell - 120).depth;
    this.bg.render(renderer, out);

    // ---- 前景：歌詞（逐字跟唱）與小字
    const L = this.layer; L.clear();
    const c = L.ctx;
    const k0 = prog(t, s, s + 0.35) * (1 - prog(t, e - 0.3, e));
    // 前景下緣壓暗一點，字才清楚（不加框）
    const gy = c.createLinearGradient(0, 760, 0, 1080);
    gy.addColorStop(0, rgba('ink', 0)); gy.addColorStop(0.6, rgba('ink', 0.55)); gy.addColorStop(1, rgba('ink', 0.7));
    c.fillStyle = gy; c.fillRect(0, 760, W, 320);
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: FAM_LYR, size: this.lyr.size, minSize: 48, maxW: this.lyr.w, maxRows: 2, align: 'left' as const };
      const lay = layoutRows(c, ly.line, st);
      c.save(); c.translate(this.lyr.x, this.lyr.y - (lay.rows.length - 1) * lay.lineHeight);
      drawRows(c, lay, FAM_LYR, t, darkInk(), ly.k * k0);
      c.restore();
    }
    if (!this.msg) {
      c.font = font(F.hei(500), this.hasLyrics ? 26 : 34); c.letterSpacing = '3px';
      c.fillStyle = rgba('ash', 0.85 * k0);
      c.fillText(INVITE, LYR_B.x, this.hasLyrics ? 1000 : 930);
      c.letterSpacing = '0px';
    }
    if (!this.hasLyrics) {
      const song = this.ctx.song;
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.6 * k0);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LYR_B.x, this.msg ? 960 : 870);
      c.letterSpacing = '0px';
    }
    if (this.msg?.couple) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.8 * k0);
      c.fillText('FROM THE COUPLE  ·  新人', LYR_S.x, 870);
      c.letterSpacing = '0px';
    }
    comp.draw(renderer, L.upload(), out);
    const avoid = this.avoid.map((r) => this.cam.screenRect(r, 10));
    avoid.push([this.lyr.x, this.lyr.y - 150, this.lyr.w, 190]);
    return { bloom: 0.6, vignette: 0.6, halation: 0.3, popupAvoid: avoid };
  }
}
