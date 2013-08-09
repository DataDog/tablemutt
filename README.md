# TableMutt from Datadog

Here at Datadog, a big part of our job is making big datasets
easier to navigate. We recently outgrew our 3rd party Javascript
sortable table plugin, and needed something lighter weight and 
more flexible.

Enter TableMutt, a lightweight and extensible sortable table widget.
We were able to noticeably improve performance on loading and rendering
data for tables on the order of 5000 rows, and the widget is now in
use throughout our product.

**As of this writing, the widget depends on
[Underscore.js](http://underscorejs.org/) and
[d3.js](http://d3js.org/).**

*Created by our [hackNY '13](http://hackny.org/) fellow, Joseph Long,
during his time at Datadog.*