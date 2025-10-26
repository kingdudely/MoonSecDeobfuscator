import LuauCompiler from "./compiler/index.js";
import deserializer from "./deserializer/index.js";
const textEncoder = new TextEncoder("utf-8");
const { _luau_compile, _malloc, _free, HEAPU8, HEAP32 } = await LuauCompiler();

function compile(script) {
	script += "\0";

	const script_ptr = _malloc(script.length);
	textEncoder.encodeInto(script, HEAPU8.subarray(script_ptr, script_ptr + script.length));

	const bytecode_size_ptr = _malloc(8);
	const bytecode_ptr = _luau_compile(script_ptr, script.length, 0, bytecode_size_ptr);
	const bytecode_size = HEAP32[bytecode_size_ptr >> 2];
	const bytecode = HEAPU8.slice(bytecode_ptr, bytecode_ptr + bytecode_size);

	_free(script_ptr);
	_free(bytecode_size_ptr);
	_free(bytecode_ptr);
	return bytecode;
}

const input = document.getElementById("text");
input.addEventListener("keydown", function (event) {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();

		try {
			const compiled = compile(this.value).buffer;
			const deserialized = deserializer(compiled);
			window.alert("Deserialized output in console");
			console.log(deserialized);
		} catch (error) {
			window.alert(error);
			throw error;
		};
	};
});
