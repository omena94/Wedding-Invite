// 燭光（暗、慢歌）：坐在長桌對面看過去，一排七根細長的蠟燭站在鋪著亞麻桌布的桌上，房間是暗的。
// 第一個拍點起，仙女棒的火花從左邊飛進來，一拍一根把蠟燭點亮（拍與拍之間用強烈緩動跳到下一根燭芯）；
// 每點亮一根，它下面那一段桌布的前擺就被照亮——主打留言是用紙白的線「繡」在前擺上的，跟著燭光一段一段亮起來，
// 七根都點著時整則讀得到。燭焰在 hi-hat 上被吹歪一下、大鼓時長高一點。歌詞在燭焰上方的暗處（逐字跟唱）。
// 這是整晚唯一用 three.js 真的 3D mesh 畫的版面（candles-rig.ts）：蠟燭透光、黃銅高光、布褶都跟著燭光變。
// 鏡頭整個窗格很慢地往前推一點點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE, makeRT, sharedMSAA } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, noise1, springStep, lerp } from '../engine/util';
import { fitText } from '../engine/text';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, beatAfter, signature, drawMessage, type LyricStyle } from './_motifs';
import { no3, INVITE_SMALL, preloadText, fitWithSig } from './_t19';
import { makeRig, U, N, EDGE_Z, CANDLE_Z, candleX, wickTop } from './candles-rig';

export const spec: PlateSpecDecl = { group: 'type', family: 'light', paper: false, energy: [0, 0.6], bars: [4, 12], lyricsOnly: true };

/** 鏡頭：在桌子正前方略高，往下看一點點；x 偏右，蠟燭那一排落在畫面左邊三分之二（右側留給即時小卡）。 */
const CAM = { x: 0.52, y: 0.75, z: 5.5, ty: -0.05, push: 0.045 };
/** 留言貼圖對應到的畫面範圍（窗格中段的鏡頭下）：前擺的上半段。 */
const TEX = { x: 130, y: 585, w: 1200, h: 400 };
/** 左邊的網格線：小標、歌詞、留言、註腳都對齊這裡。 */
const LX = 150;
const LABEL_Y = 112;
const LYR_Y = 184;
const FOOT_Y = 975;
const FOOTNOTE = '＊燭光為程式模擬，請勿對螢幕許願。';
const EMPTY = '今晚的燭光，缺你一句祝福。';
/** 歌詞比留言小一級（留言才是焦點，MV 融合原則）。 */
const LYR: LyricStyle = { family: F.archivo(100, 700), size: 52, minSize: 48, maxWidth: 1180 };

// 背景：暖暖的暗房間，燭光後面的牆上有一點點光（每根點著的蠟燭一團，很淡）
const BG = () => new FSPass(/* glsl */ `
  uniform vec3 uF[${N}];
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK * (0.92 + 0.16 * fbm(p / 640.0, 2));
    col = mix(col, C_INK2, 0.55 * smoothstep(760.0, 160.0, p.y));
    float g = 0.0;
    for (int i = 0; i < ${N}; i++) { vec2 d = (p - uF[i].xy) / vec2(400.0, 250.0); g += uF[i].z * exp(-dot(d, d) * 1.6); }
    col += mix(C_BLOOD, C_SIGNAL, 0.35) * g * 0.02;
    fragColor = vec4(col, 1.0);
  }`, { uF: { value: Array.from({ length: N }, () => new THREE.Vector3()) } });

type P3 = { x: number; y: number; z: number };

export default class Candles extends Scene {
  rig = shared('candles.rig', makeRig);
  bg = shared('candles.bg', BG);
  /**
   * 3D 畫進 MSAA 的目標（蠟燭是細長的直線，不抗鋸齒會一直閃）。整晚共用一張、不釋放：
   * 一張約 80～100 MB 顯示記憶體，每個燭光窗格都重建的話第一格會卡一下。每格都整張蓋過（背景 pass 先畫滿），不怕殘留上一個窗格的畫面。
   */
  rt = sharedMSAA();
  text = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 繡在前擺上的留言（init 畫一次，當成桌布 shader 的貼圖）。 */
  cloth = this.track(new Layer2D(TEX.w, TEX.h, Math.min(2, SCALE * 1.5), { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) >>> 0;
  /** 每根蠟燭點著的時間、點燈的間隔（拍或半拍）、一拍多長。 */
  tl: number[] = [];
  dt = 0.5;
  beat = 0.5;
  tEnter = 0;
  rect = new THREE.Vector4();
  avoid: [number, number, number, number][] = [];
  /** 歌詞：有留言時比留言小一級，沒有留言時歌詞就是焦點、大一點。 */
  lyr: LyricStyle = { ...LYR, size: this.msg ? LYR.size : 62 };
  label = '';
  private tmp = new THREE.Vector3();

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    await preloadText(this.ctx, `${m?.text ?? ''}${signature(m?.name ?? '')}${EMPTY}${INVITE_SMALL}${FOOTNOTE}燭光已點燃燃燒時間一整晚支新人${song.title}${song.artist}`);

    // ---- 點燈的時間：第一個拍點起一拍一根；整排點完不超過 1.5 小節、也不超過窗格的 45%（拍太長就半拍、四分之一拍一根）
    this.beat = au.beatPeriod(s + 0.1);
    const b0 = au.barAt(s + 0.1);
    const bar = Math.max(this.beat * 2, au.timeOfBar(Math.floor(b0) + 1) - au.timeOfBar(Math.floor(b0)));
    const budget = Math.min(1.5 * bar, 0.45 * (e - s));
    let step = 1;
    while ((N - 1) * step * this.beat > budget && step > 0.25 + 1e-6) step /= 2;
    const bi = Math.ceil(au.beatAt(beatAfter(au, s + 0.12)) - 1e-6);
    this.tl = Array.from({ length: N }, (_, k) => au.timeOfBeat(bi + k * step));
    this.dt = step * this.beat;
    this.tEnter = this.tl[0]! - clamp(this.beat * 1.1, 0.35, 0.9);

    // ---- 留言貼圖在前擺上的位置：用窗格中段的鏡頭，把畫面上的框反投影到前擺平面
    this.setCam(0.5);
    const a = this.toDrape(TEX.x, TEX.y), b = this.toDrape(TEX.x + TEX.w, TEX.y + TEX.h);
    this.rect.set(a.x, b.y, b.x, a.y);

    // ---- 繡字（畫一次）
    const L = this.cloth, c = L.ctx;
    L.clear();
    const x0 = LX - TEX.x;
    let top = 0, bottom = 0, right = 0;
    if (m) {
      // 手寫體用粗的那一款：繡在布上也要遠遠一眼讀得到
      const fam = F.hand(700);
      // 很短的留言（「♥♥♥」、「恭喜！」）可以更大：愛心這個字形本來就比字小一圈
      // 字級依「可用高度扣掉署名那一列」找（fitWithSig）：署名一定在最後一行下面，整塊也放得進前擺的貼圖
      const blk = fitWithSig(c, m.text, fam, 1140, 360, { min: 48, max: Array.from(m.text).length <= 4 ? 150 : 116, lineHeight: 1.26, maxLines: 5 }, { ratio: 0.5, min: 44, max: 62 });
      const fit = blk.fit;
      const sig = signature(m.name);
      const sigSize = blk.sigSize;
      top = 18 + Math.max(0, (360 - blk.height) * 0.32);
      const base = top + fit.size;
      drawMessage(c, fit, fam, x0, base, { color: rgba('bone') });
      c.font = font(fam, sigSize);
      const sw = c.measureText(sig).width;
      const sx = Math.min(x0 + 1140, Math.max(x0 + fit.width, x0 + sw)) - sw;
      const sy = base + (fit.lines.length - 1) * fit.lineHeight + blk.sigDy;
      c.fillStyle = mixRgba('bone', 'ash', 0.35);
      c.fillText(sig, sx, sy);
      if (m.couple) {
        c.font = font(F.mono(500), 18); c.letterSpacing = '3px'; c.fillStyle = rgba('signal');
        c.fillText('FROM THE COUPLE · 新人', x0, sy - 6);
        c.letterSpacing = '0px';
      }
      bottom = sy + sigSize * 0.25;
      right = x0 + Math.max(fit.width, sx + sw - x0);
    } else {
      const fam = F.hand(700);
      // 沒有留言：桌布上的標語是配角（焦點是上方的歌詞），字小一級
      const fit = fitText(c, EMPTY, fam, 1140, 150, { min: 48, max: 64, lineHeight: 1.25, maxLines: 2 });
      top = 60;
      const base = top + fit.size * 0.9;
      drawMessage(c, fit, fam, x0, base, { color: rgba('bone') });
      const y2 = base + (fit.lines.length - 1) * fit.lineHeight + 78;
      c.font = font(F.hei(500), 30); c.letterSpacing = '2px'; c.fillStyle = mixRgba('bone', 'ash', 0.45);
      c.fillText(INVITE_SMALL, x0, y2);
      c.letterSpacing = '0px';
      bottom = y2 + 10;
      right = x0 + Math.max(fit.width, c.measureText(INVITE_SMALL).width + 60);
    }
    L.upload();
    // 即時小卡避開：上方的歌詞帶、前擺上的字（鏡頭會推近一點，四周多留 30 px）
    this.avoid = [
      [LX - 12, LABEL_Y - 22, 1210, LYR_Y - LABEL_Y + 50],
      [TEX.x + x0 - 30, TEX.y + top - 30, right + 60, bottom - top + 60],
    ];
    const no = m ? `  ·  ${no3(m.n)}` : '';
    this.label = `燭光 CANDLELIGHT${no}  ·  `;
  }

  /** 鏡頭：整個窗格很慢地往前推（p 0..1）。 */
  private setCam(p: number) {
    const cam = this.rig.cam;
    cam.position.set(CAM.x, CAM.y, CAM.z * (1 - CAM.push * p));
    cam.lookAt(CAM.x, CAM.ty, 0);
    cam.updateMatrixWorld();
  }

  /** 畫面上的一點打到前擺平面（z = EDGE_Z）的世界座標。 */
  private toDrape(sx: number, sy: number) {
    const cam = this.rig.cam;
    const v = new THREE.Vector3((sx / W) * 2 - 1, 1 - (sy / H) * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    const k = (EDGE_Z - cam.position.z) / v.z;
    return { x: cam.position.x + v.x * k, y: cam.position.y + v.y * k };
  }

  private toScreen(p: P3) {
    const v = this.tmp.set(p.x, p.y, p.z).project(this.rig.cam);
    return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
  }

  private wick(k: number): P3 { return { x: candleX(k), y: wickTop(k) + 0.006, z: CANDLE_Z }; }

  /** 仙女棒的火花（世界座標與亮度）：從左邊飛進來 → 燭芯一根跳一根 → 點完最後一根往右上飛走。 */
  private headAt(t: number): (P3 & { k: number }) | null {
    const tl = this.tl;
    if (t < this.tEnter) return null;
    if (t < tl[0]!) {
      const u = prog(t, this.tEnter, tl[0]!, ease.outCubic), w = this.wick(0);
      return { x: lerp(-2.7, w.x, u), y: lerp(1.05, w.y, u) + 0.12 * Math.sin(Math.PI * u), z: CANDLE_Z, k: 1 };
    }
    for (let i = 1; i < N; i++) {
      if (t < tl[i]!) {
        const a = this.wick(i - 1), b = this.wick(i);
        const u = prog(t, tl[i - 1]! + this.dt * 0.28, tl[i]!, ease.inOutQuart);
        return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) + 0.075 * Math.sin(Math.PI * u), z: CANDLE_Z, k: 1 };
      }
    }
    const a = t - tl[N - 1]!;
    if (a > 0.95) return null;
    const w = this.wick(N - 1), u = prog(a, 0.22, 0.95, ease.inCubic);
    return { x: w.x + 0.75 * u, y: w.y + 0.5 * u, z: CANDLE_Z, k: 1 - u };
  }

  /** hi-hat 把第 k 根燭焰吹歪的量（最近幾個 hi-hat 的阻尼擺動加總；方向用事件時間 hash，確定性）。 */
  private sway(k: number, t: number, hats: [number, number][]) {
    let v = 0.22 * noise1(t * 1.3 + k * 7.1, 11);
    for (const [et, s] of hats) {
      const local = t - et - k * 0.022;
      if (local <= 0) continue;
      const id = Math.round(et * 1000);
      const dir = hash(id, 7) < 0.5 ? -1 : 1;
      v += dir * s * (0.55 + 0.45 * hash(k, id)) * Math.exp(-local * 4.2) * Math.sin(local * 13) * (1 - Math.exp(-local * 40));
    }
    return v;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au, song } = this.ctx;
    const t = f.t;
    this.setCam(f.p);
    const cam = this.rig.cam;

    // ---- 每根蠟燭：長出來、閃爍、hi-hat 吹歪、大鼓長高
    const hats = au.events('hat', t - 0.9, t + 1e-4);
    const kick = f.a.kick;
    let lit = 0;
    const bgF = this.bg.u.uF!.value as THREE.Vector3[];
    for (let k = 0; k < N; k++) {
      const a = t - this.tl[k]!;
      const grow = a <= 0 ? 0 : clamp(springStep(a, 2.2, 0.42), 0, 1.3);
      if (a > 0) lit++;
      const fl = 0.06 * noise1(t * 6.3 + k * 11.1, 3) + 0.03 * noise1(t * 17 + k * 3.7, 5);
      const sw = this.sway(k, t, hats);
      U.uH.value[k] = grow * (1 + fl) * (1 + 0.1 * kick) * (1 - 0.06 * Math.abs(sw));
      U.uI.value[k] = Math.min(grow, 1.05) * (1 + fl * 0.8) * (1 + 0.06 * kick);
      U.uSway.value[k] = sw;
      U.uReveal.value[k] = prog(a, 0, 0.45, ease.outCubic);
      const w = this.wick(k);
      U.uL.value[k]!.set(w.x + sw * 0.008, w.y + 0.05, w.z);
      const sp = this.toScreen(U.uL.value[k]!);
      bgF[k]!.set(sp.x, sp.y, U.uI.value[k]!);
    }
    U.uAmb.value = 0.016 + 0.012 * (lit / N);
    U.uMsg.value = this.cloth.texture;
    U.uMsgRect.value.copy(this.rect);
    U.uMsgOn.value = 1;
    U.uRight.value.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();

    // ---- 3D：背景 → 桌布、燭台、蠟燭 → 燭焰（MSAA）→ 疊到 out
    this.bg.render(renderer, this.rt);
    renderer.setRenderTarget(this.rt);
    renderer.clearDepth();
    renderer.render(this.rig.scene, cam);
    comp.draw(renderer, this.rt.texture, out, { mode: 'replace', premult: false });

    // ---- 字：小標、歌詞（燭焰上方的暗處）、註腳
    const T = this.text, c = T.ctx;
    T.clear();
    const ly = lyricAt(lyrics, t);
    let rows = 1;
    if (ly) {
      const lay = layoutLyric(c, ly.line, this.lyr);
      rows = lay.rows.length;
      c.save(); c.translate(LX, rows > 1 ? LYR_Y - lay.size * 1.18 + 14 : LYR_Y);
      drawLyric(c, ly.line, t, this.lyr, lay, ly.k);
      c.restore();
    } else if (!lyrics.has) {
      // 純音樂：歌名只是配角（小字、低對比），不要變成跟留言搶焦點的大標題
      c.font = font(F.mono(500), 18); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.6 * prog(t, this.ctx.start, this.ctx.start + 0.6));
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LX, LYR_Y - 24);
      c.letterSpacing = '0px';
    }
    if (rows === 1) {
      c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.5);
      c.fillText(`${this.label}已點燃 ${lit}／${N}`, LX, LABEL_Y);
      c.letterSpacing = '0px';
    }
    c.font = font(F.mono(500), 15); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.36 * prog(t, this.tl[N - 1]!, this.tl[N - 1]! + 0.8));
    c.fillText(FOOTNOTE, LX, FOOT_Y);
    c.letterSpacing = '0px';
    comp.draw(renderer, T.upload(), out);

    // ---- 仙女棒
    this.glow.clear();
    const h = this.headAt(t);
    if (h && h.k > 0.02) {
      const head = (tb: number) => { const q = this.headAt(tb); return q ? this.toScreen(q) : null; };
      sparkParticles(this.glow, t, head, { rate: 95, life: 0.4, speed: 200, seed: this.seed + 5, intensity: h.k });
      const p = this.toScreen(h);
      sparkHead(this.glow, p.x, p.y, t, 0.85, h.k);
    }
    if (this.glow.count) this.glow.render(renderer, out);

    return { bloom: 0.85, bloomRadius: 0.8, halation: 0.3, vignette: 0.5, grain: 0.05, popupAvoid: this.avoid };
  }

  override dispose() {
    // 共用的道具不能釋放（下一個燭光窗格還要用），只把貼圖的參照拿掉
    if (U.uMsg.value === this.cloth.texture) U.uMsg.value = null;
    super.dispose();
  }
}
