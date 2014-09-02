var spawn = require('child_process').spawn;
var fs   = require('fs');
var path = require('path');
var assert = require('assert');
var util   = require('util');

var test = require('tap').test
var async  = require('async');
var debug  = require('debug')('test-node-apps');
var rimraf = require('rimraf');
var which  = require('which');
var argv = require('minimist')(process.argv.slice(2));

var TESTS_DIR = path.join(process.cwd(), './tests-workspace');
var APPS_TO_TEST_FILE_PATH = './apps-to-test.json';

function getAppNameFromGitUrl(gitUrl) {
  var matches;
  if (gitUrl && (matches = gitUrl.match(/.*\/(.*)\.git/))) {
    return matches[1];
  }
}

function handleExitCode(code, stderr, cb) {
  var error;
  if (code !== 0) {
    var errMsg = "command failed:\n" + stderr.toString();
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
  debug('Git cloning...');
  var gitCloneArgs = ['clone', gitUrl, gitClonePath];
  var spawnedGitClone = spawn('git', gitCloneArgs);
  var stderr;

  spawnedGitClone.on('exit', function onGitCloneClosed(code) {
    return handleExitCode(code, stderr, cb);
  });

  spawnedGitClone.on('error', function onGitCloneClosed(err) {
    return cb(err);
  });

  spawnedGitClone.stderr.on('data', function(data) {
    stderr += data;
  });
}

function npmInstall(npmBinPath, workingDir, packages, cb) {
  debug('npm install...');
  assert(npmBinPath);

  if (typeof packages === 'function') {
    cb = packages;
    packages = null;
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

  spawnedNpmInstall.on('exit', function onNpmInstallClosed(code) {
    debug('exit code:' + code);
    return handleExitCode(code, stderr, cb);
  });

  spawnedNpmInstall.on('error', function onNpmInstallClosed(err) {
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

function npmTest(npmBinPath, workingDir, cb) {
  debug('npm test...');
  assert(npmBinPath);

  var npmTestArgs = [npmBinPath, 'test'];
  var spawnedNpmTest = spawn(process.execPath,
                             npmTestArgs,
                             { cwd: workingDir });
  var stderr;

  spawnedNpmTest.on('exit', function onNpmTestClosed(code) {
    return handleExitCode(code, stderr, cb);
  });

  spawnedNpmTest.on('error', function onNpmInstallClosed(err) {
    return cb(err);
  });

  spawnedNpmTest.stderr.on('data', function(data) {
    debug("npm test stderr: " + data.toString());
    stderr += data;
  });

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
    npmBinPath = path.join("/", "Program Files (x86)",
                           "nodejs",
                           "node_modules",
                           "npm",
                           "bin", "npm-cli.js");
    return cb(null, npmBinPath);
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

function runTestForApp(npmBinPath, appToTest, cb) {
  assert(npmBinPath);
  assert(appToTest);

  var appRepo = appToTest.repo;
  debug(util.format('App repository is: [%s]', appRepo));
  assert(appRepo);

  var appName = getAppNameFromGitUrl(appRepo);
  debug('Adding test for app [%s]', appName);
  assert(appName);

  var gitClonePath = path.join(TESTS_DIR, appName);
  debug('Git clone path: ' + gitClonePath);
  assert(gitClonePath);

  var additionalNpmDeps = appToTest["additional-npm-deps"];
  if (additionalNpmDeps) {
    debug('Additional npm deps will be installed: ' +
          additionalNpmDeps.join(", "));
  }

  var testTitle = "git clone && npm install && npm test for " + appName;

  test(testTitle, { timeout: 1000000 }, function appTest(t) {
    var testTasks = [ gitClone.bind(global, appRepo, gitClonePath) ];

    if (appToTest["package-json-change"]) {
      testTasks.push(updatePackageJson.bind(global,
                                            gitClonePath,
                                            appToTest["package-json-change"]));
    }

    testTasks = testTasks.concat([
        npmInstall.bind(global, npmBinPath, gitClonePath),
        npmInstall.bind(global, npmBinPath, gitClonePath, additionalNpmDeps),
        npmTest.bind(global,    npmBinPath, gitClonePath),
      ]);

    async.series(testTasks, function (err, results) {
      if (err) {
        debug('Error:');
        debug(err);
      }

      var testMessage = util.format("%s with Node %s", appName,
                                    process.version);
      t.equal(err, undefined, testMessage);

      t.end();
      return cb();
    });
  });
}

function setupTestsWorkspace(cb) {
  async.series([
    rimraf.bind(this, TESTS_DIR),
    fs.mkdir.bind(this, TESTS_DIR),
  ], cb);
}

function listApps(cb) {
  loadAppsToTest(function(err, appsToTest) {
    if (!err && appsToTest) {
      var apps = {}
      apps.list = [];

      appsToTest.forEach(function(appToTest) {
        var appName = getAppNameFromGitUrl(appToTest.repo);
        appToTest.name = appName;
        apps.list.push(appToTest);
        apps[appName] = appToTest;
      });
    }

    return cb(err, apps);
  })
}

function runTestForApps(npmBinPath, apps, cb) {
  assert(npmBinPath);
  assert(apps);
  assert(cb);

  if (!apps) {
    return cb();
  }

  async.eachSeries(apps, function(app, done) {
    runTestForApp(npmBinPath, app, done);
  }, function allAppsTested(err, results) {
    return cb(err);
  });
}

listApps(function(err, apps) {
  if (err) {
    console.error('Could not list applications to test: ', err);
    process.exit(1);
  }

  if (argv["list-apps"]) {
    console.log('Applications to test:')
    apps.list.forEach(function(appToTest) {
      console.log('  * ' + appToTest.name);
      console.log('    - ' + 'Git URL: ', appToTest.repo);
    });
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
          appsToTest.push(apps[appName]);
        });
      }

      findNpmBinPath(function(err, npmBinPath) {
        runTestForApps(npmBinPath, appsToTest, function(err) {
          debug('All apps tested!');
        });
      });

    });
  }
});
