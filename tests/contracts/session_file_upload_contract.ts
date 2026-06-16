import assert from "node:assert/strict";
import { objectKey, tosEndpoint } from "../../apps/control-plane-api/src/files/objectStorage";
import { composeBucketName } from "../../apps/control-plane-api/src/files/workspaceStorage";
import { inlineImagePart, shouldInlineImage } from "../../apps/control-plane-api/src/runtime/sessionResourceMessages";
import { withSessionResourcesPrompt } from "../../apps/control-plane-api/src/runtime/sessionResourcePrompt";

// withSessionResourcesPrompt prepends a sandbox-path manifest when the session has uploads
{
  const session = {
    metadata: {
      resources: [
        { type: "file", file_id: "file_a", mount_path: "report.csv", media_type: "text/csv", bytes: 2048 },
        { type: "file", file_id: "file_b", mount_path: "shot.png", media_type: "image/png", bytes: 99000 }
      ]
    }
  };
  const out = withSessionResourcesPrompt(session, "summarize the data");
  assert.match(out, /\.session\/uploads\/report\.csv/, "relative upload path injected first");
  assert.match(out, /\/mnt\/session\/uploads\/report\.csv/, "csv path injected");
  assert.match(out, /\/mnt\/session\/uploads\/shot\.png/, "png path injected");
  assert.match(out, /text\/csv/, "media type surfaced");
  assert.ok(out.endsWith("summarize the data"), "original user text preserved at the end");
  assert.ok(!out.includes("presigned"), "no presigned URL leaks into the prompt");
}

// images can be sent to an OpenAI-compatible multimodal provider without exposing TOS URLs
{
  const part = inlineImagePart("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(part.type, "image_url");
  assert.equal(part.image_url.url, "data:image/png;base64,iVBORw==");
  assert.ok(!part.image_url.url.includes("http"), "provider image block is data URL, not TOS/presigned URL");
}

// provider image blocks skip too-small PNGs so upload/tool reading still works when the model rejects tiny images
{
  assert.equal(shouldInlineImage("image/png", pngHeader(1, 1)), false, "1x1 PNG stays file-only for tool reading");
  assert.equal(shouldInlineImage("image/png", pngHeader(16, 16)), true, "normal PNG can be inlined for multimodal models");
}

// no uploads -> the text passes through untouched (no manifest noise)
{
  assert.equal(withSessionResourcesPrompt({ metadata: {} }, "hello"), "hello", "empty metadata is a no-op");
  assert.equal(withSessionResourcesPrompt({ metadata: { resources: [] } }, "hi"), "hi", "empty resources is a no-op");
  assert.equal(withSessionResourcesPrompt({}, "hey"), "hey", "missing metadata is a no-op");
}

// non-file resources are ignored
{
  const session = { metadata: { resources: [{ type: "mcp", file_id: "x" }, { type: "file" }] } };
  assert.equal(withSessionResourcesPrompt(session, "go"), "go", "resources without a file_id/file type are skipped");
}

// objectKey builds a session-isolated, sanitized key
{
  const key = objectKey("session-uploads", "ws_123", "agent_abc", "sess_xyz", "file_001", "My Report (final).csv");
  assert.equal(key, "session-uploads/ws_123/agent_abc/sess_xyz/file_001/My-Report-final-.csv", "key is sanitized + hierarchical");
  assert.ok(key.startsWith("session-uploads/ws_123/agent_abc/sess_xyz/"), "every agent/session lands in its own prefix");
}

// composeBucketName obeys TOS rules: lowercase, 3-63 chars, no leading/trailing hyphen, ws_ stripped
{
  const name = composeBucketName("Acme Corp", "ws_3hryHMACWY", "a1b2c3");
  assert.equal(name, "maple-acme-corp-3hryhmacwy-a1b2c3", "tenant slug + ws short + random, sanitized");
  assert.ok(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name), "valid TOS bucket name shape");
  assert.ok(!name.includes("_"), "no underscores (ws_ prefix stripped)");

  const long = composeBucketName("a-very-long-tenant-slug-way-over-limit", "ws_AAAAAAAAAAAAAAAAAAAA", "zzzzzz");
  assert.ok(long.length <= 63, "clamped to 63 chars");
  assert.ok(!long.endsWith("-"), "no trailing hyphen after clamp");

  const messy = composeBucketName("T@#$%", "ws_x", "R6");
  assert.ok(/^maple-t-x-r6$/.test(messy), "illegal chars collapse, lowercased");
}

// tosEndpoint derives the regional host
{
  assert.equal(tosEndpoint("cn-beijing"), "tos-cn-beijing.volces.com", "endpoint from region");
}

console.log("session_file_upload_contract: OK");

function pngHeader(width: number, height: number) {
  const content = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(content, 0);
  content.writeUInt32BE(width, 16);
  content.writeUInt32BE(height, 20);
  return content;
}
