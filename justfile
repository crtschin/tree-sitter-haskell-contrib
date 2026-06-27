mod cabal 'tree-sitter-cabal'
mod cabal-project 'tree-sitter-cabal-project'
mod ghc-core 'tree-sitter-ghc-core'
mod ghc-stg 'tree-sitter-ghc-stg'
mod ghc-cmm 'tree-sitter-ghc-cmm'
mod ghc-dump 'tree-sitter-ghc-dump'

default: test

# Run every grammar's full suite to completion (keep going past failures), then
# exit non-zero if any grammar failed. With `--all`, the IL grammars' gen-corpus
# step runs the cross-GHC matrix (flake `ghcVersions`) instead of the single
# default GHC (opt-in and heavy, see test/runners/gen-corpus.sh).
test *flags:
    #!/usr/bin/env bash
    set -uo pipefail
    [[ " {{ flags }} " == *" --all "* ]] && export GEN_GHC=all
    rc=0
    for g in cabal cabal-project ghc-core ghc-stg ghc-cmm ghc-dump; do
        echo "==> $g"
        just "$g::test" || rc=1
    done
    exit "$rc"

# Build every grammar
build: cabal::build cabal-project::build ghc-core::build ghc-stg::build ghc-cmm::build ghc-dump::build

# Static checks for every grammar
check: cabal::check cabal-project::check ghc-core::check ghc-stg::check ghc-cmm::check ghc-dump::check

# Format every grammar and the flake (mode: write|check)
fmt mode="write": (cabal::fmt mode) (cabal-project::fmt mode) (ghc-core::fmt mode) (ghc-stg::fmt mode) (ghc-cmm::fmt mode) (ghc-dump::fmt mode)
    nixfmt {{ if mode == "check" { "--check" } else { "" } }} flake.nix

# Clean build artifacts in every grammar
clean: cabal::clean cabal-project::clean ghc-core::clean ghc-stg::clean ghc-cmm::clean ghc-dump::clean

# Build + parse the GHC dump-flag matrix per IL grammar as a TAP suite. Needs a GHC compiler. Ephemeral. Also run by `test`.
gen-corpus: ghc-core::gen-corpus ghc-stg::gen-corpus ghc-cmm::gen-corpus ghc-dump::gen-corpus

# Opt-in: dump matrix across ALL flake `ghcVersions` per IL grammar. Heavy (pulls each GHC closure). Not run by `test`.
gen-corpus-all: ghc-core::gen-corpus-all ghc-stg::gen-corpus-all ghc-cmm::gen-corpus-all ghc-dump::gen-corpus-all

# Generate flamegraphs for the corpus-backed grammars.
flamegraph: cabal::flamegraph cabal-project::flamegraph

# Benchmark the corpus-backed grammars with hyperfine.
bench: cabal::bench cabal-project::bench

# Profile the corpus-backed grammars under valgrind (tool = callgrind |
# cachegrind | memcheck | massif). Emits valgrind-<preset>.{out,txt} at the
# repo root.
valgrind tool="callgrind": (cabal::valgrind tool) (cabal-project::valgrind tool)

# Parse both cabal corpora with scanner instrumentation enabled. Emits one
# [scanner-stats] line per grammar on stderr.
stats: cabal::stats cabal-project::stats

# Update flake inputs.
update +args:
  nix flake update {{args}}
