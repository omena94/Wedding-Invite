// 汽車儀表板（暗）：夜裡開在路上，從駕駛座看出去。
//  - 擋風玻璃外是夜路（shader）：車道虛線一拍過去一段、路燈一小節經過頭頂一盞（正好在小節線上），
//    路燈經過的那一下，一道光從儀表板上掃過去；路慢慢地左彎右彎，遠處地平線是城市的燈。
//  - 畫面的焦點＝主打留言：抬頭顯示器（HUD）投影在擋風玻璃上、浮在路的上方，第一拍開始一個字一個字投影出來
//    （剛出來是訊號色、很快變白），玻璃的雙重反射讓字有一道很淡的疊影；署名在最後一行下面，底下一行小小的「目的地：幸福」。
//  - 歌詞在中控螢幕上（比留言小一級，逐字跟唱），像車上的音樂播放器；沒有留言時歌詞改投影在擋風玻璃上當主角，
//    螢幕上寫「目的地：尚未設定」與邀請。純音樂：HUD 顯示歌名。
//  - 左邊轉速表跟著音樂的能量（大鼓一踩指針就往上甩），右邊的速度表單位是 BPM；中間的雙黃燈按鈕跟著拍子閃（在慶祝）。
// 2026-09-29 依「MV 融合原則」：留言改成擋風玻璃上的投影（場景裡的東西，不再是導航螢幕裡的卡片），
// 導航地圖、里程、紅區標籤、限速這些介面元素拿掉；路會轉彎，鏡頭跟著小節線輕輕顛一下。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, lyricSizeFor, beatAfter, signature, fillWithHearts } from './_motifs';
import { stagger, mono } from './_t11';
import { fillGlyph, type Rect } from './_t9';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.4, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 消失點、相機焦距（px）、相機高度（m）。 */
const VP = { x: 960, y: 400 };
const FOC = 533, HC = 1.2;
/** 一拍往前開幾公尺（車道虛線一段 + 空隙）、一小節幾公尺（路燈間距）。 */
const DASH = 9, LAMP = 36;
const TACH = { x: 330, y: 800, r: 172 };
const SPEEDO = { x: 1572, y: 700, r: 128 };
const NAV = { x: 570, y: 612, w: 790, h: 372 };
/** 擋風玻璃上的投影區（留言，或沒有留言時的歌詞）。 */
const HUD_BOX = { x: 250, y: 124, w: 1420, h: 250 };
const HAZ = { x: 960, y: 588 };
const FAM_MSG = F.hand(700);
const INVITE = '掃描右下角 QR code，輸入你的祝福';

/** 儀表的角度：0 在左下（135°），滿格在右下（45°），順時針 270°（畫面座標 y 向下）。 */
const gAng = (v: number, max: number) => ((135 + (270 * v) / max) * Math.PI) / 180;

const BG = () => new FSPass(/* glsl */ `
  uniform float beat; uniform float bar; uniform float kick; uniform float k; uniform float cv; uniform vec4 hud;
  const vec2 VP = vec2(${VP.x}.0, ${VP.y}.0);
  float dashTop(float x) {
    float base = 566.0 + 24.0 * pow((x - 960.0) / 960.0, 2.0);
    // 轉速表上面的遮光罩：一塊圓圓鼓起來的
    float bump = smoothstep(${TACH.x - TACH.r - 40}.0, ${TACH.x - TACH.r + 60}.0, x) * smoothstep(${TACH.x + TACH.r + 60}.0, ${TACH.x + TACH.r - 30}.0, x);
    float bump2 = smoothstep(${SPEEDO.x - SPEEDO.r - 40}.0, ${SPEEDO.x - SPEEDO.r + 50}.0, x) * smoothstep(${SPEEDO.x + SPEEDO.r + 50}.0, ${SPEEDO.x + SPEEDO.r - 30}.0, x);
    return mix(mix(base, 548.0, bump), 546.0, bump2);
  }
  vec3 bezel(vec2 p, vec2 c, float r, vec3 col) {
    float d = length(p - c);
    float a = atan(p.y - c.y, p.x - c.x);
    // 外圈的影子、金屬環（上緣亮）、錶面
    col *= 1.0 - 0.5 * exp(-max(d - r - 14.0, 0.0) / 18.0) * step(r + 14.0, d);
    if (d < r + 14.0) {
      float ring = smoothstep(r - 1.0, r + 1.0, d);
      vec3 chrome = mix(C_GRAPHITE * 0.45, C_ASH * 0.55, 0.5 + 0.5 * cos(a + 2.1)) * (0.8 + 0.3 * smoothstep(r + 14.0, r + 4.0, d));
      vec3 face = C_INK * (0.6 + 0.5 * smoothstep(r, 0.0, d)) + C_INK2 * 0.3;
      col = mix(face, chrome, ring);
      col *= 1.0 - 0.6 * pxLine(abs(d - r - 13.5), 0.5, 1.5);
    }
    return col;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float yTop = dashTop(p.x);
    vec3 col;
    // 路燈：第 i 盞在 z = 36(i - 小節的小數)，正好在小節線上從頭頂經過
    float fb = fract(bar);
    if (p.y < yTop) {
      // ---- 擋風玻璃外：夜空、城市、路
      col = mix(C_INK2 * 1.4, C_INK * 0.8, smoothstep(VP.y, 0.0, p.y));
      col += C_BLOOD * 0.07 * exp(-abs(p.y - VP.y) / 50.0);
      if (p.y < VP.y) {
        // 城市的天際線：一棟一棟的方塊，窗戶零星亮著
        float bi = floor(p.x / 34.0);
        float bh = 6.0 + 46.0 * pow(hash12(vec2(bi, 3.0)), 2.2) * (0.4 + 0.6 * smoothstep(900.0, 0.0, abs(p.x - 960.0)));
        if (VP.y - p.y < bh) {
          col = C_INK * 1.1;
          vec2 wc = floor(p / vec2(5.0, 6.0));
          float lit = step(0.9, hash12(wc + bi)) * step(mod(p.x, 5.0), 2.5) * step(mod(p.y, 6.0), 3.0);
          col += mix(C_EMBER, C_BONE, hash12(wc)) * lit * 0.35;
        }
      } else {
        // 路面：投影回地面座標（z：往前幾公尺、X：往右幾公尺）
        float z = ${HC.toFixed(1)} * ${FOC}.0 / (p.y - VP.y);
        // 路慢慢地左彎右彎（曲率跟著小節慢慢變）：越遠偏越多
        float X = (p.x - VP.x) * z / ${FOC}.0 - cv * z * z;
        float road = step(-5.6, X) * step(X, 1.95);
        vec3 ground = C_INK * 0.7;
        vec3 asph = C_INK * 1.05 + C_INK2 * 0.35 * snoise(vec2(X * 3.0, z * 0.6));
        col = mix(ground, asph, road);
        float aa = fwidth(X) * 1.2;
        // 車道線：中線虛線（一拍一段）、兩邊的實線
        float zz = z + fract(beat) * ${DASH}.0;
        float dash = step(fract(zz / ${DASH}.0), 0.36);
        float lineC = (1.0 - smoothstep(0.07, 0.07 + aa, abs(X + 1.85))) * dash;
        float lineE = (1.0 - smoothstep(0.06, 0.06 + aa, abs(X - 1.75))) + (1.0 - smoothstep(0.06, 0.06 + aa, abs(X + 5.45)));
        vec3 paint = C_BONE * 0.55;
        // 車燈照亮前面一段
        float head = exp(-pow((z - 11.0) / 9.0, 2.0)) * exp(-pow(X / 3.2, 2.0));
        col += C_BONE * 0.05 * head * road;
        col = mix(col, paint * (0.25 + 0.9 * head + 0.15), clamp(lineC + lineE, 0.0, 1.0) * smoothstep(90.0, 20.0, z));
        // 路燈照在路上的一圈光
        for (int i = 0; i < 4; i++) {
          float zl = ${LAMP}.0 * (float(i) - fb);
          col += C_SIGNAL * 0.14 * exp(-pow((X - 2.6) / 3.2, 2.0) - pow((z - zl) / 5.0, 2.0)) * step(0.0, zl);
        }
        col *= smoothstep(0.0, 18.0, p.y - VP.y) * 0.6 + 0.4;
      }
      // 路燈（右邊，高 7 m）：燈頭與燈桿
      for (int i = 0; i < 4; i++) {
        float zl = ${LAMP}.0 * (float(i) - fb) + 0.001;
        if (zl < 0.6) continue;
        float bend = cv * zl * zl;
        vec2 lp = VP + vec2(4.2 + bend, ${HC.toFixed(1)} - 7.0) * ${FOC}.0 / zl;
        vec2 gp = VP + vec2(4.6 + bend, ${HC.toFixed(1)}) * ${FOC}.0 / zl;
        float r = 1.5 + 70.0 / zl;
        float dl = length(p - lp);
        // 抬頭顯示的字後面：路燈暗一點，字才讀得清楚
        vec2 hq = max(hud.xy - p, p - hud.zw);
        float behind = 1.0 - 0.7 * (1.0 - smoothstep(0.0, 80.0, max(hq.x, hq.y)));
        col += C_EMBER * (2.2 * exp(-dl * dl / (r * r)) + 0.25 * exp(-dl / (r * 5.0))) * behind;
        // 燈桿：從燈頭往右下到地面
        float dp = sdSegment(p, lp + vec2(r * 0.6, 0.0), gp);
        col = mix(col, C_INK * 0.9, (1.0 - smoothstep(0.0, 1.0 + 30.0 / zl, dp - 18.0 / zl)) * 0.9);
      }
      // A 柱、車頂、後照鏡
      float lpil = (p.x - mix(170.0, 30.0, p.y / 580.0));
      float rpil = (mix(1750.0, 1890.0, p.y / 580.0) - p.x);
      float pil = 1.0 - smoothstep(-1.0, 1.0, min(lpil, rpil));
      col = mix(col, C_INK * 0.55 + C_INK2 * 0.3 * (p.y / 580.0), pil);
      col = mix(col, C_INK * 0.5, 1.0 - smoothstep(34.0, 38.0, p.y));
      float dm = sdBox(p - vec2(960.0, 70.0), vec2(150.0, 28.0)) - 10.0;
      // 後照鏡：映著後面的路（很暗的漸層、一條地平線、後車的兩顆頭燈）
      vec3 mir = mix(C_INK2 * 1.1, C_INK * 0.8, smoothstep(70.0, 96.0, p.y)) + C_BONE * 0.03 * pxLine(abs(p.y - 74.0), 0.4, 1.2);
      mir += C_EMBER * 1.4 * (exp(-pow(length(p - vec2(1004.0, 78.0)) / 3.0, 2.0)) + exp(-pow(length(p - vec2(1026.0, 78.0)) / 3.0, 2.0)));
      col = mix(col, mir, aaFill(dm));
      col = mix(col, C_INK * 0.6, aaFill(sdBox(p - vec2(960.0, 32.0), vec2(8.0, 12.0))));
      // 玻璃上很淡的儀表板反光
      col += C_SIGNAL * 0.025 * smoothstep(yTop - 80.0, yTop, p.y);
    } else {
      // ---- 儀表板：深色的軟質塑料、上緣一道光、縫線
      float dy = p.y - yTop;
      col = C_INK2 * (1.15 - 0.55 * smoothstep(0.0, 500.0, dy)) * (0.94 + 0.06 * snoise(p / 3.0));
      col += C_BONE * 0.07 * pxLine(dy - 1.5, 0.5, 1.6);
      col += C_ASH * 0.08 * pxLine(abs(dy - 16.0), 0.4, 1.3) * step(0.5, fract(p.x / 12.0));
      // 路燈經過頭頂的那一下：一道斜斜的光從儀表板上掃過去
      float zl0 = ${LAMP}.0 * (0.0 - fb), zl1 = ${LAMP}.0 * (1.0 - fb);
      float zn = abs(zl0) < abs(zl1) ? zl0 : zl1;
      float s = (4.0 - zn) / 8.0 * 1500.0 - 300.0;
      col += C_EMBER * 0.07 * exp(-pow(((dy + p.x * 0.35) - s) / 160.0, 2.0)) * step(abs(zn), 6.0);
      col = bezel(p, vec2(${TACH.x}.0, ${TACH.y}.0), ${TACH.r}.0, col);
      col = bezel(p, vec2(${SPEEDO.x}.0, ${SPEEDO.y}.0), ${SPEEDO.r}.0, col);
      // 中控螢幕的框
      vec2 nc = vec2(${NAV.x + NAV.w / 2}.0, ${NAV.y + NAV.h / 2}.0);
      float dn = sdBox(p - nc, vec2(${NAV.w / 2}.0, ${NAV.h / 2}.0) - 14.0) - 14.0;
      col *= 1.0 - 0.45 * exp(-max(dn - 12.0, 0.0) / 16.0) * step(12.0, dn);
      col = mix(col, C_INK * 0.7 + C_GRAPHITE * 0.08, aaFill(dn - 12.0));
      col = mix(col, C_INK * 0.35, aaFill(dn));
      col += C_BONE * 0.06 * pxLine(abs(dn - 11.0), 0.4, 1.2) * step(p.y, nc.y);
    }
    fragColor = vec4(col * k, 1.0);
  }`, { beat: { value: 0 }, bar: { value: 0 }, kick: { value: 0 }, k: { value: 1 }, cv: { value: 0 }, hud: { value: new THREE.Vector4(0, 0, 0, 0) } });

interface Glyph { ch: string; x: number; y: number; t: number }

export default class Dashboard extends Scene {
  bg = shared('dashboard.bg', BG);
  still = this.track(new Layer2D(W, H, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 211 + (this.msg?.id ?? 0) * 13) >>> 0;
  bpm = 120;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig = ''; sigT = Infinity; sigX = 0; sigY = 0; sigSize = 44;
  tFirst = 0;
  /** 歌詞的樣式：有留言時在中控螢幕（小），沒有留言時投影在擋風玻璃上（大）。 */
  lyrSize = 52;
  hudRect: [number, number, number, number] = [0, 0, 0, 0];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    let bpm = au.bpm || 100;
    while (bpm > 220) bpm /= 2;
    this.bpm = Math.round(bpm);
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${INVITE}${song.title}${song.artist}目的地幸福剩餘公尺尚未設定心跳`);
    const c = this.layer.ctx;
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.25, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    if (m) {
      // ---- 抬頭顯示：留言（扣掉署名那一排的高度再找字級），每行置中，一個字一個字投影出來
      const sigH = 60;
      const fit = this.fit = fitText(c, m.text, FAM_MSG, HUD_BOX.w, HUD_BOX.h - sigH, { min: 56, max: 112, lineHeight: 1.18, maxLines: 3 });
      c.font = font(FAM_MSG, fit.size);
      const blockH = fit.height + sigH;
      const top = HUD_BOX.y + Math.max(0, (HUD_BOX.h - blockH) / 2) + fit.size * 0.88;
      const cx = HUD_BOX.x + HUD_BOX.w / 2;
      const pos: { ch: string; x: number; y: number }[] = [];
      let right = 0;
      fit.lines.forEach((ln, li) => {
        const lw = c.measureText(ln).width;
        let x = cx - lw / 2;
        right = Math.max(right, cx + lw / 2);
        for (const ch of Array.from(ln)) { pos.push({ ch, x, y: top + li * fit.lineHeight }); x += c.measureText(ch).width; }
      });
      const times = stagger(au, this.tFirst + beat * 0.5, pos.length, Math.min(2 * bar, 0.4 * (e - s)));
      this.glyphs = pos.map((p, i) => ({ ...p, t: times[i]! }));
      this.sigT = (times[times.length - 1] ?? this.tFirst) + beat * 0.5;
      this.sigSize = Math.round(Math.max(40, Math.min(52, fit.size * 0.48)));
      this.sigX = right;
      this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + sigH - 6;
      this.lyrSize = lyricSizeFor(fit.size, 64);
      this.hudRect = [HUD_BOX.x, top - fit.size, right, this.sigY + 10];
    } else {
      this.lyrSize = 80;
      this.hudRect = [HUD_BOX.x, HUD_BOX.y, HUD_BOX.x + HUD_BOX.w, HUD_BOX.y + HUD_BOX.h];
    }
    this.drawStill();
    this.avoid = [[this.hudRect[0], this.hudRect[1], this.hudRect[2] - this.hudRect[0], this.hudRect[3] - this.hudRect[1]], [NAV.x, NAV.y, NAV.w, NAV.h]];
  }

  private lyrStyle() {
    return this.msg
      ? { family: F.archivo(100, 700), size: this.lyrSize, minSize: 48, maxWidth: NAV.w - 90, align: 'center' as const, lineHeight: 1.12 }
      : { family: F.archivo(100, 700), size: this.lyrSize, minSize: 56, maxWidth: HUD_BOX.w - 60, align: 'center' as const, lineHeight: 1.12 };
  }

  /** 儀表的刻度與數字（畫一次；標籤只留很小的兩個）。 */
  private drawStill() {
    const L = this.still, c = L.ctx;
    L.clear();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // 轉速表 0～8（×1000），6.5 以上是紅區
    const T = TACH;
    for (let v = 0; v <= 8.001; v += 0.5) {
      const a = gAng(v, 8), major = Math.abs(v - Math.round(v)) < 1e-3;
      const r0 = T.r - (major ? 22 : 12), r1 = T.r - 6;
      c.strokeStyle = v >= 6.5 ? rgba('signal', 0.8) : rgba('bone', major ? 0.6 : 0.35); c.lineWidth = major ? 2.6 : 1.3;
      c.beginPath(); c.moveTo(T.x + Math.cos(a) * r0, T.y + Math.sin(a) * r0); c.lineTo(T.x + Math.cos(a) * r1, T.y + Math.sin(a) * r1); c.stroke();
      if (major) { c.font = font(F.archivo(87.5, 700), 22); c.fillStyle = v >= 7 ? rgba('signal', 0.85) : rgba('bone', 0.62); c.fillText(String(v), T.x + Math.cos(a) * (T.r - 44), T.y + Math.sin(a) * (T.r - 44)); }
    }
    c.strokeStyle = rgba('signal', 0.55); c.lineWidth = 4;
    c.beginPath(); c.arc(T.x, T.y, T.r - 4, gAng(6.5, 8), gAng(8, 8)); c.stroke();
    // 速度表 0～220 BPM
    const S = SPEEDO;
    for (let v = 0; v <= 220; v += 10) {
      const a = gAng(v, 220), major = v % 20 === 0;
      const r0 = S.r - (major ? 18 : 10), r1 = S.r - 5;
      c.strokeStyle = rgba('bone', major ? 0.6 : 0.32); c.lineWidth = major ? 2.2 : 1.2;
      c.beginPath(); c.moveTo(S.x + Math.cos(a) * r0, S.y + Math.sin(a) * r0); c.lineTo(S.x + Math.cos(a) * r1, S.y + Math.sin(a) * r1); c.stroke();
      if (major && v % 40 === 0) { c.font = font(F.archivo(87.5, 700), 18); c.fillStyle = rgba('bone', 0.6); c.fillText(String(v), S.x + Math.cos(a) * (S.r - 36), S.y + Math.sin(a) * (S.r - 36)); }
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    mono(c, `${this.bpm} BPM`, S.x, S.y + 64, { size: 16, tracking: 3, color: rgba('ash', 0.75), align: 'center', weight: 600 });
    mono(c, '心跳 ×1000', T.x, T.y + 64, { size: 13, tracking: 2, color: rgba('ash', 0.6), align: 'center' });
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const B = this.bg.u;
    B.beat!.value = au.beatAt(t);
    B.bar!.value = au.barAt(t);
    B.kick!.value = f.a.kick;
    B.k!.value = prog(t, s, s + 0.25);
    // 路的曲率：跟著小節慢慢左彎右彎（每首歌、每個窗格不一樣的相位）
    B.cv!.value = 0.0011 * Math.sin(au.barAt(t) * 0.35 + (this.seed % 97) * 0.1);
    (B.hud!.value as THREE.Vector4).set(...this.hudRect);
    this.bg.render(renderer, out);
    comp.draw(renderer, this.still.texture, out, { opacity: prog(t, s, s + 0.25) });
    const L = this.layer, Hh = this.hot;
    L.clear(); Hh.clear();
    const c = L.ctx, hc = Hh.ctx;
    // 每一格從同樣的畫布狀態開始（線頭、對齊、字距…不會被上一格留下來的設定影響）
    c.save(); hc.save();
    this.needles(c, hc, t, f);
    this.hazard(c, hc, t, f);
    if (this.msg) { this.hudMessage(c, hc, t); this.screenLyric(c, hc, t); } else { this.hudLyric(c, hc, t); this.screenInvite(c, t); }
    c.restore(); hc.restore();
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, Hh.upload(), out, { mode: 'add', tint: [2.2, 2.2, 2.2] });
    // 路燈經過頭頂：鏡頭輕輕顛一下（路面的接縫）；整個窗格慢慢推近
    const barHit = pulse(t, au.timeOfBar(Math.floor(au.barAt(t) + 1e-4)), 0.15);
    const push = ease.inOutCubic(clamp((t - s) / Math.max(1, e - s)));
    return { bloom: 0.85, bloomRadius: 0.65, vignette: 0.55, halation: 0.35, shake: [0, 1.5 * barHit], zoom: 1 + 0.03 * push + 0.003 * f.a.kick, popupAvoid: this.avoid };
  }

  /** 轉速表（能量＋大鼓）與速度表（BPM，拍點上抖一下）的指針。 */
  private needles(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, f: Frame) {
    const au = this.ctx.audio;
    const rpm = clamp(1.1 + 5.0 * f.a.rms + 1.6 * f.a.kick + 0.8 * au.energyAt(t), 0.7, 7.9);
    const bp = pulse(t, au.timeOfBeat(Math.floor(au.beatAt(t) + 1e-4)), 0.1);
    const spd = this.bpm + 2.2 * bp - 1;
    const draw = (g: { x: number; y: number; r: number }, a: number) => {
      const tipX = g.x + Math.cos(a) * (g.r - 20), tipY = g.y + Math.sin(a) * (g.r - 20);
      const tailX = g.x - Math.cos(a) * 26, tailY = g.y - Math.sin(a) * 26;
      for (const [cc, col] of [[c, rgba('signal')], [hc, rgba('signal', 0.8)]] as const) {
        cc.strokeStyle = col; cc.lineWidth = 5; cc.lineCap = 'round';
        cc.beginPath(); cc.moveTo(tailX, tailY); cc.lineTo(tipX, tipY); cc.stroke();
      }
      c.fillStyle = rgba('ink2'); c.beginPath(); c.arc(g.x, g.y, 18, 0, TAU); c.fill();
      c.strokeStyle = rgba('graphite'); c.lineWidth = 2; c.stroke();
    };
    draw(TACH, gAng(rpm, 8));
    draw(SPEEDO, gAng(spd, 220));
  }

  /** 雙黃燈按鈕：每一拍前半亮。 */
  private hazard(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, f: Frame) {
    const on = t >= this.tFirst && f.beatPhase < 0.5;
    const tri = (cc: CanvasRenderingContext2D, r: number) => {
      cc.beginPath();
      for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i * TAU) / 3; i ? cc.lineTo(HAZ.x + Math.cos(a) * r, HAZ.y + 4 + Math.sin(a) * r) : cc.moveTo(HAZ.x + Math.cos(a) * r, HAZ.y + 4 + Math.sin(a) * r); }
      cc.closePath();
    };
    c.fillStyle = rgba('ink2'); c.beginPath(); c.roundRect(HAZ.x - 30, HAZ.y - 20, 60, 44, 8); c.fill();
    c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 1.5; c.stroke();
    c.lineWidth = 3.2; c.lineJoin = 'round';
    for (const r of [15, 7]) { tri(c, r); c.strokeStyle = on ? rgba('signal') : rgba('blood', 0.6); c.stroke(); }
    if (on) { hc.lineWidth = 4; hc.lineJoin = 'round'; for (const r of [15, 7]) { tri(hc, r); hc.strokeStyle = rgba('signal', 0.9); hc.stroke(); } }
  }

  /** 擋風玻璃上的投影：留言一個字一個字投影出來（剛出來是訊號色），玻璃的疊影、署名、小小的目的地。 */
  private hudMessage(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const fit = this.fit!, m = this.msg!;
    c.font = hc.font = font(FAM_MSG, fit.size);
    for (const g of this.glyphs) {
      if (t < g.t) break;
      const heat = 1 - clamp((t - g.t) / 0.4);
      const base = g.ch === '♥' ? 'rose' : 'bone';
      const col = heat > 0 ? mixRgba(base, 'signal', heat) : rgba(base, 0.95);
      // 疊影：擋風玻璃內外兩面各反射一次
      c.save(); c.globalAlpha = 0.08; fillGlyph(c, g.ch, g.x, g.y - 7, col); c.restore();
      fillGlyph(c, g.ch, g.x, g.y, col);
      if (heat > 0.05) fillGlyph(hc, g.ch, g.x, g.y, rgba('signal', heat * 0.8), rgba('rose', heat * 0.8));
    }
    if (t >= this.sigT) {
      c.save(); c.globalAlpha = prog(t, this.sigT, this.sigT + 0.3) * 0.85;
      c.font = font(FAM_MSG, this.sigSize); c.fillStyle = rgba('bone'); c.textAlign = 'right';
      c.fillText(this.sig, this.sigX, this.sigY);
      c.restore();
      // 導航的一行小字（冷面）：剩餘距離一路倒數
      const e = this.ctx.end;
      const dist = Math.max(0, Math.round(520 * (1 - clamp((t - this.sigT) / Math.max(1, e - this.sigT - 0.5)))));
      mono(c, dist > 0 ? `目的地：幸福　·　剩餘 ${dist} 公尺` : '已抵達：幸福', HUD_BOX.x + HUD_BOX.w / 2, this.sigY + 58, { size: 17, tracking: 4, color: rgba('signal', 0.65 * prog(t, this.sigT, this.sigT + 0.3)), align: 'center' });
    }
    void m;
  }

  /** 沒有留言：歌詞投影在擋風玻璃上當主角（逐字跟唱，疊影）；純音樂顯示歌名。 */
  private hudLyric(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const cx = HUD_BOX.x + HUD_BOX.w / 2, base = HUD_BOX.y + HUD_BOX.h * 0.6;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = this.lyrStyle();
      const lay = layoutLyric(c, ly.line, st);
      const oy = base - (lay.rows.length > 1 ? lay.size * 0.55 : 0) + (1 - ease.outExpo(ly.k)) * 16;
      c.save(); c.translate(cx, oy - 7); c.globalAlpha = 0.07; drawLyric(c, ly.line, t, st, lay, ly.k); c.restore();
      c.save(); c.translate(cx, oy); drawLyric(c, ly.line, t, st, lay, ly.k * 0.95); c.restore();
      hc.save(); hc.translate(cx, oy); drawLyric(hc, ly.line, t, { ...st, sung: 'rgba(0,0,0,0)', unsung: 'rgba(0,0,0,0)', active: rgba('signal', 0.8) }, lay, ly.k); hc.restore();
    } else if (!lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).length) {
      c.font = font(F.archivo(100, 700), 72); c.textAlign = 'center'; c.fillStyle = rgba('bone', 0.9);
      fillWithHearts(c, song.title, cx, base);
      c.textAlign = 'left';
    }
  }

  /** 中控螢幕：音樂播放器（歌詞比留言小一級，逐字跟唱）、左上歌名、下面一條進度。 */
  private screenLyric(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const { lyrics, song, audio: au } = this.ctx;
    this.screenFrame(c, t);
    const cx = NAV.x + NAV.w / 2, cy = NAV.y + NAV.h / 2 + 14;
    const ly = lyricAt(lyrics, t);
    c.save(); c.beginPath(); c.roundRect(NAV.x, NAV.y, NAV.w, NAV.h, 14); c.clip();
    if (ly) {
      const st = this.lyrStyle();
      const lay = layoutLyric(c, ly.line, st);
      const oy = cy + lay.size * 0.35 - (lay.rows.length > 1 ? lay.size * 0.58 : 0) + (1 - ease.outExpo(ly.k)) * 12;
      c.save(); c.translate(cx, oy); drawLyric(c, ly.line, t, st, lay, ly.k); c.restore();
      hc.save(); hc.translate(cx, oy); drawLyric(hc, ly.line, t, { ...st, sung: 'rgba(0,0,0,0)', unsung: 'rgba(0,0,0,0)', active: rgba('signal', 0.6) }, lay, ly.k); hc.restore();
    } else if (!lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).length) {
      c.font = font(F.archivo(100, 700), 52); c.textAlign = 'center'; c.fillStyle = rgba('bone', 0.85);
      c.fillText(`♪ ${song.title}`, cx, cy + 18);
      c.textAlign = 'left';
    }
    c.restore();
    // 左上：歌名（很小）；下面：歌的進度
    mono(c, `♪ ${song.title}`, NAV.x + 30, NAV.y + 40, { size: 15, tracking: 2, color: rgba('ash', 0.6) });
    const prog01 = clamp(t / Math.max(1, au.duration));
    c.fillStyle = rgba('graphite', 0.8); c.fillRect(NAV.x + 30, NAV.y + NAV.h - 36, NAV.w - 60, 2);
    c.fillStyle = rgba('signal', 0.8); c.fillRect(NAV.x + 30, NAV.y + NAV.h - 36, (NAV.w - 60) * prog01, 2);
  }

  /** 沒有留言：螢幕寫「目的地：尚未設定」與邀請。 */
  private screenInvite(c: CanvasRenderingContext2D, t: number) {
    this.screenFrame(c, t);
    const cx = NAV.x + NAV.w / 2;
    const k = prog(t, this.tFirst, this.tFirst + 0.4);
    c.save(); c.globalAlpha = k;
    c.font = font(F.hei(500), 28); c.fillStyle = rgba('ash', 0.85); c.textAlign = 'center';
    c.fillText('目的地：尚未設定', cx, NAV.y + NAV.h / 2 - 18);
    c.font = font(F.hand(700), 44); c.fillStyle = rgba('bone', 0.9);
    c.fillText(INVITE, cx, NAV.y + NAV.h / 2 + 50);
    c.restore();
  }

  /** 螢幕本身：很暗的底、一道斜斜的玻璃反光（螢幕在車裡，不是一張介面截圖）。 */
  private screenFrame(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.beginPath(); c.roundRect(NAV.x, NAV.y, NAV.w, NAV.h, 14); c.clip();
    const g = c.createLinearGradient(NAV.x, NAV.y, NAV.x + NAV.w, NAV.y + NAV.h);
    g.addColorStop(0, rgba('ink2', 0.9)); g.addColorStop(1, rgba('ink', 0.9));
    c.fillStyle = g; c.fillRect(NAV.x, NAV.y, NAV.w, NAV.h);
    const x0 = NAV.x + 160 + 40 * Math.sin(t * 0.25);
    const sh = c.createLinearGradient(x0, NAV.y, x0 + 220, NAV.y + 80);
    sh.addColorStop(0, rgba('bone', 0)); sh.addColorStop(0.5, rgba('bone', 0.035)); sh.addColorStop(1, rgba('bone', 0));
    c.fillStyle = sh;
    c.beginPath(); c.moveTo(x0, NAV.y); c.lineTo(x0 + 200, NAV.y); c.lineTo(x0 - 60, NAV.y + NAV.h); c.lineTo(x0 - 260, NAV.y + NAV.h); c.closePath(); c.fill();
    c.restore();
  }
}
