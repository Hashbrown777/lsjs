/*
	Copyright (c) 2004-2011, The Dojo Foundation All Rights Reserved.
	Available via Academic Free License >= 2.1 OR the modified BSD license.
	see: http://dojotoolkit.org/license for details
*/

var require;
var define;

(function () {
	/* These regexs are taken from requirejs */
	var commentRegExp = /(\/\*([\s\S]*?)\*\/|\/\/(.*)$)/mg;
	/* Based on the cjs regexs in requirejs, modified slightly */
	var cjsRequireRegExp = /[^\d\w\.]require\(["']([^'"\s]+)["']\)/g;
	var cjsVarPrefixRegExp = /^~#/;
	var pluginRegExp = /.+!/;

	Iterator = function(array) {
		this.array = array;
		this.current = 0;
	};

	Iterator.prototype = {
		hasMore: function() {
			return this.current < this.array.length;
		},
		next: function() {
			return this.array[this.current++];
		}
	};

	lsImpl = {
		isSupported: function() {
			try {
				return 'localStorage' in window && window['localStorage'] !== null;
			} catch (e) {
				return false;
			}
		},
		remove: function(key, handler, errorHandler) {
			try {
				var json = localStorage[key];
				if (json !== undefined && json !== null) {
					var value = JSON.parse(json);
					localStorage.removeItem(key);
					if (handler) {
						handler(value);
					}
				} else {
					if (errorHandler) {
						errorHandler("Failed to remove value in local storage ["+key+"]");
					} else {
						console.log("Failed to remove value in local storage ["+key+"]");
					}
				}
			} catch(e) {
				if (errorHandler) {
					errorHandler(e);
				} else {
					console.log("Failed to remove value in local storage ["+key+"] : "+e);
				}
			}
		},
		get: function(key, handler, errorHandler) {
			try {
				var json = localStorage[key];
				if (json !== undefined && json !== null) {
					var value = JSON.parse(json);
					handler(value);
				} else {
					if (errorHandler) {
						errorHandler("Failed to get value in local storage ["+key+"]");
					} else {
						console.log("Failed to get value in local storage ["+key+"]");
					}
				}
			} catch(e) {
				if (errorHandler) {
					errorHandler(e);
				} else {
					console.log("Failed to get value in local storage ["+key+"] : "+e);
				}
			}
		},
		set: function(key, entry, handler, errorHandler) {
			try {
				localStorage[key] = JSON.stringify(entry);
				if (handler) {
					handler(true);
				}
			} catch (e) {
				if (errorHandler) {
					errorHandler(e);
				} else {
					console.log("Failed to set value in local storage ["+key+"] : "+e);
				}
			}
		}
	};

	var modules = {};
	var moduleStack = [];
	var paths = {};
	var pkgs = {};
	var reload = {};
	var storage = lsImpl;
	var loaded = {};
	var cache = {};
	var cachets = {};
	var usesCache = {};
	var cblist = {};
	var strands = [];
	var circRefs = {};

	var geval = window.execScript || eval;

	var opts = Object.prototype.toString;

	function isFunction(it) { return opts.call(it) === "[object Function]"; };
	function isArray(it) { return opts.call(it) === "[object Array]"; };
	function isString(it) { return (typeof it == "string" || it instanceof String); };

	function _getCurrentId() {
		return moduleStack.length > 0 ? moduleStack[moduleStack.length-1].id : "";
	}

	function _normalize(path) {
		var segments = path.split('/');
		var skip = 0;

		for (var i = (segments.length-1); i >= 0; i--) {
			var segment = segments[i];
			if (segment === '.') {
				segments.splice(i, 1);
			} else if (segment === '..') {
				segments.splice(i, 1);
				skip++;
			} else if (skip) {
				segments.splice(i, 1);
				skip--;
			}
		}
		return segments.join('/');
	};

	var isRelative    = /^\./;
	var prenormalizeA = /\/\.(?=\/)/g;
	var prenormalizeB = /(?<=(?:^|\/))[^./][^/]*\/\.\.\//g;
	var prenormalizeC = /(?<=^|\/)([^./][^/]*)(?:\/\.)*\/\.\.(?:\/\.)*\/\1(?=\/|$)/g;
	var memoized      = {};
	function _expand(path) {
		var input = _getCurrentId() + '!' + path;
		if (!memoized[input]) {
			if (isRelative.test(path)) {
				var pkg = pkgs[_getCurrentId()];
				if (pkg && pkg.main) {
					path = pkg.name + "/" + path;
				} else if (_getCurrentId()) {
					path = _getCurrentId() + "/../" + path;
				}
			}

			for (
				var tmp = path.replace(prenormalizeA, "");
				(path = tmp.replace(prenormalizeB, "")) != tmp;
				tmp = path
			);
			memoized[input] = path.replace(prenormalizeC, "$1");
		}
		return memoized[input];
	};

	var absolute   = /^([\w+.-]+:|\/)/;
	var tailFinder = /^([^?#]*)([#?].*|)$/;
	function _idToUrl(path, justPackage) {
		var input = path;
		if (memoized[input + !!justPackage])
			return memoized[input + !!justPackage];
		path = path.match(tailFinder);
		var tail = path[2];
		path = path[1];
		if (cssTest.test(path)) {
			path = path.substr(0, path.length - 4);
			tail = ".css" + tail;
		}
		
		var segments = path.split("/");
		var pkg = null;
		for (var i = segments.length; i >= 0; i--) {
			var parent = segments.slice(0, i).join("/");
			if (paths[parent]) {
				segments.splice(0, i, paths[parent]);
				break;
			}else if ((pkg = pkgs[parent])) {
				var pkgPath;
				if (path === pkg.name && pkg.main) {
					pkgPath = pkg.location + '/' + pkg.main;
				} else {
					pkgPath = pkg.location;
				}
				segments.splice(0, i, pkgPath);
				break;
			}
		}

		path = segments.join("/");
		if (pkg && pkg.suffix) {
			path += pkg.suffix;
		}
		path = _normalize(path + tail);
		if (!absolute.test(path)) {
			path = cfg.baseUrl + path;
		}

		memoized[input + false] = path;
		memoized[input + true] = pkg;
		return memoized[input + !!justPackage];
	};

	function fireZazlLoadEvent() {
		var evt = document.createEvent('Events');
		evt.initEvent('zazlload', true, false);
		document.documentElement.dispatchEvent(evt);
	};

	function _loadModule(id, cb, f, scriptText) {
		var expandedId = _expand(id);
		var dependentId = _getCurrentId();
		if (cblist[expandedId] === undefined) {
			cblist[expandedId] = [];
		}
		if (modules[expandedId] !== undefined) {
			processModules();
			if (modules[expandedId].loaded) {
				var savedStack;
				if (dependentId !== "") {
					var root = modules[dependentId];
					savedStack = moduleStack;
					moduleStack = [root];
				}
				cb(modules[expandedId].exports);
				if (dependentId !== "") {
					moduleStack = savedStack;
				}
			} else {
				cblist[expandedId].push({cb:cb, /*f:f,*/ mid:dependentId});
			}
			return;
		}
		modules[expandedId] = {id: expandedId, exports: {}};

		var url = _idToUrl(expandedId);
		var normalizedId = _normalize(expandedId);
		var pkg = _idToUrl(expandedId, true);
		if (!cssTest.test(url))
			url += ".js";

		var storedModule;
		function _load() {
			if (scriptText) {
				_inject(expandedId, dependentId, cb, f, scriptText);
			} else if (storedModule == null) {
				_getModule(url, function(_url, scriptSrc, ts) {
					loaded[_url] = (pkg&&pkg.timestamp)||ts;
					storage.set("loaded!"+cfg.baseUrl, loaded);
					storage.set(_url, {src: scriptSrc, timestamp: loaded[_url]});
					_inject(expandedId, dependentId, cb, f, scriptSrc);
				}, f);
			} else {
				_inject(expandedId, dependentId, cb, f, storedModule.src);
			}
		};
		if (cfg.forceLoad || url in reload) {
			storage.remove(url, function(){
				_load();
			});
		} else {
			storage.get(url, function(value) {
				storedModule = value;
				_load();
			}, function(error){
				_load();
			});
		}
	};

	function _inject(moduleId, dependentId, cb, f, scriptSrc) {
		var module = modules[moduleId];
		moduleStack.push(module);
		if (cfg.injectViaScriptTag) {
			var script;
			if (/\.css$/.test(moduleId)) {
				script = document.createElement('style');
			}
			else {
				script = document.createElement('script');
				script.type = "text/javascript";
				script.charset = "utf-8";
			}
			var scriptContent = document.createTextNode(scriptSrc);
			script.appendChild(scriptContent);
			document.getElementsByTagName("head")[0].appendChild(script);
		} else {
			geval(scriptSrc+"//@ sourceURL="+module.id);
		}
		_loadModuleDependencies(module.id, function(){
			moduleStack.pop();
			cblist[moduleId].push({cb:cb, /*f:f,*/ mid:dependentId});
			if (pageLoaded) {
				fireZazlLoadEvent();
			}
		}, f);
	};

	var cssTest = /^([a-z]+:|(?![a-z]+:))(\/\/[^/]*\/|(?!\/\/))[^?#]*\.css([?#]|$)/;
	var injectQuery = /^([^?#]*)(\?|(#.*)?$)/;
	var cssURLs = /((?:\s|:|,)url\(\s*("|'|(?!"|'|\s)))(?![a-z]+:|\/\/)((?:\\.|(?!\2).|\2\2[^)])*\2\s*\))/g;
	var mapURL = /(\n\/[/*]# sourceMappingURL=)(?![a-z]+:|\/\/)()(.*(?: \*\/)?)\n?$/;
	var urlDomain = /^((?:[a-z]+:|(?![a-z]+:))(?:\/\/[^/]+(?=\/)|(?!\/\/)))([^?#]+)/;
	function _getModule(url, cb, f) {
		var xhr = new XMLHttpRequest();
		xhr.open(
			"GET",
			url.replace(injectQuery, "$1?nocache="+new Date().valueOf()+"&"),
			true
		);
		xhr.onreadystatechange = function() {
			if (xhr.readyState == 4) {
				if (xhr.status != 200) {
					f("Unable to load ["+url+"]:"+xhr.status);
					return;
				}

				var origin = xhr.responseURL.match(urlDomain);
				if (!origin[1])
					origin[1] = location.origin;
				if (origin[2][0] != '/')
					origin[2] = location.pathname.replace(/\/?$/, '/') + origin[2];
				origin[2] = origin[1] + origin[2].replace(/[^/]*$/, '');
				function includeDomain(str, pre, x, path) {
					return pre + origin[(path[0] == '/') ? 1 : 2] + path;
				}
				var scriptSrc = xhr.responseText;
				if (cssTest.test(url))
					scriptSrc = scriptSrc.replace(cssURLs, includeDomain);
				scriptSrc = scriptSrc.replace(mapURL, includeDomain);

				cb(url, scriptSrc, _getTimestamp(xhr));
			}
		};
		xhr.send(null);
	};

	function _loadModuleDependencies(id, cb, f) {
		var m = modules[id];
		m.args = [];
		m.deploaded = {};
		m.dependencies = m.dependencies || [];
		var idx = 0;
		var iterate = function(itr) {
			if (itr.hasMore()) {
				var dependency = itr.next();
				var argIdx = idx++;
				var depname;
				if (dependency.match(pluginRegExp)) {
					var add = true;
					if (dependency.match(cjsVarPrefixRegExp)) {
						dependency = dependency.substring(2);
						add = false;
					}
					var pluginName = dependency.substring(0, dependency.indexOf('!'));
					pluginName = _expand(pluginName);
					var pluginModuleName = dependency.substring(dependency.indexOf('!')+1);
					if (add) {
						m.dependencies[argIdx] = pluginName + "!"+pluginModuleName;
						m.args[argIdx] = undefined;
						depname = pluginName + "!"+pluginModuleName;
					} else {
						depname = "~#"+pluginName + "!"+pluginModuleName;
					}
					m.deploaded[depname] = false;
					_loadPlugin(pluginName, pluginModuleName, function(pluginInstance) {
						if (add) {
							m.args[argIdx] = pluginInstance;
						}
						m.deploaded[depname] = true;
					}, f);
					iterate(itr);
				} else if (dependency === 'require') {
					m.args[argIdx] = _createRequire(_getCurrentId());
					m.deploaded['require'] = true;
					iterate(itr);
				} else if (dependency === 'module') {
					m.args[argIdx] = m;
					m.deploaded['module'] = true;
					iterate(itr);
				} else if (dependency === 'exports') {
					m.args[argIdx] = m.exports;
					m.deploaded['exports'] = true;
					iterate(itr);
				} else {
					var add = true;
					if (dependency.match(cjsVarPrefixRegExp)) {
						dependency = dependency.substring(2);
						add = false;
					}
					var expandedId = _expand(dependency);
					if (add) {
						m.dependencies[argIdx] = expandedId;
						m.args[argIdx] = modules[expandedId] === undefined ? undefined : modules[expandedId].exports;
						depname = expandedId;
					} else {
						depname = "~#"+expandedId;
					}
					m.deploaded[depname] = false;
					_loadModule(dependency, function(module){
						if (add) {
							m.args[argIdx] = module;
						}
						m.deploaded[depname] = true;
					}, f);
					iterate(itr);
				}
			} else {
				m.cjsreq = _createRequire(_getCurrentId());
				cb();
			}
		};
		iterate(new Iterator(m.dependencies));
	};

	function _loadPlugin(pluginName, pluginModuleName, cb, f) {
		_loadModule(pluginName, function(plugin){
			if (plugin.normalize) {
				pluginModuleName = plugin.normalize(pluginModuleName, _expand); 
			} else {
				pluginModuleName = _expand(pluginModuleName);
			}
			var isDynamic = plugin.dynamic || false; 
			if (modules[pluginName+"!"+pluginModuleName] !== undefined && !isDynamic) {
				cb(modules[pluginName+"!"+pluginModuleName].exports);
				return;
			}
			var req = _createRequire(pluginName);
			var load = function(pluginInstance){
				if (pluginInstance === undefined) {
					pluginInstance = null;
				}
				modules[pluginName+"!"+pluginModuleName] = {};
				modules[pluginName+"!"+pluginModuleName].exports = pluginInstance;
				if (pluginName in usesCache) {
					var url = _idToUrl(pluginModuleName);
					if (cache[url] === undefined || url in reload) {
						_getLastModified(url, function(lastModified){
							if (lastModified) {
								cachets[url] = lastModified;
								_storeCache();
							}
						});
						cache[url] = pluginInstance;
						_storeCache();
					}
				}
				cb(pluginInstance);
			};
			load.fromText = function(name, text) {
				_loadModule(name, function(){}, f, text);
			};
			plugin.load(pluginModuleName, req, load, cfg);
		}, f);
	};

	function _createRequire(id) {
		var req = function(dependencies, callback) {
			var root = modules[id];
			var savedStack = moduleStack;
			moduleStack = [root];
			if (isArray(dependencies)) {
				for (var i = 0; i < dependencies.length; i++) {
					if (dependencies[i] !== 'exports' && dependencies[i] != 'module' && dependencies[i] !== 'require') {
						strands[dependencies[i]] = false;
					}
				}
			} else if (isString(dependencies)) {
				if (dependencies !== 'exports' && dependencies != 'module' && dependencies !== 'require') {
					strands[dependencies] = false;
				}
			}
			if (isFunction(callback)) {
				_require(dependencies, function() {
					moduleStack = savedStack;
					callback.apply(null, arguments);
				});
			} else {
				var mod = _require(dependencies, callback);
				moduleStack = savedStack;
				return mod;
			}
		};
		req.toUrl = function(moduleResource) {
			var url = _idToUrl(_expand(moduleResource));
			return url;
		};
		req.defined = function(moduleName) {
			return _expand(moduleName) in modules;
		};
		req.specified = function(moduleName) {
			return _expand(moduleName) in modules;
		};
		req.ready = function(callback) {
			if (pageLoaded) {
				callback();
			} else {
				readyCallbacks.push(callback);
			}
		};
		req.nameToUrl = function(moduleName, ext, relModuleMap) {
			return moduleName + ext;
		};
		// Dojo specific require properties and functions
		req.cache = cache;
		req.toAbsMid = function(id) {
			return _expand(id);
		};
		req.isXdUrl = function(url) {
			return false;
		};
		return req;
	};

	function _getTimestamps(timestampUrl, cb, f) {
		var xhr = new XMLHttpRequest();
		xhr.open("POST", timestampUrl, true);
		xhr.setRequestHeader("Content-Type", "application/json");

		xhr.onreadystatechange = function() {
			if (xhr.readyState == 4) {
				if (xhr.status == 200) {
					var urlsToReload = JSON.parse(xhr.responseText);
					for (var i = 0; i < urlsToReload.length; i++) {
						reload[urlsToReload[i]] = urlsToReload[i];
					}
					cb();
				} else {
					f("Unable to get timestamps via the url ["+timestampUrl+"]:"+xhr.status);
				}
			}
		};
		var current = [];
		var url;

		for (url in loaded) {
			current.push({url: url, timestamp: loaded[url]});
		}
		for (url in cachets) {
			current.push({url: url, timestamp: cachets[url]});
		}
		xhr.send(JSON.stringify(current));
	};

	function _getTimestamp(xhr) {
		var value;
		for (var index = 0; index < cfg.timestampHeader.length; ++index) {
			if (value = xhr.getResponseHeader(cfg.timestampHeader[index])) {
				break;
			}
		}
		return value;
	}

	function _getLastModified(url, cb) {
		var xhr = new XMLHttpRequest();
		xhr.open("HEAD", url, true);
		xhr.onreadystatechange = function() {
			if (xhr.readyState == 4) {
				if (xhr.status == 200) {
					cb(_getTimestamp(xhr));
				} else {
					cb();
				}
			}
		};
		xhr.send(null);
	};

	function _storeCache() {
		var storedCache = {};
		for (var url in cache) {
			storedCache[url] = {value: cache[url], timestamp: cachets[url]};
		}
		storage.set("cache!"+cfg.baseUrl, storedCache);
	};

	define = function (id, dependencies, factory) {
		var simpleCJS = false;
		if (!isString(id)) {
			factory = dependencies;
			dependencies = id;
			id = _getCurrentId();
		}
		if (!isArray(dependencies)) {
			simpleCJS = true;
			factory = dependencies;
			dependencies = [];
		}
		if (!modules[id]) {
			var args = [];
			if (!simpleCJS) {
				args= undefined;
			}
			modules[id] = {id: id, exports: {}, cjsreq: _createRequire(id), args: args};
		}
		if (isFunction(factory)) {
			if (simpleCJS) {
				factory.toString().replace(commentRegExp, "").replace(cjsRequireRegExp, function (match, dep) {
					dependencies.push("~#"+dep);
				});
			}
			modules[id].factory = factory;
		} else {
			modules[id].literal = factory;
		}
		modules[id].dependencies = dependencies;
	};

	define.amd = {
		plugins: true,
		jQuery: true
	};

	_require = function (dependencies, callback, failure) {
		if (isString(dependencies)) {
			var id = dependencies;
			id = _expand(id);
			if (id.match(pluginRegExp)) {
				var pluginName = id.substring(0, id.indexOf('!'));
				pluginName = _expand(pluginName);
				var plugin = modules[pluginName].exports;
				var pluginModuleName = id.substring(id.indexOf('!')+1);
				if (plugin.normalize) {
					pluginModuleName = plugin.normalize(pluginModuleName, function(path){
						return _expand(path);
					});
				} else {
					pluginModuleName = _expand(pluginModuleName);
				}
				id = pluginName+"!"+pluginModuleName;
			}
			if (modules[id] === undefined) {
				failure("Module ["+id+"] has not been loaded");
				throw null;
			}
			return modules[id].exports;
		} else if (isArray(dependencies)) {
			var args = [];
			var iterate = function(itr) {
				if (itr.hasMore()) {
					var dependency = itr.next();
					if (dependency.match(pluginRegExp)) {
						var pluginName = dependency.substring(0, dependency.indexOf('!'));
						pluginName = _expand(pluginName);
						var pluginModuleName = dependency.substring(dependency.indexOf('!')+1);
						_loadPlugin(pluginName, pluginModuleName, function(pluginInstance) {
							args.push(pluginInstance);
							iterate(itr);
						}, failure);
					} else {
						_loadModule(dependency, function(module){
							args.push(module);
							iterate(itr);
						}, failure);
					}
				} else if (callback !== undefined) {
					callback.apply(null, args);
				}
			};
			iterate(new Iterator(dependencies));
			return undefined;
		}
	};

	modules["require"] = {};
	modules["require"].exports = _require;
	modules["require"].loaded = true;

	var cfg;

	function processConfig(config, failure) {
		if (!cfg) {
			var i;
			cfg = config || {};
			if (cfg.paths) {
				for (var p in cfg.paths) {
					var path = cfg.paths[p];
					paths[p] = path;
				}
			}
			if (cfg.packages) {
				for (i = 0; i < cfg.packages.length; i++) {
					var pkg = cfg.packages[i];
					if (!pkg.location) {
						pkg.location = pkg.name;
					}
					if (pkg.main == null) {
						pkg.main = pkg.name;
					}
					pkgs[pkg.name] = pkg;
				}
			}

			if (cfg.storageImpl) {
				storage = cfg.storageImpl;
				var requiredProps = ["get", "set", "remove", "isSupported"];
				for (i = 0; i < requiredProps.length; i++) {
					if (!storage[requiredProps[i]]) {
						failure("Storage implementation must implement ["+requiredProps[i]+"]");
						throw null;
					}
				}
			}

			if (cfg.usesCache) {
				for (i = 0; i < cfg.usesCache.length; i++) {
					usesCache[cfg.usesCache[i]] = true;
				}
			}

			cfg.baseUrl = cfg.baseUrl || "./";

			if (!absolute.test(cfg.baseUrl)) {
				cfg.baseUrl = _normalize(window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/'+ cfg.baseUrl);
			}

			if (!cfg.timestampHeader) {
				cfg.timestampHeader = ["Last-Modified"];
			}
		}
	};

	lsjs = function(config, dependencies, callback, failure) {
		if (isArray(config) || typeof config != "object") {
			failure = callback;
			callback = dependencies;
			dependencies = config;
			config = (typeof lsjsConfig === 'undefined') ? {} : lsjsConfig;
		}
		if (!isArray(dependencies)) {
			failure = callback;
			callback = dependencies;
			dependencies = [];
		}
		if (!isFunction(failure)) {
			failure = function(message) { throw new Error(message); };
		}
		processConfig(config, failure);

		if (!storage.isSupported()) {
			failure("Storage implementation is unsupported");
			throw null;
		}

		storage.get("loaded!"+cfg.baseUrl, function(value){
			loaded = value;
		}, function(error){});

		storage.get("cache!"+cfg.baseUrl, function(storedcache) {
			for (var url in storedcache) {
				cache[url] = storedcache[url].value;
				cachets[url] = storedcache[url].timestamp;
			}
		}, function(error){});

		function callRequire(dependencies) {
			for (var i = 0; i < dependencies.length; i++) {
				if (dependencies[i] !== 'exports' && dependencies[i] != 'module' && dependencies[i] !== 'require') {
					strands[dependencies[i]] = false;
				}
			}
			_require(
				dependencies,
				(isFunction(callback)) ? callback : undefined,
				failure
			);
			queueProcessor();
		};
		if (cfg.timestampUrl) {
			_getTimestamps(cfg.timestampUrl, function(){
				callRequire(dependencies);
			}, failure);
		} else {
			callRequire(dependencies);
		}
	};

	var pageLoaded = false;
	var modulesLoaded = false;
	var domLoaded = false;
	var readyCallbacks = [];

	document.addEventListener("DOMContentLoaded", function() {
		domLoaded = true;
	}, false);

	if (!require) {
		require = lsjs;
		require.toUrl = function(moduleResource) {
			var url = _idToUrl(_expand(moduleResource)); 
			return url;
		};
	}

	function queueProcessor() {
		var poller = function() {
			if (processQueues()) { return; }
			setTimeout(poller, 0);
		};
		poller();
	};

	function processCallbacks() {
		var savedStack;

		var cbiterate = function(exports, itr) {
			if (itr.hasMore()) {
				var cbinst = itr.next();
				if (cbinst.mid !== "") {
					var root = modules[cbinst.mid];
					savedStack = moduleStack;
					moduleStack = [root];
				}
				cbinst.cb(exports);
				if (cbinst.mid !== "") {
					moduleStack = savedStack;
				}
				cbiterate(exports, itr);
			} else {
				delete cblist[mid];
			}
		};
		for (mid in cblist) {
			if (modules[mid].loaded) {
				cbiterate(modules[mid].exports, new Iterator(cblist[mid]));
			}
		}
	};

	function processModules() {
		var isCircular = function(id, module) {
			return circRefs[module.id] && circRefs[module.id].refs[id] ? true : false;
		};

		var isComplete = function(module) {
			var complete = false;
			if (module.cjsreq) {
				complete = true;
				for (var dep in module.deploaded) {
					var iscjs = dep.match(cjsVarPrefixRegExp);
					if (module.deploaded[dep] === false && isCircular(iscjs ? dep.substring(2) : dep, module) === false) {
						complete = false;
						break;
					}
				}
			}
			return complete;
		};

		var allLoaded = true;
		var mid, m;
		for (mid in modules) {
			m = modules[mid];
			if (!m || m.loaded !== true && !mid.match(pluginRegExp)) {
				allLoaded = false;
			}
			if (mid !== "require") {
				if (m.loaded !== true && isComplete(m)) {
					if (m.factory !== undefined) {
						if (m.args && m.args.length < 1) {
							m.args = m.args.concat(m.cjsreq, m.exports, m);
						}
						var ret = m.factory.apply(null, m.args);
						if (ret) {
							m.exports = ret;
						}
					} else {
						m.exports = m.literal;
					}
					m.loaded = true;
				}
			}
		}
		return allLoaded;
	};

	function processStrands() {
		function findCircRefs(id, seen, scanned) {
			if (id.match(pluginRegExp)) {
				return true;
			}
			var module = modules[id];
			var complete = false;
			if (module && module.cjsreq) {
				seen.push(module.id);
				complete = true;
				for (var dep in module.deploaded) {
					if (dep !== 'exports' && dep != 'module' && dep !== 'require') {
						if (scanned[dep] !== undefined) {
							continue;
						}
						var iscjs = dep.match(cjsVarPrefixRegExp);
						var found = false;
						var dup;
						for (var i = 0; i < seen.length; i++) {
							if (seen[i] === (iscjs ? dep.substring(2) : dep)) {
								found = true;
								dup = dep;
								break;
							}
						}
						if (found) {
							if (circRefs[module.id] === undefined) {
								circRefs[module.id] = {refs: {}};
							}
							circRefs[module.id].refs[iscjs ? dep.substring(2) : dep] = dep;
						} else {
							complete = findCircRefs(iscjs ? dep.substring(2) : dep, seen, scanned);
						}
					}
				}
				scanned[module.id] = true;
				seen.pop();
			}
			return complete;
		}

		for (var id in strands) {
			strands[id] = findCircRefs(id, [], {});
		}
	};

	function processQueues() {
		try {
			processCallbacks();
			var allLoaded = processModules();
			if (allLoaded) {
				modulesLoaded = true;
			}
			processStrands();
			processCallbacks();
			if (!pageLoaded && domLoaded && modulesLoaded) {
				pageLoaded = true;
				for (var i = 0; i < readyCallbacks.length; i++) {
					readyCallbacks[i]();
				}
				document.addEventListener("zazlload", function() {
					if (!processModules()) {
						queueProcessor();
					}
				}, false);
			}
		} catch (e) {
			console.log("queueProcessor error : "+e);
			allLoaded = true;
		}
		return allLoaded;
	};
}());
