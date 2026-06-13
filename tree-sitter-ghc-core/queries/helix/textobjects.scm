; A binding is a function-like definition; its rhs is the inside.
(binding) @function.around
(binding rhs: (_) @function.inside)

; case alternatives as list entries.
(alternative) @entry.around
(alternative rhs: (_) @entry.inside)

; Comments.
(comment) @comment.around
(comment) @comment.inside
