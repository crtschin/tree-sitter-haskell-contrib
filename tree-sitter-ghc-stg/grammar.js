/**
 * @file Tree-sitter grammar for GHC STG dumps (e.g. `-ddump-stg-final` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import { sepBy } from "./common/grammar/combinators.mjs";
import { makeSoupRules, soupBracket } from "./common/grammar/soup.mjs";
import {
  banner,
  makeLexicalRules,
  makeLiteralRules,
  makeTickRules,
  makeTypeRules,
} from "./common/grammar/haskell.mjs";

// Models the STG surface that GHC prints (compiler/GHC/Stg/Syntax.hs). Every
// binding ends with `;`, so blank lines are ordinary whitespace and the grammar
// needs no layout scanner.

export default grammar({
  name: "ghc_stg",

  extras: ($) => [/[ \t\r\n\f]/, $.comment],

  word: ($) => $.variable,

  conflicts: ($) => [
    // After a signature's type, the next atom can extend the type or start the
    // IdInfo bracket.
    [$._type, $.type_apply],
  ],

  rules: {
    source_file: ($) => seq(optional($.banner), repeat($._group)),

    _group: ($) => choice($.binding, $.rec_block),

    banner,

    rec_block: ($) => seq("Rec", "{", repeat1($.binding), "end", "Rec", "}"),

    binding: ($) =>
      seq(
        choice($._binder_lhs, $.tagged_binder),
        "=",
        field("rhs", $._rhs),
        ";",
      ),

    // The bound Id can be upper-led, e.g. the data-con worker `MkW_F`.
    _binder_lhs: ($) =>
      seq(
        field("name", choice($.variable, $.constructor, $.entry_name)),
        optional(
          seq(
            optional($.binder_annotation),
            choice("::", "∷"),
            field("type", $._type),
          ),
        ),
        optional($.idinfo),
      ),

    // The synthesized program entry prints as `:Main.main`, which otherwise
    // lexes as `special_con` then `variable`.
    entry_name: (_) =>
      token(/:([A-Z][A-Za-z0-9_']*\.)+[A-Za-z_][A-Za-z0-9_'#]*/),

    tagged_binder: ($) =>
      seq(
        "(",
        field("name", choice($.variable, $.constructor)),
        ",",
        $.tag,
        ")",
      ),
    tag: ($) => token(/<Tag[^>]*>/),

    // An occurrence with its inferred tag, e.g. `wild<TagVal[TagEPT]>`. The
    // variable lexer accepts `<` and `>` in names such as `$c<*>`, and it
    // cannot tell them from `<Tag` without lookahead. One token for the whole
    // occurrence prevents the wrong split.
    tagged_occurrence: ($) =>
      token(
        /([a-z][A-Za-z0-9.-]*:)?([A-Z][A-Za-z0-9_']*\.)*[a-z_$]([A-Za-z0-9_'$#]|"[^"]*")*<Tag[^>]*>/,
      ),

    idinfo: soupBracket,
    binder_annotation: soupBracket,

    ...makeSoupRules(),

    _rhs: ($) => choice($.closure, $.con_app_rhs, $.literal),

    closure: ($) =>
      seq(
        optional($.cost_centre),
        optional($.free_vars),
        $.update_flag,
        $.arg_list,
        field("body", $._expr),
      ),
    update_flag: ($) => token(/\\[rusj]/),
    free_vars: ($) => seq("{", sepBy(",", $._bndr), "}"),
    arg_list: ($) => seq("[", repeat($._bndr), "]"),
    _bndr: ($) => choice($.variable, $.tagged_binder, $.annotated_binder),
    annotated_binder: ($) => seq($.variable, $.binder_annotation),

    cost_centre: ($) => "NO_CCS",

    con_app_rhs: ($) =>
      seq(
        optional($.cost_centre),
        choice($.constructor, $.special_con, $.con_operator),
        "!",
        $.stg_arg_list,
      ),

    stg_arg_list: ($) => seq("[", repeat($._stg_arg), "]"),
    _stg_arg: ($) =>
      choice(
        $.variable,
        $.literal,
        $.constructor,
        $.special_con,
        $.con_operator,
      ),

    _expr: ($) =>
      choice(
        $.app,
        $.con_or_op_app,
        $.foreign_call,
        $.let,
        $.let_no_escape,
        $.case,
        $.tick_expr,
        $._stg_atom,
      ),

    // The head can be an operator-named method, e.g.
    // `GHC.Internal.Num.* d a b`.
    app: ($) =>
      prec.left(seq(choice($.variable, $.operator), repeat1($._stg_arg))),

    con_or_op_app: ($) =>
      seq(
        choice(
          $.constructor,
          $.special_con,
          $.con_operator,
          $.variable,
          $.operator,
        ),
        $.stg_arg_list,
      ),

    // Prints as `__ffi_static_ccall_<safety> pkg:sym :: [args]`. Core wraps the
    // same call in `{}` and adds a result type, so the ghc-core rule does not
    // fit.
    foreign_call: ($) =>
      seq(
        $._ffi_keyword,
        field("target", choice($.variable, $.constructor)),
        $._dcolon,
        $.stg_arg_list,
      ),
    _ffi_keyword: ($) => token(/__ffi_[a-z_]+/),

    let: ($) =>
      seq("let", "{", repeat1($._group), "}", "in", field("body", $._expr)),
    let_no_escape: ($) =>
      seq(
        "let-no-escape",
        "{",
        repeat1($._group),
        "}",
        "in",
        field("body", $._expr),
      ),

    case: ($) =>
      seq(
        "case",
        field("scrutinee", $._expr),
        "of",
        field("binder", optional($._bndr)),
        "{",
        repeat($.alternative),
        "}",
      ),

    alternative: ($) =>
      seq(
        field("pattern", $._alt_con),
        repeat($._bndr),
        "->",
        field("rhs", $._expr),
        ";",
      ),
    _alt_con: ($) =>
      choice(
        "__DEFAULT",
        $.literal,
        $.constructor,
        $.special_con,
        $.con_operator,
      ),

    _stg_atom: ($) =>
      choice(
        $.variable,
        $.tagged_occurrence,
        $.literal,
        $.constructor,
        $.special_con,
        $.con_operator,
      ),

    // `:`-led constructor operators, e.g. `:|` and `:*:`. The second char is
    // not `:`, so `::` stays out. The set excludes `!`, because `:*:! [args]`
    // must split into the constructor and `!`.
    con_operator: ($) =>
      token(
        /([A-Z][A-Za-z0-9_']*\.)*:[-+*/<>=~&|^%.][-+*/<>=~&|^%.:]*(\{[^}]*\})?/,
      ),

    ...makeLiteralRules(),
    ...makeTickRules(),
    ...makeTypeRules(),
    ...makeLexicalRules(),

    comment: ($) => token(seq("--", /[^\n]*/)),
  },
});
