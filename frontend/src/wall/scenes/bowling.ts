// 保齡球道（暗）：夜裡只剩一條球道亮著燈，鏡頭貼著球道、低低地看著十支球瓶與後面的布幕（沒有人，只有球）。
//  - 第一拍：一顆球從鏡頭底下滾進畫面（很大、很近），沿著球道往球瓶滾過去、越來越小，球道上有它的倒影；
//    小節線上正中球瓶——全倒：畫面一震、燈一閃，十支球瓶往後、往兩邊飛出去掉進球坑。
//  - 主打留言在後面的布幕上（燈泡排成的字，畫面的焦點）：全倒之前布幕是暗的、字的下半截被球瓶擋著；
//    球瓶一倒，字從左到右一個一個亮起來（掠過一點訊號色），四周一圈跑馬燈跟著拍子跑起來。署名在最後一行下面。
//  - 歌詞在上方吊著的計分螢幕上，照跟唱規則逐字變色；螢幕角落一排小格子，全倒之後第一格打上 X。
//  - 沒有留言：布幕上的燈泡字是歌詞（焦點，照跟唱規則），計分螢幕只剩一行小字邀請。純音樂：螢幕上是歌名。
// 手法：three.js 真的 3D（bowling-rig.ts：球道、球瓶、球、布幕都是自己寫的材質，打光在 shader 裡算），畫進共用的 MSAA 目標再貼到畫面；
// 布幕上的字是 init() 畫好的資料貼圖（_t25 glyphMask），shader 依每個字的進度點亮；計分螢幕是每格重畫的一張 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, clearRT, sharedMSAA } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse } from '../engine/util';
import { type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, lyricSizeFor, COUPLE_ZH, type LyricStyle } from './_motifs';
import {
  T25_TEXT, T25_INVITE, sigOf, winBars, winBeats, stagger, layMsg, msgGlyphs, glyphMask, glyphStates,
  type GlyphMask, type MsgLay, type Rect, type MaskGlyph,
} from './_t25';
import { BowlingRig, BACK, BACK_PX, PINS, BALL_R, MAXG } from './bowling-rig';

export const spec: PlateSpecDecl = { group: 'type', family: 'journey', paper: false, energy: [0.4, 1], bars: [4, 8] };

/**
 * 布幕上字的範圍（布幕的畫布座標，每公尺 500 px）。最下面停在畫布 y = 516（布幕上離地 0.17 m）：
 * 鏡頭推到最近時，兩側擋板的上緣投到布幕上約在離地 0.1 m、球道盡頭約 -0.08 m，署名不會被前景擋到。
 */
const BOX = { x: 150, y: 90, w: 1300, h: 426 };
/** 計分螢幕（畫面座標）。 */
const MON = { x: 520, y: 40, w: 880, h: 176 };
const FAM_MSG = F.hei(900);
const FAM_LYR = F.archivo(100, 800);

/** 沒有字的時候給布幕的空字模（1×1 透明）。 */
const EMPTY = () => shared('bowling.empty', () => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; });

/** 鏡頭（公尺）。 */
const CAM0 = { x: 0, y: 0.3, z: 2.75 }, LOOK = { x: 0, y: 0.46, z: -1.8 };

export default class Bowling extends Scene {
  rig = shared('bowling.rig', () => new BowlingRig());
  /** 全引擎共用的 MSAA 目標：同一格裡畫完就解析到 out，不 track、不釋放。 */
  rt = sharedMSAA();
  cam = new THREE.PerspectiveCamera(34, W / H, 0.03, 60);
  mon = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 7919) >>> 0;
  mask: GlyphMask | null = null;
  lyrMasks = new Map<Line, GlyphMask>();
  lay: MsgLay | null = null;
  times: number[] = [];
  tRel = 0;
  tHit = 0;
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 56, minSize: 48, maxWidth: MON.w - 80, align: 'center' };
  /** 每支球瓶飛出去的速度、轉軸、轉速、延遲。 */
  fly: { v: THREE.Vector3; axis: THREE.Vector3; w: number; d: number }[] = [];
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 0.5, e + 0.5);
    await loadText(`${T25_TEXT}${m?.text ?? ''}${m ? sigOf(m) : ''}${lines.map((l) => l.text).join('')}${song.title}X`);
    const beat = au.beatPeriod(s);
    const bar = au.timeOfBar(au.barAt(s) + 1) - au.timeOfBar(au.barAt(s));
    // 第一拍出手；全倒在出手之後至少一拍半的第一個小節線（短的窗格就兩拍之後）
    this.tRel = winBeats(au, s + 0.1, e)[0] ?? s + 0.2;
    const bars = winBars(au, s, e);
    this.tHit = bars.find((b) => b >= this.tRel + beat * 1.5 && b <= this.tRel + bar * 1.6) ?? this.tRel + beat * 2;

    const c = document.createElement('canvas').getContext('2d')!;
    if (m) {
      this.lay = layMsg(c, m.text, sigOf(m), FAM_MSG, BOX, { min: 76, max: 190, lineHeight: 1.22, maxLines: 4, sigFamily: F.hei(500), sigSize: [48, 64], fewer: 0.62 });
      const items = msgGlyphs(this.lay);
      this.mask = this.track(glyphMask(items, [0, 0, BACK_PX.w, BACK_PX.h], 1, 2));
      // 全倒之後依序亮：最多四分之三小節
      this.times = stagger(au, this.tHit + 0.02, items.length, Math.max(0.5, Math.min(bar * 0.75, 0.4 * (e - this.tHit))));
      this.lyrStyle = { ...this.lyrStyle, size: Math.min(58, lyricSizeFor(this.lay.fit.size * 0.8)) };
    } else {
      // 沒有留言：每句歌詞各一張字模（布幕上的燈泡字）
      for (const ln of lines) {
        const fit = layMsg(c, ln.text, '', FAM_LYR, BOX, { min: 96, max: 200, lineHeight: 1.15, maxLines: 2, fewer: 0.6 });
        // 排版的字 → 每個字（跟 glyphStates 的順序一樣：只算非空白）
        const items: MaskGlyph[] = msgGlyphs(fit).slice(0, MAXG);
        this.lyrMasks.set(ln, this.track(glyphMask(items, [0, 0, BACK_PX.w, BACK_PX.h], 1, 2)));
      }
      if (!lyrics.linesIn(s, e).length) {
        this.lay = layMsg(c, COUPLE_ZH, '', FAM_MSG, BOX, { min: 96, max: 200, maxLines: 1 });
        this.mask = this.track(glyphMask(msgGlyphs(this.lay), [0, 0, BACK_PX.w, BACK_PX.h], 1, 2));
        this.times = stagger(au, this.tHit + 0.02, this.lay.glyphs.length, bar * 0.5);
      }
    }

    // ---- 球瓶飛出去：離 1 號瓶越遠越晚被撞到；往後、往兩邊、往上，轉得很快
    PINS.forEach(([x, z], i) => {
      const r = (k: number) => hash(this.seed, i, k);
      const side = x === 0 ? (r(1) - 0.5) * 2 : Math.sign(x);
      this.fly.push({
        v: new THREE.Vector3(side * (0.7 + 1.3 * r(2)) + x * 1.5, 1.3 + 1.4 * r(3), -(1.4 + 1.6 * r(4))),
        axis: new THREE.Vector3(r(5) - 0.5, r(6) - 0.5, r(7) - 0.5).normalize(),
        w: 9 + 9 * r(8),
        d: Math.hypot(x, z) / 5,
      });
    });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig;
    const beat = au.beatPeriod(s);
    const after = t - this.tHit;

    // ---- 球：出手（從鏡頭底下進來）→ 沿球道滾（往左一點再勾回來）→ 撞上 1 號瓶 → 掉進球坑
    const z0 = 3.05, zHit = 0.12;
    let bx: number, by = BALL_R, bz: number;
    if (t < this.tHit) {
      const k = prog(t, this.tRel, this.tHit);
      bz = z0 + (zHit - z0) * k;
      bx = -0.16 * Math.sin(Math.PI * k) + 0.05 * k;
    } else {
      bz = zHit - 2.6 * after;
      bx = 0.05 - 0.2 * after;
      if (bz < -1.0) by = BALL_R - 5 * (after - (zHit + 1.0) / 2.6) ** 2;
    }
    rig.ball.visible = t >= this.tRel - 0.05 && by > -0.6;
    rig.ballR.visible = rig.ball.visible && t < this.tHit;
    rig.ball.position.set(bx, by, bz);
    // 滾：繞 x 軸（前進的距離 / 半徑），加一點側旋
    this.e.set(-(z0 - bz) / BALL_R, 0.4, 0.15 * (z0 - bz));
    rig.ball.quaternion.setFromEuler(this.e);
    rig.ballR.position.copy(rig.ball.position); rig.ballR.quaternion.copy(rig.ball.quaternion);

    // ---- 球瓶：全倒之前站著（被球擦到的那一刻微微晃一下），之後各自飛出去、翻滾、掉進球坑
    PINS.forEach(([x, z], i) => {
      const pin = rig.pins[i]!, pr = rig.pinsR[i]!;
      const fl = this.fly[i]!;
      const tau = after - fl.d;
      if (tau <= 0) {
        pin.position.set(x, 0, z);
        pin.quaternion.identity();
      } else {
        const g = -7.5;
        pin.position.set(x + fl.v.x * tau, fl.v.y * tau + 0.5 * g * tau * tau, z + fl.v.z * tau);
        // 繞著瓶身中間轉（先把轉軸放在瓶子的重心附近）
        this.q.setFromAxisAngle(fl.axis, fl.w * tau);
        pin.quaternion.copy(this.q);
        const cg = new THREE.Vector3(0, 0.15, 0).applyQuaternion(this.q);
        pin.position.add(new THREE.Vector3(0, 0.15, 0).sub(cg));
      }
      pin.visible = pin.position.y > -0.5;
      // 倒影只給站在球道上的球瓶（飛起來的倒影會在球道底下亂飄）
      pr.position.copy(pin.position); pr.quaternion.copy(pin.quaternion); pr.visible = tau <= 0.04;
    });

    // ---- 燈與布幕
    const flash = pulse(t, this.tHit, 0.12);
    const u = rig.u;
    u.uLight!.value = (0.85 + 0.15 * f.a.low) * (1 - 0.5 * ease.inCubic(prog(t, e - 0.3, e)));
    u.uFlash!.value = flash;
    const bu = rig.backMat.uniforms;
    let shown = 0;
    for (let i = 0; i < this.times.length; i++) {
      const k = clamp((t - this.times[i]!) / 0.12);
      if (k <= 0) break;
      shown = i + k;
    }
    const ly = lyricAt(lyrics, t);
    const lm = ly ? this.lyrMasks.get(ly.line) : undefined;
    if (lm && ly) {
      bu.uMode!.value = 1;
      bu.uMask!.value = lm.tex;
      bu.uLyrA!.value = ly.k;
      const st = glyphStates(ly.line, t);
      const gs = bu.uGs!.value as THREE.Vector2[];
      for (let i = 0; i < MAXG; i++) { const g = st[i]; gs[i]!.set(g ? g.p : 0, g?.done ? 1 : 0); }
    } else {
      bu.uMode!.value = 0;
      bu.uMask!.value = this.mask?.tex ?? EMPTY();
      bu.uLyrA!.value = 1;
    }
    (bu.uRect!.value as THREE.Vector4).set(0, 0, BACK_PX.w, BACK_PX.h);
    bu.uShown!.value = this.mask ? shown : -1;
    // 跑馬燈：全倒之後，每半拍跑一格
    bu.uChase!.value = Math.floor(au.beatAt(t) * 2);
    bu.uMarq!.value = t >= this.tHit ? 1 : 0;

    // ---- 鏡頭：低低地貼著球道，整個窗格慢慢往前推；全倒那一下震一下
    const push = ease.inOutQuad(prog(t, s, e));
    const shake = pulse(t, this.tHit, 0.08);
    this.cam.position.set(CAM0.x + shake * 0.012 * Math.sin(t * 90), CAM0.y + 0.03 * push + shake * 0.01, CAM0.z - 0.35 * push);
    this.cam.lookAt(LOOK.x, LOOK.y + 0.02 * push, LOOK.z);
    this.cam.updateMatrixWorld();
    clearRT(renderer, this.rt, [LIN.ink[0] * 0.25, LIN.ink[1] * 0.25, LIN.ink[2] * 0.25]);
    renderer.setRenderTarget(this.rt);
    renderer.render(rig.scene, this.cam);
    comp.draw(renderer, this.rt.texture, out, { mode: 'replace', premult: false });

    // ---- 計分螢幕：吊在上面（兩條吊線），螢幕上是歌詞；角落一排小格子
    const L = this.mon; L.clear();
    const c = L.ctx;
    c.strokeStyle = rgba('graphite', 0.8); c.lineWidth = 3;
    for (const x of [MON.x + 120, MON.x + MON.w - 120]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, MON.y); c.stroke(); }
    c.fillStyle = rgba('ink2'); c.beginPath(); c.roundRect(MON.x, MON.y, MON.w, MON.h, 12); c.fill();
    c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 2; c.stroke();
    const sx = MON.x + 16, sy = MON.y + 14, sw = MON.w - 32, sh = MON.h - 28;
    const scr = c.createLinearGradient(0, sy, 0, sy + sh);
    scr.addColorStop(0, rgba('ink', 1)); scr.addColorStop(1, rgba('ink2', 1));
    c.fillStyle = scr; c.fillRect(sx, sy, sw, sh);
    // 螢幕上的一排小格子（十格），全倒之後第一格打 X
    const cell = 26;
    for (let i = 0; i < 10; i++) {
      const x = sx + sw - 16 - (10 - i) * (cell + 4), y = sy + 12;
      c.strokeStyle = rgba('ash', 0.35); c.lineWidth = 1.5; c.strokeRect(x, y, cell, cell);
      if (i === 0 && t >= this.tHit + 0.15) {
        c.strokeStyle = rgba('signal'); c.lineWidth = 3;
        c.beginPath(); c.moveTo(x + 6, y + 6); c.lineTo(x + cell - 6, y + cell - 6); c.moveTo(x + cell - 6, y + 6); c.lineTo(x + 6, y + cell - 6); c.stroke();
      }
    }
    if (this.msg && ly) {
      const lay = layoutLyric(c, ly.line, this.lyrStyle);
      c.save(); c.translate(MON.x + MON.w / 2, sy + sh / 2 + lay.size * 0.36 + 10 - (lay.height - lay.size) / 2);
      drawLyric(c, ly.line, t, this.lyrStyle, lay, ly.k);
      c.restore();
    } else if (!lyrics.linesIn(s, e).length) {
      c.font = font(FAM_LYR, 52); c.textAlign = 'center'; c.fillStyle = rgba('bone', 0.85);
      c.fillText(`♪ ${song.title}`, MON.x + MON.w / 2, sy + sh / 2 + 28);
      c.textAlign = 'left';
    } else if (!this.msg) {
      c.font = font(F.hei(500), 22); c.letterSpacing = '3px'; c.textAlign = 'center'; c.fillStyle = rgba('ash', 0.75);
      c.fillText(T25_INVITE, MON.x + MON.w / 2, sy + sh / 2 + 24);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    // 螢幕的反光（斜的一道）
    const gl = c.createLinearGradient(sx, sy, sx + sw * 0.6, sy + sh);
    gl.addColorStop(0, rgba('bone', 0.05)); gl.addColorStop(0.5, rgba('bone', 0));
    c.fillStyle = gl; c.fillRect(sx, sy, sw, sh);
    comp.draw(renderer, L.upload(), out);

    return {
      bloom: 0.8, vignette: 0.5, halation: 0.3,
      flash: flash * 0.08,
      shake: [shake * 4, shake * 6],
      zoom: 1 + shake * 0.015,
      popupAvoid: [[MON.x, MON.y, MON.w, MON.h], [300, 280, 1320, 460]],
    };
  }
}
