// 祝福登記表（亮版面）：照 pdoom 的 bureau（FIG. 7「Paperwork」）改的。一張正式的表格，鏡頭貼著打字機走：
//  - 第一個拍點起，登記人（留言的名字）一個字一個八分音符打上去；下一拍開始打祝福內容（逐字、落在十六／三十二分音符上），
//    鏡頭跟著打字頭走、換行時甩回左邊。
//  - 打完的下一拍，「以上皆是」被紅筆「刷」地勾起來、再圈一圈；接著簽名欄手寫簽名；時間夠的話登記人那一欄的右端
//    蓋一個「核准」橡皮章（窗格長時挪到中段，整段都有事發生）；中段每兩小節換一次鏡位。
//  - 留言沒填滿三行，下一行打「（以下空白）」。
//  - 最後一個大拍點（窗格結束前的最後一個小節線）：訊號色的方章「百年好合」砸在「核准章」框裡——稍微歪、稍微超出框線，
//    鏡頭同時拉到全景、畫面震一下。
//  - 歌詞在「2. 現場歌詞」欄，照跟唱規則：還沒唱的字三成淡淡地先出現、唱到的那一刻打上去（訊號色）、唱完變成墨色。
//  - 沒有留言：登記人是「歌手（代唱）」，祝福內容欄改由歌詞一句一句打上去；純音樂又沒留言：打一句邀請大家掃 QR。
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
import { PAPER_FRAG, BAKE_FRAG, BAKE } from './certificate-glsl';
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
// 不會落進右下角 QR 區（x ≥ 1360 且 y ≥ 830），而且右上角（x ≥ 1378、y ≤ 約 400）一直是空的——那是留給即時小卡的位置
// （表頭與資料列只是裝飾，被小卡蓋住沒關係）。
/** 切進來的那一格：比第一個鏡位再近一點、歪一點，0.75 秒內落定（pdoom 的 settle）。這樣推近時字也還在安全範圍內。 */
const startOf = (c: Cam): Cam => ({ x: c.x + 30, y: c.y - 30, z: c.z * 1.1, r: c.r - 0.03 });
/** 打名字：登記人＋現場歌詞兩欄。 */
const CAM_NAME: Cam = { x: 700, y: 400, z: 1.45, r: -0.03 };
/**
 * 打祝福內容：z 1.2 時主欄剛好填滿畫面寬（左緣 ≥ 96、歌詞右端 < 1378 讓出右上角給小卡）；
 * y 在 596～612 之間：名字不出上緣、第三行不碰 QR 區。x 只能跟著打字頭輕輕晃 ±8（再多就壓到兩邊的限制）。
 */
const CAM_TYPE = { z: 1.2, r: -0.018, x: 896, sway: 8, y0: 596, dy: 8 };
/** 看整張（勾選、簽名、核准章都在裡面）。 */
const CAM_REVIEW: Cam = { x: 960, y: 575, z: 1.06, r: -0.012 };
/** 長窗格的中段：在「看整張」與「看留言」之間，每兩小節換一次（「看留言」不往右飄，右上角才留得住）。 */
const CAM_MSG: Cam = { x: 896, y: 606, z: 1.16, r: -0.026 };
/** 蓋章：全景。 */
const CAM_WIDE: Cam = { x: 960, y: 540, z: 0.965, r: -0.006 };

const PAPER = () => new FSPass(PAPER_FRAG, {
  inkTex: { value: null }, roseTex: { value: null }, bakeTex: { value: null }, roseOn: { value: 0 },
  camA: { value: new THREE.Vector3() }, camB: { value: new THREE.Vector3() },
  blurV: { value: new THREE.Vector2() },
  st0: { value: new THREE.Vector4() }, st0b: { value: new THREE.Vector4() },
  st1: { value: new THREE.Vector4() }, st1b: { value: new THREE.Vector4() },
});

/** 紙的紋理只烤一次（整晚共用；只存明暗不存顏色，換主題不用重烤）。 */
const BAKED = () => ({
  rt: makeRT(BAKE.w, BAKE.h, { pxScale: 1, type: THREE.UnsignedByteType, depthBuffer: false }),
  pass: new FSPass(BAKE_FRAG),
  done: false,
});

/**
 * 印好的表格每格都一樣：開場時先畫在一張紙面座標的畫布上（1.5 倍解析度，鏡頭推到 1.45 倍時字還是銳利的），
 * 每格只要 drawImage 一次。逐格重畫表格要 3 毫秒多（一堆字型切換），內顯筆電吃不消。
 */
const FORM_BOX = { x: 60, y: 80, w: 1720, h: 930 }, FORM_RES = 1.5;

/** 打字機打上去的一個字。ws/we：歌詞的字所屬那個詞的開始／結束（決定訊號色或墨色）。 */
interface TChar { ch: string; x: number; y: number; t: number; dens: number; jx: number; jy: number; rot: number; ws: number; we: number }
interface Block { chars: TChar[]; family: string; size: number; rows: number }
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
        ch: g.ch, x: x0 + g.x, y, t: 0, ws: o, we: 0,
        dens: 0.8 + 0.2 * hash(seed, o, 1), jx: (hash(seed, o, 2) - 0.5) * 1.6, jy: (hash(seed, o, 3) - 0.5) * 2.2, rot: (hash(seed, o, 17) - 0.5) * 0.022,
      });
      o += g.ch.length;
    }
  });
  return { chars, family, size, rows: lines.length };
}

const pad = (n: number, k: number) => String(Math.max(0, Math.floor(n))).padStart(k, '0');

export default class Certificate extends Scene {
  ink = this.track(new Layer2D());
  /** 愛心用點綴色（玫瑰）印：只有打的字裡有 ♥ 才建這一張（多一張上傳）。 */
  rose: Layer2D | null = null;
  paper = shared('certificate.paper', PAPER);
  bake = shared('certificate.bake', BAKED);
  form: HTMLCanvasElement | null = null;
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
  tTick = 0; tCircle = Infinity; tSig = Infinity; sigEnd = Infinity; tApp = Infinity; tSeal = 0;
  sealRot = -0.085; sealDx = 0; sealDy = 0;
  shots: Shot[] = [];
  /** 即時小卡要避開的範圍（螢幕座標，整個窗格一份）。 */
  avoid: [number, number, number, number][] = [];
  camStart: Cam = startOf(CAM_NAME);

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const msg = this.msg;
    this.ink.texture.colorSpace = THREE.NoColorSpace;
    this.mode = msg ? 'msg' : lyrics.has ? 'lyric' : 'invite';
    const songName = song.title ? `《${song.title}》${song.artist ? ' — ' + song.artist : ''}` : '今晚的歌';
    this.copy = makeCopy(this.seed, {
      no: msg ? `No.${pad(msg.n, 3)}` : `SONG ${pad(song.index, 2)}`, couple: !!msg?.couple,
      // 有留言：第 2 欄是現場歌詞，旁邊小字註記歌名；沒有留言：第 2 欄打歌名，內容欄由歌手「代唱」
      field2: msg ? ['現場歌詞', 'LIVE LYRICS', `本表填寫時播放之歌曲：${songName}`]
        : lyrics.has ? ['播放歌曲', 'NOW PLAYING', '祝福內容由歌手代唱，逐字登錄'] : ['播放歌曲', 'NOW PLAYING', '本曲為純音樂'],
    });
    const nameText = msg ? (msg.couple ? COUPLE_ZH : msg.name || '一位不願具名的賓客') : lyrics.has ? `${song.artist || '今晚的歌手'}（代唱）` : '全體賓客';
    this.sigText = msg ? (msg.couple ? COUPLE_ZH : msg.name || '一位賓客') : lyrics.has ? song.artist || '今晚的歌手' : '全體賓客';
    const bodyText = msg ? msg.text : this.mode === 'invite' ? '掃描右下角 QR code，把祝福寫上大螢幕。' : null;
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(FORM_TEXT + nameText + this.sigText + songName + (bodyText ?? '') + lines.map((l) => l.text).join(''));

    const c = this.ink.ctx;
    // ---- 排版
    // 名字不要長到核准章底下（章會蓋在名字線的右端）
    this.name = typeset(c, nameText, F.ming(700), fitRows(c, nameText, F.ming(700), L.approve.x - L.approve.hw - L.name.x - (msg?.couple ? 250 : 10), 1, L.name.size, 30), L.name.x, [L.name.y], 2000, this.seed + 1);
    if (bodyText) {
      // 英文為主的留言用等寬字（真的打字機）；中文用思源宋體（中文打字機的鉛字就是明體）
      const latin = (bodyText.match(/[A-Za-z]/g)?.length ?? 0) / Math.max(1, bodyText.replace(/\s/g, '').length) > 0.5;
      const fam = latin ? F.mono(500) : F.ming(700);
      const w = L.col.x1 - L.col.x0;
      const size = fitRowsOr(c, bodyText, fam, w, L.msg.rows.length, L.msg.max, L.msg.min, 34);
      this.body = typeset(c, bodyText, fam, size, L.col.x0, L.msg.rows, w, this.seed + 2);
      if (this.body.rows < L.msg.rows.length) {
        const bt = '（以下空白）', bs = 30;
        this.blank = typeset(c, bt, F.ming(700), bs, (L.col.x0 + L.col.x1) / 2 - measure(bt, F.ming(700), bs) / 2, [L.msg.rows[this.body.rows]!], 2000, this.seed + 4);
        for (const ch of this.blank.chars) ch.dens *= 0.8;
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
    if (!this.bake.done) {
      this.bake.pass.render(this.ctx.renderer, this.bake.rt);
      this.ctx.renderer.setRenderTarget(null);
      this.bake.done = true;
    }
    if ([nameText, bodyText ?? '', ...lines.map((l) => l.text)].some((x) => x.includes('♥'))) {
      this.rose = this.track(new Layer2D());
      this.rose.texture.colorSpace = THREE.NoColorSpace;
    }
    c.font = font(this.sigFamily, 64);
    this.sigSize = clamp(Math.floor((64 * L.sig.w) / Math.max(1, c.measureText(this.sigText).width)), 34, 64);

    this.schedule();
    this.avoid = this.popupAvoid();
  }

  /** 排時間：打字落在節拍格上、勾選／簽名／核准／方章依序各佔一拍，窗格太短就一項一項省掉。 */
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

    // 後面的動作鏈：勾選（＋圈起來）→ 簽名 → 核准 → 方章。放不下就先省核准、再省簽名與圈圈。
    const sigDur = clamp(0.16 * Array.from(this.sigText).length + 0.25, 0.45, 1.3);
    const lastDown = (from: number, to: number) => {
      let best = NaN;
      for (let k = Math.ceil(au.barAt(from) - 1e-6); au.timeOfBar(k) <= to + 1e-6; k++) best = au.timeOfBar(k);
      if (!isNaN(best)) return best;
      for (let k = Math.ceil(au.beatAt(from) - 1e-6); au.timeOfBeat(k) <= to + 1e-6; k++) best = au.timeOfBeat(k);
      return best;
    };
    const tick = beatAfter(au, this.typeEnd + 0.1);
    const plans: [boolean, boolean, boolean][] = [[true, true, true], [true, true, false], [true, false, false], [false, false, false]];
    for (const [circle, sig, app] of plans) {
      let end = tick + 0.12;
      let tc = Infinity, ts = Infinity, se = Infinity, ta = Infinity;
      if (circle) { tc = beatAfter(au, tick + B * 0.9); end = tc + Math.min(0.35, B * 0.8); }
      if (sig) { ts = beatAfter(au, end + B * 0.4); se = ts + sigDur; end = se; }
      if (app) { ta = beatAfter(au, end + 0.1); end = ta + 0.15; }
      const seal = lastDown(end + B * 0.5, sealLatest);
      if (!isNaN(seal)) {
        Object.assign(this, { tTick: tick, tCircle: tc, tSig: ts, sigEnd: se, tApp: ta, tSeal: seal });
        break;
      }
    }
    if (!this.tSeal) {
      // 連勾選都放不下（很短的窗格）：勾選與方章都往前擠，方章落在最晚的時間
      this.tTick = Math.min(tick, sealLatest - 0.3);
      this.tSeal = Math.max(this.tTick + 0.25, Math.min(sealLatest, e - 0.4));
    }
    // 長窗格：簽名後到蓋章前空很久的話，核准章挪到中間（整段都有事發生）
    if (isFinite(this.tApp) && this.tSeal - this.tApp > 16 * B) this.tApp = lastDown(lerp(this.sigEnd, this.tSeal, 0.45), this.tSeal - 4 * B) || this.tApp;
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
    // 中段很長：每兩小節在「看留言」與「看整張」之間換，緩進小節線；核准章那一拍一定是整張（另外插一個鏡位）
    const holdFrom = (isFinite(this.sigEnd) ? this.sigEnd : this.tTick + B) + B;
    const holdTo = this.tSeal - 2 * B;
    let k = 0;
    for (let d = barAfter(au, holdFrom + 3 * B); d <= holdTo - 2 * B; d = barAfter(au, d + 7 * B)) {
      if (isFinite(this.tApp) && d > this.tApp - 3 * B && d < this.tApp + 4 * B) continue;
      const msg = k++ % 2 === 0, t1 = d;
      this.shots.push({ t0: t1 - 1.5 * B, t1, e: io, cam: msg ? (t) => drift(CAM_MSG, t - t1, 0.006, 0) : (t) => drift(CAM_REVIEW, t - t1) });
    }
    if (isFinite(this.tApp) && this.tApp > this.tTick + B) {
      const t1 = this.tApp;
      this.shots.push({ t0: t1 - 1.2 * B, t1, e: io, cam: (t) => drift(CAM_REVIEW, t - t1) });
    }
    this.shots.sort((a, b) => a.t0 - b.t0);
    this.shots.push({ t0: this.tSeal - 0.02, t1: this.tSeal + 0.3, e: ease.outExpo, cam: (t) => drift(CAM_WIDE, t - this.tSeal, 0.008) });
  }

  /**
   * 即時小卡要避開的範圍：該讀的東西（名字、歌詞、留言、簽名、勾選的「以上皆是」、方章）在紙上的框，
   * 用整個窗格的鏡頭走一遍、換成螢幕座標。小卡在出現那一刻決定位置、之後會停好幾秒，所以要整段的聯集；
   * 但每樣東西只從它出現之後算起，並且依鏡位分段（推近時一框、拉遠時一框），框才不會大到蓋滿整個畫面。
   * 表頭、資料列、其他勾選框只是裝飾，不擋：右上角（表頭右端）通常就是留給小卡的空位。
   */
  private popupAvoid(): [number, number, number, number][] {
    const s = this.ctx.start, e = this.ctx.end, lyr = this.ctx.lyrics.has;
    type Box = { x0: number; y0: number; x1: number; y1: number; from: number };
    const span = (b: Block | null, pad: number): Box | null => {
      if (!b || !b.chars.length) return null;
      const xs = b.chars.map((c) => c.x), ys = b.chars.map((c) => c.y);
      return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - b.size - pad, x1: Math.max(...xs) + b.size + pad, y1: Math.max(...ys) + b.size * 0.3 + pad, from: b.chars[0]!.t - 0.4 };
    };
    const boxes: (Box | null)[] = [
      // 名字（新人留言後面還有標籤）
      { ...span(this.name, 12)!, ...(this.msg?.couple ? { x1: L.name.x + 560 } : {}) },
      span(this.body, 14), span(this.blank, 10), span(this.title, 12),
      // 歌詞：第 2 欄（有留言）或內容欄（歌詞模式），整欄都算（每一句長短不同）
      lyr ? (this.mode === 'msg' ? { x0: L.col.x0 - 12, y0: L.lyric.label + 6, x1: L.col.x1 + 12, y1: L.lyric.rows[1] + 20, from: s }
        : { x0: L.col.x0 - 12, y0: L.msg.label + 6, x1: L.col.x1 + 12, y1: L.msg.rows[1] + 24, from: s }) : null,
      isFinite(this.tSig) ? { x0: L.sig.x - 16, y0: L.sig.y - this.sigSize - 12, x1: L.sig.x + L.sig.w + 90, y1: L.sig.y + 24, from: this.tSig } : null,
      { x0: L.right.x0 - 8, y0: L.checks.y0 + 3 * L.checks.gap - 44, x1: L.right.x0 + 220, y1: L.checks.y0 + 3 * L.checks.gap + 22, from: this.tTick },
      { x0: L.seal.x - 30, y0: L.seal.y - 30, x1: L.seal.x + L.seal.box + 30, y1: L.seal.y + L.seal.box + 30, from: this.tSeal },
    ];
    const acc = new Map<string, [number, number, number, number]>();
    for (let t = s; t <= e; t += 0.1) {
      // 依鏡位分段：最後一個已經到位的鏡位（轉場中的位置會併進那一段）
      let seg = -1;
      for (let i = 0; i < this.shots.length; i++) if (t >= this.shots[i]!.t1) seg = i;
      const m = camXf(this.camAt(t));
      boxes.forEach((b, bi) => {
        if (!b || t < b.from) return;
        const pts = [apply(m, b.x0, b.y0), apply(m, b.x1, b.y0), apply(m, b.x0, b.y1), apply(m, b.x1, b.y1)];
        const k = `${bi}:${seg}`, r = acc.get(k) ?? [Infinity, Infinity, -Infinity, -Infinity];
        for (const p of pts) { r[0] = Math.min(r[0], p.x); r[1] = Math.min(r[1], p.y); r[2] = Math.max(r[2], p.x); r[3] = Math.max(r[3], p.y); }
        acc.set(k, r);
      });
    }
    return [...acc.values()].map(([x0, y0, x1, y1]) => {
      const a = clamp(x0, 0, W), b = clamp(y0, 0, H);
      return [a, b, clamp(x1, 0, W) - a, clamp(y1, 0, H) - b] as [number, number, number, number];
    }).filter(([, , w, h]) => w > 1 && h > 1);
  }

  /** 歌詞一行的排版與每個字的時間（字在它那個詞開始唱時打上去；英文一個詞裡的字母用自然的打字速度）。 */
  private lyricBlock(line: Line): Block {
    const hit = this.lyricCache.get(line);
    if (hit) return hit;
    const c = this.ink.ctx, fam = F.mono(600), w = L.col.x1 - L.col.x0;
    // 有留言：歌詞在第 2 欄（兩行線）；沒有留言：歌詞就是祝福內容（字大一點，最多用前兩行：第三行推近時靠 QR 區太近）
    const rows = this.mode === 'msg' ? L.lyric.rows : L.msg.rows;
    const size = this.mode === 'msg' ? fitRowsOr(c, line.text, fam, w, 2, L.lyric.size, L.lyric.min, 34)
      : fits(c, line.text, fam, 50, w, 2) ? fitRows(c, line.text, fam, w, 2, 72, 50) : fitRowsOr(c, line.text, fam, w, 3, 50, 50, 34);
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
  /** 打字頭在內容欄的第幾行（0～2）。 */
  private caretRow(b: Block, t: number) {
    let y = b.chars[0]!.y;
    for (const ch of b.chars) { if (t < ch.t) break; y = ch.y; }
    return Math.max(0, (L.msg.rows as readonly number[]).indexOf(y));
  }
  /** 正在打的那一塊（留言，或歌詞模式正在唱的那一行）；沒有字就是 null。 */
  private activeBlock(t: number): Block | null {
    const b = this.body ?? (() => { const ly = lyricAt(this.ctx.lyrics, t, 1.6); return ly ? this.lyricBlock(ly.line) : null; })();
    return b && b.chars.length ? b : null;
  }
  /** 打祝福內容時的取景：x 跟著打字頭輕輕晃（取 0.3 秒平均，換行時晃回去），y 跟著第幾行。 */
  private typeCam(t: number): Cam {
    let x = 0, row = 0;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const tt = t - (i * 0.3) / N;
      const b = this.activeBlock(tt);
      x += b ? this.caretX(b, tt) : L.col.x0;
      row += b ? this.caretRow(b, tt) : 0;
    }
    x /= N; row /= N;
    const u = clamp((x - L.col.x0) / (L.col.x1 - L.col.x0));
    return { x: CAM_TYPE.x + CAM_TYPE.sway * (2 * u - 1), y: CAM_TYPE.y0 + CAM_TYPE.dy * row, z: CAM_TYPE.z, r: CAM_TYPE.r };
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
    const z = 1 + 0.006 * this.ctx.audio.hit('kick', t, 0.12) + 0.05 * pulse(t, this.tSeal, 0.09) + 0.015 * pulse(t, this.tApp, 0.07);
    return { ...cam, z: cam.z * z };
  }
  /** 震動（螢幕像素）：每個打字的鍵、勾選、蓋章。方向用逐格的 hash（確定性）。 */
  private shake(t: number): [number, number] {
    let amp = 26 * pulse(t, this.tSeal, 0.07) + 10 * pulse(t, this.tApp, 0.06) + 5 * pulse(t, this.tTick, 0.05) + 4 * pulse(t, this.tNum, 0.05);
    const keys = (b: Block | null) => { if (b) for (const ch of b.chars) if (t >= ch.t && t < ch.t + 0.12 && ch.ch !== ' ') amp += 1.3 * pulse(t, ch.t, 0.025); };
    keys(this.name); keys(this.body); keys(this.blank); keys(this.title);
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) keys(this.lyricBlock(ly.line));
    const ph = frameIdx(t);
    return [amp * (hash(ph, 11) - 0.5) * 2, amp * (hash(ph, 12) - 0.5) * 2];
  }

  override dispose() {
    // 表格畫布一張十幾 MB：窗格結束馬上還
    if (this.form) { this.form.width = this.form.height = 0; this.form = null; }
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
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    if (this.form) c.drawImage(this.form, FORM_BOX.x, FORM_BOX.y, FORM_BOX.w, FORM_BOX.h);
    this.drawNumber(c, t);
    this.drawName(c, hc, t);
    this.drawField2(c, hc, t);
    this.drawBody(c, hc, t);
    this.drawChecks(c, t);
    this.drawSignature(c, t);
    this.drawApprove(c, t);
    this.drawSeal(c, t);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';

    const P = this.paper.u;
    P.inkTex!.value = I.upload();
    P.roseOn!.value = this.rose ? 1 : 0;
    P.bakeTex!.value = this.bake.rt.texture;
    if (this.rose) P.roseTex!.value = this.rose.upload();
    (P.camA!.value as THREE.Vector3).set(im.a, im.c, im.e);
    (P.camB!.value as THREE.Vector3).set(im.b, im.d, im.f);
    (P.blurV!.value as THREE.Vector2).set(bl[0], bl[1]);
    const sl = this.sealState(t), ap = this.approveState(t);
    (P.st0!.value as THREE.Vector4).set(sl.x, sl.y, (sl.side / 2) * 1.14 * sl.scale, (sl.side / 2) * 1.14 * sl.scale);
    (P.st0b!.value as THREE.Vector4).set(sl.rot, sl.on ? sl.strength : 0, 3.7 + (this.seed % 7), 0);
    (P.st1!.value as THREE.Vector4).set(ap.x, ap.y, L.approve.hw * 1.12, L.approve.hh * 1.2);
    (P.st1b!.value as THREE.Vector4).set(ap.rot, ap.on ? ap.strength : 0, 9.1, 0);
    this.paper.render(renderer, out);
    return { paper: 1, popupAvoid: this.avoid, bloom: 0.15, bloomThreshold: 1.8, halation: 0.03, vignette: 0.2, grain: 0.045, ca: 0.5 };
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
    for (const ch of b.chars) {
      if (ch.ch === ' ') continue;
      const heart = ch.ch === '♥' && hc;
      const ctx = heart ? hc! : c;
      if (t < ch.t) {
        if (o.preview) { ctx.fillStyle = TYPE(o.preview * alpha); ctx.fillText(ch.ch, ch.x, ch.y); }
        continue;
      }
      const fresh = pulse(t, ch.t, 0.035);
      ctx.save();
      ctx.translate(ch.x + ch.jx, ch.y + ch.jy - 3.5 * fresh);
      ctx.rotate(ch.rot);
      ctx.fillStyle = heart ? TYPE(alpha) : o.lyric && t < ch.we ? SIG(alpha) : TYPE(Math.min(1, ch.dens + 0.2 * fresh) * alpha);
      ctx.fillText(ch.ch, 0, 0);
      ctx.restore();
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

  /** 編號：第一個拍點用號碼機蓋上去（訊號色，稍微歪；號碼機是表格上唯一會「喀」一聲的東西）。 */
  private drawNumber(c: Ctx2, t: number) {
    if (t < this.tNum) return;
    const k = prog(t, this.tNum, this.tNum + 0.05, ease.outQuad), sc = lerp(1.14, 1, k);
    c.save();
    c.translate(L.numberAt.x, L.numberAt.y); c.rotate(-0.022); c.scale(sc, sc);
    c.font = font(F.mono(600), 22); c.letterSpacing = '4px';
    c.fillStyle = SIG(0.95);
    c.fillText(this.copy.no, 0, 0);
    c.restore();
  }

  private drawName(c: Ctx2, hc: Ctx2 | null, t: number) {
    this.drawTyped(c, hc, this.name, t, { caret: 0.3 });
    // 新人自己的留言：名字後面蓋一個小小的「新人」標籤（訊號色）
    const last = this.name.chars[this.name.chars.length - 1]!;
    if (this.msg?.couple && t >= last.t + 0.1) {
      const k = prog(t, last.t + 0.1, last.t + 0.16);
      c.save();
      c.fillStyle = SIG(k);
      c.font = font(F.mono(600), 12); c.letterSpacing = '3px';
      const x = last.x + this.name.size + 22;
      const w = measure('新人 · FROM THE COUPLE', F.mono(600), 12, 3) + 20;
      c.strokeStyle = SIG(k); c.lineWidth = 2;
      c.strokeRect(x, L.name.y - 28, w, 32);
      c.fillText('新人 · FROM THE COUPLE', x + 10, L.name.y - 7);
      c.restore();
    }
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
    let a = 0.4;
    const last = lyrics.lastLine(t), next = lyrics.nextLine(t);
    if (last) a *= clamp((t - last.end - hold) / 0.4);
    if (next) a *= clamp((next.start - 0.35 - t) / 0.25);
    if (a <= 0.01) return;
    c.save();
    c.fillStyle = PRINT(a);
    c.font = font(F.hei(500), 30); c.letterSpacing = '4px';
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
    const pts = [[bx + 3, by + b * 0.45], [bx + b * 0.42, by + b + 3], [bx + b + 20, by - 22]] as const;
    const p = prog(t, this.tTick, this.tTick + 0.11, ease.outQuad);
    const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
    const len = (l1 + l2) * p;
    c.lineWidth = 5.5;
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    if (len <= l1) c.lineTo(lerp(pts[0][0], pts[1][0], len / l1), lerp(pts[0][1], pts[1][1], len / l1));
    else { c.lineTo(pts[1][0], pts[1][1]); c.lineTo(lerp(pts[1][0], pts[2][0], (len - l1) / l2), lerp(pts[1][1], pts[2][1], (len - l1) / l2)); }
    c.stroke();
    // 圈：繞「以上皆是」一圈多一點，半徑有一點手抖
    if (t >= this.tCircle) {
      const tw = measure(this.copy.checks[3]!, F.hei(500), 26, 3);
      const cx = L.right.x0 + b + 20 + tw / 2, cy = y - 10, rx = tw / 2 + 24, ry = 25;
      const q = prog(t, this.tCircle, this.tCircle + Math.min(0.35, this.B * 0.8), ease.inOutCubic);
      const a0 = -2.5, span = (Math.PI * 2 + 0.55) * q;
      c.lineWidth = 3.2;
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
      c.strokeStyle = TYPE(0.9); c.lineWidth = 2.6; c.lineCap = 'round';
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

  private approveState(t: number) {
    const k = prog(t, this.tApp, this.tApp + 0.05, ease.outQuad);
    return { x: L.approve.x, y: L.approve.y, rot: 0.07, on: t >= this.tApp, strength: 1 + 0.4 * (1 - k), scale: lerp(1.06, 1, k) };
  }
  /** 「核准」橡皮章（印刷墨、圓角框），蓋在登記人那一欄的右端（像承辦人蓋的章）。 */
  private drawApprove(c: Ctx2, t: number) {
    const s = this.approveState(t);
    if (!s.on) return;
    const { hw, hh } = L.approve;
    c.save();
    c.translate(s.x, s.y); c.rotate(s.rot); c.scale(s.scale, s.scale);
    c.strokeStyle = PRINT(1); c.lineWidth = 6;
    c.beginPath(); c.roundRect(-hw + 8, -hh + 8, 2 * hw - 16, 2 * hh - 16, 14); c.stroke();
    c.fillStyle = PRINT(1); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.font = font(F.hei(900), 46); c.letterSpacing = '18px';
    c.fillText('核准', 9 - 60, 16);
    c.font = font(F.mono(700), 13); c.letterSpacing = '4px';
    c.fillText('APPROVED', 72, -4);
    c.fillText('已登錄', 72, 20);
    c.restore();
  }

  private sealState(t: number) {
    const k = prog(t, this.tSeal, this.tSeal + 0.05, ease.outQuad);
    const { x, y, box, side } = L.seal;
    return { x: x + box / 2 + this.sealDx, y: y + box / 2 + this.sealDy, side, rot: this.sealRot, on: t >= this.tSeal, strength: 1 + 0.55 * (1 - k), scale: lerp(1.08, 1, k) };
  }
  /**
   * 方章（陰刻：整塊印泥、字是白的）。四個字由左而右、由上而下排：傳統印章是右行直讀，
   * 但大螢幕上只看一眼，橫著讀才不會被念成「好百合年」。
   */
  private drawSeal(c: Ctx2, t: number) {
    const s = this.sealState(t);
    if (!s.on) return;
    const S = s.side, h = S / 2;
    c.save();
    c.translate(s.x, s.y); c.rotate(s.rot); c.scale(s.scale, s.scale);
    c.fillStyle = SIG(1);
    c.beginPath(); c.roundRect(-h, -h, S, S, 10); c.fill();
    c.globalCompositeOperation = 'difference';
    c.strokeStyle = SIG(1); c.lineWidth = 3;
    c.strokeRect(-h + 11, -h + 11, S - 22, S - 22);
    c.fillStyle = SIG(1);
    const chars = Array.from(this.copy.seal);
    const cell = (S - 44) / 2, size = cell * 0.96;
    c.font = font(F.ming(900), size);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const pos = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
    chars.slice(0, 4).forEach((ch, i) => {
      const [cx, cy] = pos[i]!;
      c.fillText(ch, -h + 22 + cell * (cx + 0.5), -h + 22 + cell * (cy + 0.5) + size * 0.04);
    });
    c.restore();
  }
}
