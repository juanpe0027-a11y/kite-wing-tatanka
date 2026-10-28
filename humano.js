'use strict';
// =====================================================================================
//  PIEZAS COPIADAS DEL JUEGO DEL WAKE: la tabla de wake, las salpicaduras, la estela de espuma de la tabla
//  y el montaje del personaje (esqueleto de MakeHuman) con su postura por articulaciones
// =====================================================================================
const BOARD_LEN = 1.41, BOARD_W = 0.43;
// estado del rider: lo rellena juego.js (la estela de la tabla lo lee)
const RIDER = { pos: V3(), vel: V3(), edge: 0, state: 'ride' };
function makeBoardMesh(style) {
  const g = new T.Group();
  // contorno: rectángulo con puntas redondeadas
  const sh = new T.Shape(), L = BOARD_LEN / 2, Wd = BOARD_W / 2, r = 0.17;
  sh.moveTo(-L + r, -Wd); sh.lineTo(L - r, -Wd); sh.quadraticCurveTo(L, -Wd, L, -Wd + r); sh.lineTo(L, Wd - r); sh.quadraticCurveTo(L, Wd, L - r, Wd);
  sh.lineTo(-L + r, Wd); sh.quadraticCurveTo(-L, Wd, -L, Wd - r); sh.lineTo(-L, -Wd + r); sh.quadraticCurveTo(-L, -Wd, -L + r, -Wd);
  const geo = new T.ExtrudeGeometry(sh, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2);   // queda tumbada: x a lo largo, z a lo ancho, y espesor
  { // rocker: puntas levantadas
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) + 0.075 * Math.pow(Math.abs(x) / L, 2.2)); }
    geo.computeVertexNormals();
  }
  // UV de arriba: x,z → textura
  { const p = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / BOARD_LEN + 0.5, p.getZ(i) / BOARD_W + 0.5); }
  const top = canvasTex(1024, 320, (c, w, h) => {
    if (style === 0) {          // negra con la línea verde lima
      c.fillStyle = '#121314'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#c3f53a'; c.fillRect(0, h * 0.62, w, h * 0.06);
      c.fillStyle = '#1e2022'; for (let k = 0; k < 40; k++) c.fillRect(k * 26, 0, 2, h);
      c.fillStyle = '#c3f53a'; c.font = 'italic 900 46px Segoe UI, sans-serif'; c.fillText('TATANKA', w * 0.08, h * 0.38);
    } else if (style === 2) {   // la de Rupert: puntas rojas y el centro turquesa
      c.fillStyle = '#21b7c9'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8343f'; c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.24, 0); c.quadraticCurveTo(w * 0.3, h * 0.5, w * 0.2, h); c.lineTo(0, h); c.fill();
      c.beginPath(); c.moveTo(w, 0); c.lineTo(w * 0.8, 0); c.quadraticCurveTo(w * 0.72, h * 0.5, w * 0.82, h); c.lineTo(w, h); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 4; c.beginPath(); c.arc(w * 0.12, h * 0.5, 34, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.9)'; c.font = '800 30px Segoe UI, sans-serif'; c.fillText('LIQUID', w * 0.42, h * 0.56);
    } else if (style === 3) {   // la de Omar: blanca con manchas grises de camuflaje gastado
      c.fillStyle = '#eceae6'; c.fillRect(0, 0, w, h);
      let sd = 7; const rr = () => (sd = (sd * 9301 + 49297) % 233280) / 233280;
      for (let k = 0; k < 70; k++) {
        const bx = rr() * w, by = rr() * h, br = 10 + rr() * 34;
        c.fillStyle = `rgba(${90 + rr() * 50 | 0},${92 + rr() * 50 | 0},${96 + rr() * 50 | 0},${0.25 + rr() * 0.35})`;
        c.beginPath(); for (let a = 0; a < 7; a++) { const an = a / 7 * TAU, rd = br * (0.6 + rr() * 0.6); c.lineTo(bx + Math.cos(an) * rd * 1.4, by + Math.sin(an) * rd); } c.fill();
      }
      c.fillStyle = 'rgba(40,40,44,.8)'; c.font = 'italic 800 26px Segoe UI, sans-serif'; c.fillText('HYPERLITE', w * 0.72, h * 0.9);
    } else {                    // Jobe Vanity: azul marino con un gran bloque azul eléctrico
      c.fillStyle = '#141b2e'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(80,110,190,.35)'; c.lineWidth = 2; for (let k = -10; k < 50; k++) { c.beginPath(); c.moveTo(k * 26, 0); c.lineTo(k * 26 + 160, h); c.stroke(); }
      c.fillStyle = '#1f4fd8'; c.beginPath(); c.moveTo(w * 0.48, 0); c.lineTo(w, 0); c.lineTo(w, h); c.lineTo(w * 0.3, h); c.closePath(); c.fill();
      c.fillStyle = '#ffffff'; c.font = '900 96px Arial Black, Segoe UI, sans-serif'; c.save(); c.translate(w * 0.42, h * 0.5); c.rotate(-0.08); c.fillText('JOBE', -120, 34); c.restore();
      c.font = '700 26px Segoe UI, sans-serif'; c.fillText('VANITY', w * 0.08, h * 0.86);
    }
  });
  const mTop = MAT(0xffffff, 0.35, 0.05, { map: top }), mBottom = MAT(0x101112, 0.4);
  const mesh = new T.Mesh(geo, [mTop, mBottom]); mesh.castShadow = true; g.add(mesh);
  // fijaciones (botas)
  const bootM = MAT(style === 2 ? 0x7fd83a : 0x18191b, 0.6), accent = MAT(style === 0 ? 0xc3f53a : style === 2 || style === 3 ? 0x18191b : 0x2a63ff, 0.5);
  for (const sx of [-1, 1]) {
    const b = new T.Group(); b.position.set(sx * 0.27, 0.06, 0); b.rotation.y = sx * -0.2; g.add(b);
    box(0.13, 0.05, 0.3, bootM, 0, 0, 0, b);
    const shell = new T.Mesh(new T.CylinderGeometry(0.065, 0.075, 0.2, 14, 1, true, 0, Math.PI * 1.6), bootM); shell.position.set(0, 0.11, -0.05); shell.rotation.y = Math.PI * 0.7; shell.material.side = T.DoubleSide; b.add(shell);
    box(0.135, 0.04, 0.12, accent, 0, 0.06, 0.09, b);
  }
  return g;
}
function setRod(m, r, a, b) { const d = V3().subVectors(b, a), L = d.length(); m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(r, Math.max(L, 1e-3), r); if (L > 1e-6) m.quaternion.setFromUnitVectors(UP, d.normalize()); }
// =====================================================================================
//  SALPICADURAS
// =====================================================================================
const SPRAY_N = 900;
const sprayGeo = new T.BufferGeometry();
const spPos = new Float32Array(SPRAY_N * 3), spVel = new Float32Array(SPRAY_N * 3), spLife = new Float32Array(SPRAY_N), spSize = new Float32Array(SPRAY_N), spMax = new Float32Array(SPRAY_N);
sprayGeo.setAttribute('position', new T.BufferAttribute(spPos, 3));
sprayGeo.setAttribute('aLife', new T.BufferAttribute(spLife, 1));
sprayGeo.setAttribute('aSize', new T.BufferAttribute(spSize, 1));
const sprayMat = new T.ShaderMaterial({
  uniforms: { uScale: { value: innerHeight * 0.5 } },
  vertexShader: `attribute float aLife; attribute float aSize; uniform float uScale; varying float vL;
    void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = aLife > 0.0 ? aSize * uScale / -mv.z * (1.4 - aLife * 0.4) : 0.0; }`,
  fragmentShader: `varying float vL; void main(){ vec2 p = gl_PointCoord - 0.5; float r = length(p); if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.1, r) * clamp(vL, 0.0, 1.0) * 0.85; gl_FragColor = vec4(vec3(0.95,0.97,1.0), a); }`,
  transparent: true, depthWrite: false
});
const spray = new T.Points(sprayGeo, sprayMat); spray.frustumCulled = false; scene.add(spray);
let spHead = 0;
function emit(x, y, z, vx, vy, vz, size = 0.25, life = 1) {
  const i = spHead; spHead = (spHead + 1) % SPRAY_N;
  spPos[i * 3] = x; spPos[i * 3 + 1] = y; spPos[i * 3 + 2] = z; spVel[i * 3] = vx; spVel[i * 3 + 1] = vy; spVel[i * 3 + 2] = vz;
  spLife[i] = 1; spMax[i] = life; spSize[i] = size;
}
function updateSpray(dt) {
  for (let i = 0; i < SPRAY_N; i++) {
    if (spLife[i] <= 0) continue;
    spLife[i] -= dt / spMax[i];
    spVel[i * 3 + 1] -= 9.8 * dt;
    spVel[i * 3] *= 1 - 1.2 * dt; spVel[i * 3 + 2] *= 1 - 1.2 * dt;
    spPos[i * 3] += spVel[i * 3] * dt; spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt; spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
    if (spPos[i * 3 + 1] < -0.1) spLife[i] = 0;
  }
  sprayGeo.attributes.position.needsUpdate = true; sprayGeo.attributes.aLife.needsUpdate = true; sprayGeo.attributes.aSize.needsUpdate = true;
}

// =====================================================================================
//  ESTELA DE LA TABLA: franja de espuma que deja el canto al cortar el agua
// =====================================================================================
const TRAIL_N = 110, TRAIL_LIFE = 3.0;
const trail = { pts: [], acc: 0 };
const trailGeo = new T.BufferGeometry();
const trPos = new Float32Array(TRAIL_N * 2 * 3), trA = new Float32Array(TRAIL_N * 2), trU = new Float32Array(TRAIL_N * 2);
trailGeo.setAttribute('position', new T.BufferAttribute(trPos, 3));
trailGeo.setAttribute('aA', new T.BufferAttribute(trA, 1));
trailGeo.setAttribute('aU', new T.BufferAttribute(trU, 1));
{ const idx = []; for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } trailGeo.setIndex(idx); }
const trailMat = new T.ShaderMaterial({
  uniforms: { tNoise: U.tNoise, uTime: U.uTime },
  vertexShader: `attribute float aA; attribute float aU; varying float vA; varying float vU; varying vec2 vW;
    void main(){ vA = aA; vU = aU; vW = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tNoise; uniform float uTime; varying float vA; varying float vU; varying vec2 vW;
    void main(){ float edge = 1.0 - abs(vU * 2.0 - 1.0); float n = texture2D(tNoise, vW * 0.35 + uTime * 0.02).r;
      float a = vA * smoothstep(0.0, 0.6, edge) * (0.55 + 0.7 * n); if (a < 0.02) discard;
      gl_FragColor = vec4(vec3(0.94, 0.97, 0.98), clamp(a, 0.0, 0.9)); }`,
  transparent: true, depthWrite: false, side: T.DoubleSide,
});
const trailMesh = new T.Mesh(trailGeo, trailMat); trailMesh.frustumCulled = false; trailMesh.renderOrder = 2; scene.add(trailMesh);
function updateTrail(dt, t) {
  const R = RIDER, riding = R.state === 'ride' || R.state === 'start';
  for (const q of trail.pts) q.age += dt;
  trail.acc += dt;
  if (trail.acc > 0.03) {
    trail.acc = 0;
    // el punto sale de la cola de la tabla (lo que va detrás según hacia dónde se mueve)
    const v = R.vel, sp = Math.hypot(v.x, v.z) || 1;
    trail.pts.unshift({ x: R.pos.x - v.x / sp * 0.55, z: R.pos.z - v.z / sp * 0.55, age: 0, on: riding, k: clamp(Math.abs(R.edge) * 2.2 + 0.35, 0.35, 1) });
    if (trail.pts.length > TRAIL_N) trail.pts.length = TRAIL_N;
  }
  const P = trail.pts;
  for (let i = 0; i < TRAIL_N; i++) {
    const q = P[Math.min(i, P.length - 1)];
    if (!q) continue;
    const q2 = P[Math.min(i + 1, P.length - 1)], q0 = P[Math.min(Math.max(i - 1, 0), P.length - 1)];
    let dx = q0.x - q2.x, dz = q0.z - q2.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const life = clamp(1 - q.age / TRAIL_LIFE, 0, 1), w = (0.16 + 0.75 * (1 - life)) * q.k;
    const y = surfaceH(q.x, q.z, t) + 0.04;
    trPos.set([q.x - dz * w, y, q.z + dx * w, q.x + dz * w, y, q.z - dx * w], i * 6);
    const a = i < P.length && q.on ? life * life * 0.85 * q.k : 0;
    trA[i * 2] = trA[i * 2 + 1] = a; trU[i * 2] = 0; trU[i * 2 + 1] = 1;
  }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.aA.needsUpdate = true; trailGeo.attributes.aU.needsUpdate = true;
}
// =====================================================================================
//  CARGA DE MODELOS (Senén y la Tatanka exportados desde Blender)
// =====================================================================================
const loader = new T.GLTFLoader();
const LOADP = {};
function loadProgress() {
  let a = 0, b = 0; for (const k in LOADP) { a += LOADP[k][0]; b += LOADP[k][1]; }
  const pct = b ? Math.round(a / b * 100) : 0;
  $('loadBar').style.width = pct + '%'; $('loadPct').textContent = pct + ' %';
}
function loadGLB(url, size) {
  LOADP[url] = [0, size];
  return new Promise(res => loader.load(url, g => { LOADP[url][0] = LOADP[url][1]; loadProgress(); res(g); },
    e => { if (e.total) LOADP[url][1] = e.total; LOADP[url][0] = e.loaded; loadProgress(); }, () => res(null)));
}
const H_ALIAS = {   // nombres de huesos: esqueleto «game engine» de MakeHuman y Mixamo
  Hips: ['pelvis', 'mixamorigHips', 'Hips'], Spine: ['spine_01', 'mixamorigSpine'], Spine1: ['spine_02', 'mixamorigSpine1'], Spine2: ['spine_03', 'mixamorigSpine2'],
  Neck: ['neck_01', 'mixamorigNeck'], Head: ['head', 'mixamorigHead'],
  LeftArm: ['upperarm_l', 'mixamorigLeftArm'], LeftForeArm: ['lowerarm_l', 'mixamorigLeftForeArm'], LeftHand: ['hand_l', 'mixamorigLeftHand'],
  RightArm: ['upperarm_r', 'mixamorigRightArm'], RightForeArm: ['lowerarm_r', 'mixamorigRightForeArm'], RightHand: ['hand_r', 'mixamorigRightHand'],
  LeftUpLeg: ['thigh_l', 'mixamorigLeftUpLeg'], LeftLeg: ['calf_l', 'mixamorigLeftLeg'], LeftFoot: ['foot_l', 'mixamorigLeftFoot'], LeftToeBase: ['ball_l', 'mixamorigLeftToeBase'],
  RightUpLeg: ['thigh_r', 'mixamorigRightUpLeg'], RightLeg: ['calf_r', 'mixamorigRightLeg'], RightFoot: ['foot_r', 'mixamorigRightFoot'], RightToeBase: ['ball_r', 'mixamorigRightToeBase'],
};
function setupHuman(gltf) {
  const sc = gltf.scene; const root = new T.Group(); root.add(sc);
  const b = {};
  for (const k in H_ALIAS) { for (const n of H_ALIAS[k]) { const o = sc.getObjectByName(n); if (o) { b[k] = o; break; } } }
  const missing = Object.keys(H_ALIAS).filter(k => !b[k]);
  if (missing.length) { console.warn('faltan huesos', missing); return null; }
  sc.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  const h = { root, sc, b, rest: {}, fingers: [] };
  for (const k in b) h.rest[k] = b[k].quaternion.clone();
  // dedos (para cerrar la mano sobre la maneta)
  sc.traverse(o => { const m = o.isBone && /^(index|middle|ring|pinky|thumb)_0([123])_([lr])$/.exec(o.name); if (m) h.fingers.push({ bone: o, rest: o.quaternion.clone(), thumb: m[1] === 'thumb', k: +m[2] }); });
  h.knuckL = sc.getObjectByName('middle_01_l'); h.knuckR = sc.getObjectByName('middle_01_r');
  return h;
}
// orienta los huesos para que pasen por las articulaciones de la postura (todo en el espacio de root)
const hv = { a: V3(), b: V3(), c: V3(), d: V3(), t: V3(), X: V3(), Y: V3(), Z: V3(), m: new T.Matrix4() };
const hq = { a: new T.Quaternion(), b: new T.Quaternion(), c: new T.Quaternion(), r: new T.Quaternion() };
const hM = { inv: new T.Matrix4(), t: new T.Matrix4(), s: V3() };
function relPos(obj, out) { return out.setFromMatrixPosition(obj.matrixWorld).applyMatrix4(hM.inv); }
function relQuat(obj, out) { hM.t.multiplyMatrices(hM.inv, obj.matrixWorld); hM.t.decompose(hv.d, out, hM.s); return out; }
function setBoneRelQuat(bone, q) { relQuat(bone.parent, hq.c); bone.quaternion.copy(hq.c.invert()).multiply(q); bone.updateMatrixWorld(true); }
function aimBone(bone, child, Tg) {
  relPos(bone, hv.a); relPos(child, hv.b); hv.b.sub(hv.a); hv.t.copy(Tg).sub(hv.a);
  if (hv.b.lengthSq() < 1e-10 || hv.t.lengthSq() < 1e-10) return;
  hq.a.setFromUnitVectors(hv.b.normalize(), hv.t.normalize()); relQuat(bone, hq.b); setBoneRelQuat(bone, hq.a.multiply(hq.b));
}
function poseHuman(h, j) {
  const b = h.b;
  for (const k in b) b[k].quaternion.copy(h.rest[k]);
  h.root.updateMatrixWorld(true);
  hM.inv.copy(h.root.matrixWorld).invert();
  const hip = hv.c.addVectors(j.hB, j.hF).multiplyScalar(0.5).clone();
  const sh = V3().addVectors(j.sB, j.sF).multiplyScalar(0.5);
  hv.Y.subVectors(sh, hip).normalize();
  hv.Z.copy(j.fw).addScaledVector(hv.Y, -j.fw.dot(hv.Y)).normalize();
  hv.X.crossVectors(hv.Y, hv.Z).normalize();
  const fLeft = hv.a.subVectors(j.hF, j.hB).dot(hv.X) >= 0, L = fLeft ? 'F' : 'B', R = fLeft ? 'B' : 'F'; h.LF = fLeft;
  hM.t.multiplyMatrices(hM.inv, b.Hips.parent.matrixWorld).invert();
  b.Hips.position.copy(hip).applyMatrix4(hM.t); b.Hips.updateMatrixWorld(true);
  relQuat(b.Hips, hq.r); hv.m.makeBasis(hv.X, hv.Y, hv.Z); hq.a.setFromRotationMatrix(hv.m); setBoneRelQuat(b.Hips, hq.a.multiply(hq.r));
  aimBone(b.Spine, b.Neck, sh);
  aimBone(b.Neck, b.Head, j.hd);
  aimBone(b.LeftArm, b.LeftForeArm, j['e' + L]); aimBone(b.LeftForeArm, b.LeftHand, j['a' + L]);
  aimBone(b.RightArm, b.RightForeArm, j['e' + R]); aimBone(b.RightForeArm, b.RightHand, j['a' + R]);
  aimBone(b.LeftUpLeg, b.LeftLeg, j['k' + L]); aimBone(b.LeftLeg, b.LeftFoot, j['f' + L]);
  aimBone(b.RightUpLeg, b.RightLeg, j['k' + R]); aimBone(b.RightLeg, b.RightFoot, j['f' + R]);
  aimBone(b.LeftFoot, b.LeftToeBase, j['toe' + L]); aimBone(b.RightFoot, b.RightToeBase, j['toe' + R]);
  // puño cerrado: cada falange se dobla sobre su eje X local
  for (const f of h.fingers) { f.bone.quaternion.copy(f.rest).multiply(hq.a.setFromAxisAngle(FINGER_AXIS, (f.thumb ? 0.5 : [0, 1.25, 1.35, 0.9][f.k]) * FINGER_SIGN)); }
}
const FINGER_AXIS = V3(1, 0, 0); let FINGER_SIGN = 1;
