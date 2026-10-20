-- ============================================================
-- Supabase Row Level Security (RLS) & Hardening Script
-- Project: OneDrive Media Locator AI Chatbot RAG
-- Execute this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/vxokinzsemnsimseqwei/sql/new
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Enable Row Level Security (RLS) on all public tables
-- ────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS onedrive_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sync_state ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- 2. onedrive_items Policies
-- Security Goal: 
--   - Allow search queries (SELECT) for authenticated employees & anon
--   - STRICTLY PREVENT any DELETE, UPDATE, or INSERT from the public anon key.
--   - Only backend server (service_role) can insert/update/delete records during sync/crawl.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public and authenticated users can search onedrive items" ON onedrive_items;
CREATE POLICY "Public and authenticated users can search onedrive items"
  ON onedrive_items
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT / UPDATE / DELETE policies are granted to anon or authenticated.
-- Supabase will automatically BLOCK any client-side deletion or tampering.


-- ────────────────────────────────────────────────────────────
-- 3. chat_messages Policies
-- Security Goal:
--   - Prevent users from reading or deleting each other's chat histories.
--   - All client-side direct access is restricted to the message owner.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can only read their own chat history" ON chat_messages;
CREATE POLICY "Users can only read their own chat history"
  ON chat_messages
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can only delete their own chat history" ON chat_messages;
CREATE POLICY "Users can only delete their own chat history"
  ON chat_messages
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- 4. users Table Policies
-- Security Goal:
--   - Block unauthorized users from dumping password hashes or user directories.
--   - Block public deletion of accounts via REST API.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Users can read own profile"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Password hashes, emails, and accounts cannot be read or deleted by anon.


-- ────────────────────────────────────────────────────────────
-- 5. email_verifications Policies (OTP Codes)
-- Security Goal:
--   - Strict zero-access for anon and authenticated clients.
--   - Only the server backend (service_role) can create and verify OTPs.
-- ────────────────────────────────────────────────────────────
-- By enabling RLS and defining NO policies for anon or authenticated,
-- public REST requests are completely blocked from reading verification OTPs.


-- ────────────────────────────────────────────────────────────
-- 6. sync_state Policies
-- Security Goal:
--   - Read-only access to view last synchronization time and status.
--   - Only backend sync runner can mutate the delta link or sync timestamps.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view sync status" ON sync_state;
CREATE POLICY "Anyone can view sync status"
  ON sync_state
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ────────────────────────────────────────────────────────────
-- Verification Query
-- Run this to confirm RLS is active (rowsecurity = true) for all tables:
-- ────────────────────────────────────────────────────────────
SELECT 
  tablename, 
  rowsecurity AS rls_enabled 
FROM pg_tables 
WHERE schemaname = 'public';
