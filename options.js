import { $, createElement as ce } from "./common/dom.js";
import backendApi from "./common/api.js";
import { buildThumbnail } from "./common/thumbnail.js";
import { showError, isValidMediasArray } from "./common/utils.js";

const deleteCacheFile = (id, completed) => {
    chrome.storage.local.get("medias", result => {
        const medias = result.medias.filter(m => m.id !== id);

        backendApi.DELETE(`/api/cache-file/${id}`)
            .then(() => {
                chrome.storage.local.set({ medias }, completed);
            })
            .catch(e => showError(`Failed to delete cache file: ${e.message}`));
    });
};

const showDuplicatedMedia = backendUri => {
    const resultElm = $("duplicated-media-container");
    resultElm.textContent = "Listing duplicated media...";

    backendApi.GET("/api/media/duplicated")
        .then(mediaSetList => {
            resultElm.replaceChildren();

            if (mediaSetList.length === 0) {
                resultElm.textContent = "No duplicated media found.";
                return;
            }

            resultElm.appendChild(ce(null, null,
                mediaSetList.map(mediaSet => ce("div",
                    { className: "duplicated-media-set result-thumbs" },
                    mediaSet.map(m => buildThumbnail(m, backendUri, { view: 'duplicate', onDelete: deleteCacheFile, deleteCompleted: () => showDuplicatedMedia(backendUri) }))
                ))
            ));
        })
        .catch(e => {
            resultElm.textContent = `Failed to get duplicated media: ${e.message}`;
            showError(`Failed to get duplicated media: ${e.message}`);
        });
};

const showDuplicatedMediaFromFile = (file, backendUri) => {
    if (!file || file.type !== 'application/json') {
        showError('Please select a JSON file.');
        return;
    }

    const reader = new FileReader();
    reader.onload = async event => {
        try {
            const resultElm = $("duplicated-media-container");
            resultElm.replaceChildren();

            const fileContent = JSON.parse(event.target.result);
            if (!isValidMediasArray(fileContent)) {
                throw new Error("Invalid or corrupted data file. The file should contain an array of media objects.");
            }
            const mediaSetList = (await backendApi.POST("/api/media/duplicated", fileContent)).filter(v => v.length >= 2);

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
                            onDelete: deleteCacheFile,
                            deleteCompleted: () => {
                                const element = document.getElementById(m.id);
                                if (element) {
                                    const parent = element.parentNode;
                                    parent.removeChild(element);
                                    if (parent.children.length <= 1) {
                                        parent.parentNode.removeChild(parent);
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
};

const renderMediaGrid = (mediaData, backendUri) => {
    const mediaGrid = ce(null, { className: "media-grid" });

    mediaData.forEach(media => {
        const thumbnail = buildThumbnail(media, backendUri, {
            view: 'duplicate', // Use duplicate view for delete functionality
            onDelete: deleteCacheFile,
            deleteCompleted: () => {
                // Remove the thumbnail from the DOM after successful deletion
                const element = document.getElementById(media.id);
                if (element) {
                    element.remove();
                    // If the group becomes empty, remove the group header too
                    if (mediaGrid.children.length === 0) {
                        mediaGrid.remove();
                    }
                }
            }
        });
        mediaGrid.appendChild(thumbnail);
    });

    return mediaGrid;
};

const renderCatalog = (catalogIndex, backendUri) => {
    const container = $('media-container');
    container.replaceChildren(); // Clear existing content

    if (!catalogIndex || catalogIndex.length === 0) {
        container.textContent = "No cached media found.";
        return;
    }

    // Sort dates in descending order
    const sortedDates = catalogIndex.sort((a, b) => b.localeCompare(a));

    sortedDates.forEach(date => {
        const accordionId = `accordion-${date}`;
        const accordionHeader = ce("h2", { className: "date-header" }, date);
        const accordionBody = ce("div", { id: accordionId, className: "media-grid collapsed" });

        accordionHeader.addEventListener('click', () => {
            const isCollapsed = accordionBody.classList.toggle('collapsed');
            const isLoaded = accordionBody.dataset.loaded === 'true';

            if (!isCollapsed && !isLoaded) {
                backendApi.GET(`/api/catalog/${date}`, null, { overrideBackendAddress: backendUri })
                    .then(media => {
                        const mediaGrid = renderMediaGrid(media, backendUri);
                        accordionBody.appendChild(mediaGrid);
                        accordionBody.dataset.loaded = 'true';
                    })
                    .catch(e => {
                        showError(`Failed to fetch media for ${date}: ${e.message}`);
                        accordionBody.textContent = `Failed to fetch media: ${e.message}`;
                    });
            }
        });

        container.appendChild(accordionHeader);
        container.appendChild(accordionBody);
    });
};

document.addEventListener('DOMContentLoaded', () => {
    console.log("Options page loaded");

    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    chrome.storage.local.get("config", result => {
        const backendUri = result?.config?.backendAddress;
        if (!backendUri) {
            showError("Backend not configured. Please set it in the panel settings.");
            $('media-container').textContent = "Backend not configured. Please set it in the panel settings.";
            return;
        }

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                tabContents.forEach(content => content.classList.remove('active'));
                const tabId = button.dataset.tab;
                document.getElementById(tabId).classList.add('active');

                if (tabId === 'duplicated-media') {
                    showDuplicatedMedia(backendUri);
                }
            });
        });

        addEventListener('dragover', e => {
            e.stopPropagation();
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }, false);

        addEventListener('drop', e => {
            e.stopPropagation();
            e.preventDefault();

            if (document.getElementById('duplicated-media').classList.contains('active')) {
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    showDuplicatedMediaFromFile(files[0], backendUri);
                }
            }
        }, false);

        backendApi.GET("/api/catalog/index", null, { overrideBackendAddress: backendUri })
            .then(catalogIndex => {
                renderCatalog(catalogIndex, backendUri);
            })
            .catch(e => {
                showError(`Failed to fetch catalog index from backend: ${e.message}`);
                $('media-container').textContent = `Failed to fetch catalog index: ${e.message}`;
            });
    });
});
