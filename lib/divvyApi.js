var config = require('../config')
var divvy = require('divvy-lib')
var divvyAPI = new divvy.DivvyAPI(config.get('divvy'))

divvyAPI.connect()
.then(function() {
  console.log('divvy API connected.')
})
.catch(function(e) {
  console.log(e)
})

divvyAPI.on('error', function(errorCode, errorMessage, data) {
  console.log(errorCode, errorMessage, data)
})

module.exports = divvyAPI
