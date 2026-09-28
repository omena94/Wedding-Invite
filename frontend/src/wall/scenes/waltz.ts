// 華爾滋（暗、dance、婚禮服）：一盞聚光燈，宣文（西裝）與孟庭（白紗）在光圈裡跳舞。
//  - 平常是華爾滋握姿＋每拍的起伏（rise & fall）；**每個小節線一個大轉身**，兩種輪流：
//    (a) 兩人一起轉半圈（互換位置：繞著中心轉，前面的人畫在後面的人前面，側面線稿用水平縮放翻面）；
//    (b) 孟庭在宣文舉起的手下轉一圈（裙擺張開、頭紗甩起來）。
//    轉身都有預備（小節線前一點點往反方向帶一下），最快的那一下在小節線上。窗格夠長時最後一小節下腰收尾。
//  - 歌詞沿著地板上光圈前緣的弧線排（lyricOnPath），照跟唱規則逐字亮。
//  - **焦點是主打留言**：寫在舞池邊的迎賓畫架上（象牙白的卡、木頭畫架、牆上一盞小燈打著它），深墨手寫字、署名；
//    卡的大小跟著留言長短。沒有留言時卡上寫邀請、字淡，歌詞變主角。
//  - 鏡頭：整個窗格慢慢推近兩個人。
//  - 慢歌也適用：動作全部跟著拍子與小節走，歌慢就跳得慢。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, keys } from '../engine/util';
import { lyricAt, barAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { drawPerson, inkFor, inkLine, inkPoly, POSE, lerpPose, lyricOnPath, fitNote, drawNote, type Pt, type Joints, type Note } from './_couple';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dance', paper: false, energy: [0, 0.75], bars: [4, 8] };

const CX = 1000, FLOOR = 812;
const SZ = 440;
/** 兩人骨盆離中心的距離（握姿的間距的一半）。 */
const R = SZ * 0.095;
/** 迎賓畫架上的卡：最大的範圍（底邊固定在畫架的托板上、高度跟著留言）與寫字的內距。 */
const CARD = { x: 150, y: 150, w: 540, h: 480 };
const PAD = { x: 40, top: 66, bottom: 34 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

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
    vec2 e = (p - vec2(${CARD.x + CARD.w / 2}.0, ${CARD.y + CARD.h / 2}.0)) / vec2(420.0, 460.0);
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
  floorArc: Pt[] = [];
  note: Note | null = null;
  card = { ...CARD };

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE);
    // 每個小節線一個大轉身：轉半圈、轉圈圈輪流；窗格有四小節以上時，最後一小節下腰
    const bar0 = barAfter(au, this.ctx.start + 0.5);
    const barDur = au.timeOfBar(Math.round(au.barAt(bar0)) + 1) - bar0;
    for (let k = 0, t = bar0; t < this.ctx.end - 0.2 && k < 40; k++) {
      this.moves.push({ t, kind: k % 2 ? 'twirl' : 'turn' });
      t = au.timeOfBar(Math.round(au.barAt(t)) + 1);
    }
    const last = this.moves[this.moves.length - 1];
    if (last && this.moves.length >= 3 && this.ctx.end - last.t > barDur * 0.6) last.kind = 'dip';
    // 地板上的弧線（光圈的前緣）：從左到右、經過最低點，字是正的
    for (let i = 0; i <= 60; i++) {
      const a = lerp(Math.PI * 0.84, Math.PI * 0.26, i / 60);
      this.floorArc.push({ x: CX - 60 + Math.cos(a) * 540, y: FLOOR + Math.sin(a) * 118 });
    }
    // 畫架上的卡：字級依「卡面扣掉署名那一列」算；卡的高度跟著留言長短
    const c = this.fg.ctx;
    const w = CARD.w - PAD.x * 2, hmax = CARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? fitNote(c, this.msg.text, this.msg.name, w, hmax, { min: 46, max: 80 }) : fitNote(c, INVITE, null, w, hmax * 0.5, { min: 44, max: 52 });
    const h = Math.min(CARD.h, Math.max(280, PAD.top + this.note.height + PAD.bottom + 24));
    this.card = { x: CARD.x, y: CARD.y + CARD.h - h, w: CARD.w, h };
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
    c.fillText('The First Dance', K.x + PAD.x, K.y + 46);
    L.upload();
  }

  /** 兩人一起轉的角度（弧度）：每個 turn 小節加半圈；小節線前先往反方向帶一下（預備），小節線上最快。 */
  private theta(t: number) {
    const au = this.ctx.audio;
    let th = 0;
    for (const m of this.moves) {
      if (m.kind !== 'turn') continue;
      const b = au.beatPeriod(m.t);
      th += Math.PI * keys(t, [[m.t - b * 0.5, 0], [m.t - b * 0.08, -0.07, ease.inOutCubic], [m.t + b * 1.3, 1, ease.outCubic]]);
    }
    return th;
  }

  /** 這一格的舞步：基本握姿＋起伏，靠近小節線時接轉身／轉圈／下腰。 */
  private state(t: number) {
    const au = this.ctx.audio;
    const bp = au.beatPeriod(t);
    const ph = au.barAt(t);
    let lead = POSE.waltzStep(ph, POSE.waltzLead());
    let follow = POSE.waltzStep(ph + 0.5, POSE.waltzFollow());
    let spin = 0, flare = 0, gap = 1, front = 0;
    for (const m of this.moves) {
      if (m.kind === 'twirl') {
        const u = prog(t, m.t, m.t + bp * 1.6, ease.inOutCubic);
        const w = keys(t, [[m.t - bp * 0.4, 0], [m.t, 1], [m.t + bp * 1.6, 1], [m.t + bp * 2.3, 0]]);
        if (w > 0) {
          lead = lerpPose(lead, POSE.twirlLead(), w);
          follow = lerpPose(follow, POSE.twirl(), w);
          spin += u;
          flare = Math.max(flare, Math.sin(Math.PI * u));
          // 轉圈時她在他舉起的手底下、一臂遠，畫在他前面（她是主角）
          gap = Math.max(gap, 1 + 0.3 * w);
          front = Math.max(front, w);
        }
      } else if (m.kind === 'dip') {
        const w = keys(t, [[m.t - bp * 0.5, 0], [m.t + bp * 0.9, 1, ease.inOutCubic]]);
        if (w > 0) { lead = lerpPose(lead, POSE.dipLead(), w); follow = lerpPose(follow, POSE.dipFollow(), w); gap = Math.min(gap, 1 - 0.25 * w); }
      }
    }
    return { lead, follow, spin, flare, gap, front };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.spot.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.7, ease.inOutCubic);
    // 聚光燈裡的人：填色用比底色亮一點的暗色，才浮在光圈上
    const ink = inkFor(false, { fill: rgba('ink2') });

    // 歌詞在地板上
    const ly = lyricAt(lyrics, t);
    if (ly) lyricOnPath(c, ly.line, t, this.floorArc, { family: F.archivo(100, 700), size: this.msg ? 50 : 60, minSize: 48, offset: -8, alpha: ly.k * rv, unsung: rgba('bone', 0.24) });

    // 兩人的位置：繞著中心轉（前面的人比較大、比較低）
    const th = this.theta(t);
    const vel = (this.theta(t) - this.theta(t - 0.06)) / 0.06;
    const st = this.state(t);
    const spinT = th / (Math.PI * 2);
    const place = (sign: 1 | -1) => {
      const x = CX - sign * R * st.gap * Math.cos(th), z = sign * Math.sin(th);
      return { x, y: FLOOR + z * 26, h: SZ * (1 + z * 0.035), z };
    };
    const pa = place(1), po = place(-1);
    const drawA = () => drawPerson(c, 'alan', st.lead, { x: pa.x, y: pa.y, h: pa.h, outfit: 'wedding', ink, t, reveal: rv, spin: spinT });
    const drawO = () => drawPerson(c, 'omena', st.follow, {
      x: po.x, y: po.y, h: po.h, dir: -1, outfit: 'wedding', ink, t, reveal: rv,
      spin: spinT + st.spin, flare: Math.max(st.flare, clamp(Math.abs(vel) * 0.15)), flow: clamp(0.25 + Math.abs(vel) * 0.25 + st.flare * 0.6, 0, 1),
    });
    let a: Joints, o: Joints;
    if (pa.z < po.z || st.front > 0.5) { a = drawA(); o = drawO(); } else { o = drawO(); a = drawA(); }
    for (const j of [a, o]) if (j.pen) { const pn = j.pen; sparkHead(this.glow, pn.x, pn.y, t, 0.8); sparkParticles(this.glow, t, () => pn, { rate: 60, life: 0.3, speed: 150 }); }

    // 轉身的時候：地板上留一道訊號色的弧（腳步的軌跡），很快淡掉
    if (Math.abs(vel) > 0.5) {
      const sg = LIN.signal, k = clamp((Math.abs(vel) - 0.5) / 3);
      const pts: Pt[] = [];
      for (let i = 0; i <= 20; i++) { const a2 = th - (i / 20) * 0.9 * Math.sign(vel); pts.push({ x: CX - R * 1.6 * Math.cos(a2), y: FLOOR + 6 + Math.sin(a2) * 30 }); }
      this.glow.polyline(pts, 2, [sg[0] * 2, sg[1] * 2, sg[2] * 2], 0.6 * k);
    }

    this.drawCard(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢推近兩個人（最多 1.03 倍，卡與歌詞離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.65, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(CX - W / 2) * 0.03 * push, 0] };
  }

  /** 舞會卡上的留言：第一個小節線起一個字一個字寫上去，寫完簽名。 */
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
