// 明信片（亮）：一張明信片放在檯燈下的亞麻桌布上，three.js 的真 3D，像電影鏡頭：
//  - 鏡頭斜斜地俯看（有一點透視），整個窗格慢慢推近、稍微繞著卡片搖，推的動作在每個小節線緩緩停住；
//    桌布離對焦面越遠越糊（景深），前景一支失焦的鋼筆斜在桌角，推近時移得比卡片快；左上方一盞燈的光斑。
//  - 卡片從上方落到桌上（第一拍落定），在小節線上整張翻面（抬起、轉 180°、啪地落下）。
//  - 正面是一張雕版線條的風景（GLSL：一層層的山、同心圓的太陽與放射的光芒、越遠越密的湖面波紋、一艘小帆船，
//    再用訊號色淡淡地「手工上色」）。湖面的線跟著低音晃、太陽的光芒在大鼓上伸長、小船在拍點上輕輕起伏。
//    底下的白邊是圖說：正在唱的那句歌詞（沒有留言時，這就是畫面的焦點）。
//  - 翻到背面（有留言才翻）：主打留言占滿左邊的大部分，一個字一個字手寫出來（剛寫的字是濕的墨——訊號色的暗部——半秒後乾成墨色），
//    寫完簽名；下一拍郵戳「碰」地蓋在郵票上。郵票、郵戳、地址都縮成右邊一條小小淡淡的郵務欄，把畫面讓給留言。
//    背面最下面一條「P.S.」是正在唱的歌詞（中等大小，比留言小），所以翻到哪一面都讀得到。
//  - 窗格夠長（留言寫完、讀完之後還有一兩個小節）：最後一個小節線再翻回正面。
//  - 窗格很短（2 小節）：卡片落下時就在空中翻個身、背面朝上落定，一落定就開始寫，留言才讀得完。
//  - 沒有留言：不翻面，正面的歌詞就是焦點，角落一行小字邀請大家掃 QR。新人的留言：收件人是全體賓客、寄件人是新人。
//    純音樂：圖說是歌名（小字），P.S. 寫一句小小的冷面話。
// v2（留言板不要太大太突兀、空出來的地方多補一些動畫）：
//  - 鏡頭拉遠，卡片在螢幕上約 640×417（卡片就是留言的容器，≤ 860×430），放在畫面左邊偏下；留言 40～60 px、署名 26～32、
//    P.S. 的歌詞 40～52（不比留言大）。桌面與桌上的東西才是畫面的主體。
//  - 多補的動畫：一支鋼筆（跟祝福登記表同一支）從桌上拿起來，一個字一個字把留言寫在卡片背面（筆尖跟著正在寫的字走），
//    寫完簽名再放回桌上；桌角一杯茶冒著熱氣；窗外的樹影在桌布上晃；前景一叢失焦的葉子在風裡輕輕擺。
// 畫法：桌面（布紋、燈光、景深、卡片的影子）與卡片都在同一個 three.js 場景裡；卡面只有看得到的那一面每格畫進一張共用的 RT
// （正面：風景 shader＋字；背面：紙 shader＋印好的字〔init 畫一次〕＋會動的字），再貼到 3D 卡片上（mipmap＋非等向過濾）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, hash, noise1 } from '../engine/util';
import { fitText, readSeconds, type FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, barAfter, signature, COUPLE_ZH, DATE_DOTS, joinBits, lyricSubOf, subStyleFor, subGap, drawLyricSub, type LyricStyle, type LyricLayout } from './_motifs';
import { paperLyric, windowLines, pad3 } from './_t2';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';
import {
  CW, CH, PIC, BACK, LAND, BACKPAPER, CARD3D, faceRT, drawBackStatic, makePostmark, drawForegroundLeaves, drawTableProps, PROPS_R, CUP_W, MARK_DATE,
} from './postcard-art';
// 鋼筆、茶杯、熱氣跟祝福登記表同一套（同一張書桌上的東西）
import { PEN_WRITE_A, drawPen, drawSteam, makeCup, makeEnvelope } from './certificate-props';

/**
 * 卡片上放歌詞的那一條只放得下一行（v2：卡片變小，字又不能小於 40 px）：歌詞折成兩行時，
 * 只放正在唱的那一行（第二行的第一個字快唱到時換成第二行），跟唱的時間照舊。
 */
function oneRow(lay: LyricLayout, t: number): LyricLayout {
  if (lay.rows.length < 2) return lay;
  const first2 = lay.words.find((w) => w.y > 0);
  const second = !!first2 && t >= first2.word.start - 0.15;
  const dy = second ? lay.rows[1]!.y : 0;
  return { ...lay, rows: [lay.rows[second ? 1 : 0]!].map((r) => ({ ...r, y: r.y - dy })), words: lay.words.filter((w) => (w.y > 0) === second).map((w) => ({ ...w, y: w.y - dy })), height: lay.size };
}

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.1, 0.8], bars: [4, 8] };

/** 卡片中心在畫面上的位置（鏡頭用 view offset 把它放在這裡）：畫面左邊偏下，卡片約占 x 320～960、y 380～800。 */
const SC = { x: 640, y: 590 };
/** v2：卡片在螢幕上是卡面的幾倍（鏡頭在 D0 / CARD_S 的距離）。 */
const CARD_S = 0.49;
/** 螢幕字級 → 卡面字級。 */
const cpx = (px: number) => px / CARD_S;
/** 鋼筆畫在螢幕上的縮放、放著時的位置（世界座標：卡片的右邊）與方向。 */
const PEN_K = 0.7;
const PEN_REST = { x: 780, y: -290, a: 1.38 };
/** 翻面時抬多高（世界單位）：轉到一半卡片直立，下緣不能穿過桌面（半高 423）。 */
const LIFT = 460;
const HAND = F.hand(700);
const HAND_L = F.hand(400);

/** 寫字的時間表：每個字一段。 */
interface Glyph { ch: string; x: number; y: number; w: number; size: number; fam: string; t0: number; t1: number; sig: boolean }

export default class Postcard extends Scene {
  land = shared('postcard.land', LAND);
  backPaper = shared('postcard.backpaper', BACKPAPER);
  face = shared('postcard.face', faceRT);
  card = shared('postcard.card3d', CARD3D);
  /** 會變的字（正面的圖說、背面寫到一半的留言、P.S.、郵戳）：每格重畫，看得到哪面畫哪面。 */
  layer = this.track(new Layer2D(CW, CH, undefined, { fast: true }));
  /** 背面印好的部分：init 畫一次、上傳一次。 */
  backStatic = this.track(new Layer2D(CW, CH, undefined, { fast: true }));
  /** 前景失焦的葉子：init 畫一次（blur 濾鏡只跑一次；糊的東西用半解析度就好）。 */
  leaves = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  /** 桌上的道具（茶杯、郵票、信封）：世界座標的一塊，init 畫一次，桌面 shader 取樣。 */
  props = this.track(new Layer2D(PROPS_R.w, PROPS_R.h, 0.5, { fast: true }));
  /** 蓋在卡片上面的：寫字的鋼筆、茶的熱氣（每格重畫）。 */
  over = this.track(new Layer2D(W, H, undefined, { fast: true }));
  sigSize = 60;
  /** 螢幕上的留言字級（算歌詞字級用）；沒有留言是 null。 */
  msgScreen: number | null = null;
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) as number;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  mark: ReturnType<typeof makePostmark> | null = null;
  /** 時間表（秒）。 */
  T = { land: 0, flip: Infinity, flipDur: 0.5, write: 0, writeEnd: 0, sigEnd: 0, stamp: Infinity, back: Infinity, beat: 0.5 };
  /** 鏡頭推近的分段：窗格開頭、每個小節線、窗格結尾。 */
  stops: number[] = [];
  /** 短窗格：落下時就翻好身，背面朝上落定。 */
  tumble = false;
  instr = false;
  /** 韓文歌（這一格有原文副行）：風景框下緣往上收這麼多（卡面 px），圖說的白邊才放得下中文＋原文兩排；整格固定，換句時不跳。 */
  subRoom = 0;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = windowLines(lyrics, s, e);
    this.instr = !lyrics.has;
    if (lines.some((l) => lyricSubOf(l))) this.subRoom = 84;
    await loadText(`POSTCARD明信片永久郵資喜宴郵局待寄囍幸福里永遠路號收寄件人全體賓客寫一張給新人掃描右下角寄自永遠這首沒有歌詞請自由發揮${COUPLE_ZH}${m ? m.text + signature(m.name) : ''}${song.title}${song.artist}${lines.map((l) => l.text).join('')}０１２３４５６７８９`);

    // ---- 時間表：第一拍落定；有留言才翻面（第一個小節線，太遠就第二拍後）；翻好的下一拍開始寫
    const T = this.T;
    const b0 = beatAfter(au, s + 0.05);
    const beat = T.beat = clamp(au.beatPeriod(b0), 0.25, 1.2);
    const bi = Math.round(au.beatAt(b0));
    T.land = b0;
    T.flipDur = clamp(beat * 1.1, 0.42, 0.75);
    // 鏡頭推近的分段
    this.stops = [s];
    for (let i = Math.ceil(au.barAt(s) + 1e-6), k = 0; k < 64; i++, k++) { const tb = au.timeOfBar(i); if (tb >= e - 0.05) break; if (tb > s + 0.2) this.stops.push(tb); }
    this.stops.push(e);
    this.drawStatic();
    if (!m) return;

    let flip = barAfter(au, b0 + beat * 0.8);
    if (flip - b0 > beat * 2.2) flip = au.timeOfBeat(bi + 2);
    // 留言排版（左邊一大塊，字越大越好），算寫字要多久
    const c = this.layer.ctx;
    const M = BACK.msg;
    // 字級依「可用高度扣掉署名」來算：署名最大 42 px，加上最後一行的下伸部（愛心會掉到基線下面）與間距，預留 SIG_RESERVE
    // v2：字級照螢幕的標準（40～60，依字數）換成卡面字級；照子句斷行（字只小一點點也值得）
    const sigEst = cpx(sigV2(msgMaxFor(m.text)));
    const boxH = M.h - (sigEst * 1.5 + cpx(V2.msgMax) * 0.3);
    const opt = { min: cpx(V2.msgMin), max: cpx(msgMaxFor(m.text)), lineHeight: 1.24, maxLines: 5 };
    const byW = fitText(c, m.text, HAND, M.w, boxH, opt);
    const byC = fitClauses(c, m.text, HAND, M.w, boxH, opt);
    this.fit = byC && byC.size >= byW.size * 0.9 ? byC : byW;
    const fit = this.fit;
    this.msgScreen = fit.size * CARD_S;
    const nChars = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const sigText = signature(m.name);
    let writeDur = clamp(0.07 * nChars + 0.3, 0.8, 3.4);
    const sigDur = clamp(0.06 * Array.from(sigText).length + 0.25, 0.5, 1.1);
    const read = readSeconds(m.text);
    let write = beatAfter(au, flip + T.flipDur - 0.06);
    if (write + writeDur + sigDur + read * 0.5 > e - 0.2) {
      // 太短：落下時就翻身（背面朝上落定），一落定就寫
      this.tumble = true;
      flip = Infinity;
      write = b0 + 0.08;
      const avail = e - 0.3 - write - read * 0.55;
      writeDur = clamp(Math.min(writeDur, avail * 0.75), 0.6, writeDur);
    }
    T.flip = flip; T.write = write;
    T.writeEnd = write + writeDur;
    T.sigEnd = T.writeEnd + beat * 0.5 + sigDur;
    // 郵戳：簽完名的下一拍；來不及就在窗格最後一拍前
    let stamp = beatAfter(au, T.sigEnd + 0.04);
    const lastBeat = au.timeOfBeat(Math.floor(au.beatAt(e - 0.25)));
    if (stamp > e - 0.25) stamp = Math.max(lastBeat, T.sigEnd);
    T.stamp = stamp;
    // 翻回正面：最後一個小節線（留言要已經讀完、正面還能看一小節）
    const barLen = beat * 4;
    let back = Infinity;
    for (let i = Math.ceil(au.barAt(s) - 1e-6), k = 0; k < 64; i++, k++) {
      const tb = au.timeOfBar(i);
      if (tb > e - barLen * 0.7) break;
      if (tb >= T.sigEnd + read && tb >= T.stamp + beat * 1.5) back = tb;
    }
    T.back = back;

    // ---- 每個字的位置與時間
    const sigSize = (this.sigSize = Math.round(cpx(sigV2(fit.size * CARD_S))));
    // 署名永遠在最後一行下面：最後一行的基線往下讓出字級的 0.3（下伸部）再放署名
    const sigGap = fit.size * 0.3 + sigSize * 1.15;
    const blockH = fit.height + sigGap + sigSize * 0.3;
    const top = M.y + Math.max(0, (M.h - blockH) * 0.42) + fit.size * 0.9;
    let idx = 0;
    fit.lines.forEach((ln, li) => {
      const lay = layout(ln, HAND, fit.size);
      for (const g of lay.glyphs) {
        const a = write + (writeDur * idx) / nChars;
        this.glyphs.push({ ch: g.ch, x: M.x + g.x, y: top + li * fit.lineHeight, w: g.w, size: fit.size, fam: HAND, t0: a, t1: a + writeDur / nChars, sig: false });
        idx++;
      }
    });
    const sl = layout(sigText, HAND_L, sigSize);
    const right = M.x + clamp(fit.width, 380, M.w);
    const sy = top + (fit.lines.length - 1) * fit.lineHeight + sigGap;
    const s0 = T.writeEnd + beat * 0.5;
    for (const g of sl.glyphs) {
      const a = s0 + (sigDur * g.i) / sl.glyphs.length;
      this.glyphs.push({ ch: g.ch, x: right - sl.width + g.x, y: sy, w: g.w, size: sigSize, fam: HAND_L, t0: a, t1: a + sigDur / sl.glyphs.length, sig: true });
    }

    // ---- 背面印好的部分、郵戳
    const couple = m.couple;
    drawBackStatic(this.backStatic.ctx, {
      to: couple ? '全體賓客 收' : `${COUPLE_ZH} 收`,
      addr: '幸福里 永遠路 1 號',
      from: `寄件人：${couple ? COUPLE_ZH : m.name || '一位賓客'}`,
      tag: `No.${pad3(m.n)}${couple ? '  ·  FROM THE COUPLE' : ''}`,
    });
    this.backStatic.upload();
    this.mark = makePostmark(MARK_DATE, this.seed);
  }

  /** 不會變的：前景的葉子、桌上的道具（畫好就上傳，道具的小畫布馬上還）。 */
  private drawStatic() {
    drawForegroundLeaves(this.leaves.ctx);
    this.ctx.renderer.initTexture(this.leaves.upload());
    const cup = makeCup(), env = makeEnvelope();
    drawTableProps(this.props.ctx, cup.cv, cup, env.cv, env);
    this.ctx.renderer.initTexture(this.props.upload());
    cup.cv.width = cup.cv.height = 0; env.cv.width = env.cv.height = 0;
  }

  override dispose() {
    if (this.mark) this.mark.cv.width = this.mark.cv.height = 0;
    super.dispose();
  }

  // ---------------------------------------------------------------- 卡片的姿勢、鏡頭
  /** t 時卡片的位置（世界座標，y 向上）、高度 z、繞 x 軸翻了多少（0 = 正面朝上、π = 背面朝上）、繞 z 的歪斜。 */
  private pose(t: number) {
    const T = this.T, s = this.ctx.start;
    let x = 0, y = 0, z = 0, rx = 0, rz = 0;
    // 落下：從右上方、高處、歪歪地掉下來，第一拍落定
    if (t < T.land) {
      const u = prog(t, s, T.land);
      const k = 1 - ease.outCubic(u);
      x += 160 * k; y += 620 * k;
      z = 900 * (1 - ease.inQuad(u));
      rz -= 0.24 * k;
      rx = this.tumble ? lerp(0.35, Math.PI, ease.outCubic(u)) : 0.42 * k * k;
    } else if (this.tumble) rx = Math.PI;
    // 落定後的彈一下（紙拍在桌上）
    const land = t - T.land;
    if (land >= 0) rx += 0.05 * Math.exp(-land * 9) * Math.sin(land * 26);
    // 翻面（與翻回來）：同一個方向一直轉，抬起、轉、落下再彈一下
    for (const tf of [T.flip, T.back]) {
      if (!isFinite(tf) || t < tf) continue;
      const u = clamp((t - tf) / T.flipDur);
      rx += Math.PI * ease.inOutCubic(u);
      z += LIFT * Math.sin(Math.PI * u);
      rz -= 0.07 * Math.sin(Math.PI * u);
      const after = t - tf - T.flipDur;
      if (after >= 0) rx += 0.045 * Math.exp(-after * 9) * Math.sin(after * 26);
    }
    return { x, y, z, rx, rz };
  }

  /** 鏡頭推近的進度（0..1）：一個小節推一段，每段緩進緩出，所以在小節線上停住。 */
  private push(t: number) {
    const B = this.stops, n = B.length - 1;
    for (let j = 0; j < n; j++) if (t < B[j + 1]! || j === n - 1) return (j + ease.inOutCubic(clamp((t - B[j]!) / Math.max(1e-3, B[j + 1]! - B[j]!)))) / n;
    return 1;
  }

  private camera(f: Frame) {
    const K = this.card, t = f.t;
    const g = this.push(t);
    const dist = (K.D0 / CARD_S) * lerp(1.06, 1.0, g);
    // 俯角約 13°、稍微從右邊看過來，窗格裡慢慢搖到左邊；再加一點點手持的晃
    const tilt = lerp(0.25, 0.2, g) + 0.004 * noise1(t * 0.35, 3);
    const yaw = lerp(0.05, -0.035, ease.inOutCubic(f.p)) + 0.003 * noise1(t * 0.3, 7);
    const roll = -0.012 + 0.003 * noise1(t * 0.25, 11);
    const cam = K.cam;
    cam.position.set(Math.sin(yaw) * Math.sin(tilt) * dist, -Math.cos(yaw) * Math.sin(tilt) * dist, Math.cos(tilt) * dist);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.lookAt(0, 0, 0);
    cam.setViewOffset(W, H, W / 2 - SC.x, H / 2 - SC.y, W, H);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return { dist, g, yaw };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, T = this.T;
    const ps = this.pose(t);
    const K = this.card;
    const cv = this.camera(f);

    // ---- 卡片的矩陣
    const M = new THREE.Matrix4().makeTranslation(ps.x, ps.y, ps.z)
      .multiply(new THREE.Matrix4().makeRotationZ(ps.rz))
      .multiply(new THREE.Matrix4().makeRotationX(ps.rx));
    K.mesh.matrix.copy(M); K.mesh.matrixWorldNeedsUpdate = true;
    // 看得到哪一面：正面的法向量朝著鏡頭就是正面
    const n = new THREE.Vector3(0, 0, 1).transformDirection(M);
    const front = n.dot(K.cam.position.clone().sub(new THREE.Vector3(ps.x, ps.y, ps.z))) > 0;

    // ---- 桌面：對焦距離、影子（光從左上來：抬得越高影子越往右下、越模糊越淡；翻起來時影子變窄）
    const tu = (K.table.material as THREE.RawShaderMaterial).uniforms;
    tu.focus!.value = cv.dist;
    (tu.shC!.value as THREE.Vector4).set(ps.x + 8 + ps.z * 0.24, ps.y - 11 - ps.z * 0.3, CW / 2, (CH / 2) * Math.abs(Math.cos(ps.rx)) + 2);
    (tu.shP!.value as THREE.Vector3).set(ps.rz, 6 + ps.z * 0.09, 0.34 * clamp(1 - ps.z / 1400, 0.25, 1));
    tu.uT!.value = t;
    tu.propsTex!.value = this.props.texture;
    (tu.propsR!.value as THREE.Vector4).set(PROPS_R.x, PROPS_R.y, PROPS_R.w, PROPS_R.h);
    tu.propsOn!.value = 1;

    // ---- 卡面：只畫看得到的那一面
    const L = this.layer;
    L.clear();
    if (front) {
      const u = this.land.u;
      u.t!.value = t; u.kick!.value = f.a.kick; u.bass!.value = f.a.bass;
      u.seed!.value = (this.seed % 97) * 0.37;
      // 共用的 shader：每格都要設（別的明信片窗格可能留下別的值）
      u.picB!.value = PIC.y1 - this.subRoom;
      // 小船整個窗格從右往左漂一段，每一拍輕輕上下（落在拍點上的一下，不是等速晃）
      u.boatX!.value = lerp(1010, 860, f.p);
      u.bob!.value = -3.5 * ease.outCubic(clamp(1 - f.beatPhase * 2.2)) + Math.sin(t * 1.3) * 1.2;
      this.land.render(renderer, this.face);
      this.drawFront(L.ctx, t);
    } else {
      this.backPaper.render(renderer, this.face);
      comp.draw(renderer, this.backStatic.texture, this.face);
      this.drawBack(L.ctx, t);
    }
    comp.draw(renderer, L.upload(), this.face);

    K.mat.uniforms.faceTex!.value = this.face.texture;
    renderer.setRenderTarget(out);
    renderer.clearDepth();
    renderer.render(K.scene, K.cam);

    // ---- 蓋在卡片上面的：寫字的鋼筆、茶的熱氣
    this.drawOver(t, M);
    comp.draw(renderer, this.over.upload(), out);
    // ---- 前景失焦的葉子：比卡片近，推近與搖鏡時移得比卡片多（視差），在風裡輕輕擺
    const sc = 1 / (1 + 0.1 * cv.g);
    const wind = 0.006 * Math.sin(t * 0.9) + 0.003 * Math.sin(t * 2.2 + 1);
    comp.draw(renderer, this.leaves.texture, out, { scale: [sc, sc], offset: [(1 - sc) * 0.32 + cv.yaw * 0.5 + wind, -(1 - sc) * 0.4 + wind * 0.6] });

    // ---- 後製：落定、翻面落下、蓋郵戳時震一下
    const hit = (t0: number, a: number) => (isFinite(t0) ? a * pulse(t, t0, 0.06) : 0);
    const flipLand = (tf: number) => (isFinite(tf) ? tf + T.flipDur : Infinity);
    const sh = hit(T.land, 5) + hit(flipLand(T.flip), 6) + hit(flipLand(T.back), 6) + hit(T.stamp, 6);
    const sgn = hash(Math.floor(t * 60), this.seed) > 0.5 ? 1 : -1;
    return {
      paper: 1, bloom: 0.22, bloomThreshold: 0.98, bloomKnee: 0.12, halation: 0.06, vignette: 0.42, grain: 0.045,
      shake: [sh * 0.6 * sgn, sh],
      zoom: 1 + 0.004 * pulse(t, T.stamp, 0.1),
    };
  }

  // ---------------------------------------------------------------- 鋼筆、熱氣（螢幕座標）
  /** 世界座標 → 螢幕 px。 */
  private proj(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.card.cam);
    return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
  }

  /**
   * 筆在 t 時（卡面座標）要在哪裡：寫某個字時筆尖跟著斜遮罩的前緣走、上下畫小小的起伏；兩個字之間移過去（換行、簽名時抬高一點）。
   * 不在寫字時回傳 null。
   */
  private nibOnCard(t: number): { x: number; y: number; lift: number } | null {
    const gs = this.glyphs.filter((g) => g.ch !== ' ');
    if (!gs.length || t < gs[0]!.t0 || t > gs[gs.length - 1]!.t1) return null;
    let i = 0;
    while (i + 1 < gs.length && gs[i + 1]!.t0 <= t) i++;
    const g = gs[i]!;
    const at = (q: Glyph, r: number) => ({ x: q.x + r * q.w * 0.92 + 3, y: q.y - q.size * 0.32 + q.size * 0.24 * Math.sin(r * Math.PI * 2.5 + q.x * 0.05) });
    const r = clamp((t - g.t0) / Math.max(1e-3, g.t1 - g.t0));
    if (r < 1 || i + 1 >= gs.length) return { ...at(g, r), lift: 0.03 };
    const n = gs[i + 1]!, u = clamp((t - g.t1) / Math.max(1e-3, n.t0 - g.t1));
    const a = at(g, 1), b = at(n, 0), eu = ease.inOutQuad(u);
    const hop = n.y !== g.y ? (n.sig !== g.sig ? 0.7 : 0.45) : 0.14;
    return { x: lerp(a.x, b.x, eu), y: lerp(a.y, b.y, eu), lift: hop * Math.sin(Math.PI * u) };
  }

  /** 蓋在卡片上面的一層：鋼筆（寫字，或躺在卡片右邊的桌上）與茶的熱氣。 */
  private drawOver(t: number, M: THREE.Matrix4) {
    const L = this.over, c = L.ctx;
    L.clear();
    // 卡面座標（背面）→ 世界 → 螢幕
    const onCard = (x: number, y: number) => { const v = new THREE.Vector3(x - CW / 2, y - CH / 2, -1.5).applyMatrix4(M); return this.proj(v.x, v.y, v.z); };
    const rest = { ...this.proj(PEN_REST.x, PEN_REST.y, 0), a: PEN_REST.a, lift: 0, rest: 1 };
    const gs = this.glyphs;
    let pen = rest;
    if (gs.length) {
      const first = gs[0]!, last = gs[gs.length - 1]!;
      const held = (tt: number) => { const q = this.nibOnCard(tt)!; const sp = onCard(q.x, q.y); return { ...sp, a: PEN_WRITE_A, lift: q.lift, rest: 0 }; };
      const move = (p: typeof rest, q: typeof rest, u: number) => {
        const eu = ease.inOutCubic(clamp(u));
        return { x: lerp(p.x, q.x, eu), y: lerp(p.y, q.y, eu), a: lerp(p.a, q.a, eu), rest: lerp(p.rest, q.rest, eu), lift: lerp(p.lift, q.lift, eu) + 0.8 * Math.sin(Math.PI * clamp(u)) };
      };
      // 卡片翻好（或落定）了筆才拿起來：不要去追一張還在翻的卡片
      const T = this.T, settled = isFinite(T.flip) ? T.flip + T.flipDur + 0.05 : T.land + 0.05;
      const tin = clamp(first.t0 - settled, 0.08, 0.45);
      if (t >= first.t0 - tin && t < first.t0) pen = move(rest, held(first.t0), (t - first.t0 + tin) / tin);
      else if (t >= first.t0 && t <= last.t1) pen = held(t);
      else if (t > last.t1 && t < last.t1 + 0.6) pen = move(held(last.t1), rest, (t - last.t1) / 0.6);
    }
    c.save();
    c.translate(pen.x, pen.y); c.scale(PEN_K, PEN_K);
    drawPen(c, 0, 0, pen.a, pen.lift, pen.rest);
    c.restore();
    // 茶的熱氣（杯子畫在桌面上，熱氣往鏡頭飄，畫在最上面）
    const cp = this.proj(CUP_W.x, CUP_W.y, 0);
    c.save(); c.translate(cp.x, cp.y); c.scale(0.69, 0.69);
    drawSteam(c, -6, -10, t, this.seed % 7);
    c.restore();
  }

  // ---------------------------------------------------------------- 正面的字
  /** 正面：左上角小小的「Greetings from 永遠」、右下角一行小字、底下白邊的圖說（正在唱的歌詞：沒有留言時的焦點）。 */
  private drawFront(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx, m = this.msg;
    c.textBaseline = 'alphabetic';
    // 小群一：印在天空角落的圖名（小、淡）
    c.fillStyle = rgba('sepia', 0.6);
    c.font = font(F.serif(600, true), 32); c.letterSpacing = '1px';
    c.fillText('Greetings from', PIC.x0 + 34, PIC.y0 + 56);
    const gw = c.measureText('Greetings from').width;
    c.font = font(F.ming(700), 32); c.letterSpacing = '5px'; c.fillStyle = rgba('blood', 0.8);
    c.fillText('永遠', PIC.x0 + 34 + gw + 14, PIC.y0 + 56);
    c.letterSpacing = '0px';
    // 小群二：右下角的印刷小字（沒有留言時是邀請）
    c.font = font(m ? F.mono(500) : F.hei(500), m ? 20 : 26); c.letterSpacing = m ? '4px' : '2px';
    c.fillStyle = rgba('sepia', m ? 0.4 : 0.55); c.textAlign = 'right';
    const picB = PIC.y1 - this.subRoom;
    // 還沒定日期：只有編號／邀請，不留多的「 · 」
    c.fillText(joinBits('  ·  ', m ? `No.${pad3(m.n)}` : '寫一張給新人：掃描右下角 QR code', DATE_DOTS), CW - 44, picB + 30);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    // 圖說：正在唱的歌詞（印刷字，大）
    const band = { y0: picB + 44, y1: CH - 34 };
    // v2：歌詞在螢幕上 40～52 px（有留言時不比留言大）；有原文時中文最多 44，白邊才放得下兩排
    const ly = lyricAt(lyrics, t);
    const sub = lyricSubOf(ly?.line);
    const st: LyricStyle = { family: F.archivo(100, 700), size: cpx(sub ? Math.min(44, lyricV2(this.msgScreen)) : lyricV2(this.msgScreen)), minSize: cpx(V2.lyrMin), maxWidth: 1200, align: 'center', lineHeight: 1.1, ...paperLyric() };
    if (ly && sub) {
      // 原文（韓文歌）：中文一次一排（照 oneRow），原文整句小一號印在正下方。原文字級照螢幕 px 算（卡面上要乘回 1/CARD_S），
      // 不然卡面 px 的 56 在螢幕上只剩 27
      const full = layoutLyric(c, ly.line, st), lay = oneRow({ ...full, sub: undefined }, t);
      const ms = lay.size * CARD_S;
      const sst: LyricStyle = { ...st, size: ms, maxWidth: 1200 * CARD_S };
      const sLay = layoutLyric(c, sub, subStyleFor(sst, ms));
      const gap = cpx(subGap(ms, sLay.size));
      const total = lay.size * 0.86 + gap + cpx(sLay.height - sLay.size + sLay.size * 0.22);
      const y = band.y0 + (band.y1 - band.y0 - total) / 2 + lay.size * 0.86;
      c.save(); c.translate(CW / 2, y);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.translate(0, gap); c.scale(1 / CARD_S, 1 / CARD_S);
      drawLyricSub(c, sub, t, sst, ms, ly.k);
      c.restore();
    } else if (ly) {
      const lay = oneRow(layoutLyric(c, ly.line, st), t);
      const y = band.y0 + (band.y1 - band.y0 - lay.height) / 2 + lay.size * 0.86;
      c.save(); c.translate(CW / 2, y);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else if (this.instr) {
      // 純音樂：歌名是一行小字（這時候焦點是風景與翻面後的留言）
      const title = `♪  ${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
      c.font = font(F.mono(500), 34); c.letterSpacing = '6px';
      c.fillStyle = rgba('sepia', 0.55); c.textAlign = 'center';
      c.fillText(title, CW / 2, (band.y0 + band.y1) / 2 + 7);
      c.textAlign = 'left'; c.letterSpacing = '0px';
    }
  }

  // ---------------------------------------------------------------- 背面的字
  private drawBack(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx, T = this.T;
    c.textBaseline = 'alphabetic';
    // 手寫的留言：一個字一個字斜斜地寫出來，剛寫的字是濕的（訊號色的暗部），半秒後乾成墨色
    const SK = 0.45;
    for (const g of this.glyphs) {
      if (t < g.t0) break;
      const r = clamp((t - g.t0) / Math.max(1e-3, g.t1 - g.t0));
      const dry = clamp((t - g.t1) / 0.55);
      const base = g.sig ? 0.72 : 0.95;
      c.font = font(g.fam, g.size);
      c.fillStyle = g.ch === '♥' ? rgba('rose') : dry >= 1 ? rgba('sepia', base) : mixRgba('blood', 'sepia', dry, base + (1 - base) * (1 - dry));
      if (r < 1) {
        const w = c.measureText(g.ch).width, h = g.size * 1.2, top = g.y - g.size * 0.95, S = r * (w + SK * h);
        c.save();
        c.beginPath();
        c.moveTo(g.x - 8, top - 6); c.lineTo(g.x + S + 6 * SK, top - 6); c.lineTo(g.x + S - SK * (h + 6), top + h + 6); c.lineTo(g.x - 8, top + h + 6);
        c.closePath(); c.clip();
        c.fillText(g.ch, g.x, g.y);
        c.restore();
      } else c.fillText(g.ch, g.x, g.y);
    }
    // 郵戳：在拍點上從大一點、歪一點「碰」地壓下去
    if (this.mark && t >= T.stamp) {
      const u = prog(t, T.stamp, T.stamp + 0.09, ease.outExpo);
      const mk = this.mark, sc = lerp(1.22, 1, u);
      c.save();
      c.globalAlpha = clamp(u * 2.5);
      c.translate(BACK.mark.x, BACK.mark.y); c.rotate(-0.13 + (1 - u) * 0.06); c.scale(sc, sc);
      c.drawImage(mk.cv, -mk.cx, -mk.cy, mk.w, mk.h);
      c.restore();
    }
    // P.S.：正在唱的歌詞（手寫，中等大小）；純音樂寫一句小小的冷面話
    const P = BACK.ps;
    c.font = font(HAND, 66);
    const psW = c.measureText('P.S.').width + 28;
    const st: LyricStyle = { family: HAND, size: cpx(lyricV2(this.msgScreen)), minSize: cpx(V2.lyrMin), maxWidth: P.x1 - P.x - psW, align: 'left', lineHeight: 1.1, ...paperLyric() };
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = oneRow(layoutLyric(c, ly.line, st), t);
      const y = P.y0 + (P.y1 - P.y0 - lay.height) / 2 + lay.size * 0.86;
      c.save(); c.translate(P.x + psW, y);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
      c.font = font(HAND, 66); c.fillStyle = rgba('sepia', 0.42 * ly.k + 0.2 * (1 - ly.k));
      c.fillText('P.S.', P.x, y);
    } else if (this.instr) {
      c.font = font(HAND, 40); c.fillStyle = rgba('sepia', 0.5);
      c.fillText('P.S.  這首沒有歌詞，請自由發揮。', P.x, (P.y0 + P.y1) / 2 + 14);
    } else {
      c.font = font(HAND, 66); c.fillStyle = rgba('sepia', 0.2);
      c.fillText('P.S.', P.x, (P.y0 + P.y1) / 2 + 22);
    }
  }
}
