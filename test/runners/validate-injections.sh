#!/usr/bin/env bash
# Check the ghc-dump injections. Each section of the harvested dumps goes to the
# grammar that its banner selects in injections.scm, and must parse without
# errors. A section whose banner matches no rule is skipped.

set -uo pipefail

source "$(dirname "$0")/../lib/parse-lib.sh"

: "${GHC_SRC:?GHC_SRC is unset (enter the dev shell)}"

repo="$(cd "$(dirname "$0")/../.." && pwd)"
inj="$repo/tree-sitter-ghc-dump/queries/helix/injections.scm"

# Each `#match?` regex pairs with the next `injection.language`. If a change to
# the query format reads zero rules, the script fails.
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

mapfile -t files < <("$repo/test/files/ghc-files.sh" ghc-dump)

# injections.scm injects the banner with the body, so each section file starts
# with its banner line.
declare -A bucket=()    # lang -> newline-separated body files
declare -A banner_of=() # body file -> its banner
n=0
for f in "${files[@]}"; do
    # Many test directories share the basename `should_compile`, so fid holds
    # the full path. A basename id makes two files overwrite each other.
    rel="${f#"$GHC_SRC"/}"
    rel="${rel#testsuite/tests/}"
    fid="${rel%.stderr}"
    fid="${fid//\//_}"
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

# Sections outside the scope of the member grammar, keyed
# <fileid>_<section-index>.
declare -A known_gaps=(
    [simplCore_should_compile_T23083_1]="CorePrep is a second Core pass; ghc-core models Tidy Core"
    [simplStg_should_compile_T13588_2]="pre-unarise STG omits the binding-terminating ; that ghc-stg requires"
    [simplCore_should_compile_T26615_1]="1900-line two-pass dump; trailing imported-rules dash-section"
)

mapfile -t uniq_langs < <(printf '%s\n' "${langs[@]}" | sort -u)
echo "TAP version 13"
echo "1..${#uniq_langs[@]}"
rc=0
i=0
declare -A hit_gap=()
for lang in "${uniq_langs[@]}"; do
    i=$((i + 1))
    mapfile -t list < <(printf '%s' "${bucket[$lang]:-}" | grep -v '^$')
    parser="$repo/tree-sitter-${lang/ghc_/ghc-}/result/parser"
    if [[ ${#list[@]} -eq 0 ]]; then
        echo "ok $i - $lang (0 sections)"
        continue
    fi
    declare -A sec_err=()
    if ! collect_parse_errors sec_err --lib-path "$parser" --lang-name "$lang" "${list[@]}"; then
        echo "not ok $i - $lang (parser at $parser failed to load)"
        rc=1
        continue
    fi
    unexpected=()
    known=0
    for bf in "${!sec_err[@]}"; do
        sec="${bf##*/}"
        if [[ -n "${known_gaps[$sec]:-}" ]]; then
            known=$((known + 1))
            hit_gap[$sec]=1
        else
            unexpected+=("[${banner_of[$bf]:-?}] $sec")
        fi
    done
    if [[ ${#unexpected[@]} -eq 0 ]]; then
        echo "ok $i - $lang (${#list[@]} sections; $known known gaps)"
    else
        echo "not ok $i - $lang (${#unexpected[@]} unexpected, $known known, of ${#list[@]})"
        printf '#   %s\n' "${unexpected[@]}"
        rc=1
    fi
done

for sec in "${!known_gaps[@]}"; do
    [[ -z "${hit_gap[$sec]:-}" ]] &&
        echo "# stale known-gap (now parses, prune it): $sec"
done

echo "# injection dispatch: $n injectable sections across ${#files[@]} dump streams; ${#known_gaps[@]} known gaps"
exit "$rc"
