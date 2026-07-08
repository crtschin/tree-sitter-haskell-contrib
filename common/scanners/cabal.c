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

// Optional call-rate instrumentation. Build with `-DSCANNER_STATS` (see
// `just stats`). Off in normal builds.
#ifdef SCANNER_STATS
#include <stdio.h>
#include <stdlib.h>

typedef enum {
    SP_PENDING_DEDENT,
    SP_EOF_DEDENT,
    SP_EOF_NEWLINE,
    SP_INDENT,
    SP_CONTINUATION,
    SP_INDENTED,
    SP_DEDENT_UNWIND,
    SP_NEWLINE,
    SP_FALSE_NO_NL,   // bailed before measuring next line (no '\n' in lookahead)
    SP_FALSE_NO_MATCH,// measured indent but no valid_symbols branch fired
    SP_COUNT
} StatsPath;

static const char *stats_path_name[SP_COUNT] = {
    "pending", "eof_ded", "eof_nl", "indent", "cont",
    "indented", "dedent", "newline", "no_nl", "no_match"
};

static uint64_t stats_calls = 0;
static uint64_t stats_path[SP_COUNT] = {0};
// Iteration counts across all calls. avg = total / calls.
static uint64_t stats_iter_entry_ws = 0; // pre-'\n' whitespace skip
static uint64_t stats_iter_consume = 0;  // consume_blanks loop body
static uint64_t stats_iter_comment = 0;  // comment skip char loop
static uint16_t stats_max_depth = 0;
// NEWLINE-branch unwinds that actually popped. Near-zero means the pre-queue is idle.
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

// Layout-sensitive scanner shared by tree-sitter-cabal and tree-sitter-cabal-project.
// Cabal-syntax uses one lexer for both formats. The .cabal/.project split is semantic.
//
// ABI constraint: both grammars must list all seven externals in this exact order.
// Tree-sitter indexes valid_symbols by declared position, so reordering or removing one
// shifts the rest and causes out-of-bounds reads here. cabal-project declares
// _section_name only for that alignment and never references it, so its slot stays unset.
//
// Leniencies beyond Cabal's own lexer (Distribution.Fields.Lexer): we accept input Cabal
// rejects so editors don't fail fast. Tracked here so the divergence stays visible.
//   1. Tabs in indentation, advanced to the next 8-space stop. Real HLS/Cabal corpus
//      files carry stray tabs.
//   2. NBSP (U+00A0) in indentation, counted as one space. Cheap to tolerate paste slips.
//   3. CR (\r) anywhere, skipped, so CRLF parses identically to LF.
//   4. Comment indent. Cabal `--` comments are layout-transparent at any column, which we
//      match. Haskell's layout rule respects comment columns in places, so worth flagging.

// NEWLINE      End of a logical line. Fires when the next non-blank line is at the same
//              or greater indent, or to pre-queue a DEDENT not yet valid.
// INDENT       Opens an indented block (pushes the column). Only valid right after a
//              block header. Never valid alongside INDENTED or CONTINUATION.
// DEDENT       Closes an indented block. Multi-level unwinds queue the extra DEDENTs in
//              pending_dedents, drained on later calls.
// INDENTED     Lenient continuation: next line deeper than prev_indent_lvl (the level
//              before the last INDENT push). Lets a .cabal multi-line field's value lines
//              sit at the first value line's column, which CONTINUATION rejects.
// CONTINUATION Strict continuation: next line deeper than cur_indent_lvl. Keeps
//              cabal-project sibling fields at the field-name column out of the value.
enum Token {
    NEWLINE,
    INDENT,
    DEDENT,
    INDENTED,
    CONTINUATION,
    // Hidden Unicode-fallback name externals (see the dispatch in scanner_scan).
    // SECTION_NAME is cabal-only. cabal-project declares but never uses it.
    SECTION_NAME,
    FIELD_NAME,
};

typedef struct {
    // Indent columns (spaces). Always holds the sentinel 0 at the root.
    //   back()    == cur_indent_lvl  (innermost open block)
    //   [size-2]  == prev_indent_lvl (level before the last INDENT, the INDENTED check),
    //                defined only when size >= 2.
    Array(uint16_t) indents;
    // DEDENTs queued for later calls: when NEWLINE fires but the next line is already
    // shallower, the stack is pre-popped and the deficit stored here, one drained per
    // DEDENT call without advancing.
    uint16_t pending_dedents;
    // Latches after the virtual NEWLINE at EOF. A file with no trailing newline needs one
    // NEWLINE to close its last line, but the lexer can't advance past EOF, so firing it
    // unconditionally would loop on the grammar's repeat($._newline). After this, only
    // DEDENT-at-EOF may fire.
    bool eof_newline_emitted;
} Scanner;

// Reset to initial state (sentinel-0 stack, no queued dedents, EOF flag clear). Used at
// construction and when scanner_deserialize gets a missing or invalid buffer.
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

// Name-char predicates for the section_name / field_name dispatch. The `>= 0x80` clause
// lets Unicode names parse without a DFA-bloating Unicode regex (see the dispatch).
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

// Skip spaces and blank lines, returning the next significant char's column. Tab/NBSP/CR
// handling follows the leniencies up top.
static uint16_t consume_blanks(TSLexer *lexer) {
    uint32_t indent = 0;
    while (true) {
        // Ordered by frequency in real .cabal files: space, newline, tab, CR, NBSP.
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

// Wire format for tree-sitter's incremental parse cache.
//   [pending lo][pending hi][stack_size lo][stack_size hi][eof_flag]
//   then stack_size pairs of [col lo][col hi].
// Little-endian (the buffer is unaligned) and aliased as unsigned char so 128..255 store
// well-definedly (plain char would be implementation-defined, C17 6.3.1.3p3).
enum {
    SERIAL_HEADER_BYTES = 5,
    SERIAL_ENTRY_BYTES = 2,
    SERIAL_MAX_ENTRIES =
        (TREE_SITTER_SERIALIZATION_BUFFER_SIZE - SERIAL_HEADER_BYTES) / SERIAL_ENTRY_BYTES,
};

// stack_size is clamped to what fits after the header, so the count never exceeds the
// bytes that follow. The header always fits (buffer is 1024).
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

// Restore from a scanner_serialize buffer, treated as untrusted. A buffer shorter than the
// header, or a stack violating the invariants (non-empty, sentinel 0 at bottom, strictly
// increasing), resets to fresh state. A corrupt stack would otherwise drive unwind_to to
// pop past the sentinel and read off the end of indents.
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

    // The invariant unwind_to relies on: bottom is 0 (uint16_t can't go negative) and
    // each entry strictly exceeds the previous.
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

// Pop until the top is <= indent, queuing one DEDENT per pop. If indent lands between two
// levels (error recovery), push it so the stack stays accurate.
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

    // Drain one queued DEDENT. No advance: the position was committed when the dedents
    // were queued in a prior call.
    if (valid_symbols[DEDENT] && scanner->pending_dedents > 0) {
        scanner->pending_dedents--;
        lexer->result_symbol = DEDENT;
        STATS_PATH(SP_PENDING_DEDENT); return true;
    }
    // At EOF, return DEDENT on every call. Tree-sitter discards scanner state at the end,
    // so the unpopped stack never matters.
    if (UNLIKELY(valid_symbols[DEDENT] && lexer->eof(lexer))) {
        lexer->result_symbol = DEDENT;
        STATS_PATH(SP_EOF_DEDENT); return true;
    }
    // Virtual EOF NEWLINE, latched so repeat($._newline) can't loop. See the struct field.
    if (UNLIKELY(valid_symbols[NEWLINE] && lexer->eof(lexer) &&
                 !scanner->eof_newline_emitted)) {
        scanner->eof_newline_emitted = true;
        lexer->result_symbol = NEWLINE;
        STATS_PATH(SP_EOF_NEWLINE); return true;
    }

    // Name dispatch, shared by both grammars: choose between an ASCII terminal
    // and this hidden external for field_name (and cabal's section_name).
    //
    //   - ASCII: return false and let the DFA pick, so keyword aliases (cabal's
    //     ci-regex `library`/`if`, cabal-project's `_word` keywords
    //     `package`/`repository`) win by precedence. Emitting unconditionally
    //     would steal them.
    //   - Unicode: commit. Both ASCII terminals stop at the first byte >= 0x80,
    //     so the parser would otherwise error. Unicode can sit anywhere
    //     (`x-無`, `Fünfstück`), so walk the whole body first.
    //
    // `lookahead` is the pre-decoded codepoint, so `>= 0x80` is a single
    // compare. The wasted ASCII advances cost ~17M Ir on the cabal corpus, and
    // dropping a Unicode range from the regex saves ~105M Ir. cabal-project
    // never sets SECTION_NAME, so that branch is cabal-only.
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
            return false;  // ASCII: relinquish to DFA + keyword extraction.
        }
    }
    // Skip horizontal whitespace and \r so trailing spaces before a line ending don't
    // block NEWLINE/DEDENT. The scanner runs before extras are consumed, so it can sit on
    // a trailing space.
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
           lexer->lookahead == '\r' || lexer->lookahead == 0x00A0) {
        lexer->advance(lexer, true);
        STATS_ITER_ENTRY_WS();
    }
    if (lexer->eof(lexer) || lexer->lookahead != '\n') {
        STATS_PATH(SP_FALSE_NO_NL); return false;
    }

    uint16_t cur_indent_lvl = *array_back(&scanner->indents);
    // prev_indent_lvl: level before the last INDENT push (see INDENTED up top).
    uint16_t prev_indent_lvl =
        scanner->indents.size >= 2
            ? *array_get(&scanner->indents, scanner->indents.size - 2)
            : 0;

    // Past the '\n', then measure the next significant line's indent.
    lexer->advance(lexer, true);
    uint16_t indent = consume_blanks(lexer);

    // Cabal `--` comments are layout-transparent, so they must not drive INDENT/DEDENT.
    // Peek past a run of comment lines to the next real line's indent, marking the token
    // end before the first comment so tree-sitter re-lexes it as extras.
    //
    // pre_block: between a block header and its unopened body GLR makes both INDENT and
    // DEDENT valid, so a header-column comment must be skipped for a deeper body line
    // behind it to still produce INDENT. Inside an unclosed field only INDENT is valid, so
    // pre_block is false and same-indent comments fall to the extras mechanism.
    bool pre_block = valid_symbols[INDENT] && valid_symbols[DEDENT];
    bool marked = false;
    while (lexer->lookahead == '-' && (indent != cur_indent_lvl || pre_block)) {
        if (!marked) {
            lexer->mark_end(lexer);
            marked = true;
        }
        lexer->advance(lexer, true);  // past first '-'
        if (lexer->lookahead != '-') {
            // Single '-', not a comment. mark_end already bounded the token before it.
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
        lexer->advance(lexer, true);  // past '\n'
        indent = consume_blanks(lexer);
    }

    if (valid_symbols[INDENT] && indent > cur_indent_lvl) {
        array_push(&scanner->indents, indent);
        lexer->result_symbol = INDENT;
        STATS_PATH(SP_INDENT); return true;
    } else if (valid_symbols[CONTINUATION] && indent > cur_indent_lvl) {
        // INDENT is checked first to make its priority explicit. The grammar shouldn't
        // make both valid.
        lexer->result_symbol = CONTINUATION;
        STATS_PATH(SP_CONTINUATION); return true;
    } else if (valid_symbols[INDENTED] && indent > prev_indent_lvl) {
        // Deeper than prev: a continuation at the first value line's column still passes.
        lexer->result_symbol = INDENTED;
        STATS_PATH(SP_INDENTED); return true;
    } else if (valid_symbols[DEDENT] && indent < cur_indent_lvl) {
        // unwind_to queues one DEDENT per pop. Return one here and drop its count.
        unwind_to(scanner, indent);
        scanner->pending_dedents--;
        lexer->result_symbol = DEDENT;
        STATS_PATH(SP_DEDENT_UNWIND); return true;
    } else if (valid_symbols[NEWLINE]) {
        // No indent change, or DEDENT not yet valid: close the logical line with NEWLINE.
        // Pre-queue: if the next line is already shallower but the grammar can't take
        // DEDENT yet (e.g. a single-line field needing NEWLINE first), unwind now, before
        // consume_blanks discards the indent the later DEDENT call would need.
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

// Emit both grammars' external-scanner ABI symbols. Each .so links one set via its
// parser.c. The other is dead-stripped or unreachable.
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
