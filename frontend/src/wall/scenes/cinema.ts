// 照片版面「電影院」（暗）：從後排看空的電影院，照片投在大銀幕上——
//  - 銀幕 1.85:1，立在空間裡（鏡頭稍微往上看，有一點梯形）；左右是絲絨布幕（顏色跟著主題的暗色），上面一條橫幕。
//    切進來時場燈還亮著、布幕合著：放映機打亮，影像先投在布幕的皺褶上，布幕往兩邊拉開。
//  - 照片：橫的夠大的裁滿銀幕；直的、手機直拍、小的舊照片完整放在銀幕中間，兩邊是放映的黑（不硬裁）。
//    銀幕上的畫面往焦點慢慢推近（臉越來越大，最後停在字幕上面的空處，不會被字幕蓋住）。
//  - 放映機的光束從頭頂後方打過來，光裡有慢慢飄的灰塵；銀幕的光照到布幕、天花板與座椅的椅背上緣（光的顏色是照片的平均色）。
//  - 座椅只畫空的椅背剪影（不畫觀眾），五排由近到遠，近的那排失焦；鏡頭整個窗格很慢地往前推（近的椅背往下滑出畫面，有視差）。
//  - 字像電影的雙語字幕：思源黑體、置中，投在銀幕下方（是銀幕上的光，跟著透視與推近一起動）——主字（賓客留言＋署名，或新人的註解）在上，
//    歌詞小一號在最下面跟唱；沒有主字時歌詞就是字幕。字的後面銀幕很淡地壓暗。兩個都沒有就只有銀幕。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { clamp, ease, hash, prog } from '../engine/util';
import { settleK } from './_photo';
import { PhotoPlate, P4_GLSL, aboveText, fitInScreen, photoLod, planeQuad, project, quadToUV, quadBounds, subtitleStyle, v4, m3, type Cam } from './_p4';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'screen', energy: [0, 0.85], bars: [4, 8], weight: 1, prefers: ['landscape'] };

const ROWS = 5;
const BG = () => new FSPass(/* glsl */ `
  ${P4_GLSL}
  uniform sampler2D photo; uniform sampler2D txt;
  uniform mat3 scr; uniform vec4 prect; uniform vec4 crop; uniform float lod;
  uniform vec4 sb; uniform vec2 src; uniform float sw;
  uniform float curtain; uniform float proj; uniform float house; uniform float flick;
  uniform vec4 txtR; uniform float txtK; uniform float shadeV;
  uniform vec4 rows[${ROWS}]; uniform float rowS[${ROWS}]; uniform float t; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 avg = P4avg(photo);
    vec3 lightC = mix(avg, C_BONE * 0.8, 0.35);
    vec2 suv = P4quad(scr, p);
    // 銀幕外的距離（px）：給溢出的光用
    vec2 dq = max(vec2(sb.x - p.x, sb.y - p.y), vec2(p.x - sb.z, p.y - sb.w));
    float dOut = length(max(dq, 0.0));
    // 牆與天花板：幾乎全黑，銀幕的光溢出一點、場燈亮時暖暖的
    float n = fbm(p / 260.0, 3);
    vec3 col = C_INK * (0.4 + 0.15 * n);
    col += lightC * proj * 0.05 * exp(-dOut / 200.0);
    col += mix(C_GRAPHITE, C_EMBER, 0.25) * house * 0.05 * (0.7 + 0.3 * n);
    // 牆上兩盞小壁燈（失焦的光點）
    for (int i = 0; i < 2; i++) {
      vec2 lp = vec2(i == 0 ? 120.0 : 1800.0, 230.0);
      float r = length(p - lp);
      col += mix(C_EMBER, C_SIGNAL, 0.5) * (0.06 + 0.2 * house) * (1.0 - smoothstep(9.0, 13.0, r)) * 0.6;
      col += C_EMBER * (0.015 + 0.03 * house) * exp(-r / 60.0);
    }
    // 布幕：銀幕左右（拉開時收在兩邊）與上方一條窄橫幕；布的皺褶跟著布一起動
    float xL = 0.5 * (1.0 - curtain), xR = 1.0 - xL;
    bool onScreen = suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0;
    float inCurtL = step(-0.2, suv.x) * step(suv.x, xL);
    float inCurtR = step(xR, suv.x) * step(suv.x, 1.2);
    float inCurt = max(inCurtL, inCurtR) * step(-0.07, suv.y) * step(suv.y, 1.5);
    float valance = step(-0.075, suv.y) * step(suv.y, -0.008) * step(-0.2, suv.x) * step(suv.x, 1.2);
    vec3 velvet = mix(C_INK2, C_BLOOD, 0.3) * 0.32;
    if (valance > 0.5) {
      float fold = 0.65 + 0.35 * sin(suv.x * sw / 26.0);
      col = velvet * (0.45 + 0.55 * fold) * smoothstep(-0.075, -0.03, suv.y) + lightC * proj * 0.05;
    } else if (inCurt > 0.5) {
      float fu = inCurtL > 0.5 ? suv.x - xL : suv.x - xR;
      float fold = 0.5 + 0.5 * sin(fu * sw / 21.0 + 1.6 * snoise(vec2(fu * 5.0, 0.3)));
      fold = pow(fold, 1.6);
      vec3 cv = velvet * (0.3 + 0.7 * fold);
      // 銀幕的光照到布幕內側
      float edge = inCurtL > 0.5 ? exp(-max(0.0, -suv.x) * 10.0) : exp(-max(0.0, suv.x - 1.0) * 10.0);
      cv += lightC * proj * 0.07 * edge * fold;
      cv += mix(C_GRAPHITE, C_EMBER, 0.2) * house * 0.04 * fold;
      // 布幕合著的時候，影像投在皺褶上（凹的地方暗、凸的地方亮）
      if (onScreen) {
        vec4 ph = P4screenPhoto(photo, suv, prect, crop, lod + 1.5);
        cv += ph.rgb * ph.a * proj * (0.08 + 0.62 * fold) * 0.7;
      }
      // 地面以下被座椅擋住；布幕下緣暗一點
      cv *= 1.0 - 0.5 * smoothstep(1.1, 1.5, suv.y);
      col = cv;
    } else if (onScreen) {
      // 銀幕：放映的光（中間亮一點、四角暗一點、很輕的閃爍），沒照到的地方是放映的黑
      vec4 ph = P4screenPhoto(photo, suv, prect, crop, lod);
      vec2 hq = (suv - 0.5) * 2.0;
      float hot = 1.0 - 0.16 * dot(hq, hq);
      vec3 base = C_BONE * 0.035 * house + avg * 0.012 * proj;
      vec3 img = mix(base, ph.rgb, ph.a) * proj * hot * flick;
      // 銀幕的細孔（推近時才隱約看得到）
      img *= 0.975 + 0.025 * step(0.5, fract(suv.x * sw / 5.0)) * step(0.5, fract(suv.y * sw / 9.25));
      // 字幕後面很淡地壓暗（白紗、天空上的字也清楚），不是框
      img *= 1.0 - txtK * 0.55 * smoothstep(shadeV - 0.08, shadeV + 0.14, suv.y);
      col = img + base * (1.0 - proj);
      // 字幕：銀幕上的光
      vec2 tq = (suv - txtR.xy) / (txtR.zw - txtR.xy);
      if (txtK > 0.0 && tq.x >= 0.0 && tq.x <= 1.0 && tq.y >= 0.0 && tq.y <= 1.0) {
        vec4 tx = P4layer(txt, tq) * txtK * proj;
        col = col * (1.0 - tx.a) + tx.rgb * 0.92;
      }
    }
    // 放映機的光束：從頭頂後方（畫面上緣外）打到銀幕，銀幕上方的暗處看得到光柱，裡面有灰塵慢慢飄
    if (p.y < sb.w && p.y > src.y) {
      float sl = (p.x - src.x) / (p.y - src.y);
      float sL = (sb.x - src.x) / (sb.y - src.y), sR = (sb.z - src.x) / (sb.y - src.y);
      float wq = (sR - sL) * 0.05;
      float inB = p.y < sb.y
        ? smoothstep(sL - wq, sL + wq, sl) * (1.0 - smoothstep(sR - wq, sR + wq, sl))
        : step(sb.x, p.x) * step(p.x, sb.z) * 0.35;
      float along = clamp((p.y - src.y) / (sb.y - src.y), 0.0, 1.0);
      float rays = 0.5 + 0.5 * snoise(vec2(sl * 7.0, t * 0.06));
      float dust = 0.55 + 0.45 * fbm(p / 150.0 + vec2(t * 0.03, -t * 0.02), 3);
      float beam = inB * rays * dust * (0.3 + 0.7 * along) * proj * step(p.y, sb.y);
      col += lightC * beam * 0.075;
      // 光裡的灰塵粒（一格一顆，慢慢飄）
      vec2 cell = floor(p / 46.0);
      vec2 h = hash22(cell);
      vec2 pp = (cell + 0.2 + 0.6 * h) * 46.0 + vec2(sin(t * 0.4 + h.x * 6.28), cos(t * 0.31 + h.y * 6.28)) * 9.0;
      float sp = exp(-dot(p - pp, p - pp) / 2.0) * step(0.74, hash12(cell + 7.1));
      col += mix(lightC, C_BONE, 0.4) * sp * inB * proj * 0.28 * (0.4 + 0.6 * along);
    }
    // 座椅：五排空的椅背剪影（遠到近），上緣被銀幕的光勾一道邊；近的那排失焦
    for (int i = ${ROWS - 1}; i >= 0; i--) {
      vec4 r = rows[i];
      if (r.y < 1.0) continue;
      float P = r.y;
      float lx = mod(p.x - r.z, P) - P * 0.5;
      float rad = P * 0.3;
      float top = r.x + rowS[i] * (p.x - ${W / 2}.0);
      vec2 q = vec2(lx, p.y - (top + 500.0));
      float d = sdBox(q, vec2(P * 0.43 - rad, 500.0 - rad)) - rad;
      float a = 1.0 - smoothstep(-r.w, r.w, d);
      if (a <= 0.0) continue;
      float depth = float(i) / ${ROWS - 1}.0;
      vec3 seat = C_INK * (0.42 + 0.1 * fbm(vec2(p.x / 9.0, p.y / 30.0), 2)) + lightC * proj * 0.01 * depth;
      // 椅背上緣被銀幕的光勾一道細邊（椅背是背光的，只有最上面亮）
      float rim = exp(-max(0.0, p.y - top) / (2.0 + r.w * 0.5)) * smoothstep(P * 0.43, P * 0.05, abs(lx));
      seat += lightC * proj * rim * (0.09 + 0.1 * depth);
      seat += mix(C_GRAPHITE, C_EMBER, 0.25) * house * 0.04;
      col = mix(col, seat, a);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, scr: { value: new THREE.Matrix3() }, prect: { value: new THREE.Vector4(0, 0, 1, 1) },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) }, lod: { value: 0 }, sb: { value: new THREE.Vector4() }, src: { value: new THREE.Vector2() },
  sw: { value: 1200 }, curtain: { value: 0 }, proj: { value: 0 }, house: { value: 1 }, flick: { value: 1 },
  txtR: { value: new THREE.Vector4(0, 0.6, 1, 1) }, txtK: { value: 0 }, shadeV: { value: 0.7 },
  rows: { value: Array.from({ length: ROWS }, () => new THREE.Vector4()) }, rowS: { value: new Array(ROWS).fill(0) }, t: { value: 0 }, k: { value: 1 },
});

/** 銀幕（世界座標）：1.85:1，離鏡頭 D；鏡頭坐在偏左的後排、稍微往上看（銀幕有一點梯形）。 */
const D = 3400, F_ = 1500, HW = 530 * D / F_, HH = HW / 1.85, SCR_Y = 330, CAM_X = -480, PITCH = 0.06;
/** 座椅：離鏡頭的距離（椅背上緣比眼睛低 160 + 0.045d：階梯式，越前面越低）、椅子寬。 */
const ROW_D = [700, 1050, 1450, 1900, 2400];
const SEAT_W = 122;
/**
 * 字幕層：銀幕下面這一段（銀幕 uv 的 y 從 TXT_V0 到 1）。寬度跟銀幕在畫面上差不多（字在畫面上就是設定的字級）；
 * 主字最多 4 行＋署名＋歌詞，整塊最高約 380 px，要從銀幕快一半的地方開始留。
 */
const TXT_V0 = 0.28, TXT_W = 1100, TXT_H = Math.round(TXT_W / 1.85 * (1 - TXT_V0));
/** 字幕最後一行的基線在銀幕的哪裡（uv 的 y）。 */
const TXT_BASE = 0.93;

export default class Cinema extends PhotoPlate {
  bg = shared('cinema.bg', BG);
  sub = this.track(new Layer2D(TXT_W, TXT_H, undefined, { fast: true }));
  /** 字幕整塊的頂（字幕層座標）。 */
  textTop = 0;
  /** 字幕的頂在銀幕的哪裡（uv 的 y）、臉最後停在銀幕的哪裡。 */
  textV = 1;
  at: [number, number] = [0.5, 0.5];
  tCap = 0; tOpen = 0;
  /** 布幕拉開到多寬（銀幕寬的比例）：直的、小的照片兩邊的黑收起來一些（電影院的遮幕跟著畫面比例調），但要留字幕的寬。 */
  openTo = 1;

  override async init() {
    await this.loadPhotos(1);
    const { start, end } = this.ctx;
    const ph = this.photo;
    const L = this.sub;
    const text = this.words(L.ctx, subtitleStyle(880, 380));
    // 整塊的最後一行基線在 TXT_BASE（height 是第一行的頂到最後一行的基線附近）
    const base = ((TXT_BASE - TXT_V0) / (1 - TXT_V0)) * TXT_H;
    this.textTop = base - text.height + text.size * 0.1;
    this.textV = TXT_V0 + (this.textTop / TXT_H) * (1 - TXT_V0);
    this.at = aboveText(this.textV, text.has);
    // 布幕拉開的時間（短窗格拉快一點）；字幕在布幕拉開後出現
    this.tOpen = Math.min(1.3, (end - start) * 0.25);
    this.tCap = start + 0.15 + this.tOpen + 0.15;
    const f0 = fitInScreen(this.img, ph, 1.85, 2 * 530, { k: 0 });
    const textW = text.has ? text.width / TXT_W + 0.08 : 0;
    this.openTo = Math.min(1, Math.max(f0.rect[2] - f0.rect[0] + 0.06, textW));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    // 鏡頭：很慢地往前推（一開始快、越來越慢），同時往一邊平移一點點
    const z0 = 1 - Math.exp(-lt / 7);
    const m = 200 * z0;
    const cx = CAM_X + dir * 70 * ease.inOutQuad(clamp(lt / 12));
    const cam: Cam = { x: cx, y: 0, z: D - m, yaw: -Math.atan2(-CAM_X, D) * 0.85, pitch: PITCH, f: F_ };
    const q = planeQuad(cam, [0, SCR_Y, 0], HW, HH);
    const b = quadBounds(q);
    const u = this.bg.u;
    m3(u.scr!, quadToUV(q));
    v4(u.sb!, [b.x0, b.y0, b.x1, b.y1]);
    (u.src!.value as THREE.Vector2).set(b.cx + dir * 40, -420);
    u.sw!.value = b.w;
    // 銀幕上的畫面往焦點推（推得明顯：1.28 倍），臉最後停在字幕上面的空處
    const fit = fitInScreen(this.img, this.photo, 1.85, b.w, { k: settleK(lt), zoom: 1.28, at: this.at });
    v4(u.prect!, fit.rect);
    v4(u.crop!, fit.crop);
    u.lod!.value = photoLod(this.img.w * (fit.crop[2] - fit.crop[0]), b.w * (fit.rect[2] - fit.rect[0]));
    u.photo!.value = this.tex;
    // 進場：場燈還亮、放映機打亮（輕輕閃兩下）、布幕拉開；退場最後零點三秒收暗一點
    const strike = prog(t, s + 0.05, s + 0.45, ease.outCubic);
    const blink = lt < 0.45 ? 0.75 + 0.25 * Math.sin(lt * 70) : 1;
    u.proj!.value = strike * blink * (1 - 0.15 * prog(t, e - 0.3, e));
    u.house!.value = 1 - prog(t, s + 0.1, s + 0.15 + this.tOpen, ease.inOutQuad) * 0.92;
    u.curtain!.value = this.openTo * prog(t, s + 0.15, s + 0.15 + this.tOpen, ease.inOutCubic);
    // 底片放映的亮度起伏（很輕，24 格一次）
    u.flick!.value = 1 - 0.018 * hash(Math.floor(t * 24), 11);
    // 座椅：每排照鏡頭的距離投影（推近時近的那排長大、往下滑出畫面）
    const rows = u.rows!.value as THREE.Vector4[];
    const rowS = u.rowS!.value as number[];
    ROW_D.forEach((d0, i) => {
      const d = d0 - m;
      if (d < 160) { rows[i]!.set(0, 0, 0, 0); return; }
      // 椅背上緣：一排的兩端照同一個鏡頭投影（鏡頭斜看，一排是斜的線）
      const y = -(160 + 0.045 * d0), z = D - d0, half = 1600;
      const a = project(cam, [CAM_X - half, y, z]), bb = project(cam, [CAM_X + half, y, z]);
      const slope = (bb[1] - a[1]) / (bb[0] - a[0]);
      const yTop = a[1] + slope * (W / 2 - a[0]);
      const P = SEAT_W * (bb[0] - a[0]) / (2 * half);
      const off = project(cam, [i % 2 ? SEAT_W * 0.5 : 0, y, z])[0];
      rowS[i] = slope;
      // 失焦：焦點在銀幕，越近越糊
      const blur = 0.8 + 6 * (900 / d) ** 2;
      rows[i]!.set(yTop, P, off, blur);
    });
    // 字幕
    let txtK = 0;
    if (this.hasText) {
      const L = this.sub;
      if (this.text.draw(L.ctx, t, L.w / 2, this.textTop, { clear: () => L.clear() })) L.upload();
      txtK = prog(t, this.tCap, this.tCap + 0.4, ease.outCubic) * (1 - prog(t, e - 0.3, e));
    }
    u.txt!.value = this.sub.texture;
    u.txtK!.value = txtK;
    u.shadeV!.value = this.textV;
    v4(u.txtR!, [0, TXT_V0, 1, 1]);
    u.t!.value = t;
    u.k!.value = 1;
    this.bg.render(renderer, out);
    return { bloom: 0.25, bloomThreshold: 1.05, halation: 0.15, vignette: 0.45 };
  }
}
