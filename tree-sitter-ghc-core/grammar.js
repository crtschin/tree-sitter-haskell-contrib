/**
 * @file Tree-sitter grammar for GHC Core dumps (e.g. `-ddump-simpl` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Models the System FC surface GHC's Core printer emits (compiler/GHC/Core/Ppr.hs).
// Expressions are fully brace/keyword-delimited; the top-level layout (each
// binding / Rec marker starts in column 0, continuations are indented) is
// recovered by the external scanner's _item_sep token (src/scanner.c).
//
// Coverage so far targets the structural surface of a `-dsuppress-all` dump:
// bindings, Rec groups, and the expression grammar (lambda, application,
// let/letrec/join/joinrec, jump, case + alternatives, literals). Type
// signatures, the [IdInfo] bracket, qualified names, casts/coercions, ticks and
// typed/@-binders are not modelled yet -- see README.md.

const sepBy1 = (sep, rule) => seq(rule, repeat(seq(sep, rule)));

export default grammar({
  name: "ghc_core",

  externals: ($) => [$._item_sep],

  extras: ($) => [/[ \t\r\n\f]/, $.comment],

  word: ($) => $.variable,

  rules: {
    source_file: ($) => repeat(seq($._top_item, $._item_sep)),

    _top_item: ($) => choice($.banner, $.result_size, $.rec_block, $.binding),

    // ==================== Tidy Core ====================
    banner: ($) => token(prec(1, /={4,}[^\n]*={4,}/)),

    // Result size of Tidy Core
    //   = {terms: 182, types: 90, coercions: 0, joins: 4/8}
    result_size: ($) => token(/Result size of[^{]*\{[^}]*\}/),

    // Rec { <binding>; ... end Rec }
    rec_block: ($) =>
      seq(
        "Rec",
        "{",
        $._item_sep,
        sepBy1($._item_sep, $.binding),
        $._item_sep,
        "end",
        "Rec",
        "}",
      ),

    // A top-level, let-bound, or join binding: `name <binders> = rhs`. The
    // binders are the join-point parameters (empty for ordinary bindings).
    binding: ($) =>
      seq(
        field("name", $.variable),
        repeat($._binder),
        "=",
        field("rhs", $._expr),
      ),

    _binder: ($) => $.variable,

    _expr: ($) =>
      choice($.lambda, $.let, $.case, $.jump, $.application, $._atom),

    _atom: ($) =>
      choice(
        $.variable,
        $.constructor,
        $.operator,
        $.literal,
        $.special_con,
        $.parens,
      ),

    parens: ($) => seq("(", $._expr, ")"),

    application: ($) => prec.left(seq($._atom, repeat1($._atom))),

    lambda: ($) => seq("\\", repeat1($._binder), "->", $._expr),

    // jump j a1 ... an  (a tail call to a join point; see ppr_id_occ)
    jump: ($) => seq("jump", $.variable, repeat($._atom)),

    // <kw> { binds } in body. let/join bind one; letrec/joinrec bind a
    // semicolon-terminated group (ppr_bind appends `;` per Rec binding).
    let: ($) =>
      seq(
        field("kind", choice("let", "letrec", "join", "joinrec")),
        "{",
        choice($.binding, repeat1(seq($.binding, ";"))),
        "}",
        "in",
        field("body", $._expr),
      ),

    case: ($) =>
      seq(
        "case",
        field("scrutinee", $._expr),
        "of",
        field("binder", optional($.variable)),
        "{",
        optional(sepBy1(";", $.alternative)),
        "}",
      ),

    alternative: ($) =>
      seq(field("pattern", $.pattern), "->", field("rhs", $._expr)),

    pattern: ($) => choice($.literal, "__DEFAULT", $.con_pattern),

    con_pattern: ($) =>
      seq(choice($.constructor, $.special_con), repeat($._binder)),

    literal: ($) =>
      choice($._int_lit, $._float_lit, $._char_lit, $._string_lit),

    _int_lit: ($) => token(/-?[0-9]+#*/),
    _float_lit: ($) => token(/-?[0-9]+\.[0-9]+#*/),
    _char_lit: ($) => token(/'(\\.|[^'\\])'#*/),
    _string_lit: ($) => token(/"(\\.|[^"\\])*"#*/),

    // Lower/underscore/$-led names (variables, wildcards, $w-workers, joins).
    variable: ($) => /[a-z_$][A-Za-z0-9_'$]*/,
    // Upper-led data constructors and worker names (I#, TrNameS, True).
    constructor: ($) => /[A-Z][A-Za-z0-9_']*#?/,
    // Symbolic primops used in prefix position (+#, *#, ==#, ># ...).
    operator: ($) => token(/[-+*/<>=~!&|^%]+#*/),
    // Built-in list constructors.
    special_con: ($) => choice("[]", ":"),

    comment: ($) => token(seq("--", /[^\n]*/)),
  },
});
