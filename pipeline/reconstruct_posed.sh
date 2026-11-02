#!/usr/bin/env bash
# Namma Space - posed image set (COLMAP model, e.g. a public dataset) -> textured 3D environment (GLB).
# Same back end as reconstruct.sh, but starts from existing camera poses instead of running SfM.
#
# Usage:  bash reconstruct_posed.sh <dataset dir with images/ and sparse/0/> <job name>
# Env:    DENSE_LEVEL (default 2 = quarter-res depth maps), DENSE_VIEWS (5), SPLAT_STEPS (0 = no splats)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/tools"
COLMAP="$TOOLS/colmap/bin/colmap.exe"
MVS="$TOOLS/openmvs/vc17/x64/Release"
FFBIN="$TOOLS/ffmpeg/ffmpeg-master-latest-win64-gpl/bin"
PIPE="$ROOT/pipeline"

DATA="$(cd "${1:?dataset dir}" && pwd)"
JOB="${2:?job name}"
W="$ROOT/work/$JOB"
mkdir -p "$W"
LOG="$W/pipeline.log"
win() { cygpath -m "$1"; }
stage() { echo "[$(date +%H:%M:%S)] == $*" | tee -a "$LOG"; }
T0=$(date +%s)
NIMG=$(ls "$DATA/images" | wc -l)
stage "Posed dataset: $NIMG images from $DATA"
"$COLMAP" model_analyzer --path "$(win "$DATA/sparse/0")" 2>&1 | grep -E 'Registered images|Points|Mean reprojection|Cameras' | sed 's/^.*\] //' | tee -a "$LOG" "$W/sfm_stats.txt"

# ---------- 1. Undistortion (no-op copy for PINHOLE models) ----------
if [ ! -f "$W/.undist_done" ]; then
  rm -rf "$W/dense"
  stage "Undistorting images"
  "$COLMAP" image_undistorter --image_path "$(win "$DATA/images")" --input_path "$(win "$DATA/sparse/0")" \
    --output_path "$(win "$W/dense")" --output_type COLMAP --max_image_size 1600 >>"$LOG" 2>&1
  mkdir -p "$W/dense/sparse_txt"
  "$COLMAP" model_converter --input_path "$(win "$W/dense/sparse")" --output_path "$(win "$W/dense/sparse_txt")" --output_type TXT >>"$LOG" 2>&1
  touch "$W/.undist_done"
fi

# ---------- 1b. Optional Gaussian splats (Brush, GPU) in parallel with CPU-bound OpenMVS ----------
SPLAT_STEPS="${SPLAT_STEPS:-0}"
if [ "$SPLAT_STEPS" -gt 0 ] && [ ! -f "$W/splat/room.ply" ]; then
  stage "Brush: training Gaussian splats ($SPLAT_STEPS steps) in background"
  mkdir -p "$W/splat"
  (cd "$W/splat" && "$TOOLS/brush/brush_app.exe" "$(win "$DATA")" --total-steps "$SPLAT_STEPS" --max-resolution 1332 \
     --max-splats 2000000 --export-every "$SPLAT_STEPS" --export-path "$(win "$W/splat")" --export-name room.ply \
     --eval-every 1000000 >"$W/splat/brush.log" 2>&1) &
  echo $! > "$W/splat/brush.pid"
fi

# ---------- 2. OpenMVS dense reconstruction, meshing, texturing ----------
cd "$W/dense"
if [ ! -f scene.mvs ]; then
  stage "OpenMVS: import COLMAP scene"
  "$MVS/InterfaceCOLMAP.exe" -i . -o scene.mvs --image-folder images/ -v 1 >>"$LOG" 2>&1
fi
if [ ! -f scene_dense.mvs ]; then
  stage "OpenMVS: dense depth-map fusion (CPU, level ${DENSE_LEVEL:-2})"
  "$MVS/DensifyPointCloud.exe" scene.mvs --resolution-level "${DENSE_LEVEL:-2}" --number-views "${DENSE_VIEWS:-5}" -v 1 >>"$LOG" 2>&1
fi
if [ ! -f scene_dense_mesh.ply ]; then
  stage "OpenMVS: Delaunay/graph-cut surface reconstruction"
  "$MVS/ReconstructMesh.exe" scene_dense.mvs -p scene_dense.ply -o scene_dense_mesh.ply -v 1 >>"$LOG" 2>&1
fi
if [ ! -f scene_textured.glb ]; then
  stage "OpenMVS: texturing -> GLB"
  "$MVS/TextureMesh.exe" scene_dense.mvs -m scene_dense_mesh.ply -o scene_textured.glb --export-type glb \
    --decimate "${TEX_DECIMATE:-0.5}" --max-texture-size 4096 --empty-color 3355443 \
    --global-seam-leveling 0 --local-seam-leveling 0 -v 1 >>"$LOG" 2>&1  # seam leveling yields black patches in this build
fi

# ---------- 3. Web export ----------
stage "Optimising GLB for the web (embedded JPEG textures + meshopt)"
mkdir -p "$W/web"
cd "$ROOT/pipeline"
node web_glb.mjs "$(win "$W/dense/scene_textured.glb")" "$(win "$W/web/room.glb")" "$(win "$FFBIN/ffmpeg.exe")" 4096 3 | tee -a "$LOG"
node "$PIPE/export_cameras.mjs" "$W/dense/sparse_txt/images.txt" "$W/dense/sparse_txt/cameras.txt" "$W/web/cameras.json" | tee -a "$LOG"
node "$PIPE/export_points.mjs" "$W/dense/sparse_txt/points3D.txt" "$W/dense/scene_dense.ply" "$W/web" 1200000 | tee -a "$LOG"

T1=$(date +%s)
node -e '
const fs=require("fs"); const [W,n,secs]=process.argv.slice(1);
const sfm=fs.readFileSync(W+"/sfm_stats.txt","utf8");
const num=(re)=>{const m=sfm.match(re);return m?Number(m[1]):null};
const st={frames_used:+n, registered_images:num(/Registered images:\s*(\d+)/), sparse_points:num(/Points:\s*(\d+)/),
  mean_reproj_error_px:num(/Mean reprojection error:\s*([\d.]+)/), glb_bytes:fs.statSync(W+"/web/room.glb").size,
  dense_ply_bytes:fs.statSync(W+"/dense/scene_dense.ply").size, pipeline_minutes:+(secs/60).toFixed(1),
  poses:"dataset (COLMAP)", date:new Date().toLocaleDateString("en-CA")};
fs.writeFileSync(W+"/web/stats.json",JSON.stringify(st,null,1)); console.log(JSON.stringify(st));
' "$W" "$NIMG" "$((T1-T0))" | tee -a "$LOG"
stage "DONE in $(( (T1-T0)/60 )) min -> $W/web"
