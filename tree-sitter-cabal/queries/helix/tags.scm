(library          name: (section_name) @name) @definition.module
((library !name (section_type) @name)) @definition.module
(foreign_library  name: (section_name) @name) @definition.module
(executable       name: (section_name) @name) @definition.function
(test_suite       name: (section_name) @name) @definition.function
(benchmark        name: (section_name) @name) @definition.function
(flag             name: (section_name) @name) @definition.constant
(common           name: (section_name) @name) @definition.section
(source_repository name: (section_name) @name) @definition.section

(custom_setup (section_type) @name) @definition.section

; Tag each `signatures` entry, so Backpack holes reach the symbol picker. A
; dotted name lexes as `module_name` and a single segment as `identifier`. The
; corpus also has `Signatures`, so the match ignores case. Tag queries read match
; by match, so Note [Later pattern wins] does not apply.
((field
  name: (field_name) @_field
  value: (field_value [(identifier) (module_name)] @name)) @definition.module
  (#match? @_field "(?i)^signatures$"))
