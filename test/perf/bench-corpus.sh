#!/usr/bin/env bash
# Benchmark `tree-sitter parse` over the named corpus preset using
# hyperfine.
#
# Usage: bench-corpus.sh <preset>
#   preset = cabal | cabal-project
#
# Must be invoked from inside the grammar's directory (the one containing
# tree-sitter.json) so `tree-sitter parse` picks the right parser.

set -uo pipefail

preset="${1:-}"
case "$preset" in
    cabal|cabal-project) ;;
    *) echo "usage: $0 <preset>  (preset = cabal | cabal-project)" >&2; exit 64 ;;
esac

for cmd in tree-sitter hyperfine; do
    command -v "$cmd" >/dev/null 2>&1 || {
        echo "missing required command: $cmd (enter the nix devShell?)" >&2
        exit 1
    }
done

dir="$(dirname "$0")"
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
