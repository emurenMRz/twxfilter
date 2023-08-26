import { $, createElement as ce } from "./dom.js";

const canUseLocalStorage = chrome.storage !== undefined && chrome.storage.local !== undefined;

chrome.devtools.inspectedWindow.eval(`console.log('canUseLocalStorage: ${JSON.stringify(canUseLocalStorage)}');`);

const thumbnailUrl = url => {
	if (!url.startsWith("https://pbs.twimg.com/media/")) return url;

	const [path, query] = url.split("?");
	if (!query) return `${url}?name=small`;

	const q = Object.fromEntries(query.split("&").map(v => v.split("=")));
	if (!q.format) throw Error("Unsupport syntax");

	return `${path}?format=${q.format}&name=small`;
}

const addImageData = inMedias => {
	if (!canUseLocalStorage) return;

	chrome.storage.local.get("medias", result => {
		const medias = result.medias || [];

		inMedias.forEach(media => {
			if (!medias.some(v => v.id === media.id))
				medias.push(media);
		});

		chrome.storage.local.set({ medias }, () => updatePanel());
	});
};

const removeImageData = id => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias.filter(m => m.id !== id);
		chrome.storage.local.set({ medias }, () => updatePanel())
	});
};

const updatePanel = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		const resultElm = $('result');
		resultElm.textContent = '';

		if (!(medias instanceof Array)) return;

		$("mode-header").textContent = `Thumbs: ${medias.length} Photo: ${medias.filter(m => m.type === 'photo').length}`;

		resultElm.classList.add('result-thumbs');

		medias.forEach(m => {
			const thumbUrl = thumbnailUrl(m.url);
			const isPhoto = m.type === 'photo';
			const cellProps = {
				className: "thumb",
				style: { backgroundImage: `url("${thumbUrl}")` },
				onclick: () => open(isPhoto ? `${m.url}?name=orig` : m.videoUrl, '_blank'),
			};
			const videoIconProps = { className: "video-icon" };
			const removeIconProps = {
				className: "remove",
				onclick: (e) => {
					e.preventDefault();
					e.stopPropagation();
					removeImageData(m.id);
				}
			};

			resultElm.appendChild(ce("div", cellProps,
				ce("span", videoIconProps, !isPhoto ? "🎞️" : ""),
				ce("span", removeIconProps, "✖")));
		});
	});
}

const exportURLs = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		const blob = new Blob([medias.filter(m => m.type === 'photo').map(m => m.url).join("\r\n")], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		ce("a", { download: "urllist.txt", href: url }).click();
		URL.revokeObjectURL(url);
	});
}

addEventListener('load', () => updatePanel());
$("export-button").addEventListener('click', () => exportURLs());
$("all-remove-button").addEventListener('click', () => chrome.storage.local.set({ medias: [] }, () => updatePanel()));

/**
 * Recieve message
 */
chrome.runtime.onConnect.addListener(port => {
	const listener = async message => addImageData(message);

	if (port.name === 'twxfilter-panel') {
		port.onMessage.addListener(listener);
		port.onDisconnect.addListener(port => port.onMessage.removeListener(listener))
	}
})
