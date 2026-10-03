// 老電視（批次 T10・機器 D，暗）：一台木頭機殼的映像管電視，放在沒開燈的房間裡，整個房間只有螢幕的光。
//  - 窗格一開始電視「開機」：一條白熱的橫線撐開成整個畫面；窗格最後一拍「關機」：畫面壓成一條線、再縮成一個亮點熄掉。
//  - 在小節線上轉台（每兩小節一次）：雪花雜訊一下、畫面垂直滾動再鎖定，右邊的頻道旋鈕「喀」一格轉過去，
//    左上角跳出綠色的頻道數字。冷面笑話是：不管轉到哪一台，都在播同一個節目——「婚禮特別節目　全頻道聯播」。
//    每一台的樣子不一樣（點歌台、測試訊號、電影台、購物台），但留言與字幕的位置都一樣，轉台不會打斷閱讀。
//  - 主打留言是節目的主體：開機後的第一拍起，一個詞組一拍地出現；署名在右下。沒有留言時是點歌專線的邀請。
//  - 歌詞是節目下方的字幕（逐字跟唱）；純音樂時字幕是「♪ 歌名 ♪」。
// 手法：節目畫面畫在一張 960×720 的 Canvas（每格重畫，很小），再由一個全螢幕 shader 同時畫出房間、木頭機殼、
// 金屬框、弧面玻璃（桶狀變形、掃描線、光柵、反光、雪花、垂直滾動、開關機），旋鈕也在 shader 裡轉。
// 機殼上不會變的小字（頻道刻度、廠牌）畫在另一張 Canvas，只上傳一次。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, frameIdx, TAU } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, layoutMessage, drawMessage, signature, beatAfter, lyricSubOf } from './_motifs';
import type { FitResult } from '../engine/text';
import { FAST_GLSL, phraseSchedule, charsAt, fitChars, windowLines, type Rect } from './_t10';
import { bbox } from './_t11';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'machine', paper: false, energy: [0.2, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素，y 向下）
/** 木頭機殼。 */
// 標準 v2：電視往左移一點，右下角 QR 與時間的底下留乾淨的牆
const CAB = { x0: 140, y0: 106, x1: 1426, y1: 972 };
/** 映像管的玻璃面（4:3）。 */
const SCR = { x0: 192, y0: 158, x1: 1204, y1: 918 };
/** 節目畫面的大小（Canvas 像素）：放到玻璃上大約放大 1.05 倍。 */
const PW = 960, PH = 720;
const KX = (SCR.x1 - SCR.x0) / PW, KY = (SCR.y1 - SCR.y0) / PH;
/** 右邊的控制面板：頻道旋鈕、音量旋鈕、喇叭。 */
const DIAL = { x: 1318, y: 300, r: 62 };
const VOL = { x: 1318, y: 500, r: 42 };
const GRILLE = { x0: 1250, x1: 1386, y0: 592, y1: 900 };
/** 桶狀變形的強度：邊緣的字大約縮 5%（字級都已經算進去）。 */
const BARREL = 0.05;

// 節目畫面裡（Canvas 像素）
// 標準 v2：上半是每一台會動的畫面（PIC_H 以上），留言在下半靠左（寬 760 → 螢幕上約 800、字級 40～60），最下面是字幕
const PIC_H = 368, PIC_CY = 196;
const MBOX = { x: 100, y: 410, w: 760, h: 176 }; // 留言（含署名那一列）
const SUB = { y: 684, w: 860 }; // 字幕（歌詞）的基線

type Kind = 'request' | 'bars' | 'movie' | 'shop';
const CHANNELS: { ch: number; kind: Kind; name: string; label: string }[] = [
  { ch: 3, kind: 'request', name: '點歌台', label: '今晚的點播' },
  { ch: 7, kind: 'bars', name: '測試訊號', label: '觀眾來信' },
  { ch: 11, kind: 'movie', name: '電影台', label: '本片經典台詞' },
  { ch: 13, kind: 'shop', name: '購物台', label: '顧客好評　★★★★★' },
];
/** 頻道旋鈕上的刻度（老電視的 VHF 2～13 台）。 */
const DIAL_CH = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const dialAngle = (ch: number) => -Math.PI / 2 + (DIAL_CH.indexOf(ch) / DIAL_CH.length) * TAU;

const INVITE = '歡迎點播：掃描右下角 QR code，你的祝福下一首就上電視。';
const TEXT = `全頻道聯播婚禮特別節目今晚的點播觀眾來信本片經典台詞顧客好評請勿調整您的電視機訊號正常是新人太閃限時特賣愛情一組無價限量全世界只有新人的話點播專線今晚首播頻道音量已購買${INVITE}${CHANNELS.map((c) => c.name).join('')}`;

// ---------------------------------------------------------------- 房間＋機殼＋映像管（一個全螢幕 shader）
const TV = () => new FSPass(/* glsl */ `
  uniform sampler2D prog;
  uniform float t, fi, on, off, roll, snow, pump, jit, dial, vol, grainK, flick;
  uniform vec3 spill;
  ${FAST_GLSL}
  float sdRB(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

  // 一顆旋鈕：金屬圓盤、滾花邊、指示刻痕（角度 a，0 = 右、順時針）
  vec3 knob(vec3 col, vec2 p, vec2 c, float r, float a, bool big) {
    vec2 d = p - c; float L = length(d);
    // 影子
    col *= 1.0 - 0.55 * (1.0 - smoothstep(r - 2.0, r + 14.0, length(d - vec2(5.0, 8.0))));
    if (L > r + 1.0) return col;
    float ang = atan(d.y, d.x);
    float edge = smoothstep(r * 0.78, r * 0.8, L);
    float knurl = 0.5 + 0.5 * cos(ang * (big ? 56.0 : 40.0));
    // 斜斜打過來的光：左上亮
    float lit = 0.55 + 0.45 * dot(normalize(d + 1e-4), normalize(vec2(-0.6, -0.8))) * smoothstep(0.0, r, L);
    vec3 metal = mix(C_GRAPHITE * 0.55, C_ASH * 0.9, 0.35 + 0.4 * lit);
    vec3 face = mix(C_GRAPHITE * 0.38, C_GRAPHITE * 0.75, 0.5 + 0.5 * lit) + C_BONE * 0.05 * pow(max(0.0, 1.0 - length(d / r - vec2(-0.3, -0.35)) * 1.6), 2.0);
    vec3 k = mix(face, metal * (0.7 + 0.3 * knurl), edge);
    // 指示刻痕：從中心往外的一條訊號色
    vec2 dir = vec2(cos(a), sin(a));
    float along = dot(d, dir), across = abs(dot(d, vec2(-dir.y, dir.x)));
    float notch = (1.0 - smoothstep(2.0, 3.6, across)) * step(r * 0.25, along) * step(along, r * 0.74);
    k = mix(k, C_SIGNAL * 1.25, notch);
    return mix(col, k, sat(r + 0.5 - L));
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 cc = vec2(${(SCR.x0 + SCR.x1) / 2}.0, ${(SCR.y0 + SCR.y1) / 2}.0), hs = vec2(${(SCR.x1 - SCR.x0) / 2}.0, ${(SCR.y1 - SCR.y0) / 2}.0);
    vec2 kc = vec2(${(CAB.x0 + CAB.x1) / 2}.0, ${(CAB.y0 + CAB.y1) / 2}.0), kh = vec2(${(CAB.x1 - CAB.x0) / 2}.0, ${(CAB.y1 - CAB.y0) / 2}.0);
    float power = on * (1.0 - off);

    // ---- 房間：暗牆，電視的光打在牆上；下面是放電視的桌面
    vec3 col = C_INK * (0.9 + 0.2 * fbm(p / 420.0, 3));
    float dCab = sdRB(p - kc, kh, 38.0);
    col += spill * power * 0.045 * exp(-max(dCab, 0.0) / 170.0);
    if (p.y > ${CAB.y1 - 6}.0) {
      float yy = p.y - ${CAB.y1 - 6}.0;
      col = mix(C_INK2 * 0.9, C_INK, sat(yy / 120.0));
      // 桌面上螢幕的倒影（很淡、往下拉長）
      col += spill * power * 0.1 * exp(-yy / 40.0) * smoothstep(${SCR.x0 - 60}.0, ${SCR.x0 + 80}.0, p.x) * smoothstep(${SCR.x1 + 60}.0, ${SCR.x1 - 80}.0, p.x);
      col *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 10.0, yy)) * (1.0 - smoothstep(0.0, 3.0, abs(dCab)));
    }
    // 機殼的影子
    col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 40.0, sdRB(p - kc - vec2(10.0, 16.0), kh, 38.0)));

    // ---- 木頭機殼
    if (dCab < 0.0) {
      vec2 g = vec2(p.x * 0.0022, p.y * 0.05 + 3.0 * fbm(vec2(p.x * 0.0016, p.y * 0.004), 3));
      float grain = 0.5 + 0.5 * sin(g.y * 6.0 + fbm(g * vec2(1.0, 0.2), 3) * 5.0);
      // 木頭用紙上的墨色（每個主題不一樣），但去掉三成多的彩度：薰衣草、鼠尾草主題也不會變成紫色、綠色的木頭
      vec3 sep = mix(vec3(luma(C_SEPIA)), C_SEPIA, 0.65) * 1.15;
      vec3 wood = mix(sep * 0.6, sep * 1.5, grain * 0.7 + 0.3 * fbm(p / 60.0, 2));
      // 螢幕的光照在機殼正面（越靠近玻璃越亮）
      float dScr = sdRB(p - cc, hs + 24.0, 70.0);
      wood += spill * power * 0.12 * exp(-max(dScr, 0.0) / 70.0);
      // 倒角：上緣、左緣亮，下緣暗
      float bev = 1.0 - smoothstep(0.0, 9.0, -dCab);
      wood += C_BONE * 0.05 * bev * step(p.y, kc.y) ;
      wood *= 1.0 - 0.45 * bev * step(kc.y, p.y);
      col = wood;

      // 控制面板（深色金屬板）
      float dPan = sdRB(p - vec2(${DIAL.x}.0, 596.0), vec2(84.0, 404.0), 18.0);
      if (dPan < 0.0) {
        vec3 pan = C_INK2 * 1.2 + C_GRAPHITE * 0.12 * (0.5 + 0.5 * snoise(vec2(p.x * 0.5, p.y * 0.01)));
        pan *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 6.0, -dPan));
        // 喇叭的橫條
        if (p.x > ${GRILLE.x0}.0 && p.x < ${GRILLE.x1}.0 && p.y > ${GRILLE.y0}.0 && p.y < ${GRILLE.y1}.0) {
          float sl = abs(mod(p.y - ${GRILLE.y0}.0, 14.0) - 7.0);
          pan = mix(pan, C_INK * 0.4, (1.0 - smoothstep(2.4, 3.4, sl)));
          pan += C_ASH * 0.05 * (1.0 - smoothstep(0.0, 1.2, abs(sl - 4.0)));
        }
        col = pan;
      }
      col = knob(col, p, vec2(${DIAL.x}.0, ${DIAL.y}.0), ${DIAL.r}.0, dial, true);
      col = knob(col, p, vec2(${VOL.x}.0, ${VOL.y}.0), ${VOL.r}.0, vol, false);
    }

    // ---- 金屬框
    float dBz = sdRB(p - cc, hs + 22.0, 74.0);
    if (dBz < 0.0) {
      float lit = 0.5 + 0.5 * dot(normalize(p - cc), normalize(vec2(-0.5, -0.85)));
      vec3 bz = mix(C_GRAPHITE * 0.45, C_ASH * 0.55, lit);
      bz *= 1.0 - 0.5 * smoothstep(-6.0, 0.0, dBz);
      col = bz;
    }

    // ---- 映像管
    float dG = sdRB(p - cc, hs, 60.0);
    if (dG < 0.0) {
      vec2 q = (p - cc) / hs;                               // -1..1，y 向下
      vec2 qd = q * (1.0 + ${BARREL} * q.yx * q.yx);         // 桶狀變形（中間鼓起來）
      // 開關機：畫面往中間壓扁
      float sy = on * (1.0 - smoothstep(0.0, 0.5, off)) , sx = 1.0 - smoothstep(0.5, 0.85, off);
      sy = max(sy, 0.004); sx = max(sx, 0.004);
      vec3 pic = vec3(0.0);
      if (abs(qd.y) <= sy && abs(qd.x) <= sx) {
        vec2 uv = (qd / vec2(sx, sy)) * 0.5 + 0.5;
        float v = uv.y + roll;
        float vr = fract(v);
        uv.x += jit * sin(uv.y * 43.0 + t * 31.0) / ${PW}.0;
        pic = fastTex(prog, vec2(uv.x, vr)).rgb;
        // 垂直滾動時的遮沒帶
        pic *= mix(1.0, smoothstep(0.0, 0.05, vr) * smoothstep(1.0, 0.97, vr), step(0.001, abs(roll)));
        // 掃描線（300 條）、光柵（RGB 直條）
        float sl = 0.8 + 0.2 * cos(uv.y * 300.0 * TAU);
        float m = mod(FRAG_PX.x, 3.0);
        vec3 mask = m < 1.0 ? vec3(1.08, 0.95, 0.95) : m < 2.0 ? vec3(0.95, 1.08, 0.95) : vec3(0.95, 0.95, 1.08);
        pic *= sl * mask * 1.1 * (1.0 + 0.08 * pump) * flick;
        // 電影台的底片顆粒
        float gn = hash12(floor(p / 2.0) + fi * 13.1) - 0.5;
        pic *= 1.0 + gn * 0.22 * grainK;
        pic += gn * 0.004 * grainK;
        // 雪花
        float n = hash12(floor(p / vec2(2.0, 3.0)) + vec2(fi * 17.3, fi * 5.1));
        pic = mix(pic, C_BONE * (0.15 + 0.85 * n * n) * 0.85, snow);
        // 開關機時那條線是白熱的
        pic *= 1.0 + 5.0 * (1.0 - sy) * step(0.001, on) + 7.0 * smoothstep(0.5, 0.9, off);
        pic *= 1.0 - smoothstep(0.88, 1.0, off);
      }
      // 暗掉的玻璃（映像管本身的灰綠色）＋暗角
      vec3 glass = mix(C_INK2, C_GRAPHITE * 0.35, 0.3) * 0.9;
      col = glass + pic * on;
      col *= 1.0 - 0.38 * pow(sat(length(q) / 1.42), 2.6);
      // 玻璃的反光：左上一塊柔柔的窗光、上緣一道弧光
      float refl = (1.0 - smoothstep(0.0, 0.75, length((q - vec2(-0.62, -0.58)) * vec2(1.0, 1.7))));
      col += C_BONE * 0.03 * refl;
      col += C_BONE * 0.018 * smoothstep(-0.97, -0.9, q.y) * (1.0 - smoothstep(-0.86, -0.78, q.y)) * (1.0 - abs(q.x));
      // 玻璃邊緣的內陰影
      col *= 0.35 + 0.65 * smoothstep(0.0, 26.0, -dG);
    }
    fragColor = vec4(col, 1.0);
  }`, {
  prog: { value: null }, t: { value: 0 }, fi: { value: 0 }, on: { value: 1 }, off: { value: 0 }, roll: { value: 0 }, snow: { value: 0 },
  pump: { value: 0 }, jit: { value: 0 }, dial: { value: 0 }, vol: { value: 0 }, grainK: { value: 0 }, flick: { value: 1 },
  spill: { value: new THREE.Vector3() },
});

interface Switch { t: number; ch: number }

export default class Crt extends Scene {
  tv = shared('crt.tv', TV);
  /** 節目畫面（每格重畫）。 */
  prog = this.track(new Layer2D(PW, PH, undefined, { fast: true }));
  /** 機殼上的小字（畫一次）。 */
  deco = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit!: FitResult;
  body = '';
  sched: { t: number; chars: number }[] = [];
  switches: Switch[] = [];
  tOn = 0; tOff = 0; tFirst = 0; beat = 0.5; bar = 2;
  hasLyrics = false;
  /** 這個窗格的字幕有原文副行（韓文歌、沒有主打留言）：字幕多一列，邀請縮小讓位。 */
  subWin = false;
  /** 署名、字幕的字級（節目畫布上的 px；標準 v2 換算過）。 */
  sigSize = 28; lyrSize = 46;
  avoid: Rect[] = [];
  private decoUp = false;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.body = m ? m.text : INVITE;
    // 這個窗格的字幕有沒有原文（有主打留言的窗格，引擎給的歌詞本來就沒有原文）
    this.subWin = windowLines(lyrics, s, e).some((l) => lyricSubOf(l));
    await loadText(`${TEXT}${this.body}${m ? signature(m.name) : ''}${song.title}${song.artist}`);
    const c = this.prog.ctx;
    // 標準 v2（螢幕 px，除以節目畫面放大的倍數 KX 才是畫在節目畫布上的字級）：字級上限依字數、照子句斷行，
    // 框高先扣掉署名那一列（署名永遠在最後一行下面）
    const fam = F.hand(m ? 400 : 700);
    const sig0 = sigV2(msgMaxFor(this.body)) / KX;
    // 有原文副行時字幕會高一列（中文折兩行時一路長到留言框的下緣）：邀請縮到最小字級讓位（沒有留言時歌詞本來就是焦點）
    const o = { min: Math.ceil(V2.msgMin / KX), max: this.subWin && !m ? Math.ceil(V2.msgMin / KX) : msgMaxFor(this.body) / KX, lineHeight: 1.3, maxLines: 4 };
    const boxH = MBOX.h - (m ? sig0 + 10 : 0);
    this.fit = fitClauses(c, this.body, fam, MBOX.w, boxH, o) ?? layoutMessage(c, this.body, fam, MBOX.w, boxH, o);
    this.sigSize = sigV2(this.fit.size * KX) / KX;
    this.lyrSize = lyricV2(m ? this.fit.size * KX : null) / KX;
    this.beat = au.beatPeriod(s + 0.1);
    this.bar = 4 * this.beat;
    this.tOn = s;
    this.tOff = Math.max(s + 1.2, e - 0.34);
    this.tFirst = beatAfter(au, s + 0.34);
    this.sched = phraseSchedule(au, this.body, this.tFirst, Math.min(2 * this.bar, 0.45 * (e - s)), 4);
    this.hasLyrics = windowLines(lyrics, s, e).length > 0;

    // 轉台：從窗格開始的小節線起，每兩小節一次（轉完至少還要有將近一小節）
    const seed = (this.ctx.params.seed ?? 1) * 131 + (m?.id ?? 0) * 7;
    let ci = Math.floor(hash(seed, 3) * CHANNELS.length);
    const B = Math.round(au.barAt(s));
    this.switches = [{ t: -Infinity, ch: ci }];
    for (let j = 1; j < 16; j++) {
      const ts = au.timeOfBar(B + 2 * j);
      if (ts > e - 0.9 * this.bar) break;
      ci = (ci + 1 + (hash(seed, j) < 0.3 ? 1 : 0)) % CHANNELS.length;
      this.switches.push({ t: ts, ch: ci });
    }
    this.drawDeco();

    // 即時小卡避開：留言（含小標、署名）、字幕
    this.avoid = [
      this.toScreen([MBOX.x - 20, MBOX.y - 40, MBOX.w + 40, MBOX.h + 40], 12),
      this.toScreen([(PW - SUB.w) / 2, SUB.y - this.lyrSize * (this.subWin ? 3.2 : 2.2), SUB.w, this.lyrSize * (this.subWin ? 3.6 : 2.6)], 12),
    ];
    const all = bbox(this.avoid);
    this.avoid.push(all);
  }

  /** 節目畫面的矩形 → 畫面上的矩形（桶狀變形只會讓東西往內縮，外框取不變形的就夠保守）。 */
  private toScreen([x, y, w, h]: Rect, pad = 0): Rect {
    return [Math.round(SCR.x0 + x * KX - pad), Math.round(SCR.y0 + y * KY - pad), Math.round(w * KX + 2 * pad), Math.round(h * KY + 2 * pad)];
  }

  /** 機殼上不會變的小字：頻道刻度、音量刻度、廠牌。 */
  private drawDeco() {
    const L = this.deco, c = L.ctx;
    L.clear();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = font(F.mono(500), 15);
    DIAL_CH.forEach((ch) => {
      const a = dialAngle(ch), r = DIAL.r + 20;
      c.fillStyle = rgba('bone', 0.62);
      c.fillText(String(ch), DIAL.x + Math.cos(a) * r, DIAL.y + Math.sin(a) * r);
    });
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5, r0 = VOL.r + 8, r1 = VOL.r + (i % 5 ? 13 : 18);
      c.strokeStyle = rgba('bone', 0.45); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(VOL.x + Math.cos(a) * r0, VOL.y + Math.sin(a) * r0); c.lineTo(VOL.x + Math.cos(a) * r1, VOL.y + Math.sin(a) * r1); c.stroke();
    }
    c.font = font(F.hei(500), 15); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.55);
    c.fillText('頻道', DIAL.x + 2, DIAL.y - DIAL.r - 52);
    c.fillText('音量', VOL.x + 2, VOL.y - VOL.r - 36);
    c.letterSpacing = '0px';
    // 廠牌（自己編的）：金屬小牌子
    const bx = DIAL.x, by = 572;
    c.fillStyle = rgba('ash', 0.18); c.fillRect(bx - 56, by - 15, 112, 30);
    c.strokeStyle = rgba('ash', 0.5); c.lineWidth = 1; c.strokeRect(bx - 55.5, by - 14.5, 111, 29);
    c.font = font(F.serif(600), 19); c.fillStyle = rgba('bone', 0.78); c.letterSpacing = '3px';
    c.fillText('AO · 313', bx + 1, by + 1);
    c.letterSpacing = '0px';
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  private chanAt(t: number): { i: number; sw: Switch; prev: Switch | null } {
    let k = 0;
    for (let j = 1; j < this.switches.length; j++) if (this.switches[j]!.t <= t) k = j;
    return { i: this.switches[k]!.ch, sw: this.switches[k]!, prev: k > 0 ? this.switches[k - 1]! : null };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const { i, sw, prev } = this.chanAt(t);
    const ch = CHANNELS[i]!;
    // 轉台的那一下：雪花（前一點點就開始）、垂直滾動、旋鈕喀一格
    const nextSw = this.switches.find((x) => x.t > t);
    const since = t - sw.t;
    const snowK = Math.max(nextSw ? prog(t, nextSw.t - 0.07, nextSw.t) : 0, Number.isFinite(sw.t) ? 1 - prog(since, 0.05, 0.16) : 0);
    const roll = Number.isFinite(sw.t) ? 0.42 * (1 - ease.outExpo(prog(since, 0.08, 0.55))) : 0;
    const fromA = prev ? dialAngle(CHANNELS[prev.ch]!.ch) : dialAngle(ch.ch);
    let toA = dialAngle(ch.ch);
    if (toA < fromA) toA += TAU;
    const dial = prev ? fromA + (toA - fromA) * ease.outBack(prog(since, 0, 0.2)) : toA;
    // 開關機
    const on = ease.outCubic(prog(t, this.tOn + 0.04, this.tOn + 0.3));
    const off = prog(t, this.tOff, this.ctx.end - 0.02);

    this.drawProgram(t, ch, Number.isFinite(sw.t) ? sw.t : this.tFirst);
    const u = this.tv.u;
    u.prog!.value = this.prog.upload();
    u.t!.value = t;
    u.fi!.value = frameIdx(t) % 997;
    u.on!.value = on; u.off!.value = off;
    u.roll!.value = roll;
    u.snow!.value = clamp(snowK) * 0.92;
    u.pump!.value = f.a.kick;
    u.jit!.value = 2.5 * f.a.snare + 6 * clamp(snowK);
    u.dial!.value = dial;
    u.vol!.value = Math.PI * 0.75 + Math.PI * 1.5 * (0.45 + 0.35 * this.ctx.audio.energyAt(t));
    u.grainK!.value = ch.kind === 'movie' ? 1 : 0;
    // 電影台：放映機的閃爍（逐格，確定性）
    u.flick!.value = ch.kind === 'movie' ? 0.96 + 0.04 * hash(frameIdx(t), 5) : 1;
    const sp = this.spillOf(ch.kind);
    (u.spill!.value as THREE.Vector3).set(sp[0], sp[1], sp[2]);
    this.tv.render(renderer, out);
    if (!this.decoUp) { this.deco.upload(); this.decoUp = true; }
    comp.draw(renderer, this.deco.texture, out);
    // 鏡頭：整段慢慢推向電視（緩進緩出），大鼓時輕輕一震
    return { bloom: 0.45, vignette: 0.45, halation: 0.22, grain: 0.05, zoom: 1 + 0.045 * ease.inOutCubic(f.p) + 0.004 * f.a.kick, popupAvoid: this.avoid };
  }

  /** 螢幕打在牆上的光（每一台的主色）。 */
  private spillOf(kind: Kind): [number, number, number] {
    const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    if (kind === 'bars') return mix(LIN.bone, LIN.signal, 0.4);
    if (kind === 'movie') return mix(LIN.ash, LIN.bone, 0.3).map((x) => x * 0.6) as [number, number, number];
    if (kind === 'shop') return mix(LIN.signal, LIN.blood, 0.4);
    return mix(LIN.blood, LIN.signal, 0.5);
  }

  // ---------------------------------------------------------------- 節目畫面
  /**
   * 節目畫面（標準 v2）：上半是每一台自己的畫面（會動的主視覺），留言在下半、靠左（跟節目的「點播卡」一樣的位置），
   * 最下面是字幕。留言與字幕的位置、斷行每一台都一樣，轉台不打斷閱讀。
   */
  private drawProgram(t: number, ch: (typeof CHANNELS)[number], tSw: number) {
    const L = this.prog, c = L.ctx;
    const au = this.ctx.audio;
    L.clear(rgba('ink'));
    c.textBaseline = 'alphabetic';
    this.drawPicture(c, t, ch.kind);

    // ---- 留言上面的小標（小、低對比）
    const m = this.msg;
    const label = m ? (m.couple ? '新人的話　FROM THE COUPLE' : ch.label) : '點播專線';
    c.globalAlpha = prog(t, this.tOn + 0.3, this.tOn + 0.5);
    c.font = font(F.hei(500), 19); c.letterSpacing = '5px';
    c.fillStyle = ch.kind === 'bars' ? rgba('bone', 0.55) : rgba('signal', 0.7);
    c.fillText(label, MBOX.x, MBOX.y - 14);
    c.letterSpacing = '0px';
    c.globalAlpha = 1;

    // ---- 留言
    const fit = this.fit;
    const fam = F.hand(m ? 400 : 700);
    const shown = fitChars(fit.lines, charsAt(this.sched, t));
    const y0 = MBOX.y + fit.size * 0.92;
    drawMessage(c, fit, fam, MBOX.x, y0, { color: rgba('bone', 0.97), chars: shown });
    // 署名：留言出完之後，最後一行下面、靠右
    const done = this.sched.length ? this.sched[this.sched.length - 1]!.t : this.tFirst;
    if (m && t >= done) {
      c.globalAlpha = prog(t, done, done + 0.25);
      c.font = font(F.hand(400), this.sigSize); c.fillStyle = rgba('ash');
      c.textAlign = 'right';
      const sig = ch.kind === 'shop' ? `${signature(m.name)}（已購買）` : signature(m.name);
      c.fillText(sig, MBOX.x + MBOX.w, y0 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize + 6);
      c.textAlign = 'left';
      c.globalAlpha = 1;
    }

    // ---- 字幕（歌詞）
    this.drawSubtitle(c, t, ch.kind);

    // ---- 頻道數字（左上，轉台後顯示一小節）：冷面笑話「全頻道聯播」就寫在這裡，不另外放台標
    const osd = 1 - prog(t, tSw + this.bar, tSw + this.bar + 0.3);
    if (osd > 0 && t >= this.tOn + 0.25) {
      c.globalAlpha = osd;
      c.fillStyle = rgba('ink', 0.78);
      c.fillRect(38, 40, 236, 100);
      c.font = font(F.mono(600), 50); c.fillStyle = rgba('signal');
      c.fillText(`CH ${String(ch.ch).padStart(2, '0')}`, 52, 92);
      c.font = font(F.hei(500), 17); c.letterSpacing = '3px';
      c.fillText(`${ch.name}・全頻道聯播`, 56, 124);
      c.letterSpacing = '0px';
      c.globalAlpha = 1;
    }
    void au;
  }

  /** 每一台上半的畫面：一直在動，重要的動作落在拍點上。下半（留言、字幕）墊暗，字才清楚。 */
  private drawPicture(c: CanvasRenderingContext2D, t: number, kind: Kind) {
    const au = this.ctx.audio, { song } = this.ctx;
    const bt = au.beatAt(t), bf = bt - Math.floor(bt);
    const tick = Math.floor(bt) + ease.outExpo(bf); // 一拍走一格（落在拍點上、停住）
    const kick = au.hit('kick', t, 0.15);
    if (kind === 'request') {
      // 點歌台：放射光布景＋一張正在轉的唱片（一拍轉一格），唱片標籤上是點播的歌
      const g = c.createRadialGradient(PW / 2, PIC_CY, 30, PW / 2, PIC_CY, PW * 0.6);
      g.addColorStop(0, mixRgba('ink2', 'blood', 0.45)); g.addColorStop(1, rgba('ink'));
      c.fillStyle = g; c.fillRect(0, 0, PW, PH);
      c.save(); c.translate(PW / 2, PIC_CY); c.rotate(tick * (TAU / 72));
      c.fillStyle = rgba('signal', 0.04 + 0.04 * kick);
      for (let k = 0; k < 18; k++) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 900, (k / 18) * TAU, (k / 18 + 1 / 36) * TAU); c.closePath(); c.fill(); }
      c.restore();
      const R = 142;
      c.save(); c.translate(PW / 2, PIC_CY);
      c.fillStyle = rgba('ink', 0.95); c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
      c.strokeStyle = rgba('bone', 0.07); c.lineWidth = 1;
      for (let r = 56; r < R - 4; r += 5) { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); }
      // 溝紋上的反光（兩道扇形，跟著唱片轉）
      c.rotate(tick * (TAU / 8));
      c.fillStyle = rgba('bone', 0.08);
      for (const a of [0, Math.PI]) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R - 4, a - 0.25, a + 0.25); c.closePath(); c.fill(); }
      c.fillStyle = mixRgba('signal', 'blood', 0.35); c.beginPath(); c.arc(0, 0, 50, 0, TAU); c.fill();
      c.fillStyle = rgba('ink'); c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill();
      c.fillStyle = rgba('ink', 0.75); c.font = font(F.hei(700), 13); c.textAlign = 'center';
      c.fillText('點　播', 0, -18);
      c.restore(); c.textAlign = 'left';
      void song;
    } else if (kind === 'bars') {
      // 測試訊號：七條色帶（用色票，不是真的標準色）、下面一排反序的小方塊、正中間的測試卡時鐘（一拍走一格）
      const cols = ['bone', 'ember', 'ash', 'signal', 'rose', 'blood', 'graphite'];
      const bw = PW / cols.length;
      cols.forEach((k, j) => { c.fillStyle = mixRgba(k, 'ink', 0.4); c.fillRect(j * bw, 0, bw + 1, PIC_H - 40); });
      cols.forEach((k, j) => { c.fillStyle = j % 2 ? rgba('ink') : mixRgba(cols[cols.length - 1 - j]!, 'ink', 0.3); c.fillRect(j * bw, PIC_H - 40, bw + 1, 40); });
      c.fillStyle = rgba('ink'); c.fillRect(0, PIC_H, PW, PH - PIC_H);
      const cx = PW / 2, cy = PIC_CY, a = -Math.PI / 2 + tick / 12 * TAU;
      c.fillStyle = rgba('ink', 0.92); c.beginPath(); c.arc(cx, cy, 84, 0, TAU); c.fill();
      c.strokeStyle = rgba('bone', 0.8); c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 84, 0, TAU); c.stroke();
      for (let k = 0; k < 12; k++) { const b = (k / 12) * TAU; c.beginPath(); c.moveTo(cx + Math.cos(b) * 70, cy + Math.sin(b) * 70); c.lineTo(cx + Math.cos(b) * 80, cy + Math.sin(b) * 80); c.stroke(); }
      c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * 62, cy + Math.sin(a) * 62); c.stroke();
      c.lineWidth = 1; c.lineCap = 'butt';
    } else if (kind === 'movie') {
      // 電影台：寬銀幕的夜景（月亮、飄過的雲、遠山），漏光慢慢飄
      c.fillStyle = rgba('ink'); c.fillRect(0, 0, PW, PH);
      const top = 64, bot = PIC_H;
      const g = c.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, mixRgba('ink2', 'graphite', 0.2)); g.addColorStop(1, mixRgba('ink2', 'blood', 0.25));
      c.fillStyle = g; c.fillRect(0, top, PW, bot - top);
      c.save(); c.beginPath(); c.rect(0, top, PW, bot - top); c.clip();
      const mx = 700, my = 150;
      const mg = c.createRadialGradient(mx, my, 20, mx, my, 160);
      mg.addColorStop(0, rgba('bone', 0.25)); mg.addColorStop(1, rgba('bone', 0));
      c.fillStyle = mg; c.fillRect(0, top, PW, bot - top);
      c.fillStyle = mixRgba('bone', 'signal', 0.15); c.beginPath(); c.arc(mx, my, 36, 0, TAU); c.fill();
      // 雲：三朵，慢慢往右飄（不同速度＝視差）
      for (const [k, y, sp] of [[0, 120, 14], [1, 190, 22], [2, 250, 34]] as const) {
        const x = ((t * sp + k * 380) % (PW + 400)) - 200;
        c.fillStyle = rgba('graphite', 0.35 + 0.1 * k);
        c.beginPath(); c.ellipse(x, y, 130, 16, 0, 0, TAU); c.fill();
        c.beginPath(); c.ellipse(x + 60, y - 10, 80, 14, 0, 0, TAU); c.fill();
      }
      // 遠山（兩層）
      for (const [k, base, amp] of [[0, bot - 60, 40], [1, bot - 24, 30]] as const) {
        c.fillStyle = k ? rgba('ink', 0.95) : mixRgba('ink', 'graphite', 0.3);
        c.beginPath(); c.moveTo(0, bot);
        for (let x = 0; x <= PW; x += 20) c.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x * 0.011 + k * 2.1) * Math.cos(x * 0.004 + k)));
        c.lineTo(PW, bot); c.closePath(); c.fill();
      }
      const lx = 120 + 60 * Math.sin(t * 0.4);
      const lg = c.createRadialGradient(lx, 200, 10, lx, 200, 380);
      lg.addColorStop(0, rgba('signal', 0.14)); lg.addColorStop(1, rgba('signal', 0));
      c.fillStyle = lg; c.fillRect(0, top, PW, bot - top);
      c.restore();
      c.font = font(F.hei(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.55);
      c.textAlign = 'center';
      c.fillText(`今晚首播《${song.title || '今晚的歌'}》`, PW / 2, 44);
      c.textAlign = 'left'; c.letterSpacing = '0px';
    } else {
      // 購物台：轉盤上的喜餅禮盒（一拍轉一格），旁邊的價格標籤跟著大鼓跳
      const g = c.createLinearGradient(0, 0, 0, PH);
      g.addColorStop(0, mixRgba('blood', 'ink', 0.3)); g.addColorStop(0.55, rgba('ink'));
      c.fillStyle = g; c.fillRect(0, 0, PW, PH);
      const fl = bf < 0.5 ? 1 : 0.82;
      c.fillStyle = rgba('signal', 0.8 * fl); c.fillRect(0, 40, PW, 36);
      c.font = font(F.hei(700), 20); c.fillStyle = rgba('ink'); c.letterSpacing = '3px';
      c.textAlign = 'center';
      c.fillText('限時特賣　愛情一組', PW / 2, 65);
      c.textAlign = 'left'; c.letterSpacing = '0px';
      // 轉盤（橢圓）＋禮盒：寬度照轉角縮放，看起來在轉
      const cx = PW / 2, cy = 300;
      c.fillStyle = rgba('graphite', 0.6); c.beginPath(); c.ellipse(cx, cy + 6, 170, 26, 0, 0, TAU); c.fill();
      const ang = tick * (TAU / 16);
      const fw = 120 * Math.abs(Math.cos(ang)), sw = 80 * Math.abs(Math.sin(ang));
      const bh = 110, by = cy - bh;
      const front = Math.cos(ang) >= 0;
      c.fillStyle = mixRgba('bone', 'signal', 0.25); c.fillRect(cx - (fw + sw) / 2, by, fw, bh);
      c.fillStyle = mixRgba('bone', 'blood', 0.35); c.fillRect(cx - (fw + sw) / 2 + fw, by, sw, bh);
      // 緞帶：正面中間一條、側面中間一條、上面一個蝴蝶結
      c.fillStyle = rgba('rose', 0.9);
      c.fillRect(cx - (fw + sw) / 2 + fw / 2 - 6, by, 12, bh);
      c.fillRect(cx - (fw + sw) / 2 + fw + sw / 2 - 5, by, 10, bh);
      c.beginPath(); c.ellipse(cx - 18, by - 10, 20, 11, -0.4, 0, TAU); c.ellipse(cx + 18, by - 10, 20, 11, 0.4, 0, TAU); c.fill();
      void front;
      // 價格標籤：大鼓一打跳一下
      const px = cx + 210, py = 190, pr = 64 * (1 + 0.1 * kick);
      c.save(); c.translate(px, py); c.rotate(-0.2 + tick * 0.08);
      c.fillStyle = rgba('signal');
      c.beginPath();
      for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU, r = k % 2 ? pr * 0.82 : pr; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.closePath(); c.fill();
      c.rotate(0.2 - tick * 0.08);
      c.fillStyle = rgba('ink'); c.font = font(F.hei(900), 26); c.textAlign = 'center';
      c.fillText('無價', 0, 9);
      c.restore(); c.textAlign = 'left';
    }
    // 下半（留言、字幕）墊一層漸暗，字後面乾淨
    const dg = c.createLinearGradient(0, PIC_H - 30, 0, PIC_H + 40);
    dg.addColorStop(0, rgba('ink', 0)); dg.addColorStop(1, rgba('ink', 0.88));
    c.fillStyle = dg; c.fillRect(0, PIC_H - 30, PW, 70);
    c.fillStyle = rgba('ink', 0.88); c.fillRect(0, PIC_H + 40, PW, PH - PIC_H - 40);
  }

  /** 下面的字幕：一行歌詞（逐字跟唱），底下墊一條半透明的黑帶（電影台就是寬銀幕的黑邊）。純音樂：♪ 歌名 ♪。 */
  private drawSubtitle(c: CanvasRenderingContext2D, t: number, kind: Kind) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t, 1.0);
    const st = { family: F.archivo(100, 800), size: this.lyrSize, minSize: V2.lyrMin / KX, maxWidth: SUB.w, align: 'center' as const, lineHeight: 1.12,
      active: rgba('signal'), sung: rgba('bone', 0.97), unsung: rgba('bone', 0.32) };
    if (ly) {
      const lay = layoutLyric(c, ly.line, st);
      const rows = lay.rows.length;
      // 原文副行（韓文歌，drawLyric 自動畫在中文下面）：改成副行最後一排的基線落在字幕線上，整組往上長，不會被映像管的邊裁掉
      const y = SUB.y - (lay.sub ? lay.height - lay.size : (rows - 1) * lay.size * 1.12);
      if (kind !== 'movie') {
        const w = Math.max(...lay.rows.map((r) => r.width), ...(lay.sub?.lay.rows.map((r) => r.width) ?? [])) + 48;
        c.fillStyle = rgba('ink', 0.62 * ly.k);
        c.fillRect(PW / 2 - w / 2, y - lay.size * 0.98, w, lay.size * 1.32 + (lay.sub ? lay.height - lay.size : (rows - 1) * lay.size * 1.12));
      }
      c.save(); c.translate(PW / 2, y);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else if (!this.hasLyrics) {
      const k = prog(t, this.tOn + 0.4, this.tOn + 0.8);
      const txt = `♪  ${song.title || '今晚的歌'}  ♪`;
      c.globalAlpha = k;
      c.font = font(F.archivo(100, 700), this.lyrSize * 0.9); c.textAlign = 'center';
      const w = c.measureText(txt).width + 48;
      if (kind !== 'movie') { c.fillStyle = rgba('ink', 0.62); c.fillRect(PW / 2 - w / 2, SUB.y - this.lyrSize, w, this.lyrSize * 1.35); }
      c.fillStyle = rgba('bone', 0.9);
      c.fillText(txt, PW / 2, SUB.y);
      c.textAlign = 'left'; c.globalAlpha = 1;
    }
  }
}
