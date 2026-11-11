import { InstanceBase, InstanceStatus, runEntrypoint, SomeCompanionConfigField } from '@companion-module/base'
import { GetActionsList } from './actions'
import {
	ChannelMappingEntry,
	DEFAULT_CONFIG,
	GetConfigFields,
	ModuleConfig,
	parseChannelMapping,
	parseMixingStationEndpoints,
} from './config'
import { GetFeedbacksList } from './feedbacks'
import { MixingStationSessionManager } from './mixing-station'
import { DecodedOscMessage, DiGiCoOscProxyBroker } from './osc'
import { SmartPedalHardwareController } from './pedal'
import { GetPresetsList } from './presets'
import { BuildVariableValues, GetVariableDefinitions } from './variables'
import { createWirelessDriver, WirelessChannelTelemetry, WirelessTelemetryDriver } from './wireless'

export type S21StripColorCode = 2 | 5 | 6 // 2 = Green, 5 = Amber, 6 = Red

export interface ChannelOrchestratorState {
	rxId: number
	s21Channel: number
	baseLabel: string
	auxSend: number
	batteryPercent: number
	clip: boolean
	rfRssi: number
	nexLinkQuality: number
	otaTxGainDb: number
	s21TrimDb: number
	auxIemSendDb: number
	s21DisplayName: string
	s21ColorCode: S21StripColorCode
	mutedInPa: boolean
}

/**
 * Formats an S21 Channel Name string with restricted slicing so battery telemetry fits cleanly
 * on the DiGiCo S21 scribble strip (e.g., "VOX1 84%" capped at `maxNameLength`).
 */
export function formatRestrictedS21Name(baseLabel: string, batteryPercent: number, maxNameLength = 12): string {
	const clampedBatt = Math.max(0, Math.min(100, Math.round(batteryPercent)))
	const suffix = ` ${clampedBatt}%`
	const maxBaseLen = Math.max(1, maxNameLength - suffix.length)
	const trimmedBase = baseLabel.trim().slice(0, maxBaseLen)
	return `${trimmedBase}${suffix}`
}

/**
 * Computes the DiGiCo S21 S-Series local channel strip color code from telemetry:
 * - 6 (Red): Capsule/transmitter clipping OR battery at/below critical threshold
 * - 5 (Amber): Low battery warning below `lowBatteryThreshold` (default 20%)
 * - 2 (Green): Operational normal state
 */
export function computeS21ColorCode(
	batteryPercent: number,
	clip: boolean,
	lowBatteryThreshold = 20,
	criticalBatteryThreshold = 10
): S21StripColorCode {
	if (clip || batteryPercent <= criticalBatteryThreshold) {
		return 6 // Red clip / critical alert
	}
	if (batteryPercent < lowBatteryThreshold) {
		return 5 // Amber low-battery warning (< 20%)
	}
	return 2 // Green operational
}

export class DiGiCoAstralOrchestratorInstance extends InstanceBase<ModuleConfig> {
	public config: ModuleConfig = { ...DEFAULT_CONFIG }
	public channelMapping: ChannelMappingEntry[] = []

	/**
	 * Critical State Engine Property:
	 * - `null` -> Mode A: Comms Mode (Foot pedal triggers FOH Talkback on Channel 48)
	 * - `X` (integer) -> Mode B: Panic Mode (Foot pedal mutes Performer Channel X in PA & unmutes Tech Matrix 1)
	 */
	public activePanicTarget: number | null = null

	/** Currently focused S21 channel for the Stream Deck + LCD Touch Strip & 4 Rotary Dials */
	public focusedChannel = 1

	/** Current momentary floor sustain/foot-switch state */
	public pedalPressed = false

	/** Blink timer phase for Flashing Red clip alerts & Panic Mode flashing key outlines */
	public flashPhase = false

	/** Local Monitor Solo / Cue Volume controlled by Rotary Dial 4 (dB) */
	public localMonitorCueDb = 0.0

	private oscBroker: DiGiCoOscProxyBroker | null = null
	private wirelessDriver: WirelessTelemetryDriver | null = null
	private mixingStationManager: MixingStationSessionManager | null = null
	private pedalHardware: SmartPedalHardwareController | null = null
	private flashTimer: NodeJS.Timeout | null = null
	private channelStates: Map<number, ChannelOrchestratorState> = new Map()
	private rxToS21Map: Map<number, number> = new Map()

	public async init(config: ModuleConfig): Promise<void> {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.rebuildChannelStateIndex()

		this.pedalHardware = new SmartPedalHardwareController({
			onPedalChange: (isPressed) => this.executeSmartPedalStomp(isPressed),
		})

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()
		this.updatePresets()
		this.syncVariables()

		await this.startNetworkServices()
		this.startFlashLoop()

		this.updateStatus(InstanceStatus.Ok)
	}

	public async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.rebuildChannelStateIndex()

		await this.stopNetworkServices()
		await this.startNetworkServices()

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()
		this.updatePresets()
		this.syncVariables()

		this.updateStatus(InstanceStatus.Ok)
	}

	public async destroy(): Promise<void> {
		this.stopFlashLoop()
		await this.stopNetworkServices()
	}

	public getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	private rebuildChannelStateIndex(): void {
		this.channelMapping = parseChannelMapping(this.config.channelMapJson)
		this.rxToS21Map.clear()

		for (const entry of this.channelMapping) {
			this.rxToS21Map.set(entry.rxId, entry.s21Channel)
			const existing = this.channelStates.get(entry.s21Channel)
			const battery = existing?.batteryPercent ?? 100
			const clip = existing?.clip ?? false

			this.channelStates.set(entry.s21Channel, {
				rxId: entry.rxId,
				s21Channel: entry.s21Channel,
				baseLabel: entry.label,
				auxSend: entry.auxSend,
				batteryPercent: battery,
				clip,
				rfRssi: existing?.rfRssi ?? -50,
				nexLinkQuality: existing?.nexLinkQuality ?? 100,
				otaTxGainDb: existing?.otaTxGainDb ?? 12.0,
				s21TrimDb: existing?.s21TrimDb ?? 0.0,
				auxIemSendDb: existing?.auxIemSendDb ?? -6.0,
				s21DisplayName: formatRestrictedS21Name(entry.label, battery, this.config.maxNameLength),
				s21ColorCode: computeS21ColorCode(
					battery,
					clip,
					this.config.lowBatteryThreshold,
					this.config.criticalBatteryThreshold
				),
				mutedInPa: existing?.mutedInPa ?? false,
			})
		}

		if (this.channelMapping.length > 0 && !this.channelStates.has(this.focusedChannel)) {
			this.focusedChannel = this.channelMapping[0].s21Channel
		}
	}

	public getChannelState(s21Channel: number): ChannelOrchestratorState {
		const existing = this.channelStates.get(s21Channel)
		if (existing) return existing

		const fallbackLabel = `CH${s21Channel}`
		const fallback: ChannelOrchestratorState = {
			rxId: s21Channel,
			s21Channel,
			baseLabel: fallbackLabel,
			auxSend: s21Channel,
			batteryPercent: 100,
			clip: false,
			rfRssi: -50,
			nexLinkQuality: 100,
			otaTxGainDb: 12.0,
			s21TrimDb: 0.0,
			auxIemSendDb: -6.0,
			s21DisplayName: formatRestrictedS21Name(fallbackLabel, 100, this.config.maxNameLength),
			s21ColorCode: 2,
			mutedInPa: false,
		}
		this.channelStates.set(s21Channel, fallback)
		return fallback
	}

	public async startNetworkServices(): Promise<void> {
		const tabletEndpoints = parseMixingStationEndpoints(this.config.mixingStationClients)

		this.mixingStationManager = new MixingStationSessionManager(tabletEndpoints, {
			restrictTabletsToIemBuses: Boolean(this.config.restrictTabletsToIemBuses ?? true),
			talkbackChannel: this.config.talkbackChannel || 48,
			techMatrixChannel: this.config.techMatrixChannel || 1,
		})

		// 1. Start Outbound S21 UDP OSC Socket & Multi-Client Proxy Broker with Mixing Station Firewall
		this.oscBroker = new DiGiCoOscProxyBroker({
			s21Host: this.config.s21Host,
			s21Port: this.config.s21Port,
			proxyListenPort: this.config.proxyListenPort,
			mixingStationClients: tabletEndpoints,
			evaluateClientPacket: (msg, rinfo) =>
				this.mixingStationManager!.evaluateClientPacket(
					msg,
					rinfo.address,
					rinfo.port,
					this.activePanicTarget,
					this.pedalPressed
				),
			onLog: (level, msg) => this.log(level, msg),
		})

		this.oscBroker.on('clientProxyMessage', (msg: DecodedOscMessage) => {
			this.ingestBidirectionalOscState(msg)
		})

		this.oscBroker.on('consoleMessage', (msg: DecodedOscMessage) => {
			this.ingestBidirectionalOscState(msg)
		})

		this.oscBroker.on('tabletConnected', (ep: { host: string; port: number }) => {
			this.syncStateToTablet(ep)
		})

		this.oscBroker.on('tabletSyncRequested', (ep: { host: string; port: number }) => {
			this.syncStateToTablet(ep)
		})

		await this.oscBroker.start()

		// 2. Start Inbound Wireless Telemetry Driver (Sound Devices Astral WebSocket by default)
		this.wirelessDriver = createWirelessDriver(this.config.wirelessProtocol, {
			host: this.config.astralHost,
			port: this.config.astralPort,
			onLog: (level, msg) => this.log(level, msg),
		})

		this.wirelessDriver.on('telemetry', (telemetry: WirelessChannelTelemetry) => {
			this.processInboundWirelessTelemetry(telemetry)
		})

		this.wirelessDriver.on('connected', () => {
			this.updateStatus(InstanceStatus.Ok)
		})

		this.wirelessDriver.start()
	}

	/**
	 * Updates internal orchestrator state when a Mixing Station tablet or the DiGiCo S21 Console
	 * modifies Aux IEM send levels, Input Trim, or Monitor levels, keeping Stream Deck + rotary dials in sync.
	 */
	private ingestBidirectionalOscState(msg: DecodedOscMessage): void {
		const { address, args } = msg
		const numVal = Number(args[0]?.value)
		if (!Number.isFinite(numVal)) return

		const auxMatch = address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/level$/)
		if (auxMatch) {
			const chId = Number(auxMatch[1])
			const state = this.getChannelState(chId)
			state.auxIemSendDb = Number(numVal.toFixed(1))
			this.syncVariables()
			return
		}

		const trimMatch = address.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/trim$/)
		if (trimMatch) {
			const chId = Number(trimMatch[1])
			const state = this.getChannelState(chId)
			state.s21TrimDb = Number(numVal.toFixed(1))
			this.syncVariables()
			return
		}

		if (address === '/Control_Room/Monitor/level') {
			this.localMonitorCueDb = Number(numVal.toFixed(1))
			this.syncVariables()
		}
	}

	/**
	 * Pushes a complete cached state snapshot (scribble names, strip colors, battery bars, Aux IEM levels,
	 * and active Panic status) to a newly connected or syncing Mixing Station stage tablet.
	 */
	public syncStateToTablet(endpoint: { host: string; port: number }): void {
		if (!this.oscBroker) return
		for (const entry of this.channelMapping) {
			const st = this.getChannelState(entry.s21Channel)
			const ch = entry.s21Channel
			this.oscBroker.sendToTabletEndpoint(endpoint, `/Input_Channels/${ch}/Channel_Input/name`, [
				{ type: 's', value: st.s21DisplayName },
			])
			this.oscBroker.sendToTabletEndpoint(endpoint, `/Input_Channels/${ch}/Channel_Input/color`, [
				{ type: 'i', value: st.s21ColorCode },
			])
			this.oscBroker.sendToTabletEndpoint(endpoint, `/Input_Channels/${ch}/Aux_Send/${st.auxSend}/level`, [
				{ type: 'f', value: st.auxIemSendDb },
			])
			this.oscBroker.sendToTabletEndpoint(endpoint, `/MixingStation/ch/${ch}/battery`, [
				{ type: 'i', value: st.batteryPercent },
			])
			this.oscBroker.sendToTabletEndpoint(endpoint, `/MixingStation/ch/${ch}/battery_bar`, [
				{ type: 'f', value: Number((st.batteryPercent / 100).toFixed(2)) },
			])
			this.oscBroker.sendToTabletEndpoint(endpoint, `/MixingStation/ch/${ch}/clip`, [
				{ type: 'i', value: st.clip ? 1 : 0 },
			])
			this.oscBroker.sendToTabletEndpoint(endpoint, `/MixingStation/ch/${ch}/nexlink`, [
				{ type: 'i', value: st.nexLinkQuality },
			])
		}
	}

	public async stopNetworkServices(): Promise<void> {
		if (this.wirelessDriver) {
			await this.wirelessDriver.stop()
			this.wirelessDriver = null
		}
		if (this.oscBroker) {
			await this.oscBroker.stop()
			this.oscBroker = null
		}
	}

	/**
	 * Core Orchestrator Loop:
	 * Ingests a parsed Sound Devices Astral / Shure / Sennheiser telemetry frame and maps it to:
	 * A) Inbound S21 Channel Name text strings with restricted slicing ("/Input_Channels/{id}/Channel_Input/name" -> "VOX1 84%")
	 * B) S21 S-Series local channel strip color codes ("/Input_Channels/{id}/Channel_Input/color" -> 2 Green, 5 Amber <20%, 6 Red clip)
	 * C) Live OSC relays back to connected Mixing Station client tablet IPs
	 */
	public processInboundWirelessTelemetry(telemetry: WirelessChannelTelemetry): void {
		const s21Channel = this.rxToS21Map.get(telemetry.rxId) ?? telemetry.rxId
		const state = this.getChannelState(s21Channel)

		state.batteryPercent = telemetry.batteryPercent
		state.clip = telemetry.clip
		if (telemetry.rfRssi !== undefined) state.rfRssi = telemetry.rfRssi
		if (telemetry.nexLinkQuality !== undefined) state.nexLinkQuality = telemetry.nexLinkQuality
		if (telemetry.txGainDb !== undefined) state.otaTxGainDb = telemetry.txGainDb

		// A) Restricted Slicing S21 Channel Name (e.g. "VOX1 84%")
		const newDisplayName = formatRestrictedS21Name(state.baseLabel, state.batteryPercent, this.config.maxNameLength)
		state.s21DisplayName = newDisplayName

		// B) S21 S-Series Local Channel Strip Color Code (2 = Green, 5 = Amber <20%, 6 = Red Clip/Critical)
		const newColorCode = computeS21ColorCode(
			state.batteryPercent,
			state.clip,
			this.config.lowBatteryThreshold,
			this.config.criticalBatteryThreshold
		)
		state.s21ColorCode = newColorCode

		if (this.oscBroker) {
			// Dispatch S21 Channel Name & Color Code over single persistent UDP OSC socket (and mirror to tablets)
			this.oscBroker.sendToConsole(
				`/Input_Channels/${s21Channel}/Channel_Input/name`,
				[{ type: 's', value: newDisplayName }],
				true
			)

			this.oscBroker.sendToConsole(
				`/Input_Channels/${s21Channel}/Channel_Input/color`,
				[{ type: 'i', value: newColorCode }],
				true
			)

			// C) Relay dedicated wireless telemetry OSC state paths to Mixing Station client tablets
			const statusText = state.clip
				? 'CLIP OVERLOAD!'
				: state.batteryPercent < this.config.lowBatteryThreshold
					? `${state.batteryPercent}% LOW BATT!`
					: `${state.batteryPercent}% | NL:${state.nexLinkQuality}%`

			this.oscBroker.relayToMixingStationTablets(`/MixingStation/ch/${s21Channel}/battery`, [
				{ type: 'i', value: state.batteryPercent },
			])
			this.oscBroker.relayToMixingStationTablets(`/MixingStation/ch/${s21Channel}/battery_bar`, [
				{ type: 'f', value: Number((state.batteryPercent / 100).toFixed(2)) },
			])
			this.oscBroker.relayToMixingStationTablets(`/MixingStation/ch/${s21Channel}/clip`, [
				{ type: 'i', value: state.clip ? 1 : 0 },
			])
			this.oscBroker.relayToMixingStationTablets(`/MixingStation/ch/${s21Channel}/nexlink`, [
				{ type: 'i', value: state.nexLinkQuality },
			])
			this.oscBroker.relayToMixingStationTablets(`/MixingStation/ch/${s21Channel}/status_text`, [
				{ type: 's', value: statusText },
			])
		}

		this.syncVariables()
		this.checkFeedbacks('channelHealthStatus')
	}

	/**
	 * Action Router Method: `setActiveChannel(chan_id)`
	 * Arms the specified channel for Mode B Panic Switching (`activePanicTarget = chan_id`)
	 * and focuses it on the Stream Deck + LCD Touch Strip & 4 Rotary Dials.
	 */
	public setActiveChannel(chanId: number): void {
		// If pedal is currently held down while switching targets, safely release prior state first
		if (this.pedalPressed) {
			this.executeSmartPedalStomp(false)
		}

		this.activePanicTarget = chanId
		this.focusedChannel = chanId
		this.log('info', `Armed Panic Target Channel: S21 Ch ${chanId} (Mode B: Panic Mode Ready)`)

		this.syncVariables()
		this.checkFeedbacks('channelHealthStatus', 'panicModeIndicator')
	}

	/**
	 * Action Router Method: `clearArmedChannel()`
	 * Clears `activePanicTarget` (`null`), returning the system to Mode A (FOH Talkback Comms Mode).
	 */
	public clearArmedChannel(): void {
		if (this.pedalPressed) {
			this.executeSmartPedalStomp(false)
		}

		this.activePanicTarget = null
		this.log('info', `Cleared Armed Channel -> Returned to Mode A (FOH Talkback Comms on Ch ${this.config.talkbackChannel})`)

		this.syncVariables()
		this.checkFeedbacks('channelHealthStatus', 'panicModeIndicator')
	}

	/**
	 * Focuses a channel for the LCD Touch Strip and 4x Rotary Encoders without changing `activePanicTarget`.
	 */
	public setFocusedChannel(chanId: number): void {
		this.focusedChannel = Math.max(1, Math.round(chanId))
		this.syncVariables()
	}

	/**
	 * Action Router Method: `executeSmartPedalStomp(boolean_isPressed)`
	 * Implements the Dual-Mode Panic Switch state machine:
	 *
	 * - Mode A: Comms Mode (`activePanicTarget === null`):
	 *   Momentary push-to-talk for FOH Engineer's local talkback mic on Console Input Channel 48:
	 *   `/Input_Channels/48/Channel_Input/mute` -> `0` when pressed, `1` when released.
	 *
	 * - Mode B: Panic Mode (`activePanicTarget = X`):
	 *   Instantly drops performer's microphone `X` out of the audience PA speakers and opens Tech/Comms Matrix 1:
	 *   When pressed (`true`):
	 *     `/Input_Channels/X/Channel_Input/mute` -> `1`
	 *     `/Matrix_Channels/1/Channel_Input/mute` -> `0`
	 *   When released (`false`):
	 *     `/Input_Channels/X/Channel_Input/mute` -> `0`
	 *     `/Matrix_Channels/1/Channel_Input/mute` -> `1`
	 */
	public executeSmartPedalStomp(isPressed: boolean): void {
		this.pedalPressed = Boolean(isPressed)
		const tbChan = this.config.talkbackChannel || 48
		const matrixChan = this.config.techMatrixChannel || 1

		if (this.activePanicTarget === null) {
			// Mode A: Comms Mode (FOH Talkback PTT on Channel 48)
			const muteValue = this.pedalPressed ? 0 : 1
			this.oscBroker?.sendToConsole(
				`/Input_Channels/${tbChan}/Channel_Input/mute`,
				[{ type: 'i', value: muteValue }],
				true
			)
			this.log(
				'info',
				`[Mode A: Comms PTT] Pedal ${this.pedalPressed ? 'PRESSED' : 'RELEASED'} -> /Input_Channels/${tbChan}/Channel_Input/mute = ${muteValue}`
			)
		} else {
			// Mode B: Panic Mode (Armed Channel X)
			const targetChan = this.activePanicTarget
			const paMuteValue = this.pedalPressed ? 1 : 0
			const matrixMuteValue = this.pedalPressed ? 0 : 1

			const state = this.getChannelState(targetChan)
			state.mutedInPa = this.pedalPressed

			this.oscBroker?.sendToConsole(
				`/Input_Channels/${targetChan}/Channel_Input/mute`,
				[{ type: 'i', value: paMuteValue }],
				true
			)
			this.oscBroker?.sendToConsole(
				`/Matrix_Channels/${matrixChan}/Channel_Input/mute`,
				[{ type: 'i', value: matrixMuteValue }],
				true
			)

			// Notify Mixing Station tablets of active Panic state
			this.oscBroker?.relayToMixingStationTablets('/MixingStation/panic/active', [
				{ type: 'i', value: this.pedalPressed ? 1 : 0 },
			])
			this.oscBroker?.relayToMixingStationTablets('/MixingStation/panic/target_name', [
				{
					type: 's',
					value: this.pedalPressed ? `PANIC: ${state.baseLabel} (CH ${targetChan})` : 'NONE',
				},
			])

			this.log(
				'info',
				`[Mode B: PANIC Target Ch ${targetChan}] Pedal ${this.pedalPressed ? 'PRESSED' : 'RELEASED'} -> /Input_Channels/${targetChan}/Channel_Input/mute = ${paMuteValue}, /Matrix_Channels/${matrixChan}/Channel_Input/mute = ${matrixMuteValue}`
			)
		}

		this.syncVariables()
		this.checkFeedbacks('channelHealthStatus', 'panicModeIndicator', 'pedalStompActive')
	}

	/**
	 * Dial 1: Adjusts OTA Transmit Gain (NexLink) on the focused channel.
	 */
	public adjustDial1NexLinkGain(deltaDb: number, chanId = this.focusedChannel): void {
		const state = this.getChannelState(chanId)
		state.otaTxGainDb = Math.max(-12, Math.min(42, Number((state.otaTxGainDb + deltaDb).toFixed(1))))
		this.wirelessDriver?.setOtaTransmitGain(state.rxId, state.otaTxGainDb)
		this.oscBroker?.relayToMixingStationTablets(`/MixingStation/ch/${chanId}/ota_gain`, [
			{ type: 'f', value: state.otaTxGainDb },
		])
		this.syncVariables()
	}

	/**
	 * Dial 2: Adjusts S21 Input Trim on the focused channel.
	 */
	public adjustDial2S21InputTrim(deltaDb: number, chanId = this.focusedChannel): void {
		const state = this.getChannelState(chanId)
		state.s21TrimDb = Math.max(-40, Math.min(40, Number((state.s21TrimDb + deltaDb).toFixed(1))))
		this.oscBroker?.sendToConsole(
			`/Input_Channels/${chanId}/Channel_Input/trim`,
			[{ type: 'f', value: state.s21TrimDb }],
			true
		)
		this.syncVariables()
	}

	/**
	 * Dial 3: Adjusts Musician Aux IEM Send Level on the focused channel.
	 */
	public adjustDial3AuxIemSend(deltaDb: number, chanId = this.focusedChannel): void {
		const state = this.getChannelState(chanId)
		state.auxIemSendDb = Math.max(-90, Math.min(10, Number((state.auxIemSendDb + deltaDb).toFixed(1))))
		this.oscBroker?.sendToConsole(
			`/Input_Channels/${chanId}/Aux_Send/${state.auxSend}/level`,
			[{ type: 'f', value: state.auxIemSendDb }],
			true
		)
		this.syncVariables()
	}

	/**
	 * Dial 4: Adjusts Local Monitor Solo / Cue Volume.
	 */
	public adjustDial4MonitorCueVolume(deltaDb: number): void {
		this.localMonitorCueDb = Math.max(-90, Math.min(10, Number((this.localMonitorCueDb + deltaDb).toFixed(1))))
		this.oscBroker?.sendToConsole(
			`/Control_Room/Monitor/level`,
			[{ type: 'f', value: this.localMonitorCueDb }],
			false
		)
		this.syncVariables()
	}

	private startFlashLoop(): void {
		this.stopFlashLoop()
		this.flashTimer = setInterval(() => {
			this.flashPhase = !this.flashPhase
			this.checkFeedbacks('channelHealthStatus', 'panicModeIndicator')
		}, 450)
		this.flashTimer.unref?.()
	}

	private stopFlashLoop(): void {
		if (this.flashTimer) {
			clearInterval(this.flashTimer)
			this.flashTimer = null
		}
	}

	private updateActions(): void {
		this.setActionDefinitions(GetActionsList(this))
	}

	private updateFeedbacks(): void {
		this.setFeedbackDefinitions(GetFeedbacksList(this))
	}

	private updateVariableDefinitions(): void {
		this.setVariableDefinitions(GetVariableDefinitions(this))
	}

	private updatePresets(): void {
		this.setPresetDefinitions(GetPresetsList(this))
	}

	private syncVariables(): void {
		this.setVariableValues(BuildVariableValues(this))
	}

	public getOscBroker(): DiGiCoOscProxyBroker | null {
		return this.oscBroker
	}

	public getWirelessDriver(): WirelessTelemetryDriver | null {
		return this.wirelessDriver
	}

	public getPedalHardware(): SmartPedalHardwareController | null {
		return this.pedalHardware
	}
}

// Only invoke Companion IPC entrypoint when launched as a Companion plugin process
if (require.main === module && typeof process.send === 'function') {
	runEntrypoint(DiGiCoAstralOrchestratorInstance, [])
}
