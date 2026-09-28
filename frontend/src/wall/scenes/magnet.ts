// 磁力線（亮）：理化課本那張「條形磁鐵與鐵粉」的實驗，做成一張會動的圖版。
// 左邊一塊磁鐵（宣文）、右邊一塊（孟庭），N 對 S：異極相吸。紙上撒滿鐵粉（細細的短線），
//  - 一開始鐵粉亂撒；每個拍點「輕敲一下紙面」（大鼓時鐵粉跳一下），敲一次就更順著磁力線排好一點——
//    像真的做這個實驗時那樣，幾拍之後整張紙都是從 N 流到 S 的弧線。
//  - 每個小節線兩塊磁鐵往中間挪一步（outExpo：一下子滑過去、停住），磁力線跟著重新排列。
//  - 主打留言是鐵粉聚成的：留言的每個字由幾百根鐵粉組成，一個字一個字在拍點上被「吸」過來
//    （從紙上的散粉飛過去，剛到的是訊號色的暗部，像剛被磁化，一下子冷卻成墨色）。字裡的鐵粉也順著磁場方向排。
//  - 歌詞是上方的抬頭（逐字跟唱，亮版面：訊號色的暗部＋螢光筆）；左下是一本正經的讀數與註腳。
//  - 沒有留言：鐵粉聚成「宣文♥孟庭」，下面一行邀請。純音樂：抬頭寫本實驗的配樂（歌名）。
// 畫法：紙（_t11 的共用紙）→ 背景的鐵粉（全螢幕 shader，每個 9 px 的格子一根，方向由兩塊磁鐵的四個磁極算）
// → 組成字的鐵粉（LineBatch，一根一段）→ 磁鐵與文字（Canvas2D）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash, mulberry32, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, beatAfter, signature, fillWithHearts, COUPLE_ZH } from './_motifs';
import { Paper, stagger, pad3, mono, tag, type Rect } from './_t11';
import { paperLyric, lyricLine, lyricRows, glyphPoints, fitFew, lyricSizeFor, type GlyphPts } from './_t12';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: true, energy: [0.2, 0.85], bars: [4, 12], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 留言（鐵粉字）的範圍：兩塊磁鐵中間。 */
const TB = { x: 520, y: 330, w: 840, h: 440 };
const CX = TB.x + TB.w / 2;
/** 磁鐵：長、高、中線的 y；兩個相對的磁極（A 的 N、B 的 S）之間的距離從 GAP0 縮到 GAP1。 */
const MAG = { len: 250, h: 78, y: 550 };
const GAP0 = 1160, GAP1 = 1000;
const LYR = { x: 124, base: 212, w: 1190, size: 64 };
const FAM_MSG = F.ming(900);
const FAM_NONE = F.hei(900);
const INVITE = '掃描右下角 QR code，你的祝福也會被吸過來。';
const FOOT = '＊實驗步驟：輕敲紙面，鐵粉會自己排好。兩個人也是。';
/** 組成字的鐵粉飛過去要多久（秒）。 */
const FLY = 0.42;

/**
 * 四個磁極（x, y, 磁荷）的磁場（跟 shader 同一條式子）。用「二維」的點磁荷（1/r）：它的流函數 ψ = Σ q·θ
 * 剛好就是磁力線（ψ 等值線），shader 才能把鐵粉排成一條一條的鏈，像真的實驗照片。
 */
function field(poles: number[], x: number, y: number): [number, number] {
  let bx = 0, by = 0;
  for (let i = 0; i < 12; i += 3) {
    const dx = x - poles[i]!, dy = y - poles[i + 1]!;
    const k = poles[i + 2]! / (dx * dx + dy * dy + 300);
    bx += dx * k; by += dy * k;
  }
  return [bx, by];
}

/** 鐵粉的格子：8 px 一格、一格一根。先在一張 240×135 的小貼圖上把每一根算好（位置、方向、長度），
 * 畫的時候每個像素只要讀周圍九格——磁場與流函數（四個 atan）每根只算一次，會場的內顯才跑得動。 */
const CS = 8, NX = W / CS, NY = Math.ceil(H / CS);

const CELLS = () => new FSPass(/* glsl */ `
  uniform vec3 P[4]; uniform float align; uniform float kick; uniform float tap;
  uniform vec4 calm; uniform vec4 calm2; uniform vec4 calm3;
  // 一個磁極發出幾條磁力線（鐵粉鏈）
  const float NL = 22.0;
  const float CS = ${CS}.0;
  float inRect(vec2 p, vec4 r, float fe) { vec2 q = max(r.xy - p, p - r.zw); return 1.0 - smoothstep(0.0, fe, max(q.x, q.y)); }
  void main() {
    // 這一格（y 向下，第 0 列在最上面）
    vec2 c = vec2(floor(gl_FragCoord.x), ${NY - 1}.0 - floor(gl_FragCoord.y));
    vec2 o0 = (c + 0.5) * CS;
    vec2 o = o0 + (hash22(c + 17.0) - 0.5) * 0.7 * CS;
    vec2 B = vec2(0.0); float psi = 0.0;
    for (int i = 0; i < 4; i++) { vec2 d = o - P[i].xy; B += P[i].z * d / (dot(d, d) + 300.0); psi += P[i].z * atan(d.y, d.x); }
    float s = length(B);
    // 離最近的一條磁力線多遠（流函數的差 ÷ 梯度大小 = 像素）：對齊之後鐵粉往線上靠、線跟線之間變稀
    float per = TAU / NL;
    float dpsi = psi - per * floor(psi / per + 0.5);
    vec2 g = vec2(-B.y, B.x);
    vec2 shift = -g * dpsi / max(dot(g, g), 1e-12);
    float near = 1.0 - smoothstep(0.0, 1.0, abs(dpsi) / (per * 0.5));
    o += shift * min(1.0, CS * 0.45 / max(length(shift), 1e-5)) * align * 0.9;
    // 敲一下紙：每一拍（tap）重新擲一次跳的方向，跳的幅度跟著大鼓衰減
    o += (hash22(c + tap * 7.31) - 0.5) * 7.0 * kick;
    float str = sat(log(s * 900.0 + 1.0) / 3.2);
    // 磁極附近比較密；排好之後集中在磁力線上。留言、歌詞、註腳底下讓出來（鐵粉都被吸去排字了）
    // MV 融合原則：背景要能呼吸——遠離磁鐵的地方很稀，只有磁極附近與磁力線上比較密
    float dens = (0.05 + 0.62 * str * str) * mix(1.0, 0.12 + 1.5 * near * near, align * 0.9);
    dens *= 1.0 - 0.85 * max(max(inRect(o, calm, 36.0), inRect(o, calm2, 24.0)), inRect(o, calm3, 20.0));
    if (hash12(c + 3.1) > dens) { fragColor = vec4(0.0); return; }
    vec2 fd = B / max(s, 1e-12);
    float ra = hash12(c + 9.7) * PI;
    vec2 rd = vec2(cos(ra), sin(ra));
    if (dot(fd, rd) < 0.0) fd = -fd;           // 鐵粉沒有頭尾：挑離亂擺方向近的那一頭，才不會整根翻過來
    vec2 dir = normalize(mix(rd, fd, align) + 1e-4);
    dir = rot2((hash12(c + tap * 3.1 + 5.0) - 0.5) * 1.3 * kick) * dir;
    float L = CS * (0.55 + 0.6 * hash12(c + 1.3)) * (0.8 + 0.3 * str);
    // 存：中心相對格子中心的位移、半根的向量（長度 0 = 這格沒有鐵粉）
    fragColor = vec4(o - o0, dir * L * 0.5);
  }`, {
  P: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  align: { value: 0 }, kick: { value: 0 }, tap: { value: 0 },
  calm: { value: new THREE.Vector4() }, calm2: { value: new THREE.Vector4() }, calm3: { value: new THREE.Vector4() },
});

const FILINGS = () => {
  const p = new FSPass(/* glsl */ `
  uniform sampler2D cells; uniform float k;
  const float CS = ${CS}.0;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 cell = floor(p / CS);
    float a = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      if (c.x < 0.0 || c.y < 0.0 || c.x > ${NX - 1}.0 || c.y > ${NY - 1}.0) continue;
      vec4 q = texelFetch(cells, ivec2(int(c.x), ${NY - 1} - int(c.y)), 0);
      if (dot(q.zw, q.zw) < 0.01) continue;
      vec2 o = (c + 0.5) * CS + q.xy;
      float d = sdSegment(p, o - q.zw, o + q.zw);
      float w = 0.5 + 0.35 * hash12(c + 2.2);
      float cov = 1.0 - smoothstep(w - 0.55, w + 0.55, d);
      a = max(a, cov * (0.3 + 0.32 * hash12(c + 4.4)));
    }
    a *= k;
    fragColor = vec4(C_SEPIA * a, a);
  }`, { cells: { value: null }, k: { value: 1 } }, { blending: THREE.CustomBlending, transparent: true });
  // 預乘的「蓋上去」：鐵粉是紙上的墨
  const m = p.mat;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return p;
};

export default class Magnet extends Scene {
  paper = shared('t11.paper', () => new Paper());
  fil = shared('magnet.filings', FILINGS);
  cellPass = shared('magnet.cells', CELLS);
  cellRT = this.track(makeRT(NX, NY, { pxScale: 1, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dust = this.track(new LineBatch(16000, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 733 + (this.msg?.id ?? 0) * 97) >>> 0;
  fit: FitResult | null = null;
  fam = FAM_MSG;
  pts: GlyphPts | null = null;
  /** 每根鐵粉：散落的位置、飛行的弧度、亂擺的角度、長度。 */
  sx = new Float32Array(0); sy = new Float32Array(0); arc = new Float32Array(0); ra = new Float32Array(0); len = new Float32Array(0);
  /** 敲紙時跳的方向（兩組）、排好之後角度的小抖動；字是不是愛心（鐵粉用點綴色）。 */
  hx = new Float32Array(0); hy = new Float32Array(0); jit = new Float32Array(0); heart = new Uint8Array(0);
  /** 每個字被吸過來的時間。 */
  tArr: number[] = [];
  tFirst = 0; bar0 = 0; nBars = 1;
  sig = ''; sigT = Infinity; sigX = 0; sigY = 0;
  lyricsInWindow = false;
  avoid: Rect[] = [];
  lyrRect: Rect = [0, 0, 0, 0];
  /** 歌詞字級：有留言時比鐵粉字小一截（一格只有一個焦點）。 */
  lyrSize = LYR.size;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, '♥');
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${text}${this.sig}${INVITE}${FOOT}${song.title}${song.artist}宣文孟庭磁力線觀察本實驗配樂對齊度異極相吸FIG. 7　兩塊條形磁鐵之間的磁力線 MAGNETIC FIELD · N → S No. mm %`);
    const c = this.layer.ctx;
    this.fam = m ? FAM_MSG : FAM_NONE;
    // 鐵粉字要夠大才讀得出來：最小 58 px
    const boxH = m ? TB.h - 70 : TB.h - 150;
    const fit = this.fit = fitFew(c, text, this.fam, TB.w, boxH, { min: 58, max: m ? 128 : 150, lineHeight: 1.3, maxLines: 5 });
    const top = TB.y + (boxH - fit.height) / 2 + fit.size * 0.86 + (m ? 0 : 20);
    const step = clamp(fit.size / 30, 2.4, 4.2);
    const pts = this.pts = glyphPoints(fit.lines, this.fam, fit.size, CX, top, fit.lineHeight, step, 'center', this.seed);
    // ---- 每根鐵粉散落的位置（兩塊磁鐵中間、歌詞下面的紙上）、飛行弧度、亂擺角度、長度
    const n = pts.n, rnd = mulberry32(this.seed);
    this.sx = new Float32Array(n); this.sy = new Float32Array(n); this.arc = new Float32Array(n); this.ra = new Float32Array(n); this.len = new Float32Array(n);
    this.hx = new Float32Array(n); this.hy = new Float32Array(n); this.jit = new Float32Array(n);
    this.heart = Uint8Array.from(pts.glyphs, (g) => (g.ch === '♥' ? 1 : 0));
    const Ld = clamp(fit.size * 0.085, 4.5, 8.5);
    // 散粉：以字的中心為中心的一團（常態分布，邊緣自然變稀，不會看到方框）
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(TAU * rnd());
    for (let i = 0; i < n; i++) {
      // 超出範圍就重擲（夾在邊上會在邊界堆成一條看得見的線）
      let x = 0, y = 0;
      do { x = CX + gauss() * 300; y = TB.y + TB.h / 2 + gauss() * 190; } while (x < 470 || x > 1410 || y < 300 || y > 900);
      this.sx[i] = x; this.sy[i] = y;
      this.arc[i] = (rnd() - 0.5) * 120;
      this.ra[i] = rnd() * Math.PI;
      this.len[i] = Ld * (0.7 + 0.6 * rnd());
      this.hx[i] = rnd() - 0.5; this.hy[i] = rnd() - 0.5;
      this.jit[i] = (rnd() - 0.5) * 0.3;
    }
    // ---- 時間：第一拍開始敲紙；第二拍起一個字一個字吸過來（兩小節或窗格的四成內吸完）
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    this.bar0 = au.barAt(this.tFirst);
    this.nBars = Math.max(1, Math.floor(au.barAt(e) - this.bar0));
    const bar = au.timeOfBar(this.bar0 + 1) - this.tFirst;
    this.tArr = stagger(au, this.tFirst + beat, pts.glyphs.length, Math.min(2 * bar, 0.4 * (e - s)));
    const tLast = this.tArr[this.tArr.length - 1] ?? this.tFirst;
    this.sigT = tLast + beat;
    c.font = font(this.fam, fit.size);
    const wMax = Math.max(...fit.lines.map((l) => c.measureText(l).width));
    this.sigX = CX + wMax / 2;
    this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + 58;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;

    // ---- 即時小卡避開：鐵粉字（含署名／邀請）與上方的歌詞
    const msgTop = top - fit.size * 0.95;
    const msgR: Rect = [Math.round(CX - wMax / 2 - 24), Math.round(msgTop - 16), Math.round(wMax + 48), Math.round(this.sigY + (m ? 20 : 70) - msgTop + 16)];
    this.lyrSize = lyricSizeFor(m ? fit.size : null);
    const rows = Math.max(1, lyricRows(c, lyrics.linesIn(s, e), paperLyric(this.lyrSize, LYR.w)));
    this.lyrRect = [LYR.x - 12, LYR.base - this.lyrSize - 14, LYR.w + 24, this.lyrSize * (rows > 1 ? 2.35 : 1.25) + 26];
    this.avoid = [msgR, msgR, this.lyrRect, this.lyrRect];
  }

  /** 兩塊磁鐵相對那兩極的距離：第一拍前滑進來，之後每個小節線往中間挪一步。 */
  private gap(t: number) {
    const au = this.ctx.audio;
    const slide = ease.outExpo(prog(t, this.ctx.start, this.tFirst + 0.05));
    // 第一拍之後的小節線才挪：已經過了幾條（最近那一條還在滑）
    const b1 = Math.ceil(this.bar0 + 0.01), cur = Math.floor(au.barAt(t) + 1e-6);
    const steps = cur < b1 ? 0 : cur - b1 + ease.outExpo(clamp((t - au.timeOfBar(cur)) / 0.4));
    const k = clamp(steps / Math.max(1, this.nBars));
    return lerp(GAP0, GAP1, k) + (1 - slide) * 720;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.25) * (1 - prog(t, e - 0.3, e, ease.inCubic));
    this.paper.render(renderer, out, { k: 1 });

    // ---- 磁極：A = [S | N]（左），B = [S | N]（右）；A 的 N 對著 B 的 S
    const g = this.gap(t);
    const aN = CX - g / 2, bS = CX + g / 2;
    const inset = 26;
    const poles = [aN - inset, MAG.y, 1, aN - MAG.len + inset, MAG.y, -1, bS + inset, MAG.y, -1, bS + MAG.len - inset, MAG.y, 1];
    // 對齊度：每一拍敲一下，越敲越整齊（拍點上一下子排過去）
    const bt = au.beatAt(t) - au.beatAt(this.tFirst);
    const taps = bt < 0 ? 0 : Math.floor(bt) + ease.outExpo(clamp((bt - Math.floor(bt)) / 0.5));
    const align = 1 - Math.pow(0.5, taps + (t >= this.tFirst ? 0.35 : 0));
    const kick = bt < 0 ? 0 : f.a.kick;
    const u = this.cellPass.u;
    (u.P!.value as THREE.Vector3[]).forEach((v, i) => v.set(poles[i * 3]!, poles[i * 3 + 1]!, poles[i * 3 + 2]!));
    u.align!.value = align; u.kick!.value = kick; u.tap!.value = Math.floor(Math.max(0, bt));
    const fit = this.fit!, pts = this.pts!;
    const mr = this.avoid[0]!;
    (u.calm!.value as THREE.Vector4).set(mr[0] + 20, mr[1] + 10, mr[0] + mr[2] - 20, mr[1] + mr[3] - 10);
    const lr = this.lyrRect;
    // 歌詞連同上面的圖號一起讓出來；左下的讀數與註腳也是
    (u.calm2!.value as THREE.Vector4).set(lr[0], lr[1], lr[0] + lr[2], lr[1] + lr[3] - 6);
    (u.calm3!.value as THREE.Vector4).set(LYR.x - 10, 960, LYR.x + 620, 996);
    this.cellPass.render(renderer, this.cellRT);
    this.fil.u.cells!.value = this.cellRT.texture;
    this.fil.u.k!.value = vis;
    this.fil.render(renderer, out);

    // ---- 組成字的鐵粉
    const lb = this.dust;
    lb.clear();
    const sep = LIN.sepia, bl = LIN.blood, rose = LIN.rose;
    const tapI = Math.floor(Math.max(0, bt));
    // 每一拍換一組跳的方向（兩組輪流就夠了，看起來每拍都不一樣）
    const hx = tapI % 2 ? this.hx : this.hy, hy = tapI % 2 ? this.hy : this.hx;
    const P = poles, hop = 7 * kick;
    const settled = sep, cool: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < pts.n; i++) {
      const gi = pts.g[i]!, ta = this.tArr[gi]!;
      const heart = this.heart[gi] === 1;
      let x: number, y: number, fx: number, fy: number, col = heart ? rose : settled, al: number, w: number;
      if (t < ta) {
        // 還沒被吸過來：散在紙上、跟著敲紙跳、跟著對齊度慢慢順著磁場
        x = this.sx[i]! + hx[i]! * hop;
        y = this.sy[i]! + hy[i]! * hop;
        w = align;
        al = 0.34 * vis;
      } else {
        const u = clamp((t - ta) / FLY), q = ease.outExpo(u), qa = Math.sin(Math.PI * u);
        const dx = pts.x[i]! - this.sx[i]!, dy = pts.y[i]! - this.sy[i]!, dl = Math.hypot(dx, dy) || 1;
        x = this.sx[i]! + dx * q - (dy / dl) * this.arc[i]! * qa;
        y = this.sy[i]! + dy * q + (dx / dl) * this.arc[i]! * qa;
        w = Math.max(align, q);
        // 剛到的鐵粉是「磁化」的暗訊號色，0.6 秒冷卻成墨色
        const heat = 1 - clamp((t - ta - FLY * 0.5) / 0.6);
        if (heat > 0) {
          cool[0] = lerp(col[0], bl[0], heat); cool[1] = lerp(col[1], bl[1], heat); cool[2] = lerp(col[2], bl[2], heat);
          col = [cool[0], cool[1], cool[2]];
        }
        al = (0.4 + 0.52 * q) * vis;
      }
      // 這一點的磁場方向（跟 field() 同一條式子，攤開寫省掉每根配一個陣列）
      fx = 0; fy = 0;
      for (let k = 0; k < 12; k += 3) {
        const ex = x - P[k]!, ey = y - P[k + 1]!, kk = P[k + 2]! / (ex * ex + ey * ey + 300);
        fx += ex * kk; fy += ey * kk;
      }
      const r = this.ra[i]!;
      // 沒有頭尾：挑離亂擺角度近的那一頭，照對齊度轉過去
      const ang = r + halfWrap(Math.atan2(fy, fx) + this.jit[i]! - r) * w;
      const L = this.len[i]! * 0.5, cx = Math.cos(ang) * L, sy2 = Math.sin(ang) * L;
      lb.seg2(x - cx, y - sy2, x + cx, y + sy2, 1.45, col, al);
    }

    // ---- Canvas2D：磁鐵、歌詞、署名、讀數
    const L = this.layer, c = L.ctx;
    L.clear();
    c.globalAlpha = vis;
    this.drawMagnet(c, aN - MAG.len, '宣文', t);
    this.drawMagnet(c, bS, '孟庭', t);
    this.lyric(c, t);
    const m = this.msg;
    if (m && t >= this.sigT) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.35);
      c.font = font(F.hand(400), 40); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'right';
      fillWithHearts(c, this.sig, this.sigX, this.sigY);
      c.restore();
    }
    if (!m) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.4);
      c.font = font(F.hand(700), 44); c.fillStyle = rgba('sepia', 0.9); c.textAlign = 'center';
      c.fillText(INVITE, CX, this.sigY + 30);
      c.restore();
    }
    // 配角的字只留一行（MV 融合原則：小字最多兩三小群）
    tag(c, FOOT, LYR.x, 984, { size: 17, color: rgba('sepia', 0.55), tracking: 1 });
    lb.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    void fit; void TAU;
    // 鏡頭：整個窗格慢慢推近一點（像電影），大鼓時再輕輕頂一下
    return { paper: 1, bloom: 0.3, vignette: 0.25, grain: 0.04, zoom: 1 + 0.028 * ease.inOutCubic(f.p) + 0.004 * kick, popupAvoid: this.avoid };
  }

  /** 一塊條形磁鐵：左半 S（墨色）、右半 N（訊號色），下面標名字；大鼓時整塊輕輕震一下。 */
  private drawMagnet(c: CanvasRenderingContext2D, x: number, name: string, t: number) {
    const y = MAG.y - MAG.h / 2, w = MAG.len, h = MAG.h;
    const jig = (hash(Math.floor(this.ctx.audio.beatAt(t)), name.length) - 0.5) * 2 * this.ctx.audio.hit('kick', t, 0.06);
    c.save();
    c.translate(jig, 0);
    // 影子
    c.fillStyle = rgba('sepia', 0.1);
    rr(c, x + 7, y + 9, w, h, 7); c.fill();
    // 兩半
    c.save(); rr(c, x, y, w, h, 7); c.clip();
    c.fillStyle = rgba('sepia'); c.fillRect(x, y, w / 2, h);
    c.fillStyle = rgba('signal'); c.fillRect(x + w / 2, y, w / 2, h);
    // 上緣的反光（細線）
    c.fillStyle = rgba('paper', 0.28); c.fillRect(x, y + 6, w, 2);
    c.restore();
    c.strokeStyle = rgba('sepia'); c.lineWidth = 2; rr(c, x, y, w, h, 7); c.stroke();
    c.font = font(F.archivo(100, 900), 36); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = rgba('paper'); c.fillText('S', x + w / 4, y + h / 2 + 2);
    c.fillStyle = rgba('sepia'); c.fillText('N', x + (3 * w) / 4, y + h / 2 + 2);
    c.textBaseline = 'alphabetic';
    c.font = font(F.hei(500), 22); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.7);
    c.fillText(name, x + w / 2, y + h + 44);
    c.letterSpacing = '0px';
    c.restore();
  }

  /** 上方的抬頭：歌詞逐字跟唱；純音樂寫配樂的歌名。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (!ly) {
      if (!this.lyricsInWindow) {
        c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.6); c.fillText('本實驗配樂', LYR.x, LYR.base - 64);
        c.font = font(F.archivo(100, 800), 58); c.fillStyle = rgba('sepia', 0.9); c.fillText(song.title, LYR.x, LYR.base);
      }
      return;
    }
    const st = paperLyric(this.lyrSize, LYR.w);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    c.save(); c.translate(LYR.x, LYR.base + (1 - inK) * 14);
    lyricLine(c, ly.line, t, st, ly.k * c.globalAlpha, true);
    c.restore();
  }
}

/** 角度差折到 [-π/2, π/2]：鐵粉轉 180° 看起來一樣，永遠走近的那一邊。 */
const halfWrap = (d: number) => d - Math.PI * Math.round(d / Math.PI);

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
