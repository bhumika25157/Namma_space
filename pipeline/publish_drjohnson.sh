#!/usr/bin/env bash
# Publish the Deep Blending "Dr Johnson" reconstruction into the site as the default scene (dataset prototype).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/work/drjohnson/web"
bash "$ROOT/pipeline/publish_scene.sh" drjohnson drjohnson dataset \
  "Dr Johnson house: public dataset prototype" \
  "263 photographs · Deep Blending (Hedman et al. 2018) · reconstructed by the NammaSpace pipeline" \
  "Prototype built on a PUBLIC RESEARCH DATASET, not our own capture: the Dr Johnson scene from Deep Blending (Hedman et al., SIGGRAPH Asia 2018), 263 photographs of a historic house interior, with COLMAP camera poses as distributed with the 3D Gaussian Splatting release (Kerbl et al., 2023). Dense reconstruction, meshing, texturing and web export were run by us with the open-source pipeline below. Areas no photograph saw, and plain textureless surfaces, can be missing or noisy." \
  --default
cp "$SRC/sparse.ply" "$SRC/dense.ply" "$ROOT/site/assets/drjohnson/"
node -e '
const fs=require("fs"); const [file, cnt, stats]=process.argv.slice(1);
const cfg=JSON.parse(fs.readFileSync(file,"utf8"));
const s=cfg.scenes.find(x=>x.id==="drjohnson");
s.stages=true; s.captureHeight=1.5;
s.pipeline=[
 "<b>Input</b> – 263 photographs with COLMAP camera poses (Deep Blending, Dr Johnson; poses from the 3DGS release). Public dataset, not our own capture.",
 "<b>Multi-View Stereo</b> – OpenMVS 2.4 PatchMatch: one depth map per photograph (quarter resolution), fused into a dense point cloud.",
 "<b>Surface</b> – Delaunay tetrahedralisation + graph-cut surface extraction → 2.48 M-face mesh.",
 "<b>Texture</b> – view-selected texture atlas from the full-resolution photographs (mesh decimated to 1.24 M faces) → GLB.",
 "<b>Web delivery</b> – meshopt geometry + JPEG textures → three.js viewer: orbit, first-person walk with BVH collision, minimap, stage layers.",
];
const st=JSON.parse(fs.readFileSync(stats,"utf8")); st.dense_points=JSON.parse(fs.readFileSync(cnt,"utf8")).dense_points;
fs.writeFileSync(stats, JSON.stringify(st,null,1));
fs.writeFileSync(file, JSON.stringify(cfg,null,2)); console.log("scene registered", s.id);
' "$ROOT/site/scenes.json" "$SRC/dense_count.json" "$ROOT/site/assets/drjohnson/stats.json"
ls -la "$ROOT/site/assets/drjohnson"
