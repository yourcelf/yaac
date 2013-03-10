var less     = require("less"),
    Snockets = require("snockets"),
    stylus   = require("stylus"),
    nib      = require("nib"),
    fs       = require("fs"),
    path     = require("path"),
    crypto   = require("crypto"),
    _        = require("underscore"),
    utils    = require("./utils");
require("./patchLess");

var snockets = new Snockets();
/**
 *
 */
var defaults = {
    searchPath: [__dirname + "/../../../assets"],
    dest: __dirname + "/../../../builtAssets",
    urlPrefix: "/static/",
    compilers: {
        ".coffee": function(srcPath, code, callback) {
            callback(null, snockets.getConcatenation(srcPath, {
                async: false, minify: true
            }));
        },
        ".styl": function(srcPath, code, callback) {
            stylus(code)
                .set('filename', srcPath)
                .set('compress', true)
                .use(nib())
                .import('nib')
                .render(function(err, css) { callback(err, css); });
        },
        ".less": function(srcPath, code, callback) {
            var parser = new less.Parser({
                paths: [path.dirname(srcPath)]
            });
            parser.parse(code, function(err, tree) {
                if (err) { return callback(err); }
                callback(null, tree.toCSS({compress: true}));
            });
        }
    },
    logger: console
};

module.exports = function Assets(options) {
    var settings = _.extend({}, defaults, options || {});
    /*
    This is the cache mapping source files to compiled results. The mapping
    should be:
    
      "name.coffee": {
          sourcePath: "/root/path/to/name.coffee"
          compiledPath: "/root/path/to/builtAssets/name.md5hash.js",
          compiledURL: "/static/name.md5hash.js",
          // A list of absolute files this depends on, which if changed would
          // require recompile, including the source file.
          deps: [{
            path: "/root/dependency.coffee",
            stats: .. fs.Stats instance ..,
            code: "src of dependency"
          }, ...]
      }
    
    It might be more optimal in a production system to store this in redis or
    such. For now, just using locmem. A challenge: template renderers are 
    expected to run *synchronously*. So if we cache using a latency-bearing
    service like redis, we need to figure out a way to load the cache into
    locmem all at once so that asset lookups are zero latency.
    */
    var cache = {};

    /*
    * A collection of functions for each compiled asset type, which return the
    * list of dependencies for the asset.  For coffee, this uses snockets; for
    * stylus and less, we do some dumb parsing to find the import's.  We use
    * this to determine if the asset needs recompilation because a dependency
    * has changed.
    */
    var findDeps = {
        ".coffee": function findCoffeeDeps(srcPath, srcStats, deps) {
            var depGraph = snockets.scan(srcPath, {async: false});
            var chain = depGraph.getChain(srcPath);
            for (var i = 0; i < chain.length; i++) {
                deps.push({path: chain[i], stats: fs.statSync(chain[i])});
            }
            deps.push({path: srcPath, stats: fs.statSync(srcPath)});
            return deps;
        },
        ".styl": function findStylusDeps(srcPath, srcStats, deps) {
            var code = fs.readFileSync(srcPath, 'utf-8');
            deps.push({ path: srcPath, stats: srcStats, code: code})
            var dir = path.dirname(srcPath);
            var lines = code.split("\n");
            for (var i = 0; i < lines.length; i++) {
                var match = /@import\s*(["'])(([^\1]|\\\1)+)\1$/.exec(lines[i].trim());
                if (match) {
                    var dep = match[2];
                    var ext = path.extname(dep);
                    // Only consider it a dependency if it's extension-less.
                    if (ext == "") {
                        var depPath = path.join(dir, dep) + ".styl";
                        var depStats;
                        try {
                            depStats = fs.statSync(depPath);
                        } catch(e) {
                            continue;
                        }
                        findStylusDeps(depPath, depStats, deps);
                    }
                }
            }
            return deps;
        },
        ".less": function findLessDeps(srcPath, srcStats, deps) {
            // XXX: This doesn't work with @import-multiple or other more exotic
            // .less import statements.
            var code = fs.readFileSync(srcPath, 'utf-8');
            deps.push({ path: srcPath, stats: srcStats, code: code})
            var dir = path.dirname(srcPath);
            var lines = code.split("\n");
            for (var i = 0; i < lines.length; i++) {
                var match = /@import\s*(["'])(([^\1]|\\\1)+)\1\s*;$/.exec(lines[i].trim());
                if (match) {
                    var dep = match[2];
                    var ext = path.extname(dep);
                    if (ext == ".less") {
                        var depPath = path.join(dir, dep);
                        var depStats;
                        try {
                            depStats = fs.statSync(depPath);
                        } catch(e) {
                            continue;
                        }
                        findLessDeps(depPath, depStats, deps);
                    }
                }
            }
            return deps;
        }
    };

    // Raw extensions => compiled extensions
    var extMap = {
        ".coffee": ".js",
        ".less": ".css",
        ".styl": ".css"
    };

    /**
     * Find the asset named 'name', and synchronously return the URL for its
     * compiled version for inclusion in templates.
     **/
    var asset = function(name, _operations) {
        _operations = _operations || [];
        var cached = cache[name];
        // Don't look for changes if we're in production -- just serve the
        // cache if we have it.
        if (cached && process.env.NODE_ENV == "production") {
            return cached.compiledURL;
        }
        // Find latest dependencies.
        var srcDetails = utils.findFile(name, settings.searchPath);
        var srcPath = srcDetails[0];
        var srcStats = srcDetails[1];
        var ext = path.extname(srcPath);
        _operations.push("findDeps");
        var deps = findDeps[ext](srcPath, srcStats, []);
        // See any dependency has changed.
        if (cached) {
            _operations.push("compare");
            var mostRecentCached = 0;
            for (var i = 0; i < cached.deps.length; i++) {
                mostRecentCached = Math.max(mostRecentCached, cached.deps[i].stats.mtime);
            }
            var mostRecent = 0;
            for (var i = 0; i < deps.length; i++) {
                mostRecent = Math.max(mostRecent, deps[i].stats.mtime);
            }
            if (mostRecent == mostRecentCached) {
                // No changes -- just return the cached URL.
                return cached.compiledURL;
            }
        }
        _operations.push("compile");
        // Compile!
        settings.compilers[ext](srcPath, deps[0].code, function(err, compiledCode) {
            if (err) { throw(err); }
            // Get an md5 hash of the compiled code to use in the file name.
            var hash = crypto.createHash('md5');
            hash.update(compiledCode);
            var md5hex = hash.digest('hex');
            // Name the file with the hexstring and new extension.
            var compiledName = [
                name.substring(0, name.length - ext.length),
                ".",
                md5hex,
                extMap[ext]
            ].join("");
            cache[name] = {
                sourcePath: srcPath,
                compiledPath: path.join(settings.dest, compiledName),
                compiledURL: settings.urlPrefix + compiledName,
                deps: deps
            }
            var out = cache[name].compiledPath;
            utils.mkdirs(path.dirname(out));
            fs.writeFileSync(out, compiledCode, 'utf-8');
        });
        return cache[name].compiledURL;
    };
    return {
        asset: asset,
        _cache: cache,
        _findDeps: findDeps,
        _findFile: utils.findFile,
        _extMap: extMap
    };
}
