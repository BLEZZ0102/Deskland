// Deskland · Rice Terraces — the living layer (sprites.js): farmers walking the bunds, planters and harvesters
// bent over the paddies, egrets wading and flying, a ploughman with his buffalo, hamlets at the forest edge.
// Everything reads the terrain the page reads back after each layout (TD: terrace coordinate, forest, valley floor)
// and keeps clear of the icons. All frames are painted procedurally into one atlas.
// License: GPL-3.0, same as Deskland.
'use strict';

const Life = (() => {
  const S = 4;                                    // atlas pixels per CSS px
  const INSTANT = QS.has('instant');              // test screenshots: no fade-in
  let L = null;
  const F = {};
  let actors = [], ripples = [], huts = [], smokes = [], flock = [];
  let rnd = Math.random, ready = false, vis = 0, stale = false, placedSeason = -1, placedLife = -1;

  /* ---------- terrain queries on the read-back grid ---------- */
  const k = () => TD.k;
  function samp(arr, x, y) {
    const gx = clamp(x / k() - 0.5, 0, TD.w - 1.001), gy = clamp(y / k() - 0.5, 0, TD.h - 1.001);
    const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy, w = TD.w, i = iy * w + ix;
    return lerp(lerp(arr[i], arr[i + 1], fx), lerp(arr[i + w], arr[i + w + 1], fx), fy);
  }
  const tAt = (x, y) => samp(TD.t, x, y);
  const forestAt = (x, y) => samp(TD.forest, x, y);
  const flatAt = (x, y) => samp(TD.flat, x, y);
  function gradAt(x, y) {
    const e = 4;
    return [(tAt(x + e, y) - tAt(x - e, y)) / (2 * e), (tAt(x, y + e) - tAt(x, y - e)) / (2 * e)];
  }
  const inScreen = (x, y, m) => x > m && y > m && x < W - m && y < H - TASKBAR - m;
  // a spot on the terraces where someone may stand: off the icons, out of the forest, terraces neither too wide nor crushed
  function okTerrace(x, y, clear) {
    if (!inScreen(x, y, 10) || iconDist(x, y) < clear || forestAt(x, y) > 0.05) return false;
    const g = gradAt(x, y), gl = Math.hypot(g[0], g[1]);
    return gl > 1 / 110 && gl < 1 / 9;
  }
  const okOpen = (x, y, clear) => inScreen(x, y, 10) && iconDist(x, y) >= clear && forestAt(x, y) < 0.05;
  function findSpot(test, tries = 300) {
    for (let i = 0; i < tries; i++) { const x = rnd() * W, y = rnd() * (H - TASKBAR); if (test(x, y)) return [x, y]; }
    return null;
  }
  // nearest point on the bund (just above the riser at integer t), by Newton steps along the gradient
  function snapBund(a) {
    for (let i = 0; i < 3; i++) {
      const g = gradAt(a.x, a.y), g2 = g[0] * g[0] + g[1] * g[1];
      if (g2 < 1e-8) return false;
      const target = a.level + 1.6 * Math.sqrt(g2);
      const d = (target - tAt(a.x, a.y)) / g2;
      a.x += g[0] * d; a.y += g[1] * d;
    }
    return true;
  }

  /* ---------- atlas ---------- */
  function paint() {
    const rects = [];
    const atlas = makeAtlas(1024, 1024, ctx => {
      let cx = 0, cy = 0, rowH = 0;
      const cell = (name, w, h, fn) => {            // w, h in CSS px; drawn centred, y-up is "forward"
        const aw = w * S, ah = h * S;
        if (cx + aw > 1024) { cx = 0; cy += rowH + 2; rowH = 0; }
        ctx.save(); ctx.translate(cx + aw / 2, cy + ah / 2); ctx.scale(S, S);
        fn(ctx);
        ctx.restore();
        rects.push([name, cx, cy, aw, ah]);
        cx += aw + 2; rowH = Math.max(rowH, ah);
      };
      const ell = (x, y, rx, ry, fill, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
      const soft = (r, a) => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, `rgba(20,24,18,${a})`); g.addColorStop(1, 'rgba(20,24,18,0)'); ctx.fillStyle = g; ctx.fillRect(-r, -r, 2 * r, 2 * r); };
      // conical straw hat seen from above: woven, lit from the upper left
      const hat = (x, y, r, sy = 1) => {
        ctx.save(); ctx.translate(x, y); ctx.scale(1, sy);
        const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r);
        g.addColorStop(0, '#f8eecb'); g.addColorStop(0.55, '#e0c88f'); g.addColorStop(1, '#b28f55');
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        ctx.lineWidth = 0.13;
        for (let i = 0; i < 18; i++) {
          const a = i / 18 * Math.PI * 2;
          ctx.strokeStyle = `rgba(110,80,35,${0.18 + 0.12 * Math.max(0, Math.cos(a - 0.9))})`;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15); ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); ctx.stroke();
        }
        const sh = ctx.createLinearGradient(-r, -r, r, r);
        sh.addColorStop(0.45, 'rgba(60,40,15,0)'); sh.addColorStop(1, 'rgba(60,40,15,0.35)');
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = sh; ctx.fill();
        ctx.lineWidth = 0.28; ctx.strokeStyle = 'rgba(95,68,30,0.75)'; ctx.stroke();
        ell(0, 0, r * 0.12, r * 0.12, '#fff6dc');
        ctx.restore();
      };
      const SHIRT = ['#2f3a5c', '#3b4c6e', '#4a3a52', '#2e4a4a'];
      // walkers: 4 stride phases x 4 shirt colours
      for (let c = 0; c < 4; c++) for (let ph = 0; ph < 4; ph++) cell(`walk${c}_${ph}`, 14, 14, () => {
        const sw = Math.sin(ph / 4 * Math.PI * 2);
        ell(-1.1, -2.6 * sw, 0.8, 1.2, '#2a2420'); ell(1.1, 2.6 * sw, 0.8, 1.2, '#2a2420');           // feet
        ell(-3.4, 1.6 * sw, 1.1, 2.0, SHIRT[c]); ell(3.4, -1.6 * sw, 1.1, 2.0, SHIRT[c]);             // arms
        ell(-3.5, 1.6 * sw - 1.8, 0.6, 0.6, '#c99a70'); ell(3.5, -1.6 * sw - 1.8, 0.6, 0.6, '#c99a70');
        ell(0, 0.4, 3.6, 2.0, SHIRT[c]);
        hat(0, -0.3, 4.2);
      });
      // carriers: shoulder pole with two baskets (seedlings in spring, sheaves in autumn)
      for (const [nm, load] of [['carryG', '#6f9a3a'], ['carryY', '#d9b04a']]) for (let ph = 0; ph < 2; ph++) cell(`${nm}_${ph}`, 22, 14, () => {
        const sw = ph ? 1 : -1;
        ell(-1.1, -2.2 * sw, 0.8, 1.2, '#2a2420'); ell(1.1, 2.2 * sw, 0.8, 1.2, '#2a2420');
        ell(0, 0.4, 3.6, 2.0, SHIRT[0]);
        ctx.strokeStyle = '#6a4c28'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-9, 0.2); ctx.lineTo(9, 0.2); ctx.stroke();
        for (const bx of [-8.2, 8.2]) {
          ell(bx, 0.2, 2.6, 2.6, '#9c7742'); ell(bx, 0.2, 2.0, 2.0, load);
          ctx.strokeStyle = 'rgba(70,50,20,0.6)'; ctx.lineWidth = 0.25; ctx.beginPath(); ctx.arc(bx, 0.2, 2.6, 0, Math.PI * 2); ctx.stroke();
          for (let i = 0; i < 6; i++) { const a = i * 1.05; ell(bx + Math.cos(a) * 1.1, 0.2 + Math.sin(a) * 1.1, 0.45, 0.45, 'rgba(255,255,230,0.25)'); }
        }
        hat(0, -0.3, 4.2);
      });
      // bent over the paddy: back and shoulders behind, hat tipped forward, hands in the water
      for (let c = 0; c < 2; c++) for (let ph = 0; ph < 2; ph++) cell(`bend${c}_${ph}`, 14, 16, () => {
        const a = ph ? 0.7 : -0.7;
        ell(0, 3.2, 3.3, 3.6, SHIRT[c + 1]);
        ell(-2.4 + a * 0.3, -3.4, 0.9, 2.1, SHIRT[c + 1], 0.3); ell(2.4 + a * 0.3, -3.4, 0.9, 2.1, SHIRT[c + 1], -0.3);
        ell(-1.6 + a, -5.4, 0.6, 0.6, '#c99a70'); ell(1.6 + a, -5.2, 0.6, 0.6, '#c99a70');
        hat(0, -1.4, 4.0, 0.82);
      });
      // generic soft shadow
      cell('shadow', 16, 16, () => soft(7.5, 0.42));
      // egrets
      const egretBody = (neck) => {
        ell(0, 1.2, 1.5, 3.6, '#fbfbf6');
        const g = ctx.createLinearGradient(-1.5, 0, 1.6, 2);
        g.addColorStop(0.3, 'rgba(160,170,175,0)'); g.addColorStop(1, 'rgba(150,160,168,0.6)');
        ctx.beginPath(); ctx.ellipse(0, 1.2, 1.5, 3.6, 0, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        ell(0, 4.8, 0.7, 1.4, '#ecefee');                                           // tail plumes
        ctx.strokeStyle = '#f4f5f1'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, -1.6); ctx.quadraticCurveTo(0.9, -1.6 - neck * 0.5, 0.1, -2.2 - neck); ctx.stroke();
        ell(0.1, -2.4 - neck, 0.75, 0.9, '#fafaf5');
        ctx.strokeStyle = '#e2b737'; ctx.lineWidth = 0.42; ctx.beginPath(); ctx.moveTo(0.1, -3.0 - neck); ctx.lineTo(0.15, -4.9 - neck); ctx.stroke();
      };
      cell('egret0', 10, 18, () => egretBody(1.6));
      cell('egret1', 10, 18, () => egretBody(3.6));
      // flying egret: 4 wing phases (seen from above, neck folded, legs trailing)
      const SPAN = [11, 8.5, 4.5, 9.5], BEND = [0.2, -0.9, -1.6, 0.9];
      for (let ph = 0; ph < 4; ph++) cell(`fly${ph}`, 26, 18, () => {
        const sp = SPAN[ph], b = BEND[ph];
        for (const sd of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(0, -1.4);
          ctx.quadraticCurveTo(sd * sp * 0.5, -2.6 + b, sd * sp, -0.6 + b * 1.4);
          ctx.quadraticCurveTo(sd * sp * 0.55, 1.4 + b * 0.6, 0, 1.6);
          ctx.closePath(); ctx.fillStyle = '#f7f8f4'; ctx.fill();
          ctx.strokeStyle = 'rgba(140,150,158,0.55)'; ctx.lineWidth = 0.25; ctx.stroke();
        }
        ell(0, 0.6, 1.0, 2.9, '#ffffff');
        ell(0, -2.4, 0.8, 0.9, '#fbfbf7');
        ctx.strokeStyle = '#e2b737'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(0, -3.1); ctx.lineTo(0, -4.8); ctx.stroke();
        ctx.strokeStyle = '#2b2a26'; ctx.lineWidth = 0.28; ctx.beginPath(); ctx.moveTo(-0.3, 3.2); ctx.lineTo(-0.3, 6.6); ctx.moveTo(0.3, 3.2); ctx.lineTo(0.3, 6.6); ctx.stroke();
      });
      cell('flyshadow', 26, 18, () => { ctx.scale(1, 0.55); soft(9, 0.30); });
      // water ripple
      cell('ripple', 16, 16, () => {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.55; ctx.beginPath(); ctx.arc(0, 0, 6.6, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(60,70,80,0.35)'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(0.2, 0.3, 7.2, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(0, 0, 4.4, 0, Math.PI * 2); ctx.stroke();
      });
      // Hani "mushroom" houses: thick hipped thatch roofs, plus a round granary
      const hut = (w, h, tone, round) => {
        // cast shadow
        ctx.save(); ctx.translate(2.6, 3.2); ctx.filter = 'blur(1.2px)'; ctx.fillStyle = 'rgba(20,22,14,0.45)';
        if (round) { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 2.5); ctx.fill(); }
        ctx.restore();
        const [lit, mid, dark] = tone;
        if (round) {
          const g = ctx.createRadialGradient(-w * 0.15, -w * 0.18, 0.5, 0, 0, w / 2);
          g.addColorStop(0, lit); g.addColorStop(0.6, mid); g.addColorStop(1, dark);
          ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
          ctx.lineWidth = 0.18;
          for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, r0 = w * 0.08, r1 = w * (0.42 + 0.07 * Math.random());
            ctx.strokeStyle = `rgba(70,52,25,${0.2 + 0.2 * Math.random()})`; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke(); }
          ctx.lineWidth = 0.35; ctx.strokeStyle = 'rgba(60,44,20,0.7)'; ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.stroke();
          ell(0, 0, 0.9, 0.9, dark);
          return;
        }
        const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2, rx = w * 0.22;
        const faces = [   // [polygon, shade, thatch direction]: top and left faces catch the light
          [[[x0, y0], [x1, y0], [rx, 0], [-rx, 0]], lit, [0, 1]],
          [[[x0, y0], [-rx, 0], [x0, y1]], lit, [1, 0]],
          [[[x1, y0], [x1, y1], [rx, 0]], dark, [1, 0]],
          [[[x0, y1], [-rx, 0], [rx, 0], [x1, y1]], mid, [0, 1]],
        ];
        ctx.save(); ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 2.2); ctx.clip();
        for (const [poly, c, [ux, uy]] of faces) {
          ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = c; ctx.fill();
          ctx.save(); ctx.clip();
          ctx.lineWidth = 0.16;
          for (let i = 0; i < 90; i++) {                      // thatch strokes running down the slope
            const px = x0 + Math.random() * w, py = y0 + Math.random() * h, len = 1.0 + Math.random() * 1.6;
            ctx.strokeStyle = `rgba(${Math.random() < 0.55 ? '70,52,26' : '255,245,210'},${0.12 + 0.2 * Math.random()})`;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ux * len, py + uy * len); ctx.stroke();
          }
          ctx.restore();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(60,42,20,0.55)'; ctx.lineWidth = 0.22;
        ctx.beginPath(); ctx.moveTo(x0 + 0.6, y0 + 0.6); ctx.lineTo(-rx, 0); ctx.lineTo(x0 + 0.6, y1 - 0.6); ctx.moveTo(x1 - 0.6, y0 + 0.6); ctx.lineTo(rx, 0); ctx.lineTo(x1 - 0.6, y1 - 0.6); ctx.stroke();
        ctx.strokeStyle = 'rgba(80,60,30,0.9)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(-rx, 0); ctx.lineTo(rx, 0); ctx.stroke();
        ctx.lineWidth = 0.35; ctx.strokeStyle = 'rgba(55,40,18,0.75)'; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 2.2); ctx.stroke();
      };
      const THATCH = [['#cdb98a', '#a38c60', '#6f5d3e'], ['#b9ad90', '#8e8470', '#5f584a'], ['#c4ab78', '#977d52', '#66543a']];
      cell('hut0', 30, 30, () => hut(15, 12.5, THATCH[0], false));
      cell('hut1', 30, 30, () => hut(13, 11.5, THATCH[1], false));
      cell('hut2', 30, 30, () => hut(16.5, 13, THATCH[2], false));
      cell('hut3', 22, 22, () => hut(8.5, 8.5, THATCH[0], true));
      // water buffalo, from above, walking (2 phases)
      for (let ph = 0; ph < 2; ph++) cell(`buff${ph}`, 18, 26, () => {
        const sw = ph ? 1 : -1;
        for (const [lx, ly] of [[-2.6, -4.5], [2.6, -4.5], [-2.6, 4.2], [2.6, 4.2]]) ell(lx, ly + sw * (lx * ly > 0 ? 0.9 : -0.9), 1.0, 1.5, '#2b2725');
        const g = ctx.createRadialGradient(-1.2, -1.5, 0.5, 0, 0, 7.5);
        g.addColorStop(0, '#6d6660'); g.addColorStop(0.7, '#48423e'); g.addColorStop(1, '#34302d');
        ctx.beginPath(); ctx.ellipse(0, 0.5, 3.8, 6.4, 0, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        ell(0, -6.9, 2.0, 2.4, '#3f3a36');
        ell(0, -8.6, 1.3, 0.9, '#5a524c');
        ctx.strokeStyle = '#d8cdb0'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-1.2, -7.2); ctx.quadraticCurveTo(-4.8, -7.8, -4.6, -4.8); ctx.moveTo(1.2, -7.2); ctx.quadraticCurveTo(4.8, -7.8, 4.6, -4.8); ctx.stroke();
        ctx.strokeStyle = '#2d2926'; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(0, 6.6); ctx.quadraticCurveTo(0.8 * sw, 8.4, 0.2 * sw, 10); ctx.stroke();
      });
      cell('buffshadow', 18, 26, () => { ctx.scale(0.62, 1); soft(8.5, 0.42); });
      cell('smoke', 16, 16, () => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 7.5); g.addColorStop(0, 'rgba(236,238,236,0.55)'); g.addColorStop(1, 'rgba(236,238,236,0)'); ctx.fillStyle = g; ctx.fillRect(-8, -8, 16, 16); });
    });
    L = new SpriteLayer(atlas.canvas, 1024);
    for (const [name, x, y, w, h] of rects) F[name] = { id: L.def(x, y, w, h), w: w / S, h: h / S };
  }
  function put(name, x, y, o) { const f = F[name]; if (f) L.add(f.id, x, y, f.w * (o && o.s || 1), f.h * (o && o.s || 1), o); }

  /* ---------- placing the cast ---------- */
  const seasonNow = () => Math.round(P.season);
  function spawnWalker(type) {
    const sp = findSpot((x, y) => okTerrace(x, y, 34));
    if (!sp) return null;
    const a = { kind: 'walk', type, x: sp[0], y: sp[1], level: Math.round(tAt(sp[0], sp[1])), dir: rnd() < 0.5 ? -1 : 1,
      speed: 4 + rnd() * 4, phase: rnd() * 4, pause: rnd() * 3, ang: 0, shirt: (rnd() * 4) | 0, a: 0, bob: rnd() * 6 };
    if (!snapBund(a) || !okTerrace(a.x, a.y, 30)) return null;
    return a;
  }
  function spawnBender(type) {
    const sp = findSpot((x, y) => okTerrace(x, y, 34) || (flatAt(x, y) > 0.6 && okOpen(x, y, 40)));
    if (!sp) return null;
    return { kind: 'bend', type, x: sp[0], y: sp[1], ang: rnd() * 6.28, shirt: (rnd() * 2) | 0, t: rnd() * 10, a: 0, rip: rnd() * 3 };
  }
  function spawnEgret() {
    const sp = findSpot((x, y) => okOpen(x, y, 30) && (flatAt(x, y) > 0.5 || okTerrace(x, y, 30)));
    if (!sp) return null;
    return { kind: 'egret', x: sp[0], y: sp[1], ang: rnd() * 6.28, t: rnd() * 10, feed: 0, a: 0, step: 0, rip: rnd() * 5 };
  }
  function spawnPlough() {
    const sp = findSpot((x, y) => flatAt(x, y) > 0.85 && okOpen(x, y, 70), 500);
    if (!sp) return null;
    const ang = rnd() * 6.28;
    return { kind: 'plough', x0: sp[0], y0: sp[1], ang, u: 0, dir: 1, len: 40 + rnd() * 30, a: 0, t: 0, rip: 0 };
  }
  function placeHuts() {
    huts = []; smokes = [];
    const villages = 1 + (P.life > 0.6 ? 1 : 0);
    for (let v = 0; v < villages; v++) {
      const c = findSpot((x, y) => { const f = forestAt(x, y); return f > 0.05 && f < 0.6 && iconDist(x, y) > 70 && inScreen(x, y, 40); }, 800);
      if (!c) break;
      const n = 3 + ((rnd() * 4) | 0);
      for (let i = 0; i < n * 4 && huts.filter(h => h.v === v).length < n; i++) {
        const x = c[0] + (rnd() - 0.5) * 70, y = c[1] + (rnd() - 0.5) * 60;
        if (iconDist(x, y) < 40 || !inScreen(x, y, 16) || forestAt(x, y) > 0.85) continue;
        if (huts.some(h => Math.hypot(h.x - x, h.y - y) < 17)) continue;
        huts.push({ v, x, y, f: rnd() < 0.2 ? 'hut3' : 'hut' + ((rnd() * 3) | 0), ang: (rnd() - 0.5) * 0.8 + (rnd() < 0.3 ? Math.PI / 2 : 0) });
      }
      const hs = huts.filter(h => h.v === v && h.f !== 'hut3');
      if (hs.length) smokes.push({ x: hs[0].x + 2, y: hs[0].y - 2, t: 0, puffs: [] });
    }
  }
  function cast() {
    const sn = seasonNow(), life = P.life;
    rnd = mulberry32(seed * 13 + 7 + sn * 101);
    actors = []; ripples = [];
    const add = a => { if (a) actors.push(a); };
    const nW = Math.round(2 + life * 9), nB = Math.round(life * 6), nE = Math.round((sn === 0 ? 3 : 1) + life * (sn === 0 ? 12 : 5));
    for (let i = 0; i < nW; i++) add(spawnWalker(rnd() < (sn === 1 ? 0.15 : 0.4) ? (sn === 2 ? 'carryY' : 'carryG') : 'walk'));
    for (let i = 0; i < nB; i++) add(spawnBender('bend'));
    for (let i = 0; i < nE; i++) add(spawnEgret());
    if (sn === 0 && life > 0.25) add(spawnPlough());
    placeHuts();
    placedSeason = sn; placedLife = life;
  }
  // after a layout change keep whoever still stands somewhere sensible, re-cast the rest
  function revalidate() {
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      let ok = true;
      if (a.kind === 'walk') { a.level = Math.round(tAt(a.x, a.y)); ok = snapBund(a) && okTerrace(a.x, a.y, 30); }
      else if (a.kind === 'plough') ok = okOpen(a.x0, a.y0, 70) && flatAt(a.x0, a.y0) > 0.7;
      else if (a.kind === 'egret' && a.fly) ok = true;
      else ok = okOpen(a.x, a.y, 30);
      if (!ok) {
        const n = a.kind === 'walk' ? spawnWalker(a.type) : a.kind === 'bend' ? spawnBender(a.type) : a.kind === 'egret' ? spawnEgret() : spawnPlough();
        if (n) actors[i] = n; else actors[i].dead = true;
      }
    }
    actors = actors.filter(a => !a.dead);
    placeHuts();
  }

  /* ---------- behaviour ---------- */
  function stepWalker(a, dt) {
    if (a.pause > 0) { a.pause -= dt; return; }
    const g = gradAt(a.x, a.y), gl = Math.hypot(g[0], g[1]) || 1e-6;
    const tx = -g[1] / gl * a.dir, ty = g[0] / gl * a.dir;
    const nx = a.x + tx * a.speed * dt, ny = a.y + ty * a.speed * dt;
    const b = { x: nx, y: ny, level: a.level };
    if (!snapBund(b) || !okTerrace(b.x, b.y, 28) || Math.hypot(b.x - a.x, b.y - a.y) > a.speed * dt * 3 + 1) {
      a.dir = -a.dir; a.pause = 1 + rnd() * 3; return;
    }
    a.x = b.x; a.y = b.y;
    a.phase += dt * a.speed * 0.42;
    const want = Math.atan2(ty, tx) + Math.PI / 2;
    let d = want - a.ang; d = Math.atan2(Math.sin(d), Math.cos(d)); a.ang += d * Math.min(1, dt * 6);
    if (rnd() < dt * 0.04) a.pause = 2 + rnd() * 5;
    if (rnd() < dt * 0.01) { a.dir = -a.dir; a.pause = 1; }
  }
  function ripple(x, y, sz = 1) { if (ripples.length < 120) ripples.push({ x, y, t: 0, sz }); }
  const wet = () => season < 0.5;
  function step(dt) {
    if (!ready || !TD.ok) return;
    if (seasonNow() !== placedSeason || P.life !== placedLife) { if (vis < 0.02) cast(); }
    const want = stale || seasonNow() !== placedSeason || P.life !== placedLife ? 0 : 1;
    vis += (want - vis) * Math.min(1, dt * 2.5);
    if (INSTANT && want) vis = 1;
    for (const a of actors) {
      a.a = INSTANT ? 1 : Math.min(1, a.a + dt * 0.8);
      if (a.kind === 'walk') stepWalker(a, dt);
      else if (a.kind === 'bend') {
        a.t += dt;
        if (rnd() < dt * 0.2) { a.x += Math.cos(a.ang) * 1.5; a.y += Math.sin(a.ang) * 1.5; if (!okOpen(a.x, a.y, 30)) a.ang += Math.PI; }
        a.rip -= dt; if (a.rip < 0 && wet()) { ripple(a.x + Math.cos(a.ang - 1.57) * 4, a.y + Math.sin(a.ang - 1.57) * 4, 0.7); a.rip = 1.5 + rnd() * 2.5; }
      } else if (a.kind === 'egret') stepEgret(a, dt);
      else if (a.kind === 'plough') {
        a.t += dt; a.u += a.dir * dt * 3.2;
        if (Math.abs(a.u) > a.len) { a.dir = -a.dir; a.u = Math.sign(a.u) * a.len; }
        a.rip -= dt; if (a.rip < 0) { const p = ploughPos(a, 0); ripple(p[0], p[1], 1.1); a.rip = 0.9; }
      }
    }
    for (const r of ripples) r.t += dt;
    ripples = ripples.filter(r => r.t < 3.2);
    for (const s of smokes) {
      s.t += dt;
      if (s.t > 0.9) { s.t = 0; s.puffs.push({ x: s.x, y: s.y, t: 0 }); }
      for (const p of s.puffs) { p.t += dt; p.x += dt * (3 + 3 * P.wind); p.y -= dt * 1.2; }
      s.puffs = s.puffs.filter(p => p.t < 9);
    }
  }
  function ploughPos(a, back) {
    const c = Math.cos(a.ang), s = Math.sin(a.ang), u = a.u - back * a.dir;
    return [a.x0 + c * u, a.y0 + s * u];
  }
  function stepEgret(a, dt) {
    a.t += dt;
    if (a.fly) {                                           // a slow glide on a curve to a new paddy
      const f = a.fly; f.u += dt / f.dur;
      const u = Math.min(f.u, 1), e = u * u * (3 - 2 * u);
      const x = lerp(lerp(f.x0, f.cx, e), lerp(f.cx, f.x1, e), e), y = lerp(lerp(f.y0, f.cy, e), lerp(f.cy, f.y1, e), e);
      a.ang = Math.atan2(y - a.y, x - a.x) + Math.PI / 2 || a.ang;
      a.x = x; a.y = y;
      a.alt = Math.sin(u * Math.PI);
      if (f.u >= 1) { a.fly = null; a.alt = 0; ripple(a.x, a.y, 1); }
      return;
    }
    a.rip -= dt;
    if (a.t > 2.5 + (a.k || 0)) {                         // alternate: look up, stalk a step, dip for food
      a.t = 0; a.k = rnd() * 4;
      const r = rnd();
      if (r < 0.35) { a.feed = 1; if (wet()) ripple(a.x + Math.sin(a.ang) * 5, a.y - Math.cos(a.ang) * 5, 0.5); }
      else if (r < 0.75) { a.feed = 0; a.ang += (rnd() - 0.5) * 1.6; const nx = a.x + Math.sin(a.ang) * 3, ny = a.y - Math.cos(a.ang) * 3; if (okOpen(nx, ny, 28)) { a.x = nx; a.y = ny; } }
      else if (r < 0.79 + 0.04 * P.life) {               // take off
        const d = findSpot((x, y) => okOpen(x, y, 30) && Math.hypot(x - a.x, y - a.y) > 160 && Math.hypot(x - a.x, y - a.y) < 600, 80);
        if (d && pathClear(a.x, a.y, d[0], d[1])) {
          const mx = (a.x + d[0]) / 2 + (rnd() - 0.5) * 120, my = (a.y + d[1]) / 2 + (rnd() - 0.5) * 120;
          a.fly = { x0: a.x, y0: a.y, x1: d[0], y1: d[1], cx: mx, cy: my, u: 0, dur: Math.hypot(d[0] - a.x, d[1] - a.y) / 55 };
          a.feed = 0;
        }
      } else a.feed = 0;
    }
  }
  function pathClear(x0, y0, x1, y1) {
    for (let i = 1; i < 12; i++) { const u = i / 12; if (iconDist(lerp(x0, x1, u), lerp(y0, y1, u)) < 24) return false; }
    return true;
  }

  /* ---------- drawing ---------- */
  function draw() {
    if (!ready || !TD.ok || vis < 0.01) { if (L) L.draw(); return; }
    const sx = 1.8, sy = 2.4;                             // shadows fall away from the sun (upper left)
    const al = a => vis * (a.a !== undefined ? a.a : 1);
    // ground level: ripples, hut shadows are part of the hut frames
    for (const r of ripples) {
      const u = r.t / 3.2, s = (0.35 + 1.5 * u) * r.sz;
      put('ripple', r.x, r.y, { s, alpha: vis * (1 - u) * (1 - u) * 0.8 });
    }
    for (const h of huts) put(h.f, h.x, h.y, { rot: h.ang, alpha: vis });
    for (const sm of smokes) for (const p of sm.puffs) { const u = p.t / 9; put('smoke', p.x, p.y, { s: 0.4 + 1.6 * u, alpha: vis * Math.sin(Math.PI * Math.min(1, u * 1.2)) * 0.55 }); }
    // shadows of everyone on the ground
    for (const a of actors) {
      if (a.kind === 'egret' && a.fly) continue;
      if (a.kind === 'plough') { const p = ploughPos(a, 0), q = ploughPos(a, 16); put('buffshadow', p[0] + sx, p[1] + sy, { rot: a.ang + (a.dir > 0 ? Math.PI / 2 : -Math.PI / 2), alpha: al(a) }); put('shadow', q[0] + sx, q[1] + sy, { s: 0.7, alpha: al(a) }); continue; }
      put('shadow', a.x + sx, a.y + sy, { s: a.kind === 'egret' ? 0.55 : 0.85, alpha: al(a) * 0.9 });
    }
    for (const a of actors) {
      if (a.kind === 'walk') {
        const ph = Math.floor(a.phase) & 3, fr = a.type === 'walk' ? `walk${a.shirt}_${a.pause > 0 ? 0 : ph}` : `${a.type}_${a.pause > 0 ? 0 : ph & 1}`;
        put(fr, a.x, a.y, { rot: a.ang, alpha: al(a), s: 1.05 });
      } else if (a.kind === 'bend') {
        put(`bend${a.shirt}_${Math.floor(a.t * 0.8) & 1}`, a.x, a.y, { rot: a.ang, alpha: al(a), s: 1.0 });
      } else if (a.kind === 'egret' && !a.fly) {
        put(a.feed ? 'egret1' : 'egret0', a.x, a.y, { rot: a.ang, alpha: al(a), s: 1.05 });
      } else if (a.kind === 'plough') {
        const p = ploughPos(a, 0), q = ploughPos(a, 16), r = a.ang + (a.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        put(`buff${Math.floor(a.t * 1.6) & 1}`, p[0], p[1], { rot: r, alpha: al(a), s: 1.05 });
        put(`walk1_${Math.floor(a.t * 1.6) & 3}`, q[0], q[1], { rot: r, alpha: al(a), s: 1.0 });
      }
    }
    // birds in the air last, their shadows far below
    for (const a of actors) if (a.kind === 'egret' && a.fly) {
      const h = 6 + 40 * a.alt;
      put('flyshadow', a.x + sx * h * 0.4, a.y + sy * h * 0.4, { rot: a.ang, alpha: al(a) * 0.6, s: 0.8 });
      put(`fly${Math.floor(a.t * 4.5) & 3}`, a.x, a.y, { rot: a.ang, alpha: al(a), s: 1.0 + 0.25 * a.alt });
    }
    L.draw();
  }

  return {
    init() { paint(); ready = true; },
    reset() { actors = []; huts = []; smokes = []; ripples = []; placedSeason = -1; },
    onLayout() { stale = true; },
    onTerrain() {
      if (!ready) return;
      if (placedSeason < 0 || !actors.length) cast(); else revalidate();
      stale = false;
    },
    step, draw,
    dbg: () => ({ n: actors.length, kinds: actors.map(a => a.kind[0]).join(''), vis: +vis.toFixed(2), stale, huts: huts.length, td: TD.ok, ps: placedSeason, first: actors[0] && [actors[0].x | 0, actors[0].y | 0, actors[0].a] }),
  };
})();
