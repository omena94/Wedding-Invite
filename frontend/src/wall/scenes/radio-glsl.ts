// 收音機的 shader：紙（纖維、邊緣暗一點）、喇叭網（織布，歌詞從布後面透出來，大鼓一打布就往外鼓一下）、
// 刻度窗的玻璃、調諧指示的「魔眼」（真空管收音機上那顆會開合的綠眼睛，這裡是訊號色）。
// v2：一道窗光很慢地掃過整張紙。
import { H } from '../engine/gl';

export const FRAG_RADIO = /* glsl */ `
uniform vec4 uGrille;      // 喇叭網範圍 x, y, w, h（px，y 往下）
uniform sampler2D uText;   // 布後面的歌詞（fast Layer2D：預乘、sRGB）
uniform vec4 uDial;        // 刻度窗（玻璃）
uniform vec4 uEye;         // 魔眼：x, y, 半徑, 對準程度 0..1
uniform float uLevel;      // 音量（魔眼的扇形跟著跳）
uniform float uPump;       // 喇叭推布（大鼓）
uniform float uT;
uniform float uIn;

vec3 paper(vec2 p) {
  vec3 c = C_PAPER;
  c *= 0.96 + 0.04 * fbm(p / vec2(900.0, 260.0), 3);
  c *= 1.0 - 0.025 * smoothstep(0.55, 1.0, snoise(p * vec2(0.012, 0.4)));  // 纖維
  vec2 uv = p / vec2(1920.0, 1080.0) - 0.5;
  c *= 1.0 - 0.18 * smoothstep(0.35, 0.9, length(uv * vec2(1.3, 1.0)));
  return c;
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 col = paper(p);

  // 刻度窗的玻璃：比紙亮一點點、上緣一道反光
  {
    vec2 c = uDial.xy + uDial.zw * 0.5;
    float d = sdBox(p - c, uDial.zw * 0.5 - 12.0) - 12.0;
    float m = 1.0 - smoothstep(-0.8, 0.8, d);
    float v = (p.y - uDial.y) / uDial.w;
    vec3 glass = mix(C_PAPER, C_BONE, 0.35) * (1.02 - 0.08 * v);
    glass += C_BONE * 0.08 * exp(-pow((v - 0.18) / 0.06, 2.0));
    col = mix(col, glass, m);
  }

  // 喇叭網：暗色的織布（經緯交錯），歌詞的光從布縫透出來
  {
    vec2 c = uGrille.xy + uGrille.zw * 0.5;
    float d = sdBox(p - c, uGrille.zw * 0.5 - 22.0) - 22.0;
    float m = 1.0 - smoothstep(-0.8, 0.8, d);
    if (m > 0.0) {
      // 大鼓：喇叭把布往外推，中間鼓起來（紋路往外撐、中間亮一點）
      vec2 rel = (p - c) / (uGrille.zw * 0.5);
      float bump = exp(-dot(rel, rel) * 1.6);
      vec2 q = c + (p - c) * (1.0 - 0.016 * uPump * bump);
      float f = 0.9;
      float wx = sin(q.x * f), wy = sin(q.y * f);
      // 經線、緯線：各自是一條條圓的線，交錯處上下疊
      float over = step(0.0, sin(q.x * f * 0.5) * sin(q.y * f * 0.5));
      float tx = 1.0 - pow(abs(wy), 3.0);
      float ty = 1.0 - pow(abs(wx), 3.0);
      float thread = over > 0.5 ? max(tx * 0.9, ty * 0.7) : max(tx * 0.7, ty * 0.9);
      float hole = (1.0 - smoothstep(0.35, 0.8, tx)) * (1.0 - smoothstep(0.35, 0.8, ty));
      // 布：線是暖的深褐（墨色＋一點紙色），縫是黑的
      vec3 yarn = mix(C_SEPIA, C_PAPER, 0.07);
      vec3 cloth = mix(C_INK * 0.6, yarn, smoothstep(0.1, 0.95, thread)) * (0.62 + 0.3 * thread);
      cloth *= 1.0 + 0.25 * uPump * bump;
      cloth *= 0.85 + 0.15 * fbm(q / 60.0, 2);
      // 真空管的暖光從布後面透出來，跟著音量一明一暗（v2：大片的布也在動）
      cloth += mix(C_BLOOD, C_EMBER, 0.4) * 0.07 * (0.35 + 1.1 * uLevel) * exp(-dot(rel * vec2(0.9, 1.3), rel * vec2(0.9, 1.3)) * 1.8) * (0.4 + 0.6 * hole);
      // 布後面的字：解預乘、轉線性；布紋蓋掉一點點（還是要讀得清楚）
      vec2 tuv = (p - uGrille.xy) / uGrille.zw;
      vec4 tx4 = texture(uText, vec2(tuv.x, 1.0 - tuv.y));
      vec3 tl = tx4.a > 0.0 ? toLinear(tx4.rgb / tx4.a) : vec3(0.0);
      float k = tx4.a * mix(0.78, 1.0, hole) * (0.9 + 0.1 * thread);
      vec3 g = mix(cloth, tl * (1.0 + 0.25 * hole), k);
      // 邊緣：布繃在框上，四周暗一圈
      g *= mix(0.55, 1.0, smoothstep(0.0, 30.0, -d));
      col = mix(col, g, m);
    }
  }

  // 魔眼：暗色的玻璃圓，訊號色的扇形；沒對準時開得很大，對準了收成一條細縫
  {
    float r = length(p - uEye.xy);
    float m = 1.0 - smoothstep(uEye.z - 0.8, uEye.z + 0.8, r);
    if (m > 0.0) {
      vec2 v = p - uEye.xy;
      float ang = abs(atan(v.x, -v.y));   // 0 = 正上方
      // 陰影的楔形（正上方）：沒對準時張很開，對準了收成一條縫；亮的扇形是一圈環，中間是黑色的帽
      float open = mix(1.5, 0.1, uEye.w) + 0.2 * (1.0 - uEye.w) * uLevel;
      float ring = smoothstep(uEye.z * 0.38, uEye.z * 0.46, r) * (1.0 - smoothstep(uEye.z * 0.82, uEye.z * 0.9, r));
      float fan = smoothstep(open - 0.05, open + 0.05, ang) * ring;
      float glow = mix(0.55, 1.0, r / uEye.z);
      vec3 e = C_INK * 0.9 + C_SIGNAL * fan * glow * (0.9 + 0.6 * uEye.w + 0.4 * uLevel) + C_BLOOD * 0.15 * ring * (1.0 - fan);
      e += C_BONE * 0.1 * (1.0 - smoothstep(0.0, 1.8, abs(r - uEye.z * 0.36)));
      col = mix(col, e, m);
    }
  }
  // 窗光（v2 多補的動畫）：一道斜斜的光很慢地在整張紙上來回掃，光裡有樹影在晃（收音機也被照到）
  {
    float sP = dot(p, vec2(0.8, 0.6));
    float cB = 1150.0 + 420.0 * sin(uT * 0.07);
    float band = exp(-pow((sP - cB) / 280.0, 2.0));
    float dap = 0.35 + 0.65 * smoothstep(0.05, 0.35, fbm(p / 170.0 + vec2(uT * 0.06, -uT * 0.035), 2));
    col *= 1.0 + 0.11 * band * dap;
  }
  fragColor = vec4(col * mix(0.9, 1.0, uIn), 1.0);
}`;
