#!/usr/bin/env bash
# Publish NammaSpace/site to GitHub Pages (https://<user>.github.io/<repo>/) using the stored git credential.
# Usage: bash deploy.sh [repo-name] ["commit message"]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${1:-namma-space-3d}"
MSG="${2:-Update Namma Space demo}"
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git credential fill 2>/dev/null | sed -n 's/^password=//p')
[ -n "$TOKEN" ] || { echo "No GitHub credential stored"; exit 1; }
api() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }
OWNER=$(api https://api.github.com/user | node -pe 'JSON.parse(require("fs").readFileSync(0)).login')

if [ "$(api -o /dev/null -w '%{http_code}' "https://api.github.com/repos/$OWNER/$REPO")" = 404 ]; then
  echo "Creating public repo $OWNER/$REPO"
  api -X POST https://api.github.com/user/repos \
    -d "{\"name\":\"$REPO\",\"description\":\"Namma Space (Techfest IIT Bombay): smartphone video to 3D room reconstruction + browser roaming\",\"homepage\":\"https://$OWNER.github.io/$REPO/\",\"private\":false,\"has_wiki\":false}" >/dev/null
fi

cd "$ROOT/site"
touch .nojekyll
[ -d .git ] || { git init -q -b main; git remote add origin "https://github.com/$OWNER/$REPO.git"; }
git add -A
git commit -q -m "$MSG" || echo "nothing new to commit"
git push -q -u origin main 2>&1 | grep -v '^remote:' || true

# Enable Pages from main / (idempotent), then wait for the build.
api -X POST "https://api.github.com/repos/$OWNER/$REPO/pages" -d '{"source":{"branch":"main","path":"/"}}' >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  ST=$(api "https://api.github.com/repos/$OWNER/$REPO/pages/builds/latest" | node -pe 'try{JSON.parse(require("fs").readFileSync(0)).status}catch{"?"}')
  echo "pages build: $ST"
  [ "$ST" = built ] && break
  [ "$ST" = errored ] && exit 1
  sleep 10
done
echo "URL: https://$OWNER.github.io/$REPO/"
