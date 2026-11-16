import { createAction, handleAction, handleActions } from "redux-actions";
import { getAvailableDatasetIds, getAvailableDatasets } from "./repository";

import { apiUrl } from "./api";
import { createSelector } from "reselect";
import { getSearchTerm } from "./location";
import store from "../store";

export const getTargetFlag = () => {
  if (
    window &&
    window.process &&
    window.process.ENV &&
    window.process.ENV.BTK_TARGET_TREE
  ) {
    return window.process.ENV.BTK_TARGET_TREE ? true : false;
  }
  return TARGET_TREE;
};

const showTargetTree = getTargetFlag();

const requestDatasetTree = createAction("REQUEST_DATASET_TREE");
const receiveDatasetTree = createAction(
  "RECEIVE_DATASET_TREE",
  (json) => json,
  {},
);

export const datasetTree = handleActions(
  {
    REQUEST_DATASET_TREE: (state, action) => ({
      isFetching: true,
      isInitialised: false,
    }),
    RECEIVE_DATASET_TREE: (state, action) => ({
      isFetching: false,
      isInitialised: true,
      tree: action.payload,
    }),
  },
  { isInitialised: false },
);

export const getDatasetTree = (state) => state.datasetTree;

export function fetchDatasetTree() {
  return function (dispatch) {
    dispatch(requestDatasetTree());
    return fetch(apiUrl + "/search/tree/available")
      .then(
        (response) => response.json(),
        (error) => console.log("An error occured.", error),
      )
      .then((json) => {
        dispatch(receiveDatasetTree(json));
        if (showTargetTree) {
          dispatch(fetchTargetTree());
        }
      });
  };
}

const requestTargetTree = createAction("REQUEST_TARGET_TREE");
const receiveTargetTree = createAction(
  "RECEIVE_TARGET_TREE",
  (json) => json,
  {},
);
const receiveTargetNodes = createAction(
  "RECEIVE_TARGET_NODES",
  (json) => json,
  {},
);

export const findNode = (node, id) => {
  if (!node) return undefined;
  if (node.n === id) return node;
  if (!node.d) return undefined;
  for (const key of Object.keys(node.d)) {
    const found = findNode(node.d[key], id);
    if (found) return found;
  }
  return undefined;
};

// Copies a node with the summaries from response, keeping children that are already loaded.
const mergeNode = (node, response) => {
  if (!response.d) return { ...node, ...response };
  let d = {};
  Object.keys(response.d).forEach((key) => {
    let loaded = node.d && node.d[key];
    let summary = response.d[key];
    d[key] =
      loaded && loaded.n === summary.n ? { ...loaded, ...summary } : summary;
  });
  return { ...node, ...response, d };
};

// Returns the tree with the node matching response replaced. Unchanged branches are shared.
const applyNode = (node, response) => {
  if (node.n === response.n) return mergeNode(node, response);
  if (!node.d) return node;
  let changed = false;
  let d = {};
  Object.keys(node.d).forEach((key) => {
    let child = applyNode(node.d[key], response);
    changed = changed || child !== node.d[key];
    d[key] = child;
  });
  return changed ? { ...node, d } : node;
};

export const targetTree = handleActions(
  {
    REQUEST_TARGET_TREE: (state, action) => ({
      ...state,
      isFetching: true,
      isInitialised: false,
    }),
    RECEIVE_TARGET_TREE: (state, action) => ({
      isFetching: false,
      isInitialised: true,
      tree: state.tree ? mergeNode(state.tree, action.payload) : action.payload,
    }),
    RECEIVE_TARGET_NODES: (state, action) => ({
      ...state,
      tree: state.tree
        ? action.payload.reduce(
            (tree, node) => applyNode(tree, node),
            state.tree,
          )
        : state.tree,
    }),
  },
  { isInitialised: false },
);

export const getTargetTree = (state) => state.targetTree;

export const setExpandedNodes = createAction("SET_EXPANDED_NODES");

export const expandedNodes = handleAction(
  "SET_EXPANDED_NODES",
  (state, action) => action.payload,
  { 1: 0 },
);

export const getExpandedNodes = (state) => state.expandedNodes;

export const setTargetNodes = createAction("SET_TARGET_NODES");

export const targetNodes = handleAction(
  "SET_TARGET_NODES",
  (state, action) => action.payload,
  {},
);

export const getTargetNodes = (state) => state.targetNodes;

export const setDatasetCounter = createAction("SET_DATASET_COUNTER");

export const datasetCounter = handleAction(
  "SET_DATASET_COUNTER",
  (state, action) => action.payload,
  "assemblies",
);

export const getDatasetCounter = (state) => state.datasetCounter;

// Fetches the targets tree nodes with the given ids, keeping any that fail to load.
function fetchTargetNodes(ids) {
  return function (dispatch) {
    return Promise.all(
      ids.map((id) =>
        fetch(`${apiUrl}/search/tree/target?node=${id}`)
          .then((response) => (response.ok ? response.json() : null))
          .catch((error) => {
            console.log("An error occured.", error);
            return null;
          }),
      ),
    ).then((nodes) => {
      let loaded = nodes.filter((node) => node);
      if (loaded.length) dispatch(receiveTargetNodes(loaded));
    });
  };
}

// Loads children of the taxa with the given ids that are not loaded yet.
function loadTargetNodes(ids) {
  return function (dispatch) {
    let tree = getTargetTree(store.getState()).tree;
    let missing = ids.filter((id) => {
      let node = findNode(tree, id);
      return node && node.r && !node.d;
    });
    if (!missing.length) return Promise.resolve();
    return dispatch(fetchTargetNodes(missing));
  };
}

const addExpandedNode = (id, parent) => {
  return (dispatch) => {
    let state = store.getState();
    let nodes = Object.assign({}, getExpandedNodes(state));
    nodes[id] = parent;
    dispatch(setExpandedNodes(nodes));
  };
};

export function expandNode(id, parent) {
  return (dispatch) => {
    let nodeId = Number(id);
    dispatch(loadTargetNodes([nodeId])).then(() =>
      dispatch(addExpandedNode(nodeId, parent)),
    );
  };
}

const collapseChildren = (nodes, id) => {
  delete nodes[id * 1];
  let sibs = Object.keys(nodes).filter((key) => nodes[key] == id);
  sibs.forEach((sib) => {
    collapseChildren(nodes, sib);
  });
};

export function collapseNode(id) {
  return (dispatch) => {
    let state = store.getState();
    let nodes = Object.assign({}, getExpandedNodes(state));
    collapseChildren(nodes, id);
    dispatch(setExpandedNodes(nodes));
  };
}

// Opens the path to the search term and highlights its matches, using the server's term lookup.
export function expandSearchTerm() {
  return (dispatch) => {
    let term = getSearchTerm(store.getState());
    if (!term) return dispatch(loadTargetNodes([1]));
    if (term == "all") term = "Eukaryota";
    return fetch(
      `${apiUrl}/search/tree/target?term=${encodeURIComponent(term)}`,
    )
      .then(
        (response) => (response.ok ? response.json() : null),
        (error) => console.log("An error occured.", error),
      )
      .then((json) => {
        if (!json) return;
        dispatch(receiveTargetNodes(json.nodes));
        let expNodes = Object.keys(json.expand).length ? json.expand : { 1: 0 };
        dispatch(setExpandedNodes(expNodes));
        let termIds = {};
        json.targets.forEach((id) => {
          termIds[id] = true;
        });
        dispatch(setTargetNodes(termIds));
      });
  };
}

const RANK_ORDER = [
  "domain",
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species",
];

export const treeData = createSelector(
  getDatasetTree,
  getTargetTree,
  getExpandedNodes,
  (data, target, nodes) => {
    if (!data.tree || !target.tree) {
      return false;
    }
    let ranks = [];
    let widths = [];
    let depth = 0;
    const prepareNested = (obj, avail, name, depth) => {
      if (name.match("-undef")) name = "Other " + name.replace("-undef", "");
      if (obj.d) {
        let undef = `${name}-undef`;
        if (avail.d && avail.d[undef] && avail.d[undef].d) {
          let subsets = {};
          Object.keys(avail.d[undef].d).map((key) => {
            subsets[key] = avail.d[undef].d[key];
          });
          Object.keys(obj.d).map((taxon) => {
            if (taxon != undef && obj.d[taxon].d) {
              Object.keys(obj.d[taxon].d).map((key) => {
                if (subsets[key]) {
                  if (!avail.d[taxon]) {
                    avail.d[taxon] = {
                      n: 0,
                      d: {},
                      r: obj.d[taxon].r,
                      s: 0,
                      a: 0,
                    };
                  }
                  avail.d[taxon].d[key] = subsets[key];
                  avail.d[taxon].a += subsets[key].a;
                  avail.d[taxon].s += subsets[key].s;
                  delete avail.d[undef].d[key];
                }
              });
            }
          });
        }
        let nested = Object.keys(obj.d).map((key, i) => {
          let descendants;
          let count = 0;
          let species = 0;
          let leaf;
          if (avail.d && avail.d[key]) {
            if (nodes.hasOwnProperty(obj.d[key].n)) {
              descendants = prepareNested(
                obj.d[key],
                avail.d[key],
                key,
                depth + 1,
              );
            }
            count = avail.d[key]
              ? avail.d[key].a
                ? avail.d[key].a
                : 1
              : undefined;
            species = avail.d[key].s;
            leaf = true;
          } else if (nodes.hasOwnProperty(obj.d[key].n)) {
            descendants = prepareNested(obj.d[key], {}, key, depth + 1);
          }
          let total = obj.d[key].ta;
          let speciesTotal = obj.d[key].ts;
          let node_id = obj.d[key].n;
          let rank = RANK_ORDER[depth]; //obj.d[key].r;
          if (!rank || rank == "taxon_name") {
            if (ranks[depth - 1] == rank) {
              rank = "assembly name";
            } else if (ranks[depth] == ranks[depth - 1]) {
              rank = "assembly name";
            } else {
              rank = "taxon name";
            }
          }
          ranks[depth] = rank;
          let width =
            key.length +
            String(count || 0).length +
            String(total || 0).length +
            2;
          widths[depth] = Math.max(rank.length, width, widths[depth] || 0);
          return {
            name: key,
            depth,
            descendants,
            node_id,
            count,
            total,
            leaf,
            species,
            speciesTotal,
            parent: obj.n,
          };
        });
        return nested.sort((a, b) =>
          a.name == b.name
            ? 0
            : a.name.endsWith("-undef")
              ? 1
              : b.name.endsWith("-undef")
                ? -1
                : a.name > b.name
                  ? 1
                  : -1,
        );
      }
    };
    let nested = prepareNested(target.tree, data.tree, "root", depth);

    let targetNested;
    return { nested, ranks, widths };
  },
);

export function fetchTargetTree() {
  return function (dispatch) {
    dispatch(requestTargetTree());
    return fetch(apiUrl + "/search/tree/target")
      .then(
        (response) => response.json(),
        (error) => console.log("An error occured.", error),
      )
      .then((json) => {
        dispatch(receiveTargetTree(json));
        dispatch(expandSearchTerm());
      });
  };
}

export const datasetTreeReducers = {
  datasetTree,
  datasetCounter,
  targetTree,
  expandedNodes,
  targetNodes,
};
