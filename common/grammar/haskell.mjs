/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Surface shared by the GHC Core and STG grammars: the System-FC type grammar
// (compiler/GHC/Iface/Type.hs), the qualified-name and literal tokens, and the phase
// banner. Spread the makeXRules() results into a grammar's `rules` after its own
// `source_file` (which must stay the start rule). makeTypeRules needs makeLexicalRules:
// the type rules reference $.variable/constructor/special_con/operator.

import { sepBy } from "./combinators.mjs";

// GHC prints a phase banner around every dump, `==================== <phase>
// ====================`, shared by all four grammars.
//
//   - The middle must hold a non-`=` char (the space-padded title), so an
//     all-`=` divider line in a dump body is not a banner.
//
//   - A wide pass description wraps its parenthesised record across lines
//     (GHC 9.12+ prints `Float out(FOS {..})` over several). The second alt
//     absorbs those newlines inside the `(..)`, bounded by the first `)` so it
//     cannot span unrelated banners.
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

// Integer / float / char / string literals (Core and STG print these the same).
export function makeLiteralRules() {
  return {
    literal: ($) =>
      choice($._int_lit, $._float_lit, $._char_lit, $._string_lit),

    // Unboxed numeric literals carry `#`/`##` (Int#/Word#) and, in some dumps, a
    // glued type tag (`0#Word64`, `97#Word8`, `0#Int64`). The tag only follows a
    // `#`, so a bare `0` never absorbs a trailing word.
    _int_lit: ($) => token(/-?[0-9]+(#+[A-Za-z][A-Za-z0-9_]*|#*)/),
    _float_lit: ($) => token(/-?[0-9]+\.[0-9]+(#+[A-Za-z][A-Za-z0-9_]*|#*)/),
    // A char escape may be multi-char: numeric (`'\2048'`, `'\65536'`) or named
    // (`'\NUL'`). `\\.` takes the backslash + first escape char (covers `'\''`,
    // `'\n'`, `'\\'`), then `[^']*` absorbs the rest up to the closing quote.
    _char_lit: ($) => token(/'(\\.[^']*|[^'\\])'#*/),
    // A backslash escapes any char, including a newline. GHC also prints long
    // strings with a string gap `\ <whitespace> \` (`..\n\` <newline> `   \..`),
    // which the regex must not misread:
    //
    //   - The resume `\` must not pair with the following escape. `\\"` is a
    //     gap-resume then an escaped quote, not an escaped backslash then a
    //     terminating quote that would end the string early.
    //
    //   - So the gap `\\\s+\\` is its own longest-match alternative, ahead of
    //     the `\\[\s\S]` escape and the `[^"\\]` char.
    _string_lit: ($) => token(/"(\\\s+\\|\\[\s\S]|[^"\\])*"#*/),
  };
}

// Tickish prefix on a ticked expression, `<tickish> e`. Core and STG share
// GHC's GenTickish printer (compiler/GHC/Core/Ppr.hs). Six forms:
//
//   src<span>  scc<cc>  tick<cc>  scctick<cc>  hpc<mod,ix>  break<mod,ix>(vars)
//
// Lexing subtleties:
//
//   - token(prec(1)) makes a keyword-led `<..>` win the equal-length lex tie
//     against $.variable, whose operator-suffix class would else munch it.
//
//   - The `break` form folds in its glued free-var list `(v,..)`. Left as a
//     trailing atom it fills the body slot, so a non-atom body (`case`/`let`)
//     has nowhere to go.
//
//   - The scc label may be an operator holding `>` (`scc<<?>>`), so the payload
//     takes any non-whitespace run, ending at the last `>` before the space
//     GHC always prints before the body.
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

// Qualified GHC names. Each may carry an optional `pkg-ver:` package qualifier
// and a `Module.Sub.` qualifier.
//
//   - variable: a lower/underscore/$-led name (`#` may appear, for unboxed
//     workers). Its body also admits:
//       - Embedded `"..."` segments, where a HasField/HasCField dfun glues its
//         type-level Symbol literal into the Id name
//         (`$fHasFieldSymbol"toFirstElemPtr"PtrPtr`, `$fHasCFieldCTm"tm_sec"1`).
//       - Trailing operator/colon segments for method selectors (`$c==`,
//         `$c<$`, `$c.&.`) and operator-TyCon names (`$tc:~:1`).
//       - A `.` in an operator run only beside a non-dot op char, so a
//         `forall a.` dot stays the forall separator, not munched into `a.`.
//
//   - constructor: upper-led, with trailing `:Upper` segments for
//     class-dictionary cons (C:C, C:Show, D:R:FInt).
//
//   - operator: symbolic primops/ops in prefix position (+#, ==#, (.), (.&.)).
//
//   - special_con: built-in/parenthesised cons ([] : (,) (##) (#,#) ()).
//
// A trailing `{..}` is a -dppr-debug tag glued to the name (`f{v r1iT}`,
// `Int{(w) tc 32}`). A name is never glued to a structural `{`, so folding the
// tag into the token is safe and keeps the tree flat.
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
    // A symbolic operator. Two placement rules keep it distinct from the
    // data-con operator and the binding separator:
    //
    //   - `:` is allowed only after the first char (a leading `:` is a data
    //     constructor, see con_operator), so `>::`, `|>:` lex as one operator
    //     while a bare `::` stays the dcolon.
    //
    //   - A lone `=` is the binding separator, never an operator (mirrors
    //     type_operator). Without it a `=` lexes as a type atom and a
    //     signature's type over-munches the binding line below. A `=`-led op
    //     (==#, =<<) keeps a second symbol char.
    operator: ($) =>
      token(
        /([A-Z][A-Za-z0-9_']*\.)*([-+*/<>!&|^%.~?][-+*/<>=!&|^%.~?:]*|=[-+*/<>=!&|^%.~?:]+)#*(\{[^}]*\})?/,
      ),
    // Built-in and parenthesised cons. Two variants need care:
    //
    //   - The unboxed-sum injection con carries `_` slot markers and `|`
    //     separators (`(# _| #)`, `(# |_ #)`, `(# _|| #)`). The `|` keeps it off
    //     the unit `()` and the tuple con `(#,#)`.
    //
    //   - The nullary unboxed tuple prints `(##)`, or a spaced `(# #)` in
    //     unarised STG, both matched by `\(#[ #]*#\)`.
    //
    // Spaces inside are part of the token.
    special_con: ($) =>
      token(
        /([A-Z][A-Za-z0-9_']*\.)*(\[\]|:|\(,+\)|\(#[ #]*#\)|\(#(,+)#\)|\(#[ _]*\|[ _|]*#\)|\(\))(\{[^}]*\})?/,
      ),
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
    // A `(a :: k)` binder is a type_paren_form. -dppr-debug decorates it with
    // junk before the kind, `(a Nothing [tv] :: k)`, which is one too.
    _forall_binder: ($) => choice($.tyvar, $.inferred_tyvar, $.type_paren_form),
    inferred_tyvar: ($) =>
      seq(
        "{",
        choice($.tyvar, $.type_paren_form),
        optional(seq($._dcolon, $._type)),
        "}",
      ),

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
          /([A-Z][A-Za-z0-9_']*\.)*([-+*/<>~!&|^%][-+*/<>=~!&|^%]*|=[-+*/<>=~!&|^%]+)#*(\{[^}]*\})?/,
          /:[-+*/<>=~!&|^%][-+*/<>=~!&|^%:]*(\{[^}]*\})?/,
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
    // `*` is the lifted-type kind, printed `★` under -fprint-unicode-syntax.
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
