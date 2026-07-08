#include "tree_sitter/parser.h"

// Scanner for GHC's bannerless simplifier logs. It emits three externals.
//
// RULE_NAME (after `Rule fired:`). A rule name may contain spaces, symbols, and
// even parentheses (`paren (in) name`), followed by the origin as a trailing
// ` (BUILTIN)`/` (<Module>)` group at end of line. The name is everything up to
// that final group.
//
//   - A token regex cannot express the lookahead, so we scan to EOL and
//     `mark_end` at the gap before the LAST `(...)` group.
//   - `tail_is_group` tracks whether the run after the last gap is exactly a
//     trailing group. If not (no origin, or an embedded group with more name
//     after), the name runs to EOL.
//   - Origins never contain spaces, so the gap before the final group is
//     unambiguous.
//
// INLINED_ID / DETAIL (after `Inlining done:`). Two forms:
//
//   - Default: one `Inlining done: <id>` line. We emit the same-line id.
//   - `-dppr-debug`: a bare `Inlining done:` header then an indented
//     multi-line typed-Core body, captured opaquely as DETAIL up to the next
//     column-0 record or EOF.
//
// Stateless.

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
    while (is_gap(lexer->lookahead)) lexer->advance(lexer, true); // leading gap = trivia
    if (is_eol(lexer->lookahead) || lexer->eof(lexer)) return false;

    bool tail_is_group = false;
    for (;;) {
        int32_t c = lexer->lookahead;
        if (is_eol(c) || lexer->eof(lexer)) break;
        if (is_gap(c)) {
            lexer->mark_end(lexer); // candidate name end (before this gap)
            tail_is_group = false;
            while (is_gap(lexer->lookahead)) lexer->advance(lexer, false);
            continue;
        }
        if (c == '(') {
            tail_is_group = true; // the run after the last gap looks like the trailing origin
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
        tail_is_group = false; // an ordinary name char
        lexer->advance(lexer, false);
    }
    if (!tail_is_group) lexer->mark_end(lexer); // no trailing origin: name is the whole line
    lexer->result_symbol = RULE_NAME;
    return true;
}

static bool scan_inlining(TSLexer *lexer, const bool *valid_symbols) {
    while (is_gap(lexer->lookahead)) lexer->advance(lexer, true); // gap after the keyword = trivia

    if (!is_eol(lexer->lookahead) && !lexer->eof(lexer)) {
        // Default form: the identifier is the rest of the line.
        if (!valid_symbols[INLINED_ID]) return false;
        while (!is_eol(lexer->lookahead) && !lexer->eof(lexer)) lexer->advance(lexer, false);
        lexer->result_symbol = INLINED_ID;
        return true;
    }

    // Verbose (-dppr-debug) form: bare header, then an indented body block. A
    // body line is always indented. A column-0 non-space char begins the next
    // record. A truncated bare header at EOF has no body, so leave it to error.
    if (!valid_symbols[DETAIL] || lexer->eof(lexer)) return false;
    lexer->advance(lexer, false); // the header's line ending (keeps DETAIL non-empty)
    for (;;) {
        if (lexer->eof(lexer)) break;
        int32_t c = lexer->lookahead;
        if (is_gap(c)) {
            while (!is_eol(lexer->lookahead) && !lexer->eof(lexer)) lexer->advance(lexer, false);
            if (is_eol(lexer->lookahead)) lexer->advance(lexer, false);
        } else if (is_eol(c)) {
            lexer->advance(lexer, false); // blank line stays part of the body region
        } else {
            break; // column-0 record head ends the body
        }
    }
    lexer->result_symbol = DETAIL;
    return true;
}

bool tree_sitter_ghc_core_explain_external_scanner_scan(void *payload, TSLexer *lexer,
                                                        const bool *valid_symbols) {
    // The two contexts are mutually exclusive in a normal parse (each external is
    // valid only after its keyword). rule_name wins if error recovery offers all.
    if (valid_symbols[RULE_NAME]) return scan_rule_name(lexer);
    if (valid_symbols[INLINED_ID] || valid_symbols[DETAIL]) return scan_inlining(lexer, valid_symbols);
    return false;
}
