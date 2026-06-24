export type OpenVikingMemoryClientOptions = {
  baseUrl: string;
  apiKey?: string;
  targetUri: string;
  fetchImpl?: typeof fetch;
};

export type OpenVikingSearchOptions = {
  limit?: number;
};

export type OpenVikingSearchResult = {
  uri: string;
  path: string;
  preview: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export class OpenVikingMemoryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly targetUri: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenVikingMemoryClientOptions) {
    if (!options.baseUrl.trim()) throw new Error("openviking_base_url_required");
    if (!options.targetUri.trim()) throw new Error("openviking_target_uri_required");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey || "";
    this.targetUri = options.targetUri.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: string, options: OpenVikingSearchOptions = {}): Promise<OpenVikingSearchResult[]> {
    const response = await this.request("/api/v1/search/find", {
      method: "POST",
      body: JSON.stringify({
        query,
        target_uri: this.targetUri,
        context_type: ["memory"],
        node_limit: options.limit ?? 20
      })
    });
    const data = await response.json() as Record<string, unknown>;
    const items = Array.isArray(data.data) ? data.data : Array.isArray(data.results) ? data.results : [];
    return items.map((item) => this.searchResult(item)).filter((item): item is OpenVikingSearchResult => Boolean(item));
  }

  async write(path: string, content: string, mode: "create" | "replace" | "append" = "replace") {
    const uri = this.memoryUri(path);
    const response = await this.request("/api/v1/content/write", {
      method: "POST",
      body: JSON.stringify({ uri, content, mode, wait: true })
    });
    return response.json() as Promise<Record<string, unknown>>;
  }

  async read(path: string) {
    const uri = this.memoryUri(path);
    const response = await this.request(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`, { method: "GET" });
    const data = await response.json() as Record<string, unknown>;
    const payload = record(data.data ?? data);
    return { uri, content: String(payload.content ?? payload.text ?? "") };
  }

  private async request(path: string, init: RequestInit) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.apiKey ? { "X-API-Key": this.apiKey } : {})
    };
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    if (!response.ok) throw new Error(`OpenViking request failed ${response.status}: ${await response.text()}`);
    return response;
  }

  private memoryUri(path: string) {
    return `${this.targetUri}/${path.replace(/^\/+/, "")}`;
  }

  private searchResult(value: unknown): OpenVikingSearchResult | null {
    const item = record(value);
    const uri = String(item.uri || item.path || "");
    if (!uri) return null;
    const metadata = record(item.metadata);
    const path = String(metadata.path || uri.replace(`${this.targetUri}/`, ""));
    return {
      uri,
      path,
      preview: String(item.content ?? item.text ?? item.preview ?? ""),
      ...(typeof item.score === "number" ? { score: item.score } : {}),
      metadata
    };
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
