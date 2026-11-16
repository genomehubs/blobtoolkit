// Dataset table columns for server-side sorting, filtering and CSV output.
// Each column has a raw value, used for sorting, and a display string, used for
// filters. Both mirror the viewer's dataset table (reducers/datasetTable.js), so
// the rows the API returns match what the table shows.

const isPresent = (value) =>
  value !== undefined && value !== null && value !== "";

// Mirrors the viewer, which shows a value only when it is truthy.
const truthyOr = (value) => (value ? value : "");

const pctText = (value) => (isPresent(value) ? (value * 100).toFixed(1) : "");
const ratioText = (value) =>
  isPresent(value) ? String(Number(value.toPrecision(2))) : "";
const plainText = (value) => (isPresent(value) ? String(value) : "");

const hitsValue = (d, taxon, key) => {
  const node =
    d.summaryStats &&
    d.summaryStats.hits &&
    d.summaryStats.hits[taxon || "total"];
  return truthyOr(node && node[key]);
};

const buscoValue = (d, lineage, field) => {
  const values = d.summaryStats && d.summaryStats.busco;
  if (!values) return "";
  const name = lineage || Object.keys(values)[0];
  if (!name) return "";
  if (field === "lineage") return name;
  const entry = values[name];
  return entry && entry[field] !== undefined ? entry[field] : "";
};

const compositionValue = (d, key) => {
  const node = d.summaryStats && d.summaryStats.baseComposition;
  return truthyOr(node && node[key]);
};

const taxonomyValue = (d, key) => {
  const node = d.summaryStats && d.summaryStats.taxonomy;
  return truthyOr(node && node[key]);
};

const statValue = (d, key) => {
  const node = d.summaryStats && d.summaryStats.stats;
  return truthyOr(node && node[key]);
};

// N50:span ratio uses n50overSpan, or the inverse of spanOverN50 when that is missing.
const ratioValue = (d) => {
  const stats = d.summaryStats && d.summaryStats.stats;
  if (!stats) return "";
  if (stats.n50overSpan) return stats.n50overSpan;
  if (stats.spanOverN50) return 1 / stats.spanOverN50;
  return "";
};

const readSetCount = (d) => {
  const mapping = d.summaryStats && d.summaryStats.readMapping;
  return mapping ? Object.keys(mapping).length : "";
};

const column = (raw, format = plainText) => ({
  raw,
  text: (d) => format(raw(d)),
});

const fixedColumns = {
  id: column((d) => d.id),
  taxon: column((d) => d.taxon_name),
  accession: column((d) => d.accession),
  gc: column((d) => compositionValue(d, "gc"), pctText),
  at: column((d) => compositionValue(d, "at"), pctText),
  n: column((d) => compositionValue(d, "n"), pctText),
  nohit: column((d) => statValue(d, "noHit"), pctText),
  hit: column((d) => statValue(d, "target"), pctText),
  ratio: column(ratioValue, ratioText),
  reads: column(readSetCount),
  lineage: column((d) => taxonomyValue(d, "lineage")),
  taxid: column((d) => taxonomyValue(d, "taxid")),
  rank: column((d) => taxonomyValue(d, "targetRank")),
  target: column((d) => taxonomyValue(d, "target")),
};

const HITS_FIELDS = ["count", "span", "n50"];
const BUSCO_FIELDS = ["c", "d", "f", "s", "m", "n", "string", "lineage"];
const HITS_SEPARATOR = "-hits-";
const BUSCO_SEPARATOR = "-busco-";

// Returns { raw, text } for a column id, or undefined for an unknown id.
// Hits and BUSCO ids take the form <taxon>-hits-<field> and <lineage>-busco-<field>.
// An empty taxon or lineage means total, or the first lineage in the record.
const resolveColumn = (id) => {
  if (typeof id !== "string" || !id) return undefined;
  if (Object.prototype.hasOwnProperty.call(fixedColumns, id)) {
    return fixedColumns[id];
  }
  const hitsAt = id.lastIndexOf(HITS_SEPARATOR);
  if (hitsAt >= 0) {
    const taxon = id.slice(0, hitsAt);
    const field = id.slice(hitsAt + HITS_SEPARATOR.length);
    if (HITS_FIELDS.includes(field)) {
      return column((d) => hitsValue(d, taxon, field));
    }
    return undefined;
  }
  const buscoAt = id.lastIndexOf(BUSCO_SEPARATOR);
  if (buscoAt >= 0) {
    const lineage = id.slice(0, buscoAt);
    const field = id.slice(buscoAt + BUSCO_SEPARATOR.length);
    if (BUSCO_FIELDS.includes(field)) {
      return column((d) => buscoValue(d, lineage, field));
    }
  }
  return undefined;
};

// Filters match the start of the display text, ignoring case and thousands separators.
const normaliseNeedle = (value) =>
  typeof value === "string" ? value.replace(/,/g, "").toLowerCase() : "";

// Accepts the deepObject form filter[columnId]=prefix. Unknown columns and empty values are ignored.
const parseFilters = (filter) => {
  if (!filter || typeof filter !== "object") return [];
  return Object.entries(filter)
    .map(([id, value]) => {
      const col = resolveColumn(id);
      const needle = normaliseNeedle(value);
      return col && needle ? { column: col, needle } : undefined;
    })
    .filter(Boolean);
};

const applyFilters = (records, filters) => {
  if (filters.length === 0) return records;
  return records.filter((record) =>
    filters.every(({ column: col, needle }) =>
      col.text(record).toLowerCase().startsWith(needle),
    ),
  );
};

// Column ids from a comma-separated list. Unknown ids are dropped.
const DEFAULT_CSV_COLUMNS = ["id", "taxon", "accession"];
const parseColumnList = (value) => {
  if (typeof value !== "string" || !value) return DEFAULT_CSV_COLUMNS;
  const ids = value.split(",").filter((id) => resolveColumn(id) !== undefined);
  return ids.length ? ids : DEFAULT_CSV_COLUMNS;
};

const csvCell = (value) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Writes the header as column ids, then one row per record.
const toCsv = (records, columnIds) => {
  const cols = columnIds.map((id) => ({ id, col: resolveColumn(id) }));
  const lines = [cols.map(({ id }) => csvCell(id)).join(",")];
  records.forEach((record) => {
    lines.push(cols.map(({ col }) => csvCell(col.text(record))).join(","));
  });
  return lines.map((line) => `${line}\n`).join("");
};

const sortKeys = (names) => names.sort((a, b) => (a > b ? 1 : -1));

// Hit taxa and BUSCO lineages across the given records, for the column pickers.
const columnOptions = (records) => {
  const taxa = new Set();
  const lineages = new Set();
  records.forEach((record) => {
    const stats = record.summaryStats || {};
    if (stats.hits) {
      Object.keys(stats.hits).forEach((taxon) => {
        if (taxon !== "total") taxa.add(taxon);
      });
    }
    if (stats.busco) {
      Object.keys(stats.busco).forEach((lineage) => lineages.add(lineage));
    }
  });
  return {
    hitTaxa: sortKeys([...taxa]),
    buscoLineages: sortKeys([...lineages]),
  };
};

module.exports = {
  resolveColumn,
  parseFilters,
  applyFilters,
  parseColumnList,
  toCsv,
  columnOptions,
};
