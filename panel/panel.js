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
	if (!inMedias) return;

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
			const sourcePostIconProps = {
				className: "source-post-icon",
				onclick: (e) => {
					e.preventDefault();
					e.stopPropagation();
					open(m.parentUrl, '_blank');
				}
			}
			const videoIconProps = {
				className: "video-icon"
			};
			const removeIconProps = {
				className: "remove",
				onclick: (e) => {
					e.preventDefault();
					e.stopPropagation();
					removeImageData(m.id);
				}
			};

			const durationElement = (() => {
				if (m.durationMillis === undefined) return undefined;

				const seconds = m.durationMillis / 1000;
				const duration = `${seconds / 60 | 0}:${String(seconds % 60 | 0).padStart(2, "0")}`;
				return ce("span", { className: "duration-frame" }, duration);
			})();

			resultElm.appendChild(ce("div", cellProps,
				ce("span", sourcePostIconProps, "🔗"),
				ce("span", videoIconProps, !isPhoto ? "🎞️" : ""),
				ce("span", removeIconProps, "✖"),
				durationElement
			));
		});
	});
}

const exportURLs = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		const urls = [
			...medias.filter(m => m.type === 'photo').map(m => m.url),
			...medias.filter(m => m.type !== 'photo').map(m => m.videoUrl)
		];
		const blob = new Blob([urls.join("\r\n")], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		ce("a", { download: "urllist.txt", href: url }).click();
		URL.revokeObjectURL(url);
	});
}

const exportAllData = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		const blob = new Blob([JSON.stringify(medias)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		ce("a", { download: "twfilter-all-data.json", href: url }).click();
		URL.revokeObjectURL(url);
	});
}

const importAllData = files => {
	Array.from(files).forEach(file => {
		if (file.type !== 'application/json') return;

		const reader = new FileReader();
		reader.onload = e => {
			const medias = JSON.parse(e.target.result);
			chrome.storage.local.set({ medias }, () => updatePanel())
		};
		reader.readAsText(file);
	});
}

addEventListener('load', () => updatePanel());
$("export-urls").addEventListener('click', () => exportURLs());
$("all-remove-button").addEventListener('click', () => chrome.storage.local.set({ medias: [] }, () => updatePanel()));
$("export-all-data").addEventListener('click', () => exportAllData());
$("import-all-data").addEventListener('click', () => $("upload-all-data").click());
$("upload-all-data").addEventListener('change', e => importAllData(e?.target?.files));

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
