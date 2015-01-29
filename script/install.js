var exec 	= require("child_process").exec;
var path 	= require("path");
var fs		= require("fs");

var packages = ["adm-zip", "async", "mysql"];

console.log("Installing required packages...");
var pointer = 0;

next();
function next() {
	var lib = packages[pointer];
	try {
		require.resolve(lib);
		pointer++;
		if(pointer >= packages.length) {
			process.nextTick(buildGradle);
		} else process.nextTick(next);
	} catch(error) {
		console.log("Installing " + packages[pointer]);
		var prc = exec("npm install " + packages[pointer], function(error, stdout, stderr) {
			checkError(error);
			console.log('stdout: ' + stdout);
		    console.log('stderr: ' + stderr);
		    
			pointer++;
			if(pointer >= packages.length) {
				process.nextTick(buildGradle);
			} else process.nextTick(next);
		});
	}
}

function buildGradle() {
	if(!fs.existsSync("../build/libs/ForgeEvents.jar")) {
		console.log("Running gradle build");
		exec("gradlew build", {cwd: path.resolve("..")}, function(error, stdout, stderr) {
			checkError(error);
			console.log('stdout: ' + stdout);
		    console.log('stderr: ' + stderr);
		    process.nextTick(finalize);
		});
	}
}

function finalize() {
	console.log("Installation successful!");
}

function checkError(error) {
	if (error) {
		console.log(error);
		console.error("Installation failed!");
		console.error(error);
		process.exit(-1);
	}
}