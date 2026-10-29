'use strict';
// =====================================================================================
//  ESCENARIO DEL PUERTO DE SAGUNTO (copiado del juego del wake, mismas posiciones)
//  Todo en metros. La orilla corre a lo largo de X (z = 80), el mar está en -Z, la tierra en +Z.
//  +X = sur (Pantalán en x = 900), -X = norte (Puerto Siles en x = -200, Canet).
// =====================================================================================
const T = THREE;
T.ColorManagement.enabled = true;   // vendor.js lo apaga para el juego de surf; aquí trabajamos en lineal

const $ = id => document.getElementById(id);
// versión: si el móvil tiene guardado un index.html viejo (de otra versión que juego.js), se recarga sin caché
// (como mucho dos veces seguidas, para no entrar en bucle si la web aún no se ha actualizado)
const KITE_VER = '22';
(() => {
  const m = document.querySelector('meta[name="kite-ver"]');
  try {
    if (m && m.content === KITE_VER) { sessionStorage.removeItem('kite-reload'); return; }
    const n = +(sessionStorage.getItem('kite-reload') || 0);
    if (n < 2) { sessionStorage.setItem('kite-reload', n + 1); location.replace(location.pathname + '?v=' + Date.now()); }
  } catch (e) {}
})();
const V3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const UP = V3(0, 1, 0);
let seed = 20261024;
const rnd = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * (seed - 1) / 2147483646; };
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);

// ---------------------------------------------------------------- render
const canvas = $('c');
const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_MOBILE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;

const scene = new T.Scene();
const camera = new T.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 9000);
camera.position.set(0, 4, 10);

const SUN_DIR = V3(0.42, 0.52, -0.74).normalize();   // sol de media mañana sobre el mar
const HORIZON = new T.Color(0xc9dbe6);
scene.fog = new T.Fog(HORIZON, 500, 7000);

// ---------------------------------------------------------------- cielo (con nubes) y entorno para reflejos
const SKY_GLSL = /* glsl */`
  uniform vec3 uSun; uniform float uTime;
  float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
  vec3 skyColor(vec3 d){
    float y = d.y;
    vec3 zen = vec3(0.045, 0.16, 0.42), hor = vec3(0.55, 0.68, 0.80);
    vec3 col = mix(hor, zen, pow(clamp(y,0.0,1.0), 0.42));
    if (y < 0.0) col = mix(hor, vec3(0.30,0.40,0.48), clamp(-y*3.0,0.0,1.0));
    float sd = max(dot(d, uSun), 0.0);
    col += vec3(1.0,0.80,0.55) * pow(sd, 6.0) * 0.28;
    col += vec3(1.0,0.92,0.75) * pow(sd, 90.0) * 0.6;
    col += vec3(1.0,0.97,0.9) * smoothstep(0.9993, 0.9997, sd) * 40.0;
    if (y > 0.0) {
      vec2 uv = d.xz / (y + 0.09) * 0.9 + vec2(uTime*0.003, 0.0);
      float c = fbm(uv*1.6) * 0.65 + fbm(uv*5.0) * 0.35;
      c = smoothstep(0.52, 0.82, c) * smoothstep(0.0, 0.18, y);
      vec3 cc = mix(vec3(0.82,0.86,0.9), vec3(1.0,0.98,0.95), clamp(sd*1.3,0.0,1.0));
      col = mix(col, cc * (0.75 + 0.35*fbm(uv*3.0)), c * 0.85);
    }
    return col;
  }`;
const skyMat = new T.ShaderMaterial({
  uniforms: { uSun: { value: SUN_DIR }, uTime: { value: 0 } },
  vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: SKY_GLSL + `varying vec3 vD; void main(){ gl_FragColor = vec4(skyColor(normalize(vD)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`,
  side: T.BackSide, depthWrite: false
});
const sky = new T.Mesh(new T.SphereGeometry(4000, 48, 24), skyMat);
sky.frustumCulled = false; sky.renderOrder = -1;
scene.add(sky);
{
  // entorno para los reflejos de metal, cristal y agua (sin tonemapping: valores lineales)
  const envMat = new T.ShaderMaterial({ uniforms: skyMat.uniforms, vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: SKY_GLSL + `varying vec3 vD; void main(){ gl_FragColor = vec4(skyColor(normalize(vD)), 1.0); }`, side: T.BackSide });
  const es = new T.Scene(); es.add(new T.Mesh(new T.SphereGeometry(100, 32, 16), envMat));
  const pm = new T.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(es, 0, 0.1, 500).texture;
}

const hemi = new T.HemisphereLight(0xcfe6ff, 0x5b5145, 0.35); scene.add(hemi);
const sun = new T.DirectionalLight(0xfff2de, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
const SC = sun.shadow.camera; SC.left = -22; SC.right = 22; SC.top = 22; SC.bottom = -22; SC.near = 1; SC.far = 160;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// ---------------------------------------------------------------- texturas procedurales
function canvasTex(w, h, draw, opt = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new T.CanvasTexture(cv);
  t.colorSpace = opt.data ? T.NoColorSpace : T.SRGBColorSpace;
  t.anisotropy = 8;
  if (opt.repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
  return t;
}
// ruido periódico (se repite sin costuras) para las ondas finas del agua
function makeNoiseTextures(N = 256) {
  const g = 32, grid = new Float32Array(g * g).map(() => rnd());
  const val = (x, y, f) => {
    const s = g / f; x *= s; y *= s;
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const P = (a, b) => grid[((b % g + g) % g) * g + ((a % g + g) % g)];
    return lerp(lerp(P(xi, yi), P(xi + 1, yi), u), lerp(P(xi, yi + 1), P(xi + 1, yi + 1), u), v);
  };
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0, a = 0.5, f = 4;
    for (let o = 0; o < 4; o++) { s += a * val(x / N * f, y / N * f, f); a *= 0.5; f *= 2; }
    H[y * N + x] = s;
  }
  const nrm = new Uint8Array(N * N * 4), noi = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = (i, j) => H[((j + N) % N) * N + ((i + N) % N)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * 6, dy = (h(x, y + 1) - h(x, y - 1)) * 6;
    const l = Math.hypot(dx, dy, 1), k = (y * N + x) * 4;
    nrm[k] = (-dx / l * 0.5 + 0.5) * 255; nrm[k + 1] = (-dy / l * 0.5 + 0.5) * 255; nrm[k + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[k + 3] = 255;
    const v = clamp(H[y * N + x] * 255, 0, 255); noi[k] = noi[k + 1] = noi[k + 2] = v; noi[k + 3] = 255;
  }
  const mk = d => { const t = new T.DataTexture(d, N, N, T.RGBAFormat); t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t; };
  return { normal: mk(nrm), noise: mk(noi) };
}
const NOISE = makeNoiseTextures();

// ---------------------------------------------------------------- agua: olas del viento (sin barca ni estela)
const U = { uTime: { value: 0 }, uChop: { value: 1 }, uCaps: { value: 0.2 }, tNrm: { value: NOISE.normal }, tNoise: { value: NOISE.noise },
  // la ola grande (mar de fondo, sin romper): dirección (x, z), posición de la cresta y altura · centro, ancho y largo de la cresta
  uSwA: { value: [0, 1, 2].map(() => new T.Vector4(0, 1, -9999, 0)) }, uSwB: { value: [0, 1, 2].map(() => new T.Vector4(0, 8, 90, 0)) } };   // hasta 3 olas a la vez
const WATER_GLSL = /* glsl */`
  uniform float uTime; uniform float uChop; uniform vec4 uSwA[3]; uniform vec4 uSwB[3];
  float swellH(vec2 p){
    float h = 0.0;
    for (int i = 0; i < 3; i++) {
      if (uSwA[i].w < 0.001) continue;
      float a = (dot(p, uSwA[i].xy) - uSwA[i].z) / uSwB[i].y, b = (dot(p, vec2(-uSwA[i].y, uSwA[i].x)) - uSwB[i].x) / uSwB[i].z;
      h += uSwA[i].w * exp(-a * a) * exp(-b * b * b * b);
    }
    return h;
  }
  float chopH(vec2 p){
    return uChop * (0.075*sin(dot(p, vec2(0.110, 0.046)) + uTime*0.95)
         + 0.050*sin(dot(p, vec2(-0.060, 0.150)) + uTime*1.15)
         + 0.028*sin(dot(p, vec2(0.290, -0.210)) + uTime*1.85)
         + 0.016*sin(dot(p, vec2(-0.420, -0.350)) + uTime*2.60)
         + 0.010*sin(dot(p, vec2(0.700, 0.520)) + uTime*3.40));
  }
  float wavesH(vec2 p){ return chopH(p) + swellH(p); }`;
const waterMat = new T.MeshStandardMaterial({ color: 0x0c3f52, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.15 });
waterMat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + WATER_GLSL + '\nvarying vec3 vW; varying float vFoam; varying float vSw;')
    .replace('#include <beginnormal_vertex>', `
      vec3 w0 = (modelMatrix * vec4(position, 1.0)).xyz;
      #ifdef WATER_FAR
      float hC = 0.0;   // el agua de lejos va plana: sus triángulos miden cientos de metros y, con olas, se levantaban y tapaban al rider
      #else
      float hC = wavesH(w0.xz);
      #endif
      const float E = 0.3;
      #ifdef WATER_FAR
      float hX = 0.0, hZ = 0.0;
      #else
      float hX = wavesH(w0.xz + vec2(E, 0.0)), hZ = wavesH(w0.xz + vec2(0.0, E));
      #endif
      vec3 objectNormal = normalize(vec3(-(hX - hC) / E, 1.0, -(hZ - hC) / E));
      vFoam = smoothstep(0.08, 0.2, chopH(w0.xz) / max(uChop, 0.01));   // la ola grande no rompe: sin espuma
      #ifdef WATER_FAR
      vSw = 0.0;
      #else
      vSw = swellH(w0.xz);
      #endif
      vW = w0 + vec3(0.0, hC, 0.0);`)
    .replace('#include <begin_vertex>', 'vec3 transformed = position + vec3(0.0, hC, 0.0);');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uCaps; uniform sampler2D tNrm; uniform sampler2D tNoise;\nvarying vec3 vW; varying float vFoam; varying float vSw;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float n1 = texture2D(tNoise, vW.xz * 0.045 + uTime * vec2(0.008, 0.003)).r;
      float n2 = texture2D(tNoise, vW.xz * 0.23 - uTime * vec2(0.05, 0.035)).r;
      // borreguitos: más espuma en las crestas cuanto más viento
      float fo = smoothstep(0.66, 0.86, n1 * 0.55 + n2 * 0.5 + vFoam * 0.25) * uCaps;
      vec3 base = diffuseColor.rgb * (0.85 + 0.3 * n1);
      base = mix(base, vec3(0.06, 0.34, 0.31), clamp(vSw * 0.28, 0.0, 0.55));   // la ola grande, verde y transparente en su cara
      diffuseColor.rgb = mix(base, vec3(0.93, 0.96, 0.97), fo);`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec3 a = texture2D(tNrm, vW.xz * 0.075 + uTime * vec2(0.020, 0.008)).xyz * 2.0 - 1.0;
        vec3 b = texture2D(tNrm, vW.xz * 0.29 - uTime * vec2(0.025, 0.045)).xyz * 2.0 - 1.0;
        vec3 c = texture2D(tNrm, vW.xz * 1.1 + uTime * vec2(0.06, -0.05)).xyz * 2.0 - 1.0;
        float dist = length(vW - cameraPosition);
        float k = mix(1.0, 0.35, smoothstep(40.0, 600.0, dist));
        vec3 pert = vec3(a.x * 0.55 + b.x * 0.35 + c.x * 0.22, 0.0, a.y * 0.55 + b.y * 0.35 + c.y * 0.22) * k;
        normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
      }`);
};
// rejilla cerca del rider: celdas de ~0,35 m en el centro que crecen hacia fuera
function makeWaterGrid(R, N) {
  const g = new T.BufferGeometry(), pos = [], idx = [];
  const f = t => Math.sign(t) * R * (0.22 * Math.abs(t) + 0.78 * Math.pow(Math.abs(t), 2.6));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pos.push(f(i / N * 2 - 1), 0, f(j / N * 2 - 1));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.setAttribute('normal', new T.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  return g;
}
const waterNear = new T.Mesh(makeWaterGrid(190, IS_MOBILE ? 150 : 230), waterMat);
waterNear.receiveShadow = true; waterNear.frustumCulled = false;
// el agua de lejos: plana y por debajo de los valles de las olas de cerca (así nunca asoma por encima del rider)
const farGeo = new T.PlaneGeometry(14000, 14000, 60, 60); farGeo.rotateX(-Math.PI / 2); farGeo.translate(0, -0.55, 0);
const waterFarMat = new T.MeshStandardMaterial({ color: 0x0c3f52, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.15 });
waterFarMat.onBeforeCompile = waterMat.onBeforeCompile; waterFarMat.defines = { WATER_FAR: '' };
const waterFar = new T.Mesh(farGeo, waterFarMat); waterFar.frustumCulled = false;
scene.add(waterNear, waterFar);

// --- la misma ola en JS (altura del agua bajo la tabla)
function swellH(x, z) {
  let h = 0;
  for (let i = 0; i < 3; i++) {
    const A = U.uSwA.value[i], B = U.uSwB.value[i]; if (A.w < 0.001) continue;
    const a = (x * A.x + z * A.y - A.z) / B.y, b = (-x * A.y + z * A.x - B.x) / B.z;
    h += A.w * Math.exp(-a * a) * Math.exp(-b * b * b * b);
  }
  return h;
}
function wavesH(x, z, t) {
  return swellH(x, z) + U.uChop.value * (0.075 * Math.sin(x * 0.110 + z * 0.046 + t * 0.95) + 0.050 * Math.sin(-x * 0.060 + z * 0.150 + t * 1.15)
    + 0.028 * Math.sin(x * 0.290 - z * 0.210 + t * 1.85) + 0.016 * Math.sin(-x * 0.420 - z * 0.350 + t * 2.60)
    + 0.010 * Math.sin(x * 0.700 + z * 0.520 + t * 3.40));
}
const ss = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const smooth = (a, b, x) => ss((x - a) / (b - a));
const surfaceH = wavesH;

// ---------------------------------------------------------------- materiales y piezas básicas
const MAT = (c, r = 0.8, m = 0, extra = {}) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
function box(w, h, d, mat, x, y, z, parent, cast = true) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
}
const CYL = new T.CylinderGeometry(1, 1, 1, 16, 1);
function rod(a, b, r, mat, parent) {
  const m = new T.Mesh(CYL, mat), d = V3().subVectors(b, a), L = d.length();
  m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(r, L, r); m.quaternion.setFromUnitVectors(UP, d.normalize());
  m.castShadow = true; parent.add(m); return m;
}

// =====================================================================================
//  EL PUERTO DE SAGUNTO
// =====================================================================================
const world = new T.Group(); scene.add(world);
const SHORE_Z = 80;
// Distribución real (Google Earth): Puerto Siles en x ≈ -200, espigón curvo en x ≈ 300, Pantalán en x = 900
// y el puerto industrial de Sagunto al otro lado del Pantalán.
const PIER_X = 900, GROIN_X = 300, MARINA_X = -200;
// entre el club náutico y el espigón no hay fincas: es un paraje natural con matorral, pinos, palmeras y un camino de grava
const WILD0 = MARINA_X + 12, WILD1 = GROIN_X + 15, inWild = x => x > WILD0 && x < WILD1;
{
  // ---- tierra, playa y paseo
  const sand = MAT(0xd9c29a, 0.95), sandWet = MAT(0xb8a07a, 0.9), prom = MAT(0xcfc4b2, 0.9), asphalt = MAT(0x4a4a4c, 0.9), land = MAT(0x9c946f, 1);
  box(2600, 2, 70, sand, PIER_X - 1300, -0.7, SHORE_Z + 35, world, false);
  box(2600, 2, 6, sandWet, PIER_X - 1300, -0.92, SHORE_Z + 2, world, false);
  {
    const tile = canvasTex(256, 256, (c, w, h) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { c.fillStyle = (i + j) % 2 ? '#c9c0b2' : '#e6e0d5'; c.fillRect(i * 32, j * 32, 32, 32); } c.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i <= 8; i++) { c.fillRect(i * 32, 0, 1, h); c.fillRect(0, i * 32, w, 1); } }, { repeat: true });
    tile.repeat.set(650, 3.5);
    box(2600, 1.4, 14, MAT(0xffffff, 0.85, 0, { map: tile }), PIER_X - 1300, 0.3, SHORE_Z + 77, world, false);
  }
  box(2600, 1.2, 4, MAT(0xbdb7ad, 0.9), PIER_X - 1300, 0.35, SHORE_Z + 98, world, false);   // acera de las fincas
  box(2600, 1.2, 12, asphalt, PIER_X - 1300, 0.2, SHORE_Z + 90, world, false);
  // bahía de arena delante del espigón y zona verde con caminos detrás
  box(160, 2, 40, sand, GROIN_X + 40, -0.75, SHORE_Z - 8, world, false);
  box(220, 1.2, 70, MAT(0x6f8a4a, 1), GROIN_X - 20, 0.1, SHORE_Z + 135, world, false);
  {
    const sh = new T.InstancedMesh(new T.DodecahedronGeometry(1, 0), MAT(0x51703a, 1), 160), o = new T.Object3D();
    for (let i = 0; i < 160; i++) { o.position.set(GROIN_X - 120 + rnd(0, 210), 1.0, SHORE_Z + 105 + rnd(0, 60)); const s = rnd(1, 3); o.scale.set(s, s * rnd(0.8, 1.6), s); o.updateMatrix(); sh.setMatrixAt(i, o.matrix); }
    world.add(sh);
  }
  box(9000, 1, 9000, land, 0, -0.1, SHORE_Z + 4600, world, false);

  // ---- fincas de la Avenida del Mediterráneo (Puerto de Sagunto): bloques de 5 a 9 plantas en crema, ocre y
  //      salmón, con balcones de barandilla y persianas, bajos comerciales con toldos y alguna torre blanca más
  //      alta con terrazas corridas. Cada textura son 4 plantas (3,05 m) y 3 vanos (4 m).
  const FAC = {
    crema: ['#ece0c4', 'recessed'], ocre: ['#d8b98b', 'glass'], salmon: ['#d49a7c', 'shutters'],
    blanco: ['#f1efe9', 'recessed'], torre: ['#f4f3ef', 'bands'], gris: ['#cfcac0', 'shutters'],
  };
  function facadeTex(kind) {
    const [wall, type] = FAC[kind];
    return canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = wall; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { c.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.035).toFixed(3) + ')'; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
      for (let fl = 0; fl < 4; fl++) {
        const y = fl * 128;
        if (type === 'bands') {   // terraza corrida: losa blanca, cristal oscuro y barandilla de aluminio
          c.fillStyle = '#2f3b45'; c.fillRect(0, y + 18, w, 84);
          c.fillStyle = 'rgba(160,190,210,.35)'; c.fillRect(0, y + 18, w, 22);
          for (let k = 0; k < 6; k++) { c.fillStyle = '#d9d6cf'; c.fillRect(k * 85, y + 18, 6, 84); }
          c.fillStyle = '#fbfaf7'; c.fillRect(0, y + 100, w, 22);
          c.fillStyle = 'rgba(200,215,225,.55)'; c.fillRect(0, y + 74, w, 26);
          c.fillStyle = '#bfc4c8'; c.fillRect(0, y + 72, w, 3);
          continue;
        }
        for (let k = 0; k < 3; k++) {
          const x = k * 170 + 22;
          if (type === 'recessed') {          // balcón metido: hueco oscuro, puerta y barandilla de barrotes blancos
            c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x - 8, y + 10, 142, 104);
            c.fillStyle = '#34414c'; c.fillRect(x + 20, y + 18, 86, 80);
            c.fillStyle = '#e9e6df'; c.fillRect(x + 61, y + 18, 4, 80);
            c.fillStyle = '#f7f6f2'; c.fillRect(x - 8, y + 70, 142, 4); c.fillRect(x - 8, y + 108, 142, 6);
            for (let r = x - 4; r < x + 132; r += 9) c.fillRect(r, y + 72, 2, 38);
          } else if (type === 'glass') {      // balcón volado con frente de cristal verdoso
            c.fillStyle = '#2d3a42'; c.fillRect(x + 14, y + 14, 98, 84);
            c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(x + 14, y + 14, 98, 14);
            c.fillStyle = 'rgba(120,170,160,.55)'; c.fillRect(x - 10, y + 70, 146, 40);
            c.fillStyle = '#efece6'; c.fillRect(x - 12, y + 108, 150, 8);
          } else {                             // ventana con persiana enrollable a medio bajar y marco blanco
            c.fillStyle = '#f5f3ee'; c.fillRect(x + 8, y + 12, 110, 96);
            c.fillStyle = '#33404a'; c.fillRect(x + 16, y + 20, 94, 80);
            const down = 20 + ((k * 7 + fl * 3) % 5) * 12;
            c.fillStyle = ['#8a6a4a', '#5d7a5a', '#b9b2a4'][(k + fl) % 3]; c.fillRect(x + 16, y + 20, 94, down);
            for (let r = y + 22; r < y + 20 + down; r += 5) { c.fillStyle = 'rgba(0,0,0,.15)'; c.fillRect(x + 16, r, 94, 1); }
            c.fillStyle = '#e8e4dc'; c.fillRect(x, y + 104, 126, 7);
            c.fillStyle = '#f5f3ee'; for (let r = x + 4; r < x + 122; r += 10) c.fillRect(r, y + 82, 2, 22); c.fillRect(x, y + 80, 126, 3);
          }
          if ((k + fl * 2) % 4 === 0) { c.fillStyle = ['#2f6b8a', '#b33a2f', '#3e7a4a', '#e3c34a'][(k + fl) % 4]; c.fillRect(x - 6, y + 8, 138, 12); }   // toldo
        }
      }
    }, { repeat: true });
  }
  const shopTex = canvasTex(512, 160, (c, w, h) => {   // bajos: escaparates, toldos de bares y rótulos
    c.fillStyle = '#e7e1d6'; c.fillRect(0, 0, w, h);
    const signs = ['BAR', 'CAFÉ', 'HELADOS', 'FARMACIA', 'TAPAS', 'INMOB.'];
    for (let k = 0; k < 3; k++) {
      const x = k * 170 + 10, col = ['#b8332c', '#2f6f4f', '#25587a', '#e1b23a', '#ffffff'][Math.floor(Math.random() * 5)];
      c.fillStyle = '#2b333a'; c.fillRect(x, 50, 150, 110);
      c.fillStyle = 'rgba(190,215,230,.35)'; c.fillRect(x + 6, 56, 138, 40);
      c.fillStyle = col; c.fillRect(x - 4, 36, 158, 22);
      for (let r = x - 4; r < x + 154; r += 16) { c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(r, 36, 8, 22); }
      c.fillStyle = '#1d2226'; c.fillRect(x + 20, 8, 110, 22); c.fillStyle = '#f2efe8'; c.font = 'bold 16px Arial'; c.fillText(signs[Math.floor(Math.random() * signs.length)], x + 34, 25);
    }
  }, { repeat: true });
  const facadeMats = {}; for (const k in FAC) facadeMats[k] = MAT(0xffffff, 0.88, 0, { map: facadeTex(k) });
  const shopMat = MAT(0xffffff, 0.8, 0, { map: shopTex }), roofMat = MAT(0xbdb6aa, 0.95), parapet = MAT(0xe8e3d8, 0.9);
  const tankMat = MAT(0xf0f0ee, 0.6);
  function boxUV(w, h, d, su, sv) { const g = new T.BoxGeometry(w, h, d), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
  const kinds = ['crema', 'ocre', 'salmon', 'blanco', 'gris'];
  for (let row = 0; row < 3; row++) {
    let x = -1300 + rnd(0, 20);
    while (x < PIER_X - 60) {
      if (inWild(x) || inWild(x + 25)) { x += 30; continue; }   // el paraje natural
      const tower = rnd() < (row === 0 ? 0.16 : 0.08);
      const kind = tower ? 'torre' : kinds[Math.floor(rnd(0, kinds.length))];
      const w = tower ? rnd(20, 28) : rnd(16, 30), d = rnd(14, 20);
      const floors = tower ? Math.round(rnd(11, 15)) : Math.round(row === 0 ? rnd(5, 9.4) : rnd(4, 8));
      const hb = 4.2, hu = floors * 3.05, zc = SHORE_Z + 100 + d / 2 + row * 38 + rnd(0, 4);
      const base = new T.Mesh(boxUV(w, hb, d, w / 12, 1), shopMat); base.position.set(x + w / 2, hb / 2 + 0.6, zc); base.receiveShadow = true; world.add(base);
      const up = new T.Mesh(boxUV(w, hu, d, w / 12, floors / 4), facadeMats[kind]); up.position.set(x + w / 2, hb + 0.6 + hu / 2, zc); up.receiveShadow = true; world.add(up);
      const top = hb + 0.6 + hu;
      box(w + 0.4, 1.1, d + 0.4, parapet, x + w / 2, top + 0.2, zc, world, false);          // pretil de la azotea
      box(w - 0.6, 0.3, d - 0.6, roofMat, x + w / 2, top + 0.4, zc, world, false);
      box(rnd(4, 7), 2.6, rnd(4, 6), parapet, x + w * rnd(0.3, 0.7), top + 1.5, zc + rnd(-2, 2), world, false);   // casetón
      for (let k = 0; k < 2; k++) { const t2 = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 1.6, 10), tankMat); t2.position.set(x + rnd(2, w - 2), top + 1.1, zc + rnd(-d / 3, d / 3)); world.add(t2); }   // depósitos de agua
      x += w + (row === 0 ? rnd(2, 9) : rnd(4, 14));
    }
  }
  // ---- el paraje natural entre Puerto Siles y el espigón (Google Earth): playa de grava, duna baja, matorral
  //      verde oscuro, pinos, palmeras sueltas y un camino de tierra paralelo a la costa; las torres de Canet al fondo
  {
    const groundTex = canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = '#a8946c'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const g = Math.random();
        c.fillStyle = g < 0.55 ? `rgba(${70 + Math.random() * 30 | 0},${100 + Math.random() * 30 | 0},${60 + Math.random() * 20 | 0},.55)` : `rgba(${150 + Math.random() * 40 | 0},${130 + Math.random() * 30 | 0},${95 + Math.random() * 20 | 0},.5)`;
        c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 12, 0, TAU); c.fill();
      }
    }, { repeat: true });
    groundTex.repeat.set(10, 10);
    const W = WILD1 - WILD0, Z0 = SHORE_Z + 28, Z1 = SHORE_Z + 520;
    box(W, 1.5, Z1 - Z0, MAT(0xffffff, 1, 0, { map: groundTex }), (WILD0 + WILD1) / 2, 0.32, (Z0 + Z1) / 2, world, false);   // tapa el paseo y la avenida
    // duna baja detrás de la playa de grava
    box(W, 1.2, 9, MAT(0xcdb894, 1), (WILD0 + WILD1) / 2, 0.55, Z0 + 3, world, false);   // duna baja
    box(W, 1.0, 10, MAT(0xbfb4a2, 1), (WILD0 + WILD1) / 2, -0.4, SHORE_Z + 6, world, false);   // grava de la orilla
    // camino de tierra/grava paralelo a la costa y dos ramales hacia dentro
    const pathM = MAT(0xd8c9a6, 1);
    box(W, 0.2, 5, pathM, (WILD0 + WILD1) / 2, 1.15, SHORE_Z + 58, world, false);
    for (const px of [WILD0 + 150, WILD0 + 340]) { const b = box(4, 0.2, 160, pathM, px, 1.16, SHORE_Z + 140, world, false); b.rotation.y = 0.35; }
    // matorral: lentiscos y coscojas en manchas (verde oscuro, algo azulado como en la foto)
    const nb = 2600, bushes = new T.InstancedMesh(new T.DodecahedronGeometry(1, 1), MAT(0xffffff, 1), nb), o = new T.Object3D(), col = new T.Color();
    const greens = [0x3f5f3c, 0x4c6b45, 0x35553f, 0x5a7650, 0x46644c];
    for (let i = 0; i < nb; i++) {
      // en manchas: cerca de unos centros al azar
      const cx = WILD0 + 10 + ((i * 7919) % 97) / 97 * (W - 20), cz = SHORE_Z + 40 + ((i * 104729) % 89) / 89 * 440;
      let x = cx + rnd(-14, 14), z = cz + rnd(-12, 12);
      if (i % 3 === 0) { x = rnd(WILD0 + 4, WILD1 - 4); z = SHORE_Z + rnd(34, 54); }   // franja tupida justo detrás de la playa (lo que se ve desde el mar)
      if (Math.abs(z - (SHORE_Z + 58)) < 4) continue;   // el camino libre
      const sc = rnd(1.1, 3.4);
      o.position.set(x, 1.0 + sc * 0.4, z); o.rotation.set(rnd(0, 3), rnd(0, 6), rnd(0, 3)); o.scale.set(sc * rnd(1, 1.6), sc * rnd(0.6, 1.0), sc * rnd(1, 1.6)); o.updateMatrix();
      bushes.setMatrixAt(i, o.matrix); bushes.setColorAt(i, col.set(greens[i % greens.length]).multiplyScalar(rnd(0.85, 1.15)));
    }
    bushes.castShadow = true; bushes.receiveShadow = true; world.add(bushes);
    // pinos piñoneros (copa ancha y plana) y algún pino más alto
    const np = 70, ptr = new T.InstancedMesh(new T.CylinderGeometry(0.25, 0.4, 1, 7), MAT(0x6b5641, 0.95), np), pcr = new T.InstancedMesh(new T.SphereGeometry(1, 12, 8), MAT(0x3d5a36, 1), np);
    for (let i = 0; i < np; i++) {
      const x = rnd(WILD0 + 15, WILD1 - 15), z = SHORE_Z + rnd(80, 480), h = rnd(6, 11);
      o.position.set(x, 1 + h / 2, z); o.rotation.set(rnd(-0.1, 0.1), 0, rnd(-0.1, 0.1)); o.scale.set(1, h, 1); o.updateMatrix(); ptr.setMatrixAt(i, o.matrix);
      const r = rnd(3.5, 6); o.position.set(x, 1 + h + 0.8, z); o.rotation.set(0, rnd(0, 6), 0); o.scale.set(r, r * 0.38, r * rnd(0.8, 1.1)); o.updateMatrix(); pcr.setMatrixAt(i, o.matrix);
    }
    ptr.castShadow = pcr.castShadow = true; world.add(ptr, pcr);
    // al fondo, las torres de cristal de Canet
    const glassT = canvasTex(256, 512, (c, w, h) => {
      c.fillStyle = '#8fa6b8'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) { c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(0, y, w, 3); c.fillStyle = 'rgba(40,60,80,.25)'; c.fillRect(0, y + 3, w, 10); }
      for (let x = 0; x < w; x += 32) { c.fillStyle = 'rgba(230,240,245,.5)'; c.fillRect(x, 0, 2, h); }
    }, { repeat: true });
    for (const [tx, tz, tw, th] of [[MARINA_X + 60, SHORE_Z + 640, 44, 62], [MARINA_X + 105, SHORE_Z + 660, 30, 48]]) {
      const tb = new T.Mesh(boxUV(tw, th, 22, tw / 20, th / 30), MAT(0xffffff, 0.25, 0.3, { map: glassT })); tb.position.set(tx, th / 2, tz); world.add(tb);
    }
  }
  // ---- coches aparcados a los dos lados de la avenida
  {
    const n = 220, bodyG = new T.BoxGeometry(4.2, 0.85, 1.8), cabG = new T.BoxGeometry(2.3, 0.6, 1.62);
    const bodies = new T.InstancedMesh(bodyG, MAT(0xffffff, 0.35, 0.4), n), cabs = new T.InstancedMesh(cabG, MAT(0x1d252c, 0.15, 0.3), n), o = new T.Object3D();
    const cols = [0xf2f2f0, 0x1c1d20, 0x8c9196, 0xb32a2a, 0x2a4f8c, 0xd8d3c8, 0x4a5a3a].map(c => new T.Color(c));
    for (let i = 0; i < n; i++) {
      const side = i % 2, xx = -1250 + (i >> 1) * 19 + rnd(-3, 3), zz = SHORE_Z + (side ? 95.2 : 85.2);
      o.scale.setScalar(inWild(xx) ? 0 : 1);
      o.position.set(xx, 1.25, zz); o.rotation.set(0, rnd(-0.03, 0.03), 0); o.updateMatrix(); bodies.setMatrixAt(i, o.matrix); bodies.setColorAt(i, cols[Math.floor(rnd(0, cols.length))]);
      o.position.y = 1.95; o.position.x -= 0.2; o.updateMatrix(); cabs.setMatrixAt(i, o.matrix);
    }
    world.add(bodies, cabs);
  }
  // ---- palmeras del paseo: datileras canarias (tronco grueso, copa grande) y alguna washingtonia alta y fina
  {
    const frondTex = canvasTex(128, 512, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.strokeStyle = '#4f6b2e'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(w / 2, h); c.lineTo(w / 2, 0); c.stroke();
      for (let y = 20; y < h - 10; y += 7) {
        const len = (w / 2 - 6) * Math.sin(Math.PI * (1 - y / h)) + 8;
        c.strokeStyle = ['#3f6a2a', '#4d7a32', '#5a8a3a'][y % 3]; c.lineWidth = 3;
        c.beginPath(); c.moveTo(w / 2, y); c.lineTo(w / 2 - len, y - 16); c.moveTo(w / 2, y); c.lineTo(w / 2 + len, y - 16); c.stroke();
      }
    });
    const trunkG = new T.CylinderGeometry(0.32, 0.45, 1, 9); trunkG.translate(0, 0.5, 0);
    const frondG = new T.PlaneGeometry(1.4, 5.2, 1, 6); frondG.translate(0, 2.6, 0);
    { const p = frondG.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -0.075 * y * y); } }
    const n = 150, trunks = new T.InstancedMesh(trunkG, MAT(0x7d6a52, 0.95), n);
    const fronds = new T.InstancedMesh(frondG, MAT(0xffffff, 0.75, 0, { map: frondTex, alphaTest: 0.4, side: T.DoubleSide }), n * 16);
    const o = new T.Object3D();
    for (let i = 0; i < n; i++) {
      let x = PIER_X - 40 - i * 20 + rnd(-3, 3), z = SHORE_Z + 70 + (i % 2) * 10, wash = rnd() < 0.3;
      if (i >= 120 || inWild(x)) { x = rnd(WILD0 + 10, WILD1 - 10); z = SHORE_Z + rnd(45, 260); wash = rnd() < 0.6; }   // sueltas por el paraje
      const h = wash ? rnd(11, 15) : rnd(5, 8.5), thick = wash ? 0.55 : 1.15;
      o.position.set(x, 0.8, z); o.rotation.set(rnd(-0.05, 0.05), 0, rnd(-0.05, 0.05)); o.scale.set(thick, h, thick); o.updateMatrix(); trunks.setMatrixAt(i, o.matrix);
      const nf = 16, sc = wash ? 0.6 : 1.05;
      for (let k = 0; k < nf; k++) {
        o.position.set(x, 0.8 + h, z); o.scale.setScalar(sc * rnd(0.85, 1.1)); o.rotation.set(0, k / nf * TAU + rnd(-0.15, 0.15), 0); o.rotateX(k % 2 ? rnd(0.7, 1.2) : rnd(1.3, 1.9));
        o.updateMatrix(); fronds.setMatrixAt(i * nf + k, o.matrix);
      }
    }
    trunks.castShadow = true; fronds.castShadow = true; world.add(trunks, fronds);
    // farolas del paseo
    const poleM = MAT(0x3b3f44, 0.5, 0.6);
    for (let x = PIER_X - 50; x > -1280; x -= 26) {
      if (inWild(x)) continue;
      rod(V3(x, 0.8, SHORE_Z + 80), V3(x, 8.5, SHORE_Z + 80), 0.09, poleM, world);
      box(1.6, 0.14, 0.32, poleM, x - 0.7, 8.5, SHORE_Z + 80, world, false);
    }
  }
  // ---- el puerto industrial (al otro lado del Pantalán): explanada, contenedores, grúas y depósitos de gas
  const conc = MAT(0xbab4a8, 0.95), concDark = MAT(0x8d877d, 0.95);
  const PX = PIER_X;   // el puerto industrial queda detrás del Pantalán
  box(900, 4, 700, conc, PX + 840, -0.5, -120, world, false);                    // muelles ganados al mar
  // (entre el Pantalán y el puerto solo hay mar abierto: sin dique, como en la foto del dron)
  // ---- espigón curvo de la playa: sale de la orilla y se dobla hacia el Pantalán
  {
    const n = 700, rocks = new T.InstancedMesh(new T.DodecahedronGeometry(1, 0), MAT(0x8f7f69, 0.95), n), o = new T.Object3D();
    const curve = new T.QuadraticBezierCurve3(V3(GROIN_X, 0, SHORE_Z + 10), V3(GROIN_X - 10, 0, SHORE_Z - 85), V3(GROIN_X + 45, 0, SHORE_Z - 105));
    for (let i = 0; i < n; i++) {
      const t = rnd(), p = curve.getPoint(t), w = 7 * (1 - 0.35 * t), xr = rnd(-1, 1);
      o.position.set(p.x + xr * w, Math.max(-1.2, 2.4 * (1 - Math.abs(xr) ** 1.6) - rnd(0, 1.2) - t * 0.6), p.z + rnd(-3, 3));
      o.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); const s = rnd(1.1, 2.4); o.scale.set(s, s * 0.75, s); o.updateMatrix(); rocks.setMatrixAt(i, o.matrix);
    }
    rocks.castShadow = true; rocks.receiveShadow = true; world.add(rocks);
  }
  // ---- Puerto Siles (Canet), como en Google Earth: la dársena rectangular pegada a la playa, el dique norte,
  //      la escollera grande por fuera (con el paseo de hormigón encima) que se dobla hacia tierra en la bocana,
  //      el espigón corto del sur, los pantalanes llenos de barcos y el bosque de mástiles de los veleros
  {
    const X0 = MARINA_X - 280, X1 = MARINA_X, ZE = SHORE_Z - 205;     // dique norte · fondo sur de la dársena · escollera
    const rockM = MAT(0x8a7a64, 0.95), o = new T.Object3D();
    const rockSets = [];
    function breakwater(pts, width, h, n) {                             // escollera de bloques a lo largo de una curva
      const curve = new T.CatmullRomCurve3(pts.map(([x, z]) => V3(x, 0, z)));
      rockSets.push({ curve, width, h, n });
    }
    breakwater([[X0, SHORE_Z + 4], [X0, SHORE_Z - 100], [X0, ZE]], 11, 3.2, 700);                                   // dique norte
    breakwater([[X0, ZE], [X0 + 140, ZE - 4], [X1, ZE - 2], [X1 + 55, ZE + 6], [X1 + 78, ZE + 30], [X1 + 72, ZE + 58]], 16, 3.8, 1700);   // escollera exterior y su codo
    breakwater([[X1 + 6, SHORE_Z + 2], [X1 + 18, SHORE_Z - 40], [X1 + 34, SHORE_Z - 70]], 9, 2.6, 300);              // espigón sur
    const total = rockSets.reduce((q, r) => q + r.n, 0), rocks = new T.InstancedMesh(new T.DodecahedronGeometry(1, 0), rockM, total);
    let ri = 0;
    for (const r of rockSets) for (let i = 0; i < r.n; i++) {
      const t = rnd(), p = r.curve.getPoint(t), tg = r.curve.getTangent(t), nx = -tg.z, nz = tg.x, xr = rnd(-1, 1);
      o.position.set(p.x + nx * xr * r.width * 0.5, Math.max(-1.3, r.h * (1 - Math.abs(xr) ** 1.6) - rnd(0, 1.2)), p.z + nz * xr * r.width * 0.5);
      o.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); const sc = rnd(1.3, 2.9); o.scale.set(sc, sc * 0.8, sc); o.updateMatrix(); rocks.setMatrixAt(ri++, o.matrix);
    }
    rocks.castShadow = true; rocks.receiveShadow = true; world.add(rocks);
    // paseo de hormigón y muro encima de la escollera exterior (se ve desde el mar por encima de las rocas)
    const concM = MAT(0xc9c3b6, 0.9), wallM = MAT(0xb3ad9f, 0.9);
    box(X1 + 40 - X0, 1.0, 6, concM, (X0 + X1 + 40) / 2, 3.6, ZE + 5, world, false);
    box(X1 + 40 - X0, 2.2, 1.2, wallM, (X0 + X1 + 40) / 2, 4.6, ZE - 1.5, world);
    // muelles de hormigón de dentro: el de tierra, el del dique norte y la explanada central del sur
    box(X1 - X0, 1.2, 16, concM, (X0 + X1) / 2, 0.6, SHORE_Z - 6, world, false);
    box(14, 1.2, SHORE_Z - ZE - 10, concM, X0 + 10, 0.6, (SHORE_Z + ZE) / 2, world, false);
    box(36, 1.2, 70, concM, X1 - 50, 0.6, SHORE_Z - 50, world, false);
    // pantalanes flotantes y los barcos amarrados a los dos lados
    const pontM = MAT(0x9a8f80, 0.85), pontoons = [];
    for (let k = 0; k < 5; k++) pontoons.push({ x: X0 + 40 + k * 36, z0: SHORE_Z - 16, z1: ZE + 22, along: 'z' });   // los del norte, hacia fuera
    for (let k = 0; k < 3; k++) pontoons.push({ z: SHORE_Z - 98 - k * 30, x0: X1 - 160, x1: X1 - 72, along: 'x' });   // los del sur, paralelos a la costa
    for (const pt of pontoons) {
      if (pt.along === 'z') box(2.4, 0.5, pt.z0 - pt.z1, pontM, pt.x, 0.3, (pt.z0 + pt.z1) / 2, world, false);
      else box(pt.x1 - pt.x0, 0.5, 2.4, pontM, (pt.x0 + pt.x1) / 2, 0.3, pt.z, world, false);
    }
    const slots = [];
    for (const pt of pontoons) {
      if (pt.along === 'z') { for (let z = pt.z0 - 6; z > pt.z1 + 4; z -= 4.6) for (const sd of [-1, 1]) slots.push([pt.x + sd * 6.5, z, Math.PI / 2]); }
      else { for (let x = pt.x0 + 5; x < pt.x1 - 4; x += 4.6) for (const sd of [-1, 1]) slots.push([x, pt.z + sd * 6.5, 0]); }
    }
    for (let x = X0 + 22; x < X1 - 20; x += 4.8) slots.push([x, ZE + 12, Math.PI / 2 + 0.0001]);      // abarloados a la escollera por dentro
    const N = slots.length;
    const hullG = new T.CapsuleGeometry(1.15, 6.5, 4, 10); hullG.rotateX(Math.PI / 2); hullG.scale(1, 0.55, 1);
    const cabG = new T.BoxGeometry(1.6, 1.0, 3.2);
    const hulls = new T.InstancedMesh(hullG, MAT(0xffffff, 0.3), N), cabs = new T.InstancedMesh(cabG, MAT(0xffffff, 0.35), N);
    const masts = new T.InstancedMesh(new T.CylinderGeometry(0.1, 0.16, 1, 6), MAT(0xaeb3b8, 0.3, 0.7), N);   // gruesos para que se vean desde lejos
    const booms = new T.InstancedMesh(new T.CylinderGeometry(0.05, 0.05, 1, 5), MAT(0xd0d2d4, 0.3, 0.8), N);
    const covers = new T.InstancedMesh(new T.CylinderGeometry(0.18, 0.18, 1, 6), MAT(0x1f3f6b, 0.8), N);   // fundas azules de las velas
    const hc = [0xffffff, 0xffffff, 0xffffff, 0xf2f0ea, 0x1d3557, 0xffffff, 0xe8e4da], col = new T.Color();
    for (let i = 0; i < N; i++) {
      const [x, z, ry] = slots[i], sail = rnd() < 0.62, L = rnd(0.75, 1.3);
      o.position.set(x, 0.35, z); o.rotation.set(0, ry + rnd(-0.04, 0.04), 0); o.scale.set(L, L * rnd(0.9, 1.1), L); o.updateMatrix();
      hulls.setMatrixAt(i, o.matrix); hulls.setColorAt(i, col.set(hc[(i * 5) % hc.length]));
      o.position.set(x, 1.1 * L, z); o.scale.set(L, L * (sail ? 0.8 : 1.3), L); o.updateMatrix(); cabs.setMatrixAt(i, o.matrix);
      const mh = sail ? rnd(12, 19) * L : 0.001;                    // el mástil: lo que se ve por encima de la escollera
      o.position.set(x, 0.9 + mh / 2, z); o.rotation.set(0, 0, 0); o.scale.set(1, mh, 1); o.updateMatrix(); masts.setMatrixAt(i, o.matrix);
      // botavara (y la funda de la vela) a lo largo del barco, a 2 m del puente
      const ax = ry < 0.5 ? V3(0, 0, 1) : V3(1, 0, 0), bl = sail ? 4.2 * L : 0.001;
      o.position.set(x + ax.x * bl * 0.45, 2.6 * L, z + ax.z * bl * 0.45); o.quaternion.setFromUnitVectors(UP, ax); o.scale.set(1, bl, 1); o.updateMatrix(); booms.setMatrixAt(i, o.matrix);
      o.position.y += 0.22; o.scale.set(1, bl * 0.9, 1); o.updateMatrix(); covers.setMatrixAt(i, o.matrix);
      o.quaternion.identity();
    }
    for (const m of [hulls, cabs, masts]) { m.castShadow = true; }
    world.add(hulls, cabs, masts, booms, covers);
    // luces de la bocana: roja en la punta de la escollera, verde en el espigón sur
    for (const [x, z, c] of [[X1 + 72, ZE + 58, 0xc7302c], [X1 + 34, SHORE_Z - 70, 0x2e8b45]]) {
      const tw = new T.Mesh(new T.CylinderGeometry(0.8, 1.1, 6, 14), MAT(c, 0.5)); tw.position.set(x, 6, z); world.add(tw);
      const lt = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 1.2, 10), MAT(0xffffff, 0.3, 0, { emissive: c, emissiveIntensity: 0.6 })); lt.position.set(x, 9.6, z); world.add(lt);
    }
    // el club náutico (edificio blanco con cristaleras) y las naves de la marina
    const white = MAT(0xf1efe9, 0.7), glass = MAT(0x5d7f95, 0.15, 0.6);
    box(60, 9, 24, white, X1 - 70, 4.5, SHORE_Z + 26, world);
    box(58, 3, 0.6, glass, X1 - 70, 6, SHORE_Z + 13.7, world, false);
    box(64, 1, 28, MAT(0x2b5c8a, 0.6), X1 - 70, 9.5, SHORE_Z + 26, world);
    for (let k = 0; k < 4; k++) box(26, 7, 16, white, X0 + 30 + k * 40, 3.5, SHORE_Z + 22, world);
    // grúa de varada
    box(1, 9, 1, MAT(0x3b6fb0, 0.5, 0.4), X1 - 20, 5, SHORE_Z - 12, world); box(10, 1, 1, MAT(0x3b6fb0, 0.5, 0.4), X1 - 16, 9.5, SHORE_Z - 12, world);
  }
  const cc = [0xa2433a, 0x2d6688, 0xc89b3b, 0x3b7a4e, 0xd9d5cc, 0x7a2f2a];
  for (let i = 0; i < 160; i++) {
    const lvl = i % 3, col = Math.floor(i / 3);
    box(12.2, 2.6, 2.45, MAT(cc[(i * 7) % 6], 0.7, 0.2), PX + 610 + (col % 12) * 14, 1.3 + 2.6 * lvl + 1.5, 40 - Math.floor(col / 12) * 8, world, false);
  }
  for (const [tx, tz] of [[PX + 840, -260], [PX + 900, -260]]) {
    const t = new T.Mesh(new T.CylinderGeometry(24, 24, 34, 40), MAT(0xf3f2ee, 0.5)); t.position.set(tx, 18, tz); world.add(t);
    const d = new T.Mesh(new T.SphereGeometry(24, 40, 12, 0, TAU, 0, Math.PI * 0.3), MAT(0xf3f2ee, 0.5)); d.position.set(tx, 35, tz); world.add(d);
  }

  // ---- Alto Horno nº 2 y la Sierra Calderona al fondo
  {
    const rust = MAT(0x86523a, 0.85, 0.25), iron = MAT(0x39322e, 0.75, 0.4), ah = new T.Group();
    ah.position.set(PIER_X + 350, 0, 950); world.add(ah);
    const prof = [[5.2, 0], [6.0, 10], [6.4, 22], [5.4, 34], [4.2, 44], [3.2, 50]];
    for (let i = 0; i < prof.length - 1; i++) {
      const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
      const m = new T.Mesh(new T.CylinderGeometry(r1, r0, y1 - y0, 24), i % 2 ? iron : rust); m.position.y = (y0 + y1) / 2; ah.add(m);
    }
    for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) box(1.2, 62, 1.2, iron, x, 31, z, ah, false);
    for (let y = 12; y <= 60; y += 9) { box(17, 0.6, 1.6, iron, 0, y, -8, ah, false); box(17, 0.6, 1.6, iron, 0, y, 8, ah, false); box(1.6, 0.6, 17, iron, -8, y, 0, ah, false); box(1.6, 0.6, 17, iron, 8, y, 0, ah, false); }
    const skip = box(3, 2, 85, iron, 0, 30, -40, ah, false); skip.rotation.x = 0.62;
    const ch = new T.Mesh(new T.CylinderGeometry(1.6, 2.2, 70, 16), MAT(0x9a948a, 0.9)); ch.position.set(40, 35, 10); ah.add(ch);
  }
  {
    // montañas: anillo de colinas al fondo, por detrás del pueblo
    const g = new T.PlaneGeometry(16000, 2600, 220, 40); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), k = (z + 1300) / 2600;
      const n = Math.sin(x * 0.0021) * 0.5 + Math.sin(x * 0.0057 + 1.3) * 0.3 + Math.sin(x * 0.013 + 0.4) * 0.2;
      p.setY(i, Math.max(0, (180 + 260 * n) * Math.sin(Math.PI * k) * smooth(0, 0.5, k)));
    }
    g.computeVertexNormals();
    const mt = new T.Mesh(g, MAT(0x6f7a5c, 1)); mt.position.set(0, -2, SHORE_Z + 4300); world.add(mt);
  }
}

// ---- El Pantalán (foto de dron desde la punta): tablero de hormigón claro sobre muchos pilotes finos,
//      cabeza más ancha al final con las tolvas de mineral oxidadas y las cargadoras grises, y una pasarela
//      blanca de celosía hasta los duques de alba rojos de la punta, el último con la baliza amarilla y negra.
{
  const pier = new T.Group(); pier.position.x = PIER_X; world.add(pier);
  const deckM = MAT(0xc9bea8, 0.9), deckDark = MAT(0x958b7b, 0.95), pileM = MAT(0x4b3f37, 0.85, 0.2), rustM = MAT(0x9a4f26, 0.8, 0.35);
  const railOld = MAT(0x5a554f, 0.7, 0.4), white = MAT(0xeeeeea, 0.45, 0.2), machine = MAT(0x5f6a73, 0.6, 0.5), redPile = MAT(0x8e3322, 0.75, 0.3);
  const DY = 7.5, W = 8, SPAN = 30, Z_START = SHORE_Z + 20, Z_END = SHORE_Z - 1150;
  const nSpan = Math.floor((Z_START - Z_END) / SPAN);
  const o = new T.Object3D();
  const decks = new T.InstancedMesh(new T.BoxGeometry(W, 1.0, SPAN + 0.02), deckM, nSpan);
  const piles = new T.InstancedMesh(new T.CylinderGeometry(0.42, 0.42, 1, 12), pileM, nSpan * 3 + 40);
  const caps = new T.InstancedMesh(new T.BoxGeometry(W + 0.8, 0.9, 1.2), deckDark, nSpan + 10);
  const posts = new T.InstancedMesh(new T.BoxGeometry(0.06, 1.1, 0.06), railOld, nSpan * 2 * 6);
  let np = 0, nc = 0, nq = 0;
  const addPile = (x, z, top, xb = x) => {   // de (x, top) arriba a (xb, -4) abajo
    const a = V3(x, top, z), b = V3(xb, -4, z), d = V3().subVectors(a, b), L = d.length();
    o.position.copy(b).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(UP, d.normalize()); o.scale.set(1.15, L, 1.15); o.updateMatrix(); piles.setMatrixAt(np++, o.matrix);
    o.quaternion.identity(); o.rotation.set(0, 0, 0);
  };
  for (let i = 0; i < nSpan; i++) {
    const z0 = Z_START - i * SPAN, zc = z0 - SPAN / 2;
    o.position.set(0, DY, zc); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix(); decks.setMatrixAt(i, o.matrix);
    if (z0 < SHORE_Z - 15) {
      addPile(0, z0, DY - 0.8); addPile(-2.6, z0, DY - 0.8, -5.2); addPile(2.6, z0, DY - 0.8, 5.2);
      o.position.set(0, DY - 0.9, z0); o.scale.set(1, 1, 1); o.updateMatrix(); caps.setMatrixAt(nc++, o.matrix);
    }
    for (const sx of [-1, 1]) {
      if ((i * 5 + (sx > 0 ? 2 : 0)) % 7 === 0) continue;   // trozos de barandilla perdidos
      box(0.07, 0.07, SPAN, railOld, sx * (W / 2 - 0.1), DY + 1.55, zc, pier, false);
      for (let k = 0; k < SPAN; k += 2.5) { o.position.set(sx * (W / 2 - 0.1), DY + 1.0, z0 - k); o.updateMatrix(); posts.setMatrixAt(nq++, o.matrix); }
    }
  }
  // cabeza del pantalán: plataforma ancha de carga
  const HZ0 = Z_END, HL = 75, HW = 20;
  box(HW, 1.2, HL, deckM, 0, DY, HZ0 - HL / 2, pier, true);
  for (let z = HZ0; z >= HZ0 - HL; z -= 12.5) for (const x of [-8.5, -4.2, 0, 4.2, 8.5]) addPile(x, z, DY - 0.8);
  // tolvas de mineral (pirámides invertidas oxidadas sobre patas) y cintas
  for (const [hz, hx] of [[HZ0 - 18, -3], [HZ0 - 30, -3.5], [HZ0 - 44, -2.5]]) {
    const g = new T.Group(); g.position.set(hx, DY + 0.6, hz); pier.add(g);
    for (const [px, pz] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) box(0.35, 4.5, 0.35, rustM, px, 2.25, pz, g);
    const hop = new T.Mesh(new T.CylinderGeometry(4.2, 0.9, 3.6, 4, 1, true), rustM); hop.rotation.y = Math.PI / 4; hop.position.y = 5.6; hop.material.side = T.DoubleSide; hop.castShadow = true; g.add(hop);
    box(6, 0.4, 6, rustM, 0, 7.4, 0, g);
    const ch = box(1.2, 0.5, 8, rustM, 3.2, 4.6, 2, g); ch.rotation.set(-0.35, 0.6, 0);
  }
  // cargadoras grises (estructura con brazo) más hacia tierra
  for (const [mz, mx] of [[HZ0 + 30, 1.5], [HZ0 + 55, 1.2]]) {
    const g = new T.Group(); g.position.set(mx, DY + 0.5, mz); pier.add(g);
    for (const [px, pz] of [[-1.5, -2], [1.5, -2], [-1.5, 2], [1.5, 2]]) box(0.3, 3.2, 0.3, machine, px, 1.6, pz, g);
    box(3.6, 1.6, 5, machine, 0, 3.8, 0, g);
    const arm = box(1.2, 0.8, 12, machine, -3, 4.8, -2, g); arm.rotation.set(0.15, -0.9, 0);
  }
  box(1.4, 0.9, Z_START - HZ0 - 200, rustM, 2.2, DY + 0.95, (Z_START - 200 + HZ0) / 2, pier, false);   // restos de la cinta del mineral
  // pasarela de celosía blanca hasta los duques de alba
  const CZ0 = HZ0 - HL, CZ1 = CZ0 - 105, CY = DY + 0.4, CH = 2.0, CW = 1.8;
  box(CW, 0.15, CZ0 - CZ1, white, 0, CY, (CZ0 + CZ1) / 2, pier, true);
  for (const sx of [-1, 1]) {
    box(0.15, 0.15, CZ0 - CZ1, white, sx * CW / 2, CY, (CZ0 + CZ1) / 2, pier, false);
    box(0.15, 0.15, CZ0 - CZ1, white, sx * CW / 2, CY + CH, (CZ0 + CZ1) / 2, pier, false);
    for (let z = CZ0; z > CZ1; z -= 2.5) {
      rod(V3(sx * CW / 2, CY, z), V3(sx * CW / 2, CY + CH, z), 0.05, white, pier);
      rod(V3(sx * CW / 2, CY, z), V3(sx * CW / 2, CY + CH, z - 2.5), 0.04, white, pier);
    }
  }
  // duques de alba: grandes pilotes rojos oxidados
  for (const [dz, tip] of [[CZ0 - 50, false], [CZ1 - 3, true]]) {
    const d = new T.Mesh(new T.CylinderGeometry(2.0, 2.2, CY + 4, 24), redPile); d.position.set(0, (CY - 4) / 2, dz); d.castShadow = true; pier.add(d);
    box(5, 0.5, 5, deckDark, 0, CY - 0.2, dz, pier, true);
    if (tip) {   // baliza cardinal: franjas amarillo y negro con marca de tope
      const cols = [0x111111, 0xe8c21a, 0x111111];
      cols.forEach((c, k) => { const s = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 1.1, 16), MAT(c, 0.5)); s.position.set(0, CY + 0.6 + k * 1.1, dz); pier.add(s); });
      for (const sgn of [1, -1]) { const cn = new T.Mesh(new T.ConeGeometry(0.45, 0.8, 16), MAT(0x111111, 0.5)); cn.position.set(0, CY + 4.4 + (sgn > 0 ? 0.5 : -0.2), dz); if (sgn < 0) cn.rotation.x = Math.PI; pier.add(cn); }
      const lamp = new T.Mesh(new T.SphereGeometry(0.2, 10, 8), MAT(0xffffff, 0.2, 0, { emissive: 0xfff2a0, emissiveIntensity: 0.6 })); lamp.position.set(0, CY + 5.3, dz); pier.add(lamp);
    }
  }
  piles.count = np; caps.count = nc; posts.count = nq;
  for (const m of [decks, piles, caps]) { m.castShadow = true; m.receiveShadow = true; }
  pier.add(decks, piles, caps, posts);
  // arranque en tierra sobre escollera
  box(14, DY, 120, deckDark, 0, DY / 2 - 0.6, SHORE_Z - 25, pier, false);
  const rockG = new T.DodecahedronGeometry(1, 0), nr = 900, rocks = new T.InstancedMesh(rockG, MAT(0x8b7862, 0.95), nr);
  for (let i = 0; i < nr; i++) {
    const z = rnd(SHORE_Z - 95, SHORE_Z + 25), xr = rnd(-1, 1), w = 13;
    o.position.set(xr * w, Math.max(-1.5, (DY - 2.5) * (1 - Math.pow(Math.abs(xr), 1.4)) - rnd(0, 2)), z);
    o.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); const s = rnd(1.2, 2.6); o.scale.set(s * rnd(0.9, 1.3), s * 0.8, s * rnd(0.9, 1.3)); o.updateMatrix(); rocks.setMatrixAt(i, o.matrix);
  }
  rocks.receiveShadow = true; pier.add(rocks);
  // farolas negras del tramo nuevo
  for (let z = SHORE_Z + 10; z > SHORE_Z - 170; z -= 24) for (const sx of [-1, 1]) {
    rod(V3(sx * 3.2, DY + 0.5, z), V3(sx * 3.2, DY + 6, z), 0.07, MAT(0x1b1b1d, 0.5, 0.4), pier);
    box(0.7, 0.18, 0.3, MAT(0x1b1b1d, 0.5, 0.4), sx * 2.95, DY + 6, z, pier, false);
  }
}
