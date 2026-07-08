; Dispatch each dump section to the member grammar for its IL, keyed by the
; phase banner. The banner regexes are mutually exclusive, so at most one
; applies per section.
;
; Languages resolve at query/highlight time against installed parsers named
; ghc_core / ghc_stg / ghc_cmm (see each member's tree-sitter.json
; `injection-regex`).
;
; injection.content is the whole section (banner + body), not just the body:
;
;   - Every member grammar's source_file begins with an optional banner and is
;     validated standalone against banner-led dumps, so handing it the banner
;     lets it parse the surface it already covers.
;
;   - ghc_core routes a `Tidy Core rules` banner into its trailing-rules
;     section, which a bare body could not trigger.

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
