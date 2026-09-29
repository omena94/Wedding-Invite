// 鏡球（暗）：空無一人的舞廳，天花板正中間吊著一顆鏡球，一盞聚光燈從左上打在它身上，反射的光點滿牆跑。
//  - 鏡球是一片一片的小鏡子（細細的接縫線），跟著時間轉；正好把燈反射進鏡頭的那幾片會閃一下（大鼓時更亮）。
//  - 光點（幾千個）隨著鏡球轉動從右往左掃過牆面與地板，中間快、兩邊慢，像真的鏡球。
//  - 畫面的焦點＝主打留言：第一拍鏡球「停住」，滿牆的光點在拍點上一個字一個字地「卡」進位置，拼出留言（思源宋體最粗）；
//    每一個光點落定的瞬間，從鏡球到它有一道很淡的光束閃一下。光點拼好之後，字底下浮出清楚的光字（讀得清楚），光點變成字上的閃爍。
//    之後鏡球慢慢再轉起來，其他的光點照樣在掃，但經過留言時會暗下去（不搶字）。署名在最後一行下面。
//  - 歌詞（比留言小一級）是地板上方一行光字，逐字跟唱。沒有留言：光點拼的是正在唱的那一句歌詞（每換一句光點就飛去排新的一句，
//    唱到的字光點變成訊號色），下面一行小字是新人的名字與邀請。純音樂：光點拼留言，地板上方是小小的歌名。
//  - 鏡頭：切進來時畫面在上面一點（看著鏡球），第一拍往下落定到牆上的字；之後很慢地推近。
// 手法：牆、地板、光錐、鏡球（每一片鏡子的法線、反射、接縫）是一個全螢幕 shader；光點與光束是 LineBatch（加亮混合，會發光）；
// 留言的光點位置在 init() 從字的光柵取樣（每個字大約三十個點）；清楚的光字與歌詞是 Canvas 圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, beatAfter, drawHeart, COUPLE_ZH } from './_motifs';
import { layoutRows, drawRows, darkInk, type RowsLayout } from './_t4';
import { T23_INVITE, T23_TEXT, sigOf, layMsg, stagger, type MsgLay, type Rect } from './_t23';

export const spec: PlateSpecDecl = { group: 'type', family: 'instrument', paper: false, energy: [0.5, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（畫面座標，y 向下）
const BALL = { x: 960, y: 172, r: 104 };
const MSG_BOX = { x: 210, y: 336, w: 1500, h: 470 };
/** 沒有留言時，光點拼歌詞的範圍。 */
const SOLO_BOX = { x: 180, y: 380, w: 1560, h: 380 };
const FLOOR_Y = 902;
const LYR = { x: 200, y: 952, w: 1120 };
const FAM_MSG = F.ming(900);
const FAM_LYR = F.archivo(100, 600);
/** 環境光點（一直在掃的）的數量。 */
const NAMB = 420;
const CAP = 5200;

const ROOM = () => new FSPass(/* glsl */ `
  uniform float uRot; uniform float uKick; uniform float uOn; uniform vec3 uCam; // x = 縮放、y = 往下的位移
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = (sp - vec2(960.0, 540.0 + uCam.y)) / uCam.x + vec2(960.0, 540.0);
    // ---- 牆：深色的絨布牆，很淡的直紋；地板：亮一點點的深色木地板，往遠處收
    vec3 col = C_INK2 * (0.32 + 0.05 * sin(p.x * 0.05) + 0.04 * fbm(p / 300.0, 3));
    col += mix(C_BLOOD, C_SIGNAL, 0.4) * 0.025 * exp(-pow(length((p - vec2(960.0, 520.0)) / vec2(1100.0, 600.0)), 2.0));
    if (p.y > ${FLOOR_Y}.0) {
      float d = (p.y - ${FLOOR_Y}.0) / ${H - FLOOR_Y}.0;
      float plank = abs(fract((p.x - 960.0) / (60.0 + 260.0 * d) * (0.4 + d)) - 0.5);
      vec3 fl = C_INK2 * (0.45 + 0.1 * d) * (0.92 + 0.08 * smoothstep(0.0, 0.04, plank));
      col = mix(col, fl, smoothstep(${FLOOR_Y}.0, ${FLOOR_Y + 3}.0, p.y));
      col += C_BONE * 0.004 * (1.0 - d);
    }
    // ---- 聚光燈：從左上打向鏡球的光錐（煙裡看得到）
    vec2 L0 = vec2(-160.0, -120.0), Lb = vec2(${BALL.x}.0, ${BALL.y}.0);
    vec2 dir = normalize(Lb - L0);
    vec2 rel = p - L0;
    float along = dot(rel, dir), across = abs(rel.x * dir.y - rel.y * dir.x);
    float beam = exp(-pow(across / (18.0 + along * 0.075), 2.0)) * smoothstep(0.0, 300.0, along) * (1.0 - smoothstep(length(Lb - L0) - 40.0, length(Lb - L0) + 60.0, along));
    col += mix(C_BONE, C_SIGNAL, 0.3) * 0.05 * beam * uOn;
    // ---- 吊桿
    float rod = sdSegment(p, vec2(960.0, -40.0), vec2(960.0, ${BALL.y - BALL.r + 6}.0)) - 2.2;
    col = mix(C_ASH * 0.25, col, smoothstep(-0.7, 0.7, rod));
    // ---- 鏡球
    vec2 q = (p - vec2(${BALL.x}.0, ${BALL.y}.0)) / ${BALL.r}.0;
    float rr = length(q);
    if (rr < 1.02) {
      vec3 n = vec3(q.x, -q.y, sqrt(max(0.0, 1.0 - rr * rr)));
      // 鏡頭稍微從下面往上看：先把法線轉回球自己的座標（傾斜、自轉）
      float tl = -0.28;
      vec3 nb = vec3(n.x, n.y * cos(tl) - n.z * sin(tl), n.y * sin(tl) + n.z * cos(tl));
      float c = cos(uRot), s = sin(uRot);
      nb = vec3(c * nb.x + s * nb.z, nb.y, -s * nb.x + c * nb.z);
      float lat = asin(clamp(nb.y, -1.0, 1.0)), lon = atan(nb.x, nb.z);
      const float BAND = 0.15;
      float bi = floor(lat / BAND + 0.5);
      float lat0 = bi * BAND;
      float nl = max(4.0, floor(TAU * cos(lat0) / BAND));
      float li = floor((lon + PI) / TAU * nl);
      float lon0 = (li + 0.5) / nl * TAU - PI;
      // 接縫：離這片鏡子邊緣多近
      float du = abs(fract((lon + PI) / TAU * nl) - 0.5) * TAU / nl * cos(lat);
      float dv = abs(lat / BAND + 0.5 - floor(lat / BAND + 0.5) - 0.5) * BAND;
      float grout = 1.0 - smoothstep(0.004, 0.012, min(0.5 * TAU / nl * cos(lat) - du, 0.5 * BAND - dv));
      // 這片鏡子的法線（轉回畫面座標）
      vec3 tn = vec3(cos(lat0) * sin(lon0), sin(lat0), cos(lat0) * cos(lon0));
      tn = vec3(c * tn.x - s * tn.z, tn.y, s * tn.x + c * tn.z);
      tn = vec3(tn.x, tn.y * cos(tl) + tn.z * sin(tl), -tn.y * sin(tl) + tn.z * cos(tl));
      float h = hash12(vec2(bi, li));
      vec3 Ld = normalize(vec3(-0.75, 0.5, 0.45));
      vec3 R = reflect(-Ld, tn);
      float glint = pow(max(R.z, 0.0), 90.0) * (0.6 + 0.8 * h);
      vec3 tile = C_GRAPHITE * (0.12 + 0.25 * h) + C_ASH * 0.08 * max(dot(tn, Ld), 0.0);
      tile += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.12 * pow(max(dot(tn, normalize(vec3(0.2, -0.6, 0.8))), 0.0), 6.0) * h;
      tile += mix(C_EMBER, vec3(1.0), 0.4) * glint * (3.0 + 5.0 * uKick) * uOn;
      tile *= 1.0 - 0.85 * grout;
      // 邊緣暗、一圈細的輪廓光
      tile *= 0.55 + 0.45 * n.z;
      tile += C_BONE * 0.05 * smoothstep(0.9, 1.0, rr);
      col = mix(tile, col, smoothstep(0.99, 1.02, rr));
    }
    fragColor = vec4(col, 1.0);
  }`, { uRot: { value: 0 }, uKick: { value: 0 }, uOn: { value: 1 }, uCam: { value: new THREE.Vector3(1, 0, 0) } });

/** 一個光點：一直在掃的（lon、h）與要落定的目標（字上的點，沒有就 NaN）、落定的時間、屬於第幾個字（或歌詞的第幾個字）。 */
interface Spot { lon: number; h: number; sz: number; tx: number; ty: number; land: number; g: number; heart: boolean }
/** 一句歌詞拼成光點：每個點屬於哪一個字（跟唱用）。 */
interface LinePts { line: Line; pts: { x: number; y: number; w: number }[]; lay: RowsLayout; x0: number; y0: number }

export default class MirrorBall extends Scene {
  room = shared('mirrorball.room', ROOM);
  dots = this.track(new LineBatch(CAP, { screen2D: true, blend: 'add' }));
  text = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 173 + (this.msg?.id ?? 0) * 29) >>> 0;
  lay: MsgLay | null = null;
  amb: Spot[] = [];
  spots: Spot[] = [];
  gT: number[] = [];
  sigT = Infinity;
  tOn = 0;
  bar = 2;
  hasLyr = false;
  lyrSize = 56;
  step = 8;
  solo: LinePts[] = [];
  textKey = '';
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    this.hasLyr = lines.length > 0;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T23_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    this.bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    // ---- 一直在掃的光點
    for (let i = 0; i < NAMB; i++) this.amb.push({ lon: rnd(i, 1) * TAU, h: rnd(i, 2), sz: 4 + 7 * rnd(i, 3) ** 2, tx: NaN, ty: NaN, land: Infinity, g: -1, heart: false });

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    if (m) {
      this.lay = layMsg(this.text.ctx, m.text, sig, FAM_MSG, MSG_BOX, { min: 58, max: 170, lineHeight: 1.22, maxLines: 5, sigFamily: F.ming(700), sigSize: [38, 50], align: 'center' });
      this.lyrSize = Math.max(48, Math.min(56, Math.round(this.lay.fit.size * 0.7)));
      const glyphs = this.lay.glyphs;
      // 一個字一個字落定：一拍 1、2、4、8 個（最多一小節多一點，或窗格的四成）
      this.gT = stagger(au, this.tOn, glyphs.length, Math.min(1.5 * this.bar, Math.max(0.6, 0.4 * (e - this.tOn))));
      this.sigT = this.gT[this.gT.length - 1] ?? this.tOn;
      // 字的光柵 → 格點上的光點（每個字大約 30 個點，大字小字密度一樣）
      this.step = clamp(this.lay.fit.size / 10.5, 4.2, 13);
      glyphs.forEach((g, gi) => {
        c.clearRect(0, 0, W, H);
        c.fillStyle = '#fff';
        c.textBaseline = 'alphabetic';
        if (g.ch === '♥') drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92, '#fff');
        else { c.font = font(g.row < 0 ? this.lay!.sig.family : FAM_MSG, g.size); c.fillText(g.ch, g.x, g.y); }
        const st = g.row < 0 ? Math.max(3.4, this.step * 0.6) : this.step;
        const x0 = Math.floor(g.x - 4), y0 = Math.floor(g.y - g.size * 1.0), x1 = Math.ceil(g.x + g.w + 4), y1 = Math.ceil(g.y + g.size * 0.3);
        const img = c.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data, iw = Math.max(1, x1 - x0);
        const jx = rnd(gi, 7) * st, jy = rnd(gi, 8) * st;
        for (let y = y0 + jy; y < y1; y += st) for (let x = x0 + jx; x < x1; x += st) {
          const a = img[(Math.floor(y - y0) * iw + Math.floor(x - x0)) * 4 + 3]!;
          if (a < 110) continue;
          const k = this.spots.length;
          if (k >= CAP - NAMB - 200) break;
          const land = this.gT[gi]! + (rnd(k, 4) - 0.5) * 0.08;
          // 落定之前它也是一個在掃的光點：選它的經度，讓它落定那一刻大約在目標旁邊幾百 px
          const tgtSweepX = x + (rnd(k, 5) - 0.5) * 520;
          const psi = Math.asin(clamp((tgtSweepX - 960) / 1500, -0.99, 0.99));
          this.spots.push({ lon: psi - this.rot(land), h: clamp((y + (rnd(k, 6) - 0.5) * 360 - 380) / 1000), sz: st * 0.92, tx: x, ty: y, land, g: gi, heart: g.ch === '♥' });
        }
      });
    } else if (this.hasLyr) {
      // 沒有留言：每一句歌詞各自取樣成光點
      for (const ln of lines) {
        const lay = layoutRows(this.text.ctx, ln, { family: F.archivo(100, 800), size: 150, minSize: 90, maxW: SOLO_BOX.w, maxRows: 2, align: 'center', lineHeight: 1.08 });
        const x0 = SOLO_BOX.x + SOLO_BOX.w / 2, y0 = SOLO_BOX.y + SOLO_BOX.h / 2 - lay.height / 2 + lay.size * 0.8;
        c.clearRect(0, 0, W, H);
        c.fillStyle = '#fff';
        const pts: LinePts['pts'] = [];
        const st = clamp(lay.size / 13, 5, 11);
        lay.words.forEach((pw, wi) => {
          c.clearRect(0, 0, W, H);
          c.font = font(F.archivo(100, 800), lay.size); c.textBaseline = 'alphabetic';
          c.fillText(pw.word.w, x0 + pw.x, y0 + pw.y);
          const bx = Math.floor(x0 + pw.x - 4), by = Math.floor(y0 + pw.y - lay.size), bw = Math.ceil(pw.w + 8), bh = Math.ceil(lay.size * 1.3);
          const img = c.getImageData(bx, by, Math.max(1, bw), Math.max(1, bh)).data;
          for (let y = by + st / 2; y < by + bh; y += st) for (let x = bx + st / 2; x < bx + bw; x += st) {
            if (img[(Math.floor(y - by) * bw + Math.floor(x - bx)) * 4 + 3]! < 90) continue;
            pts.push({ x, y, w: wi });
          }
        });
        pts.sort((a, b) => a.x - b.x);
        this.solo.push({ line: ln, pts: pts.slice(0, CAP - NAMB - 300), lay, x0, y0 });
      }
      this.step = 9;
    }
    this.avoid = [[MSG_BOX.x, MSG_BOX.y, MSG_BOX.w, MSG_BOX.h], [LYR.x, LYR.y - 60, LYR.w, 80]];
  }

  /** 鏡球轉了多少（弧度）：平常一直轉；第一拍停住一小節（光點「卡」進字裡），之後再慢慢轉起來。 */
  private rot(t: number) {
    const s = this.ctx.start, a = this.tOn, b = this.tOn + this.bar;
    const w = 0.42;
    const before = Math.min(t, a) - s;
    const during = clamp(t, a, b) - a;
    const after = Math.max(0, t - b);
    // 停下來之後再轉起來：慢慢加速（不要一下子就全速）
    const ramp = after < 1.5 ? (after * after) / 3 : after - 0.75;
    return w * (before + 0.04 * during + (this.msg ? 0.45 : 1) * ramp) + hash(this.seed, 3) * TAU;
  }

  /** 一直在掃的光點 → 畫面位置、亮度（背對牆的看不到）、速度（拉長成短線）。 */
  private sweep(sp: Spot, rot: number) {
    const psi = sp.lon + rot;
    const cz = Math.cos(psi);
    let x = 960 + 1500 * Math.sin(psi);
    let y = 380 + 1000 * sp.h + 60 * Math.cos(psi * 1.3 + sp.h * 5);
    if (y > FLOOR_Y) y = FLOOR_Y + (y - FLOOR_Y) * 0.35;
    // 離鏡球越遠的光點越大越淡
    return { x, y, vis: clamp((cz - 0.05) / 0.25), vx: -1500 * cz };
  }

  private cam(t: number) {
    const s = this.ctx.start;
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, this.ctx.end - s)));
    return { z: 1 + 0.035 * drift, oy: 70 * (1 - land) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, m = this.msg;
    const rot = this.rot(t);
    const cam = this.cam(t);
    const X = (x: number) => (x - 960) * cam.z + 960, Y = (y: number) => (y - 540) * cam.z + 540 + cam.oy;
    const kick = f.a.kick;
    const on = 0.5 + 0.5 * ease.outCubic(prog(t, this.ctx.start, this.tOn + 0.05));
    const u = this.room.u;
    u.uRot!.value = rot; u.uKick!.value = kick; u.uOn!.value = on;
    (u.uCam!.value as THREE.Vector3).set(cam.z, cam.oy, 0);
    this.room.render(renderer, out);

    // ---- 光點
    const lb = this.dots; lb.clear();
    const E = LIN.ember, B = LIN.bone, S = LIN.signal, R = LIN.rose;
    const bright = (0.8 + 0.5 * kick) * on;
    const bx = X(BALL.x), by = Y(BALL.y);
    const inText = (x: number, y: number) => x > MSG_BOX.x - 30 && x < MSG_BOX.x + MSG_BOX.w + 30 && y > MSG_BOX.y - 30 && y < MSG_BOX.y + MSG_BOX.h + 30;
    const settled = m ? prog(t, this.sigT, this.sigT + 0.6) : 0;
    this.amb.forEach((sp, i) => {
      const p = this.sweep(sp, rot);
      if (p.vis <= 0) return;
      // 留言拼好之後，掃過字的光點暗下去（不搶字）
      const dim = m ? 1 - 0.8 * settled * (inText(p.x, p.y) ? 1 : 0) : 1;
      const a = p.vis * (0.28 + 0.3 * sp.sz / 11) * dim;
      const len = Math.min(26, Math.abs(p.vx) * 0.012 * 0.42);
      const k = (0.55 + 0.45 * hash(i, 9)) * bright;
      lb.seg2(X(p.x - len / 2), Y(p.y), X(p.x + len / 2), Y(p.y), sp.sz * cam.z, [B[0] * k, B[1] * k, B[2] * k], a);
    });
    if (m) {
      // ---- 留言的光點：落定前在掃、落定時「卡」進字裡（從鏡球閃一道光束）
      for (let i = 0; i < this.spots.length; i++) {
        const sp = this.spots[i]!;
        const k = prog(t, sp.land, sp.land + 0.45, ease.outExpo);
        let x: number, y: number, a: number, len = 0;
        if (k <= 0) {
          const p = this.sweep(sp, rot);
          if (p.vis <= 0) continue;
          x = p.x; y = p.y; a = p.vis * 0.45; len = Math.min(26, Math.abs(p.vx) * 0.005);
        } else {
          const p = this.sweep(sp, this.rot(sp.land));
          x = lerp(p.x, sp.tx, k); y = lerp(p.y, sp.ty, k) - Math.sin(k * Math.PI) * 20;
          // 落定之後一閃一閃；字的清楚光字浮出來之後，光點退成字上零星的閃爍（不要變成一圈點點的外框）
          const glyphIn = prog(t, sp.land + 0.3, sp.land + 0.8);
          const tw = hash(i, Math.floor(t * 6 + hash(i, 3)));
          a = lerp(0.95, tw > 0.72 ? 0.55 * (tw - 0.72) / 0.28 : 0, glyphIn);
        }
        const hot = Math.exp(-Math.max(0, t - sp.land) / 0.25) * (t >= sp.land ? 1 : 0);
        const col = sp.heart ? R : hot > 0.02 ? S : E;
        const g = sp.heart ? 1.4 : 1.6 + 2.4 * hot;
        lb.seg2(X(x - len / 2), Y(y), X(x + len / 2), Y(y), sp.sz * cam.z, [col[0] * g, col[1] * g, col[2] * g], a);
        if (hot > 0.15 && i % 4 === 0) lb.seg2(bx, by, X(x), Y(y), 3, [S[0], S[1], S[2]], 0.05 * hot);
      }
    } else if (this.solo.length) {
      this.soloDots(t, lb, X, Y, rot);
    }
    lb.render(renderer, out);

    // ---- 清楚的光字（留言）、地板上方的歌詞
    const L = this.text, c = L.ctx;
    L.clear();
    c.setTransform(cam.z, 0, 0, cam.z, 960 - 960 * cam.z, 540 - 540 * cam.z + cam.oy);
    if (m && this.lay) {
      c.textBaseline = 'alphabetic';
      this.lay.glyphs.forEach((g, gi) => {
        const a = prog(t, this.gT[gi]! + 0.3, this.gT[gi]! + 0.8, ease.outCubic);
        if (a <= 0) return;
        c.globalAlpha = a * 0.92;
        if (g.ch === '♥') { drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92); return; }
        c.font = font(g.row < 0 ? this.lay!.sig.family : FAM_MSG, g.size);
        c.fillStyle = rgba('bone', 0.95);
        c.fillText(g.ch, g.x, g.y);
      });
      c.globalAlpha = 1;
    }
    const ink = darkInk();
    if (m) {
      const ly = this.hasLyr ? lyricAt(lyrics, t) : null;
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: LYR.w, maxRows: 1, align: 'left' });
        c.save(); c.translate(LYR.x, LYR.y); drawRows(c, lay, FAM_LYR, t, ink, ly.k); c.restore();
      } else if (!this.hasLyr) {
        c.font = font(F.mono(500), 20); c.fillStyle = rgba('ash', 0.7); c.letterSpacing = '4px';
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 10);
        c.letterSpacing = '0px';
      }
    } else {
      c.font = font(F.ming(700), 30); c.fillStyle = rgba('bone', 0.7);
      c.fillText(COUPLE_ZH, LYR.x, LYR.y - 26);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('ash', 0.7); c.letterSpacing = '3px';
      c.fillText(T23_INVITE, LYR.x, LYR.y + 14);
      c.letterSpacing = '0px';
      if (!this.hasLyr) {
        c.font = font(F.ming(900), 120); c.fillStyle = rgba('bone', 0.9 * prog(t, this.tOn, this.tOn + 0.6)); c.textAlign = 'center';
        c.fillText(COUPLE_ZH, 960, 620); c.textAlign = 'left';
      }
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, L.upload(), out);
    return { bloom: 0.85, bloomThreshold: 0.9, vignette: 0.55, halation: 0.3, popupAvoid: this.avoid };
  }

  /** 沒有留言：光點拼正在唱的歌詞（換句時光點飛去排新的一句），唱到的字的光點是訊號色。 */
  private soloDots(t: number, lb: LineBatch, X: (x: number) => number, Y: (y: number) => number, rot: number) {
    // 這一格顯示哪一句：跟 lyricAt 一樣提早一點出現、唱完停一下
    // 句子之間的空檔：上一句的光點留在牆上（淡一點），不要整面牆突然空掉
    const ly = lyricAt(this.ctx.lyrics, t, 1.2, 0.5);
    let cur = ly ? this.solo.find((s) => s.line === ly.line) ?? null : null;
    let hold = 1;
    if (!cur) {
      for (const s of this.solo) if (s.line.start - 0.5 <= t) cur = s;
      hold = 0.55;
    }
    const prev = cur ? this.solo[this.solo.indexOf(cur) - 1] ?? null : null;
    const n = cur ? cur.pts.length : 0;
    const t0 = cur ? cur.line.start - 0.5 : 0;
    const k = cur ? prog(t, t0, t0 + 0.55, ease.outExpo) : 0;
    const E = LIN.ember, S = LIN.signal, B = LIN.bone;
    for (let i = 0; i < n; i++) {
      const p = cur!.pts[i]!;
      // 從上一句的同一個名次的點飛過來（沒有就從掃過的光點飛過來）
      const q = prev && prev.pts.length ? prev.pts[Math.floor((i / n) * prev.pts.length)]! : null;
      const sw = this.sweep({ lon: hash(this.seed, i, 11) * TAU, h: hash(this.seed, i, 12), sz: 8, tx: 0, ty: 0, land: 0, g: 0, heart: false }, rot);
      const fx = q ? q.x : sw.x, fy = q ? q.y : sw.y;
      const x = lerp(fx, p.x, k), y = lerp(fy, p.y, k) - Math.sin(k * Math.PI) * 30;
      const w = cur!.lay.words[p.w]!.word;
      const wp = Lyrics.wordProgress(w, t);
      const col = wp > 0 && wp < 1 ? S : wp >= 1 ? B : E;
      const g = wp > 0 && wp < 1 ? 3.2 : wp >= 1 ? 1.3 : 0.9;
      const a = (wp > 0 ? 0.95 : 0.4) * (ly ? Math.max(ly.k, 0.55) : hold) * (0.8 + 0.2 * hash(i, Math.floor(t * 7)));
      lb.seg2(X(x), Y(y), X(x + 0.01), Y(y), 8 * (0.9 + 0.1 * k), [col[0] * g, col[1] * g, col[2] * g], a);
    }
  }
}
