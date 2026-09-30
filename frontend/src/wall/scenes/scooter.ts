// 騎機車（暗、date、日常服一）：台灣的夜晚街道，宣文騎一台奶油白的速克達載孟庭，三隻狗都在前面的腳踏板上：
// 芃芃和 QQ 站在前排，元元（白色柴犬，比博美大）坐在牠們後面、頭從兩隻博美上方探出來——騎車時迎著風笑、
// 孟庭指招牌時跟著抬頭往上看、停紅燈時轉頭看著兩個人（三張圖各一個表情，由 Codex 直接畫在機車那張圖裡）。
// 角色（連同機車）是 Codex 畫的紙偶（cp_scooter_1～3，_puppet.ts），街景、招牌、看板、紅綠燈是程式畫的。
//  - 側面跟拍：機車停在畫面左邊，街景往左捲——路面的虛線最快、騎樓一排老房子（鐵窗、冷氣、捲門、亮著的店面）中等、
//    遠處的大樓與屋頂上的招牌幾乎不動（視差）。路燈照拍子經過（每兩拍一盞），經過時一道暖光掃過兩個人。
//  - 機車跟著拍子輕輕顛（每拍一下、大鼓時車身壓一下）；每一句歌詞開始時宣文往上指招牌（cp_scooter_2）。
//  - 窗格夠長（6 小節以上）時中間停一次紅燈：前一拍煞車、小節線上停住（宣文放腳、兩人對看，cp_scooter_3），
//    紅綠燈旁的小秒數照拍子倒數，下一個小節線變綠燈、再出發。
//  - **焦點是主打留言**：寫在右上方遠處屋頂的大看板上（燈從下面打上來、鋼架、兩支腳），第一拍燈閃一下亮起、字一個一個出現；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、署名 26～32，看板最大 640 × 330，寬高跟著留言。沒有留言時看板寫邀請（字小、淡）。
//  - 歌詞：左上遠處屋頂的霓虹招牌，唱到的字亮成訊號色、唱完是亮著的燈管、還沒唱是沒點亮的燈管；換句時燈管閃一下點亮。比留言小一級。
//  - 右下角 HUD 區：路面的虛線往右淡掉，保持乾淨。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, barAfter, beatAfter, sparkHead, sparkParticles, msgChars, lyricSubOf, type LyricStyle } from './_motifs';
import { drawNote, type Note } from './_couple';
import { loadPuppets, drawPick, puppetShadow, puppetIn, breathe, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';
import { mixC, LitStage } from './_c4';

export const spec: PlateSpecDecl = { group: 'couple', family: 'date', paper: false, energy: [0.35, 1], bars: [4, 8] };

/** 路面（輪子著地的 y）、人行道邊、騎樓地面。 */
const ROAD = 905, CURB = 812, ARCADE = 772;
const SZ = 520;
/** 機車停在畫面上的位置（腳底錨點 x）。 */
const SX = 540;
/** 路面捲動的速度（px／秒）與各層的視差。 */
const V = 330, P_MID = 0.34, P_FAR = 0.02;
/** 屋頂的大看板（右上）：右緣、上緣、最大的寬高（標準 v2）與寫字的內距。 */
const BOARD = { right: 1800, top: 96, w: 640, h: 330 };
const PAD = { x: 34, top: 30, bottom: 30 };
/** 霓虹招牌（左上）：左緣、基線、最大寬。 */
const NEON = { x: 130, y: 196, w: 860 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['cp_scooter_1', 'cp_scooter_2', 'cp_scooter_3'];

/** 夜空：上面深藍黑、地平線一層城市的光害（暖）。 */
const SKY = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float y = p.y / ${H}.0;
    vec3 col = mix(C_INK, mix(C_INK2, C_BLOOD, 0.3), smoothstep(0.05, 0.62, y));
    col += C_SIGNAL * 0.03 * exp(-pow((p.y - 470.0) / 170.0, 2.0));
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

interface Bldg { x: number; w: number; floors: number; lit: number[]; shop: number; sign: number; ac: number[] }
interface Stop { t0: number; t1: number; t2: number; t3: number; x: number }

export default class Scooter extends Scene {
  sky = shared('scooter.sky', SKY);
  /** 遠處的天際線（畫一次，寬一點：整個窗格慢慢往左漂）。 */
  far = this.track(new Layer2D(W + 480, H, 1, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  neonGlow = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  board = { x: BOARD.right - BOARD.w, y: BOARD.top, w: BOARD.w, h: BOARD.h };
  lyricSize = 48;
  /** 韓文歌（這一格有原文副行）：招牌多一排小燈管，鋼架與下面那棟樓往下移這麼多（整格固定，換句時樓不會跳）。 */
  subDrop = 0;
  bldgs: Bldg[] = [];
  keys: [number, string][] = [];
  stop: Stop | null = null;
  /** 路燈：世界座標（路面的 px），每兩拍經過機車一盞。 */
  lamps: number[] = [];
  msgT0 = 0;
  /** 紙偶的打光台（機車＋兩個人＋兩隻狗那一塊）。 */
  stage = new LitStage(SZ * 1.45, SZ * 1.25);

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + '0123456789');
    this.track(await loadPuppets(SPRITES));
    const bp = au.beatPeriod(s);
    // 紅燈：窗格有 6 小節以上時，中間的小節線停住、下一個小節線綠燈再出發
    const b0 = Math.ceil(au.barAt(s + 0.2) - 1e-6);
    const nb = Math.floor(au.barAt(e) - b0);
    if (nb >= 6) {
      const k = b0 + Math.floor(nb / 2);
      const t1 = au.timeOfBar(k), t2 = au.timeOfBar(k + 1);
      this.stop = { t0: t1 - bp * 1.2, t1, t2, t3: t2 + bp * 1.2, x: 0 };
      // 停車線：機車前輪停在停車線前一點點（世界座標 = 停下來那一刻的捲動距離 + 前輪在畫面上的位置）
      this.stop.x = this.scroll(t1) + SX + SZ * 0.58;
    }
    // 路燈：每兩拍經過機車一盞（全速時），第一盞在第一拍經過
    const phase = V * (beatAfter(au, s + 0.1) - s);
    for (let k = -2; k < 60; k++) this.lamps.push(SX + phase + k * V * bp * 2);
    // 騎樓的老房子：寬、樓層、亮燈的窗、店面、招牌、冷氣都用種子
    const seed = (this.ctx.params.seed ?? 3) as number;
    let x = -300;
    for (let i = 0; i < 60 && x < this.scroll(e) * P_MID + W + 400; i++) {
      const w = 190 + 130 * hash(i, seed, 1);
      this.bldgs.push({
        x, w, floors: hash(i, seed, 2) < 0.6 ? 2 : 1,
        lit: [hash(i, seed, 3), hash(i, seed, 4), hash(i, seed, 5), hash(i, seed, 6)],
        shop: hash(i, seed, 7), sign: hash(i, seed, 8), ac: [hash(i, seed, 9), hash(i, seed, 10)],
      });
      x += w + 6;
    }
    // 姿勢：平常 scooter_1；每一句歌詞開始時（對到最近的拍點）宣文往上指招牌一拍半；紅燈時放腳、兩人對看
    const ks: [number, string][] = [[-1e9, 'cp_scooter_1']];
    const { lyrics } = this.ctx;
    if (lyrics.linesIn(s, e).some((l) => lyricSubOf(l))) this.subDrop = 92;
    const points: number[] = [];
    if (lyrics.has) {
      for (const ln of lyrics.linesIn(s + 0.6, e - bp * 2)) points.push(au.timeOfBeat(Math.round(au.beatAt(ln.start))));
    } else {
      for (let t = barAfter(au, s + 0.5); t < e - bp * 2; t = au.timeOfBar(Math.round(au.barAt(t)) + 2)) points.push(t);
    }
    const events: [number, string][] = [];
    for (const p of points) {
      if (this.stop && p > this.stop.t0 - bp && p < this.stop.t3) continue;
      events.push([p, 'cp_scooter_2'], [p + bp * 1.5, 'cp_scooter_1']);
    }
    if (this.stop) events.push([this.stop.t1, 'cp_scooter_3'], [this.stop.t2, 'cp_scooter_1']);
    events.sort((a, b) => a[0] - b[0]);
    for (const ev of events) ks.push(ev);
    this.keys = ks;

    // 看板上的留言：標準 v2 的字級；看板的寬高跟著留言（右緣、上緣固定）
    const c = this.fg.ctx;
    const tw = 540, th = BOARD.h - PAD.top - PAD.bottom;
    const fam = F.ming(600);
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th, { family: fam }) : noteV2(c, INVITE, null, tw, th * 0.5, { max: 40, family: fam });
    const bw = Math.min(BOARD.w, tightenNote(c, this.note, 300) + PAD.x * 2);
    const bh = Math.min(BOARD.h, Math.max(170, PAD.top + this.note.height + PAD.bottom + 8));
    this.board = { x: BOARD.right - bw, y: BOARD.top, w: bw, h: bh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.35);
    this.drawFar();
  }

  /** 路面捲過去的距離（px）：全速 V；紅燈前一拍線性煞車、停一小節、綠燈後一拍加速回全速。 */
  private scroll(t: number): number {
    const s = this.ctx.start;
    let d = V * (t - s);
    const st = this.stop;
    if (!st || t <= st.t0) return d;
    const d1 = st.t1 - st.t0, d3 = st.t3 - st.t2;
    if (t <= st.t1) { const u = t - st.t0; return d - (V * u * u) / (2 * d1); }
    d -= (V * d1) / 2;
    if (t <= st.t2) return d - V * (t - st.t1);
    d -= V * (st.t2 - st.t1);
    if (t <= st.t3) { const u = t - st.t2; return d - (V * u - (V * u * u) / (2 * d3)); }
    return d - (V * d3) / 2;
  }

  /** 現在的速度（0..1）：顛簸、風、速度線跟著它。 */
  private speed(t: number): number {
    const st = this.stop;
    if (!st || t <= st.t0 || t >= st.t3) return 1;
    if (t <= st.t1) return 1 - (t - st.t0) / (st.t1 - st.t0);
    if (t <= st.t2) return 0;
    return (t - st.t2) / (st.t3 - st.t2);
  }

  /** 遠處的天際線：高高低低的大樓剪影、零星亮著的窗、屋頂的水塔與天線（畫一次，比畫面寬，窗格裡慢慢往左漂）。 */
  private drawFar() {
    const L = this.far, c = L.ctx;
    L.clear();
    const seed = 11;
    let x = -20;
    for (let i = 0; x < W + 500; i++) {
      const w = 90 + 160 * hash(i, seed, 1);
      const top = 300 + 170 * hash(i, seed, 2);
      c.fillStyle = mixRgba('ink', 'ink2', 0.5 + 0.5 * hash(i, seed, 3));
      c.fillRect(x, top, w, ARCADE - top);
      // 屋頂：水塔或天線
      if (hash(i, seed, 4) < 0.5) { c.fillRect(x + w * 0.3, top - 22, 30, 22); c.fillRect(x + w * 0.3 + 12, top - 34, 6, 12); }
      else { c.fillRect(x + w * 0.6, top - 40, 3, 40); }
      // 零星亮著的窗
      for (let r = 0; r < 12; r++) for (let k = 0; k < 6; k++) {
        const wx = x + 12 + k * 22, wy = top + 16 + r * 26;
        if (wx > x + w - 16 || wy > 640) continue;
        const hh = hash(i, r, k, seed);
        if (hh < 0.86) continue;
        c.fillStyle = rgba('signal', 0.1 + 0.18 * hash(i, r, k, 5));
        c.fillRect(wx, wy, 10, 13);
      }
      x += w + 4;
    }
    L.upload();
  }

  /** 路面：騎樓地面、人行道、柏油（往下越暗）、路緣石。虛線、斑馬線另外畫（跟著捲）。 */
  private drawRoad(c: CanvasRenderingContext2D) {
    // 騎樓與人行道的地面
    c.fillStyle = mixRgba('ink2', 'bone', 0.03);
    c.fillRect(0, ARCADE, W, CURB - ARCADE);
    // 柏油路：往畫面下方越暗
    const g = c.createLinearGradient(0, CURB, 0, H);
    g.addColorStop(0, mixRgba('ink2', 'ash', 0.08));
    g.addColorStop(1, rgba('ink'));
    c.fillStyle = g;
    c.fillRect(0, CURB, W, H - CURB);
    // 路緣石
    c.fillStyle = mixRgba('ink2', 'bone', 0.1);
    c.fillRect(0, CURB - 6, W, 8);
    c.strokeStyle = rgba('bone', 0.14);
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, CURB + 2); c.lineTo(W, CURB + 2); c.stroke();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const S = this.scroll(t), sp = this.speed(t);
    this.glow.clear();
    this.sky.render(renderer, out);
    // 遠處的天際線：畫布比畫面寬 480 px，照遠景的視差往左漂
    const drift = Math.min(480, S * P_FAR * 2 + 60);
    comp.draw(renderer, this.far.texture, out, { scale: [W / (W + 480), 1], offset: [(drift + W / 2) / (W + 480) - 0.5, 0] });

    const L = this.fg; L.clear();
    const c = L.ctx;
    // ---- 遠處屋頂：霓虹招牌（歌詞）與大看板（留言），幾乎不動
    const farX = -S * P_FAR;
    this.drawNeon(c, t, farX);
    this.drawBoard(c, t, farX);
    // ---- 騎樓的老房子（中景）
    this.drawStreet(c, t, S * P_MID);
    // ---- 路面、路燈、機車（前景）
    this.drawRoad(c);
    this.drawRoadMarks(c, S);
    this.drawLamps(c, t, S, true);
    this.drawSignal(c, t, S);
    this.drawRider(c, t, S, sp);
    this.drawLamps(c, t, S, false);
    this.drawWind(c, t, sp);
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, this.neonGlow.upload(), out, { mode: 'add', tint: [1.7, 1.7, 1.7] });
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.8, vignette: 0.5, zoom: 1 + 0.025 * push + 0.003 * f.a.kick, shake: [-(BOARD.right - 360 - W / 2) * 0.025 * push, -(BOARD.top + 160 - H / 2) * 0.025 * push] };
  }

  /** 霓虹招牌上的歌詞：還沒唱是沒點亮的燈管、唱到的字訊號色、唱完亮著；換句時燈管閃兩下點亮。光暈畫在低解析度的一層、相加上去。 */
  private drawNeon(c: CanvasRenderingContext2D, t: number, dx: number) {
    const { lyrics } = this.ctx;
    const G = this.neonGlow, g = G.ctx;
    G.clear();
    const ly = lyricAt(lyrics, t);
    const x0 = NEON.x + dx;
    // 招牌下面的那棟樓（遠景，跟招牌一起幾乎不動）：屋頂上兩支鋼架撐著招牌、零星亮著的窗
    // （韓文歌：招牌下面多一排原文的小燈管，鋼架與樓整個往下移 subDrop）
    const sd = this.subDrop;
    const roof = NEON.y + 74 + sd;
    c.save();
    c.fillStyle = mixRgba('ink', 'ink2', 0.8);
    c.fillRect(x0 - 50, roof, NEON.w + 100, ARCADE - roof);
    for (let r = 0; r < 5; r++) for (let k = 0; k < 14; k++) {
      if (hash(r, k, 21) < 0.8) continue;
      c.fillStyle = rgba('signal', 0.08 + 0.14 * hash(r, k, 22));
      c.fillRect(x0 - 20 + k * 64, roof + 26 + r * 38, 20, 18);
    }
    c.fillStyle = rgba('ink2');
    for (const lx of [x0 + 60, x0 + NEON.w * 0.5, x0 + NEON.w - 60]) c.fillRect(lx - 4, NEON.y + 18 + sd, 8, roof - NEON.y - 18 - sd);
    c.fillRect(x0 - 20, NEON.y + 16 + sd, NEON.w + 40, 6);
    c.restore();
    if (!ly) return;
    const st: LyricStyle = { family: F.hei(700), size: this.lyricSize, minSize: 40, maxWidth: NEON.w, align: 'left' };
    const lay = layoutLyric(c, ly.line, st);
    // 換句：燈管在這句開始前閃兩下點亮
    const on = t - (ly.line.start - 0.35);
    const flick = on < 0.25 ? (Math.floor(on / 0.06) % 2 ? 0.3 : 1) : 1;
    const a = ly.k * flick;
    // （有原文時 lay.height 算到原文最後一排：整組一起置中，中心往下挪一點，第一排才不會太貼上緣）
    const y0 = NEON.y + (sd ? 22 : 0) - (lay.height - lay.size) * 0.5;
    c.save();
    c.font = font(st.family, lay.size);
    g.save();
    g.font = font(st.family, lay.size);
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      const x = x0 + pw.x, y = y0 + pw.y;
      // 燈管本身：沒點亮的是暗暗的玻璃管
      c.globalAlpha = a;
      c.fillStyle = rgba('bone', 0.16);
      if (p < 1) c.fillText(pw.word.w, x, y);
      if (p <= 0) continue;
      const col = p < 1 ? rgba('signal') : mixRgba('bone', 'signal', 0.25);
      c.save();
      c.beginPath(); c.rect(x - 4, y - lay.size * 1.1, (pw.w + 8) * p, lay.size * 1.5); c.clip();
      c.fillStyle = col;
      c.fillText(pw.word.w, x, y);
      c.restore();
      // 光暈：亮著的字畫在光暈層（低解析度、相加）
      g.globalAlpha = a * (p < 1 ? 0.9 : 0.5);
      g.fillStyle = p < 1 ? rgba('signal') : rgba('signal', 0.7);
      g.save();
      g.beginPath(); g.rect(x - 4, y - lay.size * 1.1, (pw.w + 8) * p, lay.size * 1.5); g.clip();
      g.fillText(pw.word.w, x, y);
      g.restore();
    }
    // 原文（韓文歌）：中文正下方一排小一號的燈管，逐字時間是原文自己的；比中文安靜——唱到、唱完都是「亮著的燈管」色、淡兩成，光暈也淡
    const sl = lay.sub;
    if (sl) {
      c.font = font(st.family, sl.lay.size); g.font = font(st.family, sl.lay.size);
      for (const pw of sl.lay.words) {
        const p = Lyrics.wordProgress(pw.word, t);
        const x = x0 + pw.x, y = y0 + sl.dy + pw.y;
        c.globalAlpha = a;
        c.fillStyle = rgba('bone', 0.16);
        if (p < 1) c.fillText(pw.word.w, x, y);
        if (p <= 0) continue;
        c.save();
        c.beginPath(); c.rect(x - 4, y - sl.lay.size * 1.1, (pw.w + 8) * p, sl.lay.size * 1.5); c.clip();
        c.globalAlpha = a * 0.8;
        c.fillStyle = mixRgba('bone', 'signal', 0.25);
        c.fillText(pw.word.w, x, y);
        c.restore();
        g.globalAlpha = a * 0.3;
        g.fillStyle = rgba('signal', 0.7);
        g.save();
        g.beginPath(); g.rect(x - 4, y - sl.lay.size * 1.1, (pw.w + 8) * p, sl.lay.size * 1.5); g.clip();
        g.fillText(pw.word.w, x, y);
        g.restore();
      }
    }
    g.restore();
    c.restore();
  }

  /** 屋頂的大看板：鋼架與兩支腳、底下三盞往上打的燈；第一拍燈閃一下亮起，留言一個字一個字出現、寫完署名淡入。 */
  private drawBoard(c: CanvasRenderingContext2D, t: number, dx: number) {
    const B = this.board, n = this.note;
    if (!n) return;
    const x = B.x + dx, y = B.y;
    const on = t - this.msgT0;
    const light = on < 0 ? 0.25 : on < 0.22 ? (Math.floor(on / 0.055) % 2 ? 0.45 : 1) : 1;
    // 腳與鋼架（在看板後面，往下伸到老房子的屋頂後面）
    c.save();
    c.fillStyle = rgba('ink2');
    for (const lx of [x + B.w * 0.22, x + B.w * 0.78]) c.fillRect(lx - 7, y + B.h, 14, ARCADE - 300 - y - B.h + 10);
    c.strokeStyle = rgba('bone', 0.1);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let k = 0; k < 6; k++) { const yy = y + B.h + 14 + k * 26; c.moveTo(x + B.w * 0.22, yy); c.lineTo(x + B.w * 0.78, yy + 13); }
    c.stroke();
    // 面板：底色偏暗，燈從下面打上來——三盞燈各照亮一片（下緣最亮、往上散開），看起來是被照亮的看板，不是一張白卡
    c.fillStyle = mixC(rgba('ink2'), mixRgba('bone', 'ash', 0.5), light * 0.8);
    c.fillRect(x, y, B.w, B.h);
    c.save();
    c.beginPath(); c.rect(x, y, B.w, B.h); c.clip();
    for (let k = 0; k < 3; k++) {
      const lx = x + B.w * (0.2 + 0.3 * k), ly = y + B.h + 30;
      const rg = c.createRadialGradient(lx, ly, 10, lx, ly, B.h * 1.25);
      rg.addColorStop(0, mixRgba('bone', 'cream', 0.3, 0.75 * light));
      rg.addColorStop(1, mixRgba('bone', 'cream', 0.3, 0));
      c.fillStyle = rg;
      c.fillRect(x, y, B.w, B.h);
    }
    // 面板的接縫（直的幾條，很淡）
    c.strokeStyle = rgba('ink', 0.08);
    c.lineWidth = 1;
    c.beginPath();
    for (let k = 1; k < 4; k++) { const sx = x + (B.w * k) / 4; c.moveTo(sx, y); c.lineTo(sx, y + B.h); }
    c.stroke();
    c.restore();
    c.strokeStyle = rgba('ink', 0.9);
    c.lineWidth = 5;
    c.strokeRect(x - 2.5, y - 2.5, B.w + 5, B.h + 5);
    // 底下往上打的燈（燈架＋一點光）
    for (let k = 0; k < 3; k++) {
      const lx = x + B.w * (0.2 + 0.3 * k), ly = y + B.h + 18;
      c.fillStyle = rgba('ink');
      c.fillRect(lx - 1.5, y + B.h, 3, 18);
      c.fillRect(lx - 10, ly - 4, 20, 8);
      if (light > 0.5) { const e = LIN.ember; this.glow.seg2(lx, ly - 5, lx + 0.01, ly - 5, 14, [e[0] * 1.6 * light, e[1] * 1.4 * light, e[2] * light], 0.7); }
    }
    // 留言：深墨（看板上印的字）
    const total = msgChars(n.fit);
    const per = clamp(1.4 / Math.max(1, total), 0.025, 0.08);
    const done = this.msgT0 + 0.2 + total * per;
    const top = y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    c.globalAlpha = clamp(light * 1.2);
    drawNote(c, n, x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? Math.max(0, (t - this.msgT0 - 0.2) / per) : Infinity,
      color: this.msg ? rgba('ink', 0.95) : rgba('ink', 0.55), sigColor: rgba('ink', 0.7), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }

  /** 騎樓一排老房子：騎樓的柱子與店面（有的亮著、有的拉下捲門），樓上的鐵窗、冷氣、亮著的窗、直立的燈箱招牌（沒有字）。 */
  private drawStreet(c: CanvasRenderingContext2D, t: number, scr: number) {
    const FLOOR_H = 100, GROUND_H = 150;
    for (const b of this.bldgs) {
      const x = b.x - scr;
      if (x > W + 20 || x + b.w < -20) continue;
      const top = ARCADE - GROUND_H - b.floors * FLOOR_H;
      // 樓身
      c.fillStyle = mixRgba('ink2', 'ash', 0.05 + 0.05 * b.lit[3]!);
      c.fillRect(x, top, b.w, ARCADE - top);
      // 屋頂的鐵皮加蓋或女兒牆
      c.fillStyle = mixRgba('ink2', 'ink', 0.5);
      c.fillRect(x - 4, top - 8, b.w + 8, 10);
      // 樓上：每層一扇窗（鐵窗格子），有的亮著暖光；冷氣室外機
      for (let f = 0; f < b.floors; f++) {
        const wy = top + 22 + f * FLOOR_H, wx = x + 22, ww = b.w - 44;
        const lit = b.lit[f]! > 0.45;
        c.fillStyle = lit ? rgba('signal', 0.12 + 0.12 * b.lit[f]!) : rgba('ink', 0.7);
        c.fillRect(wx, wy, ww, 56);
        c.strokeStyle = rgba('bone', lit ? 0.18 : 0.08);
        c.lineWidth = 1.5;
        c.beginPath();
        for (let k = 1; k < 6; k++) { const gx = wx + (ww * k) / 6; c.moveTo(gx, wy - 4); c.lineTo(gx, wy + 62); }
        c.moveTo(wx - 4, wy - 4); c.lineTo(wx + ww + 4, wy - 4); c.lineTo(wx + ww + 4, wy + 62); c.lineTo(wx - 4, wy + 62); c.closePath();
        c.stroke();
        if (b.ac[f % 2]! > 0.5) { c.fillStyle = mixRgba('ink2', 'bone', 0.12); c.fillRect(x + b.w - 70, wy + 64, 46, 26); }
      }
      // 騎樓：上緣一條梁、柱子、店面
      const gy = ARCADE - GROUND_H;
      c.fillStyle = mixRgba('ink2', 'ink', 0.3);
      c.fillRect(x, gy, b.w, 18);
      if (b.shop > 0.35) {
        // 亮著的店面：暖光從裡面透出來（主題色）
        const g = c.createLinearGradient(0, gy + 18, 0, ARCADE);
        g.addColorStop(0, rgba('signal', 0.1 + 0.14 * b.shop));
        g.addColorStop(1, rgba('signal', 0.04));
        c.fillStyle = g;
        c.fillRect(x + 20, gy + 18, b.w - 40, GROUND_H - 18);
      } else {
        // 拉下來的鐵捲門
        c.fillStyle = mixRgba('ink2', 'ash', 0.12);
        c.fillRect(x + 20, gy + 18, b.w - 40, GROUND_H - 18);
        c.strokeStyle = rgba('ink', 0.5);
        c.lineWidth = 1;
        c.beginPath();
        for (let yy = gy + 26; yy < ARCADE; yy += 8) { c.moveTo(x + 20, yy); c.lineTo(x + b.w - 20, yy); }
        c.stroke();
      }
      c.fillStyle = mixRgba('ink2', 'ash', 0.1);
      c.fillRect(x, gy, 20, GROUND_H);
      // 直立的燈箱招牌（沒有字：只是一塊亮著的顏色），掛在二樓外面
      if (b.sign > 0.4 && b.floors > 1) {
        const sx = x + b.w - 34, sy = top + 12, sh = b.floors * FLOOR_H - 10;
        const flick = 0.85 + 0.15 * Math.sin(t * 5 + b.x);
        c.fillStyle = b.sign > 0.7 ? rgba('signal', 0.28 * flick) : mixRgba('bone', 'signal', 0.3, 0.2 * flick);
        c.fillRect(sx, sy, 30, sh);
        c.strokeStyle = rgba('ink', 0.6);
        c.strokeRect(sx, sy, 30, sh);
      }
    }
  }

  /** 路面的虛線與停紅燈時的斑馬線、停車線（跟著路面捲）。右下 HUD 區淡掉。 */
  private drawRoadMarks(c: CanvasRenderingContext2D, S: number) {
    c.save();
    // 右下 HUD 區不畫路面標線（斑馬線、停車線經過那裡時直接挖掉，那一塊保持乾淨）
    c.beginPath(); c.rect(0, 0, W, H); c.rect(1330, 800, W - 1330, H - 800); c.clip('evenodd');
    const off = ((S % 200) + 200) % 200;
    for (let x = -off; x < W; x += 200) {
      const a = 0.22 * (1 - clamp((x - 1150) / 200));
      if (a <= 0) continue;
      c.fillStyle = rgba('bone', a);
      c.beginPath(); c.moveTo(x, 1004); c.lineTo(x + 110, 1004); c.lineTo(x + 104, 1016); c.lineTo(x - 6, 1016); c.closePath(); c.fill();
    }
    if (this.stop) {
      const x = this.stop.x - S;
      if (x > -400 && x < W) {
        // 停車線＋斑馬線（在路面上：越近越寬）
        c.fillStyle = rgba('bone', 0.3);
        c.beginPath(); c.moveTo(x, CURB + 6); c.lineTo(x + 8, CURB + 6); c.lineTo(x + 14, H); c.lineTo(x + 2, H); c.closePath(); c.fill();
        for (let k = 0; k < 7; k++) {
          const y0 = CURB + 14 + k * 38, y1 = y0 + 20;
          const a = 0.2 * (1 - clamp((x + 60 - 1150) / 200));
          c.fillStyle = rgba('bone', a);
          c.fillRect(x + 40 + k * 2, y0, 150 + k * 6, y1 - y0);
        }
      }
    }
    c.restore();
  }

  /** 路燈：人行道邊的燈桿（在機車後面），燈頭一點暖光；back = 先畫燈桿，!back = 燈經過時在兩個人身上掃過的光。 */
  private drawLamps(c: CanvasRenderingContext2D, t: number, S: number, back: boolean) {
    for (const lx of this.lamps) {
      const x = lx - S;
      if (x < -200 || x > W + 200) continue;
      if (back) {
        c.fillStyle = mixRgba('ink2', 'ash', 0.15);
        c.fillRect(x - 4, 450, 8, CURB - 450);
        c.fillRect(x - 4, 450, 70, 7);
        // 燈罩在燈臂末端、燈泡在燈罩下面（光從下面出來，不要讓燈臂橫過光點）
        c.fillStyle = mixRgba('ink2', 'ash', 0.25);
        c.beginPath(); c.moveTo(x + 36, 457); c.lineTo(x + 74, 457); c.lineTo(x + 68, 464); c.lineTo(x + 42, 464); c.closePath(); c.fill();
        c.fillStyle = mixRgba('bone', 'signal', 0.4);
        c.fillRect(x + 46, 464, 18, 4);
        const e = LIN.ember;
        this.glow.seg2(x + 55, 470, x + 55.01, 470, 20, [e[0] * 1.2, e[1] * 1.1, e[2] * 0.8], 0.5);
      }
    }
    void t;
  }

  /** 紅綠燈：停車線旁邊的燈桿，紅燈亮著、旁邊的小秒數照拍子倒數，小節線上變綠燈。 */
  private drawSignal(c: CanvasRenderingContext2D, t: number, S: number) {
    const st = this.stop;
    if (!st) return;
    const x = st.x - S + 30;
    if (x < -100 || x > W + 100) return;
    const au = this.ctx.audio;
    c.save();
    c.fillStyle = mixRgba('ink2', 'ash', 0.2);
    c.fillRect(x - 5, 500, 10, CURB - 500);
    c.fillStyle = rgba('ink');
    c.fillRect(x - 22, 470, 44, 126);
    const green = t >= st.t2;
    const lamp = (cy: number, key: string, on: boolean) => {
      c.fillStyle = on ? rgba(key) : mixRgba('ink2', key, 0.18);
      c.beginPath(); c.arc(x, cy, 14, 0, Math.PI * 2); c.fill();
      if (on) { const L = LIN[key as 'collar']; this.glow.seg2(x, cy, x + 0.01, cy, 44, [L[0] * 1.6, L[1] * 1.6, L[2] * 1.6], 0.55); }
    };
    lamp(492, 'collar', !green);
    lamp(532, 'ball', false);
    lamp(572, 'gingham', green);
    // 倒數：停住之後照拍子 4、3、2、1（小小的 mono 字）
    if (t >= st.t1 - 0.05 && !green) {
      const left = Math.max(1, Math.ceil(au.beatAt(st.t2) - au.beatAt(t) - 1e-6));
      c.fillStyle = rgba('ink');
      c.fillRect(x + 26, 500, 40, 30);
      c.font = font(F.mono(600), 20);
      c.fillStyle = rgba('collar');
      c.fillText(String(left).padStart(2, '0'), x + 33, 522);
    }
    c.restore();
  }

  /** 機車與兩個人：從左邊騎進來；每拍顛一下、大鼓壓一下；路燈經過時一道暖光掃過；夜裡上亮下暗。 */
  private drawRider(c: CanvasRenderingContext2D, t: number, S: number, sp: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const enter = prog(t, s, s + 0.9, ease.outCubic);
    const x = SX - (1 - enter) * 700;
    const bump = sp * (2.5 * Math.abs(Math.sin(au.beatAt(t) * Math.PI)) + 3 * beatKick(au, t, 0.18));
    const squash = breathe(t, 0.005, 2.7) + sp * 0.012 * beatKick(au, t, 0.2);
    // 煞車時車頭往下點一下、起步時往後仰一下
    let rot = 0;
    const st = this.stop;
    if (st) {
      rot += 0.02 * Math.sin(Math.PI * prog(t, st.t1 - 0.12, st.t1 + 0.3));
      rot -= 0.02 * Math.sin(Math.PI * prog(t, st.t2, st.t2 + 0.4));
    }
    puppetShadow(c, 'cp', x, ROAD, { h: SZ, wide: 1.25, alpha: 0.75, color: '0,0,0' });
    // 紙偶先畫在打光台上（這一層已經有街景，直接 source-atop 會染到背景）
    const sc = this.stage.begin(x - SZ * 0.7, ROAD - SZ * 1.2);
    drawPick(sc, this.keys, t, x, ROAD - bump, { h: SZ, rot, pivot: 0.25, squash });
    const box = [x - SZ, ROAD - SZ * 1.2, SZ * 2, SZ * 1.3] as const;
    this.stage.light((lc) => {
      // 夜裡：上亮下暗
      const g = lc.createLinearGradient(0, ROAD - SZ, 0, ROAD);
      g.addColorStop(0, rgba('ink', 0.18));
      g.addColorStop(1, rgba('ink', 0.55));
      lc.fillStyle = g;
      lc.fillRect(...box);
      // 路燈經過時：一團暖光從前面掃到後面
      for (const lx of this.lamps) {
        const d = lx - S + 55 - x;
        if (Math.abs(d) > 500) continue;
        const k = Math.exp(-(d * d) / (2 * 220 * 220));
        const rg = lc.createRadialGradient(x + d, ROAD - SZ * 0.9, 20, x + d, ROAD - SZ * 0.9, 460);
        rg.addColorStop(0, mixRgba('cream', 'signal', 0.3, 0.3 * k));
        rg.addColorStop(1, mixRgba('cream', 'signal', 0.3, 0));
        lc.fillStyle = rg;
        lc.fillRect(...box);
      }
      // 停紅燈：紅燈（綠燈）的光淡淡地打在臉上
      if (st && t > st.t1 - 1 && t < st.t3 + 0.5) {
        const k = prog(t, st.t0, st.t1) * (1 - prog(t, st.t2 + 0.3, st.t3 + 0.5));
        lc.fillStyle = t < st.t2 ? rgba('collar', 0.08 * k) : rgba('gingham', 0.07 * k);
        lc.fillRect(...box);
      }
    });
    this.stage.end(c);
    // 車頭燈：往前下方照的一團光（越遠越淡）；燈本身一點發光
    const hx = x + SZ * 0.43, hy = ROAD - SZ * 0.53 - bump;
    c.save();
    c.translate(hx, hy);
    c.rotate(0.16);
    c.scale(1, 0.34);
    const cone = c.createRadialGradient(0, 0, 8, 120, 0, 560);
    cone.addColorStop(0, rgba('cream', 0.15));
    cone.addColorStop(1, rgba('cream', 0));
    c.fillStyle = cone;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 620, -0.55, 0.55); c.closePath(); c.fill();
    c.restore();
    const e = LIN.ember;
    this.glow.seg2(hx, hy, hx + 0.01, hy, 22, [e[0] * 2.2, e[1] * 2, e[2] * 1.6], 0.8);
    // 進場：仙女棒的火花在後輪
    if (enter < 1) {
      const px = x - SZ * 0.36, py = ROAD - 10;
      sparkHead(this.glow, px, py, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x: px, y: py }), { rate: 60, life: 0.3, speed: 160, seed: 3 });
    }
  }

  /** 風：幾條很淡的速度線從前面往後掠過（停下來就沒有）。 */
  private drawWind(c: CanvasRenderingContext2D, t: number, sp: number) {
    if (sp <= 0.05) return;
    c.save();
    c.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const y = 480 + 330 * hash(k, 7);
      const period = 0.55 + 0.4 * hash(k, 8);
      const u = ((t / period + hash(k, 9)) % 1 + 1) % 1;
      const x1 = W - u * (W + 600), len = 120 + 160 * hash(k, 10);
      const a = 0.08 * sp * Math.sin(Math.PI * u);
      if (x1 > 1300 && y > 800) continue;
      c.strokeStyle = rgba('bone', a);
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x1, y); c.lineTo(x1 + len, y); c.stroke();
    }
    c.restore();
  }
}
