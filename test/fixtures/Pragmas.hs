{-# LANGUAGE BangPatterns #-}

-- Source for generated dump fixtures (see `just gen-corpus`). SPECIALIZE emits
-- specialised bindings ($sdotprod..) and the RULES that redirect to them;
-- INLINE/INLINABLE/NOINLINE annotate the unfolding in [IdInfo]; a hand-written
-- RULES pragma lands verbatim in the `Tidy Core rules` appendix (-ddump-rules),
-- which the grammar captures as coarse soup.
module Pragmas where

-- Polymorphic worker SPECIALIZEd at two types: each emits $sdotprod + a RULE.
dotprod :: (Num a) => [a] -> [a] -> a
dotprod = go 0
  where
    go !acc (a : as) (b : bs) = go (acc + a * b) as bs
    go !acc _ _ = acc

{-# SPECIALIZE dotprod :: [Int] -> [Int] -> Int #-}

{-# SPECIALIZE dotprod :: [Double] -> [Double] -> Double #-}

-- INLINE: forces the unfolding to be retained for inlining.
square :: Int -> Int
square x = x * x
{-# INLINE square #-}

-- INLINABLE: keeps the unfolding available without forcing it.
cube :: Int -> Int
cube x = x * square x
{-# INLINABLE cube #-}

-- NOINLINE: pins the binding so the RULE below has something to fire on.
opaque :: Int -> Int
opaque x = x + 1
{-# NOINLINE opaque #-}

-- Hand-written RULE: copied verbatim into the rules appendix.
{-# RULES "opaque/twice" forall x. opaque (opaque x) = x + 2 #-}

useAll :: Int -> Int
useAll n = cube (square (opaque n))
