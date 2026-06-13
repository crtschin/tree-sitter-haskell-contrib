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

; custom-setup has no name; tag with the section_type token.
(custom_setup (section_type) @name) @definition.section
