; The banner regexes are mutually exclusive, so at most one pattern matches a
; section. Each language name matches the `injection-regex` of its member.
;
; The injected range is the whole section, banner included:
;
;   - Each member grammar parses banner-led dumps standalone.
;
;   - ghc_core needs a `Tidy Core rules` banner to open its trailing rules
;     section.

((section
   (banner) @_banner) @injection.content
 (#match? @_banner "(Tidy Core|Desugar|CorePrep|Core)")
 (#set! injection.language "ghc_core"))

((section
   (banner) @_banner) @injection.content
 (#match? @_banner "STG")
 (#set! injection.language "ghc_stg"))

((section
   (banner) @_banner) @injection.content
 (#match? @_banner "Cmm")
 (#set! injection.language "ghc_cmm"))
