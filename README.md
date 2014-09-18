# What is it?

test-node-apps is a very basic tool to automate testing of some Node.js apps
against a given version of Node.js.

# How to use it?

Simply run:
```
node run-tests.js
```

and it will run the tests for apps specified in `apps-to-test.json`. Tests
results will be available in the `tests-results` directory as separate files
containing TAP output.

## Command line options

### --apps=[app1,app2,...]

Specifies the apps to test as a comma separated list of names. The names have
to follow the `repoName-branchName` pattern, where `repoName` is the name of a
GitHub repository without the `.git` suffix, and `branchName` is a valid
branch name for this repository. The apps have to be listed in the `apps-to-
test.json` file.

For instance, given the current `apps-to-test.json` file, you could choose to
run tests only for express' 3.x branch with the following command:

```
$ node run-tests.js --apps=express-3.x
```

### --list-apps

Lists the apps that can be tested.

## The apps-to-test.json file

This file contains all the information needed to tests the Node.js
applications that have been identified as worthwile and possible to test.
`apps-to-test.json` is a JSON formatted file that defines an array of object.
Each object represents an application to test.

### Adding an application to test

The basic information that is needed to add an application to test is a Git
repository URL and a branch name:

```
{
  "repo": "git://github.com/misterdjules/Ghost.git",
  "branch": "output-tests-results-to-files"
}
```

When running `run-tests.js`, this entry will clone
`git://github.com/misterdjules/Ghost.git` and checkout the branch named
`output-tests-results-to-files`.

Other options can be added to customize the behavior of the test.

#### additional-npm-deps

Allows to specify a list of additional npm modules to install _locally_. This
can help for instance when a Node.js application considers that a dependency
needed to run its tests should be installed globally and you can't install it
globally on the continuous integration platform. For instance, a lot of
projects will require to globally install `grunt-cli`, you can add the
following key to make `run-tests.js` install it locally after it's done
running `npm install` for this application:

```
"additional-npm-deps": ["grunt-cli"],
```

#### npm-test-script

Allows to override which npm script should be run to test this application. By
default, it will invoke `npm test`.

#### tests-results-files

Allows to specify a list of glob patterns that match any files that need to be
retrieved as tests results outputs. For instance, if the npm test script
(either `npm test` or the custom one you specified with the `npm-test-script`
key) produces a test result file in `/foo/bar/baz.tap`, you can retrieve it
and copy it in the `tests-results` directory by adding the following key:

```
"tests-results-files": ["/foo/bar/baz.tap"]
```

#### test-output-from-stdout

A boolean that needs to be set to true if the npm test script for the
application outputs tests results to stdout instead of in a separate file.

#### package-json-change

Allows to transform the package.json file before any other step of the testing
process, that is before installing the application's dependency with `npm
install` and before running any test.

For instance, one might want to change the `test` npm script to use a TAP
reporter rather than a spec reporter because it's easier to parse by a
continuous integration platform:

```
"package-json-change": {
  "scripts": {
    "test": "mocha --reporter tap test/"
  }
}
```

## Debug information

If you'd like to investigate what the program is actually doing, you should
set the `DEBUG` environment variable to `test-node-apps` like so:

```
$ DEBUG=`test-node-apps` node run-tests.js
```
You should then see a lot of debug output like following:
```
test-node-apps Loading apps to test... +0ms
test-node-apps Setup of tests workspace done successfully! +112ms
test-node-apps Looking for npm binary... +0ms
test-node-apps Found npm bin at [/usr/local/bin/npm] +1ms
```
