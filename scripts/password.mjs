import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function createPasswordHash(password) {
  const params = { N: 32768, r: 8, p: 1, keyLength: 64 };
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * 1024 * 1024
  });

  return { salt, hash: Buffer.from(derived).toString("hex"), params };
}

