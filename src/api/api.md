# API Documentation

Data and pre-generated static images can be retrieved directly via the BlobToolKit viewer API.

## Search

### /api/v1/search/all

Returns an array of top-level dataset metadata containing dataset `name`, `id` and any additional searchable fields for all hosted datasets. Results are sorted by `id`. Paging parameters are supported, see [Paging](#paging).

```
curl "https://example.com/api/v1/search/all"
```

```json
[
  {
    "id":"AAGD02",
    "name":"AAGD02",
    "accession":"GCA_000149515.1",
    "species":"",
    ...},
  {
    "id":"ADBU02",
    "name":"ADBU02",
    ...
  },
  ...
]
```

### /api/v1/search/:term

Returns an array of top-level dataset metadata for all datasets matching `:term`, sorted by `id`.

```
curl "https://example.com/api/v1/search/Caenorhabditis"
```

```json
[
  {
    "genus":"Caenorhabditis",
    "id":"AAGD02",
    ...},
  {
    "genus":"Caenorhabditis",
    "id":"LFJK02",
    ...
  },
  ...
]
```

With `display=tsv` the response is a tab-separated list of GCA accessions, one per prefix.

### Versioning

The newest revision of each `prefix` is returned. By default, datasets whose `prefix` is not a GCA accession are also hidden when another dataset has a GCA-prefixed `prefix` (for example `GCA_000001215_4`) with the same GCA accession. Hidden datasets are excluded from `/search/all`, `/search/:term`, autocomplete, the index and TSV output. Set `BTK_SUPERSEDE_BY_ACCESSION=false` to disable this.

### Paging

Paging is optional. Pass `page` (starting at 1) or `size` (default 20, maximum 500) to enable it. Without either parameter, the full unpaged array is returned as above.

```
curl "https://example.com/api/v1/search/Caenorhabditis?page=2&size=50"
```

```json
{
  "total": 137,
  "page": 2,
  "size": 50,
  "results": [
    { "id": "...", ... },
    ...
  ]
}
```

`total` is the number of matches before paging. A page beyond the end returns an empty `results` array.

### Sorting

Pass `sort` and optionally `order` (`asc` default, or `desc`) to sort the JSON response. `sort` is a table column id, such as `taxon`, `accession`, `gc`, `ratio`, `reads`, `-hits-count`, `Mammalia-hits-n50` or `-busco-string`. Without `sort`, results are ordered by `id`. Records without a value sort last in either direction, and ties fall back to `id`, so paging stays stable. Unknown column ids are ignored.

```
curl "https://example.com/api/v1/search/Caenorhabditis?sort=-hits-count&order=desc&page=1&size=20"
```

### Filtering

Pass `filter[columnId]=prefix` to keep only records whose displayed value for that column starts with `prefix`. Matching ignores case and thousands separators, so `filter[-hits-count]=1234` matches 1,234. Several filters must all match. Unknown column ids and empty values are ignored. Filters apply to the JSON, `display=ids` and `display=csv` responses.

```
curl "https://example.com/api/v1/search/Caenorhabditis?filter[taxon]=cael&page=1&size=20"
```

### Column options

`GET /search/{term}/columns` returns `hitTaxa` and `buscoLineages` for all datasets matching the term, for the dataset table column pickers.

### Ids and CSV

With `display=ids`, the response is a JSON array of the matching dataset ids, after filters and sort. With `display=csv`, the response is a CSV file of the matching rows for the columns listed in `columns` (comma-separated column ids, default `id,taxon,accession`). The header row uses the column ids.

```
curl "https://example.com/api/v1/search/Caenorhabditis?display=csv&columns=id,taxon,-hits-count&sort=taxon"
```

With `display=tsv`, paging returns the requested slice of lines and sets the `x-total-count` header to the total number of lines.

```
curl -i "https://example.com/api/v1/search/all?display=tsv&page=1&size=10"
```

### /api/v1/search/reload/:key

Reloads the search index. Requires the reload key. The optional `mode` parameter sets how cached `search.json` files are used:

- `fast` (default, or `BTK_SEARCH_UPDATE_MODE`): reuse `search.json` when its schema is current.
- `mtime`: also regenerate a dataset when its `meta.json` is newer than `search.json`.
- `force`: regenerate every `search.json`.
- `live`: regenerate every `search.json` and refresh the taxonomy fields (`superkingdom` to `species`, `taxon_name`) from GoaT. Each distinct `taxid` is looked up once per reload. Set `BTK_GOAT_API` to change the GoaT endpoint (default `https://goat.genomehubs.org/api/v2`). Lookups that fail keep the stored values, and lookups stop after 10 failures in one run.

```
curl "https://example.com/api/v1/search/reload/:key?mode=mtime"
curl "https://example.com/api/v1/search/reload/:key?mode=live"
```

### Targets

`targets.json` lists the target assemblies for the tree endpoint. It is rebuilt from GoaT (all Eukaryota assemblies, listed with the GoaT v3 search API and `search_after` cursor paging; set `BTK_GOAT_SEARCH_API` to change the endpoint) every `BTK_TARGETS_UPDATE_HOURS` hours (default 168; set 0 to disable), checked hourly. A failed refresh keeps the existing file. The tree numerator counts only current datasets whose accession or id is listed in `targets.json`.

`GET /search/tree/target` returns the targets tree one taxon at a time, so the whole file is not sent:

- No parameters: the root node (`n: 0`), with summaries of its direct children.
- `node=<id>`: the taxon with that id, with summaries of its direct children. Assembly leaves and unknown ids return 404.
- `term=<name>`: the ancestors of every taxon or assembly with that name. Returns `nodes` (ancestor taxa, top-down, each with its children summaries), `expand` (ancestor id to parent id) and `targets` (ids of the matches).

A node is `{n, r, ta, ts, d}`, where `d` maps child names to child summaries `{n, r, ta, ts}`. Child summaries without `r` are assembly leaves. `d` is present only once a node's children have been returned.

If `search.json` is missing or out of date it is created from `meta.json` on startup or reload. Writes are atomic, and a read-only dataset directory still serves results from `meta.json`.

## Dataset

### /api/v1/dataset/id/:dataset_id

Returns full metadata for the dataset with the provided `:dataset_id`.

```
curl "https://example.com/api/v1/dataset/id/LFJK02"
```

```json
{
  "id":"LFJK02",
  "assembly":{
    "accession":"GCA_001643735.2",
    "bioproject":"PRJNA248909",
    "level":"scaffold",
    "scaffold-count":1591,
    "span":118549266,
    ...
  },
  "fields":[
    {
      "id":"identifiers",
      "type":"identifier"
    },
    {
      "id":"gc",
      "datatype":"float",
      "range":[0.2498,0.6325],
      ...
    },
    {
      "id":"length",
      ...
    },
    ...
  ],
  "reads":{
    "SRR5837619":{
      "Mapped reads":"52760532",
      "Total reads":"59124810",
      "coverage":502.1056381572,
      ...
    },
    "SRR5837620":{
      ...
    },
    ...
  },
  "record_type":"scaffold",
  "records":1591,
  "settings":{
    "commit":"843f7af",
    "pipeline":"https://github.com/blobtoolkit/insdc-pipeline.git",
    ...
  },
  "static_plots":"true",
  "taxon":{
    "genus":"Caenorhabditis",
    "taxid":31234,
    "phylum":"Nematoda",
    "species":"Caenorhabditis remanei",
    ...
  }
}
```

### /api/v1/dataset/id/:dataset_id/:key

Returns the portion of the dataset metadata matching `:key`.

```
curl "https://example.com/api/v1/dataset/id/LFJK02/assembly"
```

```json
{
  "accession": "GCA_001643735.2",
  "alias": "ASM164373v2",
  "bioproject": "PRJNA248909",
  "biosample": "SAMN02803904",
  "level": "scaffold",
  "prefix": "LFJK02",
  "scaffold-count": 1591,
  "span": 118549266,
  "file": "LFJK02.fasta"
}
```

```
curl "https://example.com/api/v1/dataset/id/LFJK02/static_plots"
```

```json
"true"
```

## Summary

### /api/v1/summary/:dataset_id

Returns a pre-computed summary for `:dataset_id`, if available.

```
curl "https://example.com/api/v1/summary/AACW02"
```

```json
{
  "id": "current",
  "datasetId": "AACW02",
  "taxon": "Rhizopus delemar RA 99-880",
  "taxid": 246409,
  "search": "all",
  "params": {},
  "summaryStats": {
    "hits": {
      "total": {
        "span": 46148878,
        "count": 83,
        "n50": 3104119,
        "l50": 6,
        "n90": 783160,
        "l90": 17
      },
      "Mucoromycota": {
        "count": 68,
        "span": 42389618,
        "n50": 2712543
      },
      "no-hit": {
        "count": 4,
        "span": 28432,
        "n50": 7630
      },
      ...
    },
    "taxonomy": {
      "taxid": 246409,
      "lineage": "Eukaryota; Fungi; Mucoromycota; Mucoromycetes; Mucorales; Rhizopodaceae; Rhizopus; Rhizopus delemar",
      "target": "Mucoromycota",
      "targetRank": "phylum"
    },
    "baseComposition": {
      "at": 0.644,
      "gc": 0.356,
      "n": 0.0178
    },
    "busco": {
      "fungi_odb9": {
        "c": 276,
        "d": 112,
        "m": 9,
        "f": 5,
        "t": 290,
        "s": 164,
        "string": "C:95.2%[S:56.6%,D:38.6%],F:1.7%,M:3.1%,n:290"
      },
      ...
    },
    "stats": {
      "noHit": 0.000616,
      "target": 0.919,
      "spanOverN50": 14.9
    }
  }
}
```

## Image

The following routes are available if static images have been pre-generated for a dataset (i.e. if `/dataset/id/:dataset_id/static_plots` returns `"true"`)

### /api/v1/image/:dataset_id

Returns the default image for a dataset, which is a `PNG` format square-binned blobplot at maximum available resolution.

```
curl -o LFJK02.png "https://example.com/api/v1/image/LFJK02"
```

### /api/v1/image/:dataset_id/:view

Returns an image for a specified dataset view.

```
curl -o LFJK02.blob.png "https://example.com/api/v1/image/LFJK02/blob"
```

```
curl -o LFJK02.cumulative.png "https://example.com/api/v1/image/LFJK02/cumulative"
```

```
curl -o LFJK02.snail.png "https://example.com/api/v1/image/LFJK02/snail"
```

### /api/v1/image/:dataset_id/:view/:type

Returns a specific `:type` for dataset views with more then one static image type.

```
curl -o LFJK02.blob.circle.png "https://example.com/api/v1/image/LFJK02/blob/circle"
```

```
curl -o LFJK02.blob.hex.png "https://example.com/api/v1/image/LFJK02/blob/hex"
```

```
curl -o LFJK02.blob.square.png "https://example.com/api/v1/image/LFJK02/blob/square"
```

### query string parameters

#### /api/v1/image/:dataset_id/:type?format=:format

Determines the image `:format` to retrieve, typically `PNG` and `SVG` formats will be available. If not specified, the default format is `PNG`.

```
curl -o LFJK02.blob.png "https://example.com/api/v1/image/LFJK02/blob?format=png"
```

```
curl -o LFJK02.blob.svg "https://example.com/api/v1/image/LFJK02/blob?format=svg"
```

#### /api/v1/image/:dataset_id/:type?width=:width

For `PNG` format images, determines the `:width` (in pixels) of the image to be returned. If the width specified is greater than the width of the available image, the image will be returned at its native resolution and will not be scaled up.

```
curl -o LFJK02.cumulative.1000.svg "https://example.com/api/v1/image/LFJK02/cumulative?width=1000"
```
