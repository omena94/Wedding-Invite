// 車廂顯示器（亮，批次 B3・街景）：白天的電車車廂裡，面對一扇車門。車門上方是一條寬寬的 LCD 資訊螢幕，
// 車門的兩扇窗、右邊的大車窗外，田野與遠山一直往後捲；右上是車廂的廣告框。
//  - 兩行歌詞就是螢幕右半邊的「下一站」：中文大字（站名的樣子）、下面原文小一號（像站名的外語標示），各照自己的逐字時間亮
//    （還沒唱淡灰、唱到訊號色、唱完深墨；原文唱到就轉深墨、淡一點）。換句時新的一句從右邊滑進來（像螢幕換頁）。
//    沒有翻譯：只有中文，垂直置中在同一塊（不留空排）。純音樂：「下一站 永遠 Forever」。
//  - 螢幕左半邊是路線圖：宣文與孟庭的「婚禮線」，相遇 → 約會 → 在一起 → 求婚 → 今天 → 永遠；每一拍點亮一顆小站點（列車記號往前一格），
//    每個小節線到一站（那一站的圈亮成訊號色、跳一下）。
//  - 主打留言是右上車廂廣告框裡的海報（手寫字，40～60 px，留言區約 600×380），署名在最後一行下面；沒有留言：海報是邀請。
//  - 一直在動：窗外遠山、樹與人家、田埂照遠近不同速度往後流；電線桿每一拍刷過車窗；每兩小節對向來一班車「唰」地擦身而過；
//    陽光從車窗照進來，光斑在車門和地板上滑過；車廂跟著鐵軌的接縫在拍點輕輕晃（整個畫面一起）。
//  - 右下角（HUD）是乾淨的車廂牆面。
// 手法：窗外景色是一個全螢幕 shader；車廂（牆、門、窗框、廣告框、螢幕外框）是 init() 畫好的一張 Canvas（窗的地方挖空）；
// 陽光的光斑是另一個疊加的 shader；螢幕內容每格畫在一張小 Canvas 上貼到螢幕的位置。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, pulse } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { loadB3, layoutBi, paintBi, msgBlock, drawMsgBlock, B3_INVITE, type BiLayout, type MsgBlock, type Rect } from './_b3';
import { subRect } from './_t6';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'city', paper: true, energy: [0.2, 0.9], bars: [4, 8], weight: 1 };

/** 螢幕（外框、畫面）、路線圖與「下一站」的分界。 */
const LCD = { x: 120, y: 60, w: 1060, h: 310, bez: 14 };
const SCR = { x: LCD.x + LCD.bez, y: LCD.y + LCD.bez, w: LCD.w - LCD.bez * 2, h: LCD.h - LCD.bez * 2 };
const MAPW = 372;
/** 車門（兩扇）與門上的窗、左邊的小窗、右邊的大車窗。 */
const DOOR = { x: 290, y: 404, w: 700, floor: 1004 };
const WINS: [number, number, number, number, number][] = [
  [DOOR.x + 58, 452, 236, 380, 18], [DOOR.x + DOOR.w / 2 + 56, 452, 236, 380, 18], [0, 440, 214, 330, 14], [1080, 520, 840, 270, 16],
];
/** 廣告框（右上）：海報的留言區約 600×380。 */
const AD = { x: 1236, y: 60, w: 624, h: 420 };
const POSTER = { x: AD.x + 16, y: AD.y + 16, w: AD.w - 32, h: AD.h - 32 };
const STATIONS = ['相遇', '約會', '在一起', '求婚', '今天', '永遠'];

const LAND = () => new FSPass(/* glsl */ `
  uniform float t; uniform float run; uniform float pole; uniform float opp; uniform float dim;
  // 一層地景的高度（x 以 px 算，捲動後的座標）
  float hills(float x, float s, float a, float seed) { return a * (0.55 * snoise(vec2(x / s, seed)) + 0.3 * snoise(vec2(x / (s * 0.37), seed + 3.0)) + 0.15 * snoise(vec2(x / (s * 0.13), seed + 7.0))); }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 天空：白天，上面淡淡的主題色，地平線偏暖白；幾朵慢慢飄的雲
    vec3 col = mix(mix(C_PAPER, C_SIGNAL, 0.14), mix(C_PAPER, C_BONE, 0.6), smoothstep(380.0, 640.0, p.y));
    float cl = fbm(vec2((p.x + run * 0.02) / 380.0, p.y / 110.0), 4);
    col = mix(col, mix(C_PAPER, C_BONE, 0.85), 0.55 * smoothstep(0.15, 0.55, cl) * smoothstep(650.0, 420.0, p.y));
    // 遠山（很慢）：淡淡的、偏主題色
    float y1 = 600.0 - 60.0 - hills(p.x + run * 0.04, 520.0, 60.0, 1.0);
    col = mix(col, mix(C_PAPER, mix(C_SIGNAL, C_ASH, 0.5), 0.36), smoothstep(0.5, -0.5, y1 - p.y));
    // 中景：起伏的丘陵，上面一棵棵圓圓的樹（樹冠、樹幹），比遠山深
    float x2 = p.x + run * 0.2;
    float yb = 650.0 - hills(x2, 300.0, 30.0, 5.0);
    vec3 hillC = mix(C_PAPER, mix(C_SEPIA, C_SIGNAL, 0.25), 0.5);
    float cid = floor(x2 / 58.0);
    float tr = step(0.4, hash11(cid * 1.3)) * (16.0 + 18.0 * hash11(cid + 3.0));
    vec2 tc = vec2((cid + 0.5) * 58.0 + 12.0 * (hash11(cid + 7.0) - 0.5), yb - tr * 1.3);
    float canopy = length(vec2(x2, p.y) - tc) - tr;
    float trunk = step(abs(x2 - tc.x), 2.5) * step(tc.y, p.y) * step(p.y, yb + 2.0) * step(1.0, tr);
    vec3 treeC = mix(C_PAPER, mix(C_SEPIA, C_SIGNAL, 0.2), 0.62) * (0.9 + 0.12 * smoothstep(tr, -tr, dot(vec2(x2, p.y) - tc, vec2(0.7, 0.7))));
    col = mix(col, hillC, smoothstep(0.5, -0.5, yb - p.y));
    col = mix(col, treeC, smoothstep(0.8, -0.8, canopy) * step(1.0, tr));
    col = mix(col, mix(C_SEPIA, C_GRAPHITE, 0.3) * 0.8 + C_PAPER * 0.2, trunk);
    // 近一點的人家（白牆、訊號色的斜屋頂）與田（中快）
    float x3 = p.x + run * 0.5;
    float cell = floor(x3 / 420.0), fx = fract(x3 / 420.0) * 420.0;
    float has = step(0.5, hash11(cell * 1.9));
    float hw = 80.0 + 50.0 * hash11(cell + 2.0), hx = 90.0 + 180.0 * hash11(cell + 4.0);
    float wtop = 652.0, rh = hw * 0.36;
    float wall = step(hx, fx) * step(fx, hx + hw) * step(wtop, p.y) * step(p.y, 700.0);
    float roof = step(wtop - rh, p.y) * step(p.y, wtop) * step(abs(fx - hx - hw * 0.5), (p.y - (wtop - rh)) / rh * (hw * 0.62));
    float winH = wall * step(0.3, fract((fx - hx) / 26.0)) * step(fract((fx - hx) / 26.0), 0.65) * step(666.0, p.y) * step(p.y, 684.0);
    col = mix(col, mix(C_PAPER, C_BONE, 0.5), wall * has);
    col = mix(col, mix(C_INK2, C_ASH, 0.5), winH * has);
    col = mix(col, mix(C_BLOOD, C_SIGNAL, 0.45), roof * has);
    // 田：一畦一畦的橫條（越近越寬、越快），往後流
    if (p.y > 700.0) {
      float v = (p.y - 700.0) / 100.0;
      float rows = v * v * 6.0;
      col = mix(C_PAPER, mix(C_SEPIA, C_SIGNAL, 0.25), 0.4 + 0.1 * step(0.5, fract(rows)));
      col *= 0.95 + 0.05 * snoise(vec2((p.x + run * (0.6 + v * 0.8)) / 24.0, floor(rows) * 3.0));
    }
    // 鐵道旁的圍籬（很快，糊成一條）
    if (p.y > 760.0 && p.y < 800.0) col = mix(col, mix(C_PAPER, C_SEPIA, 0.5), 0.35 + 0.1 * sin((p.x + run * 1.6) * 0.05));
    // 電線桿：每一拍刷過窗子中間（很快，糊掉的一道影子）；上面的電線一起一伏
    float px = p.x - pole;
    float pw = 26.0;
    col = mix(col, mix(C_SEPIA, C_GRAPHITE, 0.5) * 0.9, (1.0 - smoothstep(pw * 0.5, pw * 0.5 + 30.0, abs(px))) * 0.75 * step(380.0, p.y));
    float wire = abs(p.y - (430.0 + 24.0 * (px / 900.0) * (px / 900.0)));
    col = mix(col, mix(C_SEPIA, C_GRAPHITE, 0.4), (1.0 - smoothstep(0.6, 1.8, wire)) * 0.6);
    // 對向的列車：唰地擦身而過（銀色車身、一排窗、訊號色的腰帶），很快
    if (opp > 0.0 && opp < 1.0) {
      float ox = p.x - mix(${W}.0 + 3200.0, -3200.0, opp);
      if (abs(ox) < 3000.0 && p.y > 470.0 && p.y < 790.0) {
        vec3 body = mix(C_ASH, C_BONE, 0.55) * (0.92 + 0.08 * step(0.5, fract(ox / 36.0)));
        float win = step(500.0, p.y) * step(p.y, 600.0) * step(0.18, fract(ox / 260.0)) * step(fract(ox / 260.0), 0.82);
        body = mix(body, mix(C_INK2, C_ASH, 0.4), win);
        body = mix(body, mix(C_SIGNAL, C_BLOOD, 0.3), step(640.0, p.y) * step(p.y, 666.0));
        col = mix(col, body, 0.95);
      }
    }
    // 過橋、過站的時候窗外暗一下
    col *= dim;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, run: { value: 0 }, pole: { value: -999 }, opp: { value: -1 }, dim: { value: 1 } });

/** 陽光：從車窗照進來的光斑，在車門與地板上往後滑（疊加）。電線桿經過時一道影子切過去。 */
const SUN = () => new FSPass(/* glsl */ `
  uniform float run; uniform float pole;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 地板上的光斑：斜的平行四邊形，一塊一塊往後滑
    float k = 0.0;
    if (p.y > 900.0) {
      float u = p.x + (p.y - 900.0) * 0.9 + run * 0.9;
      float c = fract(u / 520.0);
      k = smoothstep(0.02, 0.06, c) * (1.0 - smoothstep(0.42, 0.46, c)) * smoothstep(900.0, 960.0, p.y);
    }
    // 車門上的光斑（窗的形狀被斜斜地投在門板上）
    if (p.y > 404.0 && p.y < 1000.0 && p.x > ${DOOR.x}.0 && p.x < ${DOOR.x + DOOR.w}.0) {
      float u = p.x + (p.y - 404.0) * 0.35 + run * 0.9;
      float c = fract(u / 700.0);
      k = max(k, (smoothstep(0.02, 0.05, c) * (1.0 - smoothstep(0.3, 0.33, c))) * smoothstep(840.0, 880.0, p.y) * 0.9);
    }
    // 電線桿的影子
    float sh = 1.0 - (1.0 - smoothstep(20.0, 70.0, abs(p.x + (p.y - 900.0) * 0.9 - pole))) * 0.8;
    // 右下角（HUD）不要光斑
    k *= 1.0 - step(1340.0, p.x) * step(820.0, p.y);
    fragColor = vec4((C_EMBER * 0.16 + C_BONE * 0.08) * k * sh, 0.0);
  }`, { run: { value: 0 }, pole: { value: -999 } }, { blending: THREE.AdditiveBlending, transparent: true });

export default class TrainLCD extends Scene {
  land = shared('trainlcd.land', LAND);
  sun = shared('trainlcd.sun', SUN);
  car!: Layer2D;
  scr = this.track(new Layer2D(SCR.w, SCR.h, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 71 + (this.msg?.id ?? 0) * 3) >>> 0;
  mb: MsgBlock | null = null;
  lays = new Map<Line, BiLayout>();
  hasLyrics = false;
  size = 52;
  /** 對向列車擦身而過的時間（每兩小節）。 */
  opps: number[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadB3(this.ctx, `${STATIONS.join('')}下一站Next stopForever婚禮線往號車祝福廣告本車廂限定Wedding Line`);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.car = this.track(new Layer2D(W, H, undefined, { fast: true }));
    this.buildCar();
    this.size = lyricV2(this.mb ? this.mb.fit.size : null);
    const c = this.scr.ctx;
    const TW = SCR.w - MAPW - 60;
    for (const l of lyrics.linesIn(s - 14, e + 1)) this.lays.set(l, layoutBi(c, l, { family: F.hei(700), size: this.size, minSize: V2.lyrMin, maxWidth: TW, lineHeight: 1.12, subFamily: F.hei(500) }));
    for (let b = Math.ceil(au.barAt(s + 0.5)) + 1; au.timeOfBar(b) < e - 0.6; b += 2) this.opps.push(au.timeOfBar(b) - 0.25);
    this.avoid = [[SCR.x + MAPW, SCR.y, SCR.w - MAPW, SCR.h], [POSTER.x, POSTER.y, POSTER.w, POSTER.h]];
  }

  /** 車廂（畫一次）：天花板、牆、車門、窗框（挖空）、扶手、廣告框與海報、螢幕外框。 */
  private buildCar() {
    const c = this.car.ctx;
    c.textBaseline = 'alphabetic';
    // 牆（米白的美耐板）、天花板（一條燈帶）、地板
    const wall = c.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, mixRgba('paper', 'bone', 0.6)); wall.addColorStop(0.6, mixRgba('paper', 'ash', 0.12)); wall.addColorStop(1, mixRgba('paper', 'ash', 0.25));
    c.fillStyle = wall; c.fillRect(0, 0, W, H);
    c.fillStyle = mixRgba('bone', 'paper', 0.2); c.fillRect(0, 0, W, 34);
    c.fillStyle = mixRgba('ash', 'paper', 0.6); c.fillRect(0, 34, W, 4);
    c.fillStyle = mixRgba('paper', 'sepia', 0.3); c.fillRect(0, DOOR.floor, W, H - DOOR.floor);
    c.fillStyle = mixRgba('paper', 'sepia', 0.4); c.fillRect(0, DOOR.floor, W, 6);
    // 窗下的牆裙（淺一點的色帶）
    c.fillStyle = mixRgba('paper', 'signal', 0.1); c.fillRect(0, 800, DOOR.x, 18); c.fillRect(DOOR.x + DOOR.w, 800, W - DOOR.x - DOOR.w, 18);
    // 車門：不鏽鋼（直的細紋、左右兩扇）、門框
    c.fillStyle = mixRgba('ash', 'graphite', 0.3); c.fillRect(DOOR.x - 16, DOOR.y - 16, DOOR.w + 32, DOOR.floor - DOOR.y + 16);
    for (const lx of [DOOR.x, DOOR.x + DOOR.w / 2]) {
      const g = c.createLinearGradient(lx, 0, lx + DOOR.w / 2, 0);
      g.addColorStop(0, mixRgba('ash', 'bone', 0.55)); g.addColorStop(0.5, mixRgba('ash', 'bone', 0.35)); g.addColorStop(1, mixRgba('ash', 'bone', 0.5));
      c.fillStyle = g; c.fillRect(lx + 2, DOOR.y, DOOR.w / 2 - 4, DOOR.floor - DOOR.y);
      c.fillStyle = rgba('ink', 0.03);
      for (let x = lx; x < lx + DOOR.w / 2; x += 5) c.fillRect(x, DOOR.y, 1, DOOR.floor - DOOR.y);
    }
    c.fillStyle = mixRgba('graphite', 'ink', 0.3); c.fillRect(DOOR.x + DOOR.w / 2 - 2, DOOR.y, 4, DOOR.floor - DOOR.y);
    // 門上的「注意夾手」小貼紙（訊號色的細框，很小）
    for (const lx of [DOOR.x + 120, DOOR.x + DOOR.w / 2 + 120]) { c.strokeStyle = mixRgba('signal', 'blood', 0.3, 0.6); c.lineWidth = 2; c.strokeRect(lx, 880, 110, 40); c.font = font(F.hei(500), 14); c.fillStyle = mixRgba('sepia', 'ink', 0.3, 0.6); c.fillText('請勿倚靠車門', lx + 12, 905); }
    // 窗：挖空（外面的景色從底下透上來）、窗框、一層淡淡的玻璃反光
    for (const [x, y, w, h, r] of WINS) {
      c.fillStyle = mixRgba('ash', 'graphite', 0.25);
      c.beginPath(); c.roundRect(x - 10, y - 10, w + 20, h + 20, r + 8); c.fill();
      c.save(); c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.roundRect(x, y, w, h, r); c.fill();
      c.restore();
      c.save(); c.beginPath(); c.roundRect(x, y, w, h, r); c.clip();
      c.fillStyle = rgba('bone', 0.06); c.fillRect(x, y, w, h);
      c.fillStyle = rgba('bone', 0.1);
      c.beginPath(); c.moveTo(x + w * 0.1, y); c.lineTo(x + w * 0.3, y); c.lineTo(x + w * 0.05, y + h); c.lineTo(x - w * 0.15, y + h); c.closePath(); c.fill();
      c.restore();
    }
    // 直立的扶手（不鏽鋼圓管）
    for (const px of [DOOR.x - 46, DOOR.x + DOOR.w + 34]) {
      const g = c.createLinearGradient(px, 0, px + 16, 0);
      g.addColorStop(0, mixRgba('ash', 'bone', 0.7)); g.addColorStop(0.4, rgba('bone')); g.addColorStop(1, mixRgba('ash', 'graphite', 0.4));
      c.fillStyle = g; c.fillRect(px, 38, 16, DOOR.floor - 38);
    }
    // 螢幕外框（深色的塑膠）
    c.fillStyle = mixRgba('graphite', 'ink2', 0.5);
    c.beginPath(); c.roundRect(LCD.x, LCD.y, LCD.w, LCD.h, 16); c.fill();
    c.fillStyle = mixRgba('graphite', 'ink2', 0.2); c.fillRect(LCD.x + 30, LCD.y + LCD.h - 6, LCD.w - 60, 3);
    // 廣告框（鋁框＋海報）
    this.buildAd(c);
    this.car.upload();
  }

  private buildAd(c: CanvasRenderingContext2D) {
    const m = this.msg;
    c.fillStyle = mixRgba('ash', 'bone', 0.35); c.beginPath(); c.roundRect(AD.x, AD.y, AD.w, AD.h, 8); c.fill();
    c.fillStyle = mixRgba('ash', 'graphite', 0.2); c.fillRect(AD.x + 8, AD.y + 8, AD.w - 16, AD.h - 16);
    const P = POSTER;
    c.fillStyle = mixRgba('bone', 'paper', 0.3); c.fillRect(P.x, P.y, P.w, P.h);
    // 海報：左上一條訊號色的色塊、右下兩個交扣的細線戒指（小小的）
    c.fillStyle = mixRgba('signal', 'blood', 0.25, 0.85); c.fillRect(P.x, P.y, 10, P.h);
    c.strokeStyle = mixRgba('signal', 'sepia', 0.3, 0.4); c.lineWidth = 2;
    c.beginPath(); c.arc(P.x + P.w - 70, P.y + 44, 16, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(P.x + P.w - 50, P.y + 44, 16, 0, Math.PI * 2); c.stroke();
    c.font = font(F.hei(700), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('blood', 0.8);
    c.fillText(m?.couple ? 'FROM THE COUPLE · 新人' : '祝福廣告 · 本車廂限定', P.x + 36, P.y + 38); c.letterSpacing = '0px';
    if (m) {
      const mb = (this.mb = msgBlock(c, m, F.hand(700), P.w - 70, P.h - 70, { sigFamily: F.hand(400), lineHeight: 1.26 }));
      c.save(); c.translate(P.x + 36, P.y + 56 + Math.max(0, (P.h - 70 - mb.h) * 0.45));
      drawMsgBlock(c, mb, { color: mixRgba('ink', 'sepia', 0.35), sigColor: rgba('blood', 0.9) });
      c.restore();
    } else {
      const [a, b] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
      c.font = font(F.hand(700), 56); c.fillStyle = mixRgba('ink', 'sepia', 0.35);
      const wa = c.measureText(a).width;
      c.fillText(a, P.x + 36, P.y + 150); drawHeart(c, P.x + 36 + wa + 42, P.y + 131, 38); c.fillText(b, P.x + 36 + wa + 84, P.y + 150);
      c.font = font(F.mono(500), 18); c.letterSpacing = '6px'; c.fillStyle = rgba('sepia', 0.7); c.fillText(DATE_DOTS, P.x + 38, P.y + 198); c.letterSpacing = '0px';
      c.font = font(F.hand(700), 30); c.fillStyle = mixRgba('ink', 'sepia', 0.35); c.fillText('這個車廂的廣告位，留給你的祝福', P.x + 36, P.y + 282);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.75); c.fillText(B3_INVITE, P.x + 36, P.y + 330);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    // 窗外：捲動的距離（px）、電線桿（每一拍在畫面中間）、對向列車、過橋時暗一下
    const run = t * 1400;
    const bt = au.beatAt(t), bph = bt - Math.floor(bt);
    const pole = 960 - (bph < 0.5 ? bph : bph - 1) * 3400;
    const lu = this.land.u;
    lu.t!.value = t; lu.run!.value = run; lu.pole!.value = pole;
    let opp = -1;
    for (const o of this.opps) { const k = (t - o) / 0.55; if (k > 0 && k < 1) opp = k; }
    lu.opp!.value = opp;
    lu.dim!.value = 1;
    this.land.render(renderer, out);
    comp.draw(renderer, this.car.texture, out);
    this.sun.u.run!.value = run; this.sun.u.pole!.value = pole;
    this.sun.render(renderer, out);
    // 螢幕
    this.drawScreen(t);
    comp.draw(renderer, this.scr.upload(), out, subRect(SCR.x, SCR.y, SCR.w, SCR.h));
    // 車廂跟著鐵軌的接縫在拍點晃一下；整段慢慢推近
    const kick = pulse(t, au.timeOfBeat(Math.floor(bt)), 0.12);
    const p = ease.inOutQuad(prog(t, s, e));
    return {
      paper: 1, bloom: 0.2, vignette: 0.28, grain: 0.035,
      shake: [0.6 * Math.sin(t * 5.3), 2.2 * kick + 0.8 * Math.sin(t * 3.1)], zoom: 1.01 + 0.025 * p,
      popupAvoid: this.avoid,
    };
  }

  /** 螢幕：上面一條路線色的標題列；左邊路線圖（一拍一顆站點、一小節一站）；右邊「下一站」＝兩行歌詞。 */
  private drawScreen(t: number) {
    const { lyrics, audio: au } = this.ctx;
    const S = this.scr; S.clear();
    const c = S.ctx;
    c.textBaseline = 'alphabetic';
    c.fillStyle = mixRgba('bone', 'paper', 0.15); c.fillRect(0, 0, SCR.w, SCR.h);
    // 標題列
    c.fillStyle = mixRgba('signal', 'blood', 0.3); c.fillRect(0, 0, SCR.w, 40);
    c.font = font(F.hei(700), 20); c.fillStyle = rgba('bone', 0.97); c.fillText('婚禮線　往 永遠', 18, 28);
    c.textAlign = 'right'; c.font = font(F.hei(500), 16); c.fillStyle = rgba('bone', 0.85); c.fillText('Wedding Line · 3 號車', SCR.w - 18, 27); c.textAlign = 'left';
    // ---- 路線圖：六站，站與站之間三顆小站點（一拍一顆），一小節一站
    const bt = au.beatAt(t);
    const n = STATIONS.length;
    const step = Math.floor(bt) % ((n - 1) * 4);
    const x0 = 40, x1 = MAPW - 30, ly = 128;
    const sx = (i: number) => lerp(x0, x1, i / (n - 1));
    c.strokeStyle = mixRgba('ash', 'paper', 0.3); c.lineWidth = 10; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x0, ly); c.lineTo(x1, ly); c.stroke();
    const upto = lerp(x0, x1, step / ((n - 1) * 4));
    c.strokeStyle = mixRgba('signal', 'blood', 0.3); c.beginPath(); c.moveTo(x0, ly); c.lineTo(upto, ly); c.stroke();
    for (let k = 0; k <= (n - 1) * 4; k++) {
      const x = lerp(x0, x1, k / ((n - 1) * 4));
      const isSt = k % 4 === 0, si = k / 4;
      const lit = k <= step, cur = k === step;
      if (isSt) {
        const pop = cur ? 1 + 0.3 * pulse(t, au.timeOfBeat(Math.floor(bt)), 0.2) : 1;
        c.fillStyle = cur ? rgba('signal') : lit ? mixRgba('signal', 'blood', 0.3) : rgba('bone');
        c.strokeStyle = lit ? mixRgba('signal', 'blood', 0.3) : mixRgba('ash', 'paper', 0.2); c.lineWidth = 4;
        c.beginPath(); c.arc(x, ly, 12 * pop, 0, Math.PI * 2); c.fill(); c.stroke();
        c.font = font(F.hei(cur ? 700 : 500), 18); c.textAlign = 'center';
        c.fillStyle = cur ? rgba('ink', 0.9) : rgba('sepia', lit ? 0.55 : 0.8);
        // 站名寫在線的上下交錯（擠得下）
        c.fillText(STATIONS[si]!, x, si % 2 ? ly + 44 : ly - 26);
        c.textAlign = 'left';
      } else {
        c.fillStyle = lit ? rgba('bone') : mixRgba('ash', 'paper', 0.1);
        c.beginPath(); c.arc(x, ly, 3.2, 0, Math.PI * 2); c.fill();
      }
    }
    // 列車記號（一個小三角形，一拍往前一格，落在拍點）
    const tk = ease.outExpo(clamp((bt - Math.floor(bt)) / 0.3));
    const tx = lerp(x0, x1, Math.min((n - 1) * 4, step - 1 + tk) / ((n - 1) * 4));
    c.fillStyle = rgba('ink', 0.85);
    c.beginPath(); c.moveTo(tx + 12, ly + 66); c.lineTo(tx - 8, ly + 56); c.lineTo(tx - 8, ly + 76); c.closePath(); c.fill();
    // 路線圖下面：抵達時間（冷面：永遠）
    c.font = font(F.hei(500), 16); c.fillStyle = rgba('sepia', 0.65);
    c.fillText(`${STATIONS[Math.min(n - 1, Math.floor(step / 4) + 1)]} · 約 ${4 - (Math.floor(bt) % 4)} 拍後抵達`, x0 - 10, SCR.h - 26);
    // 分隔線
    c.fillStyle = mixRgba('ash', 'paper', 0.4); c.fillRect(MAPW, 58, 2, SCR.h - 80);
    // ---- 下一站：兩行歌詞（新的一句從右邊滑進來）
    const X = MAPW + 34, TW = SCR.w - X - 24;
    c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.6); c.letterSpacing = '3px';
    c.fillText('下一站　Next stop', X, 76); c.letterSpacing = '0px';
    const ink = { unsung: rgba('ash', 0.55), active: mixRgba('signal', 'blood', 0.2), sung: mixRgba('ink', 'sepia', 0.3) };
    const top = 94, bot = SCR.h - 18;
    if (!this.hasLyrics) {
      c.font = font(F.hei(700), V2.lyrMax); c.fillStyle = ink.sung; c.fillText('永遠', X, top + 64);
      c.font = font(F.hei(500), 36); c.fillStyle = rgba('sepia', 0.75); c.fillText('Forever', X, top + 118);
      return;
    }
    const line = lyrics.shownLine(t, 1e4, 0.35) ?? lyrics.nextLine(t);
    const bl = line ? this.lays.get(line) : null;
    if (!line || !bl) return;
    const k = ease.outCubic(clamp((t - (line.start - 0.35)) / 0.3));
    const idx = lyrics.lines.indexOf(line);
    const prev = idx > 0 ? this.lays.get(lyrics.lines[idx - 1]!) : null;
    const place = (b: BiLayout) => top + Math.max(0, (bot - top - b.height) / 2) + b.main.size * 0.9;
    c.save(); c.beginPath(); c.rect(MAPW + 4, 84, SCR.w - MAPW, SCR.h - 84); c.clip();
    if (prev && k < 1) { c.save(); c.translate(X - k * (TW + 60), place(prev)); c.globalAlpha = 1 - k; paintBi(c, prev, t, ink); c.restore(); }
    c.save(); c.translate(X + (1 - k) * (TW + 60), place(bl)); paintBi(c, bl, t, ink); c.restore();
    c.restore();
  }
}
