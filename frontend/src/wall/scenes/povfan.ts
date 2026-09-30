// 旋轉 LED 扇（暗、雙語）：暗暗的展示間裡，一支高腳架頂著一台全像 LED 扇（三片裝了 LED 燈條的扇葉），轉得太快看不到扇葉，
// 只看到它在空中「畫」出來的圖：圓心是馬達，中文在馬達上面、原文小一號在馬達下面，兩行都是一顆一顆的 LED 點。
//  - 字是 LED 點（一圈一圈的同心圓、一欄一欄的放射線，看得到點點的質感），扇葉轉過的地方剛刷新、亮一點，所以整片光一直在
//    「旋轉的微光」裡閃（相機拍 POV 扇的樣子）；每一拍閃光燈一樣照出三片扇葉的殘影。唱到的字是訊號色，唱完是暖白，還沒唱的三成；
//    原文比較安靜（唱到、唱完都是暖白）。換句時扇子「重畫」：新的一句從正上方順時針掃一圈刷出來。
//    大鼓時整片亮一下，每個小節線外圈的一圈燈跑一圈。沒有翻譯的歌：馬達下面只剩一排跟著拍子跳的小燈（不留空的第二行）。
//    純音樂：扇上是新人的名字與日期。
//  - 左上遠一點還有一台吊著的小 LED 扇，轉著一顆愛心（點綴色，跟著大鼓跳），每兩小節換成一圈一圈往外擴的光環。
//  - 主打留言：左下地上一只黑色航空箱（扇子的電源箱，一條電線拖到扇子腳），箱子正面貼著一張大貼紙，留言是用麥克筆寫在貼紙上，
//    第一拍起一個字一個字寫上去。照「留言尺寸與版面比例標準 v2」：字 40～60、署名 26～32、貼紙 ≤ 860 × 430。
//  - 光：上面一盞頂燈往下打（煙裡看得到光錐），扇子的光把煙霧照亮，地板是深色亮面、映著扇子的光；鏡頭慢慢推近。右下角（QR）落在暗處。
// 手法：牆、煙、地板、兩台扇子的 LED 點陣、扇葉殘影、地板倒影是一個全螢幕 shader；扇子要畫的字（有逐字跟唱的顏色）每格畫在
// 一張小的 Canvas 圖層上，shader 取樣之後乘上 LED 點的圖樣；航空箱、貼紙先畫好，貼紙上的字是另一張 Canvas 圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, TAU } from '../engine/util';
import { lyricSubOf, type Line } from '../engine/lyrics';
import { lyricAt, beatAfter, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { sigOf, layMsgV2, stagger, winBars, lastBefore, type MsgLay, type Rect } from './_t23';
import { lyricV2 } from './_v2';
import { B5_TEXT, B5_INVITE, subPx, layBilingual, glyphProgress, type BGlyph, type BLayout } from './_b5';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'light', paper: false, energy: [0.35, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（畫面座標，y 向下）
/** 大扇子：圓心、半徑。 */
const FAN = { x: 1204, y: 420, r: 300 };
/** 小扇子（左上，遠一點，從天花板吊下來）。 */
const FAN2 = { x: 402, y: 238, r: 124 };
const FLOOR = 872;
/** 扇上的字畫在這張小圖上（以大扇子圓心為中心的正方形）。 */
const TX = 720;
/** 馬達上下各空多少（字不要壓到馬達）。 */
const HUB_GAP = 44;
/** 航空箱：左緣、下緣（箱子往上長）。貼紙照留言的大小（v2：≤ 860 × 430）。 */
const CASE = { x: 104, bottom: 1016 };
const FAM_LYR = F.hei(700);
const FAM_MSG = F.hand(700);

const ROOM = () => new FSPass(/* glsl */ `
  uniform sampler2D uTxt; uniform sampler2D uHeart;
  uniform float uT; uniform float uRot; uniform float uRot2; uniform float uKick; uniform float uWipe; uniform float uRing; uniform float uOn;
  uniform float uMode2; uniform float uStrobe; uniform vec3 uCam;
  vec4 txAt(vec2 q) {
    vec2 uv = (q - vec2(${FAN.x}.0, ${FAN.y}.0)) / ${TX}.0 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    return fastLayer(texture(uTxt, vec2(uv.x, 1.0 - uv.y)));
  }
  // LED 點的圖樣：一圈一圈（間距 pitch）× 一欄一欄（每圈 ncol 欄）
  float ledDots(float r, float a, float pitch, float ncol) {
    float rc = (floor(r / pitch) + 0.5) * pitch;
    float af = (a / TAU + 0.5) * ncol;
    float dr = abs(r - rc) / pitch, da = abs(fract(af) - 0.5) * (TAU * r / ncol) / pitch;
    return (1.0 - smoothstep(0.2, 0.5, dr)) * (1.0 - smoothstep(0.22, 0.6, da));
  }
  // 三片扇葉：轉過的地方剛刷新比較亮（相機拍到的旋轉微光）；blade = 扇葉本身（閃光燈照到時看得到）
  float sweep(float a, float rot, float r, float R, out float blade) {
    float sec = fract((a - rot) / (TAU / 3.0));
    blade = smoothstep(0.955, 0.995, sec) * (1.0 - smoothstep(0.995, 1.0, sec)) * smoothstep(R * 0.06, R * 0.2, r) * step(r, R);
    return sec;
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = (sp - vec2(${FAN.x}.0, ${FAN.y}.0 + uCam.y)) / uCam.x + vec2(${FAN.x}.0, ${FAN.y}.0);
    // ---- 牆：深色的吸音板（直條）
    float panel = abs(fract(p.x / 132.0) - 0.5);
    vec3 col = C_INK2 * (0.4 + 0.07 * smoothstep(0.46, 0.5, panel) + 0.05 * fbm(p / 260.0 + uT * 0.02, 3));
    // 頂燈：從上面往下打的光錐（煙裡看得到），照在扇子上
    float cone = exp(-pow((p.x - ${FAN.x}.0) / (60.0 + 0.55 * max(p.y + 60.0, 0.0)), 2.0)) * smoothstep(${FLOOR}.0 + 40.0, 0.0, p.y);
    col += mix(C_BONE, C_SIGNAL, 0.25) * 0.035 * cone * uOn;
    // 扇子的光把煙霧照亮
    float haze = exp(-pow(length((p - vec2(${FAN.x}.0, ${FAN.y}.0)) / vec2(640.0, 480.0)), 2.0));
    col += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.07 * haze * uOn * (0.9 + 0.3 * uKick);
    col += mix(C_BLOOD, C_SIGNAL, 0.4) * 0.03 * exp(-pow(length((p - vec2(${FAN2.x}.0, ${FAN2.y}.0)) / 280.0), 2.0)) * uOn;
    col += C_ASH * 0.02 * smoothstep(-0.2, 0.8, fbm(vec2(p.x * 0.002 - uT * 0.03, p.y * 0.004 + uT * 0.01), 4)) * uOn * (0.4 + cone);
    // ---- 地板：深色亮面，映著扇子的光（倒影糊糊的、往下淡掉）
    if (p.y > ${FLOOR}.0) {
      float dd = (p.y - ${FLOOR}.0) / ${H - FLOOR}.0;
      col = C_INK * (0.55 + 0.25 * dd);
      vec2 m = vec2(p.x + 6.0 * sin(p.y * 0.08), 2.0 * ${FLOOR}.0 - p.y);
      vec3 refl = vec3(0.0);
      for (int k = -1; k <= 1; k++) refl += txAt(m + vec2(float(k) * 8.0, float(k) * 5.0)).rgb;
      col += refl * 0.1 * exp(-dd * 2.5) * uOn;
      col += mix(C_BLOOD, C_SIGNAL, 0.4) * 0.05 * exp(-pow((p.x - ${FAN.x}.0) / 420.0, 2.0)) * exp(-dd * 3.0) * uOn;
    }
    // ---- 腳架：一支細的金屬桿，底下一片圓底座
    float pole = sdSegment(p, vec2(${FAN.x}.0, ${FAN.y}.0), vec2(${FAN.x}.0, ${FLOOR}.0 + 6.0)) - 5.0;
    col = mix(mix(C_GRAPHITE * 0.3, C_ASH * 0.35, smoothstep(-5.0, 5.0, p.x - ${FAN.x}.0 + 2.0)), col, smoothstep(-0.8, 0.8, pole));
    float base = length((p - vec2(${FAN.x}.0, ${FLOOR}.0 + 8.0)) / vec2(92.0, 14.0)) - 1.0;
    col = mix(C_GRAPHITE * 0.28, col, smoothstep(-0.05, 0.05, base));
    float pole2 = sdSegment(p, vec2(${FAN2.x}.0, -20.0), vec2(${FAN2.x}.0, ${FAN2.y}.0)) - 2.5;
    col = mix(C_GRAPHITE * 0.25, col, smoothstep(-0.8, 0.8, pole2));
    // ---- 大扇子
    vec2 d = p - vec2(${FAN.x}.0, ${FAN.y}.0);
    float r = length(d);
    if (r < ${FAN.r}.0 + 8.0) {
      float a = atan(d.y, d.x);
      float dots = ledDots(r, a, 2.9, 1260.0);
      float blade;
      float sec = sweep(a, uRot, r, ${FAN.r}.0, blade);
      float shimmer = 0.8 + 0.25 * pow(sec, 2.5);
      // 換句：新的一句從正上方順時針掃一圈刷出來（掃過去的那條線最亮）
      float ang = fract(atan(d.x, -d.y) / TAU + 1.0);
      float shown = step(ang, uWipe);
      vec4 tx = txAt(p);
      vec3 led = tx.rgb * (0.4 + 0.85 * dots) * 1.9 * shimmer * shown * (1.0 + 0.25 * uKick);
      led += tx.rgb * dots * 2.5 * exp(-pow((uWipe - ang) * 26.0, 2.0)) * step(uWipe, 0.999);
      // 扇葉：平常看不到，每一拍像閃光燈一樣照出來一下
      col = mix(col, C_INK * 0.4 + C_ASH * 0.06, blade * (0.08 + 0.5 * uStrobe));
      col += C_ASH * 0.01 * dots * step(r, ${FAN.r}.0);
      col += led;
      // 外圈一圈燈（每個小節線跑一圈），內圈一圈很淡的點在轉
      float rim = exp(-pow((r - ${FAN.r}.0 - 1.0) / 2.2, 2.0));
      float run = exp(-pow(fract(ang - uRing) * 9.0, 2.0)) * step(0.0, uRing) * (1.0 - smoothstep(0.9, 1.4, uRing));
      col += mix(C_SIGNAL, C_EMBER, 0.4) * rim * (0.12 + 1.8 * run) * uOn;
      float ring2 = exp(-pow((r - ${FAN.r}.0 * 0.93) / 1.8, 2.0)) * step(0.72, fract(ang * 48.0 - uT * 0.6));
      col += mix(C_SIGNAL, C_EMBER, 0.4) * 0.18 * ring2 * uOn;
      // 馬達
      col = mix(mix(C_INK * 0.5, C_ASH * 0.3, smoothstep(16.0, 20.0, r)), col, smoothstep(20.0, 22.0, r));
    }
    // ---- 小扇子：遠一點（點比較大、比較暗），轉著愛心或一圈一圈的光環
    vec2 d2 = p - vec2(${FAN2.x}.0, ${FAN2.y}.0);
    float r2 = length(d2);
    if (r2 < ${FAN2.r}.0 + 4.0) {
      float a2 = atan(d2.y, d2.x);
      float dots = ledDots(r2, a2, 4.4, 440.0);
      vec3 e;
      if (uMode2 < 0.5) {
        vec2 hq = rot2(0.25 * sin(uT * 0.9)) * d2 / (1.0 + 0.1 * uKick);
        vec2 huv = hq / (${FAN2.r}.0 * 1.7) + 0.5;
        vec4 hh = (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) ? fastLayer(texture(uHeart, vec2(huv.x, 1.0 - huv.y))) : vec4(0.0);
        e = hh.rgb * 1.5;
      } else {
        float ring = exp(-pow(fract(r2 / 36.0 - uT * 1.2) * 6.0 - 3.0, 2.0));
        e = mix(C_SIGNAL, C_EMBER, 0.4) * ring * 0.85;
      }
      float blade;
      float sec = sweep(a2, uRot2, r2, ${FAN2.r}.0, blade);
      col = mix(col, C_INK * 0.4, blade * (0.05 + 0.3 * uStrobe));
      col += e * (0.35 + 0.8 * dots) * (0.8 + 0.25 * pow(sec, 2.5)) * uOn * step(r2, ${FAN2.r}.0);
      col += mix(C_SIGNAL, C_EMBER, 0.4) * 0.08 * exp(-pow((r2 - ${FAN2.r}.0) / 2.0, 2.0)) * uOn;
      col = mix(C_INK * 0.55, col, smoothstep(9.0, 11.0, r2));
    }
    // 右下角（QR 與小字）：暗處
    col *= 1.0 - 0.75 * smoothstep(1250.0, 1480.0, sp.x) * smoothstep(730.0, 880.0, sp.y);
    fragColor = vec4(col, 1.0);
  }`, {
  uTxt: { value: null }, uHeart: { value: null }, uT: { value: 0 }, uRot: { value: 0 }, uRot2: { value: 0 }, uKick: { value: 0 }, uWipe: { value: 1 }, uRing: { value: -1 },
  uOn: { value: 1 }, uMode2: { value: 0 }, uStrobe: { value: 0 }, uCam: { value: new THREE.Vector3(1, 0, 0) },
});

/** 扇上要畫的一句（或純音樂的名字與日期）：主行（馬達上面）、原文（馬達下面）、從什麼時候開始刷出來、到什麼時候。 */
interface Page { main: BLayout; sub: BLayout | null; t0: number; t1: number; fake: boolean }

export default class PovFan extends Scene {
  room = shared('povfan.room', ROOM);
  txt = this.track(new Layer2D(TX, TX, 1, { fast: true }));
  heart = this.track(new Layer2D(256, 256, 1, { fast: true }));
  L = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 223 + (this.msg?.id ?? 0) * 41) >>> 0;
  lay: MsgLay | null = null;
  gT: number[] = [];
  tOn = 0;
  bars: number[] = [];
  pages: Page[] = [];
  caseCv: HTMLCanvasElement | null = null;
  /** 箱子（正面）、貼紙、貼紙上字的原點（layMsgV2 排在 (0,0) 起算的框裡，畫的時候平移過去）。 */
  box = { x: 0, y: 0, w: 0, h: 0 };
  sticker = { x: 0, y: 0, w: 0, h: 0 };
  textAt = { x: 0, y: 0 };
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    const sig = m ? sigOf(m) : '';
    const subs = lines.map((l) => lyricSubOf(l)?.text ?? '').join('');
    await loadText(`${B5_TEXT}FRAGILE小心輕放祝福${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}${subs}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    const bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    this.bars = winBars(au, s - 3, e + 1);
    const c = this.L.ctx;

    // ---- 留言：航空箱上的貼紙（先在 (0,0) 起算的框裡排，貼紙大小照字）
    let msgPx: number | null = null;
    if (m) {
      this.lay = layMsgV2(c, m.text, sig, FAM_MSG, { x: 0, y: 0, w: 660, h: 300 }, { lineHeight: 1.3, maxLines: 5, sigFamily: F.hand(400), align: 'left', valign: 'top' });
      msgPx = this.lay.fit.size;
      const n = this.lay.glyphs.length;
      this.gT = stagger(au, this.tOn, n, Math.min(1.5 * bar, Math.max(0.6, 0.4 * (e - this.tOn))));
    }

    // ---- 扇上的字：中文在馬達上面（往上長），原文小一號在馬達下面（往下長）
    const size = lyricV2(msgPx);
    const tc = this.txt.ctx;
    const layMain = (line: Line) => {
      const bare: Line = { ...line, sub: undefined };
      const probe = layBilingual(tc, bare, { family: FAM_LYR, size, maxW: 540, x: TX / 2, y: 0, lineHeight: 1.2 });
      const rows = new Set(probe.main.map((g) => g.row)).size;
      return layBilingual(tc, bare, { family: FAM_LYR, size, maxW: 540, x: TX / 2, y: TX / 2 - HUB_GAP - size * 0.14 - (rows - 1) * probe.mainSize * 1.2, lineHeight: 1.2 });
    };
    const laySub = (sub: Line, px: number) => layBilingual(tc, sub, { family: FAM_LYR, size: subPx(px), minSize: 30, maxW: 520, x: TX / 2, y: TX / 2 + HUB_GAP + subPx(px) * 0.8, lineHeight: 1.22 });
    lines.forEach((ln, i) => {
      const nx = lines[i + 1];
      const mn = layMain(ln), sb = lyricSubOf(ln);
      this.pages.push({ main: mn, sub: sb ? laySub(sb, mn.mainSize) : null, t0: ln.start - 0.35, t1: nx ? Math.min(ln.end + 1.2, nx.start - 0.35) : ln.end + 1.2, fake: false });
    });
    if (!lines.length) {
      // 純音樂：新人的名字（中文大字）＋日期（小一號），半拍亮一個字
      const fake = fakeLine(COUPLE_ZH, DATE_DOTS, this.tOn, beat);
      const mn = layMain(fake);
      this.pages.push({ main: mn, sub: laySub(fake.sub!, mn.mainSize), t0: this.tOn - 0.3, t1: Infinity, fake: true });
    }

    // ---- 小扇子的愛心
    const hc = this.heart.ctx;
    hc.clearRect(0, 0, 256, 256);
    drawHeart(hc, 128, 132, 150, rgba('rose'));
    this.heart.upload();

    this.drawCase();
    const st = this.sticker;
    this.avoid = [[st.x, st.y, st.w, st.h], [FAN.x - FAN.r, FAN.y - FAN.r, FAN.r * 2, FAN.r * 2]];
  }

  /** 航空箱（黑色、鋁邊、護角、扣鎖，看得到頂面與側面）與貼紙（紙色、圓角、一角翹起來），先畫好。 */
  private drawCase() {
    const lay = this.lay;
    const padX = 50, padT = 64, padB = 40;
    let sw: number, sh: number;
    if (lay) { const [bx, by, bw, bh] = lay.box; sw = Math.max(440, bx + bw + padX * 2); sh = by + bh + padT + padB; }
    else { sw = 580; sh = 190; }
    sw = Math.min(sw, 800); sh = Math.min(sh, 420);
    const fw = sw + 90, fh = Math.max(sh + 96, 250);
    const fx = CASE.x, fy = CASE.bottom - fh;
    this.box = { x: fx, y: fy, w: fw, h: fh };
    this.sticker = { x: fx + 45, y: fy + 48, w: sw, h: sh };
    this.textAt = { x: this.sticker.x + padX, y: this.sticker.y + padT };
    const DX = 46, DY = -38;
    const S = 2, cv = document.createElement('canvas');
    cv.width = (fw + DX + 20) * S; cv.height = (fh - DY + 20) * S;
    const g = cv.getContext('2d')!; g.scale(S, S);
    const ox = 0, oy = -DY;
    // 頂面、側面、正面
    // 頂面（燈從上面來，最亮）、側面（最暗）、正面（黑色的皮革紋，上亮下暗）
    const face = (pts: number[][], fill: string | CanvasGradient) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!))); g.closePath(); g.fill(); };
    face([[ox, oy], [ox + DX, oy + DY], [ox + fw + DX, oy + DY], [ox + fw, oy]], mixRgba('graphite', 'ink2', 0.55));
    face([[ox + fw, oy], [ox + fw + DX, oy + DY], [ox + fw + DX, oy + DY + fh], [ox + fw, oy + fh]], mixRgba('ink', 'ink2', 0.3));
    const fr = g.createLinearGradient(0, oy, 0, oy + fh);
    fr.addColorStop(0, mixRgba('ink', 'graphite', 0.14)); fr.addColorStop(0.3, rgba('ink')); fr.addColorStop(1, rgba('ink'));
    g.fillStyle = fr; g.fillRect(ox, oy, fw, fh);
    for (let i = 0; i < 1400; i++) { g.fillStyle = rgba('ash', 0.04 + 0.07 * hash(this.seed, i, 1)); g.fillRect(ox + hash(this.seed, i, 2) * fw, oy + hash(this.seed, i, 3) * fh, 1.4, 1.4); }
    // 鋁邊：有亮面的擠型鋁條
    const alu = (x: number, y: number, w: number, h: number) => {
      const hor = w > h;
      const gr = g.createLinearGradient(x, y, x + (hor ? 0 : w), y + (hor ? h : 0));
      gr.addColorStop(0, rgba('bone', 0.55)); gr.addColorStop(0.35, rgba('ash', 0.7)); gr.addColorStop(0.7, rgba('graphite', 0.9)); gr.addColorStop(1, rgba('ash', 0.5));
      g.fillStyle = gr; g.fillRect(x, y, w, h);
    };
    alu(ox, oy, fw, 14); alu(ox, oy + fh - 14, fw, 14); alu(ox, oy, 13, fh); alu(ox + fw - 13, oy, 13, fh);
    g.strokeStyle = rgba('ash', 0.6); g.lineWidth = 3;
    g.beginPath(); g.moveTo(ox + 2, oy); g.lineTo(ox + DX, oy + DY); g.lineTo(ox + fw + DX, oy + DY); g.lineTo(ox + fw, oy); g.moveTo(ox + fw + DX, oy + DY); g.lineTo(ox + fw + DX, oy + DY + fh); g.stroke();
    // 護角：圓圓的鍍鉻球角
    for (const [x, y] of [[ox + 8, oy + 8], [ox + fw - 8, oy + 8], [ox + 8, oy + fh - 8], [ox + fw - 8, oy + fh - 8]] as const) {
      const cg = g.createRadialGradient(x - 5, y - 6, 2, x, y, 20);
      cg.addColorStop(0, rgba('bone', 0.9)); cg.addColorStop(0.4, rgba('ash', 0.85)); cg.addColorStop(1, rgba('graphite', 0.9));
      g.fillStyle = cg; g.beginPath(); g.arc(x, y, 19, 0, TAU); g.fill();
    }
    // 扣鎖、側面的把手
    for (const fx2 of [0.25, 0.75]) { g.fillStyle = rgba('ash', 0.55); g.fillRect(ox + fw * fx2 - 18, oy + 2, 36, 22); g.fillStyle = rgba('ink', 0.5); g.fillRect(ox + fw * fx2 - 6, oy + 10, 12, 8); }
    g.fillStyle = rgba('graphite', 0.8); g.fillRect(ox + fw + 12, oy + fh * 0.4, 22, 50);
    // 箱子被扇子的光照到一點點（右上暖）
    const lit = g.createRadialGradient(ox + fw + DX, oy + DY, 10, ox + fw, oy, fw);
    lit.addColorStop(0, mixRgba('signal', 'ember', 0.4, 0.12)); lit.addColorStop(1, rgba('signal', 0));
    g.fillStyle = lit; g.fillRect(0, 0, fw + DX, fh - DY);
    // 貼紙：紙色、圓角，右上角翹起來
    const px = ox + 45, py = oy + 48;
    g.save();
    g.shadowColor = rgba('ink', 0.6); g.shadowBlur = 10; g.shadowOffsetY = 3;
    g.fillStyle = mixRgba('paper', 'bone', 0.4);
    g.beginPath(); g.moveTo(px + 12, py); g.lineTo(px + sw - 34, py); g.lineTo(px + sw, py + 34); g.lineTo(px + sw, py + sh - 12);
    g.quadraticCurveTo(px + sw, py + sh, px + sw - 12, py + sh); g.lineTo(px + 12, py + sh); g.quadraticCurveTo(px, py + sh, px, py + sh - 12);
    g.lineTo(px, py + 12); g.quadraticCurveTo(px, py, px + 12, py); g.fill();
    g.restore();
    g.fillStyle = mixRgba('paper', 'ash', 0.35); g.beginPath(); g.moveTo(px + sw - 34, py); g.lineTo(px + sw - 30, py + 30); g.lineTo(px + sw, py + 34); g.fill();
    // 貼紙上印好的細框與一行器材標籤（冷面的小字）
    g.strokeStyle = rgba('sepia', 0.22); g.lineWidth = 1; g.strokeRect(px + 14, py + 14, sw - 48, sh - 28);
    g.font = font(F.mono(500), 15); g.fillStyle = rgba('sepia', 0.5); g.letterSpacing = '3px';
    g.fillText('FRAGILE · 小心輕放 · 祝福', px + 28, py + 38); g.letterSpacing = '0px';
    this.caseCv = cv;
  }

  /** 這一格扇上是哪一句：最近一句已經開始刷的（兩句之間的空檔，上一句淡淡地留在扇上，不要整片突然空掉）。 */
  private pageAt(t: number): { pg: Page; hold: boolean } | null {
    let last: Page | null = null;
    for (const pg of this.pages) { if (t >= pg.t0 && t < pg.t1) return { pg, hold: false }; if (pg.t0 <= t) last = pg; }
    return last ? { pg: last, hold: true } : null;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const kick = f.a.kick;
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const z = 1 + 0.04 * drift, oy = 36 * (1 - land);
    const on = 0.4 + 0.6 * ease.outCubic(prog(t, s, this.tOn + 0.05));
    const bp = au.beatAt(t), strobe = Math.exp(-(bp - Math.floor(bp)) * au.beatPeriod(t) / 0.06);

    // ---- 扇上的字（逐字跟唱的顏色）
    const tc = this.txt.ctx;
    this.txt.clear();
    const at = this.pageAt(t), pg = at?.pg;
    let wipe = 1;
    if (pg) {
      wipe = clamp((t - pg.t0) / 0.3);
      // 淡出跟一般歌詞一樣（唱完停一下再淡，淡到一半留著）；純音樂的名字一直在
      const fade = pg.fake ? 1 : at!.hold ? 0.5 : Math.max(0.5, lyricAt(this.ctx.lyrics, t)?.k ?? 0);
      this.drawGlyphs(tc, pg.main.main, pg.main.mainSize, t, fade, false);
      if (pg.sub) this.drawGlyphs(tc, pg.sub.main, pg.sub.mainSize, t, fade, true);
    }
    if (!pg?.sub) {
      // 沒有原文：馬達下面一排跟著拍子跳的小燈（不留空的第二行）
      const bi = Math.floor(bp);
      for (let i = 0; i < 7; i++) {
        const lit = (i === ((bi % 7) + 7) % 7 ? 1 : 0.28) * on;
        tc.fillStyle = mixRgba('signal', 'ember', 0.4, lit);
        tc.beginPath(); tc.arc(TX / 2 + (i - 3) * 28, TX / 2 + HUB_GAP + 22, 5, 0, TAU); tc.fill();
      }
    }
    this.txt.upload();

    const u = this.room.u;
    u.uTxt!.value = this.txt.texture; u.uHeart!.value = this.heart.texture;
    u.uT!.value = t; u.uKick!.value = kick; u.uOn!.value = on; u.uWipe!.value = wipe; u.uStrobe!.value = strobe;
    u.uRot!.value = t * 23.7; u.uRot2!.value = -t * 17.1;
    const tb = lastBefore(this.bars, t);
    u.uRing!.value = Number.isFinite(tb) ? (t - tb) / 0.5 : -1;
    u.uMode2!.value = Math.floor(au.barAt(t) / 2) % 2;
    (u.uCam!.value as THREE.Vector3).set(z, oy, 0);
    this.room.render(renderer, out);

    // ---- 航空箱與貼紙上的留言
    const c = this.L.ctx;
    this.L.clear();
    c.setTransform(z, 0, 0, z, FAN.x - FAN.x * z, FAN.y - FAN.y * z + oy);
    const cv = this.caseCv!, S = 2, bx = this.box;
    // 地上的影子、電線（從箱子拖到扇子的腳）
    c.fillStyle = rgba('ink', 0.55); c.beginPath(); c.ellipse(bx.x + bx.w / 2 + 30, bx.y + bx.h + 4, bx.w * 0.58, 18, 0, 0, TAU); c.fill();
    c.strokeStyle = rgba('ink', 0.95); c.lineWidth = 6;
    c.beginPath(); c.moveTo(bx.x + bx.w + 30, bx.y + bx.h - 40); c.bezierCurveTo(bx.x + bx.w + 120, FLOOR + 90, FAN.x - 200, FLOOR + 40, FAN.x - 40, FLOOR + 12); c.stroke();
    c.drawImage(cv, 0, 0, cv.width, cv.height, bx.x, bx.y - 38 - 0, cv.width / S, cv.height / S);
    c.textBaseline = 'alphabetic';
    if (this.lay) {
      const lay = this.lay, o = this.textAt;
      lay.glyphs.forEach((gl, i) => {
        const tg = this.gT[i] ?? this.tOn;
        if (t < tg) return;
        c.globalAlpha = prog(t, tg, tg + 0.12);
        if (gl.ch === '♥') { drawHeart(c, o.x + gl.x + gl.w / 2, o.y + gl.y - gl.size * 0.36, Math.min(gl.w, gl.size * 0.8) * 0.9); return; }
        c.font = font(gl.row < 0 ? lay.sig.family : FAM_MSG, gl.size);
        c.fillStyle = gl.row < 0 ? rgba('sepia', 0.78) : rgba('sepia', 0.96);
        c.fillText(gl.ch, o.x + gl.x, o.y + gl.y);
      });
      c.globalAlpha = 1;
    } else {
      const o = this.textAt;
      c.font = font(FAM_MSG, 44); c.fillStyle = rgba('sepia', 0.92);
      c.fillText(`給 ${COUPLE_ZH}`, o.x, o.y + 36);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.6); c.letterSpacing = '2px';
      c.fillText(B5_INVITE, o.x, o.y + 84); c.letterSpacing = '0px';
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, this.L.upload(), out);
    return { bloom: 0.85, bloomThreshold: 0.88, vignette: 0.6, halation: 0.35, popupAvoid: this.avoid };
  }

  /** 把一排字畫到扇上的字圖（主行：唱到的訊號色、唱完暖白、還沒唱三成；原文比較安靜：唱到、唱完都是暖白）。 */
  private drawGlyphs(c: CanvasRenderingContext2D, gs: BGlyph[], size: number, t: number, alpha: number, quiet: boolean) {
    c.textBaseline = 'alphabetic';
    c.font = font(FAM_LYR, size);
    for (const g of gs) {
      const p = glyphProgress(g, t);
      c.globalAlpha = alpha;
      if (g.ch === '♥') { drawHeart(c, g.x + g.w / 2, g.y - size * 0.36, size * 0.8, p > 0 ? rgba('rose') : rgba('rose', 0.35)); continue; }
      c.fillStyle = p <= 0 ? rgba('bone', 0.3) : p < 1 && !quiet ? rgba('signal') : quiet ? mixRgba('bone', 'ember', 0.25, 0.82) : rgba('bone', 0.96);
      c.fillText(g.ch, g.x, g.y);
    }
    c.globalAlpha = 1;
  }
}

/** 純音樂用的假歌詞行：主行（名字）半拍亮一個字、副行（日期）接在後面。 */
function fakeLine(main: string, sub: string, t0: number, beat: number): Line {
  let k = 0;
  const mk = (text: string): Line => {
    const chars = Array.from(text);
    const words = chars.map((ch, j) => {
      const st = t0 + k * beat * 0.5;
      if (ch.trim()) k++;
      return { w: ch, start: st, end: st + 0.2, line: 0, index: j, gi: 0, o: chars.slice(0, j).join('').length };
    }).filter((w) => w.w.trim());
    return { i: 0, text, start: t0, end: t0 + k * beat * 0.5, words };
  };
  const line = mk(main);
  line.sub = mk(sub);
  return line;
}
