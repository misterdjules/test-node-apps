var test = require('tap').test
var execFile = require('child_process').execFile;
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

function gitClone(gitUrl, gitClonePath, cb) {
  debug('Git cloning...');
  var gitCloneArgs = ['clone', gitUrl, gitClonePath];
  execFile('git', gitCloneArgs, function (error, stdout, stderr) {
    cb(error);
  });
}

function npmInstall(workingDir, cb) {
  debug('npm install...');

  var npmInstallArgs = [npmBinPath, 'install'];
  execFile(process.execPath, npmInstallArgs, { cwd: workingDir },
           function (error, stdout, stderr) {
            cb(error);
           });
}

function npmTest(workingDir, cb) {
  debug('npm test...');

  var npmTestArgs = [npmBinPath, 'test'];
  execFile(process.execPath, npmTestArgs, { cwd: workingDir },
           function (error, stdout, stderr) {
             debug('Error with npm test: ' + error);
             cb(error);
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
            npmInstall.bind(global, gitClonePath),
            npmTest.bind(global, gitClonePath),
          ], function (err, results) {
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
