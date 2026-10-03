// 照片版面共用的小工具（still、print…與 _p1～_p10 各批）。檔名 _ 開頭，不會被當成版面。
//  - photoTexture：照片做成貼圖。
//  - PhotoText：照片窗格的字。主字（賓客留言＋署名，或新人的註解）＋跟唱的歌詞，規則每個照片版面都一樣，
//    版面只決定字寫在哪裡、用什麼字族與顏色。
//  - focusCrop：往焦點推（新人在照片頁點的臉）。
import * as THREE from 'three';
import type { PhotoImage, PhotoRef } from '../photos';
import type { Msg, SceneCtx } from '../engine/scene';
import { font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { fitText, type FitResult } from '../engine/text';
import { clamp } from '../engine/util';
import { drawLyric, drawMessage, layoutLyric, lyricAt, msgChars, signature, type LyricStyle } from './_motifs';

/**
 * 照片做成貼圖：版面在 init() 裡呼叫、自己 track()（窗格結束時釋放貼圖；照片池的圖不能 close）。
 * 原樣上傳（RGBA8、sRGB 編碼），shader 自己用 toLinear() 轉線性：走 SRGB8_ALPHA8 時瀏覽器要先在 CPU 轉格式，
 * 一張 2048 的照片要好幾十毫秒，切版面會停一下。
 * ImageBitmap 不吃 flipY、畫布會吃：統一不翻，shader 照「v = 0 是照片最上面」取樣。
 * 有 mipmap：取樣一律用 textureLod（自己算 mip 層：log2(照片上的像素 ÷ 畫面上的實體像素)）。
 */
export function photoTexture(img: PhotoImage): THREE.Texture {
  const tex = new THREE.Texture(img.image as unknown as HTMLImageElement);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- 字：主字（留言或註解）＋歌詞

/**
 * 照片窗格這一格有哪些字（ENGINE.md「照片版面」的「字」）：
 *  - 主字：導演排了賓客留言（params.message）就是留言、加署名；沒有就是新人的註解；都沒有是 none。
 *    照片上也要看得到祝福：同一張照片這一輪放註解、下一輪放留言（導演決定），新留言一定插隊。
 *  - 歌詞：後台開著歌詞、這一段有歌詞就跟唱（後台關掉歌詞時引擎給空的歌詞）。
 */
export interface PhotoWords {
  kind: 'message' | 'caption' | 'none';
  /** 主字的內容（留言或註解）。 */
  text: string;
  /** 署名（「—— 小明」）：只有留言有，註解是空字串。 */
  sig: string;
  msg: Msg | null;
  /** 這個窗格有沒有歌詞要唱。 */
  lyrics: boolean;
}

export function photoWords(ctx: SceneCtx): PhotoWords {
  const msg = (ctx.params.message ?? null) as Msg | null;
  const ph = ctx.params.photo as PhotoRef | undefined;
  const lyrics = ctx.lyrics.linesIn(ctx.start, ctx.end).length > 0;
  if (msg?.text) return { kind: 'message', text: msg.text, sig: signature(msg.name), msg, lyrics };
  if (ph?.caption) return { kind: 'caption', text: ph.caption, sig: '', msg: null, lyrics };
  return { kind: 'none', text: '', sig: '', msg: null, lyrics };
}

/** 主字與署名的字型先載好（在 init() 裡 await，第一格才不會用備援字型；留言本身已經預載，署名的「——」與名字保險再載一次）。 */
export const loadWords = (ctx: SceneCtx) => { const w = photoWords(ctx); return loadText(`${w.text}${w.sig}`); };

export interface PhotoTextStyle {
  /** 主字（註解、留言）的字族。 */
  family: string;
  /** 整塊（主字＋署名＋歌詞）的寬、高上限（邏輯 px）。lyricsApart 時高度只算主字＋署名。 */
  w: number;
  h: number;
  /** 主字的字級範圍（預設 40～50）。 */
  min?: number;
  max?: number;
  /** 主字的行高（預設 1.4）與最多幾行（預設 4）。 */
  lineHeight?: number;
  maxLines?: number;
  align?: 'left' | 'center' | 'right';
  tracking?: number;
  /** 主字與唱完的歌詞的顏色；還沒唱的（預設 ink 的三成）、正在唱的（預設訊號色）。 */
  ink: string;
  unsung?: string;
  active?: string;
  /** 署名（只有留言有）：字族（預設主字的）、字級（預設 28）、顏色（預設 ink）。 */
  sigFamily?: string;
  sigSize?: number;
  sigInk?: string;
  /** 主字最後一行的下緣到署名基線的距離（預設 1.75 個署名字高；橫線紙這種要對齊線的版面自己給）。 */
  sigGap?: number;
  /** 歌詞的字族（預設主字的）。 */
  lyricFamily?: string;
  /** 歌詞的字級：沒有主字、歌詞自己當主字時（預設 48）；有主字、歌詞在下面當字幕時（預設 38）。 */
  lyricSize?: number;
  lyricSubSize?: number;
  /** 歌詞自己的顏色（唱完、還沒唱、正在唱；預設跟主字一樣）：主字寫在深色招牌、膠帶上，歌詞是螢幕上的亮字時給。 */
  lyricSung?: string;
  lyricUnsung?: string;
  lyricActive?: string;
  /** 歌詞的寬度上限（預設 w；lyricsApart 時歌詞另外放，可以比主字那塊寬，例如畫面下方的字幕）。 */
  lyricW?: number;
  /** 歌詞縮字的下限（預設字級的 0.79／0.83 倍；畫在縮放過的平面上時自己換算）。 */
  lyricMin?: number;
  /** 主字（含署名）跟歌詞之間的空（預設 0.5 個主字最大字級）。 */
  gap?: number;
  /** 字邊很淡的軟影（字直接寫在照片或暗底上才需要；紙上的字不用）。 */
  shadow?: { color: string; blur: number; dx?: number; dy?: number } | null;
  /**
   * 歌詞不跟主字排在同一塊：版面自己決定歌詞放哪（例如主字寫在相片的白邊、歌詞像字幕放在畫面下方），
   * 用 drawMain／drawLyrics 分開畫（各自一張圖層或自己清）。height 只算主字＋署名，歌詞的高度看 lyricH。
   */
  lyricsApart?: boolean;
}

/**
 * 照片窗格的字。每個照片版面都用這個（或包一層），規則才一致：
 *  - 有主字（留言或註解）：主字在上（40～50 px），留言最後一行下面是署名（26～30 px），歌詞在最下面小一號當字幕跟唱（約 38 px）。
 *    主字是焦點：留言照導演給的時間讀得完；歌詞是配角，但跟唱照常（唱完的句子留著等下一句，不會一下有字一下空白）。
 *  - 沒有主字但有歌詞：歌詞就是主字（48 px，可以折兩行，韓文歌有原文副行）。
 *  - 兩個都沒有：has = false，版面把照片移到正中間，不留空的說明欄。
 * 高度照「這個窗格裡最長的那句歌詞」預留，換句子時字不會超出預留的範圍；主字在剩下的高度裡縮字、折行。
 */
export class PhotoText {
  words: PhotoWords;
  /** 主字的排版（沒有主字是 null）。 */
  fit: FitResult | null = null;
  /** 主字的字級（沒有主字時是歌詞的字級）。 */
  size: number;
  /** 歌詞的字級與預留高度（第一排頂到最後一排基線；沒有歌詞是 0）。 */
  lyricSize = 0;
  lyricH = 0;
  /** 署名的字級與佔的高度（主字最後一行下緣到署名基線；沒有署名是 0）。 */
  sigSize = 0;
  sigH = 0;
  /** 主字跟歌詞之間的空。 */
  gap = 0;
  /** 最後畫出來的字的筆尖位置（畫布座標）：寫字的筆、火花跟著它；沒在寫、沒在唱是 null。 */
  head: { x: number; y: number } | null = null;
  private last = '';
  private lastMain = '';
  private lastLyr = '';

  constructor(private ctx: SceneCtx, c: CanvasRenderingContext2D, public st: PhotoTextStyle) {
    const w = (this.words = photoWords(ctx));
    const main = w.kind !== 'none';
    if (w.lyrics) {
      this.lyricSize = main ? st.lyricSubSize ?? 38 : st.lyricSize ?? 48;
      const ls = this.lyricStyle();
      for (const ln of ctx.lyrics.linesIn(ctx.start, ctx.end)) this.lyricH = Math.max(this.lyricH, layoutLyric(c, ln, ls).height);
    }
    this.size = main ? st.max ?? 50 : this.lyricSize;
    if (!main) return;
    this.gap = w.lyrics ? st.gap ?? Math.round((st.max ?? 50) * 0.5) : 0;
    if (w.sig) {
      this.sigSize = st.sigSize ?? 28;
      this.sigH = Math.round(st.sigGap ?? this.sigSize * 1.75);
      c.font = font(st.sigFamily ?? st.family, this.sigSize);
      this.sigWidth = c.measureText(w.sig).width;
    }
    const below = this.sigH + (w.lyrics && !st.lyricsApart ? this.gap + this.lyricH : 0);
    const min = st.min ?? 40;
    // 照畫的時候一樣的字距量（有字距時字比較寬，不設會量窄、畫出來爆框）
    c.letterSpacing = `${st.tracking ?? 0}px`;
    this.fit = fitText(c, w.text, st.family, st.w, Math.max(min * 1.05, st.h - below), { min, max: st.max ?? 50, lineHeight: st.lineHeight ?? 1.4, maxLines: st.maxLines ?? 4 });
    c.letterSpacing = '0px';
    this.size = this.fit.size;
  }

  /** 主字是什麼：留言、註解、歌詞（沒有主字、歌詞自己當主字）、都沒有。 */
  get mode(): 'message' | 'caption' | 'lyrics' | 'none' {
    return this.words.kind !== 'none' ? this.words.kind : this.words.lyrics ? 'lyrics' : 'none';
  }
  /** 有沒有任何字（沒有的話版面不留說明欄）。 */
  get has() { return this.mode !== 'none'; }
  /** 有主字（留言或註解）。 */
  get hasMain() { return !!this.fit; }
  /** 有歌詞要唱（不管是主字還是字幕）。 */
  get sung() { return this.words.lyrics; }
  /** 主字共有幾個字（逐字寫出用；沒有主字是 0）。 */
  get chars() { return this.fit ? msgChars(this.fit) : 0; }
  /** 主字＋署名的高度（頂到署名基線；沒有主字是 0）。 */
  get mainH() { return this.fit ? this.fit.height + this.sigH : 0; }
  /** 歌詞第一排的頂離整塊頂端多遠（lyricsApart 時是 0：歌詞自己一塊）。 */
  get lyricTop() { return this.fit && !this.st.lyricsApart ? this.mainH + this.gap : 0; }
  /** 整塊的高度（頂到最後一排基線）：版面用它排位置。lyricsApart 時只有主字＋署名（沒有主字時是歌詞）。 */
  get height() {
    if (!this.fit) return this.lyricH;
    return this.st.lyricsApart || !this.words.lyrics ? this.mainH : this.mainH + this.gap + this.lyricH;
  }
  /** 實際用到的寬度：主字（含署名）排出來的寬；這一塊有歌詞時用上限（句子長短不一）。 */
  get width() {
    const inBlock = this.words.lyrics && !(this.fit && this.st.lyricsApart);
    const lw = this.st.lyricW ?? this.st.w;
    return inBlock ? (this.fit ? Math.max(this.st.w, lw) : lw) : this.fit ? Math.max(this.fit.width, this.sigWidth) : 0;
  }
  /** 署名的寬（沒有署名是 0）：版面要照署名畫底線、膠帶時用。 */
  sigWidth = 0;

  lyricStyle(): LyricStyle {
    const st = this.st, main = this.words.kind !== 'none';
    const size = this.lyricSize || st.lyricSize || 48;
    return {
      // 縮字的下限跟著字級走（字層不是 1:1 的版面也一樣）：預設 38 → 30、48 → 40
      family: st.lyricFamily ?? st.family, size, minSize: st.lyricMin ?? Math.round(size * (main ? 0.79 : 0.833)), maxWidth: st.lyricW ?? st.w,
      align: st.align ?? 'left', tracking: st.tracking ?? 0, lineHeight: main ? 1.22 : st.lineHeight ?? 1.3,
      sung: st.lyricSung ?? st.ink, unsung: st.lyricUnsung ?? (st.lyricSung ? st.lyricSung.replace(/[\d.]+\)$/, '0.3)') : st.unsung ?? st.ink.replace(/[\d.]+\)$/, '0.3)')),
      active: st.lyricActive ?? st.active ?? rgba('signal'),
    };
  }

  /** 忘掉上次畫的內容，下一次 draw／drawMain／drawLyrics 一定重畫（同一張圖層上別的東西重畫、把字清掉時用）。 */
  reset() { this.last = this.lastMain = this.lastLyr = ''; }

  private mainKey(o: { chars?: number; alpha?: number }) {
    return this.fit ? `m${Math.min(o.chars ?? Infinity, 9999)}|${(o.alpha ?? 1).toFixed(3)}` : '-';
  }
  private lyricKey(t: number, alpha = 1) {
    if (!this.words.lyrics) return '-';
    const ly = lyricAt(this.ctx.lyrics, t, 6);
    if (!ly) return 'x';
    // 句子還在唱（或淡入淡出）時每格重畫；唱完停著的時候不用
    const busy = t < ly.line.end + 0.05 || ly.k < 1;
    return `l${ly.line.start}|${busy ? t.toFixed(3) : 'hold'}|${alpha.toFixed(3)}`;
  }

  /**
   * 整塊畫在 (x, top)：x 是對齊點（靠左＝左緣、置中＝中線、靠右＝右緣），top 是第一行的頂。
   * chars：主字逐字寫出（Infinity = 全部；署名在主字寫完才出現）。lyricAlpha：歌詞自己的透明度（預設跟 alpha 一樣）。
   * 內容沒變就不畫、回傳 false（版面據此決定要不要 upload）；要重畫時先呼叫 clear。
   */
  draw(c: CanvasRenderingContext2D, t: number, x: number, top: number, o: { chars?: number; alpha?: number; lyricAlpha?: number; clear?: () => void } = {}): boolean {
    const apart = !!(this.fit && this.st.lyricsApart);
    const key = `${this.mainKey(o)}#${apart ? '' : this.lyricKey(t, o.lyricAlpha ?? o.alpha)}`;
    if (key === this.last) return false;
    this.last = key;
    o.clear?.();
    this.head = null;
    const mh = this.paintMain(c, x, top, o);
    const lh = apart ? null : this.paintLyrics(c, t, x, top + this.lyricTop, o.lyricAlpha ?? o.alpha ?? 1);
    this.head = mh ?? lh;
    return true;
  }

  /** 只畫主字＋署名（lyricsApart 的版面用；自己一張圖層，或自己清）。 */
  drawMain(c: CanvasRenderingContext2D, x: number, top: number, o: { chars?: number; alpha?: number; clear?: () => void } = {}): boolean {
    const key = this.mainKey(o);
    if (key === this.lastMain) return false;
    this.lastMain = key;
    o.clear?.();
    this.head = this.paintMain(c, x, top, o);
    return true;
  }

  /** 只畫歌詞（lyricsApart 的版面用）：(x, top) 是歌詞第一排的頂。 */
  drawLyrics(c: CanvasRenderingContext2D, t: number, x: number, top: number, o: { alpha?: number; clear?: () => void } = {}): boolean {
    const key = this.lyricKey(t, o.alpha);
    if (key === this.lastLyr) return false;
    this.lastLyr = key;
    o.clear?.();
    const h = this.paintLyrics(c, t, x, top, o.alpha ?? 1);
    if (!this.fit) this.head = h;
    return true;
  }

  private paintMain(c: CanvasRenderingContext2D, x: number, top: number, o: { chars?: number; alpha?: number }): { x: number; y: number } | null {
    const fit = this.fit;
    if (!fit) return null;
    const st = this.st, alpha = o.alpha ?? 1;
    const chars = o.chars ?? Infinity;
    c.save();
    c.globalAlpha = alpha;
    if (st.shadow) setShadow(c, st.shadow);
    c.letterSpacing = `${st.tracking ?? 0}px`;
    const head = drawMessage(c, fit, st.family, x, top + fit.size * 0.9, { align: st.align ?? 'left', color: st.ink, chars });
    c.letterSpacing = '0px';
    if (this.words.sig && chars >= this.chars) {
      c.font = font(st.sigFamily ?? st.family, this.sigSize);
      c.textAlign = st.align ?? 'left';
      c.textBaseline = 'alphabetic';
      c.fillStyle = st.sigInk ?? st.ink;
      c.fillText(this.words.sig, x, top + fit.height + this.sigH - this.sigSize * 0.12);
      c.textAlign = 'left';
    }
    c.restore();
    return chars < this.chars ? head : null;
  }

  private paintLyrics(c: CanvasRenderingContext2D, t: number, x: number, top: number, alpha: number): { x: number; y: number } | null {
    if (!this.words.lyrics) return null;
    const ly = lyricAt(this.ctx.lyrics, t, 6);
    if (!ly) return null;
    const ls = this.lyricStyle();
    const lay = layoutLyric(c, ly.line, ls);
    c.save();
    if (this.st.shadow) setShadow(c, this.st.shadow);
    const by = top + lay.size * 0.9;
    c.translate(x, by);
    const hd = drawLyric(c, ly.line, t, ls, lay, ly.k * alpha);
    c.restore();
    return hd ? { x: hd.x + x, y: hd.y + by } : null;
  }
}

/** 字的軟影（dx、dy 給了就是字幕機那種有位移的硬影）。呼叫的人在 save()／restore() 裡用。 */
function setShadow(c: CanvasRenderingContext2D, sh: { color: string; blur: number; dx?: number; dy?: number }) {
  c.shadowColor = sh.color; c.shadowBlur = sh.blur; c.shadowOffsetX = sh.dx ?? 0; c.shadowOffsetY = sh.dy ?? 0;
}

// ---------------------------------------------------------------- 焦點

/**
 * 往焦點推（ENGINE.md「焦點」）：照片在框裡要看哪一塊 [x0, y0, x1, y1]（0..1，左上原點）。
 * 焦點是新人在照片頁點的地方（通常是臉，沒設定時 (0.5, 0.4)）：新人特地點了，畫面上就要看得出來——
 * 鏡頭慢慢往那裡推，臉越來越大、越來越靠近框的中間，而且永遠不會被裁出去。
 *  - aspect：框的寬高比。照片比框寬（或高）時先繞著焦點裁成框的比例；框跟照片同比例（完整放）時 k = 0 看到整張。
 *  - k：0..1 推到哪裡（版面給 settle(lt) 這種一開始快、越來越慢的進度）。k = 1 放大到 zoom 倍。
 *  - zoom：推到最後放大幾倍（預設 1.25；畫在實體相片上、相框裡的可以小一點，螢幕、投影、滿版的可以大一點）。
 *  - screenW：框在畫面上的寬（邏輯 px）：給了就照「照片上一個像素最多放大成 maxUp（預設 1.5）個畫面像素」少推，很小的舊照片才不會推糊。
 *  - reverse：反過來，從臉的特寫拉遠到整張（開場先看臉）。
 */
export function focusCrop(ph: { fx: number; fy: number }, imgW: number, imgH: number, aspect: number, k: number,
  o: { zoom?: number; screenW?: number; maxUp?: number; reverse?: boolean } = {}): [number, number, number, number] {
  const ia = imgW / Math.max(1, imgH);
  let fw = 1, fh = 1;
  if (aspect > ia) fh = ia / aspect; else fw = aspect / ia;
  let z = o.zoom ?? 1.25;
  if (o.screenW) z = Math.min(z, Math.max(1.06, ((o.maxUp ?? 1.5) * fw * imgW) / o.screenW));
  const e = clamp(o.reverse ? 1 - k : k);
  const zz = 1 + (z - 1) * e;
  const w = fw / zz, h = fh / zz;
  // 中心就是焦點，只是不能超出照片：剛開始框幾乎等於整張，中心被擠在中間；越推越近、框越小，中心就越靠近焦點
  const cx = clamp(ph.fx, w / 2, 1 - w / 2), cy = clamp(ph.fy, h / 2, 1 - h / 2);
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

/** 焦點落在框裡的哪裡（0..1，框的左上原點）：crop 是 focusCrop 的結果。鏡頭要對著臉推的版面用（框在畫面上的位置＋這個）。 */
export const focusIn = (ph: { fx: number; fy: number }, crop: readonly number[]): [number, number] =>
  [(ph.fx - crop[0]!) / Math.max(1e-6, crop[2]! - crop[0]!), (ph.fy - crop[1]!) / Math.max(1e-6, crop[3]! - crop[1]!)];

/** 一開始快、之後越來越慢的進度（0..1）：慢推、焦點都用這個，窗格 3～16 秒都好看。 */
export const settleK = (lt: number, tau = 6) => 1 - Math.exp(-Math.max(0, lt) / tau);
