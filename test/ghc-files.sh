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
repo="$(cd "$(dirname "$0")/.." && pwd)"

# ghc-core's grammar is real (no longer an atom scaffold), so its corpus is
# scoped to the dumps it fully parses -- currently the -dsuppress-all structural
# surface. The harvested .stderr and the bare/suppress-uniques fixtures carry
# type signatures and [IdInfo] not modelled yet; fold them in (and re-include
# the harvest) as that coverage lands. test/corpus/*.txt drive unit correctness.
if [[ "$lang" == ghc-core ]]; then
    gen="$repo/tree-sitter-ghc-core/test/fixtures/dumps"
    { [[ -d "$gen" ]] && find "$gen" -type f -name '*.suppress-all.dump-simpl'; } |
        LC_ALL=C sort
    exit 0
fi

# Banners mirror the grammars' banner rule (={4,}...).
case "$lang" in
    ghc-stg)  banner='={4,} .*STG' ;;
    ghc-cmm)  banner='={4,} (Output Cmm|Cmm produced by codegen)' ;;
    ghc-dump) banner='={4,} (Tidy Core|Desugar|CorePrep|.*STG|Output Cmm|Cmm produced by codegen)' ;;
    *) echo "unknown lang: $lang  (ghc-core|ghc-stg|ghc-cmm|ghc-dump)" >&2; exit 64 ;;
esac

gen="$repo/tree-sitter-$lang/test/fixtures/dumps"

{
    grep -rlE "$banner" "$GHC_SRC/testsuite/tests" --include='*.stderr'
    [[ -d "$gen" ]] && find "$gen" -type f -name '*.dump*'
} | LC_ALL=C sort
