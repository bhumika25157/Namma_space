# NammaSpace: Round 1 prototype (Techfest, IIT Bombay)

Indoor photographs → 3D reconstruction → explorable web digital twin (orbit, zoom, first-person WASD walking with collision, minimap).

**Demo video (4:39, 1080p, narrated):** download from [Releases](https://github.com/bhumika25157/Namma_space/releases/latest): `NammaSpace_Round1_Demo.mp4` (full quality, 221 MB) or `NammaSpace_Round1_Demo_compact.mp4` (56 MB). Videos are kept out of the git history because GitHub limits files to 100 MB.

**Web viewer online:** https://bhumika25157.github.io/Namma_space/ (served from the `gh-pages` branch, a copy of `site/`)

**Open it on your own computer:** see [HOW_TO_OPEN.md](HOW_TO_OPEN.md).

## Dataset (public, not our own capture)
Deep Blending, "Dr Johnson" scene: 263 photographs of a historic house interior, with COLMAP camera poses.
- Paper: P. Hedman et al., *Deep Blending for Free-Viewpoint Image-Based Rendering*, SIGGRAPH Asia 2018.
- Download used: `tandt_db.zip` from the 3D Gaussian Splatting release (Kerbl et al., 2023):
  https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/datasets/input/tandt_db.zip (folder `db/drjohnson`)

## What's in this package
`site/` web viewer + reconstructed model · `pipeline/` reconstruction scripts · `video/` scripts that made the demo video (narration audio and slide assets included) · `docs/` · `capture/` the earlier smartphone test clip. The demo videos are attached to the GitHub Release.

Left out to keep the size down (all re-downloadable or regenerable): tool binaries (`tools/`, 1.1 GB), the dataset (`datasets/`, 1 GB), intermediate reconstruction files (`work/`, 3.3 GB), npm packages.

## Setup on a new machine
- **Viewer only:** just Node.js 18+ (no `npm install` needed). Any static web server also works.
- **Rebuild / re-record (Windows + Git Bash):**
  1. `npm install` in `pipeline/` and in `video/`.
  2. Unpack into `tools/`: COLMAP 4.2 Windows no-CUDA build → `tools/colmap/` (https://github.com/colmap/colmap/releases), OpenMVS 2.4 Windows release → `tools/openmvs/vc17/x64/Release/` (https://github.com/cdcseacave/openMVS/releases), FFmpeg win64 GPL build → `tools/ffmpeg/ffmpeg-master-latest-win64-gpl/` (https://github.com/BtbN/FFmpeg-Builds/releases).
  3. Unzip the dataset (link below) so that `datasets/deepblending/db/drjohnson/{images,sparse}` exists.
  4. Re-recording also needs Google Chrome (set `CHROME=<path>` if it isn't in the default location) and internet access for the TTS voice.

## Run the viewer locally
```
node video/serve.mjs site 8765
```
Open http://localhost:8765/?scene=drjohnson
- **Explore**: drag = orbit · wheel = zoom (to cursor) · right-drag = pan · double-click = focus
- **Walk**: W A S D = move · drag = look · Shift = run · Q/E = down/up · M = minimap · K = input overlay
- **Layers**: Sparse / Dense / Mesh / Textured · **F** = fullscreen · **About** = data source + run statistics

## Rebuild the reconstruction (Windows, CPU only; tools in `tools/`)
```
bash pipeline/reconstruct_posed.sh datasets/deepblending/db/drjohnson drjohnson   # OpenMVS densify → mesh → texture → GLB
bash pipeline/publish_drjohnson.sh                                                 # copy into site/ and register the scene
```
The phone-video pipeline from the earlier capture is `pipeline/reconstruct.sh <video> <job>`.

## Re-record the video
```
cd video && node tts.mjs DENSE_M=<millions> && node record.mjs all && node assemble.mjs
```
`record.mjs` drives the real viewer in headless Chrome (GPU) with a virtual 30 fps clock and real mouse/keyboard events. Narration is neural TTS (Edge voice "Andrew").
