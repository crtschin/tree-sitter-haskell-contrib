#!/usr/bin/env bash
# Validate that every editor query (tree-sitter-<slug>/queries/*/*.scm, e.g.
# queries/helix/highlights.scm) compiles against the grammar. `tree-sitter
# query` checks each referenced node type and field against the parser. A
# query that drifts from the grammar, such as a node renamed or removed after a
# grammar change, fails here before it can silently break an editor's
# highlighting. Custom predicates (#not-one-line? etc.) are passed through.
# TAP output. Run via `just <grammar>::check-queries`.

set -uo pipefail

slug="${1:?usage: check-queries.sh <grammar-slug>}"
ts_lang="${slug//-/_}" # cabal-project -> cabal_project, ghc-core -> ghc_core

repo="$(cd "$(dirname "$0")/.." && pwd)"
dir="$repo/tree-sitter-$slug"
parser="$dir/result/parser"
[[ -e "$parser" ]] || {
    echo "no parser at $parser -- run \`just $slug::build\`" >&2
    exit 1
}

# Query compilation is independent of the input. `tree-sitter query` still needs
# a file to parse, so use the grammar's first corpus file.
sample="$("$repo/test/${slug}-files.sh" 2>/dev/null | head -1)"
[[ -n "$sample" ]] || {
    echo "no corpus sample for $slug (is CABAL_SRC/GHC_SRC set?)" >&2
    exit 1
}

mapfile -t queries < <(find "$dir/queries" -name '*.scm' | LC_ALL=C sort)

echo "TAP version 13"
echo "1..${#queries[@]}"
rc=0
i=0
for q in "${queries[@]}"; do
    i=$((i + 1))
    if err="$(tree-sitter query --quiet --lib-path "$parser" --lang-name "$ts_lang" "$q" "$sample" 2>&1)"; then
        echo "ok $i - ${q#"$repo"/}"
    else
        echo "not ok $i - ${q#"$repo"/}"
        sed 's/^/#   /' <<<"$err"
        rc=1
    fi
done
exit "$rc"
