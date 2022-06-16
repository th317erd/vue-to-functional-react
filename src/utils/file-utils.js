'use strict';

const Path        = require('path');
const FileSystem  = require('fs');

function walkFiles(path, callback, _opts) {
  let opts    = _opts || {};
  let files   = FileSystem.readdirSync(path);
  let filter  = opts.filter;

  for (let i = 0, il = files.length; i < il; i++) {
    let fileName      = files[i];
    let fullFileName  = Path.join(path, fileName);
    let stats          = FileSystem.lstatSync(fullFileName);

    let filterResult = (typeof filter === 'function') ? filter({ fullFileName, fileName, stats, path }) : undefined;
    if (filterResult === false)
      continue;

    if (stats.isDirectory())
      walkFiles(fullFileName, callback, opts);
    else if (stats.isFile())
      callback({ fullFileName, fileName, stats, path });
  }
}

function relativeOutputPath(_inputPath, outputPath, _filePath) {
  let inputPath = _inputPath;
  let filePath  = _filePath;
  let stats     = FileSystem.statSync(inputPath);

  if (!stats.isDirectory())
    inputPath = Path.dirname(inputPath);

  filePath = filePath.substring(inputPath.length).replace(/^[./\\]+/, '');

  return filePath;
}

module.exports = {
  walkFiles,
  relativeOutputPath,
};
