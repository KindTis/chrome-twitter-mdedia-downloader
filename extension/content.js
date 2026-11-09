(() => {
  const articleSelector = 'article[data-testid="tweet"]';
  const cache = new Map();
  const iconNamespace = "http://www.w3.org/2000/svg";
  let scanScheduled = false;

  function ownElements(article, selector) {
    return Array.from(article.querySelectorAll(selector)).filter((element) => {
      if (element.closest(articleSelector) !== article) return false;
      const embedded = element.closest('[data-testid="quoteTweet"], [data-testid="card.wrapper"], div[role="link"]');
      return !embedded || !article.contains(embedded);
    });
  }

  function postLink(link) {
    if (!link || link.origin !== location.origin) return null;
    return link.pathname.match(/^\/(?:[\w]+|i\/web)\/status\/(\d{1,20})(?:\/(photo|video)\/\d+)?\/?$/);
  }

  function postId(article) {
    let permalinkId = null;
    for (const link of ownElements(article, 'a[href*="/status/"]')) {
      if (link.closest('[data-testid="tweetText"]')) continue;
      const match = postLink(link);
      if (!match || match[2]) continue;
      if (link.querySelector("time")) return match[1];
      permalinkId ??= match[1];
    }
    return permalinkId;
  }

  function mediaFor(article, id) {
    if (cache.has(id)) return cache.get(id);
    const urls = new Set();
    for (const image of ownElements(article, '[data-testid="tweetPhoto"] img')) {
      const match = postLink(image.closest("a"));
      if (match?.[1] !== id || match[2] !== "photo") continue;
      const url = image.src || image.currentSrc;
      if (url.startsWith("https://pbs.twimg.com/media/")) urls.add(url);
    }
    const result = [...urls];
    if (ownElements(article, '[data-testid="videoPlayer"], video').length) result.push(null);
    return result;
  }

  function createButton(article, id) {
    const slot = document.createElement("div");
    slot.className = "xmd-slot";
    slot.dataset.postId = id;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "xmd-download";
    button.setAttribute("aria-label", "게시물 미디어 다운로드");
    button.title = "게시물 미디어 다운로드";

    const icon = document.createElementNS(iconNamespace, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(iconNamespace, "path");
    path.setAttribute("d", "M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4");
    icon.append(path);
    button.append(icon);

    const status = document.createElement("span");
    status.className = "xmd-status";
    status.setAttribute("role", "status");
    let dismiss;

    function showStatus(message) {
      clearTimeout(dismiss);
      status.textContent = message;
      dismiss = setTimeout(() => { status.textContent = ""; }, 5000);
    }

    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!event.isTrusted || button.disabled || postId(article) !== id) return;
      const urls = mediaFor(article, id);
      if (!urls.some(Boolean)) {
        showStatus("다운로드할 원본 주소를 찾지 못했습니다.");
        return;
      }
      button.disabled = true;
      try {
        const { queued, failed } = await chrome.runtime.sendMessage({ type: "download-tweet-media", id, urls });
        showStatus(failed ? queued + "개 시작 · " + failed + "개 실패" : queued + "개 다운로드 시작");
      } catch {
        showStatus("다운로드를 시작하지 못했습니다.");
      } finally {
        button.disabled = false;
      }
    });

    slot.append(button, status);
    return slot;
  }

  function scan() {
    scanScheduled = false;
    for (const article of document.querySelectorAll(articleSelector)) {
      const reply = ownElements(article, '[data-testid="reply"]')[0];
      const bar = reply?.closest('[role="group"]');
      const id = postId(article);
      const show = bar && article.contains(bar) && id && mediaFor(article, id).length;
      const existing = ownElements(article, ".xmd-slot")[0];
      if (existing && (!show || existing.dataset.postId !== id || existing.parentElement !== bar)) {
        existing.remove();
      }
      if (show && (!existing || !existing.isConnected)) bar.append(createButton(article, id));
    }
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(scan);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin
      || event.data?.type !== "x-tweet-media" || !Array.isArray(event.data.posts)) return;
    for (const post of event.data.posts) {
      if (typeof post?.id !== "string" || !/^\d{1,20}$/.test(post.id) || !Array.isArray(post.urls)
        || !post.urls.length || post.urls.length > 4) continue;
      const urls = post.urls.map((url) => typeof url === "string" ? url : null);
      const current = cache.get(post.id);
      if (current && current.filter(Boolean).length > urls.filter(Boolean).length) continue;
      cache.delete(post.id);
      cache.set(post.id, urls);
      if (cache.size > 2000) cache.delete(cache.keys().next().value);
    }
    scheduleScan();
  });

  new MutationObserver(scheduleScan).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "src", "srcset", "data-testid"],
  });
  scheduleScan();
})();
