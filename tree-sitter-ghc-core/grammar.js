/**
 * @file Tree-sitter grammar for GHC Core dumps (e.g. `-ddump-simpl` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Models the System FC surface GHC's Core printer emits (compiler/GHC/Core/Ppr.hs,
// compiler/GHC/Iface/Type.hs). Expressions are fully brace/keyword-delimited; the
// top-level layout (each binding / type signature / Rec marker starts in column
// 0, continuations are indented) is recovered by the external scanner's
// _item_sep token (src/scanner.c), which also bounds a multi-line type signature
// from the binding line that follows it.
//
// Coverage (plan layers A-D): bindings with optional type signatures and the
// [IdInfo] bracket, Rec groups, the expression grammar (lambda -- `\` or `/` --,
// application incl. @type / @~coercion args, let/letrec/join/joinrec, jump, case
// + alternatives + tuple patterns, literals), qualified and package-qualified
// names, a type grammar (forall incl. inferred {a}, contexts, arrows incl.
// multiplicity, application, lists/tuples/kinds/promotion/equality, infix type
// operators, `*` kind, `...`), occurrence-annotated binders, casts and coercions
// (paren/bare with their `:: t1 ~role# t2`), ticks (src<..>), and trailing
// banner-delimited sections (Tidy Core rules / CorePrep / ...). The [IdInfo]
// bracket, coercion bodies and trailing sections are modelled coarsely as
// balanced delimiter soup -- leniency over structure. Drives ~98% of harvested
// Tidy Core dumps to a clean parse; the last few error on a trailing CorePrep
// section with internal blank lines and on operator-embedded compiler names
// (`$tc:~:1`). See README.md.

import { sepBy1, sepBy } from "./common/grammar/combinators.mjs";
import { makeSoupRules } from "./common/grammar/soup.mjs";
import {
  banner,
  makeLexicalRules,
  makeLiteralRules,
  makeTypeRules,
} from "./common/grammar/haskell.mjs";

export default grammar({
  name: "ghc_core",

  externals: ($) => [$._item_sep],

  extras: ($) => [/[ \t\r\n\f]/, $.comment],

  word: ($) => $.variable,

  // After a signature's type, the next `variable` is either a type-application
  // argument or the binding name on the next line. Let GLR explore both; the
  // over-munch branch dies because the binding then can't complete.
  conflicts: ($) => [
    [$._type, $.type_apply],
    // A leading banner may attach to the header or start a trailing section;
    // either parses cleanly, so let GLR pick.
    [$.source_file, $.trailing_sections],
    // A `[..]` before a `(` is an IdInfo bracket on an operator binding
    // (`[GblId] (+++) = ..`) or trailing-rule soup (`"r" [1] (@a)..`); GLR's
    // viability picks (a rule's `(@a)` is not a paren_operator).
    [$.idinfo, $._soup],
  ],

  rules: {
    // Optional banner + Result-size header (which may abut, as in harvested
    // stderr, or be blank-separated, as in -ddump-to-file output), then the
    // binding groups, which ARE blank-separated by _item_sep (that separator
    // also bounds each binding's RHS expression), then any trailing sections.
    // The corpus selector keeps only files that lead with a Tidy Core banner;
    // multi-dump captures that lead with other sections (Demand/Cpr signatures,
    // compile logs) are excluded as the container grammar's domain.
    source_file: ($) =>
      seq(
        optional($.banner),
        optional($._item_sep),
        optional($.result_size),
        optional($._item_sep),
        sepBy($._item_sep, $._group),
        optional($._item_sep),
        optional($.trailing_sections),
        optional($._item_sep),
      ),

    _group: ($) => choice($.binding, $.rec_block),

    // Any header-delimited sections after the Tidy Core: `==== .. ====` banners
    // (Tidy Core rules, CorePrep, ...) and `---- .. ----` markers (e.g. `------
    // Local rules for imported ids --------`, which introduces bannerless rules).
    // Captured coarsely as balanced soup per section (leniency over structure);
    // each section's soup stops at the next header, which out-lexes a soup token
    // by longest match.
    trailing_sections: ($) =>
      repeat1(seq(choice($.banner, $.dash_header), repeat($._soup))),

    // ------ Local rules for imported ids -------- (4+ dashes both ends, so it
    // out-precedences the `--` line comment).
    dash_header: ($) => token(prec(2, /-{4,}[^\n]*-{4,}/)),

    // ==================== Tidy Core ==================== (shared)
    banner,

    // Result size of Tidy Core
    //   = {terms: 182, types: 90, coercions: 0, joins: 4/8}
    // (A pass description containing its own `{..}`, e.g. Float out(FOS {..}),
    // isn't handled here yet -- a -ddump-float-out-only concern.)
    result_size: ($) => token(/Result size of[^{]*\{[^}]*\}/),

    // Rec bindings are blank-line separated (ITEM_SEP); `Rec {` abuts the first
    // and `end Rec }` abuts the last (single newlines, no ITEM_SEP).
    rec_block: ($) =>
      seq("Rec", "{", sepBy1($._item_sep, $.binding), "end", "Rec", "}"),

    // A binding, optionally preceded by its type signature (a single newline
    // away -- same binding group, no ITEM_SEP). The binders are join-point
    // parameters (empty for ordinary bindings). A multi-line signature type is
    // bounded by where the binding `name` parses (GLR), since no token separates
    // them.
    binding: ($) =>
      seq(
        optional(field("signature", $.type_signature)),
        optional(field("info", $.idinfo)),
        field("name", $._def_name),
        repeat($._binder),
        "=",
        field("rhs", $._expr),
      ),

    type_signature: ($) =>
      seq($._def_name, optional($.binder_annotation), "::", $._type),

    // A defined name: an ordinary id, or an operator printed in prefix form
    // ((+++), (.)) -- GHC parenthesises operator-named top-level binders.
    _def_name: ($) => choice($.variable, $.paren_operator),
    paren_operator: ($) => seq("(", $.operator, ")"),

    // The [IdInfo] bracket (GblId, Arity=N, Str=<..>, Cpr=.., Unf=Unf{..Tmpl=e},
    // RULES: ..). Modelled coarsely as balanced delimiter soup for now; the
    // Tmpl= template is real Core to be recursed into in a later pass.
    idinfo: ($) => prec.dynamic(1, seq("[", repeat($._soup), "]")),

    _binder: ($) =>
      choice($.variable, $.annotated_binder, $.typed_binder, $.type_binder),

    // A binder carrying an occurrence/demand annotation, e.g. x [Occ=Once1!].
    annotated_binder: ($) => seq($.variable, $.binder_annotation),

    typed_binder: ($) =>
      seq("(", $.variable, optional($.binder_annotation), "::", $._type, ")"),

    binder_annotation: ($) => prec.dynamic(1, seq("[", repeat($._soup), "]")),

    // Balanced bracket/brace/paren soup (shared with ghc-stg/ghc-cmm).
    ...makeSoupRules(),

    // Lambda-bound type variables: @a, @{a} (inferred), (@ a).
    type_binder: ($) =>
      choice(
        seq("@", $._type_atom),
        seq("@", "{", $._type, "}"),
        seq("(", "@", $._type, ")"),
      ),

    _expr: ($) =>
      choice(
        $.lambda,
        $.let,
        $.case,
        $.jump,
        $.cast,
        $.tick_expr,
        $.application,
        $._atom,
      ),

    // e `cast` co  (compiler/GHC/Core/Ppr.hs ppr_expr Cast).
    cast: ($) => prec.left(seq($._atom, "`cast`", $.coercion)),

    // <tickish> e  -- source notes (src<..>) from -g3, cost-centre ticks, etc.
    tick_expr: ($) => seq($.tickish, $._expr),
    tickish: ($) => token(/(src|tick|scc)<[^>]*>/),

    // A coercion: `(co :: t1 ~role# t2)` unsuppressed, or a bare atom -- the
    // suppressed `<Co:N>` (optionally with its `:: type`) or a Refl `<ty>_N`.
    // The body is coarse balanced soup for now (Sym/Sub/Trans/axioms/SelCo/
    // forall-co/function-co); angle brackets are atoms, not delimiters (the
    // function-coercion arrow `->_R` carries a lone `>`), so only () and [] nest.
    coercion: ($) =>
      choice(
        seq("(", repeat($._co_soup), ")"),
        // bare/suppressed: <Co:N> or <ty>_R, optionally with its `:: type`.
        seq($._co_token, optional(seq("::", $._type))),
      ),
    _co_soup: ($) =>
      choice(
        $._co_token,
        seq("(", repeat($._co_soup), ")"),
        seq("[", repeat($._co_soup), "]"),
      ),
    _co_token: ($) => token(/[^\s()\[\]{}]+/),

    _atom: ($) =>
      choice(
        $.variable,
        $.constructor,
        $.operator,
        $.literal,
        $.special_con,
        $.parens,
        $.tuple,
        $.unboxed_tuple,
      ),

    parens: ($) => seq("(", $._expr, ")"),
    tuple: ($) => seq("(", $._expr, repeat1(seq(",", $._expr)), ")"),
    unboxed_tuple: ($) => seq("(#", sepBy(",", $._expr), "#)"),

    application: ($) => prec.left(seq($._atom, repeat1($._arg))),

    _arg: ($) => choice($._atom, $.type_arg, $.coercion_arg),
    type_arg: ($) => seq("@", $._type_atom),
    coercion_arg: ($) => seq("@~", $.coercion),

    // GHC prints the lambda head as `\`; some (newer) dumps render it `/`.
    lambda: ($) => seq(choice("\\", "/"), repeat1($._binder), "->", $._expr),

    jump: ($) => seq("jump", $.variable, repeat($._arg)),

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
        field("binder", optional(choice($.variable, $.annotated_binder))),
        "{",
        sepBy(";", $.alternative),
        "}",
      ),

    alternative: ($) =>
      seq(field("pattern", $.pattern), "->", field("rhs", $._expr)),

    pattern: ($) =>
      choice($.literal, "__DEFAULT", $.con_pattern, $.tuple_pattern),

    con_pattern: ($) =>
      seq(choice($.constructor, $.special_con), repeat($._binder)),

    // Tuple patterns: (a, b), (# a, b #).
    tuple_pattern: ($) =>
      choice(
        seq("(", $._binder, repeat1(seq(",", $._binder)), ")"),
        seq("(#", sepBy(",", $._binder), "#)"),
      ),

    // Literals, the System-FC type grammar, and qualified-name lexical tokens
    // are shared with ghc-stg (common/grammar/haskell.mjs).
    ...makeLiteralRules(),
    ...makeTypeRules(),
    ...makeLexicalRules(),

    // A line comment, or a `-- RHS size: {..}` whose count record wraps across
    // lines (big dumps print thousand-separated counts, e.g. terms: 1,236). The
    // wrapped body is bounded to record chars (word/space/.,:/) so it can never
    // run past its `}` into a binding's braces. (Core-specific; STG/Cmm differ.)
    comment: ($) =>
      token(choice(seq("--", /[^\n]*/), /--[^{\n]*\{[\s\w.,:/]*\}/)),
  },
});
