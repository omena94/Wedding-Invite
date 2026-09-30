// 翻譯機（亮，雙語）：旅行時拿在手上的口袋翻譯機特寫，墨水屏（像電子書的紙質螢幕），底下是一張攤開、在焦外的旅行地圖。
//  - 螢幕左邊是「即時翻譯」：上半是原文（聽到的），下半是中文（翻出來的），兩行都照自己的逐字時間亮；
//    中間一顆轉換箭頭，每一拍轉一圈；聽到聲音時原文下面的聲波跟著人聲跳。沒有翻譯的歌只有中文一格，置中，原文那一格收起來。
//  - 螢幕右邊是「★ 收藏句子」清單：主打留言是最新收藏的一句（手寫字，40～60 px，那一欄約 490×430），第一個小節線「收藏」進來、
//    星星填滿；署名在下面。沒有留言時是空的清單與邀請。
//  - 機身下方一顆大大的說話鍵：唱的時候外圈亮、每句開頭被按一下（下沉）。每個小節線，玻璃上的反光掃過一次、
//    手輕輕換一下角度；地圖上一架小飛機沿著航線虛線慢慢飛。
// 畫法：翻譯機是一個微微傾斜的平面（shader 裡解光線與平面的交點，像真的拿在手上），正面的機身與螢幕是兩張圖層
// （不變的畫一次、歌詞與聲波每格畫），地圖、機身的厚度、影子、玻璃反光都在 shader 裡算；說話鍵的光圈用 LineBatch 疊加。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, lerp, noise1, hash } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, lyricSubOf, beatAfter, barAfter, COUPLE_ZH, type LyricStyle } from './_motifs';
import { INVITE_SMALL, paperSignal } from './_t19';
import { barsIn, beatsIn } from './_t1';
import { placeBlock, drawBlock, sigOf, fitV2 } from './_t22';
import { lyricV2, V2 } from './_v2';
import { mainOnly, preloadPair, hasSubIn, type Rect } from './_b4';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'lingo', paper: true, energy: [0.2, 0.85], bars: [4, 12], weight: 1 };

/** 翻譯機正面（機身座標，px）：機身大小、圓角；螢幕；左右兩欄。 */
const DW = 1260, DH = 780, DR = 64;
const SCR = { x: 50, y: 50, w: 1160, h: 560 };
const LEFT = { x: 50, w: 550 };
const RIGHT = { x: 614, w: 596 };
/** 左欄：原文那一格、中文那一格的中線 y；只有中文時的中線 y。 */
const SRC_Y = 196, ZH_Y = 470, SOLO_Y = 318;
/** 轉換箭頭（左欄兩格之間）。 */
const ARROW = { x: LEFT.x + LEFT.w / 2, y: 340, r: 26 };
/**
 * 原文那一格的字級（機身 px）：機身在畫面上約縮成 0.96 倍、還有一點透視，35 在畫面上才有 ≥ 32 px。
 * 字不縮小，放不下就折兩行（聲波在原文下面、轉換箭頭上面，不會壓到字）。
 */
const SUBPX = 35;
/** 聲波（原文下面；只有中文時在中文下面）。 */
const WAVE = { x: LEFT.x + 44, w: LEFT.w - 88, n: 44 };
/** 收藏清單裡寫留言的範圍。 */
const MSGR = { x: RIGHT.x + 36, y: 150, w: 540, h: 420 };
/** 說話鍵（機身座標）。 */
const BTN = { x: DW / 2, y: 698, r: 52 };
/** 翻譯機在畫面上的中心、離鏡頭多遠、焦距（1 機身 px 在中心附近約等於 1 畫面 px）。 */
const CX = 712, CY = 516, FOC = 2200;

const T_LIVE = '即時翻譯 · LIVE';
const T_SRC = '原文 · ORIGINAL';
const T_ZH = '中文 · 繁體';
const T_SAVED = '★ 收藏句子 · SAVED';
const T_EMPTY = '還沒有收藏的句子';
const T_REST = '沒有偵測到人聲，僅播放音樂';
const T_BTN = '按住說話';

// ---------------------------------------------------------------- 地圖＋翻譯機（整晚共用）
const PASS = () => new FSPass(/* glsl */ `
  uniform sampler2D face; uniform sampler2D dyn;
  uniform mat3 R; uniform vec3 P0; uniform float t; uniform vec2 drift;
  uniform float sweep; uniform float sweepK; uniform vec3 plane;
  const vec2 DEV = vec2(${DW}.0, ${DH}.0);
  const float FOC = ${FOC}.0;
  // 機身座標（左上原點）→ 這一點的 SDF（圓角矩形，負的是機身裡面）
  float bodySD(vec2 l) { vec2 q = abs(l - DEV * 0.5) - (DEV * 0.5 - ${DR}.0); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ${DR}.0; }
  // 畫面像素 → 機身座標（光線打到傾斜的平面）
  vec2 toLocal(vec2 p) {
    vec3 d = vec3(p - vec2(${W / 2}.0, ${H / 2}.0), FOC);
    vec3 n = R * vec3(0.0, 0.0, 1.0);
    float s = dot(P0, n) / dot(d, n);
    vec3 X = d * s - P0;
    vec3 l = transpose(R) * X;
    return l.xy + DEV * 0.5;
  }
  // 旅行地圖（在焦外）：紙、陸地（低頻的形狀）、海岸線、淡淡的經緯線、航線虛線、一架小飛機
  vec3 mapAt(vec2 p) {
    vec2 q = p + drift;
    vec3 paper = mix(C_PAPER, C_BONE, 0.25);
    float land = fbm(q / 520.0 + vec2(3.1, 7.7), 3) + 0.25 * sin(q.x / 400.0);
    float L = smoothstep(0.02, 0.1, land);
    vec3 col = mix(mix(paper, C_SEPIA, 0.07), mix(paper, C_SEPIA, 0.14), L);
    col = mix(col, mix(paper, C_SEPIA, 0.3), exp(-pow((land - 0.06) / 0.018, 2.0)) * 0.6);
    // 等高線（很淡、很柔：在焦外）
    col *= 1.0 - 0.025 * L * smoothstep(0.3, 0.0, abs(fract(land * 9.0) - 0.5) - 0.2);
    // 經緯線
    vec2 g = abs(fract(q / 360.0) - 0.5);
    col *= 1.0 - 0.03 * smoothstep(0.012, 0.0, min(g.x, g.y));
    // 航線（弧線虛線，訊號色很淡）＋小飛機
    float yArc = 960.0 - 0.00042 * pow(q.x - 1250.0, 2.0) - 380.0;
    float dash = step(0.5, fract(q.x / 34.0));
    col = mix(col, mix(col, C_BLOOD, 0.4), smoothstep(5.0, 1.5, abs(q.y - yArc)) * dash * 0.55);
    vec2 pq = q - plane.xy;
    pq = rot2(-plane.z) * pq;
    float fus = sdBox(pq, vec2(26.0, 4.0)), wing = sdBox(pq - vec2(2.0, 0.0), vec2(5.0, 22.0)), tail = sdBox(pq + vec2(22.0, 0.0), vec2(3.0, 9.0));
    col = mix(col, mix(paper, C_SEPIA, 0.55), smoothstep(2.5, -1.0, min(fus, min(wing, tail))) * 0.8);
    // 窗光：左上亮、右下暗一點
    col *= 0.92 + 0.12 * exp(-pow(length((p - vec2(300.0, 100.0)) / vec2(1500.0, 1100.0)), 2.0));
    return col;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = mapAt(p);
    // 機身的影子落在地圖上（手拿著、離地圖有一段距離：往右下偏、很柔）
    float shd = bodySD(toLocal(p - vec2(70.0, 86.0)));
    col *= 1.0 - 0.28 * (1.0 - smoothstep(-60.0, 90.0, shd));
    vec2 l = toLocal(p);
    float sd = bodySD(l);
    // 機身的厚度：往右下看得到一條側邊（深色塑膠、邊上一點反光）
    float side = bodySD(toLocal(p - vec2(5.0, 14.0)));
    if (side < 0.5 && sd > -0.5) {
      float a = 1.0 - smoothstep(-0.5, 0.5, side);
      vec3 sc = mix(C_INK2, C_GRAPHITE, 0.25) * 0.8 + C_BONE * 0.05 * smoothstep(-3.0, 0.0, side);
      col = mix(col, sc, a);
    }
    if (sd < 0.5) {
      vec2 uv = vec2(l.x / DEV.x, 1.0 - l.y / DEV.y);
      vec4 A = fastLayer(textureLod(face, uv, 0.0));
      vec4 D = fastLayer(textureLod(dyn, uv, 0.0));
      vec3 c = A.rgb * (1.0 - D.a) + D.rgb;
      // 機身邊上一圈亮邊（倒角）
      c += C_BONE * 0.08 * smoothstep(-6.0, -1.0, sd) * smoothstep(0.6, -0.4, (l.y - l.x * 0.3) / DEV.y);
      // 螢幕玻璃：一道固定的斜反光＋小節線時掃過的一道
      vec2 sl = l - vec2(${SCR.x}.0, ${SCR.y}.0);
      float inScr = step(0.0, sl.x) * step(sl.x, ${SCR.w}.0) * step(0.0, sl.y) * step(sl.y, ${SCR.h}.0);
      float band = (l.x * 0.45 + l.y) / 900.0;
      c += C_BONE * inScr * (0.035 * exp(-pow((band - 0.35) / 0.06, 2.0)) + 0.1 * sweepK * exp(-pow((band - sweep) / 0.05, 2.0)));
      col = mix(col, c, 1.0 - smoothstep(-0.5, 0.5, sd));
    }
    fragColor = vec4(col, 1.0);
  }`, {
  face: { value: null }, dyn: { value: null }, R: { value: new THREE.Matrix3() }, P0: { value: new THREE.Vector3() }, t: { value: 0 }, drift: { value: new THREE.Vector2() },
  sweep: { value: -9 }, sweepK: { value: 0 }, plane: { value: new THREE.Vector3() },
});

export default class Translator extends Scene {
  pass = shared('translator.pass', PASS);
  /** 機身與螢幕不變的部分（機身座標）。 */
  face = this.track(new Layer2D(DW, DH, 1.5, { fast: true }));
  /** 每格變的：歌詞、聲波、轉換箭頭、收藏進來的動畫。 */
  dyn = this.track(new Layer2D(DW, DH, 1.5, { fast: true }));
  glow = this.track(new LineBatch(64, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  bilingual = false;
  beats: number[] = [];
  bars: number[] = [];
  tSave = 0;
  // 中文最小 42（機身 px）：換到畫面上約 40
  st: LyricStyle = { family: F.archivo(100, 700), size: V2.lyrMax, minSize: 42, maxWidth: LEFT.w - 80, align: 'center', lineHeight: 1.14 };
  /** 收藏清單裡的留言（預先排好，收藏進來時整塊從上面滑進來）。 */
  saved: HTMLCanvasElement | null = null;
  avoid: Rect[] = [];
  private R = new THREE.Matrix3();
  private q = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();
  private P0 = new THREE.Vector3();

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    const m = this.msg;
    await preloadPair(this.ctx, `${m ? m.text + sigOf(m) : ''}${INVITE_SMALL}${T_LIVE}${T_SRC}${T_ZH}${T_SAVED}${T_EMPTY}${T_REST}${T_BTN}${COUPLE_ZH}FROM THE COUPLE · 新人剛剛收藏No.0123456789⇅★☆●`);
    this.bilingual = hasSubIn(this.ctx);
    const B = au.beatPeriod(s + 0.1);
    this.beats = beatsIn(au, s, e + 0.5);
    this.bars = barsIn(au, s, e + 0.5);
    const b0 = beatAfter(au, s + Math.min(0.3, B * 0.6));
    const bar = barAfter(au, b0 + 0.05);
    this.tSave = bar - b0 < B * 4.5 && e - bar > 1.5 ? bar : b0 + B;
    const act = paperSignal();
    this.st = { ...this.st, active: act, sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.26) };
    this.drawFace();
    this.avoid = [[140, 110, 1220, 780]];
  }

  /** 機身、螢幕底、固定的標籤、收藏清單（留言畫到一張小畫布，render 時滑進來）。 */
  private drawFace() {
    const L = this.face, c = L.ctx, m = this.msg;
    L.clear();
    c.textBaseline = 'alphabetic';
    // ---- 機身：深色霧面塑膠，上緣一點亮
    const g = c.createLinearGradient(0, 0, 0, DH);
    g.addColorStop(0, mixRgba('ink2', 'graphite', 0.32)); g.addColorStop(1, mixRgba('ink2', 'graphite', 0.14));
    c.fillStyle = g;
    c.beginPath(); c.roundRect(0, 0, DW, DH, DR); c.fill();
    // ---- 墨水屏：紙的顏色、很淡的顆粒；左右兩欄中間一條細線
    c.fillStyle = mixRgba('paper', 'bone', 0.4);
    c.beginPath(); c.roundRect(SCR.x, SCR.y, SCR.w, SCR.h, 10); c.fill();
    c.fillStyle = rgba('sepia', 0.1); c.fillRect(RIGHT.x - 7, SCR.y + 26, 1.2, SCR.h - 52);
    // 螢幕上緣的狀態列（很小）
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.55);
    c.fillText(T_LIVE, LEFT.x + 32, SCR.y + 40);
    c.textAlign = 'right'; c.fillText(T_SAVED, RIGHT.x + RIGHT.w - 32, SCR.y + 40); c.textAlign = 'left';
    c.letterSpacing = '0px';
    c.fillStyle = rgba('sepia', 0.12); c.fillRect(SCR.x + 24, SCR.y + 58, SCR.w - 48, 1);
    // ---- 說話鍵的底座、兩邊的小鍵、喇叭孔
    c.fillStyle = mixRgba('ink', 'graphite', 0.2);
    c.beginPath(); c.arc(BTN.x, BTN.y, BTN.r + 12, 0, Math.PI * 2); c.fill();
    for (const [dx, lab] of [[-250, '原 ⇄ 中'], [250, '★']] as [number, string][]) {
      c.fillStyle = mixRgba('ink2', 'graphite', 0.45);
      c.beginPath(); c.roundRect(BTN.x + dx - 70, BTN.y - 24, 140, 48, 24); c.fill();
      c.fillStyle = rgba('bone', 0.6); c.font = font(F.hei(500), 20); c.textAlign = 'center';
      c.fillText(lab, BTN.x + dx, BTN.y + 7); c.textAlign = 'left';
    }
    c.fillStyle = rgba('ink', 0.55);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { c.beginPath(); c.arc(1060 + i * 18, 680 + j * 18, 3.2, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = rgba('bone', 0.3); c.font = font(F.mono(500), 13); c.letterSpacing = '4px';
    c.fillText('POCKET TRANSLATOR', 96, 750);
    c.letterSpacing = '0px';
    // ---- 收藏清單：留言（手寫）與署名，先畫在一張小畫布上
    if (m) {
      const cv = document.createElement('canvas');
      const S = 1.5;
      cv.width = Math.round((MSGR.w + 60) * S); cv.height = Math.round((MSGR.h + 40) * S);
      const cc = cv.getContext('2d')!;
      cc.scale(S, S);
      cc.textBaseline = 'alphabetic';
      const fam = F.hand(700), sig = sigOf(m);
      const blk = fitV2(cc, m.text, fam, MSGR.w - 20, MSGR.h - 70, 1, { lineHeight: 1.3 });
      cc.font = font(F.mono(500), 14); cc.letterSpacing = '3px'; cc.fillStyle = rgba('sepia', 0.5);
      cc.fillText(m.couple ? 'FROM THE COUPLE · 新人' : `No.${String(m.n).padStart(3, '0')}  ·  剛剛收藏`, 70, 26);
      cc.letterSpacing = '0px';
      const top = 50 + Math.max(0, (MSGR.h - 70 - blk.height) * 0.35);
      const pl = placeBlock(cc, blk, fam, sig, 40, top);
      drawBlock(cc, blk, pl, fam, sig, { color: rgba('sepia', 0.95), sigColor: rgba('sepia', 0.72) });
      this.saved = cv;
      this.st = { ...this.st, size: Math.max(42, lyricV2(blk.fit.size)) };
    } else {
      c.fillStyle = rgba('sepia', 0.4); c.font = font(F.hei(500), 24);
      c.fillText(T_EMPTY, MSGR.x + 4, 240);
      c.fillStyle = rgba('sepia', 0.14);
      for (const y of [300, 370, 440]) c.fillRect(MSGR.x + 4, y, MSGR.w - 40, 1.2);
      c.fillStyle = rgba('sepia', 0.72);
      const fit = fitText(c, INVITE_SMALL, F.hand(700), MSGR.w - 40, 120, { min: 26, max: 34, maxLines: 2 });
      c.font = font(F.hand(700), fit.size);
      fit.lines.forEach((ln, i) => c.fillText(ln, MSGR.x + 4, 510 + i * fit.lineHeight));
    }
    L.upload();
  }

  /** 機身座標 → 畫面像素（跟 shader 同一套：傾斜的平面、透視）。 */
  private toScreen(lx: number, ly: number) {
    const v = new THREE.Vector3(lx - DW / 2, ly - DH / 2, 0).applyMatrix3(this.R).add(this.P0);
    return { x: W / 2 + (FOC * v.x) / v.z, y: H / 2 + (FOC * v.y) / v.z };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;

    // ---- 手拿著：很慢地晃，大鼓時輕輕一頓；每個小節線換一點角度
    let barK = 0;
    for (const b of this.bars) if (t >= b) barK = ease.inOutCubic(clamp((t - b) / 0.6)) + this.bars.indexOf(b);
    const yaw = 0.075 + 0.02 * Math.sin(barK * 1.7) + 0.01 * noise1(t * 0.35, 2);
    const pitch = -0.05 + 0.012 * Math.cos(barK * 1.3) + 0.008 * noise1(t * 0.3, 5);
    const roll = -0.022 + 0.006 * noise1(t * 0.25, 8) + 0.004 * f.a.kick;
    this.q.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    this.m4.makeRotationFromQuaternion(this.q);
    this.R.setFromMatrix4(this.m4);
    const push = ease.inOutQuad(prog(t, s, e));
    const z = FOC * (1.04 - 0.035 * push) * (1 - 0.006 * f.a.kick);
    this.P0.set((CX - W / 2) * z / FOC, (CY - H / 2) * z / FOC, z);

    // ---- 每格畫：歌詞、聲波、轉換箭頭、收藏進來
    const D = this.dyn, c = D.ctx;
    D.clear();
    const ly = lyricAt(lyrics, t);
    const sub = ly ? lyricSubOf(ly.line) : null;
    const two = this.bilingual && !!sub;
    const cxL = LEFT.x + LEFT.w / 2;
    let waveY = SOLO_Y + 120;
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 14); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.45);
    if (this.bilingual) {
      c.fillText(T_SRC, LEFT.x + 40, SCR.y + 96);
      c.fillText(T_ZH, LEFT.x + 40, ARROW.y + 56);
      c.fillStyle = rgba('sepia', 0.12);
      c.fillRect(LEFT.x + 40, ARROW.y, ARROW.x - ARROW.r - 16 - LEFT.x - 40, 1.2);
      c.fillRect(ARROW.x + ARROW.r + 16, ARROW.y, LEFT.x + LEFT.w - 40 - ARROW.x - ARROW.r - 16, 1.2);
      waveY = SRC_Y + 60;
    } else {
      c.fillText(T_ZH, LEFT.x + 40, SCR.y + 96);
    }
    c.letterSpacing = '0px';
    let singing = false;
    if (ly) {
      const line = ly.line;
      singing = t >= line.start && t < line.end;
      const lay = layoutLyric(c, mainOnly(line), this.st);
      const lh = lay.size * (this.st.lineHeight ?? 1.18);
      const my = (two ? ZH_Y : SOLO_Y) - ((lay.rows.length - 1) * lh) / 2 + lay.size * 0.36;
      c.save(); c.translate(cxL, my); drawLyric(c, mainOnly(line), t, this.st, lay, ly.k); c.restore();
      if (two && sub) {
        // 原文：上面那一格，照自己的逐字時間亮（副行的規則：安靜一點、不用訊號色，唱到、唱完都是淡一點的墨色）；
        // 字級固定 SUBPX 不縮，放不下折兩行；聲波接在原文最後一行的下面
        const ink = rgba('sepia', 0.76);
        const sst: LyricStyle = { ...this.st, size: SUBPX, minSize: SUBPX, maxWidth: LEFT.w - 60, lineHeight: 1.16, active: ink, sung: ink };
        const sl = layoutLyric(c, sub, sst);
        const y0 = sl.rows.length > 1 ? SRC_Y : SRC_Y + 18;
        c.save(); c.translate(cxL, y0);
        drawLyric(c, sub, t, sst, sl, ly.k);
        c.restore();
        waveY = Math.min(ARROW.y - 50, y0 + (sl.rows.length - 1) * sl.size * 1.16 + 42);
      }
    } else {
      c.textAlign = 'center'; c.font = font(F.hei(500), 24); c.fillStyle = rgba('sepia', 0.4);
      c.fillText(lyrics.has ? '……' : T_REST, cxL, SOLO_Y + 8);
      if (!lyrics.has) { c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillText(`♪  ${song.title}`, cxL, SOLO_Y + 50); c.letterSpacing = '0px'; }
      c.textAlign = 'left';
    }
    // 聲波：聽到人聲時跳（沒有唱就是一條幾乎平的線）
    const amp = (singing ? 0.35 + 0.65 * audio.env('vocal', t) : 0.06) * 16;
    c.fillStyle = rgba('sepia', singing ? 0.6 : 0.25);
    for (let i = 0; i < WAVE.n; i++) {
      const u = i / (WAVE.n - 1);
      const h = 2 + amp * Math.abs(Math.sin(i * 1.7 + t * 11) * 0.6 + noise1(t * 6 + i * 0.37, i) * 0.6) * Math.sin(Math.PI * u);
      c.fillRect(WAVE.x + u * WAVE.w - 2, waveY - h, 4, h * 2);
    }
    // 轉換箭頭：每一拍轉一圈
    if (this.bilingual) {
      let rot = 0;
      for (const b of this.beats) if (t >= b) rot = Math.PI * 2 * (this.beats.indexOf(b) + ease.outCubic(clamp((t - b) / 0.32)));
      c.save();
      c.translate(ARROW.x, ARROW.y);
      c.fillStyle = mixRgba('paper', 'bone', 0.6); c.beginPath(); c.arc(0, 0, ARROW.r + 4, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, ARROW.r, 0, Math.PI * 2); c.stroke();
      c.rotate(rot);
      c.strokeStyle = paperSignal(0.95); c.lineWidth = 3; c.lineCap = 'round';
      for (const d of [0, Math.PI]) {
        c.beginPath(); c.arc(0, 0, 14, d + 0.3, d + Math.PI - 0.3); c.stroke();
        const ax = Math.cos(d + Math.PI - 0.3) * 14, ay = Math.sin(d + Math.PI - 0.3) * 14;
        const tx = -Math.sin(d + Math.PI - 0.3), ty = Math.cos(d + Math.PI - 0.3);
        c.beginPath(); c.moveTo(ax + tx * 6 + ty * 5, ay + ty * 6 - tx * 5); c.lineTo(ax, ay); c.lineTo(ax + tx * 6 - ty * 5, ay + ty * 6 + tx * 5); c.stroke();
      }
      c.restore();
    }
    // 收藏進來：留言那一塊從上面滑進清單、星星填滿（第一個小節線）
    if (this.saved) {
      const k = ease.outCubic(clamp((t - this.tSave) / 0.5));
      const cv = this.saved;
      c.save();
      c.beginPath(); c.rect(RIGHT.x, SCR.y + 64, RIGHT.w, SCR.h - 70); c.clip();
      c.globalAlpha = clamp(k * 1.4);
      c.drawImage(cv, MSGR.x - 40, MSGR.y - 40 - (1 - k) * 80, cv.width / 1.5, cv.height / 1.5);
      c.restore();
      // 星星：先是空心，收藏那一下填滿、彈一下
      const sk = clamp((t - this.tSave - 0.25) / 0.3);
      const sc = 1 + 0.4 * Math.sin(Math.PI * sk);
      c.save(); c.translate(MSGR.x + 6, MSGR.y - 20); c.scale(sc, sc);
      star(c, 13);
      if (sk > 0) { c.fillStyle = paperSignal(0.95); c.fill(); }
      c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 1.4; c.stroke();
      c.restore();
    }
    // 說話鍵：每句開頭被按一下（下沉、暗一點），唱的時候鍵面上的麥克風圖示是訊號色
    const press = ly ? pulse(t, ly.line.start, 0.14) : 0;
    c.save();
    c.translate(BTN.x, BTN.y + 3 * press);
    const bg = c.createRadialGradient(-14, -18, 4, 0, 0, BTN.r);
    bg.addColorStop(0, mixRgba('graphite', 'bone', 0.18 - 0.1 * press)); bg.addColorStop(1, mixRgba('ink2', 'graphite', 0.5 - 0.2 * press));
    c.fillStyle = bg; c.beginPath(); c.arc(0, 0, BTN.r * (1 - 0.04 * press), 0, Math.PI * 2); c.fill();
    c.strokeStyle = singing ? paperSignal(0.95) : rgba('bone', 0.55); c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.roundRect(-8, -24, 16, 28, 8); c.stroke();
    c.beginPath(); c.arc(0, -2, 15, 0.15, Math.PI - 0.15); c.stroke();
    c.beginPath(); c.moveTo(0, 13); c.lineTo(0, 21); c.stroke();
    c.restore();
    D.upload();

    // ---- 地圖：鏡頭慢慢推、地圖往反方向漂（視差）；小飛機沿著航線飛
    const P = this.pass;
    P.u.face!.value = this.face.texture;
    P.u.dyn!.value = D.texture;
    (P.u.R!.value as THREE.Matrix3).copy(this.R);
    (P.u.P0!.value as THREE.Vector3).copy(this.P0);
    P.u.t!.value = t;
    (P.u.drift!.value as THREE.Vector2).set(-30 + 60 * push, -10 + 14 * push);
    const px = 1450 + ((t - s) * 26) % 700;
    const pyArc = 960 - 0.00042 * Math.pow(px - 1250, 2) - 380;
    (P.u.plane!.value as THREE.Vector3).set(px, pyArc, Math.atan(-0.00084 * (px - 1250)));
    let sw = -9, swK = 0;
    for (const b of this.bars) if (t >= b && t < b + 0.8) { const q = ease.outCubic((t - b) / 0.8); sw = lerp(-0.3, 1.9, q); swK = Math.sin(Math.PI * q); }
    P.u.sweep!.value = sw;
    P.u.sweepK!.value = swK;
    P.render(renderer, out);

    // ---- 說話鍵：唱的時候外圈亮（訊號色），每句開頭被按一下
    const G = this.glow;
    G.clear();
    const bc = this.toScreen(BTN.x, BTN.y);
    const bScale = Math.hypot(this.toScreen(BTN.x + 100, BTN.y).x - bc.x, this.toScreen(BTN.x + 100, BTN.y).y - bc.y) / 100;
    const on = singing ? 0.7 + 0.3 * audio.env('vocal', t) : 0.12;
    const sg = LIN.signal;
    const r0 = (BTN.r + 6) * bScale;
    const N = 40;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      G.seg2(bc.x + Math.cos(a0) * r0, bc.y + Math.sin(a0) * r0 * 0.98, bc.x + Math.cos(a1) * r0, bc.y + Math.sin(a1) * r0 * 0.98, 4, [sg[0] * 1.8 * on, sg[1] * 1.8 * on, sg[2] * 1.8 * on], 1);
    }
    G.render(renderer, out);
    return { paper: 1, bloom: 0.3, bloomThreshold: 1.3, halation: 0.05, vignette: 0.3, grain: 0.05, popupAvoid: this.avoid };
  }
}

/** 五角星的路徑（中心在原點）。 */
function star(c: CanvasRenderingContext2D, r: number) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i) c.lineTo(x, y); else c.moveTo(x, y);
  }
  c.closePath();
}
