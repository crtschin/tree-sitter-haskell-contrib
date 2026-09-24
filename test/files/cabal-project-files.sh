#!/usr/bin/env bash
# Emit every cabal.project and *.project file in $CABAL_SRC and $HLS_SRC.
#
# Each --deny is a file that is malformed by design.

# FieldStanzaConfusion: 'source-repository-package:' with a colon is an error
# fixture upstream.
deny_args=(--deny 'cabal-testsuite/PackageTests/ProjectConfig/FieldStanzaConfusion/cabal.project')

set -o pipefail
exec "$(dirname "$0")/find-corpus.sh" \
    --root "$CABAL_SRC" \
    --root "$HLS_SRC" \
    --include '*.project' \
    --include 'cabal.project.*' \
    --exclude '*.hs' \
    --exclude '*.out' \
    --exclude '*.lock' \
    "${deny_args[@]}"
