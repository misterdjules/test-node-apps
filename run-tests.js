var spawn = require('child_process').spawn;
var fs   = require('fs');
var path = require('path');
var assert = require('assert');
var util   = require('util');

var async  = require('async');
var debug  = require('debug')('test-node-apps');
var rimraf = require('rimraf');
var which  = require('which');
var argv = require('minimist')(process.argv.slice(2));
var glob = require('glob');
var split = require('split');

var TESTS_DIR = path.join(process.cwd(), 'tests-workspace');
var TESTS_RESULTS_DIR = path.join(process.cwd(), 'tests-results');
var APPS_TO_TEST_FILE_PATH = './apps-to-test.json';

function getAppNameFromGitUrl(gitUrl) {
  var matches;
  if (gitUrl && (matches = gitUrl.match(/.*\/(.*)\.git/))) {
    return matches[1];
  }
}

function getAppName(appToTest) {
  return getAppNameFromGitUrl(appToTest.repo);
}

function handleExitCode(code, stderr, cb) {
  var error;
  if (code !== 0) {
    var errMsg = "Command failed!";
    if (stderr) {
      errMsg += "\nreason: " + stderr.toString();
    }
    error = new Error(errMsg);
  }

  return cb(error);
}

function changeObject(object, change) {
  if (typeof object === 'object' && typeof change === 'object') {
    Object.keys(object).forEach(function(key) {
      if (key in change) {
        object[key] = changeObject(object[key], change[key]);
      }
    });
  } else {
    var matches;
    if (matches = /^%({.*})%$/.exec(change)) {
      object = eval(matches[1]);
    } else {
      object = change;
    }
  }

  return object;
}

function gitClone(gitUrl, gitClonePath, cb) {
  debug(util.format('Git cloning from [%s] to [%s]...',
                    gitUrl,
                    gitClonePath));

  var gitCloneArgs = ['clone', gitUrl, gitClonePath];
  var spawnedGitClone = spawn('git', gitCloneArgs);
  var stderr;

  spawnedGitClone.on('exit', function onGitCloneExited(code) {
    return handleExitCode(code, stderr, cb);
  });

  spawnedGitClone.on('error', function onGitCloneError(err) {
    return cb(err);
  });

  spawnedGitClone.stderr.on('data', function(data) {
    stderr += data;
  });
}

function gitCheckout(gitClonePath, gitBranchName, cb) {
  debug(util.format('Git checkout branch [%s] in directory [%s]...',
                    gitBranchName, gitClonePath));

  var gitCheckoutArgs = ['checkout', gitBranchName];
  var spawnedGitCheckout = spawn('git',
                                 gitCheckoutArgs,
                                 { cwd: gitClonePath });
  var stderr;

  spawnedGitCheckout.on('exit', function onGitCheckoutExited(code) {
    return handleExitCode(code, stderr, cb);
  });

  spawnedGitCheckout.on('error', function onGitCheckoutError(err) {
    return cb(err);
  });

  spawnedGitCheckout.stderr.on('data', function(data) {
    stderr += data;
  });
}

function npmInstall(npmBinPath, workingDir, packages, cb) {

  assert(npmBinPath);

  if (typeof packages === 'function') {
    cb = packages;
    packages = null;
  }

  if (packages) {
    debug(util.format('npm install packages: [%s]', packages.join(', ')));
  } else {
    debug('npm install');
  }

  var npmInstallArgs = [npmBinPath, 'install'];

  // Pass additional npm arguments verbatim to npm install
  if (argv.nodedir) {
    npmInstallArgs.push('--nodedir=' + argv.nodedir);
  }

  if (packages) {
    npmInstallArgs = npmInstallArgs.concat(packages);
  }

  var spawnedNpmInstall = spawn(process.execPath,
                                npmInstallArgs,
                                { cwd: workingDir, env: process.env });
  var stderr;

  spawnedNpmInstall.on('exit', function onNpmInstallExited(code) {
    debug('exit code:' + code);
    return handleExitCode(code, stderr, cb);
  });

  spawnedNpmInstall.on('error', function onNpmInstallError(err) {
    return cb(err);
  });

  spawnedNpmInstall.stderr.on('data', function(data) {
    debug("stderr: " + data.toString());
    stderr += data;
  });

  spawnedNpmInstall.stdout.on('data', function(data) {
    debug("stdout: " + data.toString());
  });
}

function npmTest(npmBinPath, appToTest, cb) {
  assert(typeof npmBinPath === 'string', "npmBinPath must be a string");
  assert(typeof appToTest === 'object' && appToTest != null,
         'appToTest must be a non-null object');

  var npmTestScript = appToTest['npm-test-script'] || 'test';
  assert(typeof npmTestScript === 'string', "npmTestScript must be a string");
  debug('npm test script to run: [%s]', npmTestScript);

  var workingDir = getGitClonePathForApp(appToTest);
  assert(typeof workingDir === 'string', 'workingDir must be a valid string');

  var npmTestArgs = [npmBinPath, '--silent', 'run', npmTestScript];

  var augmentedEnv;
  var additionalEnvVars = appToTest['additional-env-vars'];
  if (additionalEnvVars) {
    debug('Augmenting npm test process environment...');

    Object.keys(process.env).forEach(function(envVar) {
      if (!augmentedEnv) augmentedEnv = {};
      augmentedEnv[envVar] = process.env[envVar];
    });

    debug('additionalEnvVars: ' + additionalEnvVars);
    additionalEnvVars.forEach(function(envVarString) {
      var envVar = envVarString.split('=');
      if (envVar.length === 2) {
        if (!augmentedEnv) augmentedEnv = {};

        debug(util.format('Adding env var [%s]=[%s]', envVar[0], envVar[1]));
        augmentedEnv[envVar[0]] = envVar[2];
      }
    })
  }

  var testOutputStream;
  if (appToTest['test-output-from-stdout']) {
    var testOutputFilename = util.format('%s-%s-%s',
                                         getAppName(appToTest),
                                         appToTest.branch,
                                         'results.tap');
    testOutputStream = fs.createWriteStream(path.join(TESTS_RESULTS_DIR,
                                                      testOutputFilename));
  }

  var spawnedNpmTest = spawn(process.execPath,
                             npmTestArgs,
                             { cwd: workingDir,
                               env: (augmentedEnv ? augmentedEnv : process.env) });
  var stderr;

  spawnedNpmTest.on('exit', function onNpmTestClosed(code) {
    if (testOutputStream) {
      testOutputStream.end();
    }

    return handleExitCode(code, stderr, cb);
  });

  spawnedNpmTest.on('error', function onNpmInstallClosed(err) {
    if (testOutputStream) {
      testOutputStream.end();
    }

    return cb(err);
  });

  spawnedNpmTest.stderr.on('data', function(data) {
    debug("npm test stderr: " + data.toString());
    stderr += data;
  });

  if (testOutputStream) {
    fixTapOutput(appToTest, spawnedNpmTest.stdout, testOutputStream);
  }

  spawnedNpmTest.stdout.on('data', function(data) {
    debug('npm test stdout: ', data.toString());
  });
}

function updatePackageJson(workingDir, packageJsonChange, cb) {
  if (typeof packageJsonChange === 'function') {
    cb = packageJsonChange;
    packageJsonChange = undefined;
  }

  var packageJsonFilePath = path.join(workingDir, "package.json");
  debug(util.format('Updating package json file [%s]',
                    packageJsonFilePath));

  fs.readFile(packageJsonFilePath, function(err, data) {
    if (err) return cb(err);

    try {
      var packageSpecs = JSON.parse(data);

      debug('Object to change:');
      debug(packageSpecs);

      debug('Change to apply:');
      debug(packageJsonChange);

      changeObject(packageSpecs, packageJsonChange);
      return fs.writeFile(packageJsonFilePath,
                          JSON.stringify(packageSpecs, null, " "),
                          cb);
    } catch(e) {
      return cb(e);
    }

    return cb();
  });
}

function findNpmBinPath(cb) {
  var npmBinPath;

  debug('Looking for npm binary...');

  if (process.platform === 'win32') {
    var driveLetters = ['C', 'D'];
    var npmPaths = [  path.join("/", "Program Files (x86)",
                                "nodejs",
                                "node_modules",
                                "npm",
                                "bin", "npm-cli.js"),
                      path.join("/", "Program Files",
                                "nodejs",
                                "node_modules",
                                "npm",
                                "bin", "npm-cli.js")
                    ];
    var npmBinCandidates = [];
    driveLetters.forEach(function(driveLetter) {
      npmPaths.forEach(function(npmPath) {
        npmBinCandidates.push(path.join(driveLetter + ':', npmPath));
      })
    });

    var npmBinPath;
    async.some(npmBinCandidates, function(npmBinCandidate, found) {
      debug(util.format('Trying with [%s]', npmBinCandidate));

      fs.stat(npmBinCandidate, function(err) {
        if (!err) {
          npmBinPath = npmBinCandidate;
          return found(true);
        }

        return found(false);
      });
    }, function(npmBinFound) {
      var err;
      if (!npmBinFound) {
        err = new Error("Could not find npm bin path");
      }

      return cb(err, npmBinPath);
    });
  } else {
    which('npm', function (err, path) {
      if (!err && path) {
        npmBinPath = path.replace('.CMD', '');
      }

      return cb(err, npmBinPath);
    });
  }
}

function loadAppsToTest(cb) {
  debug('Loading apps to test...');

  fs.readFile(APPS_TO_TEST_FILE_PATH, function(err, data) {
    var appsToTest;
    if (!err) {
      try {
         appsToTest = JSON.parse(data);
      } catch(e) {
        err = e;
      }
    }

    return cb(err, appsToTest);
  });
}

function getGitClonePathForApp(appToTest) {
  var appName = getAppName(appToTest);
  assert(appName);

  return path.join(TESTS_DIR, appName + '-' + appToTest['branch']);
}

function runTestForApp(npmBinPath, appToTest, cb) {
  assert(npmBinPath);
  assert(appToTest);

  var appRepo = appToTest.repo;
  debug(util.format('App repository is: [%s]', appRepo));
  assert(appRepo);

  var gitBranch = appToTest.branch;
  debug(util.format('App repository\'s branch is [%s]', gitBranch));

  var appName = getAppName(appToTest);
  debug('Adding test for app [%s]', appName);
  assert(appName);

  var gitClonePath = getGitClonePathForApp(appToTest);
  debug('Git clone path: ' + gitClonePath);
  assert(gitClonePath);

  var additionalNpmDeps = appToTest["additional-npm-deps"];
  if (additionalNpmDeps) {
    debug('Additional npm deps will be installed: ' +
          additionalNpmDeps.join(", "));
  }

  debug('Starting test...');

  var testTasks = [
    gitClone.bind(global,
                  appRepo,
                  gitClonePath)
  ];

  if (gitBranch) {
    testTasks.push(gitCheckout.bind(global, gitClonePath, gitBranch));
  }

  if (appToTest["package-json-change"]) {
    testTasks.push(updatePackageJson.bind(global,
                                          gitClonePath,
                                          appToTest["package-json-change"]));
  }

  testTasks = testTasks.concat([
      npmInstall.bind(global, npmBinPath, gitClonePath),
      npmInstall.bind(global, npmBinPath, gitClonePath, additionalNpmDeps),
      npmTest.bind(global, npmBinPath, appToTest),
    ]);

  async.series(testTasks, function (err, results) {
    if (err) {
      debug('Error:');
      debug(err);
    }

    return cb();
  });
}

function makeTapLineCompatibleWithJenkins(tapLine) {
  tapLine = tapLine.replace(/^\s/, '# ');
  return tapLine;
}

function addAppNameToTestDescription(tapLine, appName) {
  return tapLine.replace(/^(.*ok\s\d+\s)(.*)/,
                        function(match, result, testDesc) {
                          return result + ' ' + appName + ' ' + testDesc;
                        });
}

function fixTapOutput(appToTest, tapInputStream, fixedTapOutputStream, cb) {
  assert(typeof tapInputStream === 'object',
         'tapInputStream must be a non-null object');
  assert(typeof fixedTapOutputStream === 'object',
         'fixedTapOutputStream must be a non-null object');

  tapInputStream.pipe(split())
  .on('data', function(line) {
    var adjustedLine = makeTapLineCompatibleWithJenkins(line.toString());
    var appTitle = util.format('%s-%s',
                               getAppName(appToTest),
                               appToTest.branch);
    adjustedLine = addAppNameToTestDescription(adjustedLine, appTitle);
    fixedTapOutputStream.write(adjustedLine + '\n');
  })
  .on('end', function() {
    fixedTapOutputStream.end();
    if (cb) cb();
  });
}

function retrieveTapFiles(appToTest, cb) {
  var gitClonePath = getGitClonePathForApp(appToTest);
  debug(util.format('Retrieving tap files from directory [%s]...',
                    gitClonePath));

  glob(path.join(gitClonePath, '*.tap'), function(err, files) {
    if (!err) {
      async.eachSeries(files, function(srcFilepath, done) {
        var dstFilename = util.format('%s-%s-%s',
                                      getAppName(appToTest),
                                      appToTest.branch,
                                      path.basename(srcFilepath));
        var dstFilepath = path.join(TESTS_RESULTS_DIR, dstFilename);

        debug(util.format('Copying file [%s] to [%s]',
                          srcFilepath,
                          dstFilepath));


        var adjustedTapStream = fs.createWriteStream(dstFilepath);
        var tapInputStream = fs.createReadStream(srcFilepath);
        fixTapOutput(appToTest, tapInputStream, adjustedTapStream, done)
      }, cb);
    } else {
      return cb(err);
    }
  });
}

function retrieveAdditionalResultsFiles(app, cb) {
  var gitClonePath = getGitClonePathForApp(app);

  var patterns = app['tests-results-files'];
  if (patterns) {
    return async.eachSeries(patterns, function(pattern, patternDone) {

      debug(util.format('Retrieving additional files with pattern: [%s]',
                        pattern));

      glob(path.join(gitClonePath, pattern), function(err, files) {
        if (!err) {
          return async.each(files, function(srcFilepath, fileDone) {
            var srcFilename = path.basename(srcFilepath);
            var dstFilename = getAppName(app) + '-' + srcFilename;
            var dstFilepath = path.join(TESTS_RESULTS_DIR, dstFilename);

            debug(util.format('Copying file [%s] to [%s]',
                              srcFilepath,
                              dstFilepath));

            fs.createReadStream(srcFilepath)
            .pipe(fs.createWriteStream(dstFilepath))
            .on('finish', fileDone);
          }, patternDone);
        } else {
          return patternDone(err);
        }
      });
    }, cb);
  } else {
    return cb();
  }
}

function setupTestsWorkspace(cb) {
  async.series([
    rimraf.bind(this, TESTS_DIR),
    fs.mkdir.bind(this, TESTS_DIR),
    rimraf.bind(this, TESTS_RESULTS_DIR),
    fs.mkdir.bind(this, TESTS_RESULTS_DIR),
  ], cb);
}

function listApps(cb) {
  loadAppsToTest(function(err, appsToTest) {
    if (!err && appsToTest) {
      var apps = {}
      apps.list = [];

      appsToTest.forEach(function(appToTest) {
        appToTest.branch = appToTest.branch || 'master';
        var appName = getAppNameFromGitUrl(appToTest.repo);
        appName = util.format('%s-%s', appName, appToTest.branch);
        appToTest.name = appName;
        apps.list.push(appToTest);
        apps[appName] = appToTest;
      });
    }

    return cb(err, apps);
  })
}

function runTestForApps(npmBinPath, apps, cb) {
  assert(npmBinPath, "A path to npm's module must be provided");
  assert(apps, "A list of applications to test must be provided");
  assert(cb, "A callback must be provided");

  if (!apps) {
    return cb();
  }

  async.eachSeries(apps, function(app, done) {
    async.series([
      runTestForApp.bind(global, npmBinPath, app),
      retrieveTapFiles.bind(global, app),
      retrieveAdditionalResultsFiles.bind(global, app)
    ], function(err, results) {
      debug(util.format('App [%s] tested!', getAppName(app)));
      done(err);
    });
  }, function allAppsTested(err, results) {
    return cb(err);
  });
}

function displayAppsList(appsList) {
  appsList.forEach(function(appToTest) {
    console.log('  * ' + appToTest.name);
    console.log('    - ' + 'Git URL: ', appToTest.repo);
  });
}

listApps(function(err, apps) {
  if (err) {
    console.error('Could not list applications to test: ', err);
    process.exit(1);
  }

  if (argv["list-apps"]) {
    console.log('Applications to test:')
    displayAppsList(apps.list);
  } else {
    setupTestsWorkspace(function(err) {
      if (err) {
        console.error('Error when setting up tests workspace: ', err);
        process.exit(1);
      } else {
        debug('Setup of tests workspace done successfully!');
      }

      var appsToTest = apps.list;
      if (argv["apps"]) {
        appsToTest = [];
        argv["apps"].split(',').forEach(function(appName) {
          if (!apps[appName]) {
            console.error('Could not find app with name [%s]', appName);
            console.error('Available apps are:');
            displayAppsList(apps.list);
            process.exit(1);
          }

          appsToTest.push(apps[appName]);
        });
      }

      findNpmBinPath(function(err, npmBinPath) {
        debug(util.format('Found npm bin at [%s]', npmBinPath));
        runTestForApps(npmBinPath, appsToTest, function(err) {
          debug('All apps tested!');
        });
      });

    });
  }
});
