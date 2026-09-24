#include "tree_sitter/parser.h"

// Layout scanner for GHC Core dumps. It emits ITEM_SEP between top-level items:
// the banner, the Result-size header, each binding group, and each Rec binding.
// A group is the signature, the `[IdInfo]` bracket, and the `name = rhs` line,
// joined by single newlines.
//
// A boundary is one of these:
//   - A blank line at column 0, or EOF. The separator also consumes the
//     `-- RHS size` comment after it. Left standalone, that comment splits the
//     separator, and the second scan then fires the single-newline rule inside
//     a group.
//   - A single newline before a column-0 signature head. `-ddump-late-cc`
//     packs groups with no blank line and no `-- RHS size` comment.
//
// The separator never consumes a `----` section marker, because the grammar
// needs it.

enum TokenType {
    ITEM_SEP,
};

void *tree_sitter_ghc_core_external_scanner_create(void) { return NULL; }
void tree_sitter_ghc_core_external_scanner_destroy(void *payload) {}
unsigned tree_sitter_ghc_core_external_scanner_serialize(void *payload, char *buffer) { return 0; }
void tree_sitter_ghc_core_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

static void skip_ws(TSLexer *lexer, int *newlines, bool *consumed) {
    for (;;) {
        int32_t c = lexer->lookahead;
        if (c == '\n') {
            (*newlines)++;
            *consumed = true;
            lexer->advance(lexer, false);
        } else if (c == ' ' || c == '\t' || c == '\r' || c == '\f') {
            *consumed = true;
            lexer->advance(lexer, false);
        } else {
            break;
        }
    }
}

bool tree_sitter_ghc_core_external_scanner_scan(void *payload, TSLexer *lexer,
                                                const bool *valid_symbols) {
    if (!valid_symbols[ITEM_SEP]) {
        return false;
    }

    int newlines = 0;
    bool consumed = false;
    skip_ws(lexer, &newlines, &consumed);
    lexer->mark_end(lexer);

    // The dashes that this loop counts are lookahead only, because mark_end sits
    // before them. As a result, a `----` marker stays intact.
    bool at_marker = false;
    while (lexer->lookahead == '-') {
        int dashes = 0;
        while (lexer->lookahead == '-') {
            dashes++;
            lexer->advance(lexer, false);
        }
        if (dashes != 2) {
            at_marker = true;
            break;
        }
        consumed = true;
        int braces = 0; // the size record can wrap across lines inside `{..}`
        for (;;) {
            int32_t d = lexer->lookahead;
            if (d == 0) {
                break;
            }
            if (d == '{') {
                braces++;
            } else if (d == '}') {
                if (braces > 0) {
                    braces--;
                }
            } else if (d == '\n' && braces == 0) {
                break;
            }
            lexer->advance(lexer, false);
        }
        skip_ws(lexer, &newlines, &consumed);
        lexer->mark_end(lexer);
    }

    if (at_marker) {
        if (newlines >= 2) {
            lexer->result_symbol = ITEM_SEP;
            return true;
        }
        return false;
    }

    // A zero-width token at EOF would fire forever.
    if (lexer->eof(lexer)) {
        if (consumed) {
            lexer->result_symbol = ITEM_SEP;
            return true;
        }
        return false;
    }

    if (lexer->get_column(lexer) != 0) {
        return false;
    }

    if (newlines >= 2) {
        lexer->result_symbol = ITEM_SEP;
        return true;
    }

    // Every advance after this point is lookahead only, because mark_end already
    // sits at the group head.
    if (newlines < 1) {
        return false;
    }
    int32_t c = lexer->lookahead;
    bool name_start = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                      c == '_' || c == '$';
    if (!name_start) {
        return false;
    }
    for (;;) {
        c = lexer->lookahead;
        bool name_char = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                         (c >= '0' && c <= '9') || c == '_' || c == '\'' ||
                         c == '$' || c == '#' || c == '.' ||
                         // a method-selector binder ends in an operator run
                         // (`$fEqColour_$c/=`, `$fOrdColour_$c<`). `:` is
                         // excluded so the `::` of the signature still ends it.
                         c == '-' || c == '+' || c == '*' || c == '/' ||
                         c == '<' || c == '>' || c == '=' || c == '~' ||
                         c == '&' || c == '|' || c == '^' || c == '%';
        if (!name_char) {
            break;
        }
        lexer->advance(lexer, false);
    }
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        lexer->advance(lexer, false);
    }
    c = lexer->lookahead;
    // A same-line `::`, its unicode form, or the `[InlPrag=..]` bracket, whose
    // `::` wraps to an indented line.
    if (c == ':' || c == '[' || c == 0x2237) {
        lexer->result_symbol = ITEM_SEP;
        return true;
    }
    // The signature type often wraps to an indented continuation, leaving the
    // name alone on its line: `name\n  :: ty`. Peek one line down for the `::`.
    // A def's continuation is `= rhs`, so requiring `::` keeps defs out.
    if (c == '\n') {
        lexer->advance(lexer, false);
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            lexer->advance(lexer, false);
        }
        c = lexer->lookahead;
        if (c == ':' || c == 0x2237) {
            lexer->result_symbol = ITEM_SEP;
            return true;
        }
    }
    return false;
}
