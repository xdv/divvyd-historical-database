var BigNumber  = require('bignumber.js');

// from divvy-lib-extensions

function adjustQualityForXDV(quality, pays, gets) {
  var numeratorShift = (pays === 'XDV' ? -6 : 0);
  var denominatorShift = (gets === 'XDV' ? -6 : 0);
  var shift = numeratorShift - denominatorShift;
  return shift === 0 ? (new BigNumber(quality)) :
    (new BigNumber(quality)).shift(shift);
}

function parseQuality(bookDirectory, pays, gets) {
  var qualityHex = bookDirectory.substring(bookDirectory.length - 16);
  var mantissa = new BigNumber(qualityHex.substring(2), 16);
  var offset = parseInt(qualityHex.substring(0, 2), 16) - 100;
  var quality = mantissa.toString() + 'e' + offset.toString();
  return adjustQualityForXDV(quality, pays, gets);
}

module.exports = parseQuality;
