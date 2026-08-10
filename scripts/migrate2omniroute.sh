#!/usr/bin/env bash
# Interactive 9router → OmniRoute bootstrap + migration for Linux servers.
# Run: curl -fsSLO https://raw.githubusercontent.com/javad7z7/migrate2omniroute/main/scripts/migrate2omniroute.sh && bash migrate2omniroute.sh
set -Eeuo pipefail
umask 077

REPO_URL="${M2O_REPO_URL:-https://github.com/javad7z7/migrate2omniroute.git}"
M2O_HOME="${M2O_HOME:-$HOME/.migrate2omniroute}"
RUNS_DIR="${M2O_RUNS_DIR:-$M2O_HOME/runs}"
OMNIROUTE_DIR="${OMNIROUTE_INSTALL_DIR:-$HOME/omniroute-m2o}"
OMNIROUTE_IMAGE="${OMNIROUTE_IMAGE:-diegosouzapw/omniroute:latest}"
OMNIROUTE_CONTAINER="${OMNIROUTE_CONTAINER_NAME:-omniroute-m2o}"
OMNIROUTE_DATA_DIR="${OMNIROUTE_DATA_DIR:-$OMNIROUTE_DIR/data}"
DEFAULT_OMNIROUTE_PORT="${OMNIROUTE_PORT:-20128}"
OMNIROUTE_INTERNAL_PORT=20128
NODE_BIN="${NODE_BIN:-node}"
SQLITE3_BIN="${SQLITE3_BIN:-sqlite3}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
YES=false
NON_INTERACTIVE=false
INSTALL_OMNIROUTE=false
SOURCE_DB=""
SOURCE_JSON=""
TARGET_DB=""
BACKUP_SOURCE=""
BACKUP_KIND=""
REQUESTED_PORT=""
RUN_DIR=""
WORKDIR=""
STARTED_NEW_OMNIROUTE=false
TARGET_CONTAINER=""
TARGET_CONTAINER_WAS_RUNNING=false
SOURCE_CONTAINER_TO_RESTART=""
SOURCE_CONTAINER_STOPPED=false

info() { printf '\n==> %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
restore_source_container() {
  if [[ "$SOURCE_CONTAINER_STOPPED" == true ]]; then
    "$DOCKER_BIN" start "$SOURCE_CONTAINER_TO_RESTART" >/dev/null 2>&1 || warn "Could not restart container '$SOURCE_CONTAINER_TO_RESTART'; start it manually."
    SOURCE_CONTAINER_STOPPED=false
    SOURCE_CONTAINER_TO_RESTART=""
  fi
}
cleanup() {
  restore_source_container
  [[ -n "$WORKDIR" && -d "$WORKDIR" ]] && rm -rf "$WORKDIR" || true
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Interactive 9router → OmniRoute migration

Usage:
  bash migrate2omniroute.sh [options]

Options:
  --source PATH             9router SQLite file (or container:/absolute/path)
  --json PATH               Existing 9router dashboard JSON backup
  --target-db PATH          Existing OmniRoute storage.sqlite target
  --install-omniroute       Install a separate OmniRoute Docker container
  --port PORT               Host dashboard port for a new OmniRoute install
  --yes                     Accept normal confirmations (never port collisions)
  --non-interactive         Fail instead of asking for missing choices
  -h, --help                Show this help

The script creates private, timestamped backups under ~/.migrate2omniroute/runs.
EOF
}

confirm() {
  local prompt="$1" answer
  if "$YES"; then return 0; fi
  "$NON_INTERACTIVE" && return 1
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

need_sudo() {
  if [[ $EUID -eq 0 ]]; then printf '%s' ''; return; fi
  command -v sudo >/dev/null 2>&1 || die "This action needs administrator access. Re-run as root or install the required package manually."
  printf '%s' 'sudo'
}

install_packages() {
  local label="$1"; shift
  local sudo_cmd
  sudo_cmd="$(need_sudo)"
  warn "$label is required: $*"
  confirm "Install the missing package(s) now?" || die "Cancelled. Install '$*' and run the script again."
  if command -v apt-get >/dev/null 2>&1; then
    $sudo_cmd apt-get update
    $sudo_cmd apt-get install -y "$@"
  elif command -v dnf >/dev/null 2>&1; then
    $sudo_cmd dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then
    $sudo_cmd yum install -y "$@"
  elif command -v pacman >/dev/null 2>&1; then
    $sudo_cmd pacman -Sy --noconfirm "$@"
  elif command -v brew >/dev/null 2>&1; then
    brew install "$@"
  else
    die "No supported package manager found. Install $label manually and re-run."
  fi
}

ensure_node() {
  if command -v "$NODE_BIN" >/dev/null 2>&1; then
    local major
    major="$($NODE_BIN -p 'process.versions.node.split(".")[0]')"
    [[ "$major" -ge 18 ]] && return
    warn "Node.js $major is too old; Node.js 18+ is required."
  fi
  install_packages "Node.js 18+" nodejs npm
  command -v "$NODE_BIN" >/dev/null 2>&1 || die "Node.js installation did not provide '$NODE_BIN'."
  local major
  major="$($NODE_BIN -p 'process.versions.node.split(".")[0]')"
  [[ "$major" -ge 18 ]] || die "Installed Node.js is v$major; install Node.js 18+ manually and retry."
}

ensure_sqlite() {
  command -v "$SQLITE3_BIN" >/dev/null 2>&1 && return
  install_packages "sqlite3" sqlite3
  command -v "$SQLITE3_BIN" >/dev/null 2>&1 || die "sqlite3 installation failed."
}

ensure_docker() {
  if ! command -v "$DOCKER_BIN" >/dev/null 2>&1 || ! "$DOCKER_BIN" info >/dev/null 2>&1; then
    install_packages "Docker Engine" docker.io
  fi
  command -v "$DOCKER_BIN" >/dev/null 2>&1 || die "Docker installation failed."
  "$DOCKER_BIN" info >/dev/null 2>&1 || die "Docker is installed but unavailable to this user. Start Docker or add this user to the docker group, then sign in again."
  if ! "$DOCKER_BIN" compose version >/dev/null 2>&1; then
    install_packages "Docker Compose plugin" docker-compose-plugin
  fi
  "$DOCKER_BIN" compose version >/dev/null 2>&1 || die "Docker Compose plugin is unavailable. Install it, then re-run."
}

port_is_free() {
  local port="$1"
  if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$port" | grep -q LISTEN; then return 1; fi
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then return 1; fi
  if command -v "$DOCKER_BIN" >/dev/null 2>&1 && "$DOCKER_BIN" ps --format '{{.Ports}}' | grep -Eq "(^|[, ])(0\.0\.0\.0:|:::)?${port}->"; then return 1; fi
  return 0
}

choose_port() {
  local port="${REQUESTED_PORT:-$DEFAULT_OMNIROUTE_PORT}"
  if ! port_is_free "$port"; then
    [[ -n "$REQUESTED_PORT" ]] && die "Requested port $port is already in use. Choose another port."
    for port in $(seq 20129 20150); do port_is_free "$port" && break; done
  fi
  port_is_free "$port" || die "Could not find a free port in 20128–20150. Use --port PORT."
  if ! "$NON_INTERACTIVE"; then
    printf 'Proposed OmniRoute dashboard port: %s\n' "$port" >&2
    read -r -p 'Press Enter to accept, or type another port: ' answer
    [[ -n "${answer:-}" ]] && port="$answer"
    [[ "$port" =~ ^[0-9]{2,5}$ ]] || die "Invalid port."
    port_is_free "$port" || die "Port $port is already in use."
  fi
  printf '%s' "$port"
}

make_run_dir() {
  RUN_DIR="$RUNS_DIR/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$RUN_DIR/migration-output"
  chmod 755 "$M2O_HOME" "$RUNS_DIR" "$RUN_DIR" "$RUN_DIR/migration-output" 2>/dev/null || true
  : > "$RUN_DIR/migration.log"
  chmod 644 "$RUN_DIR/migration.log" 2>/dev/null || true
  ok "Run workspace: $RUN_DIR"
}
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$RUN_DIR/migration.log"; }

backup_sqlite() {
  local source="$1" backup="$RUN_DIR/9router-backup.sqlite"
  ensure_sqlite
  "$SQLITE3_BIN" "$source" ".backup '$backup'"
  [[ "$($SQLITE3_BIN "$backup" 'PRAGMA integrity_check;' | tail -n1)" == "ok" ]] || die "9router backup integrity check failed."
  chmod 600 "$backup"
  log "Created verified 9router SQLite backup: $backup"
  BACKUP_SOURCE="$backup"
  BACKUP_KIND="sqlite"
}

backup_json() {
  local source="$1" backup="$RUN_DIR/9router-backup.json"
  ensure_node
  "$NODE_BIN" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$source" || die "Source JSON is invalid."
  cp "$source" "$backup"; chmod 600 "$backup"
  log "Created validated 9router JSON backup: $backup"
  BACKUP_SOURCE="$backup"
  BACKUP_KIND="json"
}

backup_container_sqlite() {
  local container="$1" dbpath="$2" backup="$RUN_DIR/9router-backup.sqlite" was_running=false
  local copy_dir="$RUN_DIR/.container-copy"
  ensure_docker; ensure_sqlite
  [[ "$dbpath" == /* ]] || die "Container database path must be absolute: $dbpath"
  was_running="$($DOCKER_BIN inspect -f '{{.State.Running}}' "$container")"
  if [[ "$was_running" == true ]] && ! "$DOCKER_BIN" exec "$container" test -f "$dbpath" >/dev/null 2>&1; then
    die "Container path is not a regular SQLite file: $container:$dbpath. Enter the file path (for example /app/data/data.sqlite), not its parent directory."
  fi

  if [[ "$was_running" == true ]]; then
    confirm "To create a consistent SQLite backup, stop 9router container '$container' briefly?" || die "A consistent container database backup requires stopping the source briefly. Use --json with a dashboard backup instead."
    "$DOCKER_BIN" stop --time 40 "$container" >/dev/null
    SOURCE_CONTAINER_TO_RESTART="$container"
    SOURCE_CONTAINER_STOPPED=true
  fi

  # Stream Docker's tar archive to a host-created file. Extracting directly
  # into a directory can fail after a successful transfer when docker cp tries
  # to preserve restrictive container ownership/modes (common on rootless
  # Docker and UID-mapped containers).
  rm -rf -- "$copy_dir"
  mkdir -p -- "$copy_dir"
  if ! "$DOCKER_BIN" cp "$container:$dbpath" - | tar -xOf - > "$backup"; then
    rm -f -- "$backup"
    die "Could not stream $dbpath from container $container. Verify it is a regular SQLite file and that Docker can read it."
  fi
  [[ -s "$backup" ]] || die "Container database copy is empty: $container:$dbpath"
  chmod 600 "$backup"
  [[ "$($SQLITE3_BIN "$backup" 'PRAGMA integrity_check;' | tail -n1)" == "ok" ]] || die "Container backup integrity check failed."
  log "Created verified backup from container $container:$dbpath"
  BACKUP_SOURCE="$backup"
  BACKUP_KIND="sqlite"
  restore_source_container
}

choose_source() {
  if [[ -n "$SOURCE_JSON" ]]; then [[ -f "$SOURCE_JSON" ]] || die "JSON source not found: $SOURCE_JSON"; backup_json "$SOURCE_JSON"; return; fi
  if [[ -n "$SOURCE_DB" ]]; then
    if [[ "$SOURCE_DB" == *:* && "$SOURCE_DB" != /* ]]; then backup_container_sqlite "${SOURCE_DB%%:*}" "${SOURCE_DB#*:}"; else [[ -f "$SOURCE_DB" ]] || die "SQLite source not found: $SOURCE_DB"; backup_sqlite "$SOURCE_DB"; fi
    return
  fi
  "$NON_INTERACTIVE" && die "Specify --source or --json in non-interactive mode."
  local candidates=("$HOME/.9router/db/data.sqlite" "/opt/9router/data/db/data.sqlite" "/var/lib/9router/db/data.sqlite" "$HOME/.config/9router/db/data.sqlite")
  local found=() p
  for p in "${candidates[@]}"; do [[ -f "$p" ]] && found+=("$p"); done
  printf '\nChoose 9router source:\n'
  local i=1
  for p in "${found[@]}"; do printf '  %d) Local SQLite: %s\n' "$i" "$p"; ((i++)); done
  printf '  %d) Enter a local SQLite path\n' "$i"; local manual_db="$i"; ((i++))
  printf '  %d) Enter a dashboard JSON backup path\n' "$i"; local manual_json="$i"; ((i++))
  printf '  %d) Enter Docker container and database path\n' "$i"; local docker_choice="$i"
  read -r -p 'Selection: ' answer
  if [[ "$answer" =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= ${#found[@]} )); then backup_sqlite "${found[answer-1]}"
  elif [[ "$answer" == "$manual_db" ]]; then read -r -p 'SQLite path: ' p; [[ -f "$p" ]] || die "File not found."; backup_sqlite "$p"
  elif [[ "$answer" == "$manual_json" ]]; then read -r -p 'JSON backup path: ' p; [[ -f "$p" ]] || die "File not found."; backup_json "$p"
  elif [[ "$answer" == "$docker_choice" ]]; then read -r -p 'Container name: ' c; read -r -p 'Database path inside container: ' p; backup_container_sqlite "$c" "$p"
  else die "Invalid selection."; fi
}

get_compose_content() {
  local port="$1"
  cat <<EOF
services:
  omniroute:
    image: ${OMNIROUTE_IMAGE}
    container_name: ${OMNIROUTE_CONTAINER}
    restart: unless-stopped
    stop_grace_period: 40s
    environment:
      DATA_DIR: /app/data
      PORT: ${OMNIROUTE_INTERNAL_PORT}
      DASHBOARD_PORT: ${OMNIROUTE_INTERNAL_PORT}
      API_PORT: 20129
      LIVE_WS_PORT: 20132
      API_HOST: 0.0.0.0
      LIVE_WS_HOST: 0.0.0.0
      LIVE_WS_ALLOWED_ORIGINS: http://localhost:${port},http://127.0.0.1:${port}
    ports:
      - "${port}:${OMNIROUTE_INTERNAL_PORT}"
    volumes:
      - ${OMNIROUTE_DATA_DIR}:/app/data
EOF
}

write_compose() {
  local port="$1" target_file="$OMNIROUTE_DIR/compose.yml" tmp_file="$OMNIROUTE_DIR/compose.yml.tmp"
  mkdir -p "$OMNIROUTE_DIR" "$OMNIROUTE_DATA_DIR"
  chmod 755 "$OMNIROUTE_DIR" "$OMNIROUTE_DATA_DIR" || true
  get_compose_content "$port" > "$tmp_file"
  chmod 644 "$tmp_file"
  mv -f "$tmp_file" "$target_file"
  chmod 644 "$target_file"
}

wait_for_omniroute() {
  local tries=30 status
  while ((tries--)); do
    status="$($DOCKER_BIN inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}running{{else}}stopped{{end}}{{end}}' "$OMNIROUTE_CONTAINER" 2>/dev/null || true)"
    [[ "$status" == healthy ]] && return
    [[ "$status" == stopped || -z "$status" ]] && break
    sleep 2
  done
  $DOCKER_BIN logs --tail 80 "$OMNIROUTE_CONTAINER" >&2 || true
  die "OmniRoute did not become healthy. Its new data directory is preserved at $OMNIROUTE_DATA_DIR."
}

install_omniroute() {
  ensure_docker
  local port; port="$(choose_port)"
  info "New OmniRoute installation"
  printf '  Image: %s\n  Install directory: %s\n  Data directory: %s\n  Dashboard: http://SERVER_IP:%s\n' "$OMNIROUTE_IMAGE" "$OMNIROUTE_DIR" "$OMNIROUTE_DATA_DIR" "$port"
  confirm "Pull and start this separate OmniRoute container?" || die "Cancelled before OmniRoute installation."
  write_compose "$port"
  local compose_content
  compose_content="$(get_compose_content "$port")"
  if ! printf '%s\n' "$compose_content" | $DOCKER_BIN compose -p "$OMNIROUTE_CONTAINER" -f - up -d >/dev/null 2>&1; then
    if ! $DOCKER_BIN compose -f "$OMNIROUTE_DIR/compose.yml" up -d; then
      die "Failed to start OmniRoute container via Docker Compose."
    fi
  fi
  STARTED_NEW_OMNIROUTE=true
  wait_for_omniroute
  TARGET_DB="$OMNIROUTE_DATA_DIR/storage.sqlite"
  [[ -f "$TARGET_DB" ]] || die "OmniRoute is healthy but storage.sqlite was not created at expected path: $TARGET_DB"
  log "Installed new OmniRoute at http://SERVER_IP:$port"
}

choose_existing_target() {
  if [[ -n "$TARGET_DB" ]]; then [[ -f "$TARGET_DB" ]] || die "Target DB not found: $TARGET_DB"; return; fi
  local candidates=(
    "$HOME/.omniroute/storage.sqlite"
    "$HOME/.omniroute/db/data.sqlite"
    "$HOME/.omniroute-m2o/data/storage.sqlite"
    "$HOME/omniroute/data/storage.sqlite"
    "/var/lib/omniroute/data/storage.sqlite"
    "/opt/omniroute/data/storage.sqlite"
    "$OMNIROUTE_DATA_DIR/storage.sqlite"
  )
  local found=() p
  for p in "${candidates[@]}"; do [[ -f "$p" ]] && found+=("$p"); done
  "$NON_INTERACTIVE" && die "Specify --target-db for an existing OmniRoute installation."
  ((${#found[@]})) || die "Could not locate OmniRoute data. Start OmniRoute once, pass --target-db, or select the install option."
  if ((${#found[@]} == 1)); then TARGET_DB="${found[0]}"; else
    printf '\nChoose OmniRoute database:\n'; local i=1; for p in "${found[@]}"; do printf '  %d) %s\n' "$i" "$p"; ((i++)); done
    read -r -p 'Selection: ' answer; [[ "$answer" =~ ^[0-9]+$ ]] && ((answer>=1 && answer<=${#found[@]})) || die "Invalid selection."; TARGET_DB="${found[answer-1]}"
  fi
}

backup_target() {
  ensure_sqlite
  local backup="$RUN_DIR/omniroute-before-migration.sqlite"
  "$SQLITE3_BIN" "$TARGET_DB" ".backup '$backup'"
  [[ "$($SQLITE3_BIN "$backup" 'PRAGMA integrity_check;' | tail -n1)" == ok ]] || die "Target backup integrity check failed."
  chmod 600 "$backup"; log "Created verified OmniRoute pre-migration backup: $backup"
}

verify_target_schema() {
  ensure_sqlite
  local table
  for table in provider_connections provider_nodes api_keys combos key_value; do
    [[ -n "$($SQLITE3_BIN "$TARGET_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='$table';")" ]] || die "Target DB lacks expected OmniRoute table: $table"
  done
}

prepare_target_write() {
  local container mounts source
  if [[ "$STARTED_NEW_OMNIROUTE" == true ]]; then
    "$DOCKER_BIN" stop --time 40 "$OMNIROUTE_CONTAINER" >/dev/null
    TARGET_CONTAINER="$OMNIROUTE_CONTAINER"
    TARGET_CONTAINER_WAS_RUNNING=true
    return
  fi
  if command -v "$DOCKER_BIN" >/dev/null 2>&1 && "$DOCKER_BIN" info >/dev/null 2>&1; then
    for container in $($DOCKER_BIN ps -q); do
      mounts="$($DOCKER_BIN inspect -f '{{range .Mounts}}{{println .Source}}{{end}}' "$container")"
      while IFS= read -r source; do
        [[ -n "$source" && "$TARGET_DB" == "$source"/* ]] || continue
        confirm "OmniRoute container '$container' uses this database. Stop it briefly for a safe migration write?" || die "Stop OmniRoute yourself, then retry."
        "$DOCKER_BIN" stop --time 40 "$container" >/dev/null
        TARGET_CONTAINER="$container"
        TARGET_CONTAINER_WAS_RUNNING=true
        return
      done <<< "$mounts"
    done
  fi
  if command -v lsof >/dev/null 2>&1 && lsof "$TARGET_DB" >/dev/null 2>&1; then
    die "The target database is currently open by a local process. Stop OmniRoute, then retry so the migration is safe."
  fi
  confirm "For a non-Docker target, confirm OmniRoute is stopped before this direct SQLite write." || die "Stop OmniRoute, then retry."
}

restore_target_service() {
  if [[ "$TARGET_CONTAINER_WAS_RUNNING" == true ]]; then
    "$DOCKER_BIN" start "$TARGET_CONTAINER" >/dev/null || true
    if [[ "$TARGET_CONTAINER" == "$OMNIROUTE_CONTAINER" ]]; then wait_for_omniroute; fi
  fi
}

run_migration() {
  local source_backup="$1"
  local -a source_arg
  ensure_node
  WORKDIR="$(mktemp -d)"
  git clone --depth 1 "$REPO_URL" "$WORKDIR/repo" >/dev/null 2>&1 || die "Could not download migration tool from $REPO_URL"
  (cd "$WORKDIR/repo" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
  backup_target; verify_target_schema
  info "Migration summary"
  printf '  9router backup: %s\n  OmniRoute DB: %s\n  OmniRoute backup: %s\n' "$source_backup" "$TARGET_DB" "$RUN_DIR/omniroute-before-migration.sqlite"
  confirm "Write the backed-up 9router data into this OmniRoute database?" || die "Cancelled before the migration write."
  if [[ "$BACKUP_KIND" == json ]]; then source_arg=(--json "$source_backup"); else source_arg=(--source "$source_backup"); fi
  prepare_target_write
  if ! "$NODE_BIN" "$WORKDIR/repo/scripts/migrate-cli.js" "${source_arg[@]}" --target "$RUN_DIR/migration-output" --target-db "$TARGET_DB" --mode inject | tee -a "$RUN_DIR/migration.log"; then
    restore_target_service
    die "Migration failed. The OmniRoute service was restored; use the backups in $RUN_DIR to investigate or roll back."
  fi
  restore_target_service
  local count
  count="$($SQLITE3_BIN "$TARGET_DB" 'SELECT COUNT(*) FROM provider_connections;')"
  log "Migration verified. Target provider_connections count: $count"
  ok "Migration complete. Backups and log: $RUN_DIR"
}

parse_args() {
  while (($#)); do
    case "$1" in
      --source) SOURCE_DB="${2:-}"; shift 2;; --json) SOURCE_JSON="${2:-}"; shift 2;; --target-db) TARGET_DB="${2:-}"; shift 2;;
      --install-omniroute) INSTALL_OMNIROUTE=true; shift;; --port) REQUESTED_PORT="${2:-}"; shift 2;;
      --yes) YES=true; shift;; --non-interactive) NON_INTERACTIVE=true; shift;; -h|--help) usage; exit 0;; *) die "Unknown option: $1";;
    esac
  done
  [[ -z "$SOURCE_DB" || -z "$SOURCE_JSON" ]] || die "Choose only one source: --source or --json."
}

main() {
  parse_args "$@"
  if ! "$INSTALL_OMNIROUTE" && [[ -z "$TARGET_DB" ]] && ! "$NON_INTERACTIVE"; then
    printf '\n9router → OmniRoute\n\n1) OmniRoute is already installed — back up and migrate into it\n2) OmniRoute is not installed — install it on a separate port, then migrate\n3) Exit\n'
    read -r -p 'Selection: ' answer
    case "$answer" in 1) ;; 2) INSTALL_OMNIROUTE=true;; 3) exit 0;; *) die "Invalid selection.";; esac
  fi
  make_run_dir
  local source_backup
  choose_source
  source_backup="$BACKUP_SOURCE"
  if "$INSTALL_OMNIROUTE"; then install_omniroute; else choose_existing_target; fi
  run_migration "$source_backup"
}

main "$@"
