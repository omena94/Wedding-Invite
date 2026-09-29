// 電腦桌面（暗）：晚上，書桌上一台米色的老電腦（映像管螢幕），桌燈從左邊照過來，鏡頭在斜前方慢慢推近；
// 前景的鍵盤是糊的。螢幕裡是自己設計的「LOVE OS 1.0」（不像任何真的作業系統），方塊像素、掃描線、微微凸出的玻璃。
// 螢幕上只留三樣：
//  - 主打留言：一個大大的「新留言」視窗，第一拍從桌面上的「祝福」資料夾用縮放框（老電腦開視窗的那幾圈框線）打開，
//    手寫字、整個畫面最大，署名在右下。
//  - 歌詞：下面一條「歌詞.txt」視窗，一句一句打進去（跟唱規則），方塊游標跟著拍子閃。純音樂時是方塊頻譜。
//  - 冷面的對話框「確定要永遠在一起嗎？ [是] [是]」：只在沒有留言時彈出來（有留言時會蓋到署名），游標滑過去在小節線上按下。
// v2（留言尺寸標準）：電腦本身是場景、可以大；右邊一盞桌燈只是照明。補的動畫跟「老電腦」有關：
// 每個小節線映像管「消磁」晃一下（畫面扭一下、顏色偏一下），機殼上的磁碟機燈跟著大鼓閃（像在讀寫）；
// 螢幕上的字級照 v2（畫面上的 px）：量螢幕投影到畫面上的寬度換算；留言視窗縮小到只比字多一點。
// 畫法：電腦、桌子、牆是 three.js（_t5 的舞台：超取樣＋景深）；螢幕內容是一張半解析度的 Canvas2D（fast、最近點放大
// → 方塊像素），螢幕材質負責桶狀變形與掃描線。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { GLSL_COMMON } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, lyricAt, drawHeart, fillWithHearts, signature, type LyricStyle } from './_motifs';
import { grid, windowLines, pad, renderStage, bodyMaterial, screenMaterial, tableMaterial, backdropMaterial, slab, setV3, mixV, projScale, fitMsgV2, type Grid } from './_t5';
import { V2, lyricV2, sigV2 } from './_v2';
import { LineBatch } from '../engine/lines';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0.25, 1], bars: [4, 8] };

type Rect = { x: number; y: number; w: number; h: number };
// ---------------------------------------------------------------- 電腦（公分）與螢幕畫布（像素）
const CASE = { w: 44, h: 37, d: 30, r: 2.4 };
const CW = 1280, CH = 960;
const SCR = { w: 34.5, h: 34.5 * (CH / CW) };
// 留言視窗佔滿整個寬度（打開之後蓋住右邊的圖示），歌詞一條在下面
const MSGW: Rect = { x: 60, y: 76, w: 1100, h: 560 };
const LYW: Rect = { x: 36, y: 686, w: 1208, h: 246 };
const DLG: Rect = { x: 640, y: 250, w: 560, h: 280 };
const TITLE = 44;
const FOLDER = { x: 1120, y: 110 };
const LYRIC_BASE: LyricStyle = { family: F.hei(700), size: 78, minSize: 70, maxWidth: LYW.w - 110, align: 'left', lineHeight: 1.1 };
/** 桌燈：底座在 (LAMP.x, 0, LAMP.z)，燈罩在 bulb、朝下斜照。 */
const LAMP = { x: 58, z: -34, bulb: new THREE.Vector3(48, 34, -26) };

/** 冷面的對話框（按鈕全都是「好」的意思）。 */
const DIALOGS: { q: string; a: string; b: string }[] = [
  { q: '確定要永遠在一起嗎？', a: '是', b: '是' },
  { q: '喜餅.exe 想要存取你的胃。允許嗎？', a: '允許', b: '允許一輩子' },
  { q: '要把「另一半」設為預設值嗎？', a: '是', b: '永遠是' },
  { q: '回憶太多，磁碟快滿了。要擴充嗎？', a: '擴充', b: '再擴充' },
];

// 鍵盤：米色的底上一格一格的鍵（會被景深糊掉，簡單就好）
const KEYS_FS = /* glsl */ `
  uniform vec3 base; uniform vec3 key;
  varying vec2 vUv;
  ${GLSL_COMMON}
  void main() {
    vec2 p = vUv * vec2(44.0, 15.0);
    vec2 kp = p - vec2(1.5, 1.2);
    vec3 col = base;
    if (kp.x > 0.0 && kp.x < 41.0 && kp.y > 0.0 && kp.y < 12.6) {
      vec2 cell = vec2(41.0 / 18.0, 12.6 / 6.0);
      vec2 q = mod(kp, cell) - cell * 0.5;
      float k = sdBox(q, cell * 0.5 - vec2(0.22)) - 0.15;
      col = mix(col, key, 1.0 - smoothstep(-0.04, 0.04, k));
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

function makeRig() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 2, 3000);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), tableMaterial());
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1600, 600), backdropMaterial());
  wall.position.set(0, 250, -120);
  const pc = new THREE.Group();
  const bodyMat = bodyMaterial();
  const stand = new THREE.Mesh(slab(30, 24, 3.2, 1.5, 0.4), bodyMat);
  stand.rotation.x = -Math.PI / 2; stand.position.set(0, 3.2, -CASE.d / 2);
  const box = new THREE.Mesh(slab(CASE.w, CASE.h, CASE.d, CASE.r, 0.9), bodyMat);
  box.position.set(0, 3.2 + CASE.h / 2, 0);
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(SCR.w + 2.4, SCR.h + 2.4), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  bezel.position.set(0, 3.2 + CASE.h / 2 + 0.8, 0.01);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCR.w, SCR.h), screenMaterial());
  screen.position.set(0, 3.2 + CASE.h / 2 + 0.8, 0.03);
  const kb = new THREE.Group();
  const kbBody = new THREE.Mesh(slab(44, 15, 2.4, 0.8, 0.4), bodyMat);
  kbBody.rotation.x = -Math.PI / 2; kbBody.position.y = 2.4;
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(43, 14).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: KEYS_FS, uniforms: { base: { value: new THREE.Vector3() }, key: { value: new THREE.Vector3() } },
  }));
  keys.position.y = 2.42;
  kb.add(kbBody, keys);
  kb.position.set(-3, 0, 26);
  kb.rotation.y = 0.08;
  pc.add(stand, box, bezel, screen);
  pc.rotation.y = 0.18;
  // 桌燈：圓底座、兩段燈臂、圓錐燈罩（開口朝下偏左，對著電腦與桌面）
  const lampMat = bodyMaterial();
  const lamp = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 1.6, 32), lampMat);
  base.position.set(LAMP.x, 0.8, LAMP.z);
  const armA = new THREE.Vector3(LAMP.x, 1.6, LAMP.z), armB = new THREE.Vector3(LAMP.x + 6, 22, LAMP.z - 3);
  const arm = (a: THREE.Vector3, b: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, a.distanceTo(b), 12), lampMat);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  const shadeTip = LAMP.bulb.clone().add(new THREE.Vector3(5, 4, -1));
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 8, 11, 32, 1, true), lampMat);
  shade.material.side = THREE.DoubleSide;
  shade.position.copy(LAMP.bulb).lerp(shadeTip, 0.35);
  shade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shadeTip.clone().sub(LAMP.bulb).normalize());
  lamp.add(base, arm(armA, armB), arm(armB, shadeTip), shade);
  scene.add(table, wall, pc, kb, lamp);
  const glow = new LineBatch(64, { screen2D: false, worldWidth: true, blend: 'add', depthTest: true });
  return { scene, cam, table, wall, bodyMat, bezel, screen, keys, pc, center: new THREE.Vector3(), lampMat, glow };
}

interface Dlg { i: number; tOpen: number; tClick: number; tClose: number }

export default class Desktop extends Scene {
  rig = shared('desktop.rig', makeRig);
  /** 半解析度：放大時用最近點，才會是方塊像素。 */
  ui = this.track(new Layer2D(CW, CH, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  fit: FitResult | null = null;
  tMsg = 0;
  dlgs: Dlg[] = [];
  lines: Line[] = [];
  clock = '20:13';
  /** 畫面 px／畫布 px 與換算過的字級。 */
  sc = 0.6;
  lyr: LyricStyle = LYRIC_BASE;
  lyrBig: LyricStyle = LYRIC_BASE;
  sigSize = 48;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    this.ui.texture.magFilter = THREE.NearestFilter;
    this.lines = windowLines(lyrics, s, e);
    const m = this.msg;
    const mins = 18 * 60 + 30 + (Math.max(1, song.index) - 1) * 4 + Math.floor(s / 60);
    this.clock = `${pad(Math.floor(mins / 60) % 24, 2)}:${pad(mins % 60, 2)}`;
    await loadText(`${DIALOGS.map((d) => d.q + d.a + d.b).join('')}新留言還沒有歌詞.txt播放中這段沒有歌詞祝福資源回收桶掃描右下角把你的祝福傳到這台電腦一位賓客${song.title}${m ? m.text + m.name : ''}${this.lines.map((l) => l.text).join('')}`);
    const c = this.ui.ctx;
    const text = m ? m.text : '掃描右下角 QR code，把你的祝福傳到這台電腦';
    // v2 字級：量窗格中段的鏡位下，螢幕上 1 畫布 px 是畫面上幾 px
    this.pose((s + e) / 2);
    const k = this.sc = projScale(this.rig.cam, this.rig.screen, new THREE.Vector3(-SCR.w / 2, 0, 0), new THREE.Vector3(SCR.w / 2, 0, 0), CW);
    this.sigSize = sigV2(44) / k;
    this.fit = m
      // 高度預算＝視窗內高扣掉上邊距、署名那一行與下邊距：署名永遠在最後一行字的下面，不會被蓋住
      ? fitMsgV2(c, text, F.hand(400), MSGW.w - 110, MSGW.h - TITLE - 30 - (V2.sigMax / k) * 1.6 - 24, k, 1.15, 7)
      : fitText(c, text, F.hei(500), MSGW.w - 100, 200, { min: 30 / k, max: 34 / k, lineHeight: 1.3, maxLines: 2 });
    const ms = m ? this.fit.size * k : null;
    if (m) this.sigSize = sigV2(ms!) / k;
    this.lyr = { ...LYRIC_BASE, size: lyricV2(ms) / k, minSize: V2.lyrMin / k };
    this.lyrBig = { ...LYRIC_BASE, size: lyricV2(null) / k, minSize: V2.lyrMin / k };
    this.tMsg = g.b0;
    // 對話框：留言讀完之後（沒有留言就從第二個小節線起）才彈，每兩小節一個；開、下一個小節線按、再一拍關
    // 有留言時不彈（對話框會蓋到留言與署名；每個小節線的小事件交給桌燈閃一下）；沒有留言才用它填畫面
    const bars = m ? [] : g.bars.filter((b) => b >= g.b0 + g.beat);
    for (let k = 0, n = 0; k < bars.length; k += 2, n++) {
      const tOpen = bars[k]!;
      const tClick = bars[k + 1] ?? tOpen + g.beat * 3;
      if (tClick > e - g.beat * 0.3) break;
      this.dlgs.push({ i: n === 0 ? 0 : (Math.floor(hash(this.ctx.params.seed ?? 1, 7) * 3) + n) % DIALOGS.length, tOpen, tClick, tClose: tClick + g.beat });
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, g = this.g;
    const R = this.rig;
    this.drawUi(t);

    // ---- 材質：暗暗的房間、左邊一盞暖暖的桌燈、米色的塑膠機殼
    const tb = R.table.material as THREE.ShaderMaterial, wl = R.wall.material as THREE.ShaderMaterial, sc = R.screen.material as THREE.ShaderMaterial;
    setV3(tb.uniforms.base!, mixV(LIN.ink2, LIN.blood, 0.18), 1.2);
    setV3(tb.uniforms.base2!, mixV(LIN.ink, LIN.ink2, 0.6));
    tb.uniforms.grainK!.value = 0.6;
    setV3(tb.uniforms.glowCol!, mixV(LIN.bone, LIN.signal, 0.2), 0.035);
    (tb.uniforms.glowPos!.value as THREE.Vector3).set(0, 0, 18);
    tb.uniforms.glowR!.value = 28;
    (tb.uniforms.shadow!.value as THREE.Vector4).set(0, -CASE.d / 2, 16, 13);
    tb.uniforms.shadowRot!.value = -0.18;
    tb.uniforms.shadowK!.value = 0.6;
    setV3(tb.uniforms.fade!, LIN.ink, 0.7);
    tb.uniforms.fadeZ!.value = 70;
    setV3(tb.uniforms.lampCol!, mixV(LIN.ink2, LIN.signal, 0.6), 0.5);
    (tb.uniforms.lampPos!.value as THREE.Vector3).set(-48, 0, 8);
    tb.uniforms.lampR!.value = 36;
    setV3(wl.uniforms.top!, LIN.ink, 0.7);
    setV3(wl.uniforms.bottom!, mixV(LIN.ink, LIN.ink2, 0.9));
    setV3(wl.uniforms.lightCol!, mixV(LIN.ink2, LIN.signal, 0.45), 0.4);
    (wl.uniforms.lightPos!.value as THREE.Vector2).set(-110, 70);
    wl.uniforms.lightR!.value = 70;
    wl.uniforms.y0!.value = 0; wl.uniforms.y1!.value = 200;
    const bm = R.bodyMat;
    setV3(bm.uniforms.base!, mixV(LIN.bone, LIN.ash, 0.45), 0.62);
    setV3(bm.uniforms.keyCol!, mixV(LIN.bone, LIN.signal, 0.35), 0.55);
    (bm.uniforms.keyDir!.value as THREE.Vector3).set(-0.9, 0.6, 0.45);
    setV3(bm.uniforms.fill!, LIN.ink2, 1.2);
    bm.uniforms.shine!.value = 0.15; bm.uniforms.rough!.value = 18;
    const km = R.keys.material as THREE.ShaderMaterial;
    setV3(km.uniforms.base!, mixV(LIN.bone, LIN.ash, 0.45), 0.35);
    setV3(km.uniforms.key!, mixV(LIN.bone, LIN.ash, 0.6), 0.22);
    sc.uniforms.ui!.value = this.ui.upload();
    sc.uniforms.on!.value = 0.92 * prog(t, s, s + 0.2);
    sc.uniforms.crt!.value = 0.09;
    (sc.uniforms.res!.value as THREE.Vector2).set(CW / 2, CH / 2);
    setV3(sc.uniforms.sheen!, mixV(LIN.bone, LIN.signal, 0.3), 0.05);
    (sc.uniforms.refl!.value as THREE.Vector3).set(-0.8, 0.5, 0.4);

    // ---- 映像管消磁：每個小節線畫面扭一下、顏色偏一下（0.5 秒內停下來）
    let lastBar = -Infinity;
    for (const b of g.bars) if (t >= b) lastBar = b;
    sc.uniforms.wob!.value = lastBar === -Infinity ? 0 : Math.exp(-(t - lastBar) * 7);
    sc.uniforms.wobT!.value = t - lastBar;
    // ---- 桌燈：暖光照在桌上（在燈的正下方偏電腦那邊）
    const lampI = 1;
    setV3(tb.uniforms.lampCol!, mixV(LIN.ink2, LIN.signal, 0.6), 0.55 * lampI);
    (tb.uniforms.lampPos!.value as THREE.Vector3).set(LAMP.bulb.x - 14, 0, LAMP.bulb.z + 4);
    tb.uniforms.lampR!.value = 30;
    const lm = R.lampMat;
    setV3(lm.uniforms.base!, mixV(LIN.ink2, LIN.graphite, 0.5), 0.9);
    setV3(lm.uniforms.keyCol!, mixV(LIN.bone, LIN.signal, 0.4), 0.5);
    (lm.uniforms.keyDir!.value as THREE.Vector3).set(-0.6, 0.6, 0.5);
    setV3(lm.uniforms.fill!, LIN.ink2, 1);
    lm.uniforms.shine!.value = 0.5; lm.uniforms.rough!.value = 40;

    // ---- 鏡頭（見 pose）
    const dist = this.pose(t);
    renderStage(renderer, R.scene, R.cam, out, LIN.ink, { focus: dist, range: 8, maxR: 20, falloff: 0.4 }, (rt) => {
      // 燈泡（加亮的一團）；機殼上的電源燈（一直亮、很暗）與磁碟機燈（跟著大鼓閃，像在讀寫）
      R.glow.clear();
      const bc = mixV(LIN.ember, [1, 1, 1], 0.4);
      const bb = LAMP.bulb;
      R.glow.seg(bb.x, bb.y, bb.z, bb.x + 0.05, bb.y, bb.z, 3.2, bc[0] * 3 * lampI, bc[1] * 3 * lampI, bc[2] * 3 * lampI, 0.9);
      R.pc.updateMatrixWorld();
      const led = (x: number, k: number, col: readonly number[]) => {
        const p = R.pc.localToWorld(new THREE.Vector3(x, 5.4, 0.08));
        R.glow.seg(p.x, p.y, p.z, p.x + 0.02, p.y, p.z, 0.55, col[0]! * k, col[1]! * k, col[2]! * k, 0.95);
      };
      led(CASE.w / 2 - 4, 1.2, LIN.ember);
      const disk = this.ctx.audio.hit('kick', t, 0.07) > 0.3 ? 4 : 0.25;
      led(CASE.w / 2 - 7, disk, LIN.signal);
      R.glow.render(renderer, rt, R.cam);
    });
    return { bloom: 0.55, vignette: 0.45, grain: 0.05 };
  }

  /**
   * 鏡頭：斜前方、比螢幕中心略高，拉遠一點讓電腦在畫面左半邊、桌燈在右邊；慢慢推近，每個小節線緩一下，
   * 主打出現時多推一點。回傳鏡頭到螢幕的距離（對焦用）。
   */
  private pose(t: number): number {
    const R = this.rig, g = this.g;
    let step = 0;
    for (const b of g.bars) step += prog(t, b - 0.1, b + 0.7, ease.inOutCubic);
    const push = Math.min(step, 6) * 1.1 + 3 * prog(t, this.tMsg, this.tMsg + 1.2, ease.outCubic);
    const dist = 96 - push;
    R.pc.updateMatrixWorld();
    R.screen.getWorldPosition(R.center);
    const look = R.center.clone().add(new THREE.Vector3(16, -5, 0));
    const az = 0.36 - 0.012 * Math.min(step, 6), el = 0.1;
    R.cam.position.set(look.x + Math.sin(az) * Math.cos(el) * dist, look.y + Math.sin(el) * dist, look.z + Math.cos(az) * Math.cos(el) * dist);
    R.cam.lookAt(look);
    R.cam.updateMatrixWorld();
    return R.cam.position.distanceTo(R.center);
  }

  // ---------------------------------------------------------------- 螢幕內容（1280×960，畫在半解析度上）
  private drawUi(t: number) {
    const c = this.ui.ctx;
    const { lyrics } = this.ctx;
    // 桌面：暗色底＋老桌面的點點花紋
    c.fillStyle = rgba('ink2', 1); c.fillRect(0, 0, CW, CH);
    c.fillStyle = this.dotPattern(c); c.fillRect(0, 40, CW, CH - 40);
    c.textBaseline = 'alphabetic';
    // 選單列（很窄、很淡）
    c.fillStyle = rgba('bone', 0.82); c.fillRect(0, 0, CW, 40);
    drawHeart(c, 28, 20, 22, rgba('rose'));
    c.font = font(F.hei(700), 26); c.fillStyle = rgba('ink', 1);
    c.fillText('LOVE OS', 52, 30);
    c.font = font(F.mono(600), 24); c.textAlign = 'right';
    const on = ((t - this.g.b0) / this.g.beat) % 1 < 0.5;
    const [hh, mm] = this.clock.split(':');
    c.fillText(`${hh}${on ? ':' : ' '}${mm}`, CW - 24, 29);
    c.textAlign = 'left';
    // 兩個桌面圖示（祝福資料夾、資源回收桶）
    this.folder(c, FOLDER.x, FOLDER.y, t >= this.tMsg - 0.05 && t < this.tMsg + 0.25);
    this.trash(c, FOLDER.x, FOLDER.y + 190);
    this.lyricWindow(c, t, this.lines.length && lyrics.has ? lyricAt(lyrics, t) : null);
    this.message(c, t);
    this.dialogs(c, t);
  }

  /** 老桌面的點點花紋：一塊 8×16 的小磚（交錯的兩點），做成 pattern（每格畫幾萬個小方塊太慢）。顏色跟主題，窗格開始時做一次。 */
  private pat: CanvasPattern | null = null;
  private dotPattern(c: CanvasRenderingContext2D): CanvasPattern | string {
    if (this.pat) return this.pat;
    const tile = document.createElement('canvas');
    tile.width = 4; tile.height = 8; // 半解析度：邏輯 8×16
    const tc = tile.getContext('2d')!;
    tc.fillStyle = rgba('graphite', 0.35);
    tc.fillRect(0, 0, 1, 1); tc.fillRect(2, 4, 1, 1);
    this.pat = c.createPattern(tile, 'repeat');
    this.pat?.setTransform(new DOMMatrix().scale(2, 2));
    return this.pat ?? rgba('ink2', 1);
  }

  /** 老式視窗：2 px 的框、條紋標題列（作用中的是訊號色）、置中的標題、右下硬邊影子。 */
  private window(c: CanvasRenderingContext2D, r: Rect, title: string, active: boolean) {
    c.fillStyle = rgba('ink', 0.9); c.fillRect(r.x + 10, r.y + 10, r.w, r.h);
    c.fillStyle = rgba('ink', 1); c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = rgba('bone', 0.9); c.lineWidth = 3; c.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
    c.fillStyle = rgba('bone', 0.9); c.fillRect(r.x, r.y + TITLE, r.w, 3);
    c.fillStyle = active ? rgba('signal', 0.85) : rgba('graphite', 0.8);
    for (let y = r.y + 10; y < r.y + TITLE - 6; y += 7) c.fillRect(r.x + 10, y, r.w - 20, 3);
    if (title) {
      c.font = font(F.hei(700), 28);
      const tw = c.measureText(title).width + 36;
      c.fillStyle = rgba('ink', 1); c.fillRect(r.x + (r.w - tw) / 2, r.y + 4, tw, TITLE - 8);
      c.fillStyle = rgba('bone', 0.92); c.textAlign = 'center'; c.fillText(title, r.x + r.w / 2, r.y + 32); c.textAlign = 'left';
    }
  }

  private zoomRects(c: CanvasRenderingContext2D, from: Rect, to: Rect, u: number) {
    if (u <= 0 || u >= 1) return;
    c.strokeStyle = rgba('bone', 0.85); c.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const k = clamp(u * 1.6 - i * 0.15);
      if (k <= 0 || k >= 1) continue;
      const e = ease.outCubic(k);
      c.strokeRect(lerp(from.x, to.x, e), lerp(from.y, to.y, e), lerp(from.w, to.w, e), lerp(from.h, to.h, e));
    }
  }

  private folder(c: CanvasRenderingContext2D, x: number, y: number, hot: boolean) {
    c.lineWidth = 4; c.strokeStyle = hot ? rgba('signal', 1) : rgba('bone', 0.85); c.fillStyle = rgba('ink', 1);
    c.beginPath(); c.moveTo(x, y + 14); c.lineTo(x + 36, y + 14); c.lineTo(x + 44, y + 24); c.lineTo(x + 110, y + 24); c.lineTo(x + 110, y + 90); c.lineTo(x, y + 90); c.closePath(); c.fill(); c.stroke();
    drawHeart(c, x + 55, y + 58, 30, hot ? rgba('signal') : rgba('rose'));
    c.font = font(F.hei(500), 26); c.fillStyle = rgba('bone', 0.8); c.textAlign = 'center';
    c.fillText('祝福', x + 55, y + 128); c.textAlign = 'left';
  }

  private trash(c: CanvasRenderingContext2D, x: number, y: number) {
    c.lineWidth = 4; c.strokeStyle = rgba('bone', 0.7); c.fillStyle = rgba('ink', 1);
    c.fillRect(x + 24, y + 16, 62, 74); c.strokeRect(x + 24, y + 16, 62, 74);
    c.fillStyle = rgba('bone', 0.7); c.fillRect(x + 16, y + 6, 78, 7); c.fillRect(x + 44, y, 22, 6);
    for (let k = 0; k < 3; k++) c.fillRect(x + 38 + k * 16, y + 28, 4, 50);
    c.font = font(F.hei(500), 24); c.fillStyle = rgba('bone', 0.6); c.textAlign = 'center';
    c.fillText('資源回收桶', x + 55, y + 126); c.textAlign = 'left';
  }

  /** 歌詞.txt：一句一句打進去，方塊游標停在唱到的地方；純音樂時是方塊頻譜。 */
  private lyricWindow(c: CanvasRenderingContext2D, t: number, ly: { line: Line; k: number } | null) {
    const { audio: au } = this.ctx;
    const g = this.g, r = LYW, instr = !this.lines.length;
    this.window(c, r, instr ? '播放中.wav' : '歌詞.txt', !this.msg);
    const x0 = r.x + 40, base = r.y + TITLE + 122;
    if (instr) {
      const N = 40, cw = (r.w - 80) / N;
      for (let i = 0; i < N; i++) {
        const v = au.env(['low', 'bass', 'mid', 'other', 'high'][i % 5]!, t - i * 0.01) * (0.55 + 0.45 * hash(i, 5));
        const cells = Math.round(v * 6);
        for (let k = 0; k < cells; k++) { c.fillStyle = k > 4 ? rgba('signal', 0.9) : rgba('bone', 0.6); c.fillRect(x0 + i * cw, r.y + r.h - 22 - k * 20, cw - 8, 14); }
      }
      return;
    }
    if (!ly) return;
    const st = this.msg ? this.lyr : this.lyrBig;
    const lay = layoutLyric(c, ly.line, st);
    const b = lay.rows.length > 1 ? r.y + TITLE + 80 : base;
    c.save();
    c.beginPath(); c.rect(r.x + 4, r.y + TITLE + 4, r.w - 8, r.h - TITLE - 8); c.clip();
    c.translate(x0, b);
    drawLyric(c, ly.line, t, { ...st, active: rgba('signal'), sung: rgba('bone', 0.95), unsung: rgba('bone', 0.3) }, lay, ly.k);
    c.restore();
    // 方塊游標：停在唱到的地方，跟著拍子閃
    let cx = x0, cy = b;
    for (const pw of lay.words) {
      const p = pw.word.start <= t ? Math.min(1, (t - pw.word.start) / Math.max(1e-3, pw.word.end - pw.word.start)) : 0;
      if (p <= 0) break;
      cx = x0 + pw.x + pw.w * p + 6; cy = b + pw.y;
    }
    if (((t - g.b0) / g.beat) % 1 < 0.55) { c.fillStyle = rgba('signal', 0.9); c.fillRect(cx, cy - lay.size * 0.82, lay.size * 0.42, lay.size * 0.95); }
  }

  /** 新留言：第一拍從「祝福」資料夾用縮放框打開；手寫字整個畫面最大，署名在右下。 */
  private message(c: CanvasRenderingContext2D, t: number) {
    const u = prog(t, this.tMsg, this.tMsg + 0.24);
    const from: Rect = { x: FOLDER.x, y: FOLDER.y + 14, w: 110, h: 76 };
    if (u < 1) { this.zoomRects(c, from, MSGW, u); return; }
    const m = this.msg, fit = this.fit!;
    const dlgOpen = this.dlgs.some((d) => t >= d.tOpen && t < d.tClose + 0.2);
    this.window(c, MSGW, '新留言', !dlgOpen);
    const x0 = MSGW.x + 50;
    const top = MSGW.y + TITLE + (m ? 30 : 150);
    c.font = font(m ? F.hand(400) : F.hei(500), fit.size); c.fillStyle = rgba('bone', m ? 0.97 : 0.75);
    fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x0, top + fit.size * 0.95 + i * fit.lineHeight));
    if (m) {
      // 署名：緊接在最後一行字的下面（字的下緣＋一行），不會超出視窗；v2 的署名字級
      const textBot = top + fit.size * 0.95 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.25;
      c.font = font(F.hand(400), this.sigSize); c.fillStyle = rgba('bone', 0.6); c.textAlign = 'right';
      c.fillText(signature(m.name), MSGW.x + MSGW.w - 50, Math.min(MSGW.y + MSGW.h - 20, textBot + this.sigSize * 1.3));
      c.textAlign = 'left';
    }
  }

  private button(c: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, pressed: boolean, def: boolean) {
    const h = 60;
    c.fillStyle = pressed ? rgba('bone', 0.95) : rgba('ink', 1); c.fillRect(x, y, w, h);
    c.strokeStyle = rgba('bone', 0.9); c.lineWidth = 3; c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    if (def) { c.lineWidth = 4; c.strokeRect(x - 6, y - 6, w + 12, h + 12); }
    c.font = font(F.hei(700), 30); c.textAlign = 'center'; c.fillStyle = pressed ? rgba('ink', 1) : rgba('bone', 0.95);
    c.fillText(label, x + w / 2, y + 41); c.textAlign = 'left';
  }

  /** 對話框：開（縮放框）→ 游標一拍內滑到右邊的按鈕 → 小節線上按下 → 下一拍縮回去。 */
  private dialogs(c: CanvasRenderingContext2D, t: number) {
    const g = this.g;
    const d = this.dlgs.find((x) => t >= x.tOpen && t < x.tClose + 0.25);
    let cx = MSGW.x + MSGW.w + 50, cy = MSGW.y + 380;
    if (d) {
      const dl = DIALOGS[d.i]!;
      const from: Rect = { x: DLG.x + DLG.w / 2 - 30, y: DLG.y + DLG.h / 2 - 20, w: 60, h: 40 };
      const open = prog(t, d.tOpen, d.tOpen + 0.22), close = prog(t, d.tClose, d.tClose + 0.2);
      const bw = Math.max(120, 50 + dl.b.length * 34), bx = DLG.x + DLG.w - bw - 36, by = DLG.y + DLG.h - 92;
      if (open < 1) this.zoomRects(c, from, DLG, open);
      else if (close > 0) this.zoomRects(c, DLG, from, close);
      else {
        this.window(c, DLG, '', true);
        c.strokeStyle = rgba('bone', 0.9); c.lineWidth = 4;
        c.beginPath(); c.arc(DLG.x + 66, DLG.y + TITLE + 60, 30, 0, Math.PI * 2); c.stroke();
        c.font = font(F.hei(900), 38); c.fillStyle = rgba('signal', 1); c.textAlign = 'center';
        c.fillText('?', DLG.x + 66, DLG.y + TITLE + 74); c.textAlign = 'left';
        const fit = fitText(c, dl.q, F.hei(500), DLG.w - 150, 110, { min: 30, max: 38, lineHeight: 1.3, maxLines: 2 });
        c.font = font(F.hei(500), fit.size); c.fillStyle = rgba('bone', 0.92);
        fit.lines.forEach((ln, i) => c.fillText(ln, DLG.x + 120, DLG.y + TITLE + 54 + i * fit.lineHeight));
        const aw = Math.max(100, 50 + dl.a.length * 34);
        this.button(c, bx - 40 - aw, by, aw, dl.a, false, false);
        this.button(c, bx, by, bw, dl.b, t >= d.tClick && t < d.tClick + 0.16, true);
      }
      const mv = prog(t, d.tOpen + g.beat, d.tOpen + g.beat * 2, ease.outExpo);
      cx = lerp(cx, bx + bw * 0.6, mv); cy = lerp(cy, by + 32, mv);
      if (t >= d.tClick && t < d.tClick + 0.16) cy += 3;
    }
    // 游標
    c.save();
    c.translate(Math.round(cx / 2) * 2, Math.round(cy / 2) * 2);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 44); c.lineTo(11, 34); c.lineTo(19, 50); c.lineTo(26, 47); c.lineTo(18, 31); c.lineTo(32, 31); c.closePath();
    c.fillStyle = rgba('bone', 1); c.fill(); c.strokeStyle = rgba('ink', 1); c.lineWidth = 3; c.stroke();
    c.restore();
  }
}
