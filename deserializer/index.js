import ByteEditor from "./ByteEditor.js";
import operations from "./operations.js"; // opList
const bit_extract = (v, pos, size) => ((v >>> pos) & ((1 << size) - 1)) >>> 0;
// const useImportConstants = false;

// globals
export default function (bytecode, vectorConstructor = () => { throw new Error("Vector not implemented") }) {
    const editor = new ByteEditor(bytecode);

    const luauVersion = editor.readUint8();
    let typesVersion = 0;
    if (luauVersion === 0) {
        throw new Error(editor.readString(editor.bytesLeft)); // new Error("the provided bytecode is an error message");
    } else if (luauVersion < 3 || luauVersion > 6) {
        throw new TypeError(`unsupported luau bytecode, version ${luauVersion}`);
    } else if (luauVersion >= 4) {
        typesVersion = editor.readUint8();
    }

    const stringCount = editor.readVarInt32();
    const stringList = Array.from({ length: stringCount }, () =>
        editor.readString(editor.readVarInt32()) // stored indices in bytecode are 1-based -> subtract 1 when used; here we read strings sequentially
    ); // 0-based

    function readInstruction(codeList) {
        const value = editor.readUint32(true); // decodeOp
        const opcode = (value & 0xFF);

        const opinfo = operations[opcode];
        if (!opinfo) throw new TypeError("Unknown opcode " + opcode);
        const [opname, opmode, kmode, usesAux] = opinfo;

        const inst = {
            opcode,
            opname,
            opmode,
            kmode,
            usesAux
        };

        codeList.push(inst);

        switch (opmode) {
            case 1: inst.A = ((value >>> 8) & 0xFF); break; // A

            case 2: { // AB
                inst.A = ((value >>> 8) & 0xFF);
                inst.B = ((value >>> 16) & 0xFF);
                break;
            };

            case 3: { // ABC
                inst.A = ((value >>> 8) & 0xFF);
                inst.B = ((value >>> 16) & 0xFF);
                inst.C = ((value >>> 24) & 0xFF);
            };

            case 4: { // AD
                inst.A = ((value >>> 8) & 0xFF);
                const temp = ((value >>> 16) & 0xFFFF);
                inst.D = (temp < 0x8000) ? temp : (temp - 0x10000);
                break;
            };

            case 5: { // AE
                const temp = ((value >>> 8) & 0xFFFFFF);
                inst.E = (temp < 0x800000) ? temp : (temp - 0x1000000);
                break;
            }
        }

        if (usesAux) {
            const aux = editor.readUint32(true);
            inst.aux = aux;
            // mirror Lua behaviour of adding aux pseudo (so codeList lengths match)
            codeList.push({ value: aux, opname: "auxvalue" });
        }

        return usesAux;
    };

    function checkkmode(inst, k) {
        const { kmode, aux, B, C, D } = inst;
        switch (kmode) {
            case 1: inst.K = k[aux]; break; // AUX
            case 2: inst.K = k[C]; break; // C
            case 3: inst.K = k[D]; break; // D
            case 4: { // AUX import
                // const extend = aux;
                const count = (aux >>> 30);
                const id0 = ((aux >>> 20) & 0x3FF);

                inst.K0 = k[id0];
                inst.KC = count;

                switch (count) {
                    // case 1?

                    case 2: {
                        const id1 = ((aux >>> 10) & 0x3FF);
                        inst.K1 = k[id1];
                        break
                    };

                    case 3: {
                        const id1 = ((aux >>> 10) & 0x3FF);
                        const id2 = ((aux >>> 0) & 0x3FF);
                        inst.K1 = k[id1];
                        inst.K2 = k[id2];
                        break;
                    };
                };

                /*
                if (useImportConstants) {
                    let res = globals[K0];
                    if (count > 1) res = res?.[K1];
                    if (count > 2) res = res?.[K2];
                    inst.K = res;
                    /*
                    function resolveImportConstant(staticEnv, count, k0, k1, k2) {
                        let res = staticEnv[k0];
                        if (count < 2 || res == null) return res;
                        res = res[k1];
                        if (count < 3 || res == null) return res;
                        res = res[k2];
                        return res;
                    };

                    inst.K = resolveImportConstant(
                        globals,
                        count, inst.K0, inst.K1, inst.K2
                    );
                };
                */

                break;
            };

            case 5: { // AUX boolean low 1 bit
                inst.K = (bit_extract(aux, 0, 1) === 1);
                inst.KN = (bit_extract(aux, 31, 1) === 1);
                break;
            };

            case 6: { // AUX number low 24 bits
                inst.K = k[bit_extract(aux, 0, 24)];
                inst.KN = (bit_extract(aux, 31, 1) === 1);
                break;
            };

            case 7: inst.K = k[B]; break; // B
            case 8: inst.K = (aux & 0xF); break; // AUX number low 16 bits
            case 9: inst.K = { Index: k[D], Closure: null, Upvalues: null }; break; // CLOSURE
        }
    }

    function readProto(bytecodeid) {
        const maxstacksize = editor.readUint8();
        const numparams = editor.readUint8();
        const nups = editor.readUint8();
        const isvararg = editor.readBoolean(); // editor.readUint8() !== 0;

        if (luauVersion >= 4) {
            editor.readUint8(); // flags
            const typesize = editor.readVarInt32();
            editor.byteOffset += typesize; // skip typesize bytes
        }

        const sizecode = editor.readVarInt32();
        const codelist = []; // 0-based

        let skipnext = false;
        for (let i = 0; i < sizecode; i++) {
            if (skipnext) {
                skipnext = false;
                continue;
            };

            skipnext = readInstruction(codelist);
        }

        // comebine codelist and debugcodelist init?
        const debugcodelist = Array.from({ length: sizecode }, (_, i) =>
            codelist[i].opcode
        );

        const sizek = editor.readVarInt32();
        const klist = Array.from({ length: sizek }, () => {
            const kt = editor.readUint8();

            switch (kt) {
                case 0: return undefined; // nil
                case 1: return editor.readBoolean(); // boolean
                case 2: return editor.readFloat64(true); // number (double?)
                case 3: return stringList[editor.readVarInt32() - 1]; // string
                case 4: return editor.readUint32(true); // import
                case 5: return Array.from({ length: editor.readVarInt32() }, () => // table
                    editor.readVarInt32()
                );
                case 6: return editor.readVarInt32(); // Closure
                case 7: {
                    // vectorSize
                    const x = editor.readFloat32(true), y = editor.readFloat32(true), z = editor.readFloat32(true), w = editor.readFloat32(true);
                    return vectorConstructor(x, y, z, w); // await
                };
                default: throw new TypeError("Unknown constant type " + kt);
            };
        }); // 0-based

        // 2nd pass to replace constant references in the instruction
        for (let i = 0; i < codelist.length; i++) {
            checkkmode(codelist[i], klist);
        }

        const sizep = editor.readVarInt32();
        const protolist = Array.from({ length: sizep }, () =>
            editor.readVarInt32() // bytecode stores proto refs as 0-based typically; previous code added +1 — now keep raw
        ); // 0-based

        const linedefined = editor.readVarInt32();
        const debugnameindex = editor.readVarInt32();
        const debugname = debugnameindex !== 0 ? stringList[debugnameindex - 1] : ""; // (??)

        // lineinfo
        const lineinfoenabled = editor.readBoolean(); // editor.readUint8() !== 0;
        let instructionlineinfo;

        if (lineinfoenabled) {
            const linegaplog2 = editor.readUint8();
            const intervals = ((sizecode - 1) >>> linegaplog2) + 1;

            let lastoffset = 0;
            const lineinfo = Array.from({ length: sizecode }, () =>
                (lastoffset += editor.readUint8())
            );

            let lastline = 0;
            const abslineinfo = Array.from({ length: intervals }, () =>
                (lastline += editor.readUint32(true)) >>> 0
            );

            instructionlineinfo = Array.from({ length: sizecode }, (_, i) => // base
                abslineinfo[i >>> linegaplog2] + lineinfo[i]
            );
        }

        // debuginfo optional
        if (editor.readBoolean()) { // editor.readUint8() !== 0
            const sizel = editor.readVarInt32();
            for (let i = 0; i < sizel; i++) {
                editor.readVarInt32();
                editor.readVarInt32();
                editor.readVarInt32();
                editor.readUint8();
            };

            const sizeupvalues = editor.readVarInt32();
            for (let i = 0; i < sizeupvalues; i++) {
                editor.readVarInt32();
            }
        }

        // Build prototype object (all 0-based)
        return {
            maxstacksize,
            numparams,
            nups,
            isvararg,
            linedefined,
            debugname,
            sizecode,
            code: codelist,               // 0-based
            debugcode: debugcodelist,    // 0-based
            sizek,
            k: klist,                    // 0-based
            sizep,
            protos: protolist,           // 0-based proto indices
            lineinfoenabled,
            instructionlineinfo,
            bytecodeid
        };
    }

    // userdataRemapping (not used)
    if (typesVersion === 3) {
        while (editor.readBoolean()) editor.readVarInt32();

        /*
        let index = editor.readUint8();
        while (index !== 0) {
            editor.readVarInt32();
            index = editor.readUint8();
        }
        */
    }

    const protoCount = editor.readVarInt32();
    const protoList = Array.from({ length: protoCount }, (_, i) =>
        readProto(i)
    ); // 0-based

    const mainProtoIndex = editor.readVarInt32();
    // const mainProto = protoList[mainProtoIndex];

    if (editor.bytesLeft !== 0) {
        throw new Error("deserializer cursor position mismatch");
    }

    // protoList[mainProtoIndex].debugname = "(main)";

    return {
        stringList,
        protoList,
        mainProtoIndex,
        typesVersion
    };
}
