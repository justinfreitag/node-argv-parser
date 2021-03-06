'use strict';

var format = require('util').format;
var help = require('./lib/help');
var merge = require('deepmerge');
var paramCase = require('param-case');

var META_PROPERTIES = [
  'description',
  'required',
  'type',
  'name',
  'default',
  'many',
  'parse',
  'validate'
];

var ARGUMENT_TYPES = [
  'string',
  'number'
];

var OPTION_PROPERTIES = [
  'id',
  'longId',
  'shortId'
].concat(META_PROPERTIES);

var OPERAND_PROPERTIES = [
  'id'
].concat(META_PROPERTIES);

var ID_CONFLICT = 'ID conflict between between \'%s\' and \'%s\'';
var INVALID_TYPE = 'Invalid type \'%s\' for \'%s\'';
var INVALID_DEFAULT = 'Invalid default for \'%s\'';
var INVALID_PROPERTY = 'Unknown property \'%s\' for \'%s\'';
var PROPERTY_MISMATCH = 'Property mismatch between \'%s\' & \'%s\' for \'%s\'';
var INVALID_ARGUMENT = 'Unknown argument \'%s\'';
var MISSING_ARGUMENT = 'Missing argument \'%s\'';
var INVALID_OPTION = 'Unknown option \'%s\'';
var INVALID_VALUE = 'Expecting \'%s\' for argument \'%s\'';

var OPTION_TERMINATOR = '--';

var DEFAULT_CONFIG = {
  help: {
    name: process.argv[0],
    usage: {
      requiredThreshold: 5,
      optionalThreshold: 4
    }
  },
  options: {
    help: {
      description: 'This help text'
    },
    version: {
      description: 'Show version info'
    }
  },
  operands: {
    argv: {
      many: true,
      type: 'string'
    }
  }
};

function createShortId(id, optionCache) {
  var firstChar = id[0];

  if (optionCache[firstChar]) {
    return firstChar.toUpperCase();
  }

  return firstChar;
}

function createLongId(id) {
  return paramCase(id);
}

function prepareArrayType(meta) {
  if (meta.default !== undefined) {
    if (!(meta.default instanceof Array) || !meta.default.length) {
      throw new Error(format(INVALID_DEFAULT, meta.id));
    }

    if (meta.type && (typeof meta.default[0] !== meta.type)) {
      throw new Error(format(PROPERTY_MISMATCH, 'default', 'type', meta.id));
    }

    if (!meta.type) {
      meta.type = typeof meta.default[0];
    }
  }
}

function prepareType(meta) {
  if (!meta.type && meta.default !== undefined) {
    meta.type = typeof meta.default;
  }

  if (meta.type && (ARGUMENT_TYPES.indexOf(meta.type) === -1)) {
    throw new Error(format(INVALID_TYPE, meta.type, meta.id));
  }

  if (meta.default !== undefined && (typeof meta.default !== meta.type)) {
    throw new Error(format(PROPERTY_MISMATCH, 'default', 'type', meta.id));
  }
}

function prepareArgument(meta) {
  if (meta.default instanceof Array) {
    meta.many = true;
  }

  if (meta.many) {
    prepareArrayType(meta);
  } else {
    prepareType(meta);
  }

  if (!meta.name && meta.type) {
    meta.name = meta.type.toUpperCase();
  }

  if (meta.required && (meta.default !== undefined))  {
    throw new Error(format(PROPERTY_MISMATCH, 'required', 'default', meta.id));
  }
}

function validateProperties(meta, properties) {
  Object.keys(meta).forEach(function (property) {
    if (properties.indexOf(property) === -1) {
      throw new Error(format(INVALID_PROPERTY, property, meta.id));
    }
  });
}

function prepareOption(option, id, optionCache) {
  prepareMeta(option, id, OPTION_PROPERTIES);

  if (option.shortId === undefined) {
    option.shortId = createShortId(option.id, optionCache);
  }

  if (option.longId === undefined) {
    option.longId = createLongId(option.id);
  }
}

function prepareMeta(meta, id, properties) {
  meta.id = id;

  validateProperties(meta, properties);

  prepareArgument(meta);
}

function isOption(arg) {
  return arg.indexOf('-') === 0;
}

function isLongOption(arg) {
  return arg.indexOf('--') === 0;
}

function isEscaped(arg) {
  return arg[0] === '"' && (arg[arg.length - 1] === '"');
}

function parseArg(meta, arg) {
  if (meta.parse) {
    return meta.parse(arg);
  }

  if (meta.type === 'number') {
    arg = +arg;

    if (isNaN(arg)) {
      throw new Error(format(INVALID_VALUE, meta.name, meta.id));
    }
  }

  return arg;
}

function expandArg(arg, args) {
  if (isEscaped(arg)) {
    return arg.substring(1, arg.length - 1);
  }

  arg = arg.split(','); // doesn't support escaping
  arg.reverse().forEach(function (arg) {
    args.push(arg);
  });

  return args.pop();
}

function expandLongOption(arg, args, optionCache) {
  var i = arg.indexOf('=');

  if (i !== -1) {
    args.push(arg.substring(i + 1));
    arg = arg.substring(2, i);
  }

  var option = optionCache[arg];

  if (!option) {
    throw new Error(format(INVALID_OPTION, arg));
  }

  return option.shortId;
}

function expandShortOption(arg, args, optionCache) {
  var tokens = [];

  for (var i = 1; i < arg.length; i++) {
    var option = optionCache[arg[i]];
    if (!option) {
      throw new Error(format(INVALID_OPTION, arg[i]));
    }

    tokens.push('-' + arg[i]);

    if (option.type && ((i + 1) < arg.length)) {
      i += arg[i + 1] === '=';
      tokens.push(arg.substring(i + 1));
      break;
    }
  }

  tokens.reverse().forEach(function (token) {
    args.push(token);
  });

  return args.pop()[1];
}

function expandOption(arg, args, optionCache) {
  if (isLongOption(arg)) {
    return expandLongOption(arg, args, optionCache);
  }

  return expandShortOption(arg, args, optionCache);
}

function setResult(meta, result, results) {
  if (results[meta.id]) {
    throw new Error(format(INVALID_VALUE, meta.type, meta.id));
  }

  results[meta.id] = result;
}

function addResult(meta, result, results) {
  var existingResult = results[meta.id] || null;

  if (meta.type) {
    if (existingResult) {
      existingResult.push(result);
    } else {
      results[meta.id] = [result];
    }

    return;
  }

  results[meta.id] = existingResult + 1;
}

function handleArg(meta, arg, args, results) {
  if (!meta) {
    throw new Error(format(INVALID_ARGUMENT, arg));
  }

  var result = parseArg(meta, expandArg(arg, args));

  if (meta.validate) {
    meta.validate(result);
  }

  handleResult(meta, result, results);
}

function handleResult(meta, result, results) {
  if (meta.many) {
    addResult(meta, result, results);
  } else {
    setResult(meta, result, results);
  }
}

function handleOption(arg, args, optionCache, results)  {
  var option = optionCache[expandOption(arg, args, optionCache)];

  if (option.type) {
    if (!args.length) {
      throw new Error(format(MISSING_ARGUMENT, option.type, option.id));
    }

    return option;
  }

  handleResult(option, true, results);
}

function parse(args, optionCache, operandStack) {
  /* jshint maxcomplexity: 7, maxstatements: 22 */

  var results = {};
  var arg;

  while ((arg = args.pop())) {
    var option;
    var operand;

    if (operand) {
      if (!operand.many) {
        operand = operandStack.pop();
      }

      handleArg(operand, arg, args, results);
      continue;
    }

    if (arg === OPTION_TERMINATOR) {
      option = null;
      operand = operandStack.pop();
      continue;
    }

    if (option) {
      handleArg(option, arg, args, results);
      continue;
    }

    if (isOption(arg)) {
      option = handleOption(arg, args, optionCache, results);
      continue;
    }

    handleArg((operand = operandStack.pop()), arg, args, results);
  }

  return results;
}

function createOptionCache(options) {
  var optionCache = {};

  Object.keys(options).forEach(function (id) {
    var option = options[id];

    prepareOption(option, id, optionCache);

    var existing = optionCache[option.shortId] || optionCache[option.longId];

    if (existing) {
      throw new Error(format(ID_CONFLICT, existing.id, option.id));
    }

    optionCache[option.longId] = optionCache[option.shortId] = option;
  });

  return optionCache;
}

function createOperandStack(operands) {
  return Object.keys(operands).reverse().map(function (id) {
    var operand = operands[id];

    prepareMeta(operand, id, OPERAND_PROPERTIES);

    return operand;
  });
}

function applyDefaults(results, metas) {
  Object.keys(metas).forEach(function (id) {
    var meta = metas[id];

    if (meta.default !== undefined && (results[id] === undefined)) {
      results[id] = meta.default;
    }
  });
}

function validateResults(results, config) {
  [config.options, config.operands].forEach(function (metas) {
    Object.keys(metas).forEach(function (id) {
      var meta = metas[id];

      if (meta.required && (results[id] === undefined)) {
        throw new Error(format(MISSING_ARGUMENT, meta.longId || meta.name));
      }
    });
  });
}

function mergeConfig(config) {
  if (config && config.operands) {
    config = merge(DEFAULT_CONFIG, config);
    delete config.operands.argv;
  } else {
    config = merge(DEFAULT_CONFIG, config || {});
  }

  return config;
}

module.exports = function (argv, config) {
  if (!(argv instanceof Array)) {
    config = argv;
    argv = null;
  }
  config = mergeConfig(config);

  var args = (argv || process.argv).slice().reverse();

  var results;
  try {
    var optionCache = createOptionCache(config.options);
    var operandStack = createOperandStack(config.operands);

    results = parse(args, optionCache, operandStack);

    if (results.help) {
      return {
        help: help(config.help, config.options, config.operands)
      };
    }

    applyDefaults(results, config.options);
    applyDefaults(results, config.operands);

    validateResults(results, config);
  } catch (error) {
    error.help = help(config.help, config.options, config.operands);

    throw error;
  }

  return results;
};

