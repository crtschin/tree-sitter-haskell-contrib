#include "tree_sitter/parser.h"

// Layout scanner for GHC Core dumps. GHC separates top-level items (the banner,
// the Result-size header, each binding *group* -- its `name :: type` signature,
// `[IdInfo]` bracket and `name = rhs` line -- and Rec bindings). Within a group,
// and in an expression body's continuations, lines use single newlines and
// indentation. The grammar can't see column-0 layout, so this scanner emits the
// external ITEM_SEP that bounds one group from the next.
//
// Normal (unpacked) dumps put a BLANK line, then GHC's per-binding
// `-- RHS size: {..}` comment, then the signature, before each group. So a blank
// line (>= 2 newlines) at column 0, or EOF, is the boundary. The `-- RHS size`
// comment is consumed AS PART of the separator (not left as a standalone token):
// otherwise it splits the separator -- blank-line ITEM_SEP, comment, then a
// second scan before the signature -- and that second scan fired the
// single-newline rule (below) spuriously inside unpacked groups. A `---- .. ----`
// section marker (>= 3 dashes, introduces a bannerless rules/CorePrep tail) is
// NOT consumed; the grammar needs it, so the scan stops before one.
//
// `-ddump-late-cc` is special: it packs groups with NO blank line and NO
// `-- RHS size` comment (`.. name = rhs \n name2 :: ty ..`). A column-0 signature
// head (a name then `::`/`[InlPrag..]`) always begins a group -- the IdInfo line
// starts with `[` and a def is `name = ` -- so at a single-newline column-0
// boundary we additionally fire before a signature head. ITEM_SEP is only a valid
// symbol between groups; in unpacked dumps a signature follows the consumed
// comment so this single-newline path is unreachable there. Stateless.

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
    lexer->mark_end(lexer); // token ends after the whitespace consumed so far

    // Consume `-- RHS size`-style comment lines (exactly two leading dashes) plus
    // the whitespace after each, committing via mark_end. Stop before a `----`
    // section marker; the dashes we advance over to count are lookahead only, so
    // the marker stays intact (mark_end is before them).
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

    // A section marker ends the binding-group run: fire only at a real
    // (blank-line) boundary, ending before the marker.
    if (at_marker) {
        if (newlines >= 2) {
            lexer->result_symbol = ITEM_SEP;
            return true;
        }
        return false;
    }

    // EOF terminates the final item (only if something was consumed, so we can't
    // fire a zero-width token repeatedly).
    if (lexer->eof(lexer)) {
        if (consumed) {
            lexer->result_symbol = ITEM_SEP;
            return true;
        }
        return false;
    }

    // Otherwise we are at a column-0 group head (mark_end is here).
    if (lexer->get_column(lexer) != 0) {
        return false;
    }

    // Blank line: an unconditional group boundary.
    if (newlines >= 2) {
        lexer->result_symbol = ITEM_SEP;
        return true;
    }

    // Single newline: only the packed -ddump-late-cc case. Fire before a
    // group-initial signature head -- a name token then `::` (or its unicode
    // dcolon) or the `[InlPrag=..]` bracket whose `::` wraps to an indented line.
    // A def (`name = `/binder) or an IdInfo `[..]` is within-group. Advancing
    // below is lookahead only; mark_end already bounds the token at the head.
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
                         // (`$fEqColour_$c/=`, `$fOrdColour_$c<`); `:` is
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
    // Same-line `::`/unicode-dcolon, or the `[InlPrag=..]` bracket.
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
