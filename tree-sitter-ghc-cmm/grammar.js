/**
 * @file Tree-sitter grammar for GHC Cmm dumps (e.g. `-ddump-cmm` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Models the native Cmm dump surface GHC prints (compiler/GHC/Cmm/Node.hs, Expr.hs,
// Ppr/). A -ddump-cmm pass prints EACH proc under its own repeated banner, and the
// container strips those banners to inject each `[..]` group body here, so banners are
// optional. The per-stage pipeline passes (-ddump-cmm-sink and similar) print ungrouped,
// so source_file also accepts a bare proc, data section, or `{offset ..}` graph.
//
// The info-table block is coarse balanced-delimiter soup (HeapRep/srt metadata, a leniency
// over structure). Infix operators use one left-assoc precedence, since a dump parser need
// not mirror MachOp precedence. Cmm is `;`/`{}`/`[]`/`:`-delimited, so no layout scanner is
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
    // identifier. The disambiguating token (`:` for a label, `=`/`::` for an
    // assignment) is one token past it, so GLR must explore both (continue this
    // block's statements, or start the next labelled block).
    [$.block],
    // After `label:` an info-table's soup may start with `(`, which also opens
    // a parenthesised assignment lhs. GLR explores both (only the soup
    // completes).
    [$.static_info],
    // An empty `[]` could open a CmmGroup or a CAFEnv. Either reading is fine.
    [$.cmm_group, $.caf_env],
  ],

  rules: {
    // The codegen surface is `[ decl, .. ]` CmmGroups. The per-stage pipeline
    // dumps (-ddump-cmm-sink/-sp/-switch/-cbe/-cfg, -ddump-opt-cmm,
    // -ddump-cmm-info) print bare, ungrouped: a lone `{offset ..}` graph, a bare
    // proc, or a bare `section ..`. -ddump-cmm-caf prints a CAFEnv instead.
    source_file: ($) =>
      repeat(choice($.banner, $.cmm_group, $._decl, $.offset_body, $.caf_env)),

    // ==================== Output Cmm ==================== (shared)
    banner,

    // [ decl, decl, .. ] is a CmmGroup of procs and data sections.
    cmm_group: ($) => seq("[", sepBy(",", $._decl), "]"),
    _decl: ($) => choice($.proc, $.data_section),

    // -ddump-cmm-caf prints a CAF analysis, not Cmm code: a list of
    // (block-label, {closure, ..}) pairs, the CAF set reachable from each block.
    caf_env: ($) => seq("[", sepBy(",", $.caf_entry), "]"),
    caf_entry: ($) =>
      seq("(", field("label", $.identifier), ",", $.caf_set, ")"),
    // A reachable closure may be a CLabel (Classes.$fEqColour_$c/=_closure), not
    // just a plain block-closure identifier.
    caf_set: ($) =>
      seq("{", sepBy(",", choice($.con_label, $.identifier)), "}"),

    // name() { info-table offset-body } is a CmmProc. The `// [regs]` live-set
    // after `{` is a comment (an extra).
    proc: ($) =>
      seq(
        // A proc for an operator-named method or a dictionary constructor has a
        // CLabel name (Classes.$fEqColour_$c/=_entry, Families.C:Container_entry).
        field("name", choice($.con_label, $.identifier)),
        "(",
        ")",
        "{",
        $.info_table,
        $.offset_body,
        "}",
      ),

    // { info_tbls: [..] stack_info: .. } is coarse balanced soup (metadata:
    // HeapRep/StackRep, srt, arg_space). Modelled like ghc-core's [IdInfo].
    info_table: ($) => seq("{", repeat($._soup), "}"),

    // Balanced bracket/brace/paren soup (shared with ghc-core/ghc-stg).
    ...makeSoupRules(),

    // {offset <block>* } is the proc body, a sequence of labelled basic blocks.
    offset_body: ($) => seq("{offset", repeat($.block), "}"),
    block: ($) => seq($.label, repeat(choice($._statement, $.static_info))),
    // A data-section label may be a CLabel (Classes.$fEqColour_$c/=_closure:),
    // so it admits con_label as well as a plain block-label identifier.
    label: ($) => seq(field("name", choice($.con_label, $.identifier)), ":"),

    // Pre-codegen statics print an inline info-table after the closure label:
    // `label: X rep: HeapRep static { Con {..} } srt: Y CCS_DONT_CARE [..]`.
    // Coarse balanced soup (metadata), like the proc info-table.
    static_info: ($) => seq("label:", repeat($._soup)),

    // section ".." { <block>* } is a CmmData section. The name carries nested
    // quotes, e.g. `""data" . M.f_closure"`, so it is taken as one token.
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
        $.foreign_call_statement,
        $.const_statement,
        $.byte_array,
        $.switch,
        $.unwind,
      ),

    // The pre-codegen high-level CmmForeignCall (in -ddump-cmm-from-stg and the
    // passes run before lowering): `foreign call "conv" [hints] tgt(...) returns
    // to L args: ([..]) ress: ([..]) ret_args: N ret_off: N;`. The callee args
    // print as a `(...)` placeholder. The real argument and result registers are
    // the `args:`/`ress:` lists. Distinct from the lowered `call "ccall" ..`.
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

    // unwind <reg> = (Just <expr> | Nothing) [, ..] ; is CmmUnwind, from -g3.
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

    // I8[] "Bindings" is a static string or byte-array initialiser (CmmString)
    // in a "cstring" section. It carries no trailing `;`.
    byte_array: ($) => seq($.cmm_type, "[", "]", $._string_lit),
    _string_lit: ($) => token(/"(\\.|[^"\\])*"/),

    // lhs = rhs ;  (CmmAssign / CmmStore). lhs is a register, local reg, or
    // memory access, accepted as a general expression for leniency. The rhs may
    // be a foreign call (`(_c1::F64) = call "ccall" .. sqrt(..)`), which is not an
    // ordinary expression (it is kept out of `_expr` so a bare `call` statement
    // stays unambiguous), so it is admitted explicitly here.
    assignment: ($) =>
      seq(
        field("lhs", $._expr),
        "=",
        field("rhs", choice($._expr, $.foreign_call)),
        ";",
      ),

    // (results) = call ["conv"] [arg hints:.. result hints:..] target(args) is a
    // CmmUnsafeForeignCall: a C ccall or a MachOp helper (MO_SuspendThread). It
    // carries no `args:/res:/upd:` trailer, the one thing that distinguishes it
    // from the `call` statement, so it appears only as an assignment rhs.
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
    // arg hints:  [PtrHint, PtrHint]  result hints:  [PtrHint]. A long hint list
    // wraps across lines, so the bracket bodies must admit newlines.
    call_hints: ($) =>
      token(/arg hints:\s*\[[^\]]*\]\s*result hints:\s*\[[^\]]*\]/),

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
    _call_target: ($) => choice($.indirect_target, $.con_label, $.identifier),
    // An indirect call through a computed address (`call (I64[Sp])(...)`). Named
    // so the `target` field holds a single node, queryable like the label/name
    // forms (a bare `seq("(", _expr, ")")` would spread the field over `(`/`)`).
    indirect_target: ($) => seq("(", $._expr, ")"),
    returns_to: ($) => seq("returns", "to", field("target", $.identifier), ","),

    // const <expr> ; is a static data word in a section.
    const_statement: ($) => seq("const", $._expr, ";"),

    // ---- expressions ----

    _expr: ($) => choice($._atom, $.binary_expr, $.machop_call, $.typed_expr),

    // <expr> :: <width> is a literal/local-reg ascription. It binds tighter than
    // the infix operators (a + 1.0 :: W64 is a + (1.0 :: W64)).
    typed_expr: ($) => prec(3, seq($._expr, "::", $.cmm_type)),

    // Single left-assoc precedence over all infix operators. A dump parser
    // need not reproduce MachOp precedence. It only has to parse without error.
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

    // %MO_F_Add_W64(a, b) is a machine-op (or %MO_FF_Conv_..) applied call.
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
          // :-led con labels: cons `:_con_info`, and operator cons
          // `:*:_con_info` / `:+:_con_info`. The first tail char is a non-colon
          // symbol or name char, so the `::` ascription is never swallowed.
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*:[-+*/<>=~&|^%.A-Za-z0-9_$'#][-+*/<>=~&|^%.:A-Za-z0-9_$'#]*/,
          // Labels with one+ `:Upper` segments: dictionary cons (C:Eq_con_info),
          // package:module-qualified labels (main:Ffi_init__fexports), and
          // Typeable TyCon-binding labels ($tc'C:Collection3_bytes). The start
          // may be `$`/lower-led. The `:` must abut an uppercase (so a block
          // label `foo:` and the `::` ascription are never swallowed).
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*[A-Za-z_$][A-Za-z0-9_$']*(:[A-Z][A-Za-z0-9_$']*)+[A-Za-z0-9_$.'#]*/,
          // method-selector labels with an operator name: $fNumInt_$c*_info,
          // $fEqDouble_$c/=_closure. The embedded operator run must be followed
          // by a letter/_ so that a `label+2` offset (operator then digit) is
          // left to split as a `+`/`-` binop instead of being glued in. `.` is
          // NOT an operator char here. It only separates module qualifiers (the
          // prefix), else a plain `Mod.name` would match as name+`.`name.
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*[A-Za-z_$][A-Za-z0-9_$'#]*([-+*/<>=~&|^%]+[A-Za-z_$#][A-Za-z0-9_$'#]*)+[A-Za-z0-9_$.'#]*/,
          // operator-led method label, qualified (GHC.Internal.Num.*_info) or
          // bare after -dsuppress-all strips the `$fInst_$c` prefix (*_info,
          // /=_info). The required trailing name char keeps a spaced binop
          // (`a * b`) out. `.` stays a qualifier separator (the prefix), never an
          // operator char, so a plain `Mod.name` is not mistaken for a label.
          /([A-Za-z_$][A-Za-z0-9_$']*\.)*[-+*/<>=~&|^%]+[A-Za-z_$#][A-Za-z0-9_$'#]*[A-Za-z0-9_$.'#]*/,
        ),
      ),

    // I64[Sp - 8], P64[R1 + 15], I64![R1] (the `!` marks an aligned access).
    mem_access: ($) =>
      seq($.cmm_type, optional("!"), "[", field("address", $._expr), "]"),

    // Stack-area references: a bare placeholder `<highSp>`, or an area tagged
    // by a return label, `young<cR8>` (the prefix is glued, binops are spaced,
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
