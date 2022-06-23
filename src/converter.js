/* eslint-disable no-magic-numbers */
/* eslint-disable no-eval */
'use strict';

const Nife          = require('nife');
const Path          = require('path');
const FileSystem    = require('fs');
const Util          = require('util');
const {
  FileUtils,
  MiscUtils,
  EventUtils,
} = require('./utils');

function trimMethodDepth(str, depth) {
  let regex = new RegExp(`^ {${depth * 2}}`, 'gm');
  return str.replace(regex, '');
}

function getOutputPathAndName(inputPath, outputPath, parsedSFC) {
  let fileName = Path.basename(parsedSFC.filePath);
  let name     = fileName.replace(/^([^.]+).*$/, '$1');

  let relativePath = FileUtils.relativeOutputPath(inputPath, outputPath, parsedSFC.filePath);
  relativePath = relativePath.split(Path.sep).filter(Boolean).map(MiscUtils.toHyphenated).join(Path.sep);

  let outputFilePath  = Path.join(outputPath, relativePath);
  let outputDir       = Path.dirname(outputFilePath);
  let nameConverted   = MiscUtils.toHyphenated(name);

  let filePath = Path.join(outputDir, nameConverted);
  FileSystem.mkdirSync(filePath, { recursive: true });

  return {
    fullFileName: Path.join(outputDir, nameConverted, `${nameConverted}.tsx`),
    filePath,
    nameConverted,
    name,
  };
}

function vueTypeToTSType(type, rawType) {
  if (rawType) {
    if (type == null)
      return 'any /* TODO: Validate proper type */';

    if (Nife.instanceOf(type, 'number'))
      return 'number';
    else if (Nife.instanceOf(type, 'boolean'))
      return 'boolean';
    else if (Nife.instanceOf(type, 'string'))
      return 'string';
    else if (Nife.instanceOf(type, 'bigint'))
      return 'bigint';
    else if (Nife.instanceOf(type, 'function'))
      return 'any /* TODO: Please correct function type */';
    else if (Nife.instanceOf(type, 'array'))
      return 'Array<any> /* TODO: Validate proper type */';
    else if (Nife.instanceOf(type, 'object'))
      return 'Object /* TODO: Validate proper type */';
  }

  if (type === String)
    return 'string';
  else if (type === Number)
    return 'number';
  else if (type === Boolean)
    return 'boolean';
  else if (type === BigInt)
    return 'bigint';
  else if (type === Object)
    return 'any /* Object */';
  else if (type === Array)
    return 'Array<any>';
  else if (type === Function)
    return 'any /* Function */';

  throw new Error(`TypeScript type "${type}" not supported`);
}

function toPropName(name) {
  return MiscUtils.convertPropOrStateName(name);
}

function propsToTS(props, rawValues, _depth) {
  let depth           = _depth || 1;
  let isArray         = Array.isArray(props);
  let propNames       = Object.keys(props);
  let interfaceParts  = [];
  let prefix          = MiscUtils.getTabWidthForDepth(depth);

  if (!isArray)
    interfaceParts.push('\n');

  for (let i = 0, il = propNames.length; i < il; i++) {
    let propName    = propNames[i];
    let value       = props[propName];
    let newPropName = toPropName(propName);

    if (Nife.instanceOf(value, 'object')) {
      if (value.type) {
        value = value.type;
      } else {
        interfaceParts.push(`${prefix}${newPropName}: any /* TODO: Warning, unsure about this one, please check */;\n`);
        continue;
      }
    }

    if (!rawValues && Array.isArray(value)) {
      let result = propsToTS(value, rawValues, depth + 1);
      interfaceParts.push(`${prefix}${newPropName}: Array<${result}>;\n`);
    } else {
      if (!rawValues && isArray)
        interfaceParts.push(vueTypeToTSType(value, rawValues));
      else
        interfaceParts.push(`${prefix}${newPropName}: ${vueTypeToTSType(value, rawValues)};\n`);
    }
  }

  return (isArray) ? interfaceParts.join(' | ') : interfaceParts.join('');
}

function propsToInterface(componentName, scriptObject) {
  let props = scriptObject.props;
  if (!props || Array.isArray(props))
    return `export interface ${componentName}Props {}`;

  return `export interface ${componentName}Props {${propsToTS(props, false)}};`;
}

function stateToInterface(componentName, state) {
  if (Nife.isEmpty(state))
    return `export interface ${componentName}State {}`;

  return `export interface ${componentName}State {${propsToTS(state, true)}};`;
}

function getState(scriptObject) {
  if (!scriptObject.data)
    return {};

  if (typeof scriptObject.data === 'function')
    return scriptObject.data();

  return scriptObject.data;
}

function toStateName(name) {
  return MiscUtils.convertPropOrStateName(name);
}

function toComputeName(name) {
  return MiscUtils.convertPropOrStateName(name);
}

function hasSourceCode(context, code) {
  let { parsedCode } = parseCodeVariables(context, code);

  let count = 0;

  parsedCode.replace(/@@@(TAG|PROP)\[(\d+)\]@@@/g, () => {
    count++;
  });

  return (count > 1);
}

function parseCodeVariables(context, code, onlyThis) {
  let {
    propNames,
    stateNames,
    computedNames,
    methodNames,
  } = context;

  const getPropNameType = (name) => {
    if (propNames.indexOf(name) >= 0)
      return 'prop';
    else if (stateNames.indexOf(name) >= 0)
      return 'state';
    else if (computedNames.indexOf(name) >= 0)
      return 'computed';
    else if (methodNames.indexOf(name) >= 0)
      return 'method';
  };

  const createTag = (tags, part) => {
    let index = tags.length;
    tags.push(part);
    return `@@@TAG[${index}]@@@`;
  };

  const parseAssignment = (str) => {
    let assignment;

    str.replace(/^\s*([+*/-]?=)\s*([^=][^;]+)/, (m, operator, rightHand) => {
      assignment = { operator: operator.trim(), rightHand: rightHand.trim() };
    });

    return assignment;
  };

  let allVariableNames = Nife.uniq(
    Nife.arrayFlatten([
      propNames,
      stateNames,
      computedNames,
      methodNames,
    ]),
  );

  allVariableNames.sort((a, b) => {
    if (a.length === b.length)
      return 0;

    return (a.length < b.length) ? 1 : -1;
  });

  let variablesRegExp       = new RegExp(`(\\b${allVariableNames.join('\\b|\\b')}\\b)`, 'g');
  let variablesRegExpSingle = new RegExp(`^(\\b${allVariableNames.join('\\b|\\b')}\\b)$`);
  let matches = [];
  let tags    = [];

  let parsedCode = code
    .replace(/(['"])(?:\\.|.)*?\1/g, (m) => createTag(tags, m))
    .replace(/this\.([\w$.]+)/g, (m, reference, offset, src) => {
      let parts = reference.split(/\./g);
      let type;

      if (parts[0] === 'props') {
        type = 'prop';
        parts = parts.slice(1);
      }

      if (!variablesRegExpSingle.test(parts[0]))
        return createTag(tags, m);

      let name = parts[0];
      if (!type)
        type = getPropNameType(name);

      let index = matches.length;

      matches.push({
        assignment: parseAssignment(src.substring(offset + m.length)),
        hasThis:    true,
        length:     m.length,
        offset,
        type,
        name,
      });

      return `@@@PROP[${index}]@@@`;
    });

  if (onlyThis !== true) {
    console.log('Starting parse!', parsedCode);
    parsedCode = parsedCode.replace(variablesRegExp, (m, name, offset, src) => {
      console.log('MATCH: ', m);
      let rewindOffset = offset - 1;
      if (rewindOffset < 0)
        rewindOffset = 0;

      if ((/[.\]]/).test(src.charAt(rewindOffset)))
        return createTag(tags, m);

      rewindOffset = offset - 8;
      if (rewindOffset < 0)
        rewindOffset = 0;

      if ((/^\s*(let|var|const)\s+/).test(src.substring(rewindOffset)))
        return createTag(tags, m);

      if ((/^\s*:/).test(src.substring(offset + m.length)))
        return createTag(tags, m);

      let type  = getPropNameType(name);
      let index = matches.length;

      matches.push({
        assignment: parseAssignment(src.substring(offset + m.length)),
        hasThis:    false,
        length:     m.length,
        index,
        offset,
        type,
        name,
      });

      return `@@@PROP[${index}]@@@`;
    });

    if (code.match(/SVG_BASE/))
      console.log('PARSED CODE: ', code, parsedCode, matches, variablesRegExp);
  }

  return { parsedCode, matches, tags };
}

function mutateSourceCode(parsedResult, callback) {
  let {
    parsedCode,
    matches,
    tags,
  } = parsedResult;

  const compileOutput = (match) => {
    let {
      assignment,
      type,
      name,
      hasThis,
    } = match;

    if (type === 'method') {
      return `this.${toMethodName(name)}`;
    } else if (type === 'computed') {
      if (assignment)
        return `this.${toComputeName(name)}() /* TODO: Fixme... needs to be a state variable */`;

      return `this.${toComputeName(name)}()`;
    } else if (type === 'state') {
      if (assignment)
        return `this.state.${toStateName(name)}`;

      return `this.state.${toStateName(name)}`;
    } else if (type === 'prop') {
      return `this.props.${toPropName(name)}`;
    }

    if (hasThis)
      return `this.${name}`;

    return name;
  };

  return parsedCode.replace(/@@@(TAG|PROP)\[(\d+)\]@@@/g, (tagMatch, tagType, _index, offset, source) => {
    let index = parseInt(_index, 10);
    if (tagType === 'TAG')
      return tags[index];

    let match   = matches[index];
    let output  = compileOutput(match);

    if (typeof callback === 'function') {
      let result = callback({ match, output, tagMatch, offset, source, compileOutput });
      if (result)
        output = result;
    }

    return output;
  }).replace(/this\.\$enyxusUtils/g, 'EnyxusUtils');
}

function convertInlineCode(context, code, events) {
  let result = parseCodeVariables(context, code, false);
  return mutateSourceCode(result, ({ match, output }) => {
    if (match.type !== 'method')
      return output;

    if (events)
      return `${output}(event);`;

    return output;
  });
}

function convertMethod(context, func, stripPrefix, convertMethodToArrow) {
  let funcStr = ('' + func);

  if (stripPrefix)
    funcStr = funcStr.replace(/^[^{]+/, '');

  if (convertMethodToArrow) {
    let parts = funcStr.split(/\n/gm);
    parts[0] = parts[0].replace(/\{\s*$/, '=> {');
    funcStr = parts.join('\n');
  }

  let result = parseCodeVariables(context, funcStr, true);
  return mutateSourceCode(result);
}

function getComputedNames(scriptObject) {
  let computed = scriptObject.computed;
  if (Nife.isEmpty(computed))
    return [];

  return Object.keys(computed);
}

function generateComputed(context, scriptObject) {
  let computed = scriptObject.computed;
  if (Nife.isEmpty(computed))
    return '';

  let computedNames = context.computedNames;
  let computedParts = [];

  for (let i = 0, il = computedNames.length; i < il; i++) {
    let computeName = computedNames[i];
    let value       = computed[computeName];
    let isFunction  = (typeof value === 'function');
    let funcBody    = (!isFunction) ? convertInlineCode(context, MiscUtils.convertValueToJS(value, 2), false).replace(/(get|set)\(([^)]*)\)\s*{/g, (m, name, args) => {
      return `(${args}) => {`;
    }) : convertMethod(context, value, true);

    if (isFunction)
      computedParts.push(`  ${toComputeName(computeName)} = () => ${trimMethodDepth(funcBody, 1)};\n\n`);
    else
      computedParts.push(`  ${toComputeName(computeName)} = ${trimMethodDepth(funcBody, 1)}; /* TODO: Fix me (computed state as object) */\n\n`);
  }

  return `  /* START COMPUTED */\n${computedParts.join('').trimEnd()}\n  /* END COMPUTED */\n`;
}

function getMethodNames(scriptObject) {
  let methods = scriptObject.methods;
  if (Nife.isEmpty(methods))
    return [];

  return Object.keys(methods);
}

function toMethodName(name) {
  return MiscUtils.convertPropOrStateName(name);
}

function generateMethods(context, scriptObject) {
  let methods = scriptObject.methods;
  if (Nife.isEmpty(methods))
    return '';

  let methodNames = context.methodNames;
  let methodParts = [];

  for (let i = 0, il = methodNames.length; i < il; i++) {
    let methodName  = methodNames[i];
    let value       = methods[methodName];
    let funcBody    = convertMethod(context, value, false, true);

    funcBody = funcBody.replace(/^[\w$]+/, `${toMethodName(methodName)} = `);

    methodParts.push(`  ${trimMethodDepth(funcBody, 1)};\n`);
  }

  return `  /* START METHODS */\n${methodParts.join('\n').trimEnd()}\n  /* END METHODS */\n`;
}

function convertAttributeNameToJSXName(name) {
  if (name === 'class')
    return 'className';

  if (name.startsWith('v-'))
    return name;

  return toPropName(name);
}

function attributesToJSX(context, node, attributes, _depth) {
  if (Nife.isEmpty(attributes))
    return '';

  let depth           = _depth || 1;
  let attributeNames  = Object.keys(attributes);
  let attributeParts  = [];
  let finalAttributes = {};
  let prefix          = MiscUtils.getTabWidthForDepth(depth + 1);

  for (let i = 0, il = attributeNames.length; i < il; i++) {
    let attributeName   = attributeNames[i];
    let attributeValue  = attributes[attributeName];
    let propName        = undefined;
    let value           = undefined;

    if (attributeName === 'v-text') {
      // Handled at the JSX level
      continue;
    } else if ((/^(v-text|v-html|v-for|v-if|v-else-if|v-else|v-show)/).test(attributeName)) {
      // Handled at the JSX level
      continue;
    } else if ((/^v-bind:/).test(attributeName)) {
      propName  = convertAttributeNameToJSXName(attributeName.replace(/^v-bind:/, ''));
      value     = convertInlineCode(context, attributeValue);
    } else if (attributeName.charAt(0) === ':') {
      propName  = convertAttributeNameToJSXName(attributeName.substring(1));
      value     = convertInlineCode(context, attributeValue);
    } else if (attributeName.charAt(0) === '@') {
      let eventNameParts  = attributeName.substring(1).split('.');
      let eventName       = eventNameParts[0];
      let reactEventName  = EventUtils.convertToReactEventName(eventName);
      let comment         = '';
      value               = convertInlineCode(context, attributeValue, true);

      if (eventNameParts.length > 1 || eventName === reactEventName)
        comment = ' /* TODO: WARNING: This was a special binding... please refer to the Vue code to correct this event method */';

      propName = reactEventName;
      value = `{(event: any) => { ${value} }${comment}}`;
    } else {
      propName  = convertAttributeNameToJSXName(attributeName);
      value     = attributeValue;

      if (Nife.isEmpty(value))
        value = 'true';
      else
        value = MiscUtils.convertValueToJS(attributeValue);

      if (propName === 'v-model')
        value = value + ' /* TODO: Dual binding from child to parent */';
    }

    let isSource  = hasSourceCode(context, attributeValue);
    if (propName !== 'className' && !(/^\{\{|^\{\(/).test(value) && (isSource || !(/^['"]/).test(value)))
      value = `{${value.replace(/\n\s*/g, ' ')}}`;

    if (!propName || !value)
      continue;

    let values = finalAttributes[propName];
    if (!values)
      values = finalAttributes[propName] = [];

    values.push(value);
  }

  let keys = Object.keys(finalAttributes);
  for (let i = 0, il = keys.length; i < il; i++) {
    let propName  = keys[i];
    let values    = finalAttributes[propName];
    let value     = undefined;

    if (propName === 'className') {
      if (node.parent && node.parent.name === 'template')
        values = Nife.uniq([].concat(values));

      value = `{classNames(${values.join(', ')})}`;
    } else {
      value = values.join(', ');
    }

    attributeParts.push(`${propName}=${value}`);
  }

  let totalLength = attributeParts.reduce((sum, part) => (sum + part.length), 0);

  // eslint-disable-next-line no-magic-numbers
  if (totalLength > 100) {
    attributeParts = [ '' ].concat(attributeParts.map((part) => `${prefix}${part}`));
    return attributeParts.join('\n');
  } else {
    return attributeParts.join(' ');
  }
}

function getIfAttribute(attributes) {
  let attributeNames = Object.keys(attributes);
  for (let i = 0, il = attributeNames.length; i < il; i++) {
    let attributeName = attributeNames[i];
    if ((/^(v-if|v-else-if|v-else|v-show)/).test(attributeName))
      return { type: attributeName, value: attributes[attributeName] };
  }
}

function getForAttribute(context, attributes) {
  const parseForLoop = (value) => {
    let name;
    let indexName;
    let sourceName;

    if (value.charAt(0) === '(') {
      value.replace(/\(\s*([\w$]+),\s*([\w$]+)\s*\)\s+in\s+([\w$.]+)/i, (m, _name, _indexName, _sourceName) => {
        name = _name;
        indexName = _indexName;
        sourceName = _sourceName;
      });
    } else {
      value.replace(/([\w$]+)\s+in\s+([\w$.]+)/i, (m, _name, _sourceName) => {
        name = _name;
        sourceName = _sourceName;
      });
    }

    if (sourceName)
      sourceName = convertInlineCode(context, sourceName);

    if (sourceName.match(/^\d+$/)) {
      let items = [];
      sourceName = parseInt(sourceName, 10);
      for (let i = 0; i < sourceName; i++)
        items.push(i);

      sourceName = `[ ${items.join(', ')} ]`;
    }

    return { name, indexName, sourceName };
  };

  let attributeNames = Object.keys(attributes);
  for (let i = 0, il = attributeNames.length; i < il; i++) {
    let attributeName = attributeNames[i];
    if (attributeName === 'v-for') {
      let attributeValue  = attributes[attributeName];
      let parsed          = parseForLoop(attributeValue);

      let keyValue = attributes[':key'];
      if (Nife.isEmpty(keyValue) && parsed.indexName)
        keyValue = parsed.indexName;

      parsed.key = keyValue;

      return parsed;
    }
  }
}

function filterDOMNodes(nodes, insideJSX) {
  return nodes.filter((node) => {
    if (node.type === 'text') {
      if (!insideJSX)
        return false;

      if (Nife.isEmpty(node.data))
        return false;

      return true;
    } else {
      return true;
    }
  });
}

function iterateHTMLNodes(callback, _incomingNodeContext) {
  let incomingNodeContext = Object.assign({}, _incomingNodeContext || {});
  let depth               = incomingNodeContext.depth || 0;
  let insideJSX           = incomingNodeContext.insideJSX || false;
  let results             = [];
  let firstChild          = true;
  let insideIf            = false;
  let nodes               = incomingNodeContext.nodes;
  let filteredNodes       = filterDOMNodes(nodes, insideJSX);

  let nodeContext = Object.assign({ nodeIndex: 0 }, incomingNodeContext, {
    depth,
    insideJSX,
    insideIf,
    firstChild,
  });

  let filteredNodesLength = filteredNodes.length;
  for (; nodeContext.nodeIndex < filteredNodesLength; nodeContext.nodeIndex++) {
    let node = filteredNodes[nodeContext.nodeIndex];
    if (node.type !== 'tag')
      continue;

    let nodeName = node.name;
    let isTemplate = false;

    if (nodeName === 'template') {
      nodeName = 'div';
      isTemplate = true;
    } else if (nodeName.indexOf('-') >= 0) {
      nodeName = Nife.capitalize(MiscUtils.convertPropOrStateName(nodeName));
    }

    let attributes = node.attribs || {};
    let lastChild = ((nodeContext.nodeIndex + 1) >= filteredNodesLength);

    nodeContext = Object.assign(nodeContext, {
      node,
      nodeName,
      attributes,
      lastChild,
      firstChild,
      isTemplate,
    });

    let result = callback(results, nodeContext);
    if (result)
      return result;

    firstChild = false;
  }

  return results.join('');
}

function generateJSXFromDOM(nodes, incomingNodeContext) {
  if (Nife.isEmpty(nodes))
    return '';

  const constructNode = (nodeContext) => {
    let {
      context,
      depth,
      attributes,
      node,
      nodeName,
    } = nodeContext;

    let prefix = MiscUtils.getTabWidthForDepth(depth);
    let results = [];

    results.push(`${prefix}<${nodeName}`);

    if (nodeContext.isTemplate)
      results.push(' /* TODO: Was template = true */ ');

    let attributesStr = attributesToJSX(context, node, attributes, depth);
    if (Nife.isNotEmpty(attributesStr)) {
      results.push(' ');
      results.push(attributesStr);
    }

    let childrenStr;

    if (Object.prototype.hasOwnProperty.call(attributes, 'v-text')) {
      let value = convertInlineCode(context, attributes['v-text'], false);
      childrenStr = `  ${MiscUtils.getTabWidthForDepth(depth + 2)}{${value}}\n`;
    } else {
      childrenStr = generateJSXFromDOM(node.children || [], Object.assign({}, nodeContext, { depth: depth + 1, nodeIndex: 0 }));
    }

    if (Nife.isNotEmpty(childrenStr)) {
      if (attributesStr.indexOf('\n') >= 0) {
        results.push('\n');
        results.push(`${prefix}>\n`);
      } else {
        results.push('>\n');
      }

      results.push(childrenStr);
      results.push(`${prefix}</${nodeName}>\n`);
    } else {
      if (attributesStr.indexOf('\n') >= 0) {
        results.push('\n');
        results.push(`${prefix}/>\n`);
      } else {
        results.push('/>\n');
      }
    }

    return results.join('');
  };

  const handleIfStatement = (outerNodeContext) => {
    return iterateHTMLNodes((results, nodeContext) => {
      let {
        context,
        depth,
        attributes,
        node,
        lastChild,
      } = nodeContext;

      let prefix = MiscUtils.getTabWidthForDepth(depth);

      let ifAttribute = getIfAttribute(attributes);
      if (!ifAttribute) {
        if (nodeContext.nodeIndex > outerNodeContext.nodeIndex) {
          results.push(`\n${prefix}})()}\n\n`);
          outerNodeContext.nodeIndex = nodeContext.nodeIndex - 1;
        }

        return results.join('');
      }

      let type            = ifAttribute.type;
      let isShow          = (type === 'v-show');
      let value           = convertInlineCode(context, ifAttribute.value);
      let innerPrefix     = MiscUtils.getTabWidthForDepth(depth + 1);
      let innerPrefix2    = MiscUtils.getTabWidthForDepth(depth + 2);

      if (type === 'v-if' || type === 'v-show')
        type = 'if';
      else if (type === 'v-else-if')
        type = 'else if';
      else if (type === 'v-else')
        type = 'else';

      if (type === 'if') {
        if (nodeContext.nodeIndex > outerNodeContext.nodeIndex) {
          // This isn't the first if statement
          // and we are encountering another one...
          // So close this if statement, and let
          // another loop handle this one
          results.push(`\n${prefix}})()}\n`);
          outerNodeContext.nodeIndex = nodeContext.nodeIndex - 1;
          return results.join('');
        }

        results.push(`${prefix}{(() => {\n`);
      }

      let condition;

      if (type !== 'else')
        condition = ` (${value}) `;
      else
        condition = ' ';

      results.push(`${(type !== 'if') ? ' ' : innerPrefix}${type}${condition}{\n`);
      let innerResult = constructNode(Object.assign({}, nodeContext, { node, depth: depth + 3 }));

      if (Nife.isEmpty(innerResult))
        results.push(`${innerPrefix2}return null;`);
      else
        results.push(`${innerPrefix2}return (\n${innerResult}${innerPrefix2});`);

      results.push(`\n${innerPrefix}}`);

      if (lastChild || isShow) {
        results.push(`\n${prefix}})()}\n`);
        outerNodeContext.nodeIndex = nodeContext.nodeIndex;
        return results.join('');
      }
    }, outerNodeContext);
  };

  const handleForLoop = (results, nodeContext) => {
    let {
      depth,
      context,
      attributes,
      node,
      ignoreForLoop,
    } = nodeContext;

    if (ignoreForLoop)
      return;

    let prefix = MiscUtils.getTabWidthForDepth(depth);

    let forAttribute = getForAttribute(context, attributes);
    if (!forAttribute)
      return;

    let args            = [ forAttribute.name, forAttribute.indexName ].filter(Boolean).join(', ');
    let forLoopResults  = [];
    let innerPrefix     = MiscUtils.getTabWidthForDepth(depth + 3);

    forLoopResults.push(`\n${prefix}{${forAttribute.sourceName}.map((${args}) => {\n`);
    let innerResult = constructNode(Object.assign({}, nodeContext, { node, depth: depth + 2 }));

    if (Nife.isEmpty(innerResult))
      forLoopResults.push(`${innerPrefix}return null;`);
    else
      forLoopResults.push(`${innerPrefix}return (\n${innerResult}\n${innerPrefix});`);
    forLoopResults.push(`\n${prefix}})}\n`);

    results.push(forLoopResults.join(''));

    return true;
  };

  // v-html = v-text, but for html

  return iterateHTMLNodes((results, nodeContext) => {
    let {
      attributes,
      firstChild,
    } = nodeContext;

    if (!firstChild)
      results.push('\n');

    let ifAttribute = getIfAttribute(attributes);
    if (ifAttribute) {
      let result = handleIfStatement(nodeContext);
      results.push(result);
      return;
    }

    if (handleForLoop(results, nodeContext))
      return;

    let result = constructNode(nodeContext);
    if (result)
      results.push(result);
  }, Object.assign({}, incomingNodeContext || {}, { nodes, nodeIndex: 0 }));
}

function generateRenderMethod(context, template) {
  if (!template)
    return '  return null;';

  let jsx = generateJSXFromDOM([ template ], { depth: 3, context });
  return `  return (\n${jsx}    );`;
}

function generateState(state) {
  return MiscUtils.convertValueToJS(MiscUtils.convertObjectKeys(state, toStateName), 2);
}

function generateReactComponent(parsedSFC) {
  let componentName           = parsedSFC.componentName;
  let convertedComponentName  = parsedSFC.convertedComponentName;
  let scriptObject            = MiscUtils.evalScript(parsedSFC.script);
  let propsInterface          = propsToInterface(componentName, scriptObject);
  let propNames               = Object.keys(scriptObject.props || {});
  let state                   = getState(scriptObject);
  let stateInterface          = stateToInterface(componentName, state);
  let stateNames              = Object.keys(state || {});
  let computedNames           = getComputedNames(scriptObject);
  let methodNames             = getMethodNames(scriptObject);
  let context                 = { propNames, stateNames, computedNames, methodNames, componentName, convertedComponentName };
  // let stateCalls              = generateStateCalls(state);
  let computeMethods          = generateComputed(context, scriptObject);
  let methods                 = generateMethods(context, scriptObject);
  let renderJSX               = generateRenderMethod(context, parsedSFC.template);
  let hasEnyxusUtils          = (/this\.\$enyxusUtils/g).test(parsedSFC.script);

  // TODO: Handle scriptSetup

  return `
import React from 'react';
import classNames from 'classnames';
${(hasEnyxusUtils) ? 'import EnyxusUtils from \'@utils/enyxus-utils\';\n' : '\n'}import ComponentUtils from '@utils/component-utils';
import './styles.scss';

${propsInterface}

${stateInterface}

export default class ${componentName} extends React.PureComponent {
  props: ${componentName}Props;
  state: ${componentName}State;

  constructor(props: ${componentName}Props, ...args) {
    super(props, ...args);

    this.state = ComponentUtils.createState(${generateState(state)});
  }

${methods}

${computeMethods}
  render() {
  ${renderJSX}
  }
}
`;
}

function convertToReact(inputPath, outputPath, parsedSFC) {
  let { filePath, fullFileName, name, nameConverted } = getOutputPathAndName(inputPath, outputPath, parsedSFC);

  parsedSFC.componentName = name;
  parsedSFC.convertedComponentName = nameConverted;

  let cssFullFileName = Path.join(filePath, 'styles.scss');
  let styleSheet      = parsedSFC.style || '';
  FileSystem.writeFileSync(cssFullFileName, styleSheet, 'utf8');

  let reactComponent = generateReactComponent(parsedSFC);
  //let templateStr = Util.inspect(parsedSFC.template, { depth: Infinity });
  // console.log('COMPONENT: ', reactComponent);

  FileSystem.writeFileSync(fullFileName, reactComponent, 'utf8');
}

module.exports = {
  convertToReact,
};
