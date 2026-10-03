// 雙語鍵盤（暗，雙語）：深夜的書桌，一把背光機械鍵盤（每顆鍵帽印兩種字：左上拉丁字母、右下韓文字母，像雙語鍵盤），
// 上方一台螢幕開著文字編輯器，螢幕邊貼著一張便利貼。
//  - 唱一個字就按下一顆鍵：原文照「兩套式」鍵位拆成字母一顆一顆按（韓文拆成子音母音、英文照字母），中文每個字按一顆；
//    按下去的鍵下沉、背光一閃（訊號色），鍵帽上的字透光亮起來。每句開頭按一下「한/영」（切換語言），每句唱完按 Enter。
//  - 螢幕上同時「打」出兩行：中文一行（大）、原文一行（小一號，在下面），還沒打到的字是淡淡的預測文字，打到的字實心、
//    正在打的字是訊號色、後面一根游標在閃。上一組留在上面、淡淡的（文件往下長）。沒有翻譯的歌只有中文一行，原文那一行收起來。
//  - 第一拍背光亮起來；每個小節線一道光從鍵盤左邊掃到右邊（背光的波浪）。鏡頭很慢地推近，鍵盤（近）動得比螢幕（遠）多。
//  - 主打留言寫在螢幕邊的便利貼上（留言標準 v2：便利貼約 600×430、手寫 40～60 px）；沒有留言時便利貼是一張待辦清單（邀請）。
// 畫法：牆與桌面一個 shader；螢幕外框與便利貼是 init 畫一次的圖層；螢幕裡的字每格畫；
// 鍵盤是另一個 shader（光線打到傾斜的平面、每顆鍵帽自己算：鍵帽頂、前緣、縫裡的背光、按下去的深度），鍵帽上的字是 init 畫好的一張遮罩。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, noise1, frameIdx } from '../engine/util';
import { fitText } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, drawLyricSub, lyricSubOf, subGap, beatAfter, COUPLE_ZH, COUPLE_EN, fitPx, type LyricStyle } from './_motifs';
import { INVITE_SMALL } from './_t19';
import { barsIn, beatsIn as beatsOf } from './_t1';
import { placeBlock, drawBlock, sigOf, fitV2 } from './_t22';
import { lyricV2, V2 } from './_v2';
import { mainOnly, preloadPair, hasSubIn, type Rect } from './_b4';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'lingo', paper: false, energy: [0.25, 0.95], bars: [4, 12], weight: 1 };

// ---------------------------------------------------------------- 鍵盤的排列（鍵盤座標：1 單位 = 96 px）
interface KeyDef { a: string; h?: string; w: number; row: number }
const ROWS: [string, string, number][][] = [
  [['`', '', 1], ['1', '', 1], ['2', '', 1], ['3', '', 1], ['4', '', 1], ['5', '', 1], ['6', '', 1], ['7', '', 1], ['8', '', 1], ['9', '', 1], ['0', '', 1], ['-', '', 1], ['=', '', 1], ['Back', '', 2]],
  [['Tab', '', 1.5], ['Q', 'ㅂ', 1], ['W', 'ㅈ', 1], ['E', 'ㄷ', 1], ['R', 'ㄱ', 1], ['T', 'ㅅ', 1], ['Y', 'ㅛ', 1], ['U', 'ㅕ', 1], ['I', 'ㅑ', 1], ['O', 'ㅐ', 1], ['P', 'ㅔ', 1], ['[', '', 1], [']', '', 1], ['\\', '', 1.5]],
  [['Caps', '', 1.75], ['A', 'ㅁ', 1], ['S', 'ㄴ', 1], ['D', 'ㅇ', 1], ['F', 'ㄹ', 1], ['G', 'ㅎ', 1], ['H', 'ㅗ', 1], ['J', 'ㅓ', 1], ['K', 'ㅏ', 1], ['L', 'ㅣ', 1], [';', '', 1], ["'", '', 1], ['Enter', '', 2.25]],
  [['Shift', '', 2.25], ['Z', 'ㅋ', 1], ['X', 'ㅌ', 1], ['C', 'ㅊ', 1], ['V', 'ㅍ', 1], ['B', 'ㅠ', 1], ['N', 'ㅜ', 1], ['M', 'ㅡ', 1], [',', '', 1], ['.', '', 1], ['/', '', 1], ['Shift ', '', 2.75]],
  [['Ctrl', '', 1.25], ['Fn', '', 1.25], ['Alt', '', 1.25], [' ', '', 6.25], ['한/영', '', 1.25], ['漢字', '', 1.25], ['Menu', '', 1.25], ['Ctrl ', '', 1.25]],
];
const KEYS: KeyDef[] = ROWS.flatMap((r, row) => r.map(([a, h, w]) => ({ a, h: h || undefined, w, row })));
const NK = KEYS.length;
const ROW_BASE = ROWS.map((_, i) => ROWS.slice(0, i).reduce((s, r) => s + r.length, 0));
const KEY_OF = new Map(KEYS.map((k, i) => [k.a, i]));
const U = 96, KM = 30;
/** 鍵盤大小（鍵盤座標 px）。 */
const KW = 15 * U + 2 * KM, KD = 5 * U + 2 * KM;
const LETTERS = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('');
const KEYS_TEXT = KEYS.map((k) => k.a + (k.h ?? '')).join('');

// 兩套式：子音母音 → 按哪幾顆鍵（雙子音加 Shift、複合母音按兩顆）
const JAMO: Record<string, string[]> = {
  ㄱ: ['R'], ㄲ: ['Shift', 'R'], ㄴ: ['S'], ㄷ: ['E'], ㄸ: ['Shift', 'E'], ㄹ: ['F'], ㅁ: ['A'], ㅂ: ['Q'], ㅃ: ['Shift', 'Q'], ㅅ: ['T'], ㅆ: ['Shift', 'T'],
  ㅇ: ['D'], ㅈ: ['W'], ㅉ: ['Shift', 'W'], ㅊ: ['C'], ㅋ: ['Z'], ㅌ: ['X'], ㅍ: ['V'], ㅎ: ['G'],
  ㅏ: ['K'], ㅐ: ['O'], ㅑ: ['I'], ㅒ: ['Shift', 'O'], ㅓ: ['J'], ㅔ: ['P'], ㅕ: ['U'], ㅖ: ['Shift', 'P'], ㅗ: ['H'], ㅘ: ['H', 'K'], ㅙ: ['H', 'O'], ㅚ: ['H', 'L'],
  ㅛ: ['Y'], ㅜ: ['N'], ㅝ: ['N', 'J'], ㅞ: ['N', 'P'], ㅟ: ['N', 'L'], ㅠ: ['B'], ㅡ: ['M'], ㅢ: ['M', 'L'], ㅣ: ['L'],
  ㄳ: ['R', 'T'], ㄵ: ['S', 'W'], ㄶ: ['S', 'G'], ㄺ: ['F', 'R'], ㄻ: ['F', 'A'], ㄼ: ['F', 'Q'], ㄽ: ['F', 'T'], ㄾ: ['F', 'X'], ㄿ: ['F', 'V'], ㅀ: ['F', 'G'], ㅄ: ['Q', 'T'],
};
const LJ = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', VJ = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ', TJ = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
/** 一個字要按哪幾顆鍵：韓文拆成子音母音、拉丁字母照字母、其他（中文）照字碼挑一顆字母鍵。 */
function keysFor(ch: string): string[] {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0xac00 && cp <= 0xd7a3) {
    const c = cp - 0xac00, l = Math.floor(c / 588), v = Math.floor((c % 588) / 28), t = c % 28;
    return [...JAMO[LJ[l]!]!, ...JAMO[VJ[v]!]!, ...(t ? JAMO[TJ[t]!]! : [])];
  }
  if (JAMO[ch]) return JAMO[ch]!;
  const up = ch.toUpperCase();
  if (/^[A-Z]$/.test(up)) return [up];
  if (/^[0-9]$/.test(ch)) return [ch];
  if (/\s/.test(ch)) return [' '];
  if (ch === '&') return ['Shift', '7'];
  if (/[,.!?'’]/.test(ch)) return [ch === '!' || ch === '?' ? '/' : ch === '’' ? "'" : ch];
  if (/[，。！？、]/.test(ch)) return [];
  return [LETTERS[Math.floor(hash(cp, 17) * LETTERS.length)]!];
}

/** 螢幕（編輯器）與便利貼的位置（畫面 px）。 */
const MON = { x: 110, y: 40, w: 1080, h: 600 };
const SCR = { x: 134, y: 64, w: 1032, h: 540 };
const ED = { x: 236, w: 880, y: 390 };
const NOTE = { x: 1150, y: 138, w: 600, h: 430, rot: 0.035 };
const NM = { x: 44, y: 70, w: 512, h: 330 };
/** 鍵盤的鏡頭：傾斜角、焦距、鍵盤中心在鏡頭空間的位置。 */
const PITCH = -0.95, FOC = 1600;
const KC = { x: 650 - W / 2, y: 450, z: 2250 };

const T_FILE = 'lyrics_譯.txt';
/**
 * 純音樂時一拍打一個字：打新人的名字（有英文名打英文大寫；沒有就打中文，一個字按一顆鍵）。
 * 名字長短每一場不一樣，字級照「整個名字放進編輯器」縮（init 算的 idlePx）；打完一輪下一拍換新的一行重打（不會捲掉半個名字）。
 */
const IDLE_TEXT = COUPLE_EN.toUpperCase();
const IDLE = Array.from(`${IDLE_TEXT}  `);
const IDLE_FAM = F.archivo(100, 700);
const T_TODO = '待辦：';

// ---------------------------------------------------------------- 牆與桌面（整晚共用）
const ROOM = () => new FSPass(/* glsl */ `
  uniform float mon; uniform float back; uniform vec2 drift; uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y) + drift;
    float desk = smoothstep(700.0, 712.0, p.y);
    // 牆：很暗，螢幕的光在牆上暈開一大片（冷一點的白），便利貼那邊也被照到一點
    vec3 wall = C_INK * 0.85 + C_INK2 * 0.2;
    float halo = exp(-pow(length((p - vec2(650.0, 330.0)) / vec2(820.0, 520.0)), 2.0));
    wall += mix(C_BONE, C_ASH, 0.5) * 0.07 * mon * halo;
    // 桌面：深色木頭（往後收的木紋），螢幕與鍵盤背光的反光
    float z = clamp((p.y - 700.0) / 380.0, 0.0, 1.0);
    float g = fbm(vec2((p.x - 650.0) / (200.0 + 600.0 * z), z * 30.0), 3);
    vec3 dk = mix(C_INK2, C_SEPIA, 0.1) * (0.5 + 0.25 * z) * (0.9 + 0.2 * g);
    dk += mix(C_BONE, C_ASH, 0.5) * 0.05 * mon * exp(-pow((p.x - 650.0) / 700.0, 2.0)) * (1.0 - z);
    dk += C_SIGNAL * 0.06 * back * exp(-pow(length((p - vec2(650.0, 910.0)) / vec2(780.0, 230.0)), 2.0));
    vec3 col = mix(wall, dk, desk);
    fragColor = vec4(col, 1.0);
  }`, { mon: { value: 0 }, back: { value: 0 }, drift: { value: new THREE.Vector2() }, t: { value: 0 } });

// ---------------------------------------------------------------- 鍵盤（疊在上面，鍵盤外面透明）
const KEYS_PASS = () => new FSPass(/* glsl */ `
  uniform sampler2D leg; uniform mat3 R; uniform vec3 P0;
  uniform float kp[${NK}]; uniform float kl[${NK}]; uniform float kw[${NK}];
  uniform float back; uniform float wave; uniform float t;
  const float U = ${U}.0, KM = ${KM}.0;
  const vec2 KB = vec2(${KW}.0, ${KD}.0);
  vec2 toLocal(vec2 p) {
    vec3 d = vec3(p - vec2(${W / 2}.0, ${H / 2}.0), ${FOC}.0);
    vec3 n = R * vec3(0.0, 0.0, 1.0);
    float s = dot(P0, n) / dot(d, n);
    vec3 l = transpose(R) * (d * s - P0);
    return l.xy + KB * 0.5;
  }
  float rbox(vec2 q, vec2 hs, float r) { vec2 d = abs(q) - hs + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 l = toLocal(p);
    // 遮罩的 mip 層在分支外算（遠排的字比較小）
    vec2 tp = l * 1.25;
    float lod = max(0.0, log2(max(length(dFdx(tp)), length(dFdy(tp)))) - 0.2);
    vec4 lg = fastLayer(textureLod(leg, vec2(l.x / KB.x, 1.0 - l.y / KB.y), lod));
    float cs = rbox(l - KB * 0.5, KB * 0.5, 26.0);
    float aa = length(vec2(dFdx(cs), dFdy(cs))) + 0.001;
    float inCase = 1.0 - smoothstep(-aa, aa, cs);
    if (inCase <= 0.0) { fragColor = vec4(0.0); return; }
    // 外殼：深色金屬，遠的那一邊一道亮邊
    vec3 col = mix(C_INK2, C_GRAPHITE, 0.25) * 0.55 + C_BONE * 0.06 * smoothstep(-8.0, -2.0, cs) * smoothstep(60.0, 0.0, l.y);
    float r = floor((l.y - KM) / U);
    vec3 bl = mix(C_SIGNAL, C_EMBER, 0.3);
    // 背光的波浪：小節線時一道光從左掃到右
    float wv = exp(-pow((l.x - wave) / 180.0, 2.0));
    if (r >= 0.0 && r < 5.0 && l.x > KM && l.x < KB.x - KM) {
      int ri = int(r);
      int base = ri == 0 ? 0 : ri == 1 ? ${ROW_BASE[1]} : ri == 2 ? ${ROW_BASE[2]} : ri == 3 ? ${ROW_BASE[3]} : ${ROW_BASE[4]};
      int cnt = ri == 0 ? ${ROWS[0]!.length} : ri == 1 ? ${ROWS[1]!.length} : ri == 2 ? ${ROWS[2]!.length} : ri == 3 ? ${ROWS[3]!.length} : ${ROWS[4]!.length};
      float u = (l.x - KM) / U, x0 = 0.0;
      int k = -1; float kwid = 1.0;
      for (int i = 0; i < 15; i++) {
        if (i >= cnt) break;
        float w = kw[base + i];
        if (u < x0 + w) { k = base + i; kwid = w; break; }
        x0 += w;
      }
      if (k >= 0) {
        float press = kp[k], lit = kl[k];
        vec2 cell = vec2(kwid * U, U);
        vec2 q = vec2(l.x - KM - x0 * U, l.y - KM - r * U) - cell * 0.5;
        // 縫裡的背光（按下去、剛亮的鍵周圍更亮）
        float gapGlow = back * (0.16 + 0.35 * wv) + 1.6 * lit;
        vec3 plate = bl * gapGlow * 0.55;
        // 鍵帽：底（外框）與頂（凹下去的一面），按下去時整顆往下沉（頂縮小一點、往前一點）
        vec2 off = vec2(0.0, 5.0 * press);
        float base0 = rbox(q - off * 0.5, cell * 0.5 - 5.0, 9.0);
        vec2 topHs = cell * 0.5 - vec2(13.0, 12.0) - 2.0 * press;
        float top = rbox(q - vec2(0.0, -6.0) - off, topHs, 10.0);
        vec3 capSide = mix(C_INK2, C_GRAPHITE, 0.3) * 0.45;
        vec3 capTop = mix(C_INK2, C_GRAPHITE, 0.42) * (0.62 - 0.12 * press);
        // 頂面：遠的一邊被螢幕照亮一點、近的一邊暗一點（凹面）
        capTop *= 1.0 + 0.25 * smoothstep(topHs.y, -topHs.y, q.y);
        // 前緣（看得到的那一面）比較暗、側邊的亮邊
        vec3 kc = mix(capSide * (0.8 + 0.3 * smoothstep(0.0, cell.y * 0.5, -q.y)), capTop, 1.0 - smoothstep(-1.0, 1.0, top));
        kc += C_BONE * 0.05 * smoothstep(-3.0, 0.0, top) * smoothstep(0.0, -topHs.y, q.y);
        // 字透光：背光從字裡透出來，剛按到的鍵亮很多
        float glyph = lg.a;
        kc = mix(kc, mix(C_BONE, bl, 0.45) * (0.32 + 0.3 * back + 0.35 * wv * back + 2.2 * lit), glyph * (1.0 - smoothstep(-1.0, 1.0, top)));
        // 鍵帽底部邊緣透出一圈背光（鍵帽是半透明的底座）
        kc += bl * (0.05 * back + 0.5 * lit) * smoothstep(-6.0, 0.0, base0);
        col = mix(plate, kc, 1.0 - smoothstep(-1.0, 1.0, base0));
      }
    }
    fragColor = vec4(col * inCase, inCase);
  }`, {
  leg: { value: null }, R: { value: new THREE.Matrix3() }, P0: { value: new THREE.Vector3() },
  kp: { value: new Array(NK).fill(0) }, kl: { value: new Array(NK).fill(0) }, kw: { value: KEYS.map((k) => k.w) },
  back: { value: 0 }, wave: { value: -999 }, t: { value: 0 },
}, { over: true });

interface Hit { k: number; t: number; s: number }

export default class Keyboard extends Scene {
  room = shared('keyboard.room', ROOM);
  keysPass = shared('keyboard.keys', KEYS_PASS);
  /** 鍵帽上的字（鍵盤座標、白色遮罩，init 畫一次，有 mipmap）。 */
  leg = this.track(new Layer2D(KW, KD, 1.25, { fast: true }));
  /** 螢幕外框、便利貼（畫一次）。 */
  props = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 螢幕裡的字（每格畫）。 */
  scr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  bilingual = false;
  hits: Hit[] = [];
  /** 純音樂時每一拍的時間（一拍打一個字）。 */
  beatT: number[] = [];
  bars: number[] = [];
  tOn = 0;
  st: LyricStyle = { family: F.archivo(100, 700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: ED.w, align: 'left', active: rgba('signal'), sung: rgba('bone', 0.95), unsung: rgba('bone', 0.2), lineHeight: 1.14 };
  avoid: Rect[] = [];
  /** 純音樂時打名字的字級（init 量：字型載好之後量才準，量的結果有全域快取）。 */
  idlePx = 48;
  private R = new THREE.Matrix3();
  private m4 = new THREE.Matrix4();

  override async init() {
    const { audio: au, start: s, end: e, lyrics } = this.ctx;
    const m = this.msg;
    await preloadPair(this.ctx, `${m ? m.text + sigOf(m) : ''}${INVITE_SMALL}${KEYS_TEXT}${T_FILE}${T_TODO}${COUPLE_ZH}FROM THE COUPLE · 新人□☑UTF-8雙語中原行·`);
    await loadText(KEYS_TEXT);
    this.idlePx = fitPx(IDLE_TEXT, IDLE_FAM, 48, ED.w - 40);
    this.bilingual = hasSubIn(this.ctx);
    const B = au.beatPeriod(s + 0.1);
    this.tOn = beatAfter(au, s + Math.min(0.3, B * 0.6));
    this.bars = barsIn(au, this.tOn + 0.1, e);
    // ---- 按鍵的時間表：每個字照自己的時間按下去（一個字要按好幾顆鍵就平均排在那個字唱的時間裡）
    const hits: Hit[] = [];
    const push = (key: string, tt: number, sgt = 1) => { const k = KEY_OF.get(key); if (k !== undefined) hits.push({ k, t: tt, s: sgt }); };
    const typeLine = (line: Line) => {
      for (const w of line.words) {
        const ks = Array.from(w.w).flatMap(keysFor);
        const dur = Math.max(0.06, Math.min(w.end - w.start, 0.6));
        ks.forEach((key, i) => push(key, w.start + (dur * i) / Math.max(1, ks.length), 0.8));
      }
    };
    for (const line of lyrics.linesIn(s - 1, e + 1)) {
      typeLine(mainOnly(line));
      const sub = lyricSubOf(line);
      if (sub) { push('한/영', sub.start - 0.12, 1); typeLine(sub); }
      push('Enter', line.end + 0.05, 1);
    }
    // 純音樂：沒有歌詞可以打，就跟著拍子一拍一個字打新人的名字（編輯器上一個字一個字出現）
    if (!lyrics.has) {
      this.beatT = barsIn(au, this.tOn, e).length ? beatsOf(au, this.tOn, e) : [];
      this.beatT.forEach((bt, i) => { for (const key of keysFor(IDLE[i % IDLE.length]!)) push(key, bt, 0.9); });
    }
    this.hits = hits.sort((a, b) => a.t - b.t);
    this.drawLegends();
    this.drawProps();
    this.avoid = [[SCR.x, SCR.y, SCR.w, SCR.h], [NOTE.x, NOTE.y, NOTE.w, NOTE.h]];
  }

  /** 鍵帽上的字：左上拉丁字母（或功能鍵名）、右下韓文字母（白色遮罩，shader 染成背光色）。 */
  private drawLegends() {
    const L = this.leg, c = L.ctx;
    L.clear();
    L.texture.generateMipmaps = true; L.texture.minFilter = THREE.LinearMipmapLinearFilter;
    c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
    ROWS.forEach((row, ri) => {
      let x = KM;
      for (const [a, h, w] of row) {
        const x0 = x + 14, y0 = KM + ri * U + 12;
        const big = a.length === 1 && a !== ' ';
        if (a.trim()) {
          c.font = big ? font(F.archivo(100, 600), 24) : font(/[가-힣漢]/.test(a) ? F.hei(500) : F.archivo(100, 500), 15);
          c.fillText(a.trim(), x0 + 2, y0 + (big ? 26 : 22));
        }
        if (h) { c.font = font(F.hei(500), 21); c.textAlign = 'right'; c.fillText(h, x + w * U - 18, y0 + 60); c.textAlign = 'left'; }
        x += w * U;
      }
    });
    L.upload();
  }

  /** 螢幕外框（暗）、底座、便利貼（留言）。 */
  private drawProps() {
    const L = this.props, c = L.ctx, m = this.msg;
    L.clear();
    c.textBaseline = 'alphabetic';
    // 底座（被鍵盤擋住一半）與螢幕外框
    c.fillStyle = mixRgba('ink', 'graphite', 0.25);
    c.fillRect(MON.x + MON.w / 2 - 36, MON.y + MON.h, 72, 90);
    c.beginPath(); c.ellipse(MON.x + MON.w / 2, 736, 190, 16, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = mixRgba('ink', 'graphite', 0.18);
    c.beginPath(); c.roundRect(MON.x, MON.y, MON.w, MON.h, 12); c.fill();
    c.fillStyle = rgba('bone', 0.07); c.fillRect(MON.x + 12, MON.y + 1, MON.w - 24, 1.5);
    // ---- 便利貼（稍微歪、右下角翹起來），留言手寫在上面
    c.save();
    c.translate(NOTE.x + NOTE.w / 2, NOTE.y + NOTE.h / 2); c.rotate(NOTE.rot); c.translate(-NOTE.w / 2, -NOTE.h / 2);
    c.fillStyle = rgba('ink', 0.45);
    c.beginPath(); c.moveTo(10, 16); c.lineTo(NOTE.w + 8, 18); c.lineTo(NOTE.w + 4, NOTE.h - 30); c.lineTo(NOTE.w - 40, NOTE.h + 14); c.lineTo(12, NOTE.h + 12); c.closePath(); c.fill();
    const g = c.createLinearGradient(0, 0, 0, NOTE.h);
    g.addColorStop(0, mixRgba('paper', 'signal', 0.16)); g.addColorStop(0.12, mixRgba('paper', 'signal', 0.22)); g.addColorStop(1, mixRgba('paper', 'signal', 0.3));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(NOTE.w, 0); c.lineTo(NOTE.w, NOTE.h - 46); c.quadraticCurveTo(NOTE.w - 20, NOTE.h - 14, NOTE.w - 52, NOTE.h); c.lineTo(0, NOTE.h); c.closePath(); c.fill();
    // 背膠那一條（上緣顏色深一點）、翹起來的角
    c.fillStyle = mixRgba('paper', 'signal', 0.32, 0.5); c.fillRect(0, 0, NOTE.w, 44);
    c.fillStyle = mixRgba('paper', 'bone', 0.35);
    c.beginPath(); c.moveTo(NOTE.w, NOTE.h - 46); c.quadraticCurveTo(NOTE.w - 34, NOTE.h - 40, NOTE.w - 52, NOTE.h); c.quadraticCurveTo(NOTE.w - 20, NOTE.h - 14, NOTE.w, NOTE.h - 46); c.fill();
    if (m) {
      const fam = F.hand(700), sig = sigOf(m);
      if (m.couple) { c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.6); c.fillText('FROM THE COUPLE · 新人', NM.x, 34); c.letterSpacing = '0px'; }
      const blk = fitV2(c, m.text, fam, NM.w, NM.h, 1, { lineHeight: 1.28 });
      const top = NM.y + Math.max(0, (NM.h - blk.height) * 0.4);
      const pl = placeBlock(c, blk, fam, sig, NM.x, top);
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.95), sigColor: rgba('sepia', 0.72) });
      this.st = { ...this.st, size: lyricV2(blk.fit.size) };
    } else {
      c.font = font(F.hand(700), 34); c.fillStyle = rgba('sepia', 0.85);
      c.fillText(T_TODO, NM.x, NM.y + 40);
      const fit = fitText(c, INVITE_SMALL, F.hand(700), NM.w - 60, 130, { min: 30, max: 38, maxLines: 2 });
      c.font = font(F.hand(700), fit.size);
      fit.lines.forEach((ln, i) => c.fillText(ln, NM.x + 56, NM.y + 110 + i * fit.lineHeight));
      c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 2.5; c.strokeRect(NM.x + 6, NM.y + 110 - fit.size * 0.82, fit.size * 0.8, fit.size * 0.8);
    }
    c.restore();
    L.upload();
  }

  /** 編輯器裡的一組字（中文＋原文），原點 = 中文第一排基線的左緣。回傳中文的筆尖。 */
  private drawPair(c: CanvasRenderingContext2D, line: Line, t: number, alpha: number, st: LyricStyle) {
    const main = mainOnly(line);
    const lay = layoutLyric(c, main, st);
    const head = drawLyric(c, main, t, st, lay, alpha);
    const sub = this.bilingual ? lyricSubOf(line) : null;
    let h = (lay.rows.length - 1) * lay.size * (st.lineHeight ?? 1.18);
    let subHead: { x: number; y: number } | null = null;
    c.save();
    c.font = font(F.mono(500), 16); c.fillStyle = rgba('ash', 0.55 * alpha); c.textAlign = 'right';
    c.fillText('中', -28, 0);
    if (sub) {
      const dy = h + subGap(lay.size);
      c.fillText('原', -28, dy);
      c.textAlign = 'left';
      c.translate(0, dy);
      const sl = drawLyricSub(c, sub, t, st, lay.size, alpha);
      // 原文的游標位置（跟著原文自己的逐字時間）
      for (const pw of sl.words) { const k = Math.min(1, Math.max(0, (t - pw.word.start) / Math.max(0.05, pw.word.end - pw.word.start))); if (k > 0 && k < 1) subHead = { x: pw.x + pw.w * k, y: dy + pw.y }; }
      h = dy + (sl.rows.length - 1) * sl.size * 1.18;
    }
    c.restore();
    return { head, subHead, h, size: lay.size };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const on = ease.outCubic(clamp((t - this.tOn) / 0.4));
    const push = ease.inOutQuad(prog(t, s, e));

    // ---- 螢幕：編輯器
    const C = this.scr, c = C.ctx;
    C.clear();
    c.save();
    c.beginPath(); c.rect(SCR.x, SCR.y, SCR.w, SCR.h); c.clip();
    c.fillStyle = mixRgba('ink', 'ink2', 0.7); c.fillRect(SCR.x, SCR.y, SCR.w, SCR.h);
    c.fillStyle = rgba('ink', 0.5); c.fillRect(SCR.x, SCR.y, SCR.w, 40);
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 15); c.letterSpacing = '2px'; c.fillStyle = rgba('bone', 0.6);
    c.fillText(`●  ${T_FILE}`, SCR.x + 24, SCR.y + 26);
    c.fillStyle = rgba('ash', 0.5); c.textAlign = 'right';
    const ly = lyricAt(lyrics, t, 1.6);
    c.fillText(`UTF-8  ·  ${this.bilingual ? '雙語' : '中文'}  ·  行 ${ly ? ly.line.i + 1 : 1}`, SCR.x + SCR.w - 24, SCR.y + 26);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    // 行號的欄
    c.fillStyle = rgba('bone', 0.04); c.fillRect(SCR.x, SCR.y + 40, 64, SCR.h - 40);
    let caret: { x: number; y: number } | null = null, caretSize = this.st.size;
    if (ly) {
      const line = ly.line;
      const kin = ease.outCubic(prog(t, line.start - 0.35, line.start + 0.05));
      // 上一組往上推、變淡（文件往下長）
      const prev = line.i > 0 ? lyrics.lines[line.i - 1] : undefined;
      const cur = this.measure(c, line);
      const y0 = ED.y - cur / 2 + this.st.size * 0.3 + (1 - kin) * 40;
      if (prev && prev.end > s - 1) {
        const ph = this.measure(c, prev);
        c.save(); c.translate(ED.x, y0 - ph - this.st.size * 1.6); this.drawPair(c, prev, t, 0.35, { ...this.st, sung: rgba('bone', 0.6), active: rgba('bone', 0.6) }); c.restore();
      }
      c.save(); c.translate(ED.x, y0);
      const r = this.drawPair(c, line, t, ly.k, this.st);
      c.restore();
      const hd = r.subHead ?? r.head;
      if (hd) { caret = { x: ED.x + hd.x, y: y0 + hd.y }; caretSize = r.subHead ? r.size * 0.62 : r.size; }
      // 行號
      c.font = font(F.mono(500), 15); c.fillStyle = rgba('ash', 0.45); c.textAlign = 'right';
      c.fillText(String(line.i + 1).padStart(2, '0'), SCR.x + 50, y0);
      c.textAlign = 'left';
    } else {
      c.font = font(F.mono(500), 22); c.fillStyle = rgba('ash', 0.55);
      if (lyrics.has) caret = { x: ED.x, y: ED.y };
      else {
        c.fillText(`// ♪ ${song.title}（純音樂）`, ED.x, ED.y - 70);
        // 一拍打一個字：新人的名字
        let n = 0;
        for (const bt of this.beatT) if (t >= bt) n++;
        c.font = font(IDLE_FAM, this.idlePx); c.fillStyle = rgba('bone', 0.92);
        // 這一輪打到第幾個字（打完一輪先停在完整的名字，下一拍換一行重打）
        const k = n === 0 ? 0 : ((n - 1) % IDLE.length) + 1;
        const tx = IDLE.slice(0, k).join('');
        c.fillText(tx, ED.x, ED.y);
        caret = { x: ED.x + c.measureText(tx).width, y: ED.y };
        caretSize = this.idlePx;
      }
    }
    // 游標：打字時一直亮，停下來就一閃一閃
    if (caret && on > 0) {
      const blink = frameIdx(t) % 30 < 16 || !!(ly && t >= ly.line.start && t < ly.line.end);
      if (blink) { c.fillStyle = rgba('signal', 0.95); c.fillRect(caret.x + 3, caret.y - caretSize * 0.85, 3, caretSize); }
    }
    // 開機前螢幕是黑的
    if (on < 1) { c.fillStyle = rgba('ink', 1 - on); c.fillRect(SCR.x, SCR.y, SCR.w, SCR.h); }
    c.restore();
    C.upload();

    // ---- 牆與桌面
    const RM = this.room;
    RM.u.mon!.value = on;
    RM.u.back!.value = on;
    RM.u.t!.value = t;
    (RM.u.drift!.value as THREE.Vector2).set(0, 0);
    RM.render(renderer, out);
    comp.draw(renderer, this.props.texture, out, { offset: [-0.004 * push, 0.002 * push] });
    comp.draw(renderer, C.texture, out, { offset: [-0.004 * push, 0.002 * push] });

    // ---- 鍵盤：按鍵的下沉與背光（每顆鍵最近的幾下加起來）
    const K = this.keysPass;
    const kp = K.u.kp!.value as number[], kl = K.u.kl!.value as number[];
    kp.fill(0); kl.fill(0);
    let lo = 0, hi = this.hits.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.hits[mid]!.t < t - 0.9) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < this.hits.length; i++) {
      const hh = this.hits[i]!;
      if (hh.t > t) break;
      const a = t - hh.t;
      const pr = a < 0.03 ? a / 0.03 : Math.exp(-(a - 0.03) / 0.07);
      kp[hh.k] = Math.max(kp[hh.k]!, pr);
      kl[hh.k] = Math.max(kl[hh.k]!, hh.s * Math.exp(-a / 0.28) * on);
    }
    // 小節線：背光的波浪從左掃到右
    let wave = -999;
    for (const b of this.bars) if (t >= b && t < b + 0.9) wave = lerp(-200, KW + 200, ease.inOutQuad((t - b) / 0.9));
    K.u.leg!.value = this.leg.texture;
    K.u.back!.value = on * (0.9 + 0.1 * noise1(t * 0.5, 3));
    K.u.wave!.value = wave;
    K.u.t!.value = t;
    // 鏡頭慢慢推：鍵盤（近）比螢幕動得多
    this.m4.makeRotationX(PITCH);
    this.R.setFromMatrix4(this.m4);
    (K.u.R!.value as THREE.Matrix3).copy(this.R);
    (K.u.P0!.value as THREE.Vector3).set(KC.x - 30 * push, KC.y + 10 * push, KC.z * (1 - 0.04 * push));
    K.render(renderer, out);

    return { bloom: 0.7, bloomThreshold: 1.0, halation: 0.12, vignette: 0.42, grain: 0.06, zoom: 1 + 0.02 * push, popupAvoid: this.avoid };
  }

  /** 一組字（中文＋原文）的高度：中文第一排基線到最後一排（原文）基線。 */
  private measure(c: CanvasRenderingContext2D, line: Line) {
    const lay = layoutLyric(c, mainOnly(line), this.st);
    let h = (lay.rows.length - 1) * lay.size * (this.st.lineHeight ?? 1.18);
    const sub = this.bilingual ? lyricSubOf(line) : null;
    if (sub) {
      const sl = layoutLyric(c, sub, { ...this.st, size: Math.round(clamp(lay.size * 0.6, 32, 56)), minSize: 26 });
      h += subGap(lay.size) + (sl.rows.length - 1) * sl.size * 1.18;
    }
    return h;
  }
}
