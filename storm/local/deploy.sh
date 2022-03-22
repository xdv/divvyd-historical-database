#!/bin/bash
cd $( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )

# Run topology locally
mvn compile exec:java -Dstorm.topology=divvy.importer.ImportTopology
