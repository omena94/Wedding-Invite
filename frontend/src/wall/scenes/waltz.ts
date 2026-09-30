// 華爾滋（暗、dance、婚禮服）：一盞聚光燈，宣文（西裝）與孟庭（白紗）在光圈裡跳舞。角色是 Codex 畫的雙人紙偶（cp_waltz_1～4，_puppet.ts）。
//  - 平常是閉式舞姿（waltz_1）＋每拍的起伏（rise & fall：拍點上沉、拍與拍之間升起）；**每個小節線一個大動作**，兩種輪流：
//    (a) 兩人一起轉半圈：紙偶翻面（轉到側面變成一條線、翻過來換成兩人互換位置），轉的時候換成裙擺甩開的那張（waltz_2）；
//    (b) 孟庭在宣文舉起的手下轉圈（waltz_3，頭紗飛起來），落地彈一下。
//    轉身都有預備（小節線前一點點往反方向帶一下），最快的那一下在小節線上。窗格夠長時最後一小節下腰收尾（waltz_4）。
//  - 歌詞沿著地板上光圈前緣的弧線排（lyricOnPath），照跟唱規則逐字亮；比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在舞池邊的迎賓畫架上（象牙白的卡、木頭畫架、牆上一盞小燈打著它），深墨手寫字、署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、卡最大 580 × 400，放在畫面左側，高度跟著留言長短。沒有留言時卡上寫邀請、字淡，歌詞變主角。
//  - 聚光燈從上面打下來：紙偶上亮下暗（puppetLight），白紗才不會比卡上的字還亮。鏡頭：整個窗格慢慢推近兩個人。
//  - 慢歌也適用：動作全部跟著拍子與小節走，歌慢就跳得慢。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, keys } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, barAfter, sparkHead, sparkParticles, msgChars, lyricSubOf } from './_motifs';
import { inkFor, inkLine, inkPoly, lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPick, puppetShadow, puppetIn, puppetLight, breathe, landSquash, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'dance', paper: false, energy: [0, 0.75], bars: [4, 8] };

const CX = 1060, FLOOR = 812;
const SZ = 440;
/** 迎賓畫架上的卡：最大的範圍（標準 v2；底邊固定在畫架的托板上、高度跟著留言）與寫字的內距。 */
const CARD = { x: 130, bottom: 630, w: 580, h: 400 };
const PAD = { x: 40, top: 62, bottom: 30 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const POSES = ['cp_waltz_1', 'cp_waltz_2', 'cp_waltz_3', 'cp_waltz_4'];

type Kind = 'turn' | 'twirl' | 'dip';
interface Move { t: number; kind: Kind }

/**
 * 聚光燈：從上面斜下來的一道很淡的光、地板上一個光圈。用 shader 算（浮點＋一點點抖色），
 * Canvas2D 的淡漸層只有幾個 8 位元的階，大螢幕上會看到一條一條的。
 */
const SPOT = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float y = clamp(p.y / ${FLOOR}.0, 0.0, 1.0);
    float hw = mix(70.0, 440.0, y);
    float d = abs(p.x - ${CX}.0) / hw;
    float cone = (1.0 - smoothstep(0.45, 1.1, d)) * smoothstep(-0.1, 1.0, y) * (1.0 - smoothstep(${FLOOR}.0, ${FLOOR + 60}.0, p.y));
    vec2 q = (p - vec2(${CX}.0, ${FLOOR}.0)) / vec2(560.0, 110.0);
    float pool = exp(-dot(q, q) * 1.8);
    vec2 e = (p - vec2(${CARD.x + CARD.w / 2}.0, ${CARD.bottom - CARD.h / 2}.0)) / vec2(420.0, 440.0);
    float easel = exp(-dot(e, e) * 1.6);
    vec3 col = C_INK + C_BONE * (0.016 * cone + 0.05 * pool + 0.014 * easel);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

export default class Waltz extends Scene {
  spot = shared('waltz.spot', SPOT);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  moves: Move[] = [];
  keys: [number, string][] = [];
  floorArc: Pt[] = [];
  arcLen = 0;
  /** 有韓文原文的句子用的弧（往上抬一點）。 */
  floorArcSub: Pt[] = [];
  /** 有韓文原文的句子：中文排成一排放得下的字級（第一次用到時量好）。 */
  subFit = new Map<Line, number>();
  note: Note | null = null;
  card = { x: CARD.x, y: CARD.bottom - CARD.h, w: CARD.w, h: CARD.h };
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(POSES));
    // 每個小節線一個大動作：轉半圈、轉圈圈輪流；窗格有四小節以上時，最後一小節下腰
    const bar0 = barAfter(au, this.ctx.start + 0.5);
    const barDur = au.timeOfBar(Math.round(au.barAt(bar0)) + 1) - bar0;
    for (let k = 0, t = bar0; t < this.ctx.end - 0.2 && k < 40; k++) {
      this.moves.push({ t, kind: k % 2 ? 'twirl' : 'turn' });
      t = au.timeOfBar(Math.round(au.barAt(t)) + 1);
    }
    const last = this.moves[this.moves.length - 1];
    if (last && this.moves.length >= 3 && this.ctx.end - last.t > barDur * 0.6) last.kind = 'dip';
    // 姿勢時間軸：轉半圈時裙擺甩開（waltz_2）、轉圈圈（waltz_3）、下腰（waltz_4），其他時候閉式舞姿（waltz_1）
    this.keys = [[-1e9, 'cp_waltz_1']];
    for (const m of this.moves) {
      const bp = au.beatPeriod(m.t);
      if (m.kind === 'turn') this.keys.push([m.t - bp * 0.25, 'cp_waltz_2'], [m.t + bp * 1.4, 'cp_waltz_1']);
      else if (m.kind === 'twirl') this.keys.push([m.t, 'cp_waltz_3'], [m.t + bp * 2, 'cp_waltz_1']);
      else this.keys.push([m.t - bp * 0.3, 'cp_waltz_4']);
    }
    // 地板上的弧線（光圈的前緣）：從左到右、經過最低點，字是正的
    for (let i = 0; i <= 60; i++) {
      const a = lerp(Math.PI * 0.84, Math.PI * 0.26, i / 60);
      this.floorArc.push({ x: CX - 60 + Math.cos(a) * 540, y: FLOOR + Math.sin(a) * 118 });
    }
    this.floorArcSub = this.floorArc.map((p) => ({ x: p.x, y: p.y - 22 }));
    for (let i = 1; i < this.floorArc.length; i++) this.arcLen += Math.hypot(this.floorArc[i]!.x - this.floorArc[i - 1]!.x, this.floorArc[i]!.y - this.floorArc[i - 1]!.y);
    // 畫架上的卡：標準 v2 的字級；卡的寬高跟著留言（在畫架上置中）
    const c = this.fg.ctx;
    const w = CARD.w - PAD.x * 2, hmax = CARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const h = Math.min(CARD.h, Math.max(230, PAD.top + this.note.height + PAD.bottom + 16));
    const cw = Math.min(CARD.w, tightenNote(c, this.note, 340) + PAD.x * 2);
    this.card = { x: CARD.x + (CARD.w - cw) / 2, y: CARD.bottom - h, w: cw, h };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 迎賓畫架（畫一次；聚光燈在 shader 裡）：A 字形的兩隻前腳、一隻後腳、托板，上面一張象牙白的卡。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ink = inkFor(false, { fill: rgba('ink2') });
    const K = this.card, base = FLOOR - 10;
    const cx = K.x + K.w / 2, ledge = K.y + K.h + 8;
    const wood = mixRgba('ink2', 'fur', 0.18);
    // 後腳、兩隻前腳（從卡的上緣後面伸出來，腳底在地板上）
    inkLine(c, [{ x: cx + 14, y: K.y + 20 }, { x: cx + 120, y: base - 8 }], { ink, w: 0.8, seed: 31, color: rgba('bone', 0.5) });
    for (const [x0, x1, sd] of [[K.x + 90, K.x + 20, 32], [K.x + K.w - 90, K.x + K.w - 20, 33]] as const) {
      inkPoly(c, [{ x: x0 - 6, y: K.y - 26 }, { x: x0 + 6, y: K.y - 26 }, { x: x1 + 7, y: base }, { x: x1 - 7, y: base }], { ink, fill: wood, w: 0.7, seed: sd });
    }
    // 托板
    inkPoly(c, [{ x: K.x - 26, y: ledge - 10 }, { x: K.x + K.w + 26, y: ledge - 10 }, { x: K.x + K.w + 22, y: ledge + 8 }, { x: K.x - 22, y: ledge + 8 }], { ink, fill: wood, w: 0.8, seed: 34 });
    // 卡：象牙白、往右下一點點的影子、細細的內框
    c.fillStyle = rgba('ink', 0.6);
    c.fillRect(K.x + 10, K.y + 12, K.w, K.h);
    inkPoly(c, [{ x: K.x, y: K.y }, { x: K.x + K.w, y: K.y + 1 }, { x: K.x + K.w - 1, y: K.y + K.h }, { x: K.x + 1, y: K.y + K.h - 1 }], { ink, fill: mixRgba('bone', 'cream', 0.4), w: 0.8, seed: 35 });
    c.strokeStyle = rgba('sepia', 0.22);
    c.lineWidth = 1;
    c.strokeRect(K.x + 14, K.y + 14, K.w - 28, K.h - 28);
    c.font = font(F.serif(400, true), 22);
    c.fillStyle = rgba('sepia', 0.55);
    c.fillText('The First Dance', K.x + PAD.x, K.y + 44);
    L.upload();
  }

  /** 兩人一起轉的角度（圈數）：每個 turn 小節加半圈；小節線前先往反方向帶一下（預備），小節線上最快。 */
  private spin(t: number) {
    const au = this.ctx.audio;
    let s = 0;
    for (const m of this.moves) {
      if (m.kind !== 'turn') continue;
      const b = au.beatPeriod(m.t);
      s += 0.5 * keys(t, [[m.t - b * 0.5, 0], [m.t - b * 0.08, -0.07, ease.inOutCubic], [m.t + b * 1.3, 1, ease.outCubic]]);
    }
    return s;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.spot.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.7, ease.inOutCubic);

    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    const sp = this.spin(t);
    const vel = (sp - this.spin(t - 0.06)) / 0.06;
    // rise & fall：拍點上沉（壓一下）、拍與拍之間升起
    const ph = f.beatPhase;
    let lift = 7 * Math.sin(Math.PI * ph), squash = 0.022 * Math.exp(-ph / 0.12) + breathe(t, 0.006, 3.6), rot = 0.018 * Math.sin(au.barAt(t) * Math.PI * 2);
    for (const m of this.moves) {
      if (m.kind === 'twirl') {
        // 轉圈圈：小節線上輕輕一彈、落下時壓扁回彈
        const u = (t - m.t) / (bp * 0.5);
        if (u > 0 && u < 1) lift += 16 * Math.sin(Math.PI * u);
        squash += landSquash(t, m.t + bp * 0.5, 0.06, 0.3);
      } else if (m.kind === 'dip') {
        // 下腰：慢慢沉下去、停住（起伏收掉）
        const k = prog(t, m.t - bp * 0.3, m.t + bp, ease.inOutCubic);
        lift *= 1 - k; rot *= 1 - k; squash = squash * (1 - k) + 0.02 * k;
      }
    }
    const ent = puppetIn(t, s + 0.05, 0.55);
    if (ent.alpha > 0) {
      puppetShadow(c, 'cp', CX, FLOOR, { h: SZ, lift, alpha: 0.8 * ent.alpha, wide: 1.1, color: '0,0,0' });
      drawPick(c, this.keys, t, CX, FLOOR - lift, { h: SZ, spin: sp + ent.spin, rot, pivot: 0.3, squash, alpha: ent.alpha });
      // 聚光燈從上面打下來：上亮下暗（白紗不要比卡上的字還亮）
      puppetLight(c, [CX - 420, FLOOR - SZ * 1.3, 840, SZ * 1.3 + 30], rgba('ink', 0.04), rgba('ink', 0.42));
      if (ent.k < 1) {
        sparkHead(this.glow, CX, FLOOR - 6, t, 0.8);
        sparkParticles(this.glow, t, () => ({ x: CX, y: FLOOR - 6 }), { rate: 60, life: 0.3, speed: 150 });
      }
    }

    // 歌詞在地板上
    const ly = lyricAt(lyrics, t);
    if (ly) {
      // 有韓文原文時：原文排在中文下面（更靠近鏡頭），中文折成兩排的話原文會掉到畫面下緣——寧可把中文縮小一點排成一排
      // （字級自己先找好、留一點餘裕：lyricOnPath 照比例縮到剛好時會因為四捨五入被折行）；
      // 縮到 34 還放不下才折，整條弧往上抬一排。原文在地板上更靠近鏡頭，整條弧再往上抬一點，原文才不會貼著畫面下緣
      // （平移整條弧：用 offset 會改到弧長，剛好放得下的句子會被折成兩排）
      const fam = F.archivo(100, 700);
      let size = this.lyricSize, min = 40, off = -8, arc = this.floorArc;
      if (lyricSubOf(ly.line)) {
        let fit = this.subFit.get(ly.line);
        if (fit === undefined) {
          c.font = font(fam, 100);
          const w100 = Array.from(ly.line.text).reduce((a, ch) => a + c.measureText(ch).width, 0);
          fit = Math.floor((100 * this.arcLen * 0.94 * 0.97) / Math.max(1, w100));
          this.subFit.set(ly.line, fit);
        }
        size = Math.min(size, Math.max(34, fit));
        min = size;
        if (fit < 34) off += size * 1.2;
        arc = this.floorArcSub;
      }
      lyricOnPath(c, ly.line, t, arc, { family: fam, size, minSize: min, offset: off, alpha: ly.k * rv, unsung: rgba('bone', 0.24) });
    }

    // 轉身的時候：地板上留一道訊號色的弧（腳步的軌跡），很快淡掉
    const av = Math.abs(vel) * Math.PI * 2;
    if (av > 0.5) {
      const sg = LIN.signal, k = clamp((av - 0.5) / 3);
      const th = sp * Math.PI * 2;
      const pts: Pt[] = [];
      for (let i = 0; i <= 20; i++) { const a2 = th - (i / 20) * 0.9 * Math.sign(vel); pts.push({ x: CX - 110 * Math.cos(a2), y: FLOOR + 6 + Math.sin(a2) * 30 }); }
      this.glow.polyline(pts, 2, [sg[0] * 2, sg[1] * 2, sg[2] * 2], 0.6 * k);
    }

    this.drawCard(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢推近兩個人（最多 1.03 倍，卡與歌詞離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.65, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(CX - W / 2) * 0.03 * push, 0] };
  }

  /** 畫架卡上的留言：第一個小節線起一個字一個字寫上去（深墨手寫字），寫完署名淡入；在卡面上垂直置中。 */
  private drawCard(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const K = this.card;
    const t0 = Math.min(this.moves[0]?.t ?? this.ctx.start + 0.6, this.ctx.start + 1.2);
    const total = msgChars(n.fit);
    const per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    const done = t0 + total * per;
    const top = K.y + PAD.top, h = K.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    drawNote(c, n, K.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.72), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
