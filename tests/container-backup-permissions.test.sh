#!/usr/bin/env bash
# Regression test: docker cp can preserve restrictive ownership/mode from a
# container. The migration staging step must create a host-owned SQLite backup
# rather than extracting the archive into a host directory with those modes.
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
require_pattern 'chmod 600 "\$backup"' \
  'staged backup must be private'

printf 'PASS: container SQLite permissions regression checks passed\n'
