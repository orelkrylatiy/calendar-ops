# Calendar Ops architecture

## Decisions

Keep the Schedule-X fork intact as the calendar engine. Add an independent product directory rather than changing published package names or the upstream docs. Node.js is already the library toolchain and is consistent with the TutorFlow direction. Use SQLite for the single-instance MVP to avoid requiring PostgreSQL or Redis to run; plan a PostgreSQL-backed service before multi-school or multi-instance deployment.

The visual direction is monochrome, restrained geometry, ample whitespace, compact navigation, and responsive calendar/day layout. The board is date-grouped cards. This is a coded interpretation, not a pixel reproduction of a brand reference.

## Security boundary

The server is the authority for identity, invite roles and lesson writes. Students and tutors can only query lessons in which they participate; administrators manage all lessons and can assign students to tutors. Tutors can create or change only their own lessons with assigned students; assigning a student through an admin-created lesson is automatic. Tentative lessons reserve both participants’ time; cancelled lessons release it. Existing scheduled lessons migrate to confirmed, keeping IDs and audit history. Assignment removal is not yet exposed. One-time invite redemption and conflict detection run in SQLite write transactions. Audit changes are persisted, not yet exposed in UI. Sessions are stored as hashes and expire in 24 hours. No hardcoded production credentials. Login throttling is per process/IP, suitable only for local MVP; add trusted proxy rate limits and production security review before public launch.

Offline mode is read-only. Opt-in stores personal schedule data in browser localStorage, which is not encrypted against local users or same-origin scripts. Service worker caches only static resources. Logout clears snapshots; offline logout cannot revoke a remote session until online, so on shared devices offline caching must remain disabled. An offline snapshot may outlive access revocation until reconnect. No offline edits or automatic write replay.

## Next milestones

1. Extend browser E2E to offline, DST, access revocation, and failure scenarios (basic desktop/mobile and invitation smoke test included). Production deployment, monitoring, rate limits, secure recovery.
2. PostgreSQL + organizations/memberships, tenant isolation, tutor-level permissions, recurrence and availability; preserve the versioned API.
3. Signed, short-lived, audience-bound embed sessions, origin allowlist and explicit frame policy; integration contract and webhooks.
4. Offline edits only after versioning, idempotency, conflict-resolution and safe account switching are implemented.
