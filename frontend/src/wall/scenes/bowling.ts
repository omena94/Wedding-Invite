// 保齡球道（暗）：夜裡只剩一條球道亮著燈，鏡頭貼著球道、低低地看著十支球瓶與後面的布幕（沒有人，只有球）。
//  - 第一拍：一顆球從鏡頭底下滾進畫面（很大、很近），沿著球道往球瓶滾過去、越來越小，球道上有它的倒影；
//    小節線上正中球瓶——全倒：畫面一震、燈一閃，十支球瓶往後、往兩邊飛出去掉進球坑。
//  - 窗格夠長時每兩個小節再打一球：球瓶在拍點上一支一支「彈」回瓶台，下一顆球滾進來，又是一個全倒
//    （計分螢幕的格子一格一格打上 X，跑馬燈整圈亮一下）。窗格裡一直有事情照拍子發生。
//  - 主打留言在後面的布幕上（燈泡排成的字，畫面的焦點）：全倒之前布幕是暗的，
//    球瓶一倒，字從左到右一個一個亮起來（掠過一點訊號色），字外面一圈跑馬燈跟著拍子跑起來。署名在最後一行下面。
//    留言標準 v2：字 40～60（螢幕上，照鏡頭換算到布幕的畫布），燈框只比字大一點（≤ 860×430），
//    字都在球瓶頂的高度以上（球瓶彈回來時不會擋到字）。
//  - 歌詞在上方吊著的計分螢幕上，照跟唱規則逐字變色；螢幕角落一排小格子，每次全倒打上一個 X。
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
import { lyricAt, layoutLyric, drawLyric, COUPLE_ZH, lyricSubOf, subSizeFor, subGap, type LyricStyle } from './_motifs';
import { fitText } from '../engine/text';
import { V2, lyricV2 } from './_v2';
import {
  T25_TEXT, T25_INVITE, sigOf, winBars, winBeats, stagger, layMsgV2, msgGlyphs, glyphMask, glyphStates,
  type GlyphMask, type MsgLay, type Rect, type MaskGlyph,
} from './_t25';
import { BowlingRig, BACK, BACK_PX, PINS, BALL_R, MAXG } from './bowling-rig';

export const spec: PlateSpecDecl = { group: 'type', family: 'journey', paper: false, energy: [0.4, 1], bars: [4, 8] };

/**
 * 布幕上字的範圍（布幕的畫布座標，每公尺 500 px）。最下面停在畫布 y = 370（布幕上離地 0.46 m）：
 * 從鏡頭看過去，球瓶頂（0.38 m）投到布幕上大約在這個高度，球瓶彈回瓶台時不會擋到字；最上面留一圈給燈框。
 */
const BOX = { x: 800 - 470, y: 64, w: 940, h: 306 };
/** 燈框比字大多少（畫布 px）：燈泡一圈 30、再空一點。 */
const FRAME_PAD = 46;
/** 計分螢幕（畫面座標）。 */
const MON = { x: 520, y: 40, w: 880, h: 176 };
const FAM_MSG = F.hei(900);
const FAM_LYR = F.archivo(100, 800);

/** 沒有字的時候給布幕的空字模（1×1 透明）。 */
const EMPTY = () => shared('bowling.empty', () => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; });

/** 鏡頭（公尺）。 */
const CAM0 = { x: 0, y: 0.3, z: 2.75 }, LOOK = { x: 0, y: 0.46, z: -1.8 };

/** 一球：出手、正中、（第二球起）球瓶彈回瓶台的時間。 */
interface Throw { rel: number; hit: number; reset: number }

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
  /** 有原文副行（韓文歌）的句子：字模裡前幾個字是中文（後面接著原文）。 */
  lyrMain = new Map<Line, number>();
  lay: MsgLay | null = null;
  times: number[] = [];
  throws: Throw[] = [];
  /** 燈框（布幕畫布座標 x0, y0, x1, y1）。 */
  frame: [number, number, number, number] = [BOX.x, BOX.y, BOX.x + BOX.w, BOX.y + BOX.h];
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 52, minSize: V2.lyrMin, maxWidth: MON.w - 80, align: 'center' };
  /** 每支球瓶飛出去的速度、轉軸、轉速、延遲（每一球不一樣）。 */
  fly: { v: THREE.Vector3; axis: THREE.Vector3; w: number; d: number }[][] = [];
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v3 = new THREE.Vector3();

  get tHit() { return this.throws[0]!.hit; }

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 0.5, e + 0.5);
    await loadText(`${T25_TEXT}${m?.text ?? ''}${m ? sigOf(m) : ''}${lines.map((l) => l.text).join('')}${song.title}X`);
    const beat = au.beatPeriod(s);
    const bar = au.timeOfBar(au.barAt(s) + 1) - au.timeOfBar(au.barAt(s));
    // 第一拍出手；全倒在出手之後至少一拍半的第一個小節線（短的窗格就兩拍之後）
    const rel0 = winBeats(au, s + 0.1, e)[0] ?? s + 0.2;
    const bars = winBars(au, s, e);
    const hit0 = bars.find((b) => b >= rel0 + beat * 1.5 && b <= rel0 + bar * 1.6) ?? rel0 + beat * 2;
    this.throws = [{ rel: rel0, hit: hit0, reset: -Infinity }];
    // 之後每兩個小節再打一球：正中前四拍球瓶彈回去、前兩拍出手；最後一球之後至少留一秒看球瓶飛
    for (;;) {
      const prev = this.throws[this.throws.length - 1]!;
      const hb = au.barAt(prev.hit);
      const hit = au.timeOfBar(Math.round(hb) + 2);
      if (hit > e - 1.0) break;
      const bh = au.beatAt(hit);
      this.throws.push({ rel: au.timeOfBeat(bh - 2), hit, reset: au.timeOfBeat(bh - 4) });
    }

    // ---- 布幕上的字：鏡頭推近的中段，布幕畫布 1 px 在螢幕上幾 px（字級照螢幕 px 換算）
    const k = BACK.px / this.backPxPerMeter((hit0 + e) / 2);
    const c = document.createElement('canvas').getContext('2d')!;
    const boxes: Rect[] = [];
    if (m) {
      const lay = layMsgV2(c, m.text, sigOf(m), FAM_MSG, BOX, { k, lineHeight: 1.26, maxLines: 4, sigFamily: F.hei(500), align: 'center' });
      this.lay = lay;
      boxes.push(lay.box);
      const items = msgGlyphs(this.lay);
      this.mask = this.track(glyphMask(items, [0, 0, BACK_PX.w, BACK_PX.h], 1, 2));
      // 全倒之後依序亮：最多四分之三小節
      this.times = stagger(au, hit0 + 0.02, items.length, Math.max(0.5, Math.min(bar * 0.75, 0.4 * (e - hit0))));
      this.lyrStyle = { ...this.lyrStyle, size: lyricV2(lay.screen) };
    } else {
      // 沒有留言：每句歌詞各一張字模（布幕上的燈泡字，焦點；歌詞一樣照 v2 的上限 52）
      for (const ln of lines) {
        const sub = lyricSubOf(ln);
        if (sub) {
          // 原文副行：同一塊布幕、同樣的燈泡字，中文正下方小一號；中文＋原文整塊在字的範圍裡置中（燈框跟著包住）
          const r = this.subLayout(c, ln.text, sub.text, k);
          boxes.push(r.box);
          this.lyrMain.set(ln, r.nMain);
          this.lyrMasks.set(ln, this.track(glyphMask(r.items.slice(0, MAXG), [0, 0, BACK_PX.w, BACK_PX.h], 1, 2)));
          continue;
        }
        const fit = layMsgV2(c, ln.text, '', FAM_LYR, BOX, { k, max: V2.lyrMax, lineHeight: 1.15, maxLines: 2, align: 'center' });
        boxes.push(fit.box);
        // 排版的字 → 每個字（跟 glyphStates 的順序一樣：只算非空白）
        // 沒有原文的句子照舊最多 64 個字（MAXG 為了原文放寬了，這裡不跟著變，畫面才跟以前一模一樣）
        const items: MaskGlyph[] = msgGlyphs(fit).slice(0, 64);
        this.lyrMasks.set(ln, this.track(glyphMask(items, [0, 0, BACK_PX.w, BACK_PX.h], 1, 2)));
      }
      if (!lyrics.linesIn(s, e).length) {
        this.lay = layMsgV2(c, COUPLE_ZH, '', FAM_MSG, BOX, { k, maxLines: 1, align: 'center' });
        boxes.push(this.lay.box);
        this.mask = this.track(glyphMask(msgGlyphs(this.lay), [0, 0, BACK_PX.w, BACK_PX.h], 1, 2));
        this.times = stagger(au, hit0 + 0.02, this.lay.glyphs.length, bar * 0.5);
      }
    }
    // 燈框：包住這個窗格會出現的所有字（歌詞一句一句換，框不要跟著跳）
    if (boxes.length) {
      const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
      const x1 = Math.max(...boxes.map((b) => b[0] + b[2])), y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
      // 左右對稱（字置中，框也置中）
      const hw = Math.max(800 - x0, x1 - 800) + FRAME_PAD;
      this.frame = [800 - hw, y0 - FRAME_PAD, 800 + hw, y1 + FRAME_PAD];
    }

    // ---- 球瓶飛出去：離 1 號瓶越遠越晚被撞到；往後、往兩邊、往上，轉得很快（每一球飛法不一樣）
    this.throws.forEach((_, j) => {
      this.fly.push(PINS.map(([x, z], i) => {
        const r = (kk: number) => hash(this.seed, i + j * 17, kk);
        const side = x === 0 ? (r(1) - 0.5) * 2 : Math.sign(x);
        return {
          v: new THREE.Vector3(side * (0.7 + 1.3 * r(2)) + x * 1.5, 1.3 + 1.4 * r(3), -(1.4 + 1.6 * r(4))),
          axis: new THREE.Vector3(r(5) - 0.5, r(6) - 0.5, r(7) - 0.5).normalize(),
          w: 9 + 9 * r(8),
          d: Math.hypot(x, z) / 5,
        };
      }));
    });
  }

  /**
   * 中文＋原文的燈泡字排版（布幕畫布 px；k = 畫布 px／螢幕 px）：先照螢幕字級排原文（subSizeFor），
   * 扣掉原文要的高度再排中文，原文基線離中文最後一行 subGap；整塊在字的範圍裡垂直置中。
   * 原文的字標記 128（shader 用它畫得比中文安靜），序號接在中文後面。
   */
  private subLayout(c: CanvasRenderingContext2D, main: string, sub: string, k: number) {
    const sfit = fitText(c, sub, FAM_LYR, BOX.w, BOX.h, { min: 26 * k, max: subSizeFor(V2.lyrMax) * k, lineHeight: 1.15, maxLines: 2 });
    const room = subGap(V2.lyrMax, sfit.size / k) * k + (sfit.lines.length - 1) * sfit.lineHeight + sfit.size * 0.25;
    const fit = layMsgV2(c, main, '', FAM_LYR, { ...BOX, h: BOX.h - room }, { k, max: V2.lyrMax, lineHeight: 1.15, maxLines: 2, align: 'center', valign: 'top' });
    const mainItems = msgGlyphs(fit);
    const sBase = fit.lines[fit.lines.length - 1]!.y + subGap(fit.screen, sfit.size / k) * k;
    const cx = BOX.x + BOX.w / 2;
    const subItems: MaskGlyph[] = [];
    c.font = font(FAM_LYR, sfit.size);
    sfit.lines.forEach((ln, r) => {
      const x0 = cx - c.measureText(ln).width / 2;
      let pre = '';
      for (const ch of Array.from(ln)) {
        const x = x0 + (pre ? c.measureText(pre).width : 0);
        pre += ch;
        if (!ch.trim()) continue;
        subItems.push({ ch, x, y: sBase + r * sfit.lineHeight, w: c.measureText(ch).width, size: sfit.size, family: FAM_LYR, idx: mainItems.length + subItems.length, tag: 128 });
      }
    });
    const top = fit.lines[0]!.y - fit.fit.size * 0.88, bot = sBase + (sfit.lines.length - 1) * sfit.lineHeight + sfit.size * 0.25;
    const dy = BOX.y + Math.max(0, (BOX.h - (bot - top)) / 2) - top;
    const items = [...mainItems, ...subItems].map((g) => ({ ...g, y: g.y + dy }));
    const x0 = Math.min(...items.map((g) => g.x)), x1 = Math.max(...items.map((g) => g.x + g.w));
    return { items, nMain: mainItems.length, box: [x0, top + dy, x1 - x0, bot - top] as Rect };
  }

  /** 鏡頭：低低地貼著球道，整個窗格慢慢往前推；每次全倒震一下。 */
  private setCam(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const push = ease.inOutQuad(prog(t, s, e));
    const shake = this.throws.length ? Math.max(...this.throws.map((th) => pulse(t, th.hit, 0.08))) : 0;
    this.cam.position.set(CAM0.x + shake * 0.012 * Math.sin(t * 90), CAM0.y + 0.03 * push + shake * 0.01, CAM0.z - 0.35 * push);
    this.cam.lookAt(LOOK.x, LOOK.y + 0.02 * push, LOOK.z);
    this.cam.updateMatrixWorld();
    return shake;
  }

  /** 布幕畫布上的點 → 螢幕 px。 */
  private backToScreen(px: number, py: number) {
    this.v3.set(-BACK.w / 2 + px / BACK.px, BACK.y0 + BACK.h - py / BACK.px, BACK.z).project(this.cam);
    return { x: (this.v3.x * 0.5 + 0.5) * W, y: (0.5 - this.v3.y * 0.5) * H };
  }

  /** 在 t 的鏡頭下，布幕上（字那一帶）1 公尺是幾個螢幕 px。 */
  private backPxPerMeter(t: number) {
    this.setCam(t);
    // 布幕畫布上相距 500 px 的兩點（字那一帶的高度）
    const a = this.backToScreen(800 - 250, 220), b = this.backToScreen(800 + 250, 220);
    return (b.x - a.x) / (500 / BACK.px);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig;
    const TH = this.throws;
    const lastHitIdx = TH.reduce((acc, th, i) => (th.hit <= t ? i : acc), -1);

    // ---- 球：出手（從鏡頭底下進來）→ 沿球道滾（往左一點再勾回來）→ 撞上 1 號瓶 → 掉進球坑
    const bj = TH.reduce((acc, th, i) => (th.rel - 0.05 <= t ? i : acc), 0);
    const th = TH[bj]!;
    const after = t - th.hit;
    const z0 = 3.05, zHit = 0.12;
    let bx: number, by = BALL_R, bz: number;
    if (t < th.hit) {
      const k = prog(t, th.rel, th.hit);
      bz = z0 + (zHit - z0) * k;
      // 每一球的弧度不太一樣（左勾、右勾）
      const hook = bj % 2 ? 0.13 : -0.16;
      bx = hook * Math.sin(Math.PI * k) + 0.05 * k;
    } else {
      bz = zHit - 2.6 * after;
      bx = 0.05 - 0.2 * after;
      if (bz < -1.0) by = BALL_R - 5 * (after - (zHit + 1.0) / 2.6) ** 2;
    }
    rig.ball.visible = t >= th.rel - 0.05 && by > -0.6;
    rig.ballR.visible = rig.ball.visible && t < th.hit;
    rig.ball.position.set(bx, by, bz);
    // 滾：繞 x 軸（前進的距離 / 半徑），加一點側旋
    this.e.set(-(z0 - bz) / BALL_R, 0.4, 0.15 * (z0 - bz));
    rig.ball.quaternion.setFromEuler(this.e);
    rig.ballR.position.copy(rig.ball.position); rig.ballR.quaternion.copy(rig.ball.quaternion);

    // ---- 球瓶：站著 → 全倒飛出去、翻滾、掉進球坑 →（下一球）在拍點上一支一支彈回瓶台
    const next = TH[lastHitIdx + 1];
    const standing = lastHitIdx < 0 || (next !== undefined && t >= next.reset);
    PINS.forEach(([x, z], i) => {
      const pin = rig.pins[i]!, pr = rig.pinsR[i]!;
      let sc = 1;
      if (standing) {
        pin.position.set(x, 0, z);
        pin.quaternion.identity();
        // 彈回來：前排先、後排晚一點（一支一支），稍微彈過頭再停住
        if (next && lastHitIdx >= 0) {
          const t0 = next.reset + (Math.hypot(x, z) / 0.9) * au.beatPeriod(t) * 0.5;
          sc = t < t0 ? 0 : clamp(ease.outBack(prog(t, t0, t0 + 0.22), 2.2), 0, 1.2);
        }
      } else {
        const fl = this.fly[lastHitIdx]![i]!;
        const tau = t - TH[lastHitIdx]!.hit - fl.d;
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
      }
      pin.scale.setScalar(Math.max(1e-3, sc));
      pin.visible = pin.position.y > -0.5 && sc > 0.01;
      // 倒影只給站在球道上的球瓶（飛起來的倒影會在球道底下亂飄）
      pr.position.copy(pin.position); pr.quaternion.copy(pin.quaternion); pr.scale.copy(pin.scale);
      pr.visible = pin.visible && pin.position.y < 0.01 && pin.quaternion.w > 0.9999;
    });

    // ---- 燈與布幕
    const flash = Math.max(...TH.map((x) => pulse(t, x.hit, 0.12)));
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
      const sub = lyricSubOf(ly.line), nMain = this.lyrMain.get(ly.line);
      if (sub && nMain !== undefined) {
        // 中文照原本的跟唱；後面接著原文（逐字時間是原文自己的），一唱到就用「唱完」的顏色（shader 再淡兩成）
        const ss = glyphStates(sub, t);
        for (let i = 0; i < MAXG; i++) {
          if (i < nMain) { const g = st[i]; gs[i]!.set(g ? g.p : 0, g?.done ? 1 : 0); } else { const g = ss[i - nMain]; gs[i]!.set(g ? g.p : 0, 1); }
        }
      } else for (let i = 0; i < MAXG; i++) { const g = st[i]; gs[i]!.set(g ? g.p : 0, g?.done ? 1 : 0); }
    } else {
      bu.uMode!.value = 0;
      bu.uMask!.value = this.mask?.tex ?? EMPTY();
      bu.uLyrA!.value = 1;
    }
    (bu.uRect!.value as THREE.Vector4).set(0, 0, BACK_PX.w, BACK_PX.h);
    (bu.uFrame!.value as THREE.Vector4).set(...this.frame);
    bu.uShown!.value = this.mask ? shown : -1;
    // 跑馬燈：全倒之後，每半拍跑一格；每次全倒整圈一起亮一下
    bu.uChase!.value = Math.floor(au.beatAt(t) * 2);
    bu.uMarq!.value = t >= this.tHit ? 1 : 0;
    bu.uBurst!.value = TH.some((x) => t >= x.hit && t < x.hit + au.beatPeriod(t) * 0.5) ? 1 : 0;

    // ---- 鏡頭
    const shake = this.setCam(t);
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
    // 螢幕上的一排小格子（十格），每次全倒打一個 X（「刷」地畫上去）
    const cell = 26;
    for (let i = 0; i < 10; i++) {
      const x = sx + sw - 16 - (10 - i) * (cell + 4), y = sy + 12;
      c.strokeStyle = rgba('ash', 0.35); c.lineWidth = 1.5; c.strokeRect(x, y, cell, cell);
      const hx = TH[i]?.hit;
      if (hx !== undefined && t >= hx + 0.15) {
        const k = ease.outCubic(prog(t, hx + 0.15, hx + 0.3));
        c.strokeStyle = rgba('signal'); c.lineWidth = 3;
        c.beginPath();
        c.moveTo(x + 6, y + 6); c.lineTo(x + 6 + (cell - 12) * Math.min(1, k * 2), y + 6 + (cell - 12) * Math.min(1, k * 2));
        if (k > 0.5) { const k2 = (k - 0.5) * 2; c.moveTo(x + cell - 6, y + 6); c.lineTo(x + cell - 6 - (cell - 12) * k2, y + 6 + (cell - 12) * k2); }
        c.stroke();
      }
    }
    if (this.msg && ly) {
      const lay = layoutLyric(c, ly.line, this.lyrStyle);
      c.save(); c.translate(MON.x + MON.w / 2, sy + sh / 2 + lay.size * 0.36 + 10 - (lay.height - lay.size) / 2);
      drawLyric(c, ly.line, t, this.lyrStyle, lay, ly.k);
      c.restore();
    } else if (!lyrics.linesIn(s, e).length) {
      c.font = font(FAM_LYR, this.lyrStyle.size); c.textAlign = 'center'; c.fillStyle = rgba('bone', 0.85);
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

    const fa = this.backToScreen(this.frame[0], this.frame[1]), fb = this.backToScreen(this.frame[2], this.frame[3]);
    return {
      bloom: 0.8, vignette: 0.5, halation: 0.3,
      flash: flash * 0.08,
      shake: [shake * 4, shake * 6],
      zoom: 1 + shake * 0.015,
      popupAvoid: [[MON.x, MON.y, MON.w, MON.h], [fa.x, fa.y, fb.x - fa.x, fb.y - fa.y]],
    };
  }
}
