// Namma Space viewer: explore a COLMAP + OpenMVS room reconstruction in the browser.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;
const isTouch = matchMedia('(pointer: coarse)').matches;

// Camera assumed ~1.35 m above the floor while filming (per-scene override): fixes the arbitrary SfM scale.
let CAPTURE_HEIGHT_M = 1.35;
const EYE_M = 1.55;
const params = new URLSearchParams(location.search);
const RADIUS_M = 0.28;

// ---------- renderer / scene ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 300);
const roomGroup = new THREE.Group();
scene.add(roomGroup);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.zoomToCursor = true; // wheel zooms toward the point under the mouse, for inspecting details

const cutPlane = new THREE.Plane(new V3(0, -1, 0), 1e6);
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;

const state = { mode: 'orbit', cut: true, showPath: false, collide: true, layer: 'textured', map: true };
let room = null;
let sceneCfg = null;

// ---------- loading ----------
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function boot() {
  const cfg = await getJSON('scenes.json');
  const want = params.get('scene');
  const sc = cfg.scenes.find((s) => s.id === want) || cfg.scenes[0];
  sceneCfg = sc;
  if (sc.captureHeight) CAPTURE_HEIGHT_M = sc.captureHeight;
  document.title = `NammaSpace · ${sc.title}`;
  $('scene-title').textContent = sc.title;
  $('scene-sub').textContent = sc.subtitle || '';
  const badge = $('scene-badge');
  badge.textContent = { real: 'REAL CAPTURE', dataset: 'PUBLIC DATASET · PROTOTYPE' }[sc.kind] || 'PUBLIC SAMPLE';
  badge.className = `badge ${sc.kind === 'real' ? 'real' : sc.kind === 'dataset' ? 'dataset' : 'sample'}`;
  $('info-provenance').textContent = sc.provenance || '';
  if (sc.pipeline) $('pipe-list').innerHTML = sc.pipeline.map((s) => `<li>${s}</li>`).join('');
  $('scene-list').innerHTML = cfg.scenes.map((s) =>
    `<li><a href="?scene=${s.id}"${s.id === sc.id ? ' aria-current="page"' : ''}>${s.title}</a></li>`).join('');

  const [cams, stats] = await Promise.all([
    getJSON(sc.dir + 'cameras.json').catch(() => ({ cameras: [] })),
    getJSON(sc.dir + 'stats.json').catch(() => ({})),
  ]);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((res, rej) =>
    loader.load(sc.dir + 'room.glb', res, (e) => {
      const total = e.total || stats.glb_bytes || 0;
      const pct = total ? Math.min(100, (100 * e.loaded) / total) : 0;
      $('load-bar').style.width = pct.toFixed(1) + '%';
      $('load-sub').textContent = `${(e.loaded / 1048576).toFixed(1)} MB${total ? ' / ' + (total / 1048576).toFixed(1) + ' MB' : ''}`;
    }, rej));
  $('load-msg').textContent = 'Preparing walkable space…';
  await new Promise((r) => setTimeout(r, 30));

  room = buildRoom(gltf.scene, cams.cameras || []);
  fillStats(stats, room);
  setMode('orbit');
  resetView();
  buildMinimap();
  $('loader').classList.add('done');
  if (sc.splat) loadSplat(sc.dir + 'room.splat');
  if (sc.stages) await loadStages(sc.dir);
  window.__nsReady = true;
}

// ---------- pipeline stages: sparse SfM points, dense MVS points, untextured mesh, textured mesh ----------
async function loadPly(url) {
  // Compact binary PLY written by export_points.mjs: float x,y,z + uchar r,g,b per vertex.
  const buf = await (await fetch(url)).arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, 400));
  const n = Number(head.match(/element vertex (\d+)/)[1]);
  const off = head.indexOf('end_header\n') + 11;
  const dv = new DataView(buf, off);
  const pos = new Float32Array(n * 3), col = new Uint8Array(n * 3);
  for (let i = 0, o = 0; i < n; i++, o += 15) {
    pos[i * 3] = dv.getFloat32(o, true); pos[i * 3 + 1] = dv.getFloat32(o + 4, true); pos[i * 3 + 2] = dv.getFloat32(o + 8, true);
    col[i * 3] = dv.getUint8(o + 12); col[i * 3 + 1] = dv.getUint8(o + 13); col[i * 3 + 2] = dv.getUint8(o + 14);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  return g;
}
async function loadStages(dir) {
  const [sparse, dense] = await Promise.all([loadPly(dir + 'sparse.ply'), loadPly(dir + 'dense.ply')]);
  const mk = (g, size) => {
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, clippingPlanes: [cutPlane] }));
    p.visible = false;
    p.frustumCulled = false;
    room.holder.add(p);
    return p;
  };
  room.sparse = mk(sparse, 0.035);
  room.dense = mk(dense, 0.018);
  room.counts = { sparse: sparse.attributes.position.count, dense: dense.attributes.position.count };
  scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x3a3f4a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 8, 5);
  scene.add(sun);
  room.meshes.forEach((m) => {
    m.geometry.computeVertexNormals();
    m.userData.tex = m.material;
    m.userData.clay = new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, clippingPlanes: [cutPlane] });
  });
  $('layers').hidden = false;
}
function setLayer(layer) {
  if (!room || !room.dense) return;
  state.layer = layer;
  const pts = layer === 'sparse' || layer === 'dense';
  room.meshes.forEach((m) => {
    m.visible = !pts && !state.splat;
    m.material = layer === 'mesh' ? m.userData.clay : m.userData.tex;
  });
  room.sparse.visible = layer === 'sparse';
  room.dense.visible = layer === 'dense';
  room.path.visible = state.showPath || layer === 'sparse';
  document.querySelectorAll('#layers button').forEach((b) => b.classList.toggle('on', b.dataset.layer === layer));
  const label = {
    sparse: `Sparse SfM points · ${room.counts.sparse.toLocaleString('en-IN')} pts + camera poses`,
    dense: `Dense MVS point cloud · ${room.counts.dense.toLocaleString('en-IN')} pts shown`,
    mesh: `Surface mesh · ${Math.round(room.tris).toLocaleString('en-IN')} triangles`,
    textured: 'Textured mesh · final digital twin',
  }[layer];
  $('layer-label').textContent = label;
}

// ---------- optional photoreal layer: Gaussian splats trained on the same SfM poses ----------
async function loadSplat(url) {
  const btn = $('btn-splat');
  btn.hidden = false;
  btn.disabled = true;
  btn.textContent = 'Photoreal…';
  try {
    const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
    scene.add(new SparkRenderer({ renderer }));
    const splat = new SplatMesh({ url, fileType: 'splat' });
    await splat.initialized;
    splat.visible = false;
    room.holder.add(splat); // same frame as the mesh: gravity-aligned COLMAP coordinates
    room.splat = splat;
    btn.disabled = false;
    btn.textContent = 'Photoreal';
    btn.onclick = toggleSplat;
  } catch (err) {
    console.error('splat load failed', err);
    btn.hidden = true;
  }
}
function toggleSplat() {
  if (!room.splat) return;
  state.splat = !state.splat;
  room.splat.visible = state.splat;
  room.meshes.forEach((m) => { m.visible = !state.splat; }); // meshes still drive collision + picking
  $('btn-splat').classList.toggle('on', state.splat);
}

// ---------- alignment: gravity, metric scale, floor at y = 0 ----------
function buildRoom(model, rawCams) {
  // Gravity: average camera "up" (COLMAP camera -Y) across all capture frames.
  const up = new V3();
  const qs = rawCams.map((c) => new THREE.Quaternion(...c.quaternion));
  qs.forEach((q) => up.add(new V3(0, -1, 0).applyQuaternion(q)));
  if (up.lengthSq() < 1e-8) up.set(0, -1, 0);
  up.normalize();
  const qAlign = new THREE.Quaternion().setFromUnitVectors(up, new V3(0, 1, 0));

  const holder = new THREE.Group();
  holder.quaternion.copy(qAlign);
  holder.add(model);
  holder.updateMatrixWorld(true);

  const meshes = [];
  const ys = [], xs = [], zs = [];
  let tris = 0, texMax = 0;
  const v = new V3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    const g = o.geometry;
    // De-quantize (meshopt/KHR_mesh_quantization) so BVH + stats see plain floats.
    const pa = g.attributes.position;
    if (!(pa.array instanceof Float32Array) || pa.normalized || pa.isInterleavedBufferAttribute) {
      const f = new Float32Array(pa.count * 3);
      for (let i = 0; i < pa.count; i++) { f[i * 3] = pa.getX(i); f[i * 3 + 1] = pa.getY(i); f[i * 3 + 2] = pa.getZ(i); }
      g.setAttribute('position', new THREE.BufferAttribute(f, 3));
    }
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const step = Math.max(1, Math.floor(g.attributes.position.count / 200000));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += step) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      xs.push(v.x); ys.push(v.y); zs.push(v.z);
    }
    const old = o.material;
    const map = old.map || null;
    if (map) { map.anisotropy = renderer.capabilities.getMaxAnisotropy(); texMax = Math.max(texMax, map.image?.width || 0); }
    o.material = new THREE.MeshBasicMaterial({
      map, color: map ? 0xffffff : (old.color || 0xcccccc), vertexColors: !map && !!g.attributes.color,
      side: THREE.DoubleSide, clippingPlanes: [cutPlane],
    });
    old.dispose();
  });

  // Camera centres in the gravity-aligned frame.
  const camPos = rawCams.map((c) => new V3(...c.position).applyQuaternion(qAlign));
  const pct = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const camY = camPos.length ? pct(camPos.map((p) => p.y), 0.5) : pct(ys, 0.5);
  const yLo = pct(ys, 0.01), yHi = pct(ys, 0.99);

  // Floor / ceiling = densest horizontal slab below / above the camera height.
  const peak = (lo, hi) => {
    if (!(hi > lo)) return (lo + hi) / 2;
    const bins = new Uint32Array(80), w = (hi - lo) / 80;
    for (const y of ys) if (y >= lo && y < hi) bins[Math.floor((y - lo) / w)]++;
    let b = 0; for (let i = 1; i < 80; i++) if (bins[i] > bins[b]) b = i;
    return lo + (b + 0.5) * w;
  };
  const floorY = peak(yLo, yLo + 0.45 * (camY - yLo));
  const ceilY = yHi > camY ? peak(camY + 0.35 * (yHi - camY), yHi + 1e-6) : yHi;
  const eyeUnits = Math.max(1e-6, camY - floorY);
  const s = CAPTURE_HEIGHT_M / eyeUnits;

  const cx = camPos.length ? pct(camPos.map((p) => p.x), 0.5) : pct(xs, 0.5);
  const cz = camPos.length ? pct(camPos.map((p) => p.z), 0.5) : pct(zs, 0.5);
  const toView = (p) => new V3((p.x - cx) * s, (p.y - floorY) * s, (p.z - cz) * s);

  const root = new THREE.Group();
  root.scale.setScalar(s);
  root.position.set(-cx * s, -floorY * s, -cz * s);
  root.add(holder);
  roomGroup.add(root);
  roomGroup.updateMatrixWorld(true);
  meshes.forEach((m) => m.geometry.computeBoundsTree());

  const ext = {
    x0: (pct(xs, 0.03) - cx) * s, x1: (pct(xs, 0.97) - cx) * s,
    z0: (pct(zs, 0.03) - cz) * s, z1: (pct(zs, 0.97) - cz) * s,
  };
  const height = (ceilY - floorY) * s;
  const flipX = new THREE.Quaternion(1, 0, 0, 0); // COLMAP camera (y down, +z fwd) -> three.js camera
  const poses = rawCams.map((c, i) => ({
    p: toView(camPos[i]),
    q: qAlign.clone().multiply(qs[i]).multiply(flipX),
  }));

  return {
    holder, meshes, tris, texMax, s, ext, poses,
    height: THREE.MathUtils.clamp(height, 2.0, 5.0),
    radius: Math.max(1.5, Math.hypot(ext.x1 - ext.x0, ext.z1 - ext.z0) / 2),
    path: buildPathHelper(poses),
    tour: buildTour(poses),
  };
}

// ---------- capture path helper ----------
function buildPathHelper(poses) {
  const g = new THREE.Group();
  if (poses.length < 2) return g;
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(poses.map((x) => x.p)),
    new THREE.LineBasicMaterial({ color: 0xffb547 })));
  const pts = [];
  const k = 0.09, corners = [[-1.33, -1], [1.33, -1], [1.33, 1], [-1.33, 1]].map(([x, y]) => new V3(x * k, y * k, -1.6 * k));
  poses.forEach((ps, i) => {
    if (i % 4) return;
    const c = corners.map((v) => v.clone().applyQuaternion(ps.q).add(ps.p));
    for (let j = 0; j < 4; j++) pts.push(ps.p, c[j], c[j], c[(j + 1) % 4]);
  });
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x4cd98a, transparent: true, opacity: 0.8 })));
  g.visible = false;
  scene.add(g);
  return g;
}

// ---------- minimap: top-down orthographic view of the cut-away model with a "you are here" marker ----------
const mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
mapCam.layers.enable(1);
let marker = null;
function buildMinimap() {
  const e = room.ext;
  const cx = (e.x0 + e.x1) / 2, cz = (e.z0 + e.z1) / 2;
  const half = (Math.max(e.x1 - e.x0, e.z1 - e.z0) / 2) * 1.1;
  Object.assign(mapCam, { left: -half, right: half, top: half, bottom: -half });
  mapCam.position.set(cx, 60, cz);
  mapCam.up.set(0, 0, -1);
  mapCam.lookAt(cx, 0, cz);
  mapCam.updateProjectionMatrix();
  const r = half * 0.06;
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide });
  const flat = new THREE.Group();
  flat.rotation.x = -Math.PI / 2; // shape +Y -> world -Z (walk forward at yaw 0)
  const fov = THREE.MathUtils.degToRad(80);
  flat.add(new THREE.Mesh(new THREE.CircleGeometry(r * 4.5, 24, Math.PI / 2 - fov / 2, fov), mat(0xffb547, 0.28)));
  flat.add(new THREE.Mesh(new THREE.CircleGeometry(r * 1.25, 24), mat(0x0b0d12, 0.9)));
  flat.add(new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([
    new THREE.Vector2(0, r * 1.1), new THREE.Vector2(r * 0.75, -r * 0.8), new THREE.Vector2(0, -r * 0.35), new THREE.Vector2(-r * 0.75, -r * 0.8)])), mat(0xffb547, 1)));
  marker = new THREE.Group();
  marker.add(flat);
  marker.renderOrder = 10;
  marker.traverse((o) => { o.layers.set(1); o.renderOrder = 10; });
  scene.add(marker);
}
function mapRect() {
  const size = Math.round(Math.min(innerWidth, innerHeight) * 0.3);
  return { size, x: innerWidth - size - 16, y: 16 };
}
function renderMinimap() {
  const show = room && marker && state.map && state.mode !== 'orbit';
  $('minimap').hidden = !show;
  if (!show) return;
  marker.position.set(camera.position.x, room.height + 2, camera.position.z);
  const f = new V3(0, 0, -1).applyQuaternion(camera.quaternion);
  marker.rotation.y = Math.atan2(-f.x, -f.z);
  const { size, x, y } = mapRect();
  const c0 = cutPlane.constant;
  cutPlane.constant = Math.min(room.height * 0.8, 2.1);
  renderer.setScissorTest(true);
  renderer.setScissor(x, y, size, size);
  renderer.setViewport(x, y, size, size);
  renderer.render(scene, mapCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  cutPlane.constant = c0;
}

// ---------- tour along the real (smoothed) SfM trajectory ----------
function buildTour(poses) {
  if (poses.length < 4) return null;
  const n = poses.length, W = 3;
  const P = [], Q = [];
  for (let i = 0; i < n; i++) {
    const p = new V3(), q = new THREE.Quaternion(0, 0, 0, 0);
    let c = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
      p.add(poses[j].p); c++;
      const qj = poses[j].q.clone();
      // Keep all quaternions in the same hemisphere before averaging.
      if (poses[i].q.dot(qj) < 0) qj.set(-qj.x, -qj.y, -qj.z, -qj.w);
      q.set(q.x + qj.x, q.y + qj.y, q.z + qj.z, q.w + qj.w);
    }
    P.push(p.divideScalar(c)); Q.push(q.normalize());
  }
  return { curve: new THREE.CatmullRomCurve3(P), Q, n, duration: Math.max(25, n * 0.35), u: 0, playing: true };
}

function tourPose(u) {
  const t = room.tour;
  const f = u * (t.n - 1), i = Math.min(t.n - 2, Math.floor(f));
  camera.position.copy(t.curve.getPoint(u));
  camera.quaternion.copy(t.Q[i]).slerp(t.Q[i + 1], f - i);
}

// ---------- walk controller ----------
const walk = { pos: new V3(), yaw: 0, pitch: 0, keys: new Set(), joy: new THREE.Vector2(), vert: 0 };
function syncWalkFromCamera() {
  const f = new V3(0, 0, -1).applyQuaternion(camera.quaternion);
  walk.yaw = Math.atan2(-f.x, -f.z);
  walk.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)), -1.2, 1.2);
}
function applyWalkCamera() {
  camera.position.copy(walk.pos);
  camera.quaternion.setFromEuler(new THREE.Euler(walk.pitch, walk.yaw, 0, 'YXZ'));
}
function blocked(from, delta) {
  const len = delta.length();
  if (!state.collide || len < 1e-6) return null;
  raycaster.set(from, delta.clone().normalize());
  raycaster.far = len + RADIUS_M;
  return raycaster.intersectObjects(room.meshes, false)[0] || null;
}
function moveWithCollision(delta) {
  const chest = walk.pos.clone().add(new V3(0, -0.35, 0));
  const hit = blocked(chest, delta);
  if (!hit) return walk.pos.add(delta);
  // Slide along the wall.
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  n.y = 0;
  if (n.lengthSq() < 1e-4) return;
  n.normalize();
  const slide = delta.clone().sub(n.multiplyScalar(delta.dot(n)));
  if (!blocked(chest, slide)) walk.pos.add(slide);
}
function updateWalk(dt) {
  const k = walk.keys;
  let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - walk.joy.y;
  let strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + walk.joy.x;
  const vert = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0) + walk.vert;
  const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 2.6 : 1.2) * dt;
  const mag = Math.hypot(fwd, strafe);
  if (mag > 1) { fwd /= mag; strafe /= mag; }
  const f = new V3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
  const r = new V3(Math.cos(walk.yaw), 0, -Math.sin(walk.yaw));
  const d = f.multiplyScalar(fwd * speed).add(r.multiplyScalar(strafe * speed));
  if (d.lengthSq() > 0) moveWithCollision(d);
  if (vert) walk.pos.y = THREE.MathUtils.clamp(walk.pos.y + vert * dt * 0.9, 0.3, room.height + 1.5);
  applyWalkCamera();
}

// ---------- smooth camera moves ----------
let anim = null;
function animate(dur, step, done) { anim = { t: 0, dur, step, done }; }
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// ---------- modes ----------
function setMode(mode) {
  if (!room) return;
  if (mode === 'tour' && !room.tour) mode = 'orbit';
  const prev = state.mode;
  state.mode = mode;
  document.querySelectorAll('.seg button[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  controls.enabled = mode === 'orbit';
  $('tourbar').hidden = mode !== 'tour';
  $('joy').hidden = $('updown').hidden = !(mode === 'walk' && isTouch);
  camera.fov = 60;
  if (mode === 'walk') {
    // Enter walk mode where the phone actually stood: guaranteed free space with a view of the room.
    if (prev === 'orbit') startWalkPose();
    else { syncWalkFromCamera(); walk.pos.copy(camera.position); }
    applyWalkCamera();
  } else if (mode === 'orbit') {
    const f = new V3(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).addScaledVector(f, 1.5);
    controls.update();
  } else if (mode === 'tour') {
    room.tour.playing = true;
    $('tour-play').textContent = '❚❚';
  }
  camera.updateProjectionMatrix();
  updateCut();
  updateHint();
}
function startWalkPose() {
  const p0 = room.poses[Math.floor(room.poses.length / 2)];
  if (p0) { walk.pos.set(p0.p.x, EYE_M, p0.p.z); camera.quaternion.copy(p0.q); syncWalkFromCamera(); walk.pitch = 0; }
  else { walk.pos.set(0, EYE_M, 0); walk.yaw = 0; walk.pitch = 0; }
}
function overviewPose() {
  // Frame the reconstructed surfaces, viewed from the side the phone filmed from
  // (camera centroid is the origin; unseen back faces are usually missing).
  const e = room.ext;
  const target = new V3((e.x0 + e.x1) / 2, 0.8, (e.z0 + e.z1) / 2);
  const back = new V3(-target.x, 0, -target.z);
  if (back.lengthSq() < 0.25) back.set(0.6, 0, 0.8);
  back.normalize();
  const d = Math.hypot(e.x1 - e.x0, e.z1 - e.z0) * 0.52 + 1.5;
  const pos = target.clone().addScaledVector(back, d * 0.75).add(new V3(0, room.height + d * 0.55, 0));
  return { target, pos };
}
function resetView() {
  if (state.mode === 'walk') {
    startWalkPose(); camera.fov = 60; camera.updateProjectionMatrix(); applyWalkCamera(); return;
  }
  if (state.mode === 'tour') { room.tour.u = 0; room.tour.playing = true; $('tour-play').textContent = '❚❚'; return; }
  const { target, pos } = overviewPose();
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  controls.minDistance = 0.3;
  controls.maxDistance = room.radius * 6 + 10;
  animate(0.8, (k) => { camera.position.lerpVectors(p0, pos, k); controls.target.lerpVectors(t0, target, k); });
  if (!camera.position.lengthSq()) { camera.position.copy(pos); controls.target.copy(target); anim = null; }
  camera.fov = 60; camera.updateProjectionMatrix();
}
function updateCut() {
  const on = state.cut && state.mode === 'orbit';
  cutPlane.constant = on ? room.height * 0.8 : 1e6;
  $('btn-cut').classList.toggle('on', state.cut);
}
function updateHint() {
  const h = $('hint');
  const t = {
    orbit: isTouch ? '<b>Drag</b> orbit · <b>pinch</b> zoom · <b>two-finger drag</b> pan · <b>double-tap</b> focus'
      : '<b>Drag</b> orbit · <b>wheel</b> zoom · <b>right-drag</b> pan · <b>double-click</b> focus · switch to <b>Walk</b> to roam inside',
    walk: isTouch ? '<b>Joystick</b> move · <b>drag</b> look · <b>pinch</b> zoom · <b>▲▼</b> height · <b>double-tap</b> floor to step there'
      : '<b>W A S D</b> move · <b>drag</b> look · <b>Shift</b> run · <b>Q/E</b> down/up · <b>wheel</b> zoom · <b>double-click</b> to step · <b>G</b> collision ' + (state.collide ? 'on' : 'off'),
    tour: 'Replaying the <b>real camera trajectory</b> recovered by Structure-from-Motion',
  };
  h.innerHTML = t[state.mode];
  // On small screens the hint covers the view: show it briefly per mode.
  h.classList.remove('faded');
  clearTimeout(updateHint.timer);
  if (innerWidth <= 640) updateHint.timer = setTimeout(() => h.classList.add('faded'), 6000);
}

// ---------- picking ----------
function pick(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = Infinity;
  const hits = raycaster.intersectObjects(room.meshes, false);
  // Respect the cutaway: ignore hits above the cut plane.
  return hits.find((h) => cutPlane.distanceToPoint(h.point) >= 0) || null;
}
function onDoubleTap(x, y) {
  if (!room || state.mode === 'tour') return;
  const hit = pick(x, y);
  if (!hit) return;
  if (state.mode === 'orbit') {
    const t0 = controls.target.clone(), p0 = camera.position.clone();
    const off = p0.clone().sub(t0);
    const t1 = hit.point.clone();
    const p1 = t1.clone().add(off.setLength(Math.min(off.length(), Math.max(1.2, off.length() * 0.6))));
    animate(0.6, (k) => { controls.target.lerpVectors(t0, t1, k); camera.position.lerpVectors(p0, p1, k); });
  } else {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const dest = hit.point.clone();
    if (Math.abs(n.y) < 0.7) {
      // Clicked a wall/object: stop short of it.
      const back = walk.pos.clone().sub(dest).setY(0).setLength(0.6);
      dest.add(back);
    }
    dest.y = walk.pos.y;
    const from = walk.pos.clone();
    animate(0.7, (k) => { walk.pos.lerpVectors(from, dest, k); applyWalkCamera(); });
  }
}

// ---------- input ----------
const pointers = new Map();
let lastTap = { t: 0, x: 0, y: 0 }, pinch0 = 0, fov0 = 60;
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = Math.hypot(a.x - b.x, a.y - b.y); fov0 = camera.fov;
  }
  if (state.mode === 'walk') canvas.setPointerCapture(e.pointerId);
  if (state.mode === 'tour' && room?.tour) { room.tour.playing = false; $('tour-play').textContent = '▶'; }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (state.mode !== 'walk' || anim) return;
  if (pointers.size === 1) {
    // Grab-to-look, like Street View.
    walk.yaw += dx * 0.0042;
    walk.pitch = THREE.MathUtils.clamp(walk.pitch + dy * 0.0042, -1.3, 1.3);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    camera.fov = THREE.MathUtils.clamp(fov0 * (pinch0 / Math.max(1, d)), 25, 90);
    camera.updateProjectionMatrix();
  }
});
function endPointer(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p) return;
  const now = performance.now();
  const isTap = now - p.t0 < 300 && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 8;
  if (!isTap) return;
  if (now - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    onDoubleTap(e.clientX, e.clientY);
    lastTap.t = 0;
  } else lastTap = { t: now, x: e.clientX, y: e.clientY };
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  if (state.mode !== 'walk') return;
  e.preventDefault();
  camera.fov = THREE.MathUtils.clamp(camera.fov * Math.exp(e.deltaY * 0.001), 25, 90);
  camera.updateProjectionMatrix();
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select')) return;
  if (state.mode === 'walk' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  walk.keys.add(e.code);
  if (e.repeat) return;
  const map = { Digit1: 'orbit', Digit2: 'walk', Digit3: 'tour' };
  if (map[e.code]) setMode(map[e.code]);
  else if (e.code === 'KeyR') resetView();
  else if (e.code === 'KeyC') toggleCut();
  else if (e.code === 'KeyP') togglePath();
  else if (e.code === 'KeyF') toggleFull();
  else if (e.code === 'KeyI' || e.code === 'KeyH') toggleInfo();
  else if (e.code === 'KeyG') { state.collide = !state.collide; updateHint(); }
  else if (e.code === 'KeyV') toggleSplat();
  else if (e.code === 'KeyM') { state.map = !state.map; }
  else if (e.code === 'KeyK') $('hud').hidden = !$('hud').hidden;
});
addEventListener('keyup', (e) => walk.keys.delete(e.code));
addEventListener('blur', () => walk.keys.clear());

// Input overlay (K or ?hud=1): shows the keys and mouse buttons in use, for demos and screen recordings.
const hud = { wheelUntil: 0 };
if (params.get('hud') === '1') $('hud').hidden = false;
const hudKey = (code, on) => {
  const k = code.startsWith('Shift') ? 'Shift' : code;
  document.querySelectorAll(`#hud [data-k="${k}"]`).forEach((el) => el.classList.toggle('on', on));
};
addEventListener('keydown', (e) => hudKey(e.code, true));
addEventListener('keyup', (e) => hudKey(e.code, false));
addEventListener('pointerdown', (e) => $('hud').classList.add(e.button === 2 ? 'rmb' : 'lmb'));
addEventListener('pointerup', () => $('hud').classList.remove('lmb', 'rmb'));
addEventListener('wheel', () => { hud.wheelUntil = performance.now() + 250; }, { passive: true });

// Virtual joystick + height buttons (touch, walk mode).
const joy = $('joy'), knob = $('joy-knob');
joy.addEventListener('pointerdown', (e) => { joy.setPointerCapture(e.pointerId); joyMove(e); });
joy.addEventListener('pointermove', (e) => { if (joy.hasPointerCapture(e.pointerId)) joyMove(e); });
const joyEnd = () => { walk.joy.set(0, 0); knob.style.transform = ''; };
joy.addEventListener('pointerup', joyEnd);
joy.addEventListener('pointercancel', joyEnd);
function joyMove(e) {
  const r = joy.getBoundingClientRect();
  let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
  const m = Math.hypot(x, y), R = 45;
  if (m > R) { x *= R / m; y *= R / m; }
  walk.joy.set(x / R, y / R);
  knob.style.transform = `translate(${x}px, ${y}px)`;
}
for (const [id, v] of [['btn-up', 1], ['btn-down', -1]]) {
  const b = $(id);
  b.addEventListener('pointerdown', () => { walk.vert = v; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { walk.vert = 0; });
}

// Toolbar.
document.querySelectorAll('.seg button[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('#layers button').forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));
document.addEventListener('fullscreenchange', () => $('btn-full').classList.toggle('on', !!document.fullscreenElement));
// Read-only handle for automated checks and the demo recorder (which drives the viewer through real input events).
window.__ns = { THREE, state, walk, camera, controls, get room() { return room; } };
$('btn-reset').onclick = resetView;
$('btn-cut').onclick = toggleCut;
$('btn-path').onclick = togglePath;
$('btn-info').onclick = toggleInfo;
$('info-close').onclick = toggleInfo;
$('btn-full').onclick = toggleFull;
$('tour-play').onclick = () => {
  const t = room.tour; t.playing = !t.playing;
  if (t.playing && t.u >= 1) t.u = 0;
  $('tour-play').textContent = t.playing ? '❚❚' : '▶';
};
$('tour-seek').oninput = (e) => { room.tour.u = e.target.value / 1000; room.tour.playing = false; $('tour-play').textContent = '▶'; };
function toggleCut() { state.cut = !state.cut; updateCut(); }
function togglePath() {
  state.showPath = !state.showPath;
  room.path.visible = state.showPath;
  $('btn-path').classList.toggle('on', state.showPath);
}
function toggleInfo() { $('info').hidden = !$('info').hidden; $('hint').hidden = !$('info').hidden; }
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// ---------- stats panel ----------
function fillStats(st, r) {
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
  const mb = (b) => (b ? (b / 1048576).toFixed(1) + ' MB' : '—');
  const ext = `${(r.ext.x1 - r.ext.x0).toFixed(1)} × ${(r.ext.z1 - r.ext.z0).toFixed(1)} × ${r.height.toFixed(1)} m`;
  const video = sceneCfg?.kind === 'real';
  const rows = [
    [video ? 'Video frames used' : 'Input photographs', fmt(st.frames_used)],
    [video ? 'Frames registered by SfM' : 'Images with camera poses', fmt(st.registered_images)],
    ...(st.dense_points ? [['Dense MVS points', fmt(st.dense_points)]] : []),
    ['Sparse 3D points', fmt(st.sparse_points)],
    ['Mean reprojection error', st.mean_reproj_error_px != null ? st.mean_reproj_error_px.toFixed(2) + ' px' : '—'],
    ['Dense point cloud (PLY)', mb(st.dense_ply_bytes)],
    ['Mesh triangles', fmt(Math.round(r.tris))],
    ['Texture atlas', r.texMax ? `${r.texMax} px` : '—'],
    ['Web model (GLB)', mb(st.glb_bytes)],
    ['Approx. room extent', ext],
    ['Pipeline run time (CPU)', st.pipeline_minutes != null ? st.pipeline_minutes + ' min' : '—'],
    ['Processed on', st.date || '—'],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (room) {
    if (anim) {
      anim.t += dt;
      const k = Math.min(1, anim.t / anim.dur);
      anim.step(ease(k));
      if (k >= 1) { const d = anim.done; anim = null; d && d(); }
    }
    if (state.mode === 'orbit') controls.update();
    else if (state.mode === 'walk') { if (!anim) updateWalk(dt); }
    else if (state.mode === 'tour' && room.tour) {
      const t = room.tour;
      if (t.playing) {
        t.u = Math.min(1, t.u + (dt * Number($('tour-speed').value)) / t.duration);
        if (t.u >= 1) { t.playing = false; $('tour-play').textContent = '▶'; }
        $('tour-seek').value = Math.round(t.u * 1000);
      }
      tourPose(t.u);
    }
  }
  renderer.render(scene, camera);
  renderMinimap();
  $('hud').classList.toggle('wheel', performance.now() < hud.wheelUntil);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

boot().catch((err) => {
  console.error(err);
  $('load-msg').textContent = 'Could not load the 3D room.';
  $('load-sub').textContent = String(err.message || err);
});
