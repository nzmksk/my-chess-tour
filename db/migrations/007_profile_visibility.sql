-- =============================================================================
-- Migration 007 — Profile Visibility Flags
-- MY Chess Tour
--
-- Adds per-player toggles controlling whether age (derived from date_of_birth)
-- and OKU status are shown on the public profile. Both default to false so the
-- information stays hidden until the player opts in.
--
-- Prerequisites: migration 001 must be applied first.
-- =============================================================================

ALTER TABLE player_profiles
  ADD COLUMN show_age boolean NOT NULL DEFAULT false,
  ADD COLUMN show_oku boolean NOT NULL DEFAULT false;
