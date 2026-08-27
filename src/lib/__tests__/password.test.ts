import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPassword, type PasswordParams } from "../password";

const params: PasswordParams = { N: 16384, r: 8, p: 1, keyLength: 64 };

function derive(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, params.keyLength, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

describe("password verification", () => {
  it("accepts the matching password and rejects another one", async () => {
    const salt = randomBytes(16).toString("hex");
    const hash = (await derive("una-clave-larga-y-unica", salt)).toString("hex");
    await expect(verifyPassword("una-clave-larga-y-unica", salt, hash, params)).resolves.toBe(true);
    await expect(verifyPassword("otra-clave", salt, hash, params)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes without comparing different lengths", async () => {
    await expect(verifyPassword("cualquier-clave", "00", "abcd", params)).resolves.toBe(false);
  });
});
