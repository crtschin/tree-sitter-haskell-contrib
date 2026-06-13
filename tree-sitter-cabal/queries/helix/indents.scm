; Each section body indents one level relative to its header line.
[
  (library)
  (foreign_library)
  (executable)
  (test_suite)
  (benchmark)
  (common)
  (flag)
  (source_repository)
  (custom_setup)
] @indent @extend

; if / elif / else bodies indent one level.
[
  (condition_if)
  (condition_elseif)
  (condition_else)
] @indent @extend

; Multi-line field values: the (indent) child is only present when the
; value spans more than the header line, so this pattern is exact.
((field (indent)) @indent @extend)
