; comments
(comment) @comment

; field names
(field_name) @property

; keywords
(keyword) @keyword

"if"   @keyword.conditional
"elif" @keyword.conditional
"else" @keyword.conditional

; stanza headers
(stanza_header (package_name) @type)
(repo_name)    @module

; literals
(boolean)   @constant.builtin.boolean
(integer)   @number
(version)   @number.float
(iso_date)  @string.special
(url)       @string.special.url
(path)      @string.special.path

; identifiers
(qualified_name (package_name)    @string)
(qualified_name (sublibrary_name) @string)
(flag_token)                      @constant

; quoted strings and bare identifiers in field values
(quoted_string) @string
(field_value (identifier) @string)

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

; `<URL>`: when constraint_op nodes flank a URL they're acting as bracket
; punctuation, not as version comparison operators. The default operator
; highlight above is overridden by this more-specific pattern.
((constraint_op) @punctuation.bracket
  .
  (url)
  .
  (constraint_op) @punctuation.bracket)
