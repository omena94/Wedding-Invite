// 鏡球（暗）：空無一人的舞廳，天花板吊著一顆鏡球（畫面左上），一盞聚光燈從左上打在它身上，反射的光點滿牆跑。
//  - 鏡球是一片一片的小鏡子（細細的接縫線），跟著時間轉；正好把燈反射進鏡頭的那幾片會閃一下（大鼓時更亮）。
//  - 光點（幾百個）隨著鏡球轉動從右往左掃過牆面、天花板與地板，中間快、兩邊慢，像真的鏡球；煙裡看得到從鏡球射出去的細光束。
//    每個小節線從鏡球放出一圈亮光掃過滿牆的光點（窗格裡每小節一個小事件）。
//  - 畫面的焦點＝主打留言，在畫面右側的牆上（v2：留言 40～60 px、留言區 ≤ 820×420）：第一拍鏡球「停住」，
//    光點在拍點上一個字一個字地「卡」進位置，拼出留言（思源宋體最粗）；每一個光點落定的瞬間，從鏡球到它有一道很淡的光束閃一下。
//    光點拼好之後，字底下浮出清楚的光字（讀得清楚），光點變成字上的閃爍。之後鏡球慢慢再轉起來，其他的光點照樣在掃，
//    但經過留言時會暗下去（不搶字）。署名在最後一行下面。
//  - 歌詞（比留言小 4 px）是地板上方一行光字，逐字跟唱。沒有留言：光點在左邊拼一顆愛心（點綴色，跟著大鼓跳），
//    歌詞在右邊留言的位置（主角），地板上方一行小字是新人的名字與邀請。純音樂：光點拼留言，地板上方是小小的歌名。
//  - 鏡頭：切進來時畫面在上面一點（看著鏡球），第一拍往下落定到牆上的字；之後很慢地推近。右下角（QR）後面沒有光點掃過。
// 手法：牆、地板、光錐、鏡球（每一片鏡子的法線、反射、接縫）是一個全螢幕 shader；光點與光束是 LineBatch（加亮混合，會發光）；
// 留言的光點位置在 init() 從字的光柵取樣（每個字大約三十個點）；清楚的光字與歌詞是 Canvas 圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { lyricAt, lyricSubOf, subGap, subSizeFor, beatAfter, drawHeart, heartPoints, COUPLE_ZH } from './_motifs';
import { layoutRows, drawRows, darkInk } from './_t4';
import { T23_INVITE, T23_TEXT, sigOf, layMsgV2, stagger, lastBefore, type MsgLay, type Rect } from './_t23';
import { V2, lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'instrument', paper: false, energy: [0.5, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（畫面座標，y 向下）
/** 鏡球偏左上（留言在右邊的牆上，鏡球與它掃出來的光是左半邊的主視覺）。 */
const BALL = { x: 600, y: 204, r: 148 };
/** v2：留言區在畫面右側的牆上（寬 ≤ 860、高 ≤ 430）；鏡球在左上，左半邊是滿牆掃過的光點與光束。 */
const MSG_BOX = { x: 900, y: 340, w: 820, h: 420 };
/** 沒有留言：光點在左邊拼一顆愛心，歌詞在右邊（留言的位置）。 */
const HEART = { x: 600, y: 610, r: 205 };
const SOLO_LYR = { x: 920, y: 560, w: 800 };
const FLOOR_Y = 902;
const LYR = { x: 200, y: 952, w: 1120 };
const FAM_MSG = F.ming(900);
const FAM_LYR = F.archivo(100, 600);
/** 環境光點（一直在掃的）的數量。 */
const NAMB = 540;
/** 反射光束（煙裡看得到的細光）的數量：每隔幾個環境光點取一個。 */
const BEAM_EVERY = 9;
const CAP = 5800;

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
    float rod = sdSegment(p, vec2(${BALL.x}.0, -40.0), vec2(${BALL.x}.0, ${BALL.y - BALL.r + 6}.0)) - 2.2;
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
  bars: number[] = [];
  avoid: Rect[] = [];
  /** 韓文歌（沒有留言時才有原文副行）：歌詞那一塊多出來的高度，光點、光束要多避開這麼多；沒有副行是 0。 */
  subRoom = 0;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    this.hasLyr = lines.length > 0;
    const sig = m ? sigOf(m) : '';
    const anySub = lines.some((l) => lyricSubOf(l));
    await loadText(`${T23_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    this.bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    // ---- 一直在掃的光點
    // 高度從天花板到地板都有（h < 0 是鏡球上方的牆與天花板：真的鏡球光點是滿屋子跑，不是只有下半面牆）
    for (let i = 0; i < NAMB; i++) this.amb.push({ lon: rnd(i, 1) * TAU, h: -0.34 + 1.34 * rnd(i, 2), sz: 4 + 7 * rnd(i, 3) ** 2, tx: NaN, ty: NaN, land: Infinity, g: -1, heart: false });

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    if (m) {
      // v2：留言 40～60（照字數），在畫面右側的牆上；光點排的字比較小，點也跟著密一點
      this.lay = layMsgV2(this.text.ctx, m.text, sig, FAM_MSG, MSG_BOX, { lineHeight: 1.3, maxLines: 5, sigFamily: F.ming(700), align: 'left' });
      this.lyrSize = lyricV2(this.lay.fit.size);
      const glyphs = this.lay.glyphs;
      // 一個字一個字落定：一拍 1、2、4、8 個（最多一小節多一點，或窗格的四成）
      this.gT = stagger(au, this.tOn, glyphs.length, Math.min(1.5 * this.bar, Math.max(0.6, 0.4 * (e - this.tOn))));
      this.sigT = this.gT[this.gT.length - 1] ?? this.tOn;
      // 字的光柵 → 格點上的光點（每個字大約 30 個點，大字小字密度一樣）
      this.step = clamp(this.lay.fit.size / 8.5, 3.4, 8);
      glyphs.forEach((g, gi) => {
        c.clearRect(0, 0, W, H);
        c.fillStyle = '#fff';
        c.textBaseline = 'alphabetic';
        if (g.ch === '♥') drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92, '#fff');
        else { c.font = font(g.row < 0 ? this.lay!.sig.family : FAM_MSG, g.size); c.fillText(g.ch, g.x, g.y); }
        const st = g.row < 0 ? Math.max(3, this.step * 0.7) : this.step;
        const x0 = Math.floor(g.x - 4), y0 = Math.floor(g.y - g.size * 1.0), x1 = Math.ceil(g.x + g.w + 4), y1 = Math.ceil(g.y + g.size * 0.3);
        const img = c.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data, iw = Math.max(1, x1 - x0);
        const jx = rnd(gi, 7) * st, jy = rnd(gi, 8) * st;
        for (let y = y0 + jy; y < y1; y += st) for (let x = x0 + jx; x < x1; x += st) {
          const a = img[(Math.floor(y - y0) * iw + Math.floor(x - x0)) * 4 + 3]!;
          if (a < 110) continue;
          const k = this.spots.length;
          if (k >= CAP - NAMB - 200) break;
          this.addSpot(x, y, st * 0.92, this.gT[gi]! + (rnd(k, 4) - 0.5) * 0.08, gi, g.ch === '♥');
        }
      });
    } else {
      // 沒有留言：光點在左邊拼一顆愛心（點綴色，只給愛心），在拍點上一圈一圈卡進去；歌詞在右邊
      const N = 150;
      const pts = heartPoints(N);
      const land = stagger(au, this.tOn, N, Math.min(this.bar, Math.max(0.6, 0.3 * (e - this.tOn))));
      for (const ring of [1, 0.88]) pts.forEach((p, i) => {
        if (i >= N) return;
        this.addSpot(HEART.x + p.x * HEART.r * ring, HEART.y + p.y * HEART.r * ring, 8, land[i]! + (1 - ring) * 0.6, -1, true);
      });
      this.sigT = land[N - 1] ?? this.tOn;
    }
    // 小節線：每個小節線從鏡球放出一圈亮光掃過牆上的光點（窗格裡每小節一個小事件）
    for (let b = Math.floor(au.barAt(s - 2)); ; b++) { const tb = au.timeOfBar(b); if (tb > e + 1 || this.bars.length > 80) break; this.bars.push(tb); }
    // 韓文歌（沒有留言才有原文副行）：歌詞那一塊多一排原文，字後面要乾淨的範圍往下多留一點
    this.subRoom = !m && anySub ? 70 : 0;
    this.avoid = m ? [[MSG_BOX.x, MSG_BOX.y, MSG_BOX.w, MSG_BOX.h], [LYR.x, LYR.y - 60, LYR.w, 80]] : [[SOLO_LYR.x, SOLO_LYR.y - 70 - this.subRoom / 2, SOLO_LYR.w, 180 + this.subRoom]];
  }

  /** 加一個會落定的光點：落定之前它也是一個在掃的光點（選它的經度，讓它落定那一刻大約在目標旁邊幾百 px）。 */
  private addSpot(x: number, y: number, sz: number, land: number, g: number, heart: boolean) {
    const k = this.spots.length, rnd = (i: number, j: number) => hash(this.seed, i, j);
    const psi = Math.asin(clamp((x + (rnd(k, 5) - 0.5) * 520 - BALL.x) / 1500, -0.99, 0.99));
    this.spots.push({ lon: psi - this.rot(land), h: clamp((y + (rnd(k, 6) - 0.5) * 360 - 380) / 1000), sz, tx: x, ty: y, land, g, heart });
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
    let x = BALL.x + 1500 * Math.sin(psi);
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
    const box = m ? MSG_BOX : { x: SOLO_LYR.x, y: SOLO_LYR.y - 70 - this.subRoom / 2, w: SOLO_LYR.w, h: 180 + this.subRoom };
    const inText = (x: number, y: number) => x > box.x - 30 && x < box.x + box.w + 30 && y > box.y - 30 && y < box.y + box.h + 30;
    const settled = prog(t, this.sigT, this.sigT + 0.6);
    // 小節線放出的那一圈亮光（從鏡球往外跑）
    const tb = lastBefore(this.bars, t), tw0 = t - tb;
    const ring = (x: number, y: number) => (tw0 < 1.6 ? Math.exp(-(((Math.hypot(x - BALL.x, y - BALL.y) - 1500 * tw0) / 150) ** 2)) * Math.exp(-tw0 / 0.9) : 0);
    const beams: [number, number, number][] = [];
    this.amb.forEach((sp, i) => {
      const p = this.sweep(sp, rot);
      if (p.vis <= 0) return;
      // 鏡球擋住的牆上看不到光點
      if (Math.hypot(p.x - BALL.x, p.y - BALL.y) < BALL.r + 6) return;
      // 留言拼好之後，掃過字的光點暗下去（不搶字）
      // 右下角 HUD（QR 與小字）後面不要有光點掃過
      const hit = inText(p.x, p.y);
      const dim = (1 - 0.8 * settled * (hit ? 1 : 0)) * (p.x > 1330 && p.y > 800 ? 0.1 : 1);
      const a = p.vis * (0.28 + 0.3 * sp.sz / 11) * dim;
      const len = Math.min(26, Math.abs(p.vx) * 0.012 * 0.42);
      const k = (0.55 + 0.45 * hash(i, 9)) * bright * (1 + 1.8 * ring(p.x, p.y));
      lb.seg2(X(p.x - len / 2), Y(p.y), X(p.x + len / 2), Y(p.y), sp.sz * cam.z, [B[0] * k, B[1] * k, B[2] * k], a);
      // 一部分光點畫出從鏡球射過去的細光束（打到留言上的不畫，字後面要乾淨）
      if (i % BEAM_EVERY === 0 && !hit && dim > 0.5) beams.push([p.x, p.y, p.vis * k]);
    });
    // ---- 煙裡的反射光束：鏡球附近最亮、往外慢慢散掉（分三段，越遠越淡越寬）
    const c0: [number, number, number] = [lerp(B[0], S[0], 0.25), lerp(B[1], S[1], 0.25), lerp(B[2], S[2], 0.25)];
    for (const [x, y, v] of beams) {
      // 從鏡球的表面開始（不要畫過球面）
      const s0 = Math.min(0.9, (BALL.r * 0.92) / Math.max(1, Math.hypot(x - BALL.x, y - BALL.y)));
      // 穿過留言或地板上方那行歌詞的光束不畫（字後面要乾淨）
      let cross = false;
      for (let q = 0; q <= 12 && !cross; q++) {
        const u = lerp(s0, 1, q / 12), qx = lerp(BALL.x, x, u), qy = lerp(BALL.y, y, u);
        cross = inText(qx, qy) || (qx > LYR.x - 30 && qx < LYR.x + LYR.w && qy > LYR.y - 70 && qy < LYR.y + 30);
      }
      if (cross) continue;
      for (let j = 0; j < 3; j++) {
        const u0 = lerp(s0, 1, j / 3), u1 = lerp(s0, 1, (j + 1) / 3);
        const a = 0.04 * v * [1, 0.55, 0.25][j]!;
        lb.seg2(X(lerp(BALL.x, x, u0)), Y(lerp(BALL.y, y, u0)), X(lerp(BALL.x, x, u1)), Y(lerp(BALL.y, y, u1)), (1.6 + 2.2 * j) * cam.z, c0, a);
      }
    }
    // ---- 會落定的光點（留言的字、或沒有留言時的愛心）：落定前在掃、落定時「卡」進位置（從鏡球閃一道光束）
    const beat = m ? 1 : 1 + 0.035 * kick; // 愛心跟著大鼓跳一下
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
        const tx = m ? sp.tx : HEART.x + (sp.tx - HEART.x) * beat, ty = m ? sp.ty : HEART.y + (sp.ty - HEART.y) * beat;
        x = lerp(p.x, tx, k); y = lerp(p.y, ty, k) - Math.sin(k * Math.PI) * 20;
        if (m) {
          // 字的清楚光字浮出來之後，光點退成字上零星的閃爍（不要變成一圈點點的外框）
          const glyphIn = prog(t, sp.land + 0.3, sp.land + 0.8);
          const tw = hash(i, Math.floor(t * 6 + hash(i, 3)));
          a = lerp(0.95, tw > 0.72 ? 0.55 * (tw - 0.72) / 0.28 : 0, glyphIn);
        } else a = 0.75 + 0.25 * hash(i, Math.floor(t * 6));
      }
      const hot = Math.exp(-Math.max(0, t - sp.land) / 0.25) * (t >= sp.land ? 1 : 0);
      const col = sp.heart ? R : hot > 0.02 ? S : E;
      const g = sp.heart ? 1.4 + 1.2 * hot : 1.6 + 2.4 * hot;
      lb.seg2(X(x - len / 2), Y(y), X(x + len / 2), Y(y), sp.sz * cam.z, [col[0] * g, col[1] * g, col[2] * g], a);
      if (hot > 0.15 && i % 4 === 0) lb.seg2(bx, by, X(x), Y(y), 3, [S[0], S[1], S[2]], 0.05 * hot);
    }
    lb.render(renderer, out);

    // ---- 清楚的光字（留言）、歌詞
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
        const lay = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin, maxW: LYR.w, maxRows: 1, align: 'left' });
        c.save(); c.translate(LYR.x, LYR.y); drawRows(c, lay, FAM_LYR, t, ink, ly.k); c.restore();
      } else if (!this.hasLyr) {
        c.font = font(F.mono(500), 20); c.fillStyle = rgba('ash', 0.7); c.letterSpacing = '4px';
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 10);
        c.letterSpacing = '0px';
      }
    } else {
      // 沒有留言：右邊是歌詞（主角，52）；地板上方一行新人的名字與邀請（小）
      const ly = this.hasLyr ? lyricAt(lyrics, t) : null;
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: FAM_LYR, size: lyricV2(null), minSize: V2.lyrMin, maxW: SOLO_LYR.w, maxRows: 2, align: 'left', lineHeight: 1.2 });
        const sub = lyricSubOf(ly.line);
        if (sub) {
          // 韓文歌：原文小一號的光字寫在中文正下方（同樣靠左），兩段一起在牆上垂直置中；
          // 原文比中文安靜：唱到、唱完都是淡兩成的紙白（不用訊號色），還沒唱的照中文三成
          const ss = subSizeFor(lay.size);
          const sl = layoutRows(c, sub, { family: FAM_LYR, size: ss, minSize: Math.min(ss, 26), maxW: SOLO_LYR.w, maxRows: 2, align: 'left', lineHeight: 1.2 });
          const gap = subGap(lay.size, sl.size), more = gap + (sl.rows.length - 1) * sl.lineHeight;
          const lit = rgba('bone', 0.96 * 0.8);
          c.save(); c.translate(SOLO_LYR.x, SOLO_LYR.y - ((lay.rows.length - 1) * lay.lineHeight + more) * 0.5);
          drawRows(c, lay, FAM_LYR, t, ink, ly.k);
          c.translate(0, (lay.rows.length - 1) * lay.lineHeight + gap);
          drawRows(c, sl, FAM_LYR, t, { active: lit, sung: lit, unsung: ink.unsung }, ly.k);
          c.restore();
        } else {
          c.save(); c.translate(SOLO_LYR.x, SOLO_LYR.y - (lay.rows.length - 1) * lay.lineHeight * 0.5); drawRows(c, lay, FAM_LYR, t, ink, ly.k); c.restore();
        }
      } else if (!this.hasLyr) {
        c.font = font(F.ming(700), 52); c.fillStyle = rgba('bone', 0.9 * prog(t, this.tOn, this.tOn + 0.6));
        c.fillText(COUPLE_ZH, SOLO_LYR.x, SOLO_LYR.y);
      }
      c.font = font(F.ming(700), 30); c.fillStyle = rgba('bone', 0.7);
      c.fillText(COUPLE_ZH, LYR.x, LYR.y - 26);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('ash', 0.7); c.letterSpacing = '3px';
      c.fillText(T23_INVITE, LYR.x, LYR.y + 14);
      c.letterSpacing = '0px';
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, L.upload(), out);
    return { bloom: 0.85, bloomThreshold: 0.9, vignette: 0.55, halation: 0.3, popupAvoid: this.avoid };
  }
}
