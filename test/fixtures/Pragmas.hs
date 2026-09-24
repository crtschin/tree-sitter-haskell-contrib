{-# LANGUAGE BangPatterns #-}

-- SPECIALIZE gives $s bindings and their rules. The inline pragmas mark the
-- unfolding in [IdInfo]. The RULES pragma goes into the `Tidy Core rules`
-- appendix.
module Pragmas where

dotprod :: (Num a) => [a] -> [a] -> a
dotprod = go 0
  where
    go !acc (a : as) (b : bs) = go (acc + a * b) as bs
    go !acc _ _ = acc

{-# SPECIALIZE dotprod :: [Int] -> [Int] -> Int #-}

{-# SPECIALIZE dotprod :: [Double] -> [Double] -> Double #-}

square :: Int -> Int
square x = x * x
{-# INLINE square #-}

cube :: Int -> Int
cube x = x * square x
{-# INLINABLE cube #-}

-- NOINLINE keeps a call for the rule to fire on.
opaque :: Int -> Int
opaque x = x + 1
{-# NOINLINE opaque #-}

{-# RULES "opaque/twice" forall x. opaque (opaque x) = x + 2 #-}

useAll :: Int -> Int
useAll n = cube (square (opaque n))
