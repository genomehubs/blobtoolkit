//import 'react-table/react-table.css';
import "./style/node_modules.css";

import React, { Component } from "react";
import {
  datasetPageSummaries,
  getDatasetPage,
  getDatasetPageSize,
  getDatasetPageTotal,
  getDatasetSorted,
  listingColumns,
  setDatasetPage,
  setDatasetPageSize,
  setDatasetSorted,
} from "../reducers/datasetTable";
import {
  fetchDatasetPage,
  getDatasetFiltered,
  setDatasetFiltered,
} from "../reducers/datasetPage";

import CustomiseDatasetTable from "./CustomiseDatasetTable";
import DatasetTableCSV from "./DatasetTableCSV";
import ReactDOM from "react-dom";
import ReactTable from "react-table";
import { connect } from "react-redux";
import figure1 from "./img/figure1.jpg";
import { getColorScheme } from "../reducers/color";
import { getSearchTerm } from "../reducers/location";
import styles from "./Layout.scss";

// Shared across renders, as the connected table is recreated on each render.
let filterTimer = null;

class CSVWrapper extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      clicked: false,
    };
  }

  toggleClicked(clicked) {
    if (typeof clicked == "undefined") clicked = !this.state.clicked;
    this.setState({ clicked });
  }

  render() {
    let download;
    if (this.state.clicked) {
      download = <DatasetTableCSV />;
    }
    return (
      <span
        className={styles.tableDownload}
        onMouseDown={() => this.toggleClicked(true)}
        onMouseUp={() => this.toggleClicked(false)}
      >
        <span className={styles.save_svg}>
          &#8681;csv
          {download}
        </span>
      </span>
    );
  }
}

class DatasetTableComponent extends Component {
  constructor(props) {
    super(props);
    this.state = { customise: false };
  }

  toggleCustomise() {
    this.setState({ customise: !this.state.customise });
  }

  render() {
    let css = styles.list_container;
    if (this.props.active) {
      css += ` ${styles.active}`;
    }
    let columns = this.props.columns;
    let table;
    let hints;
    if (this.props.total > 0 || this.props.filtered.length > 0) {
      table = (
        <ReactTable
          data={this.props.data}
          columns={columns}
          className={"-highlight"}
          min-width={50}
          manual
          filterable
          filtered={this.props.filtered}
          pages={Math.max(1, Math.ceil(this.props.total / this.props.pageSize))}
          pageSize={this.props.pageSize}
          showPageSizeOptions={this.props.total > 10}
          showPagination={this.props.total > 10}
          sorted={this.props.sorted}
          multiSort={false}
          page={this.props.page}
          getTrProps={(state, rowInfo, column) => {
            return {
              onClick: (e, handleOriginal) => {
                let view = "blob";
                if (!rowInfo.row["reads"] || rowInfo.row["reads"] == 0) {
                  view = "cumulative";
                }
                this.props.onDatasetClick(rowInfo.row.id, view);
              },
              style: {
                cursor: "pointer",
              },
            };
          }}
          onSortedChange={(arr) => {
            this.props.setPage(0);
            this.props.setSorted(arr);
            this.props.fetchPage(this.props.searchTerm);
          }}
          onFilteredChange={(arr) => {
            this.props.setPage(0);
            this.props.setFiltered(arr);
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => {
              this.props.fetchPage(this.props.searchTerm);
            }, 300);
          }}
          onPageChange={(newPage) => {
            this.props.setPage(newPage);
            this.props.fetchPage(this.props.searchTerm);
          }}
          onPageSizeChange={(newPageSize, pageIndex) => {
            this.props.changePageSize(
              newPageSize,
              this.props.pageSize,
              this.props.page,
            );
            this.props.fetchPage(this.props.searchTerm);
            return (newPageSize, pageIndex);
          }}
        />
      );
      hints = (
        <span className={styles.hints}>
          <ul style={{ marginTop: "0.25em" }}>
            <li>Click headers to sort results.</li>
            <li>
              Type in the box at the top of each column to filter assemblies.
            </li>
            <li>Click a row to view an assembly.</li>
            <li>
              <span
                className={styles.toggle}
                onClick={() => this.toggleCustomise()}
              >
                Customise table
              </span>
            </li>
          </ul>
        </span>
      );
    } else {
      hints = (
        <span className={styles.hints}>
          <ul style={{ marginTop: "0.25em" }}>
            <li>
              Use the search box above to find datasets – matching datasets and
              associated metadata will be displayed in a sortable table.
            </li>
            <li>
              If you are unsure what to search for, browse available datasets
              below or type 'all' to show all available datasets.
            </li>
          </ul>
        </span>
      );
    }
    let customise;
    if (this.state.customise) customise = <CustomiseDatasetTable />;
    return (
      <div id="list" className={css}>
        <div style={{ fontSize: "0.75em", paddingBottom: "0.5em" }}>
          {table}
        </div>
        <CSVWrapper />
        {hints}
        {customise}
      </div>
    );
  }
}

class DatasetTable extends React.Component {
  constructor(props) {
    super(props);
    this.mapStateToProps = (state) => {
      return {
        data: datasetPageSummaries(state),
        total: getDatasetPageTotal(state),
        searchTerm: getSearchTerm(state),
        columns: listingColumns(state),
        page: getDatasetPage(state),
        pageSize: getDatasetPageSize(state),
        sorted: getDatasetSorted(state),
        filtered: getDatasetFiltered(state),
        colors: getColorScheme(state),
      };
    };
    this.mapDispatchToProps = (dispatch) => {
      return {
        setPage: (page) => dispatch(setDatasetPage(page)),
        changePageSize: (newSize, oldSize, oldPage) => {
          dispatch(setDatasetPageSize(newSize));
          let newPage = Math.floor((oldSize / newSize) * oldPage);
          dispatch(setDatasetPage(newPage));
        },
        setSorted: (arr) => dispatch(setDatasetSorted(arr)),
        setFiltered: (arr) => dispatch(setDatasetFiltered(arr)),
        fetchPage: (searchTerm) => dispatch(fetchDatasetPage(searchTerm)),
      };
    };
  }

  render() {
    const ConnectedTable = connect(
      this.mapStateToProps,
      this.mapDispatchToProps,
    )(DatasetTableComponent);
    return <ConnectedTable {...this.props} />;
  }
}

export default DatasetTable;
