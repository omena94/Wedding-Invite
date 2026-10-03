// 照片版面「行李箱」（亮）：從上往下看一只打開的復古行李箱，放在亞麻床罩上，窗光從左上斜斜照進來——
//  - 箱子裡是摺好的毛衣、條紋襯衫、一捲圍巾；照片（實體相片，白邊）放在衣服最上面。切進來時照片「落」進箱子（影子從遠、淡收到貼近），
//    之後鏡頭很慢地推近，窗框的影子很慢地在床罩上移動。
//  - 照片完整呈現（實體相片不裁切）；很小的舊照片最多放大到原尺寸 1.5 倍。落定之後相片上的畫面慢慢往新人點的臉推（focusCrop）。
//  - 主字（賓客留言＋署名，或新人的註解）手寫在箱子旁邊的牛皮紙行李吊牌上（霞鶩文楷、墨色，寫在吊牌印好的橫線上），
//    照片落定後一個字一個字寫出來；相簿的第一張在吊牌上方多一行相簿名。吊牌用棉繩綁在箱子的扣環上，每個小節輕輕晃一下
//    （字跟著吊牌一起轉，畫在吊牌上）。吊牌放不下主字＋歌詞：有主字時歌詞（lyricsApart）像字幕一樣印在吊牌下面的床罩上，位置固定；
//    沒有主字時歌詞自己寫在吊牌上跟唱；兩個都沒有就沒有吊牌，箱子移到正中間。
// 畫法：床罩、箱子、衣服、相片、吊牌與繩子都在一個全螢幕 shader 裡；吊牌上的字是一張 Canvas2D 層，shader 照吊牌的角度取樣；
// 吊牌下面的歌詞是另一張層，直接貼到畫面上。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, springStep } from '../engine/util';
import { beatAfter } from './_motifs';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'journey', prefers: ['portrait', 'square', 'small'], energy: [0, 1], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform sampler2D textTex; uniform vec2 textSize;
  uniform vec2 zc; uniform float zoom; uniform float t; uniform float k;
  uniform vec2 caseC; uniform vec2 caseH; uniform float caseAng;
  uniform vec2 pc; uniform vec2 hs; uniform float bd; uniform float ang; uniform float lift;
  uniform float tagOn; uniform vec2 hole; uniform float tagAng; uniform vec2 tagSize; uniform vec2 textOrigin;
  uniform vec3 rules; uniform vec2 str[7]; uniform vec2 shade;

  float rbox(vec2 p, vec2 b, float r) { return sdBox(p, b - vec2(r)) - r; }
  float segs(vec2 p) {
    float d = 1e9;
    for (int i = 0; i < 6; i++) d = min(d, sdSegment(p, str[i], str[i + 1]));
    return d;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w = zc + (p - zc) / zoom;
    // ---- 床罩：亞麻（細細的織紋＋大片很軟的皺褶），窗光從左上來，窗框的影子很慢地移動
    float wr = snoise(vec2(w.x / 420.0, w.y / 160.0) + 3.0) * 0.6 + snoise(w / 230.0 - 9.0) * 0.4;
    float weave = sin(w.x * 1.7) * sin(w.y * 1.7);
    vec3 bed = mix(C_PAPER, C_BONE, 0.25) * (0.9 + 0.045 * wr + 0.012 * weave);
    float light = 0.9 + 0.12 * smoothstep(1500.0, 0.0, dot(w, vec2(0.6, 0.8)));
    vec2 wq = w - vec2(shade.x, 0.0);
    // 窗框（直的、橫的窗櫺）投在床上的影子：寬、邊緣很軟
    float frameSh = smoothstep(46.0, 18.0, abs(fract((wq.x * 0.86 + wq.y * 0.5) / 900.0) - 0.5) * 900.0)
                  + smoothstep(40.0, 14.0, abs(fract((wq.y * 0.86 - wq.x * 0.5) / 700.0) - 0.5) * 700.0);
    light *= 1.0 - shade.y * 0.1 * min(frameSh, 1.0);
    vec3 col = bed;

    // ---- 箱子的影子（往右下，很軟）
    vec2 cq = rot2(caseAng) * (w - caseC);
    float dOut = rbox(cq, caseH, 48.0);
    col *= 1.0 - 0.32 * shadowAt(rbox(rot2(caseAng) * (w - caseC - vec2(16.0, 26.0)), caseH, 48.0), 34.0);
    // 箱蓋：打開平放在箱子後面（畫面上方），只露出一截，比較近鏡頭所以糊一點
    vec2 lq = cq - vec2(0.0, -2.0 * caseH.y - 14.0);
    float dLid = rbox(lq, caseH, 48.0);
    if (dLid < 2.0) {
      float aL = 1.0 - smoothstep(-9.0, 9.0, dLid);
      vec3 lid = mix(C_FUR, C_SEPIA, 0.32) * 0.8;
      float inL = rbox(lq, caseH - vec2(34.0), 22.0);
      vec3 lin = mix(C_PAPER, C_FUR, 0.22) * (0.8 + 0.08 * smoothstep(-60.0, 0.0, inL));
      // 箱蓋內側的拉鍊口袋（一條斜斜的縫線），糊的
      lin *= 1.0 - 0.08 * exp(-abs(lq.y + caseH.y * 0.35) / 10.0);
      lid = mix(lid, lin, smoothstep(9.0, -9.0, inL));
      col = mix(col, lid, aL);
    }
    float aCase = 1.0 - smoothstep(-0.8, 0.8, dOut);
    if (aCase > 0.0) {
      // 外殼：牛皮色的皮革、外緣一圈深色滾邊、內緣斜面亮一點；四個角有黃銅護角
      float grain = snoise(cq / 3.5) * 0.5 + snoise(cq / 40.0) * 0.5;
      vec3 shell = mix(C_FUR, C_SEPIA, 0.32) * (0.8 + 0.05 * grain);
      shell = mix(shell, C_SEPIA * 0.7, smoothstep(-7.0, -4.0, dOut));
      float dIn = rbox(cq, caseH - vec2(34.0), 24.0);
      shell *= 1.0 + 0.16 * smoothstep(-12.0, 0.0, dIn) * step(dIn, 0.0) + 0.1 * smoothstep(-22.0, -2.0, dOut);
      vec2 cc = abs(cq) - (caseH - vec2(64.0));
      if (cc.x > 0.0 && cc.y > 0.0 && dIn > 0.0) {
        vec3 brass = C_FUR * vec3(1.0, 0.93, 0.62) * (0.62 + 0.5 * smoothstep(10.0, 50.0, cc.x + cc.y));
        shell = mix(shell, brass, 0.9);
      }
      vec3 c2 = shell;
      if (dIn < 0.5) {
        // 裡面：條紋襯布，靠近箱邊的地方比較暗（箱壁擋光）
        vec3 lining = mix(C_PAPER, C_FUR, 0.2) * (0.86 + 0.04 * step(0.5, fract(cq.x / 26.0)));
        lining *= 1.0 - 0.38 * exp(dIn / 26.0);
        vec3 cl = lining;
        // 毛衣（左邊，大塊）：直的羅紋、邊緣蓬起來比較暗
        vec2 sw = cq - vec2(-caseH.x * 0.36, 0.0);
        float dS = rbox(sw, vec2(caseH.x * 0.54, caseH.y - 70.0), 40.0);
        cl *= 1.0 - 0.3 * shadowAt(dS - 10.0, 16.0);
        if (dS < 0.0) {
          vec3 knit = mix(C_PAPER, C_GINGHAM, 0.5) * 0.86;
          knit *= 0.9 + 0.1 * (0.5 + 0.5 * sin(sw.x * 0.55)) + 0.03 * snoise(sw / 6.0);
          knit *= 1.0 - 0.25 * exp(dS / 22.0);
          // 摺線：中間一道橫的
          knit *= 1.0 - 0.1 * exp(-abs(sw.y - 20.0) / 10.0);
          cl = mix(cl, knit, 1.0 - smoothstep(-1.0, 1.0, dS));
        }
        // 條紋襯衫（右邊，疊在毛衣上）
        vec2 sh = cq - vec2(caseH.x * 0.33, -50.0);
        float dH = rbox(sh, vec2(caseH.x * 0.5, caseH.y - 150.0), 18.0);
        cl *= 1.0 - 0.28 * shadowAt(dH - 6.0, 14.0);
        if (dH < 0.0) {
          vec3 shirt = C_BONE * 0.86;
          shirt = mix(shirt, C_SEPIA, 0.16 * (1.0 - smoothstep(0.7, 1.7, abs(fract(sh.x / 15.0) - 0.5) * 15.0)));
          shirt *= 1.0 - 0.12 * exp(dH / 14.0);
          shirt *= 1.0 - 0.08 * exp(-abs(sh.x) / 6.0);
          cl = mix(cl, shirt, 1.0 - smoothstep(-1.0, 1.0, dH));
        }
        // 一捲圍巾（下面，橫放）：圓柱的明暗、斜紋
        vec2 sc = cq - vec2(caseH.x * 0.2, caseH.y - 112.0);
        float dC = sdSegment(sc, vec2(-caseH.x * 0.45, 0.0), vec2(caseH.x * 0.62, 0.0)) - 46.0;
        cl *= 1.0 - 0.3 * shadowAt(dC - 8.0, 14.0);
        if (dC < 0.0) {
          float n = clamp(sc.y / 46.0, -1.0, 1.0);
          vec3 scarf = mix(C_COLLAR, C_PAPER, 0.4) * 0.78;
          scarf = mix(scarf, C_BONE * 0.78, 0.32 * smoothstep(0.42, 0.58, abs(fract((sc.x + sc.y * 0.6) / 34.0) - 0.5) * 2.0));
          scarf *= 0.55 + 0.45 * sqrt(1.0 - n * n) - 0.1 * n;
          cl = mix(cl, scarf, 1.0 - smoothstep(-1.0, 1.0, dC));
        }
        c2 = mix(shell, cl, 1.0 - smoothstep(-0.5, 0.5, dIn));
      }
      col = mix(col, c2, aCase);
    }

    // ---- 相片：落下來的時候影子遠、淡、糊，落定之後貼近
    vec2 outer = hs + vec2(bd);
    vec2 so = vec2(8.0, 14.0) * (1.0 + 3.0 * lift);
    float ds = sdBox(rot2(ang) * (w - pc - so), outer);
    col *= 1.0 - (0.34 / (1.0 + 1.2 * lift)) * shadowAt(ds, 12.0 + 30.0 * lift);
    vec4 pr = printAt(rot2(ang) * (w - pc), hs, bd, C_BONE * 0.9);
    col = mix(col, pr.rgb, pr.a);

    // ---- 吊牌與棉繩
    if (tagOn > 0.5) {
      float dsS = segs(w - vec2(5.0, 8.0));
      col *= 1.0 - 0.25 * exp(-max(dsS - 2.0, 0.0) / 5.0);
      vec2 tq = rot2(tagAng) * (w - hole);
      vec2 tc = vec2(0.0, (tagSize.y - 70.0) * 0.5);
      float dB = sdBox(tq - tc, vec2(tagSize.x * 0.5, (tagSize.y + 70.0) * 0.5));
      float dCh = ((abs(tq.x) - tq.y) - (tagSize.x * 0.5 + 10.0)) * 0.7071;
      float dT = max(dB, dCh);
      vec2 tqs = rot2(tagAng) * (w - hole - vec2(7.0, 11.0));
      float dTs = max(sdBox(tqs - tc, vec2(tagSize.x * 0.5, (tagSize.y + 70.0) * 0.5)), ((abs(tqs.x) - tqs.y) - (tagSize.x * 0.5 + 10.0)) * 0.7071);
      col *= 1.0 - 0.3 * shadowAt(dTs, 9.0);
      float aT = 1.0 - smoothstep(-0.8, 0.8, dT);
      if (aT > 0.0) {
        float fib = snoise(vec2(tq.x / 2.5, tq.y / 60.0)) * 0.5 + snoise(tq / 30.0) * 0.5;
        vec3 kraft = mix(C_FUR, C_PAPER, 0.5) * (0.9 + 0.035 * fib);
        kraft *= 1.0 - 0.08 * smoothstep(-3.0, 0.0, dT);
        // 印好的橫線（寫字用）
        if (rules.z > 0.0 && abs(tq.x) < tagSize.x * 0.5 - 34.0) {
          float ry = tq.y - rules.x;
          float ri = floor(ry / rules.y + 0.5);
          if (ri >= 0.0 && ri < rules.z) kraft = mix(kraft, C_SEPIA, 0.22 * (1.0 - smoothstep(0.4, 1.3, abs(ry - ri * rules.y))));
        }
        // 補強圈＋孔
        float rh = length(tq);
        kraft = mix(kraft, mix(C_FUR, C_SEPIA, 0.3) * 0.8, 1.0 - smoothstep(29.0, 30.5, rh));
        vec4 tx = layerAt(textTex, (tq - textOrigin) / textSize);
        kraft = kraft * (1.0 - tx.a) + tx.rgb;
        vec3 holeCol = col * 0.55;
        kraft = mix(kraft, holeCol, 1.0 - smoothstep(12.0, 13.5, rh));
        col = mix(col, kraft, aT);
      }
      float dsT = segs(w);
      float aS = 1.0 - smoothstep(1.6, 2.8, dsT);
      col = mix(col, C_BONE * 0.84 * (0.85 + 0.15 * sin(dot(w, vec2(0.7, 0.7)) * 1.6)), aS);
    }
    fragColor = vec4(col * light * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, textTex: { value: null }, textSize: { value: new THREE.Vector2(1, 1) },
  zc: { value: new THREE.Vector2() }, zoom: { value: 1 }, t: { value: 0 }, k: { value: 1 },
  caseC: { value: new THREE.Vector2() }, caseH: { value: new THREE.Vector2() }, caseAng: { value: 0 },
  pc: { value: new THREE.Vector2() }, hs: { value: new THREE.Vector2() }, bd: { value: 20 }, ang: { value: 0 }, lift: { value: 0 },
  tagOn: { value: 0 }, hole: { value: new THREE.Vector2() }, tagAng: { value: 0 }, tagSize: { value: new THREE.Vector2() }, textOrigin: { value: new THREE.Vector2() },
  rules: { value: new THREE.Vector3() }, str: { value: Array.from({ length: 7 }, () => new THREE.Vector2()) }, shade: { value: new THREE.Vector2() },
});

/**
 * 吊牌上的字塊：寬、高上限（相簿名＋主字＋署名；歌詞在吊牌下面另外放）。60 字的留言在 40 px 排五行。
 * 吊牌加歌詞最低到 y ≈ 800（吊牌在畫面右邊，再低就進 HUD 區）。
 */
const COL_W = 480, COL_H = 410;
/** 吊牌：字塊左右的邊距、孔到第一行字的距離、最後一行到底的距離。 */
const PAD_X = 46, TOP = 74, BOTTOM = 58;
/** 吊牌下面的歌詞（lyricsApart）：離吊牌底多遠、最後一排基線最低到哪裡（HUD 區 y ≥ 830 的上面）。 */
const LYR_GAP = 40, LYR_BASE = 800;

export default class Luggage extends JourneyPlate {
  bg = shared('luggage.bg', BG);
  text = this.track(new Layer2D(COL_W + 20, COL_H + 40, undefined, { fast: true }));
  /** 吊牌下面的歌詞（有主字時）。 */
  lyr = this.track(new Layer2D(COL_W + 40, 150, undefined, { fast: true }));
  caseX = 0; caseY = 0; caseHX = 0; caseHY = 0; caseAng = 0;
  pcx = 0; pcy = 0; hw = 0; hh = 0; bd = 20; ang = 0;
  holeX = 0; holeY = 0; tagW = 0; tagH = 0; tagAng0 = 0;
  ringX = 0; ringY = 0;
  /** 吊牌下面歌詞第一排的頂（畫面座標）。 */
  lyrY = 0;
  tLand = 0;

  override async init() {
    await this.loadPhoto();
    const { start } = this.ctx;
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.hand(400), lineHeight: 1.4, maxLines: 5, lyricsApart: true,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.45), sigInk: rgba('sepia', 0.72),
      label: { family: F.hand(700), size: 24, color: rgba('sepia', 0.62), tracking: 4, gap: 26 },
    });
    const { w, h } = this.img!;
    this.caseAng = (hash(this.seed, 3) * 2 - 1) * 2.2 * (Math.PI / 180);
    if (this.hasText) { this.caseX = 660; this.caseY = 575; this.caseHX = 570; this.caseHY = 425; }
    else { this.caseX = 935; this.caseY = 560; this.caseHX = 680; this.caseHY = 430; }
    const s = this.hasText ? this.fitScale(780, 600) : this.fitScale(940, 640);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bd = clamp(0.04 * Math.min(w * s, h * s), 14, 26);
    this.pcx = this.caseX + (hash(this.seed, 5) - 0.5) * 40;
    this.pcy = this.caseY - 18;
    this.ang = (hash(this.seed, 7) * 2 - 1) * 3.0 * (Math.PI / 180);
    // 吊牌：箱子右邊，孔在上面；長度跟著字塊（只有歌詞時照最長的那句預留，換句子吊牌不會變長變短）
    const bh = Math.max(this.blockH(), this.hasMain ? 0 : 120);
    this.tagW = COL_W + 2 * PAD_X;
    this.tagH = TOP + bh + BOTTOM;
    // 有歌詞在吊牌下面：吊牌往上挪，歌詞的最後一排才在 HUD 上面
    const below = this.apart ? LYR_GAP + this.words!.lyricH : 0;
    this.holeX = 1532; this.holeY = clamp(470 - (this.tagH + below) / 2, 140, Math.max(140, Math.min(300, LYR_BASE - below - this.tagH)));
    this.lyrY = this.holeY + this.tagH + LYR_GAP;
    this.tagAng0 = (hash(this.seed, 9) * 2 - 1) * 3.5 * (Math.PI / 180) - 2 * (Math.PI / 180);
    // 吊牌綁在箱子右上角的扣環上
    const c = Math.cos(this.caseAng), sn = Math.sin(this.caseAng);
    const rx = this.caseHX - 70, ry = -this.caseHY + 20;
    this.ringX = this.caseX + c * rx + sn * ry; this.ringY = this.caseY - sn * rx + c * ry;
    this.tLand = start + 0.7;
    void w; void h;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    // 照片落進箱子：從上面一點點、大一點、斜一點落下來，影子收緊
    const drop = ease.outCubic(prog(t, s + 0.05, this.tLand));
    const bounce = 0.006 * Math.sin(clamp((t - this.tLand) / 0.35) * Math.PI) * (t > this.tLand ? 1 : 0);
    const zoom = (1 + 0.04 * (1 - Math.exp(-lt / 7))) * (1 + bounce);
    const u = this.bg.u;
    u.textTex!.value = this.text.texture;
    (u.textSize!.value as THREE.Vector2).set(this.text.w, this.text.h);
    const zx = this.hasText ? lerp(this.pcx, this.holeX, 0.3) : this.pcx;
    (u.zc!.value as THREE.Vector2).set(zx, this.pcy);
    u.zoom!.value = zoom;
    u.t!.value = t;
    (u.caseC!.value as THREE.Vector2).set(this.caseX, this.caseY);
    (u.caseH!.value as THREE.Vector2).set(this.caseHX, this.caseHY);
    u.caseAng!.value = this.caseAng;
    const sc = 1 + 0.1 * (1 - drop);
    (u.pc!.value as THREE.Vector2).set(this.pcx - 30 * (1 - drop), this.pcy - 40 * (1 - drop));
    (u.hs!.value as THREE.Vector2).set(this.hw * sc, this.hh * sc);
    u.bd!.value = this.bd * sc;
    u.ang!.value = this.ang + 5 * (1 - drop) * (Math.PI / 180);
    u.lift!.value = 1 - drop;
    // 落定之後相片上的畫面往焦點推（實體相片：推到 1.18 倍，還看得出是一整張照片）
    this.setPhoto(u, 2 * this.hw * sc * zoom, this.focusK(t, this.tLand - 0.2), 1.18);
    // 窗框的影子很慢地移過床罩
    (u.shade!.value as THREE.Vector2).set(-120 + 60 * ease.inOutQuad(clamp(lt / 14)), 1);
    u.tagOn!.value = this.hasText ? 1 : 0;
    if (this.hasText) {
      // 吊牌：切進來時從旁邊甩進來，之後每個小節被繩子帶一下
      const swingIn = springStep(Math.max(0, t - s), 0.9, 0.32);
      let a = this.tagAng0 + (1 - swingIn) * -14 * (Math.PI / 180);
      const b0 = beatAfter(audio, s + 0.8);
      const bar = audio.timeOfBar(Math.floor(audio.barAt(t) + 1e-6));
      if (bar >= b0 && t >= bar) a += 1.4 * (Math.PI / 180) * Math.exp(-(t - bar) * 2.6) * Math.sin((t - bar) * 9);
      u.tagAng!.value = a;
      (u.hole!.value as THREE.Vector2).set(this.holeX, this.holeY);
      (u.tagSize!.value as THREE.Vector2).set(this.tagW, this.tagH);
      (u.textOrigin!.value as THREE.Vector2).set(-this.tagW / 2 + PAD_X - 10, TOP - 30);
      // 印好的橫線對齊主字每一行的基線（署名寫在橫線下面的空白）；歌詞每句行數不一定（還可能有原文副行），不畫橫線免得劃過字
      const fit = this.words!.fit;
      const first = fit ? TOP - 30 + 10 + this.labelH() + fit.size * 0.9 + 6 : 0;
      (u.rules!.value as THREE.Vector3).set(first, fit ? fit.lineHeight : 1, fit ? fit.lines.length : 0);
      // 棉繩：從孔彎到扣環（中間垂一點）
      const ca = Math.cos(a), sa = Math.sin(a);
      // 孔在吊牌座標 (0,0)：就是 hole；繩子從孔往上出去
      const strs = u.str!.value as THREE.Vector2[];
      const hx = this.holeX, hy = this.holeY;
      const mx = (hx + this.ringX) / 2 + 30, my = Math.min(hy, this.ringY) - 70;
      for (let i = 0; i < 7; i++) {
        const q = i / 6;
        strs[i]!.set((1 - q) * (1 - q) * hx + 2 * q * (1 - q) * mx + q * q * this.ringX, (1 - q) * (1 - q) * hy + 2 * q * (1 - q) * my + q * q * this.ringY);
      }
      void ca; void sa;
      const chars = this.charsAt(t, this.tLand + 0.15, 2);
      if (this.apart) this.paintMain(this.text, 10, 10, { chars });
      else this.paintBlock(this.text, t, 10, 10, { chars });
    }
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.apart) {
      // 吊牌下面的歌詞：跟吊牌上的字左緣對齊，吊牌甩進來、照片落定後才出現
      this.paintLyrics(this.lyr, t, 20, 20);
      const op = prog(t, this.tLand, this.tLand + 0.5, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      if (op > 0) blit(comp, renderer, this.lyr, out, this.holeX - this.tagW / 2 + PAD_X - 20, this.lyrY - 20, { opacity: op });
    }
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.1, halation: 0.05, vignette: 0.32 };
  }
}
