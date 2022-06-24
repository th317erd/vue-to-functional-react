'use strict';

/* global process */

const Nife            = require('nife');
const janap           = require('janap');
const Path            = require('path');
const FileSystem      = require('fs');
const {
  FileUtils,
  ParserUtils,
} = require('./utils');

const { convertToReact } = require('./converter');

const HELP_CONTENT = `
Usage: vue-to-react -i {input folder} -o {output folder}
`;

(function() {
  const args = janap.parse(process.argv, {
    _alias: {
      'i': 'input',
      'o': 'output',
    },
    'input':  String,
    'output': String,
  });

  if (Nife.isEmpty(args.input) || Nife.isEmpty(args.output)) {
    console.log(HELP_CONTENT);
    process.exit(1);
  }

  let inputPath   = Path.resolve(args.input);
  let outputPath  = Path.resolve(args.output);

  if (!FileSystem.existsSync(inputPath)) {
    console.error('Specified input path does\'t exist!');
    process.exit(1);
  }

  let stats = FileSystem.statSync(inputPath);
  if (stats.isDirectory()) {
    FileUtils.walkFiles(
      inputPath,
      ({ fullFileName }) => {
        try {
          let result = ParserUtils.parseVueSFC(fullFileName);
          convertToReact(inputPath, outputPath, result);
        } catch (error) {
          console.error(`Error converting "${fullFileName}": `, error);
        }
      },
      {
        filter: ({ fullFileName, fileName, stats }) => {
          if (stats.isDirectory()) {
            if (fileName === 'node_modules')
              return false;

            return true;
          }

          return (/\.vue$/i).test(fullFileName);
        },
      },
    );
  } else {
    let result = ParserUtils.parseVueSFC(inputPath);
    convertToReact(inputPath, outputPath, result);
  }

  console.log('CLASS LIST: ');
  global.classList.filter((className) => {
    if (className.startsWith('enyxus'))
      return false;

    return true;
  }).sort().forEach((className) => {
    console.log(className);
  });
})();
