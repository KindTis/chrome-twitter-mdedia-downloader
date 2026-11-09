(() => {
  const origins = [
    location.origin,
    "https://api.x.com",
    "https://api.twitter.com",
  ];

  function isGraphQL(value) {
    if (!value) return false;
    const url = new URL(value);
    return (origins.includes(url.origin) || tweetMedia.isSite(url.href))
      && /^(?:\/i\/api)?\/graphql\//.test(url.pathname);
  }

  function publish(response) {
    const posts = tweetMedia.fromResponse(response);
    if (posts.length) window.postMessage({ type: "x-tweet-media", posts }, location.origin);
  }

  const fetchFromPage = window.fetch;
  window.fetch = function (...args) {
    const request = Reflect.apply(fetchFromPage, this, args);
    request.then((response) => {
      if (response.ok && isGraphQL(response.url)) {
        return response.clone().json().then(publish);
      }
    }).catch(() => {});
    return request;
  };

  const sendFromPage = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        if (!isGraphQL(this.responseURL) || this.status < 200 || this.status >= 300) return;
        if (this.responseType === "json") publish(this.response);
        if (this.responseType === "" || this.responseType === "text") {
          publish(JSON.parse(this.responseText));
        }
      } catch {
        // An unreadable response must never affect X's request.
      }
    }, { once: true });
    return Reflect.apply(sendFromPage, this, args);
  };
})();
