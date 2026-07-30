#!/usr/bin/env bash
# Diff the resolved highlighting against a golden. Runs `tree-sitter highlight`
# over a grammar's committed test/extract-samples/* and compares the winning
# capture per token against test/highlights.golden.
#
# check-queries.sh only proves each queries/*.scm parses against the grammar. It
# cannot see which pattern wins where two overlap, nor that a capture name is one
# nothing recognises. Both have bitten here. See Note [Later pattern wins] in
# tree-sitter-cabal/queries/helix/highlights.scm.
#
# `--css-classes` emits capture names as classes, so the golden carries no theme
# colours. Classes still come from the config theme's keys, and a capture missing
# there collapses to its nearest ancestor (`keyword.type` -> `keyword`), so the
# theme is derived from the query files on every run instead of committed.
#
# `--update` rewrites the golden. TAP 14 on stdout, one test per sample file. Run
# from anywhere.
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

# Keys are every capture name this grammar's queries use, so `--css-classes`
# reports each capture verbatim. The colours are never read.
config="$(mktemp -d)/config.json"
trap 'rm -rf "$(dirname "$config")"' EXIT
{
    printf '{"parser-directories":[],"theme":{'
    grep -ohE '@[a-z][a-z0-9._]*' "$dir"/queries/*/*.scm \
        | sed 's/^@//' | LC_ALL=C sort -u \
        | awk 'NR>1 { printf "," } { printf "\"%s\":\"#000000\"", $0 }'
    printf '}}\n'
} >"$config"

# One `<line>\t<capture>\t<text>` per run of highlighted text, in source order. Text no
# pattern captured is skipped, so a capture that stops matching shows up as a missing
# line, the regression worth catching. Class names come back space-separated
# (`string special path`). Keep that form, it is what the CLI emits.
#
# The stack decodes nesting. A capture on a container node wraps the captures on its
# descendants, the CLI renders that as nested spans, and the innermost open class governs
# the text. A non-greedy `<span ...>(.*?)</span>` would close the outer span on the inner
# tag and silently record truncated text. Nothing nests today, but nesting is how one
# capture spatially overrides another, which is what this gate watches.
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
