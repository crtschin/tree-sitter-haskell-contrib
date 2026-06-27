#!/usr/bin/env bash
# Profile `tree-sitter parse` over the named corpus preset under valgrind
# and emit the chosen tool's output (and annotated text report where the
# tool has one).
#
# Usage: valgrind-corpus.sh <preset> <output-prefix> [--tool=TOOL]
#   preset = cabal | cabal-project
#   TOOL   = callgrind (default) | cachegrind | memcheck | massif
#
# Emits:
#   <output-prefix>.out  raw tool output
#   <output-prefix>.txt  annotated report (callgrind/cachegrind/massif)
#
# Must be invoked from inside the grammar's directory (the one containing
# tree-sitter.json) so `tree-sitter parse` picks the right parser.
#
# The scanner .so is rebuilt with `-O1 -g -fno-omit-frame-pointer` so
# valgrind can attribute instructions to lines in scanner.c. After the
# run an uninstrumented rebuild restores the cache, mirroring the
# pattern used by `just stats`.

set -uo pipefail

preset="${1:-}"
output_prefix="${2:-}"
tool="callgrind"

case "$preset" in
    cabal|cabal-project) ;;
    *) echo "usage: $0 <preset> <output-prefix> [--tool=TOOL]  (preset = cabal | cabal-project)" >&2; exit 64 ;;
esac
[[ -z "$output_prefix" ]] && { echo "output prefix required" >&2; exit 64; }

shift 2 || true
for arg in "$@"; do
    case "$arg" in
        --tool=*) tool="${arg#--tool=}" ;;
        *) echo "unknown argument: $arg" >&2; exit 64 ;;
    esac
done

case "$tool" in
    callgrind|cachegrind|memcheck|massif) ;;
    *) echo "unknown tool: $tool (expected callgrind|cachegrind|memcheck|massif)" >&2; exit 64 ;;
esac

required=(tree-sitter valgrind)
case "$tool" in
    callgrind) required+=(callgrind_annotate) ;;
    cachegrind) required+=(cg_annotate) ;;
    massif) required+=(ms_print) ;;
esac
for cmd in "${required[@]}"; do
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

raw="${output_prefix}.out"
txt="${output_prefix}.txt"

echo "rebuilding parser with debug symbols (-O1 -g)" >&2
CFLAGS="-O1 -g -fno-omit-frame-pointer" \
    tree-sitter parse --quiet --rebuild "${files[@]}" >/dev/null 2>&1 || true

echo "running valgrind --tool=$tool over ${#files[@]} files" >&2

case "$tool" in
    callgrind)
        valgrind \
            --tool=callgrind \
            --callgrind-out-file="$raw" \
            --cache-sim=yes \
            --branch-sim=yes \
            -- tree-sitter parse --quiet "${files[@]}" \
            >/dev/null 2>&1 || true
        callgrind_annotate --inclusive=yes --auto=no "$raw" > "$txt"
        ;;
    cachegrind)
        valgrind \
            --tool=cachegrind \
            --cachegrind-out-file="$raw" \
            -- tree-sitter parse --quiet "${files[@]}" \
            >/dev/null 2>&1 || true
        cg_annotate "$raw" > "$txt"
        ;;
    memcheck)
        valgrind \
            --tool=memcheck \
            --leak-check=full \
            --show-leak-kinds=all \
            --error-exitcode=0 \
            --log-file="$raw" \
            -- tree-sitter parse --quiet "${files[@]}" \
            >/dev/null 2>&1 || true
        ;;
    massif)
        valgrind \
            --tool=massif \
            --massif-out-file="$raw" \
            -- tree-sitter parse --quiet "${files[@]}" \
            >/dev/null 2>&1 || true
        ms_print "$raw" > "$txt"
        ;;
esac

if [[ ! -s "$raw" ]]; then
    echo "valgrind produced no output at $raw" >&2
    exit 1
fi

echo "restoring uninstrumented parser build" >&2
tree-sitter parse --quiet --rebuild "${files[0]}" >/dev/null 2>&1 || true

echo "wrote $raw" >&2
[[ -f "$txt" ]] && echo "wrote $txt" >&2
