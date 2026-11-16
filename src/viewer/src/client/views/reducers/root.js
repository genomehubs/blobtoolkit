import { colorReducers } from "./color";
import { combineReducers } from "redux";
import { datasetPageReducers } from "./datasetPage";
import { datasetTableReducers } from "./datasetTable";
import { datasetTreeReducers } from "./datasetTree";
import { dimensionReducers } from "./dimension";
import { fieldReducers } from "./field";
import { filterReducers } from "./filter";
import { identifierReducers } from "./identifiers";
import { listReducers } from "./list";
import { locationReducers } from "./location";
import { plotParameterReducers } from "./plotParameters";
import { plotReducers } from "./plot";
import { recordReducers } from "./record";
import { referenceReducers } from "./reference";
import { repositoryReducers } from "./repository";
import { selectReducers } from "./select";
import { trackingReducers } from "./tracking";

const allReducers = Object.assign(
  {},
  locationReducers,
  repositoryReducers,
  fieldReducers,
  filterReducers,
  listReducers,
  identifierReducers,
  dimensionReducers,
  colorReducers,
  plotReducers,
  selectReducers,
  plotParameterReducers,
  recordReducers,
  referenceReducers,
  trackingReducers,
  datasetTableReducers,
  datasetPageReducers,
  datasetTreeReducers,
);

const appReducer = combineReducers(allReducers);

const rootReducer = (state, action) => {
  if (action.type === "REFRESH") {
    let cookieConsent = state.cookieConsent;
    let analytics = state.analytics;
    let availableDatasets = state.availableDatasets;
    let datasetIsActive = state.datasetIsActive;
    let staticThreshold = state.staticThreshold;
    let nohitThreshold = state.nohitThreshold;
    let pathname = state.pathname;
    let hashString = state.hashString;
    let datasetPage = state.datasetPage;
    let datasetPageSize = state.datasetPageSize;
    let datasetSorted = state.datasetSorted;
    let datasetColumns = state.datasetColumns;
    let datasetPageData = state.datasetPageData;
    let datasetFiltered = state.datasetFiltered;
    let datasetColumnOptions = state.datasetColumnOptions;
    let datasetTree = state.datasetTree;
    let datasetCounter = state.datasetCounter;
    let targetTree = state.targetTree;
    let expandedNodes = state.expandedNodes;
    state = {
      analytics,
      cookieConsent,
      availableDatasets,
      datasetIsActive,
      staticThreshold,
      nohitThreshold,
      pathname,
      hashString,
      datasetPage,
      datasetPageSize,
      datasetSorted,
      datasetColumns,
      datasetPageData,
      datasetFiltered,
      datasetColumnOptions,
      datasetTree,
      datasetCounter,
      targetTree,
      expandedNodes,
    };
  }
  return appReducer(state, action);
};

export default rootReducer;
