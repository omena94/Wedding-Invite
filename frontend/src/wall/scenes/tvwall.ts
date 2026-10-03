// 照片版面「電視牆」（暗，四張）：晚上隔著電器行的櫥窗，看一整面同時在播的電視——
//  - 層架上疊著五台大小、外殼不一樣的映像管電視（木紋、銀灰、黑），中間最大那台播主角（params.photo），旁邊幾台播另外三張，
//    有一台跟主角同一台（電器行常常好幾台同一個頻道）；小電視每兩小節在拍點換台（雪花閃一下再換一張）。
//  - 切進來時一台一台開機（亮點拉成線再展開）；畫面有掃描線、凸玻璃的四角暗，電視的光照到牆、層架與隔壁的電視。
//  - 櫥窗玻璃：街上的路燈在玻璃上的倒影（失焦的暖色光斑）、偶爾一道車燈慢慢掃過、淡淡的手印；鏡頭沿著櫥窗慢慢橫移，
//    玻璃上的東西跟後面的電視移得不一樣快（視差）。櫥窗下半是暗的牆腳。
//  - 照片：橫的夠大的裁滿 4:3，直的、小的完整放，兩邊黑。中間那台（主角）的畫面往焦點推得明顯，小電視只推一點點。
//  - 主字（賓客留言＋署名，或新人的註解）用白色的櫥窗漆一筆一筆手寫在玻璃左下（牆腳前面，暗底上讀得清楚），署名在寫完才出現。
//  - 歌詞像 KTV：中間那台電視的畫面下方有字幕跟唱（是訊號的一部分，跟著掃描線與玻璃的弧度），一直在同一個位置；
//    沒有主字時只有電視上的字幕。兩個都沒有就只有電視牆。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { barAfter } from './_motifs';
import { settleK, PhotoText } from './_photo';
import { PhotoPlate, P4_GLSL, aboveText, fitInScreen, photoLod, planeQuad, quadToUV, drawLayer, m3, v4, type Cam } from './_p4';

export const spec: PlateSpecDecl = { photo: true, photos: 4, family: 'photo', series: 'screen', energy: [0.3, 1], bars: [4, 8], weight: 1, prefers: ['landscape', 'square', 'small'] };

/** 電視（牆面座標 px，左上、寬高）：0 是中間最大那台（畫面下方要放得下 KTV 字幕）。牆面約 2000×1100，對到畫面大約一比一。 */
const TVS: [number, number, number, number][] = [
  [660, 170, 780, 600],
  [270, 160, 360, 280], [270, 500, 360, 280],
  [1470, 160, 360, 280], [1470, 500, 360, 280],
];
const N = TVS.length;
/** 層架的上緣（牆面 y）。 */
const SHELVES = [440, 780];
/** 牆腳（畫面 y）：櫥窗下半的暗牆。 */
const SILL = 790;
/** 中間那台的螢幕（牆面座標）：外殼的 7%～80%（跟 shader 一樣）。字幕層：螢幕下面這一段（螢幕 uv 的 y 從 TXT_V0 到 1），寬度跟螢幕在畫面上差不多。 */
const SCR0 = { w: TVS[0]![2] * 0.73, h: TVS[0]![3] * 0.73 };
const TXT_V0 = 0.5, TXT_W = Math.round(SCR0.w), TXT_H = Math.round(SCR0.h * (1 - TXT_V0)), TXT_BASE = 0.9;

const BG = () => new FSPass(/* glsl */ `
  ${P4_GLSL}
  uniform sampler2D ph0; uniform sampler2D ph1; uniform sampler2D ph2; uniform sampler2D ph3;
  uniform mat3 wall; uniform vec4 tv[${N}]; uniform vec4 pr[${N}]; uniform vec4 cr[${N}]; uniform vec4 st[${N}];
  uniform vec4 lods; uniform float sill; uniform vec2 par; uniform float car; uniform float t; uniform float frame; uniform float k;
  uniform sampler2D txt; uniform float txtK; uniform float shadeV; uniform vec4 glassR; uniform float glassK;
  vec3 photoK(int i, vec2 uv, float l) {
    vec3 c = vec3(0.0);
    if (i == 0) c = P4photo(ph0, uv, l);
    else if (i == 1) c = P4photo(ph1, uv, l);
    else if (i == 2) c = P4photo(ph2, uv, l);
    else c = P4photo(ph3, uv, l);
    return c;
  }
  vec3 avgK(int i) {
    vec3 c = vec3(0.0);
    if (i == 0) c = P4avg(ph0);
    else if (i == 1) c = P4avg(ph1);
    else if (i == 2) c = P4avg(ph2);
    else c = P4avg(ph3);
    return c;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 店裡的牆（牆面座標）
    vec2 wq = P4quad(wall, p) * vec2(2000.0, 1100.0);
    vec3 col = mix(C_INK, C_INK2, 0.5) * (0.42 + 0.08 * fbm(wq / 300.0, 2));
    // 電視的光照到牆上
    for (int i = 0; i < ${N}; i++) {
      vec4 r = tv[i];
      vec2 dq = max(r.xy - wq, wq - r.xy - r.zw);
      float d = length(max(dq, 0.0));
      int pi = int(st[i].x);
      col += mix(avgK(pi), C_BONE * 0.6, 0.3) * st[i].z * 0.035 * exp(-d / 110.0);
    }
    // 層架：一條深色的板子，上緣被電視照亮
    for (int j = 0; j < 2; j++) {
      float sy = j == 0 ? ${SHELVES[0]}.0 : ${SHELVES[1]}.0;
      if (wq.y > sy && wq.y < sy + 34.0) col = mix(C_FUR, C_INK2, 0.85) * (0.35 + 0.3 * smoothstep(sy + 6.0, sy, wq.y)) + C_BONE * 0.012;
    }
    // 電視
    for (int i = 0; i < ${N}; i++) {
      vec4 r = tv[i];
      vec2 c = r.xy + r.zw * 0.5;
      vec2 q = wq - c;
      float db = sdBox(q, r.zw * 0.5 - 18.0) - 18.0;
      if (db > 1.0) continue;
      int pi = int(st[i].x);
      float on = st[i].z;
      float shellT = hash11(float(i) * 3.7);
      vec2 u01 = (wq - r.xy) / r.zw;
      vec3 shell = shellT < 0.35 ? C_FUR * (0.07 + 0.02 * fbm(vec2(u01.x * 3.0, u01.y * 30.0), 2))
                 : shellT < 0.7 ? mix(C_GRAPHITE, C_ASH, 0.4) * 0.22 : C_INK2 * 0.8;
      shell *= 0.85 + 0.15 * (1.0 - u01.y);
      vec3 cc = shell;
      // 螢幕：4:3、圓角、凸玻璃
      vec2 sMin = r.xy + vec2(r.z * 0.07, r.w * 0.07), sMax = r.xy + vec2(r.z * 0.8, r.w * 0.8);
      vec2 sc = (wq - sMin) / (sMax - sMin);
      vec2 spx = (wq - (sMin + sMax) * 0.5);
      float ds = sdBox(spx, (sMax - sMin) * 0.5 - 22.0) - 22.0;
      if (ds < 0.0) {
        vec2 cq = sc * 2.0 - 1.0;
        vec2 dd = cq * (1.0 + 0.06 * dot(cq, cq));
        vec2 su = dd * 0.5 + 0.5;
        vec3 img = vec3(0.0);
        // 開機：亮點 → 橫線 → 展開（st.y 是開機的進度）
        float oy = st[i].y;
        float lineK = step(abs(dd.x), min(1.0, oy * 4.0)) * (1.0 - smoothstep(max(0.0, oy * 1.3 - 0.3) + 0.004, max(0.0, oy * 1.3 - 0.3) + 0.012, abs(dd.y)));
        if (lineK > 0.0 && abs(dd.x) <= 1.0 && abs(dd.y) <= 1.0) {
          vec2 pq = (su - pr[i].xy) / (pr[i].zw - pr[i].xy);
          if (pq.x >= 0.0 && pq.x <= 1.0 && pq.y >= 0.0 && pq.y <= 1.0) {
            vec2 uv = cr[i].xy + pq * (cr[i].zw - cr[i].xy);
            float l = i == 0 ? lods.x : lods.y;
            img = photoK(pi, uv, l);
          }
          // KTV 字幕（只有中間那台）：訊號的一部分，字後面很淡地壓暗
          if (i == 0 && txtK > 0.0) {
            img *= 1.0 - txtK * 0.45 * smoothstep(shadeV - 0.08, shadeV + 0.12, su.y);
            vec2 lq = vec2(su.x, (su.y - ${TXT_V0}) / ${(1 - TXT_V0).toFixed(3)});
            if (lq.y >= 0.0 && lq.y <= 1.0) {
              vec4 tx = P4layer(txt, lq) * txtK;
              img = img * (1.0 - tx.a) + tx.rgb * 0.9;
            }
          }
          img = mix(img, C_BONE * 0.8, clamp(1.0 - oy, 0.0, 1.0) * 0.8);
          // 換台的雪花
          float sn = hash12(floor(wq / 2.5) + frame * 1.7);
          img = mix(img, C_BONE * 0.6 * sn, st[i].w);
          // 掃描線：cos 的參數到上千時精度不穩（同一格畫兩次會差一階），先取 fract 再換回角度，樣子一樣
          float scan = 0.86 + 0.14 * (0.5 + 0.5 * cos(fract(su.y * (i == 0 ? 200.0 : 110.0)) * 6.28318));
          img *= scan * (1.0 - 0.3 * pow(dot(cq * 0.75, cq * 0.75), 1.6)) * lineK;
        }
        vec3 glass = C_INK2 * 0.3;
        cc = glass + img * on;
        cc += C_BONE * 0.018 * smoothstep(0.35, 0.0, length(cq - vec2(-0.5, -0.6)));
        cc = mix(cc, C_INK * 0.3, smoothstep(-5.0, 0.0, ds));
      }
      // 右邊的控制面板（小旋鈕）
      vec2 kn = vec2(r.x + r.z * 0.9, r.y + r.w * 0.3);
      cc = mix(cc, C_INK * 0.5, 1.0 - smoothstep(r.z * 0.03, r.z * 0.03 + 1.5, length(wq - kn)));
      cc += C_BONE * 0.04 * exp(-abs(db + 2.0) / 1.5);
      col = mix(col, cc, 1.0 - smoothstep(-1.0, 1.0, db));
    }
    // 牆腳：櫥窗下半的暗牆，上面一條窗框
    float sl = sill;
    if (p.y > sl) {
      col = C_INK * (0.32 + 0.05 * fbm(p / 120.0, 2));
      col += C_BONE * 0.03 * exp(-(p.y - sl) / 14.0);
    }
    float bar = 1.0 - smoothstep(6.0, 8.0, abs(p.y - sl));
    col = mix(col, mix(C_GRAPHITE, C_ASH, 0.3) * 0.25 + C_BONE * 0.06 * smoothstep(-6.0, -2.0, sl - p.y), bar);
    // 櫥窗的直框（玻璃的邊）
    float mx = abs(p.x - 56.0 + par.y * 0.6) - 9.0;
    col = mix(col, mix(C_GRAPHITE, C_ASH, 0.3) * 0.22 + C_BONE * 0.04 * exp(-abs(mx + 9.0) / 2.0), 1.0 - smoothstep(-1.0, 1.0, mx));
    // 櫥窗玻璃：街燈的倒影（失焦的暖光斑）、慢慢掃過的車燈、淡淡的手印
    vec2 gp = p + vec2(par.y, 0.0);
    vec3 refl = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 c = vec2(mod(fi * 517.0 + 140.0, 2400.0) - 240.0, 140.0 + 160.0 * hash11(fi * 2.3));
      float r = 60.0 + 40.0 * hash11(fi * 4.1);
      refl += mix(C_EMBER, C_SIGNAL, 0.5) * 0.035 * (1.0 - smoothstep(r - 4.0, r + 4.0, length(gp - c)));
    }
    refl += C_BONE * 0.05 * car * exp(-pow((gp.y - 610.0) / 40.0, 2.0)) * exp(-pow((gp.x - mix(-400.0, 2400.0, fract(t * 0.05 + 0.3))) / 520.0, 2.0));
    float smudge = smoothstep(0.55, 0.9, fbm(gp / 160.0 + 3.0, 3));
    refl += C_BONE * 0.012 * smudge;
    col += refl;
    // 玻璃上的字（櫥窗漆）後面很淡地壓暗：字的上半寫在電視前面，亮的畫面上也要讀得清楚
    vec2 gq = (p - glassR.xy) / glassR.zw;
    col *= 1.0 - glassK * 0.4 * exp(-dot(gq, gq) * 1.4);
    fragColor = vec4(col * k, 1.0);
  }`, {
  ph0: { value: null }, ph1: { value: null }, ph2: { value: null }, ph3: { value: null },
  wall: { value: new THREE.Matrix3() },
  tv: { value: TVS.map((r) => new THREE.Vector4(...r)) },
  pr: { value: TVS.map(() => new THREE.Vector4(0, 0, 1, 1)) }, cr: { value: TVS.map(() => new THREE.Vector4(0, 0, 1, 1)) },
  st: { value: TVS.map(() => new THREE.Vector4()) },
  txt: { value: null }, txtK: { value: 0 }, shadeV: { value: 0.8 }, glassR: { value: new THREE.Vector4(600, 860, 600, 200) }, glassK: { value: 0 },
  lods: { value: new THREE.Vector4() }, sill: { value: SILL }, par: { value: new THREE.Vector2() }, car: { value: 1 },
  t: { value: 0 }, frame: { value: 0 }, k: { value: 1 },
});

/** 玻璃上的字（左下，牆腳前面）：字層的寬高，最後一行的基線在畫面 y = BASE（x 不到 1360，碰不到右下角 HUD）。 */
const COL = { x: 130, w: 1160, h: 320 };
const BASE = 962;

export default class TvWall extends PhotoPlate {
  bg = shared('tvwall.bg', BG);
  glass = this.track(new Layer2D(COL.w, COL.h, undefined, { fast: true }));
  sub = this.track(new Layer2D(TXT_W, TXT_H, undefined, { fast: true }));
  /** 電視上的 KTV 字幕（歌詞）：自己一份排版，顏色是螢幕的光（玻璃上的主字是白漆）。 */
  lyr!: PhotoText;
  /** 小電視換台的時間（每兩小節的拍點）。 */
  switches: number[] = [];
  /** 玻璃上的字寫字的時間；字整塊的頂（字層座標）。 */
  tCap = 0; tCap1 = 0;
  textTop = 0;
  /** 字幕的頂（字幕層座標）、在螢幕的哪裡（uv 的 y）；主角的臉最後停在螢幕的哪裡。 */
  lyrTop = 0;
  lyrV = 1;
  at: [number, number] = [0.5, 0.5];

  override async init() {
    await this.loadPhotos(4);
    const { start, end, audio } = this.ctx;
    for (let b = barAfter(audio, start + 1.2); b < end - 0.6; b = barAfter(audio, b, 2)) {
      this.switches.push(b);
      if (b === barAfter(audio, b, 2)) break;
    }
    // 主字寫在玻璃上（白色櫥窗漆、手寫），歌詞是電視上的字幕（lyricsApart）
    const text = this.words(this.glass.ctx, {
      family: F.hand(700), w: COL.w - 40, h: COL.h - 40, min: 40, max: 52, lineHeight: 1.32, maxLines: 4, align: 'left',
      ink: rgba('bone', 0.93), sigInk: rgba('bone', 0.8), sigSize: 28, shadow: { color: rgba('ink', 0.6), blur: 6 }, lyricsApart: true,
    });
    // 字層的左上角在畫面 y = BASE - COL.h + 20：最後一行的基線（含署名）在字層的 COL.h - 20
    this.textTop = COL.h - 20 - text.mainH + text.size * 0.1;
    this.lyr = new PhotoText(this.ctx, this.sub.ctx, {
      family: F.hei(500), w: TXT_W * 0.9, h: 120, align: 'center', tracking: 1, lyricsApart: true,
      ink: rgba('bone', 0.97), unsung: rgba('bone', 0.42), lyricSize: 46, lyricSubSize: 38, shadow: { color: rgba('ink', 0.85), blur: 8 },
    });
    const base = ((TXT_BASE - TXT_V0) / (1 - TXT_V0)) * TXT_H;
    this.lyrTop = base - this.lyr.lyricH + this.lyr.lyricSize * 0.1;
    this.lyrV = TXT_V0 + (this.lyrTop / TXT_H) * (1 - TXT_V0);
    this.at = aboveText(this.lyrV, text.sung);
    // 一筆一筆寫上去：字多寫久一點（最多兩秒），短窗格寫快一點
    this.tCap = start + Math.min(1.0, (end - start) * 0.3);
    this.tCap1 = this.tCap + Math.min(2, 0.3 + 0.05 * text.chars, (end - start) * 0.3);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const span = Math.max(4, e - s);
    const dolly = dir * (ease.inOutQuad(clamp(lt / span)) - 0.5) * 2;
    const z0 = 1 - Math.exp(-lt / 7);
    // 牆面：一塊稍微斜的平面（鏡頭沿著櫥窗橫移、慢慢推近）
    const cam: Cam = { x: dolly * 70, y: 0, z: 2200 - 80 * z0, yaw: 0, pitch: 0, f: 1500 };
    // 沒有主字（玻璃上不寫字）時整面牆往下移、牆腳變矮，下面不留一大片空的暗牆
    const low = this.text.hasMain ? 0 : 110;
    const wq = planeQuad(cam, [-30, 70 - low, 0], 1000 * 2200 / 1500, 550 * 2200 / 1500, 0.1 * dir, 0);
    const u = this.bg.u;
    m3(u.wall!, quadToUV(wq));
    u.sill!.value = SILL + low * 1500 / 2200;
    const scale = (wq[1][0] - wq[0][0]) / 2000;
    // 每台電視播哪一張：0 號主角；1～4 號輪流播其他張（有一台跟主角同台），每兩小節換一次
    const nSw = this.switches.filter((b) => t >= b).length;
    const lastSw = this.switches.filter((b) => t >= b).pop() ?? -1;
    const base = [0, 1, 2, 3, 0];
    const st = u.st!.value as THREE.Vector4[];
    const pr = u.pr!.value as THREE.Vector4[];
    const cr = u.cr!.value as THREE.Vector4[];
    let lodSmall = 99;
    for (let i = 0; i < N; i++) {
      const r = TVS[i]!;
      const pi = i === 0 ? 0 : (base[i]! + nSw * (i % 2 ? 1 : 3)) % 4;
      const sh = this.shots[pi]!;
      // 開機：一台一台（中間那台先開）
      const t0 = s + 0.05 + (i === 0 ? 0 : 0.12 + i * 0.09);
      const oy = prog(t, t0, t0 + 0.45, ease.outCubic);
      // 換台：拍點後 0.15 秒雪花（主角那台不換）
      const snow = i > 0 && lastSw > 0 && t - lastSw < 0.16 ? 1 - (t - lastSw) / 0.16 : 0;
      st[i]!.set(pi, oy, t >= t0 ? 1 - 0.1 * prog(t, e - 0.3, e) : 0, snow);
      const scrW = r[2] * 0.73 * scale;
      // 往焦點推：中間那台（主角）推得明顯、臉停在字幕上面；小電視只推一點點
      const push = i === 0 ? { k: settleK(lt), zoom: 1.28, at: this.at } : { k: settleK(lt), zoom: 1.08 };
      const fit = fitInScreen(sh.img, sh.ref, (r[2] * 0.73) / (r[3] * 0.73), scrW, push);
      pr[i]!.set(...fit.rect);
      cr[i]!.set(...fit.crop);
      const lod = photoLod(sh.img.w * (fit.crop[2] - fit.crop[0]), scrW * (fit.rect[2] - fit.rect[0]));
      // 小電視共用一個 mip 層（取最清楚的那台）
      if (i === 0) (u.lods!.value as THREE.Vector4).x = lod;
      else lodSmall = Math.min(lodSmall, lod);
    }
    (u.lods!.value as THREE.Vector4).y = lodSmall;
    u.ph0!.value = this.shots[0]!.tex; u.ph1!.value = this.shots[1]!.tex; u.ph2!.value = this.shots[2]!.tex; u.ph3!.value = this.shots[3]!.tex;
    (u.par!.value as THREE.Vector2).set(dolly * 70, dolly * 160);
    u.car!.value = 1;
    u.t!.value = t;
    u.frame!.value = Math.floor(t * 30) % 1000;
    u.k!.value = 1;
    // KTV 字幕：中間那台開機之後出現
    let txtK = 0;
    if (this.text.sung) {
      const L = this.sub;
      if (this.lyr.drawLyrics(L.ctx, t, TXT_W / 2, this.lyrTop, { clear: () => L.clear() })) L.upload();
      txtK = prog(t, s + 0.4, s + 0.7) * (1 - prog(t, e - 0.3, e));
    }
    u.txt!.value = this.sub.texture;
    u.txtK!.value = txtK;
    u.shadeV!.value = this.lyrV;
    // 玻璃上的字：一筆一筆寫上去（署名在寫完才出現），跟玻璃一起移（比後面的電視移得多）
    const gx = COL.x - dolly * 160 * 0.15, gy = BASE - COL.h + 20;
    const gk = this.text.hasMain ? 1 - prog(t, e - 0.3, e) : 0;
    u.glassK!.value = gk * prog(t, this.tCap - 0.2, this.tCap + 0.3);
    v4(u.glassR!, [gx + Math.min(COL.w, this.text.width) * 0.45, gy + this.textTop + this.text.mainH * 0.5, Math.min(COL.w, this.text.width) * 0.75 + 80, this.text.mainH * 0.7 + 60]);
    this.bg.render(renderer, out);
    if (gk > 0 && t >= this.tCap) {
      const L = this.glass;
      const chars = Math.floor(prog(t, this.tCap, this.tCap1) * this.text.chars + 1e-6);
      if (this.text.drawMain(L.ctx, 0, this.textTop, { chars, clear: () => L.clear() })) L.upload();
      drawLayer(comp, renderer, L, out, gx, gy, { opacity: gk });
    }
    return { bloom: 0.3, bloomThreshold: 1.05, halation: 0.15, vignette: 0.45 };
  }
}
