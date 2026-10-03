// Scene API. A scene owns a time window of the song and renders HDR linear colour
// into the render target it is given. Everything must be a deterministic function of
// time (plus internal state advanced only through render() calls, see `stateful`).
//
// 複製自 pdoom-video（MIT，見 ./LICENSE）並改成婚禮版：
//  - pdoom 的時間軸是固定的，一個 entry 一個場景物件；大螢幕的時間軸由導演（director.ts）邊播邊排，
//    所以場景物件是「每個窗格新建一個、播完就丟」。init() 照樣可以預先排版（這個窗格要顯示的留言已經定了），
//    但 GPU 資源一定要在 dispose() 釋放：用 this.track(x) 登記的東西會自動 dispose。
//    很貴又不會變的東西（shader）請用 shared() 在模組層共用，不要每個窗格重建。
//  - ctx 多了 song（這首歌是誰唱的、第幾首）與 live（現在總共有幾則留言、留言網址）。
import type * as THREE from 'three';
import type { AudioData, AudioSample } from './audio';
import type { Lyrics } from './lyrics';
import type { Compositor } from './gl';
import type { PostParams } from './post';

/** 一則要上螢幕的留言（已清理過：愛心統一成 ♥、其他 emoji 拿掉、空白收斂）。 */
export interface Msg {
  id: number;
  /** 顯示用的名字（沒填是空字串，版面自己決定要寫「匿名」還是不寫）。 */
  name: string;
  /** 顯示用的內容。 */
  text: string;
  /** 第幾則（依送出順序，1 起算），版面可以印成「No.042」。 */
  n: number;
  /** 新人自己在後台加的（例如開場的歡迎詞）。 */
  couple: boolean;
}

export interface SongInfo {
  id: number;
  title: string;
  artist: string;
  /** 歌單裡第幾首（1 起算）與總共幾首。 */
  index: number;
  count: number;
  /** 這首歌用的配色主題（themes.ts）。 */
  theme: string;
}

export interface LiveInfo {
  /** 目前螢幕上可以出現的留言總數。 */
  readonly count: number;
  /** 賓客留言的網址（QR code 指向這裡）。 */
  readonly url: string;
  /** 顯示用的短網址（不含 https://）。 */
  readonly shortUrl: string;
  /** 現在時間「7:30 PM」（右下角小小的時鐘，12 小時制；截圖／驗收時固定，畫面才可重現）。 */
  readonly clock?: string;
  /** 商業版的業者署名「由 晴光婚攝 提供」（右下角最底下一行）；新人自己買的婚禮沒有。見 wedding.ts 的 CREDIT。 */
  readonly credit?: string;
}

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  audio: AudioData;
  lyrics: Lyrics;
  comp: Compositor;
  W: number;
  H: number;
  /** Timeline entry id and its free-form params (lets one scene module serve several entries). */
  id: string;
  params: Record<string, any>;
  /** Entry window (song seconds). */
  start: number;
  end: number;
  song: SongInfo;
  live: LiveInfo;
}

export interface Frame {
  /** Song time (s). */
  t: number;
  /** Time since the previous rendered frame (1/fps on export; 0 after a seek). */
  dt: number;
  /** Local time since this scene's start, and 0..1 progress through its window. */
  lt: number;
  p: number;
  start: number;
  end: number;
  /** True when time jumped (scrub/seek) — stateful scenes should reset. */
  seeked: boolean;
  /** True while the engine fast-forwards a stateful scene after a seek (skip non-essential work). */
  preroll: boolean;
  /** Continuous beat/bar indices from the analysed grid, and their fractional phases. */
  beat: number;
  bar: number;
  beatPhase: number;
  barPhase: number;
  /** Audio features at t (envelopes 0..1 and decaying hit pulses). */
  a: AudioSample;
  /**
   * When this scene overlaps the previous one (a transition), the previous scene's
   * output texture for this frame; otherwise null. Scenes that set
   * `handlesTransition = true` composite it themselves.
   */
  under: THREE.Texture | null;
  /** 0..1 progress through the overlap with the previous scene (1 when not overlapping). */
  tin: number;
  /** 0..1 progress through the overlap with the next scene (0 when not overlapping). */
  tout: number;
}

export type PostOverrides = Partial<PostParams>;

interface Disposable { dispose(): void }

const sharedCache = new Map<string, unknown>();
/**
 * 模組層共用的資源（shader pass、固定的貼圖）：同一個 key 只建一次，給之後每個窗格重用。
 * 大螢幕一晚會建幾百個場景物件，shader 每次重建會卡頓。
 */
export function shared<T>(key: string, make: () => T): T {
  if (!sharedCache.has(key)) sharedCache.set(key, make());
  return sharedCache.get(key) as T;
}

export abstract class Scene {
  /** If true, the engine fast-forwards (calls render with preroll=true) after seeks. */
  stateful = false;
  /** Max seconds of history the engine re-simulates when seeking into a stateful scene. */
  prerollMax = 6;
  /** If true, this scene composites `f.under` itself during its incoming transition. */
  handlesTransition = false;
  private owned: Disposable[] = [];

  constructor(protected ctx: SceneCtx) {}

  /** 登記一個窗格結束要釋放的資源（Layer2D、LineBatch、render target…），回傳原物件方便一行寫完。 */
  protected track<T extends Disposable>(x: T): T { this.owned.push(x); return x; }

  /** Load/create resources. Called once before first render. */
  init(): Promise<void> | void {}

  /** Reset internal state (called on seeks for stateful scenes). */
  reset(): void {}

  /** Render into `out` (HalfFloat, linear HDR). Must fully overwrite/clear it. Return post-processing overrides. */
  abstract render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides | void;

  dispose(): void {
    for (const x of this.owned.splice(0)) { try { x.dispose(); } catch { /* 已經釋放過就算了 */ } }
  }
}

export type SceneClass = new (ctx: SceneCtx) => Scene;

/** 照片的種類（PlateSpecDecl.prefers）：照長寬比與解析度分。 */
export type PhotoKind = 'landscape' | 'portrait' | 'square' | 'small';

/**
 * 版面自己宣告的排程參數：在版面檔裡 `export const spec: PlateSpecDecl = {...}`，導演（director.ts）會讀，
 * 加新版面不用改導演。沒寫的欄位用預設值（任何能量、4～8 小節、有沒有留言都能排、權重 1、類別 type）。
 */
export interface PlateSpecDecl {
  /** 適合的段落能量範圍（0..1）：副歌高、抒情段低。 */
  energy?: [number, number];
  /** 偏好的長度（小節數）。 */
  bars?: [number, number];
  /** 紙底（亮）的版面：導演會讓亮暗交替。 */
  paper?: boolean;
  /** 一次展示很多則留言：留言少於這個數字就不排。 */
  minMessages?: number;
  /** 沒有主打留言也能排（只有歌詞或邀請）。預設 true。 */
  lyricsOnly?: boolean;
  /** 被挑中的相對機率（預設 1）。 */
  weight?: number;
  /** 變化款數（params.variant = 0..n-1）。 */
  variants?: number;
  /** 類別：couple = 手繪新人互動動畫（點綴，導演不會讓它連續出現），type = 文字／圖像版面。 */
  group?: 'couple' | 'type';
  /**
   * 照片版面：只排在「照片窗格」（新人在後台打開了照片，`params.photo` 一定有、沒有主打留言），一般窗格不會排到。
   * 照片是新人自己選的（婚紗照、成長照、手機照），可能很大也可能很小、橫的直的都有，版面要都撐得住。見 ENGINE.md「照片版面」。
   */
  photo?: boolean;
  /**
   * 照片版面一次放幾張（預設 1）。大於 1 時 `params.photos` 一定剛好是這麼多張（照片池準備好的不夠就不排這個版面），
   * `params.photo` 是第一張（主角）：這一格的字只放第一張的註解，其他張是畫面的一部分。
   */
  photos?: number;
  /** 照片版面的小系列（底片、相框、相簿…）：同系列不要連著出現。 */
  series?: string;
  /**
   * 照片版面最適合放哪種照片（沒寫 = 什麼照片都一樣好看）：landscape 橫的、portrait 直的（含手機直拍）、
   * square 方的、small 很小的舊照片（長邊不到 1200）。導演會先看接下來的照片是哪種，優先挑適合的版面
   * （不適合的版面還是可能排到，所以每個版面仍然要撐得住任何照片）。一次放好幾張的版面看的是那幾張。
   */
  prefers?: PhotoKind[];
  /**
   * 後台「版面」分頁的縮圖在窗格的哪裡拍（0..1，預設約 0.67）。縮圖工具用 20～36.4 秒的窗格拍一張：
   * 收尾的畫面看不出這個版面在做什麼時（例如照片疊被抽到只剩一張），指定一個最有代表性的時間點。
   */
  thumbAt?: number;
  /** 系列（doc、machine、city…）：同一系列不要連著出現。 */
  family?: string;
  /**
   * 雙語版面：有翻譯的歌（韓文歌）中文與原文兩行**一定都畫得清楚**，有主打留言的窗格也照樣畫原文副行
   * （一般版面有留言時會收起原文，只剩中文）。有翻譯的歌如果排到一般版面，有留言的窗格就只剩一種文字，
   * 看起來像翻譯不見了，所以有翻譯的歌導演只排 bilingual 的版面。
   */
  bilingual?: boolean;
}
