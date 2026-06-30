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

  // Order must match the shared scanner's enum Token. _section_name is declared only for
  // that enum alignment (cabal-project has no section concept). _field_name is the hidden
  // Unicode-fallback external used by field_name below.
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
          // The package may be a wildcard (`*:*` in an allow-newer/constraints
          // list), not only a name.
          field(
            "package",
            choice(
              alias($.identifier, $.package_name),
              alias("*", $.package_name),
            ),
          ),
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

    // Covers names, enum-ish values, versionish tokens (ghc-9.4), and dotted/slashy path
    // fragments. Allows `/`, `.`, `-`, and glob `*`/`?` so a path-like value or a glob with
    // an alphanumeric prefix (`vendor/*`, `pkg-*/`, `packages/**/*.cabal`) lexes as one
    // token instead of splitting at the wildcard. A glob that leads with `*`/`?` is a `path`.
    // Second alt: a digit-leading token that contains a letter and no `.`
    // (a git commit SHA / ref in `tag:`), which would otherwise split into
    // `integer` (the leading digits) + `identifier`. Its own token at a prec
    // above `integer` (2) so it wins the shared prefix, but below `iso_date`
    // (7)/`url` (8) so a date/URL still wins; a pure number stays `integer` and
    // a dotted `1.2.3` stays `version` (neither this alt nor they overlap).
    identifier: ($) =>
      choice(
        token(prec(1, /[A-Za-z_][A-Za-z0-9_.\-\/*?]*/)),
        token(prec(4, /[0-9][A-Za-z0-9_\-\/*?]*[A-Za-z][A-Za-z0-9_\-\/*?]*/)),
      ),

    // Bare `.`/`..`, absolute, relative `./`/`../`, and glob paths. `*`/`?` for globs like
    // `/*.cabal`. The third alternative is a glob-leading segment (`*.cabal`,
    // `*/*.cabal`) so its leading `*` folds into the path instead of splitting off as
    // the standalone `*` token; a trailing char is required, so a bare `*` (glob-all)
    // stays that token.
    path: ($) =>
      token(
        prec(
          1,
          choice(
            /\/[A-Za-z0-9_*?.\-\/]+/,
            /\.\.?(\/[A-Za-z0-9_*?.\-\/]*)?/,
            /[*?][A-Za-z0-9_*?.\-\/]+/,
          ),
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
