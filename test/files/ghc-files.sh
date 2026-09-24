#!/usr/bin/env bash
# Emit the .stderr files in the $GHC_SRC testsuite that hold the phase banner
# of one IL. ghc-dump takes the union of every IL banner.
#
# The banner selects the file because one .stderr holds every enabled dump pass
# plus warnings. A file with several passes can go into more than one corpus.
#
# Usage: ghc-files.sh <ghc-core|ghc-stg|ghc-cmm|ghc-dump>

set -uo pipefail

: "${GHC_SRC:?GHC_SRC is unset (enter the dev shell)}"

lang="${1:?usage: $0 <ghc-core|ghc-stg|ghc-cmm|ghc-dump>}"
# Keep each pattern in step with the banner rule of its grammar. ghc-core models
# Tidy Core alone, so Desugar and CorePrep stay out.
case "$lang" in
    ghc-core) banner='={4,} Tidy Core' ;;
    ghc-stg)  banner='={4,} .*STG' ;;
    ghc-cmm)  banner='={4,} (Output Cmm|Cmm produced by codegen)' ;;
    ghc-dump) banner='={4,} (Tidy Core|Desugar|CorePrep|.*STG|Output Cmm|Cmm produced by codegen)' ;;
    *) echo "unknown lang: $lang  (ghc-core|ghc-stg|ghc-cmm|ghc-dump)" >&2; exit 64 ;;
esac

matches="$(grep -rlE "$banner" "$GHC_SRC/testsuite/tests" --include='*.stderr')"

# ghc-core models one Core dump. A file passes when its first non-blank line is
# a `Tidy Core` banner and it holds at most one `Result size of` line. This test
# drops compile logs, signature dumps, and a second Core pass such as CorePrep.
# A trailing `Tidy Core rules` appendix has no `Result size`, so it stays.
if [[ "$lang" == ghc-core ]]; then
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        first="$(grep -m1 -vE '^[[:space:]]*$' "$f")"
        [[ "$first" == ====*"Tidy Core"* ]] || continue
        [[ "$(grep -c 'Result size of' "$f")" -le 1 ]] && printf '%s\n' "$f"
    done <<<"$matches" | LC_ALL=C sort
elif [[ "$lang" == ghc-stg ]]; then
    # Keep single-banner files. Pre-unarise STG omits the `;` after each
    # binding, and ghc-stg requires it.
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        [[ "$(grep -cE '^={4,}' "$f")" -eq 1 ]] && printf '%s\n' "$f"
    done <<<"$matches" | LC_ALL=C sort
else
    printf '%s\n' "$matches" | LC_ALL=C sort
fi
