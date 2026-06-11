import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, cp } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "nanoid",
  "rss-parser",
  "ws",
  "zod",
  "zod-validation-error",
];

// pg uses native bindings — must stay external
const forceExternal = ["pg", "pg-native"];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = [
    ...allDeps.filter((dep) => !allowlist.includes(dep)),
    ...forceExternal,
  ];

  const commonEsbuildOptions = {
    platform: "node" as const,
    bundle: true,
    format: "cjs" as const,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info" as const,
  };

  await esbuild({
    ...commonEsbuildOptions,
    entryPoints: ["server/index.ts"],
    outfile: "dist/index.cjs",
  });

  await esbuild({
    ...commonEsbuildOptions,
    entryPoints: ["server/migrate.ts"],
    outfile: "dist/migrate.cjs",
  });

  console.log("copying migrations/ to dist/migrations/...");
  await cp("migrations", "dist/migrations", { recursive: true });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
