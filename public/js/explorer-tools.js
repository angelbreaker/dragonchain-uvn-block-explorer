var node = {
	public_id: null,
	node_level: null,
	dragonchain_version: null,
	block_height: null,
	block_count_day: null,
	last_block: null,
	last_block_id: null,
	last_block_timestamp: null,
	last_block_date: null,
	time_at_last_block: null,
	distinct_l1s: null,
	last_update: null,
	initialized: false
}

var config = {
	blocks_per_pull: 5000, // Stupid IE/Edge
	ping_delay: 15000,	
	current_chart: null,
	current_block_displayed: null
}

/* 
TO ADD: 24 Hour block count across ALL nodes 

db.getDB().then(async function (instance) {
    var start = parseInt(new Date().getTime() / 1000) - (24*60*60)
	var allblocks = await instance.blocks.where("timestamp").aboveOrEqual(start).toArray()
	console.log(allblocks.length)
});
*/


var tools = {	
	refreshUI: function () {
		$("#public-id").html(node.public_id);
		$("#dc-node-level").html(node.node_level);
		$("#dc-version").html(node.dragonchain_version);

		if (node.last_block)
		{
			$("#last-block-date").html(node.last_block_date);
			$("#dc-time-at-last-block").html(node.time_at_last_block);			
			$("#block-height").html(node.block_height);
			$("#block-count-day").html(node.block_count_day);			
		}

		$("#loading").addClass("d-none");
		$("#node-info").removeClass("d-none");
	},
	setAppState: function (state) {
		$("#app-state").html(state);
	},
	getStatus: async function () {
		return $.ajax({
			url: "/get-status",
			method: "POST",
			data: {
				credentials_secure: window.localStorage.credentials_secure
			},				
			dataType: "html"
		})	
			.always(function (data) {
				tools.refreshUI();
			})

	},
	fetchBlockById: async function (block_id) {
		return $.ajax({
			url: "/get-block-by-id",
			method: "POST",
			data: {
				credentials_secure: window.localStorage.credentials_secure,
				id: block_id
			},				
			dataType: "html"
		})	
	},
	getBlocksSequential: async function (start_block_id, max_blocks) {

		var max_block_id = start_block_id + max_blocks;

		var blocks = [];

		var done = false;

		while (!done)
		{
			try {
				tools.setAppState("Retrieving block #" + start_block_id);
				var response = JSON.parse(await tools.fetchBlockById(start_block_id));

				if (typeof response.error != "undefined")
				done = true;
				else
				{
					blocks.push(response);

					start_block_id++;

					if (start_block_id == max_block_id)
						done = true;
				}
				
			} catch (exception)
			{
				done = true;
			}
		}

		return blocks;

	},
	getBlocksChunk: async function (start_timestamp)
	{
		return $.ajax({
			url: "/get-blocks",
			method: "POST",
			data: {
				credentials_secure: window.localStorage.credentials_secure,
				start_timestamp: start_timestamp
			},				
			dataType: "html"
		})	
	},
	getBlocks: async function (start_timestamp, max_blocks, total_pulled) {	
		
		if (typeof total_pulled == "undefined")
			total_pulled = 0;

		var chunk = JSON.parse(await tools.getBlocksChunk(start_timestamp));

		if (chunk.blocks_remaining > 0 && (total_pulled + chunk.blocks.length + 50 <= max_blocks))
		{					
			//await sleep(500);
			tools.setAppState("Retrieving new blocks (" + chunk.blocks_remaining + " left)");
			return chunk.blocks.concat(await tools.getBlocks(chunk.last_timestamp, max_blocks, total_pulled + chunk.blocks.length));
		} else {			
			return chunk.blocks;
		}
	},

	processBlocks: function (new_blocks) {
		if (new_blocks && new_blocks.length > 0)											
		{
			// Update the database //													
			db.addBlocks(new_blocks)
				.then(function () {																		
					// Update last block and chart data //
					tools.updateLastBlock(new_blocks[new_blocks.length-1]);
					tools.updateBlocksLastDay();
					tools.updateChart();

					tools.setAppState("Last check: " + moment().format("LTS"));

					tools.refreshUI();

					setTimeout(ping, config.ping_delay);
				});
			
		} else {													
			if (!node.initialized)
			{
				node.last_update = moment.utc();								
				node.initialized = true;

				tools.updateLastBlock();
				tools.updateBlocksLastDay();
				tools.updateChart();														
			}

			if (node.last_block)
				node.last_block_date = moment(node.last_block.header.timestamp * 1000).format('lll') + "  (" + moment(node.last_block.header.timestamp * 1000).fromNow() + ")";

			tools.setAppState("Last check: " + moment().format("LTS"));

			tools.refreshUI();

			
		}
	},

	getTransaction: function (txn_id)
	{
		return $.ajax({
			url: "/get-transaction",
			method: "POST",
			data: {
				credentials_secure: window.localStorage.credentials_secure,
				txn_id: txn_id
			},				
			dataType: "html"
		})	
			
	},

	setTakaraPrice: function () {
		$.ajax({
			url: "/get-takara-price",
			method: "GET",			
			dataType: "html"
		}).then(function (data) {
			let dj = JSON.parse(data);

			$("#takara-price").html(dj.takara_price);
		})
	},
	updateDistinctL1s: function () {
		db.findBlocksByTimestampAboveOrEqual(node.public_id, 0)
			.then(function (list) {    
				const distinctL1s = [...new Set(list.map(x => x.block.validation.dc_id))]
				node.distinct_l1s = distinctL1s.length;
				$("#distinct-l1s").html(node.distinct_l1s);
			})
	},
	updateLastBlock: function (block) {		
		if (block !== undefined)
		{
			node.last_block = block;
			node.last_block_id = Number(block.header.block_id);
			node.last_block_timestamp = Number(block.header.timestamp);
			node.block_height = block.header.block_id;
			node.last_block_date = moment(block.header.timestamp * 1000).format('lll') + " (" + moment(block.header.timestamp * 1000).fromNow() + ")";
			node.time_at_last_block = block.header.current_ddss;		
			//tools.updateDistinctL1s();						
			tools.updateBlockBrowserList();
			tools.refreshUI();					
		} else {
			// Get the latest block and update node stats //
			db.findLastBlock(node.public_id)
				.then(function (result) {								
					if (result)
					{					
						block = result.block;					
						node.last_block = block;
						node.last_block_id = Number(block.header.block_id);
						node.block_height = block.header.block_id;
						node.last_block_date = moment(block.header.timestamp * 1000).format('lll') + " (" + moment(block.header.timestamp * 1000).fromNow() + ")";
						node.time_at_last_block = block.header.current_ddss;					
						//tools.updateDistinctL1s();
						tools.refreshUI();					
					} 
				}).catch(function (err) {
					console.log(err)										
				})
		}

		if (config.current_block_displayed === null && node.last_block !== null)
		{
			config.current_block_displayed = node.last_block;			
			tools.updateBlockDisplayed(node.last_block_id)
				.then(function (block) {tools.updateBlockBrowserList()});			
		}
	},
	updateBlockDisplayed: async function (block_id) {			
		db.getBlockById(node.public_id, block_id)
			.then(function (block_record) {								
				config.current_block_displayed = block_record.block;
				
				block = block_record.block;

				if (block.transactions)
				{
					for (var i =0; i < block.transactions.length; i++)
					{
						block.transactions[i] = JSON.parse(block.transactions[i]);

						block.transactions[i].header.txn_id = "<a href='#' class='view-transaction' rel='" + block.transactions[i].header.txn_id + "'>" + block.transactions[i].header.txn_id + "</a>";											
					}
				}

				$("#current-block").html(JSON.stringify(block, null, 2))
				return block_record.block;
			})
		
	},
	updateBlockBrowserList: function () {
		db.getBlocks(node.public_id, 50)
			.then(function (blocks) {								
				$("#block-list").html("");

				for (var i = 0; i < blocks.length; i++)
				{					
					let elem = $("<button class='list-group-item list-group-item-action btn-select-block' rel='" + blocks[i].block_id + "' />").text("Block #" + blocks[i].block_id)
					
					if (blocks[i].block_id == config.current_block_displayed.header.block_id)					
						elem.addClass("active")

					$("#block-list").append(elem);
				}
			})
	},
	updateChart: function () {
		// Get blocks for last x [timeframe] and draw //

		if (config.current_chart == "#chart-bymonth")
		{
			var start_timestamp = moment.utc().subtract(5, "months").startOf("month").format("X");
			
			db.findBlocksByTimestampAboveOrEqual(node.public_id, Number(start_timestamp))
				.then(function (result) {
					if (result && result.length > 0)
						tools.drawBlocksPerMonth(tools.parseBlocksByMonth(result), "6 Months")
				})		

		} else if (config.current_chart == "#chart-byweek")
		{
			var start_timestamp = moment.utc().subtract(11, "weeks").startOf("week").format("X");
			
			db.findBlocksByTimestampAboveOrEqual(node.public_id, Number(start_timestamp))
				.then(function (result) {
					if (result && result.length > 0)
						tools.drawBlocksPerWeek(tools.parseBlocksByWeek(result), "12 Weeks")
				})		

		} else if (config.current_chart == "#chart-byday")
		{		
			var start_timestamp = moment.utc().subtract(13, "days").startOf("day").format("X");
			
			db.findBlocksByTimestampAboveOrEqual(node.public_id, Number(start_timestamp))
				.then(function (result) {					
					if (result && result.length > 0)
						tools.drawBlocksPerDay(tools.parseBlocksByDay(result), "14 Days")
				})		
		} else if (config.current_chart == "#chart-byhour")
		{		
			var start_timestamp = moment.utc().subtract(23, "hours").startOf("hour").format("X");
			
			db.findBlocksByTimestampAboveOrEqual(node.public_id, Number(start_timestamp))
				.then(function (result) {
					if (result && result.length > 0)
						tools.drawBlocksPerHour(tools.parseBlocksByHour(result), "24 Hours")
				})		
		}
	},
	drawBlocksPerMonth: function (block_groups, time_frame) {

		// Create the data table.
		var data = new google.visualization.DataTable();
		data.addColumn('string', 'Month');
		data.addColumn('number', 'Blocks');

		block_groups.forEach(function (element) {
			data.addRow([element.month, element.times.length])
		})

		// Set chart options
		var options = {'title':'Blocks by Month - ' + time_frame, 'width':'100%', 'height':450};
		// Instantiate and draw our chart, passing in some options.
		var chart = new google.visualization.ColumnChart(document.getElementById('chart'));
		chart.draw(data, options);

	},
	drawBlocksPerWeek: function (block_groups, time_frame) {

		// Create the data table.
		var data = new google.visualization.DataTable();
		data.addColumn('string', 'Week Of');
		data.addColumn('number', 'Blocks');

		block_groups.forEach(function (element) {
			data.addRow([element.day, element.times.length])
		})

		// Set chart options
		var options = {'title':'Blocks by Week - ' + time_frame, 'width':'100%', 'height':450};
		// Instantiate and draw our chart, passing in some options.
		var chart = new google.visualization.ColumnChart(document.getElementById('chart'));
		chart.draw(data, options);

	},
	drawBlocksPerDay: function (block_groups, time_frame) {

		// Create the data table.
		var data = new google.visualization.DataTable();
		data.addColumn('string', 'Day');
		data.addColumn('number', 'Blocks');

		block_groups.forEach(function (element) {
			data.addRow([element.day, element.times.length])
		})

		// Set chart options
		var options = {'title':'Blocks by Day - ' + time_frame, 'width':'100%', 'height':450};
		// Instantiate and draw our chart, passing in some options.
		var chart = new google.visualization.ColumnChart(document.getElementById('chart'));
		chart.draw(data, options);

	},
	drawBlocksPerHour: function (block_groups, time_frame) {

		// Create the data table.
		var data = new google.visualization.DataTable();
		data.addColumn('string', 'Hour');
		data.addColumn('number', 'Blocks');

		block_groups.forEach(function (element) {
			data.addRow([element.hour, element.times.length])
		})

		// Set chart options
		var options = {'title':'Blocks by Hour - ' + time_frame, 'width':'100%', 'height':450};
		// Instantiate and draw our chart, passing in some options.
		var chart = new google.visualization.ColumnChart(document.getElementById('chart'));
		chart.draw(data, options);

	},
	updateBlocksLastDay: function () {
		
		var start_timestamp = moment.utc().subtract(23, "hours").startOf("hour").format("X");
		
		db.findBlocksByTimestampAboveOrEqual(node.public_id, Number(start_timestamp))
			.then(function (result) {
				if (result && result.length > 0)
				{
					node.block_count_day = result.length;
					tools.refreshUI();
				}
			})		
	},
	parseBlocksByMonth: function (blocks) {
        const occurences = [];

        blocks.forEach(function (element) {
            occurences.push(element.block.header.timestamp * 1000);
        });

        return _.map(
            _.groupBy(occurences, function (timestamp) {
                return moment(timestamp).startOf('month').format("MMM Do");
            }),
            function (group, month) {
                return {month: month, times: group}
            }
        );
    },
	parseBlocksByWeek: function (blocks) {
        const occurences = [];

        blocks.forEach(function (element) {
            occurences.push(element.block.header.timestamp * 1000);
        });

        return _.map(
            _.groupBy(occurences, function (timestamp) {
                return moment(timestamp).startOf('week').format("MMM Do");
            }),
            function (group, day) {
                return {day: day, times: group}
            }
        );
    },
	parseBlocksByDay: function (blocks) {
        const occurences = [];

        blocks.forEach(function (element) {
            occurences.push(element.block.header.timestamp * 1000);
        });

        return _.map(
            _.groupBy(occurences, function (timestamp) {
                return moment(timestamp).startOf('day').format("MMM Do");
            }),
            function (group, day) {
                return {day: day, times: group}
            }
        );
    },
	parseBlocksByHour: function (blocks) {
        const occurences = [];

        blocks.forEach(function (element) {
            occurences.push(element.block.header.timestamp * 1000);
        });

        return _.map(
            _.groupBy(occurences, function (timestamp) {
                return moment(timestamp).startOf('hour').format("LT");
            }),
            function (group, hour) {
                return {hour: hour, times: group}
            }
        );
    },
	redirectToLogin: function () {
		document.location.href = "/login";
	}
} 

var sleep = function (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}