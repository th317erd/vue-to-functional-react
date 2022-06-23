'use strict';

const HTMLParser  = require('htmlparser2');
const FileSystem  = require('fs');

function parseVueSFC(filePath) {
  let fileContents = FileSystem.readFileSync(filePath, 'utf8');
  let dom = HTMLParser.parseDocument(fileContents, {
    //xml:                  true,
    recognizeSelfClosing: true,
  });

  let template;
  let script;
  let scriptSetup;
  let style;

  let children = dom.children;
  for (let i = 0, il = children.length; i < il; i++) {
    let child = children[i];

    if (child.name === 'template') {
      template = child;
    } else if (child.name === 'script') {
      let attributes = child.attribs;

      if (attributes && Object.prototype.hasOwnProperty.call(attributes, 'setup'))
        scriptSetup = child.children[0].data.replace(/\t/g, '  ');
      else
        script = child.children[0].data.replace(/\t/g, '  ');
    } else if (child.name === 'style') {
      style = child;
    }
  }

  if (style) {
    let styleContent = style.children[0].data;
    style = styleContent + '\n';
  }

  return {
    filePath,
    template,
    script,
    scriptSetup,
    style,
  };
}

module.exports = {
  parseVueSFC,
};
