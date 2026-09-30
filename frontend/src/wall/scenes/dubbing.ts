// 配音室（雙語・批次 B1，暗）：錄音室裡的配音工作台。牆上是吸音棉（一格一格的角錐，左上一盞燈打出明暗），
// 右邊一台大螢幕：上半是要配音的畫面（失焦的夜景光點，每個小節線「剪」到下一個鏡頭）＋燒在畫面上的時間碼，
// 下半是剪輯軟體的兩條聲軌（原文一條、中文一條），波形照真的人聲包絡畫、跟著播放線往左捲。
// 左邊是懸臂上的大振膜麥克風與防噴罩，譜架上夾著配音稿，一盞夾燈照著稿子。桌面前緣一排 LED 電平表照著音樂跳。
//  - 兩行歌詞是畫面下緣的雙語字幕（中文大、原文小一號在正下方，各自照逐字時間亮）。配音的「提示條」：
//    每句前兩拍，一條訊號色的直條從畫面左邊滑到右邊，剛好在開口的那一刻碰到右緣、畫面閃一下；
//    再前面三拍，右上角三顆提示點一拍亮一顆（嗶、嗶、嗶）。唱的時候螢幕上面的「錄音中」燈亮。
//  - 聲軌：中文那一條的片段是這句的中文、原文那一條是原文（有翻譯才有；沒翻譯的歌只剩一條「人聲」，收起來不留空軌）。
//  - 主打留言是譜架上的配音稿：表頭「配音稿 · 第 N 場」、一行舞台指示「（深情地）」、宋體的留言、署名在最後一行下面。
//    沒有留言：稿子寫「這一句等你來配」＋邀請。純音樂：聲軌是一整條「配樂」、字幕的位置寫配樂的歌名。
//  - 標準 v2：留言 40～60 px、稿子的字區 ≤ 460×320（左下）；中文 40～52、原文 32～40（_b1.ts）。右下角 HUD 底下只有暗的桌面。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, hash, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, beatAfter, signature, fillWithHearts, lyricSubOf, type LyricStyle } from './_motifs';
import { V2, lyricV2, msgLen } from './_v2';
import { biLayout, drawBi, fitMsgV2, type BiLay, type MsgFit } from './_b1';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: false, energy: [0.2, 0.85], bars: [4, 8] };

/** 螢幕（外框）、上半的畫面、下半的聲軌（畫面 px）。 */
const SCR = { x0: 690, y0: 72, x1: 1770, y1: 800 };
const PIC = { x0: 706, y0: 88, x1: 1754, y1: 548 };
const TRK = { x0: 706, x1: 1754, head: 118, ruler: 560, y1: 592, y2: 690, h: 88 };
/** 時間軸：一秒幾 px、播放線在哪裡。 */
const PXS = 150, PLAY = TRK.x0 + TRK.head + 300;
/** 字幕：置中在畫面中線，最後一排的基線。 */
const SUB = { cx: (PIC.x0 + PIC.x1) / 2, bottom: 522, maxW: 960 };
/** 配音稿（紙的左上角與寬高）。 */
const PAGE = { x: 132, y: 596, w: 520, h: 400 };
const MSG_FAM = F.ming(700);
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
/** 波形的取樣間隔（秒）：一格 5 px。 */
const WSTEP = 5 / PXS;

const BG = () => new FSPass(/* glsl */ `
  uniform float uT; uniform float uIn; uniform float uShot; uniform float uSubK; uniform float uFlash;
  const vec4 SCR = vec4(${SCR.x0}.0, ${SCR.y0}.0, ${SCR.x1}.0, ${SCR.y1}.0);
  const vec4 PIC = vec4(${PIC.x0}.0, ${PIC.y0}.0, ${PIC.x1}.0, ${PIC.y1}.0);
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // ---- 吸音棉：一格一格的角錐，四個斜面照左上的燈各有明暗；每一格的顏色差一點點
    vec2 g = p / 58.0, id = floor(g), f = fract(g) - 0.5;
    float face = abs(f.x) > abs(f.y) ? (f.x < 0.0 ? 1.0 : 0.45) : (f.y < 0.0 ? 0.85 : 0.3);
    vec3 foam = mix(C_INK2, C_GRAPHITE, 0.16) * (0.45 + 0.6 * face) * (0.9 + 0.2 * hash12(id));
    // 角錐的邊：一條很細的暗線（吸音棉一格一格的感覺）
    foam *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.035, 0.5 - max(abs(f.x), abs(f.y))));
    vec3 col = foam;
    // 夾燈照著左下的稿子：一圈暖光；螢幕的光溢到牆上
    col += mix(C_EMBER, C_BONE, 0.35) * 0.1 * exp(-length((p - vec2(400.0, 720.0)) / vec2(420.0, 330.0)) * 1.3) * uIn;
    vec2 sc = (SCR.xy + SCR.zw) * 0.5, sh = (SCR.zw - SCR.xy) * 0.5;
    float dS = sdBox(p - sc, sh);
    col += mix(C_BONE, C_SIGNAL, 0.3) * 0.035 * exp(-max(dS, 0.0) / 140.0) * uIn;
    // ---- 桌面：螢幕下面，暗的木頭，前緣一道亮邊；螢幕的光映在桌上
    if (p.y > 818.0) {
      float k = (p.y - 818.0) / ${H - 818}.0;
      vec3 desk = mix(C_INK2, C_SEPIA, 0.45) * (0.55 - 0.25 * k);
      desk += mix(C_BONE, C_SIGNAL, 0.3) * 0.03 * exp(-(p.y - 818.0) / 50.0) * smoothstep(SCR.x - 80.0, SCR.x + 40.0, p.x) * (1.0 - smoothstep(SCR.z - 40.0, SCR.z + 80.0, p.x)) * uIn;
      col = mix(col, desk, smoothstep(818.0, 821.0, p.y));
      col += C_BONE * 0.05 * exp(-abs(p.y - 820.0) / 1.5);
    }
    // ---- 螢幕：黑色的外框、裡面是介面的底色
    if (dS < 0.0) {
      col = mix(C_INK, C_INK2, 0.25);
      col += C_BONE * 0.05 * (1.0 - smoothstep(0.0, 2.0, abs(dS + 1.0)));
      // 上半：要配音的畫面——失焦的夜景光點，每個小節線換一個鏡頭（uShot）
      vec2 q = p - PIC.xy, wh = PIC.zw - PIC.xy;
      if (q.x > 0.0 && q.y > 0.0 && q.x < wh.x && q.y < wh.y) {
        vec2 u = q / wh;
        vec3 pic = mix(mix(C_INK2, C_BLOOD, 0.18), mix(C_INK, C_SIGNAL, 0.05), u.y);
        for (int i = 0; i < 16; i++) {
          float fi = float(i);
          vec2 hh = hash22(vec2(fi, uShot));
          vec2 c = vec2(fract(hh.x + uT * (0.004 + 0.01 * hh.y)), 0.15 + 0.6 * hh.y) * wh;
          float r = 22.0 + 46.0 * hash11(fi * 3.7 + uShot);
          float d = length(q - c);
          // 失焦的光點：邊緣軟、外圈稍亮一點（散景）
          float disc = smoothstep(r, r * 0.6, d) * (0.8 + 0.2 * smoothstep(r * 0.6, r * 0.9, d));
          vec3 lc = mix(C_SIGNAL, mix(C_BONE, C_EMBER, 0.5), hash11(fi * 5.1 + uShot));
          pic += lc * disc * (0.04 + 0.07 * hash11(fi * 1.9 + uShot));
        }
        // 下緣字幕那一帶壓暗；四角暗
        pic *= 1.0 - 0.6 * uSubK * smoothstep(0.62, 0.9, u.y);
        vec2 cq = u - 0.5;
        pic *= 1.0 - 0.6 * dot(cq, cq);
        // 開口的那一刻：畫面閃一下（配音的「打點」）
        pic += mix(C_BONE, C_SIGNAL, 0.4) * 0.12 * uFlash;
        col = pic;
      }
    }
    fragColor = vec4(col * (0.3 + 0.7 * uIn), 1.0);
  }`, { uT: { value: 0 }, uIn: { value: 1 }, uShot: { value: 0 }, uSubK: { value: 0 }, uFlash: { value: 0 } });

interface Clip { t0: number; t1: number; label: string }

export default class Dubbing extends Scene {
  bg = shared('dubbing.bg', BG);
  /** 不會變的器材：麥克風、懸臂、防噴罩、譜架、夾燈。init 畫一次。 */
  rig = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 配音稿（不會變）。 */
  page = this.track(new Layer2D(PAGE.w + 40, PAGE.h + 40, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 239 + (this.msg?.id ?? 0) * 37) >>> 0;
  fit: MsgFit | null = null;
  msgSize: number | null = null;
  pageH = 300;
  tPage = 0;
  bi = false;
  /** 人聲包絡（波形用）：從 w0 起每 WSTEP 秒一個值。 */
  wave: Float32Array = new Float32Array(0);
  w0 = 0;
  clipsA: Clip[] = [];
  clipsB: Clip[] = [];
  title = '';
  lyr: LyricStyle = { family: F.hei(700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: SUB.maxW, align: 'center', lineHeight: 1.18, active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3) };

  override async init() {
    const { audio: au, lyrics, start: s, end: e, song } = this.ctx;
    const m = this.msg;
    const sig = m ? signature(m.name) : '';
    const lines = lyrics.linesIn(s - 6, e + 8);
    this.bi = lines.some((l) => !!lyricSubOf(l));
    this.title = song.title ? `♪  配樂：${song.title}` : '';
    await loadText(`${m?.text ?? ''}${sig}配音稿第場（深情地）這一句等你來配${INVITE}錄音中原文中文人聲配樂${this.title}${lines.map((l) => l.text + (l.sub?.text ?? '')).join('')}FROM THE COUPLE·新人0123456789:`);
    if (m) {
      // 超過 40 字的長留言（例如好幾句、夾著愛心）字級封頂 40：稿子窄，44 px 時只能在句子中間斷（「後盾♥ 要／一直…」），
      // 40 px 才放得下「一句一行」
      this.fit = fitMsgV2(this.page.ctx, m.text, MSG_FAM, PAGE.w - 70, PAGE.h - 120, { lineHeight: 1.32, max: msgLen(m.text) > 40 ? 40 : 99 });
      this.msgSize = this.fit.fit.size;
    }
    this.lyr = { ...this.lyr, size: lyricV2(this.msgSize) };
    this.tPage = beatAfter(au, s + 0.05);
    this.drawPage(m, sig);
    this.drawRig();
    // ---- 波形：整個窗格前後的人聲包絡（純音樂用整體的音量）
    this.w0 = s - 6;
    const n = Math.ceil((e + 10 - this.w0) / WSTEP);
    this.wave = new Float32Array(n);
    const ch = lyrics.has ? 'vocal' : 'rms';
    for (let i = 0; i < n; i++) this.wave[i] = au.env(ch, this.w0 + i * WSTEP);
    // ---- 聲軌上的片段：中文（主行）、原文（副行）；純音樂是一整條配樂
    if (lyrics.has) {
      for (const l of lines) {
        this.clipsB.push({ t0: l.start, t1: l.end, label: l.text });
        const sl = lyricSubOf(l);
        if (sl) this.clipsA.push({ t0: sl.start, t1: sl.end, label: sl.text });
      }
    } else this.clipsB.push({ t0: s - 10, t1: e + 10, label: song.title || '配樂' });
  }

  /** 懸臂上的大振膜麥克風（防震架、防噴罩）、譜架與夾燈。 */
  private drawRig() {
    const L = this.rig, c = L.ctx;
    L.clear();
    const metal = (x0: number, x1: number) => {
      const g = c.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, rgba('graphite', 0.9)); g.addColorStop(0.35, rgba('ash', 0.9)); g.addColorStop(1, mixRgba('graphite', 'ink', 0.5, 0.95));
      return g;
    };
    const MX = 470, MY = 300;
    // 懸臂：從左上畫外伸進來，兩節、關節一顆螺絲
    c.strokeStyle = mixRgba('graphite', 'ink', 0.4); c.lineWidth = 14; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-30, 40); c.lineTo(250, 110); c.lineTo(MX, 150); c.stroke();
    c.fillStyle = rgba('graphite'); c.beginPath(); c.arc(250, 110, 12, 0, TAU); c.fill();
    c.strokeStyle = mixRgba('graphite', 'ink', 0.4); c.lineWidth = 8; c.beginPath(); c.moveTo(MX, 150); c.lineTo(MX, 190); c.stroke();
    // 防震架：一圈細環＋幾條橡皮筋
    c.strokeStyle = rgba('graphite'); c.lineWidth = 5;
    c.beginPath(); c.ellipse(MX, MY - 60, 64, 18, 0, 0, TAU); c.stroke();
    c.beginPath(); c.ellipse(MX, MY + 80, 64, 18, 0, 0, TAU); c.stroke();
    c.lineWidth = 2; c.strokeStyle = rgba('ink', 0.8);
    for (const dx of [-60, -20, 20, 60]) { c.beginPath(); c.moveTo(MX + dx, MY - 56); c.lineTo(MX + dx * 0.55, MY - 20); c.stroke(); c.beginPath(); c.moveTo(MX + dx, MY + 76); c.lineTo(MX + dx * 0.55, MY + 40); c.stroke(); }
    c.strokeStyle = rgba('graphite'); c.lineWidth = 6; c.beginPath(); c.moveTo(MX, 190); c.lineTo(MX, MY - 78); c.stroke();
    // 麥克風：直立的圓柱、上半是網罩（橫線）、中間一顆小燈
    c.fillStyle = metal(MX - 38, MX + 38);
    c.beginPath(); c.roundRect(MX - 38, MY - 110, 76, 250, 36); c.fill();
    c.strokeStyle = rgba('ink', 0.5); c.lineWidth = 2.5;
    for (let y = MY - 96; y < MY + 10; y += 8) { c.beginPath(); c.moveTo(MX - 33, y); c.lineTo(MX + 33, y); c.stroke(); }
    c.fillStyle = mixRgba('graphite', 'ink', 0.3); c.fillRect(MX - 38, MY + 14, 76, 10);
    c.fillStyle = rgba('bone', 0.35); c.beginPath(); c.ellipse(MX - 14, MY - 100, 10, 4, 0, 0, TAU); c.fill();
    // 線：從麥克風底下垂下去
    c.strokeStyle = rgba('ink', 0.9); c.lineWidth = 6;
    c.beginPath(); c.moveTo(MX, MY + 138); c.bezierCurveTo(MX + 10, MY + 230, MX + 90, MY + 250, MX + 110, 1100); c.stroke();
    // 防噴罩：麥克風右前方、側面看是一個扁扁的橢圓圈（細網、半透明）＋鵝頸管
    const PX = 590, PY = MY - 30;
    c.strokeStyle = rgba('graphite'); c.lineWidth = 4;
    c.beginPath(); c.moveTo(MX + 20, 170); c.quadraticCurveTo(PX + 30, 170, PX, PY - 96); c.stroke();
    c.fillStyle = rgba('ink', 0.35);
    c.beginPath(); c.ellipse(PX, PY, 26, 96, 0, 0, TAU); c.fill();
    c.strokeStyle = rgba('ash', 0.25); c.lineWidth = 1;
    for (let y = PY - 90; y < PY + 90; y += 7) { const hw = 26 * Math.sqrt(Math.max(0, 1 - ((y - PY) / 96) ** 2)); c.beginPath(); c.moveTo(PX - hw, y); c.lineTo(PX + hw, y); c.stroke(); }
    c.strokeStyle = rgba('graphite'); c.lineWidth = 5;
    c.beginPath(); c.ellipse(PX, PY, 26, 96, 0, 0, TAU); c.stroke();
    // 譜架：稿子後面一塊斜的暗板、下面一根桿子
    c.fillStyle = mixRgba('ink', 'graphite', 0.2);
    c.beginPath(); c.moveTo(PAGE.x - 26, PAGE.y + 10); c.lineTo(PAGE.x + PAGE.w + 26, PAGE.y + 10); c.lineTo(PAGE.x + PAGE.w + 36, PAGE.y + PAGE.h + 26); c.lineTo(PAGE.x - 36, PAGE.y + PAGE.h + 26); c.closePath(); c.fill();
    c.fillStyle = mixRgba('graphite', 'ink', 0.3); c.fillRect(PAGE.x - 36, PAGE.y + PAGE.h + 16, PAGE.w + 72, 16);
    // 夾燈：夾在譜架右上角，一根細臂彎過來，圓錐形的燈罩往下照著稿子
    const lx = PAGE.x + PAGE.w - 150, lyy = PAGE.y - 66;
    c.strokeStyle = rgba('graphite'); c.lineWidth = 5;
    c.beginPath(); c.moveTo(PAGE.x + PAGE.w + 10, PAGE.y + 14); c.quadraticCurveTo(PAGE.x + PAGE.w + 20, lyy - 40, lx + 30, lyy - 26); c.stroke();
    c.save(); c.translate(lx, lyy); c.rotate(-0.35);
    c.fillStyle = mixRgba('graphite', 'ink', 0.25);
    c.beginPath(); c.moveTo(-14, -28); c.lineTo(14, -28); c.lineTo(46, 22); c.lineTo(-46, 22); c.closePath(); c.fill();
    c.fillStyle = rgba('ember', 0.85); c.beginPath(); c.ellipse(0, 22, 44, 7, 0, 0, TAU); c.fill();
    c.restore();
    // 「錄音中」燈箱（螢幕上面）：燈另外畫、會亮
    c.fillStyle = mixRgba('ink', 'ink2', 0.5); c.beginPath(); c.roundRect(1170, 16, 150, 44, 6); c.fill();
    c.strokeStyle = rgba('graphite', 0.8); c.lineWidth = 2; c.stroke();
  }

  /** 配音稿：表頭、一行舞台指示、宋體的留言、署名。 */
  private drawPage(m: Msg | null, sig: string) {
    const L = this.page, c = L.ctx, P = 20, w = PAGE.w;
    L.clear();
    const mf = this.fit;
    const h = Math.min(PAGE.h, 104 + (mf ? mf.height : 130) + 36);
    this.pageH = h;
    c.fillStyle = rgba('ink', 0.5); c.fillRect(P + 8, P + 10, w, h);
    const g = c.createLinearGradient(P, P, P, P + h);
    g.addColorStop(0, mixRgba('bone', 'ember', 0.12)); g.addColorStop(1, mixRgba('bone', 'ash', 0.3));
    c.fillStyle = g; c.fillRect(P, P, w, h);
    // 夾子
    c.fillStyle = rgba('graphite'); c.fillRect(P + w / 2 - 40, P - 8, 80, 22);
    c.font = font(F.mono(500), 15); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.55);
    c.fillText(m ? (m.couple ? '配音稿  ·  FROM THE COUPLE · 新人' : `配音稿  ·  第 ${m.n} 場`) : '配音稿', P + 34, P + 46);
    c.letterSpacing = '0px';
    c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.5);
    c.fillText('（深情地）', P + 34, P + 84);
    const x = P + 34, top = P + 104;
    if (m && mf) {
      const fit = mf.fit;
      c.font = font(MSG_FAM, fit.size); c.fillStyle = rgba('sepia', 0.96); c.textBaseline = 'alphabetic';
      const y0 = top + fit.size * 0.9;
      fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x, y0 + i * fit.lineHeight));
      c.font = font(F.hand(400), mf.sig); c.fillStyle = rgba('sepia', 0.72);
      const sw = c.measureText(sig).width;
      c.fillText(sig, Math.max(x, x + Math.max(fit.width, sw) - sw), y0 + (fit.lines.length - 1) * fit.lineHeight + mf.sigDy);
    } else {
      c.font = font(MSG_FAM, 44); c.fillStyle = rgba('sepia', 0.9);
      c.fillText('這一句，等你來配。', x, top + 50);
      c.font = font(F.hei(500), 21); c.fillStyle = rgba('sepia', 0.62);
      c.fillText(INVITE, x, top + 104);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const inK = prog(t, s, s + 0.5, ease.outCubic);
    const ly = lyricAt(lyrics, t);
    const cur = lyrics.lineAt(t);
    const u = this.bg.u;
    u.uT!.value = t; u.uIn!.value = inK;
    u.uShot!.value = Math.floor(au.barAt(t) + 1e-4) % 97;
    u.uSubK!.value = clamp((ly?.k ?? (this.title ? 0.6 : 0)) * 1.5);
    // 開口那一刻畫面閃一下
    const next = lyrics.lines.find((l) => l.start > t - 0.4 && l.start <= t);
    u.uFlash!.value = next ? Math.exp(-(t - next.start) / 0.1) : 0;
    this.bg.render(renderer, out);
    comp.draw(renderer, this.rig.texture, out, { opacity: inK, offset: [0, -1.5 * f.a.kick / H] });

    const L = this.layer; L.clear();
    const c = L.ctx;
    this.glow.clear();
    c.globalAlpha = inK;
    this.drawPicture(c, t, ly?.line ?? null, ly?.k ?? 0);
    this.drawTracks(c, t, !!cur);
    this.drawMeters(c, f);
    this.drawPageProp(c, t);
    // 「錄音中」：唱的時候亮
    c.font = font(F.hei(700), 22); c.letterSpacing = '4px';
    c.fillStyle = cur ? rgba('bone', 0.95) : rgba('ash', 0.35);
    c.fillText('錄音中', 1216, 46);
    c.letterSpacing = '0px';
    comp.draw(renderer, L.upload(), out);
    const R = LIN.signal, on = cur ? 1 : 0.12;
    this.glow.seg2(1194, 38, 1194.01, 38, 12, [R[0] * 3 * on * inK, R[1] * 3 * on * inK, R[2] * 3 * on * inK], 1);
    if (cur) this.glow.seg2(1194, 38, 1194.01, 38, 40, [R[0] * 0.35 * inK, R[1] * 0.35 * inK, R[2] * 0.35 * inK], 0.6);
    // 播放線（發光）
    this.glow.seg2(PLAY, TRK.ruler - 4, PLAY, TRK.y2 + TRK.h + 4, 2, [R[0] * 1.6 * inK, R[1] * 1.6 * inK, R[2] * 1.6 * inK], 0.9);
    this.glow.render(renderer, out);
    return { bloom: 0.55, vignette: 0.5, halation: 0.12, zoom: 1 + 0.03 * ease.inOutQuad(f.p) };
  }

  /** 畫面：時間碼、提示點、提示條、雙語字幕（或配樂歌名）。 */
  private drawPicture(c: CanvasRenderingContext2D, t: number, line: Line | null, k: number) {
    const au = this.ctx.audio, lyrics = this.ctx.lyrics;
    c.save();
    c.beginPath(); c.rect(PIC.x0, PIC.y0, PIC.x1 - PIC.x0, PIC.y1 - PIC.y0); c.clip();
    // 燒在畫面上的時間碼（每秒 24 格）
    const fr = Math.floor(t * 24), ss = Math.floor(fr / 24);
    const tc = `01:${String(Math.floor(ss / 60) % 60).padStart(2, '0')}:${String(ss % 60).padStart(2, '0')}:${String(fr % 24).padStart(2, '0')}`;
    c.font = font(F.mono(500), 18); c.fillStyle = rgba('bone', 0.55); c.letterSpacing = '2px';
    c.fillText(`TC ${tc}`, PIC.x0 + 22, PIC.y0 + 34);
    c.letterSpacing = '0px';
    // 下一句（或正在唱的這一句）的提示：前三拍三顆點一拍亮一顆，前兩拍提示條從左滑到右
    const nx = lyrics.lines.find((l) => l.start > t - 0.3);
    if (nx) {
      const B = au.beatPeriod(nx.start);
      for (let i = 0; i < 3; i++) {
        const tp = nx.start - (3 - i) * B;
        const lit = t >= tp && t < nx.start + 0.3;
        c.fillStyle = lit ? rgba('signal', 0.95) : rgba('bone', 0.18);
        c.beginPath(); c.arc(PIC.x1 - 100 + i * 30, PIC.y0 + 28, 8, 0, TAU); c.fill();
      }
      const t0 = nx.start - 2 * B;
      if (t >= t0 && t < nx.start) {
        const x = PIC.x0 + (PIC.x1 - PIC.x0) * ((t - t0) / (nx.start - t0));
        const g = c.createLinearGradient(x - 90, 0, x, 0);
        g.addColorStop(0, rgba('signal', 0)); g.addColorStop(1, rgba('signal', 0.55));
        c.fillStyle = g; c.fillRect(x - 90, PIC.y0, 90, PIC.y1 - PIC.y0);
        c.fillStyle = rgba('signal', 0.9); c.fillRect(x - 5, PIC.y0, 5, PIC.y1 - PIC.y0);
      }
    }
    // 字幕
    if (line) {
      const bl: BiLay = biLayout(c, line, this.lyr, { sub: { family: F.hei(500), sung: rgba('bone', 0.84), unsung: rgba('bone', 0.28) } });
      c.save();
      c.translate(SUB.cx, SUB.bottom - bl.span);
      drawBi(c, line, t, this.lyr, bl, k);
      c.restore();
    } else if (!lyrics.has && this.title) {
      c.font = font(F.hei(500), 34); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.6); c.textAlign = 'center';
      c.fillText(this.title, SUB.cx, SUB.bottom);
      c.textAlign = 'left'; c.letterSpacing = '0px';
    }
    c.restore();
  }

  /** 剪輯軟體的聲軌：尺規（拍的刻度）、軌道標頭、片段（名字＋波形）、播放線左邊已錄的比較亮。 */
  private drawTracks(c: CanvasRenderingContext2D, t: number, rec: boolean) {
    const au = this.ctx.audio;
    const X = (tt: number) => PLAY + (tt - t) * PXS;
    const cx0 = TRK.x0 + TRK.head;
    c.save();
    // 尺規
    c.fillStyle = mixRgba('ink', 'ink2', 0.6); c.fillRect(TRK.x0, TRK.ruler, TRK.x1 - TRK.x0, 24);
    c.beginPath(); c.rect(cx0, TRK.ruler, TRK.x1 - cx0, 240); c.clip();
    const b0 = Math.ceil(au.beatAt(t - (PLAY - cx0) / PXS)), b1 = Math.floor(au.beatAt(t + (TRK.x1 - PLAY) / PXS));
    c.font = font(F.mono(500), 13); c.fillStyle = rgba('ash', 0.6);
    for (let b = b0; b <= b1; b++) {
      const x = X(au.timeOfBeat(b));
      const bar = Math.abs(au.barAt(au.timeOfBeat(b)) - Math.round(au.barAt(au.timeOfBeat(b)))) < 0.01;
      c.fillStyle = rgba('ash', bar ? 0.6 : 0.3);
      c.fillRect(x, TRK.ruler + (bar ? 4 : 14), 1.5, bar ? 20 : 10);
      if (bar) c.fillText(String(Math.round(au.barAt(au.timeOfBeat(b))) + 1), x + 5, TRK.ruler + 16);
    }
    c.restore();
    const tracks: { y: number; h: number; clips: Clip[]; name: string; tag: string; col: 'signal' | 'bone' }[] = this.bi
      ? [{ y: TRK.y1, h: TRK.h, clips: this.clipsA, name: '原文', tag: 'A1', col: 'bone' }, { y: TRK.y2, h: TRK.h, clips: this.clipsB, name: '中文', tag: 'A2', col: 'signal' }]
      : [{ y: TRK.y1 + 20, h: TRK.h * 2 - 30, clips: this.clipsB, name: this.ctx.lyrics.has ? '人聲' : '配樂', tag: 'A1', col: 'signal' }];
    for (const tr of tracks) {
      // 標頭：名字、錄音鍵（唱的時候中文軌亮）
      c.fillStyle = mixRgba('ink', 'ink2', 0.8); c.fillRect(TRK.x0, tr.y, TRK.head - 4, tr.h - 4);
      c.font = font(F.hei(700), 20); c.fillStyle = rgba('bone', 0.85); c.fillText(tr.name, TRK.x0 + 14, tr.y + 32);
      c.font = font(F.mono(500), 13); c.fillStyle = rgba('ash', 0.6); c.fillText(tr.tag, TRK.x0 + 14, tr.y + 56);
      const armed = rec && tr.col === 'signal';
      c.fillStyle = armed ? rgba('signal', 0.95) : rgba('ash', 0.25);
      c.beginPath(); c.arc(TRK.x0 + TRK.head - 30, tr.y + 26, 8, 0, TAU); c.fill();
      // 軌道底
      c.fillStyle = mixRgba('ink', 'ink2', 0.45); c.fillRect(cx0, tr.y, TRK.x1 - cx0, tr.h - 4);
      c.save();
      c.beginPath(); c.rect(cx0, tr.y, TRK.x1 - cx0, tr.h - 4); c.clip();
      const mid = tr.y + (tr.h - 4) / 2;
      c.strokeStyle = rgba('ash', 0.15); c.lineWidth = 1; c.beginPath(); c.moveTo(cx0, mid); c.lineTo(TRK.x1, mid); c.stroke();
      for (const cl of tr.clips) {
        const xa = X(cl.t0), xb = X(cl.t1);
        if (xb < cx0 || xa > TRK.x1) continue;
        const past = tr.col === 'signal' ? 'signal' : 'bone';
        c.fillStyle = mixRgba('ink2', past, 0.18); c.fillRect(xa, tr.y + 2, xb - xa, tr.h - 8);
        c.strokeStyle = rgba(past, 0.45); c.lineWidth = 1.5; c.strokeRect(xa, tr.y + 2, xb - xa, tr.h - 8);
        // 波形：一格 5 px，錨在時間上（捲動時不會閃）
        const i0 = Math.max(0, Math.ceil((Math.max(cl.t0, t - (PLAY - cx0) / PXS) - this.w0) / WSTEP));
        const i1 = Math.min(this.wave.length - 1, Math.floor((Math.min(cl.t1, t + (TRK.x1 - PLAY) / PXS) - this.w0) / WSTEP));
        const amp = (tr.h - 30) / 2;
        for (let i = i0; i <= i1; i++) {
          const tt = this.w0 + i * WSTEP, x = X(tt);
          const a = amp * clamp(0.12 + 0.9 * this.wave[i]! * (0.7 + 0.3 * hash(i, tr.y)));
          c.fillStyle = rgba(past, x <= PLAY ? 0.8 : 0.35);
          c.fillRect(x, mid - a, 3, a * 2);
        }
        // 片段名字（貼在片段左上角，超出片段就切掉）
        c.save();
        c.beginPath(); c.rect(xa, tr.y, xb - xa, tr.h); c.clip();
        c.font = font(F.hei(500), 15); c.fillStyle = rgba('bone', 0.7);
        c.fillText(cl.label, Math.max(xa, cx0) + 8, tr.y + 20);
        c.restore();
      }
      c.restore();
    }
  }

  /** 桌上的混音台面板：一排 LED 電平表照音樂的各個頻帶跳（右下角 HUD 那一塊不放）。 */
  private drawMeters(c: CanvasRenderingContext2D, f: Frame) {
    const a = f.a;
    const vals = [a.low, a.bass, a.drums, a.mid, a.vocal, a.other, a.high, a.rms, a.vocal * 0.9 + a.snare * 0.2, a.low * 0.8 + a.kick * 0.4];
    const x0 = 740, y0 = 1000, seg = 9;
    c.fillStyle = mixRgba('ink', 'ink2', 0.7); c.beginPath(); c.roundRect(712, 858, 560, 172, 10); c.fill();
    c.strokeStyle = rgba('graphite', 0.5); c.lineWidth = 1.5; c.stroke();
    vals.forEach((v, i) => {
      const n = Math.round(clamp(v * 1.05) * seg);
      for (let k = 0; k < seg; k++) {
        const on = k < n;
        c.fillStyle = on ? (k >= seg - 1 ? rgba('signal', 0.9) : k >= seg - 3 ? rgba('ember', 0.6) : rgba('bone', 0.32)) : rgba('bone', 0.045);
        c.fillRect(x0 + i * 52, y0 - k * 14, 30, 8);
      }
    });
  }

  /** 配音稿：第一個拍點夾上去（從上面滑下來、停住）。 */
  private drawPageProp(c: CanvasRenderingContext2D, t: number) {
    const k = ease.outCubic(clamp((t - this.tPage) / 0.45));
    if (t < this.tPage - 0.3) return;
    c.save();
    c.globalAlpha *= clamp(k * 1.6);
    c.translate(PAGE.x - 20, PAGE.y - 20 - 50 * (1 - k));
    c.rotate(-0.012);
    c.drawImage(this.page.canvas, 0, 0, this.page.w, this.page.h);
    c.restore();
  }
}
