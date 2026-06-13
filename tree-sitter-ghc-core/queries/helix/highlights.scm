; GHC Core dump highlighting (compiler/GHC/Core/Ppr.hs surface).

; ---- names (generic; specialized further down, which overrides these) ----
(variable) @variable
(tyvar) @type.parameter
(constructor) @constructor
(special_con) @constructor
(operator) @operator
(type_operator) @operator

; ---- literals ----
(literal) @constant.numeric

; ---- comments / banners / metadata ----
(comment) @comment
(result_size) @comment
(banner) @comment.documentation
(dash_header) @comment.documentation
(tickish) @comment.documentation
; [IdInfo] / [Occ=..] brackets are pretty-printer metadata, not code.
(idinfo) @attribute
(binder_annotation) @attribute

; ---- keywords ----
[
  "let"
  "letrec"
  "join"
  "joinrec"
  "in"
  "Rec"
  "end"
  "forall"
  "∀"
] @keyword

[
  "case"
  "of"
] @keyword.control.conditional

"jump" @keyword.control

"__DEFAULT" @constant.builtin

(lambda [ "\\" "/" ] @keyword.function)

"`cast`" @keyword.operator

; ---- types ----
(star) @type.builtin
(ellipsis) @comment

; ---- operators ----
[
  "->"
  "→"
  "⊸"
  "=>"
  "⇒"
  "~R#"
  "::"
  "="
  "@"
  "@~"
  "%"
  "'"
] @operator

; ---- punctuation ----
[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "(#"
  "#)"
] @punctuation.bracket

"," @punctuation.delimiter

; ---- definitions (override the generic @variable above) ----
(binding name: (variable) @function)
(binding name: (paren_operator (operator) @function))
(type_signature (variable) @function)
(type_signature (paren_operator (operator) @function))
