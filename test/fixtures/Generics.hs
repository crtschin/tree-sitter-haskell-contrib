{-# LANGUAGE DeriveGeneric #-}

-- `deriving Generic` emits deeply nested M1, K1, :*:, :+:, and U1 constructors
-- and newtype coercions.
module Generics where

import GHC.Generics (Generic)

data Tree a
  = Leaf a
  | Branch (Tree a) (Tree a)
  deriving (Generic)

data Config = Config
  { width :: Int,
    height :: Int,
    enabled :: Bool
  }
  deriving (Generic)

data Dir = North | East | South | West
  deriving (Generic)
