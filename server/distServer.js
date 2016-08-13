import express from 'express';
import path from 'path';
import compression from 'compression';
import bodyParser from 'body-parser';


/* eslint-disable no-console */

const appConfig = require('../config/config');
const port = appConfig.CLIENT_PORT || 8080;
const clientIP = appConfig.CLIENT_IP || '0.0.0.0';
const app = express();

const fs = require('fs');
const http = require('http').Server(app);
let io = require('socket.io')(http);

app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));
app.use(bodyParser.json({ limit: '500mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(compression());
app.use(express.static('dist'));

app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../dist/index.html'));
});

io.on('connection', (socket) => {

  socket.on('hello', () => {
    socket.send('world', { message: 'i iz best' });
  });

});

http.listen(port, (err) => {
  if (err) {
    console.log(err);
  } else {
    console.log(`visit http://${clientIP}:${port}`);
  }
});
