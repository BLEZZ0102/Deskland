// Deskland · Zen Garden theme script (loaded by zen.html after astro-core.js and sprites.js)
// The garden itself (stones, moss, raked gravel) only changes when the icon field, the settings or the canvas size change,
// so it is rendered into an offscreen texture then; each frame samples it, adds the drifting cloud shadows and draws the sprites.
// License: GPL-3.0, same as Deskland.
'use strict';

// ?debug: show errors (e.g. shader compile logs) on the page, for headless test screenshots
if (QS.has('debug')) {
  const show = t => document.body.insertAdjacentHTML('beforeend', '<pre style="position:fixed;left:0;top:0;z-index:99;color:#b00;background:#fff;font-size:12px;white-space:pre-wrap">' + String(t).replace(/</g, '&lt;') + '</pre>');
  const oe = console.error; console.error = (...a) => { show(a.join(' ')); oe(...a); };
  addEventListener('error', e => show(e.message));
}

/* ---------- light and season palettes (display colours) ---------- */
// dir: on-screen direction toward the sun; elev: sin(sun elevation)
const LIGHTS = [
  { dir: [-0.80, -0.60], elev: 0.42, sun: [0.62, 0.58, 0.51], amb: [0.45, 0.44, 0.43], grv: [0.99, 0.95, 0.87], cloud: 0.55, sprite: [1.0, 0.95, 0.88] },   // morning
  { dir: [-0.30, -0.95], elev: 0.85, sun: [0.56, 0.55, 0.52], amb: [0.44, 0.435, 0.43], grv: [0.98, 0.945, 0.875], cloud: 0.62, sprite: [1.0, 1.0, 1.0] },     // noon
  { dir: [0.86, -0.51], elev: 0.30, sun: [0.74, 0.50, 0.30], amb: [0.38, 0.355, 0.42], grv: [1.00, 0.91, 0.80], cloud: 0.50, sprite: [1.0, 0.82, 0.66] },    // dusk
  { dir: [-0.55, -0.83], elev: 0.62, sun: [0.25, 0.31, 0.47], amb: [0.06, 0.075, 0.13], grv: [0.92, 0.93, 0.97], cloud: 0.30, sprite: [0.36, 0.42, 0.58], vig: 0.55 }, // moonlight
];
// moss dark / moss light / stone / gravel tint / snow
const SEASONS = [
  { ms0: [0.16, 0.24, 0.09], ms1: [0.44, 0.56, 0.19], stn: [0.46, 0.45, 0.43], tint: [1.00, 0.99, 0.98], snow: 0 },   // spring
  { ms0: [0.10, 0.18, 0.07], ms1: [0.30, 0.44, 0.15], stn: [0.44, 0.44, 0.42], tint: [1.00, 1.00, 0.98], snow: 0 },   // summer
  { ms0: [0.15, 0.18, 0.07], ms1: [0.42, 0.43, 0.16], stn: [0.47, 0.44, 0.41], tint: [1.00, 0.98, 0.95], snow: 0 },   // autumn
  { ms0: [0.12, 0.14, 0.09], ms1: [0.31, 0.33, 0.22], stn: [0.44, 0.45, 0.46], tint: [0.98, 0.99, 1.02], snow: 1 },   // winter
];
const cur = { vig: 0.22, sun: [0, 0, 0], amb: [0, 0, 0], grv: [0, 0, 0], dir: [0, 0], elev: 0, cloud: 0, sprite: [1, 1, 1],
  ms0: [0, 0, 0], ms1: [0, 0, 0], stn: [0, 0, 0], tint: [0, 0, 0], snow: 0, init: false };
function palTarget() {
  const l = LIGHTS[clamp(Math.round(P.light), 0, 3)], s = SEASONS[clamp(Math.round(P.season), 0, 3)];
  return { vig: l.vig || 0.22, sun: l.sun, amb: l.amb, grv: l.grv.map((v, i) => v * s.tint[i]), dir: l.dir, elev: l.elev, cloud: l.cloud, sprite: l.sprite,
    ms0: s.ms0, ms1: s.ms1, stn: s.stn, tint: s.tint, snow: s.snow };
}
// ease the palette toward the chosen light/season; true while still moving
function stepPal(dt) {
  const t = palTarget(), k = cur.init ? 1 - Math.exp(-dt * 2.4) : 1;
  let moving = false;
  for (const key in t) {
    if (Array.isArray(t[key])) for (let i = 0; i < t[key].length; i++) {
      const d = t[key][i] - cur[key][i]; if (Math.abs(d) > 2e-4) moving = true;
      cur[key][i] = Math.abs(d) > 2e-4 ? cur[key][i] + d * k : t[key][i];
    } else {
      const d = t[key] - cur[key]; if (Math.abs(d) > 2e-4) moving = true;
      cur[key] = Math.abs(d) > 2e-4 ? cur[key] + d * k : t[key];
    }
  }
  cur.init = true;
  return moving;
}

/* ---------- the garden shader (cached) ---------- */
const GARDEN_FS = `
uniform vec4 uK;   // rake spacing (px), width of the ringed zone (px), moss amount, rake phase
uniform vec4 uL;   // on-screen direction toward the sun, sin(elevation), shadow length per px of height
uniform vec4 uG;   // sigma, bottom of the garden (px), snow, -
uniform vec4 uC;   // two corners where the moss banks gather
uniform vec3 uSun, uAmb, uGrv, uMs0, uMs1, uStn;
uniform vec4 uPh[4];   // stones of an empty garden: centre, 1 / radii (px)
uniform vec4 uPh2[4];  // cos, sin of the angle, smaller radius, how far it has sunk (px)
uniform vec4 uG2;     // stones of an empty garden shown, -

// the shared noise, shifted much further per seed so every garden is laid out differently
vec4 NS(vec2 p, float sc) { return texture(uNoise, p / sc + uSeed * vec2(37.0, 61.0)); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// how far the moss banks reach in from the garden edge here (px)
float bankW(vec2 p) {
  vec4 nn = NS(p + 913.0, 2900.0);
  float n = nn.r * 0.75 + nn.b * 0.25;
  float c = exp(-length(p - uC.xy) / 430.0) + 0.8 * exp(-length(p - uC.zw) / 360.0);
  float raw = (n - 0.56) * 260.0 + 130.0 * c;
  return uK.z * 30.0 * log(1.0 + exp(raw / 30.0)) - 14.0;   // smooth max(raw, 0): bare edges just get a ring or two
}
// distance (px) to the nearest stone of an empty garden (they sink away once there are icons)
float phantom(vec2 p) {
  if (uG2.x < 0.5) return 1e4;
  float d = 1e4;
  for (int i = 0; i < 4; i++) {
    vec4 a = uPh[i], b = uPh2[i];
    vec2 q = p - a.xy;
    q = vec2(b.x * q.x - b.y * q.y, b.y * q.x + b.x * q.y) * a.zw;
    d = min(d, (length(q) - 1.0) * b.z + b.w);
  }
  return d;
}
/// the garden field: x = icon islands joined with the moss banks along the edges, y = icon islands only (px, < 0 inside)
vec4 garden(vec2 p, float bw) {   // x: everything, y: islands, z: stones of an empty garden, w: icons only
  float ph = phantom(p), fi = iconField(p);
  float si = smin(fi, ph - uG.x * 0.85, 30.0);
  float e = min(min(p.x, uRes.x - p.x), min(p.y, uG.y - p.y)) - bw;
  return vec4(smin(si, e, 36.0), si, ph, fi);
}
// one raked groove profile: x = height, y = d height / d (2 pi phase); fades out before it could alias
vec2 groove(float ph, float fw) {
  float a1 = ss(0.5, 0.22, fw), a2 = ss(0.24, 0.1, fw);
  float t = 6.2831853 * ph;
  return vec2(a1 * cos(t) + 0.2 * a2 * cos(2.0 * t), -a1 * sin(t) - 0.4 * a2 * sin(2.0 * t));
}
// one grain per cell: offset from its centre (in radii), coverage (anti-aliased), random tone
vec4 grain(vec2 p, float cell, float k) {
#ifdef OFF_GRAIN
  return vec4(0.0, 0.0, 0.5, 0.5);
#endif
  vec2 g = floor(p / cell), f = p - g * cell;
  vec2 r = h22(g + k + uSeed * 53.0);
  float rad = cell * (0.30 + 0.17 * r.x);
  vec2 c = vec2(cell * 0.5) + (r - 0.5) * (cell - 2.0 * rad);
  vec2 d = (f - c) / rad;
  float cov = clamp((1.0 - dot(d, d)) * rad * uScale * 0.5 + 0.5, 0.0, 1.0);
  return vec4(d, cov, fract(r.x * 23.17 + r.y * 61.31));
}
// rock outcrops inside the islands: signed distance-ish (px), < 0 on bare rock
float rockOf(vec4 sv, vec2 p, vec4 nB, vec4 nC) {
  vec4 nr = NS(rot2(0.4) * p + 300.0, 1100.0);
  float r = nr.g * 0.7 + nB.a * 0.2 + nC.r * 0.1;
  float edge = sv.w + uG.x * 0.45 + (nr.b - 0.5) * 70.0 + (nC.r - 0.5) * 16.0;
  float d = -smin(-edge, -(0.52 + 0.14 * uK.z - r) * 600.0, 14.0);
  return min(d, sv.z + (nB.g - 0.5) * 16.0 + (nC.r - 0.5) * 7.0);
}

void main() {
  vec2 p = fragPx();
  float sg = uG.x, sp = uK.x, snow = uG.z;
  vec2 L2 = uL.xy;
  vec3 L3 = vec3(L2 * sqrt(1.0 - uL.z * uL.z), uL.z);
  float px = 1.0 / uScale;

  vec4 nA = NS(p, 2300.0);
  vec4 nB = NS(rot2(0.9) * p + 37.0, 610.0);
  vec4 nC = NS(rot2(-0.6) * p + 11.0, 143.0);
  vec4 nD = NS(rot2(2.2) * p + 5.0, 41.0);
  vec4 nD2 = NS(rot2(-1.1) * p + 19.0, 29.0);

  float bw = bankW(p);
  vec4 sv = garden(p, bw);
  float s = sv.x, si = sv.y;
  // smooth gradients from 4 px differences (the field texture is bilinear, so its own derivative is blocky)
  vec4 gx1 = garden(p + vec2(4.0, 0.0), bw), gy1 = garden(p + vec2(0.0, 4.0), bw);
  vec2 gs = vec2(gx1.x - s, gy1.x - s) / 4.0;

  // moss edge (dm < 0): soft and irregular; rock outcrops (dr < 0)
  float dm = s + (nB.r - 0.5) * 24.0 + (nC.g - 0.5) * 12.0 + (nD.b - 0.5) * 5.0 - (uK.z - 0.5) * 18.0;
  float dr = rockOf(sv, p, nB, nC);

  // raked groove phases (their derivatives must be taken outside the branches below)
  float wob = (nC.b - 0.5) * 0.9 + (nB.b - 0.5) * 3.0;
  float zr = s + wob - uK.y;                            // < 0: rings around the islands, > 0: long straight lines
  float phR = zr / sp;
  float phS = (p.y + (nA.g - 0.5) * 80.0 + wob) / sp + uK.w;
  float fwR = fwidth(phR), fwS = fwidth(phS);
  vec2 dS = vec2(dFdx(phS), -dFdy(phS)) * uScale * sp;

  float mossM = ss(1.0 * px, -1.0 * px - 0.6, dm);
  vec4 ct = grain(rot2(0.7) * p + 17.0, 6.0, 31.0);      // little clumps beyond the edge (and sponge dabs inside)
  vec4 g1 = grain(rot2(0.5) * p, 4.4, 0.0), g2 = grain(rot2(-0.8) * p + 2.3, 3.0, 17.0);   // gravel grains, rock speckle
  vec4 tuft = grain(rot2(-0.3) * p + 5.0, 2.9, 57.0);   // moss tufts
  float clump = ct.z * step(ct.w, ss(14.0, 1.0, dm + (nD2.a - 0.5) * 10.0) * (0.35 + 0.4 * uK.z));
  float moss = max(mossM, clump);
  float rockM = ss(1.0 * px, -1.0 * px - 1.0, dr);
  float wG = (1.0 - moss) * (1.0 - rockM), wM = moss * (1.0 - rockM);
  vec3 col = vec3(0.0);
  float frac = 0.0;

  // shadow of the rocks (one sample toward the sun), only near the islands
  float cot = uL.w, rkSh = 0.0;
#ifndef OFF_S
  if (rockM < 0.999 && s < cot * 16.0 + 40.0) {
    vec2 q1 = p + L2 * cot * 16.0;
    rkSh = ss(6.0, -10.0, rockOf(garden(q1, bw), q1, nB, nC)) * (1.0 - ss(0.0, -4.0, dr));
  }
#endif

  // ---- raked gravel ----
#ifndef OFF_G
  if (wG > 0.001) {
    vec2 gR = groove(phR, fwR), gT = groove(phS, fwS);
    float wS = ss(-1.2, 1.2, zr);
    float hG = mix(gR.x, gT.x, wS);
    float dep = 0.55 * (0.8 + 0.4 * nB.b);
    vec2 slope = mix(gR.y * gs, gT.y * dS, wS) * dep;
    vec3 nG = normalize(vec3(-slope, 1.0));
    // grains: three staggered, rotated layers of little stones over darker grit
    vec3 alb = uGrv * 0.72 * (0.95 + 0.1 * nD.r);
    alb *= 1.0 + 0.10 * (nD2.a - 0.5);
    alb = mix(alb, uGrv * (0.82 + 0.22 * g2.w) * (1.0 + 0.16 * dot(rot2(0.8) * g2.xy, L2)), g2.z);
    vec3 tone1 = g1.w > 0.92 ? vec3(0.97, 0.92, 0.85) : g1.w < 0.035 ? vec3(0.74, 0.72, 0.69) : vec3(1.0);
    alb = mix(alb, uGrv * tone1 * (0.82 + 0.24 * g1.w) * (1.0 + 0.2 * dot(rot2(-0.5) * g1.xy, L2)), g1.z);
    alb *= 0.95 + 0.06 * nC.a + 0.05 * (nA.r - 0.5);
    float msSh = 0.0;                                     // the moss cushions are a few px tall too
    msSh = ss(3.0, -6.0, dm + cot * 4.5 * dot(L2, gs));   // first order: is the moss edge a few px toward the sun?
    float ao = 0.84 + 0.16 * clamp(hG * 0.5 + 0.5, 0.0, 1.0);
    ao *= 1.0 - 0.22 * exp(-max(dm, 0.0) / 7.0);
    float dirG = clamp(1.0 + (dot(nG, L3) / L3.z - 1.0) * 0.55, 0.0, 1.8);
    float shG = 1.0 - max(rkSh, msSh * 0.8);
    vec3 dirC = uSun * dirG * shG;
    vec3 colG = alb * (uAmb * ao + dirC);
    float fracG = dot(alb * dirC, vec3(0.33)) / max(dot(colG, vec3(0.33)), 1e-3);
    // snow settles on the ridges first
    float snG = snow * ss(0.22, 0.62, hG * 0.35 + 0.5 + (nD2.g - 0.5) * 0.7 + (g1.w - 0.5) * 0.25 * g1.z);
    colG = mix(colG, vec3(0.97, 0.98, 1.0) * (uAmb * 1.05 + uSun * dirG * shG), snG * 0.9);
    col += colG * wG; frac += fracG * wG;
  }
#endif

  // ---- moss ----
#ifndef OFF_M
  if (wM > 0.001) {
    float lump = nC.a * 0.68 + (nD.r * 0.55 + nD2.b * 0.45) * 0.32;      // cushions of 6..35 px
    vec2 pe = p - L2 * 3.0;
    float emb = clamp((nC.a - NS(rot2(-0.6) * pe + 11.0, 143.0).a) * 0.68 * 7.0, -0.5, 0.5);                 // > 0 where a cushion faces the sun
    vec3 mcol = mix(uMs0, uMs1, ss(0.28, 0.80, lump * 0.8 + nB.r * 0.2 + emb * 0.2));
    mcol *= 1.0 + emb * 0.45;
    float dq = clamp(1.0 - dot(ct.xy, ct.xy), 0.0, 1.0);
    mcol = mix(mcol, mcol * 1.22 + vec3(0.006, 0.014, 0.0), dq * dq * step(0.55, ct.w) * 0.55 * mossM);
    mcol *= mix(1.0, 0.92 + 0.10 * tuft.w + 0.07 * dot(tuft.xy, L2), tuft.z);
    float deep = ss(0.0, -sg * 0.55, dm);
    mcol *= 1.0 - 0.30 * deep;
    mcol *= 1.0 - 0.25 * exp(-abs(dm + 1.5) / 2.2) * mossM;   // pigment pooling at the edge, like a wash
    mcol = mix(mcol, uMs1 * (0.85 + 0.3 * ct.w), clump * (1.0 - mossM) * 0.6);   // stray clumps are young, lighter moss
    mcol *= 1.0 - 0.35 * exp(-max(dr, 0.0) / 5.0) * mossM;   // darker where it tucks under a rock
    vec3 nM = normalize(vec3(gs * 0.8 * ss(-16.0, 0.0, dm), 1.0));
    float dirM = clamp(1.0 + (dot(nM, L3) / L3.z - 1.0) * 0.5, 0.0, 1.6);
    float shM = 1.0 - rkSh;
    vec3 dirMC = uSun * dirM * shM * 0.9;
    vec3 colM = mcol * (uAmb * 1.1 + dirMC);
    float fracM = dot(mcol * dirMC, vec3(0.33)) / max(dot(colM, vec3(0.33)), 1e-3);
    // winter: a powder of snow on the cushions, thinner deep under the icons
    float pch = ss(0.47, 0.51, lump * 0.7 + nB.b * 0.3 + emb * 0.3 + ss(-30.0, 0.0, dm) * 0.08 + (tuft.w - 0.5) * 0.04);
    float speck = tuft.z * step(1.0 - 0.45 * pch - 0.03, tuft.w);
    float snM = snow * max(pch * 0.93, speck * 0.8) * (1.0 - deep * 0.6);
    colM = mix(colM, vec3(0.96, 0.97, 1.0) * (uAmb * 1.2 + uSun * (0.6 + 0.4 * dirM) * shM) * 1.12, snM);
    col += colM * wM; frac += fracM * wM;
  }
#endif

  // ---- rock outcrops, half buried in the moss ----
#ifndef OFF_R
  if (rockM > 0.001) {
    vec2 gr = vec2(rockOf(gx1, p + vec2(4.0, 0.0), nB, nC) - dr, rockOf(gy1, p + vec2(0.0, 4.0), nB, nC) - dr) / 4.0;
    vec3 nS = normalize(vec3(gr * 3.0 / sqrt(1.0 + max(-dr, 0.0) * 0.35) + (vec2(nD.g, nD2.r) - 0.5) * 0.35, 1.0));   // a rounded boulder
    float dirS = clamp(1.0 + (dot(nS, L3) / L3.z - 1.0) * 0.8, 0.0, 1.6);
    vec3 scol = uStn * (0.80 + 0.30 * nC.b + 0.16 * (nD.a - 0.5)) * (0.94 + 0.12 * g2.w * g2.z);
    float crack = 1.0 - abs(2.0 * NS(rot2(1.2) * p + 61.0, 330.0).b - 1.0);
    scol *= 1.0 - 0.3 * ss(0.95, 0.995, crack);
    float lich = ss(0.60, 0.72, nB.a * 0.45 + nD.g * 0.55);
    scol = mix(scol, vec3(0.58, 0.60, 0.52), lich * 0.4);
    float under = ss(-sg * 0.4, -sg * 0.95, si);          // right under the icons: keep it dark for the labels
    scol *= 1.0 - 0.36 * under;
    vec3 dirSC = uSun * dirS;
    vec3 colS = scol * (uAmb + dirSC);
    float fracS = dot(scol * dirSC, vec3(0.33)) / max(dot(colS, vec3(0.33)), 1e-3);
    colS *= 1.0 - 0.5 * exp(-dr * dr / 3.0) * ss(0.3, 0.65, nD.a);   // dry-brush ink outline
    float snS = snow * ss(-3.0, -12.0, dr) * (1.0 - under) * ss(0.45, 0.65, nD2.a * 0.6 + nC.b * 0.4);
    colS = mix(colS, vec3(0.94, 0.95, 0.98) * (uAmb + dirSC), snS * 0.85);
    col += colS * rockM; frac += fracS * rockM;
  }
#endif

  // a soft wash toward the edges
  vec2 uv = p / uRes - 0.5;
  col *= 1.0 - uG.w * dot(uv, uv);
  o = vec4(clamp(col, 0.0, 0.995), frac);
}`;

/* ---------- per-frame pass: cached garden + cloud shadows ---------- */
const MAIN_FS = `
uniform sampler2D uCache;
uniform vec4 uCl;   // cloud drift (px), amount, -
uniform vec3 uClT;  // colour of the cloud shade
vec3 untone(vec3 t) { return -log(max(1.0 - t, 1e-4)) / 1.35; }
void main() {
  vec4 c = texelFetch(uCache, ivec2(gl_FragCoord.xy), 0);
  vec2 p = fragPx() + uCl.xy;
  float cl = N(p, 2700.0).r * 0.62 + N(rot2(0.5) * p + 71.0, 1150.0).g * 0.38;
  float sh = ss(0.47, 0.70, cl) * uCl.z;
  vec3 col = c.rgb * mix(vec3(1.0), uClT, sh * (0.25 + 0.75 * c.a));
  o = vec4(finish(untone(col)), 1.0);
}`;

let cacheOK = false;                 // share.js clears this after it changes the canvas size
let GP = null, cacheTex = null, cacheFB = null, cacheW = 0, cacheH = 0, cacheMix = -1, palMoving = true;
const FORCE_STATIC = QS.has('static');   // debug: redraw the cached layer every frame (to time the worst case)
const corners = [0, 0, 0, 0];
// an empty garden (no icons, or adaptive off) still gets a composition: a few stones in two groups, which sink away
// as soon as icons appear (they are part of the same field, so the gravel rakes around them like around icons)
const PH = { pres: 0, st: [], a: new Float32Array(16), b: new Float32Array(16) };
function placePhantoms() {
  const rnd = mulberry32(seed * 5 + 11), Hh = H - TASKBAR, flip = rnd() < 0.5;
  const g1 = [W * (flip ? 0.66 : 0.34) + (rnd() - 0.5) * W * 0.06, Hh * (0.36 + rnd() * 0.1)];
  const g2 = [W * (flip ? 0.30 : 0.70) + (rnd() - 0.5) * W * 0.06, Hh * (0.64 + rnd() * 0.08)];
  const a1 = (rnd() - 0.5) * 0.8, a2 = (rnd() - 0.5) * 0.8, side = flip ? -1 : 1;
  PH.st = [
    [g1[0], g1[1], 84 + rnd() * 16, 52 + rnd() * 10, a1],
    [g1[0] + side * (150 + rnd() * 24), g1[1] + 40 + rnd() * 24, 36 + rnd() * 8, 27 + rnd() * 5, a1 + 0.6 + rnd()],
    [g2[0], g2[1], 60 + rnd() * 10, 40 + rnd() * 8, a2],
    [g2[0] - side * (100 + rnd() * 16), g2[1] - 50 - rnd() * 16, 24 + rnd() * 5, 19 + rnd() * 4, a2 - 0.4 - rnd()],
  ];
}
function phantomUniforms(U) {
  const v = PH.pres * PH.pres * (3 - 2 * PH.pres);
  PH.st.forEach((s, i) => { PH.a.set([s[0], s[1], 1 / s[2], 1 / s[3]], i * 4); PH.b.set([Math.cos(s[4]), Math.sin(s[4]), Math.min(s[2], s[3]), (1 - v) * 300], i * 4); });
  gl.uniform4fv(U.uPh, PH.a); gl.uniform4fv(U.uPh2, PH.b);
  gl.uniform4f(U.uG2, v > 0.001 ? 1 : 0, 0, 0, 0);
}
let rakePhase = 0;

function ensureCache() {
  if (cacheTex && cacheW === cv.width && cacheH === cv.height) return;
  if (cacheTex) { gl.deleteTexture(cacheTex); gl.deleteFramebuffer(cacheFB); }
  cacheW = cv.width; cacheH = cv.height;
  cacheTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, cacheTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cacheW, cacheH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  cacheFB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, cacheFB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cacheTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);
  cacheOK = false;
}
function renderGarden(now) {
  const U = GP.U;
  gl.bindFramebuffer(gl.FRAMEBUFFER, cacheFB);
  gl.viewport(0, 0, cacheW, cacheH);
  gl.useProgram(GP.p);
  gl.uniform1i(U.uNoise, 0); gl.uniform1i(U.uFA, 1); gl.uniform1i(U.uFB, 2);
  gl.uniform2f(U.uRes, cv.width / cv._scale, cv.height / cv._scale);
  gl.uniform2f(U.uGrid, Gw, Gh);
  gl.uniform1f(U.uScale, cv._scale);
  gl.uniform1f(U.uStep, STEP);
  gl.uniform1f(U.uMix, curMix);
  gl.uniform1f(U.uSeed, (seed % 997) / 997);
  const sp = P.spacing, ring = Math.min(Math.round(P.rings) * sp + sp * 0.25, P.sigma * 3.1);
  gl.uniform4f(U.uK, sp, ring, P.moss, rakePhase);
  const e = cur.elev, cot = Math.min(Math.sqrt(1 - e * e) / e, 3), dl = Math.hypot(cur.dir[0], cur.dir[1]) || 1;
  gl.uniform4f(U.uL, cur.dir[0] / dl, cur.dir[1] / dl, e, cot);
  gl.uniform4f(U.uG, P.sigma, H - TASKBAR, cur.snow, cur.vig);
  gl.uniform4f(U.uC, corners[0] * W, corners[1] * (H - TASKBAR), corners[2] * W, corners[3] * (H - TASKBAR));
  gl.uniform3fv(U.uSun, cur.sun); gl.uniform3fv(U.uAmb, cur.amb); gl.uniform3fv(U.uGrv, cur.grv);
  phantomUniforms(U);
  gl.uniform3fv(U.uMs0, cur.ms0); gl.uniform3fv(U.uMs1, cur.ms1); gl.uniform3fv(U.uStn, cur.stn);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, cv.width, cv.height);
  gl.useProgram(PR.p);
  cacheMix = curMix; cacheOK = true;
}
function onSeedChange() {
  const rnd = mulberry32(seed * 7 + 3);
  const diag = rnd() < 0.5;
  // two opposite corners gather the moss banks, pulled a little along the edges
  const a = [diag ? 0 : 1, 0], b = [diag ? 1 : 0, 1];
  if (rnd() < 0.5) { a[0] = lerp(a[0], 0.5, 0.25 * rnd()); b[1] = lerp(b[1], 0.5, 0.3 * rnd()); }
  else { a[1] = lerp(a[1], 0.5, 0.3 * rnd()); b[0] = lerp(b[0], 0.5, 0.25 * rnd()); }
  corners[0] = a[0]; corners[1] = a[1]; corners[2] = b[0]; corners[3] = b[1];
  rakePhase = rnd();
  placePhantoms();
  cacheOK = false;
  if (typeof Leaves !== 'undefined') Leaves.reset();
}

/* ---------- sprites: maple leaves, cherry petals, green leaves, snow ---------- */
const CELL = 64;
const FR = {};
function paintMaple(ctx, ox, oy, rnd, shadow) {
  const cx = ox + 32, cy = oy + 29, R = 27;
  const lobes = [];
  const n = 7, spread = 112 + rnd() * 10;
  for (let i = 0; i < n; i++) {
    const k = i - 3, a = (-90 + k * spread / 3 + (rnd() - 0.5) * 8) * Math.PI / 180;
    const L = [1, 0.9, 0.7, 0.4][Math.abs(k)] * (0.9 + rnd() * 0.15) * R;
    lobes.push({ a, L });
  }
  const pts = [];
  const half = (spread / 3) * Math.PI / 180 / 2;
  for (const lb of lobes) {
    const nA = lb.a - half, nB = lb.a + half, rn = R * 0.2;
    const p0 = [cx + Math.cos(nA) * rn, cy + Math.sin(nA) * rn];
    const tip = [cx + Math.cos(lb.a) * lb.L, cy + Math.sin(lb.a) * lb.L];
    const p1 = [cx + Math.cos(nB) * rn, cy + Math.sin(nB) * rn];
    const w = lb.L * 0.19;
    const nx = -Math.sin(lb.a), ny = Math.cos(lb.a);
    const q = (t, side) => {          // lobe edge: notch → tip, bulging sideways, serrated
      const bx = lerp(side < 0 ? p0[0] : p1[0], tip[0], t), by = lerp(side < 0 ? p0[1] : p1[1], tip[1], t);
      const bulge = Math.sin(Math.PI * Math.pow(t, 0.8)) * w * (1 - t * 0.35);
      const tooth = (Math.floor(t * 9) % 2 ? 0.0 : 1.0) * w * 0.12 * t;
      return [bx + nx * side * (bulge + tooth), by + ny * side * (bulge + tooth)];
    };
    for (let j = 0; j <= 10; j++) pts.push(q(j / 10, -1));
    for (let j = 10; j >= 0; j--) pts.push(q(j / 10, 1));
  }
  ctx.save();
  if (shadow) { ctx.filter = 'blur(2.5px)'; ctx.fillStyle = '#000'; }
  else {
    const g = ctx.createRadialGradient(cx, cy - 4, 2, cx, cy, R);
    g.addColorStop(0, '#fffbe8'); g.addColorStop(0.6, '#f2ece2'); g.addColorStop(1, '#cfc6bc');
    ctx.fillStyle = g;
  }
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.closePath(); ctx.fill();
  if (!shadow) {
    ctx.strokeStyle = 'rgba(120,90,70,0.45)'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
    for (const lb of lobes) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(lb.a) * lb.L * 0.88, cy + Math.sin(lb.a) * lb.L * 0.88); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(110,80,60,0.8)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(cx + 2, cy + 14, cx - 1, cy + 30); ctx.stroke();
    // a little shading on one half: the leaf is never quite flat
    ctx.globalCompositeOperation = 'source-atop';
    const sg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    sg.addColorStop(0, 'rgba(255,255,255,0.15)'); sg.addColorStop(1, 'rgba(60,40,30,0.18)');
    ctx.fillStyle = sg; ctx.fillRect(ox, oy, CELL, CELL);
  } else {
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 29); ctx.stroke();
  }
  ctx.restore();
}
function paintPetal(ctx, ox, oy, rnd, shadow) {
  const cx = ox + 32, cy = oy + 32, L = 44 + rnd() * 6, Wd = 24 + rnd() * 5, notch = 5 + rnd() * 4;
  ctx.save();
  ctx.translate(cx, cy + L * 0.5);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-Wd * 0.9, -L * 0.25, -Wd * 1.05, -L * 0.85, -Wd * 0.35, -L);
  ctx.quadraticCurveTo(-2, -L, 0, -L + notch);
  ctx.quadraticCurveTo(2, -L, Wd * 0.35, -L);
  ctx.bezierCurveTo(Wd * 1.05, -L * 0.85, Wd * 0.9, -L * 0.25, 0, 0);
  ctx.closePath();
  if (shadow) { ctx.filter = 'blur(2.5px)'; ctx.fillStyle = '#000'; ctx.fill(); }
  else {
    const g = ctx.createLinearGradient(0, 0, 0, -L);
    g.addColorStop(0, '#f6d8dc'); g.addColorStop(0.35, '#fff4f5'); g.addColorStop(1, '#fffafa');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(200,130,150,0.35)'; ctx.lineWidth = 0.7;
    for (const k of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(0, -1); ctx.quadraticCurveTo(k * Wd * 0.5, -L * 0.5, k * Wd * 0.6, -L * 0.85); ctx.stroke(); }
  }
  ctx.restore();
}
function paintFlake(ctx, ox, oy, shadow) {
  const cx = ox + 32, cy = oy + 32;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 29);
  if (shadow) { g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)'); }
  else { g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(246,249,255,0.95)'); g.addColorStop(0.62, 'rgba(176,190,214,0.55)'); g.addColorStop(1, 'rgba(170,186,214,0)'); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 29, 0, Math.PI * 2); ctx.fill();
}
const atlas = makeAtlas(512, 256, ctx => {
  const rnd = mulberry32(4242);
  for (let i = 0; i < 5; i++) { const r0 = rnd() * 1e9 | 0; paintMaple(ctx, i * CELL, 0, mulberry32(r0), false); paintMaple(ctx, i * CELL, CELL, mulberry32(r0), true); }
  for (let i = 0; i < 3; i++) { const r0 = rnd() * 1e9 | 0; paintPetal(ctx, (5 + i) * CELL, 0, mulberry32(r0), false); paintPetal(ctx, (5 + i) * CELL, CELL, mulberry32(r0), true); }
  paintFlake(ctx, 0, 2 * CELL, false); paintFlake(ctx, CELL, 2 * CELL, true);
});
let SL = null;
function defFrames() {
  FR.maple = [], FR.mapleSh = [], FR.petal = [], FR.petalSh = [];
  for (let i = 0; i < 5; i++) { FR.maple.push(SL.def(i * CELL, 0, CELL, CELL)); FR.mapleSh.push(SL.def(i * CELL, CELL, CELL, CELL)); }
  for (let i = 0; i < 3; i++) { FR.petal.push(SL.def((5 + i) * CELL, 0, CELL, CELL)); FR.petalSh.push(SL.def((5 + i) * CELL, CELL, CELL, CELL)); }
  FR.flake = SL.def(0, 2 * CELL, CELL, CELL); FR.flakeSh = SL.def(CELL, 2 * CELL, CELL, CELL);
}
// per season: what falls, how many in the air / resting at amount 1, size (px), fall time (s), how long it rests (s)
const FALL = [
  { kind: 'petal', air: 14, rest: 70, size: [16, 22], T: [7, 12], life: [50, 110], cols: [[1.0, 0.80, 0.85], [1.0, 0.88, 0.90], [0.98, 0.74, 0.80], [1.0, 0.93, 0.94]] },
  { kind: 'maple', air: 2, rest: 7, size: [22, 30], T: [7, 10], life: [80, 160], cols: [[0.42, 0.62, 0.20], [0.55, 0.68, 0.24], [0.34, 0.52, 0.16]] },
  { kind: 'maple', air: 7, rest: 46, size: [22, 34], T: [7, 11], life: [70, 160], cols: [[0.80, 0.12, 0.07], [0.88, 0.22, 0.07], [0.72, 0.07, 0.09], [0.93, 0.42, 0.09], [0.95, 0.64, 0.16], [0.82, 0.16, 0.10]] },
  { kind: 'flake', air: 150, rest: 0, size: [5, 9], T: [6, 10], life: [1.5, 3.5], cols: [[1, 1, 1]] },
];
const Leaves = {
  list: [], rnd: mulberry32(1), wind: [16, 5], spawnAcc: 0,
  reset() { this.list = []; this.rnd = mulberry32(seed * 13 + 1); this.seeded = false; this.fadeIn = false; },
  cfg() { return FALL[clamp(Math.round(P.season), 0, 3)]; },
  free(x, y, m) { return x > 6 && x < W - 6 && y > 6 && y < H - TASKBAR - 6 && iconDist(x, y) > m; },
  // a new leaf: pick where it lands (clear of icons), then fly it backward along the wind so its whole path stays clear
  make(resting) {
    const c = this.cfg(), r = this.rnd;
    const T = lerp(c.T[0], c.T[1], r());
    for (let tries = 0; tries < 24; tries++) {
      const lx = r() * W, ly = r() * (H - TASKBAR);
      if (!this.free(lx, ly, c.kind === 'flake' ? 6 : 22)) continue;
      const sway = 10 + r() * 22, w = 2 * Math.PI / (2.6 + r() * 2.4);
      const L = { lx, ly, T, t: resting ? T : r() * T * 0.2, sway, w, ph: r() * 6.28, kind: c.kind,
        f: (r() * (c.kind === 'maple' ? 5 : c.kind === 'petal' ? 3 : 1)) | 0, size: lerp(c.size[0], c.size[1], r()),
        col: c.cols[(r() * c.cols.length) | 0], rot0: r() * 6.28, spin: (r() - 0.5) * 2.4, flip: 1.2 + r() * 2.2, fph: r() * 6.28,
        life: lerp(c.life[0], c.life[1], r()), age: resting ? r() * 0.7 : 0, fade: 1, fi: this.fadeIn ? 0 : 1, dying: false, land: 0.75 + 0.25 * r() };
      L.age *= L.life;
      let ok = true;
      for (let k = 1; k <= 5 && ok && c.kind !== 'flake'; k++) { const q = this.pos(L, L.T * (1 - k / 5)); if (!this.free(q[0], q[1], 14)) ok = false; }
      if (ok || resting) return L;
    }
    return null;
  },
  pos(L, t) {
    const back = L.T - t, damp = back / L.T;
    return [L.lx - this.wind[0] * back + Math.sin(L.w * t + L.ph) * L.sway * damp, L.ly - this.wind[1] * back + Math.cos(L.w * 0.7 * t + L.ph) * L.sway * 0.5 * damp];
  },
  step(dt) {
    const c = this.cfg(), amt = P.leaves;
    if (this.kind !== c.kind) {                       // season changed: the old ones fade, the new ones are already there
      if (this.kind) { this.seeded = false; this.fadeIn = frameN > 30; for (const L of this.list) if (frameN <= 30) L.fade = 0; }
      this.kind = c.kind;
    }
    if (!this.seeded && W > 0 && CLR.gw > 1) {       // the garden already has some leaves when it appears
      this.seeded = true;
      const nr = Math.round(c.rest * amt * 0.7), na = Math.round(c.air * amt);
      for (let i = 0; i < nr; i++) { const L = this.make(true); if (L) this.list.push(L); }
      for (let i = 0; i < na; i++) { const L = this.make(false); if (L) { L.t = this.rnd() * L.T * 0.9; this.list.push(L); } }
    }
    let air = 0, rest = 0;
    for (const L of this.list) { if (L.kind !== c.kind) L.dying = true; if (L.t < L.T) air++; else rest++; }
    this.spawnAcc += dt * c.air * amt / ((c.T[0] + c.T[1]) / 2);
    while (this.spawnAcc >= 1) { this.spawnAcc -= 1; if (air < c.air * amt * 1.3) { const L = this.make(false); if (L) { this.list.push(L); air++; } } }
    // too many resting: the oldest begin to fade
    let excess = rest - Math.round(c.rest * amt);
    for (const L of this.list) {
      if (L.t < L.T) { L.t = Math.min(L.T, L.t + dt); continue; }
      L.age += dt;
      if (L.age > L.life || (excess > 0 && L.age > L.life * 0.4)) { if (!L.dying) excess--; L.dying = true; }
    }
    for (const L of this.list) { if (L.dying) L.fade -= dt / (L.kind === 'flake' ? 1.2 : 3.5); L.fi = Math.min(1, L.fi + dt / 2.5); }
    this.list = this.list.filter(L => L.fade > 0);
  },
  // icons moved: anything that now lies under an icon is swept away quickly
  layout() { for (const L of this.list) if (L.t >= L.T && iconDist(L.lx, L.ly) < 18) { L.dying = true; L.fade = Math.min(L.fade, 0.6); } },
  draw() {
    const e = cur.elev, cot = Math.min(Math.sqrt(1 - e * e) / e, 3), dl = Math.hypot(cur.dir[0], cur.dir[1]) || 1;
    const sx = -cur.dir[0] / dl * cot, sy = -cur.dir[1] / dl * cot;   // shadows fall away from the sun
    const tint = cur.sprite, shA = 0.30 * clamp(1.15 - e * 0.4, 0.5, 1) * (cur.sun[0] + cur.sun[1]) / 1.2;
    const bodies = [];
    for (const L of this.list) {
      const z = clamp(1 - L.t / L.T, 0, 1), zz = z * z * (3 - 2 * z) * 0;
      const [x, y] = L.t < L.T ? this.pos(L, L.t) : [L.lx, L.ly];
      const hgt = z * 70 + 1.2;                          // height above the gravel (px)
      const air = L.t < L.T;
      const flip = air ? Math.cos(L.flip * L.t + L.fph) : L.land;
      const rot = L.rot0 + L.spin * Math.min(L.t, L.T);
      const sc = 1 + z * (L.kind === 'flake' ? 0.9 : 0.22);
      const w = L.size * sc * (L.kind === 'flake' ? 1 : 0.3 + 0.7 * Math.abs(flip)), h = L.size * sc;
      let a = L.fade * L.fi * (air ? ss01(L.t / 1.5) * ss01((iconDist(x, y) - 2) / 14) : 1);
      if (L.kind === 'flake' && !air) a *= clamp(1 - L.age / L.life, 0, 1);
      if (a <= 0.01) continue;
      const fr = L.kind === 'maple' ? FR.maple[L.f] : L.kind === 'petal' ? FR.petal[L.f] : FR.flake;
      const fs = L.kind === 'maple' ? FR.mapleSh[L.f] : L.kind === 'petal' ? FR.petalSh[L.f] : FR.flakeSh;
      const blur = 1 + z * 0.6;
      SL.add(fs, x + sx * hgt, y + sy * hgt, w * blur, h * blur, { rot, alpha: a * shA * (1 - 0.55 * z) * (L.kind === 'flake' ? 1.4 : 1) });
      bodies.push([fr, x, y, w, h, rot, a, flip < 0 ? 0.78 : 1, L.col]);
    }
    for (const b of bodies) SL.add(b[0], b[1], b[2], b[3], b[4], { rot: b[5], alpha: b[6], shade: b[7], tint: [b[8][0] * tint[0], b[8][1] * tint[1], b[8][2] * tint[2]] });
    SL.draw();
  },
};
const ss01 = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/* ---------- boot ---------- */
boot({
  defaults: { sigma: 50, spacing: 13, rings: 5, moss: 0.5, season: 2, light: 0, leaves: 0.5 },
  fs: MAIN_FS,
  init() {
    GP = program(FS_HEAD + (QS.get('off') || '').split(',').filter(Boolean).map(k => '#define OFF_' + k + '\n').join('') + GARDEN_FS);
    SL = new SpriteLayer(atlas.canvas, 1024);
    defFrames();
    onSeedChange();
    stepPal(0);
  },
  onSeed() { onSeedChange(); },
  onLayout(fromEmpty) {
    cacheOK = false; Leaves.layout(); placePhantoms();
    if (fromEmpty) PH.pres = activeIcons().length ? 0 : 1;
  },
  step(dt) {
    palMoving = stepPal(dt);
    const want = activeIcons().length ? 0 : 1;
    if (PH.pres !== want) { PH.pres = clamp(PH.pres + (want ? dt / 2.4 : -dt / 1.2), 0, 1); palMoving = true; }
    Leaves.step(dt);
  },
  uniforms(U, now) {
    ensureCache();
    if (!cacheOK || cacheMix !== curMix || palMoving || FORCE_STATIC) renderGarden(now);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, cacheTex); gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U.uCache, 4);
    gl.uniform4f(U.uCl, -flowT * 9, -flowT * 3.2, cur.cloud, 0);
    gl.uniform3f(U.uClT, 0.80, 0.84, 0.92);
  },
  after() { Leaves.draw(); },
});
// settings changes that only affect the cached layer
{
  const prev = {};
  const watch = () => { for (const k of ['spacing', 'rings', 'moss', 'sigma']) if (prev[k] !== P[k]) { prev[k] = P[k]; cacheOK = false; } requestAnimationFrame(watch); };
  watch();
}
// debug/test queries (browser demo only): ?layout=0|1|2, any param by name (e.g. ?season=3&light=2), ?seed=123
if (!(WALL || PREVIEW)) setTimeout(() => {
  const v = {};
  for (const k in DEFAULTS) if (QS.has(k)) v[k] = +QS.get(k);
  if (QS.has('seed')) v.seed = +QS.get('seed');
  if (QS.has('layout')) { const L = +QS.get('layout'); if (L < 0) { icons.forEach(ic => ic.el.remove()); icons = []; commit(true); } else demoApply(L); }
  applySettings(v);
}, 0);
if (QS.has('atlas')) { const c = atlas.canvas; c.style.cssText = 'position:fixed;left:0;top:0;z-index:98;background:#556;width:1024px'; document.body.appendChild(c); }
// ?gbench: time one redraw of the cached garden layer (worst case: what every frame costs while icons are moving)
if (QS.has('gbench')) setTimeout(() => {
  const px = new Uint8Array(4), ts = [];
  for (let i = 0; i < 5; i++) { const a = performance.now(); cacheOK = false; draw(performance.now()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - a); }
  ts.sort((a, b) => a - b);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;left:0;top:0;z-index:99;background:#fff;font-size:20px">garden redraw ${ts[2].toFixed(1)} ms  ${cv.width}x${cv.height}</pre>`);
}, 1500);
