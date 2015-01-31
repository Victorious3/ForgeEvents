var fs = require("fs");
var http = require('http');
var exports = module.exports = {};

//String helper
if (!String.prototype.format) {
	String.prototype.format = function() {
		var args = arguments;
		return this.replace(/{(\d+)}/g, function(match, number) { 
			return typeof args[number] != 'undefined' ? args[number] : match;
		});
	};
}

if (!String.prototype.startsWith) {
	String.prototype.startsWith = function (str) {
		return this.indexOf(str) == 0;
	};
}

if (!String.prototype.endsWith) {
	String.prototype.endsWith = function(suffix) {
		return this.indexOf(suffix, this.length - suffix.length) !== -1;
	};
}

if (!String.prototype.contains) {
	String.prototype.contains = function(match) { 
		return this.indexOf(match) != -1; 
	};
}

/*
 * exit
 * https://github.com/cowboy/node-exit
 *
 * Copyright (c) 2013 "Cowboy" Ben Alman
 * Licensed under the MIT license.
 */
exports.exit = function(exitCode, streams) {
	if (!streams) { streams = [process.stdout, process.stderr]; }
	var drainCount = 0;
	function tryToExit() {
		if (drainCount === streams.length) {
			process.exit(exitCode);
		}
	}
	streams.forEach(function(stream) {
		if (stream.bufferSize === 0) {
			drainCount++;
		} else {
			stream.write("", "utf-8", function() {
				drainCount++;
				tryToExit();
			});
		}
		stream.write = function() {};
	});
	tryToExit();
	process.on("exit", function() {
		process.exit(exitCode);
	});
};

exports.downloadFile = function(url, dest, cb) {
	var file = fs.createWriteStream(dest);
	var request = http.get(url, function(response) {
		response.pipe(file);
		file.on('finish', function() {
			file.close(cb);
		});
	}).on('error', function(err) {
		fs.unlink(dest);
	});
};

exports.deleteFolderRecursive = function(path) {
	if(fs.existsSync(path)) {
	    fs.readdirSync(path).forEach(function(file,index){
	    	var curPath = path + "/" + file;
	    	if(fs.lstatSync(curPath).isDirectory()) {
	    		deleteFolderRecursive(curPath);
	    	} else {
	    		fs.unlinkSync(curPath);
	    	}
		});
	    fs.rmdirSync(path);
	}
};

parseCSVRow = function(row) {
	var columns = [];
	var index = 0;
	var index2 = row.indexOf(",");
	if (index2 != -1) {
		while (index < row.length) {
			if (index2 == -1) {
				var text = row.substring(index, row.length);
				columns.push(text.replace(/\\,/g, ","));
				break;
			}
			if (row.charAt(index2 - 1) == "\\") {
				index2 = row.indexOf(",", index2 + 1);
				continue;
			}
			
			var text = row.substring(index, index2);
			columns.push(text.replace(/\\,/g, ","));
			index = index2 + 1;
			index2 = row.indexOf(",", index);
		}
	} else {
		columns = [row];
	}
	return columns;
}

exports.parseCSVRow = parseCSVRow;

exports.parseCSV = function(csv) {
	var set = csv.split(/\n/);
	for (var key in set) {
		csv[key] = parseCSVRow(csv[key]);
	}
}