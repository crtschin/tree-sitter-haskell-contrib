; ===== shared with tree-sitter-cabal =====
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

; ===== cabal-project-only =====

(stanza) @indent @extend
