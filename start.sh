#!/bin/bash
# MSCC Send Launcher
cd "$(dirname "$0")"
open http://localhost:3456
node server.js
