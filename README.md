# Campus Market

A mobile marketplace where students buy and sell with verified students from their own school, plus an open market anyone can join. See [PROPOSAL.md](PROPOSAL.md) for the idea and [docs/SPEC.md](docs/SPEC.md) for the full specification.

## Repository

```
apps/mobile/   Expo app (TypeScript, Expo Router, NativeWind)
supabase/      Supabase config, migrations, seed data, tests
docs/          Specification and implementation plan
```

## Prerequisites

- Node.js 22 LTS
- Docker Desktop (for the local Supabase stack)
- An Android emulator or phone with the development build below. Expo Go does not work: push notifications need native code it does not include.

## Run the app

Start the local backend first (see [Local backend](#local-backend)), then copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and fill in the key from `npx supabase status`.

Install the development build once, and again only when native dependencies or `app.json` change. It builds in EAS, which needs access to the team's Expo account; install the APK from the link it prints. With Android Studio, `npx expo run:android` builds it locally instead.

```bash
cd apps/mobile
npm ci
npx eas-cli build --profile development --platform android
```

Then start Metro and open the app in the development build:

```bash
npx expo start
```

Press `a` for the emulator, or scan the QR code with your phone. Sign in with any email; the code arrives in Mailpit.

## Checks

Pull requests run these in CI; run them before you push:

```bash
cd apps/mobile
npm run lint
npm run typecheck
npm run format:check
npm test
```

`npm run format` fixes formatting.

## Local backend

The app talks to a local Supabase stack. Start Docker Desktop first; the first start downloads a few GB of images.

```bash
npx supabase start
```

- Sign-in emails land in Mailpit at http://127.0.0.1:54324, so any address works locally.
- `npx supabase db reset` reapplies migrations and `supabase/seed.sql`.
- Database tests (pgTAP, in `supabase/tests/database`) run in CI; run them locally with `npx supabase test db`.

## Data credits

- ZIP codes: [GeoNames](https://www.geonames.org), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Disposable email domains: [disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains), CC0

## Contributing

- Branch from `main`, open a pull request, and wait for checks and a review. Nobody pushes to `main` directly.
- A pull request that changes behavior updates `docs/SPEC.md` in the same pull request.
- Add dependencies with `npx expo install <package>` so versions match the Expo SDK.
- Work is tracked by the task IDs in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
