'use strict';

var _ = require('lodash');

function $CompileProvider($provide) {

  var hasDirectives = {};

  this.directive = function(name, directiveFactory) {
    var self = this;

    if (_.isString(name)) {
      if (name === 'hasOwnProperty') {
        throw 'hasOwnProperty is not a valid directive name';
      }
      if (!hasDirectives.hasOwnProperty(name)) {
        hasDirectives[name] = [];
        $provide.factory(name + 'Directive', ['$injector', function($injector) {
          var factories = hasDirectives[name];
          return _.map(factories, $injector.invoke);
        }]);
      }
      hasDirectives[name].push(directiveFactory);
    } else {
      _.forEach(name, function(directiveFactory, name) {
        self.directive(name, directiveFactory);
      });
    }
  };

  this.$get = function() {

  };
}
$CompileProvider.$inject = ['$provide'];

module.exports = $CompileProvider;
