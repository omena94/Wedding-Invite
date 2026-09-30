// 乾杯（暗、wedding、婚禮服）：喜宴快結束的晚上，燈都糊成一顆一顆的光點。宣文與孟庭面對面舉杯，在小節線上碰杯，
// 杯子裡的氣泡一路往上冒，冒到頂端組成主打留言的字。角色是 Codex 畫的紙偶（xw_toast_*、mt_toast_*、cp_toast_link）。
//  - 兩小節一次碰杯：碰杯前一拍把杯子舉起來（raise），**小節線上兩個人往前一傾、杯緣碰在一起**（訊號色的一點火花、兩圈細細的「叮」、
//    一把氣泡往上噴），一拍半之後放下（stand）。兩人的位置照圖上杯緣的位置算好：碰杯那一刻兩個杯緣剛好碰在一起（sprites.json 的 glass 點）。
//    窗格夠長（≥ 6 小節）時最後兩小節換成交杯（cp_toast_link）。
//  - **焦點是主打留言**：畫面上方中間，氣泡一顆一顆從兩個杯子冒上去，每個字等它的氣泡到了才浮出來（香檳金的手寫字）。
//    照「留言尺寸與版面比例標準 v2」：字 40～60、範圍 820 × 320（天上的字，放在兩個人頭上）。沒有留言時氣泡排成邀請、字淡，歌詞變主角。
//  - 左邊一座香檳塔（程式畫的細線高腳杯，四層），酒一層一層慢慢滿上來、每拍有一層杯緣閃一下；歌詞在左下的地板上（40～52）。
//  - 背景：暗暗的宴會廳，遠處的燈糊成大光點（shader，慢慢飄），兩人腳下一圈很淡的光。鏡頭整個窗格慢慢推近兩個人。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, msgChars, signature } from './_motifs';
import { inkFor, inkLine, inkPoly, inkEllipse, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPick, drawPuppet, puppetPoint, puppetBox, puppetShadow, puppetIn, puppetLight, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'wedding', paper: false, energy: [0.2, 1], bars: [4, 8] };

const FLOOR = 900;
const SZ = 440;
/** 宣文的位置（孟庭的位置照碰杯時兩個杯緣碰在一起算）。 */
const AX = 1010;
/** 碰杯那一刻兩個人往前傾的角度。 */
const LEAN = 0.06;
/** 天上的留言：範圍（標準 v2：≤ 860 × 430）。 */
const MSG = { cx: 1140, y: 108, w: 820, h: 320 };
/** 香檳塔：小圓桌的桌面中心、高腳杯的大小。 */
const TOWER = { x: 430, top: 668, gw: 70, lh: 60, levels: 4 };
const LYR = { x: 140, base: 972, w: 760 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = { alStand: 'xw_toast_stand', alRaise: 'xw_toast_raise', omStand: 'mt_toast_stand', omRaise: 'mt_toast_raise', link: 'cp_toast_link' } as const;

interface Cell { x: number; y: number; w: number; h: number; t: number; cx: number; cy: number }
interface Bubble { t0: number; t1: number; from: 0 | 1; x: number; y: number; r: number; seed: number }

/**
 * 宴會廳：底色、兩人腳下一圈很淡的光、遠處糊成大光點的燈（慢慢飄、每顆一點點亮暗）。
 * 用 shader 算（浮點＋抖色），淡漸層才不會一階一階。
 */
const HALL = () => new FSPass(/* glsl */ `
  uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK;
    vec2 q = (p - vec2(1130.0, ${FLOOR}.0)) / vec2(520.0, 120.0);
    col += C_BONE * 0.03 * exp(-dot(q, q) * 1.6);
    vec2 r = (p - vec2(1100.0, 420.0)) / vec2(900.0, 520.0);
    col += C_BLOOD * 0.05 * exp(-dot(r, r) * 1.4);
    for (int i = 0; i < 22; i++) {
      float fi = float(i);
      vec2 c = vec2(hash11(fi * 3.17) * 2100.0 - 90.0 + sin(t * 0.12 + fi) * 24.0, 380.0 + hash11(fi * 7.71) * 330.0);
      float rad = 26.0 + hash11(fi * 1.37) * 64.0;
      float d = length(p - c);
      float disc = smoothstep(rad, rad * 0.82, d) * (0.6 + 0.4 * smoothstep(rad * 0.4, rad, d));
      float tw = 0.75 + 0.25 * sin(t * (0.6 + hash11(fi) * 0.8) + fi * 2.0);
      col += mix(C_SIGNAL, C_EMBER, hash11(fi * 5.3)) * disc * 0.014 * tw * (1.0 - smoothstep(620.0, 780.0, p.y));
    }
    float fl = smoothstep(${FLOOR - 20}.0, ${FLOOR + 40}.0, p.y);
    col = mix(col, C_INK2 * 0.8, fl * 0.6);
    col += (hash12(p + 0.5) - 0.5) * 0.003;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 } });

export default class Toast extends Scene {
  hall = shared('toast.hall', HALL);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 天上的留言（init 畫一次），每格只把浮出來的字貼到 fg。只當圖源，不上傳。 */
  msgL = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  cells: Cell[] = [];
  sigCell: Cell | null = null;
  bubbles: Bubble[] = [];
  clinks: number[] = [];
  tLink = Infinity;
  ox = 1250;
  /** 兩個杯緣（放下時）與碰杯的那一點。 */
  rim: [Pt, Pt] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  meet: Pt = { x: 0, y: 0 };
  alKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(Object.values(P)));
    // ---- 碰杯：開場後第一個小節線起每兩小節一次；窗格夠長時最後兩小節交杯
    const b0 = Math.round(au.barAt(barAfter(au, s + 0.9)));
    const nb = (e - s) / Math.max(0.3, au.timeOfBar(b0 + 1) - au.timeOfBar(b0));
    if (nb >= 6) this.tLink = au.timeOfBar(Math.round(au.barAt(e)) - 2);
    for (let b = b0; au.timeOfBar(b) < Math.min(e - 0.3, this.tLink - 0.5); b += 2) this.clinks.push(au.timeOfBar(b));
    this.alKeys = [[-1e9, P.alStand]];
    this.omKeys = [[-1e9, P.omStand]];
    for (const tc of this.clinks) {
      const bp = au.beatPeriod(tc);
      this.alKeys.push([tc - bp, P.alRaise], [tc + bp * 1.5, P.alStand]);
      this.omKeys.push([tc - bp * 0.9, P.omRaise], [tc + bp * 1.5, P.omStand]);
    }
    // ---- 孟庭站哪：碰杯那一刻（兩人往前傾）兩個杯緣剛好碰在一起
    const ga = this.pointOr(P.alRaise, AX, false, LEAN, 0.92, 0.2);
    const go = this.pointOr(P.omRaise, 0, true, -LEAN, 0.08, 0.2);
    this.ox = clamp(ga.x - go.x + 6, AX + 150, AX + 330);
    this.meet = { x: (ga.x + this.ox + go.x) / 2, y: (ga.y + go.y) / 2 };
    this.rim = [this.pointOr(P.alStand, AX, false, 0, 0.9, 0.35), this.pointOr(P.omStand, this.ox, true, 0, 0.1, 0.35)];
    // ---- 天上的留言：排字、畫一次、算每個字的位置與浮出來的時間
    const c = this.msgL.ctx;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, MSG.w, MSG.h) : noteV2(c, INVITE, null, MSG.w, MSG.h * 0.5, { max: 44 });
    tightenNote(c, this.note, 300);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.layoutMessage();
    this.drawBackground();
  }

  /** 圖上的道具點（sprites.json 量的）；沒有就用外框的比例估一個。 */
  private pointOr(name: string, x: number, flip: boolean, rot: number, fx: number, fy: number): Pt {
    const o: PuppetOpts = { h: SZ, flip, rot, pivot: 0 };
    const p = puppetPoint(name, 'glass', x, FLOOR, o);
    if (p) return p;
    const [bx, by, bw, bh] = puppetBox(name, x, FLOOR, o);
    return { x: bx + bw * fx, y: by + bh * fy };
  }

  /** 留言畫到 msgL（香檳金的手寫字）；每個字配三顆氣泡，從杯子冒上去，氣泡到了字才浮出來。 */
  private layoutMessage() {
    const n = this.note!, L = this.msgL, c = L.ctx, au = this.ctx.audio;
    const x0 = MSG.cx - n.width / 2, y0 = MSG.y + Math.max(0, (MSG.h - n.height) * 0.5);
    L.clear();
    drawNote(c, n, x0, y0, { color: this.msg ? mixRgba('bone', 'ember', 0.3) : mixRgba('bone', 'ember', 0.3, 0.55), sigColor: mixRgba('bone', 'ember', 0.2, 0.8), sigK: 1 });
    const f = n.fit;
    c.save();
    c.font = font(n.family, f.size);
    const t0 = beatAfter(au, this.ctx.start + 0.3);
    const total = msgChars(f);
    const per = clamp(1.7 / Math.max(1, total), 0.03, 0.09);
    let k = 0;
    f.lines.forEach((ln, i) => {
      const base = y0 + f.size * 0.9 + i * f.lineHeight;
      let pre = '';
      for (const ch of Array.from(ln)) {
        const a = c.measureText(pre).width;
        pre += ch;
        const b = c.measureText(pre).width;
        const cell = { x: x0 + a - 2, y: base - f.size * 1.08, w: b - a + 4, h: f.size * 1.42, t: t0 + 0.9 + k * per, cx: x0 + (a + b) / 2, cy: base - f.size * 0.4 };
        this.cells.push(cell);
        // 這個字的氣泡：從兩個杯子輪流冒上去，到的時間 = 字浮出來的時間
        if (ch.trim()) for (let j = 0; j < 3; j++) {
          const sd = k * 3 + j;
          const t1 = cell.t - j * 0.05;
          this.bubbles.push({ t0: t1 - 0.8 - 0.35 * hash(sd, 1), t1, from: ((k + j) % 2) as 0 | 1, x: cell.cx + (hash(sd, 2) - 0.5) * cell.w * 0.8, y: cell.cy + (hash(sd, 3) - 0.5) * f.size * 0.6, r: 2.2 + 2.4 * hash(sd, 4), seed: sd });
        }
        k++;
      }
    });
    if (n.name !== null) {
      c.font = font(n.family, n.sig);
      const sw = c.measureText(signature(n.name)).width;
      const by = y0 + f.height + n.sigRow * 0.72;
      this.sigCell = { x: x0 + n.width - sw - 4, y: by - n.sig * 1.1, w: sw + 8, h: n.sig * 1.5, t: t0 + 0.9 + total * per + 0.2, cx: 0, cy: 0 };
    }
    c.restore();
  }

  /** 不會動的：香檳塔的高腳小圓桌與高腳杯的線（酒在 fg 裡一層一層滿上來）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ink = inkFor(false, { fill: rgba('ink2') });
    const T = TOWER;
    // 高腳小圓桌：桌面（有一點厚度）、一根細桌腳、圓底座（細線，不要一大塊暗面搶走畫面）
    inkEllipse(c, T.x, FLOOR - 4, 90, 10, 0, { ink, fill: mixRgba('ink2', 'bone', 0.05), w: 0.6, seed: 3, color: rgba('bone', 0.3) });
    for (const dx of [-6, 6]) inkLine(c, [{ x: T.x + dx, y: T.top + 14 }, { x: T.x + dx * 1.4, y: FLOOR - 8 }], { ink, w: 0.45, seed: 10 + dx, color: rgba('bone', 0.3) });
    inkPoly(c, [{ x: T.x - 172, y: T.top }, { x: T.x + 172, y: T.top }, { x: T.x + 168, y: T.top + 12 }, { x: T.x - 168, y: T.top + 12 }], { ink, fill: mixRgba('ink2', 'bone', 0.06), w: 0.5, seed: 5, color: rgba('bone', 0.3) });
    inkEllipse(c, T.x, T.top, 172, 14, 0, { ink, fill: mixRgba('ink2', 'bone', 0.08), w: 0.6, seed: 4, color: rgba('bone', 0.38) });
    for (const g of this.glasses()) this.coupe(c, g.x, g.y, 1);
    L.upload();
  }

  /** 香檳塔每一個杯子的杯腳位置（下 → 上）。 */
  private glasses(): { x: number; y: number; lv: number }[] {
    const T = TOWER, out: { x: number; y: number; lv: number }[] = [];
    for (let lv = 0; lv < T.levels; lv++) {
      const n = T.levels - lv;
      for (let i = 0; i < n; i++) out.push({ x: T.x + (i - (n - 1) / 2) * T.gw, y: T.top - 4 - lv * T.lh, lv });
    }
    return out;
  }

  /** 一只細線高腳杯（寬口淺碗）：杯腳 (x, y)。 */
  private coupe(c: CanvasRenderingContext2D, x: number, y: number, a: number) {
    const w = TOWER.gw * 0.46, st = TOWER.lh * 0.5;
    c.save();
    c.globalAlpha = a;
    c.strokeStyle = rgba('bone', 0.5);
    c.lineWidth = 1.1;
    c.beginPath();
    c.ellipse(x, y, w * 0.55, 3, 0, 0, Math.PI * 2);
    c.moveTo(x, y); c.lineTo(x, y - st);
    c.moveTo(x - w, y - st - 16); c.quadraticCurveTo(x - w * 0.8, y - st + 2, x, y - st); c.quadraticCurveTo(x + w * 0.8, y - st + 2, x + w, y - st - 16);
    c.stroke();
    c.beginPath(); c.ellipse(x, y - st - 16, w, 4, 0, 0, Math.PI * 2); c.stroke();
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.hall.u.t!.value = t;
    this.hall.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    this.drawCouple(c, t, bp);
    puppetLight(c, [AX - 300, FLOOR - SZ * 1.25, this.ox - AX + 600, SZ * 1.25 + 40], rgba('ink', 0.03), rgba('ink', 0.45));

    // ---- 香檳塔的酒一層一層滿上來、每拍有一層杯緣閃一下
    this.fillTower(c, t, f);
    // ---- 氣泡與天上的字
    this.drawBubbles(c, t);
    this.drawMessage(c, t);
    for (const tc of this.clinks) this.clink(c, t, tc);
    this.drawLyrics(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const z = 0.03 * push;
    return { bloom: 0.75, vignette: 0.55, halation: 0.05, zoom: 1 + z, shake: [-(this.meet.x - W / 2) * z * 0.6, -(520 - H / 2) * z * 0.5] };
  }

  /** 兩個人：放下時跟著拍子輕輕晃；碰杯那一刻往前傾（小節線前預備、小節線上最前）；最後交杯換成兩人一起那張。 */
  private drawCouple(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    let lean = 0;
    for (const tc of this.clinks) {
      const k = t < tc ? prog(t, tc - bp * 0.5, tc, ease.inCubic) : Math.exp(-(t - tc) / (bp * 0.6));
      lean = Math.max(lean, k);
    }
    const kick = beatKick(au, t, 0.25);
    const linkK = clamp((t - this.tLink) / 0.1);
    if (linkK < 1) {
      const a = 1 - linkK;
      const ea = puppetIn(t, s + 0.05, 0.45), eo = puppetIn(t, s + 0.15, 0.45);
      if (ea.alpha > 0) {
        puppetShadow(c, 'xw', AX, FLOOR, { h: SZ, alpha: 0.7 * ea.alpha * a, color: '0,0,0' });
        drawPick(c, this.alKeys, t, AX, FLOOR, { h: SZ, spin: ea.spin, alpha: ea.alpha * a, rot: LEAN * lean, pivot: 0, squash: breathe(t, 0.01, 2.8) + 0.012 * kick });
      }
      if (eo.alpha > 0) {
        puppetShadow(c, 'mt', this.ox, FLOOR, { h: SZ, alpha: 0.7 * eo.alpha * a, color: '0,0,0' });
        drawPick(c, this.omKeys, t, this.ox, FLOOR, { h: SZ, flip: true, spin: eo.spin, alpha: eo.alpha * a, rot: -LEAN * lean, pivot: 0, squash: breathe(t, 0.01, 3.1, 0.4) + 0.012 * kick });
      }
    }
    if (linkK > 0) {
      const x = (AX + this.ox) / 2;
      puppetShadow(c, 'cp', x, FLOOR, { h: SZ, alpha: 0.75 * linkK, color: '0,0,0' });
      drawPuppet(c, P.link, x, FLOOR, { h: SZ, alpha: linkK, squash: breathe(t, 0.01, 3) + 0.01 * kick, rot: 0.015 * Math.sin(au.barAt(t) * Math.PI) });
    }
  }

  /** 碰杯：杯緣那一點訊號色的火花、兩圈細細往外擴的「叮」，一把氣泡往上噴。 */
  private clink(c: CanvasRenderingContext2D, t: number, tc: number) {
    const d = t - tc;
    if (d < 0 || d > 1.4) return;
    const M = this.meet, sg = LIN.signal, em = LIN.ember;
    if (d < 0.3) {
      const k = d / 0.3;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        const r0 = 6 + 22 * k, r1 = r0 + 16 * (1 - k);
        this.glow.seg2(M.x + Math.cos(a) * r0, M.y + Math.sin(a) * r0, M.x + Math.cos(a) * r1, M.y + Math.sin(a) * r1, 1.6, [sg[0] * 3, sg[1] * 3, sg[2] * 3], 1 - k);
      }
      this.glow.seg2(M.x, M.y, M.x + 0.1, M.y, 9 * (1 - k), [em[0] * 4, em[1] * 4, em[2] * 4], 1);
    }
    c.save();
    c.strokeStyle = mixRgba('bone', 'ember', 0.3, 1);
    c.lineWidth = 1;
    for (const [dd, r] of [[0, 1], [0.12, 1.5]] as const) {
      const u = (d - dd) / 0.7;
      if (u < 0 || u > 1) continue;
      c.globalAlpha = 0.5 * (1 - u);
      c.beginPath(); c.ellipse(M.x, M.y, 20 + 90 * r * ease.outCubic(u), 10 + 45 * r * ease.outCubic(u), 0, 0, Math.PI * 2); c.stroke();
    }
    // 一把氣泡往上噴（一拍多一點消失）
    for (let i = 0; i < 16; i++) {
      const life = 0.9 + 0.5 * hash(i, tc), u = d / life;
      if (u > 1) continue;
      const x = M.x + (hash(i, 2) - 0.5) * 120 * u + Math.sin(d * 9 + i) * 5, y = M.y - (80 + 220 * hash(i, 3)) * ease.outCubic(u);
      this.bubble(c, x, y, 2 + 2.5 * hash(i, 4), 0.9 * (1 - u * u));
    }
    c.restore();
  }

  /** 一顆氣泡：細細的圈、左上一點高光。 */
  private bubble(c: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
    if (a <= 0.01) return;
    c.globalAlpha = a;
    c.strokeStyle = mixRgba('bone', 'ember', 0.35, 0.85);
    c.lineWidth = 1;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = rgba('bone', 0.9);
    c.fillRect(x - r * 0.45, y - r * 0.55, 1.4, 1.4);
  }

  /** 冒上去的氣泡：從杯緣出發，一邊晃一邊往上、往字的位置飄（最後一段才往橫向靠過去），到了「啵」一下變成字。 */
  private drawBubbles(c: CanvasRenderingContext2D, t: number) {
    c.save();
    for (const b of this.bubbles) {
      if (t < b.t0 || t > b.t1 + 0.15) continue;
      if (t > b.t1) {
        const u = (t - b.t1) / 0.15;
        c.globalAlpha = 0.6 * (1 - u);
        c.strokeStyle = mixRgba('bone', 'ember', 0.35, 1);
        c.lineWidth = 0.8;
        c.beginPath(); c.arc(b.x, b.y, b.r * (1 + 2 * u), 0, Math.PI * 2); c.stroke();
        continue;
      }
      const src = this.rim[b.from];
      const u = (t - b.t0) / (b.t1 - b.t0);
      const y = src.y + (b.y - src.y) * ease.inOutQuad(u);
      const x = src.x + (b.x - src.x) * ease.inCubic(u) + Math.sin((t - b.t0) * 10 + b.seed) * 6 * (1 - u);
      this.bubble(c, x, y, b.r * (0.6 + 0.4 * u), clamp(u * 6) * 0.95);
    }
    // 平常杯子裡也一直冒一點點（很淡、冒一小段就不見）
    for (let k = 0; k < 2; k++) {
      const R = this.rim[k as 0 | 1];
      for (let i = 0; i < 5; i++) {
        const u = ((t * 0.9 + i / 5 + k * 0.37) % 1);
        this.bubble(c, R.x + (hash(i, k, Math.floor(t * 0.9 + i / 5 + k * 0.37)) - 0.5) * 14, R.y - 10 - u * 90, 1.8, 0.5 * Math.sin(Math.PI * u));
      }
    }
    c.restore();
  }

  /** 天上的字：氣泡到了才浮出來（從下面一點點、淡入），署名最後。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const src = this.msgL.canvas, S = SCALE;
    const one = (r: Cell) => {
      const u = (t - r.t) / 0.28;
      if (u <= 0) return;
      const k = ease.outCubic(clamp(u));
      c.globalAlpha = k;
      c.drawImage(src, r.x * S, r.y * S, r.w * S, r.h * S, r.x, r.y + 8 * (1 - k), r.w, r.h);
    };
    c.save();
    for (const r of this.cells) one(r);
    if (this.sigCell) one(this.sigCell);
    c.restore();
  }

  /** 香檳塔：酒從最上面一層往下一層一層滿（整個窗格慢慢滿），每拍有一層的杯緣閃一下。 */
  private fillTower(c: CanvasRenderingContext2D, t: number, f: Frame) {
    const au = this.ctx.audio, em = LIN.ember;
    const gl = this.glasses();
    const lvl = Math.floor(au.beatAt(t) + 1e-6) % TOWER.levels;
    const kick = beatKick(au, t, 0.3);
    const w = TOWER.gw * 0.46, st = TOWER.lh * 0.5;
    c.save();
    for (const g of gl) {
      const fill = clamp(f.p * 1.6 - (TOWER.levels - 1 - g.lv) * 0.3 + 0.35);
      if (fill > 0) {
        const yb = g.y - st, yt = yb - 13 * fill;
        c.fillStyle = mixRgba('ember', 'blood', 0.35, 0.55);
        c.beginPath(); c.moveTo(g.x - w * 0.8 * (0.35 + 0.65 * fill), yt); c.quadraticCurveTo(g.x - w * 0.3, yb + 1, g.x, yb); c.quadraticCurveTo(g.x + w * 0.3, yb + 1, g.x + w * 0.8 * (0.35 + 0.65 * fill), yt); c.closePath(); c.fill();
      }
      if (g.lv === lvl && kick > 0.05) this.glow.seg2(g.x + w * 0.6, g.y - st - 17, g.x + w * 0.6 + 0.1, g.y - st - 17, 4, [em[0] * 2.5, em[1] * 2.5, em[2] * 2.5], kick);
    }
    c.restore();
  }

  /** 左下地板上的歌詞（跟唱）；折成兩排時往上長。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    if (!ly) return;
    const big = !this.msg;
    const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: LYR.w, unsung: rgba('bone', 0.26), sung: rgba('bone', big ? 0.94 : 0.84), active: rgba('signal') };
    const lay = layoutLyric(c, ly.line, st);
    c.save();
    c.translate(LYR.x, LYR.base - (lay.height - lay.size));
    drawLyric(c, ly.line, t, st, lay, ly.k * prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5));
    c.restore();
  }
}
