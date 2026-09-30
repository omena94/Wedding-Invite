// 圖書館讀書（亮、date、雙語）：午後的圖書館閱覽室，一張長木桌、綠色燈罩的桌燈，宣文和孟庭並肩坐在桌子後面讀語言課本（桌面擋住腰部以下）。
// 角色是 Codex 畫的紙偶（_puppet.ts）；桌子、書架、課本、借書卡由程式畫。
//  - 小劇情照小節走（四小節一輪）：兩人一起讀書（每拍輕輕點頭）→ 宣文開始打瞌睡（每一拍頭往下點一次，越點越低）→
//    孟庭偷偷在他的課本上畫一顆愛心（前景課本頁邊的愛心一筆一筆畫出來）→ **小節線上孟庭用筆戳他**，宣文嚇醒（整個人彈一下、冒汗）→ 回去讀書。
//  - **兩行歌詞是課本上的例句**：前景一本攤開的語言課本（右頁），「例句」那一段：中文大字（40～52）、原文小一號在正下方，
//    唱到的中文底下有一條螢光筆（訊號色、半透明）照逐字時間劃過去；換一句時翻一頁（頁角掀起來）。沒翻譯的歌只有一行；純音樂時頁面寫「（休息一下）」。
//  - **焦點是主打留言**：左前景一張圖書館的借書卡（上面一排小小的日期章），留言手寫在卡上（照「留言尺寸與版面比例標準 v2」：
//    字 40～60、卡最大 560 × 400）。沒有留言時借書卡寫邀請、字淡，歌詞變主角。
//  - 次要動作：桌燈的光暈跟著大鼓亮一點、窗格的光斑慢慢移、書架上偶爾一本書被抽出又放回（拍點）。鏡頭：整個窗格慢慢推近兩個人。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, mulberry32 } from '../engine/util';
import { Lyrics, type Lyrics as LyricsT } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, msgChars } from './_motifs';
import { inkFor, inkLine, inkPoly, inkPath, drawNote, paperBG, type Note, type Pt, type Ink } from './_couple';
import { loadPuppets, hasPuppet, puppetIn, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { faceLocks, drawLocked, type Lock } from './_d3';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'date', paper: true, energy: [0.15, 0.8], bars: [4, 8] };

/** 桌面的遠邊（擋住兩個人腰部以下）；人的腳底在桌子後面看不到的地方。 */
const TABLE_Y = 690;
const SZ = 820, FEET = 1012;
/** 桌燈：在孟庭右邊（不要擋住兩個人中間：她的筆要伸過去戳他）。 */
const LAMP_X = 1330;
const XW_X = 815, MT_X = 1110;
/** 前景的課本（右頁寫例句）、借書卡（留言）。 */
/** 課本斜斜地攤開（鏡頭在左邊）：左頁窄、右頁寬（GUT = 裝訂線在全寬的哪裡）；右頁寫例句。 */
const BOOK = { x: 580, y: 712, w: 760, h: 318 };
const GUT = 0.34;
const PAGE = { w: 440 };
const EX = { x: 580 + 760 * 0.34 + 34, y: 752 };
/** 借書卡：靠在一疊書上（上緣可以超過桌子的遠邊），底邊固定。 */
const CARD = { x: 96, bottom: 1030, w: 450, h: 420 };
const CPAD = { x: 36, top: 74, bottom: 28 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = {
  xwRead: 'xw_d3_study_read', xwDoze: 'xw_d3_study_doze', xwWake: 'xw_d3_study_wake',
  mtRead: 'mt_d3_study_read', mtDraw: 'mt_d3_study_draw', mtPoke: 'mt_d3_study_poke',
} as const;
const FALLBACK: Record<string, string> = {
  xw_d3_study_read: 'xw_idle_front', xw_d3_study_doze: 'xw_idle_front', xw_d3_study_wake: 'xw_cheer',
  mt_d3_study_read: 'mt_idle_front', mt_d3_study_draw: 'mt_idle_front', mt_d3_study_poke: 'mt_cheer',
};

interface Round { doze: number; draw: number; poke: number; back: number }

export default class Studydate extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  mid = this.track(new Layer2D(W, H, undefined, { fast: true }));
  front = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  card = { x: CARD.x, y: CARD.bottom - CARD.h, w: CARD.w, h: CARD.h };
  rounds: Round[] = [];
  xwLock = new Map<string, Lock>();
  mtLock = new Map<string, Lock>();
  xwKeys: [number, string][] = [];
  mtKeys: [number, string][] = [];
  pose = (n: string) => (hasPuppet(n) ? n : FALLBACK[n] ?? n);
  msgT0 = 0;
  lyricSize = 50;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + '例句（休息一下）借書卡 圖書館 閱覽室 LESSON' + '0123456789.');
    this.track(await loadPuppets(Object.values(P).map(this.pose)));
    // ---- 四小節一輪：第 1 小節一起讀、第 2 小節打瞌睡（每拍點頭）、第 3 小節第二拍孟庭畫愛心、第 4 小節的小節線戳醒
    const b0 = Math.round(au.barAt(barAfter(au, s + 0.4)));
    const nb = (e - s) / Math.max(0.3, au.timeOfBar(b0 + 1) - au.timeOfBar(b0));
    const len = nb >= 6 ? 4 : 2;
    this.xwKeys = [[-1e9, this.pose(P.xwRead)]];
    this.mtKeys = [[-1e9, this.pose(P.mtRead)]];
    for (let r = 0; r < 8; r++) {
      const base = b0 + r * len;
      // 四小節一輪：第 2 小節開始打瞌睡；兩小節一輪（窗格短）：第一拍之後就開始
      const doze = len === 4 ? au.timeOfBar(base + 1) : au.timeOfBeat(Math.round(au.beatAt(au.timeOfBar(base))) + 1);
      const poke = au.timeOfBar(base + len);
      if (poke > e + 0.1) break;
      const bp = au.beatPeriod(poke);
      const draw = poke - bp * (len === 4 ? 5 : 2.5);
      this.rounds.push({ doze, draw, poke, back: poke + bp * 2 });
      // 打瞌睡（每拍點一次頭、越點越低，由 drawPeople 的 rot 做）→ 戳醒 → 回去讀書
      this.xwKeys.push([doze, this.pose(P.xwDoze)], [poke, this.pose(P.xwWake)], [poke + bp * 2, this.pose(P.xwRead)]);
      this.mtKeys.push([draw, this.pose(P.mtDraw)], [poke - bp * 0.25, this.pose(P.mtPoke)], [poke + bp * 1.5, this.pose(P.mtRead)]);
    }
    this.xwKeys.sort((a, b) => a[0] - b[0]);
    this.mtKeys.sort((a, b) => a[0] - b[0]);
    // 換姿勢時臉對齊到讀書的那一張（Codex 每張畫的大小、位置不太一樣，見 _d3.ts）
    const o: PuppetOpts = { h: SZ };
    this.xwLock = faceLocks(this.xwKeys.map((k) => k[1]), this.pose(P.xwRead), XW_X, FEET, { ...o, pivot: 0.55 });
    this.mtLock = faceLocks(this.mtKeys.map((k) => k[1]), this.pose(P.mtRead), MT_X, FEET, { ...o, pivot: 0.5 });
    // ---- 借書卡：標準 v2 的字級，卡的寬高跟著留言
    const c = this.fg.ctx;
    const w = CARD.w - CPAD.x * 2, hmax = CARD.h - CPAD.top - CPAD.bottom;
    // 短留言排成一行（「新婚快樂！！！」不要拆成兩行）：先試一行放得下的最大字級，放不下才照一般的排法
    const one = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax, { maxLines: 1 }) : null;
    this.note = one && one.fit.lines.length === 1 ? one : this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const cw = Math.min(CARD.w, tightenNote(c, this.note, 320) + CPAD.x * 2);
    const ch = Math.min(CARD.h, Math.max(230, CPAD.top + this.note.height + CPAD.bottom + 8));
    this.card = { x: CARD.x, y: CARD.bottom - ch, w: cw, h: ch };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.3);
    this.drawBackground();
    this.drawFront();
  }

  /** 不會動的背景：書架牆（一排排書背）、高窗、閱覽室的燈。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    const rnd = mulberry32(21);
    // 高窗（左上），光從窗戶斜斜照進來
    for (const wx of [150, 430]) {
      // 窗外：淡淡的天空漸層（上面藍一點、往下越來越亮），一道斜斜的光掃過玻璃
      const sky = c.createLinearGradient(0, 80, 0, 420);
      sky.addColorStop(0, mixRgba('bone', 'leash', 0.42)); sky.addColorStop(0.7, mixRgba('bone', 'leash', 0.14)); sky.addColorStop(1, mixRgba('bone', 'ember', 0.12));
      c.fillStyle = sky;
      c.fillRect(wx, 80, 200, 340);
      c.save();
      c.beginPath(); c.rect(wx, 80, 200, 340); c.clip();
      const beam = c.createLinearGradient(wx, 80, wx + 200, 420);
      beam.addColorStop(0.3, rgba('bone', 0)); beam.addColorStop(0.45, rgba('bone', 0.55)); beam.addColorStop(0.55, rgba('bone', 0.55)); beam.addColorStop(0.7, rgba('bone', 0));
      c.fillStyle = beam;
      c.fillRect(wx, 80, 200, 340);
      c.restore();
      inkPoly(c, [{ x: wx, y: 80 }, { x: wx + 200, y: 80 }, { x: wx + 200, y: 420 }, { x: wx, y: 420 }], { ink, w: 0.8, seed: wx, closed: true });
      inkLine(c, [{ x: wx + 100, y: 80 }, { x: wx + 100, y: 420 }], { ink, w: 0.5, seed: wx + 1 });
      inkLine(c, [{ x: wx, y: 250 }, { x: wx + 200, y: 250 }], { ink, w: 0.5, seed: wx + 2 });
    }
    // 書架（右半邊到底）：一層一層的書背，淡淡的顏色
    for (let sy = 100; sy < TABLE_Y; sy += 128) {
      inkLine(c, [{ x: 720, y: sy + 116 }, { x: 1880, y: sy + 116 }], { ink, w: 0.8, seed: sy });
      for (let x = 730; x < 1870;) {
        const bw = 18 + rnd() * 26, bh = 70 + rnd() * 40;
        c.fillStyle = mixRgba('paper', ['sepia', 'gingham', 'leash', 'fur', 'blood'][Math.floor(rnd() * 5)]!, 0.14 + rnd() * 0.16);
        c.fillRect(x, sy + 116 - bh, bw - 3, bh);
        if (rnd() < 0.3) { c.fillStyle = rgba('sepia', 0.18); c.fillRect(x + 3, sy + 116 - bh + 10, bw - 9, 3); }
        x += bw + (rnd() < 0.08 ? 30 : 0);
      }
    }
    // 窗戶斜斜照進來的光（兩道很淡的光帶）
    c.fillStyle = rgba('bone', 0.35);
    for (const wx of [150, 430]) { c.beginPath(); c.moveTo(wx, 420); c.lineTo(wx + 200, 420); c.lineTo(wx + 520, TABLE_Y); c.lineTo(wx + 320, TABLE_Y); c.closePath(); c.fill(); }
    // 牆上的一個小標示（安靜）
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.4);
    c.fillText('圖書館 · 閱覽室', 150, 470);
    c.letterSpacing = '0px';
    L.upload();
  }

  /** 蓋在兩個人前面的：長木桌（桌面、桌緣）、桌燈、前景的課本（左頁的插圖與標題）、借書卡的紙與日期章（畫一次）。 */
  private drawFront() {
    const L = this.front, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 桌面：從遠邊往前變寬（一點點透視），木紋
    const top = [{ x: 60, y: TABLE_Y }, { x: 1860, y: TABLE_Y }, { x: 1920, y: H }, { x: 0, y: H }];
    inkPoly(c, top, { ink, fill: mixRgba('paper', 'fur', 0.38), w: 1, seed: 3 });
    c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 1.2;
    c.beginPath();
    for (let k = 1; k < 7; k++) { const y = TABLE_Y + (H - TABLE_Y) * (k / 7) ** 1.3; c.moveTo(40, y); c.bezierCurveTo(600, y + 6, 1300, y - 5, 1900, y + 3); }
    c.stroke();
    inkLine(c, [{ x: 60, y: TABLE_Y + 4 }, { x: 1860, y: TABLE_Y + 4 }], { ink, w: 0.6, seed: 4, color: rgba('sepia', 0.4) });
    // 桌燈（兩人中間後面）：綠色燈罩、銅色燈柱
    const lx = LAMP_X;
    inkPoly(c, [{ x: lx - 8, y: TABLE_Y + 8 }, { x: lx + 8, y: TABLE_Y + 8 }, { x: lx + 5, y: TABLE_Y - 120 }, { x: lx - 5, y: TABLE_Y - 120 }], { ink, fill: mixRgba('fur', 'sepia', 0.4), w: 0.6, seed: 5 });
    inkPoly(c, [{ x: lx - 70, y: TABLE_Y - 118 }, { x: lx + 70, y: TABLE_Y - 118 }, { x: lx + 50, y: TABLE_Y - 150 }, { x: lx - 50, y: TABLE_Y - 150 }], { ink, fill: mixRgba('gingham', 'sepia', 0.35), w: 0.8, seed: 6 });
    // 前景的課本：兩頁攤開，左頁畫一張小插圖與「LESSON」，右頁留給例句（程式每格寫）
    const B = BOOK;
    c.fillStyle = rgba('sepia', 0.14);
    c.beginPath(); c.moveTo(B.x + 14, B.y + 18); c.lineTo(B.x + B.w + 14, B.y + 18); c.lineTo(B.x + B.w + 20, B.y + B.h + 16); c.lineTo(B.x + 8, B.y + B.h + 16); c.fill();
    const gx = B.x + B.w * GUT;
    inkPoly(c, [{ x: B.x, y: B.y + 10 }, { x: gx, y: B.y }, { x: gx, y: B.y + B.h }, { x: B.x + 6, y: B.y + B.h + 8 }], { ink, fill: mixRgba('bone', 'paper', 0.3), w: 0.8, seed: 7 });
    inkPoly(c, [{ x: gx, y: B.y }, { x: B.x + B.w, y: B.y + 8 }, { x: B.x + B.w - 4, y: B.y + B.h + 6 }, { x: gx, y: B.y + B.h }], { ink, fill: rgba('bone'), w: 0.8, seed: 8 });
    inkLine(c, [{ x: gx, y: B.y }, { x: gx, y: B.y + B.h }], { ink, w: 0.6, seed: 9 });
    // 左頁（窄）：LESSON 13、一張小插圖、幾條字的灰線
    c.font = font(F.mono(600), 15);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.55);
    c.fillText('LESSON 13', B.x + 28, B.y + 44);
    c.letterSpacing = '0px';
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.5;
    c.strokeRect(B.x + 28, B.y + 64, 190, 120);
    c.beginPath(); c.arc(B.x + 80, B.y + 110, 12, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(B.x + 166, B.y + 110, 12, 0, Math.PI * 2); c.stroke();
    inkPath(c, [{ x: B.x + 80, y: B.y + 170 }, { x: B.x + 80, y: B.y + 124 }], { ink, w: 0.5, seed: 10 });
    inkPath(c, [{ x: B.x + 166, y: B.y + 170 }, { x: B.x + 166, y: B.y + 124 }], { ink, w: 0.5, seed: 11 });
    c.fillStyle = rgba('sepia', 0.18);
    for (let k = 0; k < 3; k++) c.fillRect(B.x + 28, B.y + 204 + k * 18, 190 - k * 30, 5);
    // 借書卡靠著的一疊書（卡的上半部後面）
    const K = this.card;
    for (let k = 0; k < 3; k++) {
      const by = K.y + 30 + k * 34, bx = K.x - 20 + k * 12;
      inkPoly(c, [{ x: bx, y: by }, { x: bx + K.w + 30 - k * 20, y: by }, { x: bx + K.w + 30 - k * 20, y: by + 32 }, { x: bx, y: by + 32 }], { ink, fill: mixRgba('paper', ['leash', 'blood', 'gingham'][k]!, 0.35), w: 0.7, seed: 95 + k });
    }
    // 借書卡的紙（字每格寫）：米白的卡、上面一排欄位、右上角一個歪歪的日期章
    c.fillStyle = rgba('sepia', 0.14);
    c.fillRect(K.x + 8, K.y + 10, K.w, K.h);
    inkPoly(c, [{ x: K.x, y: K.y }, { x: K.x + K.w, y: K.y + 2 }, { x: K.x + K.w - 2, y: K.y + K.h }, { x: K.x + 2, y: K.y + K.h - 1 }], { ink, fill: mixRgba('bone', 'cream', 0.4), w: 0.7, seed: 90 });
    c.font = font(F.hei(700), 18);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('sepia', 0.6);
    c.fillText('借書卡', K.x + CPAD.x, K.y + 34);
    c.letterSpacing = '0px';
    c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1;
    c.beginPath(); c.moveTo(K.x + 14, K.y + 50); c.lineTo(K.x + K.w - 14, K.y + 50); c.stroke();
    c.save();
    c.translate(K.x + K.w - 90, K.y + 30);
    c.rotate(-0.12);
    c.strokeStyle = rgba('signal', 0.7); c.lineWidth = 1.5;
    c.strokeRect(-54, -16, 108, 30);
    c.font = font(F.mono(600), 15);
    c.fillStyle = rgba('signal', 0.8);
    c.textAlign = 'center';
    c.fillText('2027.03.13', 0, 5);
    c.restore();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    // ---- 兩個人（桌子後面）→ 桌子、桌燈、課本蓋在前面
    const M = this.mid; M.clear();
    this.drawPeople(M.ctx, t, bp);
    comp.draw(renderer, M.upload(), out);
    comp.draw(renderer, this.front.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    // 桌燈的光（大鼓亮一點）
    const g = c.createRadialGradient(LAMP_X, TABLE_Y - 110, 10, LAMP_X - 120, TABLE_Y - 60, 420);
    g.addColorStop(0, mixRgba('ember', 'bone', 0.4, 0.22 + 0.1 * f.a.kick)); g.addColorStop(1, rgba('ember', 0));
    c.fillStyle = g; c.fillRect(LAMP_X - 640, TABLE_Y - 420, 920, 560);
    this.drawPage(c, ink, t, lyrics);
    this.drawDoodles(c, ink, t);
    this.drawCard(c, ink, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p), z = 0.03 * push;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.4, zoom: 1 + z, shake: [-(965 - W / 2) * z, -(500 - H / 2) * z] };
  }

  /** 兩個人：讀書時每拍輕輕點頭；宣文打瞌睡時每拍頭往下點一次、越點越低；戳醒那一下整個人彈一下。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const kick = beatKick(au, t, 0.25);
    const ex = puppetIn(t, this.ctx.start + 0.05, 0.45), em = puppetIn(t, this.ctx.start + 0.15, 0.45);
    let xrot = 0, xlift = 0;
    for (const r of this.rounds) {
      if (t >= r.doze && t < r.poke) {
        const k = (t - r.doze) / (r.poke - r.doze);
        xrot += (0.02 + 0.05 * k) * (1 - Math.exp(-((t - au.timeOfBeat(Math.floor(au.beatAt(t)))) / 0.12)));
      }
      const d = t - r.poke;
      if (d >= 0 && d < 0.5) xlift += 26 * Math.sin(Math.PI * d / 0.5);
    }
    if (ex.alpha > 0) drawLocked(c, this.xwKeys, t, XW_X, FEET - xlift, { h: SZ, spin: ex.spin, alpha: ex.alpha, rot: xrot, pivot: 0.55, squash: 0.008 * kick + breathe(t, 0.008, 3.4) }, this.xwLock);
    if (em.alpha > 0) drawLocked(c, this.mtKeys, t, MT_X, FEET, { h: SZ, spin: em.spin, alpha: em.alpha, rot: -0.01 * kick, pivot: 0.5, squash: 0.008 * kick + breathe(t, 0.008, 3.1, 0.4) }, this.mtLock);
  }

  /** 右頁：「例句」標題、這一句歌詞（中文＋原文），唱到的中文底下一條螢光筆劃過去；換句子時頁角掀起來翻頁。 */
  private drawPage(c: CanvasRenderingContext2D, ink: Ink, t: number, lyrics: LyricsT) {
    const Pg = PAGE;
    c.save();
    c.font = font(F.hei(700), 20);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('signal', 0.8);
    const ly = lyricAt(lyrics, t);
    c.fillText(`例句 ${ly ? String(ly.line.i + 1).padStart(2, '0') : '—'}`, EX.x, EX.y);
    c.letterSpacing = '0px';
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 36, maxWidth: Pg.w, unsung: rgba('sepia', 0.26), sung: rgba('sepia', big ? 0.92 : 0.86), active: rgba('sepia', 0.95) };
      const lay = layoutLyric(c, ly.line, st);
      const y0 = EX.y + 30 + lay.size * 0.86;
      // 螢光筆：唱到哪劃到哪（只劃中文）
      c.fillStyle = rgba('signal', 0.28);
      for (const pw of lay.words) {
        const p = Lyrics.wordProgress(pw.word, t);
        if (p <= 0) continue;
        c.fillRect(EX.x + pw.x - 2, y0 + pw.y - lay.size * 0.42, (pw.w + 4) * p, lay.size * 0.5);
      }
      c.translate(EX.x, y0);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else if (!lyrics.has) {
      c.font = font(F.hand(400), 40);
      c.fillStyle = rgba('sepia', 0.5);
      c.fillText('（休息一下）', EX.x, EX.y + 80);
    }
    c.restore();
    // 頁角翻起來（換一句歌詞的那一刻）
    if (ly) {
      const u = clamp((t - (ly.line.start - 0.35)) / 0.35);
      if (u < 1) {
        const k = ease.inOutCubic(u), cx = BOOK.x + BOOK.w - 4, cy = BOOK.y + BOOK.h + 6, r = 60 + 380 * k;
        c.save();
        c.globalAlpha = 1 - k;
        inkPoly(c, [{ x: cx, y: cy }, { x: cx - r, y: cy }, { x: cx, y: cy - r * 0.8 }], { ink, fill: mixRgba('bone', 'paper', 0.4), w: 0.6, seed: 70 });
        c.restore();
      }
    }
  }

  /** 孟庭在課本頁邊畫的愛心：她畫的那一段時間一筆一筆畫出來（訊號色的筆跡），之後留著。 */
  private drawDoodles(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    this.rounds.forEach((r, i) => {
      if (t < r.draw) return;
      const k = clamp((t - r.draw) / Math.max(0.3, r.poke - r.draw - 0.1));
      // 畫在左頁的插圖下面（右頁寫例句，不要蓋到字）
      const x = BOOK.x + 60 + (i % 4) * 44, y = BOOK.y + BOOK.h - 40 - (i % 2) * 14, s = 20;
      const pts: Pt[] = [];
      for (let j = 0; j <= 32; j++) {
        const a = Math.PI + (j / 32) * Math.PI * 2;
        const hx = 16 * Math.sin(a) ** 3, hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
        pts.push({ x: x + (hx / 32) * s * 2, y: y + ((hy + 2.5) / 32) * s * 2 });
      }
      inkPath(c, pts, { ink, t, w: 1.1, reveal: k, color: rgba('rose', 0.9), seed: 80 + i });
    });
  }

  /** 借書卡上的留言：手寫、一個字一個字寫上去，署名在最後一行下面（卡本身在 drawFront 畫好了）。 */
  private drawCard(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const n = this.note;
    if (!n) return;
    const K = this.card;
    c.save();
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.09);
    const done = this.msgT0 + total * per;
    drawNote(c, n, K.x + CPAD.x, K.y + CPAD.top + Math.max(0, (K.h - CPAD.top - CPAD.bottom - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.75), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
