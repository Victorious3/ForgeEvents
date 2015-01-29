var fs 		= require("fs");
var path 	= require("path");
var async 	= require("async");
var admzip 	= require("adm-zip");
var mysql 	= require("mysql");
var csv 	= require("csv-parse");
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

if (!fs.existsSync(config.dataPath)) fs.mkdirSync(config.dataPath);
var files = fs.readdirSync(config.dataPath);

var tasks = {
	downloadFiles : [downloadFiles],
	decompress : [downloadFiles],
	createCSV : [createCSV],
	applyCSV : [applyCSV],
	createDoclet : [createDoclet],
	createHTML : [createHTML],
	
	all : [downloadFiles, decompress, createCSV, createDoclet, applyCSV, createHTML],
	update : [downloadFiles, decompress, createCSV, applyCSV],
	csv : [createCSV, applyCSV],
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

function createCSV(gcallback) {
	console.log("Creating csv patches...");
	
	var csvname = config.dataPath + "/global.csv";
	if(!fs.existsSync(csvname)) fs.writeFileSync(csvname, "name,description,eventbus,side", {flag: "w"});
		
	fs.writeFileSync(csvname, "name;description;eventbus;side", {flag: "w"});
	for (var key in forgeconfig.versions) {
		var version = forgeconfig.versions[key];
		var csvname = config.dataPath + "/" + version.mcversion + ".csv";
		if(!fs.existsSync(csvname)) fs.writeFileSync(csvname, "name,description,eventbus,side", {flag: "w"});
	}
	gcallback.call();
}

function applyCSV(gcallback) {	
	console.log("Applying csv patches...");
	
	var connection = mysql.createConnection(config.mySQL);
	var tasks = [];
	var csvfile = fs.readFileSync(config.dataPath + "/global.csv", "utf-8");
	var globalcsv = [];
	
	tasks.push(function(callback) { connectToDatabase(connection, callback) });
	
	tasks.push(function(callback) {
		var parser = csv(csvfile, {
			delimiter: ","
		}, function(err, data) {
			globalcsv = data;
			callback.call(err);
		});
	});
	
	applyPatches = function(csv, callback) {
		if(csv.length > 1) {
			var sqlqueries = [];
			var table = version.mcversion.replace(/\./g, "_");
			for (var i = 1; i < csv.length; i++) {
				sqlqueries.push(extractSQLQuery(csv[0], csv[i], table));
			}
			async.eachSeries(sqlqueries, function(query, callback) {
				console.log(query);
				connection.query(query, callback);
			}, callback);
		} else callback.call();
	}
	
	async.parallel(tasks, function(error) {
		if(error) {
			gcallback.call(error);
		} else {
			async.eachSeries(forgeconfig.versions, function(version, callback) {
				var localcsv;
				async.series([function(callback) {
					var localcsvfile = fs.readFileSync(config.dataPath + "/" + version.mcversion + ".csv", "utf-8");
					var parser = csv(localcsvfile, {
						delimiter: ","
					}, function(err, data) {
						localcsv = data;
						callback.call(err);
					}); 
				}, function(callback) {
					console.log("Applying global csv patches for " + version.mcversion + "-" + version.forgeversion);
					applyPatches(globalcsv, callback);
				}, function(callback) {
					console.log("Applying local csv patches for " + version.mcversion + "-" + version.forgeversion);
					applyPatches(localcsv, callback);
				}], callback);
			}, function(err) {
				connection.destroy();
				gcallback.call(error);
			});
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
