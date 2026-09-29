// 對戒（暗）：珠寶廣告的微距鏡頭。黑絲絨的背景，一只金戒（主題的訊號色）與一只白金戒（紙白）浮在半空慢慢轉。
//  - 開場：兩只戒指分開、各自慢慢轉，棚燈的長條反光在金屬上滑過。
//  - 第一個小節線（窗格短就第一拍）：白金戒一個俐落的弧線飛過去，跟金戒「扣」在一起（叮——火花一閃、畫面一震）。
//  - 接著鏡頭推進金戒的內圈：內圈是霧面的金，主打留言就刻在內圈上（宋體、沿著圓弧、刻痕下緣有一條亮邊），
//    最後一行刻署名與婚禮日期。鏡頭停在能讀完整句的位置，之後很慢地飄；每個小節線一道反光掃過戒面。
//  - 歌詞在戒指上方的黑暗裡（比留言小一級，逐字跟唱）。
//  - 沒有留言：內圈刻的是新人的名字與日期（戒指本來就該刻的），歌詞放大當主角。
// 畫法：兩只戒指是「兩個圓柱夾一段」的實心環，光線與它的交點用解析解算（不用光線步進，便宜又準），
// 外圈拋光（反射棚燈：頂上的柔光箱、右邊的長條燈、下方的白卡、小節線掃過的一道光），內圈霧面；
// 刻字是 init 畫好的圖層（有 mipmap），刻痕用字的 alpha 算暗面與亮邊。整張畫面四點超取樣（引擎的 SS_TAP）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SS_TAP, SS_TAP_GLSL } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, noise1, lerp, frameIdx } from '../engine/util';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_EN, COUPLE_ZH, DATE_DOTS, type LyricStyle } from './_motifs';
import { preloadText, INVITE_SMALL } from './_t19';
import { barsIn } from './_t1';
import { placeBlock, drawBlock, sigOf, fitV2, T22_TEXT, type Rect } from './_t22';
import { lyricV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'keepsake', paper: false, energy: [0.1, 0.75], bars: [4, 12], weight: 1 };

/** 戒指的外半徑、內半徑、半個寬度（世界單位）。 */
const RO = 1.0, RI = 0.9, HH = 0.24;
/** 內圈刻字的圖層：涵蓋內圈 ±1 弧度、整個寬度。 */
const TW = 2400, TH = 640;
const TEX_PER_UNIT = TH / (2 * HH);
const ARC = 1.0;
/** 刻字圖層裡愛心的遮罩色（shader 用 r − g 認出愛心，填點綴色的琺瑯；不會直接出現在畫面上）。 */
const HEART_MASK = 'rgb(255,0,0)';

type V3 = [number, number, number];

const PASS = () => new FSPass(/* glsl */ `
  uniform mat3 rA; uniform vec3 pA; uniform mat3 rB; uniform vec3 pB;
  uniform vec3 camC; uniform vec3 camR; uniform vec3 camU; uniform vec3 camF; uniform float focal;
  uniform sampler2D ins; uniform float ac;
  uniform float sweep; uniform float glint; uniform float t; uniform float kick;
  ${SS_TAP_GLSL}
  const float RO = ${RO.toFixed(3)}, RI = ${RI.toFixed(3)}, HH = ${HH.toFixed(3)};

  // 光線打到一只戒指（戒指座標：軸是 y）：回傳距離（沒打到是 1e9）、交點、哪一面（0 外圈、1 內圈、2 側面）
  float band(vec3 o, vec3 d, out vec3 pl, out int kind) {
    float th = 1e9; kind = -1;
    float a = d.x * d.x + d.z * d.z;
    float b = 2.0 * (o.x * d.x + o.z * d.z);
    float oo = o.x * o.x + o.z * o.z;
    if (a > 1e-8) {
      float D = b * b - 4.0 * a * (oo - RO * RO);
      if (D > 0.0) {
        float t1 = (-b - sqrt(D)) / (2.0 * a);
        if (t1 > 0.0 && abs(o.y + t1 * d.y) <= HH) { th = t1; kind = 0; }
        float Di = b * b - 4.0 * a * (oo - RI * RI);
        if (Di > 0.0) {
          float t2 = (-b + sqrt(Di)) / (2.0 * a);
          if (t2 > 0.0 && t2 < th && abs(o.y + t2 * d.y) <= HH) { th = t2; kind = 1; }
        }
      }
    }
    if (abs(d.y) > 1e-6) {
      float yc = d.y < 0.0 ? HH : -HH;
      float tc = (yc - o.y) / d.y;
      vec3 q = o + tc * d;
      float r2 = q.x * q.x + q.z * q.z;
      if (tc > 0.0 && tc < th && r2 >= RI * RI && r2 <= RO * RO) { th = tc; kind = 2; }
    }
    pl = o + th * d;
    return th;
  }

  // 棚燈（反射用）：頂上偏左的大柔光箱、右邊的長條燈、鏡頭下方的白卡、小節線掃過的一道光；其他地方是黑絲絨
  vec3 env(vec3 r) {
    float key = smoothstep(0.62, 0.93, dot(r, normalize(vec3(-0.35, 0.82, 0.45))));
    float strip = exp(-pow((r.x - 0.72) / 0.07, 2.0)) * smoothstep(-0.3, 0.2, r.y) * (1.0 - smoothstep(0.6, 0.95, r.y));
    float card = smoothstep(0.45, 0.85, dot(r, normalize(vec3(0.1, -0.45, 1.0))));
    float sw = exp(-pow((atan(r.x, r.z) - sweep) / 0.05, 2.0)) * smoothstep(-0.4, 0.3, r.y) * glint;
    // 右邊的長條燈在大鼓時亮一下（戒面上的反光跟著跳）
    return C_BONE * (key * 1.7 + strip * 1.25 * (1.0 + 0.8 * kick) + card * 0.55 + sw * 3.2) + C_INK2 * 0.35;
  }

  vec3 shadeRing(vec3 pl, int kind, mat3 R, vec3 dW, vec3 tint, bool engraved, float dist) {
    float r = length(pl.xz);
    vec3 radial = vec3(pl.x, 0.0, pl.z) / max(r, 1e-4);
    vec3 nl;
    if (kind == 0) nl = normalize(radial + vec3(0.0, pl.y / HH * 0.55, 0.0));          // 外圈：微微隆起（舒適圈）
    else if (kind == 1) nl = normalize(-radial + vec3(0.0, pl.y / HH * 0.18, 0.0));   // 內圈
    else { float e = (r - RI) / (RO - RI); nl = normalize(vec3(0.0, sign(pl.y), 0.0) + radial * (e - 0.5) * 1.6); } // 側面：圓角
    vec3 n = R * nl;
    vec3 rf = reflect(dW, n);
    float fres = pow(1.0 - max(dot(n, -dW), 0.0), 4.0);
    vec3 col;
    if (kind == 1) {
      // 內圈：霧面（拉絲）——主光的漫射＋模糊的反射，沿著圓周有細細的拉絲紋
      float ang = atan(pl.z, pl.x);
      float brush = 0.96 + 0.04 * sin(pl.y * 900.0 + 3.0 * sin(ang * 40.0));
      float dif = max(dot(n, normalize(vec3(-0.3, 0.85, 0.45))), 0.0);
      col = tint * (0.2 + 0.75 * dif + 0.28 * env(normalize(rf + n * 0.6)).r) * brush;
      if (engraved) {
        float du = ang - ac;
        du = mod(du + PI, TAU) - PI;
        vec2 uv = vec2(du / (2.0 * ${ARC.toFixed(3)}) + 0.5, (pl.y + HH) / (2.0 * HH));
        if (uv.x > 0.0 && uv.x < 1.0) {
          // 刻痕：字裡面暗（凹下去、粗糙），字的下緣接到光的那一條亮邊
          float lod = log2(max(1.0, dist * ${TEX_PER_UNIT.toFixed(1)} / focal / max(abs(dot(n, dW)), 0.25)));
          vec4 mm = fastLayer(textureLod(ins, uv, lod));
          float m = mm.a;
          float up = fastLayer(textureLod(ins, uv + vec2(0.0, 0.0045), lod)).a;
          float lip = sat(up - m);
          // 愛心：圖層裡是紅色（只當遮罩），刻好之後填點綴色的琺瑯（愛心只用點綴色）
          float heart = sat((mm.r - mm.g) * 1.5);
          col = mix(col, tint * 0.07, m * 0.92 * (1.0 - heart)) + tint * 1.1 * lip + C_BONE * 0.25 * lip;
          col = mix(col, C_ROSE * (0.55 + 0.35 * dif) + C_BONE * 0.08, heart);
        }
      }
    } else {
      col = tint * env(rf) + C_BONE * fres * 0.35;
    }
    return col;
  }

  vec3 shade(vec2 sp) {
    vec3 dW = normalize(camF * focal + camR * (sp.x - 960.0) + camU * (sp.y - 540.0));
    // 黑絲絨：很暗，中間一團很淡的光
    vec2 q = (sp - vec2(960.0, 600.0)) / vec2(1100.0, 750.0);
    vec3 bg = C_INK * (0.85 + 0.2 * fbm(sp / 500.0, 2)) + C_INK2 * 0.9 * exp(-dot(q, q) * 1.6);
    vec3 pa, pb; int ka, kb;
    vec3 oA = transpose(rA) * (camC - pA), dA = transpose(rA) * dW;
    vec3 oB = transpose(rB) * (camC - pB), dB = transpose(rB) * dW;
    float ta = band(oA, dA, pa, ka);
    float tb = band(oB, dB, pb, kb);
    vec3 gold = mix(C_SIGNAL, C_EMBER, 0.25) * 0.9;
    vec3 plat = mix(C_BONE, C_ASH, 0.35) * 0.85;
    if (ka < 0 && kb < 0) return bg;
    if (ka >= 0 && (kb < 0 || ta < tb)) return shadeRing(pa, ka, rA, dW, gold, true, ta);
    return shadeRing(pb, kb, rB, dW, plat, false, tb);
  }

  void main() {
    vec2 sp0 = FRAG_PX; // y 向上
    vec3 col = vec3(0.0);
    for (int k = ssK0(); k < ssK1(); k++) col += shade(sp0 + rgss(k));
    col *= ssWeight();
    fragColor = vec4(col, 1.0);
  }`, {
  rA: { value: new THREE.Matrix3() }, pA: { value: new THREE.Vector3() }, rB: { value: new THREE.Matrix3() }, pB: { value: new THREE.Vector3() },
  camC: { value: new THREE.Vector3() }, camR: { value: new THREE.Vector3() }, camU: { value: new THREE.Vector3() }, camF: { value: new THREE.Vector3() }, focal: { value: 1800 },
  ins: { value: null }, ac: { value: -Math.PI / 2 }, sweep: { value: -9 }, glint: { value: 0 }, t: { value: 0 }, kick: { value: 0 }, ssTap: SS_TAP,
});

interface Cam { C: V3; T: V3 }
/** 開場（兩只戒指分開）與特寫（看進金戒的內圈）兩個鏡位。 */
const CAM0: Cam = { C: [1.05, 1.85, 4.9], T: [1.0, 0.05, 0.0] };
// 留言標準 v2：刻字小一點（40～60 px），鏡頭不再貼著內圈，而是退到看得到整只金戒、白金戒勾在左前方的中景：
// 戒指是畫面的主角，刻字在遠端的內壁上（從上緣望進去）
// 長焦（像珠寶廣告的微距鏡頭從遠處拍）：近的戒圈不會被透視放得太誇張；金戒在畫面偏左，右下角 QR 的底下保持乾淨
const CAM1: Cam = { C: [0.15, 2.63, 6.53], T: [0.15, 0.14, 0.0] };
const FOCAL0 = 1650, FOCAL1 = 3640;

/**
 * 扣在一起之後白金戒的位置：勾在金戒左前方的戒圈上（穿過內圈、繞過戒圈的頂上、往下掛）。
 * 兩只一樣大的戒指扣在一起，一定有一只的一段弧在另一只的洞裡；勾在左前方，中景時它垂在畫面左下（右下角 QR 的底下保持乾淨），
 * 不會擋到遠端內壁的刻字。
 * 白金戒的座標：x = 金戒的徑向（往外）、y（戒指的軸）= 金戒圓周的切線、z = 往下。
 */
const LINK_PSI = Math.PI - 0.62;
const LINK_R: V3 = [Math.cos(LINK_PSI), 0, Math.sin(LINK_PSI)];
const LINK_P: V3 = [LINK_R[0] * 1.0, -0.6, LINK_R[2] * 1.0];
const LINK_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(...LINK_R), new THREE.Vector3(-Math.sin(LINK_PSI), 0, Math.cos(LINK_PSI)), new THREE.Vector3(0, -1, 0)));
/** 扣住的接觸點（白金戒繞過金戒頂上的地方）：火花從這裡噴。 */
const LINK_HIT: V3 = [LINK_R[0] * 0.95, 0.3, LINK_R[2] * 0.95];
/** 白金戒盪的軸：金戒圓周在接觸點的切線（水平）。 */
const SWING_AXIS = new THREE.Vector3(-Math.sin(LINK_PSI), 0, Math.cos(LINK_PSI)).normalize();
/** 開場時白金戒在右邊。 */
const APART_P: V3 = [2.35, 0.25, -0.3];

export default class Rings extends Scene {
  pass = shared('rings.pass', PASS);
  ins = this.track(new Layer2D(TW, TH, 1, { fast: true }));
  text = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) >>> 0;
  tLock = 0;
  tPush = 1;
  bars: number[] = [];
  lyr: LyricStyle = { family: F.archivo(100, 700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: 1400, align: 'center' };
  /** 刻字圖層 1 px 在畫面上是幾 px（中景鏡頭下、遠端內壁的中間；init 用鏡頭算）。 */
  sTex = 0.35;
  msgScreen: number | null = null;
  avoid: Rect[] = [];
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();
  private qSwing = new THREE.Quaternion();
  private cam = { C: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3(), F: new THREE.Vector3(), focal: 1800 };

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    const m = this.msg;
    await preloadText(this.ctx, `${m ? m.text + sigOf(m) : ''}${T22_TEXT}${INVITE_SMALL}${COUPLE_EN}${COUPLE_ZH}${DATE_DOTS}FROM THE COUPLE`);
    this.ins.texture.generateMipmaps = true;
    this.ins.texture.minFilter = THREE.LinearMipmapLinearFilter;
    const B = au.beatPeriod(s + 0.1);
    // 扣在一起：第一個小節線（太晚、窗格太短就第一拍）；接著推一小節進內圈
    const first = beatAfter(au, s + Math.min(0.35, B * 0.7));
    const bars = barsIn(au, first, e);
    const barLen = bars.length > 1 ? bars[1]! - bars[0]! : B * 4;
    this.tLock = bars[0] !== undefined && bars[0] - first <= barLen * 0.55 && e - bars[0] > barLen * 1.6 ? bars[0] : first;
    this.tPush = Math.min(barLen * 0.95, (e - this.tLock) * 0.4, 2.4);
    this.bars = barsIn(au, this.tLock + this.tPush + 0.2, e);
    // 刻字圖層在畫面上的縮放：中景鏡頭下，遠端內壁中間上下各 0.05 的一段投影到畫面上多高
    this.setCam(CAM1.C, CAM1.T, FOCAL1);
    const a = this.toScreen([0, 0.05, -RI]), b = this.toScreen([0, -0.05, -RI]);
    this.sTex = Math.abs(b.y - a.y) / (0.1 * TEX_PER_UNIT);
    this.drawInscription();
    this.lyr = { ...this.lyr, size: lyricV2(this.msgScreen) };
    this.avoid = [[300, 180, 1320, 560], [220, 96, 1480, 110]];
  }

  /** 刻在金戒內圈的字（圖層座標：中線 x = TW / 2，高 = 戒指寬）。 */
  private drawInscription() {
    const L = this.ins, c = L.ctx, m = this.msg;
    L.clear();
    const cx = TW / 2;
    // 圖層是白字（alpha 才是刻痕）；顏色在 shader 裡決定
    const col = rgba('bone');
    if (m) {
      const fam = F.ming(700);
      const sig = `${sigOf(m)}  ·  ${DATE_DOTS}`;
      // 留言標準 v2：畫面上 40～60 px（依字數），刻字圖層上的字級 = 畫面字級 ÷ sTex；
      // 寬度只用內圈中間約 ±0.75 弧度（畫面上約 700 px）：再往兩邊內壁斜得太厲害
      const S = this.sTex;
      const blk = fitV2(c, m.text, fam, Math.min(1950, 700 / S), TH - 40, S, { lineHeight: 1.16, maxLines: 5 });
      const top = 20 + Math.max(0, (TH - 40 - blk.height) / 2);
      const pl = placeBlock(c, blk, fam, sig, cx, top, { align: 'center', sigAlign: 'center' });
      // 愛心畫成純紅色：不是畫面上的顏色，是給 shader 分辨「這裡填琺瑯」的遮罩
      drawBlock(c, blk, pl, fam, sig, { color: col, sigColor: col, heart: HEART_MASK });
      this.msgScreen = blk.fit.size * S;
    } else {
      // 沒有留言：刻新人的名字與日期（戒指本來就該刻的）；焦點是歌詞，刻字比歌詞小
      const S = this.sTex;
      c.textAlign = 'center'; c.fillStyle = col;
      c.font = font(F.serif(600, true), 48 / S); c.fillText(COUPLE_EN, cx, TH / 2 - 6 / S);
      c.font = font(F.ming(700), 26 / S); c.letterSpacing = `${8 / S}px`; c.fillText(`${COUPLE_ZH}  ${DATE_DOTS}`, cx + 4 / S, TH / 2 + 40 / S);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    L.upload();
  }

  /** 鏡頭（位置、看的點、焦距）→ 基底。 */
  private setCam(C: V3, T: V3, focal: number, roll = 0) {
    const cam = this.cam;
    cam.C.set(...C);
    cam.F.set(T[0] - C[0], T[1] - C[1], T[2] - C[2]).normalize();
    cam.R.crossVectors(cam.F, new THREE.Vector3(0, 1, 0)).normalize();
    cam.U.crossVectors(cam.R, cam.F).normalize();
    if (roll) { cam.R.applyAxisAngle(cam.F, roll); cam.U.applyAxisAngle(cam.F, roll); }
    cam.focal = focal;
  }
  /** 世界座標 → 螢幕 px（y 向下）。 */
  private toScreen(p: V3) {
    const c = this.cam;
    const v = new THREE.Vector3(p[0] - c.C.x, p[1] - c.C.y, p[2] - c.C.z);
    const z = v.dot(c.F);
    return { x: 960 + (c.focal * v.dot(c.R)) / z, y: 540 - (c.focal * v.dot(c.U)) / z };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const L = this.tLock;

    // ---- 戒指的姿勢
    // 金戒：開場微微搖、繞自己的軸慢慢轉；推鏡的時候轉到刻字朝向遠端內壁（正對鏡頭）
    const settle = ease.inOutCubic(prog(t, L, L + this.tPush));
    const spinA = lerp(1.9 + 0.35 * (t - s), 0, settle);
    const wob = (1 - settle) * 0.22;
    this.qa.setFromEuler(new THREE.Euler(wob * Math.sin(t * 0.9) + (1 - settle) * 0.35, spinA, wob * Math.cos(t * 0.7)));
    // 白金戒：開場在右邊自己轉；小節線一個弧線飛過來扣住
    const k = ease.outExpo(clamp((t - (L - 0.16)) / 0.34));
    const qApart = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9 + 0.3 * Math.sin(t * 0.6), -0.6 + 0.4 * (t - s), 0.5));
    this.qb.slerpQuaternions(qApart, LINK_Q, k);
    const arc = Math.sin(Math.PI * k) * 0.5;
    const pB: V3 = [lerp(APART_P[0], LINK_P[0], k), lerp(APART_P[1], LINK_P[1], k) + arc, lerp(APART_P[2], LINK_P[2], k) + arc * 0.6];
    // 白金戒是「掛」在金戒上的：扣住那一下盪很大、慢慢停；之後每個小節線被帶一下（像被輕輕碰到），繞著接觸點的切線擺
    if (t >= L) {
      let sw = 0.3 * Math.exp(-(t - L) * 1.4) * Math.sin((t - L) * 5.2) + 0.015 * Math.sin((t - L) * 1.3);
      for (const b of this.bars) if (t > b) sw += 0.07 * Math.exp(-(t - b) * 1.8) * Math.sin((t - b) * 5.2);
      const qs = this.qSwing.setFromAxisAngle(SWING_AXIS, sw);
      this.qb.premultiply(qs);
      const piv = new THREE.Vector3(...LINK_HIT);
      const off = new THREE.Vector3(...pB).sub(piv).applyQuaternion(qs).add(piv);
      pB[0] = off.x; pB[1] = off.y; pB[2] = off.z;
    }
    // 扣住之後兩只一起很慢地轉一點點（留言保持讀得到）
    const drift = settle * 0.022 * Math.sin((t - L) * 0.45);
    const qPair = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, drift, 0));
    const qA = qPair.clone().multiply(this.qa), qB = t >= L ? qPair.clone().multiply(this.qb) : this.qb;
    const pBw = new THREE.Vector3(...pB).applyQuaternion(t >= L ? qPair : new THREE.Quaternion());
    const P = this.pass;
    (P.u.rA!.value as THREE.Matrix3).setFromMatrix4(this.m4.makeRotationFromQuaternion(qA));
    (P.u.rB!.value as THREE.Matrix3).setFromMatrix4(this.m4.makeRotationFromQuaternion(qB));
    (P.u.pA!.value as THREE.Vector3).set(0, 0, 0);
    (P.u.pB!.value as THREE.Vector3).copy(pBw);

    // ---- 鏡頭：開場一點點往前推；扣住之後推進內圈；最後很慢地飄
    const pre = prog(t, s, L, ease.inOutQuad);
    const c0: V3 = [CAM0.C[0] - 0.1 * pre, CAM0.C[1] - 0.1 * pre, CAM0.C[2] - 0.5 * pre];
    const hold = prog(t, L + this.tPush, e, ease.inOutQuad);
    // 中景時鏡頭很慢地往右繞、往前推一點（刻字的透視跟著變，但一直讀得到）
    const c1: V3 = [CAM1.C[0] + 0.5 * (hold - 0.5), CAM1.C[1] - 0.12 * hold, CAM1.C[2] - 0.35 * hold];
    const C: V3 = [lerp(c0[0], c1[0], settle), lerp(c0[1], c1[1], settle), lerp(c0[2], c1[2], settle)];
    const T: V3 = [lerp(CAM0.T[0], CAM1.T[0], settle), lerp(CAM0.T[1], CAM1.T[1], settle), lerp(CAM0.T[2], CAM1.T[2], settle)];
    this.setCam(C, T, lerp(FOCAL0, FOCAL1, settle), 0.012 * noise1(t * 0.3, 3) * settle);
    const cam = this.cam;
    (P.u.camC!.value as THREE.Vector3).copy(cam.C);
    (P.u.camR!.value as THREE.Vector3).copy(cam.R);
    (P.u.camU!.value as THREE.Vector3).copy(cam.U);
    (P.u.camF!.value as THREE.Vector3).copy(cam.F);
    P.u.focal!.value = cam.focal;
    P.u.ins!.value = this.ins.texture;
    P.u.ac!.value = -Math.PI / 2;
    // 反光：開場一直有一道慢慢滑；扣住的那一下掃一道；之後每個小節線掃一道
    let sw = -9, gl = 0;
    const sweepAt = (t0: number, dur: number) => { if (t >= t0 && t < t0 + dur) { const q = ease.inOutCubic((t - t0) / dur); sw = lerp(-1.3, 1.3, q); gl = Math.sin(Math.PI * q); } };
    if (t < L) { sw = -1.2 + ((t - s) * 0.6) % 2.6; gl = 0.55; }
    sweepAt(L, 0.7);
    for (const b of this.bars) sweepAt(b, 0.85);
    P.u.sweep!.value = sw;
    P.u.glint!.value = gl;
    P.u.t!.value = t;
    P.u.kick!.value = f.a.kick;
    P.render(renderer, out);

    // ---- 歌詞（戒指上方的黑暗裡）
    const T2 = this.text, c = T2.ctx;
    T2.clear();
    const ly = lyricAt(lyrics, t);
    const fade = prog(t, s, s + 0.4);
    if (ly) {
      const lay = layoutLyric(c, ly.line, this.lyr);
      const y = this.msg ? 172 : 200;
      c.save(); c.translate(960, y - (lay.rows.length - 1) * lay.size * 0.3);
      drawLyric(c, ly.line, t, this.lyr, lay, ly.k * fade);
      c.restore();
    } else if (!lyrics.has) {
      c.textAlign = 'center'; c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.55 * fade);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, 960, 150);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    if (!this.msg) {
      c.textAlign = 'center'; c.font = font(F.hei(500), 26); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.7 * prog(t, L + this.tPush * 0.6, L + this.tPush + 0.4));
      c.fillText(INVITE_SMALL, 960, 960);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    } else if (this.msg.couple) {
      c.textAlign = 'center'; c.font = font(F.mono(500), 16); c.letterSpacing = '5px'; c.fillStyle = rgba('signal', 0.8 * prog(t, L + this.tPush * 0.6, L + this.tPush + 0.4));
      c.fillText('FROM THE COUPLE  ·  新人', 960, 250);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    comp.draw(renderer, T2.upload(), out);

    // ---- 扣住的那一下：接觸點一團火花
    this.glow.clear();
    if (t > L - 0.02 && t < L + 0.6) {
      const hit = () => this.toScreen(LINK_HIT);
      sparkParticles(this.glow, t, (tb) => (tb >= L && tb < L + 0.08 ? hit() : null), { rate: 400, life: 0.5, speed: 420, gravity: 700, seed: this.seed + 3, intensity: 1.1 });
      if (t < L + 0.14) { const p = hit(); sparkHead(this.glow, p.x, p.y, t, 1.1, 1 - (t - L) / 0.14); }
    }
    if (this.glow.count) this.glow.render(renderer, out);
    const amp = 6 * pulse(t, L, 0.07);
    const ph = frameIdx(t);
    return {
      bloom: 0.8, bloomRadius: 0.7, halation: 0.25, vignette: 0.55, grain: 0.05, flash: 0.08 * pulse(t, L, 0.08),
      shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2],
      popupAvoid: this.avoid,
    };
  }
}
