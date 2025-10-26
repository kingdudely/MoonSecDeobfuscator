async function LuauCompiler(moduleArg = {}) {
	var moduleRtn;
	var Module = moduleArg;
	var ENVIRONMENT_IS_WEB = true;
	var ENVIRONMENT_IS_WORKER = false;
	var arguments_ = [];
	var thisProgram = "./this.program";
	var quit_ = (status, toThrow) => {
		throw toThrow
	};
	var _scriptName = import.meta.url;
	var scriptDirectory = "";
	var readAsync;
	if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
		try {
			scriptDirectory = new URL(".", _scriptName).href
		} catch {} {
			readAsync = async url => {
				var response = await fetch(url, {
					credentials: "same-origin"
				});
				if (response.ok) {
					return response.arrayBuffer()
				}
				throw new Error(response.status + " : " + response.url)
			}
		}
	} else {}
	var out = console.log.bind(console);
	var err = console.error.bind(console);
	var wasmBinary;
	var ABORT = false;
	var EXITSTATUS;

	function binaryDecode(bin) {
		for (var i = 0, l = bin.length, o = new Uint8Array(l), c; i < l; ++i) {
			c = bin.charCodeAt(i);
			o[i] = ~c >> 8 & c
		}
		return o
	}
	var readyPromiseResolve, readyPromiseReject;
	var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
	var HEAP64, HEAPU64;
	var runtimeInitialized = false;

	function updateMemoryViews() {
		var b = wasmMemory.buffer;
		HEAP8 = new Int8Array(b);
		HEAP16 = new Int16Array(b);
		Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
		HEAPU16 = new Uint16Array(b);
		Module["HEAP32"] = HEAP32 = new Int32Array(b);
		HEAPU32 = new Uint32Array(b);
		HEAPF32 = new Float32Array(b);
		HEAPF64 = new Float64Array(b);
		HEAP64 = new BigInt64Array(b);
		HEAPU64 = new BigUint64Array(b)
	}

	function preRun() {
		if (Module["preRun"]) {
			if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
			while (Module["preRun"].length) {
				addOnPreRun(Module["preRun"].shift())
			}
		}
		callRuntimeCallbacks(onPreRuns)
	}

	function initRuntime() {
		runtimeInitialized = true
	}

	function postRun() {
		if (Module["postRun"]) {
			if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
			while (Module["postRun"].length) {
				addOnPostRun(Module["postRun"].shift())
			}
		}
		callRuntimeCallbacks(onPostRuns)
	}

	function abort(what) {
		Module["onAbort"]?.(what);
		what = "Aborted(" + what + ")";
		err(what);
		ABORT = true;
		what += ". Build with -sASSERTIONS for more info.";
		var e = new WebAssembly.RuntimeError(what);
		readyPromiseReject?.(e);
		throw e
	}
	var wasmBinaryFile = new Uint8Array(await readAsync(scriptDirectory + "module.wasm"));

	function getBinarySync(file) {
		return file
	}
	async function getWasmBinary(binaryFile) {
		return getBinarySync(binaryFile)
	}
	async function instantiateArrayBuffer(binaryFile, imports) {
		try {
			var binary = await getWasmBinary(binaryFile);
			var instance = await WebAssembly.instantiate(binary, imports);
			return instance
		} catch (reason) {
			err(`failed to asynchronously prepare wasm: ${reason}`);
			abort(reason)
		}
	}
	async function instantiateAsync(binary, binaryFile, imports) {
		return instantiateArrayBuffer(binaryFile, imports)
	}

	function getWasmImports() {
		var imports = {
			a: wasmImports
		};
		return imports
	}
	async function createWasm() {
		function receiveInstance(instance, module) {
			wasmExports = instance.exports;
			assignWasmExports(wasmExports);
			updateMemoryViews();
			return wasmExports
		}

		function receiveInstantiationResult(result) {
			return receiveInstance(result["instance"])
		}
		var info = getWasmImports();
		if (Module["instantiateWasm"]) {
			return new Promise((resolve, reject) => {
				Module["instantiateWasm"](info, (inst, mod) => {
					resolve(receiveInstance(inst, mod))
				})
			})
		}
		// wasmBinaryFile ??= findWasmBinary();
		var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
		var exports = receiveInstantiationResult(result);
		return exports
	}
	class ExitStatus {
		name = "ExitStatus";
		constructor(status) {
			this.message = `Program terminated with exit(${status})`;
			this.status = status
		}
	}
	var callRuntimeCallbacks = callbacks => {
		while (callbacks.length > 0) {
			callbacks.shift()(Module)
		}
	};
	var onPostRuns = [];
	var addOnPostRun = cb => onPostRuns.push(cb);
	var onPreRuns = [];
	var addOnPreRun = cb => onPreRuns.push(cb);

	function getValue(ptr, type = "i8") {
		if (type.endsWith("*")) type = "*";
		switch (type) {
			case "i1":
				return HEAP8[ptr];
			case "i8":
				return HEAP8[ptr];
			case "i16":
				return HEAP16[ptr >> 1];
			case "i32":
				return HEAP32[ptr >> 2];
			case "i64":
				return HEAP64[ptr >> 3];
			case "float":
				return HEAPF32[ptr >> 2];
			case "double":
				return HEAPF64[ptr >> 3];
			case "*":
				return HEAPU32[ptr >> 2];
			default:
				abort(`invalid type for getValue: ${type}`)
		}
	}
	var noExitRuntime = true;

	function setValue(ptr, value, type = "i8") {
		if (type.endsWith("*")) type = "*";
		switch (type) {
			case "i1":
				HEAP8[ptr] = value;
				break;
			case "i8":
				HEAP8[ptr] = value;
				break;
			case "i16":
				HEAP16[ptr >> 1] = value;
				break;
			case "i32":
				HEAP32[ptr >> 2] = value;
				break;
			case "i64":
				HEAP64[ptr >> 3] = BigInt(value);
				break;
			case "float":
				HEAPF32[ptr >> 2] = value;
				break;
			case "double":
				HEAPF64[ptr >> 3] = value;
				break;
			case "*":
				HEAPU32[ptr >> 2] = value;
				break;
			default:
				abort(`invalid type for setValue: ${type}`)
		}
	}
	var stackRestore = val => __emscripten_stack_restore(val);
	var stackSave = () => _emscripten_stack_get_current();
	var exceptionCaught = [];
	var uncaughtExceptionCount = 0;
	var ___cxa_begin_catch = ptr => {
		var info = new ExceptionInfo(ptr);
		if (!info.get_caught()) {
			info.set_caught(true);
			uncaughtExceptionCount--
		}
		info.set_rethrown(false);
		exceptionCaught.push(info);
		___cxa_increment_exception_refcount(ptr);
		return ___cxa_get_exception_ptr(ptr)
	};
	var exceptionLast = 0;
	var ___cxa_end_catch = () => {
		_setThrew(0, 0);
		var info = exceptionCaught.pop();
		___cxa_decrement_exception_refcount(info.excPtr);
		exceptionLast = 0
	};
	class ExceptionInfo {
		constructor(excPtr) {
			this.excPtr = excPtr;
			this.ptr = excPtr - 24
		}
		set_type(type) {
			HEAPU32[this.ptr + 4 >> 2] = type
		}
		get_type() {
			return HEAPU32[this.ptr + 4 >> 2]
		}
		set_destructor(destructor) {
			HEAPU32[this.ptr + 8 >> 2] = destructor
		}
		get_destructor() {
			return HEAPU32[this.ptr + 8 >> 2]
		}
		set_caught(caught) {
			caught = caught ? 1 : 0;
			HEAP8[this.ptr + 12] = caught
		}
		get_caught() {
			return HEAP8[this.ptr + 12] != 0
		}
		set_rethrown(rethrown) {
			rethrown = rethrown ? 1 : 0;
			HEAP8[this.ptr + 13] = rethrown
		}
		get_rethrown() {
			return HEAP8[this.ptr + 13] != 0
		}
		init(type, destructor) {
			this.set_adjusted_ptr(0);
			this.set_type(type);
			this.set_destructor(destructor)
		}
		set_adjusted_ptr(adjustedPtr) {
			HEAPU32[this.ptr + 16 >> 2] = adjustedPtr
		}
		get_adjusted_ptr() {
			return HEAPU32[this.ptr + 16 >> 2]
		}
	}
	var setTempRet0 = val => __emscripten_tempret_set(val);
	var findMatchingCatch = args => {
		var thrown = exceptionLast;
		if (!thrown) {
			setTempRet0(0);
			return 0
		}
		var info = new ExceptionInfo(thrown);
		info.set_adjusted_ptr(thrown);
		var thrownType = info.get_type();
		if (!thrownType) {
			setTempRet0(0);
			return thrown
		}
		for (var caughtType of args) {
			if (caughtType === 0 || caughtType === thrownType) {
				break
			}
			var adjusted_ptr_addr = info.ptr + 16;
			if (___cxa_can_catch(caughtType, thrownType, adjusted_ptr_addr)) {
				setTempRet0(caughtType);
				return thrown
			}
		}
		setTempRet0(thrownType);
		return thrown
	};
	var ___cxa_find_matching_catch_3 = arg0 => findMatchingCatch([arg0]);
	var ___cxa_throw = (ptr, type, destructor) => {
		var info = new ExceptionInfo(ptr);
		info.init(type, destructor);
		exceptionLast = ptr;
		uncaughtExceptionCount++;
		throw exceptionLast
	};
	var __abort_js = () => abort("");
	var runtimeKeepaliveCounter = 0;
	var __emscripten_runtime_keepalive_clear = () => {
		noExitRuntime = false;
		runtimeKeepaliveCounter = 0
	};
	var timers = {};
	var handleException = e => {
		if (e instanceof ExitStatus || e == "unwind") {
			return EXITSTATUS
		}
		quit_(1, e)
	};
	var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
	var _proc_exit = code => {
		EXITSTATUS = code;
		if (!keepRuntimeAlive()) {
			Module["onExit"]?.(code);
			ABORT = true
		}
		quit_(code, new ExitStatus(code))
	};
	var exitJS = (status, implicit) => {
		EXITSTATUS = status;
		_proc_exit(status)
	};
	var _exit = exitJS;
	var maybeExit = () => {
		if (!keepRuntimeAlive()) {
			try {
				_exit(EXITSTATUS)
			} catch (e) {
				handleException(e)
			}
		}
	};
	var callUserCallback = func => {
		if (ABORT) {
			return
		}
		try {
			func();
			maybeExit()
		} catch (e) {
			handleException(e)
		}
	};
	var _emscripten_get_now = () => performance.now();
	var __setitimer_js = (which, timeout_ms) => {
		if (timers[which]) {
			clearTimeout(timers[which].id);
			delete timers[which]
		}
		if (!timeout_ms) return 0;
		var id = setTimeout(() => {
			delete timers[which];
			callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()))
		}, timeout_ms);
		timers[which] = {
			id,
			timeout_ms
		};
		return 0
	};
	var getHeapMax = () => 2147483648;
	var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
	var growMemory = size => {
		var oldHeapSize = wasmMemory.buffer.byteLength;
		var pages = (size - oldHeapSize + 65535) / 65536 | 0;
		try {
			wasmMemory.grow(pages);
			updateMemoryViews();
			return 1
		} catch (e) {}
	};
	var _emscripten_resize_heap = requestedSize => {
		var oldSize = HEAPU8.length;
		requestedSize >>>= 0;
		var maxHeapSize = getHeapMax();
		if (requestedSize > maxHeapSize) {
			return false
		}
		for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
			var overGrownHeapSize = oldSize * (1 + .2 / cutDown);
			overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
			var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
			var replacement = growMemory(newSize);
			if (replacement) {
				return true
			}
		}
		return false
	};
	var getWasmTableEntry = funcPtr => wasmTable.get(funcPtr);
	for (var base64ReverseLookup = new Uint8Array(123), i = 25; i >= 0; --i) {
		base64ReverseLookup[48 + i] = 52 + i;
		base64ReverseLookup[65 + i] = i;
		base64ReverseLookup[97 + i] = 26 + i
	}
	base64ReverseLookup[43] = 62;
	base64ReverseLookup[47] = 63;
	{
		if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
		if (Module["print"]) out = Module["print"];
		if (Module["printErr"]) err = Module["printErr"];
		if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
		if (Module["arguments"]) arguments_ = Module["arguments"];
		if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
		if (Module["preInit"]) {
			if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
			while (Module["preInit"].length > 0) {
				Module["preInit"].shift()()
			}
		}
	}
	Module["setValue"] = setValue;
	Module["getValue"] = getValue;
	var _luau_compile, _strlen, _malloc, _luau_set_compile_constant_nil, _luau_set_compile_constant_boolean, _luau_set_compile_constant_number, _luau_set_compile_constant_vector, _luau_set_compile_constant_string, __emscripten_timeout, _free, _setThrew, __emscripten_tempret_set, __emscripten_stack_restore, _emscripten_stack_get_current, ___cxa_increment_exception_refcount, ___cxa_decrement_exception_refcount, ___cxa_can_catch, ___cxa_get_exception_ptr, memory, __indirect_function_table, wasmMemory, wasmTable;

	function assignWasmExports(wasmExports) {
		_luau_compile = Module["_luau_compile"] = wasmExports["n"];
		_strlen = Module["_strlen"] = wasmExports["o"];
		_malloc = Module["_malloc"] = wasmExports["q"];
		_luau_set_compile_constant_nil = Module["_luau_set_compile_constant_nil"] = wasmExports["r"];
		_luau_set_compile_constant_boolean = Module["_luau_set_compile_constant_boolean"] = wasmExports["s"];
		_luau_set_compile_constant_number = Module["_luau_set_compile_constant_number"] = wasmExports["t"];
		_luau_set_compile_constant_vector = Module["_luau_set_compile_constant_vector"] = wasmExports["u"];
		_luau_set_compile_constant_string = Module["_luau_set_compile_constant_string"] = wasmExports["v"];
		__emscripten_timeout = wasmExports["w"];
		_free = Module["_free"] = wasmExports["x"];
		_setThrew = wasmExports["y"];
		__emscripten_tempret_set = wasmExports["z"];
		__emscripten_stack_restore = wasmExports["A"];
		_emscripten_stack_get_current = wasmExports["B"];
		___cxa_increment_exception_refcount = wasmExports["C"];
		___cxa_decrement_exception_refcount = wasmExports["D"];
		___cxa_can_catch = wasmExports["E"];
		___cxa_get_exception_ptr = wasmExports["F"];
		memory = wasmMemory = wasmExports["m"];
		__indirect_function_table = wasmTable = wasmExports["p"]
	}
	var wasmImports = {
		c: ___cxa_begin_catch,
		i: ___cxa_end_catch,
		b: ___cxa_find_matching_catch_3,
		a: ___cxa_throw,
		h: __abort_js,
		f: __emscripten_runtime_keepalive_clear,
		g: __setitimer_js,
		l: _emscripten_resize_heap,
		k: invoke_ii,
		j: invoke_v,
		d: invoke_vii,
		e: _proc_exit
	};

	function invoke_vii(index, a1, a2) {
		var sp = stackSave();
		try {
			getWasmTableEntry(index)(a1, a2)
		} catch (e) {
			stackRestore(sp);
			if (e !== e + 0) throw e;
			_setThrew(1, 0)
		}
	}

	function invoke_ii(index, a1) {
		var sp = stackSave();
		try {
			return getWasmTableEntry(index)(a1)
		} catch (e) {
			stackRestore(sp);
			if (e !== e + 0) throw e;
			_setThrew(1, 0)
		}
	}

	function invoke_v(index) {
		var sp = stackSave();
		try {
			getWasmTableEntry(index)()
		} catch (e) {
			stackRestore(sp);
			if (e !== e + 0) throw e;
			_setThrew(1, 0)
		}
	}

	function run() {
		preRun();

		function doRun() {
			Module["calledRun"] = true;
			if (ABORT) return;
			initRuntime();
			readyPromiseResolve?.(Module);
			Module["onRuntimeInitialized"]?.();
			postRun()
		}
		if (Module["setStatus"]) {
			Module["setStatus"]("Running...");
			setTimeout(() => {
				setTimeout(() => Module["setStatus"](""), 1);
				doRun()
			}, 1)
		} else {
			doRun()
		}
	}
	var wasmExports;
	wasmExports = await (createWasm());
	run();
	if (runtimeInitialized) {
		moduleRtn = Module
	} else {
		moduleRtn = new Promise((resolve, reject) => {
			readyPromiseResolve = resolve;
			readyPromiseReject = reject
		})
	};
	return moduleRtn
}
export default LuauCompiler;