#!/usr/bin/env bash
# Emit the harvested dump fixtures for one GHC IL grammar: the .stderr files in
# $GHC_SRC's testsuite that carry that IL's phase banner. This is the committed
# corpus gate (no GHC compiler needed, since $GHC_SRC is a flake input). The
# comprehensive generated matrix is ephemeral. See test/runners/gen-corpus.sh.
#
# Selection is by banner content, not extension:
#
#   - A .stderr captures every enabled -ddump-* pass (Core, STG, Cmm, ...) plus
#     warnings, so the file name does not identify the IL.
#   - A .stderr that enabled several passes can appear in more than one IL's
#     corpus. That is accepted while the grammars are scaffolds. The container
#     grammar is the proper home for such mixed streams.
#
# Usage: ghc-files.sh <ghc-core|ghc-stg|ghc-cmm|ghc-dump>
#
# ghc-dump (the container) takes the union of every IL banner.

set -uo pipefail

: "${GHC_SRC:?GHC_SRC is unset (enter the dev shell)}"

lang="${1:?usage: $0 <ghc-core|ghc-stg|ghc-cmm|ghc-dump>}"
# Banners mirror the grammars' banner rule (={4,}...). Core stays scoped to
# Tidy Core (what the grammar models). ds/prep are Core too, excluded for now.
case "$lang" in
    ghc-core) banner='={4,} Tidy Core' ;;
    ghc-stg)  banner='={4,} .*STG' ;;
    ghc-cmm)  banner='={4,} (Output Cmm|Cmm produced by codegen)' ;;
    ghc-dump) banner='={4,} (Tidy Core|Desugar|CorePrep|.*STG|Output Cmm|Cmm produced by codegen)' ;;
    *) echo "unknown lang: $lang  (ghc-core|ghc-stg|ghc-cmm|ghc-dump)" >&2; exit 64 ;;
esac

matches="$(grep -rlE "$banner" "$GHC_SRC/testsuite/tests" --include='*.stderr')"

# ghc-core models a single Core dump, so keep only files whose first non-blank
# line is a `Tidy Core` banner and that contain at most one `Result size of`
# line. This drops multi-dump captures:
#
#   - Compile logs (`[N of M] Compiling`/warnings/TYPE SIGNATURES).
#   - Demand/Cpr-signature dumps.
#   - Second full Core passes appended to the Tidy Core (e.g. CorePrep, which
#     has its own `Result size`).
#
# All of those are the container grammar's domain. A trailing `Tidy Core rules`
# appendix (no `Result size`) is kept and handled.
if [[ "$lang" == ghc-core ]]; then
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        first="$(grep -m1 -vE '^[[:space:]]*$' "$f")"
        [[ "$first" == ====*"Tidy Core"* ]] || continue
        [[ "$(grep -c 'Result size of' "$f")" -le 1 ]] && printf '%s\n' "$f"
    done <<<"$matches" | LC_ALL=C sort
elif [[ "$lang" == ghc-stg ]]; then
    # A single STG dump section carries exactly one banner. Multi-section
    # captures (e.g. Pre unarise + STG syntax, whose pre-unarise bindings omit
    # the trailing `;` that otherwise delimits every STG binding) are the
    # container grammar's domain, so keep only single-banner files.
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        [[ "$(grep -cE '^={4,}' "$f")" -eq 1 ]] && printf '%s\n' "$f"
    done <<<"$matches" | LC_ALL=C sort
else
    printf '%s\n' "$matches" | LC_ALL=C sort
fi
