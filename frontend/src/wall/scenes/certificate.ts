// 祝福登記表（亮版面）：照 pdoom 的 bureau（FIG. 7「Paperwork」）改的。一張擺在書桌上的表格，俯拍整張桌面：
//  - 第一個拍點，號碼機「喀」一聲在表頭蓋上編號；桌上那支鋼筆自己站起來，飛到「祝福內容」欄，
//    一個字一個字把主打留言寫上去（筆尖跟著正在寫的字走，字落在節拍的細分上）。
//  - 寫完的下一拍，筆「刷」地勾起「以上皆是」、再圈一圈，接著在簽名欄簽上名字，然後躺回桌上。
//  - 留言沒填滿四行，下一行寫「（以下空白）」。窗格長：簽完名過一小節，筆在簽名底下補一道花式底線。
//  - 最後一個大拍點之前：橡皮章從桌上拿起來，在印泥盒上拍兩下（落在拍點），然後砸在「核准章」框裡——
//    訊號色的方章「百年好合」（稍微歪、稍微超出框線），鏡頭同時拉到全景、畫面震一下，章抬起來放回桌上。
//  - 歌詞在「現場歌詞」欄，照跟唱規則：還沒唱的字三成淡淡地先出現、唱到的那一刻打上去（訊號色）、唱完變成墨色。
//  - 沒有留言：「播放歌曲」欄打歌名，祝福內容欄改由歌詞一句一句打上去（焦點），筆只負責勾選、簽「歌手」；
//    純音樂又沒留言：筆寫一句邀請大家掃 QR。
// v2（2026-09-28 新人：「留言板都太大太突兀」「空出來的地方可以再多補一些動畫」）：
//  - 鏡頭拉遠到整張桌面都看得到（z ≈ 0.62～0.69）：留言在螢幕上 40～60 px、署名 26～32、歌詞 40～52（不比留言大），
//    留言欄（含欄位與簽名）約 740×350，在畫面左下；紙與桌上的道具才是畫面的主體。
//  - 多補的動畫：會寫字的鋼筆、沾印泥再蓋章的橡皮章、冒著熱氣的茶（大鼓一打茶面起一圈漣漪）、窗外樹影在風裡晃、
//    燈光裡的飛塵；鏡頭開場看整張桌面，筆開始寫的時候慢慢推向留言（還跟著筆尖微微移），長窗格每兩小節換鏡位。
// 畫法（照 bureau）：所有的墨畫在一張 Canvas2D 上、用色版分開（R 手寫與打字、G 印刷、B 印泥），紙張 shader 再把它們
// 疊印到程序生成的紙上（纖維、印章缺墨、Beer–Lambert），所以顏色全部來自色票、換主題整張跟著變。桌上的道具畫在另一張圖層。
// 鏡頭是一個 2D 仿射（紙面 → 螢幕）；每個鏡位都算過：字不會進右下角 QR 區、離邊 96 px 以上（見 CAM_* 的註解）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, measure } from '../engine/type';
import { wrap } from '../engine/text';
import { LIN } from '../engine/palette';
import type { Line } from '../engine/lyrics';
import { clamp, ease, lerp, prog, hash, pulse, frameIdx, TAU } from '../engine/util';
import { lyricAt, lyricSubOf, subSizeFor, beatAfter, barAfter, COUPLE_ZH } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';
import { PAPER_FRAG, BAKE_FRAG, BAKE, FORM_BOX, FORM_RES } from './certificate-glsl';
import { L, TYPE, PRINT, SIG, drawForm, makeCopy, FORM_TEXT, FS, CHECK_FONT, CHECK_TRACK, onPaper, Z_READ, type FormCopy } from './certificate-form';
import { PROPS, PEN_WRITE_A, drawPen, drawStamp, makeInkPad, makeCup, makeEnvelope, drawArt, drawSteam, drawRipple, type Art } from './certificate-props';

type Ctx2 = CanvasRenderingContext2D;
/** 鏡頭：紙面上的 (x, y) 放在螢幕中央，縮放 z、旋轉 r。 */
interface Cam { x: number; y: number; z: number; r: number }
type Xf = { a: number; b: number; c: number; d: number; e: number; f: number };
type P = { x: number; y: number };

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

// 取景（紙面座標，見 certificate-form.ts 的 L）。紙在紙面 x 66～1854，道具在 x 1900～2600（桌面右邊）。
// 每個取景都算過（z ≤ 0.70）：主欄 x 196～1270 在螢幕 x ≈ 180～960、簽名的下緣 y ≤ 800，右欄的方章右下角 x < 1250，
// 所以字離邊 ≥ 96 px、不會進右下角 QR 區（x ≥ 1360 且 y ≥ 830）；右邊露出茶杯、印泥盒、章。
/** 切進來的那一格：比第一個鏡位遠一點、歪一點，0.75 秒內推近落定（pdoom 的 settle）。 */
const startOf = (c: Cam): Cam => ({ x: c.x + 50, y: c.y - 24, z: c.z * 0.93, r: c.r - 0.022 });
/** 看整張桌面（紙＋道具）。 */
const CAM_DESK: Cam = { x: 1330, y: 604, z: 0.635, r: -0.02 };
/** 筆在寫留言：往留言欄推一點（還跟著筆尖微微移，見 writeCam）。 */
const CAM_WRITE: Cam = { x: 1285, y: 640, z: 0.685, r: -0.024 };
/** 看整張（勾選、簽名、方章框都在裡面）。 */
const CAM_REVIEW: Cam = { x: 1350, y: 612, z: 0.66, r: -0.016 };
/** 長窗格的中段：在「看整張桌面」與「看留言」之間，每兩小節換一次。 */
const CAM_MSG: Cam = { x: 1270, y: 632, z: 0.68, r: -0.026 };
/** 蓋章：全景。 */
const CAM_WIDE: Cam = { x: 1360, y: 596, z: 0.62, r: -0.012 };

const PAPER = () => new FSPass(PAPER_FRAG, {
  inkTex: { value: null }, roseTex: { value: null }, bakeTex: { value: null }, formTex: { value: null }, roseOn: { value: 0 },
  camA: { value: new THREE.Vector3() }, camB: { value: new THREE.Vector3() },
  blurV: { value: new THREE.Vector2() }, dofR: { value: 0 },
  st0: { value: new THREE.Vector4() }, st0b: { value: new THREE.Vector4() }, uT: { value: 0 },
});

/** 紙的紋理只烤一次（整晚共用；只存明暗不存顏色，換主題不用重烤）。 */
const BAKED = () => ({
  rt: makeRT(BAKE.w, BAKE.h, { pxScale: 1, type: THREE.UnsignedByteType, depthBuffer: false }),
  pass: new FSPass(BAKE_FRAG),
  done: false,
});

const HAND = F.hand(700);
const TYPEF = F.mono(600);

/**
 * 寫（或打）上去的一個字。t：開始的時間；d：手寫這個字要多久（打字是 0，一下就打上去）；w：字寬。
 * ws/we：歌詞的字所屬那個詞的開始／結束（決定訊號色或墨色）。
 */
interface TChar { ch: string; x: number; y: number; w: number; row: number; t: number; d: number; dens: number; jx: number; jy: number; rot: number; ws: number; we: number }
/**
 * 寫好的字的「底片」：一塊字的每個字（含抖動、旋轉、墨色濃淡）先畫在一張畫布上，一行一條、上下不重疊。
 * 每格只要把「已經寫好的那一段」drawImage 過去——逐字 fillText（還要逐字旋轉）太慢。
 */
interface Sprite { cv: HTMLCanvasElement; x0: number; band: number; top: number }
interface Block {
  chars: TChar[]; family: string; size: number; rows: number; hand: boolean; sprite?: Sprite | null;
  /** 韓文歌的原文副行（打在歌詞下面的線上）。 */
  sub?: Block;
}
interface Shot { t0: number; t1: number; e: (x: number) => number; cam: (t: number) => Cam }
/** 筆的一段動作（寫一塊字、勾、圈、簽名、底線）：t0～t1 之間筆尖在 at(t)。 */
interface Act { t0: number; t1: number; at: (t: number) => P & { lift: number } }
/** 章的關鍵格：位置、旋轉、高度（0 = 壓在紙上或桌上）。 */
interface SKey { t: number; x: number; y: number; r: number; h: number; e?: (u: number) => number }

/** text 用這個字級、在 maxW 寬裡斷行，是否不超過 rows 行。 */
function fits(c: Ctx2, text: string, family: string, size: number, maxW: number, rows: number) {
  c.font = font(family, size);
  return wrap(c, text, maxW).length <= rows;
}
/** 在 min～max 之間找最大字級，讓 text 在 maxW 寬裡斷成不超過 rows 行（放不下就回傳 min）。 */
function fitRows(c: Ctx2, text: string, family: string, maxW: number, rows: number, max: number, min: number) {
  for (let s = max; s > min; s -= 1) if (fits(c, text, family, s, maxW, rows)) return s;
  return min;
}
/** 同 fitRows，但縮到 min 還放不下時再往下縮到 floor：字小一點總比壓到下一欄好（極少數超長的句子）。 */
function fitRowsOr(c: Ctx2, text: string, family: string, maxW: number, rows: number, max: number, min: number, floor: number) {
  const s = fitRows(c, text, family, maxW, rows, max, min);
  return s > min || fits(c, text, family, s, maxW, rows) ? s : fitRows(c, text, family, maxW, rows, min, floor);
}

/**
 * 把字排進印好的橫線上（基線固定：只能寫在線上），回傳每個字的位置。時間之後再填。
 * 每個字有一點點位移、旋轉、墨色濃淡（手寫與打字的字都不會完全整齊，這是它像真的的原因）。
 */
function typeset(c: Ctx2, text: string, family: string, size: number, x0: number, rows: readonly number[], maxW: number, seed: number, hand = false): Block {
  c.font = font(family, size);
  const lines = wrap(c, text, maxW);
  const pitch = rows.length > 1 ? rows[1]! - rows[0]! : size * 1.3;
  const chars: TChar[] = [];
  let cursor = 0;
  const jit = hand ? 0.6 : 1;
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
        ch: g.ch, x: x0 + g.x, y, w: g.w, row: ri, t: 0, d: 0, ws: o, we: 0,
        dens: 0.82 + 0.18 * hash(seed, o, 1), jx: (hash(seed, o, 2) - 0.5) * 2.4 * jit, jy: (hash(seed, o, 3) - 0.5) * 3.2 * jit, rot: (hash(seed, o, 17) - 0.5) * 0.03 * jit,
      });
      o += g.ch.length;
    }
  });
  return { chars, family, size, rows: lines.length, hand };
}

/** 歌詞的字什麼時候打上去：字在它那個詞開始唱時打上去（英文一個詞裡的字母用自然的打字速度）；ws/we 換成那個詞的開始／結束。 */
function timeChars(b: Block, line: Line) {
  for (const ch of b.chars) {
    const o = ch.ws;
    const wi = line.words.findIndex((wd) => o >= wd.o && o < wd.o + wd.w.length);
    const wd = wi >= 0 ? line.words[wi]! : line.words.find((x) => x.o > o) ?? line.words[line.words.length - 1];
    if (!wd) { ch.t = line.start; ch.ws = line.start; ch.we = line.end; continue; }
    const n = Array.from(wd.w).length;
    const j = wi >= 0 ? Array.from(line.text.slice(wd.o, o)).length : 0;
    const per = Math.min(0.07, (wd.end - wd.start) / Math.max(1, n));
    ch.t = wd.start + j * per;
    ch.ws = wd.start; ch.we = wd.end;
  }
}

/** 底片的解析度（紙面 px 的倍數）：鏡頭最近約 0.7 倍，1 倍就夠銳利。 */
const SPR_RES = 1;
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

/**
 * v2 起畫面大半是深色的木頭書桌（紙只佔三成多），右下角 HUD 壓在木頭上：算暗版面——
 * HUD 用淺色字，導演排亮暗交替時也當暗的（director.ts 的 PLATES 寫的是 paper: true，這裡的宣告優先）。
 */
export const spec: PlateSpecDecl = { paper: false };
/** 手寫一個字的斜遮罩（跟仙女棒寫字同一種）：遮罩的斜率。 */
const SK = 0.5;

export default class Certificate extends Scene {
  ink = this.track(new Layer2D());
  /** 愛心用點綴色（玫瑰）印：只有寫的字裡有 ♥ 才建這一張（多一張上傳）。 */
  rose: Layer2D | null = null;
  /** 桌上的道具（筆、章、印泥盒、茶杯、熱氣）：螢幕座標，每格重畫。 */
  props = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dust = this.track(new LineBatch(64, { screen2D: true, blend: 'add' }));
  paper = shared('certificate.paper', PAPER);
  bake = shared('certificate.bake', BAKED);
  /** 印好的表格每格都一樣：開場時先畫在一張紙面座標的畫布上，上傳成貼圖一次，紙張 shader 直接取樣。 */
  form: HTMLCanvasElement | null = null;
  formTex: THREE.CanvasTexture | null = null;
  inkPad: Art | null = null;
  cup: Art | null = null;
  envelope: Art | null = null;
  msg: Msg | null = this.ctx.params.message ?? null;
  mode: 'msg' | 'lyric' | 'invite' = 'msg';
  seed = Number(this.ctx.params.seed ?? 1);
  copy!: FormCopy;

  /** 祝福內容（留言或邀請，手寫）；歌詞模式是 null（內容欄由歌詞即時打）。 */
  body: Block | null = null;
  /** 歌詞模式：第 1 欄打歌名。 */
  title: Block | null = null;
  /** 留言沒填滿四行時，下一行寫「以下空白」（公文的老規矩：後面不能再加字）。 */
  blank: Block | null = null;
  sigText = '';
  sigSize = 44;
  sigFamily = F.hand(700);
  lyricCache = new Map<Line, Block>();
  /** 螢幕上的留言字級（算歌詞與署名的字級用）。 */
  msgScreen: number | null = null;

  // 時間點
  B = 0.5;
  tNum = 0; tType0 = 0; typeEnd = 0;
  tTick = 0; tCircle = Infinity; tSig = Infinity; sigEnd = Infinity; tSeal = 0; tFlourish = Infinity;
  sealRot = -0.085; sealDx = 0; sealDy = 0;
  shots: Shot[] = [];
  camStart: Cam = startOf(CAM_DESK);
  acts: Act[] = [];
  skeys: SKey[] = [];
  /** 章在印泥上拍的時間（畫面輕輕一震）。 */
  inkHits: number[] = [];

  override async init() {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const msg = this.msg;
    // 墨的畫布是不透明的（黑底 + lighter）：預乘與否一樣，標成預乘、不轉色彩空間，瀏覽器就走 GPU 直接複製（見 gl.ts 的 fast）
    this.ink.texture.colorSpace = THREE.NoColorSpace;
    this.ink.texture.premultiplyAlpha = true;
    this.mode = msg ? 'msg' : lyrics.has ? 'lyric' : 'invite';
    const songName = song.title ? `《${song.title}》${song.artist ? ' — ' + song.artist : ''}` : '今晚的歌';
    this.copy = makeCopy(this.seed, {
      no: msg ? `No.${pad(msg.n, 3)}${msg.couple ? ' · 新人' : ''}` : `SONG ${pad(song.index, 2)}`, couple: !!msg?.couple,
      // 有留言：第 1 欄是現場歌詞；沒有留言：第 1 欄打歌名，內容欄由歌手「代唱」
      field2: msg ? '現場歌詞' : '播放歌曲',
    });
    this.sigText = msg ? (msg.couple ? COUPLE_ZH : msg.name || '一位賓客') : lyrics.has ? song.artist || '今晚的歌手' : '全體賓客';
    const bodyText = msg ? msg.text : this.mode === 'invite' ? '掃描右下角 QR code，把祝福寫上大螢幕。' : null;
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(FORM_TEXT + this.sigText + songName + (bodyText ?? '') + lines.map((l) => l.text).join('') + this.copy.no);

    const c = this.ink.ctx;
    const w = L.col.x1 - L.col.x0;
    // ---- 排版（字級先照螢幕的標準算，再換成紙面字級）
    if (bodyText) {
      // 四行線、行距 90：兩行以上時字不能比行距的八成大（螢幕上約 49 px）；只有一行的短句可以到 60
      const rows = L.msg.rows, pitch = rows[1]! - rows[0]!;
      const maxS = Math.min(msgMaxFor(bodyText), V2.msgTiny);
      let size = onPaper(V2.msgMin);
      for (let S = maxS; S >= 36; S -= 1) {
        const ps = onPaper(S);
        c.font = font(HAND, ps);
        const n = wrap(c, bodyText, w).length;
        if (n <= rows.length && (n === 1 || ps <= pitch * 0.8)) { size = ps; break; }
      }
      this.body = typeset(c, bodyText, HAND, size, L.col.x0, rows, w, this.seed + 2, true);
      this.msgScreen = size * Z_READ;
      if (this.body.rows < rows.length) {
        const bt = '（以下空白）', bs = FS.gap;
        this.blank = typeset(c, bt, HAND, bs, (L.col.x0 + L.col.x1) / 2 - measure(bt, HAND, bs) / 2, [rows[this.body.rows]!], 2000, this.seed + 4, true);
        for (const ch of this.blank.chars) ch.dens *= 0.7;
      }
    }
    if (this.mode !== 'msg') {
      // 歌名一行放得下就一行，太長才折成兩行（第 1 欄有兩條線）；螢幕上 28～34 px（配角）
      const fam = F.ming(700);
      const size = fits(c, songName, fam, onPaper(28), w, 1) ? fitRows(c, songName, fam, w, 1, onPaper(34), onPaper(28)) : fitRows(c, songName, fam, w, 2, onPaper(30), onPaper(24));
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
    if ([bodyText ?? '', ...lines.map((l) => l.text)].some((x) => x.includes('♥'))) {
      this.rose = this.track(new Layer2D());
      this.rose.texture.colorSpace = THREE.NoColorSpace;
      this.rose.texture.premultiplyAlpha = true;
    }
    // 署名：螢幕上 26～32 px（留言的六成），簽名欄放不下就再小一點
    const sigS = onPaper(this.msgScreen ? sigV2(this.msgScreen) : V2.sigMax);
    c.font = font(this.sigFamily, sigS);
    this.sigSize = Math.min(sigS, Math.floor((sigS * L.sig.w) / Math.max(1, c.measureText(this.sigText).width)));
    // 桌上不會動的道具
    this.inkPad = makeInkPad();
    this.cup = makeCup();
    this.envelope = makeEnvelope();

    this.schedule();
    this.buildPen();
    // 底片先做好（窗格中途才做會卡一下）
    for (const b of this.blocks()) if (b.sprite === undefined) b.sprite = makeSprite(b);
  }

  /** 這個窗格所有寫字的塊（做底片、還畫布用）。 */
  private blocks(): Block[] {
    const ly = [...this.lyricCache.values()];
    return [this.body, this.title, this.blank, ...ly, ...ly.map((b) => b.sub)].filter((b): b is Block => !!b);
  }

  /** 排時間：寫字落在節拍格上、勾選／簽名／方章依序各佔一拍，窗格太短就一項一項省掉。 */
  private schedule() {
    const au = this.ctx.audio, s = this.ctx.start, e = this.ctx.end;
    const B = (this.B = au.beatPeriod(s + 0.2));
    const b0 = beatAfter(au, s + 0.06);
    // 方章最晚：結束前至少留兩拍（或一秒）讓人看清楚
    const sealLatest = e - Math.max(1.0, 2 * B);
    /**
     * n 個字要在 budget 秒內寫完：挑最慢、而且落在節拍細分上的速度（八分 → 十六分 → 三十二分 → 六十四分）。
     * maxStep：一個字最久幾秒（慢歌的十六分音符太慢，留言會寫到窗格快結束才寫完）。
     */
    const grid = (n: number, budget: number, kMin = 1, maxStep = Infinity) => {
      for (let k = kMin; k <= 4; k++) {
        const st = B / 2 ** k;
        if (st < 0.03) break;
        if (st <= maxStep && (n - 1) * st <= budget) return st;
      }
      return Math.max(0.028, budget / Math.max(1, n - 1));
    };
    /** 排一塊字的時間：手寫的字每個寫 0.88 拍格（一個字寫完、筆移到下一個字）。 */
    const assign = (b: Block, t0: number, step: number) => {
      b.chars.forEach((ch, i) => { ch.t = t0 + i * step; ch.d = b.hand ? Math.max(0.03, step * 0.88) : 0; });
      const last = b.chars[b.chars.length - 1]!;
      return last.t + last.d;
    };

    // 0. 第一拍：號碼機「喀」一聲蓋上編號
    this.tNum = b0;
    let cur = beatAfter(au, b0 + 0.05);
    // 歌詞模式：第 1 欄打歌名（快快的，一拍多一點）
    if (this.title) cur = beatAfter(au, assign(this.title, cur, grid(this.title.chars.length, 1.5 * B, 2)) + 0.05);
    // 1. 祝福內容：筆從桌上飛過來（前一拍起飛），兩小節內寫完（窗格短就更快），寫完之後至少留兩拍半給勾選與蓋章
    this.tType0 = cur;
    if (this.body) {
      const n = this.body.chars.length;
      // 最多兩小節、最多窗格的四成（留言寫完之後還要停留讓人讀），而且一個字不超過 0.16 秒
      const budget = Math.max(0.5, Math.min(b0 + 8 * B, sealLatest - 2.5 * B, s + 0.4 * (e - s)) - cur);
      this.typeEnd = assign(this.body, cur, grid(n, budget, 1, 0.16));
      // 以下空白：寫完留言的下一個八分音符，用十六分音符快快寫完；窗格太擠就不寫
      if (this.blank) {
        const t0 = au.timeOfBeat(Math.ceil(au.beatAt(this.typeEnd + 0.08) * 2) / 2);
        const end = t0 + this.blank.chars.length * (B / 4);
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
    // 簽完名過一小節還有空（離蓋章前拿章至少一小節）：筆在簽名底下補一道花式底線（中段的小事件）
    if (isFinite(this.sigEnd)) {
      const tf = barAfter(au, this.sigEnd + 3 * B);
      if (tf + 0.5 < this.tSeal - 4 * B) this.tFlourish = tf;
    }
    this.sealRot = -0.085 + (hash(this.seed, 9) - 0.5) * 0.06;
    this.sealDx = (hash(this.seed, 10) - 0.5) * 14;
    this.sealDy = (hash(this.seed, 11) - 0.5) * 10;
    this.buildStamp();

    // ---- 鏡頭：每個鏡位「緩進」到它的拍點上（最後落在拍上），方章那一下是甩過去的
    // 停住的鏡位也不完全靜止：很慢地推近、往右飄（pdoom 的鏡頭一直在呼吸）
    const drift = (cam: Cam, dt: number, rate = 0.008, dx = 6): Cam => {
      const u = Math.min(4, Math.max(0, dt));
      return { ...cam, x: cam.x + dx * u, z: cam.z * (1 + rate * u) };
    };
    const io = ease.inOutCubic;
    this.shots = [{ t0: s, t1: s + 0.75, e: ease.outExpo, cam: (t) => drift(CAM_DESK, t - s - 0.75, 0.006) }];
    this.camStart = startOf(CAM_DESK);
    // 筆開始寫：花整段寫字的時間慢慢推向留言（焦點從整張桌面移到留言上）
    if (this.body && this.tType0 < this.tTick) this.shots.push({ t0: this.tType0 - 0.3, t1: Math.max(this.tType0 + 0.6, Math.min(this.typeEnd, this.tType0 + 4 * B)), e: io, cam: (t) => this.writeCam(t) });
    this.shots.push({ t0: this.tTick - 0.5, t1: this.tTick, e: io, cam: (t) => drift(CAM_REVIEW, t - this.tTick) });
    // 中段很長：每兩小節在「看留言」與「看整張桌面」之間換，緩進小節線
    const holdFrom = (isFinite(this.sigEnd) ? this.sigEnd : this.tTick + B) + B;
    const holdTo = this.tSeal - 3 * B;
    let k = 0;
    for (let d = barAfter(au, holdFrom + 3 * B); d <= holdTo - 2 * B; d = barAfter(au, d + 7 * B)) {
      const msg = k++ % 2 === 0, t1 = d;
      this.shots.push({ t0: t1 - 1.5 * B, t1, e: io, cam: msg ? (t) => drift(CAM_MSG, t - t1, 0.005, 0) : (t) => drift(CAM_DESK, t - t1) });
    }
    this.shots.sort((a, b) => a.t0 - b.t0);
    this.shots.push({ t0: this.tSeal - 0.02, t1: this.tSeal + 0.3, e: ease.outExpo, cam: (t) => drift(CAM_WIDE, t - this.tSeal, 0.006) });
  }

  /** 章的關鍵格：從桌上拿起來 → 印泥上拍兩下（拍點）→ 砸在方章框裡（大拍點）→ 抬起來放回桌上。窗格短就不沾印泥。 */
  private buildStamp() {
    const B = this.B, ts = this.tSeal, s = this.ctx.start;
    const R = PROPS.stampRest, Pd = PROPS.pad;
    const sl = this.sealState(ts + 1);
    const rest = (t: number): SKey => ({ t, x: R.x, y: R.y, r: R.r, h: 0 });
    const k: SKey[] = [];
    const lift = ease.outCubic, drop = ease.inCubic;
    const earliest = Math.max(s + 0.2, this.typeEnd + 0.2);
    if (ts - 2.6 * B > earliest) {
      k.push(rest(ts - 2.6 * B));
      k.push({ t: ts - 2.25 * B, x: lerp(R.x, Pd.x, 0.6), y: lerp(R.y, Pd.y, 0.6), r: 0.06, h: 0.7, e: lift });
      k.push({ t: ts - 2 * B, x: Pd.x, y: Pd.y, r: 0.04, h: 0, e: drop });
      k.push({ t: ts - 1.5 * B, x: Pd.x + 4, y: Pd.y - 6, r: 0.02, h: 0.32, e: lift });
      k.push({ t: ts - B, x: Pd.x, y: Pd.y, r: 0.03, h: 0, e: drop });
      this.inkHits = [ts - 2 * B, ts - B];
      k.push({ t: ts - 0.5 * B, x: lerp(Pd.x, sl.x, 0.5), y: lerp(Pd.y, sl.y, 0.5) - 60, r: lerp(0.03, sl.rot, 0.5), h: 1, e: lift });
    } else {
      k.push(rest(Math.max(s, ts - 1.2 * B)));
      k.push({ t: ts - 0.45 * B, x: lerp(R.x, sl.x, 0.5), y: lerp(R.y, sl.y, 0.5) - 60, r: lerp(R.r, sl.rot, 0.5), h: 1, e: lift });
    }
    k.push({ t: ts, x: sl.x, y: sl.y, r: sl.rot, h: 0, e: drop });
    k.push({ t: ts + 0.16, x: sl.x, y: sl.y, r: sl.rot, h: 0 });
    k.push({ t: ts + 0.46, x: sl.x + 90, y: sl.y + 40, r: sl.rot + 0.05, h: 0.8, e: lift });
    k.push({ t: ts + 0.46 + clamp(1.4 * B, 0.5, 0.9), x: R.x, y: R.y, r: R.r, h: 0, e: ease.inOutCubic });
    this.skeys = k;
  }

  /** 章在 t 時的姿勢（在第一個關鍵格之前、最後一個之後都放在桌上）。 */
  private stampAt(t: number): SKey {
    const k = this.skeys, R = PROPS.stampRest;
    if (!k.length || t <= k[0]!.t) return { t, x: R.x, y: R.y, r: R.r, h: 0 };
    for (let i = 1; i < k.length; i++) {
      const b = k[i]!;
      if (t > b.t) continue;
      const a = k[i - 1]!;
      const u = clamp((t - a.t) / Math.max(1e-3, b.t - a.t));
      const eu = (b.e ?? ease.inOutCubic)(u);
      const pu = ease.inOutCubic(u);
      return { t, x: lerp(a.x, b.x, pu), y: lerp(a.y, b.y, pu), r: lerp(a.r, b.r, pu), h: lerp(a.h, b.h, eu) };
    }
    const l = k[k.length - 1]!;
    return { ...l, t };
  }

  // ------------------------------------------------------------------ 筆
  /** 手寫的一塊字：筆尖在正在寫的字上從左往右畫小小的起伏，寫完移到下一個字（換行時抬高一點）。 */
  private blockAct(b: Block): Act | null {
    const cs = b.chars.filter((ch) => ch.ch !== ' ');
    if (!cs.length) return null;
    const S = b.size;
    const nib = (ch: TChar, r: number) => ({ x: ch.x + ch.jx + r * ch.w * 0.92 + 3, y: ch.y - S * 0.32 + S * 0.24 * Math.sin(r * TAU * 1.25 + ch.x * 0.05) });
    return {
      t0: cs[0]!.t, t1: cs[cs.length - 1]!.t + cs[cs.length - 1]!.d,
      at: (t) => {
        let i = 0;
        while (i + 1 < cs.length && cs[i + 1]!.t <= t) i++;
        const ch = cs[i]!;
        const r = clamp((t - ch.t) / Math.max(1e-3, ch.d));
        if (r < 1 || i + 1 >= cs.length) return { ...nib(ch, r), lift: 0.03 * Math.abs(Math.sin(r * TAU)) };
        const nx = cs[i + 1]!, u = clamp((t - ch.t - ch.d) / Math.max(1e-3, nx.t - ch.t - ch.d));
        const a = nib(ch, 1), bb = nib(nx, 0), eu = ease.inOutQuad(u);
        return { x: lerp(a.x, bb.x, eu), y: lerp(a.y, bb.y, eu), lift: (nx.row !== ch.row ? 0.45 : 0.14) * Math.sin(Math.PI * u) };
      },
    };
  }

  /** 排出筆這個窗格的所有動作：寫留言 →（以下空白）→ 勾 → 圈 → 簽名 →（花式底線）。 */
  private buildPen() {
    const acts: Act[] = [];
    for (const b of [this.body, this.blank]) { const a = b ? this.blockAct(b) : null; if (a) acts.push(a); }
    // 勾：短短往下、長長往右上甩出框外
    const tk = this.tickPath();
    acts.push({ t0: this.tTick - 0.02, t1: this.tTick + 0.11, at: (t) => ({ ...tk(prog(t, this.tTick, this.tTick + 0.11, ease.outQuad)), lift: 0 }) });
    if (isFinite(this.tCircle)) {
      const cp = this.circlePath(), dur = Math.min(0.35, this.B * 0.8);
      acts.push({ t0: this.tCircle, t1: this.tCircle + dur, at: (t) => ({ ...cp(prog(t, this.tCircle, this.tCircle + dur, ease.inOutCubic)), lift: 0 }) });
    }
    if (isFinite(this.tSig)) {
      const lay = layout(this.sigText, this.sigFamily, this.sigSize);
      const n = lay.glyphs.length, dur = this.sigEnd - this.tSig - 0.15, per = dur / Math.max(1, n);
      const sz = this.sigSize, x0 = L.sig.x, y0 = L.sig.y - 2, tail = this.sigTail(lay.width);
      acts.push({
        t0: this.tSig, t1: this.sigEnd + 0.05,
        at: (t) => {
          if (t >= this.sigEnd - 0.15) return { ...tail(prog(t, this.sigEnd - 0.15, this.sigEnd + 0.05, ease.outCubic)), lift: 0 };
          const i = clamp(Math.floor((t - this.tSig) / per), 0, n - 1), g = lay.glyphs[i]!, r = clamp((t - this.tSig - i * per) / per);
          return { x: x0 + g.x + r * g.w, y: y0 - sz * 0.35 + sz * 0.28 * Math.sin(r * TAU * 1.4 + i), lift: 0.02 };
        },
      });
    }
    if (isFinite(this.tFlourish)) {
      const fp = this.flourishPath();
      acts.push({ t0: this.tFlourish, t1: this.tFlourish + 0.42, at: (t) => ({ ...fp(prog(t, this.tFlourish, this.tFlourish + 0.42, ease.inOutQuad)), lift: 0 }) });
    }
    this.acts = acts.filter((a) => isFinite(a.t0) && a.t1 > a.t0).sort((a, b) => a.t0 - b.t0);
  }

  /** 筆在 t 時的姿勢：筆尖位置、筆身方向、抬多高、是不是躺在桌上。 */
  private penAt(t: number): { x: number; y: number; a: number; lift: number; rest: number } {
    const R = PROPS.penRest, acts = this.acts;
    const rest = { x: R.x, y: R.y, a: R.a, lift: 0, rest: 1 };
    if (!acts.length) return rest;
    // 在兩個姿勢之間移動：弧形抬起再放下（距離越遠抬越高），方向與「躺／拿」一起換
    const move = (p: { x: number; y: number; lift: number; a: number; rest: number }, q: { x: number; y: number; lift: number; a: number; rest: number }, u: number) => {
      const eu = ease.inOutCubic(u);
      const dist = Math.hypot(q.x - p.x, q.y - p.y);
      return {
        x: lerp(p.x, q.x, eu), y: lerp(p.y, q.y, eu), a: lerp(p.a, q.a, eu), rest: lerp(p.rest, q.rest, eu),
        lift: lerp(p.lift, q.lift, eu) + Math.min(1, 0.15 + dist / 700) * Math.sin(Math.PI * u),
      };
    };
    const held = (p: P & { lift: number }) => ({ ...p, a: PEN_WRITE_A, rest: 0 });
    const first = acts[0]!, last = acts[acts.length - 1]!;
    const tIn = Math.min(0.5, Math.max(0.2, first.t0 - this.ctx.start - 0.05));
    if (t < first.t0) return t < first.t0 - tIn ? rest : move(rest, held(first.at(first.t0)), (t - first.t0 + tIn) / tIn);
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i]!;
      if (t <= a.t1) return held(a.at(t));
      const nx = acts[i + 1];
      if (nx && t < nx.t0) {
        // 兩個動作之間空很久（> 1.2 秒）：先躺回桌上，下一個動作前再拿起來
        const gap = nx.t0 - a.t1, tr = Math.min(0.5, gap / 2);
        if (gap > 1.2) {
          if (t < a.t1 + tr) return move(held(a.at(a.t1)), rest, (t - a.t1) / tr);
          if (t > nx.t0 - tr) return move(rest, held(nx.at(nx.t0)), (t - nx.t0 + tr) / tr);
          return rest;
        }
        return move(held(a.at(a.t1)), held(nx.at(nx.t0)), (t - a.t1) / gap);
      }
    }
    const back = 0.6;
    return t < last.t1 + back ? move(held(last.at(last.t1)), rest, (t - last.t1) / back) : rest;
  }

  // ------------------------------------------------------------------ 筆畫的路徑（勾、圈、簽名的尾巴、花式底線）
  private tickPath() {
    const b = L.checks.box, y = L.checks.y0 + 3 * L.checks.gap;
    const bx = L.right.x0 + 2, by = y - b + 2;
    const pts = [[bx + 4, by + b * 0.45], [bx + b * 0.42, by + b + 4], [bx + b + 26, by - 28]] as const;
    const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
    return (p: number) => {
      const len = (l1 + l2) * p;
      if (len <= l1) return { x: lerp(pts[0][0], pts[1][0], len / l1), y: lerp(pts[0][1], pts[1][1], len / l1) };
      return { x: lerp(pts[1][0], pts[2][0], (len - l1) / l2), y: lerp(pts[1][1], pts[2][1], (len - l1) / l2) };
    };
  }
  private circleGeo() {
    const y = L.checks.y0 + 3 * L.checks.gap;
    const tw = measure(this.copy.checks[3]!, CHECK_FONT(), FS.check, CHECK_TRACK);
    return { cx: L.right.x0 + L.checks.box + 22 + tw / 2, cy: y - 11, rx: tw / 2 + 26, ry: 28, a0: -2.5 };
  }
  private circlePath() {
    const g = this.circleGeo();
    return (q: number) => {
      const a = g.a0 + (Math.PI * 2 + 0.55) * q;
      const r = 1 + 0.05 * Math.sin(3 * a + this.seed) + 0.04 * (a - g.a0) / (Math.PI * 2);
      return { x: g.cx + Math.cos(a) * g.rx * r, y: g.cy + Math.sin(a) * g.ry * r - 0.05 * Math.cos(a) * g.rx * r };
    };
  }
  /** 簽名的尾巴：一條往右上揚的弧線（紙面座標）。 */
  private sigTail(w: number) {
    const x0 = L.sig.x, y0 = L.sig.y - 2, rot = -0.035, cs = Math.cos(rot), sn = Math.sin(rot);
    return (k: number) => {
      const x = lerp(-14, w + 70, k), y = 20 - 32 * k * k + 10 * Math.sin(k * Math.PI);
      return { x: x0 + x * cs - y * sn, y: y0 + x * sn + y * cs };
    };
  }
  /** 花式底線：簽名底下一道波浪。 */
  private flourishPath() {
    const w = measure(this.sigText, this.sigFamily, this.sigSize);
    const x0 = L.sig.x - 20, x1 = L.sig.x + w + 110, y = L.sig.y + 40;
    return (k: number) => ({ x: lerp(x0, x1, k), y: y + 9 * Math.sin(k * TAU * 1.5 + 0.4) * (1 - 0.5 * k) - 8 * k });
  }

  /** 歌詞一行的排版與每個字的時間（字在它那個詞開始唱時打上去；英文一個詞裡的字母用自然的打字速度）。 */
  private lyricBlock(line: Line): Block {
    const hit = this.lyricCache.get(line);
    if (hit) return hit;
    const c = this.ink.ctx, fam = TYPEF, w = L.col.x1 - L.col.x0;
    // 有留言：歌詞在第 1 欄（兩行線，不比留言大）；沒有留言：歌詞就是祝福內容（焦點，螢幕上 52 px，最多三行）
    const rows = this.mode === 'msg' ? L.lyric.rows : L.msg.rows;
    const top = onPaper(lyricV2(this.msgScreen));
    const size = this.mode === 'msg' ? fitRowsOr(c, line.text, fam, w, 2, top, onPaper(V2.lyrMin), onPaper(34))
      : fitRowsOr(c, line.text, fam, w, 3, top, onPaper(V2.lyrMin), onPaper(34));
    const b = typeset(c, line.text, fam, size, L.col.x0, rows, w, this.seed + 100 + line.i);
    timeChars(b, line);
    // 韓文歌（沒有留言、歌詞寫在內容欄時）：原文小一號打在中文下面的那幾條線上——表格的字只能寫在印好的線上，
    // 所以基線是下一條線（比 subGap 鬆一點，但跟表格一致）。線不夠就縮到一行；中文佔滿了就不打原文
    const sub = this.mode === 'lyric' ? lyricSubOf(line) : null;
    const left = rows.slice(b.rows);
    if (sub && left.length) {
      const ss = subSizeFor(size * Z_READ);
      const n = Math.min(2, left.length);
      const sz = fitRowsOr(c, sub.text, fam, w, n, onPaper(ss), onPaper(Math.min(ss, 26)), onPaper(22));
      b.sub = typeset(c, sub.text, fam, sz, L.col.x0, left.slice(0, n), w, this.seed + 300 + line.i);
      timeChars(b.sub, sub);
    }
    this.lyricCache.set(line, b);
    return b;
  }

  // ------------------------------------------------------------------ 鏡頭
  /** 寫留言時的取景：跟著筆尖微微移（取 0.4 秒平均，換行時不會甩）。 */
  private writeCam(t: number): Cam {
    let x = 0, y = 0;
    const N = 5;
    for (let i = 0; i < N; i++) { const p = this.penAt(t - (i * 0.4) / N); x += p.x; y += p.y; }
    x /= N; y /= N;
    return { ...CAM_WRITE, x: CAM_WRITE.x + clamp((x - 730) * 0.05, -26, 26), y: CAM_WRITE.y + clamp((y - 740) * 0.05, -10, 10) };
  }
  camAt(t: number): Cam {
    // 鏡位依序疊上去；已經完全到位的鏡位會蓋掉前面所有的，從最後一個到位的開始算就好
    let i0 = -1;
    for (let i = 0; i < this.shots.length; i++) if (t >= this.shots[i]!.t1) i0 = i;
    let cam = i0 >= 0 ? this.shots[i0]!.cam(t) : this.camStart;
    for (let i = i0 + 1; i < this.shots.length; i++) {
      const sh = this.shots[i]!, k = prog(t, sh.t0, sh.t1, sh.e);
      if (k > 0) cam = lerpCam(cam, sh.cam(t), k);
    }
    // 大鼓讓畫面輕輕往前推一下；蓋章那一下衝得更多
    const z = 1 + 0.005 * this.ctx.audio.hit('kick', t, 0.12) + 0.04 * pulse(t, this.tSeal, 0.09);
    return { ...cam, z: cam.z * z };
  }
  /** 震動（螢幕像素）：勾選、號碼機、章在印泥上拍、蓋章。方向用逐格的 hash（確定性）。 */
  private shake(t: number): [number, number] {
    let amp = 16 * pulse(t, this.tSeal, 0.07) + 3 * pulse(t, this.tTick, 0.05) + 3 * pulse(t, this.tNum, 0.05);
    for (const h of this.inkHits) amp += 2.5 * pulse(t, h, 0.05);
    const ph = frameIdx(t);
    return [amp * (hash(ph, 11) - 0.5) * 2, amp * (hash(ph, 12) - 0.5) * 2];
  }

  override dispose() {
    // 表格畫布一張好幾 MB：窗格結束馬上還
    this.formTex?.dispose();
    for (const b of this.blocks()) if (b.sprite) { b.sprite.cv.width = b.sprite.cv.height = 0; b.sprite = null; }
    if (this.form) { this.form.width = this.form.height = 0; this.form = null; }
    for (const a of [this.inkPad, this.cup, this.envelope]) if (a) a.cv.width = a.cv.height = 0;
    // 共用的紙張 pass 會留著這一格的貼圖參照：換成不會被釋放的烤紙貼圖，下一個版面物件設好之前不會去上傳已經釋放的畫布
    const Pu = this.paper.u;
    Pu.inkTex!.value = Pu.roseTex!.value = Pu.formTex!.value = this.bake.rt.texture;
    super.dispose();
  }

  // ------------------------------------------------------------------ 畫
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
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
    this.drawField2(c, hc, t);
    this.drawBody(c, hc, t);
    this.drawChecks(c, t);
    this.drawSignature(c, t);
    this.drawSeal(c, t);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';

    const Pu = this.paper.u;
    Pu.inkTex!.value = I.upload();
    Pu.roseOn!.value = this.rose ? 1 : 0;
    Pu.bakeTex!.value = this.bake.rt.texture;
    Pu.formTex!.value = this.formTex;
    // 沒有愛心的那層：取樣器也要綁一張有效的貼圖（別綁到上一個窗格已經釋放的畫布）
    Pu.roseTex!.value = this.rose ? this.rose.upload() : I.texture;
    (Pu.camA!.value as THREE.Vector3).set(im.a, im.c, im.e);
    (Pu.camB!.value as THREE.Vector3).set(im.b, im.d, im.f);
    (Pu.blurV!.value as THREE.Vector2).set(bl[0], bl[1]);
    Pu.dofR!.value = 0;
    Pu.uT!.value = t;
    const sl = this.sealState(t);
    (Pu.st0!.value as THREE.Vector4).set(sl.x, sl.y, (sl.side / 2) * 1.14 * sl.scale, (sl.side / 2) * 1.14 * sl.scale);
    (Pu.st0b!.value as THREE.Vector4).set(sl.rot, sl.on ? sl.strength : 0, 3.7 + (this.seed % 7), 0);
    this.paper.render(renderer, out);

    // ---- 桌上的道具（同一個鏡頭）
    this.drawProps(t, m);
    comp.draw(renderer, this.props.upload(), out);
    this.drawDust(t);
    if (this.dust.count) this.dust.render(renderer, out);
    return { paper: 0, bloom: 0.15, bloomThreshold: 1.8, halation: 0.03, vignette: 0.26, grain: 0.045, ca: 0.5 };
  }

  /** 茶杯（熱氣、漣漪）、印泥盒、筆、章。 */
  private drawProps(t: number, m: Xf) {
    const Lp = this.props, c = Lp.ctx;
    Lp.clear();
    c.save();
    c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    if (this.envelope) drawArt(c, this.envelope, PROPS.envelope.x, PROPS.envelope.y);
    const cp = PROPS.cup;
    if (this.cup) drawArt(c, this.cup, cp.x, cp.y);
    drawRipple(c, cp.x, cp.y, this.ctx.audio.hit('kick', t, 0.3));
    if (this.inkPad) drawArt(c, this.inkPad, PROPS.pad.x, PROPS.pad.y);
    const p = this.penAt(t);
    const st = this.stampAt(t);
    // 抬起來的東西蓋在上面：章比筆高就後畫
    const pen = () => drawPen(c, p.x, p.y, p.a, p.lift, p.rest);
    const stamp = () => drawStamp(c, st.x, st.y, st.r, st.h);
    if (st.h > p.lift) { pen(); stamp(); } else { stamp(); pen(); }
    // 熱氣往上飄：畫在最上面（筆、章不會飛到茶杯上方）
    drawSteam(c, cp.x - 6, cp.y - 10, t, this.seed % 7);
    c.restore();
  }

  /** 桌燈光裡的飛塵：很小、很慢地飄（螢幕座標），偶爾轉到光裡亮一下。 */
  private drawDust(t: number) {
    const db = this.dust; db.clear();
    const bone = LIN.bone;
    for (let k = 0; k < 40; k++) {
      const sp = 0.012 + 0.02 * hash(this.seed, k, 2);
      const u = (hash(this.seed, k, 1) + t * sp) % 1;
      const x = 120 + 1680 * hash(this.seed, k, 3) + 40 * Math.sin(t * 0.3 + k);
      const y = 1040 - u * 1000 + 14 * Math.sin(t * 0.7 + k * 1.3);
      const a = Math.sin(u * Math.PI) * (0.08 + 0.2 * hash(this.seed, k, 4)) * (0.5 + 0.5 * Math.sin(t * (0.9 + hash(this.seed, k, 5)) + k * 3));
      if (a <= 0.01) continue;
      db.seg2(x, y, x + 0.6, y + 0.6, 1.6, [bone[0] * a, bone[1] * a, bone[2] * a], 1);
    }
  }

  /**
   * 畫寫（或打）上去的字。`lyric`：歌詞（正在唱的詞用訊號色印泥、唱完變墨色、還沒打的字 preview 透明度先出現）。
   * 手寫的字（b.hand）用斜遮罩一筆一筆寫出來；♥ 另外印在玫瑰色那一層（愛心是唯一用點綴色的東西）。
   */
  private drawTyped(c: Ctx2, hc: Ctx2 | null, b: Block, t: number, o: { alpha?: number; lyric?: boolean; preview?: number } = {}) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0.001) return;
    c.font = font(b.family, b.size);
    if (hc) hc.font = c.font;
    if (b.sprite === undefined) b.sprite = makeSprite(b);
    const sp = b.sprite;
    // 逐字畫：愛心、正在寫的字、剛打上去還在彈的字、正在唱的字（訊號色）；其他的字從底片整段貼過去
    const one = (ch: TChar) => {
      const heart = ch.ch === '♥' && hc;
      const ctx = heart ? hc! : c;
      if (t < ch.t) {
        if (o.preview) { ctx.fillStyle = TYPE(o.preview * alpha); ctx.fillText(ch.ch, ch.x, ch.y); }
        return;
      }
      ctx.save();
      if (b.hand) {
        const r = clamp((t - ch.t) / Math.max(1e-3, ch.d));
        if (r < 1) {
          const top = ch.y - b.size * 0.98, h = b.size * 1.3, S = r * (ch.w + SK * h);
          ctx.beginPath();
          ctx.moveTo(ch.x - 10, top - 8); ctx.lineTo(ch.x + S + 8 * SK, top - 8); ctx.lineTo(ch.x + S - SK * (h + 8), top + h + 8); ctx.lineTo(ch.x - 10, top + h + 8);
          ctx.closePath(); ctx.clip();
        }
        ctx.translate(ch.x + ch.jx, ch.y + ch.jy);
        ctx.rotate(ch.rot);
        // 剛寫的字墨還是濕的：濃一點
        ctx.fillStyle = TYPE(Math.min(1, (heart ? 1 : ch.dens) + 0.15 * (1 - clamp((t - ch.t - ch.d) / 0.5))) * alpha);
      } else {
        const fresh = pulse(t, ch.t, 0.035);
        ctx.translate(ch.x + ch.jx, ch.y + ch.jy - 3.5 * fresh);
        ctx.rotate(ch.rot);
        ctx.fillStyle = heart ? TYPE(alpha) : o.lyric && t < ch.we ? SIG(alpha) : TYPE(Math.min(1, ch.dens + 0.2 * fresh) * alpha);
      }
      ctx.fillText(ch.ch, 0, 0);
      ctx.restore();
    };
    if (!sp) { for (const ch of b.chars) if (ch.ch !== ' ') one(ch); return; }
    const cs = b.chars, right = sp.x0 + sp.cv.width / SPR_RES;
    // 'd' 寫好了（貼底片）、'u' 還沒寫（有預告就淡淡地貼底片）、'x' 逐字畫
    const kind = (ch: TChar) => ch.ch === '♥' ? 'x' : t < ch.t ? 'u' : ch.ch === ' ' ? 'd'
      : b.hand ? (t < ch.t + ch.d + 0.5 ? 'x' : 'd') : t - ch.t < 0.2 || (o.lyric && t < ch.we) ? 'x' : 'd';
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

  /** 編號：第一個拍點用號碼機蓋在表頭右端（訊號色，稍微歪；號碼機是表格上唯一會「喀」一聲的東西）。 */
  private drawNumber(c: Ctx2, t: number) {
    if (t < this.tNum) return;
    const k = prog(t, this.tNum, this.tNum + 0.05, ease.outQuad), sc = lerp(1.14, 1, k);
    c.save();
    c.translate(L.numberAt.x, L.numberAt.y); c.rotate(-0.022); c.scale(sc, sc);
    c.font = font(F.mono(600), 28); c.letterSpacing = '5px';
    c.textAlign = 'right';
    c.fillStyle = SIG(0.9);
    c.fillText(this.copy.no, 0, 0);
    c.restore();
  }

  /** 第 1 欄：有留言時是現場歌詞；沒有留言時打歌名（歌詞改到內容欄）。 */
  private drawField2(c: Ctx2, hc: Ctx2 | null, t: number) {
    if (this.title) { this.drawTyped(c, hc, this.title, t); return; }
    const ly = lyricAt(this.ctx.lyrics, t);
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
    c.font = font(F.hei(500), FS.gap); c.letterSpacing = '5px';
    c.fillText(lyrics.has ? '♪  （間奏中）' : '♪  本曲為純音樂，請自行哼唱', L.col.x0 + 8, y);
    c.restore();
  }

  /** 內容欄：留言（或邀請）一個字一個字寫上去；歌詞模式是正在唱的那一行。 */
  private drawBody(c: Ctx2, hc: Ctx2 | null, t: number) {
    if (this.body) {
      this.drawTyped(c, hc, this.body, t);
      if (this.blank) this.drawTyped(c, hc, this.blank, t);
      return;
    }
    const ly = lyricAt(this.ctx.lyrics, t, 1.6);
    if (ly) {
      const b = this.lyricBlock(ly.line);
      this.drawTyped(c, hc, b, t, { alpha: ly.k, lyric: true, preview: 0.3 });
      // 原文比中文安靜：不用訊號色的印泥（lyric: false），打上去的字淡兩成；還沒打的預告一樣三成（0.375 × 0.8）
      if (b.sub) this.drawTyped(c, hc, b.sub, t, { alpha: ly.k * 0.8, preview: 0.375 });
    } else this.drawGap(c, t, L.msg.rows[0], 1.6);
  }

  /** 「以上皆是」：筆在拍點上「刷」一勾（訊號色的墨），下一拍再圈起來。 */
  private drawChecks(c: Ctx2, t: number) {
    if (t < this.tTick) return;
    c.save();
    c.strokeStyle = SIG(1); c.lineCap = 'round'; c.lineJoin = 'round';
    const tk = this.tickPath();
    const p = prog(t, this.tTick, this.tTick + 0.11, ease.outQuad);
    c.lineWidth = 6;
    c.beginPath();
    for (let i = 0; i <= 16; i++) { const q = tk((p * i) / 16); if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }
    c.stroke();
    // 圈：繞「以上皆是」一圈多一點，半徑有一點手抖
    if (t >= this.tCircle) {
      const q = prog(t, this.tCircle, this.tCircle + Math.min(0.35, this.B * 0.8), ease.inOutCubic);
      const cp = this.circlePath();
      c.lineWidth = 3.8;
      c.beginPath();
      for (let i = 0; i <= 48; i++) { const pt = cp((q * i) / 48); if (i) c.lineTo(pt.x, pt.y); else c.moveTo(pt.x, pt.y); }
      c.stroke();
    }
    c.restore();
  }

  /** 簽名：筆一個字一個字斜斜地寫出來（跟仙女棒寫字同一種遮罩），寫完拉一條尾巴；有空再補一道花式底線。 */
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
    c.restore();
    c.save();
    c.strokeStyle = TYPE(0.9); c.lineWidth = 3; c.lineCap = 'round';
    // 尾巴：一條往右上揚的弧線
    const u = prog(t, this.sigEnd - 0.15, this.sigEnd + 0.05, ease.outCubic);
    if (u > 0) {
      const tail = this.sigTail(lay.width);
      c.beginPath();
      for (let i = 0; i <= 20 * u; i++) { const q = tail(i / 20); if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }
      c.stroke();
    }
    const fu = prog(t, this.tFlourish, this.tFlourish + 0.42, ease.inOutQuad);
    if (fu > 0) {
      const fp = this.flourishPath();
      c.lineWidth = 2.6;
      c.beginPath();
      for (let i = 0; i <= 40 * fu; i++) { const q = fp(i / 40); if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }
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
   * 方章（陽刻：紅框紅字，紙色留白）。整塊實心的陰刻章是一大塊訊號色，會比寫上去的祝福還搶眼；
   * 陽刻章一樣是「砸下來」的那一下，但留言還是整張紙的主角。四個字由左而右、由上而下排：
   * 傳統印章是右行直讀，但大螢幕上只看一眼，橫著讀才不會被念成「好百合年」。
   */
  private drawSeal(c: Ctx2, t: number) {
    const s = this.sealState(t);
    if (!s.on) return;
    const S = s.side, h = S / 2;
    c.save();
    c.translate(s.x, s.y); c.rotate(s.rot); c.scale(s.scale, s.scale);
    c.strokeStyle = SIG(1); c.lineWidth = 11;
    c.beginPath(); c.roundRect(-h + 5.5, -h + 5.5, S - 11, S - 11, 12); c.stroke();
    c.fillStyle = SIG(1);
    const chars = Array.from(this.copy.seal);
    const cell = (S - 40) / 2, size = cell * 0.98;
    c.font = font(F.ming(900), size);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const pos = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
    chars.slice(0, 4).forEach((ch, i) => {
      const [cx, cy] = pos[i]!;
      c.fillText(ch, -h + 20 + cell * (cx + 0.5), -h + 20 + cell * (cy + 0.5) + size * 0.04);
    });
    c.restore();
  }
}
