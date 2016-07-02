'use strict';

function $QProvider() {
  this.$get = ['$rootScope', function($rootScope) {

    function Deferred() {
      this.promise = new Promise();
    }

    Deferred.prototype.resolve = function(value) {
      if (this.promise.$$state.status) {
        return;
      }
      this.promise.$$state.value = value;
      this.promise.$$state.status = 1;
      scheduleProcessQueue(this.promise.$$state);
    };

    function Promise() {
      this.$$state = {};
    }

    Promise.prototype.then = function(onFulfilled) {
      this.$$state.pending = onFulfilled;
    };

    function defer() {
      return new Deferred();
    }

    function processQueue(state) {
      state.pending(state.value);
    }

    function scheduleProcessQueue(state) {
      $rootScope.$evalAsync(function() {
        processQueue(state);
      });
    }

    return {
      defer: defer
    };
  }];
}

module.exports = $QProvider;
