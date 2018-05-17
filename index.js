#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const os = require('os');

const minimist = require('minimist');
const tarFs = require('tar-fs');
const progress = require('progress');
const parseJsonResponse = require('parse-json-response');
const rimraf = require('rimraf');

const REGISTRY_HOSTNAME = 'registry.webmr.io';
const REGISTRY_PORT = null;
const REGISTRY_SECURE = true;

if (require.main === module) {
  const _jsonParse = s => {
    try {
      return JSON.parse(s);
    } catch (err) {
      return null;
    }
  };

  const configFilePath = path.join(os.homedir(), '.webmr-cli');
  const _requestConfig = () => new Promise((accept, reject) => {
    fs.readFile(configFilePath, 'utf8', (err, s) => {
      if (!err) {
        accept(_jsonParse(s));
      } else if (err.code === 'ENOENT') {
        accept(null);
      } else {
        reject(err);
      }
    });
  });

  const args = minimist(process.argv.slice(2), {
    // XXX
  });
  let index = -1;
  if ((index = args._.findIndex(a => a === 'l' || a === 'login')) !== -1) {
    args._.splice(index, 1);

    const prompt = require('prompt');
    prompt.message = '';
    prompt.delimiter = ':';
    prompt.start();
    prompt.get([
      {
        name: 'email',
        message: 'Email',
        empty: false,
      },
      {
        name: 'password',
        message: 'Password',
        empty: false,
        hidden: true,
      },
    ], (err, result) => {
      if (result) {
        const {email, password} = result;
        const req = (REGISTRY_SECURE ? https : http).request({
          method: 'POST',
          hostname: REGISTRY_HOSTNAME,
          port: REGISTRY_PORT,
          path: '/l',
          headers: {
            'Content-Type': 'application/json',
          },
        }, res => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            parseJsonResponse(res, (err, j) => {
              if (!err) {
                const {token} = j;

                fs.writeFile(configFilePath, JSON.stringify({
                  email,
                  token,
                }), err => {
                  if (!err) {
                    console.log('Logged in as', email);
                  } else {
                    console.warn(err.stack);
                    process.exit(1);
                  }
                });
              } else {
                console.warn(err.stack);
                process.exit(1);
              }
            });
          } else if (res.statusCode === 400) {
            console.warn(`Invalid request (missing email or password)`);
            process.exit(1);
          } else if (res.statusCode === 403) {
            console.warn(`Invalid password for ${email}`);
            process.exit(1);
          } else {
            console.warn(`invalid status code: ${res.statusCode}`);
            res.pipe(process.stderr);
            res.on('end', () => {
              process.exit(1);
            });
          }
        });
        req.on('error', err => {
          console.warn(err.stack);
          process.exit(1);
        });
        req.end(JSON.stringify({
          email,
          password,
        }));
      } else {
        console.log();
      }
    });
  } else if ((index = args._.findIndex(a => a === 'logout')) !== -1) {
    args._.splice(index, 1);

    rimraf(configFilePath, err => {
      if (!err) {
        // nothing
      } else {
        console.earn(err.stack);
        process.exit(1);
      }
    });
  } else if ((index = args._.findIndex(a => a === 'w' || a === 'whoami')) !== -1) {
    _requestConfig()
      .then(config => {
        if (config && config.email) {
          console.log('Logged in as', config.email);
        } else {
          console.log('Not logged in');
        }
      })
      .catch(err => {
        console.warn(err.stack);
        process.exit(1);
      });
  } else if ((index = args._.findIndex(a => a === 'p' || a === 'pub' || a === 'publish')) !== -1) {
    args._.splice(index, 1);

    if (args._.length > 0) {
      _requestConfig()
        .then(config => {
          if (config) {
            const directoryPath = path.resolve(process.cwd(), args._[0] || '.');
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
                    const req = (REGISTRY_SECURE ? https : http).request({
                      method: 'PUT',
                      hostname: REGISTRY_HOSTNAME,
                      port: REGISTRY_PORT,
                      path: '/p',
                      headers: {
                        'Authorization': `Token ${config.email} ${config.token}`,
                      },
                    }, res => {
                      if (res.statusCode >= 200 && res.statusCode < 300) {
                        parseJsonResponse(res, (err, j) => {
                          if (!err) {
                            const {name, version} = j;
                            console.log(`+ ${name}@${version}`);
                            console.log(`http${REGISTRY_SECURE ? 's' : ''}://${REGISTRY_HOSTNAME}${REGISTRY_PORT ? (':' + REGISTRY_PORT) :''}/${name}/${version}/`);
                          } else {
                            console.warn(err.stack);
                            process.exit(1);
                          }
                        });
                      } else if (res.statusCode === 401) {
                        console.warn('Not logged in');
                        process.exit(1);
                      } else if (res.statusCode === 403) {
                        console.warn(`Permisson denied for ${name}`);
                        process.exit(1);
                      } else if (res.statusCode === 409) {
                        console.warn(`cannot overwrite: ${name}@${version} already exists`);
                        process.exit(1);
                      } else {
                        console.warn(`invalid status code: ${res.statusCode}`);
                        res.pipe(process.stderr);
                        res.on('end', () => {
                          process.exit(1);
                        });
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
          } else {
            console.warn('Use `webmr login` to log in');
            process.exit(1);
          }
        });
    } else {
      console.warn('missing argument: directory name');
      process.exit(1);
    }
  } else if ((index = args._.findIndex(a => a === 'u' || a === 'url')) !== -1) {
    args._.splice(index, 1);

    if (args._.length > 0) {
      _requestConfig()
        .then(config => {
          if (config) {
            const fileName = path.resolve(process.cwd(), args._[0]);

            fs.lstat(fileName, (err, stats) => {
              if (!err) {
                if (stats.isFile()) {
                  const rs = fs.createReadStream(fileName);

                  const req = (REGISTRY_SECURE ? https : http).request({
                    method: 'PUT',
                    hostname: REGISTRY_HOSTNAME,
                    port: REGISTRY_PORT,
                    path: '/f/' + path.basename(fileName),
                    headers: {
                      'Authorization': `Token ${config.email} ${config.token}`,
                    },
                  }, res => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                      parseJsonResponse(res, (err, j) => {
                        if (!err) {
                          console.log(j.url);
                        } else {
                          console.warn(err.stack);
                          process.exit(1);
                        }
                      });
                    } else if (res.statusCode === 401) {
                      console.warn('Not logged in');
                      process.exit(1);
                    } else if (res.statusCode === 403) {
                      console.warn('Permisson denied');
                      process.exit(1);
                    } else {
                      console.warn(`got invalid status code ${res.statusCode}`);
                      res.pipe(process.stderr);
                      res.on('end', () => {
                        process.exit(1);
                      });
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
                } else if (stats.isDirectory()) {
                  const directoryPath = path.resolve(process.cwd(), args._[0] || '.');

                  const bs = [];
                  const packStream = tarFs.pack(directoryPath).pipe(zlib.createGzip());
                  packStream.on('data', d => {
                    bs.push(d);
                  });
                  packStream.on('end', () => {
                    const req = (REGISTRY_SECURE ? https : http).request({
                      method: 'PUT',
                      hostname: REGISTRY_HOSTNAME,
                      port: REGISTRY_PORT,
                      path: '/d/' + path.basename(directoryPath),
                      headers: {
                        'Authorization': `Token ${config.email} ${config.token}`,
                      },
                    }, res => {
                      if (res.statusCode >= 200 && res.statusCode < 300) {
                        parseJsonResponse(res, (err, j) => {
                          if (!err) {
                            console.log(j.url);
                          } else {
                            console.warn(err.stack);
                            process.exit(1);
                          }
                        });
                      } else if (res.statusCode === 401) {
                        console.warn('Not logged in');
                        process.exit(1);
                      } else if (res.statusCode === 403) {
                        console.warn(`Permisson denied for ${name}`);
                        process.exit(1);
                      } else if (res.statusCode === 409) {
                        console.warn(`Cannot overwrite: ${name}@${version} already exists`);
                        process.exit(1);
                      } else {
                        console.warn(`invalid status code: ${res.statusCode}`);
                        res.pipe(process.stderr);
                        res.on('end', () => {
                          process.exit(1);
                        });
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

                    const bar = new progress(`[:bar] ${directoryPath} :rate bps :percent :etas`, {
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
                  console.warn(`not a file or directory: ${fileName}`);
                  process.exit(1);
                }
              } else {
                console.warn(err.stack);
                process.exit(1);
              }
            });
          } else {
            console.warn('Not logged in; use webmr login');
            process.exit(1);
          }
        });
    } else {
      console.warn('missing argument: file name');
      process.exit(1);
    }
  } else if ((index = args._.findIndex(a => a === 's' || a === 'server')) !== -1) {
    args._.splice(index, 1);

    if ((index = args._.findIndex(a => a === 'ls')) !== -1) {
      args._.splice(index, 1);

      const req = (REGISTRY_SECURE ? https : http).request({
        method: 'GET',
        hostname: REGISTRY_HOSTNAME,
        port: REGISTRY_PORT,
        path: '/s',
      }, res => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          parseJsonResponse(res, (err, j) => {
            if (!err) {
              const {servers} = j;
              if (servers.length > 0) {
                console.log(servers.map(server => JSON.stringify(server.name)).join('\n'));
              } else {
                console.log('No servers');
              }
            } else {
              console.warn(err.stack);
              process.exit(1);
            }
          });
        } else {
          console.warn(`invalid status code: ${res.statusCode}`);
          res.pipe(process.stderr);
          res.on('end', () => {
            process.exit(1);
          });
        }
      });
      req.on('error', err => {
        console.warn(err.stack);
        process.exit(1);
      });
      req.end();
    } else if ((index = args._.findIndex(a => a === 'add')) !== -1) {
      args._.splice(index, 1);

      if (args._.length > 0) {
        const name = args._[0];

        const req = (REGISTRY_SECURE ? https : http).request({
          method: 'POST',
          hostname: REGISTRY_HOSTNAME,
          port: REGISTRY_PORT,
          path: '/s/' + name,
        }, res => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            parseJsonResponse(res, (err, j) => {
              if (!err) {
                console.log(j);
              } else {
                console.warn(err.stack);
                process.exit(1);
              }
            });
          } else {
            console.warn(`invalid status code: ${res.statusCode}`);
            res.pipe(process.stderr);
            res.on('end', () => {
              process.exit(1);
            });
          }
        });
        req.on('error', err => {
          console.warn(err.stack);
          process.exit(1);
        });
        req.end();
      } else {
        console.warn('Missing server name');
        process.exit(1);
      }
    } else if ((index = args._.findIndex(a => a === 'rm')) !== -1) {
      args._.splice(index, 1);

      if (args._.length > 0) {
        const name = args._[0];

        const req = (REGISTRY_SECURE ? https : http).request({
          method: 'DELETE',
          hostname: REGISTRY_HOSTNAME,
          port: REGISTRY_PORT,
          path: '/s/' + name,
        }, res => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            parseJsonResponse(res, (err, j) => {
              if (!err) {
                console.log(j);
              } else {
                console.warn(err.stack);
                process.exit(1);
              }
            });
          } else {
            console.warn(`invalid status code: ${res.statusCode}`);
            res.pipe(process.stderr);
            res.on('end', () => {
              process.exit(1);
            });
          }
        });
        req.on('error', err => {
          console.warn(err.stack);
          process.exit(1);
        });
        req.end();
      } else {
        console.warn('Missing server name');
        process.exit(1);
      }
    } else {
      console.warn('invalid command');
      process.exit(1);
    }
  } else {
    console.warn('usage: webmr [login|logout|whoami|publish|url|server [ls|add|rm]] <file>');
  }
}
