// 求籤（批次 T18・遊戲，亮）：廟裡的供桌上，一個竹子做的籤筒、一張摺成三折的籤詩。
//  - 開場鏡頭貼著籤筒（前景那張摺好的籤詩是糊的），每一拍籤筒「喀啦」跳一下、歪一下，裡面的籤跟著抖，
//    有一支一拍比一拍冒得更高。
//  - 揭曉（小節線）：那支籤從筒裡彈出來、在空中翻兩圈、落在桌上彈一下。鏡頭同時搖到籤詩上、焦點拉過去，
//    籤詩在拍點上一折一折攤開：右邊那折先翻開、再翻左邊。
//  - 籤詩：紅色的雙框、「第 042 籤」、詩＝主打留言（宋體，最大）、署名；分隔線下面「解曰：」＝歌詞（逐字跟唱）。
//    攤開之後的下一個小節線「上上」的印章蓋上去（冷面的幽默：每一支都是上上籤）。
//  - 籤詩還沒打開前，歌詞先寫在畫面左下（像字幕）；籤詩一打開就換到「解曰」那一欄。
//  - 沒有留言：籤詩印的是一首原創的七言籤詩（邀請大家掃碼留言）。
// 畫法：_t4 的桌上舞台（淺色木桌、一盞燈、景深、影子）＋ three.js：籤筒（竹子 shader）、籤、籤詩（三折的網格，
// 每格照攤開的角度算出每個頂點的位置，正面貼籤詩的 render target、背面是素紙）。整個 3D 畫進 MSAA 目標再貼到畫面上。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { clamp, ease, hash, lerp, mulberry32, prog, pulse } from '../engine/util';
import { lyricAt, lyricSizeFor, fillWithHearts } from './_motifs';
import { grid, layoutRows, drawRows, paperInk, Stage, docRT, type Grid, type V3 } from './_t4';
import { msgBlock, type MsgBlock } from './_t14';
import { sigInk } from './_t1';
import { loadWindow, revealAt, beatsBetween } from './_t18';

export const spec: PlateSpecDecl = { group: 'type', family: 'game', paper: true, energy: [0.25, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 籤詩（紙面像素，左上原點）
const PW = 1500, PH = 840;
const POEM = { x: 120, y: 186, w: 1260, h: 440 };
const JIE = { x: 100, y: 742, lx: 232, w: 880 };
const NSEG = 90;
// ---------------------------------------------------------------- 桌上（世界座標：x 右、y 往桌子裡、z 朝上）
const TUBE = { x: -960, y: 330, r: 104, h: 440 };
const STICK = { w: 12, len: 470, t: 3 };
const LAND: V3 = [-880, -300, STICK.t / 2];
const FAM_MSG = F.ming(700);
const FAM_SIG = F.hand(400);
const FAM_LYR = F.hei(700);
/** 沒有留言時的籤詩（原創的七言四句）。 */
const VERSE = ['良辰美景照華堂，賓客滿座共舉觴；', '欲知此籤何所指，掃碼留言祝福長。'];
const TEXT = '第籤上上解曰' + VERSE.join('');

const PRE = /* glsl */ `precision highp float;\nprecision highp int;\n`;
const OBJ_VERT = /* glsl */ `${PRE}
in vec3 position; in vec3 normal;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vL; out vec3 vN; out vec3 vW;
void main() {
  vL = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** 竹子：kind 0 = 籤筒（竹節、一圈紅紙、裡面暗）、1 = 籤（淺竹、頂端塗紅）。 */
const OBJ_FRAG = /* glsl */ `${PRE}
in vec3 vL; in vec3 vN; in vec3 vW;
out vec4 fragColor;
${GLSL_COMMON}
uniform vec4 pool; uniform vec3 lightDir; uniform float ambient; uniform int kind;
void main() {
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  float dif = max(dot(n, normalize(lightDir)), 0.0);
  float r = length(vW.xy - pool.xy) / pool.z;
  float pl = mix(1.0, 0.72 + 0.36 * exp(-r * r), pool.w);
  float sh = (ambient * 0.9 + (1.0 - ambient) * dif * 1.15) * pl;
  vec3 col;
  if (kind == 0) {
    // 籤筒：朱漆的木筒（訊號色的暗部＝漆色，換主題跟著變），上下兩圈金色的箍，漆面有一條直的反光
    float ang = atan(vL.z, vL.x), h = vL.y;
    col = mix(C_BLOOD, C_SIGNAL, 0.22) * (0.78 + 0.05 * snoise(vec2(ang * 10.0, h / 120.0)));
    float hoop = step(abs(h - 165.0), 9.0) + step(abs(h + 170.0), 9.0) + step(abs(h - 10.0), 3.0) * 0.8;
    col = mix(col, mix(C_SIGNAL, C_PAPER, 0.35) * 0.95, clamp(hoop, 0.0, 1.0));
    // 上緣一圈切口（露出木頭）
    col = mix(col, mix(C_PAPER, C_SEPIA, 0.3), smoothstep(214.0, 218.0, h));
    if (!gl_FrontFacing) col = mix(C_PAPER, C_SEPIA, 0.55) * 0.5;
    vec3 hv = normalize(normalize(lightDir) + vec3(0.0, -0.5, 0.8));
    col += mix(C_PAPER, C_EMBER, 0.4) * 0.35 * pow(max(dot(n, hv), 0.0), 40.0) * (gl_FrontFacing ? 1.0 : 0.0);
  } else {
    col = mix(mix(C_PAPER, C_SIGNAL, 0.2), C_SEPIA, 0.18) * (0.96 + 0.05 * snoise(vec2(vL.x / 3.0, vL.y / 40.0)));
    col = mix(col, mix(C_BLOOD, C_SIGNAL, 0.25), smoothstep(150.0, 154.0, vL.y));
  }
  fragColor = vec4(col * sh, 1.0);
}`;

/** 整晚共用：舞台、籤詩的貼圖、MSAA 目標、籤筒、籤、籤詩的網格。 */
function makeRig() {
  const st = new Stage(1, 30);
  st.U.ambient.value = 0.78;
  const rt = docRT(PW, PH);
  const msaa = makeRT(W, H, { samples: 4 });
  const objMat = (kind: number) => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: OBJ_VERT, fragmentShader: OBJ_FRAG,
    uniforms: { ...THEME_UNIFORMS, pool: st.U.pool, lightDir: st.U.lightDir, ambient: st.U.ambient, kind: { value: kind } },
    side: THREE.DoubleSide,
  });
  const tubeMat = objMat(0), stickMat = objMat(1);
  // 籤筒：開口的竹筒（軸是 y，整組轉成直立 z）＋底
  const tube = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(TUBE.r, TUBE.r * 0.95, TUBE.h, 56, 1, true), tubeMat);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(TUBE.r * 0.95, 40), tubeMat);
  bottom.rotation.x = Math.PI / 2; bottom.position.y = -TUBE.h / 2 + 2;
  const inner = new THREE.Group();
  inner.add(body, bottom);
  inner.rotation.x = Math.PI / 2; inner.position.z = TUBE.h / 2;
  tube.add(inner);
  const stickGeo = new THREE.BoxGeometry(STICK.w, STICK.len, STICK.t);
  const sticks: THREE.Mesh[] = [];
  const rnd = mulberry32(7);
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(stickGeo, stickMat);
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * (TUBE.r - 18);
    m.userData = { x: Math.cos(a) * rr, y: Math.sin(a) * rr, tx: (rnd() - 0.5) * 0.16, ty: (rnd() - 0.5) * 0.16, rz: rnd() * Math.PI, dz: rnd() * 50 };
    tube.add(m);
    sticks.push(m);
  }
  const flyer = new THREE.Mesh(stickGeo, stickMat);
  // 籤詩：三折（正面貼籤詩、背面素紙），兩個網格共用同一組頂點
  const geo = new THREE.PlaneGeometry(PW, PH, NSEG, 1);
  const front = new THREE.Mesh(geo, st.docMaterial(rt.texture, [rt.width, rt.height], [PW, PH], { edge: 1, depthTest: true, side: THREE.FrontSide }));
  const back = new THREE.Mesh(geo, st.solidMaterial('mix(C_PAPER, C_SEPIA, 0.04) * (0.97 + 0.03 * detail * snoise(p / 9.0))', { side: THREE.BackSide }));
  for (const m of [tube, flyer, front, back]) { m.frustumCulled = false; st.scene.add(m); }
  body.frustumCulled = bottom.frustumCulled = false;
  for (const s of sticks) s.frustumCulled = false;
  const base = Float32Array.from((geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array);
  return { st, rt, msaa, tube, sticks, flyer, geo, front, back, base };
}

export default class Fortune extends Scene {
  rig = shared('fortune.rig', makeRig);
  /** 籤詩上不會變的：紙、紅框、籤號、詩（留言）、署名（畫一次）。 */
  paper = this.track(new Layer2D(PW, PH, undefined, { fast: true }));
  /** 籤詩上會變的：解曰（歌詞）、上上的印章。 */
  live = this.track(new Layer2D(PW, PH, undefined, { fast: true }));
  /** 籤詩打開前的歌詞（畫面左下）。 */
  sub = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  block: MsgBlock | null = null;
  lyrSize = 56;
  g!: Grid;
  tr = 0; fl = 0.5; u1 = 0; u2 = 0; tStamp = Infinity;
  shakes: number[] = [];

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    await loadWindow(this.ctx, TEXT);
    const g = (this.g = grid(au, s, e));
    const B = g.beat;
    this.tr = revealAt(au, g.b0, e, { minB: 2, maxB: 4 });
    this.shakes = beatsBetween(au, g.b0, this.tr - 0.05);
    this.fl = clamp(1.25 * B, 0.45, 0.62);
    this.u1 = this.tr + this.fl * 0.8;
    this.u2 = this.u1 + clamp(0.5 * B, 0.2, 0.32);
    const bar = g.bars.find((x) => x > this.u2 + 0.45);
    this.tStamp = bar !== undefined && bar < e - 0.6 ? bar : Math.min(this.u2 + B * 1.5, e - 0.4);

    // ---- 籤詩的紙面（畫一次）
    const c = this.paper.ctx;
    const red = sigInk(0.92);
    c.fillStyle = rgba('paper'); c.fillRect(0, 0, PW, PH);
    // 紙的纖維與一點點斑駁
    const rnd = mulberry32(11);
    for (let i = 0; i < 420; i++) {
      const x = rnd() * PW, y = rnd() * PH, a = rnd() * Math.PI, l = 6 + rnd() * 22;
      c.strokeStyle = rgba('sepia', 0.025 + rnd() * 0.04); c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    }
    // 紅色的雙框、角花、分隔線
    c.strokeStyle = red; c.lineWidth = 6; c.strokeRect(34, 34, PW - 68, PH - 68);
    c.lineWidth = 1.6; c.strokeRect(50, 50, PW - 100, PH - 100);
    c.fillStyle = red;
    for (const [x, y] of [[50, 50], [PW - 50, 50], [50, PH - 50], [PW - 50, PH - 50]]) c.fillRect(x! - 9, y! - 9, 18, 18);
    c.fillRect(70, 160, PW - 140, 2);
    c.fillRect(70, 664, PW - 140, 2);
    // 籤號、解曰
    c.textBaseline = 'alphabetic';
    c.font = font(F.ming(700), 32); c.letterSpacing = '8px';
    const no = this.msg ? this.msg.n : this.ctx.song.index;
    c.fillText(`第 ${String(Math.max(0, no)).padStart(3, '0')} 籤`, 96, 122);
    c.font = font(F.hei(700), 30); c.letterSpacing = '4px';
    c.fillText('解曰：', JIE.x, JIE.y);
    c.letterSpacing = '0px';
    // 詩：主打留言（沒有留言：原創的七言籤詩）
    c.fillStyle = rgba('sepia', 0.96);
    if (this.msg) {
      const b = (this.block = msgBlock(c, this.msg, FAM_MSG, POEM, { align: 'center', sigFamily: FAM_SIG, min: 48, max: 124, lineHeight: 1.3, maxLines: 5, sigMin: 40, sigMax: 52 }));
      c.font = font(FAM_MSG, b.fit.size);
      for (const ln of b.lines) fillWithHearts(c, ln.text, ln.x, ln.y);
      c.font = font(FAM_SIG, b.sig.size); c.fillStyle = rgba('sepia', 0.72);
      c.fillText(b.sig.text, b.sig.x, b.sig.y);
      this.lyrSize = lyricSizeFor(b.fit.size);
    } else {
      c.font = font(FAM_MSG, 70); c.textAlign = 'center'; c.letterSpacing = '6px';
      VERSE.forEach((v, i) => c.fillText(v, PW / 2, POEM.y + 170 + i * 150));
      c.textAlign = 'left'; c.letterSpacing = '0px';
      this.lyrSize = 62;
    }
    this.paper.upload();
  }

  /** 籤詩的形狀：左右兩折的角度（π = 摺起來蓋在中間那折上、0 = 攤平）。 */
  private fold(t: number): [number, number] {
    const open = (t0: number) => {
      const k = prog(t, t0, t0 + 0.34);
      // 翻開、稍微彈一下再躺平
      const bounce = t > t0 + 0.34 ? 0.12 * Math.exp(-(t - t0 - 0.34) / 0.1) * Math.abs(Math.sin((t - t0 - 0.34) * 22)) : 0;
      return Math.PI * (1 - ease.inOutCubic(k)) + bounce;
    };
    return [open(this.u2), open(this.u1)];
  }

  private shapePaper(tl: number, trr: number) {
    const R = this.rig;
    const a = PW / 3, b = (2 * PW) / 3;
    const pos = R.geo.getAttribute('position') as THREE.BufferAttribute;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const X = R.base[i * 3]! + PW / 2, Y = R.base[i * 3 + 1]!;
      let x = X, z = 0;
      if (X < a) { const d = a - X; x = a - d * Math.cos(tl); z = d * Math.sin(tl) + 1.5 * (tl / Math.PI); }
      else if (X > b) { const d = X - b; x = b + d * Math.cos(trr); z = d * Math.sin(trr) + 3 * (trr / Math.PI); }
      pos.setXYZ(i, x - PW / 2, Y, z);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    }
    pos.needsUpdate = true;
    R.geo.computeVertexNormals();
    return { minX: minX - PW / 2, maxX: maxX - PW / 2 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, g = this.g, B = g.beat, tr = this.tr;
    const R = this.rig, st = R.st;

    // ---- 籤筒：每一拍跳一下、歪一下（越來越用力），裡面的籤跟著抖
    let hop = 0, tiltX = 0, tiltY = 0, jig = 0;
    this.shakes.forEach((tb, k) => {
      const d = t - tb;
      if (d < 0 || d > 0.9) return;
      const amp = 0.6 + 0.4 * (k + 1) / this.shakes.length;
      hop += 22 * amp * Math.max(0, Math.sin(Math.min(d / 0.14, 1) * Math.PI));
      const w = Math.exp(-d / 0.16) * Math.sin(d * 34) * amp;
      tiltX += 0.07 * w * (k % 2 ? 1 : -1);
      tiltY += 0.05 * w * (hash(k, 3) - 0.5) * 2;
      jig += Math.exp(-d / 0.12) * amp;
    });
    R.tube.position.set(TUBE.x, TUBE.y, hop);
    R.tube.rotation.set(tiltX, tiltY, 0);
    // 冒出來的那支：一拍比一拍高
    const risen = this.shakes.filter((x) => x <= t).length / Math.max(1, this.shakes.length);
    R.sticks.forEach((m, i) => {
      const u = m.userData as { x: number; y: number; tx: number; ty: number; rz: number; dz: number };
      // 籤的中心比筒口低，只露出上面一截（紅色的頭）
      const z = TUBE.h + 120 - STICK.len / 2 + u.dz * 0.6 + 14 * jig * (hash(i, Math.floor(t * 12)) - 0.3);
      m.position.set(u.x, u.y, z);
      // 先繞著自己的長軸轉（Y）、再稍微歪（Z）、最後立起來（X）
      m.rotation.set(Math.PI / 2 + u.tx, u.rz, u.ty, 'XZY');
    });
    // 飛出來的那支：在筒裡冒高 → 揭曉時彈出、翻兩圈、落在桌上彈一下
    const fl = this.fl;
    const k = prog(t, tr, tr + fl);
    const mouth: V3 = [TUBE.x, TUBE.y, TUBE.h + 30 + 70 * ease.outQuad(risen)];
    let fx: number, fy: number, fz: number, rx: number, rz: number;
    if (t < tr) { [fx, fy, fz] = [mouth[0] + 20, mouth[1] - 10, mouth[2] + hop]; rx = Math.PI / 2 + tiltX; rz = 0.3; }
    else if (t < tr + fl) {
      fx = lerp(mouth[0], LAND[0], k); fy = lerp(mouth[1], LAND[1], k);
      fz = lerp(mouth[2], LAND[2] + STICK.len * 0.02, k) + 4 * 620 * k * (1 - k);
      rx = Math.PI / 2 + ease.inOutQuad(k) * Math.PI * 2.5; rz = 0.3 + k * 0.5;
    } else {
      const d = t - tr - fl;
      fx = LAND[0]; fy = LAND[1]; fz = LAND[2] + 26 * Math.exp(-d / 0.09) * Math.abs(Math.sin(d * 26));
      rx = Math.PI * 3; rz = 0.8;
    }
    R.flyer.position.set(fx, fy, fz);
    R.flyer.rotation.set(rx, 0, rz, 'ZXY');

    // ---- 籤詩攤開
    const [tl, trr] = this.fold(t);
    const ext = this.shapePaper(tl, trr);
    R.front.position.set(0, 0, 1); R.back.position.set(0, 0, 1);

    // ---- 籤詩上的解曰（歌詞）與印章
    const openK = prog(t, this.u2 + 0.1, this.u2 + 0.4);
    const L = this.live, c = L.ctx;
    L.clear();
    const ly = lyricAt(lyrics, t);
    const ink = paperInk();
    ink.active = sigInk(1);
    if (ly && openK > 0) {
      const st2 = { family: FAM_LYR, size: this.lyrSize, minSize: 52, maxW: JIE.w, maxRows: 2 };
      const lay = layoutRows(c, ly.line, st2);
      c.save(); c.translate(JIE.lx, JIE.y + (lay.rows.length > 1 ? -lay.lineHeight * 0.25 : 0));
      drawRows(c, lay, FAM_LYR, t, ink, ly.k * openK);
      c.restore();
    }
    if (t >= this.tStamp) {
      // 上上：訊號色的方印，蓋下去的那一下從大變小、有一點歪
      const q = prog(t, this.tStamp, this.tStamp + 0.12, ease.inQuad);
      const sc = lerp(1.7, 1, q), al = q;
      c.save(); c.translate(PW - 170, 112); c.rotate(-0.07); c.scale(sc, sc); c.globalAlpha = al;
      c.fillStyle = sigInk(0.9); c.fillRect(-60, -60, 120, 120);
      c.fillStyle = rgba('paper'); c.font = font(F.ming(900), 46); c.textAlign = 'center';
      c.fillText('上', 0, -8); c.fillText('上', 0, 44);
      // 印泥沒吃到的小白點
      const rr = mulberry32(5);
      for (let i = 0; i < 60; i++) { c.globalAlpha = al * 0.5 * rr(); c.fillRect(-60 + rr() * 120, -60 + rr() * 120, 2 + rr() * 3, 2 + rr() * 3); }
      c.restore();
    }
    comp.draw(renderer, this.paper.texture, R.rt, { mode: 'replace' });
    comp.draw(renderer, L.upload(), R.rt);

    // ---- 鏡頭：開場貼著籤筒 → 揭曉後搖到籤詩上、焦點拉過去 → 慢慢推近
    const land = ease.outExpo(prog(t, s, s + Math.min(0.8, 2 * B)));
    const mv = ease.inOutCubic(prog(t, tr + 0.1, tr + 0.1 + clamp(1.7 * B, 0.6, 1.0)));
    const push = ease.inOutQuad(prog(t, this.u2 + 0.4, Math.max(this.u2 + 2, e)));
    const TA: V3 = [TUBE.x + 170, TUBE.y - 120, 280 + 30 * risen];
    // 低一點的角度：桌面往遠處退、前景摺好的籤詩是糊的
    const PA: V3 = [TA[0] + lerp(520, 420, land), TA[1] - lerp(1520, 1400, land), TA[2] + lerp(660, 560, land)];
    const TC: V3 = [30, -100, 0];
    const D = 2160 - 90 * push, tilt = THREE.MathUtils.degToRad(23 - 3 * push);
    const PC: V3 = [TC[0] + 90 - 40 * push, TC[1] - Math.sin(tilt) * D, Math.cos(tilt) * D];
    const lerp3 = (a: V3, b: V3, q: number): V3 => [lerp(a[0], b[0], q), lerp(a[1], b[1], q), lerp(a[2], b[2], q)];
    st.look(lerp3(PA, PC, mv), lerp3(TA, TC, mv), 30, 1);
    const fA = st.depthOf([TUBE.x, TUBE.y, 260]), fC = st.depthOf([0, 60, 0]);
    st.U.focus.value = lerp(fA, fC, ease.inOutQuad(prog(t, tr + 0.2, tr + 0.2 + clamp(1.7 * B, 0.6, 1.0))));
    st.U.aperture.value = lerp(26, 18, mv);
    st.U.pool.value.set(lerp(-500, 0, mv), lerp(200, 40, mv), 1700, 0.55);
    const sh: { x: number; y: number; w: number; h: number; rot?: number; blur?: number; k?: number; r?: number }[] = [
      { x: (ext.minX + ext.maxX) / 2 + 10, y: -14, w: ext.maxX - ext.minX, h: PH, blur: 16, k: 0.28, r: 4 },
      { x: TUBE.x + 26, y: TUBE.y - 24, w: 2 * TUBE.r + 20, h: 2 * TUBE.r + 20, blur: 26 + hop, k: 0.34 - hop * 0.004, r: TUBE.r + 10 },
    ];
    if (t >= tr + fl * 0.9) sh.push({ x: LAND[0] + 6, y: LAND[1] - 6, w: STICK.len, h: STICK.w + 6, rot: Math.PI / 2 + 0.8, blur: 6, k: 0.3, r: 3 });
    st.shadows(sh);
    st.render(renderer, R.msaa);
    comp.draw(renderer, R.msaa.texture, out, { mode: 'replace' });

    // ---- 籤詩打開前：歌詞先寫在畫面左下
    const subK = 1 - openK;
    if (ly && subK > 0) {
      const S = this.sub, sc2 = S.ctx;
      S.clear();
      const st3 = { family: FAM_LYR, size: 58, minSize: 50, maxW: 1100, maxRows: 2 };
      const lay = layoutRows(sc2, ly.line, st3);
      sc2.save(); sc2.translate(150, 950 - (lay.rows.length - 1) * lay.lineHeight);
      drawRows(sc2, lay, FAM_LYR, t, ink, ly.k * subK * prog(t, s, s + 0.4));
      sc2.restore();
      comp.draw(renderer, S.upload(), out);
    }

    const avoid: [number, number, number, number] = [180, 120, 1560, 800];
    return {
      paper: 1, bloom: 0.3, vignette: 0.32, grain: 0.045, popupAvoid: [avoid],
      shake: [3 * pulse(t, tr + fl, 0.05) * Math.sin(t * 90), 3 * pulse(t, this.tStamp, 0.06) * Math.cos(t * 80)],
      zoom: 1 + 0.01 * pulse(t, this.tStamp, 0.1),
    };
  }
}
