/**
 * @file Tree sitter grammar for cabal.project files.
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import { makePredicateRules, makeValueTokenRules } from "./common/utils.mjs";

function indented_block($) {
  return optional(seq($._indent, repeat($._block_item), $._dedent));
}

export default grammar({
  name: "cabal_project",

  // Order must match scanner/scanner.c's enum Token. _section_name is
  // declared for enum alignment. cabal-project has no section_name concept,
  // so the rule is unreferenced. _field_name is the hidden Unicode-fallback
  // external, used inside the field_name rule below.
  externals: ($) => [
    $._newline,
    $._indent,
    $._dedent,
    $._indented,
    $._continuation,
    $._section_name,
    $._field_name,
  ],

  extras: ($) => [$.comment, /[ \t]/],

  conflicts: ($) => [],

  word: ($) => $._word,

  rules: {
    source_file: ($) => repeat($._top_item),

    _top_item: ($) => choice($.field, $.stanza, $.conditional, $._newline),

    _block_item: ($) => choice($.field, $.conditional, $._newline),

    // ---------- Fields ----------

    field: ($) =>
      seq(
        field("name", $.field_name),
        ":",
        optional(field("value", $.field_value)),
        $._newline,
      ),

    // ASCII fast path via $._word (also the grammar's word token) + Unicode
    // fallback via the scanner-emitted $._field_name. _word stays a terminal
    // so keyword extraction continues to win for stanza-header literals
    // (`package`, `repository`, …). The scanner only fires when the name
    // contains a non-ASCII byte.
    field_name: ($) => choice($._word, $._field_name),

    _word: ($) => /[A-Za-z][A-Za-z0-9_-]*/,

    // A value is any non-empty sequence of value tokens and continuation
    // tokens. Putting `_continuation` and `_value_token` in the same
    // `repeat1` lets values start on a continuation line (e.g.
    // `packages:\n    foo\n  , bar`) and span any number of indented
    // continuation lines.
    field_value: ($) => repeat1(choice($._value_token, $._continuation)),

    _value_token: ($) =>
      choice(
        $.boolean,
        $.iso_date,
        $.version,
        $.url,
        $.qualified_name,
        $.flag_token,
        $.integer,
        $.identifier,
        $.quoted_string,
        $.constraint_op,
        $.path,
        ",",
        "*",
        "(",
        ")",
        "{",
        "}",
        "=",
        "!",
      ),

    qualified_name: ($) =>
      prec(
        4,
        seq(
          field("package", alias($.identifier, $.package_name)),
          ":",
          field(
            "sublibrary",
            choice(
              alias($.identifier, $.sublibrary_name),
              alias("*", $.sublibrary_name),
            ),
          ),
        ),
      ),

    // Identifier covers names, enum-ish values (streaming, modular),
    // versionish hyphenated tokens (ghc-9.4), and dotted/slashy path
    // fragments (setup-test/, foo/bar). Allows `/`, `.`, and `-` so that
    // path-like values lex as one token.
    identifier: ($) => token(prec(1, /[A-Za-z_][A-Za-z0-9_.\-\/]*/)),

    // Path tokens: bare `.` / `..`, absolute paths, relative `./` and `../`
    // paths, plus glob-y trailing `/` paths. `*` and `?` are allowed for
    // glob patterns like `/*.cabal`.
    path: ($) =>
      token(
        prec(
          1,
          choice(/\/[A-Za-z0-9_*?.\-\/]+/, /\.\.?(\/[A-Za-z0-9_*?.\-\/]*)?/),
        ),
      ),

    // ---------- Stanzas ----------

    stanza: ($) => seq(field("header", $.stanza_header), indented_block($)),

    stanza_header: ($) =>
      choice(
        $._package_header,
        $._repository_header,
        $._source_repository_package_header,
        $._program_options_header,
        $._program_locations_header,
      ),

    _package_header: ($) =>
      seq(alias("package", $.keyword), field("name", $.package_name)),

    _repository_header: ($) =>
      seq(alias("repository", $.keyword), field("name", $.repo_name)),

    _source_repository_package_header: ($) =>
      alias("source-repository-package", $.keyword),
    _program_options_header: ($) => alias("program-options", $.keyword),
    _program_locations_header: ($) => alias("program-locations", $.keyword),

    package_name: ($) => choice("*", $._word),
    // Allow domain-style names like `packages.example.org`.
    repo_name: ($) => /[A-Za-z][A-Za-z0-9_.-]*/,

    // ---------- Conditionals ----------

    conditional: ($) =>
      seq($.if_clause, repeat($.elif_clause), optional($.else_clause)),

    if_clause: ($) =>
      seq("if", field("condition", $._predicate_expr), indented_block($)),

    elif_clause: ($) =>
      seq("elif", field("condition", $._predicate_expr), indented_block($)),

    else_clause: ($) => seq("else", indented_block($)),

    ...makePredicateRules({ extraArgChoices: ["path"] }),
    ...makeValueTokenRules({
      precs: {
        boolean: 6,
        iso_date: 7,
        url: 8,
        version: 5,
        flag_token: 3,
        integer: 2,
      },
    }),
  },
});
