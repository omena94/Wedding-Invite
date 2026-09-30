// The engine: owns the renderer, loads scenes for the timeline, renders any song time
// deterministically (with preroll for stateful scenes), composites transitions, HUD, post.
//
// 複製自 pdoom-video（MIT，見 ./LICENSE）並改成婚禮版：
//  - pdoom 開機時就把整首歌的時間軸建好；大螢幕是整晚一首接一首，時間軸由導演（director.ts）邊播邊排，
//    所以這裡的 timeline 是「目前這首歌、已經排好的窗格」，add() 加進來就開始在背景建場景，播完的窗格會被 gc() 釋放。
//  - 換歌時 setSong()：時間 t 一律是「這首歌的第幾秒」，跟 pdoom 一樣。
//  - 場景畫完、上後製之前，多畫一層即時留言小卡（overlay.ts），所以小卡上的火花也會發光。
//  - pdoom 匯出用的「自適應動態模糊取樣」拿掉了（大螢幕是即時播放，一格就是一次）；固定張數的取樣保留，之後要匯出影片還能用。
//  - 正式播放時場景壞掉不能畫紅色：只在 debug（開發模式）畫紅色，平常畫底色並跳過。
import * as THREE from 'three';
import { AudioData } from './audio';
import { Lyrics } from './lyrics';
import { Compositor, FSPass, W, H, PW, PH, SS_TAP, makeRT, clearRT } from './gl';
import { DEFAULT_POST, Post, type PostParams } from './post';
import { Hud } from './hud';
import { Overlay } from './overlay';
import type { Frame, Scene, SceneClass, SceneCtx, PostOverrides, SongInfo, LiveInfo, PlateSpecDecl } from './scene';
import { loadFonts, loadText } from './type';
import { SHARED as GLYPHS_SHARED, SCENES as GLYPHS } from 'virtual:wall-glyphs';
import { loadStrokeFonts } from './stroke';
import { LIN } from './palette';

export interface TimelineEntry {
  /** 窗格的唯一代號（例如 `s3-w12-sparkler`）。 */
  id: string;
  /** 版面模組名：scenes/<scene>.ts。 */
  scene: string;
  start: number;
  end: number;
  /** Free-form params handed to the scene as ctx.params（這個窗格要顯示的留言、變化款、亂數種子…）。 */
  params: Record<string, any>;
  /** Default post overrides for this entry (the scene's own overrides win). */
  post?: PostOverrides;
}

/** 一首歌播放時需要的東西。 */
export interface SongRuntime { info: SongInfo; audio: AudioData; lyrics: Lyrics }

interface Loaded { entry: TimelineEntry; scene: Scene | null; ready: Promise<void>; error?: string; lastT: number }

// Scene modules are discovered lazily so a missing/broken scene never breaks the build.
// 檔名 _ 開頭（_motifs.ts）或含 -（sparkler-glsl.ts 這種輔助檔）的不是版面。
const modules = import.meta.glob<{ default: SceneClass; spec?: PlateSpecDecl }>('../scenes/*.ts');
export const SCENES = Object.keys(modules)
  .map((p) => /\/([\w-]+)\.ts$/.exec(p)![1]!)
  .filter((n) => !n.startsWith('_') && !n.includes('-'));

export class Engine {
  renderer: THREE.WebGLRenderer;
  song!: SongRuntime;
  live: LiveInfo;
  hud!: Hud;
  overlay!: Overlay;
  post!: Post;
  comp = new Compositor();
  classes = new Map<string, SceneClass>();
  /** 版面檔自己宣告的排程參數（export const spec）。 */
  specs = new Map<string, PlateSpecDecl>();
  loaded = new Map<string, Loaded>();
  timeline: TimelineEntry[] = [];
  /** 開發模式：壞掉的場景畫暗紅色，錯誤訊息印出來。 */
  debug = false;
  errors: string[] = [];
  private rts = [makeRT(), makeRT(), makeRT()];
  private mixRT = makeRT(W, H, { depthBuffer: false });
  private sumRT = makeRT(W, H, { depthBuffer: false, type: THREE.FloatType });
  private avgRT = makeRT(W, H, { depthBuffer: false });
  private finalRT = new THREE.WebGLRenderTarget(PW, PH, { type: THREE.UnsignedByteType, depthBuffer: false });
  private blit: FSPass;
  private xfade: FSPass;
  private accum: FSPass;
  private lastT = -1;
  lastPost: PostParams = { ...DEFAULT_POST };
  /** Suppress the HUD (captions, crop marks) — used when rendering plate thumbnails. */
  hudOff = false;

  constructor(public canvas: HTMLCanvasElement, live: LiveInfo) {
    this.live = live;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(PW, PH, false);
    this.renderer.autoClear = false;
    this.blit = new FSPass(`uniform sampler2D src; void main(){ fragColor = texture(src, vUv); }`, { src: { value: null } });
    this.xfade = new FSPass(`uniform sampler2D a; uniform sampler2D b; uniform float k;
      void main(){ fragColor = mix(texture(a, vUv), texture(b, vUv), k); }`, { a: { value: null }, b: { value: null }, k: { value: 0 } });
    // adds a sub-frame to a sum; a non-finite pixel (a stray NaN from some shader in one sub-frame out of
    // hundreds) is dropped, or it would poison the average and bloom into a disc
    this.accum = new FSPass(`uniform sampler2D src;
      void main() {
        vec4 c = texture(src, vUv);
        bool ok = abs(c.r) <= 6e4 && abs(c.g) <= 6e4 && abs(c.b) <= 6e4 && abs(c.a) <= 6e4;
        fragColor = ok ? c : vec4(0.0);
      }`, { src: { value: null } }, { blending: THREE.CustomBlending, transparent: true });
    const am = this.accum.mat;
    am.blendEquation = THREE.AddEquation;
    am.blendSrc = THREE.OneFactor; am.blendDst = THREE.OneFactor;
    am.blendSrcAlpha = THREE.ZeroFactor; am.blendDstAlpha = THREE.OneFactor;
  }

  /** 載字型、所有版面模組、後製與 HUD。開機時呼叫一次。 */
  async init(only?: string[]) {
    await Promise.all([loadFonts(), loadStrokeFonts()]);
    // only：只載指定的版面（加上片頭卡與保底的 karaoke），開發截圖用
    const names = only ? SCENES.filter((n) => n === 'title' || n === 'karaoke' || only.includes(n)) : SCENES;
    await Promise.all(names.map(async (name) => {
      try {
        const mod = await modules[`../scenes/${name}.ts`]!();
        this.classes.set(name, mod.default);
        if (mod.spec) this.specs.set(name, mod.spec);
      }
      catch (err) { this.errors.push(`[${name}] ${String((err as Error)?.stack ?? err)}`); console.error(`scene module ${name} failed`, err); }
    }));
    // 版面寫死的中文字先載字型：截圖／驗收（only）等全部載好再開始，同一格畫兩次才會一樣；
    // 現場播放不擋開機，背景慢慢載（第一次輪到那個版面前多半已經載好了）
    const glyphs = GLYPHS_SHARED + names.map((n) => GLYPHS[n] ?? '').join('');
    if (only) await loadText(glyphs, 30000, true);
    else void loadText(glyphs, 120000, true);
    this.post = new Post();
    this.hud = new Hud(this.live);
    this.overlay = new Overlay(this.live);
  }

  /** 換歌：前一首的場景全部釋放，時間軸清空（由導演重新排）。 */
  setSong(song: SongRuntime) {
    for (const rec of this.loaded.values()) rec.scene?.dispose();
    this.loaded.clear();
    this.timeline = [];
    this.song = song;
    this.lastT = -1;
    this.hud.setSong(song.info);
    this.overlay.clearSong();
  }

  get duration() { return this.song.audio.duration; }

  /** 加一個窗格（通常在它開始前幾秒），馬上在背景建場景。 */
  add(e: TimelineEntry) {
    this.timeline.push(e);
    this.timeline.sort((a, b) => a.start - b.start);
    this.load(e);
  }

  /** 提早結束某個窗格（例如它的留言被隱藏了），之後的窗格由導演補上。 */
  cut(id: string, end: number) {
    const e = this.timeline.find((x) => x.id === id);
    if (e && end < e.end) e.end = Math.max(e.start + 0.05, end);
  }

  /** 拿掉還沒開始的窗格（導演要重排時用）。 */
  drop(fromT: number) {
    for (const e of this.timeline.filter((x) => x.start >= fromT)) {
      this.loaded.get(e.id)?.scene?.dispose();
      this.loaded.delete(e.id);
    }
    this.timeline = this.timeline.filter((x) => x.start < fromT);
  }

  private load(e: TimelineEntry) {
    const rec: Loaded = { entry: e, scene: null, lastT: -1, ready: Promise.resolve() };
    this.loaded.set(e.id, rec);
    rec.ready = (async () => {
      try {
        const cls = this.classes.get(e.scene);
        if (!cls) throw new Error(`scene module not found: scenes/${e.scene}.ts`);
        const ctx: SceneCtx = {
          // 有主打留言的窗格不畫原文副行（韓文歌）：給它拿掉副行的歌詞，版面照常用 lyricSubOf 就會拿到 null
          renderer: this.renderer, audio: this.song.audio, lyrics: e.params?.message ? this.song.lyrics.withoutSub() : this.song.lyrics, comp: this.comp, W, H,
          id: e.id, params: e.params, start: e.start, end: e.end, song: this.song.info, live: this.live,
        };
        const s = new cls(ctx);
        await s.init();
        // 等待期間已經換歌或被拿掉了：直接丟
        if (this.loaded.get(e.id) !== rec) { s.dispose(); return; }
        rec.scene = s;
      } catch (err) {
        rec.error = String((err as Error)?.stack ?? err);
        this.errors.push(`[${e.id}] ${rec.error}`);
        console.error(`scene ${e.id} failed`, err);
      }
    })();
  }

  /** 等 t 時會用到的場景都建好（截圖、匯出用；即時播放不等）。 */
  async prepare(t: number) {
    await Promise.all(this.timeline.filter((e) => t >= e.start - 0.001 && t < e.end).map((e) => this.loaded.get(e.id)?.ready));
  }

  /** 釋放 t 之前已經播完的窗格。 */
  gc(t: number) {
    for (const e of this.timeline.filter((x) => x.end < t - 1)) {
      this.loaded.get(e.id)?.scene?.dispose();
      this.loaded.delete(e.id);
    }
    this.timeline = this.timeline.filter((x) => x.end >= t - 1);
  }

  private frameFor(e: TimelineEntry, t: number, dt: number, seeked: boolean, preroll: boolean, under: THREE.Texture | null, tin: number, tout: number): Frame {
    const au = this.song.audio;
    const beat = au.beatAt(t), bar = au.barAt(t);
    return {
      t, dt, lt: t - e.start, p: (t - e.start) / (e.end - e.start), start: e.start, end: e.end, seeked, preroll,
      beat, bar, beatPhase: beat - Math.floor(beat), barPhase: bar - Math.floor(bar),
      a: au.sample(t), under, tin, tout,
    };
  }

  /**
   * Render song time t. `dt` is the nominal frame step (1/fps). A non-sequential t counts as a
   * seek: stateful scenes are reset and fast-forwarded.
   * `samples` > 1（匯出用）：在 shutter × dt 內平均幾格，做真的動態模糊。即時播放一律 1。
   */
  render(t: number, dt = 1 / 60, toScreen = true, samples = 1, shutter = 0.5) {
    const r = this.renderer;
    const seeked = this.lastT < 0 || t < this.lastT - 1e-6 || t - this.lastT > Math.max(0.25, dt * 4);
    this.lastT = t;
    let outTex: THREE.Texture;
    let post: PostParams = { ...DEFAULT_POST };
    if (samples <= 1) {
      SS_TAP.value = -1;
      ({ outTex, post } = this.composite(t, dt, seeked));
    } else {
      const POST_U = 0.125;
      let nearest = Infinity;
      clearRT(r, this.sumRT, [0, 0, 0], 0);
      for (let k = 0; k < samples; k++) {
        const u = (k + 0.5) / samples - 0.5;
        SS_TAP.value = samples % 4 === 0 ? (k + (k >> 2)) % 4 : -1;
        const res = this.composite(Math.max(0, t + dt * shutter * u), dt / samples, seeked && k === 0);
        this.accum.u.src!.value = res.outTex;
        this.accum.render(r, this.sumRT);
        const d = Math.abs(u - POST_U);
        if (d < nearest) { nearest = d; post = res.post; }
      }
      SS_TAP.value = -1;
      this.comp.draw(r, this.sumRT.texture, this.avgRT, { mode: 'replace', opacity: 1 / samples, premult: false });
      outTex = this.avgRT.texture;
    }
    const hudTex = this.hud.draw(t, { opacity: this.hudOff ? 0 : post.hud, frame: post.frame, qr: post.qr, paper: post.paper, audio: this.song.audio });
    this.post.render(r, outTex, hudTex, this.finalRT, post, t);
    this.lastPost = post;
    if (toScreen) {
      this.blit.u.src!.value = this.finalRT.texture;
      this.blit.render(r, null);
    }
  }

  /**
   * Render and composite all scenes active at t into an HDR texture (no post). `dt` is the step handed to
   * scenes (the frame step, or the sub-frame spacing); `seeked` says time jumped before this call.
   */
  private composite(t: number, dt: number, seeked: boolean): { outTex: THREE.Texture; post: PostParams } {
    const r = this.renderer;
    // 還沒建好的窗格先不上（前一個窗格的最後一格會多撐一下，不會黑一格）
    let active = this.timeline.filter((e) => t >= e.start && t < e.end && this.loaded.get(e.id)?.scene);
    if (active.length === 0) {
      // 最近一個已經建好、剛結束的窗格撐著（場景 init 比預期慢時）
      const prev = this.timeline.filter((e) => e.start <= t && this.loaded.get(e.id)?.scene).pop();
      if (prev) active = [prev];
    }
    let post: PostParams = { ...DEFAULT_POST };
    let under: THREE.Texture | null = null;
    let outTex: THREE.Texture | null = null;
    let outRT: THREE.WebGLRenderTarget | null = null;

    active.forEach((e, idx) => {
      const rec = this.loaded.get(e.id)!;
      const rt = this.rts[idx % this.rts.length]!;
      const prev = active[idx - 1], next = active[idx + 1];
      const tin = prev ? Math.min(1, (t - e.start) / Math.max(1e-3, prev.end - e.start)) : 1;
      const tout = next ? Math.max(0, (t - next.start) / Math.max(1e-3, e.end - next.start)) : 0;
      const s = rec.scene!;
      // (sub-frames of one frame may step back within its shutter: not a seek)
      const sceneSeeked = seeked || rec.lastT < 0 || Math.abs(t - rec.lastT) > 0.25;
      if (s.stateful && sceneSeeked) {
        s.reset();
        const from = Math.max(e.start, t - s.prerollMax);
        const step = 1 / 60;
        let first = true;
        for (let pt = from; pt < t - step * 0.5; pt += step) {
          s.render(this.frameFor(e, pt, first ? 0 : step, first, true, null, 1, 0), rt);
          first = false;
        }
      }
      let ov: PostOverrides | void = undefined;
      try {
        ov = s.render(this.frameFor(e, Math.min(t, e.end - 1e-4), sceneSeeked ? 0 : dt, sceneSeeked && !s.stateful, false, idx > 0 ? under : null, tin, tout), rt);
      } catch (err) {
        if (!rec.error) { rec.error = String((err as Error)?.stack ?? err); this.errors.push(`[${e.id}] ${rec.error}`); console.error(`scene ${e.id} render error`, err); }
        clearRT(r, rt, this.debug ? [0.25, 0.0, 0.0] : LIN.ink);
      }
      rec.lastT = t;
      post = { ...post, ...(e.post ?? {}), ...(ov ?? {}) };
      if (idx > 0 && !s.handlesTransition && under) {
        // default: crossfade from the previous scene over the overlap
        this.xfade.u.a!.value = under;
        this.xfade.u.b!.value = rt.texture;
        this.xfade.u.k!.value = tin;
        this.xfade.render(r, this.mixRT);
        outTex = this.mixRT.texture; outRT = this.mixRT;
      } else { outTex = rt.texture; outRT = rt; }
      under = outTex;
    });

    if (!outTex || !outRT) { clearRT(r, this.rts[0]!, LIN.ink); outTex = this.rts[0]!.texture; outRT = this.rts[0]!; }
    // 即時留言小卡畫在場景上、後製之前（火花會發光、也吃得到顆粒與暗角）
    this.overlay.render(r, this.comp, t, outRT, { opacity: post.popups * (this.hudOff ? 0 : 1), paper: post.paper, audio: this.song.audio });
    return { outTex, post };
  }

  /** RGBA8 pixels of the last rendered frame (bottom-up rows), PW x PH. */
  readPixels(buf?: Uint8Array) {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    this.renderer.readRenderTargetPixels(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }
}
