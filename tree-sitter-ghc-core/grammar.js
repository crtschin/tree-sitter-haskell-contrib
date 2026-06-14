/**
 * @file Tree-sitter grammar for GHC Core dumps (e.g. `-ddump-simpl` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Models the System FC surface GHC's Core printer emits (compiler/GHC/Core/Ppr.hs,
// compiler/GHC/Iface/Type.hs). Expressions are fully brace/keyword-delimited. The
// top-level layout (each binding, type signature, or Rec marker starts in column
// 0, continuations are indented) is recovered by the external scanner's
// _item_sep token (src/scanner.c), which also bounds a multi-line type signature
// from the binding line that follows it.
//
// Coverage (plan layers A-D): bindings with optional type signatures and the
// [IdInfo] bracket, Rec groups, the expression grammar (lambda head `\` or `/`,
// application incl. @type / @~coercion args, let/letrec/join/joinrec, jump, case
// + alternatives + tuple patterns, literals), qualified and package-qualified
// names, a type grammar (forall incl. inferred {a}, contexts, arrows incl.
// multiplicity, application, lists/tuples/kinds/promotion/equality, infix type
// operators, `*` kind, `...`), occurrence-annotated binders, casts and coercions
// (paren/bare with their `:: t1 ~role# t2`), ticks (src<..>), and trailing
// banner-delimited sections (Tidy Core rules, CorePrep, and so on). The [IdInfo]
// bracket, coercion bodies and trailing sections are modelled coarsely as
// balanced delimiter soup, a deliberate leniency over structure. Drives the
// harvested Tidy Core dumps to a clean parse, along with the repeated-section
// pass dumps (CSE, float, occur-anal, the simplifier iterations). See README.md.

import { sepBy1, sepBy } from "./common/grammar/combinators.mjs";
import { makeSoupRules, soupBracket } from "./common/grammar/soup.mjs";
import {
  banner,
  makeLexicalRules,
  makeLiteralRules,
  makeTickRules,
  makeTypeRules,
} from "./common/grammar/haskell.mjs";

export default grammar({
  name: "ghc_core",

  externals: ($) => [$._item_sep],

  extras: ($) => [/[ \t\r\n\f]/, $.comment],

  word: ($) => $.variable,

  // After a signature's type, the next `variable` is either a type-application
  // argument or the binding name on the next line. Let GLR explore both. The
  // over-munch branch dies because the binding then can't complete.
  conflicts: ($) => [
    [$._type, $.type_apply],
    // A banner may open another Core section or a trailing soup section. Both
    // parse cleanly, so let GLR pick by viability.
    [$.source_file, $._later_section, $.trailing_sections],
    [$._later_section, $.trailing_sections],
    [$.source_file, $._later_section],
    [$._later_section],
    // A `:: type` after a bare coercion inside `(..)` could close the coercion's
    // own optional ascription or the enclosing parens ascription. Let GLR pick.
    [$.coercion],
    // A `[..]` is an IdInfo bracket on an operator binding (`[GblId] (+++) = ..`),
    // an occurrence's id_annotation in a bare expr_statement, or trailing-rule
    // soup (`"r" [1] (@a)..`) - all balanced bracket soup. GLR's viability picks.
    [$.idinfo, $._soup],
    [$._soup, $.id_annotation],
    // A group's head may begin a binding (`name ..  = ..`) or a bare expression
    // statement (the `Simplified expression` section). They share the leading
    // name/atom; the `=` decides, so GLR explores both.
    [$._def_name, $._stmt_head],
    // A parenthesised operator is either a binder name `(:|) = ..` or a
    // parenthesised atom (in a bare expression or an argument).
    [$.paren_operator, $._atom],
  ],

  rules: {
    // GHC emits one or more banner-delimited Core sections, then an optional
    // non-Core tail (Tidy Core rules, CorePrep, local rules) captured as soup.
    // The harvested Tidy Core leads with one section whose banner the stderr
    // capture may strip. Passes that run repeatedly (the simplifier iterations,
    // occur-anal, CSE, float) concatenate many sections, and the container
    // grammar splits these same banners. A section is its banner, an optional
    // simplifier-counts preamble and Result-size header, then the binding groups
    // blank-separated by _item_sep (that separator also bounds each binding's
    // RHS expression).
    // The first section is inlined here (the start rule may match empty, which
    // a named rule may not). Its banner is optional for harvested stderr.
    source_file: ($) =>
      seq(
        optional($._item_sep),
        optional($.banner),
        optional($.simplifier_stats),
        optional($._item_sep),
        optional($.result_size),
        optional($._item_sep),
        sepBy($._item_sep, $._group),
        optional($._item_sep),
        repeat($._later_section),
        optional($.trailing_sections),
        optional($._item_sep),
      ),

    _later_section: ($) =>
      seq(
        $.banner,
        optional($.simplifier_stats),
        optional($._item_sep),
        optional($.result_size),
        optional($._item_sep),
        sepBy($._item_sep, $._group),
        optional($._item_sep),
      ),

    // Simplifier iteration dumps print a counts preamble between the banner and
    // the Result-size header. The `---- .. ----` lines lex as comments. Only the
    // `Total ticks: N` line needs a rule.
    simplifier_stats: ($) => token(/Total ticks:[^\n]*/),

    _group: ($) => choice($.binding, $.rec_block, $.expr_statement),

    // The `==== Simplified expression ====` dump (-ddump-simpl-expr, also emitted
    // for some TH splices) prints a section whose body is a single bare CoreExpr
    // with no `name =`. Its head is a variable/constructor/paren/keyword form,
    // never a bare literal or `[..]` bracket - those would be a rule's `"name"`
    // string or an [IdInfo]/soup bracket, so excluding them keeps a trailing
    // rules/CorePrep section as soup. A bare expr and a binding still share a
    // leading run; the negative dynamic precedence makes GLR keep the binding
    // whenever a `=` follows, so a bare expr only wins in an expression-only
    // section.
    expr_statement: ($) =>
      prec.dynamic(
        -1,
        choice(
          $.lambda,
          $.let,
          $.case,
          $.case_as_let,
          $.jump,
          $.tick_expr,
          prec.left(seq($._stmt_head, repeat($._arg))),
        ),
      ),
    _stmt_head: ($) =>
      choice(
        $.variable,
        $.constructor,
        $.operator,
        $.con_operator,
        $.operator_name,
        $.special_con,
        $.parens,
        $.tuple,
        $.unboxed_tuple,
        $.foreign_call,
      ),

    // Any header-delimited sections after the Tidy Core: `==== .. ====` banners
    // (Tidy Core rules, CorePrep, ...) and `---- .. ----` markers (e.g. `------
    // Local rules for imported ids --------`, which introduces bannerless rules).
    // Captured coarsely as balanced soup per section (leniency over structure).
    // Each section's soup stops at the next header, which out-lexes a soup token
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
    // The pass description can carry its own `{..}` (Float out(FOS {..})), so
    // match the whole first line, then the `= {..}` record on the next line.
    result_size: ($) => token(/Result size of[^\n]*\s*=\s*\{[^}]*\}/),

    // Rec bindings are blank-line separated (ITEM_SEP). `Rec {` abuts the first
    // and `end Rec }` abuts the last (single newlines, no ITEM_SEP).
    rec_block: ($) =>
      seq("Rec", "{", sepBy1($._item_sep, $.binding), "end", "Rec", "}"),

    // A binding, optionally preceded by its type signature (a single newline
    // away, in the same binding group, no ITEM_SEP). The binders are join-point
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
      seq($._def_name, optional($.binder_annotation), $._dcolon, $._type),

    // A defined name: an ordinary id, a data-con wrapper (an upper-led name like
    // Coerce.GB, bound by CorePrep), or an operator printed in prefix form
    // ((+++), (.)). GHC parenthesises operator-named top-level binders.
    _def_name: ($) =>
      choice($.variable, $.constructor, $.paren_operator, $.operator_name),
    paren_operator: ($) =>
      seq("(", choice($.operator, $.con_operator, $.operator_name), ")"),

    // The [IdInfo] bracket (GblId, Arity=N, Str=<..>, Cpr=.., Unf=Unf{..Tmpl=e},
    // RULES: ..). Modelled coarsely as balanced delimiter soup for now. The
    // Tmpl= template is real Core to be recursed into in a later pass.
    idinfo: soupBracket,

    _binder: ($) =>
      choice($.variable, $.annotated_binder, $.typed_binder, $.type_binder),

    // A binder carrying an occurrence/demand annotation, e.g. x [Occ=Once1!].
    annotated_binder: ($) => seq($.variable, $.binder_annotation),

    typed_binder: ($) =>
      seq(
        "(",
        $.variable,
        optional($.binder_annotation),
        $._dcolon,
        $._type,
        ")",
      ),

    binder_annotation: soupBracket,

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
        $.case_as_let,
        $.jump,
        $.cast,
        $.tick_expr,
        $.application,
        $._atom,
      ),

    // -dppr-case-as-let prints a single-alternative case as
    // `let! { <pat> ~ <binder>? <- <scrutinee> } in <body>`.
    case_as_let: ($) =>
      seq(
        "let!",
        "{",
        field("pattern", $.pattern),
        "~",
        optional(choice($.variable, $.annotated_binder)),
        "<-",
        field("scrutinee", $._expr),
        "}",
        "in",
        field("body", $._expr),
      ),

    // e `cast` co  (compiler/GHC/Core/Ppr.hs ppr_expr Cast).
    cast: ($) => prec.left(seq($._atom, "`cast`", $.coercion)),

    // A coercion: `(co :: t1 ~role# t2)` unsuppressed, or a bare atom: the
    // suppressed `<Co:N>` (optionally with its `:: type`) or a Refl `<ty>_N`.
    // The body is coarse balanced soup for now (Sym/Sub/Trans/axioms/SelCo/
    // forall-co/function-co). Angle brackets are treated as atoms (the
    // function-coercion arrow `->_R` carries a lone `>`), so (), [] and {} nest
    // (a forall-co prints its binder brace, `forall {a}. ..`).
    coercion: ($) =>
      choice(
        seq("(", repeat($._soup), ")"),
        // bare/suppressed: <Co:N> or <ty>_R, optionally with its `:: type`.
        seq($._soup_token, optional(seq($._dcolon, $._type))),
      ),

    _atom: ($) =>
      choice(
        $.variable,
        $.constructor,
        $.operator,
        $.con_operator,
        $.operator_name,
        $.literal,
        $.special_con,
        $.parens,
        $.tuple,
        $.unboxed_tuple,
        $.foreign_call,
        $.id_annotation,
      ),

    // A `:`-led data-constructor operator (:|, :*:, :%, :=>, :~:), printed in
    // prefix form by Core (`:| a b`). The required second symbol char keeps the
    // `::` ascription out (its second char is `:`). Shared shape with the type
    // grammar's colon-led type_operator.
    con_operator: ($) =>
      token(
        /([A-Z][A-Za-z0-9_']*\.)*:[-+*/<>=~!&|^%.][-+*/<>=~!&|^%.:]*(\{[^}]*\})?/,
      ),

    // GHC mangles some operator-named binders to symbolic names printed bare or
    // parenthesised, with a trailing-digit occurrence disambiguator. Three shapes
    // the plain `operator`/`con_operator` tokens can't take:
    //   - `@`-led (`@?6`, `@?==2`, `(@.)`): a `@` + operator char is never a
    //     `@type`/`@kind` application (those lead with a letter/`(`/`*`); the
    //     first char excludes `~` so `@~coercion` stays intact.
    //   - `\`-led (`\\1`): `\` is an operator char too; requiring a second symbol
    //     char keeps a lambda's lone `\` out.
    //   - any operator run (>=2 symbol chars) glued to digits (`>*<1`): the >=2
    //     guard keeps a negative literal `-1` off this token.
    operator_name: ($) =>
      token(
        choice(
          /@[-+*/<>=!&|^%.?][-+*/<>=~!&|^%.?:@\\]*[0-9]*/,
          /\\[-+*/<>=~!&|^%.?:@\\]+[0-9]*/,
          /[-+*/<>=!&|^%.?~:][-+*/<>=!&|^%.?~:]+[0-9]+/,
        ),
      ),

    // A C foreign call printed as an applied primitive:
    // `{__ffi_static_ccall_unsafe pkg:sym :: ty} arg..` (Core/Ppr FCallId). The
    // target carries the package-qualified C symbol; the `:: ty` is its full
    // (often unboxed-tuple-returning) System-FC type.
    foreign_call: ($) =>
      seq(
        "{",
        $._ffi_keyword,
        field("target", choice($.variable, $.constructor)),
        $._dcolon,
        field("type", $._type),
        "}",
      ),
    _ffi_keyword: ($) => token(/__ffi_[a-z_]+/),

    // [gid..] / [lid..] -- an occurrence's IdInfo, printed inline under
    // -dppr-debug. Coarse balanced soup, like the binding [IdInfo].
    id_annotation: soupBracket,

    // A -dppr-debug case binder carries its annotations, type, and IdInfo inside
    // the parens, `(wild [Occ=Dead] :: t Unf=..)`. Coarse balanced soup.
    debug_binder: ($) => prec.dynamic(1, seq("(", repeat($._soup), ")")),

    // -dppr-debug ascribes a parenthesised expression with its type, `(e :: t)`.
    parens: ($) => seq("(", $._expr, optional(seq($._dcolon, $._type)), ")"),
    tuple: ($) => seq("(", $._expr, repeat1(seq(",", $._expr)), ")"),
    unboxed_tuple: ($) => seq("(#", sepBy(",", $._expr), "#)"),

    application: ($) => prec.left(seq($._atom, repeat1($._arg))),

    _arg: ($) => choice($._atom, $.type_arg, $.coercion_arg),
    type_arg: ($) => seq("@", $._type_atom),
    coercion_arg: ($) => seq("@~", $.coercion),

    // GHC prints the lambda head as `\`. Some newer dumps render it `/`.
    lambda: ($) =>
      seq(choice("\\", "/"), repeat1($._binder), choice("->", "→"), $._expr),

    // The join target is a variable, or `(v :: t)` under -dppr-debug.
    jump: ($) => seq("jump", $._atom, repeat($._arg)),

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
        // -dppr-debug prints the case's return type, `case e return t of ..`.
        optional(seq("return", $._type)),
        "of",
        field(
          "binder",
          optional(choice($.variable, $.annotated_binder, $.debug_binder)),
        ),
        "{",
        sepBy(";", $.alternative),
        "}",
      ),

    alternative: ($) =>
      seq(
        field("pattern", $.pattern),
        choice("->", "→"),
        field("rhs", $._expr),
      ),

    pattern: ($) =>
      choice($.literal, "__DEFAULT", $.con_pattern, $.tuple_pattern),

    con_pattern: ($) =>
      seq(
        choice($.constructor, $.special_con, $.con_operator),
        repeat($._binder),
      ),

    // Tuple patterns: (a, b), (# a, b #).
    tuple_pattern: ($) =>
      choice(
        seq("(", $._binder, repeat1(seq(",", $._binder)), ")"),
        seq("(#", sepBy(",", $._binder), "#)"),
      ),

    // Literals, the tickish prefix, the System-FC type grammar, and
    // qualified-name lexical tokens are shared with ghc-stg
    // (common/grammar/haskell.mjs).
    ...makeLiteralRules(),
    ...makeTickRules(),
    ...makeTypeRules(),
    ...makeLexicalRules(),

    // A line comment, or a `-- RHS size: {..}` whose count record wraps across
    // lines (big dumps print thousand-separated counts, e.g. terms: 1,236). The
    // wrapped body is bounded to record chars (word/space/.,:/) so it can never
    // run past its `}` into a binding's braces. (Specific to Core.)
    comment: ($) =>
      token(choice(seq("--", /[^\n]*/), /--[^{\n]*\{[\s\w.,:/]*\}/)),
  },
});
