import { PassThrough } from "stream";
import {
  buildDeepLinkUrl,
  defineGeminiOmnibarElement,
  discoverBrowserIdentity,
  formatGeminiMarkdown,
  GeminiOmnibarElement,
  initOmnibar,
  oktaTokenFromStorage,
  parseJsonChunks,
  prepareOmnibarSearchPayload,
  renderSourcesHtml,
  resolveCloudIdentityEmail,
  searchDiscoveryEngineDirect
} from "../packages/omnibar-wc/src/index";

const nodeProxy = require("../backends/node-proxy/index.js");

describe("Customer-Agnostic Identity Transform Strategies (Browser & Proxy)", () => {
  it("defaults to passthrough strategy for standard corporate emails", () => {
    expect(resolveCloudIdentityEmail("Jane.Doe@Acme.com")).toBe("jane.doe@acme.com");
    expect(nodeProxy.resolveCloudIdentityEmail("Jane.Doe@Acme.com")).toBe("jane.doe@acme.com");
  });

  it("supports domain_rewrite strategy to map opaque subdomain UPNs to first.last@domain", () => {
    const cfg = {
      strategy: "domain_rewrite" as const,
      targetDomain: "company.com",
      sourceDomain: "corp.company.com"
    };
    expect(
      resolveCloudIdentityEmail("abc123@nam.corp.company.com", "Jane", "Doe", "Doe, Jane", cfg)
    ).toBe("jane.doe@company.com");

    expect(
      nodeProxy.resolveCloudIdentityEmail(
        "abc123@nam.corp.company.com",
        "Jane",
        "Doe",
        "Doe, Jane",
        cfg
      )
    ).toBe("jane.doe@company.com");

    // When no given/family claims exist, rewrites the domain portion
    expect(
      resolveCloudIdentityEmail("jdoe@emea.corp.company.com", "", "", "", cfg)
    ).toBe("jdoe@company.com");
  });

  it("supports claim_template strategy for custom email patterns", () => {
    const cfg = {
      strategy: "claim_template" as const,
      targetDomain: "enterprise.org",
      claimTemplate: "{given_name}.{family_name}@{domain}"
    };
    expect(
      resolveCloudIdentityEmail("u998877@internal.local", "", "", "Kaladin Stormblessed", cfg)
    ).toBe("kaladin.stormblessed@enterprise.org");

    expect(
      nodeProxy.resolveCloudIdentityEmail(
        "u998877@internal.local",
        "",
        "",
        "Stormblessed, Kaladin",
        cfg
      )
    ).toBe("kaladin.stormblessed@enterprise.org");
  });
});

describe("Gemini Enterprise Node Proxy Backend (backends/node-proxy/index.js)", () => {
  it("creates a session via POST .../sessions, patches userPseudoId if needed, and calls :streamAssist", async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    const mockRequestFn = jest.fn(async (url: string, opts: any) => {
      calls.push({ url, method: opts.method, body: opts.body });
      if (url.endsWith("/sessions")) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            name: "projects/demo-proj/locations/global/collections/default_collection/engines/demo-engine/sessions/9876543210",
            state: "IN_PROGRESS",
            userPseudoId: "initial-pseudo"
          })
        };
      }
      if (url.includes("?updateMask=userPseudoId")) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            name: "projects/demo-proj/locations/global/collections/default_collection/engines/demo-engine/sessions/9876543210",
            userPseudoId: "9876543210"
          })
        };
      }
      if (url.endsWith(":streamAssist")) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify([
            {
              answer: {
                replies: [
                  {
                    groundedContent: {
                      content: {
                        thought: true,
                        text: "Internal chain-of-thought that must be stripped"
                      }
                    }
                  },
                  {
                    groundedContent: {
                      content: {
                        text: "**Kaladin Stormblessed** is a Windrunner [1]."
                      },
                      textGroundingMetadata: {
                        references: [
                          {
                            content: "Kaladin is captain of Bridge Four.",
                            documentMetadata: {
                              title: "The Way of Kings",
                              uri: "https://coppermind.net/wiki/Kaladin"
                            }
                          }
                        ]
                      }
                    }
                  }
                ]
              },
              sessionInfo: {
                session:
                  "projects/demo-proj/locations/global/collections/default_collection/engines/demo-engine/sessions/9876543210"
              }
            }
          ])
        };
      }
      throw new Error("Unexpected URL: " + url);
    });

    const result = await nodeProxy.searchGeminiEnterprise({
      query: "Who is Kaladin?",
      session: "",
      mode: "streamAssist",
      configOverrides: {
        projectId: "demo-proj",
        location: "global",
        engineId: "demo-engine",
        widgetConfigId: "00000000-0000-0000-0000-000000000000"
      },
      tokenProvider: async () => "fake-oauth-token",
      requestFn: mockRequestFn
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/sessions");
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].url).toContain("updateMask=userPseudoId");
    expect(calls[1].body).toEqual({ userPseudoId: "9876543210" });
    expect(calls[2].method).toBe("POST");
    expect(calls[2].url).toContain(":streamAssist");

    expect(result.sessionId).toBe("9876543210");
    expect(result.deepLinkUrl).toBe(
      "https://vertexaisearch.cloud.google.com/u/0/home/cid/00000000-0000-0000-0000-000000000000/r/session/9876543210"
    );
    expect(result.summary).toBe("**Kaladin Stormblessed** is a Windrunner [1].");
    expect(result.summary).not.toContain("Internal chain-of-thought");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe("The Way of Kings");
  });

  it("supports Express middleware delegation for non-omnibar routes", () => {
    const middleware = nodeProxy.createExpressMiddleware();
    const next = jest.fn();
    middleware({ url: "/some-other-route", method: "GET" }, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  describe("Negative & Adversarial Input Validation", () => {
    it("rejects empty, whitespace-only, or oversized queries and invalid modes", async () => {
      await expect(
        nodeProxy.searchGeminiEnterprise({
          query: "   ",
          configOverrides: { projectId: "p", engineId: "e" },
          tokenProvider: async () => "tok"
        })
      ).rejects.toThrow("query_required");

      await expect(
        nodeProxy.searchGeminiEnterprise({
          query: "a".repeat(4005),
          configOverrides: { projectId: "p", engineId: "e" },
          tokenProvider: async () => "tok"
        })
      ).rejects.toThrow("query_too_long");

      await expect(
        nodeProxy.searchGeminiEnterprise({
          query: "valid",
          mode: "sqlInjectionMode",
          configOverrides: { projectId: "p", engineId: "e" },
          tokenProvider: async () => "tok"
        })
      ).rejects.toThrow("invalid_mode");
    });

    it("rejects hostile session path traversal and invalid GCP location injection", async () => {
      await expect(
        nodeProxy.searchGeminiEnterprise({
          query: "test",
          session: "../../../etc/passwd",
          configOverrides: { projectId: "p", engineId: "e" },
          tokenProvider: async () => "tok"
        })
      ).rejects.toThrow("invalid_session_format");

      expect(() =>
        nodeProxy.getGeminiConfig({
          location: "evil.example.com/v1#"
        })
      ).toThrow(/invalid_gcp_location/);
    });

    it("rejects malformed or unbalanced JSON stream chunks in both browser and proxy parsers", () => {
      expect(() => parseJsonChunks('{"unterminated": "string')).toThrow(/malformed_json_stream/);
      expect(() => parseJsonChunks('{"extra": 1}}')).toThrow(
        /malformed_json_stream_unbalanced_braces/
      );
      expect(() => nodeProxy.parseJsonChunks('{"unterminated": "string')).toThrow(
        /malformed_json_stream/
      );
      expect(() => nodeProxy.parseJsonChunks('{"extra": 1}}')).toThrow(
        /malformed_json_stream_unbalanced_braces/
      );
    });

    it("returns HTTP 400 on malformed JSON POST body and HTTP 401 when user identity is missing", async () => {
      const badReq = new PassThrough() as any;
      badReq.method = "POST";
      badReq.url = "/api/search";
      let status1 = 0;
      let body1 = "";
      const res1 = {
        writeHead(s: number) {
          status1 = s;
        },
        end(c: string) {
          body1 = c;
        }
      };
      nodeProxy.attachGeminiSearchRoute(badReq, res1, "/api/search");
      badReq.write("{malformed json");
      badReq.end();
      await new Promise((r) => setTimeout(r, 20));
      expect(status1).toBe(400);
      expect(JSON.parse(body1)).toEqual({ error: "invalid_json" });

      const unauthReq = new PassThrough() as any;
      unauthReq.method = "POST";
      unauthReq.url = "/api/search";
      unauthReq.headers = { "content-type": "application/json" };
      let status2 = 0;
      let body2 = "";
      const res2 = {
        writeHead(s: number) {
          status2 = s;
        },
        end(c: string) {
          body2 = c;
        }
      };
      nodeProxy.attachGeminiSearchRoute(unauthReq, res2, "/api/search");
      unauthReq.write(JSON.stringify({ query: "who am i?" }));
      unauthReq.end();
      await new Promise((r) => setTimeout(r, 20));
      expect(status2).toBe(401);
      expect(JSON.parse(body2)).toMatchObject({ error: "user_identity_required" });
    });
  });
});

describe("Pluggable Enterprise Auth Adapters (MSAL, Okta, IAP, GIS)", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("discovers Okta identity and token from okta-token-storage", () => {
    window.localStorage.setItem(
      "okta-token-storage",
      JSON.stringify({
        idToken: {
          idToken: "eyJhbGciOiJSUzI1NiJ9.e30.sig",
          claims: {
            email: "shallan.davar@roshar.org",
            given_name: "Shallan",
            family_name: "Davar",
            name: "Shallan Davar"
          }
        }
      })
    );

    const okta = oktaTokenFromStorage();
    expect(okta).not.toBeNull();
    expect(okta?.token).toBe("eyJhbGciOiJSUzI1NiJ9.e30.sig");

    const identity = discoverBrowserIdentity();
    expect(identity).toMatchObject({
      email: "shallan.davar@roshar.org",
      givenName: "Shallan",
      familyName: "Davar",
      provider: "okta"
    });
  });

  it("acquires per-user Google OAuth token via GIS with login_hint and rejects mismatched cached user tokens", async () => {
    // Seed a cached token for a DIFFERENT user to ensure it is rejected
    window.sessionStorage.setItem(
      "ge_omnibar_google_oauth",
      JSON.stringify({
        accessToken: "mock-oauth-WRONG_USER_TOKEN",
        email: "other.user@company.com",
        expiresAt: Date.now() + 3600_000
      })
    );

    const gisCalls: Array<{ client_id: string; hint: string; prompt: string }> = [];
    const originalGoogle = (window as any).google;
    (window as any).google = {
      accounts: {
        oauth2: {
          initTokenClient(cfg: any) {
            return {
              requestAccessToken(override: any) {
                const prompt = override?.prompt ?? cfg.prompt ?? "";
                const hint = override?.hint ?? cfg.hint ?? "";
                gisCalls.push({ client_id: cfg.client_id, hint, prompt });
                if (prompt === "") {
                  cfg.callback({ error: "interaction_required" });
                } else {
                  cfg.callback({
                    access_token: "mock-oauth-VALID_USER_TOKEN",
                    expires_in: 3599
                  });
                }
              }
            };
          }
        }
      }
    };

    try {
      const prepared = await prepareOmnibarSearchPayload(
        "quarterly roadmap",
        "",
        "streamAssist",
        "alice.smith@company.com",
        "123456-client.apps.googleusercontent.com"
      );

      expect(gisCalls).toHaveLength(2);
      expect(gisCalls[0]).toEqual({
        client_id: "123456-client.apps.googleusercontent.com",
        hint: "alice.smith@company.com",
        prompt: ""
      });
      expect(gisCalls[1]).toEqual({
        client_id: "123456-client.apps.googleusercontent.com",
        hint: "alice.smith@company.com",
        prompt: "select_account"
      });
      expect(prepared.headers["X-User-Email"]).toBe("alice.smith@company.com");
      expect(prepared.headers["X-Google-Access-Token"]).toBe("mock-oauth-VALID_USER_TOKEN");
      expect(prepared.body.googleAccessToken).toBe("mock-oauth-VALID_USER_TOKEN");
    } finally {
      (window as any).google = originalGoogle;
    }
  });
});

describe("Markdown & Grounded Citation Engine (packages/omnibar-wc/src/markdown.ts)", () => {
  it("formats headings, lists, tables, code blocks, and inline [1] citation badges", () => {
    const md = [
      "### Architecture Overview",
      "Here is **grounded** info [1]:",
      "- First *important* item",
      "- Second `code` item",
      "",
      "| Component | Role |",
      "| --- | --- |",
      "| Omnibar | UI |",
      "",
      "```ts",
      "const x = 42;",
      "```"
    ].join("\n");

    const html = formatGeminiMarkdown(md, [
      { index: 1, title: "Design Doc", url: "https://cloud.google.com/docs", snippet: "Spec" }
    ]);

    expect(html).toContain('<h4 class="ge-omnibar-heading">Architecture Overview</h4>');
    expect(html).toContain("<strong>grounded</strong>");
    expect(html).toContain('href="https://cloud.google.com/docs"');
    expect(html).toContain("<td>Omnibar</td>");
    expect(html).toContain('<div class="ge-omnibar-code-lang">ts</div>');
  });

  it("neutralizes hostile XSS scripts and javascript:/data: URLs in Markdown and citations", () => {
    const hostileMd =
      '<script>alert("xss")</script> [Evil](javascript:alert(1)) [Data](data:text/html,<script>alert(1)</script>) [Safe](https://google.com)';
    const html = formatGeminiMarkdown(hostileMd, [
      { index: 1, title: '<img src=x onerror=alert(1)>', url: "javascript:evil()", snippet: "bad" }
    ]);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).toContain('href="https://google.com"');

    const sourcesHtml = renderSourcesHtml([
      { index: 1, title: "<script>bad</script>", url: "javascript:alert(1)", snippet: "bad" }
    ]);
    expect(sourcesHtml).not.toContain("<script>");
    expect(sourcesHtml).not.toContain("javascript:");
  });
});

describe("<gemini-omnibar> Shadow DOM Web Component (Proxy & Serverless Direct Modes)", () => {
  beforeAll(() => {
    defineGeminiOmnibarElement("gemini-omnibar");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders encapsulated Shadow DOM pill bar, mode selector, and expand-down drawer in Proxy Mode", async () => {
    const originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = jest.fn(async (url: string) => {
      if (String(url).endsWith("/api/config")) {
        return {
          ok: true,
          json: async () => ({
            widgetConfigId: "00000000-0000-0000-0000-000000000000",
            webAppBaseUrl:
              "https://vertexaisearch.cloud.google.com/u/0/home/cid/00000000-0000-0000-0000-000000000000"
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          session:
            "projects/demo/locations/global/collections/default_collection/engines/eng/sessions/77889900",
          sessionId: "77889900",
          deepLinkUrl:
            "https://vertexaisearch.cloud.google.com/u/0/home/cid/00000000-0000-0000-0000-000000000000/r/session/77889900",
          summary: "**Dalinar Kholin** is a Bondsmith [1].",
          results: [{ index: 1, title: "Oathbringer", url: "https://coppermind.net", snippet: "Lore" }]
        })
      };
    });

    try {
      const el = document.createElement("gemini-omnibar") as GeminiOmnibarElement;
      el.setAttribute("theme", "dark");
      el.setAttribute("placeholder", "Ask Gemini Enterprise");
      document.body.appendChild(el);

      const shadow = el.shadowRoot!;
      expect(shadow).not.toBeNull();

      const input = shadow.querySelector("#agent-search") as HTMLInputElement;
      const sendBtn = shadow.querySelector(".send-button") as HTMLButtonElement;
      const drawer = shadow.querySelector("#ge-omnibar-drawer") as HTMLElement;

      expect(input.placeholder).toBe("Ask Gemini Enterprise");
      expect(sendBtn.disabled).toBe(true);
      expect(drawer.hidden).toBe(true);

      let successEventDetail: any = null;
      el.addEventListener("ge-search-success", (e: Event) => {
        successEventDetail = (e as CustomEvent).detail;
      });

      input.value = "Who is Dalinar?";
      input.dispatchEvent(new Event("input"));
      expect(sendBtn.disabled).toBe(false);

      await el.submitQuery("Who is Dalinar?");

      expect(drawer.hidden).toBe(false);
      expect(shadow.innerHTML).toContain("<strong>Dalinar Kholin</strong>");
      expect(el.state.sessionId).toBe("77889900");

      const openAppBtn = shadow.querySelector("#ge-open-app") as HTMLAnchorElement;
      expect(openAppBtn.href).toBe(
        "https://vertexaisearch.cloud.google.com/u/0/home/cid/00000000-0000-0000-0000-000000000000/r/session/77889900"
      );
      expect(successEventDetail).not.toBeNull();
      expect(successEventDetail.sessionId).toBe("77889900");
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it("executes Topology A (100% Serverless Browser-Direct Mode) against Discovery Engine REST endpoints", async () => {
    window.sessionStorage.setItem(
      "ge_omnibar_google_oauth",
      JSON.stringify({
        accessToken: "mock-oauth-DIRECT_BROWSER_TOKEN",
        email: "user@company.com",
        expiresAt: Date.now() + 3600_000
      })
    );

    const directCalls: Array<{ url: string; method: string }> = [];
    const mockDirectRequestFn = jest.fn(async (url: string, opts: any) => {
      directCalls.push({ url, method: opts.method });
      if (url.endsWith("/sessions")) {
        return {
          status: 200,
          body: JSON.stringify({
            name: "projects/direct-proj/locations/global/collections/default_collection/engines/direct-eng/sessions/44556677",
            state: "IN_PROGRESS",
            userPseudoId: "44556677"
          })
        };
      }
      if (url.endsWith(":streamAssist")) {
        return {
          status: 200,
          body: JSON.stringify([
            {
              answer: {
                replies: [
                  {
                    groundedContent: {
                      content: { text: "Direct browser response [1]." },
                      textGroundingMetadata: {
                        references: [
                          {
                            content: "Direct snippet",
                            documentMetadata: {
                              title: "Direct Doc",
                              uri: "https://cloud.google.com"
                            }
                          }
                        ]
                      }
                    }
                  }
                ]
              }
            }
          ])
        };
      }
      throw new Error("Unexpected direct URL: " + url);
    });

    try {
      const el = document.createElement("gemini-omnibar") as GeminiOmnibarElement;
      el.setAttribute("mode", "direct");
      el.setAttribute("project-id", "direct-proj");
      el.setAttribute("location", "global");
      el.setAttribute("engine-id", "direct-eng");
      el.setAttribute("widget-config-id", "cid-direct-999");
      el.directRequestFn = mockDirectRequestFn;
      document.body.appendChild(el);

      await el.submitQuery("Test serverless mode");

      expect(directCalls).toHaveLength(2);
      expect(directCalls[0].url).toBe(
        "https://discoveryengine.googleapis.com/v1alpha/projects/direct-proj/locations/global/collections/default_collection/engines/direct-eng/sessions"
      );
      expect(directCalls[1].url).toBe(
        "https://discoveryengine.googleapis.com/v1alpha/projects/direct-proj/locations/global/collections/default_collection/engines/direct-eng/assistants/default_assistant:streamAssist"
      );
      expect(el.state.sessionId).toBe("44556677");
      expect(el.state.deepLinkUrl).toBe(
        "https://vertexaisearch.cloud.google.com/u/0/home/cid/cid-direct-999/r/session/44556677"
      );
      expect(el.shadowRoot!.innerHTML).toContain("Direct browser response");
    } finally {
      window.sessionStorage.clear();
    }
  });

  it("uses Proxy Mode (POST /api/search) when project-id and engine-id attributes are set without mode='direct'", async () => {
    const originalFetch = (globalThis as any).fetch;
    let postedBody: any = null;
    (globalThis as any).fetch = jest.fn(async (url: string, opts?: any) => {
      if (String(url).endsWith("/api/config")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            projectId: "custom-gcp-project",
            location: "global",
            engineId: "custom-gemini-engine",
            userEmail: "jane.doe@acme.com"
          })
        };
      }
      if (String(url).endsWith("/api/search")) {
        postedBody = opts && opts.body ? JSON.parse(opts.body) : null;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session:
              "projects/custom-gcp-project/locations/global/collections/default_collection/engines/custom-gemini-engine/sessions/99887766",
            sessionId: "99887766",
            summary: "Proxy override response [1].",
            results: [{ index: 1, title: "Doc", url: "https://cloud.google.com", snippet: "ok" }]
          })
        };
      }
      throw new Error("Unexpected URL: " + url);
    });

    try {
      const el = document.createElement("gemini-omnibar") as GeminiOmnibarElement;
      el.setAttribute("project-id", "custom-gcp-project");
      el.setAttribute("location", "global");
      el.setAttribute("engine-id", "custom-gemini-engine");
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 20));

      await el.submitQuery("Summarize Q4 priorities");

      expect(postedBody).not.toBeNull();
      expect(postedBody.projectId).toBe("custom-gcp-project");
      expect(postedBody.engineId).toBe("custom-gemini-engine");
      expect(el.shadowRoot!.innerHTML).toContain("Proxy override response");
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it("rejects hostile inputs in direct client (path traversal, invalid location, missing token)", async () => {
    await expect(
      searchDiscoveryEngineDirect({
        query: "hello",
        session: "../../../etc/passwd",
        config: { projectId: "p", engineId: "e" },
        tokenProvider: async () => "mock-oauth-tok"
      })
    ).rejects.toThrow("invalid_session_format");

    await expect(
      searchDiscoveryEngineDirect({
        query: "hello",
        config: { projectId: "p", location: "evil.host/x", engineId: "e" },
        tokenProvider: async () => "mock-oauth-tok"
      })
    ).rejects.toThrow(/invalid_gcp_location/);

    await expect(
      searchDiscoveryEngineDirect({
        query: "hello",
        config: { projectId: "p", engineId: "e" },
        tokenProvider: async () => ""
      })
    ).rejects.toThrow("google_oauth_token_required");
  });
});

describe("Standalone Node Proxy Server (backends/node-proxy/server.js)", () => {
  const { server } = require("../backends/node-proxy/server.js");
  const http = require("http");

  function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}${path}`, (res: any) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString("utf8")
            })
          );
        })
        .on("error", reject);
    });
  }

  it("serves /healthz, /api/config, /gemini-omnibar.js bundle, and / playground HTML", async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const health = await httpGet(port, "/healthz");
      expect(health.status).toBe(200);
      expect(JSON.parse(health.body)).toEqual({ status: "ok" });

      const cfg = await httpGet(port, "/api/config");
      expect(cfg.status).toBe(200);
      expect(JSON.parse(cfg.body)).toHaveProperty("apiMethod", "streamAssist");

      const bundle = await httpGet(port, "/gemini-omnibar.js");
      expect(bundle.status).toBe(200);
      expect(bundle.body).toContain("gemini-omnibar");

      const demo = await httpGet(port, "/");
      expect(demo.status).toBe(200);
      expect(demo.body).toContain("<gemini-omnibar");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Search Bar Variants (large, small, icon) & Cloud Run IAP Identity Parser", () => {
  const {
    resolveVariant,
    parseIapIdentityHeader,
    VARIANT_LARGE_METADATA,
    VARIANT_SMALL_METADATA,
    VARIANT_ICON_METADATA
  } = require("../packages/omnibar-wc/src/index");

  beforeAll(() => {
    defineGeminiOmnibarElement("gemini-omnibar");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("normalizes variant strings and falls back safely to 'large' on unknown or hostile values", () => {
    expect(resolveVariant("large")).toBe("large");
    expect(resolveVariant("SMALL")).toBe("small");
    expect(resolveVariant("  icon ")).toBe("icon");
    expect(resolveVariant(null)).toBe("large");
    expect(resolveVariant("unknown-variant")).toBe("large");
    expect(resolveVariant("<script>alert(1)</script>")).toBe("large");

    expect(VARIANT_LARGE_METADATA.variant).toBe("large");
    expect(VARIANT_SMALL_METADATA.variant).toBe("small");
    expect(VARIANT_ICON_METADATA.variant).toBe("icon");
  });

  it("applies variant='small' and variant='icon' attributes and handles icon click-to-expand and Escape-to-collapse", () => {
    const smallEl = document.createElement("gemini-omnibar") as GeminiOmnibarElement;
    smallEl.setAttribute("variant", "small");
    document.body.appendChild(smallEl);

    expect(smallEl.getAttribute("data-variant")).toBe("small");
    const smallBar = smallEl.shadowRoot!.querySelector(".omnibar") as HTMLElement;
    expect(smallBar.getAttribute("data-variant")).toBe("small");

    const iconEl = document.createElement("gemini-omnibar") as GeminiOmnibarElement;
    iconEl.setAttribute("variant", "icon");
    document.body.appendChild(iconEl);

    expect(iconEl.getAttribute("data-variant")).toBe("icon");
    const iconBar = iconEl.shadowRoot!.querySelector(".ge-omnibar-shell") as HTMLElement;
    const prefixIcon = iconEl.shadowRoot!.querySelector(".prefix-icon") as HTMLElement;
    const input = iconEl.shadowRoot!.querySelector("#agent-search") as HTMLInputElement;

    expect(iconBar.classList.contains("is-icon-expanded")).toBe(false);

    // Clicking the 40x40 search icon expands the icon variant
    prefixIcon.click();
    expect(iconBar.classList.contains("is-icon-expanded")).toBe(true);

    // Pressing Escape when input is empty and drawer is closed collapses the icon variant
    input.value = "";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(iconBar.classList.contains("is-icon-expanded")).toBe(false);
  });

  it("parses Cloud Run IAP identity headers and rejects malformed or non-email headers", () => {
    expect(parseIapIdentityHeader("accounts.google.com:Jane.Doe@Company.com")).toBe(
      "jane.doe@company.com"
    );
    expect(parseIapIdentityHeader("User@Example.org")).toBe("user@example.org");
    expect(parseIapIdentityHeader("")).toBe("");
    expect(parseIapIdentityHeader(null)).toBe("");
    expect(parseIapIdentityHeader("accounts.google.com:not-an-email")).toBe("");
  });
});

describe("Pattern 2: Server-Side Google OAuth 2.0 + PKCE + Encrypted Refresh Token Cookie", () => {
  const crypto = require("crypto");
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "123456-test.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "GOCSPX-test-secret-value";
    process.env.GOOGLE_OAUTH_COOKIE_SECRET = "test-cookie-encryption-secret-key-32b";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:8080/api/auth/google/callback";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("seals and unseals AES-256-GCM OAuth payloads and rejects tampered ciphertext, auth tags, or wrong secrets", () => {
    const keyAlpha = crypto.createHash("sha256").update("secret-alpha", "utf8").digest();
    const keyBeta = crypto.createHash("sha256").update("secret-beta", "utf8").digest();
    const payload = {
      email: "kaladin@roshar.org",
      refreshToken: "1//0g-refresh-token-abc",
      issuedAt: Date.now()
    };
    const sealed = nodeProxy.sealOAuthPayload(payload, keyAlpha);
    expect(sealed.split(".")).toHaveLength(4);
    expect(sealed.startsWith("v1.")).toBe(true);

    const unsealed = nodeProxy.unsealOAuthPayload(sealed, keyAlpha);
    expect(unsealed).toEqual(payload);

    // Wrong secret must be rejected with oauth_cookie_invalid_or_tampered
    expect(() => nodeProxy.unsealOAuthPayload(sealed, keyBeta)).toThrow(
      "oauth_cookie_invalid_or_tampered"
    );

    // Tampered ciphertext or auth tag must be rejected
    const [verPart, ivPart, tagPart, dataPart] = sealed.split(".");
    const tamperedData = dataPart.slice(0, -2) + (dataPart.endsWith("A") ? "B" : "A");
    expect(() =>
      nodeProxy.unsealOAuthPayload(`${verPart}.${ivPart}.${tagPart}.${tamperedData}`, keyAlpha)
    ).toThrow("oauth_cookie_invalid_or_tampered");
    const tamperedTag = tagPart.slice(0, -2) + (tagPart.endsWith("A") ? "B" : "A");
    expect(() =>
      nodeProxy.unsealOAuthPayload(`${verPart}.${ivPart}.${tamperedTag}.${dataPart}`, keyAlpha)
    ).toThrow("oauth_cookie_invalid_or_tampered");
    expect(() => nodeProxy.unsealOAuthPayload("malformed.token", keyAlpha)).toThrow(
      "oauth_cookie_invalid_or_tampered"
    );
  });

  it("generates RFC 7636 S256 PKCE pairs and neutralizes open-redirect returnTo URLs", () => {
    const pkce = nodeProxy.generatePkcePair();
    expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.codeChallenge.length).toBeGreaterThanOrEqual(43);
    expect(pkce.codeChallenge).not.toBe(pkce.codeVerifier);

    expect(nodeProxy.sanitizeOAuthReturnUrl("/dashboard?tab=search")).toBe("/dashboard?tab=search");
    expect(nodeProxy.sanitizeOAuthReturnUrl("https://evil.example.com/phish")).toBe("/");
    expect(nodeProxy.sanitizeOAuthReturnUrl("//evil.example.com/phish")).toBe("/");
    expect(nodeProxy.sanitizeOAuthReturnUrl("/\\evil.example.com")).toBe("/");
    expect(nodeProxy.sanitizeOAuthReturnUrl("javascript:alert(1)")).toBe("/");
  });

  it("redirects /api/auth/google/login with PKCE S256 + login_hint + prompt=none and sets encrypted HttpOnly state cookie", () => {
    const req: any = {
      method: "GET",
      url: "/api/auth/google/login?login_hint=Alice.Smith%40Company.com&mode=popup&prompt=none&returnUrl=%2Fportal",
      headers: { host: "localhost:8080" }
    };
    let status = 0;
    let headers: Record<string, any> = {};
    const res = {
      writeHead(s: number, h: Record<string, any>) {
        status = s;
        headers = h || {};
      },
      end() {}
    };

    const handled = nodeProxy.attachGeminiSearchRoute(req, res, "/api/auth/google/login");
    expect(handled).toBe(true);
    expect(status).toBe(302);
    expect(headers.Location).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
    expect(headers.Location).toContain("code_challenge_method=S256");
    expect(headers.Location).toContain("access_type=offline");
    expect(headers.Location).toContain("login_hint=alice.smith%40company.com");
    expect(headers.Location).toContain("prompt=none");
    expect(String(headers["Set-Cookie"])).toContain(nodeProxy.OAUTH_STATE_COOKIE_NAME + "=");
    expect(String(headers["Set-Cookie"])).toContain("HttpOnly");
  });

  it("Rejects /api/auth/google/callback when state cookie is missing/mismatched or authenticated Google email mismatches expected user", async () => {
    const validState = "state-nonce-123";
    const stateCookieVal = nodeProxy.sealOAuthPayload({
      state: validState,
      codeVerifier: "verifier-xyz",
      loginHint: "alice.smith@company.com",
      returnUrl: "/",
      mode: "popup",
      exp: Date.now() + 600_000
    });

    // 1. State mismatch -> 400 oauth_invalid_state
    let statusMismatch = 0;
    let bodyMismatch = "";
    const reqMismatch: any = {
      method: "GET",
      url: "/api/auth/google/callback?state=WRONG_STATE&code=auth-code-1",
      headers: {
        host: "localhost:8080",
        cookie: `${nodeProxy.OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(stateCookieVal)}`
      }
    };
    nodeProxy.attachGeminiSearchRoute(
      reqMismatch,
      {
        writeHead(s: number) {
          statusMismatch = s;
        },
        end(c: string) {
          bodyMismatch = c;
        }
      },
      "/api/auth/google/callback"
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(statusMismatch).toBe(400);
    expect(JSON.parse(bodyMismatch)).toEqual({ error: "oauth_invalid_state" });

    // 2. Cross-user identity mismatch in id_token -> 403 oauth_identity_mismatch
    const wrongUserIdToken = [
      Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
      Buffer.from(JSON.stringify({ email: "mallory.attacker@company.com" })).toString("base64url"),
      "sig"
    ].join(".");

    const mockReqFn = jest.fn(async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        access_token: "mock-oauth-MALLORY_ACCESS",
        refresh_token: "1//0g-mallory-refresh",
        expires_in: 3599,
        id_token: wrongUserIdToken
      })
    }));

    let statusCrossUser = 0;
    let bodyCrossUser = "";
    const reqCrossUser: any = {
      method: "GET",
      url: `/api/auth/google/callback?state=${validState}&code=auth-code-2`,
      headers: {
        host: "localhost:8080",
        cookie: `${nodeProxy.OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(stateCookieVal)}`
      }
    };
    nodeProxy.attachGeminiSearchRoute(
      reqCrossUser,
      {
        writeHead(s: number) {
          statusCrossUser = s;
        },
        end(c: string) {
          bodyCrossUser = c;
        }
      },
      "/api/auth/google/callback",
      { requestFn: mockReqFn }
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(statusCrossUser).toBe(403);
    expect(JSON.parse(bodyCrossUser)).toMatchObject({ error: "oauth_identity_mismatch" });
  });

  it("automatically refreshes an expired access token using the encrypted HttpOnly refresh_token cookie", async () => {
    const expiredCookie = nodeProxy.sealOAuthPayload({
      email: "alice.smith@company.com",
      accessToken: "mock-oauth-EXPIRED_TOKEN",
      expiresAt: Date.now() - 60_000,
      refreshToken: "1//0g-valid-refresh-token",
      updatedAt: Date.now() - 3600_000
    });

    const req: any = {
      headers: {
        cookie: `${nodeProxy.OAUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(expiredCookie)}`
      }
    };

    const mockRequestFn = jest.fn(async (url: string) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          access_token: "mock-oauth-FRESHLY_REFRESHED_TOKEN",
          expires_in: 3600
        })
      };
    });

    const resolved = await nodeProxy.resolveServerGoogleOAuthToken({
      req,
      cloudIdentityEmail: "alice.smith@company.com",
      requestFn: mockRequestFn
    });
    expect(resolved).not.toBeNull();
    expect(resolved.accessToken).toBe("mock-oauth-FRESHLY_REFRESHED_TOKEN");
    expect(resolved.refreshedRecord.email).toBe("alice.smith@company.com");

    // Cross-user replay attempt with Alice's cookie for Bob must return null
    const crossUserAttempt = await nodeProxy.resolveServerGoogleOAuthToken({
      req,
      cloudIdentityEmail: "bob.jones@company.com",
      requestFn: mockRequestFn
    });
    expect(crossUserAttempt).toBeNull();
  });

  it("completes popup OAuth retry in <gemini-omnibar> when /api/search returns 401 google_oauth_required", async () => {
    defineGeminiOmnibarElement("gemini-omnibar");
    const originalFetch = (globalThis as any).fetch;
    const originalOpen = window.open;

    let searchAttempts = 0;
    (globalThis as any).fetch = jest.fn(async (url: string) => {
      if (String(url).endsWith("/api/config")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            userEmail: "alice.smith@company.com",
            googleOAuthServerEnabled: true,
            googleOAuthAuthenticated: false,
            googleOAuthLoginUrl: "/api/auth/google/login?mode=popup"
          })
        };
      }
      if (String(url).endsWith("/api/search")) {
        searchAttempts += 1;
        if (searchAttempts === 1) {
          return {
            ok: false,
            status: 401,
            json: async () => ({
              error: "google_oauth_required",
              authUrl: "/api/auth/google/login?mode=popup&login_hint=alice.smith%40company.com",
              loginHint: "alice.smith@company.com"
            })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session:
              "projects/p/locations/global/collections/default_collection/engines/e/sessions/11223344",
            sessionId: "11223344",
            summary: "Authenticated via Pattern 2 server OAuth [1].",
            results: [{ index: 1, title: "Policy Doc", url: "https://cloud.google.com", snippet: "OK" }]
          })
        };
      }
      throw new Error("Unexpected URL: " + url);
    });

    const popupStub: any = { closed: false, close: jest.fn() };
    window.open = jest.fn(() => {
      setTimeout(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: window.location.origin,
            data: {
              type: "ge_omnibar_google_oauth_complete",
              ok: true,
              email: "alice.smith@company.com"
            }
          })
        );
      }, 10);
      return popupStub;
    }) as any;

    try {
      const el = document.createElement("gemini-omnibar") as GeminiOmnibarElement;
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 20));

      await el.submitQuery("Check PTO policy");

      expect(searchAttempts).toBe(2);
      expect(window.open).toHaveBeenCalledTimes(1);
      expect(el.state.googleOAuthAuthenticated).toBe(true);
      expect(el.shadowRoot!.innerHTML).toContain("Authenticated via Pattern 2 server OAuth");
    } finally {
      (globalThis as any).fetch = originalFetch;
      window.open = originalOpen;
      document.body.innerHTML = "";
    }
  });
});



