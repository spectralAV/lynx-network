import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import WebSocket from 'ws'
import { WirelessProtocolType } from './config'

export interface WirelessChannelTelemetry {
	/** Receiver channel index (1-based) */
	rxId: number
	/** Transmitter / channel name reported by the receiver */
	txName?: string
	/** Transmitter battery charge percentage (0 - 100) */
	batteryPercent: number
	/** Capsule or transmitter overload / clipping indicator */
	clip: boolean
	/** RF signal strength in dBm (e.g. -48) */
	rfRssi?: number
	/** Sound Devices NexLink / ShowLink OTA control link quality percentage (0 - 100) */
	nexLinkQuality?: number
	/** OTA Transmitter Gain in dB controlled via NexLink (Dial 1) */
	txGainDb?: number
	/** Instantaneous audio peak level in dBFS */
	audioDbfs?: number
}

export interface WirelessDriverOptions {
	host: string
	port: number
	reconnectIntervalMs?: number
	onLog?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void
}

/**
 * Abstract base driver for Wireless Receiver Telemetry & OTA Control.
 * Scales cleanly across:
 *  - Sound Devices Astral (A20-Nexus / ARX32) via WebSocket JSON
 *  - Shure Axient Digital (AD4D / AD4Q) via Telnet TCP (Port 2202)
 *  - Sennheiser Digital 6000 (EM 6000) via Sennheiser Sound Control (SSC) UDP
 */
export abstract class WirelessTelemetryDriver extends EventEmitter {
	protected options: WirelessDriverOptions

	constructor(options: WirelessDriverOptions) {
		super()
		this.options = options
	}

	public abstract start(): void
	public abstract stop(): Promise<void>
	public abstract isConnected(): boolean

	/**
	 * Sends an Over-The-Air (OTA) transmitter gain command (e.g. Sound Devices NexLink Dial 1).
	 */
	public abstract setOtaTransmitGain(rxId: number, gainDb: number): void

	protected log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void {
		if (this.options.onLog) {
			this.options.onLog(level, msg)
		}
	}
}

/**
 * 1. Sound Devices Astral (A20-Nexus / ARX32) Persistent WebSocket Telemetry Driver.
 */
export class AstralWebSocketDriver extends WirelessTelemetryDriver {
	private ws: WebSocket | null = null
	private reconnectTimer: NodeJS.Timeout | null = null
	private stopped = false
	private connected = false

	public start(): void {
		this.stopped = false
		this.connect()
	}

	private connect(): void {
		if (this.stopped) return
		this.clearReconnectTimer()

		const url = `ws://${this.options.host}:${this.options.port}`
		this.log('info', `Connecting to Sound Devices Astral WebSocket stream at ${url}...`)

		try {
			const ws = new WebSocket(url)
			this.ws = ws

			ws.on('open', () => {
				if (this.stopped) {
					ws.close()
					return
				}
				this.connected = true
				this.log('info', `Connected to Sound Devices Astral (A20-Nexus/ARX32) at ${url}`)
				this.emit('connected')

				try {
					ws.send(
						JSON.stringify({
							command: 'subscribe',
							device: 'A20-Nexus/ARX32',
							streams: ['telemetry', 'battery', 'nexlink', 'audio_peaks'],
						})
					)
				} catch {
					// Ignore if server doesn't require handshake
				}
			})

			ws.on('message', (data: WebSocket.RawData) => {
				this.handleIncomingPayload(data.toString('utf8'))
			})

			ws.on('close', () => {
				const wasConnected = this.connected
				this.connected = false
				this.ws = null
				if (wasConnected) {
					this.emit('disconnected')
				}
				if (!this.stopped) {
					this.scheduleReconnect()
				}
			})

			ws.on('error', (err) => {
				this.log('debug', `Astral WebSocket socket event: ${err.message}`)
			})
		} catch (err) {
			this.log('warn', `Failed initializing Astral WebSocket: ${(err as Error).message}`)
			this.scheduleReconnect()
		}
	}

	/**
	 * Parses incoming Sound Devices Astral JSON payloads and normalizes them into
	 * `WirelessChannelTelemetry` records.
	 */
	public handleIncomingPayload(rawText: string): WirelessChannelTelemetry[] {
		let parsed: unknown
		try {
			parsed = JSON.parse(rawText)
		} catch {
			this.log('debug', `Ignored non-JSON Astral frame: ${rawText.slice(0, 80)}`)
			return []
		}

		const frames = this.extractTelemetryRecords(parsed)
		for (const telemetry of frames) {
			this.emit('telemetry', telemetry)
		}
		return frames
	}

	private extractTelemetryRecords(payload: unknown): WirelessChannelTelemetry[] {
		if (!payload || typeof payload !== 'object') return []

		const results: WirelessChannelTelemetry[] = []
		const obj = payload as Record<string, unknown>

		if (Array.isArray(payload)) {
			for (const item of payload) {
				results.push(...this.extractTelemetryRecords(item))
			}
			return results
		}

		if (Array.isArray(obj.channels)) {
			for (const ch of obj.channels) {
				const norm = this.normalizeSingleChannel(ch)
				if (norm) results.push(norm)
			}
			return results
		}

		if (obj.telemetry && typeof obj.telemetry === 'object') {
			return this.extractTelemetryRecords(obj.telemetry)
		}

		const single = this.normalizeSingleChannel(obj)
		if (single) {
			results.push(single)
		}

		return results
	}

	private normalizeSingleChannel(raw: unknown): WirelessChannelTelemetry | null {
		if (!raw || typeof raw !== 'object') return null
		const item = raw as Record<string, unknown>

		const rxId = Number(item.rxId ?? item.channel ?? item.id ?? item.rx_channel)
		if (!Number.isFinite(rxId) || rxId < 1) return null

		const rawBattery = Number(item.battery ?? item.batteryPercent ?? item.batt ?? item.battery_level ?? 100)
		const batteryPercent = Math.max(0, Math.min(100, Math.round(Number.isFinite(rawBattery) ? rawBattery : 100)))

		const clip = Boolean(
			item.clip === true ||
				item.clip === 1 ||
				item.clipping === true ||
				item.overload === true ||
				(typeof item.audioDbfs === 'number' && item.audioDbfs >= -0.5)
		)

		const txName = typeof item.name === 'string' ? item.name : typeof item.txName === 'string' ? item.txName : undefined
		const rfRssi = item.rfRssi !== undefined ? Number(item.rfRssi) : item.rssi !== undefined ? Number(item.rssi) : undefined
		const nexLinkQuality =
			item.nexLinkQuality !== undefined
				? Number(item.nexLinkQuality)
				: item.nexlink !== undefined
					? Number(item.nexlink)
					: undefined
		const txGainDb =
			item.txGainDb !== undefined ? Number(item.txGainDb) : item.gain !== undefined ? Number(item.gain) : undefined
		const audioDbfs =
			item.audioDbfs !== undefined ? Number(item.audioDbfs) : item.audio_level !== undefined ? Number(item.audio_level) : undefined

		return {
			rxId,
			txName,
			batteryPercent,
			clip,
			rfRssi: Number.isFinite(rfRssi) ? rfRssi : undefined,
			nexLinkQuality: Number.isFinite(nexLinkQuality) ? nexLinkQuality : undefined,
			txGainDb: Number.isFinite(txGainDb) ? txGainDb : undefined,
			audioDbfs: Number.isFinite(audioDbfs) ? audioDbfs : undefined,
		}
	}

	public setOtaTransmitGain(rxId: number, gainDb: number): void {
		if (this.ws && this.connected && this.ws.readyState === WebSocket.OPEN) {
			const payload = JSON.stringify({
				command: 'set_nexlink_tx_gain',
				rxId,
				txGainDb: gainDb,
			})
			this.ws.send(payload)
		}
	}

	public isConnected(): boolean {
		return this.connected
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) return
		const delay = this.options.reconnectIntervalMs ?? 2500
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			this.connect()
		}, delay)
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
	}

	public async stop(): Promise<void> {
		this.stopped = true
		this.clearReconnectTimer()
		this.connected = false
		if (this.ws) {
			const sock = this.ws
			this.ws = null
			await new Promise<void>((resolve) => {
				try {
					sock.once('close', () => resolve())
					sock.close()
					setTimeout(resolve, 200)
				} catch {
					resolve()
				}
			})
		}
	}
}

/**
 * 2. Shure Axient Digital (AD4D / AD4Q) Telnet TCP Driver (Port 2202 default).
 * Parses Shure ASCII control strings such as:
 *   `< REP 1 BATT_CHARGE 084 >`
 *   `< REP 1 BATT_BARS 004 >`
 *   `< REP 1 AUDIO_OVERLOAD ON >`
 *   `< REP 1 SHOWLINK_STATUS 005 >`
 */
export class ShureAxientTelnetDriver extends WirelessTelemetryDriver {
	private socket: net.Socket | null = null
	private reconnectTimer: NodeJS.Timeout | null = null
	private connected = false
	private stopped = false
	private channelCache: Map<number, WirelessChannelTelemetry> = new Map()

	public start(): void {
		this.stopped = false
		this.connect()
	}

	private connect(): void {
		if (this.stopped) return
		const socket = new net.Socket()
		this.socket = socket

		socket.on('connect', () => {
			this.connected = true
			this.log('info', `Connected to Shure Axient Digital TCP at ${this.options.host}:${this.options.port}`)
			this.emit('connected')
			socket.write('< GET 0 ALL >\r\n')
		})

		socket.on('data', (chunk) => {
			this.parseShureStream(chunk.toString('utf8'))
		})

		socket.on('close', () => {
			this.connected = false
			if (!this.stopped) {
				this.reconnectTimer = setTimeout(() => this.connect(), this.options.reconnectIntervalMs ?? 3000)
			}
		})

		socket.on('error', (err) => {
			this.log('debug', `Shure Axient TCP socket event: ${err.message}`)
		})

		socket.connect(this.options.port, this.options.host)
	}

	public parseShureStream(text: string): WirelessChannelTelemetry[] {
		const emitted: WirelessChannelTelemetry[] = []
		const regex = /<\s*REP\s+(\d+)\s+([A-Z0-9_]+)\s+([^>]+?)\s*>/g
		let match: RegExpExecArray | null
		while ((match = regex.exec(text)) !== null) {
			const rxId = Number(match[1])
			const param = match[2]
			const rawVal = match[3].trim()
			if (!Number.isFinite(rxId) || rxId < 1) continue

			const state = this.channelCache.get(rxId) ?? {
				rxId,
				batteryPercent: 100,
				clip: false,
				nexLinkQuality: 100,
			}

			if (param === 'BATT_CHARGE') {
				const pct = Number(rawVal)
				if (Number.isFinite(pct) && pct <= 100) {
					state.batteryPercent = Math.max(0, Math.min(100, pct))
				}
			} else if (param === 'BATT_BARS') {
				const bars = Number(rawVal)
				if (Number.isFinite(bars) && bars <= 5) {
					state.batteryPercent = Math.max(0, Math.min(100, bars * 20))
				}
			} else if (param === 'AUDIO_OVERLOAD' || param === 'AUDIO_PEAK_OL') {
				state.clip = rawVal === 'ON' || rawVal === '1' || rawVal === 'TRUE'
			} else if (param === 'SHOWLINK_STATUS') {
				const sl = Number(rawVal)
				if (Number.isFinite(sl) && sl <= 5) {
					state.nexLinkQuality = Math.min(100, sl * 20)
				}
			} else if (param === 'CHAN_NAME') {
				state.txName = rawVal.replace(/^\{|\}$/g, '').trim()
			} else if (param === 'TX_OFFSET') {
				const offset = Number(rawVal)
				if (Number.isFinite(offset)) {
					state.txGainDb = offset - 12
				}
			}

			this.channelCache.set(rxId, state)
			const snapshot = { ...state }
			this.emit('telemetry', snapshot)
			emitted.push(snapshot)
		}
		return emitted
	}

	public setOtaTransmitGain(rxId: number, gainDb: number): void {
		if (this.socket && this.connected) {
			const shureOffset = Math.max(0, Math.round(gainDb + 12))
			this.socket.write(`< SET ${rxId} TX_OFFSET ${shureOffset} >\r\n`)
		}
	}

	public isConnected(): boolean {
		return this.connected
	}

	public async stop(): Promise<void> {
		this.stopped = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		this.connected = false
		if (this.socket) {
			this.socket.destroy()
			this.socket = null
		}
	}
}

/**
 * 3. Sennheiser Digital 6000 (EM 6000) Sennheiser Sound Control (SSC) UDP Driver.
 * Parses SSC JSON frames such as:
 *   `{"rx1":{"bat":{"gauge":82},"audio":{"overload":false},"name":"VOX1"}}`
 */
export class SennheiserD6000UdpDriver extends WirelessTelemetryDriver {
	private socket: dgram.Socket | null = null
	private connected = false

	public start(): void {
		this.socket = dgram.createSocket('udp4')
		this.socket.on('message', (msg) => {
			this.parseSscFrame(msg.toString('utf8'))
		})
		this.socket.on('error', (err) => {
			this.log('debug', `Sennheiser D6000 UDP error: ${err.message}`)
		})
		this.socket.bind(0, () => {
			this.connected = true
			this.emit('connected')
		})
	}

	public parseSscFrame(rawJson: string): WirelessChannelTelemetry[] {
		const emitted: WirelessChannelTelemetry[] = []
		try {
			const parsed = JSON.parse(rawJson) as Record<string, unknown>
			for (const [key, val] of Object.entries(parsed)) {
				const rxMatch = key.match(/^rx(\d+)$/i)
				if (!rxMatch || !val || typeof val !== 'object') continue
				const rxId = Number(rxMatch[1])
				const rxObj = val as Record<string, unknown>

				const batObj = (rxObj.bat ?? {}) as Record<string, unknown>
				const audioObj = (rxObj.audio ?? {}) as Record<string, unknown>
				const rfObj = (rxObj.rf ?? {}) as Record<string, unknown>

				const batteryPercent = Math.max(0, Math.min(100, Math.round(Number(batObj.gauge ?? 100))))
				const clip = Boolean(audioObj.overload === true || audioObj.clip === true)
				const rfRssi = rfObj.rssi !== undefined ? Number(rfObj.rssi) : undefined
				const txName = typeof rxObj.name === 'string' ? rxObj.name : undefined

				const telemetry: WirelessChannelTelemetry = {
					rxId,
					txName,
					batteryPercent,
					clip,
					rfRssi: Number.isFinite(rfRssi) ? rfRssi : undefined,
					nexLinkQuality: 100,
				}
				this.emit('telemetry', telemetry)
				emitted.push(telemetry)
			}
		} catch {
			// Ignore malformed SSC frames
		}
		return emitted
	}

	public setOtaTransmitGain(rxId: number, gainDb: number): void {
		if (this.socket && this.connected) {
			const frame = JSON.stringify({ [`rx${rxId}`]: { audio: { gain: gainDb } } })
			this.socket.send(Buffer.from(frame, 'utf8'), this.options.port, this.options.host)
		}
	}

	public isConnected(): boolean {
		return this.connected
	}

	public async stop(): Promise<void> {
		this.connected = false
		if (this.socket) {
			const sock = this.socket
			this.socket = null
			await new Promise<void>((resolve) => sock.close(() => resolve()))
		}
	}
}

export function createWirelessDriver(
	protocol: WirelessProtocolType,
	options: WirelessDriverOptions
): WirelessTelemetryDriver {
	switch (protocol) {
		case 'shure_axient_tcp':
			return new ShureAxientTelnetDriver(options)
		case 'sennheiser_d6000_udp':
			return new SennheiserD6000UdpDriver(options)
		case 'astral_ws':
		default:
			return new AstralWebSocketDriver(options)
	}
}
