// Page-side helpers for the recorder: where to point the mouse, and which free-space waypoints to walk.
// They only read the viewer's state; all motion still comes from real mouse/keyboard events.
window.__demoTarget = (what, opt = {}) => {
  const { THREE, room, camera } = window.__ns;
  const rc = new THREE.Raycaster();
  const cut = room.height * 0.8;
  const hitAt = (x, y) => {
    rc.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
    return rc.intersectObjects(room.meshes, false).find((h) => h.point.y < cut) || null;
  };
  if (what === 'route') {
    // Camera centres of the capture (guaranteed free space), in capture order from the walk start pose.
    const P = room.poses.map((p) => p.p);
    if (opt.indices) return opt.indices.map((i) => ({ x: P[i].x, z: P[i].z, i }));
    const n = P.length, start = opt.start ?? Math.floor(n / 2), end = opt.end ?? n - 1, step = opt.step ?? 1.1;
    const dir = end >= start ? 1 : -1;
    const out = [];
    let last = P[start];
    for (let i = start + dir; dir > 0 ? i <= end : i >= end; i += dir) {
      if (Math.hypot(P[i].x - last.x, P[i].z - last.z) > step) { out.push({ x: P[i].x, z: P[i].z, i }); last = P[i]; }
    }
    return out;
  }
  if (what === 'zoom' || what === 'focus') {
    // A wall point at picture height near the preferred screen position.
    const pref = opt.pref || (what === 'zoom' ? [960, 470] : [1060, 560]);
    let best = null;
    for (let dy = -260; dy <= 260; dy += 26) for (let dx = -420; dx <= 420; dx += 30) {
      const x = pref[0] + dx, y = pref[1] + dy;
      const h = hitAt(x, y);
      if (!h) continue;
      const nrm = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      const wall = Math.abs(nrm.y) < 0.45 && h.point.y > 0.9 && h.point.y < 2.2;
      const score = Math.hypot(dx, dy) + (wall || opt.any ? 0 : 400);
      if (!best || score < best.score) best = { score, x, y };
    }
    return best ? [best.x, best.y] : null;
  }
  if (what === 'info') {
    return { n: room.poses.length, ext: room.ext, height: room.height, tris: room.tris, cam: camera.position.toArray(), walk: window.__ns.walk.pos.toArray() };
  }
  return null;
};
