// 導演：邊播邊排「下一個窗格」——用哪個版面、主打哪則留言、在哪一拍切。
//
// pdoom 的剪接（timeline.ts）是人工的：每個版面錨在某一句歌詞，切點吸到節拍格。婚禮歌單一直在變，
// 所以把同一套規則自動化：
//  - 切點只落在拍點上，偏好：段落開頭 > 歌詞一行開頭前的那一拍 > 小節線；避免切在一句歌詞中間。
//  - 窗格長度：版面自己的偏好小節數，而且要夠讀完主打的留言（中文約每秒 6 字，再加進場退場）。
//  - 版面：依這一段的能量挑（副歌用強烈的、抒情段用安靜的），不跟前兩個重複，暗底／紙底交替。
//  - 每首歌開頭是「歌名卡」；還沒有留言、或隔一陣子，就插一張大 QR 的「邀請卡」。
//  - 放哪些內容是新人自己選的（後台「內容」，feed 的 content）：不放賓客留言就不排邀請卡；
//    打開照片時，照片窗格（照片版面＋照片）跟一般窗格照新人選的比例輪流（「全放照片」就每一格都是照片）。
//    照片窗格也是 MV：照樣跟唱歌詞、照樣放賓客的祝福（主字是留言或註解，見 photoHero），新留言一定插隊。
// 全部用種子（歌的 id、第幾個窗格）決定，同一首歌同樣的留言重播會排得一樣。
import type { Engine, TimelineEntry, SongRuntime } from './engine/engine';
import { hash } from './engine/util';
import { readSeconds } from './engine/text';
import type { MessagePool } from './pool';
import type { Msg } from './engine/scene';
import type { PhotoPeek, PhotoPool, PhotoRef } from './photos';
import type { PhotoKind } from './engine/scene';
import { DEFAULT_CONTENT, type WallContent } from './net';

export interface PlateSpec {
  /** scenes/<name>.ts */
  name: string;
  /** 類別：couple = 手繪新人互動，type = 文字／圖像。 */
  group?: 'couple' | 'type';
  /** 系列（同一系列不要連著出現）。 */
  family?: string;
  /** 雙語版面（見 engine/scene.ts PlateSpecDecl.bilingual）：有翻譯的歌只排這種。 */
  bilingual?: boolean;
  /** 照片版面（見 engine/scene.ts PlateSpecDecl.photo）：只排在照片窗格。 */
  photo?: boolean;
  /** 照片版面一次放幾張（預設 1；照片池準備好的張數不夠就不排）。 */
  photos?: number;
  /** 照片版面的小系列（底片、相框、相簿…）：同系列不要連著出現。 */
  series?: string;
  /** 照片版面最適合哪種照片（見 engine/scene.ts PlateSpecDecl.prefers）。 */
  prefers?: PhotoKind[];
  /** 適合的段落能量範圍（0..1）。 */
  energy: [number, number];
  /** 偏好的長度（小節數）。 */
  bars: [number, number];
  /** 紙底（亮）的版面：跟暗底交替，畫面才有明暗節奏。 */
  paper?: boolean;
  /** 一次展示很多則留言（祝福牆）：留言少於這個數字就不排。 */
  minMessages?: number;
  /** 沒有留言也能排（純歌詞）。 */
  lyricsOnly?: boolean;
  /** 被挑中的相對機率。 */
  weight?: number;
  /** 變化款數（params.variant = 0..n-1）。 */
  variants?: number;
}

/**
 * 照片版面配這幾張照片有多合適（相對機率的倍數）：
 *  - 種類：版面寫了最適合哪種照片（直的配直的相框、很小的舊照片配「相片放桌上」），接下來的照片越多張符合越優先；
 *    完全不符合也不排除（每個版面都撐得住任何照片，只是不是最好看的組合）。不知道長寬的照片不算。
 *  - 明暗：暗的照片配亮的版面、很亮的照片配暗的版面，對比夠，照片才不會悶在暗底裡、也不會在紙底上顯得刺眼。
 */
export function photoFit(spec: PlateSpec, ahead: PhotoPeek[]): number {
  let w = 1;
  const known = ahead.filter((a) => a.kinds.length);
  if (spec.prefers?.length && known.length) {
    const hit = known.filter((a) => a.kinds.some((k) => spec.prefers!.includes(k))).length / known.length;
    w *= 0.3 + 2.7 * hit;
  }
  const lum = ahead[0]?.lum;
  if (lum != null) {
    if (lum < 0.3) w *= spec.paper ? 1.8 : 0.7;
    else if (lum > 0.68) w *= spec.paper ? 0.6 : 1.4;
  }
  return w;
}

/**
 * 版面清單。檔案不存在的（還沒做好）自動跳過；karaoke 是最基本的保底版面（pdoom 的 starter 版面改的）。
 */
export const PLATES: PlateSpec[] = [
  { name: 'sparkler', energy: [0, 0.75], bars: [4, 8], lyricsOnly: true, weight: 1.2 },
  { name: 'slam', energy: [0.5, 1], bars: [2, 4], lyricsOnly: true, weight: 1.2, variants: 4 },
  { name: 'certificate', energy: [0.15, 0.8], bars: [4, 8], paper: true, weight: 1 },
  { name: 'heartbeat', energy: [0.35, 1], bars: [4, 8], lyricsOnly: true, weight: 1 },
  { name: 'stars', energy: [0, 0.6], bars: [4, 8], lyricsOnly: true, weight: 1 },
  { name: 'banknote', energy: [0.2, 0.85], bars: [4, 8], paper: true, weight: 0.9 },
  { name: 'mosaic', energy: [0.45, 1], bars: [4, 8], minMessages: 6, weight: 0.8 },
  { name: 'fireworks', energy: [0.3, 1], bars: [4, 8], lyricsOnly: true, weight: 1 },
  { name: 'vinyl', energy: [0, 0.7], bars: [4, 8], lyricsOnly: true, weight: 0.9 },
  { name: 'karaoke', energy: [0, 1], bars: [4, 8], lyricsOnly: true, weight: 0.15 },
];

/** 每隔多久（秒）插一張大 QR 的邀請卡。 */
const INVITE_EVERY = 240;

export class Director {
  private song!: SongRuntime;
  private startAt = 0;
  private idx = 0;
  private history: string[] = [];
  /** 整晚最近用過的版面（換歌不清空）：兩百個版面要輪得開，不要上一首剛看過的又出現。 */
  private recent: string[] = [];
  private lastInvite = -Infinity;
  /** 外部可以強制下一個窗格用哪個版面（開發模式、截圖用）。 */
  force: { scene: string; params?: Record<string, any> } | null = null;
  /** 新人在後台關掉的版面（feed 的 plates_off）：不排。 */
  off = new Set<string>();
  /** 現在的場合只用這幾個版面（feed 的 scene.plates）；空的 = 照「版面」分頁（off 以外的全部）。 */
  only = new Set<string>();
  /** 換版面的節奏（後台設定 wall_pace）：fast／normal／slow。 */
  pace: 'fast' | 'normal' | 'slow' = 'normal';
  /** 新人選的內容（feed 的 content）。 */
  content: WallContent = DEFAULT_CONTENT;
  /** 預覽某個照片版面、但這場婚禮還沒有照片時用的示範照片（main.ts 給）。 */
  samplePhoto: (() => PhotoRef) | null = null;
  /** 照片窗格輪到第幾格（照片與一般窗格照比例輪流；整晚接續，換歌不歸零）。 */
  private slot = 0;
  /** 上一個照片窗格用的版面（中間隔著一般窗格也算：照片版面不要連著重複、同系列不要連著）。 */
  private lastPhotoPlate = '';
  /** 每張照片今晚上過幾次螢幕（照片 id → 次數）：有註解的照片一輪放註解、一輪放賓客留言。 */
  private photoShows = new Map<number, number>();

  constructor(private engine: Engine, private pool: MessagePool, private photos: PhotoPool | null = null) {}

  /** 換歌。startAt：從第幾秒開始播（後台剪掉前奏時不是 0）。 */
  startSong(song: SongRuntime, startAt = 0) {
    this.song = song;
    this.startAt = startAt;
    this.songStart = startAt;
    this.idx = 0;
    this.history = [];
    this.salt = this.fixedSeed ? 0 : Math.floor(Math.random() * 1e6);
  }

  /**
   * 操作列拉進度條跳到 t：呼叫前先把引擎的時間軸清空，這裡從 t 重新排。
   * 跳到歌的中間就不再放歌名卡（歌名卡只在一首歌的開頭），跳回開頭幾秒內才重放。
   */
  seek(t: number) {
    this.startAt = t;
    this.idx = t - this.songStart > 8 ? Math.max(this.idx, 1) : 0;
  }
  private songStart = 0;

  /**
   * 這一次播放的亂數種子：每次開始一首歌都換（同一首歌每次播都排出一樣的版面順序，整晚看下來會膩）。
   * 截圖／驗收（fixedSeed）固定 0，同一首歌排出來才會一樣。
   */
  private salt = 0;
  fixedSeed = false;
  private rnd(k: number) { return hash(this.song.info.id, this.idx, k, this.salt); }

  /** 每一格呼叫：時間軸上 t 之後至少要排到 t + 6 秒。 */
  update(t: number) {
    const tl = this.engine.timeline, dur = this.song.audio.duration;
    let end = tl.length ? Math.max(...tl.map((e) => e.end)) : this.startAt;
    if (end < t) {
      // 時間軸落在現在之後（會場電腦切到別的視窗再回來，會一直黑屏）：視窗被切走、縮小時瀏覽器停掉畫面更新，
      // 音樂照播，切回來時間一下跳很遠。原本從落後的地方一個一個補排，補排的窗格都已經播完、馬上被 gc 清掉，
      // 時間軸空了又從歌的開頭重排，永遠追不上，整首歌都沒有版面。改成當作拖進度條：直接從現在開始排。
      if (t >= dur) return; // 歌已經播完、正在換下一首：沒東西要排
      this.seek(t);
      end = t;
    }
    let guard = 0;
    while (end < Math.min(this.song.audio.duration, t + 6) && guard++ < 4) {
      const e = this.plan(end);
      this.engine.add(e);
      end = e.end;
    }
  }

  /** 從 from 開始排一個窗格。 */
  plan(from: number): TimelineEntry {
    const au = this.song.audio, dur = au.duration;
    const first = this.idx === 0;
    const exclude = new Set<number>(this.onScreen(from));
    let scene: string, params: Record<string, any> = {}, bars: [number, number] = [4, 8];
    let msg: Msg | null = null;
    let photo: PhotoRef | null = null;
    const energy = au.energyAt(Math.min(dur - 0.01, from + 4));
    const all = this.plates();
    const photoPlates = all.filter((p) => p.photo);
    const avail = all.filter((p) => !p.photo);

    if (this.force) {
      scene = this.force.scene; params = { ...(this.force.params ?? {}) };
      const ps = photoPlates.find((p) => p.name === scene);
      if (ps) {
        // 預覽照片版面：沒有主打留言；還沒有照片（或不夠張）就用示範照片
        const take = () => this.photos?.next() ?? this.samplePhoto?.() ?? null;
        photo = params.photo ?? take();
        if ((ps.photos ?? 1) > 1 && !params.photos) {
          const ok = (this.photos?.ready ?? 0) >= (ps.photos ?? 1);
          params.photos = [photo, ...Array.from({ length: (ps.photos ?? 1) - 1 }, () => (ok ? take() : this.samplePhoto?.() ?? null))].filter(Boolean);
        }
        // 有指定主打留言（截圖測「照片＋留言＋歌詞」）就放，沒指定就只有註解
        msg = params.message ?? null;
        params.message = null;
      } else msg = params.message ?? this.pool.nextHero(this.rnd(1), exclude);
    } else if (first) {
      // 歌名卡：從 0 到前奏結束（或至少兩小節），不超過八小節
      scene = 'title'; params = { kind: 'song' }; bars = [2, 8];
    } else if (this.content.messages && (this.pool.count === 0 ? from - this.lastInvite > 45 : from > 30 && performance.now() / 1000 - this.lastInvite > INVITE_EVERY)) {
      // 還沒有人留言：常常提醒大家掃 QR；有留言之後每四分鐘一次（新人不放賓客留言就沒有邀請卡）
      scene = 'title'; params = { kind: 'invite' }; bars = [4, 6];
      this.lastInvite = this.pool.count === 0 ? from : performance.now() / 1000;
    } else if (photoPlates.length && this.photoTurn()) {
      // 照片窗格：照片是主角，沒有主打留言。照片版面上百個：最近播過的、跟上一個照片版面同系列的少排，
      // 一次放好幾張的版面要照片池準備好的張數夠才排（一晚只有三張照片就不排六張的照片牆）；
      // 先看接下來是什麼照片（橫的、直的、很小的、暗的），優先挑適合的版面（photoFit）
      const pp = this.photos!;
      const ready = pp.ready;
      const fits = photoPlates.filter((p) => (p.photos ?? 1) <= ready);
      const ahead = pp.peek(Math.max(1, ...fits.map((p) => p.photos ?? 1)));
      const lastSpec = fits.find((p) => p.name === this.lastPhotoPlate);
      const pool = (fits.length ? fits : photoPlates.filter((p) => (p.photos ?? 1) <= 1)).map((p) => ({
        p, w: (p.weight ?? 1) * (p.name === this.lastPhotoPlate ? (fits.length > 1 ? 0 : 1) : this.recent.includes(p.name) ? 0.3 : 1)
          * (p.series && p.series === lastSpec?.series ? 0.2 : 1) * photoFit(p, ahead.slice(0, p.photos ?? 1)),
      }));
      let r = this.rnd(5) * pool.reduce((sum, x) => sum + x.w, 0);
      let spec = pool[0]?.p ?? photoPlates[0]!;
      for (const x of pool) { r -= x.w; if (r <= 0 && x.w > 0) { spec = x.p; break; } }
      scene = spec.name;
      bars = spec.bars;
      this.lastPhotoPlate = spec.name;
      if (spec.variants) params.variant = Math.floor(this.rnd(3) * spec.variants);
      // 照順序跟照片池拿（一次放好幾張的接著拿；第一張是主角，它的註解是這一格的字）
      const taken = Array.from({ length: spec.photos ?? 1 }, () => pp.next()).filter((x): x is PhotoRef => !!x);
      photo = taken[0] ?? null;
      if ((spec.photos ?? 1) > 1) params.photos = taken;
      if (photo) msg = this.photoHero(photo, exclude);
    } else {
      msg = this.pool.nextHero(this.rnd(1), exclude);
      // 不放賓客留言時，留言的位置放新人自己的話（可能只有一兩句）：剛播過也要再放，
      // 不然版面會畫「掃描右下角 QR code」的邀請，可是畫面上根本沒有 QR
      if (!msg && !this.content.messages) msg = this.pool.nextHero(this.rnd(1));
      const lyricsNow = !this.engine.lyricsOff && this.song.lyrics.linesIn(from, from + 12).length > 0;
      const ok = avail.filter((p) =>
        energy >= p.energy[0] - 0.05 && energy <= p.energy[1] + 0.05 &&
        (p.minMessages === undefined || this.pool.count >= p.minMessages) &&
        (msg || p.lyricsOnly) && (msg || lyricsNow || p.name !== 'karaoke') &&
        !this.history.slice(-2).includes(p.name));
      const specOf = (n: string | undefined) => avail.find((p) => p.name === n);
      const lastPaper = specOf(this.history[this.history.length - 1])?.paper;
      // 手繪新人互動是點綴（新人說「一點點、有些場景有就好」）：剛出現過就先不要再來
      const coupleRecently = [1, 2].some((k) => specOf(this.history[this.history.length - k])?.group === 'couple');
      // 都不合適就退回「不要跟上一個一樣」；場合只挑了一兩個版面時連這個都沒有，就照樣重複（不要跑出沒挑的版面）
      const alt = avail.filter((p) => p.name !== this.history[this.history.length - 1]);
      const pool = (ok.length ? ok : alt.length ? alt : avail).map((p) => ({
        // 同一首歌已經用過的版面機率降到三成：一首歌裡盡量每個窗格都不一樣
        p, w: (p.weight ?? 1) * (p.paper && lastPaper ? 0.25 : 1) * (p.name === 'karaoke' && ok.length > 1 ? 0.2 : 1)
          * (this.history.includes(p.name) ? 0.3 : this.recent.includes(p.name) ? 0.4 : 1) * (coupleRecently && p.group === 'couple' ? 0.1 : 1)
          // 同一系列（例如都是紙本文件、都是機器）不要連著出現
          * (p.family && p.family === specOf(this.history[this.history.length - 1])?.family ? 0.2 : 1),
      }));
      let r = this.rnd(2) * pool.reduce((s, x) => s + x.w, 0);
      let spec = pool[0]?.p ?? { name: 'karaoke', energy: [0, 1], bars: [4, 8] } as PlateSpec;
      for (const x of pool) { r -= x.w; if (r <= 0) { spec = x.p; break; } }
      scene = spec.name;
      bars = spec.bars;
      // 還有新留言在排隊：窗格短一點（最多 8 小節），新留言才不用等太久才上螢幕
      if (this.pool.freshCount > 0) bars = [bars[0], Math.max(bars[0], Math.min(bars[1], 8))];
      if (spec.variants) params.variant = Math.floor(this.rnd(3) * spec.variants);
    }
    if (msg) { params.message = msg; this.pool.markShown(msg.id); }
    if (photo) params.photo = photo;
    // 全部可上螢幕的留言：每個窗格都給（片尾名單、便利貼牆、聊天室的歷史泡泡會拿來用），版面不用為了拿清單而設 minMessages
    params.messages ??= this.pool.all.slice();
    params.seed = Math.floor(this.rnd(4) * 1e6);
    params.energy = energy;

    // 長度：版面偏好，但要夠讀完留言。
    // 只照小節數排的話，慢歌有時候 4、5 句歌詞才換一個版面，太久：改成照秒數算（快歌慢歌換的頻率差不多），
    // 後台可選節奏——快：4～7 秒（約每 1～2 句）、中（預設）：6～10 秒（約每 2 句）、慢：照版面自己的小節數（原本的樣子）。
    const barLen = Math.max(0.8, au.timeOfBar(Math.floor(au.barAt(from)) + 1) - au.timeOfBar(Math.floor(au.barAt(from))));
    if (!first && this.pace !== 'slow' && scene !== 'title') {
      const [s0, s1] = this.pace === 'fast' ? [4, 7] : [6, 10];
      const b0 = Math.max(2, Math.round(s0 / barLen));
      bars = [b0, Math.max(b0 + 1, Math.round(s1 / barLen))];
    }
    // 照片：讀完主字（留言或註解），再多留幾秒看照片
    const nPhotos = params.photos?.length ?? 1;
    const look = (this.pace === 'slow' ? 5 : this.pace === 'fast' ? 2.5 : 3.5) + Math.min(4, (nPhotos - 1) * 1.2);
    const need = photo ? (msg ? readSeconds(msg.text) : photo.caption ? readSeconds(photo.caption) : 0) + look
      : msg ? readSeconds(msg.text) + (this.pace === 'slow' ? 3.5 : 2) : 0;
    const minD = Math.max(bars[0] * barLen, need, first ? 3.5 : this.pace === 'fast' ? 3 : 4);
    const maxD = Math.max(minD + barLen, bars[1] * barLen, need + (this.pace === 'slow' ? 2 : 1) * barLen);
    let end = first ? this.introEnd(from, minD, Math.min(maxD, 8 * barLen)) : this.bestCut(from, minD, maxD, (minD + maxD) / 2);
    // 剩下的尾巴太短（不到 5 秒）：這個窗格直接撐到歌曲結束
    if (dur - end < 5) end = dur;
    const e: TimelineEntry = { id: `s${this.song.info.id}-w${this.idx}-${scene}`, scene, start: from, end, params };
    this.history.push(scene);
    this.recent.push(scene);
    if (this.recent.length > 60) this.recent.shift();
    this.idx++;
    return e;
  }

  /**
   * 這個窗格要不要放照片：不要歌詞也不放留言、或新人選「全放照片」時每一格都是照片；其他照新人選的比例輪流。
   * 新留言不用避開照片窗格：照片窗格也放留言（photoHero 讓新留言插隊），比例照新人選的。
   */
  private photoTurn(): boolean {
    const c = this.content;
    if (!c.photos || !this.photos?.ready) return false;
    if ((c.messages || c.lyrics) && c.mix !== 'all') {
      const pattern = c.mix === 'photos' ? [1, 1, 0] : c.mix === 'messages' ? [1, 0, 0] : [1, 0];
      if (!pattern[this.slot++ % pattern.length]) return false;
    }
    return true;
  }

  /**
   * 照片窗格的主字要不要放賓客留言（回傳要放的留言；null = 放註解，沒註解就只有照片＋歌詞）：
   *  - 新人不放賓客留言：一律放註解（新人自己寫的話是給一般版面補 QR 邀請的位置用的，照片窗格不需要）。
   *  - 有新留言在排隊：插隊，這一格放它（賓客要在十幾秒內看到自己的話；註解下一輪再放）。
   *  - 沒有註解的照片：放一則舊留言（照片上也看得到祝福）。
   *  - 有註解的照片：一輪放註解、一輪放留言。照片 id 錯開奇偶，第一輪就有一半照片放註解、一半放祝福。
   * 還沒有人留言時 nextHero 是 null，就照樣放註解。
   */
  private photoHero(photo: PhotoRef, exclude: Set<number>): Msg | null {
    const n = this.photoShows.get(photo.id) ?? 0;
    this.photoShows.set(photo.id, n + 1);
    if (!this.content.messages) return null;
    const captionTurn = !!photo.caption && (n + Math.abs(photo.id)) % 2 === 0;
    if (captionTurn && this.pool.freshCount === 0) return null;
    return this.pool.nextHero(this.rnd(1), exclude);
  }

  /**
   * 可以排的版面：有載到的版面模組（title 是片頭卡，另外排）。參數以版面檔的 export const spec 為準，
   * 其次是上面的 PLATES，都沒有就用預設值。
   */
  private plates(): PlateSpec[] {
    let out = this.collect((name) => !this.off.has(name));
    // 場合只用新人挑的幾個版面（挑了就算在「版面」分頁關掉也照樣用）。只挑了一般版面（或只挑了照片版面）時，
    // 另一種照「版面」分頁開著的排：不然放照片的窗格沒有版面可用，或只剩照片版面排不了歌詞與留言
    if (this.only.size) {
      const mine = this.collect((name) => this.only.has(name));
      const has = (photo: boolean) => mine.some((p) => !!p.photo === photo);
      out = [...mine, ...out.filter((p) => !has(!!p.photo))];
    }
    // 有翻譯的歌（韓文歌）只排雙語版面：一般版面有主打留言時會收起原文，畫面上就只剩一種文字，看起來像翻譯不見了。
    // 雙語版面不到 8 個（還在陸續做、或被後台關掉）時退回全部：只有兩三個版面輪流播，一首歌會重複到很膩。
    // 照片版面不受影響（照片窗格不畫原文）。
    if (!this.engine.lyricsOff && this.song.lyrics.lines.some((l) => l.sub)) {
      const bi = out.filter((p) => p.bilingual);
      if (bi.length >= 8) return out.filter((p) => p.bilingual || p.photo);
    }
    return out;
  }

  /** 有載到的版面裡，keep 說要的那些（參數照 plates() 說的順序合併）。 */
  private collect(keep: (name: string) => boolean): PlateSpec[] {
    const out: PlateSpec[] = [];
    for (const name of this.engine.classes.keys()) {
      if (name === 'title' || !keep(name)) continue;
      const base = PLATES.find((p) => p.name === name);
      const decl = this.engine.specs.get(name) ?? {};
      out.push({ energy: [0, 1], bars: [4, 8], lyricsOnly: true, weight: 1, group: 'type', ...base, ...decl, name });
    }
    return out;
  }

  /** 正在畫面上（或排好了）的留言 id：主打不要跟它們重複。 */
  private onScreen(t: number): number[] {
    const ids: number[] = [];
    for (const e of this.engine.timeline) if (e.end > t - 4 && e.params?.message) ids.push(e.params.message.id);
    for (const m of this.pool.all) if (this.engine.overlay.showing(m.id, t)) ids.push(m.id);
    return ids;
  }

  /** 歌名卡在哪裡結束：第一句歌詞前的那一拍（前奏很長就最多 maxD）。 */
  private introEnd(from: number, minD: number, maxD: number): number {
    const first = this.song.lyrics.lines[0];
    const au = this.song.audio;
    if (first && first.start - from >= minD && first.start - from <= maxD + 4) {
      const b = au.timeOfBeat(Math.floor(au.beatAt(first.start + 0.02)));
      if (b - from >= minD) return b;
    }
    return this.bestCut(from, minD, maxD, Math.min(maxD, minD + 2));
  }

  /**
   * 在 [from+minD, from+maxD] 裡挑一個切點：靠近 target、落在段落開頭／歌詞一行開頭前的拍點／小節線加分，
   * 切在一句歌詞正中間扣分。
   */
  private bestCut(from: number, minD: number, maxD: number, target: number): number {
    const au = this.song.audio, ly = this.song.lyrics;
    const lo = from + minD, hi = Math.min(au.duration, from + maxD);
    if (lo >= au.duration) return au.duration;
    const cands = new Map<number, number>(); // 時間 → 加分
    const add = (t: number, bonus: number) => {
      if (t < lo - 1e-3 || t > hi + 1e-3) return;
      const k = Math.round(t * 1000) / 1000;
      cands.set(k, Math.max(cands.get(k) ?? 0, bonus));
    };
    for (let b = Math.ceil(au.barAt(lo)); au.timeOfBar(b) <= hi; b++) add(au.timeOfBar(b), 0.5);
    for (const s of au.sections) add(au.nearestBeat(s.start), 1.6);
    for (const l of ly.lines) add(au.timeOfBeat(Math.floor(au.beatAt(l.start + 0.02))), 1.1);
    if (!cands.size) {
      // 範圍內沒有小節線（很慢的歌）：退而求其次用拍點
      for (let b = Math.ceil(au.beatAt(lo)); au.timeOfBeat(b) <= hi; b++) add(au.timeOfBeat(b), 0);
    }
    if (!cands.size) return Math.min(au.duration, au.nextBeat(lo));
    const barLen = Math.max(0.8, au.beatPeriod(from) * 4);
    let best = lo, bestScore = -Infinity;
    for (const [t, bonus] of cands) {
      const mid = ly.lines.some((l) => l.start < t - 0.35 && l.end > t + 0.35);
      const sc = -Math.abs(t - (from + target)) / barLen + bonus - (mid ? 1.8 : 0);
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    return best;
  }
}
