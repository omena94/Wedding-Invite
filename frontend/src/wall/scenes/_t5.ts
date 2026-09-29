// 批次 T5（紙本 E ＋ 螢幕 A：notebook、stickynotes、chat、desktop、search、phone）共用的小工具。
// 這六個版面的手法各不相同，共用的只有「時間骨架」（第一拍、小節線、窗格裡有哪幾句歌詞）與幾個畫圖的小零件，
// 放在一起是為了讓六個版面的節拍感一致：東西都在拍點上彈出、在小節線上換狀態。
import * as THREE from 'three';
import type { AudioData } from '../engine/audio';
import { Lyrics, type Line } from '../engine/lyrics';
import { clamp, ease } from '../engine/util';
import { FSPass, W, H, SCALE, makeRT, clearRT } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { shared } from '../engine/scene';
import { beatAfter, barAfter } from './_motifs';
import { fitText, type FitResult } from '../engine/text';
import { V2, msgMaxFor, msgLen, fitClauses } from './_v2';

/** 窗格的節拍骨架。b0：第一拍；bar0：第一個小節線（太晚就用第二拍）；beat：拍長；bars：窗格裡的小節線。 */
export interface Grid { b0: number; bar0: number; beat: number; bar: number; bars: number[]; beats: number[] }

export function grid(au: AudioData, start: number, end: number): Grid {
  const b0 = beatAfter(au, start + 0.05);
  const beat = Math.max(0.25, au.beatPeriod(b0));
  let bar0 = barAfter(au, start + 0.05);
  // 第一個小節線要等太久（剛好切在小節中間）就用第二拍，事情才不會拖到第二小節
  if (bar0 - b0 > beat * 2.5) bar0 = b0 + beat;
  const bars: number[] = [], beats: number[] = [];
  for (let i = Math.ceil(au.barAt(start) - 1e-6), k = 0; k < 64; i++, k++) { const x = au.timeOfBar(i); if (x >= end) break; if (x >= start) bars.push(x); }
  for (let i = Math.ceil(au.beatAt(start) - 1e-6), k = 0; k < 256; i++, k++) { const x = au.timeOfBeat(i); if (x >= end) break; if (x >= start) beats.push(x); }
  const bar = bars.length > 1 ? bars[1]! - bars[0]! : beat * 4;
  return { b0, bar0, beat, bar, bars, beats };
}

/** t 之前（含）最近的一個時間點（例如最近的拍點），都還沒到就回傳 -Infinity。 */
export function lastOf(ts: number[], t: number): number {
  let r = -Infinity;
  for (const x of ts) { if (x <= t) r = x; else break; }
  return r;
}

/** 彈出：t0 開始、dur 秒內用 outBack 從 0 到 1（中間會稍微超過 1）。 */
export const pop = (t: number, t0: number, dur = 0.32, s = 1.9) => (t <= t0 ? 0 : t >= t0 + dur ? 1 : ease.outBack((t - t0) / dur, s));

/** 窗格裡會出現的歌詞行（start 前 lead 秒到 end 後 hold 秒有重疊的），依時間排。 */
export function windowLines(ly: Lyrics, start: number, end: number, lead = 0.35, hold = 1.2): Line[] {
  return ly.lines.filter((l) => l.start - lead < end && l.end + hold > start);
}

/** 一行歌詞在 t 時唱到第幾個字元（UTF-16，給打字機／逐字出現用）與正在唱的字。 */
export function lineState(line: Line, t: number): { chars: number; active: { o: number; len: number } | null } {
  let active: { o: number; len: number } | null = null;
  for (const w of line.words) {
    const p = Lyrics.wordProgress(w, t);
    if (p > 0 && p < 1) { active = { o: w.o, len: w.w.length }; break; }
  }
  return { chars: Lyrics.lineCharProgress(line, t), active };
}

/** 圓角矩形的路徑（不填不描，呼叫的人決定）。 */
export function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

/** 圓角矩形的外框點（從左上角圓弧結束處順時針一圈），給火花沿框跑用。 */
export function rrectPts(x: number, y: number, w: number, h: number, r: number, seg = 6): { x: number; y: number }[] {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const out: { x: number; y: number }[] = [];
  const corners: [number, number, number][] = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  out.push({ x: x + r, y });
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  out.push({ x: x + r, y });
  return out;
}

/** 沿著折線畫到 u（0..1），回傳筆尖的位置；u 在 0 或 1 回傳 null（不用畫火花）。用目前的 strokeStyle。 */
export function tracePolyline(c: CanvasRenderingContext2D, pts: { x: number; y: number }[], u: number): { x: number; y: number } | null {
  if (u <= 0) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  const len = total * Math.min(1, u);
  let acc = 0, head = pts[0]!;
  c.beginPath(); c.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, sl = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + sl <= len) { c.lineTo(b.x, b.y); acc += sl; head = b; continue; }
    const k = sl > 0 ? (len - acc) / sl : 0;
    head = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    c.lineTo(head.x, head.y);
    break;
  }
  c.stroke();
  return u >= 1 ? null : head;
}

export const pad = (n: number, k = 3) => String(Math.max(0, Math.floor(n))).padStart(k, '0');
/** 秒 → 「m:ss」。 */
export const mss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${pad(Math.max(0, s) % 60, 2)}`;

/** 名字的第一個字（大頭貼用）；沒填名字用愛心。英文名取第一個字母大寫。 */
export function initial(name: string): string {
  const s = name.trim();
  if (!s) return '♥';
  const ch = Array.from(s)[0]!;
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
}

/** 彈簧到位的量（0 → 1，略為超過再回來），給捲動、推擠用；t0 之前是 0。 */
export function settle(t: number, t0: number, freq = 2.6, damping = 0.62) {
  if (t <= t0) return 0;
  const w = Math.PI * 2 * freq, x = t - t0;
  return clamp(1 - Math.exp(-damping * w * x) * Math.cos(w * Math.sqrt(1 - damping * damping) * x), -0.2, 1.2);
}

// ================================================================ 空間：把螢幕、紙放進有景深的場景裡
// MV 融合原則：螢幕類版面要「螢幕在空間裡」（透視、反光、景深），紙類版面要像擺在桌上被鏡頭拍。
// 這裡是四個螢幕版面與兩個紙版面共用的東西：三維舞台（多重取樣＋深度貼圖）→ 景深 pass；機身、桌面、螢幕的材質；
// 還有「把一張 2D 畫面當成桌上的紙斜著拍」的 tilt pass。整晚共用（shared），同一時間只會有一個 T5 版面在畫。

// 顏色用 2 倍超取樣（景深 pass 在像素中心雙線性取樣＝剛好 2×2 平均，邊緣乾淨）；景深要的深度另外畫一張半解析度的深度圖。
// 不用多重取樣（MSAA）：它在 D3D 上每次解出來的值末位會不一樣，同一格畫兩次不會完全相同（確定性檢查不過）。
const STAGE_RT = () => makeRT(W, H, { pxScale: SCALE * 2 });
// 深度寫成顏色（線性的相機距離）：直接讀硬體深度貼圖在這張顯卡上每次末位會不一樣（實測），寫成半浮點顏色就穩定
const DEPTH_RT = () => makeRT(W / 2, H / 2);
const DEPTH_MAT = () => new THREE.ShaderMaterial({
  vertexShader: 'varying float vZ; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'varying float vZ; void main() { gl_FragColor = vec4(vZ, 0.0, 0.0, 1.0); }',
});

// 景深：用深度算每個像素的模糊半徑（焦內 = 0），24 點向日葵取樣；樣本自己夠糊才算進來，焦內的東西不會糊進背景。
const DOF = () => new FSPass(/* glsl */ `
  uniform sampler2D src; uniform sampler2D depthTex; uniform float near; uniform float far;
  uniform float focus; uniform float range; uniform float maxR; uniform float falloff;
  float linZ(vec2 uv) { return textureLod(depthTex, uv, 0.0).r; }
  float coc(float z) { return clamp((abs(z - focus) - range) / (focus * falloff), 0.0, 1.0) * maxR; }
  void main() {
    vec3 col = textureLod(src, vUv, 0.0).rgb;
    float c = coc(linZ(vUv));
    if (c < 0.6) { fragColor = vec4(col, 1.0); return; }
    vec3 acc = col; float ws = 1.0;
    for (int i = 0; i < 24; i++) {
      float r = sqrt((float(i) + 0.5) / 24.0);
      float a = float(i) * 2.39996323;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * c / vec2(${W}.0, ${H}.0);
      float w = smoothstep(r * c - 1.5, r * c + 1.5, coc(linZ(uv)) + 0.75);
      acc += textureLod(src, uv, 0.0).rgb * w; ws += w;
    }
    fragColor = vec4(acc / ws, 1.0);
  }`, { src: { value: null }, depthTex: { value: null }, near: { value: 1 }, far: { value: 100 }, focus: { value: 20 }, range: { value: 2 }, maxR: { value: 12 }, falloff: { value: 0.5 } });

export interface DofOpts { focus: number; range: number; maxR: number; falloff?: number }

/** 畫一個三維場景（先清成 bg 色）再經過景深，輸出到 out。 */
export function renderStage(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, out: THREE.WebGLRenderTarget, bg: readonly number[], dof: DofOpts, extra?: (rt: THREE.WebGLRenderTarget) => void) {
  const rt = shared('t5.stage.rt', STAGE_RT);
  clearRT(renderer, rt, [bg[0]!, bg[1]!, bg[2]!]);
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  // 場景之後、景深之前的額外東西（煙、灰塵、火焰的 LineBatch）：一起被景深糊
  extra?.(rt);
  // 深度：同一個場景用只寫深度的材質再畫一次（半解析度、不取樣）
  const drt = shared('t5.stage.depth', DEPTH_RT);
  clearRT(renderer, drt, [0, 0, 0]);
  const prevOverride = scene.overrideMaterial;
  scene.overrideMaterial = shared('t5.stage.depthMat', DEPTH_MAT);
  renderer.setRenderTarget(drt);
  renderer.render(scene, cam);
  scene.overrideMaterial = prevOverride;
  const p = shared('t5.stage.dof', DOF);
  p.u.src!.value = rt.texture; p.u.depthTex!.value = drt.texture;
  p.u.near!.value = cam.near; p.u.far!.value = cam.far;
  p.u.focus!.value = dof.focus; p.u.range!.value = dof.range; p.u.maxR!.value = dof.maxR; p.u.falloff!.value = dof.falloff ?? 0.5;
  p.render(renderer, out);
}

const WORLD_VS = /* glsl */ `
  varying vec3 vW; varying vec3 vN; varying vec2 vUv;
  void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; gl_Position = projectionMatrix * viewMatrix * wp; }`;

/** 機身：簡單的打光（主光＋補光＋邊緣光＋一點高光），顏色每格從色票設。 */
export function bodyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: WORLD_VS,
    fragmentShader: /* glsl */ `
      uniform vec3 base; uniform vec3 keyDir; uniform vec3 keyCol; uniform vec3 fill; uniform float shine; uniform float rough;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main() {
        vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW); vec3 l = normalize(keyDir);
        float lam = max(dot(n, l), 0.0);
        float sp = pow(max(dot(n, normalize(l + v)), 0.0), rough) * shine;
        float fr = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        gl_FragColor = vec4(base * (fill + keyCol * lam) + keyCol * sp + keyCol * fr * 0.2, 1.0);
      }`,
    uniforms: { base: { value: new THREE.Vector3() }, keyDir: { value: new THREE.Vector3(-0.5, 0.8, 0.6) }, keyCol: { value: new THREE.Vector3(1, 1, 1) }, fill: { value: new THREE.Vector3(0.1, 0.1, 0.1) }, shine: { value: 0.3 }, rough: { value: 40 } },
  });
}

/**
 * 螢幕：取 fast 的 Canvas（預乘、sRGB）自己解碼，當成自發光；玻璃有菲涅耳反光與一條柔和的窗光反射（跟著鏡頭角度動）。
 * crt > 0：映像管（桶狀變形、掃描線）；on：亮度（開機、休眠）。
 */
export function screenMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: WORLD_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D ui; uniform float on; uniform vec3 sheen; uniform float crt; uniform vec2 res; uniform vec3 refl; uniform float wob; uniform float wobT;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      ${GLSL_COMMON}
      void main() {
        vec2 uv = vUv;
        vec2 c0 = uv - 0.5;
        if (crt > 0.0) uv = 0.5 + c0 * (1.0 + crt * dot(c0, c0)) * (1.0 - crt * 0.18);
        // 映像管的消磁晃動（wob > 0）：畫面橫向扭一下、顏色偏一點，很快停下來
        if (wob > 0.0) uv.x += wob * 0.012 * sin(uv.y * 38.0 + wobT * 70.0);
        vec3 c = vec3(0.0);
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
          vec4 tx = texture2D(ui, uv);
          c = tx.a > 0.0 ? toLinear(tx.rgb / tx.a) : vec3(0.0);
          if (crt > 0.0) c *= 0.74 + 0.26 * smoothstep(0.1, 0.6, abs(fract(uv.y * res.y / 2.0) - 0.5) * 2.0);
        }
        if (wob > 0.0) c *= vec3(1.0 + wob * 0.25, 1.0 - wob * 0.12, 1.0 + wob * 0.18);
        vec2 e = abs(c0) * 2.0;
        c *= on * (1.0 - 0.14 * pow(max(e.x, e.y), 5.0));
        // 玻璃：菲涅耳＋一條窗光的反射（方向 refl），螢幕關著的時候也看得到
        vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
        float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 r = reflect(-v, n);
        float band = smoothstep(0.2, 0.0, abs(dot(r, normalize(refl)) - 0.62));
        c += sheen * (0.35 * fr + band * (0.25 + 0.75 * fr));
        gl_FragColor = vec4(c, 1.0);
      }`,
    uniforms: { ui: { value: null }, on: { value: 1 }, sheen: { value: new THREE.Vector3(0.02, 0.02, 0.02) }, crt: { value: 0 }, res: { value: new THREE.Vector2(1000, 1000) }, refl: { value: new THREE.Vector3(-0.5, 0.7, 0.4) }, wob: { value: 0 }, wobT: { value: 0 }, ...THEME_UNIFORMS },
  });
}

/**
 * 桌面（xz 平面）：兩個色之間的木紋、螢幕灑在桌上的光（glowPos 附近）、一盞燈的光、機身下的接觸陰影（旋轉的矩形）。
 * 遠處（-z）慢慢融進 fade 色（房間的深處）。
 */
export function tableMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: WORLD_VS,
    fragmentShader: /* glsl */ `
      uniform vec3 base; uniform vec3 base2; uniform float grainK; uniform vec3 glowCol; uniform vec3 glowPos; uniform float glowR;
      uniform vec4 shadow; uniform float shadowRot; uniform float shadowK; uniform vec3 fade; uniform float fadeZ; uniform float weave;
      uniform vec3 lampCol; uniform vec3 lampPos; uniform float lampR;
      uniform float goboK; uniform float goboT; uniform float goboS; uniform vec2 goboDir;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      ${GLSL_COMMON}
      void main() {
        vec2 p = vW.xz;
        float g = fbm(vec2(p.x / 60.0, p.y / 2.2), 3) * 0.65 + fbm(p / 14.0, 2) * 0.35;
        // 布（weave > 0）：經緯很細的織紋＋大塊柔和的皺褶明暗，取代木紋
        if (weave > 0.0) {
          float th = 0.5 + 0.25 * sin(p.x * 22.0) + 0.25 * sin(p.y * 22.0 + sin(p.x * 1.3));
          float fold = fbm(p / 18.0, 3);
          g = mix(g, (th - 0.5) * 0.35 + fold * 0.9, weave);
        }
        vec3 col = mix(base, base2, clamp(0.5 + g * grainK, 0.0, 1.0));
        float d = length(p - glowPos.xz);
        col += glowCol * exp(-d * d / (glowR * glowR));
        float dl = length(p - lampPos.xz);
        col += lampCol * exp(-dl * dl / (lampR * lampR));
        vec2 q = p - shadow.xy;
        float cs = cos(shadowRot), sn = sin(shadowRot);
        q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
        vec2 b = abs(q) - shadow.zw;
        float sd = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0);
        col *= 1.0 - shadowK * (0.8 * exp(-max(sd, 0.0) / 1.2) + 0.2 * exp(-max(sd, 0.0) / 6.0));
        // 窗外的樹影（斑駁的光）：兩層雜訊，一層跟風慢慢漂、一層細的抖動；goboK = 0 就沒有
        if (goboK > 0.0) {
          vec2 q2 = p / goboS + goboDir * goboT;
          float leaf = smoothstep(0.05, 0.4, fbm(q2, 3) + 0.25 * snoise(q2 * 3.1 + vec2(goboT * 0.7, 0.0)));
          col *= 1.0 - goboK * leaf;
        }
        col = mix(col, fade, smoothstep(0.0, 1.0, (-vW.z - fadeZ) / 60.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
    uniforms: {
      base: { value: new THREE.Vector3() }, base2: { value: new THREE.Vector3() }, grainK: { value: 0.6 }, glowCol: { value: new THREE.Vector3() }, glowPos: { value: new THREE.Vector3() }, glowR: { value: 12 },
      shadow: { value: new THREE.Vector4() }, shadowRot: { value: 0 }, shadowK: { value: 0.6 }, fade: { value: new THREE.Vector3() }, fadeZ: { value: 40 },
      lampCol: { value: new THREE.Vector3() }, lampPos: { value: new THREE.Vector3() }, lampR: { value: 30 },
      goboK: { value: 0 }, goboT: { value: 0 }, goboS: { value: 30 }, goboDir: { value: new THREE.Vector2(0.06, 0.02) }, weave: { value: 0 }, ...THEME_UNIFORMS,
    },
  });
}

/** 背景的牆（面向鏡頭的大平面）：上下漸層、一團柔和的光（窗或燈），很淡的紋理。 */
export function backdropMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: WORLD_VS,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 lightCol; uniform vec2 lightPos; uniform float lightR; uniform float y0; uniform float y1;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      ${GLSL_COMMON}
      void main() {
        vec3 col = mix(bottom, top, smoothstep(y0, y1, vW.y));
        vec2 d = vW.xy - lightPos;
        col += lightCol * exp(-dot(d, d) / (lightR * lightR));
        col *= 0.97 + 0.03 * fbm(vW.xy / 25.0, 2);
        gl_FragColor = vec4(col, 1.0);
      }`,
    uniforms: { top: { value: new THREE.Vector3() }, bottom: { value: new THREE.Vector3() }, lightCol: { value: new THREE.Vector3() }, lightPos: { value: new THREE.Vector2() }, lightR: { value: 40 }, y0: { value: -20 }, y1: { value: 80 }, ...THEME_UNIFORMS },
  });
}

/** 圓角的扁盒子（手機、筆電、螢幕的機身）：正面在 z = 0，往 -z 長 depth。 */
export function slab(w: number, h: number, depth: number, r: number, bevel = 0.12, seg = 10): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x0 = -w / 2 + bevel, y0 = -h / 2 + bevel, x1 = w / 2 - bevel, y1 = h / 2 - bevel, rr = Math.max(0.01, r - bevel);
  s.moveTo(x0 + rr, y0); s.lineTo(x1 - rr, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rr); s.lineTo(x1, y1 - rr); s.quadraticCurveTo(x1, y1, x1 - rr, y1);
  s.lineTo(x0 + rr, y1); s.quadraticCurveTo(x0, y1, x0, y1 - rr); s.lineTo(x0, y0 + rr); s.quadraticCurveTo(x0, y0, x0 + rr, y0);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, depth - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: seg });
  g.translate(0, 0, -(depth - bevel));
  g.computeVertexNormals();
  return g;
}

/** 設 vec3 uniform（linear 色乘上 k）。 */
export const setV3 = (u: THREE.IUniform, c: readonly number[], k = 1) => (u.value as THREE.Vector3).set(c[0]! * k, c[1]! * k, c[2]! * k);
/** 兩個 linear 色混合。 */
export const mixV = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [a[0]! + (b[0]! - a[0]!) * k, a[1]! + (b[1]! - a[1]!) * k, a[2]! + (b[2]! - a[2]!) * k];

/** 世界座標投影成螢幕像素（檢查字的位置用）。 */
export function toScreen(cam: THREE.Camera, p: THREE.Vector3): { x: number; y: number } {
  const v = p.clone().project(cam);
  return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
}

// ---------------------------------------------------------------- 把一張 2D 畫面當成桌上的紙斜著拍
/**
 * tilt：src 是一張 1920×1080（邏輯）的 2D 畫面，當成一張平放的紙（1 單位 = 1 px，中心在原點，z = 0），
 * 虛擬鏡頭在 cam、看向 look（同一套座標，y 向上＝紙的上方）；每個像素算射線打到紙上哪一點去取樣，
 * 依距離做景深模糊（解析式，不用深度貼圖）。紙以外的地方用 edge 色（桌子）。燈 light（螢幕像素）附近亮一點。
 */
export const TILT = () => new FSPass(/* glsl */ `
  uniform sampler2D src; uniform vec3 cam; uniform vec3 look; uniform float fov; uniform float roll;
  uniform float focus; uniform float range; uniform float maxR; uniform vec3 edge; uniform vec2 light; uniform float lightK;
  vec3 samplePage(vec2 q) {
    if (q.x < 0.0 || q.x > ${W}.0 || q.y < 0.0 || q.y > ${H}.0) return edge;
    return textureLod(src, vec2(q.x / ${W}.0, 1.0 - q.y / ${H}.0), 0.0).rgb;
  }
  void main() {
    vec3 F = normalize(look - cam);
    vec3 R0 = normalize(cross(F, vec3(0.0, 1.0, 0.0)));
    vec3 U0 = cross(R0, F);
    float cr = cos(roll), sr = sin(roll);
    vec3 R = cr * R0 + sr * U0, U = -sr * R0 + cr * U0;
    float th = tan(fov * 0.5);
    vec2 frag = vec2(FRAG_PX.x, FRAG_PX.y);
    vec2 ndc = frag / vec2(${W}.0, ${H}.0) * 2.0 - 1.0;
    vec3 d = normalize(F + ndc.x * th * ${(W / H).toFixed(6)} * R + ndc.y * th * U);
    float t = -cam.z / d.z;
    vec3 P = cam + t * d;
    vec2 q = vec2(P.x + ${W / 2}.0, ${H / 2}.0 - P.y);
    // 景深：跟對焦距離差多少就糊多少（在紙面上取樣，半徑換算成紙面的長度）
    float c = clamp((abs(t - focus) - range) / (focus * 0.35), 0.0, 1.0) * maxR;
    vec3 col = samplePage(q);
    if (c > 0.6) {
      float px = t * th / ${H / 2}.0;
      vec3 acc = col;
      for (int i = 0; i < 16; i++) {
        float r = sqrt((float(i) + 0.5) / 16.0);
        float a = float(i) * 2.39996323;
        acc += samplePage(q + vec2(cos(a), sin(a)) * r * c * px);
      }
      col = acc / 17.0;
    }
    // 一盞燈：light（螢幕像素，y 向下）附近亮一點、遠處暗一點
    vec2 fl = vec2(frag.x, ${H}.0 - frag.y);
    float lk = exp(-dot(fl - light, fl - light) / (1100.0 * 1100.0));
    col *= mix(1.0, 0.84 + 0.2 * lk, lightK);
    fragColor = vec4(col, 1.0);
  }`, {
  src: { value: null }, cam: { value: new THREE.Vector3(0, -300, 1200) }, look: { value: new THREE.Vector3() }, fov: { value: 0.8 }, roll: { value: 0 },
  focus: { value: 1200 }, range: { value: 60 }, maxR: { value: 6 }, edge: { value: new THREE.Vector3() }, light: { value: new THREE.Vector2(700, 400) }, lightK: { value: 1 },
});

/** tilt 用的中間畫面（整晚共用）。 */
export const tiltRT = () => shared('t5.tilt.rt', () => makeRT(W, H, { depthBuffer: false }));
/** tilt pass（整晚共用）。 */
export const tiltPass = () => shared('t5.tilt.pass', TILT);

/**
 * tilt 的正向投影（CPU）：紙上一點（2D 像素）→ 螢幕像素，給檢查字的位置、火花跟著紙走用。
 * 參數跟 TILT 的 uniform 一樣。
 */
export function tiltProject(cam: THREE.Vector3, look: THREE.Vector3, fov: number, roll: number, x: number, y: number): { x: number; y: number } {
  const P = new THREE.Vector3(x - W / 2, H / 2 - y, 0);
  const F = look.clone().sub(cam).normalize();
  const R0 = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
  const U0 = new THREE.Vector3().crossVectors(R0, F);
  const R = R0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(U0, Math.sin(roll));
  const U = R0.clone().multiplyScalar(-Math.sin(roll)).addScaledVector(U0, Math.cos(roll));
  const v = P.sub(cam);
  const z = v.dot(F), th = Math.tan(fov / 2);
  const nx = v.dot(R) / (z * th * (W / H)), ny = v.dot(U) / (z * th);
  return { x: (nx * 0.5 + 0.5) * W, y: (0.5 - ny * 0.5) * H };
}

// ================================================================ v2：螢幕上的字級、環境動態
/**
 * 螢幕上的縮放：物件（例如手機的螢幕面）本地座標裡兩點之間的距離投影到畫面上是幾 px，除以它們在畫布上的距離（px）
 * → 「畫面 px ／ 畫布 px」。v2 的字級是畫面上的 px，畫在畫布上要除以這個數。
 */
export function projScale(cam: THREE.Camera, obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, canvasDist: number): number {
  // 連父物件一起更新：窗格第一次 init 時場景還沒畫過，手機（父）的世界矩陣還是單位矩陣，量出來的倍數會錯
  obj.updateWorldMatrix(true, false);
  cam.updateMatrixWorld(true);
  const pa = toScreen(cam, obj.localToWorld(a.clone())), pb = toScreen(cam, obj.localToWorld(b.clone()));
  return Math.hypot(pb.x - pa.x, pb.y - pa.y) / canvasDist;
}

/**
 * 杯子冒的熱氣（三維 LineBatch，世界寬度）：幾縷細煙從杯口 (x, y, z) 往上飄，邊飄邊左右擺、越高越淡。
 * 一縷是一條由下往上的折線，整條沿著時間往上捲（相位 = t），所以不用記狀態。
 */
export function steam(lb: import('../engine/lines').LineBatch, t: number, x: number, y: number, z: number, h: number, rgb: readonly number[], seed = 1, wisps = 3, width = 1) {
  for (let k = 0; k < wisps; k++) {
    const ph = seed * 1.7 + k * 2.3;
    const N = 18;
    let px = x, py = y, pz = z;
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const sway = Math.sin(u * 5 + t * 1.3 + ph) * (0.6 + u * 1.8) + Math.sin(u * 11 - t * 2.1 + ph * 2) * 0.35 * u;
      const nx = x + sway + (k - (wisps - 1) / 2) * 0.8, ny = y + u * h, nz = z + Math.cos(u * 4 + t + ph) * 0.8 * u;
      const a = Math.sin(Math.PI * u) * (0.55 + 0.45 * Math.sin(t * 0.9 + ph)) * 0.5;
      lb.seg(px, py, pz, nx, ny, nz, (0.35 + u * 0.9) * width, rgb[0]!, rgb[1]!, rgb[2]!, a);
      px = nx; py = ny; pz = nz;
    }
  }
}

/** 光裡的灰塵：盒子 [x0,y0,z0]～[x1,y1,z1] 裡 n 顆，慢慢飄（正弦路徑），在 lit(x, y, z) 回傳的亮度裡才看得到。 */
export function dust(lb: import('../engine/lines').LineBatch, t: number, box: [number, number, number, number, number, number], n: number, rgb: readonly number[], lit: (x: number, y: number, z: number) => number, seed = 1) {
  const [x0, y0, z0, x1, y1, z1] = box;
  for (let i = 0; i < n; i++) {
    const h1 = hash01(i, seed), h2 = hash01(i, seed + 1), h3 = hash01(i, seed + 2), h4 = hash01(i, seed + 3);
    const x = x0 + (x1 - x0) * fract01(h1 + 0.013 * t * (0.5 + h4) + 0.05 * Math.sin(t * 0.4 + i));
    const y = y0 + (y1 - y0) * fract01(h2 - 0.01 * t * (0.3 + h1));
    const z = z0 + (z1 - z0) * h3 + Math.sin(t * 0.6 + i * 1.3) * 0.6;
    const k = lit(x, y, z);
    if (k <= 0.02) continue;
    const tw = 0.5 + 0.5 * Math.sin(t * (1.5 + h4 * 2) + i);
    lb.seg(x, y, z, x + 0.05, y + 0.05, z, 0.18 + 0.12 * h3, rgb[0]!, rgb[1]!, rgb[2]!, k * (0.35 + 0.65 * tw));
  }
}
const hash01 = (i: number, s: number) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
const fract01 = (x: number) => x - Math.floor(x);

/** 燭火（三維 LineBatch，加亮）：一團由粗到細的線，跟著 flick（0..1）晃、拉長。 */
export function flame(lb: import('../engine/lines').LineBatch, t: number, x: number, y: number, z: number, h: number, rgbCore: readonly number[], rgbGlow: readonly number[], flick: number) {
  const sway = Math.sin(t * 7.3) * 0.12 + Math.sin(t * 13.1) * 0.06 + flick * 0.15;
  const hh = h * (1 + 0.25 * flick + 0.08 * Math.sin(t * 11));
  const N = 6;
  for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N;
    const w = (1 - u0) * 0.9 + 0.15;
    lb.seg(x + sway * u0 * u0, y + u0 * hh, z, x + sway * u1 * u1, y + u1 * hh, z, w * 1.8, rgbGlow[0]! * 1.2, rgbGlow[1]! * 1.2, rgbGlow[2]! * 1.2, 0.35);
    lb.seg(x + sway * u0 * u0, y + u0 * hh, z, x + sway * u1 * u1, y + u1 * hh, z, w * 0.8, rgbCore[0]! * 3, rgbCore[1]! * 3, rgbCore[2]! * 3, 0.9);
  }
}

/**
 * v2 的留言排版（畫布座標）：k = 畫面 px／畫布 px。行數越少越好——先試一行、兩行…，照子句斷（fitClauses），
 * 第一個「字級夠大」（≥ min(44, 上限的 80%)）的就用；都不行才用最小字級塞，最後退回 fitText（下限 36，寧可小一點也不要爆框）。
 * 短句不會被斷成「新婚快／樂！！！」，長留言也不會因為找最大字級而被斷得很碎。
 */
export function fitMsgV2(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, k: number, lineHeight = 1.22, maxLines = 9): FitResult {
  const max = msgMaxFor(text) / k, min = V2.msgMin / k;
  // 短句（10 字以內）一行放得下（≥ 40）就一行：「新婚快／樂！！！」比小一點難讀多了
  const good = (msgLen(text) <= 10 ? V2.msgMin : Math.min(44, msgMaxFor(text) * 0.8)) / k;
  let last: FitResult | null = null;
  for (let n = 1; n <= maxLines; n++) {
    const r = fitClauses(c, text, family, w, h, { min, max, lineHeight, maxLines: n });
    if (!r) continue;
    if (r.size >= good) return r;
    last = last ?? r;
  }
  return last ?? fitText(c, text, family, w, h, { min: 36 / k, max, lineHeight, maxLines });
}
