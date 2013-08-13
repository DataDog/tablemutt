# TableMutt from Datadog
## A sortable table for large datasets

Here at Datadog, a big part of our job is making big datasets easier to
navigate. We recently outgrew our 3rd party Javascript sortable table plugin,
and needed something lighter weight and more flexible. 

Enter **TableMutt**, a lightweight and extensible sortable table widget.
TableMutt can separately customize the representation used for sorting, the
representation for text searching, and the actual displayed markup for a given
table column. You can also specify the `transform` function to pull out data
for a particular column, which defaults to getting the property whose name
matches the `id` property on the column.

**Simple Example: Characters from The Wire**

This example shows how to override the transform function that retrieves the
column value from the row object. For a more involved example, see demo.html in
this repo.

    var data = [
    	{name: "Jimmy McNulty", episodes: 56, desc: "Homicide Detective"},
    	{name: "Cedric Daniels", episodes: 58, desc: "Deputy Commissioner for Operations"},
    	{name: "Thomas \"Herc\" Hauk", episodes: 52, desc: "Defense investigator"},
    	{name: "William Rawls", episodes: 46, desc: "Police Commissioner"}
    ];

    var columns = [
    	{id: "name"},
    	{id: "desc", name: "Bio"}, // show a column title that's not the property
    	{
        id: "total",
        transform: function (d) {
          // transform the row object `d` into a cell value for this column
          return d.episodes;
        }
      }
    ];

    var options = {
    	sortOrder: ['-episodes', 'name']
    };

    var table = new TableMutt(
    	"#table_container", // element with this id to stick the <table> in
    	columns,
    	options
    );

    table.load(data);

**As of this writing, the widget depends on
[Underscore.js](http://underscorejs.org/) and [d3.js](http://d3js.org/).** It
has been tested with Underscore.js v. 1.5.1 and d3.js v.3, but may work with
older versions.

*Created by our [hackNY '13](http://hackny.org/) fellow, Joseph Long,
during his time at Datadog.*