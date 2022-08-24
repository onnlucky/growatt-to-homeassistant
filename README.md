# Growatt to Home Assistant

This implements a server in nodejs you can run on your local network to which you can point a growatt data logger dongle. It will then forward the logs to a home assistant instance.

You can install it via `make install` on a linux machine based on systemd. And configure it with a `/home/homeassistant/.homeassistant/growatt-to-homeassistant.json` file containing:
```
{
  "host": "HOSTNAME",
  "port": "PORT",
  "token": "TOKEN"
}
```
