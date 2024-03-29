'use strict'

var Logger = require('../../../lib/logger')
var log = new Logger({scope: 'metrics'})
var smoment = require('../../../lib/smoment')
var utils = require('../../../lib/utils')
var hbase = require('../../../lib/hbase')
var PRECISION = 8

var livePeriodsTrade = [
  'hour',
  'day',
  '3day',
  '7day',
  '30day'
]

var livePeriods = [
  'hour',
  'day'
]

function getMetric(metric, req, res) {
  var exchange = {
    currency: (req.query.exchange_currency || 'XDV').toUpperCase(),
    issuer: req.query.exchange_issuer
  }

  var options = {
    metric: metric,
    live: req.query.live,
    start: req.query.start ? smoment(req.query.start) : null,
    end: req.query.end ? smoment(req.query.end) : null,
    marker: req.query.marker,
    limit: Number(req.query.limit || 200),
    format: (req.query.format || 'json').toLowerCase()
  }

 /**
  * errorResponse
  * return an error response
  * @param {Object} err
  */

  function errorResponse(err) {
    log.error(err.error || err)
    if (err.code && err.code.toString()[0] === '4') {
      res.status(err.code).json({
        result: 'error',
        message: err.error
      })
    } else {
      res.status(500).json({
        result: 'error',
        message: 'error getting data'
      })
    }
  }

 /**
  * successResponse
  * return a successful response
  * @param {Object} resp
  */

  function successResponse(resp) {

    if (resp.marker) {
      utils.addLinkHeader(req, res, resp.marker)
    }

    // csv
    if (options.format === 'csv') {
      resp.rows.forEach(function(r, i) {
        resp.rows[i] = utils.flattenJSON(r)
      })
      res.csv(resp.rows, metric + '.csv')

    // json
    } else {
      res.json({
        result: 'success',
        count: resp.rows.length,
        marker: resp.marker,
        rows: resp.rows
      })
    }
  }

  function formatRows(rows) {
    rows.forEach(function(row) {
      var rate = row.exchangeRate || row.exchange_rate
      if (row.exchangeRate === undefined &&
          row.exchange_rate === undefined) {
        rate = 1
      } else if (row.exchangeRate !== undefined) {
        rate = row.exchangeRate
      } else {
        rate = row.exchange_rate
      }

      row.total = row.total.toString()

      row.exchange_rate = rate.toPrecision(PRECISION)
      delete row.exchangeRate

      if (row.time) {
        row.date = smoment(row.time).format()
        delete row.time
      }

      if (row.startTime) {
        row.start_time = smoment(row.startTime).format()
        delete row.startTime
      }

      if (row.endTime) {
        row.end_time = smoment(row.endTime).format()
        delete row.endTime
      }

      row.components.forEach(function(c) {
        c.rate = c.rate ? Number(c.rate).toPrecision(PRECISION) : '0'
        c.amount = c.amount ? c.amount.toString() : '0'
        if (c.convertedAmount) {
          c.converted_amount = c.convertedAmount.toString()
        } else if (c.converted_amount) {
          c.converted_amount = c.converted_amount.toString()
        }

        delete c.convertedAmount
      })
    })
  }

  if (isNaN(options.limit)) {
    options.limit = 200

  } else if (options.limit > 1000) {
    options.limit = 1000
  }

  if (exchange.currency !== 'XDV' && !exchange.issuer) {
    errorResponse({
      error: 'exchange currency must have an issuer',
      code: 400
    })
    return

  } else if (exchange.currency === 'XDV' && exchange.issuer) {
    errorResponse({
      error: 'XDV cannot have an issuer',
      code: 400
    })
    return

  } else if (exchange.currency !== 'XDV') {
    options.exchange = exchange
  }


  if (options.live &&
      options.metric === 'trade_volume' &&
      livePeriodsTrade.indexOf(options.live) === -1) {

    errorResponse({
      error: 'invalid period - use: ' + livePeriodsTrade.join(', '),
      code: 400
    })
    return

  } else if (options.live &&
             options.metric === 'payment_volume' &&
             livePeriods.indexOf(options.live) === -1) {

    errorResponse({
      error: 'invalid period - use: ' + livePeriods.join(', '),
      code: 400
    })
    return

  // rolling 24 hr
  } else if (!options.live) {
    options.live = 'day'
  }

  hbase.getMetric(options, function(err, resp) {
    if (err) {
      errorResponse(err)
    } else {

      formatRows(resp.rows)
      successResponse(resp)
    }
  })
}

module.exports = getMetric
