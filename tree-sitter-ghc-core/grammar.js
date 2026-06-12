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
// balanced delimiter soup -- leniency over structure. Drives ~93% of harvested
// Tidy Core dumps to a clean parse; a few stubborn files (a GLR/lexer
// interaction on qualified special-cons after a signature, bannerless SPEC
// rules) still error. See README.md.

const sepBy1 = (sep, rule) => seq(rule, repeat(seq(sep, rule)));
const sepBy = (sep, rule) => optional(sepBy1(sep, rule));

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

    // Any banner-delimited sections after the Tidy Core: `Tidy Core rules`,
    // CorePrep, Demand signatures, Simplified expression, etc. Captured coarsely
    // as balanced soup per section (leniency over structure); each section's soup
    // stops at the next banner, which out-lexes a soup token by longest match.
    trailing_sections: ($) => repeat1(seq($.banner, repeat($._soup))),

    // ==================== Tidy Core ====================
    banner: ($) => token(prec(1, /={4,}[^\n]*={4,}/)),

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
        field("name", $.variable),
        repeat($._binder),
        "=",
        field("rhs", $._expr),
      ),

    type_signature: ($) =>
      seq($.variable, optional($.binder_annotation), "::", $._type),

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

    // Balanced bracket/brace/paren soup with arbitrary non-delimiter tokens.
    _soup: ($) =>
      choice(
        $._soup_token,
        seq("(", repeat($._soup), ")"),
        seq("{", repeat($._soup), "}"),
        seq("[", repeat($._soup), "]"),
      ),
    _soup_token: ($) => token(/[^\s()\[\]{}]+/),

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

    literal: ($) =>
      choice($._int_lit, $._float_lit, $._char_lit, $._string_lit),

    _int_lit: ($) => token(/-?[0-9]+#*/),
    _float_lit: ($) => token(/-?[0-9]+\.[0-9]+#*/),
    _char_lit: ($) => token(/'(\\.|[^'\\])'#*/),
    _string_lit: ($) => token(/"(\\.|[^"\\])*"#*/),

    // ---- types (compiler/GHC/Iface/Type.hs) ----

    _type: ($) => choice($.forall_type, $.function_type, $._type_btype),

    forall_type: ($) =>
      prec.right(
        seq(
          choice("forall", "∀"),
          repeat1($._forall_binder),
          choice(".", "->", "→"),
          $._type,
        ),
      ),
    _forall_binder: ($) => choice($.tyvar, $.kinded_tyvar, $.inferred_tyvar),
    kinded_tyvar: ($) => seq("(", $.tyvar, "::", $._type, ")"),
    // Inferred-visibility binders: forall {a} {a :: k}. ...
    inferred_tyvar: ($) => seq("{", $.tyvar, optional(seq("::", $._type)), "}"),

    function_type: ($) => prec.right(seq($._type_btype, $._type_op, $._type)),
    _type_op: ($) =>
      choice("->", "→", "⊸", "=>", "⇒", "~R#", $.mult_arrow, $.type_operator),
    // Infix type operators: type-level + (Nat), :~:, qualified GHC.Prim.~#, etc.
    // Two shapes -- symbolic (possibly qualified) and colon-led -- the latter
    // requiring a non-colon char so it never swallows the `::` separator.
    // Literal arrows -> / => still win by string precedence.
    type_operator: ($) =>
      token(
        choice(
          /([A-Z][A-Za-z0-9_']*\.)*[-+*/<>=~!&|^%][-+*/<>=~!&|^%]*#*/,
          /:[-+*/<>=~!&|^%][-+*/<>=~!&|^%:]*/,
        ),
      ),
    mult_arrow: ($) => seq("%", $._type_atom, choice("->", "→")),

    _type_btype: ($) => choice($.type_apply, $._type_atom),
    type_apply: ($) =>
      prec.left(seq($._type_btype, choice($._type_atom, $.kind_app))),
    kind_app: ($) => seq("@", $._type_atom),

    _type_atom: ($) =>
      choice(
        $.constructor,
        $.tyvar,
        $._type_literal,
        $.type_list,
        $.type_paren_form,
        $.unboxed_type,
        $.promoted_type,
        $.star, // the `*` kind (e.g. forall (t :: * -> *). ..)
        $.ellipsis, // `...` -- an elided type, e.g. a coercion type under -dsuppress-coercion-types
      ),
    star: ($) => "*",
    ellipsis: ($) => "...",

    tyvar: ($) => $.variable,

    _type_literal: ($) => choice(token(/[0-9]+/), token(/"(\\.|[^"\\])*"/)),

    type_list: ($) => seq("[", sepBy(",", $._type), "]"),

    // Covers (), (t), (t, u, ...) and the kind signature (t :: k).
    type_paren_form: ($) =>
      seq(
        "(",
        optional(
          seq($._type, repeat(seq(",", $._type)), optional(seq("::", $._type))),
        ),
        ")",
      ),

    // (# t, ... #) unboxed tuple and (# t | ... #) unboxed sum.
    unboxed_type: ($) =>
      seq(
        "(#",
        optional(seq($._type, repeat(seq(choice(",", "|"), $._type)))),
        "#)",
      ),

    promoted_type: ($) =>
      seq(
        "'",
        choice($.constructor, $.special_con, $.type_list, $.type_paren_form),
      ),

    // ---- lexical ----

    // Optional `pkg-ver:` package qualifier and `Module.Sub.` qualifier, then a
    // lower/underscore/$-led name. `#` may appear within (unboxed workers,
    // c##_a#io); a trailing operator run covers method selectors like $c== / $c<$.
    variable: ($) =>
      token(
        /([a-z][A-Za-z0-9.-]*:)?([A-Z][A-Za-z0-9_']*\.)*[a-z_$][A-Za-z0-9_'$#]*[-+*/<>=~!&|^%$]*/,
      ),
    // Qualified upper-led data constructors / worker names (I#, GHC.Types.I#).
    constructor: ($) =>
      token(
        /([a-z][A-Za-z0-9.-]*:)?([A-Z][A-Za-z0-9_']*\.)*[A-Z][A-Za-z0-9_'#]*/,
      ),
    // Symbolic primops used in prefix position (+#, *#, ==#, ># ...).
    operator: ($) => token(/([A-Z][A-Za-z0-9_']*\.)*[-+*/<>=!&|^%]+#*/),
    // Built-in / parenthesised constructors, optionally module-qualified:
    // [] : (,) (,,) () (##) (#,#) and GHC.Types.[] etc.
    special_con: ($) =>
      token(/([A-Z][A-Za-z0-9_']*\.)*(\[\]|:|\(,+\)|\(#+\)|\(#(,+)#\)|\(\))/),

    comment: ($) => token(seq("--", /[^\n]*/)),
  },
});
