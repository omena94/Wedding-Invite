// 郵票（亮）：一只信封上貼著一張很大的郵票，鏡頭從斜上方看著它。
//  - 郵票：齒孔（四邊一排半圓的缺口）、細線框；右邊是一幅版畫（一條彎彎的路往地平線上的太陽延伸，天空是放射的刻線、
//    山是交叉的刻線），左邊是郵票上的字＝主打留言（思源宋體，跟版畫同一個油墨色）。左上角是面值「∞」、上緣一行「愛情郵政」。
//    第一拍起留言一個字一個字印上去（剛印的油墨濕濕的、一下就乾）。
//  - 郵票下面連著一條邊紙（中間隔一排齒孔），邊紙上印的是歌詞，照跟唱規則逐字變色；郵票框的角落一個小小的版號。
//  - 郵戳在拍點蓋下：第一個小節線（留言開始印之後），郵戳的影子從上面壓過來、「砰」地蓋在郵票右上角與信封上
//    （圓形日戳＋往右的波浪線，油墨有斑駁），畫面一震。之後每個小節線鏡頭換一個角度（快、落在小節線上），
//    接下來兩個小節線信封右邊再「砰、砰」蓋上兩個橡皮章（限時專送、永久保存）。
//  - 版畫是活的：天空的放射刻線很慢地轉，兩朵刻線畫的雲從左往右飄過太陽。
//  - 留言標準 v2：郵票本身還是很大（它就是場景），寫字的那一塊 630×420、字 40～60；版畫放寬，當郵票的主角。
//  - 沒有留言：郵票上印新人的名字與日期（比歌詞小），邊紙的歌詞放大是主角；信封上一行小字邀請。
// 手法：信封、郵票的紙與齒孔、版畫、油墨都在一個 shader（PlaneCam：信封是空間裡的平面）。郵票上的字是 init() 畫好的資料貼圖
// （_t25 glyphMask，依序印出）；郵票的框與小字、郵戳各是一張 init 畫一次的 Canvas；邊紙的歌詞是每格重畫的一張。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, pulse } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, COUPLE_ZH, DATE_DOTS, lyricSubOf, type LyricStyle } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { PlaneCam, camUniforms, CAM_GLSL } from './_t14';
import {
  T25_TEXT, T25_INVITE, sigOf, winBars, winBeats, stagger, layMsgV2, msgGlyphs, glyphMask, paperLyric, MASK_GLSL,
  type GlyphMask, type MsgLay, type Rect,
} from './_t25';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'journey', paper: true, energy: [0.15, 0.85], bars: [4, 8] };

/** 郵票（含齒孔的外緣）、邊紙、郵票裡的版畫與字的範圍（頁面座標）。 */
const ST = { x: 236, y: 112, w: 1180, h: 704 };
const SELV = { y0: 816, y1: 968 };
const PERF = 30; // 齒孔間距
const IMG = { x: 980, y: 176, w: 380, h: 576 };
/** 郵票上寫字的那一塊（留言標準 v2：≤ 860×430）；面值、國名那一行固定在 HEAD_Y。 */
const TXT = { x: 306, y: 262, w: 630, h: 420 };
const HEAD_Y = 216;
const LYR = { x: 306, y: 922, w: 1020 };
/** 有韓文原文時中文只排一排、最寬到這裡（斜著看時右緣在畫面上不進右下角 HUD）。 */
const LYR_SUB_W = 960;
/** 郵戳：圓心與半徑；波浪線往右延伸。 */
const PM = { x: 1330, y: 250, r: 132 };
const PM_RECT: Rect = [PM.x - 170, PM.y - 170, 900, 340];
/** 信封右邊的兩個橡皮章（畫在同一張圖：第一個在紅色、第二個在綠色通道，shader 分開蓋）。 */
const RS_RECT: Rect = [1440, 430, 440, 360];
const RUBBER = [
  { text: '限時專送', x: 1610, y: 520, rot: -0.1 },
  { text: '永久保存', x: 1660, y: 680, rot: 0.06 },
];
const FAM_MSG = F.ming(900);
const FAM_LYR = F.archivo(100, 800);
const COUNTRY = '愛情郵政　·　LOVE POST';
const PM_TOP = '幸福郵局', PM_BOT = '永遠有效';
const PLATE = 'A 0313';

const BG = () => new FSPass(/* glsl */ `
  uniform float t;
  uniform sampler2D st; uniform sampler2D ly; uniform sampler2D pm; uniform float pmK; uniform float pmShadow;
  uniform sampler2D mm; uniform vec4 mmR; uniform float shown; uniform float hasMsg;
  uniform sampler2D rs; uniform vec2 rsK;
  ${CAM_GLSL}
  ${MASK_GLSL}
  const vec4 IM = vec4(${IMG.x}.0, ${IMG.y}.0, ${IMG.w}.0, ${IMG.h}.0);
  const vec4 PR = vec4(${PM_RECT.join('.0, ')}.0);
  // 郵票的形狀：矩形，四邊每隔 PERF 一個半圓缺口（齒孔）；邊紙跟郵票之間一排圓洞
  float stampSD(vec2 P) {
    vec2 c = vec2(${ST.x + ST.w / 2}.0, ${(ST.y + SELV.y1) / 2}.0);
    vec2 hs = vec2(${ST.w / 2}.0, ${(SELV.y1 - ST.y) / 2}.0);
    float d = sdBox(P - c, hs);
    // 沿邊的缺口：離邊最近的那一邊，沿著邊每 PERF 一個圓
    vec2 q = P - (c - hs);
    float gx = (fract(q.x / ${PERF}.0) - 0.5) * ${PERF}.0, gy = (fract(q.y / ${PERF}.0) - 0.5) * ${PERF}.0;
    float hole = min(length(vec2(gx, abs(P.y - (c.y - hs.y)))), length(vec2(gx, abs(P.y - (c.y + hs.y)))));
    hole = min(hole, min(length(vec2(gy, abs(P.x - (c.x - hs.x)))), length(vec2(gy, abs(P.x - (c.x + hs.x))))));
    // 郵票與邊紙之間的一排圓洞
    hole = min(hole, length(vec2(gx, P.y - ${ST.y + ST.h}.0)));
    return max(d, -(hole - 8.5));
  }
  // 版畫：一條彎彎的路往地平線上的太陽，天空是放射的刻線、山是斜的刻線，路是白的
  float engraving(vec2 P) {
    vec2 u = (P - IM.xy) / IM.zw; // 0..1、y 向下
    vec2 sun = vec2(0.52, 0.34);
    float horizon = 0.56 + 0.03 * sin(u.x * 7.0);
    float ink = 0.0;
    if (u.y < horizon) {
      // 天空：從太陽放射出去的刻線（越往上越密越暗；整圈很慢地轉，版畫是活的）
      vec2 d = u - sun;
      float ang = atan(d.y * IM.w, d.x * IM.z) + t * 0.02;
      float rays = hatch(ang * 26.0, 0.25 + 0.45 * smoothstep(0.1, 0.9, length(d * vec2(1.0, 1.6))));
      float r = length((u - sun) * IM.zw);
      ink = r < 58.0 ? 0.0 : rays * smoothstep(58.0, 76.0, r);
      ink = max(ink, 1.0 - smoothstep(0.8, 2.0, abs(r - 64.0))); // 太陽的外圈
      // 兩朵雲（刻線畫法：白的雲身、一圈細輪廓、下半截幾條橫線），從左往右慢慢飄過太陽
      for (int i = 0; i < 2; i++) {
        float fi = float(i);
        vec2 cp = vec2(fract(0.15 + fi * 0.55 + t * (0.011 + fi * 0.004)) * 1.6 - 0.3, 0.2 + fi * 0.16);
        vec2 q = (u - cp) * IM.zw / vec2(92.0 - fi * 20.0, 30.0 - fi * 6.0);
        float cd = length(q) - 1.0 + 0.3 * fbm(q * 1.3 + fi * 7.0, 2) + 0.25 * sin(q.x * 3.0);
        if (cd < 0.0) ink = (q.y > 0.25 && q.y < 0.75) ? step(0.55, fract(q.y * 5.0)) * 0.9 : 0.0;
        ink = max(ink, 1.0 - smoothstep(0.02, 0.07, abs(cd)));
      }
    } else {
      // 山：兩層，遠的淡（橫刻線）、近的濃（斜的交叉刻線）
      float near = 0.74 + 0.06 * sin(u.x * 5.0 + 1.3);
      float dk = u.y < near ? 0.42 : 0.72;
      ink = engrave(P, dk, 1.0 / 6.0, u.y < near ? 0.0 : 0.6);
      // 路：從下面寬寬的進來，彎兩下縮到地平線上的一點
      float k = clamp((u.y - horizon) / (1.0 - horizon), 0.0, 1.0);
      float cx = 0.52 + 0.16 * sin(k * 5.0 + 0.5) * k;
      float w = mix(0.006, 0.16, k * k);
      float rd = abs(u.x - cx) - w;
      if (rd < 0.0) ink = 0.0;
      ink = max(ink, (1.0 - smoothstep(0.0, 0.004, abs(rd))) * step(horizon, u.y)); // 路邊的線
    }
    // 版畫的框（兩條線）
    vec2 e = min(u, 1.0 - u) * IM.zw;
    float fr = min(e.x, e.y);
    if (fr < 0.0) return 0.0;
    ink = max(ink, 1.0 - smoothstep(0.6, 1.6, abs(fr - 1.0)));
    ink = max(ink, (1.0 - smoothstep(0.4, 1.2, abs(fr - 6.0))) * 0.8);
    return ink;
  }
  void main() {
    vec2 sp = SP();
    vec3 hit = pcHit(sp, 0.0);
    vec2 P = hit.xy;
    // ---- 信封：紙、纖維、左上角的航空斜紋邊（很淡）
    vec3 col = C_PAPER * (0.95 + 0.05 * fbm(P / 140.0, 3)) * (0.97 + 0.03 * fbm(P / 9.0, 2));
    // 信封比畫面大一圈；邊上一圈航空信封的斜紋（很淡），信封外面是桌面
    float ed = -sdBox(P - vec2(960.0, 540.0), vec2(1180.0, 690.0));
    float stripe = step(0.5, fract((P.x + P.y) / 56.0));
    col = mix(col, mix(C_BLOOD, C_ASH, stripe), (1.0 - smoothstep(34.0, 36.0, ed)) * 0.3);
    col = mix(col, C_SEPIA * (0.3 + 0.08 * fbm(vec2(P.x / 400.0, P.y / 18.0), 3)), 1.0 - smoothstep(-1.0, 1.0, ed));
    // ---- 郵票的影子（往右下，很淡）與郵票本身
    float sd = stampSD(P);
    float sh = stampSD(P - vec2(10.0, 14.0));
    col *= 1.0 - 0.14 * (1.0 - smoothstep(-6.0, 16.0, sh));
    if (sd < 0.5) {
      vec3 sc = mix(C_BONE, C_PAPER, 0.25) * (0.985 + 0.015 * fbm(P / 7.0, 2));
      // 郵票的紙微微翹起：邊緣亮一點
      sc *= 1.0 + 0.03 * (1.0 - smoothstep(-14.0, 0.0, sd));
      // 版畫（郵票的油墨色：訊號色的暗部帶一點墨）
      vec3 inkC = mix(C_BLOOD, C_SEPIA, 0.45);
      float eg = engraving(P);
      sc = mix(sc, inkC, eg * 0.9);
      // 郵票的框與小字、邊紙的歌詞
      vec2 uv = pageUV(P);
      vec4 fc = fastLayer(texture(st, uv));
      sc = sc * (1.0 - fc.a) + fc.rgb;
      vec4 lc = fastLayer(texture(ly, uv));
      sc = sc * (1.0 - lc.a) + lc.rgb;
      // 郵票上的字（依序印上去，剛印的油墨濕濕的、偏訊號色）
      if (hasMsg > -0.5) {
        vec4 mk = maskAt(mm, mmR, P);
        float gi = floor(mk.g * 255.0 + 0.5);
        float rv = clamp((shown - gi - mk.b) * 4.0, 0.0, 1.0);
        float wet = clamp(1.0 - (shown - gi) / 5.0, 0.0, 1.0);
        vec3 ink = mix(inkC, C_BLOOD * 1.1, wet * 0.5);
        if (mk.r > 0.9) ink = C_ROSE * 0.9;
        sc = mix(sc, ink, mk.a * rv);
      }
      col = mix(col, sc, 1.0 - smoothstep(-0.5, 0.5, sd));
    }
    // ---- 信封上的橡皮章（紅：第一個、綠：第二個），油墨斑駁
    vec2 ru = (P - vec2(${RS_RECT[0]}.0, ${RS_RECT[1]}.0)) / vec2(${RS_RECT[2]}.0, ${RS_RECT[3]}.0);
    if (ru.x > 0.0 && ru.y > 0.0 && ru.x < 1.0 && ru.y < 1.0) {
      vec4 rc = fastLayer(texture(rs, vec2(ru.x, 1.0 - ru.y)));
      float grr = smoothstep(0.2, 0.7, 0.55 + 0.5 * fbm(P / 4.0 + 3.0, 3) + 0.3 * fbm(P / 50.0, 2));
      col = mix(col, mix(C_BLOOD, C_SEPIA, 0.3), max(rc.r * rsK.x, rc.g * rsK.y) * grr * 0.78);
    }
    // ---- 郵戳：蓋下去之前先有一團影子壓過來；蓋下之後是斑駁的油墨
    vec2 pu = (P - PR.xy) / PR.zw;
    if (pu.x > 0.0 && pu.y > 0.0 && pu.x < 1.0 && pu.y < 1.0) {
      vec4 pc = texture(pm, vec2(pu.x, 1.0 - pu.y));
      float a = pc.a;
      float grunge = smoothstep(0.25, 0.75, 0.55 + 0.5 * fbm(P / 5.0, 3) + 0.25 * fbm(P / 60.0, 2));
      col = mix(col, C_SEPIA * 0.9, a * grunge * pmK * 0.82);
      float dd = length(P - vec2(${PM.x}.0, ${PM.y}.0));
      col *= 1.0 - 0.25 * pmShadow * (1.0 - smoothstep(${PM.r - 60}.0, ${PM.r + 90}.0, dd));
    }
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, st: { value: null }, ly: { value: null }, pm: { value: null }, pmK: { value: 0 }, pmShadow: { value: 0 },
  mm: { value: null }, mmR: { value: new THREE.Vector4(0, 0, 1, 1) }, shown: { value: 0 }, hasMsg: { value: 0 },
  rs: { value: null }, rsK: { value: new THREE.Vector2() },
  ...camUniforms(),
});

export default class Stamp extends Scene {
  bg = shared('stamp.bg', BG);
  /** 郵票的框、面值、小字（init 畫一次）。 */
  st = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 邊紙的歌詞（每格重畫）。 */
  ly = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 郵戳（init 畫一次，只蓋住郵戳那一塊）。 */
  pm = this.track(new Layer2D(PM_RECT[2], PM_RECT[3], 1, { fast: true }));
  /** 橡皮章（init 畫一次，只蓋住信封右邊那一塊）。 */
  rs = this.track(new Layer2D(RS_RECT[2], RS_RECT[3], 1, { fast: true }));
  /** 橡皮章蓋下去的時間（窗格太短就不蓋：Infinity）。 */
  tRub = [Infinity, Infinity];
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  mm: GlyphMask | null = null;
  mmRect: Rect = [0, 0, 1, 1];
  lay: MsgLay | null = null;
  times: number[] = [];
  bars: number[] = [];
  tFirst = 0;
  tStrike = 0;
  /** 有韓文原文的句子：中文排成一排的字級（第一次用到時量好）。 */
  subFit = new Map<Line, number>();
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 52, minSize: V2.lyrMin, maxWidth: LYR.w, tracking: 2, ...paperLyric() };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 0.5, e + 0.5);
    await loadText(`${T25_TEXT}${COUNTRY}${PM_TOP}${PM_BOT}${PLATE}∞郵資${RUBBER.map((r) => r.text).join('')}${m?.text ?? ''}${m ? sigOf(m) : ''}${lines.map((l) => l.text).join('')}${song.title}`);
    const bar = au.timeOfBar(au.barAt(s) + 1) - au.timeOfBar(au.barAt(s));
    const beat = au.beatPeriod(s);
    this.tFirst = winBeats(au, s + 0.1, e)[0] ?? s + 0.2;
    this.bars = winBars(au, s, e);
    // 郵戳：第一拍之後至少兩拍的第一個小節線；窗格短就在第三拍
    this.tStrike = this.bars.find((b) => b >= this.tFirst + beat * 1.9) ?? (winBeats(au, s, e)[2] ?? this.tFirst + beat * 2);
    // 橡皮章：郵戳之後的下兩個小節線（窗格結束前半拍以內的不蓋，才看得到蓋上去）
    const later = this.bars.filter((b) => b > this.tStrike + 0.01 && b < e - beat * 0.5);
    this.tRub = [later[0] ?? Infinity, later[1] ?? Infinity];

    // ---- 郵票上的字
    const c = document.createElement('canvas').getContext('2d')!;
    const text = m ? m.text : COUPLE_ZH;
    const sig = m ? sigOf(m) : DATE_DOTS;
    // 郵票在畫面上約 1:1（鏡頭只在 0.975～1 倍之間換角度），字級直接照螢幕 px；
    // 沒有留言時郵票上是新人的名字（比邊紙的歌詞小；純音樂時名字是主角，可以到 60）
    const lay = layMsgV2(c, text, sig, FAM_MSG, TXT, { max: m ? undefined : (lyrics.has ? 44 : V2.msgMax), lineHeight: 1.3, maxLines: 6, sigFamily: F.ming(700), align: 'left' });
    this.lay = lay;
    const items = msgGlyphs(this.lay);
    this.mmRect = [TXT.x - 30, TXT.y - 30, TXT.w + 60, TXT.h + 60];
    this.mm = this.track(glyphMask(items, this.mmRect, 1, 2));
    const maxDur = Math.max(0.8, Math.min(1.6 * bar, 0.45 * (e - this.tFirst)));
    this.times = stagger(au, this.tFirst, items.length, maxDur);
    this.lyrStyle = { ...this.lyrStyle, size: lyricV2(m ? lay.screen : null) };

    // ---- 郵票的框、面值、國名、邊紙的版號；信封上的邀請（沒有留言）
    const g = this.st.ctx;
    this.st.clear();
    const ink = rgba('blood');
    g.strokeStyle = ink; g.lineWidth = 2;
    g.strokeRect(ST.x + 34, ST.y + 34, ST.w - 68, ST.h - 68);
    g.lineWidth = 1;
    g.strokeRect(ST.x + 42, ST.y + 42, ST.w - 84, ST.h - 84);
    g.fillStyle = ink;
    g.font = font(F.serif(600), 58); g.fillText('∞', TXT.x, HEAD_Y + 10);
    g.font = font(F.hei(500), 20); g.letterSpacing = '6px';
    g.fillText('郵資', TXT.x + 64, HEAD_Y);
    g.fillText(COUNTRY, TXT.x + 190, HEAD_Y);
    g.letterSpacing = '0px';
    // 版號：郵票框的左下角（不要放到邊紙右邊：那裡是右下角 QR 的範圍）
    g.font = font(F.mono(500), 16); g.fillStyle = rgba('sepia', 0.5);
    g.fillText(PLATE, ST.x + 52, ST.y + ST.h - 54);
    if (!m) {
      g.font = font(F.hei(500), 22); g.letterSpacing = '3px'; g.fillStyle = rgba('sepia', 0.6);
      g.fillText(T25_INVITE, TXT.x, 1010);
      g.letterSpacing = '0px';
    }
    this.st.upload();

    // ---- 郵戳：兩圈、上下的弧形字、中間的日期、往右五條波浪線（全部畫成墨色，shader 加斑駁）
    const p = this.pm.ctx;
    this.pm.clear();
    const cx = PM.x - PM_RECT[0], cy = PM.y - PM_RECT[1];
    // 這張只當遮罩用（shader 只讀 alpha，顏色在 shader 裡用色票上）
    p.strokeStyle = p.fillStyle = rgba('sepia');
    p.lineWidth = 5; p.beginPath(); p.arc(cx, cy, PM.r, 0, Math.PI * 2); p.stroke();
    p.lineWidth = 3; p.beginPath(); p.arc(cx, cy, PM.r - 44, 0, Math.PI * 2); p.stroke();
    const arc = (s0: string, top: boolean) => {
      p.font = font(F.hei(700), 30);
      const chars = Array.from(s0), step = 0.3;
      chars.forEach((ch, i) => {
        const a = (i - (chars.length - 1) / 2) * step;
        p.save();
        p.translate(cx, cy);
        p.rotate(top ? a : -a);
        p.textAlign = 'center';
        p.fillText(ch, 0, top ? -PM.r + 34 : PM.r - 12);
        p.restore();
      });
    };
    arc(PM_TOP, true); arc(PM_BOT, false);
    p.font = font(F.mono(600), 26); p.textAlign = 'center';
    p.fillText(DATE_DOTS.replace(/ · /g, '.'), cx, cy + 9);
    p.textAlign = 'left';
    p.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      const y = cy - 60 + i * 30;
      p.beginPath();
      for (let x = cx + PM.r + 20; x <= PM_RECT[2]; x += 6) {
        const yy = y + Math.sin((x - cx) * 0.045) * 9;
        if (x === cx + PM.r + 20) p.moveTo(x, yy); else p.lineTo(x, yy);
      }
      p.stroke();
    }
    this.pm.upload();

    // ---- 橡皮章：雙線的方框、字距拉開的粗黑體（第一個畫紅色、第二個畫綠色：shader 當兩張遮罩用）
    const r = this.rs.ctx;
    this.rs.clear();
    RUBBER.forEach((rb, i) => {
      r.save();
      r.translate(rb.x - RS_RECT[0], rb.y - RS_RECT[1]);
      r.rotate(rb.rot);
      r.strokeStyle = r.fillStyle = i === 0 ? '#f00' : '#0f0';
      r.font = font(F.hei(900), 28); r.letterSpacing = '10px';
      const w = r.measureText(rb.text).width;
      r.lineWidth = 4; r.strokeRect(-w / 2 - 22, -34, w + 36, 64);
      r.lineWidth = 2; r.strokeRect(-w / 2 - 14, -26, w + 20, 48);
      r.textAlign = 'center';
      r.fillText(rb.text, 5, 10);
      r.restore();
    });
    r.letterSpacing = '0px';
    this.rs.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    u.t!.value = t;
    // ---- 鏡頭：切進來斜著、遠一點，第一拍落定；之後每個小節線換一個角度（很快、落在小節線上）
    const beat = au.beatPeriod(s);
    const kin = ease.inOutCubic(prog(t, s, Math.max(s + beat * 1.5, this.tFirst)));
    const poses = [
      { tx: 900, ty: 520, yaw: -0.05, pitch: 0.08, roll: 0.012, d: 1.0 },
      { tx: 930, ty: 540, yaw: 0.04, pitch: 0.1, roll: -0.01, d: 0.975 },
      { tx: 880, ty: 530, yaw: -0.02, pitch: 0.04, roll: 0.018, d: 0.99 },
    ];
    let bi = 0, bk = 1;
    for (let i = 0; i < this.bars.length; i++) {
      const b = this.bars[i]!;
      if (b < this.tStrike + 0.01 || t < b - beat * 0.5) continue;
      bi = i; bk = ease.inOutCubic(prog(t, b - beat * 0.5, b));
    }
    const A = poses[Math.max(0, bi - 1) % 3]!, B = poses[bi % 3]!;
    const cur = { tx: lerp(A.tx, B.tx, bk), ty: lerp(A.ty, B.ty, bk), yaw: lerp(A.yaw, B.yaw, bk), pitch: lerp(A.pitch, B.pitch, bk), roll: lerp(A.roll, B.roll, bk), d: lerp(A.d, B.d, bk) };
    const start = { tx: 1000, ty: 600, yaw: -0.14, pitch: 0.24, roll: 0.05, d: 1.12 };
    this.cam.set({
      tx: lerp(start.tx, cur.tx, kin), ty: lerp(start.ty, cur.ty, kin), dist: 1600 * lerp(start.d, cur.d, kin),
      yaw: lerp(start.yaw, cur.yaw, kin), pitch: lerp(start.pitch, cur.pitch, kin), roll: lerp(start.roll, cur.roll, kin), level: 0.5,
    });
    this.cam.apply(u);

    // ---- 邊紙的歌詞
    const L = this.ly; L.clear();
    const c = L.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      // 有韓文原文時：邊紙只有一排齒孔到下緣那麼高，中文寧可縮小也不要折成兩排（兩排＋原文會壓到齒孔、跑到郵票上）。
      // 字級自己先找好（layoutLyric 照比例縮的時候沒算字距，剛好放得下的會被折行）；右緣再收一點，斜著看時才不會進右下角 HUD
      let st = this.lyrStyle;
      if (lyricSubOf(ly.line)) {
        let sz = this.subFit.get(ly.line);
        if (sz === undefined) {
          c.letterSpacing = `${st.tracking ?? 0}px`;
          for (sz = st.size; sz > 34; sz--) { c.font = font(st.family, sz); if (c.measureText(ly.line.text).width <= LYR_SUB_W) break; }
          c.letterSpacing = '0px';
          this.subFit.set(ly.line, sz);
        }
        st = { ...st, size: sz, minSize: sz, maxWidth: LYR_SUB_W };
      }
      const lay = layoutLyric(c, ly.line, st);
      c.save(); c.translate(LYR.x, LYR.y - (lay.height - lay.size));
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else if (!lyrics.linesIn(s, e).length) {
      c.font = font(FAM_LYR, this.lyrStyle.size); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.8 * prog(t, s, s + 0.5));
      c.fillText(`♪ ${song.title}`, LYR.x, LYR.y);
      c.letterSpacing = '0px';
    }
    u.ly!.value = L.upload();
    u.st!.value = this.st.texture;

    // ---- 郵票上的字
    u.mm!.value = this.mm!.tex;
    (u.mmR!.value as THREE.Vector4).set(...this.mmRect);
    let shown = 0;
    for (let i = 0; i < this.times.length; i++) {
      const k = clamp((t - this.times[i]!) / 0.12);
      if (k <= 0) break;
      shown = i + k;
    }
    u.shown!.value = shown;
    u.hasMsg!.value = 1;

    // ---- 郵戳：影子壓過來（半拍）→ 砰
    u.pm!.value = this.pm.texture;
    u.pmK!.value = t >= this.tStrike ? 1 : 0;
    u.pmShadow!.value = t < this.tStrike ? ease.inQuad(prog(t, this.tStrike - beat * 0.6, this.tStrike)) : 0;
    u.rs!.value = this.rs.texture;
    (u.rsK!.value as THREE.Vector2).set(t >= this.tRub[0]! ? 1 : 0, t >= this.tRub[1]! ? 1 : 0);
    this.bg.render(renderer, out);

    const hitK = Math.max(pulse(t, this.tStrike, 0.07), 0.6 * pulse(t, this.tRub[0]!, 0.06), 0.6 * pulse(t, this.tRub[1]!, 0.06));
    const box = this.lay?.box;
    return {
      paper: 1, bloom: 0.3, vignette: 0.42, grain: 0.05,
      shake: [hitK * 2, hitK * 5],
      zoom: 1 + hitK * 0.012,
      popupAvoid: box ? [this.cam.screenRect(box, 10)] : [],
    };
  }
}
