# Calendar Ops

A scheduling workspace for tutoring teams, based on the open-source [Schedule-X](https://github.com/schedule-x/schedule-x) calendar library (v4.9.2 at fork baseline).

**Status:** MVP foundation in development. The original library and documentation remain available; the product lives separately in `platform/`.

## Product

- Administrator: invite tutors and students, view all lessons, filter by tutor, student or status, assign students to tutors, create and reschedule lessons.
- Tutor: manage lessons only with admin-assigned students; student: read-only access to their own lessons. Only admins create or assign students and configure tutor languages. Invitation codes are one-time, role-bound and expire after seven days.
- Visible lesson statuses: tentative (dashed, reserves the slot) and confirmed (blue). Past active lessons count by end time; deletion removes the booking from the UI and retains an internal cancellation record for audit. Historical no-show/cancelled entries remain in storage but are excluded from visible totals.
- Independent paid/unpaid tracking and optional manual receipt-received flag. Admins and assigned tutors edit; students read their own. No payment processing or receipt uploads.
- Trial lessons: violet background; both types default to 60 minutes. Quick 30/45/60/90-minute presets and custom end times.
- Tutor-managed date-specific availability; admin selects a tutor to see free intervals highlighted in the day/week calendar. Active lessons are subtracted; cancellation releases the slot. Scheduling outside declared availability remains allowed.
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

The JSON API is under `/api/v1/`: login, register, logout, me, users, students, assignments, invites, lessons, availability. Authentication uses HttpOnly SameSite=Lax session cookies; write requests require matching Origin and `X-Calendar-Client: 1`.

For deployment, configure HTTPS at a reverse proxy, `CALENDAR_ORIGIN` to the exact public origin, `CALENDAR_SECURE_COOKIE=1`, persistent storage at `CALENDAR_DB`, and strong owner credentials. Host binds to loopback by default; `HOST` and `PORT` override that. Back up SQLite before schema updates. Existing lessons migrate to regular/unpaid with receipt not marked; verify historical payments manually. No public registration, default accounts, or production deployment is enabled.

`/embed` exposes a same-origin, authenticated, read-only UI without the sidebar. Cross-origin embedding requires a future signed-token flow and explicit allowed origins; it is deliberately not enabled yet.

## Roadmap / limits

Single-school MVP, not yet multi-tenant SaaS. PostgreSQL migration, organization-scoped permissions, student unassignment, recurring lessons, recurring availability, notifications, OAuth/OIDC, external embed tokens and SDK, versioned offline write synchronization, invitation revocation, account recovery, expanded browser E2E and production hardening remain future work. The board is a chronological card view, not a freeform canvas.

See [platform implementation notes](platform/ARCHITECTURE.md).

## License

MIT. The original Schedule-X project is copyright Tom Österlund (2023–present). See [LICENSE](LICENSE), [upstream](https://github.com/schedule-x/schedule-x), and [Schedule-X docs](https://schedule-x.dev/).

## Workspace v2

Calendar-first interface with light/dark theme, `/calendar` full-screen view, separate statistics and help, collapsible availability, keyboard shortcuts (N/A), click/right-click/desktop range selection and current-time indicator. Create students in Participants without registration; admin can issue or revoke 30-day private schedule URLs or seven-day one-use activation links. No plaintext passwords are stored. Shared schedules omit payment details. Local password minimum is six characters; secure-cookie deployments require 12 for new credentials. Use long unique passwords even locally. Dependency audit workflow records full and runtime audit reports and proposes compatible lockfile updates; it does not automatically apply them.

## Student profiles and tutor languages

Admins add or edit private student descriptions (up to 2,000 characters), assign students, and select tutor languages at invitation time or on an existing tutor's card. Existing tutors need an explicit language assignment before creating new lessons. Tutors can read profiles of assigned students and their own lesson history/statistics. Lesson language is stored on the lesson and validated by the server, independently of the student's current subject. Old lesson titles remain available; their language is migrated from the student's subject at upgrade time. The lesson form uses a separate date picker, 24-hour start/end fields, 60-minute defaults for both lesson types, and mouse range selection. Elapsed lessons are inferred from the calendar, not verified attendance. The tab favicon is served at `/favicon.svg`.
