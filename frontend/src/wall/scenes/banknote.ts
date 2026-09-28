// 愛情準備銀行的鈔票（亮版面）。照 pdoom 的 ascent 裡那張「LUNAR RESERVE NOTE」：奶茶色的紙、鈔票紋外框、
// 玫瑰花飾、細線雕刻的中央徽章——月亮換成兩只交扣的婚戒。
//
// 一個窗格的節奏（拍點驅動，任何長度都成立）：
//  - 切進來（小節線）：外框從左上角往兩邊描出來，一拍內把固定的字（行名、∞、標語、總裁簽名）像燙金一樣一個個壓上去。
//  - 第一個拍點：仙女棒從花飾正上方出發，沿著外圈花飾的曲線跑一圈（2～4 拍），描到哪、墨就印到哪；
//    同時主打留言一拍一行「印」上去（雕版網線由細變粗，剛印好的字是燙的，訊號色發光、冷卻成墨色）。
//  - 留言印好：序號的最後六位（= 留言編號）像號碼機一樣，十六分音符一格一格打上去。
//  - 花飾接起來的那一拍：中央的婚戒沿著戒圈一圈一圈刻出來；仙女棒飛到簽名欄，把名字簽上去，然後熄掉。
//  - 之後：每個小節線戒指轉一小格（停住、再轉），大鼓讓金屬箔閃一道光往下跑，每四小節仙女棒回來繞花飾一圈；
//    鏡頭慢慢推近，最後一拍加速推進切走。
// 歌詞：鈔票下緣內側有一條「微縮防偽文字」，印的就是正在唱的那句；桌面上用放大鏡的引線把它放大成大字跟唱（照跟唱規則）。
// 沒有主打留言：鈔票是一張「樣張」——祝福欄寫著邀請，花飾描完那一拍蓋上訊號色的「樣張 SPECIMEN」。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { Layer2D, makeRT, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_EN, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { NOTE, INNER, MED, ARC_R, THREAD_X, rosettePoint, makeBakePass, makeMainPass } from './banknote-art';

type P2 = { x: number; y: number };
/** 主打留言的框（雕版大字）。右邊留給安全線與徽章。 */
const HERO = { x: 198, y: 322, w: 900, h: 262 };
/** 簽名欄：祝福人（左）與準備銀行總裁（右）。 */
const SIG = { x: 198, base: 652, w: 400, rule: 664 };
const GOV = { x: 690, base: 652, w: 380 };
/** 鈔票下緣內側的微縮文字、與桌面上放大的那一行。 */
const MICRO = { y: 736, x0: INNER.x0 + 6, x1: INNER.x1 - 6 };
const MAG = { x: 150, maxW: 1180, base: 918 };
/** 會動的字（歌詞、微縮文字）只畫在這一條，上傳比整張畫布便宜三倍多。 */
const STRIP = { y: 700, h: 300 };

/** 戒指固定的傾斜：先繞 x 轉 45°（兩只看起來一樣大），再歪一點。 */
const TILT = new THREE.Matrix4().makeRotationZ(-0.16).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 4));
/** 讓出主執行緒一下（不影響畫面內容，只影響什麼時候做）。 */
const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

// 模組層共用：shader 與「只算一次」的底紋（整晚所有鈔票窗格共用，存的是墨的覆蓋率，換主題不用重算）
const bakeStore = () => ({ rt: makeRT(W, H, { depthBuffer: false }), pass: makeBakePass(), done: false });

type Cls = 'eng' | 'plain' | 'acc' | 'rose' | 'sig';

export default class Banknote extends Scene {
  main = shared('banknote.main', makeMainPass);
  bake = shared('banknote.bake', bakeStore);
  /** 這個窗格所有「印上去」的字：R/G/B 編碼類別與印出來的時間（見 banknote-art.ts）。只畫一次、上傳一次。 */
  mask = this.track(new Layer2D());
  strip = this.track(new Layer2D(W, STRIP.h));
  glow = this.track(new LineBatch(3072, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  /** 時間表（秒）。 */
  T = { P: 0.5, b0: 0, ros0: 0, ros1: 0, dev0: 0, dev1: 0, sig0: 0, sig1: 0, stamp: -1, span: 1, frame1: 0, printEnd: 0 };
  /** 簽名的位置（仙女棒沿著它寫）。 */
  sigBox = { x0: 0, x1: 0, y: 0 };
  heroPeriod = 4;
  seed = 1;
  /** 即時小卡要避開的範圍（init 算好，每格回傳）。 */
  avoid: [number, number, number, number][] = [];

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    this.seed = this.ctx.params.seed ?? 1;
    // 圖層當資料用（R/G/B 是編碼，不是顏色）：不要做 sRGB 解碼
    this.mask.texture.colorSpace = THREE.NoColorSpace;
    const T = this.T;
    const b0 = beatAfter(au, s + 0.15);
    const P = T.P = au.beatPeriod(b0);
    const bi = Math.round(au.beatAt(b0));
    const beat = (k: number) => au.timeOfBeat(bi + k);
    T.b0 = b0;
    const nb = Math.max(2, (e - b0) / P);
    T.frame1 = s + clamp(P * 1.2, 0.45, 1.1);
    // 花飾一圈：窗格短就 2 拍、夠長就一小節
    const rosBeats = clamp(Math.floor((nb - 3) / 2), 2, 4);
    T.ros0 = b0; T.ros1 = beat(rosBeats);
    T.dev0 = T.ros1; T.dev1 = T.ros1 + clamp(P * 1.6, 0.7, 1.4);

    const m = this.msg;
    await loadText(`愛情準備銀行憑票即付祝福壹則準備銀行總裁祝福人新人簽名處樣張微縮防偽文字放大倍把你的祝福印上下一張鈔票掃描右下角寫下幾秒後就會在大螢幕${COUPLE_ZH}${m ? m.text + m.name : ''}一位賓客∞０１２３４５６７８９`);

    // ---- 排留言（雕版大字，思源宋體）
    const c = this.mask.ctx;
    const heroFam = F.ming(700);
    if (m) {
      this.fit = fitText(c, m.text, heroFam, HERO.w, HERO.h, { min: 44, max: 136, lineHeight: 1.3, maxLines: 4 });
    } else {
      // 邀請的斷行自己決定（「印上」不能拆開）：第一行短，右邊空出來蓋「樣張」印章
      const inv = ['把你的祝福，', '印上下一張鈔票'];
      c.font = font(heroFam, 100);
      const size = Math.min(92, Math.floor((100 * HERO.w * 0.8) / Math.max(...inv.map((l) => c.measureText(l).width))));
      this.fit = { size, lines: inv, lineHeight: size * 1.3, width: 0, height: size * 2.3 };
    }
    const fit = this.fit;
    // 窗格是在前一個窗格播放時預先建的：排版、畫字、上傳之間讓出主執行緒，正在播的畫面才不會掉格
    await yieldFrame();
    // 網線週期跟字級走：字越大線越疏，小字也還讀得到
    this.heroPeriod = clamp(fit.size / 21, 2.6, 5.2);
    const maxLen = Math.max(...fit.lines.map((l) => Array.from(l).length), 1);
    const gap = Math.min(0.06, (0.85 * P) / maxLen);
    // 一拍一行
    const lineT = fit.lines.map((_, i) => beat(i));
    T.printEnd = lineT[lineT.length - 1]! + Array.from(fit.lines[fit.lines.length - 1]!).length * gap;
    // 序號：留言印好後的下一拍，十六分音符一格
    const serT0 = beat(fit.lines.length);
    // 簽名：花飾接起來、仙女棒飛過去之後（對齊半拍）
    const sigName = m ? this.clip(m.name || '一位賓客', F.hand(700), 60 * 0.45, SIG.w - 10) : '';
    T.sig0 = Math.max(T.ros1 + P * 0.5, T.printEnd + P * 0.25);
    T.sig0 = b0 + Math.ceil((T.sig0 - b0) / (P / 2) - 1e-3) * (P / 2);
    T.sig1 = T.sig0 + clamp(0.085 * Array.from(sigName).length + 0.35, 0.55, 1.3);
    if (!m) T.stamp = beat(rosBeats + 1);
    T.span = Math.max(T.sig1, serT0 + P * 2, T.stamp) - s + 0.1;

    // ---- 把字畫進遮罩：先塗黑（不透明，邊緣反鋸齒才會等比例），再用顏色編碼類別與時間
    this.mask.clear('#000');
    const code = (t: number) => Math.round(255 * clamp((t - s) / T.span));
    const ink = (cls: Cls, t: number) => {
      const g = code(t);
      // 類別用 B/R 的比例編碼（邊緣反鋸齒時兩個通道等比例變淡，比例不變）：見 banknote-art.ts 的文字遮罩
      return cls === 'eng' ? `rgb(255,${g},0)` : cls === 'acc' ? `rgb(255,${g},255)` : cls === 'rose' ? `rgb(255,${g},128)` : cls === 'sig' ? `rgb(64,${g},255)` : `rgb(0,${g},255)`;
    };
    const text = (str: string, x: number, y: number, fam: string, size: number, cls: Cls, t: number, o: { track?: number; align?: CanvasTextAlign } = {}) => {
      c.font = font(fam, size);
      c.letterSpacing = `${o.track ?? 0}px`;
      c.textAlign = o.align ?? 'left';
      c.fillStyle = ink(cls, t);
      c.fillText(str, x, y);
      c.letterSpacing = '0px';
      c.textAlign = 'left';
    };
    c.textBaseline = 'alphabetic';
    // 固定的字：切進來的第一拍內，十六分音符一組壓上去
    const q = (k: number) => s + k * Math.min(P / 4, 0.16);
    text('∞', INNER.x0 + 40, INNER.y0 + 112, F.serif(600), 132, 'eng', q(0));
    text('∞', INNER.x1 - 36, INNER.y0 + 92, F.serif(600), 96, 'eng', q(1), { align: 'right' });
    text('愛情準備銀行', 360, 196, F.ming(900), 54, 'plain', q(0), { track: 14 });
    text('THE LOVE RESERVE BANK', 362, 238, F.serif(600), 21, 'plain', q(1), { track: 7 });
    text('憑票即付　祝福壹則', HERO.x, 292, F.hei(500), 22, 'plain', q(2), { track: 7 });
    c.font = font(F.hei(500), 22); c.letterSpacing = '7px';
    const legW = c.measureText('憑票即付　祝福壹則').width;
    c.letterSpacing = '0px';
    text('PAYABLE TO THE BEARER ON DEMAND', HERO.x + legW + 22, 291, F.mono(500), 13, 'plain', q(3), { track: 2.5 });
    this.arcText(c, 'LOVE RESERVE NOTE', ARC_R, F.serif(600), 30, 0.2, 'top', ink('plain', q(1)));
    this.arcText(c, 'IN LOVE WE TRUST', ARC_R + 10, F.serif(400, true), 25, 0.14, 'bottom', ink('plain', q(2)));
    // 金屬箔上重複的小 ∞（真的鈔票箔上也有重複的小圖案）：跟外框一起印
    for (let y = NOTE.y + 44; y < NOTE.y + NOTE.h - 20; y += 58) text('∞', THREAD_X, y, F.serif(600), 15, 'plain', q(2), { align: 'center' });
    // 簽名欄的線與標籤
    c.fillStyle = ink('plain', q(3));
    c.fillRect(SIG.x, SIG.rule, SIG.w, 1.4);
    c.fillRect(GOV.x, SIG.rule, GOV.w, 1.4);
    text(m ? (m.couple ? '新人　FROM THE COUPLE' : '祝福人　SIGNATURE') : '簽名處　SIGN HERE', SIG.x, SIG.rule + 24, F.hei(500), 15, 'plain', q(3), { track: 3 });
    text('準備銀行總裁　GOVERNORS', GOV.x, SIG.rule + 24, F.hei(500), 15, 'plain', q(3), { track: 3 });
    // 總裁簽名：預先印好的（手寫字）
    this.fitLine(c, COUPLE_ZH, F.hand(700), 46, GOV.w - 20, (size) => text(COUPLE_ZH, GOV.x + 6, GOV.base, F.hand(700), size, 'plain', q(3)));

    // 主打留言：一拍一行、一個字一個字壓上去（愛心用點綴色）
    const top = HERO.y + (HERO.h - fit.height) / 2 + fit.size * 0.9;
    const heroY = m ? top : HERO.y + fit.size * 0.95;
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, heroFam, fit.size);
      c.font = font(heroFam, fit.size);
      for (const g of lay.glyphs) {
        c.fillStyle = ink(g.ch === '♥' ? 'rose' : 'eng', lineT[i]! + g.i * gap);
        c.fillText(g.ch, HERO.x + g.x, heroY + i * fit.lineHeight);
      }
    });
    if (!m) {
      // 邀請：小字補充（一般的墨）
      const y = heroY + (fit.lines.length - 1) * fit.lineHeight + 64;
      text('掃描右下角 QR code，寫下祝福，', HERO.x, y, F.hei(500), 30, 'plain', beat(fit.lines.length));
      text('幾秒後就會印在大螢幕上。', HERO.x, y + 44, F.hei(500), 30, 'plain', beat(fit.lines.length) + P / 2);
    }
    // 序號最後六位：留言編號（沒有留言：這首歌的編號，前面加星號——補發的「星號券」）
    const num = m ? String(m.n).padStart(6, '0') : `★${String(this.ctx.song.index).padStart(5, '0')}`;
    // 整串靠右對齊在留言框的右緣（不要壓到金屬帶）：前綴跟固定的字一起印，號碼一格一格打上去
    c.font = font(F.mono(500), 25);
    const dw = c.measureText('0').width, serX = HERO.x + HERO.w - dw * Array.from(num).length;
    text('AO 20270313', serX - 14, 238, F.mono(500), 25, 'acc', q(2), { align: 'right' });
    c.font = font(F.mono(500), 25);
    Array.from(num).forEach((ch, i) => {
      c.fillStyle = ink('acc', serT0 + i * (P / 4));
      c.fillText(ch, serX + i * dw, 238);
    });
    // 祝福人簽名（手寫字，由左往右寫——shader 用 uSig 的範圍照 x 算時間）
    if (m) {
      this.fitLine(c, sigName, F.hand(700), 60, SIG.w - 10, (size) => {
        c.font = font(F.hand(700), size);
        const w = c.measureText(sigName).width;
        this.sigBox = { x0: SIG.x + 4, x1: SIG.x + 4 + w, y: SIG.base - size * 0.32 };
        text(sigName, SIG.x + 4, SIG.base, F.hand(700), size, 'sig', T.sig0);
      });
    }
    // 樣張：訊號色的斜印章
    if (!m) this.specimen(c, ink('acc', T.stamp));
    this.avoid = this.popupAvoid(heroY, fit);
    // 字全部排好：先上傳（避免窗格第一格卡頓）
    await yieldFrame();
    this.mask.upload();
    this.ctx.renderer.initTexture(this.mask.texture);
    this.ensureBake();
  }

  /**
   * 即時小卡要避開的地方（整個窗格）：留言到簽名那一塊、中央的婚戒、這個窗格有歌詞的話加上放大的歌詞那一條。
   * 上緣的行名、序號、花飾外圈的字讓小卡蓋（左上、正上、右上三格通常是空的），戒指與要讀的字不給蓋。
   */
  private popupAvoid(heroY: number, fit: FitResult): [number, number, number, number][] {
    const c = this.strip.ctx;
    c.font = font(F.ming(700), fit.size);
    const heroW = Math.max(...fit.lines.map((l) => c.measureText(l).width), this.msg ? SIG.w : 700);
    const top = heroY - fit.size * 0.95;
    const out: [number, number, number, number][] = [
      [HERO.x - 10, top - 8, heroW + 20, SIG.rule + 30 - top],
      // 婚戒本身（斜 45° 之後大約上下各 60 px）；肖像圓的上緣讓給右上角的小卡，三行以內的卡片放得下
      [MED.x - 140, MED.y - 68, 280, 150],
    ];
    const { lyrics, start, end } = this.ctx;
    const lines = lyrics.linesIn(start - 0.4, end);
    if (lines.length) {
      const st = { family: F.archivo(100, 800), size: 66, minSize: 48, maxWidth: MAG.maxW };
      const w = Math.max(...lines.map((l) => Math.max(...layoutLyric(c, l, st).rows.map((r) => r.width))));
      out.push([MAG.x - 16, 818, Math.min(w, MAG.maxW) + 32, 180]);
    }
    return out;
  }

  /** 字放不下 maxW 就縮字級（最小 45%）。 */
  private fitLine(c: CanvasRenderingContext2D, str: string, fam: string, size: number, maxW: number, draw: (size: number) => void) {
    c.font = font(fam, size);
    const w = c.measureText(str).width;
    draw(w > maxW ? Math.max(size * 0.45, (size * maxW) / w) : size);
  }

  /** 縮到最小還是太長：從尾巴截掉、加「…」（簽名欄不能壓到隔壁的總裁簽名）。 */
  private clip(str: string, fam: string, minSize: number, maxW: number) {
    const c = this.mask.ctx;
    c.font = font(fam, minSize);
    let chars = Array.from(str);
    if (c.measureText(str).width <= maxW) return str;
    while (chars.length > 1 && c.measureText(chars.join('') + '…').width > maxW) chars = chars.slice(0, -1);
    return chars.join('') + '…';
  }

  /** 沿著徽章外圈的弧排字：上緣順時針讀、下緣逆時針讀（字都是正的）。R 是基線半徑：上緣的字往外長、下緣的字往圓心長。 */
  private arcText(c: CanvasRenderingContext2D, str: string, R: number, fam: string, size: number, trackEm: number, side: 'top' | 'bottom', fill: string) {
    const lay = layout(str, fam, size, size * trackEm);
    const span = lay.width / R;
    c.save();
    c.font = font(fam, size);
    c.fillStyle = fill;
    c.textAlign = 'center';
    c.letterSpacing = '0px';
    for (const g of lay.glyphs) {
      const k = (g.x + g.w / 2) / R - span / 2;
      const a = side === 'top' ? -Math.PI / 2 + k : Math.PI / 2 - k;
      c.save();
      c.translate(MED.x + Math.cos(a) * R, MED.y + Math.sin(a) * R);
      c.rotate(side === 'top' ? a + Math.PI / 2 : a - Math.PI / 2);
      c.fillText(g.ch, 0, 0);
      c.restore();
    }
    c.restore();
  }

  /** 「樣張 SPECIMEN」斜印章（雙線框）。 */
  private specimen(c: CanvasRenderingContext2D, fill: string) {
    c.save();
    // 蓋在邀請第一行右邊的空白（第一行比較短），不要壓到要讀的字
    c.translate(912, 372);
    c.rotate(-0.1);
    c.fillStyle = fill;
    c.strokeStyle = fill;
    c.lineWidth = 4.5; c.strokeRect(-165, -56, 330, 112);
    c.lineWidth = 1.4; c.strokeRect(-155, -46, 310, 92);
    c.textAlign = 'center';
    c.font = font(F.ming(900), 54); c.letterSpacing = '22px';
    c.fillText('樣張', 11, 8);
    c.font = font(F.archivo(125, 900), 21); c.letterSpacing = '11px';
    c.fillText('SPECIMEN', 6, 36);
    c.restore();
  }

  /** 底紋只算一次（整晚共用）。 */
  private ensureBake() {
    const b = this.bake;
    if (b.done) return;
    b.pass.render(this.ctx.renderer, b.rt);
    b.done = true;
  }

  // ------------------------------------------------------------------ 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, T = this.T, P = T.P;
    this.ensureBake();
    const u = this.main.u;
    u.uBake!.value = this.bake.rt.texture;
    u.uMask!.value = this.mask.texture;
    u.uT!.value = t; u.uS!.value = s; u.uSpan!.value = T.span;
    u.uFrame!.value = prog(t, s, T.frame1, ease.outCubic) * 1.08;
    u.uUnder!.value = prog(t, s, s + 0.3);
    u.uNote!.value = 1;
    // 花飾：振幅跟著大鼓呼吸一點點、整圈很慢地轉（moiré 會跟著流動）
    const tw = this.twist(t), amp = this.amp(t);
    const rosU = this.rosU(t);
    (u.uRos!.value as THREE.Vector4).set(tw, amp, rosU, 0.09);
    const trailing = t < T.ros1 ? prog(t, T.ros0, T.ros0 + 0.1) : Math.exp(-(t - T.ros1) / 0.25);
    // 每四小節（印完之後）仙女棒回來繞花飾一圈，後面拖著燙的尾巴
    const sheen = this.sheen(t);
    (u.uHot!.value as THREE.Vector4).set(trailing, sheen.u, sheen.k, 0);
    // 戒指：每個小節線轉一小格（停住、再一下子轉過去）
    (u.uRot!.value as THREE.Matrix3).setFromMatrix4(this.ringRot(t));
    (u.uDev!.value as THREE.Vector2).set(prog(t, T.dev0, T.dev1, ease.inOutCubic), prog(t, T.dev0, T.dev0 + 0.08) * (1 - prog(t, T.dev1 - 0.1, T.dev1 + 0.4)));
    u.uPeriod!.value = this.heroPeriod;
    (u.uSig!.value as THREE.Vector2).set(this.sigBox.x0 - 4, this.sigBox.x1 + 6);
    (u.uSigT!.value as THREE.Vector2).set(T.sig0, T.sig1);
    // 金屬箔：最近一下大鼓的閃光往下跑
    const kick = this.lastKick(t);
    (u.uThread!.value as THREE.Vector3).set(INNER.y0 + (t - kick.t) / 0.42 * (INNER.y1 - INNER.y0), kick.k * Math.exp(-(t - kick.t) / 0.5), 0);
    const head = this.head(t);
    (u.uSpark!.value as THREE.Vector3).set(head?.p.x ?? 0, head?.p.y ?? 0, head ? head.k : 0);
    this.main.render(renderer, out);

    // ---- 微縮文字與放大的歌詞
    this.drawStrip(t);
    comp.draw(renderer, this.strip.upload(), out, { scale: [1, H / STRIP.h], offset: [0, 0.5 + (STRIP.y - H / 2) / STRIP.h] });

    // ---- 仙女棒
    this.glow.clear();
    if (head) {
      sparkParticles(this.glow, t, (tb) => this.head(tb)?.p ?? null, { rate: 120, life: 0.42, speed: 250, seed: this.seed, intensity: 1.1, width: 1.8 });
      sparkHead(this.glow, head.p.x, head.p.y, t, 1.15, head.k);
    }
    if (this.glow.count) this.glow.render(renderer, out);

    // 鏡頭：整個窗格慢慢推近，最後一拍加速推進切走；大鼓輕輕一下
    const zoom = 1 + 0.018 * f.p + 0.022 * prog(t, e - P, e, ease.inCubic) + 0.004 * f.a.kick;
    const stamp = T.stamp > 0 ? pulse(t, T.stamp, 0.07) : 0;
    const clink = pulse(t, T.dev0, 0.08);
    return {
      paper: 1, popupAvoid: this.avoid, bloom: 0.55, bloomThreshold: 0.98, bloomKnee: 0.12, halation: 0.12, vignette: 0.26, grain: 0.05,
      zoom, flash: 0.05 * stamp + 0.03 * clink,
      shake: [Math.sin(t * 91) * 7 * stamp, Math.cos(t * 77) * 5 * stamp],
    };
  }

  // ------------------------------------------------------------------ 時間函數（shader 與仙女棒共用，保證同步）
  private twist(t: number) { return 0.045 * (t - this.ctx.start); }
  private amp(t: number) { return 1 + 0.07 * this.ctx.audio.hit('kick', t, 0.16); }
  /** 仙女棒走到外圈花飾的哪裡（0..2π；描完是 2π）。 */
  private rosU(t: number) {
    const T = this.T;
    return TAU * prog(t, T.ros0, T.ros1, (x) => ease.inOutQuad(x) * 0.35 + x * 0.65);
  }
  private sheen(t: number) {
    const au = this.ctx.audio, T = this.T;
    const from = T.dev1 + T.P * 2;
    if (t < from) return { u: 0, k: 0 };
    const bar = au.barAt(t), b = Math.floor(bar);
    if (b % 4 !== 0) return { u: 0, k: 0 };
    const t0 = au.timeOfBar(b);
    if (t0 < from) return { u: 0, k: 0 };
    const x = (t - t0) / (T.P * 2);
    if (x >= 1) return { u: 0, k: 0 };
    return { u: TAU * ease.inOutQuad(clamp(x)), k: Math.min(1, Math.sin(Math.PI * clamp(x)) * 3) * 0.85 };
  }
  private lastKick(t: number): { t: number; k: number } {
    const ev = this.ctx.audio.events('kick', t - 0.7, t);
    const last = ev[ev.length - 1];
    return last ? { t: last[0], k: clamp(last[1]) } : { t: -99, k: 0 };
  }
  /** 戒指的旋轉（物件 → 世界）：固定斜 45°（兩只看起來一樣大），每個小節線 yaw 轉一小格。 */
  private ringRot(t: number) {
    const au = this.ctx.audio, T = this.T;
    const bar = au.barAt(Math.max(t, T.dev0));
    const b = Math.floor(bar), frac = bar - b;
    const barDur = T.P * 4;
    const k = ease.outExpo(clamp((frac * barDur) / 0.5));
    const b0 = Math.floor(au.barAt(T.dev0));
    const steps = b - b0 + k;
    // 每小節一格，但在好看的角度範圍裡來回（一直往同一邊轉，長窗格會轉到側面、變成一個 X）
    const yaw = 0.05 + 0.5 * Math.sin(steps * 0.5 - 0.8) + 0.25 * (1 - prog(t, T.dev0, T.dev1, ease.outCubic));
    // 固定的「斜 45°、微微歪」只算一次；每格只換 yaw（不要每格 new 矩陣，會場筆電的 GC 停頓看得出來）
    return this.rotM.makeRotationY(yaw).multiply(TILT);
  }
  private rotM = new THREE.Matrix4();

  /** 仙女棒的位置與亮度：先繞花飾一圈、飛到簽名欄、簽名、熄掉；之後每四小節回來繞花飾一圈。 */
  private head(t: number): { p: P2; k: number } | null {
    const lap = this.sheen(t);
    if (lap.k > 0) return { p: rosettePoint(lap.u, this.twist(t), this.amp(t)), k: Math.min(1, lap.k * 1.6) };
    return this.headIntro(t);
  }

  private headIntro(t: number): { p: P2; k: number } | null {
    const T = this.T;
    if (t < T.ros0 - 0.05) return null;
    if (t <= T.ros1) {
      const p = rosettePoint(this.rosU(t), this.twist(t), this.amp(t));
      return { p, k: prog(t, T.ros0 - 0.05, T.ros0 + 0.08) };
    }
    if (!this.msg) {
      // 沒有簽名：描完就往上飄一點、熄掉
      const k = 1 - prog(t, T.ros1, T.ros1 + 0.35);
      if (k <= 0) return null;
      const p = rosettePoint(TAU, this.twist(T.ros1), 1);
      return { p: { x: p.x, y: p.y - 30 * (1 - k) }, k };
    }
    const from = rosettePoint(TAU, this.twist(T.ros1), 1);
    const to = { x: this.sigBox.x0, y: this.sigBox.y };
    if (t < T.sig0) {
      // 飛過去：一條往上拱的弧
      const x = ease.inOutCubic(prog(t, T.ros1, T.sig0));
      const cx = lerp(from.x, to.x, 0.5), cy = Math.min(from.y, to.y) - 180;
      const a = lerp(from.x, cx, x), b = lerp(cx, to.x, x), ay = lerp(from.y, cy, x), by = lerp(cy, to.y, x);
      return { p: { x: lerp(a, b, x), y: lerp(ay, by, x) }, k: 0.8 + 0.2 * Math.cos(x * Math.PI * 2) };
    }
    if (t <= T.sig1) {
      const x = prog(t, T.sig0, T.sig1);
      const w = this.sigBox.x1 - this.sigBox.x0;
      // 筆尖上下晃（像在寫字），不是一條直線掃過去
      const wob = Math.sin(x * w * 0.11) * 16 + Math.sin(x * w * 0.047 + 1) * 8;
      return { p: { x: this.sigBox.x0 + w * x, y: this.sigBox.y + wob }, k: 1 };
    }
    const k = 1 - prog(t, T.sig1, T.sig1 + 0.3);
    return k > 0 ? { p: { x: this.sigBox.x1 + 12 * (1 - k), y: this.sigBox.y }, k } : null;
  }

  // ------------------------------------------------------------------ 微縮文字＋放大鏡＋跟唱
  private drawStrip(t: number) {
    const L = this.strip, c = L.ctx;
    L.clear();
    c.save();
    c.translate(0, -STRIP.y);
    const s = this.ctx.start;
    const fadeIn = prog(t, s + 0.1, s + 0.5);
    c.globalAlpha = fadeIn;
    const lyrics = this.ctx.lyrics;
    const ly = lyricAt(lyrics, t);
    const fallback = `${COUPLE_EN.toUpperCase()}  ·  ${DATE_DOTS}`;
    // 間奏：沒有下一句，或下一句還在 2.5 秒以後——這時放大的那行換成新人名字與日期（跟歌詞交叉淡換）
    const next = lyrics.nextLine(t);
    const interlude = !next ? 1 : prog(next.start - t, 1.8, 2.6);
    const fbA = interlude * (ly ? (t > ly.line.end ? 1 - ly.k : 0) : 1);
    // 放大的那一行：有歌詞就跟唱；沒有就放新人名字與日期（安靜的典雅字）
    const st = { family: F.archivo(100, 800), size: 66, minSize: 48, maxWidth: MAG.maxW, active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.26) };
    c.font = font(F.serif(600), 44);
    c.letterSpacing = '12px';
    const fbW = c.measureText(fallback).width;
    c.letterSpacing = '0px';
    // 放大鏡引線要指到的範圍：有歌詞用歌詞的寬，沒有就用名字日期那行的寬（兩者都淡掉時引線也跟著淡）
    let magW = fbW, magTop = MAG.base - 44;
    const magA = Math.max(ly?.k ?? 0, fbA);
    let micro = fallback;
    if (ly) {
      const lay = layoutLyric(c, ly.line, st);
      const y0 = MAG.base - (lay.height - lay.size) * 0.5;
      magW = Math.max(...lay.rows.map((r) => r.width));
      magTop = y0 - lay.size * 0.86;
      c.save();
      c.translate(MAG.x, y0);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
      micro = ly.line.text;
    }
    if (fbA > 0.001) {
      c.save();
      c.globalAlpha *= fbA;
      c.font = font(F.serif(600), 44);
      c.letterSpacing = '12px';
      c.fillStyle = rgba('sepia', 0.72);
      c.fillText(fallback, MAG.x, MAG.base - 8);
      c.restore();
    }
    // 微縮文字：同一句一直重複，其中一段被放大鏡框起來（那一段也照跟唱上色）
    c.font = font(F.mono(500), 10.5);
    c.letterSpacing = '0.6px';
    const unit = `${micro}  ✦  `;
    const uw = c.measureText(unit).width;
    const cx = MAG.x + Math.min(magW, MAG.maxW) / 2;
    const bx0 = cx - c.measureText(micro).width / 2;
    c.save();
    c.beginPath(); c.rect(MICRO.x0, MICRO.y - 14, MICRO.x1 - MICRO.x0, 20); c.clip();
    c.fillStyle = rgba('sepia', 0.62);
    for (let x = bx0 - Math.ceil((bx0 - MICRO.x0) / uw) * uw; x < MICRO.x1; x += uw) {
      if (Math.abs(x - bx0) < 1) continue;
      c.fillText(unit, x, MICRO.y);
    }
    // 被框起來的那一段
    if (ly) {
      const sung = this.sungChars(ly.line, t);
      const chars = Array.from(micro);
      let x = bx0;
      chars.forEach((ch, i) => {
        c.fillStyle = i < Math.floor(sung) ? rgba('sepia', 0.95) : i < sung ? rgba('blood') : rgba('sepia', 0.4);
        c.fillText(ch, x, MICRO.y);
        x += c.measureText(ch).width;
      });
    } else {
      c.fillStyle = rgba('sepia', 0.9);
      c.fillText(micro, bx0, MICRO.y);
    }
    // 框起來那段後面的分隔符（跟其他重複的段落一樣的節奏）
    c.fillStyle = rgba('sepia', 0.62);
    c.fillText(unit.slice(micro.length), bx0 + c.measureText(micro).width, MICRO.y);
    c.restore();
    c.letterSpacing = '0px';
    // 放大鏡的框與引線（像技術圖版的放大圖）
    const bw = c.measureText(micro).width + 10;
    const bxa = bx0 - 6, bxb = bxa + bw;
    c.strokeStyle = rgba('sepia', 0.55);
    c.lineWidth = 1;
    c.strokeRect(bxa, MICRO.y - 12.5, bw, 17);
    const lk = prog(t, s + 0.2, s + 0.8, ease.outCubic);
    c.strokeStyle = rgba('sepia', 0.4 * Math.max(0.35, magA));
    const ax = MAG.x - 14, bxm = MAG.x + magW + 14, ay = magTop - 18;
    c.beginPath();
    c.moveTo(bxa, MICRO.y + 4.5); c.lineTo(lerp(bxa, ax, lk), lerp(MICRO.y + 4.5, ay, lk));
    c.moveTo(bxb, MICRO.y + 4.5); c.lineTo(lerp(bxb, bxm, lk), lerp(MICRO.y + 4.5, ay, lk));
    c.stroke();
    // 放大圖的兩個上角：小小的 L 角標，讓「這一段被放大到這裡」一眼看得懂
    if (lk > 0.98) {
      c.strokeStyle = rgba('sepia', 0.55 * Math.max(0.35, magA));
      c.beginPath();
      c.moveTo(ax, ay + 16); c.lineTo(ax, ay); c.lineTo(ax + 16, ay);
      c.moveTo(bxm - 16, ay); c.lineTo(bxm, ay); c.lineTo(bxm, ay + 16);
      c.stroke();
    }
    // 放大圖的小標
    c.font = font(F.mono(500), 13);
    c.letterSpacing = '2.5px';
    c.fillStyle = rgba('sepia', 0.55 * lk);
    c.fillText('MICROPRINT  ×40', MAG.x, 984);
    c.font = font(F.hei(500), 14);
    c.fillText('微縮防偽文字．放大', MAG.x + 190, 984);
    c.letterSpacing = '0px';
    c.restore();
  }

  /** 這一行唱到第幾個字（含小數，以 Array.from 的字為單位）：照 Lyrics 的逐字進度，反白不會跑在歌聲前面。 */
  private sungChars(line: Line, t: number) {
    const k = Lyrics.lineCharProgress(line, t);
    const whole = Math.floor(k);
    return Array.from(line.text.slice(0, whole)).length + (k - whole);
  }
}
