const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('choreoworkers.sqlite3');
const Scheduler = require('redis-scheduler');
const scheduler = new Scheduler({ host: '0.0.0.0', port: 6004 });
const fs = require('fs');
const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const mkdirp = require('mkdirp');
const byline = require('byline');

const runLoop = (task, key, service) => {
  scheduler.schedule({ key, expire: service.trigger.repeat, handler: task }, (err) => {
    if (err) {
      console.error(err);
    }
  });
};

const loop = (err, key) => {
  scheduler.cancel({ key }, (err) => {
    if (err) {
      return false;
    }
    perform({
      cb: runLoop,
      key,
      func: loop
    });
  });
};

function perform(configObject) {
  const key = configObject.key;
  db.serialize(() => {
    db.get('SELECT rowid AS id, jobname, config FROM workers WHERE jobname = ?', key.split('-')[0],
      (err, row) => {
        if (row) {
          const doc = JSON.parse(row.config.replace(/'/g, '"'));
          const service = doc[key.split('-')[1]];
          const pathPrefix = `/tmp/jobfiles/${key.split('-')[0]}/${key.split('-')[1]}`;

          let runnersh = '#! /bin/bash\n';

          for (const execType of Object.keys(service.exec)) {
            switch (execType) {
            case 'bash':
              for (const command of service.exec.bash) {
                runnersh += `${command}\n`;
              }
              break;
            case 'python2':
              for (const filename of Object.keys(service.exec.python2)) {
                runnersh += `python ${filename}\n`;
              }
              break;
            case 'python3':
              for (const filename of Object.keys(service.exec.python3)) {
                runnersh += `python3 ${filename}\n`;
              }
              break;
            case 'node':
              for (const filename of Object.keys(service.exec.node)) {
                runnersh += `node ${filename}\n`;
              }
              break;
            }
          }

          fs.writeFileSync(`${pathPrefix}/runner.sh`,
            runnersh, { mode: '775' }, (err) => {
              if (err) {
                console.log('cannot write runnersh to /tmp');
              }
            });

          docker.createContainer({
            Image: 'tocttou/choreograph-child',
            Cmd: ['/bin/bash', 'runner.sh'],
            NetworkMode: 'host',
            Tty: true,
            Binds: ['/tmp:/tmp'],
            WorkingDir: `/tmp/jobfiles/${key.split('-')[0]}/${key.split('-')[1]}`
          }, (err, container) => {
            if (container) {

              if (typeof service.trigger.max_time !== 'undefined') {
                scheduler.schedule({ key: `${key.split('-')[0]}-${container.id}`,
                  expire: service.trigger.max_time, handler: removeContainer });
              }

              console.log(`#$#$# Job: ${key.split('-')[0]} - Service: ${key.split('-')[1]} #$#$#`);

              container.attach({ stream: true, stdout: true, stderr: true }, (err, stream) => {
                byline(stream).on('data', (line) => {
                  if (line.toString().trim() !== '') {
                    process.stdout.write(`#=># ${line}\n`);
                  }
                });
              });

              container.start((err, data) => {
                console.log(data);
                if (err) {
                  console.log('\nCannot create job container');
                }
              });
            }
          });

          if (typeof configObject.cb !== 'undefined' && typeof configObject.func !== 'undefined') {
            configObject.cb(configObject.func, key, service);
          }
        }
      });
  });
}

function removeContainer(err, key) {
  const containerid = key.split('-')[1];
  const container = docker.getContainer(containerid);
  container.stop((err) => {
    if (err) {
      console.log(err);
    } else {
      container.remove((err, data) => {
        if (err) {
          console.log(err);
        } else {
          console.log(`#$#$# Removed container: ${containerid.slice(0, 12)} #$#$#`);
        }
      });
    }
  });
}

function initLoopRunner(err, key) {
  const modifiedKey = `${key.split('-')[0]}-${key.split('-')[1]}`;
  db.get('SELECT rowid AS id, jobname, config FROM workers WHERE jobname = ?', key.split('-')[0],
    (err, row) => {
      if (row) {
        const doc = JSON.parse(row.config.replace(/'/g, '"'));
        if (typeof doc[key.split('-')[1]].trigger.repeat === 'undefined') {
          perform({ key: modifiedKey });
        } else {
          runLoop(loop, modifiedKey, doc[key.split('-')[1]]);
        }
      }
    });
}



export function runner(jobname) {
  db.serialize(() => {
    db.get('SELECT rowid AS id, jobname, config FROM workers WHERE jobname = ?', jobname,
      (err, row) => {
        if (row) {
          const doc = JSON.parse(row.config.replace(/'/g, '"'));
          for (const service of Object.keys(doc)) {
            if (service !== 'job' && service !== 'nodes') {

              mkdirp(`/tmp/jobfiles/${jobname}/${service}`, (err) => {
                if (err) {
                  console.log(`cannot create /tmp/jobfiles/${jobname}/${service}`);
                } else {

                  if (typeof doc[service].payload === 'object') {
                    for (const filename of Object.keys(doc[service].payload)) {
                      fs.writeFile(`/tmp/jobfiles/${jobname}/${service}/${filename}`,
                        doc[service].payload[filename], (err) => {
                          if (err) {
                            console.log('cannot write payload files to /tmp');
                          }
                        });
                    }
                  }

                  if (typeof doc[service].exec !== 'undefined') {
                    for (const execType of Object.keys(doc[service].exec)) {
                      if (execType !== 'bash') {
                        if (typeof doc[service].exec[execType] === 'object') {
                          for (const filename of Object.keys(doc[service].exec[execType])) {
                            fs.writeFile(`/tmp/jobfiles/${jobname}/${service}/${filename}`,
                              new Buffer(doc[service].exec[execType][filename], 'base64'), (err) => {
                                if (err) {
                                  console.log('cannot write exec files to /tmp');
                                }
                              });
                          }
                        }
                      }
                    }
                  }
                }
              });

              scheduler.schedule({ key: `${jobname}-${service}-starter`,
                expire: doc[service].trigger.start, handler: initLoopRunner });

            }
          }
        }
      });
  });
}

export function stopper(jobname, doc, cb) {
  for (const service of Object.keys(doc)) {
    if (service !== 'job' && service !== 'nodes') {
      const key = `${jobname}-${service}`;
      scheduler.cancel({ key }, (err) => {
        if (err) {
          console.log(err);
        } else {
          scheduler.cancel({ key: `${key}-starter` }, (err) => {
            if (err) {
              console.log(err);
            }
          });
        }
      });
    }
  }
  db.run('DELETE FROM workers WHERE jobname = ?', jobname,
    () => {
      cb();
    });
}
