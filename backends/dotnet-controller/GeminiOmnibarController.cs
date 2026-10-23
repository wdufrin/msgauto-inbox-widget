using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace GeminiEnterpriseOmnibar.Controllers
{
    [ApiController]
    [Route("api")]
    public sealed class GeminiOmnibarController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;

        public GeminiOmnibarController(IHttpClientFactory httpClientFactory)
        {
            _httpClientFactory = httpClientFactory;
        }

        public sealed class SearchRequestDto
        {
            public string Query { get; set; } = "";
            public string Session { get; set; } = "";
            public string Mode { get; set; } = "streamAssist";
            public string UserPseudoId { get; set; } = "";
            public string GoogleAccessToken { get; set; } = "";
        }

        [HttpGet("config")]
        public IActionResult GetConfig()
        {
            var projectId = Environment.GetEnvironmentVariable("GCP_PROJECT_ID") ?? "";
            var location = Environment.GetEnvironmentVariable("GCP_LOCATION") ?? "global";
            var engineId = Environment.GetEnvironmentVariable("GE_ENGINE_ID") ?? "";
            var widgetConfigId = Environment.GetEnvironmentVariable("GE_WIDGET_CONFIG_ID") ?? "";
            var googleClientId = Environment.GetEnvironmentVariable("GOOGLE_OAUTH_CLIENT_ID") ?? "";

            var webAppBaseUrl = string.IsNullOrWhiteSpace(widgetConfigId)
                ? "https://vertexaisearch.cloud.google.com/u/0/home"
                : $"https://vertexaisearch.cloud.google.com/u/0/home/cid/{Uri.EscapeDataString(widgetConfigId)}";

            return Ok(new
            {
                projectId,
                location,
                engineId,
                widgetConfigId,
                webAppBaseUrl,
                apiMethod = "streamAssist",
                matchSessionUserPseudoId = true,
                includeSessionInDeepLink = true,
                googleOAuthClientId = googleClientId
            });
        }

        [HttpPost("search")]
        public async Task<IActionResult> Search([FromBody] SearchRequestDto body, CancellationToken ct)
        {
            if (body == null || string.IsNullOrWhiteSpace(body.Query))
            {
                return BadRequest(new { error = "query_required" });
            }
            if (body.Query.Trim().Length > 4000)
            {
                return BadRequest(new { error = "query_too_long" });
            }

            var projectId = Environment.GetEnvironmentVariable("GCP_PROJECT_ID") ?? "";
            var location = Environment.GetEnvironmentVariable("GCP_LOCATION") ?? "global";
            var engineId = Environment.GetEnvironmentVariable("GE_ENGINE_ID") ?? "";
            var widgetConfigId = Environment.GetEnvironmentVariable("GE_WIDGET_CONFIG_ID") ?? "";

            if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(engineId))
            {
                return StatusCode(502, new { error = "gemini_not_configured" });
            }

            var googleToken = Request.Headers["X-Google-Access-Token"].ToString();
            if (string.IsNullOrWhiteSpace(googleToken))
            {
                googleToken = body.GoogleAccessToken;
            }
            if (string.IsNullOrWhiteSpace(googleToken))
            {
                googleToken = Environment.GetEnvironmentVariable("GOOGLE_OAUTH_ACCESS_TOKEN") ?? "";
            }
            if (string.IsNullOrWhiteSpace(googleToken))
            {
                return StatusCode(401, new { error = "google_oauth_token_required" });
            }

            var host = string.Equals(location, "global", StringComparison.OrdinalIgnoreCase)
                ? "https://discoveryengine.googleapis.com"
                : $"https://{location.ToLowerInvariant()}-discoveryengine.googleapis.com";
            var enginePath = $"projects/{Uri.EscapeDataString(projectId)}/locations/{Uri.EscapeDataString(location)}/collections/default_collection/engines/{Uri.EscapeDataString(engineId)}";

            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", googleToken);
            client.DefaultRequestHeaders.Add("X-Goog-User-Project", projectId);

            var activeSession = (body.Session ?? "").Trim();
            if (string.IsNullOrWhiteSpace(activeSession) || activeSession == "-")
            {
                var createResp = await client.PostAsync(
                    $"{host}/v1alpha/{enginePath}/sessions",
                    new StringContent("{\"state\":\"IN_PROGRESS\"}", Encoding.UTF8, "application/json"),
                    ct
                );
                if (!createResp.IsSuccessStatusCode)
                {
                    return StatusCode(502, new { error = $"gemini_session_http_{(int)createResp.StatusCode}" });
                }
                using var doc = JsonDocument.Parse(await createResp.Content.ReadAsStringAsync(ct));
                activeSession = doc.RootElement.GetProperty("name").GetString() ?? "";
                var parts = activeSession.Split('/', StringSplitOptions.RemoveEmptyEntries);
                var numericId = parts.Length > 0 ? parts[^1] : "";
                if (!string.IsNullOrEmpty(numericId))
                {
                    var patchReq = new HttpRequestMessage(
                        HttpMethod.Patch,
                        $"{host}/v1alpha/{activeSession}?updateMask=userPseudoId"
                    )
                    {
                        Content = new StringContent(
                            JsonSerializer.Serialize(new { userPseudoId = numericId }),
                            Encoding.UTF8,
                            "application/json"
                        )
                    };
                    await client.SendAsync(patchReq, ct);
                }
            }

            var streamUrl = $"{host}/v1alpha/{enginePath}/assistants/default_assistant:streamAssist";
            var payloadJson = JsonSerializer.Serialize(new
            {
                query = new { text = body.Query.Trim() },
                session = activeSession,
                toolsSpec = new { vertexAiSearchSpec = new { } }
            });

            var assistResp = await client.PostAsync(
                streamUrl,
                new StringContent(payloadJson, Encoding.UTF8, "application/json"),
                ct
            );
            if (!assistResp.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = $"gemini_http_{(int)assistResp.StatusCode}" });
            }

            var rawStream = await assistResp.Content.ReadAsStringAsync(ct);
            var sessionParts = activeSession.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var sessionId = sessionParts.Length > 0 ? sessionParts[^1] : "";
            var deepLinkUrl = string.IsNullOrWhiteSpace(widgetConfigId)
                ? "https://vertexaisearch.cloud.google.com/u/0/home"
                : $"https://vertexaisearch.cloud.google.com/u/0/home/cid/{Uri.EscapeDataString(widgetConfigId)}/r/session/{Uri.EscapeDataString(sessionId)}";

            return Ok(new
            {
                session = activeSession,
                sessionId,
                deepLinkUrl,
                rawStream
            });
        }
    }
}
