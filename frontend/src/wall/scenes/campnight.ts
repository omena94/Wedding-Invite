// 照片版面「露營夜」（暗）：夜裡的營地，照片立在營火旁邊的地上，被火光照著——
//  - 頭上是星空（星星慢慢閃、一條很淡的銀河），遠山與一排松樹的剪影；右邊一頂帳篷從裡面透出暖光，營火在中間。
//  - 切進來時火「燒起來」（火焰長高、火星往上噴、四周被照亮），之後火焰一直跳動；大鼓時火旺一下、拍點噴一小撮火星。
//    營火上方一縷很淡的煙往左飄；畫面最下面一排前景的草（糊的剪影）。鏡頭很慢地往照片推近。
//  - 照片是實體相片（白邊），立在地上、靠著一塊石頭，完整呈現不裁切；很小的舊照片最多放大到原尺寸 1.5 倍。
//    火光從右邊照過來（右邊亮、暖一點、跟著火閃），但不發光（照片永遠壓在 bloom 門檻下面）。
//    火燒起來之後相片上的畫面慢慢往新人點的臉推（focusCrop）。
//  - 字手寫在右上的夜空裡（霞鶩文楷、紙白，字邊很軟的暗影）：主字（賓客留言＋署名，或新人的註解）一個字一個字寫出來，
//    歌詞小一號在下面跟唱；沒有主字時歌詞寫在同一個位置；兩個都沒有就只有營地與照片（照片移到靠中間）。相簿的第一張在上面多一行相簿名。
// 畫法：星空、樹、帳篷、營火、火星、煙、照片都在一個全螢幕 shader（火是雜訊扭曲的火焰形狀＋熱度色階；火與火光是固定的暖色，
// 不跟主題換：照片版面是實物場景，火在冷色主題變綠、變紫會很怪）；字是一張 Canvas2D 層。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'journey', prefers: ['landscape', 'small'], energy: [0, 0.8], bars: [2, 8], weight: 1 };

/** 地平線（樹的腳）與地面上的東西的「地」線。 */
const HZ = 640, GROUND = 905;
const SPARKS = 28;

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform float t; uniform float k; uniform float seedOff; uniform vec2 zc; uniform float zoom; uniform vec2 drift;
  uniform vec2 fire; uniform float flame; uniform float flick; uniform float burst;
  uniform vec2 pc; uniform vec2 hs; uniform float bd; uniform float ang; uniform vec2 tent; uniform vec4 textRect;

  float fireLight(vec2 p) {
    vec2 d = (p - fire - vec2(0.0, -60.0)) / vec2(1.0, 1.6);
    float q = 1.0 + dot(d, d) / (250.0 * 250.0);
    return flick / (q * q);
  }
  // 松樹的剪影：每 cell 一棵，高度、寬度隨機（看左右鄰居）
  float pines(vec2 p, float base, float cell, float hMin, float hMax, float s) {
    float a = 0.0;
    float i0 = floor(p.x / cell);
    for (int j = -1; j <= 1; j++) {
      float i = i0 + float(j);
      float hx = hash12(vec2(i, s));
      float cx = (i + 0.3 + 0.4 * hash12(vec2(i, s + 3.0))) * cell;
      float hh = mix(hMin, hMax, hx);
      float v = (base - p.y) / hh;
      if (v < 0.0 || v > 1.0) continue;
      float tier = fract(v * 4.0);
      float hw = cell * 0.55 * (1.0 - v) * (0.75 + 0.25 * tier);
      a = max(a, 1.0 - smoothstep(hw - 1.0, hw + 1.0, abs(p.x - cx)));
    }
    return a;
  }

  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = zc + (p0 - zc) / zoom + drift;
    // ---- 夜空：上面最深，地平線一點點亮；銀河、星星
    vec3 col = mix(C_INK * 0.7, mix(C_INK2, C_GRAPHITE, 0.1), smoothstep(100.0, ${HZ}.0, p.y));
    vec2 mw = rot2(0.5) * (p - vec2(900.0, 300.0));
    float band = exp(-pow(mw.y / 220.0, 2.0)) * smoothstep(-0.2, 0.6, fbm(mw / vec2(700.0, 260.0) + seedOff, 3));
    col += mix(C_BONE, C_SIGNAL, 0.15) * 0.022 * band;
    vec2 sg = p / 34.0;
    vec2 cell = floor(sg);
    float sh = hash12(cell + seedOff);
    if (sh > 0.82) {
      vec2 sp = (cell + 0.2 + 0.6 * hash22(cell + 7.0)) * 34.0;
      float b = (sh - 0.82) / 0.18;
      float tw = 0.65 + 0.35 * sin(t * (1.5 + 3.0 * hash12(cell + 2.0)) + sh * 40.0);
      float r = length(p - sp);
      col += mix(C_BONE, C_EMBER, 0.2) * (0.25 + 0.55 * b * b) * tw * exp(-r * r / (1.0 + 1.6 * b)) * smoothstep(${HZ}.0, ${HZ - 140}.0, p.y);
    }
    // 字後面：天空再壓暗一點
    vec2 tq = max(abs(p - textRect.xy - textRect.zw * 0.5) - textRect.zw * 0.5, 0.0);
    col *= 1.0 - 0.35 * exp(-dot(tq, tq) / 8000.0) * step(1.0, textRect.z);
    // ---- 遠山＋松樹
    float ridge = ${HZ - 40}.0 - 60.0 * (0.5 + 0.5 * snoise(vec2(p.x / 600.0, seedOff)));
    col = mix(col, mix(C_INK2, C_GRAPHITE, 0.18), smoothstep(ridge - 1.0, ridge + 1.0, p.y));
    float tr1 = pines(p, ${HZ}.0 + 10.0, 70.0, 120.0, 210.0, seedOff + 1.0);
    col = mix(col, C_INK2 * 0.95, tr1);
    float tr2 = pines(p, ${HZ}.0 + 60.0, 120.0, 200.0, 340.0, seedOff + 5.0) * (smoothstep(560.0, 120.0, p.x) + smoothstep(1500.0, 1900.0, p.x));
    col = mix(col, C_INK * 0.8, clamp(tr2, 0.0, 1.0));
    // ---- 地面（火光照得到的地方暖、有草的紋理）
    float gl = ${HZ}.0 + 30.0 + 10.0 * snoise(vec2(p.x / 300.0, 2.0));
    float fl = fireLight(p);
    // 火光：真的火的固定暖色（照片版面是實物場景，不跟主題換），再混一點紙白
    vec3 warm = mix(fireCol(0.62), C_BONE, 0.15);
    if (p.y > gl) {
      vec3 g = C_INK2 * 0.8 * (0.85 + 0.15 * snoise(vec2(p.x / 6.0, p.y / 2.0)));
      g += warm * 0.09 * fl * (0.8 + 0.2 * snoise(vec2(p.x / 5.0, p.y / 3.0)));
      col = mix(col, g, smoothstep(gl - 1.0, gl + 2.0, p.y));
    }
    // ---- 帳篷：從裡面透出暖光，左邊被火照
    vec2 tq2 = p - tent;
    float tw = 240.0, th = 330.0;
    float v = -tq2.y / th;
    float hwT = tw * (1.0 - v);
    float dT = max(abs(tq2.x) - hwT, max(tq2.y, -tq2.y - th));
    // 拉繩
    float gy = min(sdSegment(p, tent + vec2(0.0, -th), tent + vec2(-tw - 120.0, 6.0)), sdSegment(p, tent + vec2(0.0, -th), tent + vec2(tw + 120.0, 6.0)));
    col = mix(col, mix(C_GRAPHITE, warm, 0.3) * 0.25, 0.6 * (1.0 - smoothstep(0.4, 1.4, gy)));
    if (dT < 1.0) {
      float glow = 0.55 + 0.45 * smoothstep(0.0, 0.8, 1.0 - v);
      vec3 fab = mix(C_INK2, warm, 0.3) * 0.13 * glow;
      fab *= 1.0 - 0.25 * step(0.0, tq2.x) * smoothstep(0.0, 40.0, tq2.x);
      fab += warm * 0.12 * fl * smoothstep(0.0, -tw, tq2.x);
      // 門：中間的倒 V，掀開一點，裡面更亮
      float door = max(abs(tq2.x) - 70.0 * (1.0 - (-tq2.y) / 210.0), -tq2.y - 210.0);
      fab = mix(fab, warm * 0.2 * (0.7 + 0.3 * smoothstep(-210.0, 0.0, tq2.y)), (1.0 - smoothstep(-1.0, 1.0, door)) * 0.85);
      col = mix(col, fab, 1.0 - smoothstep(-0.8, 0.8, dT));
    }
    // ---- 照片：立在地上靠著石頭，火光從右邊來
    vec2 q = rot2(ang) * (p - pc);
    vec2 outer = hs + vec2(bd);
    float dsh = sdBox(q - vec2(-26.0, 10.0), outer);
    col *= 1.0 - 0.45 * shadowAt(dsh, 26.0) * step(gl, p.y + 200.0);
    vec4 pr = printAt(q, hs, bd, C_BONE * 0.9);
    if (pr.a > 0.0) {
      float lit = 0.62 + 0.3 * clamp(fireLight(p) * 1.4, 0.0, 1.0);
      lit *= 0.9 + 0.1 * smoothstep(-outer.x, outer.x, q.x);
      vec3 tint = mix(vec3(1.0), warm / max(luma(warm), 0.05), 0.14);
      col = mix(col, pr.rgb * lit * tint, pr.a);
    }
    // 照片腳邊的石頭
    vec2 rq = (p - vec2(pc.x - outer.x * 0.35, pc.y + outer.y + 4.0)) / vec2(70.0, 34.0);
    float dr = length(rq * vec2(1.0, 1.0 + 0.3 * step(0.0, rq.y))) - 1.0 + 0.04 * snoise(rq * 2.0);
    if (dr < 0.05) {
      vec3 rock = C_GRAPHITE * 0.28 * (0.85 + 0.15 * snoise(rq * 4.0));
      rock += warm * 0.12 * fl * smoothstep(-0.6, 0.8, rq.x - rq.y);
      col = mix(col, rock, 1.0 - smoothstep(-0.03, 0.03, dr));
    }
    // ---- 營火：石頭圍一圈、交叉的木柴、火焰
    vec2 fq = p - fire;
    for (int i = 0; i < 7; i++) {
      float a = float(i) / 7.0 * 6.2831853;
      vec2 sc = fire + vec2(cos(a) * 110.0, sin(a) * 26.0 + 10.0);
      vec2 sq = (p - sc) / vec2(30.0, 18.0);
      float ds = length(sq) - 1.0;
      if (ds < 0.05 && sin(a) > -0.6) {
        vec3 st = C_GRAPHITE * 0.12 + warm * 0.14 * flick * smoothstep(0.6, -0.8, sq.y);
        col = mix(col, st, 1.0 - smoothstep(-0.05, 0.05, ds));
      }
    }
    float logs = min(sdSegment(p, fire + vec2(-95.0, 18.0), fire + vec2(80.0, -16.0)), sdSegment(p, fire + vec2(-80.0, -18.0), fire + vec2(95.0, 14.0))) - 13.0;
    if (logs < 1.0) {
      vec3 lc = mix(C_FUR, C_INK, 0.85) * 0.25 + warm * 0.3 * flick * smoothstep(0.0, -12.0, logs) * smoothstep(-30.0, 10.0, -fq.y);
      col = mix(col, lc, 1.0 - smoothstep(-0.8, 0.8, logs));
    }
    // 火焰：往上收的形狀，用雜訊扭曲、往上流；熱度色階（底部最熱）
    float fh = 230.0 * flame;
    vec2 fu = vec2(fq.x / 95.0, -(fq.y + 6.0) / max(fh, 1.0));
    if (fu.y > -0.15 && fu.y < 1.3 && abs(fu.x) < 1.4 && flame > 0.01) {
      float n = fbm(vec2(fu.x * 2.2, fu.y * 2.5 - t * 3.2) + seedOff, 3);
      float n2 = snoise(vec2(fu.x * 5.0, fu.y * 6.0 - t * 6.0));
      float wv = 0.85 * pow(max(0.0, 1.0 - fu.y), 0.9) * smoothstep(-0.15, 0.12, fu.y);
      float xx = fu.x + 0.3 * n * fu.y + 0.06 * n2;
      float I = smoothstep(wv, wv * 0.2, abs(xx)) * smoothstep(1.25, 0.2, fu.y + 0.25 * n);
      col += fireCol(I * 0.95) * I * 1.7 * (0.9 + 0.1 * flick);
    }
    // 火星：一顆一顆往上飄、左右晃、慢慢熄；拍點時多噴一些
    if (abs(fq.x) < 320.0 && fq.y < 40.0 && fq.y > -720.0) {
      for (int i = 0; i < ${SPARKS}; i++) {
        float fi = float(i);
        float L = 1.4 + 0.9 * hash11(fi * 3.7);
        float ph = t / L + hash11(fi * 1.3);
        float cyc = floor(ph);
        float a = fract(ph);
        float hx = hash12(vec2(fi, cyc)) - 0.5;
        vec2 sp = fire + vec2(hx * 80.0 + sin(a * 6.0 + fi) * 40.0 * a, -40.0 - a * (300.0 + 260.0 * hash11(fi + cyc * 1.7)));
        float r = length(p - sp);
        float br = (1.0 - a) * (1.0 - a) * (0.6 + burst * (i < ${SPARKS / 2} ? 1.4 : 0.0));
        col += fireCol(0.78) * 2.4 * br * exp(-r * r / 3.0);
      }
    }
    // 煙：營火上方往左上飄，很淡
    vec2 smq = p - fire - vec2(-(fire.y - p.y) * 0.35, 0.0);
    float smk = exp(-pow(smq.x / (40.0 + (fire.y - p.y) * 0.25), 2.0)) * smoothstep(fire.y - 160.0, fire.y - 260.0, p.y) * smoothstep(-200.0, 300.0, p.y);
    col = mix(col, mix(C_GRAPHITE, C_ASH, 0.3) * 0.5, 0.12 * smk * (0.5 + 0.5 * fbm(vec2(p.x / 90.0, p.y / 70.0 + t * 0.5), 3)));
    // ---- 前景的草（糊的剪影，火光照到一點邊）
    float bl = ${H}.0 - (30.0 + 46.0 * abs(sin(p0.x * 0.021 + snoise(vec2(p0.x / 90.0, 1.0)) * 3.0)) + 30.0 * snoise(vec2(p0.x / 40.0, 4.0)));
    col = mix(col, C_INK * 0.6 + warm * 0.012 * flick, smoothstep(bl - 7.0, bl + 7.0, p0.y));
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, t: { value: 0 }, k: { value: 1 }, seedOff: { value: 0 }, zc: { value: new THREE.Vector2() }, zoom: { value: 1 }, drift: { value: new THREE.Vector2() },
  fire: { value: new THREE.Vector2() }, flame: { value: 1 }, flick: { value: 1 }, burst: { value: 0 },
  pc: { value: new THREE.Vector2() }, hs: { value: new THREE.Vector2() }, bd: { value: 18 }, ang: { value: 0 }, tent: { value: new THREE.Vector2() },
  textRect: { value: new THREE.Vector4() },
});

/** 夜空裡的字塊：寬、高上限（相簿名＋主字＋署名＋歌詞）。60 字的留言在 40 px 排得進四行；最低寫到帳篷頂附近（y ≈ 560）。 */
const COL_W = 600, COL_H = 430;

export default class CampNight extends JourneyPlate {
  bg = shared('campnight.bg', BG);
  text = this.track(new Layer2D(COL_W + 60, COL_H + 60, undefined, { fast: true }));
  pcx = 0; pcy = 0; hw = 0; hh = 0; bd = 18; ang = 0;
  fx = 0; tx = 0;
  colX = 0; colY = 0;

  override async init() {
    await this.loadPhoto();
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.hand(400), lineHeight: 1.4,
      ink: rgba('bone', 0.94), unsung: rgba('bone', 0.3), active: rgba('signal'), sigInk: rgba('bone', 0.72),
      label: { family: F.hand(700), size: 24, color: rgba('ash', 0.85), tracking: 4, gap: 24 },
      shadow: { color: rgba('ink', 0.85), blur: 16 },
    });
    const { w, h } = this.img!;
    const s = this.fitScale(this.hasText ? 640 : 720, 520);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.bd = clamp(0.035 * Math.min(w * s, h * s), 12, 22);
    this.pcx = this.hasText ? Math.max(130 + this.hw + this.bd, 500) : 760;
    this.pcy = GROUND - this.hh - this.bd;
    this.ang = (-1.5 - hash(this.seed, 3) * 1.5) * (Math.PI / 180);
    this.fx = this.pcx + this.hw + this.bd + 230;
    this.tx = this.fx + 520;
    this.colX = 1160;
    const bh = this.blockH();
    this.colY = clamp(320 - bh / 2, 135, 560 - bh);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const u = this.bg.u;
    // 火燒起來：切進來 0.7 秒長到全高；之後跳動，大鼓時旺一下
    const ignite = ease.outCubic(prog(t, s, s + 0.7));
    const kick = f.a.kick;
    const flick = (0.86 + 0.08 * Math.sin(t * 13.1) + 0.06 * Math.sin(t * 7.3 + 1) + 0.14 * kick) * (0.35 + 0.65 * ignite);
    u.flame!.value = (0.45 + 0.55 * ignite) * (0.92 + 0.08 * Math.sin(t * 9.7) + 0.15 * kick);
    u.flick!.value = flick;
    const bt = audio.timeOfBeat(Math.floor(audio.beatAt(t) + 1e-6));
    u.burst!.value = (t >= bt ? Math.exp(-(t - bt) * 4) : 0) * 0.6 + (1 - prog(t, s, s + 0.8));
    u.t!.value = t;
    u.seedOff!.value = hash(this.seed, 7) * 30;
    (u.fire!.value as THREE.Vector2).set(this.fx, GROUND - 6);
    (u.tent!.value as THREE.Vector2).set(this.tx, GROUND - 40);
    (u.pc!.value as THREE.Vector2).set(this.pcx, this.pcy);
    (u.hs!.value as THREE.Vector2).set(this.hw, this.hh);
    u.bd!.value = this.bd;
    u.ang!.value = this.ang;
    // 鏡頭：很慢地往照片推近，手持的一點點晃
    const zoom = 1 + 0.04 * (1 - Math.exp(-lt / 7));
    const zx = this.hasText ? (this.pcx + this.fx) / 2 : this.pcx, zy = 620;
    u.zoom!.value = zoom;
    (u.zc!.value as THREE.Vector2).set(zx, zy);
    const dx = 2.5 * Math.sin(t * 0.7) + 1.2 * Math.sin(t * 1.9), dy = 1.8 * Math.sin(t * 0.9 + 1);
    (u.drift!.value as THREE.Vector2).set(dx, dy);
    // 火燒起來之後相片上的畫面往焦點推
    this.setPhoto(u, 2 * this.hw * zoom, this.focusK(t, s + 0.5), 1.18);
    const bh = this.blockH();
    (u.textRect!.value as THREE.Vector4).set(this.hasText ? this.colX - 10 : 0, this.colY - 10, this.hasText ? this.blockW() + 20 : 0, bh + 30);
    u.k!.value = (0.75 + 0.25 * ignite) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.hasText) {
      this.paintBlock(this.text, t, 30, 30, { chars: this.charsAt(t, s + 0.7, 2) });
      const op = prog(t, s + 0.5, s + 1.0, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      // 字在天上，跟著鏡頭（推近、手持晃）
      const lx = this.colX - 30 - dx, ly = this.colY - 30 - dy;
      if (op > 0) blit(comp, renderer, this.text, out, zx + (lx - zx) * zoom, zy + (ly - zy) * zoom, { opacity: op, s: zoom });
    }
    return { bloom: 0.3, bloomThreshold: 1.05, bloomRadius: 0.45, halation: 0.12, vignette: 0.5 };
  }
}
