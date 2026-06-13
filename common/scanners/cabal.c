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
// `just stats` in each per-grammar directory). Off in normal builds: the
// macros expand to `(void)0` so the dead-code stripper drops them entirely.
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
// Times the NEWLINE branch's unwind_to actually popped levels (vs being a no-op).
// High values mean the pre-queue logic is doing real work; near-zero means the
// NEWLINE branch could skip the unwind_to call.
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
// Cabal-syntax uses one lexer for both file formats. The .cabal vs .project distinction
// is purely semantic.
//
// ABI constraint: both grammars must list all seven tokens in this exact order in their
// `externals` arrays. Tree-sitter sizes valid_symbols by the count of declared externals,
// indexed by position. Removing or reordering an entry shifts subsequent indices and
// causes out-of-bounds reads in scanner_scan. Both grammars reference _field_name from a
// `choice($._word_or_ascii_regex, $._field_name)` rule; cabal additionally references
// _section_name. cabal-project declares _section_name in its externals for enum
// alignment but does not reference it in any rule, so its valid_symbols slot is never set.
//
// Indentation is measured in spaces. Blank lines reset the count to zero and are
// skipped.
//
// Leniencies vs Cabal's own lexer (Distribution.Fields.Lexer). This scanner accepts
// input Cabal would reject; the grammar still parses such files rather than failing
// fast. Track here so the divergence is visible:
//
//   1. Tabs in indentation. Cabal rejects them. We advance to the next 8-space stop
//      (consume_blanks) and treat tabs as horizontal whitespace before a newline
//      (scanner_scan). Reason: real-world .cabal files in HLS/Cabal corpora contain
//      stray tabs; rejecting would cause spurious parse failures in editors.
//   2. NBSP (U+00A0) in indentation. Cabal treats NBSP as an ordinary character. We
//      count it as one space. Reason: paste-from-doc accidents; cheap to tolerate.
//   3. CR (\r) anywhere. Cabal rejects bare CR. We skip silently so CRLF files parse
//      identically to LF files.
//   4. Comment indent. Cabal comments (`--`) are layout-transparent regardless of
//      column. We follow that exactly; noted because it differs from Haskell's
//      layout rule, which does respect comment columns in some positions.

// NEWLINE     - End of a logical line. Fired when the next non-blank line has the same
//               or a greater indent, or when DEDENT is not yet valid and must be
//               pre-queued.
//
// INDENT      - Opens a new indented block. Pushes the new column onto the stack.
//               Only valid immediately after a block header (section name, if/elif/else).
//               The grammar never makes INDENT valid at the same time as INDENTED or
//               CONTINUATION.
//
// DEDENT      - Closes an indented block. Extra DEDENTs when multiple levels unwind at
//               once are queued in pending_dedents and drained on subsequent calls.
//
// INDENTED    - "Lenient continuation": the next line is deeper than prev_indent_lvl,
//               the level before the most recent INDENT push. The .cabal grammar uses
//               this in its multi-line field rule. After INDENT opens the value block,
//               continuation lines may sit at any column above prev, including the same
//               column as the first value line, which CONTINUATION would reject.
//
// CONTINUATION - "Strict continuation": the next line is deeper than cur_indent_lvl.
//               The .cabal-project grammar uses this so sibling fields at the same
//               column as the preceding field name are not absorbed into its value.
enum Token {
    NEWLINE,
    INDENT,
    DEDENT,
    INDENTED,
    CONTINUATION,
    // Hidden Unicode-fallback name externals. Both grammars wire FIELD_NAME
    // through a `choice(ASCII, $._field_name)` rule and route their visible
    // section_name / field_name nodes through it. SECTION_NAME is referenced
    // only by the cabal grammar; cabal-project declares but doesn't use it.
    SECTION_NAME,
    FIELD_NAME,
};

typedef struct {
    // Stack of indentation columns in spaces. Always contains at least one element:
    // the sentinel 0 at the root level.
    //   indents.back()     == cur_indent_lvl  (column of the innermost open block)
    //   indents[size - 2]  == prev_indent_lvl (column before the last INDENT push),
    //                         used by the INDENTED check; only defined when size >= 2.
    Array(uint16_t) indents;
    // DEDENTs queued for future calls. When the scanner emits NEWLINE but the next
    // line is already less indented, it pre-pops the stack and stores the deficit here.
    // Each subsequent call for DEDENT drains one count and returns without advancing.
    uint16_t pending_dedents;
    // True once we've emitted the implicit NEWLINE at EOF. Files without a trailing
    // newline need one virtual NEWLINE so the last field/line can close, but the
    // scanner cannot advance the lexer past EOF, so firing NEWLINE unconditionally
    // would loop whenever the grammar sits in repeat($._newline). Once set, only the
    // DEDENT-at-EOF path is allowed to fire on subsequent calls.
    bool eof_newline_emitted;
} Scanner;

// Restore the scanner to its initial state: empty indent stack with the
// sentinel 0 at the bottom, no queued dedents, EOF flag clear. Used at
// construction time and by scanner_deserialize when a cached state is
// missing or fails validation.
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

// Name-character predicates used by the section_name / field_name dispatch
// in scanner_scan. The four ASCII clauses are the hot path; `>= 0x80` is
// what lets Unicode names parse without paying the DFA-bloat cost of a
// Unicode regex (see the comment block on the dispatch itself).
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

// Advance past spaces and blank lines and return the column of the next significant
// character. Tabs advance to the next 8-space stop, NBSP counts as a space, \r is
// skipped silently so CRLF files behave identically to LF files. EOF (lookahead 0)
// exits the loop naturally.
static uint16_t consume_blanks(TSLexer *lexer) {
    uint32_t indent = 0;
    while (true) {
        // Ordered by frequency in real .cabal files: spaces dominate, newlines next
        // (blank-line skipping), tabs occasionally, CR only in CRLF files, NBSP almost
        // never.
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
//
//   Layout: [pending lo][pending hi][stack_size lo][stack_size hi][eof_flag]
//           then stack_size pairs of [col lo][col hi].
//
// All multi-byte values are little-endian because the buffer has no alignment
// guarantee. The buffer is aliased as unsigned char so storing values 128..255
// is well-defined. Assigning out-of-range values to plain char is
// implementation-defined per C17 6.3.1.3p3.
enum {
    SERIAL_HEADER_BYTES = 5,
    SERIAL_ENTRY_BYTES = 2,
    SERIAL_MAX_ENTRIES =
        (TREE_SITTER_SERIALIZATION_BUFFER_SIZE - SERIAL_HEADER_BYTES) / SERIAL_ENTRY_BYTES,
};

// stack_size is clamped to the number of entries that fit after the header so
// the written count never disagrees with the bytes that follow it. The header
// always fits because TREE_SITTER_SERIALIZATION_BUFFER_SIZE is 1024.
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

// Restore state from the buffer written by scanner_serialize. The buffer is
// treated as untrusted input. Anything that violates the indent-stack invariants
// the rest of the scanner relies on (non-empty, sentinel 0 at the bottom, strictly
// increasing) causes a reset to fresh state, rather than corruption propagating
// into unwind_to where it would pop past the sentinel and dereference past the
// end of the indents array. A buffer shorter than the header is also reset.
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

    // unwind_to terminates because the bottom is 0 (indent < 0 is impossible for
    // uint16_t), and every push site only ever pushes a value strictly greater
    // than the current top.
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

// Pop the indent stack until the top is <= indent, queuing one DEDENT per pop.
// If indent lands strictly between two stack levels (error recovery), push it so
// the stack stays accurate. No-op when indent already >= the current top.
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

    // Drain one queued DEDENT without advancing. The lexer position was already
    // committed when the dedents were queued (consume_blanks ran in a prior call),
    // so no further advance is needed.
    if (valid_symbols[DEDENT] && scanner->pending_dedents > 0) {
        scanner->pending_dedents--;
        lexer->result_symbol = DEDENT;
        STATS_PATH(SP_PENDING_DEDENT); return true;
    }
    // At EOF, keep returning DEDENT for as many calls as the grammar makes. Tree-sitter
    // discards scanner state when parsing ends, so the stack is never consulted again.
    if (UNLIKELY(valid_symbols[DEDENT] && lexer->eof(lexer))) {
        lexer->result_symbol = DEDENT;
        STATS_PATH(SP_EOF_DEDENT); return true;
    }
    // Latches once so the grammar's repeat($._newline) cannot loop on the virtual
    // NEWLINE. See eof_newline_emitted in the Scanner struct.
    if (UNLIKELY(valid_symbols[NEWLINE] && lexer->eof(lexer) &&
                 !scanner->eof_newline_emitted)) {
        scanner->eof_newline_emitted = true;
        lexer->result_symbol = NEWLINE;
        STATS_PATH(SP_EOF_NEWLINE); return true;
    }

    // Name dispatch. Implements an ASCII-fast / Unicode-fallback split,
    // shared by both grammars:
    //
    //   - The grammar's visible `field_name` (and cabal's `section_name`)
    //     is a non-terminal that `choice`s between the existing ASCII
    //     terminal (cabal's regex, cabal-project's $._word word token) and
    //     the hidden $._field_name / $._section_name external below.
    //   - For ASCII names we return false. The DFA picks among its
    //     candidates with normal precedence — cabal's ci-regex aliases
    //     (`library`, `if`, …) beat the field_name regex by specificity,
    //     and cabal-project's keyword extraction routes `_word` through
    //     literal aliases (`package`, `repository`, …). Emitting
    //     unconditionally would steal both kinds of keyword.
    //   - For Unicode names we commit, because both grammars' ASCII
    //     terminals stop at the first byte ≥ 0x80 and the parser would
    //     error. Unicode can sit anywhere in the name (`x-無`, `Fünfstück`),
    //     so we walk the whole body before deciding. The wasted advances
    //     on pure-ASCII names cost ~17M Ir on the cabal corpus; the DFA
    //     savings from not having a Unicode range in the regex are ~105M Ir.
    //
    // `lookahead` is the codepoint, pre-decoded from UTF-8 by tree-sitter,
    // so the `>= 0x80` check in is_name_start covers any non-ASCII char in
    // a single integer compare.
    //
    // cabal-project never sets valid_symbols[SECTION_NAME] (no section_name
    // rule references it), so that branch is effectively cabal-only.
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
    // Skip leading horizontal whitespace and \r so trailing spaces before a line
    // ending don't block NEWLINE/DEDENT detection. Tree-sitter calls the external
    // scanner before consuming extras, so if the lexer sits on a trailing space the
    // scanner would otherwise see ' ' as the lookahead and return false.
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
           lexer->lookahead == '\r' || lexer->lookahead == 0x00A0) {
        lexer->advance(lexer, true);
        STATS_ITER_ENTRY_WS();
    }
    if (lexer->eof(lexer) || lexer->lookahead != '\n') {
        STATS_PATH(SP_FALSE_NO_NL); return false;
    }

    uint16_t cur_indent_lvl = *array_back(&scanner->indents);
    // prev_indent_lvl: the block level before the most recent INDENT push. INDENTED
    // checks against this value, not cur, so continuation lines can sit at the same
    // column as the first value line (which pushed an INDENT above prev).
    uint16_t prev_indent_lvl =
        scanner->indents.size >= 2
            ? *array_get(&scanner->indents, scanner->indents.size - 2)
            : 0;

    // Advance past the triggering '\n' and measure the next significant line's column.
    lexer->advance(lexer, true);
    uint16_t indent = consume_blanks(lexer);

    // Cabal comments (`--` to end of line) are layout-transparent. They must not drive
    // INDENT or DEDENT decisions. We peek past any run of `--` lines to find the next
    // real line's indent, calling mark_end before the first comment so the scanner
    // token ends there. Tree-sitter then re-lexes the comment as an extras node.
    //
    // pre_block: between a block header and its yet-unopened body, GLR also reduces
    // the empty-body path so both INDENT and DEDENT are valid. In that state a
    // header-column comment must be skipped so a deeper body line behind it can still
    // produce INDENT. Inside an unclosed field only INDENT is valid, so pre_block
    // flips false and same-indent comments are left to the extras mechanism.
    bool pre_block = valid_symbols[INDENT] && valid_symbols[DEDENT];
    bool marked = false;
    while (lexer->lookahead == '-' && (indent != cur_indent_lvl || pre_block)) {
        if (!marked) {
            lexer->mark_end(lexer);
            marked = true;
        }
        lexer->advance(lexer, true);  // past first '-'
        if (lexer->lookahead != '-') {
            // Single '-', not a comment. mark_end already placed the token boundary
            // before this character so tree-sitter re-lexes it via the normal lexer.
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
        // INDENT is checked first. The grammar should not make both valid at once,
        // but this ordering makes the priority explicit.
        lexer->result_symbol = CONTINUATION;
        STATS_PATH(SP_CONTINUATION); return true;
    } else if (valid_symbols[INDENTED] && indent > prev_indent_lvl) {
        // Deeper than prev (not cur), so a continuation line at the same column as the
        // first value line still passes.
        lexer->result_symbol = INDENTED;
        STATS_PATH(SP_INDENTED); return true;
    } else if (valid_symbols[DEDENT] && indent < cur_indent_lvl) {
        // Unwind the stack and emit one DEDENT directly. The helper queues one per pop,
        // so we subtract one to account for the DEDENT returned here.
        unwind_to(scanner, indent);
        scanner->pending_dedents--;
        lexer->result_symbol = DEDENT;
        STATS_PATH(SP_DEDENT_UNWIND); return true;
    } else if (valid_symbols[NEWLINE]) {
        // No indent change (or DEDENT not yet valid). Emit NEWLINE to close the
        // current logical line.
        //
        // Pre-queue: if the next line is already less indented than cur but the grammar
        // has not reached a state where DEDENT is valid (e.g. a single-line field rule
        // that requires NEWLINE first), unwind the stack now. By the time the grammar
        // requests DEDENT, consume_blanks has already advanced past the whitespace and
        // the indent information is gone.
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

// Emit both grammars' external scanner ABI symbols from this translation unit. Each
// grammar's .so links one set via its generated parser.c. The other set is dead-
// stripped by the linker or present but unreachable.
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
