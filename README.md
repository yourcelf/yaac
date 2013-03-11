Yet Another Asset Compiler
==========================

[![Build Status](https://travis-ci.org/yourcelf/yaac.png)](https://travis-ci.org/yourcelf/yaac)

This is yet another asset compiler, because the other ones didn't do what I
wanted. It is intended to be used to concatenate and minify assets in production.

Still rather alpha.

Compiles less, stylus, and coffeescript.

WARNING: requiring this module this monkey-patches ``less`` to import files
synchronously, which is necessary to use this during synchronous template
rendering. If you use less separately, this could be an issue.

Here's how it works:

           ______________________________________
          |                BEGIN                 |
          | Look asset up in compiled path cache |
          |______________________________________| 
                            |
                           _|_____
           ________no____ / null? \_____yes____
       ____|________      \_______/           |      ______
      / production? \                     ____|_____/      \
     /\_____________/\                    | compile |       \
    no                yes                 |_________|        \
    |                   \                     |               \
    |                    \                ____|________        |
    \_________________    \               | store path |       |
     | calculate hash |    \              | in cache   |       |
     |________________|     \             |____________|       |
          ____|_____         \               |                 |
         / changed? \         \              |                 |
        /\__________/\         \             |                 |
      yes             no        \            |                 |
       |               \         \   ________|______________   |
       |                \_________\__| return compiled path |  |
       |                             |______________________|  |
        \______________________________________________________/


Installation
------------

With npm:

    npm install yaac

Configuration
-------------

Initialize with:

    var yaac = require("yaac")(options);

The options are:
* ``searchPath``: A list of absolute paths to source directories. Default:
  ``__dirname/../../../assets``, where ``__dirname`` is the ``yaac/lib``.
  it's in ``node_modules``, that's your project root).
* ``dest``: An absolute path to the directory in which to put compiled assets.
  Default: ``builtAssets``, same root as ``assets``
* ``urlPrefix``: a string to prepend to printed URL's.  Default: ``/static/``.

Examle:

    var yaac = require("yaac")({
        searchPath: [__dirname + "/assets", __dirname + "/plugins/app/assets"],
        dest: __dirname + "/builtAssets",
        urlPrefix: "/static/"
    });

Usage
-----

There's one function:

* ``asset(name)``: Return a string representing the URL for a compiled version
  of the asset named ``name``, found somewhere in the configured
  ``searchPath``.  ``name`` should include its extension (e.g. ".coffee",
  ".styl", ".less"), and be expressed relative to whichever directory in the
  search path that it's in.  The returned URL will be prefixed with
  ``urlPrefix``, will have an md5 of the compiled file's contents added to the
  name, and will have the extension changed to ".js" or ".css" as appropriate.

Example:

    yaac.asset("/scripts/myfile.coffee")
    // returns: /static/scripts/myfile.edbb910a5be3a5b395f2c52f3632ab0f.js
    // generates: /root/builtAssets/scripts/myfile.edbb910a5be3a5b395f2c52f3632ab0f.js

Compilation is only performed the first time; the result is then cached in local memory (caveat: that goes away if the server restarts).  If ``NODE_ENV="production"``, subsequent calls of ``yaac.asset`` for the same name will just return the cached name.  If not in production mode, subsequent calls will check the dependency graph to see if anything has changed, and recompile it if so.

Dependency Graphs
-----------------

``yaac`` uses [Snockets](https://github.com/TrevorBurnham/snockets) to resolve Rails' sprockets-style "//= require" statements from js and coffee-script.  It does dumb parsing of stylus and less files to look for any ``@import``-based dependencies.  In development, if any dependency of a file you compile with ``yaac.asset`` changes, it will be synchronously recompiled on load.

Synchronous compilation is necessary to work smoothly as helpers within template engines like ``jade``, which expect helpers within the template to all be synchronous.  But that makes it suuuuper important to cache the results, which yaac does, but in locmem only.

Usage in templates
------------------

Using express 3.x, simply set ``yaac.assets`` as a member of ``app.locals``:

    app.locals.asset = yaac.asset

Then, you'll have it available in templates.  For example, jade:

    script(type='text/javascript', src=asset("mycoffee.coffee"))

result:

    <script type='text/javascript' src='/static/mycoffee.edbb910a5be3a5b395f2c52f3632ab0f.js'></script>
