# Growatt to Home Assistant

This implements a server in nodejs you can run on your local network to which you can point a growatt data logger dongle. It will then forward the logs to a home assistant instance via mqtt.

You can install it via `make install` on a linux machine based on systemd. And optionally configure it with a `/home/homeassistant/growatt-to-homeassistant.config.json` file. The config file can have the following keys (leave out keys for default values):

```
{
  "host": "MQTT_HOSTNAME",
  "port": "MQTT_PORT",
  "username": "MQTT_USERNAME",
  "password": "MQTT_PASSWORD",
  "growatt_port": "PORT_TO_LISTEN_ON",
}
```
