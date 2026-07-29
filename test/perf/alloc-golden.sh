#!/usr/bin/env bash
# Maintain a committed allocation baseline per grammar and flag drift. Unlike
# extract-golden.sh (compare-only, explicit --update), this always rewrites the
# baseline in place from the current build+corpus, then reports whether that
# changed what is committed -- so accepting a new number is just committing the
# diff, and a stale number can never linger. Three exact integers over the
# grammar's pinned corpus (the test/files/<slug>-files.sh selector, i.e. the
# same static $CABAL_SRC/$HLS_SRC/$GHC_SRC checkouts parse-corpus.sh reads --
# NOT gen-corpus.sh, whose freshly compiled dumps are not byte-stable):
#
#   input_bytes   summed size of the corpus file list
#   nodes         parse-tree node count (tree-sitter parse -x element count)
#   alloc_blocks  total heap allocation *count* (valgrind --tool=dhat)
#
# All three are deterministic given (input bytes, generated parser, nix-pinned
# toolchain) and independent of cwd and of path-string lengths. A grammar/
# scanner change that adds a per-token wrapper node or an extra scanner
# allocation moves nodes/alloc_blocks; input_bytes moving instead means the
# corpus pin changed. Either way the file is rewritten and `git diff` flags it.
#
# alloc_bytes (total heap *bytes*) is measured and printed for the human but
# NOT committed: dhat's byte total shifts with the cwd and with --lib-path /
# corpus path-string lengths (some checkout-relative), so it is not portable
# across checkouts. The allocation *count* carries the regression signal.
#
# Slow: one valgrind/dhat process over the whole corpus. Local devShell only
# (needs valgrind); reached via `just test --allocation`. TAP 14 on stdout.
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

# Committed metrics, in fixed order. alloc_bytes is measured too but reported
# only, never committed (see header).
metrics=(input_bytes nodes alloc_blocks)
declare -A cur

cur[input_bytes]=$(cat "${files[@]}" | wc -c)

# `tree-sitter parse -x` emits one XML start tag `<name ...>` per node; closing
# tags start `</` and source text is entity-escaped, so `<[A-Za-z_]` counts
# nodes exactly. Non-zero exit on ERROR-bearing files is fine -- the tree (and
# its node count) is still emitted and deterministic.
cur[nodes]=$(tree-sitter parse -x --lib-path "$parser" --lang-name "$ts_lang" "${files[@]}" 2>/dev/null \
    | grep -coE '<[A-Za-z_]')

# DHAT's exit summary: `Total:     X bytes in Y blocks` (grouped with commas).
dhat_total=$(valgrind --tool=dhat --dhat-out-file=/dev/null -- \
    tree-sitter parse --quiet --lib-path "$parser" --lang-name "$ts_lang" "${files[@]}" 2>&1 \
    | grep -oE 'Total:[[:space:]]+[0-9,]+ bytes in [0-9,]+ blocks')
cur[alloc_bytes]=$(sed -E 's/.*Total:[[:space:]]+([0-9,]+) bytes in ([0-9,]+) blocks/\1/' <<<"$dhat_total" | tr -d ',')
cur[alloc_blocks]=$(sed -E 's/.*Total:[[:space:]]+([0-9,]+) bytes in ([0-9,]+) blocks/\2/' <<<"$dhat_total" | tr -d ',')

for m in "${metrics[@]}" alloc_bytes; do
    [[ "${cur[$m]:-}" =~ ^[0-9]+$ ]] || { echo "Bail out! failed to measure $m (got '${cur[$m]:-}')"; exit 1; }
done

# Derived shapes (the three tracked ratios), printed as a TAP diagnostic only.
ratios=$(awk -v b="${cur[input_bytes]}" -v n="${cur[nodes]}" \
    -v ab="${cur[alloc_blocks]}" -v ay="${cur[alloc_bytes]}" 'BEGIN {
    printf "nodes_per_byte=%.4f allocs_per_byte=%.4f alloc_bytes_per_byte=%.4f avg_alloc_size=%.1f",
        n/b, ab/b, ay/b, (ab ? ay/ab : 0) }')

# Snapshot the previous numbers (for a clean per-metric diagnostic), then
# rewrite the committed baseline in place and let git decide pass/fail.
declare -A old
[[ -f "$golden" ]] && while read -r k v; do old[$k]="$v"; done <"$golden"
{ for m in "${metrics[@]}"; do printf '%s %s\n' "$m" "${cur[$m]}"; done; } >"$golden"

echo "TAP version 14"
echo "1..1"
echo "# corpus: ${#files[@]} files; $ratios"
# `git diff --quiet` is working-tree-vs-index: clean (exit 0) when the rewrite
# matches what is committed/staged, dirty (exit 1) when a number drifted -- or
# the file is untracked on first run, which git treats as clean, so commit it
# to arm the guard.
if git -C "$repo" diff --quiet -- "$golden"; then
    echo "ok 1 - $slug alloc.golden ($(tr '\n' ' ' <"$golden"))"
    exit 0
fi
echo "not ok 1 - $slug allocation numbers drifted"
echo "  ---"
echo "  message: baseline rewritten in place; review \`git diff -- $golden\` and commit to accept"
# The raw diff (with its own ---/+++ markers) would break the TAP YAML block, so
# summarize old -> new per metric here and send the full diff to stderr.
for m in "${metrics[@]}"; do
    [[ "${old[$m]:-}" != "${cur[$m]}" ]] && echo "  $m: ${old[$m]:-<new>} -> ${cur[$m]}"
done
echo "  ..."
git -C "$repo" diff -- "$golden" >&2
exit 1
