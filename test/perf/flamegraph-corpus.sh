#!/usr/bin/env bash
# Profile `tree-sitter parse` over a corpus with perf and write a flamegraph.
#
# Usage: flamegraph-corpus.sh <cabal|cabal-project> <output-svg>
#
# Run it from the grammar directory, because `tree-sitter parse` finds the
# parser from the cwd.

set -uo pipefail

preset="${1:-}"
output="${2:-}"
case "$preset" in
    cabal|cabal-project) ;;
    *) echo "usage: $0 <preset> <output-svg>  (preset = cabal | cabal-project)" >&2; exit 64 ;;
esac
[[ -z "$output" ]] && { echo "output path required" >&2; exit 64; }

for cmd in tree-sitter perf flamegraph.pl stackcollapse-perf.pl; do
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

tmp=$(mktemp -d -t flamegraph-corpus.XXXXXX)
trap 'rm -rf "$tmp"' EXIT

echo "profiling ${#files[@]} files" >&2

# perf passes on the non-zero exit of a parse with errors. Only a missing
# perf.data is a failure.
perf record \
    --call-graph dwarf \
    -F 4999 \
    -o "$tmp/perf.data" \
    -- tree-sitter parse --quiet "${files[@]}" \
    >"$tmp/perf.stdout" 2>"$tmp/perf.stderr" || true

if [[ ! -s "$tmp/perf.data" ]]; then
    echo "perf record produced no data" >&2
    sed 's/^/  /' "$tmp/perf.stderr" >&2
    exit 1
fi

perf script -i "$tmp/perf.data" 2>/dev/null \
    | stackcollapse-perf.pl \
    | flamegraph.pl --title "tree-sitter parse ($preset)" \
    > "$output"

echo "wrote $output" >&2
