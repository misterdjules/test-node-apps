var async = require('async');
var child_process = require('child_process');
var debug = require('debug')('install-deps');
var util = require('util');

var packages = [
    "grunt-cli",
    "casperjs",
    "phantomjs"
]

async.eachSeries(packages, function (packageName, done) {
    var installCmd = util.format('npm install -g %s', packageName);
    debug('Running command [%s]', installCmd);

    child_process.exec(installCmd, function (err, stdout, stderr) {
        debug(util.format('Done running cmd [%s] ', installCmd));
        if (stdout) {
            debug('stdout:');
            debug(stdout);
        }

        if (stderr) {
            debug('stderr:');
            debug(stderr);
        }

        done(err);
    });
}, function(err, results) {
    if (err) {
        console.error('Installation failed!');
        console.error(err);
        process.exit(1);
    }
});

