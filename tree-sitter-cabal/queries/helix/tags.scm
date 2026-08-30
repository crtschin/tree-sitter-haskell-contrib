; Sections as symbols for the picker.

(library          name: (section_name) @name) @definition.module
; Unnamed main library: tag with the section_type ("library") as the name.
((library !name (section_type) @name)) @definition.module
(foreign_library  name: (section_name) @name) @definition.module
(executable       name: (section_name) @name) @definition.function
(test_suite       name: (section_name) @name) @definition.function
(benchmark        name: (section_name) @name) @definition.function
(flag             name: (section_name) @name) @definition.constant
(common           name: (section_name) @name) @definition.section
(source_repository name: (section_name) @name) @definition.section

; custom-setup has no name, so tag with the section_type token.
(custom_setup (section_type) @name) @definition.section

; Tag every `signatures` entry, so a Backpack package's holes reach the symbol picker.
; Both node kinds appear here: a dotted name lexes as `module_name` and a single-segment
; one as `identifier`. The field name matches case-insensitively because the corpus
; carries `Signatures` as well as `signatures`. Tag queries are read match by match, so
; the collapse in Note [Later pattern wins] does not reach here.
((field
  name: (field_name) @_field
  value: (field_value [(identifier) (module_name)] @name)) @definition.module
  (#match? @_field "(?i)^signatures$"))
