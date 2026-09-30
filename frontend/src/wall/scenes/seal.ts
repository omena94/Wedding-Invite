// 篆刻（亮）：一頁「印譜」。左邊是一方印石的印面特寫（放大 2.5 倍），刻刀在每個拍點刻掉一塊、石屑噴出來；
// 右邊是主打留言與署名，印刻好的那一刻蓋在署名旁邊（實際大小、字是正的——印面上刻的是反字）；
// 下緣一條深色的「邊款拓片」，歌詞在上面逐字跟唱（拓片是墨底、字是紙色，唱到的字是訊號色）。
//  - 印文：署名是兩到四個中文字就刻名字（「阿哲之印」「小胖印」），白文（刻掉字，蓋出來紅底白字）；
//    其他（英文名、太長、新人、沒有留言）刻閒章「百年好合」，朱文（刻掉底，蓋出來紅字）。
//  - 印面是 shader 畫的浮雕：一張遮罩貼圖（R = 要刻掉的地方、G = 第幾刀刻到），刻掉的地方低下去、
//    用鄰近像素算法向量打光（左上來的光），刻痕底部是新鮮的石粉白、有刀痕；石頭有程序生成的石紋。
//  - 節奏：第一拍開始刻，每一拍刻一段（outExpo，刀子往前一推）；刻完的下一拍「沾印泥」（印面凸起的地方變紅），
//    再下一拍蓋印（畫面震一下），之後印面帶著印泥、刀子收走。
//  - 標準 v2：留言＋署名＋印整塊 ≤ 600 × 430（留言 40～60、署名 26～32、歌詞 40～52）；
//    蓋完之後每個小節線有人對著印面「呼」一口氣，石粉往右上飄散。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, noise1, TAU } from '../engine/util';
import { type FitResult } from '../engine/text';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, type LyricStyle } from './_motifs';
import { subRect, rasterPieces } from './_t13';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';
import { fitText } from '../engine/text';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'craft', paper: true, energy: [0.2, 0.8], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（邏輯像素）
/** 印面特寫（正方形）與它下面露出來的一截石身。 */
const FACE = { x: 150, y: 150, s: 470 };
const SIDE = 52;
/** 遮罩貼圖解析度。 */
const M = 512;
/** 右欄：留言、署名、印。 */
const COL = { x: 700, x1: 1340, y: 170 };
/** 蓋出來的印（實際大小）。 */
const PRINT = 150;
/** 邊款拓片（歌詞）。 */
const BAND = { x: 150, y: 758, w: 1190, h: 128 };
const TXT_R = { x: 96, y: 80, w: 1270, h: 900 };
const FAM_MSG = F.hand(400);
const FOOT = '＊印面為反字，蓋出來才是正的。';
const INVITE = ['掃描右下角 QR code，', '你的名字也能刻成一方印。'];

const FRAG = /* glsl */ `
uniform sampler2D uMask; uniform float uProg; uniform float uInk; uniform float uSeed; uniform float uIn;
const vec4 FACE = vec4(${FACE.x}.0, ${FACE.y}.0, ${FACE.s}.0, ${SIDE}.0);
const vec4 BAND = vec4(${BAND.x}.0, ${BAND.y}.0, ${BAND.w}.0, ${BAND.h}.0);

// 這個印面座標（0..1，y 向下）刻掉了沒（0..1，邊緣反鋸齒）
float carved(vec2 uv) {
  vec4 m = texture(uMask, vec2(uv.x, 1.0 - uv.y));
  return m.r * (1.0 - smoothstep(uProg - 0.004, uProg + 0.0005, m.g));
}
vec3 stoneCol(vec2 p) {
  // 壽山石：溫潤、顏色很勻，只有幾條細細的石紋與淡淡的雲斑（不要大理石那種大花紋）
  vec2 q = p / 220.0 + uSeed;
  float cloud = fbm(q * 0.8, 3);
  float warp = fbm(q * 2.2 + 4.0, 2);
  float vein = abs(snoise(q * 1.1 + vec2(warp * 0.9, warp * 0.4)));
  vec3 base = mix(C_PAPER, C_SEPIA, 0.3);
  vec3 col = mix(base, mix(C_PAPER, C_SEPIA, 0.4), 0.5 + 0.5 * cloud);
  col = mix(col, mix(C_PAPER, C_BLOOD, 0.4), 0.22 * smoothstep(0.1, 0.6, fbm(q * 0.5 + 9.0, 3)));
  col *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.035, vein));
  return col * (0.975 + 0.03 * snoise(p * 0.45));
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // ---- 紙
  vec3 col = C_PAPER * (0.978 + 0.022 * fbm(p * 0.002, 3) + 0.01 * snoise(p * 0.5));
  col *= 0.97 + 0.04 * (1.0 - vUv.x * 0.5) * vUv.y;
  // 頁眉的細線
  col = mix(col, C_SEPIA, 0.35 * pxLine(abs(p.y - 124.0), 0.3, 1.0) * step(${BAND.x}.0, p.x) * step(p.x, ${BAND.x + BAND.w}.0));

  // ---- 印石的影子（右下）
  vec2 fc = FACE.xy + vec2(FACE.z * 0.5, (FACE.z + FACE.w) * 0.5);
  float sd = sdBox(p - fc - vec2(16.0, 24.0), vec2(FACE.z * 0.5, (FACE.z + FACE.w) * 0.5) - 8.0) - 8.0;
  col *= 1.0 - 0.22 * uIn * (1.0 - smoothstep(-10.0, 28.0, sd));

  // ---- 石身（印面下面露出來的一截，暗一點、有直的石紋）
  vec2 sp = p - vec2(FACE.x, FACE.y + FACE.z);
  if (sp.x >= 0.0 && sp.x <= FACE.z && sp.y >= 0.0 && sp.y <= FACE.w) {
    vec3 s = stoneCol(vec2(p.x, p.y * 0.25 + 900.0)) * 0.78;
    s *= 0.9 + 0.1 * smoothstep(FACE.w, 0.0, sp.y);
    col = mix(col, s, uIn);
  }
  // ---- 印面
  vec2 uv = (p - FACE.xy) / FACE.z;
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    float e = 1.4 / FACE.z;
    float h = carved(uv);
    float hx = carved(uv + vec2(e, 0.0)) - carved(uv - vec2(e, 0.0));
    float hy = carved(uv + vec2(0.0, e)) - carved(uv - vec2(0.0, e));
    // 刻掉的地方是低的：高度 = -h；光從左上來（y 向下的座標）
    vec3 n = normalize(vec3(hx * 1.3, hy * 1.3, 1.0));
    vec3 L = normalize(vec3(-0.55, -0.7, 0.9));
    float shade = dot(n, L) / L.z;
    vec3 s = stoneCol(p);
    // 刻痕底：新鮮的石粉，比較白、有斜斜的刀痕
    float marks = pxLine(abs(fract(dot(p, vec2(0.62, 0.78)) / 4.6) - 0.5) * 4.6, 0.3, 1.1);
    vec3 floorC = mix(s, C_BONE, 0.42) * (0.92 + 0.08 * snoise(p * 0.9)) * (1.0 - 0.1 * marks);
    vec3 fcol = mix(s, floorC, h) * clamp(shade, 0.55, 1.35);
    // 印泥：凸起的地方沾上紅色（斑駁）
    float mott = smoothstep(-0.7, 0.4, snoise(p * 0.08 + 3.0) * 0.6 + snoise(p * 0.3) * 0.4);
    vec3 red = mix(C_SIGNAL, C_BLOOD, 0.55);
    fcol = mix(fcol, red * (0.8 + 0.2 * mott), uInk * (1.0 - h) * (0.55 + 0.3 * mott));
    // 印面的邊：左上亮、右下暗的一圈倒角
    float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)) * FACE.z;
    float bev = 1.0 - smoothstep(0.0, 5.0, edge);
    float tl = step(uv.x + uv.y, 1.0);
    fcol *= 1.0 + bev * (tl > 0.5 ? 0.12 : -0.22);
    col = mix(col, fcol, uIn);
  }

  // ---- 邊款拓片：墨底斑駁、邊緣不齊，紙紋透出來
  vec2 bq = p - BAND.xy;
  float bn = snoise(p * 0.05) * 3.0 + snoise(p * 0.21) * 1.2;
  float inBand = step(-bn, bq.x) * step(bq.x, BAND.z + bn) * step(-bn * 0.7, bq.y) * step(bq.y, BAND.w + bn * 0.7);
  if (inBand > 0.0) {
    float g = fbm(p * 0.012, 4) * 0.5 + snoise(p * 0.35) * 0.25 + snoise(p * 1.1) * 0.15;
    vec3 inkC = mix(C_INK, C_SEPIA, 0.35) * (0.8 + 0.35 * g);
    // 拓片的墨不要壓成一整塊實心的黑：濃淡不勻，紙紋透得出來
    col = mix(col, inkC, (0.74 + 0.14 * g) * uIn);
  }
  fragColor = vec4(col, 1.0);
}`;

const BG = () => new FSPass(FRAG, { uMask: { value: null }, uProg: { value: 0 }, uInk: { value: 0 }, uSeed: { value: 0 }, uIn: { value: 1 } });

/** 印文怎麼刻：名字（白文）或閒章（朱文）。 */
function sealText(m: Msg | null): { chars: string[]; baiwen: boolean } {
  const name = (m?.name ?? '').replace(/\s/g, '');
  const cjk = /^[\p{Script=Han}]+$/u.test(name);
  if (m && !m.couple && cjk && name.length >= 2 && name.length <= 4) {
    const t = name.length === 2 ? `${name}之印` : name.length === 3 ? `${name}印` : name;
    return { chars: Array.from(t), baiwen: true };
  }
  return { chars: ['百', '年', '好', '合'], baiwen: false };
}

/**
 * 在 S×S 的方塊裡排四個印文（右行上、右行下、左行上、左行下），字撐滿格子（印章的字是方的）；
 * 朱文另外畫邊框。mirror：印面上是反的。
 */
function drawSealArt(c: CanvasRenderingContext2D, S: number, chars: string[], baiwen: boolean, mirror: boolean) {
  c.save();
  if (mirror) { c.translate(S, 0); c.scale(-1, 1); }
  const rim = S * (baiwen ? 0.075 : 0.085), gap = S * 0.035;
  const cs = (S - 2 * rim - gap) / 2;
  const pos = [[rim + cs + gap, rim], [rim + cs + gap, rim + cs + gap], [rim, rim], [rim, rim + cs + gap]];
  c.font = font(F.ming(900), cs);
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  chars.slice(0, 4).forEach((ch, i) => {
    const m = c.measureText(ch);
    const bw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, bh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const [x, y] = pos[i]!;
    c.save();
    c.translate(x! + cs / 2, y! + cs / 2);
    c.scale((cs * 0.94) / Math.max(1, bw), (cs * 0.94) / Math.max(1, bh));
    c.fillText(ch, (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
    c.restore();
  });
  if (!baiwen) { c.lineWidth = S * 0.05; c.strokeRect(S * 0.025, S * 0.025, S * 0.95, S * 0.95); }
  c.restore();
}

interface Way { x0: number; y0: number; x1: number; y1: number }

export default class Seal extends Scene {
  bg = shared('seal.bg', BG);
  /** 留言、署名、標籤、落好的印（key 變了才重畫）。 */
  txt = this.track(new Layer2D(TXT_R.w, TXT_R.h, undefined, { fast: true }));
  /** 拓片上的歌詞（每格）。 */
  band = this.track(new Layer2D(BAND.w + 40, BAND.h + 20, undefined, { fast: true }));
  /** 刻刀與石屑。 */
  lines = this.track(new LineBatch(1400, { screen2D: true, blend: 'normal' }));
  mask: THREE.CanvasTexture | null = null;
  msg: Msg | null = this.ctx.params.message ?? null;
  art = sealText(this.msg);
  print: HTMLCanvasElement | null = null;
  fit: FitResult | null = null;
  sigSize = 44;
  layoutY = { msg: 0, sig: 0, px: 0, py: 0 };
  /** 刀的路線：第 i 段刻第 i 塊（進度 i/N ～ (i+1)/N）。 */
  ways: Way[] = [];
  t0 = 0;
  beat0 = 0;
  carveBeats = 8;
  tInk = 0;
  tStamp = 0;
  txtKey = '';

  override async init() {
    const { audio: au, start, end, song } = this.ctx;
    const m = this.msg;
    await loadText(`${this.art.chars.join('')}${FOOT}${INVITE.join('')}篆刻印譜印面放大反字白文朱文${song.title}${m ? m.text + signature(m.name) : ''}`);
    // ---- 時間：刻幾拍、沾印泥、蓋印
    this.t0 = beatAfter(au, start + 0.05);
    this.beat0 = au.beatAt(this.t0);
    const avail = Math.floor(au.beatAt(end - 0.05) - this.beat0);
    this.carveBeats = clamp(avail - 4, 2, 16);
    this.tInk = au.timeOfBeat(this.beat0 + this.carveBeats + 0.5);
    this.tStamp = au.timeOfBeat(this.beat0 + this.carveBeats + 1);
    // ---- 印面遮罩（反字）與蓋出來的印（正字）
    this.mask = this.buildMask();
    this.print = this.buildPrint();
    // ---- 右欄排版
    const c = this.txt.ctx;
    const w = COL.x1 - COL.x;
    if (m) {
      // 標準 v2：字級上限依字數、先照子句排；高度用「留言區 430 扣掉印與署名」算，印與署名永遠在留言下面
      const o = { min: V2.msgMin, max: msgMaxFor(m.text), lineHeight: 1.32, maxLines: 5 };
      const h = V2.boxH - 24 - PRINT;
      this.fit = fitClauses(c, m.text, FAM_MSG, w - 40, h, o) ?? fitText(c, m.text, FAM_MSG, w - 40, h, o);
      this.sigSize = sigV2(this.fit.size);
      // 留言在上、印（與左邊的署名）在留言下面，整塊在右欄（y 170～724）裡上下置中：短留言不會只擠在最上面，印也不會壓到最後一行
      const blockH = this.fit.height + 24 + PRINT;
      const msgTop = COL.y + Math.max(0, (554 - blockH) / 2) + this.fit.size * 0.9;
      const lastBase = msgTop + (this.fit.lines.length - 1) * this.fit.lineHeight;
      const py = Math.min(lastBase + this.fit.size * 0.25 + 24, 740 - 16 - PRINT);
      this.layoutY = { msg: msgTop, sig: py + PRINT * 0.55, px: COL.x1 - PRINT, py };
    } else {
      this.layoutY = { msg: COL.y + 140, sig: 0, px: COL.x1 - PRINT, py: 420 };
    }
  }

  /** 印面遮罩：R = 要刻掉的地方（白文是字、朱文是底），G = 第幾刀（0..1）。順便排好刀的路線。 */
  private buildMask() {
    const { chars, baiwen } = this.art;
    const cv = document.createElement('canvas');
    cv.width = cv.height = M;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.fillStyle = '#fff';
    drawSealArt(c, M, chars, baiwen, true);
    const cov = c.getImageData(0, 0, M, M).data;
    const img = c.createImageData(M, M);
    const rnd = mulberry32(7);
    const jitter = new Float32Array(64).map(() => rnd());
    // 印面上的第 i 個字在哪一格（反字：讀的順序第 0 個字在左上）
    const cellOf = (x: number, y: number) => (x < M / 2 ? (y < M / 2 ? 0 : 1) : (y < M / 2 ? 2 : 3));
    const sc = FACE.s / M;
    if (baiwen) {
      // 白文：刻掉字。每一塊（連通的筆畫）一刀，照讀的順序、同一個字由上而下
      const P = rasterPieces(M, M, (cc) => { cc.fillStyle = '#fff'; drawSealArt(cc, M, chars, baiwen, true); }, 30, 4);
      const order = P.pieces.slice().sort((a, b) => (cellOf(a.cx, a.cy) - cellOf(b.cx, b.cy)) || (a.y0 - b.y0) || (b.x1 - a.x1));
      const rank = new Map<number, number>();
      order.forEach((pc, i) => rank.set(pc.id, i));
      const N = Math.max(1, order.length);
      const byId = new Map(order.map((pc) => [pc.id, pc]));
      // 抗鋸齒的邊（覆蓋率 > 0 但沒標到）跟著最近的一塊
      const labelNear = (x: number, y: number) => {
        for (let r = 0; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= M || yy >= M) continue;
          const l = P.labels[yy * M + xx]!;
          if (l) return l;
        }
        return 0;
      };
      for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
        const i = y * M + x, a = cov[i * 4 + 3]!;
        if (!a) continue;
        const l = P.labels[i] || labelNear(x, y);
        if (!l) continue;
        const pc = byId.get(l)!;
        // 刀從這塊的右邊往左推（反字：蓋出來是由左往右）
        const along = 1 - (x - pc.x0) / Math.max(1, pc.x1 - pc.x0);
        const o = (rank.get(l)! + 0.08 + 0.84 * along) / N;
        img.data[i * 4] = a; img.data[i * 4 + 1] = Math.round(clamp(o) * 255); img.data[i * 4 + 3] = 255;
      }
      this.ways = order.map((pc) => ({ x0: FACE.x + pc.x1 * sc, y0: FACE.y + pc.cy * sc, x1: FACE.x + pc.x0 * sc, y1: FACE.y + pc.cy * sc }));
    } else {
      // 朱文：刻掉底。照讀的順序一格一格，每格五刀（一刀一橫條，左右來回）
      const ROWS = 5, N = 4 * ROWS;
      const q0 = [[0, 0], [0, M / 2], [M / 2, 0], [M / 2, M / 2]];
      for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
        const i = y * M + x, a = cov[i * 4 + 3]!;
        const k = 255 - a;
        if (k < 8) continue;
        const cell = cellOf(x, y);
        const [qx, qy] = q0[cell]!;
        const ry = (y - qy!) / (M / 2), rx = (x - qx!) / (M / 2);
        const row = Math.min(ROWS - 1, Math.floor(ry * ROWS));
        const along = row % 2 ? 1 - rx : rx;
        const n = (jitter[(x >> 3) % 64]! - 0.5) * 0.12 + (jitter[(y >> 2) % 64]! - 0.5) * 0.06;
        const o = (cell * ROWS + row + clamp(along * 0.9 + 0.05 + n)) / N;
        img.data[i * 4] = k; img.data[i * 4 + 1] = Math.round(clamp(o) * 255); img.data[i * 4 + 3] = 255;
      }
      for (let cell = 0; cell < 4; cell++) for (let row = 0; row < ROWS; row++) {
        const [qx, qy] = q0[cell]!;
        const yy = qy! + ((row + 0.5) / ROWS) * (M / 2);
        const xa = qx! + M * 0.04, xb = qx! + M / 2 - M * 0.04;
        const [a, b] = row % 2 ? [xb, xa] : [xa, xb];
        this.ways.push({ x0: FACE.x + a * sc, y0: FACE.y + yy * sc, x1: FACE.x + b * sc, y1: FACE.y + yy * sc });
      }
    }
    c.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    tex.premultiplyAlpha = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.track({ dispose: () => { tex.dispose(); cv.width = cv.height = 0; } });
    return tex;
  }

  /** 蓋出來的印（正字、實際大小）：印泥不勻、邊緣有缺角。 */
  private buildPrint() {
    const { chars, baiwen } = this.art;
    const k = 2, S = PRINT;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S * k;
    const c = cv.getContext('2d')!;
    c.scale(k, k);
    c.fillStyle = mixRgba('signal', 'blood', 0.55);
    if (baiwen) {
      c.fillRect(0, 0, S, S);
      c.globalCompositeOperation = 'destination-out';
      drawSealArt(c, S, chars, baiwen, false);
    } else {
      c.strokeStyle = c.fillStyle;
      drawSealArt(c, S, chars, baiwen, false);
    }
    c.globalCompositeOperation = 'destination-out';
    const rnd = mulberry32(99);
    for (let i = 0; i < 320; i++) {
      c.globalAlpha = 0.3 + 0.7 * rnd();
      c.beginPath(); c.arc(rnd() * S, rnd() * S, rnd() * rnd() * 2 + 0.3, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    return cv;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.3) * (1 - prog(t, e - 0.25, e));
    // ---- 刻到哪裡：一拍一段，拍點上刀一推（outExpo）
    const bb = au.beatAt(t) - this.beat0;
    const bi = Math.floor(bb), bp = bb - bi;
    const carve = t < this.t0 ? 0 : clamp((bi + ease.outExpo(clamp(bp / 0.45))) / this.carveBeats);
    const u = this.bg.u;
    u.uMask!.value = this.mask;
    u.uProg!.value = carve * 1.002;
    // 沾印泥（一下子紅）→ 蓋下去之後大部分的泥印到紙上，印面只剩一層薄薄的紅
    u.uInk!.value = prog(t, this.tInk, this.tInk + 0.1, ease.outCubic) * (1 - 0.6 * prog(t, this.tStamp, this.tStamp + 0.15));
    u.uSeed!.value = (this.ctx.params.seed ?? 3) % 17;
    u.uIn!.value = 1;
    this.bg.render(renderer, out);

    // ---- 刀與石屑
    this.lines.clear();
    if (t < this.tInk + 0.2) this.knife(t, carve, f, vis * (1 - prog(t, this.tInk - 0.1, this.tInk + 0.2)));
    this.chips(t);
    this.puffs(t);
    if (this.lines.count) this.lines.render(renderer, out);

    // ---- 右欄與標籤
    const stamped = t >= this.tStamp;
    this.drawTxt(t, stamped);
    comp.draw(renderer, this.txt.texture, out, { ...subRect(TXT_R), opacity: vis });
    // ---- 拓片上的歌詞＋蓋印的那一下
    this.drawBand(t, vis, lyricAt(lyrics, t));
    comp.draw(renderer, this.band.upload(), out, subRect({ x: BAND.x - 20, y: BAND.y - 10, w: BAND.w + 40, h: BAND.h + 20 }));

    const thump = t >= this.tStamp ? Math.pow(0.5, (t - this.tStamp) / 0.05) : 0;
    const L = this.layoutY;
    return {
      paper: 1, bloom: 0.3, bloomThreshold: 0.98, bloomKnee: 0.12, halation: 0.08, vignette: 0.24, grain: 0.055,
      zoom: 1 + 0.035 * ease.inOutCubic(f.p) + 0.004 * f.a.kick,
      shake: [thump * 6 * noise1(t * 70, 1), thump * 6 * noise1(t * 67, 2)],
      popupAvoid: [[COL.x - 20, COL.y - 20, COL.x1 - COL.x + 40, Math.max(L.py + PRINT, L.sig) - COL.y + 60], [BAND.x - 10, BAND.y - 10, BAND.w + 20, BAND.h + 20]],
    };
  }

  override dispose() {
    if (this.print) this.print.width = this.print.height = 0;
    super.dispose();
  }

  /** 刻刀：鋼條＋纏繩的刀柄，刀尖在正在刻的那一點；拍點上往前推一下。 */
  private knife(t: number, carve: number, f: Frame, k: number) {
    if (k <= 0.01 || !this.ways.length) return;
    const N = this.ways.length;
    const x = Math.min(N - 1e-6, carve * N), i = Math.floor(x), fr = x - i;
    const w = this.ways[i]!;
    const px = w.x0 + (w.x1 - w.x0) * fr, py = w.y0 + (w.y1 - w.y0) * fr;
    // 刀從左上方伸進來（刀柄落在印面上或畫面外，不會蓋到右邊的留言與下面的歌詞）；拍點上往前刺一下
    const push = Math.pow(0.5, (f.beatPhase * this.ctx.audio.beatPeriod(t)) / 0.06) * 10;
    const dx = -0.7, dy = -0.71;
    const tx = px - dx * push * 0.3, ty = py - dy * push * 0.3;
    const L = this.lines;
    const steel: [number, number, number] = [LIN.ash[0] * 0.8, LIN.ash[1] * 0.8, LIN.ash[2] * 0.8];
    const dark = LIN.sepia;
    L.seg2(tx + 14, ty + 20, tx + dx * 330 + 14, ty + dy * 330 + 20, 16, dark, 0.14 * k);           // 影子
    L.seg2(tx, ty, tx + dx * 150, ty + dy * 150, 11, steel, 0.95 * k);                               // 鋼條
    L.seg2(tx + dx * 4 - dy * 3, ty + dy * 4 + dx * 3, tx + dx * 148 - dy * 3, ty + dy * 148 + dx * 3, 2, LIN.paper, 0.45 * k);
    L.seg2(tx, ty, tx + dx * 14, ty + dy * 14, 5, dark, 0.6 * k);                                   // 刀口
    // 纏繩的刀柄
    for (let j = 0; j < 22; j++) {
      const a = 150 + j * 8, b = a + 6;
      L.seg2(tx + dx * a, ty + dy * a, tx + dx * b, ty + dy * b, 15, dark, (j % 2 ? 0.95 : 0.7) * k);
    }
  }

  /** 石屑：每個拍點從刀尖噴出一小撮（拍點的時間算好，確定性）。 */
  private chips(t: number) {
    const au = this.ctx.audio;
    const N = this.ways.length;
    if (!N) return;
    const b1 = Math.floor(au.beatAt(t)), stone: [number, number, number] = [LIN.sepia[0] * 0.6 + LIN.paper[0] * 0.4, LIN.sepia[1] * 0.6 + LIN.paper[1] * 0.4, LIN.sepia[2] * 0.6 + LIN.paper[2] * 0.4];
    for (let b = b1 - 2; b <= b1; b++) {
      const tb = au.timeOfBeat(b);
      if (tb < this.t0 || tb >= this.tInk || t < tb) continue;
      const age = t - tb;
      if (age > 0.8) continue;
      const k = clamp((b - this.beat0 + 0.4) / this.carveBeats);
      const x = Math.min(N - 1e-6, k * N), i = Math.floor(x), fr = x - i;
      const w = this.ways[i]!;
      const ox = w.x0 + (w.x1 - w.x0) * fr, oy = w.y0 + (w.y1 - w.y0) * fr;
      for (let j = 0; j < 18; j++) {
        const a = -Math.PI * (0.25 + 0.9 * hash(b, j, 1)), sp = 120 + 380 * hash(b, j, 2);
        const life = 0.35 + 0.45 * hash(b, j, 3);
        if (age > life) continue;
        const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
        const x0 = ox + vx * age, y0 = oy + vy * age + 900 * age * age;
        const a2 = Math.max(0, age - 0.02);
        const x1 = ox + vx * a2, y1 = oy + vy * a2 + 900 * a2 * a2;
        this.lines.seg2(x1, y1, x0, y0, 2 + 2.5 * hash(b, j, 4), stone, 0.85 * (1 - age / life));
      }
    }
  }

  /**
   * 吹石粉：蓋完印之後，每個小節線有人對著印面「呼」一口氣，細細的石粉從印面往右上飄散、慢下來、淡掉。
   * 粒子的起點與方向都由小節號雜湊決定（確定性）。
   */
  private puffs(t: number) {
    const au = this.ctx.audio;
    const from = this.tStamp + 0.3;
    if (t < from) return;
    const dust: [number, number, number] = [LIN.sepia[0] * 0.5 + LIN.paper[0] * 0.5, LIN.sepia[1] * 0.5 + LIN.paper[1] * 0.5, LIN.sepia[2] * 0.5 + LIN.paper[2] * 0.5];
    const bi = Math.floor(au.barAt(t));
    for (let b = bi - 1; b <= bi; b++) {
      const tb = au.timeOfBar(b);
      if (tb < from || t < tb) continue;
      const age = t - tb;
      if (age > 1.6) continue;
      for (let j = 0; j < 40; j++) {
        const x0 = FACE.x + 40 + (FACE.s - 80) * hash(b, j, 1), y0 = FACE.y + 40 + (FACE.s - 80) * hash(b, j, 2);
        const a = -0.2 - 0.9 * hash(b, j, 3), sp = 160 + 320 * hash(b, j, 4);
        const life = 0.8 + 0.8 * hash(b, j, 5);
        if (age > life) continue;
        // 空氣阻力：走的距離 = v·(1 − e^(−kt))/k
        const d = (sp * (1 - Math.exp(-2.4 * age))) / 2.4, d2 = (sp * (1 - Math.exp(-2.4 * Math.max(0, age - 0.03)))) / 2.4;
        const x = x0 + Math.cos(a) * d, y = y0 + Math.sin(a) * d - 30 * age;
        const xb = x0 + Math.cos(a) * d2, yb = y0 + Math.sin(a) * d2 - 30 * Math.max(0, age - 0.03);
        this.lines.seg2(xb, yb, x, y, 1.6 + 1.6 * hash(b, j, 6), dust, 0.55 * (1 - age / life));
      }
    }
  }

  /** 右欄：留言、署名、印；上方頁眉、印面下的標籤、註腳。 */
  private drawTxt(t: number, stamped: boolean) {
    const m = this.msg, fit = this.fit;
    let shown = 0, n = 0, sigK = 0;
    if (m && fit) {
      n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const dur = clamp(0.055 * n + 0.4, 0.7, 2.2);
      shown = n * prog(t, this.t0 + 0.05, this.t0 + 0.05 + dur);
      sigK = prog(t, this.t0 + dur + 0.1, this.t0 + dur + 0.5);
    }
    // 蓋下去的那 0.12 秒：印從大一點、淡一點壓到紙上（每格都要重畫）
    const land = stamped ? prog(t, this.tStamp, this.tStamp + 0.12, ease.outCubic) : 0;
    const key = `${Math.floor(shown * 3)}|${Math.round(sigK * 8)}|${stamped ? Math.round(land * 40) : -1}`;
    if (key === this.txtKey) return;
    this.txtKey = key;
    const L = this.txt, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-TXT_R.x, -TXT_R.y);
    // 頁眉
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('sepia', 0.45);
    c.fillText('篆刻 · 印譜', BAND.x, 108);
    c.letterSpacing = '0px';
    // 註腳
    c.font = font(F.hei(500), 20);
    c.fillStyle = rgba('sepia', 0.42);
    c.fillText(FOOT, BAND.x, BAND.y + BAND.h + 50);
    // 留言
    const Y = this.layoutY;
    if (m && fit) {
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = rgba('sepia', 0.95);
      let left = shown;
      fit.lines.forEach((ln, i) => {
        if (left <= 0) return;
        const chars = Array.from(ln);
        const part = left >= chars.length ? ln : chars.slice(0, Math.floor(left)).join('');
        left -= chars.length;
        fillWithHearts(c, part, COL.x, Y.msg + i * fit.lineHeight);
      });
      if (sigK > 0) {
        c.globalAlpha = sigK;
        c.font = font(FAM_MSG, this.sigSize);
        c.fillStyle = rgba('sepia', 0.72);
        const sig = signature(m.name), sw = c.measureText(sig).width;
        c.fillText(sig, Y.px - 30 - sw, Y.sig + this.sigSize * 0.35);
        c.globalAlpha = 1;
      }
    } else {
      c.font = font(FAM_MSG, 54);
      c.fillStyle = rgba('sepia', 0.85);
      INVITE.forEach((ln, i) => c.fillText(ln, COL.x, Y.msg + 40 + i * 76));
    }
    // 印：蓋下去的那一刻才出現在署名旁邊
    if (stamped && this.print) {
      c.save();
      c.globalAlpha = 0.35 + 0.65 * land;
      c.translate(Y.px + PRINT / 2, Y.py + PRINT / 2);
      c.rotate(-0.03 - 0.05 * (1 - land));
      const sc = 1.25 - 0.25 * land;
      c.scale(sc, sc);
      c.drawImage(this.print, -PRINT / 2, -PRINT / 2, PRINT, PRINT);
      c.restore();
    }
    c.restore();
    L.upload();
  }

  /** 拓片上的歌詞（紙色的字，唱到的是訊號色）；沒有歌詞時拓的是歌名。蓋印的那一下也畫在這一層上面（印的範圍另外算）。 */
  private drawBand(t: number, vis: number, ly: ReturnType<typeof lyricAt>) {
    const L = this.band, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-(BAND.x - 20), -(BAND.y - 10));
    c.globalAlpha = vis;
    const bx = BAND.x + 40, bw = BAND.w - 80;
    if (ly) {
      const size = lyricV2(this.fit ? this.fit.size : null);
      const st: LyricStyle = { family: F.ming(700), size, minSize: V2.lyrMin, maxWidth: bw, active: rgba('signal'), sung: rgba('paper', 0.94), unsung: rgba('paper', 0.28) };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      c.translate(bx, BAND.y + BAND.h / 2 + lay.size * 0.36 - (lay.height - lay.size) / 2 + (1 - inK) * 12);
      drawLyric(c, ly.line, t, st, lay, ly.k * vis);
    } else {
      const { song } = this.ctx;
      // 間奏：拓片上只有淡淡的歌名（像拓得不清楚的舊款），不搶留言
      c.font = font(F.ming(700), 34);
      c.letterSpacing = '6px';
      c.fillStyle = rgba('paper', 0.32);
      c.fillText(`${song.title}${song.artist ? '　' + song.artist : ''}`, bx, BAND.y + BAND.h / 2 + 12);
      c.letterSpacing = '0px';
    }
    c.restore();
  }
}
