// 營養標示（批次 T4・紙本 D，亮）：超市貨架上的一盒「婚禮特調」，正面印著一張營養標示；鏡頭平平地站在貨架前，
// 稍微偏右（看得到盒子的右側），左邊是別的商品、下面是貨架的價格條與一張會晃的「新品」吊牌，後面是洞洞板。
//  - 焦點是「成分」欄：主打留言印成成分（思源宋體、大），署名在後面。
//  - 「每一份量：1 句歌詞」——所以表頭下面那一大格就是現在唱的那一句（中等大小，逐字跟唱）。
//  - 營養素一拍一列填上去（小字）：數字像拉霸一樣轉、停在拍點上；每日參考值的長條長出來，
//    「甜度 200%」衝破標示的框、「心動」一路衝過盒子的邊角、繞到側面去（冷面：超出量表）。
//  - 列都填完的下一個小節線，紅筆圈起「200」；再下一個小節線，盒子側面「啪」地貼上一張甜度貼紙。
//  - 鏡頭：開場貼近盒角，第一拍 outExpo 轉到正面偏右的位置，之後像推著購物車經過一樣沿著貨架慢慢滑、慢慢推近；
//    焦點在留言上（景深），後面的洞洞板與旁邊的商品微微失焦。每一拍「新品」吊牌被大鼓震得晃一下；日光燈偶爾閃一下。
// 畫法：盒子的三個面（正面、右側、前側）攤開成一張展開圖畫進同一張 render target（所以長條可以從正面直接畫到側面，
// 在盒角自然折過去）：紙板雲紋與網點印刷一個 shader，框線與標籤一張不會變的 Canvas，會動的東西第二張 Canvas。
// 盒子是三個面的網格，交給 _t4 的舞台拍：舞台的「桌面」在這裡當作直立的洞洞板（世界的 y 向上、z 朝鏡頭），
// 貨架層板、旁邊的商品是方塊，價格條與吊牌是 Canvas 畫的道具。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, noise1 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, lyricSubOf, subGap, subSizeFor, signature } from './_motifs';
import { grid, stagger, drawFit, layoutRows, drawRows, paperInk, lastIdx, Stage, docRT, camDist, type Grid, type RowsStyle, type V3 } from './_t4';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'doc', paper: true, energy: [0.3, 0.9], bars: [4, 8] };

// ---------------------------------------------------------------- 盒子的展開圖（像素，左上原點、y 向下）
// 正面 LW × LH 在左上；右側 BT 寬、接在正面右邊；前側 BT 高、接在正面下面（右下角那塊沒用到）。
const LW = 1320, LH = 920, BT = 220;
const AW = LW + BT, AH = LH + BT;
const LB = { x: 36, y: 36, w: LW - 72, h: LH - 72 }; // 營養標示的白底
const X0 = LB.x + 32, X1 = LB.x + LB.w - 32;
const TITLE_Y = 96, RULE1 = 112, SERV_Y = 142;
const LYR = { y: 154, h: 142 };
const BAR1 = 306;
const ROW0 = 322, RH = 34, NROW = 5; // 營養素的列窄一點：成分欄（留言）要有四行＋署名的高度
const BAR2 = ROW0 + NROW * RH + 8;
const ING_Y = BAR2 + 40;
// v2：成分欄（留言）只佔標示的左邊一塊（畫面上 ≤ 860 寬），右邊是一個會跳的「心動指數」錶
// 成分欄（留言）用標示的整個寬度：盒子斜著拍、畫面上會縮小，留言要夠寬才能少幾行、字不會小於 40 px；下面留 44，署名不壓到外框
const MSG = { x: X0, y: ING_Y + 14, w: X1 - X0, h: LB.y + LB.h - 44 - (ING_Y + 14) };
// 心動指數的錶：放在歌詞那一格的右邊（半圓的底貼著粗線）
const GAUGE = { x: X1 - 110, y: LYR.y + LYR.h - 14, r: 84 };
const SIG_K = 1.45; // 署名佔的高度 = 署名字級 × SIG_K
const COL_V = 600, COL_P = 730; // 每份（靠右）、百分比（靠右）
const BAR_X = 760, BAR_100 = 300; // 長條：100% 的長度
const BADGE = { x: LB.x + LB.w - 30, y: 96, r: 84 }; // 貼在標示右上角（一半超出框）


interface Row { k: string; v: string; unit: string; pct: number; pctText: string }
const ROWS: Row[] = [
  { k: '熱量', v: '520', unit: '大卡', pct: 26, pctText: '26 %' },
  { k: '甜度', v: '200', unit: '%', pct: 200, pctText: '200 %' },
  { k: '心動', v: '∞', unit: '', pct: Infinity, pctText: '超出量表' },
  { k: '耐心', v: '1', unit: '輩子', pct: 100, pctText: '100 %' },
  { k: '鈉（吵架）', v: '0', unit: '毫克', pct: 0, pctText: '0 %' },
];
// 符號（♪ ∞ ☑ → 之類）不在打包時掃的中文範圍裡，要跟中文一起預載，不然第一次畫會用備援字型（確定性也會不過）
const TEXT = '♪∞☑☐→·—♥%＄$營養標示婚禮特調每一份量句歌詞本包裝含人份每份每日參考值百分比成分過敏原資訊本產品含有大量的愛保存期限永久開封後請與身邊的人分享淨重一輩子你的祝福尚未添加掃描右下角把加進成分表純音樂無添加間奏中超出量表甜度熱量大卡心動耐心輩子鈉吵架毫克';

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

/** 貨架前緣的價格條（2048×96）與「新品」吊牌（256×256），畫一次、整晚共用。 */
function drawShelfArt(rail: CanvasRenderingContext2D, tag: CanvasRenderingContext2D) {
  rail.fillStyle = mixRgba('paper', 'signal', 0.3); rail.fillRect(0, 0, 2048, 96);
  rail.fillStyle = rgba('sepia', 0.18); rail.fillRect(0, 0, 2048, 6); rail.fillRect(0, 90, 2048, 6);
  // 價格標籤：白底小卡，品名、價格（冷面：∞）
  const label = (x: number, name: string, price: string, note: string) => {
    rail.fillStyle = rgba('paper'); rail.fillRect(x, 14, 300, 68);
    rail.strokeStyle = rgba('sepia', 0.3); rail.lineWidth = 1.5; rail.strokeRect(x, 14, 300, 68);
    rail.textBaseline = 'alphabetic';
    rail.font = font(F.hei(700), 20); rail.fillStyle = rgba('sepia', 0.85); rail.fillText(name, x + 14, 42);
    rail.font = font(F.hei(500), 14); rail.fillStyle = rgba('sepia', 0.6); rail.fillText(note, x + 14, 68);
    rail.font = font(F.archivo(100, 900), 34); rail.fillStyle = rgba('blood'); rail.textAlign = 'right'; rail.fillText(price, x + 288, 66); rail.textAlign = 'left';
  };
  label(420, '幸福餅乾', '$ 520', '每盒兩人份');
  label(1010, '婚禮特調', '$ ∞', '每人限購一輩子');
  // 吊牌：一張圓形的卡（訊號色），上面兩個字
  tag.fillStyle = rgba('signal'); tag.beginPath(); tag.arc(128, 128, 118, 0, Math.PI * 2); tag.fill();
  tag.strokeStyle = rgba('paper', 0.9); tag.lineWidth = 4; tag.beginPath(); tag.arc(128, 128, 100, 0, Math.PI * 2); tag.stroke();
  tag.fillStyle = rgba('paper'); tag.textAlign = 'center'; tag.textBaseline = 'alphabetic';
  tag.font = font(F.hei(900), 64); tag.fillText('新品', 128, 138);
  tag.font = font(F.hei(700), 24); tag.fillText('限時 ∞ 天', 128, 182);
}

/** 貨架：下層板（盒子站在上面）、上層板的邊、左邊兩盒別的商品。世界：y 向上、z 朝鏡頭；盒子的底在 y = -LH/2。 */
const SHELF = { y: -LH / 2, depth: BT + 170, top: LH / 2 + 150 };
const NEIGHBORS = [
  { x: -LW / 2 - 330, w: 460, h: 700, c: 'mix(C_PAPER, C_BLOOD, 0.3)' },
  { x: -LW / 2 - 830, w: 440, h: 860, c: 'mix(C_PAPER, C_SIGNAL, 0.45)' },
];

function makeRig() {
  const doc = docRT(AW, AH);
  // 超市貨架：舞台的「桌面」當作直立的洞洞板；日光燈從上方均勻地打（光圈大、很淡）
  const st = new Stage(6, 30);
  st.U.ambient.value = 0.78;
  st.U.poolFloor.value = 0.75;
  const mat = st.docMaterial(doc.texture, [doc.width, doc.height], [AW, AH], { edge: 0, depthTest: true });
  const box = new THREE.Mesh(boxGeometry(), mat);
  box.frustumCulled = false;
  st.scene.add(box);
  // 層板（下層：盒子站在上面；上層：畫面頂端看得到它的前緣）
  const plankMat = st.solidMaterial('mix(C_PAPER, C_ASH, 0.25) * (0.95 + 0.02 * snoise(p / 60.0) * detail)');
  const plank = (y: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(6000, 36, SHELF.depth), plankMat); m.position.set(0, y - 18, SHELF.depth / 2); m.frustumCulled = false; st.scene.add(m); };
  plank(SHELF.y); plank(SHELF.top);
  // 旁邊的商品：簡單的盒子，正面有幾條色帶（不要搶戲）
  for (const n of NEIGHBORS) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(n.w, n.h, BT), st.solidMaterial(`${n.c} * (0.86 + 0.1 * step(0.5, fract(p.y / 140.0)) * detail)`));
    m.position.set(n.x, SHELF.y + n.h / 2, BT / 2); m.frustumCulled = false; st.scene.add(m);
  }
  // 價格條（貼在下層板的前緣）與吊牌
  const rail = new Layer2D(2048, 96, SCALE, { fast: true }), tagL = new Layer2D(256, 256, SCALE, { fast: true });
  drawShelfArt(rail.ctx, tagL.ctx);
  st.prop(rail.texture, [rail.canvas.width, rail.canvas.height], [0, 0, 1, 1], 3200, 150, -500, SHELF.y - 60, SHELF.depth + 2);
  const tag = st.prop(tagL.texture, [tagL.canvas.width, tagL.canvas.height], [0, 0, 1, 1], 180, 180, -LW / 2 - 170, SHELF.y - 30, SHELF.depth + 90);
  tag.renderOrder = 5; // 吊牌在價格條前面（透明物件照距離排序會排錯）
  const repaint = () => { rail.clear(); tagL.clear(); drawShelfArt(rail.ctx, tagL.ctx); rail.upload(); tagL.upload(); };
  return { doc, st, mat, box, tag, repaint };
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
  /** 成分欄、歌詞那一格在畫面上是盒面的幾倍（鏡頭停好時量的），v2 的字級要換算。 */
  sMsg = 0.8; sLyr = 0.75;
  msgScreen: number | null = null;
  sigSize = 36;
  /** 每兩個小節線「重新計算」一次：數字再轉一次。 */
  reroll: number[] = [];
  /**
   * 韓文歌有原文副行時「歌詞那一格」多出來的高度：粗線以下（營養素、成分欄）整塊往下挪這麼多。
   * 雙語（2026-09-30）：有主打留言也有原文，成分欄（留言）往下挪之後高度少 subRoom，留言照少掉的高度排（字級還在 v2 範圍），署名不會被擠出標籤；
   * 沒有副行是 0，版面跟原本一樣。
   */
  subRoom = 0;
  /** 署名跟留言最後一行同一排（有原文、成分欄比較矮的時候）。 */
  sigInline = false;
  private baseDrawn = false;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.subRoom = lyrics.linesIn(s, e).some((l) => lyricSubOf(l)) ? 72 : 0;
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
    this.reroll = g.bars.filter((b, i) => i % 2 === 0 && b > after + g.bar * 0.8 && b < e - 0.5);
    // 鏡頭停好的位置先擺一次，量成分欄與歌詞在畫面上的縮放
    this.look(1, 0, 0);
    const st = this.rig.st;
    const scaleAt = (u: number, v: number) => { const a = st.toScreen(this.world(u, v)), b = st.toScreen(this.world(u + 100, v)); return Math.hypot(b.x - a.x, b.y - a.y) / 100; };
    this.sMsg = scaleAt(MSG.x + MSG.w / 2 - 50, MSG.y + MSG.h / 2);
    this.sLyr = scaleAt(X0 + 400, LYR.y + LYR.h / 2);
    // v2：留言字級照螢幕標準（依字數 40～60）換成盒面字級；可用高度先扣掉署名，照子句斷行
    if (this.msg) {
      const c = this.live.ctx, S = this.sMsg, maxS = msgMaxFor(this.msg.text);
      const boxH = MSG.h - this.subRoom - (sigV2(maxS) / S) * SIG_K;
      const opt = { min: V2.msgMin / S, max: maxS / S, lineHeight: 1.22, maxLines: 5 };
      const fitIn = (h: number) => {
        const byW = fitText(c, this.msg!.text, this.fam, MSG.w, h, opt);
        const byC = fitClauses(c, this.msg!.text, this.fam, MSG.w, h, opt);
        return byC && byC.size >= byW.size * 0.9 ? byC : byW;
      };
      this.fit = fitIn(boxH);
      // 有原文（成分欄少了 subRoom）：先試「署名跟最後一行同一排、靠右」，留言就不用再讓出署名那一排的高度
      if (this.subRoom) {
        const f2 = fitIn(MSG.h - this.subRoom - 8);
        const sig2 = Math.round(sigV2(f2.size * S) / S);
        c.font = font(this.fam, f2.size);
        const lastW = c.measureText(f2.lines[f2.lines.length - 1] ?? '').width;
        c.font = font(F.hand(700), sig2);
        const sigW = c.measureText(`${signature(this.msg.name)}${this.msg.couple ? '（新人）' : ''}`).width;
        if (lastW + sigW + 40 <= MSG.w) { this.fit = f2; this.sigInline = true; }
      }
      this.msgScreen = this.fit.size * S;
      this.sigSize = Math.round(sigV2(this.msgScreen) / S);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, R = this.rig;
    // ---- 1. 展開圖
    this.printPass.render(renderer, R.doc);
  // 道具的畫布整晚共用，但顏色來自色票：每首歌換主題時要重畫（每個窗格第一格重畫一次，很小、很便宜）
    if (!this.baseDrawn) { this.drawBase(); R.repaint(); this.baseDrawn = true; }
    comp.draw(renderer, this.base.texture, R.doc);
    const L = this.live; L.clear();
    const c = L.ctx;
    this.drawLyric(c, t);
    // 粗線以下（跟錶一起坐在粗線上）：有原文副行時整塊往下挪
    c.save(); c.translate(0, this.subRoom);
    this.drawRows(c, t);
    this.drawMessage(c, t);
    this.drawCircle(c, t);
    this.drawGauge(c, t);
    c.restore();
    this.drawBadge(c, t);
    comp.draw(renderer, L.upload(), R.doc);
    // ---- 2. 舞台
    this.shoot(t);
    R.st.render(renderer, out);
    const hit = this.tBadge < Infinity ? pulse(t, this.tBadge + 0.12, 0.06) : 0;
    return { paper: 1, bloom: 0.3, vignette: 0.3, grain: 0.04, shake: [hit * 5, -hit * 3] };
  }

  /** 展開圖上正面的一點 → 世界座標（盒子正面朝鏡頭，y 向上）。 */
  private world(u: number, v: number, z = BT): V3 {
    return [u - LW / 2, LH / 2 - v, z];
  }

  /** 鏡頭：k = 開場進度（0 貼近盒角、1 停好），push = 慢慢推近，bump = 小節線頂一下。 */
  /** 鏡頭：站在貨架前（k = 開場進度，push = 慢慢推近，bump = 小節線頂一下，slide = 沿著貨架滑的量）。 */
  private look(k: number, push: number, bump: number, slide = 0) {
    const D = camDist(30);
    // 盒子在畫面偏左上，右下角的 QR 區留給洞洞板（乾淨）
    const aim = { x: lerp(LW * 0.84, LW * 0.66, k), y: lerp(LH * 0.5, LH * 0.62 + 20 * push, k) };
    const T = this.world(aim.x, aim.y, BT * 0.6);
    const dist = D * lerp(0.8, 1.32, k) * (1 - 0.06 * push) * (1 - 0.012 * bump);
    const pitch = THREE.MathUtils.degToRad(lerp(14, 6, k));
    const yaw = lerp(0.75, 0.5, k) + slide;
    this.rig.st.look([T[0] + Math.sin(yaw) * Math.cos(pitch) * dist, T[1] + Math.sin(pitch) * dist, T[2] + Math.cos(yaw) * Math.cos(pitch) * dist], T);
  }

  private shoot(t: number) {
    const R = this.rig, st = R.st, g = this.g, s = this.ctx.start, e = this.ctx.end;
    // 開場：貼近右前方的盒角、低一點；第一拍 outExpo 轉到正面偏右，之後慢慢推向成分欄；每個小節線頂一下
    const k = ease.outExpo(clamp((t - s) / Math.max(0.3, g.b0 - s + 0.5)));
    const push = ease.inOutCubic(clamp((t - g.b0) / Math.max(1, e - g.b0)));
    const bi = lastIdx(g.bars, t);
    const bump = bi >= 0 && g.bars[bi]! > g.b0 + 0.3 ? pulse(t, g.bars[bi]!, 0.14) : 0;
    // 像推著購物車經過：停好之後鏡頭沿著貨架很慢地往左滑（角度跟著變一點點），字不會歪到讀不了
    const slide = -0.08 * ease.inOutCubic(clamp((t - g.b0) / Math.max(2, e - g.b0))) * k;
    this.look(k, push, bump, slide);
    st.U.goboT.value = t;
    // 焦點：開場在歌詞（表頭那一格），留言印上去的時候拉到成分欄；光圈小：桌巾與盒子遠端微微失焦
    const fk = ease.inOutCubic(clamp((t - this.tMsg) / 0.5));
    const fl = st.depthOf(this.world(LW * 0.4, LYR.y + LYR.h / 2)), fm = st.depthOf(this.world(MSG.x + MSG.w * 0.45, MSG.y + MSG.h * 0.4));
    st.U.focus.value = lerp(fl, fm, fk);
    st.U.aperture.value = 24;
    // 日光燈：光很平均（光圈大、很淡）；每隔幾個小節燈管閃一下（很快的兩下暗）
    const flick = bi >= 0 && bi % 3 === 2 ? Math.max(pulse(t, g.bars[bi]! + 0.05, 0.03), pulse(t, g.bars[bi]! + 0.14, 0.03)) : 0;
    st.U.pool.value.set(-200, 600, 2600, 0.35 + 0.25 * flick);
    // 影子（落在洞洞板上，光從左上來）：盒子、旁邊的商品、層板下面一條
    const c0 = this.world(LW / 2, LH / 2, 0);
    st.shadows([
      { x: c0[0] + 50, y: c0[1] - 40, w: LW + 30, h: LH + 30, blur: 60, k: 0.32, r: 20 },
      ...NEIGHBORS.map((n) => ({ x: n.x + 50, y: SHELF.y + n.h / 2 - 40, w: n.w + 30, h: n.h + 30, blur: 60, k: 0.3, r: 20 })),
      { x: 0, y: SHELF.y - 110, w: 7000, h: 120, blur: 70, k: 0.35, r: 10 },
      { x: 0, y: SHELF.top - 110, w: 7000, h: 120, blur: 70, k: 0.3, r: 10 },
    ]);
    // 「新品」吊牌：每一拍被大鼓震一下、像彈簧片一樣左右晃，慢慢停
    const bt = this.ctx.audio.timeOfBeat(Math.floor(this.ctx.audio.beatAt(t) + 1e-6));
    const since = t - bt;
    R.tag.rotation.z = (0.18 * this.ctx.audio.hit('kick', bt + 0.01, 0.2) + 0.06) * Math.exp(-since * 5) * Math.sin(since * 22) + 0.03 * noise1(t * 0.8, 9);
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
    // 粗線以下：有原文副行時整塊往下挪（歌詞那一格多一排）
    c.save(); c.translate(0, this.subRoom);
    // 粗線
    c.fillStyle = ink;
    c.fillRect(X0, BAR1, X1 - X0, 12);
    c.font = font(F.hei(700), 22);
    ROWS.forEach((r, i) => {
      const y = ROW0 + i * RH;
      c.fillStyle = rgba('sepia', 0.9);
      c.fillText(r.k, X0, y + 25);
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
    c.restore();
    // 右側面（鏡頭看得到的那一面）：直排的品名、淨重、條碼
    // （「心動」的長條會在 y ≈ 450 橫過側面：字排在它上面、條碼在它下面）
    c.save(); c.translate(LW + BT / 2, 60); c.rotate(Math.PI / 2);
    c.font = font(F.hei(900), 40); c.fillStyle = rgba('sepia', 0.75);
    c.fillText('婚禮特調', 0, 12);
    c.font = font(F.mono(500), 13); c.letterSpacing = '2px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText('NET WT. ∞　·　保存期限：永久', 0, 52);
    c.letterSpacing = '0px';
    c.restore();
    for (let i = 0; i < 46; i++) {
      const w = 1 + Math.floor(hash(i, 3) * 3.2);
      if (hash(i, 7) < 0.3) continue;
      c.fillStyle = rgba('sepia', 0.7);
      c.fillRect(LW + 50, 560 + i * 5.2, 120, w);
    }
  }

  // ------------------------------------------------------------ 歌詞（每一份量 = 1 句）
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    // v2：歌詞比留言小一級（40～52 螢幕 px，換成盒面字級）
    const LY: RowsStyle = { family: F.archivo(100, 800), size: lyricV2(this.msgScreen) / this.sLyr, minSize: V2.lyrMin / this.sLyr, maxW: X1 - X0 - 250, maxRows: 2, lineHeight: 1.06 };
    if (ly) {
      const sub = lyricSubOf(ly.line);
      if (sub) {
        // 韓文歌：原文小一號印在中文正下方（同一格、同樣靠左），兩段一起在歌詞那一格（多一排高）裡垂直置中。
        // 格子的高度固定：放不下就把主行縮一點（最多縮幾次），不能印出粗線
        const H = LYR.h + this.subRoom - 8;
        let st = LY, lay = layoutRows(c, ly.line, st), sl = lay, gap = 0, total = 0;
        for (let k = 0; k < 8; k++) {
          const ss = subSizeFor(lay.size * this.sLyr) / this.sLyr;
          sl = layoutRows(c, sub, { family: LY.family, size: ss, minSize: Math.min(ss, 26 / this.sLyr), maxW: LY.maxW, maxRows: 2, lineHeight: 1.06 });
          gap = subGap(lay.size, sl.size);
          total = lay.height + gap + (sl.rows.length - 1) * sl.lineHeight + sl.size * 0.22;
          if (total <= H) break;
          st = { ...st, size: lay.size * 0.94, minSize: Math.min(st.minSize, lay.size * 0.94) };
          lay = layoutRows(c, ly.line, st);
        }
        const top = LYR.y + (H + 8 - total) / 2 + lay.size * 0.84;
        c.save(); c.translate(X0, top);
        drawRows(c, lay, LY.family, t, paperInk(), ly.k);
        c.translate(0, (lay.rows.length - 1) * lay.lineHeight + gap);
        // 原文比中文安靜：唱到、唱完都是淡兩成的墨色（不用 blood），還沒唱的照中文三成
        const ink = paperInk(), sung = rgba('sepia', 0.95 * 0.8);
        drawRows(c, sl, LY.family, t, { active: sung, sung, unsung: ink.unsung }, ly.k);
        c.restore();
        return;
      }
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
      const y = ROW0 + i * RH, base = y + 25;
      // 每兩個小節線「重新計算」一次：數字再轉一次（一列晚一點點，像一排拉霸依序停下）
      let rs = t0;
      for (const b of this.reroll) if (b + i * 0.07 <= t) rs = b + i * 0.07;
      const roll = prog(t, rs, rs + Math.min(0.42, this.g.beat * 0.9));
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
        c.fillRect(BAR_X, y + 9, len, RH - 18);
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
      const sigH = this.sigSize * SIG_K;
      const top = MSG.y + fit.size * 0.9 + Math.max(0, (MSG.h - this.subRoom - fit.height - (this.sigInline ? 0 : sigH)) * 0.3);
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
        c.font = font(F.hand(700), this.sigSize); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'right';
        // 署名永遠在最後一行下面（字級是扣掉署名的高度算的）：讓出下伸部再放署名
        const lastBase = top + (fit.lines.length - 1) * fit.lineHeight;
        c.fillText(`${signature(m.name)}${m.couple ? '（新人）' : ''}`, MSG.x + MSG.w, this.sigInline ? lastBase : lastBase + fit.size * 0.3 + this.sigSize * 1.05);
        c.restore();
      }
      return;
    }
    // 沒有留言：成分欄是空的，一句邀請
    const u = prog(t, t0, t0 + 0.3);
    c.save(); c.globalAlpha = u;
    const S = this.sMsg;
    c.font = font(F.hand(700), Math.round(56 / S)); c.fillStyle = rgba('sepia', 0.9);
    c.fillText('你的祝福（尚未添加）', MSG.x, MSG.y + 84);
    c.font = font(F.hand(700), Math.round(30 / S)); c.fillStyle = rgba('sepia', 0.66);
    c.fillText('掃描右下角 QR code，把你的祝福加進成分表', MSG.x, MSG.y + 150);
    c.restore();
  }

  // ------------------------------------------------------------ 心動指數（成分欄右邊的錶）
  /** 半圓的錶：指針一直頂在最右邊（超出量表），每一拍被大鼓頂一下、彈回來；小節線時整個錶面亮一下。 */
  private drawGauge(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, G = GAUGE;
    const k = prog(t, this.tMsg, this.tMsg + 0.5, ease.outCubic);
    if (k <= 0) return;
    c.save();
    c.globalAlpha = k;
    c.translate(G.x, G.y);
    // 刻度：0～100，最右邊一段是訊號色的暗部（「超出量表」）
    c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, G.r, Math.PI, 0); c.stroke();
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * Math.PI, l = i % 5 === 0 ? 18 : 10;
      c.lineWidth = i % 5 === 0 ? 3 : 1.6;
      c.beginPath(); c.moveTo(Math.cos(a) * G.r, Math.sin(a) * G.r); c.lineTo(Math.cos(a) * (G.r - l), Math.sin(a) * (G.r - l)); c.stroke();
    }
    c.strokeStyle = rgba('blood', 0.9); c.lineWidth = 9;
    c.beginPath(); c.arc(0, 0, G.r - 6, -0.42, 0); c.stroke();
    // 指針：過了滿刻度還往外頂（大鼓一下就多頂一點、彈簧似地回來），第一次出現時從 0 甩上去
    const bar = au.barAt(t), fl = 1 - clamp((bar - Math.floor(bar)) * 6);
    const up = ease.outBack(clamp((t - this.tMsg) / 0.6), 2.2);
    const ang = Math.PI + Math.PI * (up * 1.02) + 0.1 * au.hit('kick', t, 0.12) + 0.03 * Math.sin(t * 23) * up;
    c.strokeStyle = rgba('blood'); c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(ang) * (G.r - 14), Math.sin(ang) * (G.r - 14)); c.stroke();
    c.fillStyle = rgba('sepia'); c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('signal', 0.25 * fl); c.beginPath(); c.arc(0, 0, G.r + 10, Math.PI, 0); c.fill();
    c.textAlign = 'center';
    c.font = font(F.hei(700), 18); c.fillStyle = rgba('sepia', 0.85);
    c.fillText('心動指數', 0, -G.r - 34);
    c.font = font(F.hei(500), 15); c.fillStyle = rgba('blood', 0.9);
    c.fillText('超出量表', 0, -G.r - 14);
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
