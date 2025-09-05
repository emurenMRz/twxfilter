import { $, createElement as ce } from "../common/dom.js";
import backendApi from "../common/api.js";
import { buildThumbnail } from "../common/thumbnail.js";
import { showError, isValidMediasArray } from "../common/utils.js";

const canUseLocalStorage = chrome.storage !== undefined && chrome.storage.local !== undefined;

chrome.devtools.inspectedWindow.eval(`console.log('canUseLocalStorage: ${JSON.stringify(canUseLocalStorage)}');`);

const sortProc = (a, b) => {
	if (!a.timestamp && !b.timestamp) return 0;
	if (!a.timestamp) return 1;
	if (!b.timestamp) return -1;
	return b.timestamp - a.timestamp;
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

const checkImageData = id => {
	chrome.storage.local.get("medias", result => {
		const medias = result.medias;
		const media = medias.find(m => m.id === id);
		media.selected = !media.selected;
		chrome.storage.local.set({ medias }, () => updatePanel());
	});
};

const appendThumbnail = (resultElm, appendMedias, backendUri) => {
	appendMedias.forEach(m => resultElm.appendChild(buildThumbnail(m, backendUri, {
		view: 'normal',
		onRemove: removeImageData,
		onCheck: checkImageData
	})));
};

const removeThumbnail = (resultElm, removeMedias) => {
	if (removeMedias.length === 0) return;

	const elms = Array.from(resultElm.children);
	removeMedias.forEach(m => elms.find(e => e.id === m.id).remove());
};

const replaceThumbnail = (resultElm, updateMedias, backendUri) => {
	if (updateMedias.length === 0) return;

	const elms = Array.from(resultElm.children);
	updateMedias.forEach(m => elms.find(e => m.id === e.id).replaceWith(buildThumbnail(m, backendUri, {
		view: 'normal',
		onRemove: removeImageData,
		onCheck: checkImageData
	})));
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
