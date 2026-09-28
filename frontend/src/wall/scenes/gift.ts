// 禮物盒（亮）：淺色木頭桌上一個包好的禮物盒，訊號色的緞帶十字綁著、上面一個蝴蝶結。這是真的 3D（_t4 的桌面舞台）：
//  - 開場：鏡頭從斜前方看著盒子（遠處的桌面失焦），很慢地繞。
//  - 第一拍：蝴蝶結的一個圈被拉開（縮回結裡）；第二拍：另一個圈；第三拍：整條緞帶被抽走、飛出畫面。
//  - 下一個小節線：盒蓋「啵」地彈起來、翻著飛走；鏡頭同時升到盒子正上方、推近——盒子裡的薄紙上躺著一張卡片，
//    卡片上手寫的就是主打留言（最大、最清楚），署名在下面。之後鏡頭很慢地推近。
//  - 歌詞：開盒前在畫面上方（桌面的遠處）；開盒後印在卡片下緣（跟著卡片一起在畫面裡）。兩個位置在鏡頭升起時交接。
//  - 沒有留言：卡片上是歌詞（大字、跟唱），下緣一行邀請。
// 畫法：_t4 的 Stage（桌面、柔影、景深、燈）；盒子、盒蓋、薄紙、緞帶是 three.js 網格（整晚共用，每個窗格只改位置）；
// 蝴蝶結的圈與尾巴是自己長的扁帶子（_t22 的 stripGeometry）；卡片是一張 render target（紙＋留言圖層＋歌詞圖層每格合成）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, lerp, noise2, frameIdx } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_ZH, type LyricStyle } from './_motifs';
import { preloadText, fitWithSig, INVITE_SMALL, paperSignal } from './_t19';
import { barsIn, sigInk } from './_t1';
import { Stage, camDist, type V3 } from './_t4';
import { placeBlock, drawBlock, sigOf, stripGeometry, setStrip, T22_TEXT, type Rect } from './_t22';

export const spec: PlateSpecDecl = { group: 'type', family: 'keepsake', paper: true, energy: [0.2, 0.9], bars: [4, 10], weight: 1 };

/** 盒子（世界單位 = px；桌面 z = 0，z 往上）：外寬、外深、高、壁厚。盒蓋比盒子大一圈。 */
const BW = 900, BD = 620, BH = 300, WT = 8;
const LW = BW + 26, LD = BD + 26, LH = 110;
/** 盒蓋蓋著時的高度（盒蓋的下緣）。 */
const LID_Z = BH + 12 - LH;
/** 卡片：大小、放在盒子裡的位置與高度。 */
const CW = 760, CH = 500;
const CARD: V3 = [-8, 14, 66];
const CARD_ROT = -0.035;
/** 緞帶寬。 */
const RB = 66;
const FOV = 30;
const D0 = camDist(FOV);

type Mat = THREE.RawShaderMaterial;

// ---------------------------------------------------------------- 卡片的紙（render target 上）
const CARD_PAPER = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vUv * vec2(${CW}.0, ${CH}.0);
    vec3 col = mix(C_PAPER, C_BONE, 0.55) * (0.985 + 0.012 * fbm(p / 90.0, 3) + 0.006 * snoise(p / 3.0));
    // 壓印的細框
    vec2 q = abs(p - vec2(${CW / 2}.0, ${CH / 2}.0)) - vec2(${CW / 2 - 26}.0, ${CH / 2 - 26}.0);
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

function makeRig() {
  const st = new Stage(1, FOV);
  st.U.ambient.value = 0.56;
  st.U.lightDir.value.set(-0.5, -0.7, 0.9).normalize();
  const wrap = st.solidMaterial(`(dot(n.xy, p) < -1.0 ? mix(C_PAPER, C_SEPIA, 0.3) : mix(mix(C_PAPER, C_BONE, 0.4), C_SIGNAL, 0.1) * (0.975 + 0.025 * step(0.5, fract((p.x + p.y) / 36.0))))`);
  const lidMat = st.solidMaterial(`mix(mix(C_PAPER, C_BONE, 0.4), C_SIGNAL, 0.1) * (0.975 + 0.025 * step(0.5, fract((p.x + p.y) / 36.0)))`);
  const satin = st.solidMaterial(`mix(C_SIGNAL, C_BLOOD, 0.5) * (0.62 + 0.95 * pow(max(dot(n, normalize(vec3(-0.25, -0.72, 0.65))), 0.0), 9.0))`);
  const tissue = st.solidMaterial(`mix(C_BONE, C_PAPER, 0.25) * (0.96 + 0.04 * detail * snoise(p / 7.0))`);
  // 盒子（開口朝上）
  const boxG = new THREE.Group();
  boxG.add(box(BW, BD, WT, wrap, 0, 0, WT / 2));
  boxG.add(box(BW, WT, BH, wrap, 0, -BD / 2 + WT / 2, BH / 2), box(BW, WT, BH, wrap, 0, BD / 2 - WT / 2, BH / 2));
  boxG.add(box(WT, BD, BH, wrap, -BW / 2 + WT / 2, 0, BH / 2), box(WT, BD, BH, wrap, BW / 2 - WT / 2, 0, BH / 2));
  // 盒子裡的薄紙：皺皺的，靠牆的地方翻起來
  const tg = new THREE.PlaneGeometry(BW - 2 * WT - 6, BD - 2 * WT - 6, 72, 50);
  const tp = tg.getAttribute('position') as THREE.BufferAttribute;
  const hw = (BW - 2 * WT) / 2, hd = (BD - 2 * WT) / 2;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), y = tp.getY(i);
    const edge = Math.max(Math.abs(x) / hw, Math.abs(y) / hd);
    const crumple = 14 * noise2(x / 60, y / 60, 3) + 6 * noise2(x / 17, y / 23, 9);
    tp.setZ(i, WT + 30 + crumple + 90 * Math.pow(Math.max(0, edge - 0.72) / 0.28, 2));
  }
  tg.computeVertexNormals();
  const tissueM = new THREE.Mesh(tg, tissue);
  tissueM.frustumCulled = false;
  boxG.add(tissueM);
  st.scene.add(boxG);
  // 卡片
  const cardRT = makeRT(CW, CH, { pxScale: 2, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cardMat = st.docMaterial(cardRT.texture, [cardRT.width, cardRT.height], [CW, CH], { radius: 5, edge: 1, depthTest: true });
  const card = st.docMesh(cardMat, CW, CH, CARD[0], CARD[1], CARD[2]);
  card.rotation.z = CARD_ROT;
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
  return { st, cardRT, cardMat, card, lid, rib, loops, tails, knot, boxG };
}

export default class Gift extends Scene {
  rig = shared('gift.rig', makeRig);
  paperPass = shared('gift.cardPaper', CARD_PAPER);
  /** 畫面上方的歌詞（開盒前）。 */
  top = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 卡片上固定的字（留言、署名，畫一次）與每格變的字（歌詞）。 */
  cardL = this.track(new Layer2D(CW, CH, 2, { fast: true }));
  cardD = this.track(new Layer2D(CW, CH, 2, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) >>> 0;
  tL1 = 0; tL2 = 0; tRib = 0; tLid = 0; crane = 1;
  bars: number[] = [];
  topSt: LyricStyle = { family: F.archivo(100, 700), size: 56, minSize: 48, maxWidth: 1500, align: 'center' };
  cardSt: LyricStyle = { family: F.archivo(100, 700), size: 36, minSize: 31, maxWidth: CW - 120, align: 'center' };
  soloSt: LyricStyle = { family: F.archivo(100, 800), size: 58, minSize: 40, maxWidth: CW - 120, align: 'center', lineHeight: 1.16 };
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    const m = this.msg;
    await preloadText(this.ctx, `${m ? m.text + sigOf(m) : ''}${T22_TEXT}${INVITE_SMALL}給${COUPLE_ZH}：FROM THE COUPLE · 新人`);
    const B = au.beatPeriod(s + 0.1);
    const step = e - s < 8 * B ? B / 2 : B;
    const b0 = beatAfter(au, s + Math.min(0.35, B * 0.7));
    this.tL1 = b0; this.tL2 = b0 + step; this.tRib = b0 + 2 * step;
    const bar = barsIn(au, b0 + 3 * step - 0.05, e).find((b) => e - b > 2.4);
    this.tLid = bar !== undefined && bar - (b0 + 3 * step) < B * 2.1 ? bar : b0 + 3 * step;
    const bars = barsIn(au, this.tLid + 0.1, e);
    const barLen = bars.length > 1 ? bars[1]! - bars[0]! : B * 4;
    this.crane = Math.min(barLen * 0.9, 1.8, Math.max(0.6, (e - this.tLid) * 0.4));
    this.bars = barsIn(au, this.tLid + this.crane + 0.2, e);
    const ink = { active: paperSignal(), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28) };
    this.topSt = { ...this.topSt, ...ink };
    this.cardSt = { ...this.cardSt, ...ink };
    this.soloSt = { ...this.soloSt, ...ink };

    // ---- 卡片上的字
    const c = this.cardL.ctx;
    this.cardL.clear();
    c.textBaseline = 'alphabetic';
    c.font = font(F.hand(400), 26); c.fillStyle = rgba('sepia', 0.62);
    c.fillText(m?.couple ? '給大家：' : `給 ${COUPLE_ZH}：`, 58, 76);
    if (m?.couple) {
      c.textAlign = 'right'; c.font = font(F.mono(500), 13); c.letterSpacing = '4px'; c.fillStyle = sigInk(0.9);
      c.fillText('FROM THE COUPLE · 新人', CW - 58, 74); c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    if (m) {
      const fam = F.hand(700), sig = sigOf(m);
      const short = Array.from(m.text).length <= 8;
      const blk = fitWithSig(c, m.text, fam, CW - 130, 290, { min: 34, max: short ? 96 : 76, lineHeight: 1.28, maxLines: 5 }, { ratio: 0.46, min: 26, max: 36 });
      const top = 100 + Math.max(0, (290 - blk.height) * 0.45);
      const pl = placeBlock(c, blk, fam, sig, 64, top);
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.94), sigColor: rgba('sepia', 0.72) });
      c.fillStyle = rgba('sepia', 0.16);
      c.fillRect(64, 404, CW - 128, 1);
    } else {
      c.textAlign = 'center'; c.fillStyle = rgba('sepia', 0.62);
      const fit = fitText(c, INVITE_SMALL, F.hand(700), CW - 140, 40, { min: 22, max: 28 });
      c.font = font(F.hand(700), fit.size);
      c.fillText(INVITE_SMALL, CW / 2, 440);
      c.textAlign = 'left';
    }
    this.cardL.upload();
    this.avoid = [[260, 110, 1400, 800]];
  }

  /** 卡片（render target）：紙＋固定的字＋這一格的歌詞。 */
  private drawCard(t: number, k: number) {
    const { renderer, comp, lyrics } = this.ctx;
    const R = this.rig;
    const D = this.cardD, c = D.ctx;
    D.clear();
    const ly = lyricAt(lyrics, t);
    if (!ly && !this.msg && k > 0.01) {
      // 沒有留言又在間奏：卡片中間不要整片空白
      c.textAlign = 'center'; c.font = font(F.hand(700), 40); c.fillStyle = rgba('sepia', 0.3 * k);
      c.fillText(lyrics.has ? '♪（間奏中）' : '♪ 本曲為純音樂', CW / 2, 262);
      c.textAlign = 'left';
    }
    if (ly && k > 0.01) {
      if (this.msg) {
        const lay = layoutLyric(c, ly.line, this.cardSt);
        c.save(); c.translate(CW / 2, 452 - (lay.rows.length - 1) * lay.size * 0.55);
        drawLyric(c, ly.line, t, this.cardSt, lay, ly.k * k);
        c.restore();
      } else {
        const lay = layoutLyric(c, ly.line, this.soloSt);
        c.save(); c.translate(CW / 2, 262 - (lay.rows.length - 1) * lay.size * 0.58);
        drawLyric(c, ly.line, t, this.soloSt, lay, ly.k * k);
        c.restore();
      }
    }
    this.paperPass.render(renderer, R.cardRT);
    comp.draw(renderer, this.cardL.texture, R.cardRT);
    comp.draw(renderer, D.upload(), R.cardRT);
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

    // ---- 鏡頭：斜前方慢慢繞 → 開盒時升到正上方、推近卡片
    const w2 = ease.inOutCubic(clamp((t - this.tLid) / this.crane));
    const hold = ease.inOutQuad(prog(t, this.tLid + this.crane, e));
    const pre = prog(t, s, this.tLid, ease.inOutQuad);
    const T1: V3 = [0, 70, 170];
    const T2: V3 = [CARD[0], CARD[1] - 32, CARD[2]];
    const tgt: V3 = [lerp(T1[0], T2[0], w2), lerp(T1[1], T2[1], w2), lerp(T1[2], T2[2], w2)];
    const d1 = D0 * (1.12 - 0.06 * pre), d2 = (D0 / 1.3) * (1 - 0.035 * hold);
    const dist = Math.exp(lerp(Math.log(d1), Math.log(d2), w2));
    const tilt = lerp(0.9 - 0.05 * pre, 0.2, w2);
    const yaw = lerp(0.3 - 0.14 * pre, 0.02, w2);
    const pos: V3 = [tgt[0] + Math.sin(yaw) * Math.sin(tilt) * dist, tgt[1] - Math.cos(yaw) * Math.sin(tilt) * dist, tgt[2] + Math.cos(tilt) * dist];
    st.look(pos, tgt, FOV, 1);
    st.U.focus.value = st.depthOf(w2 > 0.5 ? T2 : [0, 0, BH]);
    st.U.aperture.value = lerp(14, 7, w2);
    st.U.pool.value.set(-120, 80, 1500, 0.55);
    st.shadows([
      { x: 28, y: -36, w: BW + 30, h: BD + 30, blur: 38, k: 0.3, r: 10 },
    ]);

    // ---- 卡片（render target 整晚共用：每格都重畫，不依賴上一格留下的內容）
    this.drawCard(t, w2);
    st.render(renderer, out);

    // ---- 開盒前的歌詞：畫面上方（桌面的遠處）；鏡頭升起時交給卡片
    const T0 = this.top, c = T0.ctx;
    T0.clear();
    const ly = lyricAt(lyrics, t);
    const kTop = 1 - clamp(w2 * 1.6);
    if (ly && kTop > 0.01) {
      const lay = layoutLyric(c, ly.line, this.topSt);
      c.save(); c.translate(960, 158 - (lay.rows.length - 1) * lay.size * 0.3);
      drawLyric(c, ly.line, t, this.topSt, lay, ly.k * kTop);
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
