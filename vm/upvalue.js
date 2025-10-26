export default class Upvalue {
	constructor(index, value, store = { [index]: value }) {
		this.index = index;
		this.value = value;
		this.store = store;
	};

	get() {
		return this.store[this.index];
	}

	set(v) {
		this.store[this.index] = v;
	}

	close() {
		// move value into self, break reference to stack
		this.value = this.store[this.index];
		this.store = this;
		this.index = "value"; // special marker
	}
}
