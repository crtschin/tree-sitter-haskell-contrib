(stanza) @function.around

; The body has no wrapper node; approximate `.inside` with all non-header
; children. Helix aggregates same-name captures within a match into one range.
(stanza header: (_) (_) @function.inside)

(comment) @comment.around
(comment) @comment.inside

(field_value (identifier)     @entry.around) @entry.inside
(field_value (qualified_name) @entry.around) @entry.inside
(field_value (path)           @entry.around) @entry.inside
