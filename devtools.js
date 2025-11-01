const mediaParser = media => {
	const mediaData = {
		parentUrl: media.expanded_url,
		id: media.id_str,
		type: media.type,
		url: media.media_url_https,
		videoUrl: undefined,
		durationMillis: undefined,
		selected: false
	};

	if (media.type === "video" || media.type === "animated_gif") {
		const variants = media.video_info?.variants;
		if (!variants) return;

		chrome.devtools.inspectedWindow.eval(`console.log(variants: '${JSON.stringify(variants)}');`);
		const maxBitrate = Math.max(...variants.map(variant => variant.bitrate | 0));
		const variant = variants.find(variant => variant.bitrate === maxBitrate);
		mediaData.videoUrl = variant.url;
		mediaData.durationMillis = media.video_info?.duration_millis;
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
				if (card.type === "video_website" || card.type === 'video_carousel_website')
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
};

/**
 * 
 * @param {*} result 
 * @returns 
 */
const parseUser = (result) => {
	if (result === undefined || result?.__typename !== 'User') return;

	const { rest_id, avatar, core, is_blue_verified, legacy, location, privacy, relationship_perspectives, verification } = result;
	return {
		id: rest_id,
		icon: avatar.image_url,
		createdAt: core.created_at,
		name: core.name,
		screenName: core.screen_name,
		isBlueVerified: is_blue_verified,
		legacy: {
			defaultProfile: legacy.default_profile,
			defaultProfileImage: legacy.default_profile_image,
			description: legacy.description,
			entities: legacy.entities,
			fastFollowersCount: legacy.fast_followers_count,
			favouritesCount: legacy.favourites_count,
			followersCount: legacy.followers_count,
			friendsCount: legacy.friends_count,
			hasCustomTimelines: legacy.has_custom_timelines,
			isTranslator: legacy.is_translator,
			listedCount: legacy.listed_count,
			mediaCount: legacy.media_count,
			normalFollowersCount: legacy.normal_followers_count,
			pinnedTweetIdsStr: legacy.pinned_tweet_ids_str,
			possiblySensitive: legacy.possibly_sensitive,
			profileInterstitialType: legacy.profile_interstitial_type,
			statusesCount: legacy.statuses_count,
			translatorType: legacy.translator_type,
			wantRetweets: legacy.want_retweets,
			withheldInCountries: legacy.withheld_in_countries,
		},
		location: location.location,
		protected: privacy.protected,
		followedBy: relationship_perspectives.followed_by,
		following: relationship_perspectives.following,
		verified: verification.verified,
	};
};

/**
 * 
 * @param {*} url 
 * @param {*} contentType 
 * @param {*} content 
 * @returns 
 */
const extractFollower = (url, contentType, content) => {
	const o = JSON.parse(content);
	if (o.data.user.result.__typename !== 'User') return;

	const { instructions } = o.data.user.result.timeline.timeline;
	instructions.forEach(({ type, entries }) => {
		if (type !== 'TimelineAddEntries' || !(entries instanceof Array)) return;

		const followers = entries.map(({ sortIndex, content }) => {
			const { entryType, itemContent } = content;
			if (entryType !== 'TimelineTimelineItem') return;
			if (itemContent.itemType !== "TimelineUser") return;

			const { result } = itemContent.user_results;
			return {
				sortIndex,
				user: parseUser(result)
			};
		});
		chrome.runtime.connect({ name: "twxfilter-followers" }).postMessage(followers.filter(v => !!v));
	});
};

/**
 * Fetch request
 */
chrome.devtools.network.onRequestFinished.addListener(
	io => {
		console.debug(io);

		const request = io.request;
		const response = io.response;

		const [url, queryString] = request.url.split("?");
		if (!url.startsWith("https://x.com/i/api/graphql/")) return;
		const query = new URLSearchParams(queryString);
		const variables = JSON.parse(query.get("variables") ?? "{}");
		const features = JSON.parse(query.get("features") ?? "{}");

		let extractor = null;
		if (url.endsWith("TweetDetail")) extractor = extractMedia;
		else if (url.endsWith("Followers")) extractor = extractFollower;
		else return;

		const contentType = response?.headers?.find(v => v.name === 'content-type').value;
		if (typeof contentType !== "string") return;

		io.getContent(content => {
			if (extractor)
				extractor(url, contentType, content, variables, features);
			else
				chrome.devtools.inspectedWindow.eval(`console.log('${content}');`);
		});
	});

/**
 * Create panel
 */
chrome.devtools.panels.create("twxfilter", "icons/icon16.png", "panel/panel.html");
