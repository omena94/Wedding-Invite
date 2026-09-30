// 水窪漣漪（暗）：雨夜，從正上方往下看柏油路上的一大片水窪。
//  - 水面是一面鏡子：倒映著往上看的城市（大樓從水窪邊緣往中間傾、亮著幾格窗、一盞路燈）與主打留言——
//    留言像對街招牌的倒影，第一個拍點一滴大雨落在正中間，漣漪擴散到哪裡，倒影裡的字就浮到哪裡。
//  - 每一拍一滴雨落在水窪裡（落下前是一顆越來越小的亮點——雨滴離鏡頭越來越遠——落水時濺起一圈），
//    同心的漣漪往外擴散，經過的地方倒影跟著扭曲，環的一側有細細的反光。
//  - 歌詞浮在水面上：每個字是一滴雨，提早一點點落下、漣漪一散開字就淡淡浮出來，唱到的那一刻亮成訊號色（跟唱規則）。
//  - 水窪外是濕的柏油（碎石的顆粒），右上角一個排水孔蓋；冷面註記「降雨量：每拍一滴　積水深度：剛好」。
//  - 沒有主打留言：倒影裡是「雨天也好，晴天也好，一起就好。」＋邀請；純音樂：水面上浮著歌名，雨照樣跟著拍子下。
// 畫法：水面、漣漪折射、柏油在一個 shader；倒影（城市、留言）各畫一次在 Canvas2D，shader 取樣時依漣漪的斜率偏移；
// 歌詞每格重畫在第三張 Canvas2D 疊上去。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, lerp } from '../engine/util';
import type { FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, beatAfter, signature, drawMessage, COUPLE_ZH, lyricSubOf, subSizeFor, subStyleFor, subGap, type LyricStyle, type LyricLayout } from './_motifs';
import { no3, fitV2, slowPush, INVITE_SMALL, DECODE_GLSL, type Rect, SYMBOLS } from './_t20';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'water', paper: false, energy: [0.15, 0.75], bars: [4, 8] };

/** 同時最多幾滴雨的漣漪（shader 的陣列大小）。 */
const N_DROP = 28;
/** 漣漪的速度（px/s）、壽命（秒）。 */
const RING_V = 230, LIFE = 2.6;
/** 水窪的形狀：幾個橢圓（中心、半徑）平滑聯集。 */
const BLOBS: [number, number, number, number][] = [
  [730, 530, 640, 370], [430, 330, 350, 230], [1060, 300, 390, 190], [1090, 700, 330, 260], [380, 760, 300, 190],
];
/** 倒影的消失點（往上看的天頂）。 */
const VP = { x: 760, y: 560 };
/** 歌詞浮在水面上方一帶、留言倒影在中間。 */
const LYR = { x: 214, y: 262, maxW: 1110 };
/** 倒影裡的留言（標準 v2：≤ 860×430，放在水窪的左下，右半邊留給漣漪、落葉、路燈的倒影）。 */
const BOX = { x: 214, y: 520, w: 820, h: 360 };
const LYR_STYLE: LyricStyle = { family: F.archivo(100, 700), size: 66, minSize: 52, maxWidth: LYR.maxW, align: 'left', lineHeight: 1.12 };
const MSG_FAM = F.hand(700);
const NO_MSG = '雨天也好，晴天也好，一起就好。';
const NO_MSG_LINES = ['雨天也好，晴天也好，', '一起就好。'];
const NOTE1 = '降雨量：每拍一滴';
const NOTE2 = '積水深度：剛好';

const FRAG = /* glsl */ `
uniform sampler2D uRefl, uMsg;
uniform vec4 uDrop[${N_DROP}];   // x, y, 落水時間, 強度
uniform float uDropV[${N_DROP}]; // 漣漪速度
uniform int uN;
uniform float uT;
uniform vec3 uSweep;             // 對街開過的車：車燈的反光掃過水面（x 位置、強度、方向）
uniform vec4 uReveal;            // 留言浮出：中心 xy、開始時間、速度
uniform float uIn;
${DECODE_GLSL}

float sdEll(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return (length(q) - 1.0) * min(r.x, r.y); }
float puddle(vec2 p) {
  float d = 1e5;
  ${BLOBS.map((b) => `d = smin(d, sdEll(p, vec2(${b[0]}.0, ${b[1]}.0), vec2(${b[2]}.0, ${b[3]}.0)), 90.0);`).join('\n  ')}
  return d + 20.0 * fbm(p / 190.0, 3);
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);   // y 向下
  float pd = puddle(p);
  float water = 1.0 - smoothstep(-2.0, 2.0, pd);

  // ---- 漣漪：每一滴一組往外擴散的環（前緣最強、後面跟著幾圈衰減），累加高度的斜率
  vec2 grad = vec2(0.0);
  float splash = 0.0, fall = 0.0, wetSpot = 0.0, rings = 0.0;
  for (int i = 0; i < ${N_DROP}; i++) {
    if (i >= uN) break;
    vec4 D = uDrop[i];
    float age = uT - D.z;
    vec2 dv = p - D.xy;
    float r = length(dv);
    if (age < 0.0) {
      // 落下前：一顆越來越小的亮點（雨滴往下掉、離鏡頭越來越遠）
      float rr = 2.0 - age * 34.0;
      fall += smoothstep(rr + 1.0, rr - 1.0, r) * smoothstep(-0.28, -0.05, age) * 0.5 * D.w;
      continue;
    }
    if (age > ${LIFE.toFixed(2)}) continue;
    float R = uDropV[i] * age;
    float s = r - R;
    float wdt = 14.0 + 26.0 * age;
    float env = D.w * exp(-age * 1.55) * (1.0 - smoothstep(${(LIFE - 0.6).toFixed(2)}, ${LIFE.toFixed(2)}, age));
    // 前緣之後（環的內側）再拖幾圈、往內衰減
    float g = exp(-s * s / (2.0 * wdt * wdt)) + (s < 0.0 ? exp(s / 90.0) * 0.55 : 0.0);
    float k = 0.15;
    float dh = env * k * cos(s * k) * g;
    grad += (r > 0.5 ? dv / r : vec2(0.0)) * dh;
    // 環：前緣一條細亮線、後面再一條淡一點的（細線才像 pdoom 的版畫語言，不是一團霧）
    float ring = exp(-s * s / 9.0) + 0.45 * exp(-(s + 42.0) * (s + 42.0) / 7.0) + 0.2 * exp(-(s + 84.0) * (s + 84.0) / 6.0);
    rings += ring * env;
    // 落水的一瞬間：濺起的亮點
    splash += exp(-r * r / 60.0) * (1.0 - smoothstep(0.0, 0.16, age)) * D.w;
    // 落在柏油上的雨：留下一個慢慢乾掉的濕點
    wetSpot += (1.0 - smoothstep(6.0, 22.0 + age * 6.0, r)) * (1.0 - age / ${LIFE.toFixed(2)});
  }

  // ---- 水面：倒影依斜率偏移取樣（折射），環的一側有反光
  vec2 off = grad * 16.0 * water;
  vec2 uv = (vec2(p.x, ${H}.0 - p.y) + vec2(off.x, -off.y)) / vec2(${W}.0, ${H}.0);
  vec4 refl = decodeLayer(uRefl, uv);
  vec4 msg = decodeLayer(uMsg, uv);
  // 留言從大雨滴的中心往外浮出來
  float rv = length(p - uReveal.xy);
  float Rrev = max(0.0, uT - uReveal.z) * uReveal.w;
  float shown = 1.0 - smoothstep(Rrev - 160.0, Rrev, rv);
  // 倒影的天空：比柏油暗（水窪是一面黑鏡子），大樓頂附近有一點城市的光
  float rvp = length(p - vec2(${VP.x}.0, ${VP.y}.0));
  vec3 sky = mix(C_INK * 0.4, C_INK2, 0.35) + C_GRAPHITE * 0.03 * smoothstep(260.0, 520.0, rvp);
  vec3 wcol = sky * (1.0 - refl.a) + refl.rgb;
  wcol = wcol * (1.0 - msg.a * shown) + msg.rgb * shown;
  // 環的反光：水面法線剛好把路燈（右上）反射進鏡頭的地方亮一小段弧（Blinn–Phong，很窄）
  vec3 n = normalize(vec3(-grad * 7.0, 1.0));
  float spec = pow(max(dot(n, normalize(vec3(0.3, -0.42, 1.0))), 0.0), 900.0);
  float spec2 = pow(max(dot(n, normalize(vec3(-0.34, 0.2, 1.0))), 0.0), 700.0);
  wcol += C_EMBER * spec * 1.6 + C_BONE * spec2 * 0.35;
  // 車燈：一道很寬的暖光從水面掃過去，漣漪上的反光跟著亮（每兩小節一台車）
  if (uSweep.y > 0.0) {
    // 光走在水窪的上半部（留言在左下，不要被光洗掉）
    float band = exp(-pow((p.x - uSweep.x) / 190.0, 2.0)) * exp(-pow((p.y - 330.0) / 230.0, 2.0));
    vec3 Ls = normalize(vec3((uSweep.x - p.x) / 700.0, -0.12, 1.0));
    float sp3 = pow(max(dot(n, Ls), 0.0), 320.0);
    // 光斑本身是一道很淡的暖光＋漣漪上一條條的反光
    wcol += (mix(C_BONE, C_EMBER, 0.5) * 0.05 * band + C_EMBER * sp3 * band * 1.6) * uSweep.y;
  }
  // 環本身：朝光的一側亮一點點、背光的一側暗一點點（很淡，只是讓水面有起伏）
  wcol *= 1.0 + clamp(dot(grad, vec2(0.5, -0.7)) * 5.0, -0.35, 0.35);
  wcol += C_BONE * min(rings, 1.2) * 0.15;
  wcol += vec3(1.0, 0.95, 0.88) * min(splash, 1.5) * 0.9;
  // 水邊：一圈很淡的亮邊（水面張力）
  wcol += C_BONE * 0.02 * (1.0 - smoothstep(0.0, 2.0, abs(pd)));

  // ---- 柏油：碎石顆粒、濕的暗、靠近水邊更濕
  float agg = step(0.86, hash12(floor(p / 3.0))) * 0.5 + step(0.95, hash12(floor(p / 5.0) + 17.0)) * 0.6;
  float big = fbm(p / 300.0, 3);
  // 路燈照著的柏油（右上亮、左下暗），碎石顆粒看得見；水窪是一面比柏油暗的鏡子，形狀才讀得出來
  float lamp = smoothstep(1500.0, 200.0, length(p - vec2(1300.0, 120.0)));
  vec3 asph = mix(C_INK2, C_GRAPHITE, 0.1 + 0.07 * big + 0.12 * lamp) + C_GRAPHITE * agg * (0.12 + 0.12 * lamp) + C_SIGNAL * 0.012 * lamp;
  float wet = clamp(1.0 - smoothstep(0.0, 70.0, pd) + wetSpot * 0.6, 0.0, 1.0);
  asph *= 1.0 - 0.35 * wet;
  // 右上角的排水孔蓋：圓框＋格柵
  vec2 mq = p - vec2(1690.0, 250.0);
  float mr = length(mq);
  float rim = pxLine(abs(mr - 92.0), 3.0, 4.5) + pxLine(abs(mr - 80.0), 0.6, 1.4);
  float bars = step(mr, 78.0) * pxLine(abs(fract(mq.x / 16.0) - 0.5) * 16.0, 2.0, 3.0);
  asph += C_GRAPHITE * (rim * 0.35 + bars * 0.22);
  asph = mix(asph, C_INK * 0.4, step(mr, 78.0) * (1.0 - bars) * 0.6);
  asph += vec3(1.0, 0.95, 0.88) * fall * (1.0 - water);

  // 水邊很淺：看得到水底的柏油，倒影淡一點（這一圈讓水窪不像紙上挖的洞）
  float shallow = smoothstep(-80.0, 0.0, pd);
  wcol = mix(wcol, asph * 0.75 + wcol * 0.45, shallow * 0.7);
  vec3 col = mix(asph, wcol, water);
  col += vec3(1.0, 0.95, 0.88) * fall * water;
  fragColor = vec4(col * uIn, 1.0);
}`;

const BG = () => new FSPass(FRAG, {
  uRefl: { value: null }, uMsg: { value: null },
  uDrop: { value: Array.from({ length: N_DROP }, () => new THREE.Vector4()) },
  uDropV: { value: new Array(N_DROP).fill(RING_V) },
  uN: { value: 0 }, uT: { value: 0 }, uReveal: { value: new THREE.Vector4() }, uIn: { value: 1 },
  uSweep: { value: new THREE.Vector3() },
});

interface Drop { x: number; y: number; t: number; a: number; v: number }

/**
 * 原文副行（2026-09-30 雙語）：水面上的字邊緣被漣漪與倒影打散，32 px 的原文在水窪裡讀起來偏小，
 * 改成至少 36 px、不再縮（太長就折行）；中文不動。
 */
function rainSub(c: CanvasRenderingContext2D, line: Line, st: LyricStyle, lay: LyricLayout): LyricLayout {
  const sub = lyricSubOf(line);
  if (!sub || !lay.sub) return lay;
  const size = Math.max(36, subSizeFor(lay.size));
  const sl = layoutLyric(c, sub, { ...subStyleFor(st, lay.size), size, minSize: size });
  const dy = lay.sub.dy - subGap(lay.size, lay.sub.lay.size) + subGap(lay.size, sl.size);
  return { ...lay, sub: { lay: sl, dy }, height: dy + (sl.height - sl.size) + lay.size };
}

export default class Puddle extends Scene {
  bg = shared('puddle.bg', BG);
  /** 倒影：城市（畫一次）。 */
  refl = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 倒影：留言（畫一次）。 */
  msgL = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 浮在水面上的歌詞（每格重畫）。 */
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 101 + (this.msg?.id ?? 0) * 17) >>> 0;
  b0 = 0;
  drops: Drop[] = [];
  reveal = { x: 0, y: 0, t: 0, v: 700 };
  lays = new Map<number, LyricLayout>();
  title = '';
  avoid: Rect[] = [];
  /** 歌詞的樣式：字級看有沒有留言（有留言時比留言小一號）。 */
  lyrSt: LyricStyle = LYR_STYLE;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    this.title = `♪  ${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
    const text = m ? m.text : NO_MSG;
    const sigText = m ? (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name)) : '';
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(text + sigText + NO_MSG + INVITE_SMALL + NOTE1 + NOTE2 + this.title + lines.map((l) => l.text).join('') + 'FROM THE COUPLE · 新人No.0123456789' + SYMBOLS);

    this.drawCity();
    const [box, msgSize] = this.drawMsg(text, sigText);
    this.lyrSt = { ...LYR_STYLE, size: lyricV2(m ? msgSize : null), minSize: V2.lyrMin };

    // ---- 雨滴：留言那一滴、每一拍一滴（隨機落在水窪裡，避開字的正中間一點）、歌詞每個字一滴
    const rnd = mulberry32(this.seed);
    this.reveal = { x: box[0] + box[2] * 0.42, y: box[1] + box[3] * 0.5, t: this.b0, v: 760 };
    this.drops.push({ x: this.reveal.x, y: this.reveal.y, t: this.b0, a: 1.6, v: 330 });
    const i0 = Math.round(au.beatAt(this.b0));
    for (let i = i0 + 1; au.timeOfBeat(i) < e + 0.1; i++) {
      const tb = au.timeOfBeat(i);
      const q = this.randomInPuddle(rnd);
      // 小節線上的那一滴大一點
      const down = Math.abs(au.barAt(tb) - Math.round(au.barAt(tb))) < 0.05;
      this.drops.push({ x: q[0], y: q[1], t: tb, a: down ? 1.15 : 0.7, v: RING_V });
      // 純音樂：半拍再多一滴小的，水面才不會太空
      if (!lyrics.has) { const q2 = this.randomInPuddle(rnd); this.drops.push({ x: q2[0], y: q2[1], t: tb + au.beatPeriod(tb) * 0.5, a: 0.4, v: RING_V }); }
    }
    const c = this.lyr.ctx;
    for (const line of lines) {
      const lay = rainSub(c, line, this.lyrSt, layoutLyric(c, line, this.lyrSt));
      this.lays.set(line.i, lay);
      const y0 = this.lyrTop(lay);
      for (const pw of lay.words) {
        // 字的雨滴提早 0.3 秒落下：漣漪一散開字就淡淡浮出來，唱到的那一刻再亮
        this.drops.push({ x: LYR.x + pw.x + pw.w / 2, y: y0 + pw.y - lay.size * 0.36, t: pw.word.start - 0.3, a: 0.5, v: 280 });
      }
      // 韓文歌的原文（layoutLyric 排在中文正下方，lay.sub）：每個詞也是一滴雨，但小一點（比中文安靜）
      if (lay.sub) {
        const sl = lay.sub.lay;
        for (const pw of sl.words) this.drops.push({ x: LYR.x + pw.x + pw.w / 2, y: y0 + lay.sub.dy + pw.y - sl.size * 0.36, t: pw.word.start - 0.3, a: 0.28, v: 260 });
      }
    }
    this.drops.sort((a, b) => a.t - b.t);

    const koH = [...this.lays.values()].some((l) => l.sub) ? 70 : 0;
    this.avoid = [[LYR.x - 20, LYR.y - 150, LYR.maxW + 40, 190 + koH], [box[0] - 30, box[1] - 30, box[2] + 60, box[3] + 60]];
  }

  /** 水窪裡隨機一點（拒絕取樣：在某個橢圓裡、離邊緣有一段距離）。 */
  private randomInPuddle(rnd: () => number): [number, number] {
    for (let k = 0; k < 30; k++) {
      const x = 150 + rnd() * 1250, y = 150 + rnd() * 800;
      if (BLOBS.some(([cx, cy, rx, ry]) => ((x - cx) / (rx - 60)) ** 2 + ((y - cy) / (ry - 60)) ** 2 < 1)) return [x, y];
    }
    return [VP.x, VP.y];
  }

  /** 歌詞最上面一列的基線：兩列的時候往上挪，讓下一列還在同一條基線上。 */
  private lyrTop(lay: LyricLayout) { return LYR.y - (lay.rows.length - 1) * lay.size * (this.lyrSt.lineHeight ?? 1.18); }

  /** 倒影裡的城市（往上看）：大樓從水窪邊緣往天頂傾，幾格亮著的窗、一盞路燈。 */
  private drawCity() {
    const c = this.refl.ctx;
    const rnd = mulberry32(this.seed ^ 0x5bd1);
    // 天空的光害：靠近大樓頂的地方暖一點
    const g = c.createRadialGradient(VP.x, VP.y, 60, VP.x, VP.y, 900);
    g.addColorStop(0, rgba('ink', 0));
    g.addColorStop(1, rgba('ink', 0));
    void g;
    // 大樓：從遠離天頂的地方（樓底，在水窪外面）往天頂延伸到頂樓；左右兩條邊都指向天頂
    const bld: [number, number, number][] = [[-2.62, 0.3, 470], [-1.95, 0.36, 520], [-1.2, 0.26, 430], [-0.35, 0.4, 560], [0.55, 0.3, 470], [1.35, 0.34, 500], [2.2, 0.32, 540]];
    for (const [a0, span, top] of bld) {
      const a1 = a0 + span, rTop = top + rnd() * 60, rBase = 1400;
      const P = (a: number, r: number) => [VP.x + Math.cos(a) * r, VP.y + Math.sin(a) * r] as const;
      const pts = [P(a0, rBase), P(a0, rTop), P(a1, rTop), P(a1, rBase)];
      c.fillStyle = rgba('ink', 0.75);
      c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
      c.strokeStyle = rgba('graphite', 0.3);
      c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(...P(a0, rTop)); c.lineTo(...P(a1, rTop)); c.stroke();
      // 窗：沿著樓的方向一層一層（越靠天頂越小）
      const cols = 7;
      for (let r = rTop + 24; r < 1300; r *= 1.05) {
        const hh = r * 0.02;
        for (let k = 0; k < cols; k++) {
          if (rnd() > 0.3) continue;
          const aa = a0 + (span * (k + 0.25)) / cols, ab = a0 + (span * (k + 0.75)) / cols;
          const q = [P(aa, r), P(aa, r + hh), P(ab, r + hh), P(ab, r)];
          const warm = rnd();
          c.fillStyle = warm < 0.55 ? rgba('ember', 0.12 + rnd() * 0.16) : warm < 0.85 ? rgba('signal', 0.1 + rnd() * 0.14) : rgba('bone', 0.12);
          c.beginPath(); q.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
        }
      }
    }
    // 路燈：右上方一盞（倒影裡一團暖光）
    const lx = 1250, ly = 196;
    const lg = c.createRadialGradient(lx, ly, 0, lx, ly, 150);
    // 路燈是配角：一小團暖光，不要搶留言
    lg.addColorStop(0, rgba('ember', 0.7));
    lg.addColorStop(0.07, rgba('signal', 0.42));
    lg.addColorStop(0.3, rgba('signal', 0.08));
    lg.addColorStop(1, rgba('signal', 0));
    c.fillStyle = lg;
    c.fillRect(lx - 160, ly - 160, 320, 320);
    this.refl.upload();
  }

  /** 倒影裡的留言（像對街招牌的倒影）：畫一次，回傳範圍。 */
  private drawMsg(text: string, sigText: string): [Rect, number] {
    const c = this.msgL.ctx, m = this.msg;
    const tagH = m?.couple ? 34 : 0;
    // 署名的高度先照字級上限扣掉：署名永遠在最後一行下面
    const reserve = m ? sigV2(msgMaxFor(text)) + 24 : 60;
    // 沒有主打留言時歌詞是焦點：倒影裡的句子小一點
    const fit: FitResult = fitV2(c, text, MSG_FAM, BOX.w, BOX.h - reserve - tagH, { lineHeight: 1.28, maxLines: 4, max: m ? undefined : 44, lines: m ? undefined : NO_MSG_LINES });
    const sigSize = sigV2(fit.size);
    const blockH = tagH + fit.height + reserve;
    const top = BOX.y + (BOX.h - blockH) / 2;
    // 字後面墊一層很淡的暗，城市的窗才不會跟字搶
    c.save();
    c.filter = 'blur(40px)';
    c.fillStyle = rgba('ink', 0.55);
    c.fillRect(BOX.x - 20, top - 10, fit.width + 40, blockH + 20);
    c.restore();
    if (m?.couple) {
      c.font = font(F.mono(500), 16);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('signal', 0.9);
      c.fillText('FROM THE COUPLE · 新人', BOX.x, top + 16);
      c.letterSpacing = '0px';
    }
    drawMessage(c, fit, MSG_FAM, BOX.x, top + tagH + fit.size * 0.9, { color: rgba('bone', 0.95) });
    let w = fit.width;
    if (m) {
      c.font = font(MSG_FAM, sigSize);
      const sw = measure(sigText, MSG_FAM, sigSize);
      c.fillStyle = rgba('signal', 0.85);
      c.fillText(sigText, BOX.x + Math.max(fit.width, sw) - sw, top + tagH + fit.height + 18 + sigSize * 0.9);
      w = Math.max(w, sw);
    } else {
      c.font = font(F.hei(500), 26);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('ash', 0.9);
      c.fillText(INVITE_SMALL, BOX.x, top + fit.height + 46);
      c.letterSpacing = '0px';
      w = Math.max(w, measure(INVITE_SMALL, F.hei(500), 26) + 40);
    }
    this.msgL.upload();
    return [[BOX.x, top, w, blockH], fit.size];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const u = this.bg.u;
    u.uRefl!.value = this.refl.texture;
    u.uMsg!.value = this.msgL.texture;
    // 這一格看得到的雨滴：還在擴散的，加上快要落下的（最多 N_DROP 滴，太多時留最新的）
    const live = this.drops.filter((d) => t > d.t - 0.3 && t < d.t + LIFE).slice(-N_DROP);
    const arr = u.uDrop!.value as THREE.Vector4[], vs = u.uDropV!.value as number[];
    live.forEach((d, i) => { arr[i]!.set(d.x, d.y, d.t, d.a); vs[i] = d.v; });
    u.uN!.value = live.length;
    u.uT!.value = t;
    (u.uReveal!.value as THREE.Vector4).set(this.reveal.x, this.reveal.y, this.reveal.t, this.reveal.v);
    // 車燈：從第一個拍點之後，每逢雙數小節一台車開過（1.6 秒掃過整個水窪；左右輪流）
    const au = this.ctx.audio;
    const bar2 = Math.floor(au.barAt(t) / 2) * 2, tc = au.timeOfBar(bar2), ac = t - tc;
    if (tc >= this.b0 - 0.05 && ac < 1.6) {
      const dir = (bar2 / 2) % 2 ? -1 : 1, q = ease.inOutCubic(ac / 1.6);
      (u.uSweep!.value as THREE.Vector3).set(dir > 0 ? lerp(-300, 2200, q) : lerp(2200, -300, q), Math.sin(Math.PI * ac / 1.6), dir);
    } else (u.uSweep!.value as THREE.Vector3).set(0, 0, 1);
    u.uIn!.value = prog(t, s, s + 0.3);
    this.bg.render(renderer, out);

    const L = this.lyr;
    L.clear();
    const c = L.ctx;
    this.drawLeaf(c, t, f.lt);
    this.drawLyrics(c, t);
    this.drawNotes(c, t);
    comp.draw(renderer, L.upload(), out);
    return { bloom: 0.6, vignette: 0.45, popupAvoid: this.avoid, zoom: slowPush(f.p) };
  }

  /** 浮在水面上的歌詞：字的雨滴落下之後淡淡浮出，唱到時亮成訊號色、輕輕彈一下。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    if (!lyrics.has) {
      c.save();
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.5) * 0.85;
      c.font = font(F.mono(500), 22);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('ash');
      c.fillText(this.title.toUpperCase(), LYR.x, LYR.y);
      c.restore();
      return;
    }
    const ly = lyricAt(lyrics, t, 1.2, 0.35);
    if (!ly) return;
    const lay = this.lays.get(ly.line.i) ?? rainSub(c, ly.line, this.lyrSt, layoutLyric(c, ly.line, this.lyrSt));
    const y0 = this.lyrTop(lay);
    this.floatWords(c, lay, y0, t, ly.k, false);
    if (lay.sub) this.floatWords(c, lay.sub.lay, y0 + lay.sub.dy, t, ly.k, true);
  }

  /**
   * 一段浮在水面上的字（y0 = 第一列基線）。`quiet` = 韓文歌的原文副行：唱到、唱完都是淡兩成的紙白（不用訊號色）、
   * 唱到時只輕輕彈一半。
   */
  private floatWords(c: CanvasRenderingContext2D, lay: LyricLayout, y0: number, t: number, k: number, quiet: boolean) {
    c.save();
    c.font = font(this.lyrSt.family, lay.size);
    c.textBaseline = 'alphabetic';
    for (const pw of lay.words) {
      const w = pw.word, td = w.start - 0.3;
      // 漣漪散開之後浮出（還沒唱：三成；唱到：訊號色；唱完：紙白）
      const a = prog(t, td + 0.05, td + 0.3) * k;
      if (a <= 0) continue;
      const p = Lyrics.wordProgress(w, t);
      const pop = t >= w.start ? 1 + (quiet ? 0.06 : 0.12) * (1 - ease.outCubic(clamp((t - w.start) / 0.3))) : 1;
      const x = LYR.x + pw.x, y = y0 + pw.y;
      c.save();
      c.translate(x + pw.w / 2, y - lay.size * 0.35);
      c.scale(pop, pop);
      c.translate(-pw.w / 2, lay.size * 0.35);
      c.globalAlpha = a;
      c.fillStyle = rgba('bone', 0.3);
      if (p < 1) c.fillText(w.w, 0, 0);
      if (p > 0) {
        c.beginPath();
        c.rect(-lay.size * 0.1, -lay.size * 1.1, (pw.w + lay.size * 0.2) * p, lay.size * 1.5);
        c.clip();
        c.fillStyle = quiet ? rgba('bone', 0.96 * 0.8) : p < 1 ? rgba('signal') : rgba('bone', 0.96);
        c.fillText(w.w, 0, 0);
      }
      c.restore();
    }
    c.restore();
  }

  /**
   * 一片落葉浮在水窪右半邊（留言的另一側），慢慢漂；漣漪經過時被抬起、轉一下（照 CPU 上同樣的漣漪公式算，確定性）。
   * 葉子用暗部色（blood 混 ink），不發光、不搶留言。
   */
  private drawLeaf(c: CanvasRenderingContext2D, t: number, lt: number) {
    const x0 = 1210 - 9 * lt, y0 = 690 + 14 * Math.sin(lt * 0.35);
    // 漣漪經過：每一滴的前緣掃過葉子時給一個起伏
    let bump = 0, tilt = 0;
    for (const d of this.drops) {
      const age = t - d.t;
      if (age < 0 || age > LIFE) continue;
      const dx = x0 - d.x, dy = y0 - d.y, r = Math.hypot(dx, dy), sd = r - d.v * age;
      const g = Math.exp(-(sd * sd) / 900) * d.a * Math.exp(-age * 1.55);
      bump += g;
      tilt += g * Math.sign(dx || 1) * Math.cos(sd * 0.15);
    }
    const a = 0.6 + 0.12 * lt + 0.35 * tilt;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start, this.ctx.start + 0.4);
    c.translate(x0, y0 - 4 * bump);
    c.rotate(a);
    c.scale(1.5 * (1 + 0.06 * bump), 1.5 * (1 + 0.06 * bump));
    // 葉子的影子（水面上一點點暗）
    c.fillStyle = rgba('ink', 0.5);
    c.beginPath(); c.ellipse(5, 6, 34, 14, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = mixRgba('blood', 'ink', 0.35, 0.95);
    c.beginPath();
    c.moveTo(-36, 0); c.quadraticCurveTo(-6, -20, 34, 0); c.quadraticCurveTo(-6, 20, -36, 0);
    c.fill();
    c.strokeStyle = mixRgba('blood', 'bone', 0.35, 0.6);
    c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(-36, 0); c.lineTo(30, 0);
    for (let k = -2; k <= 2; k++) { const xx = k * 11; c.moveTo(xx, 0); c.lineTo(xx + 9, -8); c.moveTo(xx, 0); c.lineTo(xx + 9, 8); }
    c.moveTo(-36, 0); c.lineTo(-48, 5);
    c.stroke();
    c.restore();
  }

  /** 右邊柏油上的註記（mono）。 */
  private drawNotes(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('ash', 0.75);
    const x = 1500;
    c.fillText(this.msg ? no3(this.msg.n) : 'RAIN', x, 430);
    c.fillStyle = rgba('ash', 0.6);
    c.fillText(NOTE1, x, 462);
    c.fillText(NOTE2, x, 490);
    c.fillText(`${Math.round(this.ctx.audio.bpm || 120)} BPM`, x, 518);
    c.restore();
    void lerp; void layout;
  }
}
