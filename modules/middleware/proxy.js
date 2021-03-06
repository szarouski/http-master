'use strict';

var http = require('http');
var httpProxy = require('http-proxy');
var url = require('url');
var regexpHelper = require('../../src/regexpHelper');
var assert = require('assert');

function parseEntry(entry) {
  var m;
  if(typeof entry == 'number')
    entry = entry.toString();

  assert(typeof entry === 'string');

  var withPath = false;
  withPath = !!entry.replace(/https?:\/\//, '').match(/.*\//);

  if((m = entry.match(/^\d+(?:|\/.*)$/))) {
    entry = '127.0.0.1:' + entry;
  }
  if(!entry.match(/https?:\/\//)) {
    entry = 'http://' + entry;
  }
  entry = url.parse(entry, true, true);
  entry.withPath = withPath;
  return entry;
}

function getAgent(config, portConfig) {
  var agent = false;
  var agentSettings = portConfig.agentSettings || config.agentSettings;
  if (agentSettings) {
    agent = new http.Agent(agentSettings);
  }
  return agent;
}

module.exports = function ProxyMiddleware(config, portConfig, di) {
  var agent = getAgent(config, portConfig);
  var proxy = httpProxy.createProxyServer({xfwd: true, agent: agent});
  proxy.on('error', function(err, req, res) {
    req.err = err;
    req.next(err);
  });

  var rewriteTargetAndPathIfNeeded = function(req, target) {
    if(!req.match) {
      return target;
    }

    var processed = regexpHelper(target.href, req.match);

    if (req.parsedUrl.search) {
      processed += req.parsedUrl.search;
    }

    var newTarget = url.parse(processed);
    if(target.withPath) {
      req.url = newTarget.path;
    }
    return newTarget;
  };

  return {
    requestHandler: function(req, res, next, dispatchTarget) {
      req.connection.proxy = proxy;
      req.connection.agent = agent;
      req.next = next;
      // workaround for node-http-proxy/#591
      if(!req.headers.host) {
        req.headers.host = '';
      }
      var proxyTarget = rewriteTargetAndPathIfNeeded(req, dispatchTarget);
      var m = req.headers.host.match(/^(.+):(\d+)$/);
      if(m) {
        req.headers.host = m[1] + ':' + m[2];
      }

      // work around weirdness of new http-proxy url handling
      // for the purpose of passing the tests
      if(proxyTarget.pathname !== '/') {
        req.url = '';
      }
      else {
        proxyTarget.path = '';
      }

      var options = {
        target: proxyTarget,
        proxyTimeout: portConfig.proxyTargetTimeout,
        timeout: portConfig.proxyTimeout,
        toProxy: true
      };

      if(req.upgrade) {
        return proxy.ws(req, req.upgrade.socket, req.upgrade.head, options);
      }
      proxy.web(req, res, options);
    },
    entryParser: function(entry) {
      return parseEntry(entry.target || entry);
    }
  };
};