-- Metadata-only catalog for LightBeam transmissions (never stores file bytes).
create table if not exists public.transmissions (
  id uuid primary key default gen_random_uuid(),
  short_code text not null,
  title text not null,
  publisher_name text not null,
  filename text not null,
  mime_type text not null default 'application/octet-stream',
  payload_hash text not null,
  original_len integer not null check (original_len >= 0),
  encoded_len integer not null check (encoded_len >= 0),
  block_count integer not null check (block_count > 0),
  block_size integer not null check (block_size > 0),
  profile_id text not null,
  language text not null default 'en',
  description text,
  created_at timestamptz not null default now()
);

create index if not exists transmissions_created_at_idx on public.transmissions (created_at desc);
create index if not exists transmissions_short_code_idx on public.transmissions (short_code);
create index if not exists transmissions_payload_hash_idx on public.transmissions (payload_hash);

alter table public.transmissions enable row level security;

drop policy if exists "transmissions_public_read" on public.transmissions;
create policy "transmissions_public_read"
  on public.transmissions
  for select
  to anon, authenticated
  using (true);

drop policy if exists "transmissions_anon_insert" on public.transmissions;
create policy "transmissions_anon_insert"
  on public.transmissions
  for insert
  to anon, authenticated
  with check (true);
