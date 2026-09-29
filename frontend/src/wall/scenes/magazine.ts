// 雜誌封面（亮）：木頭桌上一疊婚禮特刊，每到小節線就有新的一期「啪」地疊上去（從上方斜斜落下、落在小節線上、整疊震一下）。
//  - 有留言：開場桌上是上一期（封面故事是別的賓客的一句話），第一個小節線新的一期落下——封面故事就是主打留言
//    （思源宋體特粗、最深的墨），署名是撰稿人；左上的「現場連線」欄是歌詞（逐字跟唱）。
//  - 沒有留言：每一句歌詞各是一期，在那一句開始前的小節線落下，封面故事就是那一句（逐字跟唱）；純音樂又沒有留言：
//    這一期的封面故事是新人的名字與「今天，我們結婚了」，左上一行邀請。
//  - 封面：刊名是細的斜體（淡、不搶封面故事）、一張手繪線條插畫（花束／蛋糕／網球拍，每一期不一樣）墊一個訊號色的圓、
//    上緣一行小字（期號、日期）、右下條碼與「NT$ ∞」。
// v2（留言尺寸標準 v2）：這一疊放在畫面左邊（封面在螢幕上約 0.8 倍），封面故事在封面下半部、畫面左下
//（40～60 px，留言區約 590 × 330）；右上是散開的過期特刊（一期一期斜斜地疊著、出血到畫面外、在焦外），
// 留言那一期落定之後，每兩個小節線又有一期過期的從右上方「啪」地丟到那一堆上（整張桌子震一下）——畫面一直有事情發生。
//  - 鏡頭：斜俯看，慢慢推近封面故事；新的一期落地時鏡頭跟著頓一下。景深對在封面故事上，右上那一堆在焦外。
//  - 右下角（HUD）是空的木頭桌面。
// 手法：three.js 的「桌上的紙」舞台（_t4 Stage）：每一期是一張封面（平面）＋一塊書口（方塊，看得到厚度），畫的順序由下往上；
// 封面在 init() 畫成畫布（一期一張），每格用合成器把「封面＋會變的字（歌詞）」畫進有 mipmap 的 render target（主疊、右上各三期）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, makeRT } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, pulse, lerp } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, drawHeart, COUPLE_ZH, DATE_DOTS, signature } from './_motifs';
import { grid, layoutRows, drawRows, paperInk, Stage, camDist, type Grid, type V3 } from './_t4';
import { drawBarcode } from './_t1';
import { loadAll, sigOf, block, T21_INVITE, type Block, type Rect } from './_t21';
import { V2, lyricV2, msgMaxFor } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'print', paper: true, energy: [0.3, 0.95], bars: [4, 8], weight: 1 };

/** 封面（紙面 px）與 render target 的倍率（右上那一堆在焦外，解析度低一點）。 */
const CW = 800, CH = 1040, RES = 1.3, RES_FAN = 0.8;
/** 封面故事的框（封面下半部）、「現場連線」欄。 */
const STORY = { x: 56, y: 572, w: 688, h: 392 };
const SIDE = { x: 56, y: 318, w: 330 };
/** 主疊（留言那一期）在桌上的中心（世界座標）；鏡頭看的點在它右邊，所以它在畫面左邊。 */
const PILE = { x: -500, y: 0 };
/** 右上散開的過期特刊：每一期的位置與角度（越後面的越上面）。 */
// 丟上去的雜誌方向不一定：有的倒過來、有的橫的（刊名與插畫朝畫面中間，空白的下半部出血到畫面外）
const FAN = [
  { x: 420, y: 560, rot: 2.95 }, { x: 760, y: 420, rot: -1.72 }, { x: 520, y: 360, rot: 2.7 },
  { x: 800, y: 600, rot: 3.3 }, { x: 330, y: 470, rot: -1.42 }, { x: 640, y: 300, rot: 3.08 },
];
/** 過期特刊的封面故事（小小的冷面標題，在焦外只看得出是一期一期的雜誌）。 */
const FAN_HEADS = ['兩人份的早餐', '遛狗日誌', '羽球雙打入門', '一起去旅行', '晚安故事集', '今天，我們結婚了'];
const FAM = F.ming(900);
const FAM_SIG = F.ming(700);
const FAM_SIDE = F.hei(700);
const MAST = F.serif(400, true);
const THICK = 9;

type Kind = 'main' | 'back' | 'lyric' | 'names' | 'fan';
interface Issue {
  kind: Kind;
  line: Line | null;
  tLand: number;
  seed: number;
  cv: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  /** 放好的位置（桌面座標）與角度。 */
  x: number; y: number; rot: number;
  block: Block | null;
}

function makeRig() {
  const st = new Stage(1, 30);
  st.U.ambient.value = 0.8;
  // order0：畫的順序（右上那一堆在主疊下面，主疊落下時從它上面飛過去）
  const mk = (res: number, order0: number) => {
    const rt = makeRT(CW * res, CH * res, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const mat = st.docMaterial(rt.texture, [rt.width, rt.height], [CW, CH], { radius: 3, edge: 1 });
    const cover = st.docMesh(mat, CW, CH, 0, 0, 1);
    // 書口：一塊薄薄的方塊（頁緣的顏色、一點點層次），只畫朝外的面
    const edgeM = st.solidMaterial('mix(C_PAPER, C_BONE, 0.5) * (0.82 + 0.1 * n.z + 0.05 * sin(p.x * 0.9 + p.y * 0.9))', { depthTest: false, side: THREE.FrontSide });
    const edge = new THREE.Mesh(new THREE.BoxGeometry(CW - 4, CH - 4, THICK), edgeM);
    edge.frustumCulled = false;
    st.scene.add(edge);
    cover.renderOrder = order0 + 1; edge.renderOrder = order0;
    return { rt, mat, cover, edge };
  };
  const slots = [0, 1, 2].map((k) => mk(RES, 2 * k));
  const fan = [0, 1, 2].map((k) => mk(RES_FAN, 2 * k - 8));
  return { st, slots, fan };
}

// ---------------------------------------------------------------- 手繪插畫（封面上的線條畫，不是照片）
type Ctx = CanvasRenderingContext2D;
/** 手繪的線：每一段抖一點點（種子固定）。 */
function wob(c: Ctx, pts: [number, number][], rnd: () => number, amp = 1.6, close = false) {
  c.beginPath();
  pts.forEach(([x, y], i) => {
    const jx = (rnd() - 0.5) * amp, jy = (rnd() - 0.5) * amp;
    if (i) c.lineTo(x + jx, y + jy); else c.moveTo(x + jx, y + jy);
  });
  if (close) c.closePath();
}
const arcPts = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 24, rot = 0): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (a1 - a0) * (i / n), x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
  });

function bouquet(c: Ctx, cx: number, cy: number, s: number, seed: number, line: string, wash: string) {
  const rnd = mulberry32(seed);
  c.strokeStyle = line; c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round';
  const tie = { x: cx, y: cy + 0.5 * s };
  const tops: [number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * 0.3 + (rnd() - 0.5) * 0.1;
    const r = s * (0.52 + 0.12 * Math.cos((i - 3) * 0.7) + 0.05 * rnd());
    tops.push([tie.x + Math.cos(a) * r, tie.y + Math.sin(a) * r]);
  }
  // 莖（綁起來的地方以下也伸出去）
  for (const [i, [x, y]] of tops.entries()) {
    wob(c, [[x, y], [lerp(x, tie.x, 0.5) + (rnd() - 0.5) * 8, lerp(y, tie.y, 0.5)], [tie.x + (i - 3) * 2, tie.y], [tie.x + (i - 3) * 6, tie.y + 0.22 * s]], rnd, 1.2);
    c.stroke();
  }
  // 葉子
  for (let k = 0; k < 5; k++) {
    const [x, y] = tops[(k * 2 + 1) % 7]!;
    const px = lerp(x, tie.x, 0.45 + 0.1 * rnd()), py = lerp(y, tie.y, 0.45 + 0.1 * rnd());
    const a = Math.atan2(py - tie.y, px - tie.x) + (k % 2 ? 0.9 : -0.9);
    const L = s * 0.17;
    const ex = px + Math.cos(a) * L, ey = py + Math.sin(a) * L;
    const nx = -Math.sin(a) * L * 0.28, ny = Math.cos(a) * L * 0.28;
    c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo((px + ex) / 2 + nx, (py + ey) / 2 + ny, ex, ey); c.quadraticCurveTo((px + ex) / 2 - nx, (py + ey) / 2 - ny, px, py);
    c.fillStyle = wash; c.fill(); c.stroke();
    wob(c, [[px, py], [lerp(px, ex, 0.8), lerp(py, ey, 0.8)]], rnd, 0.8); c.stroke();
  }
  // 花：一圈花瓣（小圈圈）＋花心的點
  for (const [x, y] of tops) {
    const r = s * (0.075 + 0.03 * rnd()), n = 5 + Math.floor(rnd() * 3), a0 = rnd() * 6;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2;
      wob(c, arcPts(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, r * 0.75, r * 0.5, 0, Math.PI * 2, 16, a), rnd, 1.1, true);
      c.fillStyle = wash; c.fill(); c.stroke();
    }
    c.fillStyle = line;
    for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x + (rnd() - 0.5) * r * 0.5, y + (rnd() - 0.5) * r * 0.5, 1.8, 0, Math.PI * 2); c.fill(); }
  }
  // 緞帶：兩個圈、兩條尾巴
  for (const sd of [-1, 1]) {
    wob(c, arcPts(tie.x + sd * s * 0.07, tie.y, s * 0.07, s * 0.035, 0, Math.PI * 2, 18, sd * 0.4), rnd, 1, true); c.stroke();
    wob(c, [[tie.x, tie.y], [tie.x + sd * s * 0.06, tie.y + s * 0.12], [tie.x + sd * s * 0.1, tie.y + s * 0.2]], rnd, 1); c.stroke();
  }
}

function cake(c: Ctx, cx: number, cy: number, s: number, seed: number, line: string, wash: string) {
  const rnd = mulberry32(seed);
  c.strokeStyle = line; c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round';
  const tiers = [[0.86, 0.26], [0.62, 0.22], [0.4, 0.2]] as const;
  let y = cy + 0.5 * s;
  // 蛋糕盤
  wob(c, arcPts(cx, y + 6, s * 0.55, s * 0.05, 0, Math.PI, 20), rnd, 1); c.stroke();
  for (const [w, h] of tiers) {
    const x0 = cx - (w * s) / 2, x1 = cx + (w * s) / 2, y0 = y - h * s;
    c.fillStyle = wash;
    c.fillRect(x0, y0, w * s, h * s * 0.35);
    wob(c, [[x0, y], [x0, y0], [x1, y0], [x1, y]], rnd, 1.2); c.stroke();
    // 奶油的波浪邊
    const n = Math.round(w * 12);
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = x0 + (i / n) * (x1 - x0), dy = (i % 2 ? 1 : 0.4) * h * s * 0.32;
      if (i) c.quadraticCurveTo(x - (x1 - x0) / n / 2, y0 + dy + 6, x, y0 + h * s * 0.2); else c.moveTo(x, y0 + h * s * 0.2);
    }
    c.stroke();
    // 小珍珠
    c.fillStyle = line;
    for (let i = 1; i < n; i += 2) { c.beginPath(); c.arc(x0 + (i / n) * (x1 - x0), y - 8, 2, 0, Math.PI * 2); c.fill(); }
    y = y0;
  }
  drawHeart(c, cx, y - s * 0.07, s * 0.1);
}

function racket(c: Ctx, cx: number, cy: number, s: number, seed: number, line: string, wash: string) {
  const rnd = mulberry32(seed);
  c.strokeStyle = line; c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round';
  const rot = -0.5, hx = cx - s * 0.08, hy = cy - s * 0.12;
  // 拍面：橢圓＋網線
  c.save(); c.translate(hx, hy); c.rotate(rot);
  const rx = s * 0.24, ry = s * 0.31;
  c.fillStyle = wash; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); c.fill();
  c.save(); c.beginPath(); c.ellipse(0, 0, rx - 5, ry - 5, 0, 0, Math.PI * 2); c.clip();
  c.lineWidth = 1.1;
  for (let x = -rx; x <= rx; x += s * 0.035) { wob(c, [[x, -ry], [x, ry]], rnd, 0.6); c.stroke(); }
  for (let y = -ry; y <= ry; y += s * 0.035) { wob(c, [[-rx, y], [rx, y]], rnd, 0.6); c.stroke(); }
  c.restore();
  c.lineWidth = 3.2;
  wob(c, arcPts(0, 0, rx, ry, 0, Math.PI * 2, 40), rnd, 1.2, true); c.stroke();
  // 握把
  wob(c, [[-s * 0.03, ry], [-s * 0.035, ry + s * 0.34], [s * 0.035, ry + s * 0.34], [s * 0.03, ry]], rnd, 1); c.stroke();
  wob(c, [[-rx * 0.35, ry * 0.93], [0, ry + s * 0.08], [rx * 0.35, ry * 0.93]], rnd, 1); c.stroke();
  c.restore();
  // 網球（黃綠色，全片的小彩蛋）
  const bx = cx + s * 0.28, by = cy + s * 0.3, br = s * 0.085;
  c.fillStyle = rgba('ball'); c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill();
  c.lineWidth = 2.4; wob(c, arcPts(bx, by, br, br, 0, Math.PI * 2, 30), rnd, 0.8, true); c.stroke();
  c.lineWidth = 1.8;
  wob(c, arcPts(bx - br * 1.25, by, br * 0.75, br * 0.9, -0.9, 0.9, 12), rnd, 0.5); c.stroke();
  wob(c, arcPts(bx + br * 1.25, by, br * 0.75, br * 0.9, Math.PI - 0.9, Math.PI + 0.9, 12), rnd, 0.5); c.stroke();
}

const ILLUS = [bouquet, cake, racket];

export default class Magazine extends Scene {
  rig = shared('magazine.rig', makeRig);
  /** 最上面那一期會變的字（歌詞），封面座標。 */
  lay = this.track(new Layer2D(CW, CH, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 97 + (this.msg?.id ?? 0) * 31) >>> 0;
  g!: Grid;
  issues: Issue[] = [];
  /** 右上那一堆過期特刊（開場就有兩期，之後每兩個小節線丟上來一期）。 */
  fan: Issue[] = [];
  hasLyrics = false;
  avoid: Rect[] = [];
  /** 封面在螢幕上的倍數（v2 的字級換算：封面 px × K = 螢幕 px）。 */
  K = 0.8;
  /** 留言在螢幕上的字級（歌詞比它小一點）。 */
  msgScreen: number | null = null;
  private fall = 0.4;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const others = ((this.ctx.params.messages ?? []) as Msg[]).filter((x) => !m || x.id !== m.id);
    const other = others.length ? others[Math.floor(hash(this.seed, 7) * others.length)]! : null;
    await loadAll(this.ctx, `Our Day婚禮特刊SPECIAL ISSUE本期封面故事現場連線LIVE上一期過期特刊今天，我們結婚了邀請NT$ ∞VOL.${FAN_HEADS.join('')}${other ? other.text + signature(other.name) : ''}`);
    const g = (this.g = grid(au, s, e));
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.fall = clamp(g.beat * 0.8, 0.3, 0.42);
    // 封面在螢幕上的倍數：量封面故事那一段在畫面上多寬（窗格中段的鏡頭；推近前後差不到一成）
    this.shoot(lerp(s, e, 0.6), null, 0);
    const st = this.rig.st;
    const a = st.toScreen([PILE.x - CW / 2 + STORY.x, PILE.y + CH / 2 - STORY.y - STORY.h / 2, THICK * 3]);
    const b = st.toScreen([PILE.x - CW / 2 + STORY.x + STORY.w, PILE.y + CH / 2 - STORY.y - STORY.h / 2, THICK * 3]);
    this.K = clamp((b.x - a.x) / STORY.w, 0.5, 1.2);
    // 第一個夠遠的小節線（至少一拍半之後；太遠就兩拍後）
    let first = g.bars.find((x) => x >= s + g.beat * 1.4) ?? Infinity;
    if (first > s + Math.min(3.5, 0.3 * (e - s))) first = au.timeOfBeat(au.beatAt(s) + 2);
    const top = { x: PILE.x + 10, y: PILE.y - 6, rot: 0.015 };
    const under = (k: number) => { const r = mulberry32(this.seed + k * 13 + 3); return { x: PILE.x + (r() - 0.5) * 70, y: PILE.y + (r() - 0.5) * 50, rot: (r() - 0.5) * 0.14 }; };
    if (m) {
      this.issues.push(this.issue('back', null, -Infinity, 0, other, under(0)));
      this.issues.push(this.issue('main', null, first, 1, null, top));
    } else if (this.hasLyrics) {
      const ls = lyrics.linesIn(s - 0.3, e).slice(0, 6);
      let prev = -Infinity;
      ls.forEach((line, k) => {
        // 那一句開始前的小節線落下（離上一期至少兩拍）；找不到就提早 0.3 秒
        let tl = -Infinity;
        if (line.start - 0.35 > s + 0.2) {
          const bars = g.bars.filter((x) => x <= line.start - 0.12 && x >= prev + g.beat * 2 && x > s + 0.2);
          tl = bars.length ? bars[bars.length - 1]! : Math.max(line.start - 0.3, prev + g.beat * 1.5);
        }
        this.issues.push(this.issue('lyric', line, tl, k, null, k % 2 ? top : under(k)));
        prev = tl;
      });
      // 窗格開始時桌上一定要有一期
      if (this.issues[0]!.tLand > s) this.issues.unshift(this.issue('back', null, -Infinity, 9, other, under(9)));
    } else {
      this.issues.push(this.issue('back', null, -Infinity, 0, other, under(0)));
      this.issues.push(this.issue('names', null, first, 1, null, top));
    }
    // ---- 右上那一堆：開場兩期已經在桌上；主角那一期落定之後，每兩個小節線丟上來一期（歌詞一期一期落下時就不丟，免得太吵）
    const tf: number[] = [-Infinity, -Infinity];
    if (m || !this.hasLyrics) {
      for (const x of g.bars) if (x > first + g.bar * 0.9 && x < e - g.beat && tf.length < FAN.length && Math.round((x - first) / g.bar) % 2 === 1) tf.push(x);
      // 短窗格：至少丟一期（主角落定後兩拍）
      if (tf.length === 2) { const x = au.timeOfBeat(au.beatAt(first) + 2); if (x < e - g.beat * 0.5) tf.push(x); }
    }
    tf.forEach((tl, k) => {
      const sp = FAN[k]!;
      this.fan.push(this.issue('fan', null, tl, 20 + k, null, sp));
    });
    const msgBlock = this.issues.find((x) => x.kind === 'main')?.block;
    this.avoid = [[STORY.x, STORY.y - 30, STORY.w, STORY.h + 30], [SIDE.x, SIDE.y - 40, SIDE.w, 200]];
    if (msgBlock) this.avoid[0] = msgBlock.box;
  }

  /** 做一期：封面畫布（不會變的部分）與放好的位置。 */
  private issue(kind: Kind, line: Line | null, tLand: number, k: number, other: Msg | null, at: { x: number; y: number; rot: number }): Issue {
    const seed = (this.seed + k * 101 + (kind === 'back' ? 7 : 0)) >>> 0;
    const res = kind === 'fan' ? RES_FAN : RES;
    const cv = document.createElement('canvas');
    cv.width = Math.round(CW * res); cv.height = Math.round(CH * res);
    const c = cv.getContext('2d')!;
    c.scale(res, res);
    c.textBaseline = 'alphabetic';
    const K = this.K;
    const bgs = [mixRgba('paper', 'bone', 0.55), mixRgba('paper', 'signal', 0.2), mixRgba('paper', 'blood', 0.1), mixRgba('paper', 'sepia', 0.14)];
    const bg = kind === 'main' || kind === 'names' ? bgs[0]! : bgs[(k + 1) % bgs.length]!;
    c.fillStyle = bg; c.fillRect(0, 0, CW, CH);
    const ink = rgba('sepia'), soft = rgba('sepia', 0.6);
    // 插畫：訊號色的圓墊在後面，線條畫在上面
    const ill = kind === 'main' || kind === 'names' ? 0 : (k % 3 === 0 ? 1 : k % 3 === 1 ? 2 : 0);
    c.fillStyle = mixRgba('signal', bg, 0.35, 0.55);
    c.beginPath(); c.arc(590, 400, 170, 0, Math.PI * 2); c.fill();
    ILLUS[ill]!(c, 590, 372, 290, seed, rgba('sepia', 0.9), mixRgba('signal', 'bone', 0.45, 0.7));
    // 刊名（細、斜、淡：是封面的一部分，不搶封面故事）
    c.font = font(MAST, 132); c.fillStyle = rgba('blood', 0.42); c.fillText('Our Day', 46, 196);
    this.small(c, '婚禮特刊 · SPECIAL ISSUE', 52, 60, F.hei(500), 17, 4, soft);
    const no = this.msg && kind === 'main' ? `No.${String(this.msg.n).padStart(3, '0')}  ·  ` : `VOL.${1 + (seed % 40)}  ·  `;
    c.textAlign = 'right'; this.small(c, `${no}${DATE_DOTS}`, CW - 52, 60, F.mono(500), 16, 3, soft); c.textAlign = 'left';
    c.fillStyle = rgba('sepia', 0.5); c.fillRect(52, 76, CW - 104, 1.5);
    // 右下：條碼與價格（冷面：無價）
    drawBarcode(c, CW - 170, CH - 58, 120, 30, seed, rgba('sepia', 0.9));
    this.small(c, 'NT$ ∞', CW - 250, CH - 34, F.mono(500), 15, 2, soft);
    let blk: Block | null = null;
    const kick = (text: string, y: number) => this.small(c, text, STORY.x, y, F.hei(700), 18, 5, rgba('blood', 0.9));
    if (kind === 'main' || (kind === 'back' && other)) {
      const mm = kind === 'main' ? this.msg! : other!;
      kick(kind === 'main' && mm.couple ? 'FROM THE COUPLE  ·  新人' : kind === 'main' ? '本期封面故事' : '上一期', STORY.y - 12);
      // 封面故事：照 v2 的字級（封面 px × K = 螢幕 px），靠上排，署名在最後一行下面
      blk = block(c, mm, FAM, STORY, { align: 'left', sigFamily: FAM_SIG, lineHeight: 1.24, maxLines: 5, valign: 0.12, v2: K, sigText: mm.couple ? '—— 新郎新娘' : sigOf(mm) });
      c.font = font(FAM, blk.fit.size); c.fillStyle = kind === 'main' ? ink : rgba('sepia', 0.92);
      for (const ln of blk.lines) this.fillHearts(c, ln.text, ln.x, ln.y);
      c.font = font(FAM_SIG, blk.sig.size); c.fillStyle = soft; c.fillText(blk.sig.text, blk.sig.x, blk.sig.y);
      if (kind === 'main') this.msgScreen = blk.fit.size * K;
    } else if (kind === 'back' || kind === 'fan') {
      kick(kind === 'fan' ? '過期特刊' : '上一期', STORY.y - 12);
      c.font = font(FAM, kind === 'fan' ? 50 : 60 / K); c.fillStyle = kind === 'fan' ? rgba('sepia', 0.85) : ink;
      c.fillText(kind === 'fan' ? FAN_HEADS[k % FAN_HEADS.length]! : '今天，我們結婚了', STORY.x, STORY.y + 90);
    } else if (kind === 'names') {
      kick('本期封面故事', STORY.y - 12);
      const sz = V2.msgMax / K;
      c.font = font(FAM, sz); c.fillStyle = ink; this.fillHearts(c, COUPLE_ZH.replace(/\s*&\s*/, ' ♥ '), STORY.x, STORY.y + 30 + sz);
      c.font = font(FAM_SIG, V2.sigMax / K); c.fillStyle = soft; c.fillText('今天，我們結婚了', STORY.x, STORY.y + 30 + sz * 2.1);
    } else {
      kick('本期封面故事  ·  現場連線', STORY.y - 12);
    }
    if (kind === 'main' || kind === 'back' || kind === 'names') {
      this.small(c, kind === 'names' ? '邀請' : '現場連線  ·  LIVE', SIDE.x, SIDE.y - 22, F.hei(700), 17, 5, rgba('blood', 0.9));
      if (kind === 'names') {
        c.font = font(F.hei(500), 26 / K); c.fillStyle = ink;
        c.fillText('掃描右下角 QR code，', SIDE.x, SIDE.y + 32 / K); c.fillText('把你的祝福寫上大螢幕', SIDE.x, SIDE.y + 72 / K);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    this.track(tex);
    return { kind, line, tLand, seed, cv, tex, block: blk, x: at.x, y: at.y, rot: at.rot };
  }

  private small(c: Ctx, text: string, x: number, y: number, family: string, size: number, tracking: number, color: string) {
    c.font = font(family, size); c.letterSpacing = `${tracking}px`; c.fillStyle = color;
    c.fillText(text, x, y); c.letterSpacing = '0px';
  }
  /** 字裡的 ♥ 用我們自己的愛心（玫瑰色）。 */
  private fillHearts(c: Ctx, s: string, x: number, y: number) {
    if (!s.includes('♥')) { c.fillText(s, x, y); return; }
    let i = 0;
    for (const part of s.split(/(♥)/)) {
      if (!part) continue;
      const px = x + c.measureText(s.slice(0, i)).width;
      if (part === '♥') {
        const mm = c.measureText('♥');
        drawHeart(c, px + mm.width / 2, y - (mm.actualBoundingBoxAscent - mm.actualBoundingBoxDescent) / 2, Math.min(mm.width, (mm.actualBoundingBoxAscent + mm.actualBoundingBoxDescent) * 1.15) * 0.92);
      } else c.fillText(part, px, y);
      i += part.length;
    }
  }

  /**
   * 一期現在的位置：還沒落下 = 在上方（看不到）；落下的 fall 秒：從右上方斜斜掉下來（inQuad，落在小節線上）。
   * 右上那一堆是被「丟」上去的：從畫面外更遠的地方飛進來、轉得比較多，落地時滑一小段。
   */
  private pose(is: Issue, t: number) {
    const u = is.tLand === -Infinity ? 1 : clamp((t - (is.tLand - this.fall)) / this.fall);
    const k = ease.inQuad(u), o = ease.outCubic(u);
    const dt = Math.max(0, t - is.tLand);
    const settle = is.tLand === -Infinity ? 0 : Math.exp(-dt * 9) * Math.sin(dt * 34) * (t > is.tLand ? 1 : 0);
    if (is.kind === 'fan') {
      const slide = is.tLand === -Infinity ? 1 : ease.outCubic(clamp(dt / 0.35));
      return {
        x: lerp(is.x + 520, is.x + 40, o) - 40 * slide, y: lerp(is.y + 380, is.y + 16, o) - 16 * slide, z: lerp(700, 0, k) + 3 * settle,
        rot: lerp(is.rot + 0.5, is.rot + 0.05, o) - 0.05 * slide, a: clamp(u * 5), u,
      };
    }
    return {
      x: lerp(is.x + 170, is.x, o), y: lerp(is.y + 260, is.y, o), z: lerp(520, 0, k) + 4 * settle,
      rot: lerp(is.rot + 0.3, is.rot, o) + 0.01 * settle, a: clamp(u * 5), u,
    };
  }

  /**
   * 鏡頭：斜俯看，看的點在主疊右邊（主疊在畫面左邊、右上是那一堆過期特刊）；整段慢慢推近、稍微往左下（封面故事）移；
   * 落地時頓一下。hit = 落地的衝擊（0..1）。
   */
  private shoot(t: number, top: Issue | null, hit: number) {
    const st = this.rig.st, s = this.ctx.start, e = this.ctx.end;
    const D = camDist(30);
    const push = prog(t, s, e, ease.inOutQuad);
    const intro = ease.outExpo(prog(t, s, s + Math.min(1.2, this.g.beat * 2.5)));
    const side = hash(this.seed, 5) < 0.5 ? -1 : 1;
    const T: V3 = [30 + side * 16 * (1 - push) - 30 * push, 40 - 50 * push, THICK * 3];
    const dist = D * (1.3 - 0.05 * intro - 0.07 * push - 0.02 * hit);
    const tilt = THREE.MathUtils.degToRad(22 - 5 * intro);
    const yaw = side * (0.1 - 0.05 * intro - 0.02 * push);
    st.look([T[0] + Math.sin(yaw) * dist, T[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T);
    if (top) {
      const tp = this.pose(top, t);
      st.U.focus.value = st.depthOf([tp.x - CW / 2 + STORY.x + STORY.w / 2, tp.y + CH / 2 - STORY.y - STORY.h / 2, THICK * 3]);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const R = this.rig, st = R.st;
    // 看得到的：已經開始落下的最上面三期（由下往上）
    const shown = this.issues.filter((is) => is.tLand === -Infinity || t >= is.tLand - this.fall).slice(-3);
    const fanShown = this.fan.filter((is) => is.tLand === -Infinity || t >= is.tLand - this.fall).slice(-3);
    // 「現在」那一期：已經落地的最上面一期（新的一期還在空中時，下面那一期的歌詞照樣跟唱）
    const landed = shown.filter((is) => is.tLand === -Infinity || t >= is.tLand);
    const active = landed[landed.length - 1] ?? shown[0]!;
    // ---- 會變的字：最上面那一期的歌詞
    const L = this.lay; L.clear();
    const c = L.ctx;
    const ink = paperInk();
    const K = this.K;
    if (active.kind === 'lyric' && active.line) {
      // 沒有留言：封面故事就是這一句（歌詞是焦點，52 px）
      const lay = layoutRows(c, active.line, { family: FAM, size: lyricV2(null) / K, minSize: V2.lyrMin / K, maxW: STORY.w, maxRows: 3, align: 'left', lineHeight: 1.22 });
      c.save(); c.translate(STORY.x, STORY.y + 40 + lay.size * 0.9);
      drawRows(c, lay, FAM, t, ink, 1);
      c.restore();
    } else if (active.kind !== 'names') {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const size = lyricV2(active.kind === 'main' ? this.msgScreen : msgMaxFor('今天，我們結婚了')) / K;
        const lay = layoutRows(c, ly.line, { family: FAM_SIDE, size, minSize: V2.lyrMin / K, maxW: SIDE.w, maxRows: 3, align: 'left', lineHeight: 1.16 });
        c.save(); c.translate(SIDE.x, SIDE.y + lay.size * 0.62);
        drawRows(c, lay, FAM_SIDE, t, ink, ly.k);
        c.restore();
      } else if (!this.hasLyrics) {
        this.small(c, `♪ ${this.ctx.song.title}`, SIDE.x, SIDE.y + 30, F.mono(500), 20, 3, rgba('sepia', 0.7));
      }
    }
    L.upload();
    // ---- 封面 → render target → 舞台
    const place = (sl: (typeof R.slots)[number], is: Issue | undefined, k: number) => {
      sl.cover.visible = sl.edge.visible = !!is;
      if (!is) return;
      comp.draw(renderer, is.tex, sl.rt, { mode: 'replace' });
      if (is === active) comp.draw(renderer, L.texture, sl.rt);
      const p = this.pose(is, t);
      const z = THICK * (k + 1) + p.z;
      sl.cover.position.set(p.x, p.y, z + 0.5); sl.cover.rotation.set(0, 0, p.rot);
      sl.edge.position.set(p.x, p.y, z - THICK / 2); sl.edge.rotation.set(0, 0, p.rot);
      sl.mat.uniforms.opacity!.value = p.a;
    };
    R.slots.forEach((sl, k) => place(sl, shown[k], k));
    R.fan.forEach((sl, k) => place(sl, fanShown[k], k));
    // ---- 鏡頭
    const lands = [...this.issues, ...this.fan].filter((is) => is.tLand > s && is.tLand < e);
    const hit = lands.reduce((a, is) => Math.max(a, pulse(t, is.tLand, 0.09) * (is.kind === 'fan' ? 0.5 : 1)), 0);
    const top = shown[shown.length - 1]!;
    this.shoot(t, top, hit);
    st.U.aperture.value = 24;
    st.U.pool.value.set(-420, 120, 1500, 0.6);
    // 右上那一堆本來就在焦外（離鏡頭遠一點），再多糊一點：只是「一期一期的雜誌」，不搶封面故事
    for (const sl of R.fan) (sl.mat.uniforms.region!.value as THREE.Vector4).set(0.5, 0.5, 1, 7);
    st.shadows([...shown, ...fanShown].map((is) => {
      const p = this.pose(is, t);
      return { x: p.x + 16 + p.z * 0.35, y: p.y - 20 - p.z * 0.45, w: CW, h: CH, rot: p.rot, blur: 16 + p.z * 0.12, k: 0.34 * (1 - clamp(p.z / 700)), r: 4 };
    }));
    st.render(renderer, out);
    return {
      paper: 1, bloom: 0.28, vignette: 0.38, grain: 0.045,
      shake: [0, -hit * 4], zoom: 1 + 0.012 * hit,
      popupAvoid: this.avoid.map((r) => this.docRect(r, top, t)),
    };
  }

  /** 封面座標的矩形 → 螢幕上的外框。 */
  private docRect([x, y, w, h]: Rect, is: Issue, t: number): Rect {
    const p = this.pose(is, t), st = this.rig.st, cs = Math.cos(p.rot), sn = Math.sin(p.rot);
    const ps = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([u, v]) => {
      const lx = u! - CW / 2, ly = CH / 2 - v!;
      return st.toScreen([p.x + lx * cs - ly * sn, p.y + lx * sn + ly * cs, THICK * 3]);
    });
    const xs = ps.map((q) => q.x), ys = ps.map((q) => q.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }

  override dispose() {
    for (const is of [...this.issues, ...this.fan]) is.cv.width = is.cv.height = 0;
    super.dispose();
  }
}
