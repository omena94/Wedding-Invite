// 成績單（亮）：鏡頭貼著桌上一張「愛情學校　成績通知單」。
//  - 第一拍起，成績一格一格「蓋」上去：宣文、孟庭兩欄，體貼、做家事、遛狗（芃芃、QQ）、分享最後一口、決定晚餐吃什麼
//    （最後一科兩個人都是「丙：仍在努力」——溫柔的冷面笑話）。印章一拍兩三個、砸下去的那一下畫面輕輕一震，印泥有缺墨的顆粒。
//  - 同時導師拿紅筆在「導師評語」欄寫評語——主打留言就是評語（這一張的焦點：最大、手寫的紅字），簽名欄寫「導師：留言的名字」
//    （每一位賓客都是他們的導師）。鏡頭一開始對著成績、景深在上面；紅筆開始寫的時候，焦點與鏡頭一起慢慢移到評語（拉焦）。
//  - 歌詞是「校歌（現場）」那一欄，照跟唱規則逐字亮，在成績與評語中間，兩個鏡位都看得到。
//  - 時間夠長的窗格：最後一個小節線，校長（芃芃）的圓章「准予升級」砸在右下角。
//  - 沒有留言：評語欄寫邀請；新人的留言：評語欄的標題改成「新人的話」、簽名是新人。純音樂：校歌欄寫歌名。
// 畫法：紙、桌面、透視、景深是 _t3 的文件攝影機；表格等不會變的字開場畫在一張離屏畫布，每格貼進文件圖層再畫會變的
// （印章、評語、歌詞）。印章的圖案（含缺墨的顆粒）在 init 先畫好，每格只 drawImage。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse } from '../engine/util';
import type { FitResult } from '../engine/text';
import { drawLyric, drawMessage, lyricAt, signature, COUPLE_ZH, type LyricStyle } from './_motifs';
import { grid, stagger, windowLines, fitMsg, boxLyric, mono, tag, pad3, paperLyric, DocCam, withMips, inkStamp, HUD, EDGE, type Grid, type Pose } from './_t3';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.3, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 文件（成績單）座標，y 向下
const DW = 1500, DH = 1260;
const TS = SCALE * 1.4;
const CARD: [number, number, number, number] = [210, 40, 1080, 1180];
const X0 = 270, X1 = 1230; // 內容左右
const TABLE = { y: 250, rowH: 60, cols: [X0, 580, 760, 940, X1] }; // 科目｜宣文｜孟庭｜備註
const LYR = { x: X0, y: 628, w: X1 - X0, h: 118 };
const CMT = { x: X0, y: 782, w: X1 - X0, h: 300 };
const MSG_FAM = F.hand(400);
const LYR_FAM = F.archivo(100, 700);
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
/** 科目、兩個人的成績、備註（冷面，溫柔）。 */
const SUBJECTS: [string, string, string, string][] = [
  ['體貼', '甲上', '甲上', '彼此彼此'],
  ['做家事', '甲', '甲上', '洗碗、摺衣服分工良好'],
  ['遛狗（芃芃、QQ）', '優', '優', '風雨無阻'],
  ['分享最後一口', '甲上', '甲上', ''],
  ['決定晚餐吃什麼', '丙', '丙', '仍在努力'],
];
const FIXED = `愛情學校成績通知單學年度學期班級永遠班座號姓名科目備註導師評語新人的話導師校長芃芃訓導主任校歌現場准予升級${SUBJECTS.flat().join('')}${GROOM}${BRIDE}本欄留給你寫掃描右下角把給新人的評語寫在這裡純音樂`;

const PAPER_GLSL = /* glsl */ `
vec3 paperCol(vec2 d, vec4 fb) {
  // 厚一點的卡紙：纖維淡；焦點附近被檯燈照亮
  vec3 p = mix(C_PAPER, C_BONE, 0.18) * (0.93 + 0.1 * (fb.r - 0.5) + 0.05 * (fb.g - 0.5));
  vec2 q = (d - focus) / vec2(900.0, 650.0);
  return p * (0.9 + 0.1 * exp(-dot(q, q)));
}
vec3 deskCol(vec2 s, vec4 fb) {
  // 木頭書桌：橫紋，右上方比較亮
  float grain = fbm(vec2(s.x / 700.0, s.y / 22.0), 3);
  return mix(C_PAPER, C_SEPIA, 0.44 + 0.06 * grain) * (0.78 + 0.22 * (s.x / 1920.0)) * (0.92 + 0.08 * fb.r);
}`;

/** 一個印章：先畫在自己的小畫布上（有缺墨的顆粒），每格只 drawImage。 */
interface Stamp { cv: HTMLCanvasElement; w: number; h: number; x: number; y: number; rot: number; t: number }

export default class ReportCard extends Scene {
  cam = shared('reportcard.cam', () => new DocCam(PAPER_GLSL));
  base = this.track(new Layer2D(DW, DH, TS));
  doc = this.track(withMips(new Layer2D(DW, DH, TS, { fast: true })));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  stamps: Stamp[] = [];
  seal: Stamp | null = null;
  fit: FitResult | null = null;
  msgTimes: number[] = [];
  tWrite = 0; tDone = 0;
  shift = { x: 0, y: 0 };
  private baseDrawn = false;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const m = this.msg;
    const wl = windowLines(lyrics, s, e);
    await loadText(`${FIXED}${song.title}${m ? m.text + signature(m.name) : ''}${wl.map((l) => l.text).join('')}`);
    // 成績：十個章，第一拍起在一小節內（窗格短就更快）蓋完，一拍兩到四個
    const tot = e - g.b0;
    const ts = stagger(au, g.b0, SUBJECTS.length * 2, clamp(tot * 0.28, g.beat * 1.5, g.bar * 0.8));
    SUBJECTS.forEach((sub, i) => {
      for (let j = 0; j < 2; j++) {
        const txt = sub[1 + j]!, size = 64;
        const cx = (TABLE.cols[1 + j]! + TABLE.cols[2 + j]!) / 2, cy = TABLE.y + (i + 1) * TABLE.rowH + TABLE.rowH / 2;
        this.stamps.push({ cv: inkStamp(txt, size, txt.length === 1, 100 + i * 7 + j, undefined), w: size + 16, h: size + 16, x: cx + (hash(i, j) - 0.5) * 14, y: cy + (hash(j, i, 3) - 0.5) * 6, rot: (hash(i, j, 5) - 0.5) * 0.35, t: ts[i * 2 + j]! });
      }
    });
    // 紅筆寫評語：成績蓋到一半就開始寫，一小節多一點寫完
    this.tWrite = ts[4] ?? g.b0;
    if (m) {
      this.fit = fitMsg(this.doc.ctx, m.text, MSG_FAM, CMT.w - 20, CMT.h - 110, { min: 54, max: 104, lineHeight: 1.22 });
      const n = Array.from(this.fit.lines.join('')).length;
      this.msgTimes = stagger(au, this.tWrite, n, clamp(tot * 0.35, g.beat * 2, g.bar * 1.25));
      this.tDone = (this.msgTimes[n - 1] ?? this.tWrite) + g.beat * 0.5;
    } else this.tDone = this.tWrite + g.bar;
    // 校長的圓章：最後一個小節線（至少在評語寫完一小節之後），蓋在頁尾「校長　芃芃」旁邊
    const last = g.bars.filter((b) => b >= this.tDone + g.bar * 0.9 && b < e - g.beat * 1.5).pop();
    if (last !== undefined) this.seal = { cv: inkStamp('准予升級', 190, true, 7, '愛情學校校長'), w: 206, h: 206, x: X0 + 470, y: CMT.y + CMT.h + 44, rot: -0.12, t: last };
    // 鏡頭推到最近時，評語的最後一行、簽名不能碰到下緣／HUD
    for (let it = 0; it < 3; it++) {
      this.cam.pose(this.pose(e), DW, DH);
      const ps = [this.cam.project(X1, CMT.y + CMT.h + 40), this.cam.project(X0, CMT.y + CMT.h + 40), this.cam.project(X1, LYR.y)];
      // 校長的圓章也要整顆在畫面裡（它是最後那一下的重拍）
      if (this.seal) ps.push(this.cam.project(this.seal.x, this.seal.y + this.seal.h / 2 - 20));
      let up = 0, left = 0;
      for (const p of ps) {
        if (p.y > 1080 - EDGE) up = Math.max(up, p.y - (1080 - EDGE));
        if (p.y > HUD.y - 10 && p.x > HUD.x - 20) left = Math.max(left, p.x - (HUD.x - 20));
      }
      this.shift.y -= up; this.shift.x -= left;
    }
  }

  /** 鏡頭：一開始看成績（上半），紅筆開始寫就慢慢搖到評語（拉焦一起），之後一直慢慢推。 */
  private pose(t: number): Pose {
    const toCmt = ease.inOutCubic(prog(t, this.tWrite - 0.1, this.tWrite + this.g.bar * 0.9));
    const slow = ease.inOutCubic(prog(t, this.ctx.start, this.ctx.end));
    let kick = 0;
    for (const st of this.stamps) kick += pulse(t, st.t, 0.07) * 0.004;
    if (this.seal) kick += pulse(t, this.seal.t, 0.12) * 0.02;
    return {
      x: 760, y: lerp(470, 770, toCmt),
      z: lerp(1.08, 1.14, toCmt) + 0.04 * slow + kick,
      roll: lerp(0.035, 0.02, toCmt), tilt: lerp(0.3, 0.24, toCmt), pan: -0.08 + 0.06 * slow,
      sx: 900 + this.shift.x, sy: 540 + this.shift.y,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t;
    if (!this.baseDrawn) { this.drawBase(); this.baseDrawn = true; }
    const D = this.doc; D.clear();
    const c = D.ctx;
    c.drawImage(this.base.canvas, 0, 0, DW, DH);
    // 印章
    for (const st of this.stamps) this.stamp(c, st, t);
    // 校歌（歌詞）
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const max = this.fit ? Math.min(62, Math.round(this.fit.size * 0.84)) : 76;
      const lay = boxLyric(c, ly.line, LYR_FAM, LYR.w, LYR.h - 34, { min: 52, max, lineHeight: 1.1, maxLines: 2 });
      const y0 = LYR.y + 34 + Math.max(0, (LYR.h - 34 - lay.height) / 2) + lay.size * 0.8;
      c.save(); c.translate(LYR.x, y0);
      const st: LyricStyle = { family: LYR_FAM, size: lay.size, maxWidth: LYR.w, ...paperLyric() };
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else if (!lyrics.has) {
      c.font = font(F.serif(400, true), 40); c.fillStyle = rgba('sepia', 0.6);
      c.fillText(`♪ ${this.ctx.song.title || '純音樂'}`, LYR.x, LYR.y + 96);
    }
    this.drawComment(c, t);
    if (this.seal) this.stamp(c, this.seal, t, 1.8);
    D.upload();
    const toCmt = ease.inOutCubic(prog(t, this.tWrite - 0.1, this.tWrite + this.g.bar * 0.9));
    this.cam.pose(this.pose(t), DW, DH);
    this.cam.render(renderer, out, {
      tex: D.texture, docW: DW, docH: DH, texScale: TS, rect: CARD,
      focus: { x: 750, y: lerp(430, 830, toCmt) }, focusR: [640, lerp(260, 320, toCmt)], blur: 7, shadow: [14, 24],
    });
    return { paper: 1, bloom: 0.26, vignette: 0.36, grain: 0.05, halation: 0.06 };
  }

  /** 蓋章：從大一點、高一點砸下來（0.08 秒），落定的那一下印泥最濃。 */
  private stamp(c: CanvasRenderingContext2D, st: Stamp, t: number, big = 1) {
    if (t < st.t - 0.06) return;
    const u = prog(t, st.t - 0.06, st.t + 0.02, ease.inCubic);
    const sc = lerp(1.35 * big, 1, u);
    const a = t < st.t ? 0.25 * u : 1;
    c.save();
    c.globalAlpha *= a;
    c.translate(st.x, st.y); c.rotate(st.rot); c.scale(sc, sc);
    c.drawImage(st.cv, -st.w / 2, -st.h / 2, st.w, st.h);
    c.restore();
  }

  // ------------------------------------------------------------ 不會變的：表頭、表格、欄位名稱（小、淡）
  private drawBase() {
    const c = this.base.ctx;
    this.base.clear();
    const ink = (a: number) => rgba('sepia', a);
    c.textBaseline = 'alphabetic';
    c.font = font(F.ming(900), 30); c.fillStyle = ink(0.88);
    c.fillText('愛情學校　成績通知單', X0, 118);
    mono(c, '116 學年度　第 2 學期', X1, 116, { size: 15, color: ink(0.6), align: 'right', tracking: 2 });
    tag(c, `班級：永遠班　　座號：0313　　姓名：${COUPLE_ZH}`, X0, 170, { size: 19, color: ink(0.7), tracking: 2 });
    c.fillStyle = ink(0.7); c.fillRect(X0, 196, X1 - X0, 2);
    // 表格
    const { y: ty, rowH, cols } = TABLE;
    const rows = SUBJECTS.length + 1;
    c.fillStyle = ink(0.06); c.fillRect(X0, ty, X1 - X0, rowH);
    c.fillStyle = ink(0.4);
    for (let r = 0; r <= rows; r++) c.fillRect(X0, ty + r * rowH - 0.6, X1 - X0, r === 0 || r === rows ? 1.8 : 1.1);
    for (const x of cols) c.fillRect(x - 0.6, ty, 1.2, rows * rowH);
    const head = ['科目', GROOM, BRIDE, '備註'];
    head.forEach((h, i) => tag(c, h, cols[i]! + 18, ty + rowH / 2 + 7, { size: 19, color: ink(0.75), tracking: 3, weight: 700 }));
    SUBJECTS.forEach((sub, i) => {
      const y = ty + (i + 1) * rowH + rowH / 2 + 7;
      tag(c, sub[0], cols[0]! + 18, y, { size: 20, color: ink(0.8), tracking: 1 });
      if (sub[3]) tag(c, sub[3], cols[3]! + 16, y, { size: 16, color: ink(0.55), tracking: 1 });
    });
    // 校歌、導師評語的欄名（小）
    tag(c, '校歌（現場）', LYR.x, LYR.y + 16, { size: 16, color: ink(0.5), tracking: 4 });
    c.fillStyle = ink(0.35); c.fillRect(X0, LYR.y - 14, X1 - X0, 1.2); c.fillRect(X0, CMT.y - 14, X1 - X0, 1.2);
    // 頁尾：校長、訓導主任（小字）
    tag(c, '校長　芃芃　　訓導主任　QQ', X0, CMT.y + CMT.h + 76, { size: 16, color: ink(0.5), tracking: 3 });
  }

  // ------------------------------------------------------------ 導師評語（留言，紅筆，焦點）
  private drawComment(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg;
    const ink = (a: number) => rgba('sepia', a);
    tag(c, m?.couple ? '新人的話' : '導師評語', CMT.x, CMT.y + 16, { size: 16, color: ink(0.5), tracking: 4 });
    if (m) mono(c, `NO.${pad3(m.n)}`, X1, CMT.y + 14, { size: 12, color: ink(0.38), align: 'right', tracking: 3 });
    const pen = mixRgba('blood', 'sepia', 0.18, 0.95);
    if (m && this.fit) {
      const n = this.msgTimes.filter((x) => x <= t).length;
      drawMessage(c, this.fit, MSG_FAM, CMT.x, CMT.y + 38 + this.fit.size * 0.9, { chars: n, color: pen });
      const ks = prog(t, this.tDone, this.tDone + 0.3);
      if (ks > 0) {
        c.save(); c.globalAlpha *= ks;
        const who = m.couple ? COUPLE_ZH : m.name || '一位賓客';
        c.font = font(MSG_FAM, 40); c.fillStyle = pen; c.textAlign = 'right';
        c.fillText(`導師：${who}`, X1, CMT.y + 38 + this.fit.height + 58);
        c.textAlign = 'left';
        c.restore();
      }
    } else if (!m) {
      c.save(); c.globalAlpha *= prog(t, this.tWrite, this.tWrite + 0.4);
      c.font = font(MSG_FAM, 56); c.fillStyle = mixRgba('blood', 'sepia', 0.3, 0.7);
      c.fillText('本欄留給你寫。', CMT.x, CMT.y + 110);
      c.font = font(MSG_FAM, 42);
      c.fillText('掃描右下角 QR code，把給新人的評語寫在這裡。', CMT.x, CMT.y + 180);
      c.restore();
    }
  }
}
