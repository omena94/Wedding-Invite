// 照片版面「監看螢幕」（暗）：拍片現場的監看螢幕——
//  - 一台架在燈架上的監看螢幕（深灰外殼、四片遮光罩、下面的燈架桿），斜斜地對著鏡頭（有透視）；後面是暗的片場，
//    失焦的燈泡光斑、一盞柔光箱的大片柔光、淡淡的煙霧。鏡頭像手持一樣有一點點晃，慢慢推近。
//  - 切進來：先對焦在後面（螢幕糊的），再拉焦到螢幕上（變清楚）。
//  - 螢幕上是照片：橫的夠大的裁滿 16:9（畫上 2.39:1 的取景線、線外壓暗一點）；直的、小的完整放在中間（兩邊黑）。
//    畫面往焦點慢慢推近（像攝影師在調構圖），臉停在字幕上面。
//    介面只留一點點：四角的安全框、中心的小十字、上面一行「● REC」（紅點閃）與跑動的時間碼、左下兩條跟著音樂跳的音量條。
//  - 主字（賓客留言＋署名，或新人的註解）寫在螢幕下面貼著的白色紙膠帶上（一行一條、手寫的麥克筆字、膠帶有一點歪、撕過的毛邊），
//    署名自己一小條；有膠帶時監看螢幕往上讓一點。
//  - 歌詞是監看畫面上的字幕（跟著螢幕的透視、拉焦），一直在螢幕下方同一個位置跟唱；沒有主字時只有字幕。兩個都沒有就只有畫面。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { settleK, PhotoText } from './_photo';
import { PhotoPlate, P4_GLSL, aboveText, canCover, fitInScreen, photoLod, planeQuad, project, quadToUV, quadBounds, drawLayer, v4, m3, type Cam, type Quad } from './_p4';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'screen', energy: [0.2, 1], bars: [2, 8], weight: 1, prefers: ['landscape'] };

/** 監看螢幕（世界單位）：外殼半寬半高、螢幕在外殼正面的範圍（uv）、遮光罩伸出來多長。 */
const MON = { hw: 560, hh: 335, hood: 150 };
const SCR = { u0: 0.045, v0: 0.075, u1: 0.955, v1: 0.925 };
/** 螢幕上的介面層（螢幕自己的 px）。 */
const UI = { w: 1000, h: 563 };
const TC = { w: 520, h: 56 };
/**
 * 螢幕上的字幕層：螢幕下面這一段（螢幕 uv 的 y 從 TXT_V0 到 1），寬度跟螢幕在畫面上差不多；最後一行的基線在 TXT_BASE。
 * 韓文歌沒有主字時歌詞（折兩行）＋原文副行（也可能兩行）會很高，從螢幕上面三成就開始留。
 */
const TXT_V0 = 0.3, TXT_W = 680, TXT_H = Math.round((TXT_W * 9 / 16) * (1 - TXT_V0)), TXT_BASE = 0.85;

const BG = () => new FSPass(/* glsl */ `
  ${P4_GLSL}
  uniform sampler2D photo; uniform sampler2D ui; uniform sampler2D tc; uniform sampler2D txt; uniform float txtK; uniform float shadeV;
  uniform mat3 front; uniform mat3 hoodT; uniform mat3 hoodL; uniform mat3 hoodR;
  uniform vec4 prect; uniform vec4 crop; uniform float lod; uniform float cover;
  uniform float focus; uniform float on; uniform vec2 meter; uniform vec4 mb; uniform vec2 pole;
  uniform vec2 shake; uniform float t; uniform float k;
  const vec4 S = vec4(${SCR.u0}, ${SCR.v0}, ${SCR.u1}, ${SCR.v1});
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 avg = P4avg(photo);
    vec3 glowC = mix(avg, C_BONE * 0.7, 0.3) * on;
    // 片場：暗，柔光箱的大片柔光（右上）、失焦的燈泡光斑、淡淡的煙霧
    vec2 bp = p + shake * 0.4;
    vec3 col = C_INK * (0.45 + 0.12 * fbm(bp / 380.0 + vec2(t * 0.01, 0.0), 3));
    vec2 sbq = (bp - vec2(1640.0, 180.0)) / vec2(340.0, 260.0);
    col += mix(C_BONE, C_EMBER, 0.2) * 0.05 * exp(-pow(max(abs(sbq.x), abs(sbq.y)), 6.0)) + C_BONE * 0.02 * exp(-length(sbq) * 1.2);
    float bok = 1.0 + 0.6 * (1.0 - focus);
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      vec2 c = vec2(hash11(fi * 3.1) * 1920.0, 120.0 + hash11(fi * 7.7) * 520.0);
      float r = (30.0 + 50.0 * hash11(fi * 1.9)) * bok;
      float d = length(bp - c);
      vec3 bc = mix(C_EMBER, mix(C_SIGNAL, C_BONE, 0.5), hash11(fi * 5.3));
      col += bc * 0.05 * (1.0 - smoothstep(r - 2.0 * bok, r + 2.0 * bok, d)) * (0.75 + 0.25 * smoothstep(r * 0.3, r, d));
    }
    // 燈架桿（螢幕下面往下延伸）
    float pd = abs(p.x - pole.x) - 13.0;
    if (p.y > pole.y && pd < 1.0) col = mix(col, C_INK2 * 0.8 + glowC * 0.02 * step(0.0, -p.x + pole.x), 1.0 - smoothstep(-1.0, 1.0, pd));
    // 外殼正面
    vec2 fq = P4quad(front, p);
    float sharpW = mix(10.0, 0.9, focus);
    if (fq.x > -0.02 && fq.x < 1.02 && fq.y > -0.03 && fq.y < 1.03) {
      vec2 fpx = (fq - 0.5) * vec2(${MON.hw * 2}.0, ${MON.hh * 2}.0);
      float dh = sdBox(fpx, vec2(${MON.hw - 22}.0, ${MON.hh - 22}.0)) - 22.0;
      float ah = 1.0 - smoothstep(-sharpW, sharpW, dh);
      vec3 c = C_INK2 * (0.75 + 0.1 * fq.y) + glowC * 0.015;
      // 外殼邊緣一圈細亮邊（片場的燈）
      c += C_BONE * 0.05 * exp(-abs(dh + 3.0) / 1.5);
      vec2 s = (fq - S.xy) / (S.zw - S.xy);
      if (s.x >= 0.0 && s.x <= 1.0 && s.y >= 0.0 && s.y <= 1.0) {
        vec4 ph = P4screenPhoto(photo, s, prect, crop, lod + (1.0 - focus) * 3.0);
        vec3 img = ph.rgb * ph.a;
        // 取景線（2.39:1）外壓暗
        if (cover > 0.5) {
          float fy = (1.0 - (16.0 / 9.0) / 2.39) * 0.5;
          float outF = step(s.y, fy) + step(1.0 - fy, s.y);
          img *= 1.0 - 0.45 * outF;
          float ln = (1.0 - smoothstep(0.0, 0.0022, abs(s.y - fy))) + (1.0 - smoothstep(0.0, 0.0022, abs(s.y - 1.0 + fy)));
          img = mix(img, C_BONE * 0.6, ln * 0.7);
        }
        // 歌詞字幕：監看畫面上的字（字後面很淡地壓暗）
        img *= 1.0 - txtK * 0.45 * smoothstep(shadeV - 0.08, shadeV + 0.12, s.y);
        vec2 lq = vec2(s.x, (s.y - ${TXT_V0}) / ${(1 - TXT_V0).toFixed(3)});
        if (txtK > 0.0 && lq.y >= 0.0 && lq.y <= 1.0) {
          vec4 tx = P4layer(txt, lq) * txtK;
          img = img * (1.0 - tx.a) + tx.rgb * 0.9;
        }
        // 介面（靜的：安全框、十字；動的：REC 與時間碼）
        vec4 u1 = P4layer(ui, s);
        img = img * (1.0 - u1.a) + u1.rgb * 0.85;
        vec2 tq = (s - vec2(0.03, 0.025)) / vec2(${(TC.w / UI.w).toFixed(4)}, ${(TC.h / UI.h).toFixed(4)});
        if (tq.x >= 0.0 && tq.x <= 1.0 && tq.y >= 0.0 && tq.y <= 1.0) {
          vec4 u2 = P4layer(tc, tq);
          img = img * (1.0 - u2.a) + u2.rgb * 0.9;
        }
        // 音量條（左下）
        vec2 mq = s * vec2(${UI.w}.0, ${UI.h}.0);
        for (int i = 0; i < 2; i++) {
          float x0 = 40.0 + float(i) * 14.0;
          float lv = i == 0 ? meter.x : meter.y;
          float inB = step(x0, mq.x) * step(mq.x, x0 + 8.0) * step(${UI.h}.0 - 40.0 - 140.0 * lv, mq.y) * step(mq.y, ${UI.h}.0 - 40.0);
          float seg = step(0.35, fract(mq.y / 7.0));
          img = mix(img, mix(C_GRAPHITE, C_SIGNAL, step(mq.y, ${UI.h}.0 - 40.0 - 105.0)) * 0.9, inB * seg * 0.85);
        }
        // 螢幕玻璃：一點斜的反光、四周暗一點
        img += C_BONE * 0.025 * smoothstep(0.3, 0.0, abs(s.x * 0.7 + s.y - 0.5));
        img *= 0.92 + 0.08 * (1.0 - pow(abs(s.x - 0.5) * 2.0, 4.0));
        c = mix(C_INK * 0.15, img, on);
      }
      col = mix(col, c, ah);
    }
    // 遮光罩（上、左、右）：伸向鏡頭的黑色板子，內側被螢幕照亮
    vec2 hq = P4quad(hoodT, p);
    if (hq.x >= 0.0 && hq.x <= 1.0 && hq.y >= 0.0 && hq.y <= 1.0) col = C_INK2 * 0.55 + glowC * 0.07 * hq.y;
    vec2 lq = P4quad(hoodL, p);
    if (lq.x >= 0.0 && lq.x <= 1.0 && lq.y >= 0.0 && lq.y <= 1.0) col = C_INK2 * 0.5 + glowC * 0.06 * lq.x;
    vec2 rq = P4quad(hoodR, p);
    if (rq.x >= 0.0 && rq.x <= 1.0 && rq.y >= 0.0 && rq.y <= 1.0) col = C_INK2 * 0.45 + glowC * 0.05 * (1.0 - rq.x);
    // 螢幕的光打到前面的煙霧
    vec2 dq = max(vec2(mb.x - p.x, mb.y - p.y), vec2(p.x - mb.z, p.y - mb.w));
    col += glowC * 0.03 * exp(-length(max(dq, 0.0)) / 180.0);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, ui: { value: null }, tc: { value: null }, txt: { value: null }, txtK: { value: 0 }, shadeV: { value: 0.8 },
  front: { value: new THREE.Matrix3() }, hoodT: { value: new THREE.Matrix3() }, hoodL: { value: new THREE.Matrix3() }, hoodR: { value: new THREE.Matrix3() },
  prect: { value: new THREE.Vector4(0, 0, 1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, lod: { value: 0 }, cover: { value: 1 },
  focus: { value: 1 }, on: { value: 1 }, meter: { value: new THREE.Vector2() }, mb: { value: new THREE.Vector4() }, pole: { value: new THREE.Vector2() },
  shake: { value: new THREE.Vector2() }, t: { value: 0 }, k: { value: 1 },
});

/** 膠帶層：主字最多 4 行（一行一條）＋署名一小條。 */
const TAPE = { w: 900, h: 420 };

export default class Monitor extends PhotoPlate {
  bg = shared('monitor.bg', BG);
  ui = this.track(new Layer2D(UI.w, UI.h, undefined, { fast: true }));
  tc = this.track(new Layer2D(TC.w, TC.h, undefined, { fast: true }));
  tape = this.track(new Layer2D(TAPE.w, TAPE.h, undefined, { fast: true }));
  sub = this.track(new Layer2D(TXT_W, TXT_H, undefined, { fast: true }));
  /** 螢幕上的字幕（歌詞）：自己一份排版，顏色是螢幕的光（膠帶上的主字是黑色麥克筆）。 */
  lyr!: PhotoText;
  cover = true;
  tcSig = '';
  tCap = 0;
  /** 膠帶層裡字的總高（給位置用）。 */
  tapeH = 0;
  /** 字幕的頂（字幕層座標）、在螢幕的哪裡（uv 的 y）；臉最後停在螢幕的哪裡。 */
  lyrTop = 0;
  lyrV = 1;
  at: [number, number] = [0.5, 0.5];

  override async init() {
    await this.loadPhotos(1, '●REC TC:0123456789 4K24P');
    await loadText('● REC TC 0123456789:');
    const { start, end } = this.ctx;
    this.cover = canCover(this.img, 16 / 9, 2 * MON.hw * 0.91);
    this.drawUi();
    // 主字寫在膠帶上（一行一條，行距留膠帶之間的縫），歌詞是螢幕上的字幕（lyricsApart）
    const text = this.words(this.tape.ctx, {
      family: F.hand(700), w: TAPE.w - 160, h: TAPE.h - 40, min: 40, max: 48, lineHeight: 1.52, maxLines: 4, align: 'center',
      ink: rgba('ink', 0.9), sigInk: rgba('ink', 0.75), sigSize: 28, shadow: null, lyricsApart: true,
    });
    if (text.hasMain) this.drawTapes();
    this.lyr = new PhotoText(this.ctx, this.sub.ctx, {
      family: F.hei(500), w: TXT_W * 0.84, h: 120, align: 'center', tracking: 1, lyricsApart: true,
      ink: rgba('bone', 0.97), unsung: rgba('bone', 0.42), lyricSize: 46, lyricSubSize: 38, shadow: { color: rgba('ink', 0.85), blur: 8 },
    });
    const base = ((TXT_BASE - TXT_V0) / (1 - TXT_V0)) * TXT_H;
    this.lyrTop = base - this.lyr.lyricH + this.lyr.lyricSize * 0.1;
    this.lyrV = TXT_V0 + (this.lyrTop / TXT_H) * (1 - TXT_V0);
    this.at = aboveText(this.lyrV, text.sung);
    this.tCap = start + Math.min(1.1, (end - start) * 0.3);
  }

  /** 靜的介面：四角安全框、中心十字、右上的格式。 */
  private drawUi() {
    const L = this.ui, c = L.ctx;
    L.clear();
    c.strokeStyle = rgba('bone', 0.75);
    c.lineWidth = 2;
    const mx = UI.w * 0.09, my = UI.h * 0.17, len = 30;
    for (const [x, y, dx, dy] of [[mx, my, 1, 1], [UI.w - mx, my, -1, 1], [UI.w - mx, UI.h - my, -1, -1], [mx, UI.h - my, 1, -1]] as const) {
      c.beginPath(); c.moveTo(x, y + dy * len); c.lineTo(x, y); c.lineTo(x + dx * len, y); c.stroke();
    }
    c.beginPath();
    c.moveTo(UI.w / 2 - 14, UI.h / 2); c.lineTo(UI.w / 2 + 14, UI.h / 2);
    c.moveTo(UI.w / 2, UI.h / 2 - 14); c.lineTo(UI.w / 2, UI.h / 2 + 14);
    c.stroke();
    c.font = font(F.mono(500), 20);
    c.fillStyle = rgba('bone', 0.8);
    c.textAlign = 'right';
    c.fillText('4K  24P', UI.w - 30, 40);
    L.upload();
  }

  /** 動的介面：REC 紅點（一秒閃一次）與時間碼（24 格）。 */
  private drawTc(t: number) {
    const lt = Math.max(0, t - this.ctx.start);
    const f24 = Math.floor(lt * 24);
    const base = 3600 + Math.floor(hash(this.seed, 2) * 1800);
    const sec = base + Math.floor(f24 / 24);
    const pad = (n: number) => String(n).padStart(2, '0');
    const tc = `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}:${pad(f24 % 24)}`;
    const dot = Math.floor(lt * 1.6) % 2 === 0;
    const sig = `${tc}|${dot}`;
    if (sig === this.tcSig) return;
    this.tcSig = sig;
    const L = this.tc, c = L.ctx;
    L.clear();
    if (dot) { c.fillStyle = rgba('collar', 1); c.beginPath(); c.arc(12, TC.h / 2, 9, 0, Math.PI * 2); c.fill(); }
    c.font = font(F.mono(600), 20);
    c.fillStyle = rgba('bone', 0.88);
    c.textBaseline = 'middle';
    c.fillText('REC', 32, TC.h / 2 + 1);
    c.fillText(`TC ${tc}`, 120, TC.h / 2 + 1);
    L.upload();
  }

  /** 一條紙膠帶：撕過的毛邊、微微歪（畫在已經旋轉的座標裡）。 */
  private strip(c: CanvasRenderingContext2D, w: number, h: number, seed: number) {
    c.beginPath();
    const tooth = 6;
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    for (let y = 0; y <= h; y += tooth) c.lineTo(w + (hash(seed, y, 1) - 0.5) * 7, y);
    c.lineTo(w, h);
    c.lineTo(0, h);
    for (let y = h; y >= 0; y -= tooth) c.lineTo((hash(seed, y, 2) - 0.5) * 7, y);
    c.closePath();
    c.fillStyle = mixRgba('bone', 'paper', 0.4, 0.86);
    c.fill();
    // 膠帶的纖維紋路（很淡的橫線）
    c.save(); c.clip();
    c.fillStyle = rgba('sepia', 0.05);
    for (let y = 3; y < h; y += 5) c.fillRect(0, y, w, 1);
    c.restore();
  }

  /** 膠帶（不會變，畫一次）：主字一行一條膠帶（有一點歪），署名自己一小條；字是 PhotoText 寫的麥克筆字。 */
  private drawTapes() {
    const L = this.tape, c = L.ctx, text = this.text, fit = text.fit!;
    L.clear();
    const top = 14;
    c.save();
    c.shadowColor = rgba('ink', 0.5); c.shadowBlur = 8; c.shadowOffsetY = 3;
    const strip = (cx: number, cy: number, w: number, h: number, i: number) => {
      c.save();
      c.translate(cx, cy); c.rotate((hash(this.seed, i, 4) - 0.5) * 0.035); c.translate(-w / 2, -h / 2);
      this.strip(c, w, h, this.seed + i * 13);
      c.restore();
    };
    c.font = font(F.hand(700), fit.size);
    fit.lines.forEach((ln, i) => {
      const base = top + fit.size * 0.9 + i * fit.lineHeight;
      strip(L.w / 2, base - fit.size * 0.36, c.measureText(ln).width + 56, fit.size * 1.38, i);
    });
    if (text.words.sig) {
      c.font = font(F.hand(700), text.sigSize);
      const base = top + fit.height + text.sigH - text.sigSize * 0.12;
      strip(L.w / 2, base - text.sigSize * 0.36, c.measureText(text.words.sig).width + 40, text.sigSize * 1.5, fit.lines.length);
    }
    c.restore();
    text.drawMain(c, L.w / 2, top);
    this.tapeH = top + text.mainH + 24;
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    // 手持的晃動（幾個慢的正弦疊起來，確定性）
    const shx = 5 * Math.sin(t * 0.9 + 1.3) + 2.5 * Math.sin(t * 2.3 + 0.4);
    const shy = 4 * Math.sin(t * 1.1 + 2.1) + 2 * Math.sin(t * 2.9);
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const cam: Cam = { x: dir * 40 * ease.inOutQuad(clamp(lt / 12)), y: 40, z: 2300 - 120 * z0, yaw: 0, pitch: -0.02, f: 1500, cx: 960 + shx, cy: 540 + shy };
    const C = (x: number, y: number, z: number) => project(cam, [x, y, z]);
    const yaw = -0.2 * dir, cy0 = Math.cos(yaw), sy0 = Math.sin(yaw);
    // 有膠帶時監看螢幕往上讓一點（膠帶貼在螢幕下面，最多 4 行＋署名）
    const mx = -60, my = this.text.hasMain ? 230 : 130;
    const front = planeQuad(cam, [mx, my, 0], MON.hw, MON.hh, yaw, 0);
    // 遮光罩：從外殼正面的邊往鏡頭伸出去、稍微張開
    const P = (lx: number, ly: number, lz: number) => C(mx + lx * cy0 + lz * sy0, my + ly, -lx * sy0 + lz * cy0);
    const hw = MON.hw, hh = MON.hh, d = MON.hood, sp = 30;
    const hoodT: Quad = [P(-hw - sp, hh + sp, d), P(hw + sp, hh + sp, d), P(hw, hh, 0), P(-hw, hh, 0)];
    const hoodL: Quad = [P(-hw - sp, hh + sp, d), P(-hw, hh, 0), P(-hw, -hh, 0), P(-hw - sp, -hh - 10, d)];
    const hoodR: Quad = [P(hw, hh, 0), P(hw + sp, hh + sp, d), P(hw + sp, -hh - 10, d), P(hw, -hh, 0)];
    const u = this.bg.u;
    m3(u.front!, quadToUV(front));
    m3(u.hoodT!, quadToUV(hoodT));
    m3(u.hoodL!, quadToUV(hoodL));
    m3(u.hoodR!, quadToUV(hoodR));
    const b = quadBounds(front);
    v4(u.mb!, [b.x0, b.y0, b.x1, b.y1]);
    const pb = C(mx, my - hh, 0);
    (u.pole!.value as THREE.Vector2).set(pb[0], pb[1]);
    const scrPx = b.w * (SCR.u1 - SCR.u0);
    // 畫面往焦點推（1.28 倍），臉停在字幕上面
    const fit = fitInScreen(this.img, this.photo, 16 / 9, scrPx, { k: settleK(lt), zoom: 1.28, at: this.at }, { cover: this.cover });
    v4(u.prect!, fit.rect);
    v4(u.crop!, fit.crop);
    u.lod!.value = photoLod(this.img.w * (fit.crop[2] - fit.crop[0]), scrPx * (fit.rect[2] - fit.rect[0]));
    u.cover!.value = this.cover ? 1 : 0;
    u.photo!.value = this.tex;
    // 拉焦：先糊、0.15～0.8 秒對到螢幕上
    u.focus!.value = ease.inOutCubic(prog(t, s + 0.15, s + 0.8));
    u.on!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    // 音量條：跟著音樂
    (u.meter!.value as THREE.Vector2).set(clamp(f.a.rms * 1.2 + f.a.kick * 0.25), clamp(f.a.rms * 1.1 + f.a.snare * 0.25));
    (u.shake!.value as THREE.Vector2).set(shx, shy);
    this.drawTc(t);
    u.ui!.value = this.ui.texture;
    u.tc!.value = this.tc.texture;
    // 歌詞字幕：拉焦到螢幕上之後出現
    let txtK = 0;
    if (this.text.sung) {
      const L = this.sub;
      if (this.lyr.drawLyrics(L.ctx, t, TXT_W / 2, this.lyrTop, { clear: () => L.clear() })) L.upload();
      txtK = prog(t, s + 0.5, s + 0.9) * (1 - prog(t, e - 0.3, e));
    }
    u.txt!.value = this.sub.texture;
    u.txtK!.value = txtK;
    u.shadeV!.value = this.lyrV;
    u.t!.value = t;
    u.k!.value = 1;
    this.bg.render(renderer, out);
    if (this.text.hasMain) {
      const k = prog(t, this.tCap, this.tCap + 0.35, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      // 膠帶貼在螢幕下面：跟著螢幕下緣的中間走
      const bl = front[3], br = front[2];
      // 最寬的膠帶（字寬＋56）右緣不進右下角 HUD（x ≥ 1360）：鏡頭往右飄時中線最多到 940
      const ax = Math.min(940, (bl[0] + br[0]) / 2), ay = Math.max(bl[1], br[1]) + 22;
      const y = Math.min(ay, 960 - this.tapeH);
      if (k > 0) drawLayer(comp, renderer, this.tape, out, ax - this.tape.w / 2, y - 8 * (1 - k), { opacity: k });
    }
    return { bloom: 0.3, bloomThreshold: 1.05, halation: 0.15, vignette: 0.5 };
  }
}
