/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Surface shared by the GHC Core and STG grammars: the System-FC type grammar
// (compiler/GHC/Iface/Type.hs), the qualified-name lexical tokens, the literal
// tokens, and the phase banner. Spread the makeXRules() results into a grammar's
// `rules` (after its own `source_file`, which must stay the start rule). The
// type rules reference the lexical rules ($.variable/constructor/special_con/
// operator), so a grammar using makeTypeRules must also use makeLexicalRules.

import { sepBy } from "./combinators.mjs";

// The phase banner ==================== <phase> ====================, printed
// around every GHC dump. The middle is required (>=1 char) so an all-`=` body
// line is not a banner. Used by all four grammars (members and the ghc-dump
// container).
export const banner = ($) => token(prec(1, /={4,}[^\n]+={4,}/));

// Integer / float / char / string literals (Core and STG print these the same).
export function makeLiteralRules() {
  return {
    literal: ($) =>
      choice($._int_lit, $._float_lit, $._char_lit, $._string_lit),

    _int_lit: ($) => token(/-?[0-9]+#*/),
    _float_lit: ($) => token(/-?[0-9]+\.[0-9]+#*/),
    _char_lit: ($) => token(/'(\\.|[^'\\])'#*/),
    _string_lit: ($) => token(/"(\\.|[^"\\])*"#*/),
  };
}

// Qualified GHC names. variable: optional `pkg-ver:` package qualifier and
// `Module.Sub.` qualifier, then a lower/underscore/$-led name. `#` may appear
// within (unboxed workers). Trailing operator/colon segments cover method
// selectors ($c==, $c<$) and operator-TyCon names ($tc:~:1). constructor:
// upper-led, with trailing `:Upper` segments for class-dictionary cons (C:C,
// C:Show, D:R:FInt).
// operator: symbolic primops/ops in prefix position (+#, ==#, (.), (.&.)).
// special_con: built-in/parenthesised cons ([] : (,) (##) (#,#) ()), qualified.
export function makeLexicalRules() {
  return {
    variable: ($) =>
      token(
        /([a-z][A-Za-z0-9.-]*:)?([A-Z][A-Za-z0-9_']*\.)*[a-z_$][A-Za-z0-9_'$#]*([-+*/<>=~!&|^%$:]+[A-Za-z0-9_'$#]*)*/,
      ),
    constructor: ($) =>
      token(
        /([a-z][A-Za-z0-9.-]*:)?([A-Z][A-Za-z0-9_']*\.)*[A-Z][A-Za-z0-9_'#]*(:[A-Z][A-Za-z0-9_'#]*)*/,
      ),
    operator: ($) => token(/([A-Z][A-Za-z0-9_']*\.)*[-+*/<>=!&|^%.]+#*/),
    special_con: ($) =>
      token(/([A-Z][A-Za-z0-9_']*\.)*(\[\]|:|\(,+\)|\(#+\)|\(#(,+)#\)|\(\))/),
  };
}

// The System-FC type grammar. Depends on the lexical rules above and on `sepBy`.
export function makeTypeRules() {
  return {
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
    kinded_tyvar: ($) => seq("(", $.tyvar, $._dcolon, $._type, ")"),
    inferred_tyvar: ($) =>
      seq("{", $.tyvar, optional(seq($._dcolon, $._type)), "}"),

    // `::` and its -fprint-unicode-syntax glyph.
    _dcolon: ($) => choice("::", "∷"),

    function_type: ($) => prec.right(seq($._type_btype, $._type_op, $._type)),
    _type_op: ($) =>
      choice("->", "→", "⊸", "=>", "⇒", "~R#", $.mult_arrow, $.type_operator),
    // Two shapes: symbolic (possibly qualified) and colon-led. A lone `=` is
    // never a type operator (it's the binding separator), so a `=`-led op needs
    // a second symbolic char (==#, =<<). Literal arrows win by string precedence.
    type_operator: ($) =>
      token(
        choice(
          /([A-Z][A-Za-z0-9_']*\.)*([-+*/<>~!&|^%][-+*/<>=~!&|^%]*|=[-+*/<>=~!&|^%]+)#*/,
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
        $.special_con,
        $.operator,
        $.tyvar,
        $._type_literal,
        $.type_list,
        $.type_paren_form,
        $.unboxed_type,
        $.promoted_type,
        $.star,
        $.ellipsis,
      ),
    star: ($) => "*",
    ellipsis: ($) => "...",

    tyvar: ($) => $.variable,

    _type_literal: ($) => choice(token(/[0-9]+/), token(/"(\\.|[^"\\])*"/)),

    type_list: ($) => seq("[", sepBy(",", $._type), "]"),

    type_paren_form: ($) =>
      seq(
        "(",
        optional(
          seq(
            $._type,
            repeat(seq(",", $._type)),
            optional(seq($._dcolon, $._type)),
          ),
        ),
        ")",
      ),

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
  };
}
