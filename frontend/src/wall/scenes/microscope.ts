// 顯微鏡（亮）：實驗課的觀察紀錄。右邊是一個圓形的顯微鏡視野（明視野：亮的底、染色的細胞），左邊是一張標本卡。
//  - 視野裡一開始只有一個圓圓的細胞。在小節線上它「分裂」：先變圓、拉長、中間收腰、一分為二，
//    分出來的兩個子細胞長成愛心的形狀（染色也從訊號色變成點綴色）。之後每隔幾個小節線再分一次（最多四代、十六顆心），
//    窗格長就分得慢一點、短就分得快一點，整個窗格都有事發生。
//  - 每次分裂前一刻鏡頭會「失焦一下再對回來」（像實驗的人轉微調旋鈕），大鼓時細胞輕輕脹一下。
//  - 標本卡：主打留言用手寫字一個字一個字寫上去（落在拍點上），下面是「採集者」（署名）與一本正經的染色、倍率。
//  - 歌詞是左上的「觀察紀錄」，逐字跟唱（亮版面：訊號色的暗部＋螢光筆）。
//  - 沒有留言：標本卡寫「待採集」與一行邀請。純音樂：觀察紀錄寫播放中的歌名。
// 畫法：紙（_t11 的共用紙）→ 視野（全螢幕 shader：細胞是圓與愛心的距離場，分裂中的一對用 smooth-min 黏在一起）
// → 標本卡的底圖畫一次（Canvas2D）→ 會動的字（Canvas2D）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash, noise1 } from '../engine/util';
import { lyricAt, beatAfter, fillWithHearts, DATE_DOTS } from './_motifs';
import { Paper, stagger, pad3, mono, tag, type Rect } from './_t11';
import { paperLyric, lyricLine, lyricRows } from './_t12';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { fitText } from '../engine/text';
import type { FitResult } from '../engine/text';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: true, energy: [0, 0.75], bars: [4, 12], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 視野：圓心與半徑。 */
// 視野縮小、靠右（底下的環停在 y ≈ 824，不進右下角 QR 的範圍）；標本卡放大，留言才夠大
// 標準 v2：視野是主視覺，放大（外環在 x = 1360 時 y ≈ 828，不進右下角 HUD）
const VC = { x: 1250, y: 450 }, VR = 360;
/** 標本卡與裡面放留言的框。 */
// 標本卡是輕的一張紙，放在畫面左側（寫字的範圍 ≤ 860×430）
const CARD = { x: 112, y: 440, w: 740, h: 440 };
/** 卡上寫留言的範圍：抬頭線以下、署名線以上（署名有自己的位置，不會被留言蓋到）。 */
const MSG_BOX = { x: 152, y: 532, w: 660, h: 236 };
const LYR = { x: 124, base: 214, w: 760, size: 52 };
const FAM_MSG = F.hand(700);
const INVITE = '掃描右下角 QR code，把你的祝福放上載玻片。';
const FOOT = '＊觀察結果：愛會分裂，而且越分越多。';
/** 每一代細胞的半徑（px）。 */
const RAD = [112, 88, 68, 52, 40];
const MAXC = 16;

const VIEW = () => {
  const p = new FSPass(/* glsl */ `
  uniform vec4 cells[${MAXC}]; uniform vec4 sibs[${MAXC}]; uniform float n;
  uniform vec2 vc; uniform float vr; uniform float blur; uniform float k; uniform float t; uniform vec2 drift;
  float dot2(vec2 v) { return dot(v, v); }
  // 愛心的距離場（Inigo Quilez，MIT）：尖端在原點、y 向上，高約 1.1
  float sdHeart(vec2 p) {
    p.x = abs(p.x);
    if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
    return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
  }
  // 一顆細胞：圓 → 愛心（面積差不多）
  float sdCell(vec2 p, vec2 c, float r, float h) {
    float dc = length(p - c) - r;
    if (h <= 0.001) return dc;
    float s = 1.87 * r;
    vec2 q = (p - c) / s; q.y = -q.y + 0.52;
    return mix(dc, sdHeart(q) * s, h);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float dv = length(p - vc) - vr;
    if (dv > 34.0) { fragColor = vec4(0.0); return; }
    // ---- 視野外圈：接目鏡的金屬環（版畫刻線）
    if (dv > 0.0) {
      vec2 dp = p - vc;
      float ang = atan(dp.y, dp.x);
      float ring = hatch((dp.x + dp.y) / 4.0, 0.5) * 0.45 + 0.4;
      float edge = pxLine(abs(dv - 33.0), 0.4, 1.2);
      float a = (1.0 - smoothstep(32.0, 34.0, dv)) * k;
      vec3 c = mix(C_SEPIA * 0.9, C_SEPIA * 0.55, ring * 0.5);
      c = mix(c, C_PAPER, edge * 0.2 + 0.1 * (0.5 + 0.5 * sin(ang * 2.0 - 0.8)));
      fragColor = vec4(c * a, a);
      return;
    }
    // ---- 明視野：亮的底，邊緣暗一點（光圈），淡淡的失焦雜質
    float rr = length(p - vc) / vr;
    vec3 bg = mix(C_PAPER, vec3(1.0), 0.45) * (1.0 - 0.18 * pow(rr, 3.0));
    vec2 pd = p - drift;
    bg *= 1.0 - 0.05 * smoothstep(0.2, 0.9, fbm(pd / 90.0, 3)) - 0.03 * smoothstep(0.5, 1.0, snoise(pd / 23.0));
    vec3 col = bg;
    // ---- 細胞
    float bw = 1.1 + 9.0 * blur;
    // 細胞膜不是完美的幾何形：用雜訊推一點點（慢慢蠕動）
    float wob = snoise(vec3(p / 26.0, t * 0.35)) * 2.2 + snoise(p / 9.0 + t * 0.2) * 0.7;
    float dMin = 1e5, hN = 0.0; vec2 cN = vec2(0.0); float rN = 1.0; float dn = 1e5;
    for (int i = 0; i < ${MAXC}; i++) {
      if (float(i) >= n) break;
      vec4 c = cells[i], s = sibs[i];
      float d = sdCell(p, c.xy, c.z, c.w);
      // 分裂中：跟兄弟黏在一起（smooth-min，k 越小越分開）
      if (s.w > 0.5) d = -log(exp(-d / s.w) + exp(-sdCell(p, s.xy, s.z, c.w) / s.w)) * s.w;
      if (d < dMin) { dMin = d; hN = c.w; cN = c.xy; rN = c.z; }
      // 每顆都有自己的細胞核（離中心一點點，愛心的核往上移到胸口）
      vec2 nc = c.xy + vec2(-0.1, -0.12 - 0.08 * c.w) * c.z;
      dn = min(dn, length(p - nc) - c.z * 0.29 + snoise(p / 7.0 + c.xy) * 1.2);
    }
    dMin += wob;
    float inside = 1.0 - smoothstep(-bw, bw, dMin);
    // 細胞質：染色（圓的是訊號色、愛心是點綴色），邊緣染得深一點，裡面有顆粒與幾個小液泡
    vec3 stain = mix(C_SIGNAL, C_ROSE, hN);
    float rim = smoothstep(-rN * 0.55, 0.0, dMin);
    vec2 pc = (p - cN) / 4.0 + cN * 0.013;
    float gran = smoothstep(0.45, 0.85, snoise(pc)) * 0.6 + smoothstep(0.6, 0.95, snoise(pc * 2.3 + 7.0)) * 0.4;
    vec2 vq = p / 22.0 + cN * 0.05;
    vec2 vcell = floor(vq), vf = fract(vq) - 0.5 - (hash22(vcell) - 0.5) * 0.5;
    float vac = (1.0 - smoothstep(0.1, 0.14, length(vf))) * step(0.72, hash12(vcell + 3.0));
    vec3 cyto = mix(bg, stain, 0.2 + 0.2 * rim + 0.12 * gran);
    cyto = mix(cyto, mix(bg, vec3(1.0), 0.5), vac * 0.7);
    cyto = mix(cyto, C_SEPIA, vac * (1.0 - smoothstep(0.1, 0.14, abs(length(vf) - 0.12))) * 0.0);
    col = mix(col, cyto, inside);
    // 細胞膜：深色細線＋外面一圈亮暈（相差顯微鏡的感覺）
    float mem = 1.0 - smoothstep(0.6 * (1.0 + 3.0 * blur), 1.6 + 6.0 * blur, abs(dMin + 1.0));
    col = mix(col, C_SEPIA, mem * (0.72 - 0.4 * blur));
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 10.0 + 10.0 * blur, dMin)) * step(0.0, dMin) * 0.18);
    // 細胞核：深色、染色質是斑點，核膜一圈細線
    float nuc = 1.0 - smoothstep(-bw, bw, dn);
    float chrom = 0.55 + 0.45 * smoothstep(0.1, 0.8, snoise(p / 3.2));
    col = mix(col, mix(C_BLOOD, C_SEPIA, 0.45), nuc * 0.5 * chrom * inside);
    col = mix(col, C_SEPIA, (1.0 - smoothstep(0.4, 1.4 + 5.0 * blur, abs(dn))) * 0.4 * inside);
    // ---- 失焦的雜質（不在焦平面上的小圓圈）
    vec2 dq = (p - drift * 1.6) / 70.0;
    vec2 dcell = floor(dq), df = fract(dq) - 0.5 - (hash22(dcell + 9.0) - 0.5) * 0.6;
    float dr = 0.05 + 0.08 * hash12(dcell + 1.0);
    float deb = (1.0 - smoothstep(0.0, 0.03, abs(length(df) - dr))) * step(0.86, hash12(dcell + 5.0)) * (1.0 - inside);
    col = mix(col, C_SEPIA, deb * 0.18);
    // ---- 活體樣本：幾隻桿菌在細胞之間慢慢游（沿著利薩茹曲線，身體朝游的方向、左右扭一點）
    for (int i = 0; i < 5; i++) {
      float fi = float(i), a = 0.12 + 0.05 * fi, b = 0.1 + 0.045 * fi;
      vec2 ph = vec2(t * a + fi * 1.7, t * b + fi * 2.9);
      vec2 bc = vc + drift + vr * 0.7 * vec2(sin(ph.x), cos(ph.y));
      vec2 vel = vec2(cos(ph.x) * a, -sin(ph.y) * b);
      vec2 dir = normalize(vel + 1e-5), nrm = vec2(-dir.y, dir.x);
      bc += nrm * sin(t * 7.0 + fi * 3.0) * 1.6;
      float d = sdSegment(p, bc - dir * (9.0 + 2.0 * fi), bc + dir * (9.0 + 2.0 * fi)) - 3.6;
      float body = 1.0 - smoothstep(-0.9 - 3.0 * blur, 0.9 + 3.0 * blur, d);
      col = mix(col, mix(C_SEPIA, C_BLOOD, 0.35), body * 0.28 * (1.0 - inside));
      col = mix(col, C_SEPIA, (1.0 - smoothstep(0.3, 1.2 + 3.0 * blur, abs(d))) * 0.35 * (1.0 - inside));
    }
    // ---- 目鏡裡的十字線（很淡）
    vec2 dp = p - vc;
    float cross = max(pxLine(abs(dp.x), 0.3, 1.0), pxLine(abs(dp.y), 0.3, 1.0));
    col = mix(col, C_SEPIA, cross * 0.22);
    // 刻度尺：水平線上每 15 px 一格、每 75 px 一大格
    float tx = abs(mod(dp.x + 7.5, 15.0) - 7.5);
    float major = step(abs(mod(dp.x + 37.5, 75.0) - 37.5), 1.0);
    float tk = pxLine(tx, 0.3, 1.0) * step(dp.y, 0.0) * step(-mix(9.0, 20.0, major), dp.y) * step(abs(dp.x), 226.0);
    col = mix(col, C_SEPIA, tk * 0.55);
    // 邊緣：一點點色差（藍紫往外、暖色往內）
    col = mix(col, C_SEPIA, smoothstep(-6.0, 0.0, dv) * 0.5);
    fragColor = vec4(col * k, k);
  }`, {
    cells: { value: Array.from({ length: MAXC }, () => new THREE.Vector4()) },
    sibs: { value: Array.from({ length: MAXC }, () => new THREE.Vector4()) },
    n: { value: 1 }, vc: { value: new THREE.Vector2(VC.x, VC.y) }, vr: { value: VR }, blur: { value: 0 }, k: { value: 1 }, t: { value: 0 },
    drift: { value: new THREE.Vector2() },
  }, { blending: THREE.CustomBlending, transparent: true });
  const m = p.mat;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return p;
};

type P2 = { x: number; y: number };
interface Glyph { ch: string; x: number; y: number; w: number; t: number }

export default class Microscope extends Scene {
  paper = shared('t11.paper', () => new Paper());
  view = shared('microscope.view', VIEW);
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  baseTex: THREE.Texture | null = null;
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 911 + (this.msg?.id ?? 0) * 131) >>> 0;
  /** 每一代細胞的位置（第 g 代有 2^g 顆；第 i 顆的孩子是 2i、2i+1）。 */
  gens: P2[][] = [];
  /** 分裂的時間（小節線）。 */
  divT: number[] = [];
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig = ''; sigT = Infinity; sigY = 0;
  tFirst = 0; beat = 0.5;
  lyricsInWindow = false;
  avoid: Rect[] = [];
  /** 歌詞字級：有留言時比留言小一截（一格只有一個焦點）。 */
  lyrSize: number = LYR.size;
  sigSize = 30;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = m ? (m.couple ? '採集者：新郎新娘' : `採集者：${m.name || '一位賓客'}`) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${INVITE}${FOOT}${song.title}${song.artist}標本待採集觀察紀錄染色玫瑰紅活體祝福樣本倍率代個細胞全部是愛心分裂中播放SPECIMEN No.（新人自備）：400× · 第 µm 觀察時播放`);
    const beat = this.beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));

    // ---- 分裂的時間：第一拍之後的小節線，窗格長就每隔幾小節分一次（最多四次），最後一小節不分（留時間看）
    const bars: number[] = [];
    for (let i = Math.ceil(au.barAt(this.tFirst) + 0.3); au.timeOfBar(i) < e - beat * 2.5; i++) bars.push(au.timeOfBar(i));
    const nDiv = Math.min(4, bars.length);
    const every = Math.max(1, Math.floor(bars.length / Math.max(1, nDiv)));
    this.divT = Array.from({ length: nDiv }, (_, i) => bars[i * every]!).filter((x) => x !== undefined);
    // 窗格太短（沒有小節線）：第一拍就分一次
    if (!this.divT.length && this.tFirst < e - beat * 1.5) this.divT = [this.tFirst];
    this.layoutGens();

    // ---- 標本卡上的留言：一個字一個字寫上去（兩小節或窗格的四成內寫完）
    const c = this.layer.ctx;
    const text = m ? m.text : INVITE;
    const fit = this.fit = m
      ? (fitClauses(c, text, FAM_MSG, MSG_BOX.w, MSG_BOX.h, { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.28, maxLines: 5 })
        ?? fitText(c, text, FAM_MSG, MSG_BOX.w, MSG_BOX.h, { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.28, maxLines: 5 }))
      : fitText(c, text, FAM_MSG, MSG_BOX.w, 140, { min: 40, max: 44, lineHeight: 1.3, maxLines: 2 });
    const top = MSG_BOX.y + (MSG_BOX.h - fit.height) / 2 + fit.size * 0.86;
    c.font = font(FAM_MSG, fit.size);
    const chars: Omit<Glyph, 't'>[] = [];
    fit.lines.forEach((ln, li) => {
      let x = MSG_BOX.x;
      for (const ch of Array.from(ln)) { const w = c.measureText(ch).width; chars.push({ ch, x, y: top + li * fit.lineHeight, w }); x += w; }
    });
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    const times = stagger(au, this.tFirst, chars.length, Math.min(2 * bar, 0.4 * (e - s)));
    this.glyphs = chars.map((g, i) => ({ ...g, t: times[i]! }));
    const tLast = times[times.length - 1] ?? this.tFirst;
    this.sigT = tLast + beat * 0.5;
    this.sigY = CARD.y + CARD.h - 70;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    this.drawBase();

    // ---- 即時小卡避開：標本卡、左上的歌詞
    const card: Rect = [CARD.x - 10, CARD.y - 10, CARD.w + 20, CARD.h + 20];
    this.lyrSize = lyricV2(m ? fit.size : null);
    this.sigSize = sigV2(fit.size);
    const rows = Math.max(1, lyricRows(c, lyrics.linesIn(s, e), paperLyric(this.lyrSize, LYR.w)));
    const lyr: Rect = [LYR.x - 12, LYR.base - this.lyrSize - 40, LYR.w + 24, this.lyrSize * (rows > 1 ? 2.35 : 1.25) + 52];
    this.avoid = [card, card, lyr, lyr];
  }

  /** 每一代的位置：孩子在父母兩側（分裂的方向跟上一次垂直，再加一點亂數），再推開到不重疊、不出視野。 */
  private layoutGens() {
    this.gens = [[{ x: VC.x, y: VC.y }]];
    const axes: number[] = [hash(this.seed, 1) * Math.PI];
    for (let g = 1; g <= this.divT.length; g++) {
      const prev = this.gens[g - 1]!, r = RAD[g]!;
      const cur: P2[] = [];
      const nextAxes: number[] = [];
      prev.forEach((p, i) => {
        const a = (axes[i] ?? 0) + (hash(this.seed, g, i) - 0.5) * 0.6;
        const d = r * 1.08;
        cur.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }, { x: p.x - Math.cos(a) * d, y: p.y - Math.sin(a) * d });
        nextAxes.push(a + Math.PI / 2, a + Math.PI / 2);
      });
      // 推開：兩兩至少隔 2.5r（變成愛心會寬一點），離視野邊至少 r + 28
      for (let it = 0; it < 60; it++) {
        for (let a = 0; a < cur.length; a++) for (let b = a + 1; b < cur.length; b++) {
          const A = cur[a]!, B = cur[b]!;
          const dx = B.x - A.x, dy = B.y - A.y, dl = Math.hypot(dx, dy) || 1e-3, want = r * 2.5;
          if (dl < want) { const k = (want - dl) * 0.5; A.x -= (dx / dl) * k; A.y -= (dy / dl) * k; B.x += (dx / dl) * k; B.y += (dy / dl) * k; }
        }
        for (const P of cur) {
          const dx = P.x - VC.x, dy = P.y - VC.y, dl = Math.hypot(dx, dy), lim = VR - r - 28;
          if (dl > lim) { P.x = VC.x + (dx / dl) * lim; P.y = VC.y + (dy / dl) * lim; }
        }
      }
      this.gens.push(cur);
      axes.splice(0, axes.length, ...nextAxes);
    }
  }

  /** t 時的細胞：位置、半徑、愛心程度，與分裂中黏著的兄弟（k = 黏的程度，0 = 已分開）。 */
  private cellsAt(t: number) {
    const b = this.beat;
    let g = 0;
    while (g < this.divT.length && t >= this.divT[g]!) g++;
    const out: { x: number; y: number; r: number; h: number; sib: number; k: number }[] = [];
    const tb = g > 0 ? this.divT[g - 1]! : -Infinity;
    const next = g < this.divT.length ? this.divT[g]! : Infinity;
    // 下一次分裂前半拍：變回圓的、脹大一點
    const pre = prog(t, next - b * 0.6, next, ease.inOutCubic);
    const split = ease.outExpo(clamp((t - tb) / (b * 0.8)));
    const heart = g === 0 ? 0 : ease.outBack(clamp((t - tb - b * 0.3) / (b * 0.8)));
    const cur = this.gens[g]!, par = g > 0 ? this.gens[g - 1]! : null;
    const r1 = RAD[g]!, r0 = g > 0 ? RAD[g - 1]! : r1;
    for (let i = 0; i < cur.length; i++) {
      const tgt = cur[i]!, pp = par ? par[i >> 1]! : tgt;
      const x = lerp(pp.x, tgt.x, split), y = lerp(pp.y, tgt.y, split);
      const r = lerp(r0 * 0.8, r1, split) * (1 + 0.1 * pre);
      out.push({ x, y, r, h: clamp(heart) * (1 - pre), sib: par ? i ^ 1 : -1, k: par ? r1 * 0.5 * (1 - split) : 0 });
    }
    return out;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.25) * (1 - prog(t, e - 0.3, e, ease.inCubic));
    this.paper.render(renderer, out, { k: 1 });

    // ---- 細胞（載物台慢慢漂、大鼓時脹一下）
    const cells = this.cellsAt(t);
    const dx = noise1(t * 0.25, this.seed % 97) * 10, dy = noise1(t * 0.25, (this.seed % 97) + 31) * 8;
    const kick = 1 + 0.035 * f.a.kick;
    const u = this.view.u;
    const cv = u.cells!.value as THREE.Vector4[], sv = u.sibs!.value as THREE.Vector4[];
    cells.forEach((cl, i) => {
      cv[i]!.set(cl.x + dx, cl.y + dy, cl.r * kick, cl.h);
      const sb = cl.sib >= 0 ? cells[cl.sib]! : cl;
      sv[i]!.set(sb.x + dx, sb.y + dy, sb.r * kick, cl.k > 0.5 ? cl.k : 0);
    });
    u.n!.value = cells.length;
    // 失焦：每次分裂前一拍轉一下微調旋鈕（糊掉），分裂那一刻一下子對回來
    let blur = 0;
    for (const td of this.divT) blur = Math.max(blur, prog(t, td - this.beat, td - this.beat * 0.25, ease.inCubic) * (1 - prog(t, td - this.beat * 0.1, td + this.beat * 0.25, ease.outExpo)));
    blur = Math.max(blur, 1 - prog(t, s, this.tFirst, ease.outCubic)); // 開場：從糊的對焦進來
    u.blur!.value = blur * 0.8; u.k!.value = vis; u.t!.value = t;
    (u.drift!.value as THREE.Vector2).set(dx, dy);
    this.view.render(renderer, out);

    // 底圖不會變：只在第一格上傳一次
    this.baseTex ??= this.base.upload();
    comp.draw(renderer, this.baseTex, out, { opacity: vis });
    // ---- 會動的字：歌詞、留言、署名、讀數
    const L = this.layer, c = L.ctx;
    L.clear();
    c.globalAlpha = vis;
    this.lyric(c, t);
    const fit = this.fit!;
    c.font = font(FAM_MSG, fit.size);
    for (const g of this.glyphs) {
      if (t < g.t) break;
      const k = clamp((t - g.t) / 0.14);
      const wet = 1 - clamp((t - g.t) / 0.8);
      c.save();
      if (k < 1) { c.beginPath(); c.rect(g.x - 4, g.y - fit.size, (g.w + 8) * k, fit.size * 1.4); c.clip(); }
      c.fillStyle = g.ch === '♥' ? rgba('rose') : this.msg ? mixRgba('sepia', 'blood', wet * 0.9) : rgba('sepia', 0.85);
      c.fillText(g.ch, g.x, g.y);
      c.restore();
    }
    const m = this.msg;
    if (m && t >= this.sigT) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.35);
      c.font = font(F.hand(400), this.sigSize); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'right';
      fillWithHearts(c, this.sig, CARD.x + CARD.w - 40, this.sigY);
      c.restore();
    }
    const g = cells.length;
    const gen = Math.round(Math.log2(g));
    // 讀數靠右對齊在 x = 1340：再右邊、再下面就是 QR 的範圍
    mono(c, `400×　第 ${gen} 代　${g} 個細胞`, 1340, VC.y + VR + 70, { size: 15, tracking: 2, color: rgba('sepia', 0.62), align: 'right' });
    comp.draw(renderer, L.upload(), out);
    // 鏡頭：整個窗格慢慢推近（像電影）
    return { paper: 1, bloom: 0.3, vignette: 0.25, grain: 0.04, zoom: 1 + 0.025 * ease.inOutCubic(f.p) + 0.003 * f.a.kick, popupAvoid: this.avoid };
  }

  /** 不會變的：標本卡（框、抬頭、欄位名稱）、刻度數字、註腳。 */
  private drawBase() {
    const c = this.base.ctx, m = this.msg;
    this.base.clear();
    // 標本卡：一張真的卡紙擺在桌上（柔和的影子、紙的纖維、一條膠帶貼住上緣），不是介面上的方框。
    // 只畫一次，斜的東西（膠帶）也只在這裡轉一次。
    c.save();
    c.shadowColor = rgba('sepia', 0.22); c.shadowBlur = 26; c.shadowOffsetY = 12;
    c.fillStyle = mixRgba('paper', 'bone', 0.55); c.fillRect(CARD.x, CARD.y, CARD.w, CARD.h);
    c.restore();
    for (let i = 0; i < 900; i++) {
      const x = CARD.x + hash(i, 11) * CARD.w, y = CARD.y + hash(i, 12) * CARD.h, a = hash(i, 13) * Math.PI, l = 3 + 9 * hash(i, 14);
      c.strokeStyle = rgba('sepia', 0.025 + 0.03 * hash(i, 15)); c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    }
    c.strokeStyle = rgba('sepia', 0.28); c.lineWidth = 1; c.strokeRect(CARD.x + 0.5, CARD.y + 0.5, CARD.w - 1, CARD.h - 1);
    c.save();
    c.translate(CARD.x + CARD.w / 2 + 30, CARD.y + 2); c.rotate(-0.035);
    c.fillStyle = mixRgba('paper', 'sepia', 0.12, 0.55); c.fillRect(-90, -16, 180, 32);
    c.restore();
    // 抬頭：印好的小字（標本編號）＋一條細線；底下是冷面的觀察結果（卡片的一部分，不另外放一群字）
    mono(c, `標本  No.${m ? pad3(m.n) : '———'}`, CARD.x + 40, CARD.y + 60, { size: 15, tracking: 3, color: rgba('sepia', 0.6) });
    c.fillStyle = rgba('sepia', 0.3); c.fillRect(CARD.x + 40, CARD.y + 74, CARD.w - 80, 1);
    c.fillStyle = rgba('sepia', 0.22); c.fillRect(CARD.x + 40, CARD.y + CARD.h - 104, CARD.w - 80, 1);
    tag(c, FOOT, CARD.x + 40, CARD.y + CARD.h - 34, { size: 16, color: rgba('sepia', 0.55), tracking: 1 });
    // 視野的刻度數字（每大格 = 10 µm）
    for (let i = -3; i <= 3; i++) mono(c, `${Math.abs(i) * 10}`, VC.x + i * 75, VC.y - 28, { size: 12, tracking: 0, color: rgba('sepia', 0.55), align: 'center' });
    mono(c, 'µm', VC.x + 244, VC.y - 6, { size: 12, tracking: 0, color: rgba('sepia', 0.55) });
  }

  /** 左上的歌詞（觀察時播放的歌）：逐字跟唱；純音樂寫歌名。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (!ly) {
      if (!this.lyricsInWindow) {
        tag(c, '觀察時播放', LYR.x, LYR.base - 66, { size: 18, color: rgba('sepia', 0.55) });
        c.font = font(F.archivo(100, 800), 56); c.fillStyle = rgba('sepia', 0.9); c.fillText(song.title, LYR.x, LYR.base);
      }
      return;
    }
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    c.save(); c.translate(LYR.x, LYR.base + (1 - inK) * 14);
    lyricLine(c, ly.line, t, paperLyric(this.lyrSize, LYR.w), ly.k * c.globalAlpha, true);
    c.restore();
  }
}
