(function() {
    var TableMutt = function(selector, columns, options) {
        this._selector = selector;
        var self = this;
        options = options || {};
        var search_callback;

        if (_.isUndefined(columns) || _.isEmpty(columns)) {
            console.error("Cannot initialize with zero columns!");
            return;
        }

        this.options = _.defaults(options, {
            groupBy: [],
            tableGroups: [],
            paginateBy: 50,
            showPages: true, // show one list item for each page
            maxPageLinks: 10, // max number of page links shown
            showInfo: true, // 'showing X of Y' info
            sortOrder: [], // e.g. ["columnId", "-columnId2"]
            textFilter: true, // generates index on load and update
            cleanSearchString: null, // function to preprocess search string

            classes: [], // classes set on <table> elem
            id: null, // id set on <table> elem
            filterbarContainer: null, // selector to override filterbar location
            filterbarPlaceholderText: "filter rows",
            paginationContainer: null, // selector to override pagination location
            infoContainer: null, // selector to override 'showing X of Y' info location

            previousButtonContent: "&larr;", // contents of <li> for page nav
            nextButtonContent: "&rarr;",
            skippedPageContent: "&hellip;", // contents of skipped page placeholder

            loadingContent: '<div class="tablemutt loading"></div>',
            emptyContent: 'No records found',
            filterEmptyContent: 'No matching records found',

            loadCompleteCallback: null,
            renderCompleteCallback: null,
            rowSelectedCallback: null,
            rowDeselectedCallback: null,
            formatRow: null, // receives `d`, the object for that row's data
            keyFunction: null, // create a unique id for a row (required to
                              // persist selected row state across updates)
            skipRowReselect: null // skip reselecting previously selected row on updates
        });

        //Enforce minimums
        this.options.maxPageLinks = Math.max(this.options.maxPageLinks, 4);

        // normalize format of cols
        _.each(columns, function (element, index, list) {

            // make the id safe for id and class identifiers
            element._id = element.id.replace(/\W/g, '-');
            if(!(_.has(element, "name"))) {
                element.name = element.id.toLocaleUpperCase().slice(0,1) + element.id.slice(1);
            }
            if(!(_.has(element, "transform"))) {
                element.transform = self._makeNoopTransform(element.id);
            }

            element.sorted = null; // property for toggling sort
            element.hidden = element.hidden || false;
            element.classes = element.classes || [];
            if (_.isEqual(element.classes.indexOf("column_" + element._id), -1)) {
                element.classes.push("column_" + element._id);
            }
            element._classes = element.classes.join(" ");
            element.headerAttributes = element.headerAttributes || {};
            element.cellAttributes = element.cellAttributes || {};
        });

        this._data = null; // data we've loaded, unfiltered and not paginated
        this._filteredData = null; // data matching user filtering
        this._searchData = null; // search index (string representation of every row)

        this.columns = {};
        this.columnOrder = []; // sequence of (shown) column ids
        _.each(columns, function (elem, idx, list) {
            self.columns[elem.id] = elem;
            if(!elem.hidden) {
                self.columnOrder.push(elem.id);
            }
        });

        this.selectedRow = null;

        // Attach containers & controls to DOM
        this._initializeElements();

        // Timer to debounce freeform filtering
        this._searchTimeout = null;

        return this;
    };

    var ASCENDING = true;
    var DESCENDING = false;

    TableMutt.prototype.ASCENDING = ASCENDING;
    TableMutt.prototype.DESCENDING = DESCENDING;

    TableMutt.prototype._initializeElements = function () {
        var self = this;
        this.outerContainer = d3.select(this._selector);
        if (!_.isEqual(this.outerContainer.length, 1)) {
            console.error("Selector '", this._selector, "' must match exactly 1 element where we want to add TableMutt");
        }

        // Create loading placeholder
        this._loadingPlaceholder = this.outerContainer.append("div")
                                      .html(this.options.loadingContent);

        // Create container
        this.container = this.outerContainer.append("div")
                           .classed("tablemutt container", true)
                           .style("display", "none");

        // Attach filterBar placeholder
        this.filterBar = null;
        if (this.options.filterbarContainer) {
            this.filterBar = d3.select(this.options.filterbarContainer);
            if (_.isEqual(this.filterBar.length, 1)) {
                this.filterBar.classed("tablemutt filterbar", true);
            } else {
                console.error("Expected 1 element to match", this.options.filterbarContainer);
            }
        }

        // If we failed to attach to an existing element, add one
        if (_.isNull(this.filterBar)) {
            this.filterBar = this.container.append("div")
                                 .classed("tablemutt filterbar", true);
        }

        if (this.options.textFilter) {
            this.initTextFilter();
        }

        this.table = this.container.append("table");

        // Apply table options
        if (!_.isNull(this.options.id)) {
           this.table.attr("id", this.options.id);
        }
        if (!_.isEmpty(this.options.classes)) {
            this.table.classed(this.options.classes.join(" "), true);
        }

        this.table.classed("tablemutt", true);
        this.theadRow = this.table
            .append("thead")
            .append("tr");
        this.theadRow.selectAll("th")
            .data(this.columnOrder)
            .enter()
            .append("th")
            .each(function (d, i) {
                var d3elem = d3.select(this);
                if (self.columns[d].classes) {
                    d3elem.classed(self.columns[d]._classes, true);
                }
                if (self.columns[d].headerAttributes) {
                    _.each(self.columns[d].headerAttributes, function (val, key) {
                        d3elem.attr(key, val);
                    });
                }
            })
            .text(function (d) { return self.columns[d].name; })
            .on('click', function (d, i) {
                self.toggleSort(self.columns[d], d3.event);
            });

        // Create sorting function from options (can't sort yet, no data)
        this.setSortOrder(this.options.sortOrder);

        // Attach pagination placeholder
        if (this.options.paginateBy) {
            this.paginationParent = this._selectionOrFallback(
                this.options.paginationContainer,
                this.container
            );
            this.pagination = this.paginationParent
                .append("ul")
                .classed("tablemutt pagination", true);
        }

        // Attach "showing X of Y" info placeholder
        if (!_.isNull(this.options.showInfo)) {
            this.infoParent = this._selectionOrFallback(
                this.options.infoContainer,
                this.container
            );
            this.infoParent.select("span").remove();
            this.info = this.infoParent
                .append("span")
                .classed("tablemutt info", true);
        }
    };

    // if it's from ingestData then you want to reset this._filteredData, if not don't
    TableMutt.prototype._findGroups = function(data, ingestData){
        // when the function is being called from the initializing function ingestData
        // set the main data variable to contain the sorted version of the data produced below
        ingestData = ingestData || null;
        var group_by = this.options.groupBy;
        var new_filtered_data = [];
        if (!_.isEmpty(group_by)){
            // generate the mapping that will be used to group elements into different tbodies
            var group_map = _.reduce(data, function(map, host) {
                if (host.groups[group_by]) {
                    _.each(host.groups[group_by], function(subgroup) {
                        map[subgroup] = map[subgroup] || [];
                        // remove duplicate elements generated due to sorting
                        if (!_.contains((_.map(map[subgroup], function(val, key){
                            return val.name;})), host.name)){
                            map[subgroup].push(host);
                        }
                    });
                } else {
                    map.other = map.other || [];
                    map.other.push(host);
                }
                return map;
            }, {});

            this.options.tableGroups = Object.keys(group_map).sort();

            // reset global data variable to a sorted list based on found groups
            if (ingestData){
                _.each(_.without(this.options.tableGroups, "other"), function(group){
                    new_filtered_data.push(group_map[group]);
                });
                if (!_.isUndefined(group_map.other)){
                    new_filtered_data.push(group_map.other);
                }
                this._filteredData = _.flatten(new_filtered_data);
            }
            return group_map;
        }
        return {};
    };

    TableMutt.prototype._escapeSelector = function(selector){
        var escape_list = ("~ ! @ $ % ^ & * ( ) _ + - = , . / ' ; : ? > < [ ] \ { } | ` #").split(" ");
        var first = true;
        var new_selector_list = _.map((selector).split(""), function(key){
            if (_.contains(_.range(10), parseInt(key))){
                if (first){ // if selector starts with a number add "id" before it
                    key = "id" + key;
                }
            } else {
                if (_.contains(escape_list, key)){ // if it contains any nonacceptable characters, escape them
                    key = "\\" + key;
                }
            }
            first = false;
            return key;

        });
        return new_selector_list.join("");
    };

    TableMutt.prototype._initializeTable = function(){
        var self = this;
        var table = this.table;
        var col_len = this.columnOrder.length;
        var group_by = this.options.groupBy;
        var temp_group;

        // Add tbody elements for each separate tag group found
        function add_tbodies_headings(group){
            // escape invalid characters for jquery selectors
            if (_.contains(_.range(10), parseInt(group.slice(0,1)))){
                temp_group = "id" + group;
            } else {
                temp_group = group;
            }
            // add appropriate classes and ids to DOM elements
            var curr_group_name = table.append("tr")
                .classed("groupName", true)
                .attr("id", temp_group)
                .append("td")
                .attr("colspan", col_len);
            var curr_group_tbody = table.append("tbody").classed(temp_group, true);

            // Add appropriate group heading
            if (_.isEqual(group, "user_tag")){
                curr_group_name.html(group_by + ":");
            } else if (_.isEqual(group, "other")){
                curr_group_name.html("Hosts without '" + group_by + "' tag");
            } else {
                curr_group_name.html(group_by + ":" + group);
            }
        }

        if (!_.isEmpty(group_by)){
            // add tbodies and headings for each group
            _.each(_.without(this.options.tableGroups, "other").sort(), function(group){
                add_tbodies_headings(group);
            });
            // ensure other is always the last tbody that is added
            add_tbodies_headings("other");
        } else { // if there is no tag to filter by, append just one tbody for all
            this.tbody = table.append("tbody");
        }
    };

    TableMutt.prototype._resetTable = function(group_by){
        if (_.isEqual(group_by[0], "")){
            group_by = [];
        }
        this.options.groupBy = group_by;
        this.table.selectAll("tbody").remove();
        this.table.selectAll(".groupName").remove();
    };

    TableMutt.prototype._selectionOrFallback = function (selector, fallback) {
        if (_.isNull(selector)) {
            return fallback;
        }
        var match = d3.select(selector);
        if (!match.empty()) {
            return match;
        } else {
            return fallback;
        }
    };

    TableMutt.prototype._makeStringSorter = function (direction, transform) {
        if (_.isEqual(direction, ASCENDING)) {
            return function (a, b) {
                return transform(a).localeCompare(transform(b));
            };
        } else if (_.isEqual(direction, DESCENDING)) {
            return function (a, b) {
                return transform(b).localeCompare(transform(a));
            };
        }
    };

    TableMutt.prototype._makeSorter = function (direction, transform) {
        var lowerCaseTransform = function (x) { return x.toLocaleLowerCase(); };
        var compVal = (_.isEqual(direction, ASCENDING)) ? 1 : -1;
        return function (a, b) {
            var aval = transform(a);
            var bval = transform(b);

            if (_.isString(aval) && _.isString(bval)) {
                return (TableMutt.prototype._makeStringSorter(direction, lowerCaseTransform))(aval, bval);
            }

            if (aval > bval) { return compVal; }
            else if (aval < bval) { return -1*compVal; }
            else { return 0; }
        };
    };

    TableMutt.prototype._makeNoopTransform = function (id) {
        return function (datum) {
            if(datum.hasOwnProperty(id)) {
                return datum[id];
            } else {
                return null;
            }
        };
    };

    TableMutt.prototype._makeMultiSorter = function () {
        var self = this;
        return function (a, b) {
            var cmp = 0;
            var idx = 0;
            while (_.isEqual(cmp, 0) && idx < self._sorters.length) {
                cmp = self._sorters[idx](a, b);
                idx++;
            }
            return cmp;
        };
    };

    TableMutt.prototype._defaultFormat = function (transformed, elem, d) {
        if (_.isNumber(transformed)) {
            if (!_.isFinite(transformed)) {
                return "n/a";
            } else {
                return transformed.toFixed(2);
            }
        } else if (_.isUndefined(transformed) || _.isNull(transformed)) {
            return "n/a";
        } else {
            return transformed.toString();
        }
    };

    TableMutt.prototype.setSortOrder = function (sortOrder) {
        var self = this;
        self._sorters = [];

        // Clear sort order indicators
        self.theadRow.selectAll("th").classed("ascending descending", false);

        _.each(sortOrder, function (elem, idx, list) {
            // Push sorting functions onto the _sorters array in order
            var columnId, direction;
            if (_.isEqual(elem[0], "-")) {
                columnId = elem.slice(1);
                direction = DESCENDING;
            } else {
                columnId = elem;
                direction = ASCENDING;
            }

            // Don't want to unset headers marked on prev iterations
            self.theadRow.selectAll("th:not(.ascending)")
                .classed("ascending", function (d, i) {
                    return _.isEqual(d, columnId) && direction;
                });
            self.theadRow.selectAll("th:not(.descending)")
                .classed("descending", function (d, i) {
                    return _.isEqual(d, columnId) && (!direction);
                });

            var sorter;
            var transform = self.columns[columnId].transform;
            if (self.columns[columnId].hasOwnProperty("compare")) {
                // Let user override comparison
                sorter = function (a, b) {
                    if (_.isEqual(direction, ASCENDING)) {
                        return self.columns[columnId].compare(a, b);
                    } else {
                        return self.columns[columnId].compare(b, a);
                    }
                };
            } else {
                // Default to comparing transformed vals
                sorter = self._makeSorter(direction, transform);
            }
            self._sorters.push(sorter);
        });
    };

    TableMutt.prototype.toggleSort = function (col, evt) {
        var self = this;
        if (_.isNull(col.sorted) || _.isEqual(col.sorted, DESCENDING)) {
            col.sorted = ASCENDING;
            this.setSortOrder([col.id]);
        } else {
            this.setSortOrder(["-" + col.id]);
            col.sorted = DESCENDING;
        }
        this.sort();
        this.showPage(0);
    };

    TableMutt.prototype.sort = function () {
        this._filteredData.sort(this._makeMultiSorter());
        this.generateSearchIndex();
    };

    TableMutt.prototype.ingestData = function (rows) {
        var self = this;
        this._filteredData = rows;
        // _findGroups will sort the data in the order necessary for
        // accurate pagination
        this._findGroups(this._filteredData, true);
        this._data = this._filteredData;
        if (_.isEmpty(this.options.groupBy)){
            this.sort();
        }
        if (this.options.paginateBy) {
            this.initPagination();
        }
        if (this.options.textFilter) {
            this.generateSearchIndex();
        }
    };

    // print out the group of each row in the table, useful for debugging
    TableMutt.prototype.arrayToString = function (arr){
        var group_by = this.options.groupBy;
        var array = _.map(arr, function(row){
            if (!_.isEmpty(group_by)){
                if (row.groups[group_by]){
                    return row.groups[group_by][0];
                } else {
                    return null;
                }
            }
        });
        return array;
    };

    TableMutt.prototype.isEmpty = function () { return _.isEmpty(this._displayRows); };

    TableMutt.prototype.load = function (rows) {
        var self = this;
        search_callback();
        this.ingestData(rows);
        this._initializeTable();
        this.showPage(0);
        this._loadingPlaceholder.remove();

        // Unhide the elements we've been generating
        this.container.style("display", "block");

        if (this.options.loadCompleteCallback) {
            this.options.loadCompleteCallback();
        }
    };

    TableMutt.prototype.update = function (rows) {
        var page = this._currentPage;
        var oldSelectedRow = this.selectedRow;

        this.ingestData(rows);
        if (this.options.textFilter) {
            this._filteredData = this._applyTextFilter(this.getFilterTokens());
        }
        if (this.options.paginateBy && page < this.pages.length) {
            this.showPage(page);
        } else {
            this.showPage(0);
        }

        // if former selected row is still on this page, ensure it's selected
        if (!_.isNull(this.rowKeyToIndex(oldSelectedRow)) && !this.options.skipRowReselect) {
            this.selectRow(oldSelectedRow);
        }
    };

    TableMutt.prototype.initPagination = function () {
        var self = this;
        this.pagination.selectAll("li").remove();

        // How many pages are there?
        var pages = Math.max(
            Math.ceil(this._filteredData.length / this.options.paginateBy),
            1
        ); // ensure at least 1 page
        this.pages = _.range(pages);

        // Add the appropriate controls
        //  - Previous Page
        this.pagePrevious = this.pagination.append("li")
            .classed("tablemutt previous navigate", true)
            .html(this.options.previousButtonContent);

        if (!_.isEqual(this.pages.length, 1)) {
            this.pagePrevious
                .on('click', function (d, i) {
                    d3.event.preventDefault();
                    self.prevPage();
                    return false;
                });
            $$('.panel').swipeRight(function() {
                self.prevPage();
                return false;
            });
        } else {
            this.pagePrevious.classed("disabled", true);
        }

        //  - Page Numbers
        if (this.options.showPages) {
            this.pagination.selectAll("li:not(.navigate)")
                .data(this.pages)
                .enter()
                .append("li").classed("pagenumber", true)
                .text(function (d, i) { return (d + 1).toString(); })
                .on("click", function (d, i) {
                    d3.event.preventDefault();
                    self.choosePage(d);
                    return false;
                });
        }

        //  - Next Page
        this.pageNext = this.pagination.append("li")
            .classed("tablemutt next navigate", true)
            .html(this.options.nextButtonContent);

        // - Insert the placeholders for skipped pages
        if(this.options.showPages) {
            var pagelist = this.pagination[0][0];
            var pagelinks = this.pagination.selectAll('li:not(.navigate)')[0];

            this.lowSkip = d3.select(document.createElement('li'))
                            .classed('skipped_page skipped_low', true)
                            .html(this.options.skippedPageContent);
            pagelist.insertBefore(this.lowSkip[0][0], pagelinks[0].nextSibling);

            this.highSkip = d3.select(document.createElement('li'))
                            .classed('skipped_page skipped_high', true)
                            .html(this.options.skippedPageContent);
            pagelist.insertBefore(this.highSkip[0][0], pagelinks[this.pages.length - 1]);
        }

        if (!_.isEqual(this.pages.length, 1)) {
            this.pageNext
                .on('click', function (d, i) {
                    self.nextPage();
                    return false;
                });
            $$('.panel').swipeLeft(function() {
                self.nextPage();
                return false;
            });
        } else {
            this.pageNext.classed("disabled", true);
        }

        // disable selecting text of the buttons if they're double-clicked
        this.pagination.selectAll("li")
            .on('mousedown', function (d, i) {
                d3.event.preventDefault();
            });
    };

    TableMutt.prototype._pageToBounds = function (pagenum) {

        var from = this.options.paginateBy * this._currentPage;
        var to = Math.min(
            this.options.paginateBy * (this._currentPage + 1),
            this._filteredData.length
        );
        return {from: from, to: to};
    };

    TableMutt.prototype._pageForRow = function (key) {
        var self = this;
        var foundRow = _.find(this._filteredData, function (row) {
            return _.isEqual(self.options.keyFunction(row), key);
        });
        if (!foundRow) {
            return null;
        }
        var rowIdx = this._filteredData.indexOf(foundRow);
        var page;
        if (rowIdx >= this.options.paginateBy) {
            return Math.floor(rowIdx / this.options.paginateBy);
        } else {
            return 0;
        }
    };

    TableMutt.prototype.hidePagination = function () {
        this.pagination.selectAll("li")
            .style("display", "none");
    };

    TableMutt.prototype.showPagination = function () {
        this.pagination.selectAll("li")
            .style("display", null);
    };

    TableMutt.prototype.choosePage = function (pagenumber) {
        if (this.selectedRow) {
            this.deselectRow();
        }
        this.showPage(pagenumber);
    };

    TableMutt.prototype.showPage = function (pagenumber, callback) {
        var self = this,
            lastPage,
            maxPageLinks = this.options.maxPageLinks,
            pageSpan = maxPageLinks - 1,
            minlink,
            maxlink;
        var group_by = this.options.groupBy;
        if (!this.options.paginateBy) {
            this._displayRows = this._filteredData;
            this.updateDisplay(callback);
            return;
        }

        if (this.options.showPages) {
            lastPage = this.pages.length - 1;
            maxlink = Math.floor(pagenumber + maxPageLinks/2);
            minlink = maxlink - (pageSpan);
            // adjust for ends of range
            if(minlink < 0) {
                minlink = 0;
                maxlink = pageSpan;
            }
            if(maxlink > lastPage) {
                maxlink = lastPage;
                minlink = maxlink - pageSpan;
            }
            // show/hide skipped page indicators
            this.lowSkip.classed('hidden', minlink <= 1);
            this.highSkip.classed('hidden', maxlink >= lastPage - 1);
        }

        this._currentPage = pagenumber;

        var bounds = this._pageToBounds(this._currentPage);
        var to = bounds.to, from = bounds.from;
        this._displayRows = this._filteredData.slice(from, to);
        this.pagination.selectAll(".pagenumber").classed("active", function (d, i) {
            return _.isEqual(d, pagenumber);
        }).classed('hidden', function(d, i){
            if(!self.options.showPages) {return;}
            // hide if outside of minlink - maxlink range
            // always show first and last page
            return ( (i < minlink && !_.isEqual(i, 0)) || (i > maxlink && !_.isEqual(i, lastPage)));
        });
        // disable Next if last page
        this.pageNext.classed("disabled", _.isEqual(this._currentPage, (this.pages.length - 1)));

        // disable Previous if first page
        this.pagePrevious.classed("disabled", _.isEqual(this._currentPage, 0));
        this.updateDisplay(callback);
    };

    TableMutt.prototype.nextPage = function () {
        if (this._currentPage + 1 < this.pages.length) {
            this.choosePage(this._currentPage + 1);
        }
    };

    TableMutt.prototype.prevPage = function () {
        this.deselectRow();
        if (this._currentPage > 0) {
            this.choosePage(this._currentPage - 1);
        }
    };

    TableMutt.prototype.rowKeyToIndex = function (key) {
        var self = this;
        var currentIdx;
        if (!key) { return null; }
        _.find(this._displayRows, function (row, idx) {
            if (_.isEqual(self.options.keyFunction(row), key)) {
                currentIdx = idx;
                return true;
            } else {
                return false;
            }
        });
        return currentIdx;
    };

    TableMutt.prototype.getSelectedRow = function () {
        if (this.selectedRow) {
            return this._displayRows[this.rowKeyToIndex(this.selectedRow)];
        } else {
            return null;
        }
    };

    TableMutt.prototype.toggleRow = function (key) {
        if (_.isEqual(key, this.selectedRow)) {
            this.deselectRow(null);
        } else {
            this.selectRow(key);
        }
    };

    TableMutt.prototype.selectRow = function (key) {
        var self = this;
        if (this.selectedRow && !_.isEqual(this.selectedRow, key)) {
            this.deselectRow(this.selectedRow);
        }
        this.selectedRow = key;
        var select_row = function() {
            var selected = self.table.select("tr#" + self.selectedRow);
            selected.classed("active", true);

            if (self.options.rowSelectedCallback) {
                selected.each(function (d, i) {
                    self.options.rowSelectedCallback(this, d);
                });
            }
        };

        var rowPage = self._pageForRow(key);
        if (self.options.paginateBy && !_.isEqual(self._currentPage, rowPage) && !_.isNull(rowPage)) {
            self.showPage(self._pageForRow(key), select_row);
        } else {
            select_row();
        }
    };

    TableMutt.prototype._deselectIfMissing = function () {
        // if row disappears in an update or pagination change, we
        // want to deselect it
        if (_.isNull(this.rowKeyToIndex(this.selectedRow))) {
            this.deselectRow();
        }
    };

    TableMutt.prototype.deselectRow = function (nextSelectionKey) {
        var self = this;
        if (_.isNull(this.selectedRow)) {
            return;
        }
        var selected = this.table.select("tr#" + this.selectedRow);
        if (selected.empty()) {
            // selection's DOM element might already be removed
            if (this.options.rowDeselectedCallback) {
                this.options.rowDeselectedCallback(null, null, nextSelectionKey);
            }
        } else {
            selected.classed("active", false);
            if (this.options.rowDeselectedCallback) {
                selected.each(function (d, i) {
                    self.options.rowDeselectedCallback(this, d, nextSelectionKey);
                });
            }
        }
        this.selectedRow = null;
    };

    TableMutt.prototype.selectNextRow = function () {
        var self = this;
        // don't try to do anything if we aren't showing any data rows
        if (_.isEmpty(this._displayRows)) {
            return;
        }

        // if no selected row, select first in _displayRows and return
        if (!this.selectedRow) {
            var firstDisplayed = this._displayRows[0];
            this.selectRow(this.options.keyFunction(firstDisplayed));
            return;
        }

        // search displayed rows for current selected row idx
        var currentIdx = this.rowKeyToIndex(this.selectedRow);

        var toSelect;
        if (currentIdx + 1 < this._displayRows.length) {
            toSelect = this._displayRows[currentIdx + 1];
            this.selectRow(this.options.keyFunction(toSelect));
        } else {
            // if not, check if another page available
            if (this.options.paginateBy && this._currentPage + 1 < this.pages.length) {
                // if yes, continue to next page and select first
                this.showPage(this._currentPage + 1);
            } else {
                // if no, are we on page 0?
                if (!_.isEqual(this._currentPage, 0)) {
                    // if no, switch to page 0 and then select first
                    this.showPage(0);
                }
                // if yes, loop around to top
            }
            toSelect = this._displayRows[0];
            this.selectRow(this.options.keyFunction(toSelect));
        }
    };

    TableMutt.prototype.selectPreviousRow = function () {
        var self = this;
        // don't try to do anything if we aren't showing any data rows
        if (_.isEmpty(this._displayRows)) {
            return;
        }

        // if no selected, select last in display and return
        if (!this.selectedRow) {
            var lastDisplayed = this._displayRows[this._displayRows.length - 1];
            this.selectRow(this.options.keyFunction(lastDisplayed));
            return;
        }

        // search displayed rows for current selected row idx
        var currentIdx = this.rowKeyToIndex(this.selectedRow);

        var toSelect;
        if (currentIdx - 1 >= 0) {
            // select prev row if possible
            toSelect = this._displayRows[currentIdx - 1];

            this.selectRow(this.options.keyFunction(toSelect));
        } else {
            if (this.options.paginateBy && this.pages.length > 1) {
                // select prev page if possible
                if (this._currentPage - 1 >= 0) {
                    this.showPage(this._currentPage - 1);
                } else {
                    // otherwise wrap around and select last page
                    this.showPage(this.pages.length - 1);
                }
            }
            // select last row on page (current or newly shown)
            toSelect = this._displayRows[this._displayRows.length - 1];
            this.selectRow(this.options.keyFunction(toSelect));
        }
    };

    TableMutt.prototype.initTextFilter = function () {
        var self = this;
        // calling init twice shouldn't give two boxes
        this.filterBar.selectAll("input").remove();

        search_callback = function () {
                self.filterBar.classed("loading", true);
                if (!_.isNull(self._searchTimeout)) {
                    window.clearTimeout(self._searchTimeout);
                }
                self._searchTimeout = window.setTimeout(function () {
                    self.updateTextFilter(d3.event);
                }, 200);
            };

        this.filterBar.append("input")
            .classed("tablemutt textfilter", true)
            .attr("type", "search")
            .attr("placeholder", this.options.filterbarPlaceholderText)
            .on("input", search_callback);
    };

    TableMutt.prototype.generateSearchIndex = function () {

        var self = this;
        // _searchData -- array of strings to match against
        this._searchData = _.map(self._data, function (d) {
            // generate searchable reprs of each col
            var searchables = _.map(self.columns, function (col, key) {
                if (col.hasOwnProperty("searchable")) {
                    return col.searchable(col.transform(d), d);
                } else {
                    // null because no current DOM element
                    return self._defaultFormat(col.transform(d), null, d);
                }
            });
            // combine for a searchable repr of the row
            return searchables.join(" ").toLocaleLowerCase();
        });
    };

    TableMutt.prototype._applyTextFilter = function (tokens) {
        var self = this;
        var display = [];
        _.each(this._data, function (elem, idx, list) {
            var match = true;
            _.each(tokens, function (token) {
                match = match && !_.isEqual(self._searchData[idx].indexOf(token), -1) ? true : false;
            });
            if (match) {
                display.push(elem);
            }
        });
        return display;
    };

    TableMutt.prototype.getFilterTokens = function () {
        var search = this.filterBar.select("input").property("value");
        if (this.options.cleanSearchString) {
            search = this.options.cleanSearchString(search);
        }

        var tokens = [];
        _.each(search.split(" "), function (elem) {
            if (!_.isEmpty(elem.trim())) {
                tokens.push(elem.toLocaleLowerCase());
            }
        });
        return tokens;
    };

    TableMutt.prototype.updateTextFilter = function () {
        var self = this;
        var tokens = this.getFilterTokens();

        this.filterBar.classed("loading", false);
        // If we no longer want to filter anything, restore to initial state
        if (_.isEmpty(tokens)){
            this._filteredData = this._data;
            this.setSortOrder(this.options.sortOrder);
        } else {
            this._filteredData = this._applyTextFilter(tokens);
        }
        if (this.options.paginateBy) {
            this.initPagination();
        }
        this.showPage(0);
        // clear selection if row no longer visible
        this._deselectIfMissing();
    };

    TableMutt.prototype.clearTextFilter = function () {
        var self = this;

        self.filterBar.select("input").property("value", "");
    };

    TableMutt.prototype.renderRows = function () {
        var self = this;
        var trs = "";
        var group_by = this.options.groupBy;

        function add_trelems_data(trelems, element_list){
            trelems
                .datum(function (prevdat, i) {
                    return element_list[i];
                });

            if (self.options.keyFunction) {
                trelems
                    .attr("id", function (d) {
                        return self.options.keyFunction(d);
                    })
                    .on('click', function (d, i) {
                        self.toggleRow(self.options.keyFunction(d));
                    });
            }

            if (!_.isNull(self.options.formatRow)) {
                trelems.each(function (d, i) {
                    self.options.formatRow(d, this);
                });
            }

            trelems.selectAll("td")
                .data(function (d) {
                    // Transform the object for the row into a sequence of values (1 per column)
                    return self.columnOrder.map(function (colId) {
                        return {transformed: self.columns[colId].transform(d), original: d};
                    });
                })
                .enter()
                .append("td")
                .each(function (d, i) {
                    var column = self.columns[self.columnOrder[i]];
                    var d3elem = d3.select(this);
                    d3elem.classed(column._classes, true);
                    if (_.has(column, "format")) {
                        var formatted = column.format(d.transformed, this, d.original);
                        if (_.isString(formatted)) {
                            d3elem.html(formatted);
                        }
                        // otherwise we assume the formatter manipulated the DOM
                        // itself.
                    } else {
                        d3elem.html(self._defaultFormat(d.transformed, this, d.original));
                    }
                });

            // to prevent the click-to-select-row behavior causing unexpected
            // behavior when clicking a link, attach a handler that stops
            // propagation
            trelems
                .selectAll("a[href]")
                .on("click", function (d, i) {
                    d3.event.stopPropagation();
            });
        }
        if (!_.isEmpty(group_by)){ // separate data rows by tag group
            var table = this.table;
            // find the relevant groups for the data needing displaying
            var groups = this._findGroups(self._displayRows);
            _.each(groups, function(rows, group_name){
                // find each tbody/heading corresponding to a particular group and add rows to it
                var selector = self._escapeSelector(group_name);
                var id_selector = "#" + selector;
                var class_selector = "." + selector;
                trs = _.range(rows.length)
                    .map(function(){ return "<tr></tr>"; })
                    .join('\n');
                var group_heading = d3.select("tr" + id_selector);
                var group_tbody = d3.select("tbody" +  class_selector);
                group_tbody.html(trs);
                var trelems = group_tbody.selectAll("tr");
                add_trelems_data(trelems, rows);
                // show the group tbody and heading
                group_tbody.style("display", null);
                group_heading.style("display", null);
            });

            //hide all tbodies and headings with no elements
            var tbodies = table.selectAll("tbody");
            _.each(tbodies[0], function(tbody){
                if (_.isEqual($(tbody).children().length, 0)) {
                $(tbody).css("display", "none");
                    d3.select("#" + self._escapeSelector($(tbody).attr('class'))).style("display", "none");
                }
            });
        } else { // if no grouping tag is selected, add all the rows to one tbody
            d3.select("tbody").style("display", null);
            trs = _.range(this._displayRows.length)
                .map(function(){ return "<tr></tr>"; })
                .join('\n');
            this.tbody.html(trs);
            var trelems = this.tbody.selectAll("tr");
            add_trelems_data(trelems, self._displayRows);
        }
    };

    TableMutt.prototype.updateDisplay = function (callback) {
        var self = this;
        var no_rows_message = this.table.select(".no_rows_message")[0][0];
        this.table.selectAll("tbody").selectAll("tr").remove();

        if (_.isEmpty(this._filteredData)) {

            // hide all existing groups
            this.table.selectAll("tbody").style("display", "none");
            this.table.selectAll(".groupName").style("display", "none");

            // check that the message isn't already there
            if (!no_rows_message){
                var messageTd = this.table.append("tr")
                    .append("td")
                    .attr("colspan", this.columnOrder.length)
                    .classed("no_rows_message", true);
                if (_.isEmpty(this._data)) {
                    messageTd.html(this.options.emptyContent);
                } else {
                    messageTd.html(this.options.filterEmptyContent);
                }
            }
        } else {
            if (no_rows_message){
                no_rows_message.remove();
            }
            this.table.selectAll("tbody").style("display", null);
            this.renderRows();

        }

        this.updateInfoText();
        if (this.options.renderCompleteCallback) {
            this.options.renderCompleteCallback();
        }
        if (callback) {
            callback();
        }
    };

    TableMutt.prototype.updateInfoText = function () {
        if (!this.options.showInfo) {
            return;
        }
        var message = "";
        if (!this.options.paginateBy) {
            if (!_.isEqual(this._filteredData.length, this._data.length)) {
                message = "Showing " + this._filteredData.length + " of " + this._data.length + " entries";
            } else {
                message = "Showing all " + this._data.length + " entries";
            }
        } else {
            var bounds = this._pageToBounds(this._currentPage);
            var from = bounds.from + 1, to = bounds.to;
            var total = this._filteredData.length;
            if (_.isEmpty(this._filteredData)) {
                message = "";
            } else if (_.isEqual(from, 1) && _.isEqual(to, this._data.length)) {
                if (_.isEqual(to, 1)) {
                    message = "Showing the only entry.";
                } else {
                    message = "Showing all " + total + " entries.";
                }
            } else if (_.isEqual(from, 1) && _.isEqual(to, this._filteredData.length)) {
                if (_.isEqual(to, 1)) {
                    message = "Showing the only matching entry.";
                } else {
                    message = "Showing all " + total + " matching entries.";
                }
            } else if (_.isEqual(this._filteredData.length, this._data.length)) {
                message = "Showing " + from + " to " + to + " of " + total + " entries.";
            } else {
                message = "Showing " + from + " to " + to + " of " + total + " matching entries.";
            }
        }
        this.info.text(message);
    };


    window.TableMutt = TableMutt;
}());
