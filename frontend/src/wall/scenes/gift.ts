// 禮物盒（亮）：淺色木頭桌上一個包好的禮物盒，訊號色的緞帶十字綁著、上面一個蝴蝶結。這是真的 3D（_t4 的桌面舞台）：
//  - 開場：鏡頭從斜前方看著盒子（遠處的桌面失焦），很慢地繞。
//  - 第一拍：蝴蝶結的一個圈被拉開（縮回結裡）；第二拍：另一個圈；第三拍：整條緞帶被抽走、飛出畫面。
//  - 下一個小節線：盒蓋「啵」地彈起來、翻著飛走；鏡頭同時升高、往前推——從斜上方看進打開的盒子：
//    裡面的東西包在兩片薄紙裡，接下來兩拍，薄紙一片一片被翻開（上面那片先），翻過盒緣垂在盒子外面；
//    底下躺著一張卡片，卡片上手寫的就是主打留言，署名在下面。之後每個小節線，垂在外面的薄紙被風吹得晃一下；鏡頭很慢地推近。
//  - 留言標準 v2：卡片在畫面上約 780×400（留言 40～60 px），盒子與薄紙才是主角；卡片放在盒子裡偏左下，右下角 HUD 底下是桌面。
//  - 歌詞：一直在畫面上方（桌面的遠處、失焦的地方），比留言小一級。
//  - 沒有留言：卡片上是空白的橫線與一行邀請；歌詞在上方當主角。
// 畫法：_t4 的 Stage（桌面、柔影、景深、燈）；盒子、盒蓋、薄紙、緞帶是 three.js 網格（整晚共用，每個窗格只改位置）；
// 蝴蝶結的圈與尾巴是自己長的扁帶子（_t22 的 stripGeometry）；兩片翻開的薄紙每格重算頂點（從「蓋著」的形狀內插到「翻出去垂著」的形狀，
// 離鉸鏈遠的那一頭先走，像手掀起來的）；卡片是一張 render target（紙＋留言圖層）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, lerp, noise2, frameIdx } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, lyricSubOf, drawLyric, layoutLyric, beatAfter, COUPLE_ZH, type LyricStyle } from './_motifs';
import { preloadText, INVITE_SMALL, paperSignal } from './_t19';
import { barsIn, sigInk } from './_t1';
import { Stage, camDist, type V3 } from './_t4';
import { placeBlock, drawBlock, sigOf, stripGeometry, setStrip, fitV2, T22_TEXT, type Rect } from './_t22';
import { lyricV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'keepsake', paper: true, energy: [0.2, 0.9], bars: [4, 10], weight: 1 };

/** 盒子（世界單位 = px；桌面 z = 0，z 往上）：外寬、外深、高、壁厚。盒蓋比盒子大一圈。 */
const BW = 900, BD = 620, BH = 240, WT = 8;
const LW = BW + 26, LD = BD + 26, LH = 100;
/** 盒蓋蓋著時的高度（盒蓋的下緣）。 */
const LID_Z = BH + 12 - LH;
/** 盒子內壁的半寬、半深。 */
const HW = BW / 2 - WT, HD = BD / 2 - WT;
/**
 * 卡片（留言標準 v2：畫面上約 780×400，比盒子小很多，四周看得到薄紙）：大小、放在盒子裡的位置與高度。
 * 放在盒子裡偏左下：鏡頭看的是卡片右邊一點，盒子整個在畫面左邊三分之二，右下角 HUD 的底下是乾淨的桌面。
 */
const CW = 640, CH = 330;
const CARD: V3 = [-40, -52, 64];
const CARD_ROT = -0.03;
/** 卡片上寫留言的範圍（卡片 px）。 */
const CM = { x: 46, y: 70, w: 548, h: 232 };
/**
 * 蓋在卡片上的兩片薄紙：從左右兩邊的內壁（鉸鏈在高度 FZ）蓋過來，在中間重疊；右邊那片疊在上面、先翻開。
 * FW = 一片的寬（從鉸鏈量）、FD = 深；FNS × FND = 網格的格數。
 */
const FW = HW + 30, FD = BD - 2 * WT - 10, FZ = 118;
const FNS = 30, FND = 6;
/** 鏡頭推近之後的位置：看卡片右邊一點（盒子在畫面左邊）、從前方斜上方往下看。 */
const T2: V3 = [CARD[0] + 280, CARD[1] + 120, CARD[2]];
const TILT2 = 0.4, YAW2 = 0.03;
/** 有原文副行時鏡頭看的點往桌子裡面挪多少（盒子在畫面上約往下 30 px）。 */
const SUB_DY = 34;
/** 緞帶寬。 */
const RB = 66;
/**
 * 拆下來的緞帶：翻開薄紙之後的下一個小節線，從畫面上方飄下來、鬆鬆地落在盒子右邊的桌上（繞一個圈）。
 * 中心線的控制點（世界座標，桌面上）；落下來的時候離鏡頭近的那一頭先著地。
 */
const LOOSE_N = 72;
const LOOSE = new THREE.CatmullRomCurve3([
  [585, 250], [720, 300], [870, 272], [932, 172], [862, 82], [762, 30], [742, -58], [832, -120], [962, -132],
].map(([x, y]) => new THREE.Vector3(x, y, 1.5)), false, 'centripetal');
const FOV = 30;
const D0 = camDist(FOV);
/** 鏡頭推近之後卡片在畫面上大約放大幾倍（決定鏡頭距離；實際的倍數 init 用鏡頭量）。 */
const S_CARD = 1.12;
const D2 = D0 / S_CARD;

// ---------------------------------------------------------------- 卡片的紙（render target 上）
const CARD_PAPER = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vUv * vec2(${CW}.0, ${CH}.0);
    vec3 col = mix(C_PAPER, C_BONE, 0.55) * (0.985 + 0.012 * fbm(p / 90.0, 3) + 0.006 * snoise(p / 3.0));
    // 壓印的細框
    vec2 q = abs(p - vec2(${CW / 2}.0, ${CH / 2}.0)) - vec2(${CW / 2 - 18}.0, ${CH / 2 - 18}.0);
    float fr = abs(max(q.x, q.y));
    col *= 1.0 - 0.07 * (1.0 - smoothstep(0.4, 1.4, fr));
    fragColor = vec4(col, 1.0);
  }`);

// ---------------------------------------------------------------- 3D 道具（整晚共用）
function box(w: number, d: number, h: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
  m.position.set(x, y, z);
  m.frustumCulled = false;
  return m;
}

/** 蝴蝶結的一個圈（扁帶子）：從結出發往 dir 那一側拱起來再回到結。 */
function loopPoints(dir: number, n = 40) {
  const pts: THREE.Vector3[] = [], side: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI * 2;
    const x = dir * 100 * (1 - Math.cos(a)) * 0.95;
    const z = 6 + 104 * Math.pow(Math.max(0, Math.sin(a * 0.5)), 1.1) * (0.55 + 0.45 * Math.sin(a * 0.5));
    const y = 34 * Math.sin(a) * dir;
    pts.push(new THREE.Vector3(x, y, z));
    // 寬度方向：大致沿 y，跟著圈扭一點
    side.push(new THREE.Vector3(0.18 * Math.sin(a), 1, 0.12 * Math.cos(a)).normalize().multiplyScalar(RB * 0.42));
  }
  return { pts, side };
}
/** 蝴蝶結的尾巴：從結往斜下方垂到盒蓋上（末端剪成燕尾的樣子用寬度收窄代替）。 */
function tailPoints(dx: number, dy: number, n = 16) {
  const pts: THREE.Vector3[] = [], side: THREE.Vector3[] = [];
  const nrm = new THREE.Vector3(-dy, dx, 0).normalize();
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    pts.push(new THREE.Vector3(dx * u, dy * u, 5 + 10 * (1 - u) * (1 - u)));
    side.push(nrm.clone().multiplyScalar(RB * 0.42 * (1 - 0.25 * u)));
  }
  return { pts, side };
}

/** 一片薄紙的網格（頂點每格重算）：s 沿著寬（離鉸鏈多遠）、v 沿著深。 */
function flapGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((FNS + 1) * (FND + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const idx: number[] = [];
  for (let i = 0; i < FNS; i++) for (let j = 0; j < FND; j++) {
    const a = i * (FND + 1) + j, b = a + FND + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setIndex(idx);
  return g;
}

/**
 * 左邊那片薄紙在離鉸鏈 s、深度 v 的點（右邊那片把 x 鏡射）：
 *  - 蓋著：從鉸鏈往中間蓋過去，中間塌一點（底下是卡片），有一點皺；
 *  - 翻開：沿著內壁往上、翻過盒緣、垂在盒子外面，碰到桌面就攤在桌上。
 * k = 翻開的進度（0..1）：離鉸鏈遠的那一頭先走（像手捏著邊掀起來），中途往上拱，才不會穿過盒壁。
 * wind = 翻開之後小節線的一陣風（垂在外面的那一段晃一下）。
 */
function flapPoint(s: number, v: number, k: number, wind: number, seed: number, out: THREE.Vector3) {
  const u = s / FW;
  // 蓋著
  const cx = -HW + s;
  const cz = FZ - 34 * Math.sin(Math.min(1, u / 0.6) * Math.PI / 2) + 5 * noise2(s / 70, v / 90, seed) + 3 * Math.sin(v * 0.02 + s * 0.013);
  // 翻開：沿著內壁往上（L1）、翻過盒緣（L2）、垂在外面，碰到桌面攤開
  const L1 = BH + 3 - FZ, L2 = 20;
  let ox: number, oz: number;
  if (s <= L1) { ox = -HW + 2 + 4 * Math.sin((Math.PI * s) / L1); oz = FZ + s; }
  else if (s <= L1 + L2) { const a = (s - L1) / L2; ox = -HW + 2 - a * (WT + 8); oz = BH + 3 + 5 * Math.sin(Math.PI * a); }
  else {
    const r = s - L1 - L2;
    ox = -BW / 2 - 6 - 10 * Math.sin(Math.min(1, r / 60) * Math.PI / 2) - wind * 16 * Math.min(1, r / 120) * Math.sin(v * 0.018 - wind * 3);
    oz = BH + 3 - r;
    if (oz < 1.5) { ox -= 1.5 - oz; oz = 1.5; }
  }
  ox += 5 * Math.sin(v * 0.016 + s * 0.02 + seed);
  const ku = ease.inOutCubic(clamp((k - 0.4 * (1 - u)) / 0.6));
  out.set(lerp(cx, ox, ku), v, lerp(cz, oz, ku) + 260 * u * Math.sin(Math.PI * ku));
}

function makeRig() {
  const st = new Stage(1, FOV);
  st.U.ambient.value = 0.56;
  st.U.lightDir.value.set(-0.5, -0.7, 0.9).normalize();
  const wrap = st.solidMaterial(`(dot(n.xy, p) < -1.0 ? mix(C_PAPER, C_SEPIA, 0.3) : mix(mix(C_PAPER, C_BONE, 0.4), C_SIGNAL, 0.1) * (0.975 + 0.025 * step(0.5, fract((p.x + p.y) / 36.0))))`);
  const lidMat = st.solidMaterial(`mix(mix(C_PAPER, C_BONE, 0.4), C_SIGNAL, 0.1) * (0.975 + 0.025 * step(0.5, fract((p.x + p.y) / 36.0)))`);
  const satin = st.solidMaterial(`mix(C_SIGNAL, C_BLOOD, 0.5) * (0.62 + 0.95 * pow(max(dot(n, normalize(vec3(-0.25, -0.72, 0.65))), 0.0), 9.0))`);
  const tissue = st.solidMaterial(`mix(C_BONE, C_PAPER, 0.25) * (0.96 + 0.04 * detail * snoise(p / 7.0))`);
  // 翻開的薄紙：比盒底的薄紙淡一點點（很薄、透一點光），褶子的明暗靠法向量
  const flapMat = st.solidMaterial(`mix(C_BONE, C_PAPER, 0.15) * (0.97 + 0.03 * detail * snoise(p / 5.0))`);
  // 盒子（開口朝上）
  const boxG = new THREE.Group();
  boxG.add(box(BW, BD, WT, wrap, 0, 0, WT / 2));
  boxG.add(box(BW, WT, BH, wrap, 0, -BD / 2 + WT / 2, BH / 2), box(BW, WT, BH, wrap, 0, BD / 2 - WT / 2, BH / 2));
  boxG.add(box(WT, BD, BH, wrap, -BW / 2 + WT / 2, 0, BH / 2), box(WT, BD, BH, wrap, BW / 2 - WT / 2, 0, BH / 2));
  // 盒子裡的薄紙：皺皺的，靠牆的地方翻起來
  const tg = new THREE.PlaneGeometry(BW - 2 * WT - 6, BD - 2 * WT - 6, 72, 50);
  const tp = tg.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), y = tp.getY(i);
    const edge = Math.max(Math.abs(x) / HW, Math.abs(y) / HD);
    // 皺褶大而柔（好的薄紙是一大片一大片地皺，不是一粒一粒）
    const crumple = 12 * noise2(x / 110, y / 95, 3) + 3.5 * noise2(x / 32, y / 38, 9);
    tp.setZ(i, WT + 30 + crumple + 70 * Math.pow(Math.max(0, edge - 0.72) / 0.28, 2));
  }
  tg.computeVertexNormals();
  const tissueM = new THREE.Mesh(tg, tissue);
  tissueM.frustumCulled = false;
  boxG.add(tissueM);
  st.scene.add(boxG);
  // 卡片
  const cardRT = makeRT(CW, CH, { pxScale: 2.2, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cardMat = st.docMaterial(cardRT.texture, [cardRT.width, cardRT.height], [CW, CH], { radius: 4, edge: 1, depthTest: true });
  const card = st.docMesh(cardMat, CW, CH, CARD[0], CARD[1], CARD[2]);
  card.rotation.z = CARD_ROT;
  // 兩片薄紙（右邊那片疊在上面：高 4）
  const flaps = [0, 1].map((i) => {
    const m = new THREE.Mesh(flapGeometry(), flapMat);
    m.frustumCulled = false;
    m.position.z = i === 1 ? 4 : 0;
    st.scene.add(m);
    return m;
  });
  // 盒蓋（原點在盒蓋下緣的中心）
  const lid = new THREE.Group();
  lid.add(box(LW, LD, WT, lidMat, 0, 0, LH - WT / 2));
  lid.add(box(LW, WT, LH, lidMat, 0, -LD / 2 + WT / 2, LH / 2), box(LW, WT, LH, lidMat, 0, LD / 2 - WT / 2, LH / 2));
  lid.add(box(WT, LD, LH, lidMat, -LW / 2 + WT / 2, 0, LH / 2), box(WT, LD, LH, lidMat, LW / 2 - WT / 2, 0, LH / 2));
  st.scene.add(lid);
  // 緞帶：盒蓋上的十字＋往下包住盒蓋的邊；蝴蝶結（兩個圈、結、兩條尾巴）。原點在盒蓋頂面中心
  const rib = new THREE.Group();
  rib.add(box(LW + 3, RB, 2.5, satin, 0, 0, 1.2), box(RB, LD + 3, 2.5, satin, 0, 0, 1.4));
  rib.add(box(2.5, RB, LH, satin, LW / 2 + 1.2, 0, -LH / 2), box(2.5, RB, LH, satin, -LW / 2 - 1.2, 0, -LH / 2));
  rib.add(box(RB, 2.5, LH, satin, 0, LD / 2 + 1.2, -LH / 2), box(RB, 2.5, LH, satin, 0, -LD / 2 - 1.2, -LH / 2));
  const knot = box(52, 44, 26, satin, 0, 0, 14);
  rib.add(knot);
  const loops: THREE.Mesh[] = [];
  for (const d of [1, -1]) {
    const g = stripGeometry(40);
    const { pts, side } = loopPoints(d);
    setStrip(g, pts, side);
    const m = new THREE.Mesh(g, satin);
    m.frustumCulled = false;
    rib.add(m); loops.push(m);
  }
  const tails: THREE.Mesh[] = [];
  for (const [dx, dy] of [[150, -170], [-120, -190]] as [number, number][]) {
    const g = stripGeometry(16);
    const { pts, side } = tailPoints(dx, dy);
    setStrip(g, pts, side);
    const m = new THREE.Mesh(g, satin);
    m.frustumCulled = false;
    rib.add(m); tails.push(m);
  }
  st.scene.add(rib);
  // 拆下來、落在桌上的那條緞帶（頂點每格算）
  // 拆下來的緞帶：落在盒子旁邊的桌上，光比較散（淡一點），才不會比卡片上的留言搶眼
  const looseMat = st.solidMaterial(`mix(mix(C_SIGNAL, C_BLOOD, 0.45), C_PAPER, 0.3) * (0.7 + 0.8 * pow(max(dot(n, normalize(vec3(-0.25, -0.72, 0.65))), 0.0), 6.0))`);
  const loose = new THREE.Mesh(stripGeometry(LOOSE_N), looseMat);
  loose.frustumCulled = false;
  st.scene.add(loose);
  return { st, cardRT, cardMat, card, flaps, lid, rib, loops, tails, knot, boxG, loose };
}

export default class Gift extends Scene {
  rig = shared('gift.rig', makeRig);
  paperPass = shared('gift.cardPaper', CARD_PAPER);
  /** 畫面上方的歌詞（整個窗格都在這裡）。 */
  top = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 卡片上的字（留言、署名，畫一次）。 */
  cardL = this.track(new Layer2D(CW, CH, 2.2, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) >>> 0;
  tL1 = 0; tL2 = 0; tRib = 0; tLid = 0; crane = 1;
  /** 兩片薄紙翻開的時間（右邊那片先）與花的時間。 */
  tF = [0, 0];
  fDur = 0.5;
  bars: number[] = [];
  /** 拆下來的緞帶落到桌上的時間（小節線；0 = 窗格太短，不落）。 */
  tLand = 0;
  private lp: THREE.Vector3[] = Array.from({ length: LOOSE_N }, () => new THREE.Vector3());
  private ls: THREE.Vector3[] = Array.from({ length: LOOSE_N }, () => new THREE.Vector3());
  topSt: LyricStyle = { family: F.archivo(100, 700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: 1400, align: 'center' };
  avoid: Rect[] = [];
  /**
   * 韓文歌有原文副行時，鏡頭看的點往桌子裡面挪多少（世界單位）：盒子在畫面上往下讓一點，
   * 歌詞＋原文兩行才不會壓到盒緣。沒有副行是 0，鏡頭跟原本一樣。
   */
  subDy = 0;
  private v = new THREE.Vector3();

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    const m = this.msg;
    this.subDy = this.ctx.lyrics.linesIn(s, e).some((l) => lyricSubOf(l)) ? SUB_DY : 0;
    await preloadText(this.ctx, `${m ? m.text + sigOf(m) : ''}${T22_TEXT}${INVITE_SMALL}給${COUPLE_ZH}：給大家：FROM THE COUPLE · 新人`);
    const B = au.beatPeriod(s + 0.1);
    const step = e - s < 8 * B ? B / 2 : B;
    const b0 = beatAfter(au, s + Math.min(0.35, B * 0.7));
    this.tL1 = b0; this.tL2 = b0 + step; this.tRib = b0 + 2 * step;
    const bar = barsIn(au, b0 + 3 * step - 0.05, e).find((b) => e - b > 2.4);
    this.tLid = bar !== undefined && bar - (b0 + 3 * step) < B * 2.1 ? bar : b0 + 3 * step;
    const bars = barsIn(au, this.tLid + 0.1, e);
    const barLen = bars.length > 1 ? bars[1]! - bars[0]! : B * 4;
    this.crane = Math.min(barLen * 0.9, 1.8, Math.max(0.6, (e - this.tLid) * 0.4));
    // 鏡頭快停下來的那一拍翻開第一片薄紙，下一拍第二片
    const f1 = beatAfter(au, this.tLid + this.crane * 0.7);
    this.tF = [f1, f1 + step];
    this.fDur = clamp(step * 1.1, 0.35, 0.7);
    this.bars = barsIn(au, this.tF[1] + this.fDur + 0.1, e);
    // 薄紙翻開之後的下一個小節線，拆下來的緞帶落到桌上（窗格剩不到一秒就不落了）
    this.tLand = this.bars.find((b) => b > this.tF[1] + this.fDur + 0.5 && e - b > 1) ?? 0;
    this.topSt = { ...this.topSt, active: paperSignal(), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28) };

    // ---- 卡片在畫面上放大幾倍：用推近之後的鏡頭量卡片左右兩邊（留言字級要換算成畫面上的 px）
    const st = this.rig.st;
    this.lookFinal(0);
    const a = st.toScreen([CARD[0] - CW / 2, CARD[1], CARD[2]]), b = st.toScreen([CARD[0] + CW / 2, CARD[1], CARD[2]]);
    const S = Math.hypot(b.x - a.x, b.y - a.y) / CW;

    // ---- 卡片上的字
    const c = this.cardL.ctx;
    this.cardL.clear();
    c.textBaseline = 'alphabetic';
    c.font = font(F.hand(400), 20); c.fillStyle = rgba('sepia', 0.62);
    c.fillText(m?.couple ? '給大家：' : `給 ${COUPLE_ZH}：`, CM.x, 50);
    if (m?.couple) {
      c.textAlign = 'right'; c.font = font(F.mono(500), 12); c.letterSpacing = '4px'; c.fillStyle = sigInk(0.9);
      c.fillText('FROM THE COUPLE · 新人', CW - CM.x, 48); c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    let msgScreen: number | null = null;
    if (m) {
      // 留言標準 v2：畫面上 40～60 px（依字數），卡片上的字級 = 畫面字級 ÷ S
      const fam = F.hand(700), sig = sigOf(m);
      const blk = fitV2(c, m.text, fam, CM.w, CM.h, S, { lineHeight: 1.28 });
      msgScreen = blk.fit.size * S;
      const top = CM.y + Math.max(0, (CM.h - blk.height) * 0.42);
      const pl = placeBlock(c, blk, fam, sig, CM.x, top);
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.94), sigColor: rgba('sepia', 0.72) });
    } else {
      // 沒有留言：空白的橫線（等著寫祝福）＋一行邀請；焦點是上方的歌詞
      c.fillStyle = rgba('sepia', 0.16);
      for (const y of [128, 188, 248]) c.fillRect(CM.x, y, CW - 2 * CM.x, 1.2);
      c.textAlign = 'center'; c.fillStyle = rgba('sepia', 0.62);
      const fit = fitText(c, INVITE_SMALL, F.hand(700), CW - 2 * CM.x, 40, { min: 22, max: 30 / S });
      c.font = font(F.hand(700), fit.size);
      c.fillText(INVITE_SMALL, CW / 2, 296);
      c.textAlign = 'left';
    }
    this.cardL.upload();
    this.topSt = { ...this.topSt, size: lyricV2(msgScreen) };
    this.avoid = [[180, 90, 1560, 130], [240, 330, 1000, 520]];
  }

  /** 推近之後的鏡頭（hold = 之後很慢地再推近、往左繞一點的進度 0..1）。 */
  private lookFinal(hold: number): { pos: V3; tgt: V3; dist: number; tilt: number; yaw: number } {
    const dist = D2 * (1 - 0.04 * hold), tilt = TILT2 - 0.03 * hold, yaw = YAW2 - 0.05 * hold;
    return this.lookAt([T2[0], T2[1] + this.subDy, T2[2]], dist, tilt, yaw);
  }
  private lookAt(tgt: V3, dist: number, tilt: number, yaw: number) {
    const pos: V3 = [tgt[0] + Math.sin(yaw) * Math.sin(tilt) * dist, tgt[1] - Math.cos(yaw) * Math.sin(tilt) * dist, tgt[2] + Math.cos(tilt) * dist];
    this.rig.st.look(pos, tgt, FOV, 1);
    return { pos, tgt, dist, tilt, yaw };
  }

  /** 卡片（render target 整晚共用：每格都重畫，不依賴上一格留下的內容）。 */
  private drawCard() {
    const { renderer, comp } = this.ctx;
    const R = this.rig;
    this.paperPass.render(renderer, R.cardRT);
    comp.draw(renderer, this.cardL.texture, R.cardRT);
  }

  /** 兩片薄紙的頂點（每格重算）。 */
  private updateFlaps(t: number) {
    let wind = 0;
    for (const b of this.bars) if (t >= b) wind += Math.exp(-(t - b) * 2.2) * Math.sin(Math.min(Math.PI, (t - b) * 6));
    this.rig.flaps.forEach((mesh, i) => {
      // i = 0 左邊、1 右邊（疊在上面、先翻開）
      const k = clamp((t - this.tF[i === 1 ? 0 : 1]!) / this.fDur);
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const sd = i * 7.3 + (this.seed % 17);
      for (let a = 0; a <= FNS; a++) for (let b = 0; b <= FND; b++) {
        const s = (a / FNS) * FW, v = -FD / 2 + (b / FND) * FD;
        flapPoint(s, v, k, wind * (i ? 1 : 0.8), sd, this.v);
        pos.setXYZ(a * (FND + 1) + b, i === 1 ? -this.v.x : this.v.x, this.v.y, this.v.z);
      }
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    });
  }

  /**
   * 拆下來的緞帶：小節線前 FALL 秒從畫面上方飄下來（一邊翻、一邊擺），中間那一段剛好在小節線著地、彈一下；
   * 之後每個小節線，鬆開的那一頭被風掀起來一點。
   */
  private updateLoose(t: number) {
    const R = this.rig, FALL = 0.85;
    R.loose.visible = this.tLand > 0 && t > this.tLand - FALL - 0.15;
    if (!R.loose.visible) return;
    let wind = 0;
    for (const b of this.bars) if (b > this.tLand && t >= b) wind += Math.exp(-(t - b) * 2.4) * Math.sin(Math.min(Math.PI, (t - b) * 5));
    const tan = this.v;
    for (let i = 0; i < LOOSE_N; i++) {
      const u = i / (LOOSE_N - 1);
      const p = LOOSE.getPoint(u, this.lp[i]!);
      LOOSE.getTangent(u, tan);
      // 離鏡頭近的那一頭（u = 1）先著地，中間剛好在小節線
      const tl = this.tLand + (0.5 - u) * 0.22;
      const q = clamp((t - (tl - FALL)) / FALL);
      const air = 1 - ease.inQuad(q);
      // 在空中一邊翻一邊擺；躺在桌上也不是完全平的（微微拱起、扭一點，緞面的光澤才看得出來）
      const twist = air * 2.4 * Math.sin(u * 6 + t * 3.1) + (1 - air) * 0.35 * Math.sin(u * 17 + 1.3);
      p.x += air * 60 * Math.sin(u * 8 + t * 4);
      p.y += air * 620;
      p.z += air * 520 + 5 * Math.max(0, Math.sin(u * 23)) + (t > tl ? 10 * Math.exp(-(t - tl) * 7) * Math.abs(Math.sin((t - tl) * 13)) : 0) + wind * 22 * Math.pow(u, 3);
      const hw = 24 * (1 - 0.2 * Math.pow(u, 6));
      this.ls[i]!.set(-tan.y * Math.cos(twist) * hw, tan.x * Math.cos(twist) * hw, Math.sin(twist) * hw);
    }
    setStrip(R.loose.geometry, this.lp, this.ls);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const R = this.rig, st = R.st;
    const B = this.ctx.audio.beatPeriod(t);

    // ---- 蝴蝶結：一拍拉開一個圈（縮回結裡），第三拍整條緞帶被抽走
    const pull = (t0: number) => ease.inBack(clamp((t - t0) / Math.min(0.28, B * 0.6)), 2.2);
    R.loops.forEach((m, i) => {
      const k = pull(i === 0 ? this.tL1 : this.tL2);
      m.visible = k < 0.999;
      m.scale.set(1 - 0.85 * k, 1 - 0.3 * k, 1 - 0.9 * k);
      m.rotation.z = (i === 0 ? 1 : -1) * 0.35 * k;
    });
    // 開場：蝴蝶結跟著拍子輕輕彈一下（還沒拉開之前）
    const bounce = pulse(t, this.tL1 - B, 0.08) * 0.04;
    R.knot.scale.setScalar(1 + bounce);
    const rk = ease.outExpo(clamp((t - this.tRib) / 0.55));
    const lidTop = LID_Z + LH;
    const lk = clamp((t - this.tLid) / 0.75);
    const lidPos = new THREE.Vector3(0, 0, LID_Z);
    if (t >= this.tLid) {
      const q = ease.outCubic(lk);
      lidPos.set(-260 * q, 620 * q, LID_Z + 1500 * q + 160 * Math.sin(Math.PI * Math.min(1, lk * 1.4)));
    }
    R.lid.position.copy(lidPos);
    R.lid.rotation.set(t >= this.tLid ? -1.1 * ease.outCubic(lk) : 0, 0, t >= this.tLid ? 0.25 * lk : 0);
    R.lid.visible = lk < 0.999;
    // 緞帶：跟著盒蓋；被抽走時往右上飛、轉著出畫
    R.rib.position.set(1500 * rk, -200 * rk, lidTop + 700 * rk * rk);
    R.rib.rotation.set(0.5 * rk, -0.4 * rk, -0.8 * rk);
    R.rib.visible = rk < 0.999;
    R.tails.forEach((m, i) => { m.rotation.z = (i ? -1 : 1) * 0.12 * Math.sin(t * 1.3 + i); });
    // 薄紙：盒蓋打開之前藏在盒蓋底下（一樣畫，蓋著看不到）
    this.updateFlaps(t);
    this.updateLoose(t);

    // ---- 鏡頭：斜前方慢慢繞（盒子在畫面偏左，右下角 HUD 的底下是桌面）→ 開盒時升高、推近，從斜上方看進盒子
    const w2 = ease.inOutCubic(clamp((t - this.tLid) / this.crane));
    const hold = ease.inOutQuad(prog(t, this.tLid + this.crane, e));
    const pre = prog(t, s, this.tLid, ease.inOutQuad);
    const T1: V3 = [150, 60, 160];
    const tgt: V3 = [lerp(T1[0], T2[0], w2), lerp(T1[1], T2[1], w2) + this.subDy, lerp(T1[2], T2[2], w2)];
    const d1 = D0 * (1.2 - 0.06 * pre), d2 = D2 * (1 - 0.04 * hold);
    const dist = Math.exp(lerp(Math.log(d1), Math.log(d2), w2));
    const tilt = lerp(0.9 - 0.05 * pre, TILT2 - 0.03 * hold, w2);
    const yaw = lerp(0.3 - 0.14 * pre, YAW2 - 0.05 * hold, w2);
    this.lookAt(tgt, dist, tilt, yaw);
    st.U.focus.value = st.depthOf(w2 > 0.5 ? CARD : [0, 0, BH]);
    st.U.aperture.value = lerp(14, 9, w2);
    st.U.pool.value.set(-160, -40, 1500, 0.55);
    st.shadows([
      { x: 28, y: -36, w: BW + 30, h: BD + 30, blur: 38, k: 0.3, r: 10 },
    ]);

    this.drawCard();
    st.render(renderer, out);

    // ---- 歌詞：一直在畫面上方（桌面的遠處）
    const T0 = this.top, c = T0.ctx;
    T0.clear();
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = layoutLyric(c, ly.line, this.topSt);
      // 有原文副行：兩行一起往上靠（字頂離畫面上緣 96 px），原文才不會碰到盒緣
      const y0 = lay.sub ? Math.max(96 + lay.size * 0.92, 150 - (lay.height - lay.size) * 0.5) : 150 - (lay.rows.length - 1) * lay.size * 0.3;
      c.save(); c.translate(960, y0);
      drawLyric(c, ly.line, t, this.topSt, lay, ly.k);
      c.restore();
    } else if (!lyrics.has) {
      c.textAlign = 'center'; c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.5 * prog(t, s, s + 0.5));
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, 960, 140);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    comp.draw(renderer, T0.upload(), out);

    const amp = 7 * pulse(t, this.tLid, 0.07) + 3 * pulse(t, this.tRib, 0.06);
    const ph = frameIdx(t);
    return {
      paper: 1, bloom: 0.25, bloomThreshold: 1.4, halation: 0.05, vignette: 0.32, grain: 0.05,
      shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2],
      popupAvoid: this.avoid,
    };
  }
}
