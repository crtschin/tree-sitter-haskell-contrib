#!/usr/bin/env bash
# Benchmark `tree-sitter parse` over the named grammar's corpus using
# hyperfine. Relative, machine-dependent throughput -- nothing is committed;
# compare across runs/branches by hand.
#
# Usage: bench-corpus.sh <slug>
#   slug = any grammar with a test/files/<slug>-files.sh selector
#          (cabal | cabal-project | ghc-core | ghc-core-explain | ghc-stg |
#           ghc-cmm | ghc-dump)
#
# Must be invoked from inside the grammar's directory (the one containing
# tree-sitter.json) so `tree-sitter parse` picks the right parser.

set -uo pipefail

preset="${1:-}"
dir="$(dirname "$0")"
[[ -n "$preset" && -x "$dir/../files/${preset}-files.sh" ]] || {
    echo "usage: $0 <slug>  (needs test/files/<slug>-files.sh)" >&2; exit 64; }

for cmd in tree-sitter hyperfine; do
    command -v "$cmd" >/dev/null 2>&1 || {
        echo "missing required command: $cmd (enter the nix devShell?)" >&2
        exit 1
    }
done

mapfile -t files < <("$dir/../files/${preset}-files.sh")

if [[ ${#files[@]} -eq 0 ]]; then
    echo "no files matched for preset $preset" >&2
    exit 1
fi

echo "benchmarking tree-sitter parse over ${#files[@]} files ($preset)" >&2

hyperfine \
    --warmup 3 \
    --ignore-failure \
    --command-name "tree-sitter parse ($preset)" \
    "tree-sitter parse --quiet ${files[*]}"
