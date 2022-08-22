dist/growatt.js: src/growatt.ts package.json tsconfig.json Makefile
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
