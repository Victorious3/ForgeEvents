var fs 		= require("fs");
var path 	= require("path");
var async 	= require("async");
var admzip 	= require("adm-zip");
var mysql 	= require("mysql");
var spawn 	= require('child_process').spawn;

var utils 	= require("./utilities.js");

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

downloadFiles();

function downloadFiles() {
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
			callback();
		}
	}, function(err) {
		if(err) console.error(err);
		decompress();
	});
}

function decompress() {
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
}

createDoclet();

function createDoclet() {
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
		createHMTL();
	})
}

function createHMTL() {
	
}
