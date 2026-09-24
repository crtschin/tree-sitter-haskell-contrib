#include "tree_sitter/parser.h"

// Scanner for the bannerless simplifier logs of GHC. It emits three externals.
//
// RULE_NAME follows `Rule fired:`. The name can contain spaces, symbols, and
// parentheses (`paren (in) name`). A trailing ` (BUILTIN)` or ` (<Module>)`
// group at end of line gives the origin, and the name stops before that group:
//   - A token regex cannot express this lookahead. The scanner reads to EOL and
//     calls `mark_end` at the gap before the last `(...)` group.
//   - `tail_is_group` is true when the run after the last gap is one group. If
//     it is false, the name runs to EOL.
//   - An origin never contains a space, so the gap before the final group is
//     unambiguous.
//
// INLINED_ID and DETAIL follow `Inlining done:`, which has two forms:
//   - Default: the id is on the same line, as INLINED_ID.
//   - `-dppr-debug`: a bare header, then an indented typed-Core body over many
//     lines. DETAIL captures the body up to the next column-0 record or EOF.

enum TokenType {
    RULE_NAME,
    INLINED_ID,
    DETAIL,
};

void *tree_sitter_ghc_core_explain_external_scanner_create(void) { return NULL; }
void tree_sitter_ghc_core_explain_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_ghc_core_explain_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_ghc_core_explain_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

static bool is_eol(int32_t c) { return c == '\n' || c == '\r'; }
static bool is_gap(int32_t c) { return c == ' ' || c == '\t'; }

static bool scan_rule_name(TSLexer *lexer) {
    while (is_gap(lexer->lookahead)) lexer->advance(lexer, true);
    if (is_eol(lexer->lookahead) || lexer->eof(lexer)) return false;

    bool tail_is_group = false;
    for (;;) {
        int32_t c = lexer->lookahead;
        if (is_eol(c) || lexer->eof(lexer)) break;
        if (is_gap(c)) {
            lexer->mark_end(lexer);
            tail_is_group = false;
            while (is_gap(lexer->lookahead)) lexer->advance(lexer, false);
            continue;
        }
        if (c == '(') {
            tail_is_group = true;
            int depth = 0;
            do {
                c = lexer->lookahead;
                if (is_eol(c) || lexer->eof(lexer)) break;
                if (c == '(') depth++;
                else if (c == ')') depth--;
                lexer->advance(lexer, false);
            } while (depth > 0);
            continue;
        }
        tail_is_group = false;
        lexer->advance(lexer, false);
    }
    if (!tail_is_group) lexer->mark_end(lexer);
    lexer->result_symbol = RULE_NAME;
    return true;
}

static bool scan_inlining(TSLexer *lexer, const bool *valid_symbols) {
    while (is_gap(lexer->lookahead)) lexer->advance(lexer, true);

    if (!is_eol(lexer->lookahead) && !lexer->eof(lexer)) {
        if (!valid_symbols[INLINED_ID]) return false;
        while (!is_eol(lexer->lookahead) && !lexer->eof(lexer)) lexer->advance(lexer, false);
        lexer->result_symbol = INLINED_ID;
        return true;
    }

    // A bare header at EOF has no body, so the parser reports an error.
    if (!valid_symbols[DETAIL] || lexer->eof(lexer)) return false;
    lexer->advance(lexer, false); // The header line ending keeps DETAIL non-empty.
    for (;;) {
        if (lexer->eof(lexer)) break;
        int32_t c = lexer->lookahead;
        if (is_gap(c)) {
            while (!is_eol(lexer->lookahead) && !lexer->eof(lexer)) lexer->advance(lexer, false);
            if (is_eol(lexer->lookahead)) lexer->advance(lexer, false);
        } else if (is_eol(c)) {
            lexer->advance(lexer, false); // A blank line stays in the body.
        } else {
            break;
        }
    }
    lexer->result_symbol = DETAIL;
    return true;
}

bool tree_sitter_ghc_core_explain_external_scanner_scan(void *payload, TSLexer *lexer,
                                                        const bool *valid_symbols) {
    // Each external is valid only after its keyword. If error recovery offers
    // all three, rule_name wins.
    if (valid_symbols[RULE_NAME]) return scan_rule_name(lexer);
    if (valid_symbols[INLINED_ID] || valid_symbols[DETAIL]) return scan_inlining(lexer, valid_symbols);
    return false;
}
