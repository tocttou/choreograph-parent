import express from 'express';
import path from 'path';
import compression from 'compression';
import bodyParser from 'body-parser';
import { runner, stopper } from './runner';


/* eslint-disable no-console */

const appConfig = require('../config/config');
const port = appConfig.CLIENT_PORT || 8080;
const clientIP = appConfig.CLIENT_IP || '0.0.0.0';
const app = express();

const http = require('http').Server(app);
const io = require('socket.io')(http);
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const mkdirp = require('mkdirp');
let db;

app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));
app.use(bodyParser.json({ limit: '500mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(compression());
app.use(express.static('dist'));

// db functions

function createDb() {
  db = new sqlite3.Database('choreoworkers.sqlite3', createTable);
}

createDb();


function createTable() {
  db.run('CREATE TABLE IF NOT EXISTS workers (jobname TEXT, config TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS containers (jobname TEXT, servicename TEXT, containerid TEXT)');
}

// api

app.post('/api/saveworker', (req, res) => {
  try {
    if (Object.keys(req.body).length) {
      db.serialize(() => {
        db.get('SELECT rowid AS id, jobname, config FROM workers WHERE jobname = ?', req.body.job,
          (err, row) => {
            if (row) {
              res.json({
                err: true,
                message: `Job: ${req.body.job} already exists`
              });
            } else {
              db.run('INSERT INTO workers (jobname, config) VALUES (?, ?)', [
                req.body.job,
                JSON.stringify(req.body).replace(/"/g, '\'')
              ], (err) => {

                mkdirp('jobfiles', (err) => {
                  if (err) {
                    res.json({
                      err: true,
                      message: `Cannot create folder for job files. Error: ${err}`
                    });
                    return null;
                  } else {
                    const doc = req.body;
                    for (let service of Object.keys(doc)) {
                      if (service !== 'job' && service !== 'nodes') {
                        mkdirp(`jobfiles/${doc.job}/${service}`, (err) => {

                          if (err) {
                            res.json({
                              err: true,
                              message: `Cannot create folder for job files. Error: ${err}`
                            });
                            return null;
                          } else {

                            if (typeof doc[service].payload === 'object') {
                              for (const filename of Object.keys(doc[service].payload)) {
                                fs.writeFile(`jobfiles/${doc.job}/${service}/${filename}`,
                                  doc[service].payload[filename], (err) => {
                                    if (err) {
                                      res.json({
                                        err: true,
                                        message: `Cannot create folder for job files. Error: ${err}`
                                      });
                                      return null;
                                    }
                                  });
                              }
                            }
                          }

                          if (typeof doc[service].exec !== 'undefined') {
                            for (const execType of Object.keys(doc[service].exec)) {
                              if (execType !== 'bash') {
                                if (typeof doc[service].exec[execType] === 'object') {
                                  for (const filename of Object.keys(doc[service].exec[execType])) {
                                    fs.writeFile(`jobfiles/${doc.job}/${service}/${filename}`,
                                      doc[service].exec[execType][filename], (err) => {
                                        if (err) {
                                          res.json({
                                            err: true,
                                            message: `Cannot create folder for job files. Error: ${err}`
                                          });
                                          return null;
                                        }
                                      });
                                  }
                                }
                              }
                            }
                          }

                        });
                      }
                    }
                  }
                });

                runner(req.body.job, io);

                res.json({
                  err: false,
                  message: `Job: ${req.body.job} created`
                });
              });
            }
          });
      });
    } else {
      res.json({
        err: true,
        message: 'Empty config received'
      });
    }
  } catch (err) {
    res.json({
      err: true,
      message: 'Malformed request received'
    });
  }
});

app.get('/api/getworkers', (req, res) => {
  db.all('SELECT rowid AS id, jobname, config FROM workers',
    (err, rows) => {
      const toSend = {};
      if (rows) {
        for (const row of rows) {
          toSend[row.jobname] = Object.keys(JSON.parse(row.config.replace(/'/g, '"')))
            .filter((value) => !!(value !== 'nodes' && value !== 'job'));
        }
        res.json(toSend);
      } else {
        res.json({
          err: true,
          message: 'No workers found'
        });
      }
    });
});

app.post('/api/removeworker', (req, res) => {
  db.get('SELECT rowid AS id, jobname, config FROM workers WHERE jobname = ?', req.body.job,
    (err, row) => {
      if (row) {
        const doc = JSON.parse(row.config.replace(/'/g, '"'));
        stopper(req.body.job, doc, (err) => {
          if (err) {
            res.json({
              err: true,
              message: `Cannot cancel schedule, Error => ${err}`
            });
          } else {
            res.json({
              err: false,
              message: `Removed job: ${req.body.job}`
            });
          }
        });
      } else {
        res.json({
          err: true,
          message: 'No workers found'
        });
      }
    });
});

app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../src/index.html'));
});

io.on('connection', (socket) => {

  socket.on('hello', () => {
    socket.emit('world');
  });

});

http.listen(port, (err) => {
  if (err) {
    console.log(err);
  } else {
    console.log(`visit http://${clientIP}:${port}`);
  }
});
