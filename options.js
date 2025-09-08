import { $, createElement as ce } from "./common/dom.js";
import backendApi from "./common/api.js";
import { buildThumbnail } from "./common/thumbnail.js";
import { showError, isValidMediasArray } from "./common/utils.js";

// --- Globals for sorting --- //
let mediaCache = {};
let currentSort = { by: 'timestamp', order: 'desc' };
const SORT_STORAGE_KEY = 'cachedMediaSortSettings';
// ------------------------- //

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

const sortMedia = (mediaData) => {
    const { by, order } = currentSort;
    const sortedData = [...mediaData]; // Create a shallow copy to avoid mutating original array

    sortedData.sort((a, b) => {
        let valA, valB;

        if (by === 'timestamp') {
            valA = a.timestamp;
            valB = b.timestamp;
        } else if (by === 'content-length') {
            valA = a.contentLength || 0;
            valB = b.contentLength || 0;
        }

        return order === 'desc' ? valB - valA : valA - valB;
    });

    return sortedData;
};

const renderMediaGrid = (mediaData, backendUri) => {
    const mediaGrid = ce("div", { className: "media-grid" });

    mediaData.forEach(media => {
        const thumbnail = buildThumbnail(media, backendUri, {
            view: 'duplicate', // Use duplicate view for delete functionality
            onDelete: deleteCacheFile,
            deleteCompleted: () => {
                // Remove the thumbnail from the DOM after successful deletion
                const element = document.getElementById(media.id);
                if (element) {
                    const grid = element.closest('.media-grid');
                    element.remove();
                    // If the group becomes empty, remove the group header too
                    if (grid && grid.children.length === 0) {
                        grid.remove();
                    }
                }
            }
        });
        mediaGrid.appendChild(thumbnail);
    });

    return mediaGrid;
};

const rerenderAllVisibleGrids = (backendUri) => {
    const loadedAccordions = document.querySelectorAll('.tab-content .media-grid[data-date]');
    loadedAccordions.forEach(grid => {
        const date = grid.dataset.date;
        if (mediaCache[date]) {
            const sortedMedia = sortMedia(mediaCache[date]);
            const newGrid = renderMediaGrid(sortedMedia, backendUri);
            newGrid.dataset.date = date; // Keep the date reference
            grid.replaceWith(newGrid);
        }
    });
};

const initSortControls = (backendUri) => {
    const sortInputs = document.querySelectorAll('.sort-options input[name="sort-by"]');
    const orderInputs = document.querySelectorAll('.sort-options input[name="sort-order"]');

    const handleSortChange = () => {
        const sortBy = document.querySelector('.sort-options input[name="sort-by"]:checked').value;
        const sortOrder = document.querySelector('.sort-options input[name="sort-order"]:checked').value;
        currentSort = { by: sortBy, order: sortOrder };
        chrome.storage.sync.set({ [SORT_STORAGE_KEY]: currentSort });
        rerenderAllVisibleGrids(backendUri);
    };

    chrome.storage.sync.get(SORT_STORAGE_KEY, (result) => {
        const savedSort = result[SORT_STORAGE_KEY];
        if (savedSort) {
            currentSort = savedSort;
        }

        document.querySelector(`.sort-options input[name="sort-by"][value="${currentSort.by}"]`).checked = true;
        document.querySelector(`.sort-options input[name="sort-order"][value="${currentSort.order}"]`).checked = true;

        sortInputs.forEach(input => input.addEventListener('change', handleSortChange));
        orderInputs.forEach(input => input.addEventListener('change', handleSortChange));
    });
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
        const accordionBody = ce("div", { id: accordionId, className: "accordion-body collapsed" });

        accordionHeader.addEventListener('click', () => {
            const isCollapsed = accordionBody.classList.toggle('collapsed');
            const isLoaded = accordionBody.dataset.loaded === 'true';

            if (!isCollapsed && !isLoaded) {
                backendApi.GET(`/api/catalog/${date}`, null, { overrideBackendAddress: backendUri })
                    .then(media => {
                        mediaCache[date] = media; // Cache the original data
                        const sortedMedia = sortMedia(media);
                        const mediaGrid = renderMediaGrid(sortedMedia, backendUri);
                        mediaGrid.dataset.date = date; // Add date for re-rendering
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
    const sortOptions = document.querySelector('.sort-options');

    chrome.storage.local.get("config", result => {
        const backendUri = result?.config?.backendAddress;
        if (!backendUri) {
            showError("Backend not configured. Please set it in the panel settings.");
            $('media-container').textContent = "Backend not configured. Please set it in the panel settings.";
            return;
        }

        initSortControls(backendUri);

        // Set initial visibility of sort options
        if (document.querySelector('.tab-button.active')?.dataset.tab === 'cached-media') {
            sortOptions.style.display = 'block';
        } else {
            sortOptions.style.display = 'none';
        }

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                tabContents.forEach(content => content.classList.remove('active'));
                const tabId = button.dataset.tab;
                document.getElementById(tabId).classList.add('active');

                if (tabId === 'cached-media') {
                    sortOptions.style.display = 'block';
                } else {
                    sortOptions.style.display = 'none';
                }

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
