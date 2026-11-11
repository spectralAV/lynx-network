import { MixingStationEndpoint } from './config'
import { DecodedOscMessage, OscArgument } from './osc'

export interface TabletAclEvaluation {
	/** Whether the OSC packet should be forwarded to the DiGiCo S21 Console */
	allowed: boolean
	/** Reason if blocked or translated */
	reason: string
	/** Normalized S21 OSC address (in case the tablet used a `/MixingStation/bus/...` alias) */
	targetAddress: string
	/** Normalized OSC arguments */
	targetArgs: OscArgument[]
	/** Parsed S21 Input Channel if applicable */
	s21Channel?: number
	/** Parsed Aux Bus ID if applicable */
	auxBus?: number
}

export interface MixingStationPolicyOptions {
	/** When true (default), stage tablets without `@foh` role can only modify Aux IEM sends & request state sync */
	restrictTabletsToIemBuses: boolean
	/** FOH Talkback Channel ID (default 48) protected from stage tablets */
	talkbackChannel: number
	/** Tech Comms Matrix Channel ID (default 1) protected from stage tablets */
	techMatrixChannel: number
}

/**
 * Mixing Station Stage Tablet Session Manager & FOH Safety Firewall (`src/mixing-station.ts`).
 *
 * Solves two critical Pro-AV touring problems when deploying Mixing Station (Generic OSC profile)
 * alongside a DiGiCo S21 Console and Sound Devices Astral RF rack:
 *
 * 1. **Single-Socket Multiplexing & Late-Join Snapshot Sync**:
 *    Multiple musician tablets connect to Lynx Network's UDP proxy (`:8001`). When a tablet sends
 *    `/hi` or `/MixingStation/sync` (or first transmits), Lynx Network immediately pushes the full
 *    cached console & RF telemetry snapshot to that tablet.
 *
 * 2. **Per-Musician Aux Bus ACL & Mode B Panic-Lock Guard**:
 *    - Prevents stage musicians from accidentally altering FOH main faders, input trims, FOH Talkback
 *      (Ch 48), or Tech Comms Matrix 1.
 *    - Supports pinning a tablet IP to a specific Aux IEM bus (`192.168.1.51:9000@aux1`) or granting
 *      rover FOH engineer privileges (`192.168.1.99:9000@foh`).
 *    - Enforces a hard **Panic-Lock Guard**: while FOH is holding the floor pedal in Mode B Panic on
 *      Channel `X`, no remote tablet can unmute Channel `X` into the main PA.
 */
export class MixingStationSessionManager {
	private endpoints: Map<string, MixingStationEndpoint> = new Map()
	private policy: MixingStationPolicyOptions

	constructor(endpoints: MixingStationEndpoint[], policy: MixingStationPolicyOptions) {
		this.policy = policy
		for (const ep of endpoints) {
			this.endpoints.set(`${ep.host}:${ep.port}`, ep)
		}
	}

	public updateEndpoints(endpoints: MixingStationEndpoint[], policy: MixingStationPolicyOptions): void {
		this.policy = policy
		this.endpoints.clear()
		for (const ep of endpoints) {
			this.endpoints.set(`${ep.host}:${ep.port}`, ep)
		}
	}

	/**
	 * Looks up the configured endpoint policy for a remote tablet (`host:port` or matching `host`).
	 */
	public getEndpointConfig(host: string, port: number): MixingStationEndpoint | undefined {
		const exact = this.endpoints.get(`${host}:${port}`)
		if (exact) return exact
		for (const ep of this.endpoints.values()) {
			if (ep.host === host) return ep
		}
		return undefined
	}

	/**
	 * Evaluates an incoming OSC command from a Mixing Station client against:
	 * 1. Mode B Panic-Lock Guard (`activePanicTarget` + `pedalPressed`)
	 * 2. FOH Talkback / Tech Matrix Protection
	 * 3. Per-Musician Aux IEM Bus Pinning (`allowedAuxBus`) & Restricted IEM-Only Firewall
	 * 4. `/MixingStation/bus/{aux}/ch/{ch}/level` convenience alias translation
	 */
	public evaluateClientPacket(
		msg: DecodedOscMessage,
		senderHost: string,
		senderPort: number,
		activePanicTarget: number | null,
		pedalPressed: boolean
	): TabletAclEvaluation {
		const { address, args } = msg
		const endpointCfg = this.getEndpointConfig(senderHost, senderPort)
		const isFohTablet = endpointCfg?.role === 'foh'
		const pinnedAux = endpointCfg?.allowedAuxBus

		// 1. Check if this is a Mixing Station handshake / state snapshot sync request
		if (address === '/hi' || address === '/MixingStation/sync' || address === '/MixingStation/ping') {
			return {
				allowed: false,
				reason: 'SYNC_REQUEST',
				targetAddress: address,
				targetArgs: args,
			}
		}

		// 2. Translate Mixing Station convenience alias: /MixingStation/bus/{aux}/ch/{ch}/level -> /Input_Channels/{ch}/Aux_Send/{aux}/level
		let effectiveAddress = address
		const aliasMatch = address.match(/^\/MixingStation\/bus\/(\d+)\/ch\/(\d+)\/(level|mute|pan)$/)
		if (aliasMatch) {
			const auxId = Number(aliasMatch[1])
			const chId = Number(aliasMatch[2])
			const param = aliasMatch[3]
			effectiveAddress = `/Input_Channels/${chId}/Aux_Send/${auxId}/${param}`
		}

		// 3. Hard Safety Rule: Mode B Panic-Lock Guard (applies to ALL remote clients, even @foh rover tablets)
		const chMuteMatch = effectiveAddress.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/mute$/)
		if (chMuteMatch) {
			const targetCh = Number(chMuteMatch[1])
			if (activePanicTarget !== null && pedalPressed && targetCh === activePanicTarget) {
				const requestedVal = Number(args[0]?.value ?? 0)
				if (requestedVal === 0) {
					return {
						allowed: false,
						reason: `BLOCKED_BY_PANIC_LOCK: Channel ${targetCh} is actively muted by FOH Panic Pedal`,
						targetAddress: effectiveAddress,
						targetArgs: args,
						s21Channel: targetCh,
					}
				}
			}

			// Protect FOH Talkback Channel (Ch 48 default) from non-FOH tablets
			if (!isFohTablet && targetCh === this.policy.talkbackChannel) {
				return {
					allowed: false,
					reason: `BLOCKED_FOH_TALKBACK: Stage tablets cannot modify FOH Talkback Ch ${this.policy.talkbackChannel}`,
					targetAddress: effectiveAddress,
					targetArgs: args,
					s21Channel: targetCh,
				}
			}
		}

		// 4. Protect Tech Comms Matrix 1 during active Panic or from non-FOH tablets
		const matrixMatch = effectiveAddress.match(/^\/Matrix_Channels\/(\d+)\/Channel_Input\/mute$/)
		if (matrixMatch) {
			const mtxId = Number(matrixMatch[1])
			if (mtxId === this.policy.techMatrixChannel && (!isFohTablet || (activePanicTarget !== null && pedalPressed))) {
				return {
					allowed: false,
					reason: `BLOCKED_TECH_MATRIX: Matrix ${mtxId} is managed by FOH Dual-Mode Panic Engine`,
					targetAddress: effectiveAddress,
					targetArgs: args,
				}
			}
		}

		// 5. Check Aux Send adjustments: /Input_Channels/{ch}/Aux_Send/{aux}/{level|mute|pan}
		const auxSendMatch = effectiveAddress.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/(level|mute|pan)$/)
		if (auxSendMatch) {
			const chId = Number(auxSendMatch[1])
			const auxId = Number(auxSendMatch[2])

			if (!isFohTablet && pinnedAux !== undefined && auxId !== pinnedAux) {
				return {
					allowed: false,
					reason: `BLOCKED_AUX_ACL: Tablet ${senderHost} is pinned to Aux Bus ${pinnedAux} (attempted Aux ${auxId})`,
					targetAddress: effectiveAddress,
					targetArgs: args,
					s21Channel: chId,
					auxBus: auxId,
				}
			}

			return {
				allowed: true,
				reason: 'ALLOWED_AUX_SEND',
				targetAddress: effectiveAddress,
				targetArgs: args,
				s21Channel: chId,
				auxBus: auxId,
			}
		}

		// 6. Check Aux Master output level: /Aux_Outputs/{aux}/level
		const auxMasterMatch = effectiveAddress.match(/^\/Aux_Outputs\/(\d+)\/(level|mute)$/)
		if (auxMasterMatch) {
			const auxId = Number(auxMasterMatch[1])
			if (!isFohTablet && pinnedAux !== undefined && auxId !== pinnedAux) {
				return {
					allowed: false,
					reason: `BLOCKED_AUX_MASTER_ACL: Tablet ${senderHost} is pinned to Aux Bus ${pinnedAux}`,
					targetAddress: effectiveAddress,
					targetArgs: args,
					auxBus: auxId,
				}
			}
			return {
				allowed: true,
				reason: 'ALLOWED_AUX_MASTER',
				targetAddress: effectiveAddress,
				targetArgs: args,
				auxBus: auxId,
			}
		}

		// 7. Non-Aux console parameters (FOH Main Faders, Input Trim, EQ, etc.)
		if (this.policy.restrictTabletsToIemBuses && !isFohTablet) {
			return {
				allowed: false,
				reason: `BLOCKED_FOH_PARAMETER: Stage tablet restricted to Aux IEM sends (${effectiveAddress})`,
				targetAddress: effectiveAddress,
				targetArgs: args,
			}
		}

		return {
			allowed: true,
			reason: 'ALLOWED_FOH_ROVER',
			targetAddress: effectiveAddress,
			targetArgs: args,
		}
	}
}
