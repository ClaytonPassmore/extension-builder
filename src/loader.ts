// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

var semver = require('semver');

/**
 * The registered module cache.
 */
var registered = {};

/**
 * The installed module cache.
 */
var installedModules = {};

/**
 * The module name lookup cache.
 */
var lookupCache = {};

/**
 * A cache of objects for parsed version-mangled module names.
 */
var nameCache = {};

/**
 * Object to store loaded and loading bundles.
 * "0" means "already loaded".
 * Array means "loading", array contains callbacks.
 */
var installedBundles = {};


/**
 * Define a module that can be synchronously required.
 *
 * @param name - The version-mangled fully qualified name of the module.
 *   For example, "foo@1.0.1/lib/bar/baz.js".
 *
 * @param callback - The callback function for invoking the module.
 */
function defineModule(name, callback) {
  if (!(name in registered)) {
    registered[name] = callback;
  }
}


/**
 * Synchronously require a module that has already been loaded.
 *
 * @param name - The semver-mangled fully qualified name of the module.
 *   For example, "foo@^1.1.0/lib/bar/baz.js".
 *
 * @returns The exports of the requested module, if registered.  The module
 *   selected is the registered module that maximally satisfies the semver
 *   range of the request.
 */
function requireModule(name) {
  // Check if module is in cache.
  var moduleId = findModuleId(name);
  if(installedModules[moduleId]) {
    return installedModules[moduleId].exports;
  }

  // Create a new module (and put it into the cache).
  var module = installedModules[moduleId] = {
    exports: {},
    id: moduleId,
    loaded: false
  };

  // Execute the module function.
  registered[moduleId].call(module.exports, module, module.exports, requireModule);

  // Flag the module as loaded.
  module.loaded = true;

  // Return the exports of the module.
  return module.exports;
}


/**
 * Ensure a bundle is loaded on a page.
 *
 * @param path - The public path of the bundle (e.g. "lab/jupyter.bundle.js").
 *
 * @param callback - The callback invoked when the bundle has loaded.
 */
function ensureBundle(path, callback) {
  // "0" is the signal for "already loaded"
  if (installedBundles[path] === 0) {
    return callback.call(null, requireModule);
  }

  // An array means "currently loading".
  if (Array.isArray(installedBundles[path])) {
    installedBundles[path].push(callback);
    return;
  }

  // Start bundle loading.
  installedBundles[path] = [callback];
  var head = document.getElementsByTagName('head')[0];
  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.async = true;
  script.onload = function() {
    var callbacks = installedBundles[path];
    while(callbacks.length)
      callbacks.shift().call(null, requireModule);
    installedBundles[path] = 0;
  }
  head.appendChild(script);
  script.src = path;
}


/**
 * Ensure a list of bundles are loaded on the page.
 *
 * @param paths - The public paths of the bundles. (e.g. "lab/foo.bundle.js").
 *
 * @returns A promise that resolves with the require function when all the
 *   bundles have loaded.
 */
function requireBundles(paths) {
  var promises = paths.map(function(path) {
    return new Promise(function (resolve, reject) {
      ensureBundle(path, resolve);
    });
  });
  return Promise.all(promises).then(function () {
    return requireModule;
  });
}


/**
 * Parse a version-mangled module name.
 *
 * @param name - The module name (e.g. "foo@^1.1.0/lib/bar/baz.js").
 *
 * @returns A parsed object describing the module name.
 */
function parseName(name) {
  if (nameCache[name]) {
    return nameCache[name];
  }
  var match = name.match(/(^(?:@[^/]+\/)??[^/@]+?)@([^/]+?)(\/.*)?$/);
  if (!match) {
    nameCache[name] = null;
  } else {
    nameCache[name] = {
      package: match[1],
      version: match[2],
      module: match[3]
    }
  }
  return nameCache[name];
}


/**
 * Find a module matching a given module request.
 *
 * @param name - The semver-mangled fully qualified name of the module.
 *   For example, "foo@^1.1.0/lib/bar/baz.js".
 *
 * @returns The matching defined module name, if registered.  A match is
 *   the registered name that maximally satisfies the semver range of the
 *   request.
 */
function findModuleId(name) {
  // Use the cached id if available.
  if (lookupCache[name]) {
    return lookupCache[name];
  }
  var modules = Object.keys(registered);
  // Get the package name, semver string, and module name.
  var source = parseName(name);
  if (!source) {
    throw Error('Invalid module name ' + name);
  }
  var matches = [];
  var versions = [];
  for (var i = 0; i < modules.length; i++) {
    var mod = modules[i];
    var target = parseName(mod);
    if (!target) {
      continue;
    }
    if (source.package === target.package && source.module === target.module) {
      matches.push(mod);
      versions.push(target.version);
    }
  };

  if (!matches.length) {
    throw Error('No module found matching: ' + name);
    return;
  }
  var index = 0;
  if (matches.length > 1) {
    var best = semver.maxSatisfying(versions, source.version);
    if (!best) {
      throw new Error('No module found satisying: ' + name);
    }
    index = versions.indexOf(best);
  }
  lookupCache[name] = matches[index];
  return matches[index];
}


// Add the ensure function to the require module for internal use within
// the modules.
requireModule.e = ensureBundle;


module.exports = {
  define: defineModule,
  require: requireModule,
  requireBundles: requireBundles
}
