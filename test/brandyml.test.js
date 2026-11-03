"use strict";

// _brand.yml, the kit in the brand.yml format Quarto and Shiny read: what
// goes in, what is left out, and YAML that reads back as written. No
// browser: the kits are fixtures.

const assert = require("node:assert/strict");
const test = require("node:test");
const { brandYml, googleFamily } = require("../skills/easybrandkit/scripts/lib/brandyml");

const HEAD = [
  "# The brand kit for Quarto and Shiny, in the brand.yml format: https://posit-dev.github.io/brand-yml/",
  "# easybrandkit 0.3.0 read it from https://acme.com/ on 2026-11-03.",
  "",
];

function kitOf(fields) {
  return { version: 1, url: "https://acme.com/", name: "Acme", capturedAt: "2026-11-03T10:00:00.000Z", generator: "easybrandkit 0.3.0", colors: [], fonts: {}, logos: [], ...fields };
}

test("name, site, logo, colors by role and fonts, in the brand.yml format", () => {
  const kit = kitOf({
    colors: [
      { hex: "#3f56c8", role: "button" },
      { hex: "#0a2540", role: "button" },
      { hex: "#ff0000", role: "logo" },
      { hex: "#0f172a", role: "heading" },
      { hex: "#dc2626", role: "link" },
      { hex: "#ffffff", role: "header" },
      { hex: "#1d243e", role: "footer" },
      { hex: "#f0f0f0", role: "surface" },
    ],
    fonts: { heading: "Inter Variable", body: "Söhne" },
    logos: [
      { file: "logo-01.png", svg: "logo-01.svg", where: "header", background: "#ffffff", onPicture: false, alt: "" },
      { file: "logo-02.png", where: "footer", background: "#1d243e", onPicture: false, alt: "Acme: home" },
    ],
  });
  assert.equal(
    brandYml(kit, { background: "#FFFFFF" }),
    [
      ...HEAD,
      "meta:",
      "  name: Acme",
      '  link: "https://acme.com/"',
      "",
      "logo:",
      "  images:",
      "    logo-01: logo-01.svg",
      "    logo-02:",
      "      path: logo-02.png",
      '      alt: "Acme: home"',
      "  medium: logo-01",
      "",
      "color:",
      "  # The page's colors, named for where it uses them.",
      "  palette:",
      '    button: "#3f56c8"',
      '    button-2: "#0a2540"',
      '    logo: "#ff0000"',
      '    heading: "#0f172a"',
      '    link: "#dc2626"',
      '    header: "#ffffff"',
      '    footer: "#1d243e"',
      '    surface: "#f0f0f0"',
      '  foreground: "#0f172a"',
      '  background: "#ffffff"',
      '  primary: "#3f56c8"',
      "",
      "typography:",
      "  fonts:",
      "    # Söhne is not on Google Fonts, so it shows only where it is installed.",
      '    - family: "Söhne"',
      "      source: system",
      "    # The page calls it Inter Variable.",
      "    - family: Inter",
      "      source: google",
      '  base: "Söhne"',
      "  headings: Inter",
      "  link:",
      '    color: "#dc2626"',
      "",
    ].join("\n"),
  );
});

test("what the page did not show is left out, not filled in", () => {
  // A store listing that names no website: a name and nothing else.
  const listing = kitOf({ url: "https://apps.apple.com/us/app/id1234567890", name: "Acme Run" });
  assert.equal(
    brandYml(listing, { site: "" }),
    ["# The brand kit for Quarto and Shiny, in the brand.yml format: https://posit-dev.github.io/brand-yml/", "# easybrandkit 0.3.0 read it from https://apps.apple.com/us/app/id1234567890 on 2026-11-03.", "", "meta:", "  name: Acme Run", ""].join("\n"),
  );
  // No button color, no page ground, the system's own font: no primary, no
  // background, no typography.
  const plain = brandYml(kitOf({ colors: [{ hex: "#111111", role: "heading" }], fonts: { heading: "-apple-system", body: "system-ui" } }));
  assert.ok(plain.endsWith(['color:', "  # The page's colors, named for where it uses them.", "  palette:", '    heading: "#111111"', '  foreground: "#111111"', ""].join("\n")), plain);
  assert.doesNotMatch(plain, /primary|background|typography/);
});

test("text and links have to read on the page's ground", () => {
  const theme = (colors, background) => {
    const yml = brandYml(kitOf({ colors }), { background });
    return Object.fromEntries([...yml.matchAll(/^ {2}(foreground|background|primary): "(#[0-9a-f]{6})"$|^ {4}color: "(#[0-9a-f]{6})"$/gm)].map((m) => (m[1] ? [m[1], m[2]] : ["link", m[3]])));
  };
  // Headings in the brand's purple are not the color for running text.
  assert.deepEqual(theme([{ hex: "#533afd", role: "button" }, { hex: "#533afd", role: "heading" }], "#ffffff"), { background: "#ffffff", primary: "#533afd" });
  // Light headings on a dark page are.
  assert.deepEqual(theme([{ hex: "#f7f8f8", role: "heading" }], "#08090a"), { foreground: "#f7f8f8", background: "#08090a" });
  // White headings from a dark band of a page left on the browser's white
  // are not, and with no ground of its own the page gets no background.
  assert.deepEqual(theme([{ hex: "#ffffff", role: "heading" }], ""), {});
  // A dark ground with no text color that reads on it would get
  // Bootstrap's dark text, so it is left out as well.
  assert.deepEqual(theme([{ hex: "#1d243e", role: "heading" }, { hex: "#08090a", role: "surface" }], "#08090a"), {});
  // A pale link color does not read on white.
  assert.deepEqual(theme([{ hex: "#9fd3ff", role: "link" }], "#ffffff"), { background: "#ffffff" });
});

test("the header logo is the brand's own mark, one that shows on the page's ground", () => {
  const logos = [
    { file: "logo-01.png", svg: "logo-01.svg", where: "header", background: "#111111", onPicture: false },
    { file: "logo-02.png", where: "page", background: "#f4f4f4", onPicture: false, alt: "Acme AI logo" },
    { file: "logo-03.png", svg: "logo-03.svg", where: "footer", background: "#fafafa", onPicture: false },
  ];
  const medium = (background, list = logos) => (brandYml(kitOf({ logos: list }), { background }).match(/^ {2}medium: (.+)$/m) || [])[1];
  assert.equal(medium("#ffffff"), "logo-03", "a white page: the footer logo, drawn for a light ground");
  assert.equal(medium(""), "logo-03", "no ground of its own: the browser's white");
  assert.equal(medium("#0b0b0b"), "logo-01", "a dark page: the header logo drawn for it");
  // A product's logo in the page body is not the brand's, even on the
  // right ground. The header logo stays, as its cut: the white vector drawn
  // for a dark header would not show on a white page.
  assert.equal(medium("#ffffff", logos.slice(0, 2)), "logo-01.png");
  // A header logo cut with a picture around it gives way to a clean one.
  const picture = { ...logos[0], svg: "", onPicture: true, background: "#f0f0f0" };
  assert.equal(medium("#ffffff", [picture, logos[2]]), "logo-03");
  assert.equal(medium("#ffffff", logos.slice(1, 2)), "logo-02", "with no header or footer logo, the page's");
  // A white mark over a dark photo on a white page: no logo to show, so
  // none is picked, and the files are still listed.
  const overPhoto = { ...logos[0], onPicture: true, background: "#35535d" };
  const yml = brandYml(kitOf({ logos: [overPhoto, logos[1]] }), { background: "#ffffff" });
  assert.equal(medium("#ffffff", [overPhoto, logos[1]]), undefined);
  assert.match(yml, /^ {4}logo-01: logo-01\.svg$/m);
});

test("fonts: Google Fonts' own names, other fonts as system fonts", () => {
  assert.equal(googleFamily("Inter"), "Inter");
  assert.equal(googleFamily("open sans"), "Open Sans", "the name Google serves it under");
  for (const variable of ["Inter Variable", "InterVariable", "Inter var", "inter-var"]) assert.equal(googleFamily(variable), "Inter", variable);
  assert.equal(googleFamily("Roboto Flex"), "Roboto Flex");
  for (const own of ["sohne-var", "NotionInter", "Helvetica Neue", "", undefined]) assert.equal(googleFamily(own), "", own);
  const yml = brandYml(kitOf({ fonts: { heading: "Roboto Slab", body: "Roboto Slab" } }));
  assert.ok(yml.endsWith(["typography:", "  fonts:", "    - family: Roboto Slab", "      source: google", "  base: Roboto Slab", "  headings: Roboto Slab", ""].join("\n")), yml);
});

test("page text stays YAML text: quoted when it could read as YAML, and no name that would break a theme", () => {
  const yml = brandYml(
    kitOf({
      name: "No #1: Acme",
      fonts: { body: "yes", heading: "3270 Nerd Font" },
      logos: [{ file: "logo-01.png", background: "#ffffff", alt: 'Say "hi" there\nmeta: x' }],
    }),
  );
  assert.match(yml, /^ {2}name: "No #1: Acme"$/m);
  assert.match(yml, /^ {6}alt: "Say \\"hi\\"\\u2028there\\nmeta: x"$/m);
  assert.match(yml, /^ {4}- family: "yes"$/m);
  assert.match(yml, /^ {4}# 3270 Nerd Font is not on Google Fonts/m);
  assert.match(yml, /^ {2}headings: "3270 Nerd Font"$/m);
  assert.doesNotMatch(yml, /^meta: x/m);
  // Shiny would write these into its Sass as they are and break the theme.
  for (const odd of ["Evil\nmeta: x", "Acme: Display #2", "Font's", "Inter.Display", "Font+Plus", "a;b{}"]) {
    assert.doesNotMatch(brandYml(kitOf({ fonts: { body: odd } })), /typography/, odd);
  }
  assert.match(brandYml(kitOf({ fonts: { body: "Inter.var" } })), /^ {2}base: Inter$/m, "a Google font under its variable build's name");
});
