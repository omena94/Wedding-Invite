// 雷射秀（暗、雙語）：演唱會的場子，滿場的煙。舞台中間一台雷射投影機，射出的光束穿過煙霧，在後牆上畫出兩行字（像雷射投影）：
// 中文在上、原文小一號在下。台下是一整排舉手的觀眾剪影，跟著拍子上下。
//  - 字是雷射畫的線：每一句開始時，雷射從左到右很快地把字「描」出來（投影機到正在描的地方有一束光），描完之後字是亮的外框＋很淡的填色。
//    唱到的字是訊號色（最亮、有光暈），唱完是暖白，還沒唱的只剩暗暗的外框；原文比較安靜（唱到、唱完都是暖白）。
//    沒有翻譯的歌：只有中文一行。純音樂：雷射畫新人的名字與日期，每四小節重畫一次。
//  - 一直在動：投影機兩邊各有一把扇形的光束，每一拍掃到另一邊（強烈的緩動）；每個小節線光束的顏色換一次（訊號色一家子輪流），
//    換顏色的那一下全場閃一下。觀眾的手在拍點往上舉；天花板的燈架上一排小燈跟著拍子跑。
//  - 主打留言：舞台左邊燈架上掛的一塊 LED 條屏（黑底、一顆一顆的燈），留言是琥珀色的 LED 字，第一拍起一行一行從左掃到右亮起來。
//    照「留言尺寸與版面比例標準 v2」：字 40～60、署名 26～32、LED 屏 ≤ 860 × 430。
//  - 鏡頭慢慢推近；右下角（QR）是暗暗的觀眾剪影。
// 手法：後牆、煙、舞台、燈架、觀眾剪影是一個全螢幕 shader；雷射的字畫在一張 Canvas 圖層（外框＋淡填色），光暈畫在半解析度的
// 圖層上加亮疊上去；光束是 LineBatch（加亮混合，會發光）；LED 屏的燈點在 init() 先做成圖（亮的字、暗的底），每格只揭開。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, TAU } from '../engine/util';
import { lyricSubOf, type Line } from '../engine/lyrics';
import { beatAfter, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { sigOf, layMsgV2, winBars, lastBefore, type MsgLay, type Rect } from './_t23';
import { lyricV2 } from './_v2';
import { B5_TEXT, B5_INVITE, subPx, layBilingual, glyphProgress, type BGlyph } from './_b5';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'light', paper: false, energy: [0.5, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（畫面座標，y 向下）
/** 雷射投影機（舞台中間）。 */
const PROJ = { x: 1120, y: 742 };
/** 後牆上的字：主行第一排基線、中心、寬。 */
const TXT = { x: 1130, y: 236, w: 1180 };
const STAGE = 772;
/** LED 屏：左緣、上緣（高度照留言）。 */
const LED = { x: 96, y: 486 };
/** LED 燈距。 */
const PITCH = 3;
const FAM_LASER = F.hei(700);
const FAM_LED = F.hei(700);

const ROOM = () => new FSPass(/* glsl */ `
  uniform float uT; uniform vec3 uCam; uniform float uFlash; uniform float uBeat; uniform vec3 uCol;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = (sp - vec2(960.0, 540.0 + uCam.y)) / uCam.x + vec2(960.0, 540.0);
    // 後牆：深色的布幕，直的皺褶
    vec3 col = C_INK2 * (0.3 + 0.05 * sin(p.x * 0.045 + 1.3 * sin(p.x * 0.011)));
    // 煙：一大片慢慢飄的霧，被雷射的顏色照亮一點
    float fog = fbm(vec2(p.x * 0.0022 + uT * 0.03, p.y * 0.003 - uT * 0.02), 5) * 0.5 + 0.5;
    col += mix(C_ASH, uCol, 0.6) * 0.05 * fog * (0.7 + 0.6 * uFlash);
    // 天花板的燈架：一條桁架（斜的格子），上面一排小燈跟著拍子跑
    float truss = step(abs(p.y - 58.0), 16.0);
    float lattice = step(0.82, abs(fract((p.x + (p.y - 58.0) * 1.0) / 32.0) - 0.5) * 2.0) + step(0.82, abs(fract((p.x - (p.y - 58.0) * 1.0) / 32.0) - 0.5) * 2.0);
    col = mix(col, C_GRAPHITE * 0.35, truss * clamp(lattice + step(14.0, abs(p.y - 58.0)), 0.0, 1.0));
    float bulb = floor(p.x / 120.0);
    vec2 bc = vec2((bulb + 0.5) * 120.0, 84.0);
    float on = fract((bulb + floor(uBeat)) / 4.0 + 0.01) < 0.25 ? 1.0 : 0.0;
    col += mix(uCol, C_EMBER, 0.4) * (0.25 + 1.3 * on) * exp(-length(p - bc) / 6.0);
    // 舞台：地板的前緣一條亮邊，舞台面暗
    if (p.y > ${STAGE}.0) col = mix(col, C_INK * 0.6 + C_ASH * 0.02, smoothstep(${STAGE}.0, ${STAGE}.0 + 2.0, p.y));
    col += mix(C_ASH, uCol, 0.5) * 0.08 * exp(-abs(p.y - ${STAGE}.0) / 2.5);
    // 觀眾：最下面一整排頭與舉起來的手（剪影），跟著拍子上下
    float cx = sp.x / 64.0, ci = floor(cx), cf = fract(cx) - 0.5;
    float hh = hash11(ci * 3.1);
    float bob = 10.0 * pow(1.0 - fract(uBeat + hh * 0.3), 3.0) * step(0.3, hh);
    float headY = 990.0 - 44.0 * hh - bob;
    float head = length(vec2(cf * 64.0, sp.y - headY)) - 22.0;
    float body = step(headY, sp.y);
    // 手：一半的人舉手（拍點上舉最高）
    float up = step(0.55, hash11(ci * 7.7)) * (70.0 + 60.0 * hh) * (0.6 + 0.4 * pow(1.0 - fract(uBeat), 2.0));
    float arm = sdSegment(vec2(cf * 64.0, sp.y), vec2(14.0, headY + 6.0), vec2(22.0 + 6.0 * hh, headY - up)) - 5.0;
    arm = min(arm, length(vec2(cf * 64.0, sp.y) - vec2(22.0 + 6.0 * hh, headY - up)) - 8.0);
    float crowd = max(max(1.0 - smoothstep(-1.0, 1.0, head), body), up > 0.0 ? 1.0 - smoothstep(-1.0, 1.0, arm) : 0.0);
    col = mix(col, C_INK * 0.25, crowd);
    // 觀眾頭頂被雷射照到的一點點邊光
    col += uCol * 0.05 * (1.0 - smoothstep(0.0, 2.5, abs(head))) * step(sp.y, headY - 8.0);
    // 換顏色的那一下全場閃
    col += mix(C_ASH, uCol, 0.5) * 0.05 * uFlash;
    fragColor = vec4(col, 1.0);
  }`, { uT: { value: 0 }, uCam: { value: new THREE.Vector3(1, 0, 0) }, uFlash: { value: 0 }, uBeat: { value: 0 }, uCol: { value: new THREE.Vector3(1, 0.6, 0.2) } });

/** 雷射畫的一句：字、什麼時候開始描、描完、什麼時候收掉。 */
interface Frame2 { main: BGlyph[]; sub: BGlyph[]; mainSize: number; subSize: number; t0: number; t1: number; fake: boolean; x0: number; x1: number }

export default class LaserShow extends Scene {
  room = shared('lasershow.room', ROOM);
  beams = this.track(new LineBatch(400, { screen2D: true, blend: 'add' }));
  L = this.track(new Layer2D(W, H, undefined, { fast: true }));
  G = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 251 + (this.msg?.id ?? 0) * 61) >>> 0;
  lay: MsgLay | null = null;
  tOn = 0;
  bars: number[] = [];
  frames: Frame2[] = [];
  ledOn: HTMLCanvasElement | null = null;
  ledOff: HTMLCanvasElement | null = null;
  led = { x: 0, y: 0, w: 0, h: 0 };
  /** LED 字每一行（相對 LED 屏）：上緣、高、亮起來的時間。 */
  ledRows: { y: number; h: number; t: number }[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    const sig = m ? sigOf(m) : '';
    const subs = lines.map((l) => lyricSubOf(l)?.text ?? '').join('');
    await loadText(`${B5_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}${subs}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    const bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    this.bars = winBars(au, s - 4, e + 1);
    const c = this.L.ctx;

    // ---- 留言：LED 屏（先在 (0,0) 起算的框裡排）
    let msgPx: number | null = null;
    if (m) {
      this.lay = layMsgV2(c, m.text, sig, FAM_LED, { x: 0, y: 0, w: 700, h: 320 }, { lineHeight: 1.3, maxLines: 5, sigFamily: F.hei(500), align: 'left', valign: 'top' });
      msgPx = this.lay.fit.size;
    }
    this.buildLed(beat, bar);

    // ---- 雷射的字：每一句排好（中文一行、原文小一號在下面）
    const size = lyricV2(msgPx);
    const mk = (line: Line, t0: number, t1: number, fake: boolean): Frame2 => {
      const L = layBilingual(c, line, { family: FAM_LASER, size, maxW: TXT.w, x: TXT.x, y: TXT.y, lineHeight: 1.25, gap: size * 0.45 + subPx(size), letter: 2 });
      const all = [...L.main, ...L.sub];
      return { main: L.main, sub: L.sub, mainSize: L.mainSize, subSize: L.subSize, t0, t1, fake, x0: Math.min(...all.map((g) => g.x)), x1: Math.max(...all.map((g) => g.x + g.w)) };
    };
    lines.forEach((ln, i) => {
      const nx = lines[i + 1];
      this.frames.push(mk(ln, ln.start - 0.45, nx ? Math.max(ln.end + 0.2, nx.start - 0.45) : ln.end + 1.4, false));
    });
    if (!lines.length) {
      for (let t0 = this.tOn; t0 < e - beat; t0 += bar * 4) this.frames.push(mk(fakeLine(COUPLE_ZH, DATE_DOTS, t0 + 0.5, beat), t0, Math.min(t0 + bar * 4, e + 1), true));
    }
    const l = this.led;
    this.avoid = [[l.x, l.y, l.w, l.h], [TXT.x - TXT.w / 2, TXT.y - 70, TXT.w, 180]];
  }

  /** LED 屏：黑底、一格一格的燈（沒亮的也看得到），亮的字是琥珀色（訊號色一家子）。先做成兩張圖（亮的、暗的），每格只揭開。 */
  private buildLed(beat: number, bar: number) {
    const lay = this.lay;
    const pad = { x: 40, t: 34, b: 30 };
    let w: number, h: number;
    if (lay) { const [bx, by, bw, bh] = lay.box; w = Math.min(800, Math.max(460, bx + bw + pad.x * 2)); h = Math.min(400, by + bh + pad.t + pad.b); }
    else { w = 560; h = 136; }
    w = Math.round(w / PITCH) * PITCH; h = Math.round(h / PITCH) * PITCH;
    this.led = { x: LED.x, y: LED.y + Math.max(0, 300 - h) * 0.5, w, h };
    const S = 1;
    // 字（實心）：之後拿去乘上燈點
    const txt = document.createElement('canvas'); txt.width = w * S; txt.height = h * S;
    const tg = txt.getContext('2d')!; tg.textBaseline = 'alphabetic';
    tg.save(); tg.translate(pad.x, pad.t);
    if (lay) {
      tg.fillStyle = '#fff'; tg.font = font(FAM_LED, lay.fit.size);
      for (const ln of lay.lines) fillHearts(tg, ln.text, ln.x, ln.y, lay.fit.size);
      tg.font = font(lay.sig.family, lay.sig.size); tg.globalAlpha = 0.75; tg.fillText(lay.sig.text, lay.sig.x, lay.sig.y); tg.globalAlpha = 1;
      const n = lay.lines.length;
      this.ledRows = lay.lines.map((ln, i) => ({ y: pad.t + ln.y - lay.fit.size * 1.02, h: lay.fit.size * 1.3, t: this.tOn + beat * 0.25 + (i * Math.min(bar, beat * 4)) / Math.max(1, n) }));
      const last = this.ledRows[n - 1]!;
      this.ledRows.push({ y: pad.t + lay.sig.y - lay.sig.size * 1.05, h: lay.sig.size * 1.4, t: last.t + beat });
    } else {
      tg.fillStyle = '#fff'; tg.font = font(FAM_LED, 56); tg.fillText(`給 ${COUPLE_ZH}`, 0, 58);
      this.ledRows = [{ y: 0, h, t: this.tOn + beat * 0.25 }];
    }
    tg.restore();
    const img = tg.getImageData(0, 0, w, h).data;
    const dot = (g: CanvasRenderingContext2D, x: number, y: number, col: string) => { g.fillStyle = col; g.fillRect(x + 0.4, y + 0.4, PITCH - 0.8, PITCH - 0.8); };
    const on = document.createElement('canvas'); on.width = w; on.height = h;
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const og = on.getContext('2d')!, fg = off.getContext('2d')!;
    fg.fillStyle = mixRgba('ink', 'ink2', 0.3); fg.fillRect(0, 0, w, h);
    const hot = mixRgba('ember', 'signal', 0.4), dim = mixRgba('graphite', 'ink2', 0.6), heart = rgba('rose');
    for (let y = 0; y < h; y += PITCH) for (let x = 0; x < w; x += PITCH) {
      let a = 0, gr = 0;
      for (let dy = 0; dy < PITCH; dy += 1) for (let dx = 0; dx < PITCH; dx += 1) { const i = ((y + dy) * w + (x + dx)) * 4; a += img[i + 3]!; gr += img[i + 1]!; }
      a /= PITCH * PITCH; gr /= PITCH * PITCH;
      dot(fg, x, y, dim);
      if (a > 70) dot(og, x, y, gr < a * 0.4 ? heart : hot);
    }
    this.ledOn = on; this.ledOff = off;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const z = 1 + 0.035 * drift, oy = 30 * (1 - land);
    const X = (x: number) => (x - 960) * z + 960, Y = (y: number) => (y - 540) * z + 540 + oy;
    const bp = au.beatAt(t), bi = Math.floor(bp), bph = bp - bi;
    const tb = lastBefore(this.bars, t), since = t - tb;
    // 每個小節線換一次雷射的顏色：訊號色 → 熱的訊號色 → 訊號色與紙白之間，輪流
    const k = Math.round(au.barAt(Number.isFinite(tb) ? tb : t));
    const PAL: [number, number, number][] = [LIN.signal, LIN.ember, mix3(LIN.signal, LIN.bone, 0.45)];
    const col = PAL[((k % 3) + 3) % 3]!;
    const flash = since >= 0 && since < 0.4 ? Math.exp(-since / 0.1) : 0;
    const u = this.room.u;
    u.uT!.value = t; u.uFlash!.value = flash; u.uBeat!.value = bp;
    (u.uCol!.value as THREE.Vector3).set(col[0], col[1], col[2]);
    (u.uCam!.value as THREE.Vector3).set(z, oy, 0);
    this.room.render(renderer, out);

    const c = this.L.ctx, g = this.G.ctx;
    this.L.clear(); this.G.clear();
    const cam = [z, 0, 0, z, 960 - 960 * z, 540 - 540 * z + oy] as const;
    c.setTransform(...cam); g.setTransform(...cam);
    const lb = this.beams; lb.clear();

    // ---- 扇形光束：投影機兩邊各一把，每一拍掃到另一邊（強烈的緩動）
    const on = ease.outCubic(prog(t, s, this.tOn + 0.1));
    const sw = ease.inOutCubic(clamp(bph / 0.35));
    const side = (b: number) => (((b % 2) + 2) % 2 ? 1 : -1);
    const ang = (side(bi - 1) + (side(bi) - side(bi - 1)) * sw) * 0.35;
    for (const [dir, base] of [[-1, -2.05], [1, -0.9]] as const) {
      for (let j = 0; j < 7; j++) {
        const a = base + dir * ang + (j - 3) * 0.075;
        const L = 1600;
        const x1 = PROJ.x + Math.cos(a) * L, y1 = PROJ.y + Math.sin(a) * L;
        const bw = 1.4, bright = 0.9 + 0.5 * f.a.kick;
        lb.seg2(X(PROJ.x), Y(PROJ.y), X(x1), Y(y1), bw * 9 * z, [col[0] * 0.25, col[1] * 0.25, col[2] * 0.25], 0.05 * on);
        lb.seg2(X(PROJ.x), Y(PROJ.y), X(x1), Y(y1), bw * z, [col[0] * bright, col[1] * bright, col[2] * bright], 0.35 * on);
      }
    }

    // ---- 雷射畫在後牆上的字
    for (const fr of this.frames) {
      if (t < fr.t0 || t > fr.t1 + 0.5) continue;
      const out1 = 1 - clamp((t - fr.t1) / 0.4);
      // 描字：從左到右 0.45 秒描完
      const trace = clamp((t - fr.t0) / 0.45);
      const hx = lerp(fr.x0 - 10, fr.x1 + 10, ease.inOutQuad(trace));
      const draw = (gs: BGlyph[], size: number, quiet: boolean) => {
        c.font = font(FAM_LASER, size); c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
        g.font = font(FAM_LASER, size); g.textBaseline = 'alphabetic';
        for (const gl of gs) {
          if (gl.x > hx) continue;
          const p = fr.fake ? (t >= gl.word.start ? 1 : 0) : glyphProgress(gl, t);
          const act = p > 0 && p < 1 && !quiet;
          const stroke = p <= 0 ? mixRgba('ash', 'signal', 0.3, 0.4) : act ? rgba('signal') : quiet ? mixRgba('bone', 'ember', 0.3, 0.9) : mixRgba('ember', 'bone', 0.6);
          c.globalAlpha = out1;
          if (gl.ch === '♥') { drawHeart(c, gl.x + gl.w / 2, gl.y - size * 0.36, size * 0.8, p > 0 ? rgba('rose') : rgba('rose', 0.35)); continue; }
          // 淡的填色（煙裡的光面）＋亮的外框（雷射的線）
          c.fillStyle = p <= 0 ? rgba('ash', 0.08) : act ? rgba('signal', 0.5) : rgba('ember', quiet ? 0.28 : 0.4);
          c.fillText(gl.ch, gl.x, gl.y);
          c.strokeStyle = stroke; c.lineWidth = p > 0 ? 1.8 : 1.2;
          c.strokeText(gl.ch, gl.x, gl.y);
          if (p > 0) {
            g.globalAlpha = out1 * (act ? 0.85 : 0.35);
            g.fillStyle = rgba(act ? 'signal' : 'ember');
            g.fillText(gl.ch, gl.x, gl.y);
          }
        }
      };
      draw(fr.main, fr.mainSize, false);
      draw(fr.sub, fr.subSize, true);
      c.globalAlpha = 1; g.globalAlpha = 1;
      // 描字的那一束光：投影機到正在描的地方
      if (trace > 0 && trace < 1) {
        const ty = TXT.y - fr.mainSize * 0.4 + Math.sin(t * 90) * fr.mainSize * 0.5;
        lb.seg2(X(PROJ.x), Y(PROJ.y), X(hx), Y(ty), 2.2 * z, [col[0] * 3, col[1] * 3, col[2] * 3], 0.8);
        lb.seg2(X(PROJ.x), Y(PROJ.y), X(hx), Y(ty), 14 * z, [col[0] * 0.4, col[1] * 0.4, col[2] * 0.4], 0.15);
      }
      // 唱到的字：投影機到那個字有一束細光一直掃著
      if (!fr.fake) for (const gl of fr.main) {
        const p = glyphProgress(gl, t);
        if (!(p > 0 && p < 1)) continue;
        const px = gl.x + gl.w * (0.5 + 0.4 * Math.sin(t * 40)), py = gl.y - gl.size * (0.4 + 0.3 * Math.cos(t * 33));
        lb.seg2(X(PROJ.x), Y(PROJ.y), X(px), Y(py), 1.6 * z, [col[0] * 2.2, col[1] * 2.2, col[2] * 2.2], 0.55 * out1);
      }
    }

    // ---- 雷射投影機（舞台中間的黑盒子，鏡頭口發光）
    c.fillStyle = mixRgba('ink', 'graphite', 0.3); c.beginPath(); c.roundRect(PROJ.x - 54, PROJ.y - 6, 108, 36, 5); c.fill();
    c.fillStyle = rgba('graphite', 0.8); c.fillRect(PROJ.x - 60, PROJ.y + 28, 120, 6);
    g.fillStyle = rgba('signal', 0.9); g.beginPath(); g.arc(PROJ.x, PROJ.y, 10 + 4 * f.a.kick, 0, TAU); g.fill();

    // ---- LED 屏（留言）
    this.drawLed(c, g, t, bi);

    c.setTransform(1, 0, 0, 1, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
    // 光束先畫（在煙裡，後面的 LED 屏會擋住它），再疊字與 LED 屏
    lb.render(renderer, out);
    comp.draw(renderer, this.L.upload(), out);
    comp.draw(renderer, this.G.upload(), out, { mode: 'add', tint: [1.6, 1.6, 1.6] });
    return { bloom: 0.9, bloomThreshold: 0.85, vignette: 0.6, halation: 0.35, flash: flash * 0.05, popupAvoid: this.avoid };
  }

  /** LED 屏：掛在燈架上（兩條吊帶），黑底暗燈；字一行一行從左掃到右亮起來，亮完之後一整塊隨拍子微微呼吸。 */
  private drawLed(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, t: number, bi: number) {
    const l = this.led;
    // 吊帶與外框
    c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 3;
    for (const fx of [0.15, 0.85]) { c.beginPath(); c.moveTo(l.x + l.w * fx, 60); c.lineTo(l.x + l.w * fx, l.y - 8); c.stroke(); }
    c.fillStyle = mixRgba('ink', 'graphite', 0.25); c.fillRect(l.x - 10, l.y - 10, l.w + 20, l.h + 20);
    c.drawImage(this.ledOff!, l.x, l.y);
    const breathe = 0.92 + 0.08 * Math.cos(((this.ctx.audio.beatAt(t) % 1) + 1) % 1 * TAU);
    for (const r of this.ledRows) {
      const k = clamp((t - r.t) / 0.35);
      if (k <= 0) continue;
      const cw = Math.ceil((l.w * ease.outCubic(k)) / PITCH) * PITCH;
      const y0 = Math.max(0, Math.floor(r.y / PITCH) * PITCH), hh = Math.min(l.h - y0, Math.ceil(r.h / PITCH) * PITCH + PITCH);
      if (cw <= 0 || hh <= 0) continue;
      c.globalAlpha = breathe;
      c.drawImage(this.ledOn!, 0, y0, cw, hh, l.x, l.y + y0, cw, hh);
      g.globalAlpha = 0.28 * breathe;
      g.drawImage(this.ledOn!, 0, y0, cw, hh, l.x, l.y + y0, cw, hh);
    }
    c.globalAlpha = 1; g.globalAlpha = 1;
    // 沒有留言：屏框下緣印一行邀請（LED 的點太粗，小字用印的）
    if (!this.lay) {
      c.fillStyle = mixRgba('ink', 'graphite', 0.25); c.fillRect(l.x - 10, l.y + l.h + 10, l.w + 20, 40);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('bone', 0.7); c.letterSpacing = '2px'; c.textBaseline = 'alphabetic';
      c.fillText(B5_INVITE, l.x + 6, l.y + l.h + 37); c.letterSpacing = '0px';
    }
    // 外框上一排小狀態燈（跟著拍子跑）
    for (let i = 0; i < 8; i++) {
      const lit = (i + bi) % 8 === 0;
      c.fillStyle = lit ? rgba('signal') : rgba('graphite', 0.7);
      c.fillRect(l.x + l.w - 12 - i * 10, l.y + l.h + 2, 5, 5);
    }
  }
}

const mix3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** 純音樂用的假歌詞行：主行（名字）半拍亮一個字、副行（日期）接在後面。 */
function fakeLine(main: string, sub: string, t0: number, beat: number): Line {
  let k = 0;
  const mk = (text: string): Line => {
    const chars = Array.from(text);
    const words = chars.map((ch, j) => {
      const st = t0 + k * beat * 0.5;
      if (ch.trim()) k++;
      return { w: ch, start: st, end: st + beat * 0.45, line: 0, index: j, gi: 0, o: chars.slice(0, j).join('').length };
    }).filter((w) => w.w.trim());
    return { i: 0, text, start: t0, end: t0 + k * beat * 0.5, words };
  };
  const line = mk(main);
  line.sub = mk(sub);
  return line;
}

/** LED 字（♥ 用自己畫的愛心，也會變成燈點）。 */
function fillHearts(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  let cx = x;
  for (const part of text.split(/(♥)/u)) {
    if (!part) continue;
    // 愛心畫成紅色（只有紅色通道）：做燈點時認得出來，改用點綴色的燈
    if (part === '♥') { drawHeart(g, cx + size * 0.45, y - size * 0.34, size * 0.72, '#f00'); g.fillStyle = '#fff'; cx += size * 0.95; continue; }
    g.fillText(part, cx, y);
    cx += g.measureText(part).width;
  }
}

