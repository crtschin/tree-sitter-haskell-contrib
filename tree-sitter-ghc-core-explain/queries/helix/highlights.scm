; GHC simplifier-explanation dump highlighting
; (-ddump-rule-firings, -ddump-inlinings, -ddump-simpl-stats).

[
  "Rule fired:"
  "Inlining done:"
  "Simplifier"
  "Total ticks:"
] @keyword

(rule_name) @string.special
(inlined_id) @variable

(module) @namespace
(builtin) @constant.builtin

[
  "("
  ")"
] @punctuation.bracket

; -dppr-debug verbose inlining bodies are opaque typed-Core soup.
(detail) @comment

; detail_name holds binder ids and, under RuleFired, rule phrases. A split needs
; an #eq? predicate, and the query runner of coreviewer ignores predicates.
(number) @number
(category_name) @constructor
(detail_name) @variable
