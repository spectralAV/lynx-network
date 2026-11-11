import { CompanionActionDefinitions } from '@companion-module/base'
import type { DiGiCoAstralOrchestratorInstance } from './main'

/**
 * Sets (arms) the target S21 channel for the Dual-Mode Panic Switch (`activePanicTarget = chan_id`)
 * and binds the Stream Deck + LCD touch strip & 4 rotary encoder dials to that channel.
 */
export function setActiveChannel(instance: DiGiCoAstralOrchestratorInstance, chan_id: number): void {
	const parsedId = Math.max(1, Math.round(Number(chan_id) || 1))
	instance.setActiveChannel(parsedId)
}

/**
 * Disarms any currently armed channel (`activePanicTarget = null`),
 * returning the floor foot-switch to Mode A (FOH Talkback Comms Mode on Ch 48).
 */
export function clearArmedChannel(instance: DiGiCoAstralOrchestratorInstance): void {
	instance.clearArmedChannel()
}

/**
 * Executes the Dual-Mode Panic Switch conditional logic loop on foot-pedal press or release:
 *
 * - Mode A (`activePanicTarget === null`):
 *   Momentary Push-To-Talk (PTT) for FOH Engineer's local talkback microphone on Console Input Channel 48:
 *   `/Input_Channels/48/Channel_Input/mute` -> `0` when pressed (`true`), `1` when released (`false`).
 *
 * - Mode B (`activePanicTarget = X`):
 *   Panic Mode — drops performer's microphone `X` from the audience PA and opens Tech/Comms Matrix 1:
 *   When pressed (`true`):
 *     `/Input_Channels/X/Channel_Input/mute` -> `1`
 *     `/Matrix_Channels/1/Channel_Input/mute` -> `0`
 *   When released (`false`):
 *     `/Input_Channels/X/Channel_Input/mute` -> `0`
 *     `/Matrix_Channels/1/Channel_Input/mute` -> `1`
 */
export function executeSmartPedalStomp(
	instance: DiGiCoAstralOrchestratorInstance,
	boolean_isPressed: boolean
): void {
	instance.executeSmartPedalStomp(Boolean(boolean_isPressed))
}

/**
 * Returns the Bitfocus Companion v3 Action Definitions for the module.
 */
export function GetActionsList(instance: DiGiCoAstralOrchestratorInstance): CompanionActionDefinitions {
	return {
		setActiveChannel: {
			name: 'Grid: Arm / Set Active Panic Target Channel (setActiveChannel)',
			description:
				'Arms a target S21 channel for Mode B Panic Switching (activePanicTarget = X) and focuses it on the LCD strip & rotary encoders.',
			options: [
				{
					type: 'number',
					id: 'chan_id',
					label: 'Target S21 Input Channel ID (X)',
					default: 1,
					min: 1,
					max: 128,
				},
				{
					type: 'checkbox',
					id: 'toggleIfAlreadyArmed',
					label: 'Disarm (Return to Comms Mode A) if this channel is already armed',
					default: true,
				},
			],
			callback: async (event) => {
				const chanId = Number(event.options.chan_id ?? 1)
				const toggle = Boolean(event.options.toggleIfAlreadyArmed)
				if (toggle && instance.activePanicTarget === chanId) {
					clearArmedChannel(instance)
				} else {
					setActiveChannel(instance, chanId)
				}
			},
		},

		clearArmedChannel: {
			name: 'Grid: Clear Armed Channel / Return to Comms Mode A (clearArmedChannel)',
			description: 'Resets activePanicTarget to null so the floor pedal operates as FOH Talkback PTT on Channel 48.',
			options: [],
			callback: async () => {
				clearArmedChannel(instance)
			},
		},

		executeSmartPedalStomp: {
			name: 'Floor Pedal: Execute Smart Pedal Stomp (executeSmartPedalStomp)',
			description:
				'Dual-Mode Panic Switch conditional router: Mode A (null) = Ch 48 Talkback PTT; Mode B (X) = Mute Ch X in PA & Unmute Matrix 1.',
			options: [
				{
					type: 'checkbox',
					id: 'boolean_isPressed',
					label: 'Pedal State (Checked = Pressed Down / Unchecked = Released Up)',
					default: true,
				},
			],
			callback: async (event) => {
				const isPressed = Boolean(event.options.boolean_isPressed)
				executeSmartPedalStomp(instance, isPressed)
			},
		},

		focusChannel: {
			name: 'LCD Strip & Dials: Focus Channel Without Arming Panic Switch',
			description: 'Selects the channel displayed on the Stream Deck + LCD Touch Strip and controlled by Dials 1-4.',
			options: [
				{
					type: 'number',
					id: 'chan_id',
					label: 'Target S21 Channel ID',
					default: 1,
					min: 1,
					max: 128,
				},
			],
			callback: async (event) => {
				const chanId = Number(event.options.chan_id ?? 1)
				instance.setFocusedChannel(chanId)
			},
		},

		dial1_ota_tx_gain: {
			name: 'Dial 1: Adjust OTA Transmit Gain (Sound Devices NexLink)',
			description: 'Contextual Rotary Encoder 1: Adjusts transmitter OTA gain via NexLink on the focused channel.',
			options: [
				{
					type: 'number',
					id: 'delta',
					label: 'Gain Step (dB, positive for CW / negative for CCW)',
					default: 1,
					min: -12,
					max: 12,
				},
			],
			callback: async (event) => {
				const delta = Number(event.options.delta ?? 1)
				instance.adjustDial1NexLinkGain(delta)
			},
		},

		dial2_s21_input_trim: {
			name: 'Dial 2: Adjust DiGiCo S21 Input Trim',
			description: 'Contextual Rotary Encoder 2: Adjusts S21 digital input trim on the focused channel.',
			options: [
				{
					type: 'number',
					id: 'delta',
					label: 'Trim Step (dB, positive for CW / negative for CCW)',
					default: 0.5,
					min: -10,
					max: 10,
				},
			],
			callback: async (event) => {
				const delta = Number(event.options.delta ?? 0.5)
				instance.adjustDial2S21InputTrim(delta)
			},
		},

		dial3_musician_aux_iem: {
			name: 'Dial 3: Adjust Musician Aux IEM Send Level',
			description: 'Contextual Rotary Encoder 3: Adjusts the mapped Musician Aux IEM Send level on the focused channel.',
			options: [
				{
					type: 'number',
					id: 'delta',
					label: 'IEM Send Step (dB, positive for CW / negative for CCW)',
					default: 1.0,
					min: -10,
					max: 10,
				},
			],
			callback: async (event) => {
				const delta = Number(event.options.delta ?? 1.0)
				instance.adjustDial3AuxIemSend(delta)
			},
		},

		dial4_local_monitor_cue: {
			name: 'Dial 4: Adjust Local Monitor Solo / Cue Volume',
			description: 'Contextual Rotary Encoder 4: Adjusts the FOH engineer local Solo / Cue wedge or IEM volume.',
			options: [
				{
					type: 'number',
					id: 'delta',
					label: 'Monitor Level Step (dB, positive for CW / negative for CCW)',
					default: 1.0,
					min: -10,
					max: 10,
				},
			],
			callback: async (event) => {
				const delta = Number(event.options.delta ?? 1.0)
				instance.adjustDial4MonitorCueVolume(delta)
			},
		},
	}
}

