#!/bin/bash
ENV=${1:-development}
echo "Starting server in $ENV environment..."
export NODE_ENV=$ENV
node server.js
