#!/usr/bin/env bash
# Rewrite the committed allocation baseline of a grammar, then fail when git
# sees a change. To accept a new number, commit the diff.
#
# The baseline holds three exact integers over the pinned corpus:
#   - input_bytes: the summed size of the corpus files.
#   - nodes: the parse-tree node count.
#   - alloc_blocks: the heap allocation count from valgrind dhat.
#
# The corpus comes from test/files, because gen-corpus dumps are not
# byte-stable. A change to input_bytes means that the corpus pin changed.
#
# alloc_bytes is printed and never committed. The dhat byte total changes with
# the cwd and the path lengths, so it differs between checkouts.
#
# Usage: alloc-golden.sh <slug>

set -uo pipefail

slug="${1:?usage: alloc-golden.sh <slug>}"
ts_lang="${slug//-/_}"

repo="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$repo/tree-sitter-$slug"
parser="$dir/result/parser"
selector="$repo/test/files/${slug}-files.sh"
golden="$dir/test/alloc.golden"

for cmd in tree-sitter valgrind; do
    command -v "$cmd" >/dev/null 2>&1 || {
        echo "Bail out! missing required command: $cmd (enter the nix devShell?)"; exit 1; }
done
[[ -e "$parser" ]] || { echo "Bail out! no parser at $parser -- run \`just $slug::build\`"; exit 1; }
[[ -x "$selector" ]] || { echo "Bail out! no corpus selector at $selector"; exit 1; }

mapfile -t files < <("$selector")
[[ ${#files[@]} -gt 0 ]] || { echo "Bail out! no corpus files from $selector"; exit 1; }

metrics=(input_bytes nodes alloc_blocks)
declare -A cur

cur[input_bytes]=$(cat "${files[@]}" | wc -c)

# `-x` prints one start tag per node and escapes the source text, so
# `<[A-Za-z_]` counts nodes exactly. A file with ERROR exits non-zero, but its
# tree still prints.
cur[nodes]=$(tree-sitter parse -x --lib-path "$parser" --lang-name "$ts_lang" "${files[@]}" 2>/dev/null \
    | grep -coE '<[A-Za-z_]')

dhat_total=$(valgrind --tool=dhat --dhat-out-file=/dev/null -- \
    tree-sitter parse --quiet --lib-path "$parser" --lang-name "$ts_lang" "${files[@]}" 2>&1 \
    | grep -oE 'Total:[[:space:]]+[0-9,]+ bytes in [0-9,]+ blocks')
cur[alloc_bytes]=$(sed -E 's/.*Total:[[:space:]]+([0-9,]+) bytes in ([0-9,]+) blocks/\1/' <<<"$dhat_total" | tr -d ',')
cur[alloc_blocks]=$(sed -E 's/.*Total:[[:space:]]+([0-9,]+) bytes in ([0-9,]+) blocks/\2/' <<<"$dhat_total" | tr -d ',')

for m in "${metrics[@]}" alloc_bytes; do
    [[ "${cur[$m]:-}" =~ ^[0-9]+$ ]] || { echo "Bail out! failed to measure $m (got '${cur[$m]:-}')"; exit 1; }
done

ratios=$(awk -v b="${cur[input_bytes]}" -v n="${cur[nodes]}" \
    -v ab="${cur[alloc_blocks]}" -v ay="${cur[alloc_bytes]}" 'BEGIN {
    printf "nodes_per_byte=%.4f allocs_per_byte=%.4f alloc_bytes_per_byte=%.4f avg_alloc_size=%.1f",
        n/b, ab/b, ay/b, (ab ? ay/ab : 0) }')

declare -A old
[[ -f "$golden" ]] && while read -r k v; do old[$k]="$v"; done <"$golden"
{ for m in "${metrics[@]}"; do printf '%s %s\n' "$m" "${cur[$m]}"; done; } >"$golden"

echo "TAP version 14"
echo "1..1"
echo "# corpus: ${#files[@]} files; $ratios"
# git treats an untracked golden as clean, so commit the first run.
if git -C "$repo" diff --quiet -- "$golden"; then
    echo "ok 1 - $slug alloc.golden ($(tr '\n' ' ' <"$golden"))"
    exit 0
fi
echo "not ok 1 - $slug allocation numbers drifted"
echo "  ---"
echo "  message: baseline rewritten in place; review \`git diff -- $golden\` and commit to accept"
# The ---/+++ lines of a raw diff break the TAP YAML block, so the raw diff
# goes to stderr.
for m in "${metrics[@]}"; do
    [[ "${old[$m]:-}" != "${cur[$m]}" ]] && echo "  $m: ${old[$m]:-<new>} -> ${cur[$m]}"
done
echo "  ..."
git -C "$repo" diff -- "$golden" >&2
exit 1
