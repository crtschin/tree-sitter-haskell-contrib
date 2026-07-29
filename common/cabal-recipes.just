# Recipes shared by the two cabal grammars only, imported on top of
# common/recipes.just. Kept out of that file because the perf scripts accept just
# `cabal|cabal-project` (they are the corpus-backed grammars), so exposing these
# on the IL grammars would only offer recipes that fail.
#
# A grammar's justfile sets `lang` and `slug` before importing.

# Cabal-grammar test flow: queries, the corpus gate, the extraction golden, and the
# inline tests, each run to completion. Exits non-zero if any failed. The IL flow
# (_il-test in common/recipes.just) additionally runs gen-corpus, which the cabal
# grammars have no equivalent of.
_cabal-test: build
    #!/usr/bin/env bash
    set -uo pipefail
    rc=0
    ../test/runners/check-queries.sh {{ slug }} | tapview || rc=1
    ../test/runners/parse-corpus.sh {{ slug }} | tapview || rc=1
    ../test/runners/extract-golden.sh {{ slug }} | tapview || rc=1
    ../test/runners/highlight-golden.sh {{ slug }} | tapview || rc=1
    tree-sitter test --lib-path result/parser --lang-name {{ lang }} || rc=1
    exit "$rc"

# Assert which capture wins per token (test/highlights.golden). check-queries only
# proves a query file compiles, so it cannot catch one pattern shadowing another.
highlight-golden: build
    ../test/runners/highlight-golden.sh {{ slug }} | tapview

# Regenerate test/highlights.golden from the current queries (review the diff).
update-highlights: build
    ../test/runners/highlight-golden.sh {{ slug }} --update

# Profile parsing the corpus and emit flamegraph-{{ slug }}.svg at the repo root.
flamegraph:
    ../test/perf/flamegraph-corpus.sh {{ slug }} ../flamegraph-{{ slug }}.svg

# Profile parsing the corpus under valgrind (tool = callgrind | cachegrind |
# memcheck | massif). Emits valgrind-{{ slug }}.{out,txt} at the repo root.
valgrind tool="callgrind":
    ../test/perf/valgrind-corpus.sh {{ slug }} ../valgrind-{{ slug }} --tool={{ tool }}

# Parse the corpus with -DSCANNER_STATS so the scanner emits a one-line
# [scanner-stats] call-rate report on stderr. Uses `tree-sitter parse --rebuild`
# to force a fresh compile with the flag, then a second --rebuild without it to
# restore an uninstrumented .so in the cache for normal runs.
stats: generate
    #!/usr/bin/env bash
    set -euo pipefail
    mapfile -t files < <(../test/files/{{ slug }}-files.sh)
    CFLAGS="-DSCANNER_STATS" tree-sitter parse --quiet --rebuild "${files[@]}" >/dev/null
    tree-sitter parse --quiet --rebuild "${files[0]}" >/dev/null 2>&1
