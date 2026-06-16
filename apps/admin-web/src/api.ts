export type ApiList<T> = { data: T[] };
type ApiRequestOptions = { timeoutMs?: number };

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

function readableHtmlError(text: string) {
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  const pre = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] ?? text;
  const stripped = pre
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+at file:\/\/\/[^\n]+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (stripped.startsWith("WorkspaceRuntimePoolUnavailableError:")) {
    return "当前工作区 runtime pool 暂无 active member，Builder Agent 暂时不能创建会话。请等待开通完成或切换到已有 runtime 的工作区。";
  }
  return stripped || text;
}

async function readApiError(response: Response) {
  const text = await response.text();
  if (!text) return new ApiError(`${response.status} ${response.statusText}`.trim(), response.status, {});
  try {
    const body = JSON.parse(text) as { error?: string; message?: string; fieldErrors?: Record<string, string[]> };
    if (body.error === "workspace_runtime_pool_unavailable") {
      return new ApiError("当前工作区 runtime pool 暂无 active member，Builder Agent 暂时不能创建会话。请等待开通完成或切换到已有 runtime 的工作区。", response.status, body);
    }
    if (body.message) return new ApiError(body.message, response.status, body);
    if (body.error) return new ApiError(body.error, response.status, body);
    if (body.fieldErrors) {
      const message = Object.entries(body.fieldErrors)
        .map(([field, messages]) => `${field}: ${messages.join(", ")}`)
        .join("; ");
      return new ApiError(message, response.status, body);
    }
  } catch {
    return new ApiError(readableHtmlError(text), response.status, text);
  }
  return new ApiError(readableHtmlError(text), response.status, text);
}

export async function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const controller = options.timeoutMs ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), options.timeoutMs) : 0;
  try {
    const response = await fetch(path, { credentials: "include", signal: controller?.signal });
    if (!response.ok) throw await readApiError(response);
    return response.json() as Promise<T>;
  } catch (error) {
    // User-facing message stays friendly; the raw path goes into body for debugging only.
    if (error instanceof DOMException && error.name === "AbortError") throw new ApiError("请求超时，请稍后重试。", 408, { error: "request_timeout", path });
    throw error;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

// Write requests get a default timeout so a slow/hung backend (or a refresh that follows) can't
// leave the UI spinning forever with no error — fail fast and surface it instead.
const WRITE_TIMEOUT_MS = 30_000;

async function writeRequest(path: string, init: RequestInit, timeoutMs = WRITE_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, { credentials: "include", signal: controller.signal, ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new ApiError("请求超时，请稍后重试。", 408, { error: "request_timeout", path });
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await writeRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw await readApiError(response);
  return response.json() as Promise<T>;
}

// Multipart upload: no JSON Content-Type (the browser sets the multipart boundary itself) and a
// longer timeout, since a file body can take much longer than a JSON write.
export async function apiUpload<T>(path: string, form: FormData, timeoutMs = 120_000): Promise<T> {
  const response = await writeRequest(path, { method: "POST", body: form }, timeoutMs);
  if (!response.ok) throw await readApiError(response);
  return response.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await writeRequest(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw await readApiError(response);
  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await writeRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HTTP-Method-Override": "PATCH" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw await readApiError(response);
  return response.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await writeRequest(path, {
    method: "POST",
    headers: { "X-HTTP-Method-Override": "DELETE" }
  });
  if (!response.ok) throw await readApiError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
