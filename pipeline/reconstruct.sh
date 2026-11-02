#!/usr/bin/env bash
# Namma Space - smartphone video/photos -> textured 3D room (GLB) for the web viewer.
# Open-source, CPU-only: ffmpeg -> COLMAP (SfM) -> OpenMVS (MVS, mesh, texture) -> glTF-Transform.
#
# Usage:  bash reconstruct.sh <video file | folder of photos> <job name> [target_frames]
# Output: work/<job>/web/{room.glb,cameras.json,stats.json}  (copied into site/assets/<job>/ by publish step)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/tools"
COLMAP="$TOOLS/colmap/bin/colmap.exe"
MVS="$TOOLS/openmvs/vc17/x64/Release"
FFBIN="$TOOLS/ffmpeg/ffmpeg-master-latest-win64-gpl/bin"
PIPE="$ROOT/pipeline"

INPUT="${1:?input video or photo folder}"
JOB="${2:?job name}"
TARGET="${3:-160}"
W="$ROOT/work/$JOB"
mkdir -p "$W"
LOG="$W/pipeline.log"
win() { cygpath -m "$1"; }
stage() { echo "[$(date +%H:%M:%S)] == $*" | tee -a "$LOG"; }
T0=$(date +%s)

# ---------- 1. Frames ----------
if [ ! -f "$W/.frames_done" ]; then
  rm -rf "$W/images" "$W/frames_all"; mkdir -p "$W/frames_all"
  if [ -d "$INPUT" ]; then
    stage "Copying photos from $INPUT"
    mkdir -p "$W/images"
    find "$INPUT" -maxdepth 1 -type f -iregex '.*\.\(jpg\|jpeg\|png\)' | sort | while read -r f; do cp "$f" "$W/images/"; done
    # HEIC is not readable by COLMAP: convert with ffmpeg if present.
    find "$INPUT" -maxdepth 1 -type f -iname '*.heic' | sort | while read -r f; do
      "$FFBIN/ffmpeg.exe" -hide_banner -loglevel error -y -i "$(win "$f")" -q:v 2 "$(win "$W/images/$(basename "${f%.*}").jpg")"; done
  else
    DUR=$("$FFBIN/ffprobe.exe" -v error -show_entries format=duration -of csv=p=0 "$(win "$INPUT")")
    # ~3 candidates per kept frame, capped at 15 fps.
    FPS=$(node -e "console.log(Math.min(15, Math.max(1, Math.ceil($TARGET*3/$DUR))))")
    stage "Extracting frames: duration=${DUR}s candidate_fps=$FPS target=$TARGET"
    # Longest side 1600 px; blurdetect scores every frame (cwd-relative file: Windows drive colons break filter args).
    (cd "$W" && "$FFBIN/ffmpeg.exe" -hide_banner -loglevel error -y -i "$(win "$INPUT")" \
      -vf "fps=$FPS,scale='if(gte(iw,ih),min(1600,iw),-2)':'if(gte(iw,ih),-2,min(1600,ih))',blurdetect=block_width=32:block_height=32,metadata=mode=print:file=blur.txt" \
      -q:v 2 frames_all/f_%05d.jpg)
    node "$PIPE/select_frames.mjs" "$W/blur.txt" "$W/frames_all" "$W/images" "$TARGET" | tee -a "$LOG"
  fi
  touch "$W/.frames_done"
fi
NIMG=$(ls "$W/images" | wc -l)
stage "Images ready: $NIMG"

# ---------- 2. COLMAP structure-from-motion ----------
if [ ! -f "$W/.sfm_done" ]; then
  rm -rf "$W/database.db" "$W/sparse"; mkdir -p "$W/sparse"
  stage "COLMAP feature extraction (SIFT, CPU)"
  "$COLMAP" feature_extractor --database_path "$(win "$W/database.db")" --image_path "$(win "$W/images")" \
    --ImageReader.single_camera 1 --ImageReader.camera_model SIMPLE_RADIAL \
    --FeatureExtraction.use_gpu 0 --FeatureExtraction.max_image_size 1600 \
    --SiftExtraction.max_num_features 6000 --log_level 1 >>"$LOG" 2>&1
  if [ -d "$INPUT" ]; then
    stage "COLMAP exhaustive matching (photo set)"
    "$COLMAP" exhaustive_matcher --database_path "$(win "$W/database.db")" --FeatureMatching.use_gpu 0 >>"$LOG" 2>&1
  else
    stage "COLMAP sequential matching + loop detection (video)"
    "$COLMAP" sequential_matcher --database_path "$(win "$W/database.db")" --FeatureMatching.use_gpu 0 \
      --SequentialMatching.overlap 15 --SequentialMatching.loop_detection 1 >>"$LOG" 2>&1 \
    || { stage "loop detection unavailable - plain sequential matching";
         "$COLMAP" sequential_matcher --database_path "$(win "$W/database.db")" --FeatureMatching.use_gpu 0 \
           --SequentialMatching.overlap 25 >>"$LOG" 2>&1; }
  fi
  stage "COLMAP incremental mapping"
  "$COLMAP" mapper --database_path "$(win "$W/database.db")" --image_path "$(win "$W/images")" \
    --output_path "$(win "$W/sparse")" --log_level 1 >>"$LOG" 2>&1
  touch "$W/.sfm_done"
fi

# Largest sub-model wins (COLMAP may split a capture into several).
BEST=$(for d in "$W"/sparse/*/; do echo "$(stat -c %s "$d/images.bin") $d"; done | sort -nr | head -1 | cut -d' ' -f2-)
stage "Best sparse model: $BEST"
"$COLMAP" model_analyzer --path "$(win "$BEST")" 2>&1 | grep -E 'Registered images|Points|Mean reprojection|Cameras' | sed 's/^.*\] //' | tee -a "$LOG" "$W/sfm_stats.txt"

# ---------- 3. Gravity alignment + undistortion ----------
if [ ! -f "$W/.undist_done" ]; then
  rm -rf "$W/aligned" "$W/dense"; mkdir -p "$W/aligned"
  stage "Gravity alignment (camera-upright prior)"
  "$COLMAP" model_orientation_aligner --image_path "$(win "$W/images")" --input_path "$(win "$BEST")" \
    --output_path "$(win "$W/aligned")" --method IMAGE-ORIENTATION >>"$LOG" 2>&1
  stage "Undistorting images"
  "$COLMAP" image_undistorter --image_path "$(win "$W/images")" --input_path "$(win "$W/aligned")" \
    --output_path "$(win "$W/dense")" --output_type COLMAP --max_image_size 1600 >>"$LOG" 2>&1
  mkdir -p "$W/dense/sparse_txt"
  "$COLMAP" model_converter --input_path "$(win "$W/dense/sparse")" --output_path "$(win "$W/dense/sparse_txt")" --output_type TXT >>"$LOG" 2>&1
  touch "$W/.undist_done"
fi

# ---------- 3b. Optional Gaussian splats (Brush, GPU via wgpu) in parallel with CPU-bound OpenMVS ----------
SPLAT_STEPS="${SPLAT_STEPS:-0}"
BRUSH_PID=""
if [ "$SPLAT_STEPS" -gt 0 ] && [ ! -f "$W/splat/room.ply" ]; then
  stage "Brush: training Gaussian splats ($SPLAT_STEPS steps) in background"
  mkdir -p "$W/splat"
  (cd "$W/splat" && "$TOOLS/brush/brush_app.exe" "$(win "$W/dense")" --total-steps "$SPLAT_STEPS" --max-resolution 1280 \
     --max-splats 1500000 --export-every "$SPLAT_STEPS" --export-path "$(win "$W/splat")" --export-name room.ply \
     --eval-every 1000000 >"$W/splat/brush.log" 2>&1) &
  BRUSH_PID=$!
fi

# ---------- 4. OpenMVS dense reconstruction, meshing, texturing ----------
cd "$W/dense"
if [ ! -f scene.mvs ]; then
  stage "OpenMVS: import COLMAP scene"
  "$MVS/InterfaceCOLMAP.exe" -i . -o scene.mvs --image-folder images/ -v 1 >>"$LOG" 2>&1
fi
if [ ! -f scene_dense.mvs ]; then
  stage "OpenMVS: dense depth-map fusion (CPU, half resolution)"
  "$MVS/DensifyPointCloud.exe" scene.mvs --resolution-level "${DENSE_LEVEL:-1}" --number-views 6 -v 1 >>"$LOG" 2>&1
fi
if [ ! -f scene_dense_mesh.ply ]; then
  stage "OpenMVS: Delaunay/graph-cut surface reconstruction"
  "$MVS/ReconstructMesh.exe" scene_dense.mvs -p scene_dense.ply -o scene_dense_mesh.ply -v 1 >>"$LOG" 2>&1
fi
if [ ! -f scene_textured.glb ]; then
  stage "OpenMVS: texturing -> GLB"
  "$MVS/TextureMesh.exe" scene_dense.mvs -m scene_dense_mesh.ply -o scene_textured.glb --export-type glb \
    --decimate 0.6 --max-texture-size 4096 --empty-color 3355443 \
    --global-seam-leveling 0 --local-seam-leveling 0 -v 1 >>"$LOG" 2>&1  # seam leveling yields black patches in this build
fi

# ---------- 5. Web export ----------
stage "Optimising GLB for the web (embedded JPEG textures + meshopt)"
mkdir -p "$W/web"
cd "$ROOT/pipeline"
# OpenMVS writes textures as external PNGs next to the GLB; web_glb.mjs embeds them (ffmpeg JPEG, no sharp).
node web_glb.mjs "$(win "$W/dense/scene_textured.glb")" "$(win "$W/web/room.glb")" "$(win "$FFBIN/ffmpeg.exe")" 4096 3 | tee -a "$LOG"
node "$PIPE/export_cameras.mjs" "$W/dense/sparse_txt/images.txt" "$W/dense/sparse_txt/cameras.txt" "$W/web/cameras.json" | tee -a "$LOG"
if [ -n "$BRUSH_PID" ]; then stage "Waiting for Brush splat training"; wait "$BRUSH_PID" || true; fi
if [ -f "$W/splat/room.ply" ]; then
  node "$PIPE/ply2splat.mjs" "$W/splat/room.ply" "$W/web/room.splat" 700000 | tee -a "$LOG"
fi

T1=$(date +%s)
node -e '
const fs=require("fs"); const [W,n,secs]=process.argv.slice(1);
const sfm=fs.readFileSync(W+"/sfm_stats.txt","utf8");
const num=(re)=>{const m=sfm.match(re);return m?Number(m[1]):null};
const st={frames_used:+n, registered_images:num(/Registered images:\s*(\d+)/), sparse_points:num(/Points:\s*(\d+)/),
  mean_reproj_error_px:num(/Mean reprojection error:\s*([\d.]+)/), glb_bytes:fs.statSync(W+"/web/room.glb").size,
  dense_ply_bytes:fs.statSync(W+"/dense/scene_dense.ply").size, pipeline_minutes:+(secs/60).toFixed(1),
  date:new Date().toLocaleDateString("en-CA")};
fs.writeFileSync(W+"/web/stats.json",JSON.stringify(st,null,1)); console.log(JSON.stringify(st));
' "$W" "$NIMG" "$((T1-T0))" | tee -a "$LOG"
stage "DONE in $(( (T1-T0)/60 )) min -> $W/web"
