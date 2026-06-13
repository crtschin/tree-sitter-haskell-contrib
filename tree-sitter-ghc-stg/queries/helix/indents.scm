; Closure bodies and brace-delimited groups indent their contents.
[
  (closure)
  (let)
  (let_no_escape)
  (case)
  (rec_block)
] @indent

[
  "}"
  "]"
  ")"
] @outdent
