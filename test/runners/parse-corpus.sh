#!/usr/bin/env bash
# Parse every file in the named corpus preset with `tree-sitter parse`
# (using the grammar in the current working directory) and emit TAP 14 on
# stdout. Exits non-zero if any file fails to parse.
#
# Usage: parse-corpus.sh <preset>
#   preset = cabal | cabal-project | ghc-core | ghc-core-explain | ghc-stg | ghc-cmm | ghc-dump
#
# Must be invoked from inside the grammar's directory (the one containing
# tree-sitter.json) so `tree-sitter parse` picks the right parser.

set -uo pipefail

preset="${1:-}"
case "$preset" in
    cabal|cabal-project|ghc-core|ghc-core-explain|ghc-stg|ghc-cmm|ghc-dump) ;;
    *) echo "usage: $0 <preset>  (cabal | cabal-project | ghc-core | ghc-core-explain | ghc-stg | ghc-cmm | ghc-dump)" >&2; exit 64 ;;
esac

dir="$(dirname "$0")"
source "$dir/../lib/parse-lib.sh"
mapfile -t files < <("$dir/../files/${preset}-files.sh")

n=${#files[@]}
echo "TAP version 14"
echo "1..$n"
if [[ $n -eq 0 ]]; then
    echo "Bail out! no files matched for preset $preset"
    exit 1
fi

# Single-pass batch parse via the shared helper (cwd auto-detects the parser).
# A parser that fails to load is a Bail out, not a silent all-ok pass.
declare -A error_for=()
if ! collect_parse_errors error_for "${files[@]}"; then
    echo "Bail out! tree-sitter could not parse preset $preset (build the grammar first?)"
    exit 1
fi

# Strip a known corpus root prefix for human-readable TAP labels.
label_for() {
    local f="$1" root
    for root in "${CABAL_SRC:-}" "${HLS_SRC:-}" "${GHC_SRC:-}"; do
        if [[ -n "$root" && "$f" == "$root"/* ]]; then
            printf '%s' "${f#"$root"/}"
            return
        fi
    done
    printf '%s' "$f"
}

exit_code=0
i=0
for f in "${files[@]}"; do
    i=$((i+1))
    label="$(label_for "$f")"
    if [[ -n "${error_for[$f]:-}" ]]; then
        echo "not ok $i - $label"
        echo "  ---"
        echo "  error: ${error_for[$f]}"
        echo "  ..."
        exit_code=1
    else
        echo "ok $i - $label"
    fi
done

exit $exit_code
