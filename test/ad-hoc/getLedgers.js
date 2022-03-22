var Importer = require('../lib/divvy-importer');
var fs       = require('fs');
var options  = {
  "logLevel" : 3,
  "divvy"   : {
    "trace"                 : false,
    "allow_partial_history" : false,
    "servers" : [
      { "host" : "s-west.xdv.io", "port" : 443, "secure" : true },
      { "host" : "s-east.xdv.io", "port" : 443, "secure" : true }
    ]
  }
};

var live  = new Importer(options);
var count = 20;
var path  = __dirname + '/ledgers/';
if (!fs.existsSync(path))fs.mkdirSync(path);

live.liveStream();
live.on('ledger', function (ledger) {

  return;
  //save ledger for tests
  var json     = JSON.stringify(ledger, null, 2);
  var filename = ledger.ledger_index + '.json';
  fs.writeFileSync(path + filename, json);

  if (!count--) process.exit();
});
