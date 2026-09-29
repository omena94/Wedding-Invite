// 保固卡（亮）：一張「婚姻」的產品保固卡斜放在桌上，鏡頭貼著它。
//  - 第一拍起，購買日期的打孔格在拍點上「喀、喀、喀」被打穿：2027、03、13——打孔機的影子先壓下來，洞才出現（真的洞，看得到底下的桌面），
//    打下來的小圓紙片彈出去。
//  - 同時「消費者意見」欄被原子筆寫上主打留言（這一張的焦點：最大的手寫字），最後署名。
//  - 寄回聯上貼著一張燙金的防偽貼紙「GENUINE · 永久保固」：每個小節線卡片在光下輕輕轉一下（緩進、停住），金箔的反光跟著掃過去。
//  - 時間夠長的窗格：最後一個小節線，「品質保證」的章蓋在寄回聯上（畫面輕輕一震）。
//  - 歌詞在卡片下緣的「使用說明（現場）」，照跟唱規則逐字亮。冷面的小字：品名「婚姻」、型號 AO-2027、保固期限：永久、序號（留言編號）。
//  - 沒有留言：意見欄寫邀請；新人的留言：欄名改成「原廠的話」。純音樂：使用說明欄寫歌名。
// 畫法：_t3 的文件攝影機（透視、景深、桌面）＋這張卡自己的紙：圓角、齒孔、打穿的洞（cut）、燙金貼紙的反光（跟著卡片的角度）都在 shader 裡；
// 字、打孔格、章畫在文件圖層（不會變的先畫在離屏畫布）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { drawLyric, drawMessage, lyricAt, signature, type LyricStyle } from './_motifs';
import { grid, stagger, windowLines, boxLyric, mono, tag, pad3, paperLyric, DocCam, withMips, inkStamp, HUD, EDGE, type Grid, type Pose } from './_t3';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.3, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 文件（卡片）座標，y 向下
const DW = 1600, DH = 1000;
const TS = SCALE * 1.35;
const CARD: [number, number, number, number] = [100, 70, 1400, 860];
const PERF = 1170; // 齒孔（寄回聯撕線）
const X0 = 150, X1 = 1125;
const MSG_BOX = { x: X0, y: 452, w: X1 - X0, h: 300 };
/** 卡片 1 px 在螢幕上約 K px（v2 的字級、留言區是螢幕上的大小，排版時用它換算）；意見欄的字寬 ≤ 820 螢幕 px。 */
const K = 1.06;
const MSG_W = Math.min(MSG_BOX.w - 10, 820 / K);
const LYR = { x: X0, y: 782, w: X1 - X0, h: 118 };
const SEAL = { x: 1328, y: 318, r: 108 };
const MSG_FAM = F.hand(400);
const LYR_FAM = F.archivo(100, 700);
/** 打孔格：年、月、日三排。 */
const PUNCH = { y: 262, h: 30 };
const YEARS = [2025, 2026, 2027, 2028, 2029];
const FIXED = '保固卡品名婚姻型號保固期限永久購買日期年月日消費者意見原廠的話使用說明現場寄回聯永久保固品質保證防偽請寫下你對新人的祝福掃描右下角讓這張卡生效純音樂';

const PAPER_GLSL = /* glsl */ `
uniform vec4 holes[3]; // 打孔：x, y, 半徑, 出現的程度
uniform vec2 sheen;    // 金箔反光的角度（跟著卡片轉）
float cut(vec2 d, float soft) {
  float m = 1.0;
  // 圓角
  vec2 c0 = vec2(${CARD[0]}.0, ${CARD[1]}.0), c1 = c0 + vec2(${CARD[2]}.0, ${CARD[3]}.0);
  vec2 q = max(max(c0 + 30.0 - d, d - (c1 - 30.0)), 0.0);
  m *= 1.0 - smoothstep(30.0 - soft, 30.0 + soft, length(q));
  // 齒孔：一排小圓洞
  vec2 pq = vec2(d.x - ${PERF}.0, mod(d.y - 8.0, 20.0) - 10.0);
  if (d.y > c0.y + 16.0 && d.y < c1.y - 16.0) m *= smoothstep(3.6 - soft, 3.6 + soft, length(pq));
  for (int i = 0; i < 3; i++) if (holes[i].w > 0.0) m *= smoothstep(holes[i].z * holes[i].w - soft, holes[i].z * holes[i].w + soft, length(d - holes[i].xy));
  return m;
}
vec3 paperCol(vec2 d, vec4 fb) {
  // 卡紙：比紙白一點；寄回聯那一半稍微不同的色
  vec3 p = mix(C_PAPER, C_BONE, 0.22) * (0.93 + 0.09 * (fb.r - 0.5) + 0.04 * (fb.g - 0.5));
  if (d.x > ${PERF}.0) p *= mix(vec3(1.0), C_PAPER / max(max(C_PAPER.r, C_PAPER.g), C_PAPER.b), 0.35);
  // 燙金貼紙：訊號色一家子的金箔，條紋跟著角度流動，一道高光掃過（最亮的地方會發光）
  vec2 sd = d - vec2(${SEAL.x}.0, ${SEAL.y}.0);
  float r = length(sd);
  if (r < ${SEAL.r}.0 + 1.5) {
    float band = sin(dot(sd, vec2(0.6, 0.8)) / 26.0 + sheen.x * 9.0) * 0.5 + 0.5;
    float band2 = sin(dot(sd, vec2(-0.8, 0.6)) / 17.0 - sheen.y * 7.0) * 0.5 + 0.5;
    vec3 foil = mix(mix(C_BLOOD * 1.3, C_SIGNAL, band), C_EMBER, band2 * 0.55);
    float streak = exp(-pow((dot(sd, normalize(vec2(1.0, -0.6))) - sheen.x * 260.0) / 34.0, 2.0));
    foil += C_EMBER * streak * 1.1;
    foil *= 0.85 + 0.25 * hash12(floor(d * 0.7)); // 金箔的細顆粒
    float edge = smoothstep(${SEAL.r}.0 + 1.5, ${SEAL.r}.0 - 1.0, r);
    float rim = smoothstep(${SEAL.r}.0 - 12.0, ${SEAL.r}.0 - 6.0, r) * (1.0 - smoothstep(${SEAL.r}.0 - 5.0, ${SEAL.r}.0 - 1.0, r));
    p = mix(p, foil * (1.0 - 0.25 * rim), edge);
  }
  vec2 q = (d - focus) / vec2(900.0, 600.0);
  // 窗外的樹影慢慢在卡上漂
  return p * (0.9 + 0.1 * exp(-dot(q, q))) * (0.94 + 0.07 * dapple(SCR, t));
}
vec3 deskCol(vec2 s, vec4 fb) {
  // 桌面（皮革墊）：細細的顆粒。不要太暗：右下角 QR 旁的深色字要讀得到
  float n = fbm(s / 240.0, 3);
  return mix(C_PAPER, C_SEPIA, 0.3 + 0.04 * n) * (0.88 + 0.12 * fb.r) * (0.9 + 0.1 * (1.0 - s.y / 1080.0)) * (0.87 + 0.14 * dapple(s, t));
}`;

interface Punch { x: number; y: number; r: number; t: number; label: string }

export default class Warranty extends Scene {
  cam = shared('warranty.cam', () => {
    const d = new DocCam(PAPER_GLSL);
    d.pass.u.holes = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
    d.pass.u.sheen = { value: new THREE.Vector2() };
    return d;
  });
  base = this.track(new Layer2D(DW, DH, TS));
  doc = this.track(withMips(new Layer2D(DW, DH, TS, { fast: true })));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  punches: Punch[] = [];
  fit: FitResult | null = null;
  sigSize = 30; lyrMax = 52;
  msgTimes: number[] = [];
  tDone = 0;
  stampCv: HTMLCanvasElement | null = null;
  tStamp = Infinity;
  shift = { x: 0, y: 0 };
  private baseDrawn = false;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const m = this.msg;
    const wl = windowLines(lyrics, s, e);
    await loadText(`${FIXED}${song.title}${m ? m.text + signature(m.name) : ''}${wl.map((l) => l.text).join('')}`);
    // 打孔：2027、03、13，第一拍起一拍一個（窗格短就半拍）
    const pt = stagger(au, g.b0, 3, clamp((e - g.b0) * 0.25, g.beat, g.beat * 2));
    const cellX = (row: number, i: number) => {
      const n = row === 0 ? YEARS.length : row === 1 ? 12 : 31;
      const w = row === 0 ? 72 : row === 1 ? 52 : 28.5;
      return { x: X0 + 90 + i * w + w / 2, w, n };
    };
    const [yy, mm, dd] = [2027, 3, 13];
    this.punches = [
      { ...cellX(0, YEARS.indexOf(yy)), y: PUNCH.y + PUNCH.h / 2, r: 12, t: pt[0]!, label: String(yy) },
      { ...cellX(1, mm - 1), y: PUNCH.y + 40 + PUNCH.h / 2, r: 12, t: pt[1]!, label: '03' },
      { ...cellX(2, dd - 1), y: PUNCH.y + 80 + PUNCH.h / 2, r: 11, t: pt[2]!, label: '13' },
    ];
    // 留言：第二個打孔的時候開始寫，一小節半內寫完
    const tWrite = pt[1]!;
    if (m) {
      // v2：字級是螢幕 px（40～60，依字數），換成卡面 px；可用高度先扣掉署名，署名永遠在最後一行下面
      const c = this.doc.ctx;
      const max = msgMaxFor(m.text) / K, sigEst = sigV2(msgMaxFor(m.text)) / K;
      const boxH = MSG_BOX.h - 10 - (sigEst * 1.5 + max * 0.3);
      const opt = { min: V2.msgMin / K, max, lineHeight: 1.22, maxLines: 5 };
      const byW = fitText(c, m.text, MSG_FAM, MSG_W, boxH, opt);
      const byC = fitClauses(c, m.text, MSG_FAM, MSG_W, boxH, opt);
      this.fit = byC && byC.size >= byW.size * 0.9 ? byC : byW;
      this.sigSize = sigV2(this.fit.size * K) / K;
      this.lyrMax = lyricV2(this.fit.size * K) / K;
      const n = Array.from(this.fit.lines.join('')).length;
      this.msgTimes = stagger(au, tWrite, n, clamp((e - g.b0) * 0.4, g.beat * 2, g.bar * 1.5));
      this.tDone = (this.msgTimes[n - 1] ?? tWrite) + g.beat * 0.5;
    } else { this.tDone = tWrite + g.bar; this.lyrMax = lyricV2(null) / K; }
    const last = g.bars.filter((b) => b >= this.tDone + g.bar * 0.9 && b < e - g.beat * 1.5).pop();
    if (last !== undefined) { this.tStamp = last; this.stampCv = inkStamp('品質保證', 176, true, 31, '永久保固'); }
    // 鏡頭推到最近時：歌詞那一行不能碰到下緣／HUD
    for (let it = 0; it < 3; it++) {
      this.cam.pose(this.pose(e), DW, DH);
      const ps = [this.cam.project(X1, LYR.y + LYR.h), this.cam.project(X0, LYR.y + LYR.h)];
      let up = 0, left = 0;
      for (const p of ps) {
        if (p.y > 1080 - EDGE) up = Math.max(up, p.y - (1080 - EDGE));
        if (p.y > HUD.y - 10 && p.x > HUD.x - 20) left = Math.max(left, p.x - (HUD.x - 20));
      }
      this.shift.y -= up; this.shift.x -= left;
    }
  }

  /** 卡片的角度：每個小節線轉一下（outBack 停住），金箔的反光跟著走；整個窗格慢慢推。 */
  private turn(t: number): { pan: number; tilt: number } {
    const g = this.g;
    let pan = -0.1, tilt = 0.26;
    g.bars.forEach((b, i) => {
      const u = ease.outBack(prog(t, b, b + g.beat * 0.9), 1.2);
      const tp = (hash(i, 17) > 0.5 ? 1 : -1) * (0.06 + 0.05 * hash(i, 3)), tt = (hash(i, 9) - 0.5) * 0.08;
      pan = lerp(pan, clamp(pan + tp, -0.16, 0.14), u);
      tilt = lerp(tilt, clamp(tilt + tt, 0.18, 0.34), u);
    });
    return { pan, tilt };
  }

  private pose(t: number): Pose {
    const slow = ease.inOutCubic(prog(t, this.ctx.start, this.ctx.end));
    const { pan, tilt } = this.turn(t);
    let kick = 0;
    for (const p of this.punches) kick += pulse(t, p.t, 0.08) * 0.006;
    kick += pulse(t, this.tStamp, 0.12) * 0.018;
    return { x: 700, y: 520, z: 1.02 + 0.06 * slow + kick, roll: -0.04 + 0.02 * slow, tilt, pan, sx: 900 + this.shift.x, sy: 530 + this.shift.y };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t;
    if (!this.baseDrawn) { this.drawBase(); this.baseDrawn = true; }
    const D = this.doc; D.clear();
    const c = D.ctx;
    c.drawImage(this.base.canvas, 0, 0, DW, DH);
    // 打穿的洞裡不能還有印刷的字（洞在 shader 裡挖，這裡把那一塊的墨擦掉）
    c.save(); c.globalCompositeOperation = 'destination-out';
    for (const p of this.punches) if (t >= p.t) { c.beginPath(); c.arc(p.x, p.y, p.r + 1, 0, Math.PI * 2); c.fill(); }
    c.restore();
    this.drawPunches(c, t);
    this.drawMsg(c, t);
    // 使用說明（現場）＝歌詞
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = boxLyric(c, ly.line, LYR_FAM, LYR.w, LYR.h - 30, { min: V2.lyrMin / K, max: this.lyrMax, lineHeight: 1.1, maxLines: 2 });
      const y0 = LYR.y + 30 + Math.max(0, (LYR.h - 30 - lay.height) / 2) + lay.size * 0.8;
      c.save(); c.translate(LYR.x, y0);
      const st: LyricStyle = { family: LYR_FAM, size: lay.size, maxWidth: LYR.w, ...paperLyric() };
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else if (!lyrics.has) {
      c.font = font(F.serif(400, true), 40); c.fillStyle = rgba('sepia', 0.6);
      c.fillText(`♪ ${this.ctx.song.title || '純音樂'}`, LYR.x, LYR.y + 92);
    }
    if (this.stampCv && t >= this.tStamp - 0.06) {
      const u = prog(t, this.tStamp - 0.06, this.tStamp + 0.02, ease.inCubic);
      c.save(); c.globalAlpha *= t < this.tStamp ? 0.25 * u : 1;
      c.translate(SEAL.x - 4, 668); c.rotate(0.14); c.scale(lerp(1.6, 1, u), lerp(1.6, 1, u));
      c.drawImage(this.stampCv, -96, -96, 192, 192);
      c.restore();
    }
    D.upload();
    // 洞與金箔（shader）
    const u = this.cam.pass.u;
    const hv = u.holes!.value as THREE.Vector4[];
    this.punches.forEach((p, i) => hv[i]!.set(p.x, p.y, p.r, t >= p.t ? ease.outBack(prog(t, p.t, p.t + 0.06), 2) : 0));
    const { pan, tilt } = this.turn(t);
    (u.sheen!.value as THREE.Vector2).set(pan * 3 + tilt, tilt * 3 - pan);
    this.cam.pose(this.pose(t), DW, DH);
    this.cam.render(renderer, out, {
      tex: D.texture, docW: DW, docH: DH, texScale: TS, rect: CARD, t,
      focus: { x: 640, y: 600 }, focusR: [620, 300], blur: 6, shadow: [12, 22],
    });
    return { paper: 1, bloom: 0.34, vignette: 0.36, grain: 0.05, halation: 0.08 };
  }

  // ------------------------------------------------------------ 不會變的：表頭、打孔格、欄名、寄回聯
  private drawBase() {
    const c = this.base.ctx;
    this.base.clear();
    const ink = (a: number) => rgba('sepia', a);
    const m = this.msg;
    c.textBaseline = 'alphabetic';
    tag(c, '保固卡', X0, 128, { size: 26, color: ink(0.88), tracking: 6, weight: 900 });
    mono(c, 'WARRANTY CARD', X0 + 116, 126, { size: 14, color: ink(0.55), tracking: 4 });
    mono(c, `SN AO2027-0313-${pad3(m?.n ?? 0)}`, X1, 126, { size: 15, color: ink(0.6), align: 'right', tracking: 2 });
    c.fillStyle = ink(0.55); c.fillRect(X0, 146, X1 - X0, 1.5);
    tag(c, '品名：婚姻　　型號：AO-2027　　保固期限：永久', X0, 190, { size: 19, color: ink(0.68), tracking: 2 });
    // 打孔格
    tag(c, '購買日期', X0, 240, { size: 15, color: ink(0.5), tracking: 4 });
    const rows: { label: string; items: string[]; w: number }[] = [
      { label: '年', items: YEARS.map(String), w: 72 },
      { label: '月', items: Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')), w: 52 },
      { label: '日', items: Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')), w: 28.5 },
    ];
    rows.forEach((r, ri) => {
      const y = PUNCH.y + ri * 40;
      tag(c, r.label, X0 + 30, y + 22, { size: 16, color: ink(0.6), tracking: 0 });
      r.items.forEach((it, i) => {
        const x = X0 + 90 + i * r.w;
        c.strokeStyle = ink(0.35); c.lineWidth = 1.1; c.strokeRect(x + 2, y, r.w - 4, PUNCH.h);
        mono(c, it, x + r.w / 2, y + 20, { size: ri === 2 ? 12 : 14, color: ink(0.55), align: 'center', tracking: 0 });
      });
    });
    c.fillStyle = ink(0.35); c.fillRect(X0, MSG_BOX.y - 44, X1 - X0, 1.2); c.fillRect(X0, LYR.y - 12, X1 - X0, 1.2);
    tag(c, m?.couple ? '原廠的話' : '消費者意見', X0, MSG_BOX.y - 14, { size: 16, color: ink(0.5), tracking: 4 });
    tag(c, '使用說明（現場）', LYR.x, LYR.y + 16, { size: 15, color: ink(0.5), tracking: 4 });
    // 寄回聯：小字、燙金貼紙上的字
    tag(c, '寄回聯', PERF + 44, 128, { size: 18, color: ink(0.7), tracking: 6, weight: 700 });
    c.save();
    c.fillStyle = rgba('sepia', 0.78);
    c.font = font(F.ming(900), 34); c.textAlign = 'center';
    c.fillText('永久保固', SEAL.x, SEAL.y + 14);
    c.font = font(F.mono(600), 14); c.letterSpacing = '5px';
    c.fillText('GENUINE', SEAL.x, SEAL.y - 34);
    c.fillText('防偽 · AO', SEAL.x, SEAL.y + 52);
    c.letterSpacing = '0px'; c.textAlign = 'left';
    c.restore();
  }

  // ------------------------------------------------------------ 打孔：影子先壓下來，洞才出現，小紙片彈出去
  private drawPunches(c: CanvasRenderingContext2D, t: number) {
    for (const p of this.punches) {
      // 打孔機的影子（洞出現前 0.12 秒開始壓下來）
      const pre = prog(t, p.t - 0.14, p.t);
      if (pre > 0 && t < p.t + 0.05) {
        c.fillStyle = rgba('sepia', 0.22 * pre);
        c.beginPath(); c.arc(p.x + 10 * (1 - pre), p.y + 14 * (1 - pre), p.r * (1.9 - 0.8 * pre), 0, Math.PI * 2); c.fill();
      }
      // 小圓紙片：往右下彈、轉、越來越遠（影子離得越遠）、淡出
      const a = t - p.t;
      if (a > 0 && a < 0.7) {
        const k = a / 0.7, dir = hash(p.x) > 0.5 ? 1 : -1;
        const x = p.x + dir * (140 * a + 60 * a * a), y = p.y - 220 * a + 700 * a * a, lift = 30 * Math.sin(Math.PI * k);
        c.save(); c.globalAlpha *= 1 - k;
        c.fillStyle = rgba('sepia', 0.18); c.beginPath(); c.ellipse(x + lift, y + lift * 1.3, p.r, p.r * 0.8, 0, 0, Math.PI * 2); c.fill();
        c.translate(x, y); c.rotate(a * 9 * dir); c.scale(1, Math.cos(a * 14));
        c.fillStyle = mixRgba('paper', 'bone', 0.3); c.beginPath(); c.arc(0, 0, p.r, 0, Math.PI * 2); c.fill();
        c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1; c.stroke();
        c.restore();
      }
    }
  }

  // ------------------------------------------------------------ 消費者意見（留言，焦點）
  private drawMsg(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg;
    const pen = mixRgba('sepia', 'blood', 0.12, 0.95);
    if (m && this.fit) {
      const n = this.msgTimes.filter((x) => x <= t).length;
      const top = MSG_BOX.y + 10 + this.fit.size * 0.88;
      drawMessage(c, this.fit, MSG_FAM, MSG_BOX.x, top, { chars: n, color: pen });
      const ks = prog(t, this.tDone, this.tDone + 0.3);
      if (ks > 0) {
        c.save(); c.globalAlpha *= ks;
        // 署名（v2：26～32 px）：最後一行的基線往下讓出下伸部再放，永遠在留言下面
        c.font = font(MSG_FAM, this.sigSize); c.fillStyle = mixRgba('sepia', 'blood', 0.1, 0.78); c.textAlign = 'right';
        c.fillText(signature(m.name), MSG_BOX.x + Math.max(this.fit.width, MSG_W * 0.6), top + (this.fit.lines.length - 1) * this.fit.lineHeight + this.fit.size * 0.3 + this.sigSize * 1.15);
        c.textAlign = 'left';
        c.restore();
      }
    } else if (!m) {
      c.save(); c.globalAlpha *= prog(t, this.g.b0, this.g.b0 + 0.4);
      c.font = font(MSG_FAM, 48); c.fillStyle = mixRgba('sepia', 'ash', 0.3, 0.72);
      c.fillText('請寫下你對新人的祝福，', MSG_BOX.x, MSG_BOX.y + 80);
      c.font = font(MSG_FAM, 38);
      c.fillText('掃描右下角 QR code，讓這張卡生效。', MSG_BOX.x, MSG_BOX.y + 150);
      c.restore();
    }
  }
}
