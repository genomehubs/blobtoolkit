import { getDatasetID, getView } from "../reducers/location";
import { getDatasetIsActive, loadDataset } from "../reducers/repository";

import CumulativePlot from "./CumulativePlot";
import DetailPlot from "./DetailPlot";
import GetStarted from "./GetStarted";
import MainPlot from "./MainPlot";
import React from "react";
import SnailPlot from "./SnailPlot";
import Spinner from "./Spinner";
import TablePlot from "./TablePlot";
import TreeMapPlot from "./TreeMapPlot";
import { connect } from "react-redux";
import styles from "./Layout.scss";

class DatasetSpinner extends React.Component {
  constructor(props) {
    super(props);
    this.mapStateToProps = (state) => {
      return {
        active: getDatasetIsActive(state),
        id: getDatasetID(state),
      };
    };
    this.mapDispatchToProps = (dispatch) => {
      return {
        onLoad: (id) => dispatch(loadDataset(id)),
      };
    };
  }

  render() {
    const ConnectedSpinner = connect(
      this.mapStateToProps,
      this.mapDispatchToProps,
    )(Spinner);
    return <ConnectedSpinner {...this.props} />;
  }
}

export default DatasetSpinner;
