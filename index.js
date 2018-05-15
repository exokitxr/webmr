#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const https = require('https');
const zlib = require('zlib');

const minimist = require('minimist');
const tarFs = require('tar-fs');
const progress = require('progress');
const parseJsonResponse = require('parse-json-response');

const HOSTNAME = 'registry.webmr.io';

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
  let index = -1;
  if (((index = args._.findIndex(a => a === 'p' || a === 'pub' || a === 'publish')) !== -1) && args.username) {
    args._.splice(index, 1);

    const directoryPath = path.resolve(process.cwd(), args._[1] || '.');
    const packageJsonPath = path.join(directoryPath, 'package.json');
    const {username} = args;

    fs.readFile(packageJsonPath, 'utf8', (err, d) => {
      if (!err) {
        const s = d.toString('utf8');
        const j = JSON.parse(s);
        const {name, version = '0.0.1'} = j;

        if (name) {
          const bs = [];
          const packStream = tarFs.pack(directoryPath).pipe(zlib.createGzip());
          packStream.on('data', d => {
            bs.push(d);
          });
          packStream.on('end', () => {
            const req = https.request({
              method: 'PUT',
              hostname: HOSTNAME,
              path: '/projects',
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
                  console.log(`+ ${module}@${version} https://files.webmr.io/${module}/${version}/`);
                });
                res.on('error', err => {
                  console.warn(err.stack);
                  process.exit(1);
                });
              } else {
                console.warn('connection error');
                process.exit(1);
              }
            });
            req.on('error', err => {
              console.warn(err.stack);
              process.exit(1);
            });

            let size = 0;
            for (let i = 0; i < bs.length; i++) {
              size += bs[i].length;
            }

            const bar = new progress(`[:bar] ${name}@${version} :rate bps :percent :etas`, {
              complete: '█',
              incomplete: '.',
              width: 20,
              total: size,
            });

            let i = 0;
            const _recurse = () => {
              for (;;) {
                if (i < bs.length) {
                  const b = bs[i++];
                  const more = req.write(b);
                  bar.tick(b.length);
                  if (more) {
                    continue;
                  } else {
                    req.once('drain', _recurse);
                  }
                } else {
                  req.end();
                  break;
                }
              }
            };
            _recurse();
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
  } else if (((index = args._.findIndex(a => a === 'u' || a === 'url')) !== -1) && args.username) {
    args._.splice(index, 1);

    if (args._[0].length > 0) {
      const fileName = args._[0];
      const rs = fs.createReadStream(fileName);

      const req = https.request({
        method: 'PUT',
        hostname: HOSTNAME,
        path: path.join('/', 'files', path.basename(fileName)),
      }, res => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          parseJsonResponse(res, (err, j) => {
            if (!err) {
              const {path: p} = j;
              console.log('https://' + HOSTNAME + '/' + p);
            } else {
              console.warn(err.stack);
              process.exit(1);
            }
          });
        } else {
          console.warn(`got invalid status code ${res.statusCode}`);
          process.exit(1);
        }
      });

      rs.pipe(req);
      req.on('error', err => {
        if (err.code === 'ENOENT') {
          console.warn(`file does not exist: ${JSON.stringiy(fileName)}`);
        } else {
          console.warn(err.stack);
        }
        process.exit(1);
      });
    } else {
      console.warn('missing argument: file name');
      process.exit(1);
    }
  } else {
    console.warn('usage: webmr publish [-u username] [-p password] <directory>');
  }
}
