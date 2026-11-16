const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("../config/main");
const search = require("./search");

const writeMeta = (root, id, genus) => {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      assembly: { accession: `GCA_${id}.1`, prefix: id },
      taxon: { genus },
    }),
  );
  return dir;
};

const readCache = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, "search.json"), "utf8"));

describe("search cache", () => {
  let root;
  const originalDatasetTable = config.dataset_table;
  const originalMode = config.searchUpdateMode;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "btk-search-"));
  });

  afterEach(() => {
    config.dataset_table = originalDatasetTable;
    config.searchUpdateMode = originalMode;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes search.json and serves identical output from the cache", async () => {
    const dir = writeMeta(root, "AAAA01", "Foo");
    const fresh = await search.readMeta(root, [], "force");
    expect(fs.existsSync(path.join(dir, "search.json"))).toBe(true);
    const cached = await search.readMeta(root, [], "fast");
    expect(cached).toEqual(fresh);
    expect(search.generateIndex(cached)).toEqual(search.generateIndex(fresh));
  });

  it("stores the record without the latest flag or schema fields", async () => {
    const dir = writeMeta(root, "AAAA01", "Foo");
    await search.readMeta(root, [], "fast");
    const cache = readCache(dir);
    expect(cache.schema_version).toBe(search.SEARCH_SCHEMA_VERSION);
    expect(cache.record).not.toHaveProperty("latest");
    expect(cache.record).not.toHaveProperty("schema_version");
    expect(cache.record.genus).toBe("Foo");
  });

  it("fast mode reuses a valid cache even if meta.json changed", async () => {
    writeMeta(root, "AAAA01", "Foo");
    await search.readMeta(root, [], "fast");
    writeMeta(root, "AAAA01", "Bar");
    const md = await search.readMeta(root, [], "fast");
    expect(md[0].genus).toBe("Foo");
  });

  it("fast mode regenerates a cache with an old schema version", async () => {
    const dir = writeMeta(root, "AAAA01", "Foo");
    fs.writeFileSync(
      path.join(dir, "search.json"),
      JSON.stringify({
        schema_version: 0,
        summary_checked: false,
        record: { id: "AAAA01", genus: "Old", prefix: "AAAA01", revision: 0 },
      }),
    );
    const md = await search.readMeta(root, [], "fast");
    expect(md[0].genus).toBe("Foo");
    expect(readCache(dir).schema_version).toBe(search.SEARCH_SCHEMA_VERSION);
  });

  it("fast mode regenerates when search.json is missing", async () => {
    const dir = writeMeta(root, "AAAA01", "Foo");
    const md = await search.readMeta(root, [], "fast");
    expect(md[0].genus).toBe("Foo");
    expect(fs.existsSync(path.join(dir, "search.json"))).toBe(true);
  });

  it("mtime mode regenerates when meta.json is newer than search.json", async () => {
    const dir = writeMeta(root, "AAAA01", "Foo");
    await search.readMeta(root, [], "fast");
    const past = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(path.join(dir, "search.json"), past, past);
    writeMeta(root, "AAAA01", "Bar");
    const md = await search.readMeta(root, [], "mtime");
    expect(md[0].genus).toBe("Bar");
    expect(readCache(dir).record.genus).toBe("Bar");
  });

  it("mtime mode keeps the cache when search.json is newer than meta.json", async () => {
    const dir = writeMeta(root, "AAAA01", "Foo");
    await search.readMeta(root, [], "fast");
    const future = new Date(Date.now() + 60 * 60 * 1000);
    fs.utimesSync(path.join(dir, "search.json"), future, future);
    const md = await search.readMeta(root, [], "mtime");
    expect(md[0].genus).toBe("Foo");
  });

  it("force mode regenerates every record", async () => {
    const dir = writeMeta(root, "AAAA01", "Foo");
    await search.readMeta(root, [], "fast");
    writeMeta(root, "AAAA01", "Bar");
    const md = await search.readMeta(root, [], "force");
    expect(md[0].genus).toBe("Bar");
    expect(readCache(dir).record.genus).toBe("Bar");
  });

  it("does not regenerate on every start when summary.json is absent", async () => {
    config.dataset_table = "summary";
    const dir = writeMeta(root, "AAAA01", "Foo");
    await search.readMeta(root, [], "fast");
    expect(readCache(dir).summary_checked).toBe(true);
    const past = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(path.join(dir, "search.json"), past, past);
    await search.readMeta(root, [], "fast");
    const stat = fs.statSync(path.join(dir, "search.json"));
    expect(Math.floor(stat.mtimeMs / 1000)).toBe(Math.floor(past / 1000));
  });

  it("regenerates a cache built before dataset_table was enabled", async () => {
    const dir = writeMeta(root, "AAAA01", "Foo");
    await search.readMeta(root, [], "fast");
    expect(readCache(dir).summary_checked).toBe(false);
    config.dataset_table = "summary";
    await search.readMeta(root, [], "fast");
    expect(readCache(dir).summary_checked).toBe(true);
  });

  it("still returns records when the dataset directory is read-only", async () => {
    const dir = writeMeta(root, "AAAA01", "Foo");
    fs.chmodSync(dir, 0o555);
    try {
      const md = await search.readMeta(root, [], "force");
      expect(md).toHaveLength(1);
      expect(md[0].genus).toBe("Foo");
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });
});

describe("update mode", () => {
  const originalMode = config.searchUpdateMode;

  afterEach(() => {
    config.searchUpdateMode = originalMode;
  });

  it("accepts known modes", () => {
    expect(search.normaliseMode("mtime")).toBe("mtime");
    expect(search.normaliseMode("force")).toBe("force");
    expect(search.normaliseMode("fast")).toBe("fast");
  });

  it("falls back to the configured mode for unknown or missing values", () => {
    config.searchUpdateMode = "mtime";
    expect(search.normaliseMode(undefined)).toBe("mtime");
    expect(search.normaliseMode("bogus")).toBe("mtime");
    config.searchUpdateMode = "bogus";
    expect(search.normaliseMode(undefined)).toBe("fast");
  });
});

describe("paging", () => {
  it("returns undefined when no paging parameters are given", () => {
    expect(search.parsePaging({})).toBeUndefined();
  });

  it("applies defaults when only one parameter is given", () => {
    expect(search.parsePaging({ page: "2" })).toEqual({ page: 2, size: 20 });
    expect(search.parsePaging({ size: "5" })).toEqual({ page: 1, size: 5 });
  });

  it("caps size at 500 and floors page at 1", () => {
    expect(search.parsePaging({ size: "1000" })).toEqual({
      page: 1,
      size: 500,
    });
    expect(search.parsePaging({ page: "0", size: "10" })).toEqual({
      page: 1,
      size: 10,
    });
    expect(search.parsePaging({ page: "abc", size: "10" })).toEqual({
      page: 1,
      size: 10,
    });
  });

  it("slices items into pages and reports the total", () => {
    const items = Array.from({ length: 45 }, (_, i) => ({ id: `id${i}` }));
    const page3 = search.paginate(items, { page: 3, size: 20 });
    expect(page3.total).toBe(45);
    expect(page3.page).toBe(3);
    expect(page3.size).toBe(20);
    expect(page3.results).toHaveLength(5);
    expect(page3.results[0].id).toBe("id40");
  });

  it("returns an empty results array for a page beyond the end", () => {
    const items = [{ id: "a" }, { id: "b" }];
    const result = search.paginate(items, { page: 10, size: 20 });
    expect(result.total).toBe(2);
    expect(result.results).toEqual([]);
  });

  it("sorts by id without mutating the input", () => {
    const items = [{ id: "CCC" }, { id: "AAA" }, { id: "BBB" }];
    const sorted = search.sortById(items);
    expect(sorted.map((r) => r.id)).toEqual(["AAA", "BBB", "CCC"]);
    expect(items.map((r) => r.id)).toEqual(["CCC", "AAA", "BBB"]);
  });
});
