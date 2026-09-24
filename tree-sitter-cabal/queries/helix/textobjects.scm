; ===== shared with tree-sitter-cabal-project =====
;
; Keep this block byte-identical in both cabal grammars. highlights.scm says
; why.

(comment) @comment.around
(comment) @comment.inside

(field_value (identifier)     @entry.around) @entry.inside
(field_value (qualified_name) @entry.around) @entry.inside
(field_value (path)           @entry.around) @entry.inside

; ===== cabal-only =====

[
  (library)
  (foreign_library)
  (executable)
  (test_suite)
  (benchmark)
  (flag)
  (common)
  (source_repository)
  (custom_setup)
] @function.around

(library           properties: (_) @function.inside)
(foreign_library   properties: (_) @function.inside)
(executable        properties: (_) @function.inside)
(test_suite        properties: (_) @function.inside)
(benchmark         properties: (_) @function.inside)
(flag              properties: (_) @function.inside)
(common            properties: (_) @function.inside)
(source_repository properties: (_) @function.inside)
(custom_setup      properties: (_) @function.inside)

[(test_suite) (benchmark)] @test.around
(test_suite properties: (_) @test.inside)
(benchmark  properties: (_) @test.inside)

(field_value (module_name) @entry.around) @entry.inside
