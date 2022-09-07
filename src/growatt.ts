import * as fs from "fs"
import * as path from "path"
import * as net from "net"
import Debug from "debug"
import { Parser } from "binary-parser"
import { mqtt_setup, mqtt_report, mqtt_write_discovery, mqtt_uptime } from "./mqtt"

/* A local server to capture Growatt inverter data via wifi.
 *
 * Setup the growatt inverter (requires a growatt inverter with a wifi dongle):
 * - First put wifi adaptor into AP mode:
 *   - Remove the rubber plug often labelled "key".
 *   - Short press the button underneath, the led should glow solid blue.
 * - Via a computer, find the wifi named after the serial number of the wifi adaptor.
 *   - The network password should be 12345678
 * - Point your browser to 192.168.10.100
 *   - The login is admin/admin, or admin/12345678
 * - Configure the server the wifi adaptor should log to.
 *   - Point it to the ip:port where this script will be running.
 *   - Configure wifi to join.
 *   - Optional: tweak other settings.
 * - After clicking apply, the wifi adaptor will ask to restart, doing so will have it start
 *   connecting to this script and sending data.
 *
 * Installing growatt-to-homeassistant:
 * - run `make install`
 * - optionally: create a /home/homeassistant/growatt-to-homeassistant.config.json fill in the mqtt
 *   "host", "username", and "password".
 * */

const SECONDS = 1000
const MINUTES = 60 * SECONDS

export const log = {
    trace: Debug("growatt:trace"),
    debug: Debug("growatt:debug"),
    error: Debug("growatt:error"),
}

let lastValueReceived = Date.now()
let lastValueReceivedPerDevice = new Map<string, number>()

function trackDevice(device: string) {
    lastValueReceived = Date.now()
    lastValueReceivedPerDevice.set(device, lastValueReceived)
}

let config: any = {}

try {
    const file = path.join(process.env.HOME || "/home/homeassistant", "growatt-to-homeassistant.config.json")
    config = JSON.parse(fs.readFileSync(file, { encoding: "utf8" }))
} catch (e) {
    console.warn("failed to read config:", e.message)
}

mqtt_setup(config)

setInterval(() => {
    // Reset values after 10 minutes of no activity.
    for (const [device, lastTime] of lastValueReceivedPerDevice.entries()) {
        if (Date.now() - lastTime > 10 * MINUTES) {
            mqtt_report(device, { kWhToday: 0, Ppv: 0 })
            lastValueReceivedPerDevice.delete(device)
        }
    }

    // Exit the server after an hour of no activity. Should get restarted by init system.
    if (Date.now() - lastValueReceived > 60 * MINUTES) {
        console.log("exiting due to zero activity")
        process.exit(0)
    }

    mqtt_uptime()
}, 5000)

function divideBy10(data: number): number {
    return data / 10
}

function divideBy100(data: number) {
    return data / 100
}

function modbus_crc(data: Buffer): number {
    let crc = 0xffff
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i]
        for (let b = 0; b < 8; b++) {
            if ((crc & 0x0001) != 0) {
                crc >>= 1
                crc ^= 0xa001
            } else {
                crc >>= 1
            }
        }
    }
    return crc
}

function xor(data: Buffer, key: string | Buffer) {
    const result = Buffer.allocUnsafe(data.length)
    if (typeof key === "string") {
        key = Buffer.from(key)
    }
    const keylength = key.length
    let k = 0
    for (let i = 0; i < data.length; i++) {
        result[i] = data[i] ^ key[k]
        if (++k >= keylength) {
            k = 0
        }
    }
    return result
}

const MessageTypes = {
    ANNOUNCE: 0x0103,
    ANNOUNCE50: 0x5003,
    ANNOUNCE51: 0x5103,

    DATA: 0x0104,
    DATA50: 0x5004,
    DATA51: 0x5104,

    PING: 0x0116,
    CONFIG: 0x0118,
    CONFIG51: 0x5118,
    QUERY: 0x0119,
    QUERY51: 0x5119,

    REBOOT: 0x0120,
    CONFACK50: 0x5029,
    CONFACK: 0x5129,
}

const MessageParser = new Parser()
    .uint16("counter")
    .uint16("protocolVersion")
    .uint16("size")
    .uint16("type")
    .buffer("data", {
        length: function (this: Parser & { size: number }) {
            return this.size - 2
        },
    })
    .uint16("crc")

const PingPayloadParser = new Parser().string("wifiSerial", { length: 10 })

const AnnouncePayloadParser = new Parser()
    .string("wifiSerial", { length: 10 })
    .string("inverterSerial", { length: 10 })
    .skip(58)
    .string("ident2", { length: 10 })
    .skip(62)
    .string("make", { length: 20 })
    .string("type", { length: 8 })

function statusFromPayload(status: number): string {
    if (status === 0) return "waiting"
    if (status === 1) return "normal"
    if (status === 2) return "fault"
    return "unknown"
}

const DataPayloadParser = new Parser()
    .string("wifiSerial", { length: 10 })
    .string("inverterSerial", { length: 10 })
    .buffer("unknown", { length: 51 })
    .uint16("status") // 0=waiting, 1=normal, 2=fault
    .uint32("Ppv", {
        formatter: divideBy10,
    })
    .uint16("Vpv1", {
        formatter: divideBy10,
    })
    .uint16("Ipv1", {
        formatter: divideBy10,
    })
    .uint32("Ppv1", {
        formatter: divideBy10,
    })
    .uint16("Vpv2", {
        formatter: divideBy10,
    })
    .uint16("Ipv2", {
        formatter: divideBy10,
    })
    .uint32("Ppv2", {
        formatter: divideBy10,
    })
    .uint32("Pac", {
        formatter: divideBy10,
    })
    .uint16("Fac", {
        formatter: divideBy100,
    })
    .uint16("Vac1", {
        formatter: divideBy10,
    })
    .uint16("Iac1", {
        formatter: divideBy10,
    })
    .uint32("Pac1", {
        formatter: divideBy10,
    })
    .uint16("Vac2", {
        formatter: divideBy10,
    })
    .uint16("Iac2", {
        formatter: divideBy10,
    })
    .uint32("Pac2", {
        formatter: divideBy10,
    })
    .uint16("Vac3", {
        formatter: divideBy10,
    })
    .uint16("Iac3", {
        formatter: divideBy10,
    })
    .uint32("Pac3", {
        formatter: divideBy10,
    })
    .uint32("kWhToday", {
        formatter: divideBy10,
    })
    .uint32("kWhTotal", {
        formatter: divideBy10,
    })
    .uint32("htotal", {
        formatter: function (value: number) {
            // amount of half seconds, converted to hours
            return value / (2 * 60 * 60)
        },
    })
    .uint16("temp", {
        formatter: divideBy10,
    })
    .uint16("isoFaultValue", {
        formatter: divideBy10,
    })
    .uint16("gfciFaultValue", {
        formatter: divideBy10,
    })
    .uint16("dciFaultValue", {
        formatter: divideBy10,
    })
    .uint16("vpvFaultValue", {
        formatter: divideBy10,
    })
    .uint16("vacFaultValue", {
        formatter: divideBy10,
    })
    .uint16("facFaultValue", {
        formatter: divideBy100,
    })
    .uint16("tempFaultValue", {
        formatter: divideBy10,
    })
    .uint16("faultCode")
    .uint16("ipmtemp", {
        formatter: divideBy10,
    })
    .uint16("pbusvolt", {
        formatter: divideBy10,
    })
    .uint16("nbusvolt", {
        formatter: divideBy10,
    })
    .string("checkstep", {
        encoding: "hex",
        length: 2,
    })
    .uint16("ipf")
    .string("resetchk", {
        encoding: "hex",
        length: 2,
    })
    .string("deratingmode", {
        encoding: "hex",
        length: 6,
    })
    .uint32("Epv1Today", {
        formatter: divideBy10,
    })
    .uint32("Epv1Total", {
        formatter: divideBy10,
    })
    .uint32("Epv2Today", {
        formatter: divideBy10,
    })
    .uint32("Epv2Total", {
        formatter: divideBy10,
    })
    .uint32("EpvTotal", {
        formatter: divideBy10,
    })
    .uint32("Rac", {
        formatter: divideBy10,
    })
    .uint32("ERacToday", {
        formatter: divideBy10,
    })
    .uint32("ERacTotal", {
        formatter: divideBy10,
    })
    .string("warningcode", {
        encoding: "hex",
        length: 2,
    })
    .string("warningvalue", {
        encoding: "hex",
        length: 2,
    })

function create(counter: number, protocolVersion: number, type: number, data: Buffer): Buffer {
    const size = data.length + 2
    data = xor(data, "Growatt")

    const buffer = Buffer.allocUnsafe(8 + size)
    buffer.writeUInt16BE(counter, 0)
    buffer.writeUInt16BE(protocolVersion, 2)
    buffer.writeUInt16BE(size, 4)
    buffer.writeUInt16BE(type, 6)
    data.copy(buffer, 8)

    const crc = modbus_crc(buffer.slice(0, -2))
    buffer.writeUInt16BE(crc, buffer.length - 2)
    return buffer
}

export function parseGrowattMessage(data: Buffer): {
    counter: number
    type: number
    protocolVersion: number
    data: Buffer
    decoded: any
} {
    const message: any = MessageParser.parse(data)
    for (const [key, value] of Object.entries(MessageTypes)) {
        if (value === message.type) {
            message.decodedType = key
        }
    }
    message.totalSize = data.length

    const crc = modbus_crc(data.slice(0, -2))
    message.crcOk = crc === message.crc

    const payload = xor(message.data, "Growatt")
    if (message.type === MessageTypes.PING) {
        message.decoded = PingPayloadParser.parse(payload)
    } else if (message.type === MessageTypes.ANNOUNCE && payload.length > 10) {
        message.decoded = AnnouncePayloadParser.parse(payload)
    } else if (message.type === MessageTypes.DATA) {
        message.decoded = DataPayloadParser.parse(payload)
    } else if (message.type === MessageTypes.DATA50) {
        message.decoded = DataPayloadParser.parse(payload)
    } else if (message.type === MessageTypes.DATA51) {
        message.decoded = DataPayloadParser.parse(payload)
    }
    return message
}

export function startGrowattServer(port = 5279) {
    net.createServer((socket) => {
        console.log("have client ...", socket.remoteAddress)

        socket.on("close", (hadError) => {
            log.debug("client closed:", hadError ? "hadError" : "ok")
        })

        socket.on("data", (data) => {
            const msg = parseGrowattMessage(data)
            log.trace("msg:", msg)

            if (msg.type === MessageTypes.PING) {
                log.trace("sending ping")
                socket.write(data)
            } else if (msg.type === MessageTypes.ANNOUNCE) {
                log.trace("sending announce ack")
                const reply = create(msg.counter, msg.protocolVersion, msg.type, Buffer.from([0x0]))
                socket.write(reply)
            } else {
                // this is a normal data packet, send ACK 04 packet back
                log.trace("sending generic ack")
                socket.write(Buffer.from("000100020003010400", "hex"))
            }

            const device = msg.decoded?.wifiSerial
            if (msg.type === MessageTypes.DATA) {
                if (typeof device !== "string") throw Error("data message without a device: '" + device + "'")
                trackDevice(device)

                const { Ppv, kWhToday, kWhTotal, temp } = msg.decoded
                const status = statusFromPayload(msg.decoded.status)

                console.log("msg:", status, "ppv", Ppv, "today", kWhToday, "total", kWhTotal, "temp", temp)
                try {
                mqtt_report(device, { status, kWhToday, kWhTotal, Ppv, temperature: temp })
                mqtt_write_discovery(device, {
                    status: {
                        entity_category: "diagnostic",
                        name: "Inverter Status",
                    },
                    kWhToday: {
                        unit_of_measurement: "kWh",
                        state_class: "total_increasing",
                        device_class: "energy",
                        name: "Solar Energy Produced Today",
                    },
                    kWhTotal: {
                        unit_of_measurement: "kWh",
                        state_class: "total_increasing",
                        device_class: "energy",
                        name: "Total Solar Energy Produced",
                    },
                    Ppv: {
                        unit_of_measurement: "W",
                        state_class: "measurement",
                        device_class: "power",
                        name: "Solar Power Output",
                    },
                    temperature: {
                        unit_of_measurement: "C",
                        state_class: "measurement",
                        name: "Solar Inverter Internal Temperature",
                    },
                })
                } catch (e) {
                console.warn(e)
                }
            }
        })
    }).listen(port)
    console.log("started growatt server, port:", port)
}

process.on("uncaughtException", (err) => {
    log.error("uncaughtException:", err)
})

startGrowattServer()
