// 酒標（亮）：棚拍的一支紅酒。暖色的紙背景、左邊一扇窗的光，酒瓶站在商品攝影的轉盤上。
//  - 開場：酒標朝後（看得到深色玻璃、窗光在瓶身上的一條長反光、酒標的邊從左邊露出來），第一個拍點轉盤一轉，
//    酒標轉到正面；鏡頭同時推近到酒標的特寫（酒標是包在圓柱上的紙：越靠兩邊越窄、上下緣彎成弧）。
//  - 酒標：上方小小的酒莊名「DOMAINE ETHAN & IVY」（新人的英文名；沒有英文名就是「承恩與以晴酒莊」）、年份（婚禮那一年，還沒定日期就不寫）；中間的「品飲筆記」就是主打留言
//    （思源宋體、最大、置中），署名是手寫的；下緣一行冷面小字（愛情法定產區、恕不退還）。
//  - 歌詞印在酒標上方的一條深色瓶頸標上（燙金的細線，唱到的字是訊號色，深底上讀得清楚）。
//  - 之後每個小節線，紙面的光澤從左掃到右一次（窗光掃過）；轉盤很慢地來回轉一點點；鏡頭一直很慢地推近。
//  - 留言標準 v2：鏡頭不再推到酒標塞滿畫面，停在「看得到整個瓶身的寬、瓶子兩側是牆」的中景（酒瓶在畫面偏左，右下角 HUD 的後面是牆）；
//    品飲筆記那一塊在畫面上約 765×270，留言 40～60 px。推近之後的下一拍，署名像用筆簽上去（從左寫到右）。
//  - 沒有留言：品飲筆記那一塊印的是歌詞（跟唱），下面一行邀請；瓶頸標寫歌名。
// 畫法：一個全螢幕 shader 把每個像素打回圓柱上的角度與高度（正交鏡頭＋一點俯角，是解析解，不用光線步進），
// 酒標的紙與印刷是 init 畫好的圖層（有 mipmap，推近推遠都不閃），歌詞另一張圖層每格畫；玻璃、窗光、紙的光澤、
// 背景牆上酒瓶的影子都在 shader 裡算。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, noise1, lerp } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_EN, HAS_LATIN_NAMES, NAME_A, NAME_B, DATE, joinBits, fitPx, lyricSubOf, subSizeFor, subStyleFor, subGap, type LyricStyle, type LyricLayout } from './_motifs';
import type { Line } from '../engine/lyrics';
import { preloadText, INVITE_SMALL, paperSignal } from './_t19';
import { ensureBake, barsIn, sigInk } from './_t1';
import { placeBlock, drawBlock, sigOf, fitV2, T22_TEXT, type Rect } from './_t22';
import { lyricV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'keepsake', paper: true, energy: [0.15, 0.85], bars: [4, 10], weight: 1 };

/** 酒瓶的半徑（酒標座標的 px；鏡頭 k = 1 時正面 1 px = 螢幕 1 px）。 */
const RW = 720;
/**
 * 酒標攤平的大小（label px）：寬繞瓶身約 190°，高從瓶頸標的上緣到主標的下緣。
 * 主標往下留得比較長：特寫時右下角 HUD（深色字）的後面是紙，不是深色的玻璃，才讀得到。
 */
const LW = 2400, LH = 960;
const RES = 1.25;
/** 瓶頸標（深色，歌詞）與主標（紙）的範圍（v，label px）。 */
const STRIP = { v0: 0, v1: 150 };
/** 有原文的窗格：瓶頸標的下緣（加寬，跟主標之間的玻璃縫從 28 剩 12），中文＋原文兩行才不會貼著燙金線。 */
const STRIP_SUB_V1 = 166;
const MAIN = { v0: 178, v1: LH };
/** 品飲筆記（留言）那一塊（label px，置中在 LW / 2）。 */
const NOTE = { v0: 392, v1: 742, w: 980 };
/**
 * 推近之後的鏡頭：縮放 K1（正面 1 label px = 螢幕 K1 px）、瓶軸在畫面上的 x。
 * 瓶身寬約 1120 px、在畫面偏左（右緣 x ≈ 1350），右下角 HUD 的後面是牆，不是深色的玻璃。
 */
const K1 = 0.78, AX = 770;
/** 年份（婚禮那一年；還沒定日期是空字串，那一段連同分隔符號省掉）。 */
const YEAR = DATE ? `MILLÉSIME ${DATE.yyyy}` : '';
/** 酒莊名：有英文名用「DOMAINE 英文名」大寫、下面一行中文酒莊名；沒有英文名就把中文酒莊名放大到上面那一行。 */
const ESTATE_ZH = `${NAME_A}與${NAME_B}酒莊`;
const TOP1 = HAS_LATIN_NAMES ? `DOMAINE ${COUPLE_EN.toUpperCase()}` : ESTATE_ZH;
const TOP2 = joinBits('  ·  ', YEAR, HAS_LATIN_NAMES ? ESTATE_ZH : 'GRAND CRU CLASSÉ');
/** 酒莊名兩行最寬多寬（label px）：再寬，瓶身轉到側面的字會被壓得很扁。 */
const TOP_MAXW = 760;
const NOTE_T = '品飲筆記  ·  TASTING NOTES';
const BOT1 = 'Appellation Amour Contrôlée';
const BOT2 = '750 ml  ·  百分之百真心  ·  本品一經開瓶，恕不退還';

const PASS = () => new FSPass(/* glsl */ `
  uniform sampler2D lab; uniform sampler2D dyn; uniform sampler2D bake;
  uniform vec4 cam;    // 瓶軸的螢幕 x、H = 0 的螢幕 y、縮放 k、俯角
  uniform float phi;   // 轉盤轉了多少（酒標的角度）
  uniform float sweep; // 紙面光澤掃到的角度
  uniform float sweepK;
  uniform float t;
  const float RW = ${RW}.0;
  const vec2 LAB = vec2(${LW}.0, ${LH}.0);
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${1080}.0 - FRAG_PX.y);
    float k = cam.z, tau = cam.w;
    float Rs = k * RW;
    float s = (p.x - cam.x) / Rs;
    float sc = clamp(s, -0.9995, 0.9995);
    float th = asin(sc), ct = cos(th);
    // 圓柱上的高度（正交鏡頭＋俯角：正面的點在畫面上比兩側低一點，酒標的上下緣才會彎）
    float Hw = (cam.y - p.y + Rs * ct * sin(tau)) / (k * cos(tau));
    vec2 lp = vec2(LAB.x * 0.5 + (th - phi) * RW, 440.0 - Hw); // H = 0 在酒標 v = 440（鏡頭對準的地方）
    vec2 uv = vec2(lp.x / LAB.x, 1.0 - lp.y / LAB.y);
    // mip 層在分支外面算（分支裡的導數沒有定義）
    vec2 tp = lp * ${RES};
    float lod = max(0.0, log2(max(length(dFdx(tp)), length(dFdy(tp)))) - 0.25);

    // ---- 背景：暖色的紙牆，左上一扇窗的光；酒瓶的影子落在右邊的牆上（很柔）
    vec4 bk = texture(bake, vUv);
    vec3 wall = mix(C_PAPER, C_SEPIA, 0.13) * (0.93 + 0.08 * bk.g);
    float win = exp(-pow(length((p - vec2(260.0, 180.0)) / vec2(900.0, 700.0)), 2.0));
    wall *= 0.8 + 0.28 * win;
    float sd = (p.x - (cam.x + Rs * 0.95)) / (Rs * 0.85 + 120.0);
    wall *= 1.0 - 0.16 * exp(-sd * sd) * step(cam.x, p.x);
    wall *= 1.0 - 0.1 * smoothstep(700.0, 1080.0, p.y);

    vec3 col = wall;
    float cover = sat((1.0 - abs(s)) * Rs + 0.5);
    if (cover > 0.0) {
      // ---- 深色玻璃（裝了紅酒）：幾乎是黑的，靠反光看出形狀——窗的長條反光、另一側柔柔的一片、邊緣反射亮的背景
      float fres = pow(1.0 - ct, 2.2);
      vec3 g = mix(C_INK, C_BLOOD, 0.2) * 0.28;
      g += mix(C_BLOOD, C_SIGNAL, 0.25) * 0.16 * smoothstep(0.55, 0.97, abs(s)) * (1.0 - smoothstep(0.97, 1.0, abs(s)));
      float mull = 1.0 - 0.85 * (1.0 - smoothstep(0.0, 0.03, abs(fract(Hw / 420.0 + 0.3) - 0.5)));
      float streak = exp(-pow((s + 0.5) / 0.038, 2.0)) * mull;
      float soft = exp(-pow((s - 0.62) / 0.13, 2.0));
      g += C_BONE * (streak * 1.05 + soft * 0.16) + mix(C_PAPER, C_BONE, 0.5) * fres * 0.5;
      vec3 body = g;
      // ---- 酒標
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        vec4 L = fastLayer(textureLod(lab, uv, lod));
        vec4 D = fastLayer(textureLod(dyn, uv, lod));
        // 窗光從左前方來：右半邊的紙比較暗（圓柱的明暗）；紙的纖維
        vec3 n = vec3(s, 0.0, ct);
        float dif = max(dot(n, normalize(vec3(-0.55, 0.0, 1.0))), 0.0);
        float light = 0.5 + 0.56 * dif;
        vec2 m = abs(mod(lp / vec2(1920.0, 1080.0) + 1.0, 2.0) - 1.0);
        vec4 fb = textureLod(bake, vec2(m.x, 1.0 - m.y), 0.0);
        float fib = 0.92 + 0.14 * fb.r;
        vec3 lab = (L.rgb * (1.0 - D.a) + D.rgb) * light * fib;
        // 紙的光澤：一條寬寬的亮帶（小節線時從左掃到右）＋窗光固定的一條
        float sh = exp(-pow((th - sweep) / 0.16, 2.0)) * sweepK * 0.14 + exp(-pow((s + 0.5) / 0.09, 2.0)) * 0.05;
        lab += C_BONE * sh * L.a;
        // 酒標的厚度：上下緣下面一條很細的影子（壓在玻璃上）
        body = body * (1.0 - L.a) + lab;
      }
      col = mix(wall, body, cover);
    }
    fragColor = vec4(col, 1.0);
  }`, {
  lab: { value: null }, dyn: { value: null }, bake: { value: null },
  cam: { value: new THREE.Vector4(960, 540, 1, 0.12) }, phi: { value: 0 }, sweep: { value: -9 }, sweepK: { value: 0 }, t: { value: 0 },
});

/**
 * 原文副行照「螢幕」字級重排（雙語）：subSizeFor 的 32～56 是螢幕 px，酒標推近之後 1 label px = 螢幕 K1 px，
 * 照 label px 排的原文上了螢幕只剩 26 px。中文不動，原文換成 max(34, subSizeFor(中文的螢幕字級)) ÷ K1，太長就折行、不再縮。
 */
function labelSub(c: CanvasRenderingContext2D, line: Line, st: LyricStyle, lay: LyricLayout): LyricLayout {
  const sub = lyricSubOf(line);
  if (!sub || !lay.sub) return lay;
  const size = Math.max(34, subSizeFor(lay.size * K1)) / K1;
  const sl = layoutLyric(c, sub, { ...subStyleFor(st, lay.size), size, minSize: size });
  const dy = lay.sub.dy - subGap(lay.size, lay.sub.lay.size) + subGap(lay.size, sl.size);
  return { ...lay, sub: { lay: sl, dy }, height: dy + (sl.height - sl.size) + lay.size };
}

export default class WineLabel extends Scene {
  pass = shared('winelabel.pass', PASS);
  /** 酒標：紙、印刷、留言（init 畫一次，有 mipmap）。 */
  lab = this.track(new Layer2D(LW, LH, RES, { fast: true }));
  /** 歌詞（每格畫，同一個酒標座標）。 */
  dyn = this.track(new Layer2D(LW, LH, RES, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  tSpin = 0;
  tPush = 1;
  bars: number[] = [];
  B = 0.5;
  stripLyr: LyricStyle = { family: F.archivo(100, 700), size: V2.lyrMax / K1, minSize: V2.lyrMin / K1, maxWidth: 1300, align: 'center', active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3), lineHeight: 1.08 };
  noteLyr: LyricStyle = { family: F.archivo(100, 800), size: V2.lyrMax / K1, minSize: V2.lyrMin / K1, maxWidth: 1100, align: 'center', lineHeight: 1.14 };
  avoid: Rect[] = [];
  /** 瓶頸標的下緣（有原文的窗格是 STRIP_SUB_V1）。 */
  stripV1 = STRIP.v1;
  /** 手寫的署名（每格畫在 dyn 上，簽上去的進度用遮罩）：位置、字級、開始與結束時間。 */
  sig: { text: string; x: number; y: number; w: number; size: number; t0: number; t1: number } | null = null;

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    const m = this.msg;
    // 有留言的窗格歌詞在瓶頸標上：這個窗格有原文就把瓶頸標加寬（在第一個 await 之前看：原文開關是引擎在 init 前設的）
    if (m && this.ctx.lyrics.linesIn(s - 1, e + 1).some((l) => lyricSubOf(l))) this.stripV1 = STRIP_SUB_V1;
    await preloadText(this.ctx, `${m ? m.text + sigOf(m) : ''}${T22_TEXT}${INVITE_SMALL}${TOP1}${TOP2}${NOTE_T}${BOT1}${BOT2}`);
    for (const L of [this.lab, this.dyn]) { L.texture.generateMipmaps = true; L.texture.minFilter = THREE.LinearMipmapLinearFilter; }
    this.noteLyr = { ...this.noteLyr, active: paperSignal(), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.26) };
    this.B = au.beatPeriod(s + 0.1);
    // 第一拍轉盤一轉；鏡頭推近花大約一小節（窗格短就短一點）
    this.tSpin = beatAfter(au, s + Math.min(0.3, this.B * 0.6));
    const bars = barsIn(au, this.tSpin + 0.1, e);
    const barLen = bars.length > 1 ? bars[1]! - bars[0]! : this.B * 4;
    this.tPush = Math.min(barLen * 0.9, (e - this.tSpin) * 0.35, 2.2);
    this.bars = bars.filter((b) => b > this.tSpin + this.tPush + 0.3);
    this.drawLabel();
    // 署名：推近之後的下一拍開始簽（窗格短就簽快一點）
    if (this.sig) {
      const t0 = beatAfter(au, this.tSpin + this.tPush * 0.8);
      this.sig.t0 = t0;
      this.sig.t1 = t0 + clamp(Math.min(this.B * 2, (e - t0) * 0.25), 0.35, 1.1);
    }
    this.avoid = [[320, 270, 940, 430], [300, 200, 1000, 130]];
  }

  /** 酒標的紙與印刷（label px；中線 x = LW / 2）。 */
  private drawLabel() {
    const L = this.lab, c = L.ctx, m = this.msg;
    L.clear();
    const cx = LW / 2;
    // ---- 瓶頸標：深色的紙、上下兩條燙金細線
    c.fillStyle = mixRgba('sepia', 'ink', 0.2);
    c.fillRect(0, STRIP.v0, LW, this.stripV1 - STRIP.v0);
    c.fillStyle = rgba('signal', 0.85);
    c.fillRect(0, STRIP.v0 + 12, LW, 1.6); c.fillRect(0, this.stripV1 - 14, LW, 1.6);
    // ---- 主標：紙（比牆亮一點）、雙細框
    c.fillStyle = mixRgba('paper', 'bone', 0.35);
    c.fillRect(0, MAIN.v0, LW, MAIN.v1 - MAIN.v0);
    c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 1.4;
    for (const [a, b] of [[MAIN.v0 + 26, MAIN.v1 - 26], [MAIN.v0 + 34, MAIN.v1 - 34]] as [number, number][]) {
      c.beginPath(); c.moveTo(0, a); c.lineTo(LW, a); c.moveTo(0, b); c.lineTo(LW, b); c.stroke();
    }
    // 上方：一小段葡萄藤（兩條捲鬚繞成一顆心）、酒莊名、年份
    this.vine(c, cx, 238);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('sepia', 0.9);
    // 名字很長（DOMAINE CHRISTOPHER & ALEXANDRA）就縮字、字距跟著縮
    const t1 = fitPx(TOP1, F.serif(600), 26, TOP_MAXW, 9), t2 = fitPx(TOP2, F.mono(500), 15, TOP_MAXW, 4);
    c.font = font(F.serif(600), t1); c.letterSpacing = `${(9 * t1) / 26}px`; c.fillText(TOP1, cx + 4, 300);
    c.font = font(F.mono(500), t2); c.letterSpacing = `${(4 * t2) / 15}px`; c.fillStyle = rgba('sepia', 0.62); c.fillText(TOP2, cx + 2, 328);
    c.fillStyle = sigInk(0.95); c.font = font(F.mono(600), 15); c.letterSpacing = '5px'; c.fillText(NOTE_T, cx + 2, 368);
    c.letterSpacing = '0px';
    // ---- 品飲筆記：主打留言（宋體、置中），署名手寫
    let msgScreen: number | null = null;
    if (m) {
      // 留言標準 v2：畫面上 40～60 px（依字數）；推近之後正面 1 label px = 螢幕 K1 px，所以酒標上的字級 = 畫面字級 ÷ K1
      const fam = F.ming(700), sfam = F.hand(700), sig = sigOf(m);
      const blk = fitV2(c, m.text, fam, NOTE.w, NOTE.v1 - NOTE.v0 - 10, K1, { lineHeight: 1.32 });
      msgScreen = blk.fit.size * K1;
      const top = NOTE.v0 + 10 + Math.max(0, (NOTE.v1 - NOTE.v0 - 10 - blk.height) * 0.45);
      const pl = placeBlock(c, blk, fam, sig, cx, top, { align: 'center', sigFamily: sfam, sigAlign: 'center' });
      // 署名先不印：render 時一筆一筆簽上去（dyn 圖層）
      drawBlock(c, blk, pl, fam, '', { color: rgba('sepia', 0.95), sigColor: rgba('sepia', 0.8), sigFamily: sfam });
      this.sig = { text: sig, x: pl.sig.x, y: pl.sig.y, w: pl.sig.w, size: blk.sigSize, t0: 0, t1: 1 };
      if (m.couple) {
        c.textAlign = 'center'; c.font = font(F.mono(600), 15); c.letterSpacing = '5px'; c.fillStyle = sigInk(0.95);
        c.fillText('FROM THE COUPLE  ·  新人', cx + 2, top - 2);
        c.letterSpacing = '0px';
      }
    } else {
      c.textAlign = 'center'; c.fillStyle = rgba('sepia', 0.7);
      const fit = fitText(c, INVITE_SMALL, F.ming(700), 1000, 60, { min: 30, max: 38 });
      c.font = font(F.ming(700), fit.size);
      c.fillText(INVITE_SMALL, cx, NOTE.v1 - 30);
    }
    this.stripLyr = { ...this.stripLyr, size: lyricV2(msgScreen) / K1 };
    // ---- 下緣：愛情法定產區（冷面小字）
    c.textAlign = 'center';
    c.fillStyle = rgba('sepia', 0.8); c.font = font(F.serif(600, true), 24); c.letterSpacing = '2px'; c.fillText(BOT1, cx, 806);
    c.fillStyle = rgba('sepia', 0.55); c.font = font(F.mono(500), 13); c.letterSpacing = '3px'; c.fillText(BOT2, cx + 2, 834);
    c.letterSpacing = '0px'; c.textAlign = 'left';
    L.upload();
  }

  /** 葡萄藤小飾：兩條捲鬚從中間往兩邊長、在中間繞成一顆心，幾片葉子（細線、墨色、很小）。 */
  private vine(c: CanvasRenderingContext2D, x: number, y: number) {
    c.save();
    c.translate(x, y);
    c.strokeStyle = rgba('sepia', 0.55); c.lineWidth = 1.3; c.lineCap = 'round';
    for (const d of [-1, 1]) {
      c.beginPath(); c.moveTo(0, 16);
      c.bezierCurveTo(d * 26, -8, d * 12, -26, 0, -10);
      c.stroke();
      c.beginPath(); c.moveTo(d * 18, 4);
      c.bezierCurveTo(d * 70, 14, d * 110, -12, d * 170, 2);
      c.stroke();
      for (let i = 0; i < 3; i++) {
        const lx = d * (60 + i * 40), ly = 6 - i * 4;
        c.beginPath(); c.ellipse(lx, ly - 6, 7, 3.2, d * (0.5 + i * 0.2), 0, Math.PI * 2); c.stroke();
      }
      c.beginPath(); c.arc(d * 176, -4, 5, 0.5, 5.8); c.stroke();
    }
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;

    // ---- 歌詞（每格畫在酒標座標上）
    const D = this.dyn, c = D.ctx;
    D.clear();
    const cx = LW / 2;
    const ly = lyricAt(lyrics, t);
    if (this.msg || !ly) {
      if (ly) {
        let st = this.stripLyr, lay = labelSub(c, ly.line, st, layoutLyric(c, ly.line, st));
        const mid = (STRIP.v0 + this.stripV1) / 2;
        if (lay.sub) {
          // 雙語：中文＋原文整塊（中文字頂到原文字腳）在兩條燙金線中間置中；放不下就把中文縮小一點（不小於 40 螢幕 px）
          const room = this.stripV1 - STRIP.v0 - 34, minSize = st.minSize ?? st.size;
          const depth = (l: LyricLayout) => 0.86 * l.size + l.height - l.size + 0.22 * (l.sub?.lay.size ?? 0);
          for (let sz = st.size; depth(lay) > room && sz > minSize;) {
            sz = Math.max(minSize, sz * 0.95);
            st = { ...st, size: sz };
            lay = labelSub(c, ly.line, st, layoutLyric(c, ly.line, st));
          }
          c.save(); c.translate(cx, mid - depth(lay) / 2 + 0.86 * lay.size);
        } else {
          c.save(); c.translate(cx, mid + lay.size * 0.36 - (lay.rows.length - 1) * lay.size * 0.55);
        }
        drawLyric(c, ly.line, t, st, lay, ly.k);
        c.restore();
      } else {
        // 間奏、純音樂：瓶頸標上是歌名（小字）
        c.textAlign = 'center'; c.font = font(F.mono(500), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('bone', 0.72);
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, cx, (STRIP.v0 + STRIP.v1) / 2 + 7);
        c.letterSpacing = '0px'; c.textAlign = 'left';
      }
    }
    if (!this.msg && ly) {
      // 沒有留言：品飲筆記印的是歌詞（主角）；瓶頸標寫歌名
      const lay = labelSub(c, ly.line, this.noteLyr, layoutLyric(c, ly.line, this.noteLyr));
      // 韓文歌（drawLyric 把原文畫在中文下面）：整組（到原文最後一排）一起置中，原文才不會壓到下面那行邀請
      const lift = lay.sub ? (lay.height - lay.size) / 2 : (lay.rows.length - 1) * lay.size * 0.57;
      c.save(); c.translate(cx, (NOTE.v0 + NOTE.v1) / 2 - 10 + lay.size * 0.35 - lift);
      drawLyric(c, ly.line, t, this.noteLyr, lay, ly.k);
      c.restore();
    }
    // 手寫的署名：從左往右簽上去（筆尖後面的墨是實的，前面還沒寫到的擦掉，邊緣柔一點）
    const sg = this.sig;
    if (sg && t > sg.t0) {
      const q = ease.outQuad(clamp((t - sg.t0) / (sg.t1 - sg.t0)));
      c.save();
      c.textAlign = 'left'; c.font = font(F.hand(700), sg.size); c.fillStyle = rgba('sepia', 0.8);
      c.fillText(sg.text, sg.x, sg.y);
      if (q < 1) {
        const ex = sg.x - 10 + (sg.w + 20) * q;
        const g = c.createLinearGradient(ex - 14, 0, ex + 4, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
        c.globalCompositeOperation = 'destination-out';
        c.fillStyle = g;
        c.fillRect(ex - 14, sg.y - sg.size * 1.1, sg.w + 40, sg.size * 1.5);
      }
      c.restore();
    }
    if (!this.msg && !ly) {
      // 沒有留言又在間奏：品飲筆記那一塊不要整片空白
      c.textAlign = 'center'; c.font = font(F.ming(700), 50); c.fillStyle = rgba('sepia', 0.32);
      c.fillText(lyrics.has ? '♪（間奏中）' : '♪ 本曲為純音樂', cx, (NOTE.v0 + NOTE.v1) / 2 + 10);
      c.textAlign = 'left';
    }
    if (!this.msg && ly) {
      c.textAlign = 'center'; c.font = font(F.mono(500), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('bone', 0.72);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, cx, (STRIP.v0 + STRIP.v1) / 2 + 7);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    D.upload();

    // ---- 轉盤與鏡頭
    const u = clamp((t - this.tSpin) / 0.75);
    const settle = t > this.tSpin ? 0.035 * Math.exp(-(t - this.tSpin - 0.5) * 3.5) * Math.sin((t - this.tSpin) * 9) * clamp((t - this.tSpin - 0.35) / 0.2) : 0;
    const phi0 = -2.05 + 0.06 * (t - s);
    // 轉到正面之後，轉盤很慢地來回轉一點點（酒標左右漂、瓶身的反光跟著走；字一直讀得到）
    const drift = 0.04 * Math.sin((t - this.tSpin - 0.75) * 0.55) * clamp((t - this.tSpin - 0.75) / 1.5);
    const phi = lerp(phi0, 0, ease.outExpo(u)) + settle + 0.012 * noise1(t * 0.4, 5) + drift;
    const push = ease.inOutCubic(prog(t, this.tSpin, this.tSpin + this.tPush));
    const k = lerp(0.56, K1, push) * (1 + 0.035 * ease.inOutQuad(prog(t, this.tSpin + this.tPush, e)));
    const tau = lerp(0.24, 0.12, push);
    const P = this.pass;
    P.u.lab!.value = this.lab.texture;
    P.u.dyn!.value = D.texture;
    P.u.bake!.value = ensureBake(renderer);
    (P.u.cam!.value as THREE.Vector4).set(lerp(900, AX, push), 560 - k * RW * Math.sin(tau) + lerp(30, 0, push), k, tau);
    P.u.phi!.value = phi;
    // 小節線：紙面的光澤從左掃到右
    let sw = -9, swK = 0;
    for (const b of this.bars) if (t >= b && t < b + 0.9) { const q = ease.outCubic((t - b) / 0.9); sw = lerp(-1.3, 1.3, q); swK = Math.sin(Math.PI * q); }
    P.u.sweep!.value = sw;
    P.u.sweepK!.value = swK;
    P.u.t!.value = t;
    P.render(renderer, out);
    const kick = pulse(t, this.tSpin, 0.12);
    return { paper: 1, bloom: 0.25, bloomThreshold: 1.4, halation: 0.05, vignette: 0.32, grain: 0.05, zoom: 1 + 0.004 * kick, popupAvoid: this.avoid };
  }
}
