import {each} from "./common"
import {createDraft} from "./immer"

export function generatePatches(state, basePath, patches, inversePatches) {
	Array.isArray(state.base)
		? generateArrayPatches(state, basePath, patches, inversePatches)
		: generateObjectPatches(state, basePath, patches, inversePatches)
}

function generateArrayPatches(state, basePath, patches, inversePatches) {
	let {base, copy, assigned} = state

	// Reduce complexity by ensuring `base` is never longer.
	if (copy.length < base.length) {
		;[base, copy] = [copy, base]
		;[patches, inversePatches] = [inversePatches, patches]
	}

	const delta = copy.length - base.length

	// Find the first replaced index.
	let start = 0
	while (base[start] === copy[start] && start < base.length) {
		++start
	}

	// Find the last replaced index. Search from the end to optimize splice patches.
	let end = base.length
	while (end > start && base[end - 1] === copy[end + delta - 1]) {
		--end
	}

	// Process replaced indices.
	for (let i = start; i < end; ++i) {
		if (assigned[i] && copy[i] !== base[i]) {
			const path = basePath.concat([i])
			patches.push({
				op: "replace",
				path,
				value: copy[i]
			})
			inversePatches.push({
				op: "replace",
				path,
				value: base[i]
			})
		}
	}

	const useRemove = end != base.length
	const replaceCount = patches.length

	// Process added indices.
	for (let i = end + delta - 1; i >= end; --i) {
		const path = basePath.concat([i])
		patches[replaceCount + i - end] = {
			op: "add",
			path,
			value: copy[i]
		}
		if (useRemove) {
			inversePatches.push({
				op: "remove",
				path
			})
		}
	}

	// One "replace" patch reverses all non-splicing "add" patches.
	if (!useRemove) {
		inversePatches.push({
			op: "replace",
			path: basePath.concat(["length"]),
			value: base.length
		})
	}
}

function generateObjectPatches(state, basePath, patches, inversePatches) {
	const {base, copy} = state
	each(state.assigned, (key, assignedValue) => {
		const origValue = base[key]
		const value = copy[key]
		const op = !assignedValue ? "remove" : key in base ? "replace" : "add"
		if (origValue === value && op === "replace") return
		const path = basePath.concat(key)
		patches.push(op === "remove" ? {op, path} : {op, path, value})
		inversePatches.push(
			op === "add"
				? {op: "remove", path}
				: op === "remove"
				? {op: "add", path, value: origValue}
				: {op: "replace", path, value: origValue}
		)
	})
}

// used to clone patch to ensure original patch is not modified
const clone = obj => {
	if (obj === null || typeof obj !== "object") return obj

	if (Array.isArray(obj)) return obj.map(clone)

	const cloned = {}
	for (const key in obj) cloned[key] = clone(obj[key])

	return cloned
}

export const applyPatches = (draft, patches) => {
	for (const patch of patches) {
		const {path, op} = patch
		const value = clone(patch.value)

		if (!path.length) throw new Error("Illegal state")

		let base = draft
		for (let i = 0; i < path.length - 1; i++) {
			base = base[path[i]]
			if (!base || typeof base !== "object")
				throw new Error("Cannot apply patch, path doesn't resolve: " + path.join("/")) // prettier-ignore
		}

		const key = path[path.length - 1]
		switch (op) {
			case "replace":
				// if value is an object, then it's assigned by reference
				// in the following add or remove ops, the value field inside the patch will also be modifyed
				// so we use value from the cloned patch
				base[key] = value
				break
			case "add":
				if (Array.isArray(base)) {
					// TODO: support "foo/-" paths for appending to an array
					base.splice(key, 0, value)
				} else {
					base[key] = value
				}
				break
			case "remove":
				if (Array.isArray(base)) {
					base.splice(key, 1)
				} else {
					delete base[key]
				}
				break
			default:
				throw new Error("Unsupported patch operation: " + op)
		}
	}

	return draft
}
