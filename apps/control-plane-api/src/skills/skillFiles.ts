import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { JsonRecord } from "../types";

export type SkillTreeEntry = {
  path: string;
  name: string;
  type: "file" | "directory" | "symlink";
  size?: number;
  children?: SkillTreeEntry[];
};

const maxEntries = 600;
const maxReadBytes = 512 * 1024;
const editableExtensions = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".css",
  ".html",
  ".xml"
]);

export function getSkillTree(skill: JsonRecord) {
  const root = getSkillRoot(skill);
  const tree = walkSkillTree(root, root, { count: 0 });
  return { root, tree };
}

export function readSkillFile(skill: JsonRecord, path: string) {
  const root = getSkillRoot(skill);
  const target = resolveSkillPath(root, path);
  const stats = statSync(target);
  if (!stats.isFile()) throw new Error("skill_path_not_file");
  if (stats.size > maxReadBytes) throw new Error("skill_file_too_large");
  return {
    path,
    content: readFileSync(target, "utf8"),
    size: stats.size,
    editable: isEditableFile(path)
  };
}

export function writeSkillFile(skill: JsonRecord, path: string, content: string) {
  const root = getSkillRoot(skill);
  if (!isEditableFile(path)) throw new Error("skill_file_not_editable");
  if (Buffer.byteLength(content) > maxReadBytes) throw new Error("skill_file_too_large");
  const target = resolveSkillPath(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  return readSkillFile(skill, path);
}

function getSkillRoot(skill: JsonRecord) {
  const root = String(skill.source_path || "");
  if (!root) throw new Error("skill_source_path_missing");
  if (!existsSync(root)) throw new Error("skill_source_path_missing");
  return realpathSync(root);
}

function walkSkillTree(root: string, current: string, state: { count: number }): SkillTreeEntry[] {
  if (state.count >= maxEntries) return [];
  return readdirSync(current, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .flatMap((entry): SkillTreeEntry[] => {
      if (state.count >= maxEntries) return [];
      state.count += 1;
      const absolute = join(current, entry.name);
      const rel = relative(root, absolute);
      const link = lstatSync(absolute);
      if (link.isSymbolicLink()) return [{ path: rel, name: entry.name, type: "symlink" as const }];
      if (entry.isDirectory()) {
        return [
          {
            path: rel,
            name: entry.name,
            type: "directory" as const,
            children: walkSkillTree(root, absolute, state)
          }
        ];
      }
      if (!entry.isFile()) return [];
      const stats = statSync(absolute);
      return [{ path: rel, name: entry.name, type: "file" as const, size: stats.size }];
    });
}

function resolveSkillPath(root: string, path: string) {
  const target = resolve(root, path || "SKILL.md");
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("skill_path_outside_root");
  return target;
}

function isEditableFile(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("/node_modules/") || normalized.includes("/.git/")) return false;
  return editableExtensions.has(extname(path).toLowerCase()) || normalized === "SKILL.md";
}
