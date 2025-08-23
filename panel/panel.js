import { $, createElement as ce } from "./dom.js";
import backendApi from "./api.js";

const showError = message => {
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

const isValidMediasArray = arr => {
	return Array.isArray(arr) && arr.every(isValidMediaObject);
};

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
};

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

		chrome.storage.local.set({ medias }, () => updatePanel());
	});
};

const deleteCacheFile = (id, completed = () => duplicatePanel()) => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias.filter(m => m.id !== id);

		backendApi.DELETE(`/api/cache-file/${id}`).then(() => {
			chrome.storage.local.set({ medias }, completed);
		});
	});
};

const checkImageData = id => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		const media = medias.find(m => m.id === id);
		media.selected = !media.selected;
		chrome.storage.local.set({ medias }, () => updatePanel());
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
	return element;
};

const buildThumbnail = (media, backendUri, options = {}) => {
	const { view = 'normal', deleteCompleted } = options;

	const isPhoto = media.type === 'photo';
	const thumbPath = !backendUri || !media.thumbPath ? undefined : `${backendUri}/${media.thumbPath}`;
	const mediaPath = !backendUri || !media.mediaPath ? undefined : `${backendUri}/${media.mediaPath}`;
	const cellProps = {
		id: media.id,
		className: "thumb",
		dataset: {
			timestamp: media.timestamp,
			hasCache: media.hasCache,
			thumbUrl: thumbPath ?? thumbnailUrl(media.url),
			mediaUrl: mediaPath ?? (isPhoto ? `${media.url}?name=orig` : media.videoUrl),
		},
		style: { opacity: media.hasCache ? "1" : ".25" }
	};
	const sourcePostIconProps = {
		className: "source-post-icon",
		onclick: (e) => {
			e.preventDefault();
			e.stopPropagation();
			open(media.parentUrl, '_blank');
		}
	};
	const videoIconProps = {
		className: "video-icon"
	};

	const durationElement = (() => {
		if (media.durationMillis === undefined) return undefined;

		const seconds = media.durationMillis / 1000;
		const duration = `${seconds / 60 | 0}:${String(seconds % 60 | 0).padStart(2, "0")}`;
		return ce("span", { className: "duration-frame" }, duration);
	})();

	const children = [
		ce("span", sourcePostIconProps, "🔗"),
		ce("span", videoIconProps, !isPhoto ? " 🎞️" : "")
	];

	if (view === 'normal') {
		const removeIconProps = {
			className: "remove",
			onclick: (e) => {
				e.preventDefault();
				e.stopPropagation();
				removeImageData(media.id);
			}
		};
		const checkIconProps = {
			className: `check-icon ${media.selected ? 'checked' : ''}`,
			onclick: (e) => {
				e.preventDefault();
				e.stopPropagation();
				checkImageData(media.id);
				if (media.selected)
					e.target.classList.add('checked');
				else
					e.target.classList.remove('checked');
			}
		};
		children.push(ce("span", removeIconProps, "✖"));
		children.push(ce("span", checkIconProps, "✔"));
		if (media.hasCache) {
			const cachedIconProps = { className: "cached-icon" };
			children.push(ce("span", cachedIconProps, "🆗"));
		}
	} else { // 'duplicate' view
		const deleteIconProps = {
			className: "delete",
			onclick: (e) => {
				e.preventDefault();
				e.stopPropagation();
				deleteCacheFile(media.id, deleteCompleted);
			}
		};
		children.push(ce("span", deleteIconProps, "🚮"));
	}

	if (durationElement) {
		children.push(durationElement);
	}

	return applyObserve(ce("div", cellProps, ...children));
};

const appendThumbnail = (resultElm, appendMedias, backendUri) => {
	appendMedias.forEach(m => resultElm.appendChild(buildThumbnail(m, backendUri)));
};

const removeThumbnail = (resultElm, removeMedias) => {
	if (removeMedias.length === 0) return;

	const elms = Array.from(resultElm.children);
	removeMedias.forEach(m => elms.find(e => e.id === m.id).remove());
};

const replaceThumbnail = (resultElm, updateMedias, backendUri) => {
	if (updateMedias.length === 0) return;

	const elms = Array.from(resultElm.children);
	updateMedias.forEach(m => elms.find(e => m.id === e.id).replaceWith(buildThumbnail(m, backendUri)));
};

const updatePanel = () => {
	chrome.storage.local.get("config", result => {
		const backendUri = result?.config?.backendAddress;

		chrome.storage.local.get("medias", result => {
			const medias = result.medias;
			const resultElm = $("result");

			if (!(medias instanceof Array) || medias.length === 0) {
				resultElm.replaceChildren();
				return;
			}

			$("mode-header").textContent = `Thumbs: ${medias.length} Photo: ${medias.filter(m => m.type === 'photo').length}`;

			resultElm.classList.add('result-thumbs');

			const mediaStore = Array.from(resultElm.children).map(e => ({ id: e.id, timestamp: e.dataset.timestamp }));
			const appendMedias = medias.filter(m => !mediaStore.some(ms => ms.id === m.id));
			const updateMedias = medias.filter(m => mediaStore.some(ms => ms.id === m.id && ms.timestamp !== m.timestamp));
			const removeMedias = mediaStore.filter(m => !medias.some(ms => ms.id === m.id));

			removeThumbnail(resultElm, removeMedias);
			replaceThumbnail(resultElm, updateMedias, backendUri);
			appendThumbnail(resultElm, appendMedias, backendUri);

			if (appendMedias.length + updateMedias.length + removeMedias.length > 0)
				Array.from(resultElm.children).sort((a, b) => b.dataset.timestamp - a.dataset.timestamp).forEach(e => resultElm.appendChild(e));
		});
	});
};

const duplicatePanel = () => {
	chrome.storage.local.get("config", result => {
		const backendUri = result?.config?.backendAddress;
		backendApi.GET("/api/media/duplicated")
			.then(mediaSetList => {
				const resultElm = $("result");
				resultElm.classList.remove('result-thumbs');
				resultElm.replaceChildren();

				$("mode-header").textContent = `Set: ${mediaSetList.length}`;

				resultElm.appendChild(ce(null, null,
					mediaSetList.map(mediaSet => ce("div",
						{ className: "duplicated-media-set result-thumbs" },
						mediaSet.map(m => buildThumbnail(m, backendUri, { view: 'duplicate' }))
					))
				));
			})
			.catch(e => showError(`Failed to get duplicated media: ${e.message}`));
	});
};

const duplicatePanelFromFile = file => {
	chrome.storage.local.get("config", result => {
		const backendUri = result?.config?.backendAddress;

		if (!file || file.type !== 'application/json') {
			showError('Please select a JSON file.');
			return;
		}

		const reader = new FileReader();
		reader.onload = async event => {
			try {
				const resultElm = $("result");
				resultElm.classList.remove('result-thumbs');
				resultElm.replaceChildren();

				const fileContent = JSON.parse(event.target.result);
				if (!isValidMediasArray(fileContent)) {
					throw new Error("Invalid or corrupted data file. The file should contain an array of media objects.");
				}
				const mediaSetList = (await backendApi.POST("/api/media/duplicated", fileContent)).filter(v => v.length >= 2);

				$("mode-header").textContent = `Set: ${mediaSetList.length}`;

				resultElm.appendChild(ce(null, null,
					mediaSetList.map(mediaSet => ce("div",
						{ className: "duplicated-media-set result-thumbs" },
						mediaSet
							.sort((a, b) => {
								const durationMillis = b.durationMillis - a.durationMillis;
								return durationMillis ? durationMillis : a.timestamp - b.timestamp;
							})
							.map(m => buildThumbnail(m, backendUri, {
								view: 'duplicate',
								deleteCompleted: () => {
									const element = document.getElementById(m.id);
									if (element) {
										const parent = element.parentNode;
										parent.removeChild(element);
										if (parent.children.length <= 1) {
											parent.parentNode.removeChild(parent);
											$("mode-header").textContent = `Set: ${document.querySelectorAll('.duplicated-media-set').length}`;
										}
									}
								}
							}))
					))
				));
			} catch (e) {
				showError(`Failed to process duplicated media from file: ${e.message}`);
			}
		};
		reader.readAsText(file);
	});
};

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
};

const changeOrder = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		chrome.storage.local.set({ medias: medias.reverse() }, () => updatePanel());
	});
};

const clearSelect = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		chrome.storage.local.set({ medias: medias.map(m => { m.selected = false; return m; }) }, () => updatePanel());
	});
};

const exportAllData = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		const blob = new Blob([JSON.stringify(medias)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		ce("a", { download: "twxfilter-all-data.json", href: url }).click();
		URL.revokeObjectURL(url);
	});
};

const importAllData = files => {
	Array.from(files).forEach(file => {
		if (file.type !== 'application/json') {
			showError("Please select a JSON file.");
			return;
		}

		const reader = new FileReader();
		reader.onload = e => {
			try {
				const parsedData = JSON.parse(e.target.result);
				if (!isValidMediasArray(parsedData)) {
					throw new Error("Invalid or corrupted data file. The file should contain an array of media objects.");
				}
				const medias = parsedData.sort(sortProc);
				backendApi.POST("/api/media", medias);
				chrome.storage.local.set({ medias }, () => updatePanel());
			} catch (err) {
				showError(`Failed to import data: ${err.message}`);
			}
		};
		reader.readAsText(file);
	});
};

const updateBackendFeatureState = config => {
	const backendConfigured = !!(config && config.backendAddress);
	const title = backendConfigured ? "" : "Backend not configured";

	const duplicatedMediaLabel = $('duplicated-media-set');
	const duplicatedMediaCheckbox = duplicatedMediaLabel.querySelector('input[type="checkbox"]');
	duplicatedMediaCheckbox.disabled = !backendConfigured;
	duplicatedMediaLabel.title = title;
	if (!backendConfigured && duplicatedMediaCheckbox.checked) {
		duplicatedMediaCheckbox.checked = false;
		updatePanel();
	}

	$('import-all-data').disabled = !backendConfigured;
	$('remove-cached-images').disabled = !backendConfigured;
	$('remove-all-images').disabled = !backendConfigured;

	$('import-all-data').title = title;
	$('remove-cached-images').title = title;
	$('remove-all-images').title = title;
};

const openOperatorDialog = () => {
	document.querySelector('.hamburger').classList.toggle('active');
	$('operator-dialog').classList.toggle("open");
};


const openConfigDialog = () => {
	chrome.storage.local.get("config", result => {
		const config = result?.config;
		const backendAddress = config?.backendAddress;

		$("backend-address").value = backendAddress ?? "";
		updateBackendFeatureState(config);

		$('config-dialog').classList.toggle("open");
	});
};

const openRemoveDialog = () => {
	$('remove-dialog').classList.toggle("open");
};

const testBackendConnection = async () => {
	const resultElm = $('config-test-result');
	try {
		const backendAddress = $('backend-address').value;
		if (!backendAddress) {
			throw new Error("Backend address is not set.");
		}
		const normalizedAddress = backendApi.normalizeBackendAddress(backendAddress);

		resultElm.textContent = "Testing...";
		resultElm.style.color = "orange";

		await backendApi.GET("/api/media/duplicated", null, { overrideBackendAddress: normalizedAddress });

		resultElm.textContent = "Success!";
		resultElm.style.color = "green";
	} catch (e) {
		resultElm.textContent = `Failed: ${e.message}`;
		resultElm.style.color = "red";
		console.error(e);
	}
};

const applyConfig = () => {
	const config = {
		backendAddress: backendApi.normalizeBackendAddress($("backend-address").value)
	};

	chrome.storage.local.set({ config })
		.then(() => {
			updateBackendFeatureState(config);
		})
		.catch(e => {
			alert(e.message);
			console.error(e);
		})
		.finally(() => {
			$("config-dialog").classList.remove("open");
			$('config-test-result').textContent = "";
		});
};

const removeCachedImages = () => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		if (!(medias instanceof Array)) return;

		backendApi.DELETE(`/api/media/cached`);
		chrome.storage.local.set({ medias: medias.filter(m => !m.hasCache) }, () => updatePanel());
	});
};

const removeAllImages = () => {
	backendApi.DELETE(`/api/media`);
	chrome.storage.local.set({ medias: [] }, () => updatePanel());
};

addEventListener('load', () => {
	addEventListener('dragover', e => {
		e.stopPropagation();
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	}, false);
	addEventListener('drop', e => {
		e.stopPropagation();
		e.preventDefault();

		const files = e.dataTransfer.files;
		if (files.length > 0)
			duplicatePanelFromFile(files[0]);
	}, false);

	chrome.storage.local.get(["medias", "config"], result => {
		const medias = result?.medias ?? [];
		const config = result?.config;

		updateBackendFeatureState(config);

		backendApi.POST("/api/media", medias)
			.then(medias => chrome.storage.local.set({ medias }))
			.catch(e => showError(`Failed to sync media with backend: ${e.message}`))
			.finally(() => updatePanel());
	});
});

$("open-operator-dialog").addEventListener('click', () => openOperatorDialog());
$("duplicated-media-set").querySelector('input[type="checkbox"]').addEventListener('change', e => e.target.checked ? duplicatePanel() : updatePanel());
$("open-config-dialog").addEventListener('click', () => openConfigDialog());
$("change-order").addEventListener('click', () => changeOrder());
$("export-all-data").addEventListener('click', () => exportAllData());
$("import-all-data").addEventListener('click', () => $("upload-all-data").click());
$("upload-all-data").addEventListener('change', e => importAllData(e?.target?.files));
$("all-remove-button").addEventListener('click', () => openRemoveDialog());

$("export-urls").addEventListener('click', () => exportURLs());
$("clear-select").addEventListener('click', () => clearSelect());
$("test-config").addEventListener('click', () => testBackendConnection());
$("apply-config").addEventListener('click', () => applyConfig());
$("remove-cached-images").addEventListener('click', () => removeCachedImages());
$("remove-all-images").addEventListener('click', () => removeAllImages());

/**
 * Recieve message
 */
chrome.runtime.onConnect.addListener(port => {
	const listener = async message => addImageData(message);

	if (port.name === 'twxfilter-panel') {
		port.onMessage.addListener(listener);
		port.onDisconnect.addListener(port => port.onMessage.removeListener(listener));
	}
});
