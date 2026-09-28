// 祝福登記表（亮版面）：照 pdoom 的 bureau（FIG. 7「Paperwork」）改的。一張擺在桌上的表格，鏡頭貼著打字機走：
//  - 第一個拍點起，號碼機「喀」一聲在表頭蓋上編號，登記人（留言的名字）一個字一個八分音符打上去；
//    下一拍開始打祝福內容（逐字、落在十六／三十二分音符上），鏡頭跟著打字頭走、換行時甩回左邊。
//  - 打完的下一拍，「以上皆是」被紅筆「刷」地勾起來、再圈一圈；接著簽名欄手寫簽名；中段每兩小節換一次鏡位。
//  - 留言沒填滿三行，下一行打「（以下空白）」。
//  - 最後一個大拍點（窗格結束前的最後一個小節線）：訊號色的方章「百年好合」砸在「核准章」框裡——稍微歪、稍微超出框線，
//    鏡頭同時拉到全景（看得到紙緣與桌面）、畫面震一下。
//  - 歌詞在「現場歌詞」欄，照跟唱規則：還沒唱的字三成淡淡地先出現、唱到的那一刻打上去（訊號色）、唱完變成墨色。
//  - 沒有留言：登記人是「歌手（代唱）」，祝福內容欄改由歌詞一句一句打上去；純音樂又沒留言：打一句邀請大家掃 QR。
// MV 融合原則（2026-09-28）：打上去的祝福內容是整張紙上最大、最黑的字（焦點）；歌詞小一級；印刷的表格只剩細線、淡墨小字。
// 畫法（照 bureau）：所有的墨畫在一張 Canvas2D 上、用色版分開（R 打字、G 印刷、B 印泥），紙張 shader 再把它們
// 疊印到程序生成的紙上（纖維、印章缺墨、Beer–Lambert），所以顏色全部來自色票、換主題整張跟著變。
// 鏡頭是一個 2D 仿射（紙面 → 螢幕），推近時也保證歌詞與留言不會跑進右下角 QR 區、離邊 96 px 以上（見 CAM_* 的註解）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { wrap } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { clamp, ease, lerp, prog, hash, pulse, frameIdx } from '../engine/util';
import { lyricAt, beatAfter, barAfter, COUPLE_ZH } from './_motifs';
import { PAPER_FRAG, BAKE_FRAG, BAKE, FORM_BOX, FORM_RES } from './certificate-glsl';
import { L, TYPE, PRINT, SIG, drawForm, makeCopy, FORM_TEXT, type FormCopy } from './certificate-form';

type Ctx2 = CanvasRenderingContext2D;
/** 鏡頭：紙面上的 (x, y) 放在螢幕中央，縮放 z、旋轉 r。 */
interface Cam { x: number; y: number; z: number; r: number }
type Xf = { a: number; b: number; c: number; d: number; e: number; f: number };

/** 紙面 → 螢幕的仿射（含震動）。 */
function camXf(cam: Cam, shx = 0, shy = 0): Xf {
  const cs = Math.cos(cam.r) * cam.z, sn = Math.sin(cam.r) * cam.z;
  const a = cs, b = sn, c = -sn, d = cs;
  return { a, b, c, d, e: W / 2 + shx - (a * cam.x + c * cam.y), f: H / 2 + shy - (b * cam.x + d * cam.y) };
}
function invXf(m: Xf): Xf {
  const det = m.a * m.d - m.b * m.c;
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  return { a: ia, b: ib, c: ic, d: id, e: -(ia * m.e + ic * m.f), f: -(ib * m.e + id * m.f) };
}
const apply = (m: Xf, x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
const lerpCam = (p: Cam, q: Cam, k: number): Cam => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k), z: Math.exp(lerp(Math.log(p.z), Math.log(q.z), k)), r: lerp(p.r, q.r, k) });

// 取景（紙面座標，見 certificate-form.ts 的 L）。每個取景都算過：該讀的字（歌詞、留言、簽名）在螢幕上離邊 ≥ 96 px，
// 不會落進右下角 QR 區（x ≥ 1360 且 y ≥ 830）。主欄 x 196～1270，置中在 733。
/** 切進來的那一格：比第一個鏡位再近一點、歪一點，0.75 秒內落定（pdoom 的 settle）。推近時字也還在安全範圍內。 */
const startOf = (c: Cam): Cam => ({ x: c.x + 20, y: c.y - 20, z: c.z * 1.06, r: c.r - 0.025 });
/** 打名字：登記人＋現場歌詞兩欄（歌詞第二行的下緣約在螢幕 y 690）。 */
const CAM_NAME: Cam = { x: 733, y: 350, z: 1.45, r: -0.03 };
/**
 * 打祝福內容：歌詞欄與祝福內容欄一起入鏡（歌詞在上面照樣跟唱）。
 * y 620、z 1.22：祝福內容第三行的下緣在螢幕 y ≈ 812（右端 x ≈ 1620，不能碰 QR 區的 830）、歌詞頂端 y ≈ 184。
 * x 只能跟著打字頭輕輕晃 ±8。
 */
const CAM_TYPE = { z: 1.22, r: -0.016, x: 733, sway: 8, y0: 620 };
/** 看整張（勾選、簽名、方章框都在裡面）。 */
const CAM_REVIEW: Cam = { x: 960, y: 575, z: 1.06, r: -0.012 };
/** 長窗格的中段：在「看整張」與「看留言」之間，每兩小節換一次。 */
const CAM_MSG: Cam = { x: 745, y: 620, z: 1.2, r: -0.024 };
/** 蓋章：全景（四周露出一點桌面，紙是擺在桌上的一張實物）。 */
const CAM_WIDE: Cam = { x: 960, y: 540, z: 0.965, r: -0.008 };

const PAPER = () => new FSPass(PAPER_FRAG, {
  inkTex: { value: null }, roseTex: { value: null }, bakeTex: { value: null }, formTex: { value: null }, roseOn: { value: 0 },
  camA: { value: new THREE.Vector3() }, camB: { value: new THREE.Vector3() },
  blurV: { value: new THREE.Vector2() }, dofR: { value: 0 },
  st0: { value: new THREE.Vector4() }, st0b: { value: new THREE.Vector4() },
});

/** 紙的紋理只烤一次（整晚共用；只存明暗不存顏色，換主題不用重烤）。 */
const BAKED = () => ({
  rt: makeRT(BAKE.w, BAKE.h, { pxScale: 1, type: THREE.UnsignedByteType, depthBuffer: false }),
  pass: new FSPass(BAKE_FRAG),
  done: false,
});


/** 打字機打上去的一個字。ws/we：歌詞的字所屬那個詞的開始／結束（決定訊號色或墨色）。 */
interface TChar { ch: string; x: number; y: number; row: number; t: number; dens: number; jx: number; jy: number; rot: number; ws: number; we: number }
/**
 * 打好的字的「底片」：一塊字的每個字（含抖動、旋轉、墨色濃淡）先畫在一張畫布上，一行一條、上下不重疊。
 * 每格只要把「已經打好的那一段」drawImage 過去——大字逐字 fillText（還要逐字旋轉）一格要四五毫秒，內顯吃不消。
 */
interface Sprite { cv: HTMLCanvasElement; x0: number; band: number; top: number }
interface Block { chars: TChar[]; family: string; size: number; rows: number; sprite?: Sprite | null }
interface Shot { t0: number; t1: number; e: (x: number) => number; cam: (t: number) => Cam }

/** text 用這個字級、在 maxW 寬裡斷行，是否不超過 rows 行。 */
function fits(c: Ctx2, text: string, family: string, size: number, maxW: number, rows: number) {
  c.font = font(family, size);
  return wrap(c, text, maxW).length <= rows;
}
/** 在 min～max 之間找最大字級，讓 text 在 maxW 寬裡斷成不超過 rows 行（放不下就回傳 min）。 */
function fitRows(c: Ctx2, text: string, family: string, maxW: number, rows: number, max: number, min: number) {
  for (let s = max; s > min; s -= 2) if (fits(c, text, family, s, maxW, rows)) return s;
  return min;
}
/** 同 fitRows，但縮到 min 還放不下時再往下縮到 floor：字小一點總比壓到下一欄好（極少數超長的句子）。 */
function fitRowsOr(c: Ctx2, text: string, family: string, maxW: number, rows: number, max: number, min: number, floor: number) {
  const s = fitRows(c, text, family, maxW, rows, max, min);
  return s > min || fits(c, text, family, s, maxW, rows) ? s : fitRows(c, text, family, maxW, rows, min, floor);
}

/**
 * 把字排進印好的橫線上（基線固定：打字機只能打在線上），回傳每個字的位置。時間之後再填。
 * 每個字有一點點位移、旋轉、墨色濃淡（打字機的字不會完全整齊，這是它像真的的原因）。
 */
function typeset(c: Ctx2, text: string, family: string, size: number, x0: number, rows: readonly number[], maxW: number, seed: number): Block {
  c.font = font(family, size);
  const lines = wrap(c, text, maxW);
  const pitch = rows.length > 1 ? rows[1]! - rows[0]! : size * 1.3;
  const chars: TChar[] = [];
  let cursor = 0;
  lines.forEach((ln, ri) => {
    const at = text.indexOf(ln, cursor);
    const base = at >= 0 ? at : cursor;
    cursor = base + ln.length;
    const lay = layout(ln, family, size);
    const y = ri < rows.length ? rows[ri]! : rows[rows.length - 1]! + (ri - rows.length + 1) * pitch;
    let o = base;
    for (const g of lay.glyphs) {
      chars.push({
        // ws 先暫放這個字在原文的位置（UTF-16），歌詞排時間時用（lyricBlock 會換成那個詞開始唱的時間）
        ch: g.ch, x: x0 + g.x, y, row: ri, t: 0, ws: o, we: 0,
        dens: 0.8 + 0.2 * hash(seed, o, 1), jx: (hash(seed, o, 2) - 0.5) * 1.6, jy: (hash(seed, o, 3) - 0.5) * 2.2, rot: (hash(seed, o, 17) - 0.5) * 0.022,
      });
      o += g.ch.length;
    }
  });
  return { chars, family, size, rows: lines.length };
}

/** 底片的解析度（紙面 px 的倍數）：鏡頭最近約 1.55 倍，1.6 倍就還是銳利的。 */
const SPR_RES = 1.6;
/** 把一塊字畫成底片（空白與愛心不畫：愛心印在玫瑰色那一層，逐字畫）。字型要先載好。 */
function makeSprite(b: Block): Sprite | null {
  const cs = b.chars.filter((ch) => ch.ch !== ' ' && ch.ch !== '♥');
  if (!cs.length) return null;
  const x0 = Math.min(...cs.map((ch) => ch.x)) - b.size * 0.3, x1 = Math.max(...cs.map((ch) => ch.x)) + b.size * 1.3;
  const top = b.size * 1.2, band = b.size * 1.65;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((x1 - x0) * SPR_RES); cv.height = Math.ceil(band * b.rows * SPR_RES);
  const c = cv.getContext('2d')!;
  c.setTransform(SPR_RES, 0, 0, SPR_RES, -x0 * SPR_RES, 0);
  c.font = font(b.family, b.size);
  c.textBaseline = 'alphabetic';
  for (const ch of cs) {
    c.save();
    c.translate(ch.x + ch.jx, ch.row * band + top + ch.jy);
    c.rotate(ch.rot);
    c.fillStyle = TYPE(ch.dens);
    c.fillText(ch.ch, 0, 0);
    c.restore();
  }
  return { cv, x0, band, top };
}

const pad = (n: number, k: number) => String(Math.max(0, Math.floor(n))).padStart(k, '0');

export default class Certificate extends Scene {
  ink = this.track(new Layer2D());
  /** 愛心用點綴色（玫瑰）印：只有打的字裡有 ♥ 才建這一張（多一張上傳）。 */
  rose: Layer2D | null = null;
  paper = shared('certificate.paper', PAPER);
  bake = shared('certificate.bake', BAKED);
  /**
   * 印好的表格每格都一樣：開場時先畫在一張紙面座標的畫布上（1.5 倍解析度，鏡頭推到 1.45 倍時字還是銳利的），
   * 上傳成貼圖一次，紙張 shader 直接取樣。逐格重畫（或 drawImage 進墨的畫布）要好幾毫秒，內顯筆電吃不消。
   */
  form: HTMLCanvasElement | null = null;
  formTex: THREE.CanvasTexture | null = null;
  msg: Msg | null = this.ctx.params.message ?? null;
  mode: 'msg' | 'lyric' | 'invite' = 'msg';
  seed = Number(this.ctx.params.seed ?? 1);
  copy!: FormCopy;

  name!: Block;
  /** 祝福內容（留言或邀請）；歌詞模式是 null（內容欄由歌詞即時打）。 */
  body: Block | null = null;
  /** 歌詞模式：第 2 欄打歌名。 */
  title: Block | null = null;
  /** 留言沒填滿三行時，下一行打「以下空白」（公文的老規矩：後面不能再加字）。 */
  blank: Block | null = null;
  sigText = '';
  sigSize = 56;
  sigFamily = F.hand(700);
  lyricCache = new Map<Line, Block>();

  // 時間點
  B = 0.5;
  tNum = 0; tType0 = 0; typeEnd = 0;
  tTick = 0; tCircle = Infinity; tSig = Infinity; sigEnd = Infinity; tSeal = 0;
  sealRot = -0.085; sealDx = 0; sealDy = 0;
  shots: Shot[] = [];
  camStart: Cam = startOf(CAM_NAME);

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const msg = this.msg;
    // 墨的畫布是不透明的（黑底 + lighter）：預乘與否一樣，標成預乘、不轉色彩空間，瀏覽器就走 GPU 直接複製（見 gl.ts 的 fast）
    this.ink.texture.colorSpace = THREE.NoColorSpace;
    this.ink.texture.premultiplyAlpha = true;
    this.mode = msg ? 'msg' : lyrics.has ? 'lyric' : 'invite';
    const songName = song.title ? `《${song.title}》${song.artist ? ' — ' + song.artist : ''}` : '今晚的歌';
    this.copy = makeCopy(this.seed, {
      no: msg ? `No.${pad(msg.n, 3)}` : `SONG ${pad(song.index, 2)}`, couple: !!msg?.couple,
      // 有留言：第 2 欄是現場歌詞；沒有留言：第 2 欄打歌名，內容欄由歌手「代唱」
      field2: msg ? '現場歌詞' : '播放歌曲',
    });
    // 新人自己的留言：名字後面打「（新人）」（打字機打上去的字，不是另外貼一個標籤）
    const nameText = msg ? (msg.couple ? `${COUPLE_ZH}（新人）` : msg.name || '一位不願具名的賓客') : lyrics.has ? `${song.artist || '今晚的歌手'}（代唱）` : '全體賓客';
    this.sigText = msg ? (msg.couple ? COUPLE_ZH : msg.name || '一位賓客') : lyrics.has ? song.artist || '今晚的歌手' : '全體賓客';
    const bodyText = msg ? msg.text : this.mode === 'invite' ? '掃描右下角 QR code，把祝福寫上大螢幕。' : null;
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(FORM_TEXT + nameText + this.sigText + songName + (bodyText ?? '') + lines.map((l) => l.text).join(''));

    const c = this.ink.ctx;
    // ---- 排版
    this.name = typeset(c, nameText, F.ming(700), fitRows(c, nameText, F.ming(700), L.col.x1 - L.name.x, 1, L.name.size, 30), L.name.x, [L.name.y], 2000, this.seed + 1);
    if (bodyText) {
      // 英文為主的留言用等寬字（真的打字機）；中文用思源宋體（中文打字機的鉛字就是明體）
      const latin = (bodyText.match(/[A-Za-z]/g)?.length ?? 0) / Math.max(1, bodyText.replace(/\s/g, '').length) > 0.5;
      const fam = latin ? F.mono(500) : F.ming(700);
      const w = L.col.x1 - L.col.x0;
      const size = fitRowsOr(c, bodyText, fam, w, L.msg.rows.length, L.msg.max, L.msg.min, 34);
      this.body = typeset(c, bodyText, fam, size, L.col.x0, L.msg.rows, w, this.seed + 2);
      if (this.body.rows < L.msg.rows.length) {
        const bt = '（以下空白）', bs = 28;
        this.blank = typeset(c, bt, F.ming(700), bs, (L.col.x0 + L.col.x1) / 2 - measure(bt, F.ming(700), bs) / 2, [L.msg.rows[this.body.rows]!], 2000, this.seed + 4);
        for (const ch of this.blank.chars) ch.dens *= 0.7;
      }
    }
    if (this.mode !== 'msg') {
      // 歌名一行放得下就一行，太長才折成兩行（第 2 欄有兩條線）
      const w = L.col.x1 - L.col.x0, fam = F.ming(700);
      const size = fits(c, songName, fam, 36, w, 1) ? fitRows(c, songName, fam, w, 1, 48, 36) : fitRows(c, songName, fam, w, 2, 48, 30);
      this.title = typeset(c, songName, fam, size, L.col.x0, L.lyric.rows, w, this.seed + 3);
    }
    for (const l of lines) this.lyricBlock(l);
    // 表格先畫好（G 色版，黑底）
    const fcv = (this.form = document.createElement('canvas'));
    fcv.width = Math.round(FORM_BOX.w * FORM_RES); fcv.height = Math.round(FORM_BOX.h * FORM_RES);
    const fc = fcv.getContext('2d')!;
    fc.fillStyle = '#000'; fc.fillRect(0, 0, fcv.width, fcv.height);
    fc.globalCompositeOperation = 'lighter';
    fc.setTransform(FORM_RES, 0, 0, FORM_RES, -FORM_BOX.x * FORM_RES, -FORM_BOX.y * FORM_RES);
    drawForm(fc, this.copy);
    const ft = (this.formTex = new THREE.CanvasTexture(fcv));
    // 色版不是顏色：不轉色彩空間；畫布是不透明的，標成預乘走 GPU 直接複製；mipmap 讓全景時的細線不閃
    ft.colorSpace = THREE.NoColorSpace;
    ft.premultiplyAlpha = true;
    ft.generateMipmaps = true;
    ft.minFilter = THREE.LinearMipmapLinearFilter;
    ft.magFilter = THREE.LinearFilter;
    this.ctx.renderer.initTexture(ft);
    if (!this.bake.done) {
      this.bake.pass.render(this.ctx.renderer, this.bake.rt);
      this.ctx.renderer.setRenderTarget(null);
      this.bake.done = true;
    }
    if ([nameText, bodyText ?? '', ...lines.map((l) => l.text)].some((x) => x.includes('♥'))) {
      this.rose = this.track(new Layer2D());
      this.rose.texture.colorSpace = THREE.NoColorSpace;
      this.rose.texture.premultiplyAlpha = true;
    }
    c.font = font(this.sigFamily, 60);
    this.sigSize = clamp(Math.floor((60 * L.sig.w) / Math.max(1, c.measureText(this.sigText).width)), 34, 60);

    this.schedule();
    // 底片先做好（窗格中途才做會卡一下）
    for (const b of this.blocks()) if (b.sprite === undefined) b.sprite = makeSprite(b);
  }

  /** 這個窗格所有打字的塊（做底片、還畫布用）。 */
  private blocks(): Block[] {
    return [this.name, this.body, this.title, this.blank, ...this.lyricCache.values()].filter((b): b is Block => !!b);
  }

  /** 排時間：打字落在節拍格上、勾選／簽名／方章依序各佔一拍，窗格太短就一項一項省掉。 */
  private schedule() {
    const au = this.ctx.audio, s = this.ctx.start, e = this.ctx.end;
    const B = (this.B = au.beatPeriod(s + 0.2));
    const b0 = beatAfter(au, s + 0.06);
    // 方章最晚：結束前至少留兩拍（或一秒）讓人看清楚
    const sealLatest = e - Math.max(1.0, 2 * B);
    /**
     * n 個字要在 budget 秒內打完：挑最慢、而且落在節拍細分上的速度（八分 → 十六分 → 三十二分 → 六十四分）。
     * maxStep：一個字最久幾秒（慢歌的十六分音符太慢，留言會打到窗格快結束才打完）。
     */
    const grid = (n: number, budget: number, kMin = 1, maxStep = Infinity) => {
      for (let k = kMin; k <= 4; k++) {
        const st = B / 2 ** k;
        if (st < 0.03) break;
        if (st <= maxStep && (n - 1) * st <= budget) return st;
      }
      return Math.max(0.028, budget / Math.max(1, n - 1));
    };
    const assign = (b: Block, t0: number, step: number) => { b.chars.forEach((ch, i) => (ch.t = t0 + i * step)); return t0 + (b.chars.length - 1) * step; };

    // 0. 第一拍：號碼機「喀」一聲蓋上編號。1. 登記人：從反拍起，一個字一個八分音符（名字長就十六分）
    this.tNum = b0;
    const nameEnd = assign(this.name, b0 + B / 2, grid(this.name.chars.length, 2 * B));
    let cur = beatAfter(au, nameEnd + 0.05);
    // 歌詞模式：第 2 欄打歌名（快快的，一拍多一點）
    if (this.title) cur = beatAfter(au, assign(this.title, cur, grid(this.title.chars.length, 1.5 * B, 2)) + 0.05);
    // 3. 祝福內容：兩小節內打完（窗格短就更快），打完之後至少留兩拍半給勾選與蓋章
    this.tType0 = cur;
    if (this.body) {
      const n = this.body.chars.length;
      // 最多兩小節、最多窗格的四成（留言打完之後還要停留讓人讀），而且一個字不超過 0.16 秒
      const budget = Math.max(0.5, Math.min(b0 + 8 * B, sealLatest - 2.5 * B, s + 0.4 * (e - s)) - cur);
      this.typeEnd = assign(this.body, cur, grid(n, budget, 1, 0.16));
      // 以下空白：打完留言的下一個八分音符，用十六分音符快快打完；窗格太擠就不打
      if (this.blank) {
        const t0 = au.timeOfBeat(Math.ceil(au.beatAt(this.typeEnd + 0.05) * 2) / 2);
        const end = t0 + (this.blank.chars.length - 1) * (B / 4);
        if (end < sealLatest - 2 * B) this.typeEnd = assign(this.blank, t0, B / 4);
        else this.blank = null;
      }
    } else {
      // 歌詞模式：內容欄由歌詞即時打，先讓它唱一小節再勾選
      this.typeEnd = cur + 3 * B;
    }

    // 後面的動作鏈：勾選（＋圈起來）→ 簽名 → 方章。放不下就先省簽名、再省圈圈。
    const sigDur = clamp(0.16 * Array.from(this.sigText).length + 0.25, 0.45, 1.3);
    const lastDown = (from: number, to: number) => {
      let best = NaN;
      for (let k = Math.ceil(au.barAt(from) - 1e-6); au.timeOfBar(k) <= to + 1e-6; k++) best = au.timeOfBar(k);
      if (!isNaN(best)) return best;
      for (let k = Math.ceil(au.beatAt(from) - 1e-6); au.timeOfBeat(k) <= to + 1e-6; k++) best = au.timeOfBeat(k);
      return best;
    };
    const tick = beatAfter(au, this.typeEnd + 0.1);
    const plans: [boolean, boolean][] = [[true, true], [true, false], [false, false]];
    for (const [circle, sig] of plans) {
      let end = tick + 0.12;
      let tc = Infinity, ts = Infinity, se = Infinity;
      if (circle) { tc = beatAfter(au, tick + B * 0.9); end = tc + Math.min(0.35, B * 0.8); }
      if (sig) { ts = beatAfter(au, end + B * 0.4); se = ts + sigDur; end = se; }
      const seal = lastDown(end + B * 0.5, sealLatest);
      if (!isNaN(seal)) {
        Object.assign(this, { tTick: tick, tCircle: tc, tSig: ts, sigEnd: se, tSeal: seal });
        break;
      }
    }
    if (!this.tSeal) {
      // 連勾選都放不下（很短的窗格）：勾選與方章都往前擠，方章落在最晚的時間
      this.tTick = Math.min(tick, sealLatest - 0.3);
      this.tSeal = Math.max(this.tTick + 0.25, Math.min(sealLatest, e - 0.4));
    }
    this.sealRot = -0.085 + (hash(this.seed, 9) - 0.5) * 0.06;
    this.sealDx = (hash(this.seed, 10) - 0.5) * 14;
    this.sealDy = (hash(this.seed, 11) - 0.5) * 10;

    // ---- 鏡頭：每個鏡位「緩進」到它的拍點上（最後落在拍上），方章那一下是甩過去的
    // 停住的鏡位也不完全靜止：很慢地推近、往右飄（pdoom 的鏡頭一直在呼吸）
    const drift = (cam: Cam, dt: number, rate = 0.01, dx = 7): Cam => {
      const u = Math.min(4, Math.max(0, dt));
      return { ...cam, x: cam.x + dx * u, z: cam.z * (1 + rate * u) };
    };
    const io = ease.inOutCubic;
    // 歌詞模式：歌詞一開始就在內容欄，第一個鏡位就要把它框進來（不能用只看名字的近景）
    this.shots = [{ t0: s, t1: s + 0.75, e: ease.outExpo, cam: this.mode === 'lyric' ? (t) => this.typeCam(t) : (t) => drift(CAM_NAME, t - s - 0.75, 0.006) }];
    this.camStart = startOf(this.shots[0]!.cam(s + 0.75));
    if (this.tType0 < this.tTick) this.shots.push({ t0: this.tType0 - 0.45, t1: this.tType0, e: io, cam: (t) => this.typeCam(t) });
    this.shots.push({ t0: this.tTick - 0.5, t1: this.tTick, e: io, cam: (t) => drift(CAM_REVIEW, t - this.tTick) });
    // 中段很長：每兩小節在「看留言」與「看整張」之間換，緩進小節線
    const holdFrom = (isFinite(this.sigEnd) ? this.sigEnd : this.tTick + B) + B;
    const holdTo = this.tSeal - 2 * B;
    let k = 0;
    for (let d = barAfter(au, holdFrom + 3 * B); d <= holdTo - 2 * B; d = barAfter(au, d + 7 * B)) {
      const msg = k++ % 2 === 0, t1 = d;
      this.shots.push({ t0: t1 - 1.5 * B, t1, e: io, cam: msg ? (t) => drift(CAM_MSG, t - t1, 0.006, 0) : (t) => drift(CAM_REVIEW, t - t1) });
    }
    this.shots.sort((a, b) => a.t0 - b.t0);
    this.shots.push({ t0: this.tSeal - 0.02, t1: this.tSeal + 0.3, e: ease.outExpo, cam: (t) => drift(CAM_WIDE, t - this.tSeal, 0.008) });
  }

  /** 歌詞一行的排版與每個字的時間（字在它那個詞開始唱時打上去；英文一個詞裡的字母用自然的打字速度）。 */
  private lyricBlock(line: Line): Block {
    const hit = this.lyricCache.get(line);
    if (hit) return hit;
    const c = this.ink.ctx, fam = F.mono(600), w = L.col.x1 - L.col.x0;
    // 有留言：歌詞在第 2 欄（兩行線，小一級）；沒有留言：歌詞就是祝福內容（字大、最多用前兩行：第三行推近時靠 QR 區太近）
    const rows = this.mode === 'msg' ? L.lyric.rows : L.msg.rows;
    const size = this.mode === 'msg' ? fitRowsOr(c, line.text, fam, w, 2, L.lyric.size, L.lyric.min, 34)
      : fits(c, line.text, fam, 50, w, 2) ? fitRows(c, line.text, fam, w, 2, 84, 50) : fitRowsOr(c, line.text, fam, w, 3, 50, 50, 34);
    const b = typeset(c, line.text, fam, size, L.col.x0, rows, w, this.seed + 100 + line.i);
    for (const ch of b.chars) {
      const o = ch.ws;
      const wi = line.words.findIndex((w) => o >= w.o && o < w.o + w.w.length);
      const wd = wi >= 0 ? line.words[wi]! : line.words.find((w) => w.o > o) ?? line.words[line.words.length - 1];
      if (!wd) { ch.t = line.start; ch.ws = line.start; ch.we = line.end; continue; }
      const n = Array.from(wd.w).length;
      const j = wi >= 0 ? Array.from(line.text.slice(wd.o, o)).length : 0;
      const per = Math.min(0.07, (wd.end - wd.start) / Math.max(1, n));
      ch.t = wd.start + j * per;
      ch.ws = wd.start; ch.we = wd.end;
    }
    this.lyricCache.set(line, b);
    return b;
  }

  // ------------------------------------------------------------------ 鏡頭
  /** 打字頭的 x：每打一個字就往右跳一格（很短的緩動），換行時用比較長的緩動甩回左邊。 */
  private caretX(b: Block, t: number) {
    let x = b.chars[0]!.x;
    for (const ch of b.chars) {
      if (t < ch.t) break;
      const tx = ch.x + b.size * 0.6;
      x = lerp(x, tx, ease.outCubic(prog(t, ch.t, ch.t + (tx < x ? 0.22 : 0.06))));
    }
    return x;
  }
  /** 正在打的那一塊（留言，或歌詞模式正在唱的那一行）；沒有字就是 null。 */
  private activeBlock(t: number): Block | null {
    const b = this.body ?? (() => { const ly = lyricAt(this.ctx.lyrics, t, 1.6); return ly ? this.lyricBlock(ly.line) : null; })();
    return b && b.chars.length ? b : null;
  }
  /** 打祝福內容時的取景：x 跟著打字頭輕輕晃（取 0.3 秒平均，換行時晃回去）。 */
  private typeCam(t: number): Cam {
    let x = 0;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const tt = t - (i * 0.3) / N;
      const b = this.activeBlock(tt);
      x += b ? this.caretX(b, tt) : L.col.x0;
    }
    x /= N;
    const u = clamp((x - L.col.x0) / (L.col.x1 - L.col.x0));
    return { x: CAM_TYPE.x + CAM_TYPE.sway * (2 * u - 1), y: CAM_TYPE.y0, z: CAM_TYPE.z, r: CAM_TYPE.r };
  }
  camAt(t: number): Cam {
    // 鏡位依序疊上去；已經完全到位的鏡位會蓋掉前面所有的，從最後一個到位的開始算就好（跟打字頭的鏡位不用每格都算）
    let i0 = -1;
    for (let i = 0; i < this.shots.length; i++) if (t >= this.shots[i]!.t1) i0 = i;
    let cam = i0 >= 0 ? this.shots[i0]!.cam(t) : this.camStart;
    for (let i = i0 + 1; i < this.shots.length; i++) {
      const sh = this.shots[i]!, k = prog(t, sh.t0, sh.t1, sh.e);
      if (k > 0) cam = lerpCam(cam, sh.cam(t), k);
    }
    // 大鼓讓紙輕輕往前推一下；蓋章那一下衝得更多
    const z = 1 + 0.006 * this.ctx.audio.hit('kick', t, 0.12) + 0.05 * pulse(t, this.tSeal, 0.09);
    return { ...cam, z: cam.z * z };
  }
  /** 震動（螢幕像素）：每個打字的鍵、勾選、蓋章。方向用逐格的 hash（確定性）。 */
  private shake(t: number): [number, number] {
    let amp = 26 * pulse(t, this.tSeal, 0.07) + 5 * pulse(t, this.tTick, 0.05) + 4 * pulse(t, this.tNum, 0.05);
    const keys = (b: Block | null) => { if (b) for (const ch of b.chars) if (t >= ch.t && t < ch.t + 0.12 && ch.ch !== ' ') amp += 1.3 * pulse(t, ch.t, 0.025); };
    keys(this.name); keys(this.body); keys(this.blank); keys(this.title);
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) keys(this.lyricBlock(ly.line));
    const ph = frameIdx(t);
    return [amp * (hash(ph, 11) - 0.5) * 2, amp * (hash(ph, 12) - 0.5) * 2];
  }

  override dispose() {
    // 表格畫布一張十幾 MB：窗格結束馬上還
    this.formTex?.dispose();
    for (const b of this.blocks()) if (b.sprite) { b.sprite.cv.width = b.sprite.cv.height = 0; b.sprite = null; }
    if (this.form) { this.form.width = this.form.height = 0; this.form = null; }
    // 共用的紙張 pass 會留著這一格的貼圖參照：換成不會被釋放的烤紙貼圖，下一個版面物件設好之前不會去上傳已經釋放的畫布
    const P = this.paper.u;
    P.inkTex!.value = P.roseTex!.value = P.formTex!.value = this.bake.rt.texture;
    super.dispose();
  }

  // ------------------------------------------------------------------ 畫
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    const cam = this.camAt(t);
    const [shx, shy] = this.shake(t);
    const m = camXf(cam, shx, shy);
    const im = invXf(m);
    // 動態模糊：鏡頭在這一格甩了多遠（只看畫面中心、不算震動），甩得快才糊
    let bl: [number, number] = [0, 0];
    {
      const m2 = camXf(this.camAt(t - 1 / 60));
      const pc = apply(invXf(camXf(cam)), W / 2, H / 2);
      const q = apply(m2, pc.x, pc.y);
      const bx = q.x - W / 2, by = q.y - H / 2, len = Math.hypot(bx, by);
      // 換行時打字頭甩回去、蓋章時拉全景：夠快才糊，而且糊得克制（字還要讀得到）
      const k = len > 26 ? (Math.min(1, (len - 26) / 26) * Math.min(56, len * 0.45)) / len : 0;
      bl = [bx * k, by * k];
    }

    const I = this.ink;
    I.clear('#000');
    const c = I.ctx;
    c.globalCompositeOperation = 'lighter';
    c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    let hc: Ctx2 | null = null;
    if (this.rose) {
      this.rose.clear('#000');
      hc = this.rose.ctx;
      hc.globalCompositeOperation = 'lighter';
      hc.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    }
    this.drawNumber(c, t);
    this.drawTyped(c, hc, this.name, t, { caret: 0.3 });
    this.drawField2(c, hc, t);
    this.drawBody(c, hc, t);
    this.drawChecks(c, t);
    this.drawSignature(c, t);
    this.drawSeal(c, t);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';

    const P = this.paper.u;
    P.inkTex!.value = I.upload();
    P.roseOn!.value = this.rose ? 1 : 0;
    P.bakeTex!.value = this.bake.rt.texture;
    P.formTex!.value = this.formTex;
    // 沒有愛心的那層：取樣器也要綁一張有效的貼圖（別綁到上一個窗格已經釋放的畫布）
    P.roseTex!.value = this.rose ? this.rose.upload() : I.texture;
    (P.camA!.value as THREE.Vector3).set(im.a, im.c, im.e);
    (P.camB!.value as THREE.Vector3).set(im.b, im.d, im.f);
    (P.blurV!.value as THREE.Vector2).set(bl[0], bl[1]);
    // 淺景深：推得越近越淺（全景、看整張時是 0）
    P.dofR!.value = 8 * clamp((cam.z - 1.08) / 0.35);
    const sl = this.sealState(t);
    (P.st0!.value as THREE.Vector4).set(sl.x, sl.y, (sl.side / 2) * 1.14 * sl.scale, (sl.side / 2) * 1.14 * sl.scale);
    (P.st0b!.value as THREE.Vector4).set(sl.rot, sl.on ? sl.strength : 0, 3.7 + (this.seed % 7), 0);
    this.paper.render(renderer, out);
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.8, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.5 };
  }

  /**
   * 畫打字機打上去的字。`lyric`：歌詞（正在唱的詞用訊號色印泥、唱完變墨色、還沒打的字 preview 透明度先出現）。
   * ♥ 另外印在玫瑰色那一層（愛心是唯一用點綴色的東西）。
   */
  private drawTyped(c: Ctx2, hc: Ctx2 | null, b: Block, t: number, o: { alpha?: number; lyric?: boolean; preview?: number; caret?: number } = {}) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0.001) return;
    c.font = font(b.family, b.size);
    if (hc) hc.font = c.font;
    if (b.sprite === undefined) b.sprite = makeSprite(b);
    const sp = b.sprite;
    // 逐字畫：愛心、剛打上去還在彈的字、正在唱的字（訊號色）；其他的字從底片整段貼過去
    const one = (ch: TChar) => {
      const heart = ch.ch === '♥' && hc;
      const ctx = heart ? hc! : c;
      if (t < ch.t) {
        if (o.preview) { ctx.fillStyle = TYPE(o.preview * alpha); ctx.fillText(ch.ch, ch.x, ch.y); }
        return;
      }
      const fresh = pulse(t, ch.t, 0.035);
      ctx.save();
      ctx.translate(ch.x + ch.jx, ch.y + ch.jy - 3.5 * fresh);
      ctx.rotate(ch.rot);
      ctx.fillStyle = heart ? TYPE(alpha) : o.lyric && t < ch.we ? SIG(alpha) : TYPE(Math.min(1, ch.dens + 0.2 * fresh) * alpha);
      ctx.fillText(ch.ch, 0, 0);
      ctx.restore();
    };
    if (!sp) { for (const ch of b.chars) if (ch.ch !== ' ') one(ch); }
    else {
      const cs = b.chars, right = sp.x0 + sp.cv.width / SPR_RES;
      // 'd' 打好了（貼底片）、'u' 還沒打（有預告就淡淡地貼底片）、'x' 逐字畫
      const kind = (ch: TChar) => ch.ch === '♥' ? 'x' : t < ch.t ? 'u' : ch.ch === ' ' ? 'd' : t - ch.t < 0.2 || (o.lyric && t < ch.we) ? 'x' : 'd';
      // 一段 [i0, i1)：左緣是這一行的開頭或這個字的左邊，右緣是下一個字的左邊或這一行的結尾
      let i0 = 0;
      const flush = (i1: number) => {
        if (i1 <= i0) return;
        const a = cs[i0]!, k0 = kind(a);
        if (k0 === 'u' && !o.preview) return;
        const L0 = i0 === 0 || cs[i0 - 1]!.row !== a.row ? sp.x0 : a.x - 1;
        const R0 = i1 < cs.length && cs[i1]!.row === a.row ? cs[i1]!.x - 1 : right;
        if (R0 <= L0) return;
        c.globalAlpha = k0 === 'd' ? alpha : o.preview! * alpha;
        c.drawImage(sp.cv, (L0 - sp.x0) * SPR_RES, a.row * sp.band * SPR_RES, (R0 - L0) * SPR_RES, sp.band * SPR_RES, L0, a.y - sp.top, R0 - L0, sp.band);
        c.globalAlpha = 1;
      };
      for (let i = 0; i < cs.length; i++) {
        const ch = cs[i]!, k = kind(ch);
        if (k === 'x') { flush(i); one(ch); i0 = i + 1; continue; }
        if (i > i0 && (k !== kind(cs[i0]!) || ch.row !== cs[i0]!.row)) { flush(i); i0 = i; }
      }
      flush(cs.length);
    }
    // 打字的導引（下一個字會打在哪）：訊號色的小三角。caret = 第一個字前多久先出現（只給正在打的那一塊）
    if (o.caret !== undefined) {
      const next = b.chars.find((ch) => ch.t > t && ch.ch !== ' ');
      if (next && t > b.chars[0]!.t - o.caret) {
        const gs = b.size / 50, gx = next.x + b.size * 0.3, gy = next.y + 22 * gs;
        c.fillStyle = SIG(alpha);
        c.beginPath(); c.moveTo(gx - 8 * gs, gy); c.lineTo(gx + 8 * gs, gy); c.lineTo(gx, gy - 11 * gs); c.closePath(); c.fill();
      }
    }
  }

  /** 編號：第一個拍點用號碼機蓋在表頭右端（訊號色，稍微歪；號碼機是表格上唯一會「喀」一聲的東西）。 */
  private drawNumber(c: Ctx2, t: number) {
    if (t < this.tNum) return;
    const k = prog(t, this.tNum, this.tNum + 0.05, ease.outQuad), sc = lerp(1.14, 1, k);
    c.save();
    c.translate(L.numberAt.x, L.numberAt.y); c.rotate(-0.022); c.scale(sc, sc);
    c.font = font(F.mono(600), 20); c.letterSpacing = '4px';
    c.textAlign = 'right';
    c.fillStyle = SIG(0.9);
    c.fillText(this.copy.no, 0, 0);
    c.restore();
  }

  /** 第 2 欄：有留言時是現場歌詞；沒有留言時打歌名（歌詞改到內容欄）。 */
  private drawField2(c: Ctx2, hc: Ctx2 | null, t: number) {
    if (this.title) { this.drawTyped(c, hc, this.title, t); return; }
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) { this.drawTyped(c, hc, this.lyricBlock(ly.line), t, { alpha: ly.k, lyric: true, preview: 0.3 }); return; }
    this.drawGap(c, t, L.lyric.rows[0], 1.2);
  }

  /** 沒有歌詞的時候：純音樂就請大家自己哼；兩句之間寫「間奏中」（淡淡的印刷字，歌詞一來就讓位）。 */
  private drawGap(c: Ctx2, t: number, y: number, hold: number) {
    const { lyrics } = this.ctx;
    let a = 0.36;
    const last = lyrics.lastLine(t), next = lyrics.nextLine(t);
    if (last) a *= clamp((t - last.end - hold) / 0.4);
    if (next) a *= clamp((next.start - 0.35 - t) / 0.25);
    if (a <= 0.01) return;
    c.save();
    c.fillStyle = PRINT(a);
    c.font = font(F.hei(500), 26); c.letterSpacing = '4px';
    c.fillText(lyrics.has ? '♪  （間奏中）' : '♪  本曲為純音樂，請自行哼唱', L.col.x0 + 8, y);
    c.restore();
  }

  /** 第 3 欄：留言（或邀請）逐字打上去；歌詞模式是正在唱的那一行。 */
  private drawBody(c: Ctx2, hc: Ctx2 | null, t: number) {
    if (this.body) {
      // 名字打完才出現下一塊的導引（同時只有一個打字頭）
      const nameLast = this.name.chars[this.name.chars.length - 1]!.t;
      this.drawTyped(c, hc, this.body, t, { caret: clamp(this.body.chars[0]!.t - nameLast - 0.06, 0, 0.3) });
      if (this.blank) this.drawTyped(c, hc, this.blank, t);
      return;
    }
    const ly = lyricAt(this.ctx.lyrics, t, 1.6);
    if (ly) this.drawTyped(c, hc, this.lyricBlock(ly.line), t, { alpha: ly.k, lyric: true, preview: 0.3 });
    else this.drawGap(c, t, L.msg.rows[0], 1.6);
  }

  /** 「以上皆是」：訊號色的紅筆在拍點上「刷」一勾，下一拍再圈起來。 */
  private drawChecks(c: Ctx2, t: number) {
    if (t < this.tTick) return;
    const b = L.checks.box, y = L.checks.y0 + 3 * L.checks.gap;
    const bx = L.right.x0 + 2, by = y - b + 2;
    c.save();
    c.strokeStyle = SIG(1); c.lineCap = 'round'; c.lineJoin = 'round';
    // 勾：短短往下、長長往右上甩出框外（老師改考卷的那種）
    const pts = [[bx + 3, by + b * 0.45], [bx + b * 0.42, by + b + 3], [bx + b + 18, by - 20]] as const;
    const p = prog(t, this.tTick, this.tTick + 0.11, ease.outQuad);
    const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
    const len = (l1 + l2) * p;
    c.lineWidth = 4.5;
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    if (len <= l1) c.lineTo(lerp(pts[0][0], pts[1][0], len / l1), lerp(pts[0][1], pts[1][1], len / l1));
    else { c.lineTo(pts[1][0], pts[1][1]); c.lineTo(lerp(pts[1][0], pts[2][0], (len - l1) / l2), lerp(pts[1][1], pts[2][1], (len - l1) / l2)); }
    c.stroke();
    // 圈：繞「以上皆是」一圈多一點，半徑有一點手抖
    if (t >= this.tCircle) {
      const tw = measure(this.copy.checks[3]!, F.hei(500), 20, 3);
      const cx = L.right.x0 + b + 18 + tw / 2, cy = y - 8, rx = tw / 2 + 20, ry = 21;
      const q = prog(t, this.tCircle, this.tCircle + Math.min(0.35, this.B * 0.8), ease.inOutCubic);
      const a0 = -2.5, span = (Math.PI * 2 + 0.55) * q;
      c.lineWidth = 2.8;
      c.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = a0 + (span * i) / 48;
        const r = 1 + 0.05 * Math.sin(3 * a + this.seed) + 0.04 * (a - a0) / (Math.PI * 2);
        const x = cx + Math.cos(a) * rx * r, yy = cy + Math.sin(a) * ry * r - 0.05 * Math.cos(a) * rx * r;
        if (i) c.lineTo(x, yy); else c.moveTo(x, yy);
      }
      c.stroke();
    }
    c.restore();
  }

  /** 簽名：手寫字一個字一個字斜斜地寫出來（跟仙女棒寫字同一種遮罩），寫完拉一條尾巴。 */
  private drawSignature(c: Ctx2, t: number) {
    if (t < this.tSig) return;
    const size = this.sigSize, fam = this.sigFamily;
    const lay = layout(this.sigText, fam, size);
    const n = lay.glyphs.length, dur = this.sigEnd - this.tSig - 0.15, per = dur / Math.max(1, n);
    const x0 = L.sig.x, y0 = L.sig.y - 2;
    c.save();
    c.translate(x0, y0); c.rotate(-0.035);
    c.font = font(fam, size);
    c.fillStyle = TYPE(0.95);
    const SK = 0.55;
    for (const g of lay.glyphs) {
      const a = this.tSig + g.i * per;
      if (t < a) break;
      const r = clamp((t - a) / per);
      if (r >= 1) { c.fillText(g.ch, g.x, 0); continue; }
      const top = -size * 0.95, h = size * 1.2, S = r * (g.w + SK * h);
      c.save();
      c.beginPath();
      c.moveTo(g.x - 8, top - 8); c.lineTo(g.x + S + 8 * SK, top - 8); c.lineTo(g.x + S - SK * (h + 8), top + h + 8); c.lineTo(g.x - 8, top + h + 8);
      c.closePath(); c.clip();
      c.fillText(g.ch, g.x, 0);
      c.restore();
    }
    // 尾巴：一條往右上揚的弧線
    const u = prog(t, this.sigEnd - 0.15, this.sigEnd + 0.05, ease.outCubic);
    if (u > 0) {
      c.strokeStyle = TYPE(0.9); c.lineWidth = 2.4; c.lineCap = 'round';
      const w = lay.width;
      c.beginPath();
      const N = 20;
      for (let i = 0; i <= N * u; i++) {
        const k = i / N;
        const x = lerp(-12, w + 60, k), y = 16 - 26 * k * k + 8 * Math.sin(k * Math.PI);
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.stroke();
    }
    c.restore();
  }

  private sealState(t: number) {
    const k = prog(t, this.tSeal, this.tSeal + 0.05, ease.outQuad);
    const { x, y, box, side } = L.seal;
    return { x: x + box / 2 + this.sealDx, y: y + box / 2 + this.sealDy, side, rot: this.sealRot, on: t >= this.tSeal, strength: 1 + 0.55 * (1 - k), scale: lerp(1.08, 1, k) };
  }
  /**
   * 方章（陽刻：紅框紅字，紙色留白）。整塊實心的陰刻章是一大塊訊號色，會比打上去的祝福還搶眼；
   * 陽刻章一樣是「砸下來」的那一下，但留言還是整張紙的主角。四個字由左而右、由上而下排：
   * 傳統印章是右行直讀，但大螢幕上只看一眼，橫著讀才不會被念成「好百合年」。
   */
  private drawSeal(c: Ctx2, t: number) {
    const s = this.sealState(t);
    if (!s.on) return;
    const S = s.side, h = S / 2;
    c.save();
    c.translate(s.x, s.y); c.rotate(s.rot); c.scale(s.scale, s.scale);
    c.strokeStyle = SIG(1); c.lineWidth = 9;
    c.beginPath(); c.roundRect(-h + 4.5, -h + 4.5, S - 9, S - 9, 10); c.stroke();
    c.fillStyle = SIG(1);
    const chars = Array.from(this.copy.seal);
    const cell = (S - 34) / 2, size = cell * 0.98;
    c.font = font(F.ming(900), size);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const pos = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
    chars.slice(0, 4).forEach((ch, i) => {
      const [cx, cy] = pos[i]!;
      c.fillText(ch, -h + 17 + cell * (cx + 0.5), -h + 17 + cell * (cy + 0.5) + size * 0.04);
    });
    c.restore();
  }
}
