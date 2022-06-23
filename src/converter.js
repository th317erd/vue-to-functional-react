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

  if (!nameConverted.startsWith('enyxus-'))
    nameConverted = `enyxus-${nameConverted}`;

  let filePath = Path.join(outputDir, nameConverted);
  FileSystem.mkdirSync(filePath, { recursive: true });

  return {
    fullFileName: Path.join(outputDir, nameConverted, `${nameConverted}.tsx`),
    name:         Nife.capitalize(Nife.snakeCaseToCamelCase(nameConverted.replace(/-+/g, '_'))),
    filePath,
    nameConverted,
  };
}

function vueTypeToTSType(type, rawType) {
  if (rawType) {
    if (type == null)
      return 'any /* TODO: Validate proper type */';

    if (type instanceof Date)
      return 'Date';
    else if (Nife.instanceOf(type, 'number'))
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
      interfaceParts.push(`${prefix}${newPropName}: ${result};\n`);
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
  let value = MiscUtils.convertPropOrStateName(name);
  if (value === 'state')
    value = 'computedState';

  return value;
}

function hasSourceCode(context, code) {
  let { parsedCode } = parseCodeVariables(context, code);

  let count = 0;

  let remaining = parsedCode.replace(/@@@(TAG|PROP)\[(\d+)\]@@@/g, () => {
    count++;
    return '';
  });

  if (count > 0 && Nife.isNotEmpty(remaining))
    return true;

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

  if (Nife.isEmpty(allVariableNames))
    return { parsedCode: code, matches: [], tags: [] };

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

      let extra = '';
      if (parts.length > 1)
        extra = `.${parts.slice(1).join('.')}`;

      return `@@@PROP[${index}]@@@${extra}`;
    });

  if (onlyThis !== true) {
    parsedCode = parsedCode.replace(variablesRegExp, (m, name, offset, src) => {
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

      let postfix = src.substring(offset + m.length);
      if ((/^\s*:/).test(postfix))
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
        postfix,
      });

      return `@@@PROP[${index}]@@@`;
    });
  }

  return { parsedCode, matches, tags };
}

function mutateSourceCode(parsedResult, callback, insideJSX) {
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
      postfix,
    } = match;

    if (type === 'method') {
      return `this.${toMethodName(name)}`;
    } else if (type === 'computed') {
      if (insideJSX) {
        let value = `computed${Nife.capitalize(toComputeName(name))}`;
        if (assignment)
          value = `${value} /* TODO: Fixme... set on computed prop... needs to be a state variable? */`;

        return value;
      } else {
        let value = `this.${toComputeName(name)}`;
        if (assignment)
          value = `${value} /* TODO: Fixme... set on computed prop... needs to be a state variable? */`;

        if (!(/^\(/).test(postfix))
          value = `${value}()`;

        return value;
      }
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

  let mutatedCode = parsedCode.replace(/@@@(TAG|PROP)\[(\d+)\]@@@/g, (tagMatch, tagType, _index, offset, source) => {
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
  });

  mutatedCode = mutatedCode.replace(/this\.\$enyxusUtils/g, 'EnyxusUtils')
    .replace(/this\.\$enyxusCmd/g, 'EnyxusCommands')
    .replace(/this\.\$emit/g, 'this.emit')
    .replace(/\$emit/g, 'this.emit')
    .replace(/\bsetTimeout\b/g, 'this.debounce')
    .replace(/this\.\$refs\.([\w$_-]+)/g, (m, refName) => {
      return `this.getReference('$${refName}')`;
    });

  return mutatedCode;
}

function convertInlineCode(context, code, events, insideJSX) {
  let result      = parseCodeVariables(context, code, false);
  let mutatedCode = mutateSourceCode(result, ({ match, output }) => {
    if (match.type !== 'method')
      return output;

    if (events && !(/^\(/).test(match.postfix))
      return `${output}(event);`;

    return output;
  }, insideJSX);

  return mutatedCode;
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
  let value = MiscUtils.convertPropOrStateName(name);
  if (value === 'state')
    value = 'methodState';

  return value;
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

    if (funcBody.match(/^\s*(function\s+)?(state|action|getter)\(/))
      funcBody = funcBody.replace(/^\s*(function\s+)?[\w$]+\s*\(\s*\)\s*/, `${toMethodName(methodName)} = () => `);
    else
      funcBody = funcBody.replace(/^\s*(function\s+)?[\w$]+/, `${toMethodName(methodName)} = `);

    methodParts.push(`  ${trimMethodDepth(funcBody, 1)};\n`);
  }

  return `  /* START METHODS */\n${methodParts.join('\n').trimEnd()}\n  /* END METHODS */\n`;
}

function convertAttributeNameToJSXName(name) {
  if (name === 'class')
    return 'className';


  if (name.indexOf(':') >= 0) {
    return name.replace(/:(.)/g, (m, char) => {
      return char.toUpperCase();
    });
  }

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

    if ((/^(v-text|v-for|v-if|v-else-if|v-else|v-show)/).test(attributeName)) {
      // Handled at the JSX level
      continue;
    } else if (attributeName === 'v-html') {
      propName  = 'dangerouslySetInnerHTML';
      value     = `{ __html: ${attributeValue} }`;
    } else if ((/^v-bind:/).test(attributeName)) {
      propName  = convertAttributeNameToJSXName(attributeName.replace(/^v-bind:/, ''));
      value     = attributeValue;
    } else if (attributeName.charAt(0) === ':') {
      propName  = convertAttributeNameToJSXName(attributeName.substring(1));
      value     = attributeValue;
    } else if (attributeName.charAt(0) === '@') {
      let eventNameParts  = attributeName.substring(1).split('.');
      let eventName       = eventNameParts[0];
      let reactEventName  = EventUtils.convertToReactEventName(eventName);
      let comment         = '';
      value               = attributeValue;

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

    if (!propName || !value)
      continue;

    let values = finalAttributes[propName];
    if (!values)
      values = finalAttributes[propName] = [];

    values.push(value.replace(/[\n\s]+/g, ' '));
  }

  let keys = Object.keys(finalAttributes);
  for (let i = 0, il = keys.length; i < il; i++) {
    let propName  = keys[i];
    let values    = finalAttributes[propName];
    let value     = undefined;

    if (propName === 'className') {
      if (node.parent && node.parent.name === 'template')
        values = Nife.uniq([].concat(values));

      value = convertInlineCode(context, values.join(', '), false, true);

      value = `{classNames(${value})}`;
    } else if (propName === 'ref') {
      value = `{this.captureReference(${values.join('')})}`;
    } else {
      if (propName === 'style') {
        value = values.map((thisValue) => {
          if ((/^(['"])(?:\\.|.)*?\1$/).test(thisValue)) {
            let parsedCSS = MiscUtils.parseCSS(thisValue.substring(1, thisValue.length - 1));
            return MiscUtils.convertValueToJS(parsedCSS).trim().replace(/[\n\s]+/g, ' ');
          }

          return convertInlineCode(context, thisValue, false, true);
        }).join(', ');
      } else {
        value = convertInlineCode(context, values.join(', '), false, true);
      }

      let isSource  = hasSourceCode(context, value);
      if (propName !== 'className' && !(/^\{\{|^\{\(/).test(value) && (isSource || !(/^['"]/).test(value))) {
        if (propName === 'style' && values.length > 1)
          value = `[ ${value} ]`;

        value = `{${value.replace(/\n\s*/g, ' ')}}`;
      }
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
      sourceName = convertInlineCode(context, sourceName, false, true);

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
  let nodes               = incomingNodeContext.nodes;
  let filteredNodes       = filterDOMNodes(nodes, insideJSX);

  let nodeContext = Object.assign({ nodeIndex: 0 }, incomingNodeContext, {
    depth,
    insideJSX,
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
      insideJSX,
    } = nodeContext;

    let prefix = MiscUtils.getTabWidthForDepth(depth);
    let results = [];

    results.push(`${prefix}<${nodeName}`);

    if (nodeContext.isTemplate) {
      if (!insideJSX)
        results.push(` ref={this.captureReference('rootElement')} className='${context.convertedComponentName}'`);

      results.push(' /* TODO: Was template = true */ ');
    }

    let attributesStr = attributesToJSX(context, node, attributes, depth);
    if (Nife.isNotEmpty(attributesStr)) {
      results.push(' ');
      results.push(attributesStr);
    }

    let childrenStr;

    if (Object.prototype.hasOwnProperty.call(attributes, 'v-text')) {
      let value = convertInlineCode(context, attributes['v-text'], false, true);
      childrenStr = `  ${MiscUtils.getTabWidthForDepth(depth + 2)}{${value}}\n`;
    } else {
      childrenStr = generateJSXFromDOM(node.children || [], Object.assign({}, nodeContext, { depth: depth + 1, nodeIndex: 0, insideJSX: true }));
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
      let value           = convertInlineCode(context, ifAttribute.value, false, true);
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
      let innerResult = constructNode(Object.assign({}, nodeContext, { node, depth: depth + 3, insideJSX: true }));

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
    let innerPrefix     = MiscUtils.getTabWidthForDepth(depth + 1);

    forLoopResults.push(`${prefix}{${forAttribute.sourceName}.map((${args}) => {\n`);
    let innerResult = constructNode(Object.assign({}, nodeContext, { node, depth: depth + 2, insideJSX: true }));

    if (Nife.isEmpty(innerResult))
      forLoopResults.push(`${innerPrefix}return null;`);
    else
      forLoopResults.push(`${innerPrefix}return (\n${innerResult}${innerPrefix});`);

    forLoopResults.push(`\n${prefix}})}\n`);

    results.push(forLoopResults.join(''));

    return true;
  };

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

function generateWatchMethods(scriptObject) {
  let watches     = (scriptObject && scriptObject.watch) || {};
  let watchNames  = Object.keys(watches);
  let parts       = [];

  for (let i = 0, il = watchNames.length; i < il; i++) {
    let watchName = watchNames[i];
    let stateName = toStateName(watchName);
    let value     = watches[watchName];

    parts.push(`  onStateUpdated_${stateName} = () => {\n    /* ${value} */\n  }\n\n`);
  }

  if (Nife.isEmpty(parts))
    return '';

  return `  /* START STATE WATCH HOOKS */\n${parts.join('').trimEnd()}\n  /* END STATE WATCH HOOKS */\n`;
}

function generateComputeVariables(computedNames) {
  if (Nife.isEmpty(computedNames))
    return '';

  let parts = [];
  for (let i = 0, il = computedNames.length; i < il; i++) {
    let computedName  = computedNames[i];
    let convertedName = toComputeName(computedName);

    parts.push(`    const computed${Nife.capitalize(convertedName)} = this.${convertedName}();\n`);
  }

  return parts.join('');
}

function generateCreatedHook(context, scriptObject) {
  if (!scriptObject || !scriptObject.created)
    return '';

  return `\n    (function ${convertMethod(context, '' + scriptObject.created).replace(/^/gm, '  ').trim()}).call(this);\n`;
}

function generateMountedHook(context, scriptObject) {
  if (!scriptObject || !scriptObject.mounted)
    return '';

  return `  componentDidMount() {\n    (function ${convertMethod(context, '' + scriptObject.mounted).replace(/^/gm, '  ').trim()}).call(this);\n  }`;
}

function generateUnmountedHook(context, scriptObject) {
  if (!scriptObject || !(scriptObject.destroyed || scriptObject.unmounted))
    return '';

  let parts = [];

  if (scriptObject.unmounted)
    parts.push(`    (function ${convertMethod(context, '' + scriptObject.unmounted).replace(/^/gm, '  ').trim()}).call(this);`);

  if (scriptObject.destroyed)
    parts.push(`    (function ${convertMethod(context, '' + scriptObject.destroyed).replace(/^/gm, '  ').trim()}).call(this);`);

  return `  componentWillUnmount() {\n${parts.join('\n')}\n  }`;
}

function generateReactComponent(parsedSFC) {
  let componentName           = parsedSFC.componentName;
  let convertedComponentName  = parsedSFC.convertedComponentName;
  let scriptObject            = MiscUtils.evalScript(parsedSFC.script);
  let propsInterface          = propsToInterface(componentName, scriptObject);
  let propNames               = (Array.isArray(scriptObject.props)) ? scriptObject.props : Object.keys(scriptObject.props || {});
  let state                   = getState(scriptObject);
  let stateInterface          = stateToInterface(componentName, state);
  let stateNames              = Object.keys(state || {});
  let watchMethods            = generateWatchMethods(scriptObject);
  let computedNames           = getComputedNames(scriptObject);
  let methodNames             = getMethodNames(scriptObject);
  let context                 = { propNames, stateNames, computedNames, methodNames, componentName, convertedComponentName };
  // let stateCalls              = generateStateCalls(state);
  let computeMethods          = generateComputed(context, scriptObject);
  let methods                 = generateMethods(context, scriptObject);
  let renderJSX               = generateRenderMethod(context, parsedSFC.template);
  let hasEnyxusUtils          = (/this\.\$enyxusUtils/g).test(parsedSFC.script);
  let hasEnyxusCmd            = (/this\.\$enyxusCmd/g).test(parsedSFC.script);

  let generatedRenderComputeVariables = generateComputeVariables(computedNames);

  // TODO: Handle scriptSetup

  return `
import React from 'react';
import classNames from 'classnames';
import ComponentBase from '@components/base/component-base';${(hasEnyxusUtils) ? '\nimport EnyxusUtils from \'@utils/enyxus-utils\';\n' : ''}${(hasEnyxusCmd) ? '\nimport EnyxusCommands from \'@utils/enyxus-cmd\';\n' : ''}
import './styles.scss';

${propsInterface}

${stateInterface}

export default class ${componentName} extends ComponentBase<${componentName}Props, ${componentName}State> {
  constructor(...args) {
    super(...args);

    this.state = ${generateState(state)};
    ${generateCreatedHook(context, scriptObject)}
  }

${generateMountedHook(context, scriptObject)}

${generateUnmountedHook(context, scriptObject)}

${watchMethods}

${methods}

${computeMethods}
  render() {
${generatedRenderComputeVariables}
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
  let styleSheet      = (parsedSFC.style || '').replace(/^/gm, '  ');

  styleSheet = `.${nameConverted} {\n  ${styleSheet.trim()}\n}`;
  FileSystem.writeFileSync(cssFullFileName, styleSheet, 'utf8');

  let reactComponent = generateReactComponent(parsedSFC);

  FileSystem.writeFileSync(fullFileName, reactComponent, 'utf8');
}

module.exports = {
  convertToReact,
};
