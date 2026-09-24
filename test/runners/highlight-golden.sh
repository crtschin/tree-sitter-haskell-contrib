#!/usr/bin/env bash
# Run `tree-sitter highlight` over test/extract-samples/* and diff the winning
# capture of each token against test/highlights.golden. check-queries.sh cannot
# see which of two overlapping patterns wins. See Note [Later pattern wins] in
# tree-sitter-cabal/queries/helix/highlights.scm.
#
# This gate cannot find:
#   - A capture name that no editor theme defines, because the theme comes from
#     the queries under test.
#   - A golden block whose sample file is gone.
#
# Usage: highlight-golden.sh <slug> [--update]

set -uo pipefail

slug="${1:?usage: highlight-golden.sh <slug> [--update]}"
update=0
[[ "${2:-}" == "--update" ]] && update=1

repo="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$repo/tree-sitter-$slug"
samples_dir="$dir/test/extract-samples"
golden="$dir/test/highlights.golden"

[[ -d "$dir/queries" ]] || { echo "Bail out! no queries dir at $dir/queries"; exit 1; }
mapfile -t samples < <(find "$samples_dir" -type f 2>/dev/null | LC_ALL=C sort)
[[ ${#samples[@]} -gt 0 ]] || { echo "Bail out! no samples in $samples_dir"; exit 1; }

# The theme keys are every capture name in the queries. A capture that is not a
# key collapses to its nearest ancestor, e.g. `keyword.type` to `keyword`.
config="$(mktemp -d)/config.json"
trap 'rm -rf "$(dirname "$config")"' EXIT
{
    printf '{"parser-directories":[],"theme":{'
    grep -ohE '@[a-z][a-z0-9._]*' "$dir"/queries/*/*.scm \
        | sed 's/^@//' | LC_ALL=C sort -u \
        | awk 'NR>1 { printf "," } { printf "\"%s\":\"#000000\"", $0 }'
    printf '}}\n'
} >"$config"

# Emit one `<line>\t<capture>\t<text>` per run of highlighted text.
#
# The stack decodes nested spans, and the innermost class wins. A non-greedy
# `<span ...>(.*?)</span>` closes the outer span on the inner tag and truncates
# the text.
normalize() { # normalize <sample>
    ( cd "$dir" && tree-sitter highlight --html --css-classes --config-path "$config" "$1" 2>/dev/null ) \
        | sed -n '/<table>/,/<\/table>/p' \
        | python3 -c '
import html, re, sys

LINE = re.compile(r"<td class=line-number>(\d+)</td>")
CELL = re.compile(r"<td class=line>(.*?)</td>", re.S)
TOKEN = re.compile(r"<span class=[\x27\"]([^\x27\"]*)[\x27\"]>|</span>|([^<]+)")

for row in sys.stdin.read().split("<tr>"):
    num, cell = LINE.search(row), CELL.search(row)
    if not (num and cell):
        continue
    lineno, stack = int(num.group(1)), []
    for m in TOKEN.finditer(cell.group(1)):
        opened, text = m.group(1), m.group(2)
        if opened is not None:
            stack.append(opened)
        elif text is None:
            if stack:
                stack.pop()
        else:
            text = html.unescape(text)
            if stack and text.strip():
                print(f"{lineno}\t{stack[-1]}\t{text}")
'
}

block_for() { # block_for <sample>
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

[[ -f "$golden" ]] || { echo "Bail out! no golden at $golden -- run \`just $slug::update-highlights\`"; exit 1; }

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
        echo "  message: resolved highlights differ from golden (< golden, > actual)"
        printf '%s\n' "$d" | sed 's/^/  /'
        echo "  ..."
        exit_code=1
    fi
done
exit "$exit_code"
