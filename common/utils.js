export const showError = message => {
	console.error(message);
	alert(message);
};

const isValidMediaObject = obj => {
	return obj &&
		typeof obj.id === 'string' &&
		typeof obj.type === 'string' &&
		typeof obj.url === 'string' &&
		typeof obj.parentUrl === 'string';
};

export const isValidMediasArray = arr => {
	return Array.isArray(arr) && arr.every(isValidMediaObject);
};
