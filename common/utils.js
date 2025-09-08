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

export const formatBytes = (bytes, decimals = 2) => {
    if (!bytes || bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
