// 音樂盒（批次 T10・機器 D，亮）：打開的音樂盒，從上面往下看機芯：一支黃銅滾筒、上方一排鋼製簧片（音梳），盒子裡襯著印花紙。
//  - 滾筒上的凸點排成主打留言的字（點陣字）：滾筒慢慢往上轉，一行字從下面轉上來、在正中間最好讀，再轉到上面被音梳撥響。
//    轉速綁在拍子上：一拍轉四排凸點，所以每一個凸點都剛好在十六分音符上撥到簧片——整行字就是一段旋律，字的筆畫由上往下被「彈」出來。
//  - 左邊的低音區：粗的簧片，每一拍、每個小節線各有凸點，撥下去就是那一拍。
//  - 被撥到的簧片尖端亮一下（訊號色），右邊的調速風扇一直轉。
//  - 最上面是「正在演奏」：這一行歌詞（逐字跟唱）。最下面是曲目卡：完整的主打留言（一個詞組一拍印上去）與署名；
//    沒有留言：滾筒上是「宣文♥孟庭」，曲目卡寫邀請。純音樂：正在演奏寫歌名。
// 手法：滾筒、凸點、底板、襯紙是一個 shader——留言先畫成一張點陣圖（每個像素一顆凸點），shader 用 texelFetch 讀（不會有 mip 的問題）；
// 音梳與風扇是 LineBatch；字在兩張 Canvas（不會變的一張、每格重畫的一張）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, lerp, TAU } from '../engine/util';
import { wrap, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, layoutMessage, signature, beatAfter, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { drawReveal, phraseSchedule, revealAt, fitCharsF, windowLines, type Rect } from './_t10';
import { pad3 } from './_t11';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: true, energy: [0, 0.7], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素，y 向下）
// 正在演奏（歌詞）：比曲目卡上的留言小一級（MV 原則：焦點是留言）
const LYR = { x: 140, y: 100, w: 1200, base: 200 }; // 字級照標準 v2（lyricV2）
// 機芯的底板：標準 v2 要場景當主角，機芯拉寬到畫面右邊（右下角 QR 上面）；曲目卡變小放左下
const PLATE = { x0: 128, x1: 1800, y0: 244, y1: 704 };
const COMB = { y0: 250, y1: 304 }; // 音梳的底座
const CYL = { x0: 170, x1: 1690, cy: 522, R: 150 }; // 滾筒
const TH_C = -0.7; // 音梳撥到凸點的地方（滾筒上的角度，負的 = 上面）
const PITCH = 3.4; // 凸點的間距（px）
const TX0 = 262, TX1 = 1664; // 留言凸點的範圍
const TCOLS = Math.floor((TX1 - TX0) / PITCH);
const GLYPH = 20; // 一個字 20×20 顆凸點（畫面上約 68 px）
const LINE_ROWS = 32; // 一行字佔幾排（字 20 排＋行距 12 排）
const BASS = [{ x: 190, every: 4, off: 0 }, { x: 208, every: 16, off: 0 }, { x: 226, every: 4, off: 2 }, { x: 244, every: 16, off: 8 }];
// 曲目卡（一張薄紙卡斜斜地擺在盒子裡，左下）：標準 v2，寬 ≤ 860，照字的大小裁
const CARD = { x: 120, y: 722, maxW: 860, maxH: 250, padX: 40, padT: 22, padB: 16 };
const CARD_ROT = -0.008;
/** 曲目卡的座標系（卡的中心轉一點點）：底圖與字都用同一個。 */
const cardXform = (c: CanvasRenderingContext2D, w: number, h: number) => { const cx = CARD.x + w / 2, cy = CARD.y + h / 2; c.translate(cx, cy); c.rotate(CARD_ROT); c.translate(-cx, -cy); };
const FAN = { x: 1748, y: 520 }; // 調速風扇

const INVITE = '這一盒還沒有曲子：掃描右下角 QR code，把你的祝福做成音樂盒。';
const TEXT = `正在演奏曲目本盒演奏純音樂${INVITE}${COUPLE_ZH}一位賓客新郎新娘`;

// ---------------------------------------------------------------- 襯紙、底板、滾筒、凸點（一個 shader）
const BOX = () => new FSPass(/* glsl */ `
  uniform highp usampler2D pins;   // 點陣（R8UI）：1 = 有凸點
  uniform int rows;                // 點陣的排數（一整輪）
  uniform int cols;
  uniform float sigma0;            // 滾筒轉到哪（排）：4 ×（拍 − 起點拍）
  uniform float T0;                // 第一行字從第幾排開始
  uniform float k;
  float pinAt(int c, int r) {
    if (c < 0 || c >= cols) return 0.0;
    int rr = ((r % rows) + rows) % rows;
    return float(texelFetch(pins, ivec2(c, rr), 0).r);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // ---- 盒子裡的印花襯紙：很淡的斜格紋＋小點
    vec2 q = rot2(0.785) * p / 46.0;
    vec2 f = abs(fract(q) - 0.5);
    float lattice = 1.0 - smoothstep(0.02, 0.06, min(f.x, f.y));
    float dotm = 1.0 - smoothstep(0.08, 0.13, length(fract(q + 0.5) - 0.5));
    vec3 col = C_PAPER * (0.95 + 0.04 * fbm(p / 260.0, 3));
    col = mix(col, C_BLOOD, (0.05 * lattice + 0.07 * dotm));
    // ---- 底板（黃銅，磨砂）
    vec2 pc = vec2(${(PLATE.x0 + PLATE.x1) / 2}.0, ${(PLATE.y0 + PLATE.y1) / 2}.0), ph = vec2(${(PLATE.x1 - PLATE.x0) / 2}.0, ${(PLATE.y1 - PLATE.y0) / 2}.0);
    float dP = sdBox(p - pc, ph - 10.0) - 10.0;
    col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 26.0, sdBox(p - pc - vec2(8.0, 12.0), ph - 10.0) - 10.0));
    if (dP < 0.0) {
      vec3 brass = mix(C_BLOOD, C_SIGNAL, 0.35) * 0.62 + C_PAPER * 0.18;
      brass = mix(vec3(luma(brass)), brass, 0.5);
      col = brass * (0.9 + 0.1 * snoise(vec2(p.x * 0.8, p.y * 0.02)) + 0.06 * fbm(p / 90.0, 2));
      col += C_BONE * 0.12 * (1.0 - smoothstep(0.0, 4.0, -dP)) * step(p.y, pc.y);
      col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 4.0, -dP)) * step(pc.y, p.y);
    }
    // ---- 滾筒
    float cy = ${CYL.cy}.0, R = ${CYL.R}.0;
    float yy = (p.y - cy) / R;
    if (p.x > ${CYL.x0}.0 && p.x < ${CYL.x1}.0 && abs(yy) < 1.0) {
      float th = asin(yy);
      vec3 n = vec3(0.0, yy, cos(th));
      vec3 L = normalize(vec3(-0.35, -0.55, 0.76));
      float dif = max(dot(n, L), 0.0);
      float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
      // 黃銅：用訊號色一家子，但去掉一半彩度、壓暗一點（玫瑰、薰衣草主題才不會像塑膠管，凸點的字也比較清楚）
      vec3 brass = mix(C_BLOOD, C_SIGNAL, 0.55) * 0.9 + C_PAPER * 0.08;
      brass = mix(vec3(luma(brass)), brass, 0.55) * 0.82;
      // 車床的細紋（沿著圓周）
      float lathe = 0.94 + 0.06 * snoise(vec2(p.x * 0.9, 3.0));
      vec3 cyl = brass * lathe * (0.28 + 0.85 * dif) + C_BONE * 0.45 * spec;
      // 凸點：σ = 滾筒表面的排座標（弧長 / 間距），跟著拍子往上轉
      float sigma = R * th / ${PITCH} + sigma0 - R * (${TH_C}) / ${PITCH};
      float cellY = floor(sigma + 0.5), ly = sigma - cellY;
      float pin = 0.0; vec2 lp = vec2(0.0);
      if (p.x >= ${TX0}.0 && p.x < ${TX1}.0) {
        float u = (p.x - ${TX0}.0) / ${PITCH};
        float cellX = floor(u);
        lp = vec2(u - cellX - 0.5, ly);
        pin = pinAt(int(cellX), int(cellY - T0));
      } else {
        // 低音區：粗一點的凸點，每一拍／小節線
        ${BASS.map((b, i) => `if (abs(p.x - ${b.x}.0) < 6.0) { lp = vec2((p.x - ${b.x}.0) / 11.0, ly); int ci = int(cellY) - ${b.off}; pin = float(((ci % ${b.every}) + ${b.every}) % ${b.every} == 0); }`).join(' else ')}
      }
      if (pin > 0.5) {
        float d = length(lp);
        float disk = 1.0 - smoothstep(0.3, 0.4, d);
        // 凸點的小圓頂：左上亮、右下暗，下面一點影子
        vec3 pn = normalize(vec3(lp * 1.6, 0.6));
        float pl = max(dot(pn, L), 0.0);
        vec3 steel = mix(C_ASH, C_BONE, 0.6) * (0.5 + 0.75 * pl) + C_BONE * 0.7 * pow(pl, 12.0);
        float shadow = (1.0 - smoothstep(0.28, 0.5, length(lp - vec2(0.12, 0.16)))) * (1.0 - disk);
        cyl *= 1.0 - 0.62 * shadow;
        cyl = mix(cyl, steel * (0.55 + 0.55 * dif), disk);
      }
      // 兩端的邊（倒角）
      float e = min(p.x - ${CYL.x0}.0, ${CYL.x1}.0 - p.x);
      cyl *= 0.7 + 0.3 * smoothstep(0.0, 6.0, e);
      // 邊緣暗（圓柱的輪廓）
      cyl *= 0.55 + 0.45 * smoothstep(1.0, 0.82, abs(yy));
      col = cyl;
    }
    // 右端的齒輪（側面看是一排齒）
    if (p.x > ${CYL.x1}.0 && p.x < ${CYL.x1 + 18}.0 && abs(yy) < 1.08) {
      float th = asin(clamp(yy, -1.0, 1.0));
      float teeth = step(0.5, fract((R * th / 7.0) + sigma0 * ${PITCH} / 7.0));
      col = mix(C_BLOOD, C_SIGNAL, 0.3) * (0.4 + 0.5 * cos(th)) * (0.75 + 0.25 * teeth);
    }
    fragColor = vec4(mix(C_PAPER, col, k), 1.0);
  }`, {
  pins: { value: null }, rows: { value: 1 }, cols: { value: 1 }, sigma0: { value: 0 }, T0: { value: 0 }, k: { value: 1 },
});

export default class Musicbox extends Scene {
  box = shared('musicbox.box', BOX);
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  /** 音梳（一般混色）與被撥到的尖端的光（加亮）。 */
  comb = this.track(new LineBatch(800, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(800, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit!: FitResult;
  body = '';
  sched: { t: number; chars: number }[] = [];
  bitmap!: Uint8Array; rows = 1;
  tex!: THREE.DataTexture;
  B0 = 0; T0 = 26; beat = 0.5; tFirst = 0;
  /** 曲目卡的大小（照字裁）、署名與歌詞的字級。 */
  card = { w: 860, h: 200 }; sigSize = 30; lyrSize = 52;
  hasLyrics = false;
  avoid: Rect[] = [];
  private baseUp = false;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.body = m ? m.text : INVITE;
    const pinText = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
    await loadText(`${TEXT}${this.body}${pinText}${m ? m.name : ''}${song.title}${song.artist}`);
    this.beat = au.beatPeriod(s + 0.1);
    this.hasLyrics = windowLines(lyrics, s, e).length > 0;
    this.B0 = Math.round(au.beatAt(s));
    const c = this.dyn.ctx;
    // 留言框扣掉最下面一列署名（署名永遠在留言下面）
    // 標準 v2：字級上限依字數，照子句斷行；框高先扣掉署名那一列（署名永遠在最後一行下面）
    const fam = F.hand(700);
    const sig0 = sigV2(Math.min(msgMaxFor(this.body), 52));
    const boxW = CARD.maxW - 2 * CARD.padX, boxH = CARD.maxH - CARD.padT - CARD.padB - (m ? sig0 + 12 : 0);
    const o = { min: V2.msgMin, max: msgMaxFor(this.body), lineHeight: 1.18, maxLines: 4 };
    this.fit = fitClauses(c, this.body, fam, boxW, boxH, o) ?? layoutMessage(c, this.body, fam, boxW, boxH, o);
    this.sigSize = sigV2(this.fit.size);
    this.lyrSize = lyricV2(m ? this.fit.size : null);
    c.font = font(fam, this.sigSize);
    const sigW = m ? c.measureText(m.couple ? '—— 新郎新娘' : signature(m.name)).width : 0;
    this.card = { w: Math.min(CARD.maxW, Math.max(this.fit.width, sigW) + 2 * CARD.padX), h: CARD.padT + this.fit.height + (m ? this.sigSize + 12 : 0) + CARD.padB + 6 };
    this.tFirst = beatAfter(au, s + 0.2);
    this.sched = phraseSchedule(au, this.body, this.tFirst, Math.min(8 * this.beat, 0.45 * (e - s)), 4);
    this.makePins(pinText);
    // 一開始第一行字在滾筒正中間偏下一點：一拍之內轉到最好讀的位置
    this.T0 = Math.round((-CYL.R * TH_C) / PITCH - GLYPH / 2 - 2);
    this.drawBase();
    this.avoid = [
      [LYR.x - 16, LYR.y, LYR.w + 32, 140],
      [CARD.x - 10, CARD.y - 10, this.card.w + 20, this.card.h + 20],
    ];
  }

  /** 把留言排成點陣：畫布上用 20 px 的字寫，每個像素讀回來（夠黑就是一顆凸點）。一整輪 = 所有行＋一段空白。 */
  private makePins(text: string) {
    const cv = document.createElement('canvas');
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    const fam = F.hei(700);
    c.font = font(fam, GLYPH);
    const lines = wrap(c, text, TCOLS - 4);
    const n = Math.max(1, lines.length);
    this.rows = n * LINE_ROWS + LINE_ROWS; // 最後空一行再重來
    cv.width = TCOLS; cv.height = this.rows;
    c.font = font(fam, GLYPH);
    // 點陣只看透明度（有沒有墨），顏色不會上畫面
    c.fillStyle = rgba('ink'); c.textBaseline = 'alphabetic';
    lines.forEach((ln, i) => {
      const w = c.measureText(ln).width;
      const x = Math.round((TCOLS - w) / 2);
      const y = i * LINE_ROWS + Math.round(GLYPH * 0.86);
      if (!ln.includes('♥')) { c.fillText(ln, x, y); return; }
      // 愛心用自己畫的（字型裡的 ♥ 在 20 px 時太細）
      let xx = x;
      for (const part of ln.split(/(♥)/)) {
        if (!part) continue;
        if (part === '♥') { drawHeart(c, xx + GLYPH * 0.5, y - GLYPH * 0.35, GLYPH * 0.9, rgba('ink')); xx += GLYPH; }
        else { c.fillText(part, xx, y); xx += c.measureText(part).width; }
      }
    });
    // 行與行之間的裝飾線（一排間隔的凸點）：音梳在字之間也有東西撥
    const img = c.getImageData(0, 0, TCOLS, this.rows).data;
    const bm = new Uint8Array(TCOLS * this.rows);
    for (let r = 0; r < this.rows; r++) for (let k = 0; k < TCOLS; k++) bm[r * TCOLS + k] = img[(r * TCOLS + k) * 4 + 3]! > 110 ? 1 : 0;
    for (let i = 0; i <= n; i++) {
      const r = i * LINE_ROWS - 6;
      if (r < 0 || r >= this.rows) continue;
      for (let k = 8; k < TCOLS - 8; k += 12) bm[r * TCOLS + k] = 1;
    }
    this.bitmap = bm;
    // 沒有 mipmap、最近點：shader 用 texelFetch 讀整數格
    const tex = new THREE.DataTexture(bm, TCOLS, this.rows, THREE.RedIntegerFormat, THREE.UnsignedByteType);
    tex.internalFormat = 'R8UI';
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.tex = this.track(tex);
  }

  private pinAt(col: number, row: number): boolean {
    if (col < 0 || col >= TCOLS) return false;
    const r = ((row % this.rows) + this.rows) % this.rows;
    return this.bitmap[r * TCOLS + col] === 1;
  }

  /** 滾筒轉到哪（排）：一拍四排，凸點都落在十六分音符上。 */
  private sigma(t: number) { return 4 * (this.ctx.audio.beatAt(t) - this.B0); }

  // ---------------------------------------------------------------- 不會變的
  private drawBase() {
    const L = this.base, c = L.ctx;
    L.clear();
    const m = this.msg;
    // 正在演奏的標籤
    c.font = font(F.mono(500), 13); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText(this.hasLyrics ? '♪  正在演奏' : '♪  本盒演奏', LYR.x, LYR.y + 20);
    c.letterSpacing = '0px';
    // 底板上的刻字與螺絲
    c.font = font(F.serif(600), 15); c.letterSpacing = '5px'; c.fillStyle = rgba('sepia', 0.45);
    c.fillText(`AO · ${DATE_DOTS} · 313 NOTES`, PLATE.x0 + 30, PLATE.y1 - 16);
    c.letterSpacing = '0px';
    for (const [x, y] of [[PLATE.x0 + 16, PLATE.y0 + 16], [PLATE.x1 - 16, PLATE.y0 + 16], [PLATE.x0 + 16, PLATE.y1 - 16], [PLATE.x1 - 16, PLATE.y1 - 16]] as const) {
      c.fillStyle = rgba('sepia', 0.55); c.beginPath(); c.arc(x, y, 6, 0, TAU); c.fill();
      c.strokeStyle = rgba('paper', 0.6); c.lineWidth = 1.5; c.beginPath(); c.moveTo(x - 4, y - 2); c.lineTo(x + 4, y + 2); c.stroke();
    }
    // 音梳的底座（鋼條）
    const g = c.createLinearGradient(0, COMB.y0, 0, COMB.y1);
    g.addColorStop(0, mixRgba('bone', 'ash', 0.2)); g.addColorStop(0.5, rgba('ash')); g.addColorStop(1, rgba('graphite'));
    c.fillStyle = rgba('sepia', 0.3); c.fillRect(CYL.x0 + 6, COMB.y0 + 8, CYL.x1 - CYL.x0, COMB.y1 - COMB.y0);
    c.fillStyle = g; c.fillRect(CYL.x0, COMB.y0, CYL.x1 - CYL.x0, COMB.y1 - COMB.y0);
    for (const x of [CYL.x0 + 40, (CYL.x0 + CYL.x1) / 2, CYL.x1 - 40]) {
      c.fillStyle = rgba('graphite'); c.beginPath(); c.arc(x, (COMB.y0 + COMB.y1) / 2, 8, 0, TAU); c.fill();
      c.strokeStyle = rgba('bone', 0.5); c.lineWidth = 1.5; c.beginPath(); c.arc(x, (COMB.y0 + COMB.y1) / 2, 8, Math.PI, Math.PI * 1.6); c.stroke();
    }
    // 曲目卡：一張紙卡擺在盒子裡（稍微歪、底下有柔柔的影子），只印一條細框
    const cw = this.card.w, ch = this.card.h;
    c.save(); cardXform(c, cw, ch);
    c.filter = 'blur(10px)'; c.fillStyle = rgba('sepia', 0.18); c.fillRect(CARD.x + 8, CARD.y + 14, cw, ch); c.filter = 'none';
    c.fillStyle = mixRgba('paper', 'bone', 0.5); c.fillRect(CARD.x, CARD.y, cw, ch);
    c.strokeStyle = rgba('blood', 0.3); c.lineWidth = 1; c.strokeRect(CARD.x + 9.5, CARD.y + 9.5, cw - 19, ch - 19);
    c.restore();
    void m;
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const exit = prog(t, e - 0.3, e, ease.inCubic);
    const sg = this.sigma(t);
    const u = this.box.u;
    u.pins!.value = this.tex; u.rows!.value = this.rows; u.cols!.value = TCOLS;
    u.sigma0!.value = sg; u.T0!.value = this.T0; u.k!.value = 1;
    this.box.render(renderer, out);
    if (!this.baseUp) { this.base.upload(); this.baseUp = true; }
    comp.draw(renderer, this.base.texture, out);

    // ---- 音梳：高音一根簧片管兩排凸點，低音四根粗的
    this.comb.clear(); this.glow.clear();
    const yTip = CYL.cy + CYL.R * Math.sin(TH_C);
    const sc = Math.floor(sg + 0.5); // 剛經過音梳的那一排
    const beatSec = this.beat / 4;
    const steel = LIN.graphite, hi = LIN.bone, sgC = LIN.signal, em = LIN.ember;
    const tooth = (x: number, w: number, age: number) => {
      const hit = age < 99 ? Math.exp(-age / 0.28) : 0;
      const wob = hit * Math.sin(age * TAU * 11) * 1.6;
      const y0 = COMB.y1 - 2, y1 = yTip + 2;
      this.comb.seg2(x, y0, x + wob, y1, w, steel, 1);
      this.comb.seg2(x - w * 0.18, y0, x - w * 0.18 + wob, y1 - 4, Math.max(0.8, w * 0.25), hi, 0.55);
      if (hit > 0.03) {
        const I = 1.1 + 1.7 * hit;
        this.glow.seg2(x + wob, y1 - 12, x + wob, y1, w + 2, [lerp(sgC[0], em[0], hit) * I * hit, lerp(sgC[1], em[1], hit) * I * hit, lerp(sgC[2], em[2], hit) * I * hit], 1);
      }
    };
    // 低音（凸點落在拍上）
    for (const b of BASS) {
      let age = 99;
      for (let r = sc; r > sc - 16; r--) if ((((r - b.off) % b.every) + b.every) % b.every === 0) { age = (sg - r) * beatSec; break; }
      tooth(b.x, 11, Math.max(0, age));
    }
    // 高音：每根簧片管 2 欄
    for (let k = 0; k < TCOLS / 2; k++) {
      const x = TX0 + (2 * k + 1) * PITCH;
      let age = 99;
      for (let r = sc; r > sc - 10; r--) {
        if (this.pinAt(2 * k, r - this.T0) || this.pinAt(2 * k + 1, r - this.T0)) { age = (sg - r) * beatSec; break; }
      }
      tooth(x, 4.6, Math.max(0, age));
    }
    // ---- 調速風扇：兩片葉子一直轉（從上面看是一條轉動的線）＋殘影
    const fa = (t - s) * TAU * 3.2;
    for (let g = 0; g < 4; g++) {
      const a = fa - g * 0.22;
      const dx = Math.cos(a) * 34, dy = Math.sin(a) * 34 * 0.5;
      this.comb.seg2(FAN.x - dx, FAN.y - dy, FAN.x + dx, FAN.y + dy, 7, LIN.ash, g ? 0.18 / g : 0.95);
    }
    this.comb.seg2(FAN.x, FAN.y, FAN.x + 0.01, FAN.y, 10, LIN.graphite, 1);
    this.comb.render(renderer, out);
    this.glow.render(renderer, out);

    // ---- 字：正在演奏、曲目卡
    const L = this.dyn, c = L.ctx, HL = this.hot, hc = HL.ctx;
    L.clear(); HL.clear();
    c.globalAlpha = hc.globalAlpha = 1 - exit;
    const glow = this.drawLyric(c, hc, t);
    this.drawCard(c, t);
    comp.draw(renderer, L.upload(), out);
    if (glow) comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.5, 1.5, 1.5] });
    // 鏡頭：整段慢慢推近（緩進緩出）
    return { paper: 1, bloom: 0.4, vignette: 0.3, grain: 0.04, halation: 0.06, zoom: 1 + 0.025 * ease.inOutCubic(f.p), popupAvoid: this.avoid };
  }

  /** 正在演奏：這一行歌詞（逐字跟唱；亮版面：正在唱是訊號色的暗部＋螢光筆，唱完墨色）。 */
  private drawLyric(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number): boolean {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t, 1.4);
    if (!ly) {
      if (!this.hasLyrics) {
        c.font = font(F.archivo(100, 800), 60); c.fillStyle = rgba('sepia', 0.9);
        c.fillText(song.title || '今晚的歌', LYR.x, LYR.base);
        if (song.artist) { const w = c.measureText(song.title || '今晚的歌').width; c.font = font(F.serif(400, true), 30); c.fillStyle = rgba('sepia', 0.6); c.fillText(song.artist, LYR.x + w + 24, LYR.base); }
      }
      return false;
    }
    const st = { family: F.archivo(100, 800), size: this.lyrSize, minSize: V2.lyrMin, maxWidth: LYR.w, lineHeight: 1.08 };
    const lay = layoutLyric(c, ly.line, st);
    const y0 = LYR.base - (lay.rows.length - 1) * lay.size * 1.08;
    let glow = false;
    c.save(); c.globalAlpha *= ly.k;
    c.font = font(st.family, lay.size);
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      const x = LYR.x + pw.x, y = y0 + pw.y;
      if (p > 0 && p < 1) {
        // 螢光筆畫在字的下半（「一」的橫畫在中間，整個蓋住會看不見）
        c.fillStyle = rgba('signal', 0.5);
        c.fillRect(x - 4, y - lay.size * 0.26, (pw.w + 8) * p, lay.size * 0.36);
      }
      c.fillStyle = rgba('sepia', 0.3);
      if (p < 1) c.fillText(pw.word.w, x, y);
      if (p <= 0) continue;
      c.save(); c.beginPath(); c.rect(x - 6, y - lay.size * 1.1, (pw.w + 12) * p, lay.size * 1.5); c.clip();
      c.fillStyle = p < 1 ? rgba('blood') : rgba('sepia');
      c.fillText(pw.word.w, x, y);
      c.restore();
      // 亮版面不加光暈：加亮疊在紙上會把深色的字洗淡
    }
    c.restore();
    return glow;
  }

  /** 曲目卡：主打留言一個詞組一拍印上去，最後署名。 */
  private drawCard(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg, fit = this.fit;
    const shown = fitCharsF(fit.lines, revealAt(this.sched, t, Math.min(0.18, this.beat * 0.35)));
    const y = CARD.y + CARD.padT + fit.size * 0.9;
    c.save(); cardXform(c, this.card.w, this.card.h);
    drawReveal(c, fit, F.hand(700), CARD.x + CARD.padX, y, shown, { color: rgba('sepia') });
    const done = this.sched.length ? this.sched[this.sched.length - 1]!.t + 0.2 : this.tFirst;
    if (m && t >= done) {
      c.save(); c.globalAlpha *= prog(t, done, done + 0.3);
      // 署名：留言最後一行的下面、靠右
      const sy = y + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize + 8;
      c.font = font(F.hand(700), this.sigSize); c.fillStyle = rgba('sepia', 0.75); c.textAlign = 'right';
      c.fillText(m.couple ? '—— 新郎新娘' : signature(m.name), CARD.x + this.card.w - CARD.padX, sy);
      c.restore();
    }
    c.restore();
    void clamp;
  }
}
