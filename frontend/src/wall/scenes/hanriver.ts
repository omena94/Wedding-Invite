// 河濱夜野餐（暗、trip、雙語、日常服一）：夜晚的河濱公園，宣文和孟庭坐在格紋野餐墊上吃炸雞（一盒炸雞腿、兩罐飲料），
// 身後是寬寬的河、對岸的城市燈火，一座長長的拱橋橫過畫面。三隻狗在旁邊搶炸雞。角色是 Codex 畫的紙偶（c3-date 組的野餐坐姿、base 與 yuanyuan 的狗）。
//  - **兩行歌詞是橋上的燈字**：中文亮在橋面上方的欄杆燈帶、原文在橋面下方的鋼樑燈帶（小一號），各自逐字亮；
//    橋上一整排燈泡在拍點換顏色（訊號色、更熱的 ember、白光輪流），河面上是燈的倒影，跟著水波晃。沒有翻譯就只亮上面那條。
//  - 三隻狗（四小節一輪，三隻隨時都在畫面裡）：元元（大狗、穩重）守在炸雞盒旁邊坐著；芃芃從左邊壓低身子爬過來，小節線上叼走一支雞腿、
//    往左逃到外送袋前面；元元下一拍站起來叫一聲、再撲兩步追到芃芃面前，兩隻對峙（元元每兩拍叫一聲、芃芃叼著不放）；
//    趁亂 QQ 從孟庭旁邊溜到盒子前，下一個小節線也叼一支、坐在那裡得意地吃，孟庭笑出來。最後一小節元元坐回盒子旁、芃芃走回起點。
//  - **主打留言寫在外送單的「備註」欄**（左邊：釘在炸雞紙袋上的一張感熱紙收據），手寫字一個字一個字寫上去；照標準 v2：字 40～60、署名 26～32，
//    收據 ≤ 520 × 430（寬一點：「新婚快樂！！！」這種短句才不會被折成兩行）。沒有留言時備註欄寫邀請（字小、淡）。
//  - 動畫：對岸的窗戶一明一滅、河面的倒影與細浪、偶爾一艘小船的燈從河面滑過、拍點上橋燈換色、大鼓時燈字亮一下。鏡頭很慢地推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, msgChars, sparkHead, sparkParticles, type LyricStyle } from './_motifs';
import { drawNote, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, drawCycle, puppetPoint, puppetShadow, puppetIn, puppetLight, breathe, hop, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'trip', paper: false, energy: [0.25, 0.9], bars: [4, 8] };

/** 橋面（燈字的中線）、河的上下緣（對岸、這一岸）、野餐墊上坐的地面。 */
const DECK = 360, RIVER_TOP = 470, BANK = 770, FEET = 968;
const SZ = 430, DOG_S = 1.15;
/** 兩個人坐的位置、炸雞盒、三隻狗的位置。 */
const XW_X = 790, MT_X = 1140, BOX = { x: 965, y: 978 };
const YY_X = 655, QQ_X = 1300, PP_START = 250;
/** 搶雞腿的對峙：芃芃逃到外送袋前面（前景、收據的下面）、元元追到它右邊站住（離鏡頭近一點）。三隻狗隨時都在畫面裡，狗畫在收據前面。 */
const PP_STAND = 380, PP_GY = 1046, YY_STAND = 600, YY_GY = 1066;
/** 收據（留言）：最大的範圍與內距。 */
const RC = { x: 104, y: 440, w: 520, h: 430 };
const PAD = { x: 34, top: 150, bottom: 30 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const RECEIPT_TXT = '外送單 · ORDER炸雞 ×1飲料 ×2送達 河濱公園備註 NOTE' + '#0313';
const SPRITES = ['xw_picnic_sit', 'mt_picnic_sit', 'mt_picnic_laugh', 'pp_picnic_sneak', 'pp_picnic_steal', 'pp_walk',
  'qq_beg', 'qq_run_1', 'qq_run_2', 'qq_ball', 'yy_sit', 'yy_stand', 'yy_howl', 'yy_run_1', 'yy_run_2', 'yy_walk'];

/** 夜空與河：上面深藍黑、對岸地平線一層城市的光、河面比天空再暗一點，有很淡的水紋。 */
const NIGHT = () => new FSPass(/* glsl */ `
  uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col;
    if (p.y < ${RIVER_TOP}.0) {
      float y = p.y / ${RIVER_TOP}.0;
      col = mix(C_INK, mix(C_INK2, C_BLOOD, 0.14), smoothstep(0.1, 1.0, y));
      col += C_SIGNAL * 0.03 * exp(-pow((p.y - ${RIVER_TOP}.0) / 90.0, 2.0));
    } else {
      float d = (p.y - ${RIVER_TOP}.0) / ${BANK - RIVER_TOP}.0;
      col = mix(mix(C_INK2, C_BLOOD, 0.12), C_INK, smoothstep(0.0, 1.0, d));
      float w = snoise(vec2(p.x * 0.004, p.y * 0.05 - t * 0.6));
      col += C_BONE * 0.012 * smoothstep(0.55, 0.9, w) * (1.0 - d * 0.6);
    }
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 } });

interface Heist { t0: number; bar: number; bp: number }

export default class Hanriver extends Scene {
  night = shared('hanriver.night', NIGHT);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 燈的光暈與倒影（低解析度，加上去）。 */
  lights = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  rc = { ...RC };
  heists: Heist[] = [];
  mtKeys: [number, string][] = [];
  lyricSize = 48;
  msgT0 = 0;
  /** 橋上的燈泡（x）與對岸的窗戶。 */
  bulbs: number[] = [];

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + RECEIPT_TXT);
    this.track(await loadPuppets(SPRITES));
    // 搶炸雞：第一個小節線起四小節一輪（窗格短也至少演一次芃芃偷雞腿）
    const bp = au.beatPeriod(s);
    for (let t = barAfter(au, s + 0.3); t < e - bp * 2; t = au.timeOfBar(Math.round(au.barAt(t)) + 4)) {
      this.heists.push({ t0: t, bar: bp * 4, bp });
    }
    // 孟庭：平常坐著喝飲料；QQ 叼到雞腿的時候笑兩拍
    const ks: [number, string][] = [[-1e9, 'mt_picnic_sit']];
    for (const h of this.heists) ks.push([h.t0 + h.bar * 2, 'mt_picnic_laugh'], [h.t0 + h.bar * 2 + h.bp * 3, 'mt_picnic_sit']);
    this.mtKeys = ks;
    for (let x = 40; x < W; x += 46) this.bulbs.push(x);
    // 收據上的留言：標準 v2；收據的高度跟著留言（上緣固定）
    const c = this.fg.ctx;
    const tw = RC.w - PAD.x * 2, th = RC.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th) : noteV2(c, INVITE, null, tw, th * 0.6, { max: 40 });
    tightenNote(c, this.note, 220);
    this.rc.h = Math.min(RC.h, PAD.top + this.note.height + PAD.bottom + 10);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = s + 0.4;
    this.drawBackground();
  }

  /** 不會動的：對岸的天際線（窗戶另外每格畫）、橋（拱、吊索、橋面、橋墩）、這一岸的草地與野餐墊、炸雞紙袋。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 對岸的天際線
    let x = -10;
    for (let i = 0; x < W + 10; i++) {
      const w = 60 + 120 * hash(i, 3, 1), top = RIVER_TOP - 40 - 150 * hash(i, 3, 2) ** 1.5;
      c.fillStyle = mixRgba('ink', 'ink2', 0.4 + 0.6 * hash(i, 3, 3));
      c.fillRect(x, top, w, RIVER_TOP - top);
      x += w + 2;
    }
    // 橋：兩道大拱、吊索、橋面、橋墩（深色的剪影，邊緣一點點亮）
    c.strokeStyle = mixRgba('ink2', 'bone', 0.18);
    c.lineWidth = 5;
    for (const [a, b] of [[-200, 960], [960, 2120]] as const) {
      c.beginPath();
      c.moveTo(a, DECK - 30);
      c.quadraticCurveTo((a + b) / 2, DECK - 330, b, DECK - 30);
      c.stroke();
    }
    c.strokeStyle = mixRgba('ink2', 'bone', 0.08);
    c.lineWidth = 1.2;
    c.beginPath();
    for (const [a, b] of [[-200, 960], [960, 2120]] as const) {
      for (let k = 1; k < 16; k++) {
        const u = k / 16, xx = a + (b - a) * u;
        const yy = (1 - u) * (1 - u) * (DECK - 30) + 2 * u * (1 - u) * (DECK - 330) + u * u * (DECK - 30);
        c.moveTo(xx, yy); c.lineTo(xx, DECK - 44);
      }
    }
    c.stroke();
    // 橋面：上面欄杆的燈帶（中文燈字的底）、下面鋼樑的燈帶（原文），中間一條橋面
    // 欄杆（細細的直欄，透得到後面的天際線）與鋼樑（下面一條深色的梁）：燈字就亮在這兩條上
    c.fillStyle = rgba('ink2', 0.55);
    c.fillRect(0, DECK - 44, W, 44);
    c.strokeStyle = mixRgba('ink2', 'bone', 0.1);
    c.lineWidth = 2;
    c.beginPath();
    for (let px = 0; px < W; px += 18) { c.moveTo(px, DECK - 44); c.lineTo(px, DECK - 2); }
    c.moveTo(0, DECK - 44); c.lineTo(W, DECK - 44);
    c.stroke();
    c.fillStyle = mixRgba('ink', 'ink2', 0.6);
    c.fillRect(0, DECK - 4, W, 12);
    c.fillStyle = rgba('ink', 0.92);
    c.fillRect(0, DECK + 8, W, 38);
    c.fillStyle = rgba('ink');
    for (let px = 160; px < W; px += 420) c.fillRect(px - 26, DECK + 44, 52, RIVER_TOP - DECK - 44 + 30);
    // 這一岸：深色的草坡
    const g = c.createLinearGradient(0, BANK, 0, H);
    g.addColorStop(0, mixRgba('ink2', 'gingham', 0.12));
    g.addColorStop(1, rgba('ink'));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, BANK + 20); c.quadraticCurveTo(W / 2, BANK - 16, W, BANK + 30); c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fill();
    // 野餐墊：梯形（有透視），格紋
    const m0 = FEET - 70, m1 = FEET + 70, ml0 = 560, mr0 = 1330, ml1 = 520, mr1 = 1370;
    c.save();
    c.beginPath(); c.moveTo(ml0, m0); c.lineTo(mr0, m0); c.lineTo(Math.min(mr1, 1350), m1); c.lineTo(ml1, m1); c.closePath();
    c.clip();
    c.fillStyle = mixRgba('collar', 'ink', 0.55);
    c.fillRect(ml1, m0, mr1 - ml1, m1 - m0);
    c.fillStyle = mixRgba('bone', 'ink', 0.62);
    for (let k = 0; k < 20; k++) c.fillRect(ml1 + k * 44, m0, 22, m1 - m0);
    c.globalAlpha = 0.5;
    for (let y = m0; y < m1; y += 28) c.fillRect(ml1, y, mr1 - ml1, 14);
    c.restore();
    // 炸雞的紙袋（收據釘在上面）：牛皮紙色，只露出上半
    c.fillStyle = mixRgba('fur', 'ink', 0.55);
    c.beginPath(); c.moveTo(RC.x + 40, RC.y - 50); c.lineTo(RC.x + RC.w - 40, RC.y - 50); c.lineTo(RC.x + RC.w - 20, H); c.lineTo(RC.x + 20, H); c.closePath(); c.fill();
    c.fillStyle = mixRgba('fur', 'ink', 0.45);
    for (let k = 0; k < 10; k++) { c.beginPath(); c.moveTo(RC.x + 40 + k * 39, RC.y - 50); c.lineTo(RC.x + 58 + k * 39, RC.y - 66); c.lineTo(RC.x + 76 + k * 39, RC.y - 50); c.fill(); }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.glow.clear();
    this.night.u.t!.value = t;
    this.night.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    // 燈：橋上的燈泡、對岸的窗戶、倒影、燈字的光暈（低解析度那一層，加上去）
    const LL = this.lights, lc = LL.ctx;
    LL.clear();
    const beat = Math.floor(au.beatAt(t));
    const cols = ['signal', 'ember', 'bone'];
    const bulbCol = cols[((beat % 3) + 3) % 3]!;
    const kick = beatKick(au, t, 0.25);
    this.drawWindows(lc, t);
    for (const bx of this.bulbs) {
      // 燈泡在欄杆上緣與鋼樑下緣各一排；倒影是水面上一條晃動的短線
      for (const by of [DECK - 50, DECK + 48]) {
        lc.fillStyle = rgba(bulbCol, 0.75 + 0.25 * kick);
        lc.beginPath(); lc.arc(bx, by, 3, 0, Math.PI * 2); lc.fill();
      }
      const wob = 4 * Math.sin(t * 2.2 + bx * 0.05);
      lc.fillStyle = rgba(bulbCol, 0.22);
      lc.fillRect(bx - 2 + wob, RIVER_TOP + 30 + 60 * hash(bx, 5), 4, 40 + 60 * hash(bx, 6));
    }
    this.drawBoat(lc, t);
    const ly = lyricAt(lyrics, t);
    const st: LyricStyle = { family: F.hei(700), size: this.lyricSize, minSize: 40, maxWidth: 1500, align: 'center', unsung: rgba('bone', 0.2), sung: rgba('bone', 0.95), active: rgba('signal') };
    if (ly) {
      // 光暈：同一行歌詞在低解析度層再畫一次（燈字的暈光），大鼓時亮一下
      lc.save();
      lc.translate(W / 2, DECK - 10);
      lc.filter = 'none';
      drawLyric(lc, ly.line, t, { ...st, unsung: rgba('bone', 0) }, layoutLyric(lc, ly.line, st), ly.k * (0.35 + 0.3 * kick));
      lc.restore();
    }
    comp.draw(renderer, LL.upload(), out, { mode: 'add', tint: [1.6, 1.6, 1.6] });

    const L = this.fg; L.clear();
    const c = L.ctx;
    // ---- 燈字（中文在欄杆、原文在鋼樑）
    if (ly) {
      c.save();
      c.translate(W / 2, DECK - 10);
      const head = drawLyric(c, ly.line, t, st, layoutLyric(c, ly.line, st), ly.k * prog(t, s, s + 0.5));
      c.restore();
      if (head) sparkHead(this.glow, head.x + W / 2, head.y + DECK - 10 - this.lyricSize * 0.35, t, 0.45, 0.7);
    }
    // ---- 人和狗（這一層在燈字之後畫：打光只染紙偶，燈字不受影響，所以打光用紙偶自己的範圍）
    this.drawPeople(c, t);
    this.drawBox(c, t);
    // 收據釘在紙袋上（後面），狗在地上（前面）：狗跑到外送袋前面時不會被收據蓋住
    this.drawReceipt(c, t);
    this.drawDogs(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.85, vignette: 0.5, zoom: 1 + 0.028 * push, shake: [-(XW_X + 180 - W / 2) * 0.028 * push, -(700 - H / 2) * 0.028 * push] };
  }

  /** 對岸的窗戶：零星的暖光，一明一滅（每扇窗自己的節奏）；倒影是水裡一點淡淡的光。 */
  private drawWindows(c: CanvasRenderingContext2D, t: number) {
    for (let i = 0; i < 70; i++) {
      const x = 20 + (W - 40) * hash(i, 41), y = RIVER_TOP - 18 - (RIVER_TOP - DECK - 72) * hash(i, 42);
      const on = 0.5 + 0.5 * Math.sin(t * (0.2 + 0.5 * hash(i, 43)) + i * 3);
      if (on < 0.35) continue;
      c.fillStyle = mixRgba('signal', 'bone', 0.4, 0.3 * on);
      c.fillRect(x, y, 8, 10);
      c.fillRect(x, RIVER_TOP + (RIVER_TOP - y) * 0.6, 8, 3);
    }
  }

  /** 小船：每四小節從右往左滑過河面一次（船身剪影、一盞燈、身後拖一道水痕）。 */
  private drawBoat(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const bar = au.barAt(t);
    const u = ((bar / 4) % 1 + 1) % 1;
    const x = W + 200 - u * (W + 400), y = RIVER_TOP + 110;
    c.fillStyle = rgba('ember', 0.8);
    c.beginPath(); c.arc(x, y - 18, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('ember', 0.18);
    c.fillRect(x - 2, y, 4, 60);
    c.strokeStyle = rgba('bone', 0.12);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(x + 30, y + 6); c.lineTo(x + 260, y + 14); c.stroke();
  }

  /** 兩個人：坐在墊子上，宣文吃東西、孟庭喝飲料；跟著拍子輕輕點頭；QQ 偷到雞腿時孟庭笑。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const e0 = puppetIn(t, s + 0.05, 0.45), e1 = puppetIn(t, s + 0.14, 0.45);
    const sq = (ph: number) => breathe(t, 0.007, 3.1, ph) + 0.015 * beatKick(au, t, 0.3);
    if (e0.alpha > 0) {
      puppetShadow(c, 'xw', XW_X, FEET, { h: SZ, wide: 1.6, alpha: 0.6 * e0.alpha, color: '0,0,0' });
      drawPuppet(c, 'xw_picnic_sit', XW_X, FEET, { h: SZ, spin: e0.spin, alpha: e0.alpha, squash: sq(0) });
    }
    if (e1.alpha > 0) {
      puppetShadow(c, 'mt', MT_X, FEET, { h: SZ, wide: 1.6, alpha: 0.6 * e1.alpha, color: '0,0,0' });
      drawPick(c, this.mtKeys, t, MT_X, FEET, { h: SZ, spin: e1.spin, alpha: e1.alpha, squash: sq(0.4) });
    }
    // 夜裡：上面被橋燈照一點（暖）、下面暗
    puppetLight(c, [XW_X - 260, FEET - SZ, MT_X - XW_X + 520, SZ + 20], mixRgba('signal', 'ink', 0.7, 0.1), rgba('ink', 0.5));
  }

  /** 炸雞盒：牛皮紙盒、裡面疊著雞腿（金黃色的腿＋骨頭），兩罐飲料。 */
  private drawBox(c: CanvasRenderingContext2D, t: number) {
    const x = BOX.x, y = BOX.y;
    c.save();
    c.fillStyle = mixRgba('fur', 'ink', 0.45);
    c.beginPath(); c.moveTo(x - 80, y - 40); c.lineTo(x + 80, y - 40); c.lineTo(x + 70, y); c.lineTo(x - 70, y); c.closePath(); c.fill();
    for (let k = 0; k < 5; k++) drumstick(c, x - 58 + k * 29, y - 44 - 6 * Math.sin(k * 1.7), -0.6 + 0.3 * k, 0.9);
    c.fillStyle = mixRgba('fur', 'ink', 0.3);
    c.fillRect(x - 80, y - 40, 160, 10);
    for (const [cx, col] of [[x + 120, 'shirtblue'], [x + 150, 'gingham']] as const) {
      c.fillStyle = mixRgba(col, 'ink', 0.4);
      c.fillRect(cx - 12, y - 46, 24, 44);
      c.fillStyle = mixRgba('bone', 'ink', 0.4);
      c.fillRect(cx - 12, y - 48, 24, 5);
    }
    c.restore();
    void t;
  }

  /**
   * 三隻狗（四小節一輪）：第 0 小節芃芃從左邊爬向盒子 → 第 1 小節線叼走一支、往左跑 → 元元下一拍站起來叫、再下一拍追出去 →
   * QQ 趁亂溜到盒子前、第 2 小節線叼一支坐著吃 → 第 3 小節元元帶著芃芃走回來、QQ 回到孟庭旁邊。
   */
  private drawDogs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const h = [...this.heists].reverse().find((k) => t >= k.t0) ?? null;
    const base = (d: string, delay: number): PuppetOpts | null => {
      const en = puppetIn(t, s + delay, 0.4);
      return en.alpha > 0 ? { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha } : null;
    };
    const shadow = (d: string, x: number, lift = 0, gy = FEET + 20) => puppetShadow(c, d, x, gy, { h: SZ * DOG_S, lift, alpha: 0.5, color: '0,0,0' });
    const g = FEET + 20;
    const u = h ? (t - h.t0) / h.bar : -1;
    const bp = h?.bp ?? au.beatPeriod(t);
    // ---- 芃芃：爬向盒子 → 小節線叼走一支、往左逃到外送袋前面（前景、收據下面）→ 轉身跟元元對峙 → 走回起點
    const po = base('pp', 0.3);
    if (po) {
      let x = PP_START, gy = g, pose = 'pp_picnic_sneak', flip = false, lift = 0, sq = 0.03 * beatKick(au, t, 0.25);
      if (h && u < 1) { x = lerp(PP_START, BOX.x - 140, ease.inOutQuad(clamp(u))); x += 6 * Math.sin(au.beatAt(t) * Math.PI); }
      else if (h && u < 1.5) {
        // 逃：從盒子往左跑到外送袋前面（往鏡頭靠近一點，地面低一點）
        const k = (u - 1) / 0.5;
        x = lerp(BOX.x - 140, PP_STAND, ease.inOutQuad(k)); gy = lerp(g, PP_GY, k);
        pose = 'pp_picnic_steal'; flip = true; lift = hop(au.beatAt(t), 2) * 8;
      } else if (h && u < 3) {
        // 對峙：轉過來面對元元，叼著不放，元元叫的拍點縮一下
        x = PP_STAND; gy = PP_GY; pose = 'pp_picnic_steal'; sq = 0.06 * beatKick(au, t, 0.2);
      } else if (h) {
        // 還是被勸回去了：慢慢走回起點
        const k = (u - 3) / 1;
        x = lerp(PP_STAND, PP_START, ease.inOutQuad(k)); gy = lerp(PP_GY, g, k); pose = 'pp_walk'; flip = true; lift = hop(au.beatAt(t), 1) * 5;
      }
      shadow('pp', x, lift, gy);
      drawPuppet(c, pose, x, gy - lift, { ...po, flip, squash: sq });
    }
    // ---- 元元：守在盒子旁邊 → 站起來叫 → 往左撲兩步追到芃芃面前、對峙（每拍叫一聲）→ 坐回原位
    const yo = base('yy', 0.2);
    if (yo) {
      let x = YY_X, gy = g, pose = 'yy_sit', flip = false, lift = 0, sq = breathe(t, 0.012, 2.2) + 0.03 * beatKick(au, t, 0.3);
      const howlT = h ? h.t0 + h.bar + h.bp : Infinity;
      if (h && u >= 1 && t < howlT + h.bp) {
        // 叫一聲（一拍）：嘴邊冒聲波
        pose = t < howlT ? 'yy_stand' : 'yy_howl'; flip = true;
        if (t >= howlT) this.bark(c, x - 70, g - SZ * DOG_S * 0.36, t - howlT, h.bp);
      } else if (h && u >= 1 && u < 3) {
        // 撲兩步（一拍）停在芃芃右邊，之後站著對峙；第 2、4 拍各叫一聲
        const k = clamp((t - (howlT + h.bp)) / h.bp);
        x = lerp(YY_X, YY_STAND, ease.outCubic(k)); gy = lerp(g, YY_GY, ease.outCubic(k)); flip = true;
        if (k < 1) { lift = hop(au.beatAt(t), 2) * 8; shadow('yy', x, lift, gy); drawCycle(c, au, t, ['yy_run_1', 'yy_run_2'], 2, x, gy - lift, { ...yo, flip }); pose = ''; }
        else {
          pose = 'yy_stand'; sq += 0.04 * beatKick(au, t, 0.2);
          const b = Math.floor(au.beatAt(t)), bt = au.timeOfBeat(b);
          if (b % 2 === 1) this.bark(c, x - 110, gy - SZ * DOG_S * 0.3, t - bt, h.bp);
        }
      } else if (h && u >= 3 && u < 3.6) {
        // 走回盒子旁邊坐好
        const k = (u - 3) / 0.6;
        x = lerp(YY_STAND, YY_X, ease.inOutQuad(k)); gy = lerp(YY_GY, g, k); lift = hop(au.beatAt(t), 1) * 5;
        shadow('yy', x, lift, gy);
        drawPuppet(c, 'yy_walk', x, gy - lift, { ...yo });
        pose = '';
      }
      if (pose) {
        shadow('yy', x, 0, gy);
        drawPuppet(c, pose, x, gy, { ...yo, flip, squash: sq });
      }
    }
    // ---- QQ：在孟庭旁邊討吃的 → 趁亂溜到盒子前 → 叼一支坐著吃（得意）→ 回去
    const qo = base('qq', 0.38);
    if (qo) {
      const spot = BOX.x + 120;
      let x = QQ_X, pose = 'qq_beg', flip = true, lift = 0;
      if (h && u >= 1.25 && u < 2) {
        const k = (u - 1.25) / 0.75;
        x = lerp(QQ_X, spot, ease.inOutQuad(k)); lift = hop(au.beatAt(t), 2) * 7; pose = '';
        shadow('qq', x, lift);
        drawCycle(c, au, t, ['qq_run_1', 'qq_run_2'], 2, x, g - lift, { ...qo, flip: true });
      } else if (h && u >= 2 && u < 3.5) {
        x = spot; pose = 'qq_ball'; flip = false;
      } else if (h && u >= 3.5 && u < 4) {
        const k = (u - 3.5) / 0.5;
        x = lerp(spot, QQ_X, ease.inOutQuad(k)); lift = hop(au.beatAt(t), 2) * 7; pose = '';
        shadow('qq', x, lift);
        drawCycle(c, au, t, ['qq_run_1', 'qq_run_2'], 2, x, g - lift, { ...qo, flip: false });
      }
      if (pose) {
        const o: PuppetOpts = { ...qo, flip, hide: ['ball'], squash: 0.04 * beatKick(au, t, 0.25) + breathe(t, 0.015, 1.3, 0.5) };
        shadow('qq', x);
        drawPuppet(c, pose, x, g, o);
        if (pose === 'qq_ball') {
          // 叼到的雞腿：畫在圖上嘴的位置（圖上本來的網球蓋掉），嚼的時候上下動
          const m = puppetPoint('qq_ball', 'mouth', x, g, o);
          if (m) drumstick(c, m.x + 4, m.y + 4 + 3 * Math.sin(t * 14), 0.3, 1.1);
        }
      }
    }
    // 夜裡的打光（只染狗，範圍避開收據）
    void bp;
  }

  /** 叫聲：嘴邊往左上冒三道短弧，一拍內淡掉。 */
  private bark(c: CanvasRenderingContext2D, x: number, y: number, d: number, bp: number) {
    const u = d / bp;
    if (u > 1) return;
    c.save();
    c.strokeStyle = rgba('bone', 0.55 * (1 - u));
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const r = 14 + i * 13 + u * 26;
      c.beginPath(); c.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.45); c.stroke();
    }
    c.restore();
  }

  /** 外送單：感熱紙的收據（上下鋸齒邊、細細的字）、一枚釘書針釘在紙袋上；「備註」欄是手寫的留言，一個字一個字寫上去。 */
  private drawReceipt(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const R = this.rc;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    // 紙：鋸齒的下緣，暗處被橋燈照得有點暖
    c.fillStyle = rgba('ink', 0.5);
    c.fillRect(R.x + 8, R.y + 10, R.w, R.h);
    c.fillStyle = mixRgba('bone', 'signal', 0.06);
    c.beginPath();
    c.moveTo(R.x, R.y);
    c.lineTo(R.x + R.w, R.y);
    c.lineTo(R.x + R.w, R.y + R.h);
    for (let x = R.x + R.w; x > R.x; x -= 16) { c.lineTo(x - 8, R.y + R.h + 7); c.lineTo(x - 16, R.y + R.h); }
    c.closePath();
    c.fill();
    // 釘書針
    c.strokeStyle = mixRgba('ash', 'bone', 0.4);
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(R.x + R.w / 2 - 22, R.y + 14); c.lineTo(R.x + R.w / 2 + 22, R.y + 14); c.stroke();
    // 印好的字（mono，淡）
    c.font = font(F.mono(600), 20);
    c.fillStyle = rgba('ink', 0.75);
    c.fillText('外送單 · ORDER', R.x + PAD.x, R.y + 50);
    c.font = font(F.mono(500), 16);
    c.fillStyle = rgba('ink', 0.5);
    c.fillText('#0313', R.x + R.w - PAD.x - 50, R.y + 50);
    c.fillText('炸雞 ×1', R.x + PAD.x, R.y + 80);
    c.fillText('飲料 ×2', R.x + PAD.x + 150, R.y + 80);
    c.fillText('送達 河濱公園', R.x + PAD.x, R.y + 104);
    c.setLineDash([4, 4]);
    c.strokeStyle = rgba('ink', 0.3);
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(R.x + PAD.x, R.y + 118); c.lineTo(R.x + R.w - PAD.x, R.y + 118); c.stroke();
    c.setLineDash([]);
    c.fillStyle = rgba('ink', 0.55);
    c.fillText('備註 NOTE', R.x + PAD.x, R.y + 140);
    // 手寫的留言
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.09);
    const done = this.msgT0 + total * per;
    drawNote(c, n, R.x + PAD.x, R.y + PAD.top, {
      chars: this.msg ? Math.max(0, (t - this.msgT0) / per) : Infinity,
      color: this.msg ? rgba('ink', 0.92) : rgba('ink', 0.55), sigColor: rgba('ink', 0.7), sigK: this.msg ? prog(t, done + 0.1, done + 0.5) : 1,
    });
    c.restore();
  }
}

/** 一支炸雞腿：金黃色的腿、白色的骨頭頭；ang 是方向（弧度）、k 是大小。 */
function drumstick(c: CanvasRenderingContext2D, x: number, y: number, ang: number, k: number) {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(k, k);
  c.fillStyle = mixRgba('fur', 'blood', 0.35);
  c.beginPath(); c.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = mixRgba('fur', 'ember', 0.25);
  c.beginPath(); c.ellipse(-3, -3, 11, 6, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = mixRgba('bone', 'cream', 0.3);
  c.fillRect(14, -3, 16, 6);
  c.beginPath(); c.arc(31, -3, 4, 0, Math.PI * 2); c.arc(31, 3, 4, 0, Math.PI * 2); c.fill();
  c.restore();
}
