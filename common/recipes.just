# Per-grammar boilerplate recipes, shared by every grammar. A grammar's justfile
# sets `lang` (e.g. "ghc_core") and `slug` (e.g. "ghc-core"), then
# `import 'common/recipes.just'` (resolved via the dir's `common` symlink), and
# adds its own bespoke recipes (test, parse-corpus, gen-corpus, ...).

# Build the grammar via the nix flake (buildGrammar runs generate internally).
build:
    nix build ..#tree-sitter-{{ slug }}

# Check grammar for errors without building a result symlink.
check:
    nix build ..#tree-sitter-{{ slug }} --no-link

# Validate every editor query (queries/*/*.scm) compiles against the grammar.
check-queries: build
    ../test/check-queries.sh {{ slug }} | tapview

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
