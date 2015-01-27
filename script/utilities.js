var fs = require("fs");
var http = require('http');
var exports = module.exports = {};

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