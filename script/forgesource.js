var fs 		= require("fs");
var path 	= require("path");
var async 	= require("async");
var admzip 	= require("adm-zip");
var mysql 	= require("mysql");
var spawn 	= require('child_process').spawn;

var utils 	= require("./utilities.js");

var args = process.argv.slice(2);

//Import JSON configuration
var forgeconfig;
var config;

try {
	forgeconfig = JSON.parse(fs.readFileSync("forge.json", "utf-8"));
} catch (e) {
	console.error("Invalid Forge configuration file.");
	throw e;
}
try {
	config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
} catch (e) {
	console.error("Invalid configuration file.");
	throw e;
}

//Pre-parse configuration
for (var key in forgeconfig["versions"]) {
	var version = forgeconfig["versions"][key];
	version["fdirname"] = version["mcversion"] + "-" + version["forgeversion"];
	version["fdir"] = config.dataPath + "/" + version["fdirname"];
	version["forgedir"] = version["fdir"] + "/forge";
	version["zipfile"] = version["fdir"] + "/" + version["mcversion"] + "-" + version["forgeversion"] + ".zip";
}

//Generate minecraft version array
var versions = [];
for (var key in forgeconfig.versions) {
	versions.push(forgeconfig.versions[key].mcversion);
}

//Sort minecraft versions
versions.sort(function(a, b) {
	if (a === b) return 0;
	var acomp = a.split(".");
	var bcomp = b.split(".");
	var len = Math.max(acomp.length, acomp.length);
	for (var i = 0; i < len; i++) {
		var aval = acomp[i] || 0;
		var bval = bcomp[i] || 0;
		if (parseInt(aval) > parseInt(bval)) return 1;
		if (parseInt(aval) < parseInt(bval)) return -1;
	}
	return 0;
});

if (!fs.existsSync(config.dataPath)) fs.mkdirSync(config.dataPath);
var files = fs.readdirSync(config.dataPath);

var tasks = {
	downloadFiles : [downloadFiles],
	decompress : [downloadFiles],
	parseCSVPatches : [parseCSVPatches],
	applyCSVPatches : [applyCSVPatches],
	createDoclet : [createDoclet],
	createHTML : [createHTML],
	
	all : [downloadFiles, decompress, parseCSVPatches, createDoclet, applyCSVPatches, createHTML],
	update : [downloadFiles, decompress, parseCSVPatches, applyCSVPatches],
	csv : [parseCSVPatches, applyCSVPatches],
	doc : [createDoclet, createHTML]
}

var task = tasks.all;
if (args.length > 0) {
	if(args[0] in tasks) {
		task = tasks[args[0]];
	} else {
		console.error("Undefined task '" + args[0] + "'");
		console.log("Tasks: " + Object.keys(tasks));
		process.exit(-1);
	}
}

//Run tasks
async.series(task, function(error) {
	if(error) console.error("Terminated!");
	process.exit(-1);
});

function downloadFiles(gcallback) {
	//Array of files to download asynchronous
	var dlfiles = [];
	for (var key in forgeconfig.versions) {
		var version = forgeconfig.versions[key];
		if (fs.existsSync(version.fdir)) {
			delete files[files.indexOf(version.fdirname)];
		} else {
			fs.mkdirSync(version.fdir);
		}
		dlfiles.push(version);
	}
	
	//Remove outdated folders
	for (var i = 0; i < files.length; i++) {
		if(files[i] == undefined) continue;
		var dir = config.dataPath + "/" + files[i];
		utils.deleteFolderRecursive(dir);
	}
	
	//Download missing versions
	async.each(dlfiles, function(version, callback) {
		if (!(fs.existsSync(version.forgedir) || fs.existsSync(version.zipfile))) {
			var dlpath = forgeconfig.forgeMaven + version.versionFormat.format(version.mcversion, version.forgeversion);
			console.log("Downloading " + dlpath + " ...");
			utils.downloadFile(dlpath, version.zipfile, callback)
		} else {
			callback.call();
		}
	}, function(err) {
		if(err) console.error(err);
		gcallback.call();
	});
}

var csvPatches;

function parseCSVPatches(gcallback) {
	console.log("Parsing csv patches...");
	var patchdir = config.dataPath + "/patches";
	var patches = fs.readdirSync(patchdir);
	
	csvPatches = {};
	for (var i in versions) {
		csvPatches[versions[i]] = [];
	}
	
	getVersionList = function(matches) {
		if (matches.startsWith("@")) return versions.slice();
		matches = matches.split(",")[0];
		var ret = [];
		var splitted = matches.split(";");
		for (var i in splitted) {
			var match = splitted[i];
			if (match.contains("--")) {
				var sub = match.split("--")[0];
				if (!sub in versions) return "Illegal version id";
				ret = ret.concat(versions.slice(0, versions.indexOf(sub) + 1));
			} else if (match.contains("\+\+")) {
				var sub = match.split("\+\+")[0];
				if (!sub in versions) return "Illegal version id";
				ret = ret.concat(versions.slice(versions.indexOf(sub)));
			} else if (match.contains("-")) {
				var sub = match.split("-");
				if (sub.length != 2) return "Illegal version range";
				var start = sub[0];
				var end = sub[1];
				if (!start in versions || !end in versions) return "Illegal version id";
				ret = ret.concat(versions.slice(versions.indexOf(start), versions.indexOf(end) + 1));
			} else {
				if (!match in versions) return "Illegal version id";
				ret.push(match);
			}
		}
		return ret;
	}
	
	async.each(patches, function(patch, callback){
		if(!patch.endsWith(".csv")) {
			callback();
			return;
		}
		
		patch = patchdir + "/" + patch;
		console.log("Parsing patch " + patch);
		
		var versionlist = versions.slice();
		
		var rawPatch = fs.readFileSync(patch, "utf-8").split("\r\n");
		if (rawPatch.length > 1) {
			csvPatches["columns"] = rawPatch[0].split(",");
			for (var i = 1; i < rawPatch.length; i++) {
				var patch = rawPatch[i];
				if (patch.startsWith("@@")) {
					versionlist = getVersionList(patch.substring(2));
					if(typeof versionlist == "string") {
						callback.call(versionlist);
						return;
					}
				} else {
					for (var j in versionlist) {
						csvPatches[versionlist[j]].push(patch);
					}
				}
			}
		}
		callback.call();
	}, gcallback);
}

function applyCSVPatches(gcallback) {
	
	console.log("Applying csv patches...");
	if(!csvPatches) {
		console.log("No patches provided! You may want to run 'parseCSVPatches' first ");
		gcallback.call();
		return;
	}
	
	var connection = mysql.createConnection(config.mySQL);
	connectToDatabase(connection, function(error) {
		if (error) {
			gcallback.call(error);
			return;
		}
		
		for (var key in forgeconfig.versions) {
			var version = forgeconfig.versions[key];
			console.log("Applying csv patches for " + version.mcversion);
			
			var sqlqueries = [];
			var table = version.mcversion.replace(/\./g, "_");
			for (var key in csvPatches[version.mcversion]) {
				var data = csvPatches[version.mcversion][key].split(",");
				console.log(data.toString());
				sqlqueries.push(extractSQLQuery(csvPatches.columns, data, table));
			}
			console.log("Query database");
			async.eachSeries(sqlqueries, function(query, callback) {
				connection.query(query, callback);
			}, gcallback);
		}
	});
}

function connectToDatabase(connection, callback) {
	console.log("Connecting to MySQL database...");
	connection.connect(function(error) {
		if (error) {
			console.error("Error connecting: " + err.stack);
			callback.call(error);
		} else {
			console.log("Connected as id " + connection.threadId);
			
			connection.query(mysql.format("USE ??", config.database), function(error, result){
				callback.call(error);
			});
		}
	});
}

function extractSQLQuery(sql, row, table) {
	var querySet = {};
	for (var i = 1; i < row.length; i++) {
		if (row[i] && !(0 === row[i].length)) {
			querySet[sql[i]] = row[i];
		}
	}
	return mysql.format("UPDATE ?? SET ? WHERE name LIKE ?", [table, querySet, row[0]]);
}

function decompress(gcallback) {
	for (var key in forgeconfig.versions) {
		var version = forgeconfig.versions[key];
		if (fs.existsSync(version.zipfile)) {
			if(fs.existsSync(version.foregdir)) utils.deleteFolderRecursive(version.foregdir);
			console.log("Unzipping " + version.zipfile + " ...");
			var zip = new admzip(version.zipfile);
			zip.getEntries().forEach(function(zipEntry) {
				var valid = false;
				for (var key in version.packages) {
					var packg = version.packages[key];
					if (zipEntry.entryName.startsWith(packg)) valid = true;
				}
				if (valid) {
					console.log(zipEntry.entryName);
					zip.extractEntryTo(zipEntry.entryName, version.forgedir, true, true);
				}
		    });
			fs.unlinkSync(version.zipfile);
		}
	}
	gcallback.call();
}

function createDoclet(gcallback) {
	var javaHome = "javaHome" in config ? config.javaHome : process.env.JAVA_HOME;
	if(!fs.existsSync(config.docletPath)) throw "Invalid doclet path.";
	
	async.eachSeries(forgeconfig.versions, function(version, callback) {
		if (fs.existsSync(version.forgedir)) {
			var sourcepath = "";
			version.source.forEach(function(source){
				sourcepath = sourcepath.concat(path.resolve(version.forgedir + "/" + source) + ";");
			})
			var args = [
				"-path", path.resolve(__dirname), 
				"-forgeversion", JSON.stringify(version), 
				"-subpackages", "net:cpw", "-doclet", "ForgeDoclet", 
				"-docletpath", config.docletPath, 
				"-sourcepath", sourcepath
			];
			console.log("Running java doclet for " + version.fdir);
			
			var prc = spawn(javaHome + "/bin/javadoc.exe", args);
			prc.stdout.pipe(process.stdout);
			prc.stderr.pipe(process.stderr);

			prc.on("close", function(err) {	
				callback();
			});
		}
	}, function(err) {
		if(err) console.error(err);
		gcallback.call();
	})
}

function createHTML(gcallback) {
	gcallback.call();
}
