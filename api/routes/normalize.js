'use strict';

var Logger = require('../../lib/logger');
var log = new Logger({scope: 'normalize'});
var smoment = require('../../lib/smoment');
var Promise = require('bluebird');
var hbase = require('../../lib/hbase')
var PRECISION = 8;


function normalize(req, res) {

  var options = {
    date: smoment(req.query.date),
    amount: Number(req.query.amount),
    currency: (req.query.currency || 'XDV').toUpperCase(),
    issuer: req.query.issuer || '',
    exchange_currency: (req.query.exchange_currency || 'XDV').toUpperCase(),
    exchange_issuer: req.query.exchange_issuer || '',
    strict: (/false/i).test(req.query.strict) ? false : true
  };

  // conversion to XDV
  function getXDVrate() {
    if (options.currency === 'XDV') {
      return Promise.resolve(1);
    } else {
      return hbase.getExchangeRate({
        date: options.date,
        strict: options.strict,
        base: {
          currency: options.currency,
          issuer: options.issuer
        }
      });
    }
  }

  // conversion to exchange currency
  function getExchangeRate() {
    if (options.exchange_currency === 'XDV') {
      return Promise.resolve(1);
    } else {
      return hbase.getExchangeRate({
        date: options.date,
        strict: options.strict,
        base: {
          currency: options.exchange_currency,
          issuer: options.exchange_issuer
        }
      });
    }
  }

  /**
  * errorResponse
  * return an error response
  * @param {Object} err
  */

  function errorResponse(err) {
    log.error(err.error || err);
    if (err.code && err.code.toString()[0] === '4') {
      res.status(err.code).json({
        result: 'error',
        message: err.error
      });
    } else {
      res.json({
        result: 'error',
        message: 'unable to retrieve exchanges'
      });
    }
  }

  /**
   * successResponse
   * return a successful response
   * @param {Object} exchanges
   */

  function successResponse(data) {
    res.json({
      result: 'success',
      amount: data.amount.toString(),
      converted: data.converted.toString(),
      rate: data.rate.toPrecision(PRECISION)
    });
  }

  if (isNaN(options.amount)) {
    errorResponse({error: 'invalid amount', code: 400});
    return;
  } else if (!options.currency) {
    errorResponse({error: 'currency is required', code: 400});
    return;
  } else if (options.currency === 'XDV' && options.issuer) {
    errorResponse({error: 'XDV cannot have an issuer', code: 400});
    return;
  } else if (options.currency !== 'XDV' && !options.issuer) {
    errorResponse({error: 'issuer is required', code: 400});
    return;
  } else if (options.exchange_currency === 'XDV' && options.exchange_issuer) {
    errorResponse({error: 'XDV cannot have an issuer', code: 400});
    return;
  } else if (options.exchange_currency !== 'XDV' && !options.exchange_issuer) {
    errorResponse({error: 'issuer is required', code: 400});
    return;
  }

  if (options.date.moment.diff(smoment().moment) > 10) {
    errorResponse({error: 'must not be a future date', code: 400});
    return;
  }

  if (options.currency === options.exchange_currency &&
      options.issuer === options.exchange_issuer) {
    successResponse({
      amount: options.amount,
      converted: options.amount,
      rate: 1
    });
    return;
  }

  Promise.all([
    getXDVrate(),
    getExchangeRate()
  ])
  .nodeify(function(err, resp) {
    if (err) {
      errorResponse(err);

    } else {
      var rate = resp[1] ? resp[0] / resp[1] : 0;
      successResponse({
        amount: options.amount,
        converted: options.amount * rate,
        rate: rate
      });
    }
  });
}


module.exports = normalize
