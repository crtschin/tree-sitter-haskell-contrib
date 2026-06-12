#!/usr/bin/env bash
# Emit paths to every GHC Core dump fixture in $GHC_SRC: the .stderr files in
# GHC's testsuite that capture `-ddump-simpl` output, identified by the
# "Tidy Core" phase banner GHC prints around the dump.
#
# Unlike .cabal, the file extension does not identify a Core dump: GHC's
# testsuite captures every -ddump-* pass (Cmm, STG, demand signatures, parser
# AST, ...) plus type errors and warnings to .stderr, so selection is by
# content (the banner), not by name -- which is why this can't reuse
# find-corpus.sh. Some matched files also carry a non-Core dump (e.g. a
# trailing "Output Cmm") when the test enabled several -ddump flags; that's
# accepted, since the grammar models each banner-delimited block as a
# top-level item.

set -uo pipefail

: "${GHC_SRC:?GHC_SRC is unset (enter the dev shell)}"

repo="$(cd "$(dirname "$0")/.." && pwd)"
gen="$repo/tree-sitter-ghc-core/test/fixtures/dumps"

{
    # Harvested: GHC testsuite .stderr files carrying a Tidy Core banner.
    # `={4,} Tidy Core` mirrors the grammar's banner rule (={4,}...={4,}).
    grep -rlE '={4,} Tidy Core' "$GHC_SRC/testsuite/tests" --include='*.stderr'
    # Generated: committed fixtures covering flags/constructs the harvest lacks.
    [[ -d "$gen" ]] && find "$gen" -type f -name '*.dump-simpl'
} | LC_ALL=C sort
