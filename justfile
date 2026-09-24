mod cabal 'tree-sitter-cabal'
mod cabal-project 'tree-sitter-cabal-project'
mod ghc-core 'tree-sitter-ghc-core'
mod ghc-core-explain 'tree-sitter-ghc-core-explain'
mod ghc-stg 'tree-sitter-ghc-stg'
mod ghc-cmm 'tree-sitter-ghc-cmm'
mod ghc-dump 'tree-sitter-ghc-dump'

default: test

# Run every suite to completion (--fast: one GHC, --allocation or --performance: perf alone)
test *flags:
    #!/usr/bin/env bash
    set -uo pipefail
    f=" {{ flags }} "
    [[ "$f" == *" --fast "* ]] || export GEN_GHC=all
    rc=0
    for g in cabal cabal-project ghc-core ghc-core-explain ghc-stg ghc-cmm ghc-dump; do
        echo "==> $g"
        if [[ "$f" == *" --allocation "* || "$f" == *" --performance "* ]]; then
            [[ "$f" == *" --performance "* ]] && { just "$g::bench" || rc=1; }
            [[ "$f" == *" --allocation "* ]] && { just "$g::alloc" || rc=1; }
        else
            just "$g::test" || rc=1
        fi
    done
    exit "$rc"

# Build every grammar
build: cabal::build cabal-project::build ghc-core::build ghc-core-explain::build ghc-stg::build ghc-cmm::build ghc-dump::build

# Static checks for every grammar
check: cabal::check cabal-project::check ghc-core::check ghc-core-explain::check ghc-stg::check ghc-cmm::check ghc-dump::check

# Format every grammar and the flake (mode: write|check)
fmt mode="write": (cabal::fmt mode) (cabal-project::fmt mode) (ghc-core::fmt mode) (ghc-core-explain::fmt mode) (ghc-stg::fmt mode) (ghc-cmm::fmt mode) (ghc-dump::fmt mode)
    nixfmt {{ if mode == "check" { "--check" } else { "" } }} flake.nix

# Clean build artifacts in every grammar
clean: cabal::clean cabal-project::clean ghc-core::clean ghc-core-explain::clean ghc-stg::clean ghc-cmm::clean ghc-dump::clean

# Parse the generated GHC dump matrix (set GEN_GHC=all for every GHC version)
gen-corpus: ghc-core::gen-corpus ghc-core-explain::gen-corpus ghc-stg::gen-corpus ghc-cmm::gen-corpus ghc-dump::gen-corpus

# Check the extraction golden of every grammar
extract: cabal::extract cabal-project::extract ghc-core::extract ghc-core-explain::extract ghc-stg::extract ghc-cmm::extract ghc-dump::extract

# Regenerate the extraction golden of every grammar
update-extractions: cabal::update-extractions cabal-project::update-extractions ghc-core::update-extractions ghc-core-explain::update-extractions ghc-stg::update-extractions ghc-cmm::update-extractions ghc-dump::update-extractions

# Generate flamegraphs for the corpus-backed grammars.
flamegraph: cabal::flamegraph cabal-project::flamegraph

# Benchmark the corpus-backed grammars with hyperfine.
bench: cabal::bench cabal-project::bench

# Profile the corpus-backed grammars under valgrind (callgrind, cachegrind, memcheck or massif)
valgrind tool="callgrind": (cabal::valgrind tool) (cabal-project::valgrind tool)

# Print the scanner call rates for both cabal corpora on stderr
stats: cabal::stats cabal-project::stats

# Update flake inputs.
update +args:
  nix flake update {{args}}
