#!/bin/bash
set -e

if hash rpm 2>/dev/null;
then
  sudo rpm -Uvh --force https://mirrors.xdv.io/divvy-repo-el7.rpm >/dev/null

  RIPPLE_REPO="nightly"
  yum --disablerepo=* --enablerepo=divvy-$RIPPLE_REPO clean expire-cache >/dev/null
  NIGHTLY="$(repoquery --enablerepo=divvy-$RIPPLE_REPO --releasever=el7 --qf="%{version}" divvyd | tr _ -)"
  RIPPLE_REPO="stable"
  yum --disablerepo=* --enablerepo=divvy-$RIPPLE_REPO clean expire-cache >/dev/null
  STABLE="$(repoquery --enablerepo=divvy-$RIPPLE_REPO --releasever=el7 --qf="%{version}" divvyd | tr _ -)"
  RIPPLE_REPO="unstable"
  yum --disablerepo=* --enablerepo=divvy-$RIPPLE_REPO clean expire-cache >/dev/null
  UNSTABLE="$(repoquery --enablerepo=divvy-$RIPPLE_REPO --releasever=el7 --qf="%{version}" divvyd | tr _ -)"

  echo "{\"stable\":\"$STABLE\",\"unstable\":\"$UNSTABLE\",\"nightly\":\"$NIGHTLY\"}"
  exit 0
else
  echo "yum not installed"
  exit 1
fi

