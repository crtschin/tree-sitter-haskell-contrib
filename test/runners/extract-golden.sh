#!/usr/bin/env bash
# Run test/extractions_test.scm over test/extract-samples/* and diff the
# captures against test/extractions.golden. This gate finds a wrong span or a
# dropped field, which the ERROR-only gates miss. `--update` rewrites the golden.
#
# Usage: extract-golden.sh <slug> [--update]

set -uo pipefail

slug="${1:?usage: extract-golden.sh <slug> [--update]}"
update=0
[[ "${2:-}" == "--update" ]] && update=1
ts_lang="${slug//-/_}"

repo="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$repo/tree-sitter-$slug"
parser="$dir/result/parser"
query="$dir/test/extractions_test.scm"
samples_dir="$dir/test/extract-samples"
golden="$dir/test/extractions.golden"

[[ -e "$parser" ]] || { echo "Bail out! no parser at $parser -- run \`just $slug::build\`"; exit 1; }
[[ -f "$query" ]] || { echo "Bail out! no extraction query at $query"; exit 1; }
mapfile -t samples < <(find "$samples_dir" -type f 2>/dev/null | LC_ALL=C sort)
[[ ${#samples[@]} -gt 0 ]] || { echo "Bail out! no samples in $samples_dir"; exit 1; }

# A multi-line capture prints with no index and no `text:` part. Both forms fold
# to `<name>\t<sr>,<sc>-<er>,<ec>\t<text>`.
normalize() { # normalize <sample>
    tree-sitter query --lib-path "$parser" --lang-name "$ts_lang" "$query" "$1" 2>&1 \
        | sed -nE 's/^[[:space:]]*capture: ([0-9]+ - )?([^,]+), start: \(([0-9]+), ([0-9]+)\), end: \(([0-9]+), ([0-9]+)\)(, text: `(.*)`)?$/\2\t\3,\4-\5,\6\t\8/p'
}

block_for() { # block_for <sample> -> the sample's normalized capture lines
    normalize "$1"
}

if [[ $update -eq 1 ]]; then
    {
        for s in "${samples[@]}"; do
            printf '## %s\n' "${s#"$dir"/}"
            block_for "$s"
        done
    } >"$golden"
    echo "updated $golden (${#samples[@]} samples)"
    exit 0
fi

[[ -f "$golden" ]] || { echo "Bail out! no golden at $golden -- run \`just $slug::update-extractions\`"; exit 1; }

golden_block() { # golden_block <relpath>
    awk -v h="## $1" '
        $0 == h { on = 1; next }
        /^## / { on = 0 }
        on { print }
    ' "$golden"
}

echo "TAP version 14"
echo "1..${#samples[@]}"
exit_code=0
i=0
for s in "${samples[@]}"; do
    i=$((i + 1))
    rel="${s#"$dir"/}"
    if d="$(diff <(golden_block "$rel") <(block_for "$s"))"; then
        echo "ok $i - $rel"
    else
        echo "not ok $i - $rel"
        echo "  ---"
        echo "  message: extracted captures differ from golden (< golden, > actual)"
        printf '%s\n' "$d" | sed 's/^/  /'
        echo "  ..."
        exit_code=1
    fi
done
exit "$exit_code"
