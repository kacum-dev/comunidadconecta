import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function text(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("demo runtime contract", () => {
  it("ships the isolated demo bootstrap in the production image", () => {
    const dockerfile = text("Dockerfile");
    expect(dockerfile).toContain("KACUM_INSTANCE_MODE=customer");
    expect(dockerfile).toContain("/app/scripts/bootstrap-demo.mjs");
    expect(dockerfile).toContain("/app/scripts/seed.mjs");
  });

  it("runs demo bootstrap only for demo instances", () => {
    const entrypoint = text("scripts/docker-entrypoint.mjs");
    expect(entrypoint).toContain('mode === "demo"');
    expect(entrypoint).toContain('scripts/bootstrap-demo.mjs');
    expect(entrypoint).toContain('KACUM_INSTANCE_MODE debe ser "demo" o "customer"');
  });

  it("keeps customer as the fail-safe application default", () => {
    const instanceMode = text("src/lib/instance-mode.ts");
    expect(instanceMode).toContain('process.env[INSTANCE_MODE_ENV] || "customer"');
  });
});
