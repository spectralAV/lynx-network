import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clearArmedChannel, executeSmartPedalStomp, setActiveChannel } from '../actions'
import { DEFAULT_CONFIG, parseChannelMapping, parseMixingStationEndpoints } from '../config'
import { computeS21ColorCode, DiGiCoAstralOrchestratorInstance, formatRestrictedS21Name } from '../main'
import { MixingStationSessionManager } from '../mixing-station'
import { decodeOscMessage, encodeOscMessage } from '../osc'
import { SmartPedalHardwareController } from '../pedal'
import { SennheiserD6000UdpDriver, ShureAxientTelnetDriver } from '../wireless'

// Import the Alpha State Stage Simulator
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startMockHardwareStage } = require('../../mock-hardware-stage.js')

function createHeadlessOrchestrator(): DiGiCoAstralOrchestratorInstance {
	const inst = Object.create(DiGiCoAstralOrchestratorInstance.prototype) as DiGiCoAstralOrchestratorInstance
	inst.config = { ...DEFAULT_CONFIG }
	inst.channelMapping = []
	inst.activePanicTarget = null
	inst.focusedChannel = 1
	inst.pedalPressed = false
	inst.flashPhase = false
	inst.localMonitorCueDb = 0
	;(inst as unknown as Record<string, unknown>).channelStates = new Map()
	;(inst as unknown as Record<string, unknown>).rxToS21Map = new Map()
	inst.log = () => undefined
	inst.updateStatus = () => undefined
	inst.setActionDefinitions = () => undefined
	inst.setFeedbackDefinitions = () => undefined
	inst.setVariableDefinitions = () => undefined
	inst.setPresetDefinitions = () => undefined
	inst.setVariableValues = () => undefined
	inst.checkFeedbacks = () => undefined
	return inst
}

describe('Lynx Network (lynx-network) Alpha Suite', () => {
	it('encodes and decodes OSC 1.0 binary packets (string, int32, float32)', () => {
		const namePacket = encodeOscMessage('/Input_Channels/1/Channel_Input/name', [{ type: 's', value: 'VOX1 84%' }])
		const decodedName = decodeOscMessage(namePacket)
		assert.ok(decodedName)
		assert.equal(decodedName.address, '/Input_Channels/1/Channel_Input/name')
		assert.deepEqual(decodedName.args, [{ type: 's', value: 'VOX1 84%' }])

		const colorPacket = encodeOscMessage('/Input_Channels/2/Channel_Input/color', [{ type: 'i', value: 5 }])
		const decodedColor = decodeOscMessage(colorPacket)
		assert.ok(decodedColor)
		assert.equal(decodedColor.address, '/Input_Channels/2/Channel_Input/color')
		assert.deepEqual(decodedColor.args, [{ type: 'i', value: 5 }])
	})

	it('formats S21 scribble-strip names with restricted slicing and maps S21 color codes (2/5/6)', () => {
		assert.equal(formatRestrictedS21Name('VOX1', 84, 12), 'VOX1 84%')
		assert.equal(formatRestrictedS21Name('LEAD_VOCAL_LONG_NAME', 95, 12), 'LEAD_VOC 95%')

		// 2 = Green operational, 5 = Amber (<20%), 6 = Red (clip or <=10%)
		assert.equal(computeS21ColorCode(84, false, 20, 10), 2)
		assert.equal(computeS21ColorCode(18, false, 20, 10), 5)
		assert.equal(computeS21ColorCode(75, true, 20, 10), 6)
		assert.equal(computeS21ColorCode(8, false, 20, 10), 6)
	})

	it('parses Channel-to-Fader JSON mappings and Mixing Station @auxN / @foh endpoints', () => {
		const map = parseChannelMapping(JSON.stringify([{ rxId: 1, s21Channel: 1, label: 'VOX1', auxSend: 1 }]))
		assert.equal(map.length, 1)
		assert.equal(map[0].label, 'VOX1')

		const endpoints = parseMixingStationEndpoints('192.168.1.50:9000@aux1, 192.168.1.51:9002@aux2, 192.168.1.99:9000@foh')
		assert.equal(endpoints.length, 3)
		assert.deepEqual(endpoints[0], { host: '192.168.1.50', port: 9000, allowedAuxBus: 1, role: 'iem' })
		assert.deepEqual(endpoints[1], { host: '192.168.1.51', port: 9002, allowedAuxBus: 2, role: 'iem' })
		assert.deepEqual(endpoints[2], { host: '192.168.1.99', port: 9000, allowedAuxBus: undefined, role: 'foh' })
	})

	it('enforces Mixing Station Stage Tablet Aux Bus Firewall and Mode B Panic-Lock Guard', () => {
		const endpoints = parseMixingStationEndpoints('192.168.1.50:9000@aux1, 192.168.1.99:9000@foh')
		const manager = new MixingStationSessionManager(endpoints, {
			restrictTabletsToIemBuses: true,
			talkbackChannel: 48,
			techMatrixChannel: 1,
		})

		// 1. Musician Tablet 1 (@aux1) can adjust Aux 1 via alias or native S21 path
		const allowedAux1 = manager.evaluateClientPacket(
			{ address: '/MixingStation/bus/1/ch/3/level', args: [{ type: 'f', value: -3.5 }] },
			'192.168.1.50',
			9000,
			null,
			false
		)
		assert.equal(allowedAux1.allowed, true)
		assert.equal(allowedAux1.targetAddress, '/Input_Channels/3/Aux_Send/1/level')

		// 2. Musician Tablet 1 (@aux1) is blocked from modifying Aux 2
		const blockedAux2 = manager.evaluateClientPacket(
			{ address: '/Input_Channels/3/Aux_Send/2/level', args: [{ type: 'f', value: 0.0 }] },
			'192.168.1.50',
			9000,
			null,
			false
		)
		assert.equal(blockedAux2.allowed, false)

		// 3. Musician Tablet 1 is blocked from modifying FOH Input Trim or Talkback Ch 48
		const blockedTrim = manager.evaluateClientPacket(
			{ address: '/Input_Channels/1/Channel_Input/trim', args: [{ type: 'f', value: 6.0 }] },
			'192.168.1.50',
			9000,
			null,
			false
		)
		assert.equal(blockedTrim.allowed, false)

		// 4. Mode B Panic-Lock Guard blocks even @foh rover tablet from unmuting a panicked channel
		const blockedPanicUnmute = manager.evaluateClientPacket(
			{ address: '/Input_Channels/1/Channel_Input/mute', args: [{ type: 'i', value: 0 }] },
			'192.168.1.99',
			9000,
			1, // Channel 1 armed
			true // Pedal actively stomped
		)
		assert.equal(blockedPanicUnmute.allowed, false)
		assert.match(blockedPanicUnmute.reason, /BLOCKED_BY_PANIC_LOCK/)
	})

	it('parses USB-MIDI CC64 Sustain Pedal and Keyboard events with polarity control', () => {
		const transitions: boolean[] = []
		const pedal = new SmartPedalHardwareController({
			debounceMs: 0,
			onPedalChange: (pressed) => transitions.push(pressed),
		})

		// CC 64 Down (127) -> true, Up (0) -> false
		assert.equal(pedal.handleMidiMessage([0xb0, 64, 127]), true)
		assert.equal(pedal.handleMidiMessage([0xb0, 64, 0]), false)
		assert.deepEqual(transitions, [true, false])
	})

	it('parses Shure Axient Digital TCP and Sennheiser D6000 SSC UDP wireless telemetry frames', () => {
		const shure = new ShureAxientTelnetDriver({ host: '127.0.0.1', port: 2202 })
		const shureFrames = shure.parseShureStream('< REP 1 BATT_CHARGE 076 >< REP 1 AUDIO_OVERLOAD ON >')
		assert.equal(shureFrames.length, 2)
		assert.equal(shureFrames[1].rxId, 1)
		assert.equal(shureFrames[1].batteryPercent, 76)
		assert.equal(shureFrames[1].clip, true)

		const senn = new SennheiserD6000UdpDriver({ host: '127.0.0.1', port: 53212 })
		const sennFrames = senn.parseSscFrame(
			JSON.stringify({ rx2: { bat: { gauge: 45 }, audio: { overload: false }, name: 'VOX2' } })
		)
		assert.equal(sennFrames.length, 1)
		assert.equal(sennFrames[0].rxId, 2)
		assert.equal(sennFrames[0].batteryPercent, 45)
		assert.equal(sennFrames[0].clip, false)
	})

	it('verifies end-to-end Astral WS telemetry, S21 OSC commands, Dual-Mode Panic Switch, and Tablet Relays against Mock Hardware Stage', async () => {
		const testAstralPort = 18080
		const testS21Port = 18000
		const testProxyPort = 18001
		const testTabletPort = 19000

		const stage = await startMockHardwareStage({
			astralPort: testAstralPort,
			s21Port: testS21Port,
			tabletPort: testTabletPort,
			broadcastIntervalMs: 5000,
			quiet: true,
		})

		const orchestrator = createHeadlessOrchestrator()

		try {
			await orchestrator.init({
				...DEFAULT_CONFIG,
				s21Host: '127.0.0.1',
				s21Port: testS21Port,
				proxyListenPort: testProxyPort,
				astralHost: '127.0.0.1',
				astralPort: testAstralPort,
				mixingStationClients: `127.0.0.1:${testTabletPort}@aux1`,
			})

			// Wait for initial Astral WebSocket connection and telemetry ingestion
			await new Promise((r) => setTimeout(r, 350))

			// Verify Astral telemetry mapped to S21 Rename & Color codes
			const ch1NameMsg = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Input_Channels/1/Channel_Input/name'
			)
			assert.ok(ch1NameMsg, 'Expected S21 Channel 1 rename OSC message')
			assert.equal(ch1NameMsg.args[0].value, 'VOX1 84%')

			const ch1ColorMsg = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Input_Channels/1/Channel_Input/color'
			)
			assert.ok(ch1ColorMsg)
			assert.equal(ch1ColorMsg.args[0].value, 2) // Green

			const ch2ColorMsg = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Input_Channels/2/Channel_Input/color'
			)
			assert.ok(ch2ColorMsg)
			assert.equal(ch2ColorMsg.args[0].value, 5) // Amber (<20% battery)

			const ch3ColorMsg = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Input_Channels/3/Channel_Input/color'
			)
			assert.ok(ch3ColorMsg)
			assert.equal(ch3ColorMsg.args[0].value, 6) // Red (Clipping)

			// Verify Mixing Station Tablet received live battery telemetry & normalized bar relay
			const tabletBattMsg = stage.tabletReceivedLog.find(
				(m: { address: string }) => m.address === '/MixingStation/ch/1/battery'
			)
			const tabletBarMsg = stage.tabletReceivedLog.find(
				(m: { address: string }) => m.address === '/MixingStation/ch/1/battery_bar'
			)
			assert.ok(tabletBattMsg, 'Expected Mixing Station tablet to receive battery telemetry relay')
			assert.equal(tabletBattMsg.args[0].value, 84)
			assert.ok(tabletBarMsg, 'Expected Mixing Station tablet to receive normalized battery_bar float')
			assert.equal(tabletBarMsg.args[0].value, 0.84)

			// Verify Mode A: Comms Mode (activePanicTarget === null)
			assert.equal(orchestrator.activePanicTarget, null)
			stage.s21ReceivedLog.length = 0

			executeSmartPedalStomp(orchestrator, true)
			await new Promise((r) => setTimeout(r, 80))

			const tbPressMsg = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Input_Channels/48/Channel_Input/mute'
			)
			assert.ok(tbPressMsg, 'Expected Mode A pedal press to unmute Ch 48')
			assert.equal(tbPressMsg.args[0].value, 0)

			stage.s21ReceivedLog.length = 0
			executeSmartPedalStomp(orchestrator, false)
			await new Promise((r) => setTimeout(r, 80))

			const tbReleaseMsg = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Input_Channels/48/Channel_Input/mute'
			)
			assert.ok(tbReleaseMsg, 'Expected Mode A pedal release to mute Ch 48')
			assert.equal(tbReleaseMsg.args[0].value, 1)

			// Verify Mode B: Panic Mode (setActiveChannel(1) -> activePanicTarget === 1)
			setActiveChannel(orchestrator, 1)
			assert.equal(orchestrator.activePanicTarget, 1)
			stage.s21ReceivedLog.length = 0

			executeSmartPedalStomp(orchestrator, true)
			await new Promise((r) => setTimeout(r, 80))

			const panicMuteCh1 = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Input_Channels/1/Channel_Input/mute'
			)
			const panicUnmuteMatrix1 = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Matrix_Channels/1/Channel_Input/mute'
			)
			assert.ok(panicMuteCh1, 'Expected Mode B pedal press to mute armed channel 1 in PA')
			assert.equal(panicMuteCh1.args[0].value, 1)
			assert.ok(panicUnmuteMatrix1, 'Expected Mode B pedal press to unmute Tech Matrix 1')
			assert.equal(panicUnmuteMatrix1.args[0].value, 0)

			// Release Mode B Panic Pedal -> restores normal show operation
			stage.s21ReceivedLog.length = 0
			executeSmartPedalStomp(orchestrator, false)
			await new Promise((r) => setTimeout(r, 80))

			const restoreCh1 = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Input_Channels/1/Channel_Input/mute'
			)
			const restoreMatrix1 = stage.s21ReceivedLog.find(
				(m: { address: string }) => m.address === '/Matrix_Channels/1/Channel_Input/mute'
			)
			assert.ok(restoreCh1)
			assert.equal(restoreCh1.args[0].value, 0)
			assert.ok(restoreMatrix1)
			assert.equal(restoreMatrix1.args[0].value, 1)

			// Clear Armed Channel -> returns activePanicTarget to null
			clearArmedChannel(orchestrator)
			assert.equal(orchestrator.activePanicTarget, null)
		} finally {
			await orchestrator.destroy()
			await stage.stop()
		}
	})
})
