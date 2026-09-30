// 同步口譯廂（暗，雙語）：從口譯廂裡往外看——大片玻璃窗外是會議廳（空的座位一排排、講台上的聚光燈、投影幕上的簡報），
// 廂裡的桌上一台字幕螢幕、一支鵝頸麥克風、耳機掛在螢幕角上。
//  - 螢幕是「上面原文、下面中文」的同步口譯字幕：原文（來源）小一號在上、中文（譯文）在下，兩行都照自己的逐字時間亮；
//    換句時整組往上捲（像字幕機），底下一條細細的進度條跟著這句唱到哪裡。沒有翻譯的歌只有中文一行，置中、來源那一排收起來。
//  - 麥克風頭上一圈燈：唱的時候亮（訊號色），不唱就暗；桌上兩條音量表：「來源」跟著人聲跳，「口譯」晚半拍才跟上（同步口譯的延遲）。
//  - 第一拍螢幕開機、麥克風上線；第一個小節線會議廳的燈暗下來、講台的聚光燈亮起（會議開始）；之後每個小節線投影幕換一張簡報、
//    偶爾有人在廳裡拍照閃一下。鏡頭很慢地推近，窗外的會議廳比桌上的東西動得少（視差）。
//  - 主打留言寫在桌角的「與會來賓」桌牌上（留言標準 v2：桌牌約 710×350、字 40～60 px），一盞小燈照著它；沒有留言時桌牌上是邀請。
// 畫法：一個全螢幕 shader 畫窗外的會議廳（全部在焦外，所以都是柔的）、窗框、桌面與桌上的光（螢幕的冷光、麥克風燈、小燈）；
// 螢幕外框、耳機、麥克風、桌牌是 init 畫一次的圖層；螢幕裡的字、音量表每格畫；會發光的燈用 LineBatch 疊加。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, noise1 } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, beatAfter, barAfter, COUPLE_ZH, type LyricStyle } from './_motifs';
import { INVITE_SMALL } from './_t19';
import { barsIn } from './_t1';
import { placeBlock, drawBlock, sigOf, fitV2 } from './_t22';
import { lyricV2, V2 } from './_v2';
import { layoutPair, drawPair, preloadPair, hasSubIn, type Rect } from './_b4';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'lingo', paper: false, energy: [0.15, 0.8], bars: [4, 12], weight: 1 };

/** 窗台（玻璃窗的下緣、桌面的後緣）的螢幕 y。 */
const SILL = 606;
/** 字幕螢幕：外框、畫面（字的範圍）。 */
const MON = { x: 130, y: 300, w: 800, h: 460 };
const SCR = { x: 148, y: 318, w: 764, h: 424 };
/** 螢幕上字幕的左緣、寬、中線 y。 */
const CAP = { x: 196, w: 672, cy: 540 };
/** 桌牌（主打留言）：外框、寫留言的範圍。 */
const CARD = { x: 1120, y: 420, w: 710, h: 350 };
const CM = { x: 1162, y: 498, w: 626, h: 250 };
/** 麥克風頭（燈圈的位置）與底座。 */
const MIC = { hx: 1018, hy: 604, bx: 1046, by: 902 };
/** 麥克風頭的角度（順著鵝頸末端的方向，往左上指向口譯員）。 */
const MIC_A = 0.52;
/** 音量表：兩條 LED 的左緣、y、格數、每格寬。 */
const VU = { x: 262, y: [888, 922], n: 18, seg: 15 };

const HEAD_L = '原文 SOURCE';
const HEAD_R = '中文 INTERPRETATION';
const HEAD_ZH = '同步字幕 LIVE CAPTION';
const CARD_T = '與會來賓 · GUEST';
const CARD_R = '第一屆 宣文 & 孟庭 婚姻國際研討會';
const VU_T = ['來源', '口譯'];
const REST_T = '本段為純音樂，口譯員稍作休息。';

// ---------------------------------------------------------------- 窗外的會議廳＋窗框＋桌面（整晚共用）
const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float house; uniform float stage; uniform vec3 flash; uniform float mic; uniform vec2 drift;
  uniform float mon; uniform float slideA; uniform float slideB; uniform float slideK; uniform float lamp;
  const float SILL = ${SILL}.0;
  // 投影幕上的簡報（在焦外：標題一條、三條內文、右邊一塊圖），seed 換一張
  float slide(vec2 q, float seed) {
    float v = 0.0;
    float tw = 0.35 + 0.4 * hash11(seed * 3.1);
    v += smoothstep(10.0, 4.0, abs(q.y - 58.0)) * smoothstep(0.0, 8.0, q.x - 40.0) * smoothstep(0.0, 8.0, 40.0 + tw * 360.0 - q.x);
    for (int i = 0; i < 3; i++) {
      float y = 112.0 + float(i) * 34.0;
      float w = 120.0 + 140.0 * hash11(seed * 7.7 + float(i));
      v += 0.55 * smoothstep(7.0, 3.0, abs(q.y - y)) * smoothstep(0.0, 6.0, q.x - 56.0) * smoothstep(0.0, 6.0, 56.0 + w - q.x);
    }
    float img = step(0.4, hash11(seed * 1.9));
    v += 0.7 * img * smoothstep(8.0, 0.0, max(abs(q.x - 330.0) - 60.0, abs(q.y - 140.0) - 50.0));
    return v;
  }
  vec3 hall(vec2 p) {
    vec2 h = p + drift;
    // 遠牆：暗，會議廳的燈（house）開著時亮一點
    vec3 col = C_INK2 * (0.42 + 0.5 * house) * (0.8 + 0.2 * smoothstep(440.0, 0.0, h.y));
    // 天花板的崁燈（焦外、柔柔的光團；遠的一排小而密、近的一排大而疏，亮度每盞不太一樣）
    for (int r = 0; r < 2; r++) {
      float y = 64.0 + float(r) * 70.0, rad = 11.0 + float(r) * 9.0, sp = 230.0 + float(r) * 120.0;
      float id = floor((h.x + float(r) * 97.0) / sp);
      float cx = id * sp + sp * 0.5 - float(r) * 97.0;
      float d = length((h - vec2(cx, y)) / vec2(1.0, 0.8));
      float lum = 0.6 + 0.4 * hash11(id * 3.7 + float(r) * 11.0);
      col += mix(C_BONE, C_EMBER, 0.35) * 0.22 * house * lum * exp(-pow(d / rad, 2.0));
      col += mix(C_BONE, C_EMBER, 0.35) * 0.025 * house * exp(-pow(d / (rad * 5.0), 2.0));
    }
    // 投影幕（簡報在焦外）＋講台（聚光燈）
    vec2 sq = h - vec2(1110.0, 118.0);
    float inScr = smoothstep(0.0, 6.0, sq.x) * smoothstep(0.0, 6.0, 440.0 - sq.x) * smoothstep(0.0, 6.0, sq.y) * smoothstep(0.0, 6.0, 250.0 - sq.y);
    float sl = mix(slide(sq, slideA), slide(sq, slideB), slideK);
    col += inScr * mix(C_BONE, C_SIGNAL, 0.12) * (0.07 + 0.06 * sl) * (0.6 + 0.4 * stage);
    float floorY = smoothstep(416.0, 428.0, h.y) * (1.0 - smoothstep(456.0, 470.0, h.y));
    float pool = exp(-pow((h.x - 1330.0) / 300.0, 2.0) - pow((h.y - 442.0) / 30.0, 2.0));
    col += mix(C_EMBER, C_BONE, 0.3) * 0.34 * stage * pool * (0.4 + 0.6 * floorY);
    // 聚光燈的光錐（很淡）
    float cone = exp(-pow((h.x - 1330.0 - (h.y - 442.0) * 0.18) / (60.0 + (442.0 - h.y) * 0.5), 2.0)) * smoothstep(0.0, 442.0, h.y) * (1.0 - smoothstep(442.0, 462.0, h.y));
    col += C_BONE * 0.035 * stage * cone;
    // 講台（剪影、講台燈一點）
    vec2 lq = h - vec2(1170.0, 382.0);
    float lect = step(abs(lq.x) - 26.0 + lq.y * 0.12, 0.0) * step(0.0, lq.y) * step(lq.y, 62.0);
    col = mix(col, C_INK * 0.6, lect * 0.9);
    col += C_EMBER * 0.5 * stage * smoothstep(5.0, 1.0, length(lq - vec2(-8.0, -4.0)));
    // 觀眾席：從口譯廂（在後面、高一點）看過去，一排一排椅背的剪影（越近越大），排跟排之間是更暗的走道；
    // 椅背頂是圓的，頂上一點講台與燈的反光。從遠排畫到近排，近的蓋住遠的。
    col = mix(col, C_INK * 0.4, smoothstep(470.0, 490.0, h.y));
    for (int r = 0; r < 8; r++) {
      float fr = float(r);
      float y0 = 478.0 + fr * 11.0 + fr * fr * 1.5;
      float sw = 26.0 + fr * 5.5;
      float bow = pow((h.x - 1150.0) / 1500.0, 2.0) * 34.0;
      float sx = fract((h.x + fr * 13.0 + (mod(fr, 2.0)) * sw * 0.5) / sw);
      float aisle = smoothstep(0.05, 0.075, abs(fract((h.x - 1150.0) / 820.0) - 0.5));
      float top = y0 - bow + (2.0 + fr * 0.8) * (1.0 - sqrt(max(0.0, sin(3.14159 * sx))));
      float yy = h.y - top;
      // 焦外：邊都是柔的；椅背之間的縫比較暗；頂上一點點講台與燈的反光（不要一條條亮線）
      float inSeat = smoothstep(-1.5, 2.5, yy) * aisle;
      float gap = 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.14, min(sx, 1.0 - sx)));
      vec3 back = (C_INK * 0.42 + C_INK2 * 0.3) * gap;
      float rim = exp(-pow(yy / 3.0, 2.0)) * (0.018 + 0.05 * stage * exp(-pow((h.x - 1330.0) / 620.0, 2.0)) + 0.025 * house) * gap;
      col = mix(col, back + mix(C_BONE, C_EMBER, 0.4) * rim, inSeat);
    }
    // 有人在廳裡拍照：一個很小、很快的閃光（焦外的一團光）
    col += C_BONE * flash.z * 0.9 * exp(-pow(length(h - flash.xy) / 26.0, 2.0)) + C_BONE * flash.z * 0.04 * exp(-pow(length(h - flash.xy) / 300.0, 2.0));
    return col;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col;
    if (p.y < SILL - 16.0) {
      col = hall(p);
      // 玻璃：一道斜斜的反光、上框
      float band = exp(-pow((p.x * 0.55 + p.y - 980.0) / 140.0, 2.0));
      col += C_BONE * 0.018 * band;
      col = mix(col, C_INK * 0.7, smoothstep(26.0, 20.0, p.y));
      // 直的窗框（在桌牌左邊後面）
      col = mix(col, C_INK * 0.8 + C_INK2 * 0.2, smoothstep(8.0, 6.0, abs(p.x - 1086.0)));
    } else if (p.y < SILL + 8.0) {
      // 窗台：被螢幕照亮的一條
      col = C_INK2 * 0.9 + C_BONE * 0.05 * mon * exp(-pow((p.x - 530.0) / 520.0, 2.0));
    } else {
      // 桌面：深色的木頭（透視的木紋往後收），螢幕的冷光、麥克風燈、照桌牌的小燈
      float z = (p.y - SILL) / (${H}.0 - SILL);
      float g = fbm(vec2((p.x - 960.0) / (180.0 + 520.0 * z), z * 40.0), 3);
      col = mix(C_INK2, C_SEPIA, 0.12) * (0.55 + 0.25 * z) * (0.9 + 0.2 * g);
      float ms = exp(-pow((p.x - 530.0) / (430.0 + 200.0 * z), 2.0) - pow((p.y - 660.0) / 170.0, 2.0));
      col += mix(C_BONE, C_SIGNAL, 0.1) * 0.12 * mon * ms;
      col += C_EMBER * 0.16 * mic * exp(-pow(length((p - vec2(${MIC.bx}.0, ${MIC.by}.0)) / vec2(150.0, 50.0)), 2.0));
      float lp = exp(-pow((p.x - 1475.0) / 470.0, 2.0) - pow((p.y - 800.0) / 90.0, 2.0));
      col += mix(C_BONE, C_EMBER, 0.3) * 0.13 * lamp * lp;
      // 桌牌、螢幕底座在桌上的影子
      col *= 1.0 - 0.45 * exp(-pow((p.x - 1475.0) / 380.0, 2.0) - pow((p.y - 776.0) / 14.0, 2.0));
      col *= 1.0 - 0.4 * exp(-pow((p.x - 530.0) / 170.0, 2.0) - pow((p.y - 808.0) / 12.0, 2.0));
    }
    // 麥克風燈照在螢幕右邊的空氣裡（很淡的一團）
    col += C_EMBER * 0.05 * mic * exp(-pow(length(p - vec2(${MIC.hx}.0, ${MIC.hy}.0)) / 90.0, 2.0));
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, house: { value: 1 }, stage: { value: 0 }, flash: { value: new THREE.Vector3() }, mic: { value: 0 }, drift: { value: new THREE.Vector2() },
  mon: { value: 0 }, slideA: { value: 1 }, slideB: { value: 2 }, slideK: { value: 0 }, lamp: { value: 0 },
});

export default class Interpreter extends Scene {
  bg = shared('interpreter.bg', BG);
  /** 螢幕外框、耳機、麥克風、音量表的底、桌牌（init 畫一次）。 */
  props = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 螢幕裡的字幕（每格畫）。 */
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(96, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) >>> 0;
  tOn = 0; tHouse = 0; tLamp = 0;
  bars: number[] = [];
  bilingual = false;
  st: LyricStyle = { family: F.archivo(100, 700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: CAP.w, align: 'left', active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3), lineHeight: 1.16 };
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    const m = this.msg;
    await preloadPair(this.ctx, `${m ? m.text + sigOf(m) : ''}${INVITE_SMALL}${HEAD_L}${HEAD_R}${HEAD_ZH}${CARD_T}${CARD_R}${VU_T.join('')}${REST_T}${COUPLE_ZH}FROM THE COUPLE · 新人LIVE●→……（間奏）`);
    this.bilingual = hasSubIn(this.ctx);
    const B = au.beatPeriod(s + 0.1);
    this.tOn = beatAfter(au, s + Math.min(0.3, B * 0.6));
    const bar0 = barAfter(au, this.tOn + 0.05);
    this.tHouse = bar0 - this.tOn < B * 4.5 && e - bar0 > 1.5 ? bar0 : this.tOn + B;
    this.tLamp = beatAfter(au, this.tOn, 1);
    this.bars = barsIn(au, this.tHouse + 0.1, e);
    this.drawProps();
    this.avoid = [[CARD.x, CARD.y, CARD.w, CARD.h], [SCR.x, SCR.y, SCR.w, SCR.h]];
  }

  /** 螢幕外框、耳機、麥克風、音量表的底、桌牌（畫一次）。 */
  private drawProps() {
    const L = this.props, c = L.ctx, m = this.msg;
    L.clear();
    c.textBaseline = 'alphabetic';
    // ---- 字幕螢幕：外框、腳架
    c.fillStyle = mixRgba('ink', 'graphite', 0.28);
    c.beginPath(); c.roundRect(MON.x, MON.y, MON.w, MON.h, 14); c.fill();
    c.fillStyle = rgba('bone', 0.08); c.fillRect(MON.x + 14, MON.y + 1, MON.w - 28, 1.5);
    c.fillStyle = mixRgba('ink', 'graphite', 0.35);
    c.fillRect(505, MON.y + MON.h, 50, 44);
    c.beginPath(); c.ellipse(530, 806, 150, 15, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('bone', 0.07); c.beginPath(); c.ellipse(530, 801, 140, 5, 0, Math.PI, Math.PI * 2); c.fill();
    // ---- 耳機：頭帶掛在螢幕右上角，一邊耳罩垂在螢幕外側，線垂到桌上
    c.lineCap = 'round';
    c.strokeStyle = mixRgba('ink', 'graphite', 0.5); c.lineWidth = 15;
    c.beginPath(); c.moveTo(868, MON.y + 4); c.bezierCurveTo(900, 250, 960, 262, 962, 340); c.stroke();
    c.strokeStyle = rgba('bone', 0.1); c.lineWidth = 2;
    c.beginPath(); c.moveTo(872, MON.y - 3); c.bezierCurveTo(902, 244, 956, 256, 959, 330); c.stroke();
    c.fillStyle = mixRgba('ink', 'graphite', 0.42);
    c.beginPath(); c.ellipse(962, 398, 30, 54, 0.05, 0, Math.PI * 2); c.fill();
    c.fillStyle = mixRgba('ink', 'graphite', 0.2);
    c.beginPath(); c.ellipse(952, 398, 16, 42, 0.05, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('bone', 0.12); c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(962, 398, 30, 54, 0.05, -1.9, -0.2); c.stroke();
    c.strokeStyle = mixRgba('ink', 'graphite', 0.4); c.lineWidth = 3;
    c.beginPath(); c.moveTo(966, 452); c.bezierCurveTo(1000, 560, 930, 700, 975, 860); c.bezierCurveTo(990, 910, 940, 930, 900, 928); c.stroke();
    // ---- 鵝頸麥克風：底座、一節一節的鵝頸、麥克風頭
    c.fillStyle = mixRgba('ink', 'graphite', 0.4);
    c.beginPath(); c.ellipse(MIC.bx, MIC.by + 4, 64, 15, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('bone', 0.08); c.beginPath(); c.ellipse(MIC.bx, MIC.by, 58, 5, 0, Math.PI, Math.PI * 2); c.fill();
    const neck = (u: number) => {
      // 三次貝茲：底座 → 往上 → 彎向口譯員（畫面左邊）
      const p0 = [MIC.bx, MIC.by - 6], p1 = [MIC.bx + 30, 760], p2 = [MIC.bx + 34, 640], p3 = [MIC.hx + 10, MIC.hy + 6];
      const k = 1 - u;
      return [k * k * k * p0[0]! + 3 * k * k * u * p1[0]! + 3 * k * u * u * p2[0]! + u * u * u * p3[0]!, k * k * k * p0[1]! + 3 * k * k * u * p1[1]! + 3 * k * u * u * p2[1]! + u * u * u * p3[1]!] as [number, number];
    };
    c.strokeStyle = mixRgba('ink', 'graphite', 0.45); c.lineWidth = 11;
    c.beginPath();
    for (let i = 0; i <= 40; i++) { const [x, y] = neck(i / 40); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke();
    c.strokeStyle = rgba('ink', 0.6); c.lineWidth = 1.2;
    for (let i = 1; i < 40; i++) {
      const [x0, y0] = neck((i - 0.5) / 40), [x1, y1] = neck((i + 0.5) / 40);
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
      const [x, y] = neck(i / 40);
      c.beginPath(); c.moveTo(x - (dy / l) * 5.5, y + (dx / l) * 5.5); c.lineTo(x + (dy / l) * 5.5, y - (dx / l) * 5.5); c.stroke();
    }
    // 麥克風頭：金屬管身（接鵝頸那頭有一圈燈，render 時畫）＋前面一顆海綿防風罩，順著鵝頸的方向指向口譯員
    c.save();
    c.translate(MIC.hx, MIC.hy); c.rotate(MIC_A);
    c.fillStyle = mixRgba('ink', 'graphite', 0.55);
    c.beginPath(); c.roundRect(-58, -9, 60, 18, 5); c.fill();
    c.fillStyle = rgba('bone', 0.14); c.fillRect(-54, -7, 52, 1.6);
    c.fillStyle = mixRgba('ink', 'graphite', 0.3);
    c.beginPath(); c.ellipse(-78, 0, 30, 16, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('bone', 0.06);
    for (let i = 0; i < 26; i++) { const a = hash(i, 3) * Math.PI * 2, r = Math.sqrt(hash(i, 4)); c.fillRect(-78 + Math.cos(a) * r * 26, Math.sin(a) * r * 13, 2, 2); }
    c.strokeStyle = rgba('bone', 0.1); c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(-78, 0, 30, 16, 0, -2.6, -0.6); c.stroke();
    c.restore();
    // ---- 音量表的底：一個小控制盒，兩排 LED 的暗格、標籤
    c.fillStyle = mixRgba('ink', 'graphite', 0.3);
    c.beginPath(); c.roundRect(170, 860, 420, 90, 8); c.fill();
    c.fillStyle = rgba('bone', 0.06); c.fillRect(178, 861, 404, 1.5);
    c.font = font(F.hei(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.7);
    VU.y.forEach((y, i) => {
      c.fillText(VU_T[i]!, 194, y + 6);
      for (let k = 0; k < VU.n; k++) { c.fillStyle = rgba('graphite', 0.35); c.fillRect(VU.x + k * VU.seg, y - 5, VU.seg - 4, 10); }
      c.fillStyle = rgba('ash', 0.7);
    });
    c.letterSpacing = '0px';
    // ---- 桌牌（與會來賓）：紙卡、上面一條色帶，留言寫在上面
    const x0 = CARD.x, y0 = CARD.y;
    const g = c.createLinearGradient(0, y0, 0, y0 + CARD.h);
    g.addColorStop(0, mixRgba('paper', 'bone', 0.35)); g.addColorStop(1, mixRgba('paper', 'sepia', 0.18));
    c.fillStyle = g;
    c.fillRect(x0, y0, CARD.w, CARD.h);
    c.fillStyle = rgba('bone', 0.35); c.fillRect(x0, y0, CARD.w, 2);
    c.fillStyle = mixRgba('signal', 'ink', 0.45); c.fillRect(x0 + 18, y0 + 18, CARD.w - 36, 44);
    c.font = font(F.hei(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.9);
    c.fillText(m?.couple ? 'FROM THE COUPLE · 新人' : CARD_T, x0 + 36, y0 + 46);
    c.textAlign = 'right'; c.letterSpacing = '2px'; c.fillStyle = rgba('bone', 0.62);
    c.fillText(CARD_R, x0 + CARD.w - 36, y0 + 46);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    if (m) {
      const fam = F.hand(700), sig = sigOf(m);
      const blk = fitV2(c, m.text, fam, CM.w, CM.h, 1, { lineHeight: 1.28 });
      const top = CM.y + Math.max(0, (CM.h - blk.height) * 0.45);
      const pl = placeBlock(c, blk, fam, sig, CM.x, top);
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.95), sigColor: rgba('sepia', 0.72) });
      this.st = { ...this.st, size: lyricV2(blk.fit.size) };
    } else {
      // 沒有留言：桌牌上是一條空白的名字線與邀請（焦點是螢幕上的字幕）
      c.fillStyle = rgba('sepia', 0.22); c.fillRect(CM.x, 660, CM.w, 1.4);
      c.fillStyle = rgba('sepia', 0.7);
      const fit = fitText(c, INVITE_SMALL, F.hand(700), CM.w, 50, { min: 26, max: 34 });
      c.font = font(F.hand(700), fit.size);
      c.fillText(INVITE_SMALL, CM.x, 640);
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song, audio } = this.ctx;
    const t = f.t, s = this.ctx.start;

    // ---- 螢幕：開機（第一拍，亮一下再穩定）
    const on = clamp((t - this.tOn) / 0.25);
    const mon = on * (1 + 0.6 * Math.exp(-(t - this.tOn) * 12) * (t > this.tOn ? 1 : 0));
    // ---- 字幕：正在唱的這句；換句時上一組往上捲走、新的從下面捲上來
    const D = this.dyn, c = D.ctx;
    D.clear();
    c.save();
    c.beginPath(); c.roundRect(SCR.x, SCR.y, SCR.w, SCR.h, 4); c.clip();
    c.fillStyle = mixRgba('ink', 'ink2', 0.6 + 0.4 * on); c.fillRect(SCR.x, SCR.y, SCR.w, SCR.h);
    // 螢幕面的一點冷光與反光
    const sg = c.createLinearGradient(SCR.x, SCR.y, SCR.x + SCR.w, SCR.y + SCR.h);
    sg.addColorStop(0, rgba('bone', 0.045 * on)); sg.addColorStop(0.5, rgba('bone', 0)); sg.addColorStop(1, rgba('bone', 0.02 * on));
    c.fillStyle = sg; c.fillRect(SCR.x, SCR.y, SCR.w, SCR.h);
    let singing = false;
    if (on > 0) {
      c.globalAlpha = on;
      c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.75);
      c.fillText(this.bilingual ? `${HEAD_L}  →  ${HEAD_R}` : HEAD_ZH, CAP.x, SCR.y + 40);
      c.textAlign = 'right'; c.fillStyle = rgba('signal', 0.85);
      c.fillText(`● LIVE  ${fmtTC(t)}`, SCR.x + SCR.w - 40, SCR.y + 40);
      c.textAlign = 'left'; c.letterSpacing = '0px';
      c.fillStyle = rgba('bone', 0.08); c.fillRect(CAP.x, SCR.y + 58, CAP.w, 1);
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const line = ly.line;
        const kin = ease.outCubic(prog(t, line.start - 0.35, line.start + 0.1));
        const pl = layoutPair(c, line, this.st, true);
        const prev = line.i > 0 ? lyrics.lines[line.i - 1] : undefined;
        if (prev && kin < 1 && prev.end > t - 2.5) {
          const pp = layoutPair(c, prev, this.st, true);
          c.save(); c.translate(CAP.x, CAP.cy - pp.height / 2 - kin * (pp.height + 60)); drawPair(c, pp, prev, t, this.st, (1 - kin) * on); c.restore();
        }
        c.save(); c.translate(CAP.x, CAP.cy - pl.height / 2 + (1 - kin) * 90); drawPair(c, pl, line, t, this.st, ly.k * on); c.restore();
        singing = t >= line.start && t < line.end;
        // 這一句唱到哪裡：底下一條細進度條
        const lp = clamp((t - line.start) / Math.max(0.1, line.end - line.start));
        c.fillStyle = rgba('bone', 0.1); c.fillRect(CAP.x, SCR.y + SCR.h - 44, CAP.w, 2);
        c.fillStyle = rgba('signal', 0.8 * ly.k); c.fillRect(CAP.x, SCR.y + SCR.h - 44, CAP.w * lp, 2);
      } else {
        if (lyrics.has) {
          c.font = font(F.mono(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.6);
          c.fillText('……（間奏）', CAP.x, CAP.cy + 6);
        } else {
          // 純音樂：沒有要口譯的——字幕機一本正經地告訴大家口譯員在休息
          c.font = font(F.hei(500), 34); c.fillStyle = rgba('bone', 0.8);
          c.fillText(REST_T, CAP.x, CAP.cy - 4);
          c.font = font(F.mono(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.6);
          c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, CAP.x, CAP.cy + 44);
        }
        c.letterSpacing = '0px';
      }
      c.globalAlpha = 1;
    }
    c.restore();
    // 小燈照亮桌牌之前，桌牌暗暗的
    const lamp = 0.35 + 0.65 * ease.outCubic(clamp((t - this.tLamp) / 0.35));
    if (lamp < 1) { c.fillStyle = rgba('ink', (1 - lamp) * 0.75); c.fillRect(CARD.x, CARD.y, CARD.w, CARD.h); }
    D.upload();

    // ---- 會議廳：燈暗下來、講台聚光燈亮起；簡報每個小節線換一張；偶爾有人拍照
    const hk = ease.inOutCubic(clamp((t - this.tHouse) / 1.4));
    const B = this.bg;
    B.u.t!.value = t;
    B.u.house!.value = lerp(1, 0.22, hk);
    B.u.stage!.value = lerp(0.25, 1, hk) * (1 + 0.04 * noise1(t * 0.7, 3));
    let sA = 1, sB = 1, sK = 0;
    let fl = 0, fx = 0, fy = 0;
    this.bars.forEach((b, i) => {
      if (t >= b) { sA = sB; sB = i + 2; sK = ease.inOutQuad(clamp((t - b) / 0.35)); }
      const a = t - b;
      if (a >= 0 && a < 0.25 && hash(this.seed, i, 7) < 0.55) {
        fl = Math.exp(-a * 22);
        fx = 300 + 1200 * hash(this.seed, i, 8); fy = 430 + 120 * hash(this.seed, i, 9);
      }
    });
    B.u.slideA!.value = sA; B.u.slideB!.value = sB; B.u.slideK!.value = sK;
    (B.u.flash!.value as THREE.Vector3).set(fx, fy, fl);
    const micOn = on * (singing ? 1 : 0) * (0.85 + 0.15 * f.a.vocal);
    B.u.mic!.value = micOn;
    B.u.mon!.value = mon;
    B.u.lamp!.value = lamp;
    (B.u.drift!.value as THREE.Vector2).set(-10 + 24 * ease.inOutQuad(f.p), 3 * noise1(t * 0.2, 5));
    B.render(renderer, out);
    comp.draw(renderer, this.props.texture, out);
    comp.draw(renderer, D.texture, out);

    // ---- 會發光的：麥克風的燈圈、音量表的 LED、螢幕的電源燈
    const G = this.glow;
    G.clear();
    const em = LIN.ember, sgc = LIN.signal, bo = LIN.bone;
    if (micOn > 0.01) {
      // 燈圈：管身接鵝頸那一圈（側面看是一道短短的亮環）
      const ca = Math.cos(MIC_A), sa = Math.sin(MIC_A);
      const cx = MIC.hx + 2 * ca, cy = MIC.hy + 2 * sa;
      G.seg2(cx - sa * 10, cy + ca * 10, cx + sa * 10, cy - ca * 10, 4, [em[0] * 3 * micOn, em[1] * 3 * micOn, em[2] * 3 * micOn], 1);
      G.seg2(cx - sa * 12, cy + ca * 12, cx + sa * 12, cy - ca * 12, 11, [sgc[0] * 0.45 * micOn, sgc[1] * 0.45 * micOn, sgc[2] * 0.45 * micOn], 0.5);
    }
    // 來源跟著人聲；口譯晚 0.35 秒才跟上（同步口譯的延遲）
    // 純音樂：沒有要口譯的，「口譯」那條只剩一點底噪
    const lv = [clamp(audio.env('vocal', t) * 1.25 + 0.12 * f.a.kick), clamp(audio.env('vocal', t - 0.35) * 1.2) * (lyrics.has ? 1 : 0.12)];
    lv.forEach((v, i) => {
      const n = Math.round(v * on * VU.n);
      for (let k = 0; k < n; k++) {
        const hot = k >= VU.n - 3;
        const col = hot ? em : sgc;
        const x = VU.x + k * VU.seg, y = VU.y[i]!;
        G.seg2(x + 1, y, x + VU.seg - 5, y, 9, [col[0] * 1.6, col[1] * 1.6, col[2] * 1.6], 0.95);
      }
    });
    if (on > 0) G.seg2(MON.x + MON.w - 32, MON.y + MON.h - 9, MON.x + MON.w - 26, MON.y + MON.h - 9, 3, [bo[0] * 1.5 * on, bo[1] * 1.5 * on, bo[2] * 1.5 * on], 1);
    G.render(renderer, out);

    const push = ease.inOutQuad(prog(t, s, this.ctx.end));
    return { bloom: 0.55, bloomThreshold: 1.05, halation: 0.12, vignette: 0.4, grain: 0.06, zoom: 1 + 0.03 * push, popupAvoid: this.avoid };
  }
}

/** 字幕機右上角的時間碼（歌曲時間，mm:ss:ff）。 */
function fmtTC(t: number) {
  const s = Math.max(0, t);
  const mm = Math.floor(s / 60), ss = Math.floor(s % 60), ff = Math.floor((s % 1) * 30);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}
