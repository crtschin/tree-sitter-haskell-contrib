#!/usr/bin/env bash
# Parse helper for the corpus gates. Source it.
#
# A parser that fails to load prints no per-file line. A gate that only scans for
# (ERROR and (MISSING then reports every file as ok. Use this helper, because it
# fails on that case.

# collect_parse_errors <assoc-array-name> <tree-sitter-parse-args...>
#   Fills the array with failing path -> "(ERROR ..)" detail and returns 0.
#   Returns 2 if the parser did not run.
collect_parse_errors() {
    local -n __cpe_out="$1"
    shift
    local __cpe_text __cpe_rc
    __cpe_text="$(tree-sitter parse --quiet "$@" 2>&1)"
    __cpe_rc=$?
    # --quiet prints a "Parse:" line for a failing file alone. A non-zero exit
    # with no such line means that the parser never ran.
    if ((__cpe_rc != 0)) && ! grep -q $'\tParse:' <<<"$__cpe_text"; then
        printf 'tree-sitter parse could not run (parser load/ABI failure?):\n%s\n' \
            "$__cpe_text" >&2
        return 2
    fi
    local __cpe_line __cpe_path
    while IFS= read -r __cpe_line; do
        [[ "$__cpe_line" == *$'\t'Parse:* ]] || continue
        [[ "$__cpe_line" == *'(ERROR'* || "$__cpe_line" == *'(MISSING'* ]] || continue
        # Strip the column padding from the path.
        __cpe_path="${__cpe_line%%$'\t'*}"
        __cpe_path="${__cpe_path%"${__cpe_path##*[![:space:]]}"}"
        __cpe_out["$__cpe_path"]="${__cpe_line##*$'\t'}"
    done <<<"$__cpe_text"
    return 0
}
