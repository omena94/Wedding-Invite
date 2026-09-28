// 營養標示（批次 T4・紙本 D，亮）：一盒「婚禮特調」平放在亞麻桌巾上，盒面印著一張營養標示；鏡頭斜斜地拍，看得到盒子的右側與前側。
//  - 焦點是「成分」欄：主打留言印成成分（思源宋體、大），署名在後面。
//  - 「每一份量：1 句歌詞」——所以表頭下面那一大格就是現在唱的那一句（中等大小，逐字跟唱）。
//  - 營養素一拍一列填上去（小字）：數字像拉霸一樣轉、停在拍點上；每日參考值的長條長出來，
//    「甜度 200%」衝破標示的框、「心動」一路衝過盒子的邊角、繞到側面去（冷面：超出量表）。
//  - 列都填完的下一個小節線，紅筆圈起「200」；再下一個小節線，盒子側面「啪」地貼上一張甜度貼紙。
//  - 鏡頭：開場貼近盒角，第一拍 outExpo 轉到正面偏右上的位置，之後慢慢推向成分欄；焦點在留言上（景深），桌巾與盒子遠端微微失焦。
// 畫法：盒子的三個面（正面、右側、前側）攤開成一張展開圖畫進同一張 render target（所以長條可以從正面直接畫到側面，
// 在盒角自然折過去）：紙板雲紋與網點印刷一個 shader，框線與標籤一張不會變的 Canvas，會動的東西第二張 Canvas。
// 盒子是三個面的網格，交給 _t4 的舞台（透視鏡頭、桌巾、影子、景深）去拍。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, signature } from './_motifs';
import { grid, stagger, fitMsg, drawFit, layoutRows, drawRows, paperInk, lastIdx, Stage, docRT, camDist, type Grid, type RowsStyle, type V3 } from './_t4';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.3, 0.9], bars: [4, 8] };

// ---------------------------------------------------------------- 盒子的展開圖（像素，左上原點、y 向下）
// 正面 LW × LH 在左上；右側 BT 寬、接在正面右邊；前側 BT 高、接在正面下面（右下角那塊沒用到）。
const LW = 1320, LH = 920, BT = 220;
const AW = LW + BT, AH = LH + BT;
const LB = { x: 36, y: 36, w: LW - 72, h: LH - 72 }; // 營養標示的白底
const X0 = LB.x + 32, X1 = LB.x + LB.w - 32;
const TITLE_Y = 96, RULE1 = 112, SERV_Y = 142;
const LYR = { y: 154, h: 142 };
const BAR1 = 306;
const ROW0 = 330, RH = 40, NROW = 5;
const BAR2 = ROW0 + NROW * RH + 8;
const ING_Y = BAR2 + 40;
const SIG = 62; // 署名在留言最後一行下面多少
const MSG = { x: X0, y: ING_Y + 14, w: X1 - X0, h: LB.y + LB.h - 24 - SIG - (ING_Y + 14) };
const COL_V = 600, COL_P = 730; // 每份（靠右）、百分比（靠右）
const BAR_X = 760, BAR_100 = 300; // 長條：100% 的長度
const BADGE = { x: LB.x + LB.w - 30, y: 96, r: 84 }; // 貼在標示右上角（一半超出框）

const LY: RowsStyle = { family: F.archivo(100, 800), size: 80, minSize: 64, maxW: X1 - X0, maxRows: 2, lineHeight: 1.04 };

interface Row { k: string; v: string; unit: string; pct: number; pctText: string }
const ROWS: Row[] = [
  { k: '熱量', v: '520', unit: '大卡', pct: 26, pctText: '26 %' },
  { k: '甜度', v: '200', unit: '%', pct: 200, pctText: '200 %' },
  { k: '心動', v: '∞', unit: '', pct: Infinity, pctText: '超出量表' },
  { k: '耐心', v: '1', unit: '輩子', pct: 100, pctText: '100 %' },
  { k: '鈉（吵架）', v: '0', unit: '毫克', pct: 0, pctText: '0 %' },
];
const TEXT = '營養標示婚禮特調每一份量句歌詞本包裝含人份每份每日參考值百分比成分過敏原資訊本產品含有大量的愛保存期限永久開封後請與身邊的人分享淨重一輩子你的祝福尚未添加掃描右下角把加進成分表純音樂無添加間奏中超出量表甜度熱量大卡心動耐心輩子鈉吵架毫克';

// ---------------------------------------------------------------- 盒面的印刷（shader）
const PRINT = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${AH}.0 - FRAG_PX.y);
    float side = step(${LW}.0, p.x), near = step(${LH}.0, p.y);
    // 紙板：大片的雲紋、細細的纖維
    float cloud = fbm(p / 420.0, 3), fine = snoise(p / 7.0);
    vec3 col = C_PAPER * (0.9 + 0.02 * cloud + 0.006 * fine);
    // 網點印刷（45 度）：側面越往外越大顆，正面只在標示外面的邊上很淡
    vec2 q = rot2(0.785) * p / 12.0;
    float amt = side * (0.15 + 0.45 * smoothstep(${LW}.0, ${AW}.0, p.x)) + near * 0.12 + (1.0 - side) * (1.0 - near) * 0.1;
    float dotA = aaFill(length(fract(q) - 0.5) - 0.5 * sqrt(amt));
    col = mix(col, C_BLOOD * 0.9 + C_SIGNAL * 0.1, dotA * 0.18);
    // 面與面的交界（盒角）：一條很細的暗線
    col *= 1.0 - 0.25 * pxLine(abs(p.x - ${LW}.0), 0.4, 1.4) * (1.0 - near) - 0.25 * pxLine(abs(p.y - ${LH}.0), 0.4, 1.4) * (1.0 - side);
    // 標示的白底（正面）
    vec2 d = abs(p - vec2(${LB.x + LB.w / 2}.0, ${LB.y + LB.h / 2}.0)) - vec2(${LB.w / 2}.0, ${LB.h / 2}.0);
    float inLabel = (1.0 - smoothstep(-0.5, 0.5, max(d.x, d.y))) * (1.0 - side) * (1.0 - near);
    col = mix(col, C_PAPER * (0.995 + 0.006 * fine), inLabel);
    fragColor = vec4(col, 1.0);
  }`);

/** 盒子（三個面）的網格：頂點位置與展開圖的 uv。 */
function boxGeometry() {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  const face = (P: V3[], U: [number, number][], n: V3) => {
    const b = pos.length / 3;
    P.forEach((p, i) => { pos.push(...p); uv.push(U[i]![0] / AW, 1 - U[i]![1] / AH); nrm.push(...n); });
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const x0 = -LW / 2, x1 = LW / 2, y0 = -LH / 2, y1 = LH / 2;
  // 正面（朝上）：展開圖的左上角 (0,0) = 盒面左邊、裡面（y1）
  face([[x0, y1, BT], [x0, y0, BT], [x1, y0, BT], [x1, y1, BT]], [[0, 0], [0, LH], [LW, LH], [LW, 0]], [0, 0, 1]);
  // 右側（朝 +x）：展開圖 x = LW（上緣）… LW + BT（桌面）
  face([[x1, y1, BT], [x1, y0, BT], [x1, y0, 0], [x1, y1, 0]], [[LW, 0], [LW, LH], [AW, LH], [AW, 0]], [1, 0, 0]);
  // 前側（朝 -y）：展開圖 y = LH（上緣）… LH + BT（桌面）
  face([[x0, y0, BT], [x0, y0, 0], [x1, y0, 0], [x1, y0, BT]], [[0, LH], [0, AH], [LW, AH], [LW, LH]], [0, -1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function makeRig() {
  const doc = docRT(AW, AH);
  const st = new Stage(2, 30);
  st.U.ambient.value = 0.74;
  const mat = st.docMaterial(doc.texture, [doc.width, doc.height], [AW, AH], { edge: 0, depthTest: true });
  const box = new THREE.Mesh(boxGeometry(), mat);
  box.frustumCulled = false;
  box.rotation.z = 0.03;
  st.scene.add(box);
  return { doc, st, mat, box };
}

export default class Nutrition extends Scene {
  printPass = shared('nutrition.print', PRINT);
  rig = shared('nutrition.rig', makeRig);
  /** 不會變的：框線、標題、欄名、營養素的名字、側面與前側的小字（第一格畫好上傳一次）。 */
  base = this.track(new Layer2D(AW, AH, undefined, { fast: true }));
  /** 每格重畫：歌詞、數字、長條、留言、紅筆、貼紙。 */
  live = this.track(new Layer2D(AW, AH, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  rowT: number[] = [];
  tMsg = 0; tCircle = Infinity; tBadge = Infinity;
  fit: FitResult | null = null;
  fam = F.ming(700);
  private baseDrawn = false;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT + song.title + (this.msg ? signature(this.msg.name) : '') + lyrics.linesIn(s, e).map((l) => l.text).join(''));
    const g = (this.g = grid(au, s, e));
    // 留言在第一拍（鏡頭轉到位的同時）印上去；營養素從同一拍起一拍一列（兩小節的窗格也一定填得完）
    this.tMsg = g.b0;
    this.rowT = stagger(au, g.b0, ROWS.length, Math.min(4 * g.beat, Math.max(g.beat, e - g.b0 - 1.2)));
    const after = this.rowT[ROWS.length - 1]! + 0.4;
    const nextBar = (t: number) => g.bars.find((b) => b >= t) ?? Infinity;
    this.tCircle = nextBar(after);
    if (this.tCircle > e - 0.5) this.tCircle = Math.min(after + g.beat, e - 0.6);
    this.tBadge = nextBar(this.tCircle + 0.3);
    if (this.tBadge > e - 0.6) this.tBadge = Infinity;
    if (this.msg) this.fit = fitMsg(this.live.ctx, this.msg.text, this.fam, MSG.w, MSG.h, { min: 56, max: 116, lineHeight: 1.2, maxLines: 3 });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, R = this.rig;
    // ---- 1. 展開圖
    this.printPass.render(renderer, R.doc);
    if (!this.baseDrawn) { this.drawBase(); this.baseDrawn = true; }
    comp.draw(renderer, this.base.texture, R.doc);
    const L = this.live; L.clear();
    const c = L.ctx;
    this.drawLyric(c, t);
    this.drawRows(c, t);
    this.drawMessage(c, t);
    this.drawCircle(c, t);
    this.drawBadge(c, t);
    comp.draw(renderer, L.upload(), R.doc);
    // ---- 2. 舞台
    this.shoot(t);
    R.st.render(renderer, out);
    const hit = this.tBadge < Infinity ? pulse(t, this.tBadge + 0.12, 0.06) : 0;
    return { paper: 1, bloom: 0.3, vignette: 0.3, grain: 0.04, shake: [hit * 5, -hit * 3] };
  }

  /** 展開圖上正面的一點 → 世界座標（盒子轉了一點點）。 */
  private world(u: number, v: number, z = BT): V3 {
    const r = this.rig.box.rotation.z, x = u - LW / 2, y = LH / 2 - v;
    return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r), z];
  }

  private shoot(t: number) {
    const R = this.rig, st = R.st, g = this.g, s = this.ctx.start, e = this.ctx.end;
    const D = camDist(30);
    // 開場：貼近右前方的盒角、低一點；第一拍 outExpo 轉到正面偏右（盒子在畫面偏左，右下角留給 QR），
    // 之後慢慢推向成分欄；每個小節線頂一下
    const k = ease.outExpo(clamp((t - s) / Math.max(0.3, g.b0 - s + 0.5)));
    const push = ease.inOutCubic(clamp((t - g.b0) / Math.max(1, e - g.b0)));
    const bi = lastIdx(g.bars, t);
    const bump = bi >= 0 && g.bars[bi]! > g.b0 + 0.3 ? pulse(t, g.bars[bi]!, 0.14) : 0;
    const aim = { x: lerp(LW * 0.84, LW * 0.62, k), y: lerp(LH * 0.5, LH * 0.6 + 20 * push, k) };
    const T = this.world(aim.x, aim.y);
    const dist = D * lerp(0.8, 1.26, k) * (1 - 0.07 * push) * (1 - 0.012 * bump);
    const tilt = THREE.MathUtils.degToRad(lerp(44, 27, k));
    const yaw = lerp(0.4, 0.13, k);
    st.look([T[0] + Math.sin(yaw) * dist, T[1] - Math.sin(tilt) * dist * Math.cos(yaw), Math.cos(tilt) * dist], T);
    // 焦點：開場在歌詞（表頭那一格），留言印上去的時候拉到成分欄；光圈小：桌巾與盒子遠端微微失焦
    const fk = ease.inOutCubic(clamp((t - this.tMsg) / 0.5));
    const fl = st.depthOf(this.world(LW * 0.4, LYR.y + LYR.h / 2)), fm = st.depthOf(this.world(MSG.x + MSG.w * 0.45, MSG.y + MSG.h * 0.4));
    st.U.focus.value = lerp(fl, fm, fk);
    st.U.aperture.value = 36;
    st.U.pool.value.set(-300, 200, 1800, 0.55);
    const c0 = this.world(LW / 2, LH / 2, 0);
    st.shadows([{ x: c0[0] + 60, y: c0[1] - 70, w: LW + 40, h: LH + 40, rot: R.box.rotation.z, blur: 70, k: 0.4, r: 20 }, { x: c0[0] + 8, y: c0[1] - 10, w: LW + 4, h: LH + 4, rot: R.box.rotation.z, blur: 10, k: 0.35, r: 4 }]);
  }

  // ------------------------------------------------------------ 不會變的底圖
  private drawBase() {
    const c = this.base.ctx;
    this.base.clear();
    c.textBaseline = 'alphabetic';
    const ink = rgba('sepia');
    // 標示的框（粗）
    c.strokeStyle = ink; c.lineWidth = 5;
    c.strokeRect(LB.x + 2.5, LB.y + 2.5, LB.w - 5, LB.h - 5);
    // 標題列：小小的（配角）；標題下面一行「每一份量：1 句歌詞」（冷面：所以下面那一格就是歌詞）
    c.font = font(F.hei(900), 26); c.fillStyle = ink;
    c.fillText('營養標示', X0, TITLE_Y);
    const tw = c.measureText('營養標示').width;
    c.font = font(F.mono(600), 14); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText('NUTRITION FACTS', X0 + tw + 18, TITLE_Y - 2);
    c.letterSpacing = '0px';
    c.fillStyle = ink; c.fillRect(X0, RULE1, X1 - X0, 2);
    c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.65);
    c.fillText('每一份量：1 句歌詞', X0, SERV_Y);
    // 粗線
    c.fillStyle = ink;
    c.fillRect(X0, BAR1, X1 - X0, 12);
    c.font = font(F.hei(700), 22);
    ROWS.forEach((r, i) => {
      const y = ROW0 + i * RH;
      c.fillStyle = rgba('sepia', 0.9);
      c.fillText(r.k, X0, y + 28);
      c.fillStyle = rgba('sepia', 0.3);
      if (i < ROWS.length - 1) c.fillRect(X0, y + RH - 1, X1 - X0, 1);
    });
    c.fillStyle = ink;
    c.fillRect(X0, BAR2, X1 - X0, 8);
    c.font = font(F.hei(900), 20);
    c.fillText('成分', X0, ING_Y);
    c.font = font(F.mono(500), 14); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText('INGREDIENTS', X0 + 52, ING_Y - 1);
    c.letterSpacing = '0px';
    // 前側（朝鏡頭的那一面）：品名與淨重（小）、條碼
    c.font = font(F.hei(900), 22); c.fillStyle = rgba('sepia', 0.7);
    c.fillText('婚禮特調', 60, LH + 80);
    c.font = font(F.mono(500), 14); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText('NET WT. ∞　·　保存期限：永久', 60, LH + 112);
    c.letterSpacing = '0px';
    // 條碼（裝飾）
    for (let i = 0; i < 46; i++) {
      const w = 1 + Math.floor(hash(i, 3) * 3.2);
      if (hash(i, 7) < 0.3) continue;
      c.fillStyle = rgba('sepia', 0.7);
      c.fillRect(LW - 300 + i * 5.2, LH + 50, w, 110);
    }
  }

  // ------------------------------------------------------------ 歌詞（每一份量 = 1 句）
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = layoutRows(c, ly.line, LY);
      const top = LYR.y + (LYR.h - lay.height) / 2 + lay.size * 0.84;
      c.save(); c.translate(X0, top);
      drawRows(c, lay, LY.family, t, paperInk(), ly.k);
      c.restore();
      return;
    }
    // 間奏／純音樂：寫歌名（淡），旁邊一行冷面的小字
    c.save();
    c.font = font(F.archivo(100, 800), 62); c.fillStyle = rgba('sepia', lyrics.has ? 0.28 : 0.8);
    const title = song.title || '本日特調';
    c.fillText(title, X0, LYR.y + 90);
    const w = Math.min(c.measureText(title).width, 820);
    c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.55);
    c.fillText(lyrics.has ? '（間奏中）' : '（純音樂・無添加歌詞）', X0 + w + 22, LYR.y + 88);
    c.restore();
  }

  // ------------------------------------------------------------ 營養素：拉霸數字＋長條
  private drawRows(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    ROWS.forEach((r, i) => {
      const t0 = this.rowT[i]!;
      if (t < t0 - 0.02) return;
      const y = ROW0 + i * RH, base = y + 28;
      const roll = prog(t, t0, t0 + Math.min(0.42, this.g.beat * 0.9));
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia');
      const uw = r.unit ? c.measureText(r.unit).width + 6 : 0;
      if (r.unit) c.fillText(r.unit, COL_V - uw + 6, base);
      this.reel(c, r.v, COL_V - uw, base, roll, i);
      const pu = prog(t, t0 + 0.08, t0 + 0.45, ease.outExpo);
      c.font = font(r.pct === Infinity ? F.hei(900) : F.archivo(100, 700), 20);
      c.fillStyle = r.pct >= 200 ? rgba('blood') : rgba('sepia');
      c.textAlign = 'right';
      c.globalAlpha = clamp(pu * 3);
      c.fillText(r.pctText, COL_P, base);
      c.globalAlpha = 1; c.textAlign = 'left';
      // 長條：100% = BAR_100；200% 衝破標示的框到盒緣、∞ 繞過盒角一路跑到側面的另一邊（大鼓時再往前頂一點）
      const kick = r.pct === 200 ? 6 * au.hit('kick', t, 0.1) : 0;
      const full = r.pct === Infinity ? AW - BAR_X : (r.pct / 100) * BAR_100;
      const len = full * prog(t, t0 + 0.06, t0 + (r.pct === Infinity ? 0.8 : 0.45), ease.outExpo) + (pu >= 1 ? kick : 0);
      if (len > 0.5) {
        c.fillStyle = r.pct >= 200 ? rgba('blood', 0.92) : rgba('sepia', 0.78);
        c.fillRect(BAR_X, y + 11, len, RH - 22);
      }
      if (r.pct === Infinity && len > LW - BAR_X) {
        c.font = font(F.hei(700), 18); c.fillStyle = rgba('blood'); c.textAlign = 'right';
        c.fillText('超出量表 →', X1, y + RH + 30);
        c.textAlign = 'left';
      }
    });
  }

  /** 拉霸：u = 0..1 的轉動進度，停在 target。 */
  private reel(c: CanvasRenderingContext2D, target: string, right: number, base: number, u: number, row: number) {
    c.font = font(F.archivo(100, 800), 25);
    c.fillStyle = rgba('sepia');
    c.textAlign = 'right';
    if (u >= 1) { c.fillText(target, right, base); c.textAlign = 'left'; return; }
    const chars = Array.from(target === '∞' ? '0' : target);
    const cw = c.measureText('0').width;
    const cellH = 30;
    c.save();
    c.beginPath(); c.rect(right - cw * chars.length - 4, base - 26, cw * chars.length + 8, cellH + 2); c.clip();
    chars.forEach((_, k) => {
      const x = right - (chars.length - 1 - k) * cw;
      // 越右邊的位數轉越多圈，停下來時 outCubic（像機械的減速）
      const q = (1 - ease.outCubic(u)) * (10 + 5 * k + 3 * row);
      const n = Math.floor(q), fr = q - n;
      const glyph = (m: number) => (m === 0 ? (target === '∞' ? '∞' : chars[k]!) : String(Math.floor(hash(m, k, row) * 10)));
      c.fillText(glyph(n), x, base + fr * cellH);
      c.fillText(glyph(n + 1), x, base + (fr - 1) * cellH);
    });
    c.restore();
    c.textAlign = 'left';
  }

  // ------------------------------------------------------------ 成分（主打留言，焦點）
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg;
    const t0 = this.tMsg;
    if (t < t0) return;
    if (m && this.fit) {
      const fit = this.fit;
      const top = MSG.y + fit.size * 0.9 + Math.max(0, (MSG.h - fit.height) * 0.3);
      // 印刷滾筒：一行一行由左往右印上去
      fit.lines.forEach((ln, i) => {
        const a = t0 + i * 0.09, u = prog(t, a, a + 0.26, ease.outCubic);
        if (u <= 0) return;
        c.save();
        c.beginPath(); c.rect(MSG.x - 10, top + i * fit.lineHeight - fit.size * 1.05, (MSG.w + 20) * u, fit.size * 1.4); c.clip();
        drawFit(c, { ...fit, lines: [ln] }, this.fam, MSG.x, top + i * fit.lineHeight, { color: rgba('sepia') });
        c.restore();
      });
      const ts = t0 + fit.lines.length * 0.09 + 0.3;
      const ka = prog(t, ts, ts + 0.3);
      if (ka > 0) {
        c.save(); c.globalAlpha = ka;
        c.font = font(F.hand(700), 48); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'right';
        // 署名永遠在最後一行下面（MSG 的高度已經扣掉署名）
        c.fillText(`${signature(m.name)}${m.couple ? '（新人）' : ''}`, X1, top + (fit.lines.length - 1) * fit.lineHeight + SIG);
        c.restore();
      }
      return;
    }
    // 沒有留言：成分欄是空的，一句邀請
    const u = prog(t, t0, t0 + 0.3);
    c.save(); c.globalAlpha = u;
    c.font = font(F.hand(700), 76); c.fillStyle = rgba('sepia', 0.9);
    c.fillText('你的祝福（尚未添加）', MSG.x, MSG.y + 84);
    c.font = font(F.hand(700), 46); c.fillStyle = rgba('sepia', 0.66);
    c.fillText('掃描右下角 QR code，把你的祝福加進成分表', MSG.x, MSG.y + 160);
    c.restore();
  }

  // ------------------------------------------------------------ 紅筆圈起來
  private drawCircle(c: CanvasRenderingContext2D, t: number) {
    const u = prog(t, this.tCircle, this.tCircle + 0.36, ease.outCubic);
    if (u <= 0) return;
    const y = ROW0 + 1 * RH + RH / 2 - 3;
    const cx = COL_V - 40, rx = 78, ry = 20;
    c.save();
    c.strokeStyle = rgba('blood', 0.9); c.lineWidth = 3.5; c.lineCap = 'round';
    c.beginPath();
    const N = 60, turns = 1.1 * u;
    for (let i = 0; i <= N; i++) {
      const k = i / N, a = -2.6 + k * turns * Math.PI * 2;
      // 手畫的圈：半徑慢慢變、頭尾不接在一起（第二圈稍微大一點）
      const w = 1 + 0.04 * Math.sin(k * 9.0) + 0.07 * k;
      const px = cx + Math.cos(a) * rx * w, py = y + Math.sin(a) * ry * w;
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.stroke();
    c.restore();
  }

  // ------------------------------------------------------------ 甜度貼紙（貼在盒子側面）
  private drawBadge(c: CanvasRenderingContext2D, t: number) {
    if (t < this.tBadge) return;
    const u = t - this.tBadge;
    // 從很大的地方拍下去（inQuad），碰到之後稍微彈一下
    const drop = clamp(u / 0.12);
    const sc = drop < 1 ? lerp(2.2, 1, ease.inQuad(drop)) : 1 + 0.06 * Math.exp(-(u - 0.12) * 14) * Math.sin((u - 0.12) * 40);
    c.save();
    c.globalAlpha = clamp(drop * 2);
    c.translate(BADGE.x, BADGE.y); c.rotate(-0.2); c.scale(sc, sc);
    c.beginPath();
    for (let i = 0; i <= 56; i++) {
      const a = (i / 56) * Math.PI * 2, r = BADGE.r * (i % 2 ? 0.91 : 1);
      if (i) c.lineTo(Math.cos(a) * r, Math.sin(a) * r); else c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fillStyle = rgba('blood', 0.94); c.fill();
    c.strokeStyle = rgba('paper', 0.85); c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, BADGE.r * 0.78, 0, Math.PI * 2); c.stroke();
    c.fillStyle = rgba('paper');
    c.textAlign = 'center';
    c.font = font(F.hei(900), 24); c.fillText('甜度', 0, -18);
    c.font = font(F.archivo(100, 900), 42); c.fillText('200%', 0, 26);
    c.restore();
  }
}
