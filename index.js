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
  "git://github.com/mikeal/request.git",
  "git://github.com/caolan/async.git",
  "git://github.com/gruntjs/grunt.git",
  "git://github.com/lodash/lodash.git",
  "git://github.com/gulpjs/gulp.git",
  "git://github.com/visionmedia/mocha.git",
  "git://github.com/LearnBoost/mongoose.git",
];

var LONGER_APPS_TO_TEST = [
  "git://github.com/TryGhost/Ghost.git",
  "git://github.com/npm/npm.git",
  "git://github.com/Automattic/socket.io.git",
  "git://github.com/strongloop/express.git",
  "git://github.com/hapijs/hapi.git",
  "git://github.com/Unitech/PM2.git",
]

var TESTS_DIR = path.join(process.cwd(), './tests-workspace');

function getAppNameFromGitUrl(gitUrl) {
  var matches;
  if (gitUrl && (matches = gitUrl.match(/.*\/(.*)\.git/))) {
    return matches[1];
  }
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
          function gitClone(cb) {
            debug('Git cloning...');
            var gitCloneArgs = ['clone', gitUrl, gitClonePath];
            execFile('git', gitCloneArgs, function (error, stdout, stderr) {
              cb(error);
            });
          },
          function npmInstall(cb) {
            debug('npm install...');
            var npmInstallArgs = [npmBinPath, 'install'];
            execFile(process.execPath,
                     npmInstallArgs,
                     { cwd: gitClonePath },
                     function (error, stdout, stderr) {
                      cb(error);
                     });
          },
          function npmTest(cb) {
            debug('npm test...');
            var npmTestArgs = [npmBinPath, 'test'];
            execFile(process.execPath,
                     npmTestArgs,
                     { cwd: gitClonePath },
                     function (error, stdout, stderr) {
                       debug('Error with npm test: ' + error);
                       cb(error);
                     });
          },
          ], function (err, results) {
            t.equal(err, undefined, "git clone && npm install && npm test");
            t.end();
            done();
          });
      });
    }, function allAppsTested(err) {
      debug('All apps tested, done!');
  });
});