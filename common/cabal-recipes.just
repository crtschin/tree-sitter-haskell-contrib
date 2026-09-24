# Recipes for the two cabal grammars, on top of common/recipes.just. The perf
# scripts accept only `cabal` and `cabal-project`, so these recipes stay here.

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

# Check the winning capture for each token against test/highlights.golden.
highlight-golden: build
    ../test/runners/highlight-golden.sh {{ slug }} | tapview

# Regenerate test/highlights.golden from the current queries.
update-highlights: build
    ../test/runners/highlight-golden.sh {{ slug }} --update

# Profile parsing the corpus and emit flamegraph-{{ slug }}.svg at the repo root.
flamegraph:
    ../test/perf/flamegraph-corpus.sh {{ slug }} ../flamegraph-{{ slug }}.svg

# Profile parsing the corpus under valgrind (callgrind, cachegrind, memcheck or massif).
valgrind tool="callgrind":
    ../test/perf/valgrind-corpus.sh {{ slug }} ../valgrind-{{ slug }} --tool={{ tool }}

# Print the scanner call rates for the corpus on stderr.
stats: generate
    #!/usr/bin/env bash
    set -euo pipefail
    mapfile -t files < <(../test/files/{{ slug }}-files.sh)
    CFLAGS="-DSCANNER_STATS" tree-sitter parse --quiet --rebuild "${files[@]}" >/dev/null
    # Rebuild without the flag, or later parses use the instrumented cached .so.
    tree-sitter parse --quiet --rebuild "${files[0]}" >/dev/null 2>&1
