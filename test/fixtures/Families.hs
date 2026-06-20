{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE FlexibleInstances #-}

-- Source for generated dump fixtures (see `just gen-corpus`). Goes past
-- Coerce.hs's single closed family: open and associated type families, a
-- recursive closed family, and a data family. Each data-family instance gets
-- its own representation tycon (R:Vec..), so Core prints family coercions
-- (axiom applications) the other fixtures never produce.
module Families where

-- Open type family with several instances.
type family Elem c
type instance Elem [a] = a
type instance Elem (Maybe a) = a

-- Closed type family with a recursive branch + catch-all: a branched axiom.
type family Collapse a where
  Collapse [a] = Collapse a
  Collapse a = a

-- Associated type family on a class, used by a method signature.
class Container c where
  type Item c
  empty :: c
  insert :: Item c -> c -> c

instance Container [a] where
  type Item [a] = a
  empty = []
  insert = (:)

fromList :: [a] -> [a]
fromList = foldr insert empty

-- Data family: each instance is a distinct representation tycon, so projecting
-- a field threads a family coercion through Core.
data family Vec a

data instance Vec Int = VInt [Int]

data instance Vec Bool = VBool [Bool]

sumVec :: Vec Int -> Int
sumVec (VInt xs) = sum xs

anyVec :: Vec Bool -> Bool
anyVec (VBool bs) = or bs
