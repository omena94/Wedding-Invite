// 練舞室（亮、kculture、雙語）：一整面鏡牆的練舞室，宣文和孟庭穿練舞服跟著節奏跳，芃芃、QQ、元元坐在左下角跟著點頭。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 d2），教室、鏡子、歌詞紙、便利貼、音響是程式畫的。不畫任何團名、歌手、品牌。
//  - 跳舞照拍子：每一拍換一個動作（四個動作一輪），拍點上身體往下一沉；小節線上一起小跳，最高點在小節線上。
//  - 鏡子：後面一整面鏡牆，照出兩人的背影（淡淡的、偏冷的剪影，動作左右相反地跟著跳）與地板的反光；小節線上一道光從鏡面掃過去。
//  - **兩行歌詞是貼在鏡子上的歌詞紙**（印出來的一張紙，四角貼膠帶）：中文大字、原文小一號在下面；換一句時紙被風扇吹得翻一下。
//    沒翻譯的歌只有一行，紙跟著變矮。
//  - **焦點是主打留言**：貼在鏡子左邊的便利貼（淡黃色、一角翹起來、手寫字、署名），標準 v2：字 40～60、最大 430 × 430。
//  - 三隻狗坐在左下角的軟墊上，每拍一起點頭（元元最穩、芃芃慢半拍）。天花板的燈條每拍亮一下。鏡頭慢慢推近兩個人。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { ease, prog } from '../engine/util';
import { lyricAt, layoutLyric, beatAfter, type LyricStyle } from './_motifs';
import { paperBG, type Note } from './_couple';
import { loadPuppets, drawPuppet, puppetShadow, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet, writeNote } from './_c5';
import { pose, loadLyricGlyphs, drawLyricIn } from './_d2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'kculture', paper: true, energy: [0.45, 1], bars: [4, 8] };

/** 場景尺度（宣文站直的身高 px）與地板。 */
const SZ = 560;
const FLOOR = 972;
const CP_X = 1080;
/** 鏡牆：上緣、下緣（踢腳板）、一片一片的接縫。 */
const MIRROR = { top: 96, bottom: 770, seams: [440, 920, 1400] };
/** 貼在鏡子上的歌詞紙：中心 x、上緣、最大寬。 */
const SHEET = { cx: 1310, y: 150, w: 860 };
/** 便利貼（留言）：最大範圍（標準 v2）與寫字的內距。 */
const NOTE = { x: 118, y: 150, w: 430, h: 430 };
const PAD = { x: 34, top: 40, bottom: 30 };
/** 三隻狗坐的軟墊（左下角）。 */
const DOGS = [{ who: 'pp', x: 150 }, { who: 'qq', x: 290 }, { who: 'yy', x: 470 }] as const;
const DOG_Y = 1010, DOG_S = 1.05;

export default class Kpopdance extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(256, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  moves: string[] = [];
  /** 單人的替代（還沒有雙人舞步圖時）：宣文、孟庭各自的兩張。 */
  solo = { xw: ['xw_idle_front'], mt: ['mt_idle_front'] };
  couple = false;
  bars: number[] = [];
  lineStarts: number[] = [];
  note: Note | null = null;
  pad = { ...NOTE };
  noteT0 = 0;
  lyricSize = 50;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客歌詞LYRICS' + INVITE);
    await loadLyricGlyphs(lyrics, s, e);
    // 雙人舞步（四張一輪）；還沒畫好的時候先用兩人各自站著的圖頂著
    this.moves = [1, 2, 3, 4].map((k) => `cp_dance_${k}`).filter((n) => pose(n, '') !== '');
    this.couple = this.moves.length === 4;
    const names = this.couple ? this.moves : [...this.solo.xw, ...this.solo.mt];
    this.track(await loadPuppets([...names, 'pp_sit', 'qq_sit', 'yy_sit']));
    for (let bar = Math.ceil(au.barAt(s) - 1e-6), k = 0; k < 40; k++, bar++) { const t = au.timeOfBar(bar); if (t > e) break; this.bars.push(t); }
    for (const l of lyrics.linesIn(s - 1, e + 1)) this.lineStarts.push(l.start - 0.35);
    // 便利貼上的留言：標準 v2 的字級；便利貼是正方形（照留言的高度，寬高取大的那一個）
    const c = this.fg.ctx;
    const w = NOTE.w - PAD.x * 2, hmax = NOTE.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const nw = Math.min(NOTE.w, tightenNote(c, this.note, 320) + PAD.x * 2);
    const nh = Math.min(NOTE.h, Math.max(260, PAD.top + this.note.height + PAD.bottom + 10));
    const side = Math.max(nw, nh);
    this.pad = { x: NOTE.x, y: NOTE.y, w: side, h: side };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = Math.min(beatAfter(au, s + 0.4), s + 0.9);
    this.drawBackground();
  }

  /** 不會動的：鏡牆（淡淡的冷色、接縫、踢腳板）、木地板（一條條的木紋、往遠處收）、角落的軟墊與音響。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const M = MIRROR;
    // 鏡面：比牆淡一點、偏冷，上亮下暗
    const mg = c.createLinearGradient(0, M.top, 0, M.bottom);
    mg.addColorStop(0, mixRgba('paper', 'shirtblue', 0.2)); mg.addColorStop(1, mixRgba('paper', 'shirtblue', 0.34));
    c.fillStyle = mg;
    c.fillRect(0, M.top, W, M.bottom - M.top);
    // 鏡子裡的地板與天花板（反射）：一條地平線、幾條往遠處收的木紋
    c.strokeStyle = rgba('sepia', 0.08);
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, M.bottom - 150); c.lineTo(W, M.bottom - 150);
    for (let i = -8; i <= 8; i++) { c.moveTo(W / 2 + i * 60, M.bottom - 150); c.lineTo(W / 2 + i * 150, M.bottom); }
    c.stroke();
    // 接縫
    c.strokeStyle = rgba('sepia', 0.22);
    c.lineWidth = 2;
    c.beginPath();
    for (const x of M.seams) { c.moveTo(x, M.top); c.lineTo(x, M.bottom); }
    c.stroke();
    // 鏡框與踢腳板
    c.fillStyle = mixRgba('paper', 'sepia', 0.18);
    c.fillRect(0, M.top - 10, W, 10);
    c.fillStyle = mixRgba('paper', 'sepia', 0.25);
    c.fillRect(0, M.bottom, W, 26);
    // 木地板：淺木色、一條條往鏡頭展開的木紋
    const fg = c.createLinearGradient(0, M.bottom + 26, 0, H);
    fg.addColorStop(0, mixRgba('paper', 'fur', 0.3)); fg.addColorStop(1, mixRgba('paper', 'fur', 0.18));
    c.fillStyle = fg;
    c.fillRect(0, M.bottom + 26, W, H - M.bottom - 26);
    c.strokeStyle = rgba('sepia', 0.08);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = -14; i <= 14; i++) { c.moveTo(W / 2 + i * 90, M.bottom + 26); c.lineTo(W / 2 + i * 260, H); }
    c.stroke();
    // 狗狗的軟墊（左下角）
    c.fillStyle = mixRgba('paper', 'gingham', 0.4);
    c.beginPath(); c.ellipse(310, DOG_Y + 8, 260, 36, 0, 0, Math.PI * 2); c.fill();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const kick = beatKick(au, t, 0.3);

    // ---- 天花板的燈條：每拍亮一下（在鏡子上緣）
    c.fillStyle = mixRgba('bone', 'signal', 0.2 + 0.4 * kick);
    c.fillRect(0, 0, W, 16);
    c.fillStyle = rgba('bone', 0.5 + 0.4 * kick);
    for (let x = 60; x < W; x += 240) c.fillRect(x, 16, 120, 6);

    // ---- 鏡子裡的背影（淡、偏冷、左右相反）：畫完染成鏡面的冷色剪影（鏡子照的是背面，看不到臉）→ 小節線的光掃過鏡面
    this.drawDancers(c, t, true);
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = mixRgba('paper', 'shirtblue', 0.55, 0.97);
    c.fillRect(0, MIRROR.top, W, MIRROR.bottom - MIRROR.top);
    c.restore();
    this.drawSweep(c, t);
    // ---- 貼在鏡子上的：便利貼（留言）、歌詞紙
    this.drawSticky(c, t);
    this.drawSheet(c, t, lyrics);
    // ---- 真的兩個人、狗狗
    this.drawDancers(c, t, false);
    this.drawDogs(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push + 0.004 * kick, shake: [-(CP_X - W / 2) * 0.03 * push, 0] };
  }

  /**
   * 兩個人跳舞：每拍換一個舞步（四張一輪），拍點上往下一沉；小節線上一起小跳（最高點在小節線上）。
   * mirror = true：畫鏡子裡的背影——淡淡的冷色剪影、左右相反、比本人小一點點（在鏡子裡面比較遠），腳在踢腳板上。
   */
  private drawDancers(c: CanvasRenderingContext2D, t: number, mirror: boolean) {
    const au = this.ctx.audio;
    const en = enterPuppet(this.glow, t, this.ctx.start + 0.05, CP_X, FLOOR - 6, 1);
    if (!en) return;
    const bp = au.beatPeriod(t);
    let lift = 0, sq = 0.03 * beatKick(au, t, 0.22) + breathe(t, 0.008, 3);
    for (const tb of this.bars) {
      if (Math.abs(t - tb) > bp) continue;
      const j = jumpArc(t, tb - bp * 0.35, tb + bp * 0.35, 40, { crouch: 0.08, land: 0.14 });
      lift = -j.y; sq += j.squash;
    }
    const beat = Math.floor(au.beatAt(t) + 1e-6);
    const draw = (name: string, x: number) => {
      const o: PuppetOpts = { h: SZ, squash: sq, pivot: 0.1, spin: en.spin, alpha: en.alpha };
      if (mirror) {
        // 鏡像：鏡子是一面牆，人在鏡子前面 → 影像左右相反、遠一點、淡淡的
        const mx = W - x + (x - W / 2) * 0.1, my = MIRROR.bottom + 10;
        c.save();
        c.globalAlpha = 0.5 * en.alpha;
        drawPuppet(c, name, mx, my - lift * 0.8, { ...o, flip: true, scale: 0.82, alpha: 1 });
        c.restore();
        return;
      }
      puppetShadow(c, name.slice(0, 2), x, FLOOR, { h: SZ, lift, alpha: 0.28 * en.alpha, color: '70,45,25', wide: this.couple ? 1 : 1 });
      drawPuppet(c, name, x, FLOOR - lift, o);
    };
    if (this.couple) draw(this.moves[((beat % 4) + 4) % 4]!, CP_X);
    else {
      draw(this.solo.xw[0]!, CP_X - 170);
      draw(this.solo.mt[0]!, CP_X + 170);
    }
  }

  /** 小節線上：一道斜斜的亮光從鏡面左邊掃到右邊（0.5 拍）。 */
  private drawSweep(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    for (const tb of this.bars) {
      const u = (t - tb) / (au.beatPeriod(tb) * 0.6);
      if (u < 0 || u > 1) continue;
      const x = -300 + u * (W + 600);
      c.save();
      c.beginPath(); c.rect(0, MIRROR.top, W, MIRROR.bottom - MIRROR.top); c.clip();
      const g = c.createLinearGradient(x - 120, 0, x + 120, 0);
      g.addColorStop(0, rgba('bone', 0)); g.addColorStop(0.5, rgba('bone', 0.35 * Math.sin(Math.PI * u))); g.addColorStop(1, rgba('bone', 0));
      c.fillStyle = g;
      c.beginPath(); c.moveTo(x - 120, MIRROR.bottom); c.lineTo(x + 20, MIRROR.top); c.lineTo(x + 260, MIRROR.top); c.lineTo(x + 120, MIRROR.bottom); c.closePath(); c.fill();
      c.restore();
    }
  }

  /** 便利貼：淡黃色的正方形、右下角翹起來一點（陰影）、上緣一條黏膠的淡色帶；手寫的留言逐字寫上去。 */
  private drawSticky(c: CanvasRenderingContext2D, t: number) {
    const P = this.pad;
    const a = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.5);
    c.save();
    c.globalAlpha = a;
    c.translate(P.x + P.w / 2, P.y + P.h / 2);
    c.rotate(-0.015);
    c.translate(-P.w / 2, -P.h / 2);
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(8, 12, P.w, P.h);
    c.fillStyle = mixRgba('cream', 'ball', 0.35);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(P.w, 0); c.lineTo(P.w, P.h - 40); c.quadraticCurveTo(P.w - 6, P.h - 6, P.w - 44, P.h); c.lineTo(0, P.h); c.closePath(); c.fill();
    c.fillStyle = mixRgba('cream', 'ball', 0.5);
    c.fillRect(0, 0, P.w, 26);
    c.restore();
    const n = this.note;
    if (!n) return;
    c.save();
    c.globalAlpha = a;
    writeNote(c, n, P.x + PAD.x, P.y + PAD.top + Math.max(0, (P.h - PAD.top - PAD.bottom - n.height) * 0.4), t, this.noteT0, { msg: !!this.msg, color: rgba('sepia', 0.94), faint: rgba('sepia', 0.6), sig: rgba('sepia', 0.72) });
    c.restore();
  }

  /**
   * 貼在鏡子上的歌詞紙：白紙、四角膠帶、左上角小小的「LYRICS」；中文大字、原文小一號在下面（drawLyric 自動畫原文）。
   * 紙的大小跟著這一句；換一句時紙像被風扇吹到一樣翻一下（上緣固定、下緣往前掀）。間奏時紙上寫「（間奏：數拍子 5、6、7、8）」。
   */
  private drawSheet(c: CanvasRenderingContext2D, t: number, lyrics: typeof this.ctx.lyrics) {
    const ly = lyricAt(lyrics, t);
    let since = 9;
    for (const ls of this.lineStarts) if (t >= ls) since = t - ls;
    const flap = since < 0.5 ? Math.sin(since * 20) * Math.exp(-since / 0.12) : 0;
    const a = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.5);
    const st: LyricStyle = { family: F.hei(900), size: this.lyricSize, minSize: 40, maxWidth: SHEET.w - 100, align: 'center', unsung: rgba('sepia', 0.26), sung: rgba('sepia', 0.92), active: rgba('signal') };
    let w = 560, h = 120;
    if (ly) {
      const lay = layoutLyric(c, ly.line, st);
      const sub = lay.sub ? lay.sub.lay.rows.reduce((m, r) => Math.max(m, r.width), 0) : 0;
      w = Math.min(SHEET.w, Math.max(...lay.rows.map((r) => r.width), sub) + 110);
      h = lay.height + lay.size * 0.2 + 84;
    }
    const x = SHEET.cx - w / 2, y = SHEET.y;
    c.save();
    c.globalAlpha = a;
    c.translate(x, y);
    // 被風吹：上緣固定，整張紙在 y 方向縮一點點再彈回來（像下緣往前掀）
    if (Math.abs(flap) > 0.002) c.scale(1, 1 - 0.12 * Math.abs(flap));
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(6, 8, w, h);
    c.fillStyle = rgba('bone', 0.98);
    c.fillRect(0, 0, w, h);
    c.fillStyle = mixRgba('bone', 'shirtblue', 0.3, 0.8);
    for (const [tx, ty, r] of [[0, 0, -0.6], [w, 0, 0.6], [0, h, 0.6], [w, h, -0.6]] as const) { c.save(); c.translate(tx, ty); c.rotate(r); c.fillRect(-26, -9, 52, 18); c.restore(); }
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('sepia', 0.45);
    c.fillText('LYRICS', 24, 32);
    c.letterSpacing = '0px';
    if (ly) drawLyricIn(c, ly.line, t, st, { x: 20, y: 40, w: w - 40, h: h - 56 }, ly.k);
    else {
      c.font = font(F.hei(700), 40);
      c.textAlign = 'center';
      c.fillStyle = rgba('sepia', 0.5);
      c.fillText('（間奏：5、6、7、8）', w / 2, h / 2 + 22);
    }
    c.restore();
  }

  /** 三隻狗：坐在左下角的軟墊上，每拍一起點頭（元元最穩，芃芃慢半拍）；小節線上 QQ 跟著跳一下。 */
  private drawDogs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const bp = au.beatPeriod(t);
    DOGS.forEach((d, i) => {
      const en = enterPuppet(this.glow, t, this.ctx.start + 0.2 + i * 0.08, d.x, DOG_Y - 6, 3 + i);
      if (!en) return;
      const delay = d.who === 'pp' ? bp * 0.5 : 0;
      const nod = beatKick(au, t - delay, d.who === 'yy' ? 0.2 : 0.3);
      let lift = 0;
      if (d.who === 'qq') for (const tb of this.bars) { const u = (t - tb + bp * 0.3) / (bp * 0.6); if (u > 0 && u < 1) lift = 24 * Math.sin(Math.PI * u); }
      puppetShadow(c, d.who, d.x, DOG_Y, { h: SZ * DOG_S, lift, alpha: 0.28 * en.alpha, color: '70,45,25' });
      drawPuppet(c, `${d.who}_sit`, d.x, DOG_Y - lift, { h: SZ, scale: DOG_S, rot: (d.who === 'yy' ? 0.03 : 0.06) * nod * (i % 2 ? 1 : -1), pivot: 0.4, squash: 0.04 * nod, spin: en.spin, alpha: en.alpha });
    });

  }
}
