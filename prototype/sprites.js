// Deskland · sprite layer for astro-core.js themes
// Small moving things (leaves, people, animals, birds) drawn as instanced textured quads on the SAME WebGL canvas,
// right after the theme's full-screen pass (use the theme's `after(now)` hook). Each sprite only touches its own
// pixels, so hundreds cost far less than looping over objects in the full-screen shader.
// Being on the same canvas, sprites appear in share images and videos too.
//
// Usage (after astro-core.js, before the theme's boot()):
//   const atlas = makeAtlas(1024, 1024, (ctx) => { ...paint frames with Canvas 2D... });
//   const L = new SpriteLayer(atlas.canvas);
//   const LEAF = L.def(0, 0, 64, 64);              // a frame: rect in atlas pixels; returns an index
//   boot({ ..., after(now) { L.add(LEAF, x, y, 24, 24, { rot, alpha, tint: [r,g,b], shade }); L.draw(); } });
// Coordinates are CSS px (same as fragPx() / icons), (x, y) is the sprite centre unless `ax`/`ay` anchor is given.
// License: GPL-3.0, same as Deskland.
'use strict';

// Paint an atlas with Canvas 2D. Paint at 2x the largest on-screen size for crisp downscaling (mipmaps are built).
function makeAtlas(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  paint(ctx, c);
  return { canvas: c, ctx };
}

class SpriteLayer {
  constructor(atlasCanvas, max = 1024) {
    this.max = max;
    this.n = 0;
    this.frames = [];
    this.data = new Float32Array(max * 16);
    this.aw = atlasCanvas.width; this.ah = atlasCanvas.height;
    const vs = `#version 300 es
layout(location = 0) in vec4 aPos;    // centre x, y (CSS px), w, h
layout(location = 1) in vec4 aUV;     // u0, v0, u1, v1
layout(location = 2) in vec4 aRot;    // angle (rad), alpha, shade (brightness), anchor packing: ax + ay*16 (0..1 each, 4 bits)
layout(location = 3) in vec4 aTint;   // rgb multiply, a = how much of the tint to apply
uniform vec2 uRes;                    // canvas size in CSS px
out vec2 vUV; out vec4 vCol; out float vA;
void main() {
  int id = gl_VertexID % 6;
  vec2 q = vec2((id == 1 || id == 2 || id == 4) ? 1.0 : 0.0, (id == 2 || id == 4 || id == 5) ? 1.0 : 0.0);
  float an = aRot.w;
  vec2 anchor = vec2(mod(an, 16.0), floor(an / 16.0)) / 15.0;
  vec2 l = (q - anchor) * aPos.zw;
  float c = cos(aRot.x), s = sin(aRot.x);
  vec2 p = aPos.xy + vec2(c * l.x - s * l.y, s * l.x + c * l.y);
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  vUV = mix(aUV.xy, aUV.zw, q);
  vCol = vec4(mix(vec3(1.0), aTint.rgb, aTint.a) * aRot.z, 1.0);
  vA = aRot.y;
}`;
    const fs = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
uniform float uAppear;
in vec2 vUV; in vec4 vCol; in float vA;
out vec4 o;
void main() {
  vec4 t = texture(uAtlas, vUV);         // premultiplied
  o = vec4(t.rgb * vCol.rgb, t.a) * vA * uAppear;
}`;
    const mk = (type, src) => {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(sh)); throw new Error('sprite shader'); }
      return sh;
    };
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    this.uRes = gl.getUniformLocation(p, 'uRes'); this.uAtlas = gl.getUniformLocation(p, 'uAtlas'); this.uAppear = gl.getUniformLocation(p, 'uAppear');

    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(prevVao);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // the main pass binds the noise texture to unit 0 without rebinding; restore it after creating ours
    if (typeof noiseTex !== 'undefined' && noiseTex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex); }
  }
  // Re-upload after repainting the atlas canvas (e.g. a palette change).
  update(atlasCanvas) {
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  // Define a frame from an atlas rect (atlas pixels). Half-texel inset avoids bleeding from neighbours.
  def(sx, sy, sw, sh) {
    this.frames.push([(sx + 0.5) / this.aw, (sy + 0.5) / this.ah, (sx + sw - 0.5) / this.aw, (sy + sh - 0.5) / this.ah]);
    return this.frames.length - 1;
  }
  // Queue one sprite. o: { rot, alpha, shade, tint:[r,g,b], tintAmt, ax, ay, flip }  (ax/ay anchor 0..1, default 0.5)
  add(frame, x, y, w, h, o) {
    if (this.n >= this.max) return;
    const f = this.frames[frame]; if (!f) return;
    const d = this.data, i = this.n++ * 16;
    const ax = o && o.ax !== undefined ? o.ax : 0.5, ay = o && o.ay !== undefined ? o.ay : 0.5;
    const flip = o && o.flip;
    d[i] = x; d[i + 1] = y; d[i + 2] = w; d[i + 3] = h;
    d[i + 4] = flip ? f[2] : f[0]; d[i + 5] = f[1]; d[i + 6] = flip ? f[0] : f[2]; d[i + 7] = f[3];
    d[i + 8] = o && o.rot || 0;
    d[i + 9] = o && o.alpha !== undefined ? o.alpha : 1;
    d[i + 10] = o && o.shade !== undefined ? o.shade : 1;
    d[i + 11] = Math.round(clamp(ax, 0, 1) * 15) + 16 * Math.round(clamp(ay, 0, 1) * 15);
    const t = o && o.tint;
    d[i + 12] = t ? t[0] : 1; d[i + 13] = t ? t[1] : 1; d[i + 14] = t ? t[2] : 1;
    d[i + 15] = t ? (o.tintAmt !== undefined ? o.tintAmt : 1) : 0;
  }
  // Draw everything queued since the last draw(), in queue order (queue shadows first, then bodies), then clear.
  draw() {
    if (!this.n) return;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * 16);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.uAtlas, 3);
    gl.uniform2f(this.uRes, cv.width / cv._scale, cv.height / cv._scale);
    gl.uniform1f(this.uAppear, appear * appear * (3 - 2 * appear));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.n);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(prevVao);
    gl.activeTexture(gl.TEXTURE0);
    this.n = 0;
  }
}
