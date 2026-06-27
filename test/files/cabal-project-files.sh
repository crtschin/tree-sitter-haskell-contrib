#!/usr/bin/env bash
# Emit paths to every cabal.project / *.project file in the configured
# corpora ($CABAL_SRC and $HLS_SRC). Used as the corpus selector for the
# cabal-project grammar.
#
# Each --deny below is a file that the grammar will not parse because the
# file is syntactically malformed by design. Each entry is grouped with a
# comment naming the reason.

# FieldStanzaConfusion: the fixture's own comment marks it as 'This is an error'.
# 'source-repository-package:' (trailing colon) is intentionally written as a field,
# not as a stanza header.
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
