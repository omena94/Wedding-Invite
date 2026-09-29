// 萬花尺（亮）：紙上一圈透明壓克力的大齒環（105 齒，齒在內側），訊號色的小齒輪（20 齒）貼著內緣滾，
// 筆插在齒輪靠邊的孔裡，畫出 21 瓣、瓣尖朝內的花（內擺線）。
//  - 一小節一圈：每一拍齒輪滾四分之一圈（拍點上出力、outQuart 停住）。筆畫是 GPU 細線（LineBatch），整條曲線每格照時間重算（確定性）。
//  - 105／20 = 21／4：轉滿四圈才會閉合。窗格不到四小節時，紙上已經有前幾圈淡淡的「上一位賓客畫的」，最後一拍剛好閉合；
//    閉合的那一拍整朵花亮一下。窗格更長就換到內側的孔再畫一層（訊號色的暗部），再閉合一次。
//  - 齒輪、筆也是 LineBatch（填滿的圓＝一段零長度的粗線），不用每格上傳一張大圖。
//  - 主打留言寫在花心（齒環正中央的紙上，手寫字），是畫面唯一的焦點；署名在下面。齒環拉近到上下出格（特寫）。
//    歌詞在左邊逐字跟唱，比留言小一級。小字只有兩小群：左上的器材與圈數、左下的冷面註腳。
//  - 沒有留言：歌詞寫在花心；純音樂又沒留言：花心放邀請。
//  - 標準 v2：花心的字是寫在紙上的（場景物件），字級 40～60、署名 26～32、歌詞 40～52；空出來的左下角放兩個備用齒輪，
//    每一拍咬合轉一齒（outBack）；
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, type LyricStyle } from './_motifs';
import { subRect, paperLyric } from './_t13';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: true, energy: [0.2, 0.85], bars: [4, 8] };

// ---------------------------------------------------------------- 器材（邏輯像素）
/** 齒環的圓心（花心）。偏右：左邊留一欄給歌詞；齒環上下出格一點點，像貼近拍的照片。 */
const C = { x: 1130, y: 540 };
const TEETH_RING = 105, TEETH_GEAR = 20;
/** 齒環的節圓半徑、齒輪半徑（齒數比）。 */
const R = 500, r = (R * TEETH_GEAR) / TEETH_RING;
/** 孔到齒輪中心的距離：一個孔畫一朵（四圈閉合）。 */
const HOLES = [0.88 * r, 0.6 * r, 0.34 * r];
const LOOP = 4;
/** 一圈幾段線（一段約 4 px）。 */
const SEG = 620;
/** 留言在花心的框（花瓣尖在半徑 ~302）。 */
const BOX = { w: 470, h: 340 };
/** 左欄：歌詞、標籤。 */
const COL = { x: 140, w: 440 };
const COL_R = { x: 98, y: 90, w: 540, h: 900 };
const LYR_Y = 540;
/** 齒環＋花心文字的圖層。 */
const MID_R = { x: C.x - 560, y: C.y - 560, w: 1120, h: 1120 };
const FAM_MSG = F.hand(400);
const FAM_LYRIC = F.archivo(75, 800);
const FOOT = '＊轉滿四圈，花才會閉合。';
/** 左下角的兩個備用齒輪（咬合：半徑比就是轉速比）。 */
const SPARE = [{ x: 262, y: 752, r: 64, teeth: 32 }, { x: 262 + 64 + 38 + 1, y: 752 - 22, r: 38, teeth: 19 }];
const INVITE = ['掃描右下角 QR code，', '下一圈換你來畫。'];

const PAPER = () => new FSPass(/* glsl */ `
  uniform vec2 uC;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float cloud = fbm(p * 0.0024, 3);
    float grain = snoise(p * 0.6) * 0.5 + snoise(p * 0.21 + 3.0) * 0.5;
    vec3 col = C_PAPER * (0.975 + 0.025 * cloud + 0.012 * grain);
    // 左上來的光
    col *= 0.965 + 0.05 * (1.0 - vUv.x * 0.6) * vUv.y;
    // 齒環壓在紙上的影子（右下，環的寬度）
    float dd = length(p - uC - vec2(8.0, 12.0));
    col *= 1.0 - 0.075 * smoothstep(${R - 8}.0, ${R}.0, dd) * (1.0 - smoothstep(${R + 40}.0, ${R + 52}.0, dd));
    fragColor = vec4(col, 1.0);
  }`, { uC: { value: new THREE.Vector2(C.x, C.y) } });

/**
 * 右下角 HUD（時間、已收到幾則、QR：x ≥ 1360、y ≥ 830）底下要乾淨：齒環、花樣在這一區淡掉（離這一區 80 px 起慢慢淡）。
 */
function hudFade(x: number, y: number) {
  const dx = 1360 - x, dy = 830 - y;
  const d = dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : 0;
  return clamp(d / 80);
}

/** 內擺線：齒輪在齒環裡面滾（θ = 齒輪中心繞圓心的角度），筆在距齒輪中心 d 的孔。 */
function pen(th: number, d: number) {
  const k = (R - r) / r;
  return { x: C.x + (R - r) * Math.cos(th) + d * Math.cos(k * th), y: C.y + (R - r) * Math.sin(th) - d * Math.sin(k * th) };
}

export default class Spirograph extends Scene {
  paper = shared('spirograph.paper', PAPER);
  /** 曲線＋齒輪＋筆（同一批，曲線先畫）。 */
  lines = this.track(new LineBatch(SEG * 13 + 900, { screen2D: true, blend: 'normal' }));
  /** 齒環（畫一次存起來）＋花心的留言／歌詞：留言寫完就不變，key 變了才重畫。 */
  mid = this.track(new Layer2D(MID_R.w, MID_R.h, undefined, { fast: true }));
  /** 左欄（歌詞每格變）。 */
  col = this.track(new Layer2D(COL_R.w, COL_R.h, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  sigSize = 44;
  inviteFit: FitResult | null = null;
  /** 第一拍（時間與拍號）、這個窗格畫幾圈、之前已經畫好的圈數、每次閉合的時間。 */
  b0 = 0;
  beat0 = 0;
  winLoops = 4;
  pre = 0;
  closes: number[] = [];
  midKey = '';
  ring: HTMLCanvasElement | null = null;

  override async init() {
    const { audio: au, start, end, song } = this.ctx;
    this.b0 = beatAfter(au, start + 0.05);
    this.beat0 = au.beatAt(this.b0);
    // 這個窗格畫得完幾圈（一圈四拍）；不夠一朵的由「之前的人」先畫好
    const beats = Math.floor(au.beatAt(end - 0.05) - this.beat0);
    this.winLoops = clamp(Math.floor(beats / 4), 1, LOOP * HOLES.length);
    this.pre = Math.max(0, LOOP - this.winLoops);
    for (let j = 1; j * LOOP <= this.pre + this.winLoops; j++) {
      const at = j * LOOP - this.pre;
      if (at > 0) this.closes.push(au.timeOfBeat(this.beat0 + at * 4));
    }
    await loadText(`${FOOT}${INVITE.join('')}萬花尺齒環齒輪第孔圈閉合${song.title}${this.msg ? signature(this.msg.name) : ''}`);
    const c = this.mid.ctx;
    if (this.msg) {
      // 標準 v2：字級上限依字數，先照子句排；可用高度扣掉署名（署名永遠在最後一行下面）
      const text = this.msg.text;
      const h = BOX.h - sigV2(msgMaxFor(text)) * 2;
      const o = { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.34, maxLines: 6 };
      this.fit = fitClauses(c, text, FAM_MSG, BOX.w, h, o) ?? fitText(c, text, FAM_MSG, BOX.w, h, o);
      this.sigSize = sigV2(this.fit.size);
    }
    this.inviteFit = fitText(c, INVITE.join(''), FAM_MSG, COL.w, 200, { min: 40, max: 44, lineHeight: 1.35, maxLines: 3 });
    this.ring = this.buildRing();
  }

  /** 透明壓克力的齒環：內緣一圈齒、外緣、反光、刻印的齒數；畫一次就好。 */
  private buildRing() {
    const s = 1.5, D = MID_R.w;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(D * s);
    const c = cv.getContext('2d')!;
    c.scale(s, s);
    c.translate(D / 2, D / 2);
    const RO = R + 44;
    const tooth = (a: number) => R + 3.4 * Math.cos(a * TEETH_RING);
    c.beginPath();
    c.arc(0, 0, RO, 0, TAU);
    for (let i = 1400; i >= 0; i--) { const a = (i / 1400) * TAU; const rr = tooth(a); c.lineTo(rr * Math.cos(a), rr * Math.sin(a)); }
    c.closePath();
    c.fillStyle = rgba('sepia', 0.045);
    c.fill('evenodd');
    c.lineWidth = 1.1;
    c.strokeStyle = rgba('sepia', 0.4);
    c.stroke();
    // 厚度的內線、左上的反光
    c.beginPath(); c.arc(0, 0, RO - 8, 0, TAU); c.strokeStyle = rgba('sepia', 0.13); c.lineWidth = 1; c.stroke();
    c.beginPath(); c.arc(0, 0, R + 22, Math.PI * 1.06, Math.PI * 1.44); c.strokeStyle = rgba('bone', 0.85); c.lineWidth = 3.5; c.stroke();
    c.beginPath(); c.arc(0, 0, R + 30, Math.PI * 1.1, Math.PI * 1.28); c.strokeStyle = rgba('bone', 0.55); c.lineWidth = 1.5; c.stroke();
    // 刻度（每 5 齒一刻）與刻印
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1;
    for (let i = 0; i < TEETH_RING; i += 5) { const a = (i / TEETH_RING) * TAU; c.beginPath(); c.moveTo((R + 10) * Math.cos(a), (R + 10) * Math.sin(a)); c.lineTo((R + (i % 25 ? 16 : 22)) * Math.cos(a), (R + (i % 25 ? 16 : 22)) * Math.sin(a)); c.stroke(); }
    c.save();
    // 刻在齒環左側，由下往上讀
    c.rotate(-Math.PI / 2);
    c.font = font(F.mono(500), 12);
    c.fillStyle = rgba('sepia', 0.45);
    c.letterSpacing = '3px';
    const tag = `${TEETH_RING} T  ·  ACRYLIC`;
    c.fillText(tag, -c.measureText(tag).width / 2, -(R + 24));
    c.restore();
    return cv;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.3) * (1 - prog(t, e - 0.25, e));
    this.paper.render(renderer, out);

    // ---- 齒輪轉到哪裡：一拍四分之一圈，拍點上出力、停住
    const bb = au.beatAt(t) - this.beat0;
    const bi = Math.floor(bb), bp = bb - bi;
    const loops = t < this.b0 ? 0 : Math.min(this.winLoops + 0.999, (bi + ease.outQuart(clamp(bp / 0.78))) / 4);
    const k = this.pre + loops; // 從紙上第一圈算起，現在畫到第幾圈（小數）
    const th = k * TAU - Math.PI / 2;
    const d = HOLES[Math.min(HOLES.length - 1, Math.floor(k / LOOP))]!;

    // ---- 齒環與花心的字（壓在底下，曲線畫在它上面）
    this.drawMid(t, vis, lyricAt(lyrics, t));
    comp.draw(renderer, this.mid.texture, out, subRect(MID_R));

    // ---- 曲線：一圈一圈重畫；每一朵（一個孔）一個筆色，閉合的那一拍整朵亮一下
    this.lines.clear();
    // 最內側的孔畫的小花：「很久以前的人」畫好的（這個窗格畫不到第三個孔時才有），第一小節紙上也不會空空的
    if (this.pre + this.winLoops <= LOOP * 2) {
      const g: [number, number, number] = LIN.sepia;
      let p = pen(-Math.PI / 2, HOLES[2]!);
      for (let i = 1; i <= SEG * LOOP; i += 2) {
        const q = pen((i / SEG) * TAU - Math.PI / 2, HOLES[2]!);
        this.lines.seg2(p.x, p.y, q.x, q.y, 1.1, g, 0.2 * vis * hudFade(q.x, q.y));
        p = q;
      }
    }
    for (let loop = 0; loop < Math.ceil(k - 1e-6); loop++) {
      const flower = Math.floor(loop / LOOP);
      const dd = HOLES[Math.min(HOLES.length - 1, flower)]!;
      const old = loop < this.pre;
      const base = flower % 2 ? LIN.blood : LIN.sepia;
      const close = this.closes[flower] ?? Infinity;
      const fl = pulse(t, close, 0.3);
      const col: [number, number, number] = fl > 0.01 ? [base[0] + (LIN.blood[0] - base[0]) * fl, base[1] + (LIN.blood[1] - base[1]) * fl, base[2] + (LIN.blood[2] - base[2]) * fl] : base;
      const a = (old ? 0.4 : 0.92) * vis;
      const wdt = (old ? 1.4 : 2.0) + 1.4 * fl;
      const n = Math.min(SEG, Math.ceil((k - loop) * SEG));
      let p = pen(loop * TAU - Math.PI / 2, dd);
      for (let i = 1; i <= n; i++) {
        const u = Math.min(k, loop + i / SEG);
        const q = pen(u * TAU - Math.PI / 2, dd);
        this.lines.seg2(p.x, p.y, q.x, q.y, wdt, col, a * hudFade(q.x, q.y));
        p = q;
      }
    }
    this.gear(th, d, vis, f.a.kick);
    this.spares(au.beatAt(t), vis);
    this.lines.render(renderer, out);

    // ---- 左欄
    this.drawCol(t, k, vis, lyricAt(lyrics, t));
    comp.draw(renderer, this.col.upload(), out, subRect(COL_R));

    return {
      paper: 1, bloom: 0.35, bloomThreshold: 0.98, bloomKnee: 0.12, halation: 0.1, vignette: 0.24, grain: 0.05,
      zoom: 1 + 0.035 * ease.inOutCubic(f.p) + 0.004 * f.a.kick,
      popupAvoid: [[C.x - BOX.w / 2 - 20, C.y - BOX.h / 2 - 30, BOX.w + 40, BOX.h + 60], [COL.x - 20, 300, COL.w + 40, 440]],
    };
  }

  override dispose() {
    if (this.ring) this.ring.width = this.ring.height = 0;
    super.dispose();
  }

  /**
   * 齒輪（訊號色的透明塑膠）：填滿的圓＝零長度的粗線，外緣的齒是折線，一排孔，筆插在第一個孔。
   * 齒輪在齒環裡滾，自己反方向轉 (R−r)/r 倍。
   */
  private gear(th: number, d: number, k: number, kick: number) {
    const L = this.lines;
    const gx = C.x + (R - r) * Math.cos(th), gy = C.y + (R - r) * Math.sin(th);
    const rot = -th * ((R - r) / r);
    const sg = LIN.signal, sp = LIN.sepia;
    L.seg2(gx + 6, gy + 9, gx + 6.01, gy + 9, 2 * r, sp, 0.07 * k);           // 影子
    L.seg2(gx, gy, gx + 0.01, gy, 2 * r, sg, 0.26 * k);                      // 塑膠
    const edge: [number, number, number] = [sg[0] * 0.45 + sp[0] * 0.55, sg[1] * 0.45 + sp[1] * 0.55, sg[2] * 0.45 + sp[2] * 0.55];
    const N = 160;
    let px = 0, py = 0;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const rr = r + 3.2 * Math.cos(a * TEETH_GEAR);
      const x = gx + rr * Math.cos(a + rot), y = gy + rr * Math.sin(a + rot);
      if (i) L.seg2(px, py, x, y, 1.1, edge, 0.75 * k);
      px = x; py = y;
    }
    // 一排孔（筆在最外面那個；齒輪自己的座標裡，筆在 (d, 0)）
    for (const hd of [0.88, 0.76, 0.6, 0.48, 0.34, 0.22]) {
      const hx = gx + hd * r * Math.cos(rot), hy = gy + hd * r * Math.sin(rot);
      for (let i = 0; i < 12; i++) {
        const a0 = (i / 12) * TAU, a1 = ((i + 1) / 12) * TAU;
        L.seg2(hx + 5 * Math.cos(a0), hy + 5 * Math.sin(a0), hx + 5 * Math.cos(a1), hy + 5 * Math.sin(a1), 1, edge, 0.6 * k);
      }
    }
    L.seg2(gx, gy, gx + 0.01, gy, 5, edge, 0.6 * k);
    // 筆：筆尖在孔裡，筆桿往右上斜（手一直這樣拿），大鼓時壓一下
    const pp = pen(th, d);
    const pr = kick * 3;
    L.seg2(pp.x + 4, pp.y + 6, pp.x + 76 + 4 - pr, pp.y - 104 + 6 + pr, 12, sp, 0.1 * k);
    L.seg2(pp.x, pp.y, pp.x + 76 - pr, pp.y - 104 + pr, 11, sp, 0.9 * k);
    L.seg2(pp.x + 9, pp.y - 15, pp.x + 72 - pr, pp.y - 100 + pr, 2.5, LIN.paper, 0.35 * k);
    L.seg2(pp.x, pp.y, pp.x + 0.01, pp.y, 8, LIN.blood, k);
  }

  /**
   * 左下角的兩個備用齒輪：互相咬合，每一拍轉一齒（outBack，轉過頭一點再停住），大的順時針、小的逆時針。
   * 只是道具（桌上沒在用的零件），讓空著的角落也跟著拍子動。
   */
  private spares(beat: number, k: number) {
    const L = this.lines;
    const bi = Math.floor(beat), bp = beat - bi;
    const ticks = bi + ease.outBack(clamp(bp / 0.35));
    const sg = LIN.signal, sp = LIN.sepia;
    const edge: [number, number, number] = [sg[0] * 0.4 + sp[0] * 0.6, sg[1] * 0.4 + sp[1] * 0.6, sg[2] * 0.4 + sp[2] * 0.6];
    SPARE.forEach((g, gi) => {
      // 一拍轉一齒（大齒輪的齒距），小齒輪反向、轉速是半徑比
      const rot = (gi === 0 ? 1 : -SPARE[0]!.r / g.r) * ticks * (TAU / SPARE[0]!.teeth) + (gi ? Math.PI / g.teeth : 0);
      L.seg2(g.x + 5, g.y + 8, g.x + 5.01, g.y + 8, 2 * g.r, sp, 0.06 * k);
      L.seg2(g.x, g.y, g.x + 0.01, g.y, 2 * g.r, sg, 0.16 * k);
      const N = g.teeth * 6;
      let px = 0, py = 0;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU;
        const rr = g.r + 3 * Math.cos(a * g.teeth);
        const x = g.x + rr * Math.cos(a + rot), y = g.y + rr * Math.sin(a + rot);
        if (i) L.seg2(px, py, x, y, 1, edge, 0.55 * k);
        px = x; py = y;
      }
      // 中心孔與一個偏心孔（看得出在轉）
      L.seg2(g.x, g.y, g.x + 0.01, g.y, 7, edge, 0.5 * k);
      const hx = g.x + g.r * 0.55 * Math.cos(rot), hy = g.y + g.r * 0.55 * Math.sin(rot);
      for (let i = 0; i < 10; i++) {
        const a0 = (i / 10) * TAU, a1 = ((i + 1) / 10) * TAU;
        L.seg2(hx + 4.5 * Math.cos(a0), hy + 4.5 * Math.sin(a0), hx + 4.5 * Math.cos(a1), hy + 4.5 * Math.sin(a1), 1, edge, 0.5 * k);
      }
    });
  }

  /** 齒環與花心的留言／歌詞／邀請。 */
  private drawMid(t: number, k: number, ly: ReturnType<typeof lyricAt>) {
    const m = this.msg, fit = this.fit;
    let key = '';
    let shown = 0, sigK = 0;
    if (m && fit) {
      const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const t0 = this.b0 + 0.05, dur = clamp(0.055 * n + 0.4, 0.7, 2.4);
      shown = n * prog(t, t0, t0 + dur);
      sigK = prog(t, t0 + dur, t0 + dur + 0.4);
      key = `${Math.round(k * 20)}|${Math.floor(shown * 3)}|${Math.round(sigK * 8)}`;
    } else if (!ly) key = `inv|${Math.round(k * 20)}`;
    if (key && key === this.midKey) return;
    this.midKey = key;
    const L = this.mid, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-MID_R.x, -MID_R.y);
    c.globalAlpha = k;
    if (this.ring) {
      c.drawImage(this.ring, MID_R.x, MID_R.y, MID_R.w, MID_R.h);
      // HUD 那一角挖掉（邊緣 80 px 漸層），跟 hudFade 一致
      c.save();
      c.globalCompositeOperation = 'destination-out';
      const gx = c.createLinearGradient(1280, 0, 1360, 0), gy = c.createLinearGradient(0, 750, 0, 830);
      gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
      gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(0,0,0,1)');
      c.fillStyle = '#000'; c.fillRect(1360, 830, 600, 300);
      c.fillStyle = gx; c.fillRect(1280, 830, 80, 300);
      c.fillStyle = gy; c.fillRect(1360, 750, 600, 80);
      c.restore();
    }
    c.textBaseline = 'alphabetic';
    if (m && fit) {
      const blockH = fit.height + this.sigSize * 2;
      const top = C.y - blockH / 2 + fit.size * 0.88;
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = rgba('sepia', 0.95);
      let left = shown;
      fit.lines.forEach((ln, i) => {
        if (left <= 0) return;
        const chars = Array.from(ln);
        const part = left >= chars.length ? ln : chars.slice(0, Math.floor(left)).join('');
        left -= chars.length;
        const wFull = c.measureText(ln).width;
        fillWithHearts(c, part, C.x - wFull / 2, top + i * fit.lineHeight);
      });
      if (sigK > 0) {
        c.globalAlpha = k * sigK;
        c.font = font(FAM_MSG, this.sigSize);
        c.fillStyle = rgba('sepia', 0.7);
        const sig = signature(m.name), sw = c.measureText(sig).width;
        c.fillText(sig, C.x + Math.min(Math.max(fit.width / 2, sw / 2), BOX.w / 2) - sw, top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize * 1.5);
      }
    } else if (ly) {
      const st: LyricStyle = { family: FAM_LYRIC, size: lyricV2(null), minSize: V2.lyrMin, maxWidth: BOX.w, align: 'center', lineHeight: 1.14, ...paperLyric() };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(C.x, C.y + lay.size * 0.36 - (lay.height - lay.size) / 2);
      drawLyric(c, ly.line, t, st, lay, ly.k * k);
      c.restore();
    } else {
      c.font = font(FAM_MSG, 44);
      c.fillStyle = rgba('sepia', 0.85);
      INVITE.forEach((ln, i) => c.fillText(ln, C.x - c.measureText(ln).width / 2, C.y - 10 + i * 62));
    }
    c.restore();
    L.upload();
  }

  /** 左欄：規格標籤、歌詞（或邀請、歌名）、圈數與註腳。 */
  private drawCol(t: number, k: number, a: number, ly: ReturnType<typeof lyricAt>) {
    const L = this.col, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-COL_R.x, -COL_R.y);
    c.globalAlpha = a;
    // 左上：器材與圈數（一行小字）
    const flower = Math.min(HOLES.length - 1, Math.floor(k / LOOP));
    const done = Math.floor(k + 1e-6);
    const inFlower = done % LOOP === 0 && done > 0 ? LOOP : (done % LOOP) + 1;
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText(`萬花尺 · 第 ${flower + 1} 孔 · 第 ${inFlower} 圈／${LOOP}${done % LOOP === 0 && done > 0 ? ' 閉合' : ''}`, COL.x, 128);
    c.letterSpacing = '0px';

    if (this.msg && ly) {
      const st: LyricStyle = { family: FAM_LYRIC, size: lyricV2(this.fit ? this.fit.size : null), minSize: V2.lyrMin, maxWidth: COL.w, ...paperLyric() };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      c.save();
      c.translate(COL.x, LYR_Y - (lay.height - lay.size) / 2 + (1 - inK) * 22);
      drawLyric(c, ly.line, t, st, lay, ly.k * a);
      c.restore();
    }
    // 左下：歌名（沒歌詞時）與冷面註腳
    if (!ly) {
      const { song } = this.ctx;
      c.font = font(F.mono(500), 15);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('sepia', 0.45);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), COL.x, 910);
      c.letterSpacing = '0px';
    }
    c.font = font(F.hei(500), 20);
    c.fillStyle = rgba('sepia', 0.4);
    c.fillText(FOOT, COL.x, 946);
    c.restore();
  }
}
