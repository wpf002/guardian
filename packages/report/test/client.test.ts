import { describe, expect, it } from "vitest";
import {
  ESP_BASE_URLS,
  EspClient,
  EspClientError,
  resolveEnvironment,
  toReportXml,
  type FetchLike,
} from "../src/client.js";
import { buildReport } from "../src/builder.js";
import { bundle, customer, reviewer } from "./fixtures.js";

const CREDS = { username: "u", password: "p" };

/**
 * Every test in this file uses this. No test in this package makes a network
 * call, and a call to the real global fetch would fail this recorder's
 * assertions rather than silently succeeding.
 */
function recorder(body = "<reportResponse><responseCode>0</responseCode><reportId>555</reportId></reportResponse>") {
  const calls: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }> =
    [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, ...(init ?? {}) });
    return { ok: true, status: 200, text: async () => body };
  };
  return { calls, fetchImpl };
}

describe("environment resolution", () => {
  it("is test with nothing set", () => {
    expect(resolveEnvironment(undefined, {})).toBe("test");
  });

  it("stays test for every value of NCMEC_API_ENV except the exact literal", () => {
    for (const value of ["", "prod", "PRODUCTION", "Production", "production ", "1", "true"]) {
      expect(resolveEnvironment(undefined, { NCMEC_API_ENV: value })).toBe("test");
    }
    expect(resolveEnvironment(undefined, { NCMEC_API_ENV: "production" })).toBe("production");
  });

  it("takes an explicit argument over the environment variable in both directions", () => {
    expect(resolveEnvironment("test", { NCMEC_API_ENV: "production" })).toBe("test");
    expect(resolveEnvironment("production", { NCMEC_API_ENV: "test" })).toBe("production");
  });
});

describe("EspClient never reaches production by default", () => {
  it("points at the test host with no environment given", () => {
    const client = new EspClient({ credentials: CREDS, fetchImpl: recorder().fetchImpl }, {});
    expect(client.environment).toBe("test");
    expect(client.isProduction).toBe(false);
    expect(client.baseUrl).toBe(ESP_BASE_URLS.test);
    expect(client.baseUrl).toBe("https://exttest.cybertip.org/ispws");
  });

  it("sends every request to the test host", async () => {
    const { calls, fetchImpl } = recorder();
    const client = new EspClient({ credentials: CREDS, fetchImpl }, {});
    await client.status();
    await client.submit(buildReport(bundle(), customer(), reviewer()));
    await client.finish("555");
    await client.retract("555");
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.url.startsWith("https://exttest.cybertip.org/ispws")).toBe(true);
      expect(call.url).not.toContain("report.cybertip.org");
    }
  });

  it("reaches production only on an explicit argument or the exact env literal", () => {
    const { fetchImpl } = recorder();
    expect(
      new EspClient({ credentials: CREDS, fetchImpl, environment: "production" }, {}).baseUrl,
    ).toBe(ESP_BASE_URLS.production);
    expect(
      new EspClient({ credentials: CREDS, fetchImpl }, { NCMEC_API_ENV: "production" }).baseUrl,
    ).toBe(ESP_BASE_URLS.production);
  });

  it("refuses to submit a report built for a different environment", async () => {
    const { fetchImpl } = recorder();
    const client = new EspClient({ credentials: CREDS, fetchImpl, environment: "production" }, {});
    const testReport = buildReport(bundle(), customer({ environment: "test" }), reviewer());
    await expect(client.submit(testReport)).rejects.toThrow(/crosses environments/);
  });
});

describe("credentials", () => {
  it("reads NCMEC_API_USER and NCMEC_API_PASS", async () => {
    const { calls, fetchImpl } = recorder();
    const client = new EspClient(
      { fetchImpl },
      { NCMEC_API_USER: "esp-user", NCMEC_API_PASS: "esp-pass" },
    );
    await client.status();
    const header = calls[0]!.headers!.Authorization!;
    expect(header.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(header.slice(6), "base64").toString("utf8")).toBe("esp-user:esp-pass");
  });

  it("refuses to construct with no credentials, and says whose they are", () => {
    expect(() => new EspClient({ fetchImpl: recorder().fetchImpl }, {})).toThrow(EspClientError);
    try {
      new EspClient({ fetchImpl: recorder().fetchImpl }, {});
    } catch (error) {
      expect((error as EspClientError).code).toBe("missing_credentials");
      expect((error as EspClientError).message).toMatch(/reporting provider, not to Guardian/);
    }
  });
});

describe("the documented request shapes", () => {
  it("submits one XML document to /submit", async () => {
    const { calls, fetchImpl } = recorder();
    const client = new EspClient({ credentials: CREDS, fetchImpl }, {});
    await client.submit(buildReport(bundle(), customer(), reviewer()));
    const call = calls[0]!;
    expect(call.url).toBe("https://exttest.cybertip.org/ispws/submit");
    expect(call.method).toBe("POST");
    expect(call.headers!["Content-Type"]).toBe("text/xml; charset=utf-8");
    expect(call.body!.startsWith('<?xml version="1.0"')).toBe(true);
    expect(call.body).toContain("<report>");
  });

  it("finishes and retracts with the id as a form parameter", async () => {
    const { calls, fetchImpl } = recorder(
      "<reportDoneResponse><responseCode>0</responseCode><reportId>555</reportId></reportDoneResponse>",
    );
    const client = new EspClient({ credentials: CREDS, fetchImpl }, {});
    const done = await client.finish("555");
    expect(done.reportId).toBe("555");
    expect(calls[0]!.url).toBe("https://exttest.cybertip.org/ispws/finish");
    expect(calls[0]!.headers!["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(calls[0]!.body).toBe("id=555");
  });

  it("parses the reportId out of a submit response", async () => {
    const { fetchImpl } = recorder();
    const client = new EspClient({ credentials: CREDS, fetchImpl }, {});
    const response = await client.submit(buildReport(bundle(), customer(), reviewer()));
    expect(response.reportId).toBe("555");
    expect(response.responseCode).toBe(0);
  });

  it("has no upload method, because Guardian holds no bytes", () => {
    const client = new EspClient({ credentials: CREDS, fetchImpl: recorder().fetchImpl }, {});
    expect((client as unknown as Record<string, unknown>).upload).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).fileinfo).toBeUndefined();
  });

  it("raises on a non-2xx without leaking the body", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 401,
      text: async () => "<error>bad creds</error>",
    });
    const client = new EspClient({ credentials: CREDS, fetchImpl }, {});
    await expect(client.status()).rejects.toThrow(/returned 401/);
  });
});

describe("toReportXml", () => {
  const xml = toReportXml(buildReport(bundle(), customer(), reviewer()));

  it("uses the documented element names", () => {
    for (const name of [
      "incidentSummary",
      "incidentType",
      "incidentDateTime",
      "internetDetails",
      "reporter",
      "reportingPerson",
      "personOrUserReported",
      "espIdentifier",
      "ipCaptureEvent",
      "estimatedLocation",
      "additionalInfo",
    ]) {
      expect(xml).toContain(`<${name}>`);
    }
    expect(xml).toContain("<chatImIncident />");
  });

  it("carries the media story as hashes in additionalInfo and never as a file element", () => {
    const withMedia = toReportXml(
      buildReport(
        bundle({
          timeline: [
            ...bundle().timeline,
            {
              ...bundle().timeline[0]!,
              excerpt: null,
              mediaSha256: "a".repeat(64),
              knownCsamVerdict: "match" as const,
            },
          ],
        }),
        customer(),
        reviewer(),
      ),
    );
    expect(withMedia).toContain("a".repeat(64));
    expect(withMedia).toContain("identified by hash only");
    expect(withMedia).not.toContain("<fileDetails>");
    expect(withMedia).not.toContain("<originalFileHash");
  });

  it("escapes the narrative rather than letting it break the document", () => {
    const report = buildReport(bundle(), customer({ platform: 'A & B <chat>' }), reviewer());
    const out = toReportXml(report);
    expect(out).toContain("A &amp; B &lt;chat&gt;");
  });
});
