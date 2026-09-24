#include <stdbool.h>
#include <stdint.h>

#include <tree_sitter/alloc.h>
#include <tree_sitter/array.h>
#include <tree_sitter/parser.h>

#if defined(__GNUC__) || defined(__clang__)
#define UNLIKELY(x) __builtin_expect(!!(x), 0)
#else
#define UNLIKELY(x) (x)
#endif

#define NBSP 0x00A0

// Call-rate counters for `just stats`, compiled in only with `-DSCANNER_STATS`.
#ifdef SCANNER_STATS
#include <stdio.h>
#include <stdlib.h>

typedef enum {
    SP_PENDING_DEDENT,
    SP_EOF_DEDENT,
    SP_EOF_NEWLINE,
    SP_INDENT,
    SP_CONTINUATION,
    SP_DEDENT_UNWIND,
    SP_NEWLINE,
    SP_FALSE_NO_NL,   // bailed before measuring next line (no '\n' in lookahead)
    SP_FALSE_NO_MATCH,// measured indent but no valid_symbols branch fired
    SP_COUNT
} StatsPath;

static const char *stats_path_name[SP_COUNT] = {
    "pending", "eof_ded", "eof_nl", "indent", "cont",
    "dedent", "newline", "no_nl", "no_match"
};

static uint64_t stats_calls = 0;
static uint64_t stats_path[SP_COUNT] = {0};
static uint64_t stats_iter_entry_ws = 0;
static uint64_t stats_iter_consume = 0;
static uint64_t stats_iter_comment = 0;
static uint16_t stats_max_depth = 0;
static uint64_t stats_newline_prequeued = 0;
static bool stats_registered = false;

static void stats_dump(void) {
    if (stats_calls == 0) return;
    uint64_t t = 0;
    for (int i = 0; i < SP_FALSE_NO_NL; i++) t += stats_path[i];
    uint64_t f = stats_path[SP_FALSE_NO_NL] + stats_path[SP_FALSE_NO_MATCH];
    fprintf(stderr,
            "[scanner-stats] calls=%llu true=%llu (%.1f%%) false=%llu (%.1f%%)\n",
            (unsigned long long)stats_calls,
            (unsigned long long)t,
            100.0 * (double)t / (double)stats_calls,
            (unsigned long long)f,
            100.0 * (double)f / (double)stats_calls);
    fprintf(stderr, "[scanner-stats] paths:");
    for (int i = 0; i < SP_COUNT; i++) {
        if (stats_path[i] > 0) {
            fprintf(stderr, " %s=%llu",
                    stats_path_name[i],
                    (unsigned long long)stats_path[i]);
        }
    }
    uint64_t nl = stats_path[SP_NEWLINE];
    double pq_pct = nl > 0 ? 100.0 * (double)stats_newline_prequeued / (double)nl : 0.0;
    fprintf(stderr,
            "\n[scanner-stats] iter/call entry_ws=%.2f consume=%.2f comment=%.2f max_stack=%u prequeue=%llu/%llu (%.1f%%)\n",
            (double)stats_iter_entry_ws / (double)stats_calls,
            (double)stats_iter_consume / (double)stats_calls,
            (double)stats_iter_comment / (double)stats_calls,
            (unsigned)stats_max_depth,
            (unsigned long long)stats_newline_prequeued,
            (unsigned long long)nl,
            pq_pct);
}

#define STATS_ENTER() do { \
    stats_calls++; \
    if (!stats_registered) { stats_registered = true; atexit(stats_dump); } \
} while (0)
#define STATS_PATH(p) (stats_path[p]++)
#define STATS_ITER_ENTRY_WS() (stats_iter_entry_ws++)
#define STATS_ITER_CONSUME() (stats_iter_consume++)
#define STATS_ITER_COMMENT() (stats_iter_comment++)
#define STATS_STACK(n) do { uint16_t _n = (uint16_t)(n); if (_n > stats_max_depth) stats_max_depth = _n; } while (0)
#define STATS_PREQUEUE_BEGIN() uint16_t _pq_before = scanner->pending_dedents
#define STATS_PREQUEUE_END() do { if (scanner->pending_dedents > _pq_before) stats_newline_prequeued++; } while (0)
#else
#define STATS_ENTER() ((void)0)
#define STATS_PATH(p) ((void)0)
#define STATS_ITER_ENTRY_WS() ((void)0)
#define STATS_ITER_CONSUME() ((void)0)
#define STATS_ITER_COMMENT() ((void)0)
#define STATS_STACK(n) ((void)0)
#define STATS_PREQUEUE_BEGIN() ((void)0)
#define STATS_PREQUEUE_END() ((void)0)
#endif

// Layout scanner shared by tree-sitter-cabal and tree-sitter-cabal-project.
// Cabal-syntax lexes both formats with one lexer, and the formats differ only in
// meaning.
//
// Both grammars must declare the six externals in the order of `enum Token`.
// Tree-sitter indexes valid_symbols by that position, so a change in the order
// causes out-of-bounds reads here. makeCabalExternals in common/utils.mjs gives
// both grammars the same array. cabal-project never uses _section_name and
// declares it only to keep the order.
//
// The scanner accepts some input that Cabal (Distribution.Fields.Lexer) rejects,
// so that editors do not fail on it:
//   - A tab in indentation advances to the next 8-column stop. Real HLS and Cabal
//     files contain stray tabs.
//   - An NBSP (U+00A0) in indentation counts as one space.
//   - The scanner skips every CR, so CRLF parses the same as LF.

// NEWLINE       Ends a logical line. Fires when the next non-blank line is at the
//               same or a deeper indent, or to queue a DEDENT that is not valid yet.
// INDENT        Opens an indented block and pushes its column. Valid only directly
//               after a block header, and never together with CONTINUATION.
// DEDENT        Closes an indented block. An unwind of more than one level queues
//               the extra DEDENTs in pending_dedents.
// CONTINUATION  Continues a field value on a line deeper than cur_indent_lvl. Both
//               grammars measure against the column of the field, as upstream does
//               (Distribution.Fields.Parser.fieldLayoutOrBraces). Thus a field value
//               must not open an indent block, because the pushed column would make
//               its own continuation lines fail this test.
enum Token {
    NEWLINE,
    INDENT,
    DEDENT,
    CONTINUATION,
    // Hidden externals for names that contain Unicode. See the name dispatch in
    // scanner_scan.
    SECTION_NAME,
    FIELD_NAME,
};

typedef struct {
    // Indent columns in spaces. The bottom entry is always the sentinel 0, and the
    // top entry is cur_indent_lvl.
    Array(uint16_t) indents;
    // DEDENTs queued for later calls. If NEWLINE fires and the next line is already
    // shallower, the scanner pops the stack at once and stores the count here. Each
    // later DEDENT call drains one with no advance.
    uint16_t pending_dedents;
    // Set after the virtual NEWLINE at EOF. A file with no trailing newline needs one
    // NEWLINE to close its last line. The lexer cannot advance past EOF, so a NEWLINE
    // with no latch would loop on repeat($._newline).
    bool eof_newline_emitted;
} Scanner;

static void scanner_reset(Scanner *scanner) {
    array_clear(&scanner->indents);
    array_push(&scanner->indents, 0);
    scanner->pending_dedents = 0;
    scanner->eof_newline_emitted = false;
}

static void *scanner_create(void) {
    Scanner *scanner = ts_malloc(sizeof(Scanner));
    array_init(&scanner->indents);
    scanner_reset(scanner);
    return scanner;
}

static void scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    array_delete(&scanner->indents);
    ts_free(scanner);
}

// `>= 0x80` accepts Unicode names. See the name dispatch in scanner_scan.
static inline bool is_name_start(int32_t c) {
    return (c >= 'a' && c <= 'z')
        || (c >= 'A' && c <= 'Z')
        || (c >= '0' && c <= '9')
        || c == '_'
        || c >= 0x80;
}

static inline bool is_name_cont(int32_t c) {
    return is_name_start(c) || c == '-';
}

static uint16_t consume_blanks(TSLexer *lexer) {
    uint32_t indent = 0;
    while (true) {
        // Ordered by frequency in real .cabal files.
        if (lexer->lookahead == ' ') {
            indent++;
            lexer->advance(lexer, true);
        } else if (lexer->lookahead == '\n') {
            indent = 0;
            lexer->advance(lexer, true);
        } else if (lexer->lookahead == '\t') {
            indent = (indent + 8) & ~(uint32_t)7;
            lexer->advance(lexer, true);
        } else if (lexer->lookahead == '\r') {
            lexer->advance(lexer, true);
        } else if (lexer->lookahead == NBSP) {
            indent++;
            lexer->advance(lexer, true);
        } else {
            break;
        }
        STATS_ITER_CONSUME();
    }
    return indent > UINT16_MAX ? UINT16_MAX : (uint16_t)indent;
}

// Serialized layout, little-endian:
//   [pending lo][pending hi][stack_size lo][stack_size hi][eof_flag]
//   then stack_size pairs of [col lo][col hi].
// The code writes the buffer as unsigned char, because a plain char store of 128..255
// is implementation-defined (C17 6.3.1.3p3).
enum {
    SERIAL_HEADER_BYTES = 5,
    SERIAL_ENTRY_BYTES = 2,
    SERIAL_MAX_ENTRIES =
        (TREE_SITTER_SERIALIZATION_BUFFER_SIZE - SERIAL_HEADER_BYTES) / SERIAL_ENTRY_BYTES,
};

static unsigned scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    unsigned char *buf = (unsigned char *)buffer;
    unsigned size = 0;

    buf[size++] = (unsigned char)(scanner->pending_dedents & 0xFF);
    buf[size++] = (unsigned char)((scanner->pending_dedents >> 8) & 0xFF);

    uint16_t stack_size = scanner->indents.size > SERIAL_MAX_ENTRIES
                              ? SERIAL_MAX_ENTRIES
                              : (uint16_t)scanner->indents.size;
    buf[size++] = (unsigned char)(stack_size & 0xFF);
    buf[size++] = (unsigned char)((stack_size >> 8) & 0xFF);

    buf[size++] = (unsigned char)(scanner->eof_newline_emitted ? 1 : 0);

    for (uint16_t i = 0; i < stack_size; i++) {
        uint16_t v = *array_get(&scanner->indents, i);
        buf[size++] = (unsigned char)(v & 0xFF);
        buf[size++] = (unsigned char)((v >> 8) & 0xFF);
    }

    return size;
}

// The buffer is untrusted. A buffer shorter than the header, or a stack that is empty,
// lacks the sentinel 0, or does not strictly increase, resets the scanner. A corrupt
// stack lets unwind_to pop past the sentinel.
static void scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    const unsigned char *buf = (const unsigned char *)buffer;

    if (length < SERIAL_HEADER_BYTES) {
        scanner_reset(scanner);
        return;
    }

    array_clear(&scanner->indents);

    unsigned pos = 0;
    uint16_t pending = buf[pos++];
    pending |= ((uint16_t)buf[pos++]) << 8;
    scanner->pending_dedents = pending;

    uint16_t stack_size = buf[pos++];
    stack_size |= ((uint16_t)buf[pos++]) << 8;

    scanner->eof_newline_emitted = buf[pos++] != 0;

    for (uint16_t i = 0; i < stack_size && pos + SERIAL_ENTRY_BYTES <= length; i++) {
        uint16_t v = buf[pos++];
        v |= ((uint16_t)buf[pos++]) << 8;
        array_push(&scanner->indents, v);
    }

    bool valid = scanner->indents.size > 0 && *array_get(&scanner->indents, 0) == 0;
    for (uint32_t i = 1; valid && i < scanner->indents.size; i++) {
        if (*array_get(&scanner->indents, i) <=
            *array_get(&scanner->indents, i - 1)) {
            valid = false;
        }
    }
    if (!valid) {
        scanner_reset(scanner);
    }
}

// Queues one DEDENT per pop. An indent between two levels (error recovery) gets its own
// entry, so the stack stays accurate.
static void unwind_to(Scanner *scanner, uint16_t indent) {
    uint16_t top = *array_back(&scanner->indents);
    bool popped = false;
    while (indent < top) {
        array_pop(&scanner->indents);
        scanner->pending_dedents++;
        popped = true;
        top = *array_back(&scanner->indents);
    }
    if (popped && indent > top) {
        array_push(&scanner->indents, indent);
    }
}

static bool scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;

    STATS_ENTER();
    STATS_STACK(scanner->indents.size);

    // No advance. The call that queued the dedents already committed the position.
    if (valid_symbols[DEDENT] && scanner->pending_dedents > 0) {
        scanner->pending_dedents--;
        lexer->result_symbol = DEDENT;
        STATS_PATH(SP_PENDING_DEDENT); return true;
    }
    // Tree-sitter discards the scanner state at EOF, so the stack can stay unpopped.
    if (UNLIKELY(valid_symbols[DEDENT] && lexer->eof(lexer))) {
        lexer->result_symbol = DEDENT;
        STATS_PATH(SP_EOF_DEDENT); return true;
    }
    if (UNLIKELY(valid_symbols[NEWLINE] && lexer->eof(lexer) &&
                 !scanner->eof_newline_emitted)) {
        scanner->eof_newline_emitted = true;
        lexer->result_symbol = NEWLINE;
        STATS_PATH(SP_EOF_NEWLINE); return true;
    }

    // Name dispatch for field_name and section_name. The ASCII terminals stop at the
    // first byte >= 0x80, so this external takes the names that contain Unicode:
    //   - An ASCII name returns false so that the DFA picks. Keyword aliases, e.g.
    //     `library` in cabal and `package` in cabal-project, then win by precedence.
    //   - A Unicode name commits. Unicode can sit anywhere in a name, e.g. `x-無`
    //     and `Fünfstück`, so the scanner reads the whole name first.
    // A Unicode range in the regex costs ~105M Ir on the cabal corpus. The wasted
    // ASCII advances here cost ~17M Ir.
    if (valid_symbols[SECTION_NAME] || valid_symbols[FIELD_NAME]) {
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
               lexer->lookahead == '\r' || lexer->lookahead == NBSP) {
            lexer->advance(lexer, true);
        }
        if (is_name_start(lexer->lookahead)) {
            bool has_unicode = (lexer->lookahead >= 0x80);
            lexer->advance(lexer, false);
            while (is_name_cont(lexer->lookahead)) {
                if (lexer->lookahead >= 0x80) has_unicode = true;
                lexer->advance(lexer, false);
            }
            if (has_unicode) {
                lexer->mark_end(lexer);
                lexer->result_symbol =
                    valid_symbols[FIELD_NAME] ? FIELD_NAME : SECTION_NAME;
                return true;
            }
            return false;
        }
    }
    // The scanner runs before extras, so it can sit on a trailing space that would
    // otherwise block NEWLINE and DEDENT.
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
           lexer->lookahead == '\r' || lexer->lookahead == 0x00A0) {
        lexer->advance(lexer, true);
        STATS_ITER_ENTRY_WS();
    }
    if (lexer->eof(lexer) || lexer->lookahead != '\n') {
        STATS_PATH(SP_FALSE_NO_NL); return false;
    }

    uint16_t cur_indent_lvl = *array_back(&scanner->indents);

    lexer->advance(lexer, true);
    uint16_t indent = consume_blanks(lexer);

    // Cabal `--` comments are layout-transparent, so they must not drive INDENT or
    // DEDENT. The scanner reads past comment lines to the indent of the next real line.
    // It marks the token end before the first comment, so that tree-sitter lexes the
    // comments again as extras.
    //
    // Between a block header and its body, GLR makes both INDENT and DEDENT valid. A
    // comment at the header column must then be skipped, so that a deeper body line
    // after it still gives INDENT. Inside an open field only INDENT is valid, and a
    // comment at the same indent goes to extras.
    bool pre_block = valid_symbols[INDENT] && valid_symbols[DEDENT];
    bool marked = false;
    while (lexer->lookahead == '-' && (indent != cur_indent_lvl || pre_block)) {
        if (!marked) {
            lexer->mark_end(lexer);
            marked = true;
        }
        lexer->advance(lexer, true);
        if (lexer->lookahead != '-') {
            // Not a comment. mark_end already ends the token before the '-'.
            break;
        }
        while (lexer->lookahead != '\n' && !lexer->eof(lexer)) {
            lexer->advance(lexer, true);
            STATS_ITER_COMMENT();
        }
        if (lexer->eof(lexer)) {
            indent = 0;
            break;
        }
        lexer->advance(lexer, true);
        indent = consume_blanks(lexer);
    }

    if (valid_symbols[INDENT] && indent > cur_indent_lvl) {
        array_push(&scanner->indents, indent);
        lexer->result_symbol = INDENT;
        STATS_PATH(SP_INDENT); return true;
    } else if (valid_symbols[CONTINUATION] && indent > cur_indent_lvl) {
        lexer->result_symbol = CONTINUATION;
        STATS_PATH(SP_CONTINUATION); return true;
    } else if (valid_symbols[DEDENT] && indent < cur_indent_lvl) {
        // unwind_to queued one DEDENT per pop, and this call returns the first.
        unwind_to(scanner, indent);
        scanner->pending_dedents--;
        lexer->result_symbol = DEDENT;
        STATS_PATH(SP_DEDENT_UNWIND); return true;
    } else if (valid_symbols[NEWLINE]) {
        // If the next line is shallower but DEDENT is not valid yet, e.g. after a
        // single-line field that needs NEWLINE first, unwind now. The next call starts
        // past the blanks, so it cannot measure this indent again.
        STATS_PREQUEUE_BEGIN();
        if (indent < cur_indent_lvl) {
            unwind_to(scanner, indent);
        }
        STATS_PREQUEUE_END();
        lexer->result_symbol = NEWLINE;
        STATS_PATH(SP_NEWLINE); return true;
    } else {
        STATS_PATH(SP_FALSE_NO_MATCH); return false;
    }
}

// Each parser.c links the symbols of one grammar. The other set is dead code.
#define EXPORT(LANG)                                                                            \
    void *tree_sitter_##LANG##_external_scanner_create(void) { return scanner_create(); }       \
    void tree_sitter_##LANG##_external_scanner_destroy(void *p) { scanner_destroy(p); }         \
    unsigned tree_sitter_##LANG##_external_scanner_serialize(void *p, char *b) {                \
        return scanner_serialize(p, b);                                                         \
    }                                                                                           \
    void tree_sitter_##LANG##_external_scanner_deserialize(void *p, const char *b, unsigned l) {\
        scanner_deserialize(p, b, l);                                                           \
    }                                                                                           \
    bool tree_sitter_##LANG##_external_scanner_scan(void *p, TSLexer *l, const bool *v) {       \
        return scanner_scan(p, l, v);                                                           \
    }

EXPORT(cabal)
EXPORT(cabal_project)
