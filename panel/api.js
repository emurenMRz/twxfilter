const reg = new RegExp("^https?://.+$");

export const normalizeBackendAddress = backendAddress => {
	if (typeof backendAddress !== 'string' || !backendAddress.match(reg)) throw new SyntaxError(`backend host: ${backendAddress}`);

	return backendAddress[backendAddress.length - 1] === "/" ? backendAddress.substring(0, backendAddress.length - 1) : backendAddress;
};

const validEndpoint = async endpoint => {
	const { backendAddress } = (await chrome.storage.local.get("config")).config;

	if (!backendAddress) return;
	if (typeof endpoint !== 'string') throw new TypeError(`endpoint is not string: ${endpoint}`);

	const path = endpoint[0] !== "/" ? `/${endpoint}` : endpoint;
	return `${backendAddress}${path}`;
};

const toJson = r => {
	if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);

	return r.json();
};

export const GET = async (endpoint, params) => {
	const ep = await validEndpoint(endpoint);
	if (!ep) return;
	if (!params) return await fetch(ep).then(toJson);

	if (!(params instanceof Map))
		throw new TypeError("params is not Map");

	const query = Array.from(params, v => `${v[0]}=${v[1]}`).join('&');
	return await fetch(`${ep}?${query}`).then(toJson);
};

export const POST = async (endpoint, data) => {
	const ep = await validEndpoint(endpoint);
	if (!ep) return;
	if (!data) return;

	const contentType = "application/" + (typeof data === 'string' ? "x-www-form-urlencoded" : "json");
	const body = typeof data === 'string' ? data : JSON.stringify(data);

	return await fetch(ep, {
		method: "POST",
		headers: {
			"Content-Type": contentType,
			"Content-Length": body.length
		},
		body
	}).then(toJson);
};

export const DELETE = async (endpoint) => {
	const ep = await validEndpoint(endpoint);
	if (!ep) return;

	return await fetch(ep, { method: "DELETE" }).then(toJson);
};

export default { normalizeBackendAddress, GET, POST, DELETE };
