#!/usr/bin/env bash
#
# migrate2omniroute.sh — One-shot 9router → OmniRoute migration for headless servers.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/javad7z7/migrate2omniroute/main/scripts/migrate2omniroute.sh | bash
#   — or —
#   ./migrate2omniroute.sh [--source PATH] [--target DIR] [--mode json|sql|inject|all]
#
# What it does:
#   1. Checks for node + npm (installs via apt if missing, with permission)
#   2. Clones the migrate2omniroute repo to a temp dir (or uses existing)
#   3. npm installs better-sqlite3
#   4. Auto-detects 9router data.sqlite (common paths)
#   5. Runs migration, prints result, cleans up
#
set -euo pipefail

REPO="https://github.com/javad7z7/migrate2omniroute.git"
WORKDIR=""

# ── Colors ────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BLUE=''; NC=''
fi
info()  { echo -e "${BLUE}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }
die()   { err "$*"; exit 1; }

# ── Args ──────────────────────────────────────────────────────
SOURCE=""
TARGET=""
MODE="json"
KEEP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--source) SOURCE="$2"; shift 2 ;;
    -t|--target) TARGET="$2"; shift 2 ;;
    -m|--mode)   MODE="$2"; shift 2 ;;
    --keep)      KEEP=true; shift ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) die "Unknown arg: $1 (use --help)" ;;
  esac
done

# ── Detect 9router ────────────────────────────────────────────
detect_9router() {
  local candidates=(
    "$HOME/.9router/db/data.sqlite"
    "/opt/9router/data/db/data.sqlite"
    "/var/lib/9router/db/data.sqlite"
    "$HOME/.config/9router/db/data.sqlite"
  )
  for p in "${candidates[@]}"; do
    [[ -f "$p" ]] && { echo "$p"; return 0; }
  done
  return 1
}

# ── Detect OmniRoute ──────────────────────────────────────────
detect_omniroute() {
  local candidates=(
    "$HOME/.omniroute"
    "/opt/omniroute/data"
    "/var/lib/omniroute"
    "$HOME/.config/omniroute"
  )
  for p in "${candidates[@]}"; do
    [[ -d "$p" ]] && { echo "$p"; return 0; }
  done
  echo "$HOME/.omniroute"   # default even if missing
}

# ── Ensure node ───────────────────────────────────────────────
ensure_node() {
  if command -v node &>/dev/null && command -v npm &>/dev/null; then
    local ver
    ver=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$ver" -ge 18 ]]; then
      ok "node $(node --version) found"
      return 0
    fi
    warn "node $(node --version) is too old (need v18+)"
  fi

  warn "Node.js v18+ not found"
  if command -v apt-get &>/dev/null; then
    read -rp "Install Node.js 20 via apt? [Y/n] " ans
    if [[ "${ans:-Y}" =~ ^[Yy]?$ ]]; then
      info "Installing Node.js..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
      ok "node $(node --version) installed"
      return 0
    fi
  fi
  die "Please install Node.js v18+ manually: https://nodejs.org/"
}

# ── Main ──────────────────────────────────────────────────────
echo ""
echo "  9router → OmniRoute migration (headless)"
echo "  ─────────────────────────────────────────"
echo ""

ensure_node

# Resolve source
if [[ -z "$SOURCE" ]]; then
  info "Auto-detecting 9router..."
  if SOURCE=$(detect_9router); then
    ok "Found: $SOURCE"
  else
    die "Could not find 9router data.sqlite. Specify with --source PATH"
  fi
fi
[[ -f "$SOURCE" ]] || die "Source not found: $SOURCE"

# Resolve target
if [[ -z "$TARGET" ]]; then
  TARGET=$(detect_omniroute)
  info "Target: $TARGET"
fi

# Workspace
WORKDIR=$(mktemp -d /tmp/m2o.XXXXXX)
trap '$KEEP || rm -rf "$WORKDIR"' EXIT

info "Cloning migrate2omniroute..."
git clone --depth 1 "$REPO" "$WORKDIR/repo" 2>&1 | tail -1

cd "$WORKDIR/repo"
info "Installing dependencies..."
npm install --no-audit --no-fund 2>&1 | tail -1

echo ""
info "Running migration (mode: $MODE)..."
echo ""
node scripts/migrate-cli.js --source "$SOURCE" --target "$TARGET" --mode "$MODE"

echo ""
ok "Migration finished."

case "$MODE" in
  json|all)
    echo ""
    info "Next step: restart OmniRoute — it will auto-import db.json from $TARGET"
    ;;
  sql)
    echo ""
    info "Next step: sqlite3 $TARGET/db/data.sqlite < $TARGET/omniroute_inject.sql"
    ;;
esac
