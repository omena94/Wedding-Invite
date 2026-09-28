// 郵票（亮）：一只信封上貼著一張很大的郵票，鏡頭從斜上方看著它。
//  - 郵票：齒孔（四邊一排半圓的缺口）、細線框；右邊是一幅版畫（一條彎彎的路往地平線上的太陽延伸，天空是放射的刻線、
//    山是交叉的刻線），左邊是郵票上的字＝主打留言（思源宋體，跟版畫同一個油墨色）。左上角是面值「∞」、上緣一行「愛情郵政」。
//    第一拍起留言一個字一個字印上去（剛印的油墨濕濕的、一下就乾）。
//  - 郵票下面連著一條邊紙（中間隔一排齒孔），邊紙上印的是歌詞，照跟唱規則逐字變色；郵票框的角落一個小小的版號。
//  - 郵戳在拍點蓋下：第一個小節線（留言開始印之後），郵戳的影子從上面壓過來、「砰」地蓋在郵票右上角與信封上
//    （圓形日戳＋往右的波浪線，油墨有斑駁），畫面一震。之後每個小節線鏡頭換一個角度（快、落在小節線上）。
//  - 沒有留言：郵票上印新人的名字與日期（比歌詞小），邊紙的歌詞放大是主角；信封上一行小字邀請。
// 手法：信封、郵票的紙與齒孔、版畫、油墨都在一個 shader（PlaneCam：信封是空間裡的平面）。郵票上的字是 init() 畫好的資料貼圖
// （_t25 glyphMask，依序印出）；郵票的框與小字、郵戳各是一張 init 畫一次的 Canvas；邊紙的歌詞是每格重畫的一張。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, pulse } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, lyricSizeFor, COUPLE_ZH, DATE_DOTS, type LyricStyle } from './_motifs';
import { PlaneCam, camUniforms, CAM_GLSL } from './_t14';
import {
  T25_TEXT, T25_INVITE, sigOf, winBars, winBeats, stagger, layMsg, msgGlyphs, glyphMask, paperLyric, MASK_GLSL,
  type GlyphMask, type MsgLay, type Rect,
} from './_t25';

export const spec: PlateSpecDecl = { group: 'type', family: 'journey', paper: true, energy: [0.15, 0.85], bars: [4, 8] };

/** 郵票（含齒孔的外緣）、邊紙、郵票裡的版畫與字的範圍（頁面座標）。 */
const ST = { x: 236, y: 112, w: 1180, h: 704 };
const SELV = { y0: 816, y1: 968 };
const PERF = 30; // 齒孔間距
const IMG = { x: 1060, y: 176, w: 300, h: 576 };
const TXT = { x: 306, y: 232, w: 716, h: 510 };
const LYR = { x: 306, y: 922, w: 1020 };
/** 郵戳：圓心與半徑；波浪線往右延伸。 */
const PM = { x: 1330, y: 250, r: 132 };
const PM_RECT: Rect = [PM.x - 170, PM.y - 170, 900, 340];
const FAM_MSG = F.ming(900);
const FAM_LYR = F.archivo(100, 800);
const COUNTRY = '愛情郵政　·　LOVE POST';
const PM_TOP = '幸福郵局', PM_BOT = '永遠有效';
const PLATE = 'A 0313';

const BG = () => new FSPass(/* glsl */ `
  uniform float t;
  uniform sampler2D st; uniform sampler2D ly; uniform sampler2D pm; uniform float pmK; uniform float pmShadow;
  uniform sampler2D mm; uniform vec4 mmR; uniform float shown; uniform float hasMsg;
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
      // 天空：從太陽放射出去的刻線（越往上越密越暗）
      vec2 d = u - sun;
      float ang = atan(d.y * IM.w, d.x * IM.z);
      float rays = hatch(ang * 22.0, 0.25 + 0.45 * smoothstep(0.1, 0.9, length(d * vec2(1.0, 1.6))));
      float r = length((u - sun) * IM.zw);
      ink = r < 52.0 ? 0.0 : rays * smoothstep(52.0, 70.0, r);
      ink = max(ink, 1.0 - smoothstep(0.8, 2.0, abs(r - 58.0))); // 太陽的外圈
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
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  mm: GlyphMask | null = null;
  mmRect: Rect = [0, 0, 1, 1];
  lay: MsgLay | null = null;
  times: number[] = [];
  bars: number[] = [];
  tFirst = 0;
  tStrike = 0;
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 52, minSize: 48, maxWidth: LYR.w, tracking: 2, ...paperLyric() };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 0.5, e + 0.5);
    await loadText(`${T25_TEXT}${COUNTRY}${PM_TOP}${PM_BOT}${PLATE}∞郵資${m?.text ?? ''}${m ? sigOf(m) : ''}${lines.map((l) => l.text).join('')}${song.title}`);
    const bar = au.timeOfBar(au.barAt(s) + 1) - au.timeOfBar(au.barAt(s));
    const beat = au.beatPeriod(s);
    this.tFirst = winBeats(au, s + 0.1, e)[0] ?? s + 0.2;
    this.bars = winBars(au, s, e);
    // 郵戳：第一拍之後至少兩拍的第一個小節線；窗格短就在第三拍
    this.tStrike = this.bars.find((b) => b >= this.tFirst + beat * 1.9) ?? (winBeats(au, s, e)[2] ?? this.tFirst + beat * 2);

    // ---- 郵票上的字
    const c = document.createElement('canvas').getContext('2d')!;
    const text = m ? m.text : COUPLE_ZH;
    const sig = m ? sigOf(m) : DATE_DOTS;
    this.lay = layMsg(c, text, sig, FAM_MSG, TXT, { min: m ? 50 : 44, max: m ? 150 : (lyrics.has ? 64 : 110), lineHeight: 1.3, maxLines: 5, sigFamily: F.ming(700), sigSize: [34, 46], align: 'left', fewer: 0.62 });
    const items = msgGlyphs(this.lay);
    this.mmRect = [TXT.x - 30, TXT.y - 30, TXT.w + 60, TXT.h + 60];
    this.mm = this.track(glyphMask(items, this.mmRect, 1, 2));
    const maxDur = Math.max(0.8, Math.min(1.6 * bar, 0.45 * (e - this.tFirst)));
    this.times = stagger(au, this.tFirst, items.length, maxDur);
    if (m) this.lyrStyle = { ...this.lyrStyle, size: lyricSizeFor(this.lay.fit.size) };
    else this.lyrStyle = { ...this.lyrStyle, size: 76, minSize: 52 };

    // ---- 郵票的框、面值、國名、邊紙的版號；信封上的邀請（沒有留言）
    const g = this.st.ctx;
    this.st.clear();
    const ink = rgba('blood');
    g.strokeStyle = ink; g.lineWidth = 2;
    g.strokeRect(ST.x + 34, ST.y + 34, ST.w - 68, ST.h - 68);
    g.lineWidth = 1;
    g.strokeRect(ST.x + 42, ST.y + 42, ST.w - 84, ST.h - 84);
    g.fillStyle = ink;
    g.font = font(F.serif(600), 58); g.fillText('∞', TXT.x, TXT.y - 6);
    g.font = font(F.hei(500), 20); g.letterSpacing = '6px';
    g.fillText('郵資', TXT.x + 64, TXT.y - 16);
    g.fillText(COUNTRY, TXT.x + 190, TXT.y - 16);
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
      const lay = layoutLyric(c, ly.line, this.lyrStyle);
      c.save(); c.translate(LYR.x, LYR.y - (lay.height - lay.size));
      drawLyric(c, ly.line, t, this.lyrStyle, lay, ly.k);
      c.restore();
    } else if (!lyrics.linesIn(s, e).length) {
      c.font = font(FAM_LYR, 48); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.8 * prog(t, s, s + 0.5));
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
    this.bg.render(renderer, out);

    const hitK = pulse(t, this.tStrike, 0.07);
    const box = this.lay?.box;
    return {
      paper: 1, bloom: 0.3, vignette: 0.42, grain: 0.05,
      shake: [hitK * 2, hitK * 5],
      zoom: 1 + hitK * 0.012,
      popupAvoid: box ? [this.cam.screenRect(box, 10)] : [],
    };
  }
}
