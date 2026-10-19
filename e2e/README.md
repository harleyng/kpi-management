# E2E — Playwright

Specs live in `e2e/specs/`, outside the Vitest glob (`src/**`), so the two runners never collide.
Playwright starts its own dev server on port **8182** (`--strictPort`), separate from `npm run dev` (8082).

```bash
npm run e2e:install      # once: download Chromium
npm run test:e2e:smoke   # @smoke — every menu route opens, no console errors, banner visible
npm run test:e2e         # everything
npm run test:e2e:report  # open the last HTML report
```

There is no database and no login: the app runs on the mock `DataGateway` and the simulated session.
From Phase 1.2 a spec resets the seed through the gateway at its start; from Phase 1.3 it switches
tenant/user/role through the top-bar switcher.

The main lifecycle scenario (plan §8.2) — HR creates cycle 2027 → … → switching to tenant "Demo Co"
shows no Syntra data — is written in Phase 4 as `lifecycle.spec.ts`, tagged `@regression`.
