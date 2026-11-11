import { combineRgb, CompanionFeedbackDefinitions } from '@companion-module/base'
import type { DiGiCoAstralOrchestratorInstance } from './main'

export const COLORS = {
	GREEN_OK: combineRgb(0, 180, 75),
	AMBER_WARN: combineRgb(245, 158, 11),
	RED_CLIP: combineRgb(220, 38, 38),
	DARK_RED_FLASH: combineRgb(70, 10, 10),
	ARMED_AMBER_FLASH: combineRgb(255, 191, 0),
	COMMS_BLUE: combineRgb(37, 99, 235),
	SLATE_DARK: combineRgb(30, 41, 59),
	WHITE: combineRgb(255, 255, 255),
	BLACK: combineRgb(0, 0, 0),
}

export function GetFeedbacksList(instance: DiGiCoAstralOrchestratorInstance): CompanionFeedbackDefinitions {
	return {
		channelHealthStatus: {
			type: 'advanced',
			name: 'Grid Key: Wireless Telemetry & Panic Alert Color (Green / Amber / Flashing Red)',
			description:
				'Colors Stream Deck + XL channel keys: Green = operational, Amber = low battery (<20%), Flashing Red = capsule/transmitter clipping or active Panic stomp.',
			options: [
				{
					type: 'number',
					id: 'chan_id',
					label: 'S21 Input Channel ID',
					default: 1,
					min: 1,
					max: 128,
				},
			],
			callback: (feedback) => {
				const chanId = Number(feedback.options.chan_id ?? 1)
				const state = instance.getChannelState(chanId)
				const isArmed = instance.activePanicTarget === chanId
				const isPanicking = isArmed && instance.pedalPressed

				// Active Panic Mode stomp: Flash Amber / Red outline & background
				if (isPanicking) {
					return {
						bgcolor: instance.flashPhase ? COLORS.RED_CLIP : COLORS.ARMED_AMBER_FLASH,
						color: instance.flashPhase ? COLORS.WHITE : COLORS.BLACK,
						text: `🚨 PANIC MUTE\n${state.s21DisplayName}\nMATRIX 1 ON`,
					}
				}

				// Capsule or Transmitter Clipping State: Flashing Red
				if (state.clip) {
					return {
						bgcolor: instance.flashPhase ? COLORS.RED_CLIP : COLORS.DARK_RED_FLASH,
						color: COLORS.WHITE,
						text: `${isArmed ? '🎯 ' : ''}CLIP! ${state.baseLabel}\nBATT ${state.batteryPercent}%`,
					}
				}

				// Armed for Panic Mode (Ready state): Highlighted Amber/Red border cue
				if (isArmed) {
					return {
						bgcolor: instance.flashPhase ? COLORS.ARMED_AMBER_FLASH : COLORS.AMBER_WARN,
						color: COLORS.BLACK,
						text: `🎯 ARMED: ${state.baseLabel}\n${state.batteryPercent}% | NL:${state.nexLinkQuality}%`,
					}
				}

				// Low Battery Warning (< 20%): Solid Amber (S21 Color 5)
				if (state.batteryPercent < instance.config.lowBatteryThreshold) {
					return {
						bgcolor: COLORS.AMBER_WARN,
						color: COLORS.BLACK,
						text: `⚠️ ${state.s21DisplayName}\nLOW BATT`,
					}
				}

				// Normal Operational State: Green (S21 Color 2)
				return {
					bgcolor: COLORS.GREEN_OK,
					color: COLORS.WHITE,
					text: `${state.s21DisplayName}\nNL:${state.nexLinkQuality}%`,
				}
			},
		},

		panicModeIndicator: {
			type: 'boolean',
			name: 'System: Channel Is Armed for Panic Mode B',
			description: 'True when activePanicTarget matches the specified channel ID (or any channel if chan_id = 0).',
			defaultStyle: {
				bgcolor: COLORS.ARMED_AMBER_FLASH,
				color: COLORS.BLACK,
			},
			options: [
				{
					type: 'number',
					id: 'chan_id',
					label: 'S21 Channel ID (0 = Any Channel Armed)',
					default: 0,
					min: 0,
					max: 128,
				},
			],
			callback: (feedback) => {
				const target = Number(feedback.options.chan_id ?? 0)
				if (target === 0) {
					return instance.activePanicTarget !== null
				}
				return instance.activePanicTarget === target
			},
		},

		pedalStompActive: {
			type: 'boolean',
			name: 'Floor Pedal: Momentary Foot-Switch Is Pressed',
			description: 'True while the floor sustain/foot-switch is actively stomped down.',
			defaultStyle: {
				bgcolor: COLORS.RED_CLIP,
				color: COLORS.WHITE,
			},
			options: [],
			callback: () => {
				return instance.pedalPressed
			},
		},
	}
}

