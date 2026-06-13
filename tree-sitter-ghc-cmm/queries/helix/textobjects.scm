; A proc is a function. Its offset body is the inside.
(proc) @function.around
(proc (offset_body) @function.inside)

; Basic blocks as list entries.
(block) @entry.around
(block) @entry.inside

; Data sections as classes.
(data_section) @class.around

; Comments.
(comment) @comment.around
(comment) @comment.inside
