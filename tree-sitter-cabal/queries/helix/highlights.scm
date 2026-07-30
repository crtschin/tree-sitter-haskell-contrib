; ===== shared with tree-sitter-cabal-project =====
;
; Every node named below exists in both grammars, so this block is kept
; byte-identical between the two files. Diff them before changing it. It is
; duplicated rather than generated: tree-sitter has no query include, and Helix's
; `; inherits:` pulls a whole language's queries, which would drag in the
; grammar-specific tail below and fail to compile against the sibling.

; comments
(comment) @comment

; field names
(field_name) @property

; conditional keywords
"if"   @keyword.conditional
"elif" @keyword.conditional
"else" @keyword.conditional

; predicates
(predicate_call
  fn: (identifier) @function.builtin)

; identifier arguments to predicate calls
(predicate_arg (identifier) @variable.parameter)

; bare identifier used as a predicate atom
(predicate_or    (identifier) @variable)
(predicate_and   (identifier) @variable)
(predicate_not   (identifier) @variable)
(predicate_paren (identifier) @variable)
(if_clause   condition: (identifier) @variable)
(elif_clause condition: (identifier) @variable)

; literals
(boolean)        @constant.builtin.boolean
(integer)        @number
(version)        @number.float
(iso_date)       @string.special
(url)            @string.special.url
(path)           @string.special.path
(flag_token)     @constant
(qualified_name) @string

; quoted strings and bare identifiers in field values
(quoted_string) @string
(text_fragment) @string
(field_value (identifier) @string)

; operators
(constraint_op) @operator
"!"             @operator
"||"            @operator
"&&"            @operator
"="             @operator

; wildcards / globs
"*" @character.special

; punctuation
"," @punctuation.delimiter
":" @punctuation.delimiter
"(" @punctuation.bracket
")" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket

; ===== cabal-only =====

; cabal-version directive
(spec_version) @number

; section headers
(section_type) @keyword.type
(section_name) @type

(module_name)    @module

; Note [Later pattern wins]
;
; Among the patterns covering a token, the last one in the file wins, whatever its
; specificity. So every override below has to stay under the generic rules, and has to
; recapture each node it matches under a name the theme knows. A throwaway @_name on a
; field name would win and blank it, as the first draft of the prose rule did to
; `description`.

; Prose fields. A bare `.` parses as `path`. That node type is right for
; `hs-source-dirs: .`, a real directory, and only the colour is wrong when the token is a
; sentence period. Recolour it here, where the field name is in scope, rather than
; narrowing the grammar and losing the 56 real `hs-source-dirs: .` cases in the Cabal tree.
; cabal.project has no prose fields and needs none of this.
; See Note [Later pattern wins].
((field
  name: (field_name) @property
  value: (field_value (path) @string))
  (#any-of? @property
    "description" "synopsis" "author" "maintainer" "copyright"
    "category" "stability" "homepage" "bug-reports" "package-url"))

; `<URL>`. Flanking a URL, constraint_op nodes act as bracket punctuation rather than
; version comparisons. See Note [Later pattern wins].
((constraint_op) @punctuation.bracket
  .
  (url)
  .
  (constraint_op) @punctuation.bracket)
