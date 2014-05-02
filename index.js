
var fs = require('fs');
var emulator = require('./emulator');
var join = require('path').join;
var md5 = require('crypto').createHash('md5');
var debug = require('debug')('weplay-slack');
var express = require('express');
var bodyParser = require('body-parser');
var superagent = require('superagent');

if (!process.env.WEPLAY_ROM) {
  console.log('You must specify the ENV variable `WEPLAY_ROM` '
    + 'pointint to location of rom file to broadcast.');
  process.exit(1);
}

process.title = 'weplay-emulator';

// rom
var file = process.env.WEPLAY_ROM;
if ('/' != file[0]) file = join(process.cwd(), file);
debug('rom %s', file);
var sav = file.replace(/\.[a-z]+$/, '.sav');
var rom = fs.readFileSync(file);
var hash = md5.update(file).digest('hex');
debug('rom hash %s', hash);
var screens = process.env.WEPLAY_SCREENS_DIR;
if ('/' != screens[0]) screens = join(process.cwd(), screens);

// save interval
var saveInterval = process.env.WEPLAY_SAVE_INTERVAL || 60000;
debug('save interval %d', saveInterval);

// load emulator
var emu;

var screen;

function load(){
  debug('loading emulator');
  emu = emulator();

  emu.on('error', function(){
    console.log(new Date + ' - restarting emulator');
    emu.destroy();
    setTimeout(load, 1000);
  });

  emu.on('frame', function(frame){
    screen = frame;
  });

  fs.readFile(sav, { encoding: 'utf-8' }, function(err, state){
    if (!err && state) {
      debug('init from state');
      emu.initWithState(JSON.parse(state));
    } else {
      debug('init from rom');
      emu.initWithRom(rom);
    }
    emu.run();
    save();
  });

  function save(){
    debug('will save in %d', saveInterval);
    setTimeout(function(){
      var snap = JSON.stringify(emu.snapshot());
      if (snap) {
        debug('saving state');
        fs.writeFile(sav, snap, function() { 
          debug('state saved');
        });
        save();
      }
    }, saveInterval);
  }
}

//emu.move(move.toString());

load();

var app = express();

app.use(bodyParser());

app.get('/:time.png', function(req, res) {
  var time = parseInt(req.params.time, 10);
  res.set('Content-Type', 'image/png');
  res.sendfile(join(screens, time + '.png'));
});

var timeout;

var keys = {
  right: 0,
  left: 1,
  up: 2,
  down: 3,
  a: 4,
  b: 5,
  select: 6,
  start: 7
};

app.post('/input', function(req, res) {
  var command = (req.body.text || '').toLowerCase().trim();
  if (keys.hasOwnProperty(command)) {
    emu.move(keys[command]);
    if (typeof timeout == 'undefined') {
      timeout = setTimeout(display, 5000);
    }
  }
  res.send(200);
});

var agent = superagent.agent();

function display() {
  timeout = undefined;
  var time = new Date().valueOf();
  fs.writeFile(join(screens, time + '.png'), screen, function(err) {
    if (err) return;
    agent
      .post(process.env.WEPLAY_OUT_URL)
      .send(process.env.WEPLAY_HOST + '/' + time + '.png') // date is added to prevent caching by slack
      .end(function (err, res) {});
  });
}

app.listen(80);