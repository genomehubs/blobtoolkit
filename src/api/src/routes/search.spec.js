const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const config = require("../config/main");
const goat = require("../functions/goat");
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

describe("accession supersede", () => {
  let root;
  const originalSupersede = config.supersedeByAccession;

  const writeDataset = (id, prefix, accession) => {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({
        assembly: { accession, prefix },
        taxon: { genus: "Foo" },
      }),
    );
  };

  const currentIds = async () => {
    const md = await search.readMeta(root, [], "force");
    search.markSuperseded(md);
    return md
      .filter(search.isCurrent)
      .map((m) => m.id)
      .sort();
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "btk-supersede-"));
  });

  afterEach(() => {
    config.supersedeByAccession = originalSupersede;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps same-accession datasets when the option is off", async () => {
    config.supersedeByAccession = false;
    writeDataset("CACTIT02", "CACTIT02", "GCA_000001215.4");
    writeDataset("GCA_000001215_4", "GCA_000001215_4", "GCA_000001215.4");
    expect(await currentIds()).toEqual(["CACTIT02", "GCA_000001215_4"]);
  });

  it("hides non-GCA prefixes sharing an accession with a GCA-prefixed dataset", async () => {
    config.supersedeByAccession = true;
    writeDataset("CACTIT02", "CACTIT02", "GCA_000001215.4");
    writeDataset("GCA_000001215_4", "GCA_000001215_4", "GCA_000001215.4");
    expect(await currentIds()).toEqual(["GCA_000001215_4"]);
  });

  it("matches a GCA prefix without a version suffix", async () => {
    config.supersedeByAccession = true;
    writeDataset("AAAA01", "AAAA01", "GCA_900002335.1");
    writeDataset("GCA_900002335", "GCA_900002335", "GCA_900002335.2");
    expect(await currentIds()).toEqual(["GCA_900002335"]);
  });

  it("keeps same-accession datasets when no GCA-prefixed dataset exists", async () => {
    config.supersedeByAccession = true;
    writeDataset("CACTIT02", "CACTIT02", "GCA_000001215.4");
    writeDataset("LQHL01", "LQHL01", "GCA_000001215.4");
    expect(await currentIds()).toEqual(["CACTIT02", "LQHL01"]);
  });

  it("leaves datasets with a different accession alone", async () => {
    config.supersedeByAccession = true;
    writeDataset("CACTIT02", "CACTIT02", "GCA_000001215.4");
    writeDataset("GCA_000002995_5", "GCA_000002995_5", "GCA_000002995.5");
    expect(await currentIds()).toEqual(["CACTIT02", "GCA_000002995_5"]);
  });

  it("excludes superseded datasets from the index without changing records", async () => {
    config.supersedeByAccession = true;
    writeDataset("CACTIT02", "CACTIT02", "GCA_000001215.4");
    writeDataset("GCA_000001215_4", "GCA_000001215_4", "GCA_000001215.4");
    const md = await search.readMeta(root, [], "force");
    search.markSuperseded(md);
    const index = search.generateIndex(md);
    const ids = index.values.Foo.flatMap((entry) => entry.i).map(
      (i) => md[i].id,
    );
    expect(ids).toEqual(["GCA_000001215_4"]);
    expect(Object.keys(md[0])).not.toContain("superseded");
  });
});

describe("tree numerator", () => {
  let root;
  const originalSupersede = config.supersedeByAccession;

  const writeDataset = (id, prefix, accession) => {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({
        assembly: { accession, prefix },
        taxon: { genus: "Foo" },
      }),
    );
  };

  const leafIds = (node) =>
    Object.entries(node.d)
      .flatMap(([key, child]) => (child.r ? leafIds(child) : [key]))
      .sort();

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "btk-numerator-"));
  });

  afterEach(() => {
    config.supersedeByAccession = originalSupersede;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("counts only the current revision of each prefix", async () => {
    config.supersedeByAccession = false;
    writeDataset("AAAA01", "AAAA01", "GCA_000001215.1");
    writeDataset("AAAA01.1", "AAAA01", "GCA_000001215.2");
    const md = await search.readMeta(root, [], "force");
    expect(leafIds(search.generateTree(md))).toEqual(["AAAA01.1"]);
  });

  it("does not count datasets superseded by accession", async () => {
    config.supersedeByAccession = true;
    writeDataset("CACTIT02", "CACTIT02", "GCA_000001215.4");
    writeDataset("GCA_000001215_4", "GCA_000001215_4", "GCA_000001215.4");
    const md = await search.readMeta(root, [], "force");
    search.markSuperseded(md);
    expect(leafIds(search.generateTree(md))).toEqual(["GCA_000001215_4"]);
  });

  it("counts only datasets listed in the targets", async () => {
    writeDataset("CACTIT02", "CACTIT02", "GCA_000001215.4");
    writeDataset("LQHL01", "LQHL01", "GCA_000002995.1");
    const md = await search.readMeta(root, [], "force");
    const keys = new Set(["GCA_000001215"]);
    expect(leafIds(search.generateTree(md, keys))).toEqual(["CACTIT02"]);
    expect(leafIds(search.generateTree(md))).toEqual(["CACTIT02", "LQHL01"]);
  });

  it("collects base accessions from target leaves", () => {
    const targets = {
      d: {
        Eukaryota: { r: "superkingdom", d: { "GCA_000001215.4": { n: 2 } } },
      },
    };
    const keys = search.collectTargetKeys(targets);
    expect(keys.has("GCA_000001215.4")).toBe(true);
    expect(keys.has("GCA_000001215")).toBe(true);
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

  it("sorts by a field in either direction with id as the tie-breaker", () => {
    const items = [
      { id: "c", records: 5 },
      { id: "a", records: 9 },
      { id: "b", records: 5 },
    ];
    expect(
      search.sortRecords(items, "records", "asc").map((r) => r.id),
    ).toEqual(["b", "c", "a"]);
    expect(
      search.sortRecords(items, "records", "desc").map((r) => r.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("places records without the sort field last in either direction", () => {
    const items = [
      { id: "a" },
      { id: "b", name: "Bee" },
      { id: "c", name: "Ay" },
    ];
    expect(search.sortRecords(items, "name", "asc").map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(search.sortRecords(items, "name", "desc").map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("ignores object-valued fields and falls back to id order", () => {
    const items = [
      { id: "b", assembly: { level: "x" } },
      { id: "a", assembly: { level: "y" } },
    ];
    expect(
      search.sortRecords(items, "assembly", "asc").map((r) => r.id),
    ).toEqual(["a", "b"]);
  });

  it("uses id order when no sort field is given", () => {
    const items = [{ id: "b" }, { id: "a" }];
    expect(
      search.sortRecords(items, undefined, "desc").map((r) => r.id),
    ).toEqual(["a", "b"]);
  });

  it("parses sort and order from the query string", () => {
    expect(search.parseSort({})).toEqual({});
    expect(search.parseSort({ sort: "name" })).toEqual({
      field: "name",
      order: "asc",
    });
    expect(search.parseSort({ sort: "records", order: "desc" })).toEqual({
      field: "records",
      order: "desc",
    });
  });
});

describe("targets tree endpoints", () => {
  const root = {
    n: 0,
    r: "root",
    ta: 3,
    ts: 2,
    d: {
      Eukaryota: {
        n: 1,
        r: "superkingdom",
        ta: 3,
        ts: 2,
        d: {
          Nematoda: {
            n: 2,
            r: "phylum",
            ta: 2,
            ts: 1,
            d: {
              Caenorhabditis: {
                n: 3,
                r: "genus",
                ta: 2,
                ts: 1,
                d: {
                  "Caenorhabditis elegans": {
                    n: 4,
                    r: "species",
                    ta: 2,
                    ts: 1,
                    d: { "GCA_1.1": { n: 5 }, "GCA_2.1": { n: 6 } },
                  },
                },
              },
            },
          },
          Chordata: {
            n: 7,
            r: "phylum",
            ta: 1,
            ts: 1,
            d: {
              Homo: {
                n: 8,
                r: "genus",
                ta: 1,
                ts: 1,
                d: { "GCA_3.1": { n: 9 } },
              },
            },
          },
        },
      },
    },
  };

  it("returns a node with summaries of its direct children only", () => {
    const rootNode = search.nodeResponse(root);
    expect(rootNode).toEqual({
      n: 0,
      r: "root",
      ta: 3,
      ts: 2,
      d: { Eukaryota: { n: 1, r: "superkingdom", ta: 3, ts: 2 } },
    });
    const eukaryota = search.nodeResponse(root.d.Eukaryota);
    expect(Object.keys(eukaryota.d)).toEqual(["Nematoda", "Chordata"]);
    expect(eukaryota.d.Nematoda.d).toBeUndefined();
  });

  it("returns assembly leaves as bare ids", () => {
    expect(search.nodeResponse({ n: 5 })).toEqual({ n: 5 });
  });

  it("indexes parents and names for every node", () => {
    const index = search.indexTargets(root);
    expect(index.parents.get(5)).toBe(4);
    expect(index.parents.get(1)).toBe(0);
    expect(index.names.get("Homo")).toEqual([8]);
    expect(index.nodes.get(9).n).toBe(9);
  });

  it("returns ancestors of an assembly, with expanded nodes and the target id", () => {
    const index = search.indexTargets(root);
    const result = search.targetTerm(index, "GCA_1.1");
    expect(result.targets).toEqual([5]);
    expect(result.expand).toEqual({ 4: 3, 3: 2, 2: 1, 1: 0 });
    expect(result.nodes.map((node) => node.n)).toEqual([1, 2, 3, 4]);
    expect(Object.keys(result.nodes.find((node) => node.n === 4).d)).toEqual([
      "GCA_1.1",
      "GCA_2.1",
    ]);
  });

  it("returns no expanded nodes for a top-level taxon", () => {
    const index = search.indexTargets(root);
    expect(search.targetTerm(index, "Eukaryota")).toEqual({
      term: "Eukaryota",
      nodes: [],
      expand: {},
      targets: [1],
    });
  });

  it("returns empty results for an unknown term", () => {
    const index = search.indexTargets(root);
    expect(search.targetTerm(index, "Missing").targets).toEqual([]);
  });
});

describe("targets tree", () => {
  it("counts assemblies and distinct species and names missing ranks", () => {
    const rows = [
      {
        assembly_id: "GCA_000000001.1",
        superkingdom: "Eukaryota",
        phylum: "Nematoda",
        genus: "Caenorhabditis",
        species: "Caenorhabditis elegans",
      },
      {
        assembly_id: "GCA_000000002.1",
        superkingdom: "Eukaryota",
        phylum: "Nematoda",
        genus: "Caenorhabditis",
        species: "Caenorhabditis elegans",
      },
      {
        assembly_id: "GCA_000000003.1",
        superkingdom: "Eukaryota",
        phylum: "Nematoda",
      },
    ];
    const tree = goat.buildTargetTree(rows, {
      "GCA_000000001.1": "AAAA01",
    });
    expect(tree.ta).toBe(3);
    expect(tree.ts).toBe(2);
    const nematoda = tree.d.Eukaryota.d["Other Eukaryota"].d.Nematoda;
    expect(nematoda.ta).toBe(3);
    expect(nematoda.ts).toBe(2);
    expect(nematoda.d).toHaveProperty("Other Nematoda");
    const keys = search.collectTargetKeys(tree);
    expect(keys.has("AAAA01")).toBe(true);
    expect(keys.has("GCA_000000002.1")).toBe(true);
    expect(keys.has("GCA_000000003.1")).toBe(true);
  });
});

describe("GoaT lookups and targets", () => {
  const originalGoatApi = config.goatApi;
  const originalGoatSearchApi = config.goatSearchApi;
  const lineageOf = (species) => [
    { taxon_rank: "species", scientific_name: species },
    { taxon_rank: "genus", scientific_name: species.split(" ")[0] },
    { taxon_rank: "phylum", scientific_name: "Nematoda" },
    { taxon_rank: "domain", scientific_name: "Eukaryota" },
  ];
  const assemblies = [
    { assembly_id: "GCA_000000001.1", species: "Caenorhabditis elegans" },
    { assembly_id: "GCA_000000002.1", species: "Caenorhabditis elegans" },
    { assembly_id: "GCA_000000003.1", species: "Pristionchus pacificus" },
  ].map(({ assembly_id, species }) => ({
    assembly_id,
    lineage: lineageOf(species),
  }));
  let server;
  let goatApi;
  let goatSearchApi;
  let root;
  let recordCalls = 0;
  let searchCursors = [];

  const writeTaxon = (id, taxid) => {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({
        assembly: { accession: `GCA_${id}.1`, prefix: id },
        taxon: { taxid, genus: "Old", name: "Old name" },
      }),
    );
    return dir;
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && url.pathname.endsWith("/search")) {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const { params_yaml } = JSON.parse(body);
          const size = Number(/size: (\d+)/.exec(params_yaml)[1]);
          const cursor = /search_after: (\[.*\])/.exec(params_yaml);
          const after = cursor ? JSON.parse(cursor[1])[0] : null;
          searchCursors.push(after);
          const remaining = assemblies.filter(
            ({ assembly_id }) => after === null || assembly_id > after,
          );
          const page = remaining.slice(0, size);
          const payload = {
            status: { success: true, hits: assemblies.length },
            results: page.map(({ assembly_id, lineage }) => ({
              id: `assembly-${assembly_id.replace(".", "_")}`,
              index: "assembly",
              result: { lineage },
            })),
          };
          if (remaining.length > size) {
            payload.search_after = [page[page.length - 1].assembly_id];
          }
          res.end(JSON.stringify(payload));
        });
      } else {
        recordCalls++;
        res.end(
          JSON.stringify({
            records: [
              {
                record: {
                  scientific_name: "Caenorhabditis elegans",
                  lineage: lineageOf("Caenorhabditis elegans"),
                },
              },
            ],
          }),
        );
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    goatApi = `http://127.0.0.1:${server.address().port}/api/v2`;
    goatSearchApi = `http://127.0.0.1:${server.address().port}/api/v3`;
  });

  afterAll(() => {
    server.close();
    config.goatApi = originalGoatApi;
    config.goatSearchApi = originalGoatSearchApi;
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "btk-goat-"));
    config.goatApi = goatApi;
    config.goatSearchApi = goatSearchApi;
    recordCalls = 0;
    searchCursors = [];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("live mode refreshes lineage and looks up each taxid once", async () => {
    writeTaxon("AAAA01", 6239);
    writeTaxon("AAAB01", 6239);
    const md = await search.readMeta(root, [], "live");
    expect(recordCalls).toBe(1);
    const ds = md.find((m) => m.id == "AAAA01");
    expect(ds.genus).toBe("Caenorhabditis");
    expect(ds.phylum).toBe("Nematoda");
    expect(ds.superkingdom).toBe("Eukaryota");
    expect(ds.taxon_name).toBe("Caenorhabditis elegans");
    const cache = readCache(path.join(root, "AAAA01"));
    expect(cache.record.genus).toBe("Caenorhabditis");
  });

  it("fast mode reuses live results without contacting GoaT", async () => {
    writeTaxon("AAAA01", 6239);
    await search.readMeta(root, [], "live");
    recordCalls = 0;
    const md = await search.readMeta(root, [], "fast");
    expect(recordCalls).toBe(0);
    expect(md[0].genus).toBe("Caenorhabditis");
  });

  it("live mode keeps stored values when GoaT is unreachable", async () => {
    config.goatApi = "http://127.0.0.1:1/api/v2";
    writeTaxon("AAAA01", 6239);
    const md = await search.readMeta(root, [], "live");
    expect(md[0].genus).toBe("Old");
  });

  it("refreshTargets follows search_after cursors and writes targets.json", async () => {
    const records = [{ id: "AAAA01", accession: "GCA_000000001.1" }];
    const tree = await search.refreshTargets(root, records, 2);
    expect(searchCursors).toEqual([null, "GCA_000000002.1"]);
    expect(tree.ta).toBe(3);
    expect(tree.ts).toBe(2);
    const written = JSON.parse(
      fs.readFileSync(path.join(root, "targets.json"), "utf8"),
    );
    expect(written).toEqual(tree);
    expect(search.collectTargetKeys(written).has("AAAA01")).toBe(true);
  });
});
