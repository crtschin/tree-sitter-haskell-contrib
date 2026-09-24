{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE FlexibleInstances #-}

-- Open, associated, and recursive closed type families, and a data family.
-- Each data-family instance gets its own tycon (R:Vec..), so Core prints axiom
-- applications.
module Families where

type family Elem c
type instance Elem [a] = a
type instance Elem (Maybe a) = a

-- A branched axiom.
type family Collapse a where
  Collapse [a] = Collapse a
  Collapse a = a

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

data family Vec a

data instance Vec Int = VInt [Int]

data instance Vec Bool = VBool [Bool]

sumVec :: Vec Int -> Int
sumVec (VInt xs) = sum xs

anyVec :: Vec Bool -> Bool
anyVec (VBool bs) = or bs
