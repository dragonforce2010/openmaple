#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const screenshots = [
  "assets/screenshots/openmaple-local-setup-terminal.png",
  "assets/screenshots/openmaple-local-dashboard.png",
  "assets/screenshots/openmaple-local-settings-overview.png",
  "assets/screenshots/openmaple-local-settings-runtime.png",
  "assets/screenshots/openmaple-local-runtime-pool-drawer.png",
  "assets/screenshots/openmaple-local-settings-sandbox.png",
  "assets/screenshots/openmaple-local-sandbox-pool-drawer.png",
  "assets/screenshots/openmaple-local-sessions-list.png",
  "assets/screenshots/openmaple-local-session-dashboard.png",
  "assets/screenshots/openmaple-local-quickstart.png"
];

const expectedScreenshot = { width: 5120, height: 2880 };
const expectedVideo = {
  path: "assets/videos/openmaple-local-docker-tour.mp4",
  width: 2560,
  height: 1440,
  fps: 30,
  minBitrate: 10_000_000
};

const failures = [];

for (const path of screenshots) {
  try {
    const dimensions = readPngDimensions(path);
    if (
      dimensions.width !== expectedScreenshot.width ||
      dimensions.height !== expectedScreenshot.height
    ) {
      failures.push(
        `${path}: expected ${expectedScreenshot.width}x${expectedScreenshot.height}, got ${dimensions.width}x${dimensions.height}`
      );
    }
  } catch (error) {
    failures.push(`${path}: ${error.message}`);
  }
}

try {
  const video = readVideoMetadata(expectedVideo.path);
  if (video.width !== expectedVideo.width || video.height !== expectedVideo.height) {
    failures.push(
      `${expectedVideo.path}: expected ${expectedVideo.width}x${expectedVideo.height}, got ${video.width}x${video.height}`
    );
  }
  if (video.fps !== expectedVideo.fps) {
    failures.push(`${expectedVideo.path}: expected ${expectedVideo.fps}fps, got ${video.fps}fps`);
  }
  if (video.bitrate < expectedVideo.minBitrate) {
    failures.push(
      `${expectedVideo.path}: expected bitrate >= ${expectedVideo.minBitrate}, got ${video.bitrate}`
    );
  }
} catch (error) {
  failures.push(`${expectedVideo.path}: ${error.message}`);
}

if (failures.length) {
  console.error("Media quality check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `media quality check passed: ${screenshots.length} local Docker screenshots at 5120x2880, video at 2560x1440/30fps`
);

function readPngDimensions(path) {
  if (!existsSync(path)) throw new Error("file not found");
  const buffer = readFileSync(path);
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("not a PNG file");
  }
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") throw new Error("missing PNG IHDR chunk");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function readVideoMetadata(path) {
  if (!existsSync(path)) throw new Error("file not found");
  const buffer = readFileSync(path);
  const movie = readMovieMetadata(buffer);
  const track = movie.tracks
    .filter((candidate) => candidate.width > 0 && candidate.height > 0)
    .sort((left, right) => right.width * right.height - left.width * left.height)[0];

  if (!track) throw new Error("missing video track");

  const duration = track.durationSeconds || movie.durationSeconds;
  if (!duration) throw new Error("missing video duration");

  const bitrate = Math.round((buffer.length * 8) / duration);
  return {
    width: track.width,
    height: track.height,
    fps: track.sampleCount ? Math.round(track.sampleCount / duration) : 0,
    bitrate
  };
}

function readMovieMetadata(buffer) {
  const moov = readBoxes(buffer, 0, buffer.length).find((box) => box.type === "moov");
  if (!moov) throw new Error("missing MP4 moov box");

  const movie = { durationSeconds: 0, tracks: [] };
  for (const box of readBoxes(buffer, moov.contentStart, moov.end)) {
    if (box.type === "mvhd") movie.durationSeconds = readDurationBox(buffer, box);
    if (box.type === "trak") movie.tracks.push(readTrackMetadata(buffer, box));
  }
  return movie;
}

function readTrackMetadata(buffer, box) {
  const track = { width: 0, height: 0, durationSeconds: 0, sampleCount: 0 };
  visitBoxes(buffer, box.contentStart, box.end, (child) => {
    if (child.type === "tkhd") {
      const dimensions = readTrackDimensions(buffer, child);
      track.width = dimensions.width;
      track.height = dimensions.height;
    }
    if (child.type === "mdhd") track.durationSeconds = readDurationBox(buffer, child);
    if (child.type === "stts") track.sampleCount = readSampleCount(buffer, child);
  });
  return track;
}

function visitBoxes(buffer, start, end, visit) {
  for (const box of readBoxes(buffer, start, end)) {
    visit(box);
    if (isContainerBox(box.type)) visitBoxes(buffer, box.contentStart, box.end, visit);
  }
}

function readBoxes(buffer, start, end) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) throw new Error(`truncated MP4 box header at ${offset}`);
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) {
      throw new Error(`invalid MP4 ${type} box size at ${offset}`);
    }
    boxes.push({ type, start: offset, contentStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function readDurationBox(buffer, box) {
  const version = buffer.readUInt8(box.contentStart);
  if (version === 1) {
    const timescale = buffer.readUInt32BE(box.contentStart + 20);
    const duration = Number(buffer.readBigUInt64BE(box.contentStart + 24));
    return timescale ? duration / timescale : 0;
  }
  const timescale = buffer.readUInt32BE(box.contentStart + 12);
  const duration = buffer.readUInt32BE(box.contentStart + 16);
  return timescale ? duration / timescale : 0;
}

function readTrackDimensions(buffer, box) {
  const version = buffer.readUInt8(box.contentStart);
  const dimensionsOffset = box.contentStart + (version === 1 ? 88 : 76);
  return {
    width: Math.round(buffer.readUInt32BE(dimensionsOffset) / 65536),
    height: Math.round(buffer.readUInt32BE(dimensionsOffset + 4) / 65536)
  };
}

function readSampleCount(buffer, box) {
  const entryCount = buffer.readUInt32BE(box.contentStart + 4);
  let offset = box.contentStart + 8;
  let sampleCount = 0;
  for (let index = 0; index < entryCount; index += 1) {
    sampleCount += buffer.readUInt32BE(offset);
    offset += 8;
  }
  return sampleCount;
}

function isContainerBox(type) {
  return new Set(["moov", "trak", "mdia", "minf", "stbl"]).has(type);
}
