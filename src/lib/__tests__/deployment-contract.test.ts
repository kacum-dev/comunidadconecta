import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("KACUM automatic deployment contract", () => {
  it("uses only the KACUM control-plane variable", () => {
    const productControl = read("src/lib/product-control.ts");
    const envExample = read(".env.example");

    expect(productControl).toContain("KACUM_CONTROL_PLANE_URL");
    expect(envExample).toContain("KACUM_CONTROL_PLANE_URL");
    expect(productControl).not.toContain("LABOS_CONTROL_PLANE_URL");
    expect(envExample).not.toContain("LABOS_CONTROL_PLANE_URL");
  });

  it("runs the initial admin bootstrap before starting Next.js", () => {
    const entrypoint = read("scripts/docker-entrypoint.mjs");
    const dockerfile = read("Dockerfile");
    const bootstrap = read("scripts/bootstrap-initial-admin.mjs");

    expect(entrypoint).toContain("INITIAL_ADMIN_BOOTSTRAP_ENABLED");
    expect(entrypoint).toContain("scripts/bootstrap-initial-admin.mjs");
    expect(dockerfile).toContain("bootstrap-initial-admin.mjs");
    expect(bootstrap).toContain("INITIAL_COMMUNITY_NAME");
    expect(bootstrap).toContain("SEED_ADMIN_EMAIL");
    expect(bootstrap).toContain("SEED_ADMIN_PASSWORD");
    expect(bootstrap).toContain("ON CONFLICT (community_id, user_id, role)");
  });

  it("does not use the demo seed as the production bootstrap", () => {
    const entrypoint = read("scripts/docker-entrypoint.mjs");
    expect(entrypoint).not.toContain("scripts/seed.mjs");
  });
});
