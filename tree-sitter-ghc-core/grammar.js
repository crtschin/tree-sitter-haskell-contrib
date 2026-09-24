/**
 * @file Tree-sitter grammar for GHC Core dumps (e.g. `-ddump-simpl` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Models the System FC surface that the GHC Core printer emits
// (compiler/GHC/Core/Ppr.hs). Braces and keywords delimit every expression, and
// the external scanner recovers the column-0 top-level layout. IdInfo brackets,
// coercion bodies, and non-Core trailing sections parse as balanced soup.

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

  // After a signature type, the next atom is a type argument or the binding name
  // on the next line. A same-line `constructor` or `tyvar` also completes as a
  // wrapper name, so `type_apply` takes a dynamic precedence that keeps it in the
  // type (see common/grammar/haskell.mjs).
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
    // A group head begins a binding or a bare expression statement. Only the `=`
    // decides.
    [$._def_name, $._stmt_head],
    // A parenthesised operator is either a binder name `(:|) = ..` or a
    // parenthesised atom (in a bare expression or an argument).
    [$.paren_operator, $._atom],
    [$.paren_operator, $._operator_atom],
    // A leading `/` opens a lambda or a prefix division. See `_operator_atom`.
    [$._operator_atom, $.lambda],
    // A binding's trailing `;` (the -ddump-late-cc layout terminator) collides
    // with the `;` that separates bindings inside a `let { b1; b2 }`. GLR keeps
    // whichever completes: the separator reading inside a let, the terminator
    // reading at top level.
    [$.binding],
  ],

  rules: {
    // The first section is inlined because only the start rule can match empty.
    // Its banner is optional because some harvested stderr strips it.
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
        optional($.rules_block),
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
        optional($.rules_block),
        optional($._item_sep),
      ),

    // GHC appends the local-rules block to the emitting pass's own dump_doc
    // (GHC.Core.Lint pp_rules), so it tails that section and the next `====`
    // banner still opens the next one.
    rules_block: ($) => seq($.dash_header, repeat($._soup)),

    // Simplifier-iteration dumps print a counts preamble whose `---- .. ----` lines lex as
    // comments, so only the `Total ticks: N` line needs a rule.
    simplifier_stats: ($) => token(/Total ticks:[^\n]*/),

    _group: ($) => choice($.binding, $.rec_block, $.expr_statement),

    // The `==== Simplified expression ====` dump (-ddump-simpl-expr) is one bare
    // CoreExpr with no `name =`.
    //
    //   - The head excludes a bare literal and a `[..]` bracket, so a trailing
    //     rules or CorePrep section stays soup.
    //   - The negative dynamic precedence keeps the binding reading when a `=`
    //     follows.
    //   - A top-level cast hangs off `_stmt_head`, because the `_atom` lhs of
    //     `cast` admits a bare literal.
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
        $._operator_atom,
        $.con_operator,
        $.operator_name,
        $.special_con,
        $.parens,
        $.tuple,
        $.unboxed_tuple,
        $.foreign_call,
      ),

    // Non-Core sections after Tidy Core, e.g. `Tidy Core rules` and CorePrep
    // tails. The soup stops at the next header, which beats a soup token by
    // longest match. A dash header never opens a section, see `rules_block`.
    trailing_sections: ($) => repeat1(seq($.banner, repeat($._soup))),

    // `---- Local rules for imported ids ----`. The precedence beats the `--`
    // line comment.
    dash_header: ($) => token(prec(2, /-{4,}[^\n]*-{4,}/)),

    banner,

    // The pass description can hold its own `(..)` record, e.g.
    // `Float out(FOS {..})`, that GHC 9.12+ wraps across lines.
    result_size: ($) =>
      token(/Result size of[^\n(]*(\([^)]*\))?\s*=\s*\{[^}]*\}/),

    // Rec bindings are blank-line separated (ITEM_SEP). `Rec {` abuts the first
    // and `end Rec }` abuts the last (single newlines, no ITEM_SEP).
    rec_block: ($) =>
      seq("Rec", "{", sepBy1($._item_sep, $.binding), "end", "Rec", "}"),

    // The binders are join-point parameters. A let-bound type prints its binder
    // as a bare `@a` line above `a = TYPE: t`, so the signature slot also takes a
    // `type_binder`.
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

    // CorePrep binds data-con wrappers under upper-led names, e.g. `Coerce.GB`.
    _def_name: ($) =>
      choice($.variable, $.constructor, $.paren_operator, $.operator_name),
    paren_operator: ($) =>
      seq("(", choice($.operator, $.con_operator, $.operator_name), ")"),

    idinfo: soupBracket,

    _binder: ($) =>
      choice($.variable, $.annotated_binder, $.typed_binder, $.type_binder),

    annotated_binder: ($) => seq($.variable, $.binder_annotation),

    typed_binder: ($) =>
      seq(
        "(",
        $.variable,
        optional($.binder_annotation),
        $._dcolon,
        $._type,
        // -dppr-debug appends the IdInfo of the binder after the type, e.g.
        // `:: t Unf=..`.
        repeat($._soup),
        ")",
      ),

    binder_annotation: soupBracket,

    ...makeSoupRules(),

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

    // -dppr-case-as-let prints a single-alternative case in this form.
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

    cast: ($) => prec.left(seq($._atom, "`cast`", $.coercion)),

    // An unsuppressed `(co :: t1 ~role# t2)`, or a bare `<Co:N>` or Refl
    // `<ty>_N` atom. The soup treats angle brackets as atoms, because the
    // function-coercion arrow `->_R` has a lone `>`.
    coercion: ($) =>
      choice(
        seq("(", repeat($._soup), ")"),
        seq($._soup_token, optional(seq($._dcolon, $._type))),
      ),

    // A lone `/` lexes as the lambda head, because an anonymous string beats the
    // `operator` regex. The alias recovers the prefix division
    // `(/ @Double $fFractionalDouble x y)`.
    //
    // An unparenthesised `->` also lexes as an `operator`, so both readings can
    // complete. The negative dynamic precedence gives that tie to the lambda.
    _operator_atom: ($) =>
      choice($.operator, prec.dynamic(-1, alias("/", $.operator))),

    _atom: ($) =>
      choice(
        $.variable,
        $.constructor,
        $._operator_atom,
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

    // A data-constructor operator such as `:|`. The first char after the `:`
    // excludes `:`, so the `::` ascription does not match.
    con_operator: ($) =>
      token(
        /([A-Z][A-Za-z0-9_']*\.)*:[-+*/<>=~!&|^%.][-+*/<>=~!&|^%.:]*(\{[^}]*\})?/,
      ),

    // GHC mangles some operator binders to symbolic names with a trailing-digit
    // disambiguator. Three shapes that `operator` and `con_operator` miss:
    //   - `@`-led, e.g. `@?6`. A type application never puts an operator char
    //     after the `@`. The first char excludes `~` to keep `@~coercion` intact.
    //   - `\`-led, e.g. `\\1`. The second symbol char keeps the lone lambda `\`
    //     out.
    //   - An operator run glued to digits, e.g. `>*<1`. The run needs 2 or more
    //     chars, so the negative literal `-1` does not match.
    operator_name: ($) =>
      token(
        choice(
          /@[-+*/<>=!&|^%.?][-+*/<>=~!&|^%.?:@\\]*[0-9]*/,
          /\\[-+*/<>=~!&|^%.?:@\\]+[0-9]*/,
          /[-+*/<>=!&|^%.?~:][-+*/<>=!&|^%.?~:]+[0-9]+/,
        ),
      ),

    // `{__ffi_static_ccall_unsafe pkg:sym :: ty} arg..`
    //
    //   - An RTS symbol drops the unit and glues `:sym` to the keyword, so the
    //     keyword token takes that colon.
    //   - A dynamic call prints its target as the empty string `""`.
    //   - Under -dppr-debug the Unique glues onto the closing brace as a
    //     `{v d12d}` tag.
    foreign_call: ($) =>
      seq(
        "{",
        $._ffi_keyword,
        field("target", choice($.variable, $.constructor, $.literal)),
        optional(field("symbol", $._string_lit)),
        $._dcolon,
        field("type", $._type),
        "}",
        optional($._ppr_debug_tag),
      ),
    _ffi_keyword: ($) => token(/__ffi_[a-z_]+:?/),
    _ppr_debug_tag: ($) => token(/\{[^}]*\}/),

    // An occurrence IdInfo, `[gid..]` or `[lid..]`, under -dppr-debug.
    id_annotation: soupBracket,

    // A -dppr-debug case binder, e.g. `(wild [Occ=Dead] :: t Unf=..)`.
    debug_binder: ($) => prec.dynamic(1, seq("(", repeat($._soup), ")")),

    // -dppr-debug ascribes a parenthesised expression with its type, `(e :: t)`.
    parens: ($) => seq("(", $._expr, optional(seq($._dcolon, $._type)), ")"),
    tuple: ($) => seq("(", $._expr, repeat1(seq(",", $._expr)), ")"),
    unboxed_tuple: ($) => seq("(#", sepBy(",", $._expr), "#)"),

    application: ($) => prec.left(seq($._atom, repeat1($._arg))),

    _arg: ($) => choice($._atom, $.type_arg, $.coercion_arg),
    type_arg: ($) => seq("@", $._type_atom),
    coercion_arg: ($) => seq("@~", $.coercion),

    // GHC prints the head as `\`, or `λ` under -fprint-unicode-syntax
    // (Outputable.lambda). The `/` is the testsuite normaliser's, which rewrites
    // `\` before comparing .stderr. See `_operator_atom` for what it costs.
    lambda: ($) =>
      seq(
        choice("\\", "λ", "/"),
        repeat1($._binder),
        choice("->", "→"),
        $._expr,
      ),

    // -dppr-debug prints the join target as `(v :: t)`.
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

    tuple_pattern: ($) =>
      choice(
        seq("(", $._binder, repeat1(seq(",", $._binder)), ")"),
        seq("(#", sepBy(",", $._binder), "#)"),
      ),

    ...makeLiteralRules(),
    ...makeTickRules(),
    ...makeTypeRules(),
    ...makeLexicalRules(),

    // A `-- RHS size: {..}` record wraps across lines in big dumps. The record
    // body admits only record chars, so it cannot run past its `}` into the
    // braces of a binding.
    comment: ($) =>
      token(choice(seq("--", /[^\n]*/), /--[^{\n]*\{[\s\w.,:/]*\}/)),
  },
});
