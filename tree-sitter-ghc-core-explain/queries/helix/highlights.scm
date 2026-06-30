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

; simpl-stats breakdown. detail_name is uniformly @variable: it mixes binder ids
; (most categories) and rule phrases (RuleFired), but splitting them needs an
; #eq? predicate that coreviewer's query runner does not evaluate.
(number) @number
(category_name) @constructor
(detail_name) @variable
