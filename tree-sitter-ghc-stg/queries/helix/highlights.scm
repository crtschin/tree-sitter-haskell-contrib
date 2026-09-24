; Generic names first. The specific patterns at the end override them.
(variable) @variable
(tagged_occurrence) @variable
(tyvar) @type.parameter
(constructor) @constructor
(special_con) @constructor
(operator) @operator
(type_operator) @operator

(literal) @constant.numeric

(comment) @comment
(banner) @comment.documentation
(idinfo) @attribute
(binder_annotation) @attribute

(update_flag) @keyword.storage.modifier
(tag) @attribute
(cost_centre) @constant.builtin

[
  "let"
  "let-no-escape"
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

"__DEFAULT" @constant.builtin

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
  "%"
  "'"
  "!"
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

[ "," ";" ] @punctuation.delimiter

(binding name: (variable) @function)
(binding name: (constructor) @function)
(tagged_binder name: (variable) @function)
(tagged_binder name: (constructor) @function)
(app . (variable) @function.call)
