import { createElement as ce, applyObserve } from "./dom.js";

export const thumbnailUrl = url => {
	if (!url.startsWith("https://pbs.twimg.com/media/")) return url;

	const [path, query] = url.split("?");
	if (!query) return `${url}?name=small`;

	const q = Object.fromEntries(query.split("&").map(v => v.split("=")));
	if (!q.format) throw Error("Unsupport syntax");

	return `${path}?format=${q.format}&name=small`;
};

export const buildThumbnail = (media, backendUri, options = {}) => {
	const { 
		view = 'normal', 
		onRemove, 
		onCheck,  
		onDelete, 
		deleteCompleted 
	} = options;

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
				if (onRemove) onRemove(media.id);
			}
		};
		const checkIconProps = {
			className: `check-icon ${media.selected ? 'checked' : ''}`,
			onclick: (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (onCheck) onCheck(media.id);
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
				if (onDelete) onDelete(media.id, deleteCompleted);
			}
		};
		children.push(ce("span", deleteIconProps, "🚮"));
	}

	if (durationElement) {
		children.push(durationElement);
	}

	return applyObserve(ce("div", cellProps, ...children));
};
