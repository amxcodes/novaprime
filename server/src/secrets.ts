import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const algorithm = "aes-256-gcm";
const nonceLength = 12;
const authenticationTagLength = 16;
const version = 1;
const keyPattern = /^[A-Za-z0-9_-]+$/;

export function isSecretsEncryptionKeyValid(environment = process.env): boolean {
  const encoded = environment.NOVA_SECRETS_ENCRYPTION_KEY;
  return Boolean(encoded && keyPattern.test(encoded) && Buffer.from(encoded, "base64url").length === 32);
}

function encryptionKey(environment = process.env): Buffer {
  const encoded = environment.NOVA_SECRETS_ENCRYPTION_KEY;
  if (!isSecretsEncryptionKeyValid(environment) || !encoded) {
    throw new Error("SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED");
  }
  const key = Buffer.from(encoded, "base64url");
  return key;
}

export function encryptSecret(
  plaintext: string,
  environment = process.env,
): Buffer {
  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv(algorithm, encryptionKey(environment), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();

  return Buffer.concat([
    Buffer.from([version]),
    nonce,
    authenticationTag,
    ciphertext,
  ]);
}

export function decryptSecret(
  payload: Uint8Array,
  environment = process.env,
): string {
  const minimumLength = 1 + nonceLength + authenticationTagLength;
  const bytes = Buffer.from(payload);

  if (bytes.length < minimumLength || bytes[0] !== version) {
    throw new Error("SECRETS_CIPHERTEXT_INVALID");
  }

  const nonce = bytes.subarray(1, 1 + nonceLength);
  const authenticationTag = bytes.subarray(
    1 + nonceLength,
    minimumLength,
  );
  const ciphertext = bytes.subarray(minimumLength);

  try {
    const decipher = createDecipheriv(algorithm, encryptionKey(environment), nonce);
    decipher.setAuthTag(authenticationTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("SECRETS_CIPHERTEXT_INVALID");
  }
}
