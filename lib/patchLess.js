var fs  = require("fs"),
    path = require("path"),
    less = require("less"),
    utils = require("./utils");

/*
*   Monkey-patch less importer to load files synchronously. Taken from
*   https://github.com/adunkman/connect-assets/blob/master/src/assets.coffee
*/

less.Parser.importer = function(file, paths, callback) {
    paths.unshift(".");
    var fullPath = utils.findFile(file, paths)[0];
    var data = fs.readFileSync(fullPath, 'utf-8');
    new(less.Parser)({
        paths: [path.dirname(fullPath)].concat(paths),
        filename: fullPath
    }).parse(data, function(err, root) {
        if (err) { less.writeError(err); }
        callback(err, root);
    });
};

