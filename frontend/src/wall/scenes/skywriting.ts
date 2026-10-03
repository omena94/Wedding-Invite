// 飛機拉煙寫字（亮、雙語）：晴朗的午後，一片暖暖的天空，兩架小螺旋槳飛機在天上拉白煙寫字。
//  - 大飛機在上面寫中文、小飛機在下面寫原文（小一號）：唱到哪裡、飛機就飛到哪裡，煙從機尾噴出來變成字（逐字跟唱：
//    字在唱的那一刻被寫出來、唱完就完整了；飛機尾巴噴煙的地方帶一點訊號色的陽光）。寫好的字慢慢被風吹散：越舊越糊、往右飄、變淡，
//    下一句開始時上一句很快散掉。沒有翻譯的歌：只有大飛機（小飛機不出場，不留空的一排）。純音樂：大飛機寫新人的名字、
//    小飛機寫日期（還沒定日期就寫英文名，兩樣都沒有就只有大飛機）。
//  - 主打留言：左下草地上兩根竹竿撐著的一面布條（麥克筆寫的大字），布條一直被風吹得起伏。照「留言尺寸與版面比例標準 v2」：
//    字 40～60、署名 26～32、布條 ≤ 860 × 430。
//  - 一直在動：雲慢慢飄、雲影掃過地面；每個小節線飛機晃一下機翼、噴一團大一點的煙；右邊機庫旁的風向袋每一拍被風吹起來；
//    遠處的路上有一台小車開過。鏡頭慢慢往上搖一點點。
// 手法：天空、雲、太陽、地面（田、路、樹）是一個全螢幕 shader；煙字是 init() 先做好的字模（一個字兩張：剛噴的、散開的，
// 字形外面一圈一團一團的煙），每格只貼圖（照年紀交叉淡入、飄移）；飛機、布條、風向袋、小車畫在同一張 Canvas 圖層上。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { lyricSubOf, type Line } from '../engine/lyrics';
import { beatAfter, drawHeart, COUPLE_ZH, COUPLE_EN, HAS_LATIN_NAMES, DATE_DOTS, fitPx } from './_motifs';
import { sigOf, layMsgV2, winBars, lastBefore, type MsgLay, type Rect } from './_t23';
import { lyricV2 } from './_v2';
import { B5_TEXT, B5_INVITE, subPx, layBilingual, glyphProgress, glyphTimes, type BGlyph } from './_b5';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'light', paper: true, energy: [0.15, 0.8], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（畫面座標，y 向下）
const HORIZON = 800;
/** 煙字：主行第一排的基線（往下排原文）。 */
const SKY_Y = 262;
const SKY = { x0: 170, x1: 1750 };
/** 布條（v2：≤ 860 × 430）：左緣、下緣（布條往上長）。 */
const BANNER = { x: 118, bottom: 968 };
/** 煙字：黑體 700（再粗的話中文、韓文的筆畫在煙裡會黏在一起）。 */
const FAM_SMOKE = F.hei(700);
const FAM_MSG = F.hand(700);
/** 風：寫好的煙每秒往右飄多少 px、往上多少。 */
const WIND = { x: 7, y: -2.2 };

const SKYPASS = () => new FSPass(/* glsl */ `
  uniform float uT; uniform vec3 uCam;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = vec2(sp.x, (sp.y - uCam.y));
    float hz = ${HORIZON}.0;
    // 天空：上面是比較深、帶這首歌訊號色的天（白煙才看得清楚），往地平線越來越淡到紙色
    float k = clamp(p.y / hz, 0.0, 1.0);
    vec3 top = mix(mix(C_SEPIA, C_SIGNAL, 0.52), C_PAPER, 0.16);
    vec3 col = mix(top, mix(C_PAPER, C_SIGNAL, 0.08), pow(k, 1.25));
    // 太陽：右上角一團暖光
    col += mix(C_EMBER, C_PAPER, 0.4) * 0.35 * exp(-pow(length((p - vec2(1780.0, 40.0)) / 520.0), 2.0));
    // 雲：幾團積雲，慢慢往右飄；上面亮、下面有一點墨色的陰影（像手繪插畫）
    vec2 q = vec2(p.x * 0.0022 - uT * 0.012, p.y * 0.0058);
    float n = fbm(q + vec2(0.0, 3.0), 5);
    float band = smoothstep(0.34, 0.08, abs(p.y - 560.0) / hz) + 0.55 * smoothstep(0.2, 0.0, abs(p.y - 120.0) / hz);
    float cloud = smoothstep(0.1, 0.34, n * band + 0.06);
    float shade = smoothstep(0.0, 0.25, fbm(q + vec2(0.0, 3.0) + vec2(0.0, -0.035), 5) * band - n * band + 0.12);
    vec3 cc = mix(mix(C_PAPER, C_BONE, 0.6), mix(col, C_SEPIA, 0.15), shade * 0.7);
    col = mix(col, cc, cloud * 0.75 * step(p.y, hz) * smoothstep(120.0, 420.0, abs(p.y - 300.0) + 60.0));
    // ---- 地面：遠的田一條一條（淡）、近的草地（深一點），一條小路，一排小樹
    if (p.y > hz) {
      float d = (p.y - hz) / (${H}.0 - hz);
      // 遠的田一條一條（越近越寬），顏色深淺不一；近處的草地
      float row = floor(pow(d, 0.55) * 7.0 + 0.3 * sin(p.x * 0.004));
      float h = hash11(row * 3.7 + 1.0);
      vec3 field = mix(mix(C_PAPER, C_SEPIA, 0.1 + 0.08 * h), mix(C_PAPER, C_SIGNAL, 0.2), step(0.65, h) * 0.5);
      field = mix(field, mix(C_PAPER, C_SEPIA, 0.18), smoothstep(0.4, 1.0, d));
      field *= 0.97 + 0.03 * snoise(vec2(p.x * 0.05, p.y * 0.2));
      col = field;
      // 路：從左下斜到遠處
      float road = abs(p.y - hz - (p.x - 200.0) * 0.07 * (1.0 + d)) - (3.0 + 20.0 * d);
      col = mix(mix(C_PAPER, C_BONE, 0.5), col, smoothstep(-1.0, 1.0, road));
      // 雲影掃過地面
      float cs = smoothstep(0.1, 0.4, fbm(vec2(p.x * 0.0016 - uT * 0.02, p.y * 0.008), 3) + 0.05);
      col *= 1.0 - 0.1 * cs;
      col = mix(mix(C_PAPER, C_SEPIA, 0.45), col, smoothstep(hz, hz + 2.0, p.y));
    }
    // 地平線上的一排小樹（一團一團圓圓的樹冠，有的地方空著）
    float cellx = floor(p.x / 28.0), xl = fract(p.x / 28.0) * 2.0 - 1.0, th = hash11(cellx * 1.93);
    float tr = hz - 2.0 - step(0.3, th) * (7.0 + 12.0 * th) * sqrt(max(0.0, 1.0 - xl * xl));
    col = mix(col, mix(C_PAPER, C_SEPIA, 0.55), smoothstep(tr - 1.0, tr + 1.0, p.y) * step(p.y, hz + 1.0));
    // 右下角（QR 與小字）：乾淨的淡色地面
    col = mix(col, mix(C_PAPER, C_BONE, 0.3), 0.6 * smoothstep(1280.0, 1480.0, sp.x) * smoothstep(760.0, 880.0, sp.y));
    fragColor = vec4(col, 1.0);
  }`, { uT: { value: 0 }, uCam: { value: new THREE.Vector3(1, 0, 0) } });

/** 煙字的一個字：位置、字模（剛噴的、散開的）、寫出來的時間、屬於哪一句（淡出用）。 */
interface Puff { g: BGlyph; fresh: HTMLCanvasElement; old: HTMLCanvasElement; pad: number; base: number; t0: number; t1: number; li: number; sub: boolean }
/** 一句：什麼時候開始、什麼時候散掉；主行與原文的起點終點（飛機飛的路線）。 */
interface SkyLine { start: number; end: number; gone: number; main: Puff[]; sub: Puff[] }

export default class Skywriting extends Scene {
  sky = shared('skywriting.sky', SKYPASS);
  L = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 199 + (this.msg?.id ?? 0) * 47) >>> 0;
  lay: MsgLay | null = null;
  tOn = 0;
  bars: number[] = [];
  lines: SkyLine[] = [];
  hasSub = false;
  bannerCv: HTMLCanvasElement | null = null;
  banner = { w: 0, h: 0 };
  lineT: number[] = [];
  sigT = Infinity;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    const sig = m ? sigOf(m) : '';
    const subs = lines.map((l) => lyricSubOf(l)?.text ?? '').join('');
    await loadText(`${B5_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}${subs}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    const bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    this.bars = winBars(au, s - 4, e + 1);
    const c = this.L.ctx;

    // ---- 留言（布條）
    let msgPx: number | null = null;
    if (m) {
      this.lay = layMsgV2(c, m.text, sig, FAM_MSG, { x: 0, y: 0, w: 660, h: 300 }, { lineHeight: 1.28, maxLines: 5, sigFamily: F.hand(400), align: 'left', valign: 'top' });
      msgPx = this.lay.fit.size;
      const n = this.lay.lines.length;
      this.lineT = this.lay.lines.map((_, i) => this.tOn + beat * 0.25 + (i * Math.min(bar, beat * 4)) / Math.max(1, n));
      this.sigT = (this.lineT[n - 1] ?? this.tOn) + beat * 0.75;
    }
    this.drawBanner();

    // ---- 煙字：一句一句排好，每個字先做字模
    const size = lyricV2(msgPx);
    const cache = new Map<string, ReturnType<typeof smokeGlyph>>();
    const mold = (ch: string, px: number) => {
      const key = `${ch}|${Math.round(px)}`;
      let hit = cache.get(key);
      if (!hit) { hit = smokeGlyph(ch, px, hash(this.seed, cache.size)); cache.set(key, hit); }
      return hit;
    };
    const build = (line: Line, li: number, next: Line | undefined) => {
      const L = layBilingual(c, line, { family: FAM_SMOKE, size, maxW: SKY.x1 - SKY.x0, x: (SKY.x0 + SKY.x1) / 2, y: SKY_Y, lineHeight: 1.3, gap: size * 0.62 + subPx(size) * 1.05, letter: size * 0.06, subLetter: 2 });
      const mk = (g: BGlyph, sub: boolean): Puff => { const [t0, t1] = glyphTimes(g); return { g, ...mold(g.ch, g.size), t0, t1, li, sub }; };
      const gone = next ? next.start - 0.35 : Infinity;
      return { start: line.start, end: line.end, gone, main: L.main.map((g) => mk(g, false)), sub: L.sub.map((g) => mk(g, true)) };
    };
    lines.forEach((ln, i) => this.lines.push(build(ln, i, lines[i + 1])));
    if (!lines.length) {
      // 純音樂：每四小節重寫一次新人的名字與日期（舊的被風吹散，飛機繞回來再寫）。
      // 煙字是 Canvas2D 的字模，中文、英文都寫得出來；小飛機那排沒有東西可寫時就不出場
      const fakes: Line[] = [];
      const second = DATE_DOTS || (HAS_LATIN_NAMES ? COUPLE_EN : '');
      for (let t0 = this.tOn; t0 < e - beat * 2; t0 += bar * 4) fakes.push(fakeLine(COUPLE_ZH, second, t0, beat));
      fakes.forEach((fk, i) => this.lines.push(build(fk, i, fakes[i + 1])));
    }
    this.hasSub = this.lines.some((l) => l.sub.length);
    this.avoid = [[BANNER.x, BANNER.bottom - this.banner.h, this.banner.w, this.banner.h], [SKY.x0, SKY_Y - 70, SKY.x1 - SKY.x0, 200]];
  }

  /** 布條：白布、麥克筆字，先畫好（每格切成直條一條一條貼，做出被風吹的起伏）。 */
  private drawBanner() {
    const lay = this.lay;
    const pad = { x: 54, t: 44, b: 40 };
    let w: number, h: number;
    if (lay) { const [bx, by, bw, bh] = lay.box; w = Math.min(820, Math.max(460, bx + bw + pad.x * 2)); h = Math.min(420, by + bh + pad.t + pad.b); }
    else { w = 600; h = 180; }
    this.banner = { w, h };
    const S = 2, cv = document.createElement('canvas');
    cv.width = w * S; cv.height = h * S;
    const g = cv.getContext('2d')!; g.scale(S, S);
    // 布：白布、邊上縫一圈、布紋
    g.fillStyle = mixRgba('bone', 'paper', 0.3); g.fillRect(0, 0, w, h);
    for (let i = 0; i < h; i += 3) { g.fillStyle = rgba('sepia', 0.025 + 0.02 * hash(this.seed, i, 7)); g.fillRect(0, i, w, 1); }
    g.strokeStyle = rgba('sepia', 0.3); g.setLineDash([7, 5]); g.lineWidth = 1.4; g.strokeRect(10, 10, w - 20, h - 20); g.setLineDash([]);
    // 上下兩條訊號色的滾邊
    g.fillStyle = mixRgba('signal', 'blood', 0.35, 0.9); g.fillRect(0, 0, w, 7); g.fillRect(0, h - 7, w, 7);
    g.textBaseline = 'alphabetic';
    if (lay) {
      g.save(); g.translate(pad.x, pad.t);
      g.fillStyle = rgba('sepia', 0.95); g.font = font(FAM_MSG, lay.fit.size);
      for (const ln of lay.lines) fillHearts(g, ln.text, ln.x, ln.y, lay.fit.size);
      g.font = font(lay.sig.family, lay.sig.size); g.fillStyle = rgba('sepia', 0.75);
      g.fillText(lay.sig.text, lay.sig.x, lay.sig.y);
      g.restore();
    } else {
      // 「給 新人」：名字長的話縮字，不寫出布條
      const to = `給 ${COUPLE_ZH}`;
      g.fillStyle = rgba('sepia', 0.92); g.font = font(FAM_MSG, fitPx(to, FAM_MSG, 46, w - pad.x * 2)); g.fillText(to, pad.x, pad.t + 50);
      g.font = font(F.hei(500), 21); g.fillStyle = rgba('sepia', 0.6); g.letterSpacing = '2px'; g.fillText(B5_INVITE, pad.x, pad.t + 100); g.letterSpacing = '0px';
    }
    this.bannerCv = cv;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    // 鏡頭：切進來時低一點，第一拍往上搖到定位，之後很慢地再往上一點（天空多一點）
    const oy = -40 * (1 - land) + 14 * drift;
    const u = this.sky.u;
    u.uT!.value = t;
    (u.uCam!.value as THREE.Vector3).set(1, oy, 0);
    this.sky.render(renderer, out);

    const c = this.L.ctx;
    this.L.clear();
    c.setTransform(1, 0, 0, 1, 0, oy);
    const tb = lastBefore(this.bars, t), since = t - tb;
    const bi = Math.floor(au.beatAt(t) + 1e-4), bp = au.beatAt(t) - bi;

    // ---- 遠處的機庫、風向袋、路上的小車
    this.drawGround(c, t, bp);

    // ---- 煙字
    for (const ln of this.lines) {
      if (t < ln.start - 1 || t > ln.gone + 1.6) continue;
      // 下一句開始時，這一句很快散掉
      const fadeNext = Number.isFinite(ln.gone) ? 1 - prog(t, ln.gone - 0.2, ln.gone + 1.0) : 1;
      for (const pf of [...ln.main, ...ln.sub]) this.drawPuff(c, pf, t, fadeNext);
    }

    // ---- 飛機：跟著正在寫的字飛（寫完就飛出畫面右邊，下一句前從左邊飛進來）
    const planeAt = (sub: boolean) => {
      let best: { x: number; y: number; on: boolean } | null = null, bestD = Infinity;
      for (const ln of this.lines) {
        const ps = sub ? ln.sub : ln.main;
        if (!ps.length) continue;
        const a = ps[0]!, z = ps[ps.length - 1]!;
        const x0 = a.g.x - 30, x1 = z.g.x + z.g.w;
        let y = a.g.y - a.g.size * 0.38;
        const ta = a.t0, tz = z.t1;
        if (t < ta - 2.5 || t > tz + 3) continue;
        let x: number, on = false;
        if (t < ta) x = x0 - (ta - t) * 420;
        else if (t > tz) { x = x1 + (t - tz) * 420; y = z.g.y - z.g.size * 0.38; }
        else {
          // 正在寫：噴煙口（機尾）在最新寫到的地方，飛機在前面帶路（跟著正在寫的那一排）
          let head = x0;
          for (const p of ps) { const k = glyphProgress(p.g, t); if (k > 0) { head = p.g.x + p.g.w * k; y = p.g.y - p.g.size * 0.38; } }
          x = head; on = true;
        }
        // 正在寫的那一句優先；都沒在寫就挑時間最近的（剛寫完飛出去、或下一句飛進來）
        const dd = on ? -1 : Math.min(Math.abs(t - ta), Math.abs(t - tz));
        if (dd < bestD) { bestD = dd; best = { x, y, on }; }
      }
      return best;
    };
    const big = planeAt(false), small = this.hasSub ? planeAt(true) : null;
    const waggle = since >= 0 && since < 1.2 ? Math.sin(since * 12) * Math.exp(-since / 0.4) * 0.12 : 0;
    // 飛機的原點在機身中間、機尾在 -54：原點放在寫到的地方右邊 76（小飛機 54），機尾離字還有一點空，機身永遠在已經寫好的字前面
    if (big) this.drawPlane(c, big.x + 76, big.y - 6 + 3 * Math.sin(t * 2.1), 1, waggle, big.on, t, bp);
    if (small) this.drawPlane(c, small.x + 54, small.y - 3 + 2 * Math.sin(t * 2.6 + 1), 0.7, -waggle, small.on, t, bp);

    // ---- 遠處一頂降落傘，慢慢往下飄、左右擺（整個窗格從右上飄到地平線附近）
    {
      const u = clamp((t - s) / Math.max(4, e - s + 4));
      const px = 1520 - 160 * u + 26 * Math.sin(t * 0.9), py = 150 + 420 * u;
      const sway = 0.12 * Math.sin(t * 0.9 + 0.6);
      c.save(); c.translate(px, py); c.rotate(sway);
      c.fillStyle = mixRgba('paper', 'bone', 0.5, 0.95);
      c.beginPath(); c.moveTo(-30, 0); c.quadraticCurveTo(0, -38, 30, 0); c.closePath(); c.fill();
      c.fillStyle = mixRgba('signal', 'blood', 0.3, 0.9);
      for (const k of [-1, 1]) { c.beginPath(); c.moveTo(k * 10, -1); c.quadraticCurveTo(k * 12, -26, k * 3, -27); c.lineTo(k * 18, -20); c.quadraticCurveTo(k * 25, -8, k * 21, 0); c.closePath(); c.fill(); }
      c.strokeStyle = rgba('sepia', 0.55); c.lineWidth = 0.9;
      c.beginPath(); for (const k of [-30, -10, 10, 30]) { c.moveTo(k, 0); c.lineTo(0, 34); } c.stroke();
      c.fillStyle = rgba('sepia', 0.8); c.beginPath(); c.arc(0, 37, 3, 0, TAU); c.fill(); c.fillRect(-1.5, 39, 3, 9);
      c.restore();
    }

    // ---- 布條（被風吹的起伏）
    this.drawBannerFrame(c, t, since);

    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, this.L.upload(), out);
    return { paper: 1, bloom: 0.45, vignette: 0.22, grain: 0.04, halation: 0.12, popupAvoid: this.avoid };
  }

  /** 一團煙字：剛噴的清楚、慢慢換成散開的那張；往右上飄、變大一點、變淡。正在寫的字只露出寫到的部分。 */
  private drawPuff(c: CanvasRenderingContext2D, pf: Puff, t: number, fadeNext: number) {
    if (t < pf.t0) return;
    const age = t - pf.t0;
    const g = pf.g;
    const k = clamp((t - pf.t0) / Math.max(0.05, pf.t1 - pf.t0));
    const blur = clamp((age - 1.5) / 6);
    const a = fadeNext * (1 - 0.35 * clamp((age - 4) / 8));
    if (a <= 0.01) return;
    const sc = 1 + 0.018 * age;
    const x = g.x + WIND.x * age, y = g.y + WIND.y * age;
    const cw = pf.fresh.width / 2, ch = pf.fresh.height / 2;
    c.save();
    // 正在寫：只露出寫到的那一段（由左往右）
    if (k < 1) { c.beginPath(); c.rect(x - pf.pad, y - g.size * 1.3, pf.pad + g.w * k + 2, g.size * 2); c.clip(); }
    c.translate(x + g.w / 2, y - g.size * 0.36); c.scale(sc, sc); c.translate(-(g.w / 2), g.size * 0.36);
    if (blur < 1) { c.globalAlpha = a * (1 - blur); c.drawImage(pf.fresh, -pf.pad, -pf.base, cw, ch); }
    if (blur > 0) { c.globalAlpha = a * blur; c.drawImage(pf.old, -pf.pad, -pf.base, cw, ch); }
    c.restore();
    c.globalAlpha = 1;
  }

  /** 螺旋槳小飛機（側面，機頭朝右，上單翼）：機身墨色、一條訊號色的腰線、垂直尾翼、螺旋槳是模糊的一片；寫字時尾巴噴煙。 */
  private drawPlane(c: CanvasRenderingContext2D, x: number, y: number, s: number, roll: number, on: boolean, t: number, bp: number) {
    c.save(); c.translate(x, y); c.rotate(roll * 0.35); c.scale(s, s);
    const ink = mixRgba('sepia', 'ink', 0.25);
    c.fillStyle = ink;
    // 機身：機頭圓、往尾巴收細
    c.beginPath();
    c.moveTo(40, -2); c.bezierCurveTo(40, -9, 30, -10, 20, -10); c.lineTo(-10, -8); c.lineTo(-44, -4); c.lineTo(-46, 1);
    c.lineTo(-10, 5); c.lineTo(20, 7); c.bezierCurveTo(32, 7, 40, 4, 40, -2); c.fill();
    // 垂直尾翼、水平尾翼
    c.beginPath(); c.moveTo(-34, -5); c.lineTo(-47, -24); c.lineTo(-52, -24); c.lineTo(-47, -2); c.fill();
    c.fillRect(-54, -3, 20, 3);
    // 上單翼（側面看是一片薄板）與斜撐
    c.beginPath(); c.roundRect(-6, -17, 34, 5, 2.5); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.6; c.beginPath(); c.moveTo(4, -13); c.lineTo(10, 2); c.moveTo(20, -13); c.lineTo(14, 2); c.stroke();
    // 腰線、座艙窗
    c.fillStyle = mixRgba('signal', 'blood', 0.25); c.fillRect(-40, -1.5, 76, 2.5);
    c.fillStyle = mixRgba('paper', 'bone', 0.5, 0.9); c.beginPath(); c.moveTo(8, -9); c.lineTo(24, -9); c.lineTo(30, -3); c.lineTo(10, -3); c.fill();
    // 起落架
    c.strokeStyle = ink; c.lineWidth = 1.6; c.beginPath(); c.moveTo(16, 6); c.lineTo(12, 14); c.stroke();
    c.fillStyle = ink; c.beginPath(); c.arc(12, 15, 3.2, 0, TAU); c.fill();
    // 螺旋槳：模糊的一片（每一拍閃一下），槳轂
    c.fillStyle = rgba('sepia', 0.22 + 0.18 * (1 - bp)); c.beginPath(); c.ellipse(43, -1, 2.6, 17, 0, 0, TAU); c.fill();
    c.fillStyle = ink; c.beginPath(); c.arc(42, -1, 3, 0, TAU); c.fill();
    // 噴煙口：寫字時機尾一小團暖白的煙（陽光照到一點訊號色）；煙寫成的字就是它的尾巴，不另外拖長煙（會蓋到剛寫好的字）
    if (on) {
      const r = 4 + 2 * Math.sin(t * 30);
      c.fillStyle = mixRgba('bone', 'signal', 0.35, 0.9); c.beginPath(); c.arc(-56, 0, r, 0, TAU); c.fill();
    }
    c.restore();
  }

  /** 地面上的小東西：遠處的機庫、風向袋（每一拍被吹起來）、路上開過去的小車。 */
  private drawGround(c: CanvasRenderingContext2D, t: number, bp: number) {
    const ink = mixRgba('paper', 'sepia', 0.55);
    // 機庫（圓頂的鐵皮屋）
    c.fillStyle = ink;
    c.beginPath(); c.moveTo(1080, HORIZON + 2); c.lineTo(1080, HORIZON - 18); c.quadraticCurveTo(1135, HORIZON - 52, 1190, HORIZON - 18); c.lineTo(1190, HORIZON + 2); c.fill();
    c.fillStyle = mixRgba('paper', 'sepia', 0.3); c.fillRect(1112, HORIZON - 14, 46, 16);
    // 風向袋：一根桿子、一截條紋袋子，每一拍被風吹直、再垂下來
    const px = 1236, py = HORIZON - 4, top = py - 64;
    c.strokeStyle = ink; c.lineWidth = 2.5; c.beginPath(); c.moveTo(px, py); c.lineTo(px, top); c.stroke();
    const lift = 1 - ease.outCubic(clamp(bp / 0.8));
    const ang = 0.25 + 1.0 * lift + 0.08 * Math.sin(t * 7);
    for (let i = 0; i < 4; i++) {
      const r0 = i * 11, r1 = (i + 1) * 11;
      const a0 = Math.PI / 2 - ang * (0.6 + 0.1 * i), a1 = Math.PI / 2 - ang * (0.6 + 0.1 * (i + 1));
      c.fillStyle = i % 2 ? rgba('bone', 0.95) : mixRgba('signal', 'blood', 0.3);
      c.beginPath();
      c.moveTo(px + Math.cos(a0) * r0, top + Math.sin(a0) * r0 - 4 + i * 0.6);
      c.lineTo(px + Math.cos(a1) * r1, top + Math.sin(a1) * r1 - 3 + i * 0.8);
      c.lineTo(px + Math.cos(a1) * r1, top + Math.sin(a1) * r1 + 3 - i * 0.8);
      c.lineTo(px + Math.cos(a0) * r0, top + Math.sin(a0) * r0 + 4 - i * 0.6);
      c.fill();
    }
    // 路上的小車（從左往右，十二秒一趟）
    const u = ((t / 12) % 1 + 1) % 1, cx = lerp(260, 1250, u), cy = HORIZON + (cx - 200) * 0.07 * 1.05 + 4;
    c.fillStyle = mixRgba('signal', 'blood', 0.4); c.beginPath(); c.roundRect(cx - 9, cy - 6, 18, 7, 2); c.fill();
    c.fillStyle = ink; c.fillRect(cx - 5, cy - 9, 9, 4);
  }

  /** 布條：兩根竹竿撐著，切成直條一條一條貼（每條上下起伏一點、明暗一點），像被風吹。 */
  private drawBannerFrame(c: CanvasRenderingContext2D, t: number, since: number) {
    const cv = this.bannerCv!, { w, h } = this.banner, S = 2;
    const x0 = BANNER.x, y0 = BANNER.bottom - h;
    const rise = ease.outBack(prog(t, this.ctx.start, this.tOn + 0.25));
    const yb = y0 + 40 * (1 - rise);
    const gust = since >= 0 && since < 2 ? Math.exp(-since / 0.7) : 0;
    // 竹竿
    c.strokeStyle = mixRgba('sepia', 'signal', 0.2); c.lineWidth = 7; c.lineCap = 'round';
    for (const px of [x0 - 8, x0 + w + 8]) { c.beginPath(); c.moveTo(px, yb - 26); c.lineTo(px, Math.min(1075, yb + h + 150)); c.stroke(); }
    c.lineCap = 'butt';
    // 地上的影子
    c.fillStyle = rgba('sepia', 0.14); c.beginPath(); c.ellipse(x0 + w / 2, Math.min(1070, yb + h + 150), w * 0.55, 12, 0, 0, TAU); c.fill();
    const N = 36, sw = w / N;
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      // 兩端綁在竹竿上不動，中間起伏最大；小節線上的一陣風讓起伏大一點
      const amp = Math.sin(u * Math.PI) * (5 + 9 * gust);
      const ph = t * 3.2 - u * 7.5;
      const dy = Math.sin(ph) * amp;
      const lit = Math.cos(ph) * Math.sin(u * Math.PI) * (0.06 + 0.06 * gust);
      c.drawImage(cv, i * sw * S, 0, sw * S + 1, h * S, x0 + i * sw, yb + dy, sw + 0.6, h);
      if (Math.abs(lit) > 0.005) { c.fillStyle = lit > 0 ? rgba('bone', lit) : rgba('sepia', -lit); c.fillRect(x0 + i * sw, yb + dy, sw + 0.6, h); }
    }
    // 綁繩
    c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 1.5;
    for (const [px, qx] of [[x0 - 8, x0 + 4], [x0 + w + 8, x0 + w - 4]] as const) for (const qy of [yb + 6, yb + h - 6]) { c.beginPath(); c.moveTo(px, qy - 8); c.lineTo(qx, qy); c.stroke(); }
  }
}

/**
 * 煙字的字模：字心是實心的白煙（筆畫分得開、讀得清楚），煙的一團一團與模糊只在筆畫外緣；
 * 字的下緣墊一層很淡的墨色暗影（煙的陰影），白字才從亮天空裡浮出來。散開的那張字心也只稍微糊一點。
 */
function smokeGlyph(ch: string, px: number, seed: number) {
  const pad = Math.ceil(px * 0.45);
  const w = Math.ceil(px * 1.1) + pad * 2, h = Math.ceil(px * 1.5) + pad * 2;
  const S = 2;
  const base = pad + px * 1.08;
  const mkCanvas = () => { const cv = document.createElement('canvas'); cv.width = w * S; cv.height = h * S; const g = cv.getContext('2d', { willReadFrequently: true })!; g.scale(S, S); g.textBaseline = 'alphabetic'; return { cv, g }; };
  // 字心：字形本身
  const core = mkCanvas();
  if (ch === '♥') drawHeart(core.g, pad + px * 0.5, base - px * 0.36, px * 0.8, '#fff');
  else { core.g.font = font(FAM_SMOKE, px); core.g.fillStyle = '#fff'; core.g.fillText(ch, pad, base); }
  // 暗影：字形往外長一點（描一圈粗邊），之後糊開、往下偏
  const halo = mkCanvas();
  halo.g.drawImage(core.cv, 0, 0, w, h);
  if (ch !== '♥') { halo.g.font = font(FAM_SMOKE, px); halo.g.strokeStyle = '#fff'; halo.g.lineWidth = px * 0.12; halo.g.lineJoin = 'round'; halo.g.strokeText(ch, pad, base); }
  // 外緣的煙團：只撒在筆畫的邊上（旁邊有空的地方），不填進筆畫中間
  const puffs = mkCanvas();
  const img = core.g.getImageData(0, 0, w * S, h * S).data;
  const A = (x: number, y: number) => { const ix = Math.floor(x * S), iy = Math.floor(y * S); return ix < 0 || iy < 0 || ix >= w * S || iy >= h * S ? 0 : img[(iy * w * S + ix) * 4 + 3]!; };
  let s = seed * 1e6 >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const step = Math.max(2.5, px / 14), d = Math.max(2, px * 0.05);
  const punct = /[\p{P}\p{S}]/u.test(ch) && ch !== '♥';
  puffs.g.fillStyle = '#fff';
  for (let y = 0; y < h && !punct; y += step) for (let x = 0; x < w; x += step) {
    if (A(x, y) < 120) continue;
    const edge = A(x + d, y) < 40 || A(x - d, y) < 40 || A(x, y + d) < 40 || A(x, y - d) < 40;
    if (!edge || rnd() > 0.55) continue;
    puffs.g.beginPath(); puffs.g.arc(x + (rnd() - 0.5) * step, y + (rnd() - 0.5) * step, px * (0.03 + 0.03 * rnd()), 0, TAU); puffs.g.fill();
  }
  const white = mixRgba('bone', 'paper', 0.2);
  const make = (coreBlur: number, puffBlur: number, shadow: number, puffA: number, coreA: number) => {
    const cv = document.createElement('canvas'); cv.width = w * S; cv.height = h * S;
    const g = cv.getContext('2d')!;
    // 暗影：墨色、往下偏一點、糊開
    g.filter = `blur(${3.5 * S}px)`;
    g.globalAlpha = shadow; g.drawImage(tint(halo.cv, rgba('sepia')), 0, 3 * S);
    // 外緣的煙團
    g.filter = `blur(${puffBlur * S}px)`;
    g.globalAlpha = puffA; g.drawImage(tint(puffs.cv, white), 0, 0);
    // 字心：實心的白
    g.filter = coreBlur > 0 ? `blur(${coreBlur * S}px)` : 'none';
    g.globalAlpha = coreA; g.drawImage(tint(core.cv, white), 0, 0);
    g.filter = 'none'; g.globalAlpha = 1;
    return cv;
  };
  return { fresh: make(0.25, 1.4, 0.45, 0.7, 1), old: make(1.3, 4, 0.25, 0.55, 0.8), pad, base };
}

/** 白色的字模染成某個顏色（source-in）。 */
function tint(src: HTMLCanvasElement, color: string) {
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const g = cv.getContext('2d')!;
  g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

/** 純音樂用的假歌詞行：主行（名字）半拍寫一個字、副行（日期）接在後面。 */
function fakeLine(main: string, sub: string, t0: number, beat: number): Line {
  // k：已經寫了幾個半拍。英文字母一個只給四分之一拍（英文名一個字母一個字母寫，照中文的速度會寫到下一輪還沒寫完）
  let k = 0;
  const mk = (text: string): Line => {
    const chars = Array.from(text);
    const words = chars.map((ch, j) => {
      const st = t0 + k * beat * 0.5;
      const step = /[A-Za-z]/.test(ch) ? 0.5 : 1;
      if (ch.trim()) k += step;
      return { w: ch, start: st, end: st + beat * 0.45 * step, line: 0, index: j, gi: 0, o: chars.slice(0, j).join('').length };
    }).filter((w) => w.w.trim());
    return { i: 0, text, start: t0, end: t0 + k * beat * 0.5, words };
  };
  const line = mk(main);
  if (sub) line.sub = mk(sub);
  return line;
}

/** 麥克筆字（♥ 用自己畫的愛心）。 */
function fillHearts(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  let cx = x;
  for (const part of text.split(/(♥)/u)) {
    if (!part) continue;
    if (part === '♥') { const fs = g.fillStyle; drawHeart(g, cx + size * 0.45, y - size * 0.34, size * 0.72); g.fillStyle = fs; cx += size * 0.95; continue; }
    g.fillText(part, cx, y);
    cx += g.measureText(part).width;
  }
}
