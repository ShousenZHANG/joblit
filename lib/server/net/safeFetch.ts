import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 2;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_REDIRECT_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
];

export type SafeOutboundErrorCode =
  | "INVALID_URL"
  | "HTTPS_REQUIRED"
  | "URL_CREDENTIALS_FORBIDDEN"
  | "HOST_NOT_ALLOWED"
  | "DNS_LOOKUP_FAILED"
  | "DNS_NO_ADDRESSES"
  | "PRIVATE_ADDRESS_FORBIDDEN"
  | "TOO_MANY_REDIRECTS"
  | "REDIRECT_LOCATION_INVALID"
  | "RESPONSE_TOO_LARGE"
  | "REQUEST_FAILED"
  | "REQUEST_TIMEOUT";

export class SafeOutboundError extends Error {
  constructor(
    public readonly code: SafeOutboundErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SafeOutboundError";
  }
}

export type SafeHostResolver = (
  hostname: string,
) => Promise<readonly { address: string; family?: number }[]>;

export type SafeOutboundPolicy = {
  /** Exact hosts, or their subdomains when `allowSubdomains` is true. */
  allowedHosts?: readonly string[];
  allowSubdomains?: boolean;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  /**
   * Permit a plain-http destination.
   *
   * SSRF protection and transport encryption are separate concerns, and this
   * flag relaxes only the second. Every address check still applies: a
   * loopback, private, link-local or metadata address stays blocked whether or
   * not this is set. It exists for an operator-configured endpoint — a URL
   * that is trusted input by definition, unlike a URL derived from a request.
   *
   * Anything sent to such a destination, including credentials, travels in
   * cleartext. Callers must gate this behind an explicit deployment opt-in.
   */
  allowInsecureHttp?: boolean;
  /** Test seam. Production callers must use the default DNS resolver. */
  resolver?: SafeHostResolver;
  /** Test seam. Production callers must use the platform fetch. */
  fetchImpl?: typeof fetch;
};

function normalizedHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function displayUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function hostAllowed(
  hostname: string,
  allowedHosts: readonly string[],
  allowSubdomains: boolean,
): boolean {
  const candidate = normalizedHostname(hostname);
  return allowedHosts.some((rawHost) => {
    const allowed = normalizedHostname(rawHost);
    if (!allowed) return false;
    return (
      candidate === allowed ||
      (allowSubdomains && candidate.endsWith(`.${allowed}`))
    );
  });
}

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) {
    return null;
  }
  return (
    ((octets[0] << 24) >>> 0) +
    (octets[1] << 16) +
    (octets[2] << 8) +
    octets[3]
  ) >>> 0;
}

function inIpv4Cidr(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

const BLOCKED_IPV4_CIDRS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

function parseIpv6(address: string): number[] | null {
  const clean = normalizedHostname(address).split("%", 1)[0];
  if (isIP(clean) !== 6) return null;

  const expandSide = (side: string): number[] => {
    if (!side) return [];
    const parts = side.split(":");
    const out: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const ipv4 = ipv4Number(part);
        if (ipv4 === null) return [];
        out.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
      } else {
        out.push(Number.parseInt(part || "0", 16));
      }
    }
    return out;
  };

  if (clean.includes("::")) {
    const [leftRaw, rightRaw, ...extra] = clean.split("::");
    if (extra.length) return null;
    const left = expandSide(leftRaw);
    const right = expandSide(rightRaw);
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    return [...left, ...Array<number>(missing).fill(0), ...right];
  }

  const full = expandSide(clean);
  return full.length === 8 ? full : null;
}

/**
 * Reject every address that cannot be a normal public Internet destination.
 * Includes loopback, RFC1918, link-local/metadata, CGNAT, documentation,
 * benchmark, multicast/reserved IPv4, and IPv6 loopback/ULA/link-local,
 * transition, documentation, and multicast ranges.
 */
export function isPrivateOrReservedAddress(rawAddress: string): boolean {
  const address = normalizedHostname(rawAddress).split("%", 1)[0];
  const ipv4 = ipv4Number(address);
  if (ipv4 !== null) {
    return BLOCKED_IPV4_CIDRS.some(([base, prefix]) => {
      const baseNumber = ipv4Number(base);
      return baseNumber !== null && inIpv4Cidr(ipv4, baseNumber, prefix);
    });
  }

  const words = parseIpv6(address);
  if (!words) return true;

  const allZero = words.every((word) => word === 0);
  const loopback =
    words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  if (allZero || loopback) return true;

  // IPv4-mapped / IPv4-compatible IPv6. Apply the IPv4 policy to the tail.
  const mapped =
    words.slice(0, 5).every((word) => word === 0) &&
    (words[5] === 0 || words[5] === 0xffff);
  if (mapped) {
    const embedded = ((words[6] << 16) | words[7]) >>> 0;
    return BLOCKED_IPV4_CIDRS.some(([base, prefix]) => {
      const baseNumber = ipv4Number(base);
      return baseNumber !== null && inIpv4Cidr(embedded, baseNumber, prefix);
    });
  }

  const first = words[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // deprecated site-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && words[1] === 0x0db8) return true; // documentation
  if (first === 0x2001 && words[1] === 0x0000) return true; // Teredo
  if (first === 0x2002) return true; // 6to4 can tunnel private IPv4
  if (
    first === 0x0064 &&
    words[1] === 0xff9b &&
    words.slice(2, 6).every((word) => word === 0)
  ) {
    return true; // NAT64 mapped destinations
  }
  return false;
}

async function defaultResolver(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export function parseSafeOutboundUrl(
  input: string | URL,
  policy: Pick<
    SafeOutboundPolicy,
    "allowedHosts" | "allowSubdomains" | "allowInsecureHttp"
  > = {},
): URL {
  let parsed: URL;
  try {
    parsed = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch (cause) {
    throw new SafeOutboundError("INVALID_URL", "Outbound URL is invalid", cause);
  }
  const schemeAllowed =
    parsed.protocol === "https:" ||
    (policy.allowInsecureHttp === true && parsed.protocol === "http:");
  if (!schemeAllowed) {
    throw new SafeOutboundError(
      "HTTPS_REQUIRED",
      `Outbound URL must use HTTPS: ${displayUrl(parsed)}`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new SafeOutboundError(
      "URL_CREDENTIALS_FORBIDDEN",
      `Outbound URL credentials are forbidden: ${displayUrl(parsed)}`,
    );
  }
  if (
    policy.allowedHosts &&
    !hostAllowed(
      parsed.hostname,
      policy.allowedHosts,
      policy.allowSubdomains ?? false,
    )
  ) {
    throw new SafeOutboundError(
      "HOST_NOT_ALLOWED",
      `Outbound host is not allowlisted: ${parsed.hostname}`,
    );
  }
  return parsed;
}

export async function assertPublicOutboundUrl(
  input: string | URL,
  policy: SafeOutboundPolicy = {},
): Promise<URL> {
  const parsed = parseSafeOutboundUrl(input, policy);
  const hostname = normalizedHostname(parsed.hostname);
  const literalFamily = isIP(hostname);
  let addresses: readonly { address: string; family?: number }[];

  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await (policy.resolver ?? defaultResolver)(hostname);
    } catch (cause) {
      throw new SafeOutboundError(
        "DNS_LOOKUP_FAILED",
        `DNS lookup failed for outbound host: ${hostname}`,
        cause,
      );
    }
  }

  if (!addresses.length) {
    throw new SafeOutboundError(
      "DNS_NO_ADDRESSES",
      `DNS returned no addresses for outbound host: ${hostname}`,
    );
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedAddress(address)) {
      throw new SafeOutboundError(
        "PRIVATE_ADDRESS_FORBIDDEN",
        `Outbound host resolved to a non-public address: ${hostname}`,
      );
    }
  }
  return parsed;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeOutboundError(
      "RESPONSE_TOO_LARGE",
      `Outbound response exceeds ${maxBytes} bytes`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new SafeOutboundError(
        "RESPONSE_TOO_LARGE",
        `Outbound response exceeds ${maxBytes} bytes`,
      );
    }
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SafeOutboundError(
        "RESPONSE_TOO_LARGE",
        `Outbound response exceeds ${maxBytes} bytes`,
      );
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function redirectedInit(
  currentUrl: URL,
  nextUrl: URL,
  status: number,
  init: RequestInit,
): RequestInit {
  const headers = new Headers(init.headers);
  if (currentUrl.origin !== nextUrl.origin) {
    for (const name of SENSITIVE_REDIRECT_HEADERS) headers.delete(name);
  }

  const method = (init.method ?? "GET").toUpperCase();
  if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
    headers.delete("content-length");
    headers.delete("content-type");
    return { ...init, method: "GET", body: undefined, headers };
  }
  return { ...init, headers };
}

/**
 * Unified server-only outbound gateway.
 *
 * Security invariants:
 * - HTTPS by default; HTTP requires an explicit caller opt-in.
 * - Optional exact/subdomain host allowlist.
 * - DNS is checked before every request, including each redirect hop.
 * - Any private/reserved answer rejects the whole hostname (DNS rebinding /
 *   split-horizon preflight protection). Platform fetch may resolve again at
 *   connect time, so this is not verified-IP pinning.
 * - Redirects are manual, bounded, and cross-origin credentials are stripped.
 * - One total timeout and a streaming response-size ceiling.
 */
export async function safeOutboundFetch(
  input: string | URL,
  init: RequestInit = {},
  policy: SafeOutboundPolicy = {},
): Promise<Response> {
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes =
    policy.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new TypeError("Invalid safe outbound policy limits");
  }

  const controller = new AbortController();
  const parentSignal = init.signal;
  const relayAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) relayAbort();
  else parentSignal?.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new SafeOutboundError("REQUEST_TIMEOUT", "Outbound request timed out"),
      ),
    timeoutMs,
  );

  try {
    let current = await assertPublicOutboundUrl(input, policy);
    let currentInit: RequestInit = { ...init, redirect: "manual" };
    const fetchImpl = policy.fetchImpl ?? fetch;

    for (let redirects = 0; ; redirects += 1) {
      let response: Response;
      try {
        response = await fetchImpl(current, {
          ...currentInit,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (cause) {
        if (controller.signal.aborted && !parentSignal?.aborted) {
          throw new SafeOutboundError(
            "REQUEST_TIMEOUT",
            "Outbound request timed out",
            cause,
          );
        }
        if (parentSignal?.aborted) throw cause;
        throw new SafeOutboundError(
          "REQUEST_FAILED",
          `Outbound request failed: ${displayUrl(current)}`,
          cause instanceof Error ? { name: cause.name } : undefined,
        );
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          throw new SafeOutboundError(
            "REDIRECT_LOCATION_INVALID",
            "Outbound redirect omitted Location",
          );
        }
        if (redirects >= maxRedirects) {
          throw new SafeOutboundError(
            "TOO_MANY_REDIRECTS",
            "Outbound redirect limit exceeded",
          );
        }

        let next: URL;
        try {
          next = new URL(location, current);
        } catch (cause) {
          throw new SafeOutboundError(
            "REDIRECT_LOCATION_INVALID",
            "Outbound redirect Location is invalid",
            cause,
          );
        }
        next = await assertPublicOutboundUrl(next, policy);
        currentInit = redirectedInit(current, next, response.status, currentInit);
        current = next;
        continue;
      }

      const bytes = await readBoundedBody(response, maxResponseBytes);
      const noBody = response.status === 204 || response.status === 205 || response.status === 304;
      const body = noBody
        ? null
        : (bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", relayAbort);
  }
}
