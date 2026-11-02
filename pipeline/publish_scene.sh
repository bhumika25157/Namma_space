#!/usr/bin/env bash
# Copy a finished reconstruction into the static site and register it in scenes.json.
# Usage: bash publish_scene.sh <job> <scene id> <kind: real|sample> "<title>" "<subtitle>" "<provenance>" [--default]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JOB="$1"; ID="$2"; KIND="$3"; TITLE="$4"; SUB="$5"; PROV="$6"; DEF="${7:-}"
SRC="$ROOT/work/$JOB/web"
DST="$ROOT/site/assets/$ID"
mkdir -p "$DST"
cp "$SRC/room.glb" "$SRC/cameras.json" "$SRC/stats.json" "$DST/"
SPLAT=0
if [ -f "$SRC/room.splat" ]; then cp "$SRC/room.splat" "$DST/"; SPLAT=1; fi
node -e '
const fs=require("fs"); const [file,id,kind,title,subtitle,provenance,def,splat]=process.argv.slice(1);
const cfg=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{scenes:[]};
cfg.scenes=cfg.scenes.filter(s=>s.id!==id);
const s={id,kind,title,subtitle,provenance,dir:`assets/${id}/`,splat:splat==="1"};
if(def==="--default") cfg.scenes.unshift(s); else cfg.scenes.push(s);
fs.writeFileSync(file,JSON.stringify(cfg,null,2)); console.log(cfg.scenes.map(s=>s.id).join(", "));
' "$ROOT/site/scenes.json" "$ID" "$KIND" "$TITLE" "$SUB" "$PROV" "$DEF" "$SPLAT"
ls -la "$DST"
