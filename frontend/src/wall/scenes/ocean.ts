// 海浪版畫（亮）：木刻版畫的層層海浪。一塊墨版（sepia 的線）加一塊色版（訊號色的暗部調淡），色版故意跟墨版錯開兩個像素
// （套色沒對準，木刻的味道）。構圖是一面橫過整個畫面的大浪牆：
//  - 天空是有木紋的紙，頂端一條色版的漸層（版畫天空的老規矩）；海平線上寫歌詞：還沒唱的字一半沉在海平線下，
//    唱到的那一刻從海裡「浮」上來（訊號色），唱完是墨色。
//  - 遠方三層小浪、中間一面大浪牆：浪頭是尖的（木刻的浪），每一拍整排浪往右推一段（強烈緩動、推完停住）；
//    浪尖有一爪一爪的浪花（紙白的指頭、墨色的邊），大鼓時浪爪捲起來、噴出泡沫。
//  - 主打留言「刻」在浪牆的墨色浪身上（陰刻：紙白的思源宋體，雕版印刷本來就是宋體）；留言出現時，浪尖的泡沫
//    一顆顆飛下來排成字的形狀，然後字才實起來——「浪花的泡沫排成留言」。
//  - 冷面註記：「今日海象：浪高一百年　風向：往幸福」「第 042 景」。
//  - 沒有主打留言：浪身刻「今日海象：浪高一百年，適合出航。」＋邀請；純音樂：海平線寫歌名。
// 畫法：整張海景（紙、木紋、墨版、色版、陰刻留白）是一個 shader；浪爪與泡沫是 LineBatch（normal 混合，不發光）；字是一張 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, measure, textPoints } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, lerp, hash, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, beatAfter, signature, COUPLE_ZH, type LyricStyle } from './_motifs';
import { paperSignal, no3, fitV2, slowPush, INVITE_SMALL, type Rect, SYMBOLS } from './_t20';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'water', paper: true, energy: [0.35, 1], bars: [4, 8] };

/** 海平線（y 向下）。歌詞坐在這條線上。 */
const HZ = 336;
/** 浪牆：底線、浪高、波長（px）；浪尖在 base - amp。 */
const WALL = { base: 528, amp: 66, lam: 560 };
/** 最前面的小浪。 */
const FORE = { base: 994, amp: 30, lam: 270, rise: 250, x0: 1280, x1: 1640 };
/** 前景白浪拱起來的浪尖（尖的，浪爪往左捲）。 */
const FORE_PEAK = { x: 1600, h: 58, w: 150 };
/**
 * 刻在浪身上的留言：可用的框（上面離浪尖夠遠、下面在前景小浪之上）。標準 v2：寫留言的那一塊 ≤ 860×430、放在畫面左下，
 * 浪身右半邊空出來給浪、小船與前景白浪。
 */
const BOX = { x: 156, y: 610, w: 820, h: 300 };
const LYR_STYLE: LyricStyle = { family: F.archivo(100, 700), size: 66, minSize: 50, maxWidth: 1180, align: 'left', lineHeight: 1.1 };
const LYR_X = 156;
const MSG_FAM = F.ming(900);
const SIG_FAM = F.hand(700);
const NO_MSG = '今日海象：浪高一百年，適合出航。';
const NOTE = '今日海象：浪高一百年　風向：往幸福　潮汐：滿潮';

const FRAG = /* glsl */ `
uniform float uT, uIn, uAmp;
uniform float uDrift;   // 霞往左飄（窗格內的時間 × 速度）
uniform vec4 uPh;       // 遠浪三層與浪牆的相位（px）
uniform float uPhF;     // 前景小浪的相位
uniform vec4 uClear;    // 留言的範圍（浪身在這裡全黑，不刻線，字才讀得清楚）
uniform float uClearK;  // 留白跟著字一起出現（字還沒來之前看不出有個框）
uniform vec2 uReg;      // 色版的套色偏移（px）

// 木刻的浪：尖的浪頭、圓的浪谷（|sin| 的 V 字翻過來）
float peaked(float x, float lam) { return pow(1.0 - abs(sin(PI * x / lam)), 1.55); }

// 每一層浪的上緣（y 向下）
float yB0(float x) { return 364.0 - 7.0 * peaked(x + uPh.x, 74.0); }
float yB1(float x) { return 394.0 - 12.0 * peaked(x + uPh.y, 136.0); }
float yB2(float x) { return 436.0 - 19.0 * peaked(x + uPh.z, 224.0); }
float yW(float x) { return ${WALL.base}.0 - ${WALL.amp}.0 * uAmp * peaked(x + uPh.w, ${WALL.lam}.0); }
// 前景的白浪：右下角高高拱起（右下角是 QR 區，亮版面的 HUD 是深色字，底下要是白的）
float yF(float x) {
  return ${FORE.base}.0 - ${FORE.amp}.0 * peaked(x + uPhF, ${FORE.lam}.0) - ${FORE.rise}.0 * smoothstep(${FORE.x0}.0, ${FORE.x1}.0, x)
    - ${FORE_PEAK.h}.0 * pow(max(0.0, 1.0 - abs(x - ${FORE_PEAK.x}.0) / ${FORE_PEAK.w}.0), 2.2);
}

// 回傳 (墨版覆蓋率, 色版覆蓋率)。p 是 y 向下的像素座標。
vec2 printAt(vec2 p) {
  float x = p.x;
  float ink = 0.0, tone = 0.0;
  float f = yF(x), w = yW(x), b2 = yB2(x), b1 = yB1(x), b0 = yB0(x);
  if (p.y > f) {
    // 白浪：只有輪廓與細細的刻線（浪花），越往下線越密一點
    float d = p.y - f;
    // 右下角 QR 區（HUD 的深色字在上面）：刻線淡掉，只留輪廓
    float hud = smoothstep(1330.0, 1440.0, p.x) * smoothstep(800.0, 860.0, p.y);
    ink = max(pxLine(d, 1.6, 2.6), hatch(d / 12.0, 0.06 + smoothstep(20.0, 260.0, d) * 0.16) * (1.0 - 0.8 * hud));
    tone = 0.12 + 0.2 * smoothstep(30.0, 200.0, d);
  } else if (p.y > w) {
    float d = p.y - w;
    // 浪頭下面一段是白的（浪花），再往下刻線越來越粗，到浪身變成墨色
    float dark = smoothstep(24.0, 170.0, d) * 0.9;
    vec2 q = abs(p - (uClear.xy + uClear.zw * 0.5)) - uClear.zw * 0.5;
    float inText = 1.0 - smoothstep(-10.0, 70.0, max(q.x, q.y));
    dark = mix(dark, 1.04, inText * uClearK);
    // 刻線跟著浪頭的形狀走，越往下越平（遠離浪頭，線慢慢拉直）
    float u = mix(d, p.y - ${WALL.base}.0 + 40.0, smoothstep(40.0, 360.0, d)) / 14.0;
    // 浪身深處是一大片墨（木刻的大色塊，畫面才有地方呼吸），只留稀疏的刻線（四條留一條）
    float deep = smoothstep(150.0, 260.0, d);
    float carve = pxLine(abs(fract(u / 3.0) - 0.5) * 42.0, 0.6, 1.3) * 0.7 * (1.0 - inText * uClearK);
    ink = max(pxLine(d, 1.9, 3.0), mix(hatch(u, dark), 1.0 - carve, deep));
    tone = smoothstep(10.0, 60.0, d);
  } else if (p.y > b2) {
    float d = p.y - b2;
    ink = max(pxLine(d, 1.0, 1.9), hatch(d / 7.5, 0.1 + smoothstep(0.0, 60.0, d) * 0.3));
    tone = 0.5;
  } else if (p.y > b1) {
    float d = p.y - b1;
    ink = max(pxLine(d, 0.8, 1.6), hatch(d / 6.5, 0.08 + smoothstep(0.0, 40.0, d) * 0.22));
    tone = 0.36;
  } else if (p.y > b0) {
    float d = p.y - b0;
    ink = max(pxLine(d, 0.7, 1.4), hatch(d / 6.0, 0.07));
    tone = 0.26;
  } else if (p.y > ${HZ}.0) {
    ink = hatch((p.y - ${HZ}.0) / 6.0, 0.06);
    tone = 0.18;
  } else {
    // 天空：頂端一條色版的漸層、兩條橫向的霞（版畫的雲）
    tone = 0.5 * (1.0 - smoothstep(40.0, 190.0, p.y));
    // 霞：兩片長長的、邊緣不齊的橫帶，裡面刻細橫線（不描邊，才不會像按鈕）
    // 兩片霞速度不同（遠近視差）
    vec2 pm1 = p + vec2(uDrift, 0.0), pm2 = p + vec2(uDrift * 0.6, 0.0);
    float m1 = sdSegment(pm1, vec2(1260.0, 214.0), vec2(1820.0, 214.0)) - 13.0 + 7.0 * snoise(pm1 / vec2(70.0, 30.0));
    float m2 = sdSegment(pm2, vec2(1080.0, 158.0), vec2(1500.0, 158.0)) - 9.0 + 6.0 * snoise(pm2 / vec2(60.0, 26.0) + 4.0);
    float mist = 1.0 - smoothstep(-1.0, 1.0, min(m1, m2));
    tone = max(tone, mist * 0.42);
    ink = max(ink, hatch(p.y / 4.0, 0.22) * mist);
  }
  // 海平線
  ink = max(ink, pxLine(abs(p.y - ${HZ}.0), 0.8, 1.6) * step(p.y, b0 + 2.0));
  return vec2(ink, tone);
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 紙：纖維＋木紋（橫向拉長的雜訊）
  float fib = fbm(p / 260.0, 3);
  float grain = snoise(vec2(p.x / 900.0, p.y / 7.0 + snoise(p / 400.0) * 3.0));
  vec3 paper = C_PAPER * (0.975 + 0.025 * fib) * (1.0 - 0.018 * smoothstep(0.2, 0.9, grain));
  // 刷墨進場：馬連從左到右刷過去
  float roll = smoothstep(p.x - 24.0, p.x + 24.0, uIn * 2100.0 - 60.0 + 40.0 * snoise(vec2(p.y / 90.0, 3.0)));
  vec2 k = printAt(p);
  vec2 kc = printAt(p - uReg);
  vec3 colBlock = mix(C_PAPER, mix(C_BLOOD, C_SEPIA, 0.25), 0.62);
  vec3 col = mix(paper, colBlock, kc.y * roll * (0.94 + 0.06 * fib));
  // 墨版：墨色有一點不均（木刻吃墨不平均）
  float inkAmt = k.x * roll * (0.96 + 0.04 * fib);
  col = mix(col, C_SEPIA, inkAmt);
  fragColor = vec4(col, 1.0);
}`;

const BG = () => new FSPass(FRAG, {
  uT: { value: 0 }, uIn: { value: 1 }, uAmp: { value: 1 }, uDrift: { value: 0 },
  uPh: { value: new THREE.Vector4() }, uPhF: { value: 0 },
  uClear: { value: new THREE.Vector4() }, uClearK: { value: 1 }, uReg: { value: new THREE.Vector2(2.5, 1.5) },
});

/** 跟 shader 同一個公式：浪牆的上緣（給浪爪、泡沫找位置）。 */
const peaked = (x: number, lam: number) => Math.pow(1 - Math.abs(Math.sin((Math.PI * x) / lam)), 1.55);

interface Glyph { ch: string; x: number; y: number; t: number }
interface Dot { x: number; y: number; g: number; sx: number; sy: number }

export default class Ocean extends Scene {
  bg = shared('ocean.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  foam = this.track(new LineBatch(4096, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 73 + (this.msg?.id ?? 0) * 11) >>> 0;
  b0 = 0;
  beat = 0.5;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  dots: Dot[] = [];
  sig: { text: string; x: number; y: number; size: number; t: number } | null = null;
  tag: { text: string; x: number; y: number } | null = null;
  invite: { x: number; y: number; t: number } | null = null;
  title = '';
  head = '';
  note = NOTE;
  /** 歌詞字級：有留言時比留言小一號，沒有留言時歌詞是焦點。 */
  lyrSize = 60;
  avoid: Rect[] = [];
  clear: Rect = [0, 0, 0, 0];
  phF = 0;
  /** 遠浪第三層（小船坐的那一層）的相位。 */
  phB2 = 0;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    this.beat = au.beatPeriod(this.b0);
    this.title = `${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
    if (m) this.note = `${no3(m.n)}　${NOTE}`;
    this.head = `祝福浪圖　第 ${String(m ? m.n : song.index).padStart(3, '0')} 景`;
    const text = m ? m.text : NO_MSG;
    const sigText = m ? (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name)) : '';
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(text + sigText + NO_MSG + INVITE_SMALL + NOTE + this.head + this.title + lines.map((l) => l.text).join('') + 'FROM THE COUPLE · 新人第景' + SYMBOLS);

    // ---- 留言：刻在浪身上（左對齊，下面留署名的位置）
    const c = this.layer.ctx;
    const tagH = m?.couple ? 34 : 0;
    // 署名的高度先照字級上限扣掉（署名永遠在最後一行下面，K 情境四行也不會壓到）
    const sigMax = sigV2(msgMaxFor(text));
    const reserve = m ? sigMax + 22 : 56;
    // 沒有主打留言時歌詞是焦點：浪身上的冷面句子小一點
    this.fit = fitV2(c, text, MSG_FAM, BOX.w, BOX.h - reserve - tagH, { lineHeight: 1.3, maxLines: 4, max: m ? undefined : 44 });
    const fit = this.fit;
    const sigSize = sigV2(fit.size);
    this.lyrSize = lyricV2(m ? fit.size : null);
    const blockH = tagH + fit.height + reserve;
    const top = BOX.y + (BOX.h - blockH) / 2;
    const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    // 泡沫第一個拍點從浪頭飛下來，一小節內（最長 1.6 秒）從左到右排成字
    const tm0 = this.b0 + 0.3;
    const bar = Math.max(this.beat * 2, au.timeOfBar(au.barAt(this.b0) + 1) - this.b0);
    const dur = clamp(0.045 * n + 0.35, 0.5, Math.min(1.6, bar, 0.3 * (e - s)));
    let k = 0;
    let maxW = 0;
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      maxW = Math.max(maxW, lay.width);
      const y = top + tagH + fit.size * 0.88 + i * fit.lineHeight;
      // 泡沫點：把這一行光柵化取樣，每個點歸給它所在的那個字
      const pts = textPoints(ln, MSG_FAM, fit.size, Math.max(5, Math.round(fit.size / 9)), this.seed + i);
      const g0 = this.glyphs.length;
      for (const g of lay.glyphs) this.glyphs.push({ ch: g.ch, x: BOX.x + g.x, y, t: tm0 + (dur * k++) / Math.max(1, n) });
      for (const q of pts) {
        let gi = lay.glyphs.findIndex((g) => q.x >= g.x - 1 && q.x < g.x + g.w + 1);
        if (gi < 0) gi = lay.glyphs.length - 1;
        const x = BOX.x + q.x, yy = y + q.y;
        const h = hash(this.seed, this.dots.length, 5);
        // 從浪頭上某一點飛下來（浪頭在字的左上方一點，跟著浪往右推的方向）
        const sx = x - 120 - 260 * h;
        this.dots.push({ x, y: yy, g: g0 + gi, sx, sy: WALL.base - WALL.amp * 0.6 });
      }
    });
    const blockW = Math.max(maxW, m ? measure(sigText, SIG_FAM, sigSize) : 0);
    if (m) {
      const sw = measure(sigText, SIG_FAM, sigSize);
      this.sig = { text: sigText, x: BOX.x + Math.max(maxW, sw) - sw, y: top + tagH + fit.height + 18 + sigSize * 0.9, size: sigSize, t: tm0 + dur + 0.25 };
      if (m.couple) this.tag = { text: 'FROM THE COUPLE · 新人', x: BOX.x, y: top + 16 };
    } else {
      this.invite = { x: BOX.x, y: top + fit.height + 44, t: tm0 + dur + 0.3 };
    }
    this.clear = [BOX.x - 20, top - 16, Math.max(blockW, m ? 0 : measure(INVITE_SMALL, F.hei(500), 26)) + 40, blockH + 26];

    // ---- 歌詞：先排好這個窗格會唱到的每一行
    for (const line of lines) layoutLyric(c, line, this.lyrStyle());

    // ---- 即時小卡避開：海平線上的歌詞帶、浪身上的留言
    this.avoid = [[LYR_X - 16, HZ - 150, LYR_STYLE.maxWidth + 32, 170], [this.clear[0] - 10, this.clear[1] - 10, this.clear[2] + 20, this.clear[3] + 20]];
  }

  private lyrStyle(): LyricStyle {
    return { ...LYR_STYLE, size: this.lyrSize, minSize: V2.lyrMin, active: paperSignal(), sung: rgba('sepia', 0.94), unsung: rgba('sepia', 0.32) };
  }

  /** 整排浪往右推：每一拍推一段（outCubic，推完停住），遠浪推得少。 */
  private push(t: number) {
    const au = this.ctx.audio;
    const b = Math.max(0, au.beatAt(t) - au.beatAt(this.ctx.start));
    const k = Math.floor(b), ph = b - k;
    return k + ease.outCubic(clamp(ph / 0.45));
  }

  /** 前景白浪的上緣（跟 shader 的 yF 同一個公式）。 */
  private foreY(x: number, phF: number) {
    const ss = clamp((x - FORE.x0) / (FORE.x1 - FORE.x0));
    return FORE.base - FORE.amp * peaked(x + phF, FORE.lam) - FORE.rise * ss * ss * (3 - 2 * ss)
      - FORE_PEAK.h * Math.pow(Math.max(0, 1 - Math.abs(x - FORE_PEAK.x) / FORE_PEAK.w), 2.2);
  }

  /** 浪牆的上緣。 */
  private wallY(x: number, ph: number, amp: number) { return WALL.base - WALL.amp * amp * peaked(x + ph, WALL.lam); }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const P = this.push(t);
    // 浪往右走：相位往負的方向（x + ph 的 ph 變小，形狀往右移）
    const phW = -P * WALL.lam * 0.13 - this.seed % 300;
    (u.uPh!.value as THREE.Vector4).set(-P * 6 - 40, -P * 11 - 90, -P * 19 - 20, phW);
    this.phF = P * 26 + 70;
    u.uPhF!.value = this.phF;
    // 大鼓：浪頭拱高一點
    const kick = f.a.kick;
    const amp = 1 + 0.16 * kick;
    u.uAmp!.value = amp;
    u.uIn!.value = prog(t, s, s + 0.4, ease.outCubic);
    (u.uClear!.value as THREE.Vector4).set(...this.clear);
    const g0 = this.glyphs[0];
    u.uClearK!.value = g0 ? prog(t, g0.t - 0.45, g0.t + 0.1, ease.inOutCubic) : 1;
    u.uT!.value = t;
    u.uDrift!.value = 11 * f.lt;
    this.phB2 = -P * 19 - 20;
    this.bg.render(renderer, out);

    // ---- 字
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    const inK = prog(t, s + 0.1, s + 0.45);
    this.drawBoat(c, f.lt, inK);
    this.drawLyrics(c, t, inK);
    this.drawMessage(c, t);
    this.drawNotes(c, t, inK);
    comp.draw(renderer, L.upload(), out);

    // ---- 浪爪與泡沫
    this.foam.clear();
    this.drawClaws(t, phW, amp, kick);
    this.drawFoamDots(t);
    if (this.foam.count) this.foam.render(renderer, out);
    void au; void lyrics; void e;
    return { paper: 1, popupAvoid: this.avoid, bloom: 0.1, bloomThreshold: 1.8, halation: 0.02, vignette: 0.18, grain: 0.045, ca: 0.35, zoom: slowPush(f.p) };
  }

  /** 海平線上的歌詞：還沒唱的字一半沉在海平線下，唱到的那一刻浮上來。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number, inK: number) {
    const { lyrics } = this.ctx;
    const base = HZ - 18;
    if (!lyrics.has) {
      c.save();
      c.globalAlpha = inK;
      c.font = font(LYR_STYLE.family, 34);
      c.fillStyle = rgba('sepia', 0.55);
      c.fillText(this.title, LYR_X, base);
      c.restore();
      return;
    }
    const ly = lyricAt(lyrics, t);
    if (!ly) return;
    const st = this.lyrStyle();
    const lay = layoutLyric(c, ly.line, st);
    const lastRow = lay.rows.length - 1;
    const y0 = base - lastRow * lay.size * (st.lineHeight ?? 1.18);
    c.save();
    // 最後一列在海平線下的部分看不到（字沉在海裡）
    c.beginPath(); c.rect(0, 0, W, HZ - 1); c.clip();
    c.font = font(st.family, lay.size);
    c.textBaseline = 'alphabetic';
    c.globalAlpha = ly.k * inK;
    for (const pw of lay.words) {
      const w = pw.word;
      const p = Lyrics.wordProgress(w, t);
      const onLast = Math.abs(pw.y - lastRow * lay.size * (st.lineHeight ?? 1.18)) < 1;
      // 浮上來：唱到的那一刻用 outBack 從海裡冒出來（只有貼著海平線的那一列會沉）
      const rise = t >= w.start ? ease.outBack(clamp((t - w.start) / 0.26)) : 0;
      const sink = onLast ? (1 - rise) * lay.size * 0.52 : 0;
      const x = LYR_X + pw.x, y = y0 + pw.y + sink;
      c.fillStyle = st.unsung!;
      if (p < 1) c.fillText(w.w, x, y);
      if (p <= 0) continue;
      c.save();
      c.beginPath();
      c.rect(x - lay.size * 0.1, y - lay.size * 1.1, (pw.w + lay.size * 0.2) * p, lay.size * 1.5);
      c.clip();
      c.fillStyle = p < 1 ? st.active! : st.sung!;
      c.fillText(w.w, x, y);
      c.restore();
    }
    c.restore();
  }

  /** 刻在浪身上的留言（紙白）：字在泡沫排好之後實起來。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit;
    if (!fit) return;
    const paperC = rgba('paper', 0.97);
    c.save();
    c.font = font(MSG_FAM, fit.size);
    c.textBaseline = 'alphabetic';
    for (const g of this.glyphs) {
      const a = prog(t, g.t - 0.08, g.t + 0.2);
      if (a <= 0) continue;
      c.globalAlpha = a;
      c.fillStyle = g.ch === '♥' ? rgba('rose') : paperC;
      c.fillText(g.ch, g.x, g.y);
    }
    c.globalAlpha = 1;
    if (this.sig && t >= this.sig.t) {
      c.globalAlpha = prog(t, this.sig.t, this.sig.t + 0.4);
      c.font = font(SIG_FAM, this.sig.size);
      c.fillStyle = rgba('paper', 0.8);
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
    }
    if (this.tag) {
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.3);
      c.font = font(F.mono(500), 16);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('paper', 0.75);
      c.fillText(this.tag.text, this.tag.x, this.tag.y);
      c.letterSpacing = '0px';
    }
    if (this.invite) {
      c.globalAlpha = prog(t, this.invite.t, this.invite.t + 0.4);
      c.font = font(F.hei(500), 26);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('paper', 0.78);
      c.fillText(INVITE_SMALL, this.invite.x, this.invite.y);
      c.letterSpacing = '0px';
    }
    c.restore();
  }

  /** 遠浪第三層的上緣（跟 shader 的 yB2 同一個公式）。 */
  private b2Y(x: number) { return 436 - 19 * peaked(x + this.phB2, 224); }

  /**
   * 遠方的一艘小舟（木刻的剪影：墨色的船身、紙白的帆、訊號色的小旗）：坐在第三層遠浪上，浪每拍推過來時被抬起、傾斜，
   * 整個窗格慢慢往左漂。不畫人（規則）。
   */
  private drawBoat(c: CanvasRenderingContext2D, lt: number, inK: number) {
    const x = 1280 - 15 * lt;
    // 船底兩端各量一次浪的高度：船跟著浪傾斜，不會被尖浪頭一下子頂起來
    const ya = this.b2Y(x - 26), yb = this.b2Y(x + 26), ym = this.b2Y(x);
    const y = Math.min((ya + yb) / 2, ym + 6);
    const ang = Math.atan2(yb - ya, 52) * 0.8;
    c.save();
    c.globalAlpha = inK;
    // 船身的下緣埋在浪裡：只畫浪面以上的部分
    c.beginPath();
    c.moveTo(x - 90, 250);
    for (let k = -90; k <= 90; k += 6) c.lineTo(x + k, this.b2Y(x + k) + 3);
    c.lineTo(x + 90, 250);
    c.closePath();
    c.clip();
    c.translate(x, y);
    c.rotate(ang);
    c.scale(1.35, 1.35);
    c.lineJoin = 'round';
    c.fillStyle = rgba('sepia', 0.95);
    c.beginPath();
    c.moveTo(-38, -8); c.quadraticCurveTo(-4, -4, 40, -12); c.lineTo(30, 4); c.lineTo(-30, 4); c.closePath();
    c.fill();
    // 桅與帆（帆面刻兩道橫線，像木刻的留白）
    c.strokeStyle = rgba('sepia', 0.95);
    c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(-2, -8); c.lineTo(-2, -64); c.stroke();
    c.fillStyle = rgba('paper', 1);
    c.beginPath(); c.moveTo(0, -62); c.quadraticCurveTo(26, -38, 22, -12); c.lineTo(0, -12); c.closePath();
    c.fill();
    c.lineWidth = 1.6; c.stroke();
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(2, -44); c.lineTo(20, -44); c.moveTo(2, -28); c.lineTo(23, -28); c.stroke();
    c.fillStyle = paperSignal(0.9);
    c.beginPath(); c.moveTo(-2, -64); c.lineTo(-16, -60); c.lineTo(-2, -56); c.closePath(); c.fill();
    c.restore();
  }

  /** 天空左上角的題簽（版畫的標題框）與海象註記。 */
  private drawNotes(c: CanvasRenderingContext2D, t: number, inK: number) {
    c.save();
    c.globalAlpha = inK;
    c.font = font(F.ming(700), 20);
    const w = measure(this.head, F.ming(700), 20) + 32;
    c.strokeStyle = rgba('sepia', 0.7);
    c.lineWidth = 1.2;
    c.strokeRect(LYR_X, 114, w, 38);
    c.strokeRect(LYR_X + 3, 117, w - 6, 32);
    c.fillStyle = rgba('sepia', 0.78);
    c.fillText(this.head, LYR_X + 16, 140);
    // 題簽旁的小印章（訊號色的暗部）
    const sx = LYR_X + w + 12, sy = 116;
    c.fillStyle = paperSignal(0.8);
    c.fillRect(sx, sy, 34, 34);
    c.font = font(F.ming(900), 14);
    c.fillStyle = rgba('paper', 0.95);
    c.fillText('喜', sx + 3, sy + 15);
    c.fillText('浪', sx + 17, sy + 30);
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.72);
    c.fillText(this.note, LYR_X, 196);
    c.restore();
    void t;
  }

  /** 一爪浪花：五根指頭從浪尖往前上方伸出去、邊伸邊捲（dir = 1 往右捲，-1 往左捲）。 */
  private claw(segs: [number, number, number, number, number][], x0: number, y0: number, dir: number, size: number, curl: number) {
    for (let j = 0; j < 5; j++) {
      // 越後面的指頭越往前、越短；伸出去的同時往浪前進的方向捲下來
      let a = -Math.PI * 0.62 + j * 0.3, x = j * 10, y = j * 5;
      const len = size * (1 - j * 0.13) * (0.75 + 0.25 * curl);
      const steps = 8;
      for (let k = 0; k < steps; k++) {
        const q = k / steps;
        a += curl * (0.34 + 0.25 * q);
        const nx = x + Math.cos(a) * len / steps, ny = y + Math.sin(a) * len / steps;
        segs.push([x0 + dir * x, y0 + y, x0 + dir * nx, y0 + ny, lerp(13, 3, q) * (1 - j * 0.1)]);
        x = nx; y = ny;
      }
    }
  }

  /**
   * 浪爪：浪牆的每個浪尖一爪（五根紙白的指頭、墨色的邊），往前（右）往下捲；平常捲一點，大鼓時捲起來再慢慢鬆開。
   * 大鼓也從浪爪噴出泡沫（拍點出生、確定性的拋物線）。
   */
  private drawClaws(t: number, ph: number, amp: number, kick: number) {
    const lb = this.foam, au = this.ctx.audio;
    const ink = LIN.sepia, pap = LIN.paper;
    // 浪尖的位置：x + ph = n·λ
    const n0 = Math.ceil((-200 + ph) / WALL.lam), n1 = Math.floor((W + 200 + ph) / WALL.lam);
    const segs: [number, number, number, number, number][] = [];
    const curlK = clamp(kick * 1.2);
    for (let n = n0; n <= n1; n++) {
      const x0 = n * WALL.lam - ph, y0 = this.wallY(x0, ph, amp) + 2;
      const r = hash(n, this.seed);
      // 捲的程度有上限：捲過頭會變成一個圈，不像浪爪
      this.claw(segs, x0, y0, 1, 96 + 50 * r, 0.28 + 0.26 * curlK + 0.06 * r);
      // 泡沫：最近三拍，每拍從這一爪噴出一把
      const bi = Math.floor(au.beatAt(t));
      for (let b = bi - 2; b <= bi; b++) {
        const tb = au.timeOfBeat(b);
        const age = t - tb;
        if (age < 0 || age > 1.1 || tb < this.ctx.start) continue;
        // 平常每拍一小把；小節線上輪到的那一爪噴一大把（窗格裡每小節一個小事件）
        const bar = au.barAt(tb), onBar = Math.abs(bar - Math.round(bar)) < 0.06;
        const big = onBar && ((n % 3) + 3) % 3 === ((Math.round(bar) % 3) + 3) % 3;
        const cnt = big ? 24 : 6, spK = big ? 1.5 : 1;
        for (let i = 0; i < cnt; i++) {
          const h1 = hash(n, b, i, 1), h2 = hash(n, b, i, 2), h3 = hash(n, b, i, 3);
          const ang = -Math.PI * (0.15 + 0.5 * h1), sp = (160 + 260 * h2) * spK;
          const px = x0 + 40 + Math.cos(ang) * sp * age, py = y0 - 10 + Math.sin(ang) * sp * age + 420 * age * age;
          const rr = 2.5 + 4 * h3;
          const k = 1 - age / 1.1;
          if (py > WALL.base + 60) continue;
          lb.seg2(px, py, px + 0.01, py, rr * 2 + 2.4, ink, k);
          lb.seg2(px, py, px + 0.01, py, rr * 2, pap, k);
        }
      }
    }
    // 前景白浪的浪尖：往左捲（兩道浪一左一右，對著彼此）
    const fx = FORE_PEAK.x, fy = this.foreY(fx, this.phF) + 2;
    this.claw(segs, fx, fy, -1, 128, 0.34 + 0.22 * curlK);
    // 先畫墨色的邊（粗一點），再畫紙白的指頭：相鄰的指頭會黏在一起，像一整片浪花
    for (const [ax, ay, bx, by, w] of segs) lb.seg2(ax, ay, bx, by, w + 3.4, ink, 1);
    for (const [ax, ay, bx, by, w] of segs) lb.seg2(ax, ay, bx, by, w, pap, 1);
    // 指頭上的小泡泡（紙白的點，版畫浪花上的白點）
    for (let i = 0; i < segs.length; i += 3) {
      const [, , bx, by, w] = segs[i]!;
      if (w < 6) continue;
      lb.seg2(bx, by, bx + 0.01, by, 2.2, ink, 0.55);
    }
  }

  /** 排成留言的泡沫：從浪頭飛下來、停在字的形狀上，字實起來之後淡掉。 */
  private drawFoamDots(t: number) {
    const lb = this.foam, pap = LIN.paper;
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i]!;
      const g = this.glyphs[d.g];
      if (!g) continue;
      const tArr = g.t - 0.05 + 0.08 * hash(i, 9);
      const t0 = tArr - 0.55;
      if (t < t0) continue;
      const fade = 1 - prog(t, g.t + 0.1, g.t + 0.6);
      if (fade <= 0) continue;
      const q = ease.outCubic(prog(t, t0, tArr));
      // 拋物線：從浪頭先往右上甩一點再落到字上
      const mx = lerp(d.sx, d.x, 0.5) + 60, my = Math.min(d.sy, d.y) - 90;
      const x = (1 - q) * (1 - q) * d.sx + 2 * (1 - q) * q * mx + q * q * d.x;
      const y = (1 - q) * (1 - q) * d.sy + 2 * (1 - q) * q * my + q * q * d.y;
      const r = 3.2 + 1.6 * hash(i, 3);
      lb.seg2(x, y, x + 0.01, y, r * 2, pap, fade);
    }
    void TAU; void mixRgba;
  }
}
