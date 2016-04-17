'use strict';

var _ = require('lodash');

var ESCAPES = {'n':'\n', 'f':'\f', 'r':'\r', 't':'\t',
  'v':'\v', '\'':'\'', '"':'"'};

var CALL = Function.prototype.call;
var APPLY = Function.prototype.apply;
var BIND = Function.prototype.bind;
var OPERATORS = {
  '+': true,
  '!': true,
  '-': true,
  '*': true,
  '/': true,
  '%': true,
  '=': true,
  '==': true,
  '!=': true,
  '===': true,
  '!==': true,
  '<': true,
  '>': true,
  '<=': true,
  '>=': true,
  '&&': true,
  '||': true,
  '|': true
};

function assignableAST(ast) {
  if (ast.body.length == 1 && isAssignable(ast.body[0])) {
    return {
      type: AST.AssignmentExpression,
      left: ast.body[0],
      right: {type: AST.NGValueParameter}
    };
  }
}

function constantWatchDelegate(scope, listenerFn, valueEq, watchFn) {
  var unwatch = scope.$watch(
    function() {
      return watchFn(scope);
    },
    function(newValue, oldValue, scope) {
      if (_.isFunction(listenerFn)) {
        listenerFn.apply(this, arguments);
      }
      unwatch();
    },
    valueEq
  );
  return unwatch;
}

function inputsWatchDelegate(scope, listenerFn, valueEq, watchFn) {
  var inputExpressions = watchFn.inputs;
  var oldValues = _.times(inputExpressions.length, _.constant(function () { }));
  var lastResult;

  return scope.$watch(function () {
    var changed = false;
    _.forEach(inputExpressions, function (inputExpr, i) {
      var newValue = inputExpr(scope);
      if (changed || !expressionInputDirtyCheck(newValue, oldValues[i])) {
        changed = true;
        oldValues[i] = newValue;
      }
    });
    if (changed) {
      lastResult = watchFn(scope);
    }
    return lastResult;
  }, listenerFn, valueEq);
}

function oneTimeLiteralWatchDelegate(scope, listenerFn, valueEq, watchFn) {
  function isAllDefined(val) {
    return !_.any(val, _.isUndefined);
  }

  var unwatch = scope.$watch(
    function() {
      return watchFn(scope);
    }, function(newValue, oldValue, scope) {
      if (_.isFunction(listenerFn)) {
        listenerFn.apply(this, arguments);
      }
      if (isAllDefined(newValue)) {
        scope.$$postDigest(function() {
          if (isAllDefined(newValue)) {
            unwatch();
          }
        });
      }
    },
    valueEq
  );
  return unwatch;
}

function oneTimeWatchDelegate(scope, listenerFn, valueEq, watchFn) {
  var lastValue;
  var unwatch = scope.$watch(
    function() {
      return watchFn(scope);
    },
    function(newValue, oldValue, scope) {
      lastValue = newValue;
      if (_.isFunction(listenerFn)) {
        listenerFn.apply(this, arguments);
      }
      if (!_.isUndefined(newValue)) {
        scope.$$postDigest(function() {
          if (!_.isUndefined(lastValue)) {
            unwatch();
          }
        });
      }
    },
    valueEq
  );
  return unwatch;
}

function ensureSafeFunction(obj) {
  if (obj) {
    if (obj.constructor === obj) {
      throw 'Referencing Function in Angular expressions is disallowed!';
    } else if (obj === CALL || obj === APPLY || obj === BIND) {
      throw 'Referencing call, apply, or bind in Angular expressions is disallowed!';
    }
  }
  return obj;
}

function ensureSafeMemberName(name) {
  if (name === 'constructor' || name === '__proto__' ||
      name === '__defineGetter__' || name === '__defineSetter__' ||
      name === '__lookupGetter__' || name === '__lookupSetter__') {
    throw 'Attempting to access a disallowed field in Angular expression!';
  }
}

function ensureSafeObject(obj) {
  if (obj) {
    if (obj.window === window) {
      throw 'Referencing window in Angular expressions is disallowed!';
    } else if (obj.children &&
      (obj.nodeName || (obj.prop && obj.attr && obj.find))) {
      throw 'Referencing DOM nodes in Angular expressions is disallowed!';
    } else if (obj.constructor === obj) {
      throw 'Referencing Function in Angular expressions is disallowed!';
    } else if (obj === Object) {
      throw 'Referencing Object in Angular expressions is disallowed!';
    }
  }
  return obj;
}

function expressionInputDirtyCheck(newValue, oldValue) {
  return newValue === oldValue ||
    (typeof newValue === 'number' && typeof oldValue === 'number' &&
     isNaN(newValue) && isNaN(oldValue));
}

function getInputs(ast) {
  if (ast.length !== 1) {
    return;
  }
  var candidate = ast[0].toWatch;
  if (candidate.length !== 1 || candidate[0] !== ast[0]) {
    return candidate;
  }
}

function isAssignable(ast) {
  return ast.type === AST.Identifier || ast.type === AST.MemberExpression;
}

function ifDefined(value, defaultValue) {
  return typeof value === 'undefined' ? defaultValue : value;
}

function isLiteral(ast) {
  return ast.body.length === 0 ||
      ast.body.length === 1 && (
        ast.body[0].type === AST.Literal ||
        ast.body[0].type === AST.ArrayExpression ||
        ast.body[0].type === AST.ObjectExpression
      );
}

function markConstantAndWatchExpression(ast, $filter) {
  var allConstants;
  var argsToWatch;
  switch (ast.type) {
    case AST.ArrayExpression:
      allConstants = true;
      argsToWatch = [];
      _.forEach(ast.elements, function(element) {
        markConstantAndWatchExpression(element, $filter);
        allConstants = allConstants && element.constant;
        if (!element.constant) {
          argsToWatch.push.apply(argsToWatch, element.toWatch);
        }
      });
      ast.constant = allConstants;
      ast.toWatch = argsToWatch;
      break;
    case AST.AssignmentExpression:
      markConstantAndWatchExpression(ast.left, $filter);
      markConstantAndWatchExpression(ast.right, $filter);
      ast.constant = ast.left.constant && ast.right.constant;
      ast.toWatch = [ast];
      break;
    case AST.BinaryExpression:
      markConstantAndWatchExpression(ast.left, $filter);
      markConstantAndWatchExpression(ast.right, $filter);
      ast.constant = ast.left.constant && ast.right.constant;
      ast.toWatch = ast.left.toWatch.concat(ast.right.toWatch);
      break;
    case AST.CallExpression:
      var stateless = ast.filter && !$filter(ast.callee.name).$stateful;
      allConstants = stateless ? true : false;
      argsToWatch = [];
      _.forEach(ast.arguments, function(arg) {
        markConstantAndWatchExpression(arg, $filter);
        allConstants = allConstants && arg.constant;
        if (!arg.constant) {
          argsToWatch.push.apply(argsToWatch, arg.toWatch);
        }
      });
      ast.constant = allConstants;
      ast.toWatch = stateless ? argsToWatch : [ast];
      break;
    case AST.ConditionalExpression:
      markConstantAndWatchExpression(ast.test, $filter);
      markConstantAndWatchExpression(ast.consequent, $filter);
      markConstantAndWatchExpression(ast.alternate, $filter);
      ast.constant = ast.test.constant && ast.consequent.constant && ast.alternate.constant;
      ast.toWatch = [ast];
      break;
    case AST.Identifier:
      ast.constant = false;
      ast.toWatch = [ast];
      break;
    case AST.Literal:
      ast.constant = true;
      ast.toWatch = [];
      break;
    case AST.LogicalExpression:
      markConstantAndWatchExpression(ast.left, $filter);
      markConstantAndWatchExpression(ast.right, $filter);
      ast.constant = ast.left.constant && ast.right.constant;
      ast.toWatch = [ast];
      break;
    case AST.MemberExpression:
      markConstantAndWatchExpression(ast.object, $filter);
      if (ast.computed) {
        markConstantAndWatchExpression(ast.property, $filter);
      }
      ast.constant = ast.object.constant && (!ast.computed || ast.property.constant);
      ast.toWatch = [ast];
      break;
    case AST.ObjectExpression:
      allConstants = true;
      argsToWatch = [];
      _.forEach(ast.properties, function(property) {
        markConstantAndWatchExpression(property.value, $filter);
        allConstants = allConstants && property.value.constant;
        if (!property.value.constant) {
          argsToWatch.push.apply(argsToWatch, property.value.toWatch);
        }
      });
      ast.constant = allConstants;
      ast.toWatch = argsToWatch;
      break;
    case AST.Program:
      allConstants = true;
      _.forEach(ast.body, function(expr) {
        markConstantAndWatchExpression(expr, $filter);
        allConstants = allConstants && expr.constant;
      });
      ast.constant = allConstants;
      break;
    case AST.ThisExpression:
      ast.constant = false;
      ast.toWatch = [];
      break;

    case AST.UnaryExpression:
      markConstantAndWatchExpression(ast.argument, $filter);
      ast.constant = ast.argument.constant;
      ast.toWatch = ast.argument.toWatch;
      break;
  }
}

function Lexer() {

}

Lexer.prototype.is = function(chs) {
  return chs.indexOf(this.ch) >= 0;
};

Lexer.prototype.isExpOperator = function(ch) {
  return ch === '-' || ch === '+' || this.isNumber(ch);
};

Lexer.prototype.isIdent = function(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
    ch === '_' || ch === '$';
};

Lexer.prototype.isNumber = function(ch) {
  return '0' <= ch && ch <= '9';
};

Lexer.prototype.isWhitespace = function(ch) {
  return ch === ' ' || ch === '\r' || ch === '\t' ||
         ch === '\n' || ch === '\v' || ch === '\u00A0';
};

Lexer.prototype.peek = function(n) {
  n = n || 1;
  return this.index + n < this.text.length ?
    this.text.charAt(this.index + n) :
    false;
};

Lexer.prototype.lex = function(text) {
  this.text = text;
  this.index = 0;
  this.ch = undefined;
  this.tokens = [];

  while (this.index < this.text.length) {
    this.ch = this.text.charAt(this.index);
    if (this.isNumber(this.ch) ||
        (this.is('.') && this.isNumber(this.peek()))) {
      this.readNumber();
    } else if (this.is('\'"')) {
      this.readString(this.ch);
    } else if (this.is('[],{}:.()?;')) {
      this.tokens.push({
        text: this.ch
      });
      this.index++;
    } else if (this.isIdent(this.ch)) {
      this.readIdent();
    } else if (this.isWhitespace(this.ch)) {
      this.index++;
    } else {
      var ch = this.ch;
      var ch2 = this.ch + this.peek();
      var ch3 = this.ch + this.peek() + this.peek(2);
      var op = OPERATORS[ch];
      var op2 = OPERATORS[ch2];
      var op3 = OPERATORS[ch3];
      if (op || op2 || op3) {
        var token = op3 ? ch3 : (op2 ? ch2 : ch);
        this.tokens.push({text: token});
        this.index += token.length;
      } else {
        throw 'Unexpected next character: '+this.ch;
      }
    }
  }

  return this.tokens;
};

Lexer.prototype.readIdent = function() {
  var text = '';
  while (this.index < this.text.length) {
    var ch = this.text.charAt(this.index);
    if (this.isIdent(ch) || this.isNumber(ch)) {
      text += ch;
    } else {
      break;
    }
    this.index++;
  }

  var token = {
    text: text,
    identifier: true
  };

  this.tokens.push(token);
};

Lexer.prototype.readNumber = function() {
  var number = '';
  while (this.index < this.text.length) {
    var ch = this.text.charAt(this.index).toLowerCase();
    if (ch === '.' || this.isNumber(ch)) {
      number += ch;
    } else {
      var nextCh = this.peek();
      var prevCh = number.charAt(number.length - 1);
      if (ch === 'e' && this.isExpOperator(nextCh)) {
        number += ch;
      } else if (this.isExpOperator(ch) && prevCh === 'e' && nextCh && this.isNumber(nextCh)) {
        number += ch;
      } else if (this.isExpOperator(ch) && prevCh === 'e' && (!nextCh || !this.isNumber(nextCh))) {
        throw 'Invalid exponent';
      } else {
        break;
      }
    }
    this.index++;
  }
  this.tokens.push({
    text: number,
    value: Number(number)
  });
};

Lexer.prototype.readString = function(quote) {
  this.index++;
  var string = '';
  var rawString = quote;
  var escape = false;
  while (this.index < this.text.length) {
    var ch = this.text.charAt(this.index);
    rawString += ch;
    if (escape) {
      if (ch === 'u') {
        var hex = this.text.substring(this.index + 1, this.index + 5);
        if (!hex.match(/[\da-f]{4}/i)) {
          throw 'Invalid unicode escape';
        }
        this.index += 4;
        string += String.fromCharCode(parseInt(hex, 16));
      } else {
        var replacement = ESCAPES[ch];
        if (replacement) {
          string += replacement;
        } else {
          string += ch;
        }
      }
      escape = false;
    } else if (ch === quote) {
      this.index++;
      this.tokens.push({
        text: rawString,
        value: string
      });
      return;
    } else if (ch == '\\') {
      escape = true;
    } else {
      string += ch;
    }
    this.index++;
  }
  throw 'Unmatched quote';
};

function AST(lexer) {
  this.lexer = lexer;
}

AST.ArrayExpression = 'ArrayExpression';
AST.AssignmentExpression = 'AssignmentExpression';
AST.BinaryExpression = 'BinaryExpression';
AST.CallExpression = 'CallExpression';
AST.ConditionalExpression = 'ConditionalExpression';
AST.Identifier = 'Identifier';
AST.Literal = 'Literal';
AST.LogicalExpression = 'LogicalExpression';
AST.MemberExpression = 'MemberExpression';
AST.ObjectExpression = 'ObjectExpression';
AST.Program = 'Program';
AST.Property = 'Property';
AST.ThisExpression = 'ThisExpression';
AST.UnaryExpression = 'UnaryExpression';

AST.prototype.additive = function() {
  var left = this.multiplicative();
  var token;
  while ((token = this.expect('+')) || (token = this.expect('-'))) {
    left = {
      type: AST.BinaryExpression,
      left: left,
      operator: token.text,
      right: this.multiplicative()
    };
  }
  return left;
};

AST.prototype.arrayDeclaration = function() {
  var elements = [];
  if (!this.peek(']')) {
    do {
      if (this.peek(']')) {
        break;
      }
      elements.push(this.assignment());
    } while (this.expect(','));
  }
  this.consume(']');
  return {type: AST.ArrayExpression, elements: elements};
};

AST.prototype.assignment = function() {
  var left = this.ternary();
  if (this.expect('=')) {
    var right = this.ternary();
    return {type: AST.AssignmentExpression, left: left, right: right};
  }
  return left;
};

AST.prototype.ast = function(text) {
  this.tokens = this.lexer.lex(text);
  return this.program();
};

AST.prototype.constant = function() {
  return {type: AST.Literal, value: this.consume().value};
};

AST.prototype.constants = {
  'null': {type: AST.Literal, value: null},
  'true': {type: AST.Literal, value: true},
  'false': {type: AST.Literal, value: false},
  'this': {type: AST.ThisExpression}
};

AST.prototype.consume = function(e) {
  var token = this.expect(e);
  if (!token) {
    throw 'Unexpected. Expecting: ' + e;
  }
  return token;
};

AST.prototype.equality = function() {
  var left = this.relational();
  var token;
  while ((token = this.expect('==', '!=', '===', '!=='))) {
    left = {
      type: AST.BinaryExpression,
      left: left,
      operator: token.text,
      right: this.relational()
    };
  }
  return left;
};

AST.prototype.expect = function(e1, e2, e3, e4) {
  var token = this.peek(e1, e2, e3, e4);
  if (token) {
    return this.tokens.shift();
  }
};

AST.prototype.filter = function() {
  var left = this.assignment();
  while (this.expect('|')) {
    var args = [left];
    left = {
      type: AST.CallExpression,
      callee: this.identifier(),
      arguments: args,
      filter: true
    };
    while (this.expect(':')) {
      args.push(this.assignment());
    }
  }
  return left;
};

AST.prototype.identifier = function() {
  return {type: AST.Identifier, name: this.consume().text};
};

AST.prototype.logicalAND = function() {
  var left = this.equality();
  var token;
  while ((token = this.expect('&&'))) {
    left = {
      type: AST.LogicalExpression,
      left: left,
      operator: token.text,
      right: this.equality()
    };
  }
  return left;
};

AST.prototype.logicalOR = function() {
  var left = this.logicalAND();
  var token;
  while ((token = this.expect('||'))) {
    left = {
      type: AST.LogicalExpression,
      left: left,
      operator: token.text,
      right: this.logicalAND()
    };
  }
  return left;
};

AST.prototype.multiplicative = function() {
  var left = this.unary();
  var token;
  while ((token = this.expect('*', '/', '%'))) {
    left = {
      type: AST.BinaryExpression,
      left: left,
      operator: token.text,
      right: this.unary()
    };
  }
  return left;
};

AST.prototype.object = function() {
  var properties = [];
  if (!this.peek('}')) {
    do {
      var property = {type: AST.Property};
      if (this.peek().identifier) {
        property.key = this.identifier();
      } else {
        property.key = this.constant();
      }
      this.consume(':');
      property.value = this.assignment();
      properties.push(property);
    } while (this.expect(','));
  }
  this.consume('}');
  return {type: AST.ObjectExpression, properties: properties};
};

AST.prototype.parseArguments = function() {
  var args = [];
  if (!this.peek(')')) {
    do {
      args.push(this.assignment());
    } while (this.expect(','));
  }
  return args;
};

AST.prototype.peek = function(e1, e2, e3, e4) {
  if (this.tokens.length > 0) {
    var text = this.tokens[0].text;
    if (text === e1 || text === e2 || text === e3 || text === e4 ||
        (!e1 && !e2 && !e3 && !e4)) {
      return this.tokens[0];
    }
  }
};

AST.prototype.primary = function() {
  var primary;
  if (this.expect('(')) {
    primary = this.filter();
    this.consume(')');
  } else if (this.expect('[')) {
    primary = this.arrayDeclaration();
  } else if (this.expect('{')) {
    primary = this.object();
  } else if (this.constants.hasOwnProperty(this.tokens[0].text)) {
    primary = this.constants[this.consume().text];
  } else if (this.peek().identifier) {
    primary = this.identifier();
  } else {
    primary = this.constant();
  }
  var next;

  while ((next = this.expect('.', '[', '('))) {
    if (next.text === '[') {
      primary = {
        type: AST.MemberExpression,
        object: primary,
        property: this.primary(),
        computed: true
      };
      this.consume(']');
    } else if (next.text === '.') {
      primary = {
        type: AST.MemberExpression,
        object: primary,
        property: this.identifier(),
        computed: false
      };
    } else if (next.text === '(') {
      primary = {
        type: AST.CallExpression,
        callee: primary,
        arguments: this.parseArguments()
      };
      this.consume(')');
    }
  }
  return primary;
};

AST.prototype.program = function() {
  var body = [];
  while (true) {
    if (this.tokens.length) {
      body.push(this.filter());
    }
    if (!this.expect(';')) {
      return {type: AST.Program, body: body};
    }
  }
};

AST.prototype.relational = function() {
  var left = this.additive();
  var token;
  while ((token = this.expect('<', '>', '<=', '>='))) {
    left = {
      type: AST.BinaryExpression,
      left: left,
      operator: token.text,
      right: this.additive()
    };
  }
  return left;
};

AST.prototype.ternary = function() {
  var test = this.logicalOR();
  if (this.expect('?')) {
    var consequent = this.assignment();
    if (this.consume(':')) {
      var alternate = this.assignment();
      return {
        type: AST.ConditionalExpression,
        test: test,
        consequent: consequent,
        alternate: alternate
      };
    }
  }
  return test;
};

AST.prototype.unary = function() {
  var token;
  if ((token = this.expect('+', '!', '-'))) {
    return {
      type: AST.UnaryExpression,
      operator: token.text,
      argument: this.unary()
    };
  } else {
    return this.primary();
  }
};

function ASTCompiler(astBuilder, $filter) {
  this.astBuilder = astBuilder;
  this.$filter = $filter;
}

ASTCompiler.prototype.addEnsureSafeFunction = function(expr) {
  this.state[this.state.computing].body.push('ensureSafeFunction(' + expr + ');');
};

ASTCompiler.prototype.addEnsureSafeMemberName = function(expr) {
  this.state[this.state.computing].body.push('ensureSafeMemberName(' + expr + ');');
};

ASTCompiler.prototype.addEnsureSafeObject = function(expr) {
  this.state[this.state.computing].body.push('ensureSafeObject(' + expr + ');');
};

ASTCompiler.prototype.assign = function(id, value) {
  return id + '=' + value + ';';
};

ASTCompiler.prototype.compile = function(text) {
  var ast = this.astBuilder.ast(text);
  var extra = '';
  markConstantAndWatchExpression(ast, this.$filter);
  this.state = {
    nextId: 0,
    fn: {body: [], vars: []},
    filters: {},
    assign: {body: [], vars: []},
    inputs: []
  };
  this.stage = 'inputs';
  _.forEach(getInputs(ast.body), function(input, idx) {
    var inputKey = 'fn' + idx;
    this.state[inputKey] = {body: [], vars: []};
    this.state.computing = inputKey;
    this.state[inputKey].body.push('return ' + this.recurse(input) + ';');
    this.state.inputs.push(inputKey);
  }, this);
  this.stage = 'assign';
  var assignable = assignableAST(ast);
  if (assignable) {
    this.state.computing = 'assign';
    this.state.assign.body.push(this.recurse(assignable));
    extra = 'fn.assign = function(s,v,l){' +
      (this.state.assign.vars.length ?
        'var ' + this.state.assign.vars.join(',') + ';' : '') +
        this.state.assign.body.join('') + '};';
  }
  this.stage = 'main';
  this.state.computing = 'fn';
  this.recurse(ast);

  var fnString =  this.filterPrefix() +
    'var fn=function(s,l){' +
    (this.state.fn.vars.length ?
      'var ' + this.state.fn.vars.join(',') + ';' :
        ''
    ) +
    this.state.fn.body.join('') +
    '};' +
    this.watchFns() +
      extra +
    ' return fn;';

  /* jshint -W054 */
  var fn = new Function(
    'ensureSafeMemberName',
    'ensureSafeObject',
    'ensureSafeFunction',
    'ifDefined',
    'filter',
    fnString)(
    ensureSafeMemberName,
    ensureSafeObject,
    ensureSafeFunction,
    ifDefined,
    this.$filter);
  /* jshint +W054 */
  fn.literal = isLiteral(ast);
  fn.constant = ast.constant;
  return fn;
};

ASTCompiler.prototype.computedMember = function(left, right) {
  return '(' + left + ')[' + right + ']';
};

ASTCompiler.prototype.escape = function(value) {
  if (_.isString(value)) {
    return '\'' +
        value.replace(this.stringEscapeRegex, this.stringEscapeFn) +
        '\'';
  } else if (_.isNull(value)) {
    return 'null';
  } else {
    return value;
  }
};

ASTCompiler.prototype.filter = function(name) {
  if (!this.state.filters.hasOwnProperty(name)) {
    this.state.filters[name] = this.nextId(true);
  }
  return this.state.filters[name];
};

ASTCompiler.prototype.filterPrefix = function() {
  if (_.isEmpty(this.state.filters)) {
    return '';
  } else {
    var parts = _.map(this.state.filters, function(varName, filterName) {
      return varName + '=' + 'filter(' + this.escape(filterName) + ')';
    }, this);

    return 'var ' + parts.join(',') + ';';
  }
};

ASTCompiler.prototype.getHasOwnProperty = function(object, property) {
  return object + '&&(' + this.escape(property) + ' in ' + object + ')';
};

ASTCompiler.prototype.if_ = function(test, consequent) {
  this.state[this.state.computing].body.push('if(', test, '){', consequent, '}');
};

ASTCompiler.prototype.ifDefined = function(value, defaultValue) {
  return 'ifDefined(' + value + ',' + this.escape(defaultValue) + ')';
};

ASTCompiler.prototype.nextId = function(skip) {
  var id = 'v' + (this.state.nextId++);
  if (!skip) {
    this.state[this.state.computing].vars.push(id);
  }
  return id;
};

ASTCompiler.prototype.nonComputedMember = function(left, right) {
  return '(' + left + ').' + right;
};

ASTCompiler.prototype.not = function(e) {
  return '!(' + e + ')';
};

ASTCompiler.prototype.recurse = function(ast, context, create) {
  var intoId;
  switch (ast.type) {
    case AST.ArrayExpression:
      var elements = _.map(ast.elements, function(element) {
        return this.recurse(element);
      }, this);
      return '[' + elements.join(',') + ']';
    case AST.AssignmentExpression:
      var leftContext = {};
      this.recurse(ast.left, leftContext, true);
      var leftExpr;
      if (leftContext.computed) {
        leftExpr = this.computedMember(leftContext.context, leftContext.name);
      } else {
        leftExpr = this.nonComputedMember(leftContext.context, leftContext.name);
      }
      return this.assign(leftExpr, 'ensureSafeObject(' + this.recurse(ast.right) + ')');
    case AST.BinaryExpression:
      if (ast.operator === '+' || ast.operator === '-') {
        return '(' + this.ifDefined(this.recurse(ast.left), 0) + ')' + ast.operator + '(' + this.ifDefined(this.recurse(ast.right), 0) + ')';
      } else {
        return '(' + this.recurse(ast.left) + ')' + ast.operator + '(' + this.recurse(ast.right) + ')';
      }
      break;
    case AST.CallExpression:
      var callContext, callee, args;
      if (ast.filter) {
        callee = this.filter(ast.callee.name);
        args = _.map(ast.arguments, function(arg) {
          return this.recurse(arg);
        }, this);
        return callee + '(' + args + ')';
      } else {
        callContext = {};
        callee = this.recurse(ast.callee, callContext);
        args = _.map(ast.arguments, function(arg) {
          return 'ensureSafeObject(' + this.recurse(arg) + ')';
        }, this);
        if (callContext.name) {
          this.addEnsureSafeObject(callContext.context);
          if (callContext.computed) {
            callee = this.computedMember(callContext.context, callContext.name);
          } else {
            callee = this.nonComputedMember(callContext.context, callContext.name);
          }
        }
        this.addEnsureSafeFunction(callee);
        return callee + '&&ensureSafeObject(' + callee + '(' + args.join(',') + '))';
      }
      break;
    case AST.ConditionalExpression:
      intoId = this.nextId();
      var testId = this.nextId();
      this.state[this.state.computing].body.push(this.assign(testId, this.recurse(ast.test)));
      this.if_(testId, this.assign(intoId, this.recurse(ast.consequent)));
      this.if_(this.not(testId), this.assign(intoId, this.recurse(ast.alternate)));
      return intoId;
    case AST.Identifier:
      ensureSafeMemberName(ast.name);
      intoId = this.nextId();
      var localsCheck;
      if (this.stage === 'inputs') {
        localsCheck = 'false';
      } else {
        localsCheck = this.getHasOwnProperty('l', ast.name);
      }
      this.if_(localsCheck, this.assign(intoId, this.nonComputedMember('l', ast.name)));
      if (create) {
        this.if_(this.not(localsCheck) +
          ' && s && ' +
          this.not(this.getHasOwnProperty('s', ast.name)),
        this.assign(this.nonComputedMember('s', ast.name), '{}'));
      }
      this.if_(this.not(localsCheck) + ' && s', this.assign(intoId, this.nonComputedMember('s', ast.name)));
      if (context) {
        context.context = localsCheck + '?l:s';
        context.name = ast.name;
        context.computed = false;
      }
      this.addEnsureSafeObject(intoId);
      return intoId;
    case AST.Literal:
      return this.escape(ast.value);
    case AST.LogicalExpression:
      intoId = this.nextId();
      this.state[this.state.computing].body.push(this.assign(intoId, this.recurse(ast.left)));
      this.if_(ast.operator === '&&' ? intoId : this.not(intoId), this.assign(intoId, this.recurse(ast.right)));
      return intoId;
    case AST.MemberExpression:
      intoId = this.nextId();
      var left = this.recurse(ast.object, undefined, create);
      if (context) {
        context.context = left;
      }
      if (ast.computed) {
        var right = this.recurse(ast.property);
        this.addEnsureSafeMemberName(right);
        if (create) {
          this.if_(this.not(this.computedMember(left, right)),
            this.assign(this.computedMember(left, right), '{}'));
        }
        this.if_(left, this.assign(intoId, 'ensureSafeObject(' + this.computedMember(left, right) + ')'));
        if (context) {
          context.name = right;
          context.computed = true;
        }
      } else {
        ensureSafeMemberName(ast.property.name);
        if (create) {
          this.if_(this.not(this.nonComputedMember(left, ast.property.name)),
            this.assign(this.nonComputedMember(left, ast.property.name), '{}'));
        }
        this.if_(left, this.assign(intoId, 'ensureSafeObject(' + this.nonComputedMember(left, ast.property.name) + ')'));
        if (context) {
          context.name = ast.property.name;
          context.computed = false;
        }
      }
      return intoId;
    case AST.NGValueParameter:
      return 'v';
    case AST.ObjectExpression:
      var properties = _.map(ast.properties, function(property) {
        var key = property.key.type === AST.Identifier ?
          property.key.name :
          this.escape(property.key.value);
        var value = this.recurse(property.value);
        return key + ':' + value;
      }, this);
      return '{' + properties.join(',') + '}';
    case AST.Program:
      _.forEach(_.initial(ast.body), function(stmt) {
        this.state[this.state.computing].body.push(this.recurse(stmt), ';');
      }, this);
      this.state[this.state.computing].body.push('return ', this.recurse(_.last(ast.body)), ';');
      break;
    case AST.ThisExpression:
      return 's';
    case AST.UnaryExpression:
      return ast.operator + '(' + this.ifDefined(this.recurse(ast.argument), 0) + ')';
  }
};

ASTCompiler.prototype.stringEscapeFn = function(c) {
  return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
};

ASTCompiler.prototype.stringEscapeRegex = /[^a-zA-Z0-9]/g;

ASTCompiler.prototype.watchFns = function() {
  var result = [];
  _.forEach(this.state.inputs, function(inputName) {
    result.push('var ', inputName, '=function(s) {',
      (this.state[inputName].vars.length ?
        'var ' + this.state[inputName].vars.join(',') + ';' : ''), this.state[inputName].body.join(''), '};');
  }, this);
  if (result.length) {
    result.push('fn.inputs = [', this.state.inputs.join(','), '];');
  }
  return result.join('');
};

function Parser(lexer, $filter) {
  this.lexer = lexer;
  this.ast = new AST(this.lexer);
  this.astCompiler = new ASTCompiler(this.ast, $filter);
}

Parser.prototype.parse = function(text) {
  return this.astCompiler.compile(text);
};

function $ParseProvider() {
  this.$get = ['$filter', function($filter) {
    return function(expr) {
      switch (typeof expr) {
        case 'string':
          var lexer = new Lexer();
          var parser = new Parser(lexer, $filter);
          var oneTime = false;
          if (expr.charAt(0) === ':' && expr.charAt(1) === ':') {
            oneTime = true;
            expr = expr.substring(2);
          }
          var parseFn = parser.parse(expr);
          if (parseFn.constant) {
            parseFn.$$watchDelegate = constantWatchDelegate;
          } else if (oneTime) {
            parseFn.$$watchDelegate = parseFn.literal ? oneTimeLiteralWatchDelegate : oneTimeWatchDelegate;
          } else if (parseFn.inputs) {
            parseFn.$$watchDelegate = inputsWatchDelegate;
          }
          return parseFn;
        case 'function':
          return expr;
        default:
          return _.noop;
      }
    }
  }];
}

module.exports = $ParseProvider;
