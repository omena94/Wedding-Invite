// 愛情鎖（暗、trip、雙語、日常服一）：山頂觀景台的夜晚，一整面掛滿愛情鎖的鐵絲網圍欄，網子後面是山谷裡的城市燈海（通用的樣子，不畫真實地標）。
// 宣文和孟庭站在圍欄前（背影，宣文摟著孟庭、孟庭指著夜景），剛把一把新的銅鎖掛上去。角色是 Codex 畫的紙偶（cp_lantern_watch 背影、cp_hug）。
//  - **主打留言是新掛上的那把鎖**（左邊，比別的鎖大很多）：一開始鎖鉤還開著，**第一個小節線「喀」一聲扣上**（鎖鉤落下、火花一閃、
//    鎖晃兩下），下一拍兩人把鑰匙往山谷丟（鑰匙劃一道弧飛過圍欄、在拍點閃一下）；鎖晃停之後，仙女棒的火花在鎖面上一個字一個字刻出留言。
//    再下一個小節線兩人轉過身來抱在一起（紙偶翻面換成 cp_hug）。照「留言尺寸與版面比例標準 v2」：字 40～60、署名 26～32，鎖面 ≤ 620 × 400。
//    沒有留言時鎖面刻的是邀請（字小、淡）。
//  - **兩行歌詞是圍欄上的吊牌**：中文每個字（英文每個單字）刻在一個小小的琺瑯鎖牌上，一個一個掛在圍欄上緣，唱到哪一個、那一個就亮起來、往下晃一下；
//    原文寫在牌子下面綁著的一條緞帶上（小一號，照自己的逐字時間亮）。沒有翻譯就只有吊牌、不綁緞帶。
//  - 動畫：拍點上圍欄上的舊鎖隨機閃一下光、星星眨、城市燈火一明一滅、緞帶的尾巴被風吹。鏡頭整個窗格慢慢推近那把新鎖。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, subStyleFor, subGap, lyricSubOf, barAfter, beatAfter, msgChars, sparkHead, sparkParticles, COUPLE_ZH, type LyricStyle } from './_motifs';
import { drawNote, type Note } from './_couple';
import { loadPuppets, drawPuppet, puppetShadow, puppetIn, puppetLight, breathe, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'trip', paper: false, energy: [0.1, 0.8], bars: [4, 8] };

/** 圍欄：上緣、下緣（水泥矮牆）、甲板地面；兩個人站的位置。 */
const TOP = 190, BOTTOM = 820, FEET = 1000, SZ = 540, CX = 1020;
/** 新鎖（留言）：鎖面的最大範圍（左邊）與寫字內距。 */
const LOCK = { x: 110, y: 500, w: 620, h: 400 };
const PAD = { x: 44, top: 70, bottom: 40 };
/** 吊牌：從哪裡開始排、最寬多寬。 */
const TAGS = { x: 150, y: TOP + 34, w: 1180 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['cp_lantern_watch', 'cp_hug'];
const TAG_TINTS = ['collar', 'shirtblue', 'gingham', 'rose', 'fur'];

/** 夜空：上面深、往山谷越暖（城市的光害），滿天小星星（格子裡隨機一顆），拍點上眨一下。 */
const SKY = () => new FSPass(/* glsl */ `
  uniform float t; uniform float tw;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float y = p.y / 560.0;
    vec3 col = mix(C_INK, mix(C_INK2, C_BLOOD, 0.3), smoothstep(0.0, 1.0, y));
    col += C_SIGNAL * 0.04 * exp(-pow((p.y - 560.0) / 120.0, 2.0));
    vec2 g = floor(p / 10.0);
    float h = hash12(g);
    if (h > 0.86 && p.y < 460.0) {
      vec2 sp = (g + 0.2 + 0.6 * hash22(g + 7.0)) * 10.0;
      float lum = pow((h - 0.86) / 0.14, 2.0) * (0.6 + 0.4 * sin(t * (1.0 + 2.0 * hash12(g + 9.0)) + h * 30.0)) * (1.0 + tw * step(0.95, hash12(g + 3.0)));
      col += C_BONE * exp(-dot(p - sp, p - sp) / 1.2) * lum * 0.8;
    }
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, tw: { value: 0 } });

interface OldLock { x: number; y: number; s: number; col: string }
interface TagLay { size: number; tags: { i: number; x: number; y: number; w: number; text: string }[]; bottom: number; x0: number }

export default class Lovelocks extends Scene {
  sky = shared('lovelocks.sky', SKY);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  lock = { ...LOCK };
  /** 喀（扣上）、丟鑰匙、開始刻字、刻完、轉身抱。 */
  tClick = 0; tKey = 0; tw0 = 0; twd = 0; tHug = Infinity;
  per = 0.05;
  olds: OldLock[] = [];
  lyricSize = 48;
  tagCache = new Map<Line, TagLay>();

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + COUPLE_ZH + '&');
    this.track(await loadPuppets(SPRITES));
    const bp = au.beatPeriod(s);
    this.tClick = barAfter(au, s + 0.4);
    if (this.tClick > e - bp * 2) this.tClick = beatAfter(au, s + 0.4);
    this.tKey = this.tClick + bp;
    // 鎖晃一拍半之後開始刻字（刻字的時候鎖是靜止的，字才不用每格重新光柵化斜的）
    this.tw0 = this.tClick + bp * 1.5;
    const c = this.fg.ctx;
    const tw = LOCK.w - PAD.x * 2, th = LOCK.h - PAD.top - PAD.bottom;
    // 刻在銅鎖上的字：思源宋體粗體（刻字的感覺，細的手寫體刻在銅上讀不清楚）
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th, { family: F.ming(700) }) : noteV2(c, INVITE, null, tw, th * 0.6, { max: 40, family: F.ming(700) });
    const w = Math.min(LOCK.w, Math.max(380, tightenNote(c, this.note, 300) + PAD.x * 2));
    const h = Math.min(LOCK.h, Math.max(250, PAD.top + this.note.height + PAD.bottom));
    this.lock = { x: LOCK.x + (LOCK.w - w) / 2, y: LOCK.y + (LOCK.h - h) * 0.3, w, h };
    const total = this.msg ? msgChars(this.note.fit) : 0;
    this.per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    this.twd = this.tw0 + total * this.per;
    const hug = barAfter(au, Math.max(this.twd, this.tClick + bp * 3) + bp * 0.5);
    if (hug < e - bp * 2) this.tHug = hug;
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    // 圍欄上的舊鎖：下半部最密、往上越少；避開新鎖的位置與右下角 HUD
    for (let i = 0; i < 420; i++) {
      const x = 30 + (W - 60) * hash(i, 1), y = TOP + 20 + (BOTTOM - TOP - 40) * Math.pow(hash(i, 2), 0.55);
      if (x > this.lock.x - 20 && x < this.lock.x + this.lock.w + 20 && y > this.lock.y - 150 && y < this.lock.y + this.lock.h + 20) continue;
      if (y < TOP + 170 && x < TAGS.x + TAGS.w + 40) continue;
      this.olds.push({ x, y, s: 12 + 14 * hash(i, 3), col: TAG_TINTS[i % TAG_TINTS.length]! });
    }
    this.drawBackground();
  }

  /** 不會動的：山谷的城市燈海（散景）、山稜、圍欄（柱子、上下緣、鐵絲網）、舊鎖、水泥矮牆、木頭甲板。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 遠山與山谷的城市（光點）
    c.fillStyle = mixRgba('ink', 'ink2', 0.6);
    c.beginPath(); c.moveTo(0, 600);
    for (let x = 0; x <= W; x += 20) c.lineTo(x, 520 - 60 * Math.sin(x * 0.003 + 1.2) - 20 * Math.sin(x * 0.011));
    c.lineTo(W, 900); c.lineTo(0, 900); c.closePath(); c.fill();
    for (let i = 0; i < 900; i++) {
      const x = W * hash(i, 11), y = 560 + 260 * Math.pow(hash(i, 12), 0.7);
      const warm = hash(i, 13) < 0.8;
      c.fillStyle = warm ? mixRgba('signal', 'bone', 0.3 * hash(i, 14), 0.25 + 0.5 * hash(i, 15)) : rgba('bone', 0.3);
      const r = 1 + 2 * hash(i, 16) ** 3;
      c.fillRect(x, y, r, r);
    }
    // 鐵絲網（菱形格，淡）
    c.save();
    c.beginPath(); c.rect(0, TOP, W, BOTTOM - TOP); c.clip();
    c.strokeStyle = rgba('bone', 0.07);
    c.lineWidth = 1;
    c.beginPath();
    for (let k = -H; k < W + H; k += 34) { c.moveTo(k, TOP); c.lineTo(k + (BOTTOM - TOP), BOTTOM); c.moveTo(k, BOTTOM); c.lineTo(k + (BOTTOM - TOP), TOP); }
    c.stroke();
    c.restore();
    // 柱子、上緣、下緣
    c.fillStyle = mixRgba('ink2', 'ash', 0.25);
    for (const px of [40, 470, 900, 1330, 1760]) c.fillRect(px - 7, TOP - 20, 14, BOTTOM - TOP + 20);
    c.fillRect(0, TOP - 8, W, 12);
    c.fillStyle = mixRgba('ink2', 'bone', 0.18);
    c.fillRect(0, TOP - 8, W, 3);
    // 舊鎖：小小的彩色鎖（鎖身＋鎖鉤），暗處的顏色
    for (const o of this.olds) {
      c.strokeStyle = mixRgba('ash', 'ink', 0.4);
      c.lineWidth = Math.max(1.5, o.s * 0.14);
      c.beginPath(); c.arc(o.x, o.y - o.s * 0.2, o.s * 0.32, Math.PI, 0); c.stroke();
      c.fillStyle = mixRgba(o.col, 'ink', 0.5);
      c.beginPath(); c.roundRect(o.x - o.s * 0.5, o.y - o.s * 0.2, o.s, o.s * 0.8, o.s * 0.15); c.fill();
    }
    // 水泥矮牆與甲板
    c.fillStyle = mixRgba('ink2', 'ash', 0.2);
    c.fillRect(0, BOTTOM, W, 36);
    c.fillStyle = mixRgba('ink2', 'bone', 0.12);
    c.fillRect(0, BOTTOM, W, 3);
    const g = c.createLinearGradient(0, BOTTOM + 36, 0, H);
    g.addColorStop(0, mixRgba('ink2', 'fur', 0.12));
    g.addColorStop(1, rgba('ink'));
    c.fillStyle = g;
    c.fillRect(0, BOTTOM + 36, W, H - BOTTOM - 36);
    c.strokeStyle = rgba('ink', 0.6);
    c.lineWidth = 2;
    c.beginPath();
    for (let y = BOTTOM + 70; y < H; y += 44 + (y - BOTTOM) * 0.12) { c.moveTo(0, y); c.lineTo(1330, y); }
    c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.glow.clear();
    this.sky.u.t!.value = t;
    this.sky.u.tw!.value = f.a.hat;
    this.sky.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    this.drawCouple(c, t);
    // ---- 舊鎖在拍點上閃一下光
    const b = Math.floor(au.beatAt(t));
    const since = t - au.timeOfBeat(b);
    if (since < 0.3 && this.olds.length) {
      const k = 1 - since / 0.3, e = LIN.ember;
      for (let j = 0; j < 3; j++) {
        const o = this.olds[Math.floor(hash(b, j, 7) * this.olds.length)]!;
        this.glow.seg2(o.x - o.s * 0.3, o.y, o.x - o.s * 0.3 + 0.01, o.y, 8 * k, [e[0] * 2 * k, e[1] * 2 * k, e[2] * 1.5 * k], 0.8);
      }
    }
    // ---- 吊牌（歌詞）
    const ly = lyricAt(lyrics, t);
    // 吊牌與緞帶畫在新鎖的前面（緞帶綁在圍欄前面，折兩排時會蓋到鎖鉤、不會被鎖鉤蓋住）
    // ---- 新鎖（留言）與鑰匙
    this.drawLock(c, t);
    if (ly) this.drawTags(c, ly.line, t, ly.k * prog(t, s, s + 0.5));
    this.drawKey(t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const fx = this.lock.x + this.lock.w / 2, fy = this.lock.y + this.lock.h / 2;
    return { bloom: 0.8, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(fx - W / 2) * 0.03 * push, -(fy - H / 2) * 0.03 * push] };
  }

  /** 兩個人：背影站在圍欄前（宣文摟著孟庭、孟庭指著夜景），跟著拍子輕輕晃；轉身的小節線前半拍翻成一條線、換成抱在一起的正面。 */
  private drawCouple(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    const en = puppetIn(t, s + 0.05, 0.5);
    if (en.alpha <= 0) return;
    let pose = 'cp_lantern_watch', spin = en.spin;
    if (this.tHug < Infinity) {
      const k = prog(t, this.tHug - bp * 0.5, this.tHug + bp * 0.5, ease.inOutCubic);
      spin += 0.25 * (1 - Math.abs(1 - 2 * k));
      if (k >= 0.5) pose = 'cp_hug';
    }
    const o = { h: SZ, spin, alpha: en.alpha, rot: 0.012 * Math.sin(au.barAt(t) * Math.PI * 2), squash: breathe(t, 0.006, 3.3) + 0.012 * beatKick(au, t, 0.3) };
    puppetShadow(c, 'cp', CX, FEET, { h: SZ, alpha: 0.6 * en.alpha, color: '0,0,0' });
    drawPuppet(c, pose, CX, FEET, o);
    // 夜裡：上面被城市的光照一點（暖）、往腳底越暗
    puppetLight(c, [CX - 300, FEET - SZ * 1.1, 600, SZ * 1.15], mixRgba('signal', 'ink', 0.75, 0.12), rgba('ink', 0.55));
  }

  /** 吊牌的排版：每個字（英文每個單字）一塊牌子，照寬度排成一到兩排；太長就縮字（最小 40）。同一句只排一次。 */
  private tagsFor(c: CanvasRenderingContext2D, line: Line): TagLay {
    const hit = this.tagCache.get(line);
    if (hit) return hit;
    const fam = F.hei(700);
    // 先試一排放得下的最大字級（最小 40）；一排放不下才折成兩排（用第一個兩排放得下的字級）
    let lay: TagLay | null = null, two: TagLay | null = null;
    for (let size = this.lyricSize; size >= 40; size -= 2) {
      c.font = font(fam, size);
      const gap = size * 0.2, rowH = size * 1.6;
      const tags: TagLay['tags'] = [];
      let x = 0, row = 0;
      line.words.forEach((w, i) => {
        const text = w.w.trim();
        if (!text) return;
        const tw = Math.max(size * 1.2, c.measureText(text).width + size * 0.44);
        if (x > 0 && x + tw > TAGS.w) { row++; x = 0; }
        tags.push({ i, x, y: row * rowH, w: tw, text });
        x += tw + gap;
      });
      const L: TagLay = { size, tags, bottom: row * rowH + size * 1.25, x0: TAGS.x };
      if (row === 0) { lay = L; break; }
      if (row === 1 && !two) two = L;
      if (size <= 40) two ??= L;
    }
    lay ??= two!;
    this.tagCache.set(line, lay);
    return lay;
  }

  /**
   * 吊牌：每塊是一把小小的琺瑯鎖牌（深色、邊框是不同顏色），用鎖鉤掛在圍欄上；唱到的字亮起來、那塊牌子往下晃一下。
   * 原文：牌子下面綁著一條緞帶，原文寫在緞帶上（副行的字級照 subStyleFor；還沒唱米白六成、唱到亮白，壓在深酒紅上讀得清楚）；沒有原文就不綁。
   */
  private drawTags(c: CanvasRenderingContext2D, line: Line, t: number, alpha: number) {
    const au = this.ctx.audio;
    const lay = this.tagsFor(c, line);
    const size = lay.size;
    c.save();
    c.globalAlpha = alpha;
    c.font = font(F.hei(700), size);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    for (const tg of lay.tags) {
      const w = line.words[tg.i]!;
      const p = Lyrics.wordProgress(w, t);
      // 唱到這個字的那一下：牌子往下晃（彈回來）
      const d = t - w.start;
      const drop = d > 0 && d < 0.5 ? 6 * Math.sin(d * 18) * Math.exp(-d * 6) : 0;
      const sway = 2 * Math.sin(t * 1.6 + tg.i * 1.3);
      const x = lay.x0 + tg.x + sway, y = TAGS.y + tg.y + drop;
      const tint = TAG_TINTS[tg.i % TAG_TINTS.length]!;
      // 鎖鉤
      c.strokeStyle = mixRgba('ash', 'bone', 0.3);
      c.lineWidth = 3;
      c.beginPath(); c.arc(x + tg.w / 2, y + 2, size * 0.26, Math.PI, 0); c.stroke();
      // 牌身
      c.fillStyle = rgba('ink', 0.5);
      c.beginPath(); c.roundRect(x + 4, y + 6, tg.w, size * 1.25, size * 0.2); c.fill();
      c.fillStyle = p > 0 ? mixRgba(tint, 'ink', 0.55) : mixRgba(tint, 'ink', 0.75);
      c.beginPath(); c.roundRect(x, y, tg.w, size * 1.25, size * 0.2); c.fill();
      c.strokeStyle = mixRgba(tint, 'bone', 0.25);
      c.lineWidth = 2;
      c.stroke();
      // 字：還沒唱淡、正在唱訊號色（唱到哪亮到哪）、唱完亮白
      const tx = x + tg.w / 2, ty = y + size * 0.98;
      c.fillStyle = rgba('bone', 0.32);
      if (p < 1) c.fillText(tg.text, tx, ty);
      if (p > 0) {
        c.save();
        c.beginPath(); c.rect(x, y, tg.w * p, size * 1.3); c.clip();
        c.fillStyle = p < 1 ? rgba('signal') : rgba('bone', 0.96);
        c.fillText(tg.text, tx, ty);
        c.restore();
      }
      if (d > 0 && d < 0.25) { const k = 1 - d / 0.25, e = LIN.ember; this.glow.seg2(x + tg.w / 2, y + 2, x + tg.w / 2 + 0.01, y + 2, 16 * k, [e[0] * 2 * k, e[1] * 2 * k, e[2] * 1.4 * k], 0.8); }
    }
    c.restore();
    // 原文的緞帶
    const sub = lyricSubOf(line);
    if (!sub) return;
    const st: LyricStyle = { family: F.hei(700), size, minSize: 40, maxWidth: TAGS.w, align: 'left', unsung: rgba('bone', 0.3), sung: rgba('bone', 0.95), active: rgba('signal') };
    const sl = layoutLyric(c, sub, subStyleFor(st, size));
    const sw = Math.max(...sl.rows.map((r) => r.width)) + 60;
    const base = TAGS.y + lay.bottom + subGap(size, sl.size) - size * 0.35;
    const top = base - sl.size * 1.05, h = sl.height + sl.size * 0.6;
    const x0 = lay.x0 - 20;
    const wind = Math.sin(t * 2.4) * 8 + 5 * beatKick(au, t, 0.3);
    c.save();
    c.globalAlpha = alpha;
    // 緞帶的兩條尾巴（被風吹）與帶身
    // 緞帶是深酒紅（不要亮紅：原文的淡字壓在亮紅上會讀不到）
    c.fillStyle = mixRgba('collar', 'ink', 0.62);
    for (const [ex, dir] of [[x0, -1], [x0 + sw, 1]] as const) {
      c.beginPath();
      c.moveTo(ex, top + 4); c.lineTo(ex + dir * 46, top + h * 0.3 + wind * 0.5); c.lineTo(ex + dir * 30, top + h * 0.5 + wind);
      c.lineTo(ex + dir * 50, top + h + 8 + wind); c.lineTo(ex, top + h - 4); c.closePath(); c.fill();
    }
    c.fillStyle = mixRgba('collar', 'ink', 0.5);
    c.fillRect(x0, top, sw, h);
    c.fillStyle = rgba('bone', 0.08);
    c.fillRect(x0, top + 3, sw, 3);
    // 原文：還沒唱的米白（六成）、唱到的亮白，照原文自己的逐字時間（副行不用訊號色，跟 drawLyricSub 的規則一樣，只是對比拉開）
    c.translate(lay.x0 + 10, base);
    c.font = font(st.family, sl.size);
    c.textBaseline = 'alphabetic';
    for (const pw of sl.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      c.fillStyle = rgba('bone', 0.6);
      if (p < 1) c.fillText(pw.word.w, pw.x, pw.y);
      if (p <= 0) continue;
      c.save();
      c.beginPath(); c.rect(pw.x - sl.size * 0.1, pw.y - sl.size * 1.1, (pw.w + sl.size * 0.2) * p, sl.size * 1.5); c.clip();
      c.fillStyle = rgba('bone', 1);
      c.fillText(pw.word.w, pw.x, pw.y);
      c.restore();
    }
    c.restore();
  }

  /**
   * 新鎖：大大的銅鎖（鎖身、鎖鉤、鑰匙孔、刻著兩人的名字），一開始鎖鉤開著，小節線上「喀」地扣上（落下、火花、鎖晃兩下）；
   * 晃停之後火花在鎖面上刻出留言（一個字一個字）、寫完署名。
   */
  private drawLock(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const K = this.lock, s = this.ctx.start;
    const bp = this.ctx.audio.beatPeriod(t);
    const a = prog(t, s + 0.1, s + 0.5);
    // 鎖鉤：扣上之前抬高 60 px，扣上那一下落到底、彈一下
    const up = t < this.tClick ? 60 : 60 * Math.max(0, Math.exp(-(t - this.tClick) / 0.04) - 0.08 * Math.sin((t - this.tClick) * 40) * Math.exp(-(t - this.tClick) / 0.1));
    // 扣上之後鎖晃（繞鎖鉤頂端，阻尼擺），刻字前停下來
    const d = t - this.tClick;
    const rot = d > 0 ? 0.08 * Math.sin(d * 9) * Math.exp(-d * 3.2) * (t < this.tw0 ? 1 : 0) : 0;
    const shTop = K.y - 120, px = K.x + K.w / 2;
    c.save();
    c.globalAlpha = a;
    c.translate(px, shTop);
    c.rotate(rot);
    c.translate(-px, -shTop);
    // 鎖鉤（粗粗的 U，穿過鐵絲網）
    const sw = K.w * 0.52, sx0 = px - sw / 2;
    // 不鏽鋼的鎖鉤：灰、上緣一條細細的反光（不要比鎖面上的字還亮）
    c.strokeStyle = mixRgba('ash', 'ink', 0.25);
    c.lineWidth = 22;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(sx0, K.y + 10 - up);
    c.lineTo(sx0, shTop + sw / 2 - up);
    c.arc(px, shTop + sw / 2 - up, sw / 2, Math.PI, 0);
    c.lineTo(sx0 + sw, K.y + 10 - (t < this.tClick ? 0 : 0));
    c.stroke();
    c.strokeStyle = rgba('bone', 0.22);
    c.lineWidth = 4;
    c.stroke();
    // 鎖身：銅色、上亮下暗，圓角；陰影
    c.fillStyle = rgba('ink', 0.55);
    c.beginPath(); c.roundRect(K.x + 12, K.y + 14, K.w, K.h, 34); c.fill();
    const g = c.createLinearGradient(0, K.y, 0, K.y + K.h);
    g.addColorStop(0, mixRgba('cream', 'fur', 0.45));
    g.addColorStop(1, mixRgba('fur', 'blood', 0.35));
    c.fillStyle = g;
    c.beginPath(); c.roundRect(K.x, K.y, K.w, K.h, 34); c.fill();
    c.strokeStyle = mixRgba('fur', 'ink', 0.45);
    c.lineWidth = 3;
    c.beginPath(); c.roundRect(K.x + 14, K.y + 14, K.w - 28, K.h - 28, 24); c.stroke();
    // 上緣刻著兩人的名字（小字）
    c.font = font(F.hei(500), 20);
    c.textAlign = 'center';
    c.fillStyle = mixRgba('blood', 'ink', 0.3, 0.8);
    c.fillText(`${COUPLE_ZH}`, px, K.y + 46);
    c.textAlign = 'left';
    // 鑰匙孔
    c.fillStyle = mixRgba('ink', 'blood', 0.2, 0.8);
    c.beginPath(); c.arc(px, K.y + K.h - 40, 9, 0, Math.PI * 2); c.fill();
    c.fillRect(px - 4, K.y + K.h - 40, 8, 20);
    // 刻字（深色的刻痕＋下緣一條亮邊）
    const chars = this.msg ? Math.max(0, (t - this.tw0) / this.per) : t >= this.tw0 ? Infinity : 0;
    const sigK = this.msg ? prog(t, this.twd + 0.1, this.twd + 0.5) : 1;
    const top = K.y + PAD.top, hh = K.h - PAD.top - PAD.bottom;
    const ny = top + Math.max(0, (hh - n.height) * 0.4);
    const nx = K.x + (K.w - n.width) / 2;
    if (chars > 0) {
      drawNote(c, n, nx + 1.2, ny + 1.6, { chars, color: mixRgba('cream', 'bone', 0.5, 0.55), sigColor: mixRgba('cream', 'bone', 0.5, 0.5), sigK });
      const head = drawNote(c, n, nx, ny, { chars, color: this.msg ? mixRgba('blood', 'ink', 0.55, 0.95) : mixRgba('blood', 'ink', 0.62, 0.92), sigColor: mixRgba('blood', 'ink', 0.4, 0.8), sigK });
      if (head && this.msg && t < this.twd + 0.1) {
        sparkHead(this.glow, head.x, head.y, t, 0.6);
        sparkParticles(this.glow, t, () => ({ x: head.x, y: head.y }), { rate: 60, life: 0.25, speed: 120, seed: 4 });
      }
    }
    c.restore();
    // 喀：扣上那一下鎖鉤底下炸一圈火花
    if (d >= 0 && d < 0.3) {
      const k = 1 - d / 0.3, e = LIN.ember;
      for (const ex of [sx0, sx0 + sw]) {
        for (let i = 0; i < 6; i++) {
          const ang = -Math.PI / 2 + (i - 2.5) * 0.5, r0 = 10 + 30 * (1 - k), r1 = r0 + 18 * k;
          this.glow.seg2(ex + Math.cos(ang) * r0, K.y + 6 + Math.sin(ang) * r0, ex + Math.cos(ang) * r1, K.y + 6 + Math.sin(ang) * r1, 2, [e[0] * 3 * k, e[1] * 2.6 * k, e[2] * 2 * k], k);
        }
      }
    }
    void bp;
  }

  /** 鑰匙：扣上後的下一拍從鎖那邊被丟出去，劃一道弧越過圍欄上緣、落進山谷（越飛越小），最高點在下一拍、閃一下光。 */
  private drawKey(t: number) {
    const au = this.ctx.audio;
    const bp = au.beatPeriod(t);
    const u = (t - this.tKey) / (bp * 2);
    if (u < 0 || u > 1) return;
    const K = this.lock;
    const x0 = K.x + K.w * 0.8, y0 = K.y + K.h * 0.6, x1 = 1560, y1 = 640;
    const x = lerp(x0, x1, u), y = lerp(y0, y1, u) - 4 * 520 * u * (1 - u);
    const sg = LIN.signal, e = LIN.ember;
    // 軌跡
    const n = 16;
    for (let i = 1; i <= n; i++) {
      const a = Math.max(0, u - 0.25 * (1 - i / n)), b2 = Math.max(0, u - 0.25 * (1 - (i - 1) / n));
      const p0 = { x: lerp(x0, x1, a), y: lerp(y0, y1, a) - 4 * 520 * a * (1 - a) }, p1 = { x: lerp(x0, x1, b2), y: lerp(y0, y1, b2) - 4 * 520 * b2 * (1 - b2) };
      this.glow.seg2(p0.x, p0.y, p1.x, p1.y, 1.5, [sg[0] * 2, sg[1] * 2, sg[2] * 2], 0.5 * (i / n));
    }
    const sc = 1 - 0.6 * u;
    this.glow.seg2(x - 10 * sc, y, x + 10 * sc, y, 4 * sc, [e[0] * 2.5, e[1] * 2.3, e[2] * 1.8], 0.9);
    const flash = Math.exp(-Math.abs(u - 0.5) * 12);
    if (flash > 0.05) this.glow.seg2(x, y, x + 0.01, y, 30 * flash, [e[0] * 3 * flash, e[1] * 3 * flash, e[2] * 3 * flash], 0.8);
  }
}
