// 聊天室（暗）：一支手機立在桌上（斜靠著），鏡頭在它前面、跟螢幕差不多高，背景是糊掉的暖色房間。
// 螢幕上是一個群組聊天（不像任何 App），只留三樣東西：
//  - 主打留言：一個大大的對話泡泡（手寫字，整個畫面最大最亮），上面一行淡淡的名字。第一拍先出現「打字中」的三個點
//    （跟著八分音符跳），下一拍泡泡彈出來，之後一直停在那裡讀。
//  - 歌詞：「今晚的歌」在下面的輸入框裡打字——唱到哪打到哪（還沒唱的三成、正在唱訊號色、唱完紙白），換下一句時
//    整句往上飄走、淡掉，新的一句再打進來。純音樂時輸入框是「錄音中」的波形（真的音量）。
//  - 上面一兩則很淡的舊訊息（前幾則留言，或狗狗加入群組），只是讓它像一個真的對話。
// 鏡頭：窗格一開始焦點在後面的房間，0.3 秒內「拉焦」到手機上；之後慢慢推近，每個小節線緩一下。
// v2（留言尺寸標準）：鏡頭拉遠，手機在畫面左半邊，桌上多一根蠟燭（火焰一直晃、每個小節線被風吹歪一下，光在桌上跟著閃）；
// 每一個新泡泡彈出來（主打、每一句歌詞），手機螢幕灑在桌上的光就亮一下——「有新訊息」。螢幕上的字級照 v2（畫面上的 px）：量螢幕投影到畫面上的寬度，換算成畫布上的字級。
// 畫法：手機、桌子、背後的牆是 three.js（_t5 的舞台：超取樣＋景深）；螢幕內容是一張直式 Canvas2D（fast），每格重畫。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, fillWithHearts, COUPLE_ZH, lyricSubOf, subSizeFor, subGap, type LyricStyle, type LyricLayout } from './_motifs';
import { grid, windowLines, rrect, pad, pop, renderStage, bodyMaterial, screenMaterial, tableMaterial, backdropMaterial, slab, setV3, mixV, projScale, fitMsgV2, flame, type Grid } from './_t5';
import { V2, lyricV2, sigV2 } from './_v2';
import { LineBatch } from '../engine/lines';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: false, energy: [0.15, 0.85], bars: [4, 8] };

// ---------------------------------------------------------------- 手機（公分）與螢幕畫布（像素）
const PHONE = { w: 7.4, h: 15.9, d: 0.8, r: 1.1 };
const CW = 1080, CH = 2340;
const SCR = { w: 6.9, h: 6.9 * (CH / CW) };
const LEAN = 0.2, TURN = 0.12; // 往後靠、稍微轉向右前方（鏡頭那邊）
const PX = 36; // 泡泡左右留白（螢幕很窄：泡泡幾乎貼邊，短句才放得下一行）
const IN_Y = 1930, IN_H = 330; // 輸入框（歌詞）
const HERO_BOT = IN_Y - 80; // 主打泡泡的下緣
const LYRIC_BASE: LyricStyle = { family: F.archivo(100, 700), size: 98, minSize: 88, maxWidth: CW - 2 * PX - 110, align: 'left', lineHeight: 1.08 };
const CANDLE = { x: 13, z: -16, r: 1.6, h: 9 };

function makeRig() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 1, 1200);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), tableMaterial());
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(900, 400), backdropMaterial());
  wall.position.set(0, 150, -140);
  const phone = new THREE.Group();
  const body = new THREE.Mesh(slab(PHONE.w, PHONE.h, PHONE.d, PHONE.r, 0.16), bodyMaterial());
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCR.w, SCR.h), screenMaterial());
  screen.position.z = 0.012;
  phone.add(body, screen);
  // 立著、往後靠一點、轉一點；底邊貼在桌上
  phone.rotation.set(-LEAN, TURN, 0, 'YXZ');
  phone.position.set(2.5, (PHONE.h / 2) * Math.cos(LEAN), -(PHONE.h / 2) * Math.sin(LEAN) * 0.9);
  // 蠟燭：蠟身＋燭芯（火焰是 LineBatch，畫在場景之後、景深之前）
  const waxMat = bodyMaterial();
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(CANDLE.r, CANDLE.r * 1.05, CANDLE.h, 32), waxMat);
  wax.position.set(CANDLE.x, CANDLE.h / 2, CANDLE.z);
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), bodyMaterial());
  wick.position.set(CANDLE.x, CANDLE.h + 0.3, CANDLE.z);
  scene.add(table, wall, phone, wax, wick);
  const fire = new LineBatch(256, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  return { scene, cam, table, wall, body, screen, phone, waxMat, wick, fire };
}

interface Old { text: string; name: string }

/** 署名：「—— 名字」；新人自己寫的標「（新人）」。 */
const sigText = (m: Msg) => `—— ${m.name || (m.couple ? COUPLE_ZH : '一位賓客')}${m.couple ? '（新人）' : ''}`;

export default class Chat extends Scene {
  rig = shared('chat.rig', makeRig);
  ui = this.track(new Layer2D(CW, CH, 0.8, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  fit: FitResult | null = null;
  heroW = 0;
  heroH = 0;
  tHero = 0;
  olds: Old[] = [];
  lines: Line[] = [];
  voice: number[] = [];
  /** 畫面 px／畫布 px（init 時用窗格中段的鏡位量）與換算過的字級。 */
  sc = 0.4;
  lyr: LyricStyle = LYRIC_BASE;
  lyrBig: LyricStyle = LYRIC_BASE;
  nameSize = 46;
  oldSize = 58;
  /** 輸入框與主打泡泡下緣（畫布 px）：有原文副行（韓文歌）的窗格輸入框往上長高，放得下中文＋原文。 */
  inY = IN_Y; inH = IN_H; heroBot = HERO_BOT;

  override async init() {
    const { audio: au, lyrics, song, params } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const c = this.ui.ctx;
    const m = this.msg;
    this.lines = windowLines(lyrics, s, e);
    const others = ((params.messages ?? []) as Msg[]).filter((x) => x.id !== m?.id && Array.from(x.text).length <= 14);
    this.olds = others.length >= 2 ? others.slice(0, 2).map((x) => ({ text: x.text, name: x.name || '一位賓客' })) : [{ text: '芃芃、QQ 加入了群組', name: '' }];
    await loadText(`今晚的賓客群組正在輸入錄音中掃描右下角加入聊天你的話會出現在這裡一位賓客芃芃加入了群組${COUPLE_ZH}${song.title}${m ? m.text + m.name : ''}${this.olds.map((o) => o.text + o.name).join('')}${this.lines.map((l) => l.text).join('')}`);
    this.tHero = g.b0 + g.beat;
    // v2 字級：量窗格中段的鏡位下，螢幕上 1 畫布 px 是畫面上幾 px
    this.pose((s + e) / 2);
    const k = this.sc = projScale(this.rig.cam, this.rig.screen, new THREE.Vector3(-SCR.w / 2, 0, 0), new THREE.Vector3(SCR.w / 2, 0, 0), CW);
    if (m) {
      // 短句一行放完（不要「新婚快／樂！！！」），長留言照子句斷；字級照 v2 換算
      // 高度預算：泡泡（含署名、邊距）在畫面上不超過 430（v2 的留言區上限）
      this.fit = fitMsgV2(c, m.text, F.hand(400), CW - 2 * PX - 84, (430 - 40 - 50) / k, k, 1.12, 9);
      this.heroW = this.fit.width + 84;
      this.heroH = this.fit.height + this.fit.size * 0.3 + 60;
      // 署名放在泡泡裡、最後一行下面（v2：署名永遠在留言最後一行下面）；先算好字級，泡泡跟著長高、夠寬
      const sz = sigV2(this.fit.size * k) / k;
      c.font = font(F.hand(400), sz);
      this.heroW = Math.max(this.heroW, c.measureText(sigText(m)).width + 110);
      this.heroH += sz * 1.5;
    }
    const ms = this.fit ? this.fit.size * k : null;
    this.lyr = { ...LYRIC_BASE, size: lyricV2(ms) / k, minSize: V2.lyrMin / k };
    this.lyrBig = { ...LYRIC_BASE, size: lyricV2(null) / k, minSize: V2.lyrMin / k };
    this.nameSize = sigV2(ms ?? 44) / k;
    this.oldSize = 30 / k;
    // 原文副行：量這個窗格每一句（大字或小字那一套）中文＋原文要多高，輸入框不夠就往上長（下緣不動）
    let need = 0;
    for (const l of this.lines) {
      if (!lyricSubOf(l)) continue;
      for (const st of [this.lyr, this.lyrBig]) {
        const d = this.subLay(c, l, st);
        if (d) need = Math.max(need, d.blockH + 120);
      }
    }
    if (need > IN_H) { this.inH = Math.ceil(need); this.inY = IN_Y + IN_H - this.inH; this.heroBot = this.inY - 80; }
    if (!this.lines.length) {
      const N = 40;
      for (let k = 0; k < N; k++) this.voice.push(au.env('rms', s + (k / (N - 1)) * (e - s)));
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, g = this.g;
    const R = this.rig;
    this.drawUi(t);

    // ---- 材質
    const tb = R.table.material as THREE.ShaderMaterial, wl = R.wall.material as THREE.ShaderMaterial;
    const bd = R.body.material as THREE.ShaderMaterial, sc = R.screen.material as THREE.ShaderMaterial;
    setV3(tb.uniforms.base!, mixV(LIN.ink2, LIN.blood, 0.12), 1.1);
    setV3(tb.uniforms.base2!, mixV(LIN.ink, LIN.ink2, 0.6));
    tb.uniforms.grainK!.value = 0.5;
    // 新訊息：主打泡泡、每一句歌詞的泡泡彈出來的那一刻，螢幕灑在桌上的光亮一下
    let ping = 0;
    const pings = [this.tHero, ...this.lines.map((l) => l.start - 0.35)];
    for (const x of pings) if (t >= x) ping = Math.max(ping, Math.exp(-(t - x) * 4));
    setV3(tb.uniforms.glowCol!, mixV(LIN.bone, LIN.signal, 0.3), 0.05 + 0.09 * ping);
    (tb.uniforms.glowPos!.value as THREE.Vector3).set(1.5, 0, 6);
    tb.uniforms.glowR!.value = 10 + 3 * ping;
    (tb.uniforms.shadow!.value as THREE.Vector4).set(2.5, -1.2, PHONE.w / 2, 0.8);
    tb.uniforms.shadowRot!.value = TURN;
    tb.uniforms.shadowK!.value = 0.6;
    setV3(tb.uniforms.fade!, mixV(LIN.ink, LIN.ink2, 0.5));
    tb.uniforms.fadeZ!.value = 40;
    setV3(tb.uniforms.lampCol!, mixV(LIN.ink2, LIN.signal, 0.3), 0.3);
    (tb.uniforms.lampPos!.value as THREE.Vector3).set(-40, 0, -50);
    tb.uniforms.lampR!.value = 45;
    // 背後的牆：很暗，一團暖暖的燈光（會被景深糊成一片）
    setV3(wl.uniforms.top!, LIN.ink, 0.8);
    setV3(wl.uniforms.bottom!, mixV(LIN.ink, LIN.ink2, 0.8));
    setV3(wl.uniforms.lightCol!, mixV(LIN.ink2, LIN.signal, 0.3), 0.32);
    (wl.uniforms.lightPos!.value as THREE.Vector2).set(-70, 40);
    wl.uniforms.lightR!.value = 55;
    wl.uniforms.y0!.value = 0; wl.uniforms.y1!.value = 150;
    setV3(bd.uniforms.base!, mixV(LIN.ink, LIN.ink2, 0.6));
    setV3(bd.uniforms.keyCol!, mixV(LIN.bone, LIN.signal, 0.35), 0.6);
    (bd.uniforms.keyDir!.value as THREE.Vector3).set(-0.8, 0.5, 0.4);
    setV3(bd.uniforms.fill!, LIN.ink2, 0.8);
    bd.uniforms.shine!.value = 0.6; bd.uniforms.rough!.value = 50;
    sc.uniforms.ui!.value = this.ui.upload();
    sc.uniforms.on!.value = prog(t, s, s + 0.2);
    setV3(sc.uniforms.sheen!, LIN.bone, 0.035);
    (sc.uniforms.refl!.value as THREE.Vector3).set(-0.7, 0.45, 0.55);

    // ---- 蠟燭：燭火一直晃，每個小節線被風吹歪一下；桌上的燭光跟著閃
    let gust = 0;
    for (const b of g.bars) if (t >= b) gust = Math.max(gust, Math.exp(-(t - b) * 5) * Math.sin(Math.min(Math.PI, (t - b) * 9)));
    const flick = 0.5 + 0.3 * Math.sin(t * 17.3) * Math.sin(t * 7.1) + 0.2 * this.ctx.audio.hit('kick', t, 0.12);
    const wm = R.waxMat;
    setV3(wm.uniforms.base!, mixV(LIN.bone, LIN.signal, 0.15), 0.5);
    setV3(wm.uniforms.keyCol!, mixV(LIN.signal, LIN.ember, 0.5), 0.45);
    (wm.uniforms.keyDir!.value as THREE.Vector3).set(0, 1, 0.3);
    setV3(wm.uniforms.fill!, LIN.ink2, 1.1);
    setV3(tb.uniforms.lampCol!, mixV(LIN.ink2, LIN.signal, 0.55), 0.35 + 0.12 * flick);
    (tb.uniforms.lampPos!.value as THREE.Vector3).set(CANDLE.x, 0, CANDLE.z);
    tb.uniforms.lampR!.value = 16;

    // ---- 鏡頭（見 pose）；拉焦：一開始對在後面的牆，0.3 秒內拉到手機（快，才不會讓正在唱的歌詞糊太久）
    const dist = this.pose(t);
    const rack = prog(t, s, s + 0.3, ease.inOutCubic);
    const focus = dist + (1 - rack) * 120;
    const core = mixV(LIN.ember, [1, 1, 1], 0.4), glow = LIN.signal;
    renderStage(renderer, R.scene, R.cam, out, LIN.ink, { focus, range: 5, maxR: 18, falloff: 0.5 }, (rt) => {
      R.fire.clear();
      flame(R.fire, t, CANDLE.x, CANDLE.h + 0.45, CANDLE.z, 2.4, core, glow, flick * 0.6 + gust * 2.2);
      R.fire.render(renderer, rt, R.cam);
    });
    return { bloom: 0.6, vignette: 0.45, grain: 0.05 };
  }

  /**
   * 鏡頭：跟螢幕差不多高、在手機右前方，拉遠一點讓手機在畫面左半邊、蠟燭在右邊；慢慢推近，每個小節線緩一下，
   * 主打出現時多推一點。回傳鏡頭到手機的距離（對焦用）。
   */
  private pose(t: number): number {
    const R = this.rig, g = this.g;
    let step = 0;
    for (const b of g.bars) step += prog(t, b - 0.1, b + 0.7, ease.inOutCubic);
    const push = Math.min(step, 6) * 0.35 + 0.8 * prog(t, this.tHero, this.tHero + 1, ease.outCubic);
    const dist = 37.5 - push;
    const look = new THREE.Vector3(9.5, 7.2, -1.5);
    const az = 0.3 + 0.012 * Math.min(step, 6);
    R.cam.position.set(look.x + Math.sin(az) * dist, look.y + 2.5, look.z + Math.cos(az) * dist);
    R.cam.lookAt(look);
    R.cam.updateMatrixWorld();
    return R.cam.position.distanceTo(R.phone.position);
  }

  // ---------------------------------------------------------------- 螢幕內容
  private drawUi(t: number) {
    const c = this.ui.ctx;
    const { lyrics, song } = this.ctx;
    const g = this.g, m = this.msg;
    c.fillStyle = mixRgba('ink', 'ink2', 0.8); c.fillRect(0, 0, CW, CH);
    c.textBaseline = 'alphabetic';
    // 標題（小、淡）
    c.font = font(F.hei(700), 44); c.fillStyle = rgba('bone', 0.5); c.textAlign = 'center';
    c.fillText('今晚的賓客群組', CW / 2, 250);
    c.textAlign = 'left';
    c.fillStyle = rgba('bone', 0.08); c.fillRect(0, 310, CW, 2);

    // 主打泡泡（或打字中的三個點）；它的上緣決定舊訊息放哪裡
    let top = this.heroBot;
    if (m && this.fit) {
      const fit = this.fit;
      const k = pop(t, this.tHero, 0.36, 1.6);
      const y = this.heroBot - this.heroH;
      top = y - 40;
      if (t >= g.b0 && t < this.tHero) this.dots(c, PX, this.heroBot - 150, t, g.b0);
      if (k > 0) {
        c.save();
        c.translate(PX, this.heroBot); c.scale(k, k); c.translate(-PX, -this.heroBot);
        c.globalAlpha = clamp(k * 2);
        c.fillStyle = mixRgba('ink2', 'graphite', 0.55); rrect(c, PX, y, this.heroW, this.heroH, 56); c.fill();
        c.beginPath(); c.moveTo(PX + 4, this.heroBot - 50); c.quadraticCurveTo(PX - 8, this.heroBot, PX - 26, this.heroBot + 4); c.quadraticCurveTo(PX + 26, this.heroBot + 4, PX + 56, this.heroBot - 4); c.fill();
        c.font = font(F.hand(400), fit.size); c.fillStyle = rgba('bone', 0.97);
        fit.lines.forEach((ln, i) => fillWithHearts(c, ln, PX + 42, y + 30 + fit.size * 0.92 + i * fit.lineHeight));
        // 署名：泡泡裡、最後一行下面、靠右（v2 的署名字級）
        c.font = font(F.hand(400), this.nameSize); c.fillStyle = rgba('bone', 0.6); c.textAlign = 'right';
        c.fillText(sigText(m), PX + this.heroW - 40, y + 30 + fit.height + fit.size * 0.3 + this.nameSize * 1.1);
        c.textAlign = 'left';
        c.restore();
      } else top = this.heroBot - 220;
    } else {
      // 沒有留言：中間一行很淡的邀請
      c.font = font(F.hei(500), 46); c.fillStyle = rgba('bone', 0.4); c.textAlign = 'center';
      c.fillText('掃描右下角 QR code 加入聊天', CW / 2, this.heroBot - 360);
      c.fillText('你的話會出現在這裡', CW / 2, this.heroBot - 290);
      c.textAlign = 'left';
      top = this.heroBot - 440;
    }
    // 上面的舊訊息（很淡、小）
    c.save();
    c.globalAlpha = 0.3;
    let y = top;
    // 舊訊息只放得下的：整個泡泡（含名字）要在標題下的分隔線（y 310）以下
    for (let i = this.olds.length - 1; i >= 0 && y - this.oldSize * 3.2 > 330; i--) {
      const o = this.olds[i]!;
      c.font = font(F.hand(400), this.oldSize);
      // 舊訊息只是背景：太長就截短加「…」，不要超出泡泡
      const maxW = CW - 2 * PX - 200;
      let txt = o.text;
      if (c.measureText(txt).width > maxW) { const ch = Array.from(txt); while (ch.length > 1 && c.measureText(ch.join('') + '…').width > maxW) ch.pop(); txt = ch.join('') + '…'; }
      const w = c.measureText(txt).width + 80;
      if (o.name) {
        const bh = this.oldSize * 1.7;
        c.fillStyle = mixRgba('ink2', 'graphite', 0.5); rrect(c, PX, y - bh, w, bh, 44); c.fill();
        c.fillStyle = rgba('bone', 0.95); fillWithHearts(c, txt, PX + 40, y - bh * 0.32);
        c.font = font(F.hei(500), this.oldSize * 0.7); c.fillStyle = rgba('bone', 0.7); c.fillText(o.name, PX + 10, y - bh - 14);
        y -= bh + this.oldSize * 1.4;
      } else {
        c.font = font(F.hei(500), 38); c.fillStyle = rgba('bone', 0.8); c.textAlign = 'center';
        c.fillText(o.text, CW / 2, y - 30); c.textAlign = 'left';
        y -= 120;
      }
    }
    c.restore();

    // 輸入框：今晚的歌正在輸入（歌詞）
    c.fillStyle = mixRgba('ink', 'ink2', 0.3); c.fillRect(0, this.inY - 90, CW, CH - this.inY + 90);
    c.font = font(F.hei(500), 40); c.fillStyle = rgba('bone', 0.4);
    c.fillText(this.lines.length ? `♪ ${song.title || '今晚的歌'} 正在輸入…` : `♪ ${song.title || '今晚的歌'} 錄音中`, PX + 10, this.inY - 30);
    c.fillStyle = rgba('bone', 0.07); rrect(c, PX - 10, this.inY, CW - 2 * PX + 20, this.inH, 60); c.fill();
    if (this.lines.length) this.typed(c, t, !m);
    else this.recording(c, t);
    void lyrics; void pad; void hash;
  }

  /**
   * 原文副行的排版（畫布 px）：drawLyric 自動畫的原文字級是照畫布 px 算的，手機螢幕在畫面上縮得很小，會小到看不清楚，
   * 所以照「畫面上」的主行字級算原文字級（subSizeFor(主行 × sc) ÷ sc），自己排、自己畫。blockH = 中文字頂到原文字底。
   */
  private subLay(c: CanvasRenderingContext2D, l: Line, st: LyricStyle) {
    const sub = lyricSubOf(l);
    if (!sub) return null;
    const k = this.sc, lay = layoutLyric(c, l, st);
    const ss = subSizeFor(lay.size * k) / k;
    const sl = layoutLyric(c, sub, { ...st, size: ss, minSize: Math.min(ss, 26 / k), tracking: (st.tracking ?? 0) * 0.5 });
    const dy = lay.rows[lay.rows.length - 1]!.y + subGap(lay.size * k, sl.size * k) / k;
    const blockH = lay.size * 0.8 + dy + sl.rows[sl.rows.length - 1]!.y + sl.size * 0.22;
    return { lay, sub, sl, dy, blockH };
  }

  /** 輸入框裡的歌詞：唱到哪打到哪；換句時舊的往上飄走淡掉。 */
  private typed(c: CanvasRenderingContext2D, t: number, big: boolean) {
    const st = big ? this.lyrBig : this.lyr;
    const colors = { active: rgba('signal'), sung: rgba('bone', 0.95), unsung: rgba('bone', 0.3) };
    // 最近一句開始打（提早 0.35 秒）的那一句是目前的；前一句在換句後 0.3 秒內飄走
    let cur = -1;
    this.lines.forEach((l, i) => { if (l.start - 0.35 <= t) cur = i; });
    const draw = (l: Line, dy: number, a: number) => {
      const d = this.subLay(c, l, st);
      if (d) {
        // 有原文：中文＋原文整塊在輸入框裡置中；主行不讓 drawLyric 自動畫原文（字太小），原文另外照畫面字級畫、比中文安靜
        const base = this.inY + (this.inH - d.blockH) / 2 + d.lay.size * 0.8;
        c.save(); c.globalAlpha = a; c.translate(PX + 45, base + dy);
        drawLyric(c, l, t, { ...st, ...colors }, { ...d.lay, sub: undefined } as LyricLayout, 1);
        c.translate(0, d.dy);
        drawLyric(c, d.sub, t, { ...st, active: rgba('bone', 0.95 * 0.8), sung: rgba('bone', 0.95 * 0.8), unsung: colors.unsung }, d.sl, 1);
        c.restore();
        return;
      }
      const lay = layoutLyric(c, l, st);
      const base = this.inY + (lay.rows.length > 1 ? this.inH / 2 - lay.size * 0.2 : this.inH / 2 + lay.size * 0.36);
      c.save(); c.globalAlpha = a; c.translate(PX + 45, base + dy);
      drawLyric(c, l, t, { ...st, ...colors }, lay, 1);
      c.restore();
    };
    c.save();
    c.beginPath(); c.rect(0, this.inY - 60, CW, this.inH + 60); c.clip();
    if (cur >= 0) {
      const l = this.lines[cur]!;
      const tin = l.start - 0.35;
      const prev = this.lines[cur - 1];
      // 舊的一句先往上飄走（0.18 秒），新的一句晚一點點從下面浮上來，兩句不要疊在一起
      if (prev && t < tin + 0.18) { const u = prog(t, tin - 0.02, tin + 0.18, ease.inCubic); draw(prev, -u * 170, 1 - u); }
      draw(l, (1 - prog(t, tin + 0.08, tin + 0.32, ease.outCubic)) * 50, prog(t, tin + 0.08, tin + 0.26));
    } else {
      c.font = font(F.hei(400), 60); c.fillStyle = rgba('bone', 0.25);
      c.fillText('…', PX + 45, this.inY + this.inH / 2 + 20);
    }
    c.restore();
  }

  /** 純音樂：錄音中的波形（這一段真的音量）、紅點跟著拍子閃、秒數。 */
  private recording(c: CanvasRenderingContext2D, t: number) {
    const g = this.g, s = this.ctx.start, e = this.ctx.end;
    const p = prog(t, s, e);
    const on = ((t - g.b0) / g.beat) % 1 < 0.5;
    c.fillStyle = rgba('signal', on ? 0.95 : 0.35);
    c.beginPath(); c.arc(PX + 80, this.inY + this.inH / 2, 22, 0, Math.PI * 2); c.fill();
    const N = this.voice.length, x0 = PX + 140, x1 = CW - PX - 180, step = (x1 - x0) / N;
    for (let i = 0; i < N; i++) {
      const hh = 16 + 160 * Math.pow(this.voice[i]!, 0.8);
      c.fillStyle = i / N < p ? rgba('bone', 0.85) : rgba('bone', 0.25);
      rrect(c, x0 + i * step, this.inY + this.inH / 2 - hh / 2, step * 0.5, hh, 6); c.fill();
    }
    c.font = font(F.mono(500), 46); c.fillStyle = rgba('bone', 0.6);
    c.fillText(`0:${pad(Math.max(0, t - s), 2)}`, x1 + 30, this.inY + this.inH / 2 + 16);
  }

  /** 打字中的三個點：每個八分音符輪到下一個點跳起來。 */
  private dots(c: CanvasRenderingContext2D, x: number, y: number, t: number, t0: number) {
    const k = pop(t, t0, 0.3);
    c.save();
    c.globalAlpha = clamp(k * 2);
    c.fillStyle = mixRgba('ink2', 'graphite', 0.55); rrect(c, x, y, 250, 130, 56); c.fill();
    const ph = (t - t0) / (this.g.beat / 2);
    for (let i = 0; i < 3; i++) {
      const onI = Math.floor(ph) % 3 === i;
      const lift = onI ? Math.sin(Math.PI * clamp((ph - Math.floor(ph)) * 1.4)) * 20 : 0;
      c.fillStyle = rgba('bone', onI ? 0.95 : 0.4);
      c.beginPath(); c.arc(x + 70 + i * 55, y + 68 - lift, 16, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}
