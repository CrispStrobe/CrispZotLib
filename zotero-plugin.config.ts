import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

// Create a safe accessor function for optional properties
const getSafe = (obj: any, key: string, defaultValue: any = undefined) => {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : defaultValue;
};

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: [
      "addon/**/*.*",
      // Make sure to include the bootstrap.js file
      "bootstrap.js"
    ],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      // Use safe accessor for optional properties
      homepage: getSafe(pkg, 'homepage', getSafe(pkg.repository, 'url', '')),
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  // Use uppercase for logLevel
  logLevel: "TRACE",  // Enable this to see detailed logs
 });