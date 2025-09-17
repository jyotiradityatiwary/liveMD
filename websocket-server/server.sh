#! /usr/bin/sh

export HOST='localhost'
export PORT=1234
export YPERSISTENCE='./data'

pnpm exec y-websocket
