/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import { makePredicateRules, makeValueTokenRules } from "./common/utils.mjs";

// Build a case-insensitive regex for a keyword. Each ASCII letter becomes
// [aA], each non-letter (hyphen, digit) is kept as-is.
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

  // U+00A0 (non-breaking space) appears in some old cabal files. Treat it as whitespace.
  extras: ($) => [$.comment, /[ \t\r ]/],

  // Order must match scanner/scanner.c's enum Token. Both _indented and
  // _continuation are declared so the shared scanner's valid_symbols array
  // sizes match the enum. Cabal only references _indented.
  externals: ($) => [
    $._newline,
    $.indent,
    $.dedent,
    $._indented,
    $._continuation,
    // Hidden Unicode externals. The scanner emits these only when a name
    // contains a non-ASCII byte. Visible `section_name` / `field_name`
    // rules wrap them via `choice` with the ASCII regex. See the dispatch
    // comment in scanner.c.
    $._section_name,
    $._field_name,
  ],

  word: ($) => $.identifier,

  // Flatten the 23-alternative _value_token wrapper rule into its callsite
  // (field_value). The wrapper is hidden. Inlining shrinks the parse
  // table without altering the AST.
  inline: ($) => [$._value_token],

  // Optional empty bodies on condition_if / condition_elseif make `else`/`elif` reachable
  // both as continuation of the current conditional and as the start of an outer one.
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

    // Matches the modern bare version (3.0), the old range prefix (>= 1.8),
    // and the old -any / -none forms used before cabal-version was meaningful.
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

    // ASCII fast path via DFA + Unicode fallback via scanner-emitted
    // `_section_name`. ci-regex aliases for section_type keywords win at
    // top-level by specificity. The scanner only fires when the name
    // contains a non-ASCII byte, so ASCII keywords are never preempted.
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
            // field_value is optional on every line so comment-only lines parse cleanly.
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

    // Atomic token. Rejects the colon entirely when it isn't followed by a valid
    // sublibrary, so prose colons aren't mistaken for qualified-name separators.
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
        // Newlines between clauses allow `else`/`elif` to be found even when
        // the preceding `if`/`elif` has an empty body (no indented block).
        repeat(seq(repeat($._newline), $.condition_elseif)),
        optional(seq(repeat($._newline), $.condition_else)),
      ),

    // The body of if/elif can be empty (e.g. `if flag(x)` immediately followed
    // by `else`). Making the block optional handles that case.
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
