import React, { Component } from "react";
import { fetchRepository, getResultCount } from "../reducers/repository";

import Suggestions from "./Suggestions";
import { apiUrl } from "../reducers/api";
import { connect } from "react-redux";
import styles from "./Search.scss";

// import { getSearhTerm,setSearchTerm } from '../reducers/search'

class SearchBox extends Component {
  constructor(props) {
    super(props);
    this.state = {
      query: "",
      results: [],
      activeIndex: -1,
    };
    this.latestRequest = 0;
    this.unmounted = false;
  }

  componentDidUpdate(prevProps, prevState) {
    const { activeIndex } = this.state;
    if (
      activeIndex !== prevState.activeIndex &&
      activeIndex >= 0 &&
      this.list
    ) {
      const option = this.list.children[activeIndex];
      if (option && option.scrollIntoView) {
        option.scrollIntoView({ block: "nearest" });
      }
    }
  }

  componentWillUnmount() {
    this.unmounted = true;
  }

  getInfo(query) {
    const request = ++this.latestRequest;
    fetch(apiUrl + "/search/autocomplete/" + encodeURIComponent(query))
      .then((response) => response.json())
      .then((json) => {
        // ignore responses for queries that have since changed
        if (this.unmounted || request !== this.latestRequest) {
          return;
        }
        this.setState({ results: json.slice(0, 10), activeIndex: -1 });
      })
      .catch((error) => console.log("An error occured.", error));
  }

  chooseTerm(term) {
    this.latestRequest++;
    this.setState({ results: [], activeIndex: -1 });
    this.props.onChooseTerm(term);
  }

  handleInputChange() {
    const query = this.search.value;
    this.setState({ query: query }, () => {
      if (this.state.query && this.state.query.length > 1) {
        this.getInfo(this.state.query);
      } else {
        this.latestRequest++;
        this.setState({ results: [], activeIndex: -1 });
      }
    });
  }

  handleKeyDown(e) {
    // do not act on keys used to compose IME text
    if (e.nativeEvent && e.nativeEvent.isComposing) {
      return;
    }
    const { results, activeIndex } = this.state;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length === 0) {
        return;
      }
      e.preventDefault();
      let next;
      if (e.key === "ArrowDown") {
        next = activeIndex + 1 >= results.length ? 0 : activeIndex + 1;
      } else {
        next = activeIndex <= 0 ? results.length - 1 : activeIndex - 1;
      }
      this.setState({ activeIndex: next });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length > 0) {
        const index = activeIndex >= 0 ? activeIndex : 0;
        this.chooseTerm(results[index].term);
      }
    } else if (e.key === "Escape" && results.length > 0) {
      e.preventDefault();
      this.latestRequest++;
      this.setState({ results: [], activeIndex: -1 });
    }
  }

  render() {
    let placeholder =
      this.props.datasetCount == 0
        ? "Search datasets to begin... (e.g. Nematoda)"
        : "Search for datasets...";
    const listId = "dataset-search-suggestions";
    const activeId =
      this.state.activeIndex >= 0
        ? listId + "-" + this.state.activeIndex
        : undefined;
    return (
      <form onSubmit={(e) => e.preventDefault()}>
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={this.state.results.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          ref={(input) => (this.search = input)}
          onChange={() => this.handleInputChange()}
          onKeyDown={(e) => this.handleKeyDown(e)}
          className={styles.search_box}
        />
        <Suggestions
          id={listId}
          listRef={(ul) => (this.list = ul)}
          results={this.state.results}
          activeIndex={this.state.activeIndex}
          onHover={(index) => this.setState({ activeIndex: index })}
          onChooseTerm={(term) => this.chooseTerm(term)}
        />
      </form>
    );
  }
}

// connect() is created once here; creating it inside render() remounted the
// search box (and wiped its query and results) on every parent re-render.
const mapStateToProps = (state) => ({
  datasetCount: getResultCount(state),
});
const mapDispatchToProps = (dispatch) => ({
  onChooseTerm: (str) => {
    dispatch(fetchRepository(str));
  },
});
const ConnectedSearchBox = connect(
  mapStateToProps,
  mapDispatchToProps,
)(SearchBox);

class Search extends React.Component {
  render() {
    return <ConnectedSearchBox {...this.props} />;
  }
}

export default Search;
