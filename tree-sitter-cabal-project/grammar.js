/**
 * @file Tree sitter grammar for cabal.project files.
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

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

function indented_block($) {
  return optional(seq($._indent, repeat($._block_item), $._dedent));
}

export default grammar({
  name: "cabal_project",

  externals: makeCabalExternals,

  extras: ($) => [$.comment, CABAL_WHITESPACE],

  conflicts: ($) => [],

  word: ($) => $._word,

  rules: {
    source_file: ($) => repeat($._top_item),

    _top_item: ($) => choice($.field, $.stanza, $.conditional, $._newline),

    _block_item: ($) => choice($.field, $.conditional, $._newline),

    field: ($) =>
      seq(
        field("name", $.field_name),
        ":",
        optional(field("value", $.field_value)),
        $._newline,
      ),

    // ASCII names come from `_word` and Unicode names from the scanner. `_word`
    // stays a terminal, so keyword extraction still finds the stanza headers.
    field_name: ($) => choice($._word, $._field_name),

    _word: ($) => /[A-Za-z][A-Za-z0-9_-]*/,

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
        $.text_fragment,
        ",",
        "*",
        "(",
        ")",
        "{",
        "}",
        "=",
        "!",
        // Fallback when `qualified_name` declines a colon (see makeQualifiedNameRules).
        ":",
      ),

    // Slashes and glob chars stay out, because `path` claims them.
    //
    // The second alternative takes a digit-led token with a letter and no `.`,
    // e.g. a git SHA in `tag:`. Its precedence sits above `integer` (2) and
    // under `iso_date` and `url`.
    identifier: ($) =>
      choice(
        token(prec(1, /[A-Za-z_][A-Za-z0-9_.\-]*/)),
        token(prec(4, /[0-9][A-Za-z0-9_\-]*[A-Za-z][A-Za-z0-9_\-]*/)),
      ),

    stanza: ($) => seq(field("header", $.stanza_header), indented_block($)),

    stanza_header: ($) =>
      choice(
        $._package_header,
        $._repository_header,
        $._source_repository_package_header,
        $._program_options_header,
        $._program_locations_header,
      ),

    // Precedence 2 puts a stanza keyword above `_word`, so a header is not a
    // field name. Longest match keeps the `packages` field apart from `package`.
    _package_header: ($) =>
      seq(alias($._kw_package, $.keyword), field("name", $.package_name)),

    _repository_header: ($) =>
      seq(alias($._kw_repository, $.keyword), field("name", $.repo_name)),

    _source_repository_package_header: ($) =>
      alias($._kw_source_repository_package, $.keyword),
    _program_options_header: ($) => alias($._kw_program_options, $.keyword),
    _program_locations_header: ($) => alias($._kw_program_locations, $.keyword),

    _kw_package: ($) => token(prec(2, ci("package"))),
    _kw_repository: ($) => token(prec(2, ci("repository"))),
    _kw_source_repository_package: ($) =>
      token(prec(2, ci("source-repository-package"))),
    _kw_program_options: ($) => token(prec(2, ci("program-options"))),
    _kw_program_locations: ($) => token(prec(2, ci("program-locations"))),

    package_name: ($) => choice("*", $._word),
    repo_name: ($) => /[A-Za-z][A-Za-z0-9_.-]*/,

    conditional: ($) =>
      seq($.if_clause, repeat($.elif_clause), optional($.else_clause)),

    if_clause: ($) =>
      seq("if", field("condition", $._predicate_expr), indented_block($)),

    elif_clause: ($) =>
      seq("elif", field("condition", $._predicate_expr), indented_block($)),

    else_clause: ($) => seq("else", indented_block($)),

    ...makeQualifiedNameRules({ precedence: 4 }),
    ...makePredicateRules({ extraArgChoices: ["path"] }),
    ...makeValueTokenRules({
      precs: {
        boolean: 6,
        iso_date: 7,
        url: 8,
        version: 5,
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
