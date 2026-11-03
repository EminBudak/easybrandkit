"use strict";

// The kit end to end in a real headless browser (skipped when none is
// installed), against pages served from this process, plus the address and
// folder rules that need no browser.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { makeKit, normalizeUrl, homePageOf, siteOfListing, prepareDir, brandName } = require("../skills/easybrandkit/scripts/lib/kit");
const { findChrome } = require("../skills/easybrandkit/scripts/lib/chrome");
const { groundOf } = require("../skills/easybrandkit/scripts/lib/logos");

const CLI = path.resolve(__dirname, "../skills/easybrandkit/scripts/easybrandkit.js");
const noBrowser = !findChrome() && "no Chrome, Chromium, Edge or Brave installed";

// Minimal PNG reader for 8-bit RGB/RGBA, non-interlaced (what Chrome writes).
function readPng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let p = v;
      if (filter === 1) p = v + a;
      else if (filter === 2) p = v + b;
      else if (filter === 3) p = v + ((a + b) >> 1);
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      pixels[y * stride + x] = p & 0xff;
    }
  }
  return { width, height, pixel: (x, y) => [...pixels.subarray(y * stride + x * channels, y * stride + x * channels + 3)] };
}

// Minimal PNG writer: 8-bit RGB, each row unfiltered.
function pngOf(width, height, color) {
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) Buffer.from(color(x, y)).copy(raw, y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function serve(handler) {
  const server = http.createServer(handler).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const svg = (fill, w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`;

test("addresses: bare domains get https, sub-pages point to the home page", () => {
  assert.equal(normalizeUrl("acme.com"), "https://acme.com/");
  assert.equal(normalizeUrl("http://acme.com/tr"), "http://acme.com/tr");
  assert.throws(() => normalizeUrl("ftp://acme.com"), /Not a web address/);
  assert.throws(() => normalizeUrl(""), /Give a website address/);
  assert.equal(homePageOf("https://acme.com/"), null);
  assert.equal(homePageOf("https://acme.com/tr"), null);
  assert.equal(homePageOf("https://acme.com/en-us/"), null);
  assert.equal(homePageOf("https://acme.com/pricing"), "https://acme.com/");
  assert.equal(homePageOf("https://blog.acme.com/"), "https://acme.com/");
  assert.equal(brandName("Acme", "Whatever", "https://acme.com/"), "Acme");
  assert.equal(brandName("", "Acme | Payments for teams", "https://acme.com/"), "Acme");
  assert.equal(brandName("", "", "https://www.acme.com/"), "Acme");
});

test("stores and social networks: a listing leads to its website, a profile is refused before anything runs", async () => {
  assert.equal(siteOfListing("https://culturedcode.com/things"), "https://culturedcode.com/things");
  assert.equal(siteOfListing("https://www.acme.com/help/support-request"), "https://www.acme.com/");
  assert.equal(siteOfListing("https://www.facebook.com/acme"), "");
  assert.equal(siteOfListing("not a url"), "");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "easybrandkit-out-"));
  const dir = path.join(parent, "kit");
  try {
    for (const profile of ["x.com/acme", "https://www.instagram.com/acme/", "https://www.linkedin.com/company/acme", "apps.apple.com"]) {
      await assert.rejects(makeKit(profile, { dir }), /not the brand's own site/, profile);
    }
    assert.equal(fs.existsSync(dir), false, "nothing was written");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("never writes into a folder that holds someone else's files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easybrandkit-dir-"));
  try {
    fs.writeFileSync(path.join(dir, "notes.txt"), "mine");
    assert.throws(() => prepareDir(dir), /not empty/);
    assert.equal(fs.readFileSync(path.join(dir, "notes.txt"), "utf8"), "mine");
    // An earlier kit is replaced, by file name only.
    fs.rmSync(path.join(dir, "notes.txt"));
    fs.writeFileSync(path.join(dir, "logo-01.png"), "old");
    fs.writeFileSync(path.join(dir, "brand.json"), JSON.stringify({ version: 1, logos: [{ file: "../../escape.png" }, { file: "logo-01.png" }] }));
    prepareDir(dir);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the skill folder carries its own version, the same as the package's", () => {
  assert.equal(require("../skills/easybrandkit/scripts/lib/version"), require("../package.json").version);
});

test("a cut's ground comes from its pixels: one color, or a picture", () => {
  const navy = [29, 36, 62];
  const solid = pngOf(60, 40, (x, y) => (x > 20 && x < 40 && y > 12 && y < 28 ? [255, 0, 0] : navy));
  assert.deepEqual(groundOf(solid, 4), { hex: "#1d243e", solid: true });
  const stripes = pngOf(60, 40, (x) => (x % 8 < 4 ? [10, 4, 32] : [122, 44, 255]));
  assert.equal(groundOf(stripes, 4).solid, false);
  // A mark at the page's left edge has no margin there: that side is not read.
  const edge = pngOf(60, 40, (x) => (x < 4 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(groundOf(edge, 4).solid, false);
  assert.deepEqual(groundOf(edge, 4, { top: true, right: true, bottom: true, left: false }), { hex: "#ffffff", solid: true });
  assert.equal(groundOf(Buffer.from("not a png"), 4), null);
});

test("the CLI explains itself and refuses a missing address", () => {
  const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: easybrandkit <url>/);
  const none = spawnSync(process.execPath, [CLI], { encoding: "utf8" });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /Give one website address/);
});

test("logos: the site's own marks on their real background, plus colors, fonts, icons, images and links", { skip: noBrowser }, async () => {
  // A red inline-svg logo in the header link to "/", a white logo image in a
  // navy footer; around them what must NOT come back: a flag in the nav, a
  // brand image inside a closed (opacity 0) menu panel, a brand image in a
  // hero <header> lower on the page, a customer strip, a payment badge. A
  // cookie bar floats over the first screen.
  const files = {
    "/acme-logo-light.svg": svg("rgb(255,255,255)", 140, 36),
    "/acme-logo-menu.svg": svg("rgb(0,0,255)", 80, 30),
    "/acme-shape.svg": svg("rgb(0,128,0)", 300, 200),
    "/flag.svg": svg("rgb(200,200,0)", 20, 14),
    "/logo/client-one.svg": svg("rgb(120,0,120)", 100, 40),
    "/logo/visa-logo.svg": svg("rgb(0,90,200)", 60, 20),
  };
  const html = `<!doctype html><html><head>
    <title>Acme | Tools for teams</title>
    <meta name="description" content="Tools for teams
      that ship.">
    <meta property="og:site_name" content="Acme">
    <meta property="og:image" content="/og.png">
    <meta name="apple-itunes-app" content="app-id=1234567890">
    <link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
    <link rel="manifest" href="/site.webmanifest">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","logo":"/brand/acme-logo.png","sameAs":["https://www.instagram.com/acme/","https://twitter.com/intent/tweet?text=hi"]}</script>
    <style>
      body{margin:0;background:#fff}
      header.top{height:60px;background:rgb(255,255,255);display:flex;align-items:center;padding-left:20px;position:relative}
      .menu{position:absolute;top:60px;left:300px;opacity:0}
      .hero{height:1500px;padding-top:300px;background:rgb(240,240,240)}
      footer{height:200px;background:rgb(29,36,62);display:flex;align-items:center;gap:20px;padding-left:20px}
      img{display:block}
      .cookies{position:fixed;left:0;right:0;bottom:0;height:120px;background:rgb(255,0,255)}
    </style></head><body>
    <header class="top"><a href="/" class="brand">${svg("rgb(255,0,0)", 120, 30)}</a>
      <nav><img src="/flag.svg" alt="English"><div class="menu"><img src="/acme-logo-menu.svg" alt="Acme"></div></nav></header>
    <section class="hero"><header class="hero-head"><img src="/acme-shape.svg" alt="Acme"></header>
      <h1 style="color:rgb(15,23,42);font-family:Georgia,serif">Acme for teams</h1>
      <a class="cta" href="/start" style="display:inline-block;width:160px;height:44px;background:rgb(63,86,200)">Start</a>
      <button style="width:120px;height:40px;background:rgb(255,255,255)">EN</button>
      <p style="font-family:Verdana,sans-serif">Read <a href="/guide" style="color:rgb(220,38,38)">the guide</a></p>
      <div class="clients"><img src="/logo/client-one.svg" alt="Client One"></div></section>
    <footer><img src="/acme-logo-light.svg" alt="Acme"><img src="/logo/visa-logo.svg" alt="Visa">
      <a href="https://play.google.com/store/apps/details?id=com.acme.app&hl=en">Play</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
      <a href="https://linkedin.com/company/acme/">LinkedIn</a></footer>
    <div class="cookies">We use cookies</div>
  </body></html>`;
  const { server, origin } = await serve((req, res) => {
    const body = files[req.url];
    if (body) res.writeHead(200, { "content-type": "image/svg+xml" }).end(body);
    else res.writeHead(200, { "content-type": "text/html" }).end(html);
  });
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "easybrandkit-out-")), "kit");
  try {
    // A blog post's address: the kit is read from the home page.
    const { kit } = await makeKit(`${origin}/blog/first-post`, { dir, stores: false });
    assert.equal(kit.url, `${origin}/`);
    assert.equal(kit.name, "Acme");
    assert.match(kit.notes[0], /is not the home page/);
    assert.deepEqual(kit.logos.map((l) => [l.file, l.where, l.kind]), [["logo-01.png", "header", "svg"], ["logo-02.png", "footer", "img"]], JSON.stringify(kit.logos));
    assert.equal(kit.logos[1].src, `${origin}/acme-logo-light.svg`);
    assert.equal(kit.logos[1].background, "#1d243e");
    // Both are drawn as SVG: the inline one is written out, the image is the
    // file as the browser loaded it.
    assert.deepEqual(kit.logos.map((l) => [l.svg, l.onPicture]), [["logo-01.svg", false], ["logo-02.svg", false]]);
    assert.match(fs.readFileSync(path.join(dir, "logo-01.svg"), "utf8"), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg".*<rect [^>]*fill="rgb\(255,0,0\)"/s);
    assert.equal(fs.readFileSync(path.join(dir, "logo-02.svg"), "utf8"), files["/acme-logo-light.svg"] + "\n");

    const header = readPng(path.join(dir, "logo-01.png"));
    const footer = readPng(path.join(dir, "logo-02.png"));
    for (const png of [header, footer]) {
      assert.ok(Math.min(png.width, png.height) >= 240, `${png.width}x${png.height}`);
    }
    assert.deepEqual(header.pixel(header.width >> 1, header.height >> 1), [255, 0, 0], "header logo");
    assert.deepEqual(header.pixel(2, 2), [255, 255, 255], "header background");
    assert.deepEqual(footer.pixel(footer.width >> 1, footer.height >> 1), [255, 255, 255], "footer logo");
    assert.deepEqual(footer.pixel(2, 2), [29, 36, 62], "footer background");
    assert.ok(fs.readFileSync(path.join(dir, "logo-01.png")).includes("Source\0easybrandkit logo"), "the cut is tagged");

    assert.deepEqual(kit.icons, [
      { rel: "icon", href: `${origin}/favicon.ico`, sizes: "" },
      { rel: "apple-touch-icon", href: `${origin}/apple.png`, sizes: "180x180" },
    ]);
    assert.deepEqual(kit.images, [
      { property: "og:image", url: `${origin}/og.png` },
      { property: "ld+json:logo", url: `${origin}/brand/acme-logo.png` },
    ]);
    assert.equal(kit.manifest, `${origin}/site.webmanifest`);
    assert.deepEqual(kit.links, [
      { type: "appstore", url: "https://apps.apple.com/app/id1234567890", from: "meta" },
      { type: "instagram", url: "https://instagram.com/acme", from: "ld+json" },
      { type: "googleplay", url: "https://play.google.com/store/apps/details?id=com.acme.app", from: "footer" },
      { type: "linkedin", url: "https://linkedin.com/company/acme", from: "footer" },
    ]);
    // The look: the coloured button (not the white one), the red the logo is
    // drawn in, the heading, the link in the text, the header and footer,
    // the large grey hero; fonts. The white footer logo adds no color.
    assert.deepEqual(kit.logos.map((l) => l.color), ["#ff0000", "#ffffff"]);
    assert.deepEqual(kit.colors, [
      { hex: "#3f56c8", role: "button" },
      { hex: "#ff0000", role: "logo" },
      { hex: "#0f172a", role: "heading" },
      { hex: "#dc2626", role: "link" },
      { hex: "#ffffff", role: "header" },
      { hex: "#1d243e", role: "footer" },
      { hex: "#f0f0f0", role: "surface" },
    ]);
    assert.deepEqual(kit.fonts, { heading: "Georgia", body: "Verdana" });
    // The words a no-brief film or page starts from: what the colored button
    // says, not the white language switch.
    assert.deepEqual(kit.text, {
      title: "Acme | Tools for teams",
      description: "Tools for teams that ship.",
      headings: [{ tag: "h1", text: "Acme for teams" }],
      ctas: ["Start"],
    });

    // The first screen at 2x, without the cookie bar.
    assert.deepEqual(kit.screenshots, [{ file: "screen-01.png", width: 3200, height: 1800 }]);
    const screen = readPng(path.join(dir, "screen-01.png"));
    assert.notDeepEqual(screen.pixel(1600, 1760), [255, 0, 255], "the cookie bar is hidden");
    // The card: the kit on one picture, the button color on a swatch.
    assert.deepEqual(kit.card, { file: "card.png", width: 2400, height: 1350 });
    const card = readPng(path.join(dir, "card.png"));
    let swatch = false;
    for (let y = 0; y < card.height && !swatch; y += 6) {
      for (let x = card.width >> 1; x < card.width && !swatch; x += 6) swatch = card.pixel(x, y).join() === "63,86,200";
    }
    assert.ok(swatch, "the button color is on the card");

    const saved = JSON.parse(fs.readFileSync(path.join(dir, "brand.json"), "utf8"));
    assert.equal(saved.version, 1);
    assert.deepEqual(saved.logos, kit.logos);
    const markdown = fs.readFileSync(path.join(dir, "BRAND.md"), "utf8");
    assert.match(markdown, /^# Acme brand kit/);
    assert.match(markdown, /\| `#3f56c8` \| buttons \|/);
    assert.match(markdown, /\| logo-02\.png \| footer \| `#1d243e` \| \d+x\d+ \| logo-02\.svg \|/);
  } finally {
    server.close();
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test("a bot check served instead of the page fails with a reason and leaves nothing behind", { skip: noBrowser }, async () => {
  // Read as a site, a CAPTCHA page gave a kit named "Human Verification" in
  // the check provider's orange.
  const html = `<!doctype html><html><head><title>Human Verification</title><script src="/awswaf/challenge.js"></script></head>
    <body style="margin:0;font-family:Arial"><h1 style="color:rgb(221,107,16)">Confirm you are human</h1>
    <button style="width:200px;height:44px;background:rgb(255,153,2)">Begin</button></body></html>`;
  const { server, origin } = await serve((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(html));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "easybrandkit-out-"));
  const dir = path.join(parent, "kit");
  try {
    await assert.rejects(makeKit(origin, { dir, stores: false }), /answered with a bot check \("Human Verification"\)/);
    assert.equal(fs.existsSync(dir), false, "no folder left behind");
  } finally {
    server.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("logos: the mark alone, as it stands once settled: no neighbour cut by the margin, no popup backdrop, its ground kept", { skip: noBrowser }, async () => {
  // A white header logo over a dark hero that lies behind a see-through
  // header (a sibling, not an ancestor: it must stay), a red line 4 px under
  // it, a popup's half-black backdrop over the page, and a 6 s fade-in on
  // the logo.
  const html = `<!doctype html><html><head><style>
      body{margin:0;background:#fff}
      .hero{position:absolute;left:0;top:0;width:100%;height:420px;background:rgb(10,60,40);z-index:0}
      header.top{position:relative;z-index:1;height:80px;display:flex;align-items:center;padding-left:40px}
      a.brand{display:block;animation:in 6s linear both}
      @keyframes in{from{opacity:0}to{opacity:1}}
      .tag{position:absolute;left:40px;top:59px;width:120px;height:10px;background:rgb(255,0,0)}
      main{position:relative;z-index:1;height:1400px;padding-top:500px}
      footer{height:200px;background:rgb(29,36,62);display:flex;align-items:center;padding-left:20px}
      .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100}
      .dialog{position:fixed;left:50%;top:50%;width:300px;height:200px;margin:-100px 0 0 -150px;background:#fff;z-index:101}
    </style></head><body>
    <div class="hero"></div>
    <header class="top"><a href="/" class="brand">${svg("rgb(255,255,255)", 120, 30)}</a><div class="tag"></div></header>
    <main><h1>Acme</h1></main>
    <footer><a href="/">${svg("rgb(255,255,255)", 140, 36)}</a></footer>
    <div class="backdrop"></div><div class="dialog">Sale</div>
  </body></html>`;
  const { server, origin } = await serve((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(html));
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "easybrandkit-out-")), "kit");
  try {
    const { kit } = await makeKit(origin, { dir, stores: false });
    assert.equal(kit.logos[0].where, "header", JSON.stringify(kit.logos));
    // The page's CSS has white under the logo; the cut shows the hero.
    assert.equal(kit.logos[0].background, "#0a3c28");
    assert.equal(kit.logos[0].onPicture, false);
    const header = readPng(path.join(dir, kit.logos[0].file));
    assert.deepEqual(header.pixel(header.width >> 1, header.height >> 1), [255, 255, 255], "the logo, whole and opaque");
    assert.deepEqual(header.pixel(2, 2), [10, 60, 40], "the hero behind it, not dimmed");
    for (let y = 0; y < header.height; y += 2) {
      for (let x = 0; x < header.width; x += 2) {
        const [r, g, b] = header.pixel(x, y);
        assert.ok(!(r > 150 && g < 80 && b < 80), `the red line under the logo at ${x},${y}`);
      }
    }
  } finally {
    server.close();
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test("logos: a lockup on a picture is not the logo; the vector keeps the page's look and nothing that runs", { skip: noBrowser }, async () => {
  // A header logo over a striped header (kept, on a picture) whose parts are
  // colored by the page's stylesheet, with a part the page hides, a symbol it
  // takes from a sprite elsewhere in the page, a script and an event handler.
  // In the page body, the brand's event lockup over a striped banner (not
  // kept). A white logo in a solid navy footer.
  const html = `<!doctype html><html><head>
    <meta property="og:site_name" content="Acme">
    <style>
      body{margin:0;background:#fff}
      header.top{height:80px;display:flex;align-items:center;padding-left:40px;background:repeating-linear-gradient(90deg,rgb(30,30,30) 0 6px,rgb(220,220,220) 6px 12px)}
      .mark .ink{fill:rgb(83,58,253)}
      .mark .narrow{display:none}
      .promo{margin-top:300px;height:300px;display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(90deg,rgb(10,4,32) 0 7px,rgb(122,44,255) 7px 14px)}
      main{height:1200px}
      footer{height:200px;background:rgb(29,36,62);display:flex;align-items:center;padding-left:20px}
    </style></head><body>
    <svg width="0" height="0" style="position:absolute"><symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></symbol></svg>
    <header class="top"><a href="/" aria-label="Acme home"><svg class="mark" width="160" height="40" viewBox="0 0 160 40" onload="window.loaded=1"><script>window.ran=1</script><rect class="ink" width="120" height="40"/><rect class="narrow" width="40" height="40" fill="rgb(0,255,0)"/><use href="#dot" x="130" y="10" width="20" height="20" fill="currentColor" style="color:rgb(255,0,0)"/></svg></a></header>
    <section class="promo"><a href="/sessions" aria-label="Acme Sessions"><svg class="sessions-logo" width="300" height="60"><rect width="300" height="60" fill="rgb(255,255,255)"/></svg></a></section>
    <main></main>
    <footer><a href="/">${svg("rgb(255,255,255)", 140, 36)}</a></footer>
  </body></html>`;
  const { server, origin } = await serve((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(html));
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "easybrandkit-out-")), "kit");
  try {
    const { kit } = await makeKit(origin, { dir, stores: false });
    assert.deepEqual(kit.logos.map((l) => [l.where, l.onPicture, l.svg]), [["header", true, "logo-01.svg"], ["footer", false, "logo-02.svg"]], JSON.stringify(kit.logos));
    assert.equal(kit.logos[0].color, "", "no logo color read off a picture");
    assert.equal(kit.logos[1].background, "#1d243e");

    const vector = fs.readFileSync(path.join(dir, "logo-01.svg"), "utf8");
    assert.match(vector, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(vector, /<rect class="ink"[^>]*style="[^"]*fill:rgb\(83, 58, 253\)/, "the stylesheet's fill, written onto the part");
    assert.match(vector, /<use [^>]*style="[^"]*fill:rgb\(255, 0, 0\)/, "currentColor, resolved");
    assert.match(vector, /<defs><symbol id="dot"/, "the symbol it uses, brought in");
    assert.doesNotMatch(vector, /narrow|0,255,0/, "the part the page hides");
    assert.doesNotMatch(vector, /<script|onload|window\./, "nothing that runs");

    const markdown = fs.readFileSync(path.join(dir, "BRAND.md"), "utf8");
    assert.match(markdown, /\| logo-01\.png \| header \| a picture, mostly `#[0-9a-f]{6}` \| \d+x\d+ \| logo-01\.svg \|/);
    assert.match(markdown, /A logo on a picture was cut with part of that picture around it\./);
  } finally {
    server.close();
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});
