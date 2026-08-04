# LightBeam Web Encoder

Vite + React encoder for LBOP optical transmissions. File bytes stay on-device; optional Supabase catalog stores **metadata only** (hash, title, sizes).

## Local

```bash
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_* from Supabase dashboard
npm run dev
```

## Deploy

- **Production:** https://lightbeam-web-encoder.vercel.app  
- **Vercel project:** `lightbeam-web-encoder` (root `apps/web-encoder`)  
- **Supabase:** `lightbeam-satellite-demo` (`buxiaitqtaecobnshyzz`)  
- Table: `public.transmissions` (RLS on; anon read/insert for demo catalog)

```bash
vercel link --yes
vercel env pull .env.local --yes
vercel --prod --yes
```

## Env

| Key | Purpose |
|-----|---------|
| `VITE_SUPABASE_URL` | Supabase API URL |
| `VITE_SUPABASE_ANON_KEY` | Publishable/anon key (browser-safe) |
| `VITE_PUBLIC_APP_URL` | Canonical site URL |

Never put the service role key in the web app.
