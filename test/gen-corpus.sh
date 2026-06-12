#!/usr/bin/env bash
# Generate an EPHEMERAL GHC dump matrix for one grammar, parse every file with
# the freshly-built grammar (result/parser), report parse errors, then delete
# everything. NOTHING is committed: the dumps live in a `mktemp` directory that
# is removed on exit, so a rerun always starts from a clean slate (rewrite on
# rerun + guaranteed cleanup). This is the on-demand coverage check for grammar
# development -- it is deliberately NOT part of `just test`/CI, which would
# otherwise need a GHC compiler.
#
# Pulls GHC on demand via `nix shell`. Run from a grammar dir after `just build`
# (it parses with ./result/parser).
#
# Usage: gen-corpus.sh <ghc-core|ghc-stg|ghc-cmm|ghc-dump>

set -uo pipefail

lang="${1:?usage: $0 <ghc-core|ghc-stg|ghc-cmm|ghc-dump>}"
case "$lang" in
    ghc-core | ghc-stg | ghc-cmm | ghc-dump) ;;
    *) echo "unknown lang: $lang" >&2; exit 64 ;;
esac

repo="$(cd "$(dirname "$0")/.." && pwd)"
parser_dir="$repo/tree-sitter-$lang/result/parser"
ts_lang="${lang/ghc-/ghc_}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# One `nix shell` amortises the slow GHC closure realisation across every
# compile. The quoted heredoc runs inside it; $GEN_* come from the environment.
GEN_TMP="$tmp" GEN_REPO="$repo" GEN_LANG="$lang" \
    nix shell --inputs-from "$repo" nixpkgs#ghc --command bash -s <<'GEN'
set -uo pipefail
cd "$GEN_REPO"

# Compile one fixture with the given dump flags; -ddump-to-file routes each pass
# to its own <sub>/<Module>.dump-<pass> file. Each cell gets a distinct
# -outputdir (GHC aliases dumpdir to it), so different format cells don't
# overwrite each other's <Module>.dump-simpl. Failures (a fixture that rejects a
# flag combo) are tolerated -- coverage is best-effort per cell.
emit() { # emit <out-subdir> <ghc-flags...>
    local sub="$1"; shift
    local hs
    for hs in test/fixtures/*.hs; do
        ghc -c -fforce-recomp -O2 "$@" -ddump-to-file \
            -outputdir "$GEN_TMP/$sub" "$hs" >/dev/null 2>&1 || true
    done
}

case "$GEN_LANG" in
    ghc-core)
        passes="-ddump-ds -ddump-ds-preopt -ddump-simpl -ddump-simpl-iterations \
                -ddump-spec -ddump-spec-constr -ddump-prep -ddump-late-cc -ddump-cse \
                -ddump-float-out -ddump-float-in -ddump-liberate-case \
                -ddump-worker-wrapper -ddump-call-arity -ddump-exitify \
                -ddump-occur-anal -ddump-static-argument-transformation -ddump-rules"
        # All Core-emitting passes at the default format (one compile per fixture).
        emit passes $passes
        # The simpl pass across the full display-format matrix.
        formats=(
            "default:"
            "suppress-all:-dsuppress-all"
            "suppress-uniques:-dsuppress-uniques"
            "suppress-idinfo:-dsuppress-idinfo"
            "suppress-coercions:-dsuppress-coercions"
            "suppress-modprefix:-dsuppress-module-prefixes"
            "suppress-tyapps:-dsuppress-type-applications"
            "explicit-foralls-kinds:-fprint-explicit-foralls -fprint-explicit-kinds"
            "explicit-coercions:-fprint-explicit-coercions"
            "explicit-runtimereps:-fprint-explicit-runtime-reps"
            "unicode:-fprint-unicode-syntax"
            "ppr-debug:-dppr-debug"
            "case-as-let:-dppr-case-as-let"
            "ticks:-g3"
        )
        for fmt in "${formats[@]}"; do
            emit "${fmt%%:*}" -ddump-simpl ${fmt#*:}
        done
        ;;
    ghc-stg)
        emit passes -ddump-stg-final -ddump-stg-from-core
        emit suppress-uniques -ddump-stg-final -dsuppress-uniques
        ;;
    ghc-cmm)
        emit passes -ddump-cmm -ddump-cmm-from-stg
        emit suppress-uniques -ddump-cmm -dsuppress-uniques
        ;;
    ghc-dump)
        # The container consumes a multi-IL stream: several -ddump passes to
        # stdout in one compile (NOT -ddump-to-file, which would split them).
        for hs in test/fixtures/*.hs; do
            mod="$(basename "$hs" .hs)"
            ghc -c -fforce-recomp -O2 -ddump-simpl -ddump-stg-final -ddump-cmm \
                -outputdir "$GEN_TMP/o" "$hs" >"$GEN_TMP/$mod.mixed.dump" 2>/dev/null || true
        done
        ;;
esac
GEN

# Drop GHC's wall-clock timestamp line (a -ddump-to-file artifact absent from
# stderr dumps) so what we parse matches the real-world surface.
find "$tmp" -type f \( -name '*.dump-*' -o -name '*.dump' \) \
    -exec sed -i -E '/^[0-9]{4}-[0-9]{2}-[0-9]{2} .*UTC$/d' {} +

mapfile -t files < <(find "$tmp" -type f \( -name '*.dump-*' -o -name '*.dump' \) | LC_ALL=C sort)
n=${#files[@]}
if [[ $n -eq 0 ]]; then
    echo "no dumps generated for $lang (did the fixtures compile?)" >&2
    exit 1
fi
if [[ ! -e "$parser_dir" ]]; then
    echo "no parser at $parser_dir -- run \`just build\` first" >&2
    exit 1
fi

# Batch-parse; tree-sitter prints a line per file and exits non-zero on any error.
parse_out="$(tree-sitter parse --quiet --lib-path "$parser_dir" --lang-name "$ts_lang" "${files[@]}" 2>&1)"
fails=0
while IFS= read -r line; do
    [[ "$line" == *'(ERROR'* || "$line" == *'(MISSING'* ]] && {
        fails=$((fails + 1))
        echo "FAIL ${line%%$'\t'*}"
    }
done <<<"$parse_out"

echo "# $lang: $((n - fails))/$n dumps parsed cleanly; $fails with errors (ephemeral, $tmp removed)"
[[ $fails -eq 0 ]]
