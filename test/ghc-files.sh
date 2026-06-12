#!/usr/bin/env bash
# Emit the dump fixtures for one GHC IL grammar: the .stderr files in $GHC_SRC's
# testsuite that carry that IL's phase banner, plus the committed generated
# dumps in the grammar's test/fixtures/dumps/.
#
# Selection from the testsuite is by banner content, not extension: a .stderr
# captures every enabled -ddump-* pass (Core, STG, Cmm, ...) plus warnings, so
# the file name does not identify the IL. A .stderr that enabled several passes
# can therefore appear in more than one IL's corpus; that's accepted while the
# grammars are scaffolds, and the container grammar is the proper home for such
# mixed streams.
#
# Usage: ghc-files.sh <ghc-core|ghc-stg|ghc-cmm|ghc-dump>
#
# The per-grammar selector scripts (ghc-<lang>-files.sh) are thin shims over
# this. ghc-dump is the container: it takes the union of every IL banner, so a
# single-section dump and a mixed multi-IL stream both land in its corpus.

set -uo pipefail

: "${GHC_SRC:?GHC_SRC is unset (enter the dev shell)}"

lang="${1:?usage: $0 <ghc-core|ghc-stg|ghc-cmm|ghc-dump>}"
# Banners mirror the grammars' banner rule (={4,}...). Core stays scoped to
# Tidy Core (what the grammar models); ds/prep are Core too but excluded for now.
case "$lang" in
    ghc-core) banner='={4,} Tidy Core' ;;
    ghc-stg)  banner='={4,} .*STG' ;;
    ghc-cmm)  banner='={4,} (Output Cmm|Cmm produced by codegen)' ;;
    ghc-dump) banner='={4,} (Tidy Core|Desugar|CorePrep|.*STG|Output Cmm|Cmm produced by codegen)' ;;
    *) echo "unknown lang: $lang  (ghc-core|ghc-stg|ghc-cmm|ghc-dump)" >&2; exit 64 ;;
esac

repo="$(cd "$(dirname "$0")/.." && pwd)"
gen="$repo/tree-sitter-$lang/test/fixtures/dumps"

{
    grep -rlE "$banner" "$GHC_SRC/testsuite/tests" --include='*.stderr'
    [[ -d "$gen" ]] && find "$gen" -type f -name '*.dump*'
} | LC_ALL=C sort
