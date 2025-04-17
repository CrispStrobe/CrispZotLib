/* eslint-disable no-undef */

/**
 * Zotero bootstrap for Library Search plugin.
 * Follows the official scaffold template exactly.
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  // Wait for Zotero to be ready
  await Zotero.initializationPromise;

  // Zotero 7 passes rootURI; fall back for Zotero 6
  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  // Register only our content: bucket under chrome://librarysearch/
  const aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  // Load the compiled script bundle into a sandbox
  const ctx = { rootURI };
  ctx._globalThis = ctx;
  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
    ctx
  );

  // Kick off our TS‐side startup hook
  Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  // Skip cleanup on full app shutdown
  if (reason === APP_SHUTDOWN) return;

  // In case Zotero global was lost
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"]
      .getService(Components.interfaces.nsISupports)
      .wrappedJSObject;
  }
  Zotero.__addonInstance__?.hooks.onShutdown();

  // Flush any loaded Fluent bundles
  Components.classes["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .flushBundles();

  // Unload our script
  Cu.unload(`${rootURI}/content/scripts/__addonRef__.js`);

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
