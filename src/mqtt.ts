import { connect, MqttClient } from "mqtt"

let mqtt: MqttClient | undefined

export function mqtt_setup(config: any) {
    const mqttUrl = `mqtt://${config.host || "localhost"}${config.port ? ":" + config.port : ""}`
    console.log("trying to connect to mqtt:", mqttUrl)

    mqtt = connect(mqttUrl, {
        clientId: "growatt_" + Math.random().toString(16).slice(3),
        clean: true,
        username: config.username,
        password: config.password,
        will: {
            topic: "growatt/uptime",
            payload: "",
            qos: 1,
            retain: false,
        },
    })

    mqtt.on("error", (error) => {
        console.log("mqtt error:", error)
    })

    mqtt.on("connect", () => {
        console.log("connected")
        mqtt?.subscribe(["growatt/config"], () => {
            console.log("subscribed")
        })
    })

    mqtt.on("message", (topic, payload) => {
        console.log("mqtt:", topic, payload)
    })
}

export function mqtt_uptime() {
    if (!mqtt?.connected) return
    mqtt.publish("growatt/uptime", String(Math.floor(performance.now() / 1000)), { retain: true })
}

export function mqtt_report(device: string, keyValue: Record<string, any>) {
    if (!mqtt?.connected) return

    const path = `growatt/${device}/`
    for (const key in keyValue) {
        mqtt.publish(path + key, String(keyValue[key]), { retain: true })
    }
}

const SECONDS = 1000
const MINUTES = 60 * SECONDS

const discoveryWritten = new Map<string, number>()
export function mqtt_write_discovery(device: string, keyValue: Record<string, any>) {
    if (!mqtt?.connected) return

    const lastWrite = discoveryWritten.get(device)
    if (lastWrite && Date.now() - lastWrite > 30 * MINUTES) return

    discoveryWritten.set(device, Date.now())

    const path = `homeassistant/sensor/growatt_${device}`
    for (const key in keyValue) {
        mqtt.publish(
            `${path}/${key}/config`,
            JSON.stringify({
                ...keyValue[key],
                uniq_id: `growatt_${device}_${key}`,
                stat_t: `growatt/${device}/${key}`,
                object_id: `growatt_${device}_${key.toLowerCase()}`,
                dev: {
                    ids: [`growatt_${device}`],
                    name: `Growatt Inverter ${device}`,
                    mf: "Growatt",
                },
            })
        )
    }
}
