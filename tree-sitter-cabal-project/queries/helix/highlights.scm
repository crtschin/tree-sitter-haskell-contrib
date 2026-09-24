; ===== shared with tree-sitter-cabal =====
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

; ===== cabal-project-only =====

(keyword) @keyword

(stanza_header (package_name) @type)
(repo_name) @module
