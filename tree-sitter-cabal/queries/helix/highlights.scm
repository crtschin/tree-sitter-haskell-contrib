; Comments
(comment) @comment

; cabal-version directive
(spec_version) @number

; Field structure
(field_name)   @property
(section_type) @keyword.type
(section_name) @type

; Conditional keywords
[
  "if"
  "elif"
  "else"
] @keyword.conditional

; Predicates in conditions
(predicate_call
  fn: (identifier) @function.builtin)

(predicate_arg (identifier) @variable.parameter)

(predicate_or    (identifier) @variable)
(predicate_and   (identifier) @variable)
(predicate_not   (identifier) @variable)
(predicate_paren (identifier) @variable)
(condition_if      condition: (identifier) @variable)
(condition_elseif  condition: (identifier) @variable)

"||" @operator
"&&" @operator

; Literals in field values
(boolean)         @constant.builtin.boolean
(integer)         @number
(version)         @number.float
(iso_date)        @string.special
(url)             @string.special.url
(module_name)     @module
(qualified_name)  @string
(flag_token)      @constant
(text_fragment)   @string

; Quoted strings and bare identifiers in field values
(quoted_string) @string
(field_value (identifier) @string)

; Operators
(constraint_op) @operator
"!"             @operator
"="             @operator

; Wildcards / globs
"*" @character.special

; Punctuation
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
