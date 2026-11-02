// Convert COLMAP images.txt (TXT model) into cameras.json for the web viewer:
// camera centres + world-from-camera rotations, in capture order.
// Usage: node export_cameras.mjs <images.txt> <cameras.txt> <out.json>
import fs from 'node:fs';

const [imagesTxt, camerasTxt, outFile] = process.argv.slice(2);

const intr = {};
for (const line of fs.readFileSync(camerasTxt, 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const [id, model, w, h, ...p] = line.trim().split(/\s+/);
  intr[id] = { model, width: +w, height: +h, params: p.map(Number) };
}

const lines = fs.readFileSync(imagesTxt, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const cams = [];
// images.txt alternates: pose line, then 2D-points line.
for (let i = 0; i < lines.length; i += 2) {
  const t = lines[i].trim().split(/\s+/);
  if (t.length < 10) continue;
  const [qw, qx, qy, qz, tx, ty, tz] = t.slice(1, 8).map(Number);
  // R (camera-from-world) from quaternion; centre C = -R^T t.
  const R = [
    [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
    [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
  ];
  const C = [0, 1, 2].map((j) => -(R[0][j] * tx + R[1][j] * ty + R[2][j] * tz));
  // World-from-camera rotation = R^T; inverse of a unit quaternion is its conjugate.
  const cam = intr[t[8]];
  const f = cam ? cam.params[0] : null;
  cams.push({
    name: t[9],
    position: C,
    quaternion: [-qx, -qy, -qz, qw], // three.js order (x, y, z, w), world-from-camera
    fovY: cam && f ? (2 * Math.atan(cam.height / (2 * f)) * 180) / Math.PI : 60,
  });
}
cams.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(outFile, JSON.stringify({ convention: 'COLMAP (x right, y down, z forward)', cameras: cams }));
console.log(`cameras=${cams.length}`);
