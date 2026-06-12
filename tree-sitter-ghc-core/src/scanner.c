#include "tree_sitter/parser.h"

// Layout scanner for GHC Core dumps. GHC prints each top-level logical line --
// a `-- RHS size` comment, a `name :: type` signature, an `[IdInfo]` bracket, a
// `name = rhs` binding, and the `Rec {` / `end Rec }` markers -- starting in
// column 0, while their continuations (wrapped types, multi-line IdInfo, the
// indented RHS expression) are indented. Expression bodies are otherwise fully
// brace/keyword-delimited, so the only thing the grammar can't see is the
// column. This scanner emits ITEM_SEP at a newline that is followed by a
// column-0 non-blank character (or at end of input), which the grammar uses to
// terminate each top-level item; an indented continuation produces no token, so
// the item keeps going. The scanner is stateless.

enum TokenType {
    ITEM_SEP,
};

void *tree_sitter_ghc_core_external_scanner_create(void) { return NULL; }
void tree_sitter_ghc_core_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_ghc_core_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_ghc_core_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

bool tree_sitter_ghc_core_external_scanner_scan(void *payload, TSLexer *lexer,
                                                const bool *valid_symbols) {
    if (!valid_symbols[ITEM_SEP]) {
        return false;
    }

    // Consume blanks and newlines as part of the token. We need at least one
    // newline (so we don't fire between tokens on the same line) and then
    // either column 0 (a new top-level line) or end of input.
    bool saw_newline = false;
    bool consumed = false;
    for (;;) {
        if (lexer->lookahead == '\n') {
            saw_newline = true;
            consumed = true;
            lexer->advance(lexer, false);
        } else if (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
                   lexer->lookahead == '\r') {
            consumed = true;
            lexer->advance(lexer, false);
        } else {
            break;
        }
    }

    if (lexer->eof(lexer)) {
        // Terminate the final item. Require having consumed something so we
        // can't fire a zero-width token repeatedly at EOF.
        if (consumed) {
            lexer->mark_end(lexer);
            lexer->result_symbol = ITEM_SEP;
            return true;
        }
        return false;
    }

    if (saw_newline && lexer->get_column(lexer) == 0) {
        lexer->mark_end(lexer);
        lexer->result_symbol = ITEM_SEP;
        return true;
    }

    return false;
}
