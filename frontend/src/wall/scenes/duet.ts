// KTV 對唱（暗、music）：包廂裡，宣文和孟庭各拿一支麥克風，面向右上的電視唱歌；後面一排沙發上坐著芃芃和 QQ。
// 角色是 Codex 畫的紙偶（_puppet.ts），包廂、電視、燈、桌子、點歌單用程式畫。
//  - 電視上跑歌詞（跟唱），像真的 KTV：一行一個「男／女／合」的小標，**換人唱用不同顏色**（男：訊號色、女：更亮的 ember）；
//    下一行淡淡地預告在右下。歌詞一行換一個人唱（段落能量高的時候兩個人合唱）。
//  - 輪到誰唱誰就舉麥克風唱（sing），唱到拉長音的字（一個字 ≥ 0.7 秒）就飆高音（belt）；沒輪到的人拿著麥克風跟著拍子晃（listen）。
//    合唱的那一行換成兩個人搭肩一起唱的雙人圖，狗狗也轉過去一起「唱」（howl）。間奏／純音樂：兩人一小節輪流哼。
//  - **焦點是主打留言**：寫在左前景桌上立著的點歌單（夾板＋紙、手寫字、署名；標題「點歌單 No.042」），
//    標準 v2：字 40～60、點歌單最大 560 × 430，高度跟著留言。沒有留言時寫邀請。
//  - 燈：天花板的鏡面球把一顆一顆的光點灑在牆上慢慢轉，拍點上亮一下；兩道彩色的光在小節線上掃過。桌上的鈴鼓每拍抖一下。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, prog, ease } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, type LyricStyle } from './_motifs';
import { inkFor, inkLine, inkPoly, inkRect, inkEllipse, type Note } from './_couple';
import { loadPuppets, drawPick, puppetShadow, puppetLight, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet, writeNote } from './_c5';
import type { Line } from '../engine/lyrics';

export const spec: PlateSpecDecl = { group: 'couple', family: 'music', paper: false, energy: [0.35, 1], bars: [4, 8] };

const FLOOR = 985;
const SZ = 610;
const AL_X = 810, OM_X = 1080, CP_X = 945;
/** 電視（右上）。 */
const TV = { x: 1150, y: 92, w: 680, h: 384 };
/** 後面的沙發：椅背上緣、坐墊的高度。狗狗坐在上面。 */
const SOFA = { top: 640, seat: 800 };
/** 狗狗坐在後面的沙發上（離鏡頭遠一點，比站在前面的人小一點）。 */
const PP_X = 1320, QQ_X = 1510, DOG_S = 0.92;
/** 左前景的桌子（桌面的 y）與立在桌上的點歌單（最大範圍、內距）。 */
const TABLE_Y = 930;
const CLIP = { x: 118, w: 560, h: 430 };
const PAD = { x: 44, top: 84, bottom: 36 };
const POSES = [
  'xw_duet_sing', 'xw_duet_belt', 'xw_duet_listen', 'mt_duet_sing', 'mt_duet_belt', 'mt_duet_listen', 'cp_duet_chorus',
  'pp_howl', 'qq_howl', 'pp_sit', 'qq_sit',
];
type Part = '男' | '女' | '合';

/**
 * 包廂：暗的牆與一條條的壁板、鏡面球灑在牆上的光點（慢慢往右轉，拍點上亮一下）、兩道彩色的光束在小節線上掃過、
 * 電視的畫面（KTV 的背景影片：慢慢流動的色塊與光斑）。字與人另外疊上去。
 */
const ROOM = () => new FSPass(/* glsl */ `
  uniform float t;
  uniform float kick;
  uniform float sweep;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK + C_INK2 * 0.6 * smoothstep(${H}.0, 0.0, p.y);
    // 壁板：很淡的直線
    col += C_BONE * 0.006 * step(0.985, fract(p.x / 160.0)) * step(p.y, ${SOFA.top}.0);
    // 鏡面球的光點
    vec2 g = vec2(p.x / 46.0 + t * 0.35, p.y / 46.0);
    vec2 cell = floor(g);
    float h = hash12(cell);
    vec2 f = fract(g) - 0.5 + (vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5) * 0.5;
    float dot1 = step(0.72, h) * (1.0 - smoothstep(0.03, 0.09, length(f))) * step(p.y, ${SOFA.top + 60}.0);
    vec3 dc = mix(C_BONE, C_SIGNAL, step(0.86, h));
    col += dc * dot1 * (0.07 + 0.16 * kick);
    // 兩道光束：從天花板兩角往下掃，小節線上掃到另一邊
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      vec2 o = vec2(fk < 0.5 ? 280.0 : 1640.0, -40.0);
      float a = (fk < 0.5 ? 1.0 : -1.0) * (0.35 + 0.5 * sin(sweep * 3.14159 + fk * 1.7));
      vec2 d = p - o;
      float ang = atan(d.x, d.y);
      float beam = (1.0 - smoothstep(0.05, 0.13, abs(ang - a))) * smoothstep(1300.0, 200.0, length(d));
      col += (fk < 0.5 ? C_SIGNAL : C_EMBER) * beam * 0.05;
    }
    // 電視畫面
    vec2 q = (p - vec2(${TV.x}.0, ${TV.y}.0)) / vec2(${TV.w}.0, ${TV.h}.0);
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
      float n = snoise(q * vec2(2.2, 1.4) + vec2(t * 0.06, -t * 0.04)) * 0.5 + 0.5;
      vec3 tv = mix(C_INK2, mix(C_BLOOD, C_SIGNAL, 0.2), 0.12 + 0.16 * n);
      vec2 b = fract(q * vec2(5.0, 3.0) + vec2(t * 0.03, 0.0)) - 0.5;
      tv += C_BONE * 0.04 * (1.0 - smoothstep(0.1, 0.35, length(b))) * step(0.5, hash12(floor(q * vec2(5.0, 3.0) + vec2(t * 0.03, 0.0))));
      tv *= 0.5 + 0.35 * smoothstep(0.0, 0.5, q.y);
      col = tv;
    }
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, kick: { value: 0 }, sweep: { value: 0 } });

export default class Duet extends Scene {
  room = shared('duet.room', ROOM);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(256, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  alanKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  cpKeys: [number, string][] = [];
  /** 狗狗的姿勢時間軸（坐著／合唱時仰頭唱）。 */
  dogKeys: Record<'pp' | 'qq', [number, string][]> = { pp: [], qq: [] };
  note: Note | null = null;
  clip = { x: CLIP.x, y: TABLE_Y - CLIP.h, w: CLIP.w, h: CLIP.h };
  noteT0 = 0;
  lyricSize = 50;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客點歌單男女合♪間奏' + INVITE + (this.msg ? `No.${String(this.msg.n).padStart(3, '0')}` : 'No.'));
    this.track(await loadPuppets(POSES));
    // 姿勢時間軸：照歌詞一行一行排誰唱
    const A: [number, string][] = [[-1e9, 'xw_duet_listen']], O: [number, string][] = [[-1e9, 'mt_duet_listen']];
    const C: [number, string][] = [[-1e9, '']], D: [number, string][] = [[-1e9, 'sit']];
    const lines = lyrics.linesIn(s - 1, e + 1);
    if (lines.length) {
      for (const L of lines) {
        const part = this.partOf(L);
        const t0 = L.start - 0.12, t1 = L.end + 0.25;
        if (part === '合') {
          A.push([t0, ''], [t1, 'xw_duet_listen']);
          O.push([t0, ''], [t1, 'mt_duet_listen']);
          C.push([t0, 'cp_duet_chorus'], [t1, '']);
          D.push([t0, 'howl'], [t1, 'sit']);
          continue;
        }
        const K = part === '男' ? A : O, p = part === '男' ? 'xw' : 'mt';
        K.push([t0, `${p}_duet_sing`]);
        for (const w of L.words) if (w.end - w.start >= 0.7) K.push([w.start, `${p}_duet_belt`], [w.end, `${p}_duet_sing`]);
        K.push([t1, `${p}_duet_listen`]);
      }
    }
    // 沒有歌詞的小節（純音樂、間奏、前奏）：兩個人一小節輪流哼，不要一起乾站著
    for (let bar = Math.floor(au.barAt(s)), k = 0; k < 40; k++, bar++) {
      const t0 = au.timeOfBar(bar), t1 = au.timeOfBar(bar + 1);
      if (t0 > e) break;
      if (lyrics.linesIn(t0 - 0.3, t1 + 0.3).length) continue;
      const K = k % 2 ? O : A, p = k % 2 ? 'mt' : 'xw';
      K.push([Math.max(t0, s), `${p}_duet_sing`], [t1 - 0.05, `${p}_duet_listen`]);
    }
    // 時間軸照時間排（歌詞的行不會重疊，保險起見再排一次）
    for (const K of [A, O, C, D]) K.sort((a, b) => a[0] - b[0]);
    this.alanKeys = A; this.omKeys = O; this.cpKeys = C;
    for (const who of ['pp', 'qq'] as const) this.dogKeys[who] = D.map(([tt, n]) => [tt, `${who}_${n}`]);
    // 點歌單上的留言：標準 v2 的字級；夾板的寬高跟著留言（底邊立在桌上）
    const c = this.fg.ctx;
    const w = CLIP.w - PAD.x * 2, hmax = CLIP.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const cw = Math.min(CLIP.w, tightenNote(c, this.note, 360) + PAD.x * 2);
    const ch = Math.min(CLIP.h, Math.max(250, PAD.top + this.note.height + PAD.bottom + 10));
    this.clip = { x: CLIP.x, y: TABLE_Y - 12 - ch, w: cw, h: ch };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = Math.min(au.timeOfBeat(Math.ceil(au.beatAt(s + 0.4))), s + 0.9);
    this.drawBackground();
  }

  /** 這一行誰唱：男、女、男、合輪流（每四行合唱一次）；段落能量高（副歌）也兩個人合唱。 */
  private partOf(L: Line): Part {
    if (L.i % 4 === 3 || this.ctx.audio.energyAt((L.start + L.end) / 2) > 0.72) return '合';
    return L.i % 2 ? '女' : '男';
  }

  /** 電視的外框、沙發、左前景的桌子與立著的點歌單（夾板＋紙、標題）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 電視外框（黑的邊，下面一小條喇叭）
    c.strokeStyle = rgba('ink', 1);
    c.lineWidth = 16;
    c.strokeRect(TV.x - 8, TV.y - 8, TV.w + 16, TV.h + 16);
    c.strokeStyle = rgba('bone', 0.1);
    c.lineWidth = 1.5;
    c.strokeRect(TV.x - 16, TV.y - 16, TV.w + 32, TV.h + 32);
    // 沙發：一整排長沙發（椅背、坐墊、扶手），暗色絨布，上緣一條反光
    const sofa = mixRgba('ink2', 'blood', 0.18);
    c.fillStyle = sofa;
    c.beginPath(); c.moveTo(560, H); c.lineTo(560, SOFA.top + 30); c.quadraticCurveTo(560, SOFA.top, 600, SOFA.top); c.lineTo(W + 20, SOFA.top); c.lineTo(W + 20, H); c.closePath(); c.fill();
    c.fillStyle = mixRgba('ink2', 'blood', 0.26);
    c.fillRect(560, SOFA.seat, W - 540, 60);
    c.strokeStyle = rgba('bone', 0.1);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(600, SOFA.top + 2); c.lineTo(W, SOFA.top + 2); c.moveTo(560, SOFA.seat); c.lineTo(W, SOFA.seat); c.stroke();
    c.strokeStyle = rgba('ink', 0.5);
    c.beginPath();
    for (let x = 820; x < W; x += 260) { c.moveTo(x, SOFA.top + 20); c.lineTo(x, SOFA.seat - 6); }
    c.stroke();
    c.fillStyle = mixRgba('ink', 'ink2', 0.5);
    c.fillRect(0, SOFA.seat + 60, W, H - SOFA.seat - 60);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    this.room.u.t!.value = t;
    this.room.u.kick!.value = beatKick(au, t, 0.3);
    // 光束在小節線上掃到另一邊（掃的那一下在小節線附近）
    const bar = au.barAt(t);
    this.room.u.sweep!.value = Math.floor(bar) + ease.inOutCubic(clamp((bar - Math.floor(bar)) * 4));
    this.room.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 狗（沙發上）→ 兩個人（最先畫：打光只染紙偶）
    this.drawDogs(c, t);
    this.drawSingers(c, t);
    puppetLight(c, [500, SOFA.top - 360, 1420, FLOOR - SOFA.top + 400], rgba('ink', 0.1), rgba('ink', 0.55));

    // ---- 前景：桌子、鈴鼓、飲料、點歌單
    this.drawTable(c, t);
    this.drawClip(c, t);
    // ---- 電視上的歌詞
    this.drawTV(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.6, vignette: 0.5, zoom: 1 + 0.03 * push, shake: [-(CP_X - W / 2) * 0.03 * push, 0] };
  }

  /** 兩個人：姿勢照歌詞排的時間軸；每拍跟著晃、點頭；飆高音時往上一拉。合唱時換成雙人圖。 */
  private drawSingers(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const nod = beatKick(au, t, 0.28);
    const sway = (ph: number) => 0.025 * Math.sin((au.beatAt(t) + ph) * Math.PI);
    const one = (x: number, keys: [number, string][], who: 'xw' | 'mt', delay: number, seed: number) => {
      const en = enterPuppet(this.glow, t, this.ctx.start + delay, x, FLOOR - 6, seed);
      if (!en) return;
      let k = 0;
      for (let i = 0; i < keys.length; i++) if (t >= keys[i]![0]) k = i;
      const name = keys[k]![1];
      const belt = name.endsWith('_belt');
      const o: PuppetOpts = { h: SZ, rot: belt ? -0.03 : sway(who === 'xw' ? 0 : 0.5), pivot: 0.1, squash: belt ? -0.02 : 0.014 * nod + breathe(t, 0.008, 3.2, seed), spin: en.spin, alpha: en.alpha };
      if (name) puppetShadow(c, who, x, FLOOR, { h: SZ, alpha: 0.6 * en.alpha, color: '0,0,0' });
      drawPick(c, keys, t, x, FLOOR, o);
    };
    one(AL_X, this.alanKeys, 'xw', 0.05, 1);
    one(OM_X, this.omKeys, 'mt', 0.15, 2);
    // 合唱：雙人圖（兩人搭肩一起唱），每拍一起晃
    let k = 0;
    for (let i = 0; i < this.cpKeys.length; i++) if (t >= this.cpKeys[i]![0]) k = i;
    if (this.cpKeys[k]![1] || (k > 0 && t - this.cpKeys[k]![0] < 0.04)) {
      puppetShadow(c, 'cp', CP_X, FLOOR, { h: SZ, alpha: 0.6, color: '0,0,0' });
      drawPick(c, this.cpKeys, t, CP_X, FLOOR, { h: SZ, rot: sway(0.25), pivot: 0.1, squash: 0.014 * nod });
    }
  }

  /** 沙發上的芃芃與 QQ：平常坐著（每拍點頭）；合唱時轉過去仰頭一起「唱」。 */
  private drawDogs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const keys = this.dogKeys.pp;
    let k = 0;
    for (let i = 0; i < keys.length; i++) if (t >= keys[i]![0]) k = i;
    const howl = keys[k]![1].endsWith('howl');
    const nod = beatKick(au, t, 0.3);
    for (const [who, x, d] of [['pp', PP_X, 0.3], ['qq', QQ_X, 0.36]] as const) {
      const en = enterPuppet(this.glow, t, this.ctx.start + d, x, SOFA.seat - 4, who === 'pp' ? 3 : 4);
      if (!en) continue;
      puppetShadow(c, who, x, SOFA.seat + 4, { h: SZ * DOG_S, alpha: 0.5 * en.alpha, color: '0,0,0' });
      drawPick(c, this.dogKeys[who], t, x, SOFA.seat + 4, { h: SZ, scale: DOG_S, rot: howl ? -0.05 : 0.05 * Math.sin(au.beatAt(t) * Math.PI + (who === 'pp' ? 0 : 1)), pivot: 0.3, squash: howl ? -0.02 : 0.04 * nod, spin: en.spin, alpha: en.alpha });
    }
  }

  /** 左前景的矮桌：桌面、兩杯有吸管的飲料、一個鈴鼓（每拍抖一下）。 */
  private drawTable(c: CanvasRenderingContext2D, t: number) {
    const ink = inkFor(false, { fill: rgba('ink2') });
    const top = TABLE_Y;
    c.fillStyle = mixRgba('ink2', 'bone', 0.06);
    c.beginPath(); c.moveTo(-20, top); c.lineTo(740, top); c.lineTo(770, top + 40); c.lineTo(-20, top + 40); c.closePath(); c.fill();
    c.fillStyle = rgba('ink2');
    c.fillRect(-20, top + 40, 790, H - top - 40);
    c.strokeStyle = rgba('bone', 0.14);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(-20, top); c.lineTo(740, top); c.stroke();
    // 飲料：兩個玻璃杯＋吸管（訊號色的飲料很淡）
    for (const [x, sd] of [[640, 1], [700, 2]] as const) {
      inkPoly(c, [{ x: x - 20, y: top - 70 }, { x: x + 20, y: top - 70 }, { x: x + 16, y: top + 6 }, { x: x - 16, y: top + 6 }], { ink, fill: mixRgba('ink2', 'signal', 0.18), w: 0.6, seed: sd, t, color: rgba('bone', 0.4) });
      inkLine(c, [{ x: x + 4, y: top - 50 }, { x: x + 12, y: top - 104 }], { ink, w: 0.8, seed: sd + 5, color: rgba('bone', 0.5) });
    }
    // 鈴鼓（每拍抖一下）
    const k = beatKick(this.ctx.audio, t, 0.2);
    c.save();
    c.translate(560, top + 16);
    c.rotate(0.12 * k * (Math.floor(this.ctx.audio.beatAt(t)) % 2 ? 1 : -1));
    inkEllipse(c, 0, 0, 52, 14, 0, { ink, fill: mixRgba('ink2', 'fur', 0.35), w: 0.7, seed: 9, color: rgba('bone', 0.4) });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; inkRect(c, Math.cos(a) * 46 - 5, Math.sin(a) * 12 - 3, 10, 6, { ink, fill: mixRgba('bone', 'signal', 0.3), w: 0.4, seed: 10 + i, color: rgba('bone', 0.5) }); }
    c.restore();
  }

  /** 立在桌上的點歌單：夾板（木色）＋紙＋夾子；標題「點歌單 No.042」（小、淡）；留言逐字寫上去。 */
  private drawClip(c: CanvasRenderingContext2D, t: number) {
    const K = this.clip;
    const ink = inkFor(false, { fill: rgba('ink2') });
    const board = mixRgba('ink2', 'fur', 0.45), paper = mixRgba('bone', 'ash', 0.16);
    c.save();
    // 夾板往後靠：影子在後面的沙發下
    c.fillStyle = rgba('ink', 0.5);
    c.fillRect(K.x + 14, K.y + 12, K.w, K.h);
    inkRect(c, K.x - 12, K.y - 14, K.w + 24, K.h + 26, { ink, fill: board, w: 0.8, seed: 21, r: 10, color: rgba('bone', 0.35) });
    inkPoly(c, [{ x: K.x, y: K.y + 6 }, { x: K.x + K.w, y: K.y + 4 }, { x: K.x + K.w - 2, y: K.y + K.h }, { x: K.x + 2, y: K.y + K.h - 2 }], { ink, fill: paper, w: 0.6, seed: 22, color: rgba('ink', 0.6) });
    // 夾子
    inkRect(c, K.x + K.w / 2 - 60, K.y - 24, 120, 30, { ink, fill: mixRgba('ash', 'bone', 0.3), w: 0.7, seed: 23, r: 6, color: rgba('ink', 0.6) });
    // 標題與淡淡的表格線
    c.font = font(F.hei(700), 20);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('ink', 0.62);
    c.fillText('點歌單', K.x + PAD.x, K.y + 50);
    c.letterSpacing = '0px';
    c.font = font(F.mono(500), 17);
    c.textAlign = 'right';
    c.fillStyle = rgba('ink', 0.45);
    c.fillText(this.msg ? `No.${String(this.msg.n).padStart(3, '0')}` : 'No.', K.x + K.w - PAD.x, K.y + 50);
    c.textAlign = 'left';
    c.strokeStyle = rgba('ink', 0.14);
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(K.x + PAD.x, K.y + 64); c.lineTo(K.x + K.w - PAD.x, K.y + 64); c.stroke();
    c.restore();
    const n = this.note;
    if (!n) return;
    const top = K.y + PAD.top, h = K.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.55);
    writeNote(c, n, K.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), t, this.noteT0, { msg: !!this.msg, color: rgba('ink', 0.92), faint: rgba('ink', 0.6), sig: rgba('ink', 0.72) });
    c.restore();
  }

  /** 電視上的歌詞：這一行（左邊一個男／女／合的小標、跟唱），下一行淡淡地預告在右下；間奏寫「♪ 間奏 ♪」。 */
  private drawTV(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t);
    c.save();
    c.beginPath(); c.rect(TV.x, TV.y, TV.w, TV.h); c.clip();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    const x0 = TV.x + 48, maxW = TV.w - 96 - 50;
    if (ly) {
      const part = this.partOf(ly.line);
      const col = part === '女' ? rgba('ember') : rgba('signal');
      const st: LyricStyle = { family: F.hei(700), size: this.lyricSize, minSize: 40, maxWidth: maxW, unsung: rgba('bone', 0.4), sung: rgba('bone', 0.95), active: col };
      const lay = layoutLyric(c, ly.line, st);
      const by = TV.y + TV.h * 0.56;
      // 小標：男／女／合
      c.save();
      c.globalAlpha *= ly.k;
      c.fillStyle = col;
      c.beginPath(); c.roundRect(x0, by - lay.size * 0.78, 38, 38, 6); c.fill();
      c.font = font(F.hei(700), 24);
      c.fillStyle = rgba('ink');
      c.textAlign = 'center';
      c.fillText(part, x0 + 19, by - lay.size * 0.78 + 28);
      c.restore();
      c.save();
      c.translate(x0 + 54, by);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
      // 下一行：右下、淡淡的（還沒唱）
      const nx = lyrics.nextLine(Math.max(t, ly.line.start + 0.01));
      if (nx && nx.start - t < 6) {
        const st2: LyricStyle = { family: F.hei(700), size: 36, minSize: 30, maxWidth: TV.w - 96, align: 'right', unsung: rgba('bone', 0.18), sung: rgba('bone', 0.18), active: rgba('bone', 0.18) };
        const lay2 = layoutLyric(c, nx, st2);
        c.save();
        c.translate(TV.x + TV.w - 48, by + lay.height + 40 + (lay2.height - lay2.size));
        drawLyric(c, nx, t, st2, lay2, prog(t, nx.start - 6, nx.start - 5));
        c.restore();
      }
    } else {
      c.font = font(F.hei(700), 44);
      c.fillStyle = rgba('bone', 0.45);
      c.textAlign = 'center';
      c.fillText('♪ 間奏 ♪', TV.x + TV.w / 2, TV.y + TV.h * 0.56);
    }
    c.restore();
  }
}
