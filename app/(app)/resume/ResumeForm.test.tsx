import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ResumeFormProvider } from "@/components/resume/ResumeContext";
import { ResumePageLayout } from "@/components/resume/ResumePageLayout";
import messages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import { ResumeProfileSchema } from "@/lib/shared/schemas/resumeProfile";

const guideMocks = vi.hoisted(() => ({
  isTaskHighlighted: vi.fn(() => false),
  markTaskComplete: vi.fn(),
}));

vi.mock("@/app/GuideContext", () => ({
  useGuide: () => ({
    isTaskHighlighted: guideMocks.isTaskHighlighted,
    markTaskComplete: guideMocks.markTaskComplete,
  }),
}));

vi.mock("@/components/resume/ResumePdfPreview", () => ({
  ResumePdfPreview: ({ pdfUrl }: { pdfUrl: string }) => (
    <div data-testid="resume-pdf-preview" data-pdf-url={pdfUrl} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The editor persists which section it was on. Without this, a test that
  // navigates leaks its cursor into whichever test renders next.
  window.localStorage.clear();
  guideMocks.isTaskHighlighted.mockClear();
  guideMocks.markTaskComplete.mockClear();
});

function toUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function emptyProfileJson() {
  return {
    profile: null,
    profiles: [],
    activeProfile: null,
    activeProfileId: null,
  };
}

function populatedProfileJson() {
  const activeProfile = {
    locale: "en-AU",
    basics: {
      fullName: "Jane Doe",
      title: "Software Engineer",
      email: "jane@example.com",
      phone: "+1 555 0100",
    },
    links: null,
    summary: null,
    experiences: [],
    projects: [],
    education: [],
    skills: [],
  };

  return {
    profile: activeProfile,
    profiles: [{ id: "profile-1", name: "Primary", isActive: true }],
    activeProfile,
    activeProfileId: "profile-1",
  };
}

function mockEmptyProfileFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = toUrl(input);
    if (url.startsWith("/api/resume-profile")) {
      return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderResumePage(locale = "en", selectedMessages = messages) {
  return render(
    <NextIntlClientProvider locale={locale} messages={selectedMessages}>
      <div className="app-shell">
        <ResumeFormProvider>
          <ResumePageLayout />
        </ResumeFormProvider>
      </div>
    </NextIntlClientProvider>,
  );
}

async function fillBasics() {
  fireEvent.change(await screen.findByLabelText("Full name"), {
    target: { value: "Jane Doe" },
  });
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Software Engineer" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "jane@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Phone"), {
    target: { value: "+1 555 0100" },
  });
}

function firstButton(name: string) {
  return screen.getAllByRole("button", { name })[0];
}

/** The section rail is a jump list now: every section is already rendered.
 *  An empty section's button carries an "— Not filled in yet" aria suffix,
 *  so match on the leading section name. */
function jumpToSection(name: string) {
  fireEvent.click(
    screen.getAllByRole("button", { name: new RegExp(`^${name}`) })[0],
  );
}

describe("Resume page", () => {
  it("renders every section in one scroll, with no manual save control", async () => {
    mockEmptyProfileFetch();

    renderResumePage();

    expect(await screen.findByRole("heading", { name: "Personal info" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();

    // Single-scroll layout: the other sections are on the page already, not
    // one route-switch away.
    for (const section of ["personal", "summary", "experience", "projects", "education", "skills"]) {
      expect(screen.getByTestId(`resume-section-${section}`)).toBeInTheDocument();
    }

    // Autosave owns persistence; a Save button alongside it is exactly the
    // mixed model design systems warn against.
    expect(
      screen.queryByRole("button", { name: /save selected resume/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("resume-save-indicator")).not.toBeInTheDocument();
    screen
      .getAllByRole("button", { name: "Preview" })
      .forEach((button) => expect(button).toBeDisabled());
  }, 10_000);

  it("keeps the preview out of the constrained tablet layout", async () => {
    mockEmptyProfileFetch();

    const { container } = renderResumePage();

    expect(
      await screen.findByRole("heading", { name: "Personal info" }),
    ).toBeInTheDocument();
    const desktopPreview = container.querySelector(
      '[data-slot="resume-desktop-preview"]',
    );

    expect(desktopPreview).not.toBeNull();
    expect(desktopPreview).toHaveClass("hidden", "lg:flex");
    expect(desktopPreview).not.toHaveClass("md:flex");
  });

  it("uses the CN resume section order and CN-specific personal-info fields", async () => {
    mockEmptyProfileFetch();

    const { container } = renderResumePage("zh-CN", zhMessages);

    expect(
      await screen.findByRole("heading", { name: zhMessages.resumeForm.personalInfo }),
    ).toBeInTheDocument();
    // CN has no Summary module, so the section never renders at all.
    expect(screen.queryByTestId("resume-section-summary")).not.toBeInTheDocument();
    expect(container.querySelector("#resume-availability-month")).toBeTruthy();
    expect(container.querySelector("#resume-gender")).toBeNull();
    expect(container.querySelector("#resume-age")).toBeNull();
  });

  it("scrolls to a section from the rail instead of swapping the canvas", async () => {
    mockEmptyProfileFetch();

    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderResumePage();
    expect(await screen.findByRole("heading", { name: "Personal info" })).toBeInTheDocument();

    jumpToSection("Summary");

    // Personal info stays mounted — the rail moved the viewport, not the route.
    expect(screen.getByRole("heading", { name: "Personal info" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Summary" })).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("collapses a section from its own header without losing the others", async () => {
    mockEmptyProfileFetch();

    renderResumePage();
    const heading = await screen.findByRole("heading", { name: "Personal info" });
    const toggle = heading.closest("button");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle!);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The visual exit may keep its DOM nodes mounted briefly, but collapsed
    // controls must leave the accessibility tree and tab order immediately.
    // Synchronize on that user-observable contract, not Framer Motion's RAF.
    const collapsedBody = document.getElementById("resume-section-personal-body");
    expect(collapsedBody).toHaveAttribute("aria-hidden", "true");
    expect(collapsedBody).toHaveAttribute("inert");
    expect(screen.queryByRole("textbox", { name: "Full name" })).not.toBeInTheDocument();
    expect(screen.getByTestId("resume-section-experience")).toBeInTheDocument();
  });

  /**
   * Focus mode is expressed in CSS, not JS: every section stays mounted and
   * the inactive ones are hidden from `lg` up. jsdom does not evaluate media
   * queries, so these assert the class contract that drives it — that the
   * active section is unhidden and the others carry `lg:hidden` — rather than
   * computed visibility.
   */
  describe("focus mode", () => {
    const slot = (id: string) =>
      document.querySelector<HTMLElement>(`[data-section-slot="${id}"]`);

    it("hides the inactive sections from lg up and keeps them mounted", async () => {
      mockEmptyProfileFetch();

      renderResumePage();
      await screen.findByRole("heading", { name: "Personal info" });

      expect(slot("personal")).toHaveAttribute("data-active", "true");
      expect(slot("personal")).not.toHaveClass("lg:hidden");
      expect(slot("experience")).toHaveAttribute("data-active", "false");
      expect(slot("experience")).toHaveClass("lg:hidden");

      // Still mounted: switching sections must not remount and lose state, and
      // below lg the same tree is one continuous scroll.
      expect(screen.getByTestId("resume-section-experience")).toBeInTheDocument();
    });

    it("moves between sections from the pager and ends on the download step", async () => {
      mockEmptyProfileFetch();

      renderResumePage();
      await screen.findByRole("heading", { name: "Personal info" });

      expect(screen.getByTestId("resume-pager-position")).toHaveTextContent("1 of 6");
      expect(screen.getByTestId("resume-pager-prev")).toBeDisabled();

      fireEvent.click(screen.getByTestId("resume-pager-next"));

      expect(screen.getByTestId("resume-pager-position")).toHaveTextContent("2 of 6");
      expect(slot("summary")).toHaveAttribute("data-active", "true");
      expect(slot("personal")).toHaveClass("lg:hidden");
      expect(screen.getByTestId("resume-pager-prev")).not.toBeDisabled();

      // Walk to the last section; "next" gives way to the closing action.
      for (let i = 0; i < 4; i++) {
        fireEvent.click(screen.getByTestId("resume-pager-next"));
      }

      expect(screen.getByTestId("resume-pager-position")).toHaveTextContent("6 of 6");
      expect(screen.queryByTestId("resume-pager-next")).not.toBeInTheDocument();
      expect(screen.getByTestId("resume-pager-finish")).toBeInTheDocument();
    });

    it("remembers the section across sessions", async () => {
      window.localStorage.setItem("joblit.resume.lastSection", "projects");
      mockEmptyProfileFetch();

      renderResumePage();
      await screen.findByRole("heading", { name: "Personal info" });

      await waitFor(() =>
        expect(slot("projects")).toHaveAttribute("data-active", "true"),
      );
      expect(screen.getByTestId("resume-pager-position")).toHaveTextContent("4 of 6");
    });
  });

  /**
   * Entries used to close each other: opening the second role collapsed the
   * first, so comparing two of them meant toggling back and forth. Expansion
   * is now tracked per row id, which also means a reorder or a delete needs
   * no index remapping to keep the right cards open.
   */
  it("keeps several entries open at once and closes them together", async () => {
    mockEmptyProfileFetch();

    renderResumePage();
    await screen.findByRole("heading", { name: "Professional experience" });

    // A second role, which historically stole the open slot from the first.
    fireEvent.click(screen.getByRole("button", { name: /Add (experience|role)/i }));

    const experienceSection = screen.getByTestId("resume-section-experience");
    const entryToggles = () =>
      Array.from(
        // The section's own collapse toggle also carries aria-expanded; only
        // it has aria-controls, so this selects the entry cards alone.
        experienceSection.querySelectorAll<HTMLButtonElement>(
          "button[aria-expanded]:not([aria-controls])",
        ),
      );

    // Both cards are open at once — the second no longer displaces the first.
    expect(entryToggles().map((b) => b.getAttribute("aria-expanded"))).toEqual([
      "true",
      "true",
    ]);

    // Collapse-all only appears while something is open.
    const collapseAll = screen
      .getAllByTestId("resume-collapse-all")
      .find((node) => node.closest('[data-testid="resume-section-experience"]'));
    expect(collapseAll).toBeDefined();

    fireEvent.click(collapseAll!);

    // Framer keeps exiting nodes mounted for a beat, so assert the state the
    // user and assistive tech actually observe.
    expect(entryToggles().map((b) => b.getAttribute("aria-expanded"))).toEqual([
      "false",
      "false",
    ]);
    // With nothing open the control retires rather than sitting there inert.
    expect(
      screen
        .queryAllByTestId("resume-collapse-all")
        .some((node) => node.closest('[data-testid="resume-section-experience"]')),
    ).toBe(false);
  });

  it("adds experience bullets on the production experience section", async () => {
    mockEmptyProfileFetch();

    renderResumePage();

    expect(
      await screen.findByRole("heading", { name: "Professional experience" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Add bullet" })[0]);

    expect(screen.getAllByLabelText(/^Experience bullets \d+$/)).toHaveLength(2);
  });

  it("opens the mobile-safe preview dialog from the preview action", async () => {
    mockEmptyProfileFetch();

    renderResumePage();
    await fillBasics();

    const previewButton = firstButton("Preview");
    expect(previewButton).toBeEnabled();
    fireEvent.click(previewButton);

    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();
    expect(screen.getByTestId("resume-preview-dialog")).toHaveClass(
      "h-[100dvh]",
      "w-[100vw]",
      "sm:h-[92vh]",
    );
  });

  it("autosaves after the user stops typing and reports it quietly", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile") && init?.method === "POST") {
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderResumePage();
    await fillBasics();

    const savePosts = () =>
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          toUrl(input).startsWith("/api/resume-profile") &&
          (init as RequestInit | undefined)?.method === "POST",
      ).length;

    // No click anywhere: the burst of edits settles into exactly one save.
    await waitFor(() => expect(savePosts()).toBe(1), { timeout: 3000 });
    expect(await screen.findByTestId("resume-save-indicator")).toHaveTextContent("Saved");
    await waitFor(() => {
      expect(guideMocks.markTaskComplete).toHaveBeenCalledWith("resume_setup");
    });
  }, 10_000);

  it("surfaces a retry — and keeps the draft — when autosave fails", async () => {
    let failNext = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile") && init?.method === "POST") {
        if (failNext) {
          failNext = false;
          return new Response("nope", { status: 500 });
        }
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderResumePage();
    await fillBasics();

    const indicator = await screen.findByTestId("resume-save-indicator");
    await waitFor(() => expect(indicator).toHaveTextContent("Couldn't save"), {
      timeout: 3000,
    });
    // The draft is still in the form — a failed save must never clear it.
    expect(screen.getByLabelText("Full name")).toHaveValue("Jane Doe");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(indicator).toHaveTextContent("Saved"), { timeout: 3000 });
  }, 10_000);

  it("saves a basics-only draft with a schema-valid body (drops seeded empty rows)", async () => {
    let savedBody: unknown = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile") && init?.method === "POST") {
        savedBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderResumePage();
    await fillBasics();

    await waitFor(
      () => {
        expect(savedBody).not.toBeNull();
      },
      { timeout: 3000 },
    );

    // The untouched sections seed one empty placeholder row each; the save
    // payload must drop them so it passes the same schema the server enforces
    // (otherwise the whole save 400s).
    const parsed = ResumeProfileSchema.safeParse(savedBody);
    expect(parsed.success).toBe(true);
    const body = savedBody as Record<string, unknown>;
    expect(body.experiences).toEqual([]);
    expect(body.projects).toEqual([]);
    expect(body.education).toEqual([]);
    expect(body.skills).toEqual([]);
    expect(body.links).toBeNull();
  });

  it("refreshes the preview when a field is committed, not while typing", async () => {
    type PreviewPayload = { basics?: { title?: string } };
    const previewWaiters: Array<(payload: PreviewPayload) => void> = [];
    const waitForNextPreview = () =>
      new Promise<PreviewPayload>((resolve) => {
        previewWaiters.push(resolve);
      });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(populatedProfileJson()), { status: 200 });
      }
      if (url === "/api/resume-pdf") {
        const payload = JSON.parse(String(init?.body)) as PreviewPayload;
        previewWaiters.shift()?.(payload);
        return new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderResumePage();
    expect(await screen.findByLabelText("Title")).toHaveValue("Software Engineer");

    const initialPreview = waitForNextPreview();
    fireEvent.click(firstButton("Preview"));
    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();
    expect((await initialPreview).basics?.title).toBe("Software Engineer");

    const refreshedPreview = waitForNextPreview();
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Senior Software Engineer" } });
    // Leaving the field is the commit. Typing alone must not compile — that is
    // what made the preview feel like it was permanently refreshing.
    fireEvent.blur(title);
    expect((await refreshedPreview).basics?.title).toBe("Senior Software Engineer");
  });

  it("does not save when only the locale changes", async () => {
    // Switching languages changed the save payload (locale is part of it) and
    // so marked the untouched draft dirty. Autosave then wrote the PREVIOUS
    // locale's content — under the previous locale's profileId — into the new
    // locale, which repointed that locale's active profile at the wrong
    // resume. Switching must be clean: the new locale's profile is fetched,
    // nothing is written.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(populatedProfileJson()), { status: 200 });
      }
      if (url === "/api/resume-pdf") {
        return new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      void init;
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const saveCalls = () =>
      fetchMock.mock.calls.filter(
        ([firstArg, init]) =>
          toUrl(firstArg).startsWith("/api/resume-profile") &&
          (init as RequestInit | undefined)?.method === "POST",
      ).length;

    const view = renderResumePage();
    expect(await screen.findByLabelText("Title")).toHaveValue("Software Engineer");
    expect(saveCalls()).toBe(0);

    view.rerender(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <div className="app-shell">
          <ResumeFormProvider>
            <ResumePageLayout />
          </ResumeFormProvider>
        </div>
      </NextIntlClientProvider>,
    );

    // Well past the 800ms autosave debounce.
    await new Promise((resolve) => setTimeout(resolve, 1400));
    expect(saveCalls()).toBe(0);
  }, 15_000);

  it("compiles once the typing stops, without waiting for a commit", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(populatedProfileJson()), { status: 200 });
      }
      if (url === "/api/resume-pdf") {
        return new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const previewCalls = () =>
      fetchMock.mock.calls.filter(([firstArg]) => toUrl(firstArg) === "/api/resume-pdf").length;

    renderResumePage();
    expect(await screen.findByLabelText("Title")).toHaveValue("Software Engineer");
    fireEvent.click(firstButton("Preview"));
    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();
    await waitFor(() => expect(previewCalls()).toBe(1));

    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Staff Engineer" } });
    fireEvent.change(title, { target: { value: "Staff Platform Engineer" } });

    // Mid-pause: still quiet. A refresh per keystroke would strobe the preview
    // and burn the render budget.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(previewCalls()).toBe(1);

    // Once typing stops the preview catches up on its own — the user never has
    // to leave the field to see what they wrote.
    await waitFor(() => expect(previewCalls()).toBe(2), { timeout: 8000 });

    // And the whole burst cost exactly one compile, not one per keystroke.
    expect(previewCalls()).toBe(2);
  }, 20_000);

  /**
   * The render budget is invisible to the user and not something they can act
   * on, so hitting it must not look like a broken preview. The last good PDF
   * stays painted and the pending badge already says the draft has moved on.
   */
  it("degrades quietly when the render budget is exhausted", async () => {
    let pdfCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(populatedProfileJson()), { status: 200 });
      }
      if (url === "/api/resume-pdf") {
        pdfCalls += 1;
        // First compile succeeds so there is a PDF on screen to protect.
        if (pdfCalls === 1) {
          return new Response(new Uint8Array([37, 80, 68, 70]), {
            status: 200,
            headers: { "content-type": "application/pdf" },
          });
        }
        return new Response(
          JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow down" } }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "30" },
          },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderResumePage();
    expect(await screen.findByLabelText("Title")).toHaveValue("Software Engineer");
    fireEvent.click(firstButton("Preview"));
    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();
    await waitFor(() => expect(pdfCalls).toBe(1));

    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Staff Platform Engineer" } });
    fireEvent.blur(title);

    await waitFor(() => expect(pdfCalls).toBe(2));

    // No error banner, and the PDF that was already rendered is still there.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("resume-pdf-preview").length).toBeGreaterThan(0);
  }, 20_000);

  it("does not POST the preview while a required field is mid-edit (no 400 spam)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      if (url === "/api/resume-pdf") {
        return new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const getPreviewCallCount = () =>
      fetchMock.mock.calls.filter(([firstArg]) => toUrl(firstArg) === "/api/resume-pdf").length;

    renderResumePage();
    await fillBasics();

    fireEvent.click(firstButton("Preview"));
    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();

    await waitFor(() => {
      expect(getPreviewCallCount()).toBe(1);
    });

    // Half-typed email fails the shared schema — the client must hold the last
    // good preview and NOT POST (which would 400 on the server).
    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "jane@" } });
    fireEvent.blur(email);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(getPreviewCallCount()).toBe(1);

    // Completing the email back to a valid value resumes preview rendering.
    fireEvent.change(email, { target: { value: "jane@example.org" } });
    fireEvent.blur(email);
    await waitFor(
      () => {
        expect(getPreviewCallCount()).toBe(2);
      },
      { timeout: 2200 },
    );
  }, 15_000);
});
