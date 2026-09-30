// 手機通知（暗）：深夜，一支手機面朝上躺在深色的亞麻桌布上，鏡頭從正上方俯拍、慢慢旋轉（電影裡「訊息進來了」的特寫）。
// 整個畫面唯一的光是螢幕：螢幕亮、布上就亮一圈；每一則通知進來，光跟著跳一下。
//  - 窗格一開始螢幕是黑的（玻璃上只有一條窗光的反射）；第一拍通知進來，螢幕亮起來，光灑在布上。
//  - 鎖定畫面只留三樣：上面一個小小的、淡淡的時鐘（這首歌唱到第幾秒，只在拍點上捲動換數字）、
//    中間主打留言的通知（手寫字，整個畫面最大最亮的東西，署名在最後）、下面音樂小卡的歌詞（逐字跟唱，比留言小一級）。
//  - 桌布：以右下角外為圓心的細同心圓，每一下大鼓送出一圈訊號色的波紋，很淡。
//  - 鏡頭：慢慢推近，每個小節線緩一下；最後半拍螢幕休眠（暗掉），桌上的光跟著收。
// v2（留言尺寸標準）：手機本身是場景、可以大（幾乎撐滿畫面高），只有通知那一塊照留言區的大小；
// 補的動畫跟「通知」有關：每個小節線手機震一下（震動會讓它在布上一點一點滑走），同時又一則通知疊進主打下面（露出一條邊）。
// 螢幕上的字級照 v2（畫面上的 px）：用鏡頭把螢幕寬度投影到畫面上，算出「畫面 px／畫布 px」再換算。
// 畫法：手機、桌面是 three.js（_t5 的舞台：超取樣＋景深，桌面遠近都會糊、手機是清楚的）；螢幕的內容是一張直式 Canvas2D（fast），
// 每格重畫，由螢幕材質自己解碼當成自發光，玻璃有菲涅耳與窗光反射。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, fillWithHearts, signature, WEDDING_DATE, lyricAt, lyricSubOf, subSizeFor, subGap, type LyricStyle, type LyricLayout } from './_motifs';
import { grid, windowLines, rrect, pad, settle, renderStage, bodyMaterial, screenMaterial, tableMaterial, slab, setV3, mixV, projScale, fitMsgV2, type Grid } from './_t5';
import { V2, lyricV2, sigV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: false, energy: [0.1, 0.8], bars: [4, 8] };

// ---------------------------------------------------------------- 手機（公分）與螢幕畫布（像素）
const PHONE = { w: 7.4, h: 15.9, d: 0.8, r: 1.1 };
const CW = 1080, CH = 2340;
const SCR = { w: 6.9, h: 6.9 * (CH / CW) };
const SPIN = -0.32; // 手機在布上斜斜地躺著（俯拍時是對角線構圖）
const MX = 44, MW = CW - 2 * MX; // 卡片左右（螢幕窄：卡片幾乎貼邊，字才放得下一個子句一行）
// 有留言：音樂小卡在上（離鏡頭遠、透視上比較小），通知在下（離鏡頭近、最大）；沒有留言：邀請在上、歌詞在下當焦點
const WID_H = 400;
const HEAD_H = 80; // 通知卡上面那一行小字的高度
const LYRIC_BASE: LyricStyle = { family: F.archivo(100, 700), size: 112, minSize: 104, maxWidth: MW - 90, align: 'left', lineHeight: 1.1 };

function makeRig() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 1, 800);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), tableMaterial());
  const phone = new THREE.Group();
  const body = new THREE.Mesh(slab(PHONE.w, PHONE.h, PHONE.d, PHONE.r, 0.16), bodyMaterial());
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCR.w, SCR.h), screenMaterial());
  screen.position.z = 0.012;
  phone.add(body, screen);
  // 先在螢幕平面裡轉（spin），再躺平（螢幕朝上）
  phone.rotation.set(-Math.PI / 2, 0, SPIN);
  phone.position.set(0, PHONE.d, 0);
  scene.add(table, phone);
  return { scene, cam, table, body, screen, phone };
}

export default class Phone extends Scene {
  rig = shared('phone.rig', makeRig);
  ui = this.track(new Layer2D(CW, CH, 0.8, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  tHero = 0;
  fit: FitResult | null = null;
  cardH = 0;
  cardY = 600;
  widY = 1790;
  date = '';
  digitW = 0;
  colonW = 0;
  instr = false;
  /** 畫面 px／畫布 px（init 時用窗格中段的鏡位量）與換算過的字級。 */
  sc = 0.45;
  lyr: LyricStyle = LYRIC_BASE;
  sigSize = 60;
  msgScreen = 0;
  /** 音樂小卡的高度：有原文副行（韓文歌）的窗格往上長高，放得下中文＋原文。 */
  widH = WID_H;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const c = this.ui.ctx;
    const [yy, mm, dd] = String(WEDDING_DATE).split('-').map(Number) as [number, number, number];
    const dow = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
    this.date = `${mm}月${dd}日 星期${'日一二三四五六'[dow]}`;
    const lines = windowLines(lyrics, s, e);
    this.instr = lines.length === 0;
    const m = this.msg;
    await loadText(`${this.date}祝福現在新人的手機掃描右下角你的祝福就會跳出通知純音樂間奏中一位賓客${song.title}${song.artist}${m ? m.text + m.name : ''}${lines.map((l) => l.text).join('')}`);
    // 通知在第一拍進來（螢幕同時亮起來）
    this.tHero = g.b0;
    const body = m ? m.text : '掃描右下角 QR code，你的祝福就會跳出通知';
    // v2 字級：先量窗格中段的鏡位下，螢幕上 1 畫布 px 是畫面上幾 px
    this.pose((s + e) / 2);
    const k = this.sc = projScale(this.rig.cam, this.rig.screen, new THREE.Vector3(-SCR.w / 2, 0, 0), new THREE.Vector3(SCR.w / 2, 0, 0), CW);
    // 有留言：留言在下面（離鏡頭近），字級照 v2；沒有留言：邀請小小的，焦點讓給歌詞
    // 螢幕很窄：有留言時歌詞小卡往上收、通知卡從 880 開始，高度預算扣掉署名那一行（署名最大 32/k），署名才不會掉出螢幕
    this.cardY = m ? 880 : 600;
    this.widY = m ? 460 : 1790;
    const hMax = CH - 60 - this.cardY - HEAD_H - (V2.sigMax / k) * 1.9;
    if (m) {
      this.fit = fitMsgV2(c, body, F.hand(400), MW - 80, hMax, k, 1.18, 9);
    } else this.fit = fitText(c, body, F.hei(500), MW - 80, 260, { min: 30 / k, max: 34 / k, lineHeight: 1.3, maxLines: 3 });
    this.msgScreen = this.fit.size * k;
    this.lyr = { ...LYRIC_BASE, size: lyricV2(m ? this.msgScreen : null) / k, minSize: V2.lyrMin / k };
    this.sigSize = sigV2(this.msgScreen) / k;
    this.cardH = HEAD_H + this.fit.height + this.fit.size * 0.3 + (m ? this.sigSize * 1.9 : 50);
    // 原文副行：量這個窗格每一句中文＋原文要多高，音樂小卡不夠就往上長（下緣不動；上面只有邀請那一張小卡，讓得出位置）
    let need = 0;
    for (const l of lines) { const d = this.subLay(c, l); if (d) need = Math.max(need, 110 + d.blockH + 90); }
    if (need > WID_H && m) {
      // 雙語（2026-09-30）：有留言時音樂小卡在時鐘下面，往上長會蓋到時鐘；改成往下長，通知卡整張往下讓（螢幕下半本來就有空）。
      // 通知卡放不下就用少掉的高度重排留言（字級還是照 v2），歌詞字級跟著留言變，所以再量一次小卡要多高
      this.widH = Math.ceil(need);
      this.cardY += this.widH - WID_H;
      const hMax2 = CH - 60 - this.cardY - HEAD_H - (V2.sigMax / k) * 1.9;
      if (this.fit.height > hMax2) {
        this.fit = fitMsgV2(c, body, F.hand(400), MW - 80, hMax2, k, 1.18, 9);
        this.msgScreen = this.fit.size * k;
        this.lyr = { ...LYRIC_BASE, size: lyricV2(this.msgScreen) / k, minSize: V2.lyrMin / k };
        this.sigSize = sigV2(this.msgScreen) / k;
        this.cardH = HEAD_H + this.fit.height + this.fit.size * 0.3 + this.sigSize * 1.9;
        let need2 = 0;
        for (const l of lines) { const d = this.subLay(c, l); if (d) need2 = Math.max(need2, 110 + d.blockH + 90); }
        this.widH = Math.max(WID_H, Math.ceil(need2));
      }
    } else if (need > WID_H) { this.widH = Math.ceil(need); this.widY -= this.widH - WID_H; }
    c.font = font(F.archivo(62, 300), 130);
    this.digitW = Math.max(...'0123456789'.split('').map((d) => c.measureText(d).width));
    this.colonW = c.measureText(':').width + 8;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, g = this.g;
    const R = this.rig;
    // 螢幕：第一拍亮起來、最後半拍休眠
    const on = prog(t, g.b0 - 0.03, g.b0 + 0.18, ease.outCubic) * (1 - prog(t, e - g.beat * 0.55, e - 0.05, ease.inCubic));
    this.drawUi(t);

    // ---- 材質（每格從色票設：換主題時跟著變）
    const tb = R.table.material as THREE.ShaderMaterial, bd = R.body.material as THREE.ShaderMaterial, sc = R.screen.material as THREE.ShaderMaterial;
    // 手機：每個小節線（通知進來之後）震一下；震動讓它在布上一點一點滑走（累積的位移，照時間算）
    let buzz = 0, walk = 0;
    for (const b of g.bars) if (b >= this.tHero - 0.01 && t >= b) { buzz += Math.exp(-(t - b) * 14); walk += 0.35 * ease.outCubic(clamp((t - b) / 0.25)); }
    R.phone.position.set(walk * 0.8 + Math.sin(t * 95) * 0.1 * Math.min(1, buzz), PHONE.d, -walk * 0.35);
    R.phone.rotation.z = SPIN + walk * 0.012 + Math.sin(t * 83) * 0.012 * Math.min(1, buzz);
    // 深色的亞麻桌布；唯一的光是螢幕（亮起來、通知進來時跳一下）
    setV3(tb.uniforms.base!, mixV(LIN.ink2, LIN.blood, 0.12), 1.15);
    setV3(tb.uniforms.base2!, mixV(LIN.ink, LIN.ink2, 0.4));
    tb.uniforms.grainK!.value = 0.7;
    tb.uniforms.weave!.value = 1;
    setV3(tb.uniforms.glowCol!, mixV(LIN.bone, LIN.signal, 0.35), (0.1 + 0.07 * Math.min(1, buzz)) * on);
    (tb.uniforms.glowPos!.value as THREE.Vector3).set(R.phone.position.x, 0, R.phone.position.z);
    tb.uniforms.glowR!.value = 20;
    (tb.uniforms.shadow!.value as THREE.Vector4).set(R.phone.position.x, R.phone.position.z, PHONE.w / 2, PHONE.h / 2);
    tb.uniforms.shadowRot!.value = -R.phone.rotation.z;
    tb.uniforms.shadowK!.value = 0.75;
    setV3(tb.uniforms.fade!, LIN.ink, 0.6);
    tb.uniforms.fadeZ!.value = 40;
    setV3(tb.uniforms.lampCol!, LIN.ink, 0);
    tb.uniforms.goboK!.value = 0;
    setV3(bd.uniforms.base!, mixV(LIN.ink, LIN.ink2, 0.6));
    setV3(bd.uniforms.keyCol!, mixV(LIN.bone, LIN.signal, 0.3), 0.55);
    setV3(bd.uniforms.fill!, LIN.ink2, 0.9);
    bd.uniforms.shine!.value = 0.5; bd.uniforms.rough!.value = 60;
    sc.uniforms.ui!.value = this.ui.upload();
    sc.uniforms.on!.value = 0.025 + 0.975 * on;
    setV3(sc.uniforms.sheen!, LIN.bone, 0.045);
    (sc.uniforms.refl!.value as THREE.Vector3).set(-0.45, 0.55, 0.7);

    // ---- 鏡頭（見 pose）
    const dist = this.pose(t);
    renderStage(renderer, R.scene, R.cam, out, LIN.ink, { focus: dist, range: 4, maxR: 16, falloff: 0.3 });
    void s; void au; void hash;
    return { bloom: 0.5, vignette: 0.42, grain: 0.05 };
  }

  /**
   * 鏡頭：幾乎從正上方俯拍（稍微斜一點，布的遠處才會糊），整個窗格繞著手機慢慢轉；每個小節線往前推一小步，
   * 主打進來時多推一點。手機斜躺成對角線，幾乎撐滿畫面高。回傳鏡頭到手機的距離（景深對焦用）。
   */
  private pose(t: number): number {
    const R = this.rig, g = this.g, s = this.ctx.start;
    let step = 0;
    for (const b of g.bars) step += prog(t, b - 0.1, b + 0.6, ease.inOutCubic);
    const push = Math.min(step, 6) * 0.25 + 0.8 * prog(t, this.tHero, this.tHero + 0.9, ease.outCubic);
    const dist = 37 - push;
    const pitch = 1.22;
    const yaw = -0.15 + (t - s) * 0.012;
    const target = new THREE.Vector3(1.8, PHONE.d, 0.6);
    R.cam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    R.cam.up.set(0, 1, 0);
    R.cam.lookAt(target);
    R.cam.updateMatrixWorld();
    R.cam.updateProjectionMatrix();
    return R.cam.position.distanceTo(target);
  }

  // ---------------------------------------------------------------- 螢幕內容（直式畫布）
  private drawUi(t: number) {
    const c = this.ui.ctx;
    const { audio: au, lyrics, song } = this.ctx;
    const g = this.g, m = this.msg, fit = this.fit!;
    // 桌布：底色漸層＋很淡的同心圓＋大鼓的波紋
    const bg = c.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, mixRgba('ink2', 'graphite', 0.1)); bg.addColorStop(1, rgba('ink'));
    c.fillStyle = bg; c.fillRect(0, 0, CW, CH);
    const ox = CW + 180, oy = CH + 260;
    c.lineWidth = 2;
    for (let r = 300; r < 2900; r += 44) { c.strokeStyle = rgba('bone', 0.035); c.beginPath(); c.arc(ox, oy, r, Math.PI, Math.PI * 1.5); c.stroke(); }
    for (const [tk] of au.events('kick', t - 2.6, t + 1e-3)) {
      const age = t - tk, R = 300 + age * 1300;
      c.strokeStyle = rgba('signal', 0.3 * Math.exp(-age * 1.5)); c.lineWidth = 3;
      c.beginPath(); c.arc(ox, oy, R, Math.PI, Math.PI * 1.5); c.stroke();
    }
    c.textBaseline = 'alphabetic';
    // 日期（小、淡）與時鐘（細、淡）：這首歌唱到第幾秒，只在拍點上換
    c.textAlign = 'center';
    c.font = font(F.hei(500), 38); c.fillStyle = rgba('bone', 0.5);
    c.fillText(this.date, CW / 2, 250);
    c.textAlign = 'left';
    const bi = Math.floor(au.beatAt(t) + 1e-6);
    const bt = t >= au.beats[0]! ? au.timeOfBeat(bi) : t;
    const cur = Math.floor(bt + 1e-3), prev = Math.floor((t >= au.beats[0]! ? au.timeOfBeat(bi - 1) : t - 1) + 1e-3);
    const r = prog(t, bt, bt + 0.3, ease.outExpo);
    const fmt = (x: number) => `${pad(Math.floor(x / 60), 2)}:${pad(x % 60, 2)}`;
    const a = fmt(prev), b = fmt(cur);
    const size = 130, base = 430;
    c.font = font(F.archivo(62, 300), size);
    let x = (CW - (this.digitW * 4 + this.colonW)) / 2;
    for (let i = 0; i < b.length; i++) {
      const ch = b[i]!, old = a[i]!;
      const cw = ch === ':' ? this.colonW : this.digitW;
      c.save();
      c.beginPath(); c.rect(x - 4, base - size * 0.8, cw + 8, size * 0.86); c.clip();
      if (ch === ':') { c.fillStyle = rgba('bone', ((t - g.b0) / g.beat) % 1 < 0.5 ? 0.45 : 0.2); c.fillText(':', x + 2, base - 8); }
      else if (ch !== old && r < 1) {
        c.fillStyle = rgba('bone', 0.45 * (1 - r)); c.fillText(old, x + (cw - c.measureText(old).width) / 2, base - r * size * 0.8);
        c.fillStyle = rgba('signal', 0.9); c.fillText(ch, x + (cw - c.measureText(ch).width) / 2, base + (1 - r) * size * 0.8);
      } else {
        const hot = ch !== old ? 1 - prog(t, bt + 0.3, bt + 0.3 + g.beat * 0.6) : 0;
        c.fillStyle = mixRgba('bone', 'signal', hot, 0.45 + 0.35 * hot); c.fillText(ch, x + (cw - c.measureText(ch).width) / 2, base);
      }
      c.restore();
      x += cw;
    }

    // 主打的通知：從上面滑下來（彈簧），霧面的底很淡，字是主角
    const k = settle(t, this.tHero, 2.2, 0.72);
    if (t >= this.tHero) {
      const y = this.cardY - (1 - clamp(k)) * 90;
      c.save();
      c.globalAlpha = clamp(k * 2);
      // 疊在主打下面的通知（只露出一條邊）：主打之後每個小節線又進來一則（跟手機震動同一拍），最多三則
      const more = g.bars.filter((b) => b >= this.tHero + g.beat * 0.5).slice(0, 3);
      more.forEach((b, i) => {
        const u = settle(t, b, 2.4, 0.7);
        if (u <= 0) return;
        const inset = 26 * (i + 1), peek = 24 * (i + 1) * clamp(u, 0, 1.1);
        c.fillStyle = rgba('bone', 0.06 - 0.012 * i); rrect(c, MX + inset, y + this.cardH - 60 + peek, MW - 2 * inset, 60, 30); c.fill();
      });
      c.fillStyle = mixRgba('ink', 'ink2', 0.6, 1); rrect(c, MX, y, MW, this.cardH, 48); c.fill();
      c.fillStyle = rgba('bone', 0.075); rrect(c, MX, y, MW, this.cardH, 48); c.fill();
      c.font = font(F.hei(500), 30); c.fillStyle = rgba('bone', 0.42);
      c.fillText(m ? (m.couple ? '新人 · 現在' : '祝福 · 現在') : '新人的手機', MX + 40, y + 70);
      c.font = font(m ? F.hand(400) : F.hei(500), fit.size); c.fillStyle = rgba('bone', m ? 0.97 : 0.8);
      fit.lines.forEach((ln, i) => fillWithHearts(c, ln, MX + 40, y + HEAD_H + fit.size * 0.95 + i * fit.lineHeight));
      if (m) {
        // 署名：緊接在最後一行下面（v2 的署名字級）
        c.font = font(F.hand(400), this.sigSize); c.fillStyle = rgba('bone', 0.62); c.textAlign = 'right';
        c.fillText(signature(m.name), MX + MW - 50, y + HEAD_H + fit.height + fit.size * 0.3 + this.sigSize * 1.2);
        c.textAlign = 'left';
      }
      c.restore();
    }

    // 音樂小卡：歌詞（比留言小一級）；純音樂時是很淡的頻譜
    const wy = this.widY;
    c.fillStyle = rgba('bone', 0.05); rrect(c, MX, wy, MW, this.widH, 48); c.fill();
    c.font = font(F.hei(500), 30); c.fillStyle = rgba('bone', 0.4);
    const head = `♪ ${song.title || '今晚的歌'}`;
    c.fillText(head.length > 26 ? head.slice(0, 25) + '…' : head, MX + 40, wy + 70);
    const ly = this.instr ? null : lyricAt(lyrics, t);
    if (ly) {
      const st = this.lyr;
      const lay = layoutLyric(c, ly.line, st);
      const d = this.subLay(c, ly.line);
      // 有原文：中文＋原文整塊放在標題與進度條中間
      const top = d ? wy + 110 + (this.widH - 200 - d.blockH) / 2 + lay.size * 0.8 : wy + (lay.rows.length > 1 ? 185 : 245);
      const sung = rgba('bone', m ? 0.86 : 0.96);
      c.save(); c.translate(MX + 40, top);
      drawLyric(c, ly.line, t, { ...st, active: rgba('signal'), sung, unsung: rgba('bone', 0.3) }, d ? ({ ...lay, sub: undefined } as LyricLayout) : lay, ly.k);
      if (d) {
        // 原文：照畫面字級另外畫（drawLyric 自動畫的會照畫布 px，螢幕縮小後太小），比中文安靜：唱到、唱完都是紙白再淡兩成
        c.translate(0, d.dy);
        const q = rgba('bone', (m ? 0.86 : 0.96) * 0.8);
        drawLyric(c, d.sub, t, { ...st, active: q, sung: q, unsung: rgba('bone', 0.3) }, d.sl, ly.k);
      }
      c.restore();
    } else {
      const N = 36, bw = (MW - 80) / N;
      for (let i = 0; i < N; i++) {
        const v = au.env(['low', 'bass', 'mid', 'other', 'high'][i % 5]!, t - i * 0.012) * (0.6 + 0.4 * hash(i, 3));
        const hh = 10 + 110 * v;
        c.fillStyle = rgba('bone', 0.3);
        rrect(c, MX + 40 + i * bw, wy + 280 - hh, bw * 0.5, hh, 4); c.fill();
      }
    }
    // 進度條（很細）
    const p = clamp(t / au.duration);
    c.fillStyle = rgba('bone', 0.15); c.fillRect(MX + 40, wy + this.widH - 50, MW - 80, 5);
    c.fillStyle = rgba('bone', 0.6); c.fillRect(MX + 40, wy + this.widH - 50, (MW - 80) * p, 5);
  }

  /**
   * 原文副行的排版（畫布 px）：照「畫面上」的主行字級算原文字級（subSizeFor(主行 × sc) ÷ sc），
   * 螢幕在畫面上縮很小，照畫布 px 算會小到看不清楚。blockH = 中文字頂到原文字底。
   */
  private subLay(c: CanvasRenderingContext2D, l: Line) {
    const sub = lyricSubOf(l);
    if (!sub) return null;
    const k = this.sc, st = this.lyr, lay = layoutLyric(c, l, st);
    // 原文至少 34 螢幕 px、不再縮（手機斜躺、離鏡頭遠，太小就讀不到），太長就折行
    const ss = Math.max(34, subSizeFor(lay.size * k)) / k;
    const sl = layoutLyric(c, sub, { ...st, size: ss, minSize: ss, tracking: (st.tracking ?? 0) * 0.5 });
    const dy = lay.rows[lay.rows.length - 1]!.y + subGap(lay.size * k, sl.size * k) / k;
    const blockH = lay.size * 0.8 + dy + sl.rows[sl.rows.length - 1]!.y + sl.size * 0.22;
    return { lay, sub, sl, dy, blockH };
  }
}


