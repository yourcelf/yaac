var expect  = require("expect.js");
var path    = require("path");
var fs      = require("fs");
var _       = require("underscore");
var utils   = require("../lib/utils");
var crypto  = require("crypto");

var settings = {
    searchPath: [path.join(__dirname, "assets")],
    dest: path.join(__dirname, "/builtAssets")
};

var yaac = require("../lib/yaac")(settings);

var get_hash_of = function(string) {
    var hash = crypto.createHash('md5');
    hash.update(string);
    return hash.digest('hex');
}
var styl_hash = get_hash_of("h1{font-family:monospace}\nbody{background-color:#ffc0cb}\nspan.fun{color:#f00}\n");
var less_hash = get_hash_of("span.fun{color:green;}\np{color:red;}\nh1{font-family:\"monospace\";}\n");
var coffee_hash = get_hash_of('(function() {\n  var fun;\n\n  fun = "YEAH";\n\n}).call(this);\n\n//= require d\n\n(function() {\n\n\n}).call(this);\n\n(function() {\n\n\n}).call(this);\n');

describe("Assets", function() {
    before(function(done) {
        utils.rmDir(settings.dest);
        done()
    });

    after(function(done) {
        utils.rmDir(settings.dest);
        done()
    });
        
    it("finds assets", function() {
        // Find assets by name within the configured search path.
        expect(yaac._findFile("a.less", settings.searchPath)[0]).to.be(
            __dirname + "/assets/a.less");
        expect(yaac._findFile("dir1/c.styl", settings.searchPath)[0]).to.be(
            __dirname + "/assets/dir1/c.styl");
        expect(function() {
            yaac._findFile("bogus.styl", settings.searchPath);
        }).to.throwException(function (e) {
            expect(e.code).to.be('ENOENT');
        });
    });

    it("finds stylus dependencies", function() {
        // Find the dependencies of a stylus file -- rough tracking of
        // `@import` statements.
        var fn = __dirname + "/assets/a.styl";
        var deps = yaac._findDeps[".styl"](fn, fs.statSync(fn), []);
        var names = _.map(deps, function(dep) { return dep.path });
        expect(names).to.eql([
            __dirname + "/assets/a.styl",
            __dirname + "/assets/b.styl",
            __dirname + "/assets/dir1/c.styl"
        ]);
    });

    it("finds less dependencies", function() {
        // Find the dependencies of a less file -- rough tracking of `@import`
        // statements. Not a complete implementation; doesn't do
        // @import-multiple or anything but plain vanilla @import. But it
        // should be enough to work with bootstrap.
        var fn = __dirname + "/assets/a.less";
        var deps = yaac._findDeps[".less"](fn, fs.statSync(fn), []);
        var names = _.map(deps, function(dep) { return dep.path });
        expect(names).to.eql([
            __dirname + "/assets/a.less",
            __dirname + "/assets/dir1/b.less",
            __dirname + "/assets/c.less"
        ]);
    });

    it("finds coffee dependencies", function() {
        // Snockets-based //= require dependency tracking.
        var fn = __dirname + "/assets/a.coffee"
        var deps = yaac._findDeps[".coffee"](fn, fs.statSync(fn), []);
        var names = _.map(deps, function(dep) { return dep.path });
        // these come in reverse, because snockets recognizes the necessary
        // order for 'require's; for our purposes we don't care about order,
        // and will just use snockets to compile the whole chain if need be.
        expect(names).to.eql([
            __dirname + "/assets/d.coffee",
            __dirname + "/assets/c.js",
            __dirname + "/assets/dir1/b.coffee",
            __dirname + "/assets/a.coffee"
        ]);
    });

    var _compareOps = function(fromName, toName) {
        /*
        * Make sure that not only is the result the proper name, but the
        * operations yaac.asset reports that it performed are what we expect.
        * No unnecessary compilation here.
        */
        process.env.NODE_ENV = "";
        var operations = [];
        expect(yaac.asset(fromName, operations)).to.be("/static/" + toName)
        expect(operations).to.eql(["findDeps", "compile"]);

        operations = [];
        expect(yaac.asset(fromName, operations)).to.be("/static/" + toName);
        expect(operations).to.eql(["findDeps", "compare"]);
        
        // in production, no extra comparison/compilation, just serve cache
        process.env.NODE_ENV = "production";
        operations = [];
        expect(yaac.asset(fromName, operations)).to.be("/static/" + toName);
        expect(operations).to.eql([]);
        process.env.NODE_ENV = "";
        expect(fs.existsSync(__dirname + "/builtAssets/" + toName)).to.be(true);
    };

    it("compiles stylus", function() {
        _compareOps("a.styl", "a." + styl_hash + ".css");
    });

    it("compiles less", function() {
        _compareOps("a.less", "a." + less_hash + ".css");
    });

    it("compiles coffee", function() {
        _compareOps("a.coffee", "a." + coffee_hash + ".js");
    });

    it("copies arbitrary files without modification", function() {
        var outName = "spinner.86b1ac6d1c485d54efa3a53643e91ceb.gif"
        _compareOps("spinner.gif", outName);
        expect(fs.readFileSync(__dirname + "/assets/spinner.gif")).to.eql(
               fs.readFileSync(__dirname + "/builtAssets/" + outName));
    });

    it("is super performant in production", function() {
        var start = new Date().getTime();
        process.env.NODE_ENV = "production";
        var ops = [];
        for (var i = 0; i < 10; i++) {
            expect(yaac.asset("a.styl"), ops).to.be(
                "/static/a." + styl_hash + ".css")
            expect(yaac.asset("a.less"), ops).to.be(
                "/static/a." + less_hash + ".css")
            expect(yaac.asset("a.coffee"), ops).to.be(
                "/static/a." + coffee_hash + ".js")
        }
        expect(ops).to.eql([]);
        expect(new Date().getTime() - start).to.be.lessThan(100);
        process.env.NODE_ENV = "";
    });

    it("recompiles when file changes in dev", function() {
        process.env.NODE_ENV = "";
        // ensure we've cached this.
        expect(yaac.asset("a.coffee")).to.be(
            "/static/a." + coffee_hash + ".js")
        // yup, cached....
        var ops = [];
        expect(yaac.asset("a.coffee", ops)).to.be(
            "/static/a." + coffee_hash + ".js")
        expect(ops).to.eql(["findDeps", "compare"]);

        // "touch" a file it depends on.
        var fn = __dirname + "/assets/d.coffee";
        fs.writeFileSync(fn, fs.readFileSync(fn));
        
        // now it should recompile.
        ops = []
        expect(yaac.asset("a.coffee", ops)).to.be(
            "/static/a." + coffee_hash + ".js")
        expect(ops).to.eql(["findDeps", "compare", "compile"]);
    });
});
