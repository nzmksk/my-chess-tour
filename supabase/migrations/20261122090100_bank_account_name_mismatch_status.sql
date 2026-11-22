-- =============================================
-- #374: a payout account CHIP Send verified, but in a holder name that doesn't
-- match who the money is for. Not payable until an admin confirms it
-- (20261122090200_bank_holder_name_match.sql).
--
-- On its own because a new enum value can't be used in the transaction that
-- adds it, and the CLI runs each migration file in one transaction.
-- =============================================
ALTER TYPE bank_account_status ADD VALUE IF NOT EXISTS 'name_mismatch';
