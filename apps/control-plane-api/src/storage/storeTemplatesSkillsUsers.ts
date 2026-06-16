import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import type { JsonRecord } from "../types";
import { db, fromJson, now, toJson } from "./storeCore";
import { hydrateUserRow } from "./storeHydrators";


export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createTemplate(input: { name: string; description: string; category: string; template: JsonRecord }) {
  const stamp = now();
  const id = `tpl_${nanoid(10)}`;
  db.prepare(`
    INSERT INTO agent_templates (id, name, description, category, template_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.description, input.category, toJson(input.template), stamp, stamp);
  return getTemplate(id);
}

export function listTemplates() {
  return db
    .prepare("SELECT * FROM agent_templates ORDER BY category ASC, name ASC")
    .all()
    .map((row) => {
      const item = row as JsonRecord;
      return { ...item, template: fromJson(String(item.template_json), {}) };
    });
}

export function getTemplate(id: string) {
  const row = db.prepare("SELECT * FROM agent_templates WHERE id = ?").get(id) as JsonRecord | undefined;
  if (!row) return null;
  return { ...row, template: fromJson(String(row.template_json), {}) };
}

export function updateTemplate(id: string, input: { name: string; description: string; category: string; template: JsonRecord }) {
  const current = getTemplate(id);
  if (!current) return null;
  db.prepare("UPDATE agent_templates SET name = ?, description = ?, category = ?, template_json = ?, updated_at = ? WHERE id = ?").run(
    input.name,
    input.description,
    input.category,
    toJson(input.template),
    now(),
    id
  );
  return getTemplate(id);
}

export function upsertSkill(input: { name: string; source_path: string; manifest: JsonRecord }) {
  const existing = db.prepare("SELECT * FROM skills WHERE name = ?").get(input.name) as JsonRecord | undefined;
  const stamp = now();
  const contentHash = createHash("sha256").update(toJson(input.manifest)).digest("hex");
  if (!existing) {
    const skillId = `skill_${nanoid(10)}`;
    db.prepare(`
      INSERT INTO skills (id, name, source_type, source_path, current_version, metadata_json, created_at, updated_at)
      VALUES (?, ?, 'local', ?, 1, ?, ?, ?)
    `).run(skillId, input.name, input.source_path, toJson(input.manifest), stamp, stamp);
    db.prepare(`
      INSERT INTO skill_versions (id, skill_id, version, manifest_json, content_hash, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(`skillver_${nanoid(10)}`, skillId, toJson(input.manifest), contentHash, stamp);
    return getSkill(skillId);
  }

  const currentVersion = Number(existing.current_version);
  const latest = db
    .prepare("SELECT * FROM skill_versions WHERE skill_id = ? AND version = ?")
    .get(existing.id, currentVersion) as JsonRecord | undefined;
  if (latest?.content_hash === contentHash) return getSkill(String(existing.id));

  const nextVersion = currentVersion + 1;
  db.prepare("UPDATE skills SET current_version = ?, metadata_json = ?, updated_at = ? WHERE id = ?").run(
    nextVersion,
    toJson(input.manifest),
    stamp,
    existing.id
  );
  db.prepare(`
    INSERT INTO skill_versions (id, skill_id, version, manifest_json, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`skillver_${nanoid(10)}`, existing.id, nextVersion, toJson(input.manifest), contentHash, stamp);
  return getSkill(String(existing.id));
}

export function listSkills() {
  return db
    .prepare("SELECT * FROM skills ORDER BY name ASC")
    .all()
    .map((row) => {
      const item = row as JsonRecord;
      return { ...item, metadata: fromJson(String(item.metadata_json), {}) };
    });
}

export function getSkill(id: string) {
  const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as JsonRecord | undefined;
  if (!row) return null;
  return { ...row, metadata: fromJson(String(row.metadata_json), {}) };
}

export function getSkillByName(name: string) {
  const row = db.prepare("SELECT * FROM skills WHERE name = ?").get(name) as JsonRecord | undefined;
  if (!row) return null;
  return { ...row, metadata: fromJson(String(row.metadata_json), {}) };
}

export function upsertUser(input: { email: string; name: string; auth_provider: string; role?: string; metadata?: JsonRecord }) {
  const email = normalizeEmail(input.email);
  const stamp = now();
  const id = `user_${nanoid(10)}`;
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, auth_provider, role, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, email, input.name, input.auth_provider, input.role ?? "member", toJson(input.metadata), stamp, stamp);
  const current = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as JsonRecord | undefined;
  if (!current) return null;
  db.prepare("UPDATE users SET name = ?, auth_provider = ?, metadata_json = ?, updated_at = ? WHERE id = ?").run(
    input.name,
    input.auth_provider,
    toJson({ ...fromJson(String(current.metadata_json), {}), ...(input.metadata ?? {}) }),
    stamp,
    current.id
  );
  return getUser(String(current.id));
}

export function getUserByEmail(email: string) {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as JsonRecord | undefined;
  return row ? hydrateUserRow(row) : null;
}

export function ensureUserByEmail(input: { email: string; name?: string; auth_provider?: string; role?: string; metadata?: JsonRecord }) {
  const email = normalizeEmail(input.email);
  const existing = getUserByEmail(email);
  if (existing) return existing;
  const stamp = now();
  const id = `user_${nanoid(10)}`;
  const name = input.name?.trim() || email.split("@")[0] || email;
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, auth_provider, role, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    email,
    name,
    input.auth_provider ?? "pending",
    input.role ?? "member",
    toJson({ ...(input.metadata ?? {}), placeholder: true }),
    stamp,
    stamp
  );
  return getUserByEmail(email);
}

export function listUsers() {
  return (db.prepare("SELECT * FROM users ORDER BY updated_at DESC").all() as JsonRecord[]).map(hydrateUserRow);
}

export function getUser(id: string) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as JsonRecord | undefined;
  return row ? hydrateUserRow(row) : null;
}

export function createAuthSession(input: { token_hash: string; user_id: string; expires_at: string }) {
  const stamp = now();
  const id = `authsess_${nanoid(10)}`;
  db.prepare(`
    INSERT INTO auth_sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.token_hash, input.user_id, input.expires_at, stamp, stamp);
  return getAuthSessionByHash(input.token_hash);
}

export function getAuthSessionByHash(tokenHash: string) {
  const row = db
    .prepare(
      `SELECT auth_sessions.*, users.email, users.name, users.auth_provider, users.role, users.metadata_json AS user_metadata_json,
              users.created_at AS user_created_at, users.updated_at AS user_updated_at
       FROM auth_sessions
       JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = ?`
    )
    .get(tokenHash) as JsonRecord | undefined;
  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) return null;
  db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").run(now(), row.id);
  return {
    session: {
      id: row.id,
      user_id: row.user_id,
      expires_at: row.expires_at,
      created_at: row.created_at,
      last_seen_at: row.last_seen_at
    },
    user: hydrateUserRow({
      id: row.user_id,
      email: row.email,
      name: row.name,
      auth_provider: row.auth_provider,
      role: row.role,
      metadata_json: row.user_metadata_json,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at
    })
  };
}

export function deleteAuthSession(tokenHash: string) {
  db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
}
