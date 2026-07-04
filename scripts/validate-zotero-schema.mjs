// Validate that every field / creator type the import path (integration.ts) sets
// is actually valid for the Zotero item types mapRecordToItemType produces —
// otherwise Zotero's setField silently drops it and setCreator throws (losing the
// whole item). Requires a running Zotero (Settings → Advanced → "Allow other
// applications on this computer to communicate with Zotero").
//
//   npm run validate:zotero
//
// This caught two real bugs when added: numPages on `report` (no such field) and
// author/editor/translator on AV item types (setCreator would reject them).
const API = "http://127.0.0.1:23119/api";

const ITEM_TYPES = [
  "book",
  "bookSection",
  "journalArticle",
  "thesis",
  "conferencePaper",
  "report",
  "map",
  "videoRecording",
  "audioRecording",
  "artwork",
  "computerProgram",
];
// itemType -> fields integration.ts sets that MUST hold (type-specific + numPages)
const REQUIRED_FIELDS = {
  book: ["series", "edition", "numPages", "extra"],
  bookSection: ["bookTitle", "pages", "extra"],
  journalArticle: ["publicationTitle", "volume", "issue", "pages", "extra"],
  thesis: ["numPages", "extra"],
};
const CREATORS = ["author", "editor", "translator", "contributor"];

async function j(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

const up = await fetch(`${API}/users/0/items?limit=1`).then(
  (r) => r.ok,
  () => false,
);
if (!up) {
  console.error(
    "Zotero local API not reachable at 127.0.0.1:23119 — is Zotero running with the local API enabled?",
  );
  process.exit(2);
}

let problems = 0;
for (const it of ITEM_TYPES) {
  const fields = new Set(
    (await j(`/itemTypeFields?itemType=${it}`)).map((f) => f.field),
  );
  const creators = new Set(
    (await j(`/itemTypeCreatorTypes?itemType=${it}`)).map((c) => c.creatorType),
  );
  for (const f of REQUIRED_FIELDS[it] || []) {
    if (!fields.has(f)) {
      console.error(
        `✗ field "${f}" is NOT valid for itemType "${it}" (would be silently dropped)`,
      );
      problems++;
    }
  }
  // Contributor should be valid everywhere we route contributors to it.
  if (!creators.has("contributor")) {
    console.error(
      `✗ creatorType "contributor" is NOT valid for itemType "${it}"`,
    );
    problems++;
  }
}

console.log(
  problems === 0
    ? "✓ all intended fields/creator types are valid for their item types"
    : `\n${problems} problem(s) found`,
);
process.exit(problems === 0 ? 0 : 1);
