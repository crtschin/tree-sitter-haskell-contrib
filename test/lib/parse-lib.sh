#!/usr/bin/env bash
# Shared parse helper for the corpus/injection gates (runners/parse-corpus.sh,
# runners/gen-corpus.sh, runners/validate-injections.sh). Source it, do not execute.
#
# The one thing all three must get right and historically did not: a parser that
# fails to LOAD (missing/stale result/parser, ABI mismatch, crash) makes
# `tree-sitter parse` exit non-zero and print an "Error:" banner with NO per-file
# "Parse:" line. A gate that only scans stdout for (ERROR/(MISSING then finds
# nothing, reports every file `ok`, and exits 0 (green while the grammar is
# non-functional). collect_parse_errors treats that as a hard failure.

# collect_parse_errors <assoc-array-name> <tree-sitter-parse-args...>
#   Runs `tree-sitter parse --quiet <args>`. Callers pass the file list and,
#   when not relying on cwd auto-detection, --lib-path/--lang-name.
#   Returns 2 (diagnostic on stderr) if the parser could not be run. Otherwise
#   fills the named associative array: failing-file-path -> "(ERROR ..)" detail.
#   A clean run leaves it empty and returns 0.
collect_parse_errors() {
    local -n __cpe_out="$1"
    shift
    local __cpe_text __cpe_rc
    __cpe_text="$(tree-sitter parse --quiet "$@" 2>&1)"
    __cpe_rc=$?
    # Under --quiet tree-sitter prints a "<path><pad>\tParse: .. (ERROR/MISSING)"
    # line ONLY for a failing file (nothing for a clean one). A non-zero exit with
    # no such line means the parser never ran: fail loudly, not all-ok.
    if ((__cpe_rc != 0)) && ! grep -q $'\tParse:' <<<"$__cpe_text"; then
        printf 'tree-sitter parse could not run (parser load/ABI failure?):\n%s\n' \
            "$__cpe_text" >&2
        return 2
    fi
    local __cpe_line __cpe_path
    while IFS= read -r __cpe_line; do
        [[ "$__cpe_line" == *$'\t'Parse:* ]] || continue
        [[ "$__cpe_line" == *'(ERROR'* || "$__cpe_line" == *'(MISSING'* ]] || continue
        # Strip tree-sitter's column-alignment padding from the path.
        __cpe_path="${__cpe_line%%$'\t'*}"
        __cpe_path="${__cpe_path%"${__cpe_path##*[![:space:]]}"}"
        __cpe_out["$__cpe_path"]="${__cpe_line##*$'\t'}"
    done <<<"$__cpe_text"
    return 0
}
