# jobbot CLI

Controls a Jobbot server (`../server`) over HTTP. Needs Node 20+, nothing to install: `npm link` here, or `node bin/jobbot.js …`.

    jobbot start            start the bot (starts the background server first if it is not running)
    jobbot status           bot state, step progress, first job and shift (with links), KYC links, settings, recent log
    jobbot watch            live: every status change and log line
    jobbot logs [-f]        server log
    jobbot pause | resume | restart | stop
    jobbot shot [file]      screenshot of the bot's tab
    jobbot kyc              saved KYC links
    jobbot config --site com --once --phone … --pin … --sms-url …
    jobbot session import state.json
    jobbot login [--headed] log in once (headless) and save the session

    jobbot up [--headed] [--port 8787] [--host 127.0.0.1]    start the server in the background (pid/log in ~/.config/jobbot/)
    jobbot down                                               stop it
    jobbot ps                                                 server up/down, pid, and what the bot is doing
    jobbot serve                                              run the server in the foreground

Server URL: built in as `http://127.0.0.1:8787`; change it per command with `--url` or globally with `JOBBOT_URL`. There is no token: reach a server on
another machine through an SSH tunnel (`ssh -L 8787:127.0.0.1:8787 host`).
