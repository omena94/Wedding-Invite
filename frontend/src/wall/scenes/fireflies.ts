// 螢火蟲排字（暗、雙語）：夏夜的林邊草地，左邊一座木造涼亭，右邊是一片長草與遠處的樹林，天上幾顆星。
//  - 歌詞是螢火蟲排出來的字：每一句開始前，草叢裡的螢火蟲一群一群飛上來，停在字的筆畫上排成字——中文在上（大），原文在下（小一號）。
//    一群螢火蟲發的光讓整個字微微亮起來（字讀得清楚）；每一拍全部一起閃一下（螢火蟲同步閃光）。唱到的字變成訊號色、最亮，
//    唱完的字是暖光，還沒唱的暗暗的；原文比較安靜（唱到、唱完都是暖白）。唱完之後，這一句的螢火蟲照唱的順序散開、飛走，
//    下一句的螢火蟲接著飛上來。沒有翻譯的歌：只有中文一行（不留空的第二行）。純音樂：螢火蟲排新人的名字與日期，每四小節散開再排一次。
//  - 主打留言：涼亭橫樑下用兩條繩子吊著的一塊深色木匾（刻字、字填了淡色的漆），旁邊一盞小燈籠照著它，木匾跟著風輕輕晃。
//    照「留言尺寸與版面比例標準 v2」：字 40～60、署名 26～32、木匾 ≤ 860 × 430。
//  - 一直在動：草地上一直有零星的螢火蟲在飛、一閃一閃；每個小節線草叢裡飛起一小群；長草在前景跟著風擺；燈籠的火苗在晃。
//    鏡頭慢慢推近。右下角（QR）是暗暗的草叢，螢火蟲不飛進去。
// 手法：夜空、星、樹林剪影、草地、地上的霧、前景的長草是一個全螢幕 shader；涼亭、木匾、燈籠畫在一張 Canvas 圖層（涼亭與木匾先畫好）；
// 螢火蟲是 LineBatch 的點（加亮混合，會發光），位置全是時間的函數（飛來、停在字上、散開）；字的微光是半解析度的 Canvas 層加亮疊上去。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { lyricSubOf, type Line } from '../engine/lyrics';
import { beatAfter, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { sigOf, layMsgV2, winBars, lastBefore, type MsgLay, type Rect } from './_t23';
import { lyricV2 } from './_v2';
import { B5_TEXT, B5_INVITE, subPx, layBilingual, glyphProgress, type BGlyph } from './_b5';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'light', paper: false, energy: [0.1, 0.7], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（畫面座標，y 向下）
const HORIZON = 600;
/** 螢火蟲排的字：主行第一排基線、範圍（中間偏右，涼亭在左邊）。 */
const TXT = { x: 1130, y: 214, w: 1240 };
/** 涼亭（左）：屋頂的頂點、屋簷的左右、柱子。 */
const PAV = { x0: 40, x1: 940, eave: 470, peak: 330, beam: 520, ground: 1010 };
const FAM_FLY = F.hei(700);
const FAM_MSG = F.ming(700);
const NAMB = 150;
const CAP = 9000;

const BG = () => new FSPass(/* glsl */ `
  uniform float uT; uniform vec3 uCam; uniform float uGlow; uniform float uWind;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = (sp - vec2(960.0, 540.0 + uCam.y)) / uCam.x + vec2(960.0, 540.0);
    float hz = ${HORIZON}.0;
    // 夜空：很深的藍黑，地平線帶一點暖（遠處的燈）
    vec3 col = mix(C_INK * 0.6, mix(C_INK2, C_BLOOD, 0.14), smoothstep(-100.0, hz, p.y));
    // 星：很淡、很少
    vec2 sc = floor(p / 7.0);
    float st = hash12(sc);
    col += C_BONE * step(0.9965, st) * (0.25 + 0.2 * sin(uT * (1.0 + st * 3.0) + st * 40.0)) * smoothstep(hz, 0.0, p.y);
    // 樹林：兩層剪影（遠的淡、近的深），樹頂一團一團
    float far = hz - 70.0 - 60.0 * fbm(vec2(p.x * 0.004, 1.3), 4) - 30.0 * fbm(vec2(p.x * 0.02, 4.1), 2);
    col = mix(col, mix(C_INK2, C_BLOOD, 0.08) * 0.7, smoothstep(far - 1.5, far + 1.5, p.y));
    float near = hz - 10.0 - 90.0 * smoothstep(0.1, 0.8, fbm(vec2(p.x * 0.003 + 7.0, 2.2), 4) + 0.35) - 24.0 * fbm(vec2(p.x * 0.025, 8.0), 2);
    col = mix(col, C_INK * 0.7, smoothstep(near - 1.5, near + 1.5, p.y));
    // 草地：遠的暗、近的亮一點點，細細的草紋
    if (p.y > hz) {
      float d = clamp((p.y - hz) / (${H}.0 - hz), 0.0, 1.0);
      float blade = 0.8 + 0.2 * snoise(vec2(p.x * 0.07, p.y * 0.015)) + 0.1 * snoise(vec2(p.x * 0.3, p.y * 0.04));
      vec3 g = mix(C_INK2 * 0.45, mix(C_INK2, C_BLOOD, 0.1) * 0.75, d) * blade;
      col = mix(col, g, smoothstep(hz, hz + 4.0, p.y));
    }
    // 地上的霧：地平線附近一條淡淡的，慢慢飄
    float fog = exp(-pow((p.y - hz - 10.0) / 60.0, 2.0)) * (0.6 + 0.4 * fbm(vec2(p.x * 0.003 - uT * 0.02, uT * 0.01), 3));
    col += mix(C_ASH, C_SIGNAL, 0.2) * 0.035 * fog;
    // 螢火蟲把字附近的空氣照亮一點點
    col += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.04 * uGlow * exp(-pow(length((p - vec2(${TXT.x}.0, ${TXT.y + 30}.0)) / vec2(700.0, 200.0)), 2.0));
    // 前景的長草：畫面最下緣一排細長的剪影，跟著風擺
    float bx = sp.x / 11.0;
    float ci = floor(bx), cf = fract(bx) - 0.5;
    float hh = hash11(ci * 1.37);
    float bh = 60.0 + 150.0 * hh * hh;
    float by = ${H}.0 - sp.y;
    float lean = (0.25 + 0.5 * hh) * (sin(uT * 1.3 + ci * 0.21) * 0.6 + uWind) * (by / bh) * (by / bh) * 26.0;
    float bw = 0.9 * (1.0 - by / bh);
    float blade2 = step(by, bh) * (1.0 - smoothstep(bw - 0.1, bw + 0.1, abs(cf * 11.0 - lean) / 5.0));
    col = mix(col, C_INK * 0.4, blade2 * step(0.35, hh));
    // 右下角（QR 與小字）：暗暗的草叢
    col *= 1.0 - 0.5 * smoothstep(1250.0, 1480.0, sp.x) * smoothstep(740.0, 880.0, sp.y);
    fragColor = vec4(col, 1.0);
  }`, { uT: { value: 0 }, uCam: { value: new THREE.Vector3(1, 0, 0) }, uGlow: { value: 0 }, uWind: { value: 0 } });

/** 一隻排字的螢火蟲：停在哪、從哪飛來、往哪飛走、什麼時候到、什麼時候走、屬於哪個字。 */
interface Fly { tx: number; ty: number; ox: number; oy: number; ax: number; ay: number; ta: number; td: number; g: BGlyph; ph: number; sz: number }
/** 一句：字（畫微光用）、這一句的螢火蟲、什麼時候排好、什麼時候散。 */
interface Swarm { main: BGlyph[]; sub: BGlyph[]; mainSize: number; subSize: number; flies: Fly[]; t0: number; t1: number; fake: boolean; land: Map<BGlyph, [number, number]> }

export default class Fireflies extends Scene {
  bg = shared('fireflies.bg', BG);
  dots = this.track(new LineBatch(CAP, { screen2D: true, blend: 'add' }));
  L = this.track(new Layer2D(W, H, undefined, { fast: true }));
  G = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 233 + (this.msg?.id ?? 0) * 53) >>> 0;
  lay: MsgLay | null = null;
  tOn = 0;
  bars: number[] = [];
  swarms: Swarm[] = [];
  pavCv: HTMLCanvasElement | null = null;
  boardCv: HTMLCanvasElement | null = null;
  board = { x: 0, y: 0, w: 0, h: 0 };
  lineT: number[] = [];
  sigT = Infinity;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    const sig = m ? sigOf(m) : '';
    const subs = lines.map((l) => lyricSubOf(l)?.text ?? '').join('');
    await loadText(`${B5_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}${subs}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    const bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    this.bars = winBars(au, s - 4, e + 1);
    const c = this.L.ctx;

    // ---- 留言：木匾（先在 (0,0) 起算的框裡排）
    let msgPx: number | null = null;
    if (m) {
      this.lay = layMsgV2(c, m.text, sig, FAM_MSG, { x: 0, y: 0, w: 680, h: 310 }, { lineHeight: 1.3, maxLines: 5, sigFamily: F.ming(400), align: 'left', valign: 'top' });
      msgPx = this.lay.fit.size;
      const n = this.lay.lines.length;
      this.lineT = this.lay.lines.map((_, i) => this.tOn + beat * 0.5 + (i * Math.min(bar, beat * 4)) / Math.max(1, n));
      this.sigT = (this.lineT[n - 1] ?? this.tOn) + beat;
    }
    this.drawPavilion();
    this.drawBoard();

    // ---- 螢火蟲排的字：每一句取樣成點
    const size = lyricV2(msgPx);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const sc = cv.getContext('2d', { willReadFrequently: true })!;
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    let fid = 0;
    /**
     * 螢火蟲停的位置：只取字的外緣（旁邊是空的地方），再往外推一點——停好之後螢火蟲是圍在字外面的一圈小光點（裝飾），
     * 字本身另外用實心的光畫（見 render），筆畫才不會被點點打散、讀不出來。
     */
    const sample = (g: BGlyph, st: number, out: { x: number; y: number }[]) => {
      sc.clearRect(0, 0, W, H);
      sc.fillStyle = '#fff'; sc.textBaseline = 'alphabetic';
      if (g.ch === '♥') drawHeart(sc, g.x + g.w / 2, g.y - g.size * 0.36, g.size * 0.8, '#fff');
      else { sc.font = font(FAM_FLY, g.size); sc.fillText(g.ch, g.x, g.y); }
      const x0 = Math.floor(g.x - 8), y0 = Math.floor(g.y - g.size * 1.1), iw = Math.ceil(g.w + 16), ih = Math.ceil(g.size * 1.5);
      const img = sc.getImageData(x0, y0, Math.max(1, iw), Math.max(1, ih)).data;
      const A = (x: number, y: number) => (x < 0 || y < 0 || x >= iw || y >= ih ? 0 : img[(Math.floor(y) * iw + Math.floor(x)) * 4 + 3]!);
      const d = Math.max(2, g.size * 0.05), push = 2 + g.size * 0.06;
      const jx = rnd(fid, 3) * st, jy = rnd(fid, 4) * st;
      for (let y = jy; y < ih; y += st) for (let x = jx; x < iw; x += st) {
        if (A(x, y) < 120) continue;
        // 往空的方向推（外緣的法線）
        let nx = 0, ny = 0;
        for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, d], [d, -d], [-d, -d]] as const) if (A(x + dx, y + dy) < 40) { nx += dx; ny += dy; }
        const nl = Math.hypot(nx, ny);
        if (nl < 1e-3 || hash(this.seed, x0 + x, y0 + y) < 0.35) continue;
        out.push({ x: x0 + x + (nx / nl) * push, y: y0 + y + (ny / nl) * push });
      }
    };
    const build = (line: Line, t0: number, t1: number, fake: boolean): Swarm => {
      const L = layBilingual(c, line, { family: FAM_FLY, size, maxW: TXT.w, x: TXT.x, y: TXT.y, lineHeight: 1.25, gap: size * 0.5 + subPx(size) });
      const flies: Fly[] = [];
      const all = [...L.main, ...L.sub];
      const n = all.length;
      all.forEach((g, gi) => {
        const pts: { x: number; y: number }[] = [];
        sample(g, g.sub ? 3.6 : 4.6, pts);
        // 散開的時間：照唱的順序（第幾個字），一個字接一個字飛走
        const order = g.sub ? L.main.length ? (gi - L.main.length) / Math.max(1, L.sub.length) : gi / n : gi / Math.max(1, L.main.length);
        for (const p of pts) {
          const i = fid++;
          // 從草地上（字的下面、兩邊）飛來；往上、往外飛走
          const ox = p.x + (rnd(i, 1) - 0.5) * 700, oy = HORIZON + 40 + rnd(i, 2) * 300;
          const aa = -Math.PI / 2 + (rnd(i, 5) - 0.5) * 2.2;
          flies.push({
            tx: p.x, ty: p.y, ox: clamp(ox, 60, 1860), oy: Math.min(oy, inHud(ox, oy) ? 780 : oy),
            ax: Math.cos(aa), ay: Math.sin(aa),
            ta: t0 + (g.sub ? 0.25 : 0) + rnd(i, 6) * 0.5 + ((p.x - (TXT.x - TXT.w / 2)) / TXT.w) * 0.4,
            td: t1 + order * 0.8 + rnd(i, 7) * 0.25,
            g, ph: rnd(i, 8) * TAU, sz: g.sub ? 2.6 + 0.9 * rnd(i, 9) : 3.2 + 1.4 * rnd(i, 9),
          });
        }
      });
      // 每個字：最後一隻螢火蟲停好的時間（字亮起來）、第一隻飛走的時間（字退掉）
      const land = new Map<BGlyph, [number, number]>();
      for (const fl of flies) { const v = land.get(fl.g) ?? [-Infinity, Infinity]; land.set(fl.g, [Math.max(v[0], fl.ta), Math.min(v[1], fl.td)]); }
      for (const gl of all) if (!land.has(gl)) land.set(gl, [t0 + 1, t1]);
      return { main: L.main, sub: L.sub, mainSize: L.mainSize, subSize: L.subSize, flies, t0, t1, fake, land };
    };
    lines.forEach((ln, i) => {
      const nx = lines[i + 1];
      // 提早 1.4 秒開始飛上來（唱的那一刻字已經排好）；下一句要開始前（或唱完一陣子）散開
      const t1 = nx ? Math.max(ln.end + 0.2, nx.start - 1.6) : ln.end + 1.4;
      this.swarms.push(build(ln, ln.start - 1.5, t1, false));
    });
    if (!lines.length) {
      // 純音樂：每四小節排一次新人的名字與日期
      for (let t0 = this.tOn - 1.2; t0 < e - beat; t0 += bar * 4) {
        const fk = fakeLine(COUPLE_ZH, DATE_DOTS, t0 + 1.2, beat);
        this.swarms.push(build(fk, t0, Math.min(t0 + bar * 4 - 1.2, e + 2), true));
      }
    }
    const b = this.board;
    this.avoid = [[b.x, b.y, b.w, b.h], [TXT.x - TXT.w / 2, TXT.y - 70, TXT.w, 200]];
  }

  /** 涼亭：翹起來的屋簷、屋頂的瓦溝、兩根柱子、欄杆與坐板（剪影，靠燈籠那一側有暖暖的邊光）。先畫好。 */
  private drawPavilion() {
    const S = 1, cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    const g = cv.getContext('2d')!;
    const ink = mixRgba('ink', 'ink2', 0.5), rim = mixRgba('blood', 'signal', 0.4, 0.5);
    const { x0, x1, eave, peak, beam, ground } = PAV;
    const cx = (x0 + x1) / 2;
    // 柱子
    for (const px of [x0 + 90, x1 - 90]) {
      g.fillStyle = ink; g.fillRect(px - 14, eave - 10, 28, ground - eave + 10);
      g.fillStyle = rim; g.fillRect(px + (px < cx ? 10 : -14), eave + 60, 4, ground - eave - 60);
    }
    // 橫樑、樑下的雕花（一排小弧）
    g.fillStyle = ink; g.fillRect(x0 + 60, beam - 28, x1 - x0 - 120, 30);
    g.strokeStyle = ink; g.lineWidth = 5;
    for (let x = x0 + 110; x < x1 - 110; x += 44) { g.beginPath(); g.arc(x + 22, beam, 20, 0, Math.PI); g.stroke(); }
    // 欄杆、坐板
    g.fillStyle = ink; g.fillRect(x0 + 76, ground - 150, x1 - x0 - 152, 16); g.fillRect(x0 + 76, ground - 70, x1 - x0 - 152, 12);
    for (let x = x0 + 110; x < x1 - 110; x += 36) g.fillRect(x, ground - 150, 7, 80);
    // 屋頂：兩邊往上翹的屋簷（曲線）、瓦溝的細線
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(x0 - 20, eave - 40);
    g.quadraticCurveTo(x0 + 80, eave + 8, cx - 150, peak + 70);
    g.lineTo(cx - 40, peak); g.lineTo(cx + 40, peak); g.lineTo(cx + 150, peak + 70);
    g.quadraticCurveTo(x1 - 80, eave + 8, x1 + 20, eave - 40);
    g.lineTo(x1 - 30, eave + 12); g.lineTo(x0 + 30, eave + 12); g.closePath(); g.fill();
    g.strokeStyle = rgba('graphite', 0.35); g.lineWidth = 1.5;
    for (let k = -8; k <= 8; k++) {
      const bx = cx + k * 44;
      g.beginPath(); g.moveTo(cx + k * 9, peak + 6); g.quadraticCurveTo(bx, eave - 40, cx + k * 52, eave + 6); g.stroke();
    }
    // 屋脊上的一顆寶頂
    g.fillStyle = ink; g.beginPath(); g.arc(cx, peak - 16, 14, 0, TAU); g.fill(); g.fillRect(cx - 4, peak - 40, 8, 26);
    // 屋簷下緣被燈籠照亮的一條暖邊
    g.strokeStyle = mixRgba('blood', 'signal', 0.4, 0.35); g.lineWidth = 3;
    g.beginPath(); g.moveTo(x0 + 30, eave + 12); g.lineTo(x1 - 30, eave + 12); g.stroke();
    this.pavCv = cv;
  }

  /** 木匾：深色的木頭、刻字填淡色漆、四角的鐵件。字排在 (0,0) 起算的框裡，這裡照字的大小決定木匾的大小。 */
  private drawBoard() {
    const lay = this.lay;
    const pad = { x: 50, t: 44, b: 36 };
    let w: number, h: number;
    if (lay) { const [bx, by, bw, bh] = lay.box; w = Math.min(800, Math.max(440, bx + bw + pad.x * 2)); h = Math.min(400, by + bh + pad.t + pad.b); }
    else { w = 560; h = 170; }
    const cx = (PAV.x0 + PAV.x1) / 2;
    this.board = { x: cx - w / 2, y: PAV.beam + 70, w, h };
    const S = 2, cv = document.createElement('canvas');
    cv.width = w * S; cv.height = h * S;
    const g = cv.getContext('2d')!; g.scale(S, S);
    const wood = mixRgba(mixRgba('sepia', 'blood', 0.35), 'ink', 0.35);
    g.fillStyle = wood; g.beginPath(); g.roundRect(0, 0, w, h, 8); g.fill();
    for (let k = 0; k < 26; k++) {
      const y = h * hash(this.seed, k, 11);
      g.strokeStyle = hash(this.seed, k, 12) > 0.5 ? rgba('ink', 0.3) : mixRgba(wood, 'bone', 0.1, 0.4);
      g.lineWidth = 0.8 + hash(this.seed, k, 13);
      g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 30) g.lineTo(x, y + 3 * Math.sin(x * 0.01 + k)); g.stroke();
    }
    // 內框：一圈凹下去的邊
    g.strokeStyle = rgba('ink', 0.55); g.lineWidth = 3; g.beginPath(); g.roundRect(12, 12, w - 24, h - 24, 5); g.stroke();
    g.strokeStyle = mixRgba(wood, 'bone', 0.18); g.lineWidth = 1; g.beginPath(); g.roundRect(15, 15, w - 30, h - 30, 4); g.stroke();
    // 四角的鐵件
    for (const [x, y] of [[6, 6], [w - 30, 6], [6, h - 30], [w - 30, h - 30]] as const) { g.fillStyle = rgba('graphite', 0.85); g.fillRect(x, y, 24, 24); g.fillStyle = rgba('ash', 0.5); g.beginPath(); g.arc(x + 12, y + 12, 3, 0, TAU); g.fill(); }
    // 刻字：先一層暗的（刻痕的陰影），再一層淡色的漆
    g.textBaseline = 'alphabetic';
    const paint = (dx: number, dy: number, color: string) => {
      g.save(); g.translate(pad.x + dx, pad.t + dy); g.fillStyle = color;
      if (lay) {
        g.font = font(FAM_MSG, lay.fit.size);
        for (const ln of lay.lines) fillHearts(g, ln.text, ln.x, ln.y, lay.fit.size, color === rgba('ink', 0.7));
        g.font = font(lay.sig.family, lay.sig.size); g.fillText(lay.sig.text, lay.sig.x, lay.sig.y);
      } else {
        g.font = font(FAM_MSG, 44); g.fillText(`給 ${COUPLE_ZH}`, 0, 46);
        g.font = font(F.hei(500), 20); g.letterSpacing = '2px'; g.fillText(B5_INVITE, 0, 94); g.letterSpacing = '0px';
      }
      g.restore();
    };
    paint(-1.5, -1.5, rgba('ink', 0.7));
    paint(0, 0, mixRgba('bone', 'paper', 0.35, 0.94));
    this.boardCv = cv;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const z = 1 + 0.035 * drift, oy = 30 * (1 - land);
    const X = (x: number) => (x - 960) * z + 960, Y = (y: number) => (y - 540) * z + 540 + oy;
    const bp = au.beatAt(t), flash = Math.exp(-((bp - Math.floor(bp)) * au.beatPeriod(t)) / 0.13);
    const tb = lastBefore(this.bars, t), since = t - tb;
    const wind = since >= 0 && since < 2.5 ? 0.9 * Math.exp(-since / 0.8) * Math.sin(since * 4) : 0;

    // ---- 這一格有哪幾群螢火蟲在排字
    const live = this.swarms.filter((sw) => t > sw.t0 - 0.2 && t < sw.t1 + 3);
    const glowAmt = live.reduce((a, sw) => Math.max(a, prog(t, sw.t0 + 0.8, sw.t0 + 1.6) * (1 - prog(t, sw.t1, sw.t1 + 1.2))), 0);

    const u = this.bg.u;
    u.uT!.value = t; u.uGlow!.value = glowAmt * (1 + 0.4 * flash); u.uWind!.value = wind;
    (u.uCam!.value as THREE.Vector3).set(z, oy, 0);
    this.bg.render(renderer, out);

    // ---- 涼亭、木匾、燈籠
    const c = this.L.ctx, g = this.G.ctx;
    this.L.clear(); this.G.clear();
    c.setTransform(z, 0, 0, z, 960 - 960 * z, 540 - 540 * z + oy);
    g.setTransform(z, 0, 0, z, 960 - 960 * z, 540 - 540 * z + oy);
    c.drawImage(this.pavCv!, 0, 0, W, H);
    this.drawBoardFrame(c, g, t, wind);

    // ---- 字：一個字的螢火蟲一停好，那個字就用實心的淡暖光浮出來（還沒唱也讀得到整句）；唱到了亮成訊號色、唱完是暖白。
    //      清楚的一層在 c，柔的光暈在 g 加亮；那個字的螢火蟲飛走時字一起退掉
    for (const sw of live) {
      const draw = (gs: BGlyph[], size: number, quiet: boolean) => {
        c.font = font(FAM_FLY, size); c.textBaseline = 'alphabetic';
        g.font = font(FAM_FLY, size); g.textBaseline = 'alphabetic';
        for (const gl of gs) {
          const [tl, td] = sw.land.get(gl)!;
          const k = prog(t, tl - 0.2, tl + 0.3) * (1 - prog(t, td, td + 0.5));
          if (k <= 0) continue;
          const p = sw.fake ? (t >= gl.word.start ? 1 : 0) : glyphProgress(gl, t);
          const act = p > 0 && p < 1 && !quiet;
          const a = k * (p <= 0 ? 0.55 : act ? 1 : quiet ? 0.85 : 0.95);
          if (gl.ch === '♥') { c.globalAlpha = a; drawHeart(c, gl.x + gl.w / 2, gl.y - size * 0.36, size * 0.8, rgba('rose')); continue; }
          c.globalAlpha = a;
          c.fillStyle = p <= 0 ? mixRgba('ember', 'bone', 0.5) : act ? rgba('signal') : quiet ? mixRgba('bone', 'ember', 0.3) : mixRgba('ember', 'bone', 0.7);
          c.fillText(gl.ch, gl.x, gl.y);
          if (p > 0) {
            g.globalAlpha = k * (act ? 0.7 : 0.3) * (0.8 + 0.4 * flash);
            g.fillStyle = rgba(act ? 'signal' : 'ember');
            g.fillText(gl.ch, gl.x, gl.y);
          }
        }
      };
      draw(sw.main, sw.mainSize, false);
      draw(sw.sub, sw.subSize, true);
    }
    c.globalAlpha = 1; g.globalAlpha = 1;
    c.setTransform(1, 0, 0, 1, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, this.L.upload(), out);
    comp.draw(renderer, this.G.upload(), out, { mode: 'add', tint: [1.2, 1.2, 1.2] });

    // ---- 螢火蟲
    const lb = this.dots; lb.clear();
    const S = LIN.signal, E = LIN.ember, B = LIN.bone;
    const dot = (x: number, y: number, r: number, col: [number, number, number], k: number, a: number) => {
      if (a <= 0.005) return;
      lb.seg2(X(x), Y(y), X(x) + 0.01, Y(y), r * 3 * z, [col[0] * k * 0.3, col[1] * k * 0.3, col[2] * k * 0.3], a * 0.25);
      lb.seg2(X(x), Y(y), X(x) + 0.01, Y(y), r * z, [col[0] * k, col[1] * k, col[2] * k], a);
    };
    for (const sw of live) {
      for (const fl of sw.flies) {
        const F0 = 1.3;
        if (t < fl.ta - F0 || t > fl.td + 1.3) continue;
        let x: number, y: number, a: number;
        const wob = 1.4;
        if (t < fl.ta) {
          // 飛上來：從草地出發，走一條彎的路，快到的時候慢下來
          const k = ease.outCubic((t - (fl.ta - F0)) / F0);
          const mx = lerp(fl.ox, fl.tx, 0.5) + 120 * Math.sin(fl.ph), my = lerp(fl.oy, fl.ty, 0.5) + 60;
          x = (1 - k) * (1 - k) * fl.ox + 2 * k * (1 - k) * mx + k * k * fl.tx;
          y = (1 - k) * (1 - k) * fl.oy + 2 * k * (1 - k) * my + k * k * fl.ty;
          a = 0.3 + 0.7 * k;
        } else if (t < fl.td) {
          // 停好了：圍在字外面的小光點（裝飾，比飛的時候小、暗），字本身是主角
          x = fl.tx + wob * Math.sin(t * 2.3 + fl.ph); y = fl.ty + wob * Math.cos(t * 1.9 + fl.ph * 1.3);
          a = 0.55;
        } else {
          // 散開：往上、往外飛走，慢慢暗掉
          const v = (t - fl.td) / 1.3;
          x = fl.tx + fl.ax * 320 * v ** 1.2 + 30 * Math.sin(t * 3 + fl.ph); y = fl.ty + fl.ay * 240 * v ** 1.2;
          a = (1 - v) ** 2;
        }
        const p = sw.fake ? (t >= fl.g.word.start ? 1 : 0) : glyphProgress(fl.g, t);
        const on = p > 0 && p < 1 && !fl.g.sub;
        const col = on ? S : p >= 1 ? (fl.g.sub ? B : E) : E;
        // 每隻螢火蟲自己也一閃一閃（停在字上的時候閃得比較慢、比較亮）
        const own = 0.55 + 0.45 * Math.max(0, Math.sin(t * (1.6 + fl.ph * 0.2) + fl.ph * 5)) ** 2;
        const landed = t >= fl.ta && t < fl.td;
        const k = (on ? 3 : p >= 1 ? 2 : 1.3) * (0.75 + 0.7 * flash) * own * (landed ? 0.7 : 1);
        dot(x, y, fl.sz * (landed ? 0.62 : on ? 1.2 : 1), col, k, a);
      }
    }
    // 零星的螢火蟲：在草地與涼亭四周慢慢飛、一閃一閃；每個小節線草叢裡飛起一小群
    for (let i = 0; i < NAMB; i++) {
      const hx = hash(this.seed, i, 21), hy = hash(this.seed, i, 22), hw = hash(this.seed, i, 23);
      let x = hx * 1920 + 60 * Math.sin(t * (0.3 + 0.4 * hw) + i) + 25 * Math.sin(t * 1.3 + i * 2.1);
      let y = HORIZON - 60 + hy * 420 + 30 * Math.sin(t * (0.25 + 0.3 * hw) + i * 1.7);
      const group = i < 24;
      if (group && since >= 0 && since < 3) {
        // 小節線：這一小群從草叢裡飛起來
        const cx0 = 200 + hash(this.seed, Math.round(au.barAt(tb)), 31) * 1000;
        x = cx0 + (hx - 0.5) * 240 + 20 * Math.sin(t * 2 + i); y = 960 - since * (120 + 160 * hy) + 12 * Math.sin(t * 3 + i);
      }
      if (inHud(x, y)) continue;
      const blink = Math.max(0, Math.sin(t * (0.9 + 1.2 * hw) + i * 1.9)) ** 4;
      const a = (group && since >= 0 && since < 3 ? 0.9 * (1 - since / 3) : blink) * clamp((1080 - y) / 80);
      dot(x, y, 2.6 + 1.6 * hy, E, 1.4, a);
    }
    lb.render(renderer, out);
    return { bloom: 0.85, bloomThreshold: 0.85, vignette: 0.6, halation: 0.35, popupAvoid: this.avoid };
  }

  /** 木匾：兩條繩子吊在橫樑下，跟著風輕輕晃；旁邊一盞小燈籠照著它。留言一行一行被燈照亮。 */
  private drawBoardFrame(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, t: number, wind: number) {
    const b = this.board, S = 2;
    const swing = 0.012 * Math.sin(t * 1.1) + 0.02 * wind;
    const rise = ease.outBack(prog(t, this.ctx.start, this.tOn + 0.25));
    const drop = -30 * (1 - rise);
    c.save();
    c.translate(b.x + b.w / 2, PAV.beam); c.rotate(swing); c.translate(-(b.x + b.w / 2), -PAV.beam);
    // 繩子
    c.strokeStyle = mixRgba('ash', 'sepia', 0.4, 0.8); c.lineWidth = 2.2;
    for (const fx of [0.18, 0.82]) { c.beginPath(); c.moveTo(b.x + b.w * fx, PAV.beam); c.lineTo(b.x + b.w * fx, b.y + drop + 4); c.stroke(); }
    c.drawImage(this.boardCv!, b.x, b.y + drop, b.w, b.h);
    // 字還沒被照到的地方蓋一層木頭色（一行一行揭開）
    if (this.lay) {
      const lay = this.lay, pad = { x: 50, t: 44 };
      lay.lines.forEach((ln, i) => {
        const a = 1 - prog(t, this.lineT[i]!, this.lineT[i]! + 0.5, ease.outCubic);
        if (a <= 0) return;
        c.fillStyle = mixRgba(mixRgba('sepia', 'blood', 0.35), 'ink', 0.35, a * 0.92);
        c.fillRect(b.x + pad.x - 6, b.y + drop + pad.t + ln.y - lay.fit.size - 2, b.w - pad.x * 2 + 12, lay.fit.lineHeight);
      });
      const sa = 1 - prog(t, this.sigT, this.sigT + 0.4);
      if (sa > 0) { c.fillStyle = mixRgba(mixRgba('sepia', 'blood', 0.35), 'ink', 0.35, sa * 0.92); c.fillRect(b.x + pad.x - 6, b.y + drop + pad.t + lay.sig.y - lay.sig.size - 4, b.w - pad.x * 2 + 12, lay.sig.size * 1.5); }
    }
    c.restore();
    // 燈籠：掛在木匾右邊的屋簷下，火苗一直在晃
    const lx = b.x + b.w + 56, ly = PAV.eave + 110 + 6 * Math.sin(t * 1.3);
    const fl = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.7);
    c.strokeStyle = rgba('ink', 0.9); c.lineWidth = 2; c.beginPath(); c.moveTo(lx, PAV.eave + 10); c.lineTo(lx, ly - 34); c.stroke();
    const lg = c.createRadialGradient(lx, ly, 4, lx, ly, 34);
    lg.addColorStop(0, mixRgba('ember', 'bone', 0.3, 0.95 * fl)); lg.addColorStop(1, mixRgba('signal', 'blood', 0.4, 0.9));
    c.fillStyle = lg; c.beginPath(); c.ellipse(lx, ly, 26, 32, 0, 0, TAU); c.fill();
    c.strokeStyle = mixRgba('blood', 'ink', 0.3, 0.6); c.lineWidth = 1.2;
    for (const k of [-14, 0, 14]) { c.beginPath(); c.ellipse(lx, ly, Math.abs(26 - Math.abs(k) * 0.9) * (k ? 0.6 : 0.02) + (k ? 0 : 0.5), 32, 0, 0, TAU); c.stroke(); }
    c.fillStyle = rgba('ink', 0.9); c.fillRect(lx - 12, ly - 36, 24, 6); c.fillRect(lx - 12, ly + 30, 24, 6);
    const hr = 120;
    const hg = g.createRadialGradient(lx, ly, 0, lx, ly, hr);
    hg.addColorStop(0, mixRgba('signal', 'ember', 0.5, 0.4 * fl)); hg.addColorStop(0.4, rgba('signal', 0.08 * fl)); hg.addColorStop(1, rgba('signal', 0));
    g.fillStyle = hg; g.fillRect(lx - hr, ly - hr, 2 * hr, 2 * hr);
  }
}

const inHud = (x: number, y: number) => x > 1320 && y > 800;

/** 純音樂用的假歌詞行：主行（名字）半拍亮一個字、副行（日期）接在後面。 */
function fakeLine(main: string, sub: string, t0: number, beat: number): Line {
  let k = 0;
  const mk = (text: string): Line => {
    const chars = Array.from(text);
    const words = chars.map((ch, j) => {
      const st = t0 + k * beat * 0.5;
      if (ch.trim()) k++;
      return { w: ch, start: st, end: st + beat * 0.45, line: 0, index: j, gi: 0, o: chars.slice(0, j).join('').length };
    }).filter((w) => w.w.trim());
    return { i: 0, text, start: t0, end: t0 + k * beat * 0.5, words };
  };
  const line = mk(main);
  line.sub = mk(sub);
  return line;
}

/** 刻字（♥ 用自己畫的愛心；陰影那一層愛心也用陰影色）。 */
function fillHearts(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, shadow: boolean) {
  let cx = x;
  for (const part of text.split(/(♥)/u)) {
    if (!part) continue;
    if (part === '♥') { const fs = g.fillStyle; drawHeart(g, cx + size * 0.45, y - size * 0.34, size * 0.72, shadow ? (fs as string) : rgba('rose')); g.fillStyle = fs; cx += size * 0.95; continue; }
    g.fillText(part, cx, y);
    cx += g.measureText(part).width;
  }
}
