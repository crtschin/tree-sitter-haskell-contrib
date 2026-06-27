#!/usr/bin/env bash
# Generate an EPHEMERAL GHC dump matrix for one grammar, parse every file with
# the freshly-built grammar (result/parser), report parse errors, then delete
# everything. NOTHING is committed: the dumps live in a `mktemp` directory that
# is removed on exit, so a rerun always starts from a clean slate (rewrite on
# rerun + guaranteed cleanup). This is the on-demand coverage check for grammar
# development; the default single-version run is also part of `just test`/CI (via
# _il-test), which pulls one GHC compiler.
#
# Pulls GHC on demand via `nix shell`. Run from a grammar dir after `just build`
# (it parses with ./result/parser).
#
# Usage: gen-corpus.sh <ghc-core|ghc-stg|ghc-cmm|ghc-dump> [all | <ghc-attr>...]
#   (no selector)  the default GHC (nixpkgs#ghc); what `just test`/CI exercises
#   all            every version in flake.nix `ghcVersions` (opt-in; heavy)
#   <ghc-attr>...  explicit nixpkgs haskell.compiler attrs, e.g. ghc96 ghc98
# The selector may also come from $GEN_GHC (same values), letting `just test
# --all` opt into the matrix without changing the shared _il-test invocation.

set -uo pipefail

source "$(dirname "$0")/parse-lib.sh"

lang="${1:?usage: $0 <ghc-core|ghc-stg|ghc-cmm|ghc-dump>}"
case "$lang" in
    ghc-core | ghc-stg | ghc-cmm | ghc-dump) ;;
    *) echo "unknown lang: $lang" >&2; exit 64 ;;
esac

repo="$(cd "$(dirname "$0")/.." && pwd)"
parser_dir="$repo/tree-sitter-$lang/result/parser"
ts_lang="${lang/ghc-/ghc_}"

# Version selector: positional args after <lang>, else $GEN_GHC (so `just test
# --all` can opt in without a positional). `all` -> the flake's `ghcVersions`
# (read jq-free as a space-joined string); otherwise space-separated nixpkgs
# haskell.compiler attrs; nothing -> the default GHC.
sel=("${@:2}")
[[ ${#sel[@]} -eq 0 && -n "${GEN_GHC:-}" ]] && read -ra sel <<<"$GEN_GHC"
versions=("default")
if [[ "${sel[0]:-}" == "all" ]]; then
    read -ra versions < <(nix eval --inputs-from "$repo" "$repo"#ghcVersions \
        --apply 'builtins.concatStringsSep " "' --raw)
    [[ ${#versions[@]} -eq 0 ]] && { echo "no ghcVersions in flake" >&2; exit 1; }
elif [[ ${#sel[@]} -gt 0 ]]; then
    versions=("${sel[@]}")
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# One `nix shell` per version amortises the slow GHC closure realisation across
# every compile of that version. The quoted heredoc runs inside it; $GEN_* come
# from the environment, with $GEN_TMP namespacing each version's output.
generate_for() { # generate_for <nix-ref> <out-dir>
    mkdir -p "$2"
    GEN_TMP="$2" GEN_REPO="$repo" GEN_LANG="$lang" \
        nix shell --inputs-from "$repo" "$1" --command bash -s <<'GEN'
set -uo pipefail
cd "$GEN_REPO"

# Compile one fixture with the given dump flags. -ddump-to-file routes each pass
# to its own <sub>/<Module>.dump-<pass> file. Each cell gets a distinct
# -outputdir (GHC aliases dumpdir to it), so different format cells don't
# overwrite each other's <Module>.dump-simpl. Failures (a fixture that rejects a
# flag combo) are tolerated. Coverage is best-effort per cell.
emit() { # emit <out-subdir> <ghc-flags...>
    local sub="$1"; shift
    local hs
    for hs in test/fixtures/*.hs; do
        ghc -c -fforce-recomp -O2 "$@" -ddump-to-file \
            -outputdir "$GEN_TMP/$sub" "$hs" >/dev/null 2>&1 || true
    done
}

# Each IL grammar sets `passes` (every dump flag of that IL, emitted at the
# default format in one compile per fixture) and a `formats` display matrix
# applied to `fmt_pass` (one representative pass). The shared loop below runs
# them. ghc-dump is special (a multi-IL stream). Inapplicable cells produce
# no dump (the parse step only sees files that were generated).
case "$GEN_LANG" in
    ghc-core)
        passes="-ddump-ds -ddump-ds-preopt -ddump-simpl -ddump-simpl-iterations \
                -ddump-spec -ddump-spec-constr -ddump-prep -ddump-late-cc -ddump-cse \
                -ddump-float-out -ddump-float-in -ddump-liberate-case \
                -ddump-worker-wrapper -ddump-call-arity -ddump-exitify \
                -ddump-occur-anal -ddump-static-argument-transformation -ddump-rules"
        fmt_pass="-ddump-simpl"
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
        ;;
    ghc-stg)
        passes="-ddump-stg-from-core -ddump-stg-unarised -ddump-stg-final \
                -ddump-stg-cg -ddump-stg-tags"
        fmt_pass="-ddump-stg-final"
        formats=(
            "default:"
            "suppress-all:-dsuppress-all"
            "suppress-uniques:-dsuppress-uniques"
            "suppress-idinfo:-dsuppress-idinfo"
            "suppress-modprefix:-dsuppress-module-prefixes"
            "suppress-tyapps:-dsuppress-type-applications"
            "suppress-stg-free-vars:-dsuppress-stg-free-vars"
            "suppress-stg-exts:-dsuppress-stg-exts"
            "suppress-stg-reps:-dsuppress-stg-reps"
            "explicit-foralls-kinds:-fprint-explicit-foralls -fprint-explicit-kinds"
            "explicit-runtimereps:-fprint-explicit-runtime-reps"
            "unicode:-fprint-unicode-syntax"
            "ppr-debug:-dppr-debug"
            "ticks:-g3"
        )
        ;;
    ghc-cmm)
        passes="-ddump-cmm -ddump-cmm-from-stg -ddump-cmm-raw -ddump-cmm-verbose \
                -ddump-cmm-cfg -ddump-cmm-cbe -ddump-cmm-switch -ddump-cmm-proc \
                -ddump-cmm-sp -ddump-cmm-sink -ddump-cmm-caf -ddump-cmm-procmap \
                -ddump-cmm-info -ddump-cmm-cps -ddump-cmm-opt -ddump-opt-cmm"
        fmt_pass="-ddump-cmm"
        # Cmm has no Haskell types/coercions, so only the IL-agnostic formats.
        formats=(
            "default:"
            "suppress-all:-dsuppress-all"
            "suppress-uniques:-dsuppress-uniques"
            "ppr-debug:-dppr-debug"
            "ticks:-g3"
        )
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

# Shared emit for the IL grammars: every pass at default format, then the
# representative pass across the display-format matrix.
if [[ -n "${passes:-}" ]]; then
    emit passes $passes
    for fmt in "${formats[@]}"; do
        emit "${fmt%%:*}" "$fmt_pass" ${fmt#*:}
    done
fi
GEN
}

for v in "${versions[@]}"; do
    [[ "$v" == default ]] && ref="nixpkgs#ghc" || ref="nixpkgs#haskell.compiler.$v"
    generate_for "$ref" "$tmp/$v" || echo "warning: generation failed for $v" >&2
done

# Drop GHC's wall-clock timestamp line (a -ddump-to-file artifact absent from
# stderr dumps) so what we parse matches the real-world surface.
find "$tmp" -type f \( -name '*.dump-*' -o -name '*.dump' \) \
    -exec sed -i -E '/^[0-9]{4}-[0-9]{2}-[0-9]{2} .*UTC$/d' {} +

mapfile -t files < <(find "$tmp" -type f \( -name '*.dump-*' -o -name '*.dump' \) | LC_ALL=C sort)
n=${#files[@]}
echo "TAP version 14"
echo "1..$n"
if [[ $n -eq 0 ]]; then
    echo "Bail out! no dumps generated for $lang (did the fixtures compile?)"
    exit 1
fi
if [[ ! -e "$parser_dir" ]]; then
    echo "Bail out! no parser at $parser_dir -- run \`just $lang::build\` first"
    exit 1
fi

# Single-pass batch parse via the shared helper. A parser that fails to load is
# a Bail out, not a silent all-ok pass.
declare -A error_for=()
if ! collect_parse_errors error_for --lib-path "$parser_dir" --lang-name "$ts_lang" "${files[@]}"; then
    echo "Bail out! parser at $parser_dir failed to load"
    exit 1
fi

# Known long-tail gaps (<format-cell>/<Module>.dump-<pass> labels): cells whose
# generated dump is outside the grammar's modelled scope. That covers a
# non-Tidy-Core pass (CorePrep, a Float-out pass header, a multi-iteration
# dump), an analysis dump in a non-IL format (Cmm CAFEnv), or an exotic
# -dppr/-fprint display format. Emitted as TAP `# TODO` so they stay visible
# without failing the gate. A NEW failure outside this set still fails.
declare -A xfail=()
# The structural gaps below hold for EVERY fixture regardless of content (a
# scanner limitation, or a wholesale-out-of-scope display format), so they are
# keyed off the fixture set rather than a hand-maintained module list -- a new
# fixture is covered without editing this file. Content-specific cells are still
# listed individually so a NEW such failure fails the gate.
mods=()
for hs in "$repo"/test/fixtures/*.hs; do mods+=("$(basename "$hs" .hs)"); done
case "$lang" in
ghc-core) ;; # no remaining gaps
ghc-cmm)
    for m in "${mods[@]}"; do
        xfail["ppr-debug/$m.dump-cmm"]="heavily-decorated -dppr-debug developer format (package prefixes, unique tags throughout)"
    done
    ;;
ghc-stg)
    for m in "${mods[@]}"; do
        xfail["ppr-debug/$m.dump-stg-final"]="heavily-decorated -dppr-debug developer format (type ascriptions, unique tags throughout)"
    done
    ;;
esac

exit_code=0
i=0
for f in "${files[@]}"; do
    i=$((i + 1))
    label="${f#"$tmp"/}"
    label="${label/test\/fixtures\//}" # drop the source-path noise GHC mirrors
    # label carries a leading "<version>/" segment; xfail keys are
    # version-agnostic, so match on the stripped key, but let a version-qualified
    # key win if one is ever added.
    xkey="${label#*/}"
    reason="${xfail[$label]:-${xfail[$xkey]:-}}"
    todo=""
    [[ -n "$reason" ]] && todo=" # TODO $reason"
    if [[ -n "${error_for[$f]:-}" ]]; then
        echo "not ok $i - $label$todo"
        echo "  ---"
        echo "  error: ${error_for[$f]}"
        echo "  ..."
        # Only an unexpected (non-xfail) failure fails the gate.
        [[ -z "$reason" ]] && exit_code=1
    else
        echo "ok $i - $label$todo"
    fi
done
exit "$exit_code"
