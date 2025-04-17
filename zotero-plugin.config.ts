import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

// Safe accessor for optional package.json keys
const getSafe = (obj: any, key: string, defaultValue: any = undefined) =>
  obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : defaultValue;

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,

  // ← here’s the change: include the v{{version}} directory
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,

  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: [
      "addon/**/*.*",
      "addon/bootstrap.js",  // always include your bootstrap entry point
    ],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: getSafe(pkg, "homepage", getSafe(pkg.repository, "url", "")),
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: { __env__: `"${process.env.NODE_ENV}"` },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  logLevel: "TRACE",
});
