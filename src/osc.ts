import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import { MixingStationEndpoint } from './config'
import { TabletAclEvaluation } from './mixing-station'

export type OscArgType = 'i' | 'f' | 's'

export interface OscArgument {
	type: OscArgType
	value: number | string
}

export interface DecodedOscMessage {
	address: string
	args: OscArgument[]
}

/**
 * Pads a string with null bytes to a 4-byte boundary as required by the OSC 1.0 specification.
 */
export function encodeOscString(str: string): Buffer {
	const raw = Buffer.from(str, 'utf8')
	const totalLen = Math.ceil((raw.length + 1) / 4) * 4
	const buf = Buffer.alloc(totalLen, 0)
	raw.copy(buf, 0)
	return buf
}

/**
 * Reads a null-terminated, 4-byte aligned OSC string from a Buffer starting at `offset`.
 */
export function readOscString(buf: Buffer, offset: number): { value: string; nextOffset: number } {
	let end = offset
	while (end < buf.length && buf[end] !== 0) {
		end++
	}
	const value = buf.toString('utf8', offset, end)
	const nextOffset = Math.ceil((end + 1) / 4) * 4
	return { value, nextOffset }
}

/**
 * Encodes an OSC 1.0 binary packet from an address pattern and typed arguments.
 */
export function encodeOscMessage(address: string, args: OscArgument[] = []): Buffer {
	const addressBuf = encodeOscString(address)
	const typeTagStr = ',' + args.map((a) => a.type).join('')
	const typeTagBuf = encodeOscString(typeTagStr)

	const argBuffers: Buffer[] = [addressBuf, typeTagBuf]

	for (const arg of args) {
		if (arg.type === 'i') {
			const b = Buffer.alloc(4)
			b.writeInt32BE(Math.round(Number(arg.value) || 0), 0)
			argBuffers.push(b)
		} else if (arg.type === 'f') {
			const b = Buffer.alloc(4)
			b.writeFloatBE(Number(arg.value) || 0, 0)
			argBuffers.push(b)
		} else if (arg.type === 's') {
			argBuffers.push(encodeOscString(String(arg.value ?? '')))
		}
	}

	return Buffer.concat(argBuffers)
}

/**
 * Decodes a binary OSC 1.0 packet into its address pattern and typed arguments.
 */
export function decodeOscMessage(buf: Buffer): DecodedOscMessage | null {
	if (!buf || buf.length < 4 || buf[0] !== 0x2f) {
		// Must start with '/' (0x2f)
		return null
	}

	try {
		const addrResult = readOscString(buf, 0)
		const address = addrResult.value
		let offset = addrResult.nextOffset

		if (offset >= buf.length) {
			return { address, args: [] }
		}

		const typeTagResult = readOscString(buf, offset)
		const typeTags = typeTagResult.value
		offset = typeTagResult.nextOffset

		if (!typeTags.startsWith(',')) {
			return { address, args: [] }
		}

		const args: OscArgument[] = []
		for (let i = 1; i < typeTags.length; i++) {
			const tag = typeTags[i]
			if (tag === 'i') {
				if (offset + 4 > buf.length) break
				const val = buf.readInt32BE(offset)
				offset += 4
				args.push({ type: 'i', value: val })
			} else if (tag === 'f') {
				if (offset + 4 > buf.length) break
				const val = buf.readFloatBE(offset)
				offset += 4
				args.push({ type: 'f', value: Number(val.toFixed(4)) })
			} else if (tag === 's') {
				if (offset >= buf.length) break
				const strRes = readOscString(buf, offset)
				offset = strRes.nextOffset
				args.push({ type: 's', value: strRes.value })
			}
		}

		return { address, args }
	} catch {
		return null
	}
}

export interface ProxyBrokerOptions {
	s21Host: string
	s21Port: number
	proxyListenPort: number
	mixingStationClients: MixingStationEndpoint[]
	evaluateClientPacket?: (msg: DecodedOscMessage, rinfo: dgram.RemoteInfo) => TabletAclEvaluation
	onLog?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void
}

/**
 * Multi-client UDP OSC Network Broker (`DiGiCoOscProxyBroker`):
 * - Binds a single persistent UDP socket towards the DiGiCo S21 Console (Port 8000 default)
 *   to bypass the S-Series native single-controller limitation.
 * - Listens on a local proxy port (Port 8001 default) to intercept multiple Mixing Station tablets
 *   and Stream Deck controllers, evaluating each packet through the Mixing Station IEM Firewall &
 *   Panic-Lock Guard before piping permitted commands through the single console socket.
 * - Relays mirrored, restricted OSC states and live wireless battery telemetry out to all
 *   registered Mixing Station stage tablets.
 */
export class DiGiCoOscProxyBroker extends EventEmitter {
	private consoleSocket: dgram.Socket | null = null
	private proxySocket: dgram.Socket | null = null
	private options: ProxyBrokerOptions
	private dynamicClients: Map<string, MixingStationEndpoint> = new Map()
	private closed = false

	constructor(options: ProxyBrokerOptions) {
		super()
		this.options = options
		for (const client of options.mixingStationClients) {
			this.dynamicClients.set(`${client.host}:${client.port}`, client)
		}
	}

	public async start(): Promise<void> {
		this.closed = false

		// 1. Bind single persistent outbound/bidirectional UDP socket for the DiGiCo S21 Console
		this.consoleSocket = dgram.createSocket('udp4')
		this.consoleSocket.on('error', (err) => {
			this.log('warn', `S21 UDP Console Socket error: ${err.message}`)
		})

		this.consoleSocket.on('message', (msg, rinfo) => {
			const decoded = decodeOscMessage(msg)
			if (decoded) {
				this.emit('consoleMessage', decoded, rinfo)
			}
			// Mirror console feedback packets back to all connected Mixing Station tablets
			this.broadcastRawToTablets(msg)
		})

		await new Promise<void>((resolve) => {
			this.consoleSocket!.bind(0, () => {
				resolve()
			})
		})

		// 2. Bind Multi-Client Proxy Listener for intercepting Mixing Station & remote controllers
		if (this.options.proxyListenPort > 0) {
			this.proxySocket = dgram.createSocket('udp4')
			this.proxySocket.on('error', (err) => {
				this.log('warn', `Multi-Client OSC Proxy Socket error: ${err.message}`)
			})

			this.proxySocket.on('message', (msg, rinfo) => {
				// Register this remote tablet / controller dynamically for return relays
				const key = `${rinfo.address}:${rinfo.port}`
				const isFirstContact = !this.dynamicClients.has(key)
				if (isFirstContact) {
					this.dynamicClients.set(key, { host: rinfo.address, port: rinfo.port })
					this.log('info', `Registered remote Mixing Station / OSC client via proxy: ${key}`)
					this.emit('tabletConnected', { host: rinfo.address, port: rinfo.port })
				}

				const decoded = decodeOscMessage(msg)
				if (!decoded) return

				if (this.options.evaluateClientPacket) {
					const evalResult = this.options.evaluateClientPacket(decoded, rinfo)
					if (evalResult.reason === 'SYNC_REQUEST') {
						this.emit('tabletSyncRequested', { host: rinfo.address, port: rinfo.port })
						return
					}
					if (!evalResult.allowed) {
						this.log('warn', `[Mixing Station Firewall] ${evalResult.reason} (from ${key})`)
						this.emit('clientPacketBlocked', evalResult, rinfo)
						return
					}

					this.emit('clientProxyMessage', { address: evalResult.targetAddress, args: evalResult.targetArgs }, rinfo, evalResult)
					const outPacket = encodeOscMessage(evalResult.targetAddress, evalResult.targetArgs)
					if (this.consoleSocket && !this.closed) {
						this.consoleSocket.send(outPacket, this.options.s21Port, this.options.s21Host)
					}
					return
				}

				this.emit('clientProxyMessage', decoded, rinfo)
				if (this.consoleSocket && !this.closed) {
					this.consoleSocket.send(msg, this.options.s21Port, this.options.s21Host)
				}
			})

			await new Promise<void>((resolve) => {
				this.proxySocket!.once('error', () => resolve())
				this.proxySocket!.bind(this.options.proxyListenPort, () => {
					this.log(
						'info',
						`Multi-client S21 OSC Proxy listening on UDP :${this.options.proxyListenPort} -> S21 ${this.options.s21Host}:${this.options.s21Port}`
					)
					resolve()
				})
			})
		}
	}

	/**
	 * Sends an OSC command through the single persistent socket to the DiGiCo S21 Console,
	 * and optionally mirrors it to connected Mixing Station stage tablets.
	 */
	public sendToConsole(address: string, args: OscArgument[] = [], mirrorToTablets = true): void {
		if (!this.consoleSocket || this.closed) return
		const packet = encodeOscMessage(address, args)
		this.consoleSocket.send(packet, this.options.s21Port, this.options.s21Host, (err) => {
			if (err) {
				this.log('error', `Failed sending OSC ${address} to S21: ${err.message}`)
			}
		})
		this.emit('sentToConsole', { address, args })

		if (mirrorToTablets) {
			this.broadcastRawToTablets(packet)
		}
	}

	/**
	 * Relays restricted OSC state and battery telemetry directly to all connected Mixing Station tablets.
	 */
	public relayToMixingStationTablets(address: string, args: OscArgument[] = []): void {
		if (!this.consoleSocket || this.closed) return
		const packet = encodeOscMessage(address, args)
		this.broadcastRawToTablets(packet)
		this.emit('relayedToTablets', { address, args })
	}

	/**
	 * Sends a targeted OSC message to a single Mixing Station tablet endpoint (used for late-joining snapshot sync).
	 */
	public sendToTabletEndpoint(endpoint: { host: string; port: number }, address: string, args: OscArgument[] = []): void {
		const sender = this.proxySocket ?? this.consoleSocket
		if (!sender || this.closed) return
		const packet = encodeOscMessage(address, args)
		sender.send(packet, endpoint.port, endpoint.host)
	}

	private broadcastRawToTablets(packet: Buffer): void {
		const sender = this.proxySocket ?? this.consoleSocket
		if (!sender || this.closed) return
		for (const client of this.dynamicClients.values()) {
			sender.send(packet, client.port, client.host)
		}
	}

	public getRegisteredClients(): MixingStationEndpoint[] {
		return Array.from(this.dynamicClients.values())
	}

	public async stop(): Promise<void> {
		this.closed = true
		const closeSocket = (sock: dgram.Socket | null): Promise<void> =>
			new Promise((resolve) => {
				if (!sock) return resolve()
				try {
					sock.close(() => resolve())
				} catch {
					resolve()
				}
			})

		await Promise.all([closeSocket(this.proxySocket), closeSocket(this.consoleSocket)])
		this.proxySocket = null
		this.consoleSocket = null
	}

	private log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void {
		if (this.options.onLog) {
			this.options.onLog(level, msg)
		}
	}
}
