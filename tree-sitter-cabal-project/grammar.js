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

    // ---------- Fields ----------

    field: ($) =>
      seq(
        field("name", $.field_name),
        ":",
        optional(field("value", $.field_value)),
        $._newline,
      ),

    // ASCII via $._word (the grammar's word token), Unicode via the scanner's
    // $._field_name. _word stays a terminal so keyword extraction wins for stanza headers
    // (`package`, `repository`). The scanner fires only on a non-ASCII byte.
    field_name: ($) => choice($._word, $._field_name),

    _word: ($) => /[A-Za-z][A-Za-z0-9_-]*/,

    // Mixing `_continuation` and `_value_token` in one `repeat1` lets a value start on a
    // continuation line (`packages:\n    foo\n  , bar`) and span indented continuations.
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

    // Enum-ish values, versionish tokens (ghc-9.4), and git refs.
    //
    // Slashes and glob characters are deliberately NOT included: `path` (shared, in
    // common/utils.mjs) claims those, so `vendor/*` is one path node rather than an
    // identifier. Keeping them here made a single `packages:` list emit both kinds.
    //
    // Second alt: a digit-leading token that contains a letter and no `.` (a git commit
    // SHA / ref in `tag:`), which would otherwise split into `integer` (the leading digits)
    // + `identifier`. Its own token above `integer` (2) so it wins the shared prefix, but
    // below `iso_date`/`url` so a date or URL still wins.
    //
    // A pure number stays `integer` and a dotted `1.2.3` stays `version`.
    identifier: ($) =>
      choice(
        token(prec(1, /[A-Za-z_][A-Za-z0-9_.\-]*/)),
        token(prec(4, /[0-9][A-Za-z0-9_\-]*[A-Za-z][A-Za-z0-9_\-]*/)),
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

    // Stanza keywords are case-insensitive: see `ci` in common/utils.mjs. The explicit
    // precedence puts them above the `_word` token so a header is not read as a field name.
    // Longest-match still protects longer field names, so the `packages` field is unaffected
    // by the `package` keyword.
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
