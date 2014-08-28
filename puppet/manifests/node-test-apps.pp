# grunt-cli needs to be installed globally for Grunt to run automated tests
package { 'grunt-cli':
  ensure   => present,
  provider => 'npm'
}

# casperjs and phantomjs are needed by Ghost for functional tests
package { 'casperjs':
  ensure   => present,
  provider => 'npm'
}

package { 'phantomjs':
  ensure   => present,
  provider => 'npm'
}
