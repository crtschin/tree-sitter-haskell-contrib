; ===== shared with tree-sitter-cabal =====
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

; ===== cabal-project-only =====

; stanza headers
(keyword) @keyword

(stanza_header (package_name) @type)
(repo_name) @module
