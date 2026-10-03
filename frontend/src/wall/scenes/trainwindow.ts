// 照片版面「火車窗邊」（亮）：白天的火車，從車廂裡看著一扇大車窗，照片立在窗邊的小桌上、靠著玻璃——
//  - 進場：火車還在隧道裡（窗外一片黑，隧道燈一盞一盞刷過），第一拍衝出隧道，窗外一下子亮開，車廂也被照亮。
//  - 窗外的景一直往後流：遠山很慢、丘陵與樹林快一點、鐵道邊的草最快（越近越糊）；每個小節線一根電線桿刷過窗子，
//    桿子之間的電線一上一下，桿子的影子同時掃過桌面。車廂跟著鐵軌輕輕晃，大鼓時跳一下（鐵軌的接縫）。
//  - 照片是實體相片（白邊），立在桌上靠著玻璃，完整呈現不裁切；很小的舊照片最多放大到原尺寸 1.5 倍。窗邊束起來的窗簾在前景（糊一點），
//    桌上一杯外帶咖啡。
//    出隧道之後相片上的畫面慢慢往新人點的臉推（focusCrop）。
//  - 字印在車窗右邊的牆板上（思源宋體、墨色，左邊一條細線），出隧道之後淡入：主字（賓客留言＋署名，或新人的註解）在上，
//    歌詞小一號在下面跟唱；沒有主字時歌詞放在同一個位置；兩個都沒有就只有窗子與照片（窗子移到中間）。相簿的第一張在上面多一行相簿名。
// 畫法：車廂、窗外的景、相片、窗簾、杯子都在一個全螢幕 shader；字是一張 Canvas2D 層，跟著車廂一起晃。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'journey', prefers: ['portrait', 'square', 'small'], energy: [0, 1], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform float t; uniform float k; uniform vec2 bob; uniform float day; uniform float tun;
  uniform vec4 win; uniform vec2 pc; uniform vec2 hs; uniform float bd; uniform float ang;
  uniform vec2 pole; uniform float cupX; uniform float seedOff; uniform vec4 rule;

  float rbox(vec2 p, vec2 b, float r) { return sdBox(p, b - vec2(r)) - r; }
  // 山稜：x 方向的雜訊，回傳高度（px，往上為正）
  float ridge(float x, float sc, float s) { return snoise(vec2(x / sc, s)) * 0.6 + snoise(vec2(x / (sc * 0.37), s + 4.0)) * 0.25 + snoise(vec2(x / (sc * 0.11), s + 9.0)) * 0.08; }

  vec3 outside(vec2 q) {
    // q：窗外的畫面座標（y 向下）。天空：上面淡、地平線偏暖
    float hz = win.y + (win.w - win.y) * 0.56;
    vec3 sky = mix(mix(C_PAPER, C_BONE, 0.4) * 0.86, mix(C_PAPER, C_SIGNAL, 0.22) * 0.9, smoothstep(win.y - 100.0, hz, q.y));
    float cl = fbm(vec2((q.x + t * 14.0) / 520.0, q.y / 170.0) + seedOff, 4);
    sky = mix(sky, C_BONE * 0.88, 0.35 * smoothstep(0.1, 0.55, cl) * smoothstep(hz, win.y, q.y));
    vec3 col = sky;
    // 遠山（很慢、很淡）
    float x1 = q.x + t * 26.0;
    float m1 = hz - 30.0 - 90.0 * (0.5 + 0.5 * ridge(x1, 700.0, seedOff + 1.0));
    col = mix(col, mix(sky, C_SEPIA, 0.2), smoothstep(m1 - 1.5, m1 + 1.5, q.y));
    // 丘陵＋田（中景）
    float x2 = q.x + t * 120.0;
    float m2 = hz + 10.0 - 70.0 * (0.5 + 0.5 * ridge(x2, 420.0, seedOff + 5.0));
    vec3 hill = mix(mix(C_PAPER, C_GINGHAM, 0.55) * 0.78, sky, 0.25);
    hill *= 0.94 + 0.06 * step(0.5, fract(x2 / 180.0 + q.y / 60.0));
    col = mix(col, hill, smoothstep(m2 - 1.5, m2 + 1.5, q.y));
    // 樹林（近景，快、糊）：一團一團的樹冠
    float x3 = q.x + t * 520.0;
    float crown = 46.0 * (0.5 + 0.5 * snoise(vec2(x3 / 70.0, seedOff))) + 34.0 * (0.5 + 0.5 * ridge(x3, 300.0, seedOff + 8.0));
    // 一叢一叢的樹（中間有空隙時只剩矮矮的灌木，不會切出直的邊）
    float gate = smoothstep(-0.35, 0.05, ridge(x3, 700.0, seedOff + 12.0));
    float m3 = hz + 70.0 - crown * gate + 26.0 * (1.0 - gate);
    float treeA = smoothstep(m3 - 6.0, m3 + 6.0, q.y);
    vec3 tc = mix(C_GINGHAM, C_SEPIA, 0.45) * (0.52 + 0.1 * snoise(vec2(x3 / 50.0, q.y / 40.0)) - 0.12 * smoothstep(m3 + 20.0, m3 + 80.0, q.y));
    col = mix(col, tc, treeA);
    // 鐵道邊的草（最近、最快、橫的拖影）
    float g0 = win.w - 70.0 + 10.0 * snoise(vec2((q.x + t * 1500.0) / 300.0, 2.0));
    float grass = smoothstep(g0 - 10.0, g0 + 10.0, q.y);
    vec3 gc = mix(C_PAPER, C_GINGHAM, 0.6) * (0.62 + 0.08 * snoise(vec2((q.x + t * 1500.0) / 160.0, q.y / 4.0)));
    col = mix(col, gc, grass);
    // 電線（兩條），在兩根桿子之間垂下來
    float u = fract((q.x - pole.x) / pole.y);
    float sag = 34.0 * (1.0 - pow(2.0 * u - 1.0, 2.0));
    for (int i = 0; i < 2; i++) {
      float wy = win.y + 46.0 + float(i) * 16.0 + sag;
      col = mix(col, C_SEPIA * 0.5, 0.55 * (1.0 - smoothstep(0.6, 1.8, abs(q.y - wy))));
    }
    // 電線桿：很快刷過去（糊成一道寬的影子）
    float pd = abs(q.x - pole.x);
    col = mix(col, C_SEPIA * 0.35, 0.75 * (1.0 - smoothstep(10.0, 46.0, pd)) * step(win.y - 20.0, q.y));
    // 隧道：一片黑，燈一盞一盞刷過
    vec3 tunnel = C_INK2 * 1.3 + C_EMBER * 0.5 * exp(-pow(abs(fract((q.x + t * 2600.0) / 640.0) - 0.5) * 640.0 / 30.0, 2.0)) * exp(-abs(q.y - win.y - 120.0) / 30.0);
    return mix(col, tunnel, tun);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 車廂（跟著晃）的座標
    vec2 w = p - bob;
    vec2 wc = vec2((win.x + win.z) * 0.5, (win.y + win.w) * 0.5);
    vec2 wh = vec2((win.z - win.x) * 0.5, (win.w - win.y) * 0.5);
    // 車廂裡的光：出隧道後亮起來；窗外的桿子經過時影子掃過
    float inLight = mix(0.62, 1.0, day);
    // 牆板：奶油色，窗子下面一段比較深，一條細的分隔線
    vec3 wall = mix(C_PAPER, C_BONE, 0.3) * 0.9 * (0.97 + 0.03 * snoise(w / 300.0));
    wall *= 1.0 - 0.05 * smoothstep(0.0, ${W}.0, w.x);
    wall = mix(wall, mix(C_PAPER, C_ASH, 0.3) * 0.82, smoothstep(${H - 200}.0, ${H - 196}.0, w.y));
    // 從窗子照進來的光斑（在窗子右下方的牆與桌上）
    vec2 sq = w - wc - vec2(260.0, 300.0);
    float patch_ = 1.0 - smoothstep(-30.0, 30.0, rbox(sq, wh * vec2(0.9, 0.6), 40.0));
    patch_ *= smoothstep(win.w - 10.0, win.w + 30.0, w.y) * day;
    float poleSh = 1.0 - smoothstep(30.0, 90.0, abs(w.x - pole.x - 260.0));
    wall *= 1.0 + 0.1 * patch_ * (1.0 - 0.8 * poleSh);
    vec3 col = wall;
    // 說明字塊左邊的一條細線（牆板上的分隔，跟字一起淡入）
    col = mix(col, C_SEPIA, rule.w * 0.5 * (1.0 - smoothstep(0.5, 1.4, abs(w.x - rule.x))) * step(rule.y, w.y) * step(w.y, rule.z));
    // 窗框：圓角、斜面
    float dW = rbox(w - wc, wh + vec2(34.0), 52.0);
    float dG = rbox(w - wc, wh, 30.0);
    col *= 1.0 - 0.22 * shadowAt(dW - 4.0, 18.0) * step(0.0, dW);
    if (dW < 0.0) {
      vec3 fr = mix(C_PAPER, C_ASH, 0.5) * 0.84;
      fr *= 1.0 + 0.14 * smoothstep(-34.0, -20.0, dW) - 0.1 * smoothstep(-3.0, 0.0, dW);
      // 玻璃邊一圈深色的橡膠條
      fr = mix(fr, C_SEPIA * 0.45, 1.0 - smoothstep(4.0, 7.0, dG));
      col = mix(col, fr, 1.0 - smoothstep(-0.8, 0.8, dW));
    }
    if (dG < 0.0) {
      vec3 o = outside(w + bob * 0.4);
      // 玻璃：很淡的斜反光、邊緣暗一點
      o += C_BONE * 0.035 * smoothstep(0.35, 0.0, abs(fract((w.x - w.y * 0.7) / 900.0) - 0.5));
      o *= 1.0 - 0.12 * smoothstep(-40.0, 0.0, dG);
      col = mix(col, o, 1.0 - smoothstep(-0.8, 0.8, dG));
    }
    // 桌子：木頭桌面（看得到一點點頂面）＋前緣
    float tTop = win.w + 2.0, tFront = tTop + 32.0, tBot = tFront + 22.0;
    float tx0 = win.x - 60.0, tx1 = win.z + 60.0;
    if (w.x > tx0 && w.x < tx1 && w.y > tTop - 1.0 && w.y < tBot + 40.0) {
      if (w.y < tFront) {
        vec3 wood = mix(C_FUR, C_SEPIA, 0.35) * 0.62 * (0.92 + 0.08 * sin(w.x * 0.02 + snoise(vec2(w.x / 200.0, w.y / 3.0)) * 3.0));
        wood *= 0.92 + 0.12 * (w.y - tTop) / 32.0;
        wood *= 1.0 + 0.12 * patch_;
        col = wood;
      } else if (w.y < tBot) col = mix(C_FUR, C_SEPIA, 0.45) * 0.42;
      else col *= 1.0 - 0.35 * (1.0 - smoothstep(tBot, tBot + 40.0, w.y));
    }
    // 外帶咖啡杯（桌上，相片右邊）
    if (cupX > 0.0) {
      vec2 cq = w - vec2(cupX, tTop + 18.0);
      float yy = -cq.y;
      float rw = mix(40.0, 48.0, clamp(yy / 140.0, 0.0, 1.0));
      float dCup = max(abs(cq.x) - rw, max(cq.y, -cq.y - 140.0));
      col *= 1.0 - 0.3 * shadowAt(length(vec2(cq.x - 24.0, cq.y * 3.0)) - 50.0, 14.0) * step(-4.0, cq.y);
      if (dCup < 1.0) {
        float n = cq.x / rw;
        vec3 cup = C_BONE * 0.86 * (0.72 + 0.28 * sqrt(max(0.0, 1.0 - n * n)) - 0.08 * n);
        if (yy > 45.0 && yy < 95.0) cup = mix(C_FUR, C_PAPER, 0.3) * 0.75 * (0.72 + 0.28 * sqrt(max(0.0, 1.0 - n * n)) - 0.08 * n);
        if (yy > 128.0) cup = mix(C_SEPIA, C_PAPER, 0.3) * 0.7;
        col = mix(col, cup, 1.0 - smoothstep(-0.8, 0.8, dCup));
      }
    }
    // 相片：立在桌上靠著玻璃（腳下一道接觸影）
    vec2 outer = hs + vec2(bd);
    vec2 q = rot2(ang) * (w - pc);
    col *= 1.0 - 0.45 * exp(-max(sdBox(q - vec2(10.0, outer.y + 4.0), vec2(outer.x, 3.0)), 0.0) / 7.0);
    col *= 1.0 - 0.18 * shadowAt(sdBox(q - vec2(-14.0, -6.0), outer), 22.0);
    vec4 pr = printAt(q, hs, bd, C_BONE * 0.9);
    col = mix(col, pr.rgb * (0.94 + 0.06 * day), pr.a);
    // 窗簾：窗子左邊束起來，在前景（比較糊），直的褶子
    float cx0 = win.x - 70.0, cwid = 150.0;
    float cu = (w.x - cx0) / cwid;
    float tie = win.y + (win.w - win.y) * 0.62;
    float bulge = 1.0 - 0.45 * exp(-pow((w.y - tie) / 26.0, 2.0));
    float cd = abs(cu - 0.5) * 2.0 - bulge;
    if (w.y < win.w + 6.0 && cd < 0.2) {
      vec3 cur = mix(C_PAPER, C_GINGHAM, 0.5) * 0.78;
      cur *= 0.82 + 0.18 * sin(cu * 6.2831853 * 3.0 + w.y * 0.002);
      cur *= 1.0 - 0.3 * exp(-pow((w.y - tie) / 12.0, 2.0));
      col = mix(col, cur * inLight, 1.0 - smoothstep(-0.12, 0.12, cd));
    }
    fragColor = vec4(col * inLight * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, t: { value: 0 }, k: { value: 1 }, bob: { value: new THREE.Vector2() }, day: { value: 1 }, tun: { value: 0 },
  win: { value: new THREE.Vector4() }, pc: { value: new THREE.Vector2() }, hs: { value: new THREE.Vector2() }, bd: { value: 18 }, ang: { value: 0 },
  pole: { value: new THREE.Vector2() }, cupX: { value: 0 }, seedOff: { value: 0 }, rule: { value: new THREE.Vector4() },
});

/** 牆板上的字塊：寬、高上限（相簿名＋主字＋署名＋歌詞）。60 字的留言在 40 px 排得進四行；右緣在 1814，離畫面右邊 ≥ 96 px。 */
const COL_W = 600, COL_H = 450;

export default class TrainWindow extends JourneyPlate {
  bg = shared('trainwindow.bg', BG);
  text = this.track(new Layer2D(COL_W + 40, COL_H + 60, undefined, { fast: true }));
  win: [number, number, number, number] = [0, 0, 0, 0];
  pcx = 0; pcy = 0; hw = 0; hh = 0; bd = 18; ang = 0;
  cupX = 0;
  colX = 0; colY = 0;
  /** 出隧道的時間（第一拍）。 */
  tOut = 0;

  override async init() {
    await this.loadPhoto();
    const { start, audio } = this.ctx;
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.ming(700), lineHeight: 1.45,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.4), sigInk: rgba('sepia', 0.72), sigFamily: F.ming(500),
      label: { family: F.hei(500), size: 21, color: rgba('sepia', 0.55), tracking: 6, gap: 26 },
    });
    // 有字時窗子靠左、讓出牆板給字（右緣 1110 + 窗框＋留白，字從 1214 開始）
    this.win = this.hasText ? [100, 120, 1110, 770] : [250, 120, 1670, 770];
    const { w, h } = this.img!;
    const s = this.fitScale(this.hasText ? 620 : 740, 540);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bd = clamp(0.035 * Math.min(w * s, h * s), 12, 22);
    const wcx = (this.win[0] + this.win[2]) / 2;
    this.pcx = wcx - 70 + (hash(this.seed, 2) - 0.5) * 40;
    this.pcy = this.win[3] + 14 - this.hh - this.bd;
    this.ang = (hash(this.seed, 4) * 2 - 1) * 1.2 * (Math.PI / 180);
    const right = this.pcx + this.hw + this.bd;
    this.cupX = right + 130 < this.win[2] - 20 ? right + 120 : 0;
    this.colX = this.win[2] + 34 + 70;
    const bh = this.blockH();
    this.colY = clamp(445 - bh / 2, 140, 785 - bh);
    // 出隧道：窗格開始後的第一拍（太晚就在 0.5 秒）
    this.tOut = Math.min(beatAfter(audio, start + 0.15), start + 0.55);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    // 車廂晃：很慢的上下＋大鼓時跳一下（鐵軌接縫）
    const by = 1.6 * Math.sin(t * 7.1) + 0.8 * Math.sin(t * 3.3 + 1) - 3.5 * f.a.kick;
    const bx = 1.0 * Math.sin(t * 1.9);
    (u.bob!.value as THREE.Vector2).set(bx, by);
    const day = ease.outCubic(prog(t, this.tOut - 0.05, this.tOut + 0.35));
    u.day!.value = day;
    u.tun!.value = 1 - prog(t, this.tOut - 0.08, this.tOut + 0.05);
    (u.win!.value as THREE.Vector4).set(...this.win);
    u.t!.value = t;
    // 出隧道之後相片上的畫面往焦點推（隧道裡看不清楚，推了也白推）
    this.setPhoto(u, 2 * this.hw, this.focusK(t, this.tOut), 1.18);
    (u.pc!.value as THREE.Vector2).set(this.pcx, this.pcy);
    (u.hs!.value as THREE.Vector2).set(this.hw, this.hh);
    u.bd!.value = this.bd;
    u.ang!.value = this.ang;
    u.cupX!.value = this.cupX;
    u.seedOff!.value = hash(this.seed, 9) * 30;
    // 電線桿：小節線時正好在窗子中間（從右往左刷過去）
    const bar = audio.barAt(t);
    const ph = bar - Math.round(bar);
    const span = this.win[2] - this.win[0] + 600;
    const wcx = (this.win[0] + this.win[2]) / 2;
    (u.pole!.value as THREE.Vector2).set(wcx - ph * span * 2.2, span * 2.2);
    // 出隧道那一下稍微過曝，再回來
    // 字塊左邊的細線：從上往下畫出來
    const bh = this.blockH() + 12;
    const rk = this.hasText ? ease.outCubic(prog(t, this.tOut, this.tOut + 0.6)) : 0;
    (u.rule!.value as THREE.Vector4).set(this.colX - 34, this.colY + 4, this.colY + 4 + bh * rk, rk);
    u.k!.value = (1 + 0.12 * Math.exp(-Math.max(0, t - this.tOut) * 3) * (t > this.tOut ? 1 : 0)) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.hasText) {
      this.paintBlock(this.text, t, 30, 20);
      const op = prog(t, this.tOut + 0.1, this.tOut + 0.7, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      if (op > 0) blit(comp, renderer, this.text, out, this.colX - 30 + bx, this.colY - 20 + by, { opacity: op });
    }
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.06, vignette: 0.34 };
  }
}
