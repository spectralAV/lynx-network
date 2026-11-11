import { CompanionPresetDefinitions } from '@companion-module/base'
import { COLORS } from './feedbacks'
import type { DiGiCoAstralOrchestratorInstance } from './main'

export function GetPresetsList(instance: DiGiCoAstralOrchestratorInstance): CompanionPresetDefinitions {
	const presets: CompanionPresetDefinitions = {}

	// 1. Top Button Grid: Wireless Channel Selection / Arming & Gated Alerts
	for (const entry of instance.channelMapping) {
		const ch = entry.s21Channel
		presets[`grid_ch_${ch}`] = {
			type: 'button',
			category: '1. Top Button Grid (Channel Arm & Telemetry)',
			name: `Ch ${ch} (${entry.label}) Arm & Telemetry`,
			style: {
				text: `$(lynx-network:ch_${ch}_name)\nNL:$(lynx-network:ch_${ch}_nexlink)`,
				size: '14',
				color: COLORS.WHITE,
				bgcolor: COLORS.GREEN_OK,
			},
			steps: [
				{
					down: [
						{
							actionId: 'setActiveChannel',
							options: {
								chan_id: ch,
								toggleIfAlreadyArmed: true,
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'channelHealthStatus',
					options: {
						chan_id: ch,
					},
				},
			],
		}
	}

	// 2. Clear Armed Channel (Return to Mode A Comms)
	presets['clear_armed_channel'] = {
		type: 'button',
		category: '2. Dual-Mode Panic Switch & Floor Pedal',
		name: 'Disarm All / Mode A (Comms PTT)',
		style: {
			text: 'CLEAR ARM\n$(lynx-network:panic_mode)',
			size: '14',
			color: COLORS.WHITE,
			bgcolor: COLORS.COMMS_BLUE,
		},
		steps: [
			{
				down: [
					{
						actionId: 'clearArmedChannel',
						options: {},
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'panicModeIndicator',
				options: { chan_id: 0 },
				style: {
					bgcolor: COLORS.ARMED_AMBER_FLASH,
					color: COLORS.BLACK,
				},
			},
		],
	}

	// 3. Momentary Floor Sustain / Foot-Switch Trigger
	presets['smart_floor_pedal'] = {
		type: 'button',
		category: '2. Dual-Mode Panic Switch & Floor Pedal',
		name: 'Momentary Smart Foot-Switch (Stomp)',
		style: {
			text: 'FOOT PEDAL\nTARGET: $(lynx-network:active_panic_target)\n$(lynx-network:pedal_state)',
			size: '14',
			color: COLORS.WHITE,
			bgcolor: COLORS.SLATE_DARK,
		},
		steps: [
			{
				down: [
					{
						actionId: 'executeSmartPedalStomp',
						options: {
							boolean_isPressed: true,
						},
					},
				],
				up: [
					{
						actionId: 'executeSmartPedalStomp',
						options: {
							boolean_isPressed: false,
						},
					},
				],
			},
		],
		feedbacks: [
			{
				feedbackId: 'pedalStompActive',
				options: {},
				style: {
					bgcolor: COLORS.RED_CLIP,
					color: COLORS.WHITE,
				},
			},
		],
	}

	// 4. Stream Deck + 4x Rotary Encoder Dials & LCD Touch Strip
	presets['dial_1_ota_gain'] = {
		type: 'button',
		category: '3. Stream Deck + Rotary Encoders & LCD Strip',
		name: 'Dial 1: OTA Transmit Gain (NexLink)',
		options: {
			rotaryActions: true,
		},
		style: {
			text: 'DIAL 1: NEXLINK\n$(lynx-network:lcd_strip_headline)\n$(lynx-network:dial1_ota_gain)',
			size: '14',
			color: COLORS.WHITE,
			bgcolor: COLORS.SLATE_DARK,
		},
		steps: [
			{
				down: [],
				up: [],
				rotate_left: [
					{
						actionId: 'dial1_ota_tx_gain',
						options: { delta: -1 },
					},
				],
				rotate_right: [
					{
						actionId: 'dial1_ota_tx_gain',
						options: { delta: 1 },
					},
				],
			},
		],
		feedbacks: [],
	}

	presets['dial_2_s21_trim'] = {
		type: 'button',
		category: '3. Stream Deck + Rotary Encoders & LCD Strip',
		name: 'Dial 2: S21 Input Trim',
		options: {
			rotaryActions: true,
		},
		style: {
			text: 'DIAL 2: S21 TRIM\nCH $(lynx-network:focused_channel)\n$(lynx-network:dial2_s21_trim)',
			size: '14',
			color: COLORS.WHITE,
			bgcolor: COLORS.SLATE_DARK,
		},
		steps: [
			{
				down: [],
				up: [],
				rotate_left: [
					{
						actionId: 'dial2_s21_input_trim',
						options: { delta: -0.5 },
					},
				],
				rotate_right: [
					{
						actionId: 'dial2_s21_input_trim',
						options: { delta: 0.5 },
					},
				],
			},
		],
		feedbacks: [],
	}

	presets['dial_3_aux_iem'] = {
		type: 'button',
		category: '3. Stream Deck + Rotary Encoders & LCD Strip',
		name: 'Dial 3: Musician Aux IEM Send',
		options: {
			rotaryActions: true,
		},
		style: {
			text: 'DIAL 3: IEM AUX\n$(lynx-network:lcd_strip_nexlink)\n$(lynx-network:dial3_aux_iem)',
			size: '14',
			color: COLORS.WHITE,
			bgcolor: COLORS.SLATE_DARK,
		},
		steps: [
			{
				down: [],
				up: [],
				rotate_left: [
					{
						actionId: 'dial3_musician_aux_iem',
						options: { delta: -1.0 },
					},
				],
				rotate_right: [
					{
						actionId: 'dial3_musician_aux_iem',
						options: { delta: 1.0 },
					},
				],
			},
		],
		feedbacks: [],
	}

	presets['dial_4_monitor_cue'] = {
		type: 'button',
		category: '3. Stream Deck + Rotary Encoders & LCD Strip',
		name: 'Dial 4: Local Monitor Solo / Cue Volume',
		options: {
			rotaryActions: true,
		},
		style: {
			text: 'DIAL 4: CUE VOL\n$(lynx-network:panic_mode)\n$(lynx-network:dial4_monitor_cue)',
			size: '14',
			color: COLORS.WHITE,
			bgcolor: COLORS.SLATE_DARK,
		},
		steps: [
			{
				down: [],
				up: [],
				rotate_left: [
					{
						actionId: 'dial4_local_monitor_cue',
						options: { delta: -1.0 },
					},
				],
				rotate_right: [
					{
						actionId: 'dial4_local_monitor_cue',
						options: { delta: 1.0 },
					},
				],
			},
		],
		feedbacks: [],
	}

	return presets
}

