var fs   = require("fs");
var path = require("path");

// General utility for synchronously finding a file within a search path.
// Returns [fullPath, stats], where stats is the fs.Stats instance for the
// file.
function findFile(name, searchPath) {
    var fullPath, stats, i;
    for (i = 0; i < searchPath.length; i++) {
        fullPath = path.join(searchPath[i], name);
        try {
            stats = fs.statSync(fullPath);
            break;
        } catch (e) {
            if (i < searchPath.length - 1) {
                continue;
            } else {
                var e = new Error("File " + name + " not found.")
                e.code = "ENOENT";
                throw e;
            }
        }
    }
    return [fullPath, stats];
}

// Synchronously create the given directory and any parents necessary.
function mkdirs(dir) {
    if (fs.existsSync(dir)) { return }
    // recursively create the parent, if necessary
    mkdirs(path.dirname(dir));
    // make ourselves.
    fs.mkdirSync(dir);
}

// Remove a directory synchronously. From
// https://gist.github.com/liangzan/807712#comment-337828
var rmDir = function(dirPath) {
    try { var files = fs.readdirSync(dirPath); }
    catch(e) { return; }
    if (files.length > 0) {
        for (var i = 0; i < files.length; i++) {
            var filePath = dirPath + '/' + files[i];
            if (fs.statSync(filePath).isFile()) {
                fs.unlinkSync(filePath);
            } else {
                rmDir(filePath);
            }
        }
    }
    fs.rmdirSync(dirPath);
};


module.exports = { findFile: findFile, mkdirs: mkdirs, rmDir: rmDir }
