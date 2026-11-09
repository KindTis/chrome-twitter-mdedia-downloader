importScripts("media.js");

async function queueDownloads({ id, urls }) {
  let failed = 0;
  const seen = new Set();
  const pending = [];
  for (const value of urls) {
    const photo = tweetMedia.originalPhoto(value);
    const url = photo ?? tweetMedia.mp4(value);
    if (!url) {
      failed++;
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    const extension = photo ? new URL(photo).searchParams.get("format") : "mp4";
    pending.push(chrome.downloads.download({
      url,
      filename: id + "-" + seen.size + "." + extension,
      conflictAction: "uniquify",
      saveAs: false,
    }));
  }

  const results = await Promise.allSettled(pending);
  const queued = results.filter((result) => result.status === "fulfilled").length;
  return { queued, failed: failed + results.length - queued };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "download-tweet-media" || !tweetMedia.isSite(sender.url)) return;
  if (!tweetMedia.isId(message.id) || !Array.isArray(message.urls) || message.urls.length > 4) return;
  queueDownloads(message).then(respond, () => respond({ queued: 0, failed: message.urls.length }));
  return true;
});
