// 河燈（暗、雙語）：夜晚的河面，對岸是一排矮房子與樹的剪影、幾盞遠遠的窗燈，月亮在右上，倒影在水裡一直晃。
//  - 歌詞寫在一盞一盞紙河燈上，河燈從左邊（上游）順流漂進來，排成兩排：後面一排是大一點的河燈，每盞一個中文字；
//    前面一排是小一號的河燈，寫原文（韓文一盞一個字、英文一盞一個詞）。字是墨寫在燈紙上的，燈裡的燭火一亮，字就從紙上浮出來：
//    唱到的那盞燭火燒成訊號色（最亮），唱完的是暖光，還沒唱的燈還沒點、暗暗的。一整排慢慢往右漂、上下浮；唱完之後加速漂出畫面，
//    下一句的河燈接著從左邊漂進來。沒有翻譯的歌：只有後面一排（前面一排收起來，不留空燈）。純音樂：河燈寫新人的名字與日期。
//  - 主打留言：左下最大的那盞河燈（木框、四面燈紙），正面的燈紙上用毛筆寫著留言，第一拍燭火點著、一行一行亮出來。
//    照「留言尺寸與版面比例標準 v2」：字 40～60、署名 26～32、燈（含木框）≤ 860 × 430。
//  - 一直在動：每盞燈的倒影是水面上一條晃動的光；每個小節線其中一盞燈的底下盪開一圈漣漪；遠處一直有沒寫字的小河燈漂過；
//    月亮與窗燈的倒影跟著水波晃。鏡頭慢慢推近。右下角（QR）是暗暗的水面。
// 手法：夜空、月亮、對岸、水面（波紋、月亮與窗燈的倒影）是一個全螢幕 shader；河燈、字、大燈畫在一張 Canvas 圖層上，
// 燭光與水面上的倒影光畫在半解析度的圖層上加亮疊上去（會發光）。大燈的燈紙與字在 init() 先畫好。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, TAU } from '../engine/util';
import { lyricSubOf, type Line } from '../engine/lyrics';
import { beatAfter, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { sigOf, layMsgV2, winBars, lastBefore, type MsgLay, type Rect } from './_t23';
import { V2, lyricV2 } from './_v2';
import { B5_TEXT, B5_INVITE, subPx, lineSlots, slotProgress, groupSlots, type BSlot } from './_b5';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'light', paper: false, energy: [0.1, 0.7], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（畫面座標，y 向下）
const SHORE = 322;
/** 河燈的排：燈底（水線）的 y。中文一排（太長折成兩排），原文接在中文下面一排。 */
const ROWS = [426, 506, 580];
/** 河燈排的範圍（中間偏右：左下是大燈）。 */
const ZONE = { x0: 180, x1: 1760 };
/** 大燈（留言）：左緣、水線；燈的大小照留言。 */
const BIG = { x: 110, water: 1034 };
const FAM_LAN = F.hand(700);
const FAM_MSG = F.hand(700);
/** 河燈往右漂的速度（px／秒）。 */
const DRIFT = 16;

const RIVER = () => new FSPass(/* glsl */ `
  uniform float uT; uniform vec3 uCam;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = (sp - vec2(960.0, 540.0 + uCam.y)) / uCam.x + vec2(960.0, 540.0);
    float sh = ${SHORE}.0;
    // 夜空：深藍黑，靠近月亮的地方淡一點
    vec2 moon = vec2(1540.0, 132.0);
    vec3 col = mix(C_INK * 0.7, mix(C_INK2, C_BLOOD, 0.12), smoothstep(-80.0, sh, p.y));
    col += mix(C_BONE, C_SIGNAL, 0.2) * 0.05 * exp(-length(p - moon) / 260.0);
    float md = length(p - moon);
    col = mix(col, mix(C_BONE, C_EMBER, 0.25) * 0.95, 1.0 - smoothstep(34.0, 36.0, md));
    col -= C_INK2 * 0.2 * (1.0 - smoothstep(34.0, 36.0, length(p - moon - vec2(9.0, -6.0)))) * step(md, 36.0);
    // 對岸：樹（一團一團）＋矮房子（方塊、斜屋頂），幾扇亮著的窗
    float tree = sh - 26.0 - 46.0 * smoothstep(0.1, 0.9, fbm(vec2(p.x * 0.004, 3.0), 4) + 0.45);
    float cell = floor(p.x / 96.0), cx = fract(p.x / 96.0);
    float hh = hash11(cell * 2.3);
    float house = sh - (18.0 + 34.0 * hh) - 16.0 * (1.0 - abs(cx - 0.5) * 2.0) * step(0.4, hh);
    float roof = step(0.25, hh) * step(0.08, cx) * step(cx, 0.92);
    float bank = min(tree, mix(sh, house, roof));
    col = mix(col, C_INK * 0.55, smoothstep(bank - 1.2, bank + 1.2, p.y) * step(p.y, sh + 1.0));
    vec2 wc = floor(vec2(p.x / 18.0, (p.y - sh) / 14.0));
    float win = step(0.86, hash12(wc + 3.0)) * step(house + 8.0, p.y) * step(p.y, sh - 6.0) * roof;
    col += mix(C_SIGNAL, C_EMBER, 0.5) * 0.55 * win * step(0.25, fract(p.x / 18.0)) * step(fract(p.x / 18.0), 0.75);
    // ---- 水面
    if (p.y > sh) {
      float d = (p.y - sh) / (${H}.0 - sh);
      // 波紋：越近越大、一直往右流
      float wv = sin(p.y * (0.9 - 0.6 * d) + snoise(vec2(p.x * 0.004 - uT * 0.15, p.y * 0.03)) * 3.0 + uT * 1.4);
      vec3 w = mix(C_INK2 * 0.55, C_INK * 0.8, d);
      w += C_ASH * 0.02 * smoothstep(0.6, 1.0, wv) * (1.0 - d * 0.5);
      // 月亮的倒影：一條直的、晃動的光柱
      float mx = abs(p.x - moon.x + 14.0 * sin(p.y * 0.05 + uT * 1.7) * (0.3 + d));
      float mcol = exp(-mx / (8.0 + 40.0 * d)) * smoothstep(0.2, 0.8, wv * 0.5 + 0.5) * exp(-d * 1.8);
      w += mix(C_BONE, C_EMBER, 0.3) * 0.28 * mcol;
      // 對岸窗燈的倒影：一條條細細的暖色短線
      float wx = floor(p.x / 18.0);
      float refl = step(0.86, hash12(vec2(wx, 3.0 + floor(-3.0)))) * exp(-(p.y - sh) / 70.0) * smoothstep(0.3, 0.9, wv);
      w += mix(C_SIGNAL, C_EMBER, 0.5) * 0.06 * refl;
      col = mix(col, w, smoothstep(sh, sh + 2.0, p.y));
      // 岸邊的一條亮線（水線）
      col += C_ASH * 0.05 * exp(-abs(p.y - sh - 2.0) / 2.0);
    }
    // 右下角（QR 與小字）：暗暗的水面
    col *= 1.0 - 0.55 * smoothstep(1250.0, 1480.0, sp.x) * smoothstep(740.0, 880.0, sp.y);
    fragColor = vec4(col, 1.0);
  }`, { uT: { value: 0 }, uCam: { value: new THREE.Vector3(1, 0, 0) } });

/** 一盞河燈：在這一排的位置（中心相對排的起點）、寬、高、裡面的字（一個字或一個英文詞）、第幾排、是不是原文。 */
interface Lantern { x: number; w: number; h: number; slots: BSlot[]; row: number; sub: boolean; size: number }
/** 一句的河燈：什麼時候漂進來、什麼時候漂走。 */
interface Flotilla { lanterns: Lantern[]; tin: number; tout: number; start: number; fake: boolean }

export default class RiverLanterns extends Scene {
  river = shared('riverlanterns.river', RIVER);
  L = this.track(new Layer2D(W, H, undefined, { fast: true }));
  G = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 241 + (this.msg?.id ?? 0) * 59) >>> 0;
  lay: MsgLay | null = null;
  tOn = 0;
  bars: number[] = [];
  fleets: Flotilla[] = [];
  bigCv: HTMLCanvasElement | null = null;
  inkCv: HTMLCanvasElement | null = null;
  big = { x: 0, y: 0, w: 0, h: 0 };
  lineT: number[] = [];
  sigT = Infinity;
  avoid: Rect[] = [];
  /** 這一格每盞燈的正面（光暈層要挖掉的地方）。 */
  faces: Rect[] = [];
  /** 燭光的光暈（照這首歌的配色先畫好）：一般的（暖光）、唱到的（訊號色）。 */
  halo: HTMLCanvasElement | null = null;
  haloHot: HTMLCanvasElement | null = null;

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

    // ---- 留言：大燈的燈紙（先在 (0,0) 起算的框裡排）
    let msgPx: number | null = null;
    if (m) {
      this.lay = layMsgV2(c, m.text, sig, FAM_MSG, { x: 0, y: 0, w: 640, h: 290 }, { lineHeight: 1.28, maxLines: 5, sigFamily: F.hand(400), align: 'left', valign: 'top' });
      msgPx = this.lay.fit.size;
      const n = this.lay.lines.length;
      this.lineT = this.lay.lines.map((_, i) => this.tOn + beat * 0.5 + (i * Math.min(bar, beat * 4)) / Math.max(1, n));
      this.sigT = (this.lineT[n - 1] ?? this.tOn) + beat;
    }
    this.drawBig();
    const glowSprite = (col: 'ember' | 'signal', a: number) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const gg = cv.getContext('2d')!, gr = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba('signal', 0));
      gg.fillStyle = gr; gg.fillRect(0, 0, 128, 128);
      return cv;
    };
    this.halo = glowSprite('ember', 0.4); this.haloHot = glowSprite('signal', 0.4);

    // ---- 河燈：每一句排好（中文一排、原文一排；中文太長折成兩排）
    const zoneW = ZONE.x1 - ZONE.x0;
    const mainS = lines.map((l) => lineSlots(l));
    const subS = lines.map((l) => { const x = lyricSubOf(l); return x ? lineSlots(x) : null; });
    let mpx = lyricV2(msgPx);
    while (mpx > V2.lyrMin && mainS.some((x) => rowW(c, x, mpx) > zoneW)) mpx -= 1;
    const spx = subPx(mpx);
    const build = (ms: BSlot[], ss: BSlot[] | null, tin: number, tout: number, start: number, fake: boolean): Flotilla => {
      const lanterns: Lantern[] = [];
      const mRows = (rowW(c, ms, mpx) > zoneW ? splitRow(c, ms, mpx) : [ms]).slice(0, 2);
      mRows.forEach((r, ri) => lanterns.push(...placeRow(c, r, mpx, ri, false)));
      if (ss && ss.length) {
        let sp = spx;
        while (sp > 30 && rowW(c, ss, sp) > zoneW + 120) sp -= 1;
        lanterns.push(...placeRow(c, ss, sp, mRows.length, true));
      }
      return { lanterns, tin, tout, start, fake };
    };
    lines.forEach((ln, i) => {
      const nx = lines[i + 1];
      // 提早 1.6 秒從左邊漂進來；下一句要進來前（或唱完一陣子）加速漂走
      const tout = nx ? Math.max(ln.end + 0.3, nx.start - 1.8) : ln.end + 1.6;
      this.fleets.push(build(mainS[i]!, subS[i] ?? null, ln.start - 1.7, tout, ln.start, false));
    });
    if (!lines.length) {
      // 純音樂：每四小節漂來一排新人的名字與日期（半拍點亮一盞）
      for (let t0 = this.tOn - 1.2; t0 < e - beat; t0 += bar * 4) {
        const f = fakeLine(COUPLE_ZH, DATE_DOTS, t0 + 1.3, beat);
        this.fleets.push(build(lineSlots(f), lineSlots(f.sub!), t0, Math.min(t0 + bar * 4 - 1.3, e + 2), t0 + 1.3, true));
      }
    }
    const b = this.big;
    this.avoid = [[b.x, b.y, b.w, b.h], [ZONE.x0, ROWS[0]! - 90, ZONE.x1 - ZONE.x0, ROWS[2]! - ROWS[0]! + 110]];
  }

  /** 大燈：木框、四面燈紙（看得到正面與一點點側面、上緣），正面燈紙上是毛筆寫的留言。燈紙（亮的）與墨字分兩張先畫好。 */
  private drawBig() {
    const lay = this.lay;
    const pad = { x: 50, t: 46, b: 40 };
    let fw: number, fh: number;
    if (lay) { const [bx, by, bw, bh] = lay.box; fw = Math.min(760, Math.max(440, bx + bw + pad.x * 2)); fh = Math.min(360, by + bh + pad.t + pad.b); }
    else { fw = 560; fh = 170; }
    const side = 34, top = 26, base = 22;
    const w = fw + side + 20, h = fh + top + base + 20;
    this.big = { x: BIG.x, y: BIG.water - h + 10, w, h };
    const S = 2;
    const mk = () => { const cv = document.createElement('canvas'); cv.width = w * S; cv.height = h * S; const g = cv.getContext('2d')!; g.scale(S, S); return { cv, g }; };
    // 燈身（燈紙是亮的：燭火在裡面）
    const { cv, g } = mk();
    const fx = 10, fy = top + 6;
    const wood = mixRgba(mixRgba('sepia', 'blood', 0.3), 'ink', 0.4);
    // 側面的燈紙（暗一點）
    g.fillStyle = mixRgba('signal', 'blood', 0.55, 0.85);
    g.beginPath(); g.moveTo(fx + fw, fy); g.lineTo(fx + fw + side, fy - top + 6); g.lineTo(fx + fw + side, fy + fh - top + 6); g.lineTo(fx + fw, fy + fh); g.closePath(); g.fill();
    // 上緣（看得到燈裡面一點點）
    g.fillStyle = mixRgba('ink', 'blood', 0.3);
    g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + side, fy - top + 6); g.lineTo(fx + fw + side, fy - top + 6); g.lineTo(fx + fw, fy); g.closePath(); g.fill();
    // 正面的燈紙：中間最亮（燭火）、四周暗一點，紙的纖維
    const gr = g.createRadialGradient(fx + fw / 2, fy + fh * 0.62, 10, fx + fw / 2, fy + fh * 0.55, fw * 0.62);
    gr.addColorStop(0, mixRgba('paper', 'ember', 0.3)); gr.addColorStop(0.55, mixRgba('paper', 'signal', 0.38)); gr.addColorStop(1, mixRgba('signal', 'blood', 0.45));
    g.fillStyle = gr; g.fillRect(fx, fy, fw, fh);
    for (let i = 0; i < 180; i++) { g.strokeStyle = rgba('sepia', 0.04 + 0.04 * hash(this.seed, i, 2)); g.lineWidth = 0.7; const y = fy + hash(this.seed, i, 3) * fh, x = fx + hash(this.seed, i, 4) * fw; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20 + 40 * hash(this.seed, i, 5), y + 3 * (hash(this.seed, i, 6) - 0.5)); g.stroke(); }
    // 木框：四邊、中間一根直的
    g.fillStyle = wood;
    g.fillRect(fx - 6, fy - 4, fw + 12, 8); g.fillRect(fx - 6, fy + fh - 4, fw + 12, 10);
    g.fillRect(fx - 6, fy - 4, 9, fh + 8); g.fillRect(fx + fw - 3, fy - 4, 9, fh + 8);
    g.fillRect(fx + fw + side - 5, fy - top + 4, 7, fh + 4);
    // 底座：木板浮在水上
    g.fillStyle = mixRgba(wood, 'ink', 0.3);
    g.beginPath(); g.moveTo(fx - 12, fy + fh + 4); g.lineTo(fx + fw + 14, fy + fh + 4); g.lineTo(fx + fw + side + 10, fy + fh - top + 12); g.lineTo(fx + fw + side + 12, fy + fh - top + 22 + base * 0.3); g.lineTo(fx + fw + 12, fy + fh + base); g.lineTo(fx - 10, fy + fh + base); g.closePath(); g.fill();
    this.bigCv = cv;
    // 墨字
    const ink = mk();
    ink.g.textBaseline = 'alphabetic';
    ink.g.save(); ink.g.translate(fx + pad.x, fy + pad.t);
    if (lay) {
      ink.g.fillStyle = mixRgba('sepia', 'ink', 0.4); ink.g.font = font(FAM_MSG, lay.fit.size);
      for (const ln of lay.lines) fillHearts(ink.g, ln.text, ln.x, ln.y, lay.fit.size);
      ink.g.font = font(lay.sig.family, lay.sig.size); ink.g.fillStyle = mixRgba('sepia', 'ink', 0.2, 0.85);
      ink.g.fillText(lay.sig.text, lay.sig.x, lay.sig.y);
    } else {
      ink.g.fillStyle = mixRgba('sepia', 'ink', 0.4); ink.g.font = font(FAM_MSG, 46); ink.g.fillText(`給 ${COUPLE_ZH}`, 0, 46);
      ink.g.font = font(F.hei(500), 20); ink.g.fillStyle = mixRgba('sepia', 'ink', 0.2, 0.8); ink.g.letterSpacing = '2px'; ink.g.fillText(B5_INVITE, 0, 94); ink.g.letterSpacing = '0px';
    }
    ink.g.restore();
    this.inkCv = ink.cv;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const z = 1 + 0.035 * drift, oy = 26 * (1 - land);
    const u = this.river.u;
    u.uT!.value = t;
    (u.uCam!.value as THREE.Vector3).set(z, oy, 0);
    this.river.render(renderer, out);

    const c = this.L.ctx, g = this.G.ctx;
    this.L.clear(); this.G.clear();
    const cam = [z, 0, 0, z, 960 - 960 * z, 540 - 540 * z + oy] as const;
    c.setTransform(...cam); g.setTransform(...cam);
    const bp = au.beatAt(t), flick = Math.exp(-((bp - Math.floor(bp)) * au.beatPeriod(t)) / 0.15);
    const tb = lastBefore(this.bars, t), since = t - tb;

    // ---- 遠處沒寫字的小河燈：靠近對岸，一直慢慢往右漂
    for (let i = 0; i < 18; i++) {
      const hy = hash(this.seed, i, 43);
      const sp = 8 + 10 * hy;
      const x = ((hash(this.seed, i, 42) * 2200 + t * sp) % 2300) - 150;
      const y = SHORE + 10 + 44 * hy * hy + 1.5 * Math.sin(t * 1.4 + i);
      const r = 2.5 + 5 * hy;
      c.fillStyle = mixRgba('signal', 'ember', 0.5, 0.9); c.fillRect(x - r, y - r * 1.2, r * 2, r * 1.2);
      c.fillStyle = rgba('ink', 0.8); c.fillRect(x - r - 1, y - 1, r * 2 + 2, 2);
      g.fillStyle = rgba('signal', 0.22); g.beginPath(); g.ellipse(x, y - r * 0.6, r * 2.4, r * 1.8, 0, 0, TAU); g.fill();
      for (let k = 0; k < 3; k++) { g.fillStyle = rgba('signal', 0.14 * (1 - k / 3)); g.fillRect(x - r * (1 - k * 0.2) + 2 * Math.sin(t * 2 + i + k), y + 2 + k * r * 0.7, r * 2 * (1 - k * 0.2), 1.5); }
    }

    // ---- 寫字的河燈；燈紙上不要有光暈（加亮的光會把墨字洗淡），畫完把每盞燈的正面從光暈層挖掉
    this.faces.length = 0;
    for (const fl of this.fleets) {
      if (t < fl.tin || t > fl.tout + 1.3) continue;
      this.drawFleet(c, g, fl, t, flick);
    }
    g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    for (const [fx, fy, fw, fh] of this.faces) g.fillRect(fx, fy, fw, fh);
    g.restore();

    // ---- 小節線：一盞燈的底下盪開一圈漣漪
    if (since >= 0 && since < 1.6) {
      const live = this.fleets.find((fl) => t >= fl.tin && t <= fl.tout);
      const ln = live?.lanterns[Math.floor(hash(this.seed, Math.round(au.barAt(tb)), 51) * (live?.lanterns.length ?? 1))];
      const x = ln ? this.fleetX(live!, ln, t) : 1100, y = ln ? rowY(ln) + 4 : ROWS[0]!;
      const r = 20 + since * 150, a = (1 - since / 1.6) * 0.5;
      c.strokeStyle = rgba('bone', a * 0.5); c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(x, y, r, r * 0.22, 0, 0, TAU); c.stroke();
      c.strokeStyle = rgba('bone', a * 0.25); c.beginPath(); c.ellipse(x, y, r * 0.7, r * 0.16, 0, 0, TAU); c.stroke();
    }

    // ---- 大燈（留言）
    this.drawBigFrame(c, g, t, flick);

    c.setTransform(1, 0, 0, 1, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, this.L.upload(), out);
    comp.draw(renderer, this.G.upload(), out, { mode: 'add', tint: [1.5, 1.5, 1.5] });
    return { bloom: 0.8, bloomThreshold: 0.88, vignette: 0.6, halation: 0.35, popupAvoid: this.avoid };
  }

  /** 河燈在這一格的 x：漂進來（前面的燈先到）→ 慢慢往右漂 → 加速漂走。 */
  private fleetX(fl: Flotilla, ln: Lantern, t: number) {
    const k = ease.outCubic(clamp((t - fl.tin - (1 - ln.x / 1920) * 0.35) / 1.4));
    const enter = (1 - k) * -(ln.x + 260);
    const slow = (t - fl.start) * DRIFT;
    const go = Math.max(0, t - fl.tout);
    return ln.x + enter + slow + go * go * 520;
  }

  private drawFleet(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, fl: Flotilla, t: number, flick: number) {
    const fade = 1 - clamp((t - fl.tout - 0.3) / 0.9);
    fl.lanterns.forEach((ln, i) => {
      const x = this.fleetX(fl, ln, t);
      if (x < -120 || x > 2040) return;
      const bob = 3 * Math.sin(t * 1.5 + i * 0.9) + 1.5 * Math.sin(t * 2.3 + i * 2.1);
      const y = rowY(ln) + bob;
      const rot = 0.035 * Math.sin(t * 1.2 + i * 1.3);
      // 燈亮了沒：字唱到了就點亮（唱到的那盞最亮、訊號色），原文的燈比較安靜
      const ps = ln.slots.map((sl) => (fl.fake ? (t >= (sl.word.start) ? 1 : 0) : slotProgress(sl, t)));
      const lit = Math.max(...ps.map((p) => (p > 0 ? 1 : 0)));
      const act = ps.some((p) => p > 0 && p < 1);
      const t0 = fl.fake ? ln.slots[0]!.word.start : ln.slots[0]!.word.start + ((ln.slots[0]!.word.end - ln.slots[0]!.word.start) * ln.slots[0]!.k) / ln.slots[0]!.n;
      const hot = t >= t0 ? Math.exp(-(t - t0) / 0.3) : 0;
      const glow = lit * (act ? 1 : ln.sub ? 0.6 : 0.78) * (0.9 + 0.12 * flick) + 0.3 * hot;
      this.drawLantern(c, g, x, y, ln, rot, glow, act, fade, ps, t);
    });
  }

  /** 一盞河燈：木底座、四面燈紙（正面、右側、上緣），墨寫的字；點亮的燈紙透出燭光，水面上一條倒影光。 */
  private drawLantern(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, x: number, y: number, ln: Lantern, rot: number, glow: number, act: boolean, fade: number, ps: number[], t: number) {
    const w = ln.w, h = ln.h, side = Math.max(8, h * 0.22), top = Math.max(5, h * 0.14);
    c.save(); c.globalAlpha = fade; c.translate(x, y); c.rotate(rot);
    const x0 = -w / 2, y0 = -h;
    // 倒影光（在水面上，燈的正下方）：一條晃動的光
    if (glow > 0.05) {
      g.save(); g.globalAlpha = fade; g.translate(x, y);
      const col = act ? 'signal' : 'ember';
      for (let k = 0; k < 6; k++) {
        const dy = 6 + k * h * 0.28, dx = 4 * Math.sin(t * 2.2 + k * 1.7 + ln.x * 0.013);
        g.fillStyle = rgba(col, 0.2 * glow * (1 - k / 6));
        g.fillRect(-w * (0.36 - k * 0.04) + dx, dy, w * (0.72 - k * 0.08), 2 + k * 0.4);
      }
      g.restore();
    }
    // 河燈的樣子：底下一片小木筏，上面是稍微往上收的四面燈紙（看得到正面與右側），四角細細的竹骨，上面開口看得到燭光
    const tw = w * 0.9, tx0 = -tw / 2;
    const face = (pts: number[][]) => { c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(px!, py!) : c.moveTo(px!, py!))); c.closePath(); };
    // 木筏
    c.fillStyle = mixRgba(mixRgba('sepia', 'blood', 0.3), 'ink', 0.55);
    face([[x0 - 6, -1], [x0 + w + 6, -1], [x0 + w + side + 4, -top + 1], [x0 + w + side + 4, -top + 5], [x0 + w + 6, 5], [x0 - 6, 5]]); c.fill();
    // 右側燈紙（暗一點）
    const lit = glow > 0.05, k = Math.min(1, glow);
    c.fillStyle = lit ? mixRgba('signal', 'blood', 0.45, 0.5 + 0.4 * k) : mixRgba('ink2', 'paper', 0.1, 0.9);
    face([[x0 + w, 0], [x0 + w + side, -top], [tx0 + tw + side * 0.9, y0 - top], [tx0 + tw, y0]]); c.fill();
    // 正面燈紙：沒點亮是暗暗的紙（看得到紙的顏色），點亮了是暖的光（唱到的那盞帶訊號色、最亮）
    if (lit) {
      const gr = c.createLinearGradient(0, y0, 0, 0);
      gr.addColorStop(0, act ? mixRgba('ember', 'signal', 0.45) : mixRgba('paper', 'signal', 0.3 + 0.2 * (1 - k), 0.85 + 0.1 * k));
      gr.addColorStop(0.7, act ? mixRgba('ember', 'bone', 0.3) : mixRgba('bone', 'ember', 0.35, 0.6 + 0.35 * k));
      gr.addColorStop(1, act ? mixRgba('signal', 'ember', 0.3) : mixRgba('signal', 'bone', 0.5, 0.6 + 0.3 * k));
      c.fillStyle = gr;
    } else c.fillStyle = mixRgba('ink2', 'paper', 0.14);
    face([[x0, 0], [x0 + w, 0], [tx0 + tw, y0], [tx0, y0]]); c.fill();
    // 上面的開口：燈裡面（點亮時看得到燭光）
    c.fillStyle = lit ? mixRgba('ember', 'signal', 0.4, 0.9) : rgba('ink', 0.9);
    face([[tx0, y0], [tx0 + tw, y0], [tx0 + tw + side * 0.9, y0 - top], [tx0 + side * 0.9, y0 - top]]); c.fill();
    // 竹骨
    c.strokeStyle = mixRgba(mixRgba('sepia', 'blood', 0.3), 'ink', 0.5, 0.9); c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(x0, 0); c.lineTo(tx0, y0); c.lineTo(tx0 + tw, y0); c.lineTo(x0 + w, 0);
    c.moveTo(tx0 + tw, y0); c.lineTo(tx0 + tw + side * 0.9, y0 - top); c.lineTo(tx0 + side * 0.9, y0 - top); c.lineTo(tx0, y0);
    c.moveTo(tx0 + tw + side * 0.9, y0 - top); c.lineTo(x0 + w + side, -top);
    c.stroke();
    // 字：點亮的燈是墨色的字（燈光從後面透過來），沒點亮的是淡淡的字
    c.font = font(FAM_LAN, ln.size); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    const text = ln.slots.map((sl) => sl.ch).join('');
    const ty = y0 + h / 2 + ln.size * 0.36;
    if (ln.slots.length === 1 && text === '♥') drawHeart(c, 0, y0 + h / 2, ln.size * 0.75, glow > 0.05 ? rgba('rose') : rgba('rose', 0.4));
    else {
      c.fillStyle = glow > 0.05 ? mixRgba('sepia', 'ink', 0.35, 0.95) : rgba('bone', 0.32);
      if (ln.slots.length > 1 && ps.some((p) => p < 1) && glow > 0.05) {
        // 英文一個詞：唱到的字母才變深
        let xx = -c.measureText(text).width / 2;
        c.textAlign = 'left';
        ln.slots.forEach((sl, k) => { c.fillStyle = ps[k]! > 0 ? mixRgba('sepia', 'ink', 0.35, 0.95) : mixRgba('sepia', 'ink', 0.35, 0.38); c.fillText(sl.ch, xx, ty); xx += c.measureText(sl.ch).width; });
      } else c.fillText(text, 0, ty);
    }
    c.textAlign = 'left';
    c.restore();
    this.faces.push([x - w / 2 + 2, y - h + 2, w - 4, h - 4]);
    // 燭光：燈的四周一圈光
    if (glow > 0.05) {
      g.save(); g.globalAlpha = fade; g.translate(x, y - h / 2);
      // 光暈用先畫好的圖（每盞燈每格都建一個漸層很慢）
      const rr = Math.max(w, h) * (0.62 + 0.25 * glow);
      g.globalAlpha = fade * (act ? 1 : 0.55) * Math.min(1.2, glow);
      g.drawImage(act ? this.haloHot! : this.halo!, -rr, -rr, 2 * rr, 2 * rr);
      g.restore();
    }
  }

  /** 大燈：浮在左下的水上、輕輕上下浮；第一拍燭火點著，燈紙亮起來，毛筆字一行一行從紙上浮出來。 */
  private drawBigFrame(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, t: number, flick: number) {
    const b = this.big, S = 2;
    const bob = 4 * Math.sin(t * 1.1) + 2 * Math.sin(t * 1.9 + 1);
    const rot = 0.008 * Math.sin(t * 0.9);
    const ign = ease.outCubic(prog(t, this.tOn - 0.05, this.tOn + 0.5));
    const fl = (0.9 + 0.08 * Math.sin(t * 11) * Math.sin(t * 6.3)) * (1 + 0.06 * flick);
    // 水面上的倒影光
    g.save(); g.translate(b.x + b.w / 2, BIG.water + bob);
    for (let k = 0; k < 7; k++) {
      const dx = 10 * Math.sin(t * 1.8 + k * 1.3);
      g.fillStyle = rgba('ember', 0.2 * ign * (1 - k / 7));
      g.fillRect(-b.w * (0.4 - k * 0.03) + dx, 4 + k * 14, b.w * (0.8 - k * 0.06), 4);
    }
    g.restore();
    c.save(); c.translate(b.x + b.w / 2, b.y + b.h + bob); c.rotate(rot); c.translate(-(b.x + b.w / 2), -(b.y + b.h));
    // 還沒點著：燈紙暗（先畫亮的，再蓋一層暗）
    c.drawImage(this.bigCv!, b.x, b.y, b.w, b.h);
    const dark = 1 - ign * fl;
    if (dark > 0.01) { c.fillStyle = rgba('ink', 0.72 * dark); c.fillRect(b.x + 10, b.y + 26 + 6 - 8, b.w - 30, b.h - 26 - 22 - 12); }
    // 字一行一行浮出來
    const ink = this.inkCv!;
    if (this.lay) {
      const lay = this.lay, oy0 = 26 + 6 + 46;
      const band = (y0: number, hh: number, a: number) => {
        if (a <= 0) return;
        y0 = Math.max(0, y0); hh = Math.min(hh, b.h - y0);
        c.globalAlpha = a; c.drawImage(ink, 0, y0 * S, b.w * S, hh * S, b.x, b.y + y0, b.w, hh);
      };
      lay.lines.forEach((ln, i) => band(oy0 + ln.y - lay.fit.size - 4, lay.fit.lineHeight + 2, prog(t, this.lineT[i]!, this.lineT[i]! + 0.5, ease.outCubic)));
      band(oy0 + lay.sig.y - lay.sig.size - 4, lay.sig.size * 1.5, prog(t, this.sigT, this.sigT + 0.4));
      c.globalAlpha = 1;
    } else { c.globalAlpha = prog(t, this.tOn + 0.2, this.tOn + 0.7); c.drawImage(ink, b.x, b.y, b.w, b.h); c.globalAlpha = 1; }
    c.restore();
    // 燭光：燈的四周
    const cx = b.x + b.w / 2, cy = b.y + b.h * 0.6 + bob;
    const rr = b.w * 0.6;
    g.globalAlpha = 0.22 * ign * fl; g.drawImage(this.halo!, cx - rr, cy - rr, 2 * rr, 2 * rr); g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- 排河燈
const PAD = (px: number) => px * 0.34;
const GAP = (px: number) => px * 0.3;

/** 一排格子的河燈（中心相對整排中線）。 */
function tokens(c: CanvasRenderingContext2D, slots: BSlot[], px: number): (Lantern | number)[] {
  c.font = font(FAM_LAN, px);
  return groupSlots(slots).map((gp) => {
    if (!gp) return px * 0.25;
    const tw = c.measureText(gp.map((s) => s.ch).join('')).width;
    const w = Math.max(px * 1.16, tw + PAD(px) * 2);
    return { x: 0, w, h: px * 1.42, slots: gp, row: 0, sub: false, size: px };
  });
}
function rowW(c: CanvasRenderingContext2D, slots: BSlot[], px: number) {
  let w = 0, prev = false;
  for (const tk of tokens(c, slots, px)) { if (typeof tk === 'number') { w += tk; prev = false; continue; } w += (prev ? GAP(px) : 0) + tk.w + px * 0.22; prev = true; }
  return w;
}
function placeRow(c: CanvasRenderingContext2D, slots: BSlot[], px: number, row: number, sub: boolean): Lantern[] {
  const toks = tokens(c, slots, px);
  let x = (ZONE.x0 + ZONE.x1) / 2 - rowW(c, slots, px) / 2, prev = false;
  const out: Lantern[] = [];
  for (const tk of toks) {
    if (typeof tk === 'number') { x += tk; prev = false; continue; }
    if (prev) x += GAP(px);
    tk.x = x + tk.w / 2; tk.row = row; tk.sub = sub;
    x += tk.w + px * 0.22; prev = true;
    out.push(tk);
  }
  return out;
}
/** 太長的中文：在最接近中間的空白（或詞與詞之間）折成兩排。 */
function splitRow(c: CanvasRenderingContext2D, slots: BSlot[], px: number): BSlot[][] {
  let best = -1, bestD = Infinity;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i]!.ch && slots[i - 1]!.ch && slots[i]!.word === slots[i - 1]!.word && /\p{Script=Latin}/u.test(slots[i]!.ch)) continue;
    const d = Math.max(rowW(c, slots.slice(0, i), px), rowW(c, slots.slice(i), px));
    if (d < bestD) { bestD = d; best = i; }
  }
  const trim = (x: BSlot[]) => { let i = 0, j = x.length; while (i < j && !x[i]!.ch) i++; while (j > i && !x[j - 1]!.ch) j--; return x.slice(i, j); };
  return best < 0 ? [slots] : [trim(slots.slice(0, best)), trim(slots.slice(best))];
}
/** 燈底（水線）的 y：中文第一排、第二排、原文。 */
const rowY = (ln: Lantern) => ROWS[ln.row]!;

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

/** 毛筆字（♥ 用自己畫的愛心）。 */
function fillHearts(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  let cx = x;
  for (const part of text.split(/(♥)/u)) {
    if (!part) continue;
    if (part === '♥') { const fs = g.fillStyle; drawHeart(g, cx + size * 0.45, y - size * 0.34, size * 0.72); g.fillStyle = fs; cx += size * 0.95; continue; }
    g.fillText(part, cx, y);
    cx += g.measureText(part).width;
  }
}
