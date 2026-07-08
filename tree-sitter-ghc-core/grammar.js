/**
 * @file Tree-sitter grammar for GHC Core dumps (e.g. `-ddump-simpl` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Models the System FC surface GHC's Core printer emits (compiler/GHC/Core/Ppr.hs,
// compiler/GHC/Iface/Type.hs). Expressions are fully brace/keyword-delimited.
//
//   - The external scanner's _item_sep (src/scanner.c) recovers the column-0
//     top-level layout, and bounds a multi-line signature from the binding line
//     below it.
//
//   - The [IdInfo] bracket, coercion bodies, and trailing banner-delimited
//     sections (Tidy Core rules, CorePrep) are modelled coarsely as balanced
//     delimiter soup, a deliberate leniency over structure.
//
// This drives the harvested Tidy Core and repeated-pass dumps (CSE, float,
// occur-anal, simplifier iterations) to a clean parse. See README.md.

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

  // After a signature's type, the next atom is either a type-application argument
  // or the binding name on the next line. Let GLR explore both. Munching the
  // next-line name dies (the binding can't complete), but a trailing same-line
  // `constructor`/`tyvar` also completes as a wrapper name, so type_apply carries a
  // prec.dynamic to keep it in the type (see common/grammar/haskell.mjs).
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
    // soup (`"r" [1] (@a)..`), all balanced bracket soup. GLR's viability picks.
    [$.idinfo, $._soup],
    [$._soup, $.id_annotation],
    // A group's head may begin a binding (`name ..  = ..`) or a bare expression
    // statement (the `Simplified expression` section). They share the leading
    // name/atom. The `=` decides, so GLR explores both.
    [$._def_name, $._stmt_head],
    // A parenthesised operator is either a binder name `(:|) = ..` or a
    // parenthesised atom (in a bare expression or an argument).
    [$.paren_operator, $._atom],
    // A binding's trailing `;` (the -ddump-late-cc layout terminator) collides
    // with the `;` that separates bindings inside a `let { b1; b2 }`. GLR keeps
    // whichever completes: the separator reading inside a let, the terminator
    // reading at top level.
    [$.binding],
  ],

  rules: {
    // One or more banner-delimited Core sections, then an optional non-Core tail captured
    // as soup. The first section is inlined here because the start rule may match empty (a
    // named rule may not), and its banner is optional for harvested stderr that strips it.
    // A section is a banner, an optional simplifier-counts preamble and Result-size header,
    // then _item_sep-separated binding groups.
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

    // Simplifier-iteration dumps print a counts preamble whose `---- .. ----` lines lex as
    // comments, so only the `Total ticks: N` line needs a rule.
    simplifier_stats: ($) => token(/Total ticks:[^\n]*/),

    _group: ($) => choice($.binding, $.rec_block, $.expr_statement),

    // The `==== Simplified expression ====` dump (-ddump-simpl-expr, some TH
    // splices) is a single bare CoreExpr with no `name =`.
    //
    //   - Its head excludes a bare literal or `[..]` bracket (those would be a
    //     rule's `"name"` string or an [IdInfo]/soup bracket), so a trailing
    //     rules/CorePrep section stays soup.
    //
    //   - A bare expr and a binding share a leading run, so the negative dynamic
    //     precedence keeps the binding whenever a `=` follows. A bare expr only
    //     wins in an expression-only section.
    //
    //   - A top-level cast hangs off `_stmt_head`, not the full `cast` rule
    //     (whose `_atom` lhs would re-admit a bare-literal head), preserving the
    //     no-bare-literal invariant.
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
          prec.left(
            seq(
              $._stmt_head,
              repeat($._arg),
              optional(seq("`cast`", $.coercion)),
            ),
          ),
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

    // Header-delimited sections after the Tidy Core: `==== .. ====` banners and `---- ..
    // ----` markers (e.g. `------ Local rules for imported ids --------`, bannerless
    // rules). Coarse balanced soup per section, stopping at the next header (which
    // out-lexes a soup token by longest match).
    trailing_sections: ($) =>
      repeat1(seq(choice($.banner, $.dash_header), repeat($._soup))),

    // ------ Local rules for imported ids -------- (4+ dashes both ends, so it
    // out-precedences the `--` line comment).
    dash_header: ($) => token(prec(2, /-{4,}[^\n]*-{4,}/)),

    // ==================== Tidy Core ==================== (shared)
    banner,

    // Result size of Tidy Core = {terms: 182, types: 90, ...}. The pass description can
    // carry its own `(..)` record (Float out(FOS {..})) that GHC 9.12+ wraps across lines,
    // so allow it to span newlines (bounded by the first `)`) before the `= {..}` record.
    result_size: ($) =>
      token(/Result size of[^\n(]*(\([^)]*\))?\s*=\s*\{[^}]*\}/),

    // Rec bindings are blank-line separated (ITEM_SEP). `Rec {` abuts the first
    // and `end Rec }` abuts the last (single newlines, no ITEM_SEP).
    rec_block: ($) =>
      seq("Rec", "{", sepBy1($._item_sep, $.binding), "end", "Rec", "}"),

    // A binding, optionally preceded by its type signature (same group, single newline, no
    // _item_sep). The binders are join-point parameters (empty for ordinary bindings). A
    // multi-line signature type is bounded by where the binding `name` parses (GLR).
    // A let-bound type prints its binder as a bare `@a` line above the `a = TYPE: t`
    // equation, so the signature slot also accepts a `type_binder` (worker/wrapper -O output).
    binding: ($) =>
      seq(
        optional(field("signature", choice($.type_signature, $.type_binder))),
        optional(field("info", $.idinfo)),
        field("name", $._def_name),
        repeat($._binder),
        "=",
        field("rhs", $._expr),
        // -ddump-late-cc layout-terminates a binding whose rhs ends in `}`
        // (case/let) with a `;` before the next packed group. Absent elsewhere.
        optional(";"),
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
        // -dppr-debug appends the binder's IdInfo after the type (`:: t Unf=..`,
        // `Str=..`), absorbed as coarse soup so the `variable`/type stay structured.
        repeat($._soup),
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

    // A coercion, either `(co :: t1 ~role# t2)` unsuppressed or a bare atom:
    // the suppressed `<Co:N>` (optionally with its `:: type`) or a Refl `<ty>_N`.
    //
    //   - The body is coarse balanced soup for now
    //     (Sym/Sub/Trans/axioms/SelCo/forall-co/function-co).
    //
    //   - Angle brackets are treated as atoms (the function-coercion arrow
    //     `->_R` carries a lone `>`), so (), [] and {} nest (a forall-co prints
    //     its binder brace, `forall {a}. ..`).
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
    //     `@type`/`@kind` application (those lead with a letter/`(`/`*`). The
    //     first char excludes `~` so `@~coercion` stays intact.
    //   - `\`-led (`\\1`): `\` is an operator char too, so requiring a second
    //     symbol char keeps a lambda's lone `\` out.
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

    // A C foreign call printed as an applied primitive (Core/Ppr FCallId):
    // `{__ffi_static_ccall_unsafe pkg:sym :: ty} arg..`.
    //
    //   - The target is a package-qualified C symbol `unit:sym`. An RTS/wired-in
    //     symbol drops the unit and glues `:sym` to the keyword, which absorbs
    //     that colon.
    //
    //   - A dyn call's DynamicTarget prints as the empty C label `""`, a string
    //     literal.
    //
    //   - Under -dppr-debug the FCallId's Unique glues onto the closing brace as
    //     a `{v d12d}` tag, absorbed explicitly here (a plain Var carries it
    //     inside its name token, the structural `}` cannot).
    //
    //   - The rest of the debug decoration (`Just Many` multiplicity,
    //     `[gid[ForeignCall]]` IdInfo, `:: ty` ascription) parses like a
    //     decorated plain Var.
    foreign_call: ($) =>
      seq(
        "{",
        $._ffi_keyword,
        field("target", choice($.variable, $.constructor, $.literal)),
        // The C symbol name, printed as a string after the target
        // (`__ffi_static_ccall_safe pkg:sym "sym" :: ty`).
        optional(field("symbol", $._string_lit)),
        $._dcolon,
        field("type", $._type),
        "}",
        optional($._ppr_debug_tag),
      ),
    _ffi_keyword: ($) => token(/__ffi_[a-z_]+:?/),
    _ppr_debug_tag: ($) => token(/\{[^}]*\}/),

    // [gid..] / [lid..]: an occurrence's IdInfo, printed inline under
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
