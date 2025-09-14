#!/usr/bin/env bash
set -euo pipefail

echo "YouTube Super Thanks Scraper - Runner (POSIX)"

# 0) Node?
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install from https://nodejs.org/ and retry."
  exit 1
fi

# 1) Script present?
if [ ! -f "superthanks.js" ]; then
  echo "[ERROR] superthanks.js not found in the current directory."
  exit 1
fi

# 2) npm project?
if [ ! -f "package.json" ]; then
  read -r -p "package.json not found. Initialize npm project? [Y/n] " CREATE_NPM
  if [[ "${CREATE_NPM:-Y}" =~ ^[Yy]$ ]]; then
    npm init -y
  fi
fi

# 3) puppeteer installed?
if [ ! -d "node_modules/puppeteer" ]; then
  read -r -p "Puppeteer not installed. Install now? [Y/n] " INSTALL_PUP
  if [[ "${INSTALL_PUP:-Y}" =~ ^[Yy]$ ]]; then
    npm i puppeteer
  else
    echo "[WARN] Without Puppeteer the script will fail."
  fi
fi

echo
echo "================== SETTINGS =================="
echo "Leave blank to accept defaults. [*] required."
echo

# URL (required)
read -r -p "[*] YouTube Video URL: " URL_INPUT
while [ -z "${URL_INPUT}" ]; do
  echo "[WARN] URL is required."
  read -r -p "[*] YouTube Video URL: " URL_INPUT
done

# Defaults
read -r -p "Scroll duration in seconds [25]: " SECONDS
SECONDS=${SECONDS:-25}

read -r -p "Minimum comment blocks before early stop [0]: " MIN
MIN=${MIN:-0}

read -r -p "Output file prefix [out/super-thanks]: " OUT
OUT=${OUT:-out/super-thanks}

read -r -p "Show browser (headful) [y/N]: " HEADFUL
HEADFUL=${HEADFUL:-N}
if [[ "${HEADFUL}" =~ ^[Yy]$ ]]; then
  HEADFUL_FLAG="--headful"
else
  HEADFUL_FLAG=""
fi

# Ensure output directory exists
OUTDIR=$(dirname "$OUT")
if [ ! -d "$OUTDIR" ]; then
  echo "[INFO] Creating output directory: $OUTDIR"
  mkdir -p "$OUTDIR"
fi

echo
echo "================== SUMMARY =================="
echo "URL       : $URL_INPUT"
echo "seconds   : $SECONDS"
echo "min       : $MIN"
echo "out       : $OUT"
echo "headful   : $HEADFUL"
echo "============================================="
echo

echo "[INFO] Running..."
# Always quote the URL to prevent shell from interpreting '&'
node "superthanks.js" "$URL_INPUT" --seconds "$SECONDS" --min "$MIN" --out "$OUT" $HEADFUL_FLAG
echo
echo "[DONE]"
