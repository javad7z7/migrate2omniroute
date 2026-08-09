#!/usr/bin/env bash
# Regression test: docker cp can preserve restrictive ownership/mode from a
# container. The migration staging step must make the copy readable before
# SQLite validates it.
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

# The copied source can be root-owned and mode 0600. Copy through a temporary
# path rather than attempting sqlite3 to read the docker-copied file directly.
require_pattern 'cp -- "\$copied_file" "\$backup"' \
  'container copy must be staged through a host-owned backup file'
require_pattern 'chmod 600 "\$backup"' \
  'staged backup must be private'
require_pattern 'Could not stage copied SQLite file from container' \
  'staging failures must not be misreported as an invalid container path'

printf 'PASS: container SQLite permissions regression checks passed\n'
