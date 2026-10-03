// 星圖（照 pdoom 的 ascent 版畫、loom 的細線）：夜空裡，主打留言的每個字是一顆星，仙女棒在拍點上一顆顆點亮、連成星座。
//
// 一個電影畫面的星空（滿版星圖會太亂、背景看不清楚、親友的話也不清楚、不知道該看哪一個）：
//  - 一個焦點：留言用大大的宋體寫在天空的一側（最大、最亮），另一側是它的星座。星旁不再標字、不再有
//    跟留言一樣大的「○○座」標題與拉丁學名、抬頭、星等圖例、圖框刻度帶——星座名只剩星座下方一行 22 px 的小字與座標。
//  - 留言的每個字跟著「自己那顆星」一起亮（淡淡的字 → 訊號色 → 冷卻成紙白），不用標字也看得出對應。
//  - 背景（stars-sky.ts）：夜空、地平線的山稜剪影與遠方的暖光、淡淡的銀河、兩層星野；星圖的經緯網只在星座附近浮出來。
//  - 鏡頭：切進來時天空甩一下再落定（像鏡頭搖過來找到這片星），之後跟著轉儀鐘很慢地轉、慢慢推近，最後一拍加速帶走。
//    山稜比星空跑得快（視差）；留言寫在天上，跟著天空一起很慢地漂。
//  - 歌詞沿著黃道寫（逐字跟唱，唱到哪、黃道就亮到哪，仙女棒騎在線上），字級比留言小一級；純音樂時黃道上是小小的歌名。
//  - 沒有主打留言：星座是新人的名字（一個字一顆星，兩個名字中間一顆愛心），放在上方正中；黃道抬高、歌詞放大當主角；邀請是一行小字。
//  - 命名（最後一顆星亮起後的重拍）：星座下方寫上「{名字}座」與座標（婚禮日期的彩蛋：5 月 20 日 → 赤經 05h20m、
//    2028 年 → 赤緯 +20°28′，星座真的就畫在經緯網的那個位置；還沒定日期就不寫座標）。之後每拍輪流閃一顆星，
//    長窗格有流星、每四小節一道光重描星座。
// v2（留言板太大會很突兀、畫面要一直有動畫）：
//  - 留言縮成天上一側的一小段字（螢幕 40～60 px，整塊 ≤ 620×440，署名 26～32），歌詞 40～52 不比留言大；
//    星座放大到畫面的另一大半，星空才是主角。
//  - 多補的動畫：流星從第二小節起幾乎每小節一顆、銀河亮一點、地平線上方有薄雲慢慢飄過（遮住後面的星）、
//    近山稜線上的草在風裡晃、山腳有幾隻螢火蟲一明一滅地飄。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, measure, type TextLayout } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse, polylineLengths, pointAtLength, TAU } from '../engine/util';
import { fitText, badBreaks, wrap, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { sparkHead, sparkParticles, drawHeart, lyricAt, layoutLyric, beatAfter, barAfter, signature, COUPLE_ZH, NAME_A, NAME_B, DATE, lyricSubOf, subGap, type LyricStyle } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';
import { Sky, makeSkyPass, eclY, type P2 } from './stars-sky';
import { units, unitOfChar, buildConstellation, type Unit, type StarPt, type Zone } from './stars-chart';
// 最早的版面：排程參數在 director.ts 的 PLATES；這裡只宣告雙語（雙語普查通過：有翻譯＋主打留言時中文、原文、留言三樣都清楚）
export const spec: PlateSpecDecl = { bilingual: true };


// 座標彩蛋：婚禮日期 2028-05-20 → 赤經 05h20m（月、日）、赤緯 +20°28′（年份拆兩半）。
// 還沒定日期：星座擺在赤經 6h、赤緯 +20° 附近（經緯網照樣對得起來），不寫座標那一行
const RA_C = DATE ? DATE.m + Math.min(59, DATE.d) / 60 : 6;
const DEC_C = DATE ? Math.floor(DATE.y / 100) + Math.min(59, DATE.y % 100) / 60 : 20;
const pad2 = (n: number) => String(n).padStart(2, '0');
const COORD = DATE ? `RA ${pad2(DATE.m)}h${pad2(DATE.d)}m · Dec +${Math.floor(DATE.y / 100)}°${pad2(DATE.y % 100)}′` : '';

/**
 * 有留言的兩種構圖（種子挑）：留言在左、星座在右，或反過來。留言的高度範圍兩種一樣。
 * v2：留言只佔一側窄窄的一條（寬 ≤ 620），星座放大到另一大半。
 */
const MSG_COMPS: { zone: Zone; mx: number; mw: number }[] = [
  { zone: { x0: 860, y0: 150, x1: 1730, y1: 610 }, mx: 160, mw: 600 },
  { zone: { x0: 200, y0: 150, x1: 1070, y1: 610 }, mx: 1190, mw: 560 },
];
const MSG_Y0 = 250, MSG_Y1 = 690;
/** 沒有留言：新人的星座在上方正中，黃道抬高給放大的歌詞。 */
const NOMSG_ZONE: Zone = { x0: 620, y0: 165, x1: 1300, y1: 440 };
const ECL_NOMSG = -150;
/** 星等 → 星的半徑（px）。 */
const STAR_R = [0, 5.4, 4.4, 3.6, 3.0, 2.5];
/** 歌詞從黃道上的哪裡開始寫、最長寫多長（右端停在 HUD 左邊）。 */
const LYR_X = 160, LYR_W = 1160;
/** 重描用的緩動（反函數很好算：retraceFlash 要知道光什麼時候經過每顆星）。 */
const inOutSine = (u: number) => (1 - Math.cos(Math.PI * clamp(u))) / 2;
/** 鏡頭：天空繞極點轉 phi 時，星座附近大約移動 phi × 這麼多 px（山稜的視差照這個換算）。 */
const SKY_R = 1800;

const FAM_MSG = F.ming(700);
const FAM_LYRIC = F.archivo(100, 700);
const INVITE = ['掃描右下角的 QR code，', '你的祝福也會變成一個星座。'];

interface Glyph { ch: string; x: number; y: number; unit: number }
type Rect = { x0: number; y0: number; x1: number; y1: number };

export default class Stars extends Scene {
  bg = shared('stars.bg', makeSkyPass);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(3200, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 31 + (this.msg?.id ?? 0) * 7919) >>> 0;
  flip = hash(this.seed, 5) < 0.5;
  zone: Zone = NOMSG_ZONE;
  /** 星座在畫面右邊（流星往右劃、仙女棒從右上方飛進來，都離留言遠一點）。 */
  consRight = true;
  /** 天空往哪邊轉（1 = 往右）：留言在右邊時往左轉，留言一路往畫面中間漂、不會擠到邊上。 */
  drift = 1;
  mx = 0; mw = 0;
  us: Unit[] = [];
  pts: StarPt[] = [];
  /** 星座（含星的大小）在靜止座標的範圍：星座名標在它下面、經緯網在它附近浮出來。 */
  cbox: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  name = '';
  sky!: Sky;
  /** 每顆星亮起的時間。 */
  times: number[] = [];
  tLead = 0; t0 = 0; tLast = 0; tName = 0; tExit = 0;
  per = 1;
  phiTot = 0.03;
  leadFrom: P2 = { x: 0, y: 0 };
  eclOff = 0;
  // 留言
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  /** 留言整塊（含署名）在靜止座標的範圍：天空在這裡暗一點、星星退開。 */
  mbox: Rect = { x0: -9999, y0: -9999, x1: -9998, y1: -9998 };
  sigX = 0; sigY = 0; sigSize = 30;
  lyricSize = 48;
  inviteSize = 0; inviteY = 0; inviteBig = false;
  meteors: { t: number; a: P2; b: P2 }[] = [];
  /** 長窗格：每四小節一道光沿著星座的連線從頭跑到尾（重溫點亮的那一刻）。 */
  retrace: { t: number; dur: number }[] = [];
  lyricsInWindow = false;
  /** 這個窗格有原文副行（韓文歌、沒有主打留言）：黃道下方寫原文，邀請往下讓一列。 */
  subInWindow = false;
  glyphCache = new Map<string, TextLayout>();

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.layer.ctx;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    // 這個窗格有沒有原文（有主打留言的窗格，引擎給的歌詞本來就沒有原文）
    this.subInWindow = lyrics.linesIn(s, e).some((l) => lyricSubOf(l));
    if (m) {
      const cp = MSG_COMPS[this.flip ? 1 : 0]!;
      this.zone = cp.zone; this.mx = cp.mx; this.mw = cp.mw;
      this.consRight = !this.flip;
      this.drift = this.flip ? -1 : 1;
    } else {
      this.zone = NOMSG_ZONE;
      this.consRight = !this.flip;
      this.eclOff = ECL_NOMSG;
    }

    // ---- 星：留言拆字；沒有留言就用新人的名字（一個字一顆星，中間一顆愛心）
    const text = m ? m.text : `${NAME_A}♥${NAME_B}`;
    this.us = units(text);
    const coupleName = `${NAME_A}${NAME_B}`;
    let who = m ? (m.couple ? coupleName : m.name || '祝福') : coupleName;
    if (Array.from(who).length > 8) who = Array.from(who).slice(0, 7).join('') + '…';
    this.name = `${who}座`;
    await loadText(`${text}${this.name}${INVITE.join('')}${song.title}${song.artist}${signature(m?.name ?? '')}`);

    const n = this.us.length;
    this.pts = buildConstellation(n, this.zone, this.seed);
    const cb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    this.pts.forEach((p, i) => {
      const r = this.starR(i) * 3;
      cb.x0 = Math.min(cb.x0, p.x - r); cb.x1 = Math.max(cb.x1, p.x + r);
      cb.y0 = Math.min(cb.y0, p.y - r); cb.y1 = Math.max(cb.y1, p.y + r);
    });
    this.cbox = cb;
    const zc = { x: (cb.x0 + cb.x1) / 2, y: (cb.y0 + cb.y1) / 2 };
    this.sky = new Sky(zc, 960 + (hash(this.seed, 9) - 0.5) * 360, RA_C, DEC_C);

    // ---- 時間：第一個拍點點亮第一顆，之後一拍（或半拍、四分之一拍）一顆，兩小節內（也不超過窗格的六成）全部亮完
    const beat = au.beatPeriod(s);
    this.t0 = beatAfter(au, s + Math.min(0.3, beat * 0.5));
    const b0 = au.beatAt(this.t0);
    const budget = Math.max(0.75, Math.min(8, au.beatAt(s + 0.6 * (e - s)) - b0));
    this.per = n <= 1 ? 1 : [1, 2, 4].find((k) => (n - 1) / k <= budget) ?? (n - 1) / budget;
    this.times = this.us.map((_, i) => au.timeOfBeat(b0 + i / this.per));
    this.tLast = this.times[n - 1]!;
    // 命名：最後一顆之後的下一拍；兩拍內有小節線就等小節線（重拍命名比較有份量）
    let tn = au.timeOfBeat(Math.floor(au.beatAt(this.tLast) + 1e-3) + 1);
    const nb = barAfter(au, this.tLast + 0.05);
    if (nb - this.tLast <= 2.05 * beat) tn = Math.max(tn, nb);
    this.tName = tn > e - 0.9 ? Math.max(this.tLast + 0.12, Math.min(tn, e - 0.9)) : tn;
    this.tExit = e - clamp(beat * 0.75, 0.3, 0.55);
    this.tLead = Math.max(s + 0.06, this.t0 - Math.min(0.6, beat * 0.9));
    // 仙女棒從星座外側的上方斜斜落下來點亮第一顆（離留言遠的那一邊）
    const p0 = this.pts[0]!, dir = this.consRight ? 1 : -1;
    this.leadFrom = { x: p0.x + dir * 230, y: Math.max(40, p0.y - 330) };
    // 天空轉多少：留言附近每秒約 2～3 px（讀得舒服），長窗格封頂（留言最多漂 ±20 px，不會出安全邊）
    this.phiTot = Math.min(0.024, (2.4 * (e - s)) / SKY_R);

    // ---- 留言：天空一側的大字（宋體），署名靠右；整塊在留言高度範圍裡上下置中（稍微偏上）
    if (m) {
      const fit = this.fitMessage(c, m.text, MSG_Y1 - MSG_Y0 - 60);
      this.fit = fit;
      this.sigSize = sigV2(fit.size);
      const sigW = measure(this.signature(), F.ming(400), this.sigSize);
      const blockH = fit.size + (fit.lines.length - 1) * fit.lineHeight + 60;
      const top = MSG_Y0 + Math.max(0, (MSG_Y1 - MSG_Y0 - blockH) / 2 - 16);
      const base0 = top + fit.size * 0.92;
      const uoc = unitOfChar(m.text, this.us);
      const src = Array.from(m.text);
      let j = 0;
      fit.lines.forEach((ln, li) => {
        const lay = layout(ln, FAM_MSG, fit.size);
        for (const g of lay.glyphs) {
          while (j < src.length && src[j] !== g.ch) j++;
          const idx = Math.min(j, src.length - 1);
          if (j < src.length) j++;
          this.glyphs.push({ ch: g.ch, x: this.mx + g.x, y: base0 + li * fit.lineHeight, unit: uoc[idx] ?? 0 });
        }
      });
      this.sigY = base0 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.45 + this.sigSize * 1.1;
      this.sigX = this.mx + Math.max(fit.width, sigW);
      this.mbox = { x0: this.mx - 20, y0: top - 10, x1: this.sigX + 20, y1: this.sigY + 14 };
      this.lyricSize = lyricV2(fit.size);
    } else {
      this.lyricSize = lyricV2(null);
      // 邀請：有歌詞時是黃道下方一行小字；純音樂時歌詞不在，邀請放大成兩行（寫在黃道上方）
      this.inviteBig = !this.lyricsInWindow;
      this.inviteSize = this.inviteBig ? 46 : 28;
      this.inviteY = this.inviteBig ? eclY(LYR_X, this.eclOff) - 150 : eclY(LYR_X, this.eclOff) + 64 + (this.subInWindow ? 56 : 0);
    }

    // ---- 流星（v2：多補動畫）：第二小節起幾乎每小節一顆（落在小節線或第三拍），往留言的反方向、劃過星座上方；
    //      仙女棒正在點星的時候不放（同時兩道火會搶戲）
    const barLen = au.timeOfBar(au.barAt(this.tName) + 1) - this.tName;
    for (let b = Math.ceil(au.barAt(s) - 1e-3) + 1; ; b += 1) {
      const tb = au.timeOfBar(b) + (hash(this.seed, b, 15) < 0.4 ? 2 * beat : 0);
      if (tb > e - barLen * 0.6) break;
      if (hash(this.seed, b, 11) < 0.2 || (tb > this.tLead - 0.3 && tb < this.tLast + 0.4)) continue;
      const z = this.zone, r1 = hash(this.seed, b, 12), r2 = hash(this.seed, b, 13), r3 = hash(this.seed, b, 14);
      const fx = 0.08 + 0.4 * r1;
      const a = { x: dir > 0 ? z.x0 + (z.x1 - z.x0) * fx : z.x1 - (z.x1 - z.x0) * fx, y: 112 + 70 * r2 };
      const ang = dir > 0 ? 0.16 + 0.22 * r3 : Math.PI - 0.16 - 0.22 * r3;
      const len = 300 + 150 * r2;
      this.meteors.push({ t: tb, a, b: { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len } });
    }
    if (n > 1) {
      const dur = Math.min(barLen, beat * Math.max(2, Math.ceil((n - 1) / 4)));
      for (let b = Math.round(au.barAt(this.tName)) + 3; ; b += 4) {
        const tb = au.timeOfBar(b);
        if (tb + dur > this.tExit - 0.2) break;
        this.retrace.push({ t: tb, dur });
      }
    }
    // 重描的那一小節不放流星（同時兩道光會搶戲）
    this.meteors = this.meteors.filter((mt) => !this.retrace.some((r) => Math.abs(r.t - mt.t) < barLen * 0.5));
  }

  /** 重描：這一格光跑到第幾條線的哪裡（edges 單位，0 = 第一顆星），不在跑是 -1。 */
  private retraceAt(t: number): number {
    for (const r of this.retrace) if (t >= r.t && t < r.t + r.dur) return inOutSine((t - r.t) / r.dur) * (this.pts.length - 1);
    return -1;
  }
  /** 重描經過第 i 顆星時亮一下。 */
  private retraceFlash(t: number, i: number): number {
    let v = 0;
    for (const r of this.retrace) {
      if (t < r.t || t > r.t + r.dur + 1) continue;
      // inOutSine 的反函數：光在什麼時候到第 i 顆
      const u = i / Math.max(1, this.pts.length - 1), ti = r.t + (Math.acos(1 - 2 * u) / Math.PI) * r.dur;
      v = Math.max(v, pulse(t, ti, 0.2));
    }
    return v;
  }

  /**
   * 鏡頭（天空繞極點轉了多少）：切進來時從一邊甩過來、outExpo 落定；之後大部分等速、三成在每個小節裡緩進緩出
   * （像轉儀鐘一格一格推）；最後一拍加速帶走。方向一路相同，動作才連貫。
   */
  private phiAt(t: number) {
    const au = this.ctx.audio, s = this.ctx.start, e = this.ctx.end;
    const beat = au.beatPeriod(s);
    const p = clamp((t - s) / (e - s));
    const bs = au.barAt(s), nb = Math.max(0.5, au.barAt(e) - bs), bb = clamp(au.barAt(t) - bs, 0, nb);
    const stepped = clamp((Math.floor(bb) + ease.inOutCubic(bb - Math.floor(bb))) / nb);
    const swing = -0.015 * (1 - ease.outExpo(prog(t, s, s + Math.min(1.4, 2.4 * beat))));
    const out = 0.014 * ease.inCubic(prog(t, this.tExit, e));
    return this.drift * (swing + this.phiTot * (0.7 * (p - 0.5) + 0.3 * (stepped - 0.5)) + out);
  }

  /** 最近一次 hi-hat 的編號（背景星用它挑「這一下」要閃哪一小撮）。au.events() 每次掃整首歌，這裡用二分搜尋。 */
  private lastHatIdx(t: number) {
    const list = this.ctx.audio.onsets['hat'];
    if (!list?.length) return 0;
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m]![0] <= t) lo = m + 1; else hi = m; }
    return lo > 0 ? lo % 997 : 0;
  }

  /** 仙女棒在 tt 時的位置（螢幕），不在飛就是 null。粒子會回頭問過去的位置，所以要是 tt 的純函數。 */
  private headAt(tt: number): P2 | null {
    if (tt < this.tLead || tt > this.tLast + 0.28) return null;
    const sky = this.sky, pts = this.pts;
    if (tt < this.t0) {
      const u = ease.inCubic(clamp((tt - this.tLead) / Math.max(1e-3, this.t0 - this.tLead)));
      const a = this.leadFrom, b = pts[0]!;
      return sky.fwd(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
    }
    for (let i = 1; i < pts.length; i++) {
      if (tt >= this.times[i]!) continue;
      const u = this.flight(i, tt);
      const a = pts[pts[i]!.from]!, b = pts[i]!;
      return sky.fwd(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
    }
    const l = pts[pts.length - 1]!;
    return sky.fwd(l.x, l.y);
  }

  /** 第 i 條連線畫到哪（0..1）：一拍一顆時緩出緩入（落在拍點上），快的時候等速。 */
  private flight(i: number, t: number) {
    const u = clamp((t - this.times[i - 1]!) / Math.max(1e-3, this.times[i]! - this.times[i - 1]!));
    return this.per <= 2 ? ease.inOutQuad(u) : u;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const exit = prog(t, this.tExit, e, ease.inCubic);
    const k = prog(t, s, s + 0.3) * (1 - 0.9 * exit);
    const sky = this.sky;
    sky.phi = this.phiAt(t);

    // 留言寫在天上：跟著天空在留言中心的位移平移（不跟著轉，字才一直是正的）
    const mb = this.mbox, mcx = (mb.x0 + mb.x1) / 2, mcy = (mb.y0 + mb.y1) / 2;
    const mc = sky.fwd(mcx, mcy), mdx = this.msg ? mc.x - mcx : 0, mdy = this.msg ? mc.y - mcy : 0;

    // ---- 背景
    const u = this.bg.u;
    const cb = this.cbox, cc = sky.fwd((cb.x0 + cb.x1) / 2, (cb.y0 + cb.y1) / 2);
    u.t!.value = t; u.k!.value = k;
    (u.pole!.value as THREE.Vector2).set(sky.pole.x, sky.pole.y);
    (u.seedOff!.value as THREE.Vector2).set(hash(this.seed, 1), hash(this.seed, 2));
    u.phi!.value = sky.phi; u.rPole!.value = sky.rPole; u.ra0!.value = sky.ra0;
    u.hat!.value = f.a.hat;
    u.hatIdx!.value = this.lastHatIdx(t);
    (u.quiet!.value as THREE.Vector4).set(mb.x0 + mdx, mb.y0 + mdy, mb.x1 + mdx, mb.y1 + mdy);
    (u.chart!.value as THREE.Vector3).set(cc.x, cc.y, Math.max(cb.x1 - cb.x0, cb.y1 - cb.y0) * 0.55 + 160);
    // 銀河斜斜地從星座那一側的上方穿過去（不經過留言）
    const mwAng = (this.consRight ? -0.62 : 0.62) + (hash(this.seed, 3) - 0.5) * 0.3;
    (u.mw!.value as THREE.Vector3).set(mwAng, Math.cos(mwAng) * cc.x + Math.sin(mwAng) * cc.y + (hash(this.seed, 4) - 0.5) * 220, 170);
    u.eclOff!.value = this.eclOff;
    u.eclK!.value = this.lyricsInWindow ? 1 : 0.6;
    (u.ridge!.value as THREE.Vector2).set(-sky.phi * SKY_R * 1.05, -sky.phi * SKY_R * 1.5);
    this.bg.render(renderer, out);

    const Lr = this.layer; Lr.clear();
    const c = Lr.ctx;
    this.glow.clear();
    c.globalAlpha = k;
    c.textBaseline = 'alphabetic';

    // 星的螢幕位置（天空在轉）
    const sp = this.pts.map((p) => sky.fwd(p.x, p.y));
    this.drawConstellation(c, t, sp, f);
    this.drawName(c, t);
    const lyricHead = this.drawEcliptic(c, t);
    c.save();
    c.translate(mdx, mdy);
    this.drawMessage(c, t);
    c.restore();
    this.drawInvite(c, t);
    comp.draw(renderer, Lr.upload(), out);

    // ---- 發光的東西（加亮疊上去）
    this.glowStars(t, sp, f);
    const I = 1 - exit;
    const head = this.headAt(t);
    if (head && exit < 0.5) {
      sparkParticles(this.glow, t, (tt: number) => this.headAt(tt), { rate: 90, life: 0.34, speed: 200, seed: this.seed % 997, intensity: I });
      // 飛進來的那一段沒有連線可拖，拖一小段會熄的尾巴
      if (t < this.t0 + 0.05) {
        let prev = head;
        for (let q = 1; q <= 9; q++) {
          const p = this.headAt(t - q * 0.016);
          if (!p) break;
          const a = (1 - q / 10) * I;
          this.glow.seg2(prev.x, prev.y, p.x, p.y, 2.2 * (1 - q / 12), [LIN.signal[0] * 2.4 * a, LIN.signal[1] * 2.4 * a, LIN.signal[2] * 2.4 * a], a);
          prev = p;
        }
      }
      sparkHead(this.glow, head.x, head.y, t, 1, I);
    }
    if (lyricHead && exit < 0.5) {
      // 星座的仙女棒在飛的時候，黃道上的小一點、安靜一點（畫面上不要兩團一樣大的火）
      if (!head) sparkParticles(this.glow, t, () => lyricHead, { rate: 40, life: 0.26, speed: 140, seed: 5, intensity: 0.75 * I });
      sparkHead(this.glow, lyricHead.x, lyricHead.y, t, head ? 0.5 : 0.7, (head ? 0.55 : 0.85) * I);
    }
    this.drawMeteors(t, I);
    this.drawFireflies(t, I * k);
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.75, vignette: 0.6, halation: 0.28, zoom: 1 + 0.024 * f.p + 0.018 * exit };
  }

  // ------------------------------------------------------------------ 星座
  private drawConstellation(c: CanvasRenderingContext2D, t: number, sp: P2[], f: Frame) {
    const pts = this.pts, n = pts.length, s = this.ctx.start;
    // 連線：一條細線，兩端離星留一點空（古星圖的畫法），大鼓一打亮一點
    c.save();
    c.strokeStyle = rgba('bone', 0.3 + 0.18 * f.a.kick);
    c.lineWidth = 1.1;
    c.beginPath();
    for (let i = 1; i < n; i++) {
      if (t < this.times[i - 1]!) break;
      const a = sp[pts[i]!.from]!, b = sp[i]!;
      const u = t >= this.times[i]! ? 1 : this.flight(i, t);
      const seg = this.trimmed(a, b, this.starR(pts[i]!.from) + 7, u >= 1 ? this.starR(i) + 7 : 0, u);
      if (!seg) continue;
      c.moveTo(seg[0].x, seg[0].y); c.lineTo(seg[1].x, seg[1].y);
    }
    c.stroke();
    c.restore();
    // 星：還沒亮的是很淡的一點（進場時一顆顆浮出來），亮了是實心的星，亮星有很細的十字
    const span = Math.min(0.55, this.t0 - s - 0.1);
    for (let i = 0; i < n; i++) {
      const p = sp[i]!, r = this.starR(i), ti = this.times[i]!;
      if (t < ti) {
        const appear = prog(t, s + 0.12 + (i / Math.max(1, n)) * span, s + 0.3 + (i / Math.max(1, n)) * span);
        if (appear <= 0) continue;
        c.fillStyle = rgba('bone', 0.3 * appear);
        c.beginPath(); c.arc(p.x, p.y, 1.7, 0, TAU); c.fill();
        continue;
      }
      const heat = Math.exp(-(t - ti) / 0.35);
      if (this.us[i]!.heart) {
        // 愛心星不發光（只用點綴色）：點亮時大一下，命名後輪到它的那一拍「跳」一下
        drawHeart(c, p.x, p.y - 1, 19 * (1 + 0.5 * heat + 0.3 * this.chase(t, i) + 0.3 * this.retraceFlash(t, i)), rgba('rose'));
        continue;
      }
      c.fillStyle = heat > 0.05 ? mixRgba('bone', 'ember', heat) : rgba('bone', 0.96);
      c.beginPath(); c.arc(p.x, p.y, r * (1 + 0.4 * heat), 0, TAU); c.fill();
      if (pts[i]!.mag <= 2) {
        c.strokeStyle = rgba('bone', 0.4);
        c.lineWidth = 1;
        const L = r * (pts[i]!.mag === 1 ? 3.6 : 2.8);
        c.beginPath();
        c.moveTo(p.x - L, p.y); c.lineTo(p.x + L, p.y);
        c.moveTo(p.x, p.y - L); c.lineTo(p.x, p.y + L);
        c.stroke();
      }
    }
  }

  /** 命名：星座下方一行小字「○○座」與座標（婚禮日期的彩蛋），跟著天空走。 */
  private drawName(c: CanvasRenderingContext2D, t: number) {
    const tn = this.tName;
    const nk = prog(t, tn, tn + 0.5, ease.outCubic);
    if (nk <= 0) return;
    const cb = this.cbox;
    const p = this.sky.fwd(cb.x0 + 6, cb.y1 + 44);
    const heat = Math.exp(-(t - tn) / 0.7);
    c.save();
    c.globalAlpha *= nk;
    c.font = font(F.ming(700), 22); c.letterSpacing = '8px';
    c.fillStyle = heat > 0.04 ? mixRgba('bone', 'signal', heat, 0.7) : rgba('bone', 0.62);
    c.fillText(this.name, p.x, p.y + 6 * (1 - nk));
    c.letterSpacing = '0px';
    const nc = Math.floor(COORD.length * prog(t, tn + 0.15, tn + 0.75));
    if (nc > 0) {
      c.font = font(F.mono(500), 13); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.55);
      c.fillText(COORD.slice(0, nc), p.x, p.y + 28);
      c.letterSpacing = '0px';
    }
    c.restore();
  }

  /** 命名之後每拍輪流閃一顆：第 i 顆這一格閃多少（0..1）。 */
  private chase(t: number, i: number) {
    if (t < this.tName) return 0;
    const au = this.ctx.audio, n = this.pts.length;
    const bi = Math.floor(au.beatAt(t) + 1e-4), bn = Math.round(au.beatAt(this.tName));
    return (((bi - bn) % n) + n) % n === i ? pulse(t, au.timeOfBeat(bi), 0.16) : 0;
  }

  private starR(i: number) { return this.us[i]!.heart ? 9 : STAR_R[this.pts[i]!.mag]!; }

  /** a→b 畫到 u，兩端各退 ra、rb。回傳要畫的那一段。 */
  private trimmed(a: P2, b: P2, ra: number, rb: number, u: number): [P2, P2] | null {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L < 1e-3) return null;
    const s0 = ra / L, s1 = Math.min(u, 1 - rb / L);
    if (s1 <= s0) return null;
    return [{ x: a.x + dx * s0, y: a.y + dy * s0 }, { x: a.x + dx * s1, y: a.y + dy * s1 }];
  }

  /** 亮著的星的光暈、剛點亮的光圈、剛畫好還燙的連線、命名後每拍輪流閃一顆。 */
  private glowStars(t: number, sp: P2[], f: Frame) {
    const au = this.ctx.audio, lb = this.glow, n = this.pts.length;
    const S = LIN.signal, E = LIN.ember;
    const fade = 1 - prog(t, this.tExit, this.ctx.end, ease.inCubic);
    // 命名的那一下：整個星座亮一下
    const named = pulse(t, this.tName, 0.25);
    // 命名之後：每一拍輪流閃一顆（小節線那一顆閃大一點）
    let gi = -1, gk = 0, down = false;
    if (t >= this.tName) {
      const bi = Math.floor(au.beatAt(t) + 1e-4), bn = Math.round(au.beatAt(this.tName));
      const tb = au.timeOfBeat(bi);
      gi = (((bi - bn) % n) + n) % n;
      gk = pulse(t, tb, 0.16);
      down = Math.abs(au.barAt(tb) - Math.round(au.barAt(tb))) < 0.02;
    }
    for (let i = 0; i < n; i++) {
      const ti = this.times[i]!, p = sp[i]!;
      if (t < ti) continue;
      const heat = Math.exp(-(t - ti) / 0.35);
      const tw = 0.9 + 0.1 * Math.sin(t * (2.1 + (i % 5) * 0.7) + i);
      const gl = (i === gi ? gk * (down ? 1.6 : 0.9) : 0) + named * 1.1 + this.retraceFlash(t, i) * 2.4;
      const I = fade * (tw + 3 * heat + gl + 0.2 * f.a.kick);
      if (!this.us[i]!.heart) {
        const r = this.starR(i);
        lb.seg2(p.x, p.y, p.x + 0.01, p.y, r * 5, [S[0] * 0.4 * I, S[1] * 0.4 * I, S[2] * 0.4 * I], 0.24);
        lb.seg2(p.x, p.y, p.x + 0.01, p.y, r * 2, [E[0] * 1.3 * I, E[1] * 1.3 * I, E[2] * 1.3 * I], 0.8);
      }
      // 點亮的光圈：一圈細線往外擴散
      const tr = t - ti;
      if (tr < 0.55) {
        const R = this.starR(i) + 4 + 40 * ease.outCubic(tr / 0.55), a = (1 - tr / 0.55) ** 2 * fade;
        const col: [number, number, number] = [S[0] * 2 * a, S[1] * 2 * a, S[2] * 2 * a];
        for (let q = 0; q < 28; q++) {
          const a0 = (q / 28) * TAU, a1 = ((q + 1) / 28) * TAU;
          lb.seg2(p.x + Math.cos(a0) * R, p.y + Math.sin(a0) * R, p.x + Math.cos(a1) * R, p.y + Math.sin(a1) * R, 1.2, col, a);
        }
      }
      // 閃的那一顆：十字光芒（愛心星改成在畫布上跳一下，見 drawConstellation）
      if (i === gi && gk > 0.03 && !this.us[i]!.heart) {
        const L = (down ? 38 : 22) * (0.4 + 0.6 * gk), a = gk * fade;
        const col: [number, number, number] = [E[0] * 2 * a, E[1] * 2 * a, E[2] * 2 * a];
        for (let q = 0; q < 4; q++) {
          const ang = (q * TAU) / 4 + 0.001;
          lb.seg2(p.x, p.y, p.x + Math.cos(ang) * L, p.y + Math.sin(ang) * L, 1.1, col, a);
        }
      }
    }
    // 重描：一小段燙的光沿著連線跑，前頭一顆小火花
    const rp = this.retraceAt(t);
    if (rp >= 0) {
      const ei = Math.min(n - 1, Math.floor(rp) + 1), uu = rp - (ei - 1);
      const a = sp[this.pts[ei]!.from]!, b = sp[ei]!;
      const hx = a.x + (b.x - a.x) * uu, hy = a.y + (b.y - a.y) * uu;
      const tail = Math.max(0, uu - 0.45);
      for (let q = 0; q < 6; q++) {
        const u0 = tail + ((uu - tail) * q) / 6, u1 = tail + ((uu - tail) * (q + 1)) / 6, w = ((q + 1) / 6) ** 2 * fade;
        lb.seg2(a.x + (b.x - a.x) * u0, a.y + (b.y - a.y) * u0, a.x + (b.x - a.x) * u1, a.y + (b.y - a.y) * u1, 2, [S[0] * 3 * w, S[1] * 3 * w, S[2] * 3 * w], w);
      }
      sparkHead(lb, hx, hy, t, 0.6, fade);
    }
    // 剛畫好的連線還是燙的：訊號色，約半秒冷卻
    for (let i = 1; i < n; i++) {
      const t1 = this.times[i]!;
      if (t < this.times[i - 1]!) break;
      const heat = t < t1 ? 1 : Math.exp(-(t - t1) / 0.45);
      if (heat < 0.03) continue;
      const a = sp[this.pts[i]!.from]!, b = sp[i]!;
      const u = t >= t1 ? 1 : this.flight(i, t);
      const seg = this.trimmed(a, b, this.starR(this.pts[i]!.from) + 7, u >= 1 ? this.starR(i) + 7 : 0, u);
      if (!seg) continue;
      const I = heat * fade * 2.2;
      lb.seg2(seg[0].x, seg[0].y, seg[1].x, seg[1].y, 1.6, [S[0] * I, S[1] * I, S[2] * I], Math.min(1, heat * 1.3));
    }
  }

  /** 流星：一顆火星拖著細尾巴劃過去，半秒（跟著天空轉）。 */
  private drawMeteors(t: number, I: number) {
    const S = LIN.signal, sky = this.sky;
    for (const m of this.meteors) {
      const u = (t - m.t) / 0.55;
      if (u < 0 || u > 1) continue;
      const hk = ease.outCubic(u), tk = ease.outCubic(Math.max(0, u - 0.4));
      const h = sky.fwd(m.a.x + (m.b.x - m.a.x) * hk, m.a.y + (m.b.y - m.a.y) * hk);
      const tl = sky.fwd(m.a.x + (m.b.x - m.a.x) * tk, m.a.y + (m.b.y - m.a.y) * tk);
      const a = (1 - u) * I;
      for (let q = 0; q < 10; q++) {
        const u0 = q / 10, u1 = (q + 1) / 10, w = u1 * u1;
        const col: [number, number, number] = [S[0] * 3 * a * w, S[1] * 3 * a * w, S[2] * 3 * a * w];
        this.glow.seg2(tl.x + (h.x - tl.x) * u0, tl.y + (h.y - tl.y) * u0, tl.x + (h.x - tl.x) * u1, tl.y + (h.y - tl.y) * u1, 1 + 1.3 * w, col, Math.min(1, a * w * 1.3));
      }
      sparkHead(this.glow, h.x, h.y, t, 0.55, a);
    }
  }

  /**
   * 山腳的螢火蟲（v2 多補的環境動態）：十幾顆小光點在近山前面慢慢飄，各自的節奏一明一滅。
   * 只在畫面左邊到中間（右下角是 QR 區），高度在歌詞下面，不搶字。
   */
  private drawFireflies(t: number, I: number) {
    const E = LIN.ember, lb = this.glow;
    for (let k = 0; k < 16; k++) {
      const h1 = hash(this.seed, k, 31), h2 = hash(this.seed, k, 32), h3 = hash(this.seed, k, 33);
      const x = 90 + 1230 * h1 + 50 * Math.sin(t * (0.2 + 0.2 * h2) + k) + 18 * Math.sin(t * 0.9 + k * 2);
      const y = 925 + 115 * h2 + 22 * Math.sin(t * (0.35 + 0.3 * h3) + k * 1.7);
      const per = 1.8 + 2.4 * h3, ph = (((t + h1 * 7) % per) + per) % per / per;
      const b = Math.pow(Math.max(0, 1 - Math.abs(ph - 0.3) / 0.2), 2) * I;
      if (b < 0.02) continue;
      lb.seg2(x, y, x + 0.01, y, 13, [E[0] * 0.35 * b, E[1] * 0.35 * b, E[2] * 0.35 * b], 0.3);
      lb.seg2(x, y, x + 0.01, y, 3.4, [E[0] * 2.2 * b, E[1] * 2.2 * b, E[2] * 2.2 * b], 1);
    }
  }

  // ------------------------------------------------------------------ 黃道上的歌詞
  /** 歌詞沿著黃道寫，照跟唱規則逐字亮；唱到哪，黃道就亮到哪。回傳仙女棒的位置（正在唱時）。 */
  private drawEcliptic(c: CanvasRenderingContext2D, t: number): P2 | null {
    const { lyrics, song } = this.ctx, sky = this.sky, s = this.ctx.start;
    // 這一格的黃道（螢幕折線）與從 x = LYR_X 起算的弧長
    const pts: P2[] = [];
    for (let x = -120; x <= 2040; x += 12) pts.push(sky.fwd(x, eclY(x, this.eclOff)));
    const L = polylineLengths(pts);
    let i0 = 0;
    while (i0 < pts.length - 2 && pts[i0 + 1]!.x < LYR_X) i0++;
    const s0 = L[i0]! + (LYR_X - pts[i0]!.x) / Math.max(1e-3, pts[i0 + 1]!.x - pts[i0]!.x) * (L[i0 + 1]! - L[i0]!);
    const at = (sv: number) => pointAtLength(pts, L, s0 + sv);

    if (!this.lyricsInWindow) {
      // 純音樂：黃道上一行小小的歌名（安靜的斜體）
      const txt = `♪  ${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
      c.save();
      c.globalAlpha *= prog(t, s + 0.4, s + 1.2);
      c.font = font(F.serif(400, true), 26);
      c.fillStyle = rgba('bone', 0.5);
      const lay = this.glyphLayout(`title|${txt}`, txt, F.serif(400, true), 26);
      for (const g of lay.glyphs) {
        const p = at(g.x + g.w / 2);
        if (p.x > 1330) break;
        c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
        c.fillText(g.ch, -g.w / 2, -14);
        c.restore();
      }
      c.restore();
      return null;
    }
    const ly = lyricAt(lyrics, t);
    if (!ly) return null;
    const st: LyricStyle = { family: FAM_LYRIC, size: this.lyricSize, minSize: V2.lyrMin, maxWidth: LYR_W };
    const lay = layoutLyric(c, ly.line, st);
    const size = lay.size;
    // 新的一行從黃道上浮起來
    const rise = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.25));
    c.save();
    c.globalAlpha *= ly.k;
    c.font = font(FAM_LYRIC, size);
    let head: P2 | null = null, sungTo = 0;
    const row0 = lay.rows[0]!;
    for (const pw of lay.words) {
      const pr = Lyrics.wordProgress(pw.word, t);
      const row = pw.y > 0 ? 1 : 0;
      // 第一行在黃道上面、第二行（很長的句子才有）在黃道下面
      const off = row === 0 ? 18 + (1 - rise) * 26 : -(size + 16) + (1 - rise) * 26;
      const gl = this.glyphLayout(`${pw.word.gi}|${size}`, pw.word.w, FAM_LYRIC, size);
      const wipe = pr * pw.w;
      for (const g of gl.glyphs) {
        const p = at(pw.x + g.x + g.w / 2);
        const nx = Math.sin(p.angle), ny = -Math.cos(p.angle);
        const loc = clamp((wipe - g.x) / Math.max(1, g.w));
        c.save();
        c.translate(p.x + nx * off, p.y + ny * off);
        c.rotate(p.angle);
        if (loc < 1) { c.fillStyle = rgba('bone', 0.3); c.fillText(g.ch, -g.w / 2, 0); }
        if (loc > 0) {
          c.beginPath(); c.rect(-g.w / 2 - 3, -size * 1.15, g.w * loc + (loc >= 1 ? 6 : 3), size * 1.6); c.clip();
          c.fillStyle = pr < 1 ? rgba('signal') : rgba('bone', 0.94);
          c.fillText(g.ch, -g.w / 2, 0);
        }
        c.restore();
      }
      if (pr > 0) sungTo = Math.max(sungTo, row === 0 ? pw.x + wipe : row0.width);
      if (pr > 0 && pr < 1) { const p = at(pw.x + wipe); head = { x: p.x, y: p.y }; }
    }
    // 原文副行（韓文歌）：寫在黃道下方（中文在上、原文在下，黃道夾在中間）；中文折兩行時接在第二行下面。
    // 比中文安靜：唱到、唱完都是紙白淡兩成，不帶仙女棒、不亮黃道
    const sub = lyricSubOf(ly.line);
    if (sub && lay.sub) {
      const sl = lay.sub.lay, ss = sl.size;
      c.font = font(FAM_LYRIC, ss);
      for (const pw of sl.words) {
        const pr = Lyrics.wordProgress(pw.word, t);
        const below = lay.rows.length > 1 ? size + 16 + subGap(size, ss) : ss + 16;
        const off = -(below + pw.y) + (1 - rise) * 26;
        const gl = this.glyphLayout(`sub|${pw.word.w}|${ss}`, pw.word.w, FAM_LYRIC, ss);
        const wipe = pr * pw.w;
        for (const g of gl.glyphs) {
          const p = at(pw.x + g.x + g.w / 2);
          const nx = Math.sin(p.angle), ny = -Math.cos(p.angle);
          const loc = clamp((wipe - g.x) / Math.max(1, g.w));
          c.save();
          c.translate(p.x + nx * off, p.y + ny * off);
          c.rotate(p.angle);
          if (loc < 1) { c.fillStyle = rgba('bone', 0.3); c.fillText(g.ch, -g.w / 2, 0); }
          if (loc > 0) {
            c.beginPath(); c.rect(-g.w / 2 - 3, -ss * 1.15, g.w * loc + (loc >= 1 ? 6 : 3), ss * 1.6); c.clip();
            c.fillStyle = rgba('bone', 0.94 * 0.8);
            c.fillText(g.ch, -g.w / 2, 0);
          }
          c.restore();
        }
      }
    }
    // 唱過的那段黃道：訊號色的細線（像進度條），筆尖那一小段是燙的
    if (sungTo > 2) {
      c.strokeStyle = rgba('signal', 0.6);
      c.lineWidth = 1.6;
      c.beginPath();
      for (let sv = 0; sv <= sungTo; sv += 10) { const p = at(Math.min(sv, sungTo)); if (sv === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y); }
      const pe = at(sungTo); c.lineTo(pe.x, pe.y);
      c.stroke();
      if (head) {
        const S = LIN.signal;
        for (let q = 0; q < 8; q++) {
          const a = at(Math.max(0, sungTo - (q + 1) * 9)), b = at(Math.max(0, sungTo - q * 9)), w = (1 - q / 8) * ly.k;
          this.glow.seg2(a.x, a.y, b.x, b.y, 1.8, [S[0] * 2.2 * w, S[1] * 2.2 * w, S[2] * 2.2 * w], w);
        }
      }
    }
    c.restore();
    return head;
  }

  private glyphLayout(key: string, text: string, family: string, size: number): TextLayout {
    let g = this.glyphCache.get(key);
    if (!g) { g = layout(text, family, size); this.glyphCache.set(key, g); }
    return g;
  }

  // ------------------------------------------------------------------ 留言
  /** 署名：新人自己的留言署兩人的名字（比另外放一個 FROM THE COUPLE 標籤少一群小字）。 */
  private signature() { const m = this.msg; return signature(m ? (m.couple ? COUPLE_ZH : m.name) : ''); }

  /**
   * 排留言：挑「字大、又斷得好」的排法。候選有兩種：
   *  - fitText 在幾種框寬下的結果（它只會縮字級，框寬不變常常還是同一個斷點）；
   *  - 照子句排（clauseFit）：先在標點切成子句，放得下就整句一行，太長的子句才在句子裡面斷。
   *    斷詞器不認得人名，fitText 會斷出「承／恩」，照子句排就不會。
   * 分數：字級為主；拆開一個詞重扣分；留言裡有標點時，行尾不是標點小扣分；短句多一行也扣一點（一行讀完）。
   */
  private fitMessage(c: CanvasRenderingContext2D, text: string, h: number): FitResult {
    // 很短的留言（「新婚快樂！」「♥♥♥」）字可以更大：它是這一格唯一的焦點，不要小小一行飄在天上
    const n = Array.from(text.replace(/\s/g, '')).length;
    // v2：字級上限照字數（短句 60、長留言 44），最多五行
    const o = { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.4, maxLines: 5 };
    const endsOk = /[，。！？、,.!?~～…：；:;）)」』♥\s]$/u;
    const hasPunct = /[，。！？、,.!?~～…：；:;\s]/u.test(text.slice(0, -1));
    const cands = [1, 0.94, 0.88, 0.82, 0.76].map((k) => fitText(c, text, FAM_MSG, this.mw * k, h, o));
    for (const strict of [false, true]) { const r = this.clauseFit(c, text, h, o, strict); if (r) cands.push(r); }
    let best = cands[0]!, bestScore = -Infinity;
    for (const r of cands) {
      const soft = hasPunct ? r.lines.slice(0, -1).filter((l) => !endsOk.test(l)).length : 0;
      const score = r.size * (1 - 0.3 * badBreaks(text, r.lines) - 0.1 * soft - (n <= 10 ? 0.05 * (r.lines.length - 1) : 0));
      if (score > bestScore + 0.5) { best = r; bestScore = score; }
    }
    return best;
  }

  /**
   * 照子句排：從大字級往下找第一個放得下的（每 2 px 一級）。子句比一行長才交給 wrap() 在句子裡斷；
   * strict 時子句一律不拆（字級會小一點，但「新婚快樂！！！」這種短句才排得出一整行的候選）。
   */
  private clauseFit(c: CanvasRenderingContext2D, text: string, h: number, o: { min: number; max: number; lineHeight: number; maxLines: number }, strict: boolean): FitResult | null {
    // 愛心也算子句的結尾（「最重要♥ 我們永遠是…」大家常把愛心當標點用）
    const P = '，。！？、,.!?~～…；;：:♥';
    const clauses = text.match(new RegExp(`[^${P}]+[${P}\\s]*|[${P}\\s]+`, 'gu')) ?? [text];
    const W = this.mw;
    for (let size = o.max; size >= o.min; size -= 2) {
      c.font = font(FAM_MSG, size);
      const fits = (x: string) => c.measureText(x.trim()).width <= W;
      const lines: string[] = [];
      let cur = '', broke = false;
      for (const cl of clauses) {
        if (fits(cur + cl)) { cur += cl; continue; }
        if (cur.trim()) lines.push(cur.trim());
        cur = '';
        if (fits(cl)) { cur = cl; continue; }
        if (strict) { broke = true; break; }
        const sub = wrap(c, cl.trim(), W);
        lines.push(...sub.slice(0, -1));
        cur = sub[sub.length - 1] ?? '';
      }
      if (broke) continue;
      if (cur.trim()) lines.push(cur.trim());
      const height = size * (1 + (lines.length - 1) * o.lineHeight);
      if (lines.length > o.maxLines || height > h) continue;
      const width = Math.max(...lines.map((l) => c.measureText(l).width));
      if (width <= W * 1.001) return { size, lines, lineHeight: size * o.lineHeight, width, height };
    }
    return null;
  }

  /** 留言：每個字跟著它那顆星一起亮（還沒亮的淡淡看得到，亮的那一刻是訊號色，再冷卻成紙白）；最後一顆亮了寫上署名。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg, fit = this.fit, s = this.ctx.start;
    if (!m || !fit) return;
    c.save();
    const ghost = 0.16 * prog(t, s + 0.25, s + 0.8);
    const fs = fit.size;
    c.font = font(FAM_MSG, fs);
    for (const g of this.glyphs) {
      const ti = this.times[g.unit]!;
      const lit = t >= ti, heat = lit ? Math.exp(-(t - ti) / 0.55) : 0;
      // 愛心不用字型的 ♥，用我們自己畫的那顆（點綴色）
      if (g.ch === '♥') { drawHeart(c, g.x + fs * 0.5, g.y - fs * 0.36, fs * 0.62 * (1 + 0.3 * heat), rgba('rose', lit ? 0.95 : ghost * 1.4)); continue; }
      c.fillStyle = !lit ? rgba('bone', ghost) : heat > 0.04 ? mixRgba('bone', 'signal', heat, 0.97) : rgba('bone', 0.97);
      c.fillText(g.ch, g.x, g.y + (lit ? 0 : 3));
    }
    // 署名：最後一顆星亮了就寫上
    const sk = prog(t, this.tLast + 0.1, this.tLast + 0.6, ease.outCubic);
    if (sk > 0) {
      c.font = font(F.ming(400), this.sigSize); c.textAlign = 'right'; c.fillStyle = rgba('bone', 0.72 * sk);
      c.fillText(this.signature(), this.sigX, this.sigY);
      c.textAlign = 'left';
    }
    c.restore();
  }

  /** 沒有留言：邀請大家掃 QR（新人的星座已經在上面亮了，示範給大家看）。 */
  private drawInvite(c: CanvasRenderingContext2D, t: number) {
    if (this.msg || !this.inviteSize) return;
    const ik = prog(t, this.tLast, this.tLast + 0.6, ease.outCubic);
    if (ik <= 0) return;
    c.save();
    c.globalAlpha *= ik;
    if (this.inviteBig) {
      c.font = font(F.ming(700), this.inviteSize); c.fillStyle = rgba('bone', 0.9);
      INVITE.forEach((ln, i) => c.fillText(ln, LYR_X, this.inviteY + i * this.inviteSize * 1.3));
    } else {
      c.font = font(F.ming(400), this.inviteSize); c.fillStyle = rgba('bone', 0.62);
      c.fillText(INVITE.join(''), LYR_X, this.inviteY);
    }
    c.restore();
  }
}
