// 字母積木（亮，雙語）：午後的窗邊，淺色木頭桌上一疊木頭字母積木。
//  - 每一句歌詞是一座積木塔：下面一排小一點的積木拼出原文（韓文一個音節一塊、英文一個字一塊），上面架一條長木板，
//    木板上一排大一點的積木拼出中文（中文一個字一塊）。兩排的字照自己的逐字時間亮：正在唱的字是訊號色，唱完是墨色。
//    沒有翻譯的歌只有中文一排，直接放在桌上。一排放不下就折成兩排，中間一樣架木板。
//  - 每句開頭：積木從上面一塊一塊掉下來疊上去（由下往上、由左往右，落在拍子附近，落地彈一下）；
//    這句唱完：整座塔從上面開始倒下、滾開、淡出，下一句的積木再一塊一塊疊上來。
//  - 唱到的那一塊輕輕跳一下；大鼓時整座塔晃一下；每個小節線，右邊的積木盒裡被丟進一塊積木（拋物線、落進盒子彈一下）。
//    窗光在牆上慢慢移。純音樂時積木拼的是新人的名字，每兩小節倒下再疊一次。
//  - 主打留言寫在靠牆立著的積木盒蓋上（留言標準 v2：盒蓋約 620×440、手寫 40～60 px）；沒有留言時盒蓋上是邀請。
// 畫法：牆、窗光、桌面、影子一個 shader；盒蓋與盒子是 init 畫一次的圖層；積木每格畫在一張圖層上
// （每種大小的積木本體先畫成小圖，每格只貼圖＋寫字）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { fitText } from '../engine/text';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { beatAfter, lyricSubOf, subSizeFor, COUPLE_EN, COUPLE_ZH, HAS_LATIN_NAMES, type LyricStyle } from './_motifs';
import { INVITE_SMALL, paperSignal } from './_t19';
import { barsIn, makeCanvas, freeCanvas } from './_t1';
import { placeBlock, drawBlock, sigOf, fitV2 } from './_t22';
import { lyricV2, V2 } from './_v2';
import { mainOnly, preloadPair, hasSubIn, type Rect } from './_b4';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'lingo', paper: true, energy: [0.2, 0.9], bars: [4, 12], weight: 1 };

/** 桌面的後緣（牆與桌的交界）、積木塔落在桌上的 y、塔的中線、一排最寬多少。 */
const TABLE_Y = 560, BASE_Y = 800, TCX = 640, MAXW = 960;
/** 木板厚度、積木之間的縫、字距的空（韓文、英文單字之間的空白多空一點）。 */
const PLANK = 13, GAP = 5, SPACE = 16;
/** 盒蓋（留言）與盒子。 */
const LID = { x: 1190, y: 226, w: 620, h: 440, rot: -0.025 };
const LM = { x: 50, y: 104, w: 520, h: 290 };
const BOX = { x: 1210, y: 680, w: 520, h: 118 };

const T_LID = '字母積木 · ABC · 가나다 · 一二三';
const T_LID2 = '3 歲以上 · 全 108 塊';

// ---------------------------------------------------------------- 牆、窗光、桌面（整晚共用）
const BG = () => new FSPass(/* glsl */ `
  uniform float win; uniform vec4 shA; uniform vec4 shB; uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col;
    if (p.y < ${TABLE_Y}.0) {
      // 牆：很淡的暖白，窗光（兩格窗，斜斜地落在牆上，很慢地移）
      col = mix(C_PAPER, C_BONE, 0.3) * (0.93 + 0.04 * smoothstep(${TABLE_Y}.0, 0.0, p.y));
      vec2 w = rot2(-0.3) * (p - vec2(420.0 + win, 210.0));
      float pane = smoothstep(190.0, 150.0, abs(w.x)) * smoothstep(250.0, 200.0, abs(w.y));
      float mull = smoothstep(4.0, 14.0, abs(w.x)) * smoothstep(4.0, 14.0, abs(w.y));
      col *= 1.0 + 0.06 * pane * mull;
      // 牆腳一條踢腳板
      col = mix(col, mix(C_PAPER, C_SEPIA, 0.2), smoothstep(${TABLE_Y - 30}.0, ${TABLE_Y - 28}.0, p.y));
      col *= 1.0 - 0.1 * smoothstep(${TABLE_Y - 30}.0, ${TABLE_Y}.0, p.y);
    } else {
      // 桌面：淺色木頭，木紋往後收（透視），近的地方亮一點
      float z = (p.y - ${TABLE_Y}.0) / ${H - TABLE_Y}.0;
      float g = fbm(vec2((p.x - 960.0) / (160.0 + 800.0 * z), z * 26.0), 3);
      float ring = sin(((p.x - 960.0) / (60.0 + 260.0 * z) + 3.0 * g) * 3.1);
      col = mix(C_PAPER, C_SEPIA, 0.2 + 0.035 * g + 0.012 * ring) * (0.95 + 0.07 * z);
      // 桌子後緣一條細細的暗線（桌子的厚度在牆前面）
      col *= 1.0 - 0.18 * smoothstep(6.0, 0.0, p.y - ${TABLE_Y}.0);
      // 窗光落在桌上（一大片、很柔）
      col *= 1.0 + 0.05 * exp(-pow(length((p - vec2(700.0 + win * 0.6, 760.0)) / vec2(700.0, 180.0)), 2.0));
      // 影子：積木塔、盒子（很柔的橢圓）
      col *= 1.0 - shA.w * exp(-pow(length((p - shA.xy) / vec2(shA.z, 26.0)), 2.0));
      col *= 1.0 - shB.w * exp(-pow(length((p - shB.xy) / vec2(shB.z, 30.0)), 2.0));
    }
    fragColor = vec4(col, 1.0);
  }`, { win: { value: 0 }, shA: { value: new THREE.Vector4() }, shB: { value: new THREE.Vector4() }, t: { value: 0 } });

/** 塔裡的一塊：積木（或木板）的位置（前面那一面的左下角）、大小、字、這個字的時間。 */
interface Blk { kind: 'blk' | 'plank'; text: string; word: Word | null; sub: boolean; x: number; y: number; w: number; h: number; tone: number; land: number; fall: number; spin: number }
interface Tower { line: Line | null; blks: Blk[]; mainSize: number; subSize: number; tDrop: number; tFall: number; w: number; top: number; still: boolean }

export default class HangulBlocks extends Scene {
  bg = shared('hangulblocks.bg', BG);
  props = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) >>> 0;
  bilingual = false;
  towers: Tower[] = [];
  bars: number[] = [];
  mainSize: number = V2.lyrMax;
  ink = { active: 'rgba(0,0,0,1)', sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28) };
  /** 積木本體的小圖（依大小與木色快取）。 */
  private bodies = new Map<string, ReturnType<typeof makeCanvas>>();
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, start: s, end: e, lyrics } = this.ctx;
    const m = this.msg;
    await preloadPair(this.ctx, `${m ? m.text + sigOf(m) : ''}${INVITE_SMALL}${T_LID}${T_LID2}${COUPLE_ZH}${COUPLE_EN}FROM THE COUPLE · 新人給♥사랑愛`);
    this.bilingual = hasSubIn(this.ctx);
    this.bars = barsIn(au, s, e);
    this.ink.active = paperSignal();
    this.drawProps();
    // ---- 每一句一座塔：什麼時候疊上來、什麼時候倒下
    const c = this.dyn.ctx;
    const lines = lyrics.linesIn(s - 0.2, e + 0.2);
    let prevFall = -Infinity;
    lines.forEach((line, i) => {
      const next = lines[i + 1];
      const tDrop = Math.max(line.start - 0.62, prevFall + 0.12, s + 0.05);
      const tFall = next ? clamp(next.start - 0.75, line.end - 0.15, line.end + 1.4) : Math.min(line.end + 1.4, e + 1);
      const tw = this.build(c, line, tDrop, tFall);
      prevFall = tFall;
      this.towers.push(tw);
    });
    if (!lyrics.has) {
      // 純音樂：拼新人的名字，每兩小節倒下再疊一次
      const B = au.beatPeriod(s + 0.1);
      const b0 = beatAfter(au, s + Math.min(0.2, B * 0.5));
      const cuts = [b0, ...this.bars.filter((b, k) => b > b0 + B && k % 2 === 1), e + 1];
      for (let k = 0; k + 1 < cuts.length; k++) this.towers.push(this.build(c, null, cuts[k]!, cuts[k + 1]! - 0.6));
    }
    this.avoid = [[TCX - MAXW / 2, 360, MAXW, 450], [LID.x, LID.y, LID.w, LID.h]];
  }

  /** 盒蓋（留言）與盒子（裡面露出幾塊積木）。 */
  private drawProps() {
    const L = this.props, c = L.ctx, m = this.msg;
    L.clear();
    c.textBaseline = 'alphabetic';
    // ---- 盒蓋：靠牆立著、稍微歪；木頭邊框、中間一張貼紙（留言寫在貼紙上）
    c.save();
    c.translate(LID.x + LID.w / 2, LID.y + LID.h / 2); c.rotate(LID.rot); c.translate(-LID.w / 2, -LID.h / 2);
    c.fillStyle = rgba('sepia', 0.18);
    c.beginPath(); c.roundRect(14, 18, LID.w, LID.h, 10); c.fill();
    c.fillStyle = mixRgba('paper', 'sepia', 0.32);
    c.beginPath(); c.roundRect(0, 0, LID.w, LID.h, 10); c.fill();
    c.fillStyle = mixRgba('paper', 'sepia', 0.22);
    c.beginPath(); c.roundRect(10, 10, LID.w - 20, LID.h - 20, 6); c.fill();
    // 貼紙
    c.fillStyle = mixRgba('paper', 'bone', 0.55);
    c.beginPath(); c.roundRect(24, 24, LID.w - 48, LID.h - 48, 4); c.fill();
    c.fillStyle = paperSignal(0.85); c.fillRect(24, 24, LID.w - 48, 50);
    c.font = font(F.hei(700), 20); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.95);
    c.fillText(m?.couple ? 'FROM THE COUPLE · 新人' : T_LID, 46, 57);
    c.letterSpacing = '0px';
    c.font = font(F.hei(500), 14); c.fillStyle = rgba('sepia', 0.5); c.textAlign = 'right';
    c.fillText(T_LID2, LID.w - 44, LID.h - 40); c.textAlign = 'left';
    let msgSize: number | null = null;
    if (m) {
      const fam = F.hand(700), sig = sigOf(m);
      const blk = fitV2(c, m.text, fam, LM.w, LM.h, 1, { lineHeight: 1.28 });
      const top = LM.y + Math.max(0, (LM.h - blk.height) * 0.4);
      const pl = placeBlock(c, blk, fam, sig, LM.x, top);
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.95), sigColor: rgba('sepia', 0.72) });
      msgSize = blk.fit.size;
    } else {
      c.fillStyle = rgba('sepia', 0.8);
      const fit = fitText(c, INVITE_SMALL, F.hand(700), LM.w, 140, { min: 32, max: 40, maxLines: 2 });
      c.font = font(F.hand(700), fit.size);
      fit.lines.forEach((ln, i) => c.fillText(ln, LM.x, LM.y + 110 + i * fit.lineHeight));
    }
    c.restore();
    this.mainSize = lyricV2(msgSize);
    // ---- 牆上的層板：擺著三塊積木（사、랑、愛，淡淡的，當擺飾）與一小盆植物
    const SH = { x: 170, y: 262, w: 620 };
    c.fillStyle = rgba('sepia', 0.1); c.fillRect(SH.x + 8, SH.y + 14, SH.w, 16);
    c.fillStyle = mixRgba('paper', 'sepia', 0.3); c.fillRect(SH.x, SH.y, SH.w, 12);
    c.fillStyle = mixRgba('paper', 'sepia', 0.15); c.fillRect(SH.x + 6, SH.y - 5, SH.w - 12, 5);
    const deco: [number, number, string][] = [[SH.x + 60, SH.y - 5, '사'], [SH.x + 124, SH.y - 5, '랑'], [SH.x + 92, SH.y - 69, '愛']];
    for (const [x, y, ch] of deco) {
      c.fillStyle = mixRgba('paper', 'sepia', 0.4); c.beginPath(); c.moveTo(x + 58, y - 58); c.lineTo(x + 68, y - 68); c.lineTo(x + 68, y - 10); c.lineTo(x + 58, y); c.closePath(); c.fill();
      c.fillStyle = mixRgba('paper', 'sepia', 0.1); c.beginPath(); c.moveTo(x, y - 58); c.lineTo(x + 10, y - 68); c.lineTo(x + 68, y - 68); c.lineTo(x + 58, y - 58); c.closePath(); c.fill();
      c.fillStyle = mixRgba('paper', 'sepia', 0.22); c.fillRect(x, y - 58, 58, 58);
      c.strokeStyle = mixRgba('signal', 'paper', 0.45, 0.6); c.lineWidth = 2; c.strokeRect(x + 6, y - 52, 46, 46);
      c.font = font(F.archivo(100, 800), 28); c.textAlign = 'center'; c.fillStyle = rgba('sepia', 0.5); c.fillText(ch, x + 29, y - 19); c.textAlign = 'left';
    }
    // 小盆栽：陶盆與幾片葉子
    const px = SH.x + SH.w - 120, py = SH.y - 5;
    c.fillStyle = mixRgba('paper', 'blood', 0.35);
    c.beginPath(); c.moveTo(px - 30, py - 52); c.lineTo(px + 30, py - 52); c.lineTo(px + 22, py); c.lineTo(px - 22, py); c.closePath(); c.fill();
    c.fillStyle = mixRgba('paper', 'sepia', 0.5);
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.38, L = 46 + 16 * hash(i, 8);
      c.save(); c.translate(px, py - 54); c.rotate(a + Math.PI / 2);
      c.beginPath(); c.ellipse(0, -L / 2, 9, L / 2, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    // ---- 盒子（開口朝上、前面一片木板），裡面露出幾塊積木的頂
    const bx = BOX.x, by = BOX.y;
    c.fillStyle = mixRgba('paper', 'sepia', 0.5);
    c.beginPath(); c.moveTo(bx + 16, by - 22); c.lineTo(bx + BOX.w + 16, by - 22); c.lineTo(bx + BOX.w, by); c.lineTo(bx, by); c.closePath(); c.fill();
    for (let i = 0; i < 9; i++) {
      const w = 44 + 8 * hash(i, 3), x = bx + 28 + i * 54 + 6 * hash(i, 4), y = by - 18 + 8 * hash(i, 5);
      c.fillStyle = mixRgba('paper', i % 3 === 0 ? 'signal' : 'sepia', 0.2 + 0.12 * hash(i, 6));
      c.beginPath(); c.roundRect(x, y - 10, w, 18, 3); c.fill();
    }
    c.fillStyle = mixRgba('paper', 'sepia', 0.3);
    c.fillRect(bx, by, BOX.w, BOX.h);
    // 盒子前面印著一條訊號色的帶子
    c.fillStyle = paperSignal(0.55); c.fillRect(bx, by + 44, BOX.w, 26);
    c.font = font(F.hei(700), 16); c.letterSpacing = '6px'; c.fillStyle = rgba('bone', 0.95);
    c.fillText('ABC · 가나다 · 一二三', bx + 24, by + 63); c.letterSpacing = '0px';
    c.fillStyle = mixRgba('paper', 'sepia', 0.42);
    c.beginPath(); c.moveTo(bx + BOX.w, by); c.lineTo(bx + BOX.w + 16, by - 22); c.lineTo(bx + BOX.w + 16, by + BOX.h - 22); c.lineTo(bx + BOX.w, by + BOX.h); c.closePath(); c.fill();
    c.fillStyle = rgba('bone', 0.35); c.fillRect(bx, by, BOX.w, 2);
    c.strokeStyle = rgba('sepia', 0.18); c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(bx, by + i * 30); c.bezierCurveTo(bx + 180, by + i * 30 + 4, bx + 340, by + i * 30 - 4, bx + BOX.w, by + i * 30 + 2); c.stroke(); }
    L.upload();
  }

  /** 一句歌詞（或純音樂時新人的名字）排成一座塔。 */
  private build(c: CanvasRenderingContext2D, line: Line | null, tDrop: number, tFall: number): Tower {
    const mainSize = this.mainSize, subSize = subSizeFor(mainSize);
    const toks = (ln: Line) => ln.words.map((w) => ({ text: w.w.trim(), word: w as Word | null, gap: w.o > 0 && ln.text[w.o - 1] === ' ' }));
    // 純音樂：一個字一塊（中間的 & 也是一塊）
    const fake = (str: string) => Array.from(str.replace(/\s/g, '')).map((ch) => ({ text: ch, word: null as Word | null, gap: false }));
    const mainT = line ? toks(mainOnly(line)) : fake(COUPLE_ZH);
    const subLine = line && this.bilingual ? lyricSubOf(line) : null;
    // 純音樂的英文名那一排：沒有英文名時 COUPLE_EN 就是中文名，再疊一排一樣的字沒有意義，只疊中文那排
    const enT = !line && HAS_LATIN_NAMES && COUPLE_EN !== COUPLE_ZH ? COUPLE_EN.split(/\s+/).map((w, i) => ({ text: w, word: null as Word | null, gap: i > 0 })) : null;
    const subT = subLine ? toks(subLine) : enT;
    // 一塊積木的寬：中文、韓文一個字是正方形；英文單字照字寬
    const sizeOf = (tok: { text: string }, fs: number) => {
      c.font = font(F.archivo(100, 800), fs);
      const h = Math.round(fs * 1.8);
      const tw = c.measureText(tok.text).width;
      return { w: Math.max(h, Math.round(tw + fs * 0.62)), h };
    };
    const rowsOf = (tk: typeof mainT, fs: number) => {
      const items = tk.map((t) => ({ ...t, ...sizeOf(t, fs) }));
      const width = (a: typeof items) => a.reduce((s, it, i) => s + it.w + (i ? GAP + (it.gap ? SPACE : 0) : 0), 0);
      if (width(items) <= MAXW || items.length < 2) return [items];
      // 放不下：在最接近中間的地方折成兩排（優先折在空白）
      let best = 1, bestD = Infinity;
      for (let k = 1; k < items.length; k++) {
        const d = Math.max(width(items.slice(0, k)), width(items.slice(k))) - (items[k]!.gap ? 40 : 0);
        if (d < bestD) { bestD = d; best = k; }
      }
      return [items.slice(0, best), items.slice(best)];
    };
    const mainRows = rowsOf(mainT, mainSize);
    const subRows = subT ? rowsOf(subT, subSize) : [];
    const rows = [...mainRows.map((r) => ({ r, sub: false })), ...subRows.map((r) => ({ r, sub: true }))];
    // ---- 由下往上疊：最下面一排放在桌上，每一排上面架一條木板再放上一排
    const blks: Blk[] = [];
    let y = BASE_Y, tw = 0;
    const widthOf = (r: typeof mainRows[number]) => r.reduce((s, it, i) => s + it.w + (i ? GAP + (it.gap ? SPACE : 0) : 0), 0);
    for (let ri = rows.length - 1; ri >= 0; ri--) {
      const { r, sub } = rows[ri]!;
      const w = widthOf(r);
      tw = Math.max(tw, w);
      let x = TCX - w / 2;
      const h = r[0]!.h;
      r.forEach((it, i) => {
        if (i) x += GAP + (it.gap ? SPACE : 0);
        const tone = Math.floor(hash(this.seed, it.text.codePointAt(0) ?? 0, i) * 4);
        blks.push({ kind: 'blk', text: it.text, word: it.word, sub, x, y, w: it.w, h, tone, land: 0, fall: 0, spin: 0 });
        x += it.w;
      });
      y -= h;
      if (ri > 0) {
        const pw = Math.max(w, widthOf(rows[ri - 1]!.r)) + 26;
        blks.push({ kind: 'plank', text: '', word: null, sub: false, x: TCX - pw / 2, y, w: pw, h: PLANK, tone: 0, land: 0, fall: 0, spin: 0 });
        y -= PLANK;
      }
    }
    // ---- 疊上來的順序（由下往上、由左往右）與倒下的順序（由上往下）
    const n = blks.length;
    const stagger = Math.min(0.04, 0.55 / Math.max(1, n));
    blks.forEach((b, i) => {
      b.land = tDrop + 0.3 + i * stagger;
      b.fall = tFall + (n - 1 - i) * 0.018;
      b.spin = (hash(this.seed, i, 77) - 0.35) * 2.2;
    });
    return { line, blks, mainSize, subSize, tDrop, tFall, w: tw, top: y, still: !line };
  }

  /** 積木本體（前面、頂面、右側面、漆的邊框）畫成小圖，依大小與木色快取。 */
  private body(w: number, h: number, tone: number, plank: boolean) {
    const key = `${w}x${h}:${tone}:${plank ? 1 : 0}`;
    let b = this.bodies.get(key);
    if (b) return b;
    const d = Math.round(h * (plank ? 0.9 : 0.2));
    b = makeCanvas(w + d + 2, h + d + 2, 2);
    const c = b.c;
    // 四種木色：原木、上了訊號色的漆、淡淡的暗紅漆、白漆（都從色票混出來，跟著每首歌的主題變）
    const face = [mixRgba('paper', 'sepia', 0.2), mixRgba('paper', 'signal', 0.3), mixRgba('paper', 'blood', 0.2), mixRgba('paper', 'bone', 0.55)][tone]!;
    const top = [mixRgba('paper', 'sepia', 0.08), mixRgba('paper', 'signal', 0.18), mixRgba('paper', 'blood', 0.1), mixRgba('paper', 'bone', 0.75)][tone]!;
    const side = [mixRgba('paper', 'sepia', 0.42), mixRgba('signal', 'sepia', 0.45), mixRgba('blood', 'paper', 0.5), mixRgba('paper', 'sepia', 0.3)][tone]!;
    const paint = [mixRgba('signal', 'sepia', 0.3, 0.8), mixRgba('paper', 'bone', 0.5, 0.9), mixRgba('blood', 'paper', 0.3, 0.7), mixRgba('signal', 'paper', 0.2, 0.8)][tone]!;
    // 頂面（往右上斜）
    c.fillStyle = plank ? mixRgba('paper', 'sepia', 0.12) : top;
    c.beginPath(); c.moveTo(0, d); c.lineTo(d, 0); c.lineTo(w + d, 0); c.lineTo(w, d); c.closePath(); c.fill();
    // 右側面
    c.fillStyle = plank ? mixRgba('paper', 'sepia', 0.45) : side;
    c.beginPath(); c.moveTo(w, d); c.lineTo(w + d, 0); c.lineTo(w + d, h); c.lineTo(w, h + d); c.closePath(); c.fill();
    // 前面
    c.fillStyle = plank ? mixRgba('paper', 'sepia', 0.3) : face;
    c.fillRect(0, d, w, h);
    // 木紋（很淡的兩三條）
    c.strokeStyle = rgba('sepia', 0.1); c.lineWidth = 1;
    for (let i = 0; i < (plank ? 2 : 3); i++) {
      const yy = d + h * (0.25 + 0.25 * i) + 3 * Math.sin(i * 2.1 + w);
      c.beginPath(); c.moveTo(2, yy); c.bezierCurveTo(w * 0.3, yy - 3, w * 0.7, yy + 3, w - 2, yy + 1); c.stroke();
    }
    if (!plank) {
      // 漆上去的細框（字母積木的樣子）
      c.strokeStyle = paint; c.lineWidth = Math.max(2, h * 0.045);
      c.beginPath(); c.roundRect(h * 0.1, d + h * 0.1, w - h * 0.2, h * 0.8, h * 0.08); c.stroke();
    }
    // 邊（倒角的亮線與暗線）
    c.fillStyle = rgba('bone', 0.35); c.fillRect(0, d, w, 1.5);
    c.fillStyle = rgba('sepia', 0.25); c.fillRect(0, d + h - 1.5, w, 1.5);
    this.bodies.set(key, b);
    return b;
  }

  /** 畫一塊（含字與跟唱）；dx、dy、ang、alpha 是動畫。 */
  private drawBlk(c: CanvasRenderingContext2D, tw: Tower, b: Blk, t: number, dy: number, ang: number, alpha: number, hop: number) {
    const plank = b.kind === 'plank';
    const d = Math.round(b.h * (plank ? 0.9 : 0.2));
    const body = this.body(b.w, b.h, b.tone, plank);
    c.save();
    c.globalAlpha = alpha;
    // 以積木底邊的中心為支點旋轉（倒下時）
    c.translate(b.x + b.w / 2, b.y + dy - hop);
    c.rotate(ang);
    // 貼著下面那一層的接觸影（跳起來、掉下來時變淡）
    const lift = hop - dy;
    if (ang === 0 && lift < 40) { c.fillStyle = rgba('sepia', 0.24 * (1 - lift / 40)); c.fillRect(-b.w / 2 + 2, lift - 2, b.w + d * 0.6, 5); }
    c.drawImage(body.cv, -b.w / 2, -b.h - d, body.w, body.h);
    if (!plank && b.text) {
      const fs = b.sub ? tw.subSize : tw.mainSize;
      c.font = font(F.archivo(100, 800), fs);
      c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      const ty = -b.h / 2 + fs * 0.36;
      const p = tw.still ? 1 : b.word ? Lyrics.wordProgress(b.word, t) : 0;
      // 原文那一排：唱到、唱完都用「唱完」的顏色（副行的規則，不跟中文搶）
      const act = b.sub ? this.ink.sung : this.ink.active;
      c.fillStyle = this.ink.unsung;
      if (p < 1) c.fillText(b.text, 0, ty);
      if (p > 0) {
        c.save();
        const tw2 = c.measureText(b.text).width;
        c.beginPath(); c.rect(-tw2 / 2 - fs * 0.1, ty - fs * 1.1, (tw2 + fs * 0.2) * p, fs * 1.5); c.clip();
        c.globalAlpha = alpha * (b.sub ? 0.85 : 1);
        c.fillStyle = p < 1 ? act : this.ink.sung;
        c.fillText(b.text, 0, ty);
        c.restore();
      }
    }
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const D = this.dyn, c = D.ctx;
    D.clear();
    let shadowW = 0, shadowK = 0;
    for (const tw of this.towers) {
      if (t < tw.tDrop || t > tw.tFall + 1.2) continue;
      let visible = false;
      tw.blks.forEach((b, i) => {
        if (t < b.land - 0.34) return;
        // 掉下來：從上面 300 px 落下（加速），落地時彈一下
        let dy = 0;
        if (t < b.land) { const u = (t - (b.land - 0.34)) / 0.34; dy = -300 * (1 - u * u); }
        else dy = -7 * Math.exp(-(t - b.land) * 12) * Math.abs(Math.sin((t - b.land) * 22));
        // 倒下：往外轉、往下掉、淡出
        let ang = 0, alpha = 1;
        if (t > b.fall) {
          const a = t - b.fall;
          ang = b.spin * ease.inQuad(clamp(a / 0.55)) * 1.1;
          dy += 180 * a * a + 30 * a;
          alpha = 1 - clamp((a - 0.2) / 0.35);
        } else if (t > b.land) {
          // 大鼓時整座塔晃一下（越上面晃越多）
          const hgt = (BASE_Y - b.y) / 300;
          ang = 0.02 * f.a.kick * hgt * Math.sin(i * 1.7 + t * 9);
        }
        if (alpha <= 0.01) return;
        visible = true;
        // 正在唱的那一塊輕輕跳一下
        const hop = b.word && !b.sub && t > b.land ? 9 * Math.exp(-Math.max(0, t - b.word.start) * 9) * (t >= b.word.start ? 1 : 0) : 0;
        this.drawBlk(c, tw, b, t, dy, ang, alpha, hop);
      });
      if (visible) { shadowW = Math.max(shadowW, tw.w * 0.62); shadowK = Math.max(shadowK, 0.14 * (1 - clamp((t - tw.tFall) / 0.6)) * clamp((t - tw.tDrop - 0.25) / 0.3)); }
    }
    // ---- 每個小節線：一塊積木被丟進右邊的盒子（拋物線、落進去彈一下）
    for (let k = 0; k < this.bars.length; k++) {
      const b = this.bars[k]!;
      const a = t - b;
      if (a < 0 || a > 0.9) continue;
      const u = clamp(a / 0.62);
      const x0 = 1880, y0 = 380, x1 = BOX.x + 90 + 330 * hash(this.seed, k, 3), y1 = BOX.y - 12;
      const x = lerp(x0, x1, u), y = lerp(y0, y1, u) - 220 * Math.sin(Math.PI * u) + (a > 0.62 ? -6 * Math.exp(-(a - 0.62) * 14) * Math.abs(Math.sin((a - 0.62) * 25)) : 0);
      const tone = Math.floor(hash(this.seed, k, 9) * 4);
      const body = this.body(52, 52, tone, false);
      c.save(); c.translate(x, y); c.rotate(-4 * u * (1 - u) * 2.2 + (a > 0.62 ? 0.12 : 0));
      c.globalAlpha = a > 0.62 ? 1 - clamp((a - 0.7) / 0.2) : 1;
      c.drawImage(body.cv, -26, -52 - 10, body.w, body.h);
      c.restore();
    }
    D.upload();

    const B = this.bg;
    B.u.win!.value = 60 * Math.sin((t - s) * 0.12) + 40 * ease.inOutQuad(prog(t, s, e));
    (B.u.shA!.value as THREE.Vector4).set(TCX + 10, BASE_Y + 4, Math.max(40, shadowW), shadowK);
    (B.u.shB!.value as THREE.Vector4).set(BOX.x + BOX.w / 2 + 10, BOX.y + BOX.h + 2, BOX.w * 0.6, 0.16);
    B.u.t!.value = t;
    B.render(renderer, out);
    comp.draw(renderer, this.props.texture, out);
    comp.draw(renderer, D.texture, out);
    const push = ease.inOutQuad(prog(t, s, e));
    return { paper: 1, bloom: 0.25, bloomThreshold: 1.4, halation: 0.04, vignette: 0.28, grain: 0.045, zoom: 1 + 0.025 * push, popupAvoid: this.avoid };
  }

  override dispose() {
    for (const b of this.bodies.values()) freeCanvas(b);
    this.bodies.clear();
    super.dispose();
  }
}
