// 雪花球（暗）：夜裡房間的桌上，一盞燈從左上照著一顆雪花球。球擺在一座木頭底座上，底座正面嵌著一塊深色木頭的銘牌。
//  - 畫面的焦點＝主打留言：刻在銘牌上再貼金（思源宋體，亮的金色字在深色木頭上）。第一個拍點起，仙女棒的火花像雕刻刀一樣
//    沿著字一排一排刻過去，剛刻好的字是燒紅的（訊號色、會發光），約半秒冷卻成金箔；愛心貼玫瑰色；署名刻在最後一行下面靠右。
//    （本來是黃銅牌黑字，但黃銅的顏色跟著主題的訊號色走，薰衣草、鼠尾草主題會變成紫色、綠色的金屬，改成木頭貼金。）
//  - 每個小節線，雪花球自己「跳」一下（整座往上一蹬、落下、晃一晃），球裡的雪整團被甩起來，再慢慢飄落；
//    雪花的位置是「每一次搖晃的反應」疊加起來的純函數（確定性，不用逐格累積狀態）。
//  - 球裡是一個小小的雪景：小屋（窗裡亮著燈，大鼓時亮一下）、兩棵並排的松樹、一盞路燈。不畫人。
//  - 歌詞（比留言小一級）寫在右上方房間的暗處，照跟唱規則逐字亮。
//  - 沒有主打留言：銘牌刻新人的名字與日期（小一點），歌詞放大當主角，下面一行小字邀請。純音樂：右上方是小小的歌名。
//  - 鏡頭：切進來時從稍遠處推進、在第一拍落定，之後整個窗格很慢地推近。
// 手法：房間、桌子、底座、銘牌（刻字的凹凸光影從字模取樣算）、玻璃球（球體折射球裡的雪景貼圖、菲涅耳邊緣、燈的反光）
// 全在一個 shader；球裡的雪景在 init() 畫一次成貼圖；雪花與火花是 LineBatch；歌詞是一張 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, TAU } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, beatAfter, sparkHead, sparkParticles, drawHeart, COUPLE_ZH, DATE_DOTS, type LyricStyle } from './_motifs';
import { T16_INVITE, T16_TEXT, sigOf, rowsOf, glyphCount, charClock, rowFront, type Row } from './_t16';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { fitText } from '../engine/text';

export const spec: PlateSpecDecl = { group: 'type', family: 'nature', paper: false, energy: [0.1, 0.85], bars: [4, 8] };

/** 玻璃球（畫面座標）。 */
const C = { x: 760, y: 328 }, R = 272;
/** 底座正面、銘牌、銘牌上可以刻字的範圍（字要離銘牌邊一點）。 */
const PL = { x0: 168, x1: 1352, top: 612, y0: 640, y1: 1000 };
/**
 * 留言標準 v2：底座（道具）照樣大，只有嵌在正面的那塊銘牌（寫留言的地方）縮到 860 × 308，字 40～60 px。
 */
const PLATE = { x0: 330, x1: 1190, y0: 668, y1: 976 };
const TXT = { x: 374, y: 694, w: 772, h: 262 };
/** 底座右側的發條鑰匙（一拍轉四分之一圈）。 */
const KEY = { x: PL.x1, y: 760 };
/** 右後方牆上的窗（窗外也在下雪）。歌詞在它上面的暗處。 */
const WIN = { x0: 1250, y0: 410, x1: 1690, y1: 740 };
/** 小屋的煙囪口（畫面座標，大約：球裡的雪景經過透鏡放大約 1.06 倍）。 */
const CHIM = { x: C.x + (-110 + 33) * 1.06, y: 0 };
/** 歌詞在右上方的暗處。 */
const LYR = { x: 1150, y: 236, w: 610 };
const LYR_BIG = { x: 1110, y: 250, w: 640 };
const FAM_MSG = F.ming(700);
const FAM_LYR = F.archivo(100, 700);
const PER = 0.08;
/** 雪花數。 */
const NFLAKE = 360;
/** 球裡雪景貼圖的解析度倍數。 */
const IS = 1;

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D inner; uniform sampler2D txt;
  uniform vec2 off; uniform float tilt; uniform float t, kick, kin;
  uniform vec4 plate; // 銘牌（x0, y0, x1, y1）：跟著字的多少變大變小（只比字多一點邊）
  uniform vec4 rows[8]; uniform vec2 fr[8]; uniform float nrow;
  const vec2 C = vec2(${C.x}.0, ${C.y}.0); const float R = ${R}.0;
  const vec2 PIV = vec2(${C.x}.0, ${PL.y1}.0);

  vec4 fast(vec4 c) { return c.a > 0.0 ? vec4(toLinear(c.rgb / c.a) * c.a, c.a) : vec4(0.0); }
  float txtA(vec2 q) { return texture(txt, vec2(q.x / ${W}.0, 1.0 - q.y / ${H}.0)).a; }
  // 字模：白 = 字（金箔）、紅 = 愛心（玫瑰色）；預乘過，白 (a,a,a)、紅 (a,0,0)
  float txtHeart(vec2 q) { vec4 c = texture(txt, vec2(q.x / ${W}.0, 1.0 - q.y / ${H}.0)); return clamp(c.r - c.g, 0.0, 1.0); }
  float rbox(vec2 p, vec2 a, vec2 b, float r) { vec2 c = (a + b) * 0.5, h = (b - a) * 0.5 - r; return sdBox(p - c, h) - r; }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    // 物件座標：整座雪花球（連底座）跳、晃，繞底座底部的中心轉
    vec2 q = p - off - PIV;
    q = rot2(tilt) * q + PIV;

    // ---- 房間：牆（燈在左上，一大片暖光）＋桌面
    vec2 lampP = vec2(260.0, -120.0);
    float lampD = length(p - lampP);
    vec3 wall = C_INK2 * 0.55 + C_SIGNAL * 0.05 * exp(-lampD / 650.0) + C_GRAPHITE * 0.02 * (1.0 - p.y / 1080.0);
    // 雪花球在牆上的影子（燈在左前方 → 影子在右後方，很糊）
    float sh = exp(-pow(length((p - vec2(${C.x + 250}.0, ${C.y + 70}.0)) / vec2(${R + 60}.0, ${R + 120}.0)), 2.0));
    wall *= 1.0 - 0.45 * sh;
    vec3 col = wall;
    // 右後方牆上的一扇窗：窗外也在下雪（跟球裡呼應），雪一直慢慢落，窗框十字、窗台一道光
    vec2 wq = p - vec2(${WIN.x0}.0, ${WIN.y0}.0);
    vec2 wsz = vec2(${WIN.x1 - WIN.x0}.0, ${WIN.y1 - WIN.y0}.0);
    if (wq.x > -14.0 && wq.y > -14.0 && wq.x < wsz.x + 14.0 && wq.y < wsz.y + 22.0) {
      vec3 wc = C_INK2 * 0.35 + C_GRAPHITE * 0.03 * (1.0 - wq.y / wsz.y);
      // 遠處的屋頂剪影與幾盞窗燈
      float roof = wsz.y - 70.0 - 40.0 * step(0.5, fract(floor(wq.x / 90.0) * 0.37)) - 20.0 * sin(wq.x * 0.01);
      if (wq.y > roof) {
        wc = C_INK * 0.6;
        vec2 wg = wq / vec2(9.0, 8.0);
        wc += C_EMBER * 0.07 * step(0.92, hash12(floor(wg))) * step(0.35, fract(wg.x)) * step(0.35, fract(wg.y)) * step(roof + 10.0, wq.y);
      }
      // 兩層雪：近的大、快，遠的小、慢，左右飄
      for (int k = 0; k < 2; k++) {
        float sc = k == 0 ? 26.0 : 15.0, sp = k == 0 ? 60.0 : 32.0;
        vec2 g = (wq + vec2(sin(t * 0.7 + wq.y * 0.01) * 8.0, -t * sp)) / sc;
        vec2 id = floor(g), f = fract(g) - 0.5 - (hash22(id + float(k) * 7.0) - 0.5) * 0.6;
        float r = (k == 0 ? 0.09 : 0.06) * (0.6 + 0.8 * hash12(id + 3.0));
        wc += C_BONE * (k == 0 ? 0.3 : 0.15) * (1.0 - smoothstep(r * 0.6, r, length(f))) * step(0.55, hash12(id + 11.0));
      }
      // 窗框：外框、十字
      float fr = min(min(wq.x, wsz.x - wq.x), min(wq.y, wsz.y - wq.y));
      float cross = min(abs(wq.x - wsz.x * 0.5), abs(wq.y - wsz.y * 0.48));
      if (fr < 0.0 || cross < 5.0) wc = C_INK2 * 0.8 + C_SIGNAL * 0.015 * (1.0 - wq.y / wsz.y);
      if (wq.y > wsz.y && wq.y < wsz.y + 22.0) wc = C_INK2 * 1.1 + C_SIGNAL * 0.03 * (1.0 - smoothstep(wsz.y, wsz.y + 5.0, wq.y));
      col = wc * (1.0 - 0.45 * sh);
    }
    float tableY = ${PL.y1}.0 + off.y * 0.0;
    if (p.y > tableY - 6.0) {
      float g = 0.75 + 0.25 * snoise(vec2(p.x * 0.003, p.y * 0.06));
      vec3 tb = C_INK2 * 0.9 * g + C_SIGNAL * 0.03 * exp(-length(p - vec2(700.0, 1000.0)) / 500.0);
      // 底座在桌上的影子
      float ds = rbox(p - vec2(off.x, 0.0), vec2(${PL.x0}.0 + 40.0, 990.0), vec2(${PL.x1}.0 + 90.0, 1070.0), 30.0);
      tb *= 1.0 - 0.6 * (1.0 - smoothstep(-20.0, 40.0, ds));
      col = mix(col, tb, smoothstep(tableY - 6.0, tableY + 2.0, p.y));
    }

    // ---- 底座（木頭）：正面與上面
    float lightX = 1.0 - 0.45 * smoothstep(${PL.x0}.0, ${PL.x1}.0, q.x);
    float dFront = rbox(q, vec2(${PL.x0}.0, ${PL.y0}.0), vec2(${PL.x1}.0, ${PL.y1}.0), 8.0);
    float grain = 0.7 + 0.3 * snoise(vec2(q.x * 0.0025, q.y * 0.05)) + 0.08 * snoise(vec2(q.x * 0.02, q.y * 0.5));
    vec3 wood = mix(C_INK2 * 1.4, C_BLOOD * 0.12 + C_GRAPHITE * 0.05, 0.5) * grain;
    if (dFront < 1.0) {
      vec3 fc = wood * (0.55 + 0.6 * lightX);
      fc += C_BONE * 0.05 * (1.0 - smoothstep(0.0, 4.0, q.y - ${PL.y0}.0)); // 上緣的一道光
      fc *= 1.0 - 0.3 * smoothstep(${PL.y1}.0 - 60.0, ${PL.y1}.0, q.y);
      col = mix(fc, col, smoothstep(-1.0, 1.0, dFront));
    }
    // 上面（透視下是一條比較亮的斜邊梯形）
    float tw = mix(20.0, 0.0, clamp((q.y - ${PL.top}.0) / ${PL.y0 - PL.top}.0, 0.0, 1.0));
    if (q.y > ${PL.top}.0 && q.y < ${PL.y0}.0 && q.x > ${PL.x0}.0 + tw && q.x < ${PL.x1}.0 - tw) {
      vec3 tc = wood * (1.0 + 0.7 * lightX) + C_SIGNAL * 0.02;
      col = tc;
    }

    // ---- 銘牌：底座正面嵌一塊比較深、比較光滑的木板，四周一圈細細的描金線；
    //      字是刻進木頭再貼金（亮的金色字在深色木頭上，最清楚），凹槽上緣背光、下緣迎光
    float dP = rbox(q, plate.xy, plate.zw, 6.0);
    if (dP < 1.0) {
      vec3 gilt = mix(C_BONE, C_SIGNAL, 0.38) * 0.62;
      float g2 = 0.85 + 0.15 * snoise(vec2(q.x * 0.002, q.y * 0.04));
      vec3 panel = mix(C_INK2 * 1.1, C_BLOOD * 0.07 + C_INK2 * 0.8, 0.5) * g2 * (0.6 + 0.5 * lightX);
      // 燈在光滑的面板上一道斜斜的寬反光
      float refl = exp(-pow((q.x * 0.55 + q.y - 1000.0) / 190.0, 2.0));
      panel += C_BONE * 0.012 * refl + C_SIGNAL * 0.01 * refl;
      // 嵌板的邊：外圈一道暗縫、裡面一圈描金細線
      panel *= 1.0 - 0.6 * (1.0 - smoothstep(-3.0, -0.5, dP)) * step(-3.0, dP);
      float gl = 1.0 - smoothstep(0.6, 1.6, abs(dP + 14.0));
      panel = mix(panel, gilt * (0.55 + 0.5 * lightX), gl * 0.7);
      // 刻字：這一排刻到哪
      float rev = 0.0, heat = 0.0;
      for (int i = 0; i < 8; i++) {
        vec4 rw = rows[i]; vec2 fh = fr[i];
        if (float(i) < nrow && q.y >= rw.y && q.y < rw.w) {
          rev = 1.0 - smoothstep(fh.x - 6.0, fh.x + 6.0, q.x);
          heat = fh.y * exp(-max(0.0, fh.x - q.x) / 160.0) * rev;
        }
      }
      float a = txtA(q) * rev;
      if (a > 0.0) {
        float aUL = txtA(q - vec2(1.0)) * rev, aDR = txtA(q + vec2(1.0)) * rev;
        // 金箔被燈照：左邊亮、右邊暗一點，細細的拉絲
        float sheen = 0.78 + 0.3 * lightX + 0.08 * snoise(vec2(q.x * 0.05, q.y * 0.6));
        vec3 fill = mix(gilt * sheen, C_ROSE * 0.6, clamp(txtHeart(q) / max(a, 1e-3), 0.0, 1.0));
        fill = mix(fill, fill * 0.45, clamp(a - aUL, 0.0, 1.0) * 0.5);  // 凹槽上緣：背光
        fill = mix(fill, fill * 1.35, clamp(a - aDR, 0.0, 1.0) * 0.4);  // 凹槽下緣：迎光
        panel = mix(panel, fill, a);
        panel += (C_SIGNAL * 2.4 * heat + C_EMBER * 1.5 * heat * heat) * heat * a;
      }
      col = mix(panel, col, smoothstep(-1.0, 1.0, dP));
    }

    // ---- 玻璃球
    vec2 d = q - C;
    float r = length(d);
    if (r < R + 2.0) {
      float rr = r / R;
      // 水球是一顆透鏡：中間放大、邊緣壓縮
      vec2 uv = d * mix(0.84, 1.0, rr * rr * rr) / (2.0 * R) + 0.5;
      vec3 in_ = fast(texture(inner, vec2(uv.x, 1.0 - uv.y))).rgb;
      // 大鼓時小屋的窗亮一下（窗的光在貼圖的 a 通道外，用位置判斷太麻煩：整體亮一點點）
      in_ *= 1.0 + 0.06 * kick;
      float fres = pow(rr, 5.0);
      vec3 g = mix(in_, wall * 1.4 + C_BONE * 0.03, fres * 0.7);
      // 燈的反光：左上一大片軟的、一顆小亮點；右邊一道窗形的淡反光
      vec2 hp = C + vec2(-0.42, -0.5) * R;
      g += C_BONE * 0.22 * exp(-dot(q - hp, q - hp) / (2.0 * 55.0 * 55.0));
      g += C_BONE * 0.55 * exp(-dot(q - hp - vec2(8.0, 10.0), q - hp - vec2(8.0, 10.0)) / (2.0 * 9.0 * 9.0));
      float ang = atan(d.y, d.x);
      g += C_BONE * 0.05 * smoothstep(0.72, 0.8, rr) * (1.0 - smoothstep(0.9, 0.95, rr)) * smoothstep(0.15, 0.0, abs(ang + 0.25)) ;
      // 邊緣：一圈細亮線、外面一圈暗
      g += C_BONE * 0.12 * (1.0 - smoothstep(0.0, 2.0, abs(r - R + 2.0)));
      col = mix(g, col, smoothstep(R - 1.0, R + 1.0, r));
      // 球底下接觸底座的地方暗一點（接觸影）
    }
    // 球下面的木頭托座（一段短圓柱：上下是橢圓）：蓋住球的底部
    vec2 cc = q - vec2(${C.x}.0, 0.0);
    float cw = ${Math.round(R * 0.83)}.0;
    float yTop = ${Math.round(C.y + R * 0.87)}.0 + 26.0 * sqrt(max(0.0, 1.0 - cc.x * cc.x / (cw * cw)));
    float yBot = ${PL.top}.0 + 12.0 + 22.0 * sqrt(max(0.0, 1.0 - cc.x * cc.x / (cw * cw)));
    if (abs(cc.x) < cw && q.y > yTop && q.y < yBot) {
      float lx = 0.5 + 0.5 * cos(clamp(cc.x / cw, -1.0, 1.0) * 1.57 + 0.6);
      vec3 cl = wood * (0.4 + 0.9 * lx) + C_BONE * 0.04 * (1.0 - smoothstep(0.0, 3.0, q.y - yTop));
      col = cl;
    }
    col *= kin;
    fragColor = vec4(col, 1.0);
  }`, {
  inner: { value: null }, txt: { value: null }, off: { value: new THREE.Vector2() }, plate: { value: new THREE.Vector4(PLATE.x0, PLATE.y0, PLATE.x1, PLATE.y1) }, tilt: { value: 0 }, t: { value: 0 }, kick: { value: 0 }, kin: { value: 1 },
  rows: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, fr: { value: Array.from({ length: 8 }, () => new THREE.Vector2()) }, nrow: { value: 0 },
});

interface Flake { x: number; y: number; z: number; s: number; up: number; sw: number; om: number; ph: number; T: number; side: number }

export default class SnowGlobe extends Scene {
  bg = shared('snowglobe.bg', BG);
  /** 球裡的雪景（init 畫一次）。 */
  inner = this.track(new Layer2D(2 * R, 2 * R, IS, { fast: true }));
  /** 銘牌上的字模（畫面座標，init 畫一次）。 */
  txt = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 歌詞與小字（每格重畫）。 */
  text = this.track(new Layer2D(W, H, undefined, { fast: true }));
  snow = this.track(new LineBatch(NFLAKE + 120, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(900, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 211 + (this.msg?.id ?? 0) * 7919) >>> 0;
  rows: Row[] = [];
  plate = { ...PLATE };
  /** 煙囪口的高度（畫面座標）。 */
  chimY = 0;
  sizes: number[] = [];
  clock: (i: number) => number = () => 0;
  step = PER;
  rowEnd: number[] = [];
  flakes: Flake[] = [];
  /** 搖晃（小節線）的時間，含窗格開始前的（開場時雪已經在飄）。 */
  shakes: number[] = [];
  hasLyrics = false;
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 56, minSize: 48, maxWidth: LYR.w };
  lyrPos = LYR;
  tFirst = 0;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const sig = m ? sigOf(m) : '';
    const plateText = m ? m.text : COUPLE_ZH;
    await loadText(`${T16_TEXT}${plateText}${sig}${DATE_DOTS}${song.title}${song.artist}${lyrics.linesIn(s - 1, e).map((l) => l.text).join('')}`);
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));

    // ---- 銘牌的字：留言（大）＋署名；沒有留言是新人的名字與日期（小一點，焦點讓給歌詞）
    const c = this.txt.ctx;
    // 字級上限依字數（v2），照標點斷行；扣掉署名那一排再找字級（署名永遠在最後一行下面）
    let fit;
    if (m) {
      const o = { min: V2.msgMin, max: msgMaxFor(m.text), lineHeight: 1.28, maxLines: 5 };
      fit = fitClauses(c, m.text, FAM_MSG, TXT.w, TXT.h - 46, o) ?? fitText(c, m.text, FAM_MSG, TXT.w, TXT.h - 46, o);
    } else fit = fitText(c, plateText, FAM_MSG, TXT.w, 90, { min: 44, max: 56, lineHeight: 1.2, maxLines: 1 });
    const sigSize = sigV2(fit.size);
    const extra = m ? sigSize * 1.5 : 46;
    const blockH = fit.size * 1.02 + (fit.lines.length - 1) * fit.lineHeight + extra;
    const top = TXT.y + Math.max(0, (TXT.h - blockH) / 2);
    this.rows = rowsOf(fit, FAM_MSG, TXT.x + TXT.w / 2, top, 'center');
    this.sizes = this.rows.map(() => fit.size);
    const n0 = glyphCount(this.rows);
    const last = this.rows[this.rows.length - 1]!;
    if (m) {
      c.font = font(F.ming(400), sigSize);
      const sw = c.measureText(sig).width;
      const right = Math.min(TXT.x + TXT.w, Math.max(...this.rows.map((r) => r.x + r.width)) + 20);
      const lay = rowsOf({ size: sigSize, lines: [sig], lineHeight: sigSize, width: sw, height: sigSize }, F.ming(400), right - sw, 0)[0]!;
      this.rows.push({ ...lay, y: last.y + fit.size * 0.3 + sigSize * 1.2, glyphs: lay.glyphs.map((g, k) => ({ ...g, i: n0 + k })) });
      this.sizes.push(sigSize);
    } else {
      const dl = rowsOf({ size: 26, lines: [DATE_DOTS], lineHeight: 26, width: 0, height: 26 }, F.mono(500), TXT.x + TXT.w / 2, 0, 'center')[0]!;
      this.rows.push({ ...dl, y: last.y + 48, glyphs: dl.glyphs.map((g, k) => ({ ...g, i: n0 + k })) });
      this.sizes.push(26);
    }
    // 銘牌只比字多一點邊（v2：容器要輕）：以原本的中心為準，寬高照這塊字（含署名）加邊距，最大就是原本那塊
    {
      const x0 = Math.min(...this.rows.map((r) => r.x)), x1 = Math.max(...this.rows.map((r) => r.x + r.width));
      const y0 = this.rows[0]!.y - this.sizes[0]! * 1.05, y1 = this.rows[this.rows.length - 1]!.y + this.sizes[this.sizes.length - 1]! * 0.35;
      const cx = (PLATE.x0 + PLATE.x1) / 2, cy = (PLATE.y0 + PLATE.y1) / 2;
      const hw = clamp((x1 - x0) / 2 + 56, 240, (PLATE.x1 - PLATE.x0) / 2), hh = clamp((y1 - y0) / 2 + 34, 70, (PLATE.y1 - PLATE.y0) / 2);
      this.plate = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
    }
    // 字模：白字畫在畫面座標上（shader 用 alpha 當刻痕的深淺）
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgb(255,255,255)';
    c.textBaseline = 'alphabetic';
    this.rows.forEach((r, ri) => {
      const size = this.sizes[ri]!;
      const fam = ri < fit.lines.length ? FAM_MSG : m ? F.ming(400) : F.mono(500);
      c.font = font(fam, size);
      if (!m && ri === this.rows.length - 1) c.letterSpacing = '6px';
      for (const g of r.glyphs) {
        if (g.ch === '♥') { drawHeart(c, r.x + g.x + g.w / 2, r.y - size * 0.36, Math.min(g.w, size) * 0.8, 'rgb(255,0,0)'); continue; }
        c.fillText(g.ch, r.x + g.x, r.y);
      }
      c.letterSpacing = '0px';
    });
    this.txt.upload();

    // ---- 刻字的時間：第一拍開始刻，字多就刻快（最多兩小節或窗格的四成）；署名停半拍再刻
    const n = n0;
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    const maxDur = Math.max(0.8, Math.min(2 * bar, 0.4 * (e - this.tFirst)));
    this.step = Math.min(PER, maxDur / Math.max(1, n));
    const base = charClock(n, this.tFirst, PER, maxDur);
    const sigAt = this.tFirst + n * this.step + beat * 0.5;
    this.clock = (i: number) => (i < n ? base(i) : sigAt + (i - n) * Math.min(0.06, this.step));
    this.rowEnd = this.rows.map((r) => this.clock(r.glyphs[r.glyphs.length - 1]!.i) + this.step);

    // ---- 歌詞：有留言時小一級在右上；沒有留言時放大
    if (m) this.lyrStyle = { family: FAM_LYR, size: lyricV2(fit.size), minSize: V2.lyrMin, maxWidth: LYR.w };
    else { this.lyrStyle = { family: FAM_LYR, size: lyricV2(null), minSize: V2.lyrMin, maxWidth: LYR_BIG.w, lineHeight: 1.16 }; this.lyrPos = LYR_BIG; }

    // ---- 球裡的雪景
    this.drawInner();
    const hb = this.groundY(C.x - 110) + 6;
    this.chimY = C.y + (hb - 72 - 56 - C.y) * 1.06;

    // ---- 雪花：停在雪地上的位置、被甩起來多高、左右擺多大、多久落回去
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    for (let i = 0; i < NFLAKE; i++) {
      const x = C.x + (rnd(i, 1) * 2 - 1) * R * 0.86;
      const z = rnd(i, 2) * 2 - 1;
      this.flakes.push({
        x, y: this.groundY(x) - rnd(i, 3) * 8, z,
        s: 1.6 + rnd(i, 4) ** 2 * 3.6 + (z > 0.7 ? 3 : 0),
        up: R * (0.14 + 0.36 * rnd(i, 5)),
        sw: 30 + 90 * rnd(i, 6),
        om: 1.2 + 2.2 * rnd(i, 7),
        ph: rnd(i, 8) * TAU,
        T: 1.6 + 2.6 * rnd(i, 9),
        side: rnd(i, 10) < 0.5 ? -1 : 1,
      });
    }
    // 窗格開始前 8 秒內的小節線也算（開場時雪已經在飄），之後每個小節線搖一下
    for (let b = Math.floor(au.barAt(s - 8)); ; b++) {
      const tb = au.timeOfBar(b);
      if (tb >= e) break;
      if (tb > s - 8) this.shakes.push(tb);
      if (this.shakes.length > 80) break;
    }
    if (!this.shakes.some((x) => x >= s - 0.05)) this.shakes.push(this.tFirst);
  }

  /** 球裡雪地的高度（畫面座標）。 */
  private groundY(x: number) {
    const u = (x - C.x) / R;
    return C.y + R * 0.46 - 26 * Math.cos(u * 1.4) + 10 * Math.sin(u * 5.1 + 1);
  }

  /** 球裡的小雪景：夜色、雪地、小屋（窗裡亮燈）、兩棵松樹、一盞路燈。畫在 2R × 2R 的貼圖上（球心在正中）。 */
  private drawInner() {
    const c = this.inner.ctx, S = 2 * R;
    const k = 0.9; // 透鏡放大：貼圖上的東西畫小一點，放大後剛好對到畫面座標
    const X = (x: number) => R + (x - C.x) * k, Y = (y: number) => R + (y - C.y) * k;
    // 水裡的夜色：上暗下稍亮
    const g = c.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, mixRgba('ink', 'ink2', 0.6)); g.addColorStop(0.65, mixRgba('ink2', 'graphite', 0.25)); g.addColorStop(1, rgba('ink2'));
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    // 遠方的一點暖光（小屋後面）
    const rg = c.createRadialGradient(X(C.x - 40), Y(C.y + 60), 10, X(C.x - 40), Y(C.y + 60), 260);
    rg.addColorStop(0, rgba('signal', 0.16)); rg.addColorStop(1, rgba('signal', 0));
    c.fillStyle = rg; c.fillRect(0, 0, S, S);
    // 松樹（兩棵並排、一高一矮，靠在一起）
    const tree = (x: number, base: number, h: number, w: number) => {
      c.fillStyle = mixRgba('ink2', 'graphite', 0.45);
      c.fillRect(X(x) - 4, Y(base) - 10, 8, 14);
      for (let i = 0; i < 4; i++) {
        const y0 = base - 8 - i * h * 0.2, ww = w * (1 - i * 0.2);
        c.fillStyle = mixRgba('ink2', 'graphite', 0.35 + i * 0.05);
        c.beginPath(); c.moveTo(X(x - ww / 2), Y(y0)); c.lineTo(X(x + ww / 2), Y(y0)); c.lineTo(X(x), Y(y0 - h * 0.36)); c.closePath(); c.fill();
        // 枝上的雪
        c.strokeStyle = rgba('bone', 0.75); c.lineWidth = 3; c.lineCap = 'round';
        c.beginPath(); c.moveTo(X(x - ww * 0.42), Y(y0 - 3)); c.lineTo(X(x - ww * 0.12), Y(y0 - h * 0.13)); c.stroke();
      }
    };
    tree(C.x + 120, this.groundY(C.x + 120) + 4, 150, 92);
    tree(C.x + 185, this.groundY(C.x + 185) + 6, 118, 76);
    // 小屋
    const hx = C.x - 110, hb = this.groundY(C.x - 110) + 6, hw = 124, hh = 72;
    c.fillStyle = mixRgba('ink2', 'graphite', 0.55);
    c.fillRect(X(hx - hw / 2), Y(hb - hh), hw * k, hh * k);
    // 屋頂（積雪）
    c.fillStyle = mixRgba('ink2', 'graphite', 0.3);
    c.beginPath(); c.moveTo(X(hx - hw / 2 - 14), Y(hb - hh)); c.lineTo(X(hx), Y(hb - hh - 62)); c.lineTo(X(hx + hw / 2 + 14), Y(hb - hh)); c.closePath(); c.fill();
    c.strokeStyle = rgba('bone', 0.85); c.lineWidth = 7; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(X(hx - hw / 2 - 12), Y(hb - hh - 2)); c.lineTo(X(hx), Y(hb - hh - 62)); c.lineTo(X(hx + hw / 2 + 12), Y(hb - hh - 2)); c.stroke();
    // 煙囪
    c.fillStyle = mixRgba('ink2', 'graphite', 0.5);
    c.fillRect(X(hx + 26), Y(hb - hh - 56), 14 * k, 30 * k);
    // 窗（亮燈）與門
    const win = (x: number, y: number, w: number, h: number) => {
      const wg = c.createRadialGradient(X(x + w / 2), Y(y + h / 2), 2, X(x + w / 2), Y(y + h / 2), 70);
      wg.addColorStop(0, rgba('signal', 0.35)); wg.addColorStop(1, rgba('signal', 0));
      c.fillStyle = wg; c.fillRect(X(x) - 70, Y(y) - 70, w * k + 140, h * k + 140);
      c.fillStyle = mixRgba('signal', 'ember', 0.4); c.fillRect(X(x), Y(y), w * k, h * k);
      c.fillStyle = mixRgba('ink2', 'graphite', 0.55); c.fillRect(X(x + w / 2) - 1.5, Y(y), 3, h * k); c.fillRect(X(x), Y(y + h / 2) - 1.5, w * k, 3);
    };
    win(hx - 44, hb - hh + 16, 26, 24);
    c.fillStyle = mixRgba('ink', 'ink2', 0.5); c.fillRect(X(hx + 14), Y(hb - 42), 22 * k, 42 * k);
    // 路燈
    const lx = C.x - 215, lb = this.groundY(lx);
    c.strokeStyle = mixRgba('ink2', 'graphite', 0.5); c.lineWidth = 4;
    c.beginPath(); c.moveTo(X(lx), Y(lb)); c.lineTo(X(lx), Y(lb - 120)); c.stroke();
    const lg = c.createRadialGradient(X(lx), Y(lb - 124), 1, X(lx), Y(lb - 124), 60);
    lg.addColorStop(0, rgba('ember', 0.9)); lg.addColorStop(0.15, rgba('signal', 0.45)); lg.addColorStop(1, rgba('signal', 0));
    c.fillStyle = lg; c.beginPath(); c.arc(X(lx), Y(lb - 124), 60, 0, TAU); c.fill();
    // 雪地（蓋住樹根與屋底）
    c.fillStyle = mixRgba('bone', 'ash', 0.45);
    c.beginPath(); c.moveTo(0, S);
    for (let x = C.x - R; x <= C.x + R; x += 6) c.lineTo(X(x), Y(this.groundY(x)));
    c.lineTo(S, S); c.closePath(); c.fill();
    // 雪地上被路燈與窗照亮的一片
    const sg = c.createRadialGradient(X(C.x - 150), Y(C.y + 150), 5, X(C.x - 150), Y(C.y + 150), 200);
    sg.addColorStop(0, rgba('signal', 0.18)); sg.addColorStop(1, rgba('signal', 0));
    c.fillStyle = sg; c.fillRect(0, Y(this.groundY(C.x)) - 40, S, S);
    // 雪地往下漸暗（球底）
    const bg2 = c.createLinearGradient(0, Y(C.y + R * 0.45), 0, S);
    bg2.addColorStop(0, 'rgba(0,0,0,0)'); bg2.addColorStop(1, rgba('ink', 0.7));
    c.fillStyle = bg2; c.fillRect(0, 0, S, S);
    this.inner.upload();
  }

  /** 整座雪花球在 t 的位移與傾斜：最近一次小節線那一「跳」（往上蹬、落下、晃兩下）。 */
  private hop(t: number): { x: number; y: number; tilt: number } {
    let last = -Infinity, idx = 0;
    this.shakes.forEach((tb, i) => { if (tb <= t) { last = tb; idx = i; } });
    if (last === -Infinity) return { x: 0, y: 0, tilt: 0 };
    const u = t - last;
    const side = idx % 2 === 0 ? 1 : -1;
    const up = u < 0.26 ? Math.sin((Math.PI * u) / 0.26) : 0;
    const bounce = u >= 0.26 ? 0.22 * Math.abs(Math.sin((Math.PI * (u - 0.26)) / 0.14)) * Math.exp(-(u - 0.26) / 0.12) : 0;
    const y = -16 * up - 16 * bounce;
    const wob = Math.sin(u * 30) * Math.exp(-u / 0.25) * (u > 0.2 ? 1 : 0);
    return { x: side * 7 * Math.sin(Math.PI * clamp(u / 0.26)) + wob * 3 * side, y, tilt: side * (0.012 * Math.sin(Math.PI * clamp(u / 0.26)) + 0.006 * wob) };
  }

  /** 雪花 i 在 t 的位置（畫面座標，不含整座的位移）：停的位置＋每一次搖晃的反應（往上甩、左右擺、慢慢落回）疊加。 */
  private flakeAt(f: Flake, t: number, i: number) {
    let dx = 0, dy = 0;
    for (let k = 0; k < this.shakes.length; k++) {
      const tau = t - this.shakes[k]!;
      if (tau < 0) break;
      if (tau > 12) continue;
      const h = hash(this.seed, i, k);
      const rise = 1 - Math.exp(-tau / 0.13);
      const fall = Math.exp(-tau / f.T);
      const s = 0.7 + 0.5 * h;
      dy -= f.up * s * rise * fall;
      dx += (f.sw * Math.sin(f.om * tau + f.ph + h * 3) * rise * Math.exp(-tau / (f.T * 0.9)) + f.side * (k % 2 ? -1 : 1) * 60 * rise * Math.exp(-tau / 0.5)) * s;
    }
    let x = f.x + dx, y = f.y + dy;
    // 關在球裡：離球心越遠越推不動（軟的邊界，不會整圈貼在玻璃上）；落到雪地就停在雪地上
    const rx = x - C.x, ry = y - C.y, rr = Math.hypot(rx, ry), a0 = R * 0.55, lim = R * 0.92;
    if (rr > a0) { const r2 = a0 + (lim - a0) * Math.tanh((rr - a0) / (lim - a0)); x = C.x + (rx / rr) * r2; y = C.y + (ry / rr) * r2; }
    const gy = this.groundY(x);
    if (y > gy) y = gy;
    return { x, y, air: clamp((gy - y) / 24) };
  }

  /**
   * 球裡小屋的煙囪冒煙：每 0.2 秒一團，往上飄、慢慢變大變淡，往一邊斜（很淡的灰，不發光）。
   * 每團的位置只由它出生的時間決定（確定性）。
   */
  private smoke(lb: LineBatch, t: number, xf: (x: number, y: number) => { x: number; y: number }, kin: number) {
    const dt = 0.2, life = 2.4, A = LIN.ash;
    const top = this.chimY;
    for (let n = Math.floor((t - life) / dt); n <= Math.floor(t / dt); n++) {
      const age = t - n * dt;
      if (age < 0 || age > life) continue;
      const u = age / life;
      const x = CHIM.x + 22 * u + 7 * Math.sin(age * 2.2 + n) * u;
      const y = top - 42 * age - 6 * u * u;
      // 球裡：碰到上面的玻璃就不畫了
      if (Math.hypot(x - C.x, y - C.y) > R * 0.9) continue;
      const q = xf(x, y);
      const a = 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.4)) * kin;
      lb.seg2(q.x, q.y, q.x + 0.01, q.y, 6 + 18 * u, [A[0] * 0.8, A[1] * 0.8, A[2] * 0.8], a);
    }
  }

  /** 底座右側的發條鑰匙：每一拍轉四分之一圈（落在拍點、回彈一下）；轉的時候從側面看，翼片的高度跟著 cos 變。 */
  private drawKey(c: CanvasRenderingContext2D, t: number, xf: (x: number, y: number) => { x: number; y: number }) {
    const au = this.ctx.audio;
    const bi = au.beatAt(t), k = Math.floor(bi), u = bi - k;
    const ang = (k + ease.outBack(clamp(u / 0.35), 1.6)) * (Math.PI / 2);
    const h = Math.abs(Math.cos(ang));
    const p0 = xf(KEY.x, KEY.y), p1 = xf(KEY.x + 26, KEY.y), p2 = xf(KEY.x + 78, KEY.y);
    c.save();
    c.lineCap = 'round';
    // 軸
    c.strokeStyle = mixRgba('graphite', 'ash', 0.35); c.lineWidth = 9;
    c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
    // 翼片：一片平的蝴蝶形鐵片接在軸的尾端（上下兩個圓耳、中間一個轂）；轉到側面時整片壓成一條線
    const metal = mixRgba('graphite', 'ash', 0.6), edge = mixRgba('ink2', 'graphite', 0.3);
    const cx = p1.x + 22, cy = p1.y;
    c.fillStyle = metal; c.strokeStyle = edge; c.lineWidth = 2;
    c.beginPath();
    c.ellipse(cx, cy - 26 * h, 20, Math.max(1.2, 17 * h), 0, 0, Math.PI * 2);
    c.ellipse(cx, cy + 26 * h, 20, Math.max(1.2, 17 * h), 0, 0, Math.PI * 2);
    c.fill(); c.stroke();
    c.beginPath(); c.ellipse(cx, cy, 11, Math.max(2, 13 * h), 0, 0, Math.PI * 2); c.fill(); c.stroke();
    // 耳上的孔（正對鏡頭時才看得到）
    c.fillStyle = rgba('ink', 0.7 * h);
    for (const sgn of [-1, 1]) { c.beginPath(); c.ellipse(cx, cy + sgn * 28 * h, 7, Math.max(0.5, 6 * h), 0, 0, Math.PI * 2); c.fill(); }
    // 高光：翼片正對燈的時候亮一下
    c.fillStyle = rgba('bone', 0.3 * h * h);
    c.beginPath(); c.ellipse(cx - 8, cy - 36 * h, 6, Math.max(0.5, 4 * h), 0, 0, Math.PI * 2); c.fill();
    void p2;
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const hp = this.hop(t);
    const kin = prog(t, s, s + 0.2);
    (u.off!.value as THREE.Vector2).set(hp.x, hp.y);
    u.tilt!.value = hp.tilt;
    u.t!.value = t; u.kick!.value = f.a.kick; u.kin!.value = kin;
    u.inner!.value = this.inner.texture; u.txt!.value = this.txt.texture;
    (u.plate!.value as THREE.Vector4).set(this.plate.x0, this.plate.y0, this.plate.x1, this.plate.y1);
    // 銘牌上每一排刻到哪
    const rows = u.rows!.value as THREE.Vector4[], fr = u.fr!.value as THREE.Vector2[];
    u.nrow!.value = Math.min(8, this.rows.length);
    let pen: { x: number; y: number } | null = null;
    this.rows.slice(0, 8).forEach((r, i) => {
      const size = this.sizes[i]!;
      rows[i]!.set(r.x - 20, r.y - size * 1.02, r.x + r.width + 20, r.y + size * 0.24);
      const a = this.clock(r.glyphs[0]!.i);
      const done = t >= this.rowEnd[i]!;
      const front = done ? 5000 : r.x + rowFront(r, t, this.clock, this.step);
      const heat = t < a ? 0 : done ? Math.exp(-(t - this.rowEnd[i]!) / 0.4) : 1;
      fr[i]!.set(done ? r.x + r.width + 400 * (1 - heat) + 1 : front, heat);
      if (t >= a && !done) pen = { x: front, y: r.y - size * 0.32 };
    });
    this.bg.render(renderer, out);

    // 整座雪花球（跳、晃）的座標轉換：雪、煙、鑰匙、火花都跟著它
    const cs = Math.cos(hp.tilt), sn = Math.sin(hp.tilt);
    const xf = (x: number, y: number) => {
      const dx = x - C.x, dy = y - PL.y1;
      return { x: C.x + cs * dx - sn * dy + hp.x, y: PL.y1 + sn * dx + cs * dy + hp.y };
    };
    // ---- 歌詞（右上方暗處）
    const L = this.text; L.clear();
    const c = L.ctx;
    c.globalAlpha = kin;
    this.drawKey(c, t, xf);
    if (this.hasLyrics) {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        c.save(); c.translate(this.lyrPos.x, this.lyrPos.y);
        drawLyric(c, ly.line, t, this.lyrStyle, layoutLyric(c, ly.line, this.lyrStyle), ly.k);
        c.restore();
      }
    } else {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.6);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y);
      c.letterSpacing = '0px';
    }
    if (!this.msg) {
      const ik = prog(t, this.tFirst + 0.8, this.tFirst + 1.4);
      if (ik > 0) {
        c.font = font(F.hei(500), 24); c.letterSpacing = '3px'; c.fillStyle = rgba('bone', 0.5 * ik);
        c.fillText(T16_INVITE, this.lyrPos.x, this.hasLyrics ? WIN.y0 - 34 : this.lyrPos.y + 50);
        c.letterSpacing = '0px';
      }
    }
    comp.draw(renderer, L.upload(), out);

    // ---- 雪花（跟著整座一起跳）
    const sb = this.snow; sb.clear();
    const B = LIN.bone;
    this.smoke(sb, t, xf, kin);
    this.flakes.forEach((fl, i) => {
      const p = this.flakeAt(fl, t, i);
      if (p.air < 0.02) return;
      const q = xf(p.x, p.y);
      const near = fl.z > 0.7;
      const a = (near ? 0.35 : 0.55 + 0.4 * (fl.z * 0.5 + 0.5)) * p.air * kin;
      const k = near ? 0.85 : 0.75 + 0.2 * (fl.z * 0.5 + 0.5);
      sb.seg2(q.x, q.y, q.x + 0.01, q.y + 0.6, fl.s, [B[0] * k, B[1] * k, B[2] * k], a);
    });
    if (sb.count) sb.render(renderer, out);

    // ---- 刻字的火花
    this.glow.clear();
    const pp = pen as { x: number; y: number } | null;
    if (pp) {
      const head = xf(pp.x, pp.y);
      sparkParticles(this.glow, t, (tt) => (tt > t - 0.5 ? head : null), { rate: 90, life: 0.3, speed: 200, seed: this.seed % 997 });
      sparkHead(this.glow, head.x, head.y, t, 0.8);
      this.glow.render(renderer, out);
    }
    // 鏡頭：切進來時貼得比較近、第一拍退到定位（落定），之後整個窗格慢慢推近
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tFirst + 0.15)));
    return { bloom: 0.7, vignette: 0.6, halation: 0.25, zoom: 1 + 0.05 * (1 - land) + 0.03 * ease.inOutQuad(f.p) };
  }
}
