const fs = require("fs");
const fsPromises = fs.promises;
const config = require("../config/main");
const logError = require("../functions/logger").logError;
const dataDirectory = config.filePath;
const readYaml = require("../functions/io").readYaml;
const readYamlSync = require("../functions/io").readYamlSync;
const fileExists = require("../functions/io").fileExists;
const goat = require("../functions/goat");
const tableColumns = require("../functions/table-columns");

const SEARCH_SCHEMA_VERSION = 2;
const UPDATE_MODES = ["fast", "mtime", "force", "live"];
const TARGETS_CHECK_MS = 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

const parseMeta = (obj) => {
  let meta = {};
  if (!obj) return meta;
  if (obj.hasOwnProperty("assembly")) {
    let props = ["accession", "alias", "bioproject", "biosample", "prefix"];
    props.forEach((prop) => {
      if (obj.assembly.hasOwnProperty(prop)) {
        meta[prop] = obj.assembly[prop];
      }
    });
  }
  if (obj.hasOwnProperty("taxon")) {
    let props = ["genus", "taxid", "phylum"];
    Object.keys(obj.taxon).forEach((prop) => {
      meta[prop] = obj.taxon[prop];
    });
    meta.taxon_name = obj.taxon.name;
  }
  if (obj.hasOwnProperty("name")) {
    meta.name = obj.name;
  } else {
    meta.name = obj.id;
  }
  if (!meta.hasOwnProperty("prefix")) {
    meta.prefix = meta.name;
  }
  if (obj.hasOwnProperty("revision")) {
    meta.revision = obj.revision;
  }
  return meta;
};

const normaliseMode = (mode) => {
  if (UPDATE_MODES.includes(mode)) return mode;
  return UPDATE_MODES.includes(config.searchUpdateMode)
    ? config.searchUpdateMode
    : "fast";
};

const GCA_PREFIX = /^GCA_\d+([._]\d+)?$/;
const gcaKey = (value) => (value ? value.match(/^GCA_\d+/)?.[0] : undefined);
const superseded = new WeakSet();

const markSuperseded = (md) => {
  if (!config.supersedeByAccession) return;
  let chains = new Set(
    md.filter((m) => GCA_PREFIX.test(m.prefix)).map((m) => gcaKey(m.prefix)),
  );
  md.forEach((m) => {
    let key = gcaKey(m.accession);
    if (key && chains.has(key) && !GCA_PREFIX.test(m.prefix)) {
      superseded.add(m);
    }
  });
};

const isCurrent = (m) => m.latest == m.revision && !superseded.has(m);

// force and live rebuild every record instead of reusing search.json.
const rebuildsCache = (mode) => mode == "force" || mode == "live";

const readSearchCache = async (dir) => {
  try {
    return JSON.parse(await fsPromises.readFile(`${dir}/search.json`, "utf8"));
  } catch (error) {
    return undefined;
  }
};

const cacheIsValid = async (dir, cache, metaPath, mode) => {
  if (!cache || rebuildsCache(mode)) return false;
  if (cache.schema_version !== SEARCH_SCHEMA_VERSION) return false;
  if (config.dataset_table && !cache.summary_checked) return false;
  if (mode == "mtime") {
    let metaStat = await fsPromises.stat(metaPath);
    let cacheStat = await fsPromises.stat(`${dir}/search.json`);
    return metaStat.mtimeMs <= cacheStat.mtimeMs;
  }
  return true;
};

const MAX_LOOKUP_FAILURES = 10;

const newLookups = () => ({ found: new Map(), failures: 0 });

// One GoaT record request per taxid per run. Failures are logged and skipped,
// and lookups stop after MAX_LOOKUP_FAILURES so a GoaT outage cannot stall a run.
const cachedLineage = async (taxid, lookups) => {
  if (!lookups.found.has(taxid)) {
    if (lookups.failures >= MAX_LOOKUP_FAILURES) return undefined;
    try {
      lookups.found.set(taxid, await goat.fetchLineage(taxid, config.goatApi));
    } catch (error) {
      lookups.failures++;
      logError({ message: error });
      if (lookups.failures == MAX_LOOKUP_FAILURES) {
        logError({
          message: `GoaT lookups stopped after ${MAX_LOOKUP_FAILURES} failures`,
        });
      }
      return undefined;
    }
  }
  return lookups.found.get(taxid);
};

// Replaces lineage ranks with GoaT values; ranks GoaT does not return are removed.
const applyLineage = (dsMeta, lookup) => {
  ranks.slice(0, 8).forEach((rank) => {
    if (lookup.ranks[rank]) {
      dsMeta[rank] = lookup.ranks[rank];
    } else {
      delete dsMeta[rank];
    }
  });
  if (lookup.scientific_name) {
    dsMeta.taxon_name = lookup.scientific_name;
  }
};

const missingPlotFields = async (dir, rawMeta) => {
  let plot = rawMeta && rawMeta.plot ? Object.values(rawMeta.plot) : [];
  let missing = [];
  for (let id of plot) {
    if (typeof id != "string") continue;
    let base = `${dir}/${id}.json`;
    if (!(await fileExists(base)) && !(await fileExists(`${base}.gz`))) {
      missing.push(id);
    }
  }
  return missing;
};

const buildSearchCache = async (dir, file, lookups) => {
  let rawMeta = await readYaml(`${dir}/${file}`);
  let dsMeta = parseMeta(rawMeta);
  dsMeta.id = dir.replace(/^.+\//, "");
  let missing = await missingPlotFields(dir, rawMeta);
  if (missing.length > 0) {
    logError({
      message: `${dsMeta.id}: missing plot field files: ${missing.join(", ")}`,
    });
  }
  if (!dsMeta.hasOwnProperty("revision")) {
    let [prefix, revision] = dsMeta.id.split(".");
    dsMeta.revision = revision ? revision * 1 : 0;
  }
  if (lookups && dsMeta.taxid) {
    let lookup = await cachedLineage(String(dsMeta.taxid), lookups);
    if (lookup) applyLineage(dsMeta, lookup);
  }
  let summary_checked = false;
  if (config.dataset_table) {
    let sumpath = `${dir}/summary.json`;
    if (file.endsWith(".gz")) {
      sumpath += ".gz";
    }
    try {
      let summary = await readYaml(sumpath);
      if (summary && summary.hasOwnProperty("summaryStats")) {
        dsMeta.summaryStats = summary.summaryStats;
      }
    } catch (error) {}
    summary_checked = true;
  }
  return {
    schema_version: SEARCH_SCHEMA_VERSION,
    summary_checked,
    missing_plot: missing,
    record: JSON.parse(JSON.stringify(dsMeta)),
  };
};

const writeSearchCache = async (dir, cache) => {
  let path = `${dir}/search.json`;
  try {
    await fsPromises.writeFile(`${path}.tmp`, JSON.stringify(cache));
    await fsPromises.rename(`${path}.tmp`, path);
  } catch (error) {
    logError({ message: error });
  }
};

const readMeta = async (dir, md, mode, lookups) => {
  md = md || [];
  mode = normaliseMode(mode);
  if (mode == "live" && !lookups) lookups = newLookups();
  versions = {};
  md.forEach((o, i) => {
    if (!versions[o.prefix]) {
      versions[o.prefix] = {};
    }
    versions[o.prefix][o.revision] = i;
  });
  let files = await fsPromises.readdir(dir);
  for (let file of files) {
    let path = dir + "/" + file;
    let stat = await fsPromises.stat(path);
    if (stat.isDirectory()) {
      await readMeta(path, md, mode, lookups);
    } else if (
      (file == "meta.json" || file == "meta.json.gz") &&
      stat.isFile()
    ) {
      let cache = rebuildsCache(mode) ? undefined : await readSearchCache(dir);
      if (!(await cacheIsValid(dir, cache, path, mode))) {
        cache = await buildSearchCache(dir, file, lookups);
        await writeSearchCache(dir, cache);
      }
      if (cache.missing_plot.length > 0) continue;
      let dsMeta = cache.record;
      if (!versions[dsMeta.prefix]) {
        versions[dsMeta.prefix] = {};
      }
      versions[dsMeta.prefix][dsMeta.revision] = md.length;
      md.push(dsMeta);
      let latest = Math.max(...Object.keys(versions[dsMeta.prefix]));
      Object.keys(versions[dsMeta.prefix]).forEach((version) => {
        md[versions[dsMeta.prefix][version]].latest = latest;
      });
    }
  }
  return md;
};

const listMeta = async (dir, { md, meta }) => {
  md = md || meta?.slice() || [];
  versions = {};
  md.forEach((o, i) => {
    if (!versions[o.prefix]) {
      versions[o.prefix] = {};
    }
    versions[o.prefix][o.revision] = i;
  });
  let files = await fsPromises.readdir(dir);
  for (let file of files) {
    let path = dir + "/" + file;
    let stat = await fsPromises.stat(path);
    if (stat.isDirectory()) {
      await listMeta(path, { md });
    } else if (
      (file == "meta.json" || file == "meta.json.gz") &&
      stat.isFile()
    ) {
      let id = dir.replace(/^.+\//, "");
      let [prefix, revision] = id.split(".");
      let dsMeta = {
        id,
        name: id,
        prefix,
        revision: revision ? revision * 1 : 0,
      };
      if (config.dataset_table) {
        dsMeta.summaryStats = {};
      }
      if (!versions[dsMeta.prefix]) {
        versions[dsMeta.prefix] = {};
      }
      if (!versions[dsMeta.prefix][dsMeta.revision]) {
        versions[dsMeta.prefix][dsMeta.revision] = md.length;
        md.push(dsMeta);
      }
      let latest = Math.max(...Object.keys(versions[dsMeta.prefix]));
      dsMeta.latest = latest;
      Object.keys(versions[dsMeta.prefix]).forEach((version) => {
        if (md[versions[dsMeta.prefix][version - 1]]) {
          md[versions[dsMeta.prefix][version - 1]].latest = latest;
        }
      });
    }
  }
  return md;
};

const generateIndex = (meta) => {
  let fields = {};
  let ctr = 0;
  let terms = {};
  meta.forEach((m, i) => {
    if (isCurrent(m)) {
      Object.keys(m).forEach((k) => {
        if (!fields.hasOwnProperty(k)) {
          fields[k] = ctr;
          ctr++;
        }
        if (!terms.hasOwnProperty(m[k])) {
          terms[m[k]] = {};
        }
        if (!terms[m[k]].hasOwnProperty(fields[k])) {
          terms[m[k]][fields[k]] = [];
        }
        terms[m[k]][fields[k]].push(i);
      });
    }
  });
  let keys = Object.keys(fields).sort((a, b) => fields[a] - fields[b]);
  let values = {};
  Object.keys(terms).forEach((k) => {
    if (!values.hasOwnProperty(k)) {
      values[k] = [];
    }
    Object.keys(terms[k]).forEach((f) => {
      values[k].push({ i: terms[k][f], f });
    });
  });
  let index = { keys, values };
  return index;
};

const ranks = [
  "superkingdom",
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species",
  "taxon_name",
  "id",
];

const baseAccession = (value) => value && value.replace(/\.\d+$/, "");

// Leaves are dataset ids or accessions; base accessions also match versioned datasets.
const collectTargetKeys = (node, keys = new Set()) => {
  Object.entries(node.d || {}).forEach(([key, child]) => {
    if (child.d) {
      collectTargetKeys(child, keys);
    } else {
      keys.add(key);
      keys.add(baseAccession(key));
    }
  });
  return keys;
};

const inTargets = (ds, keys) =>
  keys.has(ds.id) ||
  keys.has(ds.accession) ||
  keys.has(baseAccession(ds.accession));

const loadTargetKeys = async () => {
  try {
    let targets = await readYaml(`${dataDirectory}/targets.json`);
    let keys = targets && collectTargetKeys(targets);
    return keys && keys.size ? keys : undefined;
  } catch (error) {
    logError({ message: error });
    return undefined;
  }
};

const generateTree = (meta, targetKeys) => {
  let tree = { n: 0, r: "root", d: {}, a: 0, s: 0 };
  let nodes = ["root"];
  let species = {};
  let prefixes = {};
  meta.filter(isCurrent).forEach((ds, i) => {
    if (targetKeys && !inTargets(ds, targetKeys)) return;
    let prefix = ds.prefix;
    if (!prefixes[prefix]) {
      prefixes[prefix] = true;
      let spid = ranks
        .slice(0, 8)
        .map((r) => ds[r])
        .reduce((a, b) => a + "," + b);
      spid = spid.replace(/,undefined$/, `,${ds.taxon_name}`);
      let parent_node = tree;
      ranks.forEach((rank) => {
        let skip;
        if (rank == "id") {
          let assembly = ds[rank];
          parent_node.d[assembly] = {
            n: nodes.length,
            // assembly,
            p: parent_node.id,
          };
          nodes.push(assembly);
          parent_node.a++;
        } else {
          let taxon = ds[rank];
          if (!taxon) {
            let parent = String(nodes[parent_node.n]);
            if (parent) {
              taxon = parent.endsWith("undef") ? parent : `${parent}-undef`;
            } else {
              parent = "undef";
            }
          }
          if (!parent_node.d[taxon]) {
            if (rank == "taxon_name" && taxon == nodes[parent_node.n]) {
              skip = true;
            } else {
              parent_node.d[taxon] = {
                n: nodes.length,
                r: rank,
                p: parent_node.id,
                d: {},
                a: 0,
                s: 0,
              };
              nodes.push(taxon);
            }
          }
          if (!species[spid]) {
            parent_node.s++;
          }
          if (!skip) {
            parent_node.a++;
            parent_node = parent_node.d[taxon];
          }
        }
      });
      species[spid] = true;
    }
  });
  return tree;
};

let meta = [];
let index = {};
let keys = [];
let tree = {};
let status = "LOADING";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const loadFullIndex = async (mode) => {
  try {
    await sleep(10000);
    // Load metadata into full index
    status = "INDEXING";
    newMeta = await readMeta(dataDirectory, undefined, mode);
    markSuperseded(newMeta);
    newIndex = generateIndex(newMeta);
    newKeys = Object.keys(newIndex.values);
    if (config.dataset_table) {
      newTree = generateTree(newMeta, await loadTargetKeys());
      tree = newTree;
    }
    meta = newMeta;
    index = newIndex;
    keys = newKeys;
    status = "OK";
  } catch (message) {
    logError({ message });
    status = "NOT OK";
  }
};

const loadIndex = async (mode) => {
  try {
    let newMeta = await listMeta(dataDirectory, {});
    let newIndex = generateIndex(newMeta);
    let newKeys = Object.keys(newIndex.values);
    meta = newMeta;
    index = newIndex;
    keys = newKeys || [];
    status = "INDEXING";
    loadFullIndex(normaliseMode(mode));
  } catch (message) {
    logError({ message });
    status = "NOT OK";
  }
};

// Base accession of each record; current datasets win over superseded ones.
const accessionIds = (records) => {
  let ids = {};
  records.forEach((m) => {
    if (!m.accession) return;
    [m.accession, baseAccession(m.accession)].forEach((key) => {
      if (!ids[key] || isCurrent(m)) ids[key] = m.id;
    });
  });
  return ids;
};

// Fetches GoaT assemblies and writes targets.json. Keeps the old file on failure.
const refreshTargets = async (dir, records, pageSize) => {
  let rows = await goat.fetchAssemblies(config.goatSearchApi, pageSize);
  if (!rows.length) {
    throw new Error("GoaT returned no assemblies; targets.json not updated");
  }
  let tree = goat.buildTargetTree(rows, accessionIds(records));
  await goat.writeTargets(`${dir}/targets.json`, tree);
  targetIndex = undefined;
  return tree;
};

let targetsUpdating = false;

const updateTargets = async () => {
  if (targetsUpdating || status !== "OK") return false;
  targetsUpdating = true;
  try {
    await refreshTargets(dataDirectory, meta);
    if (config.dataset_table) {
      tree = generateTree(meta, await loadTargetKeys());
    }
    return true;
  } catch (error) {
    logError({ message: error });
    return false;
  } finally {
    targetsUpdating = false;
  }
};

const targetsAgeMs = async () => {
  try {
    let stat = await fsPromises.stat(`${dataDirectory}/targets.json`);
    return Date.now() - stat.mtimeMs;
  } catch (error) {
    return Infinity;
  }
};

// Refreshes targets.json when older than BTK_TARGETS_UPDATE_HOURS (0 disables).
const scheduleTargetUpdates = () => {
  let hours = config.targetsUpdateHours;
  if (!(hours > 0)) return;
  const check = async () => {
    if ((await targetsAgeMs()) >= hours * 60 * 60 * 1000) {
      await updateTargets();
    }
  };
  setTimeout(check, 60 * 1000).unref();
  setInterval(check, TARGETS_CHECK_MS).unref();
};

const autocomplete = (term) => {
  let results = [];
  try {
    query = term.toUpperCase();
    if (term.match(/^all$/i)) {
      results.push({
        term: "all",
        field: "all records",
        names: meta.filter(isCurrent).map((o) => o.name),
      });
    } else {
      keys.forEach((k) => {
        if (k.substr(0, query.length).toUpperCase() == query) {
          index.values[k].forEach((entry) => {
            results.push({
              term: k,
              field: index.keys[entry.f],
              names: entry.i.map((i) => meta[i].name),
            });
          });
        }
      });
    }
  } catch (error) {
    console.log(error);
  }
  return results;
};

// Revision of the current version of a dataset's accession prefix, or undefined when the id is not indexed.
const latestRevisionFor = (id) => {
  const record = meta.find((m) => m.id === id);
  if (!record) return undefined;
  if (!record.prefix) return record.revision;
  const current = meta.find((m) => m.prefix === record.prefix && isCurrent(m));
  return current ? current.revision : undefined;
};

const search = (term) => {
  let arr = [];
  try {
    if (term.match(/^all$/i)) {
      return meta.filter(isCurrent);
    }
    if (!term || !index.values || !index.values[term]) {
      return [];
    }
    let ids = {};
    index.values[term].forEach((entry) => {
      entry.i.forEach((i) => {
        if (!ids[meta[i].id]) {
          arr.push(meta[i]);
          ids[meta[i].id] = 1;
        }
      });
    });
  } catch (error) {
    console.log(error);
  }
  return arr;
};

const tabulate = (term) => {
  let json = sortById(search(term));
  let prefixes = {};
  json.forEach((assembly) => {
    if (assembly.summaryStats) {
      if (assembly.accession && assembly.accession.startsWith("GCA_")) {
        let id = assembly.id;
        let prefix = assembly.prefix;
        let revision = assembly.revision || 0;
        if (!prefixes[prefix] || revision > prefixes[prefix].revision) {
          let pctHit = 100 - assembly.summaryStats.stats.noHit * 100;
          let pctTarget = (assembly.summaryStats.stats.target || 0) * 100;
          let ratio = 1 / assembly.summaryStats.stats.spanOverN50;
          ratio = ratio ? ratio : assembly.summaryStats.stats.n50OverSpan;
          let string = `${id}\t${pctHit.toPrecision(
            3,
          )}\t${pctTarget.toPrecision(3)}\t${ratio.toPrecision(2)}`;
          prefixes[prefix] = {
            id,
            gca: `${assembly.accession}\t${string}`,
            wgs: `${prefix}000000\t${string}`,
            revision,
          };
        }
      }
    }
  });
  return Object.keys(prefixes).map((prefix) => prefixes[prefix].gca);
};

const getSearchTreeTargets = async (req, res) => {
  res.setHeader("content-type", "application/json");
  let index = await getTargetIndex();
  if (!index) return res.sendStatus(404);
  if (req.query.term !== undefined) {
    return res.json(targetTerm(index, String(req.query.term)));
  }
  let id = req.query.node === undefined ? index.root.n : Number(req.query.node);
  let node = index.nodes.get(id);
  if (!node || !node.r) return res.sendStatus(404);
  res.json(nodeResponse(node));
};
// Targets tree index, built from targets.json on first use and reset after a refresh.
let targetIndex;

const childSummary = (node) => {
  let summary = { n: node.n };
  if (node.r !== undefined) summary.r = node.r;
  if (node.ta !== undefined) summary.ta = node.ta;
  if (node.ts !== undefined) summary.ts = node.ts;
  return summary;
};

// A taxon with summaries of its direct children. Deeper levels are requested as the viewer expands.
const nodeResponse = (node) => {
  let response = childSummary(node);
  if (node.d) {
    response.d = {};
    Object.entries(node.d).forEach(([name, child]) => {
      response.d[name] = childSummary(child);
    });
  }
  return response;
};

const indexTargets = (root) => {
  let index = { root, nodes: new Map(), parents: new Map(), names: new Map() };
  const visit = (node) => {
    index.nodes.set(node.n, node);
    Object.entries(node.d || {}).forEach(([name, child]) => {
      index.parents.set(child.n, node.n);
      if (!index.names.has(name)) index.names.set(name, []);
      index.names.get(name).push(child.n);
      visit(child);
    });
  };
  visit(root);
  return index;
};

const getTargetIndex = async () => {
  if (!targetIndex) {
    try {
      let root = await readYaml(`${dataDirectory}/targets.json`);
      if (root && root.d) targetIndex = indexTargets(root);
    } catch (error) {
      return undefined;
    }
  }
  return targetIndex;
};

// Ancestor nodes of every node named term, so the viewer can open the path to it.
// Nodes are listed top-down so each parent precedes its children.
// expand maps each ancestor id to its parent id, as the viewer's expanded nodes do.
const targetTerm = (index, term) => {
  let nodes = new Map();
  let expand = {};
  let targets = (index.names.get(term) || []).slice();
  targets.forEach((id) => {
    let chain = [];
    let ancestor = index.parents.get(id);
    while (ancestor !== undefined && ancestor !== index.root.n) {
      chain.unshift(ancestor);
      ancestor = index.parents.get(ancestor);
    }
    chain.forEach((ancestorId) => {
      expand[ancestorId] = index.parents.get(ancestorId);
      if (!nodes.has(ancestorId)) {
        nodes.set(ancestorId, nodeResponse(index.nodes.get(ancestorId)));
      }
    });
  });
  return { term, nodes: [...nodes.values()], expand, targets };
};

const getSearchTreeAvailable = async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.json(tree);
};
const getAutocompleteByTerm = async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.json(autocomplete(req.params.term));
};
const compareIds = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sortById = (records) => records.slice().sort(compareIds);

// Sorts by a scalar value from valueOf(record). Records without a value sort last
// in either order, and ties fall back to id so paging stays stable.
const sortRecords = (records, valueOf, order) => {
  if (!valueOf) return sortById(records);
  const direction = order === "desc" ? -1 : 1;
  // Empty strings are the viewer's missing marker, so they sort last too.
  const scalar = (record) => {
    const value = valueOf(record);
    if (value === "") return undefined;
    return ["string", "number", "boolean"].includes(typeof value)
      ? value
      : undefined;
  };
  return records.slice().sort((a, b) => {
    const va = scalar(a);
    const vb = scalar(b);
    if (va === undefined || vb === undefined) {
      if (va === vb) return compareIds(a, b);
      return va === undefined ? 1 : -1;
    }
    let ca = va;
    let cb = vb;
    if (typeof va !== typeof vb) {
      ca = String(va);
      cb = String(vb);
    }
    if (ca < cb) return -direction;
    if (ca > cb) return direction;
    return compareIds(a, b);
  });
};

const parseSort = (query) => {
  if (!query || query.sort === undefined) return {};
  return {
    field: String(query.sort),
    order: query.order === "desc" ? "desc" : "asc",
  };
};

const parsePaging = (query) => {
  if (query.page === undefined && query.size === undefined) return undefined;
  let page = Math.max(1, parseInt(query.page, 10) || 1);
  let size = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(query.size, 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, size };
};

const paginate = (items, { page, size }) => ({
  total: items.length,
  page,
  size,
  results: items.slice((page - 1) * size, page * size),
});

// Filtered and sorted records for a term. sort is a table column id, and
// filter[columnId] is a display-text prefix. Both are ignored when unknown.
const selectRecords = (term, query) => {
  const filtered = tableColumns.applyFilters(
    search(term),
    tableColumns.parseFilters(query.filter),
  );
  const sort = parseSort(query);
  const column = sort.field
    ? tableColumns.resolveColumn(sort.field)
    : undefined;
  return sortRecords(filtered, column && column.raw, sort.order);
};

const getSearchByTerm = async (req, res) => {
  let paging = parsePaging(req.query || {});
  if (req.query && req.query.display == "ids") {
    res.setHeader("content-type", "application/json");
    return res.json(selectRecords(req.params.term, req.query).map((r) => r.id));
  }
  if (req.query && req.query.display == "csv") {
    res.setHeader("content-type", "text/csv");
    res.setHeader(
      "content-disposition",
      `attachment; filename=${req.params.term}.csv`,
    );
    return res.send(
      tableColumns.toCsv(
        selectRecords(req.params.term, req.query),
        tableColumns.parseColumnList(req.query.columns),
      ),
    );
  }
  if (req.query && req.query.display == "tsv") {
    res.setHeader("content-type", "text/tab-separated-values");
    today = new Date().toISOString().substring(0, 10).replace(/-/g, "");
    res.setHeader(
      "content-disposition",
      `attachment; filename=BlobToolKit_${today}.tsv`,
    );
    let lines = tabulate(req.params.term);
    if (paging) {
      res.setHeader("x-total-count", lines.length);
      lines = lines.slice(
        (paging.page - 1) * paging.size,
        paging.page * paging.size,
      );
    }
    res.send(lines.map((line) => `${line}\n`).join(""));
  } else {
    res.setHeader("content-type", "application/json");
    let results = selectRecords(req.params.term, req.query || {});
    res.json(paging ? paginate(results, paging) : results);
  }
};

// Hit taxa and BUSCO lineages for the column pickers, across every match for the term.
const getSearchColumns = async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.json(tableColumns.columnOptions(search(req.params.term)));
};
const getSearchReload = async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.params.key == config.reloadKey) {
    let mode = normaliseMode(req.query.mode);
    status = "RELOADING";
    loadIndex(mode);
    res.json({ status: "OK", mode });
  } else {
    res.json({ status: "INVALID KEY" });
  }
};

module.exports = {
  loadIndex,
  latestRevisionFor,
  readMeta,
  listMeta,
  generateIndex,
  normaliseMode,
  markSuperseded,
  isCurrent,
  generateTree,
  collectTargetKeys,
  accessionIds,
  refreshTargets,
  updateTargets,
  scheduleTargetUpdates,
  parsePaging,
  paginate,
  sortById,
  sortRecords,
  parseSort,
  indexTargets,
  nodeResponse,
  targetTerm,
  SEARCH_SCHEMA_VERSION,
  status: () => status,
  total: () => meta.length,
  getAutocompleteByTerm,
  getSearchByTerm,
  getSearchColumns,
  getSearchReload,
  getSearchTreeAvailable,
  getSearchTreeTargets,
};
