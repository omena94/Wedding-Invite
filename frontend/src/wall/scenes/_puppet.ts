// 紙偶動畫（批次 K）：Codex 畫的角色姿勢圖（寫實手繪、透明背景），在版面裡當成一張張紙偶——移動、彈跳、傾斜、照節拍換姿勢。
// 新人看過 Codex 的插畫說「像很多」，所以人物版面（badminton、fetch、waltz、cooking…）的角色一律用這一套，
// 不再用 _couple.ts 的程式畫角色（那邊的道具、留言、歌詞沿曲線照樣可以用）。**照片永遠不能進影片**：只能用畫的。
//
// 素材：`node scripts/wall-sprites.mjs <Codex 的資料夾>...` 裁掉透明邊、縮小、轉 webp 到 public/wall-sprites/<名字>.webp，
// 並更新 src/wall/spriteManifest.ts（每張的尺寸、腳底錨點、參考身高、道具點）。同一個角色每張都是同一個比例，換圖時大小不會跳。
// 檔名：宣文 xw_*、孟庭 mt_*、兩人一起 cp_*（婚禮服華爾滋 cp_waltz_*）、芃芃 pp_*、QQ qq_*；側面一律朝右（要朝左就 flip）。
// 有哪些姿勢看 wall-out/sprites-contact.png（跑管線時產生）或 spriteManifest.ts。
//
// 用法（版面裡）：
//   layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
//   async init() { this.track(await loadPuppets(['xw_walk_1', 'xw_walk_2', 'pp_run_1', 'pp_run_2'])); }   // 用完自動還
//   render(f) {
//     const c = this.layer.ctx, au = this.ctx.audio;
//     const H = 420;                                                  // 場景尺度 = 宣文的身高（px），同一場景的角色都傳同一個值
//     puppetShadow(c, 'xw', x, GROUND, { h: H });
//     drawCycle(c, au, f.t, ['xw_walk_1', 'xw_walk_2'], 1, x, GROUND - hop(f.beat) * 10, { h: H, squash: breathe(f.t) });
//   }
//
// - `drawPuppet(c, 名字, x, y, {h, flip, rot, pivot, squash, alpha, scale, spin, hide})`：(x, y) 是腳底（地面上、身體的水平中心）；
//   h 是場景尺度，每個角色的實際身高 = h × PUPPET_H（孟庭比宣文矮一點、狗約 1/4）。rot 繞 pivot（0 = 腳底、0.5 = 身體中間）轉；
//   squash > 0 壓扁（落地）、< 0 拉長（起跳），腳底不動；spin 是紙偶翻面（圈數：0.25 圈變成一條線、0.5 圈翻成朝左）；
//   hide 蓋掉圖上的道具（例如 xw_throw_2 手邊畫好的球：球已經由程式在飛了）。
// - 道具點：`puppetPoint(名字, 'racket'|'ball'|'mouth'|'wok'|'plate', x, y, 同樣的 opts)` → 畫面座標（含 flip／rot／squash），
//   在 init() 用它算好球的軌跡端點（擊球點、接球點）。`puppetBox(...)` 是外框（排版、避開字用）。
// - 換影格：`cycle(影格, beat, 每拍幾張)` 挑一張；`drawCycle(c, au, t, 影格, 每拍幾張, ...)` 換圖時交叉淡化 1～2 格（fade 秒）：
//   新的一張先畫滿、舊的疊在上面淡掉，不會有兩張都半透明、人變透明的一瞬間。照時間軸換姿勢用 `pick([[t0, 名字], ...], t)`／`drawPick(...)`。
// - 活起來：`breathe(t)` 呼吸（很慢的微縮放，給 squash）、`hop(beat, 每拍幾步)` 走路一步一彈（0..1）、
//   `jumpArc(t, 起跳, 落地, 高度)` → {y, squash, air, u}（起跳前蹲、空中拉長、落地壓扁回彈）、`landSquash(t, 落地時間)`、
//   `sway(t)` 輕輕晃、`beatKick(au, t)` 每拍一下的衝擊（0..1，點頭、踏步）。
// - 影子：`puppetShadow(c, 名字或角色前綴, x, 地面 y, {h, lift})`，腳底一塊柔和的橢圓，離地越高越小越淡。
// - 進場 `puppetIn(t, t0)`（從側面翻正）；暗版面的打光 `puppetLight(c, 範圍, 上, 下)`（上亮下暗，融進場景的光、不搶留言）。
// - 留言（標準 v2）：`noteV2(...)` 排字、`tightenNote(...)` 讓牌子／卡片的寬跟著字縮，用 _couple 的 drawNote 畫。
// - 確定性：全部只看傳進來的 t／beat（沒有亂數）；圖在 init 載好、解碼好才畫，第一格就一樣。
// - 圖是整晚共用的快取（shared）：同一張圖只下載、解碼一次；`loadPuppets` 回傳的 PuppetSet 交給 `this.track()`，
//   窗格結束時引用數減一，沒有人用的圖留在快取裡（最近用過的優先留），超過預算才真的釋放（close()）。
// - 版面只畫自己 loadPuppets 過的圖（別的版面載的圖隨時可能被釋放，第一格會不一樣）。
import { shared } from '../engine/scene';
import type { AudioData } from '../engine/audio';
import { clamp } from '../engine/util';
import { F, font } from '../engine/type';
import { SPRITES, type SpriteInfo } from '../spriteManifest';
import { layoutMessage, signature } from './_motifs';
import { msgMaxFor, sigV2, fitClauses, V2 } from './_v2';
import type { Note } from './_couple';

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

/** 角色的身高（場景尺度 = 宣文的身高 = 1）：用檔名前綴查。兩人一起的圖以宣文為準。 */
export const PUPPET_H: Record<string, number> = { xw: 1, cp: 1, mt: 0.95, pp: 0.26, qq: 0.29 };
const heightOf = (name: string) => PUPPET_H[name.slice(0, 2)] ?? 1;

// ---------------------------------------------------------------- 載入（共用快取＋引用計數）
interface Entry { bmp: ImageBitmap | null; ready: Promise<ImageBitmap>; refs: number; bytes: number; idle: number }
const CACHE = shared('puppet.cache', () => new Map<string, Entry>());
/** 沒有人用、還留著的圖最多留多少（解碼後的位元組）。全部 49 張約 42 MB；會場筆電記憶體吃緊時才會用到。 */
const IDLE_BUDGET = 32 * 1024 * 1024;
let idleSeq = 0;

function acquire(name: string): Promise<ImageBitmap> {
  let e = CACHE.get(name);
  if (!e) {
    const info = SPRITES[name];
    if (!info) return Promise.reject(new Error(`紙偶沒有這張圖：${name}（先跑 node scripts/wall-sprites.mjs）`));
    const ent: Entry = { bmp: null, refs: 0, bytes: info.w * info.h * 4, idle: 0, ready: null! };
    ent.ready = (async () => {
      const res = await fetch(`/wall-sprites/${name}.webp`);
      if (!res.ok) throw new Error(`紙偶載不到：/wall-sprites/${name}.webp（${res.status}）`);
      const bmp = await createImageBitmap(await res.blob());
      ent.bmp = bmp;
      return bmp;
    })();
    // 載入失敗不要留在快取裡（下一個窗格再試）
    ent.ready.catch(() => { if (CACHE.get(name) === ent) CACHE.delete(name); });
    CACHE.set(name, ent);
    e = ent;
  }
  e.refs++;
  return e.ready;
}

function release(name: string) {
  const e = CACHE.get(name);
  if (!e || e.refs <= 0) return;
  if (--e.refs > 0) return;
  e.idle = ++idleSeq;
  // 超過預算：從最久沒用的開始真的釋放
  let idleBytes = 0;
  const idle: [string, Entry][] = [];
  for (const [n, x] of CACHE) if (x.refs === 0 && x.bmp) { idleBytes += x.bytes; idle.push([n, x]); }
  idle.sort((a, b) => a[1].idle - b[1].idle);
  for (const [n, x] of idle) {
    if (idleBytes <= IDLE_BUDGET) break;
    x.bmp!.close();
    CACHE.delete(n);
    idleBytes -= x.bytes;
  }
}

/** 一個版面借用的一組圖：交給 this.track()，窗格結束時自動還。 */
export class PuppetSet {
  private held: string[];
  constructor(names: readonly string[]) { this.held = [...names]; }
  dispose() { for (const n of this.held.splice(0)) release(n); }
}

/** 在 init() 裡：`this.track(await loadPuppets([...]))`。把這個版面要用的姿勢圖都載好、解碼好。 */
export async function loadPuppets(names: readonly string[]): Promise<PuppetSet> {
  const list = [...new Set(names)];
  const got: string[] = [];
  try {
    await Promise.all(list.map(async (n) => { const p = acquire(n); got.push(n); await p; }));
  } catch (err) {
    for (const n of got) release(n);
    throw err;
  }
  return new PuppetSet(list);
}

/** 這張圖有沒有（manifest 裡有）。 */
export const hasPuppet = (name: string) => !!SPRITES[name];
export const puppetInfo = (name: string): SpriteInfo | undefined => SPRITES[name];

// ---------------------------------------------------------------- 畫
export interface PuppetOpts {
  /** 場景尺度：宣文的身高（px）。 */
  h: number;
  /** 左右翻（側面的圖都朝右，flip = 朝左）。 */
  flip?: boolean;
  /** 傾斜（弧度，正 = 順時針），繞 pivot 轉。 */
  rot?: number;
  /** 轉動與壓扁的中心：0 = 腳底（預設）、0.5 = 身體中間、1 = 頭頂。 */
  pivot?: number;
  /** > 0 壓扁（落地）、< 0 拉長（起跳）；體積大致不變，腳底不動。 */
  squash?: number;
  alpha?: number;
  /** 額外的整體縮放（例如遠近）。 */
  scale?: number;
  /** 紙偶翻面（圈數）：水平縮成 cos(2π·spin)，過 0.25 圈就翻成背面（= 左右翻）。 */
  spin?: number;
  /**
   * 蓋掉圖上的道具點（manifest 的 pts，要有半徑），例如 ['ball']；只蓋某一張圖的寫 '圖名:點'（'xw_throw_2:ball'），
   * 交叉淡化時前後兩張用同一組 opts 也不會蓋錯。
   */
  hide?: readonly string[];
}

/** 這個角色在畫面上的身高（px）。 */
export const puppetHeight = (name: string, h: number, scale = 1) => h * heightOf(name) * scale;

/** 把紙偶上的一點（圖上的 px）轉到畫面：跟 drawPuppet 同一套變換。 */
function xform(info: SpriteInfo, name: string, x: number, y: number, o: PuppetOpts) {
  const ph = puppetHeight(name, o.h, o.scale ?? 1);
  const k = ph / info.ref;
  const q = clamp(o.squash ?? 0, -0.5, 0.5);
  const py = (o.pivot ?? 0) * ph;
  const sp = Math.cos((o.spin ?? 0) * Math.PI * 2);
  const sx = (o.flip ? -1 : 1) * (1 + q * 0.5) * (Math.abs(sp) < 0.04 ? 0.04 * Math.sign(sp || 1) : sp);
  const sy = 1 - q;
  const r = o.rot ?? 0, cr = Math.cos(r), sr = Math.sin(r);
  return {
    k, sx, sy, py, r,
    /** 圖上的點 → 畫面（跟 drawPuppet 的 translate／rotate／scale 順序一樣） */
    map: (px: number, pyy: number): Pt => {
      const lx = (px - info.ax) * k * sx, ly = ((pyy - info.ay) * k + py) * sy;
      return { x: x + lx * cr - ly * sr, y: y - py + lx * sr + ly * cr };
    },
  };
}

/** 畫一張紙偶：(x, y) 是腳底。圖還沒載好（或沒有這張）就不畫。 */
export function drawPuppet(c: Ctx, name: string, x: number, y: number, o: PuppetOpts): void {
  const info = SPRITES[name], e = CACHE.get(name), img = e?.bmp;
  if (!info || !img) return;
  const a = o.alpha ?? 1;
  if (a <= 0.003) return;
  const T = xform(info, name, x, y, o);
  c.save();
  c.globalAlpha *= a;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  // 傾斜、壓扁與翻面都以 pivot 為中心（pivot = 0 時腳底不動）
  c.translate(x, y - T.py);
  if (T.r) c.rotate(T.r);
  c.scale(T.sx, T.sy);
  c.translate(0, T.py);
  c.scale(T.k, T.k);
  c.translate(-info.ax, -info.ay);
  if (o.hide?.length && info.pts) {
    // 蓋掉道具：整張圖的範圍挖掉幾個圓（evenodd），只在這一次 drawImage 有效
    c.beginPath();
    c.rect(-2, -2, info.w + 4, info.h + 4);
    for (const h of o.hide) {
      const i = h.indexOf(':');
      if (i >= 0 && h.slice(0, i) !== name) continue;
      const p = info.pts[i >= 0 ? h.slice(i + 1) : h];
      if (!p || !p[2]) continue;
      c.moveTo(p[0]! + p[2] * 1.12, p[1]!);
      c.arc(p[0]!, p[1]!, p[2] * 1.12, 0, Math.PI * 2);
    }
    c.clip('evenodd');
  }
  c.drawImage(img, 0, 0, info.w, info.h);
  c.restore();
}

/** 紙偶上的道具點在畫面上的位置（含 flip／rot／squash）；r = 半徑（px）。這張圖沒有這個點就回傳 null。 */
export function puppetPoint(name: string, key: string, x: number, y: number, o: PuppetOpts): (Pt & { r: number }) | null {
  const info = SPRITES[name], p = info?.pts?.[key];
  if (!info || !p) return null;
  const T = xform(info, name, x, y, o);
  return { ...T.map(p[0]!, p[1]!), r: (p[2] ?? 0) * T.k };
}

/** 紙偶在畫面上的外框 [x, y, w, h]（排版、避開字用；有 rot 時取四個角的外框）。 */
export function puppetBox(name: string, x: number, y: number, o: PuppetOpts): [number, number, number, number] {
  const info = SPRITES[name];
  if (!info) return [x, y, 0, 0];
  const T = xform(info, name, x, y, o);
  const cs = [T.map(0, 0), T.map(info.w, 0), T.map(0, info.h), T.map(info.w, info.h)];
  const xs = cs.map((p) => p.x), ys = cs.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}

/** 腳底一塊柔和的橢圓影子：lift = 離地多高（px），越高越小越淡。who 可以給圖名或角色前綴（xw、pp…）。 */
export function puppetShadow(c: Ctx, who: string, x: number, y: number, o: { h: number; lift?: number; wide?: number; alpha?: number; color?: string }): void {
  const ph = o.h * heightOf(who);
  const dog = /^(pp|qq)/.test(who), couple = /^cp/.test(who);
  const up = clamp((o.lift ?? 0) / Math.max(1, o.h * 0.5), 0, 1);
  const rx = ph * (dog ? 0.95 : couple ? 0.42 : 0.22) * (o.wide ?? 1) * (1 - up * 0.45), ry = rx * 0.17;
  const a = (o.alpha ?? 0.3) * (1 - up * 0.75);
  if (a <= 0.003) return;
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  const col = o.color ?? '20,14,10';
  g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.5, `rgba(${col},${a * 0.62})`); g.addColorStop(1, `rgba(${col},0)`);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill();
  c.restore();
}

/**
 * 紙偶的打光：暗版面裡的紙偶是亮的插畫，直接貼上去會像剪下來的照片、還會搶走留言的焦點。
 * 畫完紙偶之後（同一層在這之前不要畫別的東西）呼叫：只染已經畫上去的像素（source-atop），
 * 上面（被燈照到）淡、往腳底越來越暗。box = 要染的範圍 [x, y, w, h]（通常整個角色區）。
 */
export function puppetLight(c: Ctx, box: readonly [number, number, number, number], top: string, bottom: string): void {
  const [x, y, w, h] = box;
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.restore();
}

// ---------------------------------------------------------------- 換影格
/** 照節拍挑一張：perBeat = 每拍換幾張（走路 1、跑步 2、慢步 0.5）。 */
export function cycle(frames: readonly string[], beat: number, perBeat = 1): string {
  const i = Math.floor(beat * perBeat);
  return frames[((i % frames.length) + frames.length) % frames.length]!;
}

/** 換圖時交叉淡化幾秒：1～2 格（60 fps）。 */
export const FADE = 0.035;

/**
 * 照節拍換影格並畫出來：第 i 張在拍點 i / perBeat 換上，舊的一張疊在上面 fade 秒淡掉（新的先畫滿，人不會變透明）。
 * 回傳這一格的圖名（算道具點用）。
 */
export function drawCycle(c: Ctx, au: AudioData, t: number, frames: readonly string[], perBeat: number, x: number, y: number, o: PuppetOpts, fade = FADE): string {
  const u = au.beatAt(t) * perBeat, i = Math.floor(u);
  const n = frames.length, cur = frames[((i % n) + n) % n]!, prev = frames[(((i - 1) % n) + n) % n]!;
  drawPuppet(c, cur, x, y, o);
  const since = t - au.timeOfBeat(i / perBeat);
  if (fade > 0 && since < fade && prev !== cur) drawPuppet(c, prev, x, y, { ...o, alpha: (o.alpha ?? 1) * (1 - since / fade) });
  return cur;
}

/** 時間軸：[[開始時間, 圖名], ...]（照時間排好），挑 t 當下那一張。 */
export function pick(keys: readonly (readonly [number, string])[], t: number): string {
  let cur = keys[0]![1];
  for (const [t0, n] of keys) if (t >= t0) cur = n; else break;
  return cur;
}

/** 照時間軸換姿勢並畫出來：換的時候舊的一張淡出 fade 秒（1～2 格）。回傳這一格的圖名。 */
export function drawPick(c: Ctx, keys: readonly (readonly [number, string])[], t: number, x: number, y: number, o: PuppetOpts, fade = FADE): string {
  let k = 0;
  for (let i = 0; i < keys.length; i++) if (t >= keys[i]![0]) k = i;
  const cur = keys[k]![1];
  drawPuppet(c, cur, x, y, o);
  if (k > 0 && fade > 0) {
    const since = t - keys[k]![0], prev = keys[k - 1]![1];
    if (since < fade && prev !== cur) drawPuppet(c, prev, x, y, { ...o, alpha: (o.alpha ?? 1) * (1 - since / fade) });
  }
  return cur;
}

// ---------------------------------------------------------------- 活起來
/** 呼吸：很慢的微縮放（給 squash；正負 amt），每個角色給不同的 phase 就不會同步。 */
export const breathe = (t: number, amt = 0.012, period = 3.4, phase = 0) => Math.sin(((t / period) + phase) * Math.PI * 2) * amt;

/** 走路／跑步一步一彈：0..1（腳落地時 0、兩腳交換的中間最高）。perBeat = 每拍幾步（跟換影格的速度一樣）。 */
export const hop = (beat: number, perBeat = 1) => Math.abs(Math.sin(beat * perBeat * Math.PI));

/** 輕輕晃（弧度），給 rot：走路時身體前後擺、開心時左右搖。 */
export const sway = (t: number, amp = 0.03, period = 1, phase = 0) => Math.sin(((t / period) + phase) * Math.PI * 2) * amp;

/** 每拍一下的衝擊：拍點上 1，之後 decay 秒內退回 0（點頭、踏步、跟著拍子壓一下）。 */
export function beatKick(au: AudioData, t: number, decay = 0.22): number {
  const b = Math.floor(au.beatAt(t) + 1e-6);
  const u = t - au.timeOfBeat(b);
  return u < 0 ? 0 : Math.exp((-3 * u) / decay);
}

/** 落地壓扁再回彈：落地那一刻壓扁 amt，之後像彈簧一樣回到 0（dur 秒內）。還沒落地傳回 0。 */
export function landSquash(t: number, tLand: number, amt = 0.16, dur = 0.28): number {
  const u = t - tLand;
  if (u < 0 || u > dur) return 0;
  const k = u / dur;
  return amt * Math.cos(k * Math.PI * 1.5) * (1 - k) * (1 - k);
}

/**
 * 跳躍：t0 起跳、t1 落地、最高 height（px）。回傳 y（往上是負的，直接加到腳底 y）、squash（起跳前蹲一下、空中拉長、落地壓扁回彈）、
 * air（在空中）、u（0..1 空中的進度，挑姿勢用）。頂點在 (t0 + t1) / 2：要讓「那一下」（擊球、咬到）落在拍點，就把拍點放在中間。
 */
export function jumpArc(t: number, t0: number, t1: number, height: number, o: { crouch?: number; stretch?: number; land?: number } = {}): { y: number; squash: number; air: boolean; u: number } {
  const crouch = o.crouch ?? 0.12, stretch = o.stretch ?? 0.08, land = o.land ?? 0.16;
  const pre = Math.min(0.12, (t1 - t0) * 0.3);
  if (t < t0) {
    // 起跳前：蹲一下
    const k = clamp((t - (t0 - pre)) / pre, 0, 1);
    return { y: 0, squash: crouch * Math.sin(k * Math.PI * 0.5), air: false, u: 0 };
  }
  if (t <= t1) {
    const u = (t - t0) / Math.max(1e-6, t1 - t0);
    const y = -4 * height * u * (1 - u);
    // 剛起跳拉長、到頂點恢復、快落地再拉長一點點
    const sq = -stretch * (1 - Math.sin(u * Math.PI)) * (u < 0.5 ? 1 : 0.5);
    return { y, squash: sq, air: true, u };
  }
  return { y: 0, squash: landSquash(t, t1, land), air: false, u: 1 };
}

/**
 * 紙偶進場：從側面（一條線）翻正，最後稍微轉過頭再彈回來（outBack）。回傳給 drawPuppet 的 spin 與 alpha，
 * 還有 k（0..1 進度，接仙女棒的火花用）。t0 之前不畫（alpha 0）。
 */
export function puppetIn(t: number, t0: number, dur = 0.42): { spin: number; alpha: number; k: number } {
  const k = clamp((t - t0) / dur, 0, 1);
  const e = k >= 1 ? 1 : 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
  return { spin: 0.24 * (1 - e), alpha: clamp(k * 5, 0, 1), k };
}

// ---------------------------------------------------------------- 紙偶版面共用：留言（標準 v2）
/**
 * 寫在場景物件上的主打留言，照「留言尺寸與版面比例標準 v2」（TREATMENT.md）：字級 40～60（依字數，只有愛心 72）、
 * 署名 26～32 在最後一行下面；先照子句斷行（fitClauses），放不下才交給 fitText。回傳 _couple 的 Note，用 drawNote 畫。
 * name = null：不簽名（沒有留言時的邀請文字）。
 */
export function noteV2(c: Ctx, text: string, name: string | null, w: number, h: number, o: { family?: string; lineHeight?: number; max?: number; maxLines?: number } = {}): Note {
  const family = o.family ?? F.hand(400);
  const lh = o.lineHeight ?? 1.26;
  const max = Math.min(o.max ?? 99, msgMaxFor(text));
  const sigEst = name === null ? 0 : sigV2(max);
  const room = h - sigEst * 1.6;
  const fit = fitClauses(c, text, family, w, room, { min: V2.msgMin, max, lineHeight: lh, maxLines: o.maxLines ?? 5 })
    ?? layoutMessage(c, text, family, w, room, { min: V2.msgMin, max, lineHeight: lh, maxLines: 8 });
  const sig = name === null ? 0 : sigV2(fit.size);
  return { fit, family, sig, sigRow: sig * 1.6, width: w, height: fit.height + sig * 1.6, name };
}

/**
 * 容器跟著字縮窄（標準 v2：容器只比文字多一點邊距）：把 note.width 改成實際的字寬（含署名、留一點愛心的餘量），
 * 回傳新的寬；版面用它決定牌子／卡片的寬（高度本來就跟著 note.height）。署名靠右對齊到這個寬。
 */
export function tightenNote(c: Ctx, n: Note, minW = 0): number {
  let w = n.fit.width + 8;
  if (n.name !== null && n.sig) {
    c.save();
    c.font = font(n.family, n.sig);
    w = Math.max(w, c.measureText(signature(n.name)).width + n.sig);
    c.restore();
  }
  n.width = Math.min(n.width, Math.max(minW, Math.ceil(w)));
  return n.width;
}
