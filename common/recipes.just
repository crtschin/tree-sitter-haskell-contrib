# Recipes for every grammar. The importing justfile must set `lang` (e.g.
# "ghc_core") and `slug` (e.g. "ghc-core").

# Build the grammar with the nix flake.
build:
    nix build ..#tree-sitter-{{ slug }}

# Check grammar for errors without building a result symlink.
check:
    nix build ..#tree-sitter-{{ slug }} --no-link

# Validate every editor query (queries/*/*.scm) compiles against the grammar.
check-queries: build
    ../test/runners/check-queries.sh {{ slug }} | tapview

# Format the grammar file (mode: write|check)
fmt mode="write":
    prettier --{{ mode }} grammar.js

# Clean build artifacts
clean:
    rm -rf {{ lang }}.so result

# Generate src/parser.c locally.
generate:
    tree-sitter generate

# Parse a file and print AST
parse file: build
    tree-sitter parse --lib-path result/parser --lang-name {{ lang }} {{ file }}

# Show syntax highlighting for a file
highlight file: generate
    tree-sitter highlight {{ file }}

# Check the extraction captures against test/extractions.golden.
extract: build
    ../test/runners/extract-golden.sh {{ slug }} | tapview

# Regenerate test/extractions.golden from the current grammar.
update-extractions: build
    ../test/runners/extract-golden.sh {{ slug }} --update

# Benchmark parsing the corpus with hyperfine.
bench: build
    ../test/perf/bench-corpus.sh {{ slug }}

# Rewrite test/alloc.golden in place, then fail if it drifted from the committed copy.
alloc: build
    ../test/perf/alloc-golden.sh {{ slug }} | tapview

_il-test *extra: build
    #!/usr/bin/env bash
    set -uo pipefail
    rc=0
    ../test/runners/check-queries.sh {{ slug }} | tapview || rc=1
    ../test/runners/parse-corpus.sh {{ slug }} | tapview || rc=1
    ../test/runners/gen-corpus.sh {{ slug }} | tapview || rc=1
    ../test/runners/extract-golden.sh {{ slug }} | tapview || rc=1
    for r in {{ extra }}; do just "$r" || rc=1; done
    tree-sitter test --lib-path result/parser --lang-name {{ lang }} || rc=1
    exit "$rc"
