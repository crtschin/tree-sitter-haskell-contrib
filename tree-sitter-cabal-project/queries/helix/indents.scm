; Each stanza body indents one level relative to its header.
(stanza) @indent @extend

; if / elif / else bodies indent one level.
[
  (if_clause)
  (elif_clause)
  (else_clause)
] @indent @extend

; Multi-line field values. `_indent` is a hidden external here, so we
; detect multi-line values via the predicate instead of structurally.
((field (field_value) @v) @indent
  (#not-one-line? @v)
  (#set! "scope" "tail"))
