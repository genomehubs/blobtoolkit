const fs = require("fs");
const fsPromises = fs.promises;
const config = require("../config/main");
const logError = require("../functions/logger").logError;
const dataDirectory = config.filePath;
const readYaml = require("../functions/io").readYaml;
const readYamlSync = require("../functions/io").readYamlSync;
const checkCompression = require("../functions/io").checkCompression;

const SEARCH_SCHEMA_VERSION = 1;
const UPDATE_MODES = ["fast", "mtime", "force"];
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

const readSearchCache = async (dir) => {
  try {
    return JSON.parse(await fsPromises.readFile(`${dir}/search.json`, "utf8"));
  } catch (error) {
    return undefined;
  }
};

const cacheIsValid = async (dir, cache, metaPath, mode) => {
  if (!cache || mode == "force") return false;
  if (cache.schema_version !== SEARCH_SCHEMA_VERSION) return false;
  if (config.dataset_table && !cache.summary_checked) return false;
  if (mode == "mtime") {
    let metaStat = await fsPromises.stat(metaPath);
    let cacheStat = await fsPromises.stat(`${dir}/search.json`);
    return metaStat.mtimeMs <= cacheStat.mtimeMs;
  }
  return true;
};

const buildSearchCache = async (dir, file) => {
  let dsMeta = parseMeta(await readYaml(`${dir}/${file}`));
  dsMeta.id = dir.replace(/^.+\//, "");
  if (!dsMeta.hasOwnProperty("revision")) {
    let [prefix, revision] = dsMeta.id.split(".");
    dsMeta.revision = revision ? revision * 1 : 0;
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

const readMeta = async (dir, md, mode) => {
  md = md || [];
  mode = normaliseMode(mode);
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
      await readMeta(path, md, mode);
    } else if (
      (file == "meta.json" || file == "meta.json.gz") &&
      stat.isFile()
    ) {
      let cache = mode == "force" ? undefined : await readSearchCache(dir);
      if (!(await cacheIsValid(dir, cache, path, mode))) {
        cache = await buildSearchCache(dir, file);
        await writeSearchCache(dir, cache);
      }
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
    if (m.latest == m.revision) {
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

const generateTree = (meta) => {
  let tree = { n: 0, r: "root", d: {}, a: 0, s: 0 };
  let nodes = ["root"];
  let species = {};
  let prefixes = {};
  meta.forEach((ds, i) => {
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
    newIndex = generateIndex(newMeta);
    newKeys = Object.keys(newIndex.values);
    if (config.dataset_table) {
      newTree = generateTree(newMeta);
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

const autocomplete = (term) => {
  let results = [];
  try {
    query = term.toUpperCase();
    if (term.match(/^all$/i)) {
      results.push({
        term: "all",
        field: "all records",
        names: meta.filter((o) => o.latest == o.revision).map((o) => o.name),
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

const search = (term) => {
  let arr = [];
  try {
    if (term.match(/^all$/i)) {
      return meta.filter((o) => o.latest == o.revision);
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
  file = await checkCompression(`${dataDirectory}/targets.json`);
  if (file) {
    res.setHeader("content-type", "application/json");
    if (file.endsWith(".gz")) {
      res.setHeader("content-encoding", "gzip");
    }
    res.sendFile(file);
  } else {
    res.sendStatus(404);
  }
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

const getSearchByTerm = async (req, res) => {
  let paging = parsePaging(req.query || {});
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
    let results = sortById(search(req.params.term));
    res.json(paging ? paginate(results, paging) : results);
  }
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
  readMeta,
  listMeta,
  generateIndex,
  normaliseMode,
  parsePaging,
  paginate,
  sortById,
  SEARCH_SCHEMA_VERSION,
  status: () => status,
  total: () => meta.length,
  getAutocompleteByTerm,
  getSearchByTerm,
  getSearchReload,
  getSearchTreeAvailable,
  getSearchTreeTargets,
};
