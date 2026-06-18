# Solar Building Viewer

## Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env` and fill in your keys.

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_API_KEY` | Yes | Server-side: Google Solar API + Geocoding |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Yes | Client-side: Google Maps (satellite/3D view) |
| `OPENROUTER_API_KEY` | No | AI chatbot (OpenRouter) |

All three keys use the same Google API key if you have one key with Solar + Geocoding + Maps JavaScript APIs enabled.
