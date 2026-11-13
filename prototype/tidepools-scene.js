// Deskland · Tidepools: the rocky intertidal off Monterey Bay, seen from above.
// Two materials and the boundary between them:
//   - rock: a heightfield of tilted granite ledges with pools in them. Each icon group rises out of it as a tall,
//     dry granite plateau that casts a shadow, so the icon rocks always read as the highest ground.
//   - sea: clear green Pacific water. The bottom shows through, darker and bluer with depth.
//   - the waterline (the star): foam lace where the sea meets the rock. Wave surges roll in from the ocean side, wash up
//     over the low rocks, leave them wet and foamy, and drain away.
// The sea level follows the real Monterey tide (NOAA station 9413450, computed offline from its harmonic constants),
// or a fixed low or mid tide. The rock carries the real zonation at fixed heights (surfgrass and pink coralline low,
// then rockweed, mussels, barnacles and bare granite), so a falling tide exposes the bands the way it does on the shore.
// Very few movers: anemones and ochre sea stars (fixed), hermit crabs, small schools of minnows, a few gulls that
// sometimes land, and now and then a sea otter or a sea lion. Double-click drops a pebble in the water (or a splash on rock).
// Everything is one full-screen pass plus a few sprites.
(function () {
  'use strict';
  const ID = 'tidepools';
  const TAU = Math.PI * 2;
  const NW = 4;                          // wave surges the shader can show at once
  const NS = 6;                          // double-click splashes the shader can show at once
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mixf = (a, b, t) => a + (b - a) * t;
  const ease = (c, t, rate, dt) => c + (t - c) * (1 - Math.exp(-rate * dt));
  const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return mixf(b, a, h) - k * h * (1 - h); };
  const smax = (a, b, k) => -smin(-a, -b, k);
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  /* ---------------- Monterey tide ----------------
     Height of the sea in metres above mean lower low water (MLLW), from NOAA's harmonic constants for Monterey
     (station 9413450, 5-year vector average 2012-2016). Mean sea level is 0.862 m above MLLW. The astronomical
     arguments and nodal corrections follow Schureman. Checked against NOAA's published predictions for
     November 2026 and June 2027: highs and lows agree within about 2 cm and a few minutes. */
  const TIDE_Z0 = 0.862, DEG = Math.PI / 180;
  // name, amplitude (m), Greenwich phase (deg), V = a*T + b*s + c*h + d*p + e*p1 + const, nodal group
  const TIDE_C = [
    [.491, 181.3, [2, -2, 2, 0, 0, 0], 'M2'], [.130, 180.1, [2, 0, 0, 0, 0, 0], ''], [.112, 155.0, [2, -3, 2, 1, 0, 0], 'M2'],
    [.037, 170.6, [2, 0, 2, 0, 0, 0], 'K2'], [.022, 160.9, [2, -3, 4, -1, 0, 0], 'M2'], [.013, 114.7, [2, -4, 4, 0, 0, 0], 'M2'],
    [.014, 125.4, [2, -4, 2, 2, 0, 0], 'M2'], [.007, 165.3, [2, 0, -1, 0, 1, 0], ''],
    [.366, 219.6, [1, 0, 1, 0, 0, -90], 'K1'], [.229, 203.5, [1, -2, 1, 0, 0, 90], 'O1'], [.115, 215.8, [1, 0, -1, 0, 0, 90], ''],
    [.041, 194.8, [1, -3, 1, 1, 0, 90], 'O1'], [.022, 232.3, [1, 1, 1, -1, 0, -90], 'J1'], [.011, 246.4, [1, 2, 1, 0, 0, -90], 'OO1'],
    [.007, 197.0, [1, -3, 3, -1, 0, 90], 'O1'], [.005, 191.7, [1, -4, 1, 2, 0, 90], 'O1'],
    [.062, 198.5, [0, 0, 1, 0, 0, 0], ''], [.020, 264.6, [0, 0, 2, 0, 0, 0], ''], [.011, 138.1, [0, 2, 0, 0, 0, 0], 'MF']
  ];
  function nodal(g, N) {
    const c = Math.cos(N), c2 = Math.cos(2 * N), c3 = Math.cos(3 * N), s = Math.sin(N), s2 = Math.sin(2 * N), s3 = Math.sin(3 * N);
    switch (g) {
      case 'M2': return [1.0004 - .0373 * c + .0002 * c2, -2.14 * s];
      case 'K2': return [1.0241 + .2863 * c + .0083 * c2 - .0015 * c3, -17.74 * s + .68 * s2 - .04 * s3];
      case 'K1': return [1.0060 + .1150 * c - .0088 * c2 + .0006 * c3, -8.86 * s + .68 * s2 - .07 * s3];
      case 'O1': return [1.0089 + .1871 * c - .0147 * c2 + .0014 * c3, 10.80 * s - 1.34 * s2 + .19 * s3];
      case 'J1': return [1.0129 + .1676 * c - .0170 * c2 + .0016 * c3, -12.94 * s + 1.34 * s2 - .19 * s3];
      case 'OO1': return [1.1027 + .6504 * c + .0317 * c2 - .0014 * c3, -36.68 * s + 4.02 * s2 - .57 * s3];
      case 'MF': return [1.043 + .414 * c, -23.74 * s + 2.68 * s2 - .38 * s3];
      default: return [1, 0];
    }
  }
  function montereyTide(ms) {
    const T = (ms / 86400000 + 2440587.5 - 2451545) / 36525;
    const s = 218.3164 + 481267.8812 * T, h = 280.4661 + 36000.7698 * T, p = 83.3535 + 4069.0137 * T;
    const N = (125.0445 - 1934.1363 * T) * DEG, p1 = 282.9384 + 1.7195 * T;
    const Th = 180 + 15 * (((ms / 3600000) % 24) + 24) % 24;
    let z = TIDE_Z0;
    for (const [A, G, k, g] of TIDE_C) {
      const [f, u] = nodal(g, N);
      z += f * A * Math.cos((k[0] * Th + k[1] * s + k[2] * h + k[3] * p + k[4] * p1 + k[5] + u - G) * DEG);
    }
    return z;
  }
  window.montereyTide = montereyTide;   // for checking in the console

  /* ---------------- the surface ---------------- */
  const MAIN_FS = `
uniform sampler2D uGround;   // R: rock height without the icon plateaus (m above MLLW), G: tidepool basin depth (m); same grid as the icon field
uniform float uTide;         // still sea level (m above MLLW)
uniform vec2 uDir;           // unit vector pointing inland, away from the open sea: waves travel along it
uniform vec4 uWave[${NW}];   // wave surges: front position along uDir (px), height (m), tail length (px), unused
uniform vec4 uSpl[${NS}];    // double-click splashes: x, y, age (s), kind (1 = pebble in water, 2 = spray on rock, 0 = none); each draws ripples on water and a wet patch on rock
const float ZX = 46.;        // px per metre: how steep the rock looks to the light

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
// The composite applies ACES; colours here are authored as display values, so undo it at the end
vec3 invAces(vec3 y) { y = clamp(y, 0., .96); vec3 a = 2.51 - 2.43 * y, b = .03 - .59 * y, c = -.14 * y; return (-b + sqrt(b * b - 4. * a * c)) / (2. * a); }
float relief(vec2 p) { return gnoise(p * .045) * .08; }
// Rock height: the ground from the CPU grid, raised into a tall flat plateau under each icon group
float hgt(vec2 p, vec2 w, out float m, out float pool) {
  vec2 g = texture(uGround, fieldUV(p)).rg;
  float b = iconBlob(p + w);
  m = smoothstep(9., -9., b) * uIntro;
  pool = g.y * (1. - m);
  return smax(g.x, mix(-.8, 2.9 + w.x * .006, m), .3);
}
void main() {
  vec2 p = cssPos();
  float t = uFlow;
  float grain = hash12(floor(gl_FragCoord.xy)) - .5;
  vec2 w = vec2(gnoise(p * .007 + 1.7), gnoise(p * .007 + 5.3)) * 18. + vec2(gnoise(p * .028 + 9.), gnoise(p * .028 + 2.)) * 6.;
  float m, pool, m1, q1;
  float H0 = hgt(p, w, m, pool);
  const float e = 3.;
  // fine relief (ragged waterline, knobbly rock), also fed into the shading slope
  float fd = relief(p), fdx = relief(p + vec2(e, 0.)) - fd, fdy = relief(p + vec2(0., e)) - fd;
  float hx = hgt(p + vec2(e, 0.), w, m1, q1) - H0 + fdx * (1. - m), hy = hgt(p + vec2(0., e), w, m1, q1) - H0 + fdy * (1. - m);
  vec3 n = normalize(vec3(-hx / e * ZX, -hy / e * ZX, 1.));
  vec3 Ld = normalize(vec3(-.55, -.65, .75));                 // sun from the upper left
  float dif = clamp(dot(n, Ld) / Ld.z, 0., 1.7);
  float H = H0 + fd * (1. - m * .8);
  float dI = iconDist(p);
  float calm = smoothstep(0., 34., dI);

  // shadows toward the lower right: the icon plateaus (tall) and the higher ledges (short)
  vec2 so = vec2(20., 25.);
  float shP = clamp(smoothstep(16., -12., iconBlob(p - so + w)) * uIntro - m, 0., 1.);
  float gs = texture(uGround, fieldUV(p - so * .55)).r;
  float shG = clamp((gs - H0) * .55, 0., 1.) * (1. - m);
  float shade = 1. - .5 * shP - .22 * shG;
  // the icon rock's top is a low dome: lit toward the sun, darker away from it (sampled wide, so the field grid never shows)
  if (m > .01) {
    vec2 lo = vec2(-.55, -.65) * 22.;
    float dome = clamp((iconBlob(p + w - lo) - iconBlob(p + w + lo)) / 44., -1., 1.) * smoothstep(-10., -40., iconBlob(p + w));
    shade *= 1. + .1 * dome * m;
  }

  // waves: surges roll in along uDir; the front is bent by a slow noise so it arrives unevenly
  float s = dot(p, uDir) + gnoise(p * .0032 + 2.) * 80. + gnoise(p * .011 + 5.) * 24.;
  float surge = 0., front = 0., trail = 0., wetW = 0.;
  for (int k = 0; k < ${NW}; k++) {
    vec4 Wv = uWave[k];
    if (Wv.y <= 0.) continue;
    float beh = Wv.x - s;
    if (beh < -70.) continue;
    float fall = exp(-max(beh, 0.) / Wv.z);
    surge += Wv.y * smoothstep(-70., 0., beh) * fall;
    front += Wv.y * exp(-pow(beh / 15., 2.));
    trail += Wv.y * smoothstep(-6., 8., beh) * exp(-max(beh, 0.) / 90.);
    // rock this wave reached stays wet and foamy while the water drains off it
    wetW = max(wetW, smoothstep(uTide + Wv.y + .05, uTide + Wv.y * .2, H) * smoothstep(0., 40., beh) * exp(-beh / (Wv.z * 3.)));
  }
  float swell = .03 * sin(s * .024 - t * 1.25) + .02 * gnoise(p * .008 + vec2(t * .12, 0.));
  float L = uTide + surge + swell;
  float dSea = L - H, dPool = pool - .05 - fd * .5;
  float depth = max(dSea, dPool), isSea = smoothstep(-.01, .01, dSea - dPool);

  // splashes on rock: a wet patch that dries
  float wetS = 0., fizz = 0.;
  for (int k = 0; k < ${NS}; k++) {
    vec4 S = uSpl[k];
    if (S.w <= 0.) continue;
    float d = length(p - S.xy);
    wetS = max(wetS, exp(-pow(d / (24. + S.z * 5.), 2.)) * exp(-S.z / 4.));
    fizz = max(fizz, exp(-pow(d / (16. + S.z * 14.), 2.)) * exp(-S.z * .9));
  }

  // rock: zonation by height, ragged at the edges
  float zn = gnoise(p * .018) * .28 + gnoise(p * .055) * .1;
  float hz = H + zn;
  mat2 rq = mat2(.8, .6, -.6, .8);
  float pat = gnoise(rq * p * .022 + 7.) + .5 * gnoise(rq * p * .06 + 2.);
  float sp = hash12(floor(p * 1.4));
  vec3 sand = lin(vec3(.55, .52, .43));
  vec3 lowc = mix(lin(vec3(.62, .45, .46)), lin(vec3(.30, .44, .25)), smoothstep(-.1, .2, pat));   // pink coralline, surfgrass
  vec3 weed = lin(vec3(.42, .37, .26));
  vec3 mus = lin(vec3(.26, .26, .29)) * (.9 + .3 * step(.9, sp));
  vec3 barn = lin(vec3(.56, .54, .50)) * (.94 + .12 * sp);
  vec3 gran = lin(vec3(.53, .49, .44));
  vec3 top = lin(vec3(.58, .54, .49)) * (1. + .06 * gnoise(p * .02));
  vec3 rc = mix(sand, lowc, smoothstep(-.75, -.45, hz));
  rc = mix(rc, weed, smoothstep(.1, .4, hz));
  rc = mix(rc, mus, smoothstep(.7, .9, hz) * (1. - smoothstep(1.2, 1.4, hz)) * smoothstep(.0, .25, pat) * .8);
  rc = mix(rc, barn, smoothstep(1.2, 1.5, hz));
  rc = mix(rc, gran, smoothstep(1.8, 2.1, hz));
  rc = mix(rc, top, m);
  float hiR = smoothstep(.0, .2, hz) * (1. - m * (1. - .6 * smoothstep(40., 90., dI)));
  if (hiR > .01 && H > uTide - 1.2) {   // joints in the granite (not worth drawing under deep water)
    vec4 jv = voronoi(rq * p * .016 + w * .045);
    rc *= 1. - .13 * smoothstep(.06, .0, jv.y - jv.x) * hiR;
  }
  // orange lichen on the dry splash zone and the icon rock rims, never near the labels
  float lz = smoothstep(1.9, 2.3, hz) * smoothstep(30., 70., dI);
  if (lz > .01) rc = mix(rc, lin(vec3(.74, .52, .26)), smoothstep(.42, .6, gnoise(p * .045 + 11.) + .35 * gnoise(p * .13)) * lz * .55);
  rc *= 1. + grain * .07 * mix(.4, 1., calm);
  rc *= mix(.93, 1., smoothstep(0., 60., dI));                // a little darker behind the icon labels

  float wet = max(max(smoothstep(uTide + .45, uTide + .03, H) * .85, wetW), wetS);
  vec3 rock = rc * (.5 + .55 * dif) * shade;
  rock *= mix(1., .62, wet) * (1. - .45 * wetS);
  float spec = pow(clamp(dot(reflect(-Ld, n), vec3(0., 0., 1.)), 0., 1.), 20.);
  rock += vec3(.5) * spec * max(wet, wetS) * .12;

  // water: the bottom seen through it, red light lost first, dappled by caustics in the shallows
  float dc = max(depth, 0.);
  vec3 bottom = rc * (.55 + .5 * dif) * shade;
  if (depth > 0. && dc < 2.) {
    float cs = abs(gnoise(p * .03 + vec2(t * .09, t * .05))) + abs(gnoise(p * .047 - vec2(t * .06, -t * .08)));
    bottom *= 1. + pow(1. - min(cs * 1.4, 1.), 5.) * .55 * exp(-dc * 1.3);
  }
  vec3 Tr = exp(-dc * vec3(2.6, .85, .7));
  vec3 deepC = mix(lin(vec3(.11, .34, .36)), lin(vec3(.04, .21, .26)), smoothstep(.3, 2.5, dc));
  vec3 water = bottom * Tr + deepC * (1. - Tr) + lin(vec3(.6, .75, .78)) * (.025 + .1 * clamp(surge, 0., .6));   // aerated water under a surge is paler
  float wa = smoothstep(0., .015, depth);
  vec3 col = mix(rock, water, wa);

  // the waterline: foam lace, wider while a surge is running up or draining
  vec3 foamC = lin(vec3(.93, .95, .93));
  float act = clamp(surge * 3. + front * 2., 0., 1.);
  float fw = .018 + .06 * act;
  float shore = exp(-pow(dSea / fw, 2.)) * smoothstep(-.02, .02, dSea - dPool + .02);
  float inSea = smoothstep(0., .12, dSea);
  float lace = 0.;
  if (shore > .004 || (front + trail) * inSea > .004 || (wetW + fizz) * (1. - wa) > .004) {   // foam only where there is foam to draw
    vec4 vo = voronoi(p * .11 + vec2(t * .05, t * .03) + w * .03);
    float bub = smoothstep(.16, .04, vo.x) * step(.35, hash12(vo.zw));                      // round bubbles
    lace = smoothstep(.12, .02, vo.y - vo.x) * step(.45, hash12(vo.zw + 7.)) * .85 + bub * .55;   // broken foam lace
    float brk = smoothstep(-.2, .3, gnoise(p * .016 + vec2(t * .07, 0.)) + .15);          // whitewater breaks into patches
    float strk = smoothstep(.0, .45, gnoise(vec2(dot(p, uDir) * .004, dot(p, vec2(-uDir.y, uDir.x)) * .03) + t * .02));  // streaks behind it
    col = mix(col, foamC, clamp(shore * (.3 + .7 * lace) * .85, 0., 1.));
    col = mix(col, foamC, clamp(front * 2. * brk * (.3 + .7 * lace), 0., .68) * inSea);
    col = mix(col, foamC, clamp(trail * 1.1 * lace * strk * brk, 0., .45) * inSea);
    col = mix(col, foamC, clamp(wetW * .4 * lace + fizz * .7 * bub, 0., 1.) * (1. - wa));
  }
  col += lin(vec3(.7, .85, .85)) * exp(-pow(dPool / .012, 2.)) * .12 * (1. - isSea);   // a still pool's bright rim

  // pebbles in water: rings spreading on the surface
  for (int k = 0; k < ${NS}; k++) {
    vec4 S = uSpl[k];
    if (S.w <= 0.) continue;
    float d = length(p - S.xy), a = S.z;
    float ring = exp(-pow((d - a * 70.) / 2.2, 2.)) + .6 * exp(-pow((d - a * 46.) / 2., 2.)) + .35 * exp(-pow((d - a * 28.) / 1.8, 2.));
    float trough = exp(-pow((d - a * 70. + 5.) / 3., 2.));                     // a darker trough inside each crest
    col *= 1. - .12 * trough * exp(-a * 1.1) * wa;
    col = mix(col, foamC, clamp(ring * exp(-a * 1.1) * .28 * wa + exp(-pow(d / (8. + a * 22.), 2.)) * exp(-a * 3.) * (.3 + .7 * lace) * .6, 0., 1.));
  }

  col = invAces(col);
  // sun glints on open water (left above the curve so they bloom a little)
  float gk = wa * isSea * smoothstep(.15, .6, dc);
  if (gk > .01) {
    float gl = gnoise(p * .05 + vec2(t * .25, t * .1)) + gnoise(p * .09 - vec2(t * .2, -t * .3)) * .7;
    col += vec3(.9, .95, 1.) * smoothstep(.78, 1.05, gl) * gk * .5;
  }
  outColor = vec4(col, 1.);
}`;

  /* ---------------- sprites (drawn facing +x) ---------------- */
  function rnd(seedv) { let a = seedv | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }
  function ellipse(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); }
  function defineSprites(ctx) {
    const A = ctx.atlas;
    // Giant green anemone, open: many slender jade tentacles of uneven length around a pale oral disk (variant 1: pink tips)
    for (const v of [0, 1]) A.define('anem' + v, 128, 128, (g, S) => {
      const c = S / 2, r = rnd(11 + v);
      const base = v ? [70, 128, 108] : [62, 124, 96], tip = v ? [214, 160, 182] : [176, 214, 170];
      g.lineCap = 'round';
      for (let ring = 0; ring < 4; ring++) {
        const n = 34 - ring * 5, r0 = S * (0.17 + ring * 0.02), len = S * (0.27 - ring * 0.045);
        for (let i = 0; i < n; i++) {
          const a = (i + ring * 0.37 + r() * 0.5) / n * TAU, L = len * (0.75 + r() * 0.4), curl = (r() - 0.5) * 0.5;
          const x0 = c + Math.cos(a) * r0, y0 = c + Math.sin(a) * r0;
          const x1 = c + Math.cos(a + curl * 0.3) * (r0 + L), y1 = c + Math.sin(a + curl * 0.3) * (r0 + L);
          const mx = c + Math.cos(a + curl * 0.15) * (r0 + L * 0.55), my = c + Math.sin(a + curl * 0.15) * (r0 + L * 0.55);
          const gr = g.createLinearGradient(x0, y0, x1, y1), k = 0.85 + r() * 0.3;
          gr.addColorStop(0, `rgba(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0},.95)`);
          gr.addColorStop(1, `rgba(${tip[0]},${tip[1]},${tip[2]},.9)`);
          g.strokeStyle = gr; g.lineWidth = S * (0.028 - ring * 0.003);
          g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke();
        }
      }
      const gr = g.createRadialGradient(c, c, 0, c, c, S * 0.19);
      gr.addColorStop(0, '#c9cf98'); gr.addColorStop(0.75, '#93b886'); gr.addColorStop(1, 'rgba(90,140,105,.9)');
      g.fillStyle = gr; circle(g, c, c, S * 0.19); g.fill();
      g.strokeStyle = 'rgba(95,125,80,.35)'; g.lineWidth = S * 0.007;
      for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; g.beginPath(); g.moveTo(c + Math.cos(a) * S * 0.04, c + Math.sin(a) * S * 0.04); g.lineTo(c + Math.cos(a) * S * 0.18, c + Math.sin(a) * S * 0.18); g.stroke(); }
      g.fillStyle = '#6f7f4c'; ellipse(g, c, c, S * 0.03, S * 0.01, 0.6); g.fill();
    });
    // Closed anemone at low tide: a dark olive mound covered in bits of shell and gravel
    A.define('anemC', 64, 64, (g, S) => {
      const c = S / 2, r = rnd(5);
      const gr = g.createRadialGradient(c - S * 0.08, c - S * 0.08, 0, c, c, S * 0.3);
      gr.addColorStop(0, '#6d7a52'); gr.addColorStop(1, '#3f4a33');
      g.fillStyle = gr; circle(g, c, c, S * 0.3); g.fill();
      for (let i = 0; i < 26; i++) { const a = r() * TAU, d = Math.sqrt(r()) * S * 0.27; g.fillStyle = ['#d8d0bf', '#a9a091', '#efe6d6', '#8c8577'][i % 4]; circle(g, c + Math.cos(a) * d, c + Math.sin(a) * d, S * (0.015 + r() * 0.02)); g.fill(); }
      g.fillStyle = 'rgba(30,36,24,.7)'; circle(g, c, c, S * 0.035); g.fill();
    });
    // Ochre sea star (purple and orange morphs): five plump arms with a net of pale spines
    for (const [name, base, dark] of [['starP', '#6c3a78', '#4a2454'], ['starO', '#d27a34', '#a3531f']]) A.define(name, 128, 128, (g, S) => {
      const c = S / 2, r = rnd(name.length * 7 + base.length);
      const arm = [], k = 0.06 * (r() - 0.5);
      for (let i = 0; i <= 200; i++) {
        const a = i / 200 * TAU, q = Math.abs(Math.cos(a * 2.5));
        const rr = S * (0.15 + 0.29 * Math.pow(q, 1.6)) * (1 + k * Math.sin(a * 3));
        arm.push([c + Math.cos(a - Math.PI / 2) * rr, c + Math.sin(a - Math.PI / 2) * rr]);
      }
      const path = () => { g.beginPath(); arm.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); };
      g.fillStyle = 'rgba(0,0,0,.35)'; g.save(); g.translate(S * 0.02, S * 0.025); path(); g.fill(); g.restore();
      const gr = g.createRadialGradient(c, c, 0, c, c, S * 0.44);
      gr.addColorStop(0, base); gr.addColorStop(1, dark);
      g.fillStyle = gr; path(); g.fill();
      g.save(); path(); g.clip();
      for (let i = 0; i < 260; i++) { const x = r() * S, y = r() * S; g.fillStyle = r() < 0.7 ? 'rgba(235,225,240,.55)' : 'rgba(30,10,30,.25)'; circle(g, x, y, S * (0.006 + r() * 0.008)); g.fill(); }
      g.restore();
    });
    // Hermit crab in a black turban snail shell, legs and claws poking out at the front (+x). Two walking frames.
    for (const f of [0, 1]) A.define('crab' + f, 64, 64, (g, S) => {
      const c = S / 2;
      g.strokeStyle = '#c4553a'; g.lineCap = 'round'; g.lineWidth = S * 0.045;
      for (const side of [-1, 1]) for (let i = 0; i < 2; i++) {
        const sw = (f ? 1 : -1) * (i ? 1 : -1) * 0.12, a = side * (0.9 + i * 0.5) + sw;
        g.beginPath(); g.moveTo(c + S * 0.12, c + side * S * 0.06); g.lineTo(c + S * 0.12 + Math.cos(a) * S * 0.22, c + Math.sin(a) * S * 0.22 + side * S * 0.04); g.stroke();
      }
      g.fillStyle = '#d4643f'; ellipse(g, c + S * 0.3, c - S * 0.06, S * 0.07, S * 0.05, -0.3); g.fill(); ellipse(g, c + S * 0.29, c + S * 0.07, S * 0.055, S * 0.04, 0.3); g.fill();
      g.strokeStyle = 'rgba(80,120,170,.8)'; g.lineWidth = S * 0.015;
      g.beginPath(); g.moveTo(c + S * 0.24, c - S * 0.02); g.lineTo(c + S * 0.44, c - S * 0.12); g.moveTo(c + S * 0.24, c + S * 0.02); g.lineTo(c + S * 0.44, c + S * 0.1); g.stroke();
      const gr = g.createRadialGradient(c - S * 0.06, c - S * 0.05, 0, c - S * 0.02, c, S * 0.24);
      gr.addColorStop(0, '#5a4b40'); gr.addColorStop(1, '#231c18');
      g.fillStyle = gr; circle(g, c - S * 0.03, c, S * 0.22); g.fill();
      g.strokeStyle = 'rgba(190,170,150,.45)'; g.lineWidth = S * 0.02; g.beginPath();
      for (let i = 0; i <= 60; i++) { const a = i / 60 * TAU * 2.2, rr = S * (0.19 - i / 60 * 0.16); const x = c - S * 0.03 + Math.cos(a) * rr, y = c + Math.sin(a) * rr; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      g.fillStyle = '#d9cbb4'; circle(g, c - S * 0.03, c, S * 0.025); g.fill();
    });
    // Minnow (tidepool sculpin): slender olive fish, translucent fins. Three tail frames.
    for (const f of [0, 1, 2]) A.define('fish' + f, 64, 24, (g, Wd, Hd) => {
      const c = Hd / 2, bend = [-1, 0, 1][f] * Hd * 0.12;
      g.fillStyle = 'rgba(150,165,140,.55)';
      g.beginPath(); g.moveTo(Wd * 0.16, c + bend * 0.6); g.lineTo(Wd * 0.02, c - Hd * 0.26 + bend); g.lineTo(Wd * 0.02, c + Hd * 0.26 + bend); g.closePath(); g.fill();
      const gr = g.createLinearGradient(0, c - Hd * 0.25, 0, c + Hd * 0.25);
      gr.addColorStop(0, '#4f5a45'); gr.addColorStop(0.5, '#8d977c'); gr.addColorStop(1, '#5f6a52');
      g.fillStyle = gr; g.beginPath();
      g.moveTo(Wd * 0.14, c + bend * 0.5);
      g.quadraticCurveTo(Wd * 0.45, c - Hd * 0.3, Wd * 0.88, c - Hd * 0.08);
      g.quadraticCurveTo(Wd * 0.97, c, Wd * 0.88, c + Hd * 0.08);
      g.quadraticCurveTo(Wd * 0.45, c + Hd * 0.3, Wd * 0.14, c + bend * 0.5);
      g.fill();
      g.fillStyle = 'rgba(160,175,150,.4)'; ellipse(g, Wd * 0.6, c - Hd * 0.22, Wd * 0.08, Hd * 0.1, 0.5); g.fill(); ellipse(g, Wd * 0.6, c + Hd * 0.22, Wd * 0.08, Hd * 0.1, -0.5); g.fill();
      g.fillStyle = '#1d2219'; circle(g, Wd * 0.82, c - Hd * 0.07, Hd * 0.045); g.fill(); circle(g, Wd * 0.82, c + Hd * 0.07, Hd * 0.045); g.fill();
    });
    // Western gull from above: white body and head, slate-grey wings with black tips and white mirrors. Frames: wing span.
    const SPANS = [1, 0.78, 0.5, 0.78];
    SPANS.forEach((span, f) => A.define('gull' + f, 128, 128, (g, S) => {
      const c = S / 2;
      for (const side of [-1, 1]) {
        const L = S * 0.47 * span, sweep = S * 0.07;
        g.fillStyle = '#7f8893';
        g.beginPath(); g.moveTo(c + S * 0.07, c + side * S * 0.04);
        g.quadraticCurveTo(c + S * 0.1, c + side * L * 0.6, c - sweep * 0.4, c + side * L);
        g.lineTo(c - sweep, c + side * L * 0.96);
        g.quadraticCurveTo(c - S * 0.12, c + side * L * 0.5, c - S * 0.07, c + side * S * 0.04); g.closePath(); g.fill();
        g.fillStyle = '#1e2124';
        g.beginPath(); g.moveTo(c + S * 0.02, c + side * L * 0.8); g.quadraticCurveTo(c + S * 0.03, c + side * L * 0.93, c - sweep * 0.4, c + side * L);
        g.lineTo(c - sweep, c + side * L * 0.96); g.lineTo(c - S * 0.05, c + side * L * 0.8); g.closePath(); g.fill();
        g.fillStyle = '#f2f2f0'; circle(g, c - sweep * 0.55, c + side * L * 0.95, S * 0.012); g.fill();
        g.fillStyle = 'rgba(245,245,240,.9)'; g.beginPath(); g.moveTo(c - S * 0.07, c + side * S * 0.04); g.quadraticCurveTo(c - S * 0.11, c + side * L * 0.5, c - sweep, c + side * L * 0.8);
        g.lineTo(c - sweep * 1.12, c + side * L * 0.78); g.quadraticCurveTo(c - S * 0.13, c + side * L * 0.45, c - S * 0.09, c + side * S * 0.04); g.closePath(); g.fill();
      }
      g.fillStyle = '#f4f4f1';
      ellipse(g, c - S * 0.02, c, S * 0.17, S * 0.055); g.fill();
      g.beginPath(); g.moveTo(c - S * 0.16, c - S * 0.04); g.lineTo(c - S * 0.25, c - S * 0.035); g.lineTo(c - S * 0.25, c + S * 0.035); g.lineTo(c - S * 0.16, c + S * 0.04); g.closePath(); g.fill();
      circle(g, c + S * 0.16, c, S * 0.042); g.fill();
      g.fillStyle = '#e8c23a'; g.beginPath(); g.moveTo(c + S * 0.19, c - S * 0.012); g.lineTo(c + S * 0.255, c); g.lineTo(c + S * 0.19, c + S * 0.012); g.closePath(); g.fill();
      g.fillStyle = '#c8482f'; circle(g, c + S * 0.235, c, S * 0.005); g.fill();
    }));
    // Gull standing on a rock: wings folded over the back
    A.define('gullS', 64, 64, (g, S) => {
      const c = S / 2;
      g.fillStyle = '#f2f2ef'; ellipse(g, c - S * 0.02, c, S * 0.27, S * 0.12); g.fill();
      g.fillStyle = '#7f8893'; ellipse(g, c - S * 0.07, c, S * 0.22, S * 0.1); g.fill();
      g.fillStyle = '#1e2124'; g.beginPath(); g.moveTo(c - S * 0.2, c - S * 0.05); g.lineTo(c - S * 0.36, c); g.lineTo(c - S * 0.2, c + S * 0.05); g.closePath(); g.fill();
      g.fillStyle = '#f5f5f2'; circle(g, c + S * 0.2, c, S * 0.085); g.fill();
      g.fillStyle = '#e8c23a'; g.beginPath(); g.moveTo(c + S * 0.27, c - S * 0.025); g.lineTo(c + S * 0.4, c); g.lineTo(c + S * 0.27, c + S * 0.025); g.closePath(); g.fill();
    });
    // Sea otter floating on its back: dark brown body, pale grizzled head, paws folded on the chest, flat tail
    A.define('otter', 160, 80, (g, Wd, Hd) => {
      const c = Hd / 2;
      g.fillStyle = '#3f2c20'; ellipse(g, Wd * 0.17, c, Wd * 0.1, Hd * 0.11); g.fill();
      g.fillStyle = '#4a3324';
      ellipse(g, Wd * 0.28, c - Hd * 0.17, Wd * 0.06, Hd * 0.08, 0.5); g.fill(); ellipse(g, Wd * 0.28, c + Hd * 0.17, Wd * 0.06, Hd * 0.08, -0.5); g.fill();
      const gr = g.createLinearGradient(Wd * 0.2, 0, Wd * 0.8, 0);
      gr.addColorStop(0, '#5b4030'); gr.addColorStop(0.7, '#7a5a43'); gr.addColorStop(1, '#8e7259');
      g.fillStyle = gr; ellipse(g, Wd * 0.5, c, Wd * 0.29, Hd * 0.27); g.fill();
      g.fillStyle = '#cdbca3'; circle(g, Wd * 0.81, c, Hd * 0.19); g.fill();
      g.fillStyle = '#b7a68e'; ellipse(g, Wd * 0.7, c, Wd * 0.06, Hd * 0.2); g.fill();
      g.fillStyle = '#2a1d15'; circle(g, Wd * 0.89, c, Hd * 0.04); g.fill();
      g.fillStyle = '#211710'; circle(g, Wd * 0.85, c - Hd * 0.07, Hd * 0.025); g.fill(); circle(g, Wd * 0.85, c + Hd * 0.07, Hd * 0.025); g.fill();
      g.fillStyle = '#3a291e'; ellipse(g, Wd * 0.62, c - Hd * 0.08, Wd * 0.035, Hd * 0.06); g.fill(); ellipse(g, Wd * 0.62, c + Hd * 0.08, Wd * 0.035, Hd * 0.06); g.fill();
      g.fillStyle = 'rgba(255,255,255,.18)'; ellipse(g, Wd * 0.52, c - Hd * 0.1, Wd * 0.2, Hd * 0.06); g.fill();
    });
    // California sea lion swimming: a sleek dark-brown torpedo with long fore flippers
    A.define('seal', 192, 72, (g, Wd, Hd) => {
      const c = Hd / 2;
      g.fillStyle = '#2b1e17';
      g.beginPath(); g.moveTo(Wd * 0.1, c); g.lineTo(Wd * 0.02, c - Hd * 0.2); g.lineTo(Wd * 0.06, c); g.lineTo(Wd * 0.02, c + Hd * 0.2); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(Wd * 0.58, c - Hd * 0.12); g.quadraticCurveTo(Wd * 0.5, c - Hd * 0.44, Wd * 0.4, c - Hd * 0.46); g.quadraticCurveTo(Wd * 0.47, c - Hd * 0.2, Wd * 0.5, c - Hd * 0.1); g.fill();
      g.beginPath(); g.moveTo(Wd * 0.58, c + Hd * 0.12); g.quadraticCurveTo(Wd * 0.5, c + Hd * 0.44, Wd * 0.4, c + Hd * 0.46); g.quadraticCurveTo(Wd * 0.47, c + Hd * 0.2, Wd * 0.5, c + Hd * 0.1); g.fill();
      const gr = g.createLinearGradient(0, c - Hd * 0.22, 0, c + Hd * 0.22);
      gr.addColorStop(0, '#3d2b21'); gr.addColorStop(0.45, '#6a4a36'); gr.addColorStop(1, '#3a281e');
      g.fillStyle = gr; g.beginPath();
      g.moveTo(Wd * 0.08, c);
      g.quadraticCurveTo(Wd * 0.4, c - Hd * 0.3, Wd * 0.78, c - Hd * 0.17);
      g.quadraticCurveTo(Wd * 0.98, c - Hd * 0.08, Wd * 0.99, c);
      g.quadraticCurveTo(Wd * 0.98, c + Hd * 0.08, Wd * 0.78, c + Hd * 0.17);
      g.quadraticCurveTo(Wd * 0.4, c + Hd * 0.3, Wd * 0.08, c); g.fill();
      g.fillStyle = 'rgba(255,240,220,.22)'; ellipse(g, Wd * 0.55, c - Hd * 0.05, Wd * 0.3, Hd * 0.05); g.fill();
      g.fillStyle = '#120c09'; circle(g, Wd * 0.9, c - Hd * 0.07, Hd * 0.025); g.fill(); circle(g, Wd * 0.9, c + Hd * 0.07, Hd * 0.025); g.fill();
    });
    A.define('ring', 128, 128, (g, S) => { const c = S / 2; for (let k = 0; k < 4; k++) { g.strokeStyle = `rgba(255,255,255,${0.12 + k * 0.16})`; g.lineWidth = 8 - k * 2; circle(g, c, c, c - 8); g.stroke(); } });
    A.define('drop', 24, 24, (g, S) => { const c = S / 2, gr = g.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); });
  }

  /* ---------------- the ground (CPU, once per size and seed) ---------------- */
  function perlin(seedv) {
    const r = rnd(seedv), idx = Array.from({ length: 256 }, (_, i) => i), p = new Uint8Array(512);
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    for (let i = 0; i < 512; i++) p[i] = idx[i & 255];
    const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
    return (x, y) => {
      const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255;
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      const a = p[p[xi] + yi] & 7, b = p[p[xi + 1] + yi] & 7, c = p[p[xi] + yi + 1] & 7, d = p[p[xi + 1] + yi + 1] & 7;
      const ga = GX[a] * xf + GY[a] * yf, gb = GX[b] * (xf - 1) + GY[b] * yf, gc = GX[c] * xf + GY[c] * (yf - 1), gd = GX[d] * (xf - 1) + GY[d] * (yf - 1);
      return ga + u * (gb - ga) + v * (gc - ga) + u * v * (ga - gb - gc + gd);
    };
  }
  let ground = null, groundTex = null, gW = 0, gH = 0, gScreen = '';
  let dir = [-0.94, -0.34], sMin = 0, sMax = 1;
  function buildGround(ctx) {
    const Wd = ctx.W, Hd = ctx.H;
    gW = Gw; gH = Gh; gScreen = Wd + 'x' + Hd + ':' + ctx.seed;
    const r = rnd(ctx.seed * 13 + 7);
    // The open sea lies off the right side (slightly below); waves travel left and a little up
    const da = Math.PI + 0.32 + (r() - 0.5) * 0.25;
    dir = [Math.cos(da), Math.sin(da)];
    const cs = [[0, 0], [Wd, 0], [0, Hd], [Wd, Hd]].map(([x, y]) => x * dir[0] + y * dir[1]);
    sMin = Math.min(...cs); sMax = Math.max(...cs);
    const n1 = perlin(r() * 1e9), n2 = perlin(r() * 1e9), n3 = perlin(r() * 1e9), n4 = perlin(r() * 1e9), n5 = perlin(r() * 1e9), n6 = perlin(r() * 1e9), n7 = perlin(r() * 1e9);
    const ox = r() * 1000, oy = r() * 1000;
    const sa = 0.5 + (r() - 0.5) * 0.5, ca = Math.cos(sa), sn = Math.sin(sa);   // the strike of the tilted rock strata
    const data = new Float32Array(gW * gH * 2);
    for (let gy = 0; gy < gH; gy++) for (let gx = 0; gx < gW; gx++) {
      const x = gx * STEP, y = gy * STEP, u = x * ca + y * sn + ox, v = -x * sn + y * ca + oy;
      const n = n1(u / 560, v / 300) + 0.5 * n2(u / 250, v / 140) + 0.25 * n3(x / 105, y / 105) + 0.12 * n4(x / 48, y / 48);
      const o = ((x * dir[0] + y * dir[1]) - sMin) / (sMax - sMin);    // 0 on the ocean side, 1 far inland
      const ridge = 1 - Math.abs(n7(u / 650, v / 85)) * 2.2;   // long parallel ledges along the strike
      const vv = n + 0.12 * ridge + 0.04 - 0.75 * sst(0.55, 0.0, o) + 0.2 * sst(0.55, 1, o);
      const rk = sst(-0.14, 0.16, vv);
      const top = 0.25 + 1.95 * sst(0.0, 0.7, vv);
      let h = mixf(-1.7 + 0.9 * vv, top, rk);
      // tidepools: basins in the higher rock
      const pn = n5(x / 64 + 3.3, y / 64) + 0.5 * n6(x / 28, y / 28);
      const basin = 0.55 * sst(0.2, 0.36, pn) * sst(0.7, 0.98, rk) * sst(0.6, 1.0, top);
      h -= basin;
      const i = (gy * gW + gx) * 2;
      data[i] = h; data[i + 1] = basin;
    }
    ground = data;
    const gl = ctx.gl;
    if (!groundTex) groundTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, groundTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, gW, gH, 0, gl.RG, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function groundAt(x, y, k) {
    const fx = clamp(x / STEP, 0, gW - 1.001), fy = clamp(y / STEP, 0, gH - 1.001);
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, i = (iy * gW + ix) * 2 + k;
    return (ground[i] * (1 - tx) + ground[i + 2] * tx) * (1 - ty) + (ground[i + gW * 2] * (1 - tx) + ground[i + gW * 2 + 2] * tx) * ty;
  }
  // The same height the shader draws, without the fine relief and the edge warp: {h, pool, m}
  const HS = { h: 0, pool: 0, m: 0 };
  function heightAt(ctx, x, y) {
    const m = sst(9, -9, ctx.blobAt(x, y)) * ctx.intro;
    HS.m = m; HS.pool = groundAt(x, y, 1) * (1 - m);
    HS.h = smax(groundAt(x, y, 0), mixf(-0.8, 2.9, m), 0.3);
    return HS;
  }
  // Water depth at a point (m): sea or pool, negative on dry rock
  function depthAt(ctx, x, y) { const q = heightAt(ctx, x, y); return Math.max(level - q.h, q.pool - 0.05); }
  function inView(ctx, x, y, pad = 0) { return x > -pad && y > -pad && x < ctx.W + pad && y < ctx.H + pad; }

  /* ---------------- life ---------------- */
  const QS2 = new URLSearchParams(location.search);
  let C = null, R = Math.random, prog = null;
  let level = 0.6, tideCheck = 0;
  let waves = [], nextWave = 3, splashes = [], rings = [], drops = [];
  let anems = [], stars = [], crabs = [], schools = [], gulls = [], visitor = null, nextVisit = 60;
  let lastFV = -1, lastLife = -1, testsDone = false;
  const waveData = new Float32Array(NW * 4), splData = new Float32Array(NS * 4);
  const SPR = 0.74;          // the composite's ACES curve lifts mid tones; sprite colours are scaled back by about this much

  function tideTarget(P) {
    if (QS2.has('tideh')) return +QS2.get('tideh');
    if (P.tide === 0) return 0.25;
    if (P.tide === 1) return 1.0;
    const at = QS2.has('tideat') ? Date.parse(QS2.get('tideat')) : Date.now();
    return montereyTide(at);
  }
  function addRing(x, y, o = {}) { if (rings.length < 60) rings.push(Object.assign({ x, y, t: 0, life: 1.6, r0: 4, r1: 40, a: 0.28 }, o)); }

  // Fixed life: anemones (in pools and the low zone) and ochre sea stars (on rock near the water's edge)
  function findSpot(ctx, test, tries = 80) {
    for (let k = 0; k < tries; k++) {
      const x = 20 + R() * (ctx.W - 40), y = 20 + R() * (ctx.H - 60);
      if (ctx.distAt(x, y) < 34 || ctx.blobAt(x, y) < 14) continue;
      const q = heightAt(ctx, x, y);
      if (q.m > 0.02) continue;
      if (test(x, y, q)) return [x, y];
    }
    return null;
  }
  const farFrom = (list, x, y, d) => list.every(o => Math.hypot(o.x - x, o.y - y) > d);
  function fillStatics(ctx) {
    const area = ctx.W * ctx.H / (1920 * 1080), life = ctx.P.traffic;
    const wantA = Math.round((5 + 9 * life) * area), wantS = Math.round((3 + 5 * life) * area);
    let guard = 0;
    while (anems.length < wantA && guard++ < 200) {
      const inPool = R() < 0.55;
      const s = findSpot(ctx, (x, y, q) => (inPool ? q.pool > 0.14 : (q.h > -0.6 && q.h < 0.9 && q.pool < 0.05)) && farFrom(anems, x, y, 30) && farFrom(stars, x, y, 30));
      if (!s) continue;
      const big = R();
      anems.push({ x: s[0], y: s[1], s: 30 + big * big * 30, v: R() < 0.35 ? 1 : 0, rot: R() * TAU, open: 1, closeT: 0, ph: R() * 100, fade: ctx.intro < 1 ? 1 : 0 });
    }
    guard = 0;
    while (stars.length < wantS && guard++ < 200) {
      const s = findSpot(ctx, (x, y, q) => q.h > -0.3 && q.h < 1.3 && q.pool < 0.05 && farFrom(stars, x, y, 50) && farFrom(anems, x, y, 30));
      if (!s) continue;
      stars.push({ x: s[0], y: s[1], s: 30 + R() * 18, rot: R() * TAU, spin: (R() - 0.5) * 0.004, c: R() < 0.6 ? 'starP' : 'starO', fade: ctx.intro < 1 ? 1 : 0 });
    }
  }
  // Hermit crabs: amble about in shallow water and on wet rock, with long pauses
  function wetEnough(ctx, x, y) { const d = depthAt(ctx, x, y); return d > -0.25 && d < 0.7; }
  function newCrab(ctx) {
    const s = findSpot(ctx, (x, y, q) => { const d = Math.max(level - q.h, q.pool - 0.05); return d > 0.0 && d < 0.5; });
    if (!s) return null;
    return { x: s[0], y: s[1], ang: R() * TAU, walk: 0, t: 1 + R() * 4, tx: s[0], ty: s[1], fr: 0, frT: 0, a: 0, scared: 0, s: 22 + R() * 7 };
  }
  function stepCrab(ctx, c, dt) {
    c.a = Math.min(1, c.a + dt * 0.5);
    c.t -= dt;
    const d0 = depthAt(ctx, c.x, c.y);
    if (c.t <= 0) {
      if (c.walk) { c.walk = 0; c.t = 2 + R() * 7; }
      else {
        // pick a nearby spot that is wet; if the tide has left it high and dry, head down toward the water
        let best = null;
        for (let k = 0; k < 10; k++) {
          const a = R() * TAU, r = 15 + R() * 50, x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
          if (!inView(ctx, x, y, -10) || ctx.distAt(x, y) < 30) continue;
          const d = depthAt(ctx, x, y);
          if (d0 < -0.2 ? d > d0 : wetEnough(ctx, x, y)) { best = [x, y]; break; }
        }
        if (best) { c.tx = best[0]; c.ty = best[1]; c.walk = 1; c.t = 1.5 + R() * 3; }
        else c.t = 1 + R() * 3;
      }
    }
    if (c.walk) {
      const dx = c.tx - c.x, dy = c.ty - c.y, dd = Math.hypot(dx, dy);
      if (dd < 2) { c.walk = 0; c.t = 2 + R() * 6; }
      else {
        const want = Math.atan2(dy, dx);
        c.ang += clamp(angDiff(want, c.ang), -3 * dt, 3 * dt);
        const sp = (9 + c.scared * 25);
        c.x += Math.cos(c.ang) * sp * dt; c.y += Math.sin(c.ang) * sp * dt;
        c.frT += dt * (4 + c.scared * 8); if (c.frT > 1) { c.frT = 0; c.fr ^= 1; }
      }
    }
    c.scared = Math.max(0, c.scared - dt * 0.3);
  }
  // Minnows: a few small schools that hang in the deeper water and dart from place to place
  function newSchool(ctx) {
    const s = findSpot(ctx, (x, y, q) => Math.max(level - q.h, q.pool - 0.05) > 0.18, 120);
    if (!s) return null;
    const n = 3 + ((R() * 4) | 0), fish = [];
    for (let i = 0; i < n; i++) fish.push({ ox: (R() - 0.5) * 34, oy: (R() - 0.5) * 34, x: s[0] + (R() - 0.5) * 20, y: s[1] + (R() - 0.5) * 20, ang: R() * TAU, sp: 0, ph: R() * 10, s: 13 + R() * 6 });
    return { x: s[0], y: s[1], tx: s[0], ty: s[1], t: 1 + R() * 3, fish, a: 0, gone: false, dart: 0 };
  }
  function stepSchool(ctx, sc, dt) {
    sc.t -= dt;
    sc.a = sc.gone ? Math.max(0, sc.a - dt * 0.6) : Math.min(1, sc.a + dt * 0.4);
    const dHere = depthAt(ctx, sc.x, sc.y);
    if (sc.t <= 0 || dHere < 0.08) {
      const rad = dHere < 0.08 ? 260 : 110;
      let best = null, bd = -1;
      for (let k = 0; k < 14; k++) {
        const a = R() * TAU, r = 20 + R() * rad, x = sc.x + Math.cos(a) * r, y = sc.y + Math.sin(a) * r;
        if (!inView(ctx, x, y, -20)) continue;
        const d = depthAt(ctx, x, y), mid = depthAt(ctx, (x + sc.x) / 2, (y + sc.y) / 2);
        if (d > 0.18 && mid > 0.05 && d > bd) { bd = d; best = [x, y]; }
      }
      if (best) { sc.tx = best[0]; sc.ty = best[1]; sc.dart = 1; }
      else if (dHere < 0.03) sc.gone = true;
      sc.t = 2 + R() * 5;
    }
    sc.dart = Math.max(0, sc.dart - dt * 0.8);
    const k = 0.6 + sc.dart * 3;
    sc.x = ease(sc.x, sc.tx, k, dt); sc.y = ease(sc.y, sc.ty, k, dt);
    for (const f of sc.fish) {
      f.ph += dt;
      const gx = sc.x + f.ox + Math.sin(f.ph * 0.7) * 6, gy = sc.y + f.oy + Math.cos(f.ph * 0.6) * 6;
      const dx = gx - f.x, dy = gy - f.y, dd = Math.hypot(dx, dy);
      const want = Math.atan2(dy, dx), spT = clamp(dd * 2.2, 0, 160);
      if (dd > 3) f.ang += clamp(angDiff(want, f.ang), -6 * dt, 6 * dt);
      f.sp = ease(f.sp, spT, 3, dt);
      f.x += Math.cos(f.ang) * f.sp * dt; f.y += Math.sin(f.ang) * f.sp * dt;
    }
  }
  // Gulls: glide and circle overhead, flap now and then, and sometimes land on a high dry rock for a while
  function newGull(ctx, edge) {
    const g = { x: 0, y: 0, ang: 0, base: 0, sp: 70 + R() * 30, ph: R() * 100, z: 1, mode: 'fly', flapT: 0, flapNext: 2 + R() * 5, fr: 0, frT: 0, landNext: 25 + R() * 50, tx: 0, ty: 0, stay: 0 };
    if (edge) {
      const side = (R() * 4) | 0, pad = 80;
      g.x = side === 0 ? -pad : side === 1 ? ctx.W + pad : R() * ctx.W;
      g.y = side === 2 ? -pad : side === 3 ? ctx.H + pad : R() * ctx.H;
      g.ang = Math.atan2(ctx.H * (0.3 + 0.4 * R()) - g.y, ctx.W * (0.3 + 0.4 * R()) - g.x);
    } else { g.x = R() * ctx.W; g.y = R() * ctx.H; g.ang = R() * TAU; }
    g.base = g.ang;
    return g;
  }
  function landingSpot(ctx, g) {
    for (let k = 0; k < 40; k++) {
      const x = 40 + R() * (ctx.W - 80), y = 40 + R() * (ctx.H - 100);
      if (ctx.distAt(x, y) < 60) continue;
      const q = heightAt(ctx, x, y);
      if (q.m > 0.01 || q.h - level < 0.45 || q.pool > 0.02) continue;
      if (!gulls.every(o => o === g || Math.hypot(o.tx - x, o.ty - y) > 80)) continue;
      return [x, y];
    }
    return null;
  }
  function stepGull(ctx, g, dt, t) {
    g.ph += dt;
    if (g.mode === 'stand') {
      g.stay -= dt;
      if (Math.sin(g.ph * 0.4) > 0.995) g.ang += (R() - 0.5) * 1.2;   // looks around now and then
      if (g.stay <= 0 || depthAt(ctx, g.x, g.y) > -0.05) { g.mode = 'fly'; g.flapT = 2; g.sp = 40; g.landNext = 40 + R() * 60; }
      return;
    }
    if (g.mode === 'fly') {
      g.landNext -= dt;
      if (g.landNext <= 0 && inView(ctx, g.x, g.y, -100)) {
        const s = landingSpot(ctx, g);
        if (s && gulls.filter(o => o.mode !== 'fly').length < 2) { g.mode = 'land'; g.tx = s[0]; g.ty = s[1]; }
        else g.landNext = 20 + R() * 30;
      }
      let back = angDiff(g.ang, g.base);
      g.base += (Math.sin(t * 0.09 + g.ph * 0.1) * 0.35 + Math.sin(t * 0.04 + g.ph) * 0.25) * dt + back * Math.min(1, dt * 0.5);
      const want = g.base + Math.sin(t * 0.3 + g.ph) * 0.3;
      g.ang += clamp(angDiff(want, g.ang), -0.9 * dt, 0.9 * dt);
      g.sp = ease(g.sp, 80, 0.5, dt);
      g.z = ease(g.z, 1, 1, dt);
      if (!inView(ctx, g.x, g.y, 160)) Object.assign(g, newGull(ctx, true), { landNext: g.landNext });
    } else if (g.mode === 'land') {
      const dx = g.tx - g.x, dy = g.ty - g.y, dd = Math.hypot(dx, dy);
      g.ang += clamp(angDiff(Math.atan2(dy, dx), g.ang), -1.6 * dt, 1.6 * dt);
      g.sp = ease(g.sp, clamp(dd * 0.6, 22, 80), 1.5, dt);
      g.z = ease(g.z, clamp(dd / 260, 0, 1), 2, dt);
      if (dd < 120) g.flapT = Math.max(g.flapT, 0.3);
      if (dd < 5) { g.mode = 'stand'; g.z = 0; g.stay = 12 + R() * 25; g.x = g.tx; g.y = g.ty; return; }
    }
    g.x += Math.cos(g.ang) * g.sp * dt; g.y += Math.sin(g.ang) * g.sp * dt;
    // flapping: short bursts between long glides
    g.flapNext -= dt;
    if (g.flapNext <= 0) { g.flapT = 1 + R() * 1.5; g.flapNext = 4 + R() * 7; }
    if (g.flapT > 0) { g.flapT -= dt; g.frT += dt * 7; if (g.frT >= 1) { g.frT = 0; g.fr = (g.fr + 1) % 4; } }
    else g.fr = 0;
  }
  // Visitors: now and then a sea otter surfaces to float on its back, or a sea lion porpoises through the deep water
  function deepSpot(ctx, minD) {
    for (let k = 0; k < 80; k++) {
      const x = 60 + R() * (ctx.W - 120), y = 60 + R() * (ctx.H - 140);
      if (ctx.distAt(x, y) < 80) continue;
      if (level - heightAt(ctx, x, y).h > minD) return [x, y];
    }
    return null;
  }
  function spawnVisitor(ctx, kind) {
    const s = deepSpot(ctx, kind === 'otter' ? 0.45 : 0.6);
    if (!s) return false;
    if (kind === 'otter') visitor = { kind, x: s[0], y: s[1], ang: R() * TAU, sp: 6, a: 0, t: 0, life: 50 + R() * 40, spin: 0, rollT: 8 + R() * 10 };
    else visitor = { kind, x: s[0], y: s[1], ang: R() * TAU, sp: 85, a: 0, t: 0, life: 18 + R() * 14, up: 1, cyc: 0, wake: 0 };
    addRing(s[0], s[1], { r1: 70, life: 2.2, a: 0.5 });
    return true;
  }
  function stepVisitor(ctx, v, dt) {
    v.t += dt;
    const leaving = v.t > v.life;
    if (v.kind === 'otter') {
      v.a = leaving ? Math.max(0, v.a - dt * 0.5) : Math.min(1, v.a + dt * 0.6);
      // drifts slowly; turns away from shallow water
      const ax = v.x + Math.cos(v.ang) * 40, ay = v.y + Math.sin(v.ang) * 40;
      if (level - heightAt(ctx, ax, ay).h < 0.35 || ctx.distAt(ax, ay) < 60) v.ang += 0.8 * dt;
      v.x += Math.cos(v.ang) * v.sp * dt; v.y += Math.sin(v.ang) * v.sp * dt;
      v.rollT -= dt;
      if (v.rollT <= 0) { v.spin = TAU; v.rollT = 12 + R() * 16; addRing(v.x, v.y, { r1: 55, life: 1.8 }); }
      if (v.spin > 0) { const d = Math.min(v.spin, dt * 3.5); v.spin -= d; v.ang += d; }
      if (R() < dt * 0.15) addRing(v.x + (R() - 0.5) * 20, v.y + (R() - 0.5) * 20, { r1: 30, life: 1.4, a: 0.3 });
      if (leaving && v.a <= 0) { addRing(v.x, v.y, { r1: 60, life: 2 }); return false; }
      return true;
    }
    // sea lion: surfaces for a few seconds, dives for a couple, steering toward deeper water
    v.cyc -= dt;
    if (v.cyc <= 0) { v.up = v.up ? 0 : 1; v.cyc = v.up ? 2.5 + R() * 2.5 : 1.5 + R() * 1.5; addRing(v.x, v.y, { r1: 50, life: 1.6 }); }
    const vis = leaving ? 0 : v.up ? 1 : 0.28;
    v.a = ease(v.a, vis, 3, dt);
    let best = v.ang, bd = -9;
    for (const da of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const a = v.ang + da, d = level - heightAt(ctx, v.x + Math.cos(a) * 90, v.y + Math.sin(a) * 90).h - Math.abs(da) * 0.1;
      if (d > bd) { bd = d; best = a; }
    }
    v.ang += clamp(angDiff(best, v.ang), -1.2 * dt, 1.2 * dt);
    v.x += Math.cos(v.ang) * v.sp * dt; v.y += Math.sin(v.ang) * v.sp * dt;
    v.wake -= dt;
    if (v.wake <= 0 && v.up) { v.wake = 0.22; addRing(v.x - Math.cos(v.ang) * 30, v.y - Math.sin(v.ang) * 30, { r0: 6, r1: 30, life: 1.1, a: 0.16 }); }
    if ((leaving && v.a < 0.02) || !inView(ctx, v.x, v.y, 120)) return false;
    return true;
  }
  // Splash droplets (double-click): fly out in an arc, fall back, leave a few tiny rings if they land in water
  function burst(x, y, n, sp, life) {
    for (let i = 0; i < n; i++) { const a = R() * TAU, v = sp * (0.4 + R() * 0.8); drops.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, z: 0, vz: 60 + R() * 90, t: 0, life: life * (0.7 + R() * 0.6), s: 2 + R() * 2.5 }); }
  }

  Galaxy.register(ID, {
    name: 'Tidepools',
    weather: false,
    defaultHour: 13,
    post: { bloom: 0.25, threshold: 1.1, knee: 0.4, exposure: 1.0, vignette: 0.22, grain: 0.014, aberration: 0, saturation: 1.0, bloomRadius: 1.0 },

    init(ctx) {
      C = ctx; R = ctx.rng(9);
      prog = ctx.program(MAIN_FS);
      defineSprites(ctx);
      buildGround(ctx);
      level = tideTarget(ctx.P); tideCheck = 0;
      waves = []; splashes = []; rings = []; drops = [];
      anems = []; stars = []; crabs = []; schools = []; gulls = []; visitor = null;
      nextWave = 2 + R() * 4;
      nextVisit = ctx.mix(500, 45, ctx.P.visitors) * (0.3 + 0.7 * R());
      lastFV = -1;
    },
    resize(ctx) { },
    layout(ctx) { },

    // Double-click: a pebble plops into the water (rings, a little splash; fish scatter, anemones and crabs flinch),
    // or on rock, spray that leaves a wet patch to dry. Standing gulls nearby take off either way.
    fire(ctx, x, y) {
      const wetHere = depthAt(ctx, x, y) > 0.06;
      if (splashes.length >= NS) splashes.shift();
      splashes.push({ x, y, t: 0, kind: wetHere ? 1 : 2 });
      if (wetHere) {
        burst(x, y, 9, 40, 0.6);
        for (const sc of schools) if (Math.hypot(sc.x - x, sc.y - y) < 170) {
          const a = Math.atan2(sc.y - y, sc.x - x), r = 90 + R() * 60, tx = sc.x + Math.cos(a) * r, ty = sc.y + Math.sin(a) * r;
          if (depthAt(ctx, tx, ty) > 0.1) { sc.tx = tx; sc.ty = ty; } sc.dart = 1.4; sc.t = 3 + R() * 3;
        }
      } else burst(x, y, 16, 70, 0.75);
      for (const a of anems) if (Math.hypot(a.x - x, a.y - y) < 150) a.closeT = 3 + R() * 2;
      for (const c of crabs) if (Math.hypot(c.x - x, c.y - y) < 130) {
        const a = Math.atan2(c.y - y, c.x - x); c.tx = c.x + Math.cos(a) * 45; c.ty = c.y + Math.sin(a) * 45; c.walk = 1; c.t = 2; c.scared = 1;
      }
      for (const g of gulls) if (g.mode === 'stand' && Math.hypot(g.x - x, g.y - y) < 260) { g.stay = 0; }
    },

    update(ctx) {
      const dt = ctx.dt, P = ctx.P, area = ctx.W * ctx.H / (1920 * 1080);
      if (gW !== Gw || gH !== Gh || gScreen !== ctx.W + 'x' + ctx.H + ':' + ctx.seed) { buildGround(ctx); lastFV = -1; }   // same rocks at the same place: re-check the life on them
      // the tide moves on real time, whatever the Speed setting
      tideCheck -= ctx.rawDt;
      if (tideCheck <= 0) { tideCheck = 20; level = ease(level, tideTarget(P), 1, 1e3); }
      // The first frames of a new layout: keep placing fixed life until it settles
      if ((ctx.fieldVersion !== lastFV || P.traffic !== lastLife) && ctx.fieldStable) {
        lastFV = ctx.fieldVersion; lastLife = P.traffic;
        const bad = o => !inView(ctx, o.x, o.y) || ctx.distAt(o.x, o.y) < 30 || heightAt(ctx, o.x, o.y).m > 0.02;
        anems = anems.filter(o => !bad(o)); stars = stars.filter(o => !bad(o));
        fillStatics(ctx);
        const area = ctx.W * ctx.H / (1920 * 1080);               // fewer when the Tidepool life setting goes down
        anems.length = Math.min(anems.length, Math.round((5 + 9 * P.traffic) * area));
        stars.length = Math.min(stars.length, Math.round((3 + 5 * P.traffic) * area));
      }
      for (const a of anems) {
        a.ph += dt; a.closeT = Math.max(0, a.closeT - dt);
        const sub = depthAt(ctx, a.x, a.y) > 0.03 && a.closeT <= 0;
        a.open = ease(a.open, sub ? 1 : 0, sub ? 0.5 : 2.2, dt);
        a.fade = Math.min(1, a.fade + ctx.rawDt * 0.6);
      }
      for (const s of stars) { s.rot += s.spin * dt; s.fade = Math.min(1, s.fade + ctx.rawDt * 0.6); }

      // waves: sets of surges from the open sea, more often and taller with the Waves setting
      if (P.waves > 0) {
        nextWave -= dt;
        if (nextWave <= 0 || (QS2.has('wave') && !testsDone)) {
          const A0 = (0.18 + 0.32 * R()) * (0.55 + 0.9 * P.waves);
          if (waves.length >= NW) waves.shift();
          waves.push({ f: sMin - 140, A0, A: A0, sp: 120 + R() * 60, tail: 160 + R() * 120 });
          const set = R() < 0.35;   // sometimes two or three come close together
          nextWave = set ? 4 + R() * 3 : ctx.mix(45, 6, P.waves) * (0.6 + 0.8 * R());
        }
      }
      for (const w of waves) {
        w.f += w.sp * dt;
        const tr = (w.f - sMin) / (sMax - sMin);
        w.A = w.A0 * Math.exp(-tr * 1.6) * sst(-0.05, 0.05, tr + 0.05);
      }
      waves = waves.filter(w => w.f < sMax + w.tail * 4 && w.A > 0.01);

      // living things, scaled by the Tidepool life setting
      const wantC = Math.round((1 + 5 * P.traffic) * area), wantF = Math.round((1 + 3 * P.traffic) * area);
      if (ctx.fieldStable) {
        if (crabs.length < wantC && R() < dt * 2) { const c = newCrab(ctx); if (c) crabs.push(c); }
        if (schools.filter(s => !s.gone).length < wantF && R() < dt * 2) { const s = newSchool(ctx); if (s) schools.push(s); }
      }
      if (crabs.length > wantC) crabs.length = wantC;
      for (const c of crabs) stepCrab(ctx, c, dt);
      crabs = crabs.filter(c => ctx.distAt(c.x, c.y) > 20 && heightAt(ctx, c.x, c.y).m < 0.05);
      let extra = schools.filter(s => !s.gone).length - wantF;
      for (const s of schools) if (extra > 0 && !s.gone) { s.gone = true; extra--; }
      for (const s of schools) stepSchool(ctx, s, dt);
      schools = schools.filter(s => !(s.gone && s.a <= 0));

      const wantG = Math.round(P.gulls);
      while (gulls.length < wantG) gulls.push(newGull(ctx, gulls.length > 0 || ctx.t > 1));
      if (gulls.length > wantG) gulls.length = wantG;
      for (const g of gulls) stepGull(ctx, g, dt, ctx.flow);
      if (QS2.has('gullland') && !testsDone && gulls[0]) { const s = landingSpot(ctx, gulls[0]); if (s) Object.assign(gulls[0], { mode: 'stand', x: s[0], y: s[1], tx: s[0], ty: s[1], z: 0, stay: 999 }); }

      if (visitor) { if (!stepVisitor(ctx, visitor, dt)) visitor = null; }
      else if (P.visitors > 0 && ctx.fieldStable) {
        nextVisit -= dt;
        const forced = QS2.get('visit');
        if (nextVisit <= 0 || (forced && !testsDone)) {
          const kind = forced || (R() < 0.55 ? 'otter' : 'sealion');
          if (!spawnVisitor(ctx, kind)) nextVisit = 30;
          else nextVisit = ctx.mix(500, 45, P.visitors) * (0.5 + R());
          if (visitor && forced) visitor.a = 1;
        }
      }
      if (ctx.fieldStable && ctx.t > 0.5) testsDone = true;
      if (QS2.has('dbg') && ((ctx.t * 2) | 0) !== (((ctx.t - dt) * 2) | 0)) console.warn('[galaxy] t=' + ctx.t.toFixed(1) + ' tide=' + level.toFixed(2) + ' anem=' + anems.length + ' stars=' + stars.length + ' crabs=' + crabs.length + ' schools=' + schools.length + ' gulls=' + gulls.length + ' waves=' + waves.length + ' visitor=' + (visitor ? visitor.kind : '-') + ' A0=' + (anems[0] ? Math.round(anems[0].x) + ',' + Math.round(anems[0].y) + ' s' + anems[0].s.toFixed(0) + ' f' + anems[0].fade.toFixed(2) + ' o' + anems[0].open.toFixed(2) : '') + ' I=' + ctx.intro.toFixed(2) + ' fv=' + ctx.fieldVersion + '/' + lastFV + ' stable=' + ctx.fieldStable);

      for (const s of splashes) s.t += dt;
      splashes = splashes.filter(s => s.t < 14);
      for (const r of rings) r.t += dt;
      rings = rings.filter(r => r.t < r.life);
      for (const d of drops) {
        d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vz -= 420 * dt; d.z += d.vz * dt;
        if (d.z < 0 && d.t > 0.05) { d.dead = true; if (depthAt(ctx, d.x, d.y) > 0.01) addRing(d.x, d.y, { r0: 1, r1: 8, life: 0.6, a: 0.22 }); }
      }
      drops = drops.filter(d => !d.dead && d.t < d.life * 2);
    },

    render(ctx) {
      waveData.fill(0);
      waves.forEach((w, k) => { waveData[k * 4] = w.f; waveData[k * 4 + 1] = w.A; waveData[k * 4 + 2] = w.tail; });
      splData.fill(0);
      splashes.forEach((s, k) => { splData[k * 4] = s.x; splData[k * 4 + 1] = s.y; splData[k * 4 + 2] = s.t; splData[k * 4 + 3] = s.kind; });
      ctx.fullscreen(prog, { uTide: level, uDir: dir, uWave: waveData, uSpl: splData }, { uGround: groundTex }, null);
      const I = ctx.intro;
      // under water: colours shift toward the water and fade with depth (as the shader does for the rock)
      const under = (d, base, k = 1) => {
        const dd = Math.max(d, 0), T = [Math.exp(-dd * 2.6), Math.exp(-dd * 0.85), Math.exp(-dd * 0.7)];
        return [(base[0] * T[0] + 0.2 * (1 - T[0])) * k, (base[1] * T[1] + 0.5 * (1 - T[1])) * k, (base[2] * T[2] + 0.55 * (1 - T[2])) * k];
      };
      const sink = d => Math.exp(-Math.max(d, 0) * 0.75);   // deeper things fade into the water
      const fadeM = (x, y) => 1 - sst(0, 0.04, heightAt(ctx, x, y).m);
      for (const s of stars) {
        const d = depthAt(ctx, s.x, s.y), al = s.fade * I * fadeM(s.x, s.y);
        if (al > 0.01) ctx.sprite(s.c, s.x, s.y, { w: s.s, rot: s.rot, alpha: al * sink(d), tint: under(d, [1, 1, 1], SPR) });
      }
      for (const a of anems) {
        const d = depthAt(ctx, a.x, a.y), al = a.fade * I * fadeM(a.x, a.y) * sink(d);
        if (al < 0.01) continue;
        const tn = under(d, [1, 1, 1], SPR), o = a.open;
        if (o < 0.98) ctx.sprite('anemC', a.x, a.y, { w: a.s * 0.62, rot: a.rot, alpha: al * (1 - o * o), tint: tn });
        if (o > 0.02) ctx.sprite('anem' + a.v, a.x, a.y, { w: a.s * (0.55 + 0.45 * o) * (1 + 0.025 * Math.sin(a.ph * 0.8)), rot: a.rot + 0.05 * Math.sin(a.ph * 0.5), alpha: al * o * 0.92, tint: tn });
      }
      for (const c of crabs) {
        const d = depthAt(ctx, c.x, c.y);
        ctx.sprite('crab' + c.fr, c.x, c.y, { w: c.s, rot: c.ang, alpha: c.a * I * sink(d), tint: under(d, [1, 1, 1], SPR), shadow: { dx: 1.5, dy: 2, alpha: 0.35, bias: 1.5 } });
      }
      for (const sc of schools) for (const f of sc.fish) {
        const d = depthAt(ctx, f.x, f.y);
        const al = sc.a * I * sst(0.0, 0.08, d);
        if (al < 0.01) continue;
        const fr = f.sp > 25 ? ((f.ph * 9) | 0) % 3 : 1;
        ctx.sprite('fish' + fr, f.x, f.y, { w: f.s, rot: f.ang, alpha: al * 0.9, tint: under(d * 0.6, [1, 1, 1], SPR), shadow: { dx: 4 + d * 8, dy: 5 + d * 10, alpha: 0.28, bias: 2.5, tint: [0.02, 0.08, 0.1] } });
      }
      const v = visitor;
      if (v) {
        const d = level - heightAt(ctx, v.x, v.y).h;
        if (v.kind === 'otter') ctx.sprite('otter', v.x, v.y, { w: 80 * (1 + 0.02 * Math.sin(v.t * 1.3)), rot: v.ang, alpha: v.a * I, tint: [SPR, SPR, SPR], shadow: { dx: 2, dy: 3, alpha: 0.3, bias: 2 } });
        else {
          const sub = 1 - v.a;
          ctx.sprite('seal', v.x, v.y, { w: 120, rot: v.ang, alpha: Math.max(v.a, 0.2 * (v.t < v.life ? 1 : 0)) * I, tint: under(sub * 0.9 + Math.min(d, 0) * 0, [1, 1, 1], SPR) });
        }
      }
      for (const r of rings) {
        const k = r.t / r.life;
        ctx.sprite('ring', r.x, r.y, { w: (r.r0 + (r.r1 - r.r0) * Math.sqrt(k)) * 2, alpha: r.a * (1 - k) * (1 - k) * I, tint: [0.7, 0.8, 0.8] });
      }
      for (const d of drops) ctx.sprite('drop', d.x, d.y - Math.max(d.z, 0) * 0.35, { w: d.s * 2.2, alpha: 0.75 * (1 - d.t / (d.life * 2)), tint: [0.85, 0.9, 0.9] });
      // gulls last: they are above everything; their shadows fall far below them on the rocks and water
      for (const g of gulls) {
        if (g.mode === 'stand') { ctx.sprite('gullS', g.x, g.y, { w: 34, rot: g.ang, alpha: I, tint: [SPR, SPR, SPR], shadow: { dx: 3, dy: 4, alpha: 0.35, bias: 1.5 } }); continue; }
        const z = g.z, w = 40 + 34 * z;
        ctx.sprite('gull' + g.fr, g.x, g.y, { w, rot: g.ang, alpha: I, tint: [SPR * 1.05, SPR * 1.05, SPR * 1.05], shadow: { dx: 6 + 70 * z, dy: 8 + 90 * z, alpha: 0.2 + 0.12 * (1 - z), bias: 1.5 + 2 * z, scale: 0.9 } });
      }
      ctx.flush();
    },

    dispose(ctx) { if (prog) ctx.gl.deleteProgram(prog.p); prog = null; if (groundTex) ctx.gl.deleteTexture(groundTex); groundTex = null; }
  });
})();
