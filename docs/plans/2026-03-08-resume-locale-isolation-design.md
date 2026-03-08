# Resume Profile Locale Isolation

## Problem

When switching to Chinese mode, the resume form pre-fills English profile data. There is no concept of per-locale resume profiles — one global active pointer serves all locales.

## Decision

Approach 1: Composite PK on `ActiveResumeProfile` with full locale isolation at the database level.

## Database

### ActiveResumeProfile — composite PK

```prisma
model ActiveResumeProfile {
  userId          String        @db.Uuid
  locale          String        @default("en-AU")  // "en-AU" | "zh-CN"
  resumeProfileId String        @db.Uuid
  resumeProfile   ResumeProfile @relation(...)
  user            User          @relation(...)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@id([userId, locale])
  @@index([resumeProfileId])
}
```

### ResumeProfile — add locale index

```prisma
@@index([userId, locale, updatedAt])
```

### Migration

1. Add `locale` column to `ActiveResumeProfile` with default `"en-AU"`.
2. Change PK from `userId` to `@@id([userId, locale])`.
3. Existing rows become `locale = "en-AU"` — no data loss.

## Server (`lib/server/resumeProfile.ts`)

All functions gain a `locale` parameter. Every query is scoped by `(userId, locale)`.

| Function | Change |
|---|---|
| `ensureActivePointer(userId, locale, profileId)` | upsert where `{ userId_locale: { userId, locale } }` |
| `getFallbackLatestProfile(userId, locale)` | findFirst `where: { userId, locale }` |
| `listResumeProfiles(userId, locale)` | findMany `where: { userId, locale }`; active pointer query scoped by locale |
| `getResumeProfile(userId, { profileId?, locale })` | active pointer lookup by `(userId, locale)`; fallback scoped by locale |
| `setActiveResumeProfile(userId, locale, profileId)` | validate target profile locale matches; upsert composite key |
| `createResumeProfile(userId, { locale, ... })` | write `locale` on create; copy-source limited to same locale |
| `deleteResumeProfile(userId, locale, profileId)` | count only same-locale profiles for "last profile" guard |
| `upsertResumeProfile(userId, data, { locale, ... })` | write `locale` on create; getResumeProfile scoped by locale |

### Rules

- No cross-locale operations: cannot activate an EN profile as ZH active, cannot copy from EN to ZH.
- "Last profile" guard is per-locale: deleting an EN profile while only 1 EN profile left is blocked, even if ZH profiles exist.

## API (`app/api/resume-profile/route.ts`)

### Locale transmission

- **GET** — query param: `/api/resume-profile?locale=zh-CN`
- **POST** — body field: `{ locale: "zh-CN", ... }`
- **PATCH** — body field per action: `{ action: "create", locale: "zh-CN", ... }`

### Validation

```ts
locale: z.enum(["en-AU", "zh-CN"]).optional().default("en-AU")
```

### `buildResumeProfileResponse(userId, locale)`

Passes locale to `listResumeProfiles` and `getResumeProfile`. Returns only profiles and active pointer for the requested locale.

## Downstream consumers

| Route | Change |
|---|---|
| `api/resume-pdf` | Already detects locale from profile record — pass locale to `getResumeProfile` |
| `api/applications/generate` | Derive locale from `job.market` (`CN` → `zh-CN`, `AU` → `en-AU`) |
| `api/applications/prompt` | Same — derive from `job.market` |
| `api/applications/manual-generate` | Same — derive from `job.market` |

## Client (`components/resume/ResumeForm.tsx`)

### Requests include locale

- Load: `fetch(\`/api/resume-profile?locale=${locale}\`)`
- Save (POST): `body: { ...payload, locale }`
- Version ops (PATCH): `body: { action, locale, ... }`

### Locale change triggers reload

```ts
useEffect(() => {
  const load = async () => {
    const res = await fetch(`/api/resume-profile?locale=${locale}`);
    const json = await res.json();
    hydrateFromResumeApi(json);
  };
  load();
}, [locale, hydrateFromResumeApi]);
```

### First time in Chinese mode

- API returns empty list (no ZH profiles yet).
- Form shows blank — no pre-fill from EN data.
- First save creates `locale: "zh-CN"` profile.

### Unchanged

- Version management UI (create/delete/switch).
- Form interaction (step navigation, preview, save).
- CN-specific fields (photo, gender, etc.) still gated by `locale === "zh-CN"`.

## Testing

| Type | Coverage |
|---|---|
| Server unit | `listResumeProfiles` returns only matching locale profiles |
| Server unit | `createResumeProfile` writes correct locale |
| Server unit | `deleteResumeProfile` isolates count by locale |
| Server unit | `setActiveResumeProfile` rejects cross-locale activation |
| API integration | GET/POST/PATCH correctly pass and use locale |
| Client | Locale switch triggers reload with correct locale param |
| Migration | Existing data migrated with `locale = "en-AU"`, active pointer intact |
