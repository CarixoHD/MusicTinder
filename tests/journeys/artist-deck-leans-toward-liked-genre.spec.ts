import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

function wav() {
  const sampleRate = 8000;
  const samples = sampleRate;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + samples, 4); buffer.write("WAVE", 8); buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28); buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return buffer;
}

type Genre = "Metal" | "Jazz";

const genreOfName = (name: string): Genre => (name.startsWith("Met") ? "Metal" : "Jazz");
const genreOfTitle = (title: string): Genre | undefined =>
  /^Met/.test(title) ? "Metal" : /^Jaz/.test(title) ? "Jazz" : undefined;

test("on an Artists deck, liking Jazz and skipping Metal tags every card and leans toward Jazz", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;

  await page.route(/mzstatic\.com|dzcdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const url = new URL(route.request().url());
    const entity = url.searchParams.get("entity");
    const term = url.searchParams.get("term") ?? "";
    let results: object[] = [];

    if (entity === "musicArtist") {
      results = [
        {
          wrapperType: "artist",
          artistType: "Artist",
          artistName: /Kin/.test(term) ? term : `${term} Band`,
          artistId: ++id,
          primaryGenreName: /Kin/.test(term) ? genreOfName(term) : "Rock",
        },
      ];
    } else if (entity === "song") {
      // Just-in-time sample for an artist card: one preview in that artist's genre.
      results = [
        {
          wrapperType: "track",
          kind: "song",
          trackId: ++id,
          trackName: `${term} sample`,
          artistId: ++id,
          artistName: term,
          primaryGenreName: genreOfName(term),
          previewUrl: "https://audio-ssl.itunes.apple.com/sample.m4a",
        },
      ];
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ resultCount: results.length, results }),
    });
  });
  // A stable related list, like Deezer's: each refill sees the same artists,
  // so their iTunes genres are cached after the first lookup.
  const relatedId = ++id;
  const metal = new Set([5, 9, 13]);
  const related = Array.from({ length: 20 }, (_, index) => ({
    id: relatedId * 100 + index,
    name: `${metal.has(index) ? "Met" : "Jaz"}Kin${index}`,
  }));

  const WAV = wav();
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: WAV }),
  );
  await page.route(/api\.deezer\.com/, async (route) => {
    const url = new URL(route.request().url());
    const callback = url.searchParams.get("callback");
    // Metal and Jazz related artists, as in the reported catalogue. Jazz
    // outnumbers Metal so the lean stays observable across 12 cards within the
    // iTunes budget, which only tags the head of the list.
    const data = url.pathname.includes("/search")
      ? { data: [{ id: relatedId, name: `${url.searchParams.get("q")} Band` }] }
      : { data: related };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${callback}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Neutral${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Neutral${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Artists", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const current = page.locator(".deck__current");
  const title = current.getByRole("heading", { level: 2 });
  const dealt: Genre[] = [];

  for (let card = 1; card <= 12; card += 1) {
    await expect(title, `card ${card} title`).toHaveText(/^(Met|Jaz)Kin\d+$/);
    const text = (await title.textContent())!;
    const genre = genreOfTitle(text);
    expect(genre, `card ${card}: ${text}`).toBeDefined();

    // Every card carries one or two genre tags (PRD card content).
    await expect(current.locator(".tag"), `card ${card} (${text}) genre tags`).not.toHaveCount(0);
    expect(await current.locator(".tag").count(), `card ${card} (${text}) tag count`).toBeLessThanOrEqual(2);

    dealt.push(genre!);
    await page.getByRole("button", { name: genre === "Jazz" ? "Like" : "Skip", exact: true }).click();
    await expect(title).not.toHaveText(text);
  }

  // Metal artists sit near the head of the related list but are dealt after
  // the Jazz ones the likes raised.
  const late = dealt.slice(6);
  expect(late.filter((genre) => genre === "Metal").length, `cards 7-12: ${late.join(", ")}`).toBeLessThanOrEqual(1);
});
