import { createAction, handleAction, handleActions } from "redux-actions";

import { apiUrl } from "./api";

// Server-side search for the dataset table. Each request returns one page of results, with
// the table's filters and sort applied by the API. Nothing here depends on the full result list.

export const requestDatasetPage = createAction("REQUEST_DATASET_PAGE");
export const receiveDatasetPage = createAction("RECEIVE_DATASET_PAGE");
export const failDatasetPage = createAction("FAIL_DATASET_PAGE");

export const datasetPageData = handleAction(
  "RECEIVE_DATASET_PAGE",
  (state, action) => action.payload,
  { total: 0, page: 1, size: 10, results: [] },
);

export const datasetPageFetching = handleActions(
  {
    REQUEST_DATASET_PAGE: () => true,
    RECEIVE_DATASET_PAGE: () => false,
    FAIL_DATASET_PAGE: () => false,
  },
  false,
);

export const getDatasetPageData = (state) => state.datasetPageData;

export const setDatasetFiltered = createAction("SET_DATASET_FILTERED");

// Column filters as react-table reports them: [{ id, value }].
export const datasetFiltered = handleAction(
  "SET_DATASET_FILTERED",
  (state, action) => action.payload,
  [],
);

export const getDatasetFiltered = (state) => state.datasetFiltered;

export const receiveDatasetColumnOptions = createAction(
  "RECEIVE_DATASET_COLUMN_OPTIONS",
);

// Hit taxa and BUSCO lineages for the column pickers, across every match for the term.
export const datasetColumnOptions = handleAction(
  "RECEIVE_DATASET_COLUMN_OPTIONS",
  (state, action) => action.payload,
  { hitTaxa: [], buscoLineages: [] },
);

export const getDatasetColumnOptions = (state) => state.datasetColumnOptions;

// Sort and column filter parameters for the table state. Paging is added by the callers.
const tableParams = (state, params) => {
  const [sort] = state.datasetSorted;
  if (sort) {
    params.set("sort", sort.id);
    params.set("order", sort.desc ? "desc" : "asc");
  }
  state.datasetFiltered.forEach(({ id, value }) => {
    if (value) params.set(`filter[${id}]`, value);
  });
  return params;
};

const searchUrl = (searchTerm, params) =>
  `${apiUrl}/search/${encodeURIComponent(searchTerm)}?${params.toString()}`;

// Requests the current page of results for `searchTerm`. Responses for superseded requests are ignored.
// Resolves to the page, undefined when superseded, or null when the request failed.
let latestPageRequest = 0;

export function fetchDatasetPage(searchTerm) {
  return function (dispatch, getState) {
    const state = getState();
    if (!searchTerm) {
      // Landing page with no term: initialise the table with an empty page, as the full list did.
      const empty = {
        total: 0,
        page: 1,
        size: state.datasetPageSize,
        results: [],
      };
      ++latestPageRequest;
      dispatch(requestDatasetPage());
      dispatch(receiveDatasetPage(empty));
      return Promise.resolve(empty);
    }
    const request = ++latestPageRequest;
    dispatch(requestDatasetPage());
    const params = tableParams(
      state,
      new URLSearchParams({
        page: state.datasetPage + 1,
        size: state.datasetPageSize,
      }),
    );
    return fetch(searchUrl(searchTerm, params))
      .then((response) => response.json())
      .then((json) => {
        if (request !== latestPageRequest) return undefined;
        if (!json || !Array.isArray(json.results)) {
          dispatch(failDatasetPage());
          return null;
        }
        dispatch(receiveDatasetPage(json));
        return json;
      })
      .catch((err) => {
        console.log("An error occured.", err);
        if (request !== latestPageRequest) return undefined;
        dispatch(failDatasetPage());
        return null;
      });
  };
}

// Hit taxa and BUSCO lineages for the column pickers.
export function fetchColumnOptions(searchTerm) {
  return function (dispatch) {
    if (!searchTerm) return Promise.resolve();
    return fetch(`${apiUrl}/search/${encodeURIComponent(searchTerm)}/columns`)
      .then((response) => response.json())
      .then((json) => {
        if (json && Array.isArray(json.hitTaxa)) {
          dispatch(receiveDatasetColumnOptions(json));
        }
      })
      .catch((err) => console.log("An error occured.", err));
  };
}

// Ids of every dataset matching the term and the table's filters, for "Load all".
// Resolves to an array of ids, or null when the request failed.
export function fetchDatasetIds(searchTerm) {
  return function (dispatch, getState) {
    if (!searchTerm) return Promise.resolve([]);
    const params = tableParams(
      getState(),
      new URLSearchParams({ display: "ids" }),
    );
    return fetch(searchUrl(searchTerm, params))
      .then((response) => response.json())
      .then((json) => (Array.isArray(json) ? json : null))
      .catch((err) => {
        console.log("An error occured.", err);
        return null;
      });
  };
}

// URL for a CSV download of the rows matching the table's filters and sort, with the active columns.
export const getDatasetCSVUrl = (searchTerm) => (state) => {
  const params = tableParams(
    state,
    new URLSearchParams({
      display: "csv",
      columns: state.datasetColumns.join(","),
    }),
  );
  return searchUrl(searchTerm, params);
};

export const datasetPageReducers = {
  datasetPageData,
  datasetPageFetching,
  datasetFiltered,
  datasetColumnOptions,
};
