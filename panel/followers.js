import { createElement as ce } from "../common/dom.js";
import { canUseLocalStorage } from "./utils.js";

export const storeFollowers = followers => {
	if (!canUseLocalStorage) return;
	if (!followers) return;

	const updatedAt = Date.now();
	const nowFollowers = followers.map(v => ([v.user.id, { detail: v.user, meta: { sortIndex: v.sortIndex, updatedAt } }]));

	chrome.storage.local.get("followers", result => {
		const followers = result.followers ?? {};

		nowFollowers.forEach(([id, follower]) => {
			follower.meta.createdAt = id in followers
				? followers[id].meta.createdAt
				: follower.meta.updatedAt;
			followers[id] = follower;
		});

		chrome.storage.local.set({ followers });
	});
};

export const buildFollowerElement = f => {
	// f inferred structure from extractFollower
	const id = f.rest_id ?? f.id;
	const avatar = f.avatar?.image_url ?? f.icon ?? '';
	const name = f.core?.name ?? f.name ?? f.legacy?.name ?? '';
	const screenName = f.core?.screen_name ?? f.screenName ?? (f.legacy && f.legacy.screen_name) ?? '';
	const desc = f.legacy?.description ?? f.description ?? '';
	const followersCount = f.legacy?.followers_count ?? f.legacy?.fast_followers_count ?? '';
	const following = f.relationship_perspectives?.following ?? f.following ?? false;
	const followedBy = f.relationship_perspectives?.followed_by ?? f.followedBy ?? false;
	const verified = f.verification?.verified ?? f.verified ?? false;
	const isBlue = f.is_blue_verified ?? f.isBlueVerified ?? false;

	const container = ce('div', { className: 'follower', id });
	const left = ce('div', { className: 'follower-left' }, ce('img', { src: avatar, className: 'follower-avatar' }));
	const right = ce('div', { className: 'follower-right' });

	const title = ce('div', { className: 'follower-title' }, ce('span', { className: 'follower-name' }, name), ce('span', { className: 'follower-screenname' }, ` @${screenName}`));
	const meta = ce('div', { className: 'follower-meta' }, `${followersCount ? `Followers: ${followersCount}` : ''} ${verified ? '✅' : ''} ${isBlue ? '💠' : ''}`);
	const descElm = ce('div', { className: 'follower-desc' }, desc || '');

	right.appendChild(title);
	right.appendChild(meta);
	right.appendChild(descElm);

	container.appendChild(left);
	container.appendChild(right);

	container.addEventListener('click', () => {
		// open profile in new tab if possible
		const screen = screenName.replace(/^@/, '');
		if (screen) open(`https://x.com/${screen}`, '_blank');
	});

	return container;
};
