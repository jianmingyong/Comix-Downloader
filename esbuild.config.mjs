import esbuild from "esbuild";
import { readFileSync } from "node:fs";

await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: "dist/comix-downloader.user.js",
    platform: "browser",
    format: "iife",
    target: ["es2022"],
    external: ["jszip"],
    banner: {
        js: readFileSync("tampermonkey-header.txt", { encoding: "utf8" }),
    },
    legalComments: "none",
});
