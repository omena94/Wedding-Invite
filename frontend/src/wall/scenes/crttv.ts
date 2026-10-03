// 照片版面「老電視」（暗）：客廳一角，映像管電視擺在矮櫃上——
//  - 木紋外殼的映像管電視（看得到右邊的側板與頂板，有透視），下面墊著一塊白色的蕾絲墊；矮櫃有抽屜縫與小把手；
//    左上方一盞檯燈的暖光照在牆上，電視的光照到牆、蕾絲墊與上了漆的櫃面（光的顏色是照片的平均色）。
//  - 螢幕是凸的玻璃：畫面有桶形變形、掃描線、慢慢往上爬的一條亮帶、四角暗一點；玻璃上有檯燈的反光。
//  - 開機：一個亮點拉成一條白線，再往上下展開成畫面（切進來就開機，短窗格也來得及）。
//  - 照片：4:3 的螢幕。橫的夠大的照片裁滿（像電視的 pan & scan）；直的、手機直拍、小的舊照片完整放，兩邊黑。
//    畫面往焦點慢慢推近（像電視節目的運鏡），臉最後停在字幕上面的空處。
//  - 字像電視的字幕：思源黑體、置中在螢幕下面（是訊號的一部分，跟著掃描線與玻璃的弧度一起變形）——
//    主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在最下面像卡拉 OK 跟唱；沒有主字時歌詞就是字幕。兩個都沒有就只有畫面。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { clamp, ease, hash, prog } from '../engine/util';
import { settleK } from './_photo';
import { PhotoPlate, P4_GLSL, aboveText, fitInScreen, photoLod, project, quadToUV, quadBounds, subtitleStyle, v4, m3, type Cam, type Quad } from './_p4';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'screen', energy: [0, 0.8], bars: [2, 8], weight: 1, prefers: ['landscape', 'square', 'small'] };

/** 螢幕在電視正面的位置（正面 uv）。 */
const SCR = { u0: 0.07, u1: 0.84, v0: 0.06, v1: 0.84 };
/** 字幕層：螢幕下面這一段（螢幕 uv 的 y 從 TXT_V0 到 1）：主字最多 4 行＋署名＋歌詞，要從螢幕快一半的地方開始留。 */
const TXT_V0 = 0.3;
/** 字幕最後一行的基線在螢幕的哪裡（uv 的 y；再下面是映像管的圓角）。 */
const TXT_BASE = 0.92;

const BG = () => new FSPass(/* glsl */ `
  ${P4_GLSL}
  uniform sampler2D photo; uniform sampler2D txt;
  uniform mat3 front; uniform mat3 side; uniform mat3 top; uniform mat3 cabTop; uniform vec4 doily;
  uniform float sideOn; uniform vec4 tvb; uniform vec2 tvSize;
  uniform vec4 prect; uniform vec4 crop; uniform float lod;
  uniform vec2 openXY; uniform float power; uniform float txtK; uniform float shadeV; uniform float led;
  uniform vec2 lamp; uniform vec2 lampBase; uniform float lampS; uniform float t; uniform float k;
  const vec4 S = vec4(${SCR.u0}, ${SCR.v0}, ${SCR.u1}, ${SCR.v1});
  vec3 wood(vec2 q, float dark) {
    float g = fbm(vec2(q.x * 3.0, q.y * 40.0), 3);
    float ring = sin(q.y * 90.0 + g * 6.0) * 0.5 + 0.5;
    return C_FUR * (0.11 + 0.05 * g + 0.03 * ring) * dark;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 avg = P4avg(photo);
    vec3 glowC = mix(avg, C_BONE * 0.7, 0.25) * power;
    // 牆：暗暖色，很淡的直條壁紙；左上檯燈的光、電視四周的光
    vec2 tc = (tvb.xy + tvb.zw) * 0.5;
    float stripe = 0.5 + 0.5 * sin(p.x / 9.0) * sin(p.x / 41.0);
    vec3 col = mix(C_INK, C_INK2, 0.6) * (0.7 + 0.08 * stripe + 0.1 * fbm(p / 300.0, 3));
    col += C_FUR * 0.05 * exp(-length(p - lamp) / 520.0) + mix(C_EMBER, C_FUR, 0.5) * 0.04 * exp(-length(p - lamp) / 180.0);
    vec2 dq = max(vec2(tvb.x - p.x, tvb.y - p.y), vec2(p.x - tvb.z, p.y - tvb.w));
    col += glowC * 0.07 * exp(-length(max(dq, 0.0)) / 220.0);
    // 矮櫃：上面（亮漆、反光）與正面（抽屜縫、把手）
    vec2 ct = P4quad(cabTop, p);
    if (ct.x >= 0.0 && ct.x <= 1.0 && ct.y >= 0.0 && ct.y <= 1.0) {
      vec3 c = wood(ct * vec2(1.0, 0.25), 0.62);
      // 上了漆的櫃面：電視的光反在上面（靠電視那邊亮），檯燈腳下一圈暖光
      float nearTv = exp(-abs(p.x - tc.x) / 380.0) * smoothstep(0.0, 0.6, 1.0 - ct.y);
      c += glowC * 0.06 * nearTv + C_FUR * 0.05 * exp(-length((p - lampBase) * vec2(1.0, 2.6)) / 160.0);
      // 蕾絲墊：電視下面一塊橢圓（世界座標），邊緣一圈波浪，中間細細的孔
      vec2 wxz = vec2(-1700.0 + ct.x * 3400.0, -620.0 + ct.y * 1140.0);
      vec2 dw = (wxz - doily.xy) / doily.zw;
      float ang = atan(dw.y, dw.x);
      float r = length(dw) - 0.04 * sin(ang * 26.0);
      if (r < 1.0) {
        float holes = smoothstep(0.35, 0.5, abs(sin(r * 40.0)) * abs(sin(ang * 20.0)));
        vec3 lace = C_BONE * (0.22 + 0.05 * holes) + glowC * 0.06;
        c = mix(c, lace, (1.0 - smoothstep(0.96, 1.0, r)) * (0.9 - 0.4 * holes));
      }
      col = c;
    }
    // 檯燈：燈罩從裡面亮（暖色，不發光）、細燈柱、圓底座
    {
      float sh = 230.0 * lampS;
      float yy = (p.y - lamp.y) / sh;
      float hwid = mix(85.0, 140.0, clamp(yy, 0.0, 1.0)) * lampS;
      float inShade = step(0.0, yy) * step(yy, 1.0) * (1.0 - smoothstep(hwid - 1.5, hwid + 1.5, abs(p.x - lamp.x)));
      float stem = step(lamp.y + sh, p.y) * step(p.y, lampBase.y) * (1.0 - smoothstep(4.0 * lampS, 6.0 * lampS, abs(p.x - lamp.x)));
      vec2 bq = (p - lampBase) / (vec2(70.0, 16.0) * lampS);
      float base = 1.0 - smoothstep(0.9, 1.1, length(bq));
      col = mix(col, C_FUR * 0.1 + C_EMBER * 0.03 * clamp(1.0 - bq.y, 0.0, 2.0) * base, max(stem, base));
      vec3 shade = mix(C_FUR, C_BONE, 0.5) * (0.42 + 0.22 * yy) * (0.92 + 0.08 * sin((p.x - lamp.x) / (6.0 * lampS)));
      col = mix(col, shade, inShade);
    }
    // 電視：頂板、側板（木紋），正面（深色塑膠、螢幕、喇叭、旋鈕）
    vec2 tq = P4quad(top, p);
    if (tq.x >= 0.0 && tq.x <= 1.0 && tq.y >= 0.0 && tq.y <= 1.0) {
      col = wood(tq * vec2(1.0, 0.5), 1.1) + C_FUR * 0.02 * exp(-length(p - lamp) / 600.0);
    }
    vec2 sq = P4quad(side, p);
    if (sideOn > 0.5 && sq.x >= 0.0 && sq.x <= 1.0 && sq.y >= 0.0 && sq.y <= 1.0) {
      col = wood(sq.yx, 0.75) * (0.85 + 0.15 * sq.x);
      // 側板上的散熱孔
      vec2 vq = vec2(fract(sq.x * 9.0), sq.y);
      col *= 1.0 - 0.5 * step(0.2, vq.x) * step(vq.x, 0.8) * step(0.12, sq.y) * step(sq.y, 0.2) * step(0.3, sq.x);
    }
    vec2 fq = P4quad(front, p);
    if (fq.x >= 0.0 && fq.x <= 1.0 && fq.y >= 0.0 && fq.y <= 1.0) {
      vec2 fpx = fq * tvSize;
      // 外框：木紋包邊，裡面一圈深色塑膠
      float edge = min(min(fpx.x, tvSize.x - fpx.x), min(fpx.y, tvSize.y - fpx.y));
      vec3 c = edge < 26.0 ? wood(fq * vec2(1.0, 0.6), 1.2) : C_INK2 * 0.9 * (0.9 + 0.1 * fq.y);
      c += C_FUR * 0.025 * exp(-length(p - lamp) / 700.0);
      // 喇叭：螢幕下面一排細槽
      if (fq.y > 0.88 && fq.y < 0.95 && fq.x > 0.1 && fq.x < 0.8) c *= 0.55 + 0.45 * step(0.5, fract(fpx.x / 7.0));
      // 右邊的旋鈕與電源燈
      for (int i = 0; i < 2; i++) {
        vec2 kc = vec2(0.92, 0.24 + 0.2 * float(i)) * tvSize;
        float kd = length(fpx - kc) - 26.0;
        c = mix(c, C_INK * 0.6 + C_BONE * 0.04 * smoothstep(26.0, 0.0, length(fpx - kc - vec2(-8.0, -10.0))), 1.0 - smoothstep(-1.0, 1.0, kd));
      }
      float ld = length(fpx - vec2(0.92, 0.78) * tvSize);
      c += C_COLLAR * led * (1.6 * exp(-ld * ld / 30.0) + 0.1 * exp(-ld / 20.0));
      // 螢幕
      vec2 s = (fq - S.xy) / (S.zw - S.xy);
      vec2 sc = s * 2.0 - 1.0;
      vec2 spx = (s - 0.5) * (S.zw - S.xy) * tvSize;
      vec2 hs = (S.zw - S.xy) * tvSize * 0.5;
      float rd = sdBox(spx, hs - 34.0) - 34.0;
      if (rd < 6.0) {
        // 螢幕外圈的凹槽（暗）
        c = mix(c, C_INK * 0.25, 1.0 - smoothstep(4.0, 6.0, rd));
      }
      if (rd < 0.0) {
        // 凸玻璃：桶形變形
        vec2 d = sc * (1.0 + 0.07 * dot(sc, sc));
        vec2 su = d * 0.5 + 0.5;
        vec3 img = vec3(0.0);
        float vis = step(abs(d.x), 1.0) * step(abs(d.y), 1.0);
        // 開機：亮點拉成橫線、再往上下展開
        float ox = openXY.x, oy = openXY.y;
        float lineK = step(abs(d.x), ox) * (1.0 - smoothstep(oy * 1.0 + 0.004, oy * 1.0 + 0.012, abs(d.y)));
        if (vis > 0.0 && lineK > 0.0) {
          vec4 ph = P4screenPhoto(photo, su, prect, crop, lod);
          img = ph.rgb * ph.a;
          // 字幕（訊號的一部分：跟著變形、掃描線）
          vec2 tq2 = vec2(su.x, (su.y - ${TXT_V0}) / ${(1 - TXT_V0).toFixed(3)});
          // 字幕後面很淡地壓暗（訊號裡的字，亮的畫面上也清楚）
          img *= 1.0 - txtK * 0.5 * smoothstep(shadeV - 0.08, shadeV + 0.14, su.y);
          if (txtK > 0.0 && tq2.y >= 0.0 && tq2.y <= 1.0) {
            vec4 tx = P4layer(txt, tq2) * txtK;
            img = img * (1.0 - tx.a) + tx.rgb * 0.9;
          }
          // 剛展開時整個畫面偏亮，展開完收回來
          img = mix(img, C_BONE * 0.8, (1.0 - oy) * (1.0 - oy) * 0.85);
          // 掃描線、慢慢往上爬的亮帶、四角暗
          float scan = 0.84 + 0.16 * (0.5 + 0.5 * cos(su.y * 3.14159 * 2.0 * 230.0));
          float hum = 1.0 + 0.04 * exp(-pow((fract(su.y + t * 0.06) - 0.5) * 7.0, 2.0));
          float vig = 1.0 - 0.35 * pow(dot(sc * 0.72, sc * 0.72), 1.6);
          img *= scan * hum * vig;
          img *= lineK;
        }
        // 玻璃：關著時是暗灰綠的映像管，開著時再加檯燈的反光與一點房間的倒影
        vec3 glass = C_INK2 * 0.35 * (1.0 - power * 0.5);
        float refl = exp(-dot(sc - vec2(-0.55, -0.6), sc - vec2(-0.55, -0.6)) / 0.06) * 0.05
                   + 0.012 * smoothstep(0.2, 1.4, length(sc - vec2(-0.6, -0.8)));
        c = glass + img * power + mix(C_FUR, C_BONE, 0.5) * refl;
        c *= 1.0 - smoothstep(-8.0, 0.0, rd) * 0.6;
      }
      col = c;
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null },
  front: { value: new THREE.Matrix3() }, side: { value: new THREE.Matrix3() }, top: { value: new THREE.Matrix3() },
  cabTop: { value: new THREE.Matrix3() }, doily: { value: new THREE.Vector4(-60, -300, 640, 420) }, sideOn: { value: 1 },
  tvb: { value: new THREE.Vector4() }, tvSize: { value: new THREE.Vector2(1, 1) },
  prect: { value: new THREE.Vector4(0, 0, 1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, lod: { value: 0 },
  openXY: { value: new THREE.Vector2() }, power: { value: 0 }, txtK: { value: 0 }, shadeV: { value: 0.7 }, led: { value: 0 },
  lamp: { value: new THREE.Vector2(160, 160) }, lampBase: { value: new THREE.Vector2() }, lampS: { value: 1 }, t: { value: 0 }, k: { value: 1 },
});

/** 電視（世界座標）：正面寬高、深度、正面中心、轉的角度（看得到右邊的側板）。 */
const TV = { w: 1000, h: 760, d: 640, x: -60, z: 0, yaw: -0.32 };
const F_ = 1500, CAM_Y = 430, CAM_D = 1600;
/** 字幕層的邏輯大小：螢幕在畫面上的寬（窗格中段，字在畫面上就是設定的字級）× 螢幕下面那一段。 */
const TL = { w: 700, h: Math.round(700 * 0.75 * (1 - TXT_V0)) };

export default class CrtTv extends PhotoPlate {
  bg = shared('crttv.bg', BG);
  sub = this.track(new Layer2D(TL.w, TL.h, undefined, { fast: true }));
  /** 字幕整塊的頂（字幕層座標）、在螢幕的哪裡（uv 的 y）；臉最後停在螢幕的哪裡。 */
  textTop = 0;
  textV = 1;
  at: [number, number] = [0.5, 0.5];
  tCap = 0;

  override async init() {
    await this.loadPhotos(1);
    const text = this.words(this.sub.ctx, subtitleStyle(TL.w * 0.92, 340, { lineHeight: 1.3, max: 46 }));
    const base = ((TXT_BASE - TXT_V0) / (1 - TXT_V0)) * TL.h;
    this.textTop = base - text.height + text.size * 0.1;
    this.textV = TXT_V0 + (this.textTop / TL.h) * (1 - TXT_V0);
    this.at = aboveText(this.textV, text.has);
    this.tCap = this.ctx.start + Math.min(0.9, (this.ctx.end - this.ctx.start) * 0.25);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const z0 = 1 - Math.exp(-lt / 7);
    // 鏡頭：慢慢推近、往一邊飄一點
    const cam: Cam = { x: 40 + dir * 50 * ease.inOutQuad(clamp(lt / 12)), y: CAM_Y, z: CAM_D - 90 * z0, yaw: 0, pitch: -0.05, f: F_ };
    // 電視的各個面（世界座標 → 畫面）
    const cy = Math.cos(TV.yaw), sy = Math.sin(TV.yaw);
    const P = (lx: number, ly: number, lz: number) => project(cam, [TV.x + lx * cy + lz * sy, ly, TV.z - lx * sy + lz * cy]);
    const hw = TV.w / 2, h = TV.h, d = TV.d;
    const front: Quad = [P(-hw, h, 0), P(hw, h, 0), P(hw, 0, 0), P(-hw, 0, 0)];
    const side: Quad = [P(hw, h, 0), P(hw, h, -d), P(hw, 0, -d), P(hw, 0, 0)];
    const top: Quad = [P(-hw, h, -d), P(hw, h, -d), P(hw, h, 0), P(-hw, h, 0)];
    // 矮櫃：跟牆平行（不轉），電視擺在上面（櫃子正面在畫面下緣外）
    const C = (x: number, y: number, z: number) => project(cam, [x, y, z]);
    const cabTop: Quad = [C(-1700, 0, -620), C(1700, 0, -620), C(1700, 0, 520), C(-1700, 0, 520)];
    const u = this.bg.u;
    m3(u.front!, quadToUV(front));
    m3(u.side!, quadToUV(side));
    m3(u.top!, quadToUV(top));
    m3(u.cabTop!, quadToUV(cabTop));
    const fb = quadBounds(front);
    v4(u.tvb!, [fb.x0, fb.y0, fb.x1 + (quadBounds(side).x1 - fb.x1), fb.y1]);
    (u.tvSize!.value as THREE.Vector2).set(TV.w, TV.h);
    // 螢幕上的照片（4:3）
    const scrPx = fb.w * (SCR.u1 - SCR.u0);
    // 畫面往焦點推（1.28 倍），臉最後停在字幕上面
    const fit = fitInScreen(this.img, this.photo, ((SCR.u1 - SCR.u0) * TV.w) / ((SCR.v1 - SCR.v0) * TV.h), scrPx, { k: settleK(lt), zoom: 1.28, at: this.at });
    v4(u.prect!, fit.rect);
    v4(u.crop!, fit.crop);
    u.lod!.value = photoLod(this.img.w * (fit.crop[2] - fit.crop[0]), scrPx * (fit.rect[2] - fit.rect[0]));
    u.photo!.value = this.tex;
    // 開機：亮點 → 橫線 → 往上下展開；最後零點三秒收暗一點
    (u.openXY!.value as THREE.Vector2).set(prog(t, s + 0.05, s + 0.2, ease.outCubic) * 1.02, prog(t, s + 0.2, s + 0.55, ease.outCubic) * 1.02);
    u.power!.value = (lt < 0.05 ? 0 : 1) * (1 - 0.12 * prog(t, e - 0.3, e));
    u.led!.value = lt < 0.05 ? 0 : 1;
    let txtK = 0;
    if (this.hasText) {
      const L = this.sub;
      if (this.text.draw(L.ctx, t, L.w / 2, this.textTop, { clear: () => L.clear() })) L.upload();
      txtK = prog(t, this.tCap, this.tCap + 0.3) * (1 - prog(t, e - 0.3, e));
    }
    u.txt!.value = this.sub.texture;
    u.txtK!.value = txtK;
    u.shadeV!.value = this.textV;
    // 檯燈擺在櫃子左邊（世界座標，跟著鏡頭投影）
    const lt0 = C(-930, 560, -430), lb = C(-930, 0, -430), lt1 = C(-830, 560, -430);
    (u.lamp!.value as THREE.Vector2).set(lt0[0], lt0[1]);
    (u.lampBase!.value as THREE.Vector2).set(lb[0], lb[1]);
    u.lampS!.value = (lt1[0] - lt0[0]) / 100;
    u.t!.value = t;
    u.k!.value = 1;
    this.bg.render(renderer, out);
    return { bloom: 0.25, bloomThreshold: 1.05, halation: 0.18, vignette: 0.5 };
  }
}
