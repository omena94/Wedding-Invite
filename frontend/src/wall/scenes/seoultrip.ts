// 老街散步（亮、trip、雙語、日常服二）：秋天的石牆老巷（瓦片屋簷、木門、柿子樹，自己設計的通用樣子，不畫真實地標），
// 宣文和孟庭牽著手從左往右慢慢走過去，每兩小節停下來自拍一張（小節線上閃光）。角色是 Codex 畫的紙偶（outfit2 組：cp2_walk_1／2、cp2_selfie）。
//  - 走路一拍一步；停下來拍照前半拍紙偶翻成正面（cp2_selfie：宣文舉手機、孟庭比 YA），**小節線上閃光**（手機一顆光點＋畫面微亮），
//    兩拍後翻回側面繼續走。走的距離只算在走的時間，所以窗格多長都剛好走完。
//  - **兩行歌詞在右上方掛著的木頭店招上**：鐵架吊著一塊木牌，中文刻字大、原文小一號在正下方，各自逐字亮；換句的時候木牌在鉸鍊上翻一圈換字。
//    沒有翻譯只有中文一行（置中，不留空）；間奏、純音樂時木牌是店名。
//  - **主打留言寫在左上角的明信片上**：巷子上方拉了一條細繩，用木夾子夾著一排旅行明信片，最大的那張（郵票、郵戳、地址格線）
//    手寫字一個字一個字寫上去，跟著拍子輕輕晃；照標準 v2：字 40～60、署名 26～32，明信片 ≤ 660 × 380。沒有留言時明信片寫邀請（字小、淡）。
//  - 動畫：銀杏葉一片片飄下來（拍點上一陣風）、店招跟著拍子輕輕晃、柿子樹梢被風推一下。鏡頭整個窗格慢慢推近兩個人。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { lyricAt, barAfter, msgChars, sparkHead, sparkParticles, WEDDING_DATE, type LyricStyle } from './_motifs';
import { paperBG, drawNote, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawCycle, puppetBox, puppetShadow, puppetIn, breathe, hop, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';
import { drawBilingualIn } from './_d1';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'trip', paper: true, energy: [0.2, 0.9], bars: [4, 8] };

const GROUND = 980, SZ = 480;
/** 兩人從哪裡走到哪裡（整個窗格，只算走路的時間）。 */
const X0 = 420, X1 = 1060;
/** 石牆的上緣（牆頭的瓦片）與牆腳。 */
const WALL_TOP = 470;
/** 店招（歌詞）：鐵架吊著的木牌。 */
const SIGN = { x: 1050, y: 128, w: 740, h: 250 };
/** 明信片（留言）：最大的範圍與內距（右邊留給郵票與地址格線）。 */
const CARD = { x: 110, y: 96, w: 660, h: 380 };
const PAD = { x: 34, top: 40, bottom: 28, right: 140 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SHOP_ZH = '兩個人的旅行', SHOP_EN = 'A Trip for Two';
const SPRITES = ['cp2_walk_1', 'cp2_walk_2', 'cp2_selfie'];

interface Snap { t: number; a: number; b: number }

export default class Seoultrip extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  card = { ...CARD };
  snaps: Snap[] = [];
  walkTotal = 1;
  lyricSize = 48;
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + SHOP_ZH + SHOP_EN + 'POSTCARD' + String(WEDDING_DATE));
    this.track(await loadPuppets(SPRITES));
    // 自拍：第一個小節線之後，每兩小節一次；前半拍翻正、小節線閃光、兩拍後翻回去
    const bp = au.beatPeriod(s);
    for (let t = barAfter(au, s + bp * 2); t < e - bp * 2.5; t = au.timeOfBar(Math.round(au.barAt(t)) + 2)) {
      this.snaps.push({ t, a: t - bp * 0.5, b: t + bp * 2 });
    }
    this.walkTotal = Math.max(0.5, this.walked(e));
    // 明信片上的留言：標準 v2；卡片的高度跟著留言（上緣固定）
    const c = this.fg.ctx;
    const tw = CARD.w - PAD.x - PAD.right, th = CARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th) : noteV2(c, INVITE, null, tw, th * 0.5, { max: 40 });
    tightenNote(c, this.note, 220);
    this.card.h = Math.min(CARD.h, Math.max(230, PAD.top + this.note.height + PAD.bottom + 10));
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = s + 0.45;
    this.drawBackground();
  }

  /** 到 t 為止實際走了幾秒（扣掉停下來拍照的時間）。 */
  private walked(t: number) {
    let w = t - this.ctx.start;
    for (const sn of this.snaps) w -= clamp(t - sn.a, 0, sn.b - sn.a);
    return Math.max(0, w);
  }

  /** 不會動的：遠處的瓦片屋頂、石牆（大小不一的石頭）、牆頭的瓦、木門、石板路、明信片架（明信片本身每格畫）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 遠處的屋頂（一層層的曲線瓦簷，很淡）
    for (let k = 0; k < 3; k++) {
      const y = 250 + k * 70, a = 0.08 + k * 0.05;
      c.fillStyle = mixRgba('sepia', 'paper', 0.75 - k * 0.1, 1);
      c.globalAlpha = 0.5 + a;
      c.beginPath();
      c.moveTo(0, y + 40);
      for (let x = 0; x <= W; x += 20) c.lineTo(x, y + 16 * Math.sin(x * 0.006 + k * 1.7) - (x % 360 < 40 ? 14 : 0));
      c.lineTo(W, WALL_TOP); c.lineTo(0, WALL_TOP); c.closePath(); c.fill();
    }
    c.globalAlpha = 1;
    // 石牆
    const wg = c.createLinearGradient(0, WALL_TOP, 0, GROUND);
    wg.addColorStop(0, mixRgba('paper', 'ash', 0.3));
    wg.addColorStop(1, mixRgba('paper', 'ash', 0.45));
    c.fillStyle = wg;
    c.fillRect(0, WALL_TOP, W, GROUND - WALL_TOP);
    let row = 0;
    for (let y = WALL_TOP + 16; y < GROUND - 10; y += 46, row++) {
      let x = -((row * 37) % 60);
      for (let i = 0; x < W; i++) {
        const w = 60 + 70 * hash(row, i, 1), h = 36 + 10 * hash(row, i, 2);
        c.fillStyle = mixRgba('paper', hash(row, i, 3) < 0.5 ? 'ash' : 'fur', 0.12 + 0.12 * hash(row, i, 4));
        c.strokeStyle = rgba('sepia', 0.22);
        c.lineWidth = 1.2;
        c.beginPath(); c.roundRect(x + 3, y, w - 6, h, 12); c.fill(); c.stroke();
        x += w;
      }
    }
    // 牆頭的瓦：一排弧形的瓦片、上面一條屋脊
    c.fillStyle = mixRgba('sepia', 'ash', 0.35);
    c.fillRect(0, WALL_TOP - 34, W, 18);
    for (let x = -10; x < W; x += 34) {
      c.fillStyle = mixRgba('sepia', 'ash', 0.45);
      c.beginPath(); c.arc(x + 17, WALL_TOP - 8, 17, Math.PI, 0); c.lineTo(x + 34, WALL_TOP + 4); c.lineTo(x, WALL_TOP + 4); c.closePath(); c.fill();
      c.strokeStyle = rgba('sepia', 0.4);
      c.lineWidth = 1;
      c.stroke();
    }
    // 木門（牆中間偏右，兩人會走過它前面）
    const dx = 1060, dw = 250, dy = WALL_TOP + 40;
    c.fillStyle = mixRgba('fur', 'sepia', 0.45);
    c.fillRect(dx - 16, dy - 20, dw + 32, GROUND - dy + 20);
    c.fillStyle = mixRgba('fur', 'sepia', 0.3);
    c.fillRect(dx, dy, dw, GROUND - dy);
    c.strokeStyle = rgba('sepia', 0.45);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(dx + dw / 2, dy); c.lineTo(dx + dw / 2, GROUND); c.stroke();
    for (let y = dy + 40; y < GROUND; y += 70) { c.beginPath(); c.moveTo(dx, y); c.lineTo(dx + dw, y); c.stroke(); }
    c.fillStyle = mixRgba('ball', 'sepia', 0.45);
    for (const hx of [dx + dw / 2 - 18, dx + dw / 2 + 18]) { c.beginPath(); c.arc(hx, dy + 190, 7, 0, Math.PI * 2); c.fill(); }
    // 石板路
    c.fillStyle = mixRgba('paper', 'ash', 0.25);
    c.fillRect(0, GROUND, W, H - GROUND);
    c.strokeStyle = rgba('sepia', 0.14);
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, GROUND + 2); c.lineTo(W, GROUND + 2);
    for (let x = 30; x < 1340; x += 110) { c.moveTo(x, GROUND + 2); c.lineTo(x - 30, H); }
    c.moveTo(0, GROUND + 60); c.lineTo(1340, GROUND + 60);
    c.stroke();
    // 店招的鐵架（牆上伸出來的一支）
    c.strokeStyle = rgba('sepia', 0.7);
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(SIGN.x - 60, SIGN.y - 60); c.lineTo(SIGN.x + SIGN.w + 40, SIGN.y - 60); c.stroke();
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(SIGN.x - 60, SIGN.y + 30); c.quadraticCurveTo(SIGN.x - 60, SIGN.y - 60, SIGN.x + 60, SIGN.y - 60); c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    this.glow.clear();
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.drawTree(c, t);
    this.drawSign(c, t);
    this.drawCouple(c, t);
    this.drawLine(c, t);
    this.drawCard(c, t);
    this.drawLeaves(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 自拍的閃光：小節線上畫面微微一亮
    let flash = 0;
    for (const sn of this.snaps) if (t >= sn.t) flash = Math.max(flash, 0.22 * Math.exp(-(t - sn.t) / 0.1));
    const push = ease.inOutCubic(f.p);
    return { paper: 1, flash, bloom: 0.25, bloomThreshold: 1.5, halation: 0.03, vignette: 0.24, grain: 0.045, zoom: 1 + 0.028 * push, shake: [-(X1 - 100 - W / 2) * 0.028 * push, -(620 - H / 2) * 0.028 * push] };
  }

  /** 柿子樹：從牆後面伸出來的枝枒，幾顆橘色的柿子；拍點上樹梢被風推一下。 */
  private drawTree(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const gust = beatKick(au, t, 0.5);
    const bx = 935, by = WALL_TOP - 30;
    c.save();
    c.strokeStyle = mixRgba('sepia', 'paper', 0.25);
    c.lineCap = 'round';
    const branch = (x0: number, y0: number, ang: number, len: number, w: number, depth: number, seed: number) => {
      if (depth <= 0) return;
      const sw = 0.03 * gust * (4 - depth) + 0.01 * Math.sin(t * 0.8 + seed);
      const x1 = x0 + Math.cos(ang + sw) * len, y1 = y0 + Math.sin(ang + sw) * len;
      c.lineWidth = w;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      branch(x1, y1, ang - 0.45 - 0.2 * hash(seed, 1), len * 0.72, w * 0.62, depth - 1, seed * 2 + 1);
      branch(x1, y1, ang + 0.4 + 0.2 * hash(seed, 2), len * 0.68, w * 0.62, depth - 1, seed * 2 + 2);
      if (depth <= 2 && hash(seed, 3) < 0.7) {
        c.fillStyle = mixRgba('fur', 'collar', 0.3);
        c.beginPath(); c.arc(x1, y1 + 9, 10, 0, Math.PI * 2); c.fill();
      }
    };
    branch(bx, by + 60, -1.5, 120, 14, 5, 1);
    c.restore();
  }

  /** 店招：木牌（兩條鏈子吊著），中文大、原文小；換句的時候在鉸鍊上翻一圈（縮成一條線再翻開），跟著拍子輕輕晃。 */
  private drawSign(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t);
    // 翻牌：這一句開始前 0.35 秒翻一圈（0.3 秒）
    let flipK = 1;
    if (ly) { const u = (t - (ly.line.start - 0.5)) / 0.3; if (u > 0 && u < 1) flipK = Math.abs(Math.cos(u * Math.PI)); }
    const swing = 3 * Math.sin(au.beatAt(t) * Math.PI) + 2 * beatKick(au, t, 0.3);
    const X = SIGN.x + swing, Y = SIGN.y, w = SIGN.w, h = SIGN.h;
    c.save();
    // 鏈子
    c.strokeStyle = rgba('sepia', 0.6);
    c.lineWidth = 2;
    c.setLineDash([6, 4]);
    for (const cx of [X + 60, X + w - 60]) { c.beginPath(); c.moveTo(cx - swing, Y - 60); c.lineTo(cx, Y); c.stroke(); }
    c.setLineDash([]);
    // 翻牌：以木牌的中線為軸，垂直方向縮放
    c.translate(0, Y + h / 2);
    c.scale(1, Math.max(0.02, flipK));
    c.translate(0, -(Y + h / 2));
    c.fillStyle = rgba('sepia', 0.16);
    c.fillRect(X + 8, Y + 10, w, h);
    // 深色的木牌、淺色的刻字：亮版面上字才清楚（淺木牌上的訊號色看不清楚）
    const g = c.createLinearGradient(0, Y, 0, Y + h);
    g.addColorStop(0, mixRgba('sepia', 'fur', 0.3));
    g.addColorStop(1, mixRgba('sepia', 'fur', 0.18));
    c.fillStyle = g;
    c.beginPath(); c.roundRect(X, Y, w, h, 10); c.fill();
    c.strokeStyle = mixRgba('fur', 'sepia', 0.25);
    c.lineWidth = 3;
    c.beginPath(); c.roundRect(X + 10, Y + 10, w - 20, h - 20, 6); c.stroke();
    // 木紋
    c.strokeStyle = rgba('bone', 0.05);
    c.lineWidth = 1.5;
    c.beginPath();
    for (const yy of [Y + 34, Y + h - 30]) { c.moveTo(X + 20, yy); c.bezierCurveTo(X + w * 0.3, yy - 4, X + w * 0.6, yy + 5, X + w - 20, yy); }
    c.stroke();
    if (flipK > 0.15) {
      if (ly) {
        const st: LyricStyle = { family: F.ming(700), size: this.lyricSize, minSize: 40, maxWidth: w - 80, align: 'center', unsung: rgba('bone', 0.3), sung: rgba('bone', 0.95), active: rgba('signal') };
        drawBilingualIn(c, ly.line, t, st, { x: X + 40, top: Y + 20, w: w - 80, h: h - 40 }, ly.k);
      } else {
        // 沒有歌詞（間奏、純音樂）：店名
        c.textAlign = 'center';
        c.font = font(F.ming(700), 50);
        c.fillStyle = rgba('bone', 0.9);
        c.fillText(SHOP_ZH, X + w / 2, Y + h / 2 + 4);
        c.font = font(F.serif(500, true), 32);
        c.fillStyle = rgba('bone', 0.6);
        c.fillText(SHOP_EN, X + w / 2, Y + h / 2 + 50);
      }
    }
    c.restore();
  }

  /** 兩個人：牽手一拍一步往右走、一步一彈；每兩小節停下來翻正自拍，小節線上手機閃光。 */
  private drawCouple(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const en = puppetIn(t, s + 0.05, 0.45);
    if (en.alpha <= 0) return;
    const x = lerp(X0, X1, ease.inOutQuad(clamp(this.walked(t) / this.walkTotal)));
    const sn = this.snaps.find((k) => t >= k.a - 0.001 && t < k.b + 0.3);
    puppetShadow(c, 'cp2_walk_1', x, GROUND, { h: SZ, alpha: 0.28 * en.alpha, color: '70,45,25' });
    if (sn && t < sn.b + 0.3) {
      // 翻正（前半拍）→ 自拍 → 翻回去（0.3 秒）
      const inK = prog(t, sn.a, sn.a + (sn.t - sn.a) * 0.9, ease.outCubic), outK = prog(t, sn.b, sn.b + 0.3, ease.inCubic);
      // 前半段縮成一條線（側面的圖）、過了一半換成正面的圖再展開；翻回去同理
      const back = t >= sn.b;
      const k = back ? outK : inK;
      const front = back ? outK < 0.5 : inK >= 0.5;
      const o = { h: SZ, spin: en.spin + 0.25 * (1 - Math.abs(1 - 2 * k)), alpha: en.alpha, squash: breathe(t, 0.006, 2.4) + 0.02 * beatKick(au, t, 0.25) };
      drawPuppet(c, front ? 'cp2_selfie' : 'cp2_walk_1', x, GROUND, o);
      // 閃光：手機（宣文舉起的手）一顆光點
      const d = t - sn.t;
      if (d >= 0 && d < 0.25 && front) {
        const b = puppetBox('cp2_selfie', x, GROUND, o);
        const px = b[0] + b[2] * 0.28, py = b[1] + b[3] * 0.065, kk = 1 - d / 0.25;
        const e = LIN.ember;
        this.glow.seg2(px, py, px + 0.01, py, 40 * kk, [e[0] * 3 * kk, e[1] * 3 * kk, e[2] * 3 * kk], 0.9);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2, r0 = 12 + 30 * (1 - kk), r1 = r0 + 22 * kk;
          this.glow.seg2(px + Math.cos(a) * r0, py + Math.sin(a) * r0, px + Math.cos(a) * r1, py + Math.sin(a) * r1, 2, [e[0] * 2, e[1] * 2, e[2] * 2], kk);
        }
      }
      return;
    }
    const lift = hop(au.beatAt(t), 1) * 7;
    drawCycle(c, au, t, ['cp2_walk_1', 'cp2_walk_2'], 1, x, GROUND - lift, { h: SZ, spin: en.spin, alpha: en.alpha, squash: breathe(t, 0.006, 2.4), rot: 0.012 * Math.sin(au.beatAt(t) * Math.PI) });
    if (en.k < 1) {
      sparkHead(this.glow, x, GROUND - 6, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x, y: GROUND - 6 }), { rate: 50, life: 0.25, speed: 140, seed: 2 });
    }
  }

  /** 細繩與小明信片：繩子從左邊的牆頭拉到店招的鐵架，夾著幾張小明信片（色塊），跟著拍子輕輕晃。 */
  private drawLine(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const sw = 4 * Math.sin(au.beatAt(t) * Math.PI * 0.5);
    const y = (x: number) => CARD.y - 18 + 0.00012 * (x - 520) * (x - 520) + sw * Math.sin(((x - 40) / 960) * Math.PI);
    c.save();
    c.strokeStyle = rgba('sepia', 0.5);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let x = 40; x <= 1000; x += 20) (x === 40 ? c.moveTo(x, y(x)) : c.lineTo(x, y(x)));
    c.stroke();
    const tints = ['shirtblue', 'gingham', 'rose'];
    [800, 880].forEach((x, i) => {
      const yy = y(x);
      c.fillStyle = mixRgba(tints[i]!, 'paper', 0.4);
      c.fillRect(x - 32, yy + 4, 64, 84);
      c.strokeStyle = rgba('sepia', 0.25); c.lineWidth = 1; c.strokeRect(x - 32, yy + 4, 64, 84);
      c.fillStyle = mixRgba('fur', 'sepia', 0.4); c.fillRect(x - 4, yy - 6, 8, 20);
    });
    c.restore();
    this.lineY = y;
  }
  lineY: (x: number) => number = () => CARD.y;

  /** 明信片：郵票（愛心）、郵戳（婚禮日期）、地址格線；左半邊是手寫的留言，第一拍起一個字一個字寫上去。 */
  private drawCard(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const K = { ...this.card };
    // 夾在繩子上，跟著繩子上下
    K.y = this.lineY(K.x + K.w / 2) + 12;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    c.fillStyle = rgba('sepia', 0.14);
    c.fillRect(K.x + 10, K.y + 12, K.w, K.h);
    c.fillStyle = mixRgba('bone', 'paper', 0.3);
    c.fillRect(K.x, K.y, K.w, K.h);
    c.strokeStyle = rgba('sepia', 0.25);
    c.lineWidth = 1.2;
    c.strokeRect(K.x, K.y, K.w, K.h);
    // 右邊：郵票、郵戳、地址格線、中間一條分隔線
    const sx = K.x + K.w - 112, sy = K.y + 24;
    c.fillStyle = mixRgba('rose', 'paper', 0.55);
    c.fillRect(sx, sy, 84, 100);
    c.setLineDash([3, 3]);
    c.strokeStyle = rgba('sepia', 0.4);
    c.strokeRect(sx - 4, sy - 4, 92, 108);
    c.setLineDash([]);
    c.fillStyle = rgba('rose');
    c.beginPath();
    const hx = sx + 42, hy = sy + 52;
    c.moveTo(hx, hy + 18); c.bezierCurveTo(hx - 34, hy - 6, hx - 14, hy - 30, hx, hy - 12); c.bezierCurveTo(hx + 14, hy - 30, hx + 34, hy - 6, hx, hy + 18); c.fill();
    c.strokeStyle = rgba('sepia', 0.35);
    c.lineWidth = 2;
    c.beginPath(); c.arc(sx - 20, sy + 70, 44, 0, Math.PI * 2); c.stroke();
    c.font = font(F.mono(500), 14);
    c.fillStyle = rgba('sepia', 0.45);
    c.textAlign = 'center';
    c.fillText(String(WEDDING_DATE).split('-').join('.'), sx - 20, sy + 75);
    c.textAlign = 'left';
    c.strokeStyle = rgba('sepia', 0.18);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(K.x + K.w - PAD.right + 6, K.y + 30); c.lineTo(K.x + K.w - PAD.right + 6, K.y + K.h - 30);
    for (let i = 0; i < 3; i++) { const yy = K.y + K.h - 40 - i * 40; if (yy > sy + 130) { c.moveTo(K.x + K.w - PAD.right + 24, yy); c.lineTo(K.x + K.w - 24, yy); } }
    c.stroke();
    c.font = font(F.mono(500), 13);
    c.fillStyle = rgba('sepia', 0.35);
    c.fillText('POSTCARD', K.x + PAD.x, K.y + 24);
    // 兩個木夾子
    c.fillStyle = mixRgba('fur', 'sepia', 0.35);
    for (const px of [K.x + 60, K.x + K.w - 60]) { c.fillRect(px - 5, K.y - 22, 10, 34); }
    // 留言
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.09);
    const done = this.msgT0 + total * per;
    const top = K.y + PAD.top, h = K.h - PAD.top - PAD.bottom;
    drawNote(c, n, K.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? Math.max(0, (t - this.msgT0) / per) : Infinity,
      color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.72), sigK: this.msg ? prog(t, done + 0.1, done + 0.5) : 1,
    });
    c.restore();
  }

  /** 銀杏葉：二十幾片扇形的黃葉慢慢飄下來、翻轉，拍點上一陣風往右推（位置只看 t 與編號）。 */
  private drawLeaves(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const wind = beatKick(au, t, 0.6);
    c.save();
    for (let k = 0; k < 22; k++) {
      const fall = 40 + 40 * hash(k, 11), period = 1080 / fall;
      const u = ((t / period + hash(k, 12)) % 1 + 1) % 1;
      const y = -30 + u * 1100;
      let x = W * hash(k, 13) + 60 * Math.sin(t * 0.9 + k) + 30 * wind;
      x = ((x % (W + 60)) + W + 60) % (W + 60) - 30;
      if (x > 1340 && y > 800) continue;
      const rot = t * (1 + 2 * hash(k, 14)) + k;
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.scale(1, 0.5 + 0.5 * Math.cos(t * 2 + k));
      c.fillStyle = mixRgba('ball', 'fur', 0.35 + 0.3 * hash(k, 15));
      c.beginPath(); c.moveTo(0, 8); c.arc(0, 8, 14, -Math.PI * 0.85, -Math.PI * 0.15); c.closePath(); c.fill();
      c.restore();
    }
    c.restore();
  }
}
