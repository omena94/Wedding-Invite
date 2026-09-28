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
// 歌詞：寫在鈔票下方的桌面上（跟桌面同一個平面、一樣吃光），照跟唱規則逐字亮。
// 沒有主打留言：鈔票是一張「樣張」——祝福欄寫著邀請，花飾描完那一拍蓋上訊號色的「樣張 SPECIMEN」。
//
// MV 融合原則（2026-09-28 檢修）：鈔票是擺在桌上的一張真的紙——鏡頭斜斜地看（上緣遠、左邊近）、暖色主光從左上來、
// 影子落在右下；切進來時鏡頭從遠一點、斜一點的位置一下子推到定位，之後整個窗格很慢地繞、慢慢推近。
// 配角砍掉一半以上：只留行名（小）、一行冷面小字與序號、簽名欄，徽章外圈只留一行弧形字；總裁簽名、英文副標、微縮字、放大鏡圖解都拿掉，
// 留言是整張紙上唯一的大字。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { Layer2D, makeRT, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_EN, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { INNER, MED, ARC_R, rosettePoint, makeBakePass, makeMainPass } from './banknote-art';

type P2 = { x: number; y: number };
/** 主打留言的框（雕版大字，平面座標）。右邊留給安全線與徽章。上面的抬頭縮小了，框往上長。 */
const HERO = { x: 198, y: 272, w: 900, h: 312 };
/** 簽名欄（祝福人）。 */
const SIG = { x: 198, base: 668, w: 440, rule: 680 };
/** 桌面上的歌詞（平面座標）：鈔票下緣之下，左邊對齊留言。 */
const LYR = { x: 190, base: 930, maxW: 1060 };
/** 歌詞只畫在這一條（平面座標），shader 照鏡頭取樣。 */
const STRIP = { y: 826, h: 150 };
/** 鏡頭的焦距（px）：跟「距離」一樣時，對準的那一點是 1:1。 */
const CAM_F = 1800;

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
  strip = this.track(new Layer2D(W, STRIP.h, undefined, { fast: true }));
  glow = this.track(new LineBatch(3072, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  /** 時間表（秒）。 */
  T = { P: 0.5, b0: 0, ros0: 0, ros1: 0, dev0: 0, dev1: 0, sig0: 0, sig1: 0, stamp: -1, span: 1, frame1: 0, printEnd: 0 };
  /** 簽名的位置（仙女棒沿著它寫）。 */
  sigBox = { x0: 0, x1: 0, y: 0 };
  heroPeriod = 4;
  seed = 1;
  /** 歌詞字級：有留言時比留言小一級（≥ 48），沒有留言時歌詞是焦點。 */
  lyrSize = 60;
  /** 鏡頭：平面座標 → 螢幕的單應矩陣與它的反矩陣（每格算一次）。 */
  camM = new THREE.Matrix3();
  camInv = new THREE.Matrix3();

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
    await loadText(`愛情準備銀行憑票即付祝福壹則祝福人新人簽名處樣張把你的祝福印上下一張鈔票掃描右下角寫下幾秒後就會在大螢幕${COUPLE_ZH}${m ? m.text + m.name : ''}一位賓客∞０１２３４５６７８９`);

    // ---- 排留言（雕版大字，思源宋體）
    const c = this.mask.ctx;
    const heroFam = F.ming(700);
    if (m) {
      this.fit = fitText(c, m.text, heroFam, HERO.w, HERO.h, { min: 48, max: 136, lineHeight: 1.3, maxLines: 4 });
    } else {
      // 邀請的斷行自己決定（「印上」不能拆開）：第一行短，右邊空出來蓋「樣張」印章。
      // 沒有留言時焦點是歌詞，邀請比歌詞小一點
      const inv = ['把你的祝福，', '印上下一張鈔票'];
      c.font = font(heroFam, 100);
      const size = Math.min(58, Math.floor((100 * HERO.w * 0.8) / Math.max(...inv.map((l) => c.measureText(l).width))));
      this.fit = { size, lines: inv, lineHeight: size * 1.3, width: 0, height: size * 2.3 };
    }
    const fit = this.fit;
    this.lyrSize = m ? clamp(Math.round(fit.size * 0.7), 48, 58) : 68;
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
    // 面額 ∞ 只留左上一個、縮小；行名縮到比留言小兩級（不要搶焦點），底下一行冷面小字
    text('∞', INNER.x0 + 40, INNER.y0 + 98, F.serif(600), 92, 'eng', q(0));
    text('愛情準備銀行', 330, 190, F.ming(900), 36, 'plain', q(0), { track: 12 });
    text('憑票即付　祝福壹則', 332, 224, F.hei(500), 17, 'plain', q(1), { track: 6 });
    // 徽章外圈只留一行弧形字（花飾本身已經夠華麗）
    this.arcText(c, 'LOVE RESERVE NOTE', ARC_R, F.serif(600), 26, 0.2, 'top', ink('plain', q(1)));
    // 簽名欄的線與標籤
    c.fillStyle = ink('plain', q(3));
    c.fillRect(SIG.x, SIG.rule, SIG.w, 1.4);
    text(m ? (m.couple ? '新人　FROM THE COUPLE' : '祝福人') : '簽名處', SIG.x, SIG.rule + 22, F.hei(500), 14, 'plain', q(3), { track: 3 });

    // 主打留言：一拍一行、一個字一個字壓上去（愛心用點綴色）
    const top = HERO.y + (HERO.h - fit.height) / 2 + fit.size * 0.9;
    const heroY = m ? top : HERO.y + fit.size * 0.95 + 24;
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
      const y = heroY + (fit.lines.length - 1) * fit.lineHeight + 62;
      text('掃描右下角 QR code，寫下祝福，', HERO.x, y, F.hei(500), 24, 'plain', beat(fit.lines.length), { track: 2 });
      text('幾秒後就會印在大螢幕上。', HERO.x, y + 38, F.hei(500), 24, 'plain', beat(fit.lines.length) + P / 2, { track: 2 });
    }
    // 序號最後六位：留言編號（沒有留言：這首歌的編號，前面加星號——補發的「星號券」）
    const num = m ? String(m.n).padStart(6, '0') : `★${String(this.ctx.song.index).padStart(5, '0')}`;
    // 整串靠右對齊在留言框的右緣（不要壓到金屬帶）：前綴跟固定的字一起印，號碼一格一格打上去
    c.font = font(F.mono(500), 20);
    // 照每個字的實際寬度排（★ 比數字寬，用固定字寬會壓到下一個數字）
    const cw = Array.from(num).map((ch) => c.measureText(ch).width);
    const serX = HERO.x + HERO.w - cw.reduce((x, w) => x + w, 0);
    text('AO 20270313', serX - 12, 224, F.mono(500), 20, 'acc', q(2), { align: 'right' });
    c.font = font(F.mono(500), 20);
    let sx = serX;
    Array.from(num).forEach((ch, i) => {
      c.fillStyle = ink('acc', serT0 + i * (P / 4));
      c.fillText(ch, sx, 224);
      sx += cw[i]!;
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
    if (!m) this.specimen(c, ink('acc', T.stamp), HERO.x + 690, heroY + fit.size * 0.25);
    // 字全部排好：先上傳（避免窗格第一格卡頓）
    await yieldFrame();
    this.mask.upload();
    this.ctx.renderer.initTexture(this.mask.texture);
    this.ensureBake();
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
  private specimen(c: CanvasRenderingContext2D, fill: string, x: number, y: number) {
    c.save();
    // 蓋在邀請第一行右邊的空白（第一行比較短），不要壓到要讀的字
    c.translate(x, y);
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
    const { renderer, audio: au } = this.ctx;
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
    // 鏡頭：平面 → 螢幕（shader 用反矩陣把每個像素換回平面座標）
    this.camera(t);
    (u.uInv!.value as THREE.Matrix3).copy(this.camInv);
    // 桌面上的歌詞：畫在平面座標的一條上，shader 照鏡頭取樣（跟桌面一起透視、一起吃光）
    this.drawStrip(t);
    u.uLyr!.value = this.strip.upload();
    (u.uLyrY!.value as THREE.Vector2).set(STRIP.y, STRIP.h);
    this.main.render(renderer, out);

    // ---- 仙女棒（在平面上走，換成螢幕座標再畫）
    this.glow.clear();
    if (head) {
      const hp = this.toScreen(head.p);
      sparkParticles(this.glow, t, (tb) => { const q = this.head(tb); return q ? this.toScreen(q.p) : null; }, { rate: 120, life: 0.42, speed: 250, seed: this.seed, intensity: 1.1, width: 1.8 });
      sparkHead(this.glow, hp.x, hp.y, t, 1.15, head.k);
    }
    if (this.glow.count) this.glow.render(renderer, out);

    // 推鏡由鏡頭自己做；這裡只留最後一拍加速推進切走、大鼓輕輕一下
    const zoom = 1 + 0.022 * prog(t, e - P, e, ease.inCubic) + 0.004 * f.a.kick;
    const stamp = T.stamp > 0 ? pulse(t, T.stamp, 0.07) : 0;
    const clink = pulse(t, T.dev0, 0.08);
    return {
      paper: 1, bloom: 0.55, bloomThreshold: 0.98, bloomKnee: 0.12, halation: 0.12, vignette: 0.34, grain: 0.05,
      zoom, flash: 0.05 * stamp + 0.03 * clink,
      shake: [Math.sin(t * 91) * 7 * stamp, Math.cos(t * 77) * 5 * stamp],
    };
  }

  // ------------------------------------------------------------------ 鏡頭
  /**
   * 一台針孔相機看著桌面（平面座標 = 版面座標，y 向下）：上緣離鏡頭遠（傾斜）、左邊（留言那側）近一點、紙在桌上微微斜放。
   * 切進來的一拍多從遠一點、斜一點的位置一下子推到定位（outExpo），之後整個窗格很慢地繞、慢慢推近。
   * 算出平面 → 螢幕的單應矩陣 camM 與反矩陣 camInv。
   */
  private camera(t: number) {
    const { start: s, end: e } = this.ctx, P = this.T.P;
    const k = 1 - ease.outExpo(prog(t, s, s + clamp(P * 2, 0.7, 1.3)));
    const w = clamp((t - s) / Math.max(1e-3, e - s));
    const rx = 0.2 + 0.08 * k;
    const ry = 0.075 - 0.035 * w + 0.06 * k;
    const rz = -0.018 + 0.01 * w - 0.02 * k;
    // 鏡頭對準的平面點（留言與徽章之間偏左），與距離（慢推：越來越近）
    const cx = 905 + 70 * k - 30 * w, cy = 540 - 16 * k;
    const D = CAM_F * (1 + 0.12 * k - 0.035 * w);
    const cX = Math.cos(rx), sX = Math.sin(rx), cY = Math.cos(ry), sY = Math.sin(ry), cZ = Math.cos(rz), sZ = Math.sin(rz);
    // R = Rz·Ry·Rx 作用在平面的兩個軸上：r1 = R·x̂，r2 = R·ŷ（Rx 把 ŷ 轉成 (0, cX, −sX)：上緣往遠處倒）
    const r1 = [cY * cZ, cY * sZ, sY];
    const a = sX * sY, b = cX, c = -sX * cY;
    const r2 = [a * cZ - b * sZ, a * sZ + b * cZ, c];
    const f = CAM_F, X0 = W / 2, Y0 = H / 2;
    // A：(u, v, 1) → 齊次螢幕座標；再把平面座標平移到對準點（u = x − cx）
    const A = [
      [f * r1[0]! + X0 * r1[2]!, f * r2[0]! + X0 * r2[2]!, X0 * D],
      [f * r1[1]! + Y0 * r1[2]!, f * r2[1]! + Y0 * r2[2]!, Y0 * D],
      [r1[2]!, r2[2]!, D],
    ];
    const m = A.map((r) => [r[0]!, r[1]!, r[2]! - cx * r[0]! - cy * r[1]!]);
    this.camM.set(m[0]![0]!, m[0]![1]!, m[0]![2]!, m[1]![0]!, m[1]![1]!, m[1]![2]!, m[2]![0]!, m[2]![1]!, m[2]![2]!);
    this.camInv.copy(this.camM).invert();
  }

  /** 平面座標 → 這一格的螢幕座標。 */
  private toScreen(p: P2): P2 {
    const e = this.camM.elements;
    const w = e[2]! * p.x + e[5]! * p.y + e[8]!;
    return { x: (e[0]! * p.x + e[3]! * p.y + e[6]!) / w, y: (e[1]! * p.x + e[4]! * p.y + e[7]!) / w };
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

  // ------------------------------------------------------------------ 桌面上的歌詞
  private drawStrip(t: number) {
    const L = this.strip, c = L.ctx;
    L.clear();
    c.save();
    c.translate(0, -STRIP.y);
    const s = this.ctx.start;
    c.globalAlpha = prog(t, s + 0.1, s + 0.5);
    const lyrics = this.ctx.lyrics;
    const ly = lyricAt(lyrics, t);
    // 間奏：沒有下一句，或下一句還在 2.5 秒以後——這時換成新人名字與日期（安靜的典雅字，跟歌詞交叉淡換）
    const next = lyrics.nextLine(t);
    const interlude = !next ? 1 : prog(next.start - t, 1.8, 2.6);
    const fbA = interlude * (ly ? (t > ly.line.end ? 1 - ly.k : 0) : 1);
    if (ly) {
      const st = { family: F.archivo(100, 800), size: this.lyrSize, minSize: 48, maxWidth: LYR.maxW, active: rgba('blood'), sung: rgba('sepia', 0.92), unsung: rgba('sepia', 0.26) };
      const lay = layoutLyric(c, ly.line, st);
      // 折成兩行時第一行往上長，最後一行的基線固定
      c.save();
      c.translate(LYR.x, LYR.base - (lay.height - lay.size));
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    }
    if (fbA > 0.001) {
      c.save();
      c.globalAlpha *= fbA;
      c.font = font(F.serif(600), 36);
      c.letterSpacing = '10px';
      c.fillStyle = rgba('sepia', 0.6);
      c.fillText(`${COUPLE_EN.toUpperCase()}  ·  ${DATE_DOTS}`, LYR.x, LYR.base - 6);
      c.restore();
    }
    c.restore();
  }
}
