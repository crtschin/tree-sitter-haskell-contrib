# Per-grammar boilerplate recipes, shared by every grammar. A grammar's justfile
# sets `lang` (e.g. "ghc_core") and `slug` (e.g. "ghc-core"), then
# `import 'common/recipes.just'` (resolved via the dir's `common` symlink), and
# adds its own bespoke recipes (parse-corpus, gen-corpus, ...). The IL grammars
# (ghc-core/stg/cmm/dump) share their whole `test` flow via `_il-test` below.

# Build the grammar via the nix flake (buildGrammar runs generate internally).
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

# Generate src/parser.c locally (needed by highlight).
generate:
    tree-sitter generate

# Parse a file and print AST
parse file: build
    tree-sitter parse --lib-path result/parser --lang-name {{ lang }} {{ file }}

# Show syntax highlighting for a file
highlight file: generate
    tree-sitter highlight {{ file }}

# Assert information extraction (not just no-error): run test/extractions_test.scm
# over test/extract-samples/* and diff captures against test/extractions.golden.
extract: build
    ../test/runners/extract-golden.sh {{ slug }} | tapview

# Regenerate test/extractions.golden from the current grammar (review the diff).
update-extractions: build
    ../test/runners/extract-golden.sh {{ slug }} --update

# IL-grammar test flow (ghc-core/stg/cmm/dump only, cabal has no gen-corpus).
# Runs queries, the harvested-corpus gate, the ephemeral generated matrix, the
# extraction golden, any `extra` gate recipes (ghc-dump passes validate-injections),
# and the inline tests, each to completion. Exits non-zero if any failed. Needs a
# built parser (build) and, for gen-corpus, a GHC compiler.
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
