'use strict';

const config = require('../../config/import.config');
const request = require('request-promise');
const WebSocket = require('ws');
const Logger = require('../logger');
const log = new Logger({scope : 'validations etl'});
const colors = require('colors');
const PEER_PORT_REGEX = /51235/g;
const WS_PORT = '51233';
const manifests = require('./manifests')(config.get('hbase'));
const validations = require('./validations')(config.get('hbase'),
  config.get('validator-config'));
const CronJob = require('cron').CronJob;

const connections = {};

/**
 * requestSubscribe
 */

function requestSubscribe(ws, altnet) {
  if (altnet) {
    ws.send(JSON.stringify({
      id: 222,
      command: 'server_info'
    }));
  }

  ws.send(JSON.stringify({
    id: 1,
    command: 'subscribe',
    streams: [
      'validations'
    ]
  }));

  ws.send(JSON.stringify({
    id: 2,
    command: 'subscribe',
    streams: [
      'manifests'
    ]
  }));
}

/**
 * subscribe
 */

function subscribe(divvyd) {

  const ip = (divvyd.altnet ? 'wss://' : 'ws://') +
    divvyd.ipp.replace(PEER_PORT_REGEX, WS_PORT);

  // resubscribe to open connections
  if (connections[ip] &&
    connections[ip].readyState === WebSocket.OPEN) {
    try {
      requestSubscribe(connections[ip], divvyd.altnet);
      return;

    } catch (e) {
      log.error(e.toString().red, ip.cyan);
      delete connections[ip];
    }

  } else if (connections[ip]) {
    connections[ip].close();
    delete connections[ip];
  }


  const ws = new WebSocket(ip);

  connections[ip] = ws;

  ws.public_key = divvyd.public_key;

  // handle error
  ws.on('close', function() {
    log.info(this.url.cyan, 'closed'.yellow);
    if (this.url && connections[this.url]) {
      delete connections[this.url];
    }
  });

  // handle error
  ws.on('error', function(e) {
    if (this.url && connections[this.url]) {
      this.close();
      delete connections[this.url];
    }
  });

  // subscribe and save new connections
  ws.on('open', function() {
    if (this.url && connections[this.url]) {
      requestSubscribe(this, divvyd.altnet);
    }
  });

  // handle messages
  ws.on('message', function(message) {
    const data = JSON.parse(message);

    if (data.type === 'validationReceived') {
      data.reporter_public_key = connections[this.url].public_key;

      // Store master key if validation is signed
      // by a known valid ephemeral key
      const master_public_key = manifests.getMasterKey(
        data.validation_public_key);
      if (master_public_key) {
        data.ephemeral_public_key = data.validation_public_key
        data.validation_public_key = master_public_key
      }

      validations.handleValidation(data)
      .catch(e => {
        log.error(e);
      });

    } else if (data.type === 'manifestReceived') {
      manifests.handleManifest(data);

    } else if (data.error === 'unknownStream') {
      delete connections[this.url];
      log.error(data.error, this.url.cyan);

    } else if (data.id === 222) {
      connections[this.url].public_key = data.result.info.pubkey_node;
    }
  });
}

/**
 * getDivvyds
 */

function getDivvyds() {
  var url = config.get('divvyds_url');

  if (!url) {
    return Promise.reject('requires divvyds url');
  }

  return request.get({
    url: url,
    json: true
  }).then(d => {
    return d.nodes;
  });
}

/**
 * subscribeToDivvyds
 */

function subscribeToDivvyds(divvyds) {
  const nDivvyd = divvyds.length.toString();
  const nConnections = Object.keys(connections).length.toString();

  log.info(('divvyds: ' + nDivvyd).yellow);
  log.info(('connections: ' + nConnections).yellow);

  // Subscribe to validation websocket subscriptions from divvyds
  divvyds.forEach(divvyd => {
    if (divvyd.ip && divvyd.port) {
      subscribe({
        ipp: divvyd.ip + ':' + divvyd.port,
        public_key: divvyd.node_public_key
      });
    }
  });

  subscribe({
    ipp: 's.altnet.divvytest.net:51235',
    public_key: 'altnet',
    altnet: true
  });

  return connections;
}

/**
 * start
 */

function refreshSubscriptions() {
  getDivvyds()
  .then(subscribeToDivvyds)
  .catch(e => {
    log.error(e.toString().red);
  });
}

manifests.start().then(() => {

  // refresh connections
  // every minute
  setInterval(refreshSubscriptions, 60 * 1000);
  refreshSubscriptions();
  validations.start();
});
