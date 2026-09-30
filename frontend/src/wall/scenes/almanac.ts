// 農民曆（亮）：牆上掛著一本撕頁日曆（three.js 3D），鏡頭斜斜地看著它。
//  - 窗格開始時日曆還停在婚禮的前一兩天（3/11、3/12：宜試穿禮服、忌偷吃喜餅之類的冷面宜忌與運勢），
//    在小節線上一頁一頁被「撕」下來：紙從下緣掀起、繞著一條看不見的滾筒往上捲、翻過頂端的撕線、甩出畫面（真的 3D 彎曲的紙，有打光）。
//  - 撕到 3/13（星期六、紅字、宜：嫁娶・祝福・乾杯）那一頁：「今日運勢」就是主打留言（手寫，這一張的焦點），鏡頭同時慢慢推近到運勢那一塊。
//    下一個小節線，紅色麥克筆在日期外面圈一圈；再下一個小節線，圈圈旁邊畫一顆愛心。
//  - 歌詞是每一頁的「今日一句」，照跟唱規則逐字亮（撕掉的那一頁上的歌詞停在它被撕的那一刻）。
//  - 大大的日期數字用細的字重、訊號色的淡墨，是圖形不是標題；推近之後它一半在畫面外。
//  - 沒有留言：運勢寫邀請；新人的留言：運勢的標籤改成「新人的話」。純音樂：「今日一句」寫歌名。
// 畫法：牆（燈光、壁紙的細紋、日曆的影子）是全螢幕 shader；日曆是 three.js：背板、一疊紙（側面有一頁一頁的紙邊）、
// 最上面一頁、正在撕的那一頁（頂點 shader 做捲曲、法向量從螢幕導數算打光）。頁面的字畫在 Canvas（fast 上傳，shader 自己解碼）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { drawLyric, drawMessage, drawHeart, lyricAt, lyricSubOf, signature, WEDDING_DATE } from './_motifs';
import { grid, boxLyric, mono, tag, pad3, paperLyric, fiberTex, withMips, windowLines, type Grid } from './_t3';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.2, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 尺寸（世界座標 = 推近前大約的螢幕 px；頁面座標 y 向下）
const PW = 700, PH = 860;
const BOARD = { w: PW + 70, top: 200, bot: 36 }; // 背板比紙多出來的部分（上面是紅色的抬頭）
const PAD_D = 34; // 一疊紙的厚度
const TS = SCALE * 1.5; // 頁面貼圖每個頁面 px 幾個像素（鏡頭會推近）
const LYR_FAM = F.archivo(100, 700);
const MSG_FAM = F.hand(400);
const LYR_BOX = { x: 30, y: 352, w: PW - 60, h: 112 };
const FORTUNE = { x: 30, y: 492, w: PW - 60, h: 330 };
/** 推近到運勢之後，頁面 1 px 在螢幕上約 K px（v2 的字級是螢幕 px，排版時用它換算）。 */
const K = 1.06;
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const WD_EN = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
/** 婚禮前幾天的冷面宜忌與運勢（離婚禮幾天 → 內容）。 */
const BEFORE: Record<number, { yi: string; ji: string; fortune: string[] }> = {
  2: { yi: '試穿禮服・排座位', ji: '熬夜', fortune: ['中吉。', '座位表改到第十七版，', '一切都會好的。'] },
  1: { yi: '彩排・早睡', ji: '偷吃喜餅', fortune: ['大吉。', '明天會是很好的一天。'] },
};
const FIXED = '民國一一六年丁未年三月星期日一二三四五六宜忌今日一句今日運勢新人的話試穿禮服排座位熬夜中吉座位表改到第十七版一切都會好的彩排早睡偷吃喜餅大吉明天會是很好的一天嫁娶祝福乾杯早退掃描右下角把你的祝福寫進今天純音樂日日是好日';

// ---------------------------------------------------------------- 牆
const WALL = () => new FSPass(/* glsl */ `
  uniform sampler2D fiber; uniform vec4 shadowRect; uniform float t;
  uniform vec3 clock; uniform vec3 hands; // 牆上的掛鐘：螢幕位置與半徑；時針、分針、秒針的角度（12 點鐘方向為 0，順時針）
  float hand(vec2 p, float a, float len, float w) {
    vec2 d = vec2(sin(a), -cos(a));
    return 1.0 - smoothstep(w * 0.5 - 0.8, w * 0.5 + 0.8, sdSegment(p, -d * len * 0.18, d * len));
  }
  void main() {
    vec2 s = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec4 fb = texture(fiber, vUv);
    // 牆：比紙暗一點的暖色，很細的直紋壁紙，左上方的燈
    vec3 col = mix(C_PAPER, C_SEPIA, 0.2) * (0.94 + 0.05 * (fb.r - 0.5));
    col *= 1.0 - 0.025 * smoothstep(0.3, 0.5, abs(fract(s.x / 14.0) - 0.5));
    vec2 lq = (s - vec2(640.0, 260.0)) / vec2(1200.0, 900.0);
    col *= 0.7 + 0.42 * exp(-dot(lq, lq) * 1.6);
    // 窗戶照進來的一塊光（右邊的牆），窗外的樹葉讓光慢慢晃：畫面一直有空氣在動
    vec2 wq = s - vec2(1480.0 + 40.0 * sin(t * 0.13), 560.0);
    wq = vec2(wq.x + wq.y * 0.35, wq.y);
    float win = (1.0 - smoothstep(170.0, 230.0, abs(wq.x))) * (1.0 - smoothstep(250.0, 320.0, abs(wq.y)));
    // 窗框的十字影子
    float mull = max(1.0 - smoothstep(3.0, 9.0, abs(wq.x)), 1.0 - smoothstep(3.0, 9.0, abs(wq.y)));
    float leaf = smoothstep(-0.15, 0.35, fbm(s / 240.0 + vec2(t * 0.05, t * 0.03), 3));
    col *= 1.0 + 0.1 * win * (1.0 - 0.8 * mull) * (0.45 + 0.55 * leaf);
    // 日曆在牆上的影子：往右下、很軟
    vec2 c = (shadowRect.xy + shadowRect.zw) * 0.5 + vec2(26.0, 34.0), h = (shadowRect.zw - shadowRect.xy) * 0.5;
    float d = sdBox(s - c, h);
    col *= 1.0 - 0.34 * (1.0 - smoothstep(-30.0, 60.0, d));
    // 掛鐘：影子、鐘面、刻度、時針分針、訊號色的秒針（每一拍跳一格）
    vec2 cp = s - clock.xy; float R = clock.z;
    float cd = length(cp);
    col *= 1.0 - 0.22 * (1.0 - smoothstep(R * 0.9, R * 1.25, length(cp - vec2(R * 0.12, R * 0.16))));
    if (cd < R * 1.02) {
      vec3 face = mix(C_PAPER, C_BONE, 0.35);
      float rim = smoothstep(R * 0.9, R * 0.93, cd);
      vec3 cc = mix(face, mix(C_SEPIA, C_PAPER, 0.35), rim);
      float ang = atan(cp.x, -cp.y);
      float tick = 1.0 - smoothstep(0.5, 1.5, abs(fract(ang / (TAU / 12.0) + 0.5) - 0.5) * (TAU / 12.0) * cd);
      tick *= smoothstep(R * 0.72, R * 0.74, cd) * (1.0 - smoothstep(R * 0.84, R * 0.86, cd));
      cc = mix(cc, C_SEPIA, tick * 0.8);
      cc = mix(cc, C_SEPIA, hand(cp, hands.x, R * 0.45, R * 0.06));
      cc = mix(cc, C_SEPIA, hand(cp, hands.y, R * 0.66, R * 0.04));
      cc = mix(cc, C_BLOOD, hand(cp, hands.z, R * 0.74, R * 0.018));
      cc = mix(cc, C_BLOOD, 1.0 - smoothstep(R * 0.035, R * 0.045, cd));
      col = mix(col, cc, 1.0 - smoothstep(R - 1.0, R + 1.0, cd));
    }
    fragColor = vec4(col, 1.0);
  }`, { fiber: { value: null }, shadowRect: { value: new THREE.Vector4(0, 0, 1, 1) }, t: { value: 0 }, clock: { value: new THREE.Vector3(1600, 300, 100) }, hands: { value: new THREE.Vector3() } });

// ---------------------------------------------------------------- 3D 的紙
const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
uniform float uYc; uniform float uR; uniform float uHalfH;
out vec3 vWP; out vec2 vUv; out vec3 vLP;
void main() {
  vec3 p = position;
  // 捲曲：離上緣 u 的地方，超過滾筒線 yc 的部分繞著半徑 R 的滾筒往上捲（往鏡頭這邊掀起來、翻過去）
  float u = uHalfH - p.y;
  if (u > uYc) {
    float s = u - uYc, phi = s / uR;
    if (phi < 3.14159265) { u = uYc + uR * sin(phi); p.z += uR * (1.0 - cos(phi)); }
    else { u = uYc - (s - 3.14159265 * uR); p.z += 2.0 * uR; }
    p.y = uHalfH - u;
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWP = wp.xyz; vUv = uv; vLP = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vWP; in vec2 vUv; in vec3 vLP;
out vec4 fragColor;
uniform vec3 cameraPosition;
uniform sampler2D uTex; uniform sampler2D uFiber; uniform float uMode; uniform float uAlpha; uniform float uJag; uniform float uShade; uniform float uSh;
${GLSL_COMMON}
void main() {
  // 撕下來的那一頁：上緣是撕開的鋸齒
  if (uJag > 0.5 && vUv.y > 1.0 - (0.004 + 0.01 * hash11(floor(vUv.x * 70.0)))) discard;
  vec3 n = normalize(cross(dFdx(vWP), dFdy(vWP)));
  if (dot(n, cameraPosition - vWP) < 0.0) n = -n;
  vec3 L = normalize(vec3(-0.45, 0.55, 0.8));
  // 捲起來的地方要看得出是圓的：打光的對比拉大一點
  float lam = 0.62 + 0.46 * max(dot(n, L), 0.0);
  vec4 fb = texture(uFiber, fract(vUv * vec2(0.37, 0.8)));
  vec3 col;
  if (uMode < 0.5) {
    // 頁面：fast 的 Canvas（預乘、sRGB 編碼），自己解；背面是空白的紙
    vec4 c = texture(uTex, vUv);
    vec3 front = c.a > 0.0 ? toLinear(c.rgb / c.a) : C_PAPER;
    // 背面：薄薄的日曆紙，正面的字反過來透一點點
    col = gl_FrontFacing ? front : mix(mix(C_PAPER, C_SEPIA, 0.1), front, 0.14);
    col *= 0.95 + 0.1 * (fb.r - 0.5) + 0.05 * (fb.g - 0.5);
    // 上面那一頁捲起來的地方投在這一頁的影子（捲筒底下最暗）
    if (uSh < 9e4) { float uu = (1.0 - vUv.y) * ${PH}.0; col *= 1.0 - 0.32 * exp(-pow((uu - uSh - 30.0) / 80.0, 2.0)); }
  } else if (uMode < 1.5) {
    // 一疊紙的側面：一頁一頁的紙邊
    float lines = 1.0 - 0.18 * smoothstep(0.35, 0.5, abs(fract(vLP.z / 1.7) - 0.5));
    col = mix(C_PAPER, C_SEPIA, 0.1) * lines;
  } else {
    // 背板（Canvas）
    vec4 c = texture(uTex, vUv); col = c.a > 0.0 ? toLinear(c.rgb / c.a) : C_PAPER;
    col *= 0.96 + 0.08 * (fb.r - 0.5);
  }
  col *= uShade;
  fragColor = vec4(col * lam * uAlpha, uAlpha);
}`;

/** 一頁日曆的內容（第幾天）。 */
interface Day { date: Date; offset: number }

export default class Almanac extends Scene {
  wall = shared('almanac.wall', WALL);
  scene3 = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(22, W / H, 10, 20000);
  page = this.track(withMips(new Layer2D(PW, PH, TS, { fast: true })));
  tear = this.track(withMips(new Layer2D(PW, PH, TS, { fast: true })));
  board = this.track(new Layer2D(BOARD.w, PH + BOARD.top + BOARD.bot, SCALE, { fast: true }));
  mats: THREE.RawShaderMaterial[] = [];
  geoms: THREE.BufferGeometry[] = [];
  pageMesh!: THREE.Mesh; tearMesh!: THREE.Mesh; pad!: THREE.Mesh; boardMesh!: THREE.Mesh;
  pageMat!: THREE.RawShaderMaterial; tearMat!: THREE.RawShaderMaterial;
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  days: Day[] = [];
  tears: number[] = [];
  tearDur = 0.5;
  arrive = 0;
  tCircle = Infinity; tHeart = Infinity;
  fit: FitResult | null = null;
  sigSize = 30;
  lines: Line[] = [];
  /** 韓文歌有原文副行時，「今日一句」多給的高度（今日運勢跟著往下挪）；沒有副行是 0，版面跟原本一樣。 */
  subRoom = 0;
  private boardDrawn = false;

  constructor(ctx: ConstructorParameters<typeof Scene>[0]) {
    super(ctx);
    const mk = (mode: number, o: Partial<THREE.ShaderMaterialParameters> = {}) => {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { ...THEME_UNIFORMS, uTex: { value: null }, uFiber: { value: null }, uMode: { value: mode }, uAlpha: { value: 1 }, uJag: { value: 0 }, uShade: { value: 1 }, uSh: { value: 1e5 }, uYc: { value: 1e5 }, uR: { value: 40 }, uHalfH: { value: PH / 2 } },
        side: THREE.DoubleSide, depthTest: true, depthWrite: true, ...o,
      });
      this.mats.push(m);
      return m;
    };
    this.pageMat = mk(0); this.pageMat.uniforms.uTex!.value = this.page.texture;
    this.tearMat = mk(0, { transparent: true }); this.tearMat.uniforms.uTex!.value = this.tear.texture;
    const padMat = mk(1), boardMat = mk(2);
    boardMat.uniforms.uTex!.value = this.board.texture;
    const pg = new THREE.PlaneGeometry(PW, PH, 1, 48), tg = new THREE.PlaneGeometry(PW, PH, 1, 64);
    const bg = new THREE.PlaneGeometry(BOARD.w, PH + BOARD.top + BOARD.bot);
    const box = new THREE.BoxGeometry(PW, PH, PAD_D);
    this.geoms.push(pg, tg, bg, box);
    this.pageMesh = new THREE.Mesh(pg, this.pageMat);
    this.pageMesh.position.set(0, 0, PAD_D + 0.4);
    this.tearMesh = new THREE.Mesh(tg, this.tearMat);
    this.tearMesh.renderOrder = 10;
    this.pad = new THREE.Mesh(box, padMat);
    this.pad.position.set(0, 0, PAD_D / 2);
    this.boardMesh = new THREE.Mesh(bg, boardMat);
    this.boardMesh.position.set(0, (BOARD.top - BOARD.bot) / 2, -2);
    for (const o of [this.boardMesh, this.pad, this.pageMesh, this.tearMesh]) { o.frustumCulled = false; this.scene3.add(o); }
  }

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const m = this.msg;
    this.lines = windowLines(lyrics, s, e);
    // 原文副行要多一排。
    // 有副行一定沒有主打留言（留言的窗格副行收起來），今日運勢下面本來就空著，往下挪不會擠到東西
    this.subRoom = this.lines.some((l) => lyricSubOf(l)) ? 64 : 0;
    await loadText(`${FIXED}${song.title}${m ? m.text + signature(m.name) : ''}${this.lines.map((l) => l.text).join('')}`);
    // 撕幾頁：窗格有四小節以上撕兩頁（3/11 → 3/12 → 3/13），短的撕一頁；第一撕在第一個小節線，第二撕在下一個小節線
    const bars = (e - g.bar0) / g.bar;
    const k = bars >= 3.5 ? 2 : 1;
    this.tearDur = clamp(g.beat * 1.35, 0.45, 0.72);
    this.tears = Array.from({ length: k }, (_, i) => g.bar0 + i * g.bar);
    const [yy, mm, dd] = String(WEDDING_DATE).split('-').map(Number) as [number, number, number];
    this.days = Array.from({ length: k + 1 }, (_, i) => ({ date: new Date(Date.UTC(yy, mm - 1, dd - (k - i))), offset: k - i }));
    this.arrive = this.tears[k - 1]! + this.tearDur * 0.5;
    // 到了婚禮那一頁之後：下一個小節線圈日期、再下一個畫愛心（窗格不夠長就不畫）
    const nb = au.timeOfBar(Math.ceil(au.barAt(this.arrive + 0.2) - 1e-6));
    if (nb < e - g.beat) this.tCircle = nb;
    if (nb + g.bar < e - g.beat) this.tHeart = nb + g.bar;
    if (m) {
      // v2：字級是螢幕 px（40～60，依字數），換成頁面 px；可用高度先扣掉署名，署名永遠在最後一行下面
      const c = this.page.ctx;
      const max = msgMaxFor(m.text) / K, sigEst = sigV2(msgMaxFor(m.text)) / K;
      const boxH = FORTUNE.h - 44 - (sigEst * 1.5 + max * 0.3);
      const opt = { min: V2.msgMin / K, max, lineHeight: 1.24, maxLines: 5 };
      const byW = fitText(c, m.text, MSG_FAM, FORTUNE.w, boxH, opt);
      const byC = fitClauses(c, m.text, MSG_FAM, FORTUNE.w, boxH, opt);
      this.fit = byC && byC.size >= byW.size * 0.9 ? byC : byW;
      this.sigSize = sigV2(this.fit.size * K) / K;
    }
  }

  override dispose() {
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) m.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------ 頁面內容
  /** 畫第 i 頁（t：歌詞的時間；撕掉的那一頁停在它被撕的那一刻）。 */
  private drawPage(c: CanvasRenderingContext2D, i: number, t: number) {
    const day = this.days[i]!, wed = day.offset === 0;
    const d = day.date, wd = d.getUTCDay();
    const ink = (a: number) => rgba('sepia', a);
    const red = wed || wd === 0;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = rgba('paper'); c.fillRect(0, 0, PW, PH);
    c.textBaseline = 'alphabetic';
    // 抬頭：年、月（小）
    mono(c, `${d.getUTCFullYear()}`, 30, 50, { size: 22, color: ink(0.75), tracking: 3, weight: 600 });
    tag(c, '民國一一六年　丁未年', 104, 49, { size: 16, color: ink(0.55), tracking: 2 });
    tag(c, `${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][d.getUTCMonth()]}月`, PW - 30, 50, { size: 22, color: ink(0.8), tracking: 4, align: 'right', weight: 700 });
    c.fillStyle = ink(0.35); c.fillRect(30, 64, PW - 60, 1.2);
    // 日期：細的字重、淡墨（圖形，不是標題）
    c.font = font(F.archivo(62, 300), 300);
    c.fillStyle = red ? mixRgba('paper', 'signal', 0.7) : mixRgba('paper', 'sepia', 0.55);
    c.fillText(String(d.getUTCDate()), 22, 330);
    // 星期、宜忌
    const rx = 400;
    c.font = font(F.ming(700), 34); c.fillStyle = red ? rgba('blood', 0.9) : ink(0.85);
    c.fillText(`星期${WD[wd]}`, rx, 128);
    mono(c, WD_EN[wd]!, rx, 156, { size: 13, color: ink(0.5), tracking: 4 });
    const yi = wed ? '嫁娶・祝福・乾杯' : BEFORE[day.offset]?.yi ?? '祝福', ji = wed ? '早退' : BEFORE[day.offset]?.ji ?? '—';
    const badge = (ch: string, y: number, col: string) => {
      c.fillStyle = col; c.beginPath(); c.arc(rx + 16, y - 8, 17, 0, Math.PI * 2); c.fill();
      c.font = font(F.hei(900), 20); c.fillStyle = rgba('paper'); c.textAlign = 'center'; c.fillText(ch, rx + 16, y - 1); c.textAlign = 'left';
    };
    badge('宜', 222, rgba('blood', 0.85));
    tag(c, yi, rx + 46, 221, { size: 20, color: ink(0.85), tracking: 1 });
    badge('忌', 272, ink(0.7));
    tag(c, ji, rx + 46, 271, { size: 20, color: ink(0.75), tracking: 1 });
    c.fillStyle = ink(0.3); c.fillRect(30, 338, PW - 60, 1.2);
    // 今日一句（歌詞）
    const LB = { ...LYR_BOX, h: LYR_BOX.h + this.subRoom }, FY = FORTUNE.y + this.subRoom;
    tag(c, '今日一句', LB.x, LB.y + 14, { size: 15, color: ink(0.5), tracking: 4 });
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) {
      const lay = boxLyric(c, ly.line, LYR_FAM, LB.w, LB.h - 26, { min: V2.lyrMin / K, max: lyricV2(this.fit ? this.fit.size * K : null) / K, lineHeight: 1.12, maxLines: 2 });
      const y0 = LB.y + 26 + Math.max(0, (LB.h - 26 - lay.height) / 2) + lay.size * 0.8;
      c.save(); c.translate(LYR_BOX.x, y0);
      drawLyric(c, ly.line, t, { family: LYR_FAM, size: lay.size, maxWidth: LYR_BOX.w, ...paperLyric() }, lay, ly.k);
      c.restore();
    } else if (!this.lines.length) {
      c.font = font(F.serif(400, true), 34); c.fillStyle = ink(0.6);
      c.fillText(`♪ ${this.ctx.song.title || '純音樂'}`, LYR_BOX.x, LYR_BOX.y + 84);
    }
    c.fillStyle = ink(0.3); c.fillRect(30, FY - 14, PW - 60, 1.2);
    // 今日運勢
    const m = this.msg;
    tag(c, wed && m?.couple ? '新人的話' : '今日運勢', FORTUNE.x, FY + 18, { size: 15, color: ink(0.5), tracking: 4 });
    if (wed && m && this.fit) {
      const fit = this.fit;
      const top = FORTUNE.y + 44 + fit.size * 0.88;
      drawMessage(c, fit, MSG_FAM, FORTUNE.x, top, { color: ink(0.94) });
      // 署名（v2：26～32 px）：最後一行的基線往下讓出下伸部再放
      c.font = font(MSG_FAM, this.sigSize); c.fillStyle = ink(0.7); c.textAlign = 'right';
      c.fillText(signature(m.name), FORTUNE.x + Math.max(fit.width, FORTUNE.w * 0.6), top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize * 1.15);
      c.textAlign = 'left';
      mono(c, `NO.${pad3(m.n)}`, FORTUNE.x + FORTUNE.w, FORTUNE.y + 16, { size: 12, color: ink(0.4), align: 'right', tracking: 3 });
    } else if (wed) {
      c.font = font(MSG_FAM, 54); c.fillStyle = ink(0.9);
      c.fillText('大吉。', FORTUNE.x, FY + 110);
      c.font = font(MSG_FAM, 40); c.fillStyle = ink(0.8);
      c.fillText('掃描右下角 QR code，', FORTUNE.x, FY + 176);
      c.fillText('把你的祝福寫進今天。', FORTUNE.x, FY + 230);
    } else {
      const f = BEFORE[day.offset]?.fortune ?? ['大吉。'];
      c.font = font(MSG_FAM, 48); c.fillStyle = ink(0.88);
      f.forEach((s, j) => c.fillText(s, FORTUNE.x, FY + 100 + j * 62));
    }
    // 婚禮那一頁：麥克筆圈日期、畫愛心
    if (wed) {
      const u = prog(t, this.tCircle, this.tCircle + this.g.beat * 0.6, ease.inOutCubic);
      if (u > 0) {
        c.strokeStyle = rgba('blood', 0.6); c.lineWidth = 5; c.lineCap = 'round'; // 圈圈是點綴，不要搶留言
        c.beginPath();
        const n = 60, cx = 180, cy = 210, rx2 = 170, ry2 = 142;
        for (let j = 0; j <= n * u * 1.1; j++) {
          const a = -2.2 + (j / n) * Math.PI * 2 * 1.08;
          const wob = 1 + 0.03 * Math.sin(j * 0.21 + 1) + 0.025 * (j / n); // 手畫的圈：慢慢歪、收尾的地方比較外面
          const x = cx + Math.cos(a) * rx2 * wob, y = cy + Math.sin(a) * ry2 * wob;
          if (j === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
      const hv = prog(t, this.tHeart, this.tHeart + 0.2, ease.outBack);
      if (hv > 0) drawHeart(c, 348, 92, 44 * hv);
    }
  }

  private drawBoard() {
    const c = this.board.ctx, bw = BOARD.w, bh = PH + BOARD.top + BOARD.bot;
    c.fillStyle = mixRgba('paper', 'sepia', 0.16); c.fillRect(0, 0, bw, bh);
    // 抬頭：紅色的一塊、小小的字、掛繩的孔
    c.fillStyle = mixRgba('blood', 'signal', 0.35); c.fillRect(0, 0, bw, BOARD.top - 24);
    c.fillStyle = rgba('paper', 0.9);
    c.font = font(F.ming(900), 34); c.textAlign = 'center';
    c.fillText('日 日 是 好 日', bw / 2, 128);
    c.font = font(F.mono(500), 16); c.letterSpacing = '6px';
    c.fillText('2027 · 喜', bw / 2, 158);
    c.letterSpacing = '0px'; c.textAlign = 'left';
    c.fillStyle = mixRgba('sepia', 'ink', 0.4); c.beginPath(); c.arc(bw / 2, 44, 11, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('paper', 0.5); c.beginPath(); c.arc(bw / 2 - 3, 41, 4, 0, Math.PI * 2); c.fill();
    this.board.upload();
  }

  // ------------------------------------------------------------ 鏡頭與撕頁
  /** 第 j 撕的進度（0..1），沒在撕回傳 -1。 */
  private tearU(j: number, t: number) { const t0 = this.tears[j]!; return t < t0 ? -1 : t > t0 + this.tearDur ? 2 : (t - t0) / this.tearDur; }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    if (!this.boardDrawn) { this.drawBoard(); this.boardDrawn = true; }
    // 現在最上面（或正在被撕的那一頁底下）是第幾頁；正在撕的是哪一頁
    let top = 0, tearing = -1, tu = 0;
    this.tears.forEach((_, j) => { const u = this.tearU(j, t); if (u >= 0) top = j + 1; if (u >= 0 && u <= 1) { tearing = j; tu = u; } });
    this.drawPage(this.page.ctx, top, t);
    this.page.upload();
    if (tearing >= 0) { this.drawPage(this.tear.ctx, tearing, this.tears[tearing]!); this.tear.upload(); }
    // 撕：先從下緣掀起、往上捲過頂端（前 70%），再甩出去（後 45%，重疊一點）
    this.tearMesh.visible = tearing >= 0;
    if (tearing >= 0) {
      const curl = ease.inOutCubic(clamp(tu / 0.7));
      const R = 60;
      this.tearMat.uniforms.uYc!.value = lerp(PH + 10, -R * 1.2, curl);
      this.tearMat.uniforms.uR!.value = R;
      const v = clamp((tu - 0.55) / 0.45);
      const fly = ease.inCubic(v);
      this.tearMesh.position.set(fly * 520, fly * 760, PAD_D + 0.8 + fly * 260);
      this.tearMesh.rotation.set(0, 0, -fly * 0.7);
      this.tearMat.uniforms.uJag!.value = tu > 0.5 ? 1 : 0;
      this.tearMat.uniforms.uAlpha!.value = 1 - clamp((v - 0.7) / 0.3);
      // 正在撕的那一頁底下那一頁：被上面那頁擋住光，掀開時慢慢亮起來
      this.pageMat.uniforms.uShade!.value = lerp(0.9, 1, curl);
      this.pageMat.uniforms.uSh!.value = curl < 0.98 ? this.tearMat.uniforms.uYc!.value : 1e5;
    } else { this.pageMat.uniforms.uShade!.value = 1; this.pageMat.uniforms.uSh!.value = 1e5; }
    const fiber = fiberTex(renderer);
    for (const m of this.mats) m.uniforms.uFiber!.value = fiber;

    // ---- 鏡頭：斜斜地看著日曆，慢慢繞；到了婚禮那一頁推近到運勢；每撕一頁輕輕一震
    const push = ease.inOutCubic(prog(t, this.arrive, this.arrive + this.g.bar * 1.2));
    const slow = prog(t, s, e);
    let shake = 0;
    for (const t0 of this.tears) shake += pulse(t, t0 + this.tearDur * 0.2, 0.1);
    const target = new THREE.Vector3(18, lerp(40, -118, push), PAD_D);
    const scale = lerp(0.93, 1.05, push) + 0.02 * slow;
    const D0 = (H / 2) / Math.tan((22 * Math.PI) / 360);
    const dist = D0 / scale;
    const az = lerp(0.13, 0.05, slow) + 0.004 * shake, el = lerp(-0.07, -0.035, slow);
    this.cam.position.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(az) * Math.cos(el));
    this.cam.up.set(Math.sin(0.012 * shake), 1, 0);
    this.cam.lookAt(target);
    // 日曆放在畫面偏左（右邊留白給牆與燈光）
    this.cam.setViewOffset(W, H, 90, 0, W, H);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();

    // 牆上的影子：背板四角投影到螢幕的外框
    const bh = PH + BOARD.top + BOARD.bot, by = (BOARD.top - BOARD.bot) / 2;
    const corners = [[-BOARD.w / 2, by - bh / 2], [BOARD.w / 2, by - bh / 2], [-BOARD.w / 2, by + bh / 2], [BOARD.w / 2, by + bh / 2]].map(([x, y]) => {
      const v = new THREE.Vector3(x!, y!, 0).project(this.cam);
      return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
    });
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    (this.wall.u.shadowRect!.value as THREE.Vector4).set(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    this.wall.u.fiber!.value = fiber;
    this.wall.u.t!.value = t;
    // 掛鐘：掛在日曆右邊的牆上（跟著鏡頭投影，推近時一起放大）；秒針每一拍跳一格（落在拍點，outBack 彈一下）
    const cp = new THREE.Vector3(700, 190, -2).project(this.cam), ce = new THREE.Vector3(805, 190, -2).project(this.cam);
    const ccx = (cp.x * 0.5 + 0.5) * W, ccy = (0.5 - cp.y * 0.5) * H;
    (this.wall.u.clock!.value as THREE.Vector3).set(ccx, ccy, Math.abs(((ce.x - cp.x) * 0.5) * W));
    const au = this.ctx.audio, bi = Math.floor(au.beatAt(t) + 1e-6), bt = au.timeOfBeat(bi);
    const sec = bi + ease.outBack(clamp((t - bt) / 0.12), 2.2) - 1;
    const mins = 30 + t / 60;
    (this.wall.u.hands!.value as THREE.Vector3).set(((7 + mins / 60) / 12) * Math.PI * 2, (mins / 60) * Math.PI * 2, (sec / 60) * Math.PI * 2);
    this.wall.render(renderer, out);
    renderer.setRenderTarget(out);
    renderer.clearDepth();
    renderer.render(this.scene3, this.cam);
    void hash;
    return { paper: 1, bloom: 0.28, bloomThreshold: 0.98, halation: 0.06, vignette: 0.34, grain: 0.05, zoom: 1 + 0.004 * shake };
  }
}
