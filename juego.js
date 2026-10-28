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
  kite: { name: 'KITESURF', k: 1.5, foil: false, knob: 'SALTO' },
  wing: { name: 'WING FOIL', k: 1.4, foil: true, takeoff: 4.4, knob: 'PUMP' },
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
// el material elegido (tabla de kite y tabla de foil); el ala del wing la guarda WING
const GEAR = { kb: 'lima', fb: 'turquesa' };
try { Object.assign(GEAR, JSON.parse(localStorage.getItem('kite-gear') || '{}')); } catch (e) {}
const KITE_BOARDS = {
  lima: { name: 'Negra', sub: 'Línea verde lima', sw: '#121314' },
  roja: { name: 'Roja', sub: 'Franjas blancas', sw: '#d9302c' },
  blanca: { name: 'Blanca', sub: 'Franja turquesa', sw: '#eeeeea' },
};
if (!KITE_BOARDS[GEAR.kb]) GEAR.kb = 'lima';
function makeKiteBoard(id) {
  const g = makeBoardMesh(0);
  if (id === 'roja' || id === 'blanca') {
    const tex = canvasTex(1024, 320, (c, w, h) => {
      const red = id === 'roja';
      c.fillStyle = red ? '#d9302c' : '#eeeeea'; c.fillRect(0, 0, w, h);
      c.fillStyle = red ? '#ffffff' : '#1fb3c8';
      if (red) for (const x0 of [0.18, 0.24, 0.7, 0.76]) { c.beginPath(); c.moveTo(w * x0, 0); c.lineTo(w * (x0 + 0.03), 0); c.lineTo(w * (x0 - 0.04), h); c.lineTo(w * (x0 - 0.07), h); c.fill(); }
      else c.fillRect(0, h * 0.4, w, h * 0.2);
      c.fillStyle = red ? '#ffffff' : '#0d1620'; c.font = 'italic 900 64px Segoe UI, sans-serif'; c.fillText('TATANKA', w * 0.36, h * (red ? 0.6 : 0.33));
    });
    g.traverse(o => { if (o.isMesh && Array.isArray(o.material)) { o.material[0] = o.material[0].clone(); o.material[0].map = tex; } });
  }
  return g;
}
let kiteBoard = makeKiteBoard(GEAR.kb);
const FOIL_BOARDS = {
  turquesa: { name: 'Turquesa', sub: 'La de David', base: '#143f5c', sp: ['#1f7193', '#2f8fae', '#0f2c42', '#48b3cc', '#1a4d6b'], sw: '#1f7193' },
  blanca: { name: 'Blanca', sub: 'Jaspeada gris', base: '#dfe3e0', sp: ['#b9c4c4', '#8fb7bf', '#f4f6f4', '#c9d3d2', '#9fc9d0'], sw: '#dfe3e0' },
};
if (!FOIL_BOARDS[GEAR.fb]) GEAR.fb = 'turquesa';
// la de foil, como la de David: corta y ancha, punta redondeada y cola recta, cantos y fondo azul turquesa
// jaspeado, pad negro en toda la cubierta, dos footstraps negros y el foil de carbono negro
function makeFoilBoard(len, wid, thick, design = 'turquesa') {
  const FD = FOIL_BOARDS[design] || FOIL_BOARDS.turquesa;
  const g = new T.Group(), sh = new T.Shape(), L = len / 2, W = wid / 2;
  sh.moveTo(-L, -W * 0.8); sh.quadraticCurveTo(-L, -W, -L + 0.08, -W); sh.lineTo(L * 0.2, -W);
  sh.bezierCurveTo(L * 0.75, -W, L, -W * 0.62, L, 0); sh.bezierCurveTo(L, W * 0.62, L * 0.75, W, L * 0.2, W);
  sh.lineTo(-L + 0.08, W); sh.quadraticCurveTo(-L, W, -L, W * 0.8); sh.lineTo(-L, -W * 0.8);
  const geo = new T.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 3, curveSegments: 16 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -thick + 0.02, 0);
  // azul turquesa jaspeado (fibra de vidrio con pintura salpicada)
  const jas = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = FD.base; c.fillRect(0, 0, w, h);
    let sd = 11; const rr = () => (sd = (sd * 9301 + 49297) % 233280) / 233280;
    for (let k = 0; k < 2600; k++) {
      const x = rr() * w, y = rr() * h, l = 2 + rr() * 9, a = rr() * TAU;
      c.strokeStyle = FD.sp[k % 5]; c.globalAlpha = 0.35 + rr() * 0.5; c.lineWidth = 1 + rr() * 1.5;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    }
    c.globalAlpha = 1;
  });
  jas.wrapS = jas.wrapT = T.RepeatWrapping; jas.repeat.set(1.6, 1.6);
  const m = new T.Mesh(geo, MAT(0xffffff, 0.3, 0.05, { map: jas })); m.castShadow = true; g.add(m);
  // pad negro de cubierta (casi toda la tabla)
  const pad = new T.Shape(), pl = L - 0.05, pw = W - 0.04;
  pad.moveTo(-pl, -pw * 0.8); pad.quadraticCurveTo(-pl, -pw, -pl + 0.06, -pw); pad.lineTo(pl * 0.2, -pw);
  pad.bezierCurveTo(pl * 0.62, -pw, pl * 0.82, -pw * 0.62, pl * 0.82, 0); pad.bezierCurveTo(pl * 0.82, pw * 0.62, pl * 0.62, pw, pl * 0.2, pw);
  pad.lineTo(-pl + 0.06, pw); pad.quadraticCurveTo(-pl, pw, -pl, pw * 0.8); pad.lineTo(-pl, -pw * 0.8);
  const pg = new T.ShapeGeometry(pad, 16); pg.rotateX(-Math.PI / 2);
  const pm = new T.Mesh(pg, MAT(0x16181b, 0.95)); pm.position.y = 0.047; pm.receiveShadow = true; g.add(pm);
  // dos footstraps negros, por encima de cada pie
  const strapM = MAT(0x111214, 0.7);
  for (const sx of [-1, 1]) {
    const st = new T.Mesh(new T.TorusGeometry(0.07, 0.02, 6, 16, Math.PI), strapM);
    st.scale.set(1, 0.85, 2.2); st.position.set(sx * 0.28, 0.05, 0.02); g.add(st);
    box(0.05, 0.03, 0.06, strapM, sx * 0.28 - 0.07, 0.06, 0.02, g); box(0.05, 0.03, 0.06, strapM, sx * 0.28 + 0.07, 0.06, 0.02, g);
  }
  // foil: mástil, fuselaje, ala delantera y estabilizador (de carbono negro)
  const carb = MAT(0x15171a, 0.35, 0.4), y0 = -thick;
  box(0.035, 0.85, 0.12, carb, -0.05, y0 - 0.425, 0, g);
  const fus = new T.Mesh(new T.CylinderGeometry(0.022, 0.016, 0.95, 10), carb); fus.rotation.z = Math.PI / 2; fus.position.set(-0.05, y0 - 0.86, 0); g.add(fus);
  const fw = new T.Mesh(new T.SphereGeometry(1, 20, 6), carb); fw.scale.set(0.09, 0.012, 0.45); fw.position.set(0.32, y0 - 0.86, 0); g.add(fw);
  const st = new T.Mesh(new T.SphereGeometry(1, 16, 6), carb); st.scale.set(0.05, 0.01, 0.18); st.position.set(-0.5, y0 - 0.86, 0); g.add(st);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
let wingBoard = makeFoilBoard(1.4, 0.6, 0.1, GEAR.fb);
boardGroup.add(kiteBoard, wingBoard);

// ---- el ala de mano (wing): borde de ataque hinchable, tela y botavara central con dos asas
// ---- el ala del wing (como la del usuario): borde de ataque hinchable, strut con asas, dos ventanas a cada lado,
//      tela roja o verde lima con chevrones grandes, la talla en las puntas y remates cian. Se elige en Material
const WING_DESIGNS = {
  roja: { name: 'Roja', sub: '3.5 · la tuya', size: '3.5', cloth: '#e3302c', dark: '#b51f1d', ink: '#ffffff', num: '#e9f25a', dots: 'rgba(255,255,255,.55)', le: 0x24282c, mid: 0x24282c },
  verde: { name: 'Verde', sub: '4.5 · lima', size: '4.5', cloth: '#a6e34a', dark: '#7fbf2b', ink: '#0d1620', num: '#0d1620', dots: 'rgba(13,22,32,.25)', le: 0x3a2f7a, mid: 0xf2c400 },
};
// dibujo de la tela: u a lo largo de la envergadura (0 → 1), v del borde de ataque (0) al de salida (1)
function drawWing(c, w, h, d) {
  c.clearRect(0, 0, w, h);
  c.fillStyle = d.cloth; c.fillRect(0, 0, w, h);
  // degradados de puntos junto al borde de ataque
  c.fillStyle = d.dots;
  for (const u0 of [0.12, 0.3, 0.62, 0.8]) for (let y = 0; y < h * 0.14; y += 7) for (let x = 0; x < w * 0.08; x += 7) { const r = 2.2 * (1 - y / (h * 0.14)); if (r > 0.3) { c.beginPath(); c.arc(w * u0 + x, y + 4, r, 0, TAU); c.fill(); } }
  // costuras de los paneles
  c.strokeStyle = d.dark; c.lineWidth = 3;
  for (const u of [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9]) { c.beginPath(); c.moveTo(w * u, 0); c.lineTo(w * u, h); c.stroke(); }
  for (const v of [0.35, 0.68]) { c.beginPath(); c.moveTo(0, h * v); c.lineTo(w, h * v); c.stroke(); }
  // las dos diagonales grandes desde el centro
  c.strokeStyle = 'rgba(13,22,32,.75)'; c.lineWidth = 4;
  c.beginPath(); c.moveTo(w * 0.36, h * 0.12); c.lineTo(w * 0.22, h * 0.86); c.moveTo(w * 0.64, h * 0.12); c.lineTo(w * 0.78, h * 0.86); c.stroke();
  // ventanas transparentes, dos a cada lado del strut
  const win = (a, b, c2, d2) => { c.beginPath(); c.moveTo(w * a[0], h * a[1]); c.lineTo(w * b[0], h * b[1]); c.lineTo(w * c2[0], h * c2[1]); c.lineTo(w * d2[0], h * d2[1]); c.closePath(); };
  c.save(); c.globalCompositeOperation = 'destination-out';
  for (const s of [-1, 1]) {
    const m = x => 0.5 + s * x;
    win([m(0.015), 0.16], [m(0.13), 0.16], [m(0.1), 0.48], [m(0.015), 0.48]); c.fill();
    win([m(0.015), 0.58], [m(0.08), 0.58], [m(0.065), 0.8], [m(0.015), 0.8]); c.fill();
  }
  c.restore();
  c.save(); c.fillStyle = 'rgba(225,235,240,.28)'; c.strokeStyle = d.dark; c.lineWidth = 3;
  for (const s of [-1, 1]) {
    const m = x => 0.5 + s * x;
    win([m(0.015), 0.16], [m(0.13), 0.16], [m(0.1), 0.48], [m(0.015), 0.48]); c.fill(); c.stroke();
    win([m(0.015), 0.58], [m(0.08), 0.58], [m(0.065), 0.8], [m(0.015), 0.8]); c.fill(); c.stroke();
  }
  c.restore();
  // chevrones grandes (en hueco) a cada lado
  c.strokeStyle = d.ink; c.lineWidth = 7; c.lineJoin = 'round';
  const chev = (cx, cy, s, up) => { const k = up ? -1 : 1; c.beginPath(); c.moveTo(cx - 0.06 * w, cy - k * s); c.lineTo(cx, cy + k * s); c.lineTo(cx + 0.06 * w, cy - k * s); c.stroke();
    c.beginPath(); c.moveTo(cx - 0.035 * w, cy - k * s * 1.9); c.lineTo(cx + 0.035 * w, cy - k * s * 1.9); c.stroke(); };
  chev(w * 0.16, h * 0.5, h * 0.09, false); chev(w * 0.84, h * 0.5, h * 0.09, true);
  // talla junto a las puntas y el nombre en las diagonales
  c.fillStyle = d.num; c.font = `900 ${h * 0.09}px Arial, sans-serif`; c.textAlign = 'center';
  c.fillText(d.size, w * 0.05, h * 0.6); c.fillText(d.size, w * 0.95, h * 0.6);
  c.fillStyle = d.ink; c.font = `900 ${h * 0.055}px Arial, sans-serif`;
  for (const [x, y, a] of [[0.27, 0.62, -1.38], [0.71, 0.38, 1.38]]) { c.save(); c.translate(w * x, h * y); c.rotate(a); c.fillText('TATANKA', 0, 0); c.restore(); }
  // remates cian en las puntas y en el centro del borde de salida
  c.fillStyle = '#25c4e6';
  for (const s of [0, 1]) { c.beginPath(); c.moveTo(w * s, h * 0.78); c.lineTo(w * s, h); c.lineTo(w * (s ? 0.955 : 0.045), h); c.closePath(); c.fill(); }
  c.fillRect(w * 0.485, h * 0.93, w * 0.03, h * 0.07);
}
const WING = (() => {
  const g = new T.Group(), S = 1.9, NS = 28, NC = 6;
  // planta: borde de ataque en arco, puntas anchas y el de salida en V hacia el centro
  const le = x => 0.75 * (1 - 0.72 * (x / S) ** 2), te = x => -0.88 + 0.6 * Math.abs(x / S), ar = x => -0.5 * (x / S) ** 2;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= NC; j++) for (let i = 0; i <= NS; i++) {
    const x = (i / NS * 2 - 1) * S, v = j / NC, y = lerp(le(x), te(x), v);
    pos.push(x, y, ar(x) + 0.12 * Math.sin(Math.PI * v) * (1 - (x / S) ** 2)); uv.push(i / NS, 1 - v);
  }
  for (let j = 0; j < NC; j++) for (let i = 0; i < NS; i++) { const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
  const canopy = new T.Mesh(geo, MAT(0xffffff, 0.6, 0, { map: tex, side: T.DoubleSide, transparent: true, alphaTest: 0.05 })); canopy.castShadow = true; g.add(canopy);
  const lePts = []; for (let i = 0; i <= 20; i++) { const x = (i / 20 * 2 - 1) * S; lePts.push(V3(x, le(x), ar(x))); }
  const leMat = MAT(0x24282c, 0.5), midMat = MAT(0x24282c, 0.5), cyan = MAT(0x25c4e6, 0.5);
  const tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(lePts), 48, 0.09, 8), leMat); tube.castShadow = true; g.add(tube);
  const mid = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.5, 10), midMat); mid.rotation.z = Math.PI / 2; mid.position.set(0, le(0), 0); g.add(mid);   // la parte central (amarilla en la verde)
  for (const x of [-1.5, -1.1, -0.7, 0.7, 1.1, 1.5]) { const r = new T.Mesh(new T.TorusGeometry(0.095, 0.014, 6, 12), cyan); r.position.set(x, le(x), ar(x)); r.rotation.y = Math.PI / 2 + Math.atan(-1.44 * x / S / S * 0.75); g.add(r); }
  const strut = new T.Mesh(new T.TubeGeometry(new T.LineCurve3(V3(0, le(0), 0.02), V3(0, te(0), 0.02)), 4, 0.065, 8), leMat); g.add(strut);
  const handles = [];
  for (const y of [0.3, -0.35]) { const hm = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.22, 8), MAT(0x15171a, 0.5)); hm.position.set(0, y, 0); g.add(hm); handles.push(hm); }
  function setDesign(id) {
    const d = WING_DESIGNS[id] || WING_DESIGNS.roja; W.design = WING_DESIGNS[id] ? id : 'roja';
    drawWing(cv.getContext('2d'), cv.width, cv.height, d); tex.needsUpdate = true;
    leMat.color.setHex(d.le); midMat.color.setHex(d.mid);
    try { localStorage.setItem('kite-wing-design', W.design); } catch (e) {}
  }
  const W = { g, handles, hz: 0.13, setDesign, design: 'roja' };
  let saved = 'roja'; try { saved = localStorage.getItem('kite-wing-design') || 'roja'; } catch (e) {}
  setDesign(saved);
  return W;
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

let HUMAN = null;   // el rider elegido (JuanP o David) cuando ha cargado
const RIDERS = {}; let RIDER_NAME = 'juanp';
try { const r = localStorage.getItem('kite-rider'); if (r === 'juanp' || r === 'david') RIDER_NAME = r; } catch (e) {}

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
  $('modeLbl').textContent = MODES[m].name + ' · ' + RIDER_NAME.toUpperCase();
  gearSum();
  $('bJump').textContent = MODES[m].knob;
  const lt = $('stL').querySelectorAll('text'), w = m === 'kite' ? 'COMETA' : 'ALA'; lt[1].textContent = w + ' ▶'; lt[3].textContent = '◀ ' + w;
  for (const t of ['grab', 'loop']) document.querySelector(`#tricks [data-t="${t}"]`).hidden = m !== 'kite';
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
const IN = { L: mkStick(), R: mkStick(), kb: {}, btn: {} };
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
  if (e.code === 'KeyM') toOpenSea();
  if (e.code === 'KeyL') IN.kbLoop = true;
  if (e.code === 'Enter' && R.state === 'fallen') getUp();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { IN.kb[e.code] = false; if (e.code === 'Space') IN.kbRel = true; });
function readSticks() {
  const k = IN.kb;
  const b = IN.btn;
  const S = {
    L: { x: IN.L.x, y: -IN.L.y, on: !!b.grab || !!k.KeyG },   // barra: x mueve la cometa, y es la potencia
    C: IN.R.y,                                                  // mando derecho: abajo ceñir más (hacia el viento), arriba ceñir menos
    R: { x: 0, y: 0, hold: !!b.jump || !!k.Space, rel: false, circle: b.loopEv || IN.kbLoop },   // salto y trucos
  };
  if (k.KeyA || k.ArrowLeft) S.L.x = -1; if (k.KeyD || k.ArrowRight) S.L.x = 1; if (k.KeyR) S.L.y = 1; if (k.KeyF) S.L.y = -1;
  if (k.ArrowUp) S.C = 1; if (k.ArrowDown) S.C = -1;
  if (b.back || k.KeyW) S.R.y = 1; if (b.front || k.KeyS) S.R.y = -1; if (b.spinL || k.KeyQ) S.R.x = -1; if (b.spinR || k.KeyE) S.R.x = 1;
  S.R.rel = (b.jumpRel || IN.kbRel) && R.charge > 0.06;
  b.jumpRel = b.loopEv = false; IN.R.relEv = IN.L.relEv = false; IN.kbRel = false; IN.R.circleEv = 0; IN.kbLoop = false;
  if (!GAME.running) return autopilot();
  return S;
}
// en el menú navega solo, a un descuartelar, sin acercarse a la costa
function autopilot() {
  const F = WIND.F, phi = Math.atan2(F.z, F.x);
  if (R.state === 'fallen') { if (R.fallT > 2) getUp(); return { L: { x: 0, y: 0 }, C: 0, R: { x: 0, y: 0 } }; }
  let s = R.s;
  const want = sd => { const h = phi + sd * 100 * DEG; return Math.sin(h); };   // componente z del rumbo
  if (R.z > SHORE_Z - 140 && want(s) > -0.2) s = -s;                          // hacia el mar
  if (R.z < SHORE_Z - 700 && want(s) < 0.2) s = -s;                            // hacia la costa
  if (R.x > PIER_X - 200 && Math.cos(phi + s * 100 * DEG) > 0) s = -s;
  if (R.x < MARINA_X + 150 && Math.cos(phi + s * 100 * DEG) < 0) s = -s;
  return { L: { x: 0, y: 0.1 }, C: 0, want: s, R: { x: 0, y: 0 } };
}
// dibujo de los sticks
function stickSVG(words, knob) {
  const chev = rot => `<path d="M-7,-62 L0,-69 L7,-62" transform="rotate(${rot})" />`;
  return `<svg viewBox="-70 -70 140 140" aria-hidden="true"><circle r="66" class="rim"/>${chev(0)}${chev(90)}${chev(180)}${chev(270)}
    <text x="0" y="-41">${words[0]}</text><text x="44" y="-18">${words[1]}</text><text x="0" y="49">${words[2]}</text><text x="-44" y="-18">${words[3]}</text></svg><i class="knob">${knob}</i>`;
}
// la barra de la cometa: puño rojo (izquierda) y azul (derecha), líneas hacia arriba y el chicken loop
$('stL').innerHTML = `<svg viewBox="-110 -62 220 124" aria-hidden="true"><rect class="rim" x="-106" y="-58" width="212" height="116" rx="22"/>
  <text x="0" y="-44">SOLTAR</text><text x="84" y="-26">COMETA ▶</text><text x="0" y="52">TIRAR · POTENCIA</text><text x="-84" y="-26">◀ COMETA</text>
  <g id="barG"><path class="ln" d="M-74,0 L-14,-60 M74,0 L14,-60 M-5,0 L-3,-60 M5,0 L3,-60"/>
  <rect class="bar" x="-80" y="-5" width="160" height="10" rx="5"/><rect x="-80" y="-5" width="30" height="10" rx="5" fill="#ff5a4e"/>
  <rect x="50" y="-5" width="30" height="10" rx="5" fill="#2a8bff"/><circle cx="0" cy="13" r="7" class="loop"/></g></svg><i class="knob"></i>`;
$('stR').innerHTML = stickSVG(['CEÑIR −', '', 'CEÑIR +', ''], '');
// botones: salto (o pump) y, en el aire, los trucos; se mantienen pulsados
for (const el of document.querySelectorAll('#bJump, #tricks button')) {
  const t = el.dataset.t, on = e => { e.preventDefault(); IN.btn[t] = true; if (t === 'loop') IN.btn.loopEv = true; el.classList.add('on'); };
  const off = () => { if (IN.btn[t] && t === 'jump') IN.btn.jumpRel = true; IN.btn[t] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
function drawSticks() {
  $('stR').querySelector('.knob').style.transform = `translate(${(IN.R.x * 40).toFixed(1)}px, ${(-IN.R.y * 40).toFixed(1)}px)`;
  const bx = IN.L.on ? IN.L.x : IN.kb.KeyA ? -1 : IN.kb.KeyD ? 1 : 0, by = IN.L.on ? IN.L.y : 0;
  $('barG').setAttribute('transform', `translate(0 ${(-by * 22).toFixed(1)}) rotate(${(bx * 26).toFixed(1)})`);
  $('hud').classList.toggle('inAir', R.state === 'air');
  $('bJump').style.setProperty('--c', R.charge.toFixed(2));
  // en wing el botón es PUMP despacio y SALTO cuando vas volando o planeando rápido
  const kn = GAME.mode === 'wing' && !(R.foilOn || R.v > 5) ? 'PUMP' : 'SALTO';
  if ($('bJump').textContent !== kn) $('bJump').textContent = kn;
}
// ceñir va arriba y abajo en las dos amuras: no hay que recolocar nada
function stickWords() {}

// =====================================================================================
//  FÍSICA
// =====================================================================================
function getUp() {
  const F = WIND.F, phi = Math.atan2(F.z, F.x);
  R.state = 'ride'; R.fallT = 0; R.yr = 0; R.turn = 0; R.gybe = 0; R.gyT = 0; R.v = 2; R.vy = 0; R.charge = 0; R.air = null;
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
  R.kiteIn = GAME.mode === 'kite' && R.state !== 'fallen' ? S.L.x : 0;
  const surf = surfaceH(R.x, R.z, GAME.t);

  if (R.state === 'fallen') {
    R.fallT += dt; R.y = surf;
    // en el agua la cometa (o el ala) te arrastra un poco a sotavento
    R.x += D.x * 0.5 * dt; R.z += D.z * 0.5 * dt;
    if (R.fallT > 2.6) getUp();
  } else if (R.state === 'ride') {
    // giro con inercia: la velocidad de giro sube y baja poco a poco; curva suave para el dedo
    const kite = GAME.mode === 'kite';
    const phi = Math.atan2(F.z, F.x);
    // con la cometa manda ella: si pasa al otro lado de la ventana, trasluchada y sales hacia ese lado
    if (kite && !R.gybe && Math.abs(KITE.kx) > 0.15 && Math.sign(KITE.kx) !== sideOfS(R.s)) R.gybe = -R.s;
    // con el wing, la barra mantenida hacia el otro lado de la pantalla hace la trasluchada
    if (!kite) { const rdir = H.dot(WIND.E0) >= 0 ? 1 : -1; R.gyT = Math.abs(S.L.x) > 0.5 && Math.sign(S.L.x) !== rdir ? (R.gyT || 0) + dt : 0; if (R.gyT > 0.35 && !R.gybe) R.gybe = -R.s; }
    if (S.want && S.want !== R.s && !R.gybe) R.gybe = S.want;   // el piloto del menú
    // ceñir: el mando derecho fija el rumbo respecto al viento (abajo ceñir más, arriba ceñir menos; suelto, al través)
    const twaT = 100 + 45 * clamp(S.C || 0, -1, 1);
    let st;
    if (R.gybe) {   // trasluchada: primero hacia popa, luego al rumbo de la otra amura
      const hd = Math.atan2(D.z, D.x);
      if (R.s !== R.gybe) st = Math.sign(angDiff(R.h, hd)) || 1;
      else { const e = angDiff(R.h, phi + R.s * twaT * DEG); st = clamp(e * 2, -1, 1); if (Math.abs(e) < 0.12) R.gybe = 0; }
    } else st = clamp(angDiff(R.h, phi + R.s * twaT * DEG) * 1.6, -1, 1);
    const inp = st;
    const maxRate = kite ? 0.52 + 0.07 * Math.min(R.v, 10) : 0.6 + (R.foilOn ? 0.07 : 0.04) * Math.min(R.v, 10);
    R.turn = lerp(R.turn, inp, clamp(dt * 5, 0, 1));
    R.yr += (R.turn * maxRate * (R.gybe ? 1.6 : 1) - R.yr) * clamp(dt * (kite ? 3.4 : 2.8), 0, 1);
    R.h += R.yr * dt;
    R.v -= Math.abs(R.yr) * R.v * (kite ? 0.1 : 0.06) * dt;     // trazar curvas cuesta velocidad
    // velocidad objetivo: viento × polar × potencia (con poco viento la cometa o el ala no tira)
    const pf = (0.55 + 0.45 * R.power) * (0.45 + 0.55 * smooth(7, 17, WIND.knNow));
    let vt = WIND.ms * polar(R.twa) * pf * M.k;
    if (M.foil && !R.foilOn) vt *= 0.6;                         // sin volar, el casco frena
    // la cometa tira más metida en la zona de potencia; si la pasas al otro lado, frena
    if (kite) vt *= Math.abs(KITE.kx) > 0.15 && Math.sign(KITE.kx) !== sideOfS(R.s) ? 0.5 : 0.75 + 0.45 * (1 - KITE.e) + 0.45 * KITE.vk / 1.5;   // la cometa corriendo por el centro tira más; aparcada en el borde, menos
    vt = Math.min(vt, 22);
    // inercia: acelera más despacio que frena; volando en el foil se planea y frena poco
    const acc = 0.6, dec = kite ? 0.9 : R.foilOn ? 0.45 : 1.1;
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
      } else if (R.foilOn || R.v > 5) {   // wing: volando o planeando rápido, salto de verdad; el ala tira hacia arriba en el aire
        startAir(2.4 + c * (2 + 0.3 * WIND.ms) + 0.14 * R.v, 0.45);
        say('¡SALTO!', 'clean', 0.8);
      }
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
  R.yaw += clamp(yawT - R.yaw, -dt * 6, dt * 6);
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
//  POSTURA DEL RIDER (en el espacio del cuerpo: mira a +Z, la tabla va a lo largo de X)
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
    if (WP.Z.z < 0) { WP.X.negate(); WP.Z.negate(); }   // el lado cóncavo (puntas y asas) mira al rider
    WP.m.makeBasis(WP.X, WP.Y, WP.Z); WING.g.quaternion.setFromRotationMatrix(WP.m); WING.g.position.copy(WP.C);
    const hz2 = -WING.hz;   // las asas por el lado del rider
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
  // al caerse con el wing, el ala cae al agua y se queda flotando plana a sotavento, con las puntas en el agua
  if (GAME.mode === 'wing') {
    const dtp = clamp(t - (WING.tp ?? t), 0, 0.05); WING.tp = t;
    WING.fk = lerp(WING.fk || 0, R.state === 'fallen' ? 1 : 0, clamp(dtp * (R.state === 'fallen' ? 2.5 : 4), 0, 1));
    if (WING.fk > 0.002) {
      const D = WIND.D, wp = V3(R.x + D.x * 1.7, surfaceH(R.x + D.x * 1.7, R.z + D.z * 1.7, t) + 0.38, R.z + D.z * 1.7);
      const Zw = V3(0, 1, 0), Yw = V3(-D.x, 0, -D.z).normalize(), Xw = V3().crossVectors(Yw, Zw);
      const qW = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(Xw, Yw, Zw));
      const qB = body.getWorldQuaternion(new T.Quaternion()).invert();
      WING.g.position.lerp(body.worldToLocal(wp), WING.fk); WING.g.quaternion.slerp(qB.multiply(qW), WING.fk);
    }
  }
  if (HUMAN) poseHuman(HUMAN, J);
}

// ---- la cometa: posición en la ventana de viento, orientación y líneas a la barra
// la cometa ya colocada en su lado de la ventana (al empezar, sin cruzarla)
// ---- la cometa como una de verdad: vuela por la ventana de viento hacia donde apunta su morro.
//      La barra la hace girar (tirar de la izquierda = gira a la izquierda); al soltarla sigue recta,
//      llega al borde de la ventana y se queda ahí aparcada. En el centro corre y tira más.
//      Coordenadas de la ventana vistas con el viento a la espalda: kx = -1 izquierda … +1 derecha, el = altura (rad),
//      psi = hacia dónde apunta el morro (0 arriba, +π/2 a la derecha)
const sideOfS = s => { const F = WIND.F, h = Math.atan2(F.z, F.x) + s * 100 * DEG; return Math.sign(Math.cos(h) * WIND.E0.x + Math.sin(h) * WIND.E0.z) || 1; };
function snapKite() { const sd = sideOfS(R.s); KITE.kx = sd * 0.75; KITE.el = 0.55; KITE.psi = sd * 1.25; KITE.vk = 0; KITE.vx = KITE.vy = 0; KITE.qOk = false; KITE.e = 0.9; KITE.az = KITE.kx; KITE.side = sd; }
function kiteSteer(tx, tel) {   // piloto automático: gira el morro hacia un punto de la ventana
  return clamp(angDiff(KITE.psi, Math.atan2(tx - KITE.kx, (tel - KITE.el) / (Math.PI / 2))) * 2.2, -1, 1);
}
function updateKite(dt) {
  if (GAME.mode !== 'kite') return;
  const D = WIND.D, E0 = WIND.E0, t = GAME.t;
  // ¿quién lleva la cometa? el jugador con la barra; al cargar el salto, en el aire, caído o en el menú, el piloto automático
  const sd = sideOfS(R.gybe || R.s);
  let tilt = clamp(R.kiteIn || 0, -1, 1);
  if (!GAME.running) tilt = kiteSteer(sd * 0.7, 0.5 + 0.1 * Math.sin(t * 0.4));
  if (R.state === 'ride' && R.charge > 0.05) tilt = lerp(tilt, kiteSteer(KITE.kx * 0.3, 1.3), R.charge);
  if (R.state === 'air') tilt = R.air && R.air.t < 1.1 ? kiteSteer(sd * 0.2, 1.3) : kiteSteer(sd * 0.6, 0.7);
  if (R.state === 'fallen') tilt = kiteSteer(Math.sign(KITE.kx || 1) * 0.95, 0);
  KITE.tilt = lerp(KITE.tilt || 0, tilt, clamp(dt * 3, 0, 1));   // la barra entra poco a poco: sin tirones
  // giro del morro: progresivo con la barra; en el kiteloop da la vuelta entera
  KITE.psi += KITE.tilt * (1.8 + 0.5 * R.power) * dt;
  if (KITE.loop > 0) { KITE.loop = Math.max(0, KITE.loop - dt / 1.3); KITE.psi += sd * TAU / 1.3 * dt; }
  // velocidad: corre en el centro de la ventana y se para en el borde
  const HP = Math.PI / 2, e0 = Math.hypot(KITE.kx, KITE.el / HP);
  const vmax = 1.5 * clamp(0.5 + 0.5 * WIND.knNow / 16, 0.6, 1.4);
  // en el borde no puede seguir hacia fuera, pero si la giras hacia dentro vuelve a correr
  // con inercia: la velocidad cambia de dirección poco a poco, como una cometa de verdad
  const vT = vmax * (0.3 + 0.7 * R.power), ki = clamp(dt * 2.2, 0, 1);
  let vx = lerp(KITE.vx || 0, Math.sin(KITE.psi) * vT, ki), vy = lerp(KITE.vy || 0, Math.cos(KITE.psi) * vT, ki);
  const nx = KITE.kx / (e0 || 1), ny = KITE.el / HP / (e0 || 1), out = vx * nx + vy * ny;
  const outOk = Math.max(0, 0.96 - e0) * 4;   // cuanto más cerca del borde, menos puede seguir hacia fuera: frena sin golpe
  if (out > outOk) { const f = (out - outOk) * clamp(dt * 14, 0, 1); vx -= f * nx; vy -= f * ny; }
  // junto al agua frena la bajada suavemente en vez de chocar
  const up = clamp(((KITE.clr ?? 1) + 0.7) / 1.7, 0, 1), elLo = Math.max(0.12 * up, KITE.elMin || 0) + 0.04 * up;   // tras una caída, el suelo sube poco a poco   // un poco de margen para no tener que corregirla de golpe
  if (vy < 0) vy *= smooth(elLo, elLo + 0.2, KITE.el);
  KITE.vx = vx; KITE.vy = vy;
  KITE.vk = Math.hypot(vx, vy);
  KITE.kx += vx * dt;
  KITE.el += vy * HP * 0.8 * dt;
  if (R.state === 'fallen') KITE.el -= dt * 0.5;   // sin tensión en las líneas pierde sustentación y cae al agua
  // el borde: no lo pasa, y sin tocar la barra el morro se queda mirando hacia fuera (aparcada)
  const e = Math.hypot(KITE.kx, KITE.el / HP);
  if (e > 0.97) { KITE.kx *= 0.97 / e; KITE.el *= 0.97 / e; }
  if (e > 0.8 && Math.abs(KITE.tilt) < 0.3) KITE.psi += angDiff(KITE.psi, Math.atan2(KITE.kx, KITE.el / HP)) * clamp(dt * 2.5 * (e - 0.8) / 0.17, 0, 1);
  // abajo, junto al agua: no baja más; si el morro apunta al agua se endereza y sigue volando en horizontal a un metro
  if (KITE.el <= elLo + 0.1 && Math.cos(KITE.psi) < 0) KITE.psi += angDiff(KITE.psi, (Math.sign(Math.sin(KITE.psi)) || sd) * HP) * clamp(dt * 3 * smooth(elLo + 0.1, elLo, KITE.el), 0, 1);
  if (KITE.el < elLo) KITE.el = elLo;
  KITE.psi = angDiff(0, KITE.psi);
  KITE.az = KITE.kx; if (Math.abs(KITE.kx) > 0.1) KITE.side = Math.sign(KITE.kx);
  KITE.e = Math.min(e, 0.97);
  let az = KITE.kx, el = KITE.el;
  const gust = WIND.knNow - WIND.kn;
  az += 0.012 * Math.sin(t * 1.7 + 1); el = clamp(el + 0.015 * Math.sin(t * 0.9) + 0.006 * gust, 0, 1.56);
  // la barra: entre los nudillos del rider
  if (HUMAN && HUMAN.knuckL) { const a = HUMAN.knuckL.getWorldPosition(tmp.a), b = HUMAN.knuckR.getWorldPosition(tmp.b); KITE.barC.addVectors(a, b).multiplyScalar(0.5); KITE.barDir = (KITE.barDir || V3()).subVectors(b, a).normalize(); }
  else { body.localToWorld(KITE.barC.copy(J.aF).add(J.aB).multiplyScalar(0.5)); KITE.barDir = (KITE.barDir || V3()).set(-Math.sin(R.h), 0, Math.cos(R.h)); }
  const a = az * (camera.aspect < 1 ? Math.PI / 4.5 : Math.PI / 3), dir = tmp.c.copy(D).multiplyScalar(Math.cos(a)).addScaledVector(E0, Math.sin(a));
  KITE.pos.copy(KITE.barC).addScaledVector(dir, LINE * Math.cos(el)); KITE.pos.y += LINE * Math.sin(el);
  const Z = tmp.d.subVectors(KITE.pos, KITE.barC).normalize();
  // el morro hacia psi en el plano de la ventana: derecha = E0 (con el viento a la espalda), arriba = hacia el cénit
  const rA = V3().copy(E0).addScaledVector(Z, -E0.dot(Z));
  // la derecha de la ventana nunca degenera (la cometa no pasa de 60° a los lados): una sola referencia, sin saltos
  const eR = rA.normalize(), eU = V3().crossVectors(eR, Z);
  const Y = eU.multiplyScalar(Math.cos(KITE.psi)).addScaledVector(eR, Math.sin(KITE.psi)).normalize();
  const X = V3().crossVectors(Y, Z), Yw = V3().crossVectors(Z, X);
  tmp.m.makeBasis(X, Yw, Z); tmp.q.setFromRotationMatrix(tmp.m);
  if (KITE.qOk) KITE.g.quaternion.slerp(tmp.q, clamp(dt * 6, 0, 1)); else { KITE.g.quaternion.copy(tmp.q); KITE.qOk = true; }   // gira suave, sin golpes
  // nunca toca el agua: el punto más bajo de la tela (una punta al girar) se queda al menos a un metro
  let low = 0; const b0k = KITE.base, q = KITE.g.quaternion;
  for (let i = 0; i < b0k.length; i += 3) low = Math.min(low, tmp.a.set(b0k[i], b0k[i + 1], b0k[i + 2]).applyQuaternion(q).y);
  // navegando, a un metro del agua; si el rider se cae, la cometa cae y toca el agua (y luego vuelve a subir despacio)
  KITE.clr = lerp(KITE.clr ?? 1, R.state === 'fallen' ? -0.7 : 1, clamp(dt * (R.state === 'fallen' ? 3 : 0.7), 0, 1));
  const elReq = Math.asin(clamp((KITE.clr - low - KITE.barC.y) / LINE, -1, 1));
  KITE.elMin = elReq - (el - KITE.el);
  if (el < elReq) { el = elReq; KITE.pos.copy(KITE.barC).addScaledVector(dir, LINE * Math.cos(el)); KITE.pos.y += LINE * Math.sin(el); Z.subVectors(KITE.pos, KITE.barC).normalize(); }
  KITE.g.position.copy(KITE.pos);
  KITE.g.updateMatrixWorld(true);
  // barra y líneas: las delanteras salen del centro, las traseras de los extremos
  const bd = KITE.barDir, c = KITE.barC;
  // tensión: tiran más con potencia, velocidad y en el aire; si no, las líneas cuelgan
  const tens = R.state === 'fallen' ? 0.15 : clamp(0.3 + 0.4 * R.power + 0.03 * R.v + 0.2 * KITE.vk + (R.state === 'air' ? 0.3 : 0), 0, 1);
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
const CAM = { mode: 0, names: ['VIENTO', 'DETRÁS', 'CERCA', 'ALTA', 'DESDE ARRIBA'], pos: V3(), look: V3(), h: 0, off: null, lookOff: null };
try { CAM.mode = +(localStorage.getItem('kite-cam2') || 0) % CAM.names.length; } catch (e) {}
function setCam(i) { CAM.mode = i; $('camBtn').textContent = 'Cámara: ' + CAM.names[i].toLowerCase(); try { localStorage.setItem('kite-cam2', i); } catch (e) {} }
function nextCam() { setCam((CAM.mode + 1) % CAM.names.length); msg('CÁMARA: ' + CAM.names[CAM.mode], 1.2); }
function updateCamera(dt) {
  const portrait = camera.aspect < 1, far = portrait ? 1.4 : 1;
  const fov = portrait ? 72 : 58; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const rp = tmp.a.set(R.x, R.state === 'air' ? R.y : riderRoot.position.y, R.z), D = WIND.D;
  CAM.h += angDiff(CAM.h, R.h) * clamp(dt * 2.4, 0, 1);
  const Hc = tmp.b.set(Math.cos(CAM.h), 0, Math.sin(CAM.h)), want = tmp.c, look = tmp.n;
  if (!GAME.running) {   // menú: vuelta lenta alrededor del rider
    const a = GAME.t * 0.06 + 2.2;
    want.set(rp.x + Math.cos(a) * 15, rp.y + 4.5, rp.z + Math.sin(a) * 15); look.copy(rp).add(V3(0, portrait ? -1.2 : 2.5, 0));
    if (GAME.mode === 'kite') look.lerp(KITE.pos, 0.18);
    camera.position.copy(want); camera.lookAt(look); CAM.off = null; return;
  }
  const m = CAM.mode;
  // VIENTO: con el viento a la espalda, como se ve el kite desde la playa: la cometa delante y el rider cruzando a izquierda o derecha
  if (m === 0) { want.copy(rp).addScaledVector(D, -16 * far).addScaledVector(Hc, 1).add(V3(0, 5.5 * far, 0)); look.copy(rp).addScaledVector(D, 10).add(V3(0, portrait ? 3.5 : 2.2, 0)); }
  else if (m === 1) { want.copy(rp).addScaledVector(Hc, -12 * far).addScaledVector(D, -2.5).add(V3(0, 2.8 * far, 0)); look.copy(rp).addScaledVector(Hc, 8).addScaledVector(D, 3).add(V3(0, 3.2, 0)); }
  else if (m === 2) { want.copy(rp).addScaledVector(Hc, -4.2 * far).addScaledVector(D, -0.8).add(V3(0, 1.9, 0)); look.copy(rp).addScaledVector(Hc, 5).add(V3(0, 1.3, 0)); }
  else if (m === 3) { want.copy(rp).addScaledVector(Hc, -32).add(V3(0, 26, 0)); look.copy(rp).addScaledVector(Hc, 10); }
  else {
    if (GAME.mode === 'kite') { want.copy(KITE.pos).lerp(rp, 0.12).y += 1.5; look.copy(rp).add(V3(0, 0.8, 0)); }
    else { want.copy(rp).addScaledVector(Hc, 4).addScaledVector(D, 3).add(V3(0, 6, 0)); look.copy(rp).add(V3(0, 1, 0)); }
  }
  if (GAME.mode === 'kite' && m < 3) look.lerp(KITE.pos, m === 0 ? 0.12 : m === 1 ? 0.3 : 0.22);   // que se vea también la cometa
  const k = clamp(dt * (m === 2 ? 7 : 4), 0, 1);
  CAM.off = (CAM.off || want.clone().sub(rp)).lerp(want.sub(rp), k);
  CAM.lookOff = (CAM.lookOff || look.clone().sub(rp)).lerp(look.sub(rp), clamp(dt * 6, 0, 1));
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
function showPanel(id) { for (const p of ['pMain', 'pControls', 'pGear']) $(p).hidden = p !== id; }
// material: diseñador del ala (como el de las caras del wake), con una vista de cada diseño
for (const [id, d] of Object.entries(WING_DESIGNS)) {
  const b = document.createElement('button'); b.className = 'opt card' + (id === WING.design ? ' sel' : ''); b.dataset.w = id;
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 150; cv.className = 'wingPrev';
  const tx = document.createElement('canvas'); tx.width = 512; tx.height = 256; drawWing(tx.getContext('2d'), 512, 256, d);
  const c = cv.getContext('2d'), L = 10, Rr = 310, top = 10, bot = 140;
  c.beginPath(); c.moveTo(L, 70); c.quadraticCurveTo(160, -40, Rr, 70); c.lineTo(Rr, 92); c.lineTo(160, bot); c.lineTo(L, 92); c.closePath();
  c.save(); c.clip(); c.drawImage(tx, L, top, Rr - L, bot - top); c.restore();
  c.lineWidth = 7; c.strokeStyle = '#' + d.le.toString(16).padStart(6, '0'); c.beginPath(); c.moveTo(L, 70); c.quadraticCurveTo(160, -40, Rr, 70); c.stroke();
  c.strokeStyle = '#' + d.mid.toString(16).padStart(6, '0'); c.beginPath(); c.moveTo(140, 16); c.lineTo(180, 16); c.stroke();
  b.appendChild(cv); b.insertAdjacentHTML('beforeend', `<b>${d.name}</b><em>${d.sub}</em>`); $('wings').appendChild(b);
  b.onclick = () => { WING.setDesign(id); document.querySelectorAll('#wings .opt').forEach(x => x.classList.toggle('sel', x === b)); gearSum(); };
}
// las tablas: una tarjeta por diseño con su color
function setBoard(kind, id) {
  if (kind === 'k') { GEAR.kb = id; boardGroup.remove(kiteBoard); kiteBoard = makeKiteBoard(id); boardGroup.add(kiteBoard); }
  else { GEAR.fb = id; boardGroup.remove(wingBoard); wingBoard = makeFoilBoard(1.4, 0.6, 0.1, id); boardGroup.add(wingBoard); }
  kiteBoard.visible = GAME.mode === 'kite'; wingBoard.visible = GAME.mode === 'wing';
  try { localStorage.setItem('kite-gear', JSON.stringify(GEAR)); } catch (e) {}
  document.querySelectorAll('#kboards .opt').forEach(x => x.classList.toggle('sel', x.dataset.b === GEAR.kb));
  document.querySelectorAll('#fboards .opt').forEach(x => x.classList.toggle('sel', x.dataset.b === GEAR.fb));
  gearSum();
}
for (const [box, kind, list] of [['kboards', 'k', KITE_BOARDS], ['fboards', 'f', FOIL_BOARDS]]) {
  for (const [id, d] of Object.entries(list)) {
    const b = document.createElement('button'); b.className = 'opt' + (id === (kind === 'k' ? GEAR.kb : GEAR.fb) ? ' sel' : ''); b.dataset.b = id;
    b.innerHTML = `<i class="sw" style="background:${d.sw}"></i><b>${d.name}</b><em>${d.sub}</em>`;
    b.onclick = () => setBoard(kind, id); $(box).appendChild(b);
  }
}
// en el menú principal: con quién y con qué material sales
function gearSum() {
  if (!$('gearWho')) return;
  $('gearAv').style.backgroundImage = `url(avatar-${RIDER_NAME}.jpg)`;
  $('gearWho').textContent = RIDER_NAME === 'david' ? 'David' : 'JuanP';
  $('gearSub').textContent = GAME.mode === 'kite' ? 'Tabla ' + KITE_BOARDS[GEAR.kb].name.toLowerCase() + ' · cometa Tatanka'
    : 'Foil ' + FOIL_BOARDS[GEAR.fb].name.toLowerCase() + ' · ala ' + WING_DESIGNS[WING.design].name.toLowerCase();
}
$('toGear').onclick = () => showPanel('pGear'); $('gearOk').onclick = () => showPanel('pMain');
$('toControls').onclick = () => showPanel('pControls'); $('controlsOk').onclick = () => showPanel('pMain');
$('camBtn').onclick = () => setCam((CAM.mode + 1) % CAM.names.length);
function togglePause() { if (!GAME.running) return; GAME.paused = !GAME.paused; msg(GAME.paused ? 'PAUSA' : ''); sfxUpdate(); }
$('bPause').onclick = togglePause; $('bCam').onclick = nextCam;
// mar adentro: te lleva al punto del mapa más lejos de la costa, navegando al través
function toOpenSea() {
  if (!GAME.running) return;
  const phi = Math.atan2(WIND.F.z, WIND.F.x);
  R.x = 400; R.z = -2350; R.y = 0; R.vy = 0; R.air = null; R.state = 'ride'; R.v = 6; R.charge = 0; R.gybe = 0; R.foil = 0; R.foilOn = false;
  R.h = phi + R.s * 100 * DEG; R.yr = 0; R.turn = 0; trick.rotation.set(0, 0, 0);
  trail.pts.length = 0; CAM.off = CAM.lookOff = null; CAM.h = R.h; snapKite(); KITE.prev = null;
  say('MAR ADENTRO<small>a 2,4 km de la playa</small>', 'info', 1.8);
}
$('bSea').onclick = toOpenSea;
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

// ---- los riders: JuanP y David (se elige en el menú, como las caras del wake)
function setRider(n) {
  RIDER_NAME = n; try { localStorage.setItem('kite-rider', n); } catch (e) {}
  document.querySelectorAll('#riders .opt').forEach(b => b.classList.toggle('sel', b.dataset.r === n));
  const h = RIDERS[n]; if (!h) return;
  if (HUMAN && HUMAN !== h) body.remove(HUMAN.root);
  HUMAN = h; body.add(h.root);
  $('modeLbl').textContent = MODES[GAME.mode].name + ' · ' + n.toUpperCase();
  gearSum();
}
document.querySelectorAll('#riders .opt').forEach(b => b.onclick = () => setRider(b.dataset.r));
setRider(RIDER_NAME);
async function loadModels() {
  const [gj, gd] = await Promise.all([loadGLB('juanp.glb?v=1', 3.2e6), loadGLB('david.glb?v=1', 3.5e6)]);
  const hj = gj && setupHuman(gj), hd = gd && setupHuman(gd);
  if (hj) RIDERS.juanp = hj; if (hd) RIDERS.david = hd;
  if (!RIDERS[RIDER_NAME]) RIDER_NAME = hj ? 'juanp' : 'david';
  setRider(RIDER_NAME);
  $('loadLine').textContent = hj && hd ? '✅ JuanP y David listos' : hj || hd ? '⚠️ Solo ha cargado ' + (hj ? 'JuanP' : 'David') : '⚠️ No se han podido cargar los riders: recarga la página';
}

// =====================================================================================
//  ONLINE: una sala para todos los que navegan (mundo libre). Cada uno manda su posición, su postura,
//  su cometa o su ala; los demás se ven con su personaje, su material y su nombre encima.
//  (Firebase: el mismo proyecto que los otros juegos, con su propia sala «kite-wing-tatanka»)
// =====================================================================================
const FIREBASE_CONFIG = { apiKey: 'AIzaSyBYEgJnEQxYbgT97giPRuTaRNd5d9vF8tg', authDomain: 'surf-sagunto.firebaseapp.com', databaseURL: 'https://surf-sagunto-default-rtdb.europe-west1.firebasedatabase.app', projectId: 'surf-sagunto', storageBucket: 'surf-sagunto.firebasestorage.app', messagingSenderId: '669179228796', appId: '1:669179228796:web:1e39377632d94fa1c50ff9' };
const NET = { db: null, me: null, id: 'k' + Math.random().toString(36).slice(2, 10), peers: {}, connected: false, sendT: 0 };
try { $('nick').value = localStorage.getItem('kite-nick') || ''; } catch (e) {}
$('nick').addEventListener('change', () => { try { localStorage.setItem('kite-nick', $('nick').value.trim()); } catch (e) {} });
const myName = () => ($('nick').value.trim() || (RIDER_NAME === 'david' ? 'David' : 'JuanP')).slice(0, 16);
function loadScript(src) { return new Promise((res, rej) => { const e = document.createElement('script'); e.src = src; e.onload = res; e.onerror = rej; document.head.appendChild(e); }); }
(async function netStart() {
  const mp = $('mpMenu');
  try {
    if (!window.firebase) { await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js'); await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js'); }
    firebase.initializeApp(FIREBASE_CONFIG); NET.db = firebase.database();
    NET.base = NET.db.ref('salas/kite-wing-tatanka'); NET.me = NET.base.child('players/' + NET.id);
    NET.db.ref('.info/connected').on('value', v => { NET.connected = !!v.val(); if (NET.connected) { NET.me.onDisconnect().remove(); NET.sendT = 0; } netMenu(); });
    const pl = NET.base.child('players');
    pl.on('child_added', v => peerData(v.key, v.val())); pl.on('child_changed', v => peerData(v.key, v.val())); pl.on('child_removed', v => peerGone(v.key));
    addEventListener('pagehide', () => { try { NET.me.remove(); } catch (e) {} });
    mp.textContent = '🌊 Conectando a la sala…';
  } catch (e) { mp.textContent = '🌊 Sin conexión: navegas solo'; }
})();
function peerData(id, v) {
  if (id === NET.id || !v || !v.st) return;
  const P = NET.peers[id] || (NET.peers[id] = { id, vis: null, first: true, pos: V3(), q: new T.Quaternion(), k: V3(), kq: new T.Quaternion(), wl: V3(), wq: new T.Quaternion() });
  P.st = v.st; P.ch = v.ch; P.seen = performance.now();
  netMenu();
}
function peerGone(id) { const P = NET.peers[id]; if (!P) return; dropPeerVis(P); delete NET.peers[id]; netMenu(); }
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function netMenu() {
  const ps = Object.values(NET.peers).filter(P => P.st);
  const names = ps.map(P => esc(P.st.n || 'Rider') + (P.st.p ? '' : ' (en el menú)'));
  if (NET.connected) $('mpMenu').innerHTML = ps.length ? `🌊 Sala online · ${ps.length + 1} conectados: tú, ${names.join(', ')}` : '🌊 Sala online · de momento solo tú: pasa el enlace a tus amigos y entrad a la vez';
  let box = $('mpList');
  if (!box) { box = document.createElement('div'); box.id = 'mpList'; box.style.cssText = 'position:absolute;right:max(14px,env(safe-area-inset-right));top:168px;text-align:right;font:700 12px/1.45 system-ui,sans-serif;letter-spacing:.04em;text-shadow:0 1px 4px rgba(0,0,0,.7);pointer-events:none'; $('hud').appendChild(box); }
  box.innerHTML = ps.filter(P => P.st.p).map(P => `${esc(P.st.n || 'Rider')} · ${(P.st.sc || 0).toLocaleString('es-ES')}`).join('<br>');
}
const nt = { p: V3(), q: new T.Quaternion() };
function netSend(dt) {
  if (!NET.connected || !NET.me) return;
  NET.sendT -= dt; if (NET.sendT > 0) return; NET.sendT = 0.12;
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  inner.getWorldPosition(nt.p); inner.getWorldQuaternion(nt.q);
  const st = {
    n: myName(), m: GAME.mode, kb: GEAR.kb, fb: GEAR.fb, w: WING.design, p: GAME.running ? 1 : 0, sc: R.score,
    x: r2(nt.p.x), y: r2(nt.p.y), z: r2(nt.p.z), q: [r3(nt.q.x), r3(nt.q.y), r3(nt.q.z), r3(nt.q.w)],
    yw: r2(R.yaw), pw: r2(R.power), v: r2(R.v), c: r2(R.charge), s: R.state === 'air' ? 1 : R.state === 'fallen' ? 2 : 0,
  };
  if (GAME.mode === 'kite') { const k = KITE.pos, q = KITE.g.quaternion; st.k = [r2(k.x), r2(k.y), r2(k.z)]; st.kq = [r3(q.x), r3(q.y), r3(q.z), r3(q.w)]; }
  else { const p = WING.g.position, q = WING.g.quaternion; st.wl = [r3(p.x), r3(p.y), r3(p.z)]; st.wq = [r3(q.x), r3(q.y), r3(q.z), r3(q.w)]; }
  NET.me.set({ ch: RIDER_NAME, st }).catch(() => {});
}
function makeLabel(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.font = '700 34px system-ui, sans-serif'; x.textAlign = 'center'; x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.6)'; x.strokeText(text, 128, 44); x.fillStyle = '#fff'; x.fillText(text, 128, 44);
  const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false, transparent: true })); sp.scale.set(2.4, 0.6, 1); sp.renderOrder = 5; return sp;
}
// el ala de otro jugador, con su diseño (la tela, el borde de ataque y el centro)
function makeWingFor(id) {
  const d = WING_DESIGNS[id] || WING_DESIGNS.roja, g = WING.g.clone(true), src = WING.g.children;
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512; drawWing(cv.getContext('2d'), 1024, 512, d);
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
  const cm = src[0].material.clone(); cm.map = tex;
  const le = src[1].material.clone(); le.color.setHex(d.le); const mid = src[2].material.clone(); mid.color.setHex(d.mid);
  g.traverse(o => { if (!o.isMesh) return; if (o.material === src[0].material) o.material = cm; else if (o.material === src[1].material) o.material = le; else if (o.material === src[2].material) o.material = mid; });
  g.visible = true; return g;
}
function buildPeer(P) {
  const st = P.st, src = RIDERS[P.ch] || RIDERS.juanp || RIDERS.david; if (!src) return null;
  const h = setupHuman({ scene: T.SkeletonUtils.clone(src.sc) }); if (!h) return null;
  const inn = new T.Group(), bodyG = new T.Group(); inn.add(bodyG); bodyG.add(h.root); scene.add(inn);
  const board = st.m === 'kite' ? makeKiteBoard(st.kb) : makeFoilBoard(1.4, 0.6, 0.1, st.fb); board.visible = true; inn.add(board);
  let kite = null, lines = null, wing = null;
  if (st.m === 'kite') {
    kite = KITE.g.clone(true); kite.visible = true; scene.add(kite);
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.BufferAttribute(new Float32Array(8 * 3), 3));
    lines = new T.LineSegments(lg, new T.LineBasicMaterial({ color: 0xe9e9e2, transparent: true, opacity: 0.85 })); lines.frustumCulled = false; scene.add(lines);
  } else { wing = makeWingFor(st.w); bodyG.add(wing); }
  const label = makeLabel(st.n || 'Rider'); scene.add(label);
  return { inn, bodyG, h, kite, lines, wing, label, key: [P.ch, st.m, st.kb, st.fb, st.w, st.n].join('|') };
}
function dropPeerVis(P) { const V = P.vis; if (!V) return; scene.remove(V.inn, V.label); if (V.kite) scene.remove(V.kite, V.lines); P.vis = null; }
// la postura de otro jugador: la misma que la nuestra, calculada con sus datos (y dejando la nuestra como estaba)
function posePeer(V, st, t) {
  const sv = { yaw: R.yaw, power: R.power, v: R.v, charge: R.charge, state: R.state, air: R.air }, sm = GAME.mode;
  const wp = WING.g.position.clone(), wq = WING.g.quaternion.clone(), hz = WING.handles.map(o => o.position.z);
  R.yaw = st.yw; R.power = st.pw; R.v = st.v; R.charge = st.c; R.state = ['ride', 'air', 'fallen'][st.s] || 'ride'; R.air = st.s === 1 ? { grab: 0 } : null; GAME.mode = st.m;
  try { computePose(t); poseHuman(V.h, J); }
  finally { Object.assign(R, sv); GAME.mode = sm; WING.g.position.copy(wp); WING.g.quaternion.copy(wq); WING.handles.forEach((o, i) => o.position.z = hz[i]); }
}
const pt2 = { a: V3(), b: V3(), c: V3() };
function updatePeers(dt, t) {
  for (const id in NET.peers) {
    const P = NET.peers[id], st = P.st;
    if (!st || !st.p || performance.now() - P.seen > 6000) { dropPeerVis(P); continue; }
    const key = [P.ch, st.m, st.kb, st.fb, st.w, st.n].join('|');
    if (P.vis && P.vis.key !== key) dropPeerVis(P);
    if (!P.vis) { P.vis = buildPeer(P); P.first = true; if (!P.vis) continue; }
    const V = P.vis, k = P.first ? 1 : clamp(dt * 8, 0, 1);
    P.pos.lerp(pt2.a.set(st.x, st.y, st.z), k); P.q.slerp(new T.Quaternion(...st.q).normalize(), k);
    if (P.pos.distanceTo(pt2.a) > 30) P.pos.copy(pt2.a);   // se ha ido lejos (mar adentro): sin arrastrarlo
    V.inn.position.copy(P.pos); V.inn.quaternion.copy(P.q); V.bodyG.rotation.y = st.yw;
    V.inn.updateMatrixWorld(true);
    posePeer(V, st, t);
    if (V.wing && st.wl) { P.wl.lerp(pt2.b.fromArray(st.wl), k); P.wq.slerp(new T.Quaternion(...st.wq).normalize(), k); V.wing.position.copy(P.wl); V.wing.quaternion.copy(P.wq); }
    if (V.kite && st.k) {
      P.k.lerp(pt2.b.fromArray(st.k), k); P.kq.slerp(new T.Quaternion(...st.kq).normalize(), k);
      if (P.k.distanceTo(pt2.b) > 40) P.k.copy(pt2.b);
      V.kite.position.copy(P.k); V.kite.quaternion.copy(P.kq); V.kite.updateMatrixWorld(true);
      const hand = pt2.c; if (V.h.knuckL) { V.h.knuckL.getWorldPosition(hand); hand.add(V.h.knuckR.getWorldPosition(pt2.b)).multiplyScalar(0.5); } else hand.copy(P.pos).y += 1.2;
      const arr = V.lines.geometry.attributes.position; let i = 0;
      for (const a of ['fl', 'fr', 'bl', 'br']) { arr.setXYZ(i++, hand.x, hand.y, hand.z); const e = V.kite.localToWorld(pt2.b.copy(KITE.at[a])); arr.setXYZ(i++, e.x, e.y, e.z); }
      arr.needsUpdate = true;
    }
    V.label.position.set(P.pos.x, P.pos.y + 2.6, P.pos.z);
  }
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
    netSend(dt); updatePeers(dt, t);
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
