# `@laikacms/starter-react-native-expo`

A **React Native + Expo Router** mobile app that consumes a deployed LaikaCMS backend over HTTP.
Different paradigm from every other starter — there is no LaikaCMS code on the device; the phone is
purely a client.

## Stack

- React Native 0.76 + React 18.3 + Expo SDK 52
- Expo Router (file-based routing) with typed routes
- Fetches `/posts` and `/posts/:slug` from any backend that exposes those public endpoints

## Backend pairing

Pair this app with one of the backend starters that has public `/posts*` routes:

- `apps/starter-hono-backend` — local Node dev (set `EXPO_PUBLIC_API_BASE=http://<LAN-IP>:3000`)
- `apps/starter-workers-r2` — Cloudflare Workers + R2, public URL works as-is
- `apps/starter-bun-backend` — Bun runtime
- AWS Lambda variant (`starter-lambda-blog` from the cloud routine)

The "shape" the app expects is documented in `app/api.ts`. Any backend that returns:

```json
{ "posts": [{ "key": "posts/hello", "content": { "title": "…" } }] }
```

for `GET /posts` and `{ "post": { "content": { "title": "…", "body": "…" } } }` for
`GET /posts/:slug` works.

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-react-native-expo start
# then press 'i' for iOS sim, 'a' for Android, 'w' for web
```

> ⚠ **LAN IP gotcha:** phones and simulators can't see `localhost` on your dev machine. Find your
> LAN IP (`ipconfig getifaddr en0` on macOS) and set `EXPO_PUBLIC_API_BASE=http://192.168.x.x:3000`
> before starting. For convenience use [ngrok](https://ngrok.com) or deploy the backend to
> Workers/Lambda for stable URLs.

## Layout

```
apps/starter-react-native-expo/
├── app.json                           # Expo config (typedRoutes enabled)
├── app/                               # Expo Router file-based routes
│   ├── _layout.tsx                    # SafeAreaProvider + Stack
│   ├── index.tsx                      # post list (FlatList)
│   ├── posts/[slug].tsx               # single post (ScrollView)
│   └── api.ts                         # fetch wrappers
└── tsconfig.json
```

## Why no LaikaCMS code on device

LaikaCMS uses `node:fs` (FileSystem repo) or platform bindings (R2). Neither runs in React Native's
Hermes JS engine. The phone is a pure HTTP client. Server-side rendering also doesn't apply — RN
does its own rendering with native components.

This makes the mobile pattern the **simplest possible** LaikaCMS integration: HTTP in, native UI
out. Same backend that powers your web blog can power your iOS/Android app.

## Production hardening

- Authenticate API requests with a real OAuth flow (Expo AuthSession) instead of relying on the
  public read endpoints.
- Cache responses on-device (e.g. with TanStack Query) — content rarely changes faster than the
  screen refreshes.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
