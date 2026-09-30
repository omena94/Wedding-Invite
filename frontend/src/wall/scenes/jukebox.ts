// 點唱機（暗）：從點唱機的玻璃看進去，裡面是一整排立著的唱片（像書架上的書），下面一台轉盤。
//  - 選歌的機構：第一拍，上面橫樑的天車「唰」地滑到這首歌的那張唱片上方（一拍）；第二拍伸縮桿往下夾住唱片中心（喀）；
//    第三拍把唱片抽起來；第四拍載著唱片滑到轉盤上方、在空中翻平；下一拍落到轉盤上，唱臂擺進來，唱片開始轉。
//    動作都落在拍點上，強烈緩動。唱片、天車、轉盤是真的 3D 座標投影出來再用 Canvas2D 畫（由遠到近，會互相遮住），不是貼圖。
//  - 上方的弧形玻璃上印著「NOW PLAYING」＝歌詞（逐字跟唱）。
//    韓文歌有中文翻譯時（2026-09-30）：中文照舊在鉻框上方；鉻框上方放不下第二排，原文小一號印在玻璃裡的上緣
//    （機構整個往下挪 SUB_ROOM 讓出這一條，天車的橫樑才不會穿過原文）。
//  - 下方是選曲卡（title strip）：老點唱機那種白卡、中間一條色帶印歌手、上下是 A 面與 B 面。
//    中間最大那張就是這則留言：A 面是留言（一個字一個字印上去）、色帶是署名、B 面「永遠」；
//    左邊三張是冷面的假歌（遛狗進行曲／芃芃 & QQ…），右上那張是現在這首歌（選曲燈亮著）。
//  - 沒有留言：大卡片寫「空白選曲卡」與邀請。純音樂：玻璃上寫歌名。
// 2026-09-29 依「MV 融合原則」：留言那張選曲卡放大成畫面的焦點（真的紙：有陰影、微微歪），歌詞小一級；
// 旁邊幾張選曲卡變成失焦的前景（讀不到字，只是景深），拿掉卡片編號與「NOW PLAYING」小卡。
// 同日「留言尺寸與版面比例標準 v2」：機構的玻璃窗放大成主視覺，選曲卡縮到 ≤ 800 × 310 放在左下，留言 40～60 px；
// 補上點唱機招牌的兩支泡泡管（泡泡一直往上冒、燈色跟著拍子換）與右下的喇叭（大鼓一打就鼓一下）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, lyricSubOf, drawLyricSub, beatAfter, signature, fillWithHearts } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { stagger, pad3, mono, tag } from './_t11';
import { fillGlyph, type Rect } from './_t9';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.3, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面
const LYR = { x: 460, y: 142, w: 1000 };
/** 玻璃窗（機構）的範圍。 */
const WIN = { x: 150, y: 180, w: 1620, h: 470 };
/** 原文副行（韓文歌）：印在玻璃裡上緣的基線；有副行的窗格機構往下挪多少（橫樑讓出這一條，下面還有空，唱片不會被切到）。 */
const SUB_Y = WIN.y + 44, SUB_ROOM = 52;
/** 留言那張選曲卡：左下，寬 800，高依留言（最多 310）；右邊是喇叭，右下角 QR 區（x ≥ 1360、y ≥ 830）空著。 */
const CARD = { x: 190, y: 670, w: 800, maxH: 318 };
/** 卡片裡：留言左右各留 40；下面是色帶（署名）與 B 面。 */
const CARD_PAD = { x: 40, top: 30, band: 40, bside: 30 };
/** 喇叭（圓形的布面＋鉻條），大鼓一打就鼓一下。 */
const SPK = { x: 1172, y: 818, r: 118 };
/** 兩支泡泡管：玻璃窗左右兩側。 */
const TUBES = [{ x: 118, y0: 210, y1: 640 }, { x: 1802, y0: 210, y1: 640 }];
const FAM_MSG = F.ming(700);
const INVITE = '掃描右下角 QR code，寫下你的點歌留言';
const EMPTY = '（空白選曲卡）';

// ---------------------------------------------------------------- 3D（x 右、y 上、z 朝鏡頭）
const CAM0 = { x: -380, y: 430, z: 1500 };
const LOOK: [number, number, number] = [-40, -30, 0];
const FOCAL = 1640;
const SC = { x: 960, y: 440 };
/** 唱片架：N 張立著的唱片（碟面朝 x），半徑、間距、中心的 z。 */
const N = 25, RR = 124, GAP = 40, RACK_Z = -70, RACK_X = -300;
/** 轉盤：盤面中心、半徑。 */
const TT = { x: 540, y: -110, r: 156 };
const RAIL_Y = -146;
/** 天車的橫樑高度。 */
const BEAM_Y = 196;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** 鏡頭（每格照時間重設，不留狀態）：位置與三個軸。 */
const CAM = { x: CAM0.x, y: CAM0.y, z: CAM0.z };
let FWD: V3 = [0, 0, -1], RIGHT: V3 = [1, 0, 0], UP: V3 = [0, 1, 0];
function setCam(x: number, y: number, z: number) {
  CAM.x = x; CAM.y = y; CAM.z = z;
  FWD = norm(sub(LOOK, [x, y, z]));
  RIGHT = norm(cross(FWD, [0, 1, 0]));
  UP = cross(RIGHT, FWD);
}
setCam(CAM0.x, CAM0.y, CAM0.z);
/** 3D → 螢幕（回傳 x, y 與深度）。 */
function proj(p: V3): { x: number; y: number; z: number } {
  const d = sub(p, [CAM.x, CAM.y, CAM.z]);
  const z = dot(d, FWD);
  return { x: SC.x + (FOCAL * dot(d, RIGHT)) / z, y: SC.y - (FOCAL * dot(d, UP)) / z, z };
}
/** 圓盤（中心 c、兩個軸 u, v、半徑 r）投影到螢幕的一圈點。 */
function ring(c: V3, u: V3, v: V3, r: number, n = 40) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    pts.push(proj([c[0] + u[0] * ca + v[0] * sa, c[1] + u[1] * ca + v[1] * sa, c[2] + u[2] * ca + v[2] * sa]));
  }
  return pts;
}
const path = (c: CanvasRenderingContext2D, pts: { x: number; y: number }[]) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); };
const rackX = (i: number) => RACK_X + (i - (N - 1) / 2) * GAP;

const BG = () => new FSPass(/* glsl */ `
  uniform float k; uniform float glow; uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 點唱機的內部：深色絨布、轉盤那裡有一盞暖燈
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.5 + 0.5 * fbm(p / 300.0, 3));
    col += mix(C_BLOOD, C_SIGNAL, 0.3) * 0.12 * glow * exp(-pow(length((p - vec2(960.0, 560.0)) / vec2(700.0, 260.0)), 2.0));
    // 玻璃窗的鉻框：上緣是圓角的拱形
    vec2 c = vec2(${WIN.x + WIN.w / 2}.0, ${WIN.y + WIN.h / 2}.0);
    float d = sdBox(p - c, vec2(${WIN.w / 2}.0, ${WIN.h / 2}.0) - 60.0) - 60.0;
    float a = atan(p.y - c.y, p.x - c.x);
    float band = smoothstep(18.0, 0.0, abs(d - 12.0));
    vec3 chrome = mix(C_GRAPHITE * 0.5, C_BONE * 0.55, pow(0.5 + 0.5 * cos(a * 2.0 + 0.8), 3.0));
    chrome *= 0.7 + 0.3 * smoothstep(0.0, 12.0, abs(d - 12.0));
    col = mix(col, chrome, band * k);
    col += C_BONE * 0.12 * pxLine(abs(d - 3.5), 0.4, 1.2) * k;
    // 玻璃：一道很淡的斜反光
    if (d < 0.0) {
      float g = exp(-pow((p.x - p.y * 0.9 - 520.0 - 60.0 * sin(t * 0.2)) / 90.0, 2.0));
      col += C_BONE * 0.018 * g;
    }
    // 下面的選曲卡區：一塊鉻板，細細的橫紋
    if (p.y > ${WIN.y + WIN.h + 6}.0) {
      float br = 0.9 + 0.1 * snoise(vec2(p.x * 0.002, p.y * 0.8));
      col = mix(col, (C_GRAPHITE * 0.22 + C_INK2 * 0.6) * br, 0.8);
      col += C_BONE * 0.05 * pxLine(abs(p.y - ${WIN.y + WIN.h + 8}.0), 0.4, 1.3);
    }
    fragColor = vec4(col, 1.0);
  }`, { k: { value: 1 }, glow: { value: 1 }, t: { value: 0 } });

interface Glyph { ch: string; x: number; y: number; t: number }

export default class Jukebox extends Scene {
  bg = shared('jukebox.bg', BG);
  still = this.track(new Layer2D(W, H, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 173 + (this.msg?.id ?? 0) * 31) >>> 0;
  /** 這首歌是架上的第幾張、每張唱片標籤的顏色。 */
  pick = 17;
  labels: string[] = [];
  /** 選歌動作的拍點：滑過去、夾住、抽起、翻平、落下（秒）。 */
  tk: number[] = [];
  carFrom = 0;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig = ''; sigT = Infinity;
  tFirst = 0;
  avoid: Rect[] = [];
  lyrSize = 52;
  card = { x: CARD.x, y: CARD.y, w: CARD.w, h: 300 };
  sigSize = 30;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = m ? (m.couple ? '新郎新娘' : (m.name || '一位賓客')) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${INVITE}${EMPTY}${song.title}${song.artist}永遠的面今晚第首選曲卡現正播放點歌留言新人`);
    const c = this.layer.ctx;
    // 這首歌在架上的位置（用歌的順序，同一首每次一樣），標籤顏色
    this.pick = 5 + ((song.index * 7 + 3) % (N - 10));
    const cols = ['bone', 'ash', 'blood', 'graphite', 'signal'];
    this.labels = Array.from({ length: N }, (_, i) => cols[Math.floor(hash(i, 11) * 4)]!);
    this.carFrom = TT.x;
    // ---- 選歌動作：從第一拍開始，一拍一個動作（窗格太短就半拍一個）
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    const step = e - this.tFirst < 7 * beat ? 0.5 : 1;
    const b0 = au.beatAt(this.tFirst);
    this.tk = [0, 1, 2, 3, 4, 5].map((i) => au.timeOfBeat(b0 + i * step));
    // ---- 大卡片：A 面（留言）一個字一個字印上去
    const text = m ? m.text : INVITE;
    // 留言字級照標準 v2（上限看字數），卡片的高度依內容（標頭＋留言＋色帶＋B 面），最多 CARD.maxH
    const fam = m ? FAM_MSG : F.hand(400);
    const tw = CARD.w - 2 * CARD_PAD.x;
    const room = CARD.maxH - CARD_PAD.top - CARD_PAD.band - CARD_PAD.bside - 30;
    const o = { min: V2.msgMin, max: m ? msgMaxFor(text) : 44, lineHeight: 1.18, maxLines: 5 };
    const fit = this.fit = fitClauses(c, text, fam, tw, room, o) ?? fitText(c, text, fam, tw, room, o);
    this.lyrSize = lyricV2(m ? fit.size : null);
    this.sigSize = sigV2(fit.size);
    const ch = Math.round(CARD_PAD.top + fit.height + fit.size * 0.35 + 18 + CARD_PAD.band + CARD_PAD.bside);
    this.card = { x: CARD.x, y: CARD.y, w: CARD.w, h: ch };
    c.font = font(fam, fit.size);
    const top = CARD.y + CARD_PAD.top + fit.size * 0.88 + (m ? 0 : 18);
    const pos: { ch: string; x: number; y: number }[] = [];
    fit.lines.forEach((ln, li) => {
      let x = CARD.x + CARD.w / 2 - c.measureText(ln).width / 2;
      for (const ch of Array.from(ln)) { pos.push({ ch, x, y: top + li * fit.lineHeight }); x += c.measureText(ch).width; }
    });
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    const times = stagger(au, this.tFirst + beat * 0.5, pos.length, Math.min(2 * bar, 0.4 * (e - s)));
    this.glyphs = pos.map((p, i) => ({ ...p, t: times[i]! }));
    this.sigT = (times[times.length - 1] ?? this.tFirst) + beat * 0.5;
    this.drawStill();
    let rows = 1;
    for (const ln of lyrics.linesIn(s - 1, e + 1)) rows = Math.max(rows, this.layLyric(ln).rows.length);
    this.avoid = [[LYR.x, LYR.y - this.lyrSize - 8, LYR.w, rows > 1 ? 150 : 96], [this.card.x, this.card.y, this.card.w, this.card.h]];
  }

  private layLyric(line: Parameters<typeof layoutLyric>[1]) {
    return layoutLyric(this.layer.ctx, line, { family: F.archivo(100, 800), size: this.lyrSize, minSize: V2.lyrMin, maxWidth: LYR.w, align: 'center', lineHeight: 1.1 });
  }

  /** 選曲卡的紙、框、色帶、B 面，喇叭的鉻框（畫一次）。 */
  private drawStill() {
    const L = this.still, c = L.ctx;
    const { song } = this.ctx;
    L.clear();
    const BIG = this.card;
    // 大卡：真的紙擺在鉻板上——下面一片柔和的影子、微微歪一點
    c.save();
    c.translate(BIG.x + BIG.w / 2, BIG.y + BIG.h / 2); c.rotate(-0.006); c.translate(-(BIG.x + BIG.w / 2), -(BIG.y + BIG.h / 2));
    c.save(); c.filter = 'blur(14px)'; c.fillStyle = rgba('ink', 0.7); c.fillRect(BIG.x + 10, BIG.y + 18, BIG.w, BIG.h); c.restore();
    c.fillStyle = rgba('paper', 0.97); c.fillRect(BIG.x, BIG.y, BIG.w, BIG.h);
    // 紙的纖維（很淡的斜紋）
    c.strokeStyle = rgba('sepia', 0.035); c.lineWidth = 1;
    for (let i = 0; i < 90; i++) { const y = BIG.y + (i * 37) % BIG.h, x = BIG.x + ((i * 173) % BIG.w); c.beginPath(); c.moveTo(x, y); c.lineTo(x + 40, y + 3); c.stroke(); }
    c.strokeStyle = rgba('blood', 0.85); c.lineWidth = 2.5; c.strokeRect(BIG.x + 10, BIG.y + 10, BIG.w - 20, BIG.h - 20);
    c.lineWidth = 1; c.strokeRect(BIG.x + 16, BIG.y + 16, BIG.w - 32, BIG.h - 32);
    const m = this.msg;
    if (m?.couple) mono(c, 'FROM THE COUPLE', BIG.x + BIG.w / 2, BIG.y + 44, { size: 13, tracking: 4, color: rgba('blood', 0.8), align: 'center', weight: 600 });
    const by = BIG.y + BIG.h - CARD_PAD.bside - CARD_PAD.band - 8;
    c.fillStyle = rgba('blood', 0.9); c.fillRect(BIG.x + 16, by, BIG.w - 32, CARD_PAD.band);
    c.textAlign = 'center';
    c.font = font(F.hei(500), 17); c.fillStyle = rgba('sepia', 0.65);
    c.fillText(`B 面　永遠的 ${song.title}`, BIG.x + BIG.w / 2, BIG.y + BIG.h - 20);
    c.textAlign = 'left';
    c.restore();
    // 喇叭的鉻框與十字的鉻條
    c.strokeStyle = rgba('ash', 0.45); c.lineWidth = 6; c.beginPath(); c.arc(SPK.x, SPK.y, SPK.r + 8, 0, TAU); c.stroke();
    c.strokeStyle = rgba('bone', 0.12); c.lineWidth = 1.5; c.beginPath(); c.arc(SPK.x, SPK.y, SPK.r + 11, Math.PI * 1.1, Math.PI * 1.7); c.stroke();
    // 泡泡管的玻璃與上下的鉻蓋
    for (const tb of TUBES) {
      c.fillStyle = rgba('ink2', 0.9); c.fillRect(tb.x - 13, tb.y0, 26, tb.y1 - tb.y0);
      c.strokeStyle = rgba('ash', 0.35); c.lineWidth = 1.5; c.strokeRect(tb.x - 13, tb.y0, 26, tb.y1 - tb.y0);
      c.fillStyle = rgba('graphite', 0.9); c.fillRect(tb.x - 18, tb.y0 - 14, 36, 14); c.fillRect(tb.x - 18, tb.y1, 36, 14);
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const land = this.tk[5]!;
    this.bg.u.k!.value = 1;
    this.bg.u.glow!.value = 0.6 + 0.6 * prog(t, land, land + 0.4) + 0.25 * f.a.kick;
    this.bg.u.t!.value = t;
    this.bg.render(renderer, out);
    comp.draw(renderer, this.still.texture, out);
    const L = this.layer, Hh = this.hot;
    L.clear(); Hh.clear();
    const c = L.ctx, hc = Hh.ctx;
    // 每一格從同樣的畫布狀態開始（線頭、對齊、字距…不會被上一格留下來的設定影響）
    c.save(); hc.save();
    c.save(); hc.save();
    // 機構只畫在玻璃窗裡
    for (const cc of [c, hc]) { cc.beginPath(); cc.roundRect(WIN.x + 6, WIN.y + 6, WIN.w - 12, WIN.h - 12, 54); cc.clip(); }
    // 這一格有韓文原文：機構往下挪，玻璃上緣空出一條印原文（整格固定，不跟著句子跳；沒有原文時是 0，畫面照舊）
    const room = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => lyricSubOf(l)) ? SUB_ROOM : 0;
    if (room) for (const cc of [c, hc]) cc.translate(0, room);
    // 鏡頭：整個窗格慢慢往右平移；唱片落下的那一拍推近一點（強烈緩動）
    const pan = ease.inOutCubic(clamp((t - this.ctx.start) / Math.max(1, this.ctx.end - this.ctx.start)));
    const push = prog(t, land, land + 0.5, ease.outExpo);
    setCam(CAM0.x + 90 * pan, CAM0.y - 20 * push, CAM0.z - 70 * push);
    this.mechanism(c, hc, t, f);
    c.restore(); hc.restore();
    this.glass(c, hc, t);
    this.fixtures(c, hc, t, f);
    this.cards(c, hc, t, f);
    c.restore(); hc.restore();
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, Hh.upload(), out, { mode: 'add', tint: [2, 2, 2] });
    const clack = this.tk[2]! <= t && t < this.tk[2]! + 0.12 ? 1 : 0;
    void s;
    return { bloom: 0.75, vignette: 0.5, halation: 0.3, shake: [0, clack * 1.2], zoom: 1 + 0.004 * f.a.kick, popupAvoid: this.avoid };
  }

  // ------------------------------------------------------------ 機構
  private mechanism(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, f: Frame) {
    const au = this.ctx.audio;
    const [t0, t1, t2, t3, t4, t5] = this.tk as [number, number, number, number, number, number];
    const px = rackX(this.pick);
    // 天車（上面橫樑上的小車）：第一拍滑到這張唱片上面，第三拍之後載著唱片滑到轉盤上面
    const trX = t < t3 ? lerp(this.carFrom, px, prog(t, t0 - 0.02, t1, ease.outExpo)) : lerp(px, TT.x, prog(t, t3, t4, ease.inOutCubic));
    const grip = prog(t, t1, t2, ease.inCubic); // 夾爪往下、夾住唱片中心（第二拍「喀」）
    // 桿子的下端：一開始收在上面，夾住時伸到唱片中心；抽起；移過去的時候往下到轉盤上方；落下；放開後收回去
    const lift = prog(t, t2, t3, ease.outCubic);
    const move = prog(t, t3, t4, ease.inOutCubic);
    const drop = prog(t, t4, t5, ease.inCubic);
    const back = prog(t, t5, t5 + 0.35, ease.outCubic);
    const holdY = t < t2 ? lerp(BEAM_Y - 24, 0, grip) : t < t3 ? lerp(0, 58, lift) : t < t4 ? lerp(58, TT.y + 90, move) : t < t5 ? lerp(TT.y + 90, TT.y + 10, drop) : lerp(TT.y + 10, BEAM_Y - 24, back);
    const holding = t >= t2 && t < t5;
    // 唱片：夾住之後跟著桿子走，移過去的時候翻平
    const phi = (move * Math.PI) / 2;
    const recC: V3 = t < t5 ? [trX, holdY, RACK_Z] : [TT.x, TT.y + 10, RACK_Z];
    const playing = t >= t5;
    const spin = playing ? (au.beatAt(t) - au.beatAt(t5)) * (Math.PI / 2) : 0;
    // 碟面的兩個軸：立著的時候是 y、z；平躺的時候是 x、z（轉起來繞 y 轉）
    const u0: V3 = [-Math.sin(phi), Math.cos(phi), 0], v0: V3 = [0, 0, 1];
    const cs = Math.cos(spin), sn = Math.sin(spin);
    const U: V3 = [u0[0] * cs + v0[0] * sn, u0[1] * cs + v0[1] * sn, u0[2] * cs + v0[2] * sn];
    const Vv: V3 = [-u0[0] * sn + v0[0] * cs, -u0[1] * sn + v0[1] * cs, -u0[2] * sn + v0[2] * cs];

    // ---- 橫樑（天車的軌道）與兩根吊柱
    const beamA = proj([rackX(0) - 70, BEAM_Y, RACK_Z]), beamB = proj([TT.x + 90, BEAM_Y, RACK_Z]);
    for (const bx of [rackX(0) - 50, TT.x + 70]) {
      const a = proj([bx, BEAM_Y, RACK_Z]), b = proj([bx, BEAM_Y + 400, RACK_Z]);
      c.strokeStyle = rgba('graphite', 0.8); c.lineWidth = 5; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    c.strokeStyle = rgba('graphite', 0.95); c.lineWidth = 9; c.beginPath(); c.moveTo(beamA.x, beamA.y); c.lineTo(beamB.x, beamB.y); c.stroke();
    c.strokeStyle = rgba('ash', 0.45); c.lineWidth = 1.2; c.beginPath(); c.moveTo(beamA.x, beamA.y - 4); c.lineTo(beamB.x, beamB.y - 4); c.stroke();
    // ---- 架子的底座
    const railA = proj([rackX(0) - 60, RAIL_Y, RACK_Z]), railB = proj([rackX(N - 1) + 60, RAIL_Y, RACK_Z]);
    c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 6; c.beginPath(); c.moveTo(railA.x, railA.y); c.lineTo(railB.x, railB.y); c.stroke();
    c.strokeStyle = rgba('ash', 0.35); c.lineWidth = 1.2; c.beginPath(); c.moveTo(railA.x, railA.y - 3); c.lineTo(railB.x, railB.y - 3); c.stroke();
    // ---- 唱片：由外往內畫（離鏡頭遠的先畫，才會被近的擋住）
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => Math.abs(rackX(b) - CAM.x) - Math.abs(rackX(a) - CAM.x));
    for (const i of order) {
      if (i === this.pick && t >= t2) continue;
      this.disc(c, hc, [rackX(i), 0, RACK_Z], [0, 1, 0], [0, 0, 1], RR, this.labels[i]!, false, 0);
    }
    // ---- 轉盤：盤座、盤面、邊緣的頻閃點（跟著拍子轉）
    const plinth = ring([TT.x, TT.y - 16, RACK_Z], [1, 0, 0], [0, 0, 1], TT.r + 26, 48);
    c.fillStyle = rgba('ink2'); path(c, plinth); c.fill();
    c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 1.5; c.stroke();
    const plat = ring([TT.x, TT.y, RACK_Z], [1, 0, 0], [0, 0, 1], TT.r, 48);
    c.fillStyle = mixRgba('ink2', 'graphite', 0.25); path(c, plat); c.fill();
    c.strokeStyle = rgba('ash', 0.6); c.lineWidth = 1.4; c.stroke();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU + spin;
      const q = proj([TT.x + Math.cos(a) * (TT.r - 6), TT.y + 1, RACK_Z + Math.sin(a) * (TT.r - 6)]);
      c.fillStyle = rgba('ash', 0.5); c.fillRect(q.x - 1, q.y - 1, 2, 2);
    }
    // 被選的唱片（抽起之後單獨畫，在最前面）
    if (t >= t2) this.disc(c, hc, recC, U, Vv, RR, 'signal', true, move);
    // ---- 天車與伸縮桿、夾爪
    const top = proj([trX, BEAM_Y, RACK_Z]), bot = proj([trX, holdY, RACK_Z]);
    const tw = (FOCAL * 30) / top.z;
    c.strokeStyle = rgba('ash', 0.85); c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(top.x, top.y); c.lineTo(bot.x, bot.y); c.stroke();
    c.strokeStyle = rgba('bone', 0.35); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(top.x - 1.5, top.y); c.lineTo(bot.x - 1.5, bot.y); c.stroke();
    c.fillStyle = rgba('ink2'); c.strokeStyle = rgba('ash', 0.8); c.lineWidth = 1.6;
    c.beginPath(); c.roundRect(top.x - tw, top.y - tw * 0.5, tw * 2, tw, 5); c.fill(); c.stroke();
    // 夾爪：兩片小爪，夾住時往內收
    const open = holding ? 5 : lerp(16, 6, grip);
    c.strokeStyle = rgba('bone', 0.85); c.lineWidth = 3;
    for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(bot.x + sd * 4, bot.y - 10); c.lineTo(bot.x + sd * open, bot.y + 8); c.stroke(); }
    // 天車上的指示燈：動作中亮
    const busy = t >= t0 && t < t5 + 0.3;
    c.fillStyle = rgba('signal', busy ? 1 : 0.35); c.beginPath(); c.arc(top.x, top.y, 3.5, 0, TAU); c.fill();
    if (busy) { hc.fillStyle = rgba('signal', 0.9); hc.beginPath(); hc.arc(top.x, top.y, 5, 0, TAU); hc.fill(); }
    // ---- 唱臂：唱片落下後擺進來
    const armIn = prog(t, t5, t5 + au.beatPeriod(t) * 1.2, ease.inOutCubic);
    const pv: V3 = [TT.x + 215, TT.y + 30, RACK_Z - 60];
    // 停在盤子外面（朝鏡頭），唱片落下後擺到溝紋上
    const ang = lerp(1.4, 0.36, armIn);
    const tip: V3 = [pv[0] - Math.cos(ang) * 180, pv[1] - 18 * armIn, pv[2] + Math.sin(ang) * 180];
    const pp = proj(pv), tp = proj(tip);
    c.fillStyle = rgba('graphite'); c.beginPath(); c.arc(pp.x, pp.y, 12, 0, TAU); c.fill();
    c.strokeStyle = rgba('bone', 0.8); c.lineWidth = 4; c.beginPath(); c.moveTo(pp.x, pp.y); c.lineTo(tp.x, tp.y); c.stroke();
    c.fillStyle = rgba('bone', 0.9); c.fillRect(tp.x - 9, tp.y - 5, 18, 10);
    void f;
  }

  /** 一張唱片：黑色的碟、幾圈溝紋的反光、標籤（被選的那張是訊號色，轉起來有一道固定的反光扇形）。 */
  private disc(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, ctr: V3, u: V3, v: V3, r: number, label: string, chosen: boolean, flat: number) {
    const edge = ring(ctr, u, v, r, 44);
    c.fillStyle = rgba('ink'); path(c, edge); c.fill();
    c.strokeStyle = chosen ? rgba('bone', 0.7) : rgba('ash', 0.32); c.lineWidth = chosen ? 1.6 : 1; c.stroke();
    // 溝紋：幾圈很淡的線
    c.strokeStyle = rgba('ash', chosen ? 0.16 : 0.08); c.lineWidth = 1;
    for (const k of chosen ? [0.9, 0.8, 0.7, 0.6, 0.5] : [0.75]) { path(c, ring(ctr, u, v, r * k, 36)); c.stroke(); }
    const lab = ring(ctr, u, v, r * 0.34, 28);
    c.fillStyle = chosen ? rgba('signal', 0.95) : rgba(label, label === 'graphite' ? 0.7 : 0.55);
    path(c, lab); c.fill();
    if (chosen) {
      hc.fillStyle = rgba('signal', 0.35); path(hc, lab); hc.fill();
      // 標籤上的一條線（看得出在轉）
      const a = proj([ctr[0] + u[0] * r * 0.3, ctr[1] + u[1] * r * 0.3, ctr[2] + u[2] * r * 0.3]), o = proj(ctr);
      c.strokeStyle = rgba('ink', 0.8); c.lineWidth = 2; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(a.x, a.y); c.stroke();
      if (flat > 0.95) {
        // 平躺的時候：溝紋上一道固定的反光（兩個對面的扇形）
        const o2 = proj(ctr);
        c.save(); path(c, edge); c.clip();
        for (const sd of [-1, 1]) {
          const g = c.createLinearGradient(o2.x, o2.y, o2.x + sd * 160, o2.y - sd * 20);
          g.addColorStop(0, rgba('bone', 0)); g.addColorStop(0.5, rgba('bone', 0.12)); g.addColorStop(1, rgba('bone', 0));
          c.fillStyle = g;
          c.beginPath(); c.moveTo(o2.x, o2.y); c.lineTo(o2.x + sd * 200, o2.y - 40); c.lineTo(o2.x + sd * 200, o2.y + 30); c.closePath(); c.fill();
        }
        c.restore();
      }
    }
    const o = proj(ctr);
    c.fillStyle = rgba('ink'); c.beginPath(); c.arc(o.x, o.y, 2.2, 0, TAU); c.fill();
  }

  // ------------------------------------------------------------ 玻璃上的歌詞
  private glass(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: F.archivo(100, 800), size: this.lyrSize, minSize: V2.lyrMin, maxWidth: LYR.w, align: 'center' as const, lineHeight: 1.1 };
      const full = this.layLyric(ly.line);
      // 原文不畫在預設的位置（中文正下方就是鉻框），另外印在玻璃上緣
      const lay = full.sub ? { ...full, sub: undefined } : full;
      const oy = LYR.y - (lay.rows.length > 1 ? lay.size * 0.5 : 0) + (1 - ease.outExpo(ly.k)) * 12;
      c.save(); c.translate(960, oy); drawLyric(c, ly.line, t, st, lay, ly.k); c.restore();
      hc.save(); hc.translate(960, oy); drawLyric(hc, ly.line, t, { ...st, sung: 'rgba(0,0,0,0)', unsung: 'rgba(0,0,0,0)', active: rgba('signal', 0.7) }, lay, ly.k); hc.restore();
      const orig = full.sub ? lyricSubOf(ly.line) : null;
      if (orig) { c.save(); c.translate(960, SUB_Y + (1 - ease.outExpo(ly.k)) * 12); drawLyricSub(c, orig, t, st, lay.size, ly.k); c.restore(); }
    } else if (!lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).length) {
      c.font = font(F.archivo(100, 800), this.lyrSize); c.fillStyle = rgba('bone', 0.9); c.textAlign = 'center';
      fillWithHearts(c, song.title, 960, LYR.y);
      c.textAlign = 'left';
    }
  }

  // ------------------------------------------------------------ 泡泡管、喇叭
  /** 兩支泡泡管：泡泡一直往上冒（一拍冒兩顆），管子的燈一拍換一個色（訊號色 ↔ 暗部）；喇叭的布面大鼓一打就鼓一下。 */
  private fixtures(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, f: Frame) {
    const au = this.ctx.audio;
    const bt = au.beatAt(t);
    TUBES.forEach((tb, k) => {
      const len = tb.y1 - tb.y0;
      const hot = (Math.floor(bt + 1e-4) + k) % 2 === 0;
      const g = c.createLinearGradient(0, tb.y0, 0, tb.y1);
      g.addColorStop(0, rgba(hot ? 'signal' : 'blood', 0.55)); g.addColorStop(1, rgba(hot ? 'ember' : 'signal', 0.4));
      c.fillStyle = g; c.fillRect(tb.x - 10, tb.y0, 20, len);
      hc.fillStyle = rgba('signal', hot ? 0.35 : 0.18); hc.fillRect(tb.x - 12, tb.y0, 24, len);
      // 泡泡：每顆從底部冒出來、越往上越快，左右微微晃
      for (let i = 0; i < 12; i++) {
        const ph = (bt * 0.5 + i / 12 + k * 0.37) % 1;
        const y = tb.y1 - 8 - ph * ph * (len - 16);
        const x = tb.x + Math.sin(ph * 9 + i) * 3;
        c.strokeStyle = rgba('bone', 0.75 * (1 - ph * 0.5)); c.lineWidth = 1.4;
        c.beginPath(); c.arc(x, y, 3 + 2 * hash(i, k), 0, TAU); c.stroke();
      }
    });
    // 喇叭：布面（同心的細紋），大鼓一打整片鼓起來一點
    const bump = 1 + 0.035 * f.a.kick + 0.02 * f.a.low;
    const r = SPK.r * bump;
    const g = c.createRadialGradient(SPK.x - 30, SPK.y - 30, 10, SPK.x, SPK.y, r);
    g.addColorStop(0, rgba('graphite', 0.55)); g.addColorStop(1, rgba('ink2', 0.95));
    c.fillStyle = g; c.beginPath(); c.arc(SPK.x, SPK.y, r, 0, TAU); c.fill();
    c.strokeStyle = rgba('ash', 0.12); c.lineWidth = 1;
    for (let rr = 12; rr < r; rr += 9) { c.beginPath(); c.arc(SPK.x, SPK.y, rr, 0, TAU); c.stroke(); }
    c.strokeStyle = rgba('ash', 0.4); c.lineWidth = 4;
    c.beginPath(); c.moveTo(SPK.x - r, SPK.y); c.lineTo(SPK.x + r, SPK.y); c.moveTo(SPK.x, SPK.y - r); c.lineTo(SPK.x, SPK.y + r); c.stroke();
    c.fillStyle = rgba('graphite', 0.9); c.beginPath(); c.arc(SPK.x, SPK.y, 16, 0, TAU); c.fill();
  }

  // ------------------------------------------------------------ 選曲卡
  private cards(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, f: Frame) {
    const m = this.msg, fit = this.fit!, BIG = this.card;
    c.save();
    c.translate(BIG.x + BIG.w / 2, BIG.y + BIG.h / 2); c.rotate(-0.006); c.translate(-(BIG.x + BIG.w / 2), -(BIG.y + BIG.h / 2));
    // A 面：留言一個字一個字印上去（剛印的是訊號色的暗部，很快變墨色）
    c.font = font(m ? FAM_MSG : F.hand(400), fit.size);
    for (const g of this.glyphs) {
      if (t < g.t) break;
      const heat = 1 - clamp((t - g.t) / 0.4);
      const base = g.ch === '♥' ? 'rose' : 'sepia';
      fillGlyph(c, g.ch, g.x, g.y, heat > 0 ? mixRgba(base, 'blood', heat) : rgba(base, m ? 1 : 0.8));
    }
    if (!m) {
      c.font = font(F.hei(700), 18); c.fillStyle = rgba('sepia', 0.5); c.textAlign = 'center';
      c.fillText(EMPTY, BIG.x + BIG.w / 2, BIG.y + 40);
      c.textAlign = 'left';
    }
    // 色帶上的署名
    if (m && t >= this.sigT) {
      c.save(); c.globalAlpha = prog(t, this.sigT, this.sigT + 0.25);
      c.font = font(F.hei(700), this.sigSize); c.fillStyle = rgba('paper'); c.textAlign = 'center';
      c.fillText(this.sig, BIG.x + BIG.w / 2, BIG.y + BIG.h - CARD_PAD.bside - 8 - CARD_PAD.band / 2 + this.sigSize * 0.36);
      c.restore();
    }
    c.restore();
    void hc; void f;
  }
}
