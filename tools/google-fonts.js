#!/usr/bin/env node
"use strict";

// Refreshes skills/easybrandkit/scripts/lib/google-fonts.txt, the families
// Google Fonts serves. The kit gives a font `source: google` in _brand.yml
// only when its family is on this list, so run this now and then and commit
// the result.
//
//   node tools/google-fonts.js
//
// The list is the catalog fonts.google.com shows, plus the families Google
// renamed or retired but still serves from its own font files, such as
// Source Sans Pro, which sites keep using. Those come from Fontsource's list
// of Google families and each one is checked against the CSS API. A test of
// the API alone would not do: it also answers for names such as Helvetica
// and Proxima Nova, with a stand-in face that is not on Google Fonts.

const fs = require("fs");
const path = require("path");

const LIST = path.join(__dirname, "../skills/easybrandkit/scripts/lib/google-fonts.txt");
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return JSON.parse((await res.text()).replace(/^\)\]\}'\s*/, ""));
}

// Served when the CSS API answers with faces that all come from Google's
// own files (fonts.gstatic.com/s/), not from a stand-in.
async function served(family) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}`, { headers: { "user-agent": BROWSER } });
  if (!res.ok) return false;
  const files = [...(await res.text()).matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
  return files.length > 0 && files.every((file) => file.startsWith("https://fonts.gstatic.com/s/"));
}

async function main() {
  const catalog = await json("https://fonts.google.com/metadata/fonts");
  const families = new Set((catalog.familyMetadataList || []).map((font) => font.family).filter(Boolean));
  // A short catalog means the page changed, not that Google dropped its fonts.
  if (families.size < 1500) throw new Error(`only ${families.size} families listed, the list was left as it is`);
  const fontsource = await json("https://api.fontsource.org/v1/fonts?type=google");
  const retired = [...new Set(fontsource.map((font) => font.family).filter((family) => family && !families.has(family)))];
  let kept = 0;
  for (const family of retired) {
    if (await served(family)) {
      families.add(family);
      kept++;
    }
  }
  const sorted = [...families].sort();
  const date = new Date().toISOString().slice(0, 10);
  const head = [
    `# The ${sorted.length} families Google Fonts serves, as of ${date}: the catalog at fonts.google.com/metadata/fonts`,
    `# and ${kept} renamed or retired ones it still serves, from Fontsource's list of Google families.`,
    "# Refresh with: node tools/google-fonts.js",
  ];
  fs.writeFileSync(LIST, [...head, ...sorted].join("\n") + "\n");
  console.log(`Wrote ${sorted.length} families (${kept} of ${retired.length} retired ones still served) to ${path.relative(process.cwd(), LIST)}`);
}

main().catch((err) => {
  console.error(`google-fonts: ${err.message}`);
  process.exit(1);
});
