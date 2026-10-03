// 仙女棒寫字（照 pdoom 的 open / fuse：火花是整支影片的主角，拖著一條線把字寫出來）。
// 暗色的信紙：細橫線對齊字的基線、左邊一條訊號色的邊線。仙女棒從第一個拍點開始，一個字一個字把主打留言寫出來，
// 剛寫好的字是燒紅的（訊號色、會發光），約一秒冷卻成紙白；寫完再用同一支筆簽名。
// 上方是「信頭」：正在唱的那行歌詞（逐字跟唱，比留言小一級），下面一條細線跟著大鼓呼吸。
// 沒有留言的窗格：仙女棒改成跟著歌聲寫歌詞（唱到哪寫到哪），信頭放歌名。
// 依「MV 融合原則」調整：
//  - 仙女棒是真的光源：筆尖附近的信紙被照亮（暖暖的一團光，橫線在光裡比較清楚），寫完光慢慢熄掉——
//    暗房間裡只有一支仙女棒在寫字，畫面自然只有一個焦點。
//  - 留言可以用整個寬度（右邊不用再替即時小卡留空）；信紙的橫線與邊線在四周淡出，不是一個方框。
//  - 拿掉角落的編號（只剩新人留言的小標）；鏡頭整個窗格慢慢推近。
// v2（「留言尺寸與版面比例標準 v2」）：
//  - 信紙縮成左邊一張 860×430 的暗色紙（留言 40～60 px、署名 26～32、信頭的歌詞 40～52，不比留言大）；
//    沒有留言時仙女棒寫的歌詞也是 40～52。
//  - 空出來的畫面是一個夜裡的陽台（場景是主視覺，一直在動）：上方一串失焦的小燈泡（跟 hi-hat 一閃一閃、在風裡輕輕晃），
//    右邊一個玻璃罐插著一把仙女棒——從第一個小節線起，每個小節點燃一支（那一下閃亮），點著的慢慢往下燒、噴火星，
//    照亮罐子四周；寫字的那支仙女棒冒出一縷煙往上飄。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type Msg, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, type TextLayout } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse } from '../engine/util';
import { LIN } from '../engine/palette';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, lyricSubOf, drawLyricSub, beatAfter, barAfter, signature, drawHeart } from './_motifs';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
// 最早的版面：排程參數在 director.ts 的 PLATES；這裡只宣告雙語（雙語普查通過：有翻譯＋主打留言時中文、原文、留言三樣都清楚）
export const spec: PlateSpecDecl = { bilingual: true };


/** 信紙（860×430，v2 的留言區上限）與紙上寫字的框（下面留 80 給簽名）。 */
const SHEET = { x0: 120, y0: 330, x1: 980, y1: 760 };
const BOX = { x: 170, y: 356, w: 770, h: 390 };
/** 信頭（歌詞或歌名）的基線與它下面那條細線（在信紙上方）。 */
const HEAD_Y = 250, RULE_Y = 284;
/** 簽名的基線最低到這裡（信紙裡面）。 */
const SIG_MAX_Y = 736;
/** 玻璃罐（畫面右邊）：罐底中心、罐身寬高；仙女棒從罐口插出來。右下角 HUD（y ≥ 830）在它下面。 */
const JAR = { x: 1480, y: 792, w: 150, h: 190 };
/** 罐子裡的仙女棒：棒子的傾斜（弧度）、長度、上面塗藥的那一段有多長。 */
const STICKS = [[-0.34, 470], [-0.16, 520], [0.02, 500], [0.19, 530], [0.36, 460]] as const;
const COAT = 0.62;
/** 一支仙女棒從頂端燒到塗藥那一段的底要幾秒。 */
const BURN = 14;
const SKEW = 0.6; // 寫字的掃描線斜度（由左上往右下，像筆順）
const COOL = 0.9; // 字從燒紅冷卻到紙白要幾秒
/** 仙女棒停下來之後，照在紙上的光幾秒熄掉。 */
const EMBER = 0.5;

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float gap; uniform float y0; uniform float k; uniform float margin;
  uniform vec2 pen; uniform float penI;
  uniform vec3 jar;                 // 罐子裡燒著的仙女棒照出來的光：x、y、強度
  uniform float hat;                // hi-hat：小燈泡一閃
  uniform float hatIdx;
  const vec4 SH = vec4(${SHEET.x0}.0, ${SHEET.y0}.0, ${SHEET.x1}.0, ${SHEET.y1}.0);
  // 一串小燈泡：懸在上方的一條弧線上，失焦成一顆顆圓圓的光（邊緣稍亮，像鏡頭的散景）
  float bokeh(vec2 p, float t, out float warm) {
    float acc = 0.0; warm = 0.0;
    for (int i = 0; i < 13; i++) {
      float fi = float(i);
      // 燈串從左上角掛到右上角，中間垂下來一點；在風裡輕輕晃
      float x = 60.0 + fi * 150.0 + 10.0 * sin(t * 0.6 + fi * 1.7);
      float u = (x - 1000.0) / 1100.0;
      float y = 40.0 + 90.0 * (1.0 - u * u) + 6.0 * sin(t * 0.8 + fi);
      float r = 14.0 + 7.0 * hash11(fi + 3.0);
      float d = length(p - vec2(x, y));
      float disc = 1.0 - smoothstep(r - 2.5, r + 2.5, d);
      float rim = exp(-pow((d - r + 2.5) / 2.2, 2.0)) * 0.35;
      float tw = 0.75 + 0.25 * sin(t * (1.1 + hash11(fi) * 1.7) + fi * 2.3) + 0.8 * hat * step(0.75, hash12(vec2(fi, hatIdx)));
      acc += (disc * 0.6 + rim) * tw;
      warm += exp(-d / 90.0) * tw;
    }
    return acc;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // 轉成 y 向下，跟 Canvas2D 一樣
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.35 + 0.35 * fbm(p / 380.0 + vec2(t * 0.015, 0.0), 4));
    // 遠方：陽台外面的夜景，一排很淡、很糊的光點（在下半部）
    // 一格一顆：只在格子中間畫一團柔柔的光（不是方塊）
    vec2 cq = vec2(p.x / 46.0 + t * 0.02, (p.y - 600.0) / 34.0);
    vec2 cc = fract(cq) - 0.5;
    float city = step(0.8, hash12(floor(cq))) * exp(-dot(cc, cc) * 18.0) * exp(-pow((p.y - 640.0) / 70.0, 2.0));
    col += mix(C_EMBER, C_BONE, 0.4) * 0.05 * city * k;
    // 小燈泡
    float warm;
    float bk = bokeh(p, t, warm);
    col += mix(C_EMBER, C_BLOOD, 0.25) * 0.26 * bk * k + C_SIGNAL * 0.005 * warm * k;
    // 仙女棒照出來的光：寫字的那支（筆尖）與罐子裡燒著的
    float r = length(p - pen);
    float pl = penI * (0.5 * exp(-r / 150.0) + 0.5 * exp(-r / 460.0));
    float rj = length(p - jar.xy);
    float jl = jar.z * (0.5 * exp(-rj / 140.0) + 0.5 * exp(-rj / 420.0));
    col += C_SIGNAL * 0.08 * (pl + jl) + (C_INK2 - C_INK) * 0.9 * (pl + jl);
    // 信紙：比背景亮一點的暗色紙，四周一圈柔柔的影子，被仙女棒照到的地方亮一點
    vec2 sc = (SH.xy + SH.zw) * 0.5, sh = (SH.zw - SH.xy) * 0.5;
    float sd = sdBox(p - sc, sh);
    float onSheet = 1.0 - smoothstep(-1.0, 1.0, sd);
    col *= 1.0 - 0.35 * exp(-max(sd, 0.0) / 26.0) * (1.0 - onSheet);
    vec3 paper = mix(C_INK2, C_GRAPHITE, 0.035) * (0.88 + 0.12 * fbm(p / 90.0, 2)) * (1.05 - 0.12 * (p.y - SH.y) / (SH.w - SH.y)) + C_SIGNAL * 0.06 * pl + (C_INK2 - C_INK) * 1.2 * pl;
    col = mix(col, paper, onSheet * k);
    // 橫線：對齊字的基線，只在信紙上，在光裡比較清楚
    float d = abs(mod(p.y - y0 + gap * 0.5, gap) - gap * 0.5);
    float page = onSheet * smoothstep(SH.x + 20.0, SH.x + 40.0, p.x) * (1.0 - smoothstep(SH.z - 40.0, SH.z - 20.0, p.x)) * step(SH.y + 20.0, p.y) * step(p.y, SH.w - 16.0);
    col += C_BONE * pxLine(d, 0.35, 1.2) * (0.045 + 0.12 * pl) * page * k;
    // 左邊的邊線（訊號色，很淡）
    col += C_SIGNAL * pxLine(abs(p.x - margin), 0.35, 1.2) * (0.16 + 0.3 * pl) * k * onSheet * step(SH.y + 16.0, p.y) * step(p.y, SH.w - 16.0);
    // 陽台的矮牆：信紙與罐子都擺在牆頂上；牆頂一條被光照到的邊，下面是暗暗的石頭
    if (p.y > 792.0) {
      vec3 stone = C_INK * (0.9 + 0.2 * fbm(p / vec2(120.0, 30.0), 2)) + (C_INK2 - C_INK) * 0.9 * (pl + jl);
      stone += C_ASH * 0.05 * exp(-(p.y - 792.0) / 3.0) * (0.5 + pl + jl);
      col = mix(col, stone, smoothstep(791.0, 793.0, p.y));
    }
    // 寫字那支仙女棒冒出來的一縷煙：從筆尖往上飄、慢慢散開
    vec2 sq = p - pen;
    if (penI > 0.01 && sq.y < 20.0 && sq.y > -520.0) {
      float up = -sq.y;
      float wx = sq.x - 30.0 * sin(up / 90.0 - t * 1.4) - up * 0.12;
      float wd = 10.0 + up * 0.22;
      float smoke = exp(-wx * wx / (wd * wd)) * smoothstep(0.0, 40.0, up) * (1.0 - smoothstep(200.0, 520.0, up));
      smoke *= 0.6 + 0.4 * fbm(vec2(sq.x / 40.0, (up + t * 60.0) / 60.0), 2);
      col += C_ASH * 0.05 * smoke * penI;
    }
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, gap: { value: 90 }, y0: { value: 400 }, k: { value: 1 }, margin: { value: SHEET.x0 + 30 },
  pen: { value: new THREE.Vector2(-9999, -9999) }, penI: { value: 0 },
  jar: { value: new THREE.Vector3(-9999, -9999, 0) }, hat: { value: 0 }, hatIdx: { value: 0 },
});

interface Glyphs { lay: TextLayout; x: number; y: number; t0: number; t1: number }

/** 畫一個字；♥ 換成我們自己畫的愛心（字型裡的 ♥ 每套字長得不一樣，TREATMENT 規定只用 drawHeart）。 */
function glyph(c: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, size: number, color: string) {
  if (ch === '♥') { drawHeart(c, x + w / 2, y - size * 0.36, Math.min(w, size) * 0.78, color); return; }
  c.fillStyle = color;
  c.fillText(ch, x, y);
}
type P2 = { x: number; y: number };
/** 沒有留言時一行歌詞的排版（每一行只排一次）。 */
/**
 * 沒有留言時一行歌詞的排版（每一行只排一次）。每個字記下它在歌詞原文裡的位置（UTF-16，跟 lineCharProgress 同一套）
 * 與唱完的時間：斷行時吃掉的空白不會讓後面的字對不上，唱完的字也能照時間從燒紅冷卻。
 */
interface LyricGlyph { ch: string; x: number; w: number; row: number; off: number; len: number; done: number }
interface LyricSet { fit: FitResult; glyphs: LyricGlyph[]; top: number }

export default class Sparkler extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 燒紅的字另外畫一層、加亮疊上去才會發光（低解析度就夠，本來就是一團光）。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  bg = shared('sparkler.bg', BG);
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  lines: Glyphs[] = [];
  sig: Glyphs | null = null;
  writeEnd = 0;
  /** 罐子裡每支仙女棒點燃的時間（Infinity = 這個窗格不點）。 */
  ignite: number[] = [];
  private lyricSets = new Map<Line, LyricSet>();

  /** 信紙橫線的基線與間距：有留言對齊留言；沒有留言對齊窗格裡第一句歌詞（之後字級不同的句子就讓它不對齊）。 */
  gridY0 = 560; gridGap = 120;

  override async init() {
    const { audio: au, lyrics, start, end } = this.ctx;
    // 罐子裡的仙女棒：第一個小節線點第一支，之後每個小節點一支（最後一支在窗格結束前一拍以上）
    const seed = Number(this.ctx.params.seed ?? 1);
    const times = STICKS.map((_, k) => { const tb = barAfter(au, start + 0.2, k); return tb < end - 0.5 ? tb : Infinity; });
    // 點的順序不要照左到右（種子打亂）：第 k 個時間點點 order[k] 那一支
    const order = STICKS.map((_, i) => i).sort((a, b) => ((a * 7 + seed) % 5) - ((b * 7 + seed) % 5));
    this.ignite = STICKS.map((_, i) => times[order.indexOf(i)]!);
    if (!this.msg) {
      // 歌詞的排版會快取：先把這個窗格會寫到的字載好，量字寬才不會量到備援字型
      const ls = lyrics.linesIn(start - 2, end);
      await loadText(ls.map((l) => l.text).join('') + this.ctx.song.title + (this.ctx.song.artist ?? ''));
      const first = lyrics.linesIn(start, end)[0];
      if (first) { const set = this.lyricSet(first); this.gridY0 = set.top; this.gridGap = set.fit.lineHeight; }
      return;
    }
    const c = this.layer.ctx;
    const family = F.hand(400);
    // v2：字級照字數（短句 60、長留言 44），照標點斷行；框的高度扣掉簽名那一列
    const o = { min: V2.msgMin, max: msgMaxFor(this.msg.text), lineHeight: 1.42, maxLines: 5 };
    const byW = fitText(c, this.msg.text, family, BOX.w, BOX.h - 80, o), byC = fitClauses(c, this.msg.text, family, BOX.w, BOX.h - 80, o);
    this.fit = byC && byC.size >= byW.size * 0.9 ? byC : byW;
    const fit = this.fit;
    // 從第一個拍點開始寫；一個字約 0.085 秒，整則 1.4～4.5 秒寫完
    const n = fit.lines.reduce((s, l) => s + Array.from(l).length, 0);
    const t0 = beatAfter(au, this.ctx.start + 0.15);
    const dur = clamp(0.085 * n + 0.6, 1.4, 4.5);
    let acc = 0;
    const top = BOX.y + (BOX.h - 80 - fit.height) / 2 + fit.size;
    this.lines = fit.lines.map((ln, i) => {
      const lay = layout(ln, family, fit.size);
      const k = Array.from(ln).length;
      const g = { lay, x: BOX.x, y: top + i * fit.lineHeight, t0: t0 + (dur * acc) / n, t1: t0 + (dur * (acc + k)) / n };
      acc += k;
      return g;
    });
    this.writeEnd = t0 + dur;
    // 簽名：寫完後停半拍，靠右寫在最後一行下面
    const sigSize = sigV2(fit.size);
    const sl = layout(signature(this.msg.name), family, sigSize);
    const last = this.lines[this.lines.length - 1]!;
    const s0 = this.writeEnd + au.beatPeriod(this.writeEnd) * 0.5;
    this.sig = { lay: sl, x: Math.min(BOX.x + BOX.w - sl.width, BOX.x + Math.max(...this.lines.map((l) => l.lay.width)) - sl.width + 20), y: Math.min(last.y + fit.size * 0.35 + sigSize * 1.3, SIG_MAX_Y), t0: s0, t1: s0 + clamp(0.07 * sl.glyphs.length + 0.3, 0.6, 1.4) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.5), exit = prog(t, e - 0.6, e, ease.inCubic);
    const fit = this.fit;
    // 先畫字（要知道筆尖在哪，信紙的光才打得對），再畫底、疊上去
    const L = this.layer, HL = this.hot;
    L.clear(); HL.clear();
    const c = L.ctx, hc = HL.ctx;
    this.glow.clear();
    c.globalAlpha = hc.globalAlpha = fadeIn * (1 - exit);
    let pen: P2 | null = null;

    // 信頭：正在唱的歌詞（第二層，比留言小一級）；沒有留言時信頭放歌名（歌詞由仙女棒寫在信紙上）
    const ly = lyricAt(lyrics, t);
    if (this.msg && ly) {
      const st = { family: F.archivo(100, 800), size: lyricV2(fit ? fit.size : null), minSize: V2.lyrMin, maxWidth: SHEET.x1 - SHEET.x0 + 120 };
      c.save(); c.translate(SHEET.x0, HEAD_Y);
      drawLyric(c, ly.line, t, st, layoutLyric(c, ly.line, st), ly.k);
      c.restore();
    } else if (!this.msg) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.7);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), SHEET.x0, HEAD_Y);
      c.letterSpacing = '0px';
    }
    // 信頭下的細線：大鼓一打就亮一下（很淡，兩端淡出）
    const kick = f.a.kick;
    const rg = c.createLinearGradient(SHEET.x0, 0, SHEET.x1 + 60, 0);
    rg.addColorStop(0, rgba('bone', 0.1 + 0.3 * kick)); rg.addColorStop(0.75, rgba('bone', 0.08 + 0.2 * kick)); rg.addColorStop(1, rgba('bone', 0));
    c.fillStyle = rg;
    c.fillRect(SHEET.x0, RULE_Y, SHEET.x1 - SHEET.x0 + 60, 1 + kick * 1.5);

    let light: { p: P2; k: number } | null = null;
    if (this.msg && fit) {
      for (const g of this.lines) pen = this.write(c, hc, g, t, fit.size) ?? pen;
      if (this.sig) pen = this.write(c, hc, this.sig, t, this.sig.lay.size, rgba('ash')) ?? pen;
      // 新人自己的留言：信頭右邊一個很小的標籤
      if (this.msg.couple) {
        c.textAlign = 'right';
        c.font = font(F.mono(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.8 * prog(t, s + 0.3, s + 0.9));
        c.fillText('FROM THE COUPLE  ·  新人', SHEET.x1, RULE_Y + 30);
        c.letterSpacing = '0px'; c.textAlign = 'left';
      }
      light = this.msgLight(t);
    } else {
      pen = this.writeLyric(c, hc, t);
      light = this.lyricLight(t);
    }

    this.bg.u.t!.value = t;
    this.bg.u.gap!.value = fit ? fit.lineHeight : this.gridGap;
    this.bg.u.y0!.value = this.lines[0]?.y ?? this.gridY0;
    this.bg.u.k!.value = fadeIn * (1 - exit);
    (this.bg.u.pen!.value as THREE.Vector2).set(light ? light.p.x : -9999, light ? light.p.y : -9999);
    this.bg.u.penI!.value = light ? light.k * (1 - exit) : 0;
    this.bg.u.hat!.value = f.a.hat;
    this.bg.u.hatIdx!.value = Math.floor(t * 8);
    const jarHeads = this.drawJar(c, t);
    const jl = jarHeads.reduce((a, h) => a + h.k, 0);
    const jx = jl > 0 ? jarHeads.reduce((a, h) => a + h.x * h.k, 0) / jl : -9999, jy = jl > 0 ? jarHeads.reduce((a, h) => a + h.y * h.k, 0) / jl : -9999;
    (this.bg.u.jar!.value as THREE.Vector3).set(jx, jy, Math.min(1.3, jl * 0.55) * (1 - exit) * fadeIn);
    this.bg.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.9, 1.9, 1.9] });
    if (pen && exit < 0.5) {
      const p = pen;
      sparkParticles(this.glow, t, () => p, { rate: 110, life: 0.4, speed: 230, seed: this.ctx.params.seed ?? 1 });
      sparkHead(this.glow, p.x, p.y, t, 1.05);
    }
    // 罐子裡燒著的仙女棒：頭上的火花、四散的火星；剛點著的那一下閃大一點
    jarHeads.forEach((h, i) => {
      if (h.k <= 0.01 || exit >= 0.5) return;
      sparkParticles(this.glow, t, (tb) => this.jarHead(i, tb), { rate: 55, life: 0.36, speed: 170, seed: 31 + i * 7, intensity: 0.8 * h.k });
      sparkHead(this.glow, h.x, h.y, t, 0.7 + 0.8 * h.flash, h.k);
    });
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭整個窗格慢慢推近（後製的 zoom 不影響角落 QR）
    return { bloom: 0.75, vignette: 0.55, zoom: 1 + 0.04 * ease.inOutQuad(f.p) };
  }

  /** 第 i 支仙女棒的棒子：罐口的位置、方向、長度。 */
  private stick(i: number) {
    const [a, len] = STICKS[i]!;
    const bx = JAR.x + (i - 2) * 16, by = JAR.y - JAR.h + 34;
    return { bx, by, dx: Math.sin(a), dy: -Math.cos(a), len };
  }

  /** 第 i 支仙女棒在 tb 時燒到哪裡（螢幕 px）；還沒點、或燒完了是 null。 */
  private jarHead(i: number, tb: number) {
    const t0 = this.ignite[i]!;
    if (!(tb >= t0)) return null;
    const u = (tb - t0) / BURN;
    if (u >= 1) return null;
    const S = this.stick(i), along = S.len * (1 - COAT * u);
    return { x: S.bx + S.dx * along, y: S.by + S.dy * along };
  }

  /**
   * 右邊的玻璃罐與一把仙女棒（每格畫：幾條線而已）。點著的那支：頭上是火花（另外畫在發光層），
   * 燒過的地方變成細細的灰色鐵絲、還沒燒的塗藥段是深灰色。回傳每支燒著的頭與亮度。
   */
  private drawJar(c: CanvasRenderingContext2D, t: number): { x: number; y: number; k: number; flash: number }[] {
    const heads: { x: number; y: number; k: number; flash: number }[] = [];
    c.save();
    c.lineCap = 'round';
    STICKS.forEach((_, i) => {
      const S = this.stick(i), t0 = this.ignite[i]!;
      const u = t >= t0 ? clamp((t - t0) / BURN) : 0;
      const top = S.len, coat0 = S.len * (1 - COAT), burnt = S.len * (1 - COAT * u);
      const P = (d: number) => ({ x: S.bx + S.dx * d, y: S.by + S.dy * d });
      // 鐵絲（整支）
      const a = P(-60), b = P(top);
      c.strokeStyle = rgba('ash', 0.55); c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      // 還沒燒的塗藥段（比鐵絲粗、深灰色，燒過的地方沒有）
      const c0 = P(coat0), c1 = P(burnt);
      c.strokeStyle = mixRgba('graphite', 'ink', 0.3, 0.95); c.lineWidth = 6;
      c.beginPath(); c.moveTo(c0.x, c0.y); c.lineTo(c1.x, c1.y); c.stroke();
      if (t >= t0 && u < 1) {
        const h = P(burnt);
        // 燒過的那一小段還是紅的（冷卻中）
        const hot = P(Math.min(top, burnt + 26));
        c.strokeStyle = rgba('signal', 0.8); c.lineWidth = 2.6;
        c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(hot.x, hot.y); c.stroke();
        const flash = pulse(t, t0, 0.25);
        const k = prog(t, t0, t0 + 0.08) * (1 - prog(u, 0.92, 1)) * (0.85 + 0.15 * Math.sin(t * 31 + i));
        heads.push({ x: h.x, y: h.y, k, flash });
      }
    });
    // 玻璃罐：半透明的罐身、罐口一圈橢圓、左邊一道反光
    const x0 = JAR.x - JAR.w / 2, y0 = JAR.y - JAR.h;
    const g = c.createLinearGradient(x0, 0, x0 + JAR.w, 0);
    g.addColorStop(0, rgba('bone', 0.07)); g.addColorStop(0.5, rgba('bone', 0.02)); g.addColorStop(1, rgba('bone', 0.06));
    c.fillStyle = g;
    c.beginPath(); c.roundRect(x0, y0, JAR.w, JAR.h, [8, 8, 22, 22]); c.fill();
    c.strokeStyle = rgba('bone', 0.22); c.lineWidth = 1.5;
    c.beginPath(); c.roundRect(x0, y0, JAR.w, JAR.h, [8, 8, 22, 22]); c.stroke();
    c.strokeStyle = rgba('bone', 0.3);
    c.beginPath(); c.ellipse(JAR.x, y0, JAR.w / 2, 10, 0, 0, Math.PI * 2); c.stroke();
    c.fillStyle = rgba('bone', 0.12);
    c.fillRect(x0 + 14, y0 + 24, 6, JAR.h - 50);
    // 罐底的一圈影子（罐子擺在陽台的矮牆上）
    c.fillStyle = rgba('ink', 0.5);
    c.beginPath(); c.ellipse(JAR.x + 6, JAR.y + 4, JAR.w * 0.62, 10, 0, 0, Math.PI * 2); c.fill();
    c.restore();
    return heads;
  }

  /**
   * 仙女棒照在紙上的光（只由時間決定）：正在寫的那一段就在筆尖、全亮；停筆之後留在最後一個字、慢慢熄掉。
   * 字與字、行與行之間的空檔很短，光不會一閃一閃。
   */
  private msgLight(t: number): { p: P2; k: number } | null {
    let best: { p: P2; k: number } | null = null;
    for (const g of [...this.lines, ...(this.sig ? [this.sig] : [])]) {
      if (t < g.t0) break;
      const size = g.lay.size, n = g.lay.glyphs.length;
      if (t < g.t1) {
        const u = ((t - g.t0) / (g.t1 - g.t0)) * n, i = Math.min(n - 1, Math.floor(u));
        const gl = g.lay.glyphs[i]!;
        return { p: { x: g.x + gl.x + gl.w * (u - i), y: g.y - size * 0.4 }, k: 1 };
      }
      best = { p: { x: g.x + g.lay.width, y: g.y - size * 0.4 }, k: Math.exp(-(t - g.t1) / EMBER) };
    }
    return best;
  }

  /** 沒有留言：光跟著寫歌詞的筆尖；唱到一半停住（換氣、句子之間）時慢慢熄掉。 */
  private lyricLight(t: number): { p: P2; k: number } | null {
    const ly = lyricAt(this.ctx.lyrics, t, 1.6, 0.2);
    if (!ly) return null;
    const set = this.lyricSet(ly.line);
    const now = Lyrics.lineCharProgress(ly.line, t);
    if (now <= 0 || !set.glyphs.length) return null;
    // 最近 0.35 秒寫了多少：一直在寫就是全亮，停下來就熄
    const k = clamp((now - Lyrics.lineCharProgress(ly.line, t - 0.35)) * 1.4) * ly.k;
    let g = set.glyphs[0]!;
    for (const q of set.glyphs) { if (q.off <= now) g = q; else break; }
    const u = clamp((now - g.off) / g.len);
    return { p: { x: BOX.x + g.x + g.w * u, y: set.top + g.row * set.fit.lineHeight - set.fit.size * 0.4 }, k };
  }

  /**
   * 寫一行（逐字斜掃出現）。已經寫好的字畫在主層（冷卻中的字同時也畫在發光層），回傳筆尖位置（這行正在寫時）。
   */
  private write(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, g: Glyphs, t: number, size: number, done = rgba('bone', 0.96)): P2 | null {
    if (t < g.t0) return null;
    const n = g.lay.glyphs.length, per = (g.t1 - g.t0) / Math.max(1, n);
    c.font = hc.font = font(g.lay.family, size);
    c.textBaseline = hc.textBaseline = 'alphabetic';
    let pen: P2 | null = null;
    for (const gl of g.lay.glyphs) {
      const a = g.t0 + gl.i * per;
      if (t < a) break;
      const r = clamp((t - a) / per);
      const x = g.x + gl.x, top = g.y - size * 0.92, h = size * 1.15;
      const heat = 1 - clamp((t - a - per) / COOL);
      // 冷卻後的顏色；愛心冷卻成點綴色（玫瑰）
      const cool = gl.ch === '♥' ? rgba('rose') : done;
      const col = heat > 0.02 ? mixRgba(gl.ch === '♥' ? 'rose' : 'bone', 'signal', heat * 0.9, 0.96) : cool;
      if (r < 1) {
        const S = r * (gl.w + SKEW * h);
        for (const ctx of heat > 0.05 ? [c, hc] : [c]) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x - 10, top - 10); ctx.lineTo(x + S + 10 * SKEW, top - 10); ctx.lineTo(x + S - SKEW * (h + 10), top + h + 10); ctx.lineTo(x - 10, top + h + 10);
          ctx.closePath(); ctx.clip();
          glyph(ctx, gl.ch, x, g.y, gl.w, size, ctx === hc ? rgba('signal', heat) : col);
          ctx.restore();
        }
        pen = { x: x + clamp(S - SKEW * h * 0.5, 0, gl.w), y: top + h * 0.5 };
      } else {
        glyph(c, gl.ch, x, g.y, gl.w, size, col);
        if (heat > 0.05) glyph(hc, gl.ch, x, g.y, gl.w, size, rgba('signal', heat * heat));
      }
    }
    return pen;
  }

  /** 沒有留言時一行歌詞的排版（大大的手寫字，最多兩行）：每一行只排一次。 */
  private lyricSet(line: Line): LyricSet {
    let set = this.lyricSets.get(line);
    if (!set) {
      const family = F.hand(700);
      const fit = fitText(this.layer.ctx, line.text, family, BOX.w, BOX.h - 60, { min: V2.lyrMin, max: V2.lyrMax, lineHeight: 1.3, maxLines: 3 });
      const glyphs: LyricGlyph[] = [];
      let cursor = 0;
      fit.lines.forEach((ln, row) => {
        // 這一排在原文裡從哪裡開始（斷行吃掉的空白跳過去）
        const at = line.text.indexOf(ln, cursor), base = at >= 0 ? at : cursor;
        cursor = base + ln.length;
        let o = base;
        for (const gl of layout(ln, family, fit.size).glyphs) {
          // 這個字唱完的時間：它所在的那個詞，照字數平分
          const wd = line.words.find((w) => o >= w.o && o < w.o + w.w.length);
          const done = wd ? wd.start + ((o - wd.o + gl.ch.length) / wd.w.length) * (wd.end - wd.start) : line.start;
          glyphs.push({ ch: gl.ch, x: gl.x, w: gl.w, row, off: o, len: gl.ch.length, done });
          o += gl.ch.length;
        }
      });
      set = { fit, glyphs, top: BOX.y + (BOX.h - 60 - fit.height) / 2 + fit.size };
      this.lyricSets.set(line, set);
    }
    return set;
  }

  /**
   * 沒有留言：仙女棒跟著歌聲寫歌詞，一次一行，大大的。還沒唱的字淡淡地先在紙上，唱到的字被斜斜地寫出來、
   * 燒紅，唱完約一秒冷卻成紙白（跟寫留言同一種筆）。
   */
  private writeLyric(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number): P2 | null {
    const ly = lyricAt(this.ctx.lyrics, t, 1.6, 0.2);
    if (!ly) return null;
    const line = ly.line, family = F.hand(700);
    const { fit, glyphs, top } = this.lyricSet(line);
    const chars = Lyrics.lineCharProgress(line, t);
    let pen: P2 | null = null;
    c.save(); hc.save();
    c.globalAlpha *= ly.k; hc.globalAlpha *= ly.k;
    c.font = hc.font = font(family, fit.size);
    c.textBaseline = hc.textBaseline = 'alphabetic';
    for (const g of glyphs) {
      const x = BOX.x + g.x, y = top + g.row * fit.lineHeight;
      const r = clamp((chars - g.off) / g.len);
      if (r < 1) { c.fillStyle = rgba('bone', 0.14); c.fillText(g.ch, x, y); }
      if (r <= 0) continue;
      const heat = r < 1 ? 1 : 1 - clamp((t - g.done) / COOL);
      const col = heat > 0.02 ? mixRgba('bone', 'signal', heat * 0.9, 0.96) : rgba('bone', 0.96);
      if (r < 1) {
        const h = fit.size * 1.15, tp = y - fit.size * 0.92, S = r * (g.w + SKEW * h);
        for (const ctx of [c, hc]) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x - 10, tp - 10); ctx.lineTo(x + S + 10 * SKEW, tp - 10); ctx.lineTo(x + S - SKEW * (h + 10), tp + h + 10); ctx.lineTo(x - 10, tp + h + 10);
          ctx.closePath(); ctx.clip();
          ctx.fillStyle = ctx === hc ? rgba('signal', 0.9) : col;
          ctx.fillText(g.ch, x, y);
          ctx.restore();
        }
        pen = { x: x + clamp(S - SKEW * h * 0.5, 0, g.w), y: tp + h * 0.5 };
      } else {
        c.fillStyle = col;
        c.fillText(g.ch, x, y);
        if (heat > 0.05) { hc.fillStyle = rgba('signal', heat * heat * 0.9); hc.fillText(g.ch, x, y); }
      }
    }
    // 韓文歌：原文小一號寫在中文下面那一條橫線上（同一張信紙、同一種手寫字）。仙女棒只寫中文——原文不燒紅、不發光：
    // 還沒唱的淡淡先在紙上，唱到（照原文自己的逐字時間）就亮成紙白、淡一點，比中文安靜。三排中文加兩排原文也還在信紙裡。
    const orig = lyricSubOf(line);
    if (orig) {
      c.save();
      c.translate(BOX.x, top + fit.lines.length * fit.lineHeight);
      drawLyricSub(c, orig, t, { family, size: fit.size, maxWidth: BOX.w, align: 'left', sung: rgba('bone', 0.96), unsung: rgba('bone', 0.14) }, fit.size, c.globalAlpha);
      c.restore();
    }
    c.restore(); hc.restore();
    return pen;
  }
}
