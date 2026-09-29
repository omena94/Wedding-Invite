// 彈珠台（機器 B，暗）：從玩家的位置看過去的彈珠台（three.js 立體），檯面往遠方延伸，最遠端立著背箱。
//  - 鋼珠每一拍撞一個東西：彈柱、擋板、上方的 L O V E 通道、兩支拍子（照一個八拍的套路輪流），拍點就是撞到的那一刻。
//    兩次碰撞之間走的是真的拋物線（檯面是斜的，重力往玩家這邊拉）；撞到時噴火花（仙女棒的火花）、彈柱的燈蓋亮成訊號色、
//    拍子在球到的那一拍往上揮。
//  - 焦點：「撞到的燈板亮出留言」——背箱的玻璃上寫著主打留言（手寫字，整片玻璃最大、最亮），一開始是暗暗的印刷；
//    每撞一下就亮出下一段（兩秒多一點全亮），檯面中間的一串燈也一格一格往上亮。署名在留言最後一行下面。
//  - 背箱下緣的顯示板就是歌詞（逐字跟唱，比留言小一級）。
//  - 沒有留言：歌詞放大到玻璃上當焦點，顯示板一小行「INSERT COIN」與邀請。純音樂：歌名。
//  - 配角都很安靜：檯面只有線稿、淡淡的 Alan & Omena，燈罩平常是暗的；背箱沒有標題列。
// 手法：檯面是一張平面（漆面木紋＋畫好的線稿貼圖＋燈罩在 shader 裡畫），彈柱、拍子、擋板、邊欄是簡單的立體零件，
// 鋼珠是假環境反射；火花是 2D 的 LineBatch（碰撞點投影到螢幕上）；背箱是一張 Canvas 小圖層（每格重畫歌詞）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, signature, sparkParticles, drawHeart, COUPLE_ZH } from './_motifs';
import { blit, winBeats, INVITE, T8_TEXT, camMove } from './_t8';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { playfieldMaterial, solidMaterial, ballMaterial, MAX_LAMPS } from './pinball-gl';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.45, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 檯面（檯面座標：u 橫向 ±320，v 從遠端 0 到近端 TL）
const TW = 640, TL = 1240;
const BR = 42; // 彈柱半徑
const BALL_R = 15;
const BUMPS = [{ u: -114, v: 350 }, { u: 114, v: 350 }, { u: 0, v: 505 }];
const FLIPS = [{ u: -150, v: 1110, s: 1 }, { u: 150, v: 1110, s: -1 }]; // 支點；s = 1 是左邊那支（往右指）
const FLEN = 118;
const LANES = [-150, -50, 50, 150]; // 上方 L O V E 通道
const SLINGS = [{ u: -206, v: 935 }, { u: 206, v: 935 }];
const LADDER = [905, 855, 805, 755, 705, 655]; // 許願階梯（u = 0）
const GRAV = 820; // 檯面上的重力（往近端）
/** 八拍一輪的套路：F 拍子、A/B/C 彈柱、L 通道、S 擋板。 */
const PATTERN = ['FR', 'A', 'C', 'B', 'L', 'SL', 'FL', 'C', 'FL', 'B', 'A', 'C', 'L', 'SR', 'FR', 'A'] as const;
type Kind = typeof PATTERN[number];
/** 背箱（畫面座標）。 */
// v2 標準：留言區（連玻璃）≤ 860×430。背箱是機器本身的一部分，放在檯面遠端的正上方（不會蓋住檯面）
const BB = { x: 530, y: 36, w: 860, h: 380 };
const GLASS = { x: 18, y: 14, w: 824, h: 280 }; // 背箱裡：玻璃（留言）
const DISP = { x: 18, y: 304, w: 824, h: 62 }; // 背箱裡：顯示板（歌詞）
/** 玻璃上：留言的左右留白、署名那一行的高度。 */
const GPAD = 36;
/** 鏡頭往下平移（px）：背箱比較高，檯面整個往下移一點，遠端才不會被蓋住。 */
const VIEW_DY = -46;
const TEXT = `${T8_TEXT}${COUPLE_ZH}（）♪`;

const toW = (u: number, v: number, y = 0) => new THREE.Vector3(u, y, v - TL);

const BG = () => new FSPass(/* glsl */ `
  uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 暗房間：背箱後面一圈暖光，四周暗下去
    float r = length((p - vec2(${BB.x + BB.w / 2}.0, 260.0)) / vec2(1100.0, 700.0));
    vec3 col = C_INK * 0.8 + (C_INK2 - C_INK) * 1.8 * exp(-r * r * 2.0) + C_BLOOD * 0.02 * exp(-r * r * 3.0) * k;
    fragColor = vec4(col, 1.0);
  }`, { k: { value: 1 } });

interface Hit { t: number; kind: Kind; u: number; v: number; lane: number }

export default class Pinball extends Scene {
  bg = shared('pinball.bg', BG);
  scene3 = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, W / H, 20, 6000);
  art = this.track(new Layer2D(TW, TL, 1.5, { fast: true }));
  box = this.track(new Layer2D(BB.w, BB.h, undefined, { fast: true }));
  sparks = this.track(new LineBatch(2400, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  hits: Hit[] = [];
  beat = 0.5;
  fit: FitResult | null = null;
  charT: number[] = [];
  typedEnd = 0;
  /** 署名、歌詞的字級（v2）。 */
  sigPx = 30; lyrPx = 48;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private pf!: THREE.RawShaderMaterial;
  private bumpMats: THREE.RawShaderMaterial[] = [];
  private slingMats: THREE.RawShaderMaterial[] = [];
  private flippers: THREE.Mesh[] = [];
  private ball!: THREE.Mesh;
  private ballMat!: THREE.RawShaderMaterial;
  private tmp = new THREE.Vector3();

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const m = this.msg;
    await loadText(TEXT + (song.title ?? '') + (m ? m.text + m.name : ''));
    this.beat = au.beatPeriod(s + 0.1);
    this.buildHits(s, e);
    this.buildScene();
    this.drawArt();
    // 留言：每撞一下亮出一段，最多六下（約兩秒多）全亮
    const c = this.box.ctx;
    const text = m ? m.text : INVITE;
    // 字級依「玻璃高度扣掉署名那一行」算，署名永遠在最後一行下面
    // v2 字級（背箱是平面的，畫面 px 就是畫布 px）；字級依「玻璃高度扣掉署名那一行」算，署名永遠在最後一行下面
    const o = { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.24, maxLines: 5 };
    const probe = sigV2(o.max);
    const bh = GLASS.h - 30 - (o.max * 0.5 + probe);
    this.fit = fitClauses(c, text, F.hand(400), GLASS.w - GPAD * 2, bh, o) ?? fitText(c, text, F.hand(400), GLASS.w - GPAD * 2, bh, o);
    this.sigPx = sigV2(this.fit.size);
    this.lyrPx = lyricV2(m ? this.fit.size : null);
    const n = this.fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const hs = this.hits.filter((h) => h.t >= s + 0.02).slice(0, 6);
    const chunks = Math.max(1, Math.min(hs.length, Math.ceil(n / 3)));
    const per = Math.ceil(n / chunks);
    this.charT = Array.from({ length: n }, (_, i) => hs[Math.min(hs.length - 1, Math.floor(i / per))]?.t ?? s + 0.3);
    this.typedEnd = this.charT[n - 1] ?? s;
  }

  // ---------------------------------------------------------------- 碰撞的時間表
  private buildHits(s: number, e: number) {
    const au = this.ctx.audio;
    const bs = winBeats(au, s - 2 * this.beat, e + this.beat);
    let prev: { u: number; v: number } | null = null;
    for (const t of bs) {
      const bi = Math.round(au.beatAt(t));
      const kind = PATTERN[((bi % PATTERN.length) + PATTERN.length) % PATTERN.length]!;
      const lane = Math.floor(bi / 8) % 4;
      let u = 0, v = 0;
      if (kind === 'A' || kind === 'B' || kind === 'C') {
        const b = BUMPS['ABC'.indexOf(kind)]!;
        // 撞到彈柱的點：在彈柱朝著來的方向那一側
        const from = prev ?? { u: b.u + 1, v: b.v + 60 };
        const dx = from.u - b.u, dy = from.v - b.v, d = Math.hypot(dx, dy) || 1;
        u = b.u + (dx / d) * (BR + BALL_R); v = b.v + (dy / d) * (BR + BALL_R);
      } else if (kind === 'FL' || kind === 'FR') {
        const f = FLIPS[kind === 'FL' ? 0 : 1]!;
        const a = (-22 * Math.PI) / 180;
        u = f.u + f.s * Math.cos(a) * FLEN * 0.62; v = f.v + Math.sin(a) * FLEN * 0.62 - BALL_R;
      } else if (kind === 'L') { u = LANES[lane]!; v = 150; }
      else { const sl = SLINGS[kind === 'SL' ? 0 : 1]!; u = sl.u + (kind === 'SL' ? 26 : -26); v = sl.v; }
      this.hits.push({ t, kind, u, v, lane });
      prev = { u, v };
    }
  }
  /** 鋼珠在 t 的檯面座標：兩次碰撞之間是拋物線（重力往近端，所以中段往遠端拱起來）。 */
  private ballAt(t: number) {
    const H0 = this.hits;
    let i = 0;
    for (let k = 0; k < H0.length; k++) if (H0[k]!.t <= t) i = k;
    const a = H0[i]!, b = H0[Math.min(H0.length - 1, i + 1)]!;
    if (b === a || b.t <= a.t) return { u: a.u, v: a.v };
    const T = b.t - a.t, x = clamp((t - a.t) / T);
    return { u: lerp(a.u, b.u, x), v: lerp(a.v, b.v, x) + 0.5 * GRAV * T * T * (x * x - x) };
  }
  private lastHit(kind: Kind | null, t: number): Hit | null {
    let best: Hit | null = null;
    for (const h of this.hits) { if (h.t > t) break; if (!kind || h.kind === kind) best = h; }
    return best;
  }

  // ---------------------------------------------------------------- 立體場景
  private keep<T extends THREE.BufferGeometry>(g: T) { this.geos.push(g); return g; }
  private keepM<T extends THREE.Material>(m: T) { this.mats.push(m); return m; }

  private buildScene() {
    const S = this.scene3;
    // 檯面
    const pg = this.keep(new THREE.PlaneGeometry(TW, TL));
    pg.rotateX(-Math.PI / 2);
    this.pf = this.keepM(playfieldMaterial(this.art.texture, TL));
    const pm = new THREE.Mesh(pg, this.pf);
    pm.position.set(0, 0, -TL / 2);
    S.add(pm);
    // 邊欄與前面的鎖桿
    const railM = this.keepM(solidMaterial(new THREE.Vector3(...LIN.ink2).multiplyScalar(2.2)));
    for (const sx of [-1, 1]) {
      const r = new THREE.Mesh(this.keep(new THREE.BoxGeometry(28, 50, TL + 60)), railM);
      r.position.set(sx * (TW / 2 + 14), 25, -TL / 2);
      S.add(r);
    }
    const bar = new THREE.Mesh(this.keep(new THREE.BoxGeometry(TW + 90, 34, 46)), railM);
    bar.position.set(0, 26, 34);
    S.add(bar);
    // 彈柱
    const cg = this.keep(new THREE.CylinderGeometry(BR, BR, 44, 40));
    for (const b of BUMPS) {
      const mat = this.keepM(solidMaterial(new THREE.Vector3(...LIN.ink2).multiplyScalar(2.6), 1));
      mat.uniforms.radius!.value = BR;
      this.bumpMats.push(mat);
      const mesh = new THREE.Mesh(cg, mat);
      mesh.position.copy(toW(b.u, b.v, 22));
      S.add(mesh);
      // 底座的環（紙白）
      const ring = new THREE.Mesh(this.keep(new THREE.CylinderGeometry(BR + 9, BR + 9, 6, 40)), this.keepM(solidMaterial(new THREE.Vector3(...LIN.bone).multiplyScalar(0.55))));
      ring.position.copy(toW(b.u, b.v, 3));
      S.add(ring);
    }
    // 擋板（三角柱）
    for (const [k, sl] of SLINGS.entries()) {
      const sx = k === 0 ? 1 : -1;
      const sh = new THREE.Shape();
      const P = [[sl.u - sx * 52, sl.v - 80], [sl.u - sx * 52, sl.v + 60], [sl.u + sx * 26, sl.v + 92]] as const;
      sh.moveTo(P[0][0], TL - P[0][1]);
      for (const q of P.slice(1)) sh.lineTo(q[0], TL - q[1]);
      const g = this.keep(new THREE.ExtrudeGeometry(sh, { depth: 32, bevelEnabled: true, bevelSize: 4, bevelThickness: 4, bevelSegments: 2 }));
      g.rotateX(-Math.PI / 2);
      const mat = this.keepM(solidMaterial(new THREE.Vector3(...LIN.bone).multiplyScalar(0.5)));
      this.slingMats.push(mat);
      // 形狀的座標已經是 (u, TL - v)，轉平之後就是世界座標，不用再平移
      S.add(new THREE.Mesh(g, mat));
    }
    // 拍子：支點粗、尖端細的膠囊，往上長一點高度
    const fs = new THREE.Shape();
    const r0 = 17, r1 = 8;
    fs.absarc(0, 0, r0, Math.PI / 2, (3 * Math.PI) / 2, false);
    fs.lineTo(FLEN, -r1);
    fs.absarc(FLEN, 0, r1, -Math.PI / 2, Math.PI / 2, false);
    fs.lineTo(0, r0);
    const fg = this.keep(new THREE.ExtrudeGeometry(fs, { depth: 22, bevelEnabled: true, bevelSize: 3, bevelThickness: 3, bevelSegments: 2 }));
    fg.rotateX(-Math.PI / 2);
    const fm = this.keepM(solidMaterial(new THREE.Vector3(...LIN.bone).multiplyScalar(0.8)));
    for (const f of FLIPS) {
      const mesh = new THREE.Mesh(fg, fm);
      mesh.position.copy(toW(f.u, f.v, 2));
      this.flippers.push(mesh);
      S.add(mesh);
    }
    // 鋼珠
    this.ballMat = this.keepM(ballMaterial());
    this.ball = new THREE.Mesh(this.keep(new THREE.SphereGeometry(BALL_R, 32, 20)), this.ballMat);
    S.add(this.ball);
    // 鏡頭：站在拍子後面、稍微高一點往遠端看
    this.cam.position.set(0, 800, 900);
    this.cam.lookAt(0, 0, -800);
  }

  /** 拍子的角度（檯面平面上的方向）：球到的那一拍往上揮，停一下再放下。 */
  private flipAngle(i: 0 | 1, t: number) {
    const h = this.lastHit(i === 0 ? 'FL' : 'FR', t + 0.06);
    const rest = (32 * Math.PI) / 180, up = (-24 * Math.PI) / 180;
    if (!h) return rest;
    const k = t < h.t ? ease.outCubic(clamp((t - (h.t - 0.06)) / 0.06)) : 1 - ease.inOutCubic(clamp((t - h.t - 0.12) / 0.16));
    return lerp(rest, up, k);
  }

  // ---------------------------------------------------------------- 檯面的線稿（畫一次）
  private drawArt() {
    const L = this.art, c = L.ctx;
    L.clear();
    const X = (u: number) => u + TW / 2;
    c.lineCap = 'round';
    c.strokeStyle = rgba('bone', 0.4); c.lineWidth = 2;
    // 上方的拱與 L O V E 通道的隔板
    c.beginPath(); c.arc(X(0), 330, 300, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
    for (const u of [-200, -100, 0, 100, 200]) { c.beginPath(); c.moveTo(X(u), 90); c.lineTo(X(u), 205); c.stroke(); }
    ['L', 'O', 'V', 'E'].forEach((ch, i) => {
      c.font = font(F.archivo(100, 900), 26); c.textAlign = 'center';
      c.fillStyle = rgba('ink', 0.85);
      c.fillText(ch, X(LANES[i]!), 159);
    });
    // 兩側的出球道、回球道（斜線）
    for (const sx of [-1, 1]) {
      c.beginPath(); c.moveTo(X(sx * 300), 820); c.lineTo(X(sx * 300), 1030); c.lineTo(X(sx * 175), 1098); c.stroke();
      c.beginPath(); c.moveTo(X(sx * 262), 840); c.lineTo(X(sx * 262), 1010); c.lineTo(X(sx * 168), 1062); c.stroke();
    }
    // 中間淡淡的 Alan & Omena、兩支拍子中間的小愛心（其他標籤都拿掉：檯面是場景，不是資訊）
    c.textAlign = 'center';
    c.font = font(F.serif(600, true), 40); c.fillStyle = rgba('bone', 0.22);
    c.fillText('Alan & Omena', X(0), 625);
    drawHeart(c, X(0), 1150, 26, rgba('rose', 0.55));
    c.textAlign = 'left';
    L.upload();
  }

  /** 檯面上的燈：L O V E、許願階梯、擋板燈、回球道燈。每格算亮度寫進 uniform。 */
  private updateLamps(t: number) {
    const u = this.pf.uniforms;
    const lamps = u.lamps!.value as THREE.Vector4[], cols = u.lampCol!.value as THREE.Vector3[];
    const au = this.ctx.audio, s = this.ctx.start;
    let n = 0;
    const put = (uu: number, vv: number, r: number, k: number, col: [number, number, number]) => {
      if (n >= MAX_LAMPS) return;
      lamps[n]!.set(uu, vv, r, k);
      cols[n]!.set(...col);
      n++;
    };
    const bph = ((au.beatAt(t) % 1) + 1) % 1;
    // L O V E：每個小節亮一個，四個都亮就跟著拍子一起閃；被球滾過的那一格閃一下
    const barsIn = Math.max(0, Math.floor(au.barAt(t) - au.barAt(s) + 0.999));
    const lh = this.lastHit('L', t);
    LANES.forEach((lu, i) => {
      let k = i < barsIn ? 0.55 : 0.04;
      if (barsIn >= 4) k = bph < 0.5 ? 0.65 : 0.3;
      if (lh && lh.lane === i) k = Math.max(k, pulse(t, lh.t, 0.2) * 1.3);
      put(lu, 150, 24, k, LIN.signal);
    });
    // 許願階梯：留言亮到哪、燈亮到哪；全亮之後由下往上跑馬
    const shown = this.charT.filter((x) => x <= t).length / Math.max(1, this.charT.length);
    const done = t >= this.typedEnd;
    LADDER.forEach((v, i) => {
      let k = shown > i / LADDER.length + 1e-3 ? 0.55 : 0.04;
      if (done) k = Math.floor(au.beatAt(t) * 2) % LADDER.length === i ? 1.1 : 0.35;
      put(0, v, i === 5 ? 18 : 13, k, i === 5 ? LIN.ember : LIN.signal);
    });
    // 擋板燈、回球道燈
    SLINGS.forEach((sl, i) => {
      const h = this.lastHit(i ? 'SR' : 'SL', t);
      put(sl.u * 0.78, sl.v - 70, 13, 0.1 + (h ? pulse(t, h.t, 0.15) * 1.5 : 0), LIN.ember);
    });
    for (const sx of [-1, 1]) put(sx * 232, 1052, 11, (bph < 0.5) === (sx < 0) ? 0.55 : 0.06, LIN.signal);
    // 彈柱被撞亮時，光灑在檯面上（燈罩藏在彈柱底下，只看得到外面那圈光暈）
    BUMPS.forEach((b, i) => {
      const h = this.lastHit((['A', 'B', 'C'] as const)[i]!, t);
      const k = h ? pulse(t, h.t, 0.14) : 0;
      if (k > 0.01) put(b.u, b.v, BR + 6, 1.8 * k, LIN.signal);
    });
    for (; n < MAX_LAMPS; n++) lamps[n]!.set(0, 0, 0, 0);
  }

  // ---------------------------------------------------------------- 背箱（留言與分數顯示板）
  private drawBox(t: number, out: THREE.WebGLRenderTarget) {
    const L = this.box, c = L.ctx;
    L.clear();
    const au = this.ctx.audio;
    const m = this.msg, fit = this.fit!;
    // 機殼
    c.fillStyle = rgba('ink2');
    c.beginPath(); c.roundRect(0, 0, BB.w, BB.h, 18); c.fill();
    c.strokeStyle = rgba('bone', 0.16); c.lineWidth = 1.5;
    c.beginPath(); c.roundRect(0.75, 0.75, BB.w - 1.5, BB.h - 1.5, 18); c.stroke();
    // 玻璃：深色，中間被背光照得亮一點
    const g = c.createRadialGradient(GLASS.x + GLASS.w / 2, GLASS.y + GLASS.h / 2, 40, GLASS.x + GLASS.w / 2, GLASS.y + GLASS.h / 2, GLASS.w * 0.6);
    g.addColorStop(0, mixRgba('ink', 'ink2', 0.9)); g.addColorStop(1, rgba('ink'));
    c.fillStyle = g;
    c.fillRect(GLASS.x, GLASS.y, GLASS.w, GLASS.h);
    // 玻璃四周的跑馬燈：八分音符走一格（很小、很淡，只是讓機器活著）
    const nL = 48, step = Math.floor(au.beatAt(t) * 2);
    for (let i = 0; i < nL; i++) {
      const per = 2 * (GLASS.w + GLASS.h), d = (i / nL) * per;
      let x: number, y: number;
      if (d < GLASS.w) { x = GLASS.x + d; y = GLASS.y - 8; }
      else if (d < GLASS.w + GLASS.h) { x = GLASS.x + GLASS.w + 8; y = GLASS.y + d - GLASS.w; }
      else if (d < 2 * GLASS.w + GLASS.h) { x = GLASS.x + GLASS.w - (d - GLASS.w - GLASS.h); y = GLASS.y + GLASS.h + 8; }
      else { x = GLASS.x - 8; y = GLASS.y + GLASS.h - (d - 2 * GLASS.w - GLASS.h); }
      const on = (i + step) % 4 === 0;
      c.fillStyle = on ? rgba('ember', 0.7) : rgba('signal', 0.1);
      c.beginPath(); c.arc(x, y, on ? 2.8 : 2.2, 0, Math.PI * 2); c.fill();
    }
    c.textBaseline = 'alphabetic';
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (m) {
      // 焦點：留言（撞一下亮一段；還沒亮的字是玻璃上淡淡的印刷）。字級已經扣掉署名的高度，署名在最後一行下面
      c.font = font(F.hand(400), fit.size);
      const sigH = fit.size * 0.5 + this.sigPx;
      const top = GLASS.y + 16 + (GLASS.h - 30 - sigH - fit.height) / 2 + fit.size * 0.92;
      let idx = 0;
      fit.lines.forEach((ln, li) => {
        let x = GLASS.x + GPAD;
        const y = top + li * fit.lineHeight;
        for (const ch of Array.from(ln)) {
          const ta = this.charT[idx++] ?? 0;
          const cw = c.measureText(ch).width;
          const k = t >= ta ? 1 : 0;
          const heat = k ? Math.exp(-(t - ta) / 0.25) : 0;
          const to = ch === '♥' ? 'rose' : 'bone';
          c.fillStyle = !k ? rgba('bone', 0.07) : heat > 0.02 ? mixRgba(to, 'ember', heat) : rgba(to, 1);
          c.fillText(ch, x, y);
          x += cw;
        }
      });
      const sk = clamp((t - this.typedEnd - this.beat * 0.5) / 0.3);
      if (sk > 0) {
        const sy = top + (fit.lines.length - 1) * fit.lineHeight + sigH;
        c.font = font(F.hand(400), this.sigPx); c.fillStyle = rgba('ash', sk);
        c.fillText(signature(m.name) + (m.couple ? '（新人）' : ''), GLASS.x + GPAD, sy);
      }
    } else if (ly) {
      // 沒有留言：歌詞放大到玻璃上
      const st = { family: F.archivo(100, 800), size: this.lyrPx, minSize: V2.lyrMin, maxWidth: GLASS.w - GPAD * 2, lineHeight: 1.1 };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(GLASS.x + GPAD, GLASS.y + (GLASS.h - lay.height) / 2 + lay.size * 0.8);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else if (!lyrics.has) {
      c.font = font(F.archivo(100, 800), this.lyrPx); c.fillStyle = rgba('bone', 0.9);
      c.fillText(`♪  ${song.title || '今晚的歌'}`, GLASS.x + GPAD, GLASS.y + GLASS.h / 2 + 30);
    }
    // 顯示板：有留言時是歌詞（小一級）；沒有留言時是 INSERT COIN 與邀請
    c.fillStyle = rgba('ink');
    c.fillRect(DISP.x, DISP.y, DISP.w, DISP.h);
    c.save();
    c.beginPath(); c.rect(DISP.x, DISP.y, DISP.w, DISP.h); c.clip();
    if (!m) {
      const bl = ((au.beatAt(t) % 1) + 1) % 1 < 0.5;
      c.font = font(F.archivo(125, 900), 30); c.letterSpacing = '6px';
      c.fillStyle = bl ? rgba('ember', 0.8) : rgba('ember', 0.25);
      c.font = font(F.archivo(125, 900), 24);
      c.fillText('INSERT COIN', DISP.x + GPAD, DISP.y + 44);
      const iw = c.measureText('INSERT COIN').width;
      c.letterSpacing = '0px';
      // 邀請放在玻璃下緣（顯示板太窄，放不下 INSERT COIN 加一整句）
      c.font = font(F.hei(500), 22); c.fillStyle = rgba('ash', 0.7);
      c.fillText(INVITE, DISP.x + GPAD + iw + 36, DISP.y + 45, DISP.w - GPAD * 2 - iw - 36);
    } else if (ly) {
      const st = { family: F.archivo(100, 700), size: this.lyrPx, minSize: V2.lyrMin, maxWidth: DISP.w - GPAD * 2, lineHeight: 1.0, align: 'center' as const, sung: rgba('bone', 0.75), unsung: rgba('bone', 0.22) };
      const lay = layoutLyric(c, ly.line, st);
      // 一行放不下（折成兩行）就縮到放得下的高度
      const k = Math.min(1, (DISP.h - 12) / (lay.height + lay.size * 0.25));
      c.translate(DISP.x + DISP.w / 2, DISP.y + DISP.h / 2);
      c.scale(k, k);
      c.translate(0, -lay.height / 2 + lay.size * 0.78);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else if (!lyrics.has) {
      c.textAlign = 'center';
      c.font = font(F.archivo(100, 700), 44); c.fillStyle = rgba('bone', 0.6);
      c.fillText(`♪  ${song.title || '今晚的歌'}`, DISP.x + DISP.w / 2, DISP.y + 50);
      c.textAlign = 'left';
    }
    c.restore();
    L.upload();
    blit(this.ctx, L.texture, BB.x, BB.y, BB.w, BB.h, out);
  }

  /** 檯面座標 → 畫面像素（火花用）。 */
  private screen(u: number, v: number, y = BALL_R) {
    const p = this.tmp.set(u, y, v - TL).project(this.cam);
    return { x: (p.x + 1) * 0.5 * W, y: (1 - p.y) * 0.5 * H };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.bg.u.k!.value = 1;
    this.bg.render(renderer, out);
    // 零件的狀態
    this.updateLamps(t);
    BUMPS.forEach((_, i) => {
      const h = this.lastHit((['A', 'B', 'C'] as const)[i]!, t);
      this.bumpMats[i]!.uniforms.flash!.value = h ? pulse(t, h.t, 0.13) : 0;
    });
    this.slingMats.forEach((mat, i) => {
      const h = this.lastHit(i ? 'SR' : 'SL', t);
      mat.uniforms.flash!.value = h ? pulse(t, h.t, 0.12) : 0;
    });
    this.flippers.forEach((fl, i) => {
      const a = this.flipAngle(i as 0 | 1, t);
      const f0 = FLIPS[i]!;
      // 左邊那支往右指（f0.s = 1），右邊那支往左指
      const du = f0.s * Math.cos(a), dv = Math.sin(a);
      fl.rotation.y = -Math.atan2(dv, du);
    });
    const bp = this.ballAt(t);
    this.ball.position.copy(toW(bp.u, bp.v, BALL_R));
    const last = this.lastHit(null, t);
    const bumpLit = last && 'ABC'.includes(last.kind) ? pulse(t, last.t, 0.15) : 0;
    this.ballMat.uniforms.env!.value = bumpLit;
    (this.pf.uniforms.ball!.value as THREE.Vector3).set(bp.u + 10, bp.v + 6, 1);
    this.pf.uniforms.gi!.value = 1 + 0.3 * f.a.kick;
    // 鏡頭：進場從側邊一點滑進來（第一拍前後落定），之後很慢地往前推、每兩小節往另一邊輕輕搖，大鼓時往前頂一下。
    // 遠端剛好在背箱下緣、拍子在畫面下方（機位是用投影算出來的，再整個往下平移 VIEW_DY）
    const mv = camMove(this.ctx.audio, s, this.ctx.end, t, { inYaw: 1, inZoom: 1, push: 1, sway: 0.35 });
    this.cam.position.set(-160 * mv.yaw, 800 - 30 * mv.zoom, 900 - 50 * mv.zoom - 6 * f.a.kick);
    this.cam.lookAt(-40 * mv.yaw, 0, -800);
    this.cam.setViewOffset(W, H, 0, VIEW_DY, W, H);
    this.cam.updateMatrixWorld();
    this.ballMat.uniforms.cameraPosition!.value.copy(this.cam.position);
    renderer.setRenderTarget(out);
    renderer.clearDepth();
    renderer.render(this.scene3, this.cam);
    // 火花：每次撞到（L 通道除外）從碰撞點噴一小撮
    const sp = this.sparks; sp.clear();
    const hitsNear = this.hits.filter((h) => h.kind !== 'L' && h.t <= t && t - h.t < 0.5);
    for (const h of hitsNear) {
      const at = this.screen(h.u, h.v);
      sparkParticles(sp, t, (tb) => (tb >= h.t && tb < h.t + 0.07 ? at : null), { rate: 640, life: 0.42, speed: 400, gravity: 600, seed: Math.floor(h.t * 100) + 7, width: 2, intensity: 1.3 });
    }
    if (sp.count) sp.render(renderer, out);
    this.drawBox(t, out);
    return { bloom: 0.75, halation: 0.3, vignette: 0.5 };
  }

  override dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    super.dispose();
  }
}
void hash;
