// 雙語路牌（亮，批次 B3・街景）：午後的街角，一根指標柱立在畫面左邊，柱子上掛著一片片深色的路牌（指向右邊的箭頭形）。
//  - 兩行歌詞就是路牌本身：每一句歌詞是一片新的路牌，中文大字在上、原文小一號在下（像雙語路名），兩行各自照逐字時間亮
//    （中文唱到的字是訊號色、唱完紙白；原文唱到就轉紙白、淡兩成）。新的一句要唱之前，那片路牌從柱子上「翻下來」
//    （以上緣為軸轉下來、彈一下），舊的路牌整排往上推一格；沒有翻譯的歌路牌只有一行（牌子跟著變矮，不留空格）。
//  - 主打留言是右邊公車候車亭的燈箱廣告：第一拍燈管「閃兩下」亮起來，廣告上印著留言（思源宋體，40～60 px，留言區約 650×400），
//    署名在最後一行下面；每個小節線，候車亭玻璃上有一道反光滑過。沒有留言：燈箱是一張邀請的廣告（新人的名字、日期、一行邀請）。
//  - 街景一直在動：每個小節線有一台車開過（一台往右、一台往左，車頭剛好在拍點經過畫面中間），行道樹被風吹、落葉慢慢飄下來，
//    柱子上的行人號誌每兩小節綠燈／紅燈輪流、倒數一拍跳一格。遠方的大樓、行道樹、柱子三層視差，鏡頭很慢地往右平移、推近一點。
//  - 純音樂：路牌是固定的路名（新人名字大道、幸福路……），每個小節翻下來一片。
//  - 右下角（HUD）是空的人行道。
// 手法：天空、兩排遠樓、行道樹、馬路（斑馬線、車道線）、人行道磚都在一個全螢幕 shader；柱子、路牌、車子、候車亭、燈箱、落葉是一張每格重畫的
// Canvas（不會變的燈箱廣告、候車亭在 init() 先畫好成小畫布，每格只貼上去）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, pulse } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { beatAfter, drawHeart, COUPLE_EN, NAME_A, NAME_B, HAS_LATIN_NAMES, DATE_DOTS, fitPx } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { loadB3, layoutBi, paintBi, msgBlock, drawMsgBlock, B3_INVITE, type BiLayout, type MsgBlock, type Rect } from './_b3';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'city', paper: true, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

/** 指標柱的 x、路牌的範圍（牌子從柱子往右伸，右端是箭頭）。 */
const POLE = { x: 322, w: 24 };
const BLADE = { x: POLE.x + POLE.w / 2 + 6, w: 736, tip: 54, padX: 34, padY: 18 };
/** 路牌上字區的寬（扣掉箭頭與左右留白）：純音樂時的路名照這個縮字。 */
const STREET_W = BLADE.w - BLADE.tip - BLADE.padX * 2;
/** 最新的那一片路牌的上緣（舊的往上疊）。 */
const Y0 = 468;
const GAP = 16;
/** 候車亭與燈箱（燈箱就是留言區：650×400，畫面的 12.5%）。 */
const SHELTER = { x: 1124, y: 196, w: 740, ground: 820 };
const BOX = { x: 1168, y: 252, w: 652, h: 400 };
/** 燈箱裡留言的框（燈箱內緣再留一點邊）。 */
const MSG_IN = { x: 40, y: 64, w: 580, h: 300 };
/**
 * 純音樂又沒有歌詞時的路名（中文、英文）。第一條是新人的名字大道：沒有英文名時英文那行用通用的路名，
 * 不要把中文名再印一次。名字很長時畫的時候縮字（STREET_W）。
 */
const STREETS: [string, string][] = [
  [`${NAME_A}${NAME_B}大道`, HAS_LATIN_NAMES ? `${COUPLE_EN} Ave.` : 'Newlywed Ave.'], ['幸福路', 'Happiness Rd.'], ['永遠街', 'Forever St.'],
  ['喜宴巷', 'Banquet Ln.'], ['白頭偕老路', 'Lifelong Rd.'], ['甜蜜街', 'Sweet St.'],
];

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float cam; uniform float zoom;
  // 一排樓的高度（x 以格為單位，種子不同）
  float bh(float cell, float seed, float lo, float hi) { return mix(lo, hi, hash11(cell * 1.37 + seed)); }
  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = vec2(960.0, 560.0) + (p0 - vec2(960.0, 560.0)) / zoom;
    float hz = 648.0;
    // 天空：上面淡淡的灰、往地平線越來越亮；右上一團午後的暖光
    vec3 col = mix(mix(C_PAPER, C_ASH, 0.16), mix(C_PAPER, C_BONE, 0.55), smoothstep(40.0, hz, p.y));
    col += (C_EMBER * 0.05 + C_BONE * 0.03) * exp(-length((p - vec2(1700.0, 60.0)) / vec2(700.0, 420.0)));
    // 幾朵很淡的雲，慢慢往左飄（比遠樓還遠：視差 0.08）
    // （雜訊很貴：只在天空那一段算）
    if (p.y < 420.0) {
      float cl = fbm(vec2((p.x + cam * 0.08) / 520.0 + t * 0.012, p.y / 150.0), 3);
      col = mix(col, mix(C_PAPER, C_BONE, 0.7), 0.35 * smoothstep(0.1, 0.5, cl) * smoothstep(420.0, 120.0, p.y));
    }
    // 遠樓（視差 0.18）
    float x1 = p.x + cam * 0.18;
    float c1 = floor(x1 / 150.0);
    float h1 = bh(c1, 3.0, 150.0, 330.0);
    if (p.y > hz - h1) {
      vec3 b = mix(C_PAPER, C_ASH, 0.34);
      vec2 w = vec2(fract(x1 / 22.0), fract((p.y - hz) / 30.0));
      float win = step(0.3, w.x) * step(w.x, 0.75) * step(0.35, w.y) * step(w.y, 0.8) * step(0.45, hash12(floor(vec2(x1 / 22.0, p.y / 30.0))));
      b = mix(b, mix(C_PAPER, C_BONE, 0.4), win * 0.35);
      col = mix(col, b, 0.75);
    }
    // 近一點的樓（視差 0.36），比較深、有招牌的小色塊
    float x2 = p.x + cam * 0.36;
    float c2 = floor(x2 / 230.0);
    float h2 = bh(c2, 11.0, 90.0, 240.0);
    if (p.y > hz - h2) {
      vec3 b = mix(C_PAPER, C_SEPIA, 0.24 + 0.1 * hash11(c2 + 5.0));
      vec2 q = vec2(fract(x2 / 230.0) * 230.0, p.y - (hz - h2));
      float win = step(18.0, q.x) * step(q.x, 212.0) * step(0.4, fract(q.y / 34.0)) * step(0.35, fract(q.x / 26.0)) * step(22.0, q.y);
      b = mix(b, mix(C_PAPER, C_BONE, 0.5), win * 0.3);
      float sign = step(abs(q.x - 60.0 - 90.0 * hash11(c2)), 28.0) * step(abs(q.y - 50.0), 12.0) * step(0.55, hash11(c2 + 9.0));
      b = mix(b, mix(C_SIGNAL, C_PAPER, 0.35), sign * 0.8);
      col = mix(col, b, 0.85);
    }
    // 行道樹（視差 0.62）：一棵一棵的圓樹冠，被風吹著晃，樹幹站在對面的人行道上
    float x3 = p.x + cam * 0.62;
    float c3 = floor(x3 / 330.0);
    float cx = (c3 + 0.5) * 330.0 + 40.0 * (hash11(c3 + 2.0) - 0.5);
    float sway = 5.0 * sin(t * 1.3 + c3 * 1.7) + 2.0 * sin(t * 3.1 + c3);
    vec2 tc = vec2(cx + sway, 500.0 + 20.0 * hash11(c3 + 7.0));
    float r = 118.0 + 26.0 * hash11(c3 + 4.0);
    float trunk = step(abs(x3 - cx - sway * 0.2), 7.0) * step(560.0, p.y) * step(p.y, hz + 6.0);
    col = mix(col, mix(C_PAPER, C_SEPIA, 0.45), trunk);
    // 樹冠（只在樹冠附近算雜訊）：一簇一簇的葉團（亮面、暗面分明，像版畫上色），右上來的光
    float d0 = length((vec2(x3, p.y) - tc) / vec2(1.0, 0.86)) - r;
    if (d0 < 22.0) {
      float d = d0 + 16.0 * fbm(vec2(x3, p.y) / 60.0 + c3 + t * 0.1, 2);
      float clump = snoise(vec2(x3, p.y) / 34.0 + c3 * 3.1 + vec2(t * 0.05, 0.0)) * 0.5 + 0.25 * snoise(vec2(x3, p.y) / 15.0 + c3);
      vec2 nrm = (vec2(x3, p.y) - tc) / r;
      float shade = smoothstep(-0.6, 0.8, dot(nrm, vec2(-0.55, 0.75))) + 0.35 * smoothstep(0.1, 0.5, clump);
      vec3 leaf = mix(mix(C_PAPER, mix(C_SEPIA, C_SIGNAL, 0.18), 0.3), mix(C_PAPER, mix(C_SEPIA, C_SIGNAL, 0.12), 0.62), clamp(shade, 0.0, 1.0));
      col = mix(col, leaf, smoothstep(1.5, -1.5, d));
    }
    // 對面的人行道與路緣
    if (p.y > hz - 2.0) col = mix(C_PAPER, C_ASH, 0.22);
    if (p.y > hz + 12.0) col = mix(C_PAPER, C_ASH, 0.34);
    // 馬路（視差 0.85）：柏油、中線虛線、斑馬線
    float x4 = p.x + cam * 0.85;
    if (p.y > hz + 16.0 && p.y < 800.0) {
      float v = (p.y - hz - 16.0) / (800.0 - hz - 16.0);
      col = mix(C_PAPER, C_GRAPHITE, 0.2 + 0.05 * v) * (0.97 + 0.03 * snoise(vec2(x4, p.y) / 9.0));
      float dash = step(abs(p.y - (hz + 16.0 + 0.47 * (800.0 - hz - 16.0))), 2.0 + v) * step(0.45, fract(x4 / 150.0));
      col = mix(col, mix(C_PAPER, C_BONE, 0.7), dash * 0.8);
      // 斑馬線：從遠到近一條一條（越近越寬）
      float z = fract(v * 7.0 + 0.1);
      float zb = step(0.42, z) * step(abs(x4 - 1420.0), 150.0 + 30.0 * v);
      col = mix(col, mix(C_PAPER, C_BONE, 0.72), zb * 0.85);
    }
    // 這邊的路緣與人行道（磚：橫線越近越疏、直線往消失點收）
    if (p.y >= 800.0) {
      col = mix(C_PAPER, C_ASH, 0.2);
      if (p.y < 812.0) col = mix(C_PAPER, C_ASH, 0.42);
      float dz = (p.y - 800.0);
      float row = fract(log(1.0 + dz / 18.0) * 2.4);
      float u = (x4 - 960.0) / (dz + 90.0) * 160.0;
      float grid = max(1.0 - smoothstep(0.0, 0.05, row), 1.0 - smoothstep(0.0, 0.035, abs(fract(u / 110.0) - 0.5) * 2.0 - 0.965));
      col *= 1.0 - 0.06 * grid * step(812.0, p.y);
    }
    // 午後的光：左上亮、右下角稍微暗（HUD 的字在上面也清楚）
    col *= 0.97 + 0.05 * exp(-length((p0 - vec2(300.0, 200.0)) / 1400.0));
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, cam: { value: 0 }, zoom: { value: 1 } });

/** 一片路牌：顯示的歌詞（或路名）、翻下來落定的時間、排好的字。 */
interface Blade { line: Line | null; street: [string, string] | null; tLand: number; bl: BiLayout | null; h: number; size: number }

export default class StreetSign extends Scene {
  bg = shared('streetsign.bg', BG);
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 37 + (this.msg?.id ?? 0) * 11) >>> 0;
  blades: Blade[] = [];
  /** 燈箱（整張廣告畫好）、候車亭。 */
  box: HTMLCanvasElement | null = null;
  mb: MsgBlock | null = null;
  /** 燈箱的高度：跟著內容縮（短留言不要留下半塊空白）。 */
  boxH = BOX.h;
  tOn = 0;
  lyrSize = 52;
  hasLyrics = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadB3(this.ctx, `${STREETS.flat().join('')}今晚限定祝福廣告公車站BUS STOP本站停靠`);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.tOn = beatAfter(au, s + 0.08);
    this.buildBox();
    // 歌詞字級：有留言時比留言小一點（v2）
    this.lyrSize = lyricV2(this.mb ? this.mb.fit.size : null);
    const c = this.fg.ctx;
    const TW = BLADE.w - BLADE.tip - BLADE.padX * 2;
    const mk = (line: Line | null, street: [string, string] | null, tLand: number): Blade => {
      if (line) {
        const bl = layoutBi(c, line, { family: F.hei(700), size: this.lyrSize, minSize: V2.lyrMin, maxWidth: TW, lineHeight: 1.12, subFamily: F.hei(500) });
        return { line, street, tLand, bl, h: bl.height + BLADE.padY * 2, size: bl.main.size };
      }
      return { line, street, tLand, bl: null, h: 48 + 32 + 26 + BLADE.padY * 2, size: 48 };
    };
    if (this.hasLyrics) {
      // 每一句一片：窗格開始前唱過的兩句先掛在柱子上（已經唱完），之後每一句在開始唱前翻下來
      const ls = lyrics.linesIn(s - 14, e).filter((l) => l.start - 0.55 < e);
      const pre = ls.filter((l) => l.start - 0.55 <= s).slice(-3);
      const post = ls.filter((l) => l.start - 0.55 > s);
      for (const l of pre) this.blades.push(mk(l, null, -Infinity));
      for (const l of post) this.blades.push(mk(l, null, l.start - 0.12));
    } else {
      // 純音樂：固定的路名，一個小節翻一片
      const k0 = Math.floor(hash(this.seed, 3) * STREETS.length);
      this.blades.push(mk(null, STREETS[k0 % STREETS.length]!, -Infinity), mk(null, STREETS[(k0 + 1) % STREETS.length]!, -Infinity));
      let i = 2;
      for (let b = Math.ceil(au.barAt(s + 0.3)); au.timeOfBar(b) < e - 0.3; b++, i++) this.blades.push(mk(null, STREETS[(k0 + i) % STREETS.length]!, au.timeOfBar(b)));
    }
    this.avoid = [[BOX.x, BOX.y, BOX.w, this.boxH], [BLADE.x, Y0 - 20, BLADE.w, 220]];
  }

  /** 燈箱廣告（畫一次）：有留言印留言、沒有就是邀請廣告。 */
  private buildBox() {
    const m = this.msg;
    const cv = document.createElement('canvas');
    cv.width = BOX.w; cv.height = BOX.h;
    const c = cv.getContext('2d')!;
    c.textBaseline = 'alphabetic';
    // 廣告紙：燈箱的白（背光）、上緣一條訊號色的細帶
    c.fillStyle = mixRgba('bone', 'paper', 0.25); c.fillRect(0, 0, BOX.w, BOX.h);
    c.fillStyle = mixRgba('signal', 'blood', 0.35, 0.9); c.fillRect(0, 0, BOX.w, 8);
    const small = (text: string, x: number, y: number, size: number, color: string, fam = F.hei(700), sp = 4, align: CanvasTextAlign = 'left') => {
      c.font = font(fam, size); c.letterSpacing = `${sp}px`; c.fillStyle = color; c.textAlign = align;
      c.fillText(text, x, y); c.letterSpacing = '0px'; c.textAlign = 'left';
    };
    if (m) {
      small(m.couple ? 'FROM THE COUPLE · 新人' : '今晚限定 · 祝福廣告', MSG_IN.x, 44, 18, rgba('blood', 0.85));
      small(`No.${String(m.n).padStart(3, '0')}`, BOX.w - MSG_IN.x, 44, 16, rgba('sepia', 0.55), F.mono(500), 3, 'right');
      const mb = (this.mb = msgBlock(c, m, F.ming(900), MSG_IN.w, MSG_IN.h, { sigFamily: F.hand(700), lineHeight: 1.28 }));
      // 燈箱的高度跟著字（上面的小標、字、下面一點邊）；短留言的字在燈箱裡左右置中
      this.boxH = Math.min(BOX.h, Math.max(210, Math.ceil(MSG_IN.y + mb.h + 42)));
      const narrow = mb.fit.lines.length === 1 || mb.w < MSG_IN.w * 0.72;
      c.save();
      c.translate(MSG_IN.x, MSG_IN.y + Math.max(0, (this.boxH - MSG_IN.y - 42 - mb.h) * 0.5));
      drawMsgBlock(c, mb, { color: mixRgba('sepia', 'ink', 0.3), sigColor: rgba('blood', 0.9), align: narrow ? 'center' : 'left', bw: MSG_IN.w });
      c.restore();
    } else {
      small('今晚限定 · 本站停靠', MSG_IN.x, 44, 18, rgba('blood', 0.85));
      // 新人的名字，中間一顆愛心。名字是執行時才知道的：太長就整組照比例縮（愛心與間距一起縮），不超出燈箱；
      // 還沒定日期就不印日期那一行，名字往下挪一點補位
      const a = NAME_A, b = NAME_B;
      c.font = font(F.ming(900), 60);
      const k = Math.min(1, MSG_IN.w / (c.measureText(a).width + c.measureText(b).width + 88));
      c.font = font(F.ming(900), Math.floor(60 * k * 2) / 2); c.fillStyle = mixRgba('sepia', 'ink', 0.3);
      const wa = c.measureText(a).width, ny = DATE_DOTS ? 160 : 184;
      c.fillText(a, MSG_IN.x, ny);
      drawHeart(c, MSG_IN.x + wa + 44 * k, ny - 20 * k, 40 * k);
      c.fillText(b, MSG_IN.x + wa + 88 * k, ny);
      if (DATE_DOTS) small(DATE_DOTS, MSG_IN.x + 2, 214, 20, rgba('sepia', 0.7), F.mono(500), 6);
      c.fillStyle = rgba('sepia', 0.3); c.fillRect(MSG_IN.x, 252, 300, 2);
      small(B3_INVITE, MSG_IN.x, 312, 22, rgba('sepia', 0.85), F.hei(500), 2);
      this.boxH = 356;
    }
    this.box = cv;
  }

  /** 路牌的位置：最新的在 Y0，舊的往上疊；新的翻下來時整排往上推（跟翻牌同時、outBack）。 */
  private stack(t: number) {
    const last = this.blades.filter((b) => b.tLand - 0.42 <= t).slice(-3);
    const out: { b: Blade; top: number; flip: number }[] = [];
    const n = last.length;
    if (!n) return out;
    const newest = last[n - 1]!;
    const k = newest.tLand === -Infinity ? 1 : clamp((t - (newest.tLand - 0.42)) / 0.42);
    out.push({ b: newest, top: Y0, flip: k });
    // 舊的：本來最新的那片在 Y0，新的翻下來時整排往上推（推的距離＝被推的那片自己的高＋間隔）
    let top = n > 1 ? Y0 - (last[n - 2]!.h + GAP) * ease.outBack(k, 1.2) + (1 - ease.outBack(k, 1.2)) * 0 : Y0;
    for (let i = n - 2; i >= 0; i--) {
      out.push({ b: last[i]!, top, flip: 1 });
      if (i > 0) top -= last[i - 1]!.h + GAP;
    }
    return out;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const p = ease.inOutQuad(prog(t, s, e));
    const cam = 70 * p;
    const zoom = 1 + 0.025 * p;
    this.bg.u.t!.value = t; this.bg.u.cam!.value = cam; this.bg.u.zoom!.value = zoom;
    this.bg.render(renderer, out);

    const L = this.fg; L.clear();
    const c = L.ctx;
    c.save();
    c.translate(960, 560); c.scale(zoom, zoom); c.translate(-960, -560);
    this.drawCars(c, t, cam * 0.85);
    this.drawLeaves(c, t, cam * 0.62);
    // 候車亭與燈箱（視差 1：跟柱子一起）
    c.save(); c.translate(-cam, 0);
    this.drawShelter(c, t);
    c.restore();
    // 柱子與路牌（最近，視差 1.1）
    c.save(); c.translate(-cam * 1.1, 0);
    this.drawPole(c, t);
    c.restore();
    c.restore();
    L.upload();
    this.ctx.comp.draw(renderer, L.texture, out);
    const land = this.blades.reduce((a, b) => Math.max(a, pulse(t, b.tLand, 0.08)), 0);
    return {
      paper: 1, bloom: 0.2, vignette: 0.3, grain: 0.04,
      shake: [0, land * 2],
      popupAvoid: this.avoid.map(([x, y, w, h]) => [x - cam, y, w, h] as Rect),
    };
  }

  /** 柱子、頂上的小路名牌、路牌、行人號誌、柱子在人行道上的影子。 */
  private drawPole(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    // 影子（午後的光從右上來：往左下斜）
    c.save();
    c.fillStyle = rgba('sepia', 0.14);
    c.beginPath(); c.moveTo(POLE.x - 4, 986); c.lineTo(POLE.x + POLE.w + 4, 986); c.lineTo(POLE.x - 160, 1080); c.lineTo(POLE.x - 210, 1080); c.closePath(); c.fill();
    c.restore();
    // 柱子：金屬的圓柱（左亮右暗），底座
    const g = c.createLinearGradient(POLE.x, 0, POLE.x + POLE.w, 0);
    g.addColorStop(0, mixRgba('ash', 'bone', 0.4)); g.addColorStop(0.35, mixRgba('ash', 'bone', 0.1)); g.addColorStop(1, mixRgba('graphite', 'ash', 0.5));
    c.fillStyle = g; c.fillRect(POLE.x, -20, POLE.w, 1010);
    c.fillStyle = mixRgba('graphite', 'ash', 0.3); c.fillRect(POLE.x - 10, 966, POLE.w + 20, 24);
    // 行人號誌：兩小節一換（綠／紅），倒數一拍跳一格
    const bar = Math.floor(au.barAt(t) + 1e-6);
    const walk = Math.floor(bar / 2) % 2 === 0;
    const bt = au.beatAt(t);
    const left = 8 - (Math.floor(bt) % 8);
    const hx = POLE.x - 74, hy = 690;
    c.fillStyle = mixRgba('graphite', 'ink', 0.4); this.rr(c, hx, hy, 70, 112, 6); c.fill();
    c.fillStyle = mixRgba('ink2', 'ink', 0.5); this.rr(c, hx + 8, hy + 8, 54, 58, 4); c.fill();
    const on = walk ? mixRgba('signal', 'bone', 0.35) : rgba('blood');
    this.walker(c, hx + 35, hy + 37, walk, on, t);
    c.font = font(F.mono(700), 22); c.fillStyle = walk ? on : rgba('ash', 0.5); c.textAlign = 'center';
    c.fillText(String(left).padStart(2, '0'), hx + 35, hy + 98); c.textAlign = 'left';
    // 路牌
    // 舊的路牌淡一點（一個焦點：正在唱的那片）
    this.stack(t).reverse().forEach((it, i, arr) => this.drawBlade(c, it.b, it.top, it.flip, t, i === arr.length - 1 ? 1 : 0.62 + 0.14 * (i / Math.max(1, arr.length - 1))));
  }

  /** 號誌裡的小人（走路的綠人跟著拍子擺腿、紅人站著）。 */
  private walker(c: CanvasRenderingContext2D, x: number, y: number, walk: boolean, col: string, t: number) {
    c.save();
    c.translate(x, y);
    c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.arc(0, -17, 5, 0, Math.PI * 2); c.fill();
    const sw = walk ? Math.sin(this.ctx.audio.beatAt(t) * Math.PI) * 0.6 : 0;
    c.beginPath(); c.moveTo(0, -10); c.lineTo(0, 5); c.stroke();
    c.beginPath(); c.moveTo(0, 5); c.lineTo(Math.sin(sw) * 10, 18); c.moveTo(0, 5); c.lineTo(-Math.sin(sw) * 10, 18); c.stroke();
    c.beginPath(); c.moveTo(0, -6); c.lineTo(-Math.sin(sw) * 9, 4); c.moveTo(0, -6); c.lineTo(Math.sin(sw) * 9, 4); c.stroke();
    c.restore();
  }

  /** 一片路牌（以上緣為軸翻下來：flip 0 = 平的、看不到，1 = 垂下來）。 */
  private drawBlade(c: CanvasRenderingContext2D, b: Blade, top: number, flip: number, t: number, fade = 1) {
    if (top + b.h < -10) return;
    const sy = Math.max(0.001, flip < 1 ? ease.outBack(flip, 1.6) : 1);
    const x0 = BLADE.x, w = BLADE.w, h = b.h, tip = BLADE.tip;
    c.save();
    c.translate(0, top);
    c.scale(1, sy);
    // 翻到一半的牌子背光（比較暗），落定時面向我們
    const lit = 0.55 + 0.45 * Math.min(1, sy);
    // 支架（兩個夾在柱子上的扣環）
    c.fillStyle = mixRgba('graphite', 'ash', 0.4);
    c.fillRect(POLE.x - 4, 10, POLE.w + 8, 12); c.fillRect(POLE.x - 4, h - 22, POLE.w + 8, 12);
    // 牌面：訊號色的暗部（反光膜），細的紙白內框，右端是箭頭
    c.beginPath();
    c.moveTo(x0, 0); c.lineTo(x0 + w - tip, 0); c.lineTo(x0 + w, h / 2); c.lineTo(x0 + w - tip, h); c.lineTo(x0, h); c.closePath();
    c.fillStyle = mixRgba(mixRgba('blood', 'sepia', 0.35), 'ink', 1 - lit, 1);
    c.fill();
    c.save(); c.clip();
    // 反光膜上一道斜的亮光（跟著柱子位置走）
    const gg = c.createLinearGradient(x0, 0, x0 + w, h);
    gg.addColorStop(0, 'rgba(255,255,255,0.10)'); gg.addColorStop(0.35, 'rgba(255,255,255,0)'); gg.addColorStop(1, 'rgba(0,0,0,0.08)');
    c.fillStyle = gg; c.fillRect(x0, 0, w, h);
    c.restore();
    c.strokeStyle = rgba('bone', 0.8 * lit); c.lineWidth = 3;
    c.beginPath();
    const i = 9;
    c.moveTo(x0 + i, i); c.lineTo(x0 + w - tip - i * 0.4, i); c.lineTo(x0 + w - i * 1.3, h / 2); c.lineTo(x0 + w - tip - i * 0.4, h - i); c.lineTo(x0 + i, h - i); c.closePath();
    c.stroke();
    // 字
    c.save();
    c.translate(x0 + BLADE.padX, BLADE.padY + b.size * 0.9);
    if (b.bl) {
      const ink = { unsung: rgba('bone', 0.34), active: mixRgba('signal', 'bone', 0.25), sung: rgba('bone', 0.97) };
      paintBi(c, b.bl, t, ink, lit);
    } else if (b.street) {
      c.globalAlpha = lit;
      // 路名可能是新人很長的名字：縮到牌子的字區（箭頭與左右留白之外）
      c.font = font(F.hei(700), fitPx(b.street[0], F.hei(700), 48, STREET_W)); c.fillStyle = rgba('bone', 0.97); c.fillText(b.street[0], 0, 0);
      c.font = font(F.hei(500), fitPx(b.street[1], F.hei(500), 32, STREET_W)); c.fillStyle = rgba('bone', 0.8); c.fillText(b.street[1], 0, 50);
    }
    c.restore();
    // 舊的路牌蒙上一層午後的空氣（淡一點、不透明，後面的樹不會透出來）
    if (fade < 1) {
      c.beginPath();
      c.moveTo(x0, 0); c.lineTo(x0 + w - tip, 0); c.lineTo(x0 + w, h / 2); c.lineTo(x0 + w - tip, h); c.lineTo(x0, h); c.closePath();
      c.fillStyle = mixRgba('paper', 'bone', 0.3, (1 - fade) * 0.95); c.fill();
    }
    c.restore();
  }

  /** 候車亭：屋頂、兩根柱子、後面的玻璃、燈箱（第一拍閃兩下亮起來）、長椅。 */
  private drawShelter(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const S = SHELTER, B = { ...BOX, h: this.boxH };
    // 地上的影子（停在 HUD 上面）
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(S.x - 30, S.ground - 6, S.w + 40, 12);
    // 柱子、屋頂
    c.fillStyle = mixRgba('graphite', 'ash', 0.35);
    c.fillRect(S.x + 6, S.y + 20, 14, S.ground - S.y - 20); c.fillRect(S.x + S.w - 20, S.y + 20, 14, S.ground - S.y - 20);
    c.fillStyle = mixRgba('graphite', 'ink2', 0.3); c.fillRect(S.x - 16, S.y, S.w + 32, 26);
    c.fillStyle = mixRgba('ash', 'bone', 0.3); c.fillRect(S.x - 16, S.y + 26, S.w + 32, 4);
    // 屋頂上的站名小牌
    c.font = font(F.hei(700), 18); c.letterSpacing = '4px';
    const sw = c.measureText('公車站 BUS STOP').width;
    c.fillStyle = rgba('blood', 0.9); this.rr(c, S.x + 30, S.y - 38, sw + 30, 34, 4); c.fill();
    c.fillStyle = rgba('bone', 0.95); c.fillText('公車站 BUS STOP', S.x + 44, S.y - 14); c.letterSpacing = '0px';
    // 後面的玻璃（淡淡的、有一點反光）
    c.fillStyle = rgba('bone', 0.12); c.fillRect(S.x + 20, S.y + 30, S.w - 40, S.ground - S.y - 60);
    // 燈箱：外框、背光的廣告
    const k = this.lampK(t);
    c.fillStyle = mixRgba('graphite', 'ash', 0.2); this.rr(c, B.x - 14, B.y - 14, B.w + 28, B.h + 28, 6); c.fill();
    if (this.box) {
      c.save();
      c.globalAlpha = 1;
      c.drawImage(this.box, 0, 0, B.w, B.h, B.x, B.y, B.w, B.h);
      // 沒通電時暗、通電後背光（燈管剛亮的那一下比較亮）
      c.fillStyle = `rgba(0,0,0,${0.42 * (1 - k)})`; c.fillRect(B.x, B.y, B.w, B.h);
      c.restore();
    }
    // 每個小節線玻璃上一道反光滑過
    const bar = au.barAt(t), bp = bar - Math.floor(bar);
    const sweep = clamp(bp / 0.45);
    if (t > this.tOn && sweep < 1) {
      c.save();
      c.beginPath(); c.rect(B.x, B.y, B.w, B.h); c.clip();
      const sx = lerp(B.x - 200, B.x + B.w + 200, ease.inOutCubic(sweep));
      const gg = c.createLinearGradient(sx - 90, 0, sx + 90, 0);
      gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(0.5, `rgba(255,255,255,${0.22 * (1 - sweep)})`); gg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gg;
      c.beginPath(); c.moveTo(sx - 60, B.y); c.lineTo(sx + 140, B.y); c.lineTo(sx + 60, B.y + B.h); c.lineTo(sx - 140, B.y + B.h); c.closePath(); c.fill();
      c.restore();
    }
    // 長椅
    c.fillStyle = mixRgba('sepia', 'graphite', 0.4); c.fillRect(B.x + 90, 716, B.w - 180, 14);
    c.fillStyle = mixRgba('graphite', 'ash', 0.3); c.fillRect(B.x + 120, 730, 10, S.ground - 730); c.fillRect(B.x + B.w - 130, 730, 10, S.ground - 730);
  }

  /** 燈箱的亮度：第一拍前一點點閃兩下，第一拍全亮。 */
  private lampK(t: number) {
    const d = t - this.tOn;
    if (d >= 0) return 1;
    if (d > -0.09) return 0.8;
    if (d > -0.2) return 0.15;
    if (d > -0.26) return 0.7;
    return 0.05;
  }

  /** 車子：每個小節線一台（輪流往右、往左），車頭在小節線經過畫面中間。 */
  private drawCars(c: CanvasRenderingContext2D, t: number, cam: number) {
    const au = this.ctx.audio;
    const b0 = Math.floor(au.barAt(t)) - 1;
    for (let b = b0; b <= b0 + 2; b++) {
      const tb = au.timeOfBar(b);
      const dir = b % 2 === 0 ? 1 : -1;
      const far = dir < 0;
      const v = far ? 900 : 1250;
      const x = 960 + dir * (t - tb) * v - cam * 0.2;
      if (x < -500 || x > 2400) continue;
      // 車道在燈箱底邊下面：遠車道的車身也整台露出來（不會只剩兩個輪子從燈箱下面露出來）
      const sc = far ? 0.72 : 1;
      const y = far ? 752 : 792;
      const col = ['signal', 'ash', 'sepia', 'blood', 'graphite'][Math.floor(hash(this.seed, b, 3) * 5)]!;
      this.car(c, x, y, sc, dir, col, t);
    }
  }

  private car(c: CanvasRenderingContext2D, x: number, y: number, sc: number, dir: number, col: string, t: number) {
    c.save();
    c.translate(x, y); c.scale(sc * dir, sc);
    // 影子
    c.fillStyle = rgba('ink', 0.14); c.beginPath(); c.ellipse(0, 4, 150, 10, 0, 0, Math.PI * 2); c.fill();
    // 車身
    c.fillStyle = mixRgba(col, 'paper', 0.25);
    c.beginPath();
    c.moveTo(-140, -18); c.quadraticCurveTo(-142, -48, -110, -52); c.lineTo(-62, -54); c.quadraticCurveTo(-36, -92, 10, -92);
    c.lineTo(52, -92); c.quadraticCurveTo(86, -90, 104, -56); c.quadraticCurveTo(142, -50, 146, -26); c.lineTo(146, -14); c.lineTo(-140, -14); c.closePath();
    c.fill();
    // 車窗
    c.fillStyle = mixRgba('bone', 'ash', 0.35, 0.9);
    c.beginPath(); c.moveTo(-50, -56); c.quadraticCurveTo(-28, -84, 8, -84); c.lineTo(20, -84); c.lineTo(20, -56); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(30, -84); c.lineTo(52, -84); c.quadraticCurveTo(78, -82, 92, -56); c.lineTo(30, -56); c.closePath(); c.fill();
    // 車燈
    c.fillStyle = rgba('bone', 0.95); c.fillRect(134, -44, 10, 8);
    c.fillStyle = rgba('blood', 0.9); c.fillRect(-140, -42, 8, 10);
    // 輪子：素面的輪圈、一圈五顆螺絲（跟著走的距離轉；不要畫成輻條，免得像哪個車廠的標誌）
    for (const wx of [-86, 94]) {
      c.fillStyle = mixRgba('ink2', 'ink', 0.4); c.beginPath(); c.arc(wx, -14, 24, 0, Math.PI * 2); c.fill();
      c.fillStyle = mixRgba('ash', 'bone', 0.2); c.beginPath(); c.arc(wx, -14, 12, 0, Math.PI * 2); c.fill();
      c.fillStyle = mixRgba('graphite', 'ink', 0.3);
      const a = t * 18;
      for (let k = 0; k < 5; k++) { const aa = a + (k * Math.PI * 2) / 5; c.beginPath(); c.arc(wx + Math.cos(aa) * 7, -14 + Math.sin(aa) * 7, 1.8, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  }

  /** 落葉：幾片葉子從行道樹上慢慢飄下來、翻轉（確定性：葉子的編號＋時間）。 */
  private drawLeaves(c: CanvasRenderingContext2D, t: number, cam: number) {
    for (let i = 0; i < 7; i++) {
      const per = 6 + 3 * hash(this.seed, i, 1);
      const ph = (t / per + hash(this.seed, i, 2)) % 1;
      const k = Math.floor(t / per + hash(this.seed, i, 2));
      const x0 = 200 + 1500 * hash(this.seed, i, k);
      const x = x0 + 60 * Math.sin(ph * 9 + i) - cam * 0.3;
      const y = 380 + ph * 620;
      if (x > 1340 && y > 800) continue;
      const a = Math.sin(ph * 12 + i * 2) * 1.2;
      c.save();
      c.translate(x, y); c.rotate(a); c.scale(1, Math.abs(Math.cos(ph * 7 + i)) * 0.8 + 0.2);
      c.globalAlpha = Math.min(1, ph * 6, (1 - ph) * 6) * 0.8;
      c.fillStyle = mixRgba(mixRgba('sepia', 'signal', 0.25 + 0.35 * hash(this.seed, i, 5)), 'paper', 0.2);
      c.beginPath(); c.moveTo(-13, 0); c.quadraticCurveTo(0, -8, 13, 0); c.quadraticCurveTo(0, 8, -13, 0); c.fill();
      c.restore();
    }
  }

  private rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath(); c.roundRect(x, y, w, h, r);
  }
}
