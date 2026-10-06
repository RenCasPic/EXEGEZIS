/*
 * The tables and functions of supabase/migrations, in the shape
 * `supabase gen types typescript` produces: the store's queries are checked
 * against them. Keep it in step with the migrations.
 */

type Table<Row, Insert, Update> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export type ProfileRow = {
  id: string;
  display_name: string;
  locale: string;
  theme: string;
  plan: string;
  terms_version: string | null;
  privacy_version: string | null;
  terms_accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RunRecord = {
  id: string;
  user_id: string;
  kind: string;
  target_url: string;
  site: string;
  status: string;
  pages_requested: number | null;
  ai_usd: number;
  project_id: string | null;
  created_at: string;
  finished_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, Partial<ProfileRow> & { id: string }, Partial<ProfileRow>>;
      consents: Table<{ id: number; user_id: string; document: string; version: string; accepted_at: string }, { user_id: string; document: string; version: string; accepted_at?: string }, Partial<{ document: string; version: string }>>;
      projects: Table<{ id: string; user_id: string; name: string; created_at: string }, { id?: string; user_id?: string; name: string; created_at?: string }, Partial<{ name: string }>>;
      runs: Table<RunRecord, Partial<RunRecord> & { id: string; kind: string; target_url: string; site: string }, Partial<RunRecord>>;
      waitlist: Table<{ id: number; user_id: string; email: string; plan: string; created_at: string }, { user_id?: string; email: string; plan: string; created_at?: string }, Partial<{ email: string; plan: string }>>;
      site_verifications: Table<
        { id: string; user_id: string; site: string; token: string; method: string | null; verified_at: string | null; created_at: string },
        { user_id?: string; site: string; token: string },
        Partial<{ method: string | null; verified_at: string | null }>
      >;
      rate_limits: Table<{ key: string; window_start: string; hits: number }, { key: string; window_start: string; hits: number }, Partial<{ window_start: string; hits: number }>>;
    };
    Views: { [_ in never]: never };
    Functions: {
      accept_legal: { Args: { terms_version: string; privacy_version: string }; Returns: undefined };
      ai_spent_since: { Args: { p_since: string }; Returns: number };
      consume_rate_limit: { Args: { p_key: string; p_limit: number; p_window_seconds: number }; Returns: { allowed: boolean; retry_after_seconds: number }[] };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
