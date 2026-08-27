import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

export interface PasswordParams {
  N: number;
  r: number;
  p: number;
  keyLength: number;
}

export async function createPasswordHash(password: string) {
  const params: PasswordParams = { N: 32768, r: 8, p: 1, keyLength: 64 };
  const salt = randomBytes(16).toString("hex");
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, params.keyLength, { N: params.N, r: params.r, p: params.p, maxmem: 128 * 1024 * 1024 }, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
  });
  return { salt, hash: hash.toString("hex"), params };
}

export async function verifyPassword(
  candidate: string,
  salt: string,
  expectedHash: string,
  params: PasswordParams
): Promise<boolean> {
  const expected = Buffer.from(expectedHash, "hex");
  if (expected.length !== params.keyLength) return false;

  const actual = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(candidate, salt, params.keyLength, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: 128 * 1024 * 1024
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
