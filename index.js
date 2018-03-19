#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const https = require('https');
const zlib = require('zlib');

const minimist = require('minimist');
const tarFs = require('tar-fs');

if (require.main === module) {
  const args = minimist(process.argv.slice(2), {
    alias: {
      u: 'username',
      p: 'password',
    },
    string: [
      'username',
      'u',
      'password',
      'p',
    ],
  });
  if (['publish', 'pub', 'p'].includes(args._[0]) && args.username) {
    const directoryPath = path.resolve(process.cwd(), args._[1] || '.');
    const packageJsonPath = path.join(directoryPath, 'package.json');
    fs.readFile(packageJsonPath, 'utf8', (err, d) => {
      if (!err) {
        const s = d.toString('utf8');
        const j = JSON.parse(s);
        const {name} = j;

        if (name) {
          const req = https.request({
            method: 'PUT',
            hostname: 'registry.webmr.io',
            path: `/p/${args.username}/${name}`
          }, res => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const bs = [];
              res.on('data', d => {
                bs.push(d);
              });
              res.on('end', () => {
                const b = Buffer.concat(bs);
                const s = b.toString('utf8');
                const j = JSON.parse(s);
                const {username, module, version} = j;
                console.log(`+ ${username}/${module}@${version} https://${module}.${username}.webmr.io/`);
              });
              res.on('error', err => {
                console.warn(err.stack);
                process.exit(1);
              });
            } else {
              res.pipe(process.stderr);
              res.on('end', () => {
                process.exit(1);
              });
            }
          });
          tarFs.pack(directoryPath).pipe(zlib.createGzip()).pipe(req);
          req.on('error', err => {
            console.warn(err.stack);
            process.exit(1);
          });
        } else {
          console.warn('package.json has no name key');
        }
      } else if (err.code === 'ENOENT') {
        console.warn('package.json not found');
        process.exit(1);
      } else {
        console.warn(err.stack);
        process.exit(1);
      }
    });
  } else {
    console.warn('usage: webmr publish [-u username] [-p password] <directory>');
  }
}
