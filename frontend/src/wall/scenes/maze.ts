// 迷宮（亮）：一張銅版畫風格的花園迷宮地圖（俯瞰），灌木樹籬用沿著形狀走的等高刻線畫、光從左上來、影子往右下拖。
//  - 迷宮的正中央是一塊空地（草坪），主打留言印在空地上（宋體）；上方另一塊空地是歌詞的立牌。
//  - 兩顆棋子（兩個人）從迷宮的左右兩側出發，**每一拍各走一步**（一步可以是好幾格，窗格短就走快一點），
//    沿路留下點點的足跡，最後同一拍走到空地下方的門口相遇：樹籬分開、門打開，冒出一顆愛心。
//    兩個人各在迷宮的一半裡走（左右兩半只有門口那一格相通），所以一定是在門口相遇。
//  - 鏡頭：像空拍機：切進來時高一點、歪一點，第一拍落定，之後很慢地推近；相遇那一拍輕輕一震。
//    地圖整張出血（樹籬延伸到畫面外），越往畫面邊緣刻線越淡，字附近的背景是乾淨的紙。
//  - 沒有留言：空地上是大大的歌詞（主角），底下一行小小的邀請；純音樂：上方立牌寫歌名。
//  - v2（留言尺寸標準）：空地移到左下角、只比字大一點（≤ 860×430），留言 40～60 px；迷宮是主視覺。
//    兩個人一拍一步走到大約窗格的七成才相遇（整段都在走），相遇後牽著手（一前一後）繼續往迷宮裡散步；
//    地圖上有雲的影子慢慢飄過（空拍的感覺）。歌詞立牌移到右上角。
// 手法：迷宮用種子亂數的深度優先搜尋生成（確定性），牆存在一張 DataTexture；全螢幕 shader 每個像素查 3×3 格的牆、
// 算到最近樹籬的距離，畫出樹籬、刻線、影子。字與棋子畫在「地圖座標」的 Canvas 層上，shader 用鏡頭的反矩陣去取樣
// （鏡頭轉動時不用每格重新光柵化斜的字）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, mulberry32, frameIdx, lerp } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, beatAfter, drawHeart, fillWithHearts, lyricSubOf, subStyleFor, subGap } from './_motifs';
import type { Line } from '../engine/lyrics';
import { msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { paperInk } from './_t4';
import { sigInk } from './_t1';
import { sigOf, T17_INVITE, T17_TEXT } from './_t17';

export const spec: PlateSpecDecl = { group: 'type', family: 'game', paper: true, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

/** 一格的大小（地圖像素）與地圖左上角（整張比畫面大一圈，鏡頭拉遠、轉動時邊緣也有迷宮）。 */
const CS = 72;
const OX = -3 * CS, OY = -3 * CS;
const NC = Math.ceil((W + 6 * CS) / CS), NR = Math.ceil((H + 6 * CS) / CS);
const FAM_MSG = F.ming(700);
const FAM_SIG = F.hand(700);
const FAM_LYR = F.hei(700);

const MAP = () => new FSPass(/* glsl */ `
  uniform sampler2D maze; uniform vec2 mzSize; uniform float cs; uniform vec2 org;
  uniform sampler2D stat; uniform sampler2D dyn;
  uniform mat3 camInv;
  uniform vec4 room; uniform vec4 sign; uniform vec4 door;
  uniform vec2 focus; uniform float t;
  vec4 cellAt(ivec2 c) {
    if (c.x < 0 || c.y < 0 || c.x >= int(mzSize.x) || c.y >= int(mzSize.y)) return vec4(0.0);
    return texelFetch(maze, c, 0);
  }
  // 到最近樹籬（牆的線段）的距離與最近點
  float segD(vec2 p, vec2 a, vec2 b, inout vec2 bp, float best) {
    vec2 pa = p - a, ba = b - a;
    float h = sat(dot(pa, ba) / dot(ba, ba));
    vec2 c = a + ba * h;
    float d = length(p - c);
    if (d < best) { bp = c; return d; }
    return best;
  }
  float hedgeD(vec2 q, out vec2 bp) {
    vec2 g = (q - org) / cs;
    ivec2 c0 = ivec2(floor(g));
    float best = 1e5; bp = q + vec2(1e5);
    for (int dj = -1; dj <= 1; dj++) for (int di = -1; di <= 1; di++) {
      ivec2 c = c0 + ivec2(di, dj);
      vec4 w = cellAt(c);
      vec2 a = org + vec2(c) * cs;
      if (w.r > 0.5) best = segD(q, a + vec2(cs, 0.0), a + vec2(cs, cs), bp, best);
      if (w.g > 0.5) best = segD(q, a + vec2(0.0, cs), a + vec2(cs, cs), bp, best);
    }
    return best;
  }
  vec4 layer(sampler2D s, vec2 q) {
    vec2 uv = vec2(q.x / ${W}.0, 1.0 - q.y / ${H}.0);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
    vec4 c = texture(s, uv);
    c.rgb = c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0);
    return c;
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = (camInv * vec3(sp, 1.0)).xy;
    float hw = 0.2 * cs;
    vec2 bp, bp2;
    // 樹籬的邊不是直的：用雜訊把距離推一推，邊緣、刻線都會像一叢一叢的葉子
    float wob = 2.8 * snoise(q / 10.0) + 1.2 * snoise(q / 3.8);
    float d = hedgeD(q, bp) + wob;
    // 門：開的時候樹籬從中間往兩邊收
    float dd = length(q - vec2(clamp(q.x, door.x, door.z), door.y));
    float doorHw = hw * (1.0 - door.w);
    float inHedge = 1.0 - smoothstep(hw - 0.9, hw + 0.9, d);
    float inDoor = 1.0 - smoothstep(doorHw - 0.9, doorHw + 0.9, dd);
    // 越往畫面邊緣刻線越淡（背景要能呼吸），焦點附近最清楚
    float fall = 1.0 - 0.45 * smoothstep(520.0, 1250.0, length((sp - focus) * vec2(0.8, 1.25)));
    // 樹籬：沿著形狀的等高刻線（像銅版畫的立體感），受光面淡、背光面濃，葉子的雜訊把線打斷
    vec2 nrm = (q - bp) / max(d, 1e-3);
    float lit = dot(nrm, normalize(vec2(-0.6, -0.8)));
    float dark = mix(0.62, 0.1, lit * 0.5 + 0.5) * (0.45 + 0.55 * sat(d / hw));
    dark *= 0.7 + 0.6 * sat(0.5 + 0.8 * snoise(q / 7.0));
    float lines = hatch(d / 3.1, dark);
    float leaf = step(0.72, hash12(floor(q / 2.0))) * 0.25 * sat(1.0 - lit);
    float hedgeInk = max(lines, leaf) * 0.85 + 0.9 * pxLine(abs(d - hw), 0.45, 1.3);
    float doorInk = hatch(dd / 3.1, 0.4) * 0.8 + 0.9 * pxLine(abs(dd - doorHw), 0.45, 1.3);
    // 影子：往右下拖，地面上的斜線
    float ds = hedgeD(q - vec2(7.0, 9.0), bp2) + wob;
    float shadow = (1.0 - smoothstep(hw - 2.0, hw + 4.0, ds)) * (1.0 - inHedge);
    float shInk = hatch((q.x + q.y) / 4.2, 0.26) * shadow;
    // 地面：碎石小點；空地：很淡的草坪橫線、雙線的框
    float ground = step(0.985, hash12(floor(q / 1.5))) * 0.35;
    float inRoom = step(room.x, q.x) * step(q.x, room.z) * step(room.y, q.y) * step(q.y, room.w);
    float inSign = step(sign.x, q.x) * step(q.x, sign.z) * step(sign.y, q.y) * step(q.y, sign.w);
    float frame = 0.0;
    if (inRoom > 0.5) {
      vec2 e = min(q - room.xy, room.zw - q);
      float m = min(e.x, e.y);
      frame = pxLine(abs(m - 16.0), 0.4, 1.1) * 0.55 + pxLine(abs(m - 22.0), 0.3, 0.8) * 0.3;
      ground = hatch(q.y / 7.0, 0.05) * 0.5;
    }
    if (inSign > 0.5 || cellAt(ivec2(floor((q - org) / cs))).b > 0.5) ground = 0.0;
    float ink = max(max(hedgeInk * inHedge, doorInk * inDoor), max(shInk, ground)) * fall;
    ink = max(ink, frame);
    vec3 col = mix(C_PAPER * (0.985 + 0.03 * snoise(q / 260.0)), C_SEPIA, ink * 0.62);
    // 樹籬裡面比地面暗一點點（整體的明暗，像淡淡的水彩底）
    col *= 1.0 - 0.06 * max(inHedge, inDoor) * fall;
    // 雲的影子：很大、很淡，隨風慢慢飄過地圖（空拍的感覺）；空地上淡一點，字才清楚
    float cloud = smoothstep(0.08, 0.5, fbm(q / 820.0 + vec2(t * 0.018, t * 0.006), 3));
    col *= 1.0 - 0.13 * cloud * (1.0 - 0.6 * max(inRoom, inSign));
    vec4 S = layer(stat, q);
    col = col * (1.0 - S.a) + S.rgb;
    vec4 D = layer(dyn, q);
    col = col * (1.0 - D.a) + D.rgb;
    fragColor = vec4(col, 1.0);
  }`, {
  maze: { value: null }, mzSize: { value: new THREE.Vector2(NC, NR) }, cs: { value: CS }, org: { value: new THREE.Vector2(OX, OY) },
  stat: { value: null }, dyn: { value: null }, camInv: { value: new THREE.Matrix3() },
  room: { value: new THREE.Vector4() }, sign: { value: new THREE.Vector4(-9, -9, -9, -9) }, door: { value: new THREE.Vector4() },
  focus: { value: new THREE.Vector2(W / 2, H / 2) }, t: { value: 0 },
});

type Cell = [number, number];
interface Walker { path: Cell[]; times: number[]; k: number }

export default class Maze extends Scene {
  pass = shared('maze.map', MAP);
  stat = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1) * 31 + (this.msg?.id ?? 0);
  mazeTex!: THREE.DataTexture;
  fit: FitResult | null = null;
  sig = '';
  /** 空地（地圖像素）：x0, y0, x1, y1。 */
  room: [number, number, number, number] = [0, 0, 0, 0];
  sign: [number, number, number, number] = [-9, -9, -9, -9];
  msgX = 0; msgY = 0; sigY = 0; sigX = 0;
  lyrSize = 56; lyrX = 0; lyrY = 0; lyrW = 1200;
  door: [number, number, number] = [0, 0, 0];
  A!: Walker; Bw!: Walker;
  t1 = 0; tMeet = 0; B = 0.5;
  lineT: number[] = [];
  statKey = '';
  meet = { x: 0, y: 0 };
  /** 相遇之後兩個人一起散步的路（從門口的兩格開始），與署名字級。 */
  stroll: Walker | null = null;
  sigSize = 30;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = sigOf(m);
    const hasLyr = lyrics.linesIn(s - 1, e + 1).length > 0;
    // 韓文歌的原文副行：在第一個 await 之前拿（副行開關是引擎在 init 開始前替這個窗格設的）
    const subs = lyrics.linesIn(s - 2, e + 1).map((l) => [l, lyricSubOf(l)] as const).filter((p): p is readonly [Line, Line] => !!p[1]);
    await loadText(`${m?.text ?? ''}${this.sig}${T17_TEXT}${T17_INVITE}${song.title}${song.artist}♪間奏${lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join('')}${subs.map((p) => p[1].text).join('')}`);
    const c = this.stat.ctx;
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 版面（地圖像素 = 鏡頭落定時的螢幕像素）：上面是歌詞立牌，正中間是空地
    const lines = lyrics.linesIn(s - 2, e + 1);
    const signOn = m ? (hasLyr || !lyrics.has) : !lyrics.has;
    let msgSize = 0;
    if (m) {
      // v2：字級上限依字數，照子句斷行；留言區（空地）只比字大一點
      const o = { min: 40, max: msgMaxFor(m.text), lineHeight: 1.3, maxLines: 6 };
      this.fit = fitClauses(c, m.text, FAM_MSG, 700, 290, o) ?? fitText(c, m.text, FAM_MSG, 700, 290, o);
      msgSize = this.fit.size;
      this.sigSize = sigV2(msgSize);
    }
    this.lyrSize = lyricV2(m ? msgSize : null);
    c.font = font(FAM_LYR, this.lyrSize);
    const natural = Math.max(lyrics.has ? 0 : c.measureText(song.title).width * 0.7, ...lines.map((l) => c.measureText(l.text).width));
    // 立牌：在上方，寬度跟著最長的一句（最寬 1400），太長的句子由 layoutLyric 縮小或折兩行
    if (signOn) {
      const sw = clamp(natural + 80, 480, 1000);
      // 長的句子會折成兩行：立牌的高度照這個窗格最多幾行算
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40, maxWidth: sw - 80, lineHeight: 1.14 };
      const rows = Math.max(1, ...lines.map((l) => layoutLyric(c, l, st).rows.length));
      const sh = m ? this.lyrSize * (1 + (rows - 1) * 1.14) + 56 : 110;
      // 右上角（留言在左下，兩組字一左一右，不擠在一起）
      const sx1 = Math.floor((1790 - OX) / CS) * CS + OX;
      this.sign = [sx1 - Math.ceil(sw / CS) * CS, Math.round((112 - OY) / CS) * CS + OY, sx1, 0];
      this.sign[3] = this.sign[1] + Math.ceil(sh / CS) * CS;
      this.lyrW = this.sign[2] - this.sign[0] - 80;
      this.lyrX = this.sign[0] + 40;
      this.lyrY = this.sign[1] + (this.sign[3] - this.sign[1]) / 2;
    }
    // 空地：留言（或沒有留言時的大歌詞）＋署名，吸附到格子上
    let bw: number, bh: number;
    if (m && this.fit) {
      c.font = font(FAM_SIG, this.sigSize);
      bw = Math.max(this.fit.width, c.measureText(this.sig).width) + 84;
      bh = this.fit.height + this.sigSize * 1.9 + 60;
    } else {
      c.font = font(FAM_LYR, this.lyrSize);
      bw = clamp(natural, 520, 700) + 90;
      bh = this.lyrSize * 2.3 + 90;
      // 原文副行讓歌詞變高：空地跟著長高，歌詞＋原文（在空地正中）才不會壓到下面那行邀請。沒有原文時照舊。
      if (subs.length) {
        const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40, maxWidth: bw - 80, lineHeight: 1.14 };
        let h = 0;
        for (const [l, sl0] of subs) {
          const ml = layoutLyric(c, l, st);
          const sl = layoutLyric(c, sl0, subStyleFor(st, ml.size));
          h = Math.max(h, ml.size + ml.rows[ml.rows.length - 1]!.y + subGap(ml.size, sl.size) + sl.rows[sl.rows.length - 1]!.y);
        }
        bh = Math.max(bh, h + 136 - 0.32 * this.lyrSize);
      }
    }
    // 空地在左下角（畫面一側），迷宮佔其他地方
    const rx0 = Math.floor((150 - OX) / CS), rx1 = rx0 + Math.ceil(bw / CS);
    const ry1 = Math.floor((948 - OY) / CS), ry0 = ry1 - Math.ceil(bh / CS);
    this.room = [OX + rx0 * CS, OY + ry0 * CS, OX + rx1 * CS, OY + ry1 * CS];
    if (m && this.fit) {
      const inner = this.room[3] - this.room[1];
      this.msgX = this.room[0] + 42;
      this.msgY = this.room[1] + (inner - (this.fit.height + this.sigSize * 1.9)) / 2 + this.fit.size * 0.86;
      this.sigY = this.msgY + (this.fit.lines.length - 1) * this.fit.lineHeight + this.sigSize * 1.8;
      this.sigX = this.room[2] - 42;
    } else {
      this.lyrW = this.room[2] - this.room[0] - 80;
      this.lyrX = this.room[0] + 40;
      this.lyrY = this.room[1] + (this.room[3] - this.room[1]) / 2 - 10;
    }

    // ---- 迷宮：左右兩半各自用深度優先搜尋長出來，兩半只在空地上方的門口相通
    const dc = Math.round((rx0 + rx1) / 2);
    const dl: Cell = [dc - 1, ry0 - 1], dr: Cell = [dc, ry0 - 1];
    const inRect = (i: number, j: number, r: [number, number, number, number]) => {
      const x = OX + (i + 0.5) * CS, y = OY + (j + 0.5) * CS;
      return x > r[0] && x < r[2] && y > r[1] && y < r[3];
    };
    // 右下角 QR 那一塊也不長迷宮（QR 放在乾淨的紙上，棋子也不會走到 QR 底下）
    const hud: [number, number, number, number] = [1300, 790, W + 400, H + 400];
    const clearing = (i: number, j: number) => (inRect(i, j, this.room) ? 1 : inRect(i, j, this.sign) ? 2 : inRect(i, j, hud) ? 3 : 0);
    const right = Array.from({ length: NC }, () => new Array<boolean>(NR).fill(true));
    const bottom = Array.from({ length: NC }, () => new Array<boolean>(NR).fill(true));
    const region = (i: number) => (i < dc ? 0 : 1);
    const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < NC && j < NR && !clearing(i, j);
    const open = (a: Cell, b: Cell) => {
      if (a[0] === b[0]) bottom[a[0]]![Math.min(a[1], b[1])] = false;
      else right[Math.min(a[0], b[0])]![a[1]] = false;
    };
    const rnd = mulberry32(this.seed);
    const seen = new Set<number>();
    const key = (i: number, j: number) => j * NC + i;
    const grow = (start: Cell) => {
      const stack: Cell[] = [start];
      seen.add(key(...start));
      while (stack.length) {
        const cur = stack[stack.length - 1]!;
        const nb: Cell[] = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
          .map(([a, b]) => [cur[0] + a, cur[1] + b] as Cell)
          .filter(([i, j]) => ok(i, j) && region(i) === region(cur[0]) && !seen.has(key(i, j)));
        if (!nb.length) { stack.pop(); continue; }
        // 偏好直走一點（走廊長一點，看起來像花園而不是一堆碎格子）
        const nxt = nb[Math.floor(rnd() * nb.length)]!;
        open(cur, nxt);
        seen.add(key(...nxt));
        stack.push(nxt);
      }
    };
    grow(dl); grow(dr);
    // 沒長到的零碎格子（被空地切開的角落）也各自長一下，免得變成實心的樹籬塊
    for (let j = 0; j < NR; j++) for (let i = 0; i < NC; i++) if (ok(i, j) && !seen.has(key(i, j))) grow([i, j]);
    open(dl, dr);
    // 空地裡面沒有牆；空地與迷宮之間是樹籬
    for (let j = 0; j < NR; j++) for (let i = 0; i < NC; i++) {
      const k = clearing(i, j);
      if (!k) continue;
      if (i + 1 < NC && clearing(i + 1, j) === k) right[i]![j] = false;
      if (j + 1 < NR && clearing(i, j + 1) === k) bottom[i]![j] = false;
    }
    // 門：空地最上面一排與門口兩格之間的那段樹籬另外畫（會打開）
    bottom[dc - 1]![ry0 - 1] = false;
    bottom[dc]![ry0 - 1] = false;
    this.door = [OX + (dc - 1) * CS, OY + ry0 * CS, OX + (dc + 1) * CS];
    const data = new Uint8Array(NC * NR * 4);
    for (let j = 0; j < NR; j++) for (let i = 0; i < NC; i++) {
      const o = (j * NC + i) * 4;
      data[o] = right[i]![j] ? 255 : 0;
      data[o + 1] = bottom[i]![j] ? 255 : 0;
      data[o + 2] = clearing(i, j) === 3 ? 255 : clearing(i, j) * 60;
      data[o + 3] = 255;
    }
    const tx = (this.mazeTex = this.track(new THREE.DataTexture(data, NC, NR, THREE.RGBAFormat, THREE.UnsignedByteType)));
    tx.magFilter = tx.minFilter = THREE.NearestFilter;
    tx.needsUpdate = true;

    // ---- 兩個人的路：從門口往外做廣度優先搜尋，挑離門口「剛好」那麼遠、又在畫面裡的格子當起點
    this.t1 = beatAfter(au, s + Math.min(0.3, B * 0.6));
    // 一拍一步，走到窗格的七成左右才相遇（整段都在走）
    const nB = clamp(Math.round((0.7 * (e - this.t1)) / B), 4, 28);
    this.tMeet = au.timeOfBeat(au.beatAt(this.t1) + nB);
    const passable = (a: Cell, b: Cell) => (a[0] === b[0] ? !bottom[a[0]]![Math.min(a[1], b[1])] : !right[Math.min(a[0], b[0])]![a[1]]);
    const walk = (door: Cell, side: number, target: number, far = false): Cell[] => {
      const prev = new Map<number, number>();
      const dist = new Map<number, number>([[key(...door), 0]]);
      const q: Cell[] = [door];
      while (q.length) {
        const cur = q.shift()!;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n: Cell = [cur[0] + a, cur[1] + b];
          if (!ok(n[0], n[1]) || region(n[0]) !== side || dist.has(key(...n)) || !passable(cur, n)) continue;
          dist.set(key(...n), dist.get(key(...cur))! + 1);
          prev.set(key(...n), key(...cur));
          q.push(n);
        }
      }
      // 起點：在畫面裡（離邊 150 px）、離門口「剛好」target 步；散步的終點（far）偏好離空地遠一點
      let best: Cell = door, bestS = Infinity;
      for (const [kk, dv] of dist) {
        const i = kk % NC, j = Math.floor(kk / NC);
        const x = OX + (i + 0.5) * CS, y = OY + (j + 0.5) * CS;
        if (x < 170 || x > W - 170 || y < 170 || y > H - 150) continue;
        if (x > 1330 && y > 800) continue;
        // 偏好從畫面的上半部、靠兩側出發：沿著空地的旁邊一路走下來，整段路都看得到
        if (x < this.room[2] + 60 && y > this.room[1] - 60) continue;
        const sc = Math.abs(dv - target) + (far ? -Math.hypot(x - this.room[0], y - this.room[3]) * 0.004 : (side === 0 ? x : W - x) * 0.003 + y * 0.004) + hash(this.seed, kk) * 0.8;
        if (sc < bestS) { bestS = sc; best = [i, j]; }
      }
      const path: Cell[] = [best];
      let cur = key(...best);
      while (prev.has(cur)) { cur = prev.get(cur)!; path.push([cur % NC, Math.floor(cur / NC)]); }
      return path;
    };
    const mk = (path: Cell[]): Walker => {
      const L = path.length - 1;
      const k = Math.max(1, Math.ceil(L / nB));
      const moves = Math.ceil(L / k);
      // 從相遇那一拍往回排：路短的人晚一點出發，兩個人同一拍到
      const times = Array.from({ length: moves }, (_, i) => au.timeOfBeat(au.beatAt(this.tMeet) - (moves - i)));
      return { path, times, k };
    };
    const target = Math.max(10, nB * 1.6);
    this.A = mk(walk(dl, 0, target));
    this.Bw = mk(walk(dr, 1, target));
    this.meet = { x: OX + dc * CS, y: OY + (ry0 - 0.5) * CS };
    // 相遇之後：兩個人一起往右邊的迷宮裡散步（一拍一格，一前一後），路是從門口往外的一條
    const ts: number[] = [];
    for (let k = Math.ceil(au.beatAt(this.tMeet + B * 1.5) - 1e-6); ts.length < 40; k++) {
      const tb = au.timeOfBeat(k);
      if (tb > e - B * 0.5) break;
      ts.push(tb);
    }
    if (ts.length >= 2) {
      const out = walk(dr, 1, ts.length, true).reverse();
      const path: Cell[] = [dl, ...out].slice(0, ts.length + 2);
      this.stroll = { path, times: ts.slice(0, path.length - 2), k: 1 };
    }

    // ---- 留言一行一行印上去（第一小節內），署名跟著最後一行
    const nl = this.fit ? this.fit.lines.length : 0;
    const step = nl > 3 ? B / 2 : B;
    this.lineT = Array.from({ length: nl + 1 }, (_, i) => this.t1 + i * step);
  }

  /** 棋子在時間 t 的位置（沿著路徑的格數，小數）。每一拍走 k 格，拍點後很快走完。 */
  private at(w: Walker, t: number) {
    let idx = 0;
    const L = w.path.length - 1;
    w.times.forEach((tt, i) => { idx += Math.min(w.k, L - i * w.k) * ease.outCubic(prog(t, tt, tt + this.B * 0.42)); });
    return clamp(idx, 0, L);
  }
  private cellXY(w: Walker, f: number) {
    const i = Math.floor(f), k = f - i;
    const a = w.path[Math.min(i, w.path.length - 1)]!, b = w.path[Math.min(i + 1, w.path.length - 1)]!;
    return { x: OX + (lerp(a[0], b[0], k) + 0.5) * CS, y: OY + (lerp(a[1], b[1], k) + 0.5) * CS };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const m = this.msg;

    // ---- 留言（變的時候才重畫：一行一行印上去的那幾格）
    const alphas = this.lineT.map((tt) => ease.outCubic(prog(t, tt, tt + 0.14)));
    const key = alphas.map((a) => a.toFixed(3)).join(',');
    if (key !== this.statKey) {
      this.statKey = key;
      const L = this.stat;
      L.clear();
      const c = L.ctx;
      if (m && this.fit) {
        c.font = font(FAM_MSG, this.fit.size);
        this.fit.lines.forEach((ln, i) => {
          const a = alphas[i]!;
          if (a <= 0) return;
          c.save();
          c.globalAlpha = a;
          c.fillStyle = rgba('sepia', 0.94);
          c.translate(0, (1 - a) * 6);
          fillWithHearts(c, ln, this.msgX, this.msgY + i * this.fit!.lineHeight);
          c.restore();
        });
        const a = alphas[alphas.length - 1]!;
        if (a > 0) {
          c.globalAlpha = a;
          c.fillStyle = rgba('sepia', 0.8);
          c.font = font(FAM_SIG, this.sigSize);
          c.textAlign = 'right';
          c.fillText(this.sig, this.sigX, this.sigY);
          c.textAlign = 'left';
          c.globalAlpha = 1;
        }
      }
    }

    // ---- 歌詞、足跡、棋子、愛心
    const D = this.dyn;
    D.clear();
    const c = D.ctx;
    this.drawLyricAt(c, t);
    const walkers: [Walker, string, string][] = [[this.A, sigInk(0.95), sigInk(0.7)], [this.Bw, rgba('sepia', 0.92), rgba('sepia', 0.55)]];
    const met = t >= this.tMeet;
    // 散步中：兩個人沿著同一條路走（A 在後面一格），足跡用兩人的顏色交錯
    const S = this.stroll;
    const strolling = S && t >= S.times[0]! ? S : null;
    if (strolling) {
      const si = this.at(strolling, t);
      c.fillStyle = sigInk(0.6);
      let acc = 0, px = this.cellXY(strolling, 1);
      for (let x = 1.08; x <= si + 1; x += 0.08) {
        const p = this.cellXY(strolling, x);
        acc += Math.hypot(p.x - px.x, p.y - px.y);
        px = p;
        if (acc >= 12) { acc = 0; c.beginPath(); c.arc(p.x, p.y, 2.4, 0, Math.PI * 2); c.fill(); }
      }
    }
    walkers.forEach(([w, col, trail], wi) => {
      let fi = this.at(w, t);
      // 足跡：走過的路一點一點（每 12 px 一個點）
      c.fillStyle = trail;
      let acc = 0, px = this.cellXY(w, 0);
      for (let x = 0.08; x <= fi; x += 0.08) {
        const p = this.cellXY(w, x);
        acc += Math.hypot(p.x - px.x, p.y - px.y);
        px = p;
        if (acc >= 12) { acc = 0; c.beginPath(); c.arc(p.x, p.y, 2.6, 0, Math.PI * 2); c.fill(); }
      }
      // 棋子：俯看的圓形棋子（影子、外圈、中間一個小凹），走的那一下稍微浮起來
      let p = this.cellXY(w, fi);
      let lift = w.times.reduce((a, tt) => a + Math.sin(Math.PI * clamp((t - tt) / (this.B * 0.42))), 0);
      if (strolling) {
        fi = this.at(strolling, t) + (wi === 0 ? 0 : 1);
        p = this.cellXY(strolling, fi);
        lift = strolling.times.reduce((a, tt) => a + Math.sin(Math.PI * clamp((t - tt - wi * 0.06) / (this.B * 0.42))), 0);
      }
      c.fillStyle = rgba('sepia', 0.2);
      c.beginPath(); c.arc(p.x + 5 + lift * 4, p.y + 7 + lift * 5, 17, 0, Math.PI * 2); c.fill();
      c.fillStyle = col;
      c.beginPath(); c.arc(p.x, p.y - lift * 2, 17 + lift * 1.5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba('paper', 0.85); c.lineWidth = 2;
      c.beginPath(); c.arc(p.x, p.y - lift * 2, 11, 0, Math.PI * 2); c.stroke();
    });
    // 相遇：兩顆棋子中間冒出一顆愛心（點綴色），往上飄一點停住
    if (met) {
      const k = ease.outBack(clamp((t - this.tMeet) / 0.35), 2.2);
      const y = this.meet.y - 40 - 26 * ease.outCubic(clamp((t - this.tMeet) / 0.6));
      drawHeart(c, this.meet.x, y, 38 * k, rgba('rose'));
    }

    // ---- 鏡頭：切進來高一點、歪一點 → 第一拍落定 → 慢慢推近；相遇時輕輕一推
    const land = ease.outExpo(prog(t, s, this.t1 + this.B * 0.5));
    const push = ease.inOutQuad(prog(t, this.t1, e));
    const sc = lerp(0.9, 1, land) * (1 + 0.035 * push + 0.012 * pulse(t, this.tMeet, 0.2));
    const rot = lerp(-0.07, 0, land) + 0.012 * (push - 0.5);
    const cx = W / 2, cy = H / 2;
    // 螢幕 → 地圖：q = c + R(-rot)(p - c) / sc
    const cs = Math.cos(-rot) / sc, sn = Math.sin(-rot) / sc;
    const Mi = new THREE.Matrix3().set(cs, -sn, cx - cs * cx + sn * cy, sn, cs, cy - sn * cx - cs * cy, 0, 0, 1);
    const P = this.pass;
    P.u.maze!.value = this.mazeTex;
    P.u.stat!.value = this.stat.upload();
    P.u.dyn!.value = D.upload();
    (P.u.camInv!.value as THREE.Matrix3).copy(Mi);
    (P.u.room!.value as THREE.Vector4).set(...this.room);
    (P.u.sign!.value as THREE.Vector4).set(...this.sign);
    (P.u.door!.value as THREE.Vector4).set(this.door[0], this.door[1], this.door[2], ease.outCubic(prog(t, this.tMeet, this.tMeet + this.B)));
    (P.u.focus!.value as THREE.Vector2).set(W * 0.55, H * 0.45);
    P.u.t!.value = t;
    P.render(renderer, out);

    const amp = 4 * pulse(t, this.tMeet, 0.08);
    const ph = frameIdx(t);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.04, vignette: 0.3, grain: 0.05, ca: 0.3, shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2] };
  }

  /** 歌詞：有留言時在上方立牌；沒有留言時在空地正中（大）。純音樂寫歌名。 */
  private drawLyricAt(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ink = paperInk();
    if (!lyrics.has) {
      // 純音樂：有留言時上方立牌寫小小的歌名；沒有留言時歌名大大地在空地上
      c.fillStyle = rgba('sepia', 0.75);
      if (this.msg) { c.font = font(F.mono(500), 22); c.letterSpacing = '4px'; }
      else c.font = font(FAM_LYR, this.lyrSize * 0.8);
      c.fillText(`♪ ${song.title}`, this.lyrX, this.lyrY + (this.msg ? 8 : this.lyrSize * 0.3), this.lyrW);
      c.letterSpacing = '0px';
      if (this.msg) return;
    }
    const ly = lyrics.has ? lyricAt(lyrics, t) : null;
    if (ly) {
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40, maxWidth: this.lyrW, active: ink.active, sung: ink.sung, unsung: ink.unsung, lineHeight: 1.14 };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(this.lyrX, this.lyrY - lay.height / 2 + lay.size * 0.84);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    }
    if (!this.msg) {
      c.fillStyle = rgba('sepia', 0.5);
      c.font = font(F.hei(500), 20);
      c.letterSpacing = '3px';
      c.fillText(T17_INVITE, this.lyrX, this.room[3] - 44);
      c.letterSpacing = '0px';
    }
  }
}
