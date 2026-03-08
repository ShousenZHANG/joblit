# Resume Profile Locale Isolation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Isolate resume profiles by locale so Chinese and English resumes are completely independent — switching locale shows only that locale's profiles.

**Architecture:** Add `locale` column to `ActiveResumeProfile` with composite PK `@@id([userId, locale])`. All server functions, API routes, and client requests gain a `locale` parameter. Downstream consumers derive locale from `job.market`. First visit to a new locale shows a blank form.

**Tech Stack:** Prisma 7.4.2, PostgreSQL (Neon), Next.js 16, next-intl, Vitest, Zod

**Design doc:** `docs/plans/2026-03-08-resume-locale-isolation-design.md`

---

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma:271-285`

**Step 1: Update schema**

Change the `ActiveResumeProfile` model and add a locale index to `ResumeProfile`:

```prisma
model ActiveResumeProfile {
  userId          String        @db.Uuid
  locale          String        @default("en-AU") // "en-AU" | "zh-CN"
  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  resumeProfileId String        @db.Uuid
  resumeProfile   ResumeProfile @relation(fields: [resumeProfileId], references: [id], onDelete: Cascade)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@id([userId, locale])
  @@index([resumeProfileId])
}
```

Also add locale index to `ResumeProfile` (after existing indexes):

```prisma
  @@index([userId, locale, updatedAt])
```

**Step 2: Generate and apply migration**

Run: `npx prisma migrate dev --name add-locale-to-active-resume-profile`
Expected: Migration generated and applied. Existing `ActiveResumeProfile` rows get `locale = "en-AU"`.

**Step 3: Verify generated client**

Run: `npx prisma generate`
Expected: Client regenerated with composite key types (`userId_locale` compound unique).

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ lib/generated/
git commit -m "feat: add locale to ActiveResumeProfile with composite PK"
```

---

### Task 2: Update Internal Helpers (`ensureActivePointer`, `getFallbackLatestProfile`)

**Files:**
- Modify: `lib/server/resumeProfile.ts:96-115`
- Test: `test/server/resumeProfile.test.ts`

**Step 1: Write failing tests for locale-scoped helpers**

Add these tests to `test/server/resumeProfile.test.ts` inside the existing `describe` block:

```typescript
  it("getResumeProfile scopes active pointer lookup by locale", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-zh" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-zh",
      userId: "user-1",
      name: "中文简历",
      locale: "zh-CN",
    });

    const profile = await getResumeProfile("user-1", { locale: "zh-CN" });

    expect(activeResumeProfileStore.findUnique).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      select: { resumeProfileId: true },
    });
    expect(profile?.id).toBe("rp-zh");
  });

  it("fallback scopes by locale and backfills with locale", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce(null);
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-zh-latest",
      userId: "user-1",
      locale: "zh-CN",
    });

    const profile = await getResumeProfile("user-1", { locale: "zh-CN" });

    expect(resumeProfileStore.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", locale: "zh-CN" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      update: { resumeProfileId: "rp-zh-latest" },
      create: { userId: "user-1", locale: "zh-CN", resumeProfileId: "rp-zh-latest" },
    });
    expect(profile?.id).toBe("rp-zh-latest");
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/resumeProfile.test.ts`
Expected: FAIL — `getResumeProfile` doesn't accept `locale` option yet, queries don't use `userId_locale`.

**Step 3: Update `ensureActivePointer` and `getFallbackLatestProfile`**

In `lib/server/resumeProfile.ts`, replace the two internal helpers:

```typescript
async function ensureActivePointer(userId: string, locale: string, resumeProfileId: string) {
  await prisma.activeResumeProfile.upsert({
    where: { userId_locale: { userId, locale } },
    update: { resumeProfileId },
    create: { userId, locale, resumeProfileId },
  });
}

async function getFallbackLatestProfile(userId: string, locale: string) {
  const latest = await prisma.resumeProfile.findFirst({
    where: { userId, locale },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  if (latest) {
    await ensureActivePointer(userId, locale, latest.id);
  }
  return latest;
}
```

Also update `getTargetProfile` — no locale filter needed here, but verify the target profile's locale matches. Actually, `getTargetProfile` is used to verify a specific profile belongs to a user. Keep it as-is for now; locale scoping happens at the caller level.

**Step 4: Update `getResumeProfile` to accept and use locale**

```typescript
export async function getResumeProfile(
  userId: string,
  options?: { profileId?: string; locale?: string },
) {
  const locale = options?.locale ?? "en-AU";
  const explicitProfileId = options?.profileId;
  if (explicitProfileId) {
    return getTargetProfile(userId, explicitProfileId);
  }

  const activePointer = await prisma.activeResumeProfile.findUnique({
    where: { userId_locale: { userId, locale } },
    select: { resumeProfileId: true },
  });

  if (activePointer?.resumeProfileId) {
    const active = await prisma.resumeProfile.findFirst({
      where: {
        id: activePointer.resumeProfileId,
        userId,
      },
    });
    if (active) return active;
  }

  return getFallbackLatestProfile(userId, locale);
}
```

**Step 5: Update existing tests to pass locale (or rely on default)**

Update the two existing tests that test `getResumeProfile`:

```typescript
  it("returns active profile when pointer exists", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-1" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-1",
      userId: "user-1",
      name: "Custom Blank",
    });

    const profile = await getResumeProfile("user-1");

    expect(activeResumeProfileStore.findUnique).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "en-AU" } },
      select: { resumeProfileId: true },
    });
    expect(profile?.id).toBe("rp-1");
  });

  it("falls back to latest profile and backfills active pointer", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce(null);
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-2",
      userId: "user-1",
      name: "Custom Blank",
    });

    const profile = await getResumeProfile("user-1");

    expect(profile?.id).toBe("rp-2");
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "en-AU" } },
      update: { resumeProfileId: "rp-2" },
      create: { userId: "user-1", locale: "en-AU", resumeProfileId: "rp-2" },
    });
  });
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run test/server/resumeProfile.test.ts`
Expected: PASS — all tests green.

**Step 7: Commit**

```bash
git add lib/server/resumeProfile.ts test/server/resumeProfile.test.ts
git commit -m "feat: scope ensureActivePointer and getResumeProfile by locale"
```

---

### Task 3: Update `listResumeProfiles` and `setActiveResumeProfile`

**Files:**
- Modify: `lib/server/resumeProfile.ts`
- Test: `test/server/resumeProfile.test.ts`

**Step 1: Write failing tests**

```typescript
  it("lists only profiles for the requested locale", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([
      {
        id: "rp-zh-1",
        name: "中文简历",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        updatedAt: new Date("2026-03-01T00:00:00.000Z"),
        revision: 1,
      },
    ]);
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-zh-1" });

    const result = await listResumeProfiles("user-1", "zh-CN");

    expect(resumeProfileStore.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", locale: "zh-CN" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        revision: true,
      },
    });
    expect(activeResumeProfileStore.findUnique).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      select: { resumeProfileId: true },
    });
    expect(result.activeProfileId).toBe("rp-zh-1");
  });

  it("sets active profile with locale-scoped upsert", async () => {
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-9",
      userId: "user-1",
      locale: "zh-CN",
    });

    const target = await setActiveResumeProfile("user-1", "zh-CN", "rp-9");

    expect(target?.id).toBe("rp-9");
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      update: { resumeProfileId: "rp-9" },
      create: { userId: "user-1", locale: "zh-CN", resumeProfileId: "rp-9" },
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/resumeProfile.test.ts`
Expected: FAIL — `listResumeProfiles` and `setActiveResumeProfile` don't accept `locale` parameter.

**Step 3: Update `listResumeProfiles`**

```typescript
export async function listResumeProfiles(userId: string, locale: string = "en-AU") {
  const [profiles, activePointer] = await prisma.$transaction([
    prisma.resumeProfile.findMany({
      where: { userId, locale },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        revision: true,
      },
    }),
    prisma.activeResumeProfile.findUnique({
      where: { userId_locale: { userId, locale } },
      select: { resumeProfileId: true },
    }),
  ]);

  let activeProfileId = activePointer?.resumeProfileId ?? null;
  if (!activeProfileId && profiles[0]) {
    activeProfileId = profiles[0].id;
    await ensureActivePointer(userId, locale, profiles[0].id);
  }

  return {
    activeProfileId,
    profiles: profiles.map((profile) => ({
      ...profile,
      isActive: profile.id === activeProfileId,
    })) satisfies ResumeProfileSummary[],
  };
}
```

**Step 4: Update `setActiveResumeProfile`**

```typescript
export async function setActiveResumeProfile(userId: string, locale: string, profileId: string) {
  const target = await getTargetProfile(userId, profileId);
  if (!target) return null;
  await ensureActivePointer(userId, locale, target.id);
  return target;
}
```

**Step 5: Update existing tests that call these functions**

Update the "lists profiles" test:

```typescript
  it("lists profiles and flags active profile", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([
      {
        id: "rp-1",
        name: "Custom Blank",
        createdAt: new Date("2026-02-21T01:00:00.000Z"),
        updatedAt: new Date("2026-02-21T02:00:00.000Z"),
        revision: 1,
      },
      {
        id: "rp-2",
        name: "Custom Blank 2",
        createdAt: new Date("2026-02-21T00:00:00.000Z"),
        updatedAt: new Date("2026-02-21T01:00:00.000Z"),
        revision: 1,
      },
    ]);
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-2" });

    const result = await listResumeProfiles("user-1");

    expect(result.activeProfileId).toBe("rp-2");
    expect(result.profiles[1]?.isActive).toBe(true);
  });
```

Update the "sets active profile" test:

```typescript
  it("sets active profile only when profile belongs to user", async () => {
    resumeProfileStore.findFirst.mockResolvedValueOnce({ id: "rp-9", userId: "user-1" });

    const target = await setActiveResumeProfile("user-1", "en-AU", "rp-9");

    expect(target?.id).toBe("rp-9");
    expect(activeResumeProfileStore.upsert).toHaveBeenCalled();
  });
```

**Step 6: Run tests**

Run: `npx vitest run test/server/resumeProfile.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add lib/server/resumeProfile.ts test/server/resumeProfile.test.ts
git commit -m "feat: scope listResumeProfiles and setActiveResumeProfile by locale"
```

---

### Task 4: Update `createResumeProfile` and `buildDefaultProfileName`

**Files:**
- Modify: `lib/server/resumeProfile.ts`
- Test: `test/server/resumeProfile.test.ts`

**Step 1: Write failing tests**

```typescript
  it("creates a profile with zh-CN locale", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([]);
    resumeProfileStore.create.mockResolvedValueOnce({
      id: "rp-zh-new",
      userId: "user-1",
      name: "Custom Blank",
      locale: "zh-CN",
    });

    const profile = await createResumeProfile("user-1", { locale: "zh-CN", mode: "blank" });

    expect(profile.id).toBe("rp-zh-new");
    expect(resumeProfileStore.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        name: "Custom Blank",
        locale: "zh-CN",
      },
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      update: { resumeProfileId: "rp-zh-new" },
      create: { userId: "user-1", locale: "zh-CN", resumeProfileId: "rp-zh-new" },
    });
  });

  it("copy-creates from same-locale source only", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-zh-active" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      summary: "中文摘要",
      basics: { fullName: "张三" },
      links: [],
      skills: [],
      experiences: [],
      projects: [],
      education: [],
    });
    resumeProfileStore.findMany.mockResolvedValueOnce([]);
    resumeProfileStore.create.mockResolvedValueOnce({
      id: "rp-zh-copy",
      userId: "user-1",
      name: "Custom Blank",
      locale: "zh-CN",
      summary: "中文摘要",
    });

    const profile = await createResumeProfile("user-1", { locale: "zh-CN" });

    expect(profile.id).toBe("rp-zh-copy");
    expect(activeResumeProfileStore.findUnique).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      select: { resumeProfileId: true },
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/resumeProfile.test.ts`
Expected: FAIL

**Step 3: Update `buildDefaultProfileName` to scope by locale**

```typescript
async function buildDefaultProfileName(
  userId: string,
  locale: string,
  tx: Pick<Prisma.TransactionClient, "resumeProfile"> | typeof prisma = prisma,
) {
  const existing = await tx.resumeProfile.findMany({
    where: { userId, locale },
    select: { name: true },
  });

  const usedNames = new Set(existing.map((item) => item.name.trim().toLowerCase()));
  if (!usedNames.has(DEFAULT_PROFILE_BASE_NAME.toLowerCase())) {
    return DEFAULT_PROFILE_BASE_NAME;
  }

  let suffix = 2;
  while (usedNames.has(`${DEFAULT_PROFILE_BASE_NAME} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${DEFAULT_PROFILE_BASE_NAME} ${suffix}`;
}
```

**Step 4: Update `createResumeProfile` to accept and use locale**

```typescript
export async function createResumeProfile(
  userId: string,
  options?: {
    name?: string;
    setActive?: boolean;
    mode?: "copy" | "blank";
    sourceProfileId?: string;
    locale?: string;
  },
) {
  const locale = options?.locale ?? "en-AU";
  const createMode = options?.mode ?? "copy";

  return prisma.$transaction(async (tx) => {
    const resolvedName = options?.name
      ? normalizeProfileName(options.name)
      : await buildDefaultProfileName(userId, locale, tx);

    let sourceProfile: Prisma.ResumeProfileGetPayload<{ select: typeof PROFILE_CLONE_SELECT }> | null =
      null;

    if (createMode === "copy") {
      if (options?.sourceProfileId) {
        sourceProfile = await tx.resumeProfile.findFirst({
          where: { id: options.sourceProfileId, userId },
          select: PROFILE_CLONE_SELECT,
        });
      }

      if (!sourceProfile) {
        const activePointer = await tx.activeResumeProfile.findUnique({
          where: { userId_locale: { userId, locale } },
          select: { resumeProfileId: true },
        });
        if (activePointer?.resumeProfileId) {
          sourceProfile = await tx.resumeProfile.findFirst({
            where: { id: activePointer.resumeProfileId, userId },
            select: PROFILE_CLONE_SELECT,
          });
        }
      }

      if (!sourceProfile) {
        sourceProfile = await tx.resumeProfile.findFirst({
          where: { userId, locale },
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          select: PROFILE_CLONE_SELECT,
        });
      }
    }

    const profile = await tx.resumeProfile.create({
      data: {
        userId,
        name: resolvedName,
        locale,
        ...(sourceProfile
          ? {
              summary: sourceProfile.summary,
              basics: cloneJsonValueForCreate(sourceProfile.basics),
              links: cloneJsonValueForCreate(sourceProfile.links),
              skills: cloneJsonValueForCreate(sourceProfile.skills),
              experiences: cloneJsonValueForCreate(sourceProfile.experiences),
              projects: cloneJsonValueForCreate(sourceProfile.projects),
              education: cloneJsonValueForCreate(sourceProfile.education),
            }
          : {}),
      },
    });

    if (options?.setActive !== false) {
      await tx.activeResumeProfile.upsert({
        where: { userId_locale: { userId, locale } },
        update: { resumeProfileId: profile.id },
        create: { userId, locale, resumeProfileId: profile.id },
      });
    }

    return profile;
  });
}
```

**Step 5: Update existing `createResumeProfile` tests**

The "creates a new profile and marks it active" test: no change needed since it calls `createResumeProfile("user-1")` which defaults to `"en-AU"`. But the mock assertions for `activeResumeProfileStore.upsert` should now have composite key. Update:

```typescript
  it("creates a new profile and marks it active", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-active" });
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      summary: "Existing summary",
      basics: { fullName: "Jane Doe" },
      links: [{ label: "LinkedIn", url: "https://example.com" }],
      skills: [{ category: "Languages", items: ["TypeScript"] }],
      experiences: [{ title: "SE", company: "A", location: "Sydney", dates: "2020-2021", bullets: ["Built"] }],
      projects: [],
      education: [],
    });
    resumeProfileStore.findMany.mockResolvedValueOnce([{ name: "Custom Blank" }]);
    resumeProfileStore.create.mockResolvedValueOnce({
      id: "rp-new",
      userId: "user-1",
      name: "Custom Blank 2",
      summary: "Existing summary",
    });

    const profile = await createResumeProfile("user-1");

    expect(profile.id).toBe("rp-new");
    expect(resumeProfileStore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        name: "Custom Blank 2",
        locale: "en-AU",
        summary: "Existing summary",
      }),
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalled();
  });

  it("creates a blank profile when mode is blank", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([{ name: "Custom Blank" }]);
    resumeProfileStore.create.mockResolvedValueOnce({
      id: "rp-empty",
      userId: "user-1",
      name: "Custom Blank 2",
    });

    const profile = await createResumeProfile("user-1", { mode: "blank" });

    expect(profile.id).toBe("rp-empty");
    expect(resumeProfileStore.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        name: "Custom Blank 2",
        locale: "en-AU",
      },
    });
  });
```

**Step 6: Run tests**

Run: `npx vitest run test/server/resumeProfile.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add lib/server/resumeProfile.ts test/server/resumeProfile.test.ts
git commit -m "feat: scope createResumeProfile by locale"
```

---

### Task 5: Update `deleteResumeProfile` and `upsertResumeProfile`

**Files:**
- Modify: `lib/server/resumeProfile.ts`
- Test: `test/server/resumeProfile.test.ts`

**Step 1: Write failing tests**

```typescript
  it("deletes profile and rotates active pointer with locale", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([{ id: "rp-zh-1" }, { id: "rp-zh-2" }]);
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-zh-1" });
    resumeProfileStore.delete.mockResolvedValueOnce({ id: "rp-zh-1" });

    const result = await deleteResumeProfile("user-1", "zh-CN", "rp-zh-1");

    expect(resumeProfileStore.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", locale: "zh-CN" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    expect(activeResumeProfileStore.findUnique).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      select: { resumeProfileId: true },
    });
    expect(result).toEqual({
      status: "deleted",
      deletedProfileId: "rp-zh-1",
      activeProfileId: "rp-zh-2",
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "zh-CN" } },
      update: { resumeProfileId: "rp-zh-2" },
      create: { userId: "user-1", locale: "zh-CN", resumeProfileId: "rp-zh-2" },
    });
  });

  it("upsert creates new profile with locale when no target exists", async () => {
    activeResumeProfileStore.findUnique.mockResolvedValueOnce(null);
    resumeProfileStore.findFirst.mockResolvedValueOnce(null);
    resumeProfileStore.create.mockResolvedValueOnce({
      id: "rp-zh-created",
      userId: "user-1",
      locale: "zh-CN",
      summary: "新摘要",
    });

    const profile = await upsertResumeProfile(
      "user-1",
      { summary: "新摘要" },
      { locale: "zh-CN" },
    );

    expect(resumeProfileStore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        locale: "zh-CN",
        summary: "新摘要",
      }),
    });
    expect(profile?.id).toBe("rp-zh-created");
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/resumeProfile.test.ts`
Expected: FAIL

**Step 3: Update `deleteResumeProfile`**

```typescript
export async function deleteResumeProfile(
  userId: string,
  locale: string,
  profileId: string,
): Promise<DeleteResumeProfileResult> {
  return prisma.$transaction(async (tx) => {
    const profiles = await tx.resumeProfile.findMany({
      where: { userId, locale },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });

    const target = profiles.find((profile) => profile.id === profileId);
    if (!target) {
      return { status: "not_found" };
    }

    if (profiles.length <= 1) {
      return { status: "last_profile" };
    }

    const activePointer = await tx.activeResumeProfile.findUnique({
      where: { userId_locale: { userId, locale } },
      select: { resumeProfileId: true },
    });

    await tx.resumeProfile.delete({
      where: { id: profileId },
    });

    let nextActiveProfileId = activePointer?.resumeProfileId ?? null;
    if (!nextActiveProfileId || nextActiveProfileId === profileId) {
      nextActiveProfileId = profiles.find((profile) => profile.id !== profileId)?.id ?? null;
      if (nextActiveProfileId) {
        await tx.activeResumeProfile.upsert({
          where: { userId_locale: { userId, locale } },
          update: { resumeProfileId: nextActiveProfileId },
          create: { userId, locale, resumeProfileId: nextActiveProfileId },
        });
      }
    }

    return {
      status: "deleted",
      deletedProfileId: profileId,
      activeProfileId: nextActiveProfileId,
    };
  });
}
```

**Step 4: Update `upsertResumeProfile`**

```typescript
export async function upsertResumeProfile(
  userId: string,
  data: ResumeProfileInput,
  options?: {
    profileId?: string;
    name?: string;
    setActive?: boolean;
    locale?: string;
  },
) {
  const locale = options?.locale ?? "en-AU";
  const normalized = toNormalizedWriteData(data);
  const explicitProfileId = options?.profileId;

  const target = explicitProfileId
    ? await getTargetProfile(userId, explicitProfileId)
    : await getResumeProfile(userId, { locale });

  if (explicitProfileId && !target) {
    return null;
  }

  if (!target) {
    const created = await prisma.resumeProfile.create({
      data: {
        userId,
        locale,
        name: normalizeProfileName(options?.name),
        ...normalized,
      },
    });

    if (options?.setActive !== false) {
      await ensureActivePointer(userId, locale, created.id);
    }

    return created;
  }

  const updated = await prisma.resumeProfile.update({
    where: { id: target.id },
    data: {
      ...normalized,
      ...(options?.name === undefined ? {} : { name: normalizeProfileName(options.name) }),
      revision: {
        increment: 1,
      },
    },
  });

  if (options?.setActive !== false) {
    await ensureActivePointer(userId, locale, updated.id);
  }

  return updated;
}
```

**Step 5: Update existing `deleteResumeProfile` and `upsertResumeProfile` tests**

Update signatures to include locale parameter:

```typescript
  it("deletes selected profile and rotates active pointer", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([{ id: "rp-1" }, { id: "rp-2" }]);
    activeResumeProfileStore.findUnique.mockResolvedValueOnce({ resumeProfileId: "rp-1" });
    resumeProfileStore.delete.mockResolvedValueOnce({ id: "rp-1" });

    const result = await deleteResumeProfile("user-1", "en-AU", "rp-1");

    expect(result).toEqual({
      status: "deleted",
      deletedProfileId: "rp-1",
      activeProfileId: "rp-2",
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "en-AU" } },
      update: { resumeProfileId: "rp-2" },
      create: { userId: "user-1", locale: "en-AU", resumeProfileId: "rp-2" },
    });
  });

  it("blocks deleting the last remaining profile", async () => {
    resumeProfileStore.findMany.mockResolvedValueOnce([{ id: "rp-only" }]);

    const result = await deleteResumeProfile("user-1", "en-AU", "rp-only");

    expect(result).toEqual({ status: "last_profile" });
    expect(resumeProfileStore.delete).not.toHaveBeenCalled();
  });
```

Update `upsertResumeProfile` test — the existing "upserts selected profile" test uses `profileId` so it should still work (locale defaults to `"en-AU"`). But update the `ensureActivePointer` assertion:

```typescript
  it("upserts selected profile and bumps revision", async () => {
    resumeProfileStore.findFirst.mockResolvedValueOnce({
      id: "rp-5",
      userId: "user-1",
      name: "Custom Blank 2",
    });
    resumeProfileStore.update.mockResolvedValueOnce({
      id: "rp-5",
      userId: "user-1",
      name: "Graduate CV",
      summary: "Updated",
    });

    const profile = await upsertResumeProfile(
      "user-1",
      {
        summary: "Updated",
      },
      {
        profileId: "rp-5",
        name: "Graduate CV",
        setActive: true,
      },
    );

    expect(resumeProfileStore.update).toHaveBeenCalledWith({
      where: { id: "rp-5" },
      data: {
        summary: "Updated",
        basics: undefined,
        links: undefined,
        skills: undefined,
        experiences: undefined,
        projects: undefined,
        education: undefined,
        name: "Graduate CV",
        revision: { increment: 1 },
      },
    });
    expect(activeResumeProfileStore.upsert).toHaveBeenCalledWith({
      where: { userId_locale: { userId: "user-1", locale: "en-AU" } },
      update: { resumeProfileId: "rp-5" },
      create: { userId: "user-1", locale: "en-AU", resumeProfileId: "rp-5" },
    });
    expect(profile.name).toBe("Graduate CV");
  });
```

**Step 6: Run tests**

Run: `npx vitest run test/server/resumeProfile.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add lib/server/resumeProfile.ts test/server/resumeProfile.test.ts
git commit -m "feat: scope deleteResumeProfile and upsertResumeProfile by locale"
```

---

### Task 6: Update `renameResumeProfile` (no locale change needed)

**Files:**
- Modify: `lib/server/resumeProfile.ts` — no change needed, rename only affects name by profileId

No implementation needed. `renameResumeProfile` takes `(userId, profileId, name)` and targets a specific profile by ID — no locale scoping required since the profile's locale is already set.

---

### Task 7: Update API Route — Zod Schemas and Handlers

**Files:**
- Modify: `app/api/resume-profile/route.ts`
- Test: `test/api/resume-profile.test.ts` (if exists, otherwise validate manually)

**Step 1: Add locale to Zod schemas**

Add a locale enum to the schemas:

```typescript
const LocaleSchema = z.enum(["en-AU", "zh-CN"]).default("en-AU");
```

Update `ResumeProfileUpsertSchema`:

```typescript
const ResumeProfileUpsertSchema = ResumeProfileSchema.extend({
  profileId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  setActive: z.boolean().optional(),
  locale: LocaleSchema,
});
```

Update `ResumeProfilePatchSchema` — add `locale` to each action:

```typescript
const ResumeProfilePatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(80).optional(),
    mode: z.enum(["copy", "blank"]).optional(),
    sourceProfileId: z.string().uuid().optional(),
    locale: LocaleSchema,
  }),
  z.object({
    action: z.literal("activate"),
    profileId: z.string().uuid(),
    locale: LocaleSchema,
  }),
  z.object({
    action: z.literal("rename"),
    profileId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal("delete"),
    profileId: z.string().uuid(),
    locale: LocaleSchema,
  }),
]);
```

Note: `rename` does NOT need locale — it's identified by profileId.

**Step 2: Update `buildResumeProfileResponse`**

```typescript
async function buildResumeProfileResponse(userId: string, locale: string = "en-AU") {
  const { profiles, activeProfileId } = await listResumeProfiles(userId, locale);
  const activeProfile = activeProfileId
    ? await getResumeProfile(userId, { profileId: activeProfileId, locale })
    : null;

  return {
    profiles,
    activeProfileId,
    activeProfile,
    profile: activeProfile,
  };
}
```

**Step 3: Update GET handler**

```typescript
export async function GET(req: Request) {
  const userId = await getAuthorizedUserId();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawLocale = searchParams.get("locale") ?? "en-AU";
  const locale = rawLocale === "zh-CN" ? "zh-CN" : "en-AU";

  const state = await buildResumeProfileResponse(userId, locale);
  return NextResponse.json(state, { status: 200 });
}
```

**Step 4: Update POST handler**

```typescript
export async function POST(req: Request) {
  const userId = await getAuthorizedUserId();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = ResumeProfileUpsertSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const locale = parsed.data.locale;

  let profile;
  try {
    profile = await upsertResumeProfile(
      userId,
      {
        summary: parsed.data.summary,
        basics: parsed.data.basics,
        links: parsed.data.links,
        skills: parsed.data.skills,
        experiences: parsed.data.experiences,
        projects: parsed.data.projects,
        education: parsed.data.education,
      },
      {
        profileId: parsed.data.profileId,
        name: parsed.data.name,
        setActive: parsed.data.setActive,
        locale,
      },
    );
  } catch (error) {
    const prismaErrorResponse = parsePrismaError(error);
    if (prismaErrorResponse) return prismaErrorResponse;
    throw error;
  }

  if (!profile) {
    return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });
  }

  const state = await buildResumeProfileResponse(userId, locale);
  return NextResponse.json(state, { status: 200 });
}
```

**Step 5: Update PATCH handler**

```typescript
export async function PATCH(req: Request) {
  const userId = await getAuthorizedUserId();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = ResumeProfilePatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let locale = "en-AU";

  if (parsed.data.action === "create") {
    locale = parsed.data.locale;
    try {
      await createResumeProfile(userId, {
        name: parsed.data.name,
        setActive: true,
        mode: parsed.data.mode,
        sourceProfileId: parsed.data.sourceProfileId,
        locale,
      });
    } catch (error) {
      const prismaErrorResponse = parsePrismaError(error);
      if (prismaErrorResponse) return prismaErrorResponse;
      throw error;
    }
  }

  if (parsed.data.action === "activate") {
    locale = parsed.data.locale;
    const target = await setActiveResumeProfile(userId, locale, parsed.data.profileId);
    if (!target) {
      return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });
    }
  }

  if (parsed.data.action === "rename") {
    const target = await renameResumeProfile(userId, parsed.data.profileId, parsed.data.name);
    if (!target) {
      return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });
    }
  }

  if (parsed.data.action === "delete") {
    locale = parsed.data.locale;
    const result = await deleteResumeProfile(userId, locale, parsed.data.profileId);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });
    }
    if (result.status === "last_profile") {
      return NextResponse.json(
        { error: "LAST_PROFILE", message: "At least one resume version is required." },
        { status: 409 },
      );
    }
  }

  const state = await buildResumeProfileResponse(userId, locale);
  return NextResponse.json(state, { status: 200 });
}
```

**Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 7: Commit**

```bash
git add app/api/resume-profile/route.ts
git commit -m "feat: add locale parameter to resume-profile API"
```

---

### Task 8: Update Downstream API Consumers

**Files:**
- Modify: `app/api/resume-pdf/route.ts` (line ~101)
- Modify: `app/api/applications/generate/route.ts` (line ~66)
- Modify: `app/api/applications/prompt/route.ts` (line ~75)
- Modify: `app/api/applications/manual-generate/route.ts` (line ~654)

**Step 1: Update `resume-pdf/route.ts`**

The resume-pdf route already detects locale from the profile record after fetching. We need to pass locale to `getResumeProfile` so it fetches the correct profile. The locale should come from the request body or a query param.

Find where `getResumeProfile(userId)` is called and add locale:

```typescript
  // Before: sourceProfile = await getResumeProfile(userId);
  // After:
  if (!sourceProfile) {
    const { searchParams } = new URL(req.url);
    const rawLocale = searchParams.get("locale") ?? "en-AU";
    const pdfLocale = rawLocale === "zh-CN" ? "zh-CN" : "en-AU";
    sourceProfile = await getResumeProfile(userId, { locale: pdfLocale });
  }
```

Note: The client already sends a `locale` query param when requesting preview (or can be derived from the profile itself since profile.locale exists on the record). Simplest approach: pass locale as query param from client.

**Step 2: Update `applications/generate/route.ts`**

Add `market` to the job select and derive locale:

```typescript
  const job = await prisma.job.findFirst({
    where: {
      id: parsed.data.jobId,
      userId,
    },
    select: {
      id: true,
      title: true,
      company: true,
      description: true,
      market: true,
    },
  });

  // ... after null check ...

  const profileLocale = job.market === "CN" ? "zh-CN" : "en-AU";
  const profile = await getResumeProfile(userId, { locale: profileLocale });
```

**Step 3: Update `applications/prompt/route.ts`**

Same pattern — add `market` to select and derive locale:

```typescript
  const job = await prisma.job.findFirst({
    where: {
      id: parsed.data.jobId,
      userId,
    },
    select: {
      title: true,
      company: true,
      description: true,
      market: true,
    },
  });

  // ... after null check ...

  const profileLocale = job.market === "CN" ? "zh-CN" : "en-AU";
  const profile = await getResumeProfile(userId, { locale: profileLocale });
```

**Step 4: Update `applications/manual-generate/route.ts`**

Same pattern:

```typescript
  const job = await prisma.job.findFirst({
    where: {
      id: parsed.data.jobId,
      userId,
    },
    select: {
      id: true,
      title: true,
      company: true,
      description: true,
      market: true,
    },
  });

  // ... after null check ...

  const profileLocale = job.market === "CN" ? "zh-CN" : "en-AU";
  const profile = await getResumeProfile(userId, { locale: profileLocale });
```

**Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 6: Commit**

```bash
git add app/api/resume-pdf/route.ts app/api/applications/generate/route.ts app/api/applications/prompt/route.ts app/api/applications/manual-generate/route.ts
git commit -m "feat: pass locale to getResumeProfile in downstream consumers"
```

---

### Task 9: Update Client — ResumeForm.tsx

**Files:**
- Modify: `components/resume/ResumeForm.tsx`

**Step 1: Update mount effect to include locale**

Find the mount `useEffect` (~line 560) and add `locale` to the fetch URL and dependency array:

```typescript
  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/resume-profile?locale=${locale}`);
      if (!res.ok) return;
      const json = await res.json();
      if (!active) return;
      hydrateFromResumeApi(json);
    };
    load();
    return () => {
      active = false;
    };
  }, [locale, hydrateFromResumeApi]);
```

**Step 2: Update save (POST) to include locale**

Find the save handler (~line 1305) that does `fetch("/api/resume-profile", { method: "POST", ... })`. The payload is built before this call. Add `locale` to the payload:

```typescript
  // In the save handler, add locale to the payload object:
  const payload = {
    ...buildPayload(),
    locale,
  };
```

**Step 3: Update create profile (PATCH create) to include locale**

Find the create handler (~line 1138):

```typescript
  body: JSON.stringify({
    action: "create",
    mode,
    sourceProfileId: activeProfileId ?? selectedProfileId ?? undefined,
    locale,
  }),
```

**Step 4: Update delete profile (PATCH delete) to include locale**

Find the delete handler (~line 1200):

```typescript
  body: JSON.stringify({
    action: "delete",
    profileId: selectedProfileId,
    locale,
  }),
```

**Step 5: Update activate profile (PATCH activate) to include locale**

Find the activate handler (~line 1253):

```typescript
  body: JSON.stringify({
    action: "activate",
    profileId,
    locale,
  }),
```

**Step 6: Verify by running all tests**

Run: `npx vitest run`
Expected: All tests pass (including ResumeForm tests since locale is derived from `globalLocale` which comes from the `useLocale()` hook — already mocked in tests).

**Step 7: Commit**

```bash
git add components/resume/ResumeForm.tsx
git commit -m "feat: send locale in all resume-profile API requests"
```

---

### Task 10: Update Resume Preview to Pass Locale

**Files:**
- Modify: `components/resume/ResumeForm.tsx` (preview fetch)

**Step 1: Find the preview request**

Search for `/api/resume-pdf` in `ResumeForm.tsx`. Update the preview fetch to include locale as a query param:

```typescript
  // In the preview handler, update the fetch URL:
  const previewRes = await fetch(`/api/resume-pdf?locale=${locale}`, {
    method: "POST",
    // ... existing options
  });
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add components/resume/ResumeForm.tsx
git commit -m "feat: pass locale to resume-pdf preview endpoint"
```

---

### Task 11: Run Full Test Suite and Verify

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass. If any tests fail due to the signature changes, update the mock calls in those test files.

**Step 2: Verify build**

Run: `npx next build`
Expected: Build succeeds.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete resume profile locale isolation"
```

---

## Summary of All Changed Files

| File | Change |
|---|---|
| `prisma/schema.prisma` | ActiveResumeProfile → `@@id([userId, locale])`, ResumeProfile + locale index |
| `lib/server/resumeProfile.ts` | All 7 exported functions gain locale param, all queries scoped by locale |
| `test/server/resumeProfile.test.ts` | All existing tests updated for new signatures + new locale-specific tests |
| `app/api/resume-profile/route.ts` | Zod schemas + GET/POST/PATCH handlers + `buildResumeProfileResponse` |
| `app/api/resume-pdf/route.ts` | Pass locale to `getResumeProfile` |
| `app/api/applications/generate/route.ts` | Derive locale from `job.market`, pass to `getResumeProfile` |
| `app/api/applications/prompt/route.ts` | Same |
| `app/api/applications/manual-generate/route.ts` | Same |
| `components/resume/ResumeForm.tsx` | All 5 fetch calls include locale, mount effect depends on locale |
