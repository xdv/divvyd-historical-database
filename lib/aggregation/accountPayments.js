var Promise = require('bluebird');
var moment = require('moment');
var Logger = require('../logger');
var smoment = require('../smoment');
var hbase = require('../hbase')
var utils = require('../utils');
var config = require('../../config');

/**
 * accountPaymentsAggregation
 */

function AccountPaymentsAggregation() {
  var self = this;

  var logOpts = {
    scope: 'account payments aggregation',
    file: config.get('logFile'),
    level: config.get('logLevel')
  };

  this.log     = new Logger(logOpts);
  this.ready   = true;
  this.pending = [ ];
  this.data    = { }

  self.aggregate();

  //remove older data every hour
  this.purge = setInterval(function(){

    self.ready = false;

    var day = moment.utc().startOf('day').subtract(12,  'hours');

    //remove cached days
    for (date in self.data) {
      if (day.diff(date) > 0) {
        delete self.data[date];
      }
    }

    self.ready = true;

  }, 60 * 60 * 1000);
}

/**
 * aggregate
 * aggregate incoming payments
 */

AccountPaymentsAggregation.prototype.aggregate = function () {
  var self       = this;
  var updated    = { };
  var bucketList = { };
  var incoming;

  if (!self.pending.length) {
    setTimeout(aggregate, 200);
    return;
  }

  if (!self.ready) {
    setTimeout(aggregate, 200);
    return;
  }

  incoming     = self.pending;
  self.pending = [ ];
  self.ready   = false;

  incoming.forEach(function(payment) {
    var date = smoment(payment.data.time);
    date.moment.startOf('day');

    if (!self.data[date.format()]) {
      self.data[date.format()] = { };
    }

    if (!self.data[date.format()][payment.data.source]) {
      bucketList[date.format() + '|' + payment.data.source] = {
        date: date,
        account: payment.data.source
      };
    }

    if (!self.data[date.format()][payment.data.destination]) {
      bucketList[date.format() + '|' + payment.data.destination] = {
        date: date,
        account: payment.data.destination
      };
    }
  });

  //get any from hbase that arent
  //already present
  Promise.map(Object.keys(bucketList), function(key) {
    return hbase.getAggregateAccountPayments(bucketList[key])
    .then(function(resp) {
      var date    = bucketList[key].date.format();
      var account = bucketList[key].account;
      self.data[date][account] = resp.rows[0];
    });
  })
  .then(check)     //check buckets for existing payments
  .then(normalize) //normalize delivered amount to XDV
  .then(adjust)    //adjust buckets
  .then(update)    //save to hbase
  .nodeify(function(err, resp) {

    if (err) {
      self.log.error(err);

    } else {
      self.log.debug('updated account payments', Object.keys(updated));
    }

    //ready for the next set
    self.ready = true;
    setImmediate(aggregate);
  });

  return;

  /**
   * aggregate
   * function to call from timeout
   */

  function aggregate () {
    self.aggregate();
  }

  function check() {
    var i = incoming.length;
    var payment;
    var bucket;
    var date;

    while (i--) {
      payment = incoming[i];
      date = smoment(payment.data.time);
      date.moment.startOf('day');

      // sender perspective
      if (payment.account === payment.data.source) {
        bucket = self.data[date.format()][payment.account];

      // reciever perspective
      } else {
        bucket = self.data[date.format()][payment.data.destination];
      }

      bucket.payments.every(function(p) {
        if (p.tx_hash === payment.data.tx_hash) {
          incoming.splice(i, 1);
          return false;
        }

        return true;
      });
    }

    return Promise.resolve();
  }

  /**
   * normalize
   * normalize the delivered amount
   * to XDV if possible
   */

  function normalize () {
    return Promise.map(incoming, function(payment) {
      return new Promise (function(resolve, reject) {

        var counter = { };
        var options = { };
        var change;

        if (payment.data.currency === 'XDV') {
          payment.normalized = Number(payment.data.delivered_amount);
          resolve();
          return;
        }

        counter.currency = payment.data.currency;
        counter.issuer = payment.data.issuer;

        //this should not happen
        if (!counter.issuer) {
          payment.normalized = 0;
          resolve();
          return;
        }

        var options = {
          date: smoment(payment.data.time),
          base: {currency:'XDV'},
          counter: counter
        };

        hbase.getExchangeRate(options)
        .nodeify(function(err, rate) {
          if (err) {
            reject(err);
          } else {
            payment.normalized = rate ? Number(payment.data.delivered_amount) / rate : 0;
            resolve();
          }
        });
      });
    });
  }

  /**
   * adjust
   * adjust all buckets
   * with the incoming payments
   */

  function adjust () {
    return new Promise(function(resolve, reject) {
      incoming.forEach(function(payment) {
        var bucket;
        var date = smoment(payment.data.time);
        date.moment.startOf('day');

        updated[date.format() + '|' + payment.account] = true;


        // sender perspective
        if (payment.account === payment.data.source) {
          bucket = self.data[date.format()][payment.account];

          bucket.payments.push({
            tx_hash: payment.data.tx_hash,
            amount: payment.data.delivered_amount,
            currency: payment.data.currency,
            issuer: payment.data.issuer,
            type: 'sent'
          });

          bucket.payments_sent++;
          bucket.total_value_sent += payment.normalized;
          bucket.total_value      += payment.normalized;

          if (bucket.receiving_counterparties.indexOf(payment.data.destination) === -1) {
            bucket.receiving_counterparties.push(payment.data.destination);
          }

          if (payment.normalized > bucket.high_value_sent) {
            bucket.high_value_sent = payment.normalized;
          }

        // reciever perspective
        } else {
          bucket = self.data[date.format()][payment.data.destination];

          bucket.payments.push({
            tx_hash: payment.data.tx_hash,
            amount: Number(payment.data.delivered_amount),
            currency: payment.data.currency,
            issuer: payment.data.issuer,
            type: 'received'
          });

          bucket.payments_received++;
          bucket.total_value_received += payment.normalized;
          bucket.total_value          += payment.normalized;

          if (bucket.sending_counterparties.indexOf(payment.data.source) === -1) {
            bucket.sending_counterparties.push(payment.data.source);
          }

          if (payment.normalized > bucket.high_value_received) {
            bucket.high_value_received = payment.normalized;
          }
        }
      });

      resolve(true);
    });
  }

  /**
   * update
   * save updated buckets
   */

  function update () {
    var rows = { };
    var parts;
    var date;
    var rowkey;

    //key has the structure ISO_DATE | Account
    for (var key in updated) {
      parts  = key.split('|');
      date   = smoment(parts[0]);
      rowkey = date.hbaseFormatStartRow() + '|' + parts[1];
      rows[rowkey] = self.data[date.format()][parts[1]];
    }

    return hbase.putRows({
      table: 'agg_account_payments',
      rows: rows
    });
  }
}

//add a payment to the queue
AccountPaymentsAggregation.prototype.add = function (payment) {
  this.pending.push(payment);
};

module.exports = AccountPaymentsAggregation;
