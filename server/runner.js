import request from 'superagent';

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('choreoworkers.sqlite3');
const Scheduler = require('redis-scheduler');
const scheduler = new Scheduler({ host: '0.0.0.0', port: 6004 });
const fs = require('fs');
const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const mkdirp = require('mkdirp');
const byline = require('byline');

let superIo = {};


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

          const Env = [];
          if (typeof service.environment === 'object') {
            for (const env of Object.keys(service.environment)) {
              Env.push(`${env}=${service.environment[env]}`);
            }
          }

          if (typeof service.prewebhook === 'object') {
            for (const hookURL of service.prewebhook) {
              const r = request
                .post(hookURL)
                .send({
                  job: key.split('-')[0],
                  service: key.split('-')[1],
                  type: 'prewebhook'
                })
                .set('Content-Type', 'application/json')
                .end((err, res) => {
                  if (err) {
                    superIo.emit('webhookerror', {
                      jobname: key.split('-')[0], service: key.split('-')[1], type: 'prewebhook', errurl: hookURL
                    });
                    console.log(`Error occured at prewebhook: ${hookURL}`);
                  }
                });
              setTimeout(() => {
                r.abort();
              }, 3000);
            }
          }

          let cpu_cores;
          let cpu_quota;
          let memory;
          if (typeof service.constraints !== 'undefined') {
            if (typeof service.constraints.cpu_cores !== 'undefined') {
              cpu_cores = service.constraints.cpu_cores;
              if (typeof cpu_cores === 'number') {
                cpu_cores = `${cpu_cores}`;
              }
            }

            if (typeof service.constraints.cpu_quota !== 'undefined') {
              cpu_quota = service.constraints.cpu_quota;
            }

            if (typeof service.constraints.memory !== 'undefined') {
              memory = service.constraints.memory;
            }
          }

          docker.createContainer({
            Image: 'tocttou/choreograph-child',
            Cmd: ['/bin/bash', 'runner.sh'],
            NetworkMode: 'host',
            Tty: true,
            Binds: ['/tmp:/tmp'],
            Env,
            CpusetCpus: cpu_cores, CpuQuota: cpu_quota, Memory: memory,
            WorkingDir: `/tmp/jobfiles/${key.split('-')[0]}/${key.split('-')[1]}`
          }, (err, container) => {
            if (container) {

              db.run('INSERT INTO containers (jobname, servicename, containerid) VALUES (?, ?, ?)', [
                key.split('-')[0],
                key.split('-')[1],
                container.id
              ],
                (err) => {
                  if (err) {
                    console.log(`Error in filling containers table. Erro => ${err}`);
                  }
                });

              if (typeof service.trigger.max_time !== 'undefined') {
                scheduler.schedule({ key: `${key.split('-')[0]}-${key.split('-')[1]}-${container.id}`,
                  expire: service.trigger.max_time, handler: removeContainer });
              }

              if (typeof service.webhook === 'object') {
                for (const hookURL of service.webhook) {
                  const r = request
                    .post(hookURL)
                    .send({
                      job: key.split('-')[0],
                      service: key.split('-')[1],
                      type: 'webhook'
                    })
                    .set('Content-Type', 'application/json')
                    .end((err, res) => {
                      if (err) {
                        superIo.emit('webhookerror', {
                          jobname: key.split('-')[0], service: key.split('-')[1], type: 'webhook', errurl: hookURL
                        });
                        console.log(`Error occured at webhook: ${hookURL}`);
                      }
                    });
                  setTimeout(() => {
                    r.abort();
                  }, 3000);
                }
              }

              console.log(`#$#$# Job: ${key.split('-')[0]} - Service: ${key.split('-')[1]} #$#$#`);

              container.attach({ stream: true, stdout: true, stderr: true }, (err, stream) => {
                byline(stream).on('data', (line) => {
                  if (line.toString().trim() !== '') {
                    process.stdout.write(`#=># ${line}\n`);
                    superIo.emit('inputStream', { jobname: key.split('-')[0], service: key.split('-')[1], stream: `${line}` });
                  }
                });
                byline(stream).on('error', (line) => {
                  if (line.toString().trim() !== '') {
                    process.stdout.write(`#=># ${line}\n`);
                    superIo.emit('inputStream', { jobname: key.split('-')[0], service: key.split('-')[1], stream: `${line}` });
                  }
                });
                stream.on('end', () => {
                  superIo.emit('containerexited', { jobname: key.split('-')[0],
                    service: key.split('-')[1], containerid: `${container.id}` });
                });
              });

              container.start((err, data) => {
                if (err) {
                  console.log('\nCannot create job container');
                } else {
                  superIo.emit('containeradded', { jobname: key.split('-')[0], service: key.split('-')[1], containerid: `${container.id}` });
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
  const jobname = key.split('-')[0];
  const servicename = key.split('-')[1];

  db.get('SELECT rowid AS id, jobname, config FROM workers WHERE jobname = ?', jobname,
    (err, row) => {
      if (row) {
        const doc = JSON.parse(row.config.replace(/'/g, '"'));
        const service = doc[servicename];

        if (typeof service.timeoutwebhook === 'object') {
          for (const hookURL of service.timeoutwebhook) {
            const r = request
              .post(hookURL)
              .send({
                job: key.split('-')[0],
                service: key.split('-')[1],
                type: 'timeoutwebhook'
              })
              .set('Content-Type', 'application/json')
              .end((err, res) => {
                if (err) {
                  superIo.emit('webhookerror', {
                    jobname: key.split('-')[0], service: key.split('-')[1], type: 'timeoutwebhook', errurl: hookURL
                  });
                  console.log(`Error occured at timeoutwebhook: ${hookURL}`);
                }
              });
            setTimeout(() => {
              r.abort();
            }, 3000);
          }
        }

        db.all('SELECT rowid AS id, jobname, servicename, containerid FROM containers WHERE jobname = ? AND servicename = ?',
          jobname, servicename, (err, rows) => {
            if (rows) {
              for (const row of rows) {
                const container = docker.getContainer(row.containerid);
                container.stop((err) => {
                  if (err) {
                  } else {
                    container.remove((err, data) => {
                      if (err) {
                      } else {
                        console.log(`#$#$# Removed container: ${row.containerid.slice(0, 12)} #$#$#`);
                        superIo.emit('containertimedout', { jobname, service: servicename, containerid: `${row.containerid}` });
                      }
                    });
                  }
                });
              }
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



export function runner(jobname, io) {
  superIo = io;
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
            } else {

              db.all('SELECT rowid AS id, jobname, servicename, containerid FROM containers WHERE jobname = ? AND servicename = ?',
                jobname, service, (err, rows) => {
                  if (rows) {
                    for (const row of rows) {
                      const container = docker.getContainer(row.containerid);
                      container.stop((err) => {
                        if (err) {
                          db.run('DELETE FROM containers WHERE jobname = ? AND servicename = ?',
                            [jobname, service],
                            () => {
                            });
                        } else {
                          container.remove((err, data) => {
                            console.log(`#$#$# Removed container: ${row.containerid.slice(0, 12)} #$#$#`);
                            db.run('DELETE FROM containers WHERE jobname = ? AND servicename = ?',
                              [jobname, service],
                              () => {
                              });
                          });
                        }
                      });
                    }
                  }
                });
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

export function removeContainerById(jobname, containerid) {
  const container = docker.getContainer(containerid);
  container.stop((err) => {
    if (err) {
    } else {
      container.remove();
    }
  });
  db.run('DELETE FROM containers WHERE jobname = ?', jobname);
}
