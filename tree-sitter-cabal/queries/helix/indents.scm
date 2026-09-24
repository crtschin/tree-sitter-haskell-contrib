; ===== shared with tree-sitter-cabal-project =====
;
; Keep this block byte-identical in both cabal grammars. highlights.scm says
; why.

[
  (if_clause)
  (elif_clause)
  (else_clause)
] @indent @extend

; The indent token is a hidden external, so the predicate finds a multi-line
; value.
((field (field_value) @v) @indent
  (#not-one-line? @v)
  (#set! "scope" "tail"))

; ===== cabal-only =====

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
