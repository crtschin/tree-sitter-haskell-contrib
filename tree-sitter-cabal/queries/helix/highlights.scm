; ===== shared with tree-sitter-cabal-project =====
;
; Keep this block byte-identical in both cabal grammars. Tree-sitter has no
; query include, and Helix `; inherits:` pulls in the whole sibling file, whose
; tail does not compile against this grammar.

(comment) @comment

(field_name) @property

"if"   @keyword.conditional
"elif" @keyword.conditional
"else" @keyword.conditional

(predicate_call
  fn: (identifier) @function.builtin)

(predicate_arg (identifier) @variable.parameter)

(predicate_or    (identifier) @variable)
(predicate_and   (identifier) @variable)
(predicate_not   (identifier) @variable)
(predicate_paren (identifier) @variable)
(if_clause   condition: (identifier) @variable)
(elif_clause condition: (identifier) @variable)

(boolean)        @constant.builtin.boolean
(integer)        @number
(version)        @number.float
(iso_date)       @string.special
(url)            @string.special.url
(path)           @string.special.path
(flag_token)     @constant
(qualified_name) @string

(quoted_string) @string
(text_fragment) @string
(field_value (identifier) @string)

(constraint_op) @operator
"!"             @operator
"||"            @operator
"&&"            @operator
"="             @operator

"*" @character.special

"," @punctuation.delimiter
":" @punctuation.delimiter
"(" @punctuation.bracket
")" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket

; ===== cabal-only =====

(spec_version) @number

(section_type) @keyword.type
(section_name) @type

(module_name)    @module

; Backpack renaming keywords. This pattern shape does two jobs:
;   - The `field_value` parent keeps error recovery from coloring `as`,
;     `hiding` and `requires` in a `description` under a half-typed header.
;   - The parent stays uncaptured, so each keyword wins its own match. A
;     captured parent collapses them to one. See Note [Later pattern wins].
(field_value (renaming_keyword) @keyword.import)

; Note [Later pattern wins]
;
; Among the patterns that cover a token, the last one in the file wins, whatever
; its specificity. Keep every override under the generic rules, and recapture
; each node that it matches under a name that the theme knows. A throwaway
; @_name on a field name wins and blanks the name.

; A sentence period in a prose field parses as `path`, which is correct for
; `hs-source-dirs: .`. Recolor it here, where the field name is in scope. See
; Note [Later pattern wins].
((field
  name: (field_name) @property
  value: (field_value (path) @string))
  (#any-of? @property
    "description" "synopsis" "author" "maintainer" "copyright"
    "category" "stability" "homepage" "bug-reports" "package-url"))

; In `<URL>`, the two constraint_op nodes are brackets. See
; Note [Later pattern wins].
((constraint_op) @punctuation.bracket
  .
  (url)
  .
  (constraint_op) @punctuation.bracket)
