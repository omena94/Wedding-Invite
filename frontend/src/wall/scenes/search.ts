// 搜尋框（亮）：白天、窗邊的木桌上一台打開的筆電，鏡頭在鍵盤前面一點、稍微偏右，螢幕上是一個很乾淨的搜尋頁
// （自己的小字標「Wishes」，不像任何搜尋引擎）。前景的鍵盤是糊的，焦點在螢幕上。
//  - 歌詞是打進搜尋框的字：唱到哪打到哪，還沒唱的部分是淡淡的「自動完成」灰字（三成），正在唱的字是訊號色的暗部；
//    游標跟著拍子閃。換下一句前整句先被「全選」反白一下，再被新的一句取代。
//  - 搜尋框下面的第一個建議就是主打留言：手寫字、整個畫面最大，署名在右下；每個小節線這一列的底色輕輕亮一下（被選中）。
//    下面兩列很小很淡的冷面建議（「芃芃 QQ 可以當花童嗎」），每唱一個新字就重洗一次，像真的自動完成。
//  - 純音樂：搜尋框一拍打一個字「今晚最想對新人說的話」。沒有留言：第一個建議是邀請（小一點），焦點讓給歌詞。
//  - 鏡頭：慢慢推近，每個小節線緩一下；主打出現時多推一點。
// v2（留言尺寸標準）：筆電本身是場景、可以大；補的動畫跟「打字搜尋」有關：歌詞唱一個字，鍵盤上就有一顆鍵被按下去
// （鍵帽往下、底下透出一點訊號色的背光），每個小節線按一下 Enter（主打那一列同時被選中亮一下）。
// 螢幕上的字級照 v2（畫面上的 px）：量螢幕投影到畫面上的寬度，換算成畫布上的字級。
// 畫法：筆電、桌子、牆是 three.js（_t5 的舞台：超取樣＋景深）；螢幕內容是一張 16:10 的 Canvas2D（fast），每格重畫。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { GLSL_COMMON } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, lyricAt, drawHeart, fillWithHearts, signature, COUPLE_ZH, lyricSubOf, subSizeFor, subGap, type LyricStyle, type LyricLayout } from './_motifs';
import { grid, windowLines, rrect, lastOf, renderStage, bodyMaterial, screenMaterial, tableMaterial, backdropMaterial, slab, setV3, mixV, projScale, fitMsgV2, type Grid } from './_t5';
import { V2, lyricV2, sigV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: true, energy: [0.1, 0.75], bars: [4, 8] };

// ---------------------------------------------------------------- 筆電（公分）與螢幕畫布（像素）
const BASE = { w: 32, d: 22, h: 1.4 };
const LID = { w: 32, h: 21, d: 0.6 };
const OPEN = 0.24; // 螢幕往後仰的角度
const CW = 1600, CH = 1000;
const SCR = { w: 29, h: 29 * (CH / CW) };
const FX = 150, FW = CW - 2 * FX; // 搜尋框
const FY = 150;
const QUERY: LyricStyle = { family: F.archivo(75, 700), size: 80, minSize: 70, maxWidth: FW - 170, align: 'left', lineHeight: 1.05 };
/** 沒有留言時歌詞是焦點：打大一點。 */
const QUERY_BIG: LyricStyle = { ...QUERY, size: 104, minSize: 76 };
const NPRESS = 8; // 鍵盤上同時在「按」的鍵最多幾顆
const INSTR_QUERY = '今晚最想對新人說的話';
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
/** 冷面的自動完成建議（{kw} 會換成正在打的那句的開頭）。 */
const SUGGEST = [
  '{kw} 歌詞', '新婚快樂 怎麼說比較有誠意', '喜餅 什麼時候發', `${GROOM} ${BRIDE} 怎麼認識的`, '婚禮 感動到哭 正常嗎',
  '芃芃 QQ 可以當花童嗎', '一輩子 有多長', '永遠 的 近義詞', '捧花 怎麼接比較準',
];

// 鍵盤：鋁的底上一格一格的深色鍵、一塊觸控板（會被景深糊掉，所以簡單就好）
const KEYS_FS = /* glsl */ `
  uniform vec3 alu; uniform vec3 key; uniform vec3 lit; uniform vec3 presses[${8}];
  varying vec3 vW; varying vec3 vN; varying vec2 vUv;
  ${GLSL_COMMON}
  void main() {
    vec2 p = vUv * vec2(${BASE.w}.0, ${BASE.d}.0);
    vec3 col = alu;
    // 鍵盤區：上面 11 公分、左右留 2 公分
    vec2 kp = p - vec2(2.2, ${BASE.d}.0 - 12.4);
    if (kp.x > 0.0 && kp.x < ${BASE.w - 4.4} && kp.y > 0.0 && kp.y < 10.6) {
      vec2 cell = vec2(${((BASE.w - 4.4) / 14).toFixed(4)}, 1.77);
      vec2 q = mod(kp, cell) - cell * 0.5;
      float k = sdBox(q, cell * 0.5 - vec2(0.18, 0.18)) - 0.12;
      // 被按下去的鍵：鍵帽變暗（往下沉），邊縫透出背光；presses = (欄, 列, 按下去之後幾秒)
      vec2 id = floor(kp / cell);
      float press = 0.0;
      for (int i = 0; i < ${8}; i++) {
        vec3 pr = presses[i];
        if (pr.z < 0.0) continue;
        float hit = (1.0 - step(0.5, abs(id.x - pr.x))) * (1.0 - step(0.5, abs(id.y - pr.y)));
        press = max(press, hit * exp(-pr.z * 7.0));
      }
      float keyIn = 1.0 - smoothstep(-0.03, 0.03, k);
      col = mix(col, key * (1.0 - 0.45 * press), keyIn);
      col += lit * press * (1.0 - keyIn) * smoothstep(0.35, 0.0, k) * 1.4;
    }
    // 觸控板
    float tp = sdBox(p - vec2(${BASE.w / 2}.0, 4.6), vec2(6.0, 3.6)) - 0.4;
    col = mix(col, alu * 0.93, 1.0 - smoothstep(-0.03, 0.03, tp));
    gl_FragColor = vec4(col, 1.0);
  }`;

function makeRig() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 2, 2000);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), tableMaterial());
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1400, 500), backdropMaterial());
  wall.position.set(0, 200, -230);
  const lap = new THREE.Group();
  const bodyMat = bodyMaterial();
  const base = new THREE.Mesh(slab(BASE.w, BASE.d, BASE.h, 1.0, 0.25), bodyMat);
  base.rotation.x = -Math.PI / 2;
  base.position.y = BASE.h;
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(BASE.w - 1.2, BASE.d - 1.2).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vW; varying vec3 vN; varying vec2 vUv; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normal; vUv = uv; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: KEYS_FS, uniforms: { alu: { value: new THREE.Vector3() }, key: { value: new THREE.Vector3() }, lit: { value: new THREE.Vector3() }, presses: { value: Array.from({ length: NPRESS }, () => new THREE.Vector3(0, 0, -1)) } },
  }));
  keys.position.y = BASE.h + 0.01;
  // 螢幕蓋：轉軸在底座後緣，往後仰
  const lid = new THREE.Group();
  lid.position.set(0, BASE.h, -BASE.d / 2 + 0.4);
  lid.rotation.x = -OPEN;
  const lidBody = new THREE.Mesh(slab(LID.w, LID.h, LID.d, 1.0, 0.2), bodyMat);
  lidBody.position.y = LID.h / 2;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCR.w, SCR.h), screenMaterial());
  screen.position.set(0, LID.h / 2 + 0.3, 0.012);
  lid.add(lidBody, screen);
  lap.add(base, keys, lid);
  lap.rotation.y = 0.12;
  scene.add(table, wall, lap);
  const center = new THREE.Vector3();
  return { scene, cam, table, wall, bodyMat, keys, screen, lap, center };
}

export default class Search extends Scene {
  rig = shared('search.rig', makeRig);
  ui = this.track(new Layer2D(CW, CH, 1, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  lines: Line[] = [];
  lays = new Map<Line, LyricLayout>();
  heroFit: FitResult | null = null;
  heroFamily = F.hand(400);
  tHero = 0;
  instr = false;
  /** 畫面 px／畫布 px 與換算過的字級。 */
  sc = 0.4;
  qs: LyricStyle = QUERY;
  sigSize = 46;
  smallSize = 36;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const c = this.ui.ctx;
    this.lines = windowLines(lyrics, s, e);
    this.instr = this.lines.length === 0;
    const m = this.msg;
    await loadText(`${SUGGEST.join('')}祝福搜尋掃描右下角你的祝福會出現在這裡一位賓客${INSTR_QUERY}${COUPLE_ZH}${song.title}${m ? m.text + m.name : ''}${this.lines.map((l) => l.text).join('')}`);
    this.tHero = g.b0;
    // v2 字級：量窗格中段的鏡位下，螢幕上 1 畫布 px 是畫面上幾 px
    this.pose((s + e) / 2);
    const k = this.sc = projScale(this.rig.cam, this.rig.screen, new THREE.Vector3(-SCR.w / 2, 0, 0), new THREE.Vector3(SCR.w / 2, 0, 0), CW);
    this.heroFamily = m ? F.hand(400) : F.hei(500);
    this.heroFit = m
      ? fitMsgV2(c, m.text, F.hand(400), FW - 170, CH - FY - 250 - 90 - (V2.sigMax / k) * 1.6, k, 1.2, 6)
      : fitText(c, '掃描右下角 QR code，你的祝福會出現在這裡', F.hei(500), FW - 170, 160, { min: 30 / k, max: 34 / k, lineHeight: 1.3, maxLines: 2 });
    const ms = m ? this.heroFit.size * k : null;
    this.qs = { ...QUERY, size: lyricV2(ms) / k, minSize: V2.lyrMin / k };
    this.sigSize = sigV2(ms ?? 44) / k;
    this.smallSize = 22 / k;
    for (const l of this.lines) this.lays.set(l, layoutLyric(c, l, this.q()));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, g = this.g;
    const R = this.rig;
    this.drawUi(t);

    // ---- 材質（亮的白天：紙色的牆、淺色木桌、銀色的機身）
    const tb = R.table.material as THREE.ShaderMaterial, wl = R.wall.material as THREE.ShaderMaterial, sc = R.screen.material as THREE.ShaderMaterial;
    setV3(tb.uniforms.base!, mixV(LIN.paper, LIN.sepia, 0.1), 0.95);
    setV3(tb.uniforms.base2!, mixV(LIN.paper, LIN.sepia, 0.2), 0.95);
    tb.uniforms.grainK!.value = 0.5;
    setV3(tb.uniforms.glowCol!, LIN.bone, 0.0);
    (tb.uniforms.shadow!.value as THREE.Vector4).set(0, 0, BASE.w / 2 - 0.5, BASE.d / 2 - 0.5);
    tb.uniforms.shadowRot!.value = -0.12;
    tb.uniforms.shadowK!.value = 0.35;
    setV3(tb.uniforms.fade!, mixV(LIN.paper, LIN.sepia, 0.12), 0.9);
    tb.uniforms.fadeZ!.value = 80;
    setV3(tb.uniforms.lampCol!, LIN.bone, 0.06);
    (tb.uniforms.lampPos!.value as THREE.Vector3).set(-60, 0, -30);
    tb.uniforms.lampR!.value = 70;
    setV3(wl.uniforms.top!, LIN.paper, 0.86);
    setV3(wl.uniforms.bottom!, mixV(LIN.paper, LIN.sepia, 0.1), 0.8);
    setV3(wl.uniforms.lightCol!, LIN.bone, 0.08);
    (wl.uniforms.lightPos!.value as THREE.Vector2).set(-160, 90);
    wl.uniforms.lightR!.value = 120;
    wl.uniforms.y0!.value = 0; wl.uniforms.y1!.value = 250;
    const bm = R.bodyMat;
    setV3(bm.uniforms.base!, mixV(LIN.bone, LIN.ash, 0.4), 0.9);
    setV3(bm.uniforms.keyCol!, LIN.bone, 0.55);
    (bm.uniforms.keyDir!.value as THREE.Vector3).set(-0.7, 0.8, 0.5);
    setV3(bm.uniforms.fill!, LIN.paper, 0.4);
    bm.uniforms.shine!.value = 0.25; bm.uniforms.rough!.value = 30;
    const km = R.keys.material as THREE.ShaderMaterial;
    setV3(km.uniforms.alu!, mixV(LIN.bone, LIN.ash, 0.4), 0.85);
    setV3(km.uniforms.key!, mixV(LIN.ash, LIN.graphite, 0.3), 0.72);
    sc.uniforms.ui!.value = this.ui.upload();
    sc.uniforms.on!.value = prog(t, s, s + 0.15) * 0.93;
    setV3(sc.uniforms.sheen!, LIN.bone, 0.03);
    (sc.uniforms.refl!.value as THREE.Vector3).set(-0.6, 0.5, 0.6);

    // ---- 鍵盤：唱到的每一個字按一顆鍵（字的 gi 決定哪一顆，同一個字每次都按同一顆），每個小節線按 Enter
    setV3(km.uniforms.lit!, mixV(LIN.signal, LIN.ember, 0.3), 0.9);
    const pr = km.uniforms.presses!.value as THREE.Vector3[];
    const ev: [number, number, number][] = [];
    for (const l of this.lines) for (const w of l.words) if (w.start <= t && w.start > t - 0.8) ev.push([Math.floor(hash(w.gi, 3) * 13), 1 + Math.floor(hash(w.gi, 5) * 4), t - w.start]);
    for (const b of g.bars) if (b <= t && b > t - 0.8) ev.push([13, 2, t - b]);
    ev.sort((a, b2) => a[2] - b2[2]);
    for (let i = 0; i < NPRESS; i++) { const x = ev[i]; if (x) pr[i]!.set(x[0], x[1], x[2]); else pr[i]!.set(0, 0, -1); }

    // ---- 鏡頭（見 pose）
    const dist = this.pose(t);
    renderStage(renderer, R.scene, R.cam, out, LIN.paper, { focus: dist, range: 9, maxR: 16, falloff: 0.4 });
    return { paper: 1, bloom: 0.2, vignette: 0.28, grain: 0.04 };
  }

  private q(): LyricStyle { return this.qs; }

  /** t 時搜尋框裡的游標在畫布上的位置（跟 drawUi 同一套算法）；沒在打字回傳 null。 */
  private caretAt(t: number): { x: number; y: number } | null {
    if (this.instr) return null;
    const ly = lyricAt(this.ctx.lyrics, t);
    const lay = ly ? this.lays.get(ly.line) : undefined;
    if (!ly || !lay) return null;
    const qsz = this.qs.size, two = lay.rows.length > 1;
    const tx = FX + 140, base = FY + (two ? qsz * 1.05 : qsz * 1.12);
    let x = tx, y = base - qsz * 0.4;
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      if (p <= 0) break;
      x = tx + pw.x + pw.w * p; y = base + pw.y - qsz * 0.4;
    }
    return { x, y };
  }

  /**
   * 鏡頭：鍵盤前面、稍微偏右、往下看一點（看得到鍵盤被按），筆電幾乎撐滿畫面。慢慢推近，每個小節線緩一下，
   * 主打出現時多推一點；打字的時候鏡頭跟著游標走（看的點往游標偏、再推近一點），
   * 游標位置取最近 0.3 秒的平均，一個字一個字跳的時候鏡頭才不會抖。回傳鏡頭到螢幕的距離（對焦用）。
   */
  private pose(t: number): number {
    const R = this.rig, g = this.g;
    let step = 0;
    for (const b of g.bars) step += prog(t, b - 0.1, b + 0.7, ease.inOutCubic);
    const push = Math.min(step, 6) * 0.8 + 2.5 * prog(t, this.tHero, this.tHero + 1.2, ease.outCubic);
    R.lap.updateMatrixWorld();
    R.screen.getWorldPosition(R.center);
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < 6; i++) { const q = this.caretAt(t - i * 0.06); if (q) { sx += q.x; sy += q.y; n++; } }
    const follow = n / 6;
    const dist = 68 - push - 4 * follow;
    const look = R.center.clone().add(new THREE.Vector3(5, -4.5, 4));
    if (n) {
      // 畫布座標 → 螢幕面的本地座標 → 世界座標；看的點往游標偏兩成半（再多筆電會滑進右下角 HUD 底下）
      const cw = R.screen.localToWorld(new THREE.Vector3((sx / n / CW - 0.5) * SCR.w, (0.5 - sy / n / CH) * SCR.h, 0));
      look.lerp(cw.add(new THREE.Vector3(0, -4, 4)), 0.25 * follow);
    }
    const az = 0.26 + 0.01 * Math.min(step, 6), el = 0.26;
    R.cam.position.set(look.x + Math.sin(az) * Math.cos(el) * dist, look.y + Math.sin(el) * dist, look.z + Math.cos(az) * Math.cos(el) * dist);
    R.cam.lookAt(look);
    R.cam.updateMatrixWorld();
    return R.cam.position.distanceTo(R.center);
  }

  /** 原文副行的排版（畫布 px）：照「畫面上」的主行字級算原文字級（subSizeFor(主行 × sc) ÷ sc）。dy = 原文第一排基線離中文第一排基線多遠。 */
  private subLay(c: CanvasRenderingContext2D, l: Line, lay: LyricLayout) {
    const sub = lyricSubOf(l);
    if (!sub) return null;
    const k = this.sc, st = this.q();
    const ss = subSizeFor(lay.size * k) / k;
    const sl = layoutLyric(c, sub, { ...st, size: ss, minSize: Math.min(ss, 26 / k), tracking: (st.tracking ?? 0) * 0.5 });
    return { sub, sl, dy: lay.rows[lay.rows.length - 1]!.y + subGap(lay.size * k, sl.size * k) / k };
  }

  // ---------------------------------------------------------------- 螢幕內容
  private drawUi(t: number) {
    const c = this.ui.ctx;
    const { lyrics } = this.ctx;
    const g = this.g, m = this.msg;
    c.fillStyle = mixRgba('paper', 'bone', 0.7); c.fillRect(0, 0, CW, CH);
    c.textBaseline = 'alphabetic';
    // 小字標（淡）
    c.font = font(F.serif(600, true), 40); c.fillStyle = rgba('sepia', 0.5);
    c.fillText('Wishes', FX + 10, FY - 44);
    const ww = c.measureText('Wishes').width;
    drawHeart(c, FX + 10 + ww + 16, FY - 56, 14);

    // 搜尋框：打進去的歌詞
    const ly = this.instr ? null : lyricAt(lyrics, t);
    const lay = ly ? this.lays.get(ly.line) ?? layoutLyric(c, ly.line, this.q()) : null;
    const two = !!lay && lay.rows.length > 1;
    const qsz = this.qs.size;
    // 原文副行（韓文歌）：搜尋框裡中文下面再一行小一號的原文，框跟著長高（下面的建議一起往下）
    const d = ly && lay ? this.subLay(c, ly.line, lay) : null;
    const base0 = FY + (two ? qsz * 1.05 : qsz * 1.12);
    const fh = d ? base0 + d.dy + d.sl.rows[d.sl.rows.length - 1]!.y - FY + qsz * 0.45 : two ? qsz * 2.4 : qsz * 1.6;
    c.fillStyle = rgba('bone', 1); rrect(c, FX, FY, FW, fh, 65); c.fill();
    c.strokeStyle = rgba('sepia', 0.14); c.lineWidth = 2; rrect(c, FX, FY, FW, fh, 65); c.stroke();
    // 放大鏡
    c.strokeStyle = rgba('sepia', 0.45); c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.arc(FX + 70, FY + 60, 20, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(FX + 85, FY + 75); c.lineTo(FX + 100, FY + 90); c.stroke();
    const tx = FX + 140, base = base0;
    const blink = t < g.b0 || ((t - g.b0) / g.beat) % 1 < 0.55;
    let caretX = tx, caretY = base, kw = '祝福';
    if (ly && lay) {
      const line = ly.line;
      const next = this.lines[this.lines.indexOf(line) + 1];
      const sel = next && t < next.start - 0.35 ? prog(t, next.start - 0.35 - 0.16, next.start - 0.35 - 0.1) : 0;
      if (sel > 0) for (const r of lay.rows) { c.fillStyle = rgba('signal', 0.3 * sel); c.fillRect(tx + r.x - 4, base + r.y - lay.size * 0.88, r.width + 8, lay.size * 1.14); }
      c.save(); c.translate(tx, base);
      drawLyric(c, line, t, { ...this.q(), active: rgba('blood'), sung: rgba('sepia', 0.9), unsung: rgba('sepia', 0.28) }, d ? ({ ...lay, sub: undefined } as LyricLayout) : lay, 1);
      if (d) {
        // 原文：照畫面字級另外畫（drawLyric 自動畫的會照畫布 px，螢幕縮小後太小），比中文安靜：唱到、唱完都是墨色再淡兩成
        c.translate(0, d.dy);
        const q = rgba('sepia', 0.9 * 0.8);
        drawLyric(c, d.sub, t, { ...this.q(), active: q, sung: q, unsung: rgba('sepia', 0.28) }, d.sl, 1);
      }
      c.restore();
      for (const pw of lay.words) {
        const p = Lyrics.wordProgress(pw.word, t);
        if (p <= 0) break;
        caretX = tx + pw.x + pw.w * p + 3; caretY = base + pw.y;
      }
      const mm = /^\S+/.exec(line.text);
      kw = mm ? Array.from(mm[0]).slice(0, 6).join('') : line.text.slice(0, 4);
    } else if (this.instr) {
      const n = clamp(Math.floor((t - g.b0) / g.beat) + 1, 0, Array.from(INSTR_QUERY).length);
      const typed = Array.from(INSTR_QUERY).slice(0, t < g.b0 ? 0 : n).join('');
      c.font = font(F.hei(500), qsz); c.fillStyle = rgba('sepia', 0.9);
      c.fillText(typed, tx, base);
      caretX = tx + c.measureText(typed).width + 4;
      kw = typed || '今晚';
    }
    if (blink) { c.fillStyle = rgba('blood', 0.9); c.fillRect(caretX, caretY - qsz * 0.85, 5, qsz * 1.05); }

    // 第一個建議＝主打留言（或邀請）
    const fit = this.heroFit!;
    const y0 = FY + fh + 30;
    const hk = prog(t, this.tHero, this.tHero + 0.4, ease.outCubic);
    const heroH = 40 + fit.height + fit.size * 0.3 + (m ? this.sigSize * 1.6 : 20);
    if (hk > 0) {
      c.save();
      c.globalAlpha = hk;
      c.translate(0, (1 - hk) * 24);
      // 被選中的底色：每個小節線輕輕亮一下
      const sel = 0.12 + 0.1 * pulse(t, lastOf(g.bars, t), 0.25);
      c.fillStyle = mixRgba('bone', 'signal', sel, 1); rrect(c, FX, y0, FW, heroH, 40); c.fill();
      c.font = font(this.heroFamily, fit.size); c.fillStyle = rgba('sepia', m ? 0.96 : 0.75);
      fit.lines.forEach((ln, i) => fillWithHearts(c, ln, tx, y0 + 30 + fit.size * 0.92 + i * fit.lineHeight));
      if (m) {
        // 署名：緊接在最後一行下面、靠右（v2 的署名字級）
        c.font = font(F.hand(400), this.sigSize); c.fillStyle = rgba('sepia', 0.6); c.textAlign = 'right';
        c.fillText(signature(m.name), FX + FW - 60, y0 + 30 + fit.height + fit.size * 0.3 + this.sigSize * 1.15);
        c.textAlign = 'left';
      }
      c.restore();
    }
    // 兩列很小很淡的冷面建議：每唱一個新字就重洗
    const w = lyrics.lastWord(t);
    const seed = this.instr ? Math.floor((t - g.b0) / g.beat) : w ? w.gi : 0;
    const tw = this.instr ? g.b0 + seed * g.beat : w ? w.start : -9;
    for (let i = 0; i < 2; i++) {
      const txt = SUGGEST[(Math.abs(seed) * 3 + i * 4) % SUGGEST.length]!.replace('{kw}', kw);
      const a = prog(t, tw + i * 0.03, tw + i * 0.03 + 0.18, ease.outCubic);
      const ry = y0 + heroH + this.smallSize * 1.8 + i * this.smallSize * 1.6;
      if (ry > CH - 30) break;
      c.font = font(F.hei(400), this.smallSize); c.fillStyle = rgba('sepia', 0.4 * (0.4 + 0.6 * a) * hk);
      c.fillText(txt, tx, ry + (1 - a) * 10);
    }
  }
}
