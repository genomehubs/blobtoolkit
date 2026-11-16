const http = require("http");
const https = require("https");
const fsPromises = require("fs").promises;

// Lineage ranks used by BlobToolKit search and targets.
const TARGET_RANKS = [
  "superkingdom",
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species",
];
// Cursor sort key for v3 search; values must be unique per assembly.
const SEARCH_SORT = "assembly_id";
const PAGE_SIZE = 1000;
// Eukaryotic assemblies that have an assembly_level recorded.
const QUERY_YAML =
  "index: assembly\ntaxa:\n  - Eukaryota\ntaxon_filter_type: tree\nattributes:\n  - name: assembly_level\n    operator: exists\n";
const TIMEOUT_MS = 15000;

const baseAccession = (value) => value && value.replace(/\.\d+$/, "");

// Sends a GET, or a JSON POST when a body is given, and resolves the parsed response.
const requestJson = (url, body) =>
  new Promise((resolve, reject) => {
    let client = new URL(url).protocol == "https:" ? https : http;
    let payload = body === undefined ? undefined : JSON.stringify(body);
    let options = {
      method: payload === undefined ? "GET" : "POST",
      timeout: TIMEOUT_MS,
    };
    if (payload !== undefined) {
      options.headers = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      };
    }
    let req = client.request(url, options, (res) => {
      if (res.statusCode != 200) {
        res.resume();
        reject(new Error(`GoaT responded ${res.statusCode} for ${url}`));
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("error", reject);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () =>
      req.destroy(new Error(`GoaT timed out for ${url}`)),
    );
    req.on("error", reject);
    req.end(payload);
  });

// GoaT labels the top rank "domain" where BlobToolKit uses "superkingdom".
const pickRanks = (lineage = []) => {
  let found = {};
  lineage.forEach(({ taxon_rank, scientific_name }) => {
    found[taxon_rank] = scientific_name;
  });
  if (!found.superkingdom && found.domain) {
    found.superkingdom = found.domain;
  }
  let ranks = {};
  TARGET_RANKS.forEach((rank) => {
    if (found[rank]) ranks[rank] = found[rank];
  });
  return ranks;
};

// Returns the scientific name and lineage ranks for a taxid.
const fetchLineage = async (taxid, goatApi) => {
  let data = await requestJson(
    `${goatApi}/record?recordId=taxon_id-${encodeURIComponent(taxid)}&result=taxon`,
  );
  const [{ record }] = data.records;
  return {
    scientific_name: record.scientific_name,
    ranks: pickRanks(record.lineage),
  };
};

// GoaT v3 hit id ("assembly-GCA_000001405_28") to accession ("GCA_000001405.28").
const assemblyAccession = (id) =>
  id.replace(/^assembly-/, "").replace(/_(\d+)$/, ".$1");

// Lists every GoaT assembly in Eukaryota with its lineage ranks, following search_after cursors.
const fetchAssemblies = async (searchApi, pageSize = PAGE_SIZE) => {
  let rows = [];
  let seen = new Set();
  let cursor;
  for (;;) {
    let params = `size: ${pageSize}\nsort_by: ${SEARCH_SORT}\nsort_order: asc\ntaxonomy: ncbi\ninclude_lineage: true\n`;
    if (cursor) params += `search_after: ${JSON.stringify(cursor)}\n`;
    let data = await requestJson(`${searchApi}/search`, {
      query_yaml: QUERY_YAML,
      params_yaml: params,
    });
    if (!data.status.success) {
      throw new Error(`GoaT search failed: ${data.status.error}`);
    }
    let added = 0;
    data.results.forEach(({ id, result }) => {
      if (seen.has(id)) return;
      seen.add(id);
      added++;
      rows.push({
        assembly_id: assemblyAccession(id),
        ...pickRanks(result.lineage),
      });
    });
    cursor = data.search_after;
    if (!added || !cursor) break;
  }
  return rows;
};

const otherName = (parentName) =>
  parentName ? `Other ${parentName.replace(/^Other /, "")}` : "Other";

// Builds the viewer target tree. Nodes carry ta (assemblies) and ts (distinct
// species) counts; species nodes hold assembly leaves mapped to dataset ids.
const buildTargetTree = (rows, ids = {}) => {
  let n = 0;
  let root = { n: n++, r: "root", ta: 0, ts: 0, d: {} };
  let seen = new Set();
  rows.forEach((row) => {
    let speciesKey = JSON.stringify(
      TARGET_RANKS.map((rank) => row[rank] || null),
    );
    let newSpecies = !seen.has(speciesKey);
    seen.add(speciesKey);
    root.ta++;
    if (newSpecies) root.ts++;
    let node = root;
    let parentName;
    TARGET_RANKS.forEach((rank) => {
      let name = row[rank] || otherName(parentName);
      if (!node.d[name]) {
        node.d[name] = { n: n++, r: rank, ta: 0, ts: 0, d: {} };
      }
      node = node.d[name];
      node.ta++;
      if (newSpecies) node.ts++;
      parentName = name;
    });
    let id =
      ids[row.assembly_id] ||
      ids[baseAccession(row.assembly_id)] ||
      row.assembly_id;
    node.d[id] = { n: n++ };
  });
  return root;
};

// Writes via a temp file so readers never see a partial targets.json.
const writeTargets = async (file, tree) => {
  await fsPromises.writeFile(`${file}.tmp`, JSON.stringify(tree));
  await fsPromises.rename(`${file}.tmp`, file);
};

module.exports = {
  TARGET_RANKS,
  pickRanks,
  fetchLineage,
  fetchAssemblies,
  buildTargetTree,
  writeTargets,
};
