import { createClient } from "@supabase/supabase-js";

// These are public (anonymously readable) keys inlined at build time.
// They are NOT secret — Supabase enforces Row Level Security server-side.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const isConfigured = Boolean(supabase);
