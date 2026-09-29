// 夜市（暗、date、日常服二）：射氣球的攤位側面。宣文在左邊端著空氣槍瞄準右邊一整面氣球牆，孟庭在他身後拍手加油。
// 角色是 Codex 畫的紙偶（xw2_balloon_aim／fire／win、mt2_market_clap／cheer、cp2_market_prize，_puppet.ts），攤位、氣球、燈、字是程式畫的。
//  - **每一拍開一槍**（開槍那一下換成後座力那張、槍口一閃、身體往後震），軟木塞飛過去打中一顆氣球——那一整行（直的一行）
//    由上往下接連爆開（碎片、閃光），**氣球後面的木板上寫著主打留言**，一行一行被打出來（從左到右，像掀開一樣）。
//    孟庭每爆一次就跟著彈一下。全部打完的下一個小節線：宣文舉槍歡呼、孟庭拎著金魚袋跳起來（最高點在拍點）；
//    窗格夠長時再下一個小節線換成兩人抱著大熊的合照（紙偶翻面換圖），跟著拍子左右晃，老闆每兩小節幫他們拍一張照（閃一下）。
//  - 照「留言尺寸與版面比例標準 v2」：字 40～60、署名 26～32，木板 780 × 400（≤ 860 × 430），在畫面右半邊。沒有留言時木板寫邀請（字小）。
//  - 歌詞：攤位的招牌（左上，雨棚下面掛著的燈箱）逐字亮，比留言小一級。
//  - 雨棚邊的燈泡照拍子一顆一顆跑（小節線全亮），背景是別的攤位的散景燈、隔壁攤飄過來的白煙。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, barAfter, beatAfter, sparkHead, sparkParticles, type LyricStyle } from './_motifs';
import { drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetPoint, puppetShadow, puppetIn, puppetLight, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'date', paper: false, energy: [0.4, 1], bars: [4, 8] };

const GROUND = 1010, SZ = 520;
const XW_X = 560, MT_X = 250, PRIZE_X = 420;
/** 氣球牆後面的木板（寫留言）與氣球的格子。 */
const BOARD = { x: 1030, y: 200, w: 780, h: 400 };
const COLS = 6, ROWS = 4;
const PAD = 40;
/** 攤位招牌（歌詞）：左上、雨棚下面。 */
const SIGN = { x: 110, y: 132, w: 800, h: 92 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['xw2_balloon_aim', 'xw2_balloon_fire', 'xw2_balloon_win', 'mt2_market_clap', 'mt2_market_cheer', 'cp2_market_prize'];
/** 氣球的顏色（固定色：夜市的氣球不跟著主題換）。 */
const BALLOON = ['collar', 'ball', 'shirtblue', 'rose', 'fur', 'gingham'];

/** 夜市的空氣：上面深、下面（攤位的燈）暖，右邊氣球牆那邊被攤位的燈照亮一點。 */
const AIR = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float y = p.y / ${H}.0;
    vec3 col = mix(C_INK, mix(C_INK2, C_BLOOD, 0.25), smoothstep(0.0, 1.0, y));
    vec2 q = (p - vec2(1420.0, 400.0)) / vec2(700.0, 460.0);
    col += C_SIGNAL * 0.05 * exp(-dot(q, q) * 1.5);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

interface Shot { t: number; cols: number[] }

export default class Nightmarket extends Scene {
  air = shared('nightmarket.air', AIR);
  bokeh = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  shots: Shot[] = [];
  /** 每一顆氣球爆開的時間（沒被打到 = Infinity）。 */
  popT: number[] = [];
  xwKeys: [number, string][] = [];
  tWin = Infinity; tPrize = Infinity;
  muzzle: Pt = { x: 0, y: 0 };
  lyricSize = 48;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    this.muzzle = puppetPoint('xw2_balloon_aim', 'muzzle', XW_X, GROUND, { h: SZ }) ?? { x: XW_X + 330, y: GROUND - 440 };
    // 開槍：第一拍起每一拍一槍；窗格太短就一槍打兩行
    const b0 = Math.round(au.beatAt(beatAfter(au, s + 0.55)));
    const beatsLeft = Math.floor(au.beatAt(e) - b0) - 2;
    const nShots = clamp(Math.min(COLS, beatsLeft), 2, COLS);
    const per = Math.ceil(COLS / nShots);
    for (let i = 0, c = 0; c < COLS; i++) {
      const cols: number[] = [];
      for (let k = 0; k < per && c < COLS; k++) cols.push(c++);
      this.shots.push({ t: au.timeOfBeat(b0 + i), cols });
    }
    this.popT = new Array(COLS * ROWS).fill(Infinity);
    for (const sh of this.shots) {
      for (const col of sh.cols) for (let r = 0; r < ROWS; r++) {
        // 打中那一行最上面的一顆（軟木塞飛 0.08 秒），往下一顆一顆接著爆
        this.popT[r * COLS + col] = sh.t + 0.08 + r * 0.045 + (col - sh.cols[0]!) * 0.03;
      }
    }
    const last = this.shots[this.shots.length - 1]!.t;
    const bp = au.beatPeriod(s);
    const win = barAfter(au, last + bp * 0.6);
    if (win < e - bp) this.tWin = win;
    const prize = barAfter(au, win + bp * 0.5);
    if (prize < e - bp * 2) this.tPrize = prize;
    // 宣文：瞄準 → 每一槍換成後座力那張 0.14 秒 → 歡呼
    const ks: [number, string][] = [[-1e9, 'xw2_balloon_aim']];
    for (const sh of this.shots) ks.push([sh.t, 'xw2_balloon_fire'], [sh.t + 0.14, 'xw2_balloon_aim']);
    if (this.tWin < Infinity) ks.push([this.tWin, 'xw2_balloon_win']);
    this.xwKeys = ks;
    // 木板上的留言：手寫字、標準 v2
    const c = this.fg.ctx;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, BOARD.w - PAD * 2, BOARD.h - PAD * 2) : noteV2(c, INVITE, null, BOARD.w * 0.6, 120, { max: 40 });
    // 寬度縮到實際的字寬（署名靠右對齊到字的右緣，整塊在木板上置中）
    tightenNote(c, this.note, 200);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBokeh();
    this.drawStall();
  }

  /** 背景：別的攤位的燈（散景的暖色圓點）、遠遠的一串串燈籠。畫一次（低解析度，本來就是糊的）。 */
  private drawBokeh() {
    const L = this.bokeh, c = L.ctx;
    L.clear();
    // 左半邊（攤位外面的走道）才看得到；小、淡，不要搶人和木板
    for (let i = 0; i < 60; i++) {
      const x = 980 * hash(i, 1), y = 250 + 480 * hash(i, 2), r = 6 + 20 * hash(i, 3) ** 2;
      const warm = hash(i, 4) < 0.75;
      c.fillStyle = warm ? mixRgba('signal', 'ember', hash(i, 5), 0.06 + 0.1 * hash(i, 6)) : mixRgba('bone', 'shirtblue', 0.5, 0.06);
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    L.upload();
  }

  /** 攤位（不會動的部分）：地面、雨棚（紅白條紋、波浪邊）、木板（留言寫在上面）、木板的框、前面的台子與槍架、招牌的燈箱。 */
  private drawStall() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 地面
    const g = c.createLinearGradient(0, GROUND - 60, 0, H);
    g.addColorStop(0, mixRgba('ink', 'ink2', 0.6, 0));
    g.addColorStop(0.3, rgba('ink2'));
    g.addColorStop(1, rgba('ink'));
    c.fillStyle = g;
    c.fillRect(0, GROUND - 60, W, H - GROUND + 60);
    // 氣球牆的背板（木頭，深色）與寫字的木板（米白，被燈照亮）
    const B = BOARD;
    c.fillStyle = mixRgba('ink2', 'fur', 0.18);
    c.fillRect(B.x - 40, 110, B.w + 110, 700);
    const bg = c.createLinearGradient(0, B.y, 0, B.y + B.h);
    bg.addColorStop(0, mixRgba('cream', 'bone', 0.4));
    bg.addColorStop(1, mixRgba('cream', 'fur', 0.25));
    c.fillStyle = bg;
    c.fillRect(B.x, B.y, B.w, B.h);
    c.strokeStyle = mixRgba('fur', 'ink', 0.5);
    c.lineWidth = 8;
    c.strokeRect(B.x - 4, B.y - 4, B.w + 8, B.h + 8);
    // 木紋（很淡）
    c.strokeStyle = rgba('sepia', 0.035);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let y = B.y + 30; y < B.y + B.h; y += 88) { c.moveTo(B.x + 6, y); c.bezierCurveTo(B.x + B.w * 0.3, y - 5, B.x + B.w * 0.7, y + 5, B.x + B.w - 6, y); }
    c.stroke();
    // 前面的台子（木頭檯面、正面一塊板）
    const top = 780;
    c.fillStyle = mixRgba('fur', 'ink', 0.45);
    c.fillRect(900, top, 1020, 14);
    // 台子正面暗一點、木板的縫只畫在 HUD 區左邊（右下角保持乾淨）
    c.fillStyle = mixRgba('fur', 'ink', 0.78);
    c.fillRect(910, top + 14, 1000, GROUND - top - 14);
    c.strokeStyle = rgba('bone', 0.06);
    c.lineWidth = 1;
    c.beginPath(); for (let x = 960; x < 1330; x += 90) { c.moveTo(x, top + 20); c.lineTo(x, GROUND - 8); } c.stroke();
    // 雨棚：紅白條紋，下緣波浪邊
    const aw = 104;
    for (let x = 0, i = 0; x < W; x += 80, i++) {
      c.fillStyle = i % 2 ? mixRgba('bone', 'ink', 0.2) : mixRgba('collar', 'ink', 0.25);
      c.fillRect(x, 0, 80, aw);
      c.beginPath(); c.arc(x + 40, aw, 40, 0, Math.PI); c.fill();
    }
    c.fillStyle = rgba('ink', 0.35);
    c.fillRect(0, 0, W, 30);
    // 招牌的燈箱（歌詞寫在上面）
    const S = SIGN;
    c.fillStyle = rgba('ink', 0.85);
    c.fillRect(S.x - 6, S.y - 6, S.w + 12, S.h + 12);
    const sg = c.createLinearGradient(0, S.y, 0, S.y + S.h);
    sg.addColorStop(0, mixRgba('ink2', 'signal', 0.14));
    sg.addColorStop(1, mixRgba('ink2', 'signal', 0.06));
    c.fillStyle = sg;
    c.fillRect(S.x, S.y, S.w, S.h);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.glow.clear();
    this.air.render(renderer, out);
    comp.draw(renderer, this.bokeh.texture, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;

    // ---- 人（這一層最先畫：打光只染紙偶）
    this.drawPeople(c, t);
    // ---- 木板上的留言、氣球、軟木塞
    this.drawBoard(c, t);
    this.drawBalloons(c, t);
    this.drawCork(t);
    // ---- 招牌上的歌詞、雨棚的燈泡、煙
    this.drawSign(c, t);
    this.drawBulbs(t);
    this.drawSteam(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const fx = BOARD.x + BOARD.w / 2, fy = BOARD.y + BOARD.h / 2;
    const kick = this.shots.some((sh) => t >= sh.t && t < sh.t + 0.12) ? 0.004 : 0;
    // 拿到大熊之後，老闆每兩小節幫他們拍一張照：小節線上閃一下
    let flash = 0;
    if (t >= this.tPrize) {
      const b = Math.floor(au.barAt(t)), b0 = Math.round(au.barAt(this.tPrize));
      if ((b - b0) % 2 === 0) flash = 0.18 * Math.exp(-Math.max(0, t - au.timeOfBar(b)) / 0.12);
    }
    return { bloom: 0.8, vignette: 0.5, flash, zoom: 1 + 0.028 * push + kick, shake: [-(fx - W / 2) * 0.028 * push, -(fy - H / 2) * 0.028 * push] };
  }

  /** 宣文（瞄準、開槍、歡呼）與孟庭（拍手、跳起來），或最後兩人抱著大熊的合照。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    const box = [0, GROUND - SZ * 1.25, 1000, SZ * 1.3] as const;
    if (t >= this.tPrize) {
      // 合照：從側面翻正換上來，拍點上輕輕彈
      const en = puppetIn(t, this.tPrize, 0.45);
      puppetShadow(c, 'cp2_market_prize', PRIZE_X, GROUND, { h: SZ, alpha: 0.7, color: '0,0,0' });
      // 抱著大熊跟著拍子左右晃（每小節換邊）、拍點上彈一下
      const sw = 0.025 * Math.sin(au.barAt(t) * Math.PI * 2);
      drawPuppet(c, 'cp2_market_prize', PRIZE_X, GROUND, { h: SZ, spin: en.spin, rot: sw, pivot: 0, squash: breathe(t, 0.006, 2.8) + 0.02 * beatKick(au, t, 0.25) });
      puppetLight(c, box, rgba('ink', 0.08), rgba('ink', 0.5));
      return;
    }
    const out = this.tPrize < Infinity ? prog(t, this.tPrize - bp * 0.4, this.tPrize, ease.inCubic) * 0.25 : 0;
    // 孟庭：拍手（每爆一顆就彈一下）→ 歡呼跳起來（最高點在打完之後的小節線後一拍）
    const e1 = puppetIn(t, s + 0.14, 0.45);
    if (e1.alpha > 0) {
      let lift = 0, sq = breathe(t, 0.008, 2.7, 0.3) + 0.04 * beatKick(au, t, 0.22);
      let pose = 'mt2_market_clap';
      if (t >= this.tWin) {
        pose = 'mt2_market_cheer';
        const apex = this.tWin + bp;
        const j = jumpArc(t, apex - bp * 0.6, apex + bp * 0.6, 60, { crouch: 0.1, land: 0.14 });
        lift = -j.y; sq = j.squash;
        if (!j.air && t > apex + bp * 0.6) { const j2 = jumpArc(t, apex + bp * 1.4, apex + bp * 2.6, 40); lift = -j2.y; sq = j2.squash; }
      }
      puppetShadow(c, 'mt', MT_X, GROUND, { h: SZ, lift, alpha: 0.7 * e1.alpha, color: '0,0,0' });
      drawPuppet(c, pose, MT_X, GROUND - lift, { h: SZ, squash: sq, spin: e1.spin + out, alpha: e1.alpha });
    }
    // 宣文：姿勢時間軸；開槍往後震、慢慢回來；歡呼時跳一下
    const e0 = puppetIn(t, s + 0.05, 0.45);
    if (e0.alpha > 0) {
      let rot = 0, lift = 0, sq = breathe(t, 0.006, 3.1);
      for (const sh of this.shots) {
        const d = t - sh.t;
        if (d >= 0 && d < 0.5) rot -= 0.05 * Math.exp(-d / 0.09);
        if (d < 0 && d > -bp * 0.4) rot += 0.012 * prog(t, sh.t - bp * 0.4, sh.t);
      }
      if (t >= this.tWin) {
        const j = jumpArc(t, this.tWin, this.tWin + bp * 0.8, 30, { crouch: 0.06, land: 0.1 });
        lift = -j.y; sq = j.squash || sq;
      }
      const o: PuppetOpts = { h: SZ, rot, pivot: 0.3, squash: sq, spin: e0.spin + out, alpha: e0.alpha };
      puppetShadow(c, 'xw', XW_X, GROUND, { h: SZ, lift, alpha: 0.7 * e0.alpha, color: '0,0,0' });
      drawPick(c, this.xwKeys, t, XW_X, GROUND - lift, o);
      // 槍口一閃
      for (const sh of this.shots) {
        const d = t - sh.t;
        if (d < 0 || d > 0.12) continue;
        const k = 1 - d / 0.12, m = puppetPoint('xw2_balloon_fire', 'muzzle', XW_X, GROUND, { h: SZ });
        if (m) { const e = LIN.ember; this.glow.seg2(m.x, m.y, m.x + 0.01, m.y, 26 * k, [e[0] * 3 * k, e[1] * 2.6 * k, e[2] * 2 * k], 0.9); }
      }
    }
    // 攤位的燈從上面照（暖）、腳底暗
    puppetLight(c, box, mixRgba('signal', 'ink', 0.6, 0.1), rgba('ink', 0.55));
  }

  /** 木板上的留言（被氣球擋著，打掉的地方才看得到）：每一格的氣球爆了，那一格的字就露出來（用格子裁切）。 */
  private drawBoard(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = BOARD, cw = B.w / COLS, ch = B.h / ROWS;
    c.save();
    c.beginPath();
    let any = false;
    for (let i = 0; i < this.popT.length; i++) {
      if (t < this.popT[i]!) continue;
      const col = i % COLS, row = Math.floor(i / COLS);
      c.rect(B.x + col * cw - 1, B.y + row * ch - 1, cw + 2, ch + 2);
      any = true;
    }
    if (!any) { c.restore(); return; }
    c.clip();
    const y = B.y + PAD + Math.max(0, (B.h - PAD * 2 - n.height) * 0.45);
    const last = this.shots[this.shots.length - 1]!.t;
    drawNote(c, n, B.x + (B.w - n.width) * 0.5, y, { color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.75), sigK: this.msg ? prog(t, last + 0.3, last + 0.7) : 1 });
    c.restore();
  }

  /** 氣球：一格一顆，亮亮的橡膠（上面一點高光、下面打結），輕輕晃；爆開的時候碎片往外噴、一圈短線閃光。 */
  private drawBalloons(c: CanvasRenderingContext2D, t: number) {
    const B = BOARD, cw = B.w / COLS, ch = B.h / ROWS;
    const em = LIN.ember;
    for (let i = 0; i < COLS * ROWS; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const cx = B.x + (col + 0.5) * cw + 3 * Math.sin(t * 1.7 + i), cy = B.y + (row + 0.5) * ch - 4 + 2 * Math.sin(t * 2.1 + i * 1.3);
      const rx = cw * 0.4, ry = ch * 0.46;
      const key = BALLOON[(col * 7 + row * 3) % BALLOON.length]!;
      const pt = this.popT[i]!;
      if (t < pt) {
        c.fillStyle = mixRgba(key, 'ink', 0.18);
        c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = mixRgba(key, 'bone', 0.55, 0.7);
        c.beginPath(); c.ellipse(cx - rx * 0.35, cy - ry * 0.4, rx * 0.22, ry * 0.16, -0.6, 0, Math.PI * 2); c.fill();
        c.fillStyle = mixRgba(key, 'ink', 0.4);
        c.beginPath(); c.moveTo(cx - 5, cy + ry + 6); c.lineTo(cx + 5, cy + ry + 6); c.lineTo(cx, cy + ry - 2); c.closePath(); c.fill();
        c.strokeStyle = rgba('ink', 0.35);
        c.lineWidth = 1;
        c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
      } else if (t < pt + 0.35) {
        const d = t - pt, k = d / 0.35;
        // 碎片：幾片橡膠往外飛、往下掉
        c.fillStyle = mixRgba(key, 'ink', 0.2, 1 - k);
        for (let j = 0; j < 7; j++) {
          const a = hash(i, j, 1) * Math.PI * 2, v = 160 + 200 * hash(i, j, 2);
          const px = cx + Math.cos(a) * v * d, py = cy + Math.sin(a) * v * d + 500 * d * d;
          c.save(); c.translate(px, py); c.rotate(a + d * 12);
          c.fillRect(-6, -3, 12, 6);
          c.restore();
        }
        // 閃光：一圈短線（發光）
        if (d < 0.15) {
          const kk = 1 - d / 0.15;
          for (let j = 0; j < 8; j++) {
            const a = (j / 8) * Math.PI * 2 + 0.2, r0 = 20 + 40 * (1 - kk), r1 = r0 + 20 * kk;
            this.glow.seg2(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 2.2, [em[0] * 3 * kk, em[1] * 2.6 * kk, em[2] * 2 * kk], kk);
          }
        }
      }
    }
  }

  /** 軟木塞：從槍口飛到那一行最上面的氣球（0.08 秒），拖一條很短的光。 */
  private drawCork(t: number) {
    const B = BOARD, cw = B.w / COLS, ch = B.h / ROWS;
    const sg = LIN.signal;
    for (const sh of this.shots) {
      const u = (t - sh.t) / 0.08;
      if (u < 0 || u > 1) continue;
      const to = { x: B.x + (sh.cols[0]! + 0.5) * cw, y: B.y + ch * 0.5 };
      const hx = lerp(this.muzzle.x, to.x, u), hy = lerp(this.muzzle.y, to.y, u);
      const tx = lerp(this.muzzle.x, to.x, Math.max(0, u - 0.35)), ty = lerp(this.muzzle.y, to.y, Math.max(0, u - 0.35));
      this.glow.seg2(tx, ty, hx, hy, 2.5, [sg[0] * 2.5, sg[1] * 2.5, sg[2] * 2.5], 0.8);
      sparkHead(this.glow, hx, hy, t, 0.35, 0.8);
    }
  }

  /** 招牌上的歌詞：燈箱上的字，唱到的訊號色、唱完亮白、還沒唱暗暗的。換句的時候燈箱閃一下。 */
  private drawSign(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    if (!ly) return;
    const st: LyricStyle = { family: F.hei(700), size: this.lyricSize, minSize: 40, maxWidth: SIGN.w - 60, align: 'center' };
    const lay = layoutLyric(c, ly.line, st);
    // 招牌只有一行高：放不下會先縮字（最小 40），還是放不下就折兩行、整塊往上提一點
    const cx = SIGN.x + SIGN.w / 2, base = SIGN.y + SIGN.h / 2 + lay.size * 0.36 - (lay.rows.length - 1) * lay.size * 0.55;
    c.save();
    c.font = font(st.family, lay.size);
    c.textBaseline = 'alphabetic';
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      const x = cx + pw.x, y = base + pw.y;
      c.globalAlpha = ly.k;
      c.fillStyle = rgba('bone', 0.22);
      if (p < 1) c.fillText(pw.word.w, x, y);
      if (p <= 0) continue;
      c.save();
      c.beginPath(); c.rect(x - 4, y - lay.size * 1.1, (pw.w + 8) * p, lay.size * 1.5); c.clip();
      c.fillStyle = p < 1 ? rgba('signal') : rgba('bone', 0.95);
      c.fillText(pw.word.w, x, y);
      c.restore();
    }
    c.restore();
  }

  /** 雨棚邊的燈泡：一顆一顆照拍子往右跑（每四顆亮一顆），小節線全亮一下。 */
  private drawBulbs(t: number) {
    const au = this.ctx.audio;
    const beat = Math.floor(au.beatAt(t));
    const flash = Math.exp(-Math.max(0, t - au.timeOfBar(Math.floor(au.barAt(t)))) / 0.2);
    const em = LIN.ember;
    for (let i = 0, x = 40; x < W; i++, x += 80) {
      const y = 104 + 40 + 4 * Math.sin(i);
      const on = (i + beat) % 4 === 0;
      const lum = Math.max(on ? 1 : 0.35, flash);
      this.glow.seg2(x, y, x + 0.01, y, on ? 10 : 7, [em[0] * 2 * lum, em[1] * 1.8 * lum, em[2] * 1.2 * lum], 0.9);
    }
  }

  /** 隔壁攤飄過來的白煙：左邊幾團很淡的煙，慢慢往上飄、散開。 */
  private drawSteam(c: CanvasRenderingContext2D, t: number) {
    c.save();
    for (let k = 0; k < 7; k++) {
      const u = ((t * 0.12 + k / 7) % 1 + 1) % 1;
      const x = 60 + 40 * Math.sin(t * 0.3 + k) + u * 90, y = 720 - u * 520;
      const r = 40 + 90 * u;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba('bone', 0.06 * Math.sin(Math.PI * u)));
      g.addColorStop(1, rgba('bone', 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}
