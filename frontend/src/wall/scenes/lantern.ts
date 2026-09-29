// 放天燈（暗、date、日常服一）：平溪的鐵道邊，宣文與孟庭一起放一只天燈。角色是 Codex 畫的紙偶（_puppet.ts），
// 天燈、夜空、遠山、老街、鐵軌是程式畫的。
//  - 開場：兩人從側面翻正進場，面對面扶著一只還沒點的天燈（孟庭在左、宣文在右），孟庭拿毛筆在燈面上
//    一個字一個字寫上**主打留言**（深墨手寫字）。天燈疊在兩人的手前面（手扶在燈後）。
//  - 寫完之後的拍點：仙女棒的火花飛進燈底的金紙點著——火苗、燈裡透出暖光、燈紙鼓起來彈一下，兩人的臉被照亮。
//  - 下一個小節線：兩人一起放手（雙手往上舉、輕輕一跳），天燈慢慢升起；鏡頭跟著往上搖（人往畫面下方沉、遠山跟著降），
//    燈只在畫面上升一點點，所以**留言一直在燈面上讀得到**。放手的那一小節芃芃和 QQ 在小鼓上跳一下；鏡頭搖到人沉到燈底下之後（兩小節後的小節線），兩人翻成背影、摟著肩抬頭看。
//  - 遠處的天空已經升著一大片天燈（有遠有近、慢慢往上飄、輕輕晃），近一點的幾盞寫著其他賓客的留言（小字、很淡，只是氣氛）。
//  - 歌詞沿著右上天空一道弧線（天燈飄上去的路）逐字亮，仙女棒的火花騎在正在唱的字上；比留言小一級（標準 v2：40～52）。
//  - 照「留言尺寸與版面比例標準 v2」：留言 40～60、署名 26～32，燈面寫字的範圍約 350 × 400。沒有留言時燈上寫邀請（字小、淡），歌詞變主角。
//  - 窗格很短（2～3 小節）：寫完、點火就結束，不放手；鏡頭一樣慢慢推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { lyricAt, barAfter, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, puppetPoint, puppetShadow, puppetIn, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { mixC } from './_c4';

export const spec: PlateSpecDecl = { group: 'couple', family: 'date', paper: false, energy: [0, 0.8], bars: [4, 8] };

const GROUND = 900;
const SZ = 410;
/** 天燈（還沒升起時）：中心 x、燈底 y、側面露出來的深度。燈的寬高跟著留言（最長的留言時燈面約 490 × 450）。 */
const LX = 620, LB = 700, SIDE = 54;
/** 燈面寫字的內距（上、下、左右）與寫字範圍的上限。 */
const PAD = { top: 50, bottom: 60, side: 34 };
const TEXT_W = 420, LH_MAX = 450;
/** 鏡頭往上搖多少（px）；天燈在畫面上最多升多少（燈頂離上緣還要留給字）。 */
const TILT = 190, LIFT = 60;
const DOG_S = 1.15;
const MT_X = 262, XW_X = 1004, PP_X = 128, QQ_X = 1150;
/** 翻成背影之後兩人站的地方：燈的左下方（燈在他們的右上方，孟庭往右上指）。 */
const WATCH_X = LX - 240;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['mt_lantern_write', 'mt_lantern_hold', 'xw_lantern_hold', 'mt_lantern_release', 'xw_lantern_release', 'cp_lantern_watch', 'pp_sit', 'qq_sit', 'pp_jump', 'qq_jump'];

/** 夜空：上面深、往山谷越暖（遠處一整片天燈與老街的光），加上很淡的雲層；camY = 鏡頭往上搖了多少（天空跟著降一點點）。 */
const SKY = () => new FSPass(/* glsl */ `
  uniform float camY;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float y = (p.y - camY * 0.35) / ${H}.0;
    vec3 col = mix(C_INK, mix(C_INK2, C_BLOOD, 0.22), smoothstep(-0.1, 0.95, y));
    vec2 q = (p - vec2(1300.0, 700.0 + camY * 0.35)) / vec2(1000.0, 420.0);
    col += C_SIGNAL * 0.045 * exp(-dot(q, q) * 1.4);
    float cl = fbm(vec2(p.x * 0.0012, (p.y - camY * 0.35) * 0.004) + vec2(0.0, 3.1), 4);
    col += C_BONE * 0.012 * smoothstep(0.1, 0.5, cl) * (1.0 - y);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { camY: { value: 0 } });

/** 天燈的光：以燈為中心的一大團暖光，加在已經畫好的背景上（alpha 0 = 相加），照亮鐵軌、老街與兩個人身後的空氣。 */
const LAMP = () => new FSPass(/* glsl */ `
  uniform vec2 lamp; uniform float amt;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = (p - lamp) / vec2(520.0, 460.0);
    float g = exp(-dot(q, q) * 1.6);
    fragColor = vec4(C_SIGNAL * 0.11 * amt * g + (hash12(p + 1.7) - 0.5) * 0.003 * amt, 0.0);
  }`, { lamp: { value: new THREE.Vector2(LX, LB - 200) }, amt: { value: 0 } }, { over: true });

interface Far { x: number; y0: number; z: number; sp: number; ph: number; sz: number; msg: string | null }

export default class Lantern extends Scene {
  sky = shared('lantern.sky', SKY);
  lamp = shared('lantern.lamp', LAMP);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  far = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  /** 燈面上寫好的字（寫完之後燈會晃、會升，字先畫到這張圖上再跟著燈變形，不用每格重新光柵化斜的字）。 */
  face: HTMLCanvasElement | null = null;
  lyricSize = 52;
  /** 時間點：開始寫、寫完、點火、放手、翻成背影。 */
  tw0 = 0; twd = 0; tLight = Infinity; tRel = Infinity; tWatch = Infinity;
  per = 0.05;
  fars: Far[] = [];
  arc: Pt[] = [];
  mtX = MT_X; xwX = XW_X;
  /** 燈的上寬、下寬、高（跟著留言）。 */
  tw = 480; bw = 400; lh = 440;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    // 其他賓客的留言：近一點的幾盞天燈上寫幾個字（只是氣氛）
    const others = (this.ctx.params.messages ?? []).filter((m: Msg) => m.id !== this.msg?.id && m.text.replace(/[♥\s]/g, '').length >= 2).slice(0, 12);
    // 燈上是直書的三、四個字：只挑中文的留言（英文直著寫很難看）
    const bits = others.map((m: Msg) => Array.from(m.text.replace(/[♥\s，。！？、,.!?~～…]/g, '')).slice(0, 4).join('')).filter((b: string) => /^[一-鿿]{3,4}$/u.test(b));
    await loadText('一位賓客' + INVITE + bits.join(''));
    this.track(await loadPuppets(SPRITES));
    // 燈面上的留言：標準 v2 的字級；燈的寬高跟著留言（字寬＋內距，燈面下窄上寬，寬度照最窄的燈底算），不要掛一個大空燈
    const c = this.fg.ctx;
    const th = LH_MAX - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, TEXT_W, th) : noteV2(c, INVITE, null, TEXT_W * 0.8, th * 0.5, { max: 40 });
    const textW = tightenNote(c, this.note, 240);
    this.bw = textW + PAD.side * 2;
    this.tw = this.bw + 110;
    // 短的留言燈就矮胖一點（不要一大片空的燈紙），長的留言燈高到 LH_MAX
    this.lh = clamp(Math.max(PAD.top + this.note.height + PAD.bottom + 20, this.bw * 0.78), 320, LH_MAX);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.renderFace();
    // 兩個人站的位置：讓「扶燈」那張圖的手剛好貼在燈的兩側（圖上量的手點；沒有就用預設值）
    const handY = GROUND - SZ * 0.78;
    const wAt = (y: number) => lerp(this.tw, this.bw, clamp((y - (LB - this.lh)) / this.lh));
    const mh = puppetPoint('mt_lantern_hold', 'hand', MT_X, GROUND, { h: SZ });
    if (mh) this.mtX = MT_X + (LX - wAt(handY) / 2 + 14) - mh.x;
    const xh = puppetPoint('xw_lantern_hold', 'hand', XW_X, GROUND, { h: SZ, flip: true });
    if (xh) this.xwX = XW_X + (LX + wAt(handY) / 2 + SIDE - 8) - xh.x;

    // 時間軸：進場 → 寫字（一個字一個字，最多 1.6 秒）→ 寫完後的拍點點火 → 下一個小節線放手 → 兩小節後的小節線翻成背影
    const total = this.msg ? msgChars(this.note.fit) : 0;
    this.per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    this.tw0 = s + 0.4;
    this.twd = this.tw0 + total * this.per;
    const bp = au.beatPeriod(s);
    this.tLight = beatAfter(au, Math.max(this.twd + 0.2, s + 0.9));
    if (this.tLight > e - bp * 0.6) this.tLight = Infinity;
    const rel = barAfter(au, this.tLight + bp * 0.9);
    if (rel < e - bp * 2) this.tRel = rel;
    // 鏡頭搖得差不多了（人沉到燈底下）才翻成背影，不然燈會蓋在兩人頭上
    const watch = barAfter(au, this.tRel + bp * 6);
    if (watch < e - bp) this.tWatch = watch;

    // 遠處的天燈：位置、深度、上升速度都用種子；越遠越小、越慢、鏡頭搖的時候降得越少
    const seed = (this.ctx.params.seed ?? 7) as number;
    let mi = 0;
    for (let i = 0; i < 90; i++) {
      const z = 0.15 + 0.8 * hash(i, seed, 1) ** 1.6;
      // 右半邊（山谷那一側）多一點，左邊老街上方少一點
      const x = hash(i, seed, 2) < 0.72 ? lerp(960, 1880, hash(i, seed, 3)) : lerp(60, 980, hash(i, seed, 4));
      const near = z > 0.72 && x > 1120 && x < 1780 && mi < bits.length && mi < 4;
      // 寫著別人留言的那幾盞近一點、大一點、飄得慢（字小小的、很淡，只是氣氛）
      const sz = near ? 58 + 18 * hash(i, seed, 7) : 3 + 22 * z * z;
      this.fars.push({ x, y0: hash(i, seed, 5), z, sp: near ? 6 : 8 + 22 * z, ph: hash(i, seed, 6) * 6.28, sz, msg: near ? bits[mi++]! : null });
    }
    // 歌詞的弧線：右上天空，從燈的右上方往右上飄
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      this.arc.push({ x: lerp(1110, 1800, u), y: 360 - 110 * u + 40 * Math.sin(u * Math.PI) * -1 });
    }
    this.drawBackground();
  }

  /** 燈面上的留言（整段、深墨）先畫到一張圖上：燈寫完之後會晃、會升，直接貼這張圖（斜的字不用每格重新光柵化）。 */
  private renderFace() {
    const cv = document.createElement('canvas');
    const k = 2;
    cv.width = Math.ceil(this.tw * k); cv.height = Math.ceil(this.lh * k);
    const c = cv.getContext('2d')!;
    c.scale(k, k);
    this.drawText(c, this.tw / 2, Infinity, 1);
    this.face = cv;
  }

  /** 燈面上的字：cx = 燈面中心（燈面座標，燈頂 = 0）；chars 已經寫了幾個字、sigK 署名的淡入。 */
  private drawText(c: CanvasRenderingContext2D, cx: number, chars: number, sigK: number) {
    const n = this.note!;
    const top = PAD.top, h = this.lh - PAD.top - PAD.bottom;
    const y = top + Math.max(0, (h - n.height) * 0.5);
    const ink = this.msg ? rgba('ink', 0.94) : rgba('ink', 0.55);
    drawNote(c, n, cx - n.width / 2, y, { chars, color: ink, sigColor: rgba('ink', 0.72), sigK, align: 'center' });
  }

  /** 不會動的：遠山兩層、左邊的老街（暖窗）、鐵軌與枕木（右下 HUD 區淡掉）。整張跟著鏡頭往上搖時往下移。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ridge = (pts: number[][], fill: string) => {
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(-10, H + 300);
      for (const [x, y] of pts) c.lineTo(x!, y!);
      c.lineTo(W + 10, H + 300);
      c.closePath();
      c.fill();
    };
    // 遠山：很淡的一層、近山：山谷右邊的一層
    const farPts: number[][] = [], nearPts: number[][] = [];
    for (let x = -10; x <= W + 10; x += 24) {
      farPts.push([x, 600 - 70 * Math.sin(x * 0.0021 + 0.6) - 36 * Math.sin(x * 0.0063 + 1.3) - 14 * Math.sin(x * 0.019)]);
      nearPts.push([x, 720 - 110 * Math.exp(-(((x - 1650) / 380) ** 2)) - 60 * Math.exp(-(((x - 300) / 420) ** 2)) - 10 * Math.sin(x * 0.03)]);
    }
    ridge(farPts, mixRgba('ink', 'ink2', 0.9));
    c.strokeStyle = rgba('signal', 0.07);
    c.lineWidth = 1.2;
    c.beginPath(); farPts.forEach(([x, y], i) => (i ? c.lineTo(x!, y!) : c.moveTo(x!, y!))); c.stroke();
    ridge(nearPts, rgba('ink'));
    // 老街：左邊一排兩三層的老房子（屋頂、騎樓），窗戶透出暖光
    const houses = [[20, 610, 150], [170, 640, 130], [300, 600, 160], [460, 650, 120], [580, 628, 140], [720, 660, 110]];
    houses.forEach(([x, top, w], i) => {
      c.fillStyle = rgba('ink2');
      c.fillRect(x!, top!, w!, 800 - top!);
      c.fillStyle = mixRgba('ink2', 'bone', 0.05);
      c.fillRect(x! - 6, top! - 8, w! + 12, 9);
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
        if (hash(i, r, k) < 0.45) continue;
        const wx = x! + 16 + k * (w! - 30) / 3, wy = top! + 24 + r * 46;
        if (wy > 770) continue;
        c.fillStyle = rgba('signal', 0.16 + 0.22 * hash(i, r, k, 2));
        c.fillRect(wx, wy, 16, 22);
      }
    });
    // 地面：從山腳到畫面底，深色、帶一點暖
    const g = c.createLinearGradient(0, 760, 0, H);
    g.addColorStop(0, rgba('ink2'));
    g.addColorStop(1, rgba('ink'));
    c.fillStyle = g;
    c.fillRect(0, 780, W, H + 300 - 780);
    // 鐵軌：枕木＋兩條軌道，往右淡掉（右下 HUD 區保持乾淨）
    const fade = (x: number) => 1 - clamp((x - 1050) / 260);
    for (let x = -20; x < 1320; x += 46) {
      c.fillStyle = rgba('bone', 0.06 * fade(x));
      c.beginPath(); c.moveTo(x, GROUND + 2); c.lineTo(x + 26, GROUND + 2); c.lineTo(x + 34, GROUND + 44); c.lineTo(x - 4, GROUND + 44); c.closePath(); c.fill();
    }
    for (const [y, a] of [[GROUND + 6, 0.32], [GROUND + 32, 0.4]] as const) {
      const lg = c.createLinearGradient(0, 0, 1320, 0);
      lg.addColorStop(0, rgba('bone', a * 0.6)); lg.addColorStop(0.72, rgba('bone', a)); lg.addColorStop(1, rgba('bone', 0));
      c.strokeStyle = lg;
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(-10, y); c.lineTo(1320, y); c.stroke();
    }
    L.upload();
  }

  /** 天燈在這一格的樣子：燈底中心、傾斜、點火後的亮度（0..1）、鼓起來的量。 */
  private lanternAt(t: number) {
    const au = this.ctx.audio;
    const bp = au.beatPeriod(t);
    const lit = this.tLight === Infinity ? 0 : prog(t, this.tLight, this.tLight + 0.5, ease.outCubic);
    // 點火那一下燈紙鼓起來、彈一下
    const puff = t >= this.tLight ? Math.exp(-(t - this.tLight) / 0.25) * Math.sin((t - this.tLight) * 22) * 0.04 : 0;
    const bar = bp * 4;
    // 放手之後：燈在畫面上升一點點（LIFT），鏡頭跟著往上搖（camY）；之後在空中輕輕浮、晃
    const lift = t >= this.tRel ? LIFT * ease.inOutCubic(prog(t, this.tRel, this.tRel + bar * 1.5)) : 0;
    const cam = this.camY(t);
    // 沒放手（tRel = Infinity）時 t - tRel 是 -Infinity，sin 會變 NaN：放手之前一律 0
    const u = t >= this.tRel ? t - this.tRel : 0;
    const air = t >= this.tRel ? prog(t, this.tRel, this.tRel + bar) : 0;
    const bob = air * 5 * Math.sin(u * 1.3);
    const rot = air * (0.022 * Math.sin(u * 0.9) + 0.01 * Math.sin(u * 2.3));
    const dx = air * 26 * Math.sin(u * 0.35);
    // 扶著的時候跟著兩個人的呼吸很輕地上下
    const hold = t < this.tRel ? 2 * Math.sin(t * 1.9) : 0;
    return { x: LX + dx, y: LB - lift + bob + hold, rot, lit, puff, cam };
  }

  /** 鏡頭往上搖：放手後的四分之一小節開始，三小節內搖完。 */
  private camY(t: number) {
    if (t < this.tRel) return 0;
    const bar = this.ctx.audio.beatPeriod(t) * 4;
    return TILT * ease.inOutCubic(prog(t, this.tRel + bar * 0.25, this.tRel + bar * 3));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const Lt = this.lanternAt(t);
    const cam = Lt.cam;
    this.glow.clear();

    this.sky.u.camY!.value = cam;
    this.sky.render(renderer, out);
    // 遠處的天燈（低解析度的一層：遠的東西本來就該軟一點）
    this.drawFar(t, cam);
    comp.draw(renderer, this.far.upload(), out);
    comp.draw(renderer, this.bg.texture, out, { offset: [0, cam / H] });
    // 天燈的暖光
    (this.lamp.u.lamp!.value as THREE.Vector2).set(Lt.x, H - (Lt.y - this.lh * 0.3));
    this.lamp.u.amt!.value = Lt.lit;
    if (Lt.lit > 0) this.lamp.render(renderer, out);

    const L = this.fg; L.clear();
    const c = L.ctx;
    // ---- 人和狗（這一層最先畫：打光只染紙偶）
    this.drawPeople(c, t, cam);
    this.lightPeople(c, Lt, cam);
    // ---- 天燈與燈上的留言
    this.drawLantern(c, t, Lt);
    // ---- 歌詞：右上天空的弧線（跟著鏡頭降一點點）
    const ly = lyricAt(lyrics, t);
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);
    if (ly) {
      const path = cam ? this.arc.map((p) => ({ x: p.x, y: p.y + cam * 0.4 })) : this.arc;
      const r = lyricOnPath(c, ly.line, t, path, { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: 0, alpha: ly.k * rv, unsung: rgba('bone', 0.26) });
      if (r.head) sparkHead(this.glow, r.head.x, r.head.y - 6, t, 0.5, 0.8);
    }
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢推近天燈
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.75, vignette: 0.5, zoom: 1 + 0.028 * push, shake: [-(LX - W / 2) * 0.028 * push, -(LB - this.lh / 2 - H / 2) * 0.028 * push] };
  }

  /** 遠處一片天燈：一顆顆暖色的小燈慢慢往上飄、左右晃；近一點的畫出燈的形狀，最近的幾盞寫著別的賓客的幾個字。 */
  private drawFar(t: number, cam: number) {
    const L = this.far, c = L.ctx;
    L.clear();
    const sg = LIN.signal, em = LIN.ember;
    for (const fr of this.fars) {
      // 寫著字的那幾盞只在歌詞弧線下面那一段飄（不要從歌詞後面穿過去），升到頂就淡進霧裡
      const top = fr.msg ? 430 : 40, bottom = fr.msg ? 730 : 760;
      const span = bottom - top;
      // 從山後升起、往上飄：位置只看 t（窗格從哪裡開始都一樣）
      const y = bottom - ((fr.y0 * span + t * fr.sp) % span) + cam * (0.15 + 0.5 * fr.z);
      const x = fr.x + 8 * Math.sin(t * 0.6 + fr.ph) * fr.z;
      const sz = fr.sz;
      // 剛升起來（在山後）淡入、快到頂淡出
      const a = clamp((bottom - y) / 60) * clamp((y - top) / 80) * (0.35 + 0.65 * fr.z);
      if (a <= 0.01) continue;
      const flick = 0.85 + 0.15 * Math.sin(t * 7.3 + fr.ph * 3);
      if (sz > 7) {
        // 近一點的：畫出上寬下窄的燈身（燈紙透光：下亮上暗）；燈紙是暖色的紙（固定色），光暈才用主題的訊號色
        const w = sz * 0.9, h = sz * 1.15;
        const g = c.createLinearGradient(0, y - h, 0, y);
        g.addColorStop(0, mixRgba('fur', 'blood', 0.45, a * 0.85));
        g.addColorStop(1, mixRgba('cream', 'fur', 0.25, a * flick));
        c.fillStyle = g;
        c.beginPath(); c.moveTo(x - w * 0.42, y); c.lineTo(x - w * 0.55, y - h); c.lineTo(x + w * 0.55, y - h); c.lineTo(x + w * 0.42, y); c.closePath(); c.fill();
        if (fr.msg) {
          c.font = font(F.hand(400), Math.round(sz * 0.26));
          c.fillStyle = rgba('ink', 0.45 * a);
          c.textAlign = 'center';
          Array.from(fr.msg).forEach((ch, i) => c.fillText(ch, x, y - h + sz * 0.27 * (i + 1.25)));
          c.textAlign = 'left';
        }
        // 燈口的火（很小的一點，會發光）
        if (a > 0.3) this.glow.seg2(x, y - 1, x + 0.01, y - 1, 2 + sz * 0.22, [em[0] * 1.8 * a, em[1] * 1.5 * a, em[2] * 1.0 * a], 0.8);
      } else {
        c.fillStyle = mixRgba('cream', 'fur', 0.45, a * flick);
        c.fillRect(x - sz * 0.35, y - sz, sz * 0.7, sz);
        if (a > 0.35 && sz > 4) this.glow.seg2(x, y - sz * 0.5, x + 0.01, y - sz * 0.5, sz * 1.1, [sg[0] * 0.9 * a, sg[1] * 0.8 * a, sg[2] * 0.6 * a], 0.45);
      }
    }
  }

  /** 兩個人和兩隻狗：扶燈（孟庭先寫字）→ 放手 → 翻成背影一起抬頭看。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number, cam: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    const G = GROUND + cam;
    // 放手：兩人輕輕一跳（把燈往上送）
    const j = t >= this.tRel - 0.12 ? jumpArc(t, this.tRel, this.tRel + bp * 0.7, 14, { crouch: 0.05, land: 0.07 }) : { y: 0, squash: 0, air: false, u: 0 };
    // 翻成背影：小節線前半拍兩人翻成一條線，小節線上換成背影那張再翻回來
    const flipOut = this.tWatch < Infinity ? prog(t, this.tWatch - bp * 0.5, this.tWatch, ease.inCubic) * 0.25 : 0;
    const flipIn = t >= this.tWatch ? 0.25 * (1 - ease.outBack(prog(t, this.tWatch, this.tWatch + bp * 0.6))) : 0;
    const writing = this.msg && t < this.twd + 0.25;
    // 寫字的時候手跟著筆畫一點一點動
    const scrib = writing && t >= this.tw0 ? 0.012 * Math.sin((t - this.tw0) / this.per * 2.1) : 0;
    const ents = [puppetIn(t, s + 0.05, 0.45), puppetIn(t, s + 0.16, 0.45)];
    if (t < this.tWatch) {
      // 孟庭（左、朝右）、宣文（右、朝左）
      const people: [string, number, boolean, number, number][] = [
        ['mt', this.mtX, false, 0, 0.3],
        ['xw', this.xwX, true, 1, 0.8],
      ];
      for (const [p, x, flip, i, ph] of people) {
        const en = ents[i]!;
        if (en.alpha <= 0) continue;
        const pose = t >= this.tRel ? `${p}_lantern_release` : p === 'mt' && writing ? 'mt_lantern_write' : `${p}_lantern_hold`;
        const lit = this.tLight < Infinity ? Math.exp(-Math.max(0, t - this.tLight) / 0.2) * (t >= this.tLight ? 1 : 0) : 0;
        const o: PuppetOpts = { h: SZ, flip, spin: en.spin + flipOut, alpha: en.alpha, rot: p === 'mt' ? scrib : 0, pivot: 0.4, squash: breathe(t, 0.007, 3.3, ph) + j.squash - lit * 0.03 };
        puppetShadow(c, p, x, G, { h: SZ, lift: -j.y, alpha: 0.6 * en.alpha, color: '0,0,0' });
        drawPuppet(c, pose, x, G + j.y, o);
      }
    } else {
      puppetShadow(c, 'cp', WATCH_X, G, { h: SZ, alpha: 0.6, color: '0,0,0' });
      drawPuppet(c, 'cp_lantern_watch', WATCH_X, G, { h: SZ, spin: flipIn, squash: breathe(t, 0.006, 3.6) });
    }
    // 狗：坐在兩邊看；放手的那一小節在小鼓（第 2、4 拍）跳一下
    const dogs: ['pp' | 'qq', number, boolean, number][] = [['pp', PP_X, false, 0.28], ['qq', QQ_X, true, 0.34]];
    for (const [d, x, flip, delay] of dogs) {
      const en = puppetIn(t, s + delay, 0.4);
      if (en.alpha <= 0) continue;
      let lift = 0, sq = 0.04 * beatKick(au, t, 0.25) + breathe(t, 0.014, 1.4, d === 'qq' ? 0.5 : 0), air = false;
      if (this.tRel < Infinity) {
        for (const k of [1, 3]) {
          const tb = au.timeOfBeat(Math.round(au.beatAt(this.tRel)) + k) + (d === 'qq' ? 0.04 : 0);
          const jj = jumpArc(t, tb - bp * 0.3, tb + bp * 0.3, 46, { crouch: 0.1, land: 0.15 });
          if (jj.air) { lift = -jj.y; sq = jj.squash; air = true; }
          else if (t > tb && t < tb + bp * 0.6) sq += jj.squash;
        }
      }
      // 跳起來那張圖嘴裡畫了網球（丟球版面用的），這裡蓋掉
      const o: PuppetOpts = { h: SZ, scale: DOG_S, flip, spin: en.spin, alpha: en.alpha, squash: sq, hide: ['ball'] };
      puppetShadow(c, d, x, G, { h: SZ * DOG_S, lift, alpha: 0.55 * en.alpha, color: '0,0,0' });
      drawPuppet(c, air ? `${d}_jump` : `${d}_sit`, x, G - lift, o);
    }
  }

  /** 紙偶的打光：暗處上亮下暗；點火之後燈的暖光從燈那裡照過來（離燈越遠越暗）。只染已經畫上去的紙偶。 */
  private lightPeople(c: CanvasRenderingContext2D, Lt: ReturnType<Lantern['lanternAt']>, cam: number) {
    c.save();
    c.globalCompositeOperation = 'source-atop';
    const top = GROUND + cam - SZ * 1.1;
    const g = c.createLinearGradient(0, top, 0, GROUND + cam + 20);
    g.addColorStop(0, rgba('ink', 0.3 - 0.18 * Lt.lit));
    g.addColorStop(1, rgba('ink', 0.62 - 0.12 * Lt.lit));
    c.fillStyle = g;
    c.fillRect(0, top - 40, W, SZ * 1.3 + 80);
    if (Lt.lit > 0) {
      const cy = Lt.y - 120;
      const rg = c.createRadialGradient(Lt.x, cy, 40, Lt.x, cy, 620);
      rg.addColorStop(0, rgba('signal', 0.2 * Lt.lit));
      rg.addColorStop(1, rgba('signal', 0));
      c.fillStyle = rg;
      c.fillRect(0, top - 40, W, SZ * 1.3 + 80);
    }
    c.restore();
  }

  /** 天燈：燈面（正面）＋右邊一條側面、燈頂微微隆起、燈底的竹圈與金紙；點火後燈紙從燈底透出暖光、火苗發光。燈面上的留言照寫字的進度畫。 */
  private drawLantern(c: CanvasRenderingContext2D, t: number, Lt: ReturnType<Lantern['lanternAt']>) {
    const s = this.ctx.start;
    const k = prog(t, s + 0.1, s + 0.55, ease.outBack);
    if (k <= 0) return;
    const TW = this.tw, BW = this.bw, LH = this.lh;
    const inflate = 1 + Lt.puff;
    c.save();
    c.globalAlpha = clamp(k * 3);
    c.translate(Lt.x, Lt.y);
    if (Lt.rot) c.rotate(Lt.rot);
    c.scale(inflate * (0.9 + 0.1 * k), (2 - inflate) * k);
    // 燈身：上寬下窄，兩邊微微鼓（點火後熱氣撐開，鼓得更圓）
    const bulge = 5 + 9 * Lt.lit, dome = 20 + 10 * Lt.lit;
    const front = new Path2D();
    front.moveTo(-BW / 2, 0);
    front.quadraticCurveTo(-(TW + BW) / 4 - bulge, -LH / 2, -TW / 2, -LH);
    front.quadraticCurveTo(0, -LH - dome, TW / 2, -LH);
    front.quadraticCurveTo((TW + BW) / 4 + bulge, -LH / 2, BW / 2, 0);
    front.quadraticCurveTo(0, 6, -BW / 2, 0);
    front.closePath();
    // 側面：往右後方退、越往後越窄；紅色的燈紙（平溪天燈每一面不同顏色），點火後透成橘紅
    const side = new Path2D();
    side.moveTo(BW / 2, 0);
    side.quadraticCurveTo((TW + BW) / 4 + bulge, -LH / 2, TW / 2, -LH);
    side.quadraticCurveTo(TW / 2 + SIDE * 0.5, -LH - dome * 0.5, TW / 2 + SIDE, -LH - SIDE * 0.3);
    side.quadraticCurveTo((TW + BW) / 4 + bulge + SIDE * 1.1, -LH / 2 - SIDE * 0.15, BW / 2 + SIDE * 0.75, -SIDE * 0.2);
    side.closePath();
    // 燈口：從稍微低一點的角度看得到燈底的開口（裡面沒點火是暗的、點火後是亮的），燈才有體積，不像一張卡片
    const ox = SIDE * 0.38, orx = BW / 2 + SIDE * 0.42, ory = 16, oy = ory - 3;
    c.fillStyle = mixC(rgba('ink2'), mixRgba('cream', 'fur', 0.5), Lt.lit);
    c.beginPath(); c.ellipse(ox, oy, orx, ory, 0, 0, Math.PI * 2); c.fill();
    const sg = c.createLinearGradient(BW / 2, 0, TW / 2 + SIDE, 0);
    sg.addColorStop(0, mixC(mixRgba('collar', 'ink', 0.35), mixRgba('collar', 'fur', 0.35), Lt.lit));
    sg.addColorStop(1, mixC(mixRgba('collar', 'ink', 0.6), mixRgba('collar', 'blood', 0.35), Lt.lit));
    c.fillStyle = sg;
    c.fill(side);
    // 正面：沒點火是暗處的米白燈紙；點火後燈底最亮、往上漸暖
    const g = c.createLinearGradient(0, -LH, 0, 0);
    g.addColorStop(0, mixC(mixRgba('cream', 'ash', 0.38), mixRgba('cream', 'fur', 0.3), Lt.lit));
    g.addColorStop(0.6, mixC(mixRgba('cream', 'ash', 0.3), mixRgba('cream', 'fur', 0.12), Lt.lit));
    g.addColorStop(1, mixC(mixRgba('cream', 'ash', 0.42), mixRgba('cream', 'bone', 0.6), Lt.lit));
    c.fillStyle = g;
    c.fill(front);
    if (Lt.lit > 0) {
      // 燈裡的火從燈底往上照：一團暖光（在燈面裡面，字照樣是深墨）
      const rg = c.createRadialGradient(0, 0, 10, 0, -LH * 0.25, LH * 0.8);
      rg.addColorStop(0, rgba('bone', 0.5 * Lt.lit));
      rg.addColorStop(0.5, mixRgba('cream', 'fur', 0.3, 0.22 * Lt.lit));
      rg.addColorStop(1, mixRgba('cream', 'fur', 0.3, 0));
      c.save(); c.clip(front); c.fillStyle = rg; c.fillRect(-TW, -LH - 40, TW * 2, LH + 60); c.restore();
    }
    // 燈頂的一圈陰影、紙的接縫與一道橫的皺摺（很淡）
    c.save();
    c.clip(front);
    const tg = c.createLinearGradient(0, -LH - dome, 0, -LH + 40);
    tg.addColorStop(0, rgba('blood', 0.28)); tg.addColorStop(1, rgba('blood', 0));
    c.fillStyle = tg;
    c.fillRect(-TW, -LH - dome, TW * 2, 60 + dome);
    c.restore();
    c.strokeStyle = rgba('blood', 0.14);
    c.lineWidth = 1.2;
    c.beginPath();
    for (const u of [-0.34, 0.33]) { c.moveTo(u * BW, -3); c.lineTo(u * TW, -LH + 2); }
    c.moveTo(-TW * 0.45, -LH * 0.64); c.quadraticCurveTo(-TW * 0.1, -LH * 0.61, TW * 0.44, -LH * 0.67);
    c.stroke();
    // 燈面是鼓起來的紙：左右兩邊暗一點
    c.save();
    c.clip(front);
    const hg = c.createLinearGradient(-TW / 2, 0, TW / 2, 0);
    hg.addColorStop(0, rgba('blood', 0.2)); hg.addColorStop(0.18, rgba('blood', 0)); hg.addColorStop(0.85, rgba('blood', 0)); hg.addColorStop(1, rgba('blood', 0.16));
    c.fillStyle = hg;
    c.fillRect(-TW, -LH - 40, TW * 2, LH + 60);
    c.restore();
    c.strokeStyle = rgba('ink', 0.5);
    c.lineWidth = 1.3;
    c.stroke(front);
    c.stroke(side);
    // 燈底：竹圈、鐵絲、金紙
    c.strokeStyle = mixRgba('fur', 'ink', 0.4);
    c.lineWidth = 4;
    c.beginPath(); c.ellipse(ox, oy, orx, ory, 0, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = rgba('ash', 0.55);
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(ox - orx + 6, oy); c.lineTo(ox, oy + 4); c.lineTo(ox + orx - 6, oy); c.stroke();
    c.fillStyle = Lt.lit > 0 ? mixRgba('fur', 'cream', 0.4) : mixRgba('fur', 'blood', 0.4);
    c.fillRect(ox - 20, oy - 2, 40, 12);
    // 燈面上的留言：寫的時候照進度畫；寫完之後貼整張（燈會晃、會升）
    if (this.note) {
      if (t < this.twd + 0.6 && this.msg) {
        c.save();
        c.translate(-TW / 2, -LH);
        const sigK = prog(t, this.twd + 0.1, this.twd + 0.5);
        this.drawText(c, TW / 2, Math.max(0, (t - this.tw0) / this.per), sigK);
        c.restore();
      } else if (this.face) {
        c.drawImage(this.face, -TW / 2, -LH, TW, LH);
      }
    }
    c.restore();
    // 火苗與燈的光（發光層）：點火前一拍，仙女棒的火花從下面畫一道小弧飛進金紙
    const cx = Lt.x + Math.cos(Lt.rot) * SIDE * 0.38, cy = Lt.y + 14;
    if (this.tLight < Infinity) {
      const d = t - this.tLight;
      const bp = this.ctx.audio.beatPeriod(t);
      const path = (u: number) => ({ x: cx - 170 * (1 - u), y: cy + 130 * (1 - u) * (1 - u) + 30 * (1 - u) });
      if (d < 0 && d > -bp) {
        const h = path(1 + d / bp);
        sparkHead(this.glow, h.x, h.y, t, 0.8);
        sparkParticles(this.glow, t, (tb) => path(clamp(1 + (tb - this.tLight) / bp)), { rate: 70, life: 0.3, speed: 110, seed: 5 });
      }
      if (d >= 0) {
        const flick = 0.8 + 0.2 * Math.sin(t * 23.1) * Math.sin(t * 13.7);
        const e = LIN.ember, sgl = LIN.signal;
        const boom = Math.exp(-d / 0.18);
        this.glow.seg2(cx, cy + 4, cx, cy - 12, 14 * flick, [e[0] * 2.6 * flick, e[1] * 2.2 * flick, e[2] * 1.4 * flick], 0.9);
        this.glow.seg2(cx, cy, cx + 0.01, cy, 40 + 70 * boom, [sgl[0] * 0.6, sgl[1] * 0.45, sgl[2] * 0.25], 0.25 + 0.45 * boom);
        if (d < 0.35) sparkParticles(this.glow, t, () => ({ x: cx, y: cy }), { rate: 90, life: 0.3, speed: 200, seed: 9 });
      }
    }
  }
}
