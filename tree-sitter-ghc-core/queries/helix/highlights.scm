; GHC Core dump highlighting (compiler/GHC/Core/Ppr.hs surface).

(variable) @variable
(tyvar) @type.parameter
(constructor) @constructor
(special_con) @constructor
(operator) @operator
(type_operator) @operator

(literal) @constant.numeric

(comment) @comment
(result_size) @comment
(banner) @comment.documentation
(dash_header) @comment.documentation
(tickish) @comment.documentation
(idinfo) @attribute
(binder_annotation) @attribute

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

(star) @type.builtin
(ellipsis) @comment

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

(binding name: (variable) @function)
(binding name: (paren_operator (operator) @function))
(type_signature (variable) @function)
(type_signature (paren_operator (operator) @function))
