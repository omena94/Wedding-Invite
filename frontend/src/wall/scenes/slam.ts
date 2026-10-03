// 大字重擊（照 pdoom 的 hook：一個字一下，滿版 Archivo 900 正好打在唱到的那一刻）。副歌、快歌用。
// 歌詞切成「一拍一組」的詞組（slam-type.ts），每組在它第一個字開始唱的那一刻打上來，組裡的字照跟唱規則逐字亮起，
// 唱完的字從訊號色冷卻成紙白。字後面是很淡的字體樣張細線（基線、字面高度），像印刷廠的試印張。
// MV 融合原則：一格畫面只有一個焦點——
//  - 有主打留言：舞台上重擊的是「留言」。第一個拍點起一拍一組打上來（最多兩小節），組成一整塊後一直留到窗格結束，
//    署名在下面；定住之後鏡頭很慢地往前推、輕輕漂，每個小節線再輕輕打一下（保留重擊的節奏，但讀得下去）。
//    歌詞退成上方的一條整句歌詞帶（照跟唱規則，明顯小一級）；純音樂就只有留言。
//  - 沒有留言：歌詞重擊（焦點＝歌詞）；兩句之間夠長的空檔、或整段沒有歌詞：一拍一組打一句邀請（掃描右下角 QR code）。
// 四種變化款（params.variant）：
//   0 乾淨：紙白字在底色上。詞組一組組打在最後的位置上，疊成一整塊（pdoom 的「文字壓力」）；火花沿著基線跟唱。
//   1 更重：底色字在滿版訊號色上，一次只有一組、撐滿畫面；打完在下一拍組成一塊。退場時眼皮闔上成一條發光的縫。
//   2 安靜：極細的字、很小、大量的黑；新的一組從下面升上來，舊的往上爬、變淡，整疊慢慢轉。
//   3 最滿：一組撐滿畫面，打上來的那一下疊影往外擴散、字分裂、畫面震（都很快衰減）；定住的留言幾乎靜止，讀得清楚。
// v2（「留言尺寸與版面比例標準 v2」）：大字只給歌詞（沒有留言的窗格）與很短的留言（≤ 6 字的那一下重擊）。
//  - 留言打完組成一塊時照 v2 字級（40～60 px，依字數）、放在畫面左邊一塊 ≤ 800×430 的地方，署名 26～32；
//    長留言的詞組直接打在最後的位置上（不再一組撐滿畫面）。上方的歌詞帶 40～52（不比留言大）。
//  - 空出來的右半邊：正在唱的那個詞變成巨大的空心字（很細的描邊、很淡），每個詞在唱到的那一刻「砸」下來再淡掉，
//    跟著拍子一直在動——保留「重擊」的感覺，但只是背景的紋理，不搶留言（純音樂時砸的是新人的名字）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba, type PaletteKey } from '../engine/palette';
import { clamp, ease, lerp, noise1, prog, pulse } from '../engine/util';
import { readSeconds } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { sparkHead, sparkParticles, drawLyric, layoutLyric, lyricAt, signature, beatAfter, NAME_A, NAME_B, NAME_A_EN, NAME_B_EN, lyricSubOf, subStyleFor, subGap, drawLyricSub, type LyricStyle } from './_motifs';
import { V2, msgMaxFor, msgLen, lyricV2, sigV2 } from './_v2';
// （標點、符號不算字：「新婚快樂！！！」是四個字的短句，可以重擊）
import { layoutSlab, linePieces, textPieces, drawCells, headAt, isEastern, type Piece, type Slab, type Tone } from './slam-type';
// 最早的版面：排程參數在 director.ts 的 PLATES；這裡只宣告雙語（雙語普查通過：有翻譯＋主打留言時中文、原文、留言三樣都清楚）
export const spec: PlateSpecDecl = { bilingual: true };

/** 純音樂時右半邊輪流砸的字：兩位新人的名字（用 Canvas2D 畫，沒有英文名時中文也畫得出來）。 */
const GHOST_NAMES = [NAME_A_EN || NAME_A, '&', NAME_B_EN || NAME_B];


/** 舞台左右（離邊 120：規定 96，投影機裁邊再多留一點）。 */
const X0 = 120, X1 = 1800, SW = X1 - X0;
/** 變化款 0 的歌詞塊靠左、右邊留一欄空白（瑞士網格的不對稱）。 */
const V0_LYRIC_W = SW - 160;
/**
 * 留言塊的最大寬度：比舞台窄一點，因為定住之後鏡頭會往前推（約 7%），推到最大時左右仍離邊 96 px 以上。
 */
const NOTE_W = SW - 120;
/** 舞台頂、舞台底（右下角 HUD 從 y = 830 開始，字的最低點要在它上面）。 */
const TOP = 184, BOTTOM = 780;
/** 上方的整句歌詞帶：第一行的基線、最寬（太長折兩行，往下長）。 */
const STRIP_Y = 172, STRIP_W = 1460;
/** 變化款 1、3 唱歌詞時，大字舞台從歌詞帶下面開始。 */
const STRIP_TOP = 272;
/** 留言塊的舞台（v2）：畫面左邊一塊 ≤ 800 寬，上方有歌詞帶時讓開它，下面留給署名那一列。 */
const NOTE_TOP_STRIP = 330, NOTE_TOP = 300, NOTE_BOTTOM = 690;
const NOTE_V2_W = 780;
/** 很短的留言（≤ 這麼多字）打上來的那一下可以一組撐滿畫面（重擊），組成一塊之後一樣照 v2 字級。 */
const SHORT_SLAM = 6;
/** 右半邊空心大字的範圍（留言在左邊時）。 */
const GHOST = { x0: 1000, x1: 1800, y0: 250, y1: 760 };
/** 署名那一列的基線最低到這裡（鏡頭推到最近時仍在 QR 區 y = 830 上面）。 */
const SIG_MAX_Y = 786;
/** 一句唱完後大字留多久（下一句先開始就提早收）。 */
const HOLD = 1.3;
/**
 * 變化款 2（安靜款）的梯子靠左：左緣、最大寬度、中線高度、每一條的間距。
 * 靠左而不置中：瑞士網格的不對稱，右邊留一大片黑。
 */
const LAD = { x: 300, w: 1240, cy: H / 2 + 30, gap: 92 };
/** 安靜款的留言、邀請組成一塊時放的範圍（跟梯子同一個左緣）。 */
const LADDER_NOTE = { top: LAD.cy - 200, bottom: LAD.cy + 140 };
/** 拉丁字的寬度候選：一般寬度優先，放不下才用窄的（pdoom 的 hook 也是一個字一種寬度）。 */
const LATIN = [F.archivo(100, 900), F.archivo(125, 900), F.archivo(75, 900), F.archivo(62, 900)];
const EASTERN = [F.archivo(100, 900)];
const INVITE = ['掃描', '右下角', 'QR code', '把祝福', '寫上', '大螢幕'];

// 背景＋合成：底色（帶一點紙的起伏）、把字層疊上去；訊號色的字加亮（會發光）。
// 變化款 3 的疊影與分裂也在這裡做：在 GPU 上取樣放大的字層，比在 Canvas2D 畫好幾份大字便宜很多。
const COMP = () => new FSPass(/* glsl */ `
  uniform sampler2D tex; uniform float t;
  uniform vec3 bgA; uniform vec3 bgB; uniform float texAmt;
  uniform vec3 pulseCol; uniform float pulseK;
  uniform vec4 stage;             // 舞台範圍（uv，y 向上）：疊影與分裂只作用在這裡，上方的歌詞帶與署名不受影響
  uniform float echo; uniform float spread; uniform vec2 echoC;
  uniform float split; uniform float splitSeed;
  uniform float hot;
  uniform float lid;
  float inStage(vec2 q) { return step(stage.x, q.x) * step(q.x, stage.z) * step(stage.y, q.y) * step(q.y, stage.w); }
  // 字層是「預乘、sRGB 編碼」的 RGBA8（見 init 的說明）：這裡還原成直通 alpha 的線性色。
  // 迴圈裡取樣一律用 textureLod（ENGINE.md：迴圈裡的螢幕導數沒有定義，GPU 忙時同一格畫兩次會差一點點）
  vec4 samp(vec2 q) {
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
    vec4 s = textureLod(tex, q, 0.0);
    return s.a > 0.0 ? vec4(toLinear(sat(s.rgb / s.a)), s.a) : vec4(0.0);
  }
  void main() {
    vec2 uv = vUv;
    vec2 px = FRAG_PX;
    // 分裂：舞台裡不規則的橫條各自往左右錯開一點
    if (split > 0.0 && inStage(uv) > 0.5) {
      float yy = ${H}.0 - px.y;
      float band = floor(yy / 34.0 + 2.0 * hash11(floor(yy / 110.0) + splitSeed));
      float r = hash12(vec2(band, splitSeed));
      uv.x += step(0.5, r) * (r - 0.75) * 4.0 * split / ${W}.0;
    }
    vec4 s = samp(uv);
    vec3 col = mix(bgA, bgB, sat(0.5 + 0.6 * fbm(px / 460.0 + vec2(t * 0.013, 0.0), 3)) * texAmt);
    col = mix(col, pulseCol, pulseK);
    // 疊影：同一張字層放大幾份，訊號色與紙白交錯，越外面越淡
    if (echo > 0.002) {
      for (int i = 5; i >= 1; i--) {
        float k = float(i);
        vec2 q = (vUv - echoC) / (1.0 + k * spread) + echoC;
        vec4 e = samp(q) * inStage(q);
        // 訊號色與紙白交錯，但留一半原本的顏色（愛心的疊影還是偏玫瑰色）
        vec3 tint = mix(e.rgb, (i == 1 || i == 3 || i == 5) ? C_SIGNAL : C_BONE, 0.55);
        col = mix(col, tint, e.a * echo * (0.46 - k * 0.075));
      }
    }
    // 字：訊號色的字加亮，超過 bloom 門檻才會發光（紙白的字不發光）
    float h = 1.0 - smoothstep(0.03, 0.16, distance(s.rgb, C_SIGNAL));
    col = mix(col, s.rgb * (1.0 + hot * h), s.a);
    // 眼皮（變化款 1 的退場）：上下兩片底色闔上，中間剩一條發光的縫
    if (lid > 0.0) {
      float dy = abs(px.y - ${H / 2}.0);
      float xx = vUv.x * 2.0 - 1.0;
      float open = (1.0 - lid) * (${H / 2 + 60}.0) * (1.0 - 0.35 * xx * xx);
      float cover = smoothstep(open - 1.0, open + 1.0, dy);
      col = mix(col, C_INK, cover);
      col += C_SIGNAL * 2.6 * exp(-abs(dy - open) / 2.5) * smoothstep(0.55, 1.0, lid) * (1.0 - 0.8 * xx * xx);
    }
    fragColor = vec4(col, 1.0);
  }`, {
  tex: { value: null }, t: { value: 0 },
  bgA: { value: new THREE.Vector3() }, bgB: { value: new THREE.Vector3() }, texAmt: { value: 1 },
  pulseCol: { value: new THREE.Vector3() }, pulseK: { value: 0 },
  stage: { value: new THREE.Vector4(0, 0, 1, 1) },
  echo: { value: 0 }, spread: { value: 0.07 }, echoC: { value: new THREE.Vector2(0.5, 0.5) },
  split: { value: 0 }, splitSeed: { value: 0 }, hot: { value: 0.9 }, lid: { value: 0 },
});

/** 樣張註記上的字族名（照字型檔的說法，冷面）。 */
function familyName(sl: Slab) {
  const m = /^Archivo-(\d+)-(\d+)$/.exec(sl.family);
  if (m) return sl.eastern ? `思源黑體 ${m[2]}` : `ARCHIVO wdth ${Number(m[1]) / 10} wght ${m[2]}`;
  const k = /^(ming|hei|hand)-(\d+)$/.exec(sl.family);
  if (k) return `${k[1] === 'ming' ? '思源宋體' : k[1] === 'hei' ? '思源黑體' : '霞鶩文楷'} ${k[2]}`;
  return sl.family;
}

type Kind = 'line' | 'msg' | 'invite';
interface Box { top: number; bottom: number }
/** 舞台上的一段：一句歌詞、主打留言、邀請。 */
interface Item {
  kind: Kind;
  tIn: number;
  tOut: number;
  pieces: Piece[];
  /** 全部詞組排成一塊（變化款 0 就是這塊一組組打上去；其他款是最後組成的樣子）。 */
  slab: Slab;
  /** 一組一個滿版（變化款 1、3）。 */
  singles: Slab[];
  /** 一組一條細字（變化款 2）。 */
  rungs: Slab[];
  box: Box;
  /** 整塊（slab）的舞台：韓文歌（有原文副行）時下緣往上收，留位置給大字下面的原文；沒有原文就是 box。 */
  sbox: Box;
  align: 'left' | 'center';
  line: Line | null;
  /** 組成一整塊的時間（歌詞：最後一個字唱完的下一拍，來不及就不組）。 */
  tAll: number;
  /** 署名出現的時間（只有留言；邀請是指向 QR 的箭頭）。 */
  tSig: number;
  /** 留言定住之後，每個小節線輕輕再打一下的時間。 */
  hits: number[];
}
interface Rung { slab: Slab; t0: number; item: Item }
type P2 = { x: number; y: number };

/** 目前的畫布座標換成畫面座標（火花要畫在畫面上，字可能在推近、壓扁的變換裡）。 */
function toScreen(c: CanvasRenderingContext2D, p: P2): P2 {
  const m = c.getTransform();
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export default class Slam extends Scene {
  layer = this.track(new Layer2D());
  glow = this.track(new LineBatch(3072, { screen2D: true, blend: 'add' }));
  comp = shared('slam.comp', COMP);
  v = clamp(Math.floor(Number(this.ctx.params.variant ?? 0)) || 0, 0, 3);
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  /** 這段的能量（0..1）：震動、放大的幅度跟著它。 */
  energy = clamp(Number(this.ctx.params.energy ?? 0.7));
  items: Item[] = [];
  rungs: Rung[] = [];
  /** 所有「打上來」的時刻（排好序）：震動、底色閃、疊影都從最近一次算。 */
  slams: number[] = [];
  /** 有留言又有歌詞：歌詞退成上方的整句歌詞帶。 */
  hasStrip = false;
  sigText = '';
  tone!: Tone;
  /** 這一格舞台上大字的上下緣（疊影、分裂只作用在這裡面，歌詞帶與署名不受影響）。每一格重算。 */
  ink: { top: number; bottom: number } | null = null;

  override async init() {
    const { audio: au, lyrics, start, end } = this.ctx;
    const c = this.layer.ctx;
    const v = this.v;
    this.tone = v === 1
      ? { un: ['ink', 0.2], act: ['ink', 1], sung: ['ink', 0.94] }
      : { un: ['bone', v === 2 ? 0.26 : 0.24], act: ['signal', 1], sung: ['bone', v === 2 ? 0.9 : 0.96] };
    // 字層的貼圖不用 sRGB 格式：瀏覽器把畫布傳成 SRGB8_ALPHA8 要先讀回 CPU 轉格式，一張 1920×1080 要十幾毫秒；
    // 傳成一般的 RGBA8（預乘、跟畫布本來的格式一樣）走 GPU 直接複製，不到一毫秒。sRGB 轉線性改在 COMP 裡做
    const tx = this.layer.texture;
    tx.colorSpace = THREE.NoColorSpace;
    tx.premultiplyAlpha = true;
    const lines = lyrics.linesIn(start - 0.05, end);
    this.sigText = this.msg ? signature(this.msg.name) : '';
    this.hasStrip = !!this.msg && lines.length > 0;
    // 新出現的中文要先載字型（留言本身導演已經載好；歌詞、署名、邀請、眉標、樣張註記這裡載）
    await loadText(lines.map((l) => l.text).join('') + this.sigText + INVITE.join('') + '賓客留言新人的話就是這個思源黑體宋霞鶩文楷' + (this.msg ? this.eyebrow(this.msg) : ''));

    const items: Item[] = [];
    if (this.msg) {
      // 有留言：整個窗格的舞台都給留言（歌詞在上方的歌詞帶）
      items.push(this.planMessage(c, start, end));
    } else {
      // ---- 歌詞：一句一段
      // 兩句之間的空檔不夠打一句邀請時，上一句就留著（變淡）等下一句，不要空一個黑畫面
      const fill = 6 * au.beatPeriod(start) + 1.6;
      for (const line of lines) {
        const pieces = linePieces(line);
        if (!pieces.length) continue;
        const tIn = pieces[0]!.t0;
        if (tIn >= end - 0.25) continue;
        const next = lyrics.lines[line.i + 1];
        const nextIn = next?.words[0]?.start ?? next?.start ?? Infinity;
        // 下一句或窗格結束（先到的那個）之前的空檔太短，就一直留到那時候
        const natural = line.end + HOLD, until = Math.min(nextIn - 0.08, end);
        const tOut = until - natural < fill ? until : Math.min(natural, end);
        if (tOut <= Math.max(start, tIn) + 0.1) continue;
        const lastEnd = line.words[line.words.length - 1]!.end;
        const tAll = beatAfter(au, lastEnd + 0.04);
        items.push(this.makeItem(c, 'line', tIn, tOut, pieces, line, tAll < tOut - 0.45 ? tAll : Infinity, Infinity));
      }
      // ---- 舞台空著的時段（前後各留一點給進出場）：夠長就打一句邀請
      const busy = items.map((it) => [Math.max(start, it.tIn - 0.15), it.tOut] as const);
      const free: { a: number; b: number }[] = [];
      let cur = start;
      for (const [a, b] of busy) { if (a - cur > 0.01) free.push({ a: cur, b: a }); cur = Math.max(cur, b); }
      if (end - cur > 0.01) free.push({ a: cur, b: end });
      const hadLines = items.length > 0;
      for (const g of free) {
        if (g.b - g.a < (hadLines ? 4 : 0.5)) continue;
        items.push(this.planInvite(c, g.a, g.b));
      }
    }
    items.sort((a, b) => a.tIn - b.tIn);
    // 相鄰的段不重疊（後面的先打上來就把前面的收掉）
    for (let i = 0; i + 1 < items.length; i++) items[i]!.tOut = Math.min(items[i]!.tOut, items[i + 1]!.tIn);
    this.items = items;

    // 所有打上來的時刻（包括留言定住後小節線上的輕打）
    const sl: number[] = [];
    for (const it of items) {
      for (const p of it.pieces) if (p.t0 >= start - 0.01 && p.t0 < it.tOut) sl.push(p.t0);
      if (it.tAll < it.tOut && v !== 0 && v !== 2) sl.push(it.tAll);
      sl.push(...it.hits);
    }
    this.slams = sl.sort((a, b) => a - b);

    // 變化款 2 的梯子：每組一條，依時間排
    if (v === 2) {
      for (const it of items) it.rungs.forEach((r, k) => this.rungs.push({ slab: r, t0: it.pieces[k]!.t0, item: it }));
      this.rungs.sort((a, b) => a.t0 - b.t0);
    }
  }

  /** 排一段：大字塊、單組滿版、細字梯子都在這裡排好。 */
  private makeItem(c: CanvasRenderingContext2D, kind: Kind, tIn: number, tOut: number, pieces: Piece[], line: Line | null, tAll: number, tSig: number): Item {
    const v = this.v;
    const lyric = kind === 'line', note = kind === 'msg';
    const eastern = pieces.some((p) => isEastern(p.text));
    // 留言用典雅的聲音（思源宋體），歌詞與邀請用歌詞的聲音（Archivo／思源黑體）
    const fams = note ? [F.ming(900)] : eastern && !/[A-Za-z]/.test(pieces.map((p) => p.text).join('')) ? EASTERN : LATIN;
    const top = lyric ? (v === 1 || v === 3 ? STRIP_TOP : TOP) : note ? (this.hasStrip ? NOTE_TOP_STRIP : NOTE_TOP) : TOP + 30;
    const bottom = lyric ? BOTTOM : note ? NOTE_BOTTOM : BOTTOM - 84;
    const box = { top, bottom };
    let sbottom = bottom;
    // 留言一律靠左（右半邊給空心大字）；歌詞、邀請照原本的款式
    const align: 'left' | 'center' = v === 0 || note ? 'left' : 'center';
    const noteMax = note ? msgMaxFor(this.msg!.text) : 0;
    let slab: Slab;
    if (v === 2) {
      // 安靜款最後組成的樣子也是細的；留言還是整個畫面最大的字
      const quiet = note ? [F.ming(400)] : [F.archivo(125, 300)];
      slab = layoutSlab(c, pieces, { families: quiet, w: note ? NOTE_V2_W : LAD.w, h: Math.min(LADDER_NOTE.bottom - LADDER_NOTE.top, bottom - top), maxRows: note ? 5 : 4, maxSize: note ? noteMax : kind === 'invite' ? 88 : 96, minSize: note ? V2.msgMin : 44, align: 'left', pitch: 1.45 });
    } else {
      // 留言保留大小寫：小寫字有下伸部，行距不能用全大寫的 0.96
      const opts = { families: fams, w: note ? NOTE_V2_W : v === 0 && lyric ? V0_LYRIC_W : SW, h: bottom - top, maxRows: note ? 5 : 4, maxSize: lyric ? 470 : note ? noteMax : 400, minSize: lyric ? 60 : note ? V2.msgMin : 44, align, pitch: note ? (eastern ? 1.3 : 1.25) : undefined };
      slab = layoutSlab(c, pieces, opts);
      // 韓文歌：大字下面要放原文。先照整個舞台排一次看字級，扣掉原文要的高度再排一次（字小一點，整組還在舞台裡）
      const sub = lyric ? lyricSubOf(line) : null;
      if (sub) {
        sbottom = bottom - this.subRoom(c, sub, slab);
        slab = layoutSlab(c, pieces, { ...opts, h: sbottom - top });
      }
    }
    // 一組撐滿畫面的重擊：歌詞、邀請，與很短的留言（長留言的詞組直接打在最後的位置上）
    const bigSingles = !note || msgLen(this.msg!.text.replace(/[\p{P}\p{S}]/gu, '')) <= SHORT_SLAM;
    const singles = (v === 1 || v === 3) && bigSingles ? pieces.map((p) => layoutSlab(c, [p], { families: fams, w: SW, h: bottom - top, maxRows: 1, maxSize: note ? 260 : 620, minSize: 60, align: 'center' })) : [];
    const rungFam = note ? [F.ming(400)] : [F.archivo(125, 300)];
    const rungs = v === 2 ? pieces.map((p) => layoutSlab(c, [p], { families: rungFam, w: LAD.w, h: 90, maxRows: 1, maxSize: note ? Math.min(noteMax, 56) : 64, minSize: note ? V2.msgMin : 48, track: 0.14, align: 'left' })) : [];
    // 變化款 0 一組組打在整塊的位置上，整個舞台就用收過的；變化款 1、3 的滿版單組照舊用整個舞台（那時原文在上方的歌詞帶裡）
    const sbox = { top, bottom: sbottom };
    return { kind, tIn, tOut, pieces, slab, singles, rungs, box: v === 0 ? sbox : box, sbox, align, line, tAll, tSig, hits: [] };
  }

  // ---------------------------------------------------------------- 原文副行（韓文歌）
  /** 原文的樣式：跟大字同一個字族（韓文自動接思源黑體），顏色照這一款的墨色；字級照大字的字級換算（最多 56）。 */
  private subStyle(sl: Slab, align: 'left' | 'center', maxWidth: number): LyricStyle {
    const tn = this.tone;
    return { family: sl.family, size: sl.size, maxWidth, align, sung: rgba(tn.sung[0], tn.sung[1]), unsung: rgba(tn.un[0], tn.un[1]) };
  }
  /** 大字最後一行基線到原文最後一排下緣要的高度（舞台要扣掉這麼多）。 */
  private subRoom(c: CanvasRenderingContext2D, sub: Line, sl: Slab) {
    const lay = layoutLyric(c, sub, subStyleFor(this.subStyle(sl, 'left', V0_LYRIC_W), sl.size));
    return Math.max(0, Math.max(...sl.pieces.map((p) => p.y)) + subGap(sl.size, lay.size) + (lay.height - lay.size) + lay.size * 0.3 - sl.bottom);
  }
  /** 畫在大字塊正下方（bx, by = 整塊第一行基線的左端）：左對齊的貼左緣、置中的對齊畫面中線。 */
  private drawSub(c: CanvasRenderingContext2D, it: Item, sl: Slab, bx: number, by: number, t: number, alpha: number) {
    const sub = lyricSubOf(it.line);
    if (!sub || alpha <= 0.001) return;
    const lastBase = Math.max(...sl.pieces.map((p) => p.y));
    const x = it.align === 'left' ? bx : W / 2;
    c.save();
    c.translate(x, by + lastBase + subGap(sl.size, subStyleFor(this.subStyle(sl, it.align, V0_LYRIC_W), sl.size).size));
    drawLyricSub(c, sub, t, this.subStyle(sl, it.align, it.align === 'left' ? V0_LYRIC_W : SW), sl.size, alpha);
    c.restore();
  }

  /**
   * 留言上舞台：切成詞組、第一個拍點起一拍一組（最多兩小節，字多就一組多放幾個字）；打完下一拍組成一塊
   * （變化款 0 本來就是一塊），再下一拍署名。之後一直留到窗格結束，每個小節線輕輕再打一下。
   */
  private planMessage(c: CanvasRenderingContext2D, a: number, b: number): Item {
    const au = this.ctx.audio, m = this.msg!;
    const tA = beatAfter(au, a + 0.06);
    const beat = au.beatPeriod(tA);
    // 打完之後至少要留一段讀的時間
    const room = Math.floor((b - tA - Math.max(2.2, readSeconds(m.text) * 0.6)) / beat);
    const nMax = clamp(Math.min(8, room), 1, 8);
    let pieces: Piece[] = [];
    for (let k = 0; k < 12; k++) {
      pieces = textPieces(m.text, 4 + k, 9 + 3 * k, true);
      if (pieces.length <= nMax) break;
    }
    const bi = Math.round(au.beatAt(tA));
    const n = pieces.length;
    // 窗格很短、整則留言又一定要打完：改成半拍一組
    const step = au.timeOfBeat(bi + n + 1) > b - 0.6 ? 0.5 : 1;
    pieces.forEach((p, i) => (p.t0 = au.timeOfBeat(bi + i * step)));
    const tAll = this.v === 0 ? pieces[n - 1]!.t0 : au.timeOfBeat(bi + n * step);
    const tSig = au.timeOfBeat(bi + (n + (this.v === 0 ? 0 : 1)) * step);
    const it = this.makeItem(c, 'msg', a, b, pieces, null, Math.min(tAll, b - 0.3), Math.min(tSig, b - 0.2));
    // 定住之後：每個小節線輕輕再打一下（不要打在剛組成的那一下旁邊，也不要打在退場上）
    for (let k = Math.ceil(au.barAt(it.tAll + 0.3) - 1e-6), guard = 0; guard < 64 && au.timeOfBar(k) < b - 0.4; k++, guard++) it.hits.push(au.timeOfBar(k));
    return it;
  }

  /** 沒有留言也沒有歌詞：一拍一組打出「掃描右下角 QR code 把祝福寫上大螢幕」。 */
  private planInvite(c: CanvasRenderingContext2D, a: number, b: number): Item {
    const au = this.ctx.audio;
    const src = INVITE.join('');
    let at = 0;
    const pieces: Piece[] = INVITE.map((s, i) => {
      const p: Piece = { src, a: at, b: at + s.length, text: s.toUpperCase(), gap: i === 2 || i === 3, words: [], t0: 0 };
      at += s.length;
      return p;
    });
    const tA = beatAfter(au, a + 0.06), bi = Math.round(au.beatAt(tA));
    pieces.forEach((p, i) => (p.t0 = au.timeOfBeat(bi + i)));
    const n = pieces.length;
    const tAll = this.v === 0 ? pieces[n - 1]!.t0 : au.timeOfBeat(bi + n);
    return this.makeItem(c, 'invite', a, b, pieces, null, Math.min(tAll, b - 0.3), Math.min(au.timeOfBeat(bi + n + 1), b - 0.2));
  }

  /** 留言的眉標：編號與來源（很小，跟署名排在同一列）。 */
  private eyebrow(m: Msg) {
    return `No.${String(m.n).padStart(3, '0')}  ·  ${m.couple ? '新人的話' : '賓客留言'}`;
  }

  // ================================================================ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, v = this.v;
    const beat = au.beatPeriod(t);
    const exitDur = v === 2 ? Math.min(0.6, beat * 1.2) : Math.min(0.26, beat * 0.55);
    const ex = prog(t, e - exitDur, e, v === 2 ? ease.inOutCubic : ease.inCubic);
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    this.glow.clear();
    this.ink = null;
    const it = this.itemAt(t);
    /** 留言已經組成一塊、定住了：震動、疊影、鼓點放大都收小，讓字讀得清楚。 */
    const holding = !!it && it.kind === 'msg' && t >= it.tAll;
    const E = 0.65 + 0.6 * this.energy;

    // ---- 舞台
    let head: P2 | null = null;
    const cy = (TOP + BOTTOM) / 2;
    c.save();
    if (ex > 0 && (v === 0 || v === 3)) {
      // 退場：整個舞台壓扁成一條線（下一個版面在小節線上切進來）
      c.translate(0, cy); c.scale(1, Math.max(0.006, 1 - ex)); c.translate(0, -cy);
    }
    if (it && it.kind === 'msg') this.drawGhost(c, t, it);
    if (v === 2) head = this.drawLadder(c, t);
    else if (it) head = it.kind === 'line' ? this.drawLine(c, it, t) : this.drawNote(c, it, t);
    c.restore();
    if (ex > 0 && (v === 0 || v === 3)) {
      c.fillStyle = rgba('signal', Math.min(1, ex * 1.6) * (1 - 0.5 * ex));
      c.fillRect(X0 - 40, cy - 1, SW + 80, 2);
    }

    // ---- 歌詞帶：有留言時（每個款）、或變化款 1、3 唱歌詞時（大字一次只有一組，整句在這裡讀得到）
    c.save();
    c.globalAlpha = (1 - (v === 2 ? 0 : ex)) * prog(t, s, s + Math.min(0.3, beat * 0.6));
    if (this.hasStrip) this.drawLyricStrip(c, t);
    else if (it && it.kind === 'line' && (v === 1 || v === 3)) this.drawStrip(c, it, t);
    c.restore();

    // ---- 合成
    const u = this.comp.u;
    u.tex!.value = L.upload();
    u.t!.value = t;
    const bgA: PaletteKey = v === 1 ? 'signal' : 'ink';
    (u.bgA!.value as THREE.Vector3).set(...LIN[bgA]);
    (u.bgB!.value as THREE.Vector3).set(...(v === 1 ? LIN.ember : LIN.ink2));
    // 底紋很淡：背景要能呼吸
    u.texAmt!.value = v === 1 ? 0.1 : v === 2 ? 0.3 : 0.45;
    u.hot!.value = v === 1 ? 0 : v === 2 ? 0.5 : 0.55;
    const last = this.lastSlam(t);
    const box = it?.box ?? { top: TOP, bottom: BOTTOM };
    const ink = this.ink ?? box;
    (u.stage!.value as THREE.Vector4).set(0, 1 - (ink.bottom + 24) / H, 1, 1 - (ink.top - 24) / H);
    u.echo!.value = 0; u.split!.value = 0; u.pulseK!.value = 0; u.lid!.value = 0;
    (u.pulseCol!.value as THREE.Vector3).set(...LIN.blood);
    if (v === 3) {
      // 打上來的那一下：疊影從字的中心往外擴散、字分裂，很快衰減。唱歌詞時拿著不放的字每一拍重打一次；
      // 定住的留言不再重打，只在小節線的輕打上留一點點疊影
      // 真的打上來（新的一組）是全力，每拍的重打只有一半，背景才有喘息的時候
      const rt = holding ? last : this.retrig(t);
      const age = t - rt, real = rt === last;
      u.echo!.value = Math.exp(-age / 0.3) * (0.55 + 0.45 * pulse(t, last, 0.2)) * (holding ? 0.1 : real ? 1 : 0.5);
      u.spread!.value = 0.05 * (1 + age * 3.2);
      (u.echoC!.value as THREE.Vector2).set(0.5, 1 - (box.top + box.bottom) / 2 / H);
      u.split!.value = holding ? 0 : (real ? 50 : 20) * pulse(t, rt, 0.06) * (1 - ex);
      u.splitSeed!.value = Math.floor(f.beat * 2) + (this.seed % 97);
      u.pulseK!.value = 0.16 * pulse(t, last, 0.07) * (holding ? 0.25 : 1);
    }
    if (v === 1) u.lid!.value = ex;
    this.comp.render(renderer, out);

    // ---- 火花
    if (head && ex < 0.3) {
      const hd = head;
      sparkParticles(this.glow, t, (tb) => this.headAbs(tb) ?? (tb > t - 0.02 ? hd : null), { rate: v === 3 ? 150 : v === 2 ? 50 : 100, life: v === 2 ? 0.3 : 0.4, speed: v === 2 ? 120 : 230, seed: this.seed });
      sparkHead(this.glow, hd.x, hd.y, t, v === 2 ? 0.55 : 0.95);
    }
    if (this.glow.count) this.glow.render(renderer, out);

    // ---- 後製：大鼓輕微放大、小鼓閃一下（很小）、打上來時震一下；定住的留言都收小
    const o: PostOverrides = { bloom: 0.7, vignette: 0.42 };
    const kick = f.a.kick, snare = f.a.snare;
    const hk = holding ? 0.35 : 1;
    let shake = 0;
    if (v === 0) { o.zoom = 1 + 0.012 * kick * E * hk; o.flash = 0.03 * snare * E * hk; shake = 5 * pulse(t, last, 0.05) * E * hk; }
    if (v === 1) { o.zoom = 1 + 0.016 * kick * E * hk; shake = 8 * pulse(t, last, 0.05) * E * hk; o.paper = 1; o.bloomThreshold = 1.4; o.vignette = 0.5; o.grain = 0.05; }
    if (v === 2) { o.vignette = 0.62; o.grain = 0.065; o.ca = 0.6; o.bloom = 0.6; }
    if (v === 3) { o.zoom = 1 + 0.02 * kick * E * hk; o.flash = 0.04 * snare * E * hk; shake = (holding ? 3 * pulse(t, last, 0.05) : 2 + 12 * pulse(t, last, 0.06)) * E; o.ca = holding ? 1.2 : 2.2; o.bloom = 0.8; }
    shake *= 1 - ex;
    if (shake > 0.05) o.shake = [noise1(t * 60, 1) * shake, noise1(t * 60, 2) * shake];
    if (v === 2) o.fade = ex;
    return o;
  }

  // ---------------------------------------------------------------- 時間
  private itemAt(t: number): Item | null {
    for (const it of this.items) if (t >= Math.max(it.tIn - 0.12, this.ctx.start) && t < it.tOut) return it;
    return null;
  }
  private lastSlam(t: number) {
    let r = -Infinity;
    for (const x of this.slams) { if (x <= t) r = x; else break; }
    return r;
  }
  /** 變化款 3：拿著不放的字每一拍重打一次（照 pdoom hook 4 的「一直重複」）。 */
  private retrig(t: number) {
    const last = this.lastSlam(t);
    const au = this.ctx.audio;
    const bt = au.timeOfBeat(Math.floor(au.beatAt(t) + 1e-4));
    return bt > last + 0.12 ? bt : last;
  }

  /** 大字塊放進舞台：回傳第一行基線的左端。 */
  private place(sl: Slab, box: Box, align: 'left' | 'center', left = X0) {
    const h = sl.bottom - sl.top;
    const y = box.top + (box.bottom - box.top - h) / 2 - sl.top;
    const x = align === 'left' ? left : W / 2 - sl.width / 2;
    return { x, y };
  }

  /**
   * 打上來的「重量」：一下子大一點再落定；一次只有一組時，拿著的字慢慢往鏡頭靠（pdoom 的 slam）。
   * 疊成一塊的（變化款 0）不能各自靠近鏡頭：先打的組會越長越大、撞到旁邊的組。
   */
  private punch(t: number, t0: number, amt = 0.13, creep = 0.012) {
    const k = clamp((t - t0) / 0.2);
    return (1 + amt * (1 - ease.outExpo(k))) * (1 + creep * Math.min(4, Math.max(0, t - t0)));
  }

  /**
   * 定住的留言的鏡頭：很慢地往前推（整段約 4.5%）、輕輕往左上漂，小節線上再輕輕打一下。
   * 推近以字塊為中心（變化款 0 以左緣為準，左邊的留白不會被吃掉）。
   */
  private noteCam(it: Item, t: number) {
    if (it.kind !== 'msg' || t < it.tAll) return { sc: 1, dx: 0, dy: 0 };
    const p = prog(t, it.tAll, it.tOut);
    let hit = -Infinity;
    for (const h of it.hits) { if (h <= t) hit = h; else break; }
    const bump = 0.018 * (1 - ease.outExpo(clamp((t - hit) / 0.28)));
    return { sc: (1 + 0.045 * p) * (1 + bump), dx: (this.v === 0 ? 6 : -10) * p, dy: -8 * p };
  }

  /** 一段的進出場：進來是打上來的，退場在最後一兩百毫秒往上收、淡掉。 */
  private itemExit(it: Item, t: number) {
    const d = clamp((it.tOut - it.tIn) * 0.12, 0.1, 0.26);
    return prog(t, it.tOut - d, it.tOut, ease.inCubic);
  }

  // ---------------------------------------------------------------- 歌詞
  private drawLine(c: CanvasRenderingContext2D, it: Item, t: number): P2 | null {
    const v = this.v;
    const x = this.itemExit(it, t);
    // 唱完很久還留著（在等下一句）：退成淡淡的一層，像印壞的樣張留在台上
    const idle = prog(t, it.line!.end + HOLD, it.line!.end + HOLD + 0.8, ease.inOutCubic);
    c.save();
    c.globalAlpha *= (1 - x) * (1 - 0.7 * idle);
    c.translate(0, -40 * x);
    let head: P2 | null = null;
    if (v === 0) head = this.drawBuild(c, it, it.slab, t);
    else if (t < it.tAll) head = this.drawSingle(c, it, t);
    else this.drawWhole(c, it, t);
    c.restore();
    return x > 0.3 ? null : head;
  }

  /** 變化款 0：詞組一組組打在最後的位置上，疊成一整塊；火花沿著基線跟唱。 */
  private drawBuild(c: CanvasRenderingContext2D, it: Item, sl: Slab, t: number): P2 | null {
    const { x: bx, y: by } = this.place(sl, it.box, it.align);
    this.guides(c, sl, bx, by, t, prog(t, it.tIn - 0.12, it.tIn + 0.2, ease.outExpo));
    c.font = font(sl.family, sl.size);
    let head: P2 | null = null;
    sl.pieces.forEach((pl, i) => {
      const p = it.pieces[i]!;
      if (t < p.t0) return;
      const sc = this.punch(t, p.t0, 0.13, 0);
      const px = bx + pl.x, py = by + pl.y;
      const cx = px + pl.w / 2, cyy = py - sl.size * 0.36;
      c.save();
      c.translate(cx, cyy); c.scale(sc, sc); c.translate(-cx, -cyy);
      c.translate(px, py);
      const heat = p.words.length ? 0 : 1 - clamp((t - p.t0) / 0.7);
      const h = drawCells(c, pl.cells, sl.size, t, this.tone, heat);
      c.restore();
      if (h) {
        head = { x: px + h.x, y: py + sl.size * 0.1 };
        // 基線上的引信：從這組左緣燒到正在唱的地方
        c.fillStyle = rgba('signal', 0.9);
        c.fillRect(px, py + sl.size * 0.1 - 1, h.x, 2);
      }
    });
    // 原文（韓文歌）：第一組打上來時一起出現在整塊的正下方，逐字跟著原文自己的時間亮
    if (it.kind === 'line') this.drawSub(c, it, sl, bx, by, t, prog(t, it.tIn - 0.12, it.tIn + 0.2, ease.outExpo));
    return head;
  }

  /** 變化款 1、3：一次一組、撐滿舞台。`stage`：很短的留言重擊時用整個舞台（組成一塊之後才回到左邊的留言區）。 */
  private drawSingle(c: CanvasRenderingContext2D, it: Item, t: number, stage?: Box): P2 | null {
    let idx = -1;
    it.pieces.forEach((p, i) => { if (t >= p.t0) idx = i; });
    if (idx < 0) return null;
    const p = it.pieces[idx]!, sl = it.singles[idx]!;
    const { x: bx, y: by } = this.place(sl, stage ?? it.box, 'center');
    this.guides(c, sl, bx, by, t, 1);
    const t0 = this.v === 3 ? this.retrig(t) : p.t0;
    const sc = this.punch(t, t0, this.v === 3 ? (t0 === p.t0 ? 0.26 : 0.1) : 0.14);
    const cx = W / 2, cyy = by + (sl.top + sl.bottom) / 2;
    c.save();
    c.translate(cx, cyy); c.scale(sc, sc); c.translate(-cx, -cyy);
    c.translate(bx, by);
    c.font = font(sl.family, sl.size);
    const pl = sl.pieces[0]!;
    const heat = p.words.length ? 0 : 1 - clamp((t - p.t0) / 0.7);
    const h = drawCells(c, pl.cells, sl.size, t, this.tone, heat);
    c.restore();
    if (h && this.v === 3) return { x: bx + pl.x + h.x, y: by + sl.size * 0.1 };
    return null;
  }

  /** 唱完（或打完）組成一整塊。`creep`：拿著的字慢慢往鏡頭靠（留言另外有鏡頭在推，這裡給 0）。 */
  private drawWhole(c: CanvasRenderingContext2D, it: Item, t: number, creep = 0.005): void {
    const sl = it.slab;
    const { x: bx, y: by } = this.place(sl, it.sbox, it.align);
    // 原文（韓文歌）：組成整塊時，上方歌詞帶（帶著原文）收掉，原文改到整塊正下方（不跟著大字放大，比較安靜）
    if (it.kind === 'line') this.drawSub(c, it, sl, bx, by, t, prog(t, it.tAll, it.tAll + 0.3));
    this.guides(c, sl, bx, by, t, 1);
    const sc = this.punch(t, it.tAll, this.v === 2 ? 0 : 0.1, creep);
    const cx = bx + sl.width / 2, cyy = by + (sl.top + sl.bottom) / 2;
    c.save();
    c.translate(cx, cyy); c.scale(sc, sc); c.translate(-cx, -cyy);
    c.font = font(sl.family, sl.size);
    for (const pl of sl.pieces) {
      c.save();
      c.translate(bx + pl.x, by + pl.y);
      drawCells(c, pl.cells, sl.size, t, this.tone);
      c.restore();
    }
    c.restore();
  }

  // ---------------------------------------------------------------- 留言、邀請
  private drawNote(c: CanvasRenderingContext2D, it: Item, t: number): P2 | null {
    const v = this.v;
    const x = this.itemExit(it, t);
    const sl = it.slab;
    const { x: bx, y: by } = this.place(sl, it.box, it.align);
    c.save();
    c.globalAlpha *= 1 - x;
    c.translate(0, -40 * x);
    // 定住之後的鏡頭（字塊、署名一起動：它們是同一個東西）
    const cam = this.noteCam(it, t);
    if (cam.sc !== 1 || cam.dx || cam.dy) {
      const ax = it.align === 'left' ? bx : bx + sl.width / 2, ay = by + (sl.top + sl.bottom) / 2;
      c.translate(ax + cam.dx, ay + cam.dy); c.scale(cam.sc, cam.sc); c.translate(-ax, -ay);
    }
    const whole = v === 0 || t >= it.tAll;
    if (whole) {
      if (v === 0) this.drawBuild(c, it, sl, t);
      else this.drawWhole(c, it, t, 0);
    } else if (it.singles.length) this.drawSingle(c, it, t, { top: TOP, bottom: BOTTOM });
    else this.drawBuild(c, it, sl, t);
    let head: P2 | null = null;
    // 署名（或邀請的指引）：打完之後的下一拍，火花在下面劃一條線
    if (t >= it.tSig) {
      const ks = prog(t, it.tSig, it.tSig + 0.35, ease.outExpo);
      const lineK = prog(t, it.tSig, it.tSig + this.ctx.audio.beatPeriod(it.tSig) * 0.9, ease.inOutCubic);
      if (it.kind === 'invite') head = this.drawArrow(c, by, sl, ks, lineK, v === 1 ? 'ink' : 'bone');
      else {
        const size = sigV2(sl.size);
        const y = Math.min(by + sl.bottom + size * 1.6, SIG_MAX_Y);
        head = this.drawSigRow(c, bx, y, sl.width, size, F.hand(700), ks, lineK);
      }
    }
    c.restore();
    return x > 0.3 ? null : head;
  }

  /**
   * 署名那一列：右邊是署名（手寫字，一條訊號色的細線由火花劃出來），左邊是很小的 mono 眉標（編號、賓客或新人）。
   * 回傳火花的位置（畫面座標），細線畫完就是 null。
   */
  private drawSigRow(c: CanvasRenderingContext2D, bx: number, y: number, blockW: number, size: number, fam: string, ks: number, lineK: number): P2 | null {
    const v = this.v, m = this.msg;
    if (!m) return null;
    const eb = this.eyebrow(m);
    c.save();
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    const ebW = c.measureText(eb).width;
    c.globalAlpha *= ks;
    c.fillStyle = rgba(v === 1 ? 'ink' : 'signal', v === 1 ? 0.6 : 0.7);
    c.fillText(eb, bx, y - size * 0.08);
    c.letterSpacing = '0px';
    c.font = font(fam, size);
    const w = c.measureText(this.sigText).width;
    const sx = Math.max(bx + blockW - w, bx + ebW + 48);
    c.fillStyle = rgba(v === 1 ? 'ink' : 'bone', v === 2 ? 0.85 : 0.92);
    c.fillText(this.sigText, sx, y + (1 - ks) * 14);
    c.restore();
    const lx1 = sx + w * lineK;
    c.fillStyle = rgba(v === 1 ? 'ink' : 'signal', v === 1 ? 0.6 : 0.85);
    c.fillRect(sx, y + size * 0.28, lx1 - sx, 2);
    return lineK > 0 && lineK < 1 && v !== 1 ? toScreen(c, { x: lx1, y: y + size * 0.28 }) : null;
  }

  /**
   * 邀請的指引：火花從字塊下方往下畫一條細線，直直指到右下角 QR code 的正上方（停在 HUD 區外），
   * 旁邊一句冷面的說明。QR 的中心照 hud.ts 的位置（右邊界往內 52 + 176 / 2）。
   */
  private drawArrow(c: CanvasRenderingContext2D, by: number, sl: Slab, ks: number, k: number, ink: PaletteKey): P2 | null {
    const x = W - 140, y0 = Math.min(by + sl.bottom + 40, 700), y1 = 814;
    const ye = lerp(y0, y1, k);
    const col = this.v === 1 ? 'ink' : 'signal';
    c.fillStyle = rgba(ink, 0.8);
    c.fillRect(x - 0.75, y0, 1.5, ye - y0);
    if (k >= 1) {
      c.strokeStyle = rgba(ink, 0.8);
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x - 11, y1 - 13); c.lineTo(x, y1); c.lineTo(x + 11, y1 - 13); c.stroke();
    }
    c.save();
    c.globalAlpha *= ks;
    c.font = font(F.hei(500), 22);
    c.letterSpacing = '4px';
    c.textAlign = 'right';
    c.fillStyle = rgba(col, 0.95);
    c.fillText('就是這個', x - 24, y1 - 4);
    c.restore();
    return k > 0 && k < 1 && this.v !== 1 ? toScreen(c, { x, y: ye }) : null;
  }

  // ---------------------------------------------------------------- 變化款 2：細字梯子
  private drawLadder(c: CanvasRenderingContext2D, t: number): P2 | null {
    const lx = LAD.x, cy = LAD.cy, gap = LAD.gap;
    const it = this.itemAt(t);
    // 整疊以左緣為軸慢慢轉（一個窗格轉兩度左右）、慢慢推近。推近在這裡做而不是用後製的 zoom：後製會把上方的歌詞帶一起推出安全框
    const p = this.ctxP(t);
    const ang = lerp(-0.02, 0.02, p), sc = 1 + 0.045 * ease.inOutCubic(p);
    c.save();
    c.translate(lx, cy); c.rotate(ang); c.scale(sc, sc); c.translate(-lx, -cy);
    // 地平線：一條橫過整個畫面的細線，在正在唱的這一條的基線上。大量的黑裡唯一的「儀器」，也讓慢慢的轉看得出來。
    // 留言組成一塊時地平線讓開（不然會從字中間穿過去）
    const note = it && it.kind !== 'line' && t >= it.tAll ? prog(t, it.tAll, it.tAll + 0.5) : 0;
    this.horizon(c, cy, t, 1 - note);
    const shown = this.rungs.filter((r) => r.t0 <= t && t < r.item.tOut && !(r.item.kind !== 'line' && t >= r.item.tAll));
    let head: P2 | null = null;
    const n = shown.length;
    // 上方有歌詞帶時，往上爬的舊條到這裡就不畫（不要爬進歌詞帶）
    const yMin = this.hasStrip ? 300 : 120;
    for (let i = Math.max(0, n - 7); i < n; i++) {
      const r = shown[i]!;
      let slot = 0;
      for (let j = i + 1; j < n; j++) slot += ease.outExpo(clamp((t - shown[j]!.t0) / 0.4)) * (shown[j]!.item === r.item ? 1 : 1.6);
      const since = t - r.t0;
      const rise = (1 - ease.outExpo(clamp(since / 0.4))) * gap * 0.6;
      const y = cy - slot * gap + rise - since * 6;
      const same = it && r.item === it;
      const a = slot < 0.02 ? 1 : same ? Math.pow(0.66, slot) : 0.2 / (1 + slot);
      if (a < 0.02 || y < yMin) continue;
      const sl = r.slab, pl = sl.pieces[0]!;
      c.save();
      c.globalAlpha *= a * prog(since, 0, 0.12) * clamp((y - yMin) / 60);
      c.translate(lx + pl.x, y);
      c.font = font(sl.family, sl.size);
      c.letterSpacing = `${sl.tracking}px`;
      const heat = r.item.kind === 'line' ? 0 : 1 - clamp(since / 0.9);
      const h = drawCells(c, pl.cells, sl.size, t, this.tone, heat);
      c.letterSpacing = '0px';
      // 正在唱的這一條：下面一條細線跟著走
      if (slot < 0.02 && r.item.kind === 'line') {
        const prog1 = h ? h.x : pl.cells.every((cl) => cl.word && t >= cl.word.end) ? pl.w : 0;
        c.fillStyle = rgba('signal', 0.8);
        c.fillRect(0, sl.size * 0.3, prog1, 1.2);
        if (h) head = toScreen(c, { x: h.x, y: sl.size * 0.3 });
      }
      c.restore();
    }
    // 原文（韓文歌）：正在唱的這一句的原文，小一號放在地平線（正在唱的那一條）下面。新的一條是從下面 0.6 格升上來的，
    // 原文放在它起跳的位置再下面一點，升上來的那一下才不會從原文身上穿過去
    if (it && it.kind === 'line' && it.rungs.length) {
      const sub = lyricSubOf(it.line);
      const rs = it.rungs[0]!;
      if (sub) {
        const st: LyricStyle = { family: rs.family, size: rs.size, maxWidth: LAD.w, align: 'left', sung: rgba(this.tone.sung[0], this.tone.sung[1]), unsung: rgba(this.tone.un[0], this.tone.un[1]) };
        const ss = subStyleFor(st, rs.size).size;
        c.save();
        c.translate(lx, cy + Math.max(subGap(rs.size, ss), gap * 0.6 + rs.size * 0.3 + ss * 0.85));
        drawLyricSub(c, sub, t, st, rs.size, prog(t, it.tIn - 0.12, it.tIn + 0.2) * (1 - this.itemExit(it, t)));
        c.restore();
      }
    }
    // 留言、邀請打完之後：組成一小塊，安靜地放在梯子的位置（留言定住後鏡頭一樣慢慢推、小節線輕打）
    if (it && it.kind !== 'line' && t >= it.tAll) {
      const sl = it.slab;
      const k = prog(t, it.tAll, it.tAll + 0.6, ease.outCubic) * (1 - this.itemExit(it, t));
      const { x: bx, y: by } = this.place(sl, LADDER_NOTE, 'left', lx);
      c.save();
      c.globalAlpha *= k;
      c.translate(0, (1 - k) * 16);
      const cam = this.noteCam(it, t);
      const ay = by + (sl.top + sl.bottom) / 2;
      c.translate(bx + cam.dx * 0.5, ay + cam.dy * 0.5); c.scale(cam.sc, cam.sc); c.translate(-bx, -ay);
      c.font = font(sl.family, sl.size);
      sl.pieces.forEach((pl) => { c.save(); c.translate(bx + pl.x, by + pl.y); drawCells(c, pl.cells, sl.size, t, this.tone, 0); c.restore(); });
      if (it.kind === 'msg' && t >= it.tSig) {
        const ks = prog(t, it.tSig, it.tSig + 0.5);
        const lineK = prog(t, it.tSig, it.tSig + this.ctx.audio.beatPeriod(it.tSig) * 0.9, ease.inOutCubic);
        head = this.drawSigRow(c, bx, Math.min(by + sl.bottom + sigV2(sl.size) * 1.7, SIG_MAX_Y - 20), sl.width, sigV2(sl.size), F.hand(400), ks, lineK) ?? head;
      }
      c.restore();
    }
    c.restore();
    if (it && it.kind === 'invite' && t >= it.tSig) {
      const au = this.ctx.audio;
      const { y: by } = this.place(it.slab, LADDER_NOTE, 'left', lx);
      const k = prog(t, it.tSig, it.tSig + au.beatPeriod(it.tSig) * 1.5, ease.inOutCubic);
      c.save();
      c.globalAlpha *= 1 - this.itemExit(it, t);
      head = this.drawArrow(c, by, it.slab, prog(t, it.tSig, it.tSig + 0.5), k, 'bone') ?? head;
      c.restore();
    }
    return head;
  }

  private ctxP(t: number) { return clamp((t - this.ctx.start) / Math.max(0.5, this.ctx.end - this.ctx.start)); }

  /** 地平線：兩端淡出的細線，大鼓一打亮一點。 */
  private horizon(c: CanvasRenderingContext2D, y: number, t: number, a = 1) {
    if (a <= 0.001) return;
    const k = (0.07 + 0.08 * this.ctx.audio.hit('kick', t, 0.12)) * a;
    const g = c.createLinearGradient(-200, 0, W + 200, 0);
    g.addColorStop(0, rgba('bone', 0));
    g.addColorStop(0.3, rgba('bone', k));
    g.addColorStop(0.7, rgba('bone', k));
    g.addColorStop(1, rgba('bone', 0));
    c.fillStyle = g;
    c.fillRect(-200, y + 19, W + 400, 1);
  }

  // ---------------------------------------------------------------- 右半邊的空心大字
  /**
   * 有留言時右半邊的紋理：正在唱的那個詞（純音樂時是新人的名字，一拍一個）變成巨大的空心字——很細的描邊、很淡，
   * 唱到（打到）的那一刻大一點、亮一點（訊號色）砸下來，再慢慢淡掉、往後退。只在留言定住之後才明顯（打留言的時候讓位）。
   */
  private drawGhost(c: CanvasRenderingContext2D, t: number, it: Item) {
    const au = this.ctx.audio, v = this.v;
    let word = '', t0 = -Infinity;
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) {
      for (const w of ly.line.words) { if (w.start <= t + 0.02 && w.w.trim()) { word = w.w; t0 = w.start; } }
    } else if (!this.hasStrip) {
      // 純音樂：一拍一個（一位新人、&、另一位輪流；有英文名用英文名，砸起來比較有海報的力道）
      const bi = Math.floor(au.beatAt(t) + 1e-4);
      word = GHOST_NAMES[((bi % GHOST_NAMES.length) + GHOST_NAMES.length) % GHOST_NAMES.length]!;
      t0 = au.timeOfBeat(bi);
    }
    if (!word) return;
    const age = t - t0;
    const k = clamp(1 - age / 1.6) * prog(t, it.tAll - 0.3, it.tAll + 0.6);
    if (k <= 0.01) return;
    const txt = /[A-Za-z]/.test(word) ? word.toUpperCase() : word;
    const fam = F.archivo(100, 900);
    const gw = GHOST.x1 - GHOST.x0, gh = GHOST.y1 - GHOST.y0;
    c.save();
    c.font = font(fam, 100);
    const w100 = Math.max(1, c.measureText(txt).width);
    const size = Math.min(gh * 0.78, (gw * 0.95 * 100) / w100);
    const punch = 1 + 0.12 * (1 - ease.outExpo(clamp(age / 0.25))) - 0.05 * clamp(age / 1.6);
    const cx = (GHOST.x0 + GHOST.x1) / 2, cy = (GHOST.y0 + GHOST.y1) / 2;
    c.translate(cx, cy); c.scale(punch, punch);
    c.font = font(fam, size);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // 很淡的實心字（描邊會把字型裡重疊的筆畫輪廓都畫出來，看起來像壞掉）：砸下來那一下是訊號色，再退成底色上的一層薄紗
    const hot = Math.exp(-age / 0.18);
    const ink: PaletteKey = v === 1 ? 'ink' : 'bone';
    // 合成是線性光的混色：很低的透明度看起來就已經夠亮了（0.02 ≈ 很淡的一層灰）
    c.fillStyle = hot > 0.05 && v !== 1 ? mixRgba(ink, 'signal', hot, (0.02 + 0.03 * hot) * k) : rgba(ink, (v === 1 ? 0.06 : 0.02) * k);
    c.fillText(txt, 0, 0);
    c.restore();
  }

  // ---------------------------------------------------------------- 樣張的細線
  /**
   * 每一行的基線與字面頂端：全寬的細線（很淡，像試印張上的刻線），字塊右上角一個小小的 mono 註記
   * （字族與字級，pdoom hook 的 type-specimen guides）。
   */
  private guides(c: CanvasRenderingContext2D, sl: Slab, bx: number, by: number, t: number, k: number) {
    this.ink = { top: by + sl.top, bottom: by + sl.bottom };
    if (k <= 0) return;
    const v = this.v;
    const ink: PaletteKey = v === 1 ? 'ink' : 'bone';
    const a = (v === 1 ? 0.12 : 0.055) + 0.035 * this.ctx.audio.hit('kick', t, 0.12);
    c.save();
    const w = W * ease.outExpo(k);
    const x0 = W / 2 - w / 2;
    c.fillStyle = rgba(ink, a);
    for (const r of sl.rows) {
      c.fillRect(x0, Math.round(by + r.y), w, 1);
      c.fillRect(x0, Math.round(by + r.y - r.asc), w, 1);
    }
    // 最滿的款（3）不放註記：疊影會把小字放大成一片糊
    if (v !== 3) {
      const r0 = sl.rows[0]!;
      c.font = font(F.mono(400), 13);
      c.letterSpacing = '1.5px';
      c.fillStyle = rgba(ink, v === 1 ? 0.4 : 0.3);
      // 貼著字塊的右緣（不是舞台右緣）：留言定住後鏡頭會往前推，貼著舞台邊的小字會被推出安全框
      c.textAlign = 'right';
      c.fillText(`${familyName(sl)} · ${Math.round(sl.size)} px`, Math.min(X1, bx + sl.width), Math.round(by + r0.y - r0.asc) - 10);
      c.textAlign = 'left';
      c.letterSpacing = '0px';
    }
    c.restore();
  }

  // ---------------------------------------------------------------- 歌詞帶
  /** 上方整句歌詞的樣式：明顯比舞台上的大字小一級（仍 ≥ 48 px）；安靜款用細的。 */
  private stripStyle(): LyricStyle {
    // v2：40～52，有留言時比留言小
    const note = this.items.find((x) => x.kind === 'msg');
    const base = { size: lyricV2(note ? note.slab.size : null), minSize: V2.lyrMin, maxWidth: STRIP_W };
    if (this.v === 1) return { ...base, family: F.archivo(100, 700), active: rgba('ink'), sung: rgba('ink', 0.92), unsung: rgba('ink', 0.3) };
    if (this.v === 2) return { ...base, size: Math.min(base.size, 48), family: F.archivo(125, 300), sung: rgba('bone', 0.85), unsung: rgba('bone', 0.22) };
    return { ...base, family: F.archivo(100, 700) };
  }

  /** 變化款 1、3 唱歌詞時：上方的整句歌詞（大字一次只有一組，整句在這裡讀得到），跟著這一段進出。 */
  private drawStrip(c: CanvasRenderingContext2D, it: Item, t: number) {
    const line = it.line!;
    const st = this.stripStyle();
    const lay = layoutLyric(c, line, st);
    // 唱完組成一整塊之後，舞台上就是整句了：歌詞帶收掉（同一句不要同時出現兩次）
    const k = prog(t, it.tIn - 0.3, it.tIn, ease.outCubic) * (1 - this.itemExit(it, t)) * (1 - prog(t, it.tAll, it.tAll + 0.3));
    if (k <= 0.001) return;
    c.save();
    c.translate(X0, STRIP_Y);
    drawLyric(c, line, t, st, lay, k);
    c.restore();
  }

  /** 有留言時：上方的歌詞帶照一般的跟唱規則（提早淡入、唱完停一下再淡出）。 */
  private drawLyricStrip(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    if (!ly) return;
    const st = this.stripStyle();
    c.save();
    c.translate(X0, STRIP_Y);
    drawLyric(c, ly.line, t, st, layoutLyric(c, ly.line, st), ly.k);
    c.restore();
  }

  // ---------------------------------------------------------------- 火花
  /** tb 時的筆尖（絕對座標）：粒子回推出生位置用，所以要能算過去任何時刻。 */
  private headAbs(tb: number): P2 | null {
    const it = this.itemAt(tb);
    if (!it) return null;
    const v = this.v;
    if (it.kind === 'line') {
      if (v === 0) {
        const { x: bx, y: by } = this.place(it.slab, it.box, it.align);
        for (const pl of it.slab.pieces) {
          const h = headAt(pl.cells, tb);
          if (h) return { x: bx + pl.x + h.x, y: by + pl.y + it.slab.size * 0.1 };
        }
        return null;
      }
      if (v === 3 && tb < it.tAll) {
        let idx = -1;
        it.pieces.forEach((p, i) => { if (tb >= p.t0) idx = i; });
        if (idx < 0) return null;
        const sl = it.singles[idx]!, pl = sl.pieces[0]!;
        const h = headAt(pl.cells, tb);
        if (!h) return null;
        const { x: bx, y: by } = this.place(sl, it.box, 'center');
        return { x: bx + pl.x + h.x, y: by + sl.size * 0.1 };
      }
    }
    // 其他情況（安靜款的梯子會一直移動、署名的底線很短）不回推：粒子只從筆尖現在的位置冒，稀稀的剛好
    return null;
  }
}
