/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import {
  CABAL_WHITESPACE,
  ci,
  makeCabalExternals,
  makeQualifiedNameRules,
  makePredicateRules,
  makeValueTokenRules,
} from "./common/utils.mjs";

export default grammar({
  name: "cabal",

  extras: ($) => [$.comment, CABAL_WHITESPACE],

  externals: makeCabalExternals,

  word: ($) => $.identifier,

  // Flatten the hidden _value_token wrapper rule into its callsite (field_value).
  // Inlining shrinks the parse table without altering the AST.
  inline: ($) => [$._value_token],

  // Empty if_clause/elif_clause bodies make `else`/`elif` reachable both as a continuation
  // here and as the start of an outer conditional.
  conflicts: ($) => [[$.conditional]],

  rules: {
    cabal: ($) =>
      seq(
        optional($.cabal_version),
        repeat($._newline),
        optional($.properties),
        optional($.sections),
      ),

    // The keyword is aliased to `field_name`, which it is: without that it stays an
    // anonymous regex token, unreachable from a query, and `cabal-version` renders
    // unhighlighted while every other field name is a property.
    cabal_version: ($) =>
      seq(
        repeat($._newline),
        field("name", alias(ci("cabal-version"), $.field_name)),
        ":",
        $.spec_version,
      ),

    // Modern bare version (3.0), old range prefix (>= 1.8), and old -any/-none forms.
    spec_version: ($) => /(>=?\s*)?\d+\.\d+(\.\d+)*(\.\*)?|[+\-]any/,

    properties: ($) => repeat1(seq($.field, repeat($._newline))),

    sections: ($) =>
      repeat1(
        seq(
          choice(
            $.benchmark,
            $.common,
            $.custom_setup,
            $.executable,
            $.flag,
            $.foreign_library,
            $.library,
            $.source_repository,
            $.test_suite,
          ),
          repeat($._newline),
        ),
      ),

    benchmark: ($) =>
      seq(
        field("type", alias(ci("benchmark"), $.section_type)),
        field("name", $.section_name),
        optional(field("properties", $.property_or_conditional_block)),
      ),

    common: ($) =>
      seq(
        field("type", alias(ci("common"), $.section_type)),
        field("name", $.section_name),
        optional(field("properties", $.property_or_conditional_block)),
      ),

    custom_setup: ($) =>
      seq(
        field("type", alias(ci("custom-setup"), $.section_type)),
        optional(field("properties", $.property_block)),
      ),

    executable: ($) =>
      seq(
        field("type", alias(ci("executable"), $.section_type)),
        field("name", $.section_name),
        optional(field("properties", $.property_or_conditional_block)),
      ),

    flag: ($) =>
      seq(
        field("type", alias(ci("flag"), $.section_type)),
        field("name", $.section_name),
        optional(field("properties", $.property_block)),
      ),

    foreign_library: ($) =>
      seq(
        field("type", alias(ci("foreign-library"), $.section_type)),
        field("name", $.section_name),
        optional(field("properties", $.property_or_conditional_block)),
      ),

    library: ($) =>
      seq(
        field("type", alias(ci("library"), $.section_type)),
        optional(field("name", $.section_name)),
        optional(field("properties", $.property_or_conditional_block)),
      ),

    source_repository: ($) =>
      seq(
        field("type", alias(ci("source-repository"), $.section_type)),
        field("name", $.section_name),
        optional(field("properties", $.property_block)),
      ),

    test_suite: ($) =>
      seq(
        field("type", alias(ci("test-suite"), $.section_type)),
        field("name", $.section_name),
        optional(field("properties", $.property_or_conditional_block)),
      ),

    // ASCII via DFA, Unicode via the scanner's `_section_name`.
    //
    // ci-regex section_type aliases win by specificity.
    //
    // The scanner fires only on a non-ASCII byte, so ASCII keywords are never
    // preempted.
    section_name: ($) => choice(/\w*[a-zA-Z]\w*(-\w+)*/, $._section_name),

    property_block: ($) =>
      seq(
        $._indent,
        repeat($._newline),
        repeat1(seq($.field, repeat($._newline))),
        $._dedent,
      ),

    field: ($) =>
      seq(
        field("name", $.field_name),
        ":",
        optional(field("value", $.field_value)),
        $._newline,
      ),

    field_name: ($) => choice(/\w(\w|-)+/, $._field_name),

    // Mixing `_continuation` and `_value_token` in one `repeat1` lets a value start on a
    // continuation line and span indented continuation lines, without opening an indent
    // block. Opening one would force the looser `_indented` reference column; upstream
    // Cabal measures continuations against the field's own column for both formats
    // (Distribution.Fields.Parser.fieldLayoutOrBraces).
    field_value: ($) => repeat1(choice($._value_token, $._continuation)),

    _value_token: ($) =>
      choice(
        $.boolean,
        $.iso_date,
        $.url,
        $.version,
        $.module_name,
        $.qualified_name,
        $.flag_token,
        $.integer,
        $.identifier,
        $.quoted_string,
        $.path,
        $.text_fragment,
        $.constraint_op,
        ",",
        "*",
        "(",
        ")",
        "{",
        "}",
        "=",
        "!",
        ":",
        '"',
      ),

    module_name: ($) =>
      token(prec(5, /[A-Z][A-Za-z0-9_']*(\.[A-Z][A-Za-z0-9_']*)+/)),

    identifier: ($) => token(prec(1, /[A-Za-z_][A-Za-z0-9_.\-]*/)),

    property_or_conditional_block: ($) =>
      seq(
        $._indent,
        repeat($._newline),
        repeat1(seq(choice($.field, $.conditional), repeat($._newline))),
        $._dedent,
      ),

    conditional: ($) =>
      seq(
        $.if_clause,
        // Newlines between clauses let `else`/`elif` be found even when the preceding
        // `if`/`elif` has an empty body.
        repeat(seq(repeat($._newline), $.elif_clause)),
        optional(seq(repeat($._newline), $.else_clause)),
      ),

    // if/elif body can be empty (`if flag(x)` then `else`), so the block is optional.
    if_clause: ($) =>
      seq(
        "if",
        field("condition", $._predicate_expr),
        optional($.property_or_conditional_block),
      ),
    elif_clause: ($) =>
      seq(
        "elif",
        field("condition", $._predicate_expr),
        optional($.property_or_conditional_block),
      ),
    else_clause: ($) => seq("else", $.property_or_conditional_block),

    ...makeQualifiedNameRules({ precedence: 4 }),
    ...makePredicateRules({ extraArgChoices: ["text_fragment"] }),
    ...makeValueTokenRules({
      precs: {
        boolean: 7,
        iso_date: 8,
        url: 9,
        version: 6,
        flag_token: 3,
        // Above identifier (1) so a name-leading relative path is one node; below
        // flag_token (3) so `-optP-I/usr/include` keeps its flag.
        path: 2,
        // Above qualified_name (4): see the drive-letter note in makeValueTokenRules.
        path_drive: 5,
        integer: 2,
      },
    }),
  },
});
