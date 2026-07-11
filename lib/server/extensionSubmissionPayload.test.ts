import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ext/submissions/route";
import { CreateSubmissionSchema } from "./extensionSubmissionPayload";

const routeMocks = vi.hoisted(() => ({
  createFormSubmission: vi.fn().mockResolvedValue({ id: "submission-1" }),
}));

vi.mock("@/lib/server/auth/requireExtensionToken", () => ({
  ExtensionTokenError: class ExtensionTokenError extends Error {},
  requireExtensionToken: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/server/extensionSubmission", () => ({
  createFormSubmission: routeMocks.createFormSubmission,
  listFormSubmissions: vi.fn(),
}));

vi.mock("@/lib/server/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  rateLimitHeaders: vi.fn().mockReturnValue({}),
  rateLimitKeyFromRequest: vi.fn().mockReturnValue("test-key"),
}));

function validPayload() {
  return {
    pageUrl: "https://jobs.example.com/apply/software-engineer",
    pageDomain: "jobs.example.com",
    atsProvider: "workday",
    formSignature: "workday-software-engineer-v1",
    fieldValues: {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      shippingAddress: "12 Example Street",
    },
    fieldMappings: {
      firstName: {
        source: "profile",
        profilePath: "personal.firstName",
        confidence: 0.99,
      },
      email: {
        source: "profile",
        profilePath: "personal.email",
        confidence: 0.95,
      },
    },
    jobId: "7de5881c-bd11-4d06-9fe8-23df3ecb9d7e",
  };
}

describe("CreateSubmissionSchema", () => {
  it("accepts a realistic safe submission payload", () => {
    expect(CreateSubmissionSchema.safeParse(validPayload()).success).toBe(true);
  });

  it.each([
    ["password", "accountPassword"],
    ["password numeric suffix", "password2"],
    ["passcode", "passcode"],
    ["PIN", "pin"],
    ["PIN numeric suffix", "pin1"],
    ["OTP", "otpCode"],
    ["compact OTP code", "otpcode"],
    ["verification", "verificationCode"],
    ["security code", "security-code"],
    ["CVV", "cvv"],
    ["CVV2", "paymentCvv2"],
    ["CVC", "cvc"],
    ["card number", "creditCardNumber"],
    ["card number numeric suffix", "cardNumber1"],
    ["bank account", "bankAccountNumber"],
    ["bank account numeric suffix", "bankAccount2"],
    ["routing", "routingNumber"],
    ["compact routing numeric suffix", "routingnumber1"],
    ["BSB", "bsb"],
    ["BSB numeric suffix", "bsb1"],
    ["IBAN", "iban"],
    ["IBAN numeric suffix", "iban2"],
    ["SWIFT", "swiftCode"],
    ["SWIFT numeric suffix", "swift1"],
    ["SSN", "ssn"],
    ["SSN numeric suffix", "ssn1"],
    ["social security", "socialSecurityNumber"],
    ["TFN", "tfn"],
    ["TFN numeric suffix", "tfn2"],
    ["tax file", "taxFileNumber"],
    ["passport", "passportNumber"],
    ["passport numeric suffix", "passport1"],
    ["driver licence", "driversLicenceNumber"],
    ["driver licence numeric suffix", "driversLicence2"],
    ["national id", "nationalId"],
    ["national id numeric suffix", "nationalId1"],
  ])("rejects a %s fieldValues key", (_family, key) => {
    const payload = validPayload();
    payload.fieldValues = { [key]: "secret" };

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    ["prefixed password", "userpassword"],
    ["prefixed verification code", "emailverificationcode"],
    ["prefixed card number", "billingcreditcardnumber"],
    ["prefixed passport number", "candidatepassportnumber"],
  ])("rejects a compact lowercase %s suffix", (_family, key) => {
    const payload = validPayload();
    payload.fieldValues = { [key]: "secret" };

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it("allows a compact sensitive phrase followed by a safe suffix", () => {
    const payload = validPayload();
    payload.fieldValues = {
      candidatecreditcardnumberstatus: "not-collected",
    };

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(true);
  });

  it.each([
    ["postal PIN code", "postalPinCode"],
    ["shipping postal PIN code", "shippingPostalPinCode"],
    ["billing address PIN code", "billingAddressPinCode"],
    ["compact postal PIN code", "postalpincode"],
    ["employment verification contact", "employmentVerificationContact"],
    ["employment verification email", "employmentverificationemail"],
    ["passport issuing country", "passportIssuingCountry"],
  ])("allows a non-sensitive recruitment/address field: %s", (_label, key) => {
    const payload = validPayload();
    payload.fieldValues = { [key]: "safe-value" };

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(true);
  });

  it.each([
    "accountVerificationPin",
    "securityPin",
    "emailverificationtoken",
    "userpasswordconfirmation",
    "candidateGovernmentId",
    "candidateTaxIdentifier",
  ])("still rejects a sensitive suffix: %s", (key) => {
    const payload = validPayload();
    payload.fieldValues = { [key]: "secret" };

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a sensitive fieldMappings key instead of dropping it", () => {
    const payload = validPayload();
    payload.fieldMappings = {
      securityCode: {
        source: "profile",
        profilePath: "security.code",
        confidence: 0.9,
      },
    };

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it.each(["fieldValues", "fieldMappings"] as const)(
    "rejects more than 200 %s entries",
    (field) => {
      const payload = validPayload();
      const entries = Object.fromEntries(
        Array.from({ length: 201 }, (_, index) =>
          field === "fieldValues"
            ? [`answer${index}`, "value"]
            : [
                `answer${index}`,
                { source: "profile", confidence: 0.8 },
              ],
        ),
      );
      payload[field] = entries as typeof payload[typeof field];

      expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
    },
  );

  it.each(["fieldValues", "fieldMappings"] as const)(
    "rejects a %s key longer than 200 characters",
    (field) => {
      const payload = validPayload();
      const longKey = `answer-${"k".repeat(194)}`;
      payload[field] = (field === "fieldValues"
        ? { [longKey]: "value" }
        : {
            [longKey]: { source: "profile", confidence: 0.8 },
          }) as typeof payload[typeof field];

      expect(longKey).toHaveLength(201);
      expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
    },
  );

  it("rejects a field value longer than 10,000 characters", () => {
    const payload = validPayload();
    payload.fieldValues = { coverLetter: "x".repeat(10_001) };

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    ["source", "x".repeat(51)],
    ["profilePath", "x".repeat(201)],
  ] as const)("rejects an overlong mapping %s", (key, value) => {
    const payload = validPayload();
    payload.fieldMappings = {
      firstName: {
        source: key === "source" ? value : "profile",
        profilePath: key === "profilePath" ? value : "personal.firstName",
        confidence: 0.9,
      },
    };

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects field data larger than 250 KiB when serialized as UTF-8", () => {
    const payload = validPayload();
    payload.fieldValues = Object.fromEntries(
      Array.from({ length: 26 }, (_, index) => [
        `answer${index}`,
        "界".repeat(4_000),
      ]),
    );
    payload.fieldMappings = {};

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects unknown mapping metadata instead of measuring stripped output", () => {
    const payload = validPayload();
    payload.fieldMappings = {
      firstName: {
        source: "profile",
        confidence: 0.9,
        cachedValue: "x".repeat(260 * 1024),
      },
    } as typeof payload.fieldMappings;

    expect(CreateSubmissionSchema.safeParse(payload).success).toBe(false);
  });
});

describe("submission route validation", () => {
  it("returns generic INVALID_BODY details for a sensitive payload", async () => {
    routeMocks.createFormSubmission.mockClear();
    const payload = validPayload();
    payload.fieldValues = { accountPassword: "secret" };
    const request = new Request("https://www.joblit.tech/api/ext/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "INVALID_BODY",
          message: "Invalid request body",
          details: expect.any(Object),
        }),
      }),
    );
    expect(routeMocks.createFormSubmission).not.toHaveBeenCalled();
  });

  it("returns INVALID_BODY for a prefixed compact sensitive key", async () => {
    routeMocks.createFormSubmission.mockClear();
    const payload = validPayload();
    payload.fieldValues = { billingcreditcardnumber: "4111111111111111" };
    const request = new Request("https://www.joblit.tech/api/ext/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toEqual(
      expect.objectContaining({
        code: "INVALID_BODY",
        message: "Invalid request body",
      }),
    );
    expect(routeMocks.createFormSubmission).not.toHaveBeenCalled();
  });
});
