// Export the sparse SfM cloud and a subsampled dense MVS cloud as compact binary PLYs for the viewer's stage view.
// Usage: node export_points.mjs <points3D.txt> <scene_dense.ply> <out dir> [max dense points]
import fs from 'node:fs';

const [ptsTxt, densePly, outDir, maxArg] = process.argv.slice(2);
const MAX = Number(maxArg || 1200000);

function writePly(file, xyz, rgb, n) {
  const head = `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
  const buf = Buffer.alloc(head.length + n * 15);
  buf.write(head, 0, 'latin1');
  let o = head.length;
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(xyz[i * 3], o); buf.writeFloatLE(xyz[i * 3 + 1], o + 4); buf.writeFloatLE(xyz[i * 3 + 2], o + 8);
    buf[o + 12] = rgb[i * 3]; buf[o + 13] = rgb[i * 3 + 1]; buf[o + 14] = rgb[i * 3 + 2];
    o += 15;
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

// Sparse: COLMAP points3D.txt
{
  const lines = fs.readFileSync(ptsTxt, 'utf8').split('\n').filter((l) => l && l[0] !== '#');
  const xyz = new Float32Array(lines.length * 3), rgb = new Uint8Array(lines.length * 3);
  lines.forEach((l, i) => {
    const t = l.split(' ');
    xyz[i * 3] = +t[1]; xyz[i * 3 + 1] = +t[2]; xyz[i * 3 + 2] = +t[3];
    rgb[i * 3] = +t[4]; rgb[i * 3 + 1] = +t[5]; rgb[i * 3 + 2] = +t[6];
  });
  const b = writePly(`${outDir}/sparse.ply`, xyz, rgb, lines.length);
  console.log(`sparse.ply: ${lines.length} points, ${(b / 1048576).toFixed(1)} MB`);
}

// Dense: OpenMVS binary PLY (vertex element first), random-subsampled.
{
  const buf = fs.readFileSync(densePly);
  const end = buf.indexOf('end_header\n') + 'end_header\n'.length;
  const header = buf.toString('latin1', 0, end).split('\n');
  const size = { float: 4, float32: 4, double: 8, float64: 8, uchar: 1, uint8: 1, char: 1, int8: 1, short: 2, ushort: 2, int: 4, uint: 4, int32: 4, uint32: 4 };
  let n = 0, inVertex = false;
  const props = [];
  for (const h of header) {
    const t = h.trim().split(/\s+/);
    if (t[0] === 'element') { inVertex = t[1] === 'vertex'; if (inVertex) n = +t[2]; }
    else if (t[0] === 'property' && inVertex) props.push(t[1] === 'list' ? { type: 'list', countType: t[2], itemType: t[3], name: t[4] } : { type: t[1], name: t[2] });
  }
  // Sequential parse: OpenMVS appends variable-length lists (view indices/weights) to every vertex.
  const rd = { float: 'readFloatLE', float32: 'readFloatLE', double: 'readDoubleLE', float64: 'readDoubleLE', uchar: 'readUInt8', uint8: 'readUInt8', char: 'readInt8', int8: 'readInt8', short: 'readInt16LE', ushort: 'readUInt16LE', int: 'readInt32LE', uint: 'readUInt32LE', int32: 'readInt32LE', uint32: 'readUInt32LE' };
  const keep = Math.min(n, MAX), every = n / keep;
  const xyz = new Float32Array(keep * 3), rgb = new Uint8Array(keep * 3);
  let o = end, k = 0, next = 0;
  for (let v = 0; v < n && k < keep; v++) {
    const val = {};
    for (const p of props) {
      if (p.type === 'list') {
        const cnt = buf[rd[p.countType]] ? buf[rd[p.countType]](o) : buf[o];
        o += size[p.countType] + cnt * size[p.itemType];
      } else { val[p.name] = buf[rd[p.type]](o); o += size[p.type]; }
    }
    if (v >= next) {
      xyz[k * 3] = val.x; xyz[k * 3 + 1] = val.y; xyz[k * 3 + 2] = val.z;
      if ('red' in val) { rgb[k * 3] = val.red; rgb[k * 3 + 1] = val.green; rgb[k * 3 + 2] = val.blue; } else rgb.fill(200, k * 3, k * 3 + 3);
      k++; next = Math.floor(k * every);
    }
  }
  const b = writePly(`${outDir}/dense.ply`, xyz, rgb, keep);
  console.log(`dense.ply: ${keep} of ${n} points, ${(b / 1048576).toFixed(1)} MB`);
  fs.writeFileSync(`${outDir}/dense_count.json`, JSON.stringify({ dense_points: n }));
}
