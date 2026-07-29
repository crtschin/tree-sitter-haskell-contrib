#!/usr/bin/env bash
# Assert RESOLVED highlighting, not merely that a query file compiles: run
# `tree-sitter highlight` over a grammar's committed test/extract-samples/* and diff
# the winning capture per token against test/highlights.golden.
#
# check-queries.sh only proves each queries/*.scm parses against the grammar. It
# cannot see which pattern wins when two overlap, so a more specific pattern that
# silently shadows a general one, or captures under a name nothing recognises,
# passes it. Both happen in practice: the .cabal prose-period rule in
# highlights.scm is exactly such an override, and its first draft blanked the
# `description` field name by capturing it as `@_prose_field`.
#
# `--css-classes` emits the capture name as a class instead of a theme colour, so
# the golden is theme-independent. The class is chosen from the config theme's
# keys, though, and any capture missing from it collapses to its nearest ancestor
# (`keyword.type` -> `keyword`). The theme is therefore derived from the query
# files on every run rather than committed, so it cannot drift out of date.
#
# Regenerate-and-diff, like the repo's other drift guards: `--update` rewrites the
# golden. TAP 14 on stdout, one test per sample file. Run from anywhere.
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

# A theme whose keys are every capture name any of this grammar's queries use, so
# `--css-classes` reports each capture verbatim. Colours are irrelevant here.
config="$(mktemp -d)/config.json"
trap 'rm -rf "$(dirname "$config")"' EXIT
{
    printf '{"parser-directories":[],"theme":{'
    grep -ohE '@[a-z][a-z0-9._]*' "$dir"/queries/*/*.scm \
        | sed 's/^@//' | LC_ALL=C sort -u \
        | awk 'NR>1 { printf "," } { printf "\"%s\":\"#000000\"", $0 }'
    printf '}}\n'
} >"$config"

# One `<line>\t<capture>\t<text>` per highlighted token, in source order. Tokens no
# pattern captured are skipped: a capture that stops matching shows up as a missing
# line, which is the regression worth catching. Class names come back
# space-separated (`string special path`); keep that form, it is what the CLI emits.
normalize() { # normalize <sample>
    ( cd "$dir" && tree-sitter highlight --html --css-classes --config-path "$config" "$1" 2>/dev/null ) \
        | sed -n '/<table>/,/<\/table>/p' \
        | python3 -c '
import html, re, sys

LINE = re.compile(r"<td class=line-number>(\d+)</td>")
SPAN = re.compile(r"<span class=.([^\x27\"]*).>(.*?)</span>", re.S)

lineno = 0
for row in sys.stdin.read().split("<tr>"):
    m = LINE.search(row)
    if not m:
        continue
    lineno = int(m.group(1))
    for cap, text in SPAN.findall(row):
        text = html.unescape(text)
        if text.strip():
            print(f"{lineno}\t{cap}\t{text}")
'
}

block_for() { # block_for <sample> -> the sample's normalized highlight lines
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
