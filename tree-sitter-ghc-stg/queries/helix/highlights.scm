; GHC STG dump highlighting (compiler/GHC/Stg/Syntax.hs surface).

; ---- names (generic; specialized further down, which overrides these) ----
(variable) @variable
(tyvar) @type.parameter
(constructor) @constructor
(special_con) @constructor
(operator) @operator
(type_operator) @operator

; ---- literals ----
(literal) @constant.numeric

; ---- comments / metadata ----
(comment) @comment
(banner) @comment.documentation
(idinfo) @attribute
(binder_annotation) @attribute

; Closure update flag (\r \u \s \j), tag-inference tags, cost-centres.
(update_flag) @keyword.storage.modifier
(tag) @attribute
(cost_centre) @constant.builtin

; ---- keywords ----
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
  "%"
  "'"
  "!"
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

[ "," ";" ] @punctuation.delimiter

; ---- definitions / calls (override the generic @variable above) ----
(binding name: (variable) @function)
(binding name: (constructor) @function)
(tagged_binder name: (variable) @function)
(tagged_binder name: (constructor) @function)
(app . (variable) @function.call)
