-- ============================================================
-- Supabase Schema: OneDrive Media Locator RAG App
-- Run this SQL in your Supabase SQL Editor
-- ============================================================

-- Enable pgvector extension (for later vector indexing phases)
CREATE EXTENSION IF NOT EXISTS vector;

-- ────────────────────────────────────────────────
-- 1. Users table (for credentials auth)
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,  -- NULL for SSO-only users
  avatar_url TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'credentials',  -- 'credentials' | 'azure-ad'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ────────────────────────────────────────────────
-- 1b. Email verification OTP codes (Sign-up authorization)
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  code TEXT NOT NULL,
  attempts INT DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE IF EXISTS email_verifications ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);

-- ────────────────────────────────────────────────
-- 2. OneDrive media metadata (Phase 2+)
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onedrive_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id TEXT UNIQUE NOT NULL,           -- Microsoft Graph item ID
  record_type TEXT NOT NULL,              -- 'folder' | 'image' | 'video'
  name TEXT NOT NULL,
  file_web_url TEXT,                      -- Direct OneDrive link to file
  parent_folder_id TEXT,
  parent_folder_name TEXT,
  folder_path TEXT,                       -- Human-readable breadcrumb path
  folder_web_url TEXT,                    -- Direct OneDrive link to parent folder
  thumbnail_url TEXT,
  media_type TEXT,
  visual_summary TEXT,
  visual_tags TEXT,
  last_modified TIMESTAMPTZ,
  embedding vector(768),                  -- Gemini embedding dimension
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for search and lookups
CREATE INDEX IF NOT EXISTS idx_onedrive_items_item_id ON onedrive_items(item_id);
CREATE INDEX IF NOT EXISTS idx_onedrive_items_record_type ON onedrive_items(record_type);
CREATE INDEX IF NOT EXISTS idx_onedrive_items_folder_path ON onedrive_items(folder_path);

-- ────────────────────────────────────────────────
-- 3. Chat history (Phase 4)
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,                     -- 'user' | 'assistant'
  content TEXT NOT NULL,
  folder_cards JSONB,                     -- Structured folder card data
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_session ON chat_messages(user_id, session_id);

-- ────────────────────────────────────────────────
-- 4. Delta sync state
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  delta_link TEXT,
  last_sync_at TIMESTAMPTZ,
  items_synced INTEGER DEFAULT 0
);

-- Seed the sync state row
INSERT INTO sync_state (id) VALUES ('default') ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────
-- 5. Vector Similarity Search Function (Phase 3+)
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_onedrive_items (
  query_embedding vector(768),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  item_id text,
  record_type text,
  name text,
  file_web_url text,
  parent_folder_id text,
  parent_folder_name text,
  folder_path text,
  folder_web_url text,
  thumbnail_url text,
  media_type text,
  visual_summary text,
  visual_tags text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    item_id,
    record_type,
    name,
    file_web_url,
    parent_folder_id,
    parent_folder_name,
    folder_path,
    folder_web_url,
    thumbnail_url,
    media_type,
    visual_summary,
    visual_tags,
    (1 - (onedrive_items.embedding <=> query_embedding))::float AS similarity
  FROM onedrive_items
  WHERE onedrive_items.embedding IS NOT NULL
    AND 1 - (onedrive_items.embedding <=> query_embedding) > match_threshold
  ORDER BY onedrive_items.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ────────────────────────────────────────────────
-- 6. Row Level Security (RLS) Policies
-- ────────────────────────────────────────────────
ALTER TABLE IF EXISTS onedrive_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sync_state ENABLE ROW LEVEL SECURITY;

-- onedrive_items: Access restricted to server-side service_role (search & crawler)
DROP POLICY IF EXISTS "Public and authenticated users can search onedrive items" ON onedrive_items;

-- chat_messages: Users can only read and delete their own messages
DROP POLICY IF EXISTS "Users can only read their own chat history" ON chat_messages;
CREATE POLICY "Users can only read their own chat history"
  ON chat_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can only delete their own chat history" ON chat_messages;
CREATE POLICY "Users can only delete their own chat history"
  ON chat_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- users: Users can only read their own profile row
DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT TO authenticated USING (auth.uid() = id);

-- sync_state: Access restricted to server-side service_role (sync runner, delta_link protected)
DROP POLICY IF EXISTS "Anyone can view sync status" ON sync_state;


