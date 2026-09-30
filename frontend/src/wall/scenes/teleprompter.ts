// 提詞機（雙語・批次 B1，暗）：站在講台後面看出去的攝影棚。前面（左下）是講台斜斜的木頭檯面，上面放著一張講稿；
// 後面（右上）是一台架在腳架上的攝影機，鏡頭前面斜放著提詞機的玻璃：玻璃上映出一行一行往上捲的字幕，
// 透過玻璃隱約看得到後面的鏡頭。上面一顆「錄影中」的燈照拍子閃，左上的柔光箱從畫面外打進來，光裡有一點煙；
// 每個小節線一道掃過背景的光。鏡頭慢慢推近，前景（講台）比背景多移一點（視差）。
//  - 兩行歌詞是提詞機玻璃上的字：一句一組（中文一行、原文小一號一行），整片照歌聲的速度連續往上捲，
//    正在唱的那一組剛好在「讀稿線」上（左邊一個訊號色的小三角），逐字亮；唱過的往上淡掉、還沒唱的在下面等。
//    玻璃有一點點雙影（前後兩面各反射一次）與一道斜斜的反光。沒有翻譯的歌每組只有一行，間距跟著變小。
//  - 主打留言是講台上的講稿：白紙、宋體打字、表頭「致詞稿」、署名在最後一行下面；小節線上紙角被空調吹得翹一下。
//    沒有留言時講稿寫「這一頁留給你」＋邀請。純音樂：提詞機上跑舞台指示（「（音樂進）」「（舉杯）」……）。
//  - 標準 v2：留言 40～60 px、講稿的字區 ≤ 620×320（左下）；中文 40～52、原文 32～40（_b1.ts）。右下角 HUD 底下只有暗的地板。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, lerp, smoothstep, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { beatAfter, signature, fillWithHearts, type LyricStyle } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { biLayout, drawBi, fitMsgV2, type BiLay, type MsgFit } from './_b1';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: false, energy: [0.15, 0.8], bars: [4, 8] };

/** 提詞機的玻璃（畫面座標）、讀稿線、字的左緣與最寬。 */
const GL = { x0: 760, y0: 150, x1: 1620, y1: 590 };
const READ_Y = 330;
const TX = GL.x0 + 76, TW = GL.x1 - GL.x0 - 140;
/** 講稿：紙的左上角、寬高（字區比紙小一圈）。 */
const PAPER = { x: 150, y: 636, w: 690, h: 372 };
const MSG_FAM = F.ming(700);
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const CUES = ['（音樂進）', '（看向新人，微笑）', '（舉杯）', '（掌聲）', '（停頓兩拍）', '（全場一起）'];

const BG = () => new FSPass(/* glsl */ `
  uniform float uT; uniform float uIn; uniform float uSweep; uniform vec2 uPar;
  // 講台檯面：上緣 y=604（x 40～930）、下緣出畫（x -60～1040）
  float lectern(vec2 p) {
    float yT = 604.0, yB = 1120.0;
    float k = clamp((p.y - yT) / (yB - yT), 0.0, 1.0);
    float xl = mix(40.0, -60.0, k), xr = mix(930.0, 1040.0, k);
    return max(max(yT - p.y, xl - p.x), p.x - xr);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 pb = p - uPar * 0.4;   // 背景（視差少一點）
    // 棚的深處：上面暗、地板那一帶一點點亮
    vec3 col = mix(C_INK, C_INK2, 0.35 + 0.4 * smoothstep(300.0, 900.0, pb.y));
    // 左上的柔光箱（出畫的一大片柔光）與右上一盞小燈
    vec2 sq = (pb - vec2(200.0, 150.0)) / vec2(260.0, 180.0);
    col += mix(C_BONE, C_EMBER, 0.25) * 0.16 * exp(-dot(sq, sq) * 1.4) * uIn;
    vec2 s2 = (pb - vec2(1780.0, 170.0)) / vec2(120.0, 90.0);
    col += C_BONE * 0.05 * exp(-dot(s2, s2)) * uIn;
    // 煙：柔光箱的光裡慢慢飄
    float haze = 0.5 + 0.5 * fbm(pb / 420.0 + vec2(uT * 0.02, -uT * 0.01), 3);
    col += mix(C_BONE, C_EMBER, 0.3) * 0.045 * haze * exp(-length((pb - vec2(420.0, 300.0)) / vec2(700.0, 420.0))) * uIn;
    // 每個小節線一道光從左往右掃過背景（煙裡的一道斜光）
    float bx = mix(-300.0, 2200.0, uSweep);
    float beam = exp(-pow((pb.x - bx + (pb.y - 300.0) * 0.6) / 70.0, 2.0)) * (1.0 - smoothstep(560.0, 820.0, pb.y));
    col += mix(C_SIGNAL, C_BONE, 0.5) * 0.05 * beam * haze * step(0.001, uSweep) * (1.0 - uSweep);
    // 遠處的小燈點（監看螢幕、器材的指示燈），失焦
    for (int i = 0; i < 14; i++) {
      float fi = float(i);
      vec2 c = vec2(80.0 + hash11(fi * 3.1) * 1760.0, 470.0 + hash11(fi * 7.7) * 180.0);
      float r = 8.0 + 10.0 * hash11(fi * 1.3);
      float tw = 0.6 + 0.4 * sin(uT * (0.7 + hash11(fi) * 1.5) + fi);
      col += mix(C_BONE, C_SIGNAL, step(0.7, hash11(fi * 9.1))) * 0.05 * tw * smoothstep(r, r - 3.0, length(pb - c)) * uIn;
    }
    // 地板：一條很淡的反光
    col += C_BONE * 0.015 * exp(-abs(pb.y - 760.0) / 30.0);
    // ---- 講台：暖色的木頭，木紋是一條條斜斜往下收的線，前緣一道亮邊
    vec2 pf = p - uPar;
    float d = lectern(pf);
    if (d < 2.0) {
      float k = clamp((pf.y - 604.0) / 516.0, 0.0, 1.0);
      // 木紋沿著檯面左右走（越近越疏），顏色是暖的深咖啡（不跟主題變成紫色的木頭）
      float gy = pf.y / (1.0 + k * 1.2);
      float grain = 0.5 + 0.5 * sin(gy / 5.0 + 4.0 * snoise(vec2(pf.x / 380.0, gy / 60.0)));
      vec3 brown = mix(C_INK2, C_SEPIA, 0.85);
      vec3 wood = mix(brown, mix(brown, C_EMBER, 0.18), 0.35 * grain) * (0.75 + 0.35 * (1.0 - k));
      wood += mix(C_BONE, C_EMBER, 0.3) * 0.05 * exp(-length((pf - vec2(300.0, 640.0)) / vec2(500.0, 260.0)));
      col = mix(col, wood * uIn + C_INK * (1.0 - uIn), 1.0 - smoothstep(-1.0, 1.0, d));
      col += mix(C_BONE, C_EMBER, 0.4) * 0.12 * exp(-abs(pf.y - 604.0) / 2.5) * step(d, 1.0);
    }
    fragColor = vec4(col, 1.0);
  }`, { uT: { value: 0 }, uIn: { value: 1 }, uSweep: { value: 0 }, uPar: { value: new THREE.Vector2() } });

interface Entry { line: Line | null; text: string; y: number; h: number; t0: number }

export default class Teleprompter extends Scene {
  bg = shared('teleprompter.bg', BG);
  /** 不會變的器材：遮光罩、玻璃、鏡頭、攝影機、腳架。init 畫一次。 */
  rig = this.track(new Layer2D(W, H, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 講稿（不會變，只翹紙角、跟著視差）：init 畫一次。 */
  paper = this.track(new Layer2D(PAPER.w + 40, PAPER.h + 40, undefined, { fast: true }));
  glow = this.track(new LineBatch(256, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 223 + (this.msg?.id ?? 0) * 31) >>> 0;
  fit: MsgFit | null = null;
  msgSize: number | null = null;
  entries: Entry[] = [];
  lyr: LyricStyle = { family: F.hei(700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: TW, align: 'left', lineHeight: 1.18, active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3) };
  tPaper = 0;

  override async init() {
    const { audio: au, lyrics, start: s, end: e, song } = this.ctx;
    const m = this.msg;
    const sig = m ? signature(m.name) : '';
    await loadText(`${m?.text ?? ''}${sig}致詞稿第位貴賓這一頁留給你${INVITE}${CUES.join('')}${song.title}REC錄影中FROM THE COUPLE·新人No.0123456789`);
    if (m) {
      this.fit = fitMsgV2(this.paper.ctx, m.text, MSG_FAM, PAPER.w - 90, PAPER.h - 76, { lineHeight: 1.32 });
      this.msgSize = this.fit.fit.size;
    }
    this.lyr = { ...this.lyr, size: lyricV2(this.msgSize) };
    this.tPaper = beatAfter(au, s + 0.05);
    this.drawPaper(m, sig);
    this.drawRig();
    // ---- 提詞機上的每一組：歌詞一句一組；純音樂就是舞台指示，每兩小節一條
    const c = this.layer.ctx;
    const lines = lyrics.linesIn(s - 10, e + 10);
    let y = 0;
    if (lines.length) {
      for (const l of lines) {
        const bl = biLayout(c, l, this.lyr, { sub: { family: F.hei(500), sung: rgba('bone', 0.82), unsung: rgba('bone', 0.28) } });
        const h = bl.span + bl.main.size * 1.25 + 34;
        this.entries.push({ line: l, text: l.text, y, h, t0: l.start });
        y += h;
      }
    } else {
      const b0 = Math.floor(au.barAt(s));
      const n = Math.ceil((au.barAt(e) - b0) / 2) + 3;
      for (let i = 0; i < n; i++) {
        const text = i === 1 && song.title ? `♪  ${song.title}` : CUES[(i + this.seed) % CUES.length]!;
        this.entries.push({ line: null, text, y, h: 96, t0: au.timeOfBar(b0 + 2 * (i - 1)) });
        y += 96;
      }
    }
  }

  /** 器材：遮光罩（黑色的框）、玻璃（透過去看得到鏡頭）、下面斜放的螢幕盒、攝影機、腳架。 */
  private drawRig() {
    const L = this.rig, c = L.ctx;
    L.clear();
    const cx = (GL.x0 + GL.x1) / 2;
    // 腳架（三支腳，右邊那支不伸進右下角 HUD）
    c.strokeStyle = mixRgba('ink2', 'graphite', 0.35); c.lineWidth = 12; c.lineCap = 'round';
    for (const [x, y] of [[cx - 260, 1010], [cx, 1040], [cx + 150, 980]] as const) { c.beginPath(); c.moveTo(cx, 700); c.lineTo(x, y); c.stroke(); }
    c.fillStyle = mixRgba('ink2', 'graphite', 0.3); c.fillRect(cx - 40, 680, 80, 40);
    // 螢幕盒（在玻璃下面，斜斜的）
    c.fillStyle = mixRgba('ink', 'ink2', 0.6);
    c.beginPath(); c.moveTo(GL.x0 + 40, GL.y1 + 8); c.lineTo(GL.x1 - 40, GL.y1 + 8); c.lineTo(GL.x1 - 110, GL.y1 + 96); c.lineTo(GL.x0 + 110, GL.y1 + 96); c.closePath(); c.fill();
    c.strokeStyle = rgba('bone', 0.08); c.lineWidth = 2; c.stroke();
    // 攝影機：在玻璃後面，上緣露出機身與提把
    c.fillStyle = mixRgba('ink2', 'graphite', 0.25);
    c.beginPath(); c.roundRect(cx - 130, GL.y0 - 64, 260, 80, 10); c.fill();
    // 機身上的小螢幕（翻開的）與提把
    c.fillStyle = mixRgba('ink2', 'graphite', 0.4); c.fillRect(cx - 230, GL.y0 - 58, 90, 56);
    c.fillStyle = mixRgba('ink', 'signal', 0.12); c.fillRect(cx - 224, GL.y0 - 52, 78, 44);
    c.strokeStyle = mixRgba('ink2', 'graphite', 0.45); c.lineWidth = 9; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx - 70, GL.y0 - 64); c.lineTo(cx - 70, GL.y0 - 88); c.lineTo(cx + 70, GL.y0 - 88); c.lineTo(cx + 70, GL.y0 - 64); c.stroke();
    // 玻璃：淡淡的、看得到後面：黑色的遮光布罩（中間一塊梯形）、鏡頭的幾圈同心圓
    const g = c.createLinearGradient(0, GL.y0, 0, GL.y1);
    g.addColorStop(0, mixRgba('ink', 'ink2', 0.3, 0.92)); g.addColorStop(1, mixRgba('ink', 'ink2', 0.7, 0.92));
    c.fillStyle = g; c.fillRect(GL.x0, GL.y0, GL.x1 - GL.x0, GL.y1 - GL.y0);
    c.fillStyle = rgba('ink', 0.55);
    c.beginPath(); c.moveTo(cx - 250, GL.y0 + 30); c.lineTo(cx + 250, GL.y0 + 30); c.lineTo(cx + 190, GL.y1 - 20); c.lineTo(cx - 190, GL.y1 - 20); c.closePath(); c.fill();
    // 細的金屬框（不是厚厚的螢幕框）：亮邊在上、暗邊在下
    const fr = c.createLinearGradient(0, GL.y0 - 10, 0, GL.y1 + 10);
    fr.addColorStop(0, rgba('ash', 0.6)); fr.addColorStop(0.5, rgba('graphite', 0.7)); fr.addColorStop(1, mixRgba('graphite', 'ink', 0.6));
    c.strokeStyle = fr; c.lineWidth = 9; c.strokeRect(GL.x0 - 4, GL.y0 - 4, GL.x1 - GL.x0 + 8, GL.y1 - GL.y0 + 8);
    // 上緣的小牌子：錄影中（燈另外畫、會閃）
    c.font = font(F.mono(600), 15); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.6);
    c.fillText('REC', cx + 40, GL.y0 - 22);
    c.letterSpacing = '0px';
  }

  /** 講稿：白紙、表頭「致詞稿」、宋體的留言、署名。沒有留言：「這一頁留給你」＋邀請。 */
  private drawPaper(m: Msg | null, sig: string) {
    const L = this.paper, c = L.ctx, P = 20, w = PAPER.w, h = PAPER.h;
    L.clear();
    c.fillStyle = rgba('ink', 0.45); c.fillRect(P + 10, P + 14, w, h);
    const g = c.createLinearGradient(P, P, P + w, P + h);
    g.addColorStop(0, mixRgba('bone', 'ember', 0.08)); g.addColorStop(1, mixRgba('bone', 'ash', 0.35));
    c.fillStyle = g; c.fillRect(P, P, w, h);
    c.font = font(F.mono(500), 15); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.55);
    c.fillText(m ? (m.couple ? '致詞稿  ·  FROM THE COUPLE · 新人' : `致詞稿  ·  第 ${m.n} 位貴賓`) : '致詞稿', P + 44, P + 40);
    c.letterSpacing = '0px';
    c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1; c.beginPath(); c.moveTo(P + 44, P + 54); c.lineTo(P + w - 44, P + 54); c.stroke();
    const x = P + 44, top = P + 76;
    if (m && this.fit) {
      const mf = this.fit, fit = mf.fit;
      c.font = font(MSG_FAM, fit.size); c.fillStyle = rgba('sepia', 0.96); c.textBaseline = 'alphabetic';
      const y0 = top + fit.size * 0.9;
      fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x, y0 + i * fit.lineHeight));
      c.font = font(F.hand(400), mf.sig); c.fillStyle = rgba('sepia', 0.72);
      const sw = c.measureText(sig).width;
      c.fillText(sig, Math.max(x, x + Math.max(fit.width, sw) - sw), y0 + (fit.lines.length - 1) * fit.lineHeight + mf.sigDy);
    } else {
      c.font = font(MSG_FAM, 46); c.fillStyle = rgba('sepia', 0.9);
      c.fillText('這一頁留給你。', x, top + 60);
      c.font = font(F.hei(500), 24); c.letterSpacing = '1px'; c.fillStyle = rgba('sepia', 0.62);
      c.fillText(INVITE, x, top + 116);
      c.letterSpacing = '0px';
    }
  }

  /** t 時捲到哪裡（捲動座標對到讀稿線）：一組一組連續往上捲，每組在它開始唱的那一刻剛好到讀稿線。 */
  private scroll(t: number) {
    const E = this.entries;
    if (!E.length) return 0;
    if (t <= E[0]!.t0) return E[0]!.y - 160 * (1 - clamp((t - (E[0]!.t0 - 2)) / 2));
    let i = 0;
    while (i < E.length - 1 && E[i + 1]!.t0 <= t) i++;
    if (i === E.length - 1) return E[i]!.y + 30 * (t - E[i]!.t0);
    const u = (t - E[i]!.t0) / Math.max(0.1, E[i + 1]!.t0 - E[i]!.t0);
    // 大部分時間很慢地捲（讀得到），下一句快來時加速把它送上讀稿線
    return lerp(E[i]!.y, E[i + 1]!.y, 0.25 * u + 0.75 * ease.inOutCubic(smoothstep(0.55, 1, u)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const inK = prog(t, s, s + 0.5, ease.outCubic);
    // 鏡頭慢慢推近、往右上移一點：前景（講台、講稿）多移一點，背景少移（視差）
    const dolly = ease.inOutQuad(f.p);
    const par = { x: -18 * dolly, y: 10 * dolly };
    const u = this.bg.u;
    u.uT!.value = t; u.uIn!.value = inK;
    const bf = au.barAt(t), bph = bf - Math.floor(bf);
    u.uSweep!.value = t > s + 0.2 ? clamp(bph / 0.6) : 0;
    (u.uPar!.value as THREE.Vector2).set(par.x, -par.y);
    this.bg.render(renderer, out);
    comp.draw(renderer, this.rig.texture, out, { opacity: inK, offset: [-par.x * 0.4 / W, par.y * 0.4 / H] });

    const L = this.layer; L.clear();
    const c = L.ctx;
    this.glow.clear();
    c.globalAlpha = inK;
    // ---- 提詞機的玻璃：一組一組往上捲；切在玻璃裡，離讀稿線越遠越淡
    c.save();
    c.translate(par.x * 0.4, par.y * 0.4);
    c.beginPath(); c.rect(GL.x0, GL.y0, GL.x1 - GL.x0, GL.y1 - GL.y0); c.clip();
    const sc = this.scroll(t);
    let curIdx = -1;
    this.entries.forEach((en, i) => { if (en.t0 <= t + 0.3) curIdx = i; });
    // 讀稿線：一條很淡的橫帶＋左邊一個訊號色的小三角
    c.fillStyle = rgba('bone', 0.018); c.fillRect(GL.x0, READ_Y - this.lyr.size * 1.05, GL.x1 - GL.x0, this.lyr.size * 1.4);
    c.fillStyle = rgba('signal', 0.9);
    c.beginPath(); c.moveTo(GL.x0 + 26, READ_Y - this.lyr.size * 0.6); c.lineTo(GL.x0 + 48, READ_Y - this.lyr.size * 0.35); c.lineTo(GL.x0 + 26, READ_Y - this.lyr.size * 0.1); c.closePath(); c.fill();
    for (let i = 0; i < this.entries.length; i++) {
      const en = this.entries[i]!;
      const y = READ_Y + en.y - sc;
      if (y < GL.y0 - 200 || y > GL.y1 + 60) continue;
      const a = (1 - smoothstep(GL.y0 + 90, GL.y0 - 60, y) * 1) * (1 - smoothstep(GL.y1 - 110, GL.y1 + 10, y));
      const k = (i === curIdx ? 1 : i < curIdx ? 0.55 : 0.9) * clamp(a);
      if (k <= 0.01) continue;
      if (en.line) {
        const bl: BiLay = biLayout(c, en.line, this.lyr, { sub: { family: F.hei(500), sung: rgba('bone', 0.82), unsung: rgba('bone', 0.28) } });
        // 玻璃的雙影：玻璃後面那一面再反射一次，往右下錯開 3 px、很淡
        const gst = { ...this.lyr, active: rgba('bone', 0.08), sung: rgba('bone', 0.08), unsung: rgba('bone', 0.03) };
        const gbl = biLayout(c, en.line, gst, { sub: { family: F.hei(500), sung: rgba('bone', 0.06), unsung: rgba('bone', 0.02) } });
        c.save(); c.translate(TX + 3, y + 3); drawBi(c, en.line, t, gst, gbl, k); c.restore();
        c.save(); c.translate(TX, y); drawBi(c, en.line, t, this.lyr, bl, k); c.restore();
      } else {
        c.font = font(F.hei(700), 44); c.fillStyle = rgba('bone', (i === curIdx ? 0.9 : 0.45) * clamp(a));
        c.fillText(en.text, TX, y);
      }
    }
    // 玻璃的反光：一道斜斜的亮帶
    const sh = c.createLinearGradient(GL.x0, GL.y0, GL.x0 + 500, GL.y1);
    sh.addColorStop(0, rgba('bone', 0)); sh.addColorStop(0.45, rgba('bone', 0.05)); sh.addColorStop(0.55, rgba('bone', 0.0));
    c.fillStyle = sh; c.fillRect(GL.x0, GL.y0, GL.x1 - GL.x0, GL.y1 - GL.y0);
    c.restore();
    // ---- 講稿：第一個拍點「放」到講台上（從上面落下、停住），小節線上紙角被吹得翹一下
    this.drawPaperProp(c, t, par);
    comp.draw(renderer, L.upload(), out);
    // 錄影中的燈：每一拍閃一下（亮的時候發光）
    const beat = au.beatAt(t), bp = beat - Math.floor(beat);
    const on = bp < 0.5 ? 1 : 0.25;
    const R = LIN.signal, lx = (GL.x0 + GL.x1) / 2 + 20 + par.x * 0.4, ly = GL.y0 - 28 + par.y * 0.4;
    this.glow.seg2(lx, ly, lx + 0.01, ly, 12, [R[0] * 2.5 * on * inK, R[1] * 2.5 * on * inK, R[2] * 2.5 * on * inK], 1);
    this.glow.seg2(lx, ly, lx + 0.01, ly, 34, [R[0] * 0.3 * on * inK, R[1] * 0.3 * on * inK, R[2] * 0.3 * on * inK], 0.5);
    this.glow.render(renderer, out);
    return { bloom: 0.55, vignette: 0.55, halation: 0.15, zoom: 1 + 0.035 * dolly };
  }

  private drawPaperProp(c: CanvasRenderingContext2D, t: number, par: { x: number; y: number }) {
    const au = this.ctx.audio;
    const k = clamp((t - this.tPaper) / 0.5);
    if (t < this.tPaper - 0.3) return;
    const drop = 1 - ease.outCubic(k);
    const bt = au.timeOfBar(Math.floor(au.barAt(t) + 1e-4));
    const lift = bt > this.tPaper + 0.4 ? Math.exp(-(t - bt) / 0.35) * Math.sin(Math.min(Math.PI, (t - bt) * 9)) : 0;
    const L = this.paper;
    c.save();
    c.globalAlpha *= clamp(k * 1.5);
    c.translate(PAPER.x - 20 + par.x, PAPER.y - 20 - 60 * drop + par.y);
    // 放在斜的檯面上：一點點往後倒（上緣稍窄），用斜切的仿射近似
    c.transform(1, 0, -0.04, 1, 0, 0);
    c.rotate(-0.02);
    c.drawImage(L.canvas, 0, 0, L.w, L.h);
    // 紙角被吹起來：右上角一個亮的小三角（翻起來的紙背）
    if (lift > 0.02) {
      const s = 34 * lift;
      c.fillStyle = mixRgba('bone', 'ash', 0.2);
      c.beginPath(); c.moveTo(20 + PAPER.w - s, 20); c.lineTo(20 + PAPER.w, 20 + s); c.lineTo(20 + PAPER.w - s * 0.9, 20 + s * 0.8); c.closePath(); c.fill();
    }
    c.restore();
  }
}
