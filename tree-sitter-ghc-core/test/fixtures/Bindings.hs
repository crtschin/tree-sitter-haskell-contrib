{-# LANGUAGE BangPatterns #-}

-- Source for generated Core fixtures (see `just gen-core-corpus`). Exercises
-- the binding forms the harvested testsuite corpus under-represents: join
-- points, letrec, and nested non-recursive let. Compiled at -O2 so the
-- simplifier actually produces them.
module Bindings where

-- Strict local recursive worker: becomes a joinrec under -O.
sumList :: [Int] -> Int
sumList = go 0
  where
    go !acc [] = acc
    go !acc (x : xs) = go (acc + x) xs

-- Shared tail continuation across case alternatives: becomes a join point.
label :: Either Int Int -> Int
label e =
  case e of
    Left n -> finish (n + 1)
    Right n -> finish (n * 2)
  where
    finish y = y + length [1 .. y]

-- Mutually recursive local bindings: become a letrec / joinrec group.
parity :: Int -> Bool
parity n = isEven n
  where
    isEven 0 = True
    isEven k = isOdd (k - 1)
    isOdd 0 = False
    isOdd k = isEven (k - 1)

-- Plain nested non-recursive let.
poly :: Int -> Int
poly x =
  let a = x + 1
      b = a * a
      c = b + x
   in a + b + c
