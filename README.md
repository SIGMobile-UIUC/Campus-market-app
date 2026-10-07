# Campus Market

A mobile marketplace where students buy and sell with verified students from their own school, plus an open market anyone can join. See [PROPOSAL.md](PROPOSAL.md) for the idea and [docs/SPEC.md](docs/SPEC.md) for the full specification.

## Repository

```
apps/mobile/   Expo app (TypeScript, Expo Router, NativeWind)
supabase/      Supabase config, migrations, Edge Functions, tests
docs/          Specification and implementation plan
```

## Prerequisites

- Node.js 22 LTS
- Docker Desktop (for the local Supabase stack, from M1)
- Expo Go (SDK 57) on a phone, or an Android emulator. A development build replaces Expo Go once we add a native module Expo Go does not include.

## Run the app

```bash
cd apps/mobile
npm ci
npx expo start
```

Press `a` for Android, or scan the QR code with your phone.

## Checks

Pull requests run these in CI; run them before you push:

```bash
cd apps/mobile
npm run lint
npm run typecheck
npm run format:check
```

`npm run format` fixes formatting.

## Local backend

From M1 the app talks to a local Supabase stack:

```bash
npx supabase start
```

## Contributing

- Branch from `main`, open a pull request, and wait for checks and a review. Nobody pushes to `main` directly.
- A pull request that changes behavior updates `docs/SPEC.md` in the same pull request.
- Add dependencies with `npx expo install <package>` so versions match the Expo SDK.
- Work is tracked by the task IDs in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
