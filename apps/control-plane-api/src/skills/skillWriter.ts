import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { skillRoot } from "../paths";
import { upsertSkill } from "../store";

const clientSkillDirs = [
  ".claude/skills",
  ".codex/skills",
  ".cursor/skills",
  ".antigravity/skills",
  ".gemini/antigravity/skills",
  ".gemini/antigravity-ide/skills",
  ".gemini/skills"
];

export type LocalSkillInput = {
  name: string;
  description: string;
};

export function createOrUpdateLocalSkill(input: LocalSkillInput) {
  const name = normalizeSkillName(input.name);
  const description = input.description.trim();
  if (!description) throw new Error("Skill description is required.");

  const sourcePath = join(skillRoot(), name);
  mkdirSync(sourcePath, { recursive: true });
  writeFileSync(join(sourcePath, "SKILL.md"), renderSkill(name, description), "utf8");
  const symlinks = ensureClientSymlinks(name, sourcePath);
  return upsertSkill({
    name,
    source_path: sourcePath,
    manifest: {
      name,
      description,
      source_path: sourcePath,
      managed_by: "local-managed-agents-platform",
      has_scripts: false,
      has_references: false,
      has_assets: false,
      symlinks
    }
  });
}

function normalizeSkillName(value: string) {
  const name = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(name)) {
    throw new Error("Skill name must be lowercase kebab-case, 2-81 chars, using only a-z, 0-9, and hyphen.");
  }
  return name;
}

function renderSkill(name: string, description: string) {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\n${description}\n`;
}

function ensureClientSymlinks(name: string, sourcePath: string) {
  const home = process.env.HOME || "";
  return clientSkillDirs.map((relativeDir) => {
    const dir = join(home, relativeDir);
    const link = join(dir, name);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(link)) {
      symlinkSync(sourcePath, link, "dir");
      return { path: link, status: "created" };
    }
    const stat = lstatSync(link);
    if (stat.isSymbolicLink() && readlinkSync(link) === sourcePath) {
      return { path: link, status: "exists" };
    }
    return { path: link, status: "skipped_existing_path" };
  });
}
