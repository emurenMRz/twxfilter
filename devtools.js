const mediaParser = media => {
	const mediaData = {
		parentUrl: media.expanded_url,
		id: media.id_str,
		type: media.type,
		url: media.media_url_https,
		videoUrl: undefined
	}

	if (media.type === "video" || media.type === "animated_gif") {
		const variants = media.video_info?.variants;
		if (!variants) return;

		chrome.devtools.inspectedWindow.eval(`console.log(variants: '${JSON.stringify(variants)}');`);
		const maxBitrate = Math.max(...variants.map(variant => variant.bitrate | 0));
		const variant = variants.find(variant => variant.bitrate === maxBitrate);
		mediaData.videoUrl = variant.url;
	}

	chrome.devtools.inspectedWindow.eval(`console.log('${JSON.stringify(mediaData)}');`);

	return mediaData;
};

const extractMedia = (url, contentType, content) => {
	const o = JSON.parse(content);
	const instructions = o.data.threaded_conversation_with_injections_v2.instructions;
	instructions.forEach(instruction => {
		if (instruction.type !== 'TimelineAddEntries' || !(instruction.entries instanceof Array)) return;
		instruction.entries.forEach(entry => {
			if (entry.content.entryType !== 'TimelineTimelineItem') return;
			if (entry.content.itemContent.itemType !== "TimelineTweet") return;

			const result = entry.content.itemContent.tweet_results.result;
			if (result === undefined) return;

			const legacy = result?.tweet?.legacy || result?.legacy;
			const medias = legacy?.extended_entities?.media.map(mediaParser);
			chrome.runtime.connect({ name: "twxfilter-panel" }).postMessage(medias);
		});
	});
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
		if (!url.startsWith("https://twitter.com/i/api/graphql/") || !url.endsWith("TweetDetail")) return;

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
chrome.devtools.panels.create("twxfilter", null, "panel/panel.html");
