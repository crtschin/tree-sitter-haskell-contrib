#!/usr/bin/env bash
# Parse every file in the named corpus preset with `tree-sitter parse`
# (using the grammar in the current working directory) and emit TAP 14 on
# stdout. Exits non-zero if any file fails to parse.
#
# Usage: parse-corpus.sh <preset>
#   preset = cabal | cabal-project | ghc-core | ghc-stg | ghc-cmm | ghc-dump
#
# Must be invoked from inside the grammar's directory (the one containing
# tree-sitter.json) so `tree-sitter parse` picks the right parser.

set -uo pipefail

preset="${1:-}"
case "$preset" in
    cabal|cabal-project|ghc-core|ghc-stg|ghc-cmm|ghc-dump) ;;
    *) echo "usage: $0 <preset>  (cabal | cabal-project | ghc-core | ghc-stg | ghc-cmm | ghc-dump)" >&2; exit 64 ;;
esac

dir="$(dirname "$0")"
mapfile -t files < <("$dir/${preset}-files.sh")

n=${#files[@]}
echo "TAP version 14"
echo "1..$n"
if [[ $n -eq 0 ]]; then
    echo "Bail out! no files matched for preset $preset"
    exit 1
fi

# Single-pass batch parse; capture any per-file failure lines.
parse_output=$(tree-sitter parse --quiet "${files[@]}" 2>&1) || true

declare -A error_for=()
while IFS= read -r line; do
    # Failure lines look like:
    #   <path><pad><tab>Parse: <ms><tab><bytes>/ms<tab>(ERROR [r1, c1] - [r2, c2])
    # where <pad> is spaces tree-sitter inserts to align columns. Strip
    # those trailing spaces so the key matches the clean absolute path
    # used in the lookup below.
    [[ -z "$line" ]] && continue
    if [[ "$line" == *$'\t'Parse:* ]]; then
        path="${line%%$'\t'*}"
        path="${path%"${path##*[![:space:]]}"}"
        detail="${line##*$'\t'}"
        error_for["$path"]="$detail"
    fi
done <<< "$parse_output"

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
