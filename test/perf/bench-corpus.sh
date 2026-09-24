#!/usr/bin/env bash
# Benchmark `tree-sitter parse` over the corpus of a grammar with hyperfine.
# The numbers depend on the machine, so nothing is committed.
#
# Usage: bench-corpus.sh <slug>
#
# Run it from the grammar directory, because `tree-sitter parse` finds the
# parser from the cwd.

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
