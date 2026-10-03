// 照片版面「接觸印樣」（亮）：一張接觸印樣（樣張）放在桌上——兩條底片印出來的黑色片條，六格是同一張照片的六種裁切
// （寬的、緊的、往左一點、往右一點…都繞著焦點），片緣有白色的片號與齒孔。
//  - 開場鏡頭很近、沿著片條橫移；拍點上一支紅色蠟筆把其中一格圈起來（筆畫一圈、稍微超過起點，蠟筆的質感）。
//  - 小節線上被圈的那格「放大」：一張完整的照片（不裁切、有白邊）從那一格浮起來、轉正、變大，落在樣張的右邊，
//    鏡頭同時拉開。直的照片在片條上是橫躺的（底片本來就這樣），放大時轉成直的。
//  - 字用鉛筆手寫在片條下面的空白處（一個字一個字寫）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己寫在那裡；相簿的第一張在上面多一行小小的相簿名；兩個都沒有，放大的照片落在正中間。
//  - 照片完整呈現在放大的那張上，很小的照片最多放大到原尺寸約 1.5 倍。落下之後相片上的畫面往焦點小推，
//    鏡頭也往相片上的焦點推（有字時推到字快出框就停）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter, barAfter } from './_motifs';
import { focusCrop, loadWords, settleK } from './_photo';
import { CAM_GLSL, P1_GLSL, P1Cap, gainOf, inSafe, p1Uniforms, PlaneCam, camUniforms, containScale, cropAround, fitLabel, loadPhotos, mipFor, photoRefs, safePush, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'film', prefers: ['landscape'], energy: [0, 1], bars: [3, 8], weight: 1 };

/** 片格（世界單位）：橫的 3:2；片緣、格距。兩條片條，每條三格（片條下面留給字：主字＋署名＋歌詞）。 */
const FW = 300, FH = 200, GAP = 22, RB = 40;
const STRIP_X0 = -900;
const STRIP_Y = [-484, -192];
/** 第二條片條的下緣：字從這裡下面開始寫。 */
const STRIP_BOT = STRIP_Y[1]! + FH + 2 * RB;
/** 被圈起來的那一格（第二條的第一格：最寬的裁切）。 */
const PICK = 3;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${P1_GLSL}
  uniform sampler2D photo; uniform float lod; uniform vec4 crops[6]; uniform float vert;
  uniform sampler2D edge; uniform vec2 edgeSize;
  uniform vec4 circ; uniform float circP; uniform float seed;
  uniform vec3 pc; uniform float pang; uniform float pscale; uniform vec2 imgHalf; uniform float bord; uniform float pOn; uniform vec4 pcrop;
  uniform sampler2D txt; uniform vec2 txtSize; uniform vec2 txtOrg; uniform float k; uniform float focusZ;

  // 樣張上的一點 → 顏色（紙、片條、片格）
  vec3 sheetAt(vec2 q, float l, float aa) {
    vec3 paper = C_BONE * 0.88;
    for (int si = 0; si < 2; si++) {
      float y0 = si == 0 ? ${STRIP_Y[0]}.0 : ${STRIP_Y[1]}.0;
      vec2 sc = vec2(${STRIP_X0}.0 + (3.0 * ${FW}.0 + 4.0 * ${GAP}.0) * 0.5, y0 + (${FH}.0 + 2.0 * ${RB}.0) * 0.5);
      vec2 sh = vec2((3.0 * ${FW}.0 + 4.0 * ${GAP}.0) * 0.5, (${FH}.0 + 2.0 * ${RB}.0) * 0.5);
      // 片條稍微歪一點（手排的）
      vec2 sq = rot2((float(si) - 0.5) * 0.006) * (q - sc);
      float ds = sdBox(sq, sh);
      if (ds < aa) {
        // 印出來的片條：黑；齒孔是更深一點的方孔；片號是白字
        vec3 c = vec3(0.012, 0.011, 0.01);
        float v = abs(sq.y) - ${FH}.0 * 0.5;
        if (v > 0.0) {
          float pitch = ${FH}.0 * 0.198 * 1.0;
          float u = mod(sq.x + pitch * 0.5, pitch) - pitch * 0.5;
          float hole = sdRound(vec2(u, v - ${RB}.0 * 0.62), vec2(pitch * 0.27, ${RB}.0 * 0.17), 2.0);
          c = mix(c, vec3(0.03, 0.028, 0.026), 1.0 - smoothstep(-aa, aa, hole));
          if (sq.y > 0.0 && v < ${RB}.0 * 0.4) {
            vec4 tx = layerAt(edge, vec2(sq.x + sh.x + float(si) * 37.0, v + edgeSize.y * 0.5 - ${RB}.0 * 0.2) / edgeSize);
            c = mix(c, C_BONE * 0.7, tx.a);
          }
        } else {
          // 片格
          float fx = sq.x + sh.x - ${GAP}.0;
          float fi = floor(fx / (${FW}.0 + ${GAP}.0));
          float lx = fx - fi * (${FW}.0 + ${GAP}.0);
          if (fi >= 0.0 && fi < 3.0 && lx < ${FW}.0) {
            int idx = si * 3 + int(fi);
            vec4 cr = crops[idx];
            vec2 f = vec2(lx / ${FW}.0, (sq.y + ${FH}.0 * 0.5) / ${FH}.0);
            // 直的照片在片條上是橫躺的：格子的 (x, y) 對到照片的 (1 - y, x)
            vec2 g = vert > 0.5 ? vec2(f.y, 1.0 - f.x) : f;
            vec2 uv = cr.xy + g * (cr.zw - cr.xy);
            vec3 ph = photoLin(photo, uv, l) * 0.84;
            float e = min(min(lx, ${FW}.0 - lx), min(sq.y + ${FH}.0 * 0.5, ${FH}.0 * 0.5 - sq.y));
            c = mix(c, ph, smoothstep(0.0, 2.0, e));
          }
        }
        paper = mix(paper, c, 1.0 - smoothstep(-aa, aa, ds));
      }
    }
    return paper;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 hit = camHit(p, 0.0);
    vec2 q = hit.xy;
    float pxw = hit.z / camFocal;
    float aa = pxw;
    float l0 = lod + log2(max(pxw, 1e-3));
    // 桌面（樣張外）：淺色的木頭；樣張是一大張相紙，四邊有一點翹起的影子
    vec3 col = mix(C_PAPER * 0.7, C_FUR * 0.5, 0.25) * (0.92 + 0.08 * snoise(vec2(q.x / 700.0, q.y / 30.0)));
    float dPaper = sdBox(q - vec2(-60.0, -20.0), vec2(1150.0, 680.0));
    col *= 1.0 - 0.3 * exp(-max(dPaper - 6.0, 0.0) / 18.0);
    if (dPaper < aa) {
      vec3 sh = sheetAt(q, l0, aa);
      // 相紙的光澤：一道很淡的斜光
      sh += C_BONE * 0.02 * smoothstep(400.0, 0.0, abs(q.x * 0.7 + q.y - 120.0));
      // 鉛筆字（樣張左下的空白）
      vec4 ink = layerAt(txt, (q - txtOrg) / txtSize);
      sh = sh * (1.0 - ink.a) + ink.rgb;
      col = mix(col, sh, 1.0 - smoothstep(-aa, aa, dPaper));
    }
    // 紅蠟筆圈：繞著被選的那格，筆畫跟著 circP 走一圈多一點，邊緣有蠟的顆粒
    if (circP > 0.0) {
      vec2 d = (q - circ.xy) / circ.zw;
      float ang = atan(d.y, d.x);
      float a = mod(ang - 2.4 + 6.2831853, 6.2831853);
      float wob = 1.0 + 0.035 * sin(ang * 3.0 + seed) + 0.02 * sin(ang * 7.0 + seed * 2.0);
      float r = length(d);
      float tot = circP * 6.2831853 * 1.1;
      float on = step(a, tot) + step(a + 6.2831853, tot);
      // 第二圈（超過起點那段）往外偏一點
      float off = a + 6.2831853 <= tot ? 0.045 : 0.0;
      float dist = abs(r - wob - off) * min(circ.z, circ.w);
      float stroke = 1.0 - smoothstep(4.0, 6.5, dist);
      float wax = 0.75 + 0.25 * step(0.35, hash12(floor(q / 2.0)));
      col = mix(col, C_COLLAR * 0.8, clamp(on, 0.0, 1.0) * stroke * wax * 0.92);
    }
    // 放大的照片：從那一格浮起來（高度 pc.z、縮放 pscale、角度 pang）
    if (pOn > 0.0) {
      vec2 ho = imgHalf + bord;
      vec2 so = vec2(16.0, 24.0) * (1.0 + pc.z / 50.0);
      vec2 sq2 = rot2(pang) * (q - pc.xy - so) / pscale;
      float ds = sdBox(sq2, ho);
      col *= 1.0 - pOn * (0.3 / (1.0 + pc.z / 200.0)) * (ds < 0.0 ? 1.0 : exp(-ds * pscale / (12.0 + pc.z * 0.3)));
      vec3 h2 = camHit(p, pc.z);
      vec2 lq = rot2(pang) * (h2.xy - pc.xy) / pscale;
      float pw = h2.z / camFocal / pscale;
      float dp = sdBox(lq, ho);
      if (dp < pw) {
        vec3 pr = C_BONE * 0.92;
        pr *= 1.0 - 0.05 * smoothstep(-3.0, 0.0, dp);
        float di = sdBox(lq, imgHalf);
        if (di < pw) {
          // 相片上的畫面往焦點小推：框裡對應到照片的 pcrop 那一塊
          vec2 uv = pcrop.xy + (lq + imgHalf) / (2.0 * imgHalf) * (pcrop.zw - pcrop.xy);
          vec3 ph = photoLin(photo, uv, lod + log2(max(pw * (pcrop.z - pcrop.x), 1e-4))) * 0.84;
          pr = mix(pr, ph, 1.0 - smoothstep(-pw, pw, di));
        }
        col = mix(col, pr, (1.0 - smoothstep(-pw, pw, dp)) * pOn);
      }
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...p1Uniforms(),
  photo: { value: null }, lod: { value: 0 }, crops: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 1, 1)) }, vert: { value: 0 },
  edge: { value: null }, edgeSize: { value: new THREE.Vector2(1, 1) },
  circ: { value: new THREE.Vector4() }, circP: { value: 0 }, seed: { value: 0 },
  pc: { value: new THREE.Vector3() }, pang: { value: 0 }, pscale: { value: 1 }, imgHalf: { value: new THREE.Vector2() }, bord: { value: 24 }, pOn: { value: 0 },
  pcrop: { value: new THREE.Vector4(0, 0, 1, 1) },
  txt: { value: null }, txtSize: { value: new THREE.Vector2(1, 1) }, txtOrg: { value: new THREE.Vector2() }, k: { value: 1 }, focusZ: { value: 1700 },
  ...camUniforms(),
});

/** 字（世界單位）：片條下面左邊那一塊的寬、高上限（主字＋署名＋歌詞）；相簿名那一行另外算。 */
const CAP_W = 820, CAP_H = 262, PAD = 20, ALBUM_H = 34;
/** 字的左緣（世界座標）。 */
const CAP_X = -830;

export default class Contactsheet extends Scene {
  bg = shared('contactsheet.bg', BG);
  txt = this.track(new Layer2D(CAP_W + 2 * PAD, CAP_H + 2 * PAD + ALBUM_H, undefined, { fast: true }));
  edge = this.track(new Layer2D(1200, 30, undefined, { fast: true }));
  cam = new PlaneCam();
  seed = seedOf(this.ctx);
  ph!: P1Photo;
  cap!: P1Cap;
  album = '';
  vert = false;
  crops: THREE.Vector4[] = [];
  /** 放大的照片：最後的中心、影像半寬高、白邊。 */
  dest = new THREE.Vector2(); hw = 0; hh = 0; bord = 24;
  tCircle = 0; tUp = 0; tW0 = 0; tW1 = 0;

  override async init() {
    const { start, end, audio } = this.ctx;
    const [ref] = photoRefs(this.ctx, 1);
    const n = ref!.n;
    const marks = Array.from({ length: 4 }, (_, i) => `▸ ${n + i}   ${n + i}A`).join('        ');
    await loadText(`${ref!.caption}${ref!.album}${marks}…`);
    await loadWords(this.ctx);
    [this.ph] = await loadPhotos(this.ctx, [ref!], (x) => this.track(x));
    const c = this.txt.ctx;
    this.cap = new P1Cap(this.ctx, c, {
      family: F.hand(400), min: 40, max: 46, w: CAP_W, h: CAP_H, lineHeight: 1.25, maxLines: 3, gap: 20,
      ink: rgba('sepia', 0.88), unsung: rgba('sepia', 0.25), active: mixRgba('signal', 'sepia', 0.4), sigSize: 28, sigInk: rgba('sepia', 0.7),
    });
    if (ref!.chapter && ref!.album) this.album = fitLabel(c, ref!.album, F.hand(700), 24, CAP_W, 4);
    const { w, h } = this.ph;
    this.vert = h > w * 1.02;
    // 六種裁切（片格是 3:2；直的照片裁成 2:3 再橫躺）
    const fa = this.vert ? FH / FW : FW / FH;
    const plan: [number, number, number][] = [[1.5, -0.15, 0], [1.2, 0.1, -0.05], [2.0, 0, 0], [1.0, 0, 0], [1.35, 0.12, 0.08], [1.7, -0.1, 0.1]];
    this.crops = plan.map(([z, dx, dy]) => new THREE.Vector4(...cropAround(this.ph, fa, z, this.ph.ref.fx + dx, this.ph.ref.fy + dy)));
    // 放大的照片：有字時在樣張右邊（左緣不碰到片條下面的字），沒有就在正中間；很小的照片最多放大 1.5 倍
    const has = this.cap.has;
    const s = containScale(w, h, has ? 760 : 980, has ? 640 : 700);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bord = clamp(0.045 * Math.min(this.hw, this.hh) * 2, 16, 30);
    // 右緣停在畫面右邊約 1840 px 的地方（鏡頭最後看著 x = -70：字的左邊留一點空，鏡頭才推得動）
    this.dest.set(has ? 800 - this.hw - this.bord : 0, has ? -150 : -30);
    // 片號
    const ec = this.edge.ctx;
    ec.font = font(F.mono(500), 18);
    ec.fillStyle = '#fff';
    ec.textBaseline = 'middle';
    ec.fillText(marks, 30, 15);
    this.edge.upload();
    // 時間：拍點上圈、小節線上放大（窗格短就照比例）
    const len = end - start;
    this.tCircle = len < 5 ? start + len * 0.18 : beatAfter(audio, start + 0.6);
    this.tUp = len < 5 ? start + len * 0.38 : Math.min(barAfter(audio, this.tCircle + 0.7), end - 2.2);
    this.tW0 = this.tUp + 0.9;
    this.tW1 = this.tW0 + this.cap.writeDur(0.07, 2.4);
  }

  /** 被圈的那一格的中心（世界座標）。 */
  private pickCenter(): [number, number] {
    const si = Math.floor(PICK / 3), fi = PICK % 3;
    return [STRIP_X0 + GAP + fi * (FW + GAP) + FW / 2, STRIP_Y[si]! + RB + FH / 2];
  }

  /** 字那一塊在樣張上的範圍（世界座標 [x, y, w, h]）：相簿名＋主字＋署名＋歌詞。 */
  private capRect(): [number, number, number, number] {
    return [CAP_X, STRIP_BOT + PAD, this.cap.width, (this.album ? ALBUM_H : 0) + this.cap.height];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.ph.ref);
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1;
    const [px, py] = this.pickCenter();
    // 放大：浮起（高度）、轉正、變大、落到目的地
    const rise = prog(t, this.tUp, this.tUp + 0.85);
    const mv = ease.inOutCubic(rise);
    const rest = ((hash(this.seed, 6) - 0.5) * 3 - 1.2) * (Math.PI / 180);
    // 焦點（落下之後）：相片上的畫面往焦點小推，鏡頭往相片上焦點那一點推
    const fk = settleK(t - this.tUp - 0.85, 6);
    const crop = focusCrop(this.ph.ref, this.ph.w, this.ph.h, this.ph.aspect, fk, { zoom: 1.12, screenW: 2 * this.hw });
    // 焦點在桌上的位置：相片的局部座標（shader 用 rot2(pang) 把世界轉成局部）→ 世界
    const lx = (this.ph.ref.fx - 0.5) * 2 * this.hw, ly = (this.ph.ref.fy - 0.5) * 2 * this.hh;
    const ca = Math.cos(rest), sa = Math.sin(rest);
    const fwx = this.dest.x + ca * lx - sa * ly, fwy = this.dest.y + sa * lx + ca * ly;
    // 鏡頭：開場很近、沿著片條橫移到要圈的那格；放大時拉開到全景，之後一開始快、越來越慢地往焦點推
    const up = ease.inOutCubic(prog(t, this.tUp - 0.1, this.tUp + 0.9));
    const scan = ease.inOutCubic(prog(t, s, this.tCircle));
    const nearX = lerp(px + 520, px + 60, scan), nearY = py - 40;
    const has = this.cap.has, cr = this.capRect();
    const farX = has ? -70 : this.dest.x * 0.3, farY = -20;
    const place = (k: number) => {
      const a = (has ? 0.35 : 0.75) * k;
      this.cam.look(lerp(nearX, lerp(farX, fwx, a), up), lerp(nearY, lerp(farY, fwy, a), up), lerp(1150, 1800, up) - 120 * k,
        lerp(16, 9, up) * (Math.PI / 180), dir * lerp(-3, 1, up) * (Math.PI / 180), 0).zoomBy(1 + (has ? 0.25 : 0.32) * k * up);
      // 字寫出來之後要一直在畫面裡（推到字快出框就停）
      return !has || t < this.tW0 - 0.6 || inSafe(this.cam.rect(...cr));
    };
    safePush(fk, place);
    this.cam.apply(u);
    u.photo!.value = this.ph.tex;
    // 片格很小：mip 照片格的大小算
    u.lod!.value = mipFor(this.ph.w, 2 * this.hw);
    (u.crops!.value as THREE.Vector4[]).forEach((v, i) => v.copy(this.crops[i]!));
    u.vert!.value = this.vert ? 1 : 0;
    u.edge!.value = this.edge.texture;
    (u.edgeSize!.value as THREE.Vector2).set(this.edge.w, this.edge.h);
    // 紅蠟筆圈
    (u.circ!.value as THREE.Vector4).set(px, py, FW / 2 + 34, FH / 2 + 30);
    u.circP!.value = ease.inOutQuad(prog(t, this.tCircle, this.tCircle + 0.55));
    u.seed!.value = (this.seed % 13) + 0.3;
    const z = Math.sin(Math.PI * Math.min(1, rise * 1.05)) * 140 + (rise >= 1 ? 0 : 4);
    // 一開始跟片格一樣大（直的照片橫躺），最後是完整的照片
    const fitW = this.vert ? FH : FW, fitH = this.vert ? FW : FH;
    const s0 = Math.min(fitW / (2 * this.hw), fitH / (2 * this.hh));
    (u.pc!.value as THREE.Vector3).set(lerp(px, this.dest.x, mv), lerp(py, this.dest.y, mv), z);
    u.pang!.value = lerp(this.vert ? Math.PI / 2 : 0, rest, mv);
    u.pscale!.value = lerp(s0, 1, ease.outCubic(rise));
    (u.imgHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    (u.pcrop!.value as THREE.Vector4).set(...crop);
    u.bord!.value = this.bord * ease.outCubic(rise);
    u.pOn!.value = rise > 0 ? 1 : 0;
    u.k!.value = 1 - 0.08 * prog(t, e - 0.3, e);
    // 鉛筆字：片條下面的空白（世界座標），放大的照片落下之後寫；歌詞（不管是主字還是字幕）提早一點淡入
    const L = this.txt;
    if (has) {
      const main = this.cap.hasMain;
      if (t >= this.tW0 - (main ? 0 : 0.6) && this.cap.draw(L.ctx, t, PAD, PAD + (this.album ? ALBUM_H : 0), {
        chars: this.cap.charsAt(t, this.tW0, this.tW1), alpha: main ? 1 : prog(t, this.tW0 - 0.6, this.tW0),
        lyricAlpha: prog(t, this.tW0 - 0.6, this.tW0),
        clear: () => {
          L.clear();
          if (this.album) {
            const c = L.ctx;
            c.font = font(F.hand(700), 24); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.55);
            c.fillText(this.album, PAD, PAD + 24); c.letterSpacing = '0px';
          }
        },
      })) L.upload();
    }
    u.txt!.value = L.texture;
    (u.txtSize!.value as THREE.Vector2).set(L.w, L.h);
    (u.txtOrg!.value as THREE.Vector2).set(CAP_X - PAD, STRIP_BOT);
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.32 };
  }
}
