// Deskland · astronomy themes — shared core (nebula.html, galaxy.html, nightsky.html)
// Loaded before the theme's own script; share.js is loaded after it and uses the globals
// cv, draw(), icons, W, H, WALL, TASKBAR, commit(), paused, frameN defined here.
// Same contract as the built-in themes:
//   ?wallpaper=1  host (WebView2) drives the page: icons / settings / reset / pause messages
//   ?preview=1    settings window iframe, same messages through postMessage
//   no query      browser demo with draggable sample icons
// License: GPL-3.0, same as Deskland.
'use strict';

const CELL_W = 76, CELL_H = 100, GRID_X0 = 4, GRID_Y0 = 6, TASKBAR = 48;
const STEP = 6;            // icon field grid (CSS px)
const CG = 20;             // coarse clearance grid used to place big objects (CSS px)
const MORPH_MS = 1800;

const QS = new URLSearchParams(location.search);
const WALL = QS.has('wallpaper');
const PREVIEW = QS.has('preview');

// Shared parameters; a theme adds its own through boot({ defaults })
const P = { sigma: 80, stars: 0.6, flow: 1, adaptive: 1, quality: 2, cap30: true };
let DEFAULTS = {};
let THEME = null;
let seed = (Math.random() * 1e6) | 0;

/* ---------- deterministic random ---------- */
function hashI(x, y, k = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((seed + k) | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- tileable noise texture (4 independent fbm channels) ---------- */
function makeNoiseImage() {
  const S = 256, d = new Uint8Array(S * S * 4);
  const lat = (x, y, per, k) => {
    let h = Math.imul(((x % per) + per) % per, 374761393) ^ Math.imul(((y % per) + per) % per, 668265263) ^ Math.imul(k, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vn = (x, y, per, k) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = lat(ix, iy, per, k), b = lat(ix + 1, iy, per, k), c = lat(ix, iy + 1, per, k), e = lat(ix + 1, iy + 1, per, k);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + e) * ux * uy;
  };
  const chans = [[4, 8, 16, 32, 64], [4, 8, 16, 32, 64], [8, 16, 32, 64, 128], [3, 6, 12, 24, 48]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    for (let c = 0; c < 4; c++) {
      let s = 0, w = 0.5, tw = 0;
      for (let o = 0; o < chans[c].length; o++) { const per = chans[c][o]; s += w * vn(u * per, v * per, per, 101 + c * 57 + o * 13); tw += w; w *= 0.52; }
      d[i + c] = clamp((s / tw - 0.5) * 2.0 + 0.5, 0, 1) * 255;
    }
  }
  return { S, d };
}

/* ---------- WebGL ---------- */
const cv = document.getElementById('art');
const gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
if (!gl) document.getElementById('nogl').style.display = 'grid';

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Common fragment shader header: coordinates, noise, icon field and star layers.
const FS_HEAD = `#version 300 es
precision highp float;
uniform sampler2D uNoise, uFA, uFB;
uniform vec2 uRes, uGrid;
uniform float uScale, uStep, uMix, uTime, uSeed, uStars, uAppear;
out vec4 o;

float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// screen position in CSS px, origin top-left
vec2 fragPx() { return vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale; }
vec4 N(vec2 p, float scale) { return texture(uNoise, p / scale + uSeed); }
float fieldOf(sampler2D t, vec2 p) { return texture(t, (p / uStep + 0.5) / uGrid).r; }
// signed distance (px) to the edge of the space kept clear around icons: < 0 near icons
float iconField(vec2 p) { return mix(fieldOf(uFA, p), fieldOf(uFB, p), uMix); }

// One star per grid cell (only the pixel's own cell is evaluated, so a layer costs a few hashes).
vec3 starLayer(vec2 p, float cell, float dens, float size, float k) {
  vec2 g = floor(p / cell), f = p - g * cell;
  vec2 gs = g + k + uSeed * 91.0;
  if (h21(gs + 7.31) > dens) return vec3(0.0);
  vec2 r = h22(gs);
  float mag = pow(h21(gs + 3.17), 5.0);
  float rad = size * (0.55 + 1.5 * mag);
  vec2 c = (0.5 + (r - 0.5) * max(0.0, 1.0 - 2.6 * rad / cell)) * cell;
  float d = length(f - c);
  float tw = 0.78 + 0.22 * sin(uTime * (0.7 + 2.6 * r.x) + r.y * 43.0);
  float core = exp(-d * d / (rad * rad)) * (0.28 + 0.9 * mag) * tw;
  float t = h21(gs + 11.9);
  vec3 tint = t < 0.5 ? mix(vec3(1.0, 0.74, 0.52), vec3(1.0), t * 2.0) : mix(vec3(1.0), vec3(0.62, 0.76, 1.0), t * 2.0 - 2.0 + 1.0);
  return core * mix(vec3(1.0), tint, 0.75);
}
// A few bright stars with a soft halo and thin diffraction spikes
vec3 brightStars(vec2 p, float cell, float dens, float k) {
  vec2 g = floor(p / cell), f = p - g * cell;
  vec2 gs = g + k + uSeed * 57.0;
  if (h21(gs + 1.7) > dens) return vec3(0.0);
  vec2 r = h22(gs);
  vec2 d = f - (0.22 + 0.56 * r) * cell;
  float m = 0.45 + 0.55 * h21(gs + 5.3);
  float tw = 0.86 + 0.14 * sin(uTime * (0.5 + 1.5 * r.y) + r.x * 31.0);
  float l = length(d);
  float glow = exp(-l * l / (2.2 * m * m + 0.6)) + 0.16 * exp(-l / (5.0 * m + 1.0));
  vec2 a = abs(d);
  float spikes = exp(-a.y * a.y * 1.6) * exp(-a.x / (9.0 * m + 2.0)) + exp(-a.x * a.x * 1.6) * exp(-a.y / (9.0 * m + 2.0));
  float t = h21(gs + 9.1);
  vec3 tint = mix(vec3(1.0, 0.82, 0.66), vec3(0.70, 0.82, 1.0), ss(0.25, 0.75, t));
  return (glow + 0.34 * spikes) * m * tw * mix(vec3(1.0), tint, 0.7);
}
// The whole star field. amount 0..1 (settings); boost thickens the faint layers locally.
vec3 starField(vec2 p, float boost) {
  float a = uStars;
  vec3 c = starLayer(p, 11.0, min(0.5, (0.10 + 0.34 * a) * (1.0 + boost)), 0.48, 0.0) * 0.8;
  c += starLayer(p, 27.0, min(0.6, (0.12 + 0.40 * a) * (1.0 + 0.6 * boost)), 0.72, 17.0);
  c += starLayer(p, 61.0, 0.10 + 0.45 * a, 1.05, 41.0) * 1.2;
  c += brightStars(p, 330.0, 0.15 + 0.6 * a, 5.0);
  return c;
}
vec3 finish(vec3 c) {
  c = 1.0 - exp(-c * 1.35);                                  // soft shoulder, never clips
  c *= uAppear;
  c += (h21(gl_FragCoord.xy + fract(uTime) * 37.0) - 0.5) / 255.0;   // dither: no banding in dark gradients
  return c;
}
`;

function program(fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); throw new Error('shader'); }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
  const U = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); U[nm] = gl.getUniformLocation(p, nm); }
  return { p, U };
}
let PR = null, noiseTex = null;
function buildNoiseTex() {
  const { S, d } = makeNoiseImage();
  noiseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
}

/* ---------- icon field: s = distance (px) to the edge of the kept-clear zone, < 0 near icons ---------- */
let W = innerWidth, H = innerHeight, Gw = 1, Gh = 1;
let icons = [];
const ftex = [null, null];
let fromI = 0, toI = 0, morphT0 = -1e9, morphDur = MORPH_MS, FA = null, FB = null, curMix = 1, fieldMs = 0;

function computeField(rects) {
  const t0 = performance.now();
  const N = Gw * Gh, f = new Float32Array(N), s = new Float32Array(N);
  const sig = P.sigma, is1 = 1 / (sig * sig);
  for (const r of rects) {
    const R = 5.5 * sig;
    const gx0 = Math.max(0, Math.floor((r.cx - r.hw - R) / STEP)), gx1 = Math.min(Gw - 1, Math.ceil((r.cx + r.hw + R) / STEP));
    const gy0 = Math.max(0, Math.floor((r.cy - r.hh - R) / STEP)), gy1 = Math.min(Gh - 1, Math.ceil((r.cy + r.hh + R) / STEP));
    for (let gy = gy0; gy <= gy1; gy++) {
      let dy = Math.abs(gy * STEP - r.cy) - r.hh; if (dy < 0) dy = 0;
      const row = gy * Gw, dy2 = dy * dy;
      for (let gx = gx0; gx <= gx1; gx++) {
        let dx = Math.abs(gx * STEP - r.cx) - r.hw; if (dx < 0) dx = 0;
        f[row + gx] += Math.exp(-(dx * dx + dy2) * is1);
      }
    }
  }
  const fMin = Math.exp(-30);
  for (let i = 0; i < N; i++) {
    const g = Math.log(Math.max(f[i], fMin));
    s[i] = sig * (Math.sqrt(Math.max(-g, 0)) - 1) - sig * 0.6 * Math.max(g, 0);
  }
  fieldMs = performance.now() - t0;
  return { s };
}
function allocField() {
  for (let i = 0; i < 2; i++) {
    if (ftex[i]) gl.deleteTexture(ftex[i]);
    ftex[i] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, ftex[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, Gw, Gh, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  FA = FB = null;
}
function uploadField(i, F) {
  gl.bindTexture(gl.TEXTURE_2D, ftex[i]);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Gw, Gh, gl.RED, gl.FLOAT, F.s);
}
const activeIcons = () => P.adaptive ? icons : [];
const iconRects = () => activeIcons().map(ic => ({ cx: ic.x + ic.w / 2, cy: ic.y + ic.h / 2, hw: ic.w / 2 - 3, hh: ic.h / 2 - 2 }));

/* ---------- coarse clearance map: true distance to the nearest icon, for placing big objects ---------- */
const CLR = { gw: 1, gh: 1, d: new Float32Array(1) };
function computeClearance() {
  const gw = Math.ceil(W / CG) + 1, gh = Math.ceil(H / CG) + 1, d = new Float32Array(gw * gh).fill(1e5);
  for (const ic of activeIcons()) {
    const cx = ic.x + ic.w / 2, cy = ic.y + ic.h / 2, hw = ic.w / 2, hh = ic.h / 2;
    for (let gy = 0; gy < gh; gy++) {
      let dy = Math.abs(gy * CG - cy) - hh; if (dy < 0) dy = 0;
      for (let gx = 0; gx < gw; gx++) {
        let dx = Math.abs(gx * CG - cx) - hw; if (dx < 0) dx = 0;
        const dd = dx * dx + dy * dy, i = gy * gw + gx;
        if (dd < d[i]) d[i] = dd;
      }
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]);
  CLR.gw = gw; CLR.gh = gh; CLR.d = d;
}
// distance (px) from a point to the nearest icon (large when there are none)
function iconDist(x, y) {
  const gx = clamp(Math.round(x / CG), 0, CLR.gw - 1), gy = clamp(Math.round(y / CG), 0, CLR.gh - 1);
  return CLR.d[gy * CLR.gw + gx];
}
// The n largest empty discs of the desktop, biggest first: [{x, y, r}]
function freeSpots(n, o = {}) {
  const top = o.top || 0, bottom = o.bottom === undefined ? TASKBAR : o.bottom, left = o.left || 0, right = o.right || 0;
  const edge = o.edge === undefined ? 1 : o.edge, sep = o.sep === undefined ? 1 : o.sep, minR = o.minR || 40, pad = o.pad || 0;
  const px = o.prefer ? o.prefer.x : W / 2, py = o.prefer ? o.prefer.y : (H - bottom) / 2;
  const gw = CLR.gw, gh = CLR.gh, c = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const x = gx * CG, y = gy * CG;
    const e = Math.min(x - left, W - right - x, y - top, H - bottom - y) * edge;
    c[gy * gw + gx] = Math.min(CLR.d[gy * gw + gx] - pad, e);
  }
  for (const b of o.blocked || []) for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const i = gy * gw + gx, dd = Math.hypot(gx * CG - b.x, gy * CG - b.y) - b.r;
    if (dd < c[i]) c[i] = dd;
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    let bi = -1, bs = -1e9;
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx, sc = c[i] - 0.02 * Math.hypot(gx * CG - px, gy * CG - py);
      if (sc > bs) { bs = sc; bi = i; }
    }
    if (bi < 0 || c[bi] < minR) break;
    const sp = { x: (bi % gw) * CG, y: Math.floor(bi / gw) * CG, r: c[bi] };
    out.push(sp);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx, dd = Math.hypot(gx * CG - sp.x, gy * CG - sp.y) - sp.r * sep;
      if (dd < c[i]) c[i] = dd;
    }
  }
  return out;
}

/* ---------- field updates ---------- */
function commit(fromEmpty = false) {
  const nf = computeField(iconRects());
  const target = 1 - toI;
  if (fromEmpty || !FB) { FA = computeField([]); uploadField(toI, FA); }
  else FA = FB;
  FB = nf;
  uploadField(target, FB);
  fromI = toI; toI = target;
  morphT0 = performance.now();
  morphDur = fromEmpty ? 2600 : MORPH_MS;
  computeClearance();
  if (THEME && THEME.onLayout) THEME.onLayout(fromEmpty);
}
function refresh() {
  FA = FB = computeField(iconRects());
  uploadField(toI, FB);
  fromI = toI; morphT0 = -1e9;
  computeClearance();
  if (THEME && THEME.onLayout) THEME.onLayout(false);
}

/* ---------- size / main loop ---------- */
function resize() {
  W = innerWidth; H = innerHeight;
  const scale = PREVIEW ? 0.45 : Math.min(devicePixelRatio || 1, P.quality);
  const box = cv.getBoundingClientRect();           // fractional CSS size → canvas matches the screen pixel for pixel
  cv.width = Math.round((box.width || W) * scale); cv.height = Math.round((box.height || H) * scale); cv._scale = scale;
  Gw = Math.ceil(W / STEP) + 2; Gh = Math.ceil(H / STEP) + 2;
  allocField();
}
const T0 = performance.now();
let lastT = 0, fpsEMA = 0, frameN = 0, frameMs = 0, appear = 0, flowT = 0;
let paused = false;                                 // host: a window is maximized / full screen
function frame(now) {
  requestAnimationFrame(frame);
  if (paused) { lastT = 0; return; }
  if (P.cap30 && now - lastT < 31) return;
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0.033;
  if (lastT) fpsEMA = fpsEMA ? fpsEMA * 0.9 + (1 / dt) * 0.1 : 1 / dt;
  lastT = now;
  const e = Math.min((now - morphT0) / morphDur, 1);
  curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
  appear = Math.min(1, appear + dt / 1.6);
  flowT += dt * P.flow;
  if (THEME.step) THEME.step(dt, now);
  draw(now);
  frameN++;
}
function draw(now) {
  const U = PR.U;
  gl.useProgram(PR.p);
  gl.viewport(0, 0, cv.width, cv.height);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ftex[fromI]);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ftex[toI]);
  gl.uniform1i(U.uNoise, 0); gl.uniform1i(U.uFA, 1); gl.uniform1i(U.uFB, 2);
  gl.uniform2f(U.uRes, cv.width / cv._scale, cv.height / cv._scale);
  gl.uniform2f(U.uGrid, Gw, Gh);
  gl.uniform1f(U.uScale, cv._scale);
  gl.uniform1f(U.uStep, STEP);
  gl.uniform1f(U.uMix, curMix);
  gl.uniform1f(U.uTime, ((now - T0) / 1000) % 3600);
  gl.uniform1f(U.uSeed, (seed % 997) / 997);
  gl.uniform1f(U.uStars, P.stars);
  gl.uniform1f(U.uAppear, appear * appear * (3 - 2 * appear));
  if (THEME.uniforms) THEME.uniforms(U, now);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* ---------- settings ---------- */
let iconsSeen = !(WALL || PREVIEW);
function reseed(v) {
  seed = v;
  if (THEME.onSeed) THEME.onSeed();
  if (iconsSeen && FB) commit(true);
}
function applySettings(v) {
  if (typeof v.seed === 'number' && v.seed !== seed) reseed(v.seed);
  let field = false, layout = false;
  for (const k in v) {
    if (k === 'seed' || !(k in DEFAULTS) || k === 'quality' || k === 'cap30') continue;
    if (typeof v[k] !== 'number' || !isFinite(v[k]) || P[k] === v[k]) continue;
    if (k === 'adaptive' && v[k] !== 0 && v[k] !== 1) continue;
    P[k] = v[k];
    if (k === 'sigma') field = true;
    if (k === 'adaptive') layout = true;
    if (THEME.layoutKeys && THEME.layoutKeys.includes(k)) field = true;
  }
  if (!FB) return;
  if (layout) commit(); else if (field) refresh();
}

/* ---------- hosted mode (wallpaper / settings preview) ---------- */
function drawGhosts() {
  document.getElementById('ghosts').innerHTML = icons.map(ic => `<div class="ghost" style="left:${ic.x}px;top:${ic.y}px;width:${ic.w}px;height:${ic.h}px"><i></i><b></b></div>`).join('');
}
function startHostedMode() {
  document.body.classList.add('wall');
  if (PREVIEW) {
    document.body.classList.add('preview');
    const g = document.createElement('div'); g.id = 'ghosts'; document.body.appendChild(g);
  }
  icons = [];
  commit(true);
  let first = true;
  const handle = m => {
    if (!m) return;
    if (m.t === 'pause') { paused = PREVIEW ? false : !!m.v; return; }
    if (m.t === 'settings') { applySettings(m.v || {}); return; }
    if (m.t === 'reset') { applySettings(Object.assign({}, DEFAULTS, m.v || {})); return; }
    if (m.t !== 'icons') return;
    const k = window.devicePixelRatio || 1;          // physical px → CSS px
    icons = m.vis ? m.r.map(([l, t, r, b]) => ({ x: l / k, y: t / k, w: (r - l) / k, h: (b - t) / k })) : [];
    if (PREVIEW) drawGhosts();
    iconsSeen = true;
    commit(first);
    first = false;
  };
  if (PREVIEW) {
    addEventListener('message', ev => { if (ev.source === parent) handle(typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data); });
    parent.postMessage(JSON.stringify({ t: 'ready' }), '*');
    return;
  }
  const host = window.chrome && window.chrome.webview;
  if (!host) return;
  host.addEventListener('message', ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); });
  host.postMessage('ready');
}

/* ---------- browser demo: sample desktop with draggable icons ---------- */
const DEMO_GLYPHS = {
  folder: '<path d="M4 12a3 3 0 0 1 3-3h11l4 4h19a3 3 0 0 1 3 3v2H4z" fill="#d99a26"/><path d="M4 17h40v20a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#fbc94a"/>',
  doc: '<path d="M12 4h17l9 9v29a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#f8f9fb"/><path d="M29 4v7a2 2 0 0 0 2 2h7z" fill="#d5dae2"/><path d="M16 21h16M16 26h16M16 31h16M16 36h10" stroke="#b9c0cb" stroke-width="1.6"/>',
  pic: '<rect x="6" y="9" width="36" height="30" rx="3" fill="#f8f9fb"/><rect x="9" y="12" width="30" height="24" rx="1.5" fill="#22306b"/><circle cx="31" cy="19" r="3" fill="#ffe9a8"/><path d="M9 33l8-9 6 6 4-4 12 10z" fill="#5b6fd6"/>',
};
const DEMO_APP = ['#e8553e', '#2f7de1', '#18a058', '#8b5cf6', '#f59e0b', '#0ea5a4', '#db2777', '#475569'];
const DEMO_FILES = [['Recycle Bin', 'app'], ['Projects', 'folder'], ['Photos', 'folder'], ['notes.txt', 'doc'], ['Budget.xlsx', 'doc'], ['Orion.png', 'pic'],
  ['Thesis.docx', 'doc'], ['Music', 'folder'], ['Browser', 'app'], ['Terminal', 'app'], ['Editor', 'app'], ['Sketches', 'folder'], ['M31.png', 'pic'],
  ['Invoices', 'folder'], ['Chat', 'app'], ['readme.md', 'doc'], ['Games', 'folder'], ['Mail', 'app'], ['Scan.pdf', 'doc'], ['Moon.png', 'pic'],
  ['Archive', 'folder'], ['Player', 'app'], ['todo.txt', 'doc'], ['Maps', 'app'], ['Trips', 'folder'], ['Report.pdf', 'doc'], ['Saturn.png', 'pic'], ['Tools', 'folder']];
const demoGlyph = (name, type, i) => type === 'app'
  ? `<rect x="5" y="5" width="38" height="38" rx="9" fill="${DEMO_APP[i % DEMO_APP.length]}"/><path d="M5 14a9 9 0 0 1 9-9h20a9 9 0 0 1 9 9v6H5z" fill="#fff" opacity=".14"/><text x="24" y="31.5" text-anchor="middle" font-family="Segoe UI,Arial" font-weight="700" font-size="18" fill="#fff">${name[0]}</text>`
  : DEMO_GLYPHS[type];
let demoDrag = null, demoSel = null, demoLayout = 0;
const demoGrid = () => ({ cols: Math.max(1, Math.floor((W - GRID_X0) / CELL_W)), rows: Math.max(1, Math.floor((H - TASKBAR - GRID_Y0) / CELL_H)) });
const demoCell = (c, r) => ({ x: GRID_X0 + c * CELL_W, y: GRID_Y0 + r * CELL_H });
const demoTaken = (x, y, self) => icons.some(ic => ic !== self && Math.abs(ic.x - x) < CELL_W / 2 && Math.abs(ic.y - y) < CELL_H / 2);
function demoAdd(i, pos) {
  const [name, type] = DEMO_FILES[i % DEMO_FILES.length];
  const el = document.createElement('div');
  el.className = 'icon';
  el.innerHTML = `<div class="glyph"><svg viewBox="0 0 48 48">${demoGlyph(name, type, i)}</svg></div><div class="label">${name}</div>`;
  el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
  document.getElementById('desktop').appendChild(el);
  const ic = { x: pos.x, y: pos.y, w: el.offsetWidth, h: el.offsetHeight, el };
  icons.push(ic);
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (demoSel) demoSel.el.classList.remove('sel');
    demoSel = ic; el.classList.add('sel');
    el.setPointerCapture(e.pointerId); el.classList.remove('settle');
    demoDrag = { ic, sx: e.clientX, sy: e.clientY, ox: ic.x, oy: ic.y, moved: false };
  });
  el.addEventListener('pointermove', e => {
    if (!demoDrag || demoDrag.ic !== ic) return;
    const dx = e.clientX - demoDrag.sx, dy = e.clientY - demoDrag.sy;
    if (!demoDrag.moved && Math.hypot(dx, dy) < 4) return;
    demoDrag.moved = true; el.classList.add('drag');
    el.style.left = demoDrag.ox + dx + 'px'; el.style.top = demoDrag.oy + dy + 'px';
  });
  const end = (e, cancel) => {
    if (!demoDrag || demoDrag.ic !== ic) return;
    const d = demoDrag; demoDrag = null;
    el.classList.remove('drag');
    if (!d.moved) return;
    let nx = cancel ? d.ox : d.ox + (e.clientX - d.sx), ny = cancel ? d.oy : d.oy + (e.clientY - d.sy);
    nx = clamp(nx, 0, W - ic.w); ny = clamp(ny, 0, H - TASKBAR - ic.h);
    const g = demoGrid();
    let best = null, bd = 1e9;
    for (let c = 0; c < g.cols; c++) for (let r = 0; r < g.rows; r++) {
      const p = demoCell(c, r);
      if (demoTaken(p.x, p.y, ic)) continue;
      const dd = Math.hypot(p.x - nx, p.y - ny);
      if (dd < bd) { bd = dd; best = p; }
    }
    if (best && !cancel) { nx = best.x; ny = best.y; }
    el.classList.add('settle');
    ic.x = nx; ic.y = ny; el.style.left = nx + 'px'; el.style.top = ny + 'px';
    commit();
  };
  el.addEventListener('pointerup', e => end(e, false));
  el.addEventListener('pointercancel', e => end(e, true));
  return ic;
}
function demoApply(kind) {
  icons.forEach(ic => ic.el.remove()); icons = []; demoSel = null;
  const g = demoGrid(), rnd = mulberry32(977 + kind * 31), cells = [];
  const put = (c, r) => { if (c >= 0 && r >= 0 && c < g.cols && r < g.rows && !cells.some(q => q[0] === c && q[1] === r)) cells.push([c, r]); };
  if (kind === 0) {                                   // a tidy left block, a group on the right, a few strays
    const colsL = g.cols > 12 ? 2 : 1;
    for (let c = 0; c < colsL; c++) for (let r = 0; r < g.rows - (c ? 2 : 0); r++) put(c, r);
    const bx = Math.round(g.cols * 0.72), by = Math.round(g.rows * 0.12);
    for (let c = 0; c < Math.min(3, g.cols - 2); c++) for (let r = 0; r < 2; r++) put(bx + c, by + r);
    put(Math.round(g.cols * 0.42), Math.round(g.rows * 0.72)); put(Math.round(g.cols * 0.42) + 1, Math.round(g.rows * 0.72));
    put(Math.round(g.cols * 0.9), Math.round(g.rows * 0.8));
  } else if (kind === 1) {                            // messy
    for (let i = 0; i < Math.min(26, g.cols * g.rows * 0.22); i++)
      put(rnd() < 0.4 ? Math.floor(rnd() * Math.min(3, g.cols)) : Math.floor(rnd() * g.cols), Math.floor(rnd() * g.rows));
  } else {                                            // minimal
    for (let r = 0; r < Math.min(5, g.rows); r++) put(0, r);
    put(Math.round(g.cols * 0.6), Math.round(g.rows * 0.55));
  }
  cells.forEach(([c, r], i) => demoAdd(i, demoCell(c, r)));
  commit(true);
}
function startDemo() {
  demoApply(0);
  const bar = document.getElementById('demobar');
  bar.querySelector('[data-a=layout]').addEventListener('click', () => { demoLayout = (demoLayout + 1) % 3; demoApply(demoLayout); });
  bar.querySelector('[data-a=seed]').addEventListener('click', () => reseed((Math.random() * 1e6) | 0));
  bar.querySelector('[data-a=add]').addEventListener('click', () => {
    const g = demoGrid();
    for (let t = 0; t < 200; t++) {
      const p = demoCell(Math.floor(Math.random() * g.cols), Math.floor(Math.random() * g.rows));
      if (!demoTaken(p.x, p.y, null)) { demoAdd(icons.length, p); commit(); return; }
    }
  });
  document.getElementById('desktop').addEventListener('pointerdown', () => { if (demoSel) demoSel.el.classList.remove('sel'); demoSel = null; });
  addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && demoSel) { demoSel.el.remove(); icons = icons.filter(x => x !== demoSel); demoSel = null; commit(); }
    else if (e.key === 'h' || e.key === 'H') bar.classList.toggle('hidden');
  });
  const clock = document.getElementById('clock');
  const tick = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); clock.innerHTML = `${z(d.getHours())}:${z(d.getMinutes())}<br>${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
  setInterval(tick, 15000); tick();
}

/* ---------- start ---------- */
function boot(theme) {
  THEME = theme;
  Object.assign(P, theme.defaults || {});
  DEFAULTS = Object.assign({}, P);
  if (!gl) return;
  PR = program(FS_HEAD + theme.fs);
  gl.bindVertexArray(gl.createVertexArray());
  buildNoiseTex();
  resize();
  if (theme.init) theme.init();
  let resizeT = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      resize();
      if (!(WALL || PREVIEW)) for (const ic of icons) { ic.x = Math.min(ic.x, Math.max(0, W - ic.w)); ic.y = Math.min(ic.y, Math.max(0, H - TASKBAR - ic.h)); ic.el.style.left = ic.x + 'px'; ic.el.style.top = ic.y + 'px'; }
      refresh();
    }, 100);
  });
  window.__dbg = {
    P, theme,
    bench() {
      const px = new Uint8Array(4), ts = [];
      for (let i = 0; i < 10; i++) { const a = performance.now(); draw(performance.now()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - a); }
      ts.sort((a, b) => a - b);
      return { frame: +ts[5].toFixed(1), field: +fieldMs.toFixed(1), canvas: cv.width + 'x' + cv.height, fps: +fpsEMA.toFixed(0) };
    },
  };
  if (WALL || PREVIEW) startHostedMode(); else startDemo();
  requestAnimationFrame(frame);
}
