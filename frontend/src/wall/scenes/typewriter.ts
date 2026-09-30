// 打字機（批次 T10・機器 D，亮）：鏡頭對準一台奶油色琺瑯的老打字機的打字點，一張信紙夾在黑色的橡膠滾筒上。
//  - 主打留言一個字一個字打上去：每一下落在十六分／八分音符上（短留言一拍一字，長的密一點，兩小節內打完）。
//    每打一個字，下面扇形字籃裡的一根字桿「啪」地甩上來打在紙上（色帶跳上來），紙跟著滑車往左移一格。
//    一行打到頭：鈴「叮」一聲、滑車整個滑回來、滾筒轉一格把紙往上推一行。打完署名，最後再歸位一次，整段停在畫面上讀。
//    字是明體（中文打字機用的就是明體字模），每個字的墨色、位置、角度都有一點點不一樣，像真的打出來的。
//  - 上面是「現場歌詞」：這一行歌詞（逐字跟唱；亮版面：正在唱是訊號色的暗部＋螢光筆，唱完墨色）。純音樂：寫歌名。
//  - 沒有留言：打一段邀請。新人的留言：署名「新郎新娘」。
// 手法：打字機的機身、滾筒、字籃的洞是一個 shader（滾筒跟著滑車左右動、跟著換行轉）；紙與字、鈴、字桿每格重畫
// （紙上的字不到七十個，很便宜）；字桿用 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, lerp, TAU } from '../engine/util';
import { wrap } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, signature, beatAfter, drawHeart, DATE_DOTS, lyricSubOf, drawLyricSub } from './_motifs';
import { stagger, pad3 } from './_t11';
import { windowLines, type Rect } from './_t10';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: true, energy: [0.3, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素，y 向下）
// 打字點（字的基線）。鏡頭跟著紙走一半：打字時紙往左、機器（打字點、字籃）往右，各走滑車位移的一半，
// 所以一行可以打到 700 px 寬：打到頭時整行在 [PX0 − W/2, PX0 + W/2]，歸位後在 [PX0, PX0 + W]，兩邊都在安全範圍內。
// 標準 v2：信紙（留言的容器）寬 ≤ 860，只比字多一點邊。
const PX0 = 520, PY = 728;
const LINE_W = 700;
const MARGIN_L = 64, SHEET_W = LINE_W + 2 * MARGIN_L; // 信紙
const TOP_PAD = 50; // 第一行上面留的紙
const PAPER_TOP_MIN = 262; // 紙的上緣最高到這裡（上面是歌詞）
// 歌詞比留言小一級（MV 原則：焦點是打在紙上的留言）
const LYR = { x: 132, y: 100, w: 1200, base: 200 }; // 字級照標準 v2（lyricV2）
// 韓文歌（有原文副行）：歌詞用到整張桌面的寬（少折行），原文最後一排的基線放在信紙最高的上緣之上，整組往上長
const LYR_SUB = { w: 1640, base: 236 };
const PLATEN = { y0: 742, y1: 804 };
const BASKET = { cy: 1300, r: 390, a0: Math.PI * 1.13, a1: Math.PI * 1.87, n: 40 }; // 字籃（扇形，中心 x 跟著打字點）
const BELL = { dx: 430, y: 900 }; // 鈴（跟著機器走，在打字點右下；最右也不會進右下角 QR 的範圍）
/** 色帶的兩個捲軸（跟著機器走）：每打一個字、每個小節線各轉一格。 */
const SPOOLS = { dx: 300, y: 860, r: 44 };
const F_TYPE = F.ming(700);

interface Key { ch: string; line: number; x: number; adv: number; t: number; sig: boolean }

const INVITE = '親愛的新人：這一頁還空著，掃描右下角 QR code，把祝福打給你們。';
const TEXT = `現場歌詞純音樂叮${INVITE}新郎新娘一位賓客`;

// ---------------------------------------------------------------- 機身、滾筒、字籃（一個 shader）
const BODY = () => new FSPass(/* glsl */ `
  uniform float carr;   // 滑車位移（px，往左為正）
  uniform float feed;   // 換了幾行（滾筒轉動）
  uniform float lineH;
  uniform float shake;
  uniform float bx;     // 打字點（字籃中心）在畫面上的 x
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y) + vec2(0.0, shake);
    vec2 pm = p - vec2(bx, 0.0); // 機身座標（琺瑯的斑點跟著機器走）
    // 奶油色的琺瑯（帶一點主題色），細細的斑點
    vec3 enamel = mix(C_PAPER, C_BLOOD, 0.14) * (0.94 + 0.03 * fbm(pm / 180.0, 3));
    enamel *= 1.0 - 0.06 * step(0.997, hash12(floor(pm / 1.5)));
    vec3 col = enamel;
    // 放紙的斜板（紙後面，暗一點）
    float table = step(${PAPER_TOP_MIN - 20}.0, p.y) * step(p.y, ${PLATEN.y0}.0);
    col = mix(col, enamel * 0.86, table * (0.6 + 0.4 * smoothstep(${PAPER_TOP_MIN - 20}.0, ${PLATEN.y0}.0, p.y)));
    // 橡膠滾筒：跟著滑車左右移、跟著換行轉（表面的細紋）
    if (p.y > ${PLATEN.y0}.0 && p.y < ${PLATEN.y1}.0) {
      float u = (p.y - ${PLATEN.y0}.0) / ${PLATEN.y1 - PLATEN.y0}.0;
      float sh = 0.25 + 0.75 * pow(sin(3.14159 * u), 0.7);
      float grain = snoise(vec2((p.x + carr) * 0.08, u * 6.0 + feed * 1.7));
      col = C_INK2 * (0.8 + 0.8 * sh) + C_BONE * 0.08 * pow(1.0 - abs(u - 0.3) * 3.0, 3.0) * step(abs(u - 0.3), 0.33);
      col *= 0.95 + 0.05 * grain;
    }
    // 滾筒下面的前蓋與字籃的開口（深色的半圓洞）
    if (p.y >= ${PLATEN.y1}.0) {
      col = enamel * (0.9 - 0.12 * smoothstep(${PLATEN.y1}.0, ${H}.0, p.y));
      col *= 1.0 - 0.35 * exp(-(p.y - ${PLATEN.y1}.0) / 10.0);
      float d = length(p - vec2(bx, ${BASKET.cy}.0));
      float hole = smoothstep(${BASKET.r + 60}.0, ${BASKET.r + 56}.0, d) * step(${PLATEN.y1 + 22}.0, p.y);
      col = mix(col, mix(enamel, C_INK2, 0.42), hole);
      col = mix(col, enamel * 1.05, (1.0 - smoothstep(0.0, 3.0, abs(d - ${BASKET.r + 58}.0))) * step(${PLATEN.y1 + 22}.0, p.y) * 0.8);
    }
    fragColor = vec4(col, 1.0);
  }`, { carr: { value: 0 }, feed: { value: 0 }, lineH: { value: 64 }, shake: { value: 0 }, bx: { value: PX0 } });

export default class Typewriter extends Scene {
  body = shared('typewriter.body', BODY);
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  bars = this.track(new LineBatch(400, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(64, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  keys: Key[] = [];
  lineEnd: number[] = []; // 每一行打完時滑車的位置
  crT: [number, number][] = []; // 每次歸位的時間（開始、結束）
  S = 56; lineH = 80; nLines = 1;
  /** 署名、歌詞的字級（標準 v2）。 */
  sigSize = 30; lyrSize = 52;
  tFirst = 0; tDone = 0; beat = 0.5;
  /** 打字點現在在畫面上的 x（跟著滑車走一半）。 */
  px = PX0;
  hasLyrics = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const body = m ? m.text : INVITE;
    const sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${TEXT}${body}${sig}${song.title}${song.artist}`);
    this.beat = au.beatPeriod(s + 0.1);
    this.hasLyrics = windowLines(lyrics, s, e).length > 0;
    const c = this.dyn.ctx;

    // ---- 排字：等寬（中文一格、英文半格），英文字不拆；找最大的字級，總行數（含署名）≤ 6、紙不會頂到上面的歌詞
    const advOf = (ch: string, S: number) => (/[\x20-\x7e]/.test(ch) ? S * 0.6 : S);
    const place = (S: number) => {
      const out: { ch: string; line: number; x: number; adv: number; sig: boolean }[] = [];
      // 斷行用引擎的 wrap（標點禁則、不拆詞、平衡行寬）：量字用 Plex Mono（英文半格、中文接思源黑體一格），跟打字機的等寬格一致
      c.font = font(F.mono(500), S);
      const lines = wrap(c, body, LINE_W);
      let line = 0, x = 0, maxX = 0;
      lines.forEach((ln, li) => {
        line = li; x = 0;
        for (const ch of Array.from(ln)) {
          if (ch === ' ' && x === 0) continue;
          const a = advOf(ch, S);
          out.push({ ch, line, x, adv: a, sig: false });
          x += a;
        }
        maxX = Math.max(maxX, x);
      });
      // 署名永遠另起一行、靠右（在留言最後一行的下面，不會跟留言擠在一起），字級照標準 v2（26～32）
      let sigLine = line;
      if (sig) {
        const ss = sigV2(S);
        const sw = Array.from(sig).reduce((a, ch) => a + advOf(ch, ss), 0);
        sigLine = line + 1;
        let sx = LINE_W - sw;
        for (const ch of Array.from(sig)) { out.push({ ch, line: sigLine, x: sx, adv: advOf(ch, ss), sig: true }); sx += advOf(ch, ss); }
      }
      const n = sigLine + 1, lh = Math.round(S * 1.45);
      // 標準 v2：信紙露出來的高度 ≤ 430
      const paperH = (n - 1) * lh + S + TOP_PAD + (PLATEN.y0 - PY);
      return { out, n, lh, ok: n <= 6 && maxX <= LINE_W + 0.5 && (n - 1) * lh + S + TOP_PAD <= PY - PAPER_TOP_MIN && paperH <= V2.boxH };
    };
    // 標準 v2：字級上限依字數（40～60），往下找放得下的
    let lo: number = V2.msgMin, hi = msgMaxFor(body) + 0.5, best = place(lo);
    for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2, r = place(mid); if (r.ok) { best = r; lo = mid; } else hi = mid; }
    this.S = Math.max(V2.msgMin, Math.floor(lo)); best = place(this.S);
    this.lineH = best.lh; this.nLines = best.n;
    this.sigSize = sigV2(this.S);
    this.lyrSize = lyricV2(m ? this.S : null);

    // ---- 打字的時間：一個字一格，換行多兩格（歸位），第一拍起兩小節內（不超過窗格的四成五）打完
    const slots: number[] = [];
    let sl = 0;
    best.out.forEach((k, i) => {
      if (i > 0 && k.line !== best.out[i - 1]!.line) sl += 2;
      slots.push(sl++);
    });
    this.tFirst = beatAfter(au, s + 0.25);
    const times = stagger(au, this.tFirst, sl, Math.min(8 * this.beat, 0.45 * (e - s)));
    this.keys = best.out.map((k, i) => ({ ...k, t: times[slots[i]!]! }));
    // 每一行打完的位置、歸位的時間
    for (let L = 0; L < this.nLines; L++) {
      const ks = this.keys.filter((k) => k.line === L);
      this.lineEnd[L] = ks.length ? ks[ks.length - 1]!.x + ks[ks.length - 1]!.adv : 0;
    }
    for (let L = 0; L + 1 < this.nLines; L++) {
      const last = this.keys.filter((k) => k.line === L).pop(), next = this.keys.find((k) => k.line === L + 1);
      if (last && next) this.crT[L] = [last.t + 0.06, Math.max(last.t + 0.12, next.t - 0.03)];
    }
    const lastK = this.keys[this.keys.length - 1];
    this.tDone = lastK ? lastK.t : this.tFirst;
    // 最後一次歸位：整段停在打字點右邊（讀得完）
    this.crT[this.nLines - 1] = [this.tDone + 0.25, this.tDone + 0.25 + Math.max(0.3, this.beat * 0.6)];
    this.avoid = [
      [LYR.x - 16, LYR.y, LYR.w + 32, 150],
      [PX0 - LINE_W / 2 - 20, PAPER_TOP_MIN, 1.5 * LINE_W + 40, PY + 30 - PAPER_TOP_MIN],
    ];
  }

  /** 滑車位移（紙往左移了多少 px）與現在是第幾行（小數：換行中）。 */
  private carriage(t: number): { x: number; line: number } {
    let x = 0, line = 0;
    for (const k of this.keys) {
      if (k.t > t) break;
      // 擒縱：打下去之後一瞬間跳一格
      x = k.x + k.adv * ease.outExpo(prog(t, k.t + 0.015, k.t + 0.06));
      line = k.line;
    }
    const cr = this.crT[line];
    if (cr && t >= cr[0]) {
      const u = prog(t, cr[0], cr[1], ease.inOutCubic);
      const from = this.lineEnd[line] ?? x;
      x = from * (1 - u);
      // 最後一次歸位不換行（紙不再往上）
      if (line + 1 < this.nLines) return { x, line: line + ease.outCubic(prog(t, cr[0], cr[1])) };
    }
    return { x, line };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, e = this.ctx.end;
    const exit = prog(t, e - 0.3, e, ease.inCubic);
    const car = this.carriage(t);
    // 最近一次打字（字桿、色帶、震動）
    let hitK: Key | null = null;
    for (const k of this.keys) { if (k.t > t) break; hitK = k; }
    const hitAge = hitK ? t - hitK.t : 9;
    const thump = hitAge < 0.12 ? Math.exp(-hitAge / 0.03) : 0;
    const shake = 1.2 * thump + 1.0 * au.hit('kick', t, 0.08);
    this.px = PX0 + 0.5 * car.x;
    this.body.u.carr!.value = 0.5 * car.x;
    this.body.u.bx!.value = this.px;
    this.body.u.feed!.value = car.line;
    this.body.u.shake!.value = shake;
    this.body.render(renderer, out);

    const L = this.dyn, c = L.ctx, HL = this.hot, hc = HL.ctx;
    L.clear(); HL.clear();
    c.globalAlpha = hc.globalAlpha = 1 - exit;
    c.save(); c.translate(0, -shake);
    this.drawDecal(c);
    this.drawSheet(c, t, car);
    this.drawSpools(c, t);
    this.drawGuide(c, t, hitAge);
    this.drawBell(c, t);
    c.restore();
    const glow = this.drawLyric(c, hc, t);
    comp.draw(renderer, L.upload(), out);
    if (glow) comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.4, 1.4, 1.4] });
    this.drawBars(t, shake, out);
    // 鏡頭：整段慢慢推近（像跟拍打字的特寫），打字的那一下輕輕一震
    return { paper: 1, bloom: 0.4, vignette: 0.3, grain: 0.045, halation: 0.06, zoom: 1 + 0.035 * ease.inOutCubic(f.p) + 0.0025 * thump, popupAvoid: this.avoid };
  }

  // ---------------------------------------------------------------- 信紙
  private drawSheet(c: CanvasRenderingContext2D, t: number, car: { x: number; line: number }) {
    const S = this.S, lh = this.lineH;
    const ox = PX0 - 0.5 * car.x; // 這一行的行首在畫面上的 x
    const base0 = PY - car.line * lh; // 第 0 行的基線
    const top = base0 - S - TOP_PAD;
    const x0 = ox - MARGIN_L;
    // 紙：影子、紙本身（下緣捲進滾筒）
    c.fillStyle = rgba('sepia', 0.12); c.fillRect(x0 + 8, top + 10, SHEET_W, PLATEN.y0 - top);
    c.fillStyle = mixRgba('paper', 'bone', 0.55); c.fillRect(x0, top, SHEET_W, PLATEN.y0 + 6 - top);
    // 左上角印好的小字（信紙的抬頭）
    c.font = font(F.mono(500), 13); c.letterSpacing = '3px'; c.fillStyle = rgba('blood', 0.55);
    c.fillText(`No.${this.msg ? pad3(this.msg.n) : '000'}  ·  ${DATE_DOTS}`, x0 + 26, top + 30);
    c.letterSpacing = '0px';
    // 打出來的字
    c.font = font(F_TYPE, S);
    c.textBaseline = 'alphabetic';
    for (const k of this.keys) {
      if (k.t > t) break;
      const sz = k.sig ? this.sigSize : S;
      const x = ox + k.x, y = base0 + k.line * lh;
      if (y > PLATEN.y0 + 4) continue;
      // 每個字的墨色、位置、角度都有一點點不一樣（字模磨損、色帶新舊）
      const r1 = hash(k.line * 131 + k.x, 1), r2 = hash(k.line * 131 + k.x, 2), r3 = hash(k.line * 131 + k.x, 3);
      c.save();
      c.translate(x + (r1 - 0.5) * 1.6, y + (r2 - 0.5) * 2.2);
      c.rotate((r3 - 0.5) * 0.02);
      // 英文與數字用等寬字（真的打字機字模），中文用明體
      c.font = font(/[!-~]/.test(k.ch) ? F.mono(500) : F_TYPE, /[!-~]/.test(k.ch) ? sz * 0.98 : sz);
      if (k.ch === '♥') drawHeart(c, k.adv / 2, -sz * 0.36, sz * 0.7);
      else {
        c.globalAlpha *= 0.82 + 0.18 * r2;
        c.fillStyle = rgba('ink', 0.92);
        c.fillText(k.ch, 0, 0);
        // 重打的一點點殘影（字桿彈回時又輕輕碰了一下）
        if (r1 > 0.7) { c.globalAlpha *= 0.18; c.fillText(k.ch, 0.8, -0.6); }
      }
      c.restore();
      // 剛打上去：打字點一小團墨
    }
  }

  /** 放紙的斜板上的廠牌（自己編的）：跟著機器走，紙往上捲會把它蓋住。 */
  private drawDecal(c: CanvasRenderingContext2D) {
    const x = this.px + 420, y = 318;
    c.save();
    c.textAlign = 'center';
    c.font = font(F.serif(600, true), 60); c.fillStyle = rgba('blood', 0.2);
    c.fillText('Love Letter', x, y);
    c.font = font(F.mono(500), 13); c.letterSpacing = '6px'; c.fillStyle = rgba('blood', 0.25);
    c.fillText('MODEL AO-313', x, y + 32);
    c.letterSpacing = '0px';
    c.restore();
  }

  /** 打字點：字導（中間有槽的金屬片）、色帶（打字時跳上來）、左右兩邊的紙壓（跟著滑車走）。 */
  private drawGuide(c: CanvasRenderingContext2D, _t: number, hitAge: number) {
    const lift = hitAge < 0.1 ? Math.sin(Math.PI * clamp(hitAge / 0.1)) : 0;
    // 色帶：兩色（上黑下訊號色的暗部），平常在打字點下面，打字時跳上來
    const ry = PY + 22 - lift * 36;
    const PX = this.px;
    c.fillStyle = rgba('ink', 0.85); c.fillRect(PX - 60, ry - 10, 140, 10);
    c.fillStyle = rgba('blood', 0.85); c.fillRect(PX - 60, ry, 140, 10);
    // 字導
    c.fillStyle = mixRgba('ash', 'bone', 0.35);
    c.beginPath(); c.moveTo(PX - 26, PY + 30); c.lineTo(PX - 8, PY + 8); c.lineTo(PX + this.S * 0.5 + 8, PY + 8); c.lineTo(PX + this.S * 0.5 + 26, PY + 30); c.closePath(); c.fill();
    c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 1.2; c.stroke();
    c.fillStyle = rgba('ink', 0.7); c.fillRect(PX + 2, PY + 10, this.S * 0.5 - 4, 6);
    // 打字點的小刻度（紅色的指標）
    c.fillStyle = rgba('blood', 0.8);
    c.beginPath(); c.moveTo(PX, PY + 34); c.lineTo(PX - 6, PY + 44); c.lineTo(PX + 6, PY + 44); c.closePath(); c.fill();
  }

  /**
   * 色帶的兩個捲軸（左右各一，跟著機器走）：每打一個字，色帶往前走一格、捲軸跟著轉一下；
   * 打完之後每個小節線色帶再自動走一格（標準 v2：留言打完，機器也不會整個停住）。
   */
  private drawSpools(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    // 轉了幾格：已經打的字數＋窗格開始後過了幾個小節線；最近一格用彈簧補間（純函數，看時間算）
    let n = 0, last = -Infinity;
    for (const k of this.keys) { if (k.t > t) break; n++; last = k.t; }
    const b0 = Math.ceil(au.barAt(s) - 1e-6), bNow = Math.floor(au.barAt(t) + 1e-6);
    const bars = Math.max(0, bNow - b0 + 1);
    if (bars > 0) last = Math.max(last, au.timeOfBar(bNow));
    const steps = n + 2 * bars;
    const ang = (steps - 1 + ease.outBack(prog(t, last, last + 0.12))) * 0.32;
    const ry = PY + 22;
    for (const side of [-1, 1] as const) {
      const x = this.px + side * SPOOLS.dx, y = SPOOLS.y, r = SPOOLS.r;
      // 色帶：從捲軸上緣拉到打字點兩邊
      c.strokeStyle = rgba('ink', 0.55); c.lineWidth = 7;
      c.beginPath(); c.moveTo(x - side * r * 0.2, y - r * 0.75); c.lineTo(this.px + side * 70, ry + 4); c.stroke();
      // 杯子（金屬）＋捲著的色帶（深色的圓）＋三根輻條
      c.fillStyle = rgba('sepia', 0.18); c.beginPath(); c.arc(x + 4, y + 6, r + 3, 0, Math.PI * 2); c.fill();
      const g = c.createRadialGradient(x - r * 0.4, y - r * 0.5, 4, x, y, r);
      g.addColorStop(0, mixRgba('bone', 'ash', 0.2)); g.addColorStop(1, mixRgba('ash', 'sepia', 0.35));
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = rgba('ink', 0.78); c.beginPath(); c.arc(x, y, r * 0.72, 0, Math.PI * 2); c.fill();
      c.strokeStyle = mixRgba('ash', 'bone', 0.4); c.lineWidth = 3; c.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const a = side * ang + (k / 3) * Math.PI * 2;
        c.beginPath(); c.moveTo(x + Math.cos(a) * r * 0.16, y + Math.sin(a) * r * 0.16); c.lineTo(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62); c.stroke();
      }
      c.fillStyle = mixRgba('ash', 'bone', 0.5); c.beginPath(); c.arc(x, y, r * 0.14, 0, Math.PI * 2); c.fill();
    }
  }

  /** 鈴：每一行打完「叮」一下（鈴錘敲下去、一圈聲波、小小的「叮」字）。 */
  private drawBell(c: CanvasRenderingContext2D, t: number) {
    let ring = 0;
    for (let L = 0; L < this.crT.length; L++) {
      const cr = this.crT[L];
      if (!cr) continue;
      ring = Math.max(ring, pulse(t, cr[0] - 0.05, 0.18));
    }
    const x = this.px + BELL.dx, y = BELL.y;
    // 鈴身（金屬半球）
    const g = c.createRadialGradient(x - 10, y - 12, 4, x, y, 34);
    g.addColorStop(0, mixRgba('bone', 'signal', 0.3)); g.addColorStop(1, mixRgba('blood', 'ash', 0.3));
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, 30, Math.PI, TAU); c.lineTo(x + 30, y + 6); c.lineTo(x - 30, y + 6); c.closePath(); c.fill();
    c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 1.5; c.stroke();
    // 鈴錘：右邊一根短臂＋小球，響的時候敲到鈴的邊緣
    const pv = { x: x + 52, y: y + 30 };
    const a = -2.3 + 0.55 * ring;
    const bx = pv.x + Math.cos(a) * 34, by = pv.y + Math.sin(a) * 34;
    c.strokeStyle = rgba('sepia', 0.75); c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(pv.x, pv.y); c.lineTo(bx, by); c.stroke();
    c.fillStyle = rgba('sepia', 0.85); c.beginPath(); c.arc(bx, by, 6, 0, TAU); c.fill();
    c.beginPath(); c.arc(pv.x, pv.y, 4, 0, TAU); c.fill();
    if (ring > 0.05) {
      c.strokeStyle = rgba('blood', 0.6 * ring); c.lineWidth = 2;
      for (const r of [44, 62]) { c.beginPath(); c.arc(x, y - 6, r + (1 - ring) * 20, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
      c.font = font(F.hei(700), 22); c.fillStyle = rgba('blood', 0.8 * ring); c.textAlign = 'center';
      c.fillText('叮', x, y - 56 - (1 - ring) * 16);
      c.textAlign = 'left';
    }
  }

  /** 扇形字籃：幾十根字桿平躺著，打字的那一根甩上來打在打字點。 */
  private drawBars(t: number, shake: number, out: THREE.WebGLRenderTarget) {
    const B = this.bars, G = this.glow;
    B.clear(); G.clear();
    const steel = LIN.graphite, hiC = LIN.bone;
    let hitK: Key | null = null;
    for (const k of this.keys) { if (k.t > t) break; hitK = k; }
    const age = hitK ? t - hitK.t : 9;
    const which = hitK ? Math.floor(hash(hitK.ch.codePointAt(0) ?? 0, 7) * BASKET.n) : -1;
    for (let i = 0; i < BASKET.n; i++) {
      const a = lerp(BASKET.a0, BASKET.a1, (i + 0.5) / BASKET.n);
      const bcx = this.px + this.S * 0.25;
      const px = bcx + Math.cos(a) * BASKET.r, py = BASKET.cy + Math.sin(a) * BASKET.r - shake;
      // 平躺：從轉軸往中心伸一小段（透視縮短）
      const rx = px + (bcx - px) * 0.28, ry = py + (BASKET.cy - py) * 0.28;
      let tx = rx, ty = ry, w = 3.2;
      if (i === which && age < 0.16) {
        // 甩上來：0.04 秒打到紙，停一下，再落回去
        const u = age < 0.04 ? ease.inQuad(age / 0.04) : age < 0.06 ? 1 : 1 - ease.outCubic((age - 0.06) / 0.1);
        const sx = this.px + this.S * 0.25, sy = PY - this.S * 0.3;
        // 弧線：中間經過一個往外鼓的控制點
        const cx = (rx + sx) / 2 + (rx - bcx) * 0.25, cy = (ry + sy) / 2 + 40;
        const q = u;
        tx = (1 - q) * (1 - q) * rx + 2 * (1 - q) * q * cx + q * q * sx;
        ty = (1 - q) * (1 - q) * ry + 2 * (1 - q) * q * cy + q * q * sy;
        w = 4;
        if (u > 0.85) G.seg2(sx, sy, sx + 0.01, sy, 16, [LIN.signal[0] * 1.2, LIN.signal[1] * 1.2, LIN.signal[2] * 1.2], (u - 0.85) / 0.15);
      }
      const striking = i === which && age < 0.16;
      B.seg2(px, py, tx, ty, w, steel, striking ? 1 : 0.55);
      B.seg2(px, py - 1, tx, ty - 1, 1, hiC, striking ? 0.6 : 0.3);
      // 字桿頭上的字模（一小塊）
      B.seg2(tx, ty, tx + (tx - px) * 0.04, ty + (ty - py) * 0.04, 8, LIN.ink2, striking ? 1 : 0.5);
    }
    B.render(this.ctx.renderer, out);
    if (G.count) G.render(this.ctx.renderer, out);
  }

  /** 現場歌詞：這一行（逐字跟唱）。純音樂：歌名。 */
  private drawLyric(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number): boolean {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t, 1.4);
    const sub = ly ? lyricSubOf(ly.line) : null;
    const st = { family: F.archivo(100, 800), size: this.lyrSize, minSize: V2.lyrMin, maxWidth: sub ? LYR_SUB.w : LYR.w, lineHeight: 1.06 };
    const lay = ly ? layoutLyric(c, ly.line, st) : null;
    // 標籤：有原文、中文又折兩行時，第一行會長到標籤那裡，這時候不畫
    if (!(lay?.sub && lay.rows.length > 1)) {
      c.font = font(F.mono(500), 15); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.65);
      c.fillText(this.hasLyrics ? '♪  現場歌詞　LIVE' : '♪  本頁配樂', LYR.x, LYR.y + 22);
      c.letterSpacing = '0px';
    }
    if (!ly || !lay) {
      if (!this.hasLyrics) { c.font = font(F.archivo(100, 800), this.lyrSize); c.fillStyle = rgba('sepia', 0.9); c.fillText(song.title || '今晚的歌', LYR.x, LYR.base); }
      return false;
    }
    const y0 = lay.sub ? LYR_SUB.base - (lay.height - lay.size) : LYR.base - (lay.rows.length - 1) * lay.size * 1.06 * 0.6;
    let glow = false;
    c.save(); c.globalAlpha *= ly.k;
    c.font = font(st.family, lay.size);
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      const x = LYR.x + pw.x, y = y0 + pw.y;
      if (p > 0 && p < 1) { c.fillStyle = rgba('signal', 0.5); c.fillRect(x - 4, y - lay.size * 0.26, (pw.w + 8) * p, lay.size * 0.36); }
      c.fillStyle = rgba('sepia', 0.3);
      if (p < 1) c.fillText(pw.word.w, x, y);
      if (p <= 0) continue;
      c.save(); c.beginPath(); c.rect(x - 6, y - lay.size * 1.1, (pw.w + 12) * p, lay.size * 1.5); c.clip();
      c.fillStyle = p < 1 ? rgba('blood') : rgba('sepia');
      c.fillText(pw.word.w, x, y);
      c.restore();
      // 亮版面不加光暈：加亮疊在紙上會把深色的字洗淡
    }
    // 原文副行（韓文歌）：小一號、墨色、不上螢光筆（比中文安靜）
    if (sub && lay.sub) {
      c.translate(LYR.x, y0 + lay.sub.dy);
      drawLyricSub(c, sub, t, { ...st, sung: rgba('sepia'), unsung: rgba('sepia', 0.3) }, lay.size, c.globalAlpha);
    }
    c.restore();
    return glow;
  }
}
