import assert from "node:assert/strict";

const { OpenVikingMemoryClient } = await import("../../apps/control-plane-api/src/memory/openVikingMemory");

const calls: Array<{ url: string; init?: RequestInit }> = [];
const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
  const requestUrl = String(url);
  calls.push({ url: requestUrl, init });
  if (requestUrl.endsWith("/api/v1/search/find")) {
    const body = JSON.parse(String(init?.body || "{}"));
    assert.deepEqual(body.context_type, ["memory"]);
    assert.equal(body.query, "project conventions");
    assert.equal(body.target_uri, "viking://user/memories/store-a");
    assert.equal(body.node_limit, 5);
    return jsonResponse({
      data: [
        {
          uri: "viking://user/memories/store-a/projects/conventions.md",
          content: "# Conventions\n\n- Prefer TDD.",
          score: 0.91,
          metadata: { path: "projects/conventions.md" }
        }
      ]
    });
  }
  if (requestUrl.endsWith("/api/v1/content/write")) {
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.uri, "viking://user/memories/store-a/projects/conventions.md");
    assert.equal(body.content, "# Conventions\n\n- Prefer OpenViking.");
    assert.equal(body.mode, "replace");
    assert.equal(body.wait, true);
    return jsonResponse({ ok: true, data: { uri: body.uri } });
  }
  if (requestUrl.includes("/api/v1/content/read?")) {
    const parsed = new URL(requestUrl);
    assert.equal(parsed.searchParams.get("uri"), "viking://user/memories/store-a/projects/conventions.md");
    return jsonResponse({ data: { content: "# Conventions\n\n- Prefer OpenViking." } });
  }
  return jsonResponse({ error: "unexpected_request", url: requestUrl }, 500);
};

const client = new OpenVikingMemoryClient({
  baseUrl: "https://openviking.example.test/",
  apiKey: "ov-key",
  targetUri: "viking://user/memories/store-a",
  fetchImpl
});

const search = await client.search("project conventions", { limit: 5 });
assert.equal(search.length, 1);
assert.equal(search[0].path, "projects/conventions.md");
assert.equal(search[0].preview, "# Conventions\n\n- Prefer TDD.");
assert.equal(search[0].score, 0.91);

await client.write("projects/conventions.md", "# Conventions\n\n- Prefer OpenViking.", "replace");
const read = await client.read("projects/conventions.md");
assert.equal(read.content, "# Conventions\n\n- Prefer OpenViking.");

for (const call of calls) {
  assert.equal((call.init?.headers as Record<string, string>)["X-API-Key"], "ov-key");
}

assert.deepEqual(
  calls.map((call) => [call.url, call.init?.method ?? "GET"]),
  [
    ["https://openviking.example.test/api/v1/search/find", "POST"],
    ["https://openviking.example.test/api/v1/content/write", "POST"],
    ["https://openviking.example.test/api/v1/content/read?uri=viking%3A%2F%2Fuser%2Fmemories%2Fstore-a%2Fprojects%2Fconventions.md", "GET"]
  ]
);

console.log("openviking memory contract passed");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
