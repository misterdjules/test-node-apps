var test = require('tap').test
var spawn = require('child_process').spawn;
var fs   = require('fs');
var path = require('path');

var util   = require('util');
var async  = require('async');
var debug  = require('debug')('test-node-apps');
var rimraf = require('rimraf');
var which  = require('which');

var APPS_TO_TEST = [
  "git://github.com/TryGhost/Ghost.git",
  "git://github.com/caolan/async.git",
  "git://github.com/gruntjs/grunt.git",
  "git://github.com/gulpjs/gulp.git",
  "git://github.com/visionmedia/mocha.git",
  "git://github.com/LearnBoost/mongoose.git",
];

var TESTS_DIR = path.join(process.cwd(), './tests-workspace');

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

function npmInstall(workingDir, cb) {
  debug('npm install...');

  var npmInstallArgs = [npmBinPath, 'install'];
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

function npmTest(workingDir, cb) {
  debug('npm test...');

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

function updateEngineToCurrent(workingDir, cb) {
  var packageJsonFilePath = path.join(workingDir, "package.json");
  debug(util.format('Updating engine property in file [%s]', packageJsonFilePath));

  fs.readFile(packageJsonFilePath, function(err, data) {
    if (err) return cb(err);

    try {
      var packageSpecs = JSON.parse(data);
      if (packageSpecs.engines && packageSpecs.engines.node) {
        packageSpecs.engines.node = process.version.substring(1);
        return fs.writeFile(packageJsonFilePath,
                            JSON.stringify(packageSpecs, null, " "),
                            cb);
      }
    } catch(e) {
      return cb(e);
    }

    return cb();
  });
}

var npmBinPath;
async.series([
  function rmRfTests(cb) {
    rimraf(TESTS_DIR, cb);
  },
  function createTestsDir(cb) {
    fs.mkdir(TESTS_DIR, cb);
  },
  function findNpmBinPath(cb) {
    debug('Looking for npm binary...');
    if (process.platform === 'win32') {
      npmBinPath = path.join("/", "Program Files (x86)",
                             "nodejs",
                             "node_modules",
                             "npm",
                             "bin", "npm-cli.js");
      cb();
    } else {
      which('npm', function (err, path) {
        if (!err && path) {
          npmBinPath = path.replace('.CMD', '');
        }

        debug('Found npm binary in ' + npmBinPath);
        cb(err);
      });
    }
  }
  ], function (err, results) {
    debug('Setup stage: ' + err);

    async.eachSeries(APPS_TO_TEST, function (gitUrl, done) {

      var appName = getAppNameFromGitUrl(gitUrl);
      debug('Adding test for app [%s]', appName);

      var gitClonePath = path.join(TESTS_DIR, appName);
      debug('Git clone path: ' + gitClonePath);

      var testTitle = util.format("Make sure that %s works correctly with Node.js %s",
        appName,
        process.version);

      test(testTitle, { timeout: 1000000 }, function appTest(t) {
        async.series([
            gitClone.bind(global, gitUrl, gitClonePath),
            updateEngineToCurrent.bind(global, gitClonePath),
            npmInstall.bind(global, gitClonePath),
            npmTest.bind(global, gitClonePath),
          ], function (err, results) {
            if (err) {
              debug('Error:');
              debug(err);
            }

            t.equal(err, undefined,
                    util.format("git clone && npm install && npm test for %s",
                                appName));
            t.end();
            done();
          });
      });
    }, function allAppsTested(err) {
      debug('All apps tested, done!');
  });
});