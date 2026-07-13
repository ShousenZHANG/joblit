# Open Free Self-Service Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Joblit's invitation approval system so every valid Google or GitHub OAuth user can create a free account immediately, while preserving authentication, private per-user data isolation, internal worker authorization, and production-quality bilingual UX.

**Architecture:** NextAuth keeps its Prisma adapter, database sessions, OAuth providers, hardened cookie configuration, and session user ID; only the custom invite `signIn` callback and invite-admin session field disappear. The obsolete request/admin chain is deleted end-to-end and removed with a forward-only PostgreSQL migration. Marketing CTAs route directly to `/login`, while the Login page uses a small tested error-mapping helper for accessible OAuth recovery.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, NextAuth 4, Prisma 7/PostgreSQL, next-intl, Tailwind CSS 4, Framer Motion, Vitest, Testing Library.

## Global Constraints

- Any valid Google or GitHub OAuth user can create or reuse an account without an allowlist, invitation request, or manual approval.
- Authentication, database sessions, `session.user.id`, protected-page redirects, API 401 behavior, and every `userId` ownership filter must remain.
- The unrelated secret-protected `/api/admin/import`, `IMPORT_SECRET`, `FETCH_RUN_SECRET`, `CRON_SECRET`, rate limits, and abuse controls must remain.
- `AccessRequest` and `AccessRequestStatus` must be removed with a new forward migration; previously applied migration files are immutable.
- Existing Joblit brand tokens and information architecture remain; do not replace them with a new palette or unrelated visual redesign.
- Unauthenticated and loading marketing CTAs go directly to `/login`; authenticated CTAs go to `/jobs`.
- Login errors must use `role="alert"`, explain a recovery path, keep both provider buttons available, and respect reduced motion.
- English and Chinese copy must say the product is free and open to everyone, without promising “free forever”.
- No generated artifacts, secrets, `.env` files, personal metadata, or unrelated changes may be committed.
- Work directly on `master` as explicitly authorized by the user, with task-level test-first commits and independent reviews.

---

### Task 1: Open OAuth Authentication and Remove Invite-Admin Session State

**Files:**
- Create: `test/authOptions.test.ts`
- Modify: `auth.ts`
- Modify: `types/next-auth.d.ts`
- Modify: `components/app-shell/AppNav.tsx`
- Modify: `components/app-shell/AppNav.test.tsx`

**Interfaces:**
- Consumes: NextAuth `authOptions`, Prisma adapter, the existing `Session.user.id` augmentation, and the existing five-link application navigation.
- Produces: open provider authentication with no `callbacks.signIn`; a session callback that writes only `session.user.id`; application navigation with exactly the five product links.

- [ ] **Step 1: Write failing authentication and navigation tests**

Create `test/authOptions.test.ts` with a real configuration assertion and callback behavior:

```ts
import { describe, expect, it } from "vitest";
import { authOptions } from "../auth";

describe("open self-service auth configuration", () => {
  it("does not install a product-specific sign-in gate", () => {
    expect(authOptions.callbacks?.signIn).toBeUndefined();
  });

  it("keeps the database user id private-session contract without admin state", async () => {
    const callback = authOptions.callbacks?.session;
    expect(callback).toBeTypeOf("function");
    const session = { expires: "2099-01-01", user: { id: "", email: "new@example.com" } };
    const user = { id: "user-1", email: "new@example.com" };
    const result = await callback!({ session, user } as never);
    expect(result.user).toMatchObject({ id: "user-1", email: "new@example.com" });
    expect(result.user).not.toHaveProperty("isAdmin");
  });
});
```

Add an `AppNav` regression assertion that neither desktop nor mobile navigation contains `/admin/access`, while the five existing links remain.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npx vitest run test/authOptions.test.ts components/app-shell/AppNav.test.tsx
```

Expected: the auth test fails because `callbacks.signIn` exists and the session result contains `isAdmin`.

- [ ] **Step 3: Remove only the invitation gate and invite-admin state**

In `auth.ts`, remove both invitation imports, replace the invite-specific `pages` comment with a generic branded-auth comment, and use:

```ts
callbacks: {
  session({ session, user }) {
    if (session.user) {
      session.user.id = user.id;
    }
    return session;
  },
},
```

Remove `isAdmin?: boolean` from `types/next-auth.d.ts`. In `AppNav.tsx`, delete the `isAdmin` lookup, `allLinks` construction, and Admin Access link; render the existing `links` array in desktop and mobile navigation.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 1 Vitest command again. Expected: both files pass with no invitation database mocks or admin navigation state.

- [ ] **Step 5: Commit Task 1**

```powershell
git add auth.ts types/next-auth.d.ts components/app-shell/AppNav.tsx components/app-shell/AppNav.test.tsx test/authOptions.test.ts
git commit -m "feat(auth): open OAuth self-service access"
```

---

### Task 2: Delete the Invitation Backend and Drop Its Database Objects

**Files:**
- Create: `test/openAccessArchitecture.test.ts`
- Create: `prisma/migrations/20260713000000_drop_access_request/migration.sql`
- Modify: `prisma/schema.prisma`
- Delete: `lib/server/access/accessRequestService.ts`
- Delete: `lib/server/auth/adminAccess.ts`
- Delete: `app/api/access-requests/route.ts`
- Delete: `app/api/admin/access-requests/route.ts`
- Delete: `app/api/admin/access-requests/[id]/route.ts`
- Delete: `app/(app)/admin/access/page.tsx`
- Delete: `app/(app)/admin/access/AdminAccessClient.tsx`
- Delete: `test/server/accessRequestService.test.ts`

**Interfaces:**
- Consumes: the Task 1 guarantee that sign-in no longer imports the invitation service.
- Produces: no invitation runtime surface and a replay-safe Prisma migration that removes the obsolete table and enum.

- [ ] **Step 1: Add a failing repository architecture contract**

Create `test/openAccessArchitecture.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const invitePaths = [
  "lib/server/access/accessRequestService.ts",
  "lib/server/auth/adminAccess.ts",
  "app/api/access-requests/route.ts",
  "app/api/admin/access-requests/route.ts",
  "app/api/admin/access-requests/[id]/route.ts",
  "app/(app)/admin/access/page.tsx",
  "app/(app)/admin/access/AdminAccessClient.tsx",
];

describe("open-access architecture", () => {
  it("contains no invitation request runtime", () => {
    for (const path of invitePaths) expect(existsSync(resolve(root, path))).toBe(false);
  });

  it("removes invitation objects through a forward migration", () => {
    const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
    const migration = readFileSync(
      resolve(root, "prisma/migrations/20260713000000_drop_access_request/migration.sql"),
      "utf8",
    );
    expect(schema).not.toMatch(/\bAccessRequest(?:Status)?\b/);
    expect(migration).toContain('DROP TABLE IF EXISTS "AccessRequest";');
    expect(migration).toContain('DROP TYPE IF EXISTS "AccessRequestStatus";');
    expect(migration.indexOf("DROP TABLE")).toBeLessThan(migration.indexOf("DROP TYPE"));
  });
});
```

- [ ] **Step 2: Run the architecture test and verify RED**

Run `npx vitest run test/openAccessArchitecture.test.ts`. Expected: both tests fail because the runtime files/schema objects exist and the new migration does not.

- [ ] **Step 3: Delete the runtime and add the forward migration**

Delete the listed files and remove the `AccessRequestStatus` enum and `AccessRequest` model from `prisma/schema.prisma`. Add exactly:

```sql
-- The invite approval workflow has been retired in favor of open OAuth sign-in.
DROP TABLE IF EXISTS "AccessRequest";
DROP TYPE IF EXISTS "AccessRequestStatus";
```

Do not change `prisma/migrations/20260607000000_add_access_request/migration.sql` or any older migration.

- [ ] **Step 4: Validate schema, generate the client, and verify GREEN**

Run:

```powershell
npx prisma validate
npx prisma generate
npx vitest run test/openAccessArchitecture.test.ts
```

Expected: valid schema, generated client succeeds, architecture tests pass.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -A prisma lib/server/access lib/server/auth/adminAccess.ts app/api/access-requests app/api/admin/access-requests 'app/(app)/admin/access' test/server/accessRequestService.test.ts test/openAccessArchitecture.test.ts
git commit -m "refactor(access): remove invitation approval system"
```

---

### Task 3: Route Marketing Directly to Free Self-Service Sign-In

**Files:**
- Modify: `components/landing/lib/useCtaHref.test.tsx`
- Modify: `components/landing/Nav.test.tsx`
- Modify: `app/(marketing)/page.test.tsx`
- Modify: `test/landingMessages.test.ts`
- Modify: `components/landing/lib/useCtaHref.ts`
- Modify: `components/landing/Nav.tsx`
- Modify: `components/landing/Hero.tsx`
- Modify: `components/landing/Cta.tsx`
- Modify: `app/(marketing)/page.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`
- Delete: `components/landing/Access.tsx`
- Delete: `components/landing/Access.test.tsx`

**Interfaces:**
- Consumes: `useSession` status and existing product/How/FAQ section anchors.
- Produces: authenticated CTA `/jobs`; unauthenticated/loading CTA `/login`; eight landing sections; bilingual open-free copy with no invitation request UI.

- [ ] **Step 1: Change expectations first**

Update `useCtaHref.test.tsx` so `loading` expects `/login`. Update `Nav.test.tsx` so the loading CTA is focusable and links to `/login`, and assert no `#access` link exists. Update the marketing page test to expect eight sections and no `landing-access` section.

Extend `test/landingMessages.test.ts` with a recursive copy assertion:

```ts
it.each([
  ["en", en.landing],
  ["zh", zh.landing],
] as const)("contains no retired invitation language in %s", (_locale, landing) => {
  const copy = JSON.stringify(landing).toLowerCase();
  for (const phrase of [
    "invite-only",
    "request access",
    "manual approval",
    "邀请制",
    "申请使用",
    "人工审批",
  ]) expect(copy).not.toContain(phrase);
});
```

- [ ] **Step 2: Run the marketing tests and verify RED**

Run:

```powershell
npx vitest run components/landing/lib/useCtaHref.test.tsx components/landing/Nav.test.tsx 'app/(marketing)/page.test.tsx' test/landingMessages.test.ts
```

Expected: failures reference `#access`, the ninth Access section, or retired invitation copy.

- [ ] **Step 3: Implement direct CTA routing and remove the form**

Make `useCtaHref` return `/jobs` only for authenticated status and `/login` otherwise. Make `Nav` use `useCtaHref`, remove the Access anchor from desktop/mobile links, and keep `next/link` for `/login` navigation. In Hero and Cta use the hook's `href` directly without rewriting `/login` to `#access`.

Delete `Access.tsx` and its test, and remove its import/render from the marketing page. Preserve existing section spacing, motion primitives, focus rings, 44px mobile targets, and reduced-motion handling.

Update English and Chinese messages:

```text
EN hero meta: Free for everyone · No credit card · Google or GitHub sign-in
ZH hero meta: 所有人免费开放 · 无需信用卡 · Google 或 GitHub 登录
EN FAQ: Yes — every Joblit feature is free for every signed-in user. No invitation, approval, subscription, or credit card is required.
ZH FAQ: 是的，Joblit 所有功能均向每位登录用户免费开放，无需邀请、审批、订阅或信用卡。
EN CTA: Free for everyone, with no credit card. Sign in with Google or GitHub, add your profile once, and reuse it across discovery, tailoring, and applications.
ZH CTA: 面向所有人免费开放，无需信用卡。使用 Google 或 GitHub 登录，一次维护档案，即可贯穿岗位发现、材料定制与申请流程。
```

Remove the unused `landing.nav.access` and entire `landing.access` namespace from both locales while maintaining identical locale key shapes.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 3 command again. Expected: all tests pass in English and Chinese with no `#access` target.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -A components/landing 'app/(marketing)/page.tsx' 'app/(marketing)/page.test.tsx' messages test/landingMessages.test.ts
git commit -m "feat(landing): launch direct free sign-in"
```

---

### Task 4: Make Login Self-Service, Accessible, and Recoverable

**Files:**
- Create: `app/(auth)/login/authError.ts`
- Create: `app/(auth)/login/authError.test.ts`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

**Interfaces:**
- Consumes: NextAuth `error` and `callbackUrl` search parameters.
- Produces: safe local callback paths and one of `accessDeniedError`, `accountNotLinkedError`, or `genericError`, displayed in an accessible alert without hiding provider buttons.

- [ ] **Step 1: Write failing helper tests**

Create `authError.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getLoginErrorKey, getSafeCallbackUrl } from "./authError";

describe("login recovery", () => {
  it.each([
    [null, null],
    ["AccessDenied", "accessDeniedError"],
    ["OAuthAccountNotLinked", "accountNotLinkedError"],
    ["OAuthCallback", "genericError"],
  ] as const)("maps %s to %s", (error, key) => {
    expect(getLoginErrorKey(error)).toBe(key);
  });

  it.each([
    [null, "/jobs"],
    ["/resume", "/resume"],
    ["https://evil.example", "/jobs"],
    ["//evil.example", "/jobs"],
    ["javascript:alert(1)", "/jobs"],
  ] as const)("normalizes callback %s to %s", (value, expected) => {
    expect(getSafeCallbackUrl(value)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run `npx vitest run 'app/(auth)/login/authError.test.ts'`. Expected: module-not-found failure because the tested helper has not been created.

- [ ] **Step 3: Implement helpers and simplify Login UI**

Create:

```ts
export type LoginErrorKey =
  | "accessDeniedError"
  | "accountNotLinkedError"
  | "genericError";

export function getLoginErrorKey(error: string | null): LoginErrorKey | null {
  if (!error) return null;
  if (error === "AccessDenied") return "accessDeniedError";
  if (error === "OAuthAccountNotLinked") return "accountNotLinkedError";
  return "genericError";
}

export function getSafeCallbackUrl(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/jobs";
}
```

In `page.tsx`, always render the standard sign-in heading and both provider buttons. Delete the invite-denial branch, `ArrowRight`, and `/#access` link. Use the helpers for the error key and callback URL; render the translated error inside a nearby `role="alert"` region.

Change copy to:

```text
EN heading: Start with Joblit
EN subtitle: Sign in with Google or GitHub. Your free account is created automatically.
ZH heading: 开始使用 Joblit
ZH subtitle: 使用 Google 或 GitHub 登录，系统会自动创建你的免费账号。
```

Add specific recovery messages for provider denial and linked-account mismatch, and remove `deniedTitle`, `deniedBody`, `requestAccess`, and `tryAnother` from both locales.

- [ ] **Step 4: Run focused Login and message tests**

Run:

```powershell
npx vitest run 'app/(auth)/login/authError.test.ts' test/landingMessages.test.ts
```

Expected: helper and bilingual message-contract tests pass.

- [ ] **Step 5: Commit Task 4**

```powershell
git add 'app/(auth)/login' messages/en.json messages/zh.json
git commit -m "feat(login): add open-account recovery UX"
```

---

### Task 5: Remove Stale Documentation and Run the Production Gate

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify if generated metrics change: README badge/count lines maintained by `tools/readme/update-metrics-badges.mjs`

**Interfaces:**
- Consumes: completed runtime, migration, Landing, and Login behavior.
- Produces: current contributor/deployment documentation and a verified, clean, deployable commit range.

- [ ] **Step 1: Add no production code; audit active documentation and source residue**

Run:

```powershell
rg -n -i 'invite-only|request access|ADMIN_EMAILS|#access|isAdmin|accessRequest' README.md CLAUDE.md auth.ts app components lib messages types prisma/schema.prisma
```

Expected before cleanup: stale references remain in README/CLAUDE and possibly comments/messages. Historical immutable migration files and the approved design/plan documents are intentionally outside this command.

- [ ] **Step 2: Update documentation to the shipped model**

Document: “Joblit is free and open to everyone. Sign in with Google or GitHub; no invitation, manual approval, subscription, or credit card is required.” Remove the Access/Admin approval section, Admin Access tree entries, access-request API descriptions, and `ADMIN_EMAILS`. Keep the secret-protected JobSpy import route and its environment variables. Update API/file counts using:

```powershell
npm run readme:metrics
```

- [ ] **Step 3: Run the complete verification matrix**

Run:

```powershell
npm --prefix chrome-extension ci
npm run lint
npx tsc --noEmit
npm test
npm run deadcode
npm run deps:policy
npm run deps:audit
npx prisma validate
npm run build
git diff --check
git status --short
```

Expected: every command exits 0, tests have zero failures, build succeeds, and only intentional source/documentation changes appear before commit.

- [ ] **Step 4: Run final residue and security-boundary checks**

Run:

```powershell
rg -n -i 'invite-only|request access|ADMIN_EMAILS|#access|isAdmin|accessRequest' README.md CLAUDE.md auth.ts app components lib messages types prisma/schema.prisma
rg -n 'requireSession|withSessionRoute|withEmailSessionRoute|userId|IMPORT_SECRET|FETCH_RUN_SECRET|CRON_SECRET' app lib tools
git grep -n -I -E '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36})'
```

Expected: the first search has no runtime/active-doc matches; the second confirms authentication, ownership, and internal-worker boundaries still exist; the secret scan has no matches.

- [ ] **Step 5: Commit Task 5**

```powershell
git add README.md CLAUDE.md
git commit -m "docs: publish open free access model"
```

- [ ] **Step 6: Independent final review and push readiness**

Generate a review package from `ef30b3d` through `HEAD`, obtain independent spec-compliance and code-quality approval, fix every Critical/Important finding with focused regression tests, rerun the production gate, then confirm `master` contains only reviewed commits ready for push.
