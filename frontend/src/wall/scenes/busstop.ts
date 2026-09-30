// 公車到站顯示（暗，批次 B3・街景）：夜裡的公車站，站牌是一根 L 形的柱子——橫臂吊著一塊 LED 到站看板（畫面左上），
// 柱身掛著一座時刻表燈箱（畫面右邊）；後面是夜裡的馬路、對面的樓與路燈，濕的路面映著燈。
//  - 兩行歌詞就是 LED 看板的兩排跑馬燈：上排中文（大）、下排原文（小一號），兩排同時在、各照自己的逐字時間亮
//    （還沒唱是暗的琥珀燈、唱到的是亮琥珀、唱完轉暖白；原文唱到就轉白、暗兩成）。句子太長放不下時，那一排跟著歌聲往左捲
//    （唱到的字一直在看得到的地方）；換句時新的一句從右邊「跑」進來、舊的往左跑出去。沒有翻譯：看板只有一排（變矮，不留空排）。
//    看板最上面一排小字是路線與倒數（「212 往 幸福路　下一班 2 分」），公車進站時變成「進站中」閃爍。
//  - 公車每兩小節進站一次：從右邊開進來、在小節線剛好停住（車身晃一下），車燈掃過路面與人行道；停一小節再開走。
//    公車是空的（亮著燈的車廂、扶手、椅背），車頭的小看板寫「212 幸福路」。對面車道偶爾有車燈流過，路燈偶爾閃一下。
//  - 主打留言貼在時刻表燈箱上：一張紙條用膠帶貼在時刻表上面（手寫字，40～60 px，留言區約 590×400），署名在最後一行下面；
//    沒有留言：紙條是一句邀請。純音樂：看板兩排是「本站開往 幸福路」「Next: Happily Ever After」。
//  - 鏡頭很慢地橫移、推近一點（遠樓、馬路、站牌三層視差）。右下角（HUD）是空的人行道。
// 手法：夜景（天空、遠樓、路燈、馬路、倒影、車燈光圈）是一個全螢幕 shader；公車、站牌、時刻表燈箱是一張 Canvas（燈箱內容 init 畫好）；
// LED 看板另一個 shader：一顆燈一個像素的小畫布（r = 還沒唱、g = 正在唱、b = 唱完），畫成一顆顆圓燈。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, pulse } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricSubOf, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { loadB3, layoutBi, paintLay, msgBlock, drawMsgBlock, B3_INVITE, SUB_RATIO, SUB_MIN, type BiLayout, type MsgBlock, type Rect } from './_b3';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'city', paper: false, energy: [0.3, 0.95], bars: [4, 8], weight: 1 };

/** LED 看板（畫面上的範圍，高度看有沒有原文）與燈距。 */
const BOARD = { x: 140, y: 104, w: 1030 };
const P = 2.6;
/** 柱子、時刻表燈箱、貼在上面的紙條（紙條就是留言區：590×400）。 */
const POLE = { x: 1188, w: 20, top: 58, ground: 1000 };
const TT = { x: 1214, y: 214, w: 620, h: 590 };
const NOTE = { x: 1228, y: 386, w: 592, h: 400 };
/** 公車：長、高、停下來時車頭的 x、車身的上下緣。 */
const BUS = { len: 1150, top: 442, bot: 772, stop: 128 };
const ROUTE = '212';
const DEST = '幸福路', DEST_EN = 'To Happiness Rd.';

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float cam; uniform float zoom; uniform vec4 bus[2]; uniform float lampFl; uniform vec4 cars[3];
  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = vec2(960.0, 600.0) + (p0 - vec2(960.0, 600.0)) / zoom;
    vec3 col;
    // 天空：很暗的夜，接近地平線被城市的光染一點暖
    col = mix(C_INK * 0.55, C_INK2 * 1.1 + C_EMBER * 0.025, smoothstep(0.0, 470.0, p.y));
    // 遠樓（視差 0.3）：一排高低不一的樓，零星的亮窗（每兩小節有幾扇換亮暗）
    float x1 = p.x + cam * 0.3;
    float c1 = floor(x1 / 170.0);
    float h1 = mix(120.0, 330.0, hash11(c1 * 1.37 + 3.0));
    if (p.y > 482.0 - h1 && p.y < 490.0) {
      col = C_INK * 0.75 + C_INK2 * 0.2;
      vec2 wc = floor(vec2(x1 / 20.0, p.y / 26.0));
      vec2 wf = fract(vec2(x1 / 20.0, p.y / 26.0));
      float win = step(0.3, wf.x) * step(wf.x, 0.75) * step(0.3, wf.y) * step(wf.y, 0.72) * step(482.0 - h1 + 18.0, p.y) * step(p.y, 470.0);
      float on = step(0.8, hash12(wc + floor(t / 3.6 + hash12(wc) * 5.0) * 0.61));
      col += (C_EMBER * 0.14 + C_BONE * 0.03) * win * on;
    }
    // 對面的人行道、馬路（視差 0.8）、這邊的路緣與人行道
    float x4 = p.x + cam * 0.8;
    if (p.y >= 490.0) col = C_INK2 * 0.9;
    if (p.y >= 506.0 && p.y < 800.0) {
      float v = (p.y - 506.0) / 294.0;
      col = C_INK * (0.72 + 0.1 * snoise(vec2(x4, p.y) / 14.0)) + C_INK2 * 0.2;
      // 中線（雙黃線用訊號色的暗部）、車道虛線
      col = mix(col, C_BLOOD * 0.35 + C_SIGNAL * 0.15, step(abs(p.y - 612.0), 2.0 + v) + step(abs(p.y - 620.0), 2.0 + v));
      col = mix(col, C_ASH * 0.35, step(abs(p.y - 712.0), 2.0 + v * 1.5) * step(0.5, fract(x4 / 190.0)));
    }
    if (p.y >= 800.0) col = C_INK2 * (p.y < 816.0 ? 1.35 : 1.0) * (0.95 + 0.05 * step(0.96, fract(p.x / 150.0 + (p.y - 816.0) * 0.004)));
    // 路燈：三盞，燈頭一團暖光，往下一圈光打在對面人行道與路上；濕路面上一條長長的倒影
    for (int i = 0; i < 3; i++) {
      float lx = float(i) * 640.0 + 300.0 - cam * 0.55;
      float fl = i == 1 ? lampFl : 1.0;
      vec2 hd = vec2(lx, 336.0);
      // 燈柱與燈頭（對面人行道上，看板下面看得到）
      float post = step(abs(p.x - lx - 30.0), 2.5) * step(336.0, p.y) * step(p.y, 496.0);
      float arm = step(abs(p.y - 336.0), 2.0) * step(lx, p.x) * step(p.x, lx + 32.0);
      col = mix(col, C_GRAPHITE * 0.3, max(post, arm));
      col += (C_EMBER * 0.9 + C_BONE * 0.15) * exp(-dot((p - hd) / vec2(16.0, 7.0), (p - hd) / vec2(16.0, 7.0))) * fl * 1.4;
      col += C_EMBER * 0.05 * exp(-length((p - hd) / vec2(160.0, 120.0))) * fl;
      // 光圈與倒影
      if (p.y > 490.0) {
        col += C_EMBER * 0.06 * exp(-length((p - vec2(lx, 520.0)) / vec2(200.0, 26.0))) * fl;
        float st = exp(-pow((p.x - lx + 3.0 * sin(p.y * 0.08 + t * 2.0)) / 12.0, 2.0)) * smoothstep(760.0, 520.0, p.y);
        col += C_EMBER * 0.07 * st * fl * (0.5 + 0.5 * snoise(vec2(p.x / 6.0, p.y / 40.0 - t)));
      }
    }
    // 對面車道流過的車：兩顆白色頭燈（往右）或紅色尾燈（往左）
    for (int i = 0; i < 3; i++) {
      vec4 c = cars[i];
      if (c.z <= 0.0) continue;
      vec2 q = p - vec2(c.x - cam * 0.8, 566.0);
      float l = exp(-dot(q / vec2(10.0, 5.0), q / vec2(10.0, 5.0))) + exp(-dot((q - vec2(c.w * 26.0, 0.0)) / vec2(10.0, 5.0), (q - vec2(c.w * 26.0, 0.0)) / vec2(10.0, 5.0)));
      vec3 lc = c.w > 0.0 ? C_BONE * 1.4 : C_BLOOD * 1.5;
      col += lc * l * c.z;
      col += lc * 0.05 * exp(-length((p - vec2(c.x - cam * 0.8 + c.w * 80.0, 580.0)) / vec2(160.0, 16.0))) * c.z * step(566.0, p.y);
    }
    // 公車的車燈：車頭往左照，路面上一大片光圈（掃過來）、空氣裡一道淡淡的光束
    for (int i = 0; i < 2; i++) {
      vec4 b = bus[i];
      if (b.y <= 0.0) continue;
      float fx = b.x - cam;
      vec2 q = (p - vec2(fx - 300.0, 790.0)) / vec2(420.0, 70.0);
      col += (C_BONE * 0.22 + C_EMBER * 0.1) * exp(-dot(q, q)) * b.y * step(506.0, p.y);
      vec2 q2 = (p - vec2(fx - 380.0, 900.0)) / vec2(520.0, 150.0);
      col += (C_BONE * 0.06 + C_EMBER * 0.04) * exp(-dot(q2, q2)) * b.y * step(816.0, p.y);
      float beam = exp(-pow((p.y - 728.0 - (fx - p.x) * 0.05) / (16.0 + (fx - p.x) * 0.06), 2.0)) * smoothstep(fx + 10.0, fx - 60.0, p.x) * exp(-(fx - p.x) / 700.0);
      col += (C_BONE * 0.07 + C_EMBER * 0.03) * beam * b.y;
    }
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, cam: { value: 0 }, zoom: { value: 1 }, lampFl: { value: 1 },
  bus: { value: [new THREE.Vector4(), new THREE.Vector4()] },
  cars: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
});

/** LED 看板：rect 裡一顆顆燈；資料貼圖一顆燈一個像素（r = 還沒唱、g = 正在唱、b = 唱完）。subY：原文那一排從第幾排燈開始。 */
const LED = () => new FSPass(/* glsl */ `
  uniform sampler2D dat; uniform vec4 rect; uniform vec2 grid; uniform float subY; uniform float kin; uniform float glint;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = p - rect.xy;
    float pad = 14.0;
    if (q.x < -pad || q.y < -pad || q.x > rect.z + pad || q.y > rect.w + pad) discard;
    // 外殼：黑色的鋁框，下緣被車燈照到時亮一點
    if (q.x < 0.0 || q.y < 0.0 || q.x > rect.z || q.y > rect.w) {
      float edge = smoothstep(rect.w, rect.w + pad, q.y);
      fragColor = vec4(C_INK * 0.9 + C_GRAPHITE * 0.05 + (C_BONE * 0.08 + C_EMBER * 0.05) * glint * edge, 1.0);
      return;
    }
    vec2 g = q / rect.zw * grid, cell = floor(g), f = fract(g) - 0.5;
    float pitch = rect.z / grid.x;
    float r = length(f) * pitch;
    float dotm = 1.0 - smoothstep(pitch * 0.32, pitch * 0.32 + 0.8, r);
    vec4 v = fastLayer(texture(dat, vec2((cell.x + 0.5) / grid.x, 1.0 - (cell.y + 0.5) / grid.y)));
    float a = v.a;
    vec3 w = v.a > 0.0 ? v.rgb / max(1e-3, v.r + v.g + v.b) : vec3(0.0);
    bool sub = cell.y >= subY;
    vec3 un = sub ? C_BONE * 0.07 : C_SIGNAL * 0.22;
    vec3 act = C_SIGNAL * 2.2 + C_EMBER * 0.4;
    vec3 sung = sub ? C_BONE * 0.62 : mix(C_BONE, C_EMBER, 0.4) * 0.95;
    vec3 c = un * w.r + act * w.g + sung * w.b;
    float on = smoothstep(0.12, 0.62, a);
    vec3 col = C_INK * 0.35 + (C_GRAPHITE * 0.05 + c * on) * dotm * kin;
    col += c * on * 0.1 * (1.0 - dotm) * kin;
    fragColor = vec4(col, 1.0);
  }`, { dat: { value: null }, rect: { value: new THREE.Vector4() }, grid: { value: new THREE.Vector2() }, subY: { value: 1e9 }, kin: { value: 1 }, glint: { value: 0 } });

/** 一班公車：到站（停住的小節線）、開走的時間、車頭看板的號碼。 */
interface Bus { tArr: number; tDep: number; T: number; seed: number }

export default class BusStop extends Scene {
  bg = shared('busstop.bg', BG);
  led = shared('busstop.led', LED);
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dat!: Layer2D;
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 43 + (this.msg?.id ?? 0) * 13) >>> 0;
  tt: HTMLCanvasElement | null = null;
  mb: MsgBlock | null = null;
  buses: Bus[] = [];
  hasLyrics = false;
  hasSub = false;
  /** 看板的燈數與幾排：路線那一排、中文、原文。 */
  cols = 0; rows = 0; rowHead = 2; rowMain = 0; rowSub = 0;
  mainSize = 18; subSize = 12;
  lays = new Map<Line, BiLayout>();
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadB3(this.ctx, `${ROUTE}往${DEST}${DEST_EN}下一班分進站中本站開往Next: Happily Ever After時刻表首班末班每約平日假日班距TIMETABLE站牌留言`);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.buildTT();
    // 歌詞字級（燈數）：v2 的螢幕字級 ÷ 燈距；原文約中文的 0.68 倍、至少 32 px
    const ms = lyricV2(this.mb ? this.mb.fit.size : null);
    this.mainSize = ms / P;
    this.subSize = Math.max(SUB_MIN + 2, Math.round(ms * SUB_RATIO)) / P;
    const lines = lyrics.linesIn(s - 14, e + 1);
    this.hasSub = !this.hasLyrics || lines.some((l) => lyricSubOf(l));
    this.cols = Math.floor(BOARD.w / P);
    const headH = 11, gap = 5;
    this.rowHead = 3;
    this.rowMain = this.rowHead + headH + gap;
    this.rowSub = this.rowMain + Math.ceil(this.mainSize * 1.2) + 3;
    this.rows = this.hasSub ? this.rowSub + Math.ceil(this.subSize * 1.25) + 2 : this.rowSub;
    this.dat = this.track(new Layer2D(this.cols, this.rows, 1, { fast: true }));
    const c = this.dat.ctx;
    // 每一排只有一行：放不下先縮字（中文最小 40 px、原文最小 30 px），縮到這樣還放不下才跟著歌聲捲
    const A = this.cols - 8;
    const fitTo = (text: string, fam: string, size: number, min: number) => {
      c.font = font(fam, size);
      const w = c.measureText(text).width;
      return w <= A ? size : Math.max(min, (size * A) / w);
    };
    for (const l of lines) {
      const sl = lyricSubOf(l);
      const ms = fitTo(l.text, F.hei(700), this.mainSize, V2.lyrMin / P);
      const ss = sl ? fitTo(sl.text, F.hei(500), this.subSize, SUB_MIN / P) : this.subSize;
      this.lays.set(l, layoutBi(c, l, { family: F.hei(700), size: ms, minSize: ms, maxWidth: 1e5, subFamily: F.hei(500), subRatio: ss / ms, subMin: ss }));
    }
    // 公車：第一個夠遠的小節線到站，之後每兩小節一班
    const beat = au.beatPeriod(s), bar = beat * 4;
    const b0 = Math.ceil(au.barAt(s + beat * 1.2) - 1e-6);
    for (let b = b0, k = 0; au.timeOfBar(b) < e - beat * 0.5; b += 2, k++) {
      const tA = au.timeOfBar(b);
      // 停四分之三小節就開走（下一班進站前，上一班已經開出畫面）
      this.buses.push({ tArr: tA, tDep: tA + Math.min(bar * 0.75, 2), T: clamp(bar * 0.7, 0.9, 1.4), seed: hash(this.seed, k) });
    }
    if (!this.buses.length) { const tA = au.timeOfBeat(Math.ceil(au.beatAt(s + 0.9))); this.buses.push({ tArr: tA, tDep: tA + 1.6, T: 0.8, seed: 0.3 }); }
    this.avoid = [[BOARD.x, BOARD.y, BOARD.w, this.rows * P], [NOTE.x, NOTE.y, NOTE.w, NOTE.h]];
  }

  /** 時刻表燈箱（畫一次）：上面是路線牌，下面是時刻表，紙條（留言）貼在時刻表上。 */
  private buildTT() {
    const m = this.msg;
    const cv = document.createElement('canvas');
    cv.width = TT.w; cv.height = TT.h;
    const c = cv.getContext('2d')!;
    c.textBaseline = 'alphabetic';
    // 燈箱：背光的白（稍微暖）、外框
    c.fillStyle = mixRgba(mixRgba('bone', 'paper', 0.35), 'ash', 0.3); c.fillRect(0, 0, TT.w, TT.h);
    // 路線牌（訊號色的暗部）
    c.fillStyle = mixRgba('blood', 'ink', 0.25); c.fillRect(0, 0, TT.w, 108);
    c.font = font(F.archivo(90, 900), 64); c.fillStyle = rgba('bone', 0.97); c.fillText(ROUTE, 26, 78);
    const rw = c.measureText(ROUTE).width;
    c.font = font(F.hei(700), 30); c.fillText(`往 ${DEST}`, 50 + rw, 58);
    c.font = font(F.hei(500), 20); c.fillStyle = rgba('bone', 0.75); c.fillText(DEST_EN, 50 + rw, 88);
    // 時刻表：很淡的小字與細線（配角）
    c.font = font(F.hei(700), 17); c.fillStyle = rgba('ink', 0.55); c.letterSpacing = '4px'; c.fillText('時刻表 TIMETABLE', 22, 140); c.letterSpacing = '0px';
    c.fillStyle = rgba('ink', 0.18); c.fillRect(22, 152, TT.w - 44, 1.5);
    c.font = font(F.mono(500), 15); c.fillStyle = rgba('ink', 0.32);
    for (let r = 0; r < 26; r++) for (let k = 0; k < 6; k++) {
      const hh = 6 + r, mm = Math.floor(hash(this.seed, r, k) * 6) * 10;
      c.fillText(`${String(hh % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, 26 + k * 98, 178 + r * 16);
    }
    // 紙條：一張有點歪的紙，四角貼膠帶
    const nx = NOTE.x - TT.x, ny = NOTE.y - TT.y;
    c.save();
    c.translate(nx + NOTE.w / 2, ny + NOTE.h / 2); c.rotate(-0.012); c.translate(-NOTE.w / 2, -NOTE.h / 2);
    c.fillStyle = rgba('ink', 0.18); c.fillRect(4, 6, NOTE.w, NOTE.h);
    c.fillStyle = mixRgba('paper', 'bone', 0.5); c.fillRect(0, 0, NOTE.w, NOTE.h);
    // 紙條上的橫線（筆記紙）
    c.fillStyle = rgba('sepia', 0.08);
    for (let y = 62; y < NOTE.h - 10; y += 48) c.fillRect(20, y, NOTE.w - 40, 1.5);
    for (const [tx, ty, r] of [[-10, -8, -0.5], [NOTE.w - 70, -10, 0.45]] as const) {
      c.save(); c.translate(tx + 40, ty + 14); c.rotate(r); c.fillStyle = mixRgba('ash', 'bone', 0.5, 0.7); c.fillRect(-42, -13, 84, 26); c.restore();
    }
    if (m) {
      const mb = (this.mb = msgBlock(c, m, F.hand(700), NOTE.w - 64, NOTE.h - 70, { sigFamily: F.hand(400), lineHeight: 1.28 }));
      c.font = font(F.hei(700), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('blood', 0.8);
      c.fillText(m.couple ? 'FROM THE COUPLE · 新人' : `站牌留言 No.${String(m.n).padStart(3, '0')}`, 32, 40); c.letterSpacing = '0px';
      c.save(); c.translate(32, 50 + Math.max(0, (NOTE.h - 70 - mb.h) * 0.4));
      drawMsgBlock(c, mb, { color: mixRgba('ink', 'sepia', 0.35), sigColor: rgba('blood', 0.9) });
      c.restore();
    } else {
      const [a, b] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
      c.font = font(F.hand(700), 52); c.fillStyle = mixRgba('ink', 'sepia', 0.35);
      const wa = c.measureText(a).width;
      c.fillText(a, 34, 130); drawHeart(c, 34 + wa + 40, 112, 36); c.fillText(b, 34 + wa + 80, 130);
      c.font = font(F.mono(500), 18); c.letterSpacing = '6px'; c.fillStyle = rgba('sepia', 0.7); c.fillText(DATE_DOTS, 36, 178); c.letterSpacing = '0px';
      c.font = font(F.hand(700), 30); c.fillStyle = mixRgba('ink', 'sepia', 0.35);
      c.fillText('等車的時候，', 34, 270); c.fillText('寫一句祝福給新人吧', 34, 318);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.75); c.fillText(B3_INVITE, 34, 370);
    }
    c.restore();
    this.tt = cv;
  }

  /** 一班公車現在車頭的 x（還沒來、已經走了回傳 null）與停下來時的晃動。 */
  private busAt(b: Bus, t: number): { x: number; bob: number } | null {
    const D = W + 120 - BUS.stop;
    if (t < b.tArr - b.T) return null;
    if (t < b.tArr) { const k = (t - (b.tArr - b.T)) / b.T; return { x: BUS.stop + D * (1 - k) * (1 - k), bob: 0 }; }
    if (t < b.tDep) { const d = t - b.tArr; return { x: BUS.stop, bob: Math.exp(-d * 5) * Math.sin(d * 16) }; }
    const d = t - b.tDep;
    const x = BUS.stop - 1700 * (d / 1.3) ** 2;
    return x + BUS.len < -60 ? null : { x, bob: 0 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const p = ease.inOutQuad(prog(t, s, e));
    // 鏡頭：很慢地往右移、推近一點（左邊的看板不能被推出 96 px 的安全邊）
    const cam = 30 * p, zoom = 1 + 0.02 * p;
    // ---- 公車
    const live = this.buses.map((b) => ({ b, at: this.busAt(b, t) })).filter((x) => x.at);
    const u = this.bg.u;
    const BV = u.bus!.value as THREE.Vector4[];
    for (let i = 0; i < 2; i++) {
      const x = live[i];
      BV[i]!.set(x ? x.at!.x : 0, x ? 1 : 0, 0, 0);
    }
    // 對面車道的車：每一拍有機會開過一台（往右是頭燈、往左是尾燈）
    const CV = u.cars!.value as THREE.Vector4[];
    const bi = Math.floor(au.beatAt(t));
    for (let i = 0; i < 3; i++) {
      const b = bi - i;
      const dir = hash(this.seed, b, 3) < 0.5 ? 1 : -1;
      const on = hash(this.seed, b, 4) < 0.55 ? 1 : 0;
      const d = t - au.timeOfBeat(b);
      const x = dir > 0 ? -200 + d * 900 : W + 200 - d * 900;
      CV[i]!.set(x, 0, on && d < 3 ? 0.9 : 0, dir);
    }
    // 中間那盞路燈偶爾閃兩下（每四小節一次）
    const bar = au.barAt(t), bf = bar - Math.floor(bar);
    u.lampFl!.value = Math.floor(bar) % 4 === 3 && bf > 0.5 && bf < 0.62 ? (Math.floor(bf * 60) % 2 ? 0.2 : 0.9) : 1;
    u.t!.value = t; u.cam!.value = cam; u.zoom!.value = zoom;
    this.bg.render(renderer, out);
    // ---- Canvas：公車、站牌、燈箱
    const L = this.fg; L.clear();
    const c = L.ctx;
    c.save();
    c.translate(960, 600); c.scale(zoom, zoom); c.translate(-960, -600);
    c.save(); c.translate(-cam * 0.9, 0);
    for (const x of live) this.drawBus(c, x.b, x.at!.x, x.at!.bob, t);
    c.restore();
    c.save(); c.translate(-cam, 0);
    this.drawPole(c, t);
    c.restore();
    c.restore();
    L.upload();
    comp.draw(renderer, L.texture, out);
    // ---- LED 看板（跟站牌一起移動）
    this.drawLED(t);
    const lu = this.led.u;
    const bx = 960 + (BOARD.x - cam - 960) * zoom, by = 600 + (BOARD.y - 600) * zoom;
    (lu.rect!.value as THREE.Vector4).set(bx, by, BOARD.w * zoom, this.rows * P * zoom);
    (lu.grid!.value as THREE.Vector2).set(this.cols, this.rows);
    lu.subY!.value = this.hasSub ? this.rowSub - 1 : 1e9;
    lu.dat!.value = this.dat.texture;
    // 車燈掃過看板下緣
    const near = live.reduce((a, x) => Math.max(a, clamp(1 - Math.abs(x.at!.x - 600) / 900)), 0);
    lu.glint!.value = near;
    this.led.render(renderer, out);
    const arr = this.buses.reduce((a, b) => Math.max(a, pulse(t, b.tArr, 0.1)), 0);
    return {
      bloom: 0.6, vignette: 0.5, grain: 0.05, halation: 0.25,
      shake: [0, arr * 2],
      popupAvoid: this.avoid.map(([x, y, w, h]) => [x - cam, y, w, h] as Rect),
    };
  }

  /** 公車（側面，往左開）：車身、亮著燈的車廂（扶手、椅背）、兩扇門、車頭看板、車燈、輪子。 */
  private drawBus(c: CanvasRenderingContext2D, b: Bus, x: number, bob: number, t: number) {
    const top = BUS.top + bob * 3, bot = BUS.bot + bob * 2, L = BUS.len;
    c.save();
    // 車底的影子
    c.fillStyle = rgba('ink', 0.5); c.beginPath(); c.ellipse(x + L / 2, BUS.bot + 26, L / 2, 16, 0, 0, Math.PI * 2); c.fill();
    // 車身：上半淺、下半深（兩色塗裝），車頂一條被路燈照到的亮邊
    const bg = c.createLinearGradient(0, top, 0, bot);
    bg.addColorStop(0, mixRgba('ash', 'graphite', 0.55)); bg.addColorStop(0.62, mixRgba('graphite', 'ink2', 0.45)); bg.addColorStop(0.64, mixRgba('ink2', 'ink', 0.2)); bg.addColorStop(1, mixRgba('ink2', 'ink', 0.5));
    c.fillStyle = bg;
    c.beginPath(); c.roundRect(x, top, L, bot - top, [36, 16, 10, 12]); c.fill();
    c.fillStyle = mixRgba('bone', 'ember', 0.4, 0.35); c.fillRect(x + 30, top + 2, L - 46, 3);
    // 車身的色帶（訊號色的暗部）
    c.fillStyle = mixRgba('blood', 'signal', 0.3, 0.85); c.fillRect(x + 4, top + 196, L - 8, 22);
    // 車廂的窗（亮著暖燈，裡面是扶手與椅背）
    const wy = top + 38, wh = 140;
    const winX0 = x + 190, winW = L - 230;
    // 車廂裡的日光燈：上面亮、往下暗一點（不要一整片死白）
    const wg = c.createLinearGradient(0, wy, 0, wy + wh);
    wg.addColorStop(0, mixRgba('bone', 'ember', 0.35, 0.6)); wg.addColorStop(1, mixRgba(mixRgba('bone', 'ember', 0.5), 'graphite', 0.55, 0.5));
    c.fillStyle = wg; c.fillRect(winX0, wy, winW, wh);
    c.save(); c.beginPath(); c.rect(winX0, wy, winW, wh); c.clip();
    c.fillStyle = rgba('bone', 0.5); c.fillRect(winX0, wy + 4, winW, 5);
    c.strokeStyle = mixRgba('graphite', 'ink', 0.3, 0.6); c.lineWidth = 3;
    c.beginPath(); c.moveTo(winX0, wy + 30); c.lineTo(winX0 + winW, wy + 30); c.stroke();
    // 吊環跟著車晃
    for (let k = 0; k < 14; k++) {
      const hx = winX0 + 30 + k * (winW / 14), sw = bob * 6 + Math.sin(t * 3 + k) * 1.5;
      c.beginPath(); c.moveTo(hx, wy + 30); c.lineTo(hx + sw, wy + 52); c.stroke();
      c.beginPath(); c.arc(hx + sw, wy + 58, 6, 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = mixRgba('blood', 'ink2', 0.5, 0.75);
    for (let k = 0; k < 9; k++) { c.beginPath(); c.roundRect(winX0 + 40 + k * (winW / 9), wy + 92, 40, 60, 8); c.fill(); }
    // 玻璃上的斜反光（對面的路燈）
    c.fillStyle = rgba('bone', 0.08);
    for (let k = 0; k < 4; k++) { const rx = winX0 + ((k * 331 + (x * 0.2)) % winW); c.beginPath(); c.moveTo(rx, wy); c.lineTo(rx + 60, wy); c.lineTo(rx + 10, wy + wh); c.lineTo(rx - 50, wy + wh); c.closePath(); c.fill(); }
    c.restore();
    // 窗柱
    c.fillStyle = mixRgba('graphite', 'ink2', 0.55);
    for (let k = 1; k < 6; k++) c.fillRect(winX0 + (k * winW) / 6 - 6, wy, 12, wh);
    // 門（前門在車頭後面、中門在中間）：玻璃、上下兩格
    for (const dx of [96, 560]) {
      c.fillStyle = mixRgba('graphite', 'ink', 0.4); c.fillRect(x + dx, top + 34, 86, bot - top - 60);
      c.fillStyle = mixRgba(mixRgba('bone', 'ember', 0.45), 'ink2', 0.45, 0.6); c.fillRect(x + dx + 8, top + 42, 32, 170); c.fillRect(x + dx + 46, top + 42, 32, 170);
      c.fillStyle = mixRgba(mixRgba('bone', 'ember', 0.45), 'ink2', 0.6, 0.45); c.fillRect(x + dx + 8, top + 220, 32, bot - top - 250); c.fillRect(x + dx + 46, top + 220, 32, bot - top - 250);
    }
    // 車頭：擋風玻璃（斜）、上面的小看板（琥珀色的字）
    c.fillStyle = mixRgba('ink2', 'bone', 0.18, 0.95);
    c.beginPath(); c.moveTo(x + 8, top + 70); c.lineTo(x + 88, top + 40); c.lineTo(x + 88, top + 200); c.lineTo(x + 6, top + 206); c.closePath(); c.fill();
    c.fillStyle = rgba('ink', 0.95); c.fillRect(x + 190, top + 8, 330, 26);
    c.font = font(F.hei(700), 20); c.fillStyle = mixRgba('signal', 'ember', 0.3);
    c.fillText(`${ROUTE}　${DEST}`, x + 204, top + 29);
    // 車燈（前白、後紅）
    c.fillStyle = rgba('bone'); c.beginPath(); c.ellipse(x + 10, bot - 58, 8, 14, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('blood'); c.fillRect(x + L - 12, bot - 110, 10, 40);
    // 輪子（輻條照走的距離轉）
    for (const wx of [x + 250, x + L - 230]) {
      c.fillStyle = rgba('ink', 0.95); c.beginPath(); c.arc(wx, bot + 2, 50, 0, Math.PI * 2); c.fill();
      c.fillStyle = mixRgba('graphite', 'ash', 0.35); c.beginPath(); c.arc(wx, bot + 2, 24, 0, Math.PI * 2); c.fill();
      // 素面的輪圈、一圈六顆螺絲、中間的輪轂蓋（不要畫成輻條，免得像哪個車廠的標誌）
      c.strokeStyle = rgba('ink', 0.35); c.lineWidth = 2; c.beginPath(); c.arc(wx, bot + 2, 18, 0, Math.PI * 2); c.stroke();
      c.fillStyle = rgba('ink', 0.7);
      const a = x / 50;
      for (let k = 0; k < 6; k++) { const aa = a + (k * Math.PI * 2) / 6; c.beginPath(); c.arc(wx + Math.cos(aa) * 13, bot + 2 + Math.sin(aa) * 13, 2.6, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = mixRgba('graphite', 'ash', 0.6); c.beginPath(); c.arc(wx, bot + 2, 6, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    void b;
  }

  /** L 形的站牌柱（橫臂吊著 LED 看板）與時刻表燈箱。 */
  private drawPole(c: CanvasRenderingContext2D, t: number) {
    const g = c.createLinearGradient(POLE.x, 0, POLE.x + POLE.w, 0);
    g.addColorStop(0, mixRgba('ash', 'graphite', 0.5)); g.addColorStop(0.4, mixRgba('graphite', 'ink2', 0.3)); g.addColorStop(1, mixRgba('ink2', 'ink', 0.5));
    c.fillStyle = g; c.fillRect(POLE.x, POLE.top, POLE.w, POLE.ground - POLE.top);
    // 橫臂與兩根吊桿
    c.fillStyle = mixRgba('graphite', 'ink2', 0.4); c.fillRect(BOARD.x + 30, POLE.top, POLE.x - BOARD.x - 30 + POLE.w, 14);
    for (const hx of [BOARD.x + 90, BOARD.x + BOARD.w - 90]) c.fillRect(hx, POLE.top + 14, 6, BOARD.y - POLE.top - 14);
    c.fillStyle = mixRgba('graphite', 'ink', 0.3); c.fillRect(POLE.x - 12, POLE.ground - 8, POLE.w + 24, 20);
    // 時刻表燈箱
    if (this.tt) {
      c.fillStyle = mixRgba('graphite', 'ink', 0.4); c.fillRect(TT.x - 10, TT.y - 10, TT.w + 20, TT.h + 20);
      c.drawImage(this.tt, TT.x, TT.y);
      // 燈箱的光在壓克力上淡淡的一層反光（右上一條）
      const gg = c.createLinearGradient(TT.x, TT.y, TT.x + TT.w, TT.y + TT.h);
      gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(0.62, 'rgba(255,255,255,0)'); gg.addColorStop(0.7, 'rgba(255,255,255,0.08)'); gg.addColorStop(0.78, 'rgba(255,255,255,0)');
      c.fillStyle = gg; c.fillRect(TT.x, TT.y, TT.w, TT.h);
    }
    void t;
  }

  /** 看板的字（一顆燈一個像素）：路線與倒數、中文、原文；跟唱與跑馬。 */
  private drawLED(t: number) {
    const { lyrics, audio: au, song } = this.ctx;
    const D = this.dat; D.clear();
    const c = D.ctx;
    c.textBaseline = 'alphabetic';
    const R = 'rgb(255,0,0)', G = 'rgb(0,255,0)', B = 'rgb(0,0,255)';
    // ---- 最上面一排：路線、目的地、倒數（下一班進站前的小節數）或「進站中」閃
    const next = this.buses.find((b) => b.tDep > t);
    const arriving = next && t >= next.tArr - next.T && t < next.tDep;
    c.font = font(F.hei(700), 11); c.fillStyle = B;
    c.fillText(`${ROUTE} 往 ${DEST}`, 4, this.rowHead + 10);
    c.textAlign = 'right';
    if (arriving) { if (Math.floor(t * 4) % 2 === 0) { c.fillStyle = G; c.fillText('進站中', this.cols - 4, this.rowHead + 10); } }
    else {
      const n = next ? Math.max(1, Math.ceil(au.barAt(next.tArr - next.T) - au.barAt(t))) : 9;
      c.fillStyle = B; c.fillText(`下一班 ${n} 分`, this.cols - 4, this.rowHead + 10);
    }
    c.textAlign = 'left';
    // 分隔線
    c.fillStyle = R; c.fillRect(0, this.rowMain - 3, this.cols, 1);
    const A = this.cols - 8;
    const baseMain = this.rowMain + this.mainSize * 0.92, baseSub = this.rowSub + this.subSize * 0.95;
    if (!this.hasLyrics) {
      c.font = font(F.hei(700), this.mainSize); c.fillStyle = B; c.fillText(`本站開往　${DEST}`, 4, baseMain);
      c.font = font(F.hei(500), this.subSize); c.fillStyle = B; c.fillText('Next: Happily Ever After', 4, baseSub);
      if (song.title) { c.textAlign = 'right'; c.font = font(F.hei(500), this.subSize); c.fillStyle = R; c.fillText(`♪ ${song.title}`, this.cols - 4, baseSub); c.textAlign = 'left'; }
      D.upload();
      return;
    }
    // ---- 兩排歌詞：現在這一句（提早 0.35 秒從右邊跑進來），上一句往左跑出去
    const line = lyrics.shownLine(t, 1e4, 0.35) ?? lyrics.nextLine(t);
    if (!line) { D.upload(); return; }
    const idx = lyrics.lines.indexOf(line);
    const prev = idx > 0 ? lyrics.lines[idx - 1]! : null;
    const kIn = ease.outCubic(clamp((t - (line.start - 0.35)) / 0.32));
    const ink = { unsung: R, active: G, sung: B };
    const subInk = { unsung: R, active: B, sung: B };
    const drawLine = (ln: Line, dx: number) => {
      const bl = this.lays.get(ln);
      if (!bl) return;
      // 太長放不下：跟著歌聲往左捲（唱到的字停在 55% 的地方）
      const scroll = (lay: typeof bl.main) => {
        const w = Math.max(...lay.rows.map((r) => r.width), 0);
        if (w <= A) return 0;
        let head = 0;
        for (const pw of lay.words) { const pr = Lyrics.wordProgress(pw.word, t); if (pr > 0) head = pw.x + pw.w * pr; }
        return clamp(head - A * 0.55, 0, w - A);
      };
      c.save(); c.translate(4 + dx - scroll(bl.main), baseMain);
      paintLay(c, bl.main, bl.mainSt, t, ink);
      c.restore();
      if (bl.sub && bl.subSt) {
        c.save(); c.translate(4 + dx - scroll(bl.sub), baseSub);
        paintLay(c, bl.sub, bl.subSt, t, subInk);
        c.restore();
      }
    };
    if (prev && kIn < 1) drawLine(prev, -kIn * (this.cols + 20));
    drawLine(line, (1 - kIn) * (this.cols + 20));
    D.upload();
  }
}
