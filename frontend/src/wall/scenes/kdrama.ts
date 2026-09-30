// 追劇（暗、kculture、雙語）：深夜關了燈的客廳，只有電視亮著。宣文和孟庭窩在左邊的沙發上看韓劇，芃芃、QQ、元元在沙發前面的地毯上。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 d2），電視、劇情畫面、沙發、彈幕、抱枕是程式畫的。不畫任何電視台、節目、演員的名稱或標誌。
//  - 電視在右邊（一大面）：劇情畫面每個小節線換一個鏡頭（街燈下的兩個人剪影、雨傘、城市夜景），
//    **下緣是雙語字幕**：中文大字、原文小一號在下面（像真的韓劇字幕，白字、淡淡的陰影），逐字照歌聲亮。
//  - **焦點是主打留言**：電視上方的「觀眾來信」字幕條（半透明的深色條＋手寫感的字＋署名），標準 v2：字 40～60、最大 820 × 300。
//    彈幕：幾則很小、很淡的觀眾短評從右往左飄過（「好甜」「嗚嗚」♥），只是空氣。
//  - 劇情高潮：每四小節的最後一個小節線，電視一亮（告白的那一幕），孟庭抓住宣文的手臂、兩人往前傾；三隻狗一起歪頭。
//    平常兩人窩著看（孟庭抱著抱枕），每拍很輕地晃；狗狗坐著，每拍點一下頭。
//  - 光：電視的藍白光從右邊打在人和狗臉上，房間其他地方很暗；電視櫃在電視下面，右下角 HUD 那一塊只有暗暗的地板。鏡頭慢慢推近電視。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { ease, prog, hash, fract } from '../engine/util';
import { lyricAt, beatAfter, type LyricStyle } from './_motifs';
import { type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetShadow, puppetLight, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet, writeNote } from './_c5';
import { pose, loadLyricGlyphs, drawLyricIn } from './_d2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'kculture', paper: false, energy: [0, 0.75], bars: [4, 8] };

/** 電視（畫面範圍）。 */
const TV = { x: 820, y: 80, w: 1010, h: 572 };
/** 電視上的字幕區（下緣）與觀眾來信條（上緣，標準 v2）。 */
const SUBS = { x: TV.x + 40, y: TV.y + TV.h - 190, w: TV.w - 80, h: 170 };
const LETTER = { x: TV.x + 36, y: TV.y + 30, w: 800, h: 290 };
const LPAD = { x: 30, top: 50, bottom: 22 };
/** 沙發（右邊，面向電視）：坐墊的高度；兩人一起的紙偶坐著的腳底。 */
const SZ = 560;
/** 兩人坐在沙發上（四分之三側面朝右看電視）：腳踩在地毯上，比場景尺度大一點（坐著的背影很小，認不出來）。 */
const CP_X = 400, SEAT_Y = 992, CP_S = 1.12;
const SOFA = { x: 70, w: 660, seatY: 760, backY: 520 };
/** 狗狗坐在沙發前面的地毯上（地板）。 */
const FLOOR = 1010, DOG_S = 1.05;
/** 狗狗坐在沙發前的地毯上：芃芃在沙發左邊，QQ、元元在兩人腳的右邊（不要擋住兩人的腳）。 */
const DOGS = [{ who: 'pp', x: 130 }, { who: 'qq', x: 650 }, { who: 'yy', x: 805 }] as const;
const DANMAKU = ['好甜', '嗚嗚嗚', '♥', '告白了！', '在一起', '好哭', '♥♥', '好好看'];

/** 客廳：很暗；電視的光從左邊往右打開一個扇形、地上一片冷光。 */
const ROOM = () => new FSPass(/* glsl */ `
  uniform float lum;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK * 0.9;
    vec2 c = vec2(${TV.x + TV.w / 2}.0, ${TV.y + TV.h / 2}.0);
    vec2 d = (p - c) / vec2(1500.0, 800.0);
    col += vec3(0.55, 0.65, 0.85) * 0.05 * lum * exp(-dot(d, d) * 2.2);
    vec2 f = (p - vec2(520.0, 980.0)) / vec2(700.0, 120.0);
    col += vec3(0.55, 0.65, 0.85) * 0.03 * lum * exp(-dot(f, f));
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { lum: { value: 1 } });

/** 劇情畫面（電視裡）：每個鏡頭一個 shader 分支，都是很簡單的剪影與光，只是「在放劇」的氣氛。 */
const DRAMA = () => new FSPass(/* glsl */ `
  uniform float t;
  uniform float shot;
  uniform float flash;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = (p - vec2(${TV.x}.0, ${TV.y}.0)) / vec2(${TV.w}.0, ${TV.h}.0);
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) discard;
    // 下面的圖形照「y 往上」寫：翻過來
    q.y = 1.0 - q.y;
    vec3 night = mix(vec3(0.02, 0.03, 0.06), vec3(0.08, 0.1, 0.16), q.y);
    vec3 col = night;
    float s = mod(shot, 3.0);
    if (s > 1.5) s = 3.0;
    if (s < 0.5) {
      // 街燈下飄著花瓣：一盞路燈、地上一圈光、一張長椅的剪影，粉白的花瓣慢慢往下飄（劇裡的告白場景，不畫人）
      vec2 l = (q - vec2(0.84, 0.66)) / vec2(0.22, 0.45);
      col += vec3(1.0, 0.85, 0.6) * 0.3 * exp(-dot(l, l) * 3.0);
      col = mix(col, vec3(0.02), step(abs(q.x - 0.9), 0.004) * step(0.2, q.y) * step(q.y, 0.78));
      vec2 lp = (q - vec2(0.9, 0.79)) / vec2(0.025, 0.014);
      col += vec3(1.0, 0.9, 0.7) * 0.8 * exp(-dot(lp, lp));
      float bench = step(abs(q.x - 0.78), 0.07) * step(abs(q.y - 0.3), 0.012) + step(abs(q.x - 0.78), 0.07) * step(abs(q.y - 0.37), 0.008)
        + step(abs(abs(q.x - 0.78) - 0.058), 0.004) * step(0.2, q.y) * step(q.y, 0.37);
      col = mix(col, vec3(0.02), clamp(bench, 0.0, 1.0));
      vec2 g = vec2(q.x * 26.0 + sin(t * 0.7 + q.y * 6.0) * 0.4, q.y * 16.0 + t * 0.6);
      vec2 cell = floor(g);
      float hp = hash12(cell);
      vec2 fp = fract(g) - 0.5 - (vec2(hash12(cell + 1.7), hash12(cell + 4.3)) - 0.5) * 0.5;
      float petal = step(0.84, hp) * (1.0 - smoothstep(0.06, 0.12, length(fp * vec2(1.0, 1.6))));
      col += vec3(1.0, 0.8, 0.85) * petal * 0.45 * smoothstep(0.2, 0.6, q.x);
    } else if (s < 1.5) {
      // 雨傘：一把傘的剪影，下面的雨絲
      vec2 u = (q - vec2(0.5, 0.6)) / vec2(0.28, 0.16);
      float umb = step(dot(u, u), 1.0) * step(0.6, q.y);
      col += vec3(0.2, 0.25, 0.35) * 0.3;
      col = mix(col, vec3(0.02), umb * 0.9);
      float rain = step(0.97, fract(q.x * 60.0 + q.y * 8.0 - t * 3.0));
      col += vec3(0.4) * rain * 0.3;
    } else {
      // 城市夜景：遠處的大樓窗燈與河面的倒影
      float bx = floor(q.x * 22.0);
      float hgt = 0.25 + 0.3 * hash12(vec2(bx, 3.0));
      float bld = step(q.y, hgt) * step(0.3, q.y);
      col = mix(col, vec3(0.03, 0.03, 0.05), bld);
      float win = step(0.8, hash12(floor(q * vec2(90.0, 60.0)))) * bld;
      col += vec3(1.0, 0.8, 0.5) * win * 0.18;
      float refl = step(q.y, 0.3) * step(0.85, hash12(floor(vec2(q.x * 90.0, q.y * 200.0 + t * 2.0))));
      col += vec3(1.0, 0.8, 0.5) * refl * 0.05;
    }
    col *= 0.85 + 0.15 * smoothstep(0.0, 0.3, q.y);
    // 高潮那一下畫面亮一點（不要亮到字幕看不清楚）
    col += vec3(1.0) * flash * 0.1;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, shot: { value: 0 }, flash: { value: 0 } }, { over: true });

export default class Kdrama extends Scene {
  room = shared('kdrama.room', ROOM);
  drama = shared('kdrama.drama', DRAMA);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(256, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  bars: number[] = [];
  /** 高潮（告白的一幕）的時間：每四小節的最後一個小節線（窗格短就在第二個小節線）。 */
  climaxes: number[] = [];
  cpKeys: [number, string][] = [];
  note: Note | null = null;
  letter = { ...LETTER };
  noteT0 = 0;
  lyricSize = 48;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客觀眾來信' + DANMAKU.join('') + INVITE);
    await loadLyricGlyphs(lyrics, s, e);
    const P = { watch: pose('cp_kdrama_watch', 'cp_movie_1'), grab: pose('cp_kdrama_grab', 'cp_movie_4') };
    this.track(await loadPuppets([P.watch, P.grab, 'pp_sit', 'qq_sit', 'yy_sit', 'pp_work_tilt', 'qq_work_tilt', 'yy_tilt']));
    for (let bar = Math.ceil(au.barAt(s) - 1e-6), k = 0; k < 40; k++, bar++) { const t = au.timeOfBar(bar); if (t > e) break; this.bars.push(t); }
    const inWin = this.bars.filter((t) => t > s + 0.5 && t < e - 0.3);
    for (let i = 0; i < inWin.length; i++) if (i % 4 === 3) this.climaxes.push(inWin[i]!);
    if (!this.climaxes.length && inWin.length >= 2) this.climaxes.push(inWin[1]!);
    this.cpKeys = [[-1e9, P.watch]];
    for (const tc of this.climaxes) { const bp = au.beatPeriod(tc); this.cpKeys.push([tc - bp * 0.1, P.grab], [tc + bp * 2.5, P.watch]); }
    // 觀眾來信：標準 v2 的字級；字幕條的寬高跟著留言
    const c = this.fg.ctx;
    const w = LETTER.w - LPAD.x * 2, hmax = LETTER.h - LPAD.top - LPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const lw = Math.min(LETTER.w, tightenNote(c, this.note, 380) + LPAD.x * 2);
    this.letter = { x: LETTER.x, y: LETTER.y, w: lw, h: Math.min(LETTER.h, Math.max(170, LPAD.top + this.note.height + LPAD.bottom + 6)) };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = Math.min(beatAfter(au, s + 0.4), s + 0.9);
    this.drawBackground();
  }

  /** 不會動的：電視的外框與腳架、沙發（椅背、扶手；坐墊的前緣另外蓋）、地毯。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 電視：黑色細框、下面一座矮櫃
    c.fillStyle = rgba('ink', 1);
    c.fillRect(TV.x - 14, TV.y - 14, TV.w + 28, TV.h + 28);
    c.strokeStyle = rgba('bone', 0.08);
    c.lineWidth = 2;
    c.strokeRect(TV.x - 14, TV.y - 14, TV.w + 28, TV.h + 28);
    c.fillStyle = mixRgba('ink', 'ink2', 0.7);
    c.fillRect(TV.x + 60, TV.y + TV.h + 40, TV.w - 120, 96);
    c.strokeStyle = rgba('bone', 0.06);
    c.strokeRect(TV.x + 60, TV.y + TV.h + 40, TV.w - 120, 96);
    // 地毯：沙發前面一塊橢圓
    c.fillStyle = mixRgba('ink', 'ink2', 0.8);
    c.beginPath(); c.ellipse(420, 1030, 520, 70, 0, 0, Math.PI * 2); c.fill();
    // 沙發：椅背（圓圓的）、兩個扶手，深色絨布
    const S = SOFA;
    const sofa = mixRgba('ink2', 'shirtblue', 0.14);
    c.fillStyle = sofa;
    c.beginPath(); c.roundRect(S.x, S.backY, S.w, S.seatY - S.backY + 40, 40); c.fill();
    c.fillStyle = mixRgba('ink2', 'shirtblue', 0.2);
    c.beginPath(); c.roundRect(S.x - 30, S.seatY - 120, 80, 220, 30); c.fill();
    c.beginPath(); c.roundRect(S.x + S.w - 50, S.seatY - 120, 80, 220, 30); c.fill();
    c.strokeStyle = rgba('bone', 0.08);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(S.x + 40, S.backY + 4); c.lineTo(S.x + S.w - 40, S.backY + 4); c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    // 劇情的鏡頭：每個小節線換一個；高潮那一下電視一亮
    let shot = 0;
    for (const tb of this.bars) if (t >= tb) shot++;
    let flash = 0;
    for (const tc of this.climaxes) { const d = t - tc; if (d >= 0 && d < 0.6) flash = Math.max(flash, Math.exp(-d / 0.15)); }
    const on = prog(t, s, s + 0.4);
    this.room.u.lum!.value = on * (1 + 0.8 * flash);
    this.room.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    this.drama.u.t!.value = t;
    this.drama.u.shot!.value = shot;
    this.drama.u.flash!.value = flash;
    this.drama.render(renderer, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 人與狗（最先畫：打光只染紙偶）：電視在左邊，所以左亮右暗
    this.drawFairyLights(c, t);
    this.sofaFront(c);
    this.drawCouple(c, t);
    this.drawDogs(c, t);
    puppetLight(c, [0, 300, 980, 780], rgba('ink', 0.2 - 0.15 * flash), rgba('ink', 0.62));
    // ---- 電視上的東西：彈幕（很淡）、觀眾來信（留言）、雙語字幕（歌詞）
    c.save();
    c.beginPath(); c.rect(TV.x, TV.y, TV.w, TV.h); c.clip();
    this.drawDanmaku(c, t);
    this.drawLetter(c, t);
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st: LyricStyle = { family: F.hei(700), size: this.lyricSize, minSize: 40, maxWidth: SUBS.w, align: 'center', unsung: rgba('bone', 0.35), sung: rgba('bone', 0.96), active: rgba('signal') };
      // 字幕底下一條很淡的暗帶，字在亮的畫面上也看得清楚
      const g = c.createLinearGradient(0, SUBS.y - 20, 0, TV.y + TV.h);
      g.addColorStop(0, rgba('ink', 0)); g.addColorStop(0.4, rgba('ink', 0.5)); g.addColorStop(1, rgba('ink', 0.7));
      c.fillStyle = g;
      c.fillRect(TV.x, SUBS.y - 20, TV.w, TV.y + TV.h - SUBS.y + 20);
      drawLyricIn(c, ly.line, t, st, SUBS, ly.k * on);
    }
    c.restore();

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.55, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(TV.x + TV.w / 2 - W / 2) * 0.02 * push, 0] };
  }

  /**
   * 左邊牆上一串暖色的小燈泡（沙發上方，垂成兩道弧）：很暗的客廳裡唯一的暖光，每拍有幾顆輪流亮一下，高潮那一下全亮。
   */
  private drawFairyLights(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const beat = Math.floor(au.beatAt(t) + 1e-6);
    const kick = beatKick(au, t, 0.35);
    let flash = 0;
    for (const tc of this.climaxes) { const d = t - tc; if (d >= 0 && d < 0.8) flash = Math.max(flash, 1 - d / 0.8); }
    const a0 = prog(t, this.ctx.start, this.ctx.start + 0.4);
    c.save();
    c.strokeStyle = rgba('bone', 0.12 * a0);
    c.lineWidth = 1.5;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 28; i++) {
      const u = i / 28, x = 90 + u * 620;
      // 兩道弧：中間釘在牆上一次
      const sag = u < 0.5 ? Math.sin(Math.PI * u * 2) : Math.sin(Math.PI * (u - 0.5) * 2);
      pts.push({ x, y: 150 + 70 * sag });
    }
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    pts.forEach((p, i) => {
      if (i % 2) return;
      const on = (i / 2 + beat) % 5 === 0 ? kick : 0;
      const b = 0.35 + 0.5 * on + 0.6 * flash;
      const g = c.createRadialGradient(p.x, p.y + 6, 0, p.x, p.y + 6, 16);
      g.addColorStop(0, mixRgba('cream', 'fur', 0.3, b * a0)); g.addColorStop(1, mixRgba('cream', 'fur', 0.3, 0));
      c.fillStyle = g;
      c.fillRect(p.x - 16, p.y - 10, 32, 32);
      c.fillStyle = mixRgba('cream', 'fur', 0.25, Math.min(1, 0.5 + b) * a0);
      c.beginPath(); c.ellipse(p.x, p.y + 6, 3.5, 5, 0, 0, Math.PI * 2); c.fill();
    });
    c.restore();
  }

  /** 兩人：窩在沙發上看（抱著抱枕），每拍很輕地晃；高潮那一下換成孟庭抓住宣文、兩人往前傾。電視在右邊，圖本來就朝右。 */
  private drawCouple(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const en = enterPuppet(this.glow, t, this.ctx.start + 0.05, CP_X, SOFA.seatY, 1);
    if (!en) return;
    let lean = 0;
    for (const tc of this.climaxes) lean = Math.max(lean, prog(t, tc - 0.1, tc + 0.15, ease.outCubic) * (1 - prog(t, tc + 1.2, tc + 1.8)));
    const o: PuppetOpts = { h: SZ, rot: 0.05 * lean + 0.01 * Math.sin(au.beatAt(t) * Math.PI * 0.5), pivot: 0.2, squash: breathe(t, 0.008, 3.4) - 0.02 * lean, spin: en.spin, alpha: en.alpha };
    drawPick(c, this.cpKeys, t, CP_X, SEAT_Y, { ...o, scale: CP_S });
  }

  /** 狗狗：坐在沙發前的地毯上，每拍點一下頭；高潮那一下三隻一起歪頭（兩拍）。 */
  private drawDogs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    let tilt = false;
    for (const tc of this.climaxes) if (t >= tc && t < tc + au.beatPeriod(tc) * 2) tilt = true;
    const nod = beatKick(au, t, 0.3);
    DOGS.forEach((d, i) => {
      const en = enterPuppet(this.glow, t, this.ctx.start + 0.2 + i * 0.08, d.x, FLOOR, 3 + i);
      if (!en) return;
      const name = tilt ? (d.who === 'yy' ? 'yy_tilt' : `${d.who}_work_tilt`) : `${d.who}_sit`;
      puppetShadow(c, d.who, d.x, FLOOR, { h: SZ * DOG_S, alpha: 0.5 * en.alpha, color: '0,0,0' });
      drawPuppet(c, name, d.x, FLOOR, { h: SZ, scale: DOG_S, rot: tilt ? 0 : 0.03 * Math.sin((au.beatAt(t) + i * 0.3) * Math.PI), pivot: 0.3, squash: 0.03 * nod, spin: en.spin, alpha: en.alpha });
    });
  }

  /** 沙發坐墊的前緣（兩人坐在上面，腿從坐墊垂下來踩在地毯上，所以先畫坐墊再畫人）。 */
  private sofaFront(c: CanvasRenderingContext2D) {
    const S = SOFA;
    c.save();
    c.fillStyle = mixRgba('ink2', 'shirtblue', 0.1);
    c.beginPath(); c.roundRect(S.x + 20, S.seatY + 40, S.w - 40, 110, 24); c.fill();
    c.strokeStyle = rgba('bone', 0.06);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(S.x + 40, S.seatY + 42); c.lineTo(S.x + S.w - 40, S.seatY + 42); c.stroke();
    c.restore();
  }

  /** 彈幕：很小、很淡的短評從右往左飄過（只是空氣，不搶留言與字幕）；位置與出現時間照種子。 */
  private drawDanmaku(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.font = font(F.hei(500), 20);
    for (let i = 0; i < 6; i++) {
      const speed = 150 + 60 * hash(i, 2);
      const u = fract(hash(i, 3) + (t * speed) / (TV.w + 400));
      const x = TV.x + TV.w + 100 - u * (TV.w + 400);
      const y = TV.y + this.letter.h + 70 + hash(i, 4) * (SUBS.y - TV.y - this.letter.h - 110);
      c.fillStyle = rgba('bone', 0.28);
      c.fillText(DANMAKU[i % DANMAKU.length]!, x, y);
    }
    c.restore();
  }

  /** 觀眾來信：電視上方一條半透明的深色字幕條，左邊一道訊號色細邊，小小的「觀眾來信」、留言逐字寫出、署名。 */
  private drawLetter(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.letter;
    const a = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    const slide = 1 - ease.outCubic(prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7));
    c.save();
    c.globalAlpha = a;
    c.translate(-40 * slide, 0);
    c.fillStyle = rgba('ink', 0.62);
    c.beginPath(); c.roundRect(B.x, B.y, B.w, B.h, 10); c.fill();
    c.fillStyle = rgba('signal', 0.95);
    c.fillRect(B.x, B.y + 12, 5, B.h - 24);
    c.font = font(F.hei(700), 18);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('signal', 0.9);
    c.fillText('觀眾來信', B.x + LPAD.x, B.y + 34);
    c.letterSpacing = '0px';
    writeNote(c, n, B.x + LPAD.x, B.y + LPAD.top + Math.max(0, (B.h - LPAD.top - LPAD.bottom - n.height) * 0.4), t, this.noteT0, { msg: !!this.msg, color: rgba('bone', 0.96), faint: rgba('bone', 0.66), sig: rgba('bone', 0.72) });
    c.restore();
  }
}
