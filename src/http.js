'use strict';

var _ = require('lodash');

function $HttpProvider() {

  var defaults = this.defaults = {
    headers: {
      common: {
        Accept: 'application/json, text/plain, */*'
      },
      post: {
        'Content-Type': 'application/json;charset=utf-8'
      },
      put: {
        'Content-Type': 'application/json;charset=utf-8'
      },
      patch: {
        'Content-Type': 'application/json;charset=utf-8'
      }
    }
  };

  this.$get = ['$httpBackend', '$q', '$rootScope', function($httpBackend, $q, $rootScope) {

    function executeHeaderFns(headers, config) {
      return _.transform(headers, function(result, v, k) {
        if (_.isFunction(v)) {
          v = v(config);
          if (_.isNull(v) || _.isUndefined(v)) {
            delete result[k];
          } else {
            result[k] = v;
          }
        }
      }, headers);
    }

    function headersGetter(headers) {
      var headersObj;
      return function(name) {
        headersObj = headersObj || parseHeaders(headers);
        if (name) {
          return headersObj[name.toLowerCase()];
        } else {
          return headersObj;
        }
      };
    }

    function isSuccess(status) {
      return status >= 200 && status < 300;
    }

    function mergeHeaders(config) {
      var reqHeaders = _.extend(
        {},
        config.headers
      );
      var defHeaders = _.extend(
        {},
        defaults.headers.common,
        defaults.headers[(config.method || 'get').toLowerCase()],
        config.headers
      );
      _.forEach(defHeaders, function(value, key) {
        var headerExists = _.some(reqHeaders, function(v, k) {
          return k.toLowerCase() === key.toLowerCase();
        });
        if (!headerExists) {
          reqHeaders[key] = value;
        }
      });
      return executeHeaderFns(reqHeaders, config);
    }

    function parseHeaders(headers) {
      if (_.isObject(headers)) {
        return _.transform(headers, function(result, v, k) {
          result[_.trim(k.toLowerCase())] = _.trim(v);
        }, {});
      }
      var lines = headers.split('\n');
      return _.transform(lines, function(result, line) {
        var separatorAt = line.indexOf(':');
        var name = _.trim(line.substr(0, separatorAt)).toLowerCase();
        var value = _.trim(line.substr(separatorAt + 1));
        if (name) {
          result[name] = value;
        }
      }, {});
    }

    function transformData(data, headers, transform) {
      if (_.isFunction(transform)) {
        return transform(data, headers);
      } else {
        return _.reduce(transform, function(data, fn) {
          return fn(data, headers);
        }, data);
      }
    }

    function $http(requestConfig) {
      var deferred = $q.defer();

      var config = _.extend({
        method: 'GET',
        transformRequest: defaults.transformRequest
      }, requestConfig);
      config.headers = mergeHeaders(requestConfig);

      if (_.isUndefined(config.withCredentials) && !_.isUndefined(defaults.withCredentials)) {
        config.withCredentials = defaults.withCredentials;
      }

      var reqData = transformData(config.data, headersGetter(config.headers), config.transformRequest);

      if(_.isUndefined(reqData)) {
        _.forEach(config.headers, function(v, k) {
          if (k.toLowerCase() === 'content-type') {
            delete config.headers[k];
          }
        });
      }

      function done(status, response, headersString, statusText) {
        status = Math.max(status, 0);
        deferred[isSuccess(status) ? 'resolve' : 'reject']({
          status: status,
          data: response,
          statusText: statusText,
          headers: headersGetter(headersString),
          config: config
        });
        if (!$rootScope.$$phase) {
          $rootScope.$apply();
        }
      }

      $httpBackend(
        config.method,
        config.url,
        reqData,
        done,
        config.headers,
        config.withCredentials
      );
      return deferred.promise;
    }
    $http.defaults = defaults;
    return $http;
  }];

}

module.exports = $HttpProvider;