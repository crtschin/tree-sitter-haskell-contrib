; ===== shared with tree-sitter-cabal-project =====
;
; Kept byte-identical between the two files (see highlights.scm for why it is
; duplicated rather than generated).

; if / elif / else bodies indent one level.
[
  (if_clause)
  (elif_clause)
  (else_clause)
] @indent @extend

; Multi-line field values. The indent token is a hidden external, so detect
; multi-line values with the predicate; the structure does not mark them.
((field (field_value) @v) @indent
  (#not-one-line? @v)
  (#set! "scope" "tail"))

; ===== cabal-only =====

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
