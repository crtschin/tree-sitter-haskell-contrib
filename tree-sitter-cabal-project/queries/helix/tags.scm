; Named stanzas.
(stanza header: (stanza_header (package_name) @name)) @definition.section
(stanza header: (stanza_header (repo_name)    @name)) @definition.section

; Keyword-only stanzas (source-repository-package, program-options,
; program-locations): match when the keyword is the only child of the header.
(stanza header: (stanza_header (keyword) @name .)) @definition.section
