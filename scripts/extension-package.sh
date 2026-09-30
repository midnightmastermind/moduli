#!/usr/bin/env bash
# scripts/extension-package.sh — build the Moduli Companion as an installable .xpi.
#
#   scripts/extension-package.sh          unsigned .xpi, for Firefox Developer Edition /
#                                         Nightly with xpinstall.signatures.required=false
#   scripts/extension-package.sh sign     signed by Mozilla as UNLISTED (private, never on
#                                         the store) — installs permanently in regular Firefox
#
# Signing reads the AMO API key + secret from extension/.sign.env (git-ignored):
#   WEB_EXT_API_KEY=user:12345:67
#   WEB_EXT_API_SECRET=...
# Create them at https://addons.mozilla.org/developers/addon/api/key/
#
# Mozilla refuses to sign the same version twice: bump "version" in
# extension/manifest.json before each `sign`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extension"
OUT="$EXT/dist"
mkdir -p "$OUT"
VERSION="$(node -e "console.log(require('$EXT/manifest.json').version)")"
# Chrome's generated rulesets, docs and local secrets are not part of the add-on.
IGNORE=(_metadata README.md .sign.env dist)

if [[ "${1:-}" == "sign" ]]; then
  [[ -f "$EXT/.sign.env" ]] || { echo "missing extension/.sign.env (WEB_EXT_API_KEY / WEB_EXT_API_SECRET)"; exit 1; }
  set -a; . "$EXT/.sign.env"; set +a
  npm exec --yes web-ext@8 -- sign \
    --channel=unlisted \
    --source-dir "$EXT" \
    --artifacts-dir "$OUT" \
    --ignore-files "${IGNORE[@]}"
  echo "signed .xpi for v$VERSION is in extension/dist/ — drag it into Firefox"
  exit 0
fi

XPI="$OUT/moduli-companion-$VERSION-unsigned.xpi"
rm -f "$XPI"
( cd "$EXT" && zip -qr "$XPI" . -x '_metadata/*' 'README.md' '.sign.env' 'dist/*' )
echo "$XPI"
