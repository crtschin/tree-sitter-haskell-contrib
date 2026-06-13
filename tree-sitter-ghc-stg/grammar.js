/**
 * @file Tree-sitter grammar for GHC STG dumps (e.g. `-ddump-stg-final` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import { sepBy } from "./common/grammar/combinators.mjs";
import { makeSoupRules } from "./common/grammar/soup.mjs";
import {
  banner,
  makeLexicalRules,
  makeLiteralRules,
  makeTypeRules,
} from "./common/grammar/haskell.mjs";

// Models the STG surface GHC's printer emits (compiler/GHC/Stg/Syntax.hs
// pprStgExpr/pprStgRhs/pprGenStgBinding). Unlike Core, every STG binding --
// top-level, Rec pair, and let -- ends with `;` (pprStgRhs <> semi), so the
// semicolon self-delimits each binding and blank lines are ordinary whitespace.
// That means STG needs no external layout scanner (cf. ghc-core's _item_sep).
//
// Coverage: phase banner, bindings (sig + [IdInfo], or tag-inference
// (name, <Tag..>) binders), Rec groups, closures (cost-centre? free-vars?
// \r/\u/\s/\j update flag, [args], body), saturated constructors (StgRhsCon's
// Con! [args]), top-level string literals, the expression grammar (StgApp,
// StgConApp/StgOpApp's bracketed args, let/let-no-escape, case + alternatives),
// the System FC type grammar (shared surface with Core), qualified names, and
// literals. The [IdInfo] bracket is coarse balanced-delimiter soup -- leniency
// over structure. Drives the harvested STG dumps to a clean parse. See README.md.

export default grammar({
  name: "ghc_stg",

  extras: ($) => [/[ \t\r\n\f]/, $.comment],

  word: ($) => $.variable,

  conflicts: ($) => [
    // After a signature's type, the next atom is either a type-application
    // argument or the IdInfo bracket / `=`; let GLR explore (cf. ghc-core).
    [$._type, $.type_apply],
  ],

  rules: {
    source_file: ($) => seq(optional($.banner), repeat($._group)),

    _group: ($) => choice($.binding, $.rec_block),

    // ==================== Final STG: ==================== (shared)
    banner,

    // Rec { b1; b2; end Rec } -- a recursive group; pairs are blank-line
    // separated and each `;`-terminated like every STG binding.
    rec_block: ($) => seq("Rec", "{", repeat1($.binding), "end", "Rec", "}"),

    // name [InlPrag]? (:: ty)? [IdInfo]? = rhs ;   or   (name, <tag>) = rhs ;
    binding: ($) =>
      seq(
        choice($._binder_lhs, $.tagged_binder),
        "=",
        field("rhs", $._rhs),
        ";",
      ),

    // An untagged binder. The signature is suppressed in some dumps (Final STG
    // often prints bare `name = rhs`); when present the optional pre-`::` bracket
    // is an [InlPrag=..]/[Occ=..] note and a trailing bracket is the IdInfo. The
    // bound Id can be upper-led (data-con worker/wrapper names like MkW_F), which
    // lexes as a constructor, so accept either.
    _binder_lhs: ($) =>
      seq(
        field("name", choice($.variable, $.constructor)),
        optional(
          seq(optional($.binder_annotation), "::", field("type", $._type)),
        ),
        optional($.idinfo),
      ),

    // Tag-inference passes (CodeGenAnal, post-unarise) print binders as
    // (name, <Tag..>); these carry no signature or IdInfo. The name can be an
    // upper-led worker/wrapper Id (T24806.Tup2), which lexes as a constructor.
    tagged_binder: ($) =>
      seq(
        "(",
        field("name", choice($.variable, $.constructor)),
        ",",
        $.tag,
        ")",
      ),
    tag: ($) => token(/<Tag[^>]*>/),

    // The [IdInfo] bracket and pre-sig [InlPrag/Occ] note, both coarse balanced
    // soup for now (the same leniency ghc-core takes over IdInfo structure).
    idinfo: ($) => prec.dynamic(1, seq("[", repeat($._soup), "]")),
    binder_annotation: ($) => prec.dynamic(1, seq("[", repeat($._soup), "]")),

    ...makeSoupRules(),

    // A binding's RHS: a closure (StgRhsClosure), a saturated constructor
    // (StgRhsCon, marked by `!`), or a top-level string literal ("..."#).
    _rhs: ($) => choice($.closure, $.con_app_rhs, $.literal),

    // cc? fvs? \upd [args] body. The free-var brace and cost-centre are
    // suppressed in some passes; the body is one STG expression.
    closure: ($) =>
      seq(
        optional($.cost_centre),
        optional($.free_vars),
        $.update_flag,
        $.arg_list,
        field("body", $._expr),
      ),
    // \r ReEntrant | \u Updatable | \s SingleEntry | \j JumpedTo (join point).
    update_flag: ($) => token(/\\[rusj]/),
    // The free-var set prints comma-separated ({a1, f}, a DVarSet); the lambda
    // arg list prints space-separated ([x y void], interppSP).
    free_vars: ($) => seq("{", sepBy(",", $._bndr), "}"),
    arg_list: ($) => seq("[", repeat($._bndr), "]"),
    // A bound occurrence: a plain Id, a tag-annotated (name, <Tag>) binder, or
    // an occurrence-annotated `x [Occ=Once1]` binder (seen on case-alt patterns).
    _bndr: ($) => choice($.variable, $.tagged_binder, $.annotated_binder),
    annotated_binder: ($) => seq($.variable, $.binder_annotation),

    cost_centre: ($) => "NO_CCS",

    // Con! [args] -- StgRhsCon's bang distinguishes it from an StgConApp.
    con_app_rhs: ($) =>
      seq(
        optional($.cost_centre),
        choice($.constructor, $.special_con),
        "!",
        $.stg_arg_list,
      ),

    stg_arg_list: ($) => seq("[", repeat($._stg_arg), "]"),
    _stg_arg: ($) =>
      choice($.variable, $.literal, $.constructor, $.special_con),

    // ---- expressions (compiler/GHC/Stg/Syntax.hs pprStgExpr) ----

    _expr: ($) =>
      choice(
        $.app,
        $.con_or_op_app,
        $.let,
        $.let_no_escape,
        $.case,
        $._stg_atom,
      ),

    // StgApp: f a b -- a function variable applied to space-separated atoms.
    app: ($) => prec.left(seq($.variable, repeat1($._stg_arg))),

    // StgConApp / StgOpApp: Con [args] / (+#) [args] -- the args are bracketed.
    con_or_op_app: ($) =>
      seq(
        choice($.constructor, $.special_con, $.variable, $.operator),
        $.stg_arg_list,
      ),

    // A let binds one StgBinding -- either a single binding or a `Rec {..}`
    // group (let-no-escape bodies commonly wrap a recursive join-point group).
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

    // The case binder is omitted when dead (`case x of { .. }`), present
    // otherwise (`case x of wild { .. }`).
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
      choice("__DEFAULT", $.literal, $.constructor, $.special_con),

    _stg_atom: ($) =>
      choice($.variable, $.literal, $.constructor, $.special_con),

    // Literals, the System-FC type grammar, and qualified-name lexical tokens
    // are shared with ghc-core (common/grammar/haskell.mjs).
    ...makeLiteralRules(),
    ...makeTypeRules(),
    ...makeLexicalRules(),

    comment: ($) => token(seq("--", /[^\n]*/)),
  },
});
