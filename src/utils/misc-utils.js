/* eslint-disable no-eval */
'use strict';

const Nife = require('nife');

function toHyphenated(str) {
  return str.replace(/_+/g, '-').replace(/[A-Z]+/g, (m) => {
    return `-${m}`;
  }).replace(/^-+/, '').toLowerCase();
}

function cleanComponentScript(scriptSource) {
  let cleanedSource = scriptSource.replace(/^\s*import[^;]+;+/gm, '').replace(/export(\s+default)?\s+/, '').replace(/\bevt\b/g, 'event').trim();
  return cleanedSource;
}

function evalScript(rawScript) {
  if (Nife.isEmpty(rawScript))
    return {};

  const buildMapFactory = (name, name2) => {
    return (scopeName, values) => {
      let obj = {};

      if (Array.isArray(values)) {
        values.forEach((argName) => {
          obj[argName] = eval(`(function() { return function ${name}() { /* TODO: mapped ${name} (${name2})... help! Scope: ${scopeName}.${argName} */ }; })()`);
        });
      } else if (Nife.instanceOf(values, 'object')) {
        let keys = Object.keys(values);
        keys.forEach((argName) => {
          let thisValue = values[argName];
          obj[argName] = eval(`(function() { return function ${name}() { /* TODO: mapped ${name} (${name2})... help! Scope: ${argName} = ${scopeName}.${thisValue} */ }; })()`);
        });
      }

      return obj;
    };
  };

  const mapState    = buildMapFactory('state', 'mapState');
  const mapActions  = buildMapFactory('action', 'mapActions');
  const mapGetters  = buildMapFactory('getter', 'mapGetters');

  let script = cleanComponentScript(rawScript);
  let references = [ 'mapState', 'mapActions', 'mapGetters' ];
  let finalScript;

  for (let i = 0; i < 200; i++) {
    try {
      let curlyBraceIndex = script.indexOf('{');
      finalScript = `${script.substring(0, curlyBraceIndex)}return ${script.substring(curlyBraceIndex)}`;

      finalScript = `(function(${references.join(',')}) { \n${finalScript}; })(${references.map((ref) => {
        if (ref === 'mapState' || ref === 'mapActions' || ref === 'mapGetters')
          return ref;

        return `'${ref}'`;
      })});`;

      // console.log(finalScript);

      let result = eval(finalScript);
      return result;
    } catch (error) {
      if (error instanceof ReferenceError) {
        let referenceName = error.message.trim().split(/\s+/g)[0];
        // console.log('Adding reference and trying again: ', referenceName);
        references.push(referenceName);
        continue;
      }

      throw error;
    }
  }
}

function getTabWidthForDepth(depth) {
  let parts = Array(depth * 2);
  for (let i = 0, il = parts.length; i < il; i++)
    parts[i] = ' ';

  return parts.join('');
}

function convertPropOrStateName(propName) {
  const convertSpecialWords = (m) => {
    if ((/^horiz$/i).test(m))
      return 'horizontal';

    if ((/^vert$/i).test(m))
      return 'vertical';

    return m;
  };

  if (!(/[_-]/).test(propName)) {
    let newName = propName;

    if ((/^[A-Z0-9$]+$/).test(propName))
      newName = newName.toLowerCase();

    newName = newName.replace(/[A-Z0-9]+/g, (m) => `-${m}`).replace(/[A-Za-z0-9]+/g, convertSpecialWords).replace(/-/g, '');

    return newName;
  } else {
    let newName = propName.replace(/[A-Z0-9]+/g, (m) => `-${m}`).replace(/[A-Za-z0-9]+/g, convertSpecialWords).replace(/-/g, '');
    return Nife.snakeCaseToCamelCase(newName.toLowerCase());
  }
}

function convertObjectKeys(obj, converter) {
  if (!obj)
    return obj;

  let keys    = Object.keys(obj);
  let newObj  = {};

  for (let i = 0, il = keys.length; i < il; i++) {
    let key     = keys[i];
    let value   = obj[key];
    let newKey  = converter(key);

    newObj[newKey] = value;
  }

  return newObj;
}

function convertValueToJS(_value, _depth) {
  let depth = _depth || 1;
  let value = _value;
  if (value === undefined)
    return 'undefined';

  if (value === null)
    return 'null';

  if (Nife.instanceOf(value, 'array', 'object')) {
    let prefix  = getTabWidthForDepth(depth + 1);
    let keys    = Object.keys(value);
    let isArray = Array.isArray(value);
    let parts   = [];

    if (isArray)
      parts.push('[');
    else
      parts.push('{');

    for (let i = 0, il = keys.length; i < il; i++) {
      let key             = keys[i];
      let keyValue        = value[key];
      let convertedValue  = convertValueToJS(keyValue, depth + 1);

      parts.push(' ');

      if (isArray)
        parts.push(convertedValue);
      else
        parts.push(`\n${prefix}'${key}': ${convertedValue},`);
    }

    if (isArray)
      parts.push(']');
    else
      parts.push(`\n${getTabWidthForDepth(depth)}}`);

    return parts.join('');
  } else if (Nife.instanceOf(value, 'function')) {
    return ('' + value);
  } else if (Nife.instanceOf(value, 'string')) {
    return `'${(value.replace(/'/g, '\\\''))}'`;
  } else if (typeof value === 'bigint') {
    return `BigInt(${value})`;
  } else {
    return ('' + value);
  }
}

module.exports = {
  toHyphenated,
  cleanComponentScript,
  getTabWidthForDepth,
  convertPropOrStateName,
  convertObjectKeys,
  convertValueToJS,
  evalScript,
};
