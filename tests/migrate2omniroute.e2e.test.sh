#!/usr/bin/env bash
# End-to-end contract tests for the server bootstrap script. Every external
# dependency is mocked: Docker, sqlite3, Node, Git, npm, and mktemp.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/migrate2omniroute.sh"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TMP_ROOT"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_file() { [[ -f "$1" ]] || fail "expected file: $1"; }
assert_missing() { [[ ! -e "$1" ]] || fail "expected cleanup to remove: $1"; }
assert_log() { grep -Fqx -- "$1" "$2" || fail "missing log entry '$1' in $2"; }

make_mocks() {
  local bin="$1"
  mkdir -p "$bin"

  cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_LOG"
case "${1:-}" in
  info) exit 0 ;;
  compose)
    if [[ "${2:-}" == version ]]; then exit 0; fi
    # compose -f FILE up -d
    if [[ "${4:-}" == up ]]; then
      mkdir -p "$OMNIROUTE_DATA_DIR"
      : > "$OMNIROUTE_DATA_DIR/storage.sqlite"
    fi
    exit 0 ;;
  inspect)
    format="${3:-}"; container="${4:-}"
    if [[ "$container" == source9router && "$format" == '{{.State.Running}}' ]]; then printf 'true\n'; else printf 'healthy\n'; fi
    ;;
  exec) exit 0 ;;
  stop|start) exit 0 ;;
  cp)
    tar -cf - -C "$(dirname -- "$FAKE_DOCKER_DB")" "$(basename -- "$FAKE_DOCKER_DB")"
    ;;
  ps) exit 0 ;;
  logs) exit 0 ;;
  *) printf 'unexpected docker command: %s\n' "$*" >&2; exit 2 ;;
esac
EOF

  cat > "$bin/sqlite3" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
file="$1"; query="${2:-}"
case "$query" in
  .backup\ *) target="${query#*.backup }"; target="${target#\'}"; target="${target%\'}"; cp "$file" "$target" ;;
  'PRAGMA integrity_check;') printf 'ok\n' ;;
  *sqlite_master*) printf 'table\n' ;;
  'SELECT COUNT(*) FROM provider_connections;') printf '1\n' ;;
  *) printf 'unexpected sqlite query: %s\n' "$query" >&2; exit 2 ;;
esac
EOF

  cat > "$bin/node" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == -p ]]; then printf '20\n'; exit 0; fi
if [[ "${1:-}" == -e ]]; then exit 0; fi
printf 'node %s\n' "$*" >> "$MOCK_LOG"
EOF

  cat > "$bin/git" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_LOG"
last="${!#}"
mkdir -p "$last/scripts"
EOF

  cat > "$bin/npm" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_LOG"
EOF

  cat > "$bin/mktemp" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == -d ]]; then
  mkdir -p "$MOCK_WORKDIR"
  printf '%s\n' "$MOCK_WORKDIR"
else
  template="$1"
  output="${template/XXXXXX/123456}"
  mkdir -p "$(dirname -- "$output")"
  : > "$output"
  printf '%s\n' "$output"
fi
EOF
  chmod +x "$bin"/*
}

run_case() {
  local kind="$1"
  local case_dir="$TMP_ROOT/$kind" bin="$TMP_ROOT/$kind/bin"
  local source="$TMP_ROOT/$kind/local-source.sqlite" runs="$TMP_ROOT/$kind/runs" omni="$TMP_ROOT/$kind/omniroute"
  mkdir -p "$case_dir"
  make_mocks "$bin"
  printf 'sqlite fixture for %s\n' "$kind" > "$source"

  export PATH="$bin:$PATH" MOCK_LOG="$case_dir/commands.log" MOCK_WORKDIR="$case_dir/workdir"
  export FAKE_DOCKER_DB="$source" OMNIROUTE_DATA_DIR="$omni/data"
  if ! M2O_HOME="$case_dir/m2o" M2O_RUNS_DIR="$runs" OMNIROUTE_INSTALL_DIR="$omni" \
    OMNIROUTE_DATA_DIR="$omni/data" DOCKER_BIN=docker SQLITE3_BIN=sqlite3 NODE_BIN=node \
    bash "$SCRIPT" --source "$2" --install-omniroute --port 21999 --yes --non-interactive \
    > "$case_dir/output.log" 2>&1; then
    printf 'Harness output for %s:\n' "$kind" >&2
    cat "$case_dir/output.log" >&2
    fail "$kind: bootstrap script failed"
  fi

  local run_dir
  run_dir="$(printf '%s\n' "$runs"/*)"
  assert_file "$run_dir/9router-backup.sqlite"
  assert_file "$run_dir/omniroute-before-migration.sqlite"
  assert_file "$omni/compose.yml"
  assert_file "$omni/data/storage.sqlite"
  grep -Fqx '    image: diegosouzapw/omniroute:latest' "$omni/compose.yml" || fail "$kind: compose image missing"
  grep -Fqx '      - "21999:20128"' "$omni/compose.yml" || fail "$kind: compose port missing"
  grep -Fqx "      - $omni/data:/app/data" "$omni/compose.yml" || fail "$kind: compose volume missing"
  assert_log "compose -f $omni/compose.yml up -d" "$MOCK_LOG"
  assert_log 'stop --time 40 omniroute-m2o' "$MOCK_LOG"
  assert_log 'start omniroute-m2o' "$MOCK_LOG"
  assert_missing "$MOCK_WORKDIR"

  if [[ "$kind" == docker ]]; then
    assert_log 'stop --time 40 source9router' "$MOCK_LOG"
    assert_log 'start source9router' "$MOCK_LOG"
    assert_log 'cp source9router:/data/data.sqlite -' "$MOCK_LOG"
  fi
  printf 'PASS: %s source full bootstrap flow\n' "$kind"
}

run_case local "$TMP_ROOT/local/local-source.sqlite"
run_case docker 'source9router:/data/data.sqlite'
printf 'PASS: mock E2E migration harness completed\n'
