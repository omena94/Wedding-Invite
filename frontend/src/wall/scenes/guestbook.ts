// 簽名簿（批次 T4・紙本 D，亮）：喜宴入口的簽名台，白色緹花桌巾上攤開的簽名簿，右上方擺著一束花（花瓣散在桌巾上），
// 左下角一排小蠟燭。
//  - 第一拍：右邊那頁（已經寫滿別人的祝福）翻過去——真的 3D 的紙：從書脊掀起來、外緣稍微落後彎成弧，蓋到左邊；
//    露出新的一頁。
//  - 仙女棒的火花是筆：在拍點上一個詞組一個詞組把主打留言寫在新的一頁上（剛寫的字是暖色的濕墨水，一下子乾成墨色），
//    寫完空半拍再簽名。這是畫面的焦點：最大、最清楚。
//  - 左頁的「書眉」是現在唱的那句歌詞（中等大小，逐字跟唱）；下面是前面的賓客寫的祝福（真的留言，小、淡，當背景）。
//  - 鏡頭：斜斜地拍整本簿子，寫字時鏡頭微微跟著筆尖、焦點在新的一頁上；寫完慢慢推近。
//  - 沒有留言：新的一頁寫「這一頁留給你」＋一句邀請。純音樂：書眉寫歌名。
// 畫法：兩張「跨頁」render target（舊的：翻頁前的左右頁；新的：翻頁後的左右頁，含書眉歌詞與正在寫的字、火花），
// 書本是 three.js 的網格：書皮、左右兩頁（靠書脊那邊往下彎）、一張翻動的頁（每格照翻頁進度算出彎曲的形狀，
// 正面貼舊的右頁、背面貼新的左頁）。花束、花瓣、蠟燭是 Canvas 畫的道具。交給 _t4 的舞台拍（緹花桌巾、燭光、景深、書溝的陰影）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, SCALE } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, type TextLayout } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, noise1 } from '../engine/util';
import { wrap, fitText, type FitResult } from '../engine/text';
import { lyricAt, signature, sparkHead, sparkParticles, fillWithHearts, heartPoints, lyricSubOf, subSizeFor, subGap } from './_motifs';
import type { Line } from '../engine/lyrics';
import { grid, layoutRows, drawRows, paperInk, Stage, docRT, camDist, type Grid, type RowsStyle, type P2, type V3 } from './_t4';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'doc', paper: true, energy: [0.15, 0.8], bars: [4, 8] };

// ---------------------------------------------------------------- 跨頁（像素，左上原點、y 向下；左頁 0..PW、右頁 PW..2PW）
const PW = 760, PH = 980, DW = PW * 2, DH = PH;
const MX = 64; // 頁邊
const HEAD = { x: MX, y: 104, w: PW - 2 * MX, h: 170 }; // 左頁的書眉（歌詞）
const ENTRY = { x: PW + MX + 6, y: 150, w: PW - 2 * MX - 12, h: 560 }; // 右頁：主打留言
const Z0 = 8, CURL_A = 24, CURL_K = 80; // 頁面的彎曲：靠書脊低、往外升起
const pageZ = (u: number) => Z0 + CURL_A * (1 - Math.exp(-u / CURL_K));
const COOL = 0.8; // 濕墨水乾掉要幾秒

const SIG_K = 1.5; // 署名佔的高度 = 署名字級 × SIG_K
// 符號（♪ ∞ ☑ → 之類）不在打包時掃的中文範圍裡，要跟中文一起預載，不然第一次畫會用備援字型（確定性也會不過）
const TEXT = '♪∞☑☐→·—♥%＄$芳名錄本頁背景音樂這一頁留給你掃描右下角把祝福寫進簽名簿純音樂間奏中第頁一位賓客新人';

// ---------------------------------------------------------------- 紙（shader）：很淡的橫線、纖維
const PAPER = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${DH}.0 - FRAG_PX.y);
    vec3 col = C_PAPER * (0.995 + 0.01 * fbm(p / 260.0, 3) + 0.006 * snoise(p / 6.0));
    float u = mod(p.x, ${PW}.0);
    float inText = step(${MX - 10}.0, u) * step(u, ${PW - MX + 10}.0) * step(300.0, p.y) * step(p.y, ${PH - 90}.0);
    float d = abs(mod(p.y - 300.0, 58.0) - 29.0);
    col = mix(col, C_BLOOD, pxLine(29.0 - d, 0.3, 1.1) * 0.07 * inText);
    fragColor = vec4(col, 1.0);
  }`);

// ---------------------------------------------------------------- 書本的網格
const NSEG = 48;
/** 一頁：side = +1 右頁、-1 左頁；uv 對到跨頁貼圖的那一半。外緣多一條往下的「頁緣」到書皮上。 */
function pageGeometry(side: 1 | -1, half: 0 | 1, mirror = false) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const cols: { x: number; z: number; u: number }[] = [];
  for (let i = 0; i <= NSEG; i++) { const u = (PW * i) / NSEG; cols.push({ x: side * u, z: pageZ(u), u }); }
  cols.push({ x: side * (PW + 0.5), z: 3.5, u: PW });
  if (side < 0) cols.reverse();
  for (const c of cols) {
    for (const y of [-PH / 2, PH / 2]) {
      pos.push(c.x, y, c.z);
      const f = c.u / PW; // 0 = 書脊、1 = 外緣
      const tu = half === 1 ? 0.5 + 0.5 * f : 0.5 - 0.5 * f;
      uv.push(mirror ? 1 - tu : tu, y > 0 ? 1 : 0);
    }
  }
  for (let i = 0; i + 1 < cols.length; i++) { const a = i * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** 翻動的那一頁：p = 0（平躺在右邊）… 1（平躺在左邊）。從書脊沿著頁面積分角度，外緣落後一點彎成弧。 */
function leafShape(p: number): { x: number; z: number }[] {
  const out = [{ x: 0, z: Z0 + 0.8 }];
  let x = 0, z = Z0 + 0.8;
  const ds = PW / NSEG, curl = -1.25 * Math.sin(Math.PI * p);
  for (let i = 0; i < NSEG; i++) {
    const s = (i + 0.5) * ds;
    const rest = Math.atan((CURL_A / CURL_K) * Math.exp(-s / CURL_K));
    const phi = lerp(rest, Math.PI - rest, p) + curl * (s / PW) * (0.6 + 0.4 * (s / PW));
    x += Math.cos(phi) * ds; z += Math.sin(phi) * ds;
    out.push({ x, z });
  }
  return out;
}
function leafGeometry(half: 0 | 1) {
  const pos = new Float32Array((NSEG + 1) * 2 * 3), uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= NSEG; i++) for (const y of [-PH / 2, PH / 2]) { const f = i / NSEG; uv.push(half === 1 ? 0.5 + 0.5 * f : 0.5 - 0.5 * f, y > 0 ? 1 : 0); }
  for (let i = 0; i < NSEG; i++) { const a = i * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function setLeaf(g: THREE.BufferGeometry, p: number) {
  const a = g.getAttribute('position') as THREE.BufferAttribute;
  const pts = leafShape(p);
  pts.forEach((q, i) => { a.setXYZ(i * 2, q.x, -PH / 2, q.z); a.setXYZ(i * 2 + 1, q.x, PH / 2, q.z); });
  a.needsUpdate = true;
  g.computeVertexNormals();
}

/** 簽名桌上的一排小蠟燭（俯視：金屬杯、蠟面、燭芯），火苗另外每格畫。 */
const CANDLES: [number, number][] = [[-640, -600], [-470, -650], [-300, -615]];
function drawTealight(c: CanvasRenderingContext2D) {
  const x = 64, y = 64, r = 60;
  const gr = c.createRadialGradient(x - 18, y - 18, 6, x, y, r);
  gr.addColorStop(0, rgba('bone')); gr.addColorStop(1, rgba('ash'));
  c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = mixRgba('paper', 'signal', 0.18); c.beginPath(); c.arc(x, y, r * 0.8, 0, Math.PI * 2); c.fill();
  c.strokeStyle = rgba('sepia', 0.25); c.lineWidth = 2; c.beginPath(); c.arc(x, y, r * 0.8, 0, Math.PI * 2); c.stroke();
  c.fillStyle = rgba('sepia', 0.85); c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
}

/** 一束花（俯視）：三朵重瓣的花（外圈紙色、內圈染一點訊號色）、葉子、滿天星；右下角另外畫三片散落的花瓣。 */
function drawFlowers(c: CanvasRenderingContext2D) {
  const rnd = (i: number, k: number) => hash(i, k, 77);
  // 葉子（墨色帶一點訊號色，像深綠的影子）
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd(i, 1), r = 150 + 40 * rnd(i, 2);
    c.save(); c.translate(256 + Math.cos(a) * r * 0.7, 256 + Math.sin(a) * r * 0.7); c.rotate(a);
    c.fillStyle = mixRgba('sepia', 'signal', 0.25, 0.85);
    c.beginPath(); c.ellipse(0, 0, 70, 22, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('paper', 0.25); c.lineWidth = 2; c.beginPath(); c.moveTo(-60, 0); c.lineTo(60, 0); c.stroke();
    c.restore();
  }
  // 滿天星：一顆顆小白點
  for (let i = 0; i < 70; i++) {
    const a = rnd(i, 3) * Math.PI * 2, r = 120 + 110 * rnd(i, 4);
    c.fillStyle = rgba('bone', 0.9);
    c.beginPath(); c.arc(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 4 + 3 * rnd(i, 5), 0, Math.PI * 2); c.fill();
  }
  // 三朵花：一圈一圈的花瓣，由外往內越小、越染色
  const bloom = (x: number, y: number, R: number, seed: number) => {
    for (let ring = 0; ring < 4; ring++) {
      const rr = R * (1 - ring * 0.22), n = 8 - ring, k = ring / 4;
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2 + ring * 0.4 + seed;
        c.save(); c.translate(x + Math.cos(a) * rr * 0.45, y + Math.sin(a) * rr * 0.45); c.rotate(a);
        c.fillStyle = mixRgba('paper', 'signal', 0.1 + 0.35 * k);
        c.strokeStyle = mixRgba('paper', 'blood', 0.35 + 0.3 * k, 0.8); c.lineWidth = 1.5;
        c.beginPath(); c.ellipse(0, 0, rr * 0.5, rr * 0.36, 0, 0, Math.PI * 2); c.fill(); c.stroke();
        c.restore();
      }
    }
    c.fillStyle = rgba('blood', 0.7); c.beginPath(); c.arc(x, y, R * 0.12, 0, Math.PI * 2); c.fill();
  };
  bloom(200, 220, 110, 0.3); bloom(320, 250, 95, 1.1); bloom(250, 340, 85, 2.0);
  // 散落的花瓣（另一塊，右下角 128×128 的格子裡）
  for (let i = 0; i < 3; i++) {
    c.save(); c.translate(560 + i * 150, 440); c.rotate(rnd(i, 9) * 3);
    c.fillStyle = mixRgba('paper', 'signal', 0.2); c.strokeStyle = mixRgba('paper', 'blood', 0.45, 0.8); c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(0, 0, 50, 34, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.restore();
  }
}
const FLOWERS = { x: 1100, y: 330, s: 520 };
const PETALS: [number, number, number][] = [[930, -60, 0.4], [1240, 40, 2.1], [860, 520, 1.3]];

function makeRig() {
  const oldRT = docRT(DW, DH), newRT = docRT(DW, DH);
  const st = new Stage(2, 30);
  // 環境：喜宴入口的簽名桌，光來自畫面外左下角的一排蠟燭（暖、會搖曳），其他地方比較暗
  st.U.ambient.value = 0.62;
  st.U.poolFloor.value = 0.42; st.U.poolWarm.value = 0.35;
  const tp: [number, number] = [newRT.width, newRT.height], dp: [number, number] = [DW, DH];
  const mOld = st.docMaterial(oldRT.texture, tp, dp, { edge: 0, depthTest: true });
  const mNew = st.docMaterial(newRT.texture, tp, dp, { edge: 0, depthTest: true });
  const mOldF = st.docMaterial(oldRT.texture, tp, dp, { edge: 0, depthTest: true, side: THREE.FrontSide });
  const mNewB = st.docMaterial(newRT.texture, tp, dp, { edge: 0, depthTest: true, side: THREE.BackSide });
  for (const m of [mOld, mNew, mOldF, mNewB]) (m.uniforms.gutter!.value as THREE.Vector3).set(0, 70, 0.3);
  // 書皮（布面，比頁面大一圈）
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(DW + 48, DH + 40), st.solidMaterial('mix(C_BLOOD, C_SEPIA, 0.55) * (0.55 + 0.08 * detail * snoise(p * 0.9) + 0.05 * fbm(p / 90.0, 2))'));
  cover.position.z = 3;
  const left = new THREE.Mesh(pageGeometry(-1, 0), mOld);
  const right = new THREE.Mesh(pageGeometry(1, 1), mNew);
  const leafF = new THREE.Mesh(leafGeometry(1), mOldF);
  const leafB = new THREE.Mesh(leafGeometry(0), mNewB);
  leafB.geometry.setAttribute('position', leafF.geometry.getAttribute('position'));
  const book = new THREE.Group();
  book.add(cover, left, right, leafF, leafB);
  for (const m of [cover, left, right, leafF, leafB]) m.frustumCulled = false;
  st.scene.add(book);
  const tl = new Layer2D(128, 128, SCALE, { fast: true });
  drawTealight(tl.ctx);
  for (const [x, y] of CANDLES) st.prop(tl.texture, [tl.canvas.width, tl.canvas.height], [0, 0, 1, 1], 110, 110, x, y, 2);
  const fl = new Layer2D(1024, 512, SCALE, { fast: true });
  drawFlowers(fl.ctx);
  const fp: [number, number] = [fl.canvas.width, fl.canvas.height];
  const bouquet = st.prop(fl.texture, fp, [0, 0, 0.5, 1], FLOWERS.s, FLOWERS.s, FLOWERS.x, FLOWERS.y, 20);
  const petals = PETALS.map(([x, y, r], i) => st.prop(fl.texture, fp, [0.47 + i * 0.146, 0.73, 0.14, 0.27], 90, 90, x, y, 1.5, r));
  const repaint = () => { tl.clear(); drawTealight(tl.ctx); tl.upload(); fl.clear(); drawFlowers(fl.ctx); fl.upload(); };
  return { oldRT, newRT, st, mOld, mNew, left, right, leafF, leafB, book, bouquet, petals, repaint };
}

interface Glyph { ch: string; x: number; y: number; w: number; t0: number; t1: number; size: number }

export default class Guestbook extends Scene {
  paper = shared('guestbook.paper', PAPER);
  rig = shared('guestbook.rig', makeRig);
  /** 翻頁前的跨頁：左右兩頁別人的祝福（畫一次）。 */
  oldL = this.track(new Layer2D(DW, DH, undefined, { fast: true }));
  /** 翻頁後的跨頁：左頁別人的祝福、右頁的頁首（畫一次）。 */
  newL = this.track(new Layer2D(DW, DH, undefined, { fast: true }));
  /** 每格重畫：書眉的歌詞、正在寫的字。 */
  live = this.track(new Layer2D(DW, DH, undefined, { fast: true }));
  spark = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  /** 燭火（畫面座標，加亮疊上去才會發光）。 */
  flames = this.track(new LineBatch(128, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  tTurn = 0; turnDur = 0.7;
  glyphs: Glyph[] = [];
  fit: FitResult | null = null;
  writeEnd = 0;
  private propsDrawn = false;
  /** 書頁、書眉在畫面上是跨頁的幾倍（鏡頭停好時量的），v2 的字級要換算。 */
  sEntry = 0.8; sHead = 0.8;
  /** 書眉的高度：有原文副行（韓文歌）的窗格長高一點（下面別人的祝福跟著往下排），放得下中文＋原文。 */
  headH = HEAD.h;
  msgScreen: number | null = null;
  /** 簽完名的下一個小節線：火花在署名旁邊畫一顆小愛心。 */
  tDoodle = Infinity;
  doodle: P2 = { x: 0, y: 0 };

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const others: Msg[] = ((this.ctx.params.messages ?? []) as Msg[]).filter((m) => !this.msg || m.id !== this.msg.id);
    await loadText(TEXT + song.title + (this.msg ? signature(this.msg.name) : '') + lyrics.linesIn(s, e).map((l) => l.text).join('') + others.map((m) => m.text + m.name).join(''));
    const g = (this.g = grid(au, s, e));
    this.tTurn = g.b0;
    this.turnDur = Math.min(0.75, g.beat * 1.5);
    // 寫字：翻完頁的下一拍開始，一個詞組（最多四個字、標點後斷開）落在一個格點上（一拍、半拍或四分之一拍，挑寫得完的最慢那種）
    const t0 = au.timeOfBeat(Math.ceil(au.beatAt(this.tTurn + this.turnDur) - 1e-6));
    const text = this.msg ? this.msg.text : '這一頁留給你';
    const fam = F.hand(700);
    // 鏡頭停好的位置先擺一次，量新的一頁與書眉在畫面上的縮放
    this.look(1, 0, null);
    const stg = this.rig.st;
    const scaleAt = (u: number, v: number) => { const a = stg.toScreen(this.world(u, v)), b = stg.toScreen(this.world(u + 100, v)); return Math.hypot(b.x - a.x, b.y - a.y) / 100; };
    this.sEntry = scaleAt(ENTRY.x + ENTRY.w / 2 - 50, ENTRY.y + 220);
    this.sHead = scaleAt(HEAD.x + HEAD.w / 2 - 50, HEAD.y + HEAD.h / 2);
    // 原文副行：書眉放不下中文＋原文就長高（最多到 290），別人的祝福照書眉的高度往下排（所以要等量完書眉的縮放才畫）
    for (const l of lyrics.linesIn(s - 1, e + 1)) {
      const d = this.headLay(this.live.ctx, l, this.headStyle());
      if (d?.sub) this.headH = Math.max(this.headH, Math.min(290, Math.ceil(d.blockH + 24)));
    }
    this.drawStatic(others);
    // v2：留言字級照螢幕標準（依字數 40～60）換成書頁字級；可用高度先扣掉署名，照子句斷行
    const S = this.sEntry, maxS = msgMaxFor(text);
    const boxH = Math.min(ENTRY.h, 430 / S) - (this.msg ? (sigV2(maxS) / S) * SIG_K : 0);
    const opt = { min: V2.msgMin / S, max: maxS / S, lineHeight: 1.3, maxLines: 7 };
    const byW = fitText(this.live.ctx, text, fam, ENTRY.w, boxH, opt);
    const byC = fitClauses(this.live.ctx, text, fam, ENTRY.w, boxH, opt);
    const fit = (this.fit = byC && byC.size >= byW.size * 0.9 && byC.lines.length <= byW.lines.length + 1 ? byC : byW);
    this.msgScreen = this.msg ? fit.size * S : null;
    const lays: TextLayout[] = fit.lines.map((ln) => layout(ln, fam, fit.size));
    const top = ENTRY.y + 40 + fit.size * 0.9;
    const flat: { ch: string; x: number; y: number; w: number }[] = [];
    lays.forEach((lay, li) => lay.glyphs.forEach((gl) => flat.push({ ch: gl.ch, x: ENTRY.x + gl.x, y: top + li * fit.lineHeight, w: gl.w })));
    const groups: number[][] = [];
    let cur: number[] = [];
    flat.forEach((gl, i) => {
      if (gl.ch === ' ') return;
      cur.push(i);
      if (cur.length >= 4 || /[，。！？!?,.、～~…♥]/.test(gl.ch) || flat[i + 1]?.y !== gl.y) { groups.push(cur); cur = []; }
    });
    if (cur.length) groups.push(cur);
    const perChar = 0.055;
    const budget = Math.max(0.6, Math.min(g.bar * 1.6, e - t0 - Math.max(1.5, flat.length / 6)));
    const longest = Math.max(...groups.map((gr) => gr.length)) * perChar;
    const stepB = [1, 0.5, 0.25].find((k) => (groups.length - 1) * k * g.beat + longest <= budget) ?? 0;
    const b0 = au.beatAt(t0);
    let tEnd = t0;
    groups.forEach((gr, k) => {
      const ts = stepB ? au.timeOfBeat(b0 + k * stepB) : t0 + (k * Math.max(0, budget - longest)) / Math.max(1, groups.length - 1);
      gr.forEach((i, j) => {
        const q = flat[i]!;
        this.glyphs.push({ ...q, t0: ts + j * perChar, t1: ts + (j + 1) * perChar, size: fit.size });
        tEnd = Math.max(tEnd, ts + (j + 1) * perChar);
      });
    });
    // 簽名：寫完空半拍
    const sigText = this.msg ? `${signature(this.msg.name)}${this.msg.couple ? '（新人）' : ''}` : '';
    if (sigText) {
      // 署名永遠在最後一行下面（字級是扣掉署名的高度算的）：讓出下伸部再放署名
      const ss = Math.round(sigV2(fit.size * S) / S), sl = layout(sigText, fam, ss);
      const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
      const sx = ENTRY.x + ENTRY.w - sl.width, sy = lastY + fit.size * 0.3 + ss * 1.1;
      this.doodle = { x: sx - ss * 1.1, y: sy - ss * 0.35 };
      const st0 = tEnd + g.beat * 0.5, per = Math.min(0.06, 0.8 / sl.glyphs.length);
      sl.glyphs.forEach((gl, j) => this.glyphs.push({ ch: gl.ch, x: sx + gl.x, y: sy, w: gl.w, t0: st0 + j * per, t1: st0 + (j + 1) * per, size: ss }));
      tEnd = st0 + sl.glyphs.length * per;
    }
    this.writeEnd = tEnd;
    // 小事件：簽完名的下一個小節線，火花在署名旁邊畫一顆小愛心
    const tb = g.bars.find((b) => b >= tEnd + 0.2);
    if (this.msg && tb !== undefined && tb < e - 0.8) this.tDoodle = tb;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, R = this.rig;
    // 道具的畫布整晚共用，但顏色來自色票：每首歌換主題時要重畫（每個窗格第一格重畫一次，很小、很便宜）
    if (!this.propsDrawn) { R.repaint(); this.propsDrawn = true; }
    const L = this.live; L.clear();
    const c = L.ctx;
    this.drawLyric(c, t);
    // 寫完之後，每兩個小節線有一陣風：左邊那頁的外緣掀起來一點點再落回去
    let turnP = ease.inOutCubic(clamp((t - this.tTurn) / this.turnDur));
    const gusts = this.g.bars.filter((b, i) => i % 2 === 1 && b > this.writeEnd + 0.3 && b <= t);
    if (gusts.length && turnP >= 1) { const u = clamp((t - gusts[gusts.length - 1]!) / 0.9); turnP = 1 - 0.045 * Math.sin(u * Math.PI) * (1 - u * 0.3); }
    // 舊的跨頁只在翻頁完成前看得到：那之前每格畫（書眉的歌詞要跟唱），之後就不用了
    if (turnP < 1) {
      this.paper.render(renderer, R.oldRT);
      comp.draw(renderer, this.oldL.texture, R.oldRT);
      comp.draw(renderer, L.upload(), R.oldRT);
    }
    const pen = this.drawWriting(c, t) ?? this.drawDoodle(c, t);
    this.paper.render(renderer, R.newRT);
    comp.draw(renderer, this.newL.texture, R.newRT);
    comp.draw(renderer, L.upload(), R.newRT);
    this.spark.clear();
    if (pen) {
      const p = pen;
      sparkParticles(this.spark, t, () => p, { rate: 90, life: 0.35, speed: 200, seed: 3, intensity: 0.8 });
      sparkHead(this.spark, p.x, p.y, t, 0.9, 0.9);
      this.spark.render(renderer, R.newRT);
    }
    setLeaf(R.leafF.geometry, turnP);
    R.leafB.geometry.setAttribute('normal', R.leafF.geometry.getAttribute('normal'));
    this.shoot(t, pen);
    R.st.render(renderer, out);
    this.drawFlames(renderer, out, t);
    return { paper: 1, bloom: 0.4, vignette: 0.3, grain: 0.04 };
  }

  /** 跨頁座標 → 世界（書本平放、書脊在 x = 0）。 */
  private world(u: number, v: number): V3 {
    const x = u - PW;
    return [x, PH / 2 - v, pageZ(Math.abs(x))];
  }

  /** 鏡頭位置：intro = 開場進度（0 貼近、1 停好），after = 寫完後慢慢推近，pen = 筆尖（鏡頭往那邊偏一點）。 */
  private look(intro: number, after: number, pen: P2 | null) {
    const D = camDist(30);
    // 看的點：書脊偏右（新的一頁），寫字時往筆尖偏一點；書本放在畫面偏左上，右下角的 QR 區留乾淨
    const px = pen ? lerp(PW * 1.3, pen.x, 0.12) : PW * 1.3;
    const T0 = this.world(px, PH * 0.5);
    const T: V3 = [T0[0] + 90 + 10 * after, T0[1] - 90 + 30 * after, 20];
    // 簽名簿佔大半個畫面，右上角留給花
    const dist = D * lerp(0.95, 1.24, intro) * (1 - 0.04 * after);
    const tilt = THREE.MathUtils.degToRad(lerp(40, 29, intro));
    const yaw = lerp(0.14, 0.04, intro);
    this.rig.st.look([T[0] + Math.sin(yaw) * dist, T[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T);
  }

  private shoot(t: number, pen: P2 | null) {
    const st = this.rig.st, g = this.g, s = this.ctx.start, e = this.ctx.end;
    const intro = ease.outExpo(clamp((t - s) / Math.max(0.3, this.tTurn + this.turnDur - s)));
    const after = ease.inOutCubic(clamp((t - this.writeEnd) / Math.max(1, e - this.writeEnd)));
    this.look(intro, after, pen);
    st.U.goboT.value = t;
    // 焦點在新的一頁與書眉之間偏新的一頁：歌詞也要清楚，只讓書本外面的桌巾與遠端失焦
    const fm = st.depthOf(this.world(ENTRY.x + ENTRY.w * 0.4, ENTRY.y + ENTRY.h * 0.45)), fl = st.depthOf(this.world(HEAD.x + HEAD.w * 0.5, HEAD.y + HEAD.h * 0.5));
    st.U.focus.value = lerp(fm, fl, 0.4);
    st.U.aperture.value = 16;
    // 燭光：光圈的位置與亮度一直在輕輕搖曳（兩層雜訊），大鼓時火苗竄一下
    const flk = noise1(t * 2.3, 11) * 0.6 + noise1(t * 7.1, 12) * 0.4;
    st.U.pool.value.set(-470 + 30 * flk, -640 + 20 * noise1(t * 1.7, 13), 1700 + 70 * flk, 0.9 + 0.05 * flk + 0.05 * this.ctx.audio.hit('kick', t, 0.1));
    // 影子：書本（燭光從左下來，影子往右上拉長一點）、三個蠟燭杯
    st.shadows([{ x: 40, y: 20, w: DW + 48, h: DH + 40, blur: 40, k: 0.4, r: 8 }, ...CANDLES.map(([x, y]) => ({ x: x + 10, y: y + 10, w: 110, h: 110, blur: 10, k: 0.25, r: 55 })),
      { x: FLOWERS.x + 30, y: FLOWERS.y + 10, w: FLOWERS.s * 0.8, h: FLOWERS.s * 0.8, blur: 60, k: 0.3, r: FLOWERS.s * 0.4 }]);
    // 花束被風吹得輕輕晃（跟燭火同一陣風）；每兩個小節有一片花瓣從花束飄落到桌巾上（小事件）
    const R = this.rig;
    R.bouquet.rotation.z = 0.02 * noise1(t * 0.7, 40) + 0.008 * Math.sin(t * 1.9);
    const drops = g.bars.filter((b, i) => i % 2 === 0 && b > s + g.bar * 0.5);
    R.petals.forEach((m, i) => {
      const [x, y, r] = PETALS[i]!;
      const b = drops[i];
      const mat = m.material as THREE.RawShaderMaterial;
      mat.uniforms.opacity!.value = b === undefined || t >= b ? 1 : 0;
      if (b === undefined) { m.position.set(x, y, 1.5); return; }
      // 還沒落：藏在花束裡（看不到）；落下：從花束那邊飄過來、打轉、在拍點落地
      const u = clamp((t - b) / Math.max(0.6, g.bar * 0.8));
      const k = ease.inOutCubic(u);
      m.position.set(lerp(FLOWERS.x, x, k) + 40 * Math.sin(u * 7), lerp(FLOWERS.y, y, k), lerp(260, 1.5, ease.inQuad(u)));
      m.rotation.z = r + (1 - u) * 5;
    });
    void g;
  }

  // ------------------------------------------------------------ 燭火
  /** 三朵小火苗：底部藍白、往上變成訊號色，高度與左右晃動一直在搖曳，大鼓時竄高一點。 */
  private drawFlames(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, t: number) {
    const st = this.rig.st, lb = this.flames, e = LIN.ember, sg = LIN.signal;
    lb.clear();
    CANDLES.forEach(([x, y], i) => {
      const b = st.toScreen([x, y, 6]);
      const up = 30; // 火苗在畫面上的高度（鏡頭斜，世界的 z 投影出來太扁）
      const k = 1 + 0.25 * noise1(t * 6 + i * 3.1, 20 + i) + 0.2 * this.ctx.audio.hit('kick', t, 0.1);
      const sway = 4 * noise1(t * 3.3 + i * 1.7, 30 + i);
      const h = up * 1.6 * k, bx = b.x, by = b.y - 4;
      // 外焰（訊號色、寬、淡）、內焰（ember、亮）、焰心（白熱）
      lb.seg2(bx, by, bx + sway, by - h, 14, [sg[0] * 1.6, sg[1] * 1.6, sg[2] * 1.6], 0.55);
      lb.seg2(bx, by - h * 0.1, bx + sway * 0.8, by - h * 0.8, 8, [e[0] * 3, e[1] * 3, e[2] * 3], 0.9);
      lb.seg2(bx, by - h * 0.12, bx + sway * 0.5, by - h * 0.45, 4, [6, 5.4, 4.6], 1);
      // 很淡的一圈光暈
      lb.seg2(bx, by - h * 0.4, bx + 0.1, by - h * 0.4, 70, [sg[0] * 0.25, sg[1] * 0.2, sg[2] * 0.15], 0.35);
    });
    lb.render(renderer, out);
  }

  // ------------------------------------------------------------ 別人的祝福（畫一次）
  private drawStatic(others: Msg[]) {
    const pick = (k: number) => (others.length ? others[k % others.length]! : null);
    const oc = this.oldL.ctx, nc = this.newL.ctx;
    this.oldL.clear(); this.newL.clear();
    // 舊的左頁、舊的右頁：整頁都是；新的左頁：書眉下面
    let k = 0;
    const fill = (c: CanvasRenderingContext2D, x0: number, y0: number, y1: number) => {
      let y = y0;
      while (y < y1 - 80 && others.length && k < others.length * 2) {
        const m = pick(k++)!;
        y = this.entry(c, m, x0, y, y1, k) + 26;
      }
    };
    fill(oc, MX, HEAD.y + this.headH + 40, PH - 90);
    fill(oc, PW + MX, 150, PH - 90);
    fill(nc, MX, HEAD.y + this.headH + 40, PH - 90);
    // 新的一頁的頁首（小）
    nc.font = font(F.hei(700), 18); nc.fillStyle = rgba('sepia', 0.6); nc.letterSpacing = '4px';
    nc.fillText('芳名錄　GUEST BOOK', PW + MX, 100);
    nc.letterSpacing = '0px';
  }

  /** 一則別人的祝福（小、淡、字跡顏色有深淺），回傳下一則可以開始的 y。 */
  private entry(c: CanvasRenderingContext2D, m: Msg, x0: number, y: number, y1: number, k: number): number {
    const size = 27 + Math.round(hash(m.id, 3) * 6), lh = size * 1.3;
    const w = PW - 2 * MX - 40;
    c.save();
    c.translate(x0 + 10 + hash(m.id, 5) * 24, y);
    c.rotate((hash(m.id, 7) - 0.5) * 0.03);
    c.font = font(F.hand(k % 3 === 0 ? 700 : 400), size);
    const lines = wrap(c, m.text, w).slice(0, 3);
    const ink = k % 3 === 1 ? rgba('blood', 0.55) : rgba('sepia', 0.62);
    c.fillStyle = ink;
    let yy = size;
    for (const ln of lines) {
      if (y + yy > y1) break;
      fillWithHearts(c, ln, 0, yy, rgba('rose', 0.7));
      yy += lh;
    }
    c.font = font(F.hand(400), Math.round(size * 0.85)); c.textAlign = 'right';
    c.fillText(signature(m.name), w, yy - lh * 0.25);
    c.restore();
    return y + yy + 4;
  }

  // ------------------------------------------------------------ 書眉（歌詞）
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    c.font = font(F.hei(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText('♪ 本頁背景音樂', HEAD.x, HEAD.y - 8);
    c.letterSpacing = '0px';
    const ly = lyricAt(lyrics, t);
    const LY = this.headStyle();
    if (ly) {
      const d = this.headLay(c, ly.line, LY)!;
      const lay = d.lay;
      const top = d.sub ? HEAD.y + (this.headH - d.blockH) / 2 + lay.size * 0.84 : HEAD.y + (this.headH - lay.height) / 2 + lay.size * 0.84;
      c.save(); c.translate(HEAD.x, top);
      drawRows(c, lay, LY.family, t, paperInk(), ly.k);
      if (d.sub) {
        // 原文副行：同一支筆寫在中文下面、小一號；比中文安靜——唱到、唱完都是墨色再淡兩成（不用紅墨）
        c.translate(0, d.dy);
        const q = rgba('sepia', 0.95 * 0.8);
        drawRows(c, d.sub, LY.family, t, { active: q, sung: q, unsung: paperInk().unsung }, ly.k);
      }
      c.restore();
      return;
    }
    c.font = font(F.archivo(100, 800), Math.round(V2.lyrMin / this.sHead)); c.fillStyle = rgba('sepia', lyrics.has ? 0.26 : 0.8);
    c.fillText(song.title || '芳名錄', HEAD.x, HEAD.y + 104);
    if (!lyrics.has) { c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.5); c.fillText('（純音樂）', HEAD.x, HEAD.y + 150); }
  }

  /** 書眉歌詞的樣式（v2：比留言小一級；字級是螢幕標準換成書頁上的）。 */
  private headStyle(): RowsStyle {
    return { family: F.archivo(100, 800), size: lyricV2(this.msgScreen) / this.sHead, minSize: V2.lyrMin / this.sHead, maxW: HEAD.w, maxRows: 2, lineHeight: 1.06 };
  }

  /**
   * 書眉的排版：中文，加上原文副行（字級照螢幕標準 subSizeFor 換回書頁）。
   * dy = 原文第一排基線離中文第一排基線多遠；blockH = 中文字頂到原文字底。
   */
  private headLay(c: CanvasRenderingContext2D, l: Line, st: RowsStyle) {
    const lay = layoutRows(c, l, st);
    const sl = lyricSubOf(l);
    if (!sl) return { lay, sub: null, dy: 0, blockH: lay.height };
    // 雙語：原文至少 38 螢幕 px（書頁斜躺在桌上，字會被壓扁一成多）、不再縮，太長就折行（最多三排）；書眉跟著長高
    const S = this.sHead, ss = Math.max(38, subSizeFor(lay.size * S)) / S;
    const sub = layoutRows(c, sl, { ...st, size: ss, minSize: ss, maxRows: 3 });
    const dy = (lay.rows.length - 1) * lay.lineHeight + subGap(lay.size * S, sub.size * S) / S;
    return { lay, sub, dy, blockH: lay.size * 0.84 + dy + (sub.rows.length - 1) * sub.lineHeight + sub.size * 0.22 };
  }

  // ------------------------------------------------------------ 簽名旁的小愛心（小事件）
  /** 火花沿著愛心的輪廓畫一圈（點綴色的細線），回傳筆尖。 */
  private drawDoodle(c: CanvasRenderingContext2D, t: number): P2 | null {
    if (t < this.tDoodle) return null;
    const u = ease.inOutQuad(clamp((t - this.tDoodle) / 0.5));
    const pts = heartPoints(48), R = 16, o = this.doodle;
    const n = Math.max(1, Math.floor(u * (pts.length - 1)));
    c.save();
    c.strokeStyle = rgba('rose', 0.95); c.lineWidth = 3.5; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i <= n; i++) { const p = pts[i]!; if (i) c.lineTo(o.x + p.x * R, o.y + p.y * R); else c.moveTo(o.x + p.x * R, o.y + p.y * R); }
    c.stroke();
    c.restore();
    const p = pts[n]!;
    return u < 1 ? { x: o.x + p.x * R, y: o.y + p.y * R } : null;
  }

  // ------------------------------------------------------------ 寫字（主打留言）
  /** 畫已經寫到的字（逐字斜掃出現、剛寫的濕墨水偏暖），回傳筆尖（火花）位置。 */
  private drawWriting(c: CanvasRenderingContext2D, t: number): P2 | null {
    const fam = F.hand(700);
    let pen: P2 | null = null;
    c.textBaseline = 'alphabetic';
    for (const gl of this.glyphs) {
      if (t < gl.t0) {
        // 還沒寫到：筆在兩個詞組之間移動（從上一個寫完的地方飛到這裡）
        if (!pen) {
          const prev = this.glyphs[this.glyphs.indexOf(gl) - 1];
          if (prev && t > prev.t1 && t < this.writeEnd) {
            const u = ease.inOutCubic(clamp((t - prev.t1) / Math.max(0.05, gl.t0 - prev.t1)));
            pen = { x: lerp(prev.x + prev.w, gl.x, u), y: lerp(prev.y, gl.y, u) - gl.size * 0.35 - Math.sin(u * Math.PI) * 24 };
          }
        }
        break;
      }
      const r = clamp((t - gl.t0) / (gl.t1 - gl.t0));
      const heat = 1 - clamp((t - gl.t1) / COOL);
      c.font = font(fam, gl.size);
      const col = heat > 0.02 ? mixRgba(gl.ch === '♥' ? 'rose' : 'sepia', 'blood', heat * 0.85, 1) : gl.ch === '♥' ? rgba('rose') : rgba('sepia');
      const top = gl.y - gl.size * 0.92, h = gl.size * 1.15;
      if (r < 1) {
        const S = r * (gl.w + 0.6 * h);
        c.save();
        c.beginPath();
        c.moveTo(gl.x - 8, top - 8); c.lineTo(gl.x + S + 6, top - 8); c.lineTo(gl.x + S - 0.6 * (h + 8), top + h + 8); c.lineTo(gl.x - 8, top + h + 8);
        c.closePath(); c.clip();
        c.fillStyle = col; c.fillText(gl.ch, gl.x, gl.y);
        c.restore();
        pen = { x: gl.x + clamp(S - 0.3 * h, 0, gl.w), y: top + h * 0.5 };
      } else {
        c.fillStyle = col; c.fillText(gl.ch, gl.x, gl.y);
      }
    }
    if (!this.msg && t > this.writeEnd) {
      // 沒有留言：寫完「這一頁留給你」之後，下面浮現一句邀請（小一點的手寫字）
      const u = prog(t, this.writeEnd + 0.2, this.writeEnd + 0.6);
      c.save(); c.globalAlpha = u;
      // 邀請緊接在「這一頁留給你」下面（字小一級，螢幕上約 34 px）
      const fs = Math.round(34 / this.sEntry), y0 = ENTRY.y + 40 + this.fit!.size * 0.9 + this.fit!.height + fs * 0.9;
      c.font = font(F.hand(700), fs); c.fillStyle = rgba('sepia', 0.7);
      c.fillText('掃描右下角 QR code，', ENTRY.x, y0);
      c.fillText('把祝福寫進簽名簿', ENTRY.x, y0 + fs * 1.35);
      c.restore();
    }
    return pen;
  }
}
