#include "tree_sitter/parser.h"

// Layout scanner for GHC Core dumps. GHC separates top-level items with a BLANK
// line. Those items are the banner, the Result-size header, each binding *group*
// (its `-- RHS size` comment, `name :: type` signature, `[IdInfo]` bracket and
// `name = rhs` line), and the Rec bindings. The lines within a group, and an
// expression body's continuations, use single newlines (and indentation).
//
// So the one thing the grammar can't see is "a blank line precedes the next
// item". This scanner emits ITEM_SEP at a blank line (>= 2 newlines) before
// column-0 content, or at end of input. A single newline (a within-group line or
// an indented continuation) yields no token, so the item keeps going. The
// signature/binding lines inside a group flow together and a multi-line type is
// bounded by where the binding name parses, not by a token. Stateless.

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

    // Consume blanks and newlines as part of the token. A group boundary is a
    // blank line (>= 2 newlines) before column-0 content. A single newline is a
    // within-group line or a continuation and must NOT fire.
    int newlines = 0;
    bool consumed = false;
    for (;;) {
        if (lexer->lookahead == '\n') {
            newlines++;
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

    if (newlines >= 2 && lexer->get_column(lexer) == 0) {
        lexer->mark_end(lexer);
        lexer->result_symbol = ITEM_SEP;
        return true;
    }

    return false;
}
