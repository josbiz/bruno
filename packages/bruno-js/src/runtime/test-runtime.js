const { NodeVM } = require('@usebruno/vm2');
const chai = require('chai');
const path = require('path');
const http = require('http');
const https = require('https');
const stream = require('stream');
const util = require('util');
const zlib = require('zlib');
const url = require('url');
const punycode = require('punycode');
const fs = require('fs');
const { get } = require('lodash');
const Bru = require('../bru');
const BrunoRequest = require('../bruno-request');
const BrunoResponse = require('../bruno-response');
const Test = require('../test');
const TestResults = require('../test-results');
const { cleanJson } = require('../utils');
const { createBruTestResultMethods } = require('../utils/results');

// Inbuilt Library Support
const ajv = require('ajv');
const addFormats = require('ajv-formats');
const atob = require('atob');
const btoa = require('btoa');
const lodash = require('lodash');
const moment = require('moment');
const uuid = require('uuid');
const nanoid = require('nanoid');
const axios = require('axios');
const fetch = require('node-fetch');
const CryptoJS = require('crypto-js');
const NodeVault = require('node-vault');
const xml2js = require('xml2js');
const cheerio = require('cheerio');
const tv4 = require('tv4');
const { executeQuickJsVmAsync } = require('../sandbox/quickjs');

class TestRuntime {
  constructor(props) {
    this.runtime = props?.runtime || 'vm2';
  }

  async runTests(
    testsFile,
    request,
    response,
    envVariables,
    runtimeVariables,
    collectionPath,
    onConsoleLog,
    processEnvVars,
    scriptingConfig,
    runRequestByItemPathname,
    collectionName
  ) {
    const globalEnvironmentVariables = request?.globalEnvironmentVariables || {};
    const collectionVariables = request?.collectionVariables || {};
    const folderVariables = request?.folderVariables || {};
    const requestVariables = request?.requestVariables || {};
    const assertionResults = request?.assertionResults || [];
    const bru = new Bru(envVariables, runtimeVariables, processEnvVars, collectionPath, collectionVariables, folderVariables, requestVariables, globalEnvironmentVariables, {}, collectionName);
    const req = new BrunoRequest(request);
    const res = new BrunoResponse(response);
    const allowScriptFilesystemAccess = get(scriptingConfig, 'filesystemAccess.allow', false);
    const moduleWhitelist = get(scriptingConfig, 'moduleWhitelist', []);
    const additionalContextRoots = get(scriptingConfig, 'additionalContextRoots', []);
    const additionalContextRootsAbsolute = lodash
      .chain(additionalContextRoots)
      .map((acr) => (acr.startsWith('/') ? acr : path.join(collectionPath, acr)))
      .value();

    const whitelistedModules = {};

    for (let module of moduleWhitelist) {
      try {
        whitelistedModules[module] = require(module);
      } catch (e) {
        // Ignore
        console.warn(e);
      }
    }

    // extend bru with result getter methods
    const { __brunoTestResults, test } = createBruTestResultMethods(bru, assertionResults, chai);

    if (!testsFile || !testsFile.length) {
      return {
        request,
        envVariables,
        runtimeVariables,
        globalEnvironmentVariables,
        results: __brunoTestResults.getResults(),
        nextRequestName: bru.nextRequest
      };
    }

    const context = {
      test,
      bru,
      req,
      res,
      expect: chai.expect,
      assert: chai.assert,
      __brunoTestResults: __brunoTestResults
    };

    if (onConsoleLog && typeof onConsoleLog === 'function') {
      const customLogger = (type) => {
        return (...args) => {
          onConsoleLog(type, cleanJson(args));
        };
      };
      context.console = {
        log: customLogger('log'),
        info: customLogger('info'),
        warn: customLogger('warn'),
        debug: customLogger('debug'),
        error: customLogger('error')
      };
    }

    if(runRequestByItemPathname) {
      context.bru.runRequest = runRequestByItemPathname;
    }

    let scriptError = null;

    try {
      if (this.runtime === 'quickjs') {
        await executeQuickJsVmAsync({
          script: testsFile,
          context: context
        });
      } else {
        // default runtime is vm2
        const vm = new NodeVM({
          sandbox: context,
          require: {
            context: 'sandbox',
            external: true,
            root: [collectionPath, ...additionalContextRootsAbsolute],
            mock: {
              // node libs
              path,
              stream,
              util,
              url,
              http,
              https,
              punycode,
              zlib,
              // 3rd party libs
              ajv,
              'ajv-formats': addFormats,
              btoa,
              atob,
              lodash,
              moment,
              uuid,
              nanoid,
              axios,
              chai,
              'node-fetch': fetch,
              'crypto-js': CryptoJS,
              'xml2js': xml2js,
              cheerio,
              tv4,
              ...whitelistedModules,
              fs: allowScriptFilesystemAccess ? fs : undefined,
              'node-vault': NodeVault
            }
          }
        });
        const asyncVM = vm.run(`module.exports = async () => { ${testsFile}}`, path.join(collectionPath, 'vm.js'));
        await asyncVM();
      }
    } catch (error) {
      scriptError = error;
    }

    const result = {
      request,
      envVariables: cleanJson(envVariables),
      runtimeVariables: cleanJson(runtimeVariables),
      globalEnvironmentVariables: cleanJson(globalEnvironmentVariables),
      results: cleanJson(__brunoTestResults.getResults()),
      nextRequestName: bru.nextRequest
    };

    if (scriptError) {
      scriptError.partialResults = result;
      throw scriptError;
    }

    return result;
  }
}

module.exports = TestRuntime;
