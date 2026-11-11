import { EventEmitter } from 'node:events'

export type PedalPolarity = 'normal' | 'inverted'

export interface SmartPedalControllerOptions {
	/** MIDI Control Change number for sustain pedal (Default: 64 / 0x40 Damper Pedal) */
	midiCcNumber?: number
	/** Guitar sustain pedal polarity: 'normal' (CC >= 64 is pressed) or 'inverted' (NC switch where CC < 64 is pressed) */
	polarity?: PedalPolarity
	/** Contact debounce window in milliseconds (Default: 15ms) */
	debounceMs?: number
	/** Callback invoked whenever validated pedal state transitions */
	onPedalChange?: (isPressed: boolean) => void
}

/**
 * Floor Hardware Control Engine (`src/pedal.ts`):
 * Handles physical momentary guitar sustain / foot-switch inputs connected to the host via:
 *  1. USB-MIDI (Control Change CC64 Damper/Sustain pedal or MIDI Note On/Off foot controllers)
 *  2. USB-HID Keyboard Emulation (key-down / key-up events)
 * Includes configurable N/O vs N/C polarity inversion and mechanical contact debounce protection.
 */
export class SmartPedalHardwareController extends EventEmitter {
	private midiCcNumber: number
	private polarity: PedalPolarity
	private debounceMs: number
	private onPedalChange?: (isPressed: boolean) => void
	private currentPressed = false
	private lastTransitionTime = 0

	constructor(options: SmartPedalControllerOptions = {}) {
		super()
		this.midiCcNumber = options.midiCcNumber ?? 64
		this.polarity = options.polarity ?? 'normal'
		this.debounceMs = options.debounceMs ?? 15
		this.onPedalChange = options.onPedalChange
	}

	/**
	 * Parses a raw 3-byte MIDI message `[status, data1, data2]` from a USB-MIDI foot-switch interface.
	 * - Control Change (`0xB0..0xBF`): checks if `data1 === midiCcNumber` (default CC 64 sustain).
	 * - Note On (`0x90..0x9F`) / Note Off (`0x80..0x8F`): maps velocity > 0 to pressed.
	 */
	public handleMidiMessage(bytes: Uint8Array | number[]): boolean | null {
		if (!bytes || bytes.length < 3) return null
		const statusType = bytes[0] & 0xf0
		const data1 = bytes[1] & 0x7f
		const data2 = bytes[2] & 0x7f

		let rawPressed: boolean | null = null

		if (statusType === 0xb0 && data1 === this.midiCcNumber) {
			// MIDI CC 64 Sustain Pedal: >= 64 = Down, < 64 = Up
			rawPressed = data2 >= 64
		} else if (statusType === 0x90) {
			// MIDI Note On (velocity 0 is Note Off per MIDI 1.0 spec)
			rawPressed = data2 > 0
		} else if (statusType === 0x80) {
			// MIDI Note Off
			rawPressed = false
		}

		if (rawPressed === null) return null

		const effectivePressed = this.polarity === 'inverted' ? !rawPressed : rawPressed
		return this.commitPedalState(effectivePressed)
	}

	/**
	 * Processes a USB Keyboard Emulation foot-switch key-down (`true`) or key-up (`false`) event.
	 * Ignores OS typematic key-repeat events when the pedal is already held down.
	 */
	public handleKeyboardEvent(isKeyDown: boolean): boolean {
		const effectivePressed = this.polarity === 'inverted' ? !isKeyDown : Boolean(isKeyDown)
		return this.commitPedalState(effectivePressed)
	}

	private commitPedalState(nextPressed: boolean): boolean {
		const now = Date.now()
		if (nextPressed === this.currentPressed) {
			return this.currentPressed
		}
		if (this.debounceMs > 0 && now - this.lastTransitionTime < this.debounceMs) {
			return this.currentPressed
		}

		this.currentPressed = nextPressed
		this.lastTransitionTime = now
		this.emit('pedalChange', this.currentPressed)
		if (this.onPedalChange) {
			this.onPedalChange(this.currentPressed)
		}
		return this.currentPressed
	}

	public isPressed(): boolean {
		return this.currentPressed
	}

	public setPolarity(polarity: PedalPolarity): void {
		this.polarity = polarity
	}
}
