/**
 * @file Tree-sitter grammar for GHC's simplifier-explanation logs:
 *       `-ddump-rule-firings` and `-ddump-inlinings`.
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// These dumps are bannerless line logs. They are not Core syntax, which
// tree-sitter-ghc-core parses. Each line is one record:
//
//   Rule fired: <name> (<origin>)         -- origin is BUILTIN or a module
//   Inlining done: <id>                   -- default form
//
// A rule name can hold spaces, arrows, symbols, and parentheses, e.g.
// `Int# -> Integer -> Int#` and `paren (in) name`. The scanner (src/scanner.c)
// splits the name from the origin, and captures the `-dppr-debug` inlining body
// as `detail`.
//
// `rule_name` and `module` are valid only after their keyword, so they never
// beat a keyword token on longest match.
export default grammar({
  name: "ghc_core_explain",

  // A newline ends a record and bounds a verbose body, so it is not an extra.
  extras: (_) => [/[ \t\f]/],

  externals: ($) => [$.rule_name, $.inlined_id, $.detail],

  // The trailing count in "5 LetFloatFromLet 5" looks like the leading count of
  // the next category. GLR keeps both parses until the next newline, which ends
  // the "new category" parse because a category needs a name after its count.
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

    // Wins the tie with `module` on the literal "BUILTIN".
    builtin: (_) => token(prec(1, "BUILTIN")),
    module: (_) => token(/[A-Z][A-Za-z0-9_'.]*/),

    inlining: ($) =>
      seq(
        "Inlining done:",
        choice(field("name", $.inlined_id), field("detail", $.detail)),
      ),

    // The rules from here on parse the `-ddump-simpl-stats` tick breakdown.
    // coreviewer puts it in the same body as the firing trace.
    //
    // A blank separator line is a bare `_newline`, and `_indent` (a newline, then
    // whitespace) starts a detail line. Longest match picks between them, which
    // holds only while the blank separators of GHC stay empty.

    // "Simplifier reached fixed point after N iterations" and its variants. The
    // wording changes across GHC versions, so the rest of the line is opaque.
    iterations: (_) => seq("Simplifier", optional(token(/[^\r\n]+/))),

    total_ticks: ($) => seq("Total ticks:", field("count", $.number)),

    // "<count> <Category>" at column 0, then indented detail lines.
    tick_category: ($) =>
      seq(
        field("count", $.number),
        field("name", $.category_name),
        optional($.number),
        repeat($.tick_detail),
      ),

    // The name is a rule phrase with spaces under RuleFired, and a binder id
    // under every other category.
    tick_detail: ($) =>
      seq($._indent, field("count", $.number), field("name", $.detail_name)),

    number: (_) => token(/[0-9]+/),
    category_name: (_) => token(/[A-Z][A-Za-z0-9_']*/),
    detail_name: (_) => token(/[^\r\n]+/),
    _indent: (_) => token(/\r?\n[ \t]+/),
  },
});
