/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import { makePredicateRules, makeValueTokenRules } from "./common/utils.mjs";

// Case-insensitive regex for a keyword: each ASCII letter becomes [aA].
function ci(str) {
  return new RegExp(
    str
      .split("")
      .map((c) =>
        /[a-zA-Z]/.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c,
      )
      .join(""),
  );
}

export default grammar({
  name: "cabal",

  // U+00A0 (non-breaking space) appears in some old cabal files. Treat it as
  // whitespace.
  extras: ($) => [$.comment, /[ \t\r ]/],

  // Order must match the shared scanner's enum Token. _indented and _continuation are both
  // declared for valid_symbols sizing. cabal references only _indented.
  externals: ($) => [
    $._newline,
    $.indent,
    $.dedent,
    $._indented,
    $._continuation,
    // Hidden Unicode externals, emitted only on a non-ASCII byte. Visible section_name /
    // field_name wrap them via `choice` with the ASCII regex. See scanner.c.
    $._section_name,
    $._field_name,
  ],

  word: ($) => $.identifier,

  // Flatten the hidden _value_token wrapper rule into its callsite (field_value).
  // Inlining shrinks the parse table without altering the AST.
  inline: ($) => [$._value_token],

  // Empty condition_if/elseif bodies make `else`/`elif` reachable both as a continuation
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

    cabal_version: ($) =>
      seq(repeat($._newline), ci("cabal-version"), ":", $.spec_version),

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

    // ASCII via DFA, Unicode via the scanner's `_section_name`. ci-regex section_type
    // aliases win by specificity. The scanner fires only on a non-ASCII byte, so ASCII
    // keywords are never preempted.
    section_name: ($) => choice(/\w*[a-zA-Z]\w*(-\w+)*/, $._section_name),

    property_block: ($) =>
      seq(
        $.indent,
        repeat($._newline),
        repeat1(seq($.field, repeat($._newline))),
        $.dedent,
      ),

    field: ($) =>
      seq(
        $.field_name,
        ":",
        choice(
          seq(optional($.field_value), $._newline),
          seq(
            optional($.field_value),
            $.indent,
            // field_value is optional on every line so comment-only lines parse
            // cleanly.
            optional($.field_value),
            repeat(seq($._indented, optional($.field_value))),
            $.dedent,
          ),
        ),
      ),

    field_name: ($) => choice(/\w(\w|-)+/, $._field_name),

    field_value: ($) => repeat1($._value_token),

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

    // Atomic token. Rejects the `:` unless a valid sublibrary follows, so prose colons
    // aren't taken as qualified-name separators.
    qualified_name: ($) =>
      token(
        prec(
          4,
          seq(
            /[A-Za-z_][A-Za-z0-9_.\-]*/,
            ":",
            choice(
              /[A-Za-z_][A-Za-z0-9_.\-]*/,
              "*",
              seq(
                "{",
                /[A-Za-z_][A-Za-z0-9_.\-]*/,
                repeat(seq(",", /[A-Za-z_][A-Za-z0-9_.\-]*/)),
                "}",
              ),
            ),
          ),
        ),
      ),

    identifier: ($) => token(prec(1, /[A-Za-z_][A-Za-z0-9_.\-]*/)),

    text_fragment: ($) => token(prec(-1, /[^\s,()!*<>{}=\n"]+/)),

    property_or_conditional_block: ($) =>
      seq(
        $.indent,
        repeat($._newline),
        repeat1(seq(choice($.field, $.conditional), repeat($._newline))),
        $.dedent,
      ),

    conditional: ($) =>
      seq(
        $.condition_if,
        // Newlines between clauses let `else`/`elif` be found even when the preceding
        // `if`/`elif` has an empty body.
        repeat(seq(repeat($._newline), $.condition_elseif)),
        optional(seq(repeat($._newline), $.condition_else)),
      ),

    // if/elif body can be empty (`if flag(x)` then `else`), so the block is optional.
    condition_if: ($) =>
      seq(
        "if",
        field("condition", $._predicate_expr),
        optional($.property_or_conditional_block),
      ),
    condition_elseif: ($) =>
      seq(
        "elif",
        field("condition", $._predicate_expr),
        optional($.property_or_conditional_block),
      ),
    condition_else: ($) => seq("else", $.property_or_conditional_block),

    ...makePredicateRules({ extraArgChoices: ["text_fragment"] }),
    ...makeValueTokenRules({
      precs: {
        boolean: 7,
        iso_date: 8,
        url: 9,
        version: 6,
        flag_token: 3,
        integer: 2,
      },
    }),
  },
});
