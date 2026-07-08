/**
 * @file Tree-sitter grammar for GHC's simplifier-explanation logs:
 *       `-ddump-rule-firings` and `-ddump-inlinings`.
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// These two dumps are bannerless line logs, NOT Core surface syntax (feed real
// Core to tree-sitter-ghc-core). Each line is one record:
//
//   Rule fired: <name> (<origin>)         -- origin is BUILTIN or a module
//   Inlining done: <id>                   -- default form
//
// A rule name may hold spaces, arrows, symbols, and even parentheses
// (`Class op +`, `Int# -> Integer -> Int#`, `fold/build`, `+#`,
// `paren (in) name`).
//
// The origin is the FINAL ` (...)` group at end of line, so the name-vs-origin
// split needs lookahead a token regex cannot express: the scanner
// (src/scanner.c) emits `rule_name` ending before that final group.
//
// The keyword tokens never lose a longest-match race because `rule_name`/`module`
// are only valid AFTER their keyword (tree-sitter's lexer is state-scoped).
//
// `-ddump-inlinings -dppr-debug` instead emits a bare `Inlining done:` header
// followed by an indented, multi-line typed-Core body. The scanner decides
// id-vs-body by peeking past the keyword and captures the body opaquely as
// `detail`, so verbose dumps parse without error.
export default grammar({
  name: "ghc_core_explain",

  // Newlines are significant (they terminate a record and bound a verbose
  // body). Only the intra-line gap is trivia.
  extras: (_) => [/[ \t\f]/],

  // Emitted by the scanner (src/scanner.c): the rule name (after `Rule fired:`,
  // ending before the trailing origin), and after `Inlining done:` the
  // same-line identifier or the indented verbose body block.
  externals: ($) => [$.rule_name, $.inlined_id, $.detail],

  // A category's trailing inline count ("5 LetFloatFromLet 5") looks, in the
  // token stream, like the leading count of the next category.
  //
  // Entries are not newline-separated at the top level, so the two parses are
  // ambiguous until the separating newline arrives (it kills the "new category"
  // stack, since a category needs a name after its count).
  //
  // GLR defers the choice to then.
  conflicts: ($) => [[$.tick_category]],

  rules: {
    source_file: ($) => repeat(choice($._entry, $._newline)),

    _entry: ($) =>
      choice(
        $.rule_firing,
        $.inlining,
        $.iterations,
        $.total_ticks,
        $.tick_category,
      ),

    _newline: (_) => token(/\r?\n/),

    rule_firing: ($) =>
      seq(
        "Rule fired:",
        field("name", $.rule_name),
        optional(field("provenance", $.provenance)),
      ),

    provenance: ($) => seq("(", choice($.builtin, $.module), ")"),

    // A built-in rule has no defining module. Wins the same-length tie with
    // `module` on the literal "BUILTIN".
    builtin: (_) => token(prec(1, "BUILTIN")),
    module: (_) => token(/[A-Z][A-Za-z0-9_'.]*/),

    inlining: ($) =>
      seq(
        "Inlining done:",
        choice(field("name", $.inlined_id), field("detail", $.detail)),
      ),

    // `-ddump-simpl-stats`: the per-pass tick breakdown that rides in the same
    // stream as the firing trace (coreviewer concatenates both into one body).
    //
    // A blank separator line is a bare `_newline`. A `_indent` (newline THEN
    // whitespace) heads a detail line.
    //
    // Longest-match picks between them, so no scanner state is needed as long as
    // GHC's blank separators stay empty.

    // "Simplifier reached fixed point after N iterations" and its bail-out /
    // ticks-exhausted variants. Phrasing drifts across GHCs, so match the
    // keyword and take the rest opaquely (mirrors coreviewer's verbatim keep).
    iterations: (_) => seq("Simplifier", optional(token(/[^\r\n]+/))),

    total_ticks: ($) => seq("Total ticks:", field("count", $.number)),

    // A column-0 bucket "<count> <Category>" (optionally a trailing inline
    // count, e.g. "5 LetFloatFromLet 5"), then its indented per-binder detail.
    tick_category: ($) =>
      seq(
        field("count", $.number),
        field("name", $.category_name),
        optional($.number),
        repeat($.tick_detail),
      ),

    // "  <count> <name>": a rule phrase (spaces, arrows) under RuleFired, else
    // a binder id. The name runs to end of line.
    tick_detail: ($) =>
      seq($._indent, field("count", $.number), field("name", $.detail_name)),

    number: (_) => token(/[0-9]+/),
    category_name: (_) => token(/[A-Z][A-Za-z0-9_']*/),
    detail_name: (_) => token(/[^\r\n]+/),
    _indent: (_) => token(/\r?\n[ \t]+/),
  },
});
