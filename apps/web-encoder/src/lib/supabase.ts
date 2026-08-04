import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

/** Browser client — uses publishable/anon key only. Never put service_role in the web app. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export type TransmissionRow = {
  id: string;
  short_code: string;
  title: string;
  publisher_name: string;
  filename: string;
  mime_type: string;
  payload_hash: string;
  original_len: number;
  encoded_len: number;
  block_count: number;
  block_size: number;
  profile_id: string;
  language: string;
  description: string | null;
  created_at: string;
};

/**
 * Optionally publish transmission *metadata* (never the file bytes) to Supabase.
 * Receivers stay offline; this is for station catalogs / verification lookup only.
 */
export async function publishTransmissionMetadata(input: {
  shortCode: string;
  title: string;
  publisherName: string;
  filename: string;
  mimeType: string;
  payloadHash: string;
  originalLen: number;
  encodedLen: number;
  blockCount: number;
  blockSize: number;
  profileId: string;
  language: string;
  description?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured" };
  }
  const { data, error } = await supabase
    .from("transmissions")
    .insert({
      short_code: input.shortCode,
      title: input.title,
      publisher_name: input.publisherName,
      filename: input.filename,
      mime_type: input.mimeType,
      payload_hash: input.payloadHash,
      original_len: input.originalLen,
      encoded_len: input.encodedLen,
      block_count: input.blockCount,
      block_size: input.blockSize,
      profile_id: input.profileId,
      language: input.language,
      description: input.description ?? null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

export async function listRecentTransmissions(limit = 20): Promise<TransmissionRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("transmissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("listRecentTransmissions", error.message);
    return [];
  }
  return (data ?? []) as TransmissionRow[];
}
