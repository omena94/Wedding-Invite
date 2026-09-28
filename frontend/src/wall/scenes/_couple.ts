// 手繪的新人與狗狗：角色工具組（批次 K）。所有 couple 版面（打球、跳舞、遛狗、約會、居家、婚禮…）都用這一套畫人和狗，
// 整晚的角色才會長得一樣。新人要求畫面裡**不能有照片**：這裡的樣子是從生活照「抓特徵」畫成的線稿（TREATMENT.md「角色」）。
// 範例版面：badminton（暗、揮拍對打）、fetch（亮、人丟球狗接）、waltz（暗、婚禮服、雙人舞）、cooking（亮、道具與食物）。
//
// ================================================================ 三十秒上手
//
//   import { drawPerson, drawDog, inkFor, POSE, DOG, beatSwing, racket, leash } from './_couple';
//   fg = this.track(new Layer2D(W, H, undefined, { fast: true }));   // 角色畫在一張 fast 的 Canvas2D 層（每格 clear）
//   // render()：
//   const c = this.fg.ctx; this.fg.clear();
//   const ink = inkFor(false);                   // 暗版面：線 = bone；亮版面 inkFor(true)：線 = sepia
//   const SZ = 420;                              // 場景尺度 = 宣文站直的身高（px）。同一個場景裡**所有角色傳同一個值**
//   const hit = au.timeOfBeat(12);               // 擊球落在第 12 拍（鼓點）
//   const a = drawPerson(c, 'alan', POSE.swing(beatSwing(t, hit)), { x: 420, y: 880, h: SZ, ink, t });
//   racket(c, a.handA, a.handAngA, { h: SZ, ink, t });        // 球拍接在回傳的手上
//   drawPerson(c, 'omena', POSE.walk(f.beat / 2), { x: 1200, y: 880, h: SZ, dir: -1, ink, t });
//   const q = drawDog(c, 'qq', DOG.trot(f.beat / 2), { x: 700, y: 880, h: SZ, ink, t });
//   leash(c, a.handB, q.collar, { ink, t, h: SZ });            // 牽繩：手 → 項圈
//   comp.draw(renderer, this.fg.upload(), out);
//
// ================================================================ 座標與單位
//
// - Canvas2D 邏輯像素，y 向下。`x, y` 是角色**站的地面點**（骨盆正下方的地面）：最低的接觸點（腳、跪著的膝蓋、坐地的屁股、躺著的背）
//   自動落在 y 上，跳起來用姿勢的 `lift`。`anchor: 'pelvis'` 改成 (x, y) = 骨盆位置（揹人：對方的 `back`；坐在椅子上：椅面）。
// - `h` = 場景尺度 = **宣文**站直的身高（px）。孟庭自動是 0.93 倍、芃芃 0.21 倍、QQ 0.2 倍（`HEIGHT`、`DOG_K`）。
//   參考：h 420 時宣文的頭約 63 px、狗約 85 px；遠處的桌子看得清楚的最小值約 h 300。
// - `dir`：1 = 面向右、-1 = 面向左（整個鏡像）。`view: 'side'`（預設，側面）或 `'front'`（正面：自拍、拍貼、走紅毯、合照）。
//   沒有背面：轉身用 `spin`（水平縮放、過 1/4 圈翻面，最窄 0.35 倍，不會縮成一條線）。
// - 所有角度用「度」。**側面**：從「直直往下」量起，+ = 往面向那一邊轉。手臂相對軀幹、腿相對垂直線、下一節相對上一節
//   （手肘 + = 前臂往前往上彎；膝蓋 − = 小腿往後彎；踝 + = 腳尖往下踮）。**正面**：+ = 往外張（手肘 + 繼續往外，− 往身體中線彎）。
// - 四肢 A／B：側面 A = 靠鏡頭的那隻（畫在身體前面）、B = 遠的那隻（畫在身體後面）；正面 A = 畫面左邊那隻（dir = 1 時）。
//   道具預設拿在 A 手（`POSE.swing` 的球拍、`POSE.throw` 的球、`POSE.panToss` 的鍋）。換手用 `mirrorPose(p)`。
// - 回傳 `Joints`（全部是畫面座標，含 dir／spin）：`handA/handB`（握點）、`handAngA/B`（手指方向，弧度，畫面的 atan2，給道具用）、
//   `top`（頭頂）、`head`、`mouth`、`neck`、`chest`、`back`（揹人時對方骨盆放這裡）、`pelvis`、`lap`（坐著的大腿上）、
//   `footA/B`、`toeA/B`、`kneeA/B`、`elbowA/B`、`shoulderA/B`、`bbox`、`facing`、`pen`（描線進場的筆尖，給仙女棒；沒在描線是 null）。
//   狗回傳 `nose`、`mouth`（叼球的位置）、`head`、`top`、`collar`（牽繩接這裡）、`back`（背上，放派對帽）、`tail`、`paws`、`bbox`、`pen`。
// - **先算不畫**：`reveal: 0` 只回傳關節、不畫。在 init() 用它算好「擊球那一格的拍面在哪」「狗跳最高時嘴在哪」，
//   球的軌跡端點就對得準（badminton、fetch、cooking 都這樣做）。
//
// ================================================================ 畫風（照 TREATMENT.md）
//
// - 雜誌插畫式的單線：線寬約 2.5～4 px（依 h 自動），兩端收尖像筆壓；**boiling line**：每 1/8 秒（種子 floor(t*8)）整張重抖一次，確定性。
// - 皮膚是固定的淡暖膚色 `SKIN()`（cream 往 fur 混兩成，暗、亮版面都一樣；**暗版面也不能把臉填成底色**，會變成黑色剪影），
//   五官、白紗上的線用深墨 `ink.feat`。衣服與道具的底是 `ink.fill`（亮版面 = 紙、暗版面 = 比底色亮一點的 ink2），遮住後面的線。
//   固定色平塗：牛仔褲 `denim`、格紋 `gingham`、狗毛 `fur`／`cream`、項圈 `collar`、網球 `ball`、牽繩 `leash`。黑髮與深色西裝是 `ink.dark`
//   （亮版面 = 墨色平塗；暗版面 = 底色留 bone 輪廓，一樣讀成深色）；白紗是象牙白 `ink.light`。背景不是純色時可以覆寫：`inkFor(false, { fill: rgba('ink2') })`。
// - 訊號色不在角色身上用：留給版面的互動重點（球的軌跡、揮拍的弧線、擊球的閃光）。愛心用點綴色（`heartPop`）。
// - 表情只有幾筆：`face: 'smile' | 'grin' | 'o' | 'calm' | 'closed'`（宣文 smile／grin 是瞇眼笑）。可用 opts.face 覆寫。
// - 宣文：短黑髮（前面一撮）、圓臉、條紋 T 恤＋斜背小包（`bag`，日常預設有）、牛仔褲，墨鏡 `shades`；婚禮：深色西裝、領結。
//   孟庭：及肩黑髮＋薄瀏海、綠格紋上衣、牛仔褲；婚禮：白紗＋頭紗（`flow` 讓頭髮、頭紗、裙擺往身後飄，`flare` 讓裙擺張開）。
//
// ================================================================ API 一覽
//
// 角色
//   drawPerson(c, 'alan' | 'omena', pose, PersonOpts) → Joints
//     PersonOpts：x, y, h（必填）；dir, view, outfit（'daily' | 'wedding'）, ink, t, reveal（0..1 描線進場：頭 → 身體 → 手 → 腳）, alpha,
//                 spin（圈數）, flow（-1..1）, flare（0..1）, shades, bag, anchor（'ground' | 'pelvis'）, face, lw（線寬覆寫）,
//                 hide（['armA'|'armB'] 不畫被別人擋住的手）, only（'armA'|'armB' 只補畫這隻手，疊在別人身體前面）
//   drawHug(c, {x, y, h, ink, t, outfit, gap}) → {alan, omena}：兩個人面對面環抱（遠的手繞到對方背後、近的手疊在對方身體前面）
//   drawDog(c, 'penpen' | 'qq', dogPose, DogOpts) → DogJoints
//     DogOpts：x, y, h（同一個場景尺度！）, dir, view（'side' | 'front'，正面適合坐著）, ink, t, reveal, alpha, spin,
//              wag（尾巴 -1..1；不給就依 t 自己搖）, ball（嘴裡叼網球）, lw
//   畫的順序就是前後：後面的人先畫。兩人互動時靠近鏡頭的那個最後畫（waltz 依轉到的深度決定先後）。
// 姿勢（純資料，可以內插、可以自己改欄位：`pose({ armA: [150, 20] })` 從站姿改，或 `{ ...POSE.cheer(), head: -20 }`）
//   Pose = { rot, lean, chest, head, armA/armB: [肩, 肘, 腕], legA/legB: [髖, 膝, 踝], lift, handA/handB, face, reachA/reachB }
//     hand：'rest' | 'open' | 'flat' | 'fist' | 'grip'（握東西）| 'point' | 'peace'；reach 0.3..1：手臂透視縮短（抱、繞過對方的背）。
//   POSE（側面）：stand, walk(φ), run(φ), jump(p, 高度), crouch, sit（椅子）, sitFloor, kneel, lie, lieSide,
//                 swing(p, 'overhead' | 'forehand'), throw(p), toss(p), catch(p), shoot(p), kick(p), wave(φ), point, pointUp, cheer,
//                 hug, hugBack（兩人抱請用 drawHug）, holdHand, carry（揹人）, ride（被揹）, waltzLead, waltzFollow, waltzStep(φ, 握姿), twirlLead, twirl,
//                 dipLead, dipFollow, disco(φ), hold('cup' | 'mic' | 'pan' | 'plate' | 'phone'), panToss(p), offer, clap(p), bow, lookUp
//   FRONT（正面）：stand, wave(φ), cheer, peace（比 YA）, hips, clap(p), point, armAround, holdHands, selfie, jump(p), shrug, heart
//   DOG：stand, trot(φ), run(φ), sit, jump(p, 高度), lie, sleep, beg（站起來討）, shake(φ)（甩水）, play（前趴）, howl
//   pose()、dogPose()、lerpPose(a, b, k)、lerpDog(a, b, k)、mirrorPose(p)、keyPose(p, [[p0, pose0], [p1, pose1], …])（關鍵格之間 inOutCubic）
//   - φ 是循環相位（0..1 一圈）。走路 φ = 0 與 0.5 是兩腳的腳跟著地：`walk(f.beat / 2)` 一拍一步、腳跟正好踩在拍點。
//     角色要移動的話 x 照 `STRIDE.walk * h`（人走一圈）、`DOG_STRIDE.run * h`（狗跑一圈）的速度走，腳才不會滑。
//   - p 是一個動作的進度（-1..1）：-1 預備、**0 = 擊球／出手／踢到／接到／起跳最高點**、1 收回。用 `beatSwing(t, 拍點時間, 預備秒數, 收回秒數)`
//     算 p，那一下就落在拍點上（預備慢慢拉、擊球那一下最快、收回減速）。-1 與 1 都接近站姿，可以一拍接一拍串起來。
// 節拍與軌跡
//   beatSwing(t, hit, pre, post)、stepPhase(beat)（= beat / 2）、arcAt(a, b, 高, u) → {x, y, ang}（a → b 的拋物線，頂點比較高的那端再高「高」px）、
//   arcPts(a, b, 高, n)（給 lyricOnPath、軌跡線）
// 背景
//   paperBG()：亮版面的紙（shader，整張覆蓋）：`paperBG().render(renderer, out)`，記得回傳 `paper: 1`。
// 手繪原語（畫自己的道具與佈景；都支援 ink／t／reveal，線會跟角色一起抖）
//   inkLine(c, pts, o)（折線）、inkPath(c, pts, o)（通過每個點的平滑曲線，o.closed 閉合）、inkShape(c, pts, o)（平滑的閉合形狀：填色＋描邊）、
//   inkPoly(c, pts, o)（直線邊的閉合多邊形）、inkRect(c, x, y, w, h, {r})（家具、卡片）、inkCircle、inkEllipse(c, x, y, rx, ry, rot, o)、
//   hatch(c, poly, {angle, gap})（排線陰影）、smoothPts(pts, closed)
//   o = { ink, t, w（線寬倍數）, lw（基準線寬 px，預設 3.2）, color, fill, reveal（0..1）, seed, alpha, taper（0..1 筆壓收尖）, jitter（抖動 px） }
//   回傳筆尖（reveal < 1 時），可以接仙女棒的火花。不會動的佈景畫在另一張層、只畫一次（不傳 t，就不抖）。
// 道具（grip = 握點、ang = 手的方向，直接用 Joints 的 handA／handAngA；大小跟著 o.h）
//   racket(c, grip, ang, {kind:'badminton'|'tennis'}) → 拍面中心；racketHead(grip, ang, o)（只算不畫）；shuttle(c, x, y, 飛行方向)；
//   tennisBall(c, x, y, r)；frisbee(c, x, y, r, ang, tilt)；umbrella(c, grip, ang, open)；bouquet；champagne(c, grip, ang, fill)；
//   pan(c, grip, ang, {food}) → 鍋心；mic；cup；plate(c, x, y, {food})；phone；balloon(c, x, y, r, 繩尾)；leash(c, 手, 項圈, {slack})；
//   sign(c, x, y, w, h, {ground}) → 木牌的文字框；bubble(c, x, y, w, h, 尾巴) → 對話框的文字框；heartPop(c, x, y, size, k)
// 物件上的主打留言（木牌、便條、記分板、畫架卡…）
//   fitNote(c, text, name, w, h, {min, max}) → Note：**字級依「可用高度扣掉署名那一列」算**，短的留言一行放完；note.height 含署名（用它決定物件多大、垂直置中）。
//   drawNote(c, note, x, y, {chars, color, sigColor, sigK})：畫出來（逐字出現、署名淡入），署名永遠在最後一行下面、不重疊。
// 歌詞
//   lyricOnPath(c, line, t, pts, style) → { head, box }：一行歌詞沿著曲線排（拋物線、地板上的圓弧、螺旋…），照跟唱規則逐字亮；
//     太長先縮字（不小於 minSize，預設 48），再不行在字之間折成兩排（第二排沿法線往下）。曲線請由左往右，字才是正的。
//     style = { family, size, minSize, at, align, offset（離曲線的距離，+ = 上方）, active, sung, unsung, alpha }；
//     亮版面要傳墨色：`{ unsung: rgba('sepia', 0.28), sung: rgba('sepia', 0.94), active: rgba('signal') }`。
//
// ================================================================ 效能與注意
// - 一個人或一隻狗每格約 0.3～0.5 ms（CPU＋GPU），兩個人＋兩隻狗約 2 ms。一定要畫在 fast 的 Layer2D；不會動的佈景另一張層、畫一次。
// - 描線進場（reveal < 1）第一次會先量一次線長（快取），之後一樣快。
// - 會改 ctx 的 fillStyle／font；會乘上呼叫前的 globalAlpha（版面可以用 c.globalAlpha 讓角色整個淡入淡出）。
// - **不要畫斜的字**（ctx.rotate 之後 fillText）：瀏覽器每格都要重新光柵化，一大段留言就要好幾毫秒。lyricOnPath 的字是一個一個轉的，只用在一行歌詞。
import { rgba } from '../engine/palette';
import { clamp, lerp, ease, TAU } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { font, F } from '../engine/type';
import type { FitResult } from '../engine/text';
import { layoutMessage, drawMessage, signature } from './_motifs';
import { FSPass } from '../engine/gl';
import { shared } from '../engine/scene';

export type Pt = { x: number; y: number };
type Ctx = CanvasRenderingContext2D;
const D = Math.PI / 180;
const PI = Math.PI;

// ================================================================ 小工具
/** 從「直直往下」量起、+ 往前（x+）的角度 → 單位向量。 */
const vv = (a: number): Pt => ({ x: Math.sin(a), y: Math.cos(a) });
const at = (p: Pt, d: Pt, k: number): Pt => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const at2 = (p: Pt, d1: Pt, k1: number, d2: Pt, k2: number): Pt => ({ x: p.x + d1.x * k1 + d2.x * k2, y: p.y + d1.y * k1 + d2.y * k2 });
const mixP = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const unit = (a: Pt, b: Pt): Pt => { const l = dist(a, b) || 1e-6; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
/** 「上」向量轉 90° 得到「前」（上 = (0,-1) → 前 = (1,0)）。 */
const fwd = (u: Pt): Pt => ({ x: -u.y, y: u.x });
/** 在一個局部座標系裡取點：原點 o、x 軸 ax、y 軸 ay，單位 s。 */
const loc = (o: Pt, ax: Pt, ay: Pt, s: number, x: number, y: number): Pt => ({ x: o.x + (ax.x * x + ay.x * y) * s, y: o.y + (ax.y * x + ay.y * y) * s });
const mapPts = (o: Pt, ax: Pt, ay: Pt, s: number, arr: readonly (readonly [number, number])[]) => arr.map(([x, y]) => loc(o, ax, ay, s, x, y));
/** 迴圈版的高斯凸起（相位用）：q 離 c 多近（循環距離），寬 w。 */
const bump = (q: number, c: number, w: number) => { const d = ((q - c + 0.5) % 1 + 1) % 1 - 0.5; return Math.exp(-(d / w) * (d / w)); };
const frac = (x: number) => x - Math.floor(x);

/** 整數雜湊 → [0,1)：boiling 的抖動用（比 util.hash 便宜，每格要算幾百次）。 */
function hh(a: number, b: number, c: number): number {
  let x = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x1b873593);
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Catmull-Rom：通過每個點的平滑曲線（每段取 seg 個點）。手繪的頭髮、裙擺、道具都用它。 */
export function smoothPts(pts: readonly Pt[], closed = false, seg = 4): Pt[] {
  const n = pts.length;
  if (n < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out: Pt[] = [];
  const get = (i: number) => (closed ? pts[((i % n) + n) % n]! : pts[Math.max(0, Math.min(n - 1, i))]!);
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let k = 0; k < seg; k++) {
      const u = k / seg, u2 = u * u, u3 = u2 * u;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
      });
    }
  }
  const last = closed ? out[0]! : pts[n - 1]!;
  out.push({ x: last.x, y: last.y });
  return out;
}

// ================================================================ 墨色
/**
 * 一個版面的「墨」：
 *  - line：外輪廓與線（暗版面 bone、亮版面 sepia）；feat：畫在淺色平塗上面的線（五官、白紗的皺褶），兩種版面都是深的墨色。
 *  - skin：皮膚（固定的淡暖膚色，暗、亮版面都一樣，不跟主題換）；fill：衣服、道具的底（遮住後面的線）。
 *  - dark：黑髮、深色西裝；light：白紗（象牙白）；soft：淡線；faint：淺色平塗上的淡線；ground：版面的底色。
 */
export interface Ink {
  paper: boolean;
  line: string;
  feat: string;
  ground: string;
  skin: string;
  fill: string;
  dark: string;
  light: string;
  soft: string;
  faint: string;
}

/**
 * 皮膚色：從固定色 cream（奶油色）往 fur（橘）混兩成，淡、暖、飽和度低。跟狗毛、牛仔褲一樣是固定色，換主題不會變，
 * 暗版面也不能用底色填臉（會變成黑色剪影，像扮黑臉）。
 */
export const SKIN = () => mixHex('cream', 'fur', 0.2);

/**
 * 暗版面（paper = false）：輪廓線 bone、底 ink；亮版面：線 sepia、底 paper。皮膚兩種版面都是固定的暖膚色，五官用深墨。
 * 深色（黑髮、西裝）在暗版面是底色、留 bone 輪廓（一樣讀成黑）；白紗是象牙白。
 * 每格呼叫（換歌會換主題色，這裡讀的是當下的色票）。背景不是純色時可以覆寫（例如聚光燈裡 `{ fill: rgba('ink2') }`）。
 */
export function inkFor(paper: boolean, o: Partial<Ink> = {}): Ink {
  const skin = SKIN(), feat = rgba('sepia', 0.9), faint = rgba('sepia', 0.3);
  return paper
    ? { paper, line: rgba('sepia', 0.94), feat, ground: rgba('paper'), skin, fill: rgba('paper'), dark: rgba('sepia', 0.92), light: rgba('bone'), soft: rgba('sepia', 0.42), faint, ...o }
    : { paper, line: rgba('bone', 0.94), feat, ground: rgba('ink'), skin, fill: mixHex('ink2', 'bone', 0.05), dark: rgba('ink'), light: mixHex('bone', 'cream', 0.3), soft: rgba('bone', 0.38), faint, ...o };
}

function mixHex(a: string, b: string, k: number, alpha = 1) {
  const pa = rgba(a).match(/\d+/g)!.map(Number), pb = rgba(b).match(/\d+/g)!.map(Number);
  return `rgba(${[0, 1, 2].map((i) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * k)).join(',')},${alpha})`;
}

// ================================================================ 筆（boiling line、筆壓、描線進場）
const QX = new Float64Array(4096), QY = new Float64Array(4096), QA = new Float64Array(4096), TX = new Float64Array(4096), TY = new Float64Array(4096);

/**
 * 所有線都經過這支「筆」：
 *  - 線畫成兩端收尖的色帶（像筆壓），同一個部位的線合成一個 path 一次填（省 draw call）；
 *  - boiling：每條線兩端與中段各有一個隨機位移（種子 = floor(t*8) 與線的編號），整條線平滑地歪一點點；
 *  - 描線進場：部位有「描的順序」（rank），reveal 決定畫到第幾個部位的哪裡，沒畫到的線截掉、填色跟著淡入；
 *    線長第一次用「只量不畫」的模式量好快取（meas）。
 */
class Pen {
  c: Ctx | null = null;
  ink: Ink = null!;
  seed = 0;
  lw = 3;
  jit = 1;
  alpha = 1;
  rv = Infinity;
  offs: number[] = [];
  lens: number[] = [];
  meas: number[] | null = null;
  rank = 0;
  budget = Infinity;
  used = 0;
  pen: Pt | null = null;
  sid = 0;
  pend: string | null = null;
  // 局部 → 畫面（只給 pen 用；畫的時候用 canvas 的 transform）
  ox = 0; oy = 0; sx = 1;
  ga0 = 1;

  /** 畫完：送出還沒填的線、還原呼叫端的透明度。 */
  end() { this.flush(); if (this.c) this.c.globalAlpha = this.ga0; }

  begin(c: Ctx | null, ink: Ink, seed: number, lw: number, jit: number, alpha = 1) {
    this.c = c; this.ink = ink; this.seed = seed; this.lw = lw; this.jit = jit; this.alpha = alpha;
    this.rv = Infinity; this.meas = null; this.rank = 0; this.budget = Infinity; this.used = 0; this.pen = null; this.sid = 0; this.pend = null;
    this.ox = 0; this.oy = 0; this.sx = 1;
    // 乘上呼叫端原本的透明度（版面可以用 c.globalAlpha 讓整個角色淡入淡出），畫完再還原
    this.ga0 = c ? c.globalAlpha : 1;
    this.alpha = alpha * this.ga0;
    if (c) c.globalAlpha = this.alpha;
  }

  /** 換一個部位（rank 決定描線進場的順序）。 */
  part(rank: number) {
    this.flush();
    this.rank = rank;
    this.used = 0;
    this.sid = rank * 1000;
    this.budget = this.meas || this.rv === Infinity ? Infinity : this.rv - (this.offs[rank] ?? 0);
  }

  /** 這個部位的填色要多不透明（描線進場時跟著線淡入）。 */
  k() {
    if (this.meas || this.rv === Infinity) return 1;
    const L = this.lens[this.rank] || 1;
    const k = clamp(this.budget / L);
    return k * k;
  }

  flush() {
    if (this.pend && this.c) { this.c.fillStyle = this.pend; this.c.fill(); }
    this.pend = null;
  }

  fill(poly: readonly Pt[], color: string, a = 1) {
    if (this.meas || !this.c || poly.length < 3) return;
    const k = this.k() * a;
    if (k <= 0.004) return;
    this.flush();
    const c = this.c;
    c.globalAlpha = this.alpha * k;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(poly[0]!.x, poly[0]!.y);
    for (let i = 1; i < poly.length; i++) c.lineTo(poly[i]!.x, poly[i]!.y);
    c.closePath();
    c.fill();
    c.globalAlpha = this.alpha;
  }

  /** 在 poly 裡面畫圖案（條紋、格紋、排線）：fn 直接拿 ctx 畫，已經裁切好。 */
  clip(poly: readonly Pt[], fn: (c: Ctx) => void, a = 1) {
    if (this.meas || !this.c || poly.length < 3) return;
    const k = this.k() * a;
    if (k <= 0.004) return;
    this.flush();
    const c = this.c;
    c.save();
    c.beginPath();
    c.moveTo(poly[0]!.x, poly[0]!.y);
    for (let i = 1; i < poly.length; i++) c.lineTo(poly[i]!.x, poly[i]!.y);
    c.closePath();
    c.clip();
    c.globalAlpha = this.alpha * k;
    fn(c);
    c.restore();
  }

  /** 一個點（眼睛、鼻頭）：實心圓，大小跟著線寬。 */
  dot(p: Pt, r: number, color?: string) {
    if (this.meas) { this.meas[this.rank]! += r * 2; return; }
    if (!this.c) return;
    if (this.budget !== Infinity) { const b = this.budget - this.used; this.used += r * 2; if (b <= 0) return; }
    const col = color ?? this.ink.line;
    if (this.pend !== col) { this.flush(); this.c.beginPath(); this.pend = col; }
    this.c.moveTo(p.x + r, p.y);
    this.c.arc(p.x, p.y, r, 0, TAU);
  }

  /**
   * 一條線（折線，點夠密就是曲線）。w = 線寬倍數；taper 0..1 兩端收尖的程度；closed 閉合（起點稍微重疊，像手畫的圈）。
   */
  line(pts: readonly Pt[], w = 1, color?: string, taper = 0.55, closed = false) {
    let n = Math.min(pts.length, 4090);
    if (n < 2) return;
    const id = ++this.sid;
    let L = 0;
    QA[0] = 0;
    for (let i = 1; i < n; i++) { L += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y); QA[i] = L; }
    if (this.meas) { this.meas[this.rank]! += L; return; }
    const c = this.c;
    if (!c || L < 0.01) return;
    let lim = L;
    if (this.budget !== Infinity) {
      const b = this.budget - this.used;
      this.used += L;
      if (b <= 0) return;
      if (b < L) lim = b;
    }
    // 截到 lim 為止（描線進場）
    let m = 0;
    for (let i = 0; i < n; i++) {
      const a = QA[i]!;
      if (a > lim) {
        const a0 = QA[i - 1]!, k = (lim - a0) / Math.max(1e-6, a - a0);
        QX[m] = pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * k; QY[m] = pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * k; QA[m] = lim; m++;
        break;
      }
      QX[m] = pts[i]!.x; QY[m] = pts[i]!.y; QA[m] = a; m++;
    }
    n = m;
    if (n < 2) return;
    // boiling：兩端與中段的位移（閉合的線兩端要一樣，才接得起來）
    const j = this.jit, s = this.seed;
    const ax = (hh(s, id, 1) - 0.5) * 2 * j, ay = (hh(s, id, 2) - 0.5) * 2 * j;
    const bx = closed ? ax : (hh(s, id, 3) - 0.5) * 2 * j, by = closed ? ay : (hh(s, id, 4) - 0.5) * 2 * j;
    const cx = (hh(s, id, 5) - 0.5) * 2.4 * j, cy = (hh(s, id, 6) - 0.5) * 2.4 * j;
    const hw0 = 0.5 * w * this.lw * (0.88 + 0.24 * hh(s, id, 7));
    for (let i = 0; i < n; i++) {
      const u = QA[i]! / L, sn = Math.sin(PI * u);
      QX[i] = QX[i]! + ax * (1 - u) + bx * u + cx * sn;
      QY[i] = QY[i]! + ay * (1 - u) + by * u + cy * sn;
    }
    const col = color ?? this.ink.line;
    if (this.pend !== col) { this.flush(); c.beginPath(); this.pend = col; }
    const tp = closed ? 0.25 : taper;
    // 每個點的法線（前後兩點的方向）與半寬（兩端收尖）先算好，左右兩邊共用
    for (let i = 0; i < n; i++) {
      const i0 = i > 0 ? i - 1 : 0, i1 = i < n - 1 ? i + 1 : n - 1;
      let tx = QX[i1]! - QX[i0]!, ty = QY[i1]! - QY[i0]!;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      const wi = hw0 * (1 - tp * (1 - Math.sin(PI * (QA[i]! / L))));
      TX[i] = tx * wi; TY[i] = ty * wi;
    }
    // 左邊往前、右邊往回，兩端各加一個尖點
    c.moveTo(QX[0]! - TX[0]! * 0.9, QY[0]! - TY[0]! * 0.9);
    for (let i = 0; i < n; i++) c.lineTo(QX[i]! - TY[i]!, QY[i]! + TX[i]!);
    c.lineTo(QX[n - 1]! + TX[n - 1]! * 0.9, QY[n - 1]! + TY[n - 1]! * 0.9);
    for (let i = n - 1; i >= 0; i--) c.lineTo(QX[i]! + TY[i]!, QY[i]! - TX[i]!);
    c.closePath();
    if (lim < L) this.pen = { x: this.ox + this.sx * QX[n - 1]!, y: this.oy + QY[n - 1]! };
  }

  /** 平滑曲線（Catmull-Rom 取點再畫）。 */
  curve(pts: readonly Pt[], w = 1, color?: string, closed = false, taper = 0.55) {
    this.line(smoothPts(pts, closed, 4), w, color, taper, closed);
  }
}

const PEN = new Pen();

// ================================================================ 手繪原語（給版面畫道具）
export interface InkOpts {
  ink?: Ink;
  /** 歌曲時間：線條抖動（每 1/8 秒換一次）。 */
  t?: number;
  /** 線寬倍數（1 = 角色的輪廓線）。 */
  w?: number;
  /** 基準線寬（px），預設 3.2。 */
  lw?: number;
  color?: string;
  fill?: string;
  /** 0..1：這筆畫到哪裡（描線進場）。 */
  reveal?: number;
  seed?: number;
  alpha?: number;
  taper?: number;
  closed?: boolean;
  /** 抖動幅度（px），預設 1。 */
  jitter?: number;
}

function penFor(c: Ctx, o: InkOpts, seed = 0) {
  PEN.begin(c, o.ink ?? inkFor(false), (Math.floor((o.t ?? 0) * 8) * 7919 + (o.seed ?? seed)) | 0, o.lw ?? 3.2, o.jitter ?? 1, o.alpha ?? 1);
  return PEN;
}

/** 把 pts 截到 reveal 的比例（描線進場）。回傳截好的點與筆尖。 */
function cut(pts: Pt[], r: number | undefined): { pts: Pt[]; tip: Pt | null } {
  if (r === undefined || r >= 1) return { pts, tip: null };
  if (r <= 0) return { pts: [], tip: null };
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1]!, pts[i]!);
  let acc = 0;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1]!, pts[i]!);
    if (acc + d >= L * r) {
      const tip = mixP(pts[i - 1]!, pts[i]!, (L * r - acc) / Math.max(1e-6, d));
      out.push(tip);
      return { pts: out, tip };
    }
    acc += d;
    out.push(pts[i]!);
  }
  return { pts: out, tip: null };
}

/** 手繪折線。回傳筆尖（reveal < 1 時），給仙女棒的火花接。 */
export function inkLine(c: Ctx, pts: readonly Pt[], o: InkOpts = {}): Pt | null {
  const p = penFor(c, o, 11);
  const { pts: q, tip } = cut(pts.slice(), o.reveal);
  p.line(q, o.w ?? 1, o.color, o.taper ?? 0.55, !!o.closed && (o.reveal ?? 1) >= 1);
  p.end();
  return tip;
}

/** 手繪平滑曲線（通過每個點）。 */
export function inkPath(c: Ctx, pts: readonly Pt[], o: InkOpts = {}): Pt | null {
  return inkLine(c, smoothPts(pts, !!o.closed, 5), o);
}

/** 閉合的平滑形狀：先填色（o.fill）再描邊。 */
export function inkShape(c: Ctx, pts: readonly Pt[], o: InkOpts = {}): Pt | null {
  const sm = smoothPts(pts, true, 4);
  const p = penFor(c, o, 13);
  if (o.fill && (o.reveal ?? 1) > 0) p.fill(sm, o.fill, clamp((o.reveal ?? 1) * 1.5 - 0.5));
  const { pts: q, tip } = cut(sm, o.reveal);
  p.line(q, o.w ?? 1, o.color, o.taper ?? 0.3, (o.reveal ?? 1) >= 1);
  p.end();
  return tip;
}

/** 閉合的多邊形（直線邊，不修圓）：先填色（o.fill）再描邊。家具、木牌、卡片用。 */
export function inkPoly(c: Ctx, pts: readonly Pt[], o: InkOpts = {}): Pt | null {
  const p = penFor(c, o, 23);
  if (o.fill && (o.reveal ?? 1) > 0) p.fill(pts, o.fill, clamp((o.reveal ?? 1) * 1.5 - 0.5));
  const { pts: q, tip } = cut(pts.concat([pts[0]!]), o.reveal);
  p.line(q, o.w ?? 1, o.color, o.taper ?? 0.08, false);
  p.end();
  return tip;
}

/** 手繪矩形（左上 x, y、寬 w、高 h；r 圓角半徑）：可填色。 */
export function inkRect(c: Ctx, x: number, y: number, w: number, h: number, o: InkOpts & { r?: number } = {}): Pt | null {
  const r = Math.min(o.r ?? 0, w / 2, h / 2);
  const pts: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    if (r <= 0) { pts.push({ x: cx + Math.cos(a0 + PI / 4) * 0, y: cy }); return; }
    for (let k = 0; k <= 3; k++) { const a = a0 + (k / 3) * (PI / 2); pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  };
  if (r <= 0) pts.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h });
  else { corner(x + w - r, y + r, -PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, PI / 2); corner(x + r, y + r, PI); }
  return inkPoly(c, pts, o);
}

/** 手繪橢圓（旋轉 rot 弧度），可填色。 */
export function inkEllipse(c: Ctx, x: number, y: number, rx: number, ry: number, rot = 0, o: InkOpts = {}): Pt | null {
  const n = Math.max(14, Math.min(64, Math.round((rx + ry) * 0.5)));
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const a0 = hh(o.seed ?? 3, Math.floor((o.t ?? 0) * 8), 9) * TAU; // 起筆位置每次不一樣，像手畫的圈
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * TAU * 1.04;
    const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
    pts.push({ x: x + ex * cs - ey * sn, y: y + ex * sn + ey * cs });
  }
  const p = penFor(c, o, 17);
  if (o.fill && (o.reveal ?? 1) > 0) p.fill(pts, o.fill, clamp((o.reveal ?? 1) * 1.5 - 0.5));
  const { pts: q, tip } = cut(pts, o.reveal);
  p.line(q, o.w ?? 1, o.color, o.taper ?? 0.35);
  p.end();
  return tip;
}

export function inkCircle(c: Ctx, x: number, y: number, r: number, o: InkOpts = {}): Pt | null {
  return inkEllipse(c, x, y, r, r, 0, o);
}

/** 排線陰影：在 poly 裡面畫平行細線（angle 弧度、gap 間距 px）。 */
export function hatch(c: Ctx, poly: readonly Pt[], o: InkOpts & { angle?: number; gap?: number } = {}) {
  const p = penFor(c, o, 19);
  const ang = o.angle ?? -PI / 4, gap = o.gap ?? 7;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of poly) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 2;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  p.clip(poly, (cc) => {
    cc.strokeStyle = o.color ?? p.ink.soft;
    cc.lineWidth = (o.w ?? 0.45) * p.lw;
    cc.lineCap = 'round';
    cc.beginPath();
    for (let k = -R; k <= R; k += gap) {
      const jx = (hh(p.seed, Math.round(k), 3) - 0.5) * 1.2;
      const px = cx - dy * k + jx, py = cy + dx * k;
      cc.moveTo(px - dx * R, py - dy * R);
      cc.lineTo(px + dx * R, py + dy * R);
    }
    cc.stroke();
  });
  p.end();
}

// ================================================================ 身體的「管子」
/**
 * 一節一節的四肢／軀幹：中心線（關節點）＋ 每個關節的半徑 → 左右兩條輪廓。
 * 關節處用二次貝茲削圓角；彎內側往回折的點丟掉（不然膝蓋內側會打結）；每節中段稍微鼓一點（肌肉）。
 */
function tube(pts: readonly Pt[], rs: readonly number[], bulge = 0.08, steps = 4): { L: Pt[]; R: Pt[]; C: Pt[] } {
  const C: Pt[] = [], RR: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const l = dist(a, b) || 1e-6;
    const ca = i > 0 ? Math.min(l * 0.3, rs[i]! * 0.9) : 0;
    const cb = i < n - 2 ? Math.min(l * 0.3, rs[i + 1]! * 0.9) : 0;
    for (let k = 0; k <= steps; k++) {
      const s = (ca + ((l - ca - cb) * k) / steps) / l;
      C.push(mixP(a, b, s));
      RR.push(lerp(rs[i]!, rs[i + 1]!, s) * (1 + bulge * Math.sin(PI * s)));
    }
    if (i < n - 2) {
      const c2 = pts[i + 2]!;
      const l2 = dist(b, c2) || 1e-6;
      const cut2 = Math.min(l2 * 0.3, rs[i + 1]! * 0.9);
      const p0 = mixP(b, a, cb / l), p2 = mixP(b, c2, cut2 / l2);
      for (let k = 1; k <= 3; k++) {
        const u = k / 4, w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
        C.push({ x: w0 * p0.x + w1 * b.x + w2 * p2.x, y: w0 * p0.y + w1 * b.y + w2 * p2.y });
        RR.push(rs[i + 1]!);
      }
    }
  }
  const L: Pt[] = [], R: Pt[] = [];
  const m = C.length;
  for (let i = 0; i < m; i++) {
    const p = C[i - 1] ?? C[i]!, q = C[i + 1] ?? C[i]!;
    let tx = q.x - p.x, ty = q.y - p.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const r = RR[i]!, cc = C[i]!;
    const l = { x: cc.x - ty * r, y: cc.y + tx * r }, rr = { x: cc.x + ty * r, y: cc.y - tx * r };
    const lastL = L[L.length - 1], lastR = R[R.length - 1];
    if (!lastL || (l.x - lastL.x) * tx + (l.y - lastL.y) * ty > 0) L.push(l);
    if (!lastR || (rr.x - lastR.x) * tx + (rr.y - lastR.y) * ty > 0) R.push(rr);
  }
  return { L, R, C };
}
const polyOf = (t: { L: Pt[]; R: Pt[] }) => t.L.concat(t.R.slice().reverse());

// ================================================================ 角色的比例
export type Who = 'alan' | 'omena';
export type Hand = 'rest' | 'open' | 'fist' | 'grip' | 'point' | 'peace' | 'flat';
export type Face = 'smile' | 'grin' | 'o' | 'calm' | 'closed';

interface Rig {
  k: number; head: number; neck: number; torso: number;
  upper: number; fore: number; hand: number;
  thigh: number; shin: number; ankleH: number; foot: number; heel: number; hipW: number;
  side: { pelvis: number; waist: number; chest: number; neck: number; neckTop: number };
  front: { pelvis: number; waist: number; chest: number; shoulder: number; neck: number };
  arm: [number, number, number];
  leg: [number, number, number];
}
// 單位 = 這個角色自己的身高。宣文：比較高、肩寬、圓臉；孟庭：纖細（腰、手臂細），頭稍大一點點（比例上）。
const RIG: Record<Who, Rig> = {
  alan: {
    k: 1, head: 0.15, neck: 0.04, torso: 0.29, upper: 0.185, fore: 0.15, hand: 0.1,
    thigh: 0.245, shin: 0.245, ankleH: 0.035, foot: 0.15, heel: 0.035, hipW: 0.052,
    side: { pelvis: 0.078, waist: 0.07, chest: 0.084, neck: 0.052, neckTop: 0.031 },
    front: { pelvis: 0.1, waist: 0.094, chest: 0.116, shoulder: 0.13, neck: 0.034 },
    arm: [0.036, 0.027, 0.021], leg: [0.063, 0.044, 0.031],
  },
  omena: {
    k: 0.93, head: 0.153, neck: 0.043, torso: 0.283, upper: 0.183, fore: 0.148, hand: 0.095,
    thigh: 0.25, shin: 0.247, ankleH: 0.033, foot: 0.14, heel: 0.03, hipW: 0.05,
    side: { pelvis: 0.076, waist: 0.056, chest: 0.069, neck: 0.043, neckTop: 0.026 },
    front: { pelvis: 0.1, waist: 0.07, chest: 0.09, shoulder: 0.103, neck: 0.027 },
    arm: [0.029, 0.021, 0.016], leg: [0.057, 0.037, 0.026],
  },
};
/** 身高（宣文 = 1）。 */
export const HEIGHT: Record<Who, number> = { alan: RIG.alan.k, omena: RIG.omena.k };

// ================================================================ 姿勢
/**
 * 一個姿勢（純資料）。角度都是「度」，意義見檔頭：
 *  - rot：整個人轉（+ 往前倒；-90 = 仰躺，頭朝後）；lean：軀幹前傾；chest：胸口再彎（下腰用負的）；head：低頭（+）／抬頭（−）。
 *  - armA／armB：[肩, 肘, 腕]；legA／legB：[髖, 膝, 踝]（踝 + = 腳尖往下踮）。
 *  - lift：離地（身高倍數）。hand：手的樣子；face：表情。
 */
export interface Pose {
  rot: number;
  lean: number;
  chest: number;
  head: number;
  armA: [number, number, number];
  armB: [number, number, number];
  legA: [number, number, number];
  legB: [number, number, number];
  lift: number;
  handA: Hand;
  handB: Hand;
  face: Face;
  /** 手臂的透視縮短（0.3..1，預設 1）：手臂往鏡頭或往後伸（抱、繞過對方的背）時看起來比較短。 */
  reachA?: number;
  reachB?: number;
}

type PoseIn = Partial<Omit<Pose, 'armA' | 'armB' | 'legA' | 'legB'>> & {
  armA?: readonly number[]; armB?: readonly number[]; legA?: readonly number[]; legB?: readonly number[];
};
const a3 = (x: readonly number[] | undefined, d: [number, number, number]): [number, number, number] =>
  x ? [x[0] ?? d[0], x[1] ?? d[1], x[2] ?? 0] : [d[0], d[1], d[2]];

const STAND: Pose = {
  rot: 0, lean: 0, chest: 0, head: 0,
  armA: [6, 14, 0], armB: [-7, 12, 0], legA: [3, -3, 0], legB: [-4, -2, 0],
  lift: 0, handA: 'rest', handB: 'rest', face: 'smile',
};
const FSTAND: Pose = {
  rot: 0, lean: 0, chest: 0, head: 0,
  armA: [9, -8, 0], armB: [9, -8, 0], legA: [3, -2, 0], legB: [3, -2, 0],
  lift: 0, handA: 'rest', handB: 'rest', face: 'smile',
};
/** 從站姿出發改幾個欄位。 */
export function pose(o: PoseIn = {}, base: Pose = STAND): Pose {
  return {
    ...base, ...o,
    armA: a3(o.armA, base.armA), armB: a3(o.armB, base.armB), legA: a3(o.legA, base.legA), legB: a3(o.legB, base.legB),
  } as Pose;
}

const l3 = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [lerp(a[0]!, b[0]!, k), lerp(a[1]!, b[1]!, k), lerp(a[2]!, b[2]!, k)];
/** 兩個姿勢之間內插（數字線性，手的樣子與表情在一半時切換）。 */
export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return {
    rot: lerp(a.rot, b.rot, k), lean: lerp(a.lean, b.lean, k), chest: lerp(a.chest, b.chest, k), head: lerp(a.head, b.head, k),
    armA: l3(a.armA, b.armA, k), armB: l3(a.armB, b.armB, k), legA: l3(a.legA, b.legA, k), legB: l3(a.legB, b.legB, k),
    lift: lerp(a.lift, b.lift, k), handA: k < 0.5 ? a.handA : b.handA, handB: k < 0.5 ? a.handB : b.handB, face: k < 0.5 ? a.face : b.face,
    reachA: lerp(a.reachA ?? 1, b.reachA ?? 1, k), reachB: lerp(a.reachB ?? 1, b.reachB ?? 1, k),
  };
}
/** 手腳 A／B 對調（換另一隻手拿球拍、另一隻腳踢）。 */
export function mirrorPose(p: Pose): Pose {
  return { ...p, armA: p.armB, armB: p.armA, legA: p.legB, legB: p.legA, handA: p.handB, handB: p.handA, reachA: p.reachB, reachB: p.reachA };
}

/** 關鍵格內插：keys 依 p 排好，[p, pose]；相鄰兩格之間用 inOutCubic（停頓在關鍵格上、中間快）。 */
export function keyPose(p: number, keys: readonly (readonly [number, Pose])[]): Pose {
  if (p <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [p1, b] = keys[i]!;
    if (p <= p1) {
      const [p0, a] = keys[i - 1]!;
      return lerpPose(a, b, ease.inOutCubic((p - p0) / Math.max(1e-6, p1 - p0)));
    }
  }
  return keys[keys.length - 1]![1];
}

// ---------------------------------------------------------------- 側面的姿勢庫
const K_SWING_OH = [
  [-1, pose({ lean: 6, armA: [72, 82, -20], armB: [42, 40], legA: [16, -16], legB: [-15, -12, 8], handA: 'grip' })],
  [-0.45, pose({ lean: -12, chest: -6, head: -16, armA: [158, 138, 25], armB: [150, 12], legA: [22, -10], legB: [-24, -20, 20], handA: 'grip', handB: 'open' })],
  [0, pose({ lean: 3, head: -12, armA: [170, 6, 8], armB: [75, 30], legA: [12, -10], legB: [-22, -18, 34], handA: 'grip', face: 'grin' })],
  [0.45, pose({ lean: 18, armA: [48, 22, 18], armB: [-20, 40], legA: [26, -22], legB: [-8, -34, 26], handA: 'grip' })],
  [1, pose({ lean: 6, armA: [72, 82, -20], armB: [42, 40], legA: [16, -16], legB: [-15, -12, 8], handA: 'grip' })],
] as const;
const K_SWING_FH = [
  [-1, pose({ lean: 10, armA: [42, 62, -10], armB: [34, 52], legA: [18, -24], legB: [-16, -18, 8], handA: 'grip' })],
  [-0.45, pose({ lean: 6, head: 4, armA: [-72, 28, 20], armB: [78, 14], legA: [22, -20], legB: [-24, -24, 16], handA: 'grip', handB: 'open' })],
  [0, pose({ lean: 12, armA: [74, 10, -5], armB: [20, 40], legA: [24, -18], legB: [-18, -22, 30], handA: 'grip', face: 'grin' })],
  [0.45, pose({ lean: 14, armA: [152, 70, 20], armB: [-10, 50], legA: [20, -20], legB: [-6, -30, 26], handA: 'grip' })],
  [1, pose({ lean: 10, armA: [42, 62, -10], armB: [34, 52], legA: [18, -24], legB: [-16, -18, 8], handA: 'grip' })],
] as const;
const K_THROW = [
  [-1, pose({ armA: [22, 64, 0], armB: [8, 20], handA: 'grip' })],
  [-0.4, pose({ lean: -10, head: -4, armA: [196, 72, 30], armB: [100, 0], legA: [26, -8], legB: [-26, -16, 20], handA: 'grip', handB: 'open' })],
  [0, pose({ lean: 12, armA: [128, 14, -12], armB: [30, 40], legA: [24, -14], legB: [-22, -24, 36], handA: 'open', face: 'grin' })],
  [0.4, pose({ lean: 26, head: 6, armA: [28, 22, 0], armB: [-30, 30], legA: [22, -24], legB: [-4, -44, 30], handA: 'open' })],
  [1, pose({ lean: 4, armA: [10, 18], armB: [-6, 14], handA: 'rest' })],
] as const;
const K_TOSS = [
  [-1, pose({ armA: [20, 30, 0], handA: 'grip' })],
  [-0.4, pose({ lean: 10, armA: [-56, 8, 0], armB: [30, 30], legA: [22, -24], legB: [-20, -20, 14], handA: 'grip' })],
  [0, pose({ lean: 2, armA: [96, 8, 0], armB: [-10, 30], legA: [22, -20], legB: [-16, -18, 20], handA: 'open', face: 'grin' })],
  [0.5, pose({ lean: -2, armA: [132, 20, 0], armB: [-16, 30], handA: 'open' })],
  [1, pose({ armA: [12, 16], handA: 'rest' })],
] as const;
const K_CATCH = [
  [-1, pose({})],
  [-0.35, pose({ lean: -4, head: -18, armA: [150, 20], armB: [140, 24], handA: 'open', handB: 'open', face: 'o' })],
  [0, pose({ lean: -2, head: -14, armA: [136, 42], armB: [128, 44], handA: 'open', handB: 'open', face: 'o' })],
  [0.5, pose({ lean: 6, head: 6, armA: [58, 108], armB: [52, 112], handA: 'fist', handB: 'fist', face: 'grin' })],
  [1, pose({ lean: 2, armA: [38, 100], armB: [34, 100], handA: 'fist', handB: 'fist' })],
] as const;
const K_SHOOT = [
  [-1, pose({ armA: [46, 110], armB: [40, 112], handA: 'open', handB: 'open' })],
  [-0.5, pose({ lean: 12, armA: [40, 120], armB: [36, 122], legA: [48, -80, -8], legB: [40, -76, -8], handA: 'open', handB: 'open' })],
  [-0.2, pose({ lean: 2, head: -10, armA: [150, 110], armB: [146, 112], legA: [6, -8, 20], legB: [2, -6, 20], handA: 'open', handB: 'open' })],
  [0, pose({ lean: 0, head: -12, armA: [168, 12, 50], armB: [150, 40], legA: [2, -4, 40], legB: [-2, -4, 40], handA: 'open', handB: 'open', lift: 0.05 })],
  [0.5, pose({ lean: 2, head: -10, armA: [160, 16, 72], armB: [140, 44], legA: [4, -8, 20], legB: [0, -6, 20], handA: 'open', handB: 'open' })],
  [1, pose({ armA: [20, 30], armB: [14, 30] })],
] as const;
const K_KICK = [
  [-1, pose({})],
  [-0.4, pose({ lean: -6, armA: [50, 30], armB: [-40, 30], legA: [-36, -96, 30], legB: [4, -14], handA: 'fist', handB: 'fist' })],
  [0, pose({ lean: -12, armA: [-30, 30], armB: [60, 30], legA: [46, -8, 40], legB: [-4, -10], handA: 'fist', handB: 'fist', face: 'grin' })],
  [0.5, pose({ lean: -18, armA: [-40, 30], armB: [70, 30], legA: [78, 0, 40], legB: [-8, -8, 10], handA: 'fist', handB: 'fist' })],
  [1, pose({})],
] as const;
const K_PANTOSS = [
  [-1, pose({ lean: 6, armA: [62, 36, 0], armB: [30, 60], handA: 'grip', face: 'calm' })],
  [-0.3, pose({ lean: 8, armA: [48, 46, 22], armB: [30, 60], handA: 'grip', face: 'calm' })],
  [0, pose({ lean: 2, head: -8, armA: [78, 26, -36], armB: [30, 60], handA: 'grip', face: 'o' })],
  [0.45, pose({ lean: 4, head: -6, armA: [66, 32, -8], armB: [30, 60], handA: 'grip', face: 'grin' })],
  [1, pose({ lean: 6, armA: [62, 36, 0], armB: [30, 60], handA: 'grip', face: 'smile' })],
] as const;

/** 走路的一隻腳（q = 0 這隻腳跟著地、在前面）。 */
function walkLeg(q: number): [number, number, number] {
  q = frac(q);
  return [20 * Math.cos(TAU * q) + 2, -(6 + 12 * bump(q, 0.08, 0.07) + 58 * bump(q, 0.72, 0.12)), 24 * bump(q, 0.56, 0.07) - 8 * bump(q, 0, 0.05)];
}
function runLeg(q: number): [number, number, number] {
  q = frac(q);
  return [44 * Math.cos(TAU * q) + 12, -(16 + 100 * bump(q, 0.68, 0.15) + 18 * bump(q, 0.08, 0.07)), 34 * bump(q, 0.44, 0.08)];
}

/**
 * 側面的姿勢庫（面向右、A = 靠鏡頭）。φ 是循環相位（0..1 一圈），p 是動作進度（-1..1，0 = 那一下，見 beatSwing）。
 */
export const POSE = {
  stand: () => pose(),
  /** 走路：φ 0 = A 腳跟著地、0.5 = B 腳跟著地。`walk(f.beat / 2)` 一拍一步。每走一圈前進 `STRIDE.walk * h`。 */
  walk: (ph: number) => {
    const c = Math.cos(TAU * ph);
    return pose({ lean: 3, head: -2, legA: walkLeg(ph), legB: walkLeg(ph + 0.5), armA: [-17 * c + 4, 16 + 10 * Math.max(0, -c)], armB: [17 * c + 4, 16 + 10 * Math.max(0, c)] });
  },
  /** 跑步：φ 同走路（一圈兩步）。每跑一圈前進 `STRIDE.run * h`。 */
  run: (ph: number) => {
    const c = Math.cos(TAU * ph);
    const lift = 0.028 * (bump(ph, 0.5, 0.07) + bump(ph, 0, 0.07));
    return pose({ lean: 14, head: -8, legA: runLeg(ph), legB: runLeg(ph + 0.5), armA: [-46 * c + 10, 92], armB: [46 * c + 10, 92], handA: 'fist', handB: 'fist', lift, face: 'grin' });
  },
  /** 跳：p -1 站 → -0.55 蹲（預備）→ -0.3 蹬地 → **0 最高點** → 0.55 落地緩衝 → 1 站。hgt = 最高離地（身高倍數）。 */
  jump: (p: number, hgt = 0.2) => {
    const k = keyPose(p, [
      [-1, pose({})],
      [-0.55, pose({ lean: 26, head: 6, legA: [62, -112, -22], legB: [56, -106, -22], armA: [-52, 22], armB: [-46, 22] })],
      [-0.3, pose({ lean: 6, head: -8, legA: [-4, -4, 46], legB: [-8, -4, 46], armA: [150, 12], armB: [140, 14] })],
      [0, pose({ lean: 0, head: -12, legA: [22, -54, 34], legB: [10, -40, 34], armA: [166, 10], armB: [158, 14], handA: 'open', handB: 'open', face: 'grin' })],
      [0.3, pose({ lean: 4, legA: [8, -12, 22], legB: [0, -10, 22], armA: [120, 20], armB: [110, 20] })],
      [0.55, pose({ lean: 20, head: 4, legA: [50, -92, -12], legB: [44, -88, -12], armA: [60, 30], armB: [50, 30] })],
      [1, pose({})],
    ]);
    k.lift = Math.abs(p) < 0.33 ? hgt * (1 - (p / 0.33) ** 2) : 0;
    return k;
  },
  crouch: () => pose({ lean: 32, head: -14, legA: [76, -126, -24], legB: [66, -120, -24], armA: [56, 42], armB: [46, 36] }),
  /** 坐在椅子上（腳著地、屁股在膝蓋高度；回傳的 lap = 大腿上）。 */
  sit: () => pose({ lean: -4, legA: [88, -90], legB: [84, -86], armA: [28, 56], armB: [22, 60], face: 'smile' }),
  /** 坐在地上，往後撐。 */
  sitFloor: () => pose({ lean: -14, legA: [82, -14, 10], legB: [76, -34, 6], armA: [-36, 6], armB: [-42, 6], handA: 'flat', handB: 'flat' }),
  /** 單膝跪（A 腳在前踩地、B 膝蓋著地）：求婚。 */
  kneel: () => pose({ lean: 2, legA: [86, -92], legB: [-4, -92, 62], armA: [72, 56], armB: [30, 64], handA: 'open' }),
  /** 仰躺（頭朝後）。 */
  lie: () => pose({ rot: -90, legA: [2, -6, 30], legB: [8, -14, 30], armA: [30, 20], armB: [20, 20], face: 'calm' }),
  /** 側躺（睡午覺）。 */
  lieSide: () => pose({ rot: -90, lean: 10, head: -10, legA: [40, -60, 20], legB: [30, -50, 20], armA: [100, 60], armB: [80, 80], face: 'closed' }),
  /** 揮拍：p -1 預備 → -0.45 引拍 → **0 擊球** → 0.45 隨揮 → 1 回到預備。overhead = 羽球高遠球／殺球，forehand = 網球正手。 */
  swing: (p: number, kind: 'overhead' | 'forehand' = 'overhead') => keyPose(p, kind === 'overhead' ? K_SWING_OH : K_SWING_FH),
  /** 過肩丟（A 手，**0 = 出手**）。 */
  throw: (p: number) => keyPose(p, K_THROW),
  /** 低手拋（保齡球、丟捧花、拋給狗，**0 = 出手**）。 */
  toss: (p: number) => keyPose(p, K_TOSS),
  /** 接（兩手往上，**0 = 接到**），之後抱在胸前。 */
  catch: (p: number) => keyPose(p, K_CATCH),
  /** 投籃（**0 = 出手**，會踮起來）。 */
  shoot: (p: number) => keyPose(p, K_SHOOT),
  /** 踢（A 腳，**0 = 踢到**）。 */
  kick: (p: number) => keyPose(p, K_KICK),
  /** 揮手（φ 一來一回）。 */
  wave: (ph: number) => pose({ armA: [150, 26 + 26 * Math.sin(TAU * ph), 0], handA: 'open', face: 'grin' }),
  point: () => pose({ lean: 2, armA: [92, 2], handA: 'point' }),
  /** disco 指天。 */
  pointUp: () => pose({ lean: -6, head: -10, armA: [156, 0], armB: [16, 104], legA: [22, -26, 10], legB: [-6, 0], handA: 'point', handB: 'fist', face: 'grin' }),
  cheer: () => pose({ head: -12, armA: [168, 16], armB: [158, 22], handA: 'fist', handB: 'fist', face: 'grin' }),
  /** 面對面抱（兩人各自面向對方，x 距離約 0.2h）。 */
  /** 抱（手搭在對方背上）。兩個人抱在一起請用 drawHug()，會把手疊在對方身體前面。 */
  hug: () => pose({ lean: 6, head: 16, armA: [70, 20, -72], armB: [62, 24, -60], reachA: 0.84, reachB: 0.8, handA: 'flat', handB: 'flat', face: 'closed' }),
  /** 被抱的那個（手環著對方的腰、頭靠在對方胸口）。 */
  hugBack: () => pose({ lean: 8, head: 22, armA: [52, 18, -62], armB: [48, 22, -56], reachA: 0.9, reachB: 0.8, handA: 'flat', handB: 'flat', face: 'closed' }),
  /** 牽手走（手往下伸向旁邊的人）。 */
  holdHand: () => pose({ armA: [10, 6], handA: 'grip' }),
  /** 揹人的人：back 關節是對方骨盆的位置（對方用 POSE.ride、anchor: 'pelvis'）。 */
  carry: () => pose({ lean: 30, head: -20, armA: [-34, 96], armB: [-28, 96], legA: [22, -30], legB: [-12, -20], handA: 'grip', handB: 'grip', face: 'grin' }),
  ride: () => pose({ lean: 24, chest: 4, head: -6, armA: [70, 66], armB: [64, 72], legA: [84, -76, 24], legB: [78, -82, 24], handA: 'flat', handB: 'flat', face: 'grin' }),
  /** 華爾滋握姿（面對面）：lead = 宣文（A 手在對方背後、B 手舉起握她的手）、follow = 孟庭（A 手搭肩、B 手被握）。 */
  waltzLead: () => pose({ lean: 2, head: -4, armA: [42, 78], armB: [78, 88], handA: 'flat', handB: 'grip' }),
  waltzFollow: () => pose({ lean: -4, chest: -4, head: -10, armA: [45, 100], armB: [74, 92], handA: 'flat', handB: 'grip' }),
  /** 華爾滋的腳步：φ 一小節一圈；1 下沉、2 3 踮起（rise & fall）。套在握姿上：`waltzStep(φ, POSE.waltzLead())`。 */
  waltzStep: (ph: number, base: Pose = pose()) => {
    const q = frac(ph), rise = Math.sin(PI * clamp((q - 0.2) / 0.8));
    const s = Math.sin(TAU * q);
    return { ...base, legA: [14 * s + 4, -8 - 10 * (1 - rise), 26 * rise] as [number, number, number], legB: [-14 * s - 2, -6 - 8 * (1 - rise), 26 * rise] as [number, number, number], lift: 0.012 * rise };
  },
  twirlLead: () => pose({ head: -12, armA: [30, 50], armB: [122, 6], handA: 'rest', handB: 'grip', face: 'smile' }),
  /** 在對方舉起的手下轉圈（配合 opts.spin、flare、flow）。 */
  twirl: () => pose({ head: -4, armA: [34, 40], armB: [162, 36], legA: [2, -2, 34], legB: [-2, -2, 34], handA: 'rest', handB: 'grip', face: 'grin' }),
  dipLead: () => pose({ lean: 16, head: 22, armA: [66, 66], armB: [106, 20], legA: [30, -44], legB: [-24, -8, 14], handA: 'flat', handB: 'grip', face: 'smile' }),
  dipFollow: () => pose({ lean: -38, chest: -14, head: -22, armA: [92, 40], armB: [-96, 12], legA: [40, -10, 40], legB: [-4, -16, 24], handA: 'flat', handB: 'open', face: 'closed' }),
  /** disco：φ 0～0.5 指天、0.5～1 指地（一拍換一下就用 f.beat / 2）。 */
  disco: (ph: number) => {
    const up = frac(ph) < 0.5;
    return up ? pose({ lean: -6, head: -10, armA: [156, 0], armB: [16, 104], legA: [22, -26, 10], legB: [-6, 0], handA: 'point', handB: 'fist', face: 'grin' })
      : pose({ lean: 10, head: 6, armA: [36, 0], armB: [16, 104], legA: [4, -4], legB: [-14, -30, 20], handA: 'point', handB: 'fist', face: 'grin' });
  },
  /** 拿東西在 A 手（道具畫在 handA、方向 handAngA）。 */
  hold: (what: 'cup' | 'mic' | 'pan' | 'plate' | 'phone' = 'cup') => ({
    cup: pose({ armA: [36, 104, -24], handA: 'grip' }),
    mic: pose({ head: -4, armA: [24, 138, 0], handA: 'grip', face: 'o' }),
    pan: pose({ lean: 6, armA: [62, 36, 0], handA: 'grip' }),
    plate: pose({ armA: [60, 60, -40], handA: 'flat' }),
    phone: pose({ head: 10, armA: [40, 96, -30], handA: 'grip', face: 'calm' }),
  })[what],
  /** 甩鍋（**0 = 往上一甩**，鍋裡的東西在這一刻飛起來）。 */
  panToss: (p: number) => keyPose(p, K_PANTOSS),
  /** 遞東西（盤子）給面前的人。 */
  offer: () => pose({ lean: 6, armA: [78, 26, -20], armB: [70, 40, -20], handA: 'flat', handB: 'flat' }),
  /** 拍手（**0 = 拍到**）。 */
  clap: (p: number) => { const k = 1 - clamp(Math.abs(p) * 2.2); return pose({ armA: [60, lerp(70, 100, k)], armB: [52, lerp(60, 104, k)], handA: 'flat', handB: 'flat', face: 'grin' }); },
  bow: () => pose({ lean: 48, head: 10, armA: [52, 6], armB: [46, 6], face: 'closed' }),
  lookUp: () => pose({ lean: -6, head: -26, armA: [4, 10], armB: [-4, 10], face: 'o' }),
};

/** 走路／跑步一圈（兩步）前進多少（乘上 h）。角色的 x 照這個速度移動，腳才不會滑。 */
export const STRIDE = { walk: 0.62, run: 1.25 };

// ---------------------------------------------------------------- 正面的姿勢庫
/** 正面的姿勢（A = 畫面左手）：+ = 往外張。 */
export const FRONT = {
  stand: () => pose({}, FSTAND),
  wave: (ph: number) => pose({ armB: [128, 34 + 24 * Math.sin(TAU * ph), 0], handB: 'open', face: 'grin' }, FSTAND),
  cheer: () => pose({ head: 0, armA: [148, 12], armB: [148, 12], handA: 'fist', handB: 'fist', face: 'grin' }, FSTAND),
  /** 比 YA（B 手在臉旁）。 */
  peace: () => pose({ armB: [56, 142], handB: 'peace', face: 'grin' }, FSTAND),
  hips: () => pose({ armA: [38, -104], armB: [38, -104], handA: 'fist', handB: 'fist' }, FSTAND),
  clap: (p: number) => { const k = 1 - clamp(Math.abs(p) * 2.2); return pose({ armA: [22, lerp(80, 120, k)], armB: [22, lerp(80, 120, k)], handA: 'flat', handB: 'flat', face: 'grin' }, FSTAND); },
  point: () => pose({ armB: [88, 0], handB: 'point' }, FSTAND),
  /** 手臂搭在旁邊的人肩上（B 手：畫面右邊的人用 mirror 或 dir = -1）。 */
  armAround: () => pose({ armB: [112, -118], handB: 'flat' }, FSTAND),
  /** 牽手（B 手往外下方伸）。 */
  holdHands: () => pose({ armB: [26, 4], handB: 'grip' }, FSTAND),
  /** 自拍（B 手舉高拿手機）。 */
  selfie: () => pose({ head: 6, armB: [124, -26], handB: 'grip', face: 'grin' }, FSTAND),
  /** 正面跳（**0 = 最高點**）。 */
  jump: (p: number, hgt = 0.14) => {
    const crouch = bump(clamp(p, -1, 1) * 0.5, -0.28, 0.1) + bump(clamp(p, -1, 1) * 0.5, 0.28, 0.1);
    const air = Math.abs(p) < 0.33 ? 1 - (p / 0.33) ** 2 : 0;
    return pose({ armA: [lerp(20, 150, air), 20], armB: [lerp(20, 150, air), 20], legA: [3 + 26 * crouch + 10 * air, -2 - 50 * crouch - 30 * air], legB: [3 + 26 * crouch + 10 * air, -2 - 50 * crouch - 30 * air], lift: hgt * air, handA: 'open', handB: 'open', face: air > 0.3 ? 'grin' : 'smile' }, FSTAND);
  },
  shrug: () => pose({ head: 8, armA: [30, -70], armB: [30, -70], handA: 'open', handB: 'open', face: 'o' }, FSTAND),
  /** 兩手在頭上比愛心。 */
  heart: () => pose({ armA: [150, 100], armB: [150, 100], handA: 'flat', handB: 'flat', face: 'grin' }, FSTAND),
};

// ---------------------------------------------------------------- 節拍
/**
 * 動作進度：t 在 hit 之前 pre 秒從 -1 開始預備（先慢後快，擊球那一下最快），hit 那一刻 = 0，之後 post 秒減速收回到 1。
 * 範圍外是 -1（還沒開始）／1（做完了）。擊球、出手、踢、起跳最高點都用它對到拍點。
 */
export function beatSwing(t: number, hit: number, pre = 0.35, post = 0.45): number {
  if (t < hit) return -1 + ease.inQuad(clamp(1 - (hit - t) / pre));
  return ease.outCubic(clamp((t - hit) / post));
}
/** 走路相位：一拍一步、腳跟落在拍點（f.beat 是連續的拍號）。 */
export const stepPhase = (beat: number) => beat / 2;

/** 拋物線：a → b，頂點比兩端的較高者再高 hgt（px）。u 0..1。回傳點與切線角（弧度）。 */
export function arcAt(a: Pt, b: Pt, hgt: number, u: number): Pt & { ang: number } {
  // y = 線性 + 拋物線（頂點落在 u*）：解出讓最高點高出 hgt 的係數
  const top = Math.min(a.y, b.y) - hgt;
  // y(u) = (1-u)^2 a + 2u(1-u) c + u^2 b 的二次貝茲，控制點 c 讓最高點 = top
  const cy = solveCtrl(a.y, b.y, top);
  const x = lerp(a.x, b.x, u);
  const y = (1 - u) * (1 - u) * a.y + 2 * u * (1 - u) * cy + u * u * b.y;
  const dx = b.x - a.x, dy = 2 * (1 - u) * (cy - a.y) + 2 * u * (b.y - cy);
  return { x, y, ang: Math.atan2(dy, dx) };
}
function solveCtrl(a: number, b: number, top: number) {
  // 二次貝茲 y 的極值 = (ab - c^2)/(a + b - 2c) → 解 c
  // (a+b-2c)*top = ab - c^2 → c^2 - 2 top c + (a+b) top - ab = 0
  const B = -2 * top, C = (a + b) * top - a * b;
  const disc = Math.max(0, B * B - 4 * C);
  return (-B - Math.sqrt(disc)) / 2;
}
export function arcPts(a: Pt, b: Pt, hgt: number, n = 32): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) { const p = arcAt(a, b, hgt, i / n); out.push({ x: p.x, y: p.y }); }
  return out;
}

// ================================================================ 骨架
interface Sk {
  pelvis: Pt; bottom: Pt; waist: Pt; chest: Pt; neck: Pt; neckTop: Pt; head: Pt; headAng: number;
  up1: Pt; up2: Pt; f1: Pt; f2: Pt;
  sh: [Pt, Pt]; el: [Pt, Pt]; wr: [Pt, Pt]; handAng: [number, number];
  hip: [Pt, Pt]; kn: [Pt, Pt]; an: [Pt, Pt]; heel: [Pt, Pt]; toe: [Pt, Pt]; footAng: [number, number];
}

function spine(rg: Rig, ps: Pose, hp: number) {
  const R = ps.rot * D, L = ps.lean * D, C = ps.chest * D, Hd = ps.head * D;
  const up1 = vv(PI - L - R), up2 = vv(PI - L - C - R), upN = vv(PI - L - C - Hd * 0.5 - R);
  const T = rg.torso * hp;
  const pelvis = { x: 0, y: 0 };
  const f1 = fwd(up1), f2 = fwd(up2);
  // 站直也不是一根直管：腰稍微往後、胸口往前一點（自然的 S 形），側面才有人的樣子
  const waist = at2(pelvis, up1, 0.42 * T, f1, -0.012 * hp);
  const chest = at2(waist, up2, 0.3 * T, f2, 0.016 * hp);
  const neck = at2(waist, up2, 0.58 * T, f2, 0.004 * hp);
  const neckTop = at(neck, upN, rg.neck * hp);
  const headAng = L + C + Hd + R;
  const head = at(neckTop, vv(PI - headAng), rg.head * hp * 0.4);
  const bottom = at(pelvis, up1, -0.06 * hp);
  return { R, L, C, up1, up2, f1, f2, pelvis, waist, chest, neck, neckTop, head, headAng, bottom };
}

function solveSide(rg: Rig, ps: Pose, hp: number): Sk {
  const s = spine(rg, ps, hp);
  const shA = at2(s.neck, s.up2, -0.03 * hp, s.f2, -0.012 * hp);
  const shB = at2(shA, s.up2, 0.004 * hp, s.f2, -0.016 * hp);
  const base = -(s.L + s.C) - s.R;
  const sh: [Pt, Pt] = [shA, shB];
  const el: Pt[] = [], wr: Pt[] = [], hand: number[] = [];
  [ps.armA, ps.armB].forEach((a, i) => {
    const aU = a[0] * D + base;
    const rc = (i ? ps.reachB : ps.reachA) ?? 1;
    const e = at(sh[i]!, vv(aU), rg.upper * hp * rc);
    const aF = aU + a[1] * D;
    el.push(e); wr.push(at(e, vv(aF), rg.fore * hp * rc)); hand.push(aF + a[2] * D);
  });
  const hip: [Pt, Pt] = [at2(s.pelvis, s.f1, 0.004 * hp, s.up1, 0.004 * hp), at2(s.pelvis, s.f1, -0.012 * hp, s.up1, 0.01 * hp)];
  const kn: Pt[] = [], an: Pt[] = [], heel: Pt[] = [], toe: Pt[] = [], fa: number[] = [];
  [ps.legA, ps.legB].forEach((l, i) => {
    const aT = l[0] * D - s.R;
    const k = at(hip[i]!, vv(aT), rg.thigh * hp);
    const aS = aT + l[1] * D;
    const a = at(k, vv(aS), rg.shin * hp);
    const aFt = aS + (90 - l[2]) * D;
    const ff = vv(aFt), fd = vv(aFt - PI / 2);
    kn.push(k); an.push(a); fa.push(aFt);
    heel.push(at2(a, fd, rg.ankleH * hp, ff, -rg.heel * hp));
    toe.push(at2(a, fd, rg.ankleH * hp * 0.85, ff, (rg.foot - rg.heel) * hp));
  });
  return {
    ...s, sh, el: [el[0]!, el[1]!], wr: [wr[0]!, wr[1]!], handAng: [hand[0]!, hand[1]!],
    hip, kn: [kn[0]!, kn[1]!], an: [an[0]!, an[1]!], heel: [heel[0]!, heel[1]!], toe: [toe[0]!, toe[1]!], footAng: [fa[0]!, fa[1]!],
  };
}

function solveFront(rg: Rig, ps: Pose, hp: number): Sk {
  const s = spine(rg, ps, hp);
  const W = rg.front.shoulder * hp * 0.8;
  const sh: [Pt, Pt] = [at2(s.neck, s.up2, -0.03 * hp, s.f2, -W), at2(s.neck, s.up2, -0.03 * hp, s.f2, W)];
  const base = -(s.L + s.C) - s.R;
  const el: Pt[] = [], wr: Pt[] = [], hand: number[] = [];
  [ps.armA, ps.armB].forEach((a, i) => {
    const sg = i === 0 ? -1 : 1;
    const aU = sg * a[0] * D + base;
    const rc = (i ? ps.reachB : ps.reachA) ?? 1;
    const e = at(sh[i]!, vv(aU), rg.upper * hp * rc);
    const aF = aU + sg * a[1] * D;
    el.push(e); wr.push(at(e, vv(aF), rg.fore * hp * 0.95 * rc)); hand.push(aF + sg * a[2] * D);
  });
  const hw = rg.hipW * hp;
  const hip: [Pt, Pt] = [at(s.pelvis, s.f1, -hw), at(s.pelvis, s.f1, hw)];
  const kn: Pt[] = [], an: Pt[] = [], heel: Pt[] = [], toe: Pt[] = [], fa: number[] = [];
  [ps.legA, ps.legB].forEach((l, i) => {
    const sg = i === 0 ? -1 : 1;
    const aT = sg * l[0] * D - s.R;
    const k = at(hip[i]!, vv(aT), rg.thigh * hp);
    const aS = aT + sg * l[1] * D;
    const a = at(k, vv(aS), rg.shin * hp);
    kn.push(k); an.push(a); fa.push(aS);
    const g = at(a, vv(aS), rg.ankleH * hp);
    heel.push(g); toe.push(at(g, { x: sg, y: 0 }, rg.foot * hp * 0.25));
  });
  return {
    ...s, sh, el: [el[0]!, el[1]!], wr: [wr[0]!, wr[1]!], handAng: [hand[0]!, hand[1]!],
    hip, kn: [kn[0]!, kn[1]!], an: [an[0]!, an[1]!], heel: [heel[0]!, heel[1]!], toe: [toe[0]!, toe[1]!], footAng: [fa[0]!, fa[1]!],
  };
}

/** 最低的接觸點（腳、膝、屁股、背、頭、手）：讓這一點落在地面上。 */
function lowest(J: Sk, rg: Rig, hp: number, front: boolean) {
  const rs = front ? rg.front : rg.side;
  let m = -Infinity;
  const q = (p: Pt, r: number) => { if (p.y + r > m) m = p.y + r; };
  q(J.heel[0], 0); q(J.heel[1], 0); q(J.toe[0], 0); q(J.toe[1], 0);
  q(J.kn[0], rg.leg[1] * hp); q(J.kn[1], rg.leg[1] * hp);
  q(J.bottom, rs.pelvis * hp * 0.85); q(J.pelvis, rs.pelvis * hp); q(J.waist, rs.waist * hp); q(J.chest, rs.chest * hp);
  q(J.head, rg.head * hp * 0.5); q(J.wr[0], rg.arm[2] * hp); q(J.wr[1], rg.arm[2] * hp);
  return m;
}

// ================================================================ 畫人
export interface PersonOpts {
  x: number;
  y: number;
  /** 場景尺度：宣文站直的身高（px）。 */
  h: number;
  dir?: 1 | -1;
  view?: 'side' | 'front';
  outfit?: 'daily' | 'wedding';
  ink?: Ink;
  t?: number;
  reveal?: number;
  alpha?: number;
  spin?: number;
  flow?: number;
  flare?: number;
  shades?: boolean;
  bag?: boolean;
  anchor?: 'ground' | 'pelvis';
  lw?: number;
  /** 表情覆寫（不給用姿勢的）。 */
  face?: Face;
  /** 不畫這幾隻手（被別人的身體擋住時；例如抱的時候遠的那隻手繞到對方背後）。 */
  hide?: ('armA' | 'armB')[];
  /** 只畫這隻手（要疊在別人身體前面時，第二次呼叫只補畫手）。 */
  only?: 'armA' | 'armB';
}

export interface Joints {
  top: Pt; head: Pt; mouth: Pt; neck: Pt; chest: Pt; back: Pt; pelvis: Pt; lap: Pt;
  shoulderA: Pt; shoulderB: Pt; elbowA: Pt; elbowB: Pt; handA: Pt; handB: Pt; handAngA: number; handAngB: number;
  hipA: Pt; hipB: Pt; kneeA: Pt; kneeB: Pt; footA: Pt; footB: Pt; toeA: Pt; toeB: Pt;
  bbox: [number, number, number, number];
  pen: Pt | null;
  /** 實際面向（含 spin 翻面）。 */
  facing: 1 | -1;
}

interface Look {
  who: Who; om: boolean; wed: boolean; ink: Ink; front: boolean;
  pants: string | null;
  flow: number; flare: number; t: number; shades: boolean; bag: boolean; face: Face;
  body: boolean; armA: boolean; armB: boolean;
}

/** 線寬：跟著場景尺度（h 420 → 3.2 px），限制在 2.5～4。 */
const lineW = (h: number) => clamp(h / 130, 2.5, 4);

// 描線進場的順序：頭 → 頭髮 → 軀幹 → 近手 → 遠手 → 近腳 → 遠腳 → 裙子 → 頭紗
const R_HEAD = 0, R_HAIR = 1, R_TORSO = 2, R_ARMA = 3, R_ARMB = 4, R_LEGA = 5, R_LEGB = 6, R_SKIRT = 7, R_VEIL = 8, NR = 9;
const SCHED = new Map<string, { offs: number[]; lens: number[]; total: number }>();

function schedule(key: string, measure: (p: Pen) => void, n: number) {
  let s = SCHED.get(key);
  if (s) return s;
  const lens = new Array<number>(n).fill(0);
  PEN.begin(null, inkFor(false), 0, 3, 0);
  PEN.meas = lens;
  measure(PEN);
  PEN.meas = null;
  const offs: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) { offs.push(acc); acc += lens[i]!; }
  s = { offs, lens, total: acc };
  SCHED.set(key, s);
  return s;
}

/**
 * 畫一個人。pose 用 POSE／FRONT 的姿勢（或自己改的）。回傳關節的畫面座標（接道具、牽手、牽繩用）。
 */
export function drawPerson(c: Ctx, who: Who, ps: Pose, o: PersonOpts): Joints {
  const rg = RIG[who];
  const hp = o.h * rg.k;
  const front = o.view === 'front';
  const ink = o.ink ?? inkFor(false);
  const t = o.t ?? 0;
  const wed = o.outfit === 'wedding';
  const lk: Look = {
    who, om: who === 'omena', wed, ink, front,
    pants: who === 'omena' && wed ? null : wed ? ink.dark : rgba('denim'),
    flow: o.flow ?? 0, flare: o.flare ?? 0, t, shades: !!o.shades, bag: o.bag ?? (who === 'alan' && !wed), face: o.face ?? ps.face,
    body: !o.only, armA: o.only ? o.only === 'armA' : !o.hide?.includes('armA'), armB: o.only ? o.only === 'armB' : !o.hide?.includes('armB'),
  };
  const J = front ? solveFront(rg, ps, hp) : solveSide(rg, ps, hp);
  // 地面：最低的接觸點落在 y；跳起來再往上 lift
  const oy = o.anchor === 'pelvis' ? o.y : o.y - lowest(J, rg, hp, front) - ps.lift * hp;
  const sp = o.spin ? Math.cos(TAU * o.spin) : 1;
  const sxs = (o.dir ?? 1) * (sp < 0 ? -1 : 1) * (0.35 + 0.65 * Math.abs(sp));
  const lw = o.lw ?? lineW(o.h);
  const draw = (p: Pen) => (front ? drawFront(p, J, rg, lk, ps, hp) : drawSide(p, J, rg, lk, ps, hp));

  const rv = o.reveal ?? 1;
  if (rv <= 0) return joints(J, rg, hp, o.x, oy, sxs, null, front);
  const seed = ((Math.floor(t * 8) * 7919) ^ (who === 'alan' ? 101 : 202)) | 0;
  let sched: { offs: number[]; lens: number[]; total: number } | null = null;
  if (rv < 1) {
    // 線長用站姿、h = 100 量一次（線長跟 h 成正比）
    const key = `${who}|${front ? 'f' : 's'}|${wed ? 'w' : 'd'}|${lk.bag ? 'b' : ''}`;
    sched = schedule(key, (p) => {
      const J0 = front ? solveFront(rg, front ? FSTAND : STAND, 100 * rg.k) : solveSide(rg, STAND, 100 * rg.k);
      const all = { ...lk, body: true, armA: true, armB: true };
      front ? drawFront(p, J0, rg, all, FSTAND, 100 * rg.k) : drawSide(p, J0, rg, all, STAND, 100 * rg.k);
    }, NR);
  }
  c.save();
  c.translate(o.x, oy);
  c.scale(sxs, 1);
  PEN.begin(c, ink, seed, lw, lineW(o.h) * 0.36, o.alpha ?? 1);
  PEN.ox = o.x; PEN.oy = oy; PEN.sx = sxs;
  if (sched) {
    const sc = hp / (100 * rg.k);
    PEN.rv = rv * sched.total * sc;
    PEN.offs = sched.offs.map((x) => x * sc);
    PEN.lens = sched.lens.map((x) => x * sc);
  }
  draw(PEN);
  PEN.flush();
  const pen = PEN.pen;
  c.restore();
  return joints(J, rg, hp, o.x, oy, sxs, rv < 1 ? pen : null, front);
}

function joints(J: Sk, rg: Rig, hp: number, x: number, y: number, sx: number, pen: Pt | null, front: boolean): Joints {
  const w = (p: Pt): Pt => ({ x: x + sx * p.x, y: y + p.y });
  const wa = (a: number) => Math.atan2(Math.cos(a), sx * Math.sin(a));
  const rs = front ? rg.front : rg.side;
  const up = vv(PI - J.headAng);
  const top = at(J.head, up, rg.head * hp * 0.56);
  const mouth = front ? at(J.head, up, -rg.head * hp * 0.24) : at2(J.head, up, -rg.head * hp * 0.22, fwd(up), rg.head * hp * 0.3);
  const back = at2(J.waist, J.f1, -rs.waist * hp * 1.6, J.up1, 0.02 * hp);
  const lap = at2(J.pelvis, J.f1, 0.12 * hp, J.up1, 0.06 * hp);
  const pts = [top, J.wr[0], J.wr[1], J.toe[0], J.toe[1], J.heel[0], J.heel[1], J.el[0], J.el[1], J.kn[0], J.kn[1], back];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { const q = w(p); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const pad = rs.chest * hp;
  const hand = (i: 0 | 1) => at(J.wr[i], vv(J.handAng[i]), rg.hand * hp * 0.34);
  return {
    top: w(top), head: w(J.head), mouth: w(mouth), neck: w(J.neck), chest: w(J.chest), back: w(back), pelvis: w(J.pelvis), lap: w(lap),
    shoulderA: w(J.sh[0]), shoulderB: w(J.sh[1]), elbowA: w(J.el[0]), elbowB: w(J.el[1]), handA: w(hand(0)), handB: w(hand(1)),
    handAngA: wa(J.handAng[0]), handAngB: wa(J.handAng[1]),
    hipA: w(J.hip[0]), hipB: w(J.hip[1]), kneeA: w(J.kn[0]), kneeB: w(J.kn[1]), footA: w(J.an[0]), footB: w(J.an[1]), toeA: w(J.toe[0]), toeB: w(J.toe[1]),
    bbox: [x0 - pad, y0 - pad * 0.3, x1 - x0 + 2 * pad, y1 - y0 + pad * 0.6],
    pen, facing: sx >= 0 ? 1 : -1,
  };
}

// ---------------------------------------------------------------- 衣服的圖案
/** 條紋 T 恤：垂直於 axis 的粗橫條（墨色）；gap = 條紋週期。 */
function stripes(p: Pen, poly: Pt[], o: Pt, axis: Pt, gap: number, col: string) {
  p.clip(poly, (c) => {
    const nx = -axis.y, ny = axis.x;
    c.strokeStyle = col;
    c.lineWidth = gap * 0.44;
    c.beginPath();
    for (let k = -14; k <= 14; k++) {
      const cx = o.x + axis.x * gap * (k + 0.25), cy = o.y + axis.y * gap * (k + 0.25);
      c.moveTo(cx - nx * gap * 12, cy - ny * gap * 12);
      c.lineTo(cx + nx * gap * 12, cy + ny * gap * 12);
    }
    c.stroke();
  });
}
/** 格紋（gingham）：淡綠底，縱橫兩個方向的半透明色帶，交叉處更深。 */
function gingham(p: Pen, poly: Pt[], o: Pt, axis: Pt, gap: number) {
  // 底色用不透明的混色：半透明的話，修圓後自己重疊的地方（下擺轉角）會疊出一塊深色
  p.fill(poly, p.ink.paper ? mixHex('paper', 'gingham', 0.45) : mixHex('ink2', 'gingham', 0.55));
  p.clip(poly, (c) => {
    const nx = -axis.y, ny = axis.x;
    c.strokeStyle = rgba('gingham', 0.62);
    c.lineWidth = gap * 0.5;
    c.beginPath();
    for (let k = -12; k <= 12; k++) {
      const ax = o.x + axis.x * gap * k, ay = o.y + axis.y * gap * k;
      c.moveTo(ax - nx * gap * 12, ay - ny * gap * 12); c.lineTo(ax + nx * gap * 12, ay + ny * gap * 12);
      const bx = o.x + nx * gap * k, by = o.y + ny * gap * k;
      c.moveTo(bx - axis.x * gap * 12, by - axis.y * gap * 12); c.lineTo(bx + axis.x * gap * 12, by + axis.y * gap * 12);
    }
    c.stroke();
  });
}
/** 上衣的填色（依角色與服裝）。 */
function topFill(p: Pen, lk: Look, poly: Pt[], o: Pt, axis: Pt, hp: number) {
  if (lk.wed) { p.fill(poly, lk.om ? lk.ink.light : lk.ink.dark); return; }
  if (lk.om) gingham(p, poly, o, axis, 0.022 * hp);
  else { p.fill(poly, lk.ink.fill); stripes(p, poly, o, axis, 0.028 * hp, lk.ink.line); }
}

// ---------------------------------------------------------------- 手
// 手的形狀（手的局部座標：x 沿著手指方向、y 垂直；單位 = 手長）
const HAND_SHAPES: Record<Hand, readonly (readonly [number, number])[]> = {
  rest: [[0, -0.13], [0.3, -0.16], [0.6, -0.12], [0.72, -0.02], [0.62, 0.09], [0.34, 0.12], [0.05, 0.12]],
  open: [[0, -0.12], [0.45, -0.15], [0.9, -0.09], [0.93, 0.0], [0.6, 0.09], [0.44, 0.11], [0.56, 0.28], [0.47, 0.31], [0.24, 0.15], [0.02, 0.12]],
  flat: [[0, -0.11], [0.5, -0.13], [0.88, -0.07], [0.9, 0.02], [0.5, 0.08], [0.04, 0.11]],
  fist: [[0, -0.14], [0.26, -0.19], [0.46, -0.13], [0.5, 0.03], [0.4, 0.16], [0.08, 0.15]],
  grip: [[0, -0.14], [0.26, -0.19], [0.46, -0.13], [0.5, 0.03], [0.4, 0.16], [0.08, 0.15]],
  point: [[0, -0.14], [0.28, -0.17], [0.46, -0.13], [0.9, -0.11], [0.92, -0.04], [0.48, -0.02], [0.42, 0.15], [0.08, 0.15]],
  peace: [[0, -0.14], [0.3, -0.16], [0.82, -0.33], [0.86, -0.26], [0.46, -0.07], [0.88, -0.02], [0.86, 0.05], [0.44, 0.07], [0.36, 0.15], [0.06, 0.14]],
};
function drawHand(p: Pen, wr: Pt, ang: number, size: number, kind: Hand, lk: Look) {
  const ax = vv(ang), ay = { x: -ax.y, y: ax.x };
  const pts = mapPts(wr, ax, ay, size, HAND_SHAPES[kind]);
  const sm = smoothPts(pts, true, 3);
  p.fill(sm, lk.ink.skin);
  p.line(sm, 0.72, undefined, 0.3, true);
  if (kind === 'fist' || kind === 'grip') p.line([loc(wr, ax, ay, size, 0.28, -0.12), loc(wr, ax, ay, size, 0.32, 0.06)], 0.45, lk.ink.feat);
}

// ---------------------------------------------------------------- 手臂
function drawArm(p: Pen, J: Sk, i: 0 | 1, rg: Rig, lk: Look, ps: Pose, hp: number) {
  const sh = J.sh[i], el = J.el[i], wr = J.wr[i];
  const r0 = rg.arm[0] * hp, r1 = rg.arm[1] * hp, r2 = rg.arm[2] * hp;
  const suit = lk.wed && !lk.om;
  const t = tube([sh, el, wr], [r0, r1, r2], 0.1);
  p.fill(polyOf(t), suit ? lk.ink.dark : lk.ink.skin);
  p.line(t.L); p.line(t.R);
  const u = unit(sh, el);
  if (suit) {
    // 西裝袖口露一點白襯衫
    const a = at(wr, unit(el, wr), -r2 * 0.9);
    const n = { x: -unit(el, wr).y, y: unit(el, wr).x };
    p.line([at(a, n, -r2 * 1.1), at(a, n, r2 * 1.1)], 0.7);
  } else if (!lk.wed) {
    // 短袖：從肩頭包到上臂一半，圖案跟身體一樣
    const a = at(sh, u, -r0 * 0.35), b = at(sh, u, dist(sh, el) * 0.46);
    const sl = tube([a, b], [r0 * 1.08, r0 * 1.16], 0.04, 3);
    const shape = sl.L.concat(sl.R.slice().reverse(), [at(sh, u, -r0 * 0.7)]);
    const sm = smoothPts(shape, true, 2);
    topFill(p, lk, sm, sh, u, hp);
    p.line(sm, 1, undefined, 0.25, true);
  }
  drawHand(p, wr, J.handAng[i], rg.hand * hp, i === 0 ? ps.handA : ps.handB, lk);
}

// ---------------------------------------------------------------- 腳
function drawLeg(p: Pen, J: Sk, i: 0 | 1, rg: Rig, lk: Look, hp: number) {
  if (lk.pants) {
    const t = tube([J.hip[i], J.kn[i], J.an[i]], rg.leg.map((r) => r * hp), 0.07);
    p.fill(polyOf(t), lk.pants);
    p.line(t.L); p.line(t.R);
    // 牛仔褲：外側一條淡淡的車線、褲管反摺
    if (!lk.wed && !lk.front) {
      const side = fwd(unit(J.hip[i], J.an[i]));
      p.line(t.C.slice(2, -2).map((q) => at(q, side, -rg.leg[1] * hp * 0.45)), 0.4, lk.ink.soft);
    }
    const e0 = t.L[t.L.length - 1], e1 = t.R[t.R.length - 1];
    const back = unit(J.an[i], J.kn[i]);
    if (e0 && e1) p.line([at(e0, back, rg.leg[2] * hp * 0.8), at(e1, back, rg.leg[2] * hp * 0.8)], 0.6);
  }
  if (lk.front) drawShoeFront(p, J, i, rg, lk, hp);
  else drawShoe(p, J.an[i], J.footAng[i], rg, lk, hp);
}

function drawShoe(p: Pen, an: Pt, aFt: number, rg: Rig, lk: Look, hp: number) {
  const ff = vv(aFt), fd = vv(aFt - PI / 2);
  const a = rg.ankleH * hp, fl = (rg.foot - rg.heel) * hp, hl = rg.heel * hp;
  const pts = [
    [-hl * 0.9, -a * 0.35], [-hl * 1.1, a * 0.45], [-hl * 0.8, a * 1.0], [fl * 0.5, a * 1.02], [fl * 0.95, a * 0.9], [fl * 1.0, a * 0.5],
    [fl * 0.7, a * 0.05], [fl * 0.25, -a * 0.35], [-hl * 0.1, -a * 0.6],
  ].map(([x, y]) => at2(an, ff, x!, fd, y!));
  const sm = smoothPts(pts, true, 3);
  const dark = lk.wed || lk.om;
  p.fill(sm, dark ? lk.ink.dark : lk.ink.fill);
  p.line(sm, 0.85, undefined, 0.25, true);
  // 球鞋的鞋底線
  if (!dark) p.line([at2(an, ff, -hl * 1.05, fd, a * 0.7), at2(an, ff, fl * 1.0, fd, a * 0.66)], 0.6);
}

function drawShoeFront(p: Pen, J: Sk, i: 0 | 1, rg: Rig, lk: Look, hp: number) {
  const g = J.heel[i], sg = i === 0 ? -1 : 1;
  const w = rg.foot * hp * 0.28, hgt = rg.ankleH * hp * 1.05;
  const pts = [[-w * 0.9, 0], [-w, -hgt * 0.7], [-w * 0.4, -hgt * 1.25], [w * 0.4, -hgt * 1.25], [w, -hgt * 0.7], [w * 0.9, 0]].map(([x, y]) => ({ x: g.x + x! + sg * w * 0.25, y: g.y + y! }));
  const sm = smoothPts(pts, true, 3);
  p.fill(sm, lk.wed || lk.om ? lk.ink.dark : lk.ink.fill);
  p.line(sm, 0.8, undefined, 0.25, true);
}

// ---------------------------------------------------------------- 軀幹（側面）
function drawTorsoSide(p: Pen, J: Sk, rg: Rig, lk: Look, hp: number) {
  const rs = rg.side;
  // 褲子的臀部
  if (lk.pants) {
    const t = tube([J.bottom, J.pelvis, J.waist], [rs.pelvis * hp * 0.8, rs.pelvis * hp, rs.waist * hp], 0);
    p.fill(polyOf(t), lk.pants);
    p.line(t.L, 1); p.line(t.R, 1);
  }
  const hem = at(J.pelvis, J.up1, lk.wed ? -0.03 * hp : 0.03 * hp);
  if (lk.om && lk.wed) {
    // 白紗的上身：肩頸是皮膚，胸口以下是禮服（一字領）
    const sk = tube([J.waist, J.chest, J.neck], [rs.waist * hp, rs.chest * hp, rs.neck * hp], 0.02);
    p.fill(polyOf(sk), lk.ink.skin);
    p.line(sk.L); p.line(sk.R);
    const top = at(J.chest, J.up2, 0.04 * hp);
    const b = tube([at(J.pelvis, J.up1, 0.02 * hp), J.waist, top], [rs.waist * hp * 1.06, rs.waist * hp * 1.02, rs.chest * hp * 1.05], 0);
    const poly = polyOf(b);
    p.fill(poly, lk.ink.light);
    p.line(b.L); p.line(b.R);
    const e0 = b.L[b.L.length - 1]!, e1 = b.R[b.R.length - 1]!;
    p.curve([e0, at(mixP(e0, e1, 0.5), J.up2, 0.012 * hp), e1], 0.8, lk.ink.feat);
    return;
  }
  const shirt = tube([hem, J.waist, J.chest, J.neck], [rs.pelvis * hp * 1.02, rs.waist * hp * 1.08, rs.chest * hp * 1.04, rs.neck * hp], 0.03);
  const poly = polyOf(shirt);
  topFill(p, lk, poly, J.chest, J.up2, hp);
  p.line(shirt.L); p.line(shirt.R);
  const h0 = shirt.L[0]!, h1 = shirt.R[0]!;
  p.line([h0, h1], 0.85);
  if (lk.wed) {
    // 西裝：翻領（白襯衫的 V）、領結
    const fr = J.f2;
    const throat = at2(J.neck, fr, rs.neck * hp * 0.7, J.up2, -0.005 * hp);
    const vB = at2(J.waist, fr, rs.waist * hp * 0.95, J.up2, 0.05 * hp);
    const vT = at2(J.neck, fr, rs.neck * hp * 0.1, J.up2, -0.01 * hp);
    const v = [throat, vB, at2(J.chest, fr, rs.chest * hp * 0.55, J.up2, 0.0), vT];
    p.fill(smoothPts(v, true, 2), lk.ink.light);
    p.line([vT, at2(J.chest, fr, rs.chest * hp * 0.5, J.up2, -0.01 * hp), vB], 0.7, lk.ink.paper ? lk.ink.ground : undefined);
    bowTie(p, at(throat, fr, 0.004 * hp), J.up2, hp, lk);
  } else {
    // 領口
    const f = J.f2;
    p.curve([at2(J.neck, f, rs.neck * hp * 0.85, J.up2, 0.005 * hp), at2(J.neck, f, rs.neck * hp * 0.3, J.up2, -0.022 * hp), at2(J.neck, f, -rs.neck * hp * 0.5, J.up2, -0.006 * hp)], 0.7);
  }
  if (lk.bag) {
    // 斜背小包：背帶從肩膀斜過胸口，包包在前面的腰側
    const s0 = at2(J.neck, J.f2, -rs.neck * hp * 0.6, J.up2, 0.004 * hp);
    const b0 = at2(J.pelvis, J.f1, rs.pelvis * hp * 0.9, J.up1, 0.035 * hp);
    p.line([s0, mixP(s0, b0, 0.5), b0], 0.9);
    bag(p, at(b0, J.up1, -0.012 * hp), J.up1, hp, lk);
  }
}

function bowTie(p: Pen, o: Pt, up: Pt, hp: number, lk: Look) {
  const f = fwd(up), s = 0.022 * hp;
  const L = [at2(o, f, 0, up, s * 0.3), at2(o, f, -s * 0.3, up, s * 0.9), at2(o, f, -s * 0.15, up, -s * 0.2), at2(o, f, 0, up, -s * 0.3), at2(o, f, -s * 0.2, up, -s * 1.0), at2(o, f, 0.2 * s, up, 0)];
  p.fill(L, lk.ink.dark);
  p.line(L.concat([L[0]!]), 0.6, undefined, 0.2, true);
}

function bag(p: Pen, o: Pt, up: Pt, hp: number, lk: Look) {
  const f = fwd(up), w = 0.05 * hp, hh2 = 0.04 * hp;
  const pts = [at2(o, f, -w * 0.5, up, hh2 * 0.5), at2(o, f, w * 0.55, up, hh2 * 0.5), at2(o, f, w * 0.6, up, -hh2 * 0.5), at2(o, f, -w * 0.45, up, -hh2 * 0.55)];
  const sm = smoothPts(pts, true, 2);
  p.fill(sm, lk.ink.dark);
  p.line(sm, 0.85, undefined, 0.2, true);
  p.line([at2(o, f, -w * 0.5, up, hh2 * 0.15), at2(o, f, w * 0.55, up, hh2 * 0.1)], 0.5, lk.ink.paper ? lk.ink.ground : lk.ink.soft);
}

// ---------------------------------------------------------------- 頭（側面）
// 頭的輪廓（單位 = 頭高，x 往面向、y 向下，原點在頭的中心）；從後頸繞過頭頂、臉，到下顎角（下顎角 → 後頸是脖子的開口，不畫線）
const HEAD_SIDE: Record<Who, readonly (readonly [number, number])[]> = {
  alan: [[-0.2, 0.32], [-0.36, 0.14], [-0.42, -0.08], [-0.36, -0.32], [-0.18, -0.47], [0.08, -0.49], [0.26, -0.38], [0.33, -0.18], [0.34, -0.06],
    [0.37, 0.02], [0.41, 0.1], [0.35, 0.15], [0.35, 0.2], [0.33, 0.25], [0.31, 0.33], [0.25, 0.42], [0.1, 0.45], [-0.04, 0.36]],
  omena: [[-0.2, 0.32], [-0.36, 0.14], [-0.41, -0.08], [-0.35, -0.32], [-0.18, -0.46], [0.06, -0.48], [0.24, -0.38], [0.31, -0.18], [0.32, -0.06],
    [0.34, 0.02], [0.37, 0.09], [0.32, 0.14], [0.32, 0.19], [0.3, 0.24], [0.28, 0.32], [0.21, 0.41], [0.08, 0.43], [-0.04, 0.35]],
};
// 頭髮（側面）：宣文短髮（前面一撮翹起）；孟庭及肩（有薄瀏海，下半截會被甩）
const HAIR_SIDE: Record<Who, readonly (readonly [number, number])[]> = {
  alan: [[0.28, -0.3], [0.35, -0.42], [0.24, -0.55], [0.02, -0.6], [-0.22, -0.55], [-0.4, -0.38], [-0.46, -0.12], [-0.42, 0.1], [-0.33, 0.24],
    [-0.22, 0.2], [-0.16, 0.0], [-0.04, -0.1], [0.05, -0.06], [0.08, 0.05], [0.12, -0.14], [0.19, -0.27]],
  omena: [[0.33, -0.2], [0.32, -0.34], [0.2, -0.5], [-0.02, -0.57], [-0.26, -0.5], [-0.43, -0.3], [-0.49, -0.02], [-0.48, 0.34], [-0.47, 0.66],
    [-0.42, 0.88], [-0.3, 0.97], [-0.2, 0.9], [-0.13, 0.66], [-0.08, 0.36], [0.02, 0.1], [0.08, -0.1], [0.2, -0.14], [0.31, -0.11]],
};

function headXf(J: Sk, H: number) {
  const a = J.headAng, cs = Math.cos(a), sn = Math.sin(a);
  return (x: number, y: number): Pt => ({ x: J.head.x + (x * cs - y * sn) * H, y: J.head.y + (x * sn + y * cs) * H });
}

function drawNeck(p: Pen, J: Sk, rg: Rig, hp: number, lk: Look, front: boolean) {
  const rs = front ? rg.front : rg.side;
  const r0 = front ? rs.neck * hp * 1.1 : rg.side.neck * hp * 0.62, r1 = front ? rs.neck * hp : rg.side.neckTop * hp;
  const t = tube([at(J.neck, J.up2, -0.01 * hp), at(J.neckTop, vv(PI - J.headAng), 0.015 * hp)], [r0, r1], 0);
  p.fill(polyOf(t), lk.ink.skin);
  p.line(t.L, 0.85); p.line(t.R, 0.85);
}

function drawHeadSide(p: Pen, J: Sk, rg: Rig, lk: Look, hp: number) {
  const H = rg.head * hp, X = headXf(J, H);
  const outline = HEAD_SIDE[lk.who].map(([x, y]) => X(x, y));
  const sm = smoothPts(outline, false, 3);
  p.fill(smoothPts(outline, true, 3), lk.ink.skin);
  p.line(sm, 1, undefined, 0.45);
  const om = lk.om, f = lk.face, fe = lk.ink.feat;
  // 耳朵（宣文；孟庭的被頭髮蓋住）
  if (!om) p.curve([X(0.0, -0.06), X(-0.08, -0.09), X(-0.12, 0.0), X(-0.08, 0.1), X(-0.01, 0.1)], 0.62, fe);
  // 眼睛：宣文笑起來瞇眼（∩），孟庭是點＋一根睫毛
  const ex = 0.2, ey = -0.02;
  if (f === 'closed') p.curve([X(ex - 0.05, ey - 0.01), X(ex, ey + 0.025), X(ex + 0.05, ey - 0.01)], 0.6, fe);
  else if (!om && (f === 'smile' || f === 'grin') || om && f === 'grin') p.curve([X(ex - 0.05, ey + 0.01), X(ex, ey - 0.03), X(ex + 0.05, ey + 0.01)], 0.64, fe);
  else {
    p.dot(X(ex + 0.01, ey), H * 0.028, fe);
    if (om) p.line([X(ex + 0.035, ey - 0.03), X(ex + 0.08, ey - 0.055)], 0.45, fe);
  }
  // 眉
  p.curve(om ? [X(0.14, -0.12), X(0.2, -0.145), X(0.27, -0.13)] : [X(0.13, -0.115), X(0.2, -0.135), X(0.27, -0.12)], om ? 0.5 : 0.62, fe);
  // 嘴
  if (f === 'grin') {
    const m = [X(0.34, 0.2), X(0.22, 0.2), X(0.27, 0.27), X(0.32, 0.26)];
    p.fill(smoothPts(m, true, 2), fe);
  } else if (f === 'o') {
    const m: Pt[] = [];
    for (let k = 0; k <= 10; k++) m.push(X(0.31 + Math.cos((k / 10) * TAU) * 0.035, 0.23 + Math.sin((k / 10) * TAU) * 0.04));
    p.line(m, 0.55, fe, 0.2, true);
  } else if (f === 'calm') p.line([X(0.32, 0.225), X(0.26, 0.225)], 0.55, fe);
  else p.curve([X(0.33, 0.215), X(0.29, 0.235), X(0.24, 0.21)], 0.6, fe);
  if (lk.shades) {
    const g = [X(0.13, -0.08), X(0.29, -0.08), X(0.28, 0.03), X(0.15, 0.04)];
    p.fill(g, lk.ink.dark);
    p.line(g.concat([g[0]!]), 0.6, fe, 0.2, true);
    p.line([X(0.13, -0.06), X(-0.04, -0.04)], 0.6, fe);
  }
}

function drawHairSide(p: Pen, J: Sk, rg: Rig, lk: Look, hp: number) {
  const H = rg.head * hp, X = headXf(J, H);
  const fl = lk.flow, t = lk.t;
  // 孟庭的頭髮下半截：被甩（flow）＋ 一點點隨時間的飄動；頭往後仰時頭髮往下垂（重力）
  const g = Math.sin(J.headAng);
  const pts = HAIR_SIDE[lk.who].map(([x, y]) => {
    if (!lk.om || y < 0.3) return X(x, y);
    const w = clamp((y - 0.3) / 0.7);
    const sway = -fl * 0.35 * w + Math.sin(t * 2.3 + y * 3) * 0.02 * w;
    const base = X(x + sway, y);
    // 頭倒過來時（下腰）末端往下掉
    return { x: base.x, y: base.y + Math.max(0, -g) * 0.3 * H * w };
  });
  const sm = smoothPts(pts, true, 3);
  p.fill(sm, lk.ink.dark);
  p.line(sm, 1, undefined, 0.3, true);
  // 髮絲
  if (lk.om) {
    p.curve([X(0.12, -0.44), X(0.24, -0.3), X(0.27, -0.14)], 0.42, lk.ink.paper ? lk.ink.ground : lk.ink.soft);
    p.curve([X(-0.1, -0.48), X(-0.34, -0.26), X(-0.38, 0.2), X(-0.36 - fl * 0.12, 0.6)], 0.42, lk.ink.paper ? lk.ink.ground : lk.ink.soft);
  } else {
    p.curve([X(0.25, -0.44), X(0.0, -0.5), X(-0.28, -0.38)], 0.42, lk.ink.paper ? lk.ink.ground : lk.ink.soft);
    p.curve([X(0.12, -0.36), X(-0.12, -0.36), X(-0.34, -0.18)], 0.4, lk.ink.paper ? lk.ink.ground : lk.ink.soft);
  }
}

function drawVeilSide(p: Pen, J: Sk, rg: Rig, lk: Look, hp: number) {
  const H = rg.head * hp, X = headXf(J, H);
  const root = X(-0.28, -0.42), low = X(-0.44, 0.08);
  const fl = lk.flow, t = lk.t;
  // 頭紗往下垂到腰，被甩的時候往身後水平飄；邊緣一直有一點點波動
  const len = 0.5 * hp;
  const ang = -(0.25 + fl * 1.0);
  const dir = { x: Math.sin(ang), y: Math.cos(ang) };
  const side = { x: -dir.y, y: dir.x };
  const wv = (k: number) => Math.sin(t * 3.1 + k * 4.2) * 0.02 * hp * (0.5 + Math.abs(fl));
  const tip = at(root, dir, len);
  const pts = [
    root, at2(root, dir, len * 0.35, side, 0.03 * hp + wv(1)), at2(root, dir, len * 0.7, side, 0.05 * hp + wv(2)), at(tip, side, 0.07 * hp + wv(3)),
    at(tip, side, -0.05 * hp + wv(4)), at2(low, dir, len * 0.6, side, -0.06 * hp + wv(5)), at2(low, dir, len * 0.25, side, -0.02 * hp), low,
  ];
  const sm = smoothPts(pts, true, 3);
  p.fill(sm, lk.ink.light, 0.55);
  p.line(sm, 0.7, lk.ink.soft, 0.3, true);
  p.curve([mixP(root, low, 0.5), at2(root, dir, len * 0.55, side, wv(6)), at(tip, side, 0.01 * hp + wv(7))], 0.45, lk.ink.soft);
}

/** 白紗的裙子：把腰、臀、膝、腳踝包起來的凸包再修圓，落地；轉圈時張開（flare）、被甩（flow）。 */
function skirtPts(J: Sk, rg: Rig, lk: Look, hp: number): Pt[] {
  const rs = lk.front ? rg.front : rg.side;
  const fl = lk.flare, flow = lk.flow;
  const pts: Pt[] = [];
  const wr = rs.waist * hp * 1.08;
  pts.push(at(J.waist, J.f1, wr), at(J.waist, J.f1, -wr));
  const hr = rs.pelvis * hp * 1.25;
  pts.push(at2(J.pelvis, J.f1, hr, J.up1, -0.02 * hp), at2(J.pelvis, J.f1, -hr * 1.05, J.up1, -0.02 * hp));
  const spread = 0.12 * hp + fl * 0.3 * hp;
  for (const i of [0, 1] as const) {
    pts.push(at(J.kn[i], J.f1, rg.leg[1] * hp * 2.2), at(J.kn[i], J.f1, -rg.leg[1] * hp * 2.2));
    const g = J.heel[i], tp = J.toe[i];
    const lift = fl * 0.12 * hp;
    pts.push({ x: tp.x + spread * (lk.front ? (i ? 1 : -1) : 1) - flow * 0.06 * hp, y: tp.y + 0.004 * hp - lift });
    pts.push({ x: g.x - spread * (lk.front ? (i ? -1 : 1) : 1.25) - flow * 0.16 * hp, y: g.y + 0.004 * hp - lift * 0.6 });
  }
  return hull(pts);
}
function hull(ps: Pt[]): Pt[] {
  const p = ps.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
function drawSkirt(p: Pen, J: Sk, rg: Rig, lk: Look, hp: number) {
  const hl = skirtPts(J, rg, lk, hp);
  const sm = smoothPts(hl, true, 6);
  // 裙襬的波浪：靠近下緣的點上下起伏（轉圈、被甩時更明顯）
  let lo = -Infinity;
  for (const q of sm) lo = Math.max(lo, q.y);
  const wv = 0.01 * hp * (0.35 + lk.flare * 1.4 + Math.abs(lk.flow) * 0.6);
  for (const q of sm) {
    const k = clamp(1 - (lo - q.y) / (0.14 * hp));
    if (k > 0) q.y -= k * wv * (0.5 + 0.5 * Math.sin(q.x / (0.035 * hp) + lk.t * 5));
  }
  p.fill(sm, lk.ink.light);
  p.line(sm, 1, undefined, 0.2, true);
  // 皺褶：從腰往下擺散開
  let lowY = -Infinity;
  for (const q of sm) lowY = Math.max(lowY, q.y);
  const bottom = sm.filter((q) => q.y > lowY - 0.05 * hp);
  if (bottom.length < 2) return;
  let bx0 = Infinity, bx1 = -Infinity;
  for (const q of bottom) { bx0 = Math.min(bx0, q.x); bx1 = Math.max(bx1, q.x); }
  for (let k = 1; k <= 3; k++) {
    const u = k / 4;
    const top = at(J.waist, J.f1, (u - 0.5) * 2 * rg.side.waist * hp * 0.8);
    const bot = { x: lerp(bx0, bx1, u) + Math.sin(lk.t * 2 + k) * 0.006 * hp, y: lowY - 0.012 * hp };
    p.curve([at(top, J.up1, -0.04 * hp), mixP(top, bot, 0.55), bot], 0.42, lk.ink.faint);
  }
}

function drawSide(p: Pen, J: Sk, rg: Rig, lk: Look, ps: Pose, hp: number) {
  const gown = lk.om && lk.wed;
  if (gown && lk.body) { p.part(R_VEIL); drawVeilSide(p, J, rg, lk, hp); }
  if (lk.armB) { p.part(R_ARMB); drawArm(p, J, 1, rg, lk, ps, hp); }
  if (lk.body) {
    if (!gown) {
      p.part(R_LEGB); drawLeg(p, J, 1, rg, lk, hp);
      p.part(R_LEGA); drawLeg(p, J, 0, rg, lk, hp);
    } else {
      p.part(R_SKIRT); drawSkirt(p, J, rg, lk, hp);
    }
    p.part(R_TORSO); drawTorsoSide(p, J, rg, lk, hp);
    p.part(R_HEAD); drawNeck(p, J, rg, hp, lk, false); drawHeadSide(p, J, rg, lk, hp);
    p.part(R_HAIR); drawHairSide(p, J, rg, lk, hp);
  }
  if (lk.armA) { p.part(R_ARMA); drawArm(p, J, 0, rg, lk, ps, hp); }
}

// ---------------------------------------------------------------- 正面
const FACE_FRONT: Record<Who, { rx: number; jaw: number }> = { alan: { rx: 0.41, jaw: 0.86 }, omena: { rx: 0.36, jaw: 0.74 } };
const HAIR_FRONT_ALAN: readonly (readonly [number, number])[] = [[-0.43, 0.02], [-0.47, -0.24], [-0.32, -0.5], [0.0, -0.6], [0.3, -0.52], [0.47, -0.28], [0.44, 0.02],
  [0.39, -0.14], [0.3, -0.26], [0.12, -0.28], [-0.06, -0.34], [-0.14, -0.27], [-0.3, -0.24], [-0.39, -0.12]];
const HAIR_FRONT_OM_BACK: readonly (readonly [number, number])[] = [[-0.46, -0.2], [-0.36, -0.5], [0.0, -0.6], [0.36, -0.5], [0.46, -0.2], [0.46, 0.2], [0.5, 0.56],
  [0.6, 0.8], [0.47, 0.85], [0.33, 0.74], [0.26, 0.4], [-0.26, 0.4], [-0.33, 0.74], [-0.47, 0.85], [-0.6, 0.8], [-0.5, 0.56], [-0.46, 0.2]];
const HAIR_FRONT_OM_TOP: readonly (readonly [number, number])[] = [[-0.4, 0.1], [-0.44, -0.24], [-0.32, -0.5], [0.0, -0.6], [0.32, -0.5], [0.44, -0.24], [0.4, 0.1],
  [0.33, -0.14], [0.2, -0.13], [0.06, -0.11], [-0.08, -0.12], [-0.22, -0.13], [-0.33, -0.14]];

function faceOutline(who: Who, X: (x: number, y: number) => Pt): Pt[] {
  const { rx, jaw } = FACE_FRONT[who];
  const out: Pt[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    // 下半臉收窄成下巴（圓臉收得少）
    const w = s > 0 ? lerp(1, jaw, s * s) : 1;
    out.push(X(c * rx * w, s * 0.5));
  }
  return out;
}

function drawHeadFront(p: Pen, J: Sk, rg: Rig, lk: Look, hp: number) {
  const H = rg.head * hp, X = headXf(J, H);
  const om = lk.om, f = lk.face, fe = lk.ink.feat;
  if (!om) {
    for (const s of [-1, 1]) {
      const ear = [X(s * 0.38, -0.08), X(s * 0.49, -0.1), X(s * 0.5, 0.06), X(s * 0.4, 0.12)];
      p.fill(smoothPts(ear, true, 2), lk.ink.skin);
      p.curve(ear, 0.75);
    }
  }
  const face = faceOutline(lk.who, X);
  const sm = smoothPts(face, true, 2);
  p.fill(sm, lk.ink.skin);
  p.line(sm, 1, undefined, 0.2, true);
  const ey = -0.02, ex = om ? 0.15 : 0.16;
  for (const s of [-1, 1]) {
    const cx = s * ex;
    if (f === 'closed') p.curve([X(cx - 0.05, ey - 0.01), X(cx, ey + 0.025), X(cx + 0.05, ey - 0.01)], 0.58, fe);
    else if (!om && (f === 'smile' || f === 'grin') || om && f === 'grin') p.curve([X(cx - 0.05, ey + 0.012), X(cx, ey - 0.03), X(cx + 0.05, ey + 0.012)], 0.62, fe);
    else { p.dot(X(cx, ey), H * 0.028, fe); if (om) p.line([X(cx + s * 0.04, ey - 0.025), X(cx + s * 0.075, ey - 0.05)], 0.42, fe); }
    p.curve(om ? [X(cx - s * 0.06, -0.12), X(cx, -0.145), X(cx + s * 0.06, -0.125)] : [X(cx - s * 0.06, -0.115), X(cx, -0.135), X(cx + s * 0.07, -0.115)], om ? 0.46 : 0.58, fe);
  }
  if (f === 'grin') {
    const m = [X(-0.1, 0.19), X(0.1, 0.19), X(0.0, 0.29)];
    p.fill(smoothPts(m, true, 3), fe);
  } else if (f === 'o') {
    const m: Pt[] = [];
    for (let k = 0; k <= 10; k++) m.push(X(Math.cos((k / 10) * TAU) * 0.04, 0.23 + Math.sin((k / 10) * TAU) * 0.045));
    p.line(m, 0.55, fe, 0.2, true);
  } else if (f === 'calm') p.line([X(-0.05, 0.22), X(0.05, 0.22)], 0.55, fe);
  else p.curve([X(-0.08, 0.2), X(0, 0.245), X(0.08, 0.2)], 0.58, fe);
  if (lk.shades) {
    for (const s of [-1, 1]) {
      const g = [X(s * 0.05, -0.08), X(s * 0.27, -0.08), X(s * 0.25, 0.04), X(s * 0.07, 0.04)];
      p.fill(g, lk.ink.dark);
      p.line(g.concat([g[0]!]), 0.6, fe, 0.2, true);
    }
    p.line([X(-0.05, -0.06), X(0.05, -0.06)], 0.6, fe);
  }
  if (!om) {
    const hr = smoothPts(HAIR_FRONT_ALAN.map(([x, y]) => X(x, y)), true, 3);
    p.fill(hr, lk.ink.dark);
    p.line(hr, 1, undefined, 0.3, true);
    p.curve([X(-0.06, -0.33), X(0.16, -0.46), X(0.36, -0.38)], 0.4, lk.ink.paper ? lk.ink.ground : lk.ink.soft);
  } else {
    const hr = smoothPts(HAIR_FRONT_OM_TOP.map(([x, y]) => X(x, y)), true, 3);
    p.fill(hr, lk.ink.dark);
    p.line(hr, 1, undefined, 0.3, true);
    p.curve([X(-0.02, -0.5), X(0.1, -0.3), X(0.08, -0.12)], 0.4, lk.ink.paper ? lk.ink.ground : lk.ink.soft);
    p.curve([X(-0.14, -0.48), X(-0.2, -0.3), X(-0.24, -0.13)], 0.4, lk.ink.paper ? lk.ink.ground : lk.ink.soft);
  }
}

function drawHairBackFront(p: Pen, J: Sk, rg: Rig, lk: Look, hp: number) {
  const H = rg.head * hp, X = headXf(J, H);
  const fl = lk.flow, t = lk.t;
  const pts = HAIR_FRONT_OM_BACK.map(([x, y]) => {
    const w = clamp((y - 0.2) / 0.7);
    return X(x + (-fl * 0.25 + Math.sin(t * 2.1 + x * 3) * 0.015) * w, y);
  });
  const sm = smoothPts(pts, true, 3);
  p.fill(sm, lk.ink.dark);
  p.line(sm, 1, undefined, 0.3, true);
}

function drawVeilFront(p: Pen, J: Sk, rg: Rig, lk: Look, hp: number) {
  const H = rg.head * hp, X = headXf(J, H);
  const fl = lk.flow, t = lk.t;
  const w = (k: number) => Math.sin(t * 2.7 + k * 3.3) * 0.012 * hp;
  const pts = [X(-0.3, -0.42), X(0.3, -0.42), X(0.46, 0.3), { x: J.waist.x + 0.14 * hp + w(1) - fl * 0.08 * hp, y: J.waist.y + 0.02 * hp }, { x: J.waist.x - 0.14 * hp + w(2) - fl * 0.08 * hp, y: J.waist.y + 0.02 * hp }, X(-0.46, 0.3)];
  const sm = smoothPts(pts, true, 4);
  p.fill(sm, lk.ink.light, 0.4);
  p.line(sm, 0.6, lk.ink.soft, 0.3, true);
}

/** 正面上身的輪廓：頸根 → 斜肩 → 肩頭 → 腋下 → 腰 → 下擺（左右對稱，跟著軀幹彎）。k 放大倍數（外套比襯衫寬一點）。 */
function frontTorso(J: Sk, rg: Rig, hp: number, hem: Pt, k = 1, top = 1): Pt[] {
  const rs = rg.front, f1 = J.f1, f2 = J.f2, u1 = J.up1, u2 = J.up2;
  const nw = rs.neck * hp * 1.3, sw = rs.shoulder * hp * k, cw = rs.chest * hp * 1.02 * k, ww = rs.waist * hp * 1.05 * k, pw = rs.pelvis * hp * 1.03 * k;
  const side = (s: number): Pt[] => [
    at2(hem, f1, s * pw, u1, 0),
    at2(J.waist, f1, s * ww, u1, 0),
    at2(J.chest, f2, s * cw, u2, -0.012 * hp),
    at2(J.neck, f2, s * sw, u2, -0.052 * hp * top),
    at2(J.neck, f2, s * sw * 0.72, u2, -0.014 * hp * top),
    at2(J.neck, f2, s * nw, u2, 0.002 * hp),
  ];
  return smoothPts(side(-1).concat(side(1).reverse()), true, 3);
}

function drawTorsoFront(p: Pen, J: Sk, rg: Rig, lk: Look, hp: number) {
  const rs = rg.front;
  if (lk.pants) {
    const t = tube([J.bottom, J.pelvis, J.waist], [rs.pelvis * hp * 0.95, rs.pelvis * hp, rs.waist * hp], 0);
    p.fill(polyOf(t), lk.pants);
    p.line(t.L); p.line(t.R);
  }
  const hem = at(J.pelvis, J.up1, lk.wed ? -0.035 * hp : 0.03 * hp);
  const f = J.f2, nw = rs.neck * hp * 1.3;
  if (lk.om && lk.wed) {
    // 肩頸是皮膚、一字領的上身＋中間一點點心形
    const skin = frontTorso(J, rg, hp, J.waist, 0.98);
    p.fill(skin, lk.ink.skin);
    p.line(skin, 1, undefined, 0.2, true);
    const top = at(J.chest, J.up2, 0.03 * hp);
    const cw = rs.chest * hp * 1.02, ww = rs.waist * hp * 1.04, pw = rs.pelvis * hp * 0.9;
    const bod = smoothPts([
      at(hem, J.f1, -pw), at(J.waist, J.f1, -ww), at(top, f, -cw), at2(top, f, -cw * 0.5, J.up2, 0.012 * hp), at(top, f, 0), at2(top, f, cw * 0.5, J.up2, 0.012 * hp), at(top, f, cw), at(J.waist, J.f1, ww), at(hem, J.f1, pw),
    ], true, 3);
    p.fill(bod, lk.ink.light);
    p.line(bod, 0.85, lk.ink.feat, 0.2, true);
    return;
  }
  const poly = frontTorso(J, rg, hp, hem, lk.wed ? 1.04 : 1);
  topFill(p, lk, poly, J.chest, J.up2, hp);
  p.line(poly, 1, undefined, 0.2, true);
  if (lk.wed) {
    // 西裝：白襯衫的 V、翻領、領結、一顆扣子
    const vB = at(J.waist, J.up2, 0.07 * hp);
    const vL = at2(J.neck, f, -nw, J.up2, 0.004 * hp), vR = at2(J.neck, f, nw, J.up2, 0.004 * hp);
    p.fill([vL, vR, vB], lk.ink.light);
    const cut = lk.ink.paper ? lk.ink.ground : undefined;
    p.line([vL, vB, vR], 0.7, cut);
    for (const sg of [-1, 1]) p.line([at2(J.neck, f, sg * nw * 1.9, J.up2, -0.01 * hp), at2(J.chest, f, sg * rs.chest * hp * 0.45, J.up2, -0.02 * hp), vB], 0.55, lk.ink.paper ? lk.ink.ground : lk.ink.soft);
    p.dot(at(vB, J.up2, -0.035 * hp), 0.006 * hp, lk.ink.feat);
    const bt = at(J.neck, J.up2, -0.014 * hp), s2 = 0.022 * hp;
    const L = [bt, at2(bt, f, -s2, J.up2, s2 * 0.5), at2(bt, f, -s2, J.up2, -s2 * 0.5), bt, at2(bt, f, s2, J.up2, s2 * 0.5), at2(bt, f, s2, J.up2, -s2 * 0.5)];
    p.fill(L, lk.ink.dark);
    p.line(L.concat([L[0]!]), 0.5, undefined, 0.2, true);
  } else {
    // 領口：圓領（宣文）、小 V 領（孟庭）
    p.curve(lk.om ? [at(J.neck, f, -nw), at(J.neck, J.up2, -0.035 * hp), at(J.neck, f, nw)] : [at(J.neck, f, -nw), at(J.neck, J.up2, -0.024 * hp), at(J.neck, f, nw)], 0.75);
  }
  if (lk.bag) {
    const s0 = at2(J.neck, f, -rs.shoulder * hp * 0.6, J.up2, -0.012 * hp);
    const b0 = at2(J.pelvis, f, rs.pelvis * hp * 0.8, J.up1, 0.03 * hp);
    p.line([s0, mixP(s0, b0, 0.5), b0], 0.9);
    bag(p, b0, J.up1, hp, lk);
  }
}

function drawFront(p: Pen, J: Sk, rg: Rig, lk: Look, ps: Pose, hp: number) {
  const gown = lk.om && lk.wed;
  if (lk.body) {
    if (gown) { p.part(R_VEIL); drawVeilFront(p, J, rg, lk, hp); }
    if (!gown) {
      p.part(R_LEGA); drawLeg(p, J, 0, rg, lk, hp);
      p.part(R_LEGB); drawLeg(p, J, 1, rg, lk, hp);
    } else { p.part(R_SKIRT); drawSkirt(p, J, rg, lk, hp); }
    if (lk.om) { p.part(R_HAIR); drawHairBackFront(p, J, rg, lk, hp); }
    p.part(R_TORSO); drawTorsoFront(p, J, rg, lk, hp);
    p.part(R_HEAD); drawNeck(p, J, rg, hp, lk, true); drawHeadFront(p, J, rg, lk, hp);
  }
  if (lk.armA) { p.part(R_ARMA); drawArm(p, J, 0, rg, lk, ps, hp); }
  if (lk.armB) { p.part(R_ARMB); drawArm(p, J, 1, rg, lk, ps, hp); }
}

/**
 * 兩個人面對面抱在一起（側面）：宣文在左面向右、孟庭在右面向左，x 是兩人中間。
 * 抱要疊得對：兩個人的身體先畫（遠的那隻手都繞到對方背後、看不到），再補畫兩隻近的手——孟庭的手環著他的腰、
 * 宣文的手搭在她背上，都疊在對方身體前面。回傳兩個人的關節。
 */
export function drawHug(c: Ctx, o: { x: number; y: number; h: number; ink?: Ink; t?: number; outfit?: 'daily' | 'wedding'; reveal?: number; alpha?: number; flow?: number; gap?: number; alan?: Pose; omena?: Pose }): { alan: Joints; omena: Joints } {
  const g = (o.gap ?? 0.2) * o.h;
  const pa = o.alan ?? POSE.hug(), po = o.omena ?? POSE.hugBack();
  const base = { y: o.y, h: o.h, ink: o.ink, t: o.t, outfit: o.outfit, reveal: o.reveal, alpha: o.alpha };
  const oa: PersonOpts = { ...base, x: o.x - g / 2 }, oo: PersonOpts = { ...base, x: o.x + g / 2, dir: -1, flow: o.flow };
  const omena = drawPerson(c, 'omena', po, { ...oo, hide: ['armA', 'armB'] });
  const alan = drawPerson(c, 'alan', pa, { ...oa, hide: ['armA', 'armB'] });
  drawPerson(c, 'omena', po, { ...oo, only: 'armA' });
  drawPerson(c, 'alan', pa, { ...oa, only: 'armA' });
  return { alan, omena };
}

// ================================================================ 狗
export type DogWho = 'penpen' | 'qq';
/** 狗的高度（到耳尖，站著）相對宣文的身高。 */
export const DOG_K: Record<DogWho, number> = { penpen: 0.21, qq: 0.2 };

/**
 * 狗的姿勢：body 身體仰角（+ 前面抬高）、lift 離地（狗身高倍數）、stretch 身體伸長、head 抬頭、
 * 四條腿 fA fB（前，A = 靠鏡頭）、bA bB（後）各 [上段, 下段]（度，從往下量、+ 往前），tail 尾巴擺動 -1..1（NaN = 自己搖）、
 * mouth 張嘴 0..1、ears 耳朵往後貼 0..1、curl 捲成一團（睡覺）0..1、fluff 毛炸開 0..1、twist 甩身體（度）、eyes。
 */
export interface DogPose {
  body: number; lift: number; stretch: number; head: number;
  fA: [number, number]; fB: [number, number]; bA: [number, number]; bB: [number, number];
  tail: number; mouth: number; ears: number; curl: number; fluff: number; twist: number;
  eyes: 'open' | 'closed' | 'happy';
}
const DSTAND: DogPose = {
  body: 2, lift: 0, stretch: 0, head: 0, fA: [2, 0], fB: [-3, 0], bA: [12, -30], bB: [6, -26],
  tail: NaN, mouth: 0.15, ears: 0, curl: 0, fluff: 0, twist: 0, eyes: 'open',
};
export function dogPose(o: Partial<DogPose> = {}, base: DogPose = DSTAND): DogPose { return { ...base, ...o }; }
const l2 = (a: [number, number], b: [number, number], k: number): [number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
export function lerpDog(a: DogPose, b: DogPose, k: number): DogPose {
  return {
    body: lerp(a.body, b.body, k), lift: lerp(a.lift, b.lift, k), stretch: lerp(a.stretch, b.stretch, k), head: lerp(a.head, b.head, k),
    fA: l2(a.fA, b.fA, k), fB: l2(a.fB, b.fB, k), bA: l2(a.bA, b.bA, k), bB: l2(a.bB, b.bB, k),
    tail: Number.isNaN(a.tail) || Number.isNaN(b.tail) ? (k < 0.5 ? a.tail : b.tail) : lerp(a.tail, b.tail, k),
    mouth: lerp(a.mouth, b.mouth, k), ears: lerp(a.ears, b.ears, k), curl: lerp(a.curl, b.curl, k), fluff: lerp(a.fluff, b.fluff, k), twist: lerp(a.twist, b.twist, k),
    eyes: k < 0.5 ? a.eyes : b.eyes,
  };
}
function keyDog(p: number, keys: readonly (readonly [number, DogPose])[]): DogPose {
  if (p <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [p1, b] = keys[i]!;
    if (p <= p1) { const [p0, a] = keys[i - 1]!; return lerpDog(a, b, ease.inOutCubic((p - p0) / Math.max(1e-6, p1 - p0))); }
  }
  return keys[keys.length - 1]![1];
}

/** 狗的姿勢庫（側面、面向右）。φ 循環相位；p 動作進度（0 = 那一下）。 */
export const DOG = {
  stand: () => dogPose(),
  /** 小跑步：對角的兩隻腳一起動，φ 一圈兩步（`trot(f.beat / 2)` 一拍一步）。每圈前進 `DOG_STRIDE.trot * h`。 */
  trot: (ph: number) => {
    const s = Math.sin(TAU * ph), s2 = Math.sin(TAU * ph + PI);
    const lf = (x: number) => [22 * x, -34 * Math.max(0, x)] as [number, number];
    const lb = (x: number) => [12 - 22 * x, -30 - 26 * Math.max(0, x)] as [number, number];
    return dogPose({ body: 3, head: 4 + 3 * Math.abs(s), fA: lf(s), bB: lb(-s), fB: lf(s2), bA: lb(-s2), lift: 0.03 * Math.abs(Math.cos(TAU * ph)), mouth: 0.35, eyes: 'happy' });
  },
  /** 奔跑（跑跳步 gallop）：φ 一圈一跨；身體一伸一縮、伸展時離地。每圈前進 `DOG_STRIDE.run * h`。 */
  run: (ph: number) => {
    const c = Math.cos(TAU * ph);
    return dogPose({
      body: 4 * c, stretch: 0.14 * c, head: 2 - 4 * c, lift: 0.16 * Math.max(0, c) ** 2,
      fA: [48 * c - 4, -56 * Math.max(0, -c)], fB: [44 * c - 10, -60 * Math.max(0, -c)],
      bA: [-40 * c + 14, -20 - 40 * Math.max(0, c)], bB: [-36 * c + 8, -24 - 40 * Math.max(0, c)],
      ears: 0.7, mouth: 0.55, eyes: 'happy',
    });
  },
  sit: () => dogPose({ body: 40, head: -34, fA: [-6, 0], fB: [0, 0], bA: [86, -168], bB: [80, -164], mouth: 0.3, eyes: 'happy' }),
  /** 跳（**0 = 最高點**，接球／接飛盤在這一刻）。hgt 狗身高的倍數。 */
  jump: (p: number, hgt = 1.1) => {
    const k = keyDog(p, [
      [-1, dogPose()],
      [-0.5, dogPose({ body: -8, head: 4, fA: [30, -60], fB: [26, -56], bA: [40, -80], bB: [36, -76], ears: 0.3 })],
      [-0.28, dogPose({ body: 34, head: 16, fA: [60, -40], fB: [56, -46], bA: [-40, -10], bB: [-44, -12], stretch: 0.12, ears: 0.8 })],
      [0, dogPose({ body: 22, head: 22, fA: [80, -70], fB: [74, -76], bA: [-20, -36], bB: [-26, -40], stretch: 0.06, mouth: 0.8, ears: 0.5 })],
      [0.3, dogPose({ body: -18, head: 0, fA: [30, 0], fB: [24, 0], bA: [30, -40], bB: [26, -44], ears: 0.4 })],
      [0.55, dogPose({ body: -4, fA: [10, -20], fB: [6, -20], bA: [30, -70], bB: [26, -66] })],
      [1, dogPose()],
    ]);
    k.lift = Math.abs(p) < 0.33 ? hgt * (1 - (p / 0.33) ** 2) : 0;
    return k;
  },
  /** 趴著（前腳往前伸）。 */
  lie: () => dogPose({ body: 0, head: 6, fA: [84, 6], fB: [80, 8], bA: [88, -172], bB: [84, -170], mouth: 0.1 }),
  /** 睡覺：捲成一團，眼睛閉起來，尾巴繞到前面。 */
  sleep: () => dogPose({ body: 0, head: -34, stretch: -0.3, fA: [84, 6], fB: [80, 8], bA: [88, -172], bB: [84, -170], mouth: 0, curl: 1, eyes: 'closed', tail: 0 }),
  /** 討：後腳站起來、前腳縮在胸前。 */
  beg: () => dogPose({ body: 70, head: -52, fA: [50, -110], fB: [44, -104], bA: [-62, -50], bB: [-66, -48], mouth: 0.5, eyes: 'happy' }),
  /** 甩水（φ 一次甩一來一回）：身體扭、毛炸開、耳朵甩。 */
  shake: (ph: number) => { const s = Math.sin(TAU * ph * 2); return dogPose({ twist: 10 * s, head: -8 * s, fluff: 1, ears: 0.5 + 0.5 * s, mouth: 0.2, eyes: 'closed' }); },
  /** 前趴（想玩：屁股翹高、前腳趴低）。 */
  play: () => dogPose({ body: -22, head: 30, fA: [70, -10], fB: [66, -8], bA: [14, -30], bB: [10, -28], mouth: 0.7, eyes: 'happy' }),
  /** 仰頭叫。 */
  howl: () => dogPose({ body: 30, head: 50, fA: [-4, 0], fB: [0, 0], bA: [86, -168], bB: [80, -164], mouth: 0.9, ears: 0.6, eyes: 'closed' }),
};
/** 狗走一圈前進多少（乘上 h）。 */
export const DOG_STRIDE = { trot: 0.2, run: 0.5 };

export interface DogOpts {
  x: number; y: number;
  /** 場景尺度（宣文的身高 px），跟人用同一個值。 */
  h: number;
  dir?: 1 | -1;
  view?: 'side' | 'front';
  ink?: Ink;
  t?: number;
  reveal?: number;
  alpha?: number;
  spin?: number;
  /** 尾巴位置 -1..1；不給就依 t 自己搖（每秒約 2.2 下）。 */
  wag?: number;
  /** 嘴裡叼著網球。 */
  ball?: boolean;
  lw?: number;
}
export interface DogJoints {
  nose: Pt; mouth: Pt; head: Pt; top: Pt; collar: Pt; back: Pt; tail: Pt; paws: [Pt, Pt, Pt, Pt];
  bbox: [number, number, number, number]; pen: Pt | null; facing: 1 | -1;
}

interface DogSk {
  hip: Pt; sh: Pt; ax: Pt; up: Pt; neck: Pt; hc: Pt; hax: Pt; hup: Pt;
  legs: { root: Pt; knee: Pt; paw: Pt; ang: number }[]; // fA fB bA bB
  tailRoot: Pt; s: number;
}

/** 狗的幾何單位 → 「站著到耳尖 = 1」。 */
const DOG_NORM = 1.3;

function solveDog(ps: DogPose, s: number): DogSk {
  const B = (ps.body + ps.twist) * D;
  const ax = { x: Math.cos(B), y: -Math.sin(B) };
  const up = { x: ax.y, y: -ax.x };
  const bl = 0.36 * s * (1 + ps.stretch);
  const hip = { x: -bl * 0.5, y: 0 };
  const sh = at(hip, ax, bl);
  const legs: DogSk['legs'] = [];
  // 腿很短，大半藏在毛裡：根部在身體下緣附近
  const roots = [at(sh, up, -0.1 * s), at2(sh, up, -0.09 * s, ax, -0.035 * s), at2(hip, up, -0.08 * s, ax, 0.035 * s), at(hip, up, -0.07 * s)];
  const segs = [[0.11, 0.11], [0.11, 0.11], [0.12, 0.11], [0.12, 0.11]];
  [ps.fA, ps.fB, ps.bA, ps.bB].forEach((l, i) => {
    const a1 = l[0] * D, a2 = a1 + l[1] * D;
    const knee = at(roots[i]!, vv(a1), segs[i]![0]! * s);
    const paw = at(knee, vv(a2), segs[i]![1]! * s);
    legs.push({ root: roots[i]!, knee, paw, ang: a2 });
  });
  const HB = B + ps.head * D;
  const hax = { x: Math.cos(HB), y: -Math.sin(HB) };
  const hup = { x: hax.y, y: -hax.x };
  const neck = at2(sh, ax, 0.08 * s, up, lerp(0.15, 0.05, ps.curl) * s);
  const hc = at2(neck, hax, 0.06 * s, hup, lerp(0.08, 0.02, ps.curl) * s);
  const tailRoot = at2(hip, ax, -0.13 * s, up, 0.08 * s);
  return { hip, sh, ax, up, neck, hc, hax, hup, legs, tailRoot, s };
}

/**
 * 毛茸茸的輪廓：沿著封閉的點往外長出一撮一撮的毛。每一撮是「慢慢長出、很快收回」的鋸齒（毛順著同一個方向），
 * 尖端稍微圓一點；ph 每 1/8 秒變一次（boiling）。amp 是毛的長度。
 */
function tufts(pts: Pt[], amp: number, count: number, ph: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = pts[(i + 1) % n]!, o = pts[(i - 1 + n) % n]!;
    let nx = q.y - o.y, ny = -(q.x - o.x);
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    if (nx * (p.x - cx) + ny * (p.y - cy) < 0) { nx = -nx; ny = -ny; }
    const f = frac((i / n) * count + ph);
    const k = f < 0.62 ? Math.sin((f / 0.62) * PI * 0.5) ** 1.4 : Math.cos(((f - 0.62) / 0.38) * PI * 0.5) ** 0.8;
    out.push({ x: p.x + nx * amp * k, y: p.y + ny * amp * k });
  }
  return out;
}
function ellipsePts(c: Pt, ax: Pt, rx: number, ry: number, n = 36, a0 = 0): Pt[] {
  const ay = { x: -ax.y, y: ax.x };
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU;
    out.push(at2(c, ax, Math.cos(a) * rx, ay, Math.sin(a) * ry));
  }
  return out;
}

interface DogLook { who: DogWho; ink: Ink; t: number; wag: number; ball: boolean; fur: string; chest: string; seedPh: number }

function furBlob(p: Pen, pts: Pt[], amp: number, count: number, lk: DogLook, color: string, w = 0.8) {
  const tf = tufts(pts, amp, count, lk.seedPh);
  p.fill(tf, color);
  p.line(tf.concat([tf[0]!]), w, undefined, 0.1, true);
  return tf;
}

function drawDogLeg(p: Pen, L: DogSk['legs'][number], s: number, color: string, thick = 1) {
  const t = tube([L.root, L.knee, L.paw], [0.045 * s * thick, 0.036 * s, 0.032 * s], 0.1);
  p.fill(polyOf(t), color);
  p.line(t.L, 0.7); p.line(t.R, 0.7);
  const ff = vv(L.ang + PI / 2);
  const paw = ellipsePts(at2(L.paw, ff, 0.018 * s, vv(L.ang), 0.008 * s), ff, 0.042 * s, 0.024 * s, 14);
  p.fill(paw, color);
  p.line(paw.concat([paw[0]!]), 0.65, undefined, 0.2, true);
}

/** QQ 的頭與背比較深：在 poly 裡、軸線上方 depth 以上蓋一層淡淡的墨色＋細排線（「fur 加線條陰影」）。 */
function darkSaddle(p: Pen, poly: Pt[], o: Pt, up: Pt, ax: Pt, s: number, depth: number) {
  p.clip(poly, (c) => {
    const g0 = at(o, up, depth - 0.05 * s), g1 = at(o, up, depth + 0.06 * s);
    const gr = c.createLinearGradient(g0.x, g0.y, g1.x, g1.y);
    gr.addColorStop(0, rgba('sepia', 0)); gr.addColorStop(1, rgba('sepia', 0.3));
    c.fillStyle = gr;
    c.beginPath();
    const a = at2(o, up, depth - 0.05 * s, ax, -2 * s), b = at2(o, up, depth - 0.05 * s, ax, 2 * s), b2 = at(b, up, 2 * s), a2 = at(a, up, 2 * s);
    c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(b2.x, b2.y); c.lineTo(a2.x, a2.y); c.closePath(); c.fill();
    c.strokeStyle = p.ink.soft; c.lineWidth = p.lw * 0.32; c.beginPath();
    for (let k = -12; k <= 12; k++) {
      const q = at2(o, ax, k * 0.03 * s, up, depth + 0.02 * s + (k % 2 ? 0.02 * s : 0));
      const e = at2(q, ax, -0.02 * s, up, 0.05 * s);
      c.moveTo(q.x, q.y); c.lineTo(e.x, e.y);
    }
    c.stroke();
  });
}

function drawDogSide(p: Pen, J: DogSk, ps: DogPose, lk: DogLook) {
  const s = J.s;
  const qq = lk.who === 'qq';
  const fluffy = qq ? 1 : 1.1;
  const amp = (0.018 + 0.025 * ps.fluff) * s * fluffy;
  // rank：0 身體、1 頭、2 腳、3 尾巴
  p.part(2);
  drawDogLeg(p, J.legs[1]!, s, lk.fur);
  drawDogLeg(p, J.legs[3]!, s, lk.fur, 1.15);
  // 身體：圓滾滾的一團
  p.part(0);
  const mid = mixP(J.hip, J.sh, 0.5);
  const body = furBlob(p, ellipsePts(at2(mid, J.up, 0.01 * s, J.ax, -0.02 * s), J.ax, 0.3 * s, 0.19 * s, 90), amp, 20, lk, lk.fur);
  if (qq) darkSaddle(p, body, mid, J.up, J.ax, s, 0.06 * s);
  // 近的兩隻腳：後腿大腿是一團毛
  p.part(2);
  drawDogLeg(p, J.legs[2]!, s, lk.fur, 1.2);
  drawDogLeg(p, J.legs[0]!, s, lk.fur);
  // 尾巴：羽毛狀，從屁股往上捲、平貼在背上；搖尾巴 = 繞根部轉
  p.part(3);
  const tailAng = lk.wag * 16 * D;
  const rot = (q: Pt) => { const dx = q.x - J.tailRoot.x, dy = q.y - J.tailRoot.y, c2 = Math.cos(tailAng), s2 = Math.sin(tailAng); return { x: J.tailRoot.x + dx * c2 - dy * s2, y: J.tailRoot.y + dx * s2 + dy * c2 }; };
  const cu = ps.curl;
  // 羽毛狀的尾巴：一片往前傾、平貼在背上的橢圓（睡覺時繞到身體前面）
  const tcx = rot(at2(J.hip, J.ax, lerp(-0.04, 0.2, cu) * s, J.up, lerp(0.22, -0.15, cu) * s));
  const tAx = rot(at(tcx, { x: J.ax.x * Math.cos(0.3) - J.up.x * Math.sin(0.3), y: J.ax.y * Math.cos(0.3) - J.up.y * Math.sin(0.3) }, 1));
  const tdir = unit(tcx, tAx);
  const tail = furBlob(p, ellipsePts(tcx, cu > 0.5 ? J.ax : tdir, lerp(0.2, 0.26, cu) * s * fluffy * 0.9, lerp(0.1, 0.07, cu) * s * fluffy, 72), amp * 1.15, 16, lk, lk.fur, 0.72);
  if (qq) darkSaddle(p, tail, tcx, J.up, J.ax, s, -0.02 * s);
  // 胸前的鬃毛（QQ 白胸口）
  p.part(0);
  furBlob(p, ellipsePts(at2(J.sh, J.ax, 0.08 * s, J.up, 0.04 * s), J.ax, 0.15 * s, 0.19 * s, 70), amp * 1.2, 13, lk, lk.chest);
  // 頭
  p.part(1);
  drawDogHeadSide(p, J, ps, lk, amp);
}

function drawDogHeadSide(p: Pen, J: DogSk, ps: DogPose, lk: DogLook, amp: number) {
  const s = J.s, ink = lk.ink, qq = lk.who === 'qq';
  const X = (x: number, y: number) => at2(J.hc, J.hax, x * s, J.hup, y * s);
  const eb = ps.ears * 0.06;
  // 項圈（QQ）：下巴下面一段紅色，大半埋在毛裡
  if (qq) {
    const c0 = at2(J.neck, J.ax, -0.04 * s, J.up, 0.05 * s), c1 = at2(J.neck, J.ax, 0.07 * s, J.up, -0.06 * s);
    const band = tube([c0, mixP(c0, c1, 0.5), c1], [0.018 * s, 0.02 * s, 0.018 * s], 0);
    p.fill(polyOf(band), rgba('collar'));
    p.line(band.L, 0.5); p.line(band.R, 0.5);
    p.dot(at(c1, J.up, -0.02 * s), s * 0.016, rgba('ball'));
  }
  // 遠的耳朵
  const earF = [X(0.0, 0.08), X(0.035 - eb, 0.19 - eb * 0.5), X(0.07, 0.07)];
  p.fill(earF, lk.fur); p.line(earF.concat([earF[0]!]), 0.7, undefined, 0.2, true);
  // 頭：圓，後腦與臉頰有一點毛
  const head = furBlob(p, ellipsePts(J.hc, J.hax, 0.115 * s, 0.105 * s, 48, 1.2), amp * 0.45, 9, lk, lk.fur, 0.85);
  if (qq) {
    darkSaddle(p, head, J.hc, J.hup, J.hax, s, 0.0);
    p.fill(smoothPts([X(0.0, -0.02), X(0.08, -0.03), X(0.1, -0.08), X(0.02, -0.1), X(-0.06, -0.07)], true, 3), lk.chest);
  }
  // 近的耳朵（小小的尖三角：狐狸臉）
  const earN = [X(-0.075, 0.06), X(-0.06 - eb * 1.3, 0.185 - eb * 0.8), X(0.0, 0.085)];
  p.fill(earN, lk.fur); p.line(earN.concat([earN[0]!]), 0.75, undefined, 0.2, true);
  p.line([X(-0.055, 0.08), X(-0.052 - eb, 0.15 - eb * 0.6)], 0.4, ink.soft);
  // 嘴筒：短、尖；張嘴時下顎往下
  const mo = ps.mouth;
  const top = [X(0.06, 0.03), X(0.16, -0.01), X(0.195, -0.03), X(0.19, -0.05)];
  const jaw = [X(0.175, -0.06 - mo * 0.03), X(0.13, -0.07 - mo * 0.06), X(0.07, -0.07 - mo * 0.02)];
  const snout = smoothPts(top.concat(jaw, [X(0.04, -0.05)]), true, 2);
  p.fill(snout, qq ? lk.chest : lk.fur);
  p.line(smoothPts(top.concat(jaw), false, 2), 0.8, undefined, 0.3);
  if (mo > 0.4) p.curve([X(0.13, -0.065 - mo * 0.03), X(0.145, -0.09 - mo * 0.05), X(0.105, -0.085 - mo * 0.03)], 0.45, ink.feat); // 舌頭
  p.dot(X(0.195, -0.028), s * 0.017, ink.feat);
  // 眼睛
  if (ps.eyes === 'closed') p.curve([X(0.03, 0.03), X(0.055, 0.015), X(0.08, 0.03)], 0.5, ink.feat);
  else if (ps.eyes === 'happy') p.curve([X(0.032, 0.022), X(0.056, 0.042), X(0.08, 0.022)], 0.55, ink.feat);
  else p.dot(X(0.058, 0.03), s * 0.016, ink.feat);
  if (lk.ball) {
    const b = X(0.16, -0.085 - mo * 0.04);
    tennisBall(p.c!, b.x, b.y, 0.05 * s, { ink: lk.ink, t: lk.t, pen: p });
  }
}

function drawDogFront(p: Pen, ps: DogPose, s: number, lk: DogLook) {
  const qq = lk.who === 'qq', amp = (0.018 + 0.025 * ps.fluff) * s * (qq ? 1 : 1.1);
  const AX = { x: 1, y: 0 };
  const hTilt = ps.head * D * 0.4;
  // 尾巴在背後，從一邊的肩膀後面冒出來
  p.part(3);
  const w = lk.wag * 0.03 * s;
  furBlob(p, ellipsePts({ x: 0.17 * s + w, y: -0.44 * s }, vv(PI * 0.78), 0.14 * s, 0.08 * s, 50), amp, 12, lk, lk.fur, 0.7);
  p.part(0);
  const body = furBlob(p, ellipsePts({ x: 0, y: -0.2 * s }, AX, 0.21 * s, 0.2 * s, 80), amp, 18, lk, lk.fur);
  if (qq) darkSaddle(p, body, { x: 0, y: -0.2 * s }, { x: 0, y: -1 }, AX, s, 0.12 * s);
  p.part(2);
  for (const sg of [-1, 1]) {
    const leg = tube([{ x: sg * 0.07 * s, y: -0.16 * s }, { x: sg * 0.075 * s, y: -0.025 * s }], [0.04 * s, 0.036 * s], 0);
    p.fill(polyOf(leg), lk.fur); p.line(leg.L, 0.65); p.line(leg.R, 0.65);
    const paw = ellipsePts({ x: sg * 0.078 * s, y: -0.02 * s }, AX, 0.045 * s, 0.024 * s, 12);
    p.fill(paw, lk.fur); p.line(paw.concat([paw[0]!]), 0.65, undefined, 0.2, true);
  }
  p.part(0);
  furBlob(p, ellipsePts({ x: 0, y: -0.37 * s }, AX, 0.18 * s, 0.15 * s, 70), amp * 1.2, 14, lk, lk.chest);
  // 頭
  p.part(1);
  const hc = { x: Math.sin(hTilt) * 0.08 * s, y: -0.53 * s };
  const X = (x: number, y: number) => ({ x: hc.x + (x * Math.cos(hTilt) - y * Math.sin(hTilt)) * s, y: hc.y + (x * Math.sin(hTilt) + y * Math.cos(hTilt)) * s });
  const eb = ps.ears * 0.04;
  for (const sg of [-1, 1]) {
    const ear = [X(sg * 0.035, -0.07), X(sg * (0.085 + eb), -0.19 + eb), X(sg * 0.115, -0.05)];
    p.fill(ear, lk.fur); p.line(ear.concat([ear[0]!]), 0.75, undefined, 0.2, true);
  }
  const head = furBlob(p, ellipsePts(hc, AX, 0.125 * s, 0.11 * s, 50), amp * 0.45, 12, lk, lk.fur, 0.85);
  if (qq) darkSaddle(p, head, hc, { x: 0, y: -1 }, AX, s, 0.0);
  // 臉：兩個眼睛、小小的嘴筒（QQ 奶油色）在眼睛下面、鼻頭在嘴筒上緣
  const muz = smoothPts([X(-0.05, 0.03), X(0, 0.005), X(0.05, 0.03), X(0.04, 0.075), X(0, 0.09), X(-0.04, 0.075)], true, 3);
  p.fill(muz, qq ? lk.chest : lk.fur); p.line(muz, 0.55, undefined, 0.2, true);
  p.dot(X(0, 0.03), s * 0.018, lk.ink.feat);
  if (ps.mouth > 0.3) p.curve([X(-0.025, 0.06), X(0, 0.06 + ps.mouth * 0.035), X(0.025, 0.06)], 0.5, lk.ink.feat);
  else p.curve([X(-0.022, 0.058), X(0, 0.07), X(0.022, 0.058)], 0.45, lk.ink.feat);
  for (const sg of [-1, 1]) {
    const ex = sg * 0.052, ey = -0.012;
    if (ps.eyes === 'closed') p.curve([X(ex - 0.02, ey), X(ex, ey + 0.012), X(ex + 0.02, ey)], 0.5, lk.ink.feat);
    else if (ps.eyes === 'happy') p.curve([X(ex - 0.02, ey + 0.008), X(ex, ey - 0.014), X(ex + 0.02, ey + 0.008)], 0.55, lk.ink.feat);
    else p.dot(X(ex, ey), s * 0.017, lk.ink.feat);
  }
  if (qq) {
    const t = tube([X(-0.1, 0.1), X(0, 0.135), X(0.1, 0.1)], [0.016 * s, 0.018 * s, 0.016 * s], 0);
    p.fill(polyOf(t), rgba('collar')); p.line(t.L, 0.5); p.line(t.R, 0.5);
    p.dot(X(0, 0.16), s * 0.016, rgba('ball'));
  }
}

/** 畫一隻狗（芃芃：全身蓬鬆的橘毛；QQ：白胸口、頭與背深一點、紅項圈）。 */
export function drawDog(c: Ctx, who: DogWho, ps: DogPose, o: DogOpts): DogJoints {
  const s = o.h * DOG_K[who] * DOG_NORM;
  const ink = o.ink ?? inkFor(false);
  const t = o.t ?? 0;
  const boil = Math.floor(t * 8);
  const lk: DogLook = {
    who, ink, t, ball: !!o.ball,
    wag: o.wag ?? (Number.isNaN(ps.tail) ? Math.sin(t * TAU * 2.2) : ps.tail),
    fur: rgba('fur'), chest: who === 'qq' ? rgba('cream') : rgba('fur'),
    seedPh: hh(boil, who === 'qq' ? 5 : 9, 1) * 0.5,
  };
  const front = o.view === 'front';
  const J = solveDog(ps, s);
  // 地面：最低的接觸點
  let low = 0;
  if (front) low = 0;
  else {
    low = -Infinity;
    for (const L of J.legs) low = Math.max(low, L.paw.y + 0.03 * s);
    const mid = mixP(J.hip, J.sh, 0.5);
    low = Math.max(low, at(mid, J.up, -0.19 * s).y, at(J.hip, J.up, -0.18 * s).y, at(J.sh, J.up, -0.2 * s).y, J.hc.y + 0.1 * s);
  }
  const oy = o.y - low - ps.lift * s;
  const sp = o.spin ? Math.cos(TAU * o.spin) : 1;
  const sxs = (o.dir ?? 1) * (sp < 0 ? -1 : 1) * (0.35 + 0.65 * Math.abs(sp));
  const lw = o.lw ?? lineW(o.h) * 0.92;
  const rv = o.reveal ?? 1;
  const w = (p: Pt): Pt => ({ x: o.x + sxs * p.x, y: oy + p.y });
  let pen: Pt | null = null;
  if (rv > 0) {
    let sched: { offs: number[]; lens: number[]; total: number } | null = null;
    if (rv < 1) {
      sched = schedule(`dog|${who}|${front ? 'f' : 's'}`, (p) => {
        const J0 = solveDog(DSTAND, 100);
        const l0 = { ...lk, wag: 0, ball: false };
        front ? drawDogFront(p, DSTAND, 100, l0) : drawDogSide(p, J0, DSTAND, l0);
      }, 4);
    }
    c.save();
    c.translate(o.x, oy);
    c.scale(sxs, 1);
    PEN.begin(c, ink, (boil * 7919) ^ (who === 'qq' ? 303 : 404), lw, lineW(o.h) * 0.3, o.alpha ?? 1);
    PEN.ox = o.x; PEN.oy = oy; PEN.sx = sxs;
    if (sched) {
      const sc = s / 100;
      PEN.rv = rv * sched.total * sc;
      PEN.offs = sched.offs.map((x) => x * sc);
      PEN.lens = sched.lens.map((x) => x * sc);
    }
    if (front) drawDogFront(PEN, ps, s, lk); else drawDogSide(PEN, J, ps, lk);
    PEN.flush();
    if (rv < 1) pen = PEN.pen;
    c.restore();
  }
  if (front) {
    const hc = { x: 0, y: -0.53 * s };
    const P = (x: number, y: number) => w({ x: x * s, y: y * s });
    return {
      nose: w({ x: hc.x, y: hc.y + 0.03 * s }), mouth: w({ x: hc.x, y: hc.y + 0.07 * s }), head: w(hc), top: P(0, -0.72), collar: P(0, -0.41),
      back: P(0, -0.66), tail: P(0.2, -0.45), paws: [P(-0.078, 0), P(0.078, 0), P(-0.078, 0), P(0.078, 0)],
      bbox: [o.x - 0.26 * s, oy - 0.74 * s, 0.52 * s, 0.74 * s], pen, facing: sxs >= 0 ? 1 : -1,
    };
  }
  const X = (x: number, y: number) => w(at2(J.hc, J.hax, x * s, J.hup, y * s));
  const pts = [X(0.2, 0), X(0, 0.2), w(at(J.hip, J.ax, -0.25 * s)), w(at(J.hip, J.up, 0.38 * s)), ...J.legs.map((L) => w(L.paw))];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return {
    nose: X(0.195, -0.028), mouth: X(0.16, -0.085 - ps.mouth * 0.04), head: w(J.hc), top: X(-0.02, 0.19),
    collar: w(at2(J.neck, J.ax, 0.02 * s, J.up, 0)), back: w(at(mixP(J.hip, J.sh, 0.5), J.up, 0.2 * s)),
    tail: w(at2(J.hip, J.ax, 0.0, J.up, 0.36 * s)),
    paws: [w(J.legs[0]!.paw), w(J.legs[1]!.paw), w(J.legs[2]!.paw), w(J.legs[3]!.paw)],
    bbox: [x0, y0, x1 - x0, y1 - y0], pen, facing: sxs >= 0 ? 1 : -1,
  };
}

// ================================================================ 背景
/**
 * 亮版面的紙（紙色＋纖維＋一點點濃淡，四角稍暗），整晚共用一個 shader。用法：`paperBG().render(renderer, out)`（整張覆蓋 out），
 * 再把角色層疊上去；記得回傳 `paper: 1`。
 */
export const paperBG = () => shared('couple.paper', () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = FRAG_PX;
    float n = fbm(p / 300.0, 4);
    float fib = snoise(vec2(p.x / 2.5, p.y / 70.0)) * 0.5 + 0.5;
    vec3 col = C_PAPER * (0.965 + 0.035 * n + 0.012 * fib);
    vec2 d = vUv - 0.5;
    col *= 1.0 - 0.16 * dot(d, d);
    fragColor = vec4(col, 1.0);
  }`));

// ================================================================ 道具
export interface PropOpts extends InkOpts {
  /** 場景尺度（宣文身高 px）：道具大小跟著人。 */
  h?: number;
  /** 內部用：接著角色的筆畫（同一個抖動）。 */
  pen?: Pen;
}
function propPen(c: Ctx, o: PropOpts, seed: number) {
  if (o.pen) return o.pen;
  const p = penFor(c, { lw: o.lw ?? lineW(o.h ?? 420), ...o }, seed);
  return p;
}
function done(_c: Ctx, p: Pen, o: PropOpts) { if (!o.pen) p.end(); }

/** 球拍的拍面中心（不畫）：算擊球點、球的軌跡端點用。 */
export function racketHead(grip: Pt, ang: number, o: { h?: number; kind?: 'badminton' | 'tennis' } = {}): Pt {
  const h = o.h ?? 420, tennis = o.kind === 'tennis';
  const d = (tennis ? 0.16 : 0.2) * h + (tennis ? 0.09 : 0.068) * h;
  return { x: grip.x + Math.cos(ang) * d, y: grip.y + Math.sin(ang) * d };
}

/** 球拍：從握點沿著 ang 伸出去。回傳拍面中心（擊球點）。 */
export function racket(c: Ctx, grip: Pt, ang: number, o: PropOpts & { kind?: 'badminton' | 'tennis' } = {}): Pt {
  const h = o.h ?? 420, tennis = o.kind === 'tennis';
  const p = propPen(c, o, 31);
  const ax = { x: Math.cos(ang), y: Math.sin(ang) }, ay = { x: -ax.y, y: ax.x };
  const shaft = (tennis ? 0.16 : 0.2) * h, rx = (tennis ? 0.09 : 0.068) * h, ry = (tennis ? 0.07 : 0.052) * h;
  const base = at(grip, ax, -0.03 * h);
  const neck = at(grip, ax, shaft);
  const cc = at(neck, ax, rx);
  p.line([base, neck], tennis ? 1.3 : 0.9);
  const rim = ellipsePts(cc, ax, rx, ry, 30);
  p.fill(rim, p.ink.fill, 0.35);
  // 網線
  p.clip(rim, (cx) => {
    cx.strokeStyle = p.ink.soft; cx.lineWidth = p.lw * 0.28; cx.beginPath();
    const n = tennis ? 7 : 6;
    for (let k = -n; k <= n; k++) {
      const a = at(cc, ay, (k / n) * ry), b = at(cc, ax, (k / n) * rx);
      cx.moveTo(a.x - ax.x * rx, a.y - ax.y * rx); cx.lineTo(a.x + ax.x * rx, a.y + ax.y * rx);
      cx.moveTo(b.x - ay.x * ry, b.y - ay.y * ry); cx.lineTo(b.x + ay.x * ry, b.y + ay.y * ry);
    }
    cx.stroke();
  });
  p.line(rim.concat([rim[0]!]), tennis ? 1.1 : 0.9, undefined, 0.1, true);
  p.line([at(grip, ax, -0.035 * h), at(grip, ax, 0.05 * h)], 1.9);
  done(c, p, o);
  return cc;
}

/** 羽球：球頭在 (x, y)，ang = 飛行方向（羽毛朝後）。 */
export function shuttle(c: Ctx, x: number, y: number, ang: number, o: PropOpts = {}) {
  const h = o.h ?? 420, s = 0.045 * h;
  const p = propPen(c, o, 37);
  const ax = { x: -Math.cos(ang), y: -Math.sin(ang) }, ay = { x: -ax.y, y: ax.x };
  const o0 = { x, y };
  const skirt = [loc(o0, ax, ay, s, 0.25, -0.22), loc(o0, ax, ay, s, 1.1, -0.5), loc(o0, ax, ay, s, 1.15, 0.5), loc(o0, ax, ay, s, 0.25, 0.22)];
  p.fill(skirt, p.ink.fill);
  p.line(skirt.concat([skirt[0]!]), 0.6, undefined, 0.15, true);
  p.line([loc(o0, ax, ay, s, 0.3, 0), loc(o0, ax, ay, s, 1.12, 0)], 0.4);
  p.line([loc(o0, ax, ay, s, 0.7, -0.35), loc(o0, ax, ay, s, 0.7, 0.35)], 0.4);
  const cork = ellipsePts(loc(o0, ax, ay, s, 0.12, 0), ax, 0.18 * s, 0.22 * s, 12);
  p.fill(cork, p.ink.line);
  done(c, p, o);
}

/** 網球（黃綠色固定色＋白色的縫線）。 */
export function tennisBall(c: Ctx, x: number, y: number, r: number, o: PropOpts = {}) {
  const p = propPen(c, o, 41);
  const b = ellipsePts({ x, y }, { x: 1, y: 0 }, r, r, 18);
  p.fill(b, rgba('ball'));
  const rot = (o.t ?? 0) * 3;
  p.curve([{ x: x + Math.cos(rot) * r * 0.9, y: y + Math.sin(rot) * r * 0.9 }, { x: x + Math.cos(rot + 1.2) * r * 0.25, y: y + Math.sin(rot + 1.2) * r * 0.25 }, { x: x - Math.cos(rot) * r * 0.9, y: y - Math.sin(rot) * r * 0.9 }], 0.4, rgba('cream'));
  p.line(b.concat([b[0]!]), 0.6, undefined, 0.1, true);
  done(c, p, o);
}

/** 飛盤（tilt 0 = 側面看成一條、1 = 正面看成圓）。 */
export function frisbee(c: Ctx, x: number, y: number, r: number, ang = 0, tilt = 0.3, o: PropOpts = {}) {
  const p = propPen(c, o, 43);
  const e = ellipsePts({ x, y }, { x: Math.cos(ang), y: Math.sin(ang) }, r, Math.max(r * 0.12, r * tilt), 26);
  p.fill(e, p.ink.fill);
  p.line(e.concat([e[0]!]), 0.9, undefined, 0.1, true);
  const e2 = ellipsePts({ x, y }, { x: Math.cos(ang), y: Math.sin(ang) }, r * 0.62, Math.max(r * 0.07, r * tilt * 0.62), 20);
  p.line(e2.concat([e2[0]!]), 0.45, p.ink.soft, 0.1, true);
  done(c, p, o);
}

/** 傘：握點在手，傘柄沿著 ang 往上；open 0..1（收起 → 撐開）。回傳傘頂。 */
export function umbrella(c: Ctx, grip: Pt, ang: number, open = 1, o: PropOpts = {}): Pt {
  const h = o.h ?? 420, p = propPen(c, o, 47);
  const ax = { x: Math.cos(ang), y: Math.sin(ang) }, ay = { x: -ax.y, y: ax.x };
  const stick = 0.42 * h;
  const tip = at(grip, ax, stick);
  const R = lerp(0.04, 0.3, open) * h, dome = lerp(0.3, 0.12, open) * h;
  const rimL = at2(tip, ax, -dome, ay, -R), rimR = at2(tip, ax, -dome, ay, R);
  const canopy = [rimL, at2(tip, ax, -dome * 0.35, ay, -R * 0.75), at(tip, ax, 0.012 * h), at2(tip, ax, -dome * 0.35, ay, R * 0.75), rimR];
  const scal: Pt[] = [];
  for (let k = 4; k >= 0; k--) { const a = mixP(rimL, rimR, k / 4 + 0.125 > 1 ? 1 : k / 4); scal.push(a); if (k) scal.push(at(mixP(rimL, rimR, (k - 0.5) / 4), ax, dome * 0.1 * open)); }
  const shape = smoothPts(canopy, false, 4).concat(scal.slice(1));
  p.fill(shape, p.ink.fill);
  p.line(shape.concat([shape[0]!]), 1, undefined, 0.1, true);
  for (const k of [-0.5, 0, 0.5]) p.curve([at(tip, ax, 0.005 * h), at2(tip, ax, -dome * 0.5, ay, R * k * 0.8), at2(tip, ax, -dome * 0.92, ay, R * k)], 0.45, p.ink.soft);
  p.line([at(grip, ax, -0.02 * h), tip], 0.8);
  p.curve([at(grip, ax, -0.02 * h), at2(grip, ax, -0.05 * h, ay, 0.015 * h), at2(grip, ax, -0.04 * h, ay, 0.03 * h)], 0.8);
  done(c, p, o);
  return tip;
}

/** 捧花（花朵用淺色＋輪廓，緞帶垂下）。 */
export function bouquet(c: Ctx, grip: Pt, ang = -PI / 2, o: PropOpts = {}) {
  const h = o.h ?? 420, p = propPen(c, o, 53);
  const ax = { x: Math.cos(ang), y: Math.sin(ang) }, ay = { x: -ax.y, y: ax.x };
  const s = 0.05 * h;
  const top = at(grip, ax, s * 1.1);
  for (const k of [-1, 1]) p.line([at(grip, ax, -s * 0.6), at2(top, ay, k * s * 0.4, ax, 0)], 0.6);
  const flowers = [[0, 0.5], [-0.55, 0.25], [0.55, 0.25], [-0.3, 0.95], [0.3, 0.95], [0, 1.25], [-0.75, 0.75], [0.75, 0.75]];
  for (const [fx, fy] of flowers) {
    const cc = loc(top, ax, ay, s, fy!, fx!);
    const petals = ellipsePts(cc, ax, s * 0.34, s * 0.34, 14);
    p.fill(tufts(petals, s * 0.08, 5, fx! * 3), p.ink.light);
    p.line(tufts(petals, s * 0.08, 5, fx! * 3).concat([petals[0]!]), 0.55, undefined, 0.1, true);
    p.dot(cc, s * 0.06);
  }
  p.curve([at(grip, ay, -s * 0.2), at2(grip, ax, -s * 0.9, ay, -s * 0.45), at2(grip, ax, -s * 1.4, ay, -s * 0.2)], 0.55);
  p.curve([at(grip, ay, s * 0.2), at2(grip, ax, -s * 1.0, ay, s * 0.4), at2(grip, ax, -s * 1.5, ay, s * 0.1)], 0.55);
  done(c, p, o);
}

/** 香檳杯：握在杯腳，杯口朝 ang（預設朝上）；fill 0..1 酒的高度（淡淡的訊號色）。回傳杯口中心。 */
export function champagne(c: Ctx, grip: Pt, ang = -PI / 2, fill = 0.7, o: PropOpts = {}): Pt {
  const h = o.h ?? 420, p = propPen(c, o, 59);
  const ax = { x: Math.cos(ang), y: Math.sin(ang) }, ay = { x: -ax.y, y: ax.x };
  const s = 0.05 * h;
  const foot = at(grip, ax, -s * 0.9), bowl0 = at(grip, ax, s * 0.6), rim = at(grip, ax, s * 2.6);
  p.line([at(foot, ay, -s * 0.45), at(foot, ay, s * 0.45)], 0.7);
  p.line([foot, bowl0], 0.6);
  const bowl = [at(bowl0, ay, 0), at2(bowl0, ax, s * 0.6, ay, -s * 0.36), at(rim, ay, -s * 0.42), at(rim, ay, s * 0.42), at2(bowl0, ax, s * 0.6, ay, s * 0.36)];
  const sb = smoothPts(bowl, true, 3);
  if (fill > 0) {
    const lv = at(bowl0, ax, s * 0.2 + s * 1.8 * fill);
    p.clip(sb, (cx) => {
      cx.fillStyle = rgba('signal', 0.55);
      cx.beginPath();
      const a = at2(lv, ay, -s, ax, 0), b = at2(lv, ay, s, ax, 0);
      cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y);
      const b2 = at(b, ax, -s * 3), a2 = at(a, ax, -s * 3);
      cx.lineTo(b2.x, b2.y); cx.lineTo(a2.x, a2.y); cx.closePath(); cx.fill();
    });
  }
  p.line(sb, 0.75, undefined, 0.15, true);
  done(c, p, o);
  return rim;
}

/** 垂直於 ax、朝畫面上方的方向（道具的「上」：不管角色面向哪邊，鍋子都開口朝上）。 */
const upOf = (ax: Pt): Pt => (ax.x >= 0 ? { x: ax.y, y: -ax.x } : { x: -ax.y, y: ax.x });

/** 平底鍋：握把在手，鍋子沿著 ang 伸出去；food 0..1 鍋裡的菜（飛出去時設 0，版面自己畫飛起來的菜）。回傳鍋心（菜的位置）。 */
export function pan(c: Ctx, grip: Pt, ang: number, o: PropOpts & { food?: number } = {}): Pt {
  const h = o.h ?? 420, p = propPen(c, o, 61);
  const ax = { x: Math.cos(ang), y: Math.sin(ang) }, up = upOf(ax);
  const hl = 0.11 * h, R = 0.085 * h, dp = 0.026 * h;
  const n1 = at(grip, ax, hl);
  p.line([at(grip, ax, -0.03 * h), n1], 1.7);
  // 側面看的平底鍋：上緣一條直線、鍋身是淺淺的梯形
  const body = [at2(n1, ax, -0.004 * h, up, 0.006 * h), at2(n1, ax, 2 * R, up, 0.006 * h), at2(n1, ax, 2 * R - 0.014 * h, up, -dp), at2(n1, ax, 0.014 * h, up, -dp)];
  p.fill(body, p.ink.dark, 0.95);
  p.line(body.concat([body[0]!]), 0.9, undefined, 0.1, true);
  const cc = at2(n1, ax, R, up, 0.008 * h);
  const food = o.food ?? 1;
  if (food > 0.05) {
    const f = [at2(n1, ax, R * 0.45, up, 0.006 * h), at2(n1, ax, R * 0.8, up, 0.03 * h * food), at2(n1, ax, R * 1.3, up, 0.026 * h * food), at2(n1, ax, R * 1.6, up, 0.006 * h)];
    p.fill(smoothPts(f, true, 3), p.ink.light);
    p.line(smoothPts(f, false, 3), 0.6);
  }
  done(c, p, o);
  return cc;
}

/** 麥克風（頭朝 ang）。 */
export function mic(c: Ctx, grip: Pt, ang: number, o: PropOpts = {}) {
  const h = o.h ?? 420, p = propPen(c, o, 67);
  const ax = { x: Math.cos(ang), y: Math.sin(ang) };
  const a = at(grip, ax, -0.04 * h), b = at(grip, ax, 0.06 * h);
  const t = tube([a, b], [0.008 * h, 0.013 * h], 0);
  p.fill(polyOf(t), p.ink.dark); p.line(t.L, 0.7); p.line(t.R, 0.7);
  const head = ellipsePts(at(b, ax, 0.02 * h), ax, 0.024 * h, 0.022 * h, 16);
  p.fill(head, p.ink.fill);
  p.line(head.concat([head[0]!]), 0.8, undefined, 0.1, true);
  // 網罩：幾條交叉的細線（不呼叫 hatch()：它會重設共用的筆）
  const hc = at(b, ax, 0.02 * h), g = 0.008 * h;
  p.clip(head, (cx) => {
    cx.strokeStyle = p.ink.soft; cx.lineWidth = p.lw * 0.3; cx.beginPath();
    for (let k = -4; k <= 4; k++) {
      cx.moveTo(hc.x + k * g - 0.03 * h, hc.y - 0.03 * h); cx.lineTo(hc.x + k * g + 0.03 * h, hc.y + 0.03 * h);
      cx.moveTo(hc.x + k * g + 0.03 * h, hc.y - 0.03 * h); cx.lineTo(hc.x + k * g - 0.03 * h, hc.y + 0.03 * h);
    }
    cx.stroke();
  });
  done(c, p, o);
}

/** 馬克杯（杯口朝上）。 */
export function cup(c: Ctx, grip: Pt, o: PropOpts = {}) {
  const h = o.h ?? 420, p = propPen(c, o, 71);
  const w = 0.045 * h, hh2 = 0.055 * h;
  const x = grip.x - w * 0.3, y = grip.y;
  const body = [{ x: x - w / 2, y: y - hh2 / 2 }, { x: x + w / 2, y: y - hh2 / 2 }, { x: x + w * 0.45, y: y + hh2 / 2 }, { x: x - w * 0.45, y: y + hh2 / 2 }];
  p.fill(body, p.ink.fill);
  p.line(body.concat([body[0]!]), 0.85, undefined, 0.1, true);
  p.curve([{ x: x + w / 2, y: y - hh2 * 0.25 }, { x: x + w * 0.78, y: y }, { x: x + w * 0.47, y: y + hh2 * 0.25 }], 0.7);
  done(c, p, o);
}

/** 盤子（側面看，放在手掌上或桌上）。 */
export function plate(c: Ctx, x: number, y: number, o: PropOpts & { food?: boolean } = {}) {
  const h = o.h ?? 420, p = propPen(c, o, 73);
  const w = 0.14 * h;
  const pl = smoothPts([{ x: x - w / 2, y: y - 0.006 * h }, { x: x - w * 0.3, y: y + 0.01 * h }, { x: x + w * 0.3, y: y + 0.01 * h }, { x: x + w / 2, y: y - 0.006 * h }], false, 3);
  if (o.food) {
    const f = [{ x: x - w * 0.3, y: y - 0.004 * h }, { x: x - w * 0.1, y: y - 0.04 * h }, { x: x + w * 0.2, y: y - 0.035 * h }, { x: x + w * 0.32, y: y - 0.004 * h }];
    p.fill(smoothPts(f, true, 3), p.ink.light);
    p.line(smoothPts(f, false, 3), 0.6);
  }
  p.fill(pl, p.ink.fill);
  p.line(pl.concat([pl[0]!]), 0.8, undefined, 0.1, true);
  done(c, p, o);
}

/** 手機（不畫任何品牌）：握點、ang = 手機的「上」方向。 */
export function phone(c: Ctx, grip: Pt, ang: number, o: PropOpts = {}) {
  const h = o.h ?? 420, p = propPen(c, o, 79);
  const ax = { x: Math.cos(ang), y: Math.sin(ang) }, ay = { x: -ax.y, y: ax.x };
  const L = 0.085 * h, Wd = 0.045 * h;
  const r = [at2(grip, ax, -L * 0.3, ay, -Wd / 2), at2(grip, ax, L * 0.7, ay, -Wd / 2), at2(grip, ax, L * 0.7, ay, Wd / 2), at2(grip, ax, -L * 0.3, ay, Wd / 2)];
  p.fill(r, p.ink.dark);
  p.line(r.concat([r[0]!]), 0.8, undefined, 0.1, true);
  done(c, p, o);
}

/** 氣球：球心 (x, y)、半徑 r，繩子垂到 to。 */
export function balloon(c: Ctx, x: number, y: number, r: number, to: Pt, o: PropOpts = {}) {
  const p = propPen(c, o, 83);
  const t = o.t ?? 0;
  const b = ellipsePts({ x, y }, { x: 1, y: 0 }, r * 0.86, r, 24);
  p.fill(b, p.ink.fill);
  p.line(b.concat([b[0]!]), 0.9, undefined, 0.1, true);
  p.curve([{ x: x - r * 0.25, y: y - r * 0.45 }, { x: x - r * 0.38, y: y - r * 0.1 }], 0.5, p.ink.soft);
  const k = { x, y: y + r };
  p.line([{ x: k.x - r * 0.1, y: k.y + r * 0.12 }, k, { x: k.x + r * 0.1, y: k.y + r * 0.12 }], 0.6);
  const m1 = mixP(k, to, 0.33), m2 = mixP(k, to, 0.66);
  p.curve([k, { x: m1.x + Math.sin(t * 3) * r * 0.2, y: m1.y }, { x: m2.x - Math.sin(t * 3 + 1) * r * 0.2, y: m2.y }, to], 0.5);
  done(c, p, o);
}

/** 牽繩（藍色固定色）：手 → 項圈，slack 下垂量（px；拉緊 0）。 */
export function leash(c: Ctx, from: Pt, to: Pt, o: PropOpts & { slack?: number } = {}) {
  const p = propPen(c, o, 89);
  const slack = o.slack ?? Math.max(10, dist(from, to) * 0.18);
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    const q = mixP(from, to, u);
    pts.push({ x: q.x, y: q.y + 4 * slack * u * (1 - u) });
  }
  p.line(pts, 0.85, rgba('leash'), 0.2);
  p.dot(to, p.lw * 0.7, rgba('leash'));
  done(c, p, o);
}

/**
 * 木牌（公園告示、場邊看板）：左上角 (x, y)、w × h（px），posts = 底下兩根柱子（到 ground）。
 * 回傳文字框 [x, y, w, h]（已經扣掉邊框），版面自己排字（留言 ≥ 44 px）。
 */
export function sign(c: Ctx, x: number, y: number, w: number, hgt: number, o: PropOpts & { ground?: number; wood?: boolean } = {}): [number, number, number, number] {
  const p = propPen(c, o, 97);
  if (o.ground !== undefined) {
    for (const px of [x + w * 0.18, x + w * 0.82]) {
      const post = [{ x: px - 7, y: y + hgt - 4 }, { x: px + 7, y: y + hgt - 4 }, { x: px + 7, y: o.ground }, { x: px - 7, y: o.ground }];
      p.fill(post, p.ink.fill);
      p.line([post[0]!, post[3]!], 0.8); p.line([post[1]!, post[2]!], 0.8);
    }
  }
  const b = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + hgt }, { x, y: y + hgt }];
  p.fill(b, p.ink.fill);
  if (o.wood !== false) {
    // 木紋：幾條橫的淡線
    for (let k = 1; k < 4; k++) {
      const yy = y + (hgt * k) / 4;
      p.line([{ x: x + 6, y: yy }, { x: x + w * 0.4, y: yy + 2 }, { x: x + w - 6, y: yy - 1 }], 0.3, p.ink.soft, 0.8);
    }
  }
  p.line(b.concat([b[0]!]), 1.1, undefined, 0.05, true);
  const pad = Math.min(28, w * 0.06);
  done(c, p, o);
  return [x + pad, y + pad, w - 2 * pad, hgt - 2 * pad];
}

/** 對話框：框 [x, y, w, h]，尾巴指向 tail。回傳文字框。 */
export function bubble(c: Ctx, x: number, y: number, w: number, hgt: number, tail: Pt, o: PropOpts = {}): [number, number, number, number] {
  const p = propPen(c, o, 101);
  const r = Math.min(24, hgt * 0.3);
  const base0 = { x: clamp(tail.x - 18, x + r, x + w - r - 36), y: y + hgt }, base1 = { x: base0.x + 36, y: y + hgt };
  const pts: Pt[] = [
    { x: x + r, y }, { x: x + w - r, y }, { x: x + w, y: y + r }, { x: x + w, y: y + hgt - r }, { x: x + w - r, y: y + hgt },
    base1, tail, base0, { x: x + r, y: y + hgt }, { x, y: y + hgt - r }, { x, y: y + r },
  ];
  p.fill(pts, p.ink.fill);
  p.line(pts.concat([pts[0]!]), 1, undefined, 0.05, true);
  done(c, p, o);
  const pad = Math.min(26, w * 0.06);
  return [x + pad, y + pad * 0.8, w - 2 * pad, hgt - 1.6 * pad];
}

/** 冒出來的小愛心（點綴色玫瑰：唯一可以用玫瑰色的東西），k 0..1 冒出的進度。 */
export function heartPop(c: Ctx, x: number, y: number, size: number, k: number) {
  if (k <= 0 || k >= 1) return;
  const s = size * ease.outBack(clamp(k * 3)) * (1 - clamp((k - 0.7) / 0.3));
  const yy = y - k * size * 1.2;
  c.save();
  c.fillStyle = rgba('rose', 0.95);
  c.beginPath();
  for (let i = 0; i <= 32; i++) {
    const a = PI + (i / 32) * TAU;
    const hx = 16 * Math.sin(a) ** 3, hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    const px = x + (hx / 32) * s, py = yy + ((hy + 2.5) / 32) * s;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.fill();
  c.restore();
}

// ================================================================ 物件上的主打留言
/** fitNote 排好的留言。 */
export interface Note { fit: FitResult; family: string; sig: number; sigRow: number; width: number; height: number; name: string | null }

/**
 * 寫在場景物件上的主打留言（木牌、便條、記分板、卡片…）：在 w × h 裡找最大的字（min～max），短的盡量一行放完。
 * **高度先扣掉署名那一列**再算字級，所以署名永遠在最後一行下面，不會被字蓋到（四行＋很多愛心也一樣）。
 * name = null：不簽名（例如沒有留言時的邀請文字）。回傳的 height 含署名，版面可以用它置中。
 */
export function fitNote(c: Ctx, text: string, name: string | null, w: number, h: number, o: { family?: string; min?: number; max?: number; lineHeight?: number; sig?: number } = {}): Note {
  const family = o.family ?? F.hand(400);
  const sig = name === null ? 0 : (o.sig ?? 36);
  const sigRow = sig ? sig * 1.75 : 0;
  const min = o.min ?? 44, max = o.max ?? 80, lh = o.lineHeight ?? 1.28;
  const room = Math.max(min, h - sigRow);
  // 短的留言一行放完（「新婚快樂！！！」折成兩行很難看）
  const one = layoutMessage(c, text, family, w, Math.min(room, max * 1.25), { min: Math.max(min, 52), max, maxLines: 1 });
  const fit = one.lines.length === 1 && one.width <= w + 0.5 && one.size >= 52 ? one : layoutMessage(c, text, family, w, room, { min, max, lineHeight: lh, maxLines: 9 });
  return { fit, family, sig, sigRow, width: w, height: fit.height + sigRow, name };
}

/**
 * 畫 fitNote 排好的留言：(x, y) 是留言範圍的左上角、w 是寬（align 'right' 時署名靠右對齊到 x + w）。
 * chars：逐字出現（Infinity = 全部）；署名在字全部出現之後淡入（sigK 0..1，版面自己算時間）。回傳筆尖。
 */
export function drawNote(c: Ctx, n: Note, x: number, y: number, o: { chars?: number; color?: string; sigColor?: string; sigK?: number; align?: 'left' | 'center' } = {}): Pt | null {
  const f = n.fit;
  const base = y + f.size * 0.9;
  const cx = o.align === 'center' ? x + n.width / 2 : x;
  const head = drawMessage(c, f, n.family, cx, base, { align: o.align ?? 'left', chars: o.chars, color: o.color });
  if (n.name !== null && (o.sigK ?? 1) > 0) {
    c.save();
    c.globalAlpha *= o.sigK ?? 1;
    c.font = font(n.family, n.sig);
    c.textAlign = o.align === 'center' ? 'center' : 'right';
    c.textBaseline = 'alphabetic';
    c.fillStyle = o.sigColor ?? o.color ?? rgba('bone');
    c.fillText(signature(n.name), o.align === 'center' ? cx : x + n.width, y + f.height + n.sigRow * 0.72);
    c.restore();
  }
  return head;
}

// ================================================================ 歌詞沿著曲線
export interface PathLyricStyle {
  family: string;
  size: number;
  /** 最小字級（遠處也要看得到：≥ 48）。 */
  minSize?: number;
  /** 起點：0..1 沿著曲線的位置；align center 時是中心。 */
  at?: number;
  align?: 'start' | 'center';
  /** 字的基線離曲線的距離（+ = 曲線的左手邊／上方，px）。 */
  offset?: number;
  active?: string;
  sung?: string;
  unsung?: string;
  alpha?: number;
  /** 放不下時第二排往下（曲線法線方向）移多少（字級的倍數），預設 1.2。 */
  rowGap?: number;
  tracking?: number;
}

const widthCache = new Map<string, number[]>();
/**
 * 一行歌詞沿著曲線排（每個字轉到切線方向），照跟唱規則上色：還沒唱 30%、正在唱的字訊號色（唱到哪亮到哪）、唱完紙白／墨色。
 * 太長會先縮字（不小於 minSize），再不行就在最接近中間的字之間折成兩排（第二排沿著同一條曲線往下平移）。
 * 回傳正在唱的字的筆尖位置（給火花／球用）與這行佔的範圍（popupAvoid 用）。
 */
export function lyricOnPath(c: Ctx, line: Line, t: number, path: readonly Pt[], st: PathLyricStyle): { head: Pt | null; box: [number, number, number, number] } {
  const n = path.length;
  const acc: number[] = [0];
  for (let i = 1; i < n; i++) acc.push(acc[i - 1]! + dist(path[i - 1]!, path[i]!));
  const total = acc[n - 1]!;
  const chars = Array.from(line.text);
  const tr = st.tracking ?? 0;
  const widths = (size: number) => {
    const key = `${line.i}|${line.text}|${st.family}|${size.toFixed(1)}`;
    let w = widthCache.get(key);
    if (!w) {
      c.font = font(st.family, size);
      w = chars.map((ch) => c.measureText(ch).width + tr);
      if (widthCache.size > 400) widthCache.clear();
      widthCache.set(key, w);
    }
    return w;
  };
  const avail = total * 0.94;
  let size = st.size;
  let ws = widths(size);
  let sum = ws.reduce((a, b) => a + b, 0);
  if (sum > avail) { size = Math.max(st.minSize ?? 48, (size * avail) / sum); size = Math.round(size * 2) / 2; ws = widths(size); sum = ws.reduce((a, b) => a + b, 0); }
  // 折兩排：在最接近一半的字（Word 邊界）斷
  let rows: [number, number][] = [[0, chars.length]];
  if (sum > avail && line.words.length > 1) {
    let best = 1, bestD = Infinity;
    for (let k = 1; k < line.words.length; k++) {
      const ci = Array.from(line.text.slice(0, line.words[k]!.o)).length;
      const a = ws.slice(0, ci).reduce((x, y) => x + y, 0);
      const d = Math.abs(a - sum / 2);
      if (d < bestD) { bestD = d; best = ci; }
    }
    rows = [[0, best], [best, chars.length]];
    const worst = Math.max(...rows.map(([a, b]) => ws.slice(a, b).reduce((x, y) => x + y, 0)));
    if (worst > avail) { size = Math.max(28, (size * avail) / worst); ws = widths(size); }
  }
  // 每個字屬於哪個 Word（算跟唱進度）
  const cw: number[] = [];
  {
    let wi = 0;
    let u16 = 0;
    for (let i = 0; i < chars.length; i++) {
      while (wi + 1 < line.words.length && line.words[wi + 1]!.o <= u16) wi++;
      cw.push(wi);
      u16 += chars[i]!.length;
    }
  }
  const wordOffset = (wi: number) => Array.from(line.text.slice(0, line.words[wi]!.o)).length;
  const sampleAt = (s: number) => {
    s = clamp(s, 0, total);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m]! < s) lo = m; else hi = m; }
    const a = path[lo]!, b = path[hi]!, seg = acc[hi]! - acc[lo]!;
    const u = seg > 0 ? (s - acc[lo]!) / seg : 0;
    return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  c.save();
  c.font = font(st.family, size);
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  const alpha = st.alpha ?? 1;
  let head: Pt | null = null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const off = st.offset ?? 0;
  rows.forEach(([a, b], ri) => {
    const rowW = ws.slice(a, b).reduce((x, y) => x + y, 0);
    const start = st.align === 'start' ? (st.at ?? 0) * total : (st.at ?? 0.5) * total - rowW / 2;
    let s = start;
    const shift = ri * size * (st.rowGap ?? 1.2);
    for (let i = a; i < b; i++) {
      const w = ws[i]!;
      const q = sampleAt(s + w / 2);
      s += w;
      const ch = chars[i]!;
      if (ch === ' ') continue;
      const nx = Math.sin(q.ang), ny = -Math.cos(q.ang);
      const px = q.x + nx * off - nx * shift, py = q.y + ny * off - ny * shift;
      const word = line.words[cw[i]!]!;
      const pw = Lyrics.wordProgress(word, t);
      // 這個字在 Word 裡的位置 → 唱到哪亮到哪
      const wlen = Math.max(1, Array.from(word.w).length);
      const k = (i - wordOffset(cw[i]!)) / wlen, k1 = (i - wordOffset(cw[i]!) + 1) / wlen;
      let col: string;
      if (pw >= 1) col = st.sung ?? rgba('bone', 0.96);
      else if (pw > k) col = st.active ?? rgba('signal');
      else col = st.unsung ?? rgba('bone', 0.3);
      if (pw > k && pw < k1) head = { x: px + Math.cos(q.ang) * w * ((pw - k) / (k1 - k) - 0.5), y: py - size * 0.35 };
      c.globalAlpha = alpha;
      c.fillStyle = col;
      c.save();
      c.translate(px, py);
      c.rotate(q.ang);
      if (ch === '♥') {
        c.fillStyle = rgba('rose');
      }
      c.fillText(ch, 0, 0);
      c.restore();
      x0 = Math.min(x0, px - size * 0.6); x1 = Math.max(x1, px + size * 0.6); y0 = Math.min(y0, py - size * 1.05); y1 = Math.max(y1, py + size * 0.3);
    }
  });
  c.restore();
  return { head, box: [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)] };
}
