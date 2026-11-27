# Calendar Ops

A scheduling workspace for tutoring teams, based on the open-source [Schedule-X](https://github.com/schedule-x/schedule-x) calendar library (v4.9.2 at fork baseline).

**Status:** MVP foundation in development. The original library and documentation remain available; the product lives separately in `platform/`.

## Product

- Administrator: invite tutors and students, view all lessons, filter by tutor, create, reschedule, complete or cancel lessons.
- Tutor and student: sign in and view only their own lessons. Invitation codes are one-time, role-bound and expire after seven days.
- Schedule-X day/week/month/list calendar and a chronological board; responsive Russian UI.
- Optional offline read-only snapshot on a trusted device; no offline write synchronization.

## Local development

Requires Node.js 22.13+ for the platform (Node 22 recommended) and npm.

```bash
npm ci
npm --prefix platform run build
export CALENDAR_ADMIN_USER=owner
# choose your own strong password, at least 12 characters
read -rs -p "Admin password: " CALENDAR_ADMIN_PASSWORD; echo
export CALENDAR_ADMIN_PASSWORD
npm --prefix platform start
```

Open http://127.0.0.1:4173. The first run creates the owner in `platform/data/calendar.sqlite`. Bootstrap credentials are not used to overwrite an existing account. Do not commit the database or passwords.

For a new tutor/student, create an invitation as administrator, then share the code privately. The invitee chooses "У меня есть код" on the sign-in page.

## Architecture

`platform/server.mjs`: dependency-free Node HTTP API + SQLite, server-side role checks, scrypt passwords, hashed opaque sessions, transactional invitations and lesson conflict detection, audit records.

`platform/src/`: Vite frontend built on the forked Schedule-X source; board and admin controls are product-specific.

`platform/public/`: service worker and installable app manifest. API responses are never service-worker cached. Offline snapshots are opt-in, local-device readable, and cleared on logout or a confirmed invalid session. Do not enable on shared devices.

`packages/`: upstream calendar engine, plugins, and themes. `website/`: upstream docs/demo. Upstream MIT copyright and license are preserved.

## Checks

```bash
npm --prefix platform run check
npm --prefix platform run lint
npm --prefix platform test
npm --prefix platform run build
npm run test:unit:all
npm run lint:all
npm run lint:scss
```

Platform CI runs syntax checks, ESLint, HTTP integration tests, the production build, and desktop/mobile Cypress smoke tests. Existing library CI is separate.

## API and deployment

The JSON API is under `/api/v1/`: login, register, logout, me, users, invites, lessons. Authentication uses HttpOnly SameSite=Lax session cookies; write requests require matching Origin and `X-Calendar-Client: 1`.

For deployment, configure HTTPS at a reverse proxy, `CALENDAR_ORIGIN` to the exact public origin, `CALENDAR_SECURE_COOKIE=1`, persistent storage at `CALENDAR_DB`, and strong owner credentials. Host binds to loopback by default; `HOST` and `PORT` override that. Back up the SQLite database consistently. No public registration, default accounts, or production deployment is enabled.

`/embed` exposes a same-origin, authenticated, read-only UI without the sidebar. Cross-origin embedding requires a future signed-token flow and explicit allowed origins; it is deliberately not enabled yet.

## Roadmap / limits

Single-school MVP, not yet multi-tenant SaaS. PostgreSQL migration, organization-scoped permissions, recurring lessons, tutor availability, notifications, OAuth/OIDC, external embed tokens and SDK, versioned offline write synchronization, invitation revocation, account recovery, expanded browser E2E and production hardening remain future work. The board is a chronological card view, not a freeform canvas.

See [platform implementation notes](platform/ARCHITECTURE.md).

## License

MIT. The original Schedule-X project is copyright Tom Österlund (2023–present). See [LICENSE](LICENSE), [upstream](https://github.com/schedule-x/schedule-x), and [Schedule-X docs](https://schedule-x.dev/).
