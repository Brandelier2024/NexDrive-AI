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
--   - Strict zero-access for anon and authenticated clients.
--   - All vector search, keyword search, and indexing operations are performed
--     server-side using the service_role key.
--   - Direct client access (SELECT/INSERT/UPDATE/DELETE) via anon key is blocked.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public and authenticated users can search onedrive items" ON onedrive_items;

-- With RLS enabled and no policies granted to anon or authenticated,
-- public REST requests are completely blocked from querying or modifying onedrive items.
-- Only server-side service-role access remains.


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
--   - Strict zero-access for anon and authenticated clients.
--   - Prevents exposure of sensitive delta_link tokens to unauthenticated clients.
--   - Only backend server (service_role) reads and updates sync state.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view sync status" ON sync_state;

-- With RLS enabled and no policies granted to anon or authenticated,
-- public REST requests cannot access sync_state or leak delta_link.
-- Only server-side service-role access remains.

-- ────────────────────────────────────────────────────────────
-- Verification Query
-- Run this to confirm RLS is active (rowsecurity = true) for all tables:
-- ────────────────────────────────────────────────────────────
SELECT 
  tablename, 
  rowsecurity AS rls_enabled 
FROM pg_tables 
WHERE schemaname = 'public';
