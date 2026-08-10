#!/usr/bin/env bash
# Regression tests for container SQLite migration safety: Docker output must be
# streamed to a host-owned backup, and container restoration must not depend on
# function-local trap state under `set -u`.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/migrate2omniroute.sh"

require_pattern() {
  local pattern="$1" description="$2"
  if ! grep -qE "$pattern" "$SCRIPT"; then
    printf 'FAIL: %s\n' "$description" >&2
    exit 1
  fi
}

require_pattern 'cp "\$container:\$dbpath" - \| tar -xOf - > "\$backup"' \
  'container SQLite must stream from Docker into a host-created backup file'
require_pattern 'Container database copy is empty' \
  'empty Docker copies must fail explicitly'
require_pattern 'Could not stream \$dbpath from container' \
  'copy failures must not be misreported as an invalid container path'
require_pattern 'SOURCE_CONTAINER_STOPPED=false' \
  'source container restoration state must be globally initialized'
require_pattern 'restore_source_container' \
  'cleanup must restore a stopped source container'
require_pattern 'Proposed OmniRoute dashboard port:.*>&2' \
  'choose_port interactive display must be redirected to stderr'
require_pattern 'chmod 644 "\$tmp_file"' \
  'write_compose must set 0644 permissions on compose file'
if grep -q 'trap restore_container RETURN' "$SCRIPT"; then
  printf 'FAIL: RETURN trap must not access a function-local stopped variable\n' >&2
  exit 1
fi

printf 'PASS: container SQLite permissions and cleanup regression checks passed\n'
