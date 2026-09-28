// 星圖（照 pdoom 的 ascent 版畫、loom 的細線樹、open 的製圖紙）：一張古典版畫風格的星圖，暗底上刻紙白的細線。
//  - 背景（stars-sky.ts）：圓錐投影的赤經赤緯網與刻度、背景星（hi-hat 一打一小撮會閃）、銀河的版畫線、黃道、
//    圖框與黑白相間的刻度帶（右下角繞過 QR）。鏡頭＝天空繞北天極很慢地轉，每小節緩一下，像望遠鏡的轉儀鐘。
//  - 主打留言的每個字是一顆星（stars-chart.ts 排形狀）：進場時只看得到空心的小圈；仙女棒從畫面外飛進來點亮第一顆，
//    之後在拍點上一顆飛一顆、一條線一條線連起來，旁邊的圖例（留言本身）跟著一個字一個字亮起來。
//  - 最後一顆亮起後的下一個重拍「命名」：圖例寫上「{名字}座」、拉丁文學名、座標（婚禮日期：3 月 13 日 → 赤經 03h13m、
//    2027 年 → 赤緯 +20°27′，而且星座真的就畫在格線上的那個位置）、星座邊界用虛線圍起來。之後每拍輪流閃一顆星，長窗格會有流星。
//  - 歌詞沿著黃道寫（逐字跟唱，唱到哪、黃道就亮到哪，仙女棒騎在線上）；純音樂時黃道上寫歌名。
//  - 沒有主打留言：星座是新人（宣 文 ♥ 孟 庭），圖例改成邀請大家掃 QR，「你的祝福也會變成一個星座」。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, measure, type TextLayout } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse, polylineLengths, pointAtLength, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { sparkHead, sparkParticles, drawHeart, lyricAt, layoutLyric, beatAfter, barAfter, signature, COUPLE_EN, COUPLE_ZH, WEDDING_DATE, DATE_DOTS, type LyricStyle } from './_motifs';
import { Sky, makeSkyPass, eclY, roman, K_DEC, K_RA, type P2 } from './stars-sky';
import { units, unitOfChar, buildConstellation, placeTags, type Unit, type StarPt, type Tag, type Zone } from './stars-chart';

// 座標彩蛋：婚禮日期 2027-03-13 → 赤經 03h13m（月、日）、赤緯 +20°27′（年份拆兩半）
const [DY, DM, DD] = String(WEDDING_DATE).split('-').map(Number) as [number, number, number];
const RA_C = DM + Math.min(59, DD) / 60;
const DEC_C = Math.floor(DY / 100) + Math.min(59, DY % 100) / 60;
const pad2 = (n: number) => String(n).padStart(2, '0');
const COORD = `RA ${pad2(DM)}h${pad2(DD)}m · Dec +${Math.floor(DY / 100)}°${pad2(DY % 100)}′`;

/**
 * 兩種構圖（用種子挑）：星座在左、圖例在右，或反過來。星座區要留給天空轉動的位移與小字的空間。
 * 星座區從 y = 300 開始：星座那一側的上角（正常構圖的左上、反過來的右上）留給即時留言小卡，只有天空、不會蓋到字。
 * 正常構圖的圖例從 x = 1210 開始：上方正中那格小卡（x 725～1195）也就只蓋到天空。
 */
const LAYOUTS: { zone: Zone; lx: number; lw: number }[] = [
  { zone: { x0: 185, y0: 300, x1: 985, y1: 650 }, lx: 1210, lw: 614 },
  { zone: { x0: 1000, y0: 300, x1: 1690, y1: 640 }, lx: 150, lw: 690 },
];
/** 星等 → 星的半徑（px）。 */
const STAR_R = [0, 7.5, 5.8, 4.7, 3.9, 3.3];
/** 歌詞從黃道上的哪裡開始寫、最長寫多長（右端停在 HUD 左邊）。 */
const LYR_X = 150, LYR_W = 1170;
/** 重描用的緩動（反函數很好算：retraceFlash 要知道光什麼時候經過每顆星）。 */
const inOutSine = (u: number) => (1 - Math.cos(Math.PI * clamp(u))) / 2;

const FAM_TAG = F.serif(600, true);
const FAM_NAME = F.ming(700);
const FAM_LYRIC = F.archivo(100, 700);
const FOOTNOTE = '＊本星座終年可見，不受季節與天氣影響。';
/** 邀請：固定兩行（自動斷行會把「QR code」拆開）。 */
const INVITE = ['掃描右下角的 QR code，', '你的祝福也會變成一個星座。'];
const MAG_KEY = '星等以心意計';

interface LegendGlyph { ch: string; x: number; y: number; unit: number }

export default class Stars extends Scene {
  bg = shared('stars.bg', makeSkyPass);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(3200, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 31 + (this.msg?.id ?? 0) * 7919) >>> 0;
  flip = hash(this.seed, 5) < 0.5;
  zone = LAYOUTS[0]!.zone;
  lx = 0; lw = 0;
  us: Unit[] = [];
  pts: StarPt[] = [];
  tags: Tag[] = [];
  tagSize = 28;
  name = '';
  /** 星座名與署名用的名字（太長會截短）。 */
  who = '';
  latin = '';
  sky!: Sky;
  /** 每顆星亮起的時間。 */
  times: number[] = [];
  tLead = 0; t0 = 0; tLast = 0; tName = 0; tExit = 0;
  per = 1;
  phiTot = 0.05;
  leadFrom: P2 = { x: 0, y: 0 };
  // 圖例
  hy = 172; nameSize = 72; nameY = 0; latinY = 0; ruleY = 0;
  fit: FitResult | null = null;
  msgFam = F.ming(700);
  glyphs: LegendGlyph[] = [];
  sigY = 0; footY = 0;
  inviteSize = 0;
  /** 抬頭右邊的星等圖例：2 = 字加點、1 = 只有字、0 = 放不下就不放（圖例窄的構圖）。 */
  keyMode = 2;
  head = '';
  inviteY = 0;
  /** 星座邊界（靜止座標的折線）。 */
  boundary: P2[] = [];
  meteors: { t: number; a: P2; b: P2 }[] = [];
  /** 長窗格：每四小節一道光沿著星座的連線從頭跑到尾（重溫點亮的那一刻）。 */
  retrace: { t: number; dur: number }[] = [];
  lyricsInWindow = false;
  glyphCache = new Map<string, TextLayout>();
  /** 即時留言小卡要避開的範圍（整個窗格都一樣，init 算好）。 */
  avoid: [number, number, number, number][] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const L = LAYOUTS[this.flip ? 1 : 0]!;
    this.zone = L.zone; this.lx = L.lx; this.lw = L.lw;
    const c = this.layer.ctx;

    // ---- 星：留言拆字；沒有留言就用新人的名字（宣 文 ♥ 孟 庭）
    const text = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, '♥');
    this.us = units(text);
    const coupleName = COUPLE_ZH.replace(/\s*&\s*/, '');
    this.who = m ? (m.couple ? coupleName : m.name || '祝福') : coupleName;
    this.name = `${this.who}座`;
    this.latin = m && !m.couple ? 'Constellatio Nova' : COUPLE_EN;
    await loadText(`${text}${this.name}${FOOTNOTE}${INVITE.join('')}${MAG_KEY}${song.title}${song.artist}黃道${signature(m?.name ?? '')}`);

    const n = this.us.length;
    this.pts = buildConstellation(n, this.zone, this.seed);
    this.tagSize = n <= 10 ? 30 : n <= 24 ? 26 : 22;
    c.font = font(FAM_TAG, this.tagSize);
    const tw = this.us.map((u) => (u.heart ? 0 : c.measureText(u.text).width));
    // 亮星有光芒，字要放在光芒外面
    this.tags = placeTags(this.pts, (i) => ({ w: tw[i]!, h: this.tagSize * 0.78, r: this.us[i]!.heart ? 11 : STAR_R[this.pts[i]!.mag]! * (this.pts[i]!.mag <= 3 ? 2.3 : 1.2) }),
      // 天空轉動最多讓星左右移動約 65 px：小字的安全範圍先扣掉這段
      { x0: 96 + 66, y0: 128, x1: 1824 - 66, y1: this.flip ? 690 : 700 });
    const zc = { x: (this.zone.x0 + this.zone.x1) / 2, y: (this.zone.y0 + this.zone.y1) / 2 };
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
    this.tLead = Math.max(s + 0.06, this.t0 - Math.min(0.55, beat * 0.85));
    const p0 = this.pts[0]!;
    this.leadFrom = this.flip ? { x: p0.x + 320, y: p0.y - 190 } : { x: p0.x - 300, y: p0.y - 200 };
    // 天空轉多少：星座附近每秒約 6 px，長窗格封頂（不讓星座轉進圖例）
    this.phiTot = Math.min(0.07, (6 * (e - s)) / 1800);

    // ---- 星座邊界（照 IAU 的畫法：沿著赤經線與赤緯圈的虛線框，分兩段高低，像階梯）
    this.boundary = this.buildBoundary();

    // ---- 圖例：抬頭、星座名、學名與座標、細線、留言、署名、註腳
    const lx = this.lx, lw = this.lw;
    this.head = m ? `TABULA CAELESTIS  ·  No.${String(m.n).padStart(3, '0')}${m.couple ? '  ·  FROM THE COUPLE' : ''}` : `TABULA CAELESTIS  ·  ${DATE_DOTS}`;
    const headW = measure(this.head, F.mono(500), 15, 3), keyW = measure(MAG_KEY, F.hei(500), 15, 3);
    this.keyMode = headW + keyW + 105 + 30 <= lw ? 2 : headW + keyW + 30 <= lw ? 1 : 0;
    // 名字很長時：先縮字（最小 40），還放不下就截短加「…」
    while (Array.from(this.who).length > 1 && measure(this.name, FAM_NAME, 40) > lw * 0.96) {
      this.who = Array.from(this.who.replace(/…$/, '')).slice(0, -1).join('') + '…';
      this.name = `${this.who}座`;
    }
    this.nameSize = Math.max(40, Math.min(76, (lw * 0.94 * 100) / Math.max(1, measure(this.name, FAM_NAME, 100))));
    this.nameY = this.hy + 26 + this.nameSize * 0.94;
    this.latinY = this.nameY + 52;
    this.ruleY = this.latinY + 26;
    const msgTop = this.ruleY + 34;
    if (m) {
      const fit = fitText(c, m.text, F.ming(700), lw, 684 - msgTop - 62, { min: 44, max: 84, lineHeight: 1.36, maxLines: 5 });
      this.fit = fit;
      this.msgFam = fit.size >= 62 ? F.ming(400) : F.ming(700);
      const uoc = unitOfChar(m.text, this.us);
      const src = Array.from(m.text);
      let j = 0;
      fit.lines.forEach((ln, li) => {
        const lay = layout(ln, this.msgFam, fit.size);
        for (const g of lay.glyphs) {
          while (j < src.length && src[j] !== g.ch) j++;
          const idx = Math.min(j, src.length - 1);
          if (j < src.length) j++;
          this.glyphs.push({ ch: g.ch, x: lx + g.x, y: msgTop + fit.size * 0.92 + li * fit.lineHeight, unit: uoc[idx] ?? 0 });
        }
      });
      this.sigY = msgTop + fit.size * 0.92 + (fit.lines.length - 1) * fit.lineHeight + 62;
    } else {
      this.inviteSize = Math.min(54, ...INVITE.map((ln) => (lw * 0.96 * 100) / measure(ln, F.ming(700), 100)));
      this.inviteY = msgTop + this.inviteSize * 0.92;
      this.sigY = this.inviteY + this.inviteSize * 1.4;
    }
    this.footY = this.sigY + 44;

    // ---- 長窗格：命名之後隔小節來一顆流星（往圖例的反方向劃過星座上方）
    const barLen = au.timeOfBar(au.barAt(this.tName) + 1) - this.tName;
    for (let b = Math.ceil(au.barAt(this.tName + barLen) - 1e-3); ; b += 2) {
      const tb = au.timeOfBar(b);
      if (tb > e - barLen * 0.9) break;
      if (hash(this.seed, b, 11) < 0.3) continue;
      // 從星座上方的天空斜斜劃過（淺角度，才不會一路切過整個星座）
      const z = this.zone, r1 = hash(this.seed, b, 12), r2 = hash(this.seed, b, 13), r3 = hash(this.seed, b, 14);
      const a = { x: z.x0 + (z.x1 - z.x0) * (this.flip ? 0.02 + 0.4 * r1 : 0.58 + 0.4 * r1), y: 118 + 80 * r2 };
      const ang = this.flip ? 0.16 + 0.22 * r3 : Math.PI - 0.16 - 0.22 * r3;
      const len = 330 + 160 * r2;
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
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;

    // ---- 即時留言小卡避開：圖例（留言本身）、黃道上的歌詞、星座（連小字、加上天空轉動的位移）。
    // 小卡照重疊面積挑位置，圖例與歌詞各列兩次＝權重加倍：真的沒地方時，寧可蓋到幾顆星也不要蓋到留言與歌詞。
    const legend: [number, number, number, number] = [lx - 10, this.hy - 36, lw + 20, Math.max(this.sigY, this.footY < 700 ? this.footY : 0) + 16 - (this.hy - 36)];
    let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity;
    this.pts.forEach((p, i) => {
      const tg = this.tags[i]!, r = this.starR(i) * 2.5;
      cx0 = Math.min(cx0, p.x - r, p.x + tg.dx); cx1 = Math.max(cx1, p.x + r, p.x + tg.dx + tw[i]!);
      cy0 = Math.min(cy0, p.y - r, p.y + tg.dy - this.tagSize); cy1 = Math.max(cy1, p.y + r, p.y + tg.dy + 6);
    });
    const stars: [number, number, number, number] = [cx0 - 66, cy0 - 34, cx1 - cx0 + 132, cy1 - cy0 + 68];
    this.avoid = [legend, legend, stars];
    if (this.lyricsInWindow) {
      // 歌詞沿著斜的黃道寫：用這個窗格裡最長的一句算實際寬度，每 300 px 切一段、各自照黃道的高度框，
      // 短句的時候下方正中那格小卡就空得出來。第一行在線上方，很長的句子第二行在線下方。
      // 天空轉動會讓黃道上下移動約 30 px，框多留一點。
      let wMax = 0, two = false, size = 64;
      for (const line of lyrics.linesIn(s, e)) {
        const ll = layoutLyric(c, line, { family: FAM_LYRIC, size: 64, minSize: 48, maxWidth: LYR_W });
        wMax = Math.max(wMax, ...ll.rows.map((r) => r.width));
        if (ll.rows.length > 1) { two = true; size = Math.min(size, ll.size); }
      }
      for (let xa = LYR_X; xa < LYR_X + wMax; xa += 300) {
        const xb = Math.min(LYR_X + wMax, xa + 300);
        const yTop = Math.min(eclY(xa), eclY(xb)) - 18 - size - 34, yBot = Math.max(eclY(xa), eclY(xb)) + (two ? size + 50 : 44);
        const r: [number, number, number, number] = [xa - 24, Math.round(yTop), xb - xa + 48, Math.round(yBot - yTop)];
        this.avoid.push(r, r);
      }
    }
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

  /** 星座邊界：星的赤經範圍切兩半，各自的赤緯範圍，連成一個有一階的虛線框（靜止座標）。 */
  private buildBoundary(): P2[] {
    const sky = this.sky;
    const rd = this.pts.map((p) => sky.radec(p.x, p.y));
    const pad = 46;
    const d = sky.rPole + (90 - DEC_C) * K_DEC;
    const padRA = pad / (K_RA * d), padDec = pad / K_DEC;
    let raMin = Math.min(...rd.map((x) => x.ra)) - padRA, raMax = Math.max(...rd.map((x) => x.ra)) + padRA;
    // 赤經邊界落在整 10 分（真的星座邊界也是整數座標）
    raMin = Math.floor(raMin * 6) / 6; raMax = Math.ceil(raMax * 6) / 6;
    const raMid = Math.round(((raMin + raMax) / 2) * 6) / 6;
    const decOf = (lo: number, hi: number) => {
      const ds = rd.filter((x) => x.ra >= lo - padRA && x.ra <= hi + padRA).map((x) => x.dec);
      if (!ds.length) return null;
      return { a: Math.floor((Math.min(...ds) - padDec) * 2) / 2, b: Math.ceil((Math.max(...ds) + padDec) * 2) / 2 };
    };
    const all = decOf(raMin, raMax)!;
    const A = decOf(raMid, raMax) ?? all, B = decOf(raMin, raMid) ?? all; // A：東半（赤經大，畫面左邊）
    const out: P2[] = [];
    const arc = (ra0: number, ra1: number, dec: number) => { for (let k = 0; k <= 16; k++) out.push(sky.fromRaDec(ra0 + ((ra1 - ra0) * k) / 16, dec)); };
    // 從東半的上緣開始順時針：上緣（東→中）、階梯、上緣（中→西）、西邊、下緣（西→中）、階梯、下緣（中→東）、東邊回來
    arc(raMax, raMid, A.b);
    arc(raMid, raMin, B.b);
    arc(raMin, raMid, B.a);
    arc(raMid, raMax, A.a);
    out.push(out[0]!);
    return out;
  }

  /** 天空這一格轉了多少：大部分是等速，三成在每個小節裡緩進緩出（像轉儀鐘一格一格推）。 */
  private phiAt(t: number) {
    const au = this.ctx.audio, s = this.ctx.start, e = this.ctx.end;
    const p = clamp((t - s) / (e - s));
    const bs = au.barAt(s), nb = Math.max(0.5, au.barAt(e) - bs), bb = clamp(au.barAt(t) - bs, 0, nb);
    const stepped = clamp((Math.floor(bb) + ease.inOutCubic(bb - Math.floor(bb))) / nb);
    return this.phiTot * (0.7 * (p - 0.5) + 0.3 * (stepped - 0.5));
  }

  /**
   * 最近一次 hi-hat 的編號（背景星用它挑「這一下」要閃哪一小撮）。au.events() 每次掃整首歌，這裡用二分搜尋。
   */
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
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const exit = prog(t, this.tExit, e, ease.inCubic);
    const k = prog(t, s, s + 0.35) * (1 - exit);
    const sky = this.sky;
    sky.phi = this.phiAt(t);
    const beat = au.beatPeriod(t);

    // ---- 背景
    const u = this.bg.u;
    const zc = sky.fwd((this.zone.x0 + this.zone.x1) / 2, (this.zone.y0 + this.zone.y1) / 2);
    u.t!.value = t; u.k!.value = k;
    u.iris!.value = 60 + 2500 * prog(t, s, s + Math.min(1.1, 1.8 * beat), ease.outCubic);
    (u.irisC!.value as THREE.Vector2).set(zc.x, zc.y);
    (u.pole!.value as THREE.Vector2).set(sky.pole.x, sky.pole.y);
    (u.seedOff!.value as THREE.Vector2).set(hash(this.seed, 1), hash(this.seed, 2));
    u.phi!.value = sky.phi; u.rPole!.value = sky.rPole; u.ra0!.value = sky.ra0;
    u.hat!.value = f.a.hat;
    u.hatIdx!.value = this.lastHatIdx(t);
    (u.quiet!.value as THREE.Vector4).set(this.lx - 30, 140, this.lx + this.lw + 20, 690);
    (u.mw!.value as THREE.Vector3).set((this.flip ? 0.55 : -0.55) + (hash(this.seed, 3) - 0.5) * 0.5, (this.flip ? 0.55 : -0.55) * 1200 + 300 + hash(this.seed, 4) * 500, 190);
    this.bg.render(renderer, out);

    const Lr = this.layer; Lr.clear();
    const c = Lr.ctx;
    this.glow.clear();
    c.globalAlpha = k;
    c.textBaseline = 'alphabetic';

    // 星的螢幕位置（天空在轉）
    const sp = this.pts.map((p) => sky.fwd(p.x, p.y));
    this.drawFrameLabels(c, t);
    this.drawConstellation(c, t, sp, f);
    const lyricHead = this.drawEcliptic(c, t);
    this.drawLegend(c, t);
    comp.draw(renderer, Lr.upload(), out);

    // ---- 發光的東西（加亮疊上去）
    this.glowStars(t, sp, f);
    const I = 1 - exit;
    const head = this.headAt(t);
    if (head && exit < 0.5) {
      const hs = (tt: number) => this.headAt(tt);
      sparkParticles(this.glow, t, hs, { rate: 95, life: 0.36, speed: 210, seed: this.seed % 997, intensity: I });
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
      // constellation 的仙女棒在飛的時候，黃道上的小一點、安靜一點（畫面上不要兩團一樣大的火）
      const small = head ? 0.55 : 0.8;
      if (!head) sparkParticles(this.glow, t, () => lyricHead, { rate: 45, life: 0.28, speed: 150, seed: 5, intensity: 0.8 * I });
      sparkHead(this.glow, lyricHead.x, lyricHead.y, t, small, (head ? 0.6 : 0.9) * I);
    }
    this.drawMeteors(t, I);
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.8, vignette: 0.5, halation: 0.3, zoom: 1 + 0.016 * f.p + 0.012 * exit, popupAvoid: this.avoid };
  }

  // ------------------------------------------------------------------ 圖框刻度
  /** 上緣寫赤經時數（羅馬數字 ʰ）、左緣寫赤緯度數，位置跟著天空轉。 */
  private drawFrameLabels(c: CanvasRenderingContext2D, t: number) {
    const sky = this.sky, s = this.ctx.start;
    c.save();
    c.globalAlpha *= prog(t, s + 0.1, s + 0.6);
    c.fillStyle = rgba('bone', 0.46);
    const yT = 116;
    for (let h = -6; h <= 12; h++) {
      const x = sky.raLineAtY(h, yT - 14);
      if (x === null || x < 120 || x > 1800) continue;
      const hh = ((h % 24) + 24) % 24;
      c.font = font(F.serif(600), 21);
      const txt = roman(hh), w = c.measureText(txt).width;
      c.fillText(txt, x - w / 2 - 3, yT);
      c.font = font(F.serif(600), 13);
      c.fillText('h', x + w / 2 - 2, yT - 9);
    }
    c.font = font(F.serif(600), 19);
    for (let d = -20; d <= 60; d += 10) {
      const y = sky.decCircleAtX(d, 100);
      if (y === null || y < 150 || y > 770) continue;
      // 圖例在左邊的構圖：圖例旁邊不寫，免得跟圖例擠在一起
      if (this.flip && y > 130 && y < 700) continue;
      c.fillText(`${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}°`, 100, y - 7);
    }
    c.restore();
  }

  // ------------------------------------------------------------------ 星座
  private drawConstellation(c: CanvasRenderingContext2D, t: number, sp: P2[], f: Frame) {
    const pts = this.pts, n = pts.length, s = this.ctx.start;
    const kick = f.a.kick;
    // 邊界：命名時用虛線畫一圈
    const bk = prog(t, this.tName, this.tName + 0.9, ease.inOutCubic);
    if (bk > 0) {
      const bp = this.boundary.map((p) => this.sky.fwd(p.x, p.y));
      const Lb = polylineLengths(bp), total = Lb[Lb.length - 1]! * bk;
      c.save();
      c.strokeStyle = rgba('bone', 0.3);
      c.lineWidth = 1;
      c.setLineDash([7, 6]);
      c.beginPath();
      c.moveTo(bp[0]!.x, bp[0]!.y);
      for (let i = 1; i < bp.length; i++) {
        if (Lb[i]! <= total) { c.lineTo(bp[i]!.x, bp[i]!.y); continue; }
        const q = pointAtLength(bp, Lb, total);
        c.lineTo(q.x, q.y);
        break;
      }
      c.stroke();
      c.restore();
    }
    // 連線：一條細線，兩端離星留一點空（古星圖的畫法），大鼓一打亮一點
    c.save();
    c.strokeStyle = rgba('bone', 0.42 + 0.3 * kick);
    c.lineWidth = 1.15;
    c.beginPath();
    for (let i = 1; i < n; i++) {
      if (t < this.times[i - 1]!) break;
      const a = sp[pts[i]!.from]!, b = sp[i]!;
      const u = t >= this.times[i]! ? 1 : this.flight(i, t);
      const seg = this.trimmed(a, b, this.starR(pts[i]!.from) + 6, u >= 1 ? this.starR(i) + 6 : 0, u);
      if (!seg) continue;
      c.moveTo(seg[0].x, seg[0].y); c.lineTo(seg[1].x, seg[1].y);
    }
    c.stroke();
    c.restore();
    // 星：還沒亮的是空心小圈（進場時一顆顆冒出來），亮了是實心加光芒
    for (let i = 0; i < n; i++) {
      const p = sp[i]!, r = this.starR(i), ti = this.times[i]!;
      const appear = prog(t, s + 0.12 + (i / Math.max(1, n)) * Math.min(0.55, this.t0 - s - 0.1), s + 0.3 + (i / Math.max(1, n)) * Math.min(0.55, this.t0 - s - 0.1));
      if (t < ti) {
        if (appear <= 0) continue;
        // 還沒亮的星：空心小圈（古星圖的「變星」畫法），中間一個小點
        c.strokeStyle = rgba('bone', 0.5 * appear);
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(p.x, p.y, Math.max(4.5, r * 1.05), 0, TAU); c.stroke();
        c.fillStyle = rgba('bone', 0.45 * appear);
        c.fillRect(p.x - 1, p.y - 1, 2, 2);
        continue;
      }
      const heat = Math.exp(-(t - ti) / 0.35);
      if (this.us[i]!.heart) {
        // 愛心星不發光（只用點綴色）：點亮時大一下，命名後輪到它的那一拍「跳」一下
        drawHeart(c, p.x, p.y - 1, 22 * (1 + 0.5 * heat + 0.35 * this.chase(t, i) + 0.3 * this.retraceFlash(t, i)), rgba('rose'));
        continue;
      }
      c.fillStyle = heat > 0.05 ? mixRgba('bone', 'ember', heat) : rgba('bone', 0.96);
      c.beginPath(); c.arc(p.x, p.y, r * (1 + 0.4 * heat), 0, TAU); c.fill();
      // 亮星刻八道光芒（長的四道、短的四道）
      if (pts[i]!.mag <= 3) {
        c.strokeStyle = rgba('bone', 0.75);
        c.lineWidth = pts[i]!.mag === 1 ? 1.3 : 1;
        c.beginPath();
        for (let q = 0; q < 8; q++) {
          const a = (q * TAU) / 8, L = r * (q % 2 ? 1.9 : 3.1) * (pts[i]!.mag === 1 ? 1.1 : 0.85);
          c.moveTo(p.x + Math.cos(a) * r * 1.15, p.y + Math.sin(a) * r * 1.15);
          c.lineTo(p.x + Math.cos(a) * L, p.y + Math.sin(a) * L);
        }
        c.stroke();
      }
    }
    // 小字：這顆星是哪個字（亮起時是訊號色，慢慢冷卻成紙白）
    c.font = font(FAM_TAG, this.tagSize);
    for (let i = 0; i < n; i++) {
      const ti = this.times[i]!;
      if (t < ti || this.us[i]!.heart) continue;
      const a = prog(t, ti, ti + 0.18, ease.outCubic), heat = Math.exp(-(t - ti) / 0.6);
      const p = sp[i]!, tg = this.tags[i]!;
      c.fillStyle = heat > 0.04 ? mixRgba('bone', 'signal', heat, 0.82 * a) : rgba('bone', 0.8 * a);
      c.fillText(this.us[i]!.text, p.x + tg.dx, p.y + tg.dy + 4 * (1 - a));
    }
  }

  /** 命名之後每拍輪流閃一顆：第 i 顆這一格閃多少（0..1）。 */
  private chase(t: number, i: number) {
    if (t < this.tName) return 0;
    const au = this.ctx.audio, n = this.pts.length;
    const bi = Math.floor(au.beatAt(t) + 1e-4), bn = Math.round(au.beatAt(this.tName));
    return (((bi - bn) % n) + n) % n === i ? pulse(t, au.timeOfBeat(bi), 0.16) : 0;
  }

  private starR(i: number) { return this.us[i]!.heart ? 11 : STAR_R[this.pts[i]!.mag]!; }

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
      const gl = (i === gi ? gk * (down ? 2.2 : 1.2) : 0) + named * 1.2 + this.retraceFlash(t, i) * 2.6;
      const I = fade * (tw + 3 * heat + gl + 0.25 * f.a.kick);
      if (!this.us[i]!.heart) {
        const r = this.starR(i);
        lb.seg2(p.x, p.y, p.x + 0.01, p.y, r * 4.6, [S[0] * 0.5 * I, S[1] * 0.5 * I, S[2] * 0.5 * I], 0.28);
        lb.seg2(p.x, p.y, p.x + 0.01, p.y, r * 1.9, [E[0] * 1.5 * I, E[1] * 1.5 * I, E[2] * 1.5 * I], 0.85);
      }
      // 點亮的光圈：一圈細線往外擴散
      const tr = t - ti;
      if (tr < 0.55) {
        const R = this.starR(i) + 4 + 44 * ease.outCubic(tr / 0.55), a = (1 - tr / 0.55) ** 2 * fade;
        const col: [number, number, number] = [S[0] * 2 * a, S[1] * 2 * a, S[2] * 2 * a];
        for (let q = 0; q < 28; q++) {
          const a0 = (q / 28) * TAU, a1 = ((q + 1) / 28) * TAU;
          lb.seg2(p.x + Math.cos(a0) * R, p.y + Math.sin(a0) * R, p.x + Math.cos(a1) * R, p.y + Math.sin(a1) * R, 1.3, col, a);
        }
      }
      // 閃的那一顆：十字光芒（愛心星改成在畫布上跳一下，見 drawConstellation）
      if (i === gi && gk > 0.03 && !this.us[i]!.heart) {
        const L = (down ? 46 : 26) * (0.4 + 0.6 * gk), a = gk * fade;
        const col: [number, number, number] = [E[0] * 2.4 * a, E[1] * 2.4 * a, E[2] * 2.4 * a];
        for (let q = 0; q < (down ? 8 : 4); q++) {
          const ang = (q * TAU) / (down ? 8 : 4) + 0.001, LL = q % 2 && down ? L * 0.5 : L;
          lb.seg2(p.x, p.y, p.x + Math.cos(ang) * LL, p.y + Math.sin(ang) * LL, 1.2, col, a);
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
      sparkHead(lb, hx, hy, t, 0.7, fade);
    }
    // 剛畫好的連線還是燙的：訊號色，約半秒冷卻
    for (let i = 1; i < n; i++) {
      const t1 = this.times[i]!;
      if (t < this.times[i - 1]!) break;
      const heat = t < t1 ? 1 : Math.exp(-(t - t1) / 0.45);
      if (heat < 0.03) continue;
      const a = sp[this.pts[i]!.from]!, b = sp[i]!;
      const u = t >= t1 ? 1 : this.flight(i, t);
      const seg = this.trimmed(a, b, this.starR(this.pts[i]!.from) + 6, u >= 1 ? this.starR(i) + 6 : 0, u);
      if (!seg) continue;
      const I = heat * fade * 2.2;
      lb.seg2(seg[0].x, seg[0].y, seg[1].x, seg[1].y, 1.7, [S[0] * I, S[1] * I, S[2] * I], Math.min(1, heat * 1.3));
    }
  }

  /** 流星：一顆火星拖著細尾巴劃過去，半秒。 */
  private drawMeteors(t: number, I: number) {
    const S = LIN.signal;
    for (const m of this.meteors) {
      const u = (t - m.t) / 0.55;
      if (u < 0 || u > 1) continue;
      const hk = ease.outCubic(u), tk = ease.outCubic(Math.max(0, u - 0.4));
      const hx = m.a.x + (m.b.x - m.a.x) * hk, hy = m.a.y + (m.b.y - m.a.y) * hk;
      const tx = m.a.x + (m.b.x - m.a.x) * tk, ty = m.a.y + (m.b.y - m.a.y) * tk;
      const a = (1 - u) * I;
      for (let q = 0; q < 10; q++) {
        const u0 = q / 10, u1 = (q + 1) / 10, w = u1 * u1;
        const col: [number, number, number] = [S[0] * 3.2 * a * w, S[1] * 3.2 * a * w, S[2] * 3.2 * a * w];
        this.glow.seg2(tx + (hx - tx) * u0, ty + (hy - ty) * u0, tx + (hx - tx) * u1, ty + (hy - ty) * u1, 1 + 1.4 * w, col, Math.min(1, a * w * 1.3));
      }
      sparkHead(this.glow, hx, hy, t, 0.6, a);
    }
  }

  // ------------------------------------------------------------------ 黃道上的歌詞
  /** 歌詞沿著黃道寫，照跟唱規則逐字亮；唱到哪，黃道就亮到哪。回傳仙女棒的位置（正在唱時）。 */
  private drawEcliptic(c: CanvasRenderingContext2D, t: number): P2 | null {
    const { lyrics, song } = this.ctx, sky = this.sky, s = this.ctx.start;
    // 這一格的黃道（螢幕折線）與從 x = LYR_X 起算的弧長
    const pts: P2[] = [];
    for (let x = -120; x <= 2040; x += 12) pts.push(sky.fwd(x, eclY(x)));
    const L = polylineLengths(pts);
    let i0 = 0;
    while (i0 < pts.length - 2 && pts[i0 + 1]!.x < LYR_X) i0++;
    const s0 = L[i0]! + (LYR_X - pts[i0]!.x) / Math.max(1e-3, pts[i0 + 1]!.x - pts[i0]!.x) * (L[i0 + 1]! - L[i0]!);
    const at = (sv: number) => pointAtLength(pts, L, s0 + sv);
    const ly = this.lyricsInWindow ? lyricAt(lyrics, t) : null;
    const st: LyricStyle = { family: FAM_LYRIC, size: 64, minSize: 48, maxWidth: LYR_W };
    const lay = ly ? layoutLyric(c, ly.line, st) : null;
    // 黃道的名字：寫在線的下面、跟著線的角度（很長的歌詞折成兩行時，第二行在線下面，名字就先收起來）
    const lab = at(8);
    c.save();
    c.globalAlpha *= prog(t, s + 0.3, s + 0.9) * (lay && lay.rows.length > 1 ? 1 - ly!.k : 1);
    c.translate(lab.x, lab.y); c.rotate(lab.angle);
    c.font = font(F.mono(500), 13); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.6);
    c.fillText('ECLIPTICA · 黃道', 0, 30);
    c.letterSpacing = '0px';
    c.restore();

    if (!this.lyricsInWindow) {
      // 純音樂：黃道上寫歌名（安靜的斜體）
      const txt = `♪  ${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
      c.save();
      c.globalAlpha *= 0.62 * prog(t, s + 0.4, s + 1.2);
      c.font = font(F.serif(400, true), 36);
      c.fillStyle = rgba('bone', 0.8);
      const lay = this.glyphLayout(`title|${txt}`, txt, F.serif(400, true), 36);
      for (const g of lay.glyphs) {
        const p = at(g.x + g.w / 2);
        if (p.x > 1330) break;
        c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
        c.fillText(g.ch, -g.w / 2, -16);
        c.restore();
      }
      c.restore();
      return null;
    }
    if (!ly || !lay) return null;
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
        const sc = pw.x + g.x + g.w / 2;
        const p = at(sc);
        const nx = Math.sin(p.angle), ny = -Math.cos(p.angle);
        const loc = clamp((wipe - g.x) / Math.max(1, g.w));
        c.save();
        c.translate(p.x + nx * off, p.y + ny * off);
        c.rotate(p.angle);
        if (loc < 1) { c.fillStyle = rgba('bone', 0.3); c.fillText(g.ch, -g.w / 2, 0); }
        if (loc > 0) {
          c.beginPath(); c.rect(-g.w / 2 - 3, -size * 1.15, g.w * loc + (loc >= 1 ? 6 : 3), size * 1.6); c.clip();
          c.fillStyle = pr < 1 ? rgba('signal') : rgba('bone', 0.96);
          c.fillText(g.ch, -g.w / 2, 0);
        }
        c.restore();
      }
      if (pr > 0) sungTo = Math.max(sungTo, row === 0 ? pw.x + wipe : row0.width);
      if (pr > 0 && pr < 1) { const p = at(pw.x + wipe); head = { x: p.x, y: p.y }; }
    }
    // 唱過的那段黃道：訊號色的細線（像進度條），筆尖那一小段是燙的
    if (sungTo > 2) {
      c.strokeStyle = rgba('signal', 0.7);
      c.lineWidth = 1.8;
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

  // ------------------------------------------------------------------ 圖例
  private drawLegend(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg, s = this.ctx.start, lx = this.lx, lw = this.lw, tn = this.tName;
    c.save();
    // 抬頭（機器的聲音）：左邊圖版名與編號，打字機打出來；右邊星等圖例（冷面笑話：以心意計）
    const head = this.head;
    const nh = Math.floor(head.length * prog(t, s + 0.15, s + 0.75));
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.85);
    c.fillText(head.slice(0, nh), lx, this.hy);
    c.letterSpacing = '0px';
    const mk = prog(t, s + 0.4, s + 1.0);
    if (mk > 0 && this.keyMode > 0) {
      c.save();
      c.globalAlpha *= mk;
      c.font = font(F.hei(500), 15); c.letterSpacing = '3px'; c.textAlign = 'right'; c.fillStyle = rgba('ash', 0.75);
      c.fillText(MAG_KEY, lx + lw, this.hy);
      const kw = c.measureText(MAG_KEY).width;
      c.textAlign = 'left'; c.letterSpacing = '0px';
      let x = lx + lw - kw - 22;
      for (const r of this.keyMode > 1 ? [1.4, 2, 2.7, 3.5, 4.4] : []) { c.fillStyle = rgba('bone', 0.85); c.beginPath(); c.arc(x - r, this.hy - 6, r, 0, TAU); c.fill(); x -= 2 * r + 11; }
      c.restore();
    }
    // 星座名：一開始淡淡的，命名的那一拍由左到右亮起來（訊號色，再冷卻成紙白）
    c.font = font(FAM_NAME, this.nameSize);
    c.fillStyle = rgba('bone', 0.12 * prog(t, s + 0.3, s + 0.9));
    c.fillText(this.name, lx, this.nameY);
    const nk = prog(t, tn, tn + 0.4, ease.outCubic);
    if (nk > 0) {
      const w = measure(this.name, FAM_NAME, this.nameSize), heat = Math.exp(-(t - tn) / 0.7);
      c.save();
      c.beginPath(); c.rect(lx - 6, this.nameY - this.nameSize * 1.1, (w + 12) * nk, this.nameSize * 1.5); c.clip();
      c.fillStyle = heat > 0.04 ? mixRgba('bone', 'signal', heat) : rgba('bone', 0.97);
      c.fillText(this.name, lx, this.nameY);
      c.restore();
    }
    // 學名（Cormorant 斜體）與座標（mono，打字機）
    const lk = prog(t, tn + 0.1, tn + 0.6, ease.outCubic);
    c.font = font(F.serif(400, true), 32);
    const latW = c.measureText(this.latin).width;
    if (lk > 0) { c.fillStyle = rgba('ash', 0.95 * lk); c.fillText(this.latin, lx, this.latinY); }
    const nc = Math.floor(COORD.length * prog(t, tn + 0.15, tn + 0.75));
    if (nc > 0) {
      c.font = font(F.mono(500), 16); c.letterSpacing = '2px'; c.fillStyle = rgba('signal', 0.95);
      c.fillText(COORD.slice(0, nc), lx + latW + 30, this.latinY - 2);
      c.letterSpacing = '0px';
    }
    // 細線：進場時由左往右畫出來
    const rk = prog(t, s + 0.2, s + 0.9, ease.inOutCubic);
    c.fillStyle = rgba('bone', 0.3);
    c.fillRect(lx, this.ruleY, lw * rk, 1);

    if (m && this.fit) {
      // 留言：每個字跟著它那顆星一起亮（還沒亮的淡淡看得到，亮的那一刻是訊號色，再冷卻成紙白）
      const ghost = 0.15 * prog(t, s + 0.3, s + 0.9);
      c.font = font(this.msgFam, this.fit.size);
      const fs = this.fit.size;
      for (const g of this.glyphs) {
        const ti = this.times[g.unit]!;
        const lit = t >= ti, heat = lit ? Math.exp(-(t - ti) / 0.55) : 0;
        // 愛心不用字型的 ♥，用我們自己畫的那顆（點綴色）
        if (g.ch === '♥') { drawHeart(c, g.x + fs * 0.5, g.y - fs * 0.36, fs * 0.62 * (1 + 0.3 * heat), rgba('rose', lit ? 0.95 : ghost * 1.4)); continue; }
        c.fillStyle = !lit ? rgba('bone', ghost) : heat > 0.04 ? mixRgba('bone', 'signal', heat, 0.96) : rgba('bone', 0.96);
        c.fillText(g.ch, g.x, g.y);
      }
      // 署名：最後一顆星亮了就寫上
      const sk = prog(t, this.tLast + 0.1, this.tLast + 0.6, ease.outCubic);
      if (sk > 0) {
        c.font = font(F.ming(400), 34); c.textAlign = 'right'; c.fillStyle = rgba('ash', sk);
        c.fillText(signature(m.name ? this.who : ''), lx + Math.max(this.fit.width, lw * 0.6), this.sigY);
        c.textAlign = 'left';
      }
    } else if (this.inviteSize) {
      // 沒有留言：邀請大家掃 QR（新人的星座已經在旁邊亮了，示範給大家看）
      const ik = prog(t, this.tLast, this.tLast + 0.6, ease.outCubic);
      c.save();
      c.globalAlpha *= 0.2 + 0.8 * ik;
      c.font = font(F.ming(700), this.inviteSize); c.fillStyle = rgba('bone', 0.92);
      INVITE.forEach((ln, i) => c.fillText(ln, lx, this.inviteY + i * this.inviteSize * 1.4));
      c.restore();
    }
    // 冷面註腳
    const fk = prog(t, tn + 0.5, tn + 1.1);
    if (fk > 0 && this.footY < 700) {
      c.font = font(F.hei(500), 16); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.6 * fk);
      c.fillText(FOOTNOTE, lx, this.footY);
      c.letterSpacing = '0px';
    }
    c.restore();
  }
}
