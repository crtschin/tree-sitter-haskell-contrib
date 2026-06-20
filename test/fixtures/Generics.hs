{-# LANGUAGE DeriveGeneric #-}

-- Source for generated dump fixtures (see `just gen-corpus`). `deriving Generic`
-- emits a `Rep` type-family instance plus from/to methods assembled from the
-- generic representation constructors (M1, K1, :*:, :+:, U1). That is a dense
-- nested-constructor + newtype-coercion surface none of the other fixtures
-- reach.
module Generics where

import GHC.Generics (Generic)

-- Sum + recursive product: Rep is (:+:) over (:*:) of K1 references.
data Tree a
  = Leaf a
  | Branch (Tree a) (Tree a)
  deriving (Generic)

-- Record product: Rep wraps each field selector in its own M1 metadata layer.
data Config = Config
  { width :: Int,
    height :: Int,
    enabled :: Bool
  }
  deriving (Generic)

-- Enumeration: Rep is a (:+:) tree of U1 (no fields).
data Dir = North | East | South | West
  deriving (Generic)
