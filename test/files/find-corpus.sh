#!/usr/bin/env bash
# Walk one or more directories and emit absolute paths of files matching
# the include globs, with exclude globs and per-root deny relpath patterns
# applied. Output is sorted with LC_ALL=C.
#
# Usage:
#   find-corpus.sh --root <dir> [--root <dir>...]
#                  --include <glob> [--include <glob>...]
#                  [--exclude <glob>...] [--deny <relpath-pattern>...]
#
# --include / --exclude match against the filename (find -name).
# --deny matches against the path relative to its --root using bash glob
# semantics, so 'a/b/*' prunes the whole 'a/b/' subtree.

set -uo pipefail

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \?//' >&2
    exit 64
}

roots=()
includes=()
excludes=()
deny=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --root)    roots+=("$2"); shift 2 ;;
        --include) includes+=("$2"); shift 2 ;;
        --exclude) excludes+=("$2"); shift 2 ;;
        --deny)    deny+=("$2"); shift 2 ;;
        -h|--help) usage ;;
        *)         echo "unknown arg: $1" >&2; usage ;;
    esac
done

[[ ${#roots[@]}    -eq 0 ]] && { echo "at least one --root is required"    >&2; usage; }
[[ ${#includes[@]} -eq 0 ]] && { echo "at least one --include is required" >&2; usage; }

for root in "${roots[@]}"; do
    [[ -d "$root" ]] || { echo "root not found: $root" >&2; exit 1; }
done

for root in "${roots[@]}"; do
    find_args=("$root" -type f \( )
    for i in "${!includes[@]}"; do
        [[ $i -gt 0 ]] && find_args+=( -o )
        find_args+=( -name "${includes[$i]}" )
    done
    find_args+=( \) )
    for ex in "${excludes[@]}"; do
        find_args+=( ! -name "$ex" )
    done
    find_args+=( ! -path '*/.git/*' )

    while IFS= read -r f; do
        rel="${f#"$root"/}"
        skip=0
        for d in "${deny[@]}"; do
            # Unquoted $d on the RHS of [[ == ]] enables glob pattern
            # matching. '*' matches any sequence including '/'.
            if [[ "$rel" == $d ]]; then skip=1; break; fi
        done
        [[ $skip -eq 0 ]] && printf '%s\n' "$f"
    done < <(find "${find_args[@]}" | LC_ALL=C sort)
done
