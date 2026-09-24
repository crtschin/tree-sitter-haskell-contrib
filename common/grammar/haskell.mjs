/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Rules that the GHC Core and STG grammars share: System-FC types, names,
// literals and the phase banner. Spread each makeXRules() into `rules` after
// `source_file`, the start rule. makeTypeRules needs makeLexicalRules.

import { sepBy } from "./combinators.mjs";

// GHC prints a phase banner, `==== <phase> ====`, around every dump:
//
//   - The middle must hold a non-`=` char, so an all-`=` divider is not a
//     banner.
//
//   - The second alternative absorbs a pass record that wraps across lines
//     (GHC 9.12+ `Float out(FOS {..})`). The first `)` bounds it, so it cannot
//     span two banners.
export const banner = ($) =>
  token(
    prec(
      1,
      choice(
        /={4,}[^\n]*[^\n=][^\n]*={4,}/,
        /={4,}[^\n(]*\([^)]*\)[^\n]*={4,}/,
      ),
    ),
  );

export function makeLiteralRules() {
  return {
    literal: ($) =>
      choice($._int_lit, $._float_lit, $._char_lit, $._string_lit),

    // Some dumps glue a type tag to an unboxed literal (`0#Word64`). The tag
    // only follows a `#`, so a bare `0` never absorbs a following word.
    _int_lit: ($) => token(/-?[0-9]+(#+[A-Za-z][A-Za-z0-9_]*|#*)/),
    _float_lit: ($) => token(/-?[0-9]+\.[0-9]+(#+[A-Za-z][A-Za-z0-9_]*|#*)/),
    // An escape can be multi-char, e.g. `'\2048'` or `'\NUL'`, so `[^']*` takes
    // the rest of it up to the closing quote.
    _char_lit: ($) => token(/'(\\.[^']*|[^'\\])'#*/),
    // GHC splits a long string with a gap, `\ <whitespace> \`. The gap has its
    // own alternative for two reasons:
    //
    //   - It consumes the trailing `\`, so that `\` cannot escape the closing
    //     `"`.
    //
    //   - The escape `\\\S` stays disjoint from the gap. An overlapping
    //     `\\[\s\S]` lets a `\ \ \` run split many ways, which is quadratic.
    _string_lit: ($) => token(/"(\\\s+\\|\\\S|[^"\\])*"#*/),
  };
}

// The tickish prefix of a ticked expression, `<tickish> e`:
//
//   - token(prec(1)) wins the equal-length lex tie against $.variable, which
//     otherwise munches the `<..>`.
//
//   - The `break` form includes its free-var list `(v,..)`. As a separate atom,
//     that list takes the body slot, and a `case` or `let` body has no slot.
//
//   - An scc label can hold `>` (`scc<<?>>`), so the payload runs to the last
//     `>` before the space that GHC prints before the body.
export function makeTickRules() {
  return {
    tick_expr: ($) => seq($.tickish, $._expr),
    tickish: ($) =>
      token(
        prec(
          1,
          choice(/(src|scctick|tick|scc|hpc)<\S*>/, /break<[^>]*>(\([^)]*\))?/),
        ),
      ),
  };
}

// Qualified GHC names, each with an optional `pkg-ver:` and `Module.` prefix.
// A trailing `{..}` is a -dppr-debug tag (`f{v r1iT}`). No name touches a
// structural `{`, so the tag folds into the token.
//
// A variable also admits:
//
//   - `"..."` segments, where a HasField dfun glues a Symbol literal into the
//     name (`$fHasFieldSymbol"toFirstElemPtr"PtrPtr`).
//
//   - Trailing operator segments for method selectors (`$c==`) and operator
//     TyCons (`$tc:~:1`).
//
//   - A `.` in an operator run only beside a non-dot operator char, so the
//     dot in `forall a.` stays the separator.
//
// A constructor admits trailing `:Upper` segments for class dictionary cons
// (`C:Show`, `D:R:FInt`).
export function makeLexicalRules() {
  return {
    variable: ($) =>
      token(
        /([a-z][A-Za-z0-9.-]*:)?([A-Z][A-Za-z0-9_']*\.)*[a-z_$]([A-Za-z0-9_'$#]|"[^"]*")*([.]*[-+*/<>=~!&|^%$:?][-+*/<>=~!&|^%.$:?]*[A-Za-z0-9_'$#]*)*(\{[^}]*\})?/,
      ),
    constructor: ($) =>
      token(
        /([a-z][A-Za-z0-9.-]*:)?([A-Z][A-Za-z0-9_']*\.)*[A-Z][A-Za-z0-9_'#]*(:[A-Z][A-Za-z0-9_'#]*)*(\{[^}]*\})?/,
      ),
    // Two rules keep an operator apart from other tokens:
    //
    //   - `:` only follows the first char, because a leading `:` is a data con.
    //     So `>::` is one operator and a bare `::` stays the dcolon.
    //
    //   - A `=`-led operator needs a second symbol char (`==#`, `=<<`). A lone
    //     `=` is the binding separator. As a type atom, a lone `=` makes a
    //     signature eat the binding line under it.
    operator: ($) =>
      token(
        /([A-Z][A-Za-z0-9_']*\.)*([-+*/<>!&|^%.~?][-+*/<>=!&|^%.~?:]*|=[-+*/<>=!&|^%.~?:]+)#*(\{[^}]*\})?/,
      ),
    // The unboxed-sum con has `_` slots and `|` separators (`(# _| #)`). The
    // `|` keeps it apart from `()` and `(#,#)`. The nullary unboxed tuple prints
    // `(##)`, or `(# #)` in unarised STG.
    special_con: ($) =>
      token(
        /([A-Z][A-Za-z0-9_']*\.)*(\[\]|:|\(,+\)|\(#[ #]*#\)|\(#(,+)#\)|\(#[ _]*\|[ _|]*#\)|\(\))(\{[^}]*\})?/,
      ),
  };
}

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
    // A `(a :: k)` binder is a type_paren_form, which also covers the
    // -dppr-debug form `(a Nothing [tv] :: k)`.
    _forall_binder: ($) => choice($.tyvar, $.inferred_tyvar, $.type_paren_form),
    inferred_tyvar: ($) =>
      seq(
        "{",
        choice($.tyvar, $.type_paren_form),
        optional(seq($._dcolon, $._type)),
        "}",
      ),

    _dcolon: ($) => choice("::", "∷"),

    function_type: ($) => prec.right(seq($._type_btype, $._type_op, $._type)),
    _type_op: ($) =>
      choice("->", "→", "⊸", "=>", "⇒", "~R#", $.mult_arrow, $.type_operator),
    // A lone `=` is the binding separator, so a `=`-led operator needs a second
    // symbol char. Literal arrows win over this token by string precedence.
    type_operator: ($) =>
      token(
        choice(
          /([A-Z][A-Za-z0-9_']*\.)*([-+*/<>~!&|^%][-+*/<>=~!&|^%]*|=[-+*/<>=~!&|^%]+)#*(\{[^}]*\})?/,
          /:[-+*/<>=~!&|^%][-+*/<>=~!&|^%:]*(\{[^}]*\})?/,
        ),
      ),
    mult_arrow: ($) => seq("%", $._type_atom, choice("->", "→")),

    _type_btype: ($) => choice($.type_apply, $._type_atom),
    // A signature type keeps its trailing atom, so the next binding cannot take
    // it as its name. Both parses complete, so with no bias GLR picks one
    // unpredictably, and a linked parser can differ from the CLI. With no bias,
    // `table :: Map Int String` makes `String` a binding.
    //
    //   - Only `constructor` and `tyvar` can also be a `_def_name`, so only
    //     those get the prec.dynamic.
    //
    //   - They sit beside _type_atom_rest, which excludes them, so boosted and
    //     plain atoms do not overlap in an unresolved conflict.
    //
    //   - A trailing `[..]` stays unboosted, so an `[IdInfo]` after the type
    //     still reduces to idinfo.
    type_apply: ($) =>
      prec.left(
        seq(
          $._type_btype,
          choice(
            prec.dynamic(1, $.constructor),
            prec.dynamic(1, $.tyvar),
            $._type_atom_rest,
            $.kind_app,
          ),
        ),
      ),
    kind_app: ($) => seq("@", $._type_atom),

    _type_atom: ($) => choice($.constructor, $.tyvar, $._type_atom_rest),
    _type_atom_rest: ($) =>
      choice(
        $.special_con,
        $.operator,
        $._type_literal,
        $.type_list,
        $.type_paren_form,
        $.unboxed_type,
        $.promoted_type,
        $.star,
        $.ellipsis,
      ),
    star: ($) => choice("*", "★"),
    ellipsis: ($) => "...",

    // CorePrep and some debug dumps print a tyvar with a scope annotation,
    // `a_ahh[sk:1]`. The `:N` keeps the token off a list type `[a]`.
    tyvar: ($) => seq($.variable, optional($.scope_annotation)),
    scope_annotation: ($) => token(/\[[a-z]+:[0-9]+\]/),

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
