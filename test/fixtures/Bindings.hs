{-# LANGUAGE BangPatterns #-}

-- Join points, letrec, and nested let, which the harvested corpus has few of.
module Bindings where

-- Becomes a joinrec.
sumList :: [Int] -> Int
sumList = go 0
  where
    go !acc [] = acc
    go !acc (x : xs) = go (acc + x) xs

-- Becomes a join point.
label :: Either Int Int -> Int
label e =
  case e of
    Left n -> finish (n + 1)
    Right n -> finish (n * 2)
  where
    finish y = y + length [1 .. y]

-- Becomes a letrec or joinrec group.
parity :: Int -> Bool
parity n = isEven n
  where
    isEven 0 = True
    isEven k = isOdd (k - 1)
    isOdd 0 = False
    isOdd k = isEven (k - 1)

poly :: Int -> Int
poly x =
  let a = x + 1
      b = a * a
      c = b + x
   in a + b + c
