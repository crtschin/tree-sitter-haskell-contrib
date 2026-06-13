#!/usr/bin/env bash
# Validate ghc-dump's injection dispatch end to end: for every banner-delimited
# section in the harvested dump streams, classify the banner with the SAME
# (regex -> language) table that queries/injections.scm uses, then parse the
# section body with the dispatched member grammar and assert no ERROR/MISSING.
# This is exactly what an editor's injection does at highlight time, checked
# deterministically -- no GHC compiler, just $GHC_SRC (a flake input) and the
# built member parsers.
#
# The dispatch table is read straight out of injections.scm, so this stays in
# lockstep with the real query. Sections whose banner matches no rule (Demand
# signatures, Cpr signatures, ...) are intentionally not injected, so skipped.

set -uo pipefail

: "${GHC_SRC:?GHC_SRC is unset (enter the dev shell)}"

repo="$(cd "$(dirname "$0")/.." && pwd)"
inj="$repo/tree-sitter-ghc-dump/queries/helix/injections.scm"

# (banner-regex, member-language) dispatch table, read straight out of
# injections.scm so it stays in lockstep. Paired per rule: a rule's `#match?`
# regex is bound to the `injection.language` that follows it, so the two arrays
# can never desync. Hard-fail if nothing parses out (a reformatted/restructured
# query must break loudly, not validate zero sections and pass).
regexes=()
langs=()
rx=""
while IFS= read -r line; do
    if [[ "$line" == *'#match? @_banner "'* ]]; then
        rx="${line#*#match? @_banner \"}"
        rx="${rx%%\"*}"
    fi
    if [[ "$line" == *'injection.language "'* && -n "$rx" ]]; then
        lang="${line#*injection.language \"}"
        lang="${lang%%\"*}"
        regexes+=("$rx")
        langs+=("$lang")
        rx=""
    fi
done <"$inj"
if [[ ${#regexes[@]} -eq 0 ]]; then
    echo "BUG: no (banner-regex -> language) rules read from $inj -- the injection dispatch table is unreadable; refusing to pass." >&2
    exit 1
fi

classify() { # classify <banner> -> echoes the member language, or nothing
    local banner="$1" i
    for i in "${!regexes[@]}"; do
        [[ "$banner" =~ ${regexes[i]} ]] && {
            printf '%s' "${langs[i]}"
            return
        }
    done
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mapfile -t files < <("$repo/test/ghc-files.sh" ghc-dump)

# Split each file into banner-delimited sections and bucket each section file by
# its dispatched member language. injections.scm injects the whole section
# (banner + body), so each section file starts with its banner line.
declare -A bucket=()    # lang -> newline-separated body files
declare -A banner_of=() # body file -> its banner
n=0
for f in "${files[@]}"; do
    # fid is the file's path under testsuite/tests/ with slashes -> underscores,
    # so it is unique across the suite (many dirs share basename `should_compile`,
    # which a basename-only id would collide -- clobbering section temp files and
    # cross-suppressing known gaps).
    rel="${f#"$GHC_SRC"/}"
    rel="${rel#testsuite/tests/}"
    fid="${rel%.stderr}"
    fid="${fid//\//_}"
    # awk prints "banner<TAB>bodyfile" per section and writes each body to a file.
    while IFS=$'\t' read -r banner body; do
        lang="$(classify "$banner")"
        [[ -z "$lang" ]] && continue
        bucket[$lang]+="$body"$'\n'
        banner_of[$body]="$banner"
        n=$((n + 1))
    done < <(awk -v dir="$tmp" -v fid="$fid" '
        /^={4,}.+={4,}[[:space:]]*$/ {
            idx++; out = dir "/" fid "_" idx
            b = $0
            sub(/^={4,}[[:space:]]*/, "", b); sub(/[[:space:]]*={4,}.*$/, "", b)
            print b "\t" out
            print $0 > out  # the section includes its banner line
            active = 1
            next
        }
        active { print >> out }
    ' "$f")
done

# Sections that an in-scope member grammar does not parse, with the reason. Each
# is a variant/appendix dump outside the member's modelled surface; an editor
# leaves it un-highlighted. <fileid>_<section-index> -> reason.
declare -A known_gaps=(
    [simplCore_should_compile_T23083_1]="CorePrep is a second Core pass; ghc-core models Tidy Core"
    [profiling_should_compile_prof-late-cc3_2]="CorePrep is a second Core pass; ghc-core models Tidy Core"
    [simplStg_should_compile_T13588_2]="pre-unarise STG omits the binding-terminating ; that ghc-stg requires"
    [simplCore_should_compile_T26615_1]="1900-line two-pass dump; trailing imported-rules dash-section"
)

mapfile -t uniq_langs < <(printf '%s\n' "${langs[@]}" | sort -u)
echo "TAP version 13"
echo "1..${#uniq_langs[@]}"
rc=0
i=0
declare -A hit_gap=() # which known gaps actually showed up (to flag stale ones)
for lang in "${uniq_langs[@]}"; do
    i=$((i + 1))
    mapfile -t list < <(printf '%s' "${bucket[$lang]:-}" | grep -v '^$')
    parser="$repo/tree-sitter-${lang/ghc_/ghc-}/result/parser"
    if [[ ${#list[@]} -eq 0 ]]; then
        echo "ok $i - $lang (0 sections)"
        continue
    fi
    out="$(tree-sitter parse --quiet --lib-path "$parser" --lang-name "$lang" "${list[@]}" 2>&1)"
    # Partition failing sections into known gaps and unexpected regressions.
    unexpected=()
    known=0
    while IFS= read -r ln; do
        [[ -z "$ln" ]] && continue
        bf="${ln%%[[:space:]]*}" # tree-sitter right-pads the path
        sec="${bf##*/}"
        if [[ -n "${known_gaps[$sec]:-}" ]]; then
            known=$((known + 1))
            hit_gap[$sec]=1
        else
            unexpected+=("[${banner_of[$bf]:-?}] $sec")
        fi
    done < <(grep -E '\(ERROR|\(MISSING' <<<"$out")
    if [[ ${#unexpected[@]} -eq 0 ]]; then
        echo "ok $i - $lang (${#list[@]} sections; $known known gaps)"
    else
        echo "not ok $i - $lang (${#unexpected[@]} unexpected, $known known, of ${#list[@]})"
        printf '#   %s\n' "${unexpected[@]}"
        rc=1
    fi
done

# A known gap that no longer fails means a member grammar grew to cover it --
# flag it so the allowlist gets pruned (warning, not a hard failure).
for sec in "${!known_gaps[@]}"; do
    [[ -z "${hit_gap[$sec]:-}" ]] &&
        echo "# stale known-gap (now parses, prune it): $sec"
done

echo "# injection dispatch: $n injectable sections across ${#files[@]} dump streams; ${#known_gaps[@]} known gaps"
exit "$rc"
