// 搭地鐵（亮、trip、雙語、日常服一）：白天的地鐵車廂，宣文和孟庭並肩坐在長椅上，孟庭靠在宣文肩上，跟著車廂照拍子輕輕搖。
// 角色是 Codex 畫的紙偶（cp_gondola_1、_2：兩人並肩坐著，_puppet.ts），車廂、窗外、螢幕、字是程式畫的。
//  - **兩行歌詞在車門上方的到站顯示器**：深色的寬螢幕，左上角一個小小的「下一站 NEXT」，中間中文大字、正下方原文小一號，
//    各自照逐字時間亮；換句時新的一句從右邊滑進來（像到站資訊換頁）。螢幕下緣一條路線圖，列車記號一拍走一格、小節線到下一站（站點亮起）。
//    沒有翻譯的歌只有中文一行，垂直置中，不留空的原文列。
//  - 每一句歌詞開始（對到拍點，最多兩小節一次）孟庭坐直、指著螢幕（cp_gondola_2），一拍半後靠回宣文肩上。
//  - **主打留言在左邊車廂牆上的廣告框**（鋁框、白底的海報、一個小小的「乘客留言」），手寫字，照「留言尺寸與版面比例標準 v2」：
//    字 40～60、署名 26～32、框 ≤ 640 × 430，第一拍起一個字一個字出現。沒有留言時廣告框是邀請（字小、淡）。
//  - 右邊是一扇淺色的車門（門上一扇窗），右下角 HUD 的深色字壓在淺色的門和地板上。
//  - 動畫：窗外的城市往後捲（遠的大樓慢、近的快），每一拍一根電線桿「唰」地掠過窗子；吊環跟著車廂的晃動擺；
//    大鼓時車廂輕輕一頓（整個畫面晃一下）。鏡頭整個窗格慢慢推近兩個人。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, beatAfter, barAfter, msgChars, WEDDING_DATE, type LyricStyle } from './_motifs';
import { paperBG, drawNote, type Note } from './_couple';
import { loadPuppets, drawPick, puppetShadow, puppetIn, breathe, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';
import { drawBilingualIn } from './_d1';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'trip', paper: true, energy: [0.2, 0.9], bars: [4, 8] };

/** 兩人坐的位置（腳底錨點）與場景尺度（坐姿那張圖的高度）。 */
const CX = 1050, FEET = 1032, SZ = 640;
/** 長椅座面（坐姿圖的屁股約在身高的 46%）。 */
const SEAT = FEET - SZ * 0.46;
/** 窗戶（一整排）：左、上、右、下；吊環的橫桿。 */
const WIN = { x0: 790, y0: 392, x1: 1900, y1: 600 };
const RAIL_Y = 372;
/** 右邊是一扇淺色的車門（長椅到這裡為止）：右下角 HUD 的深色字壓在淺色的門和地板上才清楚。門上有一扇窗。 */
const DOOR = { x0: 1352, win: { x0: 1440, x1: 1830, y0: 392, y1: 560 } };
/** 到站顯示器（歌詞）。 */
const LCD = { x: 890, y: 76, w: 930, h: 272 };
/** 左邊牆上的廣告框（留言）：最大的範圍與內距。 */
const AD = { x: 104, y: 150, w: 600, h: 430 };
const PAD = { x: 40, top: 64, bottom: 34 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['cp_gondola_1', 'cp_gondola_2'];
/** 間奏、純音樂時螢幕上的站名（空著的螢幕很怪）：中文一行、英文小一行，跟歌詞同一個版式。 */
const STOP_ZH = '我們的婚禮', STOP_EN = `Our Wedding · ${String(WEDDING_DATE).split('-').join('.')}`;
/** 窗外的街景是一條預先畫好的長圖，重複捲動。 */
const STRIP_W = 2400;

export default class Subwayride extends Scene {
  paper = paperBG();
  /** 窗外（每格重畫：兩層街景捲動＋電線桿）。 */
  outside = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  /** 車廂（牆、窗框、長椅、扶手、廣告框、螢幕外框）：畫一次，窗戶挖空。 */
  cabin = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  ad = { ...AD };
  keys: [number, string][] = [];
  far: HTMLCanvasElement | null = null;
  near: HTMLCanvasElement | null = null;
  lyricSize = 50;
  msgT0 = 0;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客乘客留言下一站NEXT' + INVITE + STOP_ZH + STOP_EN);
    this.track(await loadPuppets(SPRITES));
    const bp = au.beatPeriod(s);
    // 孟庭指螢幕：每句歌詞開始（對到拍點），兩次之間至少兩小節；純音樂時每四小節一次
    const points: number[] = [];
    if (lyrics.has) for (const ln of lyrics.linesIn(s + 0.5, e - bp * 2)) points.push(au.timeOfBeat(Math.round(au.beatAt(ln.start))));
    else for (let t = barAfter(au, s + 0.5); t < e - bp * 2; t = au.timeOfBar(Math.round(au.barAt(t)) + 4)) points.push(t);
    const ks: [number, string][] = [[-1e9, 'cp_gondola_1']];
    let last = -1e9;
    for (const p of points) {
      if (p - last < bp * 8) continue;
      ks.push([p, 'cp_gondola_2'], [p + bp * 1.5, 'cp_gondola_1']);
      last = p;
    }
    this.keys = ks;
    // 廣告框裡的留言：標準 v2；框的高度跟著留言（上緣固定）
    const c = this.fg.ctx;
    const tw = AD.w - PAD.x * 2, th = AD.h - PAD.top - PAD.bottom;
    // 廣告框是印出來的海報：思源宋體粗體、深墨（手寫體的粗體還是太細，留言要比顯示器上的歌詞還搶眼）
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th, { family: F.ming(700) }) : noteV2(c, INVITE, null, tw, th * 0.5, { max: 40, family: F.ming(700) });
    tightenNote(c, this.note, 260);
    this.ad.h = Math.min(AD.h, Math.max(230, PAD.top + this.note.height + PAD.bottom + 12));
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.4);
    this.makeStrips();
    this.drawCabin();
  }

  /** 窗外的兩層街景（遠：淡淡的高樓；近：比較深的矮房子、樹），各畫一條長圖，捲動時重複。 */
  private makeStrips() {
    const mk = (seed: number, near: boolean) => {
      const cv = document.createElement('canvas');
      cv.width = STRIP_W; cv.height = 300;
      const c = cv.getContext('2d')!;
      let x = 0;
      for (let i = 0; x < STRIP_W; i++) {
        const w = near ? 90 + 140 * hash(i, seed, 1) : 60 + 120 * hash(i, seed, 1);
        const h = near ? 40 + 80 * hash(i, seed, 2) : 60 + 90 * hash(i, seed, 2);
        if (near && hash(i, seed, 3) < 0.3) {
          // 行道樹：一團圓圓的樹冠
          c.fillStyle = mixRgba('gingham', 'paper', 0.35);
          c.beginPath(); c.arc(x + w / 2, 300 - 70, 50 + 20 * hash(i, seed, 4), 0, Math.PI * 2); c.fill();
          c.fillStyle = mixRgba('sepia', 'paper', 0.5);
          c.fillRect(x + w / 2 - 4, 300 - 40, 8, 40);
        } else {
          c.fillStyle = near ? mixRgba('ash', 'sepia', 0.15 + 0.2 * hash(i, seed, 5)) : mixRgba('shirtblue', 'paper', 0.25 + 0.25 * hash(i, seed, 5));
          c.fillRect(x, 300 - h, w - 6, h);
          // 窗戶的格子（很淡）
          c.fillStyle = rgba('paper', near ? 0.35 : 0.25);
          for (let yy = 300 - h + 14; yy < 290; yy += 22) for (let xx = x + 10; xx < x + w - 16; xx += 18) c.fillRect(xx, yy, 8, 10);
        }
        x += w;
      }
      return cv;
    };
    this.far = mk(3, false);
    this.near = mk(7, true);
  }

  /** 車廂：淺色的牆與天花板（日光燈條）、一整排窗（挖空）、窗下的藍色長椅、不鏽鋼扶手桿、左邊牆上的廣告框、螢幕的外框。 */
  private drawCabin() {
    const L = this.cabin, c = L.ctx;
    L.clear();
    // 牆
    const wall = c.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, mixRgba('paper', 'bone', 0.4));
    wall.addColorStop(1, mixRgba('paper', 'ash', 0.25));
    c.fillStyle = wall;
    c.fillRect(0, 0, W, H);
    // 天花板的燈條
    c.fillStyle = mixRgba('bone', 'paper', 0.2);
    c.fillRect(0, 0, W, 34);
    c.fillStyle = rgba('bone', 0.9);
    c.fillRect(0, 34, W, 10);
    c.fillStyle = rgba('sepia', 0.08);
    c.fillRect(0, 44, W, 3);
    // 窗戶：挖空（窗外那一層會從後面透出來），圓角的窗框
    const win = new Path2D();
    const n = 2, gap = 26, ww = (DOOR.x0 - 40 - WIN.x0 - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) win.roundRect(WIN.x0 + i * (ww + gap), WIN.y0, ww, WIN.y1 - WIN.y0, 18);

    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    c.fill(win);
    c.restore();
    c.strokeStyle = mixRgba('ash', 'paper', 0.2);
    c.lineWidth = 8;
    c.stroke(win);
    c.strokeStyle = rgba('sepia', 0.25);
    c.lineWidth = 1.5;
    c.stroke(win);
    // 長椅：靠背、座墊（藍色）、下面的踢腳板
    const bx0 = 760, bx1 = DOOR.x0 - 30, back = SEAT - SZ * 0.32;
    c.fillStyle = mixRgba('shirtblue', 'sepia', 0.18);
    c.beginPath(); c.roundRect(bx0, back, bx1 - bx0, SEAT - back + 14, 20); c.fill();
    c.fillStyle = mixRgba('shirtblue', 'sepia', 0.3);
    c.beginPath(); c.roundRect(bx0 - 10, SEAT - 16, bx1 - bx0 + 20, 46, 14); c.fill();
    c.strokeStyle = rgba('paper', 0.35);
    c.lineWidth = 2;
    c.beginPath(); for (let x = bx0 + 170; x < bx1 - 40; x += 170) { c.moveTo(x, back + 16); c.lineTo(x, SEAT - 22); } c.stroke();
    c.fillStyle = mixRgba('ash', 'sepia', 0.35);
    c.fillRect(bx0, SEAT + 30, bx1 - bx0, FEET - SEAT - 20);
    // 地板（淺灰，HUD 的字壓在上面也清楚）
    c.fillStyle = mixRgba('ash', 'paper', 0.45);
    c.fillRect(0, FEET + 4, W, H - FEET);
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(0, FEET + 4, W, 3);
    // 車門：淺色的門板（到地板）、左緣一條橡膠封條、門檻一條金屬（都很淡，右下角保持乾淨）
    c.fillStyle = mixRgba('bone', 'paper', 0.35);
    c.fillRect(DOOR.x0, 50, W - DOOR.x0, FEET + 4 - 50);
    c.fillStyle = rgba('sepia', 0.18);
    c.fillRect(DOOR.x0, 50, 5, FEET - 46);
    c.fillStyle = mixRgba('bone', 'ash', 0.25);
    c.fillRect(DOOR.x0, FEET + 4, W - DOOR.x0, 12);
    // 門上的窗（挖空，窗外從後面透出來）與一根直的扶手（門中間，停在 HUD 上面）
    const dw = DOOR.win, dwin = new Path2D();
    dwin.roundRect(dw.x0, dw.y0, dw.x1 - dw.x0, dw.y1 - dw.y0, 26);
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    c.fill(dwin);
    c.restore();
    c.strokeStyle = mixRgba('ash', 'paper', 0.2);
    c.lineWidth = 8;
    c.stroke(dwin);
    c.strokeStyle = rgba('sepia', 0.25);
    c.lineWidth = 1.5;
    c.stroke(dwin);
    c.fillStyle = mixRgba('bone', 'ash', 0.3);
    c.beginPath(); c.roundRect(dw.x0 - 46, dw.y1 + 40, 12, 150, 6); c.fill();
    // 不鏽鋼扶手：窗上的橫桿、左邊一根直桿
    c.fillStyle = mixRgba('bone', 'ash', 0.35);
    c.fillRect(WIN.x0 - 30, RAIL_Y - 5, DOOR.x0 - WIN.x0, 10);
    c.fillRect(742, 44, 14, FEET - 40);
    c.fillStyle = rgba('bone', 0.8);
    c.fillRect(745, 44, 4, FEET - 40);
    // 廣告框：鋁框、白底海報（高度跟著留言）、上面一個小標籤
    const A = this.ad;
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(A.x + 8, A.y + 10, A.w, A.h);
    c.fillStyle = mixRgba('bone', 'ash', 0.3);
    c.fillRect(A.x - 12, A.y - 12, A.w + 24, A.h + 24);
    c.fillStyle = mixRgba('bone', 'paper', 0.2);
    c.fillRect(A.x, A.y, A.w, A.h);
    c.strokeStyle = rgba('sepia', 0.3);
    c.lineWidth = 1.5;
    c.strokeRect(A.x - 12, A.y - 12, A.w + 24, A.h + 24);
    c.fillStyle = rgba('signal', 0.85);
    c.fillRect(A.x + PAD.x, A.y + 30, 6, 20);
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('sepia', 0.55);
    c.fillText('乘客留言', A.x + PAD.x + 16, A.y + 47);
    c.letterSpacing = '0px';
    // 顯示器的外框（螢幕本身每格畫）
    c.fillStyle = mixRgba('ash', 'sepia', 0.4);
    c.beginPath(); c.roundRect(LCD.x - 14, LCD.y - 14, LCD.w + 28, LCD.h + 28, 18); c.fill();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    this.drawOutside(t);
    comp.draw(renderer, this.outside.upload(), out);
    comp.draw(renderer, this.cabin.texture, out);

    const L = this.fg; L.clear();
    const c = L.ctx;
    // 車廂的晃動：每小節左右擺一次、大鼓時頓一下
    const swayA = Math.sin(au.barAt(t) * Math.PI * 2);
    const kick = beatKick(au, t, 0.18);
    this.drawStraps(c, t, swayA);
    this.drawSuitcase(c, t, kick);
    // 兩個人
    const en = puppetIn(t, s + 0.05, 0.5);
    if (en.alpha > 0) {
      puppetShadow(c, 'cp', CX, FEET, { h: SZ, wide: 1.1, alpha: 0.25 * en.alpha, color: '70,45,25' });
      drawPick(c, this.keys, t, CX, FEET - 2 * kick, { h: SZ, spin: en.spin, alpha: en.alpha, rot: 0.01 * swayA, pivot: 0.2, squash: breathe(t, 0.006, 3.2) + 0.012 * kick });
    }
    this.drawLCD(c, t);
    this.drawAd(c, t);
    comp.draw(renderer, L.upload(), out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.25, bloomThreshold: 1.5, halation: 0.03, vignette: 0.24, grain: 0.045, zoom: 1 + 0.03 * push, shake: [-(CX - W / 2) * 0.03 * push + 3 * swayA, -(560 - H / 2) * 0.03 * push + 2.5 * kick] };
  }

  /** 窗外：天空、遠的大樓（慢）、近的房子與樹（快）重複捲動；每一拍一根電線桿很快地掠過。 */
  private drawOutside(t: number) {
    const L = this.outside, c = L.ctx, au = this.ctx.audio;
    L.clear();
    const sky = c.createLinearGradient(0, WIN.y0, 0, WIN.y1);
    sky.addColorStop(0, mixRgba('shirtblue', 'bone', 0.55));
    sky.addColorStop(1, mixRgba('paper', 'bone', 0.5));
    c.fillStyle = sky;
    c.fillRect(WIN.x0 - 20, WIN.y0 - 10, WIN.x1 - WIN.x0 + 40, WIN.y1 - WIN.y0 + 20);
    const strip = (cv: HTMLCanvasElement | null, speed: number, y: number) => {
      if (!cv) return;
      const off = ((t * speed) % STRIP_W + STRIP_W) % STRIP_W;
      for (let x = WIN.x0 - off - 20; x < WIN.x1; x += STRIP_W) c.drawImage(cv, x, y);
    };
    // 窗子下半被椅背擋住：大樓的底要在椅背上緣附近，才看得到屋頂和天空
    strip(this.far, 70, 525 - 300);
    strip(this.near, 320, 548 - 300);
    // 電線桿：拍點上從右邊掠過到左邊（0.28 秒）
    const b = Math.floor(au.beatAt(t));
    for (const k of [b, b - 1]) {
      const u = (t - au.timeOfBeat(k)) / 0.28;
      if (u < 0 || u > 1) continue;
      const x = WIN.x1 + 60 - u * (WIN.x1 - WIN.x0 + 200);
      c.fillStyle = mixRgba('sepia', 'ash', 0.4, 0.85);
      c.fillRect(x, WIN.y0 - 20, 22, WIN.y1 - WIN.y0 + 40);
      c.fillRect(x - 60, WIN.y0 + 30, 140, 8);
    }
  }

  /** 行李箱（旅行中）：立在宣文腳邊，大鼓時跟著車廂輕輕一跳；貼著幾張旅行貼紙（沒有字的色塊）。 */
  private drawSuitcase(c: CanvasRenderingContext2D, t: number, kick: number) {
    const x = 560, w = 170, h = 250, y = FEET - h - 26 - 3 * kick;
    const rot = 0.012 * Math.sin(t * 2.3) - 0.01 * kick;
    c.save();
    c.translate(x + w / 2, FEET);
    c.rotate(rot);
    c.translate(-(x + w / 2), -FEET);
    // 影子
    c.fillStyle = rgba('sepia', 0.14);
    c.beginPath(); c.ellipse(x + w / 2, FEET + 2, w * 0.6, 10, 0, 0, Math.PI * 2); c.fill();
    // 拉桿
    c.fillStyle = mixRgba('ash', 'sepia', 0.4);
    c.fillRect(x + w * 0.3, y - 120, 8, 124); c.fillRect(x + w * 0.7 - 8, y - 120, 8, 124);
    c.fillRect(x + w * 0.3, y - 126, w * 0.4, 12);
    // 箱身：圓角、兩條直的肋
    c.fillStyle = mixRgba('collar', 'paper', 0.5);
    c.beginPath(); c.roundRect(x, y, w, h, 18); c.fill();
    c.strokeStyle = rgba('sepia', 0.35);
    c.lineWidth = 1.5;
    c.stroke();
    c.strokeStyle = rgba('sepia', 0.12);
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(x + w * 0.33, y + 14); c.lineTo(x + w * 0.33, y + h - 14); c.moveTo(x + w * 0.67, y + 14); c.lineTo(x + w * 0.67, y + h - 14); c.stroke();
    // 貼紙
    c.fillStyle = mixRgba('ball', 'paper', 0.3); c.beginPath(); c.arc(x + 48, y + 70, 22, 0, Math.PI * 2); c.fill();
    c.fillStyle = mixRgba('shirtblue', 'paper', 0.1); c.fillRect(x + 90, y + 120, 56, 38);
    c.fillStyle = rgba('rose', 0.8); c.beginPath(); c.arc(x + 60, y + 170, 12, 0, Math.PI * 2); c.fill();
    // 輪子
    c.fillStyle = rgba('sepia', 0.8);
    c.beginPath(); c.arc(x + 24, FEET - 12, 12, 0, Math.PI * 2); c.arc(x + w - 24, FEET - 12, 12, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  /** 吊環：橫桿上一排，跟著車廂的晃動一起擺（離鏡頭遠的在兩人後面，所以先畫）。 */
  private drawStraps(c: CanvasRenderingContext2D, t: number, swayA: number) {
    const ang = 0.14 * swayA + 0.05 * Math.sin(t * 2.1);
    for (let x = WIN.x0 + 50; x < DOOR.x0 - 60; x += 128) {
      c.save();
      c.translate(x, RAIL_Y);
      c.rotate(ang * (0.9 + 0.2 * hash(x, 1)));
      c.fillStyle = mixRgba('sepia', 'ash', 0.35);
      c.fillRect(-6, 0, 12, 70);
      c.strokeStyle = mixRgba('bone', 'ash', 0.15);
      c.lineWidth = 7;
      c.beginPath(); c.arc(0, 94, 22, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = rgba('sepia', 0.35);
      c.lineWidth = 1.2;
      c.beginPath(); c.arc(0, 94, 26, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
  }

  /**
   * 到站顯示器：深色螢幕，左上「下一站 NEXT」、中間雙語歌詞（中文大、原文小，各自逐字亮）、下緣路線圖。
   * 換句的時候新的一句從右邊滑進來。
   */
  private drawLCD(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, { lyrics } = this.ctx;
    const X = LCD.x, Y = LCD.y;
    c.save();
    const g = c.createLinearGradient(0, Y, 0, Y + LCD.h);
    g.addColorStop(0, mixRgba('ink', 'ink2', 0.3));
    g.addColorStop(1, rgba('ink2'));
    c.fillStyle = g;
    c.beginPath(); c.roundRect(X, Y, LCD.w, LCD.h, 8); c.fill();
    // 玻璃的反光：一道斜斜的淡光
    c.save();
    c.beginPath(); c.roundRect(X, Y, LCD.w, LCD.h, 8); c.clip();
    const sh = c.createLinearGradient(X, Y, X + LCD.w, Y + LCD.h);
    sh.addColorStop(0.2, rgba('bone', 0)); sh.addColorStop(0.35, rgba('bone', 0.06)); sh.addColorStop(0.5, rgba('bone', 0));
    c.fillStyle = sh;
    c.fillRect(X, Y, LCD.w, LCD.h);
    c.restore();
    // 左上的小標籤
    c.font = font(F.hei(500), 18);
    c.fillStyle = rgba('signal', 0.9);
    c.fillText('下一站', X + 30, Y + 38);
    c.font = font(F.mono(500), 16);
    c.fillStyle = rgba('ash', 0.7);
    c.fillText('NEXT', X + 96, Y + 37);
    // 歌詞
    const ly = lyricAt(lyrics, t);
    // 沒有歌詞的時候（間奏、純音樂）：螢幕上是站名，跟著前後的歌詞淡入淡出
    // 只在兩句之間的空檔（沒有歌詞的時候）才出現，前後各淡 0.3 秒，不跟淡出中的歌詞疊在一起
    const prev = lyrics.lastLine(t), next = lyrics.nextLine(t);
    const idle = ly ? 0 : (prev ? prog(t, prev.end + 1.2, prev.end + 1.5) : 1) * (next ? 1 - prog(t, next.start - 0.7, next.start - 0.4) : 1);
    if (idle > 0.01) {
      c.save();
      c.globalAlpha = idle * prog(t, this.ctx.start, this.ctx.start + 0.5);
      c.font = font(F.hei(700), 50);
      c.fillStyle = rgba('bone', 0.9);
      c.fillText(STOP_ZH, X + 30, Y + LCD.h / 2 + 6);
      c.font = font(F.hei(500), 30);
      c.fillStyle = rgba('bone', 0.55);
      c.fillText(STOP_EN, X + 30, Y + LCD.h / 2 + 50);
      c.restore();
    }
    if (ly) {
      const st: LyricStyle = { family: F.hei(700), size: this.lyricSize, minSize: 40, maxWidth: LCD.w - 60, align: 'left', unsung: rgba('bone', 0.28), sung: rgba('bone', 0.96), active: rgba('signal') };
      const kin = clamp((t - (ly.line.start - 0.35)) / 0.3);
      const dx = 40 * (1 - ease.outCubic(kin));
      c.save();
      c.beginPath(); c.rect(X + 10, Y + 50, LCD.w - 20, LCD.h - 96); c.clip();
      drawBilingualIn(c, ly.line, t, st, { x: X + 30, top: Y + 54, w: LCD.w - 60, h: LCD.h - 108 }, ly.k, dx);
      c.restore();
    }
    // 路線圖：八站，列車記號一拍走八分之一格、小節線到站
    const ry = Y + LCD.h - 26, rx0 = X + 40, rx1 = X + LCD.w - 40;
    const bar = au.barAt(t), stn = Math.floor(bar) % 8, frac = bar - Math.floor(bar);
    c.strokeStyle = rgba('ash', 0.35);
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(rx0, ry); c.lineTo(rx1, ry); c.stroke();
    for (let i = 0; i < 8; i++) {
      const x = rx0 + ((rx1 - rx0) * i) / 7;
      const passed = i <= stn;
      c.fillStyle = passed ? rgba('signal', 0.9) : rgba('ash', 0.5);
      c.beginPath(); c.arc(x, ry, passed ? 7 : 5, 0, Math.PI * 2); c.fill();
    }
    const tx = rx0 + ((rx1 - rx0) * (Math.min(7, stn + Math.floor(frac * 4) / 4))) / 7;
    c.fillStyle = rgba('bone');
    c.beginPath(); c.moveTo(tx + 12, ry); c.lineTo(tx - 6, ry - 9); c.lineTo(tx - 6, ry + 9); c.closePath(); c.fill();
    c.restore();
  }

  /** 廣告框裡的留言：第一拍起一個字一個字出現（深墨手寫），寫完署名淡入。 */
  private drawAd(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const A = this.ad;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.09);
    const done = this.msgT0 + total * per;
    const top = A.y + PAD.top, h = A.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    drawNote(c, n, A.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? Math.max(0, (t - this.msgT0) / per) : Infinity,
      color: this.msg ? rgba('ink', 0.92) : rgba('ink', 0.84), sigColor: rgba('ink', 0.78), sigK: this.msg ? prog(t, done + 0.1, done + 0.5) : 1,
    });
    c.restore();
  }
}
