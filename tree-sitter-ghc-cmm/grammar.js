/**
 * @file Tree-sitter grammar for GHC Cmm dumps (e.g. `-ddump-cmm` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Models the native Cmm dump surface GHC prints (compiler/GHC/Cmm/Node.hs,
// Expr.hs, Ppr/). A -ddump-cmm pass prints EACH proc under its own repeated
// banner, so a standalone dump is `(banner group)*`; the container strips the
// banners and injects each `[..]` group body here, so banners are optional.
//
// Structure: a CmmGroup `[decl, ..]` of procs (`name() { info-table offset-body }`)
// and data sections (`section ".." { .. }`); offset bodies are labelled basic
// blocks of statements (assign / goto / if-else-goto / call / const). The
// expression sub-language has registers and local regs (`_c1::F64`), typed
// memory access (`I64[Sp - 8]`, `I64![R1]`), machop calls (`%MO_F_Add_W64(..)`),
// literals with a `:: width` ascription, and infix arithmetic/compare operators
// (single left-assoc precedence -- a dump parser need not mirror MachOp
// precedence). The info-table block is coarse balanced-delimiter soup (its
// HeapRep/srt metadata is leniency over structure). `//` line comments. Cmm
// statements/blocks are `;`/`{}`/`[]`/`:`-delimited, so no layout scanner is
// needed. Drives the harvested Cmm dumps to a clean parse. See README.md.

import { sepBy, sepBy1 } from "./common/grammar/combinators.mjs";
import { makeSoupRules } from "./common/grammar/soup.mjs";
import { banner } from "./common/grammar/haskell.mjs";

export default grammar({
  name: "ghc_cmm",

  extras: ($) => [/[ \t\r\n\f]/, $.comment],

  word: ($) => $.identifier,

  conflicts: ($) => [
    // A block label `name:` and an assignment lhs both start with an
    // identifier; the disambiguating `:` vs `=`/`::` is one token past it, so
    // GLR must explore both (continue this block's statements, or start the
    // next labelled block).
    [$.block],
    // After `label:` an info-table's soup may start with `(`, which also opens
    // a parenthesised assignment lhs; GLR explores both (only the soup
    // completes).
    [$.static_info],
  ],

  rules: {
    // The codegen surface is `[ decl, .. ]` CmmGroups; the per-stage pipeline
    // dumps (-ddump-cmm-sink/-sp/-switch/-cbe/-cfg, -ddump-opt-cmm,
    // -ddump-cmm-info) print bare, ungrouped: a lone `{offset ..}` graph, a bare
    // proc, or a bare `section ..`. Accept all four at top level.
    source_file: ($) =>
      repeat(choice($.banner, $.cmm_group, $._decl, $.offset_body)),

    // ==================== Output Cmm ==================== (shared)
    banner,

    // [ decl, decl, .. ] -- a CmmGroup of procs and data sections.
    cmm_group: ($) => seq("[", sepBy(",", $._decl), "]"),
    _decl: ($) => choice($.proc, $.data_section),

    // name() { info-table offset-body } -- a CmmProc (the `// [regs]` live-set
    // after `{` is a comment, an extra).
    proc: ($) =>
      seq(
        field("name", $.identifier),
        "(",
        ")",
        "{",
        $.info_table,
        $.offset_body,
        "}",
      ),

    // { info_tbls: [..] stack_info: .. } -- coarse balanced soup (metadata:
    // HeapRep/StackRep, srt, arg_space). Modelled like ghc-core's [IdInfo].
    info_table: ($) => seq("{", repeat($._soup), "}"),

    // Balanced bracket/brace/paren soup (shared with ghc-core/ghc-stg).
    ...makeSoupRules(),

    // {offset <block>* } -- the proc body, a sequence of labelled basic blocks.
    offset_body: ($) => seq("{offset", repeat($.block), "}"),
    block: ($) => seq($.label, repeat(choice($._statement, $.static_info))),
    label: ($) => seq(field("name", $.identifier), ":"),

    // Pre-codegen statics print an inline info-table after the closure label:
    // `label: X rep: HeapRep static { Con {..} } srt: Y CCS_DONT_CARE [..]`.
    // Coarse balanced soup (metadata), like the proc info-table.
    static_info: ($) => seq("label:", repeat($._soup)),

    // section ".." { <block>* } -- a CmmData section (the name carries nested
    // quotes, e.g. `""data" . M.f_closure"`, so it is taken as one token).
    data_section: ($) =>
      seq("section", field("name", $.section_name), "{", repeat($.block), "}"),
    section_name: ($) => token(/"[^\n]*"/),

    // ---- statements ----

    _statement: ($) =>
      choice(
        $.assignment,
        $.goto,
        $.cond_branch,
        $.call,
        $.const_statement,
        $.byte_array,
        $.switch,
        $.unwind,
      ),

    // unwind <reg> = (Just <expr> | Nothing) [, ..] ;  (CmmUnwind, from -g3) --
    // DWARF unwind notes attaching a virtual CFA/stack value to a register.
    unwind: ($) =>
      seq("unwind", sepBy1(",", seq($._expr, "=", $._unwind_val)), ";"),
    _unwind_val: ($) => choice("Nothing", seq("Just", $._expr)),

    // switch [lo .. hi] <expr> { case N : <body> default: <body> } (CmmSwitch,
    // pre-codegen). A case body is a statement or a `{ statement* }` block.
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

    // I8[] "Bindings" -- a static string / byte-array initialiser (CmmString)
    // in a "cstring" section; unlike other statements it carries no `;`.
    byte_array: ($) => seq($.cmm_type, "[", "]", $._string_lit),
    _string_lit: ($) => token(/"(\\.|[^"\\])*"/),

    // lhs = rhs ;  (CmmAssign / CmmStore). lhs is a register, local reg, or
    // memory access -- accepted as a general expression for leniency.
    assignment: ($) =>
      seq(field("lhs", $._expr), "=", field("rhs", $._expr), ";"),

    goto: ($) => seq("goto", field("target", $.identifier), ";"),

    // if (cond) (likely: B)? goto L; else goto L;  (CmmCondBranch).
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

    // call target(args) [returns to L,]? args: N, res: N, upd: N;  (CmmCall).
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
    _call_target: ($) => choice(seq("(", $._expr, ")"), $.identifier),
    returns_to: ($) => seq("returns", "to", field("target", $.identifier), ","),

    // const <expr> ;  -- a static data word in a section.
    const_statement: ($) => seq("const", $._expr, ";"),

    // ---- expressions ----

    _expr: ($) => choice($._atom, $.binary_expr, $.machop_call, $.typed_expr),

    // <expr> :: <width>  -- a literal/local-reg ascription; binds tighter than
    // the infix operators (a + 1.0 :: W64 is a + (1.0 :: W64)).
    typed_expr: ($) => prec(3, seq($._expr, "::", $.cmm_type)),

    // Single left-assoc precedence over all infix operators -- a dump parser
    // need not reproduce MachOp precedence; it only has to parse without error.
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

    // %MO_F_Add_W64(a, b) -- a machine-op (or %MO_FF_Conv_..) applied call.
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

    // Constructor info/closure CLabels, optionally module-qualified:
    // (,)_con_info, GHC.Types.[]_closure, GHC.Tuple.(,)_con_info. The tail is
    // required so this never shadows an empty group `[]`, empty parens, or a
    // `(args)` list.
    con_label: ($) =>
      token(
        choice(
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*\(,+\)[A-Za-z0-9_$.'#]+/,
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*\[\][A-Za-z0-9_$.'#]+/,
          // cons (:) constructor labels -- the tail (no space) keeps this off a
          // bare block-label `:` and the `::` ascription operator.
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*:[A-Za-z0-9_$.'#]+/,
        ),
      ),

    // I64[Sp - 8], P64[R1 + 15], I64![R1] (the `!` marks an aligned access).
    mem_access: ($) =>
      seq($.cmm_type, optional("!"), "[", field("address", $._expr), "]"),

    // Stack-area references: a bare placeholder `<highSp>`, or an area tagged
    // by a return label, `young<cR8>` (the prefix is glued; binops are spaced,
    // so this never swallows an `a < b` comparison).
    special: ($) => token(/([A-Za-z_][A-Za-z0-9_$]*)?<[^>\n]*>/),

    cmm_type: ($) => token(prec(1, /[IFWP][0-9]+/)),

    literal: ($) => choice($._int_lit, $._float_lit),
    _int_lit: ($) => token(/-?(0[xX][0-9a-fA-F]+|[0-9]+)/),
    _float_lit: ($) => token(/-?[0-9]+\.[0-9]+/),

    // Qualified Cmm names: registers (Sp, R1, D1), block labels (cQO, _lbl_),
    // and CLabels, which embed `#` from data-con worker names
    // (GHC.Types.I#_con_info, T24264.fun1_info, stg_gc_fun).
    identifier: ($) =>
      token(/[A-Za-z_$][A-Za-z0-9_$'#]*(\.[A-Za-z_$][A-Za-z0-9_$'#]*)*/),

    comment: ($) => token(seq("//", /[^\n]*/)),
  },
});
