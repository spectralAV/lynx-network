import { Regex, SomeCompanionConfigField } from '@companion-module/base'

export type WirelessProtocolType = 'astral_ws' | 'shure_axient_tcp' | 'sennheiser_d6000_udp'

export interface ChannelMappingEntry {
	/** Wireless Receiver Channel ID (1-based, e.g. Astral RX channel 1..16) */
	rxId: number
	/** DiGiCo S21 Input Channel / Fader ID (1-based, e.g. 1..48) */
	s21Channel: number
	/** Base Channel Name Tag (e.g. "VOX1", "VOX2", "GTR1", "BASS") */
	label: string
	/** Musician Aux IEM Send Bus Index on S21 (1-based, controlled by Rotary Dial 3) */
	auxSend: number
	/** Optional Stream Deck + XL Grid Slot Index (1..32) */
	gridSlot?: number
}

export interface MixingStationEndpoint {
	host: string
	port: number
}

export interface ModuleConfig {
	s21Host: string
	s21Port: number
	proxyListenPort: number
	astralHost: string
	astralPort: number
	wirelessProtocol: WirelessProtocolType
	mixingStationClients: string
	channelMapJson: string
	talkbackChannel: number
	techMatrixChannel: number
	maxNameLength: number
	lowBatteryThreshold: number
	criticalBatteryThreshold: number
}

export const DEFAULT_CHANNEL_MAP: ChannelMappingEntry[] = [
	{ rxId: 1, s21Channel: 1, label: 'VOX1', auxSend: 1, gridSlot: 1 },
	{ rxId: 2, s21Channel: 2, label: 'VOX2', auxSend: 2, gridSlot: 2 },
	{ rxId: 3, s21Channel: 3, label: 'VOX3', auxSend: 3, gridSlot: 3 },
	{ rxId: 4, s21Channel: 4, label: 'GTR1', auxSend: 4, gridSlot: 4 },
	{ rxId: 5, s21Channel: 5, label: 'BASS', auxSend: 5, gridSlot: 5 },
	{ rxId: 6, s21Channel: 6, label: 'HORN', auxSend: 6, gridSlot: 6 },
	{ rxId: 7, s21Channel: 7, label: 'HOST', auxSend: 7, gridSlot: 7 },
	{ rxId: 8, s21Channel: 8, label: 'SPARE', auxSend: 8, gridSlot: 8 },
]

export const DEFAULT_CONFIG: ModuleConfig = {
	s21Host: '127.0.0.1',
	s21Port: 8000,
	proxyListenPort: 8001,
	astralHost: '127.0.0.1',
	astralPort: 8080,
	wirelessProtocol: 'astral_ws',
	mixingStationClients: '127.0.0.1:9000',
	channelMapJson: JSON.stringify(DEFAULT_CHANNEL_MAP, null, 2),
	talkbackChannel: 48,
	techMatrixChannel: 1,
	maxNameLength: 12,
	lowBatteryThreshold: 20,
	criticalBatteryThreshold: 10,
}

/**
 * Parses the visual Channel-to-Fader JSON/Grid mapping index from configuration.
 * Supports either an array of ChannelMappingEntry objects or an object keyed by RX ID.
 */
export function parseChannelMapping(rawJson: string | undefined): ChannelMappingEntry[] {
	if (!rawJson || !rawJson.trim()) {
		return [...DEFAULT_CHANNEL_MAP]
	}

	try {
		const parsed = JSON.parse(rawJson)
		if (Array.isArray(parsed)) {
			const validEntries: ChannelMappingEntry[] = []
			for (const item of parsed) {
				if (item && typeof item === 'object') {
					const rxId = Number(item.rxId ?? item.astralChannel ?? item.id ?? 1)
					const s21Channel = Number(item.s21Channel ?? item.fader ?? rxId)
					const label = String(item.label ?? item.name ?? `CH${s21Channel}`).trim()
					const auxSend = Number(item.auxSend ?? item.aux ?? s21Channel)
					const gridSlot = item.gridSlot !== undefined ? Number(item.gridSlot) : rxId
					if (Number.isFinite(rxId) && Number.isFinite(s21Channel)) {
						validEntries.push({ rxId, s21Channel, label, auxSend, gridSlot })
					}
				}
			}
			return validEntries.length > 0 ? validEntries : [...DEFAULT_CHANNEL_MAP]
		} else if (parsed && typeof parsed === 'object') {
			const entries: ChannelMappingEntry[] = []
			for (const [key, val] of Object.entries(parsed)) {
				const rxId = Number(key)
				if (!Number.isFinite(rxId)) continue
				if (typeof val === 'number') {
					entries.push({
						rxId,
						s21Channel: val,
						label: `CH${val}`,
						auxSend: val,
						gridSlot: rxId,
					})
				} else if (val && typeof val === 'object') {
					const record = val as Record<string, unknown>
					const s21Channel = Number(record.s21Channel ?? record.fader ?? rxId)
					const label = String(record.label ?? record.name ?? `CH${s21Channel}`).trim()
					const auxSend = Number(record.auxSend ?? record.aux ?? s21Channel)
					const gridSlot = record.gridSlot !== undefined ? Number(record.gridSlot) : rxId
					entries.push({ rxId, s21Channel, label, auxSend, gridSlot })
				}
			}
			return entries.length > 0 ? entries : [...DEFAULT_CHANNEL_MAP]
		}
	} catch {
		// Fall back safely to default mapping if user JSON is mid-edit or malformed
	}

	return [...DEFAULT_CHANNEL_MAP]
}

/**
 * Parses comma-separated or JSON list of Mixing Station tablet endpoints (e.g. "192.168.1.50:9000, 192.168.1.51:9000")
 */
export function parseMixingStationEndpoints(raw: string | undefined): MixingStationEndpoint[] {
	if (!raw || !raw.trim()) {
		return []
	}

	const trimmed = raw.trim()
	if (trimmed.startsWith('[')) {
		try {
			const arr = JSON.parse(trimmed)
			if (Array.isArray(arr)) {
				return arr
					.map((entry) => {
						if (typeof entry === 'string') {
							return parseSingleEndpoint(entry)
						}
						if (entry && typeof entry === 'object' && typeof entry.host === 'string') {
							return {
								host: entry.host.trim(),
								port: Number(entry.port) || 9000,
							}
						}
						return null
					})
					.filter((x): x is MixingStationEndpoint => x !== null)
			}
		} catch {
			// Fall through to comma-separated parser
		}
	}

	return trimmed
		.split(/[,;\n]+/)
		.map((part) => parseSingleEndpoint(part))
		.filter((x): x is MixingStationEndpoint => x !== null)
}

function parseSingleEndpoint(token: string): MixingStationEndpoint | null {
	const cleaned = token.trim()
	if (!cleaned) return null
	const [hostPart, portPart] = cleaned.split(':')
	const host = hostPart?.trim()
	if (!host) return null
	const port = portPart ? Number(portPart.trim()) : 9000
	return {
		host,
		port: Number.isFinite(port) && port > 0 && port <= 65535 ? port : 9000,
	}
}

/**
 * Exposes Companion v3 GUI Configuration Fields
 */
export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info_header',
			width: 12,
			label: 'Network Broker & Hardware Endpoints',
			value:
				'Configures the single-socket UDP OSC proxy to the DiGiCo S21 Console, the inbound Sound Devices Astral WebSocket telemetry client, and outbound Mixing Station stage tablet relays.',
		},
		{
			type: 'textinput',
			id: 's21Host',
			label: 'DiGiCo S21 Console IP Address',
			width: 8,
			default: DEFAULT_CONFIG.s21Host,
			regex: Regex.IP,
		},
		{
			type: 'number',
			id: 's21Port',
			label: 'DiGiCo S21 UDP OSC Port (Default: 8000)',
			width: 4,
			default: DEFAULT_CONFIG.s21Port,
			min: 1,
			max: 65535,
		},
		{
			type: 'number',
			id: 'proxyListenPort',
			label: 'Local Multi-Client OSC Proxy Listen Port (Intercepts Mixing Station / Remote Decks)',
			width: 6,
			default: DEFAULT_CONFIG.proxyListenPort,
			min: 1024,
			max: 65535,
		},
		{
			type: 'dropdown',
			id: 'wirelessProtocol',
			label: 'Wireless Telemetry Receiver Driver',
			width: 6,
			default: DEFAULT_CONFIG.wirelessProtocol,
			choices: [
				{ id: 'astral_ws', label: 'Sound Devices Astral (A20-Nexus / ARX32) — WebSocket JSON' },
				{ id: 'shure_axient_tcp', label: 'Shure Axient Digital — Telnet TCP (Abstract Driver)' },
				{ id: 'sennheiser_d6000_udp', label: 'Sennheiser Digital 6000 — UDP (Abstract Driver)' },
			],
		},
		{
			type: 'textinput',
			id: 'astralHost',
			label: 'Sound Devices Astral Receiver IP Address',
			width: 8,
			default: DEFAULT_CONFIG.astralHost,
			regex: Regex.IP,
		},
		{
			type: 'number',
			id: 'astralPort',
			label: 'Sound Devices Astral WebSocket Port',
			width: 4,
			default: DEFAULT_CONFIG.astralPort,
			min: 1,
			max: 65535,
		},
		{
			type: 'textinput',
			id: 'mixingStationClients',
			label: 'Mixing Station Stage Tablet IPs (Comma-separated IP:Port list)',
			width: 12,
			default: DEFAULT_CONFIG.mixingStationClients,
		},
		{
			type: 'textinput',
			id: 'channelMapJson',
			label: 'Visual Channel-to-Fader JSON / Grid Mapping Index',
			width: 12,
			default: DEFAULT_CONFIG.channelMapJson,
		},
		{
			type: 'number',
			id: 'talkbackChannel',
			label: 'FOH Talkback Console Input Channel (Mode A Comms PTT)',
			width: 4,
			default: DEFAULT_CONFIG.talkbackChannel,
			min: 1,
			max: 128,
		},
		{
			type: 'number',
			id: 'techMatrixChannel',
			label: 'Tech / Comms Matrix Channel (Mode B Panic Routing)',
			width: 4,
			default: DEFAULT_CONFIG.techMatrixChannel,
			min: 1,
			max: 32,
		},
		{
			type: 'number',
			id: 'maxNameLength',
			label: 'S21 Channel Name Max Characters (Restricted Slicing)',
			width: 4,
			default: DEFAULT_CONFIG.maxNameLength,
			min: 6,
			max: 24,
		},
		{
			type: 'number',
			id: 'lowBatteryThreshold',
			label: 'Low Battery Warning Threshold % (Amber = Color 5)',
			width: 6,
			default: DEFAULT_CONFIG.lowBatteryThreshold,
			min: 5,
			max: 50,
		},
		{
			type: 'number',
			id: 'criticalBatteryThreshold',
			label: 'Critical Battery Alert Threshold % (Red = Color 6)',
			width: 6,
			default: DEFAULT_CONFIG.criticalBatteryThreshold,
			min: 1,
			max: 30,
		},
	]
}

