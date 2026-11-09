const tweetMedia = (() => {
  const siteOrigins = ["https://x.com", "https://twitter.com"];
  const photoOrigin = "https://pbs.twimg.com";
  const videoOrigin = "https://video.twimg.com";
  const photoFormats = ["jpg", "jpeg", "png", "webp", "gif"];

  function parseUrl(value, base) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value, base);
      return url.username || url.password ? null : url;
    } catch {
      return null;
    }
  }

  function isSite(value) {
    return siteOrigins.includes(parseUrl(value)?.origin);
  }

  function isId(value) {
    return typeof value === "string" && /^\d{1,20}$/.test(value);
  }

  function originalPhoto(value) {
    const url = parseUrl(value);
    if (url?.origin !== photoOrigin) return null;
    const path = url.pathname.match(/^\/media\/([\w-]+)(?:\.([a-z]+))?(?::[\w-]+)?$/i);
    if (!path) return null;
    const format = (url.searchParams.get("format") ?? path[2] ?? "").toLowerCase();
    if (!photoFormats.includes(format)) return null;
    return photoOrigin + "/media/" + path[1] + "?format=" + format + "&name=orig";
  }

  function mp4(value) {
    const url = parseUrl(value);
    if (url?.origin !== videoOrigin || !/^\/(?:[\w.-]+\/)*[\w.-]+\.mp4$/i.test(url.pathname)) {
      return null;
    }
    url.hash = "";
    return url.href;
  }

  function bestMp4(variants) {
    if (!Array.isArray(variants)) return null;
    let best = null;
    let bestBitrate = -1;
    for (const variant of variants) {
      if (variant?.content_type !== "video/mp4") continue;
      const url = mp4(variant.url);
      const bitrate = Number(variant.bitrate) || 0;
      if (url && bitrate > bestBitrate) {
        best = url;
        bestBitrate = bitrate;
      }
    }
    return best;
  }

  function fromResponse(response) {
    const posts = new Map();
    const pending = [response?.data];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      const legacy = value.legacy;
      const id = value.rest_id ?? legacy?.id_str;
      const attachments = legacy?.extended_entities?.media ?? legacy?.entities?.media;
      if (isId(id) && Array.isArray(attachments) && attachments.length) {
        const urls = attachments.map((item) => {
          if (item?.type === "photo") return originalPhoto(item.media_url_https);
          if (item?.type === "video" || item?.type === "animated_gif") {
            return bestMp4(item.video_info?.variants);
          }
          return null;
        });
        const current = posts.get(id);
        // The same post can also appear in a less complete timeline entry.
        if (!current || urls.filter(Boolean).length > current.filter(Boolean).length) {
          posts.set(id, urls);
        }
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === "object") pending.push(child);
      }
    }
    return Array.from(posts, ([id, urls]) => ({ id, urls }));
  }

  return { isSite, isId, originalPhoto, mp4, fromResponse };
})();
