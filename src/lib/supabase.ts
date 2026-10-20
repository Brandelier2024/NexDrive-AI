import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

/** Server-side Supabase client with service role key (full access) */
export function createServerSupabaseClient() {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });
}

/** Client-side Supabase client with anon key (RLS enforced) */
export function createBrowserSupabaseClient() {
  return createClient(config.supabase.url, config.supabase.anonKey);
}
