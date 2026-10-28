'use strict';
// =====================================================================================
//  TATANKA KITE & WING — kitesurf y wing foil en mundo libre por la bahía del Puerto de Sagunto.
//  El escenario (escenario.js) es el del juego del wake, con las mismas posiciones. Orilla en z = 80, mar en -Z.
//  Rumbos: +X = sur (Pantalán), -X = norte (Puerto Siles, Canet), -Z = este (mar abierto), +Z = oeste (tierra).
// =====================================================================================
SC.left = -34; SC.right = 34; SC.top = 34; SC.bottom = -34; SC.far = 220; SC.updateProjectionMatrix();
const tmp = { a: V3(), b: V3(), c: V3(), d: V3(), H: V3(), n: V3(), m: new T.Matrix4(), q: new T.Quaternion() };
const DEG = Math.PI / 180;
const angDiff = (a, b) => { let d = b - a; d -= TAU * Math.round(d / TAU); return d; };

// =====================================================================================
//  VIENTO: dirección (de dónde viene) e intensidad, con rachas y roles suaves
// =====================================================================================
const compass = b => V3(-Math.cos(b * DEG), 0, -Math.sin(b * DEG));   // rumbo (0 = N, 90 = E) → vector del mundo
const WINDS = [
  ['garbi', 'Garbí', 120, 'SE · la marinada'], ['levante', 'Levante', 25, 'E · desde el náutico'],
  ['gregal', 'Gregal', 45, 'NE · de Canet'], ['poniente', 'Poniente', 270, 'O · terral, saca mar adentro'],
];
const WIND = { id: 'garbi', name: 'Garbí', dir: 120, kn: 16, knNow: 16, ms: 8, F: V3(), D: V3(), E0: V3() };
try { const w = JSON.parse(localStorage.getItem('kite-wind') || '{}'); if (w.id) { const p = WINDS.find(x => x[0] === w.id); if (p) [WIND.id, WIND.name, WIND.dir] = p; } if (w.kn) WIND.kn = clamp(w.kn, 8, 32); } catch (e) {}
function updateWind(t) {
  const b = WIND.dir + 5 * Math.sin(t * 0.05) + 2.5 * Math.sin(t * 0.23);
  WIND.F.copy(compass(b));                 // de dónde viene
  WIND.D.copy(WIND.F).negate();            // hacia dónde sopla
  WIND.E0.set(-WIND.D.z, 0, WIND.D.x);     // borde de la ventana de viento
  WIND.knNow = WIND.kn * (1 + 0.1 * Math.sin(t * 0.37) + 0.07 * Math.sin(t * 1.13 + 1) + 0.04 * Math.sin(t * 2.9));
  WIND.ms = WIND.knNow * 0.5144;
  U.uChop.value = 0.55 + WIND.kn / 20; U.uCaps.value = clamp((WIND.kn - 10) / 16, 0, 0.8);
}

// polar: qué parte del viento se aprovecha según el ángulo al viento (0 = proa al viento)
function polar(twa) {
  if (twa < 38) return 0;
  if (twa < 60) return lerp(0, 0.85, (twa - 38) / 22);
  if (twa < 100) return lerp(0.85, 1, (twa - 60) / 40);
  if (twa < 150) return lerp(1, 0.8, (twa - 100) / 50);
  return lerp(0.8, 0.55, (twa - 150) / 30);
}
function sailName(twa) { return twa < 38 ? 'PROA AL VIENTO' : twa < 70 ? 'CEÑIDA' : twa < 110 ? 'TRAVÉS' : twa < 150 ? 'LARGO' : 'EMPOPADA'; }

// =====================================================================================
//  MODOS
// =====================================================================================
const MODES = {
  kite: { name: 'KITESURF', k: 0.85, foil: false, knob: 'SALTO' },
  wing: { name: 'WING FOIL', k: 0.8, foil: true, takeoff: 4.4, knob: 'PUMP' },
};
const FOIL_H = 0.55;   // altura de la tabla sobre el agua cuando vuela el foil

// =====================================================================================
//  EL RIDER: riderRoot (posición y rumbo) → trick (giros en el aire) → inner (altura del foil) → tabla y cuerpo
//  riderRoot: +X = hacia donde navega, +Z = su derecha. El cuerpo mira a sotavento (hacia la cometa o el ala)
//  y se da la vuelta (yaw 0 ↔ π) al virar o trasluchar, pasando por mirar hacia delante.
// =====================================================================================
const riderRoot = new T.Group(); scene.add(riderRoot);
const trick = new T.Group(); trick.position.y = 0.9; riderRoot.add(trick);
const inner = new T.Group(); inner.position.y = -0.9; trick.add(inner);
const boardGroup = new T.Group(); inner.add(boardGroup);
const body = new T.Group(); inner.add(body);

// ---- tablas: la de wake (para el kite) y las de foil
const kiteBoard = makeBoardMesh(0);
function makeFoilBoard(len, wid, thick, deck, rail) {
  const g = new T.Group(), sh = new T.Shape(), L = len / 2, W = wid / 2;
  sh.moveTo(-L, -W * 0.92); sh.lineTo(L * 0.25, -W); sh.quadraticCurveTo(L * 0.95, -W * 0.8, L, 0); sh.quadraticCurveTo(L * 0.95, W * 0.8, L * 0.25, W); sh.lineTo(-L, W * 0.92); sh.lineTo(-L, -W * 0.92);
  const geo = new T.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 12 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -thick + 0.02, 0);
  const m = new T.Mesh(geo, [MAT(deck, 0.6), MAT(rail, 0.35)]); m.castShadow = true; g.add(m);
  box(len * 0.55, 0.012, wid * 0.8, MAT(0x2b2f33, 0.9), -L * 0.15, 0.03, 0, g);           // grip de EVA
  // foil: mástil, fuselaje, ala delantera y estabilizador (de carbono negro)
  const carb = MAT(0x15171a, 0.35, 0.4), y0 = -thick;
  box(0.035, 0.85, 0.12, carb, -0.05, y0 - 0.425, 0, g);
  const fus = new T.Mesh(new T.CylinderGeometry(0.022, 0.016, 0.95, 10), carb); fus.rotation.z = Math.PI / 2; fus.position.set(-0.05, y0 - 0.86, 0); g.add(fus);
  const fw = new T.Mesh(new T.SphereGeometry(1, 20, 6), carb); fw.scale.set(0.09, 0.012, 0.45); fw.position.set(0.32, y0 - 0.86, 0); g.add(fw);
  const st = new T.Mesh(new T.SphereGeometry(1, 16, 6), carb); st.scale.set(0.05, 0.01, 0.18); st.position.set(-0.5, y0 - 0.86, 0); g.add(st);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
const wingBoard = makeFoilBoard(1.45, 0.6, 0.11, 0xf2f0ea, 0x19a6c4);
boardGroup.add(kiteBoard, wingBoard);

// ---- el ala de mano (wing): borde de ataque hinchable, tela y botavara central con dos asas
const WING = (() => {
  const g = new T.Group(), S = 1.9, NS = 24, NC = 5;
  const le = x => 0.72 * (1 - (x / S) ** 2), te = x => -0.78 * Math.pow(1 - (x / S) ** 2, 0.8), ar = x => -0.5 * (x / S) ** 2;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= NC; j++) for (let i = 0; i <= NS; i++) {
    const x = (i / NS * 2 - 1) * S, v = j / NC, y = lerp(le(x), te(x), v);
    pos.push(x, y, ar(x) + 0.12 * Math.sin(Math.PI * v) * (1 - (x / S) ** 2)); uv.push(i / NS, v);
  }
  for (let j = 0; j < NC; j++) for (let i = 0; i < NS; i++) { const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  const tex = canvasTex(512, 128, (c, w, h) => {
    c.fillStyle = '#f4f1e8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#19a6c4'; c.fillRect(0, 0, w * 0.18, h); c.fillRect(w * 0.82, 0, w * 0.18, h);
    c.fillStyle = 'rgba(25,166,196,.55)'; c.fillRect(w * 0.4, 0, w * 0.2, h);
    c.fillStyle = '#0d1620'; c.font = 'italic 900 34px Segoe UI, sans-serif'; c.fillText('TATANKA', w * 0.33, h * 0.62);
  });
  const canopy = new T.Mesh(geo, MAT(0xffffff, 0.6, 0, { map: tex, side: T.DoubleSide, transparent: true, opacity: 0.94 })); canopy.castShadow = true; g.add(canopy);
  const lePts = []; for (let i = 0; i <= 20; i++) { const x = (i / 20 * 2 - 1) * S; lePts.push(V3(x, le(x), ar(x))); }
  const tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(lePts), 40, 0.09, 8), MAT(0x0d1620, 0.5)); tube.castShadow = true; g.add(tube);
  const strut = new T.Mesh(new T.TubeGeometry(new T.LineCurve3(V3(0, le(0), 0.02), V3(0, te(0), 0.02)), 4, 0.065, 8), MAT(0x0d1620, 0.5)); g.add(strut);
  const handles = [];
  for (const y of [0.3, -0.35]) { const hm = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.22, 8), MAT(0xff5a4e, 0.5)); hm.position.set(0, y, 0); g.add(hm); handles.push(hm); }
  return { g, handles, hz: 0.13 };
})();
body.add(WING.g);

// ---- la cometa (inventada): de arco, tubo de ataque y costillas, colores de la Tatanka. Líneas de 22 m
const LINE = 22;
const KITE = (() => {
  const g = new T.Group(), Rk = 4.3, A = 1.12, NS = 28, NC = 6;
  const chord = u => lerp(2.5, 0.85, Math.pow(Math.abs(u), 1.6));
  const P = (u, v) => { const ph = u * A, c = chord(u); return V3(Rk * Math.sin(ph), c * 0.42 - v * c, Rk * (Math.cos(ph) - 1) + 0.25 * Math.sin(Math.PI * v) * (1 - Math.abs(u))); };
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= NC; j++) for (let i = 0; i <= NS; i++) { const u = i / NS * 2 - 1, p = P(u, j / NC); pos.push(p.x, p.y, p.z); uv.push(1 - i / NS, 1 - j / NC); }   // el rótulo se lee bien desde el rider
  for (let j = 0; j < NC; j++) for (let i = 0; i < NS; i++) { const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  const tex = canvasTex(1024, 256, (c, w, h) => {
    c.fillStyle = '#c6f432'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#0d1620'; c.fillRect(0, 0, w * 0.14, h); c.fillRect(w * 0.86, 0, w * 0.14, h);
    c.fillStyle = '#ff5a4e'; c.fillRect(w * 0.14, 0, w * 0.08, h); c.fillRect(w * 0.78, 0, w * 0.08, h);
    c.fillStyle = '#0d1620'; c.font = 'italic 900 92px Segoe UI, sans-serif'; c.fillText('TATANKA', w * 0.29, h * 0.62);
    const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.22)');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(13,22,32,.35)'; c.lineWidth = 3;
    for (let i = 1; i < 12; i++) { c.beginPath(); c.moveTo(w * i / 12, 0); c.lineTo(w * i / 12, h); c.stroke(); }
    c.strokeStyle = 'rgba(13,22,32,.6)'; c.lineWidth = 8; c.strokeRect(0, 0, w, h);
  });
  const canopy = new T.Mesh(geo, MAT(0xffffff, 0.6, 0, { map: tex, side: T.DoubleSide })); g.add(canopy);
  const lePts = []; for (let i = 0; i <= 24; i++) lePts.push(P(i / 24 * 2 - 1, 0));
  g.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(lePts), 48, 0.16, 8), MAT(0x0d1620, 0.5)));
  for (const u of [-0.62, -0.3, 0, 0.3, 0.62]) { const a = P(u, 0), b = P(u, 0.85); g.add(new T.Mesh(new T.TubeGeometry(new T.LineCurve3(a, b), 2, 0.07, 6), MAT(0x0d1620, 0.5))); }
  scene.add(g);
  // puntos de las líneas: delanteras en el borde de ataque, traseras en las puntas
  const at = { fl: P(-0.45, 0.1), fr: P(0.45, 0.1), bl: P(-1, 0.9), br: P(1, 0.9) };
  const SEG = 18, NV = (4 * SEG + 2) * 2, lineGeo = new T.BufferGeometry();
  lineGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(NV * 3), 3));
  lineGeo.setAttribute('color', new T.BufferAttribute(new Float32Array(NV * 3), 3));
  const lines = new T.LineSegments(lineGeo, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })); lines.frustumCulled = false; scene.add(lines);
  const COLS = [[0.92, 0.93, 0.9], [1, 0.3, 0.25], [0.2, 0.5, 1]];   // centrales claras, mando izquierdo rojo, derecho azul
  // una línea de a a b que cuelga (y se la lleva un poco el viento) y vibra un poco
  const pt = V3();
  function line(a, b, sag, ph, col) {
    const n = sag ? SEG : 1, P = lineGeo.attributes.position, C = lineGeo.attributes.color, cc = COLS[col];
    for (let k = 0; k < n; k++) for (const s of [k / n, (k + 1) / n]) {
      const bow = 4 * s * (1 - s), vib = 0.03 * Math.sin(ph + s * 9) * bow;
      pt.lerpVectors(a, b, s); pt.y -= sag * bow; pt.addScaledVector(WIND.D, sag * 0.25 * bow); pt.x += vib; pt.z += vib;
      const i = KITE.ln++; P.setXYZ(i, pt.x, pt.y, pt.z); C.setXYZ(i, cc[0], cc[1], cc[2]);
    }
  }
  const bar = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.52, 8), MAT(0x15171a, 0.4)); bar.castShadow = true; scene.add(bar);
  return { g, at, lines, lineGeo, bar, line, ln: 0, cgeo: geo, base: Float32Array.from(pos), NS, NC, az: 0.8, el: 0.6, side: 1, loop: 0, pos: V3(), barC: V3() };
})();

let HUMAN = null;   // JuanP (juanp.glb) cuando ha cargado

// =====================================================================================
//  ESTADO DEL JUEGO
// =====================================================================================
const GAME = { running: false, paused: false, t: 0, mode: 'kite' };
try { const m = localStorage.getItem('kite-mode'); if (MODES[m]) GAME.mode = m; } catch (e) {}
const R = {
  x: 60, z: -70, y: 0, vy: 0, h: 0, v: 5, s: 1, yaw: 0, state: 'ride', fallT: 0, charge: 0, power: 0.6, turn: 0, yr: 0,
  foil: 0, foilOn: false, air: null, score: 0, twa: 90, lift: 0,
};
function setMode(m) {
  GAME.mode = m;
  kiteBoard.visible = m === 'kite'; wingBoard.visible = m === 'wing';
  KITE.g.visible = KITE.lines.visible = KITE.bar.visible = m === 'kite';
  WING.g.visible = m === 'wing';
  R.foil = 0; R.foilOn = false;
  document.querySelectorAll('#modes .opt').forEach(b => b.classList.toggle('sel', b.dataset.m === m));
  $('modeLbl').textContent = MODES[m].name + ' · JUANP';
  const k = document.querySelector('#stR .knob'); if (k) k.textContent = MODES[m].knob;
  try { localStorage.setItem('kite-mode', m); } catch (e) {}
}

// ---- costa y obstáculos (fuera de eso, todo el mar es navegable)
const GROIN_PTS = (() => { const c = new T.QuadraticBezierCurve3(V3(GROIN_X, 0, SHORE_Z + 10), V3(GROIN_X - 10, 0, SHORE_Z - 85), V3(GROIN_X + 45, 0, SHORE_Z - 105)); return c.getPoints(40); })();
function solidAt(x, z, mode) {
  if (z > SHORE_Z - 3 || (x > GROIN_X - 42 && x < GROIN_X + 122 && z > SHORE_Z - 30)) return 'playa';   // y la arena de la bahía del espigón
  if (x > MARINA_X - 295 && x < MARINA_X + 90 && z > SHORE_Z - 225) return 'la escollera de Puerto Siles';
  for (const p of GROIN_PTS) if ((x - p.x) ** 2 + (z - p.z) ** 2 < 70) return 'el espigón';
  if (z < SHORE_Z + 5 && z > SHORE_Z - 1342) {
    const dx = Math.abs(x - PIER_X), head = z < SHORE_Z - 1140;
    if (dx < (head && z > SHORE_Z - 1225 ? 12 : 6)) {
      if (mode === 'kite' || head || z > SHORE_Z - 100) return 'el Pantalán';
      const dz = (((SHORE_Z + 20 - z) % 30) + 30) % 30;   // con foil se pasa por debajo, entre los pilotes
      if (dz < 2.2 || dz > 27.8) return 'un pilote del Pantalán';
    }
  }
  if (x > PIER_X + 385 && x < PIER_X + 1295 && z > -475) return 'el puerto industrial';
  return null;
}
function zoneName(x, z) {
  if (z < SHORE_Z - 1400 || x < MARINA_X - 900 || x > PIER_X + 1400) return 'MAR ABIERTO';
  if (z < SHORE_Z - 480) return 'EN MEDIO DE LA BAHÍA';
  if (x < MARINA_X + 100) return 'PUERTO SILES · CANET';
  if (x < GROIN_X + 120) return 'PLAYA DEL ESPIGÓN';
  if (x < PIER_X - 100) return 'PLAYA DEL PUERTO';
  if (x < PIER_X + 150) return 'EL PANTALÁN';
  return 'PUERTO INDUSTRIAL';
}

// ---- mensajes
function say(html, cls = 'clean', sec = 1.8) { const el = $('trick'); el.innerHTML = html; el.className = cls; el.style.opacity = 1; clearTimeout(say.t); say.t = setTimeout(() => el.style.opacity = 0, sec * 1000); }
function msg(t, sec = 0) { const el = $('msg'); el.textContent = t; el.style.opacity = t ? 1 : 0; clearTimeout(msg.t); if (sec) msg.t = setTimeout(() => el.style.opacity = 0, sec * 1000); }

// =====================================================================================
//  CONTROLES: círculo izquierdo = dirección (x) y potencia (y) · derecho = salto/pump y trucos
// =====================================================================================
const mkStick = () => ({ x: 0, y: 0, on: false, ang: null, turn: 0, circleEv: 0, relEv: false });
const IN = { L: mkStick(), R: mkStick(), kb: {} };
const touches = new Map();
function trackCircle(s) {
  const r = Math.hypot(s.x, s.y);
  if (r > 0.55) {
    const a = Math.atan2(s.y, s.x);
    if (s.ang !== null) { let d = a - s.ang; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; s.turn += d; }
    s.ang = a; if (Math.abs(s.turn) >= TAU * 0.85) { s.circleEv = 1; s.turn = 0; }
  } else if (r < 0.3) { s.ang = null; s.turn = 0; }
}
function moveStick(t, e) {
  if (t.side === 'L') {   // barra: horizontal = girar (sensible), vertical = potencia (más recorrido)
    const dz = v => Math.sign(v) * Math.max(0, Math.abs(v) - 0.1) / 0.9;
    IN.L.x = clamp(dz((e.clientX - t.x0) / 60), -1, 1); IN.L.y = clamp(dz(-(e.clientY - t.y0) / 80), -1, 1);
    return;
  }
  let dx = (e.clientX - t.x0) / t.rad, dy = -(e.clientY - t.y0) / t.rad;
  const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
  if (l < 0.22) { dx = 0; dy = 0; }
  IN[t.side].x = dx; IN[t.side].y = dy; trackCircle(IN[t.side]);
}
addEventListener('pointerdown', e => {
  if (!GAME.running || GAME.paused || e.target.closest('button')) return;
  const side = e.clientX < innerWidth / 2 ? 'L' : 'R';
  for (const [id, t] of touches) if (t.side === side) touches.delete(id);
  // el dedo va por posición sobre el círculo; si se toca lejos, cuenta desde donde se puso
  const b = $(side === 'L' ? 'stL' : 'stR').getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2, rad = b.width * 0.47;
  const abs = side === 'R' && Math.hypot(e.clientX - cx, e.clientY - cy) < rad * 1.5;
  const t = abs ? { side, x0: cx, y0: cy, rad } : { side, x0: e.clientX, y0: e.clientY, rad: 56 };
  touches.set(e.pointerId, t);
  const s = IN[side]; s.on = true; s.x = s.y = 0; s.ang = null; s.turn = 0;
  $(side === 'L' ? 'stL' : 'stR').classList.add('on');
  if (abs) moveStick(t, e);
});
addEventListener('pointermove', e => { const t = touches.get(e.pointerId); if (t) moveStick(t, e); });
const endTouch = e => {
  const t = touches.get(e.pointerId); if (!t) return; touches.delete(e.pointerId);
  const s = IN[t.side]; s.on = false; s.x = s.y = 0; s.relEv = true;
  $(t.side === 'L' ? 'stL' : 'stR').classList.remove('on');
};
addEventListener('pointerup', endTouch); addEventListener('pointercancel', endTouch);
addEventListener('keydown', e => {
  if (e.repeat) return;
  IN.kb[e.code] = true;
  if (e.code === 'KeyC') nextCam();
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyL') IN.kbLoop = true;
  if (e.code === 'Enter' && R.state === 'fallen') getUp();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { IN.kb[e.code] = false; if (e.code === 'Space') IN.kbRel = true; });
function readSticks() {
  const k = IN.kb;
  const S = {
    L: { x: IN.L.x, y: -IN.L.y, on: IN.L.on || !!k.KeyG },
    R: { x: IN.R.x, y: IN.R.y, hold: (IN.R.on && Math.hypot(IN.R.x, IN.R.y) < 0.35) || !!k.Space, rel: false, circle: IN.R.circleEv || IN.kbLoop },
  };
  if (k.ArrowLeft) S.L.x = -1; if (k.ArrowRight) S.L.x = 1; if (k.ArrowUp) S.L.y = 1; if (k.ArrowDown) S.L.y = -1;
  if (k.KeyW) S.R.y = 1; if (k.KeyS) S.R.y = -1; if (k.KeyA) S.R.x = -1; if (k.KeyD) S.R.x = 1;
  S.R.rel = (IN.R.relEv || IN.kbRel) && R.charge > 0.06;
  IN.R.relEv = IN.L.relEv = false; IN.kbRel = false; IN.R.circleEv = 0; IN.kbLoop = false;
  if (!GAME.running) return autopilot();
  return S;
}
// en el menú navega solo, a un descuartelar, sin acercarse a la costa
function autopilot() {
  const F = WIND.F, phi = Math.atan2(F.z, F.x);
  if (R.state === 'fallen') { if (R.fallT > 2) getUp(); return { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } }; }
  let s = R.s;
  const want = sd => { const h = phi + sd * 100 * DEG; return Math.sin(h); };   // componente z del rumbo
  if (R.z > SHORE_Z - 140 && want(s) > -0.2) s = -s;                          // hacia el mar
  if (R.z < SHORE_Z - 700 && want(s) < 0.2) s = -s;                            // hacia la costa
  if (R.x > PIER_X - 200 && Math.cos(phi + s * 100 * DEG) > 0) s = -s;
  if (R.x < MARINA_X + 150 && Math.cos(phi + s * 100 * DEG) < 0) s = -s;
  const d = angDiff(R.h, phi + s * 100 * DEG);
  return { L: { x: clamp(d * 1.6, -1, 1), y: 0.1 }, R: { x: 0, y: 0 } };
}
// dibujo de los sticks
function stickSVG(words, knob) {
  const chev = rot => `<path d="M-7,-62 L0,-69 L7,-62" transform="rotate(${rot})" />`;
  return `<svg viewBox="-70 -70 140 140" aria-hidden="true"><circle r="66" class="rim"/>${chev(0)}${chev(90)}${chev(180)}${chev(270)}
    <text x="0" y="-41">${words[0]}</text><text x="44" y="-18">${words[1]}</text><text x="0" y="49">${words[2]}</text><text x="-44" y="-18">${words[3]}</text></svg><i class="knob">${knob}</i>`;
}
// la barra de la cometa: puño rojo (izquierda) y azul (derecha), líneas hacia arriba y el chicken loop
$('stL').innerHTML = `<svg viewBox="-110 -62 220 124" aria-hidden="true"><rect class="rim" x="-106" y="-58" width="212" height="116" rx="22"/>
  <text x="0" y="-44">SOLTAR</text><text x="88" y="-26">ARRIBAR</text><text x="0" y="52">TIRAR · POTENCIA</text><text x="-88" y="-26">ORZAR</text>
  <g id="barG"><path class="ln" d="M-74,0 L-14,-60 M74,0 L14,-60 M-5,0 L-3,-60 M5,0 L3,-60"/>
  <rect class="bar" x="-80" y="-5" width="160" height="10" rx="5"/><rect x="-80" y="-5" width="30" height="10" rx="5" fill="#ff5a4e"/>
  <rect x="50" y="-5" width="30" height="10" rx="5" fill="#2a8bff"/><circle cx="0" cy="13" r="7" class="loop"/></g></svg><i class="knob"></i>`;
$('stR').innerHTML = stickSVG(['BACKROLL', 'SPIN', 'FRONTROLL', 'SPIN'], 'SALTO');
function drawSticks() {
  $('stR').querySelector('.knob').style.transform = `translate(${(IN.R.x * 40).toFixed(1)}px, ${(-IN.R.y * 40).toFixed(1)}px)`;
  const bx = IN.L.on ? IN.L.x : clamp(R.turn, -1, 1), by = IN.L.on ? IN.L.y : 0;
  $('barG').setAttribute('transform', `translate(0 ${(-by * 22).toFixed(1)}) rotate(${(bx * 26).toFixed(1)})`);
  $('stR').classList.toggle('air', R.state === 'air');
  $('stL').classList.toggle('air', R.state === 'air' && GAME.mode === 'kite');
}
// ORZAR/ARRIBAR dependen de por qué lado entra el viento: se recolocan en cada amura
function stickWords() {
  const sTxt = $('stL').querySelectorAll('text');
  // girar a la derecha (x+) es arribar si el viento viene por la izquierda (s = +1)
  sTxt[1].textContent = R.s > 0 ? 'ARRIBAR' : 'ORZAR'; sTxt[3].textContent = R.s > 0 ? 'ORZAR' : 'ARRIBAR';
}

// =====================================================================================
//  FÍSICA
// =====================================================================================
function getUp() {
  const F = WIND.F, phi = Math.atan2(F.z, F.x);
  R.state = 'ride'; R.fallT = 0; R.yr = 0; R.turn = 0; R.v = 2; R.vy = 0; R.charge = 0; R.air = null;
  if (R.twa < 70 || R.twa > 150) R.h = phi + R.s * 100 * DEG;   // sale al través del lado donde está
  trick.rotation.set(0, 0, 0);
}
function fall(why) {
  R.state = 'fallen'; R.fallT = 0; R.v = 0; R.vy = 0; R.charge = 0; R.air = null; R.foil = 0; R.foilOn = false;
  say(why, 'fall', 2.2); sfxSplash(1.2);
}
function maneuver(twa) {
  const gybe = twa > 90;
  if (gybe) say('TRASLUCHADA', 'info', 1.3);
  else if (R.v < 3.2 && GAME.mode !== 'kite') say('VIRADA<small>sin velocidad: casi te quedas</small>', 'info', 1.6);
  else say('VIRADA', 'info', 1.3);
  if (GAME.running) R.score += gybe ? 20 : 40;
}
function updateRider(dt, S) {
  const M = MODES[GAME.mode], D = WIND.D, F = WIND.F;
  const H = tmp.H.set(Math.cos(R.h), 0, Math.sin(R.h));
  R.twa = Math.acos(clamp(H.dot(F), -1, 1)) / DEG;
  const cr = H.x * D.z - H.z * D.x;
  if (Math.abs(cr) > 0.06) { const ns = Math.sign(cr); if (ns !== R.s) { R.s = ns; if (R.state !== 'fallen') maneuver(R.twa); stickWords(); } }
  // la barra de la cometa tarda más en notarse que el ala, que va en las manos
  R.power = lerp(R.power, clamp(0.6 + 0.4 * S.L.y, 0.15, 1), clamp(dt * (GAME.mode === 'kite' ? 2.2 : 3.5), 0, 1));
  const surf = surfaceH(R.x, R.z, GAME.t);

  if (R.state === 'fallen') {
    R.fallT += dt; R.y = surf;
    // en el agua la cometa (o el ala) te arrastra un poco a sotavento
    R.x += D.x * 0.5 * dt; R.z += D.z * 0.5 * dt;
    if (R.fallT > 2.6) getUp();
  } else if (R.state === 'ride') {
    // giro con inercia: la velocidad de giro sube y baja poco a poco; curva suave para el dedo
    const kite = GAME.mode === 'kite', inp = Math.sign(S.L.x) * Math.pow(Math.abs(S.L.x), 1.4);
    const maxRate = kite ? 0.26 + 0.035 * Math.min(R.v, 10) : 0.3 + (R.foilOn ? 0.035 : 0.02) * Math.min(R.v, 10);
    R.turn = lerp(R.turn, inp, clamp(dt * 2.5, 0, 1));
    R.yr += (R.turn * maxRate - R.yr) * clamp(dt * (kite ? 1.7 : 1.4), 0, 1);
    R.h += R.yr * dt;
    R.v -= Math.abs(R.yr) * R.v * (kite ? 0.1 : 0.06) * dt;     // trazar curvas cuesta velocidad
    // velocidad objetivo: viento × polar × potencia (con poco viento la cometa o el ala no tira)
    const pf = (0.55 + 0.45 * R.power) * (0.45 + 0.55 * smooth(7, 17, WIND.knNow));
    let vt = WIND.ms * polar(R.twa) * pf * M.k;
    if (M.foil && !R.foilOn) vt *= 0.6;                         // sin volar, el casco frena
    if (GAME.mode === 'kite' && Math.abs(KITE.az) < 0.4) vt += 1.5;   // la cometa cruzando la zona de potencia
    vt = Math.min(vt, 22);
    // inercia: acelera más despacio que frena; volando en el foil se planea y frena poco
    const acc = 0.3, dec = kite ? 0.6 : R.foilOn ? 0.3 : 0.75;
    R.v += (vt - R.v) * (vt > R.v ? acc : dec) * dt;
    if (R.twa < 38) { R.v = Math.max(0, R.v - 1.4 * dt); if (R.v < 1.5) R.h += R.s * 0.7 * dt; }   // proa al viento: te para y te hace caer
    if (M.foil) {
      if (!R.foilOn && R.v > M.takeoff + 0.3) { R.foilOn = true; say('¡VOLANDO!', 'clean', 1.2); }
      if (R.foilOn && R.v < M.takeoff - 0.9) { R.foilOn = false; say('AL AGUA', 'info', 1); sfxSplash(0.4); }
    }
    R.foil = lerp(R.foil, R.foilOn ? 1 : 0, clamp(dt * 1.6, 0, 1));
    // cargar el salto (o el pump) con el centro del círculo derecho
    if (S.R.hold) R.charge = Math.min(1, R.charge + dt * 1.4);
    if (S.R.rel) {
      const c = R.charge; R.charge = 0;
      if (GAME.mode === 'kite') {
        if (R.v > 3) startAir(2 + c * (1.8 + 0.42 * WIND.ms) + 0.12 * R.v, 0.55);
        else say('MÁS VELOCIDAD PARA SALTAR', 'info', 1.2);
      } else if (R.foilOn) startAir(2.2 + 1.6 * c, 0);
      else {   // pump: los seguidos (menos de 1 s) empujan más; cuanto más rápido, menos aporta
        const chain = GAME.t - (R.pumpT || -9) < 1 ? 1.35 : 1; R.pumpT = GAME.t;
        R.v += (0.5 + 1.0 * c) * chain * (1 - smooth(2, 6, R.v) * 0.5); say('PUMP', 'info', 0.7); sfxThump(90, 0.25, 0.2);
      }
    } else if (!S.R.hold) R.charge = Math.max(0, R.charge - dt * 3);
    const drift = (1 - smooth(1, 5, R.v)) * 0.7;
    R.x += (H.x * R.v + D.x * drift) * dt; R.z += (H.z * R.v + D.z * drift) * dt;
    R.y = surf + FOIL_H * R.foil;
  } else if (R.state === 'air') {
    const A = R.air; A.t += dt;
    const lift = A.lift * Math.exp(-A.t / 1.8);
    R.vy -= 9.8 * (1 - lift) * dt; R.y += R.vy * dt; A.maxY = Math.max(A.maxY, R.y - surf);
    R.v *= 1 - 0.05 * dt;
    const dw = GAME.mode === 'kite' ? WIND.ms * 0.22 : 0;
    R.x += (H.x * R.v + D.x * dw) * dt; R.z += (H.z * R.v + D.z * dw) * dt;
    // giros: mientras se empuja el círculo gira; al soltar acaba la vuelta que lleva
    const turnTo = (o, input, step, speed) => {
      if (Math.abs(input) > 0.45) o.v = Math.sign(input) * speed;
      if (!o.v) return;
      const nx = o.a + o.v * dt;
      if (Math.abs(input) <= 0.45) { const tg = (o.v > 0 ? Math.ceil(o.a / step - 1e-3) : Math.floor(o.a / step + 1e-3)) * step; if ((o.v > 0 && nx >= tg) || (o.v < 0 && nx <= tg)) { o.a = tg; o.v = 0; return; } }
      o.a = nx;
    };
    turnTo(A.roll, S.R.y, TAU, 5.2);
    turnTo(A.spin, -S.R.x, GAME.mode === 'kite' ? Math.PI : TAU, 6.5);
    if (GAME.mode === 'kite') {
      A.grab = lerp(A.grab, S.L.on ? 1 : 0, clamp(dt * 6, 0, 1)); if (A.grab > 0.7) A.grabT += dt;
      if (S.R.circle && !A.loop) { A.loop = true; KITE.loop = 1; R.vy += 2.5; R.v += 3; A.lift += 0.25; say('KITELOOP', 'clean', 1); }
    }
    trick.rotation.set(-R.s * A.roll.a, A.spin.a, 0, 'YXZ');
    if (R.y <= surf && R.vy < 0) land(surf);
  }
  // choques con la costa y los obstáculos
  const hit = R.state !== 'fallen' && solidAt(R.x, R.z, GAME.mode);
  if (hit === 'playa') {
    R.x -= H.x * 2; R.z -= Math.max(H.z * 2, 0) + 1; R.h = Math.atan2(-Math.abs(Math.sin(R.h)), Math.cos(R.h)); R.v *= 0.3;
    if (R.state === 'air') land(surf); msg('¡PLAYA! VUELVE AL AGUA', 1.5);
  } else if (hit) {
    R.x -= H.x * 8; R.z -= H.z * 8; R.h += Math.PI;
    fall('¡CONTRA ' + hit.toUpperCase() + '!');
  }
  // el cuerpo mira a sotavento: gira media vuelta al cambiar de amura (pasando por mirar hacia delante)
  const yawT = R.s > 0 ? 0 : Math.PI;
  R.yaw += clamp(yawT - R.yaw, -dt * 3.2, dt * 3.2);
  // la estela y las salpicaduras leen esto
  RIDER.pos.set(R.x, 0, R.z); RIDER.vel.set(H.x * R.v, 0, H.z * R.v); RIDER.edge = R.foilOn ? 0 : R.turn * 0.4; RIDER.state = R.state === 'air' ? 'air' : R.state;
  if (R.state === 'ride' && R.v > 3 && !R.foilOn && Math.random() < dt * (16 + R.v * 3.5)) {
    const sx = -H.z * R.s * -0.25, sz = H.x * R.s * -0.25;   // del canto de barlovento
    emit(R.x - H.x * 0.6 + sx, surf + 0.05, R.z - H.z * 0.6 + sz, -D.x * 1 + (Math.random() - 0.5), 1 + Math.random() * 1.5, -D.z * 1 + (Math.random() - 0.5), 0.3, 0.9);   // espuma blanca abundante, como en el vídeo
  }
  R.top = Math.max(R.top || 0, R.v);
}
function startAir(vy, lift) {
  R.state = 'air'; R.vy = vy; R.foilOn = R.foil > 0.5;
  R.air = { t: 0, lift, maxY: 0, roll: { a: 0, v: 0 }, spin: { a: 0, v: 0 }, grab: 0, grabT: 0, loop: false };
  sfxThump(120, 0.3, 0.15);
}
function land(surf) {
  const A = R.air;
  const rollN = Math.round(A.roll.a / TAU), rr = Math.abs(A.roll.a - rollN * TAU);
  const step = GAME.mode === 'kite' ? Math.PI : TAU, spinN = Math.round(A.spin.a / step), sr = Math.abs(A.spin.a - spinN * step);
  const ok = rr < 0.6 && sr < 0.6 && A.roll.v === 0 && A.spin.v === 0;
  trick.rotation.set(0, 0, 0);
  R.y = surf; R.vy = 0; R.air = null;
  if (!ok) { fall('¡CAÍDA!<small>acaba los giros antes de tocar el agua</small>'); return; }
  R.state = 'ride';
  const parts = [], H = Math.max(A.maxY, 0);
  if (rollN) parts.push((Math.abs(rollN) > 1 ? ['', '', 'Doble ', 'Triple '][Math.min(Math.abs(rollN), 3)] : '') + (rollN > 0 ? 'Back Roll' : 'Front Roll'));
  if (spinN) parts.push(Math.abs(spinN) * (step === Math.PI ? 180 : 360) + '');
  if (A.loop) parts.push('Kiteloop');
  if (A.grabT > 0.3) parts.push('Grab');
  const pts = Math.round(H * 40 + Math.abs(rollN) * 300 + Math.abs(spinN) * (step === Math.PI ? 150 : 300) + (A.loop ? 400 : 0) + (A.grabT > 0.3 ? 150 + A.grabT * 100 : 0));
  if (GAME.running) R.score += pts;
  say((parts.length ? parts.join(' + ') : (GAME.mode === 'kite' ? 'Salto' : 'Saltito')) + `<small>${H.toFixed(1)} M · +${pts}</small>`, 'clean', 1.8);
  sfxSplash(0.3 + H * 0.08);
  if (GAME.mode !== 'kite' && R.foilOn) R.foil = 1;
}

// =====================================================================================
//  POSTURA DE JUANP (en el espacio del cuerpo: mira a +Z, la tabla va a lo largo de X)
// =====================================================================================
const J = {}; for (const k of ['hB', 'hF', 'kB', 'kF', 'fB', 'fF', 'ch', 'hd', 'sB', 'sF', 'eB', 'eF', 'aB', 'aF', 'fw', 'toeB', 'toeF']) J[k] = V3();
const WP = { C: V3(), X: V3(), Y: V3(), Z: V3(), m: new T.Matrix4() };
function computePose(t) {
  const m = GAME.mode, sb = Math.cos(R.yaw) >= 0 ? 1 : -1, pw = R.power;
  const air = R.state === 'air', fallen = R.state === 'fallen';
  const pull = fallen ? 0 : clamp(R.v / 10, 0, 1) * (0.4 + 0.6 * pw);
  const c = clamp(0.25 + 0.35 * R.charge + (air ? 0.35 : 0) + (fallen ? 0.6 : 0) + (R.air ? R.air.grab * 0.3 : 0), 0, 1);
  const leanBack = m === 'wing' ? 0.25 * pull : 0.35 + 0.65 * pull;   // con la cometa se cuelga del arnés hacia barlovento, bien tumbado
  const wide = 0.28;
  J.fF.set(wide, 0.09, 0); J.fB.set(-wide, 0.09, 0);
  J.toeF.set(wide + 0.03, 0.09, J.fF.z + 0.15); J.toeB.set(-wide + 0.05, 0.09, J.fB.z + 0.15);
  const kl = m === 'kite' ? 1 : 0, hy = lerp(0.95, 0.58, c) - (0.06 + 0.16 * kl) * leanBack, hz = -0.05 - (0.28 + 0.12 * kl) * leanBack;
  const kz = 0.1 + 0.25 * c + (0.06 + 0.1 * kl) * leanBack, ky = lerp(0.52, 0.42, c) - 0.05 * kl * leanBack;
  J.kF.set(wide + 0.02, ky, J.fF.z + kz); J.kB.set(-wide + 0.02, ky, J.fB.z + kz);
  J.hF.set(0.11, hy, hz); J.hB.set(-0.11, hy, hz);
  const tw = m === 'wing' ? 0.55 : 0.3;
  J.fw.set(Math.sin(tw) * sb, 0, Math.cos(tw)).normalize();
  J.ch.set(sb * 0.05, hy + 0.46 - 0.06 * kl * leanBack + Math.sin(t * 2.1) * 0.008, hz - (0.14 + 0.2 * kl) * leanBack + 0.06 + (m === 'wing' ? 0.06 : 0));
  const sl = V3(Math.cos(tw), 0, -Math.sin(tw) * sb).multiplyScalar(0.19);
  J.sF.copy(J.ch).add(sl).y += 0.04; J.sB.copy(J.ch).sub(sl).y += 0.04;
  J.hd.copy(J.ch).add(V3(sb * 0.07, 0.27, 0.04));
  // manos según el deporte
  if (m === 'kite') {
    const bz = 0.5 + 0.15 * (1 - pw);   // brazos casi estirados, la barra a la altura del pecho
    J.aF.copy(J.ch).add(V3(0.22, -0.02 + 0.1 * leanBack, bz)); J.aB.copy(J.ch).add(V3(-0.22, -0.02 + 0.1 * leanBack, bz));
    if (R.air && R.air.grab > 0.01) {   // grab: la mano de atrás al canto de los dedos, entre los pies
      riderRoot.updateMatrixWorld(true);
      const g = body.worldToLocal(boardGroup.localToWorld(tmp.a.set(-0.08 * sb, 0.12, 0.2 * R.s)));
      J.aB.lerp(g, R.air.grab); J.ch.y -= 0.12 * R.air.grab; J.hd.y -= 0.1 * R.air.grab;
    }
  } else if (m === 'wing') {
    // el ala delante y por encima, con el borde de ataque hacia proa y la envergadura inclinada
    WP.C.copy(J.ch).add(V3(sb * 0.05, 0.32 - 0.1 * (1 - pw), 0.62));
    WP.Y.set(sb * Math.cos(0.5), Math.sin(0.5), 0).normalize();
    WP.X.set(0, 0.75, -0.66 + 0.4 * (1 - pw)); WP.X.addScaledVector(WP.Y, -WP.X.dot(WP.Y)).normalize();
    WP.Z.crossVectors(WP.X, WP.Y);
    WP.m.makeBasis(WP.X, WP.Y, WP.Z); WING.g.quaternion.setFromRotationMatrix(WP.m); WING.g.position.copy(WP.C);
    const hz2 = WP.Z.z < 0 ? WING.hz : -WING.hz;   // las asas por el lado del rider
    for (const hm of WING.handles) hm.position.z = hz2;
    const hF = V3(0, 0.3, hz2).applyQuaternion(WING.g.quaternion).add(WP.C), hB = V3(0, -0.35, hz2).applyQuaternion(WING.g.quaternion).add(WP.C);
    if (sb > 0) { J.aF.copy(hF); J.aB.copy(hB); } else { J.aB.copy(hF); J.aF.copy(hB); }
  }
  if (fallen) { J.aF.copy(J.sF).add(V3(0.3, 0.1, 0.3)); J.aB.copy(J.sB).add(V3(-0.3, 0.1, 0.3)); }
  J.eF.lerpVectors(J.sF, J.aF, 0.5).add(V3(0.04, -0.07, 0.03)); J.eB.lerpVectors(J.sB, J.aB, 0.5).add(V3(-0.04, -0.07, 0.03));
}
function placeRider(t) {
  const surfY = R.state === 'air' ? R.y : surfaceH(R.x, R.z, t);
  riderRoot.position.set(R.x, R.state === 'fallen' ? surfY - 0.75 : surfY, R.z);
  riderRoot.rotation.set(0, -R.h, 0);
  inner.position.y = -0.9 + (R.state === 'air' ? (R.foil > 0.5 ? 0 : 0) : FOIL_H * R.foil) + 0.02;
  if (R.state === 'air') inner.position.y = -0.88;
  if (R.state === 'fallen') { trick.rotation.set(0, 0, -0.5 * R.s * Math.min(1, R.fallT * 2), 'YXZ'); }
  else if (R.state === 'ride') {   // la tabla se inclina con el canto en los giros y con la tracción
    const ang = -R.s * 0.12 * clamp(R.v / 10, 0, 1) * (GAME.mode === 'kite' ? 1 : 0.5) + R.yr * 0.22;   // se tumba con el giro
    trick.rotation.set(ang, 0, 0);
  }
  body.rotation.y = R.yaw;
  computePose(t);
  riderRoot.updateMatrixWorld(true);
  if (HUMAN) poseHuman(HUMAN, J);
}

// ---- la cometa: posición en la ventana de viento, orientación y líneas a la barra
// la cometa ya colocada en su lado de la ventana (al empezar, sin cruzarla)
function snapKite() { const s = Math.sign(Math.cos(R.h) * WIND.E0.x + Math.sin(R.h) * WIND.E0.z) || 1; KITE.side = s; KITE.az = s * 0.75; KITE.el = 0.6; }
function updateKite(dt) {
  if (GAME.mode !== 'kite') return;
  const D = WIND.D, E0 = WIND.E0, H = tmp.H.set(Math.cos(R.h), 0, Math.sin(R.h));
  const hs = H.dot(E0); if (Math.abs(hs) > 0.15) KITE.side = Math.sign(hs);
  let azT = KITE.side * lerp(0.9, 0.6, R.power), elT = lerp(0.72, 0.42, R.power);
  if (R.charge > 0) { azT *= 1 - 0.65 * R.charge; elT = lerp(elT, 1.2, R.charge); }
  if (R.state === 'air') { azT = KITE.side * 0.2; elT = R.air && R.air.t < 1.5 ? 1.3 : 1.0; }
  if (R.state === 'fallen') { azT = KITE.side * 0.97; elT = 0.12; }
  KITE.az += (azT - KITE.az) * clamp(dt * 2.6, 0, 1);
  KITE.el += (elT - KITE.el) * clamp(dt * 3, 0, 1);
  let az = KITE.az, el = KITE.el;
  if (KITE.loop > 0) { KITE.loop = Math.max(0, KITE.loop - dt / 1.3); const a = (1 - KITE.loop) * TAU; az += KITE.side * 0.35 * Math.sin(a); el -= 0.32 * (1 - Math.cos(a)); }
  const t = GAME.t, gust = WIND.knNow - WIND.kn;
  // ochos: más amplios y rápidos con poca velocidad (hay que trabajar la cometa) y al girar
  const ride = R.state === 'ride', amp = ride ? 0.07 + 0.17 * (1 - smooth(4, 10, R.v)) + 0.12 * Math.abs(R.turn) : 0.03;
  KITE.ph = (KITE.ph || 0) + dt * (1.3 + 1.2 * R.power);
  az += amp * Math.sin(KITE.ph) + 0.03 * Math.sin(t * 1.7 + 1) + (ride ? R.turn * 0.25 : 0);
  el -= amp * 0.6 * Math.sin(2 * KITE.ph) + (ride ? 0.15 * Math.abs(R.turn) : 0);
  el = clamp(el + 0.035 * Math.sin(t * 0.9) + 0.015 * Math.sin(t * 2.3) + 0.012 * gust, 0.08, 1.45);
  // la barra: entre los nudillos de JuanP
  if (HUMAN && HUMAN.knuckL) { const a = HUMAN.knuckL.getWorldPosition(tmp.a), b = HUMAN.knuckR.getWorldPosition(tmp.b); KITE.barC.addVectors(a, b).multiplyScalar(0.5); KITE.barDir = (KITE.barDir || V3()).subVectors(b, a).normalize(); }
  else { body.localToWorld(KITE.barC.copy(J.aF).add(J.aB).multiplyScalar(0.5)); KITE.barDir = (KITE.barDir || V3()).set(-Math.sin(R.h), 0, Math.cos(R.h)); }
  const a = az * Math.PI / 2 * 0.95, dir = tmp.c.copy(D).multiplyScalar(Math.cos(a)).addScaledVector(E0, Math.sin(a));
  KITE.pos.copy(KITE.barC).addScaledVector(dir, LINE * Math.cos(el)); KITE.pos.y += LINE * Math.sin(el);
  const Z = tmp.d.subVectors(KITE.pos, KITE.barC).normalize();
  // el morro: hacia el centro de la ventana (navegando queda casi vertical al agua) y hacia donde vuela
  const up = V3().copy(UP).addScaledVector(Z, -UP.dot(Z)), cen = V3().copy(D).addScaledVector(Z, -D.dot(Z));
  const Yd = up.lengthSq() > 1e-4 ? up.normalize().multiplyScalar(ride ? 0.4 : 1.2) : V3();
  if (cen.lengthSq() > 1e-4) Yd.addScaledVector(cen.normalize(), ride ? 1 : 0.25);
  const rel = V3().subVectors(KITE.pos, KITE.barC), mv = V3().subVectors(rel, KITE.prev || rel); KITE.prev = rel;
  mv.addScaledVector(Z, -mv.dot(Z)); const sp = mv.length() / Math.max(dt, 1e-3);
  if (sp > 0.3) Yd.addScaledVector(mv.normalize(), clamp(sp / 5, 0, 1.6));
  Yd.addScaledVector(Z, -Yd.dot(Z)); if (Yd.lengthSq() < 1e-4) Yd.copy(D); Yd.normalize();
  const Y = KITE.Y = (KITE.Y || Yd.clone()).lerp(Yd, clamp(dt * 5, 0, 1)); Y.addScaledVector(Z, -Y.dot(Z)).normalize();
  Y.applyAxisAngle(Z, -R.turn * 0.5 * KITE.side + 0.05 * Math.sin(t * 1.4));   // la barra la tuerce al girar
  const X = V3().crossVectors(Y, Z), Yw = V3().crossVectors(Z, X);
  tmp.m.makeBasis(X, Yw, Z); KITE.g.quaternion.setFromRotationMatrix(tmp.m); KITE.g.position.copy(KITE.pos);
  KITE.g.updateMatrixWorld(true);
  // barra y líneas: las delanteras salen del centro, las traseras de los extremos
  const bd = KITE.barDir, c = KITE.barC;
  // tensión: tiran más con potencia, velocidad y en el aire; si no, las líneas cuelgan
  const tens = R.state === 'fallen' ? 0.15 : clamp(0.3 + 0.4 * R.power + 0.04 * R.v + (R.state === 'air' ? 0.3 : 0), 0, 1);
  const sag = lerp(1.6, 0.18, tens), split = V3().copy(c).addScaledVector(Z, 1.6);
  KITE.ln = 0;
  KITE.line(c, split, 0, 0, 0);
  KITE.line(body.localToWorld(V3().addVectors(J.hF, J.hB).multiplyScalar(0.5).add(V3(0, 0.08, 0.12))), c, 0, 0, 0);   // arnés: le tira de la cintura
  KITE.line(split, KITE.g.localToWorld(V3().copy(KITE.at.fl)), sag, t * 23, 0);
  KITE.line(split, KITE.g.localToWorld(V3().copy(KITE.at.fr)), sag, t * 23 + 2, 0);
  KITE.line(V3().copy(c).addScaledVector(bd, -0.26), KITE.g.localToWorld(V3().copy(KITE.at.bl)), sag * 1.1, t * 19 + 4, 1);
  KITE.line(V3().copy(c).addScaledVector(bd, 0.26), KITE.g.localToWorld(V3().copy(KITE.at.br)), sag * 1.1, t * 19 + 6, 2);
  KITE.lineGeo.setDrawRange(0, KITE.ln);
  KITE.lineGeo.attributes.position.needsUpdate = true; KITE.lineGeo.attributes.color.needsUpdate = true;
  // la tela tiembla en el borde de salida, más con poca tensión
  const fp = KITE.cgeo.attributes.position, b0 = KITE.base, NSv = KITE.NS + 1;
  for (let i = 0; i < fp.count; i++) {
    const v = Math.floor(i / NSv) / KITE.NC, u = (i % NSv) / KITE.NS;
    const f = v * v * (0.05 + 0.1 * (1 - tens)) * Math.sin(t * 13 + u * 18 + v * 3);
    fp.setXYZ(i, b0[i * 3], b0[i * 3 + 1], b0[i * 3 + 2] + f);
  }
  fp.needsUpdate = true;
  KITE.bar.position.copy(c); KITE.bar.quaternion.setFromUnitVectors(UP, bd);
}

// =====================================================================================
//  CÁMARAS: detrás por defecto, cerca, lateral, alta y desde la cometa / el ala
// =====================================================================================
const CAM = { mode: 0, names: ['DETRÁS', 'CERCA', 'LATERAL', 'ALTA', 'DESDE ARRIBA'], pos: V3(), look: V3(), h: 0, off: null, lookOff: null };
try { CAM.mode = +(localStorage.getItem('kite-cam') || 0) % CAM.names.length; } catch (e) {}
function setCam(i) { CAM.mode = i; $('camBtn').textContent = 'Cámara: ' + CAM.names[i].toLowerCase(); try { localStorage.setItem('kite-cam', i); } catch (e) {} }
function nextCam() { setCam((CAM.mode + 1) % CAM.names.length); msg('CÁMARA: ' + CAM.names[CAM.mode], 1.2); }
function updateCamera(dt) {
  const portrait = camera.aspect < 1, far = portrait ? 1.4 : 1;
  const fov = portrait ? 72 : 58; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const rp = tmp.a.set(R.x, R.state === 'air' ? R.y : riderRoot.position.y, R.z), D = WIND.D;
  CAM.h += angDiff(CAM.h, R.h) * clamp(dt * 1.2, 0, 1);
  const Hc = tmp.b.set(Math.cos(CAM.h), 0, Math.sin(CAM.h)), want = tmp.c, look = tmp.n;
  if (!GAME.running) {   // menú: vuelta lenta alrededor del rider
    const a = GAME.t * 0.06 + 2.2;
    want.set(rp.x + Math.cos(a) * 15, rp.y + 4.5, rp.z + Math.sin(a) * 15); look.copy(rp).add(V3(0, portrait ? -1.2 : 2.5, 0));
    if (GAME.mode === 'kite') look.lerp(KITE.pos, 0.18);
    camera.position.copy(want); camera.lookAt(look); CAM.off = null; return;
  }
  const m = CAM.mode;
  if (m === 0) { want.copy(rp).addScaledVector(Hc, -12 * far).addScaledVector(D, -2.5).add(V3(0, 2.8 * far, 0)); look.copy(rp).addScaledVector(Hc, 8).addScaledVector(D, 3).add(V3(0, 3.2, 0)); }   // como en Kiteboarding Pro: lejos y bajo, con la cometa grande arriba
  else if (m === 1) { want.copy(rp).addScaledVector(Hc, -4.2 * far).addScaledVector(D, -0.8).add(V3(0, 1.9, 0)); look.copy(rp).addScaledVector(Hc, 5).add(V3(0, 1.3, 0)); }
  else if (m === 2) { want.copy(rp).addScaledVector(D, -11 * far).addScaledVector(Hc, 2).add(V3(0, 2.6, 0)); look.copy(rp).addScaledVector(D, 4).add(V3(0, 2.2, 0)); }
  else if (m === 3) { want.copy(rp).addScaledVector(Hc, -32).add(V3(0, 26, 0)); look.copy(rp).addScaledVector(Hc, 10); }
  else {
    if (GAME.mode === 'kite') { want.copy(KITE.pos).lerp(rp, 0.12).y += 1.5; look.copy(rp).add(V3(0, 0.8, 0)); }
    else { want.copy(rp).addScaledVector(Hc, 4).addScaledVector(D, 3).add(V3(0, 6, 0)); look.copy(rp).add(V3(0, 1, 0)); }
  }
  if (GAME.mode === 'kite' && m < 3) look.lerp(KITE.pos, m === 2 ? 0.1 : m === 0 ? 0.3 : 0.22);   // que se vea también la cometa
  const k = clamp(dt * (m === 1 ? 3.5 : 2), 0, 1);
  CAM.off = (CAM.off || want.clone().sub(rp)).lerp(want.sub(rp), k);
  CAM.lookOff = (CAM.lookOff || look.clone().sub(rp)).lerp(look.sub(rp), clamp(dt * 3, 0, 1));
  CAM.pos.copy(rp).add(CAM.off); CAM.look.copy(rp).add(CAM.lookOff);
  CAM.pos.y = Math.max(CAM.pos.y, surfaceH(CAM.pos.x, CAM.pos.z, GAME.t) + 0.6);
  camera.position.copy(CAM.pos); camera.lookAt(CAM.look);
}

// =====================================================================================
//  MINIMAPA: el norte arriba (Canet), la tierra a la izquierda y el mar a la derecha
// =====================================================================================
const MAP = { x0: -1700, x1: 2300, z0: -2700, z1: 300 };
const mapCv = $('map'), mapCtx = mapCv.getContext('2d');
const mp = (x, z) => [(MAP.z1 - z) / (MAP.z1 - MAP.z0) * mapCv.width, (x - MAP.x0) / (MAP.x1 - MAP.x0) * mapCv.height];
const mapBg = (() => {
  const c = document.createElement('canvas'); c.width = mapCv.width; c.height = mapCv.height; const g = c.getContext('2d');
  g.fillStyle = '#0e4a63'; g.fillRect(0, 0, c.width, c.height);
  const [lx] = mp(0, SHORE_Z); g.fillStyle = '#c9b48a'; g.fillRect(0, 0, lx, c.height);
  g.fillStyle = '#7d8a5d'; g.fillRect(0, 0, lx - 6, c.height);
  const rect = (x0, z0, x1, z1, col) => { const [a, b] = mp(x0, z1), [cc, d] = mp(x1, z0); g.fillStyle = col; g.fillRect(Math.min(a, cc), Math.min(b, d), Math.abs(cc - a), Math.abs(d - b)); };
  rect(MARINA_X - 295, SHORE_Z - 225, MARINA_X + 90, SHORE_Z, '#9a8f80');
  rect(MARINA_X - 270, SHORE_Z - 200, MARINA_X - 10, SHORE_Z - 10, '#1b5f7a');
  rect(PIER_X + 385, -475, PIER_X + 1295, 230, '#b9b2a6');
  g.strokeStyle = '#efe7d6'; g.lineWidth = 3; g.beginPath(); g.moveTo(...mp(PIER_X, SHORE_Z)); g.lineTo(...mp(PIER_X, SHORE_Z - 1340)); g.stroke();
  g.strokeStyle = '#8f7f69'; g.lineWidth = 4; g.beginPath(); GROIN_PTS.forEach((p, i) => i ? g.lineTo(...mp(p.x, p.z)) : g.moveTo(...mp(p.x, p.z))); g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 15px Arial'; g.fillText('N', 6, 18);
  return c;
})();
function drawMap() {
  const g = mapCtx, W = mapCv.width;
  g.drawImage(mapBg, 0, 0);
  let [u, v] = mp(R.x, R.z); u = clamp(u, 6, W - 6); v = clamp(v, 6, mapCv.height - 6);
  // el rumbo en el mapa: u = -z, v = +x
  const hu = -Math.sin(R.h), hv = Math.cos(R.h);
  g.save(); g.translate(u, v); g.rotate(Math.atan2(hv, hu));
  g.fillStyle = '#c6f432'; g.strokeStyle = '#0d1620'; g.lineWidth = 2; g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, 6); g.lineTo(-4, 0); g.lineTo(-7, -6); g.closePath(); g.fill(); g.stroke(); g.restore();
  // flecha del viento (hacia dónde sopla)
  const wu = -WIND.D.z, wv = WIND.D.x;
  g.save(); g.translate(W - 26, 26); g.rotate(Math.atan2(wv, wu));
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-14, 0); g.lineTo(12, 0); g.moveTo(5, -6); g.lineTo(12, 0); g.lineTo(5, 6); g.stroke(); g.restore();
}

// =====================================================================================
//  SONIDO (sintetizado): viento, agua bajo la tabla, golpes y salpicaduras
// =====================================================================================
const SFX = { ctx: null, on: true };
try { SFX.on = localStorage.getItem('kite-sound') !== 'off'; } catch (e) {}
function sfxInit() {
  if (SFX.ctx || !window.AudioContext) return;
  const ctx = SFX.ctx = new AudioContext(), n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  SFX.buf = buf; SFX.master = ctx.createGain(); SFX.master.connect(ctx.destination);
  const loop = (type, f, q) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(SFX.master); s.start(); return { g, fl }; };
  SFX.wind = loop('lowpass', 500, 0.6); SFX.water = loop('bandpass', 1500, 0.8);
}
function sfxUpdate() {
  if (!SFX.ctx) return;
  SFX.master.gain.value = SFX.on && !GAME.paused && !document.hidden ? 0.6 : 0;
  const tt = SFX.ctx.currentTime, wv = WIND.knNow / 20 + R.v / 25;
  SFX.wind.g.gain.setTargetAtTime(0.05 + 0.1 * wv, tt, 0.3); SFX.wind.fl.frequency.setTargetAtTime(300 + 350 * wv, tt, 0.3);
  const on = R.state === 'ride' ? (R.foilOn ? 0.25 : 1) : 0;
  SFX.water.g.gain.setTargetAtTime(on * clamp(R.v / 12, 0, 1) * 0.16, tt, 0.15); SFX.water.fl.frequency.setTargetAtTime(900 + R.v * 80, tt, 0.2);
}
function sfxBurst(dur, f0, f1, gain) {
  if (!SFX.ctx || !SFX.on) return;
  const ctx = SFX.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
  s.buffer = SFX.buf; fl.type = 'lowpass'; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(fl).connect(g).connect(SFX.master); s.start(t); s.stop(t + dur);
}
function sfxThump(f, gain, dur) {
  if (!SFX.ctx || !SFX.on) return;
  const ctx = SFX.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + dur); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(SFX.master); o.start(t); o.stop(t + dur);
}
function sfxSplash(k) { sfxBurst(0.5 + 0.4 * k, 2600, 300, 0.2 + 0.25 * Math.min(k, 1.5)); sfxThump(70, 0.2 * k, 0.25); }
$('bSnd').onclick = () => { SFX.on = !SFX.on; $('bSnd').textContent = SFX.on ? '🔊' : '🔇'; try { localStorage.setItem('kite-sound', SFX.on ? 'on' : 'off'); } catch (e) {} sfxInit(); };
$('bSnd').textContent = SFX.on ? '🔊' : '🔇';

// =====================================================================================
//  MENÚ
// =====================================================================================
for (const [id, nm, , sub] of WINDS) {
  const b = document.createElement('button'); b.className = 'opt' + (id === WIND.id ? ' sel' : ''); b.dataset.w = id;
  b.innerHTML = `<b>${nm}</b><em>${sub}</em>`; $('winds').appendChild(b);
  b.onclick = () => { const p = WINDS.find(x => x[0] === id); [WIND.id, WIND.name, WIND.dir] = p; document.querySelectorAll('#winds .opt').forEach(x => x.classList.toggle('sel', x === b)); saveWind(); };
}
function saveWind() { $('knLbl').textContent = `Fuerza ${WIND.kn} nudos`; try { localStorage.setItem('kite-wind', JSON.stringify({ id: WIND.id, kn: WIND.kn })); } catch (e) {} }
$('kn').value = WIND.kn; saveWind();
$('kn').oninput = e => { WIND.kn = +e.target.value; saveWind(); };
document.querySelectorAll('#modes .opt').forEach(b => b.onclick = () => setMode(b.dataset.m));
function showPanel(id) { for (const p of ['pMain', 'pControls']) $(p).hidden = p !== id; }
$('toControls').onclick = () => showPanel('pControls'); $('controlsOk').onclick = () => showPanel('pMain');
$('camBtn').onclick = () => setCam((CAM.mode + 1) % CAM.names.length);
function togglePause() { if (!GAME.running) return; GAME.paused = !GAME.paused; msg(GAME.paused ? 'PAUSA' : ''); sfxUpdate(); }
$('bPause').onclick = togglePause; $('bCam').onclick = nextCam;
$('bMenu').onclick = () => { GAME.running = false; GAME.paused = false; $('hud').hidden = true; $('menu').hidden = false; showPanel('pMain'); msg(''); };
$('go').onclick = () => {
  sfxInit(); if (SFX.ctx && SFX.ctx.state === 'suspended') SFX.ctx.resume();
  $('menu').hidden = true; $('hud').hidden = false; GAME.running = true; GAME.paused = false;
  R.score = 0; CAM.off = null; CAM.h = R.h; setCam(CAM.mode); stickWords(); snapKite();
  if (R.state === 'fallen') getUp();
  msg(MODES[GAME.mode].name + ' · VIENTO ' + WIND.name.toUpperCase() + ' ' + WIND.kn + ' KN', 2.2);
  const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (IS_MOBILE && !IS_IOS && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
};
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); sprayMat.uniforms.uScale.value = innerHeight * 0.5; });

// ---- carga de JuanP
async function loadModels() {
  const g = await loadGLB('juanp.glb?v=1', 3.2e6);
  const h = g && setupHuman(g);
  if (h) { HUMAN = h; body.add(h.root); $('loadLine').textContent = '✅ JuanP listo'; }
  else $('loadLine').textContent = '⚠️ No se ha podido cargar a JuanP: recarga la página';
}

// =====================================================================================
//  BUCLE
// =====================================================================================
const clock = new T.Clock();
function hud() {
  $('spd').innerHTML = `${(R.v / 0.5144).toFixed(0)}<em>NUDOS · ${(R.v * 3.6).toFixed(0)} KM/H</em>`;
  $('windLbl').textContent = `VIENTO ${WIND.name.toUpperCase()} ${WIND.knNow.toFixed(0)} KN`;
  const sn = sailName(R.twa), el = $('sail'); el.textContent = R.state === 'fallen' ? 'EN EL AGUA' : MODES[GAME.mode].foil && R.state === 'ride' ? sn + (R.foilOn ? ' · VOLANDO' : '') : sn; el.className = R.twa < 38 ? 'nogo' : '';
  $('place').textContent = zoneName(R.x, R.z);
  $('powM').style.width = (R.power * 100).toFixed(0) + '%';
  $('score').textContent = R.score.toLocaleString('es-ES');
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!GAME.paused) {
    GAME.t += dt;
    const t = GAME.t;
    U.uTime.value = t; skyMat.uniforms.uTime.value = t;
    updateWind(t);
    const S = readSticks();
    updateRider(dt, S);
    placeRider(t);
    updateKite(dt);
    updateSpray(dt);
    updateTrail(dt, t);
    if (GAME.running) { hud(); drawSticks(); drawMap(); }
    sfxUpdate();
  }
  if (!window.__freeCam) updateCamera(dt);
  const rp = riderRoot.position;
  waterNear.position.set(Math.round(rp.x / 2) * 2, 0, Math.round(rp.z / 2) * 2);
  waterFar.position.set(Math.round(rp.x / 100) * 100, 0, Math.round(rp.z / 100) * 100);
  sun.position.copy(rp).addScaledVector(SUN_DIR, 90); sun.target.position.copy(rp); sun.target.updateMatrixWorld();
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
setMode(GAME.mode); setCam(CAM.mode);
updateWind(0);
R.h = Math.atan2(WIND.F.z, WIND.F.x) + 100 * DEG * R.s; snapKite();
loadModels();
frame();
window.__game = { R, WIND, KITE, CAM, GAME, setMode, setCam, scene, camera, J, solidAt, getUp };
