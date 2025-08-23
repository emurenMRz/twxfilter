export const $ = id => document.getElementById(id);

export const createElement = (tag, props, ...children) => {
	const e = tag ? document.createElement(tag) : document.createDocumentFragment();

	if (props) {
		if (typeof props === "string") {
			if (props[0] === "#")
				e.id = props.substr(1);
			else
				e.className = props;
		} else if (typeof props === "object")
			for (const key in props)
				if (props[key])
					if (key == "style") {
						const style = props[key];
						if (typeof style === "string")
							e.style = style;
						else
							for (const key in style)
								e.style[key] = style[key];
					} else if (key == "dataset") {
						const dataset = props[key];
						for (const key in dataset)
							e.dataset[key] = dataset[key];
					} else
						e[key] = props[key];
	}

	const apply = child => {
		if (child === null || child === undefined) return;
		if (typeof child === "string" || typeof child === "number")
			e.insertAdjacentHTML("beforeend", child);
		else if (child instanceof HTMLElement || child instanceof DocumentFragment)
			e.appendChild(child);
		else if (child instanceof Array)
			for (const a of child)
				apply(a);
	}

	for (const child of children)
		apply(child);

	return e;
};

export const applyObserve = element => {
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