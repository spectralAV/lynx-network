import { CompanionVariableDefinition, CompanionVariableValues } from '@companion-module/base'
import type { DiGiCoAstralOrchestratorInstance } from './main'

export function GetVariableDefinitions(instance: DiGiCoAstralOrchestratorInstance): CompanionVariableDefinition[] {
	const vars: CompanionVariableDefinition[] = [
		{ variableId: 'panic_mode', name: 'Active Panic Engine Mode (COMMS_MODE_A or PANIC_MODE_B)' },
		{ variableId: 'active_panic_target', name: 'Armed Panic Target S21 Channel ID (or NONE)' },
		{ variableId: 'pedal_state', name: 'Floor Foot-Switch State (PRESSED or RELEASED)' },
		{ variableId: 'focused_channel', name: 'Focused S21 Channel ID for LCD Strip & Rotary Dials' },
		{ variableId: 'lcd_strip_headline', name: 'LCD Touch Strip: Focused Channel Name & Health Readout' },
		{ variableId: 'lcd_strip_nexlink', name: 'LCD Touch Strip: Focused NexLink & RF Telemetry Readout' },
		{ variableId: 'dial1_ota_gain', name: 'Dial 1 Readout: OTA Transmit Gain (NexLink dB)' },
		{ variableId: 'dial2_s21_trim', name: 'Dial 2 Readout: S21 Input Trim (dB)' },
		{ variableId: 'dial3_aux_iem', name: 'Dial 3 Readout: Musician Aux IEM Send Level (dB)' },
		{ variableId: 'dial4_monitor_cue', name: 'Dial 4 Readout: Local Monitor Solo / Cue Volume (dB)' },
	]

	for (const entry of instance.channelMapping) {
		const ch = entry.s21Channel
		vars.push(
			{ variableId: `ch_${ch}_name`, name: `S21 Ch ${ch} Formatted Scribble Name` },
			{ variableId: `ch_${ch}_battery`, name: `S21 Ch ${ch} Astral Battery %` },
			{ variableId: `ch_${ch}_clip`, name: `S21 Ch ${ch} Clip State` },
			{ variableId: `ch_${ch}_color`, name: `S21 Ch ${ch} S-Series Color Index (2=Green, 5=Amber, 6=Red)` },
			{ variableId: `ch_${ch}_nexlink`, name: `S21 Ch ${ch} NexLink Quality %` }
		)
	}

	return vars
}

export function BuildVariableValues(instance: DiGiCoAstralOrchestratorInstance): CompanionVariableValues {
	const focused = instance.getChannelState(instance.focusedChannel)
	const isModeB = instance.activePanicTarget !== null

	const values: CompanionVariableValues = {
		panic_mode: isModeB ? `PANIC_MODE_B (CH ${instance.activePanicTarget})` : 'COMMS_MODE_A (TB CH 48)',
		active_panic_target: instance.activePanicTarget !== null ? String(instance.activePanicTarget) : 'NONE',
		pedal_state: instance.pedalPressed ? 'PRESSED' : 'RELEASED',
		focused_channel: String(instance.focusedChannel),
		lcd_strip_headline: `${focused.s21DisplayName} ${focused.clip ? '[CLIP!]' : '[OK]'}`,
		lcd_strip_nexlink: `NL:${focused.nexLinkQuality}% RF:${focused.rfRssi}dBm`,
		dial1_ota_gain: `${focused.otaTxGainDb >= 0 ? '+' : ''}${focused.otaTxGainDb.toFixed(1)} dB`,
		dial2_s21_trim: `${focused.s21TrimDb >= 0 ? '+' : ''}${focused.s21TrimDb.toFixed(1)} dB`,
		dial3_aux_iem: `${focused.auxIemSendDb >= 0 ? '+' : ''}${focused.auxIemSendDb.toFixed(1)} dB`,
		dial4_monitor_cue: `${instance.localMonitorCueDb >= 0 ? '+' : ''}${instance.localMonitorCueDb.toFixed(1)} dB`,
	}

	for (const entry of instance.channelMapping) {
		const st = instance.getChannelState(entry.s21Channel)
		values[`ch_${entry.s21Channel}_name`] = st.s21DisplayName
		values[`ch_${entry.s21Channel}_battery`] = `${st.batteryPercent}%`
		values[`ch_${entry.s21Channel}_clip`] = st.clip ? 'CLIP' : 'OK'
		values[`ch_${entry.s21Channel}_color`] = st.s21ColorCode
		values[`ch_${entry.s21Channel}_nexlink`] = `${st.nexLinkQuality}%`
	}

	return values
}

