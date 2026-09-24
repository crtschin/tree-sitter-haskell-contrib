-- The -g3 cells print `src<...>` ticks, which the harvested corpus does not
-- have.
module Ticks where

area :: Double -> Double -> Double
area w h = w * h + margin
  where
    margin = 2 * (w + h)
