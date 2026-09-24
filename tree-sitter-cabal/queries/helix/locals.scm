; There is no @local.scope, so every flag lives in the file-root scope and
; resolves from any condition in the file.

(flag name: (section_name) @local.definition.variable)

(predicate_call
  fn: (identifier) @_fn
  arg: (predicate_arg (identifier) @local.reference)
  (#eq? @_fn "flag"))
