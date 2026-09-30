// 狗狗肖像（亮、dog）：美術館的一面牆，燈打著一幅鍍金畫框裡的狗狗正式肖像（Codex 畫的古典油畫，變化款 0 = 芃芃、1 = QQ、2 = 元元），
// 真的芃芃、QQ、元元三隻坐在紅絨繩前面、背對我們抬頭看著牆上的畫。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 開場展廳的燈「喀」一聲在第一拍亮起來（牆上軌道燈的光一扇一扇打下來，閃一下再穩住）。
//  - 每個小節線輪到一隻狗有動作，三隻輪流，第三拍回到原位：QQ、芃芃轉過頭來看我們（換成歪頭的正面，跳一下）；
//    元元是大狗，**站起來（後腳站、前腳抬高）湊到說明卡前面「讀」留言**——兩隻博美搆不到。
//    其他時候背對我們跟著拍子輕輕晃（尾巴在搖的感覺）。每兩小節畫框的角閃一下、畫面上掃過一道光（油畫的亮光漆）。
//  - **焦點是主打留言**：寫在畫旁邊的展品說明卡上（米白卡、細細的影子），上面兩行小字是畫名與「油彩．畫布」，
//    留言用思源宋體（典雅），署名，最下面一行小小的「No.042 館藏」（留言編號）；照「留言尺寸與版面比例標準 v2」：
//    字 40～60、卡最大 640 × 400，高度跟著留言。沒有留言時卡上寫邀請、「館藏徵集中」。
//  - 歌詞是展廳牆上的引言（大字貼在牆的上方、置中），照跟唱規則逐字亮。
//  - 鏡頭：整個窗格慢慢推近畫與說明卡之間。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, sparkHead, sparkParticles, msgChars, lyricSubOf } from './_motifs';
import { drawNote, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetShadow, puppetIn, puppetBox, breathe, beatKick, landSquash, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE } from './_c3';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dog', paper: true, energy: [0, 0.8], bars: [4, 8], variants: 3 };

const SZ = 420, DOG_S = 1.62;
/** 牆腳（牆與木地板的交界）。 */
const FLOOR = 860;
/** 畫：畫布（油畫本身）的中心、高；框的寬度。 */
const ART = { cx: 560, cy: 500, h: 500, frame: 58 };
/** 展品說明卡：最大的範圍（標準 v2：≤ 860 × 430；上緣固定、高度跟著留言）與寫字的內距（上面留兩行小字）。 */
const CARD = { x: 930, y: 346, w: 700, h: 410 };
const PAD = { x: 44, top: 104, bottom: 64 };
/** 牆上的引言（歌詞）：中心 x、基線、最寬。 */
const QUOTE = { x: 960, y: 150, w: 1360 };
/**
 * 有韓文原文的窗格：引言上面已經貼著安全邊界、下面是畫框的上緣，原文沒地方放——整組引言移到畫框右邊、
 * 說明卡的正上方（中文＋原文都在畫框右緣 820 的右邊，往下長到說明卡上緣之前都不會撞到東西）。
 */
const QUOTE_SUB = { x: 1300, y: 150, w: 940 };
/** 三隻狗坐的地方（腳底）：兩隻博美在畫下面，元元坐在右邊、靠近說明卡（牠站起來要去讀卡）。三隻用同一個場景尺度。 */
const SEAT = { pp: { x: 400, y: 992 }, qq: { x: 610, y: 982 }, yy: { x: 800, y: 968 } };
/** 紅絨繩的兩根柱子（x）與柱子的腳。 */
const POSTS = [232, 902], POST_Y = 912, POST_H = 118;
const TITLES = [
  { en: 'Portrait of PenPen', zh: '《芃芃》　油彩．畫布　宣文 & 孟庭 家族收藏' },
  { en: 'Portrait of QQ', zh: '《QQ》　油彩．畫布　宣文 & 孟庭 家族收藏' },
  { en: 'Portrait of YuanYuan', zh: '《元元》　油彩．畫布　宣文 & 孟庭 家族收藏' },
];
/** 每隻狗的圖：背對（看畫）、輪到牠的那一下（博美回頭歪頭、元元站起來讀卡）、油畫肖像。元元的歪頭與站起來用 yuanyuan 組現成的。 */
const POSE: Record<Who, { back: string; turn: string; oil: string }> = {
  pp: { back: 'pp_dogportrait_back', turn: 'pp_dogportrait_tilt', oil: 'pp_dogportrait_oil' },
  qq: { back: 'qq_dogportrait_back', turn: 'qq_dogportrait_tilt', oil: 'qq_dogportrait_oil' },
  yy: { back: 'yy_c3_dogportrait_back', turn: 'yy_beg', oil: 'yy_c3_dogportrait_oil' },
};
/** 輪流的順序（每個小節線換一隻）與畫的順序（遠的先畫）。 */
const TURNS: Who[] = ['qq', 'pp', 'yy'];
const WHO: Who[] = ['yy', 'qq', 'pp'];

/** 展廳：牆（紙色，軌道燈在牆上打出一扇一扇的光）、踢腳板、木地板。燈在開場的第一拍亮起來。 */
const GALLERY = () => new FSPass(/* glsl */ `
  uniform float on;
  float scallop(vec2 p, float x0) {
    vec2 d = p - vec2(x0, -60.0);
    float w = 110.0 + 0.62 * max(d.y, 0.0);
    return exp(-pow(d.x / w, 2.0) * 1.6) * exp(-d.y / 1100.0);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float wall = 1.0 - smoothstep(${FLOOR - 1}.0, ${FLOOR + 1}.0, p.y);
    float n = fbm(p / 320.0, 3);
    float lit = scallop(p, ${ART.cx}.0) + 0.75 * scallop(p, ${CARD.x + CARD.w / 2}.0) + 0.35 * scallop(p, 1800.0);
    vec3 wc = C_PAPER * (0.84 + 0.02 * n + 0.15 * on * lit);
    // 踢腳板：牆腳一條深一點的帶子
    float base = smoothstep(${FLOOR - 26}.0, ${FLOOR - 24}.0, p.y);
    wc = mix(wc, mix(C_PAPER, C_SEPIA, 0.18) * (0.9 + 0.08 * on), base);
    // 木地板：一條一條的長木板（越近越寬），淡淡的反光
    float fy = max(p.y - ${FLOOR}.0, 0.0);
    float row = fy / (16.0 + fy * 0.09);
    float seam = smoothstep(0.92, 1.0, fract(row));
    float grain = snoise(vec2(p.x / 380.0 + floor(row) * 3.1, fy / 26.0));
    vec3 fc = mix(C_PAPER, C_SEPIA, 0.3 + 0.03 * grain) * (0.9 + 0.08 * on);
    fc = mix(fc, fc * 0.86, seam);
    fc += C_PAPER * 0.05 * on * exp(-pow((p.x - ${ART.cx}.0) / 380.0, 2.0)) * exp(-fy / 90.0);
    vec3 col = mix(fc, wc, wall);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { on: { value: 0 } });

type Who = 'pp' | 'qq' | 'yy';

export default class DogPortrait extends Scene {
  gal = shared('dogportrait.gallery', GALLERY);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 這一格有沒有韓文原文副行（有主打留言的窗格，引擎給的歌詞本來就沒有副行）。 */
  hasSub = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l));
  v = (this.ctx.params.variant ?? 0) % 3;
  art = { x: 0, y: 0, w: 0, h: ART.h, scale: 1 };
  note: Note | null = null;
  card = { ...CARD };
  lyricSize = 52;
  /** 燈亮起來的拍、每個小節線（轉頭、閃光用）。 */
  lightsOn = 0;
  bars: number[] = [];
  keys: Record<Who, [number, string][]> = { pp: [], qq: [], yy: [] };
  hops: Record<Who, number[]> = { pp: [], qq: [], yy: [] };
  /** 元元站起來讀卡的時間段（站起來往卡片那邊挪一點）。 */
  reads: [number, number][] = [];

  private get sitter(): Who { return (['pp', 'qq', 'yy'] as const)[this.v]!; }

  override async init() {
    const { audio: au } = this.ctx;
    const T = TITLES[this.v]!;
    await loadText('一位賓客館藏徵集中' + INVITE + T.zh + T.en + '0123456789No.');
    const oil = POSE[this.sitter].oil;
    this.track(await loadPuppets([oil, ...WHO.flatMap((w) => [POSE[w].back, POSE[w].turn])]));
    // 油畫照畫框的開口縮放（高 = ART.h）
    const box = puppetBox(oil, 0, 0, { h: SZ });
    this.art.scale = box[3] > 0 ? ART.h / box[3] : 1;
    this.art.w = box[2] * this.art.scale;
    this.art.x = ART.cx - this.art.w / 2;
    this.art.y = ART.cy - ART.h / 2;
    // 燈在開場後的第一拍亮；之後每個小節線輪到一隻狗（三隻輪流），第三拍回去
    this.lightsOn = au.nextBeat(this.ctx.start + 0.25);
    let b = barAfter(au, this.lightsOn + 0.3);
    for (let k = 0; k < 40 && b < this.ctx.end + 0.1; k++) {
      this.bars.push(b);
      b = au.timeOfBar(Math.round(au.barAt(b)) + 1);
    }
    for (const w of WHO) this.keys[w] = [[-1e9, POSE[w].back]];
    this.bars.forEach((t, k) => {
      const w = TURNS[k % TURNS.length]!;
      const back = au.timeOfBeat(Math.round(au.beatAt(t)) + 2);
      this.keys[w].push([t, POSE[w].turn], [back, POSE[w].back]);
      this.hops[w].push(t, back);
      if (w === 'yy') this.reads.push([t, back]);
    });
    // 說明卡：標準 v2 的字級（宋體）；卡的高度跟著留言、寬度跟著字
    const c = this.fg.ctx;
    const w = CARD.w - PAD.x * 2, hmax = CARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax, { family: F.ming(500), lineHeight: 1.3 }) : noteV2(c, INVITE, null, w, hmax * 0.6, { family: F.ming(500), max: 42 });
    const cw = Math.min(CARD.w, Math.max(tightenNote(c, this.note, 440) + PAD.x * 2, 520));
    this.card = { x: CARD.x, y: CARD.y, w: cw, h: Math.min(CARD.h, Math.max(260, PAD.top + this.note.height + PAD.bottom + 8)) };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：畫框與油畫、說明卡（紙、影子、兩行小字、館藏編號）、紅絨繩的柱子與繩子。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const A = this.art, fw = ART.frame;
    const fx = A.x - fw, fy = A.y - fw, fwid = A.w + fw * 2, fhgt = A.h + fw * 2;
    // 畫框的影子（燈從上面來：影子往下）
    const sh = c.createLinearGradient(0, fy + fhgt - 20, 0, fy + fhgt + 40);
    sh.addColorStop(0, rgba('sepia', 0.22));
    sh.addColorStop(1, rgba('sepia', 0));
    c.fillStyle = sh;
    c.fillRect(fx + 6, fy + fhgt - 20, fwid, 60);
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(fx + 8, fy + 12, fwid, fhgt);
    // 鍍金畫框：外緣、中間的弧面、內緣三圈斜面（上亮下暗），四個角一朵小捲草
    const gold = (k: number, a = 1) => mixRgba('fur', 'cream', k, a);
    const bands: [number, number, string, string][] = [
      [0, 14, gold(0.2), mixRgba('fur', 'sepia', 0.35)],
      [14, 40, gold(0.55), mixRgba('fur', 'sepia', 0.2)],
      [40, 52, mixRgba('fur', 'sepia', 0.3), gold(0.3)],
      [52, fw, mixRgba('cream', 'paper', 0.5), mixRgba('cream', 'sepia', 0.15)],
    ];
    for (const [a, b, top, bot] of bands) {
      const g = c.createLinearGradient(0, fy + a, 0, fy + fhgt - a);
      g.addColorStop(0, top);
      g.addColorStop(1, bot);
      c.fillStyle = g;
      c.fillRect(fx + a, fy + a, fwid - a * 2, fhgt - a * 2);
      c.strokeStyle = rgba('sepia', 0.35);
      c.lineWidth = 1;
      c.strokeRect(fx + a + 0.5, fy + a + 0.5, fwid - a * 2 - 1, fhgt - a * 2 - 1);
    }
    // 弧面上的小珠子（每隔一段一顆）
    c.fillStyle = gold(0.75, 0.9);
    for (let s = 0; s < 1; s += 1 / 26) {
      for (const [x, y] of [[fx + 27 + s * (fwid - 54), fy + 27], [fx + 27 + s * (fwid - 54), fy + fhgt - 27]]) { c.beginPath(); c.arc(x!, y!, 3, 0, Math.PI * 2); c.fill(); }
    }
    for (const [x, y, sx, sy] of [[fx, fy, 1, 1], [fx + fwid, fy, -1, 1], [fx, fy + fhgt, 1, -1], [fx + fwid, fy + fhgt, -1, -1]] as const) {
      c.save();
      c.translate(x, y);
      c.scale(sx, sy);
      c.strokeStyle = mixRgba('fur', 'sepia', 0.45);
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(6, 44); c.bezierCurveTo(8, 18, 18, 8, 44, 6);
      c.moveTo(20, 34); c.arc(26, 26, 8, Math.PI * 0.75, Math.PI * 2.4);
      c.stroke();
      c.restore();
    }
    // 油畫（Codex 畫的古典肖像）
    drawPuppet(c, POSE[this.sitter].oil, ART.cx, A.y + A.h, { h: SZ, scale: A.scale });
    // 說明卡
    const K = this.card, T = TITLES[this.v]!;
    c.fillStyle = rgba('sepia', 0.14);
    c.fillRect(K.x + 7, K.y + 9, K.w, K.h);
    c.fillStyle = mixRgba('bone', 'paper', 0.25);
    c.fillRect(K.x, K.y, K.w, K.h);
    c.strokeStyle = rgba('sepia', 0.18);
    c.lineWidth = 1;
    c.strokeRect(K.x + 0.5, K.y + 0.5, K.w - 1, K.h - 1);
    c.fillStyle = rgba('sepia', 0.78);
    c.font = font(F.serif(500, true), 30);
    c.fillText(T.en, K.x + PAD.x, K.y + 50);
    c.font = font(F.hei(500), 17);
    c.letterSpacing = '2px';
    c.fillStyle = rgba('sepia', 0.55);
    c.fillText(T.zh, K.x + PAD.x, K.y + 80);
    c.letterSpacing = '0px';
    c.strokeStyle = rgba('sepia', 0.2);
    c.beginPath(); c.moveTo(K.x + PAD.x, K.y + 94); c.lineTo(K.x + K.w - PAD.x, K.y + 94); c.stroke();
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText(this.msg ? `No.${String(this.msg.n).padStart(3, '0')}　館藏` : '館藏徵集中', K.x + PAD.x, K.y + K.h - 24);
    c.letterSpacing = '0px';
    // 紅絨繩：兩根黃銅柱、中間垂下來的繩子
    for (const x of POSTS) {
      const g = c.createLinearGradient(x - 6, 0, x + 6, 0);
      g.addColorStop(0, gold(0.1)); g.addColorStop(0.5, gold(0.8)); g.addColorStop(1, mixRgba('fur', 'sepia', 0.4));
      c.fillStyle = g;
      c.fillRect(x - 5, POST_Y - POST_H, 10, POST_H);
      c.beginPath(); c.ellipse(x, POST_Y, 26, 7, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(x, POST_Y - POST_H - 6, 9, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = mixRgba('collar', 'sepia', 0.2);
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(POSTS[0]! + 6, POST_Y - POST_H + 4);
    c.quadraticCurveTo((POSTS[0]! + POSTS[1]!) / 2, POST_Y - POST_H + 96, POSTS[1]! - 6, POST_Y - POST_H + 4);
    c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    // 燈亮起來：拍點上「喀」一下全亮、閃一下再穩住
    const u = t - this.lightsOn;
    const on = u < 0 ? 0.15 : clamp(0.6 + 0.4 * (1 - Math.exp(-u / 0.08)) - 0.25 * Math.exp(-u / 0.05) * Math.abs(Math.sin(u * 90)));
    this.gal.u.on!.value = on;
    this.gal.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out, { tint: [lerp(0.8, 1, on), lerp(0.8, 1, on), lerp(0.8, 1, on)] });
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // 油畫上掃過一道光（每兩小節，亮光漆的反光）
    const A = this.art;
    for (let k = 0; k < this.bars.length; k += 2) {
      const d = (t - this.bars[k]!) / 0.9;
      if (d < 0 || d > 1) continue;
      c.save();
      c.beginPath(); c.rect(A.x, A.y, A.w, A.h); c.clip();
      const x = lerp(A.x - 200, A.x + A.w + 200, ease.inOutCubic(d));
      const g = c.createLinearGradient(x - 90, A.y, x + 90, A.y + A.h * 0.4);
      g.addColorStop(0, rgba('bone', 0)); g.addColorStop(0.5, rgba('bone', 0.22 * Math.sin(Math.PI * d))); g.addColorStop(1, rgba('bone', 0));
      c.fillStyle = g;
      c.fillRect(A.x, A.y, A.w, A.h);
      c.restore();
    }
    // 畫框角上的一點閃光（每兩小節，錯開的那一格）
    for (let k = 1; k < this.bars.length; k += 2) {
      const d = t - this.bars[k]!;
      if (d < 0 || d > 0.5) continue;
      const kk = 1 - d / 0.5, x = A.x + A.w + ART.frame - 20, y = A.y - ART.frame + 22;
      const sg = LIN.signal, r = 26 * Math.sin(Math.PI * Math.min(1, d / 0.25)) + 4;
      this.glow.polyline([{ x: x - r, y }, { x: x + r, y }], 2, [sg[0] * 3, sg[1] * 3, sg[2] * 3], kk);
      this.glow.polyline([{ x, y: y - r }, { x, y: y + r }], 2, [sg[0] * 3, sg[1] * 3, sg[2] * 3], kk);
    }

    // 牆上的引言（歌詞）
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const Q = this.hasSub ? QUOTE_SUB : QUOTE;
      const st = { family: F.serif(500), size: this.lyricSize, minSize: 40, maxWidth: Q.w, align: 'center' as const, unsung: rgba('sepia', 0.24), sung: rgba('sepia', this.msg ? 0.8 : 0.92), active: rgba('signal') };
      c.save();
      c.translate(Q.x, Q.y);
      drawLyric(c, ly.line, t, st, layoutLyric(c, ly.line, st), ly.k * prog(t, s, s + 0.6));
      c.restore();
    }

    // 三隻狗：背對我們看畫；輪到的小節線轉過頭來（元元站起來讀卡），第三拍回去
    for (const w of WHO) this.drawDog(c, t, w);

    this.drawCardText(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const fx = (ART.cx + CARD.x + CARD.w / 2) / 2;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, vignette: 0.26, grain: 0.045, zoom: 1 + 0.035 * push, shake: [-(fx - W / 2) * 0.035 * push, -(480 - H / 2) * 0.035 * push] };
  }

  private drawDog(c: CanvasRenderingContext2D, t: number, w: Who) {
    const au = this.ctx.audio;
    const S = SEAT[w];
    const en = puppetIn(t, this.ctx.start + (w === 'pp' ? 0.1 : w === 'qq' ? 0.18 : 0.26), 0.45);
    if (en.alpha <= 0) return;
    let lift = 0, squash = breathe(t, 0.012, 2.6, w === 'pp' ? 0 : 0.4) + 0.025 * beatKick(au, t, 0.25);
    for (const h of this.hops[w]) {
      const d = t - h;
      if (d >= -0.02 && d < 0.26) lift += 18 * Math.sin(Math.PI * clamp(d / 0.26));
      squash += landSquash(t, h + 0.26, 0.1, 0.25);
    }
    // 元元站起來讀卡：往卡片那邊挪一步（起身時滑過去、回去時滑回來）
    let dx = 0;
    for (const [a, b] of this.reads) dx += 46 * (ease.outCubic(prog(t, a, a + 0.25)) - ease.inOutCubic(prog(t, b - 0.05, b + 0.25)));
    const P = { x: S.x + dx, y: S.y };
    // 背對我們的時候跟著拍子左右晃（尾巴在搖）；站起來的時候不晃
    const rot = dx > 1 ? 0 : 0.03 * Math.sin(au.beatAt(t) * Math.PI);
    const o: PuppetOpts = { h: SZ, scale: DOG_S, squash, rot, pivot: 0.1, spin: en.spin, alpha: en.alpha };
    puppetShadow(c, w, P.x, P.y, { h: SZ * DOG_S, lift, alpha: 0.3 * en.alpha, color: '60,40,25' });
    drawPick(c, this.keys[w], t, P.x, P.y - lift, o);
    if (en.k < 1) {
      sparkHead(this.glow, P.x, P.y - 4, t, 0.6);
      sparkParticles(this.glow, t, () => ({ x: P.x, y: P.y - 4 }), { rate: 40, life: 0.25, speed: 120, seed: w === 'pp' ? 5 : w === 'qq' ? 6 : 7 });
    }
  }

  /** 說明卡上的留言：燈亮之後一個字一個字印上去，寫完署名淡入；在卡面上垂直置中。 */
  private drawCardText(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const K = this.card;
    const t0 = this.lightsOn + 0.15;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.1);
    const done = t0 + total * per;
    const top = K.y + PAD.top, h = K.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    drawNote(c, n, K.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.72), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
