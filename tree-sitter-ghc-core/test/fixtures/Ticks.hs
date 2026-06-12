-- Source for a generated Core fixture (see `just gen-core-corpus`). Compiled
-- with -g3 so the simplifier keeps SourceNotes, which print as `src<...>`
-- ticks in the Core dump -- a construct absent from the harvested corpus.
module Ticks where

area :: Double -> Double -> Double
area w h = w * h + margin
  where
    margin = 2 * (w + h)
