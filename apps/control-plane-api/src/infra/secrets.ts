import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { secretsDir } from "./paths";

const masterKeyPath = join(secretsDir, "master.key");

export function writeSecret(id: string, value: string) {
  mkdirSync(secretsDir, { recursive: true });
  const key = loadOrCreateMasterKey();
  const payload = encryptSecretPayload(value, key);
  const secretPath = join(secretsDir, `${id}.json`);
  writeFileSync(secretPath, JSON.stringify(payload), { mode: 0o600 });
  return `local-secret://${id}`;
}

export function encryptSecret(value: string) {
  mkdirSync(secretsDir, { recursive: true });
  return JSON.stringify(encryptSecretPayload(value, loadOrCreateMasterKey()));
}

export function decryptSecret(payloadJson: string) {
  const payload = JSON.parse(payloadJson) as SecretPayload;
  if (payload.algorithm !== "aes-256-gcm") throw new Error(`Unsupported secret algorithm: ${payload.algorithm}`);
  const key = loadOrCreateMasterKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function encryptSecretPayload(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64")
  };
}

export function readSecret(ref: string) {
  const id = ref.replace(/^local-secret:\/\//, "");
  const secretPath = join(secretsDir, `${id}.json`);
  return decryptSecret(readFileSync(secretPath, "utf8"));
}

function loadOrCreateMasterKey() {
  // Env-provided master key takes precedence so secrets survive on hosts with a non-persistent
  // secretsDir (e.g. veFaaS /tmp, wiped on cold start and not shared across instances).
  const envKey = process.env.MAPLE_SECRET_MASTER_KEY;
  if (envKey) return Buffer.from(envKey, "base64");
  if (!existsSync(masterKeyPath)) {
    mkdirSync(secretsDir, { recursive: true });
    writeFileSync(masterKeyPath, randomBytes(32).toString("base64"), { mode: 0o600 });
    chmodSync(masterKeyPath, 0o600);
  }
  return Buffer.from(readFileSync(masterKeyPath, "utf8"), "base64");
}

type SecretPayload = {
  algorithm: string;
  iv: string;
  tag: string;
  ciphertext: string;
};
