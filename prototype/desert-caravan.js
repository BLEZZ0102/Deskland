// Deskland · Desert Caravan — the living parts: a camel caravan with long sunset shadows and footprints, palms round the
// oases, a hawk circling now and then. Loaded after astro-core.js and sprites.js, before desert.html's own script.
// Bodies are SpriteLayer sprites (sprites.js). Long shadows need a skew (a camel's side profile laid down along the sun
// direction, so the shadow shows its legs walking), which a rotate+scale sprite can't do, so shadows, footprints and
// lantern light go through a tiny affine layer below; both draw on the WebGL canvas after the terrain pass.
// License: GPL-3.0, same as Deskland.
'use strict';

/* ---------- affine sprite layer: world = o + ex * (u - ax) + ey * (v - ay), u/v 0..1 across the frame (v = 0 at its bottom) ---------- */
class AffineLayer {
  constructor(atlasCanvas, max = 2048) {
    this.max = max; this.n = 0; this.frames = [];
    this.data = new Float32Array(max * 16);
    this.aw = atlasCanvas.width; this.ah = atlasCanvas.height;
    const vs = `#version 300 es
layout(location = 0) in vec4 aO;
layout(location = 1) in vec4 aE;
layout(location = 2) in vec4 aUV;
layout(location = 3) in vec4 aC;
uniform vec2 uRes;
out vec2 vUV; out vec4 vC;
void main() {
  int id = gl_VertexID % 6;
  vec2 q = vec2((id == 1 || id == 2 || id == 4) ? 1.0 : 0.0, (id == 2 || id == 4 || id == 5) ? 1.0 : 0.0);
  vec2 l = q - aO.zw;
  vec2 p = aO.xy + aE.xy * l.x + aE.zw * l.y;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  vUV = vec2(mix(aUV.x, aUV.z, q.x), mix(aUV.w, aUV.y, q.y));
  vC = aC;
}`;
    const fs = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
uniform float uAppear;
in vec2 vUV; in vec4 vC;
out vec4 o;
void main() { o = vC * texture(uAtlas, vUV).a * uAppear; }`;
    const mk = (type, src) => {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(sh)); throw new Error('affine shader'); }
      return sh;
    };
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    this.uRes = gl.getUniformLocation(p, 'uRes'); this.uAtlas = gl.getUniformLocation(p, 'uAtlas'); this.uAppear = gl.getUniformLocation(p, 'uAppear');
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 4; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 64, i * 16); gl.vertexAttribDivisor(i, 1); }
    gl.bindVertexArray(prevVao);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (typeof noiseTex !== 'undefined' && noiseTex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex); }
  }
  def(sx, sy, sw, sh) { this.frames.push([(sx + 0.5) / this.aw, (sy + 0.5) / this.ah, (sx + sw - 0.5) / this.aw, (sy + sh - 0.5) / this.ah]); return this.frames.length - 1; }
  // c: [r, g, b, a] straight colour; a = 0 with rgb > 0 adds light
  add(f, ox, oy, exx, exy, eyx, eyy, ax, ay, c, add = false) {
    if (this.n >= this.max) return;
    const F = this.frames[f], d = this.data, i = this.n++ * 16;
    d[i] = ox; d[i + 1] = oy; d[i + 2] = ax; d[i + 3] = ay;
    d[i + 4] = exx; d[i + 5] = exy; d[i + 6] = eyx; d[i + 7] = eyy;
    d[i + 8] = F[0]; d[i + 9] = F[1]; d[i + 10] = F[2]; d[i + 11] = F[3];
    const a = c[3];
    d[i + 12] = c[0] * (add ? 1 : a); d[i + 13] = c[1] * (add ? 1 : a); d[i + 14] = c[2] * (add ? 1 : a); d[i + 15] = add ? 0 : a;
  }
  draw() {
    if (!this.n) return;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * 16);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.uAtlas, 3);
    gl.uniform2f(this.uRes, cv.width / cv._scale, cv.height / cv._scale);
    gl.uniform1f(this.uAppear, appear * appear * (3 - 2 * appear));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.n);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(prevVao); gl.activeTexture(gl.TEXTURE0);
    this.n = 0;
  }
}

const Caravan = (() => {
  /* ---------- painting ---------- */
  const CW = 128, CH = 64;          // top-down camel cell (atlas px); camel faces +x, centre (64, 32)
  const SW = 128, SH = 96;          // side-view silhouette cell (shadow atlas); ground at the bottom
  const RUGS = [['#b8322a', '#f0c24a', '#2a2f6e'], ['#2b3f8f', '#e9d9b0', '#c8402e'], ['#1f7a6d', '#f2c14e', '#8a2a3a'], ['#7a2e6e', '#f0a830', '#efe6cf']];
  const ROBES = [['#f1ece0', '#3a4ca0'], ['#2e3a7a', '#f3efe4'], ['#e8e0cc', '#b8322a']];
  const CAMEL = '#7a4724', CAMEL_D = '#3e2210', CAMEL_L = '#b07840';
  let BODY = null, SHAD = null, F = {};

  function ell(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), rot, 0, 7); }
  function grad(c, x, y, r, a, b) { const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r); g.addColorStop(0, a); g.addColorStop(1, b); return g; }

  // one top-down camel frame. v: 0 rider, 1 packs, 2 plain; ph: walk phase 0..1
  function camelTop(c, ox, oy, v, ph, k) {
    c.save(); c.translate(ox + 64, oy + 32);
    const s = Math.sin(ph * 6.2832), sway = Math.sin(ph * 6.2832) * 0.8;
    c.lineCap = 'round';
    // legs: pacing gait, the two legs of one side swing together
    c.strokeStyle = CAMEL_D; c.lineWidth = 3.6;
    for (const [hx, side] of [[20, -1], [20, 1], [-22, -1], [-22, 1]]) {
      const sw = s * side * 9;
      c.beginPath(); c.moveTo(hx, side * 6); c.lineTo(hx + sw, side * 10.5); c.stroke();
      ell(c, hx + sw, side * 10.5, 2.4, 2.0); c.fillStyle = '#4a2c16'; c.fill();
    }
    // tail
    c.strokeStyle = CAMEL_D; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(-32, 0); c.quadraticCurveTo(-38, sway * 2, -41, 1 + sway * 3); c.stroke();
    // neck and head (the head nods forward and back a little)
    const nod = Math.cos(ph * 12.566) * 1.2;
    c.strokeStyle = CAMEL; c.lineWidth = 8;
    c.beginPath(); c.moveTo(24, 0); c.quadraticCurveTo(38, sway, 47 + nod, sway * 1.5); c.stroke();
    c.lineWidth = 5.5; c.beginPath(); c.moveTo(40, sway); c.lineTo(48 + nod, sway * 1.5); c.stroke();
    ell(c, 53 + nod, sway * 1.6, 8.5, 4.6); c.fillStyle = grad(c, 53 + nod, sway * 1.6, 8, CAMEL_L, CAMEL); c.fill();
    ell(c, 60 + nod, sway * 1.6, 3.2, 3.0); c.fillStyle = CAMEL_D; c.fill();
    ell(c, 47 + nod, sway * 1.6 - 4, 1.6, 1.2); ell(c, 47 + nod, sway * 1.6 + 4, 1.6, 1.2); c.fill();
    // body and hump
    ell(c, 0, 0, 33, 12.5); c.fillStyle = grad(c, 0, 0, 34, CAMEL_L, CAMEL); c.fill();
    ell(c, 0, 0, 33, 12.5); c.strokeStyle = 'rgba(50,26,10,0.7)'; c.lineWidth = 1.6; c.stroke();
    ell(c, -1, sway * 0.4, 15, 9.5); c.fillStyle = grad(c, -1, 0, 15, '#cf9658', '#86532a'); c.fill();
    const rug = RUGS[k % RUGS.length];
    if (v === 0) {                                     // saddle rug, rider in a robe and turban
      c.save(); c.translate(-2, sway * 0.5);
      c.fillStyle = rug[0]; c.beginPath(); c.roundRect(-15, -16, 26, 32, 4); c.fill();
      c.fillStyle = rug[1]; c.fillRect(-15, -12, 26, 2.2); c.fillRect(-15, 9.8, 26, 2.2);
      c.fillStyle = rug[2]; c.fillRect(-15, -16, 26, 2.4); c.fillRect(-15, 13.6, 26, 2.4);
      for (let i = -12; i <= 8; i += 5) { c.fillStyle = rug[1]; c.fillRect(i, -17.5, 1.6, 2); c.fillRect(i, 15.5, 1.6, 2); }   // tassels
      const robe = ROBES[k % ROBES.length];
      ell(c, 0, 0, 7.5, 10.5); c.fillStyle = grad(c, 0, 0, 11, '#ffffff', robe[0]); c.fill();
      c.strokeStyle = robe[0]; c.lineWidth = 3; c.beginPath(); c.moveTo(3, -7); c.lineTo(10, -3); c.moveTo(3, 7); c.lineTo(10, 3); c.stroke();
      ell(c, 1.5, 0, 5.2, 5.2); c.fillStyle = grad(c, 1.5, 0, 5.5, '#ffffff', robe[1]); c.fill();
      c.restore();
    } else if (v === 1) {                              // packs: two bulging sacks, a rolled carpet and a box
      c.save(); c.translate(-1, sway * 0.5);
      ell(c, -1, -13, 12, 6); c.fillStyle = grad(c, -1, -13, 12, '#efe2c0', '#b9a27a'); c.fill();
      ell(c, -1, 13, 12, 6); c.fillStyle = grad(c, -1, 13, 12, '#c9a86e', '#8a6a3c'); c.fill();
      c.fillStyle = rug[0]; c.beginPath(); c.roundRect(-5, -15, 9, 30, 4); c.fill();
      c.fillStyle = rug[1]; for (let i = -12; i <= 10; i += 5.5) c.fillRect(-5, i, 9, 1.6);
      c.fillStyle = '#7a4e2a'; c.fillRect(-14, -6, 8, 12); c.fillStyle = '#9b6a3a'; c.fillRect(-13, -5, 6, 10);
      c.strokeStyle = 'rgba(60,35,20,0.8)'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(-10, -16); c.lineTo(-10, 16); c.moveTo(6, -16); c.lineTo(6, 16); c.stroke();
      c.restore();
    } else {                                           // a light blanket
      c.fillStyle = rug[0]; c.beginPath(); c.roundRect(-9, -14, 16, 28, 3); c.fill();
      c.fillStyle = rug[1]; c.fillRect(-9, -2, 16, 4);
    }
    c.restore();
  }
  // side silhouette of a camel (shadow), facing +x, feet on the bottom edge. Pixel units: 70 px long body
  function camelSide(c, ox, oy, v, ph) {
    c.save(); c.translate(ox + 64, oy + SH - 2);
    c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineCap = 'round'; c.lineJoin = 'round';
    const a = ph * 6.2832;
    // legs: [hip x, phase offset]; pace: front and back of one side together
    for (const [hx, off] of [[20, 0], [-20, 0], [24, Math.PI], [-16, Math.PI]]) {
      const sw = Math.sin(a + off) * 8, lift = Math.max(0, Math.cos(a + off)) * 4;
      const kx = hx + sw * 0.5 + 2, ky = -24 - lift * 0.5;
      c.lineWidth = 4.2; c.beginPath(); c.moveTo(hx, -44); c.lineTo(kx, ky); c.stroke();
      c.lineWidth = 3.0; c.beginPath(); c.moveTo(kx, ky); c.lineTo(hx + sw, -1 - lift); c.stroke();
    }
    // body, hump, neck, head, tail
    ell(c, 0, -50, 31, 10); c.fill();
    ell(c, -2, -60, 14, 11); c.fill();
    c.lineWidth = 8; c.beginPath(); c.moveTo(24, -50); c.quadraticCurveTo(38, -44, 42, -62); c.stroke();
    c.lineWidth = 6; c.beginPath(); c.moveTo(42, -60); c.lineTo(46, -70); c.stroke();
    ell(c, 50, -70, 8, 4.4, 0.2); c.fill();
    c.lineWidth = 2; c.beginPath(); c.moveTo(-30, -52); c.quadraticCurveTo(-36, -44, -34, -36); c.stroke();
    if (v === 0) {                                     // rider
      ell(c, -1, -72, 5.5, 7); c.fill();
      ell(c, 0, -84, 4.6, 4.6); c.fill();
      c.lineWidth = 3.5; c.beginPath(); c.moveTo(-1, -66); c.lineTo(6, -56); c.stroke();   // leg hanging down the flank
    } else if (v === 1) {                              // packs
      ell(c, -2, -66, 13, 8); c.fill(); c.fillRect(-12, -74, 9, 8);
      ell(c, -2, -52, 15, 7); c.fill();
    }
    c.restore();
  }
  // front (or back) silhouette of a camel, cell 64x96, feet at the bottom; used when it walks toward or away from the sun
  function camelFront(c, ox, oy, v, ph) {
    c.save(); c.translate(ox + 32, oy + SH - 2);
    c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineCap = 'round';
    const a = ph * 6.2832;
    for (const [lx, off] of [[-7, 0], [7, Math.PI]]) {
      const lift = Math.max(0, Math.cos(a + off)) * 4;
      c.lineWidth = 4.5; c.beginPath(); c.moveTo(lx, -46); c.lineTo(lx * 0.9, -1 - lift); c.stroke();
    }
    ell(c, 0, -52, 13, 11); c.fill();
    ell(c, 0, -62, 9, 10); c.fill();
    c.lineWidth = 7; c.beginPath(); c.moveTo(0, -56); c.lineTo(0, -70); c.stroke();
    ell(c, 0, -72, 5, 5); c.fill();
    if (v === 0) { ell(c, 0, -74, 6, 8); c.fill(); ell(c, 0, -86, 4.6, 4.6); c.fill(); }
    else if (v === 1) { ell(c, -11, -58, 7, 9); c.fill(); ell(c, 11, -58, 7, 9); c.fill(); ell(c, 0, -68, 9, 6); c.fill(); }
    c.restore();
  }
  // a person walking (top down), facing +x, cell 32x32
  function walkerTop(c, ox, oy, ph) {
    c.save(); c.translate(ox + 16, oy + 16);
    const s = Math.sin(ph * 6.2832);
    c.lineCap = 'round'; c.strokeStyle = '#3a2a1c'; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(0, -2.5); c.lineTo(s * 5, -2.5); c.moveTo(0, 2.5); c.lineTo(-s * 5, 2.5); c.stroke();
    ell(c, 0, 0, 4, 6); c.fillStyle = grad(c, 0, 0, 6, '#ffffff', '#3a4ca0'); c.fill();
    c.strokeStyle = '#3a4ca0'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -5); c.lineTo(-s * 3, -7); c.moveTo(0, 5); c.lineTo(4, 6); c.stroke();
    ell(c, 0.8, 0, 3, 3); c.fillStyle = grad(c, 0.8, 0, 3.2, '#ffffff', '#d8d0bc'); c.fill();
    c.restore();
  }
  function walkerSide(c, ox, oy, ph) {     // cell 32x64, feet at the bottom
    c.save(); c.translate(ox + 16, oy + 62);
    c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineCap = 'round';
    const a = ph * 6.2832;
    c.lineWidth = 3; for (const off of [0, Math.PI]) { const sw = Math.sin(a + off) * 6; c.beginPath(); c.moveTo(0, -26); c.lineTo(sw, -1); c.stroke(); }
    ell(c, 0, -36, 4.5, 11); c.fill();
    ell(c, 0.5, -51, 4, 4); c.fill();
    c.lineWidth = 1.2; c.beginPath(); c.moveTo(3, -40); c.lineTo(12, -54); c.stroke();      // staff
    c.restore();
  }
  // palm crown from above, cell 128x128
  function palmTop(c, ox, oy, k) {
    const r = mulberry32(17 + k * 101);
    c.save(); c.translate(ox + 64, oy + 64);
    const n = 9 + (k % 3), a0 = r() * 6.28;
    const greens = [['#2c5a22', '#5f9a32', '#b9c95a'], ['#245026', '#548c38', '#a9c25e'], ['#33601f', '#6aa234', '#c8d466']][k % 3];
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
      if ((i % 2) !== pass) continue;
      const a = a0 + i / n * 6.2832 + (r() - 0.5) * 0.3, L = 44 + r() * 14, bend = (r() - 0.5) * 0.5;
      c.save(); c.rotate(a);
      // frond: a curved leaf with feathered leaflets
      const pts = [];
      for (let t = 0; t <= 1.001; t += 0.1) pts.push([t * L, Math.sin(t * 2.6) * bend * L * 0.35]);
      c.lineCap = 'round';
      for (let j = 1; j < pts.length; j++) {
        const [x, y] = pts[j], t = j / (pts.length - 1), w = (1 - t * 0.85) * 9 + 1;
        c.strokeStyle = t < 0.5 ? greens[0] : greens[1]; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(x - 3, y); c.lineTo(x + 2, y - w); c.moveTo(x - 3, y); c.lineTo(x + 2, y + w); c.stroke();
      }
      c.strokeStyle = greens[2]; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(0, 0); for (const [x, y] of pts) c.lineTo(x, y); c.stroke();
      c.restore();
    }
    ell(c, 0, 0, 6, 6); c.fillStyle = '#5a4020'; c.fill();
    ell(c, -1, -1, 3, 3); c.fillStyle = '#8a6a30'; c.fill();
    c.restore();
  }
  function palmSide(c, ox, oy, k) {        // cell 64x128: trunk and crown, base at the bottom centre
    c.save(); c.translate(ox + 32, oy + 126);
    c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineCap = 'round';
    const lean = (k % 2 ? 1 : -1) * 6;
    c.lineWidth = 4; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(lean * 0.2, -50, lean, -88); c.stroke();
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.36, L = 28;
      c.lineWidth = 4 - Math.abs(i - 4) * 0.25;
      c.beginPath(); c.moveTo(lean, -88);
      c.quadraticCurveTo(lean + Math.cos(a) * L * 0.7, -88 + Math.sin(a) * L * 0.5 - 6, lean + Math.cos(a) * L, -88 + Math.sin(a) * L * 0.3 + 10); c.stroke();
    }
    c.restore();
  }
  function hawkTop(c, ox, oy, fl) {        // cell 64x64, facing +x; fl: wing beat -1..1 (0 = gliding)
    c.save(); c.translate(ox + 32, oy + 32);
    const span = 27 - Math.abs(fl) * 9, sweep = fl * 5;
    c.fillStyle = '#3b2a20';
    for (const sd of [-1, 1]) {
      c.beginPath(); c.moveTo(4, 0); c.quadraticCurveTo(6 + sweep, sd * span * 0.6, -2 + sweep, sd * span);
      c.lineTo(-6 + sweep, sd * span * 0.95); c.quadraticCurveTo(-6, sd * span * 0.4, -6, 0); c.closePath(); c.fill();
      c.fillStyle = '#6a4a30';
      c.beginPath(); c.moveTo(2, sd * 2); c.quadraticCurveTo(4 + sweep, sd * span * 0.5, -1 + sweep, sd * span * 0.85); c.lineTo(-3, sd * 3); c.closePath(); c.fill();
      c.fillStyle = '#3b2a20';
    }
    ell(c, 0, 0, 10, 3.6); c.fill();
    c.beginPath(); c.moveTo(-8, 0); c.lineTo(-17, -4.5); c.lineTo(-17, 4.5); c.closePath(); c.fill();
    ell(c, 9, 0, 3.4, 3); c.fillStyle = '#5a4030'; c.fill();
    c.restore();
  }

  const WALK = 8;
  function paint() {
    // body atlas: rows of camel frames (3 kinds x 4 rugs), walkers, palms, hawk, glow
    const bodyA = makeAtlas(1024, 1024, c => {
      for (let v = 0; v < 3; v++) for (let k = 0; k < 4; k++) for (let f = 0; f < WALK; f++) camelTop(c, f * CW, (v * 4 + k) * CH, v, f / WALK, k);
      // y = 768: walkers (8 x 32), palms (4 x 128 at y 800 .. 928 → put at x 0..512), hawk frames, glow
      for (let f = 0; f < WALK; f++) walkerTop(c, f * 32, 768, f / WALK);
      for (let k = 0; k < 4; k++) palmTop(c, 256 + k * 128 - 256 + 256, 768, k);
      for (let f = 0; f < 4; f++) hawkTop(c, f * 64, 832, [0, 0.6, 1, -0.6][f]);
      const g = c.createRadialGradient(288, 928, 0, 288, 928, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(256, 896, 64, 64);
      c.fillStyle = '#fff'; c.fillRect(330, 900, 8, 8);
    });
    BODY = new SpriteLayer(bodyA.canvas, 1024);
    F.camel = [];
    for (let v = 0; v < 3; v++) for (let k = 0; k < 4; k++) { const row = []; for (let f = 0; f < WALK; f++) row.push(BODY.def(f * CW, (v * 4 + k) * CH, CW, CH)); F.camel.push(row); }
    F.walker = []; for (let f = 0; f < WALK; f++) F.walker.push(BODY.def(f * 32, 768, 32, 32));
    F.palm = []; for (let k = 0; k < 4; k++) F.palm.push(BODY.def(256 + k * 128, 768, 128, 128));
    F.hawk = []; for (let f = 0; f < 4; f++) F.hawk.push(BODY.def(f * 64, 832, 64, 64));
    F.glow = BODY.def(256, 896, 64, 64);
    F.dot = BODY.def(331, 901, 6, 6);

    const shadA = makeAtlas(1024, 1024, c => {
      c.filter = 'blur(1.2px)';
      for (let v = 0; v < 3; v++) for (let f = 0; f < WALK; f++) camelSide(c, f * SW, v * SH, v, f / WALK);
      for (let v = 0; v < 3; v++) for (let f = 0; f < WALK; f++) camelFront(c, f * 64, 576 + v * SH, v, f / WALK);
      for (let f = 0; f < WALK; f++) walkerSide(c, f * 32, 288, f / WALK);
      for (let k = 0; k < 2; k++) palmSide(c, 256 + k * 64, 288, k);
      c.filter = 'blur(2.5px)';
      for (let k = 0; k < 4; k++) { c.save(); c.translate(0, 0); palmTop(c, 384 + k * 128, 288, k); c.restore(); }
      c.globalCompositeOperation = 'source-over';
      for (let f = 0; f < 4; f++) hawkTop(c, f * 64, 448, [0, 0.6, 1, -0.6][f]);
      c.filter = 'blur(0.6px)';
      c.fillStyle = '#000'; ell(c, 8, 520, 4, 2.6); c.fill();                    // footprint
      ell(c, 64 + 24, 512 + 8, 22, 6); c.fill();                                 // a soft body-shaped blot under a camel
      c.filter = 'none';
      const g = c.createRadialGradient(160, 544, 0, 160, 544, 32);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.4, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(128, 512, 64, 64);
    });
    SHAD = new AffineLayer(shadA.canvas, 2048);
    F.cside = []; for (let v = 0; v < 3; v++) { const row = []; for (let f = 0; f < WALK; f++) row.push(SHAD.def(f * SW, v * SH, SW, SH)); F.cside.push(row); }
    F.cfront = []; for (let v = 0; v < 3; v++) { const row = []; for (let f = 0; f < WALK; f++) row.push(SHAD.def(f * 64, 576 + v * SH, 64, SH)); F.cfront.push(row); }
    F.wside = []; for (let f = 0; f < WALK; f++) F.wside.push(SHAD.def(f * 32, 288, 32, 64));
    F.pside = [SHAD.def(256, 288, 64, 128), SHAD.def(320, 288, 64, 128)];
    F.ptop = []; for (let k = 0; k < 4; k++) F.ptop.push(SHAD.def(384 + k * 128, 288, 128, 128));
    F.hside = []; for (let f = 0; f < 4; f++) F.hside.push(SHAD.def(f * 64, 448, 64, 64));
    F.print = SHAD.def(0, 512, 16, 16);
    F.blot = SHAD.def(64, 512, 48, 16);
    F.pool = SHAD.def(128, 512, 64, 64);
  }

  /* ---------- route planning over the clearance grid ---------- */
  const SPEED = 9.5;                 // px / s
  const CAMEL_LEN = 22.5;              // camel scale: nose to tail is about 1.5 x this (css px)
  const GAP = 42;                    // between camels
  let route = null;                  // { pts: [[x,y]...], cum: [...], len }
  let lead = 0, waitT = 0, routeN = 0, members = [];
  const prints = []; let printAcc = 0, printSide = 1;

  function costGrid(safe) {
    const gw = CLR.gw, gh = CLR.gh, cost = new Float32Array(gw * gh), r = mulberry32(seed * 7 + routeN * 13 + 5);
    const ph1 = r() * 6.28, ph2 = r() * 6.28;
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx, d = CLR.d[i], x = gx * CG, y = gy * CG;
      if (d < safe || y > H - TASKBAR - 16) { cost[i] = Infinity; continue; }
      const mean = 0.5 + 0.5 * Math.sin(x / 210 + ph1 + Math.sin(y / 260 + ph2) * 1.4) * Math.cos(y / 190 - ph2);
      cost[i] = 1 + 5 * Math.exp(-(d - safe) / 45) + 0.9 * mean;
    }
    return cost;
  }
  function astar(cost, s, e) {
    const gw = CLR.gw, gh = CLR.gh, n = gw * gh, g = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const heap = [], push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const ex = e % gw, ey = (e / gw) | 0, hcost = i => { const dx = Math.abs(i % gw - ex), dy = Math.abs(((i / gw) | 0) - ey); return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)); };
    g[s] = 0; push(s, hcost(s));
    while (heap.length) {
      const [, i] = pop();
      if (i === e) break;
      if (closed[i]) continue; closed[i] = 1;
      const x = i % gw, y = (i / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx; if (closed[j] || cost[j] === Infinity) continue;
        const ng = g[i] + (dx && dy ? 1.414 : 1) * (cost[i] + cost[j]) * 0.5;
        if (ng < g[j]) { g[j] = ng; from[j] = i; push(j, ng + hcost(j)); }
      }
    }
    if (from[e] < 0 && s !== e) return null;
    const out = []; for (let i = e; i >= 0; i = from[i]) { out.push([(i % gw) * CG, ((i / gw) | 0) * CG]); if (i === s) break; }
    return out.reverse();
  }
  function lineFree(a, b, safe) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 8);
    for (let i = 0; i <= n; i++) { const t = i / n; if (iconDist(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) < safe) return false; }
    return true;
  }
  function chaikin(p, it) {
    for (let k = 0; k < it; k++) {
      const q = [p[0]];
      for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
      q.push(p[p.length - 1]); p = q;
    }
    return p;
  }
  function resample(p, step) {
    const out = [p[0]]; let carry = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let t = step - carry;
      while (t <= L) { out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); t += step; }
      carry = L - (t - step);
    }
    out.push(p[p.length - 1]);
    return out;
  }
  function mkRoute(pts) {
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function at(rt, s) {                       // position and heading at arc length s (extends straight past both ends)
    const P = rt.pts, C = rt.cum, n = P.length;
    if (s <= 0) { const dx = P[1][0] - P[0][0], dy = P[1][1] - P[0][1], L = Math.hypot(dx, dy) || 1; return [P[0][0] + dx / L * s, P[0][1] + dy / L * s, Math.atan2(dy, dx)]; }
    if (s >= rt.len) { const dx = P[n - 1][0] - P[n - 2][0], dy = P[n - 1][1] - P[n - 2][1], L = Math.hypot(dx, dy) || 1, o = s - rt.len; return [P[n - 1][0] + dx / L * o, P[n - 1][1] + dy / L * o, Math.atan2(dy, dx)]; }
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= s) lo = m; else hi = m; }
    const t = (s - C[lo]) / (C[hi] - C[lo] || 1);
    const x = P[lo][0] + (P[hi][0] - P[lo][0]) * t, y = P[lo][1] + (P[hi][1] - P[lo][1]) * t;
    const a = P[Math.max(0, lo - 3)], b = P[Math.min(n - 1, hi + 3)];
    return [x, y, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }
  const safeDist = () => 0.8 * P.sigma + 26;
  // border cells that are free, with the outward direction
  function borderCells(cost) {
    const gw = CLR.gw, gh = CLR.gh, out = [], maxY = Math.floor((H - TASKBAR - 30) / CG);
    for (let gx = 1; gx < gw - 1; gx++) { out.push([gx, 1, 0, -1]); }
    for (let gy = 1; gy <= maxY; gy++) { out.push([1, gy, -1, 0]); out.push([Math.min(gw - 2, Math.floor(W / CG) - 1), gy, 1, 0]); }
    for (let gx = 1; gx < gw - 1; gx++) out.push([gx, maxY, 0, 1]);
    return out.filter(([x, y]) => cost[y * gw + x] < Infinity);
  }
  // plan a route from a start (point or border) to a far border point
  function plan(fromPt) {
    const r = mulberry32(seed * 31 + routeN * 977 + 3);
    for (const k of [1, 0.8, 0.6, 0.4, 0.2]) {
      const safe = Math.max(18, safeDist() * k), cost = costGrid(safe), gw = CLR.gw;
      const B = borderCells(cost);
      if (B.length < 2) continue;
      let sCell, sOut = null;
      if (fromPt) {
        let best = -1, bd = 1e9;
        for (let i = 0; i < cost.length; i++) if (cost[i] < Infinity) { const d = Math.hypot((i % gw) * CG - fromPt[0], ((i / gw) | 0) * CG - fromPt[1]); if (d < bd) { bd = d; best = i; } }
        if (best < 0) continue;
        sCell = best;
      } else {
        const b = B[Math.floor(r() * B.length)]; sCell = b[1] * gw + b[0]; sOut = b;
      }
      const sx = (sCell % gw) * CG, sy = ((sCell / gw) | 0) * CG;
      // end: a border cell far from the start (prefer the far side of the screen)
      let cands = B.map(b => [b, Math.hypot(b[0] * CG - sx, b[1] * CG - sy)]).filter(([, d]) => d > 0.55 * Math.max(W, H));
      if (!cands.length) cands = B.map(b => [b, Math.hypot(b[0] * CG - sx, b[1] * CG - sy)]).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const eb = cands[Math.floor(r() * cands.length)][0];
      const path = astar(cost, sCell, eb[1] * gw + eb[0]);
      if (!path || path.length < 3) continue;
      // string pulling, then smooth curves
      const sp = [path[0]]; let i = 0;
      while (i < path.length - 1) { let j = path.length - 1; while (j > i + 1 && !lineFree(path[i], path[j], safe)) j--; sp.push(path[j]); i = j; }
      let pts = sp;
      // lengthen off-screen at both ends so camels walk in and out of view
      const off = 70 + GAP * 11;
      const e2 = pts[pts.length - 1]; pts.push([e2[0] + eb[2] * 80, e2[1] + eb[3] * 80]); pts.push([e2[0] + eb[2] * off, e2[1] + eb[3] * off]);
      if (sOut) { const s0 = pts[0]; pts.unshift([s0[0] + sOut[2] * 80, s0[1] + sOut[3] * 80]); pts.unshift([s0[0] + sOut[2] * off, s0[1] + sOut[3] * off]); }
      else pts.unshift(fromPt);
      // gentle wandering, limited by the room there is
      pts = resample(chaikin(pts, 4), 6);
      const ph = r() * 6.28;
      let acc = 0;
      pts = pts.map((p, i) => {
        if (i === 0 || i === pts.length - 1) return p;
        const a = pts[i - 1], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        acc += 6;
        const room = clamp((iconDist(p[0], p[1]) - safe) / 60, 0, 1), w = Math.sin(acc / 170 + ph) * 14 * room;
        return [p[0] - dy / L * w, p[1] + dx / L * w];
      });
      return mkRoute(resample(chaikin(pts, 2), 2));
    }
    return null;
  }

  /* ---------- caravan ---------- */
  function buildMembers() {
    const n = clamp(Math.round(P.caravan), 4, 10), r = mulberry32(seed * 13 + routeN * 7 + 1);
    members = [{ kind: 'walker', off: 0 }];
    let off = 18;
    for (let i = 0; i < n; i++) {
      const calf = i === n - 1 && n >= 6;
      const v = i === 0 ? 0 : calf ? 2 : (r() < 0.32 ? 0 : 1);
      const sc = calf ? 0.62 : 0.94 + r() * 0.1;
      off += (calf ? 26 : GAP) + (r() - 0.5) * 4;
      members.push({ kind: 'camel', v, k: Math.floor(r() * 4), sc, off, ph: r(), calf, lantern: false });
    }
    members[1].lantern = true; members[members.length - 1].lantern = true;
    for (const m of members) { m.x = m.y = m.a = null; }
  }
  const tail = () => members.length ? members[members.length - 1].off : 0;
  function newRoute(first) {
    routeN++;
    route = plan(null);
    buildMembers();
    if (!route) return;
    // first time: the caravan is already half way across, with its footprints behind it
    lead = first ? route.len * (0.42 + 0.12 * mulberry32(seed + 5)()) : -20;
    prints.length = 0;
    if (first) {
      const now = performance.now();
      for (let s = Math.max(0, lead - 1400); s < lead - tail(); s += 4.2) addPrint(s, now - (lead - s) / SPEED * 1000);
    }
    waitT = 0;
  }
  function addPrint(s, t) {
    const [x, y, a] = at(route, s);
    printSide = -printSide;
    const nx = -Math.sin(a), ny = Math.cos(a);
    prints.push({ x: x + nx * 2.6 * printSide, y: y + ny * 2.6 * printSide, a, t });
    if (prints.length > 900) prints.splice(0, prints.length - 900);
  }
  function reroute() {                      // icons moved: keep the walked part, plan the rest from the leader onward
    if (!route) return;
    const [x, y] = at(route, lead);
    const back = Math.max(0, lead - tail() - 60);
    const r2 = plan([x, y]);
    if (!r2) return;
    const old = []; for (let s = back; s < lead - 1; s += 2) { const q = at(route, s); old.push([q[0], q[1]]); }
    const pts = old.concat(r2.pts.slice(1));
    if (pts.length < 4) return;
    route = mkRoute(resample(chaikin(pts, 2), 2));
    lead = lead - back;
  }

  /* ---------- palms ---------- */
  let palms = [];                            // { key, x, y, r, k, vis, want }
  function rectDist(x, y) {
    let d = 1e9;
    for (const ic of activeIcons()) { const dx = Math.max(ic.x - x, 0, x - ic.x - ic.w), dy = Math.max(ic.y - y, 0, y - ic.y - ic.h); d = Math.min(d, Math.hypot(dx, dy)); }
    return d;
  }
  function placePalms(instant) {
    const want = new Map(), C = 22, sg = P.sigma;
    if (FB) {
      for (let gy = 0; gy * C < H - TASKBAR; gy++) for (let gx = 0; gx * C < W; gx++) {
        const h = hashI(gx, gy, 311);
        if (h > 0.2) continue;
        const x = (gx + 0.15 + 0.7 * hashI(gx, gy, 312)) * C, y = (gy + 0.15 + 0.7 * hashI(gx, gy, 313)) * C;
        const s = fieldAt(FB, x, y);
        if (s > -0.2 * sg || s < -1.15 * sg || hashI(gx, gy, 317) > sstep(-1.15 * sg, -0.55 * sg, s) * 0.9 + 0.1) continue;   // mostly round the rim
        const r = 11 + 6 * hashI(gx, gy, 314);
        if (rectDist(x, y) < r * 0.85 + 2) continue;
        let ok = true; for (const q of want.values()) if (Math.hypot(q.x - x, q.y - y) < (q.r + r) * 0.95) { ok = false; break; }
        if (ok) want.set(gx + ',' + gy, { x, y, r, k: Math.floor(hashI(gx, gy, 315) * 4), ph: hashI(gx, gy, 316) * 6.28 });
      }
    }
    const old = new Map(palms.map(p => [p.key, p]));
    const next = [];
    for (const [key, q] of want) { const o = old.get(key); if (o) { Object.assign(o, q, { want: 1 }); next.push(o); old.delete(key); } else next.push(Object.assign({ key, vis: instant ? 1 : 0, want: 1 }, q)); }
    if (!instant) for (const o of old.values()) { o.want = 0; next.push(o); }
    palms = next;
  }

  /* ---------- hawk ---------- */
  const hawk = { cx: 0, cy: 0, r: 70, a: 0, set: false };
  function placeHawk() {
    const rr = mulberry32(seed + 77);
    const sp = freeSpots(1, { minR: 60, pad: 10, prefer: { x: W * (0.3 + 0.4 * rr()), y: H * 0.4 } })[0];
    if (sp) { hawk.tx = sp.x; hawk.ty = sp.y; hawk.r = clamp(sp.r - 20, 40, 90); } else { hawk.tx = W * 0.6; hawk.ty = H * 0.35; hawk.r = 60; }
    if (!hawk.set) { hawk.cx = hawk.tx; hawk.cy = hawk.ty; hawk.set = true; }
  }

  /* ---------- per frame ---------- */
  let T = 0;
  function step(dt) {
    T += dt;
    if (!route) { waitT += dt; if (waitT > 1) newRoute(false); }
    else {
      const ds = SPEED * dt;
      lead += ds;
      printAcc += ds;
      while (printAcc > 4.2) { printAcc -= 4.2; if (lead > 0 && lead < route.len) addPrint(lead - 3, performance.now()); }
      if (lead - tail() > route.len + 40) { route = null; waitT = -4 - 6 * Math.random(); }
    }
    for (const p of palms) p.vis = clamp(p.vis + (p.want ? dt : -dt) / 1.4, 0, 1);
    palms = palms.filter(p => p.want || p.vis > 0);
    hawk.cx += (hawk.tx - hawk.cx) * (1 - Math.exp(-dt * 0.2)); hawk.cy += (hawk.ty - hawk.cy) * (1 - Math.exp(-dt * 0.2));
    hawk.a += dt * 6.2832 / 24;
  }
  function draw(now) {
    if (!BODY) return;
    const t = TOD(), sv = SUN(), sunA = Math.atan2(sv[1], sv[0]);
    const Ls = t.shL > 0 ? sv[3] / sv[2] : sv[3] / sv[2];   // shadow length per unit height
    const ax = -sv[0], ay = -sv[1];                          // shadow direction (away from the sun)
    const sc = t.shadow, shc = [sc[0], sc[1], sc[2], sc[3]];
    const tint = t.sprite, night = t.night;
    const nowS = now / 1000;
    // footprints
    for (const p of prints) {
      const age = (now - p.t) / 1000, al = clamp(1 - age / 70, 0, 1) * 0.55;
      if (al <= 0.01) continue;
      const c = Math.cos(p.a), s = Math.sin(p.a);
      SHAD.add(F.print, p.x, p.y, c * 3.2, s * 3.2, -s * 2.2, c * 2.2, 0.5, 0.5, [sc[0], sc[1], sc[2], al]);
    }
    // palm shadows
    for (const p of palms) {
      const a = p.vis * p.vis * (3 - 2 * p.vis);
      if (a <= 0) continue;
      const hgt = p.r * 2.0, len = hgt * Ls;
      const pc = [shc[0], shc[1], shc[2], shc[3] * a * 0.7];
      // trunk: a side profile laid down away from the sun
      SHAD.add(F.pside[p.k % 2], p.x, p.y, -ay * p.r * 2.2, ax * p.r * 2.2, ax * len * 1.0, ay * len * 1.0, 0.5, 0.0, [pc[0], pc[1], pc[2], pc[3] * 0.9]);
      // crown, stretched along the shadow
      const cx = p.x + ax * len * 0.74, cy = p.y + ay * len * 0.74, d = p.r * 2.4;
      SHAD.add(F.ptop[p.k], cx, cy, ax * d * (1 + Ls * 0.35), ay * d * (1 + Ls * 0.35), -ay * d, ax * d, 0.5, 0.5, pc);
    }
    // caravan
    const lights = [];
    if (route) {
      for (const m of members) {
        const s = lead - m.off;
        const [x, y, h] = at(route, s);
        if (m.x === null) { m.x = x; m.y = y; m.a = h; }
        m.x += (x - m.x) * 0.5; m.y += (y - m.y) * 0.5;
        let dh = h - m.a; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); m.a += dh * 0.25;
        m.dist = s;
        if (x < -80 || y < -80 || x > W + 80 || y > H + 80) { m.out = true; continue; }
        m.out = false;
      }
      // shadows first: a soft blot under each body, then the long side profile
      for (const m of members) {
        if (m.out) continue;
        const c = Math.cos(m.a), s = Math.sin(m.a);
        if (m.kind === 'walker') {
          const f = Math.floor(((m.dist / 9) % 1 + 1) % 1 * WALK);
          const hh = 20;                                        // a person is ~ 17 px tall at this scale
          SHAD.add(F.wside[f], m.x, m.y, c * 10, s * 10, ax * hh * Ls, ay * hh * Ls, 0.5, 0.0, shc);
        } else {
          const k = m.sc * CAMEL_LEN / 70;                      // atlas px → css px
          const f = Math.floor((((m.dist / 15) + m.ph) % 1 + 1) % 1 * WALK);
          SHAD.add(F.blot, m.x + ax * 3 * Ls * k * 10, m.y + ay * 3 * Ls * k * 10, c * 44 * k, s * 44 * k, -s * 20 * k, c * 20 * k, 0.5, 0.5, [shc[0], shc[1], shc[2], shc[3] * 0.45]);
          // side profile when the sun is to one side, front profile when it walks toward or away from it
          const sn = Math.abs(c * ay - s * ax), w1 = sstep(0.15, 0.75, sn), w0 = 1 - w1;
          if (w1 > 0.01) SHAD.add(F.cside[m.v][f], m.x, m.y, c * SW * k, s * SW * k, ax * SH * k * Ls, ay * SH * k * Ls, 0.5, 0.02, [shc[0], shc[1], shc[2], shc[3] * w1]);
          if (w0 > 0.01) SHAD.add(F.cfront[m.v][f], m.x, m.y, -s * 64 * k, c * 64 * k, ax * SH * k * Ls, ay * SH * k * Ls, 0.5, 0.02, [shc[0], shc[1], shc[2], shc[3] * w0]);
        }
      }
    }
    // hawk shadow
    const hv = hawkVis(nowS);
    let hx = 0, hy = 0, hh = 0;
    if (hv > 0) {
      hx = hawk.cx + Math.cos(hawk.a) * hawk.r; hy = hawk.cy + Math.sin(hawk.a) * hawk.r * 0.8; hh = hawk.a + Math.PI / 2;
      const alt = 26 * Ls + 12, c = Math.cos(hh), s = Math.sin(hh), d = 22;
      SHAD.add(F.hside[0], hx + ax * alt, hy + ay * alt, c * d, s * d, -s * d, c * d, 0.5, 0.5, [shc[0], shc[1], shc[2], shc[3] * 0.55 * hv]);
    }
    // lantern light on the sand
    if (night > 0 && route) for (const m of members) if (!m.out && (m.lantern || m.kind === 'walker')) {
      const r = m.kind === 'walker' ? 34 : 26;
      SHAD.add(F.pool, m.x, m.y, r * 2, 0, 0, r * 2, 0.5, 0.5, [0.55 * night, 0.34 * night, 0.12 * night, 0], true);
      lights.push(m);
    }
    SHAD.draw();

    // bodies
    for (const p of palms) {
      const a = p.vis * p.vis * (3 - 2 * p.vis);
      if (a <= 0) continue;
      const sway = Math.sin(nowS * (0.7 + 0.3 * P.wind) + p.ph) * (0.025 + 0.05 * P.wind);
      BODY.add(F.palm[p.k], p.x, p.y, p.r * 2.9, p.r * 2.9, { rot: p.ph + sway, alpha: a, tint, shade: 1 });
    }
    if (route) {
      // ropes: from each camel's muzzle back to... the one in front leads it: rope from front camel's tail to the next one's head
      for (let i = 1; i < members.length; i++) {
        const a = members[i - 1], b = members[i];
        if (a.out || b.out || b.calf) continue;
        const ka = (a.kind === 'camel' ? a.sc * CAMEL_LEN / 70 : 0), kb = b.sc * CAMEL_LEN / 70;
        const x0 = a.x - Math.cos(a.a) * (a.kind === 'camel' ? 38 * ka : -3), y0 = a.y - Math.sin(a.a) * (a.kind === 'camel' ? 38 * ka : -3);
        const x1 = b.x + Math.cos(b.a) * 60 * kb, y1 = b.y + Math.sin(b.a) * 60 * kb;
        const L = Math.hypot(x1 - x0, y1 - y0);
        BODY.add(F.dot, (x0 + x1) / 2, (y0 + y1) / 2, L, 0.7, { rot: Math.atan2(y1 - y0, x1 - x0), tint: [0.22, 0.14, 0.08], shade: night ? 0.5 : 1, alpha: 0.85 });
      }
      for (const m of members) {
        if (m.out) continue;
        if (m.kind === 'walker') {
          const f = Math.floor(((m.dist / 9) % 1 + 1) % 1 * WALK);
          BODY.add(F.walker[f], m.x, m.y, 12, 12, { rot: m.a, tint });
        } else {
          const k = m.sc * CAMEL_LEN / 70;
          const f = Math.floor((((m.dist / 15) + m.ph) % 1 + 1) % 1 * WALK);
          BODY.add(F.camel[m.v * 4 + m.k][f], m.x, m.y, CW * k, CH * k, { rot: m.a, tint });
        }
      }
      for (const m of lights) {
        const fx = m.kind === 'walker' ? m.x + Math.cos(m.a + 0.9) * 4 : m.x - Math.cos(m.a) * 8 * m.sc;
        const fy = m.kind === 'walker' ? m.y + Math.sin(m.a + 0.9) * 4 : m.y - Math.sin(m.a) * 8 * m.sc;
        const fl = 0.85 + 0.15 * Math.sin(nowS * 9 + m.off);
        BODY.add(F.glow, fx, fy, 16, 16, { tint: [1, 0.7, 0.35], shade: 2.2 * fl * night, alpha: 0.35 });
        BODY.add(F.glow, fx, fy, 4, 4, { tint: [1, 0.95, 0.8], shade: 1.4, alpha: night });
      }
    }
    if (hv > 0) {
      const fl = Math.sin(nowS * 7) > 0.3 && Math.sin(nowS * 0.5) > 0.6 ? Math.floor(nowS * 8) % 4 : 0;
      BODY.add(F.hawk[fl], hx, hy, 24, 24, { rot: hh, alpha: hv, tint });
    }
    BODY.draw();
  }
  function hawkVis(t) {
    if (TOD().night) return 0;
    const c = ((t + 30) % 110) / 110;               // visible for about two thirds of every 110 s
    return sstep(0.0, 0.06, c) * sstep(0.68, 0.6, c);
  }

  // hooks the page fills in
  let TOD = () => ({ shL: 1, shadow: [0, 0, 0, 0.5], sprite: [1, 1, 1], night: 0 }), SUN = () => [1, 0, 0.5, 0.86];
  return {
    init(o) { TOD = o.tod; SUN = o.sun; paint(); },
    reseed() { routeN = 0; route = null; },
    layout(fromEmpty) {
      placePalms(fromEmpty && QS.has('nofade')); placeHawk();
      if (!route || fromEmpty) newRoute(true); else reroute();
    },
    step, draw,
    setLength() { if (route) { const keep = lead; buildMembers(); lead = keep; } },
    debug: () => ({ route, lead, members, palms: palms.length, T, p0: palms[0] }),
  };
})();
