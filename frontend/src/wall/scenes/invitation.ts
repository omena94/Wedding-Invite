// 喜帖（批次 T4・紙本 D，亮）：一張對摺的喜帖躺在木頭桌上，封面是燙金（訊號色）的花押「A & O」與細框。
//  - 開場：鏡頭貼著封面、斜斜地看，燙金的反光在每個小節線掃過去一次。
//  - 第一個小節線（短窗格是第一拍）：封面沿著書脊翻開——真的 3D 的紙卡：翻起來、在半空中時封面的影子落在內頁上，
//    躺平在左邊；鏡頭同時往後拉、移到整張攤開的喜帖上。
//  - 內頁左邊：「本日主題曲」——現在唱的那句歌詞（中等大小，逐字跟唱），上下兩條燙金的細線。
//    內頁右邊：一行一行浮現的喜帖文字（小字）：謹訂於二〇二七年三月十三日…宣文 & 孟庭（燙金）…席設：您現在坐的位置。
//  - 下一個拍點：一張「賓客回函」從畫面右下方飛進來、落在內頁上（在拍點上落地、彈一下，影子收緊）——主打留言寫在回函上，
//    手寫字、畫面上最大的字，是焦點。鏡頭焦點跟著拉到回函上。
//  - 沒有留言：回函寫「這一張留給你」＋一句邀請。純音樂：左頁寫歌名。
// 畫法：封面、內頁（左右一張跨頁）、回函各畫進一張 render target（紙＋墨一個 Canvas＋燙金：燙金的形狀畫在一張遮罩 Canvas，
// 燙金 shader 讀遮罩的邊算出凸版的明暗、加上掃過去的反光）；喜帖是 three.js 的網格（內頁、會翻的封面正反兩面、回函），
// 交給 _t4 的舞台拍（木頭桌、光、影子、景深）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, signature, COUPLE_EN, COUPLE_ZH, WEDDING_DATE } from './_motifs';
import { WEDDING_TIME_FROM } from '../../constants.js';
import { grid, fitMsg, drawFit, layoutRows, drawRows, paperInk, lastIdx, Stage, docRT, camDist, FOIL_GLSL, type Grid, type RowsStyle, type V3 } from './_t4';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.15, 0.75], bars: [4, 8] };

// ---------------------------------------------------------------- 尺寸（像素）
const CW = 640, CH = 900; // 一面
const RW = 700, RH = 520; // 回函
const LY: RowsStyle = { family: F.archivo(100, 800), size: 68, minSize: 56, maxW: CW - 130, maxRows: 3, align: 'center', lineHeight: 1.06 };
const TEXT = '謹訂於年月日星期中午上午下午時舉行結婚典禮敬備喜筵恭請闔第光臨席設您現在坐的位置本日主題曲賓客回函一定到帶著祝福這一張留給你掃描右下角把祝福寄回給新人純音樂間奏中〇一二三四五六七八九十日';

// 喜帖上的日期時間：用網站設定的婚禮日期（改日期不用改這裡）
const ZH_D = '〇一二三四五六七八九';
const zhNum = (n: number) => (n <= 10 ? (n === 10 ? '十' : ZH_D[n]!) : n < 20 ? `十${n % 10 ? ZH_D[n % 10] : ''}` : `${ZH_D[Math.floor(n / 10)]}十${n % 10 ? ZH_D[n % 10] : ''}`);
const [YY, MM, DD] = WEDDING_DATE.split('-').map(Number) as [number, number, number];
const WEEK = '日一二三四五六'[new Date(YY, MM - 1, DD).getDay()]!;
const HOUR = Number(String(WEDDING_TIME_FROM).split(':')[0]);
const DATE_ZH = `${Array.from(String(YY), (d) => ZH_D[Number(d)]).join('')}年${zhNum(MM)}月${zhNum(DD)}日（星期${WEEK}）`;
const TIME_ZH = `${HOUR < 12 ? '上午' : HOUR === 12 ? '中午' : '下午'}${zhNum(HOUR > 12 ? HOUR - 12 : HOUR)}時`;
const INITIALS = COUPLE_EN.split(/\s*&\s*/).map((s) => s.trim()[0] ?? '').join(' & ');

// ---------------------------------------------------------------- 紙（卡紙：很細的壓紋）
const PAPER = () => new FSPass(/* glsl */ `
  uniform vec2 size;
  void main() {
    vec2 p = vec2(FRAG_PX.x, size.y - FRAG_PX.y);
    float weave = sin(p.x * 1.6) * sin(p.y * 1.6);
    vec3 col = C_PAPER * (1.0 + 0.008 * weave + 0.01 * fbm(p / 200.0, 3));
    fragColor = vec4(col, 1.0);
  }`, { size: { value: new THREE.Vector2() } });

/** 燙金：讀遮罩（mask 的 alpha），邊緣算出凸版的明暗，每個小節線一道反光斜斜掃過去。frame > 0：再加一圈燙金細框（回函用）。 */
const FOIL = () => new FSPass(/* glsl */ `
  ${FOIL_GLSL}
  uniform sampler2D mask; uniform vec4 muv; uniform vec2 size; uniform float sweep; uniform float t; uniform float frame;
  float M(vec2 uv) {
    float m = texture(mask, muv.xy + uv * muv.zw).a;
    if (frame > 0.0) {
      vec2 p = uv * size, d = abs(p - size * 0.5) - size * 0.5 + frame;
      m = max(m, 1.0 - smoothstep(0.6, 1.6, abs(max(d.x, d.y))));
    }
    return m;
  }
  void main() {
    vec2 uv = vUv;
    float m = M(uv);
    if (m <= 0.003) discard;
    vec2 px = 1.6 / size;
    // 凸版：遮罩的斜率 → 左上受光的一邊亮、右下暗
    vec2 grad = vec2(M(uv + vec2(px.x, 0.0)) - M(uv - vec2(px.x, 0.0)), M(uv + vec2(0.0, px.y)) - M(uv - vec2(0.0, px.y)));
    float emb = clamp(dot(grad, vec2(-0.7, 0.7)) * 1.4, -1.0, 1.0);
    vec2 p = vec2(uv.x, 1.0 - uv.y) * size;
    float grain = 0.5 + 0.5 * snoise(p * 0.35 + vec2(t * 0.6, 0.0));
    float band = exp(-pow((p.x + p.y * 0.55 - sweep) / 90.0, 2.0));
    float spec = 0.12 + 1.1 * band + 0.25 * max(emb, 0.0);
    fragColor = vec4(foilColor(spec, grain, emb), m);
  }`, {
  mask: { value: null }, muv: { value: new THREE.Vector4(0, 0, 1, 1) }, size: { value: new THREE.Vector2() },
  sweep: { value: 0 }, t: { value: 0 }, frame: { value: 0 },
}, { blending: THREE.NormalBlending, transparent: true });

/** 一塊平面：頂點 x 從 x0 到 x1（局部座標），uv 的 u 從 u0 到 u1（貼圖）。 */
function quad(x0: number, x1: number, h: number, u0: number, u1: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, -h / 2, 0, x1, -h / 2, 0, x1, h / 2, 0, x0, h / 2, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, 0, u1, 0, u1, 1, u0, 1], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function makeRig() {
  const cover = docRT(CW, CH), inside = docRT(CW * 2, CH), reply = docRT(RW, RH);
  const st = new Stage(1, 30);
  st.U.ambient.value = 0.78;
  const mCover = st.docMaterial(cover.texture, [cover.width, cover.height], [CW, CH], { edge: 0, depthTest: true, side: THREE.FrontSide });
  const mInside = st.docMaterial(inside.texture, [inside.width, inside.height], [CW * 2, CH], { edge: 0, depthTest: true });
  const mInsideB = st.docMaterial(inside.texture, [inside.width, inside.height], [CW * 2, CH], { edge: 0, depthTest: true, side: THREE.BackSide });
  const mReply = st.docMaterial(reply.texture, [reply.width, reply.height], [RW, RH], { radius: 6, depthTest: true });
  for (const m of [mInside, mInsideB]) (m.uniforms.gutter!.value as THREE.Vector3).set(0, 26, 0.12);
  // 內頁右半邊（平放）；封面：以書脊（x = 0）為軸翻，正面貼封面、背面貼內頁左半邊（鏡像）
  const base = new THREE.Mesh(quad(0, CW, CH, 0.5, 1), mInside);
  base.position.z = 2;
  const hinge = new THREE.Group();
  hinge.position.z = 3.2;
  const coverF = new THREE.Mesh(quad(0, CW, CH, 0, 1), mCover);
  const coverB = new THREE.Mesh(quad(0, CW, CH, 0.5, 0), mInsideB);
  hinge.add(coverF, coverB);
  const rep = new THREE.Mesh(quad(-RW / 2, RW / 2, RH, 0, 1), mReply);
  for (const m of [base, coverF, coverB, rep]) m.frustumCulled = false;
  st.scene.add(base, hinge, rep);
  return { cover, inside, reply, st, hinge, rep, mReply };
}

export default class Invitation extends Scene {
  paper = shared('invitation.paper', PAPER);
  foil = shared('invitation.foil', FOIL);
  rig = shared('invitation.rig', makeRig);
  /** 燙金的遮罩（三格：封面｜內頁左｜內頁右），畫一次。 */
  foilMask = this.track(new Layer2D(CW * 3, CH, undefined, { fast: true }));
  /** 內頁的墨（小字、歌詞、回函與封面落下的影子），每格重畫。 */
  ink = this.track(new Layer2D(CW * 2, CH, undefined, { fast: true }));
  /** 回函（畫一次）。 */
  replyInk = this.track(new Layer2D(RW, RH, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  tOpen = 0; openDur = 0.9; tReply = 0;
  fit: FitResult | null = null;
  private drawn = false;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT + DATE_ZH + TIME_ZH + COUPLE_ZH + song.title + song.artist + (this.msg ? signature(this.msg.name) + this.msg.text : '') + lyrics.linesIn(s, e).map((l) => l.text).join(''));
    const g = (this.g = grid(au, s, e));
    // 長窗格：封面至少停將近一個小節，再在小節線翻開；短的第一拍就翻
    this.tOpen = g.nBars >= 5 ? g.bars.find((b) => b >= s + g.bar * 0.5) ?? g.b0 : g.b0;
    this.openDur = Math.min(0.9, g.beat * 2);
    // 回函：翻開後的下一個小節線（太晚就下一拍），在拍點上落地
    const after = this.tOpen + this.openDur + 0.2;
    let tr = g.bars.find((b) => b >= after) ?? Infinity;
    const readBy = e - Math.max(2.5, (this.msg?.text.length ?? 10) / 6 + 1.5);
    if (tr > readBy || tr - after > g.beat * 3) tr = au.timeOfBeat(Math.ceil(au.beatAt(after) - 1e-6));
    this.tReply = tr;
    const text = this.msg ? this.msg.text : '這一張留給你';
    // 字級依「可用高度扣掉署名」算：署名一定在留言下面
    this.fit = fitMsg(this.replyInk.ctx, text, F.hand(700), RW - 90, RH - 112 - 64 - 44, { min: 54, max: 104, lineHeight: 1.26 });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, R = this.rig;
    if (!this.drawn) { this.drawFoilMask(); this.drawReply(); this.drawn = true; }
    const theta = Math.PI * ease.inOutCubic(clamp((t - this.tOpen) / this.openDur));
    const land = this.replyPose(t);
    // 燙金的反光：每個小節線掃一次（outCubic）
    const bar = au.barAt(t), bp = bar - Math.floor(bar);
    const sweep = (w: number) => lerp(-400, w + 900, ease.outCubic(clamp(bp * 1.4)));
    // ---- 封面
    this.paper.u.size!.value.set(CW, CH);
    this.paper.render(renderer, R.cover);
    this.foilPass(renderer, R.cover, [0, 0, 1 / 3, 1], [CW, CH], sweep(CW), t, 0);
    // ---- 內頁（左：歌詞；右：喜帖文字）
    this.paper.u.size!.value.set(CW * 2, CH);
    this.paper.render(renderer, R.inside);
    this.foilPass(renderer, R.inside, [1 / 3, 0, 2 / 3, 1], [CW * 2, CH], sweep(CW * 2), t, 0);
    const L = this.ink; L.clear();
    this.drawInside(L.ctx, t, theta, land);
    comp.draw(renderer, L.upload(), R.inside);
    // ---- 回函
    this.paper.u.size!.value.set(RW, RH);
    this.paper.render(renderer, R.reply);
    comp.draw(renderer, this.replyInk.texture, R.reply);
    this.foilPass(renderer, R.reply, [0, 0, 0, 0], [RW, RH], sweep(RW), t, 22);
    // ---- 舞台
    R.hinge.rotation.y = -theta;
    R.rep.position.set(land.x, land.y, land.z);
    R.rep.rotation.set(land.rx, 0, land.rz);
    R.mReply.uniforms.opacity!.value = land.a;
    this.shoot(t, theta, land);
    R.st.render(renderer, out);
    const hit = pulse(t, this.tReply, 0.08);
    return { paper: 1, bloom: 0.5, vignette: 0.3, grain: 0.04, shake: [0, -hit * 3] };
  }

  private foilPass(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, muv: [number, number, number, number], size: [number, number], sweep: number, t: number, frame: number) {
    const u = this.foil.u;
    u.mask!.value = this.foilMask.texture;
    (u.muv!.value as THREE.Vector4).set(...muv);
    (u.size!.value as THREE.Vector2).set(...size);
    u.sweep!.value = sweep; u.t!.value = t; u.frame!.value = frame;
    this.foil.render(renderer, rt);
  }

  /** 回函的位置：從右下方畫面外飛進來（抬高、傾斜），在 tReply 的拍點落地、彈一下。 */
  private replyPose(t: number) {
    const fly = 0.5, tr = this.tReply;
    const u = clamp((t - (tr - fly)) / fly);
    const k = ease.inQuad(u); // 往下落：越來越快，落在拍點上
    const bounce = t > tr ? Math.exp(-(t - tr) * 9) * Math.sin((t - tr) * 30) : 0;
    const end = { x: CW * 0.46, y: -CH * 0.16, z: 7 };
    return {
      x: lerp(CW * 1.6, end.x, ease.outCubic(u)), y: lerp(-CH * 1.1, end.y, ease.outCubic(u)), z: lerp(520, end.z, k) + 10 * Math.max(0, bounce),
      rx: lerp(-0.7, 0, k) + 0.03 * bounce, rz: lerp(0.35, -0.045, ease.outCubic(u)), a: clamp(u * 4), u,
    };
  }

  private shoot(t: number, theta: number, land: { x: number; y: number; z: number; u: number; a: number }) {
    const st = this.rig.st, s = this.ctx.start, e = this.ctx.end;
    const D = camDist(30);
    // 開場：貼近封面（在右邊）、斜；翻開時拉開、移到整張攤開的喜帖；回函落地後焦點拉過去、慢慢推近
    const ko = ease.inOutCubic(clamp((t - this.tOpen + 0.15) / (this.openDur + 0.5)));
    const kr = ease.inOutCubic(clamp((t - this.tReply) / 0.8));
    const push = ease.inOutCubic(clamp((t - this.tReply) / Math.max(1, e - this.tReply)));
    const idle = ease.outCubic(clamp((t - s) / 3));
    const T: V3 = [lerp(CW * 0.55, 150, ko) + 60 * kr, lerp(10, -40, ko) - 30 * kr, 0];
    const dist = D * lerp(0.9 - 0.05 * idle, 1.26, ko) * (1 - 0.05 * push);
    const tilt = THREE.MathUtils.degToRad(lerp(48, 30, ko));
    const yaw = lerp(0.3, 0.06, ko);
    st.look([T[0] + Math.sin(yaw) * dist, T[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T);
    const fCover = st.depthOf([CW * 0.5, 0, 4]), fLyric = st.depthOf([-CW * 0.5, 0, 4]), fReply = st.depthOf([land.x, land.y, land.z]);
    st.U.focus.value = lerp(lerp(fCover, fLyric, ko), lerp(fReply, fLyric, 0.35), kr);
    st.U.aperture.value = 22;
    st.U.pool.value.set(-120, 160, 1500, 0.55);
    // 影子：攤開的卡（封面翻起來時，它在桌上的影子跟著往左邊長）、飛來的回函（越高越散越遠）
    const sx = Math.min(0, CW * Math.cos(theta));
    const lift = Math.sin(theta) * CW * 0.4;
    st.shadows([
      { x: CW / 2 + 10, y: -14, w: CW, h: CH, blur: 16, k: 0.3, r: 4 },
      { x: sx / 2 + lift * 0.5 + 10, y: -14 - lift * 0.4, w: Math.max(1, Math.abs(sx)) + 20, h: CH, blur: 16 + lift * 0.2, k: 0.28 * (theta > 0 ? 1 : 0), r: 4 },
      { x: land.x + 12 + land.z * 0.35, y: land.y - 16 - land.z * 0.45, w: RW, h: RH, rot: -0.045, blur: 14 + land.z * 0.25, k: 0.3 * land.a * (1 - clamp(land.z / 600)), r: 8 },
    ]);
  }

  // ------------------------------------------------------------ 燙金的遮罩（畫一次）
  private drawFoilMask() {
    const c = this.foilMask.ctx;
    this.foilMask.clear();
    c.fillStyle = '#fff'; c.strokeStyle = '#fff';
    c.textBaseline = 'alphabetic'; c.textAlign = 'center';
    // 封面：雙框、四角的小花飾、花押圈、名字、日期
    c.lineWidth = 3; c.strokeRect(30, 30, CW - 60, CH - 60);
    c.lineWidth = 1.2; c.strokeRect(42, 42, CW - 84, CH - 84);
    for (const [x, y, sx, sy] of [[42, 42, 1, 1], [CW - 42, 42, -1, 1], [42, CH - 42, 1, -1], [CW - 42, CH - 42, -1, -1]] as const) {
      c.save(); c.translate(x, y); c.scale(sx, sy);
      c.lineWidth = 1.6;
      c.beginPath(); c.arc(26, 26, 18, Math.PI, 1.5 * Math.PI); c.stroke();
      c.beginPath(); c.arc(26, 26, 7, 0, TAU); c.fill();
      c.restore();
    }
    const cx = CW / 2, cy = 360;
    // 花押圈：一圈細的放射花紋（像鈔票紋的縮小版）
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i <= 720; i++) {
      const a = (i / 720) * TAU, r = 150 + 9 * Math.sin(a * 24) * Math.cos(a * 3);
      if (i) c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    c.stroke();
    c.lineWidth = 2.5; c.beginPath(); c.arc(cx, cy, 128, 0, TAU); c.stroke();
    c.font = font(F.serif(600, true), 118);
    c.fillText(INITIALS, cx, cy + 38);
    c.font = font(F.mono(500), 16); c.letterSpacing = '6px';
    c.fillText('THE WEDDING OF', cx, 610);
    c.letterSpacing = '0px';
    c.font = font(F.serif(600), 44); c.fillText(COUPLE_EN, cx, 668);
    c.font = font(F.ming(700), 30); c.fillText(COUPLE_ZH, cx, 716);
    c.font = font(F.mono(500), 18); c.letterSpacing = '5px';
    c.fillText(WEDDING_DATE.split('-').join(' · '), cx, 790);
    c.letterSpacing = '0px';
    // 內頁左：歌詞上下兩條細線、中間一顆小菱形
    const L0 = CW;
    for (const y of [210, 690]) {
      c.fillRect(L0 + 150, y, CW - 300, 1.5);
      c.save(); c.translate(L0 + CW / 2, y + 0.75); c.rotate(Math.PI / 4); c.fillRect(-5, -5, 10, 10); c.restore();
    }
    // 內頁右：新人的名字、上面一條細線
    const R0 = CW * 2;
    c.font = font(F.ming(900), 34); c.fillText(COUPLE_ZH, R0 + CW / 2, 222);
    c.fillRect(R0 + CW / 2 - 60, 96, 120, 1.5);
    c.textAlign = 'left';
  }

  // ------------------------------------------------------------ 回函（畫一次）
  private drawReply() {
    const c = this.replyInk.ctx, m = this.msg, fit = this.fit!;
    this.replyInk.clear();
    c.textBaseline = 'alphabetic';
    c.font = font(F.ming(700), 22); c.fillStyle = rgba('sepia', 0.85);
    c.fillText('賓客回函', 46, 70);
    c.font = font(F.serif(600, true), 22); c.fillStyle = rgba('sepia', 0.6);
    c.fillText('R.S.V.P.', 146, 70);
    c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.7); c.textAlign = 'right';
    c.fillText(m ? `☑ 一定到　☑ 帶著祝福${m.couple ? '　·　新人' : ''}` : '☐ 一定到　☐ 帶著祝福', RW - 46, 70);
    c.textAlign = 'left';
    c.fillStyle = rgba('sepia', 0.25); c.fillRect(46, 88, RW - 92, 1);
    const top = 112 + fit.size * 0.9 + Math.max(0, (RH - 112 - 64 - 44 - fit.height) * 0.4);
    drawFit(c, fit, F.hand(700), 46, top, { color: rgba('sepia') });
    c.font = font(F.hand(700), m ? 46 : 38); c.fillStyle = rgba('sepia', 0.78); c.textAlign = 'right';
    c.fillText(m ? signature(m.name) : '掃描右下角 QR code，把祝福寄回給新人', RW - 46, top + (fit.lines.length - 1) * fit.lineHeight + 64);
    c.textAlign = 'left';
  }

  // ------------------------------------------------------------ 內頁的墨（每格）
  private drawInside(c: CanvasRenderingContext2D, t: number, theta: number, land: { x: number; y: number; z: number; a: number }) {
    const { lyrics, song } = this.ctx;
    c.textBaseline = 'alphabetic';
    // 左頁：本日主題曲（歌詞，置中）
    c.textAlign = 'center';
    c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.55); c.letterSpacing = '5px';
    c.fillText('♪ 本日主題曲', CW / 2, 180);
    c.letterSpacing = '0px';
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = layoutRows(c, ly.line, LY);
      const top = 450 - lay.height / 2 + lay.size * 0.84;
      c.save(); c.translate(CW / 2, top);
      drawRows(c, lay, LY.family, t, paperInk(), ly.k);
      c.restore();
    } else {
      c.font = font(F.archivo(100, 800), 58); c.fillStyle = rgba('sepia', lyrics.has ? 0.28 : 0.8);
      c.fillText(song.title || COUPLE_EN, CW / 2, 470);
      if (!lyrics.has) { c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.5); c.fillText('（純音樂）', CW / 2, 520); }
    }
    c.textAlign = 'center';
    // 右頁：喜帖文字（小字），翻開後一行一行浮上來
    // （回函落在 y ≈ 334 以下，字都排在它上面）
    const lines: [string, number, number][] = [['謹訂於', 128, 20], [`${DATE_ZH}　${TIME_ZH}`, 162, 20], ['', 222, 0], ['舉行結婚典禮', 262, 20], ['敬備喜筵　恭請　闔第光臨', 294, 20], ['席設：您現在坐的位置', 322, 16]];
    lines.forEach(([s, y, size], i) => {
      if (!s) return;
      const a = this.tOpen + this.openDur * 0.7 + i * 0.09;
      const u = ease.outCubic(clamp((t - a) / 0.4));
      if (u <= 0) return;
      c.globalAlpha = u;
      c.font = font(F.ming(700), size); c.fillStyle = rgba('sepia', i === 5 ? 0.55 : 0.78);
      c.fillText(s, CW * 1.5, y + (1 - u) * 10);
    });
    c.globalAlpha = 1;
    c.textAlign = 'left';
    // 封面翻起來時落在右頁上的影子（靠書脊那邊最濃）
    const sh = Math.sin(theta) * (theta < Math.PI * 0.55 ? 1 : 0.5);
    if (sh > 0.01) {
      const w = CW * Math.max(0.15, Math.cos(theta) * 0.9 + 0.2);
      const gr = c.createLinearGradient(CW, 0, CW + w, 0);
      gr.addColorStop(0, rgba('sepia', 0.3 * sh)); gr.addColorStop(1, rgba('sepia', 0));
      c.fillStyle = gr; c.fillRect(CW, 0, w, CH);
    }
    // 回函落下來時在內頁上的影子（越高越散、越遠）
    if (land.a > 0.01 && land.z < 400) {
      const k = 1 - clamp(land.z / 400);
      const cx = CW + land.x + 14 + land.z * 0.35, cy = CH / 2 - land.y + 18 + land.z * 0.45;
      c.save();
      c.translate(cx, cy); c.rotate(0.045);
      for (let i = 0; i < 6; i++) {
        const g = 8 + i * (6 + land.z * 0.06);
        c.fillStyle = rgba('sepia', 0.05 * k);
        c.beginPath(); c.roundRect(-RW / 2 - g, -RH / 2 - g, RW + 2 * g, RH + 2 * g, 10 + g); c.fill();
      }
      c.restore();
    }
  }
}
