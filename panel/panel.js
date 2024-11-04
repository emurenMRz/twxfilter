import { $, createElement as ce } from "./dom.js";
import backendApi from "./api.js";

const canUseLocalStorage = chrome.storage !== undefined && chrome.storage.local !== undefined;

chrome.devtools.inspectedWindow.eval(`console.log('canUseLocalStorage: ${JSON.stringify(canUseLocalStorage)}');`);

const sortProc = (a, b) => {
	if (!a.timestamp && !b.timestamp) return 0;
	if (!a.timestamp) return 1;
	if (!b.timestamp) return -1;
	return b.timestamp - a.timestamp;
};

const thumbnailUrl = url => {
	if (!url.startsWith("https://pbs.twimg.com/media/")) return url;

	const [path, query] = url.split("?");
	if (!query) return `${url}?name=small`;

	const q = Object.fromEntries(query.split("&").map(v => v.split("=")));
	if (!q.format) throw Error("Unsupport syntax");

	return `${path}?format=${q.format}&name=small`;
}

const addImageData = inMedia => {
	if (!canUseLocalStorage) return;
	if (!inMedia) return;

	const timestamp = Date.now();
	const mediaTS = inMedia.map(m => ({ ...m, timestamp }));

	backendApi.POST("/api/media", mediaTS);

	chrome.storage.local.get("medias", result => {
		const medias = result.medias || [];

		mediaTS.forEach(m => {
			const index = medias.findIndex(v => v.id === m.id);

			if (index === -1)
				medias.push(m);
			else
				medias[index] = m;
		});

		chrome.storage.local.set({ medias: medias.sort(sortProc) }, () => updatePanel());
	});
};

const removeImageData = id => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias.filter(m => m.id !== id);

		backendApi.DELETE(`/api/media/${id}`);

		chrome.storage.local.set({ medias }, () => updatePanel())
	});
};

const checkImageData = id => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		const media = medias.find(m => m.id === id);
		media.selected = !media.selected;
		chrome.storage.local.set({ medias }, () => updatePanel())
	});
};

const applyObserve = element => {
	const observer = new IntersectionObserver(entries => {
		entries.forEach(entry => {
			if (!entry.isIntersecting) return;
			if (element.onclick) return;

			const { thumbUrl, mediaUrl } = element.dataset;
			element.style.backgroundImage = `url("${thumbUrl}")`;
			element.onclick = () => open(mediaUrl, '_blank');
		});
	});
	observer.observe(element);
	return element
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
			const isPhoto = m.type === 'photo';
			const cellProps = {
				id: m.id,
				className: "thumb",
				dataset: {
					thumbUrl: thumbnailUrl(m.url),
					mediaUrl: isPhoto ? `${m.url}?name=orig` : m.videoUrl
				},
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
			const checkIconProps = {
				className: `check-icon ${m.selected ? 'checked' : ''}`,
				onclick: (e) => {
					e.preventDefault();
					e.stopPropagation();
					checkImageData(m.id);
					if (m.selected)
						e.target.classList.add('checked');
					else
						e.target.classList.remove('checked');
				}
			};
			const cachedIconProps = {
				className: "cached-icon",
			};

			const durationElement = (() => {
				if (m.durationMillis === undefined) return undefined;

				const seconds = m.durationMillis / 1000;
				const duration = `${seconds / 60 | 0}:${String(seconds % 60 | 0).padStart(2, "0")}`;
				return ce("span", { className: "duration-frame" }, duration);
			})();

			resultElm.appendChild(applyObserve(ce("div", cellProps,
				ce("span", sourcePostIconProps, "🔗"),
				ce("span", videoIconProps, !isPhoto ? "🎞️" : ""),
				ce("span", removeIconProps, "✖"),
				ce("span", checkIconProps, "✔"),
				m.hasCache && ce("span", cachedIconProps, "🆗"),
				durationElement
			)));
		});
	});
}

const exportURLs = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		const hasSelectMedia = medias.some(m => m.selected);
		const targetMedia = !hasSelectMedia ? medias : medias.filter(m => m.selected);
		const urls = targetMedia.map(m => m.type === 'photo' ? m.url : m.videoUrl);
		const blob = new Blob([urls.join("\n")], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		ce("a", { download: "urllist.txt", href: url }).click();
		URL.revokeObjectURL(url);
	});
}

const changeOrder = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		chrome.storage.local.set({ medias: medias.reverse() }, () => updatePanel());
	});
}

const clearSelect = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		chrome.storage.local.set({ medias: medias.map(m => { m.selected = false; return m; }) }, () => updatePanel());
	});
}

const exportAllData = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		const blob = new Blob([JSON.stringify(medias)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		ce("a", { download: "twxfilter-all-data.json", href: url }).click();
		URL.revokeObjectURL(url);
	});
}

const importAllData = files => {
	Array.from(files).forEach(file => {
		if (file.type !== 'application/json') return;

		const reader = new FileReader();
		reader.onload = e => {
			const medias = JSON.parse(e.target.result).sort(sortProc);
			backendApi.POST("/api/media", medias);
			chrome.storage.local.set({ medias }, () => updatePanel())
		};
		reader.readAsText(file);
	});
}

const openConfigDialog = () => {
	chrome.storage.local.get("config", result => {
		const backendAddress = result?.config?.backendAddress;

		$("backend-address").value = backendAddress ?? "";

		$('config-dialog').classList.toggle("open");
	});
}

const applyConfig = () => {
	const config = {
		backendAddress: $("backend-address").value
	};

	chrome.storage.local.set({ config })
		.catch(e => {
			alert(e.message);
			console.error(e);
		})
		.finally(() => $('config-dialog').classList.remove("open"));
}

addEventListener('load', () => {
	chrome.storage.local.get("medias", result => {
		const medias = result?.medias ?? [];

		backendApi.POST("/api/media", medias)
			.then(medias => chrome.storage.local.set({ medias }))
			.catch(console.error)
			.finally(() => updatePanel());
	});
});

$("export-urls").addEventListener('click', () => exportURLs());
$("clear-select").addEventListener('click', () => clearSelect());
$("open-config-dialog").addEventListener('click', () => openConfigDialog());
$("change-order").addEventListener('click', () => changeOrder());
$("export-all-data").addEventListener('click', () => exportAllData());
$("import-all-data").addEventListener('click', () => $("upload-all-data").click());
$("upload-all-data").addEventListener('change', e => importAllData(e?.target?.files));
$("all-remove-button").addEventListener('click', () => {
	backendApi.DELETE(`/api/media`);
	chrome.storage.local.set({ medias: [] }, () => updatePanel())
});

$("apply-config").addEventListener('click', () => applyConfig());

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
