/* Jimothy's D10 Isekai JRPG: a true 3D ten-sided die (a pentagonal trapezohedron), made from exact math, no outside model.
   Opposite faces add up to 9, like a real d10: the top half shows 1 3 5 7 9, the bottom half 8 6 4 2 0.
   Uses: D10.geometry() for the points and faces (for a 3D library or a future dice roller),
         D10.draw(ctx, die, cam) to draw a shaded die with its numbers on a 2D canvas.
   The same shape is saved as assets/models/d10.obj for 3D tools. */
(function () {
  'use strict';
  var C36 = Math.cos(Math.PI / 5), A = 0.105, H = A * (1 + C36) / (1 - C36);   // H makes every kite face perfectly flat
  var geo = null;
  function sub(p, q) { return [p[0] - q[0], p[1] - q[1], p[2] - q[2]]; }
  function cross(p, q) { return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]; }
  function dot(p, q) { return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; }
  function norm(p) { var l = Math.sqrt(dot(p, p)) || 1; return [p[0] / l, p[1] / l, p[2] / l]; }
  function geometry() {
    if (geo) return geo;
    // vertex 0 is the top point, 1 the bottom point, 2..11 the zigzag ring around the middle (radius 1)
    var v = [[0, 0, H], [0, 0, -H]], f = [], j;
    for (var k = 0; k < 10; k++) v.push([Math.cos(k * Math.PI / 5), Math.sin(k * Math.PI / 5), k % 2 ? -A : A]);
    function face(ids, num, apex, sides) {
      var c = [0, 0, 0]; ids.forEach(function (i) { c[0] += v[i][0] / 4; c[1] += v[i][1] / 4; c[2] += v[i][2] / 4; });
      var n = norm(cross(sub(v[ids[1]], v[ids[0]]), sub(v[ids[2]], v[ids[0]])));
      if (dot(n, c) < 0) { ids = [ids[0], ids[3], ids[2], ids[1]]; n = [-n[0], -n[1], -n[2]]; }   // keep every face pointing outward
      f.push({ v: ids, n: n, num: num, apex: apex, sides: sides });
    }
    for (j = 0; j < 5; j++) face([0, 2 + 2 * j, 2 + 2 * j + 1, 2 + (2 * j + 2) % 10], 2 * j + 1, 0, [2 + 2 * j, 2 + (2 * j + 2) % 10]);
    for (j = 0; j < 5; j++) {
      var top = (j + 2) % 5;   // the top face straight across from this one
      face([1, 2 + (2 * j + 9) % 10, 2 + 2 * j, 2 + 2 * j + 1], 9 - (2 * top + 1), 1, [2 + (2 * j + 9) % 10, 2 + 2 * j + 1]);
    }
    geo = { vertices: v, faces: f, height: H, ring: A };
    return geo;
  }
  // rotation from three angles (radians) as a 3x3 matrix
  function rotation(rx, ry, rz) {
    var a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), g = Math.sin(rz);
    return [c * e, -c * g, d, a * g + b * d * e, a * e - b * d * g, -b * c, b * g - a * d * e, b * e + a * d * g, a * c];
  }
  function apply(m, p) { return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]]; }
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.min(255, Math.round(r * k)) + ',' + Math.min(255, Math.round(gg * k)) + ',' + Math.min(255, Math.round(b * k)) + ')';
  }
  var LIGHT = norm([-0.4, -0.6, -0.7]);
  // die: { x, y, z (world, camera looks down +z), size, rot: [rx, ry, rz], color: '#rrggbb', ink: '#rrggbb', alpha }
  // cam: { cx, cy, f } screen center and focal length in pixels
  function draw(ctx, die, cam) {
    var G = geometry(), m = rotation(die.rot[0], die.rot[1], die.rot[2]), s = die.size;
    var W = G.vertices.map(function (p) { var q = apply(m, p); return [die.x + q[0] * s, die.y + q[1] * s, die.z + q[2] * s]; });
    if (W.some(function (p) { return p[2] < 0.05; })) return;
    var P = W.map(function (p) { return [cam.cx + p[0] / p[2] * cam.f, cam.cy + p[1] / p[2] * cam.f]; });
    function proj(p) { return [cam.cx + p[0] / p[2] * cam.f, cam.cy + p[1] / p[2] * cam.f]; }
    ctx.save(); ctx.globalAlpha = die.alpha == null ? 1 : die.alpha; ctx.lineJoin = 'round';
    G.faces.forEach(function (fc) {
      var n = apply(m, fc.n), c = [0, 0, 0];
      fc.v.forEach(function (i) { c[0] += W[i][0] / 4; c[1] += W[i][1] / 4; c[2] += W[i][2] / 4; });
      if (dot(n, c) >= 0) return;   // facing away
      var ld = Math.max(0, dot(n, LIGHT)), lit = 0.42 + 0.68 * ld, spec = Math.pow(ld, 14) * 0.45;
      ctx.beginPath(); fc.v.forEach(function (i, k) { if (k) ctx.lineTo(P[i][0], P[i][1]); else ctx.moveTo(P[i][0], P[i][1]); }); ctx.closePath();
      ctx.fillStyle = shade(die.color, lit + spec); ctx.fill();
      ctx.strokeStyle = shade(die.color, 0.35); ctx.lineWidth = Math.max(0.6, s / c[2] * cam.f * 0.02); ctx.stroke();
      // the number, laid flat on the face with its top toward the face's point
      var sa = W[fc.sides[0]], sb = W[fc.sides[1]], ap = W[fc.apex], mid = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2, (sa[2] + sb[2]) / 2];
      var up = sub(ap, mid), across = norm(sub(sb, sa)), upn = norm(up), len = Math.sqrt(dot(up, up));
      var ctr = [mid[0] + up[0] * 0.2, mid[1] + up[1] * 0.2, mid[2] + up[2] * 0.2];
      if (dot(cross(across, upn), n) > 0) across = [-across[0], -across[1], -across[2]];   // read left to right from outside
      var e = len * 0.01, p0 = proj(ctr), px = proj([ctr[0] + across[0] * e, ctr[1] + across[1] * e, ctr[2] + across[2] * e]), py = proj([ctr[0] - upn[0] * e, ctr[1] - upn[1] * e, ctr[2] - upn[2] * e]);
      var fpx = (Math.abs(px[0] - p0[0]) + Math.abs(px[1] - p0[1]));
      if (fpx * 100 < 3) return;   // too small to read
      ctx.save(); ctx.setTransform(px[0] - p0[0], px[1] - p0[1], py[0] - p0[0], py[1] - p0[1], p0[0], p0[1]);
      ctx.globalAlpha = (die.alpha == null ? 1 : die.alpha) * Math.min(1, lit * 1.3);
      ctx.fillStyle = die.ink || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 34px "Arial Black", Impact, sans-serif';
      ctx.fillText(String(fc.num), 0, 0);
      if (fc.num === 6 || fc.num === 9) ctx.fillRect(-9, 17, 18, 4);   // underline, so 6 and 9 are not mixed up
      ctx.restore();
    });
    ctx.restore();
  }
  // the shape as a Wavefront OBJ (y up), one named group per face so a 3D tool knows which number is where
  function toOBJ() {
    var G = geometry(), out = ['# D10 (pentagonal trapezohedron) for Jimothy\'s D10 Isekai JRPG', '# Opposite faces sum to 9. Groups name the number on each face.', 'o d10'];
    G.vertices.forEach(function (p) { out.push('v ' + p[0].toFixed(6) + ' ' + p[2].toFixed(6) + ' ' + (-p[1]).toFixed(6)); });
    G.faces.forEach(function (fc) { out.push('vn ' + fc.n[0].toFixed(6) + ' ' + fc.n[2].toFixed(6) + ' ' + (-fc.n[1]).toFixed(6)); });
    G.faces.forEach(function (fc, i) { out.push('g face_' + fc.num); out.push('f ' + fc.v.map(function (k) { return (k + 1) + '//' + (i + 1); }).join(' ')); });
    return out.join('\n') + '\n';
  }
  var api = { geometry: geometry, rotation: rotation, draw: draw, toOBJ: toOBJ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.D10 = api;
})();
