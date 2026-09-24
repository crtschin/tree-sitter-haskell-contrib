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

    // The alias makes the keyword a `field_name`, so queries highlight it like
    // every other field name.
    cabal_version: ($) =>
      seq(
        repeat($._newline),
        field("name", alias(ci("cabal-version"), $.field_name)),
        ":",
        $.spec_version,
      ),

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

    // ASCII names lex in the DFA and Unicode names come from the scanner. The
    // scanner fires only on a non-ASCII byte, so it never preempts a keyword.
    section_name: ($) => choice(/\w*[a-zA-Z]\w*(-\w+)*/, $._section_name),

    property_block: ($) =>
      seq(
        $._indent,
        repeat($._newline),
        repeat1(seq($.field, repeat($._newline))),
        $._dedent,
      ),

    // `mixins` and `reexported-modules` share one rule, because Cabal parses
    // `as` the same way in both. The value aliases to `field_value`, so the node
    // shape matches every other field.
    //
    // `signatures` has no rule. A `module_name` alias accepts any lexed value,
    // so `signatures: base >= 4.14` puts module names in the symbol picker.
    // Resolve that field in a query.
    field: ($) => choice($._renaming_field, $._plain_field),

    _plain_field: ($) =>
      seq(
        field("name", $.field_name),
        ":",
        optional(field("value", $.field_value)),
        $._newline,
      ),

    _renaming_field: ($) =>
      seq(
        field(
          "name",
          alias(choice(ci("mixins"), ci("reexported-modules")), $.field_name),
        ),
        ":",
        optional(field("value", alias($.renaming_value, $.field_value))),
        $._newline,
      ),

    // Flat, because a nested mixin grammar must thread `_continuation` through
    // every level. It accepts a superset of `field_value`.
    renaming_value: ($) =>
      repeat1(choice($._value_token, $.renaming_keyword, $._continuation)),

    // Case-sensitive, as in Cabal. Precedence 2 must beat `identifier` (1),
    // which also matches these words.
    //
    // The flat repeat cannot tell a head from a tail, so `mixins: as (Foo)`
    // reads the package `as` as a keyword. Hackage has no such package.
    renaming_keyword: ($) => token(prec(2, choice("as", "hiding", "requires"))),

    field_name: ($) => choice(/\w(\w|-)+/, $._field_name),

    // A value can start on a continuation line and span more of them with no
    // indent block. An indent block uses the looser `_indented` column, but
    // Cabal measures a continuation against the column of the field.
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
