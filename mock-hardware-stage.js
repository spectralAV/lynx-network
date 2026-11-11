#!/usr/bin/env node
/**
 * ============================================================================
 * ALPHA STATE STAGE SIMULATOR (mock-hardware-stage.js)
 * Project: Lynx Network (lynx-network)
 *
 * Emulates physical stage hardware for Alpha-phase verification:
 *  1. Sound Devices Astral (A20-Nexus / ARX32) WebSocket Server (Default :8080)
 *     - Broadcasts live multi-channel JSON telemetry frames with variable
 *       battery drain, NexLink quality, RF RSSI, and capsule clipping bursts.
 *     - Receives OTA Transmit Gain commands (Rotary Dial 1 via NexLink).
 *  2. DiGiCo S21 Mixing Console UDP OSC Server (Default :8000)
 *     - Decodes binary OSC 1.0 packets from the Orchestrator's single-socket proxy.
 *     - Logs incoming S21 mute, scribble-strip rename, color index (2=Green,
 *       5=Amber, 6=Red), input trim, aux IEM send, and matrix commands in
 *       clean, color-coded terminal strings.
 *  3. Mixing Station Stage Tablet UDP OSC Listener (Default :9000)
 *     - Logs relayed restricted OSC states and live wireless battery telemetry.
 * ============================================================================
 */

const dgram = require('node:dgram')
const { WebSocketServer } = require('ws')

const ANSI = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
	magenta: '\x1b[35m',
	blue: '\x1b[34m',
	bgRed: '\x1b[41m\x1b[37m',
	bgGreen: '\x1b[42m\x1b[30m',
	bgYellow: '\x1b[43m\x1b[30m',
}

const S21_COLOR_NAMES = {
	2: `${ANSI.bgGreen} 2: GREEN (OPERATIONAL) ${ANSI.reset}`,
	5: `${ANSI.bgYellow} 5: AMBER (LOW BATTERY <20%) ${ANSI.reset}`,
	6: `${ANSI.bgRed} 6: RED (CLIP / CRITICAL ALERT) ${ANSI.reset}`,
}

/**
 * Minimal RFC-compliant OSC 1.0 Binary Decoder for the Stage Simulator
 */
function readOscString(buf, offset) {
	let end = offset
	while (end < buf.length && buf[end] !== 0) {
		end++
	}
	const value = buf.toString('utf8', offset, end)
	const nextOffset = Math.ceil((end + 1) / 4) * 4
	return { value, nextOffset }
}

function decodeOscPacket(buf) {
	if (!buf || buf.length < 4 || buf[0] !== 0x2f) return null
	try {
		const addr = readOscString(buf, 0)
		let offset = addr.nextOffset
		if (offset >= buf.length) return { address: addr.value, args: [] }

		const tags = readOscString(buf, offset)
		offset = tags.nextOffset
		if (!tags.value.startsWith(',')) return { address: addr.value, args: [] }

		const args = []
		for (let i = 1; i < tags.value.length; i++) {
			const t = tags.value[i]
			if (t === 'i') {
				if (offset + 4 > buf.length) break
				args.push({ type: 'i', value: buf.readInt32BE(offset) })
				offset += 4
			} else if (t === 'f') {
				if (offset + 4 > buf.length) break
				args.push({ type: 'f', value: Number(buf.readFloatBE(offset).toFixed(2)) })
				offset += 4
			} else if (t === 's') {
				if (offset >= buf.length) break
				const s = readOscString(buf, offset)
				args.push({ type: 's', value: s.value })
				offset = s.nextOffset
			}
		}
		return { address: addr.value, args }
	} catch {
		return null
	}
}

/**
 * Formats incoming DiGiCo S21 OSC messages into clean, human-readable terminal verification logs.
 */
function formatS21OscLog(decoded) {
	const { address, args } = decoded
	const val = args.length > 0 ? args[0].value : undefined

	// 1. Channel Scribble-Strip Rename: /Input_Channels/{id}/Channel_Input/name
	const nameMatch = address.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/)
	if (nameMatch) {
		const ch = nameMatch[1].padStart(2, ' ')
		return `${ANSI.cyan}[S21 OSC :8000]${ANSI.reset} 🏷️  ${ANSI.bold}RENAME${ANSI.reset}  Ch ${ch} -> ${ANSI.bold}"${val}"${ANSI.reset}  (${address})`
	}

	// 2. Channel Strip Color Index: /Input_Channels/{id}/Channel_Input/color
	const colorMatch = address.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/color$/)
	if (colorMatch) {
		const ch = colorMatch[1].padStart(2, ' ')
		const badge = S21_COLOR_NAMES[val] || `COLOR_ID=${val}`
		return `${ANSI.cyan}[S21 OSC :8000]${ANSI.reset} 🎨 ${ANSI.bold}COLOR${ANSI.reset}   Ch ${ch} -> ${badge}  (${address})`
	}

	// 3. Input Channel Mute (Talkback Ch 48 or Panic Target Ch X): /Input_Channels/{id}/Channel_Input/mute
	const muteMatch = address.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/mute$/)
	if (muteMatch) {
		const ch = Number(muteMatch[1])
		const isMuted = val === 1
		const role = ch === 48 ? 'FOH TALKBACK (Mode A)' : `PERFORMER MIC CH ${ch} (Mode B)`
		const stateBadge = isMuted
			? `${ANSI.bgRed} MUTE = 1 (MUTED IN PA) ${ANSI.reset}`
			: `${ANSI.bgGreen} MUTE = 0 (LIVE / OPEN) ${ANSI.reset}`
		return `${ANSI.cyan}[S21 OSC :8000]${ANSI.reset} 🔇 ${ANSI.bold}CH MUTE${ANSI.reset} Ch ${String(ch).padStart(2, ' ')} [${role}] -> ${stateBadge}  (${address})`
	}

	// 4. Matrix Channel Mute (Tech/Comms Feed Matrix 1): /Matrix_Channels/{id}/Channel_Input/mute
	const matrixMatch = address.match(/^\/Matrix_Channels\/(\d+)\/Channel_Input\/mute$/)
	if (matrixMatch) {
		const mtx = matrixMatch[1]
		const isMuted = val === 1
		const stateBadge = isMuted
			? `${ANSI.yellow}MUTE = 1 (TECH MATRIX CLOSED)${ANSI.reset}`
			: `${ANSI.bgYellow} MUTE = 0 (TECH COMMS MATRIX ACTIVE!) ${ANSI.reset}`
		return `${ANSI.cyan}[S21 OSC :8000]${ANSI.reset} 🔀 ${ANSI.bold}MATRIX${ANSI.reset}  Mtx ${mtx} [Tech Comms Feed] -> ${stateBadge}  (${address})`
	}

	// 5. Rotary Encoders (Input Trim, Aux Send, Control Room Monitor)
	return `${ANSI.cyan}[S21 OSC :8000]${ANSI.reset} 🎛️  ${ANSI.bold}PARAM${ANSI.reset}   ${address} -> ${JSON.stringify(val)}`
}

/**
 * Starts the Mock Hardware Stage (Astral WebSocket Server + DiGiCo S21 UDP Server + Mixing Station UDP Listener)
 */
async function startMockHardwareStage(options = {}) {
	const astralPort = options.astralPort ?? 8080
	const s21Port = options.s21Port ?? 8000
	const tabletPort = options.tabletPort ?? 9000
	const broadcastIntervalMs = options.broadcastIntervalMs ?? 2000
	const quiet = Boolean(options.quiet)

	const s21ReceivedLog = []
	const tabletReceivedLog = []
	const astralReceivedLog = []

	const log = (msg) => {
		if (!quiet) {
			const ts = new Date().toISOString().slice(11, 23)
			console.log(`${ANSI.dim}[${ts}]${ANSI.reset} ${msg}`)
		}
	}

	// Simulated Astral Wireless Channels State
	const simChannels = [
		{ rxId: 1, name: 'VOX1', battery: 84, clip: false, rfRssi: -46, nexlink: 98, txGainDb: 12 },
		{ rxId: 2, name: 'VOX2', battery: 18, clip: false, rfRssi: -54, nexlink: 92, txGainDb: 15 }, // Low Battery (<20% -> Amber 5)
		{ rxId: 3, name: 'VOX3', battery: 65, clip: true, rfRssi: -49, nexlink: 95, txGainDb: 10 }, // Clipping (-> Red 6)
		{ rxId: 4, name: 'GTR1', battery: 91, clip: false, rfRssi: -44, nexlink: 100, txGainDb: 6 },
	]

	// 1. Start DiGiCo S21 UDP OSC Server (Port 8000)
	const s21Socket = dgram.createSocket('udp4')
	s21Socket.on('message', (msg, rinfo) => {
		const decoded = decodeOscPacket(msg)
		if (decoded) {
			s21ReceivedLog.push({ ...decoded, rinfo })
			log(formatS21OscLog(decoded))
		}
	})

	await new Promise((resolve, reject) => {
		s21Socket.once('error', reject)
		s21Socket.bind(s21Port, '127.0.0.1', () => resolve())
	})

	// 2. Start Mixing Station Tablet UDP OSC Listener (Port 9000)
	const tabletSocket = dgram.createSocket('udp4')
	tabletSocket.on('message', (msg, rinfo) => {
		const decoded = decodeOscPacket(msg)
		if (decoded) {
			tabletReceivedLog.push({ ...decoded, rinfo })
			if (decoded.address.startsWith('/MixingStation/')) {
				const val = decoded.args[0]?.value
				log(`${ANSI.magenta}[TABLET :${tabletPort}]${ANSI.reset} 📱 ${decoded.address} -> ${ANSI.bold}${val}${ANSI.reset}`)
			}
		}
	})

	await new Promise((resolve, reject) => {
		tabletSocket.once('error', reject)
		tabletSocket.bind(tabletPort, '127.0.0.1', () => resolve())
	})

	// 3. Start Sound Devices Astral (A20-Nexus / ARX32) WebSocket Server (Port 8080)
	const wss = new WebSocketServer({ host: '127.0.0.1', port: astralPort })
	await new Promise((resolve) => wss.once('listening', resolve))

	wss.on('connection', (ws, req) => {
		log(`${ANSI.green}[ASTRAL WS :${astralPort}]${ANSI.reset} 📡 Orchestrator connected from ${req.socket.remoteAddress}`)

		// Send immediate initial telemetry snapshot upon connection
		ws.send(
			JSON.stringify({
				device: 'Sound Devices A20-Nexus',
				timestamp: Date.now(),
				channels: simChannels,
			})
		)

		ws.on('message', (raw) => {
			try {
				const cmd = JSON.parse(raw.toString('utf8'))
				astralReceivedLog.push(cmd)
				if (cmd.command === 'set_nexlink_tx_gain') {
					const ch = simChannels.find((c) => c.rxId === cmd.rxId)
					if (ch) ch.txGainDb = cmd.txGainDb
					log(
						`${ANSI.green}[ASTRAL WS :${astralPort}]${ANSI.reset} 🎚️  ${ANSI.bold}NEXLINK OTA GAIN${ANSI.reset} RX Ch ${cmd.rxId} -> ${cmd.txGainDb} dB`
					)
				}
			} catch {
				// Ignore malformed frames
			}
		})
	})

	let tickCount = 0
	const broadcastTimer = setInterval(() => {
		tickCount++
		// Evolve simulated battery drain and random capsule clipping bursts
		for (const ch of simChannels) {
			if (tickCount % 2 === 0 && ch.battery > 5) {
				ch.battery = Math.max(5, ch.battery - 1)
			}
			// Toggle periodic clipping on RX 3 or random transient clip
			if (ch.rxId === 3) {
				ch.clip = tickCount % 2 === 1
			} else if (ch.rxId === 1) {
				ch.clip = tickCount % 5 === 0
			}
		}

		const payload = JSON.stringify({
			device: 'Sound Devices A20-Nexus',
			timestamp: Date.now(),
			channels: simChannels,
		})

		for (const client of wss.clients) {
			if (client.readyState === 1) {
				client.send(payload)
			}
		}
	}, broadcastIntervalMs)
	broadcastTimer.unref?.()

	log(`${ANSI.bold}========================================================================${ANSI.reset}`)
	log(`${ANSI.green}🚀 ALPHA STATE STAGE SIMULATOR ONLINE${ANSI.reset}`)
	log(`   • Sound Devices Astral WebSocket : ws://127.0.0.1:${astralPort}`)
	log(`   • DiGiCo S21 Console UDP OSC     : udp://127.0.0.1:${s21Port}`)
	log(`   • Mixing Station Tablet Relay    : udp://127.0.0.1:${tabletPort}`)
	log(`${ANSI.bold}========================================================================${ANSI.reset}`)

	async function stop() {
		clearInterval(broadcastTimer)
		await new Promise((resolve) => wss.close(() => resolve()))
		await new Promise((resolve) => s21Socket.close(() => resolve()))
		await new Promise((resolve) => tabletSocket.close(() => resolve()))
	}

	return {
		wss,
		s21Socket,
		tabletSocket,
		s21ReceivedLog,
		tabletReceivedLog,
		astralReceivedLog,
		simChannels,
		stop,
	}
}

module.exports = {
	startMockHardwareStage,
	decodeOscPacket,
	formatS21OscLog,
}

// CLI Entrypoint when run directly via `node mock-hardware-stage.js`
if (require.main === module) {
	const args = process.argv.slice(2)
	const durationIdx = args.indexOf('--duration')
	const durationSec = durationIdx !== -1 ? Number(args[durationIdx + 1]) : null
	const runDemo = args.includes('--demo')

	;(async () => {
		const stage = await startMockHardwareStage({
			astralPort: 8080,
			s21Port: 8000,
			tabletPort: 9000,
			broadcastIntervalMs: 1500,
		})

		// If --demo is passed, attach the compiled Orchestrator in-process and run through all test cases
		if (runDemo) {
			const { DiGiCoAstralOrchestratorInstance } = require('./dist/main')
			const { DEFAULT_CONFIG } = require('./dist/config')
			const { setActiveChannel, clearArmedChannel, executeSmartPedalStomp } = require('./dist/actions')

			console.log(`\n${ANSI.yellow}>>> [DEMO] Attaching DiGiCo-Astral Orchestrator Instance to Mock Stage...${ANSI.reset}\n`)
			const orchestrator = Object.create(DiGiCoAstralOrchestratorInstance.prototype)
			orchestrator.config = { ...DEFAULT_CONFIG }
			orchestrator.channelMapping = []
			orchestrator.activePanicTarget = null
			orchestrator.focusedChannel = 1
			orchestrator.pedalPressed = false
			orchestrator.flashPhase = false
			orchestrator.localMonitorCueDb = 0
			orchestrator.channelStates = new Map()
			orchestrator.rxToS21Map = new Map()
			orchestrator.log = () => {}
			orchestrator.updateStatus = () => {}
			orchestrator.setActionDefinitions = () => {}
			orchestrator.setFeedbackDefinitions = () => {}
			orchestrator.setVariableDefinitions = () => {}
			orchestrator.setPresetDefinitions = () => {}
			orchestrator.setVariableValues = () => {}
			orchestrator.checkFeedbacks = () => {}

			await orchestrator.init(DEFAULT_CONFIG)

			await new Promise((r) => setTimeout(r, 800))
			console.log(`\n${ANSI.magenta}>>> [DEMO STEP 1] Mode A (Comms Mode, activePanicTarget === null): Foot Pedal Stomp & Release${ANSI.reset}`)
			executeSmartPedalStomp(orchestrator, true)
			await new Promise((r) => setTimeout(r, 300))
			executeSmartPedalStomp(orchestrator, false)

			await new Promise((r) => setTimeout(r, 500))
			console.log(`\n${ANSI.magenta}>>> [DEMO STEP 2] Arm Channel 1 on Grid (setActiveChannel(1)) -> Mode B Panic Mode Stomp & Release${ANSI.reset}`)
			setActiveChannel(orchestrator, 1)
			executeSmartPedalStomp(orchestrator, true)
			await new Promise((r) => setTimeout(r, 300))
			executeSmartPedalStomp(orchestrator, false)

			await new Promise((r) => setTimeout(r, 500))
			console.log(`\n${ANSI.magenta}>>> [DEMO STEP 3] Clear Armed Channel (clearArmedChannel()) & Adjust 4 Rotary Dials${ANSI.reset}`)
			clearArmedChannel(orchestrator)
			orchestrator.adjustDial1NexLinkGain(2.0, 1)
			orchestrator.adjustDial2S21InputTrim(1.5, 1)
			orchestrator.adjustDial3AuxIemSend(2.0, 1)
			orchestrator.adjustDial4MonitorCueVolume(-1.0)

			await new Promise((r) => setTimeout(r, 600))
			await orchestrator.destroy()
			await stage.stop()
			console.log(`\n${ANSI.green}✅ [DEMO COMPLETE] All telemetry, S21 OSC commands, and Dual-Mode Panic Switch states verified.${ANSI.reset}`)
			process.exit(0)
		}

		if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
			setTimeout(async () => {
				console.log(`\n${ANSI.yellow}⏱️  Simulator duration (${durationSec}s) elapsed. Shutting down cleanly.${ANSI.reset}`)
				await stage.stop()
				process.exit(0)
			}, durationSec * 1000)
		}

		process.on('SIGINT', async () => {
			console.log(`\n${ANSI.yellow}Shutting down Alpha State Stage Simulator...${ANSI.reset}`)
			await stage.stop()
			process.exit(0)
		})
	})()
}

