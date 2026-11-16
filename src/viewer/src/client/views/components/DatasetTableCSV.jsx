import React from "react";
import { connect } from "react-redux";
import { getDatasetCSVUrl } from "../reducers/datasetPage";
import { getSearchTerm } from "../reducers/location";

// Downloads the server-side CSV for the current search, columns and filters.
export class DatasetCSVComponent extends React.Component {
  componentDidMount() {
    const link = document.createElement("a");
    link.href = this.props.url;
    link.download = `${this.props.term}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  render() {
    return null;
  }
}

const mapStateToProps = (state) => {
  const term = getSearchTerm(state);
  return {
    term,
    url: getDatasetCSVUrl(term)(state),
  };
};

export default connect(mapStateToProps)(DatasetCSVComponent);
