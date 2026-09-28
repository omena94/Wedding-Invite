// 簽名簿（批次 T4・紙本 D，亮）：喜宴入口桌上攤開的簽名簿，鋪著亞麻桌巾。
//  - 第一拍：右邊那頁（已經寫滿別人的祝福）翻過去——真的 3D 的紙：從書脊掀起來、外緣稍微落後彎成弧，蓋到左邊；
//    露出新的一頁。
//  - 仙女棒的火花是筆：在拍點上一個詞組一個詞組把主打留言寫在新的一頁上（剛寫的字是暖色的濕墨水，一下子乾成墨色），
//    寫完空半拍再簽名。這是畫面的焦點：最大、最清楚。
//  - 左頁的「書眉」是現在唱的那句歌詞（中等大小，逐字跟唱）；下面是前面的賓客寫的祝福（真的留言，小、淡，當背景）。
//  - 鏡頭：斜斜地拍整本簿子，寫字時鏡頭微微跟著筆尖、焦點在新的一頁上；寫完慢慢推近。
//  - 沒有留言：新的一頁寫「這一頁留給你」＋一句邀請。純音樂：書眉寫歌名。
// 畫法：兩張「跨頁」render target（舊的：翻頁前的左右頁；新的：翻頁後的左右頁，含書眉歌詞與正在寫的字、火花），
// 書本是 three.js 的網格：書皮、左右兩頁（靠書脊那邊往下彎）、一張翻動的頁（每格照翻頁進度算出彎曲的形狀，
// 正面貼舊的右頁、背面貼新的左頁）。交給 _t4 的舞台拍（亞麻桌巾、光、景深、書溝的陰影）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, type TextLayout } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { wrap, type FitResult } from '../engine/text';
import { lyricAt, signature, sparkHead, sparkParticles, fillWithHearts } from './_motifs';
import { grid, fitMsg, layoutRows, drawRows, paperInk, Stage, docRT, camDist, type Grid, type RowsStyle, type P2, type V3 } from './_t4';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.15, 0.8], bars: [4, 8] };

// ---------------------------------------------------------------- 跨頁（像素，左上原點、y 向下；左頁 0..PW、右頁 PW..2PW）
const PW = 760, PH = 980, DW = PW * 2, DH = PH;
const MX = 64; // 頁邊
const HEAD = { x: MX, y: 104, w: PW - 2 * MX, h: 170 }; // 左頁的書眉（歌詞）
const ENTRY = { x: PW + MX + 6, y: 150, w: PW - 2 * MX - 12, h: 560 }; // 右頁：主打留言
const Z0 = 8, CURL_A = 24, CURL_K = 80; // 頁面的彎曲：靠書脊低、往外升起
const pageZ = (u: number) => Z0 + CURL_A * (1 - Math.exp(-u / CURL_K));
const COOL = 0.8; // 濕墨水乾掉要幾秒

const LY: RowsStyle = { family: F.archivo(100, 800), size: 66, minSize: 56, maxW: HEAD.w, maxRows: 2, lineHeight: 1.04 };
const TEXT = '芳名錄本頁背景音樂這一頁留給你掃描右下角把祝福寫進簽名簿純音樂間奏中第頁一位賓客新人';

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

function makeRig() {
  const oldRT = docRT(DW, DH), newRT = docRT(DW, DH);
  const st = new Stage(2, 30);
  st.U.ambient.value = 0.8;
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
  return { oldRT, newRT, st, mOld, mNew, left, right, leafF, leafB, book };
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
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  tTurn = 0; turnDur = 0.7;
  glyphs: Glyph[] = [];
  fit: FitResult | null = null;
  writeEnd = 0;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const others: Msg[] = ((this.ctx.params.messages ?? []) as Msg[]).filter((m) => !this.msg || m.id !== this.msg.id);
    await loadText(TEXT + song.title + (this.msg ? signature(this.msg.name) : '') + lyrics.linesIn(s, e).map((l) => l.text).join('') + others.map((m) => m.text + m.name).join(''));
    const g = (this.g = grid(au, s, e));
    this.tTurn = g.b0;
    this.turnDur = Math.min(0.75, g.beat * 1.5);
    this.drawStatic(others);
    // 寫字：翻完頁的下一拍開始，一個詞組（最多四個字、標點後斷開）落在一個格點上（一拍、半拍或四分之一拍，挑寫得完的最慢那種）
    const t0 = au.timeOfBeat(Math.ceil(au.beatAt(this.tTurn + this.turnDur) - 1e-6));
    const text = this.msg ? this.msg.text : '這一頁留給你';
    const fam = F.hand(700);
    const fit = (this.fit = fitMsg(this.live.ctx, text, fam, ENTRY.w, ENTRY.h - (this.msg ? 110 : 190), { min: 54, max: 108, lineHeight: 1.32 }));
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
      const ss = 46, sl = layout(sigText, fam, ss);
      const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
      const sx = ENTRY.x + ENTRY.w - sl.width, sy = Math.min(lastY + 78, ENTRY.y + ENTRY.h + 30);
      const st0 = tEnd + g.beat * 0.5, per = Math.min(0.06, 0.8 / sl.glyphs.length);
      sl.glyphs.forEach((gl, j) => this.glyphs.push({ ch: gl.ch, x: sx + gl.x, y: sy, w: gl.w, t0: st0 + j * per, t1: st0 + (j + 1) * per, size: ss }));
      tEnd = st0 + sl.glyphs.length * per;
    }
    this.writeEnd = tEnd;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, R = this.rig;
    const L = this.live; L.clear();
    const c = L.ctx;
    this.drawLyric(c, t);
    const turnP = ease.inOutCubic(clamp((t - this.tTurn) / this.turnDur));
    // 舊的跨頁只在翻頁完成前看得到：那之前每格畫（書眉的歌詞要跟唱），之後就不用了
    if (turnP < 1) {
      this.paper.render(renderer, R.oldRT);
      comp.draw(renderer, this.oldL.texture, R.oldRT);
      comp.draw(renderer, L.upload(), R.oldRT);
    }
    const pen = this.drawWriting(c, t);
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
    return { paper: 1, bloom: 0.4, vignette: 0.3, grain: 0.04 };
  }

  /** 跨頁座標 → 世界（書本平放、書脊在 x = 0）。 */
  private world(u: number, v: number): V3 {
    const x = u - PW;
    return [x, PH / 2 - v, pageZ(Math.abs(x))];
  }

  private shoot(t: number, pen: P2 | null) {
    const st = this.rig.st, g = this.g, s = this.ctx.start, e = this.ctx.end;
    const D = camDist(30);
    const intro = ease.outExpo(clamp((t - s) / Math.max(0.3, this.tTurn + this.turnDur - s)));
    const after = ease.inOutCubic(clamp((t - this.writeEnd) / Math.max(1, e - this.writeEnd)));
    // 看的點：書脊偏右（新的一頁），寫字時往筆尖偏一點；寫完慢慢推近那一頁
    const px = pen ? lerp(PW * 1.3, pen.x, 0.12) : PW * 1.3;
    const T0 = this.world(px, PH * 0.5);
    // 書本放在畫面偏左上，右下角的 QR 區留給 HUD
    const T: V3 = [T0[0] + 40 + 10 * after, T0[1] - 60 + 30 * after, 20];
    const dist = D * lerp(0.95, 1.3, intro) * (1 - 0.04 * after);
    const tilt = THREE.MathUtils.degToRad(lerp(40, 29, intro));
    const yaw = lerp(0.14, 0.04, intro);
    st.look([T[0] + Math.sin(yaw) * dist, T[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T);
    // 焦點在新的一頁與書眉之間偏新的一頁：歌詞也要清楚，只讓書本外面的桌巾與遠端失焦
    const fm = st.depthOf(this.world(ENTRY.x + ENTRY.w * 0.4, ENTRY.y + ENTRY.h * 0.45)), fl = st.depthOf(this.world(HEAD.x + HEAD.w * 0.5, HEAD.y + HEAD.h * 0.5));
    st.U.focus.value = lerp(fm, fl, 0.4);
    st.U.aperture.value = 16;
    st.U.pool.value.set(-100, 120, 1700, 0.55);
    st.shadows([{ x: 12, y: -16, w: DW + 48, h: DH + 40, blur: 30, k: 0.35, r: 8 }]);
    void g;
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
    fill(oc, MX, HEAD.y + HEAD.h + 40, PH - 90);
    fill(oc, PW + MX, 150, PH - 90);
    fill(nc, MX, HEAD.y + HEAD.h + 40, PH - 90);
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
    if (ly) {
      const lay = layoutRows(c, ly.line, LY);
      const top = HEAD.y + (HEAD.h - lay.height) / 2 + lay.size * 0.84;
      c.save(); c.translate(HEAD.x, top);
      drawRows(c, lay, LY.family, t, paperInk(), ly.k);
      c.restore();
      return;
    }
    c.font = font(F.archivo(100, 800), 56); c.fillStyle = rgba('sepia', lyrics.has ? 0.26 : 0.8);
    c.fillText(song.title || '芳名錄', HEAD.x, HEAD.y + 104);
    if (!lyrics.has) { c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.5); c.fillText('（純音樂）', HEAD.x, HEAD.y + 150); }
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
      c.font = font(F.hand(700), 46); c.fillStyle = rgba('sepia', 0.7);
      c.fillText('掃描右下角 QR code，', ENTRY.x, ENTRY.y + ENTRY.h - 60);
      c.fillText('把祝福寫進簽名簿', ENTRY.x, ENTRY.y + ENTRY.h);
      c.restore();
    }
    return pen;
  }
}
