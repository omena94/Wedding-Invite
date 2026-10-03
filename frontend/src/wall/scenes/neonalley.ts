// 巷弄直式霓虹（暗，批次 B3・街景）：下過雨的夜晚小巷，一點透視往巷底看，兩邊牆上伸出一塊塊直式霓虹招牌（冰果室、茶、旅社、咖啡……），
// 濕的地面倒映著招牌的光，細雨在燈下一閃一閃，巷底的街口偶爾有機車的車燈掃過。
//  - 兩行歌詞是左邊最近的一對直式招牌：大的一塊是中文（直書，一個字一格；英文單字轉 90° 躺著），緊貼在旁邊的窄招牌是原文（小一號），
//    同一個支架掛在牆上。字是燈管：還沒唱是沒通電的玻璃管，唱到的字「啪」地閃一下亮成訊號色，唱完轉成暖白燈管；
//    原文照自己的逐字時間通電（只亮白色、暗兩成）。沒有翻譯的歌：只有中文那一塊（窄招牌收起來）。
//    以拉丁字母為主的句子（英文字母多過一半）不躺著：同一根支架換掛一對橫式招牌（上面中文、下面原文），英文是正的、好讀。
//  - 主打留言是右邊最亮的那塊橫式燈箱（白色壓克力、黑字，外圈一圈訊號色的燈管，留言區約 680×380）：第一拍燈管閃兩下通電，
//    留言整塊亮起來，署名在最後一行下面。沒有留言：燈箱是邀請（新人的名字、一行邀請）。
//  - 一直在動：鏡頭很慢地往巷子裡推；每個小節線，巷裡有一塊招牌「滋」地閃兩下；巷底街口每兩小節一台機車的車燈掃過；
//    拍點上水窪裡落一滴雨（漣漪）；細雨一直下；巷口的電線跟著風微微晃。
//  - 濕地面：深色的柏油，招牌與燈箱的光往下拉成一條條直的光帶（被雨滴打得有點碎，不比招牌亮）。
//  - 右下角（HUD）是暗的濕地面，倒影在那裡淡掉。
// 手法：牆、地面、倒影、雨、天空、巷底在一個全螢幕 shader（一點透視：每個像素反推深度，牆上的磚縫、樓板、窗、排水管都照深度畫）；
// 招牌是 Canvas（背景的小招牌 init 先畫好、每格縮放貼上；歌詞招牌每格畫燈管）；亮著的燈管另外畫在 1/4、1/10 大小的光圖，
// 1/4 的疊加上去當光暈，1/10 的給 shader 算牆上的色光與地上的倒影。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, pulse } from '../engine/util';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { beatAfter, lyricSubOf, drawHeart, COUPLE_EN, DATE_DOTS, NAME_A, NAME_B, HAS_LATIN_NAMES } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { loadB3, msgBlock, drawMsgBlock, mainOnly, layoutBi, paintLay, B3_INVITE, SUB_RATIO, SUB_MIN, type BiLayout, type MsgBlock, type Rect } from './_b3';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'city', paper: false, energy: [0.15, 0.8], bars: [4, 8], weight: 1 };

/** 一點透視：消失點、左右牆的距離、地面與屋頂的高（乘上焦距後的畫面 px）、巷底的深度。 */
const VP = { x: 980, y: 520 };
const LW = 980, RW = 940, GH = 560, RH = 1300, SFAR = 1 / 6;
/** 歌詞招牌（左邊最近的一對）：上緣、中文招牌的左緣、兩塊之間的縫、招牌裡字的上下留白。 */
const LYR = { x: 206, y: 112, gap: 16, pad: 30, maxH: 690 };
/** 留言燈箱（右邊最近）：留言區 680×380（畫面的 12.5%）。 */
const BOX = { x: 1150, y: 150, w: 680, h: 380 };
const MSG_IN = { x: 42, y: 42, w: 596, h: 300 };
/** 巷子裡的小招牌：哪一邊、深度、上下（畫面 px 乘深度）、伸出來多寬、字、顏色。 */
const SIGNS: { side: -1 | 1; z: number; y0: number; y1: number; w: number; text: string; col: 'signal' | 'ember' | 'bone' | 'blood'; horiz?: boolean }[] = [
  { side: -1, z: 2.3, y0: -250, y1: 180, w: 160, text: '冰果室', col: 'ember' },
  { side: -1, z: 3.2, y0: -60, y1: 330, w: 150, text: '茶', col: 'bone' },
  { side: -1, z: 4.3, y0: -210, y1: 250, w: 150, text: '旅社', col: 'signal' },
  { side: -1, z: 5.4, y0: 40, y1: 330, w: 130, text: '麵', col: 'ember' },
  { side: -1, z: 2.8, y0: -330, y1: -200, w: 360, text: '營業中', col: 'signal', horiz: true },
  { side: 1, z: 3.9, y0: -430, y1: -70, w: 170, text: '咖啡', col: 'bone' },
  { side: 1, z: 5.0, y0: -300, y1: 20, w: 150, text: '花店', col: 'ember' },
  { side: 1, z: 5.6, y0: 120, y1: 380, w: 130, text: '書', col: 'signal' },
];
const SIGN_TEXT = SIGNS.map((s) => s.text).join('');
/** 純音樂時窄招牌上的字：新人有英文名就是英文名，沒有就是這句（不要把中文名在旁邊再印一次）。 */
const NAMES_SUB = HAS_LATIN_NAMES ? COUPLE_EN : 'JUST MARRIED';
/** 還沒通電的歌詞燈管：看得到的玻璃管（米白偏灰、約 0.45），賓客先讀到整句，唱到才亮成霓虹。 */
const GLASS = () => mixRgba('bone', 'ash', 0.35, 0.45);
/** 橫式招牌（英文為主的句子）：寬、左右與上下的留白。 */
const HZ = { w: 880, padX: 34, padY: 24 };
/** 英文字母多過一半的句子（這種句子直書要轉 90° 躺著，讀不下去）。 */
const latinish = (text: string) => {
  const chars = Array.from(text.replace(/[\s\p{P}]/gu, ''));
  return chars.filter((ch) => /[A-Za-z]/.test(ch)).length > chars.length * 0.5;
};

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D glowL; uniform float t; uniform float zoom; uniform vec4 rip[6]; uniform float scoot; uniform float wind;
  vec3 gAt(vec2 p) { vec4 c = fastLayer(texture(glowL, vec2(p.x / ${W}.0, 1.0 - p.y / ${H}.0))); return c.rgb; }
  // 光圖的大範圍模糊（牆上的色光）
  vec3 gBlur(vec2 p, float r) {
    vec3 s = gAt(p) * 0.2;
    for (int i = 0; i < 8; i++) { float a = float(i) * 0.785 + 0.3; s += gAt(p + vec2(cos(a), sin(a)) * r) * 0.1; }
    return s;
  }
  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = vec2(${VP.x}.0, ${VP.y}.0) + (p0 - vec2(${VP.x}.0, ${VP.y}.0)) / zoom;
    float dx = p.x - ${VP.x}.0, dy = p.y - ${VP.y}.0;
    vec3 col = C_INK * 0.6;
    // 光圖本身只有 1/10 大小（線性內插已經很糊），一圈 8 點就夠當大範圍的色光
    vec3 spill = gBlur(p0, 110.0) * 2.6;
    // 哪一面：左牆、右牆、地面、天空、巷底
    float sL = -dx / ${LW}.0, sR = dx / ${RW}.0, sG = dy / ${GH}.0, sS = -dy / ${RH}.0;
    if (sL > ${SFAR} && sL >= sG && sL >= sS || sR > ${SFAR} && sR >= sG && sR >= sS) {
      // 牆：深度 z、高度 Y（地面 = -GH）
      bool left = sL > sR;
      float s = left ? sL : sR;
      float z = 1.0 / s, Y = -dy / s;
      float n = fbm(vec2(z * 3.0, Y / 160.0) + (left ? 0.0 : 9.0), 3);
      vec3 alb = C_INK2 * (1.25 + 0.3 * n);
      // 樓板（每 330 一層）、磁磚的細縫
      float fl = abs(fract((Y + 560.0) / 330.0 + 0.02) - 0.5);
      alb *= 1.0 - 0.35 * smoothstep(0.47, 0.5, fl);
      alb *= 1.0 - 0.08 * step(0.92, fract(z * 9.0)) - 0.06 * step(0.9, fract(Y / 26.0));
      // 樓上的窗（有的亮著暖光，偶爾換）
      float wz = fract(z * 0.9 + (left ? 0.3 : 0.7)), wy = fract((Y + 560.0) / 330.0);
      vec2 wid = vec2(floor(z * 0.9 + (left ? 0.3 : 0.7)), floor((Y + 560.0) / 330.0) + (left ? 0.0 : 20.0));
      float win = step(0.26, wz) * step(wz, 0.44) * step(0.42, wy) * step(wy, 0.72) * step(660.0, Y + 560.0) * step(1.7, z);
      float on = step(0.6, hash12(wid + floor(t / 7.0 + hash12(wid) * 3.0) * 0.37));
      alb = mix(alb, mix(C_INK * 0.7, C_EMBER * 0.1 + C_BONE * 0.02, on), win);
      // 排水管（兩根，直直的）與冷氣機
      float pipe = step(abs(z - (left ? 1.9 : 2.2)), 0.025) + step(abs(z - (left ? 3.7 : 4.4)), 0.02);
      alb = mix(alb, C_GRAPHITE * 0.45, clamp(pipe, 0.0, 1.0));
      float ac = step(abs(z - (left ? 2.75 : 3.5)), 0.22) * step(abs(Y - (left ? 90.0 : -40.0)), 70.0);
      alb = mix(alb, C_GRAPHITE * 0.6 * (0.9 + 0.1 * step(0.5, fract(Y / 14.0))), ac);
      // 燈照到牆上的色光（近一點亮一點）
      col = alb + alb * spill * 2.6 + spill * 0.08;
      // 牆腳濕濕的一條暗
      col *= 1.0 - 0.35 * smoothstep(-460.0, -560.0, Y);
    } else if (sG > ${SFAR} && sG >= sS) {
      // 地面：深色的濕柏油
      float s = sG, z = 1.0 / s, X = dx / s;
      vec3 alb = C_INK * (0.72 + 0.1 * snoise(vec2(X / 40.0, z * 10.0)));
      // 這一條直線上方的牆腳（倒影從這裡往下拉）
      float yw = dx < 0.0 ? ${VP.y}.0 + ${GH}.0 * (-dx / ${LW}.0) : ${VP.y}.0 + ${GH}.0 * (dx / ${RW}.0);
      yw = min(${VP.y}.0 + (yw - ${VP.y}.0) * zoom, p0.y);
      float wob = 0.0;
      for (int i = 0; i < 6; i++) {
        vec4 R = rip[i];
        float d = t - R.z;
        if (d < 0.0 || d > 1.6) continue;
        vec2 q = (p0 - R.xy) / vec2(1.0, 0.32);
        float rr = 26.0 + 240.0 * d;
        float ring = exp(-pow((length(q) - rr) / 5.0, 2.0)) * (1.0 - d / 1.6);
        wob += ring * 6.0;
        col += 0.0;
      }
      // 倒影：這一條直線上方所有燈（招牌、燈箱）的顏色，往下拉成一條直的光帶，越往下越淡；
      // 雨滴把它打碎（直向拉長的雜訊＋一條條細的橫縫），漣漪讓它左右晃一下
      float wx = p0.x + (1.5 + wob) * sin(p0.y * 0.11 + t * 2.4);
      vec3 colL = vec3(0.0);
      for (int j = 0; j < 6; j++) colL += gAt(vec2(wx, mix(yw - 20.0, 90.0, float(j) / 5.0)));
      colL /= 6.0;
      float fall = exp(-(p0.y - yw) / 320.0);
      // 碎：沿著直線大致連續（直向拉長的雜訊），偶爾一段斷掉，再加一點點被雨滴打出來的細點
      float drops = (0.62 + 0.38 * snoise(vec2(p0.x / 9.0, p0.y / 70.0 - t * 1.1))) * (0.8 + 0.2 * snoise(vec2(p0.x / 2.2, p0.y / 5.0 + t * 3.0)));
      vec3 refl = colL * fall * drops * 0.8 + colL * min(wob, 1.0) * 0.25;
      // 右下角（HUD）的倒影淡掉：這一塊保持乾淨的暗地面
      refl *= 1.0 - smoothstep(1180.0, 1360.0, p0.x) * smoothstep(760.0, 840.0, p0.y);
      col = alb + refl + alb * spill * 0.6;
    } else if (sS > ${SFAR}) {
      // 天空：一條很暗的夜空，城市的光從下面染上來；兩條電線跟著風晃
      float s = sS;
      col = mix(C_INK * 0.5, C_INK2 * 0.9 + C_BLOOD * 0.06, smoothstep(0.0, 380.0, p.y));
      for (int i = 0; i < 2; i++) {
        float fi = float(i);
        float y0 = 120.0 + fi * 110.0, sag = 60.0 + 30.0 * fi + wind * 6.0 * (1.0 + fi);
        float xx = (p.x - 980.0) / 900.0;
        float yc = y0 + sag * (1.0 - xx * xx) + (fi - 0.5) * 40.0 * xx;
        col = mix(col, C_INK * 0.2, (1.0 - smoothstep(0.6, 1.6, abs(p.y - yc))) * 0.9);
      }
    } else {
      // 巷底：亮一點的街口，每兩小節一台機車的車燈掃過
      // 街口：對面一排暗暗的樓（零星幾扇亮窗、一樓一間亮著的小店）、一盞路燈的暖光、濕亮的街面
      float sy = ${VP.y}.0 + ${GH}.0 * ${SFAR};
      col = C_INK * 0.7;
      vec2 wc = floor(vec2(p.x / 26.0, (sy - p.y) / 30.0));
      vec2 wf = fract(vec2(p.x / 26.0, (sy - p.y) / 30.0));
      float wwin = step(0.3, wf.x) * step(wf.x, 0.72) * step(0.3, wf.y) * step(wf.y, 0.7) * step(2.0, wc.y);
      col += (C_EMBER * 0.09 + C_BONE * 0.02) * wwin * step(0.78, hash12(wc + 3.0));
      float shop = step(abs(p.x - 1010.0), 70.0) * step(sy - 50.0, p.y) * step(p.y, sy - 8.0);
      col = mix(col, C_EMBER * 0.18 + C_BONE * 0.05, shop);
      col += C_EMBER * 0.05 * exp(-length((p - vec2(900.0, sy - 110.0)) / vec2(70.0, 90.0)));
      // 街面（對面的店映在濕地上）
      if (p.y > sy - 8.0) col = C_INK * 0.9 + (C_EMBER * 0.08) * step(abs(p.x - 1010.0), 70.0);
      col += spill * 0.05;
      float hy = ${VP.y}.0 + ${GH}.0 * ${SFAR} - 22.0;
      vec2 hc = vec2(mix(780.0, 1180.0, scoot), hy);
      float head = exp(-length((p - hc) / vec2(60.0, 18.0)));
      col += (C_BONE * 0.7 + C_EMBER * 0.3) * head * step(0.001, scoot) * step(scoot, 0.999) * 1.6;
    }
    // 空氣裡的濕氣：燈的周圍一圈薄霧
    col += spill * 0.04;
    // 細雨：斜斜的短線，只有在燈下看得到
    float cell = floor((p0.x + p0.y * 0.18) / 9.0);
    float h = hash11(cell * 1.7);
    float ph = fract(p0.y / (140.0 + 120.0 * h) - t * (2.4 + h) + h * 7.0);
    float streak = smoothstep(0.93, 1.0, ph) * (1.0 - smoothstep(0.3, 1.4, abs(fract((p0.x + p0.y * 0.18) / 9.0) * 9.0 - 4.5))) * step(0.55, h);
    col += (C_BONE * 0.02 + spill * 1.8) * streak;
    fragColor = vec4(col, 1.0);
  }`, {
  glowL: { value: null }, t: { value: 0 }, zoom: { value: 1 }, scoot: { value: 0 }, wind: { value: 0 },
  rip: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) },
});

// ---------------------------------------------------------------- 直書排版
/** 直書的一個字（或一段躺著的英文）：第幾欄、在欄裡的上緣、佔多長、在這個 Word 裡的起點。 */
interface VG { wi: number; text: string; rot: boolean; punct: boolean; col: number; y: number; adv: number; off: number }
interface VLay { size: number; family: string; glyphs: VG[]; cols: number; colW: number; height: number; wordAdv: number[]; words: Word[] }

const PUNCT = /^[，。、！？：；,.!?:;…~～]$/;
const isLatin = (s: string) => /[A-Za-z0-9]/.test(s) && !/[　-鿿가-힯ᄀ-ᇿ㄰-㆏]/.test(s);

/**
 * 直書（一個字一格由上往下；英文單字、數字轉 90° 躺著；字與字之間原本有空白的地方多留一點）。
 * 放不下 maxH 就在字之間分成兩欄（右欄先，第二欄從左邊接）；再放不下就縮字級，縮到 minSize 還放不下就三欄。
 */
function vLayout(c: CanvasRenderingContext2D, line: Line, family: string, size: number, minSize: number, maxH: number): VLay {
  const build = (sz: number) => {
    c.font = font(family, sz);
    const toks: { wi: number; text: string; rot: boolean; punct: boolean; adv: number; off: number; gap: number }[] = [];
    const wordAdv: number[] = [];
    line.words.forEach((w, wi) => {
      const prev = line.words[wi - 1];
      const between = prev ? line.text.slice(prev.o + prev.w.length, w.o) : '';
      const gap = /\s/.test(between) ? sz * 0.32 : 0;
      let off = 0;
      if (isLatin(w.w)) {
        const adv = c.measureText(w.w).width + sz * 0.1;
        toks.push({ wi, text: w.w, rot: true, punct: false, adv, off, gap });
        off += adv;
      } else {
        Array.from(w.w).forEach((ch, k) => {
          const punct = PUNCT.test(ch);
          const adv = punct ? sz * 0.62 : sz * 1.04;
          toks.push({ wi, text: ch, rot: false, punct, adv, off, gap: k === 0 ? gap : 0 });
          off += adv;
        });
      }
      wordAdv.push(off);
    });
    return { toks, wordAdv };
  };
  const place = (sz: number, cols: number) => {
    const { toks, wordAdv } = build(sz);
    const total = toks.reduce((a, k) => a + k.adv + k.gap, 0);
    const target = total / cols;
    const glyphs: VG[] = [];
    let col = 0, y = 0, hMax = 0;
    for (let i = 0; i < toks.length; i++) {
      const k = toks[i]!;
      // 換欄只在字（Word）的開頭換，而且這一欄已經超過平均長度
      const startWord = i === 0 || toks[i - 1]!.wi !== k.wi;
      if (startWord && col < cols - 1 && y > 0 && y + k.adv > target + sz * 0.5) { col++; y = 0; }
      if (y > 0) y += k.gap;
      glyphs.push({ wi: k.wi, text: k.text, rot: k.rot, punct: k.punct, col, y, adv: k.adv, off: k.off });
      y += k.adv;
      hMax = Math.max(hMax, y);
    }
    return { size: sz, family, glyphs, cols: col + 1, colW: sz * 1.3, height: hMax, wordAdv, words: line.words } as VLay;
  };
  for (let sz = size; sz >= minSize; sz -= 2) {
    for (let cols = 1; cols <= 2; cols++) { const L = place(sz, cols); if (L.height <= maxH) return L; }
  }
  return place(minSize, 3);
}

/** 燈管的顏色與亮度（唱到的那一刻閃一下）。 */
function tubeState(w: Word, t: number, frac: number) {
  const p = Lyrics.wordProgress(w, t);
  const d = t - w.start;
  const flick = d > 0 && d < 0.14 ? (Math.floor(d / 0.035) % 2 === 0 ? 1 : 0.25) : 1;
  return { lit: clamp(p * 1.0001 - frac), flick, active: p > 0 && p < 1 };
}

export default class NeonAlley extends Scene {
  bg = shared('neonalley.bg', BG);
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glowS = this.track(new Layer2D(W, H, 0.25, { fast: true }));
  // 大光圖只要很糊的色光（1/20 大小）：牆上的色光與地上的倒影取樣它，太清楚的話字會在牆上映出一個個分身
  glowL = this.track(new Layer2D(W, H, 0.1, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 59 + (this.msg?.id ?? 0) * 7) >>> 0;
  /** 背景小招牌（底板＋玻璃管一張、通電的燈管一張）。 */
  signs: { base: HTMLCanvasElement; lit: HTMLCanvasElement; s: (typeof SIGNS)[number] }[] = [];
  box: HTMLCanvasElement | null = null;
  mb: MsgBlock | null = null;
  tOn = 0;
  /** 每一句的直書排版（中文、原文）與招牌的大小（整個窗格固定）。 */
  lays = new Map<Line, { main: VLay; sub: VLay | null; horiz: BiLayout | null }>();
  lines: Line[] = [];
  panel = { w: 200, h: 700, subW: 0, subH: 0 };
  size = 48;
  hasLyrics = false;
  /** 純音樂：招牌上是新人的名字。 */
  namesLay: { main: VLay; sub: VLay; horiz: null } | null = null;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    await loadB3(this.ctx, `${SIGN_TEXT}${NAMES_SUB}`);
    this.tOn = beatAfter(au, s + 0.08);
    this.buildBox();
    this.buildSigns();
    const c = this.fg.ctx;
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.size = lyricV2(this.mb ? this.mb.fit.size : null);
    const inner = LYR.maxH - LYR.pad * 2;
    let hMax = 0, wMax = 0, sH = 0, sW = 0;
    if (this.hasLyrics) {
      this.lines = lyrics.linesIn(s - 0.5, e + 0.4);
      for (const l of this.lines) {
        const sl = lyricSubOf(l);
        // 英文為主的句子：換成一對橫式招牌（英文躺著讀不下去）
        if (latinish(l.text) || (sl && latinish(sl.text))) {
          const horiz = layoutBi(c, l, { family: F.hei(500), size: this.size, minSize: V2.lyrMin, maxWidth: HZ.w - HZ.padX * 2, lineHeight: 1.16, subFamily: F.hei(500) });
          this.lays.set(l, { main: vLayout(c, mainOnly(l), F.hei(500), this.size, V2.lyrMin, inner), sub: null, horiz });
          continue;
        }
        const main = vLayout(c, mainOnly(l), F.hei(500), this.size, V2.lyrMin, inner);
        const sub = sl ? vLayout(c, sl, F.hei(500), Math.max(SUB_MIN, Math.round(main.size * SUB_RATIO)), SUB_MIN, inner) : null;
        this.lays.set(l, { main, sub, horiz: null });
        hMax = Math.max(hMax, main.height); wMax = Math.max(wMax, main.cols * main.colW);
        if (sub) { sH = Math.max(sH, sub.height); sW = Math.max(sW, sub.cols * sub.colW); }
      }
    } else {
      // 純音樂：中文招牌是新人的名字，窄招牌是英文名字（沒有英文名就是 NAMES_SUB 的通用句）；
      // 名字長的話 vLayout 自己會分欄、縮字
      const fake = (text: string): Line => {
        const words = Array.from(text).map((ch, i) => ({ w: ch, start: -1, end: -1, line: 0, index: i, gi: 0, o: i }));
        return { i: 0, text, start: -1, end: -1, words };
      };
      const en = NAMES_SUB.split(' ').map((w, i, arr) => ({ w, start: -1, end: -1, line: 0, index: i, gi: 0, o: arr.slice(0, i).join(' ').length + (i ? 1 : 0) }));
      const main = vLayout(c, fake(`${NAME_A}♥${NAME_B}`.replace(/\s/g, '')), F.hei(500), V2.lyrMax, V2.lyrMin, inner);
      const sub = vLayout(c, { i: 0, text: NAMES_SUB, start: -1, end: -1, words: en }, F.hei(500), 34, SUB_MIN, inner);
      this.namesLay = { main, sub, horiz: null };
      hMax = main.height; wMax = main.cols * main.colW; sH = sub.height; sW = sub.cols * sub.colW;
    }
    this.panel = { w: Math.max(wMax, this.size * 1.3) + 44, h: hMax + LYR.pad * 2, subW: sW ? sW + 30 : 0, subH: sH ? sH + LYR.pad * 1.6 : 0 };
    const hz = [...this.lays.values()].some((x) => x.horiz);
    this.avoid = [[BOX.x, BOX.y, BOX.w, BOX.h], [LYR.x, LYR.y, Math.max(this.panel.w + LYR.gap + this.panel.subW, hz ? HZ.w : 0), Math.max(this.panel.h, hz ? 330 : 0)]];
    void m;
  }

  /** 留言燈箱（畫一次）：白色壓克力、字、外框；外圈的燈管每格另外畫。 */
  private buildBox() {
    const m = this.msg;
    const cv = document.createElement('canvas');
    cv.width = BOX.w; cv.height = BOX.h;
    const c = cv.getContext('2d')!;
    c.textBaseline = 'alphabetic';
    const g = c.createLinearGradient(0, 0, 0, BOX.h);
    g.addColorStop(0, mixRgba('bone', 'paper', 0.1)); g.addColorStop(1, mixRgba('bone', 'paper', 0.4));
    c.fillStyle = g; c.fillRect(0, 0, BOX.w, BOX.h);
    if (m) {
      c.font = font(F.hei(700), 17); c.letterSpacing = '4px'; c.fillStyle = rgba('blood', 0.85);
      c.fillText(m.couple ? 'FROM THE COUPLE · 新人' : `No.${String(m.n).padStart(3, '0')}`, MSG_IN.x, 30); c.letterSpacing = '0px';
      const mb = (this.mb = msgBlock(c, m, F.hand(700), MSG_IN.w, MSG_IN.h, { sigFamily: F.hand(400), lineHeight: 1.26 }));
      c.save(); c.translate(MSG_IN.x, MSG_IN.y + Math.max(0, (MSG_IN.h - mb.h) * 0.45));
      drawMsgBlock(c, mb, { color: mixRgba('ink', 'sepia', 0.3), sigColor: rgba('blood', 0.95) });
      c.restore();
    } else {
      // 「名字 ♥ 名字」：名字是執行時的值，整排（含中間的愛心）放不下燈箱就整組縮小
      const a = NAME_A, b = NAME_B, fam = F.hand(700);
      const k = Math.min(1, (BOX.w - 120) / (measure(a, fam, 64) + 92 + measure(b, fam, 64)));
      c.font = font(fam, Math.floor(64 * k * 2) / 2); c.fillStyle = mixRgba('ink', 'sepia', 0.3);
      const wa = c.measureText(a).width;
      // 還沒定日期：少一行，名字往下挪一點，名字與邀請之間不空一大塊
      const yN = DATE_DOTS ? 150 : 180;
      c.fillText(a, 60, yN); drawHeart(c, 60 + wa + 46 * k, yN - 22 * k, 44 * k); c.fillText(b, 60 + wa + 92 * k, yN);
      if (DATE_DOTS) { c.font = font(F.mono(500), 20); c.letterSpacing = '6px'; c.fillStyle = rgba('sepia', 0.7); c.fillText(DATE_DOTS, 62, 204); c.letterSpacing = '0px'; }
      c.font = font(F.hei(500), 24); c.fillStyle = rgba('ink', 0.75); c.fillText(B3_INVITE, 60, 300);
    }
    // 壓克力的邊緣暗一點
    const v = c.createRadialGradient(BOX.w / 2, BOX.h / 2, BOX.h * 0.35, BOX.w / 2, BOX.h / 2, BOX.w * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = v; c.fillRect(0, 0, BOX.w, BOX.h);
    this.box = cv;
  }

  /** 背景的小招牌：底板、邊框、沒通電的玻璃管一張；通電的燈管一張（透明底）。 */
  private buildSigns() {
    for (const sg of SIGNS) {
      const s = 1 / sg.z;
      const w = Math.round(sg.w * s), h = Math.round((sg.y1 - sg.y0) * s);
      const mk = () => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d')!; c.textBaseline = 'alphabetic'; c.textAlign = 'center'; return { cv, c }; };
      const B = mk(), Lt = mk();
      B.c.fillStyle = mixRgba('ink2', 'ink', 0.3); B.c.fillRect(0, 0, w, h);
      B.c.strokeStyle = mixRgba('graphite', 'ink2', 0.4); B.c.lineWidth = 2; B.c.strokeRect(1, 1, w - 2, h - 2);
      const chars = Array.from(sg.text);
      const tube = (c: CanvasRenderingContext2D, col: string, glass: boolean) => {
        c.fillStyle = col; c.strokeStyle = col; c.lineWidth = Math.max(1.5, 3 * s);
        c.strokeRect(6 * s + 3, 6 * s + 3, w - 12 * s - 6, h - 12 * s - 6);
        if (sg.horiz) {
          const sz = Math.min(h * 0.55, (w * 0.8) / chars.length);
          c.font = font(F.hei(glass ? 500 : 300), sz);
          c.fillText(sg.text, w / 2, h / 2 + sz * 0.36);
        } else {
          const sz = Math.min(w * 0.62, (h * 0.84) / chars.length);
          c.font = font(F.hei(glass ? 500 : 300), sz);
          chars.forEach((ch, i) => c.fillText(ch, w / 2, h * 0.08 + (i + 0.86) * sz * 1.02 + (h * 0.84 - chars.length * sz * 1.02) / 2));
        }
      };
      tube(B.c, rgba('bone', 0.1), true);
      tube(Lt.c, mixRgba(sg.col, 'bone', 0.45), false);
      this.signs.push({ base: B.cv, lit: Lt.cv, s: sg });
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const p = ease.inOutQuad(prog(t, s, e));
    const zoom = 1 + 0.05 * p + 0.004 * pulse(t, au.timeOfBar(Math.floor(au.barAt(t) + 1e-6)), 0.12);
    const F2 = this.fg, GS = this.glowS, GL = this.glowL;
    F2.clear(); GS.clear();
    const c = F2.ctx, g = GS.ctx;
    for (const x of [c, g]) { x.save(); x.translate(VP.x, VP.y); x.scale(zoom, zoom); x.translate(-VP.x, -VP.y); }
    // ---- 背景小招牌（遠的先畫）；每個小節線有一塊「滋」地閃兩下
    const bar = Math.floor(au.barAt(t) + 1e-6);
    const flickI = Math.floor(hash(this.seed, bar) * SIGNS.length);
    const dtb = t - au.timeOfBar(bar);
    const order = this.signs.map((x, i) => i).sort((a, b) => SIGNS[b]!.z - SIGNS[a]!.z);
    for (const i of order) {
      const { base, lit, s: sg } = this.signs[i]!;
      const sc = 1 / sg.z;
      const xw = sg.side < 0 ? VP.x - LW * sc : VP.x + RW * sc;
      const x0 = sg.side < 0 ? xw + 6 * sc : xw - 6 * sc - base.width;
      const y0 = VP.y - sg.y1 * sc;
      // 支架
      c.fillStyle = mixRgba('graphite', 'ink', 0.5);
      c.fillRect(Math.min(xw, x0 + (sg.side < 0 ? 0 : base.width)), y0 + 8 * sc, Math.abs(x0 + (sg.side < 0 ? 0 : base.width) - xw) + 1, 5 * sc);
      c.drawImage(base, x0, y0);
      let k = 1;
      if (i === flickI && dtb > 0.05 && dtb < 0.4) k = [1, 0.1, 0.8, 0.05, 1, 0.3, 1][Math.floor((dtb - 0.05) / 0.05)] ?? 1;
      c.globalAlpha = k; c.drawImage(lit, x0, y0); c.globalAlpha = 1;
      g.globalAlpha = k * 0.9; g.drawImage(lit, x0, y0); g.globalAlpha = 1;
    }
    // ---- 留言燈箱（右邊最近）：它擋住的背景招牌，光也要擋掉（不然光暈疊回燈箱上面）
    g.save(); g.globalCompositeOperation = 'destination-out'; g.fillRect(BOX.x - 16, BOX.y - 16, BOX.w + 32, BOX.h + 32); g.restore();
    this.drawBox(c, g, t);
    // ---- 歌詞招牌（左邊最近）
    this.drawLyricSigns(c, g, t);
    for (const x of [c, g]) x.restore();
    F2.upload();
    // 大光圖：小光圖縮小貼過去（shader 拿去算牆上的色光與倒影）
    GL.clear();
    // 九宮格錯開疊加（lighter＝相加、每張九分之一）當作一次方框模糊：只要色光，不要看得出字的形狀
    GL.ctx.save(); GL.ctx.globalCompositeOperation = 'lighter'; GL.ctx.globalAlpha = 1 / 9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) GL.ctx.drawImage(GS.canvas, i * 60, j * 60, W, H);
    GL.ctx.restore();
    // 燈箱整塊的白光只給牆與地面（不疊在燈箱上，字才不會被洗白）
    const bk = this.lampK(t);
    GL.ctx.save(); GL.ctx.translate(VP.x, VP.y); GL.ctx.scale(zoom, zoom); GL.ctx.translate(-VP.x, -VP.y);
    GL.ctx.globalAlpha = 0.14 * bk; GL.ctx.fillStyle = rgba('bone'); GL.ctx.fillRect(BOX.x, BOX.y, BOX.w, BOX.h);
    GL.ctx.restore();
    GL.upload();
    GS.upload();
    // ---- 背景 shader
    const u = this.bg.u;
    u.t!.value = t; u.zoom!.value = zoom; u.glowL!.value = GL.texture;
    u.wind!.value = Math.sin(t * 0.8) + 0.4 * Math.sin(t * 2.1);
    // 巷底的機車：每兩小節一台，車頭燈在第二個小節線掃過街口
    const b2 = Math.floor(au.barAt(t) / 2) * 2 + 1;
    u.scoot!.value = clamp((t - (au.timeOfBar(b2) - 0.5)) / 1.0);
    // 拍點上水窪落一滴（位置照拍子的編號雜湊，地面上、避開右下角）
    const R = u.rip!.value as THREE.Vector4[];
    const bi = Math.floor(au.beatAt(t));
    for (let k = 0; k < 6; k++) {
      const b = bi - k;
      const x = 120 + 1080 * hash(this.seed, b, 1), y = 700 + 360 * hash(this.seed, b, 2);
      R[k]!.set(x, y, au.timeOfBeat(b), 0);
    }
    this.bg.render(renderer, out);
    comp.draw(renderer, F2.texture, out);
    comp.draw(renderer, GS.texture, out, { mode: 'add', tint: [1.5, 1.5, 1.5] });
    return { bloom: 0.75, vignette: 0.5, grain: 0.06, halation: 0.3, popupAvoid: this.avoid };
  }

  /** 留言燈箱：金屬框、白色壓克力（第一拍閃兩下通電）、外圈一圈訊號色的燈管、支架。 */
  private drawBox(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, t: number) {
    const k = this.lampK(t);
    // 支架（接到右牆）
    c.fillStyle = mixRgba('graphite', 'ink', 0.4);
    c.fillRect(BOX.x + BOX.w, BOX.y + 40, 1920 - BOX.x - BOX.w, 10); c.fillRect(BOX.x + BOX.w, BOX.y + BOX.h - 50, 1920 - BOX.x - BOX.w, 10);
    c.fillStyle = mixRgba('graphite', 'ink2', 0.3); c.fillRect(BOX.x - 16, BOX.y - 16, BOX.w + 32, BOX.h + 32);
    if (this.box) {
      c.drawImage(this.box, BOX.x, BOX.y);
      // 沒有留言時燈箱只是邀請（配角）：暗一點，焦點留給歌詞招牌
      c.fillStyle = `rgba(0,0,0,${1 - (1 - 0.75 * (1 - k)) * (this.msg ? 1 : 0.62)})`; c.fillRect(BOX.x, BOX.y, BOX.w, BOX.h);
      // 光：燈箱整塊亮（柔和的白光）
    }
    // 外圈燈管（圓角），通電後是訊號色
    const tube = mixRgba('signal', 'bone', 0.3);
    for (const x of [c, g]) {
      x.save();
      x.strokeStyle = k > 0.5 ? tube : rgba('bone', 0.12); x.lineWidth = x === c ? 4 : 12; x.globalAlpha = x === c ? 1 : k;
      x.beginPath(); x.roundRect(BOX.x - 28, BOX.y - 28, BOX.w + 56, BOX.h + 56, 18); x.stroke();
      x.restore();
    }
  }

  private lampK(t: number) {
    const d = t - this.tOn;
    if (d >= 0) return 1;
    if (d > -0.08) return 0.85;
    if (d > -0.18) return 0.1;
    if (d > -0.24) return 0.7;
    return 0.04;
  }

  /** 兩塊直式招牌：中文（大）、原文（窄，貼在右邊）。現在這一句：還沒唱的是玻璃管、唱到的閃一下亮、唱完暖白。 */
  private drawLyricSigns(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, t: number) {
    const { lyrics, audio: au } = this.ctx;
    const P = this.panel;
    let lay: { main: VLay; sub: VLay | null; horiz: BiLayout | null } | null = null;
    if (this.namesLay) lay = this.namesLay;
    else {
      const line = lyrics.shownLine(t, 1e4, 0.35) ?? lyrics.nextLine(t);
      lay = line ? this.lays.get(line) ?? null : null;
      if (!lay && this.lines.length) lay = this.lays.get(this.lines[0]!)!;
    }
    if (lay?.horiz) { this.drawHoriz(c, g, lay.horiz, t); return; }
    const hasSub = !!lay?.sub;
    // 支架：一根橫桿從左牆伸出來，兩塊招牌掛在上面
    c.fillStyle = mixRgba('graphite', 'ink', 0.45);
    c.fillRect(60, LYR.y - 22, LYR.x - 60 + P.w + (hasSub ? LYR.gap + P.subW : 0), 9);
    c.fillRect(60, LYR.y + P.h - 40, LYR.x - 60, 8);
    const panel = (x: number, w: number, h: number) => {
      c.fillStyle = mixRgba('graphite', 'ink', 0.5); c.fillRect(x + w * 0.3, LYR.y - 14, 4, 14); c.fillRect(x + w * 0.7, LYR.y - 14, 4, 14);
      c.fillStyle = mixRgba('ink2', 'ink', 0.2); c.fillRect(x, LYR.y, w, h);
      c.strokeStyle = mixRgba('graphite', 'ink2', 0.5); c.lineWidth = 3; c.strokeRect(x + 1.5, LYR.y + 1.5, w - 3, h - 3);
      // 招牌邊上一圈細燈管（暗暗的訊號色）
      for (const x2 of [c, g]) { x2.save(); x2.strokeStyle = mixRgba('signal', 'ink2', 0.45); x2.lineWidth = x2 === c ? 2.5 : 6; x2.globalAlpha = x2 === c ? 0.9 : 0.5; x2.strokeRect(x + 10, LYR.y + 10, w - 20, h - 20); x2.restore(); }
    };
    g.save(); g.globalCompositeOperation = 'destination-out';
    g.fillRect(LYR.x, LYR.y, P.w, P.h); if (hasSub) g.fillRect(LYR.x + P.w + LYR.gap, LYR.y, P.subW, P.subH);
    g.restore();
    panel(LYR.x, P.w, P.h);
    if (hasSub) panel(LYR.x + P.w + LYR.gap, P.subW, P.subH);
    if (!lay) return;
    // 每個小節有一個唱完的字「滋」地暗一下（確定性：小節編號挑字）
    const bar = Math.floor(au.barAt(t) + 1e-6);
    const buzz = Math.floor(hash(this.seed, bar, 7) * Math.max(1, lay.main.glyphs.length));
    const dtb = t - au.timeOfBeat(Math.floor(au.beatAt(au.timeOfBar(bar))) + 2);
    const buzzK = dtb > 0 && dtb < 0.16 ? (Math.floor(dtb / 0.04) % 2 ? 0.35 : 1) : 1;
    this.tubes(c, g, lay.main, LYR.x + P.w / 2 + ((lay.main.cols - 1) * lay.main.colW) / 2, LYR.y + LYR.pad, t, false, buzz, buzzK);
    if (lay.sub) this.tubes(c, g, lay.sub, LYR.x + P.w + LYR.gap + P.subW / 2 + ((lay.sub.cols - 1) * lay.sub.colW) / 2, LYR.y + LYR.pad * 0.8, t, true, -1, 1);
  }

  /**
   * 英文為主的句子：同一根支架換掛一對橫式招牌——上面一塊是中文（翻譯，大）、下面用兩條短鏈吊一塊原文（小）。
   * 燈管的顏色照直書的規則：中文唱到的字訊號色、唱完暖白；原文只亮白色、暗兩成。
   */
  private drawHoriz(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, bl: BiLayout, t: number) {
    const rowsW = (lay: BiLayout['main']) => Math.max(...lay.rows.map((r) => r.width), 0);
    const lhM = bl.main.size * (bl.mainSt.lineHeight ?? 1.16);
    const mw = Math.min(HZ.w, rowsW(bl.main) + HZ.padX * 2), mh = (bl.main.rows.length - 1) * lhM + bl.main.size * 1.12 + HZ.padY * 2;
    const x = LYR.x, y = LYR.y;
    const sub = bl.sub, subSt = bl.subSt;
    const sw = sub ? Math.min(HZ.w, rowsW(sub) + HZ.padX * 2) : 0;
    const sh = sub ? (sub.rows.length - 1) * sub.size * 1.14 + sub.size * 1.15 + HZ.padY * 1.6 : 0;
    const sy = y + mh + 30;
    // 支架：一根橫桿從左牆伸出來
    c.fillStyle = mixRgba('graphite', 'ink', 0.45);
    c.fillRect(60, y - 22, x - 60 + Math.max(mw, sw) * 0.85, 9);
    // 光圖：招牌底下的光先擋掉（光暈才不會疊回招牌上）
    g.save(); g.globalCompositeOperation = 'destination-out';
    g.fillRect(x, y, mw, mh); if (sub) g.fillRect(x, sy, sw, sh);
    g.restore();
    const plate = (px: number, py: number, w: number, h: number, hook: number) => {
      c.fillStyle = mixRgba('graphite', 'ink', 0.5);
      for (const hx of [px + w * 0.2, px + w * 0.8]) c.fillRect(hx, py - hook, 4, hook);
      c.fillStyle = mixRgba('ink2', 'ink', 0.2); c.fillRect(px, py, w, h);
      c.strokeStyle = mixRgba('graphite', 'ink2', 0.5); c.lineWidth = 3; c.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3);
      for (const x2 of [c, g]) { x2.save(); x2.strokeStyle = mixRgba('signal', 'ink2', 0.45); x2.lineWidth = x2 === c ? 2.5 : 6; x2.globalAlpha = x2 === c ? 0.9 : 0.5; x2.strokeRect(px + 10, py + 10, w - 20, h - 20); x2.restore(); }
    };
    plate(x, y, mw, mh, 14);
    if (sub) plate(x, sy, sw, sh, 30);
    // 字：玻璃管（沒通電）→ 通電的燈管 → 光圖
    const act = mixRgba('signal', 'bone', 0.18), lit = mixRgba('bone', 'signal', 0.28), glow = mixRgba('signal', 'bone', 0.1, 0.9);
    const clear = 'rgba(0,0,0,0)';
    c.save(); c.translate(x + HZ.padX, y + HZ.padY + bl.main.size * 0.9);
    paintLay(c, bl.main, bl.mainSt, t, { unsung: GLASS(), active: act, sung: lit });
    c.restore();
    g.save(); g.translate(x + HZ.padX, y + HZ.padY + bl.main.size * 0.9);
    // 光圖用一樣的字重（拉丁字不同字重寬度不一樣，粗一號的光會跟字錯開、看起來像疊影）
    paintLay(g, bl.main, bl.mainSt, t, { unsung: clear, active: act, sung: glow }, 0.8);
    g.restore();
    if (sub && subSt) {
      c.save(); c.translate(x + HZ.padX, sy + HZ.padY * 0.8 + sub.size * 0.9);
      paintLay(c, sub, subSt, t, { unsung: GLASS(), active: rgba('bone', 0.85), sung: rgba('bone', 0.8) });
      c.restore();
      g.save(); g.translate(x + HZ.padX, sy + HZ.padY * 0.8 + sub.size * 0.9); g.globalAlpha = 0.6;
      paintLay(g, sub, subSt, t, { unsung: clear, active: rgba('bone', 0.5), sung: rgba('bone', 0.5) });
      g.restore();
    }
  }

  /** 畫一塊招牌上的燈管字（x0 = 最右一欄的中心、y0 = 上緣）。sub：原文（只亮白色、暗兩成）。 */
  private tubes(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, L: VLay, x0: number, y0: number, t: number, sub: boolean, buzz: number, buzzK: number) {
    const sz = L.size;
    const litCol = sub ? rgba('bone', 0.8) : mixRgba('bone', 'signal', 0.28);
    const actCol = sub ? rgba('bone', 0.85) : mixRgba('signal', 'bone', 0.18);
    const glowCol = sub ? rgba('bone', 0.5) : mixRgba('signal', 'bone', 0.1, 0.9);
    const draw = (x: CanvasRenderingContext2D, gl: VG, weight: number, col: string, clipK = 1) => {
      const cx = x0 - gl.col * L.colW, top = y0 + gl.y;
      x.save();
      if (clipK < 1) { x.beginPath(); x.rect(cx - sz, top - 2, sz * 2, gl.adv * clipK + 2); x.clip(); }
      x.font = font(F.hei(weight), sz); x.fillStyle = col; x.textBaseline = 'alphabetic';
      if (gl.rot) {
        x.translate(cx, top); x.rotate(Math.PI / 2); x.textAlign = 'left';
        x.fillText(gl.text, sz * 0.05, sz * 0.36);
      } else if (gl.text === '♥') {
        drawHeart(x, cx, top + sz * 0.5, sz * 0.72, col);
      } else {
        x.textAlign = 'center';
        // 直書的標點：靠右上
        x.fillText(gl.text, cx + (gl.punct ? sz * 0.3 : 0), top + (gl.punct ? sz * 0.5 : sz * 0.86));
      }
      x.restore();
    };
    L.glyphs.forEach((gl, i) => {
      const w = L.words[gl.wi]!;
      const named = w.start < 0; // 純音樂的名字：一直亮著
      const st = named ? { lit: 1, flick: 1, active: false } : tubeState(w, t, gl.off / Math.max(1e-3, L.wordAdv[gl.wi]!));
      const frac = named ? 1 : clamp((Lyrics.wordProgress(w, t) * L.wordAdv[gl.wi]! - gl.off) / gl.adv);
      // 玻璃管（沒通電）
      draw(c, gl, 500, GLASS());
      if (frac <= 0) return;
      const k = st.flick * (i === buzz && frac >= 1 ? buzzK : 1);
      const col = st.active && !sub ? actCol : litCol;
      // 燈管：外圈有顏色、中間熱白（兩種字重疊），光圖畫粗一點
      c.save(); c.globalAlpha = k;
      draw(c, gl, 500, col, frac);
      // 中文、韓文字的寬固定，細一號的字剛好疊在正中間當「熱白的芯」；躺著的英文不同字重寬度不一樣，只畫一層
      if (!gl.rot) draw(c, gl, 300, sub ? rgba('bone', 0.9) : mixRgba('bone', 'signal', 0.08), frac);
      c.restore();
      g.save(); g.globalAlpha = k * (sub ? 0.6 : 1);
      draw(g, gl, gl.rot ? 500 : 900, st.active && !sub ? actCol : glowCol, frac);
      g.restore();
    });
  }
}
