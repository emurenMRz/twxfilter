const mediaParser = media => {
	const mediaData = {
		parentUrl: media.expanded_url,
		id: media.id_str,
		type: media.type,
		url: media.media_url_https,
		videoUrl: undefined,
		durationMillis: undefined,
		selected: false
	}

	if (media.type === "video" || media.type === "animated_gif") {
		const variants = media.video_info?.variants;
		if (!variants) return;

		chrome.devtools.inspectedWindow.eval(`console.log(variants: '${JSON.stringify(variants)}');`);
		const maxBitrate = Math.max(...variants.map(variant => variant.bitrate | 0));
		const variant = variants.find(variant => variant.bitrate === maxBitrate);
		mediaData.videoUrl = variant.url;
		mediaData.durationMillis = media.video_info?.duration_millis
	}

	chrome.devtools.inspectedWindow.eval(`console.log('${JSON.stringify(mediaData)}');`);

	return mediaData;
};

const entryParser = entry => {
	const content = entry.content;
	if (content.entryType !== 'TimelineTimelineItem') return;
	if (content.itemContent.itemType !== "TimelineTweet") return;

	const result = content.itemContent.tweet_results.result;
	if (result === undefined) return;

	const legacy = result?.tweet?.legacy || result?.card?.legacy || result?.legacy;
	if (legacy === undefined) return;

	const medias = (() => {
		if (legacy.name === 'unified_card' && 'binding_values' in legacy) {
			const unifiedCard = legacy.binding_values.find(v => v.key === 'unified_card');

			console.debug(`unifiedCard.value.type: ${unifiedCard.value.type}`);
			if (unifiedCard.value.type === 'STRING') {
				const card = JSON.parse(unifiedCard.value.string_value);
				if (card.type === "video_website")
					return Object.values(card.media_entities);
			}
		}

		return legacy.extended_entities?.media;
	})();

	if (!medias) return;

	chrome.runtime.connect({ name: "twxfilter-panel" }).postMessage(medias.map(mediaParser));
};

const timelineParesr = instruction => {
	if (instruction.type !== 'TimelineAddEntries' || !(instruction.entries instanceof Array)) return;

	instruction.entries.forEach(entryParser);
};

const extractMedia = (url, contentType, content) => {
	const o = JSON.parse(content);
	const instructions = o.data.threaded_conversation_with_injections_v2.instructions;
	instructions.forEach(timelineParesr);
}

/**
 * Fetch request
 */
chrome.devtools.network.onRequestFinished.addListener(
	io => {
		console.debug(io);

		const request = io.request;
		const response = io.response;

		const url = request.url.substring(0, request.url.indexOf('?'));
		if (!url.startsWith("https://x.com/i/api/graphql/") || !url.endsWith("TweetDetail")) return;

		const contentType = response?.headers?.find(v => v.name === 'content-type').value;
		if (typeof contentType !== "string") return;

		io.getContent(content => {
			console.debug(content);
			extractMedia(url, contentType, content);
		});
	});

/**
 * Create panel
 */
chrome.devtools.panels.create("twxfilter", "icons/icon16.png", "panel/panel.html");
