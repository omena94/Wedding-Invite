// 大字重擊（照 pdoom 的 hook：一個字一下，滿版 Archivo 900 正好打在唱到的那一刻）。副歌、快歌用。
// 歌詞切成「一拍一組」的詞組（slam-type.ts），每組在它第一個字開始唱的那一刻打上來，組裡的字照跟唱規則逐字亮起，
// 唱完的字從訊號色冷卻成紙白。旁邊是字體樣張的細線與 mono 註記（基線、字面高度），像印刷廠的試印張。
// 四種變化款（params.variant）：
//   0 乾淨：紙白字在底色上。一句歌詞的詞組一組組打在最後的位置上，疊成一整塊（pdoom 的「文字壓力」）；火花沿著基線跟唱。
//   1 更重：底色字在滿版訊號色上，一次只有一組、撐滿畫面；唱完整句在下一拍組成一塊。退場時眼皮闔上成一條發光的縫。
//   2 安靜：極細的字、很小、大量的黑；新的一組從下面升上來，舊的往上爬、變淡，整疊慢慢轉。
//   3 最滿：一組撐滿畫面，每一拍重打一次；疊影往外擴散、字一直分裂、輕微震動。
// 沒有歌詞（間奏）時把主打留言拆成詞組一拍一個打出來，組成一整塊後署名；有歌詞時留言停在左下角（小一點，但讀得完），
// 中間有夠長的空檔就回到舞台上。沒有留言又沒有歌詞：打出一句邀請（掃描右下角 QR code）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { clamp, ease, lerp, noise1, prog, pulse } from '../engine/util';
import { readSeconds, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { sparkHead, sparkParticles, drawLyric, layoutLyric, layoutMessage, signature, beatAfter, type LyricStyle } from './_motifs';
import { layoutSlab, linePieces, textPieces, drawCells, headAt, fillRich, isEastern, type Piece, type Slab, type Tone } from './slam-type';

/** 舞台左右（離邊 120：規定 96，投影機裁邊再多留一點）。 */
const X0 = 120, X1 = 1800, SW = X1 - X0;
/**
 * 變化款 0 的歌詞塊最右到 1370：靠左的大字配右邊一整欄空白（不對稱的版面），
 * 那一欄正好是即時小卡右側的格子（x ≥ 1378），賓客的新留言跳出來不會蓋到歌詞。
 */
const V0_LYRIC_W = 1370 - X0;
/** 上方 mono 註記的基線、舞台頂、舞台底（右下角 HUD 從 y = 830 開始，字的最低點要在它上面）。 */
const HEAD_Y = 112, TOP = 184, BOTTOM = 780;
/** 變化款 1、3 在上方放整句歌詞（小字、照跟唱規則），舞台從它下面開始。 */
const STRIP_Y = 176, STRIP_TOP = 240, STRIP_W = 580;
/** 一句唱完後大字留多久（下一句先開始就提早收）。 */
const HOLD = 1.3;
/** 左下角留言區的最大寬度（短留言會收窄，把下方正中留給即時小卡）。 */
const DOCK_W = 1100;
/**
 * 變化款 2（安靜款）的梯子靠左：左緣、最大寬度、中線高度、每一條的間距。
 * 靠左而不置中：瑞士網格的不對稱，也把右邊一整欄（x ≥ 1378，即時小卡的格子）空出來。
 */
const LAD = { x: 300, w: 1040, cy: H / 2 + 30, gap: 92 };
/** 安靜款的留言組成一塊時放的範圍（跟梯子同一個左緣）。 */
const LADDER_NOTE = { top: LAD.cy - 200, bottom: LAD.cy + 140 };
/** 拉丁字的寬度候選：一般寬度優先，放不下才用窄的（pdoom 的 hook 也是一個字一種寬度）。 */
const LATIN = [F.archivo(100, 900), F.archivo(125, 900), F.archivo(75, 900), F.archivo(62, 900)];
const EASTERN = [F.archivo(100, 900)];
const INVITE = ['掃描', '右下角', 'QR code', '把祝福', '寫上', '大螢幕'];
/** 冷面的註腳（一本正經的溫柔玩笑）。 */
const FOOTNOTE = '＊字級已依現場幸福程度自動放大；超出畫面，屬正常現象。';

// 背景＋合成：底色（帶一點紙的起伏）、把字層疊上去；訊號色的字加亮（會發光）。
// 變化款 3 的疊影與分裂也在這裡做：在 GPU 上取樣放大的字層，比在 Canvas2D 畫好幾份大字便宜很多。
const COMP = () => new FSPass(/* glsl */ `
  uniform sampler2D tex; uniform float t;
  uniform vec3 bgA; uniform vec3 bgB; uniform float texAmt;
  uniform vec3 pulseCol; uniform float pulseK;
  uniform vec4 stage;             // 舞台範圍（uv，y 向上）：疊影與分裂只作用在這裡，上方的小字與左下的留言不受影響
  uniform float echo; uniform float spread; uniform vec2 echoC;
  uniform float split; uniform float splitSeed;
  uniform float hot;
  uniform float lid;
  float inStage(vec2 q) { return step(stage.x, q.x) * step(q.x, stage.z) * step(stage.y, q.y) * step(q.y, stage.w); }
  // 字層是「預乘、sRGB 編碼」的 RGBA8（見 init 的說明）：這裡還原成直通 alpha 的線性色
  vec4 samp(vec2 q) {
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
    vec4 s = texture(tex, q);
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

type Kind = 'line' | 'msg' | 'reprise' | 'invite';
interface Box { top: number; bottom: number }
/** 舞台上的一段：一句歌詞、主打留言（第一次打出來或回到舞台）、邀請。 */
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
  align: 'left' | 'center';
  line: Line | null;
  /** 組成一整塊的時間（歌詞：最後一個字唱完的下一拍，來不及就不組）。 */
  tAll: number;
  /** 署名出現的時間（只有留言）。 */
  tSig: number;
}
interface Dock { fit: FitResult; y0: number; top: number; eyebrowY: number; tIn: number; chars: number; w: number }
interface Rung { slab: Slab; t0: number; item: Item; k: number }
type P2 = { x: number; y: number };

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
  dock: Dock | null = null;
  /** 左下角留言的排版（有留言又有歌詞才有）；歌詞的舞台底要讓開它。 */
  dockGeom: Omit<Dock, 'tIn'> | null = null;
  sigText = '';
  tone!: Tone;
  /** 左下角留言的字：安靜款用細的宋體，不要比細細的歌詞還搶眼。 */
  dockFamily = this.v === 2 ? F.ming(400) : F.ming(700);
  /** 即時小卡要避開的範圍（整個窗格的重要文字：歌詞、主打留言、署名），init 算好，每一格原樣回傳。 */
  avoid: [number, number, number, number][] = [];
  /** 這一格舞台上大字的上下緣（疊影、分裂只作用在這裡面，眉標與署名不受影響）。每一格重算。 */
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
    // 新出現的中文要先載字型（留言本身導演已經載好；歌詞、署名、邀請、註腳這裡載）
    await loadText(lines.map((l) => l.text).join('') + this.sigText + INVITE.join('') + FOOTNOTE + '賓客留言新人的話已收到則祝福間奏思源黑體宋霞鶩文楷就是這個' + this.ctx.song.title);
    // 有留言又有歌詞：留言會停在左下角，歌詞的舞台要先知道底在哪裡
    if (this.msg && lines.length) this.dockGeom = this.planDock(c, this.msg);

    // ---- 歌詞：一句一段
    // 兩句之間的空檔不夠放別的東西（留言回舞台、邀請）時，上一句就留著（變淡）等下一句，不要空一個黑畫面
    const beat0 = au.beatPeriod(start);
    const fill = this.msg ? 3.2 : 6 * beat0 + 1.6;
    const lineItems: Item[] = [];
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
      lineItems.push(this.makeItem(c, 'line', tIn, tOut, pieces, line, tAll < tOut - 0.45 ? tAll : Infinity, Infinity));
    }

    // ---- 舞台空著的時段（前後各留一點給進出場）
    const busy = lineItems.map((it) => [Math.max(start, it.tIn - 0.15), it.tOut] as const);
    const free: { a: number; b: number }[] = [];
    let cur = start;
    for (const [a, b] of busy) { if (a - cur > 0.01) free.push({ a: cur, b: a }); cur = Math.max(cur, b); }
    if (end - cur > 0.01) free.push({ a: cur, b: end });

    const items: Item[] = [...lineItems];
    if (this.msg) {
      const f0 = free[0];
      const whole = lineItems.length === 0;
      let heroEnd = -Infinity;
      if (f0 && f0.a <= start + 0.05) {
        const hero = this.planMessage(c, f0.a, f0.b, whole);
        if (hero) { items.push(hero); heroEnd = hero.tOut; }
      }
      if (!whole && this.dockGeom) {
        // 有歌詞：留言停在左下角。第一次打出來的話，歌詞進來時縮下去；不然第一個拍點就開始寫
        const tIn = heroEnd > start ? heroEnd - 0.3 : beatAfter(au, start + 0.05);
        this.dock = { ...this.dockGeom, tIn };
        // 之後夠長的空檔（或開頭一段不夠一拍一組打完、但夠讀的空檔）：留言整塊回到舞台上
        const ref = items.find((it) => it.kind === 'msg');
        for (const g of free) {
          const atStart = g.a <= start + 0.05 && heroEnd < start;
          if (g.b <= heroEnd + 0.01 || g.b - g.a < (atStart ? 2.2 : 3.2)) continue;
          const src = ref ?? this.planMessage(c, g.a, g.b, false, true);
          if (!src) continue;
          // 窗格一開頭就是留言：切進來那一下就是它打上來的時刻；中間的空檔等下一拍
          const t0 = atStart ? g.a : beatAfter(au, g.a + 0.05);
          items.push({ ...src, kind: 'reprise', tIn: g.a, tOut: g.b, tAll: t0, tSig: t0, pieces: src.pieces.map((p) => ({ ...p, t0 })) });
        }
      }
    } else {
      // 沒有留言：夠長的空檔打一句邀請
      for (const g of free) {
        if (g.b - g.a < (lineItems.length ? 4 : 0.5)) continue;
        items.push(this.planInvite(c, g.a, g.b));
      }
    }
    items.sort((a, b) => a.tIn - b.tIn);
    // 相鄰的段不重疊（後面的先打上來就把前面的收掉）
    for (let i = 0; i + 1 < items.length; i++) items[i]!.tOut = Math.min(items[i]!.tOut, items[i + 1]!.tIn);
    this.items = items;

    // 所有打上來的時刻
    const sl: number[] = [];
    for (const it of items) {
      if (it.kind === 'reprise') { sl.push(it.tAll); continue; }
      for (const p of it.pieces) if (p.t0 >= start - 0.01 && p.t0 < it.tOut) sl.push(p.t0);
      if (it.tAll < it.tOut && v !== 0 && v !== 2) sl.push(it.tAll);
    }
    this.slams = sl.sort((a, b) => a - b);

    // 變化款 2 的梯子：每組一條，依時間排
    if (v === 2) {
      for (const it of items) it.rungs.forEach((r, k) => this.rungs.push({ slab: r, t0: it.pieces[k]!.t0, item: it, k }));
      this.rungs.sort((a, b) => a.t0 - b.t0);
    }
    this.avoid = this.planAvoid(c);
  }

  /**
   * 即時小卡要避開的範圍。小卡是在它出現那一刻挑位置、停好幾秒，所以給整個窗格會出現的重要文字：
   * 每一段的大字塊（連同眉標與署名）、一次一組的滿版字、上方整句歌詞、左下角留言、邀請的箭頭。
   * 樣張細線、mono 註記、註腳不重要，不列進來。
   * 引擎挑格子是比「重疊面積加總」：舞台上的大字併成外框——歌詞一個、留言與邀請一個（一句一句分開列，
   * 面積會重複算好幾次，反而把小卡推去蓋左下角的留言；兩種分開，變化款 0 靠左的歌詞才不會被寬的留言框
   * 吃掉右邊那一欄）；左下角留言列兩次——小字被蓋一半就讀不了，幾百 px 的大字被蓋一角還讀得到。
   */
  private planAvoid(c: CanvasRenderingContext2D): [number, number, number, number][] {
    const v = this.v, out: [number, number, number, number][] = [];
    const boxes = { line: [W, H, 0, 0], note: [W, H, 0, 0] };
    let group: number[] = boxes.line;
    const add = (x0: number, y0: number, x1: number, y1: number, pad = 14) => {
      const g = group;
      g[0] = Math.min(g[0]!, Math.max(0, x0 - pad)); g[1] = Math.min(g[1]!, Math.max(0, y0 - pad));
      g[2] = Math.max(g[2]!, Math.min(W, x1 + pad)); g[3] = Math.max(g[3]!, Math.min(H, y1 + pad));
    };
    const rect = (x0: number, y0: number, x1: number, y1: number): [number, number, number, number] => [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)];
    const note = (k: Kind) => k === 'msg' || k === 'reprise';
    // 署名的寬度（變化款 2 用 44 px 霞鶩文楷；其他款依字級，見 drawNote）
    const sigW = (size: number, fam: string) => { c.font = font(fam, size); return c.measureText(this.sigText).width; };
    for (const it of this.items) {
      const sl = it.slab;
      group = it.kind === 'line' ? boxes.line : boxes.note;
      if (v === 2) {
        if (it.kind === 'line') continue; // 歌詞的梯子另外算一整塊
        const { x: bx, y: by } = this.place(sl, LADDER_NOTE, 'left', LAD.x);
        const w = note(it.kind) ? Math.max(sl.width, sigW(44, F.hand(400))) : sl.width;
        add(bx, by + sl.top - 64, bx + w, by + sl.bottom + (note(it.kind) ? 98 : 0), 24);
        continue;
      }
      if (v === 0 || Number.isFinite(it.tAll)) {
        const { x: bx, y: by } = this.place(sl, it.box, it.align);
        let x0 = bx, x1 = bx + sl.width, y1 = by + sl.bottom;
        if (note(it.kind)) {
          const size = clamp(sl.size * 0.3, 40, 64), w = sigW(size, F.hand(700));
          const sx = Math.max(X0, it.align === 'left' ? bx + Math.max(sl.width - w, 0) : W / 2 + sl.width / 2 - w);
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx + w);
          y1 = Math.min(by + sl.bottom + size * 1.55, H - 270) + 16;
        }
        add(x0, by + sl.top - (it.kind === 'line' ? 0 : 70), x1, y1);
      }
      // 一次一組的滿版字：每組大小不同，合成一個外框就好
      if (it.singles.length) {
        let x0 = W, y0 = H, x1 = 0, y1 = 0;
        for (const one of it.singles) {
          const { x: bx, y: by } = this.place(one, it.box, 'center');
          x0 = Math.min(x0, bx); y0 = Math.min(y0, by + one.top); x1 = Math.max(x1, bx + one.width); y1 = Math.max(y1, by + one.bottom);
        }
        add(x0, y0, x1, y1);
      }
      if (it.line && (v === 1 || v === 3)) {
        // 上方的整句歌詞另外一個框（它在舞台外面，併進舞台的外框會把上方正中也框進去）
        // 小字：跟左下角留言一樣列兩次
        const lay = layoutLyric(c, it.line, this.stripStyle()), half = (lay.rows.length - 1) * lay.size * 0.6;
        const r = rect(X0 - 10, STRIP_Y - lay.size - half - 10, X0 + Math.max(...lay.rows.map((q) => q.width)) + 10, STRIP_Y + lay.size * 0.3 + half + 10);
        out.push(r, r);
      }
      if (it.kind === 'invite') out.push(rect(1640, 680, W - 120, 830));
    }
    if (v === 2 && this.rungs.length) {
      // 梯子：最近的三四條清楚、更上面的已經很淡（左邊還有行號）
      const w = Math.max(...this.rungs.filter((r) => r.item.kind === 'line').map((r) => r.slab.width), 0);
      group = boxes.line;
      if (w > 0) add(LAD.x - 100, LAD.cy - 4 * LAD.gap - 60, LAD.x + w, LAD.cy + 30, 24);
      if (this.items.some((it) => it.kind === 'invite')) out.push(rect(1640, 680, W - 120, 830));
    }
    for (const b of [boxes.line, boxes.note]) if (b[2]! > b[0]!) out.push(rect(b[0]!, b[1]!, b[2]!, b[3]!));
    if (this.dock) { const d = rect(X0 - 10, this.dock.top - 10, X0 + this.dock.w + 10, H - 86); out.push(d, d); }
    // 同一個範圍只列一次（邀請的箭頭、同一句歌詞可能出現好幾次）；小字刻意列兩次，見上面的說明
    return out.filter((r, i) => r === out[i - 1] || out.findIndex((q) => q.join() === r.join()) === i);
  }

  /** 排一段：大字塊、單組滿版、細字梯子都在這裡排好。 */
  private makeItem(c: CanvasRenderingContext2D, kind: Kind, tIn: number, tOut: number, pieces: Piece[], line: Line | null, tAll: number, tSig: number): Item {
    const v = this.v;
    const lyric = kind === 'line';
    const eastern = pieces.some((p) => isEastern(p.text));
    // 留言用典雅的聲音（思源宋體），歌詞與邀請用歌詞的聲音（Archivo／思源黑體）
    const fams = kind === 'msg' || kind === 'reprise' ? [F.ming(900)] : eastern && !/[A-Za-z]/.test(pieces.map((p) => p.text).join('')) ? EASTERN : LATIN;
    const top = lyric ? (v === 1 || v === 3 ? STRIP_TOP : TOP) : kind === 'invite' ? TOP + 30 : TOP + 56;
    const bottom = lyric ? (this.dockGeom ? Math.min(BOTTOM, this.dockGeom.top - 60) : BOTTOM) : BOTTOM - 84;
    const box = { top, bottom };
    const align: 'left' | 'center' = v === 0 ? 'left' : 'center';
    let slab: Slab;
    if (v === 2) {
      // 安靜款最後組成的樣子也是細的、不大
      const quiet = kind === 'msg' || kind === 'reprise' ? [F.ming(400)] : [F.archivo(125, 300)];
      slab = layoutSlab(c, pieces, { families: quiet, w: LAD.w, h: Math.min(360, bottom - top), maxRows: 4, maxSize: kind === 'invite' ? 88 : 96, minSize: 44, align: 'left', pitch: 1.45 });
    } else {
      slab = layoutSlab(c, pieces, { families: fams, w: v === 0 && lyric ? V0_LYRIC_W : SW, h: bottom - top, maxRows: 4, maxSize: lyric ? 470 : 400, minSize: lyric ? 60 : 44, align });
    }
    const singles = v === 1 || v === 3 ? pieces.map((p) => layoutSlab(c, [p], { families: fams, w: SW, h: bottom - top, maxRows: 1, maxSize: 620, minSize: 60, align: 'center' })) : [];
    const rungFam = kind === 'msg' || kind === 'reprise' ? [F.ming(400)] : [F.archivo(125, 300)];
    const rungs = v === 2 ? pieces.map((p) => layoutSlab(c, [p], { families: rungFam, w: LAD.w, h: 90, maxRows: 1, maxSize: 64, minSize: 48, track: 0.14, align: 'left' })) : [];
    return { kind, tIn, tOut, pieces, slab, singles, rungs, box, align, line, tAll, tSig };
  }

  /** 留言第一次上舞台：切成詞組、一拍一組；打完下一拍組成一塊（變化款 0 本來就是一塊），再下一拍署名。 */
  private planMessage(c: CanvasRenderingContext2D, a: number, b: number, whole: boolean, silent = false): Item | null {
    const au = this.ctx.audio, m = this.msg!;
    const tA = beatAfter(au, a + 0.06);
    const beat = au.beatPeriod(tA);
    // 最多打兩小節（八拍）：留言要在第一個拍點後一兩小節內完整出現。字多就一組多放幾個字
    const room = Math.floor((b - tA - Math.max(2.2, readSeconds(m.text) * 0.6)) / beat);
    const nMax = clamp(Math.min(8, room), whole ? 1 : 3, 8);
    let pieces: Piece[] = [];
    for (let k = 0; k < 12; k++) {
      pieces = textPieces(m.text, 4 + k, 9 + 3 * k);
      if (pieces.length <= nMax) break;
    }
    if (!whole && !silent && pieces.length > room) return null;
    const bi = Math.round(au.beatAt(tA));
    const n = pieces.length;
    // 窗格很短、整則留言又一定要打完（沒有歌詞可以接手）：改成半拍一組
    const step = whole && au.timeOfBeat(bi + n + 1) > b - 0.6 ? 0.5 : 1;
    pieces.forEach((p, i) => (p.t0 = au.timeOfBeat(bi + i * step)));
    const tAll = this.v === 0 ? pieces[n - 1]!.t0 : au.timeOfBeat(bi + n * step);
    const tSig = au.timeOfBeat(bi + (n + (this.v === 0 ? 0 : 1)) * step);
    return this.makeItem(c, 'msg', a, b, pieces, null, Math.min(tAll, b - 0.3), Math.min(tSig, b - 0.2));
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

  /** 左下角的留言：編號、署名、內容（思源宋體，最少 44 px）。 */
  private planDock(c: CanvasRenderingContext2D, m: Msg): Omit<Dock, 'tIn'> {
    const fit = layoutMessage(c, m.text, this.dockFamily, DOCK_W, 176, { min: 44, max: 58, maxLines: 3, lineHeight: 1.3 });
    const y0 = H - 116 - (fit.lines.length - 1) * fit.lineHeight;
    const eyebrowY = y0 - fit.size * 0.9 - 30;
    // 寬度跟著內容走：眉標（編號）與署名要並排放得下，最少 480；短留言就不會佔掉下方正中（即時小卡的格子）
    c.font = font(F.mono(500), 16); c.letterSpacing = '4px';
    const ew = c.measureText(this.eyebrow(m)).width;
    c.letterSpacing = '0px';
    c.font = font(F.hand(400), 32);
    const sw = c.measureText(this.sigText).width;
    const w = clamp(Math.max(fit.width + 24, ew + sw + 64), 480, DOCK_W);
    return { fit, y0, top: eyebrowY - 24, eyebrowY, w, chars: fit.lines.reduce((s, l) => s + Array.from(l).length, 0) };
  }

  /** 留言的眉標：編號與來源。 */
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
    const E = 0.65 + 0.6 * this.energy;

    // ---- 舞台
    let head: P2 | null = null;
    const cy = (TOP + BOTTOM) / 2;
    c.save();
    if (ex > 0 && (v === 0 || v === 3)) {
      // 退場：整個舞台壓扁成一條線（下一個版面在小節線上切進來）
      c.translate(0, cy); c.scale(1, Math.max(0.006, 1 - ex)); c.translate(0, -cy);
    }
    if (v === 2) head = this.drawLadder(c, t);
    else if (it) head = it.kind === 'line' ? this.drawLine(c, it, t) : this.drawNote(c, it, t);
    c.restore();
    if (ex > 0 && (v === 0 || v === 3)) {
      c.fillStyle = rgba('signal', Math.min(1, ex * 1.6) * (1 - 0.5 * ex));
      c.fillRect(X0 - 40, cy - 1, SW + 80, 2);
    }

    // ---- 旁邊的小字：mono 註記、整句歌詞（1、3）、左下角留言、註腳
    const chromeA = 1 - (v === 2 ? 0 : ex);
    c.save();
    c.globalAlpha = chromeA * prog(t, s, s + Math.min(0.3, beat * 0.6));
    this.drawChrome(c, t, f, it);
    if (it && it.kind === 'line' && (v === 1 || v === 3)) this.drawStrip(c, it, t);
    if (this.dock) this.drawDock(c, t);
    c.restore();

    // ---- 合成
    const u = this.comp.u;
    u.tex!.value = L.upload();
    u.t!.value = t;
    const bgA: PaletteKey = v === 1 ? 'signal' : 'ink';
    (u.bgA!.value as THREE.Vector3).set(...LIN[bgA]);
    (u.bgB!.value as THREE.Vector3).set(...(v === 1 ? LIN.ember : LIN.ink2));
    u.texAmt!.value = v === 1 ? 0.1 : v === 2 ? 0.55 : 0.9;
    u.hot!.value = v === 1 ? 0 : v === 2 ? 0.5 : 0.55;
    const last = this.lastSlam(t);
    const box = it?.box ?? { top: TOP, bottom: BOTTOM };
    const ink = this.ink ?? box;
    (u.stage!.value as THREE.Vector4).set(0, 1 - (ink.bottom + 24) / H, 1, 1 - (ink.top - 24) / H);
    u.echo!.value = 0; u.split!.value = 0; u.pulseK!.value = 0; u.lid!.value = 0;
    (u.pulseCol!.value as THREE.Vector3).set(...LIN.blood);
    if (v === 3) {
      // 每一拍重打：疊影從字的中心往外擴散，字一直分裂（八分音符換一次切法）
      const rt = this.retrig(t);
      const age = t - rt;
      // 留言組成一整塊之後要讀得下去：疊影與分裂收小
      const calm = it && it.kind !== 'line' && t >= it.tAll ? 0.45 : 1;
      u.echo!.value = Math.exp(-age / 0.38) * (0.55 + 0.45 * pulse(t, last, 0.2)) * calm;
      u.spread!.value = 0.05 * (1 + age * 3.2);
      (u.echoC!.value as THREE.Vector2).set(0.5, 1 - (box.top + box.bottom) / 2 / H);
      u.split!.value = (10 + 55 * pulse(t, rt, 0.06)) * (1 - ex) * calm;
      u.splitSeed!.value = Math.floor(f.beat * 2) + (this.seed % 97);
      u.pulseK!.value = 0.16 * pulse(t, last, 0.07);
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

    // ---- 後製：大鼓輕微放大、小鼓閃一下（很小）、打上來時震一下
    const o: PostOverrides = { popups: v === 2 ? 0.85 : 0.6, popupAvoid: this.avoid, bloom: 0.7, vignette: 0.42 };
    const kick = f.a.kick, snare = f.a.snare;
    let shake = 0;
    if (v === 0) { o.zoom = 1 + 0.012 * kick * E; o.flash = 0.03 * snare * E; shake = 5 * pulse(t, last, 0.05) * E; }
    if (v === 1) { o.zoom = 1 + 0.016 * kick * E; shake = 8 * pulse(t, last, 0.05) * E; o.paper = 1; o.bloomThreshold = 1.4; o.vignette = 0.5; o.grain = 0.05; }
    if (v === 2) { o.vignette = 0.62; o.grain = 0.065; o.ca = 0.6; o.bloom = 0.6; }
    if (v === 3) { o.zoom = 1 + 0.022 * kick * E; o.flash = 0.045 * snare * E; shake = (4 + 12 * pulse(t, last, 0.06)) * E; o.ca = 2.2; o.bloom = 0.8; }
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
    return head;
  }

  /** 變化款 1、3：一次一組、撐滿舞台。 */
  private drawSingle(c: CanvasRenderingContext2D, it: Item, t: number): P2 | null {
    let idx = -1;
    it.pieces.forEach((p, i) => { if (t >= p.t0) idx = i; });
    if (idx < 0) return null;
    const p = it.pieces[idx]!, sl = it.singles[idx]!;
    const { x: bx, y: by } = this.place(sl, it.box, 'center');
    this.guides(c, sl, bx, by, t, 1);
    const t0 = this.v === 3 ? this.retrig(t) : p.t0;
    const sc = this.punch(t, t0, this.v === 3 ? (t0 === p.t0 ? 0.26 : 0.12) : 0.14);
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

  /** 唱完（或打完）組成一整塊。 */
  private drawWhole(c: CanvasRenderingContext2D, it: Item, t: number): void {
    const sl = it.slab;
    const { x: bx, y: by } = this.place(sl, it.box, it.align);
    this.guides(c, sl, bx, by, t, 1);
    const sc = this.punch(t, it.tAll, this.v === 2 ? 0 : 0.1, 0.005);
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
    let head: P2 | null = null;
    if (it.kind === 'reprise' && t < it.tAll) { c.restore(); return null; }
    const whole = v === 0 || t >= it.tAll;
    if (whole) {
      if (v === 0 && it.kind !== 'reprise') this.drawBuild(c, it, sl, t);
      else this.drawWhole(c, it, t);
    } else this.drawSingle(c, it, t);
    // 眉標：編號（mono）；新人自己加的標「新人的話」。一組一組打的時候固定在舞台頂上（每組大小不同，跟著跳會很亂），
    // 組成一塊之後貼著那一塊（上面還有一行字面高度的註記，所以留 50）
    const m = this.msg;
    const ink = v === 1 ? 'ink' : 'bone';
    const top = whole ? by + sl.top - 16 : it.box.top;
    const k0 = prog(t, it.tIn, it.tIn + 0.3);
    c.save();
    c.globalAlpha *= k0;
    c.font = font(F.mono(500), 17);
    c.letterSpacing = '4px';
    c.fillStyle = rgba(v === 1 ? 'ink' : 'signal', v === 1 ? 0.75 : 1);
    const ax = it.align === 'left' ? bx : W / 2;
    c.textAlign = it.align === 'left' ? 'left' : 'center';
    if (it.kind === 'invite') c.fillText(`INVITATION  ·  邀請`, ax, top - 34);
    else if (m) c.fillText(`No.${String(m.n).padStart(3, '0')}  ·  ${m.couple ? '新人的話  ·  FROM THE COUPLE' : '賓客留言'}`, ax, top - 34);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
    c.restore();
    // 署名（或邀請的指引）：打完之後的下一拍，火花在下面劃一條線
    if (t >= it.tSig) {
      const ks = prog(t, it.tSig, it.tSig + 0.35, ease.outExpo);
      const au = this.ctx.audio;
      const lineK = prog(t, it.tSig, it.tSig + au.beatPeriod(it.tSig) * 0.9, ease.inOutCubic);
      const bottom = by + sl.bottom;
      if (it.kind === 'invite') head = this.drawArrow(c, t, bx, by, sl, ks, lineK, ink);
      else if (m) {
        const size = clamp(sl.size * 0.3, 40, 64);
        c.font = font(F.hand(700), size);
        const w = c.measureText(this.sigText).width;
        const sx = it.align === 'left' ? bx + Math.max(sl.width - w, 0) : W / 2 + sl.width / 2 - w;
        const sy = Math.min(bottom + size * 1.55, H - 250 - 20);
        c.save();
        c.globalAlpha *= ks;
        c.fillStyle = rgba(v === 1 ? 'ink' : 'bone', 0.92);
        c.fillText(this.sigText, Math.max(X0, sx), sy + (1 - ks) * 14);
        c.restore();
        const lx0 = Math.max(X0, sx), lx1 = lx0 + w * lineK;
        c.fillStyle = rgba(v === 1 ? 'ink' : 'signal', v === 1 ? 0.6 : 0.85);
        c.fillRect(lx0, sy + size * 0.28, lx1 - lx0, 2);
        if (lineK > 0 && lineK < 1 && v !== 1) head = { x: lx1, y: sy + size * 0.28 };
      }
    }
    c.restore();
    return x > 0.3 ? null : head;
  }

  /**
   * 邀請的指引：火花從字塊下方往下畫一條細線，直直指到右下角 QR code 的正上方（停在 HUD 區外），
   * 旁邊一句冷面的說明。QR 的中心照 hud.ts 的位置（右邊界往內 52 + 176 / 2）。
   */
  private drawArrow(c: CanvasRenderingContext2D, _t: number, _bx: number, by: number, sl: Slab, ks: number, k: number, ink: PaletteKey): P2 | null {
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
    return k > 0 && k < 1 && this.v !== 1 ? { x, y: ye } : null;
  }

  // ---------------------------------------------------------------- 變化款 2：細字梯子
  private drawLadder(c: CanvasRenderingContext2D, t: number): P2 | null {
    const lx = LAD.x, cy = LAD.cy, gap = LAD.gap;
    const it = this.itemAt(t);
    // 整疊以左緣為軸慢慢轉（一個窗格轉兩度左右）、慢慢推近。推近在這裡做而不是用後製的 zoom：後製會把上方的小字一起推出安全框
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
    for (let i = Math.max(0, n - 7); i < n; i++) {
      const r = shown[i]!;
      let slot = 0;
      for (let j = i + 1; j < n; j++) slot += ease.outExpo(clamp((t - shown[j]!.t0) / 0.4)) * (shown[j]!.item === r.item ? 1 : 1.6);
      const since = t - r.t0;
      const rise = (1 - ease.outExpo(clamp(since / 0.4))) * gap * 0.6;
      const y = cy - slot * gap + rise - since * 6;
      const same = it && r.item === it;
      const a = slot < 0.02 ? 1 : same ? Math.pow(0.66, slot) : 0.2 / (1 + slot);
      if (a < 0.02 || y < 120) continue;
      const sl = r.slab, pl = sl.pieces[0]!;
      c.save();
      c.globalAlpha *= a * prog(since, 0, 0.12);
      // 左邊的行號（像詩的行號）：這一句的第幾組
      c.font = font(F.mono(400), 14);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('ash', 0.7);
      c.fillText(String(r.k + 1).padStart(2, '0'), lx - 96, y);
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
        if (h) head = { x: lx + pl.x + h.x, y: y + sl.size * 0.3 };
      }
      c.restore();
    }
    // 留言、邀請打完之後：組成一小塊，安靜地放在梯子的位置
    if (it && it.kind !== 'line' && t >= it.tAll) {
      const sl = it.slab;
      const k = prog(t, it.tAll, it.tAll + 0.6, ease.outCubic) * (1 - this.itemExit(it, t));
      const { x: bx, y: by } = this.place(sl, LADDER_NOTE, 'left', lx);
      c.save();
      c.globalAlpha *= k;
      c.translate(0, (1 - k) * 16);
      c.font = font(sl.family, sl.size);
      sl.pieces.forEach((pl) => { c.save(); c.translate(bx + pl.x, by + pl.y); drawCells(c, pl.cells, sl.size, t, this.tone, 0); c.restore(); });
      // 眉標：編號或「邀請」（mono、很小）
      c.font = font(F.mono(500), 15);
      c.letterSpacing = '5px';
      c.fillStyle = rgba('signal', 0.9);
      const m = this.msg;
      c.fillText(it.kind === 'invite' ? 'INVITATION  ·  邀請' : m ? this.eyebrow(m) : '', bx, by + sl.top - 44);
      c.letterSpacing = '0px';
      if (it.kind !== 'invite' && t >= it.tSig) {
        // 署名：靠右對齊在字塊的右緣
        c.globalAlpha *= prog(t, it.tSig, it.tSig + 0.5);
        c.font = font(F.hand(400), 44);
        c.textAlign = 'right';
        c.fillStyle = rgba('ash');
        c.fillText(this.sigText, bx + Math.max(sl.width, c.measureText(this.sigText).width), by + sl.bottom + 84);
        c.textAlign = 'left';
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
      head = this.drawArrow(c, t, 0, by, it.slab, prog(t, it.tSig, it.tSig + 0.5), k, 'bone') ?? head;
      c.restore();
    }
    return head;
  }

  private ctxP(t: number) { return clamp((t - this.ctx.start) / Math.max(0.5, this.ctx.end - this.ctx.start)); }

  /** 地平線：兩端淡出的細線，大鼓一打亮一點。 */
  private horizon(c: CanvasRenderingContext2D, y: number, t: number, a = 1) {
    if (a <= 0.001) return;
    const k = (0.09 + 0.1 * this.ctx.audio.hit('kick', t, 0.12)) * a;
    const g = c.createLinearGradient(-200, 0, W + 200, 0);
    g.addColorStop(0, rgba('bone', 0));
    g.addColorStop(0.3, rgba('bone', k));
    g.addColorStop(0.7, rgba('bone', k));
    g.addColorStop(1, rgba('bone', 0));
    c.fillStyle = g;
    c.fillRect(-200, y + 19, W + 400, 1);
  }

  // ---------------------------------------------------------------- 樣張的細線
  /**
   * 每一行的基線與字面頂端：全寬的細線，第一行標上 mono 註記（pdoom hook 的 type-specimen guides）。
   * 拉丁大寫標「cap-height」，中文標「em-box」，數字是量出來的（字級的幾倍）。
   */
  private guides(c: CanvasRenderingContext2D, sl: Slab, bx: number, by: number, t: number, k: number) {
    this.ink = { top: by + sl.top, bottom: by + sl.bottom };
    if (k <= 0) return;
    const v = this.v;
    const ink: PaletteKey = v === 1 ? 'ink' : 'bone';
    const a = (v === 1 ? 0.22 : 0.12) + 0.08 * this.ctx.audio.hit('kick', t, 0.12);
    c.save();
    const w = W * ease.outExpo(k);
    const x0 = W / 2 - w / 2;
    c.fillStyle = rgba(ink, a);
    for (const r of sl.rows) {
      c.fillRect(x0, Math.round(by + r.y), w, 1);
      c.fillRect(x0, Math.round(by + r.y - r.asc), w, 1);
    }
    // 最滿的款（3）不放註記：疊影會把小字放大成一片糊
    if (v === 3) { c.restore(); return; }
    // 註記只放在字塊外面：第一條頂線的上方（左：字面高度，右：字族與字級），最後一行的下方（基線）。
    // 放在基線旁邊會被中文字（基線下還有一截）或下一行蓋到
    const r0 = sl.rows[0]!, rl = sl.rows[sl.rows.length - 1]!;
    c.font = font(F.mono(400), 13);
    c.letterSpacing = '1.5px';
    c.fillStyle = rgba(ink, v === 1 ? 0.62 : 0.48);
    const yTop = Math.round(by + r0.y - r0.asc) - 10;
    c.fillText(`${sl.eastern ? 'em-box' : 'cap-height'} · ${(r0.asc / sl.size).toFixed(3)} em`, X0, yTop);
    c.textAlign = 'right';
    c.fillText(`${familyName(sl)} · ${Math.round(sl.size)} px`, X1, yTop);
    c.textAlign = 'left';
    c.fillText(`baseline${sl.rows.length > 1 ? ` × ${sl.rows.length}` : ''}`, bx, Math.round(by + rl.y + rl.desc) + 26);
    c.letterSpacing = '0px';
    c.restore();
  }

  // ---------------------------------------------------------------- 小字
  /** mono 註記：左上是這一段是什麼，右上是拍子（機器的聲音）；左下是冷面的註腳。 */
  private drawChrome(c: CanvasRenderingContext2D, t: number, f: Frame, it: Item | null) {
    const v = this.v, au = this.ctx.audio;
    const ink: PaletteKey = v === 1 ? 'ink' : 'bone';
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba(ink, v === 1 ? 0.62 : 0.42);
    const bar = Math.floor(f.bar) + 1, b4 = (Math.floor(f.beat) % 4 + 4) % 4 + 1;
    c.textAlign = 'right';
    c.fillText(`${Math.round(au.bpm)} BPM  ·  BAR ${String(bar).padStart(3, '0')}  ·  ${b4}/4`, X1, HEAD_Y);
    c.textAlign = 'left';
    // 變化款 1、3 唱歌詞時左上角是整句歌詞，不放標籤
    if ((v !== 1 && v !== 3) || !it || it.kind !== 'line') {
      let label = '';
      if (it?.kind === 'line' && it.line) {
        let k = 0;
        it.pieces.forEach((p, i) => { if (t >= p.t0) k = i + 1; });
        label = `LYRIC ${String(it.line.i + 1).padStart(2, '0')}  ·  ${k}/${it.pieces.length}`;
      } else if (it?.kind === 'invite') label = 'INTERLUDE  ·  間奏';
      else if (it) label = 'GUEST NOTE';
      else label = '— INTERLUDE —';
      c.fillText(label, X0, HEAD_Y);
    }
    c.letterSpacing = '0px';
    // 註腳：左下角沒有留言時才放（不進右下角 HUD）
    if (!this.dock && v !== 2) {
      c.font = font(F.hei(500), 17);
      c.letterSpacing = '2px';
      c.fillStyle = rgba(v === 1 ? 'ink' : 'ash', v === 1 ? 0.55 : 0.6);
      c.fillText(FOOTNOTE, X0, H - 100);
      c.letterSpacing = '0px';
    }
  }

  /**
   * 上方整句歌詞的樣式。最寬 580（太長就折兩行）：只佔左上角，上方正中與右上角（即時小卡的格子）空出來，
   * 小卡跳出來不會蓋到這行小字。
   */
  private stripStyle(): LyricStyle {
    return this.v === 1
      ? { family: F.archivo(100, 700), size: 50, minSize: 48, maxWidth: STRIP_W, active: rgba('ink'), sung: rgba('ink', 0.92), unsung: rgba('ink', 0.3) }
      : { family: F.archivo(100, 700), size: 50, minSize: 48, maxWidth: STRIP_W };
  }

  /** 變化款 1、3：上方的整句歌詞（大字一次只有一組，整句在這裡讀得到）。 */
  private drawStrip(c: CanvasRenderingContext2D, it: Item, t: number) {
    const line = it.line!;
    const st = this.stripStyle();
    const lay = layoutLyric(c, line, st);
    const k = prog(t, it.tIn - 0.3, it.tIn, ease.outCubic) * (1 - this.itemExit(it, t));
    c.save();
    c.translate(X0, STRIP_Y - (lay.rows.length - 1) * lay.size * 1.18 * 0.5);
    drawLyric(c, line, t, st, lay, k);
    c.restore();
  }

  /** 左下角的留言：第一個拍點開始逐字寫出來（一小節內寫完），停到窗格結束；留言回到舞台時讓開。 */
  private drawDock(c: CanvasRenderingContext2D, t: number) {
    const d = this.dock!, m = this.msg!, v = this.v;
    if (t < d.tIn) return;
    // 留言在舞台上時（第一次打出來、回到舞台）左下角讓開
    let vis = 1;
    for (const it of this.items) {
      if (it.kind !== 'msg' && it.kind !== 'reprise') continue;
      vis = Math.min(vis, 1 - Math.min(prog(t, it.tIn - 0.25, it.tIn), 1 - prog(t, it.tOut - 0.3, it.tOut)));
    }
    if (vis <= 0.001) return;
    const au = this.ctx.audio;
    const dur = Math.min(au.beatPeriod(d.tIn) * 4, 0.05 * d.chars + 0.4);
    const k = prog(t, d.tIn, d.tIn + 0.3, ease.outCubic);
    const ink: PaletteKey = v === 1 ? 'ink' : 'bone';
    c.save();
    c.globalAlpha *= vis;
    // 眉標與細線
    c.globalAlpha *= k;
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '4px';
    c.fillStyle = rgba(v === 1 ? 'ink' : 'signal', v === 1 ? 0.75 : 1);
    c.fillText(this.eyebrow(m), X0, d.eyebrowY);
    c.letterSpacing = '0px';
    c.fillStyle = rgba(ink, 0.22);
    c.fillRect(X0, d.eyebrowY + 12, d.w * ease.outExpo(k), 1);
    c.font = font(F.hand(400), 32);
    c.textAlign = 'right';
    c.fillStyle = rgba(v === 1 ? 'ink' : 'ash', 0.9);
    c.fillText(this.sigText, X0 + d.w, d.eyebrowY);
    c.textAlign = 'left';
    // 內容：逐字寫出來
    const chars = d.chars * prog(t, d.tIn + 0.1, d.tIn + 0.1 + dur);
    c.font = font(this.dockFamily, d.fit.size);
    let left = chars;
    d.fit.lines.forEach((ln, i) => {
      if (left <= 0) return;
      const cs = Array.from(ln);
      const shown = left >= cs.length ? ln : cs.slice(0, Math.floor(left)).join('');
      left -= cs.length;
      fillRich(c, shown, X0, d.y0 + i * d.fit.lineHeight, d.fit.size, rgba(ink, 0.95), 0.95);
    });
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
