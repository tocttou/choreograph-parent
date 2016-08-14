const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('choreoworkers.sqlite3');
const Scheduler = require('redis-scheduler');
console.log(process.env.NODE_ENV);
const scheduler = new Scheduler({ host: '0.0.0.0', port: 6004 });

const runLoop = (task, key) => {
  scheduler.schedule({ key, expire: 5000, handler: task }, (err) => {
    if (err) {
      console.error(err);
    } else {
      console.log('scheduled succesfully!');
    }
  });
};

const loop = (err, key) => {
  console.log('run callback for keyword: ', key);

  scheduler.cancel({ key }, (err) => {
    if (err) {
      return false;
    }
    runLoop(loop, key);
  });

  // TODO: Here should be your code
};


export function runner(jobname) {
  db.serialize(() => {
    db.get('SELECT rowid AS id, jobname, config FROM workers WHERE jobname = ?', jobname,
      (err, row) => {
        if (row) {
          const doc = JSON.parse(row.config.replace(/'/g, '"'));
          runLoop(loop, 'loop');
        }
      });
  });
}
