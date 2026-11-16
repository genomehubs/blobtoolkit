import { createAction, handleAction, handleActions } from "redux-actions";

import { apiUrl } from "./api";
import { byIdSelectorCreator } from "./selectorCreators";
import { createSelector } from "reselect";
import deep from "deep-get-set";
import { getDatasetID } from "./location";
import immutableUpdate from "immutable-update";
import shallow from "shallowequal";
import store from "../store";

// In-flight requests keyed by dataset id, so concurrent callers share one fetch.
const inFlight = {};

const requestIdentifiers = createAction("REQUEST_IDENTIFIERS");
const receiveIdentifiers = createAction(
  "RECEIVE_IDENTIFIERS",
  (json) => json,
  () => ({ receivedAt: Date.now() }),
);

const useStoredIdentifiers = createAction("USE_STORED_IDENTIFIERS");

const defaultState = () => ({
  list: [],
});

export const identifiers = handleActions(
  {
    REQUEST_IDENTIFIERS: (state, action) => {
      return immutableUpdate(state, { isFetching: true });
    },
    RECEIVE_IDENTIFIERS: (state, action) => {
      return immutableUpdate(state, {
        isFetching: false,
        list: action.payload,
        lastUpdated: action.meta.receivedAt,
      });
    },
  },
  defaultState(),
);

export const getIdentifiersIsFetching = (state) =>
  deep(state, "identifiers", "byId", "isFetching") || false;

export const getIdentifiers = (state) =>
  state.identifiers ? state.identifiers.list : [];

export function fetchIdentifiers() {
  return function (dispatch) {
    let state = store.getState();
    let existing = getIdentifiers(state);
    if (existing.length > 0) {
      return new Promise((resolve) => resolve(existing));
    }
    let id = getDatasetID(state);
    if (inFlight[id]) {
      return inFlight[id];
    }
    dispatch(requestIdentifiers(id));
    const request = fetch(apiUrl + "/identifiers/" + id)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((json) => {
        const list = Array.isArray(json) ? json : json.values;
        if (!Array.isArray(list)) {
          throw new Error("unexpected identifiers response");
        }
        return dispatch(receiveIdentifiers(list));
      })
      .catch((error) => {
        console.log("An error occured.", error);
        return dispatch(receiveIdentifiers([]));
      })
      .finally(() => {
        delete inFlight[id];
      });
    inFlight[id] = request;
    return request;
  };
}

export const identifierReducers = {
  identifiers,
};
