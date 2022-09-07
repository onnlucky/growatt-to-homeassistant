dist/growatt.js dist/mqtt.js: src/growatt.ts src/mqtt.ts package.json tsconfig.json Makefile
	yarn
	rm -rf dist/*
	tsc

dev:
	yarn dev

install: dist/growatt.js
	sudo -u homeassistant mkdir -p /srv/homeassistant/growatt-to-homeassistant
	sudo -u homeassistant cp dist/* /srv/homeassistant/growatt-to-homeassistant/
	sudo -u homeassistant cp -r node_modules /srv/homeassistant/growatt-to-homeassistant/

	sudo systemctl stop growatt-to-homeassistant || true
	sudo cp growatt-to-homeassistant.service /etc/systemd/system
	sudo systemctl daemon-reload
	sudo systemctl start growatt-to-homeassistant
	sudo systemctl enable growatt-to-homeassistant
	sleep 1
	systemctl status growatt-to-homeassistant

tail:
	journalctl -n 100 -f -u growatt-to-homeassistant.service
