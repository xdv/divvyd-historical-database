#!/bin/bash
cd $( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )

TOPOLOGY="divvy-ledger-importer"

if [ $# -eq 0 ]; then
  echo "argument (start, stop, or restart) required"
fi

if [ "$1" = "restart" ] || [ "$1" = "stop" ]; then
  echo "stopping topology: '$TOPOLOGY'..."
  storm kill "divvy-ledger-importer" -w 0
fi

if [ "$1" = "restart" ] || [ "$1" = "start" ]; then
  echo "compiling package..."
  rm -r target
  mvn clean compile
  mvn package

  echo "starting topology: '$TOPOLOGY'..."
  storm jar target/importer-0.0.1-jar-with-dependencies.jar divvy.importer.ImportTopology "divvy-ledger-importer"

  echo "'$TOPOLOGY' started"
fi
