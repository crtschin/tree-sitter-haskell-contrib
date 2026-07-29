; ===== shared with tree-sitter-cabal =====
;
; Kept byte-identical between the two files (see highlights.scm for why it is
; duplicated rather than generated).

; comments
(comment) @comment.around
(comment) @comment.inside

; list entries inside a field value (build-depends, packages, ...)
(field_value (identifier)     @entry.around) @entry.inside
(field_value (qualified_name) @entry.around) @entry.inside
(field_value (path)           @entry.around) @entry.inside

; ===== cabal-project-only =====

(stanza) @function.around

; The body has no wrapper node, so approximate `.inside` with all non-header
; children. Helix aggregates same-name captures within a match into one range.
(stanza header: (_) (_) @function.inside)
