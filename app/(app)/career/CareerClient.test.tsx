import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { CareerClient } from "./CareerClient";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const OFFER_ID = "22222222-2222-4222-8222-222222222222";
const REMINDER_ID = "33333333-3333-4333-8333-333333333333";
const STORY_ID = "44444444-4444-4444-8444-444444444444";

const analytics = {
  funnel: {
    counts: {
      applied: 12,
      interview: 6,
      offer: 2,
      accepted: 1,
      rejected: 3,
      withdrawn: 1,
    },
    conversion: {
      appliedToInterview: 0.5,
      interviewToOffer: 0.3333,
      offerToAccepted: 0.5,
    },
    medianDays: {
      appliedToInterview: 5.5,
      interviewToOffer: 3,
      offerToAccepted: 2,
    },
    sampleSizes: {
      appliedToInterview: 4,
      interviewToOffer: 2,
      offerToAccepted: 1,
    },
  },
  offers: {
    currencies: [
      {
        currency: "AUD",
        offers: [
          {
            id: OFFER_ID,
            company: "Acme",
            role: "Platform Engineer",
            currency: "AUD",
            baseSalaryAnnual: 150_000,
            bonusAnnual: 10_000,
            equityAnnual: 5_000,
            otherAnnual: 0,
            targetSalaryAnnual: 175_000,
            totalAnnual: 165_000,
            incomplete: false,
            salaryGap: 10_000,
            rank: 1,
          },
        ],
      },
    ],
    crossCurrencyComparison: false,
    note: "No exchange rate assumed.",
  },
};

const offer = {
  id: OFFER_ID,
  jobId: JOB_ID,
  company: "Acme",
  role: "Platform Engineer",
  currency: "AUD",
  baseSalaryAnnual: 150_000,
  bonusAnnual: 10_000,
  equityAnnual: 5_000,
  otherAnnual: 0,
  targetSalaryAnnual: 175_000,
  benefits: ["Remote-first"],
  location: "Sydney",
  status: "ACTIVE",
  receivedAt: "2026-07-20T00:00:00.000Z",
  deadlineAt: "2026-08-01T00:00:00.000Z",
  notes: null,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input.toString();
}

function installFetchMock() {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";

      if (url === "/api/career/analytics" && method === "GET") {
        return json({ data: analytics, requestId: "req-analytics" });
      }
      if (url === "/api/career/reminders" && method === "GET") {
        return json({
          data: {
            persisted: [],
            suggestions: [
              {
                key: "application:job:date",
                jobId: JOB_ID,
                type: "APPLICATION_FOLLOW_UP",
                title: "Follow up on application",
                dueAt: "2026-07-18T00:00:00.000Z",
                reason: "Five days have passed.",
              },
            ],
          },
          requestId: "req-reminders",
        });
      }
      if (url === "/api/career/reminders" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        return json(
          {
            data: {
              id: REMINDER_ID,
              applicationId: null,
              note: null,
              completedAt: null,
              dismissedAt: null,
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:00.000Z",
              ...body,
            },
            requestId: "req-reminder-create",
          },
          201,
        );
      }
      if (url === "/api/career/reminders" && method === "PATCH") {
        const body = JSON.parse(String(init?.body));
        return json({
          data: {
            id: body.id,
            jobId: JOB_ID,
            applicationId: null,
            type: "APPLICATION_FOLLOW_UP",
            title: "Follow up on application",
            dueAt: "2026-07-18T00:00:00.000Z",
            note: null,
            completedAt: "2026-07-20T01:00:00.000Z",
            dismissedAt: null,
            createdAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-20T01:00:00.000Z",
          },
          requestId: "req-reminder-patch",
        });
      }
      if (url === "/api/career/interviews" && method === "GET") {
        return json({ data: [], requestId: "req-interviews" });
      }
      if (url === "/api/career/star-stories" && method === "GET") {
        return json({ data: [], requestId: "req-stories" });
      }
      if (url === "/api/career/star-stories" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        return json(
          {
            data: {
              id: STORY_ID,
              reflection: null,
              skills: [],
              tags: [],
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:00.000Z",
              ...body,
            },
            requestId: "req-story-create",
          },
          201,
        );
      }
      if (url === "/api/career/offers" && method === "GET") {
        return json({ data: [offer], requestId: "req-offers" });
      }
      if (url === "/api/career/toolkit" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        if (body.action === "negotiation") {
          return json({
            data: {
              script: "Thank you for the offer. I would like to discuss the package.",
              factsUsed: {
                company: "Acme",
                role: "Platform Engineer",
                offeredTotal: 165_000,
                targetTotal: 175_000,
                strengths: body.strengths,
              },
              inventedFacts: [],
            },
            requestId: "req-toolkit",
          });
        }
      }
      if (url.startsWith("/api/jobs?") && method === "GET") {
        return json({
          items: [
            {
              id: JOB_ID,
              title: "Platform Engineer",
              company: "Acme",
              status: "INTERVIEW",
            },
          ],
        });
      }

      return json({ error: { message: `Unhandled ${method} ${url}` } }, 500);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCareer() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CareerClient />
    </NextIntlClientProvider>,
  );
}

describe("CareerClient", () => {
  beforeEach(() => {
    installFetchMock();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the real funnel and supports keyboard tab navigation", async () => {
    const user = userEvent.setup();
    renderCareer();

    expect(
      await screen.findByRole("heading", { name: "Pipeline health" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("50%")).toHaveLength(2);
    expect(screen.getByText("5.5 days")).toBeInTheDocument();

    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    await user.keyboard("{ArrowRight}");

    expect(
      screen.getByRole("tab", { name: "Interviews" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", {
        name: "Prepare from evidence, not memory",
      }),
    ).toBeVisible();
  });

  it("saves a suggested follow-up and completes it", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock();
    renderCareer();

    const save = await screen.findByRole("button", { name: "Save" });
    await user.click(save);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Complete Follow up on application",
        }),
      ).toBeInTheDocument();
    });
    const post = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestUrl(input) === "/api/career/reminders" &&
        init?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      jobId: JOB_ID,
      type: "APPLICATION_FOLLOW_UP",
      title: "Follow up on application",
    });

    await user.click(
      screen.getByRole("button", {
        name: "Complete Follow up on application",
      }),
    );

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input) === "/api/career/reminders" &&
          init?.method === "PATCH",
      );
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        id: REMINDER_ID,
        completed: true,
      });
    });
  });

  it("creates a complete STAR+R story from the evidence form", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock();
    renderCareer();

    await screen.findByRole("heading", { name: "Pipeline health" });
    await user.click(screen.getByRole("tab", { name: "STAR stories" }));
    await user.click(screen.getByRole("button", { name: "New story" }));

    await user.type(screen.getByLabelText("Story title"), "Recovered checkout");
    await user.type(screen.getByLabelText("Situation"), "Errors increased.");
    await user.type(screen.getByLabelText("Task"), "Restore reliability.");
    await user.type(screen.getByLabelText("Action"), "Led incident response.");
    await user.type(screen.getByLabelText("Result"), "Error rate fell 80%.");
    await user.type(screen.getByLabelText("Skills"), "AWS, Reliability");
    await user.click(screen.getByRole("button", { name: "Save story" }));

    expect(
      await screen.findByRole("heading", { name: "Recovered checkout" }),
    ).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestUrl(input) === "/api/career/star-stories" &&
        init?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      title: "Recovered checkout",
      result: "Error rate fell 80%.",
      skills: ["AWS", "Reliability"],
    });
  }, 15_000);

  it("builds a grounded negotiation script for a selected offer", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchMock();
    renderCareer();

    await screen.findByRole("heading", { name: "Pipeline health" });
    await user.click(screen.getByRole("tab", { name: "Offers" }));

    const negotiation = screen.getByRole("heading", {
      name: "Negotiation builder",
    }).closest("section");
    expect(negotiation).not.toBeNull();
    await user.type(
      within(negotiation as HTMLElement).getByLabelText(
        "Verifiable strengths",
      ),
      "Led a verified migration",
    );
    await user.click(
      within(negotiation as HTMLElement).getByRole("button", {
        name: "Build script",
      }),
    );

    expect(
      await within(negotiation as HTMLElement).findByText(
        /I would like to discuss the package/,
      ),
    ).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestUrl(input) === "/api/career/toolkit" &&
        init?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      action: "negotiation",
      offerId: OFFER_ID,
      strengths: ["Led a verified migration"],
      locale: "en",
    });
  });
});
