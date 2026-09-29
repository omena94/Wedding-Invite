// 保底版面：最單純的逐字跟唱＋主打留言（照 pdoom-video 的 starter 版面 karaoke.ts 改的），任何歌都能用。
// 也是寫新版面的範本：一個全螢幕 shader 畫底、一個 Canvas2D 層畫字、一個加亮的 LineBatch 畫火花。
// 2026-09-28 依「MV 融合原則」重做：像暗場舞台上的一段獨白——
//  - 有主打留言時，留言就是焦點：手寫字、靠左，第一個拍點後一個字一個字寫出來、署名；
//    歌詞退到下面一行（比留言小一級），照跟唱規則，仙女棒的火花跟著唱到的字。
//  - 沒有留言：歌詞是焦點。沒有歌詞（純音樂）也沒有留言：一句邀請。
// v2（2026-09-29「留言尺寸與版面比例標準 v2」）：
//  - 留言 40～60 px（依字數，TREATMENT 的表）、署名 26～32、歌詞 40～52（不比留言大），都在畫面左邊；
//    留言區約 800 寬、不到 430 高，不再撐滿半個畫面。
//  - 空出來的右半邊是一個真的舞台（場景是主視覺，一直在動）：暗紅的絨布幕在風裡輕輕擺、
//    一盞追蹤燈從上面打下來照著一支老式麥克風，光柱裡有煙霧與飄著的灰塵；兩盞搖頭燈的光束在幕上慢慢掃，
//    每個小節線亮一下；地板是亮面的，映著燈與麥克風；大鼓一打，麥克風的網罩閃一下。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type Msg } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { ease, hash, prog, pulse, clamp } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, drawMessage, signature, beatAfter, msgChars, type LyricStyle } from './_motifs';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';

/** 麥克風站在哪裡（螢幕 px）：支架底座在地板上的中心、麥克風頭的中心。右下角 HUD（x ≥ 1360、y ≥ 830）在它右下方。 */
const MIC = { x: 1190, floor: 918, head: 420 };
/** 地板從這裡開始（螢幕 y）。 */
const FLOOR_Y = 862;

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float k; uniform float bar; uniform float kick; uniform vec2 beams;
  const vec2 MIC = vec2(${MIC.x}.0, ${MIC.floor}.0);
  const float FLOOR = ${FLOOR_Y}.0;
  // 一道從 o 往 dir 打出去的光束：離光束中線越遠越暗，越遠越寬
  float beam(vec2 p, vec2 o, vec2 dir, float w0, float spread) {
    vec2 d = p - o;
    float along = dot(d, dir);
    if (along < 0.0) return 0.0;
    float across = abs(d.x * dir.y - d.y * dir.x);
    float w = w0 + along * spread;
    return exp(-across * across / (w * w)) * (1.0 - smoothstep(900.0, 1500.0, along));
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下，跟 Canvas2D 一樣
    // ---- 幕：一條條垂直的皺褶（下擺在風裡慢慢擺，越往下擺越多），絨布吃光、暗暗的紅
    float sway = 14.0 * sin(t * 0.45 + p.x * 0.004) * smoothstep(200.0, FLOOR, p.y);
    float fold = 0.5 + 0.5 * sin((p.x + sway) / 58.0 + 1.3 * sin((p.x + sway) / 211.0));
    vec3 velvet = mix(C_INK, mix(C_BLOOD, C_INK2, 0.6), 0.5) * (0.3 + 0.7 * pow(fold, 1.6));
    vec3 col = mix(C_INK, velvet, 0.7);
    // 追蹤燈打在幕上麥克風後面的一圈光（麥克風的影子是一條直直的暗帶）
    vec2 sq = (p - vec2(MIC.x, 560.0)) / vec2(360.0, 430.0);
    float spotWall = exp(-dot(sq, sq) * 1.4) * (1.0 - 0.5 * exp(-pow((p.x - MIC.x - 20.0) / 12.0, 2.0)) * step(${MIC.head - 40}.0, p.y));
    col += velvet * 2.2 * spotWall + C_EMBER * 0.014 * spotWall;
    // ---- 煙霧：慢慢飄的一層（光打到才看得到）
    float haze = 0.55 + 0.45 * fbm(p / 380.0 + vec2(t * 0.03, -t * 0.012), 3);
    // ---- 追蹤燈的光柱：從畫面上方打下來，照在麥克風上、在地上一圈
    float cone = beam(p, vec2(MIC.x - 60.0, -160.0), normalize(vec2(0.06, 1.0)), 40.0, 0.17);
    col += mix(C_BONE, C_EMBER, 0.3) * 0.1 * cone * haze * k * (1.0 + 0.25 * kick);
    // ---- 兩盞搖頭燈：從右上、左上打進來，角度慢慢掃，每個小節線亮一下（左邊那盞只掃上半部，不打到留言上）
    vec2 d1 = normalize(vec2(-sin(beams.x), cos(beams.x)));
    vec2 d2 = normalize(vec2(sin(beams.y), cos(beams.y)));
    float b1 = beam(p, vec2(1820.0, -40.0), d1, 16.0, 0.09);
    float b2 = beam(p, vec2(620.0, -60.0), d2, 14.0, 0.08) * (1.0 - smoothstep(260.0, 520.0, p.y));
    col += mix(C_SIGNAL, C_BONE, 0.3) * (0.035 + 0.05 * bar) * (b1 + 0.7 * b2) * haze * k;
    // ---- 地板：亮面的深色木頭，映著追蹤燈的一圈光、麥克風的倒影（往下拉長的一條）
    if (p.y > FLOOR) {
      float d = p.y - FLOOR;
      float plank = 0.85 + 0.15 * step(0.5, fract((p.x - ${W / 2}.0) / (180.0 + d * 1.6) * 1.0));
      vec3 fl = mix(C_INK, C_INK2, 0.6) * plank;
      vec2 pq = (p - vec2(MIC.x, MIC.y + 8.0)) / vec2(260.0, 46.0);
      float pool = exp(-dot(pq, pq));
      fl += mix(C_BONE, C_EMBER, 0.3) * 0.09 * pool * k;
      fl += mix(C_BONE, C_EMBER, 0.3) * 0.03 * exp(-pow((p.x - MIC.x) / 10.0, 2.0)) * exp(-d / 90.0) * k;
      // 幕的下擺與地板的交界：一條暗的影子
      fl *= 1.0 - 0.5 * exp(-d / 14.0);
      col = mix(col, fl, smoothstep(FLOOR - 1.0, FLOOR + 1.0, p.y));
    }
    // 左邊留言的後面：幕再暗一點（字才清楚；不是框，是很寬的柔邊）
    vec2 mq = (p - vec2(560.0, 540.0)) / vec2(620.0, 360.0);
    col *= 1.0 - 0.35 * exp(-dot(mq, mq) * 1.2);
    fragColor = vec4(col * (0.35 + 0.65 * k), 1.0);
  }`, { t: { value: 0 }, k: { value: 1 }, bar: { value: 0 }, kick: { value: 0 }, beams: { value: new THREE.Vector2() } });

const X0 = 160;
/** 留言的框（左邊）：寬 800，高度照字算（≤ 430）。 */
const BOX = { x: X0, y: 250, w: 800, h: 520 };
/** 有留言時歌詞那一行的基線（最後一行；折兩行時往上長）。 */
const LYRIC_Y = 820;
/** 沒有留言時歌詞的基線（左邊中間偏下，右邊是舞台）。 */
const HERO_Y = 600;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

export default class Karaoke extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 麥克風（不會變）：init 畫一次、上傳一次，每格只貼上去。 */
  mic = this.track(new Layer2D(240, 620, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  bg = shared('karaoke.bg', BG);
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 這個窗格有沒有歌詞：整個窗格用同一種版面（不要唱到一半留言跳位置）。 */
  sung = false;
  fit: FitResult | null = null;
  sigSize = 30;
  /** 留言整塊的上緣（第一行的基線）。 */
  y0 = 0;
  /** 留言開始寫、寫完的時間。 */
  tW0 = 0; tW1 = 0;
  seed = Number(this.ctx.params.seed ?? 1);

  override async init() {
    const { audio: au, lyrics, start, end } = this.ctx;
    this.sung = lyrics.linesIn(start, end).length > 0;
    this.drawMic();
    const c = this.layer.ctx;
    if (!this.msg) { await loadText(INVITE); return; }
    // 字級上限照字數（短句 60、長留言 44），照標點斷行；框的高度扣掉署名，整塊 ≤ 430
    const m = this.msg, fam = F.hand(400);
    const o = { min: V2.msgMin, max: msgMaxFor(m.text), lineHeight: 1.32, maxLines: 5 };
    const boxH = V2.boxH - 70;
    const byW = fitText(c, m.text, fam, BOX.w, boxH, o), byC = fitClauses(c, m.text, fam, BOX.w, boxH, o);
    this.fit = byC && byC.size >= byW.size * 0.9 ? byC : byW;
    this.sigSize = sigV2(this.fit.size);
    // 整塊（留言＋署名）放在歌詞上面那一塊的正中間
    const blockH = this.fit.height + this.sigSize * 1.9;
    const bottom = this.sung ? LYRIC_Y - 110 : 780;
    this.y0 = BOX.y + Math.max(0, (bottom - BOX.y - blockH) / 2) + this.fit.size * 0.92;
    // 第一個拍點開始寫，一個字約 0.07 秒，最多兩秒半寫完（要留夠時間讀）
    this.tW0 = beatAfter(au, start + 0.1);
    this.tW1 = this.tW0 + Math.min(2.5, 0.07 * msgChars(this.fit) + 0.4);
  }

  /** 老式的舞台麥克風（像五〇年代的那種：橢圓的網罩、中間一圈金屬帶）與支架，被上面的追蹤燈照著。 */
  private drawMic() {
    const L = this.mic, c = L.ctx, w = L.w, h = L.h, cx = w / 2;
    L.clear();
    const chrome = (x0: number, x1: number) => {
      const g = c.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, rgba('graphite')); g.addColorStop(0.3, rgba('bone')); g.addColorStop(0.55, rgba('ash'));
      g.addColorStop(1, mixRgba('graphite', 'ink', 0.5));
      return g;
    };
    const headY = MIC.head - (MIC.floor - h + 20), baseY = h - 20;
    // 底座：扁扁的圓盤（上面亮、邊緣暗）
    c.fillStyle = rgba('ink', 0.6);
    c.beginPath(); c.ellipse(cx + 8, baseY + 6, 92, 16, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = chrome(cx - 84, cx + 84);
    c.beginPath(); c.ellipse(cx, baseY, 84, 14, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('bone', 0.35);
    c.beginPath(); c.ellipse(cx - 12, baseY - 5, 50, 5, 0, 0, Math.PI * 2); c.fill();
    // 支架：一根細管，中間一個旋鈕
    c.fillStyle = chrome(cx - 5, cx + 5);
    c.fillRect(cx - 5, headY + 70, 10, baseY - headY - 70);
    c.fillStyle = chrome(cx - 10, cx + 10);
    c.fillRect(cx - 10, headY + 300, 20, 26);
    // 麥克風頭：往前傾一點點的橢圓網罩
    c.save();
    c.translate(cx, headY); c.rotate(-0.08);
    c.fillStyle = chrome(-44, 44);
    c.beginPath(); c.roundRect(-44, -78, 88, 156, 44); c.fill();
    // 網罩的橫條（上半、下半）與中間的金屬帶
    c.strokeStyle = rgba('ink', 0.55); c.lineWidth = 3;
    for (let y = -64; y <= 64; y += 9) {
      if (Math.abs(y) < 14) continue;
      const hw = 40 * Math.sqrt(Math.max(0, 1 - Math.pow(y / 80, 2)));
      c.beginPath(); c.moveTo(-hw + 4, y); c.lineTo(hw - 4, y); c.stroke();
    }
    c.fillStyle = chrome(-46, 46);
    c.fillRect(-46, -10, 92, 20);
    c.fillStyle = rgba('bone', 0.5);
    c.fillRect(-30, -8, 18, 4);
    // 頂上被燈照到的亮邊
    c.fillStyle = rgba('bone', 0.4);
    c.beginPath(); c.ellipse(-8, -70, 22, 6, 0, 0, Math.PI * 2); c.fill();
    // 底下接支架的夾子
    c.fillStyle = chrome(-12, 12);
    c.fillRect(-12, 76, 24, 40);
    c.restore();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.4), exit = prog(t, e - 0.4, e, ease.inCubic);
    // ---- 舞台：追蹤燈亮起來、搖頭燈慢慢掃、小節線亮一下
    const bar = au.timeOfBar(Math.floor(au.barAt(t) + 1e-4));
    this.bg.u.t!.value = t;
    this.bg.u.k!.value = fadeIn * (1 - 0.5 * exit) * prog(t, s, s + 1.0, ease.outCubic);
    this.bg.u.bar!.value = pulse(t, bar, 0.35);
    this.bg.u.kick!.value = f.a.kick;
    (this.bg.u.beams!.value as THREE.Vector2).set(0.42 + 0.22 * Math.sin(t * 0.37 + this.seed), 0.9 + 0.12 * Math.sin(t * 0.29 + 1.7));
    this.bg.render(renderer, out);
    // 麥克風（切進來時跟著燈亮起來）
    const mk = prog(t, s + 0.1, s + 0.8, ease.outCubic);
    const mw = this.mic.w, mh = this.mic.h, mx = MIC.x - mw / 2, my = MIC.floor - mh + 20;
    comp.draw(renderer, this.mic.texture, out, { opacity: mk, scale: [W / mw, H / mh], offset: [0.5 * W / mw - 0.5 - mx / mw, 0.5 + my / mh - 0.5 * H / mh] });

    const L = this.layer; L.clear();
    const c = L.ctx;
    this.glow.clear();
    c.globalAlpha = fadeIn * (1 - exit);
    c.translate(0, -24 * exit);

    let head: { x: number; y: number } | null = null;
    // 沒有留言時歌詞是焦點：唱完的句子多留一會兒（淡淡地等下一句），不要兩句之間突然一片黑
    const ly = lyricAt(lyrics, t, this.msg ? 1.2 : 6);
    if (ly) {
      const hero = !this.msg;
      const size = lyricV2(this.fit ? this.fit.size : null);
      const st: LyricStyle = hero
        ? { family: F.archivo(87.5, 800), size, minSize: V2.lyrMin, maxWidth: 900 }
        : { family: F.archivo(100, 700), size, minSize: V2.lyrMin, maxWidth: 940 };
      const lay = layoutLyric(c, ly.line, st);
      // 新的一行從下面彈上來；折兩行時往上長（最後一行的基線固定）
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      const base = (hero ? HERO_Y : LYRIC_Y) + (1 - inK) * 26 - (lay.height - lay.size);
      c.save();
      c.translate(X0, base);
      const h = drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
      if (h) head = { x: X0 + h.x, y: base + h.y - 24 * exit };
    }
    if (this.msg && this.fit) this.drawMsg(c, t);
    else if (!this.msg) {
      // 沒有留言、這一段又沒有歌詞（整個窗格都沒有，或很長的間奏）：一句邀請慢慢浮出來，歌詞一來就讓位
      const last = lyrics.lastLine(t), next = lyrics.nextLine(t);
      const k = !this.sung ? 1 : ly ? 0 : Math.min(last ? prog(t, last.end + 6, last.end + 7) : 1, next ? 1 - prog(t, next.start - 1.2, next.start - 0.5) : 1);
      if (k > 0) this.drawInvite(c, t, k);
    }
    comp.draw(renderer, L.upload(), out);
    if (head && exit < 0.5) {
      const h = head as { x: number; y: number };
      // 有留言時火花小一點：焦點是留言，火花只是跟唱的筆尖
      sparkParticles(this.glow, t, () => h, { rate: this.msg ? 40 : 60, life: 0.3, speed: this.msg ? 140 : 180 });
      sparkHead(this.glow, h.x, h.y, t, this.msg ? 0.6 : 0.8);
    }
    this.drawDust(t, mk);
    // 大鼓一打：麥克風網罩上一顆小小的亮點閃一下
    const kk = f.a.kick * mk;
    if (kk > 0.05) {
      const gx = MIC.x - 14, gy = MIC.head - 64, S = LIN.bone;
      for (const [dx, dy, len] of [[1, 0, 16], [0, 1, 10]] as const) this.glow.seg2(gx - dx * len * kk, gy - dy * len * kk, gx + dx * len * kk, gy + dy * len * kk, 1.4, [S[0] * 2 * kk, S[1] * 2 * kk, S[2] * 2 * kk], kk);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭整個窗格很慢地推近；大鼓只輕輕推一下
    return { bloom: 0.6, vignette: 0.5, zoom: (1 + 0.03 * ease.inOutQuad(f.p)) * (1 + 0.005 * f.a.kick) };
  }

  /** 追蹤燈光柱裡的灰塵：很小、很慢地飄，轉到光裡亮一下（只在光柱裡看得到）。 */
  private drawDust(t: number, k: number) {
    const B = LIN.bone;
    for (let i = 0; i < 46; i++) {
      const u = (hash(this.seed, i, 1) + t * (0.01 + 0.018 * hash(this.seed, i, 2))) % 1;
      const y = 60 + u * (FLOOR_Y - 120);
      // 光柱從上往下變寬：灰塵在光柱的寬度裡左右飄
      const halfW = 40 + y * 0.17;
      const x = MIC.x - 60 + 0.06 * y + (hash(this.seed, i, 3) - 0.5) * 2 * halfW + 16 * Math.sin(t * 0.5 + i);
      const a = k * (0.15 + 0.35 * hash(this.seed, i, 4)) * (0.5 + 0.5 * Math.sin(t * (1 + hash(this.seed, i, 5)) + i * 2)) * Math.sin(Math.PI * u);
      if (a < 0.02) continue;
      this.glow.seg2(x, y, x + 0.6, y + 0.6, 1.6, [B[0] * a, B[1] * a, B[2] * a], 1);
    }
  }

  /** 主打留言：第一個拍點後一個字一個字浮出來（最新的字還淡淡的），寫完再署名。 */
  private drawMsg(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg!, fit = this.fit!, x = BOX.x, y0 = this.y0;
    const total = msgChars(fit);
    const chars = total * prog(t, this.tW0, this.tW1);
    // 已經寫好的字：全亮；正在出現的那個字：淡淡浮上來（整數個字用 drawMessage 畫，最後一個字另外畫一層淡的）
    const whole = Math.floor(chars);
    drawMessage(c, fit, F.hand(400), x, y0, { chars: whole, color: rgba('bone', 0.96) });
    const frac = chars - whole;
    if (frac > 0 && whole < total) {
      // 下一個字在第幾行、哪個位置：只在它的範圍裡（clip）多畫一個字，淡淡地從下面浮上來
      let left = whole, li = 0;
      while (li < fit.lines.length - 1 && left >= Array.from(fit.lines[li]!).length) { left -= Array.from(fit.lines[li]!).length; li++; }
      const ln = Array.from(fit.lines[li]!);
      c.save();
      c.font = font(F.hand(400), fit.size);
      const x0 = x + c.measureText(ln.slice(0, left).join('')).width;
      const x1 = x + c.measureText(ln.slice(0, left + 1).join('')).width;
      const y = y0 + li * fit.lineHeight;
      c.beginPath(); c.rect(x0 - 1, y - fit.size * 1.1, x1 - x0 + 2, fit.size * 1.5); c.clip();
      c.globalAlpha *= frac;
      c.translate(0, (1 - frac) * 10);
      drawMessage(c, fit, F.hand(400), x, y0, { chars: whole + 1, color: rgba('bone', 0.96) });
      c.restore();
    }
    // 新人的留言：留言上面一個很小的標籤（全畫面唯一的小字）
    if (m.couple) {
      c.save();
      c.globalAlpha *= prog(t, this.tW0 - 0.2, this.tW0 + 0.3);
      c.font = font(F.mono(500), 17);
      c.letterSpacing = '5px';
      c.fillStyle = rgba('signal', 0.85);
      c.fillText('FROM THE COUPLE  ·  新人', x, y0 - fit.size - 26);
      c.letterSpacing = '0px';
      c.restore();
    }
    // 署名：寫完之後淡入，靠右對齊在留言的右緣下面（像信的落款）
    const ks = prog(t, this.tW1 + 0.1, this.tW1 + 0.6, ease.outCubic);
    if (ks > 0) {
      c.save();
      c.globalAlpha *= ks;
      c.font = font(F.hand(400), this.sigSize);
      c.fillStyle = rgba('ash', 0.95);
      const sig = signature(m.name);
      const sw = c.measureText(sig).width;
      const sx = Math.max(x, x + Math.max(fit.width, sw) - sw);
      c.fillText(sig, sx, y0 + fit.height - fit.size + clamp(fit.size * 0.4, 16, 24) + this.sigSize * 1.25 + (1 - ks) * 8);
      c.restore();
    }
  }

  /** 沒有留言也沒有歌詞（純音樂、長間奏的保底）：一句邀請。 */
  private drawInvite(c: CanvasRenderingContext2D, t: number, k = 1) {
    const s = this.ctx.start;
    c.save();
    c.globalAlpha *= prog(t, s + 0.3, s + 1.2, ease.outCubic) * k;
    c.font = font(F.hand(400), V2.lyrMax);
    c.fillStyle = rgba('bone', 0.92);
    c.fillText(INVITE, X0, HERO_Y);
    c.restore();
  }
}
