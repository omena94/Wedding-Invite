# 大螢幕引擎說明（給寫版面的人）

大螢幕（`/wall`）照 [pdoom-video](../../../pdoom-video) 的做法寫（MIT，原作 Giacomo Magnanini；引擎檔頭都有註明）：TypeScript + three.js，
每一格畫面都是「歌曲時間 `t`」的純函數，1920×1080 邏輯像素，後製有 bloom、光暈、底片顆粒、暗角。
跟 pdoom 不一樣的地方：

- **時間軸是即時排的**。pdoom 一首固定的歌、人工剪接；大螢幕整晚播歌單，**導演**（`src/wall/director.ts`）邊播邊排下一個「窗格」
  （幾小節長、切在拍點上），挑版面、挑要主打的留言。每個窗格 new 一個場景物件、播完就 `dispose()`。
- **兩種文字**：歌詞（逐字跟唱，來自後台的 LRC）與賓客留言（隨時會進來）。每個版面兩種都要處理。
- **中文**。拉丁字照 pdoom 自帶 TTF；中文、韓文、簡體用 Google Fonts（依字分片下載）。
- **每首歌換配色主題**（`src/wall/themes.ts`）：訊號色一家子（signal / ember / blood）、點綴色、紙色會變。**不要把顏色寫死**，
  一律用色票（Canvas2D 的 `rgba('signal')`、GLSL 的 `C_SIGNAL`、LineBatch 的 `LIN.signal`）。
- 右下角 QR（`engine/hud.ts`）由引擎畫，版面不用管。**即時留言小卡已停用**（2026-09-28 新人要求留言要融在版面裡）：新留言由導演排成下一個窗格的主打，所以主打留言就是版面的焦點（見 TREATMENT.md「MV 融合原則」）。

## 怎麼跑、怎麼看

- 截圖（主要的檢查方式——截完**用 Read 工具打開 PNG 看**）：

  ```sh
  cd frontend
  WALL_DEV_AUDIO_DIR=<放測試 mp3 的資料夾> node scripts/wall-render.mjs stills --scene sparkler --message 3 --t 1.2,2,3.5,6 --win-from 0 --win-to 12 --out ../wall-out/sparkler
  ```

  - `--scene` 版面檔名；`--message N` 主打第 N 則假留言（`src/wall/dev/fixtures.ts`：3 = 長的、2 = 很短、5 = 英文、9 = 只有愛心、15 = 最長）；
    `--params '{"variant":2}'` 額外參數；`--theme gold|champagne|rose|sage|lilac|coral` 配色；`--win-from/--win-to` 窗格範圍（秒，預設整首）；
    `--popup 7@3.0` 在 3 秒排一張即時小卡；`--song "檔名.mp3"` 選測試歌；`--scale 0.75` 省電畫質。
  - 聯絡表：`sheet --scene slam --from 20 --to 32 --n 12 --cols 4 --out ../wall-out/slam.png`
  - 效能：`perf --scene stars --from 20`（平均每格毫秒，含 GPU 同步）。**目標 < 12 ms**（會場筆電多半是內顯，要留餘裕）。
  - **標準驗收 `qa`（每個版面交件前一定要跑、一定要打開圖看）**：
    `node scripts/wall-render.mjs qa --scene <名字>`（變化款：`--params '{"variant":1}'`，檔名自動加 `.v1`）。
    十種情境（長留言、短留言、英文、只有愛心、最長 60 字、沒有留言、純音樂、慢歌、只有 2 小節、新人留言）×
    3～6 個時間點拼成一張總表 `wall-out/qa/<名字>.jpg`，另外檢查確定性（同一時間點畫兩次要一模一樣）與效能。
    總表每格只有 320×180，細節（字有沒有爆框、有沒有被小卡蓋到、跟唱有沒有對上）要再用 `stills` 截全尺寸的看。
    需要標準測試音檔：`WALL_DEV_AUDIO_DIR` 指到放 `Test Band - Fast Pop.mp3`、`Test Band - Slow Ballad.mp3`（含 .lrc）的資料夾。
  - 指定 `--scene` 時只會載入那個版面（加上 `title`、`karaoke`），別人寫到一半的版面不會影響你；要載全部加 `--all-scenes`。
  - 很多人同時在跑截圖時，`perf` 的數字會偏高：超過 12 ms 先單獨再跑一次 `perf` 確認。
  - 導演排出來的時間軸：`timeline`。
  - 測試歌沒有 `.lrc` 時，會用自己編的佔位歌詞（`dummyLrc`，每兩小節一句）。
- 瀏覽器即時看：`npm run dev` 之後開 `http://localhost:5173/wall?dev=1`（要先設 `WALL_DEV_AUDIO_DIR` 再啟動 vite）。
  `D` 顯示除錯資訊、`←/→` 跳 5 秒、`N` 下一首、`&sim=1` 模擬現場新留言。
- 型別檢查：`npx tsc --noEmit -p src/wall`（只看自己的檔：`| grep scenes/你的版面`）。
- 截圖工具會印出 `SCENE ERRORS` 與瀏覽器錯誤——一定要看。

### 後台「大螢幕版面」頁（新增或拿掉版面後要做的事）

- `node scripts/wall-catalog.mjs`：從 `docs/wall/CATALOG.md` 重新產生 `src/wall/plateCatalog.ts`（中文名稱、系列、亮暗、點子；只列 scenes/ 裡有的檔）。
- `node scripts/wall-render.mjs thumbs`（或 `--names a,b` 只拍幾個）：重拍 `public/wall-thumbs/<名字>.jpg` 縮圖。版面改過樣子也要重拍。
- `/wall?plate=名字`：預覽模式，導演每個窗格都用這個版面，← → 換上一個／下一個（順序跟清單一樣）。
- 新人在後台關掉的版面存在設定 `wall_plates_off`、換版面節奏存在 `wall_pace`（fast／normal／slow），feed 會帶給大螢幕，導演照著排。

## 資料

- `ctx.lyrics`（`engine/lyrics.ts`）：`lines[]`，每行 `text, start, end, words[]`，每個字 `{w, start, end, o}`（`o` 是在行內的位置）。
  中文一個字一個 Word、英文一個單字一個 Word。**不要用內容找歌詞**（歌每首不一樣）：用時間找——
  `lyricAt(lyrics, t)`（`scenes/_motifs.ts`，回傳這一格該顯示的行與進出場係數）、`lyrics.lineAt(t)`、`lyrics.nextLine(t)`、`lyrics.linesIn(t0, t1)`、
  `Lyrics.wordProgress(word, t)`、`Lyrics.lineCharProgress(line, t)`。有些歌是純音樂（`lyrics.has === false`），版面要撐得住。
- `ctx.audio`（`engine/audio.ts`）：`beats[]`、`downbeats[]`、`sections[]`（多了 `energy` 0..1）、`beatAt(t)`、`barAt(t)`、`timeOfBeat(i)`、`timeOfBar(i)`、
  `beatPeriod(t)`、`nextBeat(t)`、`nextDownbeat(t)`、`energyAt(t)`、`env(name, t)`（`rms|low|mid|high|vocal|drums|bass|other`，0..1）、
  `hit(kind, t, halfLife)`（`kick|snare|hat|vocal`）。沒有分軌，vocal 之類是頻帶近似。`_motifs.ts` 有 `beatAfter(au, t, k)`、`barAfter(au, t, k)`。
- `f.a` = `{rms,low,mid,high,vocal,drums,bass,other,kick,snare,hat,vonset}`；`f.beat, f.bar, f.beatPhase, f.barPhase, f.lt, f.p`。
- `ctx.params`：`message`（這個窗格主打的留言 `Msg`，可能是 `null`）、`messages`（全部留言，祝福牆用）、`variant`、`seed`、`energy`（這段的能量）、
  其他版面自訂的。`Msg = {id, name, text, n, couple}`：`text` 已經清理過（愛心統一成 `♥`、其他 emoji 拿掉、空白收斂，最多 60 字），
  `name` 可能是空字串（署名用 `signature(name)` → 「—— 一位賓客」），`n` 是第幾則（印成 `No.042`）。
- `ctx.song`：`{title, artist, index, count, theme}`；`ctx.live`：`{count, url, shortUrl}`（留言總數、QR 指向的網址）。
- `ctx.start / ctx.end`：這個窗格的時間（秒）。窗格長度 2～16 小節不等，**版面要能在任何長度好看**：進場、主體、退場用
  `beatAfter(au, start)`、`ctx.end - beat` 之類算，不要假設固定秒數。

## 寫一個版面

一個檔 `src/wall/scenes/<名字>.ts`，預設匯出一個繼承 `Scene` 的類別（輔助檔命名 `<名字>-xxx.ts`，檔名含 `-` 的不會被當成版面）：

```ts
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';

// 很貴又不會變的（shader）放在模組層共用：一晚會 new 幾百個場景物件
const BG = () => new FSPass(`uniform float t; void main(){ fragColor = vec4(C_INK, 1.0); }`, { t: { value: 0 } });

export default class MyPlate extends Scene {
  bg = shared('myplate.bg', BG);
  text = this.track(new Layer2D());          // track()：窗格結束時自動 dispose
  msg: Msg | null = this.ctx.params.message ?? null;
  async init() { /* 預先排版：這個窗格的留言已經定了 */ }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    this.bg.u.t!.value = f.t;
    this.bg.render(renderer, out);              // 全螢幕 shader → out（覆蓋）
    const c = this.text.ctx; this.text.clear(); /* Canvas2D 畫字 */
    comp.draw(renderer, this.text.upload(), out); // 疊上去
    return { bloom: 0.7 };                       // 後製參數（可省略）
  }
}
```

**排程參數**寫在版面檔裡，導演會自己讀（不用改 `director.ts`）：

```ts
import type { PlateSpecDecl } from '../engine/scene';
export const spec: PlateSpecDecl = {
  energy: [0.4, 1],   // 適合的段落能量（副歌高、抒情段低）
  bars: [4, 8],       // 偏好的長度（小節）
  paper: true,        // 亮版面
  group: 'couple',    // couple = 手繪新人互動；type = 文字／圖像（預設）
  family: 'sport',    // 系列：同系列不會連著出現（見 CATALOG.md）
  variants: 2,        // 變化款數（params.variant）
  weight: 1,          // 相對機率
};
```

規則：

- **字的特效（模糊暈墨、挖字、濾鏡）在 `init()` 做一次成字模，之後只貼圖**：每次重畫都開新畫布、用 `filter` 重新光柵化同一個字，
  瀏覽器每次畫出來會差一點點（確定性偶發不過，也比較慢）。不要用 `document.fonts.check` 觸發重畫（它查的字族不一定會載到）。
  懷疑字型時間差時，可用 `scratchpad/detcheck.mjs <版面> <次數>`（環境變數 `FONT_DELAY=6000` 故意延遲字型）重現。
- fast 的 Layer2D 貼圖要在自己的 shader 裡取樣：`fastLayer(texture(tex, uv))`（`GLSL_COMMON` 內建，解預乘、轉線性）。
- GLSL 保留字不能當變數名：`active`、`patch`、`sample` 等；`GLSL_COMMON` 已經有 `heat()`、`hatch()`、`snoise()` 等函式，uniform 別取一樣的名字（會重複定義、shader 編不過）。
- `hatch(u, darkness)` 在 darkness = 0 時仍會留一條約五成覆蓋的細線（pdoom 原本的行為，很多版面照這個調過，不改）；要真正全白就乘 `smoothstep(0.0, 0.06, darkness)`。
- **3D 抗鋸齒一律用 `sharedMSAA()`**（`gl.ts`，整晚全引擎只有一張 4× MSAA）：不要自己 `makeRT(W, H, { samples: 4 })`，
  一張約 100 MB 顯示記憶體，每個版面各留一張會把會場筆電的內顯吃光。畫進去後同一個 `render()` 裡就要解析到 out，不要 track／dispose 它。
- 半透明的全螢幕層疊在畫好的畫面上：`new FSPass(frag, uniforms, { over: true })`（預乘 One／OneMinusSrcAlpha）。
- 有留言時歌詞的字級：`lyricSizeFor(留言字級)`（`_motifs.ts`，留言是焦點、歌詞小一級但 ≥ 48 px）。
- **畫面上任何字（標籤、符號如 ∩、全形括號）都要在 `init()` 先 `await loadText(...)`**：引擎只預載 scenes 檔裡寫死的中文，
  符號與組出來的字串沒載到，第一格會用備援字型，確定性就不過。
- 斜的、旋轉的 `fillText` 每格都要重新光柵化，很貴：會動的斜字先畫到 init 做好的圖層再旋轉貼上。
- 已知問題：`LineBatch` 3D 模式（`screen2D: false`）把 mesh.matrix 設成非單位矩陣時線畫不出來；先自己把座標投影到畫面、用 2D 模式畫。
- **有 mipmap 的貼圖在迴圈或分支裡取樣，一律用 `textureLod`**（自己算好 mip 層）：那裡的螢幕導數沒有定義，
  ANGLE／D3D11 在 GPU 很忙時偶爾會挑到不同的 mip 層，同一格畫兩次會差一點點（QA 的確定性檢查會偶發不過）。
- **確定性**：輸出只能是 `f.t`（和 `ctx.params`、種子亂數 `mulberry32(seed)`、`hash(...)`）的函數。不要用 `Math.random()`、`Date.now()`、`performance.now()`。
  逐格閃爍用 `frameIdx(t)`。
- `render()` 必須整張覆蓋 `out`（HalfFloat 線性 HDR）。顏色是 **linear**；> ~0.92 才會發光（婚禮版門檻比 pdoom 高，紙白的字與 QR 不發光）。
  要發光的東西（火花、燒紅的字）：LineBatch 顏色乘 2～6，或畫在另一個 Layer2D 用 `comp.draw(..., { mode: 'add', tint: [1.9,1.9,1.9] })` 疊上去。
- **資源要還**：`Layer2D`、`LineBatch`、`makeRT()` 一律 `this.track(...)`；自己建的 three.js 幾何／材質在 `dispose()` 釋放（記得呼叫 `super.dispose()`）。
  shader pass 用 `shared()`。自己寫 `ShaderMaterial` 並用了 `GLSL_COMMON` 的話，uniforms 要展開 `...THEME_UNIFORMS`（不然 C_* 是黑的）。
- 效能：每格 < 12 ms。**Canvas2D 層一律用 fast 上傳**：`new Layer2D(W, H, SCALE, { fast: true })`（發光層可以用低解析度 `new Layer2D(W, H, 0.5, { fast: true })`）。
  預設的上傳方式一張要十幾毫秒；fast 的層只能交給 `comp.draw`（它會自動解碼），自己的 shader 要取樣的話得自己解預乘、轉線性。
  一個版面最多 2～3 張 Canvas2D 層，排版在 `init()` 做；每格只重畫會變的部分（不變的底圖畫一次就好，不要每格 `clear()` 重畫整張）。
- 可以回傳的後製參數：`exposure, bloom, bloomThreshold, bloomKnee, bloomRadius, halation, ca, grain, vignette, hud, frame（裁切角標，只給片頭卡）,
  qr（角落 QR，自己畫了大 QR 才設 0）, popups（即時小卡透明度，滿版大字時可調低，別設 0）, **popupAvoid**（重要文字的範圍 `[x,y,w,h][]`，
  即時小卡挑位置時避開；回傳整個窗格會用到的範圍，render 的回傳型別標成 `PostOverrides`）, paper（亮版面設 1：HUD 與小卡改成深色字）,
  fade, flash, shake:[x,y], zoom, invert`。預設值在 `engine/post.ts`。
- **亮版面**（紙底）一定要回傳 `paper: 1`。
- 版面裡的字不要進右下角 HUD 區（`HUD_SAFE`：x ≥ 1360、y ≥ 830），離四邊至少 96 px（投影機會裁邊）。
  新祝福進來時，HUD 的留言數會演約 3 秒特效：數字滾動、放大發光、波紋、愛心往左上噴、「+1」浮起（`engine/hud.ts` 的 `bumpNumber`）。特效也在這一區裡，所以這一區要保持乾淨。
- 轉場：窗格相接就是硬切（大部分在小節線上），這是預設。要自己做轉場設 `handlesTransition = true` 並用 `f.under`／`f.tin`。
- 固定色（不跟主題換）：`fur`（博美橘毛）、`cream`（奶油色毛、白胸口）、`collar`（紅項圈）、`ball`（網球黃綠）、`denim`（牛仔褲）、
  `gingham`（孟庭的綠格紋）、`leash`（藍牽繩）。只給手繪角色與道具用，不發光。
- 手繪的新人與狗狗一律用 `scenes/_couple.ts`（見檔頭說明與 TREATMENT.md 的「角色」），不要自己另外畫一套人。
- 只改自己的檔（`scenes/<名字>.ts`、`scenes/<名字>-*.ts`；一批版面共用的輔助可以放 `scenes/_<批次代號>.ts`，例如 `_doc.ts`）。引擎、`_motifs.ts`、導演、其他版面：需要改就在回報裡寫清楚，由主導者改。

## 工具箱

跟 pdoom 一樣（詳見各檔註解）：

- `gl.ts`：`FSPass`、`Compositor`（`comp.draw(renderer, tex, target, {mode, opacity, tint, scale, offset})`）、`Layer2D`、`makeRT()`、`clearRT()`、`W/H/SCALE`。
- `glsl/common.ts`（`GLSL_COMMON`，FSPass 自動附上）：色票 `C_INK C_INK2 C_GRAPHITE C_ASH C_BONE C_SIGNAL C_EMBER C_BLOOD C_ROSE C_PAPER C_SEPIA`、
  `hash*`、`snoise`、`fbm`、`curl2`、2D/3D SDF、`smin`、`aaFill`、`aaStroke`、`pxLine`、**`hatch(u, darkness)`、`engrave(uv, darkness, freq, angle)`**（版畫線條）、`heat(x)`、`FRAG_PX`（邏輯像素座標，**y 向上**）。
- `lines.ts`：`LineBatch`（GPU 細線，2D 像素座標 y 向下，或 3D）。
- `type.ts`：字族 `F.archivo(寬 62–125, 字重)`、`F.serif(字重, 斜體)`（Cormorant）、`F.mono(字重)`（IBM Plex Mono）、
  **`F.hei(字重)` 思源黑體、`F.ming(字重)` 思源宋體、`F.hand(字重)` 霞鶩文楷**。`font(family, px)` 會帶字重與 CJK 備援，
  拉丁字族後面自動接思源黑體／宋體，所以 `F.archivo` 也能直接畫中文歌詞。`layout()`、`glyphX()`、`measure()`、`fitSize()`、`textPoints()`（光柵取樣，中文可用）。
  `textPath2D` 只支援拉丁字。**新出現的文字要先 `await loadText(text)`**（留言已經載好了；自己加的中文字串在 `init()` 載）。
- `text.ts`：`wrap(ctx, text, maxWidth)`（中文禁則、英文不拆字、平衡斷行）、`fitText(ctx, text, family, w, h, {min,max,lineHeight,maxLines})`、
  `phrases(text, maxLen)`（切成短詞組，一拍一組用）、`readSeconds(text)`。
- `stroke.ts`：單線筆畫字（拉丁字，給「寫出來」的英文用）：`strokeText`、`drawStrokeText`、`writtenLength`。
- `util.ts`：`clamp, lerp, remap, smoothstep, ease.*, prog(x,a,b,ease), keys(), springStep, pulse, mulberry32, hash, noise*, fbm*, frameIdx`。
- `qr.ts`：`drawQR(ctx, url, x, y, size, {reveal})`（淺底深點，暗版面也要墊紙色）。
- `motifs.ts` / `scenes/_motifs.ts`：火花 `sparkHead`、`sparkParticles`、`sparkHead2D`；愛心 `drawHeart`、`heartPoints`；
  **歌詞的聲音** `lyricAt`、`layoutLyric`、`drawLyric`；**留言的聲音** `layoutMessage`、`drawMessage`、`signature`、`msgChars`；
  `COUPLE_EN`、`COUPLE_ZH`、`DATE_DOTS`、`beatAfter`、`barAfter`。
- **`scenes/_couple.ts`（手繪的新人與狗狗，完整說明在檔頭）**：`drawPerson(c, 'alan'|'omena', pose, {x, y, h, dir, view, outfit, ink, t, reveal})`、
  `drawDog(c, 'penpen'|'qq', dogPose, {...})` 回傳關節的畫面座標（手、嘴、項圈…）接道具與牽繩；`h` 是場景尺度（宣文的身高），同一場景的角色傳同一個值。
  姿勢庫 `POSE`（側面）、`FRONT`（正面）、`DOG`，動作用 `beatSwing(t, 拍點)` 算進度，「那一下」（擊球、出手、接到）落在拍點；走路 `walk(f.beat / 2)` 一拍一步。
  `inkFor(paper)` 取線色（暗版面 bone、亮版面 sepia）；手繪原語 `inkLine／inkPath／inkShape／inkPoly／inkRect／inkEllipse／hatch`（boiling line）；
  道具 `racket／shuttle／tennisBall／pan／plate／champagne／bouquet／umbrella／leash／sign／bubble…`；`lyricOnPath` 讓歌詞沿著曲線跟唱；`paperBG()` 亮版面的紙。
  範例：`badminton`、`fetch`、`waltz`、`cooking`。

## 紙偶角色（`scenes/_puppet.ts`，2026-09-29 起人物版面一律用這套）

新人看了程式畫的角色覺得「太醜太不像」，看了本機 Codex 畫的寫實手繪插畫說「像很多」，所以人物改成**紙偶動畫**：
Codex 畫每個動作的關鍵姿勢（透明背景 PNG），程式負責在場景裡移動、彈跳、傾斜、照節拍換姿勢、影子、落地壓扁回彈。
`_couple.ts` 的道具、`fitNote／drawNote`、`lyricOnPath`、`arcAt` 照樣可以用，只是人和狗不要再用 `drawPerson／drawDog` 畫。
範例：`badminton`（暗，姿勢時間軸＋跳殺）、`fetch`（亮，跑步換影格、球在圖與程式之間接力）、`cooking`（亮，甩鍋、狗跳起來咬）、`waltz`（暗，雙人紙偶翻面轉身）。

**規則：照片永遠不能進影片**（新人的要求）。角色只能是畫的：Codex 照 `wall-out/codex-chars/` 的定案設定圖（新人看過）畫，
設定圖本身也是畫的；不要把新人給的生活照、或照片描出來的圖放進 `public/`、專案或畫面。

### 加新姿勢

1. 跑 Codex（本機的圖片生成）。提示詞照前幾批的 `PROMPT.md`（附上設定圖 faces／couple-daily／couple-wedding／dogs-side／dogs-front），一定要寫到：
   **真正透明的背景**（白衣服、白狗沒辦法去背）、不畫地板與影子、同一個角色同一個比例（人 1024×1536 腳底 y≈1490、狗 1024×1024 腳底 y≈960、
   兩人一起 1536×1536）、**側面一律朝右**、四肢與道具不要被畫布切到。檔名：宣文 `xw_*`、孟庭 `mt_*`、兩人一起 `cp_*`、芃芃 `pp_*`、QQ `qq_*`。
2. 打開每一張檢查（疊在深色與洋紅底上看最清楚）：背景真的透明、長相跟設定圖一樣、沒有被切掉。不合格的請 Codex 重畫，**不要用程式修圖**。
3. `cd frontend && node scripts/wall-sprites.mjs <資料夾>... --clean`：裁掉透明邊、縮到大螢幕用的大小（人站直 600 px、狗 260～280 px）、轉 webp 到
   `public/wall-sprites/`，更新 `src/wall/spriteManifest.ts`。四個角不透明的圖會被擋下來並列出。
   - 每個角色用自己的**基準姿勢**校正比例（`SERIES`：`xw_idle_front`、`mt_idle_front`、`pp_stand`、`qq_stand`、`cp_hug`、`cp_waltz_1`）；
     新的一組（例如別套衣服）要在 `SERIES` 加一行。校正值存在 manifest，之後只補幾張不用再跑基準姿勢。
   - 道具點（球拍面、手上的球、嘴、鍋心、盤子）在 `POINTS` 手動量（原圖的 px、半徑），版面用來接球的軌跡、蓋掉圖上的道具。
     錨點 x 自動取身體中心，不好的在 `ANCHOR` 手動給。
   - 打開 `wall-out/sprites-contact.png` 看：紅十字 = 腳底錨點、綠圈 = 道具點；下半部是同一個動作的疊圖，換圖時身體與腳不該亂跳。
   - 全部的圖加起來控制在 3～4 MB 以內（現在 49 張約 1.9 MB）。

### 用法

```ts
import { loadPuppets, drawPuppet, drawPick, drawCycle, puppetPoint, puppetShadow, puppetIn, puppetLight, jumpArc, hop, breathe, beatKick } from './_puppet';
fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
async init() {
  this.track(await loadPuppets(['xw_walk_1', 'xw_walk_2', 'qq_run_1', 'qq_run_2']));   // 共用快取，窗格結束自動還
  this.catchAt = puppetPoint('qq_jump', 'ball', 1390, 880 - 92, { h: SZ });            // 道具點 → 畫面座標（算軌跡端點）
}
render(f) {
  const c = this.fg.ctx; this.fg.clear();
  puppetShadow(c, 'xw', x, GROUND, { h: SZ, lift });                                   // 腳底的橢圓影子，離地越高越小越淡
  drawCycle(c, au, f.t, ['xw_walk_1', 'xw_walk_2'], 1, x, GROUND - hop(f.beat) * 8, { h: SZ }); // 一拍一步、換圖交叉淡化 2 格
  drawPick(c, [[-1e9, 'xw_bad_ready'], [hit, 'xw_bad_swing']], f.t, x, GROUND, { h: SZ, flip: true });
}
```

- `(x, y)` 是**腳底**（身體水平中心的地面點）；`h` 是場景尺度（宣文的身高 px），同一場景所有角色傳同一個值，孟庭、狗的比例自動換算（`PUPPET_H`），
  要誇張一點用 `scale`（`fetch`／`cooking` 的狗 1.2 倍）。`flip` 朝左、`rot`＋`pivot` 傾斜（0 = 繞腳底、0.5 = 繞身體中間）、
  `squash`（> 0 壓扁、< 0 拉長，腳底不動）、`alpha`、`spin`（紙偶翻面：0.25 圈變成一條線、0.5 圈翻過來，`waltz` 的轉身就是這樣做的）、
  `hide: ['ball']` 或 `['xw_throw_2:ball']` 蓋掉圖上畫好的道具（球由程式在飛的時候）。
- 換姿勢：`drawPick(時間軸)`／`drawCycle(照節拍)` 換圖時舊的一張疊在上面淡掉 1～2 格（`FADE`），新的一張先畫滿，人不會變透明。
  「那一下」放在拍點：擊球、出手、咬到的時間點就是換圖的時間點，軌跡的端點用 `puppetPoint` 從圖上的道具點算。
- 活起來：`breathe`（呼吸）、`hop`（走路跑步一步一彈）、`beatKick`（每拍一下）、`sway`、`jumpArc`（起跳前蹲、空中拉長、落地壓扁回彈；
  頂點在起跳與落地的正中間，要讓頂點落在拍點就把拍點放中間）、`landSquash`、`puppetIn`（進場：從側面翻正）。
- 暗版面：紙偶是亮的插畫，直接貼會像剪下來的照片、而且比留言還搶眼。紙偶畫完（同一層還沒畫別的）呼叫 `puppetLight(c, 範圍, 上, 下)`
  讓它上亮下暗、融進場景的光；亮版面通常不用。
- 留言（標準 v2）：`noteV2(c, 文字, 名字, 寬, 高)` 排字（字級 40～60、署名 26～32、照子句斷行），回傳 `_couple` 的 Note 給 `drawNote` 畫；
  `tightenNote(c, note, 最小寬)` 把寬縮到實際的字寬，牌子／卡片的寬高都跟著留言，不會掛一大塊空板子。
- 確定性：只看 `f.t`、節拍與種子；圖在 `init()` 載好才畫。只畫自己 `loadPuppets` 過的圖（別的版面載的圖隨時可能被釋放）。
- 效能：一格畫 3～5 張紙偶加一張 fast 的 Canvas2D 層，四個範例版面每格約 1～2 ms（`qa` 量的）。

## 參考

pdoom 原本的每個場景都在 `D:\Work\pdoom-video\app\src\scenes\`（`docs/TREATMENT.md` 有每個場景的說明，`app/public/plates/fig*.jpg` 是代表畫面）。
版畫線條、紙張、儀器、鈔票紋等做法可以直接參考、搬過來改。風格聖經在 `docs/wall/TREATMENT.md`。
