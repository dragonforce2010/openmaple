import { modelConfigLooksMultimodal } from "../modelGateway";
import { readManagedFile } from "../files/files";
import type { AgentConfig, JsonRecord } from "../types";
import type { ChatContentPart } from "./provider";

const MAX_INLINE_IMAGE_BYTES = Number(process.env.MAPLE_PROVIDER_IMAGE_INLINE_MAX_BYTES || 8 * 1024 * 1024);
const MIN_INLINE_IMAGE_DIMENSION = Number(process.env.MAPLE_PROVIDER_IMAGE_INLINE_MIN_DIMENSION || 14);

export async function providerUserContentWithImages(session: JsonRecord, agent: AgentConfig, text: string): Promise<string | ChatContentPart[]> {
  if (!modelConfigLooksMultimodal(agent.model as JsonRecord)) return text;
  const metadata = (session.metadata && typeof session.metadata === "object" ? session.metadata : {}) as JsonRecord;
  const resources = Array.isArray(metadata.resources) ? (metadata.resources as JsonRecord[]) : [];
  const images = resources.filter((resource) => resource.type === "file" && String(resource.media_type || "").startsWith("image/") && resource.file_id);
  if (!images.length) return text;

  const parts: ChatContentPart[] = [{ type: "text", text }];
  for (const image of images) {
    const uploaded = await readManagedFile(String(image.file_id));
    if (!uploaded || !shouldInlineImage(String(image.media_type || uploaded.metadata.media_type || ""), uploaded.content)) continue;
    parts.push(inlineImagePart(String(image.media_type || uploaded.metadata.media_type || "image/png"), uploaded.content));
  }
  return parts.length > 1 ? parts : text;
}

export function inlineImagePart(mediaType: string, content: Buffer): ChatContentPart {
  return { type: "image_url", image_url: { url: `data:${mediaType || "image/png"};base64,${content.toString("base64")}` } };
}

export function shouldInlineImage(mediaType: string, content: Buffer) {
  if (content.length > MAX_INLINE_IMAGE_BYTES) return false;
  const dimensions = imageDimensions(mediaType, content);
  if (!dimensions) return true;
  return dimensions.width >= MIN_INLINE_IMAGE_DIMENSION && dimensions.height >= MIN_INLINE_IMAGE_DIMENSION;
}

function imageDimensions(mediaType: string, content: Buffer) {
  if (mediaType.includes("png")) return pngDimensions(content);
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return jpegDimensions(content);
  return null;
}

function pngDimensions(content: Buffer) {
  if (content.length < 24 || content.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
}

function jpegDimensions(content: Buffer) {
  let offset = 2;
  if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8) return null;
  while (offset + 9 < content.length) {
    if (content[offset] !== 0xff) return null;
    const marker = content[offset + 1];
    const length = content.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: content.readUInt16BE(offset + 5), width: content.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}
