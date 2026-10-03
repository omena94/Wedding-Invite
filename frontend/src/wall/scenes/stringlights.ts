// 燈泡字（暗、雙語）：夏夜的草地派對，三串愛迪生燈泡從畫面外垂過來，燈泡一顆一顆吊在電線上。
//  - 歌詞寫在燈泡裡：一顆燈泡一個字，字就是燈絲（燒紅的燈絲彎成字）；英文一個詞是一支長的膠囊燈管。
//    上面那串是中文（大燈泡），下面那串是原文（小一號的燈泡），同一串上其他的燈泡是一般的暖光小燈。
//    換句的時候整串閃一下、燈絲換成新的字；唱到的那個字燈絲燒成訊號色、整顆閃一下，唱完的字留著暖白的光，
//    還沒唱的燈絲是暗的（三成）。沒有翻譯的歌：下面那串全是一般的暖光小燈（不留空的燈泡）。
//    純音樂：上串亮出新人的名字、下串亮出日期，半拍亮一顆。
//  - 主打留言是左下草地上一塊立著的木牌（手寫漆字，牌子上緣也繞著一小串燈），第一拍起小燈一顆顆亮、字一行行被照亮。
//    照「留言尺寸與版面比例標準 v2」：字 40～60、署名 26～32、牌子 ≤ 860 × 430。
//  - 一直在動：每個小節線一陣風沿著電線吹過去（電線起伏、燈泡晃），大鼓時所有燈亮一點，一般小燈一拍走一格的跑燈，
//    幾隻飛蛾繞著字的燈泡飛，最前面還有一串很近、失焦的大燈泡（景深）在畫面上緣晃。遠處樹籬裡有一點一點的散景燈。
//  - 鏡頭：切進來時稍微往上看，第一拍落定；之後很慢地推近。右下角（QR）是暗暗的草地。
// 手法：背景（夜空、樹冠剪影、遠處的樹籬與散景、草地、燈下的光暈）是一個全螢幕 shader；電線、燈泡、燈絲字、木牌、飛蛾畫在
// 一張 Canvas 圖層；燈的光暈畫在半解析度的圖層上加亮疊上去（會發光）。燈泡的玻璃、光暈、木牌在 init() 先畫好，每格只貼圖。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { lyricSubOf } from '../engine/lyrics';
import { beatAfter, drawHeart, COUPLE_ZH, DATE_DOTS, fitPx } from './_motifs';
import { sigOf, layMsgV2, winBars, lastBefore, type MsgLay, type Rect } from './_t23';
import { V2, lyricV2 } from './_v2';
import { B5_TEXT, B5_INVITE, subPx, lineSlots, slotProgress, type BSlot } from './_b5';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'light', paper: false, energy: [0.2, 0.9], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（畫面座標，y 向下）
/** 三串電線：從畫面外垂進來（左端 y、右端 y、中間往下垂多少）。 */
const WIRES = [
  { y0: 132, y1: 156, sag: 66 },
  { y0: 318, y1: 336, sag: 50 },
  { y0: 450, y1: 466, sag: 42 },
];
const WX0 = -80, WX1 = 2000;
/** 字的燈泡排在這段裡（中間）。 */
const ZONE = { x0: 140, x1: 1780 };
const HORIZON = 640;
/** 木牌：左緣、下緣（牌子往上長），最大寬高（v2：含牌子 ≤ 860 × 430）。 */
const SIGN = { x: 124, bottom: 996, w: 780, h: 420 };
const FAM_BULB = F.hei(700);
const FAM_MSG = F.hand(700);
/** 燈泡半徑對字級的比例（字要整個在玻璃裡）。 */
const BULB_R = 0.62;
/** 草地上的玻璃罐蠟燭：x、y、大小（右下角 HUD 空出來）。 */
const JARS: [number, number, number][] = [[1010, 668, 0.55], [1085, 676, 0.6], [1236, 664, 0.5], [1120, 760, 0.9], [1016, 792, 1.05]];

const BG = () => new FSPass(/* glsl */ `
  uniform float uT; uniform vec3 uCam; uniform float uGlow;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = (sp - vec2(960.0, 360.0 + uCam.y)) / uCam.x + vec2(960.0, 360.0);
    // 夜空：上面最暗，近地平線帶一點暖（遠處的燈把霧照亮）
    float hz = ${HORIZON}.0;
    vec3 col = mix(C_INK * 0.75, mix(C_INK2, C_BLOOD, 0.16) * 0.95, smoothstep(0.0, hz, p.y));
    // 樹冠剪影：左上、右上兩團（被燈照到的地方暖一點）
    float n = fbm(p * vec2(0.0045, 0.006) + 3.1, 4);
    float lt = smoothstep(520.0, 0.0, p.x + 110.0 * n) * smoothstep(${HORIZON}.0 - 40.0, 40.0, p.y - 130.0 * n);
    float rt = smoothstep(1460.0, 1920.0, p.x - 110.0 * n) * smoothstep(${HORIZON}.0 - 60.0, 20.0, p.y - 150.0 * n);
    float tree = max(lt, rt);
    vec3 leaf = C_INK * 0.45 + mix(C_BLOOD, C_SIGNAL, 0.3) * 0.045 * smoothstep(0.3, 0.9, fbm(p * 0.02, 3) + 0.5) * uGlow;
    col = mix(col, leaf, smoothstep(0.35, 0.6, tree));
    // 遠處的樹籬
    float hedge = hz - 30.0 - 22.0 * fbm(vec2(p.x * 0.006, 1.7), 3) - 8.0 * sin(p.x * 0.013);
    // 樹籬裡的散景燈：一格一顆，糊糊的、慢慢閃
    if (p.y > 470.0 && p.y < ${HORIZON}.0 + 10.0) {
      vec2 cell = floor(vec2(p.x / 64.0, (p.y - 480.0) / 50.0));
      for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {
        vec2 cc = cell + vec2(float(dx), float(dy));
        vec2 h = hash22(cc + 7.0);
        if (h.x < 0.5) continue;
        vec2 c = vec2((cc.x + h.x) * 64.0, 480.0 + (cc.y + h.y) * 50.0);
        float r = 5.0 + 8.0 * h.y;
        float d = length(p - c) / r;
        float tw = 0.55 + 0.45 * sin(uT * (0.7 + h.y) + h.x * 30.0);
        col += mix(C_SIGNAL, C_EMBER, h.y) * 0.08 * tw * exp(-d * d * 1.6) * (1.0 - step(1280.0, p.x) * step(560.0, p.y));
      }
    }
    col = mix(col, C_INK2 * 0.5, smoothstep(hedge - 1.5, hedge + 1.5, p.y) * (1.0 - smoothstep(hz + 6.0, hz + 12.0, p.y)));
    // 草地：越近越亮一點，細細的草紋；燈串正下方一片暖光
    if (p.y > hz) {
      float d = clamp((p.y - hz) / (${H}.0 - hz), 0.0, 1.0);
      float blade = 0.8 + 0.2 * snoise(vec2(p.x * 0.11, p.y * 0.02)) + 0.08 * snoise(vec2(p.x * 0.4, p.y * 0.05));
      vec3 g = mix(C_INK2 * 0.5, mix(C_INK2, C_BLOOD, 0.12) * 0.85, d) * blade;
      float pool = exp(-pow((p.y - 690.0) / 90.0, 2.0)) * smoothstep(0.0, 700.0, 1700.0 - abs(p.x - 900.0));
      g += mix(C_BLOOD, C_SIGNAL, 0.45) * 0.08 * pool * uGlow;
      col = mix(col, g, smoothstep(hz + 6.0, hz + 12.0, p.y));
    }
    // 右下角（QR 與小字）：燈照不到的暗處
    col *= 1.0 - 0.7 * smoothstep(1250.0, 1500.0, sp.x) * smoothstep(720.0, 880.0, sp.y);
    fragColor = vec4(col, 1.0);
  }`, { uT: { value: 0 }, uCam: { value: new THREE.Vector3(1, 0, 0) }, uGlow: { value: 1 } });

/**
 * 電線上的一個燈泡：沿著電線的 x、半寬（膠囊燈管比較寬）、半徑（玻璃的半高）、種類、裡面的字（一個字，或英文一個詞的幾個字）。
 * offs：膠囊裡每個字的 x（相對燈管中心）。t0：純音樂的名字、日期亮起來的時間。
 */
interface Bulb { x: number; hw: number; r: number; kind: 'plain' | 'round' | 'cap'; slots: BSlot[]; chars: string[]; offs: number[]; t0?: number }
/** 一句歌詞在三串電線上的樣子（每串一排燈泡）。 */
interface Config { wires: Bulb[][]; t0: number; t1: number }

export default class StringLights extends Scene {
  bg = shared('stringlights.bg', BG);
  L = this.track(new Layer2D(W, H, undefined, { fast: true }));
  G = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 211 + (this.msg?.id ?? 0) * 37) >>> 0;
  lay: MsgLay | null = null;
  tOn = 0;
  bar = 2;
  bars: number[] = [];
  /** 每串電線的字級（螢幕 px）。 */
  wsize = [52, 36, 36];
  configs: Config[] = [];
  idle: Config = { wires: [[], [], []], t0: -Infinity, t1: Infinity };
  /** 木牌：牌子與字先畫好（每格只貼圖、照行調亮）。 */
  signCv: HTMLCanvasElement | null = null;
  textCv: HTMLCanvasElement | null = null;
  sign = { x: 0, y: 0, w: 0, h: 0 };
  lineT: number[] = [];
  sigT = Infinity;
  /** 燈泡的玻璃（暗的、亮的）、光暈。 */
  glassOff: HTMLCanvasElement | null = null;
  glassOn: HTMLCanvasElement | null = null;
  halo: HTMLCanvasElement | null = null;
  haloHot: HTMLCanvasElement | null = null;
  bokeh: HTMLCanvasElement | null = null;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    const sig = m ? sigOf(m) : '';
    const subs = lines.map((l) => lyricSubOf(l)?.text ?? '').join('');
    await loadText(`${B5_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}${subs}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    this.bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    this.bars = winBars(au, s - 4, e + 1);
    const c = this.L.ctx;

    // ---- 留言（木牌）：先排（座標相對木牌左上角），歌詞字級照留言字級
    let msgPx: number | null = null;
    if (m) {
      this.lay = layMsgV2(c, m.text, sig, FAM_MSG, { x: 56, y: 46, w: SIGN.w - 112, h: SIGN.h - 86 }, { lineHeight: 1.3, maxLines: 5, sigFamily: F.hand(400), align: 'left', valign: 'top' });
      msgPx = this.lay.fit.size;
    }

    // ---- 歌詞：一串電線一排燈泡；窗格裡最長的那句要放得下（放不下就縮字級，還不行就折到下一串）
    const zoneW = ZONE.x1 - ZONE.x0;
    const mainS = lines.map((l) => lineSlots(l));
    const subS = lines.map((l) => { const x = lyricSubOf(l); return x ? lineSlots(x) : null; });
    let mpx = lyricV2(msgPx);
    while (mpx > V2.lyrMin && mainS.some((x) => rowWidth(c, x, mpx) > zoneW)) mpx -= 1;
    const mainWrap = mainS.some((x) => rowWidth(c, x, mpx) > zoneW);
    let spx = subPx(mpx);
    while (spx > 30 && subS.some((x) => x && rowWidth(c, x, spx) > zoneW * (mainWrap ? 1 : 2) * 0.96)) spx -= 1;
    this.wsize = mainWrap ? [mpx, mpx, spx] : [mpx, spx, spx];
    const deco = (wi: number, used: Bulb[]) => {
      // 一般小燈：固定燈距排滿整條電線（字的那段空出來）
      const P = Math.round(this.wsize[wi]! * 1.45), out: Bulb[] = [];
      const lo = used.length ? used[0]!.x - used[0]!.hw - P * 0.55 : Infinity;
      const hi = used.length ? used[used.length - 1]!.x + used[used.length - 1]!.hw + P * 0.55 : -Infinity;
      const off = (hash(this.seed, wi, 3) - 0.5) * P, r = this.wsize[wi]! * 0.3;
      for (let x = 960 + off - Math.ceil((960 - WX0) / P) * P; x < WX1; x += P) if (x < lo || x > hi) out.push({ x, hw: r, r, kind: 'plain', slots: [], chars: [], offs: [] });
      return out;
    };
    const build = (ms: BSlot[] | null, ss: BSlot[] | null): Bulb[][] => {
      const rows: Bulb[][] = [[], [], []];
      if (ms) wrapRow(c, ms, this.wsize[0]!, zoneW, mainWrap ? 2 : 1).forEach((r, i) => (rows[i] = r));
      const at = mainWrap ? 2 : 1;
      if (ss && ss.length) wrapRow(c, ss, this.wsize[at]!, zoneW, 3 - at).forEach((r, i) => { if (at + i < 3) rows[at + i] = r; });
      return rows.map((r, wi) => [...r, ...deco(wi, r)].sort((a, b) => a.x - b.x));
    };
    this.idle.wires = build(null, null);
    lines.forEach((ln, i) => {
      const nx = lines[i + 1];
      this.configs.push({ wires: build(mainS[i]!, subS[i] ?? null), t0: ln.start - 0.35, t1: nx ? Math.min(ln.end + 1.2, nx.start - 0.35) : ln.end + 1.2 });
    });
    if (!lines.length) {
      // 純音樂：上串新人的名字、下串日期，半拍亮一顆（還沒定日期：下串全是一般的暖光小燈，不留空的燈泡）
      const slotsOf = (text: string) => Array.from(text).map((ch) => ({ ch: ch.trim() ? ch : '', word: null as never, k: 0, n: 1 }));
      // 名字很長時整串排不進字的那一段：把上串的燈泡縮小到放得下
      while (this.wsize[0]! > 24 && rowWidth(c, slotsOf(COUPLE_ZH), this.wsize[0]!) > zoneW) this.wsize[0] = this.wsize[0]! - 1;
      const fix = (wi: number, text: string, t0: number) => {
        const bs = placeRow(c, slotsOf(text), this.wsize[wi]!);
        bs.forEach((b, i) => (b.t0 = t0 + i * beat * 0.5));
        return bs.filter((b) => b.kind !== 'plain');
      };
      const a = fix(0, COUPLE_ZH, this.tOn), b = fix(1, DATE_DOTS, this.tOn + beat * 4);
      this.idle.wires = [a, b, []].map((u, wi) => [...u, ...deco(wi, u)].sort((p, q) => p.x - q.x));
    }

    // ---- 燈泡的玻璃與光暈（照這首歌的配色先畫好）
    this.glassOff = sprite(128, (g, R) => {
      const gr = g.createRadialGradient(R * 0.8, R * 0.7, R * 0.1, R, R, R);
      gr.addColorStop(0, rgba('ash', 0.16)); gr.addColorStop(0.75, rgba('graphite', 0.12)); gr.addColorStop(1, rgba('ash', 0.32));
      g.fillStyle = gr; g.beginPath(); g.arc(R, R, R * 0.97, 0, TAU); g.fill();
      g.strokeStyle = rgba('ash', 0.3); g.lineWidth = R * 0.035; g.stroke();
      g.fillStyle = rgba('bone', 0.3); g.beginPath(); g.ellipse(R * 0.42, R * 0.36, R * 0.12, R * 0.06, -0.8, 0, TAU); g.fill();
    });
    this.glassOn = sprite(128, (g, R) => {
      const gr = g.createRadialGradient(R, R, R * 0.1, R, R, R);
      gr.addColorStop(0, mixRgba('ember', 'bone', 0.4, 0.3)); gr.addColorStop(0.65, mixRgba('signal', 'ember', 0.4, 0.14)); gr.addColorStop(1, mixRgba('signal', 'blood', 0.3, 0.38));
      g.fillStyle = gr; g.beginPath(); g.arc(R, R, R * 0.97, 0, TAU); g.fill();
      g.strokeStyle = mixRgba('ember', 'bone', 0.5, 0.35); g.lineWidth = R * 0.035; g.stroke();
      g.fillStyle = rgba('bone', 0.45); g.beginPath(); g.ellipse(R * 0.42, R * 0.36, R * 0.12, R * 0.06, -0.8, 0, TAU); g.fill();
    });
    const glow = (a0: number, k: 'signal' | 'ember') => sprite(128, (g, R) => {
      const gr = g.createRadialGradient(R, R, 0, R, R, R);
      gr.addColorStop(0, mixRgba(k, 'ember', 0.5, a0)); gr.addColorStop(0.3, rgba('signal', a0 * 0.35)); gr.addColorStop(0.65, rgba('signal', a0 * 0.08)); gr.addColorStop(1, rgba('signal', 0));
      g.fillStyle = gr; g.fillRect(0, 0, 2 * R, 2 * R);
    });
    this.halo = glow(0.5, 'signal');
    this.haloHot = glow(0.9, 'ember');
    this.bokeh = sprite(256, (g, R) => {
      const gr = g.createRadialGradient(R, R, R * 0.55, R, R, R);
      gr.addColorStop(0, mixRgba('signal', 'ember', 0.5, 0.5)); gr.addColorStop(0.7, mixRgba('signal', 'ember', 0.5, 0.55)); gr.addColorStop(1, rgba('signal', 0));
      g.fillStyle = gr; g.beginPath(); g.arc(R, R, R, 0, TAU); g.fill();
    });

    // ---- 木牌
    this.drawSign(beat);
    const sg = this.sign;
    this.avoid = [[sg.x, sg.y, sg.w, sg.h], [ZONE.x0, 110, ZONE.x1 - ZONE.x0, 440]];
  }

  /** 木牌：木板、漆字（有留言是留言，沒有是新人的名字與邀請）。座標都相對木牌左上角。 */
  private drawSign(beat: number) {
    const lay = this.lay;
    let w: number, h: number;
    if (lay) {
      const [bx, by, bw, bh] = lay.box;
      w = Math.min(SIGN.w, Math.max(480, bx + bw + 60)); h = Math.min(SIGN.h, by + bh + 44);
    } else { w = 600; h = 190; }
    this.sign = { x: SIGN.x, y: SIGN.bottom - h, w, h };
    const S = 2;
    const cv = document.createElement('canvas'); cv.width = w * S; cv.height = h * S;
    const g = cv.getContext('2d')!; g.scale(S, S);
    // 木板：幾片橫的木板（暖的木頭色，深淺不一）、木紋、接縫、節疤；上面被燈照得暖一點
    const wood = mixRgba(mixRgba('fur', 'sepia', 0.5), 'ink', 0.42);
    const planks = Math.max(2, Math.round(h / 105));
    for (let i = 0; i < planks; i++) {
      const y0 = (h / planks) * i, ph = h / planks;
      g.fillStyle = mixRgba(wood, 'ink', 0.08 + 0.2 * hash(this.seed, i, 5));
      g.fillRect(0, y0, w, ph);
      for (let k = 0; k < 11; k++) {
        const yy = y0 + ph * (0.08 + 0.84 * hash(this.seed, i, k, 1));
        g.strokeStyle = hash(this.seed, i, k, 2) > 0.5 ? rgba('ink', 0.28) : mixRgba(wood, 'bone', 0.12, 0.35);
        g.lineWidth = 0.8 + hash(this.seed, i, k, 3);
        g.beginPath(); g.moveTo(0, yy);
        for (let x = 0; x <= w; x += 30) g.lineTo(x, yy + 2.5 * Math.sin(x * 0.012 + k * 1.7 + i * 3));
        g.stroke();
      }
      const kx = w * (0.15 + 0.7 * hash(this.seed, i, 8)), ky = y0 + ph * (0.3 + 0.4 * hash(this.seed, i, 9));
      g.fillStyle = rgba('ink', 0.35); g.beginPath(); g.ellipse(kx, ky, 9, 4, 0, 0, TAU); g.fill();
      g.fillStyle = rgba('ink', 0.7); g.fillRect(0, y0 + ph - 2, w, 2);
      g.fillStyle = mixRgba(wood, 'bone', 0.25, 0.5); g.fillRect(0, y0, w, 1.2);
    }
    const warm = g.createLinearGradient(0, 0, 0, h);
    warm.addColorStop(0, mixRgba('signal', 'ember', 0.5, 0.2)); warm.addColorStop(0.5, rgba('signal', 0.04)); warm.addColorStop(1, rgba('ink', 0.3));
    g.fillStyle = warm; g.fillRect(0, 0, w, h);
    // 兩側暗一點（圓角的木板邊）
    const side = g.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, rgba('ink', 0.35)); side.addColorStop(0.06, rgba('ink', 0)); side.addColorStop(0.94, rgba('ink', 0)); side.addColorStop(1, rgba('ink', 0.4));
    g.fillStyle = side; g.fillRect(0, 0, w, h);
    this.signCv = cv;
    // 漆字：畫在另一張（照行調亮）
    const tv = document.createElement('canvas'); tv.width = w * S; tv.height = h * S;
    const tg = tv.getContext('2d')!; tg.scale(S, S); tg.textBaseline = 'alphabetic';
    const paint = mixRgba('bone', 'paper', 0.4, 0.96);
    if (lay) {
      tg.fillStyle = paint;
      tg.font = font(FAM_MSG, lay.fit.size);
      for (const ln of lay.lines) fillHearts(tg, ln.text, ln.x, ln.y, lay.fit.size);
      tg.font = font(lay.sig.family, lay.sig.size); tg.fillStyle = mixRgba('bone', 'ash', 0.25, 0.92);
      tg.fillText(lay.sig.text, lay.sig.x, lay.sig.y);
      const n = lay.lines.length;
      this.lineT = lay.lines.map((_, i) => this.tOn + beat * 0.5 + (i * Math.min(this.bar * 1.2, beat * 6)) / Math.max(1, n));
      this.sigT = (this.lineT[n - 1] ?? this.tOn) + beat;
    } else {
      tg.fillStyle = paint;
      // 沒有留言：牌子寫「給 新人」＋邀請；名字很長就縮字，不超出 600 寬的木牌（左右各留 48）
      const to = `給 ${COUPLE_ZH}`;
      tg.font = font(FAM_MSG, fitPx(to, FAM_MSG, 46, 600 - 96)); tg.fillText(to, 48, 92);
      tg.font = font(F.hei(500), 21); tg.fillStyle = rgba('bone', 0.62); tg.letterSpacing = '2px';
      tg.fillText(B5_INVITE, 48, 146);
      this.lineT = [this.tOn + beat * 0.5];
      this.sigT = this.tOn + beat;
    }
    this.textCv = tv;
  }

  /** 電線上 x 的高度（含風）。 */
  private wireY(wi: number, x: number, t: number) {
    const w = WIRES[wi]!, u = (x - WX0) / (WX1 - WX0);
    const base = lerp(w.y0, w.y1, u) + w.sag * 4 * u * (1 - u);
    return base + this.gust(x, t, wi) + 2.2 * Math.sin(t * 0.8 + x * 0.004 + wi);
  }

  /** 小節線上一陣風沿著電線吹過去（從左往右的起伏，慢慢停）。 */
  private gust(x: number, t: number, wi: number) {
    const tb = lastBefore(this.bars, t), tau = t - tb;
    if (!(tau >= 0 && tau < 3)) return 0;
    const front = -200 + 1600 * tau;
    const env = Math.exp(-tau / 1.1) * clamp((front - x) / 300 + 1);
    return 9 * env * Math.sin((x - front) * 0.011 + wi * 0.8);
  }

  /** 燈泡晃的角度（風吹過時大、平常一點點）。 */
  private swing(x: number, t: number, wi: number) {
    const tb = lastBefore(this.bars, t), tau = t - tb;
    const g = tau >= 0 && tau < 3 ? 0.12 * Math.exp(-tau / 0.9) * Math.sin(6.5 * tau - x * 0.006 - wi) * clamp(((-200 + 1600 * tau) - x) / 300 + 1) : 0;
    return g + 0.03 * Math.sin(t * 1.3 + x * 0.013 + wi * 2);
  }

  private configAt(t: number): Config {
    for (const cf of this.configs) if (t >= cf.t0 && t < cf.t1) return cf;
    return this.idle;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    // ---- 鏡頭：切進來時稍微往上看，第一拍落定；之後慢慢推近
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.08)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const z = 1 + 0.035 * drift, oy = 60 * (1 - land);
    const on = 0.35 + 0.65 * ease.outCubic(prog(t, s, this.tOn + 0.05));
    const kick = f.a.kick;
    const u = this.bg.u;
    u.uT!.value = t; u.uGlow!.value = on * (0.9 + 0.2 * kick);
    (u.uCam!.value as THREE.Vector3).set(z, oy, 0);
    this.bg.render(renderer, out);

    const c = this.L.ctx, g = this.G.ctx;
    this.L.clear(); this.G.clear();
    const cam = [z, 0, 0, z, 960 - 960 * z, 360 - 360 * z + oy] as const;
    c.setTransform(...cam); g.setTransform(...cam);

    // ---- 換句：整串閃一下（燈絲換字）
    const cf = this.configAt(t);
    const edges = [cf.t0, cf.t1].filter(Number.isFinite);
    const dip = edges.length ? Math.min(...edges.map((x) => clamp(Math.abs(t - x) / 0.16))) : 1;
    const bi = Math.floor(au.beatAt(t) + 1e-4);
    const lit = on * (0.3 + 0.7 * dip) * (1 + 0.12 * kick);

    // ---- 前景：很近、失焦的一串大燈泡（上緣）
    for (let i = 0; i < 6; i++) {
      const x = -40 + i * 390 + 50 * Math.sin(t * 0.45 + i) + 30 * hash(this.seed, i, 8), y = -70 + 20 * Math.sin(i * 1.7) + 8 * Math.sin(t * 0.9 + i * 2) + this.gust(x, t, 0) * 1.5;
      const r = 80 + 26 * hash(this.seed, i, 9);
      g.globalAlpha = 0.1 * on * (0.8 + 0.2 * Math.sin(t * 2.1 + i)); g.drawImage(this.bokeh!, x - r, y - r, 2 * r, 2 * r);
    }
    g.globalAlpha = 1;

    // ---- 三串燈
    const hot: { x: number; y: number; r: number }[] = [];
    /** 亮著的字燈泡的玻璃（圓：[x, y, 半徑, 0]；膠囊：[x, y, 半寬, 半高]）：光暈層要挖掉這些地方，光只在燈泡四周。 */
    const glass: [number, number, number, number][] = [];
    for (let wi = 0; wi < 3; wi++) {
      const bulbs = cf.wires[wi]!;
      const size = this.wsize[wi]!;
      // 電線
      c.strokeStyle = rgba('ink', 0.95); c.lineWidth = 2.4;
      c.beginPath();
      for (let x = WX0; x <= WX1; x += 40) { const y = this.wireY(wi, x, t); if (x === WX0) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
      c.strokeStyle = mixRgba('graphite', 'signal', 0.2, 0.3); c.lineWidth = 0.8; c.stroke();
      bulbs.forEach((b, i) => {
        const wy = this.wireY(wi, b.x, t);
        const th = this.swing(b.x, t, wi);
        const sock = Math.max(7, b.r * 0.5);
        const cx = b.x + Math.sin(th) * (sock + b.r), cy = wy + Math.cos(th) * (sock + b.r);
        // 燈座
        c.save(); c.translate(b.x, wy); c.rotate(-th);
        c.fillStyle = mixRgba('ink', 'graphite', 0.45); c.fillRect(-Math.max(3, b.r * 0.26), 0, Math.max(6, b.r * 0.52), sock + 2);
        c.fillStyle = rgba('ash', 0.35); c.fillRect(-Math.max(3, b.r * 0.26), sock * 0.4, Math.max(6, b.r * 0.52), 1.2);
        c.restore();
        if (b.kind === 'plain') {
          // 一般小燈：一拍走一格的跑燈（四顆一組），燈絲是一小段暖光
          const chase = ((i + bi) % 4 === 0 ? 1 : 0.6) * (0.85 + 0.15 * Math.sin(t * 9 + i * 1.7));
          const a = lit * chase;
          c.drawImage(this.glassOn!, cx - b.r, cy - b.r, 2 * b.r, 2 * b.r);
          c.globalAlpha = a; c.strokeStyle = rgba('ember', 0.95); c.lineWidth = 1.4;
          c.beginPath(); c.moveTo(cx - b.r * 0.4, cy + b.r * 0.1); c.quadraticCurveTo(cx, cy - b.r * 0.55, cx + b.r * 0.4, cy + b.r * 0.1); c.stroke();
          c.globalAlpha = 1;
          const hr = b.r * 5;
          g.globalAlpha = 0.45 * a; g.drawImage(this.halo!, cx - hr, cy - hr, 2 * hr, 2 * hr);
          g.globalAlpha = 1;
          return;
        }
        // 字的燈泡：燈絲就是字（英文的膠囊燈管一次一個詞，裡面的字各自照時間亮）
        const prog0 = (k: number) => (b.t0 !== undefined ? (t >= b.t0 ? 1 : 0) : slotProgress(b.slots[k]!, t));
        const ps = b.chars.map((_, k) => prog0(k));
        const anyOn = ps.some((p) => p > 0);
        const active = ps.some((p) => p > 0 && p < 1);
        const t0 = b.t0 ?? slotT0(b.slots[0]!);
        const flash = t >= t0 ? Math.exp(-(t - t0) / 0.22) : 0;
        // 玻璃
        if (b.kind === 'round') c.drawImage(anyOn ? this.glassOn! : this.glassOff!, cx - b.r, cy - b.r, 2 * b.r, 2 * b.r);
        else capsule(c, cx, cy, b.hw, b.r, anyOn);
        // 燈絲字：字本身永遠是銳利的（亮的字加一圈深色細邊），光暈只在玻璃外面（見下面的「挖掉玻璃」），
        // 正在唱的字是最清楚的一個，閃一下的時候也不會被光吃掉
        c.font = font(FAM_BULB, size); c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
        const fy = cy + size * 0.35;
        b.chars.forEach((ch, k) => {
          const p = ps[k]!, x = cx + b.offs[k]!;
          const st = p <= 0 ? 0 : p < 1 ? 1 : 2;
          if (ch === '♥') { drawHeart(c, x, cy - size * 0.05, size * 0.66, st === 0 ? rgba('rose', 0.3) : rgba('rose', 0.95)); return; }
          if (st > 0) { c.strokeStyle = rgba('ink', 0.75); c.lineWidth = Math.max(2, size * 0.07); c.strokeText(ch, x, fy); }
          // 還沒唱的燈絲：燈泡還暗著是淡淡的字；同一支燈管已經亮了（英文詞唱到一半）是沒通電的深色燈絲，亮玻璃上也讀得到
          c.fillStyle = st === 0 ? (anyOn ? mixRgba('ink', 'graphite', 0.35, 0.6) : rgba('bone', 0.3 * (0.4 + 0.6 * dip))) : st === 1 ? mixRgba('signal', 'ember', 0.25) : mixRgba('ember', 'bone', 0.6);
          c.fillText(ch, x, fy);
        });
        if (anyOn) glass.push(b.kind === 'round' ? [cx, cy, b.r * 0.97, 0] : [cx, cy, b.hw, b.r]);
        if (anyOn) {
          // 光暈：圓燈泡一圈、膠囊燈管是橫的一片（不要大到把旁邊的字糊掉）
          const k = 2.2 + 0.9 * flash + (active ? 0.4 : 0);
          const hw = b.hw + b.r * (k - 1), hh = b.r * k;
          g.globalAlpha = lit * (active ? 0.75 : 0.3 + 0.4 * flash);
          g.drawImage(active || flash > 0.2 ? this.haloHot! : this.halo!, cx - hw, cy - hh, 2 * hw, 2 * hh);
          g.globalAlpha = 1;
          if (wi === 0 || active) hot.push({ x: cx, y: cy, r: b.r });
        }
      });
    }
    c.textAlign = 'left'; g.textAlign = 'left';
    // 挖掉玻璃：加亮的光暈不能蓋在字上（不然正在唱的字反而被光洗掉）
    g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    for (const [x, y, a, b2] of glass) {
      g.beginPath();
      if (b2 === 0) g.arc(x, y, a, 0, TAU); else g.roundRect(x - a, y - b2, 2 * a, 2 * b2, b2);
      g.fill();
    }
    g.restore();

    // ---- 飛蛾：繞著上面那串亮著的燈泡飛
    for (let k = 0; k < 3; k++) {
      const pool = hot.length ? hot : cf.wires[0]!.map((b) => ({ x: b.x, y: this.wireY(0, b.x, t) + b.r * 1.5, r: b.r }));
      const b = pool[Math.floor(hash(this.seed, k, 4) * pool.length)];
      if (!b) continue;
      const a = t * (2.2 + 0.6 * k) + k * 2.1;
      const mx = b.x + Math.cos(a) * (b.r * 1.9 + 12 * Math.sin(t * 3.1 + k)), my = b.y + Math.sin(a * 1.3) * b.r * 1.5 - b.r * 0.3;
      const flap = Math.abs(Math.sin(t * 38 + k * 5));
      c.fillStyle = rgba('bone', 0.5 * on);
      c.beginPath(); c.ellipse(mx - 3, my, 4, 1.5 + 3 * flap, 0.6, 0, TAU); c.ellipse(mx + 3, my, 4, 1.5 + 3 * flap, -0.6, 0, TAU); c.fill();
    }

    // ---- 草地上的幾個玻璃罐蠟燭（遠的小、近的大），火苗一直在晃
    for (const [jx, jy, js] of JARS) {
      const w = 22 * js, h = 30 * js, fl = 0.8 + 0.2 * Math.sin(t * 11 + jx) * Math.sin(t * 7.3 + jy);
      c.fillStyle = rgba('ink', 0.4); c.beginPath(); c.ellipse(jx, jy + h * 0.5, w * 0.9, 4 * js, 0, 0, TAU); c.fill();
      c.fillStyle = mixRgba('signal', 'blood', 0.4, 0.3 * on); c.beginPath(); c.roundRect(jx - w / 2, jy - h / 2, w, h, 4 * js); c.fill();
      c.strokeStyle = rgba('ash', 0.35); c.lineWidth = 1; c.stroke();
      c.fillStyle = rgba('ember', 0.95 * on * fl); c.beginPath(); c.ellipse(jx, jy + h * 0.05, 2.2 * js, 5 * js * fl, 0, 0, TAU); c.fill();
      const hr = 60 * js; g.globalAlpha = 0.5 * on * fl; g.drawImage(this.halo!, jx - hr, jy - hr, 2 * hr, 2 * hr); g.globalAlpha = 1;
    }

    // ---- 木牌（立在左下草地上），上緣繞一小串燈
    this.drawSignFrame(c, g, t, lit, bi);

    c.setTransform(1, 0, 0, 1, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, this.L.upload(), out);
    comp.draw(renderer, this.G.upload(), out, { mode: 'add', tint: [1.5, 1.5, 1.5] });
    return { bloom: 0.8, bloomThreshold: 0.9, vignette: 0.55, halation: 0.3, popupAvoid: this.avoid };
  }

  private drawSignFrame(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, t: number, lit: number, bi: number) {
    const sg = this.sign, S = 2;
    const rise = ease.outCubic(prog(t, this.ctx.start, this.tOn + 0.2));
    const y = sg.y + 24 * (1 - rise);
    // 草地上的影子、插進草地的兩支木腳
    c.fillStyle = rgba('ink', 0.45); c.beginPath(); c.ellipse(sg.x + sg.w / 2 + 20, y + sg.h + 40, sg.w * 0.52, 16, 0, 0, TAU); c.fill();
    c.fillStyle = mixRgba(mixRgba('fur', 'sepia', 0.5), 'ink', 0.6);
    for (const fx of [0.16, 0.84]) c.fillRect(sg.x + sg.w * fx - 8, y + sg.h - 12, 16, 120);
    c.drawImage(this.signCv!, 0, 0, sg.w * S, sg.h * S, sg.x, y, sg.w, sg.h);
    // 漆字：一行一行被燈照亮
    const tv = this.textCv!;
    const lay = this.lay;
    const band = (y0: number, hh: number, a: number) => {
      if (a <= 0) return;
      y0 = Math.max(0, y0); hh = Math.min(hh, sg.h - y0);
      if (hh <= 0) return;
      c.globalAlpha = a;
      c.drawImage(tv, 0, y0 * S, sg.w * S, hh * S, sg.x, y + y0, sg.w, hh);
    };
    if (lay) {
      lay.lines.forEach((ln, i) => band(ln.y - lay.fit.size - 4, lay.fit.lineHeight + 2, prog(t, this.lineT[i]!, this.lineT[i]! + 0.45, ease.outCubic)));
      band(lay.sig.y - lay.sig.size - 4, lay.sig.size * 1.5, prog(t, this.sigT, this.sigT + 0.4));
    } else band(0, sg.h, prog(t, this.lineT[0]!, this.lineT[0]! + 0.45, ease.outCubic));
    c.globalAlpha = 1;
    // 上緣的小燈串：第一拍起八分音符一顆一顆亮，亮完之後一拍一閃
    const n = Math.max(7, Math.round(sg.w / 80));
    const wy = (x: number) => y - 2 + 12 * Math.sin(((x - sg.x) / sg.w) * Math.PI * (n / 2)) ** 2;
    c.strokeStyle = rgba('ink', 0.9); c.lineWidth = 1.8;
    c.beginPath();
    for (let x = sg.x - 14; x <= sg.x + sg.w + 14; x += 8) { if (x === sg.x - 14) c.moveTo(x, wy(x)); else c.lineTo(x, wy(x)); }
    c.stroke();
    const beat = this.ctx.audio.beatPeriod(this.tOn);
    for (let i = 0; i < n; i++) {
      const x = sg.x + (sg.w * (i + 0.5)) / n, yy = wy(x) + 11;
      const tl = this.tOn + i * beat * 0.5;
      const onb = t >= tl;
      const a = onb ? (0.75 + 0.25 * ((i + bi) % 3 === 0 ? 1 : 0)) * lit * (1 + 0.8 * Math.exp(-(t - tl) / 0.2)) : 0;
      c.drawImage(onb ? this.glassOn! : this.glassOff!, x - 9, yy - 9, 18, 18);
      if (onb) {
        c.fillStyle = rgba('ember', 0.9 * Math.min(1, a)); c.beginPath(); c.arc(x, yy, 2.4, 0, TAU); c.fill();
        const hr = 40; g.globalAlpha = 0.45 * a; g.drawImage(this.halo!, x - hr, yy - hr, 2 * hr, 2 * hr); g.globalAlpha = 1;
      }
    }
  }
}

// ---------------------------------------------------------------- 排燈泡
const LATIN = /[\p{Script=Latin}\d'’,.!?:;&\-"“”()]/u;
const gapOf = (px: number) => px * 0.16 + 4;

/** 一串格子 → 燈泡（沒有位置，x 是相對整排左端的中心）：中文、韓文一字一顆圓燈泡，英文一個詞一支膠囊燈管，空白是一段空電線。 */
function tokens(c: CanvasRenderingContext2D, slots: BSlot[], px: number): (Bulb | number)[] {
  c.font = font(FAM_BULB, px);
  const r = px * BULB_R, out: (Bulb | number)[] = [];
  let cur: Bulb | null = null;
  for (const sl of slots) {
    if (!sl.ch) { cur = null; out.push(px * 0.34); continue; }
    if (LATIN.test(sl.ch) && sl.ch !== '♥') {
      if (cur && cur.slots[cur.slots.length - 1]!.word === sl.word) { cur.slots.push(sl); cur.chars.push(sl.ch); continue; }
      cur = { x: 0, hw: 0, r: px * 0.6, kind: 'cap', slots: [sl], chars: [sl.ch], offs: [] };
      out.push(cur);
      continue;
    }
    cur = null;
    out.push({ x: 0, hw: r, r, kind: 'round', slots: [sl], chars: [sl.ch], offs: [0] });
  }
  for (const b of out) {
    if (typeof b === 'number' || b.kind !== 'cap') continue;
    const ws = b.chars.map((ch) => c.measureText(ch).width), tw = ws.reduce((a, x) => a + x, 0);
    let x = -tw / 2;
    b.offs = ws.map((w) => { const o = x + w / 2; x += w; return o; });
    b.hw = tw / 2 + px * 0.34;
  }
  return out;
}

/** 一排的總寬。 */
function rowWidth(c: CanvasRenderingContext2D, slots: BSlot[], px: number) {
  return widthOf(tokens(c, slots, px), px);
}
function widthOf(toks: (Bulb | number)[], px: number) {
  let w = 0, prev = false;
  for (const tk of toks) {
    if (typeof tk === 'number') { w += tk; prev = false; continue; }
    w += (prev ? gapOf(px) : 0) + 2 * tk.hw; prev = true;
  }
  return w;
}

/** 排成一排、置中在 960。 */
function placeRow(c: CanvasRenderingContext2D, slots: BSlot[], px: number): Bulb[] {
  const toks = tokens(c, slots, px);
  let x = 960 - widthOf(toks, px) / 2, prev = false;
  const out: Bulb[] = [];
  for (const tk of toks) {
    if (typeof tk === 'number') { x += tk; prev = false; continue; }
    if (prev) x += gapOf(px);
    tk.x = x + tk.hw; x += 2 * tk.hw; prev = true;
    out.push(tk);
  }
  return out;
}

/** 放不下就在最接近中間的空白（或詞與詞之間）折成兩排。 */
function wrapRow(c: CanvasRenderingContext2D, slots: BSlot[], px: number, maxW: number, rows: number): Bulb[][] {
  if (rows < 2 || rowWidth(c, slots, px) <= maxW) return [placeRow(c, slots, px)];
  let best = -1, bestD = Infinity;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i]!.ch && slots[i - 1]!.ch && slots[i]!.word === slots[i - 1]!.word) continue;
    const d = Math.max(rowWidth(c, slots.slice(0, i), px), rowWidth(c, slots.slice(i), px));
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return [placeRow(c, slots, px)];
  const a = slots.slice(0, best), b = slots.slice(best);
  const trim = (x: BSlot[]) => { let i = 0, j = x.length; while (i < j && !x[i]!.ch) i++; while (j > i && !x[j - 1]!.ch) j--; return x.slice(i, j); };
  return [placeRow(c, trim(a), px), placeRow(c, trim(b), px)];
}

/** 膠囊燈管的玻璃（英文一個詞一支）。 */
function capsule(c: CanvasRenderingContext2D, x: number, y: number, hw: number, r: number, on: boolean) {
  c.beginPath(); c.roundRect(x - hw, y - r, 2 * hw, 2 * r, r);
  const gr = c.createLinearGradient(0, y - r, 0, y + r);
  if (on) { gr.addColorStop(0, mixRgba('signal', 'blood', 0.3, 0.34)); gr.addColorStop(0.5, mixRgba('ember', 'bone', 0.4, 0.2)); gr.addColorStop(1, mixRgba('signal', 'blood', 0.3, 0.36)); }
  else { gr.addColorStop(0, rgba('ash', 0.26)); gr.addColorStop(0.5, rgba('graphite', 0.12)); gr.addColorStop(1, rgba('ash', 0.3)); }
  c.fillStyle = gr; c.fill();
  c.strokeStyle = on ? mixRgba('ember', 'bone', 0.5, 0.35) : rgba('ash', 0.3); c.lineWidth = 1.4; c.stroke();
  c.fillStyle = rgba('bone', on ? 0.22 : 0.16); c.beginPath(); c.roundRect(x - hw + r * 0.45, y - r * 0.9, Math.max(4, hw * 0.5), r * 0.08, r * 0.04); c.fill();
}

function slotT0(sl: BSlot) {
  const w = sl.word;
  return w.start + ((w.end - w.start) * sl.k) / sl.n;
}

/** 先畫好的小圖（R = 半徑，畫布 2R × 2R）。 */
function sprite(size: number, draw: (g: CanvasRenderingContext2D, R: number) => void) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size / 2);
  return cv;
}

/** 手寫漆字（♥ 用自己畫的愛心）。 */
function fillHearts(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  let cx = x;
  for (const part of text.split(/(♥)/u)) {
    if (!part) continue;
    if (part === '♥') { const fs = g.fillStyle; drawHeart(g, cx + size * 0.45, y - size * 0.34, size * 0.72); g.fillStyle = fs; cx += size * 0.95; continue; }
    g.fillText(part, cx, y);
    cx += g.measureText(part).width;
  }
}

