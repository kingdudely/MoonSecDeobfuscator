const
	textDecoder = new TextDecoder("utf-8"),
	textEncoder = new TextEncoder(); // Always UTF-8

const
	zigzagDecode = x =>
		typeof x === "bigint"
			? (x >> 1n) ^ -(x & 1n)
			: (x >> 1) ^ -(x & 1),

	zigzagEncode = x =>
		typeof x === "bigint"
			? (x << 1n) ^ (x >> 63n)
			: (x << 1) ^ (x >> 31) >>> 0;

const constructorFromArrayType = arrayType => ([BigInt64Array, BigUint64Array].includes(arrayType) ? BigInt : Number);

function decodeRobloxFloat(x) {
	const exponent = x >>> 24;
	if (exponent === 0) return 0;

	const float =
		Math.pow(2, exponent - 127) * (1 + ((x >>> 1) & 0x7fffff) / 0x7fffff);

	return x & 1 ? -float : float; // -1 : 1
};

function encodeRobloxFloat(x) {
	if (x === 0) return 0;

	const sign = x < 0 ? 1 : 0;
	x = Math.abs(x);

	let exponent = Math.floor(Math.log2(x));
	const
		mantissa = x / Math.pow(2, exponent) - 1,
		encodedMantissa = Math.round(mantissa * 0x7fffff);

	const floatBits = ((exponent + 127) << 24) | (encodedMantissa << 1) | sign;
	return floatBits >>> 0;
}

// alloc
export default class ByteEditor extends DataView {
	byteOffset = 0; // byteIndex

	constructor(buffer = new ArrayBuffer(0, { maxByteLength: 2 ** 31 - 1 })) {
		super(buffer);
		this.automaticResizing = buffer.resizable;
	};

	get bytesLeft() {
		return this.byteLength - this.byteOffset;
	};

	#readInterleaved(length, arrayType) { // deinterleave, uninterleave, byteAmount?
		const constructor = constructorFromArrayType(arrayType);

		const
			byteSize = arrayType.BYTES_PER_ELEMENT,
			bitsPerByte = constructor(8);

		const
			startOffset = this.byteOffset,
			endOffset = length * byteSize;

		return arrayType.from({ length }, (_, i) => {
			let value = constructor(0);

			for (let byteIndex = 0; byteIndex < byteSize; byteIndex++, this.byteOffset++) {
				const
					offset = startOffset + ((i + length * byteIndex) % endOffset),
					byte = super.getUint8(offset);

				// value = (value << byteSize) | constructor(byte);
				value <<= bitsPerByte;
				value |= constructor(byte);
			};

			return value;
		});
	};

	#writeInterleaved(values, arrayType) {
		const constructor = constructorFromArrayType(arrayType);

		const
			byteSize = arrayType.BYTES_PER_ELEMENT,
			bitsPerByte = constructor(8),
			byteMask = constructor(0xFF); // byteMax

		const { length } = values;

		const
			startOffset = this.byteOffset,
			endOffset = length * byteSize;

		for (let i = 0; i < length; i++) {
			let value = values[i];

			for (let byteIndex = byteSize - 1; byteIndex >= 0; byteIndex--, this.byteOffset++) {
				const
					offset = startOffset + ((i + length * byteIndex) % endOffset),
					byte = Number(value & byteMask);

				super.setUint8(offset, byte);
				value >>= bitsPerByte;
			};
		};
	};

	set(source, offset = 0, length = Math.min(this.bytesLeft, source.byteLength - offset)) {
		new Uint8Array(this.buffer, this.byteOffset, length)
			.set(new Uint8Array(source, offset, length));

		this.byteOffset += length;
	}

	readBytes(length) {
		return Uint8Array.from({ length }, () => this.readUint8());
	}

	writeBytes(bytes) { // ...bytes
		bytes.forEach(byte => this.writeUint8(byte));
	};

	readString(length) {
		const bytes = this.readBytes(length);
		return textDecoder.decode(bytes); // String.fromCharCode(...charCodes);
	};

	writeString(string) {
		const bytes = textEncoder.encode(string);
		this.writeBytes(bytes);
	};

	readBoolean() {
		return Boolean(this.readUint8()); // === 1
	};

	writeBoolean(boolean) {
		this.writeUint8(Number(boolean));
	};

	readReferents(length) {
		const Referents = this.readInterleavedInt32(length);

		for (let i = 1; i < length; i++) {
			Referents[i] += Referents[i - 1];
		};

		return Referents;
	};

	writeReferents(Referents) {
		let lastValue = 0;
		this.writeInterleavedInt32(Int32Array.from(Referents, value => {
			const difference = value - lastValue;
			lastValue = value;
			return difference;
		}));
	}

	readInterleavedInt8(length) {
		return Int8Array.from(this.readBytes(length), zigzagDecode);
	};

	writeInterleavedInt8(values) { // bytes?
		this.writeBytes(Uint8Array.from(values, zigzagDecode));
	};

	readInterleavedUint32(length) {
		return this.#readInterleaved(length, Uint32Array);
	};

	writeInterleavedUint32(values) {
		this.#writeInterleaved(values, Uint32Array);
	}

	readInterleavedUint64(length) {
		return this.#readInterleaved(length, BigUint64Array);
	}

	writeInterleavedUint64(values) {
		this.#writeInterleaved(values, BigUint64Array);
	}

	readInterleavedInt32(length) {
		return Int32Array.from(this.readInterleavedUint32(length), zigzagDecode);
	}

	writeInterleavedInt32(values) {
		this.writeInterleavedUint32(Uint32Array.from(values, zigzagEncode));
	}

	readInterleavedInt64(length) {
		return BigInt64Array.from(this.readInterleavedUint64(length), zigzagDecode);
	}

	writeInterleavedInt64(values) {
		this.writeInterleavedUint64(BigUint64Array.from(values, zigzagEncode));
	}

	readInterleavedRobloxFloat32(length) {
		return Float32Array.from(this.readInterleavedUint32(length), decodeRobloxFloat);
	}

	writeInterleavedRobloxFloat32(values) {
		this.writeInterleavedUint32(Uint32Array.from(values, encodeRobloxFloat));
	};

	readVarInt32() { // readVarInt32
		let result = 0;

		for (let i = 0; i < 5; i++) { // <= 4
			const
				shift = i * 7,
				byte = this.readUint8();

			result |= (byte & 0x7F) << shift;
			if ((byte & 0x80) === 0) break;
		};

		return result;
		/*
		let byte = 0, shift = 0, result = 0;

		do {
			byte = this.readUint8();
			result |= ((byte & 127) << shift);
			shift += 7;
		} while (byte & 128); // !== 0

		return result;
		*/
	};
};

const arrayTypes = {
	Int8: Int8Array,
	Uint8: Uint8Array,
	Int16: Int16Array,
	Uint16: Uint16Array,
	Int32: Int32Array,
	Uint32: Uint32Array,
	Float32: Float32Array,
	Float64: Float64Array,
	BigInt64: BigInt64Array,
	BigUint64: BigUint64Array,
};

const
	ByteEditorPrototype = ByteEditor.prototype,
	DataViewPrototype = DataView.prototype;

for (const [dataName, { BYTES_PER_ELEMENT: byteSize }] of Object.entries(arrayTypes)) {
	const DataViewToNewByteEditorFunction = (dataViewPrefix, byteEditorPrefix) => {
		const DataViewFunction = DataViewPrototype[dataViewPrefix + dataName];

		if (typeof DataViewFunction === "function") {
			ByteEditorPrototype[byteEditorPrefix + dataName] = function (...args) {
				const { automaticResizing, byteOffset } = this;
				if (automaticResizing) {
					this.buffer.resize(byteOffset + byteSize);
				}; // else if

				const { byteLength } = this;
				if (byteOffset + byteSize > byteLength) {
					throw new RangeError(`Attempt to read beyond buffer length: offset ${byteOffset}, size ${byteSize}, length ${byteLength}`);
				};

				const value = DataViewFunction.call(this, this.byteOffset, ...args);
				this.byteOffset += byteSize;
				return value;
			};
		};
	};

	DataViewToNewByteEditorFunction("get", "read");
	DataViewToNewByteEditorFunction("set", "write");
};
