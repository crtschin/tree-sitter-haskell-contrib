/**
 * @file Tree-sitter grammar for GHC Cmm dumps (e.g. `-ddump-cmm` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Models the Cmm dump surface that GHC prints (compiler/GHC/Cmm/Node.hs,
// Expr.hs, Ppr/). Banners are optional, because the ghc-dump container strips
// them before it injects each `[..]` group body.

import { sepBy, sepBy1 } from "./common/grammar/combinators.mjs";
import { makeSoupRules } from "./common/grammar/soup.mjs";
import { banner } from "./common/grammar/haskell.mjs";

export default grammar({
  name: "ghc_cmm",

  extras: ($) => [/[ \t\r\n\f]/, $.comment],

  word: ($) => $.identifier,

  conflicts: ($) => [
    // A block label `name:` and an assignment lhs both open on an identifier.
    // The `:` or `=` after it decides.
    [$.block],
    // After `label:`, a `(` can open info-table soup or an assignment lhs. Only
    // the soup completes.
    [$.static_info],
    // An empty `[]` can open either. Both readings are correct.
    [$.cmm_group, $.caf_env],
  ],

  rules: {
    // Codegen prints `[ decl, .. ]` groups. The per-stage pipeline dumps
    // (-ddump-cmm-sink and similar) print a bare proc, section, or
    // `{offset ..}` graph, and -ddump-cmm-caf prints a CAFEnv.
    source_file: ($) =>
      repeat(choice($.banner, $.cmm_group, $._decl, $.offset_body, $.caf_env)),

    banner,

    cmm_group: ($) => seq("[", sepBy(",", $._decl), "]"),
    _decl: ($) => choice($.proc, $.data_section),

    // -ddump-cmm-caf prints the CAF set that each block reaches, as
    // `(label, {closure, ..})` pairs.
    caf_env: ($) => seq("[", sepBy(",", $.caf_entry), "]"),
    caf_entry: ($) =>
      seq("(", field("label", $.identifier), ",", $.caf_set, ")"),
    caf_set: ($) =>
      seq("{", sepBy(",", choice($.con_label, $.identifier)), "}"),

    // The `// [regs]` live set after `{` lexes as a comment.
    proc: ($) =>
      seq(
        // Operator methods and dictionary constructors have CLabel names, e.g.
        // `Classes.$fEqColour_$c/=_entry` and `Families.C:Container_entry`.
        field("name", choice($.con_label, $.identifier)),
        "(",
        ")",
        "{",
        $.info_table,
        $.offset_body,
        "}",
      ),

    info_table: ($) => seq("{", repeat($._soup), "}"),

    ...makeSoupRules(),

    offset_body: ($) => seq("{offset", repeat($.block), "}"),
    block: ($) => seq($.label, repeat(choice($._statement, $.static_info))),
    label: ($) => seq(field("name", choice($.con_label, $.identifier)), ":"),

    // Pre-codegen statics print an inline info table after the closure label,
    // e.g. `label: X rep: HeapRep static { .. } srt: Y CCS_DONT_CARE [..]`.
    static_info: ($) => seq("label:", repeat($._soup)),

    // The name nests quotes, e.g. `""data" . M.f_closure"`, so the token runs
    // to the last quote on the line.
    data_section: ($) =>
      seq("section", field("name", $.section_name), "{", repeat($.block), "}"),
    section_name: ($) => token(/"[^\n]*"/),

    _statement: ($) =>
      choice(
        $.assignment,
        $.goto,
        $.cond_branch,
        $.call,
        $.foreign_call_statement,
        $.const_statement,
        $.byte_array,
        $.switch,
        $.unwind,
      ),

    // The high-level foreign call that the passes before lowering print. The
    // callee args print as a literal `(...)`, and the `args:` and `ress:` lists
    // hold the real registers.
    foreign_call_statement: ($) =>
      seq(
        "foreign",
        "call",
        optional($.call_convention),
        optional($.call_hints),
        field("target", $._call_target),
        $._fc_args_placeholder,
        optional(seq("returns", "to", field("returns_to", $.identifier))),
        "args:",
        $._fc_reg_list,
        "ress:",
        $._fc_reg_list,
        "ret_args:",
        $._int_lit,
        "ret_off:",
        $._int_lit,
        ";",
      ),
    _fc_args_placeholder: ($) => token(/\(\.\.\.\)/),
    _fc_reg_list: ($) => seq("(", "[", sepBy(",", $._expr), "]", ")"),

    unwind: ($) =>
      seq("unwind", sepBy1(",", seq($._expr, "=", $._unwind_val)), ";"),
    _unwind_val: ($) => choice("Nothing", seq("Just", $._expr)),

    switch: ($) =>
      seq(
        "switch",
        "[",
        field("low", $._int_lit),
        "..",
        field("high", $._int_lit),
        "]",
        field("scrutinee", $._expr),
        "{",
        repeat($.switch_case),
        "}",
      ),
    switch_case: ($) =>
      seq(
        choice(seq("case", $._int_lit), "default"),
        ":",
        choice($._statement, seq("{", repeat($._statement), "}")),
      ),

    byte_array: ($) => seq($.cmm_type, "[", "]", $._string_lit),
    _string_lit: ($) => token(/"(\\.|[^"\\])*"/),

    // The rhs can be a foreign call, e.g.
    // `(_c1::F64) = call "ccall" .. sqrt(..)`. A foreign call has no
    // `args:/res:/upd:` trailer. It stays out of `_expr`, so that a bare `call`
    // statement is unambiguous.
    assignment: ($) =>
      seq(
        field("lhs", $._expr),
        "=",
        field("rhs", choice($._expr, $.foreign_call)),
        ";",
      ),

    foreign_call: ($) =>
      seq(
        "call",
        optional($.call_convention),
        optional($.call_hints),
        field("target", $._call_target),
        "(",
        sepBy(",", $._expr),
        ")",
      ),
    call_convention: ($) => token(/"[a-z]+"/),
    // A long hint list wraps across lines.
    call_hints: ($) =>
      token(/arg hints:\s*\[[^\]]*\]\s*result hints:\s*\[[^\]]*\]/),

    goto: ($) => seq("goto", field("target", $.identifier), ";"),

    cond_branch: ($) =>
      seq(
        "if",
        "(",
        field("condition", $._expr),
        ")",
        optional($.likely),
        "goto",
        field("consequence", $.identifier),
        ";",
        "else",
        "goto",
        field("alternative", $.identifier),
        ";",
      ),
    likely: ($) => seq("(", "likely:", choice("True", "False"), ")"),

    call: ($) =>
      seq(
        "call",
        field("target", $._call_target),
        "(",
        sepBy(",", $._expr),
        ")",
        optional($.returns_to),
        "args:",
        $._int_lit,
        ",",
        "res:",
        $._int_lit,
        ",",
        "upd:",
        $._int_lit,
        ";",
      ),
    _call_target: ($) => choice($.indirect_target, $.con_label, $.identifier),
    // A computed address, e.g. `call (I64[Sp])(...)`. It is a named node, so
    // that the `target` field holds one node in every call form.
    indirect_target: ($) => seq("(", $._expr, ")"),
    returns_to: ($) => seq("returns", "to", field("target", $.identifier), ","),

    const_statement: ($) => seq("const", $._expr, ";"),

    _expr: ($) => choice($._atom, $.binary_expr, $.machop_call, $.typed_expr),

    // Binds tighter than the infix operators, so `a + 1.0 :: W64` parses as
    // `a + (1.0 :: W64)`.
    typed_expr: ($) => prec(3, seq($._expr, "::", $.cmm_type)),

    // All operators share one left-assoc level, because a dump parse only has
    // to succeed.
    binary_expr: ($) => prec.left(1, seq($._expr, $.binop, $._expr)),
    binop: ($) =>
      choice(
        "+",
        "-",
        "*",
        "/",
        "&",
        "|",
        "^",
        "<<",
        ">>",
        "==",
        "!=",
        "<=",
        ">=",
        "<",
        ">",
      ),

    machop_call: ($) => seq($.machop, "(", sepBy(",", $._expr), ")"),
    machop: ($) => token(/%[A-Za-z_][A-Za-z0-9_]*/),

    _atom: ($) =>
      choice(
        $.mem_access,
        $.literal,
        $.special,
        $.con_label,
        $.parens,
        $.identifier,
      ),
    parens: ($) => seq("(", $._expr, ")"),

    // Constructor CLabels, e.g. `(,)_con_info` and `GHC.Types.[]_closure`. Each
    // alternative needs a tail, so that the token never takes an empty `[]`, an
    // empty `()`, or an `(args)` list.
    con_label: ($) =>
      token(
        choice(
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*\(,+\)[A-Za-z0-9_$.'#]+/,
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*\[\][A-Za-z0-9_$.'#]+/,
          // `:`-led cons, e.g. `:_con_info` and `:*:_con_info`. The first tail
          // char is not `:`, so the `::` ascription stays a separate token.
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*:[-+*/<>=~&|^%.A-Za-z0-9_$'#][-+*/<>=~&|^%.:A-Za-z0-9_$'#]*/,
          // Labels with `:Upper` segments, e.g. `C:Eq_con_info`,
          // `main:Ffi_init__fexports` and `$tc'C:Collection3_bytes`. The `:`
          // must touch an uppercase letter, so a block label `foo:` and `::`
          // stay out.
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*[A-Za-z_$][A-Za-z0-9_$']*(:[A-Z][A-Za-z0-9_$']*)+[A-Za-z0-9_$.'#]*/,
          // Method labels with an operator name, e.g. `$fNumInt_$c*_info`. A
          // letter or `_` must follow the operator run, so `label+2` still
          // splits into a `+` binop. `.` only separates module qualifiers, so
          // a plain `Mod.name` does not match.
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*[A-Za-z_$][A-Za-z0-9_$'#]*([-+*/<>=~&|^%]+[A-Za-z_$#][A-Za-z0-9_$'#]*)+[A-Za-z0-9_$.'#]*/,
          // Operator-led method labels, e.g. `GHC.Internal.Num.*_info`, or a
          // bare `*_info` after -dsuppress-all. The required name char after
          // the operators keeps a spaced `a * b` out.
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*[-+*/<>=~&|^%]+[A-Za-z_$#][A-Za-z0-9_$'#]*[A-Za-z0-9_$.'#]*/,
        ),
      ),

    mem_access: ($) =>
      seq($.cmm_type, optional("!"), "[", field("address", $._expr), "]"),

    // Stack areas, e.g. `<highSp>` and `young<cR8>`. The prefix touches the `<`
    // and binops have spaces, so `a < b` stays a comparison.
    special: ($) => token(/([A-Za-z_][A-Za-z0-9_$]*)?<[^>\n]*>/),

    cmm_type: ($) => token(prec(1, /[IFWP][0-9]+/)),

    literal: ($) => choice($._int_lit, $._float_lit),
    _int_lit: ($) => token(/-?(0[xX][0-9a-fA-F]+|[0-9]+)/),
    _float_lit: ($) => token(/-?[0-9]+\.[0-9]+/),

    // Registers, block labels, and CLabels. A CLabel can hold `#`, e.g.
    // `GHC.Types.I#_con_info`.
    identifier: ($) =>
      token(/[A-Za-z_$][A-Za-z0-9_$'#]*(\.[A-Za-z_$][A-Za-z0-9_$'#]*)*/),

    comment: ($) => token(seq("//", /[^\n]*/)),
  },
});
