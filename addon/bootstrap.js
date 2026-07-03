/* eslint-disable no-undef */

/**
 * Zotero bootstrap for Library Search plugin.
 * Mirrors the scaffold template, with window2 stubbed into the script context.
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  // 1. Wait for Zotero to be ready
  await Zotero.initializationPromise;

  // 2. Normalize rootURI (Zotero 7 vs 6)
  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  // 3. Register only our “content” bucket under chrome://librarysearch/
  const aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  // 4. Build our sandbox and stub in window & window2
  const ctx = { rootURI };
  try {
    const mainWin = Zotero.getMainWindow();
    ctx.window  = mainWin;
    ctx.window2 = mainWin;
  } catch (e) {
    // Ignore if getMainWindow isn’t available yet
  }
  ctx._globalThis = ctx;

  // 5. Load the compiled bundle into that sandbox
  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
    ctx
  );

  // 6. Finally, kick off our TS hooks
  Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  // Don’t clean up on full app shutdown
  if (reason === APP_SHUTDOWN) return;

  // Restore Zotero global if it was lost
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"]
      .getService(Components.interfaces.nsISupports).wrappedJSObject;
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
